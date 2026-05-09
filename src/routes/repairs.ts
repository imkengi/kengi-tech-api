import { Router, Request, Response } from 'express'
import { authMiddleware, getBranchFilter, AuthRequest, getBranchId } from '../middleware/auth'
import { validate } from '../middleware/validate'
import { CreateRepairSchema, UpdateRepairSchema } from '../schemas'

const router = Router()

// GET /api/repairs/stats
router.get('/stats', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const all = await prisma.repair.findMany({ select: { status: true, cost: true } })
        const byStatus: Record<string, number> = {}
        let totalRevenue = 0
        for (const r of all) { byStatus[r.status || 'received'] = (byStatus[r.status || 'received'] || 0) + 1; totalRevenue += r.cost }
        const avgCost = all.length > 0 ? Math.round(totalRevenue / all.length) : 0
        res.json({ success: true, data: { total: all.length, byStatus, totalRevenue, avgCost } })
    } catch { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// GET /api/repairs
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
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
router.post('/', authMiddleware, validate(CreateRepairSchema), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
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
router.put('/:id', authMiddleware, validate(UpdateRepairSchema), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { status, cost, notes, completedDate } = req.body
        const data: any = {}
        if (status) data.status = status
        if (cost !== undefined) data.cost = Number(cost)
        if (notes !== undefined) data.notes = notes
        if (status === 'done' || completedDate) data.completedDate = new Date()
        const result = await prisma.repair.update({ where: { id: String(req.params.id) }, data })
        res.json({ success: true, data: result })
    } catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// DELETE /api/repairs/:id
router.delete('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        await prisma.repair.delete({ where: { id: String(req.params.id) } }); res.json({ success: true })
    }
    catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

export default router
