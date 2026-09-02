import { Router, Response } from 'express'
import { authMiddleware, AuthRequest, getBranchFilter } from '../middleware/auth'
import { cacheGet, cacheSet } from '../lib/cache'
import { getDashboardStats, getRevenueByDays, getTopProducts, getRecentActivity, DashboardPeriod } from '../lib/queries'
import { tinhViecCanLam } from '../lib/viecCanLam'

const router = Router()

const VALID_PERIODS: DashboardPeriod[] = ['today', '7days', 'thisMonth', 'lastMonth', 'thisYear']

// ─── GET /api/dashboard/viec-can-lam ────────────────────────────────────────
// Bảng "Việc cần xử lý ngay" ở trang Tổng Quan. Luật gom nằm ở lib/viecCanLam
// để tool MCP dùng CHUNG một bộ luật với web.
router.get('/viec-can-lam', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const schema = req.user?.storeSchema || 'unknown'
        const cacheBranch = req.user?.isMainBranch ? 'all' : (req.user?.branchId || 'none')
        const cacheKey = `${schema}:${cacheBranch}:dashboard:viec-can-lam`
        // ?fresh=1 = người dùng bấm Làm mới — bỏ cache đọc nhưng vẫn ghi lại bản mới
        const cached = req.query.fresh === '1' ? null : await cacheGet(cacheKey)
        if (cached) return res.json({ success: true, data: cached, source: 'cache' })

        const data = await tinhViecCanLam(req.storePrisma!, { branchFilter: getBranchFilter(req) })
        await cacheSet(cacheKey, data, 120)
        res.json({ success: true, data, source: 'prisma' })
    } catch (err) {
        console.error('Get viec-can-lam error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ─── GET /api/dashboard/stats ───────────────────────────────────────────────
router.get('/stats', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const schema = req.user?.storeSchema || 'unknown'
        const branchFilter = getBranchFilter(req)
        // Cache key derived from JWT, never client headers — prevents cross-branch
        // cache poisoning by clients that spoof x-branch-id.
        const cacheBranch = req.user?.isMainBranch ? 'all' : (req.user?.branchId || 'none')
        const period = (VALID_PERIODS.includes(req.query.period as DashboardPeriod)
            ? req.query.period : 'thisMonth') as DashboardPeriod

        const cacheKey = `${schema}:${cacheBranch}:dashboard:stats:${period}`
        /* ?fresh=1 = người dùng BẤM Làm mới — bỏ qua cache đọc nhưng vẫn ghi lại
         * bản mới cho người sau. Không có đường này thì nút Làm mới chỉ làm mới
         * được phía trình duyệt, còn máy chủ vẫn trả số cũ tới hết TTL. */
        const cached = req.query.fresh === '1' ? null : await cacheGet(cacheKey)
        if (cached) return res.json({ success: true, source: 'cache', data: cached })

        const stats = await getDashboardStats(prisma, branchFilter, period)

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
        const cacheBranch = req.user?.isMainBranch ? 'all' : (req.user?.branchId || 'none')
        const days = Math.min(90, Math.max(1, parseInt(req.query.days as string) || 7))

        const cacheKey = `${schema}:${cacheBranch}:dashboard:revenue:${days}`
        /* ?fresh=1 = người dùng BẤM Làm mới — bỏ qua cache đọc nhưng vẫn ghi lại
         * bản mới cho người sau. Không có đường này thì nút Làm mới chỉ làm mới
         * được phía trình duyệt, còn máy chủ vẫn trả số cũ tới hết TTL. */
        const cached = req.query.fresh === '1' ? null : await cacheGet(cacheKey)
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
        /* ?fresh=1 = người dùng BẤM Làm mới — bỏ qua cache đọc nhưng vẫn ghi lại
         * bản mới cho người sau. Không có đường này thì nút Làm mới chỉ làm mới
         * được phía trình duyệt, còn máy chủ vẫn trả số cũ tới hết TTL. */
        const cached = req.query.fresh === '1' ? null : await cacheGet(cacheKey)
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
        const cacheBranch = req.user?.isMainBranch ? 'all' : (req.user?.branchId || 'none')
        const cacheKey = `${schema}:${cacheBranch}:dashboard:recent-activity`
        /* ?fresh=1 = người dùng BẤM Làm mới — bỏ qua cache đọc nhưng vẫn ghi lại
         * bản mới cho người sau. Không có đường này thì nút Làm mới chỉ làm mới
         * được phía trình duyệt, còn máy chủ vẫn trả số cũ tới hết TTL. */
        const cached = req.query.fresh === '1' ? null : await cacheGet(cacheKey)
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
