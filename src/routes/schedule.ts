import { Router, Request, Response } from 'express'
import { authMiddleware, getBranchFilter, AuthRequest, getBranchId } from '../middleware/auth'
import { validate } from '../middleware/validate'
import { CreateScheduleSchema, UpdateScheduleSchema } from '../schemas'
import { cacheGet, cacheSet, cacheDel } from '../lib/cache'

const router = Router()

// GET /api/schedule
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const schema = req.user?.storeSchema || 'default'
        const cacheKey = `${schema}:schedule:${JSON.stringify(req.query)}`
        const cached = await cacheGet(cacheKey)
        if (cached) return res.json(cached)
        const prisma = req.storePrisma!
        const branchId = getBranchId(req)
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
        const _response = { success: true, data }
        await cacheSet(cacheKey, _response, 120)
        res.json(_response)
    } catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// POST /api/schedule
router.post('/', authMiddleware, validate(CreateScheduleSchema), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const branchId = getBranchId(req)
        const { userId, userName, date, shift, notes } = req.body
        if (!userName?.trim() || !date || !shift) return res.status(400).json({ success: false, error: 'Employee, date and shift required' })
        const data = await prisma.schedule.create({ data: { userId, userName, date: new Date(date), shift, notes } })
        cacheDel(`${req.user?.storeSchema || 'default'}:schedule:*`).catch(() => {})
        res.status(201).json({ success: true, data })
    } catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// PUT /api/schedule/:id
router.put('/:id', authMiddleware, validate(UpdateScheduleSchema), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const branchId = getBranchId(req)
        const { status, shift, notes } = req.body
        const schId = String(req.params.id)
        const data = await prisma.schedule.update({ where: { id: schId }, data: { ...(status && { status }), ...(shift && { shift }), ...(notes !== undefined && { notes }) } })
        res.json({ success: true, data })
    } catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// DELETE /api/schedule/:id
router.delete('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const branchId = getBranchId(req)
        await prisma.schedule.delete({ where: { id: String(req.params.id) } }); res.json({ success: true })
    }
    catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

export default router
