import { Router, Request, Response } from 'express'
import prisma from '../lib/prisma'
import { authMiddleware } from '../middleware/auth'

const router = Router()

// GET /api/notifications
router.get('/', authMiddleware, async (req: Request, res: Response) => {
    try {
        const { type } = req.query
        const where: any = {}
        if (type && type !== 'all') where.type = type
        const notifications = await prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, take: 100 })
        const unreadCount = await prisma.notification.count({ where: { read: false } })
        res.json({ success: true, data: notifications, unreadCount })
    } catch (err) {
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// POST /api/notifications
router.post('/', authMiddleware, async (req: Request, res: Response) => {
    try {
        const { title, message, type } = req.body
        if (!title?.trim()) return res.status(400).json({ success: false, error: 'Title required' })
        const notification = await prisma.notification.create({ data: { title, message: message || '', type: type || 'info' } })
        res.status(201).json({ success: true, data: notification })
    } catch (err) {
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// PUT /api/notifications/:id/read
router.put('/:id/read', authMiddleware, async (req: Request, res: Response) => {
    try {
        const n = await prisma.notification.update({ where: { id: req.params.id }, data: { read: true } })
        res.json({ success: true, data: n })
    } catch (err) {
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// PUT /api/notifications/read-all
router.put('/read-all', authMiddleware, async (_req: Request, res: Response) => {
    try {
        await prisma.notification.updateMany({ where: { read: false }, data: { read: true } })
        res.json({ success: true })
    } catch (err) {
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// DELETE /api/notifications/:id
router.delete('/:id', authMiddleware, async (req: Request, res: Response) => {
    try {
        await prisma.notification.delete({ where: { id: req.params.id } })
        res.json({ success: true })
    } catch (err) {
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

export default router
