import { Router, Response, NextFunction } from 'express'
import { errMsg } from '../lib/errorResponse'
import { authMiddleware, AuthRequest, getBranchFilter } from '../middleware/auth'
import { requirePermission } from '../middleware/permissionMiddleware'
import { nextCode } from '../lib/codeGenerator'
import { reverseOnlineOrderEffects, isReversalStatus } from '../services/onlineOrderReversal'
import { adjustSellableStock } from '../lib/warehouseHelper'
import { registryPrisma, mapWithConcurrency } from '../lib/prisma'
import { computeOrderProfits } from '../lib/onlineOrderProfit'

const router = Router()

// Bật cờ registry để autoSync/cleanup CHỈ chạm store có kênh online (tránh quét toàn bộ)
function markHasOnlineChannels(schema?: string) {
    if (!schema) return
    ;(registryPrisma as any).store.updateMany({ where: { schema }, data: { hasOnlineChannels: true } }).catch(() => { })
}

// ═══════════════════════════════════════════════════════════════════════════════
//  ONLINE ORDER STATS
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/stats', authMiddleware, requirePermission('online_orders.view', 'orders.view'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { channelId, platform, startDate, endDate } = req.query
        const userRole = req.user?.role || 'cashier'
        const canSeeProfits = ['owner', 'admin'].includes(userRole)

        // Parse ngày an toàn — chuỗi rỗng/sai trả về Invalid Date làm Prisma throw → 500
        const parseDate = (v: any): Date | null => {
            if (!v) return null
            const d = new Date(String(v))
            return isNaN(d.getTime()) ? null : d
        }

        // WHERE dựng bằng tham số $n — KHÔNG nội suy chuỗi vào SQL.
        const conds: string[] = []
        const params: any[] = []
        const addCond = (sql: string, value: any) => {
            params.push(value)
            conds.push(sql.replace('?', `$${params.length}`))
        }
        // Lọc theo kênh: ưu tiên channelId (1 shop cụ thể), hoặc platform (cả sàn)
        if (channelId && channelId !== 'all') addCond('"channelId" = ?', channelId as string)
        if (platform && platform !== 'all') addCond('"platform" = ?', platform as string)
        const gte = parseDate(startDate)
        const lte = parseDate(endDate)
        if (gte) addCond('"createdAt" >= ?', gte)
        if (lte) addCond('"createdAt" <= ?', lte)
        const whereSql = conds.length ? `WHERE ${conds.join(' AND ')}` : ''

        // MỘT câu GROUP BY (status, platform) thay cho 4 query Prisma song song.
        // Lý do: pool per-store chỉ 3 kết nối (PRISMA_POOL_SIZE) — Promise.all 4 query
        // vừa xếp hàng chờ pool vừa quét bảng OnlineOrder 4 lượt, khiến số đếm tab
        // trạng thái tải rất chậm. Số nhóm = trạng thái × sàn (vài chục dòng), mọi
        // con số phía dưới đều gộp lại được từ đây trong JS.
        const rows: any[] = await (prisma as any).$queryRawUnsafe(
            `SELECT "status", "platform",
                    COUNT(*)::int                          AS cnt,
                    COALESCE(SUM("total"), 0)::float8        AS total,
                    COALESCE(SUM("shippingFee"), 0)::float8  AS shipping_fee,
                    COALESCE(SUM("discount"), 0)::float8     AS discount,
                    COALESCE(SUM("platformFee"), 0)::float8  AS platform_fee,
                    COALESCE(SUM("netRevenue"), 0)::float8   AS net_revenue
             FROM "OnlineOrder"
             ${whereSql}
             GROUP BY "status", "platform"`,
            ...params
        )

        // Trạng thái hủy/hoàn — LOẠI khỏi doanh thu và số đếm doanh thu (đơn hủy
        // không phải doanh thu). byStatus/byChannel bên dưới vẫn giữ đầy đủ.
        const CANCELLED_STATUSES = new Set(['CANCELLED', 'IN_CANCEL', 'TO_RETURN', 'cancelled', 'cancelling', 'returned'])

        let totalOrders = 0
        const totals = { count: 0, total: 0, shippingFee: 0, discount: 0, platformFee: 0, netRevenue: 0 }
        const statusMap = new Map<string, { count: number; total: number }>()
        const platformMap = new Map<string | null, { count: number; total: number }>()

        for (const r of rows) {
            const cnt = Number(r.cnt) || 0
            const total = Number(r.total) || 0
            totalOrders += cnt

            if (!CANCELLED_STATUSES.has(r.status)) {
                totals.count += cnt
                totals.total += total
                totals.shippingFee += Number(r.shipping_fee) || 0
                totals.discount += Number(r.discount) || 0
                totals.platformFee += Number(r.platform_fee) || 0
                totals.netRevenue += Number(r.net_revenue) || 0
            }

            const s = statusMap.get(r.status)
            if (s) { s.count += cnt; s.total += total } else { statusMap.set(r.status, { count: cnt, total }) }

            const p = platformMap.get(r.platform)
            if (p) { p.count += cnt; p.total += total } else { platformMap.set(r.platform, { count: cnt, total }) }
        }

        const byStatus = [...statusMap.entries()].map(([status, v]) => ({ status, _count: v.count, _sum: { total: v.total } }))
        const byChannel = [...platformMap.entries()].map(([platform, v]) => ({ platform, _count: v.count, _sum: { total: v.total } }))

        // Helper: aggregate count for a status, covering both Shopee UPPERCASE and legacy lowercase
        const countFor = (...statuses: string[]) =>
            statuses.reduce((sum, s) => sum + (statusMap.get(s)?.count ?? 0), 0)

        // Group synonym statuses into their primary key for the donut chart so that
        // e.g. READY_TO_SHIP/AWAITING_SHIPMENT/confirmed collapse into one slice.
        const STATUS_GROUP: Record<string, string> = {
            'UNPAID': 'UNPAID', 'ON_HOLD': 'UNPAID', 'pending': 'UNPAID',
            'READY_TO_SHIP': 'READY_TO_SHIP', 'AWAITING_SHIPMENT': 'READY_TO_SHIP', 'confirmed': 'READY_TO_SHIP',
            'PROCESSED': 'PROCESSED', 'AWAITING_COLLECTION': 'PROCESSED', 'processing': 'PROCESSED',
            'SHIPPED': 'SHIPPED', 'IN_TRANSIT': 'SHIPPED', 'shipping': 'SHIPPED',
            'TO_CONFIRM_RECEIVE': 'TO_CONFIRM_RECEIVE', 'DELIVERED': 'TO_CONFIRM_RECEIVE', 'delivered': 'TO_CONFIRM_RECEIVE',
            'COMPLETED': 'COMPLETED', 'completed': 'COMPLETED',
            'IN_CANCEL': 'IN_CANCEL',
            'CANCELLED': 'CANCELLED', 'cancelled': 'CANCELLED',
            'TO_RETURN': 'TO_RETURN',
        }
        const grouped = new Map<string, { _count: number; _sum: { total: number } }>()
        for (const b of byStatus) {
            const key = STATUS_GROUP[b.status] || b.status
            const existing = grouped.get(key)
            if (existing) {
                existing._count += b._count
                existing._sum.total += (b._sum?.total || 0)
            } else {
                grouped.set(key, { _count: b._count, _sum: { total: b._sum?.total || 0 } })
            }
        }
        const groupedByStatus = [...grouped.entries()]
            .map(([status, data]) => ({ status, _count: data._count, _sum: data._sum }))
            .sort((a, b) => b._count - a._count)

        res.json({
            success: true,
            data: {
                totalOrders,
                // Số đơn tính doanh thu (đã loại hủy/hoàn) — totalOrders vẫn đếm mọi đơn
                revenueOrders: totals.count,
                totalRevenue: totals.total,
                totalShippingFee: totals.shippingFee,
                totalDiscount: totals.discount,
                totalPlatformFee: canSeeProfits ? totals.platformFee : undefined,
                totalNetRevenue: canSeeProfits ? totals.netRevenue : undefined,
                // Completion rate: gom cả COMPLETED và completed
                completionRate: totalOrders > 0 ? Math.round((countFor('COMPLETED', 'completed') / totalOrders) * 100) : 0,
                // Pending count (Chờ xử lý): only orders ready to process/ship, NOT unpaid orders
                pendingCount: countFor('READY_TO_SHIP', 'AWAITING_SHIPMENT', 'confirmed'),
                // Processing count (Đã xử lý): PROCESSED + processing
                processingCount: countFor('PROCESSED', 'processing'),
                // Shipping count: SHIPPED + shipping
                shippingCount: countFor('SHIPPED', 'shipping'),
                byStatus: groupedByStatus.map(s => ({ status: s.status, count: s._count, revenue: s._sum.total ?? 0 })),
                byChannel: byChannel.map(c => ({ platform: c.platform, count: c._count, revenue: c._sum.total ?? 0 })),
                canSeeProfits,
            },
        })
    } catch (err) {
        console.error('Get online order stats error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ═══════════════════════════════════════════════════════════════════════════════
//  ANALYTICS (daily revenue + top products)
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/stats/analytics', authMiddleware, requirePermission('online_orders.view', 'orders.view'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const days = parseInt(req.query.days as string) || 7
        const userRole = req.user?.role || 'cashier'
        const canSeeProfits = ['owner', 'admin'].includes(userRole)

        // Daily revenue for last N days
        const since = new Date()
        since.setDate(since.getDate() - days)
        since.setHours(0, 0, 0, 0)

        const orders = await prisma.onlineOrder.findMany({
            where: { createdAt: { gte: since } },
            select: { createdAt: true, total: true, platformFee: true, netRevenue: true, status: true },
        })

        // Group by day
        const dailyMap: Record<string, { date: string; orders: number; revenue: number; platformFee: number; netRevenue: number }> = {}
        for (let i = 0; i < days; i++) {
            const d = new Date()
            d.setDate(d.getDate() - (days - 1 - i))
            const key = d.toISOString().split('T')[0]
            dailyMap[key] = { date: key, orders: 0, revenue: 0, platformFee: 0, netRevenue: 0 }
        }
        for (const o of orders) {
            const key = o.createdAt.toISOString().split('T')[0]
            if (dailyMap[key]) {
                dailyMap[key].orders++
                dailyMap[key].revenue += o.total
                dailyMap[key].platformFee += o.platformFee || 0
                dailyMap[key].netRevenue += o.netRevenue || 0
            }
        }
        const dailyRevenue = Object.values(dailyMap)

        // Top selling products
        const topItems = await prisma.onlineOrderItem.groupBy({
            by: ['productName'] as const,
            _sum: { quantity: true, lineTotal: true },
            _count: true,
            orderBy: { _sum: { quantity: 'desc' } },
            take: 10,
        })

        res.json({
            success: true,
            data: {
                dailyRevenue: dailyRevenue.map(d => ({
                    ...d,
                    platformFee: canSeeProfits ? d.platformFee : undefined,
                    netRevenue: canSeeProfits ? d.netRevenue : undefined,
                })),
                topProducts: topItems.map(t => ({
                    productName: t.productName,
                    totalQuantity: t._sum.quantity ?? 0,
                    totalRevenue: t._sum.lineTotal ?? 0,
                    orderCount: t._count,
                })),
                canSeeProfits,
            },
        })
    } catch (err) {
        console.error('Get online analytics error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ═══════════════════════════════════════════════════════════════════════════════
//  CHANNELS CRUD
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/online-orders/channels
router.get('/channels', authMiddleware, requirePermission('online_orders.view', 'orders.view'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const channels = await prisma.onlineChannel.findMany({
            orderBy: { createdAt: 'desc' },
            include: { _count: { select: { orders: true } } },
        })
        res.json({ success: true, data: channels })
    } catch (err) {
        console.error('Get channels error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// POST /api/online-orders/channels
router.post('/channels', authMiddleware, requirePermission('online_orders.manage', 'orders.edit'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { name, platform, shopUrl, apiKey, apiSecret, accessToken, syncEnabled } = req.body

        if (!name || !platform) {
            res.status(400).json({ success: false, error: 'Tên và nền tảng là bắt buộc' })
            return
        }

        const channel = await prisma.onlineChannel.create({
            data: { name, platform, shopUrl, apiKey, apiSecret, accessToken, syncEnabled: syncEnabled ?? false },
        })
        markHasOnlineChannels(req.user?.storeSchema)

        res.json({ success: true, data: channel })
    } catch (err) {
        console.error('Create channel error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// PUT /api/online-orders/channels/:id
router.put('/channels/:id', authMiddleware, requirePermission('online_orders.manage', 'orders.edit'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { id } = req.params
        const { name, platform, status, shopUrl, apiKey, apiSecret, accessToken, syncEnabled } = req.body

        const data: any = {}
        if (name !== undefined) data.name = name
        if (platform !== undefined) data.platform = platform
        if (status !== undefined) data.status = status
        if (shopUrl !== undefined) data.shopUrl = shopUrl
        if (apiKey !== undefined) data.apiKey = apiKey
        if (apiSecret !== undefined) data.apiSecret = apiSecret
        if (accessToken !== undefined) data.accessToken = accessToken
        if (syncEnabled !== undefined) data.syncEnabled = syncEnabled

        const channel = await prisma.onlineChannel.update({
            where: { id: id as string },
            data,
        })

        res.json({ success: true, data: channel })
    } catch (err) {
        console.error('Update channel error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// DELETE /api/online-orders/channels/:id
router.delete('/channels/:id', authMiddleware, requirePermission('online_orders.manage', 'orders.edit'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { id } = req.params

        const orderCount = await prisma.onlineOrder.count({ where: { channelId: id as string } })
        if (orderCount > 0) {
            res.status(400).json({ success: false, error: `Không thể xóa kênh đang có ${orderCount} đơn hàng` })
            return
        }

        await prisma.onlineChannel.delete({ where: { id: id as string } })
        res.json({ success: true })
    } catch (err) {
        console.error('Delete channel error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ═══════════════════════════════════════════════════════════════════════════════
//  ONLINE ORDERS CRUD
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/online-orders
router.get('/', authMiddleware, requirePermission('online_orders.view', 'orders.view'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const {
            search, status, channelId, platform, paymentStatus,
            startDate, endDate,
            page = '1', pageSize = '20',
        } = req.query

        const pageNum = Math.max(1, parseInt(page as string, 10) || 1)
        // Clamp 1000: cho phép FE kéo trang lớn (export/đối soát) mà vẫn chặn abuse
        const size = Math.min(1000, Math.max(1, parseInt(pageSize as string, 10) || 20))
        const skip = (pageNum - 1) * size

        const where: any = {}
        if (status && status !== 'all') {
            // Map: accept cả Shopee UPPERCASE và lowercase nội bộ để tránh mismatch
            const STATUS_VARIANTS: Record<string, string[]> = {
                UNPAID:             ['UNPAID', 'pending'],
                READY_TO_SHIP:      ['READY_TO_SHIP', 'confirmed'],
                PROCESSED:          ['PROCESSED', 'processing'],
                SHIPPED:            ['SHIPPED', 'shipping'],
                TO_CONFIRM_RECEIVE: ['TO_CONFIRM_RECEIVE', 'delivered'],
                COMPLETED:          ['COMPLETED', 'completed'],
                IN_CANCEL:          ['IN_CANCEL', 'cancelling'],
                CANCELLED:          ['CANCELLED', 'cancelled'],
                TO_RETURN:          ['TO_RETURN', 'returned'],
                // lowercase → cũng map ngược lại UPPERCASE để dùng được từ cả hai phía
                pending:     ['pending', 'UNPAID'],
                confirmed:   ['confirmed', 'READY_TO_SHIP'],
                processing:  ['processing', 'PROCESSED'],
                shipping:    ['shipping', 'SHIPPED'],
                delivered:   ['delivered', 'TO_CONFIRM_RECEIVE'],
                completed:   ['completed', 'COMPLETED'],
                cancelling:  ['cancelling', 'IN_CANCEL'],
                cancelled:   ['cancelled', 'CANCELLED'],
                returned:    ['returned', 'TO_RETURN'],
            }
            // Frontend gửi nhiều trạng thái cùng lúc dạng `?status=A,B,C`
            // (mỗi tab gom Shopee UPPERCASE + TikTok + legacy lowercase).
            // Tách CSV, expand từng giá trị qua STATUS_VARIANTS, rồi lọc bằng { in: [...] }.
            const requested = (status as string).split(',').map(s => s.trim()).filter(Boolean)
            const expanded = new Set<string>()
            for (const s of requested) {
                expanded.add(s)
                for (const v of STATUS_VARIANTS[s] ?? []) expanded.add(v)
            }
            where.status = { in: [...expanded] }
        }
        if (channelId) where.channelId = channelId as string
        if (platform && platform !== 'all') where.platform = platform
        if (paymentStatus && paymentStatus !== 'all') where.paymentStatus = paymentStatus
        if (search) {
            where.OR = [
                { orderNumber: { contains: search, mode: 'insensitive' } },
                { customerName: { contains: search, mode: 'insensitive' } },
                { customerPhone: { contains: search, mode: 'insensitive' } },
                { trackingNumber: { contains: search, mode: 'insensitive' } },
            ]
        }
        if (startDate || endDate) {
            const gte = startDate ? new Date(startDate as string) : null
            const lte = endDate ? new Date(endDate as string) : null
            where.createdAt = {}
            if (gte && !isNaN(gte.getTime())) where.createdAt.gte = gte
            if (lte && !isNaN(lte.getTime())) where.createdAt.lte = lte
            if (Object.keys(where.createdAt).length === 0) delete where.createdAt
        }

        const [total, orders] = await Promise.all([
            prisma.onlineOrder.count({ where }),
            prisma.onlineOrder.findMany({
                where,
                // items kèm SKU kho của SP đã link — packing list dùng làm fallback
                // khi item.sku rỗng (SP Shopee nhiều phân loại có item_sku trống)
                include: { items: { include: { product: { select: { sku: true } } } }, channel: true },
                orderBy: { createdAt: 'desc' },
                skip,
                take: size,
            }),
        ])

        // Lợi nhuận tạm tính — chỉ owner/admin thấy, cùng quy ước với phí sàn /
        // thực nhận ở /stats. Tính sau khi lấy đơn để không đụng vào câu query lọc.
        let items: any[] = orders
        if (['owner', 'admin'].includes(req.user?.role || 'cashier')) {
            const profits = await computeOrderProfits(prisma, orders).catch(err => {
                console.error('Compute order profits error:', err)
                return new Map()
            })
            items = orders.map(o => {
                const p = profits.get(o.id)
                return p ? {
                    ...o,
                    estimatedCost: p.cost,
                    estimatedProfit: p.profit,
                    profitIsEstimate: p.estimated,
                    profitMissingCost: p.missingCost,
                } : o
            })
        }

        res.json({
            success: true,
            data: {
                items,
                total,
                page: pageNum,
                pageSize: size,
                totalPages: Math.ceil(total / size),
            },
        })
    } catch (err) {
        console.error('Get online orders error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ═══════════════════════════════════════════════════════════════════════════════
//  MARKETPLACE PRODUCTS — Aggregate + Sync
//  ⚠️ Must be BEFORE /:id to avoid Express swallowing /products as a param
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/online-orders/products/stats
router.get('/products/stats', authMiddleware, requirePermission('online_orders.view', 'orders.view'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { channelId } = req.query
        const where: any = {}
        if (channelId) where.channelId = channelId as string

        const [total, active, outOfStock] = await Promise.all([
            prisma.onlineProduct.count({ where }),
            prisma.onlineProduct.count({ where: { ...where, status: 'NORMAL', stock: { gt: 0 } } }),
            prisma.onlineProduct.count({ where: { ...where, stock: 0 } }),
        ])

        res.json({ success: true, data: { total, active, outOfStock, needsPriceUpdate: 0 } })
    } catch (err) {
        console.error('Get marketplace product stats error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// GET /api/online-orders/products
router.get('/products', authMiddleware, requirePermission('online_orders.view', 'orders.view'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { search, channelId, platform, status, page = '1', pageSize = '50' } = req.query

        const pageNum = Math.max(1, parseInt(page as string) || 1)
        const size = Math.min(1000, Math.max(1, parseInt(pageSize as string) || 50))

        // Build where clause
        const where: any = {}
        if (channelId) where.channelId = channelId as string
        if (platform && platform !== 'all') where.platform = platform as string
        if (status && status !== 'all') where.status = status as string
        if (search) {
            const q = (search as string).trim()
            where.OR = [
                { name: { contains: q, mode: 'insensitive' } },
                { sku: { contains: q, mode: 'insensitive' } },
            ]
        }

        // Fetch channels for commission rate
        const channels = await prisma.onlineChannel.findMany({
            select: { id: true, commissionRate: true, platform: true, name: true },
        })
        const channelMap = new Map(channels.map(c => [c.id, c]))

        const [total, rawProducts] = await Promise.all([
            prisma.onlineProduct.count({ where }),
            prisma.onlineProduct.findMany({
                where,
                include: {
                    localProduct: {
                        select: { id: true, name: true, sku: true, costPrice: true, stock: true },
                    },
                },
                orderBy: { updatedAt: 'desc' },
                skip: (pageNum - 1) * size,
                take: size,
            }),
        ])

        // ── Phí sàn THẬT của đơn gần nhất ────────────────────────────────────
        // commissionRate ở trên là tỉ lệ CẤU HÌNH (mặc định theo kênh) — mọi SP ra
        // cùng một con số, không phản ánh sàn thu bao nhiêu. Lấy đơn gần nhất có
        // chứa SKU này và tính tỉ lệ thực đã bị trừ. DISTINCT ON = mỗi SKU đúng 1
        // dòng mới nhất, không phải kéo hết đơn về rồi lọc trong JS.
        const skus = [...new Set(rawProducts.map(p => (p.sku || '').trim().toLowerCase()).filter(Boolean))]
        const feeRows: any[] = skus.length > 0
            ? await prisma.$queryRawUnsafe(`
                SELECT DISTINCT ON (LOWER(TRIM(i.sku)))
                       LOWER(TRIM(i.sku))            AS sku,
                       COALESCE(o."platformFee",0)::float8     AS fee,
                       COALESCE(o."platformFeeRate",0)::float8 AS rate,
                       COALESCE(o.total,0)::float8            AS total,
                       o."createdAt"                 AS "at"
                FROM "OnlineOrderItem" i
                JOIN "OnlineOrder" o ON o.id = i."onlineOrderId"
                WHERE LOWER(TRIM(i.sku)) = ANY($1)
                  AND COALESCE(o."platformFee",0) > 0
                ORDER BY LOWER(TRIM(i.sku)), o."createdAt" DESC
            `, skus)
            : []
        const feeMap = new Map<string, { rate: number; fee: number; at: Date }>()
        for (const r of feeRows) {
            // platformFeeRate có thể chưa được điền ở đơn cũ → suy ra từ phí/tổng tiền
            const rate = r.rate > 0 ? r.rate : (r.total > 0 ? (r.fee / r.total) * 100 : 0)
            if (rate > 0) feeMap.set(r.sku, { rate, fee: r.fee, at: r.at })
        }

        const items = rawProducts.map(p => {
            const ch = channelMap.get(p.channelId)
            const configRate = ch?.commissionRate ?? 6
            // Có số thật thì dùng số thật; chưa bán được đơn nào thì rơi về cấu hình.
            const actual = feeMap.get((p.sku || '').trim().toLowerCase())
            const commissionRate = actual ? Math.round(actual.rate * 10) / 10 : configRate
            const platformFee = Math.round(p.price * commissionRate / 100)
            const costPrice = p.localProduct?.costPrice ?? undefined
            return {
                id: p.id,
                channelId: p.channelId,
                channelName: ch?.name || null,
                platform: p.platform,
                platformProductId: p.platformProductId,
                name: p.name,
                sku: p.sku,
                price: p.price,
                stock: p.stock,
                status: p.status,
                imageUrl: p.imageUrl,
                categoryId: (p as any).categoryId || null,
                categoryName: (p as any).categoryName || null,
                createdAt: p.createdAt.toISOString(),
                updatedAt: p.updatedAt?.toISOString() || null,
                syncedAt: p.syncedAt?.toISOString() || null,
                commissionRate,
                // Để màn hình phân biệt "phí sàn thật của đơn gần nhất" với "tỉ lệ
                // cấu hình đoán tạm" — hai thứ này lệch nhau thì người dùng phải biết.
                commissionSource: (feeMap.has((p.sku || '').trim().toLowerCase()) ? 'last_order' : 'config') as 'last_order' | 'config',
                commissionConfigRate: configRate,
                commissionFromOrderAt: feeMap.get((p.sku || '').trim().toLowerCase())?.at?.toISOString() || null,
                platformFee,
                netPrice: p.price - platformFee,
                costPrice: costPrice != null ? Number(costPrice) : undefined,
                localProductId: p.localProductId,
                localProductName: p.localProduct?.name || null,
                localProductSku: p.localProduct?.sku || null,
                localStock: p.localProduct?.stock ?? null,
            }
        })

        const totalPages = Math.ceil(total / size) || 1
        res.json({ success: true, data: { items, total, page: pageNum, pageSize: size, totalPages } })
    } catch (err) {
        console.error('Get marketplace products error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// PUT /api/online-orders/products/:id/link — Link online product to local inventory product
router.put('/products/:id/link', authMiddleware, requirePermission('online_orders.manage', 'orders.edit'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { localProductId } = req.body

        const onlineProduct = await prisma.onlineProduct.findUnique({ where: { id: req.params.id as string } })
        if (!onlineProduct) {
            res.status(404).json({ success: false, error: 'Sản phẩm sàn không tồn tại' })
            return
        }

        // If unlinking (null), skip product validation
        if (localProductId) {
            const localProduct = await prisma.product.findUnique({ where: { id: localProductId } })
            if (!localProduct) {
                res.status(404).json({ success: false, error: 'Sản phẩm kho không tồn tại' })
                return
            }
        }

        const updated = await prisma.onlineProduct.update({
            where: { id: req.params.id as string },
            data: { localProductId: localProductId || null },
            include: {
                localProduct: { select: { id: true, name: true, sku: true, costPrice: true, stock: true } },
            },
        })

        res.json({ success: true, data: updated })
    } catch (err: any) {
        console.error('Link product error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// PUT /api/online-orders/products/:id — Update price/stock stub
router.put('/products/:id', authMiddleware, requirePermission('online_orders.manage', 'orders.edit'), async (req: AuthRequest, res: Response) => {
    res.json({ success: true, data: { id: req.params.id, ...req.body } })
})



// GET /api/online-orders/:id
// ═══════════════════════════════════════════════════════════════════════════════
//  ÁNH XẠ SKU SÀN → SẢN PHẨM KHO
//  Đơn TikTok/Shopee dùng mã riêng ("Ct30plus", "cs24"…) không trùng SKU kho →
//  orderSync bỏ qua → đơn không lên phiếu ⇒ không xuất được hoá đơn. 4 API dưới
//  cho phép: xem SKU nào đang treo, map sang hàng trong kho, rồi chạy lại.
// ═══════════════════════════════════════════════════════════════════════════════

// Vận hành nội bộ: x-admin-key + x-store-code (giống /api/einvoice, /api/mcp) để
// chẩn đoán SKU treo mà không cần đăng nhập. Request thường vẫn qua authMiddleware.
const skuAuth = async (req: AuthRequest, res: Response, next: NextFunction) => {
    const adminKey = req.headers['x-admin-key'] as string
    if (adminKey && process.env.ADMIN_KEY && adminKey === process.env.ADMIN_KEY) {
        const code = String(req.headers['x-store-code'] || '').trim()
        if (code) {
            const { getStorePrisma } = await import('../lib/prisma')
            const store = await registryPrisma.store.findFirst({ where: { code: { equals: code, mode: 'insensitive' } } })
            if (store) {
                req.storePrisma = getStorePrisma(store.schema)
                req.user = { role: 'admin', storeSchema: store.schema, branchSchema: store.schema } as any
                next()
                return
            }
        }
        res.status(400).json({ success: false, error: 'x-admin-key cần kèm x-store-code hợp lệ' })
        return
    }
    authMiddleware(req, res, next)
}

// GET /sku-mappings — danh sách ánh xạ đã lưu
router.get('/sku-mappings', skuAuth, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const rows = await prisma.skuMapping.findMany({
            include: { product: { select: { id: true, sku: true, name: true } } },
            orderBy: { createdAt: 'desc' },
            take: 500,
        })
        res.json({ success: true, data: rows })
    } catch (err) {
        console.error('list sku-mappings error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// POST /sku-mappings {platformSku, productId, platform?, note?} — tạo/cập nhật
router.post('/sku-mappings', skuAuth, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const platformSku = String(req.body?.platformSku || '').trim()
        const productId = String(req.body?.productId || '').trim()
        const platform = req.body?.platform ? String(req.body.platform).toLowerCase() : null
        if (!platformSku || !productId) {
            res.status(400).json({ success: false, error: 'Thiếu platformSku hoặc productId' }); return
        }
        const product = await prisma.product.findUnique({ where: { id: productId } })
        if (!product) { res.status(404).json({ success: false, error: 'Sản phẩm kho không tồn tại' }); return }

        const existing = await prisma.skuMapping.findFirst({ where: { platformSku, platform } })
        const row = existing
            ? await prisma.skuMapping.update({ where: { id: existing.id }, data: { productId, note: req.body?.note || null } })
            : await prisma.skuMapping.create({ data: { platformSku, productId, platform, note: req.body?.note || null } })
        res.json({ success: true, data: row })
    } catch (err) {
        console.error('save sku-mapping error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// DELETE /sku-mappings/:id
router.delete('/sku-mappings/:id', skuAuth, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        await prisma.skuMapping.delete({ where: { id: String(req.params.id) } })
        res.json({ success: true })
    } catch (err) {
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// GET /unmatched-skus?days=90 — SKU trên sàn CHƯA khớp hàng kho, gom theo mã +
// đếm số đơn/dòng để biết cái nào đáng map trước. Chỉ tính đơn CHƯA lên phiếu.
router.get('/unmatched-skus', skuAuth, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const days = Math.min(365, Math.max(1, Number(req.query.days) || 90))
        const from = new Date(Date.now() - days * 86400_000)
        // CHỈ liệt kê mã THẬT SỰ không có trong kho. Mã đã tồn tại (vd SHD4030) mà
        // chưa khớp là do đơn chưa được xử lý (kẹt cổng trạng thái) — map lại vô ích,
        // chỉ cần bấm "Chạy lại chuyển phiếu". Hàng KHÔNG có mã cũng tách riêng vì
        // không map bằng SKU được (phải link ở màn "Sản phẩm trên sàn").
        const notConverted = `
            AND o."createdAt" >= $1
            AND i."productId" IS NULL
            AND NOT EXISTS (
                SELECT 1 FROM "Transaction" t WHERE t."receiptNumber" = 'ONLINE-' || o."orderNumber"
            )`
        const [list, noSkuRows] = await Promise.all([
            prisma.$queryRawUnsafe(`
                SELECT i.sku AS "platformSku",
                       MIN(i."productName") AS "sampleName",
                       COALESCE(o.platform,'?') AS platform,
                       COUNT(DISTINCT o.id)::int AS "soDon",
                       COALESCE(SUM(i."lineTotal"),0)::float8 AS "tongTien"
                FROM "OnlineOrderItem" i
                JOIN "OnlineOrder" o ON o.id = i."onlineOrderId"
                WHERE NULLIF(TRIM(i.sku),'') IS NOT NULL
                  ${notConverted}
                  AND NOT EXISTS (
                      SELECT 1 FROM "Product" p WHERE LOWER(TRIM(p.sku)) = LOWER(TRIM(i.sku))
                  )
                  AND NOT EXISTS (
                      SELECT 1 FROM "SkuMapping" m WHERE LOWER(TRIM(m."platformSku")) = LOWER(TRIM(i.sku))
                  )
                GROUP BY 1, 3
                ORDER BY 4 DESC
                LIMIT 300
            `, from),
            prisma.$queryRawUnsafe(`
                SELECT COUNT(DISTINCT o.id)::int AS "soDon",
                       COALESCE(SUM(i."lineTotal"),0)::float8 AS "tongTien"
                FROM "OnlineOrderItem" i
                JOIN "OnlineOrder" o ON o.id = i."onlineOrderId"
                WHERE NULLIF(TRIM(i.sku),'') IS NULL
                  ${notConverted}
            `, from),
        ])
        res.json({ success: true, data: { list, noSku: (noSkuRows as any[])[0] || { soDon: 0, tongTien: 0 } } })
    } catch (err) {
        console.error('unmatched-skus error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// POST /reconvert {days?} — chạy lại chuyển phiếu cho đơn đã đủ điều kiện nhưng
// chưa có phiếu (sau khi vừa map SKU). Idempotent: đơn đã có phiếu sẽ bị bỏ qua.
router.post('/reconvert', skuAuth, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const days = Math.min(365, Math.max(1, Number(req.body?.days) || 90))
        const orders = await prisma.onlineOrder.findMany({
            where: {
                createdAt: { gte: new Date(Date.now() - days * 86400_000) },
                status: {
                    in: [
                        'confirmed', 'processing', 'shipping', 'completed', 'delivered',
                        'READY_TO_SHIP', 'PROCESSED', 'SHIPPED', 'COMPLETED',
                        'AWAITING_SHIPMENT', 'AWAITING_COLLECTION', 'PARTIALLY_SHIPPING',
                        'IN_TRANSIT', 'DELIVERED',
                    ],
                },
            },
            select: { id: true, orderNumber: true },
            orderBy: { createdAt: 'desc' },
            take: 2000,
        })
        let converted = 0, skipped = 0, failed = 0
        for (const o of orders) {
            try {
                const ok = await convertOnlineOrderToTransaction(prisma, o.id)
                if (ok) converted++; else skipped++
            } catch { failed++ }
        }
        res.json({ success: true, data: { scanned: orders.length, converted, skipped, failed } })
    } catch (err) {
        console.error('reconvert error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

router.get('/:id', authMiddleware, requirePermission('online_orders.view', 'orders.view'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const order = await prisma.onlineOrder.findUnique({
            where: { id: req.params.id as string },
            include: { items: true, channel: true },
        })

        if (!order) {
            res.status(404).json({ success: false, error: 'Không tìm thấy đơn hàng' })
            return
        }

        res.json({ success: true, data: order })
    } catch (err) {
        console.error('Get online order error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// POST /api/online-orders
router.post('/', authMiddleware, requirePermission('online_orders.manage', 'orders.edit'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { items, ...orderData } = req.body

        if (!orderData.customerName) {
            res.status(400).json({ success: false, error: 'Tên khách hàng là bắt buộc' })
            return
        }
        if (!items || !Array.isArray(items) || items.length === 0) {
            res.status(400).json({ success: false, error: 'Đơn hàng cần ít nhất 1 sản phẩm' })
            return
        }

        // Auto-generate order number
        const today = new Date()
        const prefix = `ON${today.getFullYear().toString().slice(-2)}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`
        const orderNumber = await nextCode(prisma, 'onlineOrderCodeSeq', prefix, 4, '-', 'OnlineOrder', 'orderNumber')

        // Resolve channel info
        let channelName = orderData.channelName
        let platform = orderData.platform
        if (orderData.channelId && !channelName) {
            const channel = await prisma.onlineChannel.findUnique({ where: { id: orderData.channelId } })
            if (channel) {
                channelName = channel.name
                platform = platform || channel.platform
            }
        }

        const order = await prisma.onlineOrder.create({
            data: {
                orderNumber,
                channelId: orderData.channelId || undefined,
                channelName,
                platform,
                customerName: orderData.customerName,
                customerPhone: orderData.customerPhone || null,
                customerEmail: orderData.customerEmail || null,
                shippingAddress: orderData.shippingAddress || null,
                status: orderData.status || 'pending',
                subtotal: orderData.subtotal || 0,
                discount: orderData.discount || 0,
                shippingFee: orderData.shippingFee || 0,
                total: orderData.total || 0,
                paymentMethod: orderData.paymentMethod || null,
                paymentStatus: orderData.paymentStatus || 'unpaid',
                trackingNumber: orderData.trackingNumber || null,
                shippingCarrier: orderData.shippingCarrier || null,
                note: orderData.note || null,
                internalNote: orderData.internalNote || null,
                items: {
                    create: items.map((item: any) => ({
                        productId: item.productId || undefined,
                        productName: item.productName,
                        sku: item.sku || null,
                        quantity: item.quantity,
                        unitPrice: item.unitPrice,
                        discount: item.discount || 0,
                        lineTotal: item.lineTotal || (item.unitPrice * item.quantity - (item.discount || 0)),
                    })),
                },
            },
            include: { items: true, channel: true },
        })

        // Update channel stats
        if (order.channelId) {
            await prisma.onlineChannel.update({
                where: { id: order.channelId },
                data: {
                    totalOrders: { increment: 1 },
                    totalRevenue: { increment: order.total },
                },
            }).catch(() => { })
        }

        res.json({ success: true, data: order })
    } catch (err) {
        console.error('Create online order error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// PUT /api/online-orders/:id
router.put('/:id', authMiddleware, requirePermission('online_orders.manage', 'orders.edit'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { id } = req.params
        const { items, ...orderData } = req.body

        const updateData: any = {}
        const fields = [
            'channelId', 'channelName', 'platform', 'customerName', 'customerPhone',
            'customerEmail', 'shippingAddress', 'subtotal', 'discount', 'shippingFee',
            'total', 'paymentMethod', 'paymentStatus', 'trackingNumber', 'shippingCarrier',
            'note', 'internalNote',
        ]
        for (const f of fields) {
            if (orderData[f] !== undefined) updateData[f] = orderData[f]
        }

        // Handle date fields
        if (orderData.paidAt) updateData.paidAt = new Date(orderData.paidAt)
        if (orderData.shippedAt) updateData.shippedAt = new Date(orderData.shippedAt)
        if (orderData.deliveredAt) updateData.deliveredAt = new Date(orderData.deliveredAt)

        const order = await prisma.onlineOrder.update({
            where: { id: id as string },
            data: updateData,
            include: { items: true, channel: true },
        })

        res.json({ success: true, data: order })
    } catch (err) {
        console.error('Update online order error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// PUT /api/online-orders/:id/status
router.put('/:id/status', authMiddleware, requirePermission('online_orders.update_status', 'orders.edit'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { id } = req.params
        const { status, trackingNumber, shippingCarrier } = req.body

        // Shopee UPPERCASE + legacy lowercase
        const validStatuses = [
            // Shopee Open Platform v2 official statuses
            'UNPAID', 'READY_TO_SHIP', 'PROCESSED', 'SHIPPED',
            'TO_CONFIRM_RECEIVE', 'COMPLETED', 'IN_CANCEL', 'CANCELLED', 'TO_RETURN',
            // Legacy lowercase (internal / non-Shopee orders)
            'pending', 'confirmed', 'processing', 'shipping',
            'delivered', 'completed', 'cancelling', 'cancelled', 'returned',
        ]
        if (!status || !validStatuses.includes(status)) {
            res.status(400).json({ success: false, error: 'Trạng thái không hợp lệ' })
            return
        }

        // Get old order to check previous status (for inventory sync)
        const oldOrder = await prisma.onlineOrder.findUnique({
            where: { id: id as string },
            include: { items: true, channel: true },
        })
        const oldStatus = oldOrder?.status

        // ── Đơn TikTok: ánh xạ nút bấm → hành động THẬT trên sàn ─────────────
        // Trạng thái đơn TikTok do sàn quản lý (webhook phản chiếu về). Seller chỉ
        // có 2 hành động qua API: Giao vận chuyển (RTS) và Huỷ đơn. Gọi sàn thành
        // công mới ghi DB — và ghi bằng trạng thái THẬT fetch lại từ sàn.
        const tkChannel: any = (oldOrder as any)?.channel
        if (tkChannel?.platform === 'tiktok' && tkChannel.accessToken && oldOrder?.externalOrderId) {
            const SHIP_STATUSES = ['SHIPPED', 'shipping', 'PROCESSED', 'processing']
            const CANCEL_STATUSES = ['CANCELLED', 'cancelled', 'cancelling', 'IN_CANCEL']
            const isShip = SHIP_STATUSES.includes(status)
            const isCancel = CANCEL_STATUSES.includes(status)
            if (!isShip && !isCancel) {
                res.status(400).json({
                    success: false,
                    error: 'Đơn TikTok: trạng thái do sàn tự cập nhật (webhook). Hành động khả dụng: "Giao vận chuyển" (đơn chờ xử lý) hoặc "Hủy đơn".',
                })
                return
            }

            const eid = (oldOrder.externalOrderId || '').replace(/^(SPE-|TIK-|LAZ-)/i, '')
            const tiktok = new TikTokService({
                apiKey: tkChannel.apiKey || '', apiSecret: tkChannel.apiSecret || '',
                accessToken: tkChannel.accessToken || undefined,
                refreshToken: tkChannel.refreshToken || undefined,
                shopId: tkChannel.shopId || undefined,
            })
            // Auto-refresh token if expiring (5 min buffer)
            if (tkChannel.tokenExpiresAt && new Date(tkChannel.tokenExpiresAt).getTime() < Date.now() + 5 * 60 * 1000) {
                try {
                    const tokens = await tiktok.refreshAccessToken();
                    (tiktok as any).credentials.accessToken = tokens.accessToken;
                    (tiktok as any).credentials.refreshToken = tokens.refreshToken;
                    await prisma.onlineChannel.update({
                        where: { id: tkChannel.id },
                        data: { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, tokenExpiresAt: new Date(Date.now() + tokens.expiresIn * 1000) },
                    })
                } catch (e: any) { console.error('[Status] TikTok token refresh failed:', e.message) }
            }

            try {
                if (isShip) await tiktok.shipOrder(eid)
                else await tiktok.cancelOrder(eid)
            } catch (platformErr: any) {
                res.status(400).json({ success: false, error: `TikTok từ chối: ${platformErr.message}` })
                return
            }

            // Lấy trạng thái thật từ sàn sau hành động (RTS → AWAITING_COLLECTION...)
            let actual: any = null
            try { actual = await tiktok.getOrderDetail(eid) } catch { }
            const order = await prisma.onlineOrder.update({
                where: { id: id as string },
                data: actual ? {
                    status: actual.status,
                    externalStatus: actual.externalStatus,
                    paymentStatus: actual.paymentStatus,
                    trackingNumber: actual.trackingNumber || oldOrder.trackingNumber,
                    shippingCarrier: actual.shippingCarrier || oldOrder.shippingCarrier,
                    syncedAt: new Date(),
                } : { status: isShip ? 'AWAITING_COLLECTION' : 'IN_CANCEL', syncedAt: new Date() },
                include: { items: true, channel: true },
            })

            // Sàn xác nhận hủy chung cuộc (CANCELLED) → đảo hiệu ứng ngay; nếu mới
            // IN_CANCEL thì webhook sẽ đảo khi sàn chốt hủy (reversal idempotent).
            if (isReversalStatus(order.status)) {
                try {
                    await reverseOnlineOrderEffects(prisma, order, { userId: req.user?.userId })
                } catch (revErr: any) {
                    console.error(`[Status] Reversal failed for ${order.orderNumber}:`, revErr.message)
                }
            }

            try {
                await prisma.auditLog.create({
                    data: {
                        userId: req.user?.userId,
                        userName: req.user?.email || 'system',
                        action: isShip ? 'tiktok_rts' : 'tiktok_cancel',
                        entity: 'OnlineOrder',
                        entityId: order.id,
                        details: JSON.stringify({ orderNumber: order.orderNumber, oldStatus, newStatus: order.status }),
                    },
                })
            } catch { }

            res.json({ success: true, data: order })
            return
        }

        // ── Đơn Shopee: nút bấm → hành động THẬT trên sàn ────────────────────
        // "Giao vận chuyển": chỉ khi đơn đang READY_TO_SHIP (trạng thái duy nhất
        // RTS hợp lệ). "Hủy đơn": chỉ khi đơn chưa giao (UNPAID/READY_TO_SHIP/
        // PROCESSED). Các chuyển trạng thái khác giữ hành vi cập nhật DB như cũ
        // (vd: đánh dấu CANCELLED cho đơn sàn đã tự hủy).
        const speChannel: any = (oldOrder as any)?.channel
        const SPE_SHIP_STATUSES = ['SHIPPED', 'shipping', 'PROCESSED', 'processing']
        const SPE_CANCEL_STATUSES = ['CANCELLED', 'cancelled', 'cancelling']
        const speCurrent = oldOrder?.externalStatus || oldOrder?.status || ''
        const speDoShip = SPE_SHIP_STATUSES.includes(status) && speCurrent === 'READY_TO_SHIP'
        const speDoCancel = SPE_CANCEL_STATUSES.includes(status) && ['UNPAID', 'READY_TO_SHIP', 'PROCESSED'].includes(speCurrent)
        if (speChannel?.platform === 'shopee' && speChannel.accessToken && oldOrder?.externalOrderId
            && (speDoShip || speDoCancel)) {

            const eid = (oldOrder.externalOrderId || '').replace(/^(SPE-|TIK-|LAZ-)/i, '')
            const shopee = new ShopeeService({
                apiKey: speChannel.apiKey || '', apiSecret: speChannel.apiSecret || '',
                accessToken: speChannel.accessToken || undefined,
                refreshToken: speChannel.refreshToken || undefined,
                shopId: speChannel.shopId || undefined,
            })
            // Auto-refresh token if expiring (5 min buffer)
            if (speChannel.tokenExpiresAt && new Date(speChannel.tokenExpiresAt).getTime() < Date.now() + 5 * 60 * 1000) {
                try {
                    const tokens = await shopee.refreshAccessToken();
                    (shopee as any).credentials.accessToken = tokens.accessToken;
                    (shopee as any).credentials.refreshToken = tokens.refreshToken;
                    await prisma.onlineChannel.update({
                        where: { id: speChannel.id },
                        data: { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, tokenExpiresAt: new Date(Date.now() + tokens.expiresIn * 1000) },
                    })
                } catch (e: any) { console.error('[Status] Shopee token refresh failed:', e.message) }
            }

            try {
                if (speDoShip) await shopee.shipOrder(eid)
                else await shopee.cancelOrder(eid, req.body.cancelReason || 'OUT_OF_STOCK')
            } catch (platformErr: any) {
                res.status(400).json({ success: false, error: `Shopee từ chối: ${platformErr.message}` })
                return
            }

            // Lấy trạng thái thật từ sàn sau hành động (RTS → PROCESSED, hủy → CANCELLED...)
            let actual: any = null
            try { actual = await shopee.getOrderDetail(eid) } catch { }
            const order = await prisma.onlineOrder.update({
                where: { id: id as string },
                data: actual ? {
                    status: actual.status,
                    externalStatus: actual.externalStatus,
                    paymentStatus: actual.paymentStatus,
                    trackingNumber: actual.trackingNumber || oldOrder.trackingNumber,
                    shippingCarrier: actual.shippingCarrier || oldOrder.shippingCarrier,
                    syncedAt: new Date(),
                } : { status: speDoShip ? 'PROCESSED' : 'CANCELLED', syncedAt: new Date() },
                include: { items: true, channel: true },
            })

            // Hủy chốt trên sàn (CANCELLED/fallback) → đảo hiệu ứng (idempotent —
            // webhook Shopee về sau có gọi lại cũng vô hại).
            if (isReversalStatus(order.status)) {
                try {
                    await reverseOnlineOrderEffects(prisma, order, { userId: req.user?.userId })
                } catch (revErr: any) {
                    console.error(`[Status] Reversal failed for ${order.orderNumber}:`, revErr.message)
                }
            }

            try {
                await prisma.auditLog.create({
                    data: {
                        userId: req.user?.userId,
                        userName: req.user?.email || 'system',
                        action: speDoShip ? 'shopee_rts' : 'shopee_cancel',
                        entity: 'OnlineOrder',
                        entityId: order.id,
                        details: JSON.stringify({ orderNumber: order.orderNumber, oldStatus, newStatus: order.status }),
                    },
                })
            } catch { }

            res.json({ success: true, data: order })
            return
        }

        const updateData: any = { status }
        // Timestamp auto-fill: map cả Shopee UPPERCASE và legacy lowercase
        if (status === 'SHIPPED' || status === 'shipping') {
            updateData.shippedAt = new Date()
            if (trackingNumber) updateData.trackingNumber = trackingNumber
            if (shippingCarrier) updateData.shippingCarrier = shippingCarrier
        }
        if (status === 'TO_CONFIRM_RECEIVE' || status === 'delivered') updateData.deliveredAt = new Date()
        if (status === 'COMPLETED' || status === 'completed') {
            updateData.paymentStatus = 'paid'
            updateData.paidAt = new Date()
        }

        const order = await prisma.onlineOrder.update({
            where: { id: id as string },
            data: updateData,
            include: { items: true, channel: true },
        })

        // ── Inventory auto-sync ──────────────────────────────────────────
        // Deduct stock when order is confirmed/processed, reverse when cancelled/returned
        const confirmStatuses = ['READY_TO_SHIP', 'PROCESSED', 'SHIPPED', 'confirmed', 'processing', 'shipping']
        const wasNotConfirmed = !oldStatus || !confirmStatuses.includes(oldStatus)
        const isNowConfirmed = confirmStatuses.includes(status)

        if (order.items?.length && wasNotConfirmed && isNowConfirmed) {
            try {
                // CHỐNG TRỪ KHO 2 LẦN: đường convert (orderSync) cũng trừ kho độc lập
                // → claim cờ stockDeducted trước (updateMany false→true là atomic).
                // count=0 nghĩa là đơn đã trừ rồi (đường kia nhanh hơn) → SKIP.
                const claim = await prisma.onlineOrder.updateMany({
                    where: { id: order.id, stockDeducted: false },
                    data: { stockDeducted: true },
                })
                if (claim.count > 0) {
                    // Deduct inventory — mirror sang kho main (adjustSellableStock cần
                    // productId): ưu tiên item.productId, fallback resolve theo SKU.
                    // Đơn sàn không có branchId → null (kho main null-branch).
                    for (const item of order.items) {
                        let productId = item.productId as string | null
                        if (!productId && item.sku) {
                            const p = await prisma.product.findFirst({ where: { sku: item.sku } })
                            productId = p?.id ?? null
                        }
                        if (productId) {
                            await adjustSellableStock(prisma, productId, null, -item.quantity)
                        }
                    }
                    console.log(`[Inventory Sync] ✅ Deducted stock for order ${order.orderNumber} (${order.items.length} items)`)
                } else {
                    console.log(`[Inventory Sync] Order ${order.orderNumber} đã trừ kho trước đó (stockDeducted=true) — bỏ qua`)
                }
            } catch (invErr) {
                console.error(`[Inventory Sync] ⚠️ Error syncing inventory for ${order.orderNumber}:`, invErr)
                // Don't fail the status update due to inventory errors
            }
        }

        // Hủy/hoàn CHUNG CUỘC (cancelled/returned) → đảo toàn bộ hiệu ứng: hoàn
        // kho theo cờ stockDeducted + void Transaction đã convert + đảo bút toán.
        // IN_CANCEL/cancelling là "chờ duyệt" — chưa đảo (sàn có thể từ chối hủy).
        if (isReversalStatus(status)) {
            try {
                await reverseOnlineOrderEffects(prisma, order, { userId: req.user?.userId })
            } catch (revErr: any) {
                console.error(`[Inventory Sync] ⚠️ Reversal failed for ${order.orderNumber}:`, revErr.message)
            }
        }

        // ── Audit Log ────────────────────────────────────────────────────────
        try {
            await prisma.auditLog.create({
                data: {
                    userId: req.user?.userId,
                    userName: req.user?.email || 'system',
                    action: 'status_change',
                    entity: 'OnlineOrder',
                    entityId: order.id,
                    details: JSON.stringify({
                        orderNumber: order.orderNumber,
                        oldStatus,
                        newStatus: status,
                        trackingNumber: trackingNumber || undefined,
                    }),
                },
            })
        } catch (logErr) {
            console.error('[Audit] Failed to log status change:', logErr)
        }

        res.json({ success: true, data: order })
    } catch (err) {
        console.error('Update online order status error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// POST /api/online-orders/:id/handle-cancellation — Shopee: chấp nhận/từ chối
// yêu cầu hủy của NGƯỜI MUA (đơn đang IN_CANCEL). Body: { operation: 'ACCEPT' | 'REJECT' }
router.post('/:id/handle-cancellation', authMiddleware, requirePermission('online_orders.update_status', 'orders.edit'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { id } = req.params
        const operation = String(req.body?.operation || '').toUpperCase()
        if (!['ACCEPT', 'REJECT'].includes(operation)) {
            res.status(400).json({ success: false, error: "operation phải là 'ACCEPT' hoặc 'REJECT'" })
            return
        }

        const order = await prisma.onlineOrder.findUnique({
            where: { id: id as string },
            include: { channel: true },
        })
        if (!order) { res.status(404).json({ success: false, error: 'Không tìm thấy đơn' }); return }

        const channel: any = (order as any).channel
        if (channel?.platform !== 'shopee' || !channel.accessToken) {
            res.status(400).json({ success: false, error: 'Chỉ hỗ trợ đơn Shopee đã kết nối API' })
            return
        }
        if (order.externalStatus !== 'IN_CANCEL' && order.status !== 'IN_CANCEL') {
            res.status(400).json({ success: false, error: 'Đơn không ở trạng thái chờ duyệt hủy (IN_CANCEL)' })
            return
        }

        const shopee = new ShopeeService({
            apiKey: channel.apiKey || '', apiSecret: channel.apiSecret || '',
            accessToken: channel.accessToken || undefined,
            refreshToken: channel.refreshToken || undefined,
            shopId: channel.shopId || undefined,
        })
        if (channel.tokenExpiresAt && new Date(channel.tokenExpiresAt).getTime() < Date.now() + 5 * 60 * 1000) {
            try {
                const tokens = await shopee.refreshAccessToken();
                (shopee as any).credentials.accessToken = tokens.accessToken;
                (shopee as any).credentials.refreshToken = tokens.refreshToken;
                await prisma.onlineChannel.update({
                    where: { id: channel.id },
                    data: { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, tokenExpiresAt: new Date(Date.now() + tokens.expiresIn * 1000) },
                })
            } catch (e: any) { console.error('[HandleCancellation] Token refresh failed:', e.message) }
        }

        const eid = (order.externalOrderId || '').replace(/^(SPE-|TIK-|LAZ-)/i, '')
        try {
            await shopee.handleBuyerCancellation(eid, operation as 'ACCEPT' | 'REJECT')
        } catch (platformErr: any) {
            res.status(400).json({ success: false, error: `Shopee từ chối: ${platformErr.message}` })
            return
        }

        // Lấy trạng thái thật sau khi xử lý (ACCEPT → CANCELLED, REJECT → trạng thái cũ)
        let actual: any = null
        try { actual = await shopee.getOrderDetail(eid) } catch { }
        const updated = await prisma.onlineOrder.update({
            where: { id: id as string },
            data: actual ? {
                status: actual.status,
                externalStatus: actual.externalStatus,
                paymentStatus: actual.paymentStatus,
                syncedAt: new Date(),
            } : { status: operation === 'ACCEPT' ? 'CANCELLED' : 'READY_TO_SHIP', syncedAt: new Date() },
            include: { items: true, channel: true },
        })

        try {
            await prisma.auditLog.create({
                data: {
                    userId: req.user?.userId,
                    userName: req.user?.email || 'system',
                    action: operation === 'ACCEPT' ? 'shopee_accept_cancel' : 'shopee_reject_cancel',
                    entity: 'OnlineOrder',
                    entityId: updated.id,
                    details: JSON.stringify({ orderNumber: updated.orderNumber, operation, newStatus: updated.status }),
                },
            })
        } catch { }

        res.json({ success: true, data: updated })
    } catch (err: any) {
        console.error('Handle buyer cancellation error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// PATCH /api/online-orders/:id/notes
router.patch('/:id/notes', authMiddleware, requirePermission('online_orders.manage', 'orders.edit'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { id } = req.params
        const { internalNote } = req.body

        const order = await prisma.onlineOrder.update({
            where: { id: id as string },
            data: { internalNote: internalNote ?? '' },
        })

        // Audit log for note change
        try {
            await prisma.auditLog.create({
                data: {
                    userId: req.user?.userId,
                    userName: req.user?.email || 'system',
                    action: 'update_note',
                    entity: 'OnlineOrder',
                    entityId: order.id,
                    details: JSON.stringify({ orderNumber: order.orderNumber, note: internalNote }),
                },
            })
        } catch { }

        res.json({ success: true, data: order })
    } catch (err) {
        console.error('Update note error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// GET /api/online-orders/:id/activity
router.get('/:id/activity', authMiddleware, requirePermission('online_orders.view', 'orders.view'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { id } = req.params

        const logs = await prisma.auditLog.findMany({
            where: { entity: 'OnlineOrder', entityId: id as string },
            orderBy: { createdAt: 'desc' },
            take: 20,
        })

        res.json({ success: true, data: logs })
    } catch (err) {
        console.error('Get order activity error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// DELETE /api/online-orders/:id
router.delete('/:id', authMiddleware, requirePermission('online_orders.manage', 'orders.edit'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { id } = req.params

        const order = await prisma.onlineOrder.findUnique({ where: { id: id as string } })
        if (!order) {
            res.status(404).json({ success: false, error: 'Không tìm thấy đơn hàng' })
            return
        }
        if (!['pending', 'cancelled', 'UNPAID', 'CANCELLED'].includes(order.status)) {
            res.status(400).json({ success: false, error: 'Chỉ có thể xóa đơn ở trạng thái Chờ thanh toán hoặc Đã hủy' })
            return
        }

        await prisma.onlineOrder.delete({ where: { id: id as string } })
        res.json({ success: true })
    } catch (err) {
        console.error('Delete online order error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ═══════════════════════════════════════════════════════════════════════════════
//  BULK UPDATE
// ═══════════════════════════════════════════════════════════════════════════════

// POST /api/online-orders/bulk-update
router.post('/bulk-update', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { ids, status, trackingNumber, shippingCarrier } = req.body
        if (!ids?.length || !status) {
            res.status(400).json({ success: false, error: 'Thiếu ids hoặc status' })
            return
        }

        const data: any = { status }
        if (trackingNumber) data.trackingNumber = trackingNumber
        if (shippingCarrier) data.shippingCarrier = shippingCarrier
        // Timestamp auto-fill for bulk updates
        if (status === 'SHIPPED' || status === 'shipping') data.shippedAt = new Date()
        if (status === 'TO_CONFIRM_RECEIVE' || status === 'delivered') data.deliveredAt = new Date()
        if (['COMPLETED', 'completed', 'TO_CONFIRM_RECEIVE', 'delivered'].includes(status)) data.paymentStatus = 'paid'

        // ── Đơn TikTok: gọi hành động thật trên sàn từng đơn (RTS / Huỷ) ─────
        // Đơn không phải TikTok giữ nguyên updateMany như cũ. Đơn TikTok mà hành
        // động không có ánh xạ trên sàn thì bỏ qua kèm thông báo.
        const targets = await prisma.onlineOrder.findMany({
            where: { id: { in: ids } },
            include: { channel: true },
        })
        const tiktokOrders = targets.filter((o: any) => o.channel?.platform === 'tiktok' && o.channel?.accessToken && o.externalOrderId)
        const normalIds = targets.filter((o: any) => !tiktokOrders.includes(o)).map((o: any) => o.id)

        const errors: string[] = []
        let tiktokUpdated = 0
        if (tiktokOrders.length > 0) {
            const SHIP_STATUSES = ['SHIPPED', 'shipping', 'PROCESSED', 'processing']
            const CANCEL_STATUSES = ['CANCELLED', 'cancelled', 'cancelling', 'IN_CANCEL']
            const isShip = SHIP_STATUSES.includes(status)
            const isCancel = CANCEL_STATUSES.includes(status)
            if (!isShip && !isCancel) {
                errors.push(`${tiktokOrders.length} đơn TikTok bị bỏ qua: trạng thái này do sàn tự cập nhật, chỉ hỗ trợ "Giao vận chuyển" hoặc "Hủy"`)
            } else {
                const ch: any = tiktokOrders[0].channel
                const tiktok = new TikTokService({
                    apiKey: ch.apiKey || '', apiSecret: ch.apiSecret || '',
                    accessToken: ch.accessToken || undefined,
                    refreshToken: ch.refreshToken || undefined,
                    shopId: ch.shopId || undefined,
                })
                if (ch.tokenExpiresAt && new Date(ch.tokenExpiresAt).getTime() < Date.now() + 5 * 60 * 1000) {
                    try {
                        const tokens = await tiktok.refreshAccessToken();
                        (tiktok as any).credentials.accessToken = tokens.accessToken;
                        (tiktok as any).credentials.refreshToken = tokens.refreshToken;
                        await prisma.onlineChannel.update({
                            where: { id: ch.id },
                            data: { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, tokenExpiresAt: new Date(Date.now() + tokens.expiresIn * 1000) },
                        })
                    } catch (e: any) { console.error('[BulkUpdate] TikTok token refresh failed:', e.message) }
                }
                for (const o of tiktokOrders) {
                    const eid = (o.externalOrderId || '').replace(/^(SPE-|TIK-|LAZ-)/i, '')
                    try {
                        if (isShip) await tiktok.shipOrder(eid)
                        else await tiktok.cancelOrder(eid)
                        let actual: any = null
                        try { actual = await tiktok.getOrderDetail(eid) } catch { }
                        await prisma.onlineOrder.update({
                            where: { id: o.id },
                            data: actual ? {
                                status: actual.status,
                                externalStatus: actual.externalStatus,
                                paymentStatus: actual.paymentStatus,
                                trackingNumber: actual.trackingNumber || o.trackingNumber,
                                shippingCarrier: actual.shippingCarrier || o.shippingCarrier,
                                syncedAt: new Date(),
                            } : { status: isShip ? 'AWAITING_COLLECTION' : 'IN_CANCEL', syncedAt: new Date() },
                        })
                        tiktokUpdated++
                        // Sàn chốt hủy chung cuộc → đảo hiệu ứng (kho/HĐ/bút toán)
                        const tkNewStatus = actual ? actual.status : (isShip ? 'AWAITING_COLLECTION' : 'IN_CANCEL')
                        if (isReversalStatus(tkNewStatus)) {
                            try {
                                await reverseOnlineOrderEffects(prisma, o, { userId: req.user?.userId })
                            } catch (revErr: any) {
                                console.error(`[BulkUpdate] Reversal failed for ${o.orderNumber}:`, revErr.message)
                            }
                        }
                    } catch (e: any) {
                        errors.push(`${o.orderNumber}: ${e.message}`)
                    }
                }
            }
        }

        const result = normalIds.length > 0
            ? await prisma.onlineOrder.updateMany({ where: { id: { in: normalIds } }, data })
            : { count: 0 }

        // Bulk chuyển sang hủy/hoàn chung cuộc → đảo hiệu ứng từng đơn thường
        // (reverseOnlineOrderEffects idempotent — đơn chưa trừ kho/chưa convert
        // thì không làm gì, chỉ tốn vài query).
        if (isReversalStatus(status) && normalIds.length > 0) {
            for (const o of targets) {
                if (!normalIds.includes(o.id)) continue
                try {
                    await reverseOnlineOrderEffects(prisma, o, { userId: req.user?.userId })
                } catch (revErr: any) {
                    console.error(`[BulkUpdate] Reversal failed for ${o.orderNumber}:`, revErr.message)
                }
            }
        }

        res.json({ success: true, data: { updated: result.count + tiktokUpdated, errors } })
    } catch (err) {
        console.error('Bulk update error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ═══════════════════════════════════════════════════════════════════════════════
//  SHIPPING LABEL DOWNLOAD (Shopee Official AWB)
// ═══════════════════════════════════════════════════════════════════════════════

import { ShopeeService } from '../services/platforms'

// DEBUG: GET /api/online-orders/shipping-label-debug/:id
router.get('/shipping-label-debug/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const order = await prisma.onlineOrder.findUnique({
            where: { id: req.params.id as string },
            include: { channel: true },
        })
        if (!order) { res.json({ error: 'not found' }); return }
        const channel = order.channel
        if (!channel || channel.platform !== 'shopee') { res.json({ error: 'not shopee' }); return }

        let orderSn = (order.externalOrderId || '').replace(/^(SPE-|TIK-|LAZ-)/i, '')
        const shopee = new ShopeeService({
            apiKey: channel.apiKey || '',
            apiSecret: channel.apiSecret || '',
            accessToken: (channel as any).accessToken || '',
            refreshToken: (channel as any).refreshToken || '',
            shopId: channel.shopId || '',
        })

        const steps: any = { orderSn }

        // Step 1: get_shipping_document_parameter
        const paramUrl = (shopee as any).apiUrl('/api/v2/logistics/get_shipping_document_parameter')
        steps.step1_param = await (shopee as any).httpPost(paramUrl, { order_list: [{ order_sn: orderSn }] })

        const paramResult = steps.step1_param?.response?.result_list?.[0]
        const selectableTypes = paramResult?.selectable_shipping_document_type || []
        const suggestedType = paramResult?.suggest_shipping_document_type || 'NORMAL_AIR_WAYBILL'
        steps.selectableTypes = selectableTypes
        steps.suggestedType = suggestedType

        // Step 2: Get order detail with package_list to find real package_number
        const detailUrl = (shopee as any).apiUrl('/api/v2/order/get_order_detail') + `&order_sn_list=${orderSn}&response_optional_fields=package_list`
        steps.step2_orderDetail = await (shopee as any).httpGet(detailUrl)
        const orderDetail = steps.step2_orderDetail?.response?.order_list?.[0]
        const packageList = orderDetail?.package_list || []
        steps.packageList = packageList

        // Also get tracking number 
        const trackingUrl = (shopee as any).apiUrl('/api/v2/logistics/get_tracking_number') + `&order_sn=${orderSn}`
        steps.step2b_tracking = await (shopee as any).httpGet(trackingUrl)

        // Step 3: Try download with EACH doc type (without package_number)
        const docTypes = [suggestedType, ...selectableTypes.filter((t: string) => t !== suggestedType)]
        steps.downloadAttempts = []

        for (const docType of docTypes) {
            const orderItem = { order_sn: orderSn, shipping_document_type: docType }
            const downloadUrl = (shopee as any).apiUrl('/api/v2/logistics/download_shipping_document')
            const dlRes = await fetch(downloadUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ order_list: [orderItem] }),
            })
            const ct = dlRes.headers.get('content-type') || ''
            if (ct.includes('application/json')) {
                steps.downloadAttempts.push({ docType, result: await dlRes.json() })
            } else {
                steps.downloadAttempts.push({ docType, result: `SUCCESS PDF ${(await dlRes.arrayBuffer()).byteLength} bytes` })
            }
        }

        // Step 4: Try with real package_number from package_list
        for (const pkg of packageList) {
            const pkgNum = pkg.package_number
            if (!pkgNum) continue
            steps.realPackageNumber = pkgNum
            for (const docType of docTypes) {
                const downloadUrl2 = (shopee as any).apiUrl('/api/v2/logistics/download_shipping_document')
                const dlRes2 = await fetch(downloadUrl2, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ order_list: [{ order_sn: orderSn, package_number: pkgNum, shipping_document_type: docType }] }),
                })
                const ct2 = dlRes2.headers.get('content-type') || ''
                if (ct2.includes('application/json')) {
                    steps.downloadAttempts.push({ docType: docType + '+pkg:' + pkgNum, result: await dlRes2.json() })
                } else {
                    steps.downloadAttempts.push({ docType: docType + '+pkg:' + pkgNum, result: `SUCCESS PDF ${(await dlRes2.arrayBuffer()).byteLength} bytes` })
                }
            }

            // Step 4b: Try CREATE with package_number then download
            const createWithPkg = (shopee as any).apiUrl('/api/v2/logistics/create_shipping_document')
            const createResult = await (shopee as any).httpPost(createWithPkg, { order_list: [{ order_sn: orderSn, package_number: pkgNum, shipping_document_type: suggestedType }] })
            steps.createWithPkg = createResult

            if (!createResult.error) {
                // Wait and download
                await new Promise(r => setTimeout(r, 3000))
                const dlUrl3 = (shopee as any).apiUrl('/api/v2/logistics/download_shipping_document')
                const dlRes3 = await fetch(dlUrl3, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ order_list: [{ order_sn: orderSn, package_number: pkgNum, shipping_document_type: suggestedType }] }),
                })
                const ct3 = dlRes3.headers.get('content-type') || ''
                if (ct3.includes('application/json')) {
                    steps.downloadAttempts.push({ docType: 'afterCreate+pkg', result: await dlRes3.json() })
                } else {
                    steps.downloadAttempts.push({ docType: 'afterCreate+pkg', result: `SUCCESS PDF ${(await dlRes3.arrayBuffer()).byteLength} bytes` })
                }
            }
        }

        res.json({ success: true, debug: steps })
    } catch (err: any) {
        res.json({ success: false, error: errMsg(err) })
    }
})

// GET /api/online-orders/shipping-label/:id
router.get('/shipping-label/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const order = await prisma.onlineOrder.findUnique({
            where: { id: req.params.id as string },
            include: { channel: true },
        })
        if (!order) { res.status(404).json({ success: false, error: 'Đơn hàng không tồn tại' }); return }

        const channel = order.channel
        if (!channel || !['shopee', 'tiktok'].includes(channel.platform)) {
            res.status(400).json({ success: false, error: 'Chỉ hỗ trợ in vận đơn Shopee và TikTok. Đơn này thuộc kênh: ' + (channel?.platform || 'không rõ') })
            return
        }

        // Extract the real external order ID — strip any platform prefix
        let externalId = order.externalOrderId || ''
        externalId = externalId.replace(/^(SPE-|TIK-|LAZ-)/i, '')
        if (!externalId) {
            res.status(400).json({ success: false, error: 'Đơn này không có mã đơn ngoài (externalOrderId)' })
            return
        }

        console.log(`[Shipping Label] Order: ${order.orderNumber}, platform: ${channel.platform}, externalId: ${externalId}, Status: ${order.externalStatus}`)

        let accessToken = (channel as any).accessToken || ''
        const refreshToken = (channel as any).refreshToken || ''
        const tokenExpiresAt = (channel as any).tokenExpiresAt

        let pdf: Buffer
        let contentType: string

        if (channel.platform === 'tiktok') {
            // ── TikTok shipping label ──
            const tiktok = new TikTokService({
                apiKey: channel.apiKey || '',
                apiSecret: channel.apiSecret || '',
                accessToken,
                refreshToken,
                shopId: channel.shopId || '',
            })

            // Auto-refresh token if expired or about to expire (5 min buffer)
            if (tokenExpiresAt && new Date(tokenExpiresAt).getTime() < Date.now() + 5 * 60 * 1000) {
                console.log(`[Shipping Label] TikTok token expired, refreshing...`)
                try {
                    const tokens = await tiktok.refreshAccessToken()
                    accessToken = tokens.accessToken;
                    (tiktok as any).credentials.accessToken = tokens.accessToken;
                    (tiktok as any).credentials.refreshToken = tokens.refreshToken;
                    await prisma.onlineChannel.update({
                        where: { id: channel.id },
                        data: {
                            accessToken: tokens.accessToken,
                            refreshToken: tokens.refreshToken,
                            tokenExpiresAt: new Date(Date.now() + tokens.expiresIn * 1000),
                        },
                    })
                    console.log(`[Shipping Label] TikTok token refreshed successfully`)
                } catch (refreshErr: any) {
                    console.error('[Shipping Label] TikTok token refresh failed:', refreshErr.message)
                }
            }

            const result = await tiktok.downloadShippingLabel(externalId)
            pdf = result.pdf
            contentType = result.contentType
        } else {
            // ── Shopee shipping label ──
            const shopee = new ShopeeService({
                apiKey: channel.apiKey || '',
                apiSecret: channel.apiSecret || '',
                accessToken,
                refreshToken,
                shopId: channel.shopId || '',
            })

            // Auto-refresh token if expired or about to expire (5 min buffer)
            if (tokenExpiresAt && new Date(tokenExpiresAt).getTime() < Date.now() + 5 * 60 * 1000) {
                console.log(`[Shipping Label] Shopee token expired, refreshing...`)
                try {
                    const tokens = await shopee.refreshAccessToken()
                    accessToken = tokens.accessToken;
                    (shopee as any).credentials.accessToken = tokens.accessToken;
                    (shopee as any).credentials.refreshToken = tokens.refreshToken;
                    await prisma.onlineChannel.update({
                        where: { id: channel.id },
                        data: {
                            accessToken: tokens.accessToken,
                            refreshToken: tokens.refreshToken,
                            tokenExpiresAt: new Date(Date.now() + tokens.expiresIn * 1000),
                        },
                    })
                    console.log(`[Shipping Label] Shopee token refreshed successfully`)
                } catch (refreshErr: any) {
                    console.error('[Shipping Label] Shopee token refresh failed:', refreshErr.message)
                }
            }

            const result = await shopee.downloadShippingLabel(externalId)
            pdf = result.pdf
            contentType = result.contentType
        }

        res.setHeader('Content-Type', contentType)
        res.setHeader('Content-Disposition', `inline; filename="shipping-label-${order.orderNumber}.pdf"`)
        res.send(pdf)
    } catch (err: any) {
        console.error('Shipping label error:', err)
        const msg = err.message || 'Lỗi tải vận đơn'
        // Friendly Vietnamese messages for common errors
        let friendly = msg
        if (msg.includes('batch_api_all_failed')) {
            friendly = 'Đơn chưa sẵn sàng in vận đơn. Cần ở trạng thái "Chờ gửi hàng" (READY_TO_SHIP) trên Shopee.'
        } else if (msg.includes('order_status')) {
            friendly = 'Trạng thái đơn không hỗ trợ in vận đơn. Đơn phải đang "Chờ gửi hàng".'
        } else if (msg.includes('chưa có kiện hàng')) {
            friendly = msg // Already Vietnamese
        } else if (msg.includes('TikTok shipping document')) {
            friendly = `Lỗi lấy vận đơn TikTok: ${msg}`
        }
        res.status(500).json({ success: false, error: friendly })
    }
})

// POST /api/online-orders/shipping-label-batch — Multiple orders → 1 merged PDF
router.post('/shipping-label-batch', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { orderIds } = req.body as { orderIds: string[] }
        if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
            res.status(400).json({ success: false, error: 'Cần truyền danh sách orderIds' }); return
        }

        // Fetch all orders
        const orders = await prisma.onlineOrder.findMany({
            where: { id: { in: orderIds } },
            include: { channel: true },
        })

        // Group by platform — support Shopee + TikTok
        const supportedOrders = orders.filter(o => ['shopee', 'tiktok'].includes(o.channel?.platform || ''))
        if (supportedOrders.length === 0) {
            res.status(400).json({ success: false, error: 'Không có đơn Shopee/TikTok nào trong danh sách' }); return
        }

        const { PDFDocument } = await import('pdf-lib')
        const pdfBuffers: Buffer[] = []
        const errors: string[] = []

        // Group orders by channelId to batch by channel
        const byChannel = new Map<string, typeof supportedOrders>()
        for (const o of supportedOrders) {
            const cid = o.channelId || 'unknown'
            if (!byChannel.has(cid)) byChannel.set(cid, [])
            byChannel.get(cid)!.push(o)
        }

        for (const [channelId, channelOrders] of byChannel) {
            const channel = channelOrders[0].channel!
            let accessToken = (channel as any).accessToken || ''
            const refreshToken = (channel as any).refreshToken || ''
            const tokenExpiresAt = (channel as any).tokenExpiresAt

            if (channel.platform === 'tiktok') {
                // ── TikTok batch ──
                const tiktok = new TikTokService({
                    apiKey: channel.apiKey || '', apiSecret: channel.apiSecret || '',
                    accessToken, refreshToken, shopId: channel.shopId || '',
                })
                if (tokenExpiresAt && new Date(tokenExpiresAt).getTime() < Date.now() + 5 * 60 * 1000) {
                    try {
                        const tokens = await tiktok.refreshAccessToken();
                        (tiktok as any).credentials.accessToken = tokens.accessToken;
                        (tiktok as any).credentials.refreshToken = tokens.refreshToken;
                        await prisma.onlineChannel.update({ where: { id: channel.id }, data: { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, tokenExpiresAt: new Date(Date.now() + tokens.expiresIn * 1000) } })
                    } catch (e: any) { console.error('[Batch] TikTok token refresh failed:', e.message) }
                }
                for (const o of channelOrders) {
                    let eid = (o.externalOrderId || '').replace(/^(SPE-|TIK-|LAZ-)/i, '')
                    if (!eid) { errors.push(`${o.orderNumber}: không có externalOrderId`); continue }
                    try {
                        const { pdf } = await tiktok.downloadShippingLabel(eid)
                        pdfBuffers.push(pdf)
                    } catch (e: any) { errors.push(`${o.orderNumber}: ${e.message}`) }
                }
            } else {
                // ── Shopee batch ──
                const shopee = new ShopeeService({
                    apiKey: channel.apiKey || '', apiSecret: channel.apiSecret || '',
                    accessToken, refreshToken, shopId: channel.shopId || '',
                })
                if (tokenExpiresAt && new Date(tokenExpiresAt).getTime() < Date.now() + 5 * 60 * 1000) {
                    try {
                        const tokens = await shopee.refreshAccessToken();
                        (shopee as any).credentials.accessToken = tokens.accessToken;
                        (shopee as any).credentials.refreshToken = tokens.refreshToken;
                        await prisma.onlineChannel.update({ where: { id: channel.id }, data: { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, tokenExpiresAt: new Date(Date.now() + tokens.expiresIn * 1000) } })
                    } catch (e: any) { console.error('[Batch] Shopee token refresh failed:', e.message) }
                }
                const orderSnList = channelOrders.map(o => (o.externalOrderId || '').replace(/^(SPE-|TIK-|LAZ-)/i, '')).filter(sn => sn.length > 0)
                const { pdf: batchPdf, errors: batchErrors } = await shopee.downloadShippingLabelBatch(orderSnList)
                pdfBuffers.push(batchPdf)
                errors.push(...batchErrors)
            }
        }

        if (pdfBuffers.length === 0) {
            // Lỗi từ sàn (đơn chưa sẵn sàng / đã lấy hàng...) là thông tin người dùng cần
            // thấy — trả 400 với chi tiết từng đơn thay vì 500 bị errMsg che trong prod.
            res.status(400).json({ success: false, error: `Không tải được vận đơn:\n${errors.join('\n')}` })
            return
        }

        // Merge all PDFs into 1
        let pdf: Buffer
        let contentType = 'application/pdf'
        if (pdfBuffers.length === 1) {
            pdf = pdfBuffers[0]
        } else {
            const merged = await PDFDocument.create()
            for (const buf of pdfBuffers) {
                try {
                    const src = await PDFDocument.load(buf, { ignoreEncryption: true })
                    const pages = await merged.copyPages(src, src.getPageIndices())
                    pages.forEach(p => merged.addPage(p))
                } catch (e: any) { errors.push(`PDF merge error: ${e.message}`) }
            }
            pdf = Buffer.from(await merged.save())
        }

        // Log any partial errors
        if (errors.length > 0) {
            console.warn(`[Shipping Label Batch] Partial errors: ${errors.join('; ')}`)
        }

        res.setHeader('Content-Type', contentType)
        res.setHeader('Content-Disposition', `inline; filename="shipping-labels-batch.pdf"`)
        if (errors.length > 0) {
            res.setHeader('X-Batch-Errors', JSON.stringify(errors))
        }
        res.send(pdf)
    } catch (err: any) {
        console.error('Batch shipping label error:', err)
        res.status(500).json({ success: false, error: errMsg(err, 'Lỗi tải vận đơn hàng loạt') })
    }
})

// ═══════════════════════════════════════════════════════════════════════════════
//  PLATFORM INTEGRATION — OAuth, Sync, Test Connection
// ═══════════════════════════════════════════════════════════════════════════════

import { getPlatformService, isSupportedPlatform, TikTokService, type PlatformOrder } from '../services/platforms'
import { processNewOrders, convertOnlineOrderToTransaction } from '../services/orderSync'
import { syncChannelReturns } from '../services/returnSync'

// GET /api/online-orders/channels/:id/auth-url
router.get('/channels/:id/auth-url', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const channel = await prisma.onlineChannel.findUnique({ where: { id: req.params.id as string } })
        if (!channel) { res.status(404).json({ success: false, error: 'Kênh không tồn tại' }); return }
        if (!isSupportedPlatform(channel.platform)) {
            res.status(400).json({ success: false, error: `Nền tảng "${channel.platform}" không hỗ trợ kết nối API tự động` })
            return
        }

        // Thiếu App Key/Secret thì URL uỷ quyền vẫn sinh được nhưng sàn sẽ trả trang lỗi
        // khó hiểu ("Thiếu Tham số" bên Lazada) — báo rõ ngay tại đây.
        const apiKey = (channel.apiKey || '').trim()
        const apiSecret = (channel.apiSecret || '').trim()
        if (!apiKey || !apiSecret) {
            const missing = [!apiKey && 'App Key', !apiSecret && 'App Secret'].filter(Boolean).join(' và ')
            res.status(400).json({ success: false, error: `Kênh chưa có ${missing}. Vui lòng nhập thông tin ứng dụng của kênh rồi kết nối lại.` })
            return
        }

        const service = getPlatformService(channel.platform, {
            apiKey, apiSecret,
            shopId: channel.shopId || undefined,
        })
        if (!service) { res.status(400).json({ success: false, error: 'Nền tảng chưa được hỗ trợ' }); return }

        const baseUrl = process.env.APP_BASE_URL || `${req.protocol}://${req.get('host')}`
        const redirectUri = channel.platform === 'tiktok'
            ? `${baseUrl}/api/online-orders/tiktok/callback`
            : `${baseUrl}/api/online-orders/channels/${channel.id}/callback`
        const state = Buffer.from(JSON.stringify({ channelId: channel.id })).toString('base64')
        let authUrl: string
        try {
            authUrl = service.generateAuthUrl(redirectUri, state)
        } catch (e: any) {
            // Lỗi cấu hình (App Key rỗng, Partner ID không phải số…) là lỗi người dùng, không phải 500
            res.status(400).json({ success: false, error: errMsg(e, 'Không tạo được liên kết uỷ quyền') })
            return
        }

        res.json({ success: true, data: { authUrl, redirectUri } })
    } catch (err: any) {
        console.error('Generate auth URL error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// GET /api/online-orders/tiktok/callback — generic TikTok OAuth callback
// TikTok redirects here with ?code=...&state=... (state = base64 JSON {channelId})
router.get('/tiktok/callback', async (req: AuthRequest, res: Response) => {
    try {
        const { code, state, shop_id } = req.query
        if (!code || !state) { res.status(400).send('Missing code or state'); return }

        // Decode state to get channelId
        let channelId: string
        try {
            const decoded = JSON.parse(Buffer.from(state as string, 'base64').toString())
            channelId = decoded.channelId
        } catch {
            res.status(400).send('Invalid state parameter')
            return
        }

        // Redirect to frontend with OAuth code
        const frontendUrl = process.env.FRONTEND_URL || 'https://kengi.vn'
        const redirectUrl = `${frontendUrl}/dashboard-online-orders?oauth_code=${encodeURIComponent(code as string)}&channel_id=${encodeURIComponent(channelId)}${shop_id ? '&shop_id=' + encodeURIComponent(shop_id as string) : ''}`
        res.redirect(redirectUrl)
    } catch (err: any) {
        console.error('TikTok OAuth callback error:', err)
        res.status(500).send('Lỗi kết nối: ' + err.message)
    }
})

// GET /api/online-orders/channels/:id/callback?code=...&state=...
router.get('/channels/:id/callback', async (req: AuthRequest, res: Response) => {
    try {
        const { code, shop_id } = req.query
        if (!code) { res.status(400).send('Missing authorization code'); return }

        const channelId = req.params.id as string
        // Redirect to frontend with OAuth code — frontend will call exchangeToken  
        const frontendUrl = process.env.FRONTEND_URL || 'https://kengi.vn'
        const redirectUrl = `${frontendUrl}/dashboard-online-orders?oauth_code=${encodeURIComponent(code as string)}&channel_id=${encodeURIComponent(channelId)}${shop_id ? '&shop_id=' + encodeURIComponent(shop_id as string) : ''}`
        res.redirect(redirectUrl)
    } catch (err: any) {
        console.error('OAuth callback error:', err)
        res.status(500).send('Lỗi kết nối: ' + err.message)
    }
})

// POST /api/online-orders/channels/:id/exchange-token  (body: { code, shopId?, syncFromDate? })
router.post('/channels/:id/exchange-token', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const channel = await prisma.onlineChannel.findUnique({ where: { id: req.params.id as string } })
        if (!channel) { res.status(404).json({ success: false, error: 'Kênh không tồn tại' }); return }

        // Mốc đồng bộ lịch sử do người dùng chọn lúc kết nối. Lần sync đầu lấy đơn
        // từ mốc này; sau đó chỉ nhận gia số (lastSyncAt) + webhook. Giới hạn 365 ngày.
        let syncFromDate: Date | null = null
        if (req.body.syncFromDate) {
            const d = new Date(req.body.syncFromDate)
            if (isNaN(d.getTime())) { res.status(400).json({ success: false, error: 'syncFromDate không hợp lệ' }); return }
            const oneYearAgo = Date.now() - 365 * 86400_000
            syncFromDate = new Date(Math.min(Math.max(d.getTime(), oneYearAgo), Date.now()))
        }

        const service = getPlatformService(channel.platform, {
            apiKey: channel.apiKey || '', apiSecret: channel.apiSecret || '',
            shopId: req.body.shopId || channel.shopId || undefined,
        })
        if (!service) { res.status(400).json({ success: false, error: 'Nền tảng chưa được hỗ trợ' }); return }

        const baseUrl = process.env.APP_BASE_URL || `${req.protocol}://${req.get('host')}`
        const redirectUri = `${baseUrl}/api/online-orders/channels/${channel.id}/callback`
        const tokens = await service.exchangeToken(req.body.code, redirectUri)

        await prisma.onlineChannel.update({
            where: { id: channel.id },
            data: {
                accessToken: tokens.accessToken,
                refreshToken: tokens.refreshToken,
                tokenExpiresAt: new Date(Date.now() + tokens.expiresIn * 1000),
                shopId: tokens.shopId || channel.shopId,
                ...(tokens.platformShopId ? { platformShopId: tokens.platformShopId } : {}),
                syncEnabled: true,
                ...(syncFromDate ? { syncFromDate, lastSyncAt: null } : {}),
            },
        })

        await prisma.syncLog.create({
            data: { channelId: channel.id, action: 'exchange_token', status: 'success', details: `Token obtained, shop: ${tokens.shopId || 'N/A'}` },
        })

        // Trả kèm platform/tên kênh để FE báo đúng tên sàn vừa kết nối (trước đây
        // toast hardcode "Shopee" nên kết nối Lazada vẫn báo Shopee).
        res.json({ success: true, data: { shopId: tokens.shopId, expiresIn: tokens.expiresIn, platform: channel.platform, channelName: channel.name } })
    } catch (err: any) {
        console.error('Exchange token error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// POST /api/online-orders/channels/:id/sync
// ── Thứ tự vòng đời đơn ──────────────────────────────────────────────────────
// Ta suy ra "đã giao" từ VẬN ĐƠN, thường sớm hơn lúc sàn kịp đổi trạng thái ĐƠN.
// Không có rào này thì lượt sync kế tiếp thấy sàn vẫn báo AWAITING_COLLECTION và
// đẩy ngược đơn về lại — cứ thế giật qua giật lại mỗi lần đồng bộ.
const LIFECYCLE_RANK: Record<string, number> = {
    UNPAID: 0, ON_HOLD: 0, INVOICE_PENDING: 0, pending: 0,
    READY_TO_SHIP: 1, AWAITING_SHIPMENT: 1, confirmed: 1,
    PROCESSED: 2, AWAITING_COLLECTION: 2, processing: 2,
    SHIPPED: 3, IN_TRANSIT: 3, PARTIALLY_SHIPPING: 3, RETRY_SHIP: 3, shipping: 3,
    TO_CONFIRM_RECEIVE: 4, DELIVERED: 4, delivered: 4,
    COMPLETED: 5, completed: 5,
}
// Huỷ / hoàn là phán quyết cuối của sàn — LUÔN được ghi đè, kể cả khi "lùi".
const TERMINAL_BRANCH = new Set(['CANCELLED', 'cancelled', 'IN_CANCEL', 'cancelling', 'TO_RETURN', 'returned'])
const canAdvance = (from: string, to: string): boolean => {
    if (to === from) return false
    if (TERMINAL_BRANCH.has(to)) return true
    return (LIFECYCLE_RANK[to] ?? -1) >= (LIFECYCLE_RANK[from] ?? -1)
}

router.post('/channels/:id/sync', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const channel = await prisma.onlineChannel.findUnique({ where: { id: req.params.id as string } })
        if (!channel) { res.status(404).json({ success: false, error: 'Kênh không tồn tại' }); return }

        const service = getPlatformService(channel.platform, {
            apiKey: channel.apiKey || '', apiSecret: channel.apiSecret || '',
            accessToken: channel.accessToken || undefined,
            refreshToken: channel.refreshToken || undefined,
            shopId: channel.shopId || undefined,
        })
        if (!service) { res.status(400).json({ success: false, error: 'Nền tảng chưa được hỗ trợ' }); return }

        // ── Auto-refresh token if expired or about to expire (5 min buffer) ──
        const tokenExpiresAt = (channel as any).tokenExpiresAt
        const needsRefresh = tokenExpiresAt && new Date(tokenExpiresAt).getTime() < Date.now() + 5 * 60 * 1000
        if (needsRefresh) {
            console.log(`[Sync] Token expired/expiring for channel ${channel.name}, refreshing...`)
            try {
                const tokens = await service.refreshAccessToken();
                (service as any).credentials.accessToken = tokens.accessToken;
                (service as any).credentials.refreshToken = tokens.refreshToken;
                await prisma.onlineChannel.update({
                    where: { id: channel.id },
                    data: {
                        accessToken: tokens.accessToken,
                        refreshToken: tokens.refreshToken,
                        tokenExpiresAt: new Date(Date.now() + tokens.expiresIn * 1000),
                    },
                })
                console.log(`[Sync] Token refreshed successfully for ${channel.name}`)
            } catch (refreshErr: any) {
                console.error(`[Sync] Token refresh failed for ${channel.name}:`, refreshErr.message)
                // Continue anyway — the old token might still work briefly
            }
        }

        // ── TikTok: ensure we have the real shop_cipher ──────────────────────
        // Order/product endpoints require shop_cipher (NOT open_id). Older
        // connections stored open_id as shopId; re-resolve it from
        // /authorization/202309/shops and persist if it changed (self-heal).
        if (channel.platform === 'tiktok' && service instanceof TikTokService && (service as any).credentials.accessToken) {
            try {
                const shops = await service.getAuthorizedShops()
                const cipher = shops[0]?.cipher || shops[0]?.shop_cipher || undefined
                // Webhook payloads carry the numeric shop id — persist it so the
                // webhook handler can match the channel (shopId holds the cipher).
                const numericId = shops[0]?.id ? String(shops[0].id) : undefined
                const heal: any = {}
                if (cipher && cipher !== channel.shopId) {
                    (service as any).credentials.shopId = cipher
                    heal.shopId = cipher
                }
                if (numericId && numericId !== (channel as any).platformShopId) heal.platformShopId = numericId
                if (Object.keys(heal).length) {
                    await prisma.onlineChannel.update({ where: { id: channel.id }, data: heal })
                    console.log(`[Sync] Resolved TikTok shop ids for ${channel.name}: ${JSON.stringify(Object.keys(heal))}`)
                }
            } catch (cipherErr: any) {
                console.error(`[Sync] Failed to resolve TikTok shop_cipher for ${channel.name}:`, cipherErr.message)
            }

            // Order endpoints are unusable without a shop_cipher. If we still don't have
            // one (resolution failed AND none was stored), stop here with a clear,
            // actionable message rather than letting fetchOrders 500 opaquely.
            if (!(service as any).credentials.shopId) {
                res.status(400).json({
                    success: false,
                    error: 'Không lấy được shop_cipher từ TikTok — vui lòng kết nối lại (authorize) TikTok Shop',
                })
                return
            }
        }

        // ── Khoảng thời gian sync ────────────────────────────────────────────
        // Lần sync đầu (chưa có lastSyncAt): kéo lịch sử từ syncFromDate người
        // dùng chọn lúc kết nối (mặc định 14 ngày). Các lần sau: chỉ lấy gia số
        // từ lastSyncAt (lùi 1h để không sót đơn ở biên) — đơn phát sinh giữa
        // các lần sync đã có webhook đẩy về realtime.
        const now = new Date()
        const syncFromDate = (channel as any).syncFromDate ? new Date((channel as any).syncFromDate) : null

        // Khoảng tuỳ chọn từ client: { from, to } (ISO). Nếu có thì ưu tiên,
        // ngược lại giữ nguyên hành vi cũ (lastSyncAt gia số / syncFromDate / 14 ngày).
        const bodyFrom = req.body?.from ? new Date(String(req.body.from)) : null
        const bodyTo = req.body?.to ? new Date(String(req.body.to)) : null
        if ((bodyFrom && isNaN(bodyFrom.getTime())) || (bodyTo && isNaN(bodyTo.getTime()))) {
            res.status(400).json({ success: false, error: 'Ngày không hợp lệ (from/to phải là ISO date)' }); return
        }

        let since: Date
        let until: Date
        if (bodyFrom || bodyTo) {
            since = bodyFrom || (channel.lastSyncAt
                ? new Date(new Date(channel.lastSyncAt).getTime() - 60 * 60_000)
                : (syncFromDate || new Date(now.getTime() - 14 * 86400_000)))
            until = bodyTo || now
            if (until.getTime() < since.getTime()) {
                res.status(400).json({ success: false, error: 'Khoảng thời gian không hợp lệ (to phải >= from)' }); return
            }
            if (until.getTime() - since.getTime() > 2 * 365 * 86400_000) {
                res.status(400).json({ success: false, error: 'Khoảng thời gian quá lớn (tối đa ~2 năm)' }); return
            }
        } else {
            since = channel.lastSyncAt
                ? new Date(new Date(channel.lastSyncAt).getTime() - 60 * 60_000)
                : (syncFromDate || new Date(now.getTime() - 14 * 86400_000))
            until = now
        }

        // Shopee giới hạn cửa sổ thời gian 15 ngày/lần gọi → chia range dài thành
        // các khung 14 ngày. TikTok/Lazada nhận range tuỳ ý → một khung duy nhất.
        const WINDOW_MS = 14 * 86400_000
        const windows: { from: Date; to: Date }[] = []
        if (channel.platform === 'shopee') {
            for (let t = since.getTime(); t < until.getTime(); t += WINDOW_MS) {
                windows.push({ from: new Date(t), to: new Date(Math.min(t + WINDOW_MS, until.getTime())) })
            }
        }
        if (windows.length === 0) windows.push({ from: since, to: until })

        let allOrders: PlatformOrder[] = []

        // Optional status filter: ?status=UNPAID,AWAITING_SHIPMENT,...
        // TikTok orders/search only filters by ONE native status per call, so we
        // loop over each requested status. No status → single unfiltered pass.
        const statusFilter = String(req.query.status || '')
            .split(',').map(s => s.trim()).filter(Boolean)
        const statusList: (string | undefined)[] = statusFilter.length ? statusFilter : [undefined]

        // Kéo lịch sử (from/to hoặc lần đầu theo syncFromDate) phải theo NGÀY ĐẶT
        // (create_time) — update_time làm đơn cũ rơi lệch khung, backfill lỗ chỗ
        // (case KENGISTORE thiếu 10-14 & 24-30/06). Sync gia số giữ update_time để
        // bắt cả thay đổi trạng thái.
        const isBackfill = Boolean(bodyFrom || bodyTo || !channel.lastSyncAt)
        const timeRangeField: 'create_time' | 'update_time' = isBackfill ? 'create_time' : 'update_time'
        // Trần trang/khung: 20 (1000 đơn) quá thấp cho shop đơn nhiều → backfill 80.
        const PAGE_CAP = isBackfill ? 80 : 20
        const MAX_ORDERS = isBackfill ? 20000 : 5000
        // HẠN GIỜ: Cloud Run cắt request ở 300s → khoảng dài (tối đa 2 năm = 52
        // khung Shopee) chắc chắn 504 và người dùng thấy "lỗi" dù đơn đã kéo về.
        // Dừng chủ động ở 230s, trả kết quả MỘT PHẦN kèm mốc đã kéo tới đâu để
        // bấm chạy tiếp — thà đồng bộ dở mà biết, còn hơn 504 mù.
        const DEADLINE_MS = 230_000
        const startedAt = Date.now()
        let stoppedAt: Date | null = null
        const fetchWithRetry = async () => {
            allOrders = []
            stoppedAt = null
            for (const win of windows) {
                if (Date.now() - startedAt > DEADLINE_MS) {
                    stoppedAt = win.from
                    console.warn(`[Sync] ${channel.name}: DỪNG vì quá ${DEADLINE_MS / 1000}s — mới kéo tới ${win.from.toISOString().slice(0, 10)}`)
                    break
                }
                for (const st of statusList) {
                    let page = 1
                    let hasMore = true
                    // TikTok v202309 uses opaque page_token cursors; other platforms use
                    // numeric `page`. Thread both — each platform reads what it needs.
                    let pageToken: string | undefined = undefined
                    while (hasMore && page <= PAGE_CAP && allOrders.length < MAX_ORDERS) {
                        const result: { orders: PlatformOrder[]; hasMore: boolean; total: number; nextPageToken?: string } =
                            await service.fetchOrders({ since: win.from, until: win.to, page, pageSize: 50, status: st, pageToken, timeRangeField })
                        allOrders = allOrders.concat(result.orders)
                        pageToken = result.nextPageToken
                        hasMore = result.hasMore
                        page++
                    }
                    // KHÔNG cắt âm thầm: còn trang mà chạm trần thì phải thấy trong log
                    if (hasMore) {
                        console.warn(`[Sync] ${channel.name}: CHẠM TRẦN ở khung ${win.from.toISOString().slice(0, 10)}→${win.to.toISOString().slice(0, 10)}` +
                            ` (page>${PAGE_CAP} hoặc >${MAX_ORDERS} đơn) — khung này có thể thiếu đơn, chạy lại với khoảng hẹp hơn`)
                    }
                }
            }
        }

        try {
            await fetchWithRetry()
        } catch (fetchErr: any) {
            // If it's a token error, try refresh once and retry.
            // Shopee: invalid_access_token / error_auth. TikTok v202309: code 105002
            // (invalid access_token) / 105001 (access_token expired).
            const msg = String(fetchErr.message || '')
            if (msg.includes('invalid_access_token') || msg.includes('error_auth')
                || msg.includes('105002') || msg.includes('105001')) {
                console.log(`[Sync] Token error during fetch, attempting refresh and retry...`)
                try {
                    const tokens = await service.refreshAccessToken();
                    (service as any).credentials.accessToken = tokens.accessToken;
                    (service as any).credentials.refreshToken = tokens.refreshToken;
                    await prisma.onlineChannel.update({
                        where: { id: channel.id },
                        data: {
                            accessToken: tokens.accessToken,
                            refreshToken: tokens.refreshToken,
                            tokenExpiresAt: new Date(Date.now() + tokens.expiresIn * 1000),
                        },
                    })
                    console.log(`[Sync] Token refreshed on retry, re-fetching...`)
                    await fetchWithRetry()
                } catch (retryErr: any) {
                    throw new Error(`Shopee token refresh failed: ${retryErr.message}. Vui lòng kết nối lại Shopee.`)
                }
            } else {
                throw fetchErr
            }
        }

        // Import orders into DB
        let imported = 0, updated = 0
        const errors: string[] = []

        // ── Mã vận đơn Shopee ────────────────────────────────────────────────
        // get_order_detail KHÔNG trả tracking_no (chỉ trả shipping_carrier, nên
        // nhìn cột vận chuyển tưởng đủ) → phải hỏi logistics API cho từng đơn.
        // BUG CŨ: chỗ này dựng ShopeeService MỚI từ `channel` — bản ghi đọc ở DB
        // lúc đầu request. Nhưng token có thể vừa được làm mới ở trên, và refresh
        // chỉ ghi vào DB + vào `service`, KHÔNG ghi ngược vào `channel`. Service
        // mới vì thế cầm token đã chết: mọi call trả error_auth, bị getTrackingNumber
        // nuốt thành null → đơn Shopee luôn trống mã trong khi sync vẫn báo ✅.
        // Token Shopee sống 4 tiếng nên nhánh refresh chạy gần như mỗi lần sync.
        // Dùng thẳng `service` để luôn đi bằng token đang sống.
        const shopeeSvc = channel.platform === 'shopee' && service instanceof ShopeeService ? service : null
        // Đã rời kho → sàn chắc chắn đã cấp mã. Kèm dạng chữ thường của bản map cũ.
        const TRACKABLE_SYNC = ['shipping', 'delivered', 'completed', 'SHIPPED', 'COMPLETED', 'TO_CONFIRM_RECEIVE', 'PROCESSED']
        // Lỗi cấp kênh (token/quyền/IP) thì hỏi tiếp hàng trăm đơn nữa cũng hỏng y
        // hệt — ghi lại rồi thôi, và báo lên cho người bấm sync biết.
        let trackingChannelDead = ''
        const fetchTracking = async (o: PlatformOrder): Promise<string | null> => {
            if (!shopeeSvc || trackingChannelDead || !TRACKABLE_SYNC.includes(o.status)) return null
            try {
                return (await shopeeSvc.getTrackingNumber(o.externalOrderId)) || null
            } catch (e: any) {
                trackingChannelDead = String(e?.message || e)
                console.error(`[Sync] ${channel.name}: dừng lấy mã vận đơn —`, trackingChannelDead)
                return null
            }
        }

        for (const order of allOrders) {
            try {
                const existing = await prisma.onlineOrder.findFirst({
                    where: { externalOrderId: order.externalOrderId, channelId: channel.id },
                })

                if (existing) {
                    // Fetch tracking number from logistics API if missing
                    let trackingNo = order.trackingNumber || existing.trackingNumber
                    let carrier = order.shippingCarrier || existing.shippingCarrier
                    if (!trackingNo) trackingNo = await fetchTracking(order)

                    // Update existing order
                    await prisma.onlineOrder.update({
                        where: { id: existing.id },
                        data: {
                            status: order.status,
                            externalStatus: order.externalStatus,
                            paymentStatus: order.paymentStatus,
                            trackingNumber: trackingNo,
                            shippingCarrier: carrier,
                            shippedAt: order.shippedAt ? new Date(order.shippedAt) : existing.shippedAt,
                            deliveredAt: order.deliveredAt ? new Date(order.deliveredAt) : existing.deliveredAt,
                            paidAt: order.paidAt ? new Date(order.paidAt) : existing.paidAt,
                            syncedAt: new Date(),
                        },
                    })
                    updated++
                } else {
                    // Fetch tracking for new Shopee orders that already shipped
                    let newTrackingNo = order.trackingNumber || null
                    if (!newTrackingNo) newTrackingNo = await fetchTracking(order)

                    // Create new order
                    await prisma.onlineOrder.create({
                        data: {
                            orderNumber: order.orderNumber,
                            channelId: channel.id,
                            channelName: channel.name,
                            platform: order.platform,
                            externalOrderId: order.externalOrderId,
                            externalStatus: order.externalStatus,
                            customerName: order.customerName,
                            customerPhone: order.customerPhone || null,
                            customerEmail: order.customerEmail || null,
                            shippingAddress: order.shippingAddress || null,
                            status: order.status,
                            subtotal: order.subtotal,
                            discount: order.discount,
                            shippingFee: order.shippingFee,
                            total: order.total,
                            paymentMethod: order.paymentMethod || null,
                            paymentStatus: order.paymentStatus,
                            trackingNumber: newTrackingNo,
                            shippingCarrier: order.shippingCarrier || null,
                            paidAt: order.paidAt ? new Date(order.paidAt) : null,
                            shippedAt: order.shippedAt ? new Date(order.shippedAt) : null,
                            deliveredAt: order.deliveredAt ? new Date(order.deliveredAt) : null,
                            syncedAt: new Date(),
                            createdAt: new Date(order.createdAt),
                            // PHÍ SÀN KHÔNG TỰ TÍNH: trước đây ước bằng tổng tiền ×
                            // hoa hồng cấu hình (6%) rồi hiện như phí thật — con số
                            // bịa, lệch xa phí thực tế (Shopee còn phí thanh toán,
                            // voucher, vận chuyển...). Chỉ /sync-fees lấy escrow THẬT
                            // từ sàn mới được ghi vào đây. Chưa có thì để 0 = "chưa
                            // đối soát", giao diện hiện "—".
                            platformFeeRate: 0,
                            platformFee: 0,
                            netRevenue: 0,
                            items: {
                                create: order.items.map(item => ({
                                    productName: item.productName,
                                    sku: item.sku || null,
                                    quantity: item.quantity,
                                    unitPrice: item.unitPrice,
                                    discount: item.discount,
                                    lineTotal: item.lineTotal,
                                })),
                            },
                        },
                    })
                    imported++
                }
            } catch (e: any) {
                errors.push(`Order ${order.orderNumber}: ${e.message}`)
            }
        }

        // Đơn vẫn về đủ (fetch dùng token sống) nhưng mã vận đơn thì không —
        // phải nói ra, nếu không sync lại báo ✅ và không ai biết vì sao trống mã.
        if (trackingChannelDead) {
            errors.push(`Không lấy được mã vận đơn: ${trackingChannelDead}. Vui lòng kết nối lại gian hàng.`)
        }

        // Update channel stats
        const orderStats = await prisma.onlineOrder.aggregate({
            where: { channelId: channel.id },
            _count: true,
            _sum: { total: true },
        })
        await prisma.onlineChannel.update({
            where: { id: channel.id },
            data: {
                // Dừng giữa chừng vì hết giờ → mốc đồng bộ CHỈ tới khung dở dang,
                // không được nhảy lên "bây giờ" (làm mất hẳn khoảng chưa kéo).
                lastSyncAt: stoppedAt || new Date(),
                totalOrders: orderStats._count,
                totalRevenue: orderStats._sum.total || 0,
            },
        })

        // Log sync
        await prisma.syncLog.create({
            data: {
                channelId: channel.id,
                action: 'sync_orders',
                status: errors.length > 0 ? 'partial' : 'success',
                details: `Imported: ${imported}, Updated: ${updated}, Errors: ${errors.length}${errors.length > 0 ? '\n' + errors.slice(0, 5).join('\n') : ''}`,
                ordersCount: imported + updated,
            },
        })

        // Auto-convert eligible orders to transactions + deduct inventory
        let converted = 0
        try {
            converted = await processNewOrders(prisma, channel.id)
        } catch (e: any) {
            console.error('Order conversion error:', e.message)
        }

        // ── Batch refresh status của đơn cũ chưa kết thúc ──────────────────────
        // Shopee chỉ sync đơn mới theo create_time → đơn SHIPPED từ tháng trước không được cập nhật
        // → Query DB lấy đơn chưa kết thúc, gọi get_order_detail để lấy status mới nhất
        let statusRefreshed = 0
        if (channel.platform === 'shopee') {
            try {
                const NON_TERMINAL = ['pending','confirmed','processing','shipping','delivered','UNPAID','READY_TO_SHIP','PROCESSED','SHIPPED','TO_CONFIRM_RECEIVE','IN_CANCEL']
                const pendingOrders = await prisma.onlineOrder.findMany({
                    where: { channelId: channel.id, status: { in: NON_TERMINAL }, externalOrderId: { not: null } },
                    select: { id: true, externalOrderId: true, status: true, trackingNumber: true, shippingCarrier: true },
                })

                if (pendingOrders.length > 0) {
                    // Lấy externalOrderId, strip prefix SPE-
                    const snToId: Record<string, string> = {}
                    const snToOld: Record<string, { status: string; trackingNumber: string | null; shippingCarrier: string | null }> = {}
                    for (const o of pendingOrders) {
                        const sn = (o.externalOrderId || '').replace(/^(SPE-|TIK-|LAZ-)/i, '')
                        if (sn) { snToId[sn] = o.id; snToOld[sn] = { status: o.status, trackingNumber: o.trackingNumber, shippingCarrier: o.shippingCarrier } }
                    }
                    const orderSns = Object.keys(snToId)
                    console.log(`[Sync] Refreshing status of ${orderSns.length} pending orders...`)

                    // Mẻ 20 chứ không phải 50: URL 50 mã đơn dài hơn 1KB, đi qua proxy
                    // Tino thì mẻ nào cũng "fetch failed" — cả 7 mẻ hỏng sạch, đốt ~70s
                    // của ngân sách 300s mà không cập nhật nổi một đơn.
                    const BATCH = 20
                    // Dùng lại `service` như vòng lặp import: dựng service mới từ `channel`
                    // là cầm token đọc từ DB lúc đầu request, đã chết nếu vừa refresh.
                    const shopeeForRefresh = shopeeSvc ?? new ShopeeService({
                        apiKey: channel.apiKey || '', apiSecret: channel.apiSecret || '',
                        accessToken: (channel as any).accessToken || '',
                        refreshToken: (channel as any).refreshToken || '',
                        shopId: channel.shopId || '',
                    })
                    let batchFailed = 0
                    for (let i = 0; i < orderSns.length; i += BATCH) {
                        const batch = orderSns.slice(i, i + BATCH)
                        // Mẻ nào cũng hỏng = proxy/kênh đang chết, chạy nốt 300 đơn nữa
                        // chỉ để chạm trần 300s rồi trả 504. Bỏ sớm, báo lên errors.
                        if (batchFailed >= 3) {
                            errors.push(`Làm mới trạng thái: bỏ dở sau ${batchFailed} mẻ lỗi liên tiếp`)
                            break
                        }
                        try {
                            const detailPath = '/api/v2/order/get_order_detail'
                            // XIN order_status, KHÔNG xin tracking_no.
                            // Cả khối này đọc d.order_status để quyết định cập nhật, nhưng
                            // lại chỉ xin tracking_no + shipping_carrier. tracking_no KHÔNG
                            // phải trường của get_order_detail (đó là lý do mã vận đơn xưa
                            // nay luôn rỗng, phải lấy qua logistics API). Xin trường không
                            // tồn tại thì Shopee trả error, order_list rỗng — và dòng dưới
                            // nuốt luôn error → "Status refreshed: 0/323" lặp mãi, đơn đứng
                            // im ở trạng thái lúc nhập lần đầu.
                            const detailUrl = (shopeeForRefresh as any).apiUrl(detailPath) +
                                `&order_sn_list=${batch.join(',')}&response_optional_fields=order_status,shipping_carrier`
                            const detailData: any = await (shopeeForRefresh as any).httpGet(detailUrl)
                            if (detailData?.error) {
                                throw new Error(`Shopee: ${detailData.error}${detailData.message ? ` - ${detailData.message}` : ''}`)
                            }
                            const details: any[] = detailData.response?.order_list || []

                            for (const d of details) {
                                const sn: string = d.order_sn
                                const dbId = snToId[sn]
                                if (!dbId) continue
                                const newStatus: string = (shopeeForRefresh as any).mapStatus(d.order_status)
                                const newPayStatus: string = (shopeeForRefresh as any).mapPaymentStatus(d.order_status)

                                // Giữ mã cũ: get_order_detail không cấp tracking_no, mã thật
                                // do vòng lặp import lấy qua logistics/get_tracking_number.
                                const newTracking = snToOld[sn]?.trackingNumber || null
                                const newCarrier = d.shipping_carrier || snToOld[sn]?.shippingCarrier || null
                                const oldStatus = snToOld[sn]?.status

                                if (newStatus !== oldStatus || newTracking !== snToOld[sn]?.trackingNumber) {
                                    const upd: any = {
                                        status: newStatus,
                                        externalStatus: d.order_status,
                                        paymentStatus: newPayStatus,
                                        trackingNumber: newTracking,
                                        shippingCarrier: newCarrier,
                                        syncedAt: new Date(),
                                    }
                                    if (d.order_status === 'SHIPPED' && !snToOld[sn]?.trackingNumber) upd.shippedAt = new Date()
                                    if (d.order_status === 'TO_CONFIRM_RECEIVE') upd.deliveredAt = new Date()
                                    if (['COMPLETED', 'completed'].includes(newStatus)) { upd.paymentStatus = 'paid'; upd.paidAt = new Date() }
                                    await prisma.onlineOrder.update({ where: { id: dbId }, data: upd })
                                    statusRefreshed++
                                }
                            }
                            batchFailed = 0
                        } catch (batchErr: any) {
                            batchFailed++
                            console.error(`[Sync] Batch status refresh error (i=${i}):`, batchErr.message)
                        }
                    }
                    console.log(`[Sync] Status refreshed: ${statusRefreshed}/${orderSns.length} orders updated`)
                }
            } catch (refreshErr: any) {
                console.error('[Sync] Batch status refresh failed:', refreshErr.message)
            }
        } else if (channel.platform === 'tiktok' && service instanceof TikTokService) {
            // TikTok sync lọc theo create_time → đơn cũ đổi trạng thái không được cập
            // nhật qua polling. Webhook lo realtime; đây là lưới an toàn khi bấm Sync:
            // refresh từng đơn chưa kết thúc qua getOrderDetail (mới nhất trước, tối đa 60).
            try {
                // Native TikTok statuses + legacy lowercase (đơn sync trước khi mapStatus giữ native)
                const NON_TERMINAL = [
                    'UNPAID', 'ON_HOLD', 'AWAITING_SHIPMENT', 'AWAITING_COLLECTION',
                    'PARTIALLY_SHIPPING', 'IN_TRANSIT', 'DELIVERED',
                    'pending', 'confirmed', 'processing', 'shipping', 'delivered',
                ]
                // BUG CŨ: orderBy createdAt desc + take 60 → chỉ soi 60 đơn MỚI NHẤT.
                // Đơn cũ hơn nằm ngoài cửa sổ đó KHÔNG BAO GIỜ được hỏi lại, bấm Sync
                // bao nhiêu lần cũng vậy — đó là lý do đơn TikTok từ 18/07 nằm mãi ở
                // "Đã xử lý". Log lúc nào cũng đúng 60 chính là dấu hiệu chạm trần.
                // Nay xoay vòng theo LÂU NHẤT CHƯA KIỂM TRA để mọi đơn đều tới lượt.
                const tkWhere = { channelId: channel.id, status: { in: NON_TERMINAL }, externalOrderId: { not: null } }
                const TK_CAP = 120
                const tkTotal = await prisma.onlineOrder.count({ where: tkWhere })
                const pendingOrders = await prisma.onlineOrder.findMany({
                    where: tkWhere,
                    select: { id: true, externalOrderId: true, status: true, trackingNumber: true, shippingCarrier: true },
                    orderBy: [{ syncedAt: { sort: 'asc', nulls: 'first' } }, { createdAt: 'asc' }],
                    take: TK_CAP,
                })
                if (pendingOrders.length > 0) {
                    console.log(`[Sync] Refreshing status of ${pendingOrders.length} pending TikTok orders...`)
                    // Đếm số đơn hỏi mà KHÔNG ra kết quả. Trước đây `if (!detail) continue`
                    // im lặng nên "0/60 orders updated" trông y hệt "sàn không có gì mới".
                    let tkSkipped = 0, tkDead = ''
                    // Mỗi đơn cần thêm 1 call tracking → chặn trần để lượt sync không
                    // phình ra gấp đôi và chạm giới hạn 300s của Cloud Run.
                    const TK_TRACK_CAP = 40
                    let tkTrackChecked = 0, tkByTracking = 0
                    // Đơn đã hỏi được — kể cả khi trạng thái KHÔNG đổi — phải đóng dấu
                    // syncedAt, nếu không lần sync sau lại bốc đúng nhóm này (chúng vẫn
                    // là "lâu nhất chưa kiểm tra") và vòng xoay đứng yên tại chỗ.
                    const tkChecked: string[] = []
                    for (const o of pendingOrders) {
                        if (tkDead) break
                        const eid = (o.externalOrderId || '').replace(/^(SPE-|TIK-|LAZ-)/i, '')
                        if (!eid) continue
                        try {
                            const detail = await service.getOrderDetail(eid)
                            if (!detail) { tkSkipped++; continue }
                            tkChecked.push(o.id)
                            // Sàn vẫn báo chưa xong → hỏi VẬN ĐƠN. Trạng thái đơn của
                            // TikTok trễ hơn vận đơn, nên kiện giao xong rồi mà đơn còn
                            // nằm ở "Chờ lấy hàng". Chỉ hỏi khi cần và trong hạn mức.
                            const stillOpen = (LIFECYCLE_RANK[detail.status] ?? 0) < 4
                            if (stillOpen && tkTrackChecked < TK_TRACK_CAP) {
                                tkTrackChecked++
                                try {
                                    const deliveredAt = await service.getDeliveredTime(eid)
                                    if (deliveredAt && canAdvance(o.status, 'DELIVERED')) {
                                        await prisma.onlineOrder.update({
                                            where: { id: o.id },
                                            data: {
                                                status: 'DELIVERED',
                                                externalStatus: detail.externalStatus,
                                                deliveredAt,
                                                trackingNumber: detail.trackingNumber || o.trackingNumber,
                                                shippingCarrier: detail.shippingCarrier || o.shippingCarrier,
                                                syncedAt: new Date(),
                                            },
                                        })
                                        statusRefreshed++
                                        tkByTracking++
                                        continue
                                    }
                                } catch (trkErr: any) {
                                    const m = String(trkErr?.message || trkErr)
                                    if (/TikTok từ chối kênh/.test(m)) { tkDead = m; break }
                                    console.warn(`[Sync] TikTok tracking ${eid}: ${m}`)
                                }
                            }
                            // Chỉ ghi khi TIẾN tới (hoặc là huỷ/hoàn) — xem canAdvance
                            if (canAdvance(o.status, detail.status) || (detail.trackingNumber && detail.trackingNumber !== o.trackingNumber)) {
                                await prisma.onlineOrder.update({
                                    where: { id: o.id },
                                    data: {
                                        status: detail.status,
                                        externalStatus: detail.externalStatus,
                                        paymentStatus: detail.paymentStatus,
                                        trackingNumber: detail.trackingNumber || o.trackingNumber,
                                        shippingCarrier: detail.shippingCarrier || o.shippingCarrier,
                                        shippedAt: detail.shippedAt ? new Date(detail.shippedAt) : undefined,
                                        deliveredAt: detail.deliveredAt ? new Date(detail.deliveredAt) : undefined,
                                        syncedAt: new Date(),
                                    },
                                })
                                statusRefreshed++
                            }
                        } catch (oneErr: any) {
                            const msg = String(oneErr?.message || oneErr)
                            // Lỗi cấp kênh (token/chữ ký) → hỏi nốt 59 đơn nữa cũng vậy
                            if (/TikTok từ chối kênh/.test(msg)) {
                                tkDead = msg
                                console.error(`[Sync] ${channel.name}: dừng làm mới trạng thái TikTok —`, msg)
                            } else {
                                tkSkipped++
                                console.error(`[Sync] TikTok status refresh error for ${eid}:`, msg)
                            }
                        }
                    }
                    if (tkChecked.length > 0) {
                        await prisma.onlineOrder.updateMany({
                            where: { id: { in: tkChecked } },
                            data: { syncedAt: new Date() },
                        })
                    }
                    console.log(`[Sync] TikTok status refreshed: ${statusRefreshed}/${pendingOrders.length} orders updated` +
                        ` (tổng chưa kết thúc: ${tkTotal}` +
                        `${tkByTracking > 0 ? `, ${tkByTracking} đơn chốt ĐÃ GIAO theo vận đơn` : ''}` +
                        `${tkTrackChecked >= TK_TRACK_CAP ? `, chạm trần ${TK_TRACK_CAP} lượt tra vận đơn` : ''})` +
                        `${tkSkipped > 0 ? `, ${tkSkipped} đơn không hỏi được` : ''}${tkDead ? ` — DỪNG: ${tkDead}` : ''}`)
                    // Nói thẳng khi còn đơn chưa tới lượt — im lặng cắt bớt thì màn hình
                    // trông như "đã soi hết" trong khi thực ra mới soi một phần.
                    if (tkTotal > pendingOrders.length) {
                        console.log(`[Sync] TikTok: còn ${tkTotal - pendingOrders.length} đơn chưa tới lượt kiểm tra — bấm Đồng bộ tiếp để quét nốt`)
                    }
                    // Báo lên cho người bấm sync: "0/60" mà không kèm gì thì ai cũng
                    // tưởng sàn không có gì mới, chứ không nghĩ là hỏi hụt sạch.
                    if (tkDead) errors.push(`Làm mới trạng thái TikTok: ${tkDead}`)
                    else if (tkSkipped >= pendingOrders.length && pendingOrders.length > 0) {
                        errors.push(`Làm mới trạng thái TikTok: không hỏi được đơn nào (${tkSkipped}/${pendingOrders.length})`)
                    }
                }
            } catch (refreshErr: any) {
                console.error('[Sync] TikTok status refresh failed:', refreshErr.message)
            }
        }

        // ── PRODUCT SYNC ────────────────────────────────────────────────────────
        let productsSynced = 0
        try {
            console.log(`[Sync] Starting product catalog sync for channel ${channel.name}...`)
            const { products } = await service.fetchProducts()
            for (const p of products) {
                await prisma.onlineProduct.upsert({
                    where: {
                        channelId_platformProductId: {
                            channelId: channel.id,
                            platformProductId: p.platformProductId,
                        },
                    },
                    create: {
                        channelId: channel.id,
                        platform: channel.platform,
                        platformProductId: p.platformProductId,
                        name: p.name,
                        sku: p.sku || null,
                        price: p.price,
                        stock: p.stock,
                        status: p.status || 'NORMAL',
                        imageUrl: p.imageUrl || null,
                        categoryId: p.categoryId || null,
                        categoryName: p.categoryName || null,
                        syncedAt: new Date(),
                    },
                    update: {
                        name: p.name,
                        sku: p.sku || null,
                        price: p.price,
                        stock: p.stock,
                        status: p.status || 'NORMAL',
                        imageUrl: p.imageUrl || null,
                        // Chỉ ghi đè ngành khi list API có trả (Shopee) — TikTok search không
                        // trả nên giữ nguyên giá trị đã enrich, tránh xóa mất.
                        ...(p.categoryId ? { categoryId: p.categoryId, categoryName: p.categoryName || null } : {}),
                        syncedAt: new Date(),
                    },
                })
                productsSynced++
            }
            console.log(`[Sync] Product catalog: ${productsSynced} products synced`)

            // ── TikTok: enrich mã ngành hàng (nền, sau khi trả response) ──────────
            // products/search KHÔNG trả category → đọc từ product detail, CHỈ cho SP
            // còn thiếu, throttle 250ms + cap 80 SP/lần sync để không đụng rate-limit.
            if (channel.platform === 'tiktok' && service instanceof TikTokService) {
                const tkService = service as TikTokService
                ;(async () => {
                    try {
                        const missing = await prisma.onlineProduct.findMany({
                            where: { channelId: channel.id, platform: 'tiktok', categoryId: null },
                            select: { id: true, platformProductId: true },
                            take: 80,
                        })
                        if (!missing.length) return
                        let done = 0
                        for (const m of missing) {
                            try {
                                const cat = await tkService.fetchProductCategory(m.platformProductId)
                                if (cat) {
                                    await prisma.onlineProduct.update({ where: { id: m.id }, data: cat })
                                    done++
                                }
                            } catch {
                                break // rate-limit/token lỗi → dừng, lần sync sau chạy tiếp
                            }
                            await new Promise(r => setTimeout(r, 250))
                        }
                        console.log(`[Sync] TikTok category enriched: ${done}/${missing.length}`)
                    } catch (enrichErr: any) {
                        console.error('[Sync] TikTok category enrich failed:', enrichErr.message)
                    }
                })()
            }
        } catch (prodErr: any) {
            console.error('[Sync] Product catalog sync error:', prodErr.message)
            errors.push(`Product sync: ${prodErr.message}`)
        }

        res.json({
            success: true,
            data: {
                imported, updated, statusRefreshed, productsSynced,
                errors: errors.length, total: allOrders.length, converted,
                // Dừng vì hết giờ → báo rõ để người dùng bấm đồng bộ tiếp
                partial: !!stoppedAt,
                ...(stoppedAt ? {
                    stoppedAt: (stoppedAt as Date).toISOString(),
                    message: `Đồng bộ một phần: mới kéo tới ${(stoppedAt as Date).toLocaleDateString('vi-VN')} (khoảng quá dài). Bấm Đồng bộ lần nữa để chạy tiếp.`,
                } : {}),
            },
        })
    } catch (err: any) {
        console.error('Sync orders error:', err)

        // Log error
        try {
            const prisma = req.storePrisma!
            await prisma.syncLog.create({
                data: {
                    channelId: req.params.id as string,
                    action: 'sync_orders',
                    status: 'error',
                    details: err.message,
                },
            })
        } catch (_) { }

        // Known TikTok / platform failures that are user-actionable, NOT server bugs.
        // errMsg() masks everything as a generic 500 in production, which is why the
        // UI only showed "Internal server error". Surface a clear reconnect prompt
        // (400) so the operator knows what to fix.
        //
        // Error codes:
        //   105005 — token lacks the required access scope for the endpoint
        //   106011 — invalid shop_cipher (stale/old connection storing open_id)
        //   105001/105002 — access token expired / invalid
        //   106001 — invalid HMAC sign (app secret wrong/changed, or algorithm mismatch)
        const m = String(err?.message || '')
        // Shopee blocks API calls from server IPs not declared in its console.
        // Cloud Run egress IPs rotate, so surface the offending IP for the operator.
        if (/source_ip_undeclared/i.test(m)) {
            const ip = m.match(/\(([\d.]+)\)/)?.[1]
            res.status(400).json({
                success: false,
                error: `Shopee chặn IP máy chủ${ip ? ` (${ip})` : ''}: cần thêm IP này vào Shopee Open Platform Console → App List → IP Address Whitelist. Lưu ý: IP Cloud Run có thể thay đổi theo thời gian — nếu lỗi lặp lại với IP khác, cân nhắc cấu hình IP tĩnh (VPC connector + Cloud NAT).`,
            })
            return
        }
        if (/\b106001\b/.test(m) || /sign.*invalid|invalid.*sign/i.test(m)) {
            res.status(400).json({
                success: false,
                error: 'TikTok Shop: Chữ ký API không hợp lệ (106001). App Secret có thể đã thay đổi. Vui lòng kiểm tra App Key và App Secret trong TikTok Partner Center, sau đó cập nhật lại trong phần Kênh → TikTok → Cài đặt.',
            })
            return
        }
        if (/\b(105005|106011|105001|105002)\b/.test(m) || /shop_cipher|access scope|access token/i.test(m)) {
            res.status(400).json({
                success: false,
                error: 'TikTok Shop cần được kết nối lại: token thiếu quyền hoặc shop_cipher không hợp lệ. Vui lòng vào phần Kênh → TikTok → Kết nối lại (authorize), và đảm bảo app đã được cấp đủ scope (Order Information, Authorization) trong TikTok Partner Center.',
            })
            return
        }

        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// POST /api/online-orders/channels/:id/sync-status — Refresh status của tất cả đơn chưa kết thúc
// Dùng khi muốn cập nhật ngay mà không cần sync đơn mới
router.post('/channels/:id/sync-status', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const channel = await prisma.onlineChannel.findUnique({ where: { id: req.params.id as string } })
        if (!channel) { res.status(404).json({ success: false, error: 'Kênh không tồn tại' }); return }
        if (channel.platform !== 'shopee') {
            res.status(400).json({ success: false, error: 'Chỉ hỗ trợ Shopee hiện tại' }); return
        }

        const NON_TERMINAL = ['pending','confirmed','processing','shipping','delivered','UNPAID','READY_TO_SHIP','PROCESSED','SHIPPED','TO_CONFIRM_RECEIVE','IN_CANCEL']
        const pendingOrders = await prisma.onlineOrder.findMany({
            where: { channelId: channel.id, status: { in: NON_TERMINAL }, externalOrderId: { not: null } },
            select: { id: true, externalOrderId: true, status: true, trackingNumber: true, shippingCarrier: true },
        })

        if (pendingOrders.length === 0) {
            res.json({ success: true, data: { refreshed: 0, total: 0, message: 'Không có đơn nào cần cập nhật' } })
            return
        }

        const snToId: Record<string, string> = {}
        const snToOld: Record<string, { status: string; trackingNumber: string | null; shippingCarrier: string | null }> = {}
        for (const o of pendingOrders) {
            const sn = (o.externalOrderId || '').replace(/^(SPE-|TIK-|LAZ-)/i, '')
            if (sn) { snToId[sn] = o.id; snToOld[sn] = { status: o.status, trackingNumber: o.trackingNumber, shippingCarrier: o.shippingCarrier } }
        }
        const orderSns = Object.keys(snToId)

        const shopee = new ShopeeService({
            apiKey: channel.apiKey || '', apiSecret: channel.apiSecret || '',
            accessToken: (channel as any).accessToken || '',
            refreshToken: (channel as any).refreshToken || '',
            shopId: channel.shopId || '',
        })

        let refreshed = 0
        const BATCH = 50
        for (let i = 0; i < orderSns.length; i += BATCH) {
            const batch = orderSns.slice(i, i + BATCH)
            try {
                const detailPath = '/api/v2/order/get_order_detail'
                const detailUrl = (shopee as any).apiUrl(detailPath) +
                    `&order_sn_list=${batch.join(',')}&response_optional_fields=tracking_no,shipping_carrier`
                const detailData = await (shopee as any).httpGet(detailUrl)
                const details = detailData.response?.order_list || []

                for (const d of details) {
                    const sn = d.order_sn
                    const dbId = snToId[sn]
                    if (!dbId) continue
                    const newStatus = (shopee as any).mapStatus(d.order_status)
                    const newPayStatus = (shopee as any).mapPaymentStatus(d.order_status)
                    const newTracking = d.tracking_no || snToOld[sn]?.trackingNumber || null
                    const newCarrier = d.shipping_carrier || snToOld[sn]?.shippingCarrier || null
                    const oldStatus = snToOld[sn]?.status

                    const upd: any = {
                        status: newStatus,
                        externalStatus: d.order_status,
                        paymentStatus: newPayStatus,
                        trackingNumber: newTracking,
                        shippingCarrier: newCarrier,
                        syncedAt: new Date(),
                    }
                    if (d.order_status === 'SHIPPED' && !snToOld[sn]?.trackingNumber) upd.shippedAt = new Date()
                    if (d.order_status === 'TO_CONFIRM_RECEIVE') upd.deliveredAt = new Date()
                    if (['COMPLETED', 'completed'].includes(newStatus)) { upd.paymentStatus = 'paid'; upd.paidAt = new Date() }

                    await prisma.onlineOrder.update({ where: { id: dbId }, data: upd })
                    if (newStatus !== oldStatus) refreshed++
                }
            } catch (batchErr: any) {
                console.error(`[SyncStatus] Batch error (i=${i}):`, batchErr.message)
            }
        }

        console.log(`[SyncStatus] Done: ${refreshed} status changed out of ${orderSns.length} orders`)

        // Log
        await prisma.syncLog.create({
            data: {
                channelId: channel.id,
                action: 'sync_status',
                status: 'success',
                details: `Refreshed ${refreshed}/${orderSns.length} orders`,
                ordersCount: orderSns.length,
            },
        }).catch(() => {})

        res.json({ success: true, data: { refreshed, total: orderSns.length } })
    } catch (err: any) {
        console.error('Sync status error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// ═══════════════════════════════════════════════════════════════════════════════
//  BACKFILL MÃ VẬN ĐƠN (Shopee)
// ═══════════════════════════════════════════════════════════════════════════════
// Bản vá lấy mã vận đơn khi đồng bộ chỉ áp cho đơn kéo về TỪ LÚC ĐÓ trở đi; đơn
// đồng bộ trước đó vẫn trackingNumber rỗng vĩnh viễn. Endpoint này quét đơn
// Shopee đã rời kho mà chưa có mã rồi gọi logistics/get_tracking_number vá lại.
//
// POST /api/online-orders/backfill-tracking
// Body: { channelId?: string, limit?: number }
//   - không truyền channelId → chạy cho MỌI kênh Shopee của cửa hàng
//   - limit là trần đơn quét cho cả lượt gọi (mặc định 1000, tối đa 5000)
router.post('/backfill-tracking', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!

        // Trạng thái đã rời kho → sàn chắc chắn đã cấp mã vận đơn. Kèm cả dạng
        // chữ thường của bản map cũ, vì đơn tồn đọng chính là đơn đồng bộ thời đó.
        const TRACKABLE = ['SHIPPED', 'COMPLETED', 'TO_CONFIRM_RECEIVE', 'PROCESSED', 'shipping', 'delivered', 'completed']
        // trackingNumber rỗng có 2 dạng trong dữ liệu cũ: NULL và chuỗi rỗng
        const MISSING_TRACKING = [{ trackingNumber: null }, { trackingNumber: '' }]

        const channelId = req.body?.channelId ? String(req.body.channelId) : null
        let budget = Math.min(5000, Math.max(1, Number(req.body?.limit) || 1000))

        const channels = await prisma.onlineChannel.findMany({
            where: { platform: 'shopee', ...(channelId ? { id: channelId } : {}) },
        })
        if (channels.length === 0) {
            res.status(404).json({
                success: false,
                error: channelId ? 'Kênh không tồn tại hoặc không phải Shopee' : 'Cửa hàng chưa có kênh Shopee nào',
            })
            return
        }

        // Cloud Run cắt request ở 300s: dừng chủ động ở 230s và trả kết quả MỘT
        // PHẦN kèm số đơn còn lại để bấm chạy tiếp — thà vá dở mà biết còn hơn 504 mù.
        const DEADLINE_MS = 230_000
        const startedAt = Date.now()
        const outOfTime = () => Date.now() - startedAt > DEADLINE_MS
        const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

        let scanned = 0, filled = 0, notFound = 0, failed = 0, stopped = false
        const perChannel: any[] = []
        const errors: string[] = []

        // Duyệt kênh TUẦN TỰ: pool Prisma mỗi cửa hàng rất nhỏ, chạy song song
        // nhiều kênh dễ cạn kết nối khi cron cũng đang chạy.
        for (const channel of channels) {
            if (budget <= 0 || outOfTime()) { stopped = true; break }

            if (!channel.accessToken) {
                perChannel.push({ channelId: channel.id, channel: channel.name, error: 'Kênh chưa kết nối API (thiếu access token)' })
                continue
            }

            const service = new ShopeeService({
                apiKey: channel.apiKey || '', apiSecret: channel.apiSecret || '',
                accessToken: channel.accessToken || undefined,
                refreshToken: channel.refreshToken || undefined,
                shopId: channel.shopId || undefined,
            })

            // Làm mới token nếu sắp hết hạn (đệm 5 phút) — lượt quét kéo dài vài
            // phút, token chết giữa chừng thì cả nghìn đơn còn lại vá hụt.
            if (channel.tokenExpiresAt && new Date(channel.tokenExpiresAt).getTime() < Date.now() + 5 * 60 * 1000) {
                try {
                    const tokens = await service.refreshAccessToken();
                    (service as any).credentials.accessToken = tokens.accessToken;
                    (service as any).credentials.refreshToken = tokens.refreshToken
                    await prisma.onlineChannel.update({
                        where: { id: channel.id },
                        data: {
                            accessToken: tokens.accessToken,
                            refreshToken: tokens.refreshToken,
                            tokenExpiresAt: new Date(Date.now() + tokens.expiresIn * 1000),
                        },
                    })
                } catch (e: any) {
                    console.warn(`[backfill-tracking] ${channel.name}: refresh token lỗi:`, e.message)
                }
            }

            const orders = await prisma.onlineOrder.findMany({
                where: {
                    channelId: channel.id,
                    status: { in: TRACKABLE },
                    externalOrderId: { not: null },
                    OR: MISSING_TRACKING,
                },
                select: { id: true, orderNumber: true, externalOrderId: true },
                orderBy: { createdAt: 'desc' },
                take: budget,
            })
            if (orders.length === 0) {
                perChannel.push({ channelId: channel.id, channel: channel.name, scanned: 0, filled: 0, notFound: 0, failed: 0 })
                continue
            }
            budget -= orders.length

            const toSn = (eid: string | null) => (eid || '').replace(/^(SPE-|TIK-|LAZ-)/i, '')

            // getTrackingNumber NUỐT mọi lỗi thành null → kênh hỏng token/IP sẽ
            // báo "không có mã" cho cả nghìn đơn mà không ai biết vì sao. Thăm dò
            // 1 đơn bằng call thô để lộ lỗi xác thực/IP trước khi đốt hạn mức.
            try {
                const probeSn = toSn(orders[0].externalOrderId)
                const probeUrl = (service as any).apiUrl('/api/v2/logistics/get_tracking_number') + `&order_sn=${probeSn}`
                const probe = await (service as any).httpGet(probeUrl)
                const probeErr = String(probe?.error || '')
                if (/error_auth|invalid_access_token|access_token|error_permission|source_ip_undeclared/i.test(probeErr)) {
                    const msg = `${probeErr}${probe?.message ? ` - ${probe.message}` : ''}`
                    perChannel.push({ channelId: channel.id, channel: channel.name, error: `Shopee từ chối: ${msg}` })
                    errors.push(`${channel.name}: ${msg}`)
                    console.error(`[backfill-tracking] ${channel.name}: bỏ qua kênh —`, msg)
                    continue
                }
            } catch (e: any) {
                console.warn(`[backfill-tracking] ${channel.name}: probe lỗi (vẫn chạy tiếp):`, e.message)
            }

            let cFilled = 0, cNotFound = 0, cFailed = 0
            // 3 luồng, mỗi luồng nghỉ 250ms sau một call ≈ 12 req/s — dưới xa
            // rate limit Shopee mà vẫn nhanh gấp 3 lần kiểu tuần tự.
            await mapWithConcurrency(orders, async (order) => {
                if (outOfTime()) { stopped = true; return }
                const sn = toSn(order.externalOrderId)
                if (!sn) { cNotFound++; return }
                try {
                    const tracking = await service.getTrackingNumber(sn)
                    await sleep(250)
                    if (!tracking) { cNotFound++; return }
                    await prisma.onlineOrder.update({
                        where: { id: order.id },
                        data: { trackingNumber: tracking },
                    })
                    cFilled++
                } catch (e: any) {
                    cFailed++
                    if (errors.length < 10) errors.push(`${order.orderNumber}: ${e.message}`)
                    console.error(`[backfill-tracking] ${channel.name} ${order.orderNumber}:`, e.message)
                }
            }, 3)

            scanned += orders.length
            filled += cFilled
            notFound += cNotFound
            failed += cFailed
            perChannel.push({ channelId: channel.id, channel: channel.name, scanned: orders.length, filled: cFilled, notFound: cNotFound, failed: cFailed })

            await prisma.syncLog.create({
                data: {
                    channelId: channel.id,
                    action: 'backfill_tracking',
                    status: cFailed > 0 ? 'partial' : 'success',
                    details: `Vá mã vận đơn: ${cFilled}/${orders.length} đơn (chưa có mã: ${cNotFound}, lỗi: ${cFailed})`,
                    ordersCount: cFilled,
                },
            }).catch(() => { })
        }

        // Còn bao nhiêu đơn thiếu mã sau lượt này → biết có cần bấm chạy tiếp không
        const remaining = await prisma.onlineOrder.count({
            where: {
                channelId: { in: channels.map(c => c.id) },
                status: { in: TRACKABLE },
                externalOrderId: { not: null },
                OR: MISSING_TRACKING,
            },
        })

        console.log(`[backfill-tracking] Xong: vá ${filled}/${scanned} đơn, còn thiếu ${remaining}${stopped ? ' (DỪNG vì hết giờ/hết hạn mức)' : ''}`)

        res.json({
            success: true,
            data: {
                scanned, filled, notFound, failed, remaining, stopped,
                channels: perChannel,
                errors,
                message: stopped
                    ? `Đã vá ${filled} đơn rồi dừng vì chạm hạn mức/thời gian — còn ${remaining} đơn thiếu mã, bấm chạy lại để tiếp tục.`
                    : `Đã vá ${filled}/${scanned} đơn.${remaining > 0 ? ` Còn ${remaining} đơn sàn chưa cấp mã vận đơn.` : ''}`,
            },
        })
    } catch (err: any) {
        console.error('Backfill tracking error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})



// GET /api/online-orders/channels/:id/sync-logs
router.get('/channels/:id/sync-logs', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const logs = await prisma.syncLog.findMany({
            where: { channelId: req.params.id as string },
            orderBy: { createdAt: 'desc' },
            take: 20,
        })
        res.json({ success: true, data: logs })
    } catch (err) {
        console.error('Get sync logs error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// POST /api/online-orders/channels/:id/test-connection
router.post('/channels/:id/test-connection', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const channel = await prisma.onlineChannel.findUnique({ where: { id: req.params.id as string } })
        if (!channel) { res.status(404).json({ success: false, error: 'Kênh không tồn tại' }); return }

        const service = getPlatformService(channel.platform, {
            apiKey: channel.apiKey || '', apiSecret: channel.apiSecret || '',
            accessToken: channel.accessToken || undefined,
            refreshToken: channel.refreshToken || undefined,
            shopId: channel.shopId || undefined,
        })
        if (!service) {
            res.json({ success: true, data: { connected: false, message: `Nền tảng "${channel.platform}" chưa hỗ trợ kết nối API` } })
            return
        }

        const result = await service.testConnection()

        await prisma.syncLog.create({
            data: {
                channelId: channel.id,
                action: 'test_connection',
                status: result.success ? 'success' : 'error',
                details: result.success ? `Connected: ${result.shopName}` : `Error: ${result.error}`,
            },
        })

        res.json({ success: true, data: { connected: result.success, shopName: result.shopName, error: result.error } })
    } catch (err: any) {
        console.error('Test connection error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// PUT /api/online-orders/channels/:id/fee-config
router.put('/channels/:id/fee-config', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { commissionRate } = req.body
        if (commissionRate == null || commissionRate < 0 || commissionRate > 100) {
            res.status(400).json({ success: false, error: 'commissionRate phải từ 0 đến 100' })
            return
        }
        const channel = await prisma.onlineChannel.update({
            where: { id: req.params.id as string },
            data: { commissionRate: parseFloat(commissionRate) },
        })
        res.json({ success: true, data: channel })
    } catch (err) {
        console.error('Fee config error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ═══════════════════════════════════════════════════════════════════════════════
//  ONLINE ORDER RETURNS / REFUNDS
// ═══════════════════════════════════════════════════════════════════════════════

// POST /api/online-orders/:id/return — Create return request
router.post('/:id/return', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { id } = req.params
        const { items, reason, refundMethod, refundAmount, notes } = req.body

        // Validate order exists and is in a returnable state
        const order = await prisma.onlineOrder.findUnique({
            where: { id: id as string },
            include: { items: true },
        })
        if (!order) {
            res.status(404).json({ success: false, error: 'Không tìm thấy đơn hàng' })
            return
        }

        const returnableStatuses = ['delivered', 'completed']
        if (!returnableStatuses.includes(order.status)) {
            res.status(400).json({ success: false, error: 'Đơn hàng chưa giao không thể trả' })
            return
        }

        if (!items || !Array.isArray(items) || items.length === 0) {
            res.status(400).json({ success: false, error: 'Vui lòng chọn sản phẩm cần trả' })
            return
        }

        if (!reason) {
            res.status(400).json({ success: false, error: 'Vui lòng nhập lý do trả hàng' })
            return
        }

        // Validate items exist in order
        const orderItemMap = new Map(order.items.map(i => [i.id, i]))
        const returnItems: { productName: string; sku?: string; quantity: number; unitPrice: number; returnReason?: string; condition?: string }[] = []
        let totalRefund = 0

        for (const item of items) {
            const orderItem = orderItemMap.get(item.orderItemId)
            if (!orderItem) {
                res.status(400).json({ success: false, error: `Sản phẩm không tồn tại trong đơn: ${item.orderItemId}` })
                return
            }
            if (item.quantity > orderItem.quantity || item.quantity <= 0) {
                res.status(400).json({ success: false, error: `Số lượng trả không hợp lệ cho ${orderItem.productName}` })
                return
            }
            const lineRefund = item.quantity * orderItem.unitPrice
            totalRefund += lineRefund
            returnItems.push({
                productName: orderItem.productName,
                sku: orderItem.sku || undefined,
                quantity: item.quantity,
                unitPrice: orderItem.unitPrice,
                returnReason: item.reason || reason,
                condition: item.condition || 'used',
            })
        }

        // Generate return code
        const returnCode = await nextCode(prisma, 'onlineReturnCodeSeq', 'RTN-ON', 5, '-', 'ReturnOrder', 'code')

        // Create return order
        const returnOrder = await prisma.returnOrder.create({
            data: {
                code: returnCode,
                originalInvoice: order.orderNumber,
                customerName: order.customerName,
                customerPhone: order.customerPhone || undefined,
                reason,
                refundMethod: refundMethod || 'bank_transfer',
                refundAmount: refundAmount ?? totalRefund,
                totalRefund,
                notes: notes || undefined,
                staffName: req.user?.email || 'system',
                status: 'pending',
                items: {
                    create: returnItems.map(item => ({
                        productName: item.productName,
                        sku: item.sku,
                        quantity: item.quantity,
                        unitPrice: item.unitPrice,
                        returnReason: item.returnReason,
                        condition: item.condition,
                    })),
                },
            },
            include: { items: true },
        })

        // Audit log
        try {
            await prisma.auditLog.create({
                data: {
                    userId: req.user?.userId,
                    userName: req.user?.email || 'system',
                    action: 'create_return',
                    entity: 'OnlineOrder',
                    entityId: order.id,
                    details: JSON.stringify({
                        orderNumber: order.orderNumber,
                        returnCode,
                        reason,
                        totalRefund,
                        itemCount: returnItems.length,
                    }),
                },
            })
        } catch { }

        res.json({ success: true, data: returnOrder })
    } catch (err) {
        console.error('Create return error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// GET /api/online-orders/returns — List all online returns
router.get('/returns/list', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { status, platform, channelId, search, page = '1', pageSize = '20' } = req.query

        // Online returns carry per-platform code prefixes: RTN-TT- (TikTok),
        // RTN-SH- (Shopee), RTN-ON (legacy/manual online).
        const PREFIX_BY_PLATFORM: Record<string, string> = {
            tiktok: 'RTN-TT-', shopee: 'RTN-SH-', online: 'RTN-ON',
        }
        const codeFilter = platform && PREFIX_BY_PLATFORM[String(platform)]
            ? [{ code: { startsWith: PREFIX_BY_PLATFORM[String(platform)] } }]
            : [
                { code: { startsWith: 'RTN-ON' } },
                { code: { startsWith: 'RTN-TT-' } },
                { code: { startsWith: 'RTN-SH-' } },
            ]

        const where: any = { OR: codeFilter }
        if (status && status !== 'all') where.status = status as string
        if (channelId && channelId !== 'all') (where as any).channelId = String(channelId)
        if (search && String(search).trim()) {
            const q = String(search).trim()
            where.AND = [{
                OR: [
                    { code: { contains: q, mode: 'insensitive' } },
                    { originalInvoice: { contains: q, mode: 'insensitive' } },
                    { customerName: { contains: q, mode: 'insensitive' } },
                ],
            }]
        }

        const [returns, total] = await Promise.all([
            prisma.returnOrder.findMany({
                where,
                include: { items: true },
                orderBy: { createdAt: 'desc' },
                skip: (parseInt(page as string) - 1) * parseInt(pageSize as string),
                take: parseInt(pageSize as string),
            }),
            prisma.returnOrder.count({ where }),
        ])

        // Enrich: platform từ prefix mã phiếu + thông tin đơn gốc (kênh, trạng thái,
        // tracking) để màn hình hiển thị chi tiết mà không phải tự parse notes.
        const invoiceNos = [...new Set(returns.map(r => r.originalInvoice).filter(Boolean))]
        const orders = invoiceNos.length > 0
            ? await prisma.onlineOrder.findMany({
                where: { orderNumber: { in: invoiceNos } },
                select: {
                    id: true, orderNumber: true, channelId: true, channelName: true, platform: true,
                    status: true, externalStatus: true, trackingNumber: true, total: true,
                },
            })
            : []
        const orderMap = new Map(orders.map(o => [o.orderNumber, o]))
        const codePlatform = (code: string) =>
            code.startsWith('RTN-TT-') ? 'tiktok' : code.startsWith('RTN-SH-') ? 'shopee' : 'online'

        // Lazy backfill: phiếu sync trước khi có cột channelId → điền dần từ đơn gốc
        // (best-effort, không chặn response)
        for (const r of returns) {
            const o = orderMap.get(r.originalInvoice)
            if (!(r as any).channelId && o?.channelId) {
                (r as any).channelId = o.channelId
                prisma.returnOrder.update({
                    where: { id: r.id },
                    data: { channelId: o.channelId } as any,
                }).catch(() => { })
            }
        }

        // Mã vận đơn của CHÍNH chuyến hàng trả về: returnSync chỉ nhét nó vào chuỗi
        // `notes` ("Tracking: XXX") vì bảng ReturnOrder không có cột riêng. Màn hình
        // vì thế đang hiện order.trackingNumber — mã của đơn GỬI ĐI lúc đầu, không
        // phải mã hàng khách trả về. Bóc ra đây để hai thứ đó không lẫn nhau.
        const returnTrackingOf = (notes?: string | null) => {
            const m = /(?:^|\n)\s*Tracking:\s*(.+?)\s*(?:\n|$)/i.exec(notes || '')
            const v = m?.[1]?.trim()
            return !v || v.toUpperCase() === 'N/A' ? null : v
        }

        const enriched = returns.map(r => ({
            ...r,
            platform: codePlatform(r.code),
            returnSn: r.code.replace(/^RTN-(TT|SH)-/, '').replace(/^RTN-ON-?/, ''),
            returnTracking: returnTrackingOf((r as any).notes),
            order: orderMap.get(r.originalInvoice) || null,
        }))

        res.json({
            success: true,
            data: {
                data: enriched,
                total,
                page: parseInt(page as string),
                totalPages: Math.ceil(total / parseInt(pageSize as string)),
            },
        })
    } catch (err) {
        console.error('List returns error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// GET /api/online-orders/returns/stats — Return stats
router.get('/returns/stats', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!

        // Same per-platform prefixes as /returns/list (optional ?platform= filter)
        const PREFIX_BY_PLATFORM: Record<string, string> = {
            tiktok: 'RTN-TT-', shopee: 'RTN-SH-', online: 'RTN-ON',
        }
        const statPlatform = String(req.query.platform || '')
        const statChannelId = String(req.query.channelId || '')
        const onlineCode: any = {
            OR: PREFIX_BY_PLATFORM[statPlatform]
                ? [{ code: { startsWith: PREFIX_BY_PLATFORM[statPlatform] } }]
                : [
                    { code: { startsWith: 'RTN-ON' } },
                    { code: { startsWith: 'RTN-TT-' } },
                    { code: { startsWith: 'RTN-SH-' } },
                ],
            ...(statChannelId && statChannelId !== 'all' ? { channelId: statChannelId } : {}),
        }
        const [total, pending, approved, rejected, totalRefunded] = await Promise.all([
            prisma.returnOrder.count({ where: onlineCode }),
            prisma.returnOrder.count({ where: { ...onlineCode, status: 'pending' } }),
            prisma.returnOrder.count({ where: { ...onlineCode, status: { in: ['approved', 'refunded'] } } }),
            prisma.returnOrder.count({ where: { ...onlineCode, status: 'rejected' } }),
            prisma.returnOrder.aggregate({
                where: { ...onlineCode, status: { in: ['approved', 'refunded'] } },
                _sum: { totalRefund: true },
            }),
        ])

        res.json({
            success: true,
            data: {
                total,
                pending,
                approved,
                rejected,
                totalRefunded: totalRefunded._sum.totalRefund || 0,
            },
        })
    } catch (err) {
        console.error('Return stats error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// PUT /api/online-orders/returns/:returnId/process — Approve or reject return
// POST /api/online-orders/returns/manual — NHẬP TAY phiếu trả hàng/hoàn tiền
// cho đơn sàn. Cần vì API phiếu trả của Shopee ngưng báo dữ liệu sau 14/07/2026
// (xác minh 31/07: token mới vẫn đọc được dữ liệu cũ nhưng dữ liệu mới rỗng).
// body: { orderNumber, refundAmount, reason?, status?, items?[{productName,sku,quantity,unitPrice}], returnDate? }
router.post('/returns/manual', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const b = req.body || {}
        const raw = String(b.orderNumber || '').trim()
        if (!raw) { res.status(400).json({ success: false, error: 'Thiếu mã đơn' }); return }
        const refundAmount = Number(b.refundAmount) || 0
        if (refundAmount <= 0) { res.status(400).json({ success: false, error: 'Số tiền hoàn phải > 0' }); return }
        const status = ['pending', 'approved', 'rejected', 'refunded'].includes(String(b.status))
            ? String(b.status) : 'refunded'

        // Tìm đơn: chấp nhận mã có/không tiền tố (ONLINE-/SPE-/TIK-)
        const bare = raw.replace(/^ONLINE-/i, '')
        const order = await prisma.onlineOrder.findFirst({
            where: { OR: [{ orderNumber: bare }, { externalOrderId: bare.replace(/^(SPE|TIK)-/i, '') }] },
            include: { items: true, channel: true },
        })
        if (!order) { res.status(404).json({ success: false, error: `Không tìm thấy đơn "${raw}"` }); return }
        if (refundAmount > (order.total || 0) * 1.05) {
            res.status(400).json({ success: false, error: `Tiền hoàn (${refundAmount.toLocaleString('vi-VN')}đ) lớn hơn giá trị đơn (${(order.total || 0).toLocaleString('vi-VN')}đ)` })
            return
        }

        // Mã phiếu: prefix theo sàn + hậu tố M (manual) để phân biệt phiếu tự sync
        const plat = String(order.platform || '').toLowerCase()
        const prefix = plat === 'tiktok' ? 'RTN-TT-M' : plat === 'shopee' ? 'RTN-SH-M' : 'RTN-ON-M'
        let code = `${prefix}${order.externalOrderId || bare}`
        // Cùng 1 đơn có thể trả nhiều lần → thêm số thứ tự nếu trùng
        for (let i = 2; await prisma.returnOrder.findFirst({ where: { code } }); i++) {
            code = `${prefix}${order.externalOrderId || bare}-${i}`
            if (i > 20) break
        }

        const items = Array.isArray(b.items) && b.items.length
            ? b.items.map((it: any) => ({
                productId: it.productId || undefined,
                productName: String(it.productName || 'Hàng khách trả'),
                sku: it.sku ? String(it.sku) : undefined,
                quantity: Math.max(1, Number(it.quantity) || 1),
                unitPrice: Number(it.unitPrice) || 0,
                returnReason: String(b.reason || 'Khách trả hàng'),
                condition: String(it.condition || 'used'),
            }))
            : [{
                productName: 'Hàng khách trả (nhập tay)',
                quantity: 1, unitPrice: refundAmount,
                returnReason: String(b.reason || 'Khách trả hàng'), condition: 'used',
            }]

        const ngay = b.returnDate ? new Date(String(b.returnDate) + 'T00:00:00+07:00') : null
        const created = await prisma.returnOrder.create({
            data: {
                code,
                channelId: order.channelId || null,
                originalInvoice: order.orderNumber,
                customerName: order.customerName || 'Khách sàn',
                customerPhone: order.customerPhone || undefined,
                reason: String(b.reason || 'Khách trả hàng (nhập tay)'),
                refundMethod: 'platform_refund',
                refundAmount, totalRefund: refundAmount,
                status,
                staffName: req.user?.email || 'Nhập tay',
                notes: `[NHẬP TAY] Ghi nhận bởi ${req.user?.email || 'người dùng'}`
                    + `\nĐơn ${order.orderNumber} — tổng ${(order.total || 0).toLocaleString('vi-VN')}đ`
                    + (b.note ? `\n${String(b.note).slice(0, 300)}` : ''),
                ...(ngay && !isNaN(ngay.getTime()) ? { createdAt: ngay } : {}),
                ...(status === 'refunded' ? { refundedAt: new Date(), processedAt: new Date() } : {}),
                branchId: (order as any).branchId || req.user?.branchId || null,
                items: { create: items },
            },
            include: { items: true },
        })

        // KHÔNG tự đảo kho/bút toán ở đây: trả một phần là chuyện thường, đảo
        // toàn bộ đơn sẽ sai. Người dùng xử lý tiếp ở tab "Cần điều chỉnh" (HĐ)
        // và phiếu nhập trả hàng nếu cần hoàn kho.
        res.status(201).json({
            success: true,
            data: created,
            message: `Đã ghi nhận phiếu trả ${code}. Nếu đơn này đã xuất hoá đơn, vào tab "Cần điều chỉnh" của Hoá đơn điện tử để lập HĐ thay thế/điều chỉnh.`,
        })
    } catch (err: any) {
        console.error('Manual return error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// GET /api/online-orders/returns/find-order?code= — tra nhanh đơn để nhập tay
router.get('/returns/find-order', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const raw = String(req.query.code || '').trim()
        if (raw.length < 4) { res.json({ success: true, data: [] }); return }
        const bare = raw.replace(/^ONLINE-/i, '')
        const orders = await prisma.onlineOrder.findMany({
            where: {
                OR: [
                    { orderNumber: { contains: bare, mode: 'insensitive' } },
                    { externalOrderId: { contains: bare.replace(/^(SPE|TIK)-/i, ''), mode: 'insensitive' } },
                ],
            },
            include: { items: true },
            orderBy: { createdAt: 'desc' },
            take: 8,
        })
        const codes = orders.map(o => o.orderNumber)
        const daCo = codes.length
            ? await prisma.returnOrder.findMany({ where: { originalInvoice: { in: codes } }, select: { originalInvoice: true, code: true } })
            : []
        res.json({
            success: true,
            data: orders.map(o => ({
                orderNumber: o.orderNumber, externalOrderId: o.externalOrderId,
                platform: o.platform, status: o.status, total: o.total,
                customerName: o.customerName, createdAt: o.createdAt,
                phieuTraDaCo: daCo.filter(r => r.originalInvoice === o.orderNumber).map(r => r.code),
                items: (o.items || []).map((i: any) => ({
                    productName: i.productName, sku: i.sku, quantity: i.quantity, unitPrice: i.unitPrice,
                })),
            })),
        })
    } catch (err: any) {
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

router.put('/returns/:returnId/process', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { returnId } = req.params
        const { action, reviewNote } = req.body // action: 'approve' | 'reject'

        if (!['approve', 'reject'].includes(action)) {
            res.status(400).json({ success: false, error: 'Action phải là approve hoặc reject' })
            return
        }

        const returnOrder = await prisma.returnOrder.findUnique({
            where: { id: returnId as string },
            include: { items: true },
        })
        if (!returnOrder) {
            res.status(404).json({ success: false, error: 'Không tìm thấy yêu cầu trả hàng' })
            return
        }
        if (returnOrder.status !== 'pending') {
            res.status(400).json({ success: false, error: 'Yêu cầu đã được xử lý' })
            return
        }

        // ── Phiếu trả từ sàn (RTN-TT-/RTN-SH-): đẩy quyết định LÊN SÀN trước ──
        // Sàn chấp nhận mới ghi DB. Không tìm được kênh/token thì xử lý local-only
        // (kèm cảnh báo) để không khóa cứng nghiệp vụ.
        const rtnCode = returnOrder.code || ''
        const isTikTokReturn = rtnCode.startsWith('RTN-TT-')
        const isShopeeReturn = rtnCode.startsWith('RTN-SH-')
        let platformWarning: string | null = null
        if (isTikTokReturn || isShopeeReturn) {
            const returnSn = rtnCode.replace(/^RTN-(TT|SH)-/, '')
            const origOrder = await prisma.onlineOrder.findFirst({
                where: { orderNumber: returnOrder.originalInvoice },
                include: { channel: true },
            })
            let channel: any = (origOrder as any)?.channel
            if (!channel?.accessToken) {
                channel = await prisma.onlineChannel.findFirst({
                    where: { platform: isTikTokReturn ? 'tiktok' : 'shopee', accessToken: { not: null } },
                })
            }

            if (channel?.accessToken) {
                const creds = {
                    apiKey: channel.apiKey || '', apiSecret: channel.apiSecret || '',
                    accessToken: channel.accessToken || undefined,
                    refreshToken: channel.refreshToken || undefined,
                    shopId: channel.shopId || undefined,
                }
                const service: any = isTikTokReturn ? new TikTokService(creds) : new ShopeeService(creds)
                if (channel.tokenExpiresAt && new Date(channel.tokenExpiresAt).getTime() < Date.now() + 5 * 60 * 1000) {
                    try {
                        const tokens = await service.refreshAccessToken()
                        service.credentials.accessToken = tokens.accessToken
                        service.credentials.refreshToken = tokens.refreshToken
                        await prisma.onlineChannel.update({
                            where: { id: channel.id },
                            data: { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, tokenExpiresAt: new Date(Date.now() + tokens.expiresIn * 1000) },
                        })
                    } catch (e: any) { console.error('[ProcessReturn] Token refresh failed:', e.message) }
                }

                try {
                    if (isTikTokReturn) {
                        if (action === 'approve') await service.approveReturn(returnSn)
                        else await service.rejectReturn(returnSn, reviewNote)
                    } else {
                        if (action === 'approve') {
                            await service.confirmReturn(returnSn)
                        } else {
                            // Shopee từ chối = mở khiếu nại (dispute) — bắt buộc email + lý do
                            const { disputeEmail, disputeReason } = req.body
                            if (!disputeEmail) {
                                res.status(400).json({
                                    success: false,
                                    error: 'Từ chối trả hàng Shopee = mở khiếu nại — cần gửi kèm disputeEmail (email liên hệ) và disputeReason (mã lý do)',
                                })
                                return
                            }
                            await service.disputeReturn(returnSn, {
                                email: String(disputeEmail),
                                reason: Number(disputeReason) || 2,
                                textReason: reviewNote || 'Người bán không đồng ý yêu cầu trả hàng',
                            })
                        }
                    }
                } catch (platformErr: any) {
                    res.status(400).json({
                        success: false,
                        error: `${isTikTokReturn ? 'TikTok' : 'Shopee'} từ chối: ${platformErr.message}`,
                    })
                    return
                }
            } else {
                platformWarning = `Không tìm thấy kênh ${isTikTokReturn ? 'TikTok' : 'Shopee'} đã kết nối — chỉ cập nhật nội bộ, quyết định CHƯA được đẩy lên sàn`
                console.warn(`[ProcessReturn] ${platformWarning} (${rtnCode})`)
            }
        }

        const newStatus = action === 'approve' ? 'approved' : 'rejected'
        const updateData: any = {
            status: newStatus,
            notes: reviewNote ? `${returnOrder.notes || ''}\n[Review] ${reviewNote}` : returnOrder.notes,
            processedAt: new Date(),
        }

        if (action === 'approve') {
            updateData.refundedAt = new Date()
            updateData.status = 'refunded' // auto-mark as refunded on approve

            // ── Restore inventory ── mirror sang kho main (adjustSellableStock cần
            // productId): ưu tiên item.productId, fallback resolve theo SKU.
            // Đơn sàn không có branchId → null (kho main null-branch).
            for (const item of returnOrder.items) {
                let productId = item.productId as string | null
                if (!productId && item.sku) {
                    const p = await prisma.product.findFirst({ where: { sku: item.sku } })
                    productId = p?.id ?? null
                }
                if (productId) {
                    try {
                        await adjustSellableStock(prisma, productId, null, item.quantity)
                        console.log(`[Return] ✅ Restored ${item.quantity}x ${item.sku || productId}`)
                    } catch (invErr) {
                        console.error(`[Return] ⚠️ Failed to restore stock for ${item.sku || productId}:`, invErr)
                    }
                }
                // Mark as restocked
                await prisma.returnItem.update({
                    where: { id: item.id },
                    data: { restocked: true },
                })
            }

            // ── Update original order ──
            const originalOrder = await prisma.onlineOrder.findFirst({
                where: { orderNumber: returnOrder.originalInvoice },
            })
            if (originalOrder) {
                await prisma.onlineOrder.update({
                    where: { id: originalOrder.id },
                    data: {
                        status: 'returned',
                        paymentStatus: 'refunded',
                    },
                })
            }
        }

        const updated = await prisma.returnOrder.update({
            where: { id: returnId as string },
            data: updateData,
            include: { items: true },
        })

        // Audit log
        try {
            await prisma.auditLog.create({
                data: {
                    userId: req.user?.userId,
                    userName: req.user?.email || 'system',
                    action: action === 'approve' ? 'approve_return' : 'reject_return',
                    entity: 'ReturnOrder',
                    entityId: returnOrder.id,
                    details: JSON.stringify({
                        returnCode: returnOrder.code,
                        originalInvoice: returnOrder.originalInvoice,
                        action,
                        reviewNote,
                        totalRefund: returnOrder.totalRefund,
                    }),
                },
            })
        } catch { }

        res.json({ success: true, data: updated, ...(platformWarning ? { warning: platformWarning } : {}) })
    } catch (err) {
        console.error('Process return error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ═══════════════════════════════════════════════════════════════════════════════
//  SYNC RETURNS FROM SHOPEE / TIKTOK
// ═══════════════════════════════════════════════════════════════════════════════

router.post('/channels/:id/sync-returns', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const channel = await prisma.onlineChannel.findUnique({ where: { id: req.params.id as string } })
        if (!channel) { res.status(404).json({ success: false, error: 'Kênh không tồn tại' }); return }

        if (!['shopee', 'tiktok'].includes(channel.platform)) {
            res.status(400).json({ success: false, error: 'Hiện chỉ hỗ trợ sync trả hàng từ Shopee và TikTok' })
            return
        }

        // Logic dùng chung với webhook TikTok type 2 (returns realtime) — see services/returnSync.ts
        // Khoảng ngày CHỌN ĐƯỢC: body {from,to} (YYYY-MM-DD) hoặc {days}; mặc
        // định 15 ngày gần nhất như cũ. Sàn lọc theo NGÀY TẠO phiếu trả; Shopee
        // tự chia khung 14 ngày nên khoảng dài bao nhiêu cũng chạy được.
        const b = req.body || {}
        const days = Math.min(Math.max(Number(b.days) || 15, 1), 365)
        const since = b.from ? new Date(String(b.from) + 'T00:00:00+07:00')
            : new Date(Date.now() - days * 86400_000)
        const until = b.to ? new Date(String(b.to) + 'T23:59:59+07:00') : undefined
        if (isNaN(since.getTime()) || (until && isNaN(until.getTime()))) {
            res.status(400).json({ success: false, error: 'Ngày không hợp lệ' }); return
        }
        if (until && until < since) {
            res.status(400).json({ success: false, error: 'Từ ngày phải trước Đến ngày' }); return
        }
        const result = await syncChannelReturns(prisma, channel, since, until)

        // Audit log
        try {
            await prisma.auditLog.create({
                data: {
                    userId: req.user?.userId,
                    userName: req.user?.email || 'system',
                    action: 'sync_returns',
                    entity: 'OnlineChannel',
                    entityId: channel.id,
                    details: JSON.stringify({ synced: result.synced, skipped: result.skipped, errors: result.errors.length, total: result.total }),
                },
            })
        } catch { }

        res.json({
            success: true,
            data: {
                total: result.total,
                synced: result.synced,
                skipped: result.skipped,
                errors: result.errors,
            },
        })
    } catch (err: any) {
        console.error('Sync returns error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})




// POST /api/online-orders/channels/:id/sync-products
// POST /channels/:id/refresh-items — kéo lại chi tiết dòng hàng (từng phân loại)
// cho các đơn CHƯA GIAO XONG, cập nhật mã (model_sku) + tên [phân loại] để phiếu
// đóng gói khớp đúng SKU phân loại. Chỉ đổi sku+productName, giữ nguyên SL/giá/
// productId. KHÔNG đụng đơn đã giao (tránh ảnh hưởng phiếu bán/tồn kho).
router.post('/channels/:id/refresh-items', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const channel = await prisma.onlineChannel.findUnique({ where: { id: req.params.id as string } })
        if (!channel) { res.status(404).json({ success: false, error: 'Kênh không tồn tại' }); return }
        if (channel.platform !== 'shopee') { res.status(400).json({ success: false, error: 'Hiện chỉ hỗ trợ Shopee' }); return }

        const service = getPlatformService(channel.platform, {
            apiKey: channel.apiKey || '', apiSecret: channel.apiSecret || '',
            accessToken: channel.accessToken || undefined, refreshToken: channel.refreshToken || undefined,
            shopId: channel.shopId || undefined,
        })
        if (!service) { res.status(400).json({ success: false, error: 'Nền tảng chưa hỗ trợ' }); return }

        const NON_DELIVERED = [
            'pending', 'confirmed', 'processing', 'shipping',
            'UNPAID', 'READY_TO_SHIP', 'PROCESSED', 'SHIPPED', 'AWAITING_SHIPMENT', 'AWAITING_COLLECTION', 'IN_TRANSIT',
        ]
        const orders = await prisma.onlineOrder.findMany({
            where: { channelId: channel.id, status: { in: NON_DELIVERED }, externalOrderId: { not: null } },
            include: { items: { orderBy: { id: 'asc' } } },
            orderBy: { createdAt: 'desc' },
            take: 200,
        })

        let ordersUpdated = 0, itemsUpdated = 0
        for (const o of orders) {
            const eid = (o.externalOrderId || '').replace(/^(SPE-|TIK-|LAZ-)/i, '')
            if (!eid) continue
            try {
                const detail = await service.getOrderDetail(eid)
                const fresh = detail?.items || []
                // Cập nhật theo THỨ TỰ khi số dòng khớp (Shopee trả item_list ổn định)
                if (fresh.length === 0 || fresh.length !== o.items.length) continue
                let touched = false
                for (let i = 0; i < o.items.length; i++) {
                    const old = o.items[i], nw = fresh[i]
                    if ((nw.sku && nw.sku !== old.sku) || (nw.productName && nw.productName !== old.productName)) {
                        await prisma.onlineOrderItem.update({
                            where: { id: old.id },
                            data: { sku: nw.sku || old.sku, productName: nw.productName || old.productName },
                        })
                        itemsUpdated++; touched = true
                    }
                }
                if (touched) ordersUpdated++
            } catch { /* đơn lỗi lẻ — bỏ qua, không phá vòng */ }
        }
        res.json({ success: true, data: { ordersScanned: orders.length, ordersUpdated, itemsUpdated } })
    } catch (err) {
        console.error('refresh-items error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

router.post('/channels/:id/sync-products', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const channel = await prisma.onlineChannel.findUnique({ where: { id: req.params.id as string } })
        if (!channel) {
            res.status(404).json({ success: false, error: 'Kênh không tồn tại' })
            return
        }

        // For Shopee: fetch product list via item.get_item_list
        if (channel.platform === 'shopee') {
            const shopee = new ShopeeService({
                apiKey: channel.apiKey || '',
                apiSecret: channel.apiSecret || '',
                accessToken: (channel as any).accessToken || '',
                refreshToken: (channel as any).refreshToken || '',
                shopId: channel.shopId || '',
            })

            // Auto-refresh token if needed
            const tokenExpiresAt = (channel as any).tokenExpiresAt
            if (tokenExpiresAt && new Date(tokenExpiresAt).getTime() < Date.now() + 5 * 60 * 1000) {
                try {
                    const tokens = await shopee.refreshAccessToken();
                    (shopee as any).credentials.accessToken = tokens.accessToken;
                    (shopee as any).credentials.refreshToken = tokens.refreshToken;
                    await prisma.onlineChannel.update({
                        where: { id: channel.id },
                        data: {
                            accessToken: tokens.accessToken,
                            refreshToken: tokens.refreshToken,
                            tokenExpiresAt: new Date(Date.now() + tokens.expiresIn * 1000),
                        },
                    })
                } catch (e: any) {
                    console.warn('[sync-products] Token refresh failed:', e.message)
                }
            }

            // Fetch item list from Shopee
            let imported = 0, updated = 0
            const errors: string[] = []

            try {
                // item.get_item_list returns paginated list of item_id
                const listUrl = (shopee as any).apiUrl('/api/v2/product/get_item_list') +
                    `&offset=0&page_size=100&item_status=NORMAL&item_status=BANNED&item_status=UNLIST&item_status=DELETED`
                const listData: any = await (shopee as any).httpGet(listUrl)
                const items: any[] = listData?.response?.item || []

                // Fetch detail for each item
                if (items.length > 0) {
                    const itemIds = items.map((i: any) => i.item_id).join(',')
                    const detailUrl = (shopee as any).apiUrl('/api/v2/product/get_item_base_info') +
                        `&item_id_list=${itemIds}`
                    const detailData: any = await (shopee as any).httpGet(detailUrl)
                    const itemDetails: any[] = detailData?.response?.item_list || []
                    imported = itemDetails.length
                }
            } catch (e: any) {
                errors.push(e.message)
                console.error('[sync-products] Shopee item list error:', e.message)
            }

            // Log sync
            await prisma.syncLog.create({
                data: {
                    channelId: channel.id,
                    action: 'sync_products',
                    status: errors.length > 0 ? 'partial' : 'success',
                    details: `Products fetched: ${imported}, Errors: ${errors.length}${errors.length > 0 ? '\n' + errors[0] : ''}`,
                    ordersCount: imported,
                },
            }).catch(() => {})

            res.json({
                success: true,
                data: { imported, updated: 0, errors: errors.length, total: imported },
            })
            return
        }

        // For other platforms: just acknowledge
        res.json({
            success: true,
            data: { imported: 0, updated: 0, errors: 0, total: 0, message: `Nền tảng ${channel.platform} chưa hỗ trợ đồng bộ sản phẩm tự động` },
        })
    } catch (err: any) {
        console.error('Sync products error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// POST /api/online-orders/channels/:id/push-stock
// Đẩy tồn kho local LÊN sàn (TikTok inventory/update, Shopee update_stock).
// Map qua OnlineProduct: ưu tiên localProductId (gán tay), fallback khớp SKU.
// Body: { onlineProductIds?: string[], force?: boolean } — mặc định bỏ qua
// sản phẩm có tồn sàn đã bằng tồn local (tránh đốt rate limit).
router.post('/channels/:id/push-stock', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const channel = await prisma.onlineChannel.findUnique({ where: { id: req.params.id as string } })
        if (!channel) { res.status(404).json({ success: false, error: 'Kênh không tồn tại' }); return }
        if (!['shopee', 'tiktok'].includes(channel.platform)) {
            res.status(400).json({ success: false, error: `Nền tảng ${channel.platform} chưa hỗ trợ đẩy tồn kho` })
            return
        }
        if (!channel.accessToken) {
            res.status(400).json({ success: false, error: 'Kênh chưa kết nối API (thiếu access token)' })
            return
        }

        const service = getPlatformService(channel.platform, {
            apiKey: channel.apiKey || '', apiSecret: channel.apiSecret || '',
            accessToken: channel.accessToken || undefined,
            refreshToken: channel.refreshToken || undefined,
            shopId: channel.shopId || undefined,
        }) as any
        if (!service) { res.status(400).json({ success: false, error: 'Nền tảng chưa được hỗ trợ' }); return }

        // Auto-refresh token if expiring (5 min buffer)
        const tokenExpiresAt = (channel as any).tokenExpiresAt
        if (tokenExpiresAt && new Date(tokenExpiresAt).getTime() < Date.now() + 5 * 60 * 1000) {
            try {
                const tokens = await service.refreshAccessToken();
                service.credentials.accessToken = tokens.accessToken;
                service.credentials.refreshToken = tokens.refreshToken;
                await prisma.onlineChannel.update({
                    where: { id: channel.id },
                    data: { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, tokenExpiresAt: new Date(Date.now() + tokens.expiresIn * 1000) },
                })
            } catch (e: any) { console.warn('[push-stock] Token refresh failed:', e.message) }
        }

        const { onlineProductIds, force } = req.body || {}
        const where: any = { channelId: channel.id }
        if (Array.isArray(onlineProductIds) && onlineProductIds.length > 0) where.id = { in: onlineProductIds.map(String) }

        const onlineProducts = await prisma.onlineProduct.findMany({
            where,
            include: { localProduct: { select: { id: true, sku: true, stock: true } } },
        })

        let pushed = 0, skipped = 0, failed = 0
        const errors: string[] = []

        for (const p of onlineProducts) {
            // Resolve the local product: explicit link → SKU match → BẢNG ÁNH XẠ.
            // Thiếu bước ánh xạ thì phân loại có mã riêng (combo/vỉ) không bao giờ
            // đẩy được tồn, và im lặng bỏ qua nên rất khó phát hiện.
            let local: any = p.localProduct
            // rate = số ĐƠN VỊ GỐC trong 1 đơn vị bán trên sàn (1 vỉ = 10 cái)
            let rate = 1
            if (!local && p.sku) {
                local = await prisma.product.findFirst({
                    where: { sku: p.sku },
                    select: { id: true, sku: true, stock: true, mergedIntoId: true, mergedRate: true },
                })
            }
            if (!local && p.sku) {
                const m = await prisma.skuMapping.findFirst({
                    where: { platformSku: { equals: p.sku, mode: 'insensitive' } },
                }).catch(() => null)
                if (m?.productId) {
                    rate = Number((m as any).conversionRate) || 1
                    local = await prisma.product.findUnique({
                        where: { id: m.productId },
                        select: { id: true, sku: true, stock: true, mergedIntoId: true, mergedRate: true },
                    })
                }
            }
            // Mã ĐÃ GỘP: tồn nằm ở mã đích, quy đổi theo hệ số đã ghi
            if (local?.mergedIntoId) {
                rate *= Number(local.mergedRate) || 1
                local = await prisma.product.findUnique({
                    where: { id: local.mergedIntoId },
                    select: { id: true, sku: true, stock: true, mergedIntoId: true, mergedRate: true },
                })
            }
            if (!local) { skipped++; continue }

            // Tồn theo ĐƠN VỊ BÁN trên sàn: 26 cái = 2 vỉ (không phải 26 vỉ)
            const targetStock = Math.max(0, Math.floor((local.stock || 0) / (rate > 0 ? rate : 1)))
            if (!force && p.stock === targetStock) { skipped++; continue }

            try {
                if (channel.platform === 'shopee') {
                    await service.updateStock(p.platformProductId, targetStock)
                } else {
                    await service.updateStock(p.platformProductId, targetStock, undefined, p.sku || undefined)
                }
                await prisma.onlineProduct.update({
                    where: { id: p.id },
                    data: { stock: targetStock, syncedAt: new Date() },
                })
                pushed++
            } catch (e: any) {
                failed++
                errors.push(`${p.sku || p.platformProductId}: ${e.message}`)
                console.error(`[push-stock] ${channel.name} ${p.platformProductId}:`, e.message)
            }

            // Soft throttle between platform calls to stay under rate limits
            await new Promise(r => setTimeout(r, 300))
        }

        await prisma.syncLog.create({
            data: {
                channelId: channel.id,
                action: 'push_stock',
                status: failed > 0 ? 'partial' : 'success',
                details: `Pushed: ${pushed}, skipped: ${skipped}, failed: ${failed}${errors.length ? '\n' + errors.slice(0, 5).join('\n') : ''}`,
                ordersCount: pushed,
            },
        }).catch(() => { })

        res.json({ success: true, data: { pushed, skipped, failed, errors } })
    } catch (err: any) {
        console.error('Push stock error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// POST /api/online-orders/channels/:id/push-price
// Đẩy GIÁ BÁN local LÊN sàn (TikTok prices/update, Shopee update_price).
// Map qua OnlineProduct giống push-stock. Body: { onlineProductIds?: string[], force?: boolean }
router.post('/channels/:id/push-price', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const channel = await prisma.onlineChannel.findUnique({ where: { id: req.params.id as string } })
        if (!channel) { res.status(404).json({ success: false, error: 'Kênh không tồn tại' }); return }
        if (!['shopee', 'tiktok'].includes(channel.platform)) {
            res.status(400).json({ success: false, error: `Nền tảng ${channel.platform} chưa hỗ trợ đẩy giá` })
            return
        }
        if (!channel.accessToken) {
            res.status(400).json({ success: false, error: 'Kênh chưa kết nối API (thiếu access token)' })
            return
        }

        const service = getPlatformService(channel.platform, {
            apiKey: channel.apiKey || '', apiSecret: channel.apiSecret || '',
            accessToken: channel.accessToken || undefined,
            refreshToken: channel.refreshToken || undefined,
            shopId: channel.shopId || undefined,
        }) as any
        if (!service) { res.status(400).json({ success: false, error: 'Nền tảng chưa được hỗ trợ' }); return }

        // Auto-refresh token if expiring (5 min buffer)
        const tokenExpiresAt = (channel as any).tokenExpiresAt
        if (tokenExpiresAt && new Date(tokenExpiresAt).getTime() < Date.now() + 5 * 60 * 1000) {
            try {
                const tokens = await service.refreshAccessToken();
                service.credentials.accessToken = tokens.accessToken;
                service.credentials.refreshToken = tokens.refreshToken;
                await prisma.onlineChannel.update({
                    where: { id: channel.id },
                    data: { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, tokenExpiresAt: new Date(Date.now() + tokens.expiresIn * 1000) },
                })
            } catch (e: any) { console.warn('[push-price] Token refresh failed:', e.message) }
        }

        const { onlineProductIds, force } = req.body || {}
        const where: any = { channelId: channel.id }
        if (Array.isArray(onlineProductIds) && onlineProductIds.length > 0) where.id = { in: onlineProductIds.map(String) }

        const onlineProducts = await prisma.onlineProduct.findMany({
            where,
            include: { localProduct: { select: { id: true, sku: true, sellingPrice: true } } },
        })

        let pushed = 0, skipped = 0, failed = 0
        const errors: string[] = []

        for (const p of onlineProducts) {
            let local = p.localProduct
            if (!local && p.sku) {
                local = await prisma.product.findFirst({
                    where: { sku: p.sku },
                    select: { id: true, sku: true, sellingPrice: true },
                })
            }
            if (!local || !(local.sellingPrice > 0)) { skipped++; continue }

            const targetPrice = local.sellingPrice
            if (!force && p.price === targetPrice) { skipped++; continue }

            try {
                if (channel.platform === 'shopee') {
                    await service.updatePrice(p.platformProductId, targetPrice)
                } else {
                    await service.updatePrice(p.platformProductId, targetPrice, undefined, p.sku || undefined)
                }
                await prisma.onlineProduct.update({
                    where: { id: p.id },
                    data: { price: targetPrice, syncedAt: new Date() },
                })
                pushed++
            } catch (e: any) {
                failed++
                errors.push(`${p.sku || p.platformProductId}: ${e.message}`)
                console.error(`[push-price] ${channel.name} ${p.platformProductId}:`, e.message)
            }

            // Soft throttle between platform calls to stay under rate limits
            await new Promise(r => setTimeout(r, 300))
        }

        await prisma.syncLog.create({
            data: {
                channelId: channel.id,
                action: 'push_price',
                status: failed > 0 ? 'partial' : 'success',
                details: `Pushed: ${pushed}, skipped: ${skipped}, failed: ${failed}${errors.length ? '\n' + errors.slice(0, 5).join('\n') : ''}`,
                ordersCount: pushed,
            },
        }).catch(() => { })

        res.json({ success: true, data: { pushed, skipped, failed, errors } })
    } catch (err: any) {
        console.error('Push price error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// POST /api/online-orders/channels/:id/sync-fees
// Đối soát phí THẬT từ sàn (Shopee escrow / TikTok statement) cho các đơn đã
// hoàn thành — thay con số ước lượng theo commissionRate bằng phí sàn thực thu
// và tiền thực nhận. Body: { days?: number } (mặc định 30, tối đa 90).
router.post('/channels/:id/sync-fees', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const channel = await prisma.onlineChannel.findUnique({ where: { id: req.params.id as string } })
        if (!channel) { res.status(404).json({ success: false, error: 'Kênh không tồn tại' }); return }
        if (!['shopee', 'tiktok'].includes(channel.platform)) {
            res.status(400).json({ success: false, error: `Nền tảng ${channel.platform} chưa hỗ trợ đối soát phí` })
            return
        }
        if (!channel.accessToken) {
            res.status(400).json({ success: false, error: 'Kênh chưa kết nối API (thiếu access token)' })
            return
        }

        const creds = {
            apiKey: channel.apiKey || '', apiSecret: channel.apiSecret || '',
            accessToken: channel.accessToken || undefined,
            refreshToken: channel.refreshToken || undefined,
            shopId: channel.shopId || undefined,
        }
        const service: any = channel.platform === 'tiktok' ? new TikTokService(creds) : new ShopeeService(creds)

        // Auto-refresh token if expiring (5 min buffer)
        const tokenExpiresAt = (channel as any).tokenExpiresAt
        if (tokenExpiresAt && new Date(tokenExpiresAt).getTime() < Date.now() + 5 * 60 * 1000) {
            try {
                const tokens = await service.refreshAccessToken()
                service.credentials.accessToken = tokens.accessToken
                service.credentials.refreshToken = tokens.refreshToken
                await prisma.onlineChannel.update({
                    where: { id: channel.id },
                    data: { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, tokenExpiresAt: new Date(Date.now() + tokens.expiresIn * 1000) },
                })
            } catch (e: any) { console.warn('[sync-fees] Token refresh failed:', e.message) }
        }

        const days = Math.min(90, Math.max(1, Number(req.body?.days) || 30))
        // Phí thật chỉ có sau khi sàn quyết toán — quét đơn đã giao/hoàn thành
        const orders = await prisma.onlineOrder.findMany({
            where: {
                channelId: channel.id,
                // KHÔNG lọc trạng thái: Shopee đã có phí giao dịch NGAY khi đơn phát
                // sinh (đơn READY_TO_SHIP vẫn trả đủ commission/service/transaction
                // fee + escrow_amount). Lọc theo trạng thái làm đơn đang xử lý không
                // bao giờ được đối soát, sổ ôm phí ước tính sai gấp ~4 lần.
                status: { notIn: ['cancelled', 'CANCELLED', 'UNPAID'] },
                createdAt: { gte: new Date(Date.now() - days * 86400_000) },
            },
            select: { id: true, externalOrderId: true, orderNumber: true, total: true, shippingFee: true },
            orderBy: { createdAt: 'desc' },
            take: 200,
        })

        let updated = 0, unsettled = 0, failed = 0
        const errors: string[] = []

        // Chạy SONG SONG có giới hạn thay vì tuần tự + ngủ 250ms/đơn: bản cũ quét
        // 200 đơn mất ~220s (sát trần 300s Cloud Run → hay treo/timeout ở client).
        // 6 luồng đưa về ~30s mà vẫn nhẹ nhàng với rate-limit của sàn.
        await mapWithConcurrency(orders, async (order) => {
            const eid = (order.externalOrderId || '').replace(/^(SPE-|TIK-|LAZ-)/i, '')
            if (!eid) { unsettled++; return }
            try {
                let platformFee: number | null = null
                let netRevenue: number | null = null
                let adsVoucherDiscount = 0

                if (channel.platform === 'shopee') {
                    const escrow = await service.getEscrowDetail(eid)
                    // Nhận khi CÓ dữ liệu phí, không đòi tiền đã về ví
                    if (escrow && (escrow.escrowAmount > 0 || escrow.totalFees > 0)) {
                        platformFee = escrow.totalFees
                        netRevenue = escrow.escrowAmount
                        adsVoucherDiscount = escrow.adsVoucherDiscount || 0
                        // Ads Smart Voucher mới: chỉ quan sát, chưa biết seller có gánh hay không
                        if (adsVoucherDiscount > 0) {
                            console.log(`[sync-fees] ${order.orderNumber}: ads_voucher_discount=${adsVoucherDiscount}`)
                        }
                    }
                } else {
                    const settlement = await service.getOrderSettlement(eid)
                    if (settlement && settlement.settlementAmount > 0) {
                        platformFee = Math.round(settlement.feeAmount)
                        netRevenue = Math.round(settlement.settlementAmount)
                    }
                }

                if (platformFee === null || netRevenue === null) { unsettled++; return }

                // Chỉ cập nhật số liệu đối chiếu trên đơn (phí THẬT sàn trừ + tiền
                // thực nhận). KHÔNG sinh/ghi đè bút toán — phí sàn ghi nhận theo
                // hoá đơn GTGT cuối kỳ qua POST /api/tax/platform-fee-invoice.
                await prisma.onlineOrder.update({
                    where: { id: order.id },
                    data: { platformFee, netRevenue, adsVoucherDiscount },
                })

                updated++
            } catch (e: any) {
                failed++
                errors.push(`${order.orderNumber}: ${e.message}`)
                console.error(`[sync-fees] ${channel.name} ${order.orderNumber}:`, e.message)
            }
        }, 6)

        await prisma.syncLog.create({
            data: {
                channelId: channel.id,
                action: 'sync_fees',
                status: failed > 0 ? 'partial' : 'success',
                details: `Fees updated: ${updated}, unsettled: ${unsettled}, failed: ${failed}${errors.length ? '\n' + errors.slice(0, 5).join('\n') : ''}`,
                ordersCount: updated,
            },
        }).catch(() => { })

        res.json({ success: true, data: { scanned: orders.length, updated, unsettled, failed, errors } })
    } catch (err: any) {
        console.error('Sync fees error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// POST /api/online-orders/fix-totals - TEMPORARY endpoint to fix historical totals
router.post('/fix-totals', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        // Raw UPDATE ghi đè TOÀN BỘ OnlineOrder/Transaction/Payment — cực kỳ phá
        // hoại nếu gọi nhầm. Chỉ admin/owner được chạy, VÀ phải xác nhận chủ đích
        // bằng body { confirm: 'FIX-TOTALS' }.
        const role = req.user?.role || ''
        if (!['admin', 'owner', 'superadmin'].includes(role)) {
            res.status(403).json({ success: false, error: 'Chỉ quản trị viên (admin/owner) được chạy fix-totals' })
            return
        }
        if (req.body?.confirm !== 'FIX-TOTALS') {
            res.status(400).json({ success: false, error: "Thiếu xác nhận: gửi body { confirm: 'FIX-TOTALS' } để chạy (endpoint ghi đè toàn bộ tổng tiền đơn online)" })
            return
        }

        const prisma = req.storePrisma!

        // 1. Update OnlineOrder: total = subtotal, discount = 0
        await prisma.$executeRawUnsafe(`
            UPDATE "OnlineOrder" 
            SET discount = 0, 
                total = subtotal, 
                "netRevenue" = subtotal - "shippingFee" - "platformFee"
        `)
        
        // 2. Update Transaction: total = subtotal, amountReceived = subtotal, discount = 0
        await prisma.$executeRawUnsafe(`
            UPDATE "Transaction" 
            SET discount = 0, 
                total = subtotal, 
                "amountReceived" = subtotal 
            WHERE "receiptNumber" LIKE 'ONLINE-%' 
               OR "receiptNumber" LIKE 'SPE-%' 
               OR "receiptNumber" LIKE 'TIK-%' 
               OR "receiptNumber" LIKE 'LZD-%'
        `)

        // 3. Update Payments
        await prisma.$executeRawUnsafe(`
            UPDATE "Payment" p
            SET amount = t.total
            FROM "Transaction" t
            WHERE p."transactionId" = t.id
              AND (t."receiptNumber" LIKE 'ONLINE-%' 
                   OR t."receiptNumber" LIKE 'SPE-%' 
                   OR t."receiptNumber" LIKE 'TIK-%' 
                   OR t."receiptNumber" LIKE 'LZD-%')
        `)

        res.json({ success: true, message: 'Đã cập nhật lại tổng tiền cho tất cả đơn hàng online cũ.' })
    } catch (err: any) {
        console.error('Fix totals error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

export default router
