import { Router, Request, Response } from 'express'
import { authMiddleware, getBranchFilter, AuthRequest, getBranchId } from '../middleware/auth'
import { cacheGet, cacheSet, cacheDel } from '../lib/cache'

const router = Router()

// GET /api/audit-logs
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const schema = req.user?.storeSchema || 'default'
        const cacheKey = `${schema}:auditLogs:${JSON.stringify(req.query)}`
        const cached = await cacheGet(cacheKey)
        if (cached) return res.json(cached)
        const prisma = req.storePrisma!
        const { search, action, entity } = req.query
        const where: any = {}
        if (action && action !== 'all') where.action = action
        if (entity && entity !== 'all') where.entity = entity
        if (search) {
            const q = String(search)
            where.OR = [
                { userName: { contains: q } },
                { details: { contains: q } },
                { entity: { contains: q } },
            ]
        }
        const data = await prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, take: 200 })
        const _response = { success: true, data }
        await cacheSet(cacheKey, _response, 60)
        res.json(_response)
    } catch (err) {
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// POST /api/audit-logs (internal — called from other routes or frontend)
router.post('/', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { userId, userName, action, entity, entityId, details, ipAddress } = req.body
        const data = await prisma.auditLog.create({ data: { userId, userName, action, entity, entityId, details, ipAddress }
        })
        cacheDel(`${req.user?.storeSchema || 'default'}:auditLogs:*`).catch(() => {})
        res.status(201).json({ success: true, data })
    } catch (err) {
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

export default router
