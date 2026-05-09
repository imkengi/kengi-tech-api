import { Router, Request, Response } from 'express'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { cacheGet, cacheSet, cacheDel } from '../lib/cache'

const router = Router()

// Helper: safe user select
const userSelect = { id: true, name: true, code: true, avatar: true, role: true }

// ─── GET /api/sales-tracking — List checkin/checkout records ─────────────────
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const schema = req.user?.storeSchema || 'default'
        const cacheKey = `${schema}:salesTracking:${JSON.stringify(req.query)}`
        const cached = await cacheGet(cacheKey)
        if (cached) return res.json(cached)
        const prisma = req.storePrisma!

        const { userId, from, to, type } = req.query
        const where: any = {}
        if (userId) where.userId = String(userId)
        if (type) where.type = String(type)
        if (from || to) {
            where.createdAt = {}
            if (from) where.createdAt.gte = new Date(String(from) + 'T00:00:00')
            if (to) where.createdAt.lte = new Date(String(to) + 'T23:59:59')
        }

        const records = await prisma.salesCheckin.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            include: {
                user: { select: userSelect },
                customer: { select: { id: true, name: true, code: true, phone: true, address: true } },
            },
        })
        const _response = { success: true, data: records }
        await cacheSet(cacheKey, _response, 300)
        res.json(_response)
    } catch (err: any) {
        console.error('Sales tracking list error:', err)
        res.status(500).json({ success: false, error: 'Internal server error', detail: err?.message })
    }
})

// ─── GET /api/sales-tracking/active — Currently checked-in staff ────────────
router.get('/active', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!

        const today = new Date()
        today.setHours(0, 0, 0, 0)
        const tomorrow = new Date(today)
        tomorrow.setDate(tomorrow.getDate() + 1)

        // Get today's records
        const todayRecords = await prisma.salesCheckin.findMany({
            where: { createdAt: { gte: today, lt: tomorrow } },
            orderBy: { createdAt: 'desc' },
            include: { user: { select: userSelect } },
        })

        // Build active staff: users whose LAST record today is a checkin
        const userLastRecord = new Map<string, any>()
        for (const r of todayRecords) {
            if (!userLastRecord.has(r.userId)) {
                userLastRecord.set(r.userId, r)
            }
        }

        const activeStaff: any[] = []
        for (const [, record] of userLastRecord) {
            if (record.type === 'checkin') {
                activeStaff.push({
                    id: record.userId,
                    name: record.user?.name || 'N/A',
                    code: record.user?.code || '',
                    avatar: record.user?.avatar || null,
                    role: record.user?.role || '',
                    lastCheckin: record,
                })
            }
        }

        res.json({ success: true, data: activeStaff })
    } catch (err: any) {
        console.error('Active staff error:', err)
        res.status(500).json({ success: false, error: 'Internal server error', detail: err?.message })
    }
})

// ─── GET /api/sales-tracking/stats — Daily KPIs ─────────────────────────────
router.get('/stats', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!

        const dateStr = req.query.date ? String(req.query.date) : new Date().toISOString().split('T')[0]
        const dayStart = new Date(dateStr + 'T00:00:00')
        const dayEnd = new Date(dateStr + 'T23:59:59')

        const todayRecords = await prisma.salesCheckin.findMany({
            where: { createdAt: { gte: dayStart, lte: dayEnd } },
            orderBy: { createdAt: 'asc' },
        })

        const checkins = todayRecords.filter(r => r.type === 'checkin')
        const checkouts = todayRecords.filter(r => r.type === 'checkout')

        // Total hours
        let totalMinutes = 0
        const userRecords = new Map<string, typeof todayRecords>()
        todayRecords.forEach(r => {
            if (!userRecords.has(r.userId)) userRecords.set(r.userId, [])
            userRecords.get(r.userId)!.push(r)
        })
        for (const [, recs] of userRecords) {
            for (let i = 0; i < recs.length; i++) {
                if (recs[i].type === 'checkin') {
                    const co = recs.find((r, j) => j > i && r.type === 'checkout')
                    if (co) totalMinutes += (co.createdAt.getTime() - recs[i].createdAt.getTime()) / 60000
                }
            }
        }

        // Unique employees who checked in today
        const checkedInUserIds = new Set(checkins.map(r => r.userId))

        // Total active SALES employees only (sales + cashier roles)
        const allActiveEmployees = await prisma.user.findMany({
            where: { employeeStatus: 'active', role: { in: ['sales', 'cashier'] } },
            select: { id: true, name: true, code: true },
        })
        const uncheckedIn = allActiveEmployees.filter(e => !checkedInUserIds.has(e.id))

        // Currently active (checked in but not out)
        let currentlyActive = 0
        for (const [, recs] of userRecords) {
            const last = recs[recs.length - 1]
            if (last && last.type === 'checkin') currentlyActive++
        }

        // Unique customers visited
        const uniqueCustomers = new Set(checkins.filter(r => r.customerId).map(r => r.customerId)).size

        res.json({
            success: true,
            data: {
                totalCheckins: checkins.length,
                totalCheckouts: checkouts.length,
                currentlyActive,
                totalHours: Math.round(totalMinutes / 60 * 10) / 10,
                totalEmployees: allActiveEmployees.length,
                checkedInCount: checkedInUserIds.size,
                uncheckedIn,
                uniqueCustomers,
            },
        })
    } catch (err: any) {
        console.error('Stats error:', err)
        res.status(500).json({ success: false, error: 'Internal server error', detail: err?.message })
    }
})

