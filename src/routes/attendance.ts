import { Router, Response } from 'express'
import { authMiddleware, getBranchId, AuthRequest } from '../middleware/auth'
import { cacheGet, cacheSet, cacheDel } from '../lib/cache'

const router = Router()

// GET /api/attendance
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const schema = req.user?.storeSchema || 'default'
        const cacheKey = `${schema}:attendance:${JSON.stringify(req.query)}`
        const cached = await cacheGet(cacheKey)
        if (cached) return res.json(cached)
        const prisma = req.storePrisma!
        const { userId, date, status } = req.query
        const where: any = {}
        if (userId) where.userId = userId
        if (status && status !== 'all') where.status = status
        if (date) {
            const d = new Date(String(date))
            const start = new Date(d); start.setHours(0, 0, 0, 0)
            const end = new Date(d); end.setHours(23, 59, 59, 999)
            where.date = { gte: start, lte: end }
        }
        const data = await prisma.attendance.findMany({ where, orderBy: { date: 'desc' } })
        const _response = { success: true, data }
        await cacheSet(cacheKey, _response, 60)
        res.json(_response)
    } catch (err) {
        console.error('List attendance error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// POST /api/attendance — Check in
router.post('/', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const branchId = getBranchId(req)
        const { userId, userName, role, date, note } = req.body
        if (!userId || !userName) return res.status(400).json({ success: false, error: 'userId and userName required' })
        const checkDate = date ? new Date(date) : new Date()
        const now = new Date()
        const data = await prisma.attendance.create({
            data: { branchId, userId, userName, role: role || null,
                date: checkDate, checkIn: now, status: 'present', note: note || null,
            }
        })
        cacheDel(`${req.user?.storeSchema || 'default'}:attendance:*`).catch(() => {})
        res.status(201).json({ success: true, data })
    } catch (err) {
        console.error('Create attendance error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// PUT /api/attendance/:id — Update (check-out, status change)
router.put('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { checkOut, status, note } = req.body
        const updateData: any = {}
        if (checkOut) updateData.checkOut = new Date(checkOut)
        if (status) updateData.status = status
        if (note !== undefined) updateData.note = note
        const data = await prisma.attendance.update({ where: { id: String(req.params.id) }, data: updateData })
        res.json({ success: true, data })
    } catch (err) {
        console.error('Update attendance error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// DELETE /api/attendance/:id
router.delete('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        await prisma.attendance.delete({ where: { id: String(req.params.id) } })
        res.json({ success: true })
    } catch (err) {
        console.error('Delete attendance error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

export default router
