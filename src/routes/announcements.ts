import { Router, Response } from 'express'
import { authMiddleware, getBranchId, AuthRequest } from '../middleware/auth'
import { validate } from '../middleware/validate'
import { CreateAnnouncementSchema, UpdateAnnouncementSchema } from '../schemas'
import { cacheGet, cacheSet, cacheDel } from '../lib/cache'

const router = Router()

// GET /api/announcements/stats
router.get('/stats', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const all = await prisma.announcement.findMany({ where: { archived: false } })
        const pinned = all.filter((a: any) => a.pinned).length
        const byPriority: Record<string, number> = { info: 0, warning: 0, urgent: 0, success: 0 }
        all.forEach((a: any) => { if (byPriority[a.priority] !== undefined) byPriority[a.priority]++ })
        const total = await prisma.announcement.count()
        const archived = await prisma.announcement.count({ where: { archived: true } })
        res.json({ success: true, data: { total, active: all.length, pinned, archived, byPriority } })
    } catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// GET /api/announcements
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const schema = req.user?.storeSchema || 'default'
        const cacheKey = `${schema}:announcements:${JSON.stringify(req.query)}`
        const cached = await cacheGet(cacheKey)
        if (cached) return res.json(cached)
        const prisma = req.storePrisma!
        const { search, priority, archived } = req.query
        const where: any = {}
        if (priority && priority !== 'all') where.priority = priority
        if (archived === 'true') where.archived = true
        else if (archived === 'false' || !archived) where.archived = false
        if (search) {
            const q = String(search)
            where.OR = [{ title: { contains: q } }, { content: { contains: q } }]
        }
        const data = await prisma.announcement.findMany({ where, orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }] })
        const _response = { success: true, data }
        await cacheSet(cacheKey, _response, 300)
        res.json(_response)
    } catch (err) {
        console.error('List announcements error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// POST /api/announcements
router.post('/', authMiddleware, validate(CreateAnnouncementSchema), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const branchId = getBranchId(req)
        const { title, content, priority, author } = req.body
        if (!title?.trim() || !content?.trim()) return res.status(400).json({ success: false, error: 'Title and content required' })
        const data = await prisma.announcement.create({
            data: { branchId, title: title.trim(), content: content.trim(), priority: priority || 'info', author: author || 'Admin' }
        })
        cacheDel(`${req.user?.storeSchema || 'default'}:announcements:*`).catch(() => { })
        res.status(201).json({ success: true, data })
    } catch (err) {
        console.error('Create announcement error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// PUT /api/announcements/:id
router.put('/:id', authMiddleware, validate(UpdateAnnouncementSchema), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const annId = String(req.params.id)
        const { title, content, priority, pinned, archived } = req.body
        const data = await prisma.announcement.update({
            where: { id: annId },
            data: {
                ...(title !== undefined && { title }),
                ...(content !== undefined && { content }),
                ...(priority !== undefined && { priority }),
                ...(pinned !== undefined && { pinned }),
                ...(archived !== undefined && { archived }),
            },
        })
        res.json({ success: true, data })
    } catch (err) {
        console.error('Update announcement error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// DELETE /api/announcements/:id
router.delete('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        await prisma.announcement.delete({ where: { id: String(req.params.id) } })
        res.json({ success: true })
    } catch (err) {
        console.error('Delete announcement error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

export default router
