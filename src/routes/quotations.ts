import { Router, Request, Response } from 'express'
import prisma from '../lib/prisma'
import { authMiddleware } from '../middleware/auth'

const router = Router()

// GET /api/quotations
router.get('/', authMiddleware, async (req: Request, res: Response) => {
    try {
        const { search, status } = req.query
        const where: any = {}
        if (status && status !== 'all') where.status = status
        if (search) {
            const q = String(search)
            where.OR = [{ code: { contains: q } }, { customerName: { contains: q } }]
        }
        const data = await prisma.quotation.findMany({ where, orderBy: { createdAt: 'desc' } })
        // Parse items JSON for each quotation
        const parsed = data.map(q => ({ ...q, items: JSON.parse(q.items || '[]') }))
        res.json({ success: true, data: parsed })
    } catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// POST /api/quotations
router.post('/', authMiddleware, async (req: Request, res: Response) => {
    try {
        const { customerName, customerPhone, items, totalAmount, validUntil, notes } = req.body
        if (!customerName?.trim()) return res.status(400).json({ success: false, error: 'Customer name required' })
        const count = await prisma.quotation.count()
        const code = `QT-${String(count + 1).padStart(4, '0')}`
        const data = await prisma.quotation.create({
            data: { code, customerName, customerPhone, items: JSON.stringify(items || []), totalAmount: Number(totalAmount) || 0, validUntil: validUntil ? new Date(validUntil) : null, notes },
        })
        res.status(201).json({ success: true, data: { ...data, items: JSON.parse(data.items) } })
    } catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// PUT /api/quotations/:id
router.put('/:id', authMiddleware, async (req: Request, res: Response) => {
    try {
        const { status, customerName, items, totalAmount, notes } = req.body
        const d: any = {}
        if (status) d.status = status
        if (customerName) d.customerName = customerName
        if (items) { d.items = JSON.stringify(items); d.totalAmount = items.reduce((s: number, it: any) => s + (it.quantity || 0) * (it.unitPrice || 0), 0) }
        if (totalAmount !== undefined) d.totalAmount = Number(totalAmount)
        if (notes !== undefined) d.notes = notes
        const data = await prisma.quotation.update({ where: { id: req.params.id }, data: d })
        res.json({ success: true, data: { ...data, items: JSON.parse(data.items) } })
    } catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// DELETE /api/quotations/:id
router.delete('/:id', authMiddleware, async (req: Request, res: Response) => {
    try { await prisma.quotation.delete({ where: { id: req.params.id } }); res.json({ success: true }) }
    catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

export default router
