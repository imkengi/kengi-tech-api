import { Router, Response } from 'express'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { requireRole } from '../middleware/roleMiddleware'

const router = Router()

// ─── Bank Accounts — thin wrapper around /api/tax/hkd/bank-accounts ─────────

// GET /api/bank-accounts
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma! as any
        const accounts = await prisma.bankAccount.findMany({ orderBy: { createdAt: 'asc' } })
        res.json({ success: true, data: accounts })
    } catch (err) {
        console.error('Get bank accounts error:', err)
        res.status(500).json({ success: false, error: 'Lỗi khi lấy danh sách tài khoản ngân hàng' })
    }
})

// POST /api/bank-accounts
router.post('/', authMiddleware, requireRole('admin', 'manager'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma! as any
        const { bankName, accountNumber, accountName, isDefault } = req.body
        if (!bankName?.trim() || !accountNumber?.trim()) {
            return res.status(400).json({ success: false, error: 'Tên ngân hàng và số tài khoản bắt buộc' })
        }
        if (isDefault) await prisma.bankAccount.updateMany({ data: { isDefault: false } })
        const account = await prisma.bankAccount.create({
            data: {
                bankName: bankName.trim(),
                accountNumber: accountNumber.trim(),
                accountName: accountName?.trim() || null,
                isDefault: !!isDefault,
            },
        })
        res.status(201).json({ success: true, data: account })
    } catch (err) {
        console.error('Create bank account error:', err)
        res.status(500).json({ success: false, error: 'Lỗi khi tạo tài khoản ngân hàng' })
    }
})

// PUT /api/bank-accounts/:id
router.put('/:id', authMiddleware, requireRole('admin', 'manager'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma! as any
        const { bankName, accountNumber, accountName, isDefault } = req.body
        if (isDefault) await prisma.bankAccount.updateMany({ data: { isDefault: false } })
        const account = await prisma.bankAccount.update({
            where: { id: String(req.params.id) },
            data: {
                ...(bankName !== undefined && { bankName: bankName?.trim() }),
                ...(accountNumber !== undefined && { accountNumber: accountNumber?.trim() }),
                ...(accountName !== undefined && { accountName: accountName?.trim() || null }),
                ...(isDefault !== undefined && { isDefault: !!isDefault }),
            },
        })
        res.json({ success: true, data: account })
    } catch (err) {
        console.error('Update bank account error:', err)
        res.status(500).json({ success: false, error: 'Lỗi khi cập nhật tài khoản ngân hàng' })
    }
})

// DELETE /api/bank-accounts/:id
router.delete('/:id', authMiddleware, requireRole('admin', 'manager'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma! as any
        await prisma.bankAccount.delete({ where: { id: String(req.params.id) } })
        res.json({ success: true })
    } catch (err) {
        console.error('Delete bank account error:', err)
        res.status(500).json({ success: false, error: 'Lỗi khi xóa tài khoản ngân hàng' })
    }
})

export default router
