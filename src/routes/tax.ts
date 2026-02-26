import { Router, Request, Response } from 'express'
import prisma from '../lib/prisma'
import { authMiddleware } from '../middleware/auth'

const router = Router()

// GET /api/tax
router.get('/', authMiddleware, async (_req: Request, res: Response) => {
    try {
        const data = await prisma.taxConfig.findMany()
        res.json({ success: true, data })
    } catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// POST /api/tax
router.post('/', authMiddleware, async (req: Request, res: Response) => {
    try {
        const { name, rate, description, isDefault } = req.body
        if (!name?.trim()) return res.status(400).json({ success: false, error: 'Name required' })
        if (isDefault) await prisma.taxConfig.updateMany({ data: { isDefault: false } })
        const data = await prisma.taxConfig.create({ data: { name, rate: Number(rate) || 0, description, isDefault: isDefault || false } })
        res.status(201).json({ success: true, data })
    } catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// PUT /api/tax/:id
router.put('/:id', authMiddleware, async (req: Request, res: Response) => {
    try {
        const { name, rate, description, isDefault, status } = req.body
        if (isDefault) await prisma.taxConfig.updateMany({ data: { isDefault: false } })
        const data = await prisma.taxConfig.update({ where: { id: req.params.id }, data: { ...(name && { name }), ...(rate !== undefined && { rate: Number(rate) }), ...(description !== undefined && { description }), ...(isDefault !== undefined && { isDefault }), ...(status && { status }) } })
        res.json({ success: true, data })
    } catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// DELETE /api/tax/:id
router.delete('/:id', authMiddleware, async (req: Request, res: Response) => {
    try { await prisma.taxConfig.delete({ where: { id: req.params.id } }); res.json({ success: true }) }
    catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

export default router
