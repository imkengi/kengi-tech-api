import { Router, Request, Response } from 'express'
import { authMiddleware, getBranchFilter, AuthRequest, getBranchId } from '../middleware/auth'
import { cacheGet, cacheSet, cacheDel } from '../lib/cache'

const router = Router()

// GET /api/segments
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const schema = req.user?.storeSchema || 'default'
        const cacheKey = `${schema}:segments:${JSON.stringify(req.query)}`
        const cached = await cacheGet(cacheKey)
        if (cached) return res.json(cached)
        const prisma = req.storePrisma!
        const data = await prisma.customerSegment.findMany({ orderBy: { createdAt: 'desc' } })
        const parsed = data.map(s => ({ ...s, conditions: JSON.parse(s.conditions || '{}') }))
        const _response = { success: true, data: parsed }
        await cacheSet(cacheKey, _response, 120)
        res.json(_response)
    } catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// POST /api/segments
router.post('/', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { name, description, conditions, color } = req.body
        if (!name?.trim()) return res.status(400).json({ success: false, error: 'Name required' })
        // Count matching customers based on conditions
        const cond = conditions || {}
        const customerWhere: any = {}
        if (cond.minPurchases) customerWhere.totalPurchases = { gte: Number(cond.minPurchases) }
        if (cond.minOrders) customerWhere.totalOrders = { gte: Number(cond.minOrders) }
        if (cond.tier) customerWhere.tier = cond.tier
        const customerCount = await prisma.customer.count({ where: customerWhere })

        const data = await prisma.customerSegment.create({ data: { name, description, conditions: JSON.stringify(conditions || {}), customerCount, color: color || '#6b7280' },
        })
        cacheDel(`${req.user?.storeSchema || 'default'}:segments:*`).catch(() => {})
        res.status(201).json({ success: true, data: { ...data, conditions: JSON.parse(data.conditions) } })
    } catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// PUT /api/segments/:id
router.put('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { name, description, conditions, color } = req.body
        const d: any = {}
        if (name) d.name = name; if (description !== undefined) d.description = description
        if (conditions) d.conditions = JSON.stringify(conditions); if (color) d.color = color
        const data = await prisma.customerSegment.update({ where: { id: String(req.params.id) }, data: d })
        res.json({ success: true, data: { ...data, conditions: JSON.parse(data.conditions) } })
    } catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// DELETE /api/segments/:id
router.delete('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        await prisma.customerSegment.delete({ where: { id: String(req.params.id) } }); res.json({ success: true }) }
    catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

export default router
