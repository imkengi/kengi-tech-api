import { Router, Request, Response } from 'express'
import { authMiddleware, getBranchFilter, AuthRequest, getBranchId } from '../middleware/auth'
import { cacheGet, cacheSet, cacheDel } from '../lib/cache'

const router = Router()

// GET /api/feedback/stats
router.get('/stats', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const all = await prisma.feedback.findMany()
        const total = all.length
        const replied = all.filter((f: any) => f.status === 'replied' || f.response).length
        const pending = total - replied
        const rated = all.filter((f: any) => f.rating != null)
        const avgRating = rated.length > 0 ? Math.round(rated.reduce((s: number, f: any) => s + f.rating, 0) / rated.length * 10) / 10 : 0
        const byRating: Record<string, number> = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 }
        rated.forEach((f: any) => { const r = Math.min(5, Math.max(1, Math.round(f.rating))); byRating[String(r)]++ })
        const responseRate = total > 0 ? Math.round((replied / total) * 100) : 0
        res.json({ success: true, data: { total, replied, pending, avgRating, responseRate, byRating } })
    } catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// GET /api/feedback
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const schema = req.user?.storeSchema || 'default'
        const cacheKey = `${schema}:feedback:${JSON.stringify(req.query)}`
        const cached = await cacheGet(cacheKey)
        if (cached) return res.json(cached)
        const prisma = req.storePrisma!
        const { search, type, status } = req.query
        const where: any = {}
        if (type && type !== 'all') where.type = type
        if (status && status !== 'all') where.status = status
        if (search) { const q = String(search); where.OR = [{ message: { contains: q } }, { customerName: { contains: q } }] }
        const data = await prisma.feedback.findMany({ where, orderBy: { createdAt: 'desc' } })
        const _response = { success: true, data }
        await cacheSet(cacheKey, _response, 300)
        res.json(_response)
    } catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// POST /api/feedback
router.post('/', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { customerName, customerPhone, type, rating, message } = req.body
        if (!message?.trim()) return res.status(400).json({ success: false, error: 'Message required' })
        const data = await prisma.feedback.create({ data: { customerName, customerPhone, type: type || 'general', rating: rating ? Number(rating) : null, message } })
        cacheDel(`${req.user?.storeSchema || 'default'}:feedback:*`).catch(() => { })
        res.status(201).json({ success: true, data })
    } catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// PUT /api/feedback/:id
router.put('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { status, response } = req.body
        const data = await prisma.feedback.update({ where: { id: String(req.params.id) }, data: { ...(status && { status }), ...(response !== undefined && { response }) } })
        res.json({ success: true, data })
    } catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// DELETE /api/feedback/:id
router.delete('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        await prisma.feedback.delete({ where: { id: String(req.params.id) } }); res.json({ success: true })
    }
    catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

export default router
