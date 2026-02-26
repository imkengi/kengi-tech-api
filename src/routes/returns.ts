import { Router, Request, Response } from 'express'
import prisma from '../lib/prisma'
import { authMiddleware } from '../middleware/auth'

const router = Router()

// GET /api/returns
router.get('/', authMiddleware, async (req: Request, res: Response) => {
    try {
        const { status, search } = req.query
        const where: any = {}
        if (status && status !== 'all') where.status = status
        if (search) {
            where.OR = [
                { code: { contains: String(search) } },
                { customerName: { contains: String(search) } },
                { originalInvoice: { contains: String(search) } },
            ]
        }
        const returns = await prisma.returnOrder.findMany({ where, orderBy: { createdAt: 'desc' } })
        const data = returns.map(r => ({ ...r, items: JSON.parse(r.items || '[]') }))
        res.json({ success: true, data })
    } catch (err) {
        console.error('Get returns error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// GET /api/returns/stats
router.get('/stats', authMiddleware, async (_req: Request, res: Response) => {
    try {
        const returns = await prisma.returnOrder.findMany()
        const total = returns.length
        const pending = returns.filter(r => r.status === 'pending').length
        const totalRefund = returns.reduce((s, r) => s + r.totalRefund, 0)
        const refunded = returns.filter(r => r.status === 'refunded').reduce((s, r) => s + r.totalRefund, 0)
        res.json({ success: true, data: { total, pending, totalRefund, refunded } })
    } catch (err) {
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// POST /api/returns
router.post('/', authMiddleware, async (req: Request, res: Response) => {
    try {
        const { code, originalInvoice, customerName, customerPhone, reason, items, totalRefund, notes } = req.body
        if (!originalInvoice?.trim()) return res.status(400).json({ success: false, error: 'Original invoice required' })
        if (!customerName?.trim()) return res.status(400).json({ success: false, error: 'Customer name required' })

        // Auto-generate code if not provided
        const count = await prisma.returnOrder.count()
        const returnCode = code || `RT-${String(count + 1).padStart(3, '0')}`

        const returnOrder = await prisma.returnOrder.create({
            data: {
                code: returnCode,
                originalInvoice: originalInvoice.trim(),
                customerName: customerName.trim(),
                customerPhone: customerPhone || null,
                reason: reason || 'other',
                items: JSON.stringify(items || []),
                totalRefund: Number(totalRefund) || 0,
                notes: notes || null,
            },
        })
        res.status(201).json({ success: true, data: { ...returnOrder, items: JSON.parse(returnOrder.items) } })
    } catch (err) {
        console.error('Create return error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// PUT /api/returns/:id
router.put('/:id', authMiddleware, async (req: Request, res: Response) => {
    try {
        const { status, notes } = req.body
        const data: any = {}
        if (status !== undefined) {
            data.status = status
            if (status === 'approved' || status === 'rejected' || status === 'refunded') {
                data.processedAt = new Date()
            }
        }
        if (notes !== undefined) data.notes = notes

        const returnOrder = await prisma.returnOrder.update({ where: { id: req.params.id }, data })
        res.json({ success: true, data: { ...returnOrder, items: JSON.parse(returnOrder.items) } })
    } catch (err) {
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// DELETE /api/returns/:id
router.delete('/:id', authMiddleware, async (req: Request, res: Response) => {
    try {
        await prisma.returnOrder.delete({ where: { id: req.params.id } })
        res.json({ success: true })
    } catch (err) {
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

export default router
