import { Router, Request, Response } from 'express'
import prisma from '../lib/prisma'
import { authMiddleware } from '../middleware/auth'

const router = Router()

// GET /api/repairs
router.get('/', authMiddleware, async (req: Request, res: Response) => {
    try {
        const { search, status } = req.query
        const where: any = {}
        if (status && status !== 'all') where.status = status
        if (search) {
            const q = String(search)
            where.OR = [{ productName: { contains: q } }, { customerName: { contains: q } }, { code: { contains: q } }]
        }
        const data = await prisma.repair.findMany({ where, orderBy: { createdAt: 'desc' } })
        res.json({ success: true, data })
    } catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// POST /api/repairs
router.post('/', authMiddleware, async (req: Request, res: Response) => {
    try {
        const { productName, customerName, customerPhone, issue, cost, estimatedDate, notes } = req.body
        if (!productName?.trim() || !issue?.trim()) return res.status(400).json({ success: false, error: 'Product name and issue required' })
        const count = await prisma.repair.count()
        const code = `RP-${String(count + 1).padStart(4, '0')}`
        const data = await prisma.repair.create({
            data: { code, productName, customerName: customerName || '', customerPhone, issue, cost: Number(cost) || 0, estimatedDate: estimatedDate ? new Date(estimatedDate) : null, notes },
        })
        res.status(201).json({ success: true, data })
    } catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// PUT /api/repairs/:id
router.put('/:id', authMiddleware, async (req: Request, res: Response) => {
    try {
        const { status, cost, notes, completedDate } = req.body
        const data: any = {}
        if (status) data.status = status
        if (cost !== undefined) data.cost = Number(cost)
        if (notes !== undefined) data.notes = notes
        if (status === 'done' || completedDate) data.completedDate = new Date()
        const result = await prisma.repair.update({ where: { id: req.params.id }, data })
        res.json({ success: true, data: result })
    } catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// DELETE /api/repairs/:id
router.delete('/:id', authMiddleware, async (req: Request, res: Response) => {
    try { await prisma.repair.delete({ where: { id: req.params.id } }); res.json({ success: true }) }
    catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

export default router
