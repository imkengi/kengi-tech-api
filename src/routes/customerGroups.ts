import { Router, Request, Response } from 'express'
import { authMiddleware, getBranchFilter, AuthRequest } from '../middleware/auth'
import { cacheGet, cacheSet, cacheDel } from '../lib/cache'

const router = Router()

// GET /api/customer-groups
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const schema = req.user?.storeSchema || 'default'
        const cacheKey = `${schema}:customerGroups:${JSON.stringify(req.query)}`
        const cached = await cacheGet(cacheKey)
        if (cached) return res.json(cached)
        const prisma = req.storePrisma!
        const groups = await prisma.customerGroup.findMany({
            include: { _count: { select: { customers: true } } },
            orderBy: { name: 'asc' },
        })
        const _response = { success: true, data: groups }
        await cacheSet(cacheKey, _response, 300)
        res.json(_response)
    } catch (err) {
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// POST /api/customer-groups
router.post('/', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { name, discount, color } = req.body
        if (!name?.trim()) return res.status(400).json({ success: false, error: 'Group name required' })
        const group = await prisma.customerGroup.create({
            data: { name: name.trim(), discount: Number(discount) || 0, color: color || '#6366f1' }
        })
        cacheDel(`${req.user?.storeSchema || 'default'}:customerGroups:*`).catch(() => {})
        res.status(201).json({ success: true, data: group })
    } catch (err) {
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// PUT /api/customer-groups/:id
router.put('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { name, discount, color } = req.body
        const group = await prisma.customerGroup.update({
            where: { id: String(req.params.id) },
            data: { name, discount: Number(discount) || 0, color },
        })
        res.json({ success: true, data: group })
    } catch (err) {
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// DELETE /api/customer-groups/:id
router.delete('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        await prisma.customerGroup.delete({ where: { id: String(req.params.id) } })
        res.json({ success: true })
    } catch (err) {
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

export default router
