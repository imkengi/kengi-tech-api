import { Router, Request, Response } from 'express'
import prisma from '../lib/prisma'
import { authMiddleware } from '../middleware/auth'

const router = Router()

// GET /api/audit-logs
router.get('/', authMiddleware, async (req: Request, res: Response) => {
    try {
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
        res.json({ success: true, data })
    } catch (err) {
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// POST /api/audit-logs (internal — called from other routes or frontend)
router.post('/', authMiddleware, async (req: Request, res: Response) => {
    try {
        const { userId, userName, action, entity, entityId, details, ipAddress } = req.body
        const data = await prisma.auditLog.create({
            data: { userId, userName, action, entity, entityId, details, ipAddress }
        })
        res.status(201).json({ success: true, data })
    } catch (err) {
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

export default router
