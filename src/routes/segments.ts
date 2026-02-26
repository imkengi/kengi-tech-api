import { Router, Request, Response } from 'express'
import prisma from '../lib/prisma'
import { authMiddleware } from '../middleware/auth'

const router = Router()

// GET /api/segments
router.get('/', authMiddleware, async (_req: Request, res: Response) => {
    try {
        const data = await prisma.customerSegment.findMany({ orderBy: { createdAt: 'desc' } })
        const parsed = data.map(s => ({ ...s, conditions: JSON.parse(s.conditions || '{}') }))
        res.json({ success: true, data: parsed })
    } catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// POST /api/segments
router.post('/', authMiddleware, async (req: Request, res: Response) => {
    try {
        const { name, description, conditions, color } = req.body
        if (!name?.trim()) return res.status(400).json({ success: false, error: 'Name required' })
        // Count matching customers based on conditions
        const cond = conditions || {}
        const customerWhere: any = {}
        if (cond.minPurchases) customerWhere.totalPurchases = { gte: Number(cond.minPurchases) }
        if (cond.minOrders) customerWhere.totalOrders = { gte: Number(cond.minOrders) }
        if (cond.tier) customerWhere.tier = cond.tier
        const customerCount = await prisma.customer.count({ where: customerWhere })

        const data = await prisma.customerSegment.create({
            data: { name, description, conditions: JSON.stringify(conditions || {}), customerCount, color: color || '#6b7280' },
        })
        res.status(201).json({ success: true, data: { ...data, conditions: JSON.parse(data.conditions) } })
    } catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// PUT /api/segments/:id
router.put('/:id', authMiddleware, async (req: Request, res: Response) => {
    try {
        const { name, description, conditions, color } = req.body
        const d: any = {}
        if (name) d.name = name; if (description !== undefined) d.description = description
        if (conditions) d.conditions = JSON.stringify(conditions); if (color) d.color = color
        const data = await prisma.customerSegment.update({ where: { id: req.params.id }, data: d })
        res.json({ success: true, data: { ...data, conditions: JSON.parse(data.conditions) } })
    } catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// DELETE /api/segments/:id
router.delete('/:id', authMiddleware, async (req: Request, res: Response) => {
    try { await prisma.customerSegment.delete({ where: { id: req.params.id } }); res.json({ success: true }) }
    catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

export default router
