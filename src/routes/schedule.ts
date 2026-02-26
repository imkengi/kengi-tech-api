import { Router, Request, Response } from 'express'
import prisma from '../lib/prisma'
import { authMiddleware } from '../middleware/auth'

const router = Router()

// GET /api/schedule
router.get('/', authMiddleware, async (req: Request, res: Response) => {
    try {
        const { userId, date, shift } = req.query
        const where: any = {}
        if (userId) where.userId = userId
        if (shift && shift !== 'all') where.shift = shift
        if (date) {
            const d = new Date(String(date))
            const start = new Date(d); start.setHours(0, 0, 0, 0)
            const end = new Date(d); end.setHours(23, 59, 59, 999)
            where.date = { gte: start, lte: end }
        }
        const data = await prisma.schedule.findMany({ where, orderBy: { date: 'desc' } })
        res.json({ success: true, data })
    } catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// POST /api/schedule
router.post('/', authMiddleware, async (req: Request, res: Response) => {
    try {
        const { userId, userName, date, shift, notes } = req.body
        if (!userName?.trim() || !date || !shift) return res.status(400).json({ success: false, error: 'Employee, date and shift required' })
        const data = await prisma.schedule.create({ data: { userId, userName, date: new Date(date), shift, notes } })
        res.status(201).json({ success: true, data })
    } catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// PUT /api/schedule/:id
router.put('/:id', authMiddleware, async (req: Request, res: Response) => {
    try {
        const { status, shift, notes } = req.body
        const data = await prisma.schedule.update({ where: { id: req.params.id }, data: { ...(status && { status }), ...(shift && { shift }), ...(notes !== undefined && { notes }) } })
        res.json({ success: true, data })
    } catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// DELETE /api/schedule/:id
router.delete('/:id', authMiddleware, async (req: Request, res: Response) => {
    try { await prisma.schedule.delete({ where: { id: req.params.id } }); res.json({ success: true }) }
    catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

export default router
