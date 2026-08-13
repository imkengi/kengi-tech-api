import { Router, Response } from 'express'
import { authMiddleware, getBranchFilter, AuthRequest, getBranchId, canAccessBranch } from '../middleware/auth'
import { requireRole } from '../middleware/roleMiddleware'
import { validate } from '../middleware/validate'
import { CreateExpenseSchema, UpdateExpenseSchema } from '../schemas'
import { cacheGet, cacheSet, cacheDel } from '../lib/cache'
import { enforcePeriodLock } from '../lib/periodLock'
import { emitEntityEvent } from '../lib/webhookDispatch'
import { postExpenseJournal, refsOfExpense, reverseJournalRefs } from '../lib/autoJournalPurchase'

const router = Router()

// Payload gọn cho webhook phiếu chi
const expensePayload = (e: any) => ({
    id: e?.id, amount: e?.amount, category: e?.category, description: e?.description,
    paidBy: e?.paidBy ?? null, status: e?.status ?? null, date: e?.date, branchId: e?.branchId ?? null,
})

// GET /api/expenses
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const schema = req.user?.storeSchema || 'default'
        const cacheKey = `${schema}:expenses:${JSON.stringify(getBranchFilter(req))}:${JSON.stringify(req.query)}`
        const cached = await cacheGet(cacheKey)
        if (cached) return res.json(cached)
        const prisma = req.storePrisma!
        const branchId = getBranchId(req)
        const { search, category, status, startDate, endDate } = req.query as Record<string, string | undefined>
        const where: any = { ...getBranchFilter(req) }
        if (category && category !== 'all') where.category = category
        if (status && status !== 'all') where.status = status
        if (search) where.description = { contains: String(search) }
        if (startDate || endDate) {
            where.date = {}
            if (startDate) where.date.gte = new Date(String(startDate))
            if (endDate) where.date.lte = new Date(String(endDate))
        }

        const expenses = await prisma.expense.findMany({ where, orderBy: { date: 'desc' } })
        const _response = { success: true, data: expenses }
        await cacheSet(cacheKey, _response, 60)
        res.json(_response)
    } catch (err) {
        console.error('Get expenses error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// GET /api/expenses/stats
router.get('/stats', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const branchId = getBranchId(req)
        const expenses = await prisma.expense.findMany({ where: { ...getBranchFilter(req as any), status: 'active' } as any })
        const total = expenses.reduce((s, e) => s + e.amount, 0)
        const recurring = expenses.filter(e => e.recurring).reduce((s, e) => s + e.amount, 0)
        const categories: Record<string, number> = {}
        expenses.forEach(e => { categories[e.category] = (categories[e.category] || 0) + e.amount })
        res.json({ success: true, data: { total, recurring, count: expenses.length, categories } })
    } catch (err) {
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// POST /api/expenses
router.post('/', authMiddleware, requireRole('admin', 'manager'), validate(CreateExpenseSchema), enforcePeriodLock('date'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma! as any
        const branchId = getBranchId(req)
        const { description, amount, category, paidBy, recurring, date, bankAccountId } = req.body
        if (!description?.trim()) return res.status(400).json({ success: false, error: 'Description required' })
        if (!amount || amount <= 0) return res.status(400).json({ success: false, error: 'Valid amount required' })

        const expense = await prisma.expense.create({
            data: {
                description: description.trim(),
                amount: Number(amount),
                category: category || 'other',
                paidBy: paidBy || 'Admin',
                recurring: recurring || false,
                date: date ? new Date(date) : new Date(),
                bankAccountId: bankAccountId || null,
                branchId: getBranchId(req) || null,
            },
        })

        // Mirror to BankTransaction when paid from a bank account
        if (bankAccountId) {
            await prisma.bankTransaction.create({
                data: {
                    bankAccountId,
                    type: 'withdraw',
                    amount: Number(amount),
                    description: description.trim(),
                    reference: `EXP-${expense.id}`,
                    date: date ? new Date(date) : new Date(),
                },
            }).catch((e: any) => console.error('Bank transaction mirror failed:', e.message))
        }

        /* Ghi sổ kế toán ngay: Nợ 641/642 (theo loại) / Có 111|112, tách VAT đầu
         * vào sang 1331. Phiếu 'pending' (bóc tự động từ hộp thư, chờ duyệt)
         * KHÔNG ghi — chưa được xác nhận thì chưa phải nghiệp vụ. */
        if ((expense.status ?? 'active') === 'active') {
            await postExpenseJournal(prisma, expense as any, {
                branchId: expense.branchId || null,
                userId: req.user?.userId || null,
            }).catch(() => { })
        }

        cacheDel(`${req.user?.storeSchema || 'default'}:expenses:*`).catch(() => {})
        res.status(201).json({ success: true, data: expense })
        emitEntityEvent(prisma, 'expense.created', expensePayload(expense), req.user?.storeSchema).catch(() => { })
    } catch (err) {
        console.error('Create expense error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// PUT /api/expenses/:id
router.put('/:id', authMiddleware, requireRole('admin', 'manager'), validate(UpdateExpenseSchema), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma! as any
        const branchId = getBranchId(req)
        const expId = String(req.params.id)
        const { description, amount, category, paidBy, recurring, date, bankAccountId } = req.body
        const existing = await prisma.expense.findUnique({ where: { id: expId } })
        if (!existing) return res.status(404).json({ success: false, error: 'Không tìm thấy phiếu chi' })
        if (!canAccessBranch(req, existing.branchId)) return res.status(404).json({ success: false, error: 'Không tìm thấy phiếu chi' })
        const expense = await prisma.expense.update({
            where: { id: expId },
            data: {
                ...(description !== undefined && { description }),
                ...(amount !== undefined && { amount: Number(amount) }),
                ...(category !== undefined && { category }),
                ...(paidBy !== undefined && { paidBy }),
                ...(recurring !== undefined && { recurring }),
                ...(date !== undefined && { date: new Date(date) }),
                ...(bankAccountId !== undefined && { bankAccountId: bankAccountId || null }),
            },
        })
        cacheDel(`${req.user?.storeSchema || 'default'}:expenses:*`).catch(() => {})
        res.json({ success: true, data: expense })
    } catch (err) {
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// POST /api/expenses/:id/cancel — soft-cancel with reason (reverses bank mirror)
router.post('/:id/cancel', authMiddleware, requireRole('admin', 'manager'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma! as any
        const id = String(req.params.id)
        const { reason } = req.body

        const existing = await prisma.expense.findUnique({ where: { id } })
        if (!existing) return res.status(404).json({ success: false, error: 'Không tìm thấy phiếu chi' })
        if (!canAccessBranch(req, existing.branchId)) return res.status(404).json({ success: false, error: 'Không tìm thấy phiếu chi' })
        if (existing.status === 'cancelled') return res.status(400).json({ success: false, error: 'Phiếu chi đã bị hủy trước đó' })

        const expense = await prisma.expense.update({
            where: { id },
            data: {
                status: 'cancelled',
                cancelledAt: new Date(),
                cancelReason: reason?.trim() || null,
            },
        })

        // Reverse the mirrored bank transaction if it was paid via bank
        if (existing.bankAccountId) {
            await prisma.bankTransaction.create({
                data: {
                    bankAccountId: existing.bankAccountId,
                    type: 'deposit',
                    amount: existing.amount,
                    description: `Hủy phiếu chi: ${existing.description}`,
                    reference: `EXP-CANCEL-${existing.id}`,
                    date: new Date(),
                },
            }).catch((e: any) => console.error('Bank transaction reversal failed:', e.message))
        }

        /* Hủy phiếu chi thì phải ghi BÚT TOÁN ĐẢO, không xóa bút toán cũ — sổ kế
         * toán sửa bằng bút toán đảo mới giữ được dấu vết kiểm toán. */
        await reverseJournalRefs(prisma, refsOfExpense(existing.id), {
            branchId: existing.branchId || null, userId: req.user?.userId || null,
        }).catch(() => { })

        cacheDel(`${req.user?.storeSchema || 'default'}:expenses:*`).catch(() => {})
        res.json({ success: true, data: expense })
        emitEntityEvent(prisma, 'expense.cancelled', expensePayload(expense), req.user?.storeSchema).catch(() => { })
    } catch (err) {
        console.error('Cancel expense error:', err)
        res.status(500).json({ success: false, error: 'Lỗi khi hủy phiếu chi' })
    }
})

// POST /api/expenses/:id/approve — duyệt phiếu CHỜ (quét từ hộp thư tạo ra
// status 'pending', chưa tính vào thống kê). Duyệt xong mới thành 'active'.
router.post('/:id/approve', authMiddleware, requireRole('admin', 'manager'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma! as any
        const id = String(req.params.id)
        const existing = await prisma.expense.findUnique({ where: { id } })
        if (!existing) return res.status(404).json({ success: false, error: 'Không tìm thấy phiếu chi' })
        if (!canAccessBranch(req, existing.branchId)) return res.status(404).json({ success: false, error: 'Không tìm thấy phiếu chi' })
        if (existing.status !== 'pending') return res.status(400).json({ success: false, error: 'Phiếu không ở trạng thái chờ duyệt' })

        const expense = await prisma.expense.update({ where: { id }, data: { status: 'active' } })
        cacheDel(`${req.user?.storeSchema || 'default'}:expenses:*`).catch(() => {})
        res.json({ success: true, data: expense })
        emitEntityEvent(prisma, 'expense.approved', expensePayload(expense), req.user?.storeSchema).catch(() => { })
    } catch (err) {
        console.error('Approve expense error:', err)
        res.status(500).json({ success: false, error: 'Lỗi khi duyệt phiếu chi' })
    }
})

// DELETE /api/expenses/:id
router.delete('/:id', authMiddleware, requireRole('admin', 'manager'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const id = String(req.params.id)
        const existing = await prisma.expense.findUnique({ where: { id } })
        if (!existing) return res.status(404).json({ success: false, error: 'Không tìm thấy phiếu chi' })
        if (!canAccessBranch(req, existing.branchId)) return res.status(404).json({ success: false, error: 'Không tìm thấy phiếu chi' })
        await prisma.expense.delete({ where: { id } })
        cacheDel(`${req.user?.storeSchema || 'default'}:expenses:*`).catch(() => {})
        res.json({ success: true })
    } catch (err) {
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

export default router
