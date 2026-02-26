import { Router, Request, Response } from 'express'
import prisma from '../lib/prisma'
import { authMiddleware } from '../middleware/auth'

const router = Router()

// GET /api/feedback
router.get('/', authMiddleware, async (req: Request, res: Response) => {
    try {
        const { search, type, status } = req.query
        const where: any = {}
        if (type && type !== 'all') where.type = type
        if (status && status !== 'all') where.status = status
        if (search) { const q = String(search); where.OR = [{ message: { contains: q } }, { customerName: { contains: q } }] }
        const data = await prisma.feedback.findMany({ where, orderBy: { createdAt: 'desc' } })
        res.json({ success: true, data })
    } catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// POST /api/feedback
router.post('/', authMiddleware, async (req: Request, res: Response) => {
    try {
        const { customerName, customerPhone, type, rating, message } = req.body
        if (!message?.trim()) return res.status(400).json({ success: false, error: 'Message required' })
        const data = await prisma.feedback.create({ data: { customerName, customerPhone, type: type || 'general', rating: rating ? Number(rating) : null, message } })
        res.status(201).json({ success: true, data })
    } catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// PUT /api/feedback/:id
router.put('/:id', authMiddleware, async (req: Request, res: Response) => {
    try {
        const { status, response } = req.body
        const data = await prisma.feedback.update({ where: { id: req.params.id }, data: { ...(status && { status }), ...(response !== undefined && { response }) } })
        res.json({ success: true, data })
    } catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// DELETE /api/feedback/:id
router.delete('/:id', authMiddleware, async (req: Request, res: Response) => {
    try { await prisma.feedback.delete({ where: { id: req.params.id } }); res.json({ success: true }) }
    catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

export default router
