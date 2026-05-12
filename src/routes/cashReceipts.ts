import { Router, Response } from 'express'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { requireRole } from '../middleware/roleMiddleware'

const router = Router()

// ─── Cash Receipts (Phiếu thu) ─────────────────────────────────────────────

// GET /api/cash-receipts — list with filters
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma! as any
        const { startDate, endDate, category, search, status } = req.query
        const where: any = {}

        if (category && category !== 'all') where.category = String(category)
        if (status && status !== 'all') where.status = String(status)
        if (search) where.description = { contains: String(search) }
        if (startDate || endDate) {
            where.date = {}
            if (startDate) where.date.gte = new Date(String(startDate))
            if (endDate) where.date.lte = new Date(String(endDate))
        }

        const receipts = await prisma.cashReceipt.findMany({ where, orderBy: { date: 'desc' } })
        res.json({ success: true, data: receipts })
    } catch (err) {
        console.error('Get cash receipts error:', err)
        res.status(500).json({ success: false, error: 'Lỗi khi lấy danh sách phiếu thu' })
    }
})

// GET /api/cash-receipts/stats — totals by category
router.get('/stats', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma! as any
        const { startDate, endDate } = req.query
        const where: any = { status: 'active' }
        if (startDate || endDate) {
            where.date = {}
            if (startDate) where.date.gte = new Date(String(startDate))
            if (endDate) where.date.lte = new Date(String(endDate))
        }

        const receipts = await prisma.cashReceipt.findMany({ where })
        const total = receipts.reduce((s: number, r: any) => s + r.amount, 0)
        const categories: Record<string, number> = {}
        receipts.forEach((r: any) => { categories[r.category] = (categories[r.category] || 0) + r.amount })

        res.json({ success: true, data: { total, count: receipts.length, categories } })
    } catch (err) {
        console.error('Get cash receipts stats error:', err)
        res.status(500).json({ success: false, error: 'Lỗi khi lấy thống kê phiếu thu' })
    }
})

// POST /api/cash-receipts — create
router.post('/', authMiddleware, requireRole('admin', 'manager'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma! as any
        const {
            description, amount, category, date,
            receivedVia, bankAccountId, customerId, customerName, reference,
        } = req.body

        if (!description?.trim()) return res.status(400).json({ success: false, error: 'Mô tả không được để trống' })
        if (!amount || Number(amount) <= 0) return res.status(400).json({ success: false, error: 'Số tiền phải lớn hơn 0' })

        const receipt = await prisma.cashReceipt.create({
            data: {
                description: String(description).trim(),
                amount: Number(amount),
                category: category || 'other',
                date: date ? new Date(date) : new Date(),
                receivedVia: receivedVia || (bankAccountId ? 'Chuyển khoản' : 'Tiền mặt'),
                bankAccountId: bankAccountId || null,
                customerId: customerId || null,
                customerName: customerName?.trim() || null,
                reference: reference?.trim() || null,
            },
        })

        // Mirror to BankTransaction when paid via bank account
        if (bankAccountId) {
            await prisma.bankTransaction.create({
                data: {
                    bankAccountId,
                    type: 'deposit',
                    amount: Number(amount),
                    description: String(description).trim(),
                    reference: reference?.trim() || `CR-${receipt.id}`,
                    date: date ? new Date(date) : new Date(),
                },
            }).catch((e: any) => console.error('Bank transaction mirror failed:', e.message))
        }

        res.status(201).json({ success: true, data: receipt })
    } catch (err) {
        console.error('Create cash receipt error:', err)
        res.status(500).json({ success: false, error: 'Lỗi khi tạo phiếu thu' })
    }
})

// PUT /api/cash-receipts/:id — update
router.put('/:id', authMiddleware, requireRole('admin', 'manager'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma! as any
        const id = String(req.params.id)
        const {
            description, amount, category, date,
            receivedVia, bankAccountId, customerId, customerName, reference,
        } = req.body

        const data: any = {}
        if (description !== undefined) data.description = String(description).trim()
        if (amount !== undefined) data.amount = Number(amount)
        if (category !== undefined) data.category = category
        if (date !== undefined) data.date = new Date(date)
        if (receivedVia !== undefined) data.receivedVia = receivedVia
        if (bankAccountId !== undefined) data.bankAccountId = bankAccountId || null
        if (customerId !== undefined) data.customerId = customerId || null
        if (customerName !== undefined) data.customerName = customerName?.trim() || null
        if (reference !== undefined) data.reference = reference?.trim() || null

        const receipt = await prisma.cashReceipt.update({ where: { id }, data })
        res.json({ success: true, data: receipt })
    } catch (err) {
        console.error('Update cash receipt error:', err)
        res.status(500).json({ success: false, error: 'Lỗi khi cập nhật phiếu thu' })
    }
})

// POST /api/cash-receipts/:id/cancel — soft-cancel with reason
router.post('/:id/cancel', authMiddleware, requireRole('admin', 'manager'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma! as any
        const id = String(req.params.id)
        const { reason } = req.body

        const existing = await prisma.cashReceipt.findUnique({ where: { id } })
        if (!existing) return res.status(404).json({ success: false, error: 'Không tìm thấy phiếu thu' })
        if (existing.status === 'cancelled') return res.status(400).json({ success: false, error: 'Phiếu thu đã bị hủy trước đó' })

        const receipt = await prisma.cashReceipt.update({
            where: { id },
            data: {
                status: 'cancelled',
                cancelledAt: new Date(),
                cancelReason: reason?.trim() || null,
            },
        })

        // Reverse the mirrored bank transaction (withdraw same amount) if it was a bank receipt
        if (existing.bankAccountId) {
            await prisma.bankTransaction.create({
                data: {
                    bankAccountId: existing.bankAccountId,
                    type: 'withdraw',
                    amount: existing.amount,
                    description: `Hủy phiếu thu: ${existing.description}`,
                    reference: `CR-CANCEL-${existing.id}`,
                    date: new Date(),
                },
            }).catch((e: any) => console.error('Bank transaction reversal failed:', e.message))
        }

        res.json({ success: true, data: receipt })
    } catch (err) {
        console.error('Cancel cash receipt error:', err)
        res.status(500).json({ success: false, error: 'Lỗi khi hủy phiếu thu' })
    }
})

// DELETE /api/cash-receipts/:id — hard delete
router.delete('/:id', authMiddleware, requireRole('admin', 'manager'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma! as any
        await prisma.cashReceipt.delete({ where: { id: String(req.params.id) } })
        res.json({ success: true })
    } catch (err) {
        console.error('Delete cash receipt error:', err)
        res.status(500).json({ success: false, error: 'Lỗi khi xóa phiếu thu' })
    }
})

export default router
