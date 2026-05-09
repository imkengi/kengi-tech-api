import { Router, Response } from 'express'
import { authMiddleware, AuthRequest, getBranchFilter } from '../middleware/auth'
import { cacheGet, cacheSet } from '../lib/cache'
import { getDashboardStats, getRevenueByDays, getTopProducts, getRecentActivity } from '../lib/queries'

const router = Router()

// ─── GET /api/dashboard/stats ───────────────────────────────────────────────
router.get('/stats', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const schema = req.user?.storeSchema || 'unknown'
        const branchFilter = getBranchFilter(req)
        const branchId = req.headers['x-branch-id'] || 'all'

        const cacheKey = `${schema}:${branchId}:dashboard:stats`
        const cached = await cacheGet(cacheKey)
        if (cached) return res.json({ success: true, source: 'cache', data: cached })

        const stats = await getDashboardStats(prisma, branchFilter)

        await cacheSet(cacheKey, stats, 300)
        res.json({ success: true, source: 'prisma', data: stats })
    } catch (err) {
        console.error('Get dashboard stats error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ─── GET /api/dashboard/revenue?days=7 ──────────────────────────────────────
router.get('/revenue', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const schema = req.user?.storeSchema || 'unknown'
        const branchFilter = getBranchFilter(req)
        const branchId = req.headers['x-branch-id'] || 'all'
        const days = Math.min(90, Math.max(1, parseInt(req.query.days as string) || 7))

        const cacheKey = `${schema}:${branchId}:dashboard:revenue:${days}`
        const cached = await cacheGet(cacheKey)
        if (cached) return res.json({ success: true, data: cached, source: 'cache' })

        const data = await getRevenueByDays(prisma, days, branchFilter)

        await cacheSet(cacheKey, data, 300)
        res.json({ success: true, data, source: 'prisma' })
    } catch (err) {
        console.error('Get revenue data error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ─── GET /api/dashboard/top-products ────────────────────────────────────────
router.get('/top-products', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const schema = req.user?.storeSchema || 'unknown'

        const cacheKey = `${schema}:dashboard:top-products`
        const cached = await cacheGet(cacheKey)
        if (cached) return res.json({ success: true, data: cached, source: 'cache' })

        const data = await getTopProducts(prisma)

        await cacheSet(cacheKey, data, 300)
        res.json({ success: true, data })
    } catch (err) {
        console.error('Get top products error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ─── GET /api/dashboard/recent-activity ─────────────────────────────────────
router.get('/recent-activity', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const schema = req.user?.storeSchema || 'unknown'
        const branchFilter = getBranchFilter(req)
        const branchId = req.headers['x-branch-id'] || 'all'
        const cacheKey = `${schema}:${branchId}:dashboard:recent-activity`
        const cached = await cacheGet(cacheKey)
        if (cached) return res.json({ success: true, data: cached, source: 'cache' })

        const data = await getRecentActivity(prisma, 10, branchFilter)
        await cacheSet(cacheKey, data, 300)
        res.json({ success: true, data })
    } catch (err) {
        console.error('Get recent activity error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

export default router