// ─── GET /api/sales-tracking/leaderboard — Top performers ───────────────────
router.get('/leaderboard', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!

        const days = Number(req.query.days) || 7
        const startDate = new Date()
        startDate.setDate(startDate.getDate() - days)
        startDate.setHours(0, 0, 0, 0)

        const records = await prisma.salesCheckin.findMany({
            where: { createdAt: { gte: startDate } },
            orderBy: { createdAt: 'asc' },
            include: { user: { select: userSelect } },
        })

        const userMap = new Map<string, {
            id: string; name: string; code: string; avatar: string | null
            checkins: number; totalMinutes: number; customerSet: Set<string>
            records: typeof records
        }>()

        for (const r of records) {
            if (!userMap.has(r.userId)) {
                userMap.set(r.userId, {
                    id: r.userId,
                    name: r.user?.name || 'N/A',
                    code: r.user?.code || '',
                    avatar: r.user?.avatar || null,
                    checkins: 0,
                    totalMinutes: 0,
                    customerSet: new Set(),
                    records: [],
                })
            }
            const u = userMap.get(r.userId)!
            u.records.push(r)
            if (r.type === 'checkin') {
                u.checkins++
                if (r.customerId) u.customerSet.add(r.customerId)
            }
        }

        // Calculate hours per user
        for (const [, u] of userMap) {
            for (let i = 0; i < u.records.length; i++) {
                if (u.records[i].type === 'checkin') {
                    const co = u.records.find((r, j) => j > i && r.type === 'checkout')
                    if (co) u.totalMinutes += (co.createdAt.getTime() - u.records[i].createdAt.getTime()) / 60000
                }
            }
        }

        const leaderboard = Array.from(userMap.values())
            .map(u => ({
                id: u.id,
                name: u.name,
                code: u.code,
                avatar: u.avatar,
                checkins: u.checkins,
                hours: Math.round(u.totalMinutes / 60 * 10) / 10,
                customers: u.customerSet.size,
            }))
            .sort((a, b) => b.checkins - a.checkins)
            .slice(0, 10)

        res.json({ success: true, data: leaderboard })
    } catch (err: any) {
        console.error('Leaderboard error:', err)
        res.status(500).json({ success: false, error: 'Internal server error', detail: err?.message })
    }
})

// ─── GET /api/sales-tracking/:userId/history — User's history ───────────────
router.get('/:userId/history', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!

        const records = await prisma.salesCheckin.findMany({
            where: { userId: String(req.params.userId) },
            orderBy: { createdAt: 'desc' },
            take: 50,
            include: {
                customer: { select: { id: true, name: true, code: true } },
            },
        })

        // Today hours
        const today = new Date()
        today.setHours(0, 0, 0, 0)
        const todayRecs = records
            .filter(r => r.createdAt >= today)
            .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        let todayMinutes = 0
        for (let i = 0; i < todayRecs.length; i++) {
            if (todayRecs[i].type === 'checkin') {
                const co = todayRecs.find((r, j) => j > i && r.type === 'checkout')
                if (co) todayMinutes += (co.createdAt.getTime() - todayRecs[i].createdAt.getTime()) / 60000
            }
        }

        res.json({ success: true, data: records, todayHours: Math.round(todayMinutes / 60 * 10) / 10 })
    } catch (err: any) {
        console.error('User history error:', err)
        res.status(500).json({ success: false, error: 'Internal server error', detail: err?.message })
    }
})

// ─── POST /api/sales-tracking/checkin — Check in ────────────────────────────
router.post('/checkin', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!

        const currentUser = (req as any).user
        const { latitude, longitude, address, note, customerId, customerName } = req.body

        if (!latitude || !longitude) {
            return res.status(400).json({ success: false, error: 'Cần vị trí GPS' })
        }

        const record = await prisma.salesCheckin.create({
            data: {
                userId: currentUser.userId,
                type: 'checkin',
                latitude: Number(latitude),
                longitude: Number(longitude),
                address: address || null,
                note: note || null,
                customerId: customerId || null,
                customerName: customerName || null,
            },
            include: {
                user: { select: userSelect },
                customer: { select: { id: true, name: true, code: true } },
            },
        })

        cacheDel(`${req.user?.storeSchema || 'default'}:salesTracking:*`).catch(() => {})
        res.status(201).json({ success: true, data: record })
    } catch (err: any) {
        console.error('Checkin error:', err)
        res.status(500).json({ success: false, error: 'Internal server error', detail: err?.message })
    }
})

// ─── POST /api/sales-tracking/checkout — Check out ──────────────────────────
router.post('/checkout', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!

        const currentUser = (req as any).user
        const { latitude, longitude, address, note } = req.body

        if (!latitude || !longitude) {
            return res.status(400).json({ success: false, error: 'Cần vị trí GPS' })
        }

        // Find last checkin today
        const today = new Date()
        today.setHours(0, 0, 0, 0)
        const lastCheckin = await prisma.salesCheckin.findFirst({
            where: {
                userId: currentUser.userId,
                type: 'checkin',
                createdAt: { gte: today },
            },
            orderBy: { createdAt: 'desc' },
        })

        const record = await prisma.salesCheckin.create({
            data: {
                userId: currentUser.userId,
                type: 'checkout',
                latitude: Number(latitude),
                longitude: Number(longitude),
                address: address || null,
                note: note || null,
            },
            include: {
                user: { select: userSelect },
            },
        })

        // Calculate session duration
        let sessionDuration = 0
        if (lastCheckin) {
            sessionDuration = Math.round((record.createdAt.getTime() - lastCheckin.createdAt.getTime()) / 60000)
        }

        cacheDel(`${req.user?.storeSchema || 'default'}:salesTracking:*`).catch(() => {})
        res.status(201).json({ success: true, data: record, sessionDuration })
    } catch (err: any) {
        console.error('Checkout error:', err)
        res.status(500).json({ success: false, error: 'Internal server error', detail: err?.message })
    }
})

export default router