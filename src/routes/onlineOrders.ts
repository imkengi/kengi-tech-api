import { Router, Response } from 'express'
import { authMiddleware, AuthRequest, getBranchFilter } from '../middleware/auth'
import { nextCode } from '../lib/codeGenerator'

const router = Router()

// ═══════════════════════════════════════════════════════════════════════════════
//  ONLINE ORDER STATS
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/stats', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { channelId, startDate, endDate } = req.query
        const userRole = req.user?.role || 'cashier'
        const canSeeProfits = ['owner', 'admin'].includes(userRole)

        const where: any = {}
        if (channelId) where.channelId = channelId as string
        if (startDate || endDate) {
            where.createdAt = {}
            if (startDate) where.createdAt.gte = new Date(startDate as string)
            if (endDate) where.createdAt.lte = new Date(endDate as string)
        }

        const [totalOrders, totals, byStatus, byChannel] = await Promise.all([
            prisma.onlineOrder.count({ where }),
            prisma.onlineOrder.aggregate({
                where,
                _sum: { total: true, shippingFee: true, discount: true, platformFee: true, netRevenue: true },
            }),
            prisma.onlineOrder.groupBy({
                by: ['status'] as const,
                where,
                _count: true,
                _sum: { total: true },
            }),
            prisma.onlineOrder.groupBy({
                by: ['platform'] as const,
                where,
                _count: true,
                _sum: { total: true },
            }),
        ])

        // Helper: aggregate count for a status, covering both Shopee UPPERCASE and legacy lowercase
        const countFor = (...statuses: string[]) =>
            statuses.reduce((sum, s) => sum + (byStatus.find(b => b.status === s)?._count ?? 0), 0)

        res.json({
            success: true,
            data: {
                totalOrders,
                totalRevenue: totals._sum.total ?? 0,
                totalShippingFee: totals._sum.shippingFee ?? 0,
                totalDiscount: totals._sum.discount ?? 0,
                totalPlatformFee: canSeeProfits ? (totals._sum.platformFee ?? 0) : undefined,
                totalNetRevenue: canSeeProfits ? (totals._sum.netRevenue ?? 0) : undefined,
                // Completion rate: gom cả COMPLETED và completed
                completionRate: totalOrders > 0 ? Math.round((countFor('COMPLETED', 'completed') / totalOrders) * 100) : 0,
                // Pending count (Chờ xử lý): UNPAID + READY_TO_SHIP + pending + confirmed
                pendingCount: countFor('UNPAID', 'READY_TO_SHIP', 'pending', 'confirmed'),
                // Processing count (Đã xử lý): PROCESSED + processing
                processingCount: countFor('PROCESSED', 'processing'),
                // Shipping count: SHIPPED + shipping
                shippingCount: countFor('SHIPPED', 'shipping'),
                byStatus: byStatus.map(s => ({ status: s.status, count: s._count, revenue: s._sum.total ?? 0 })),
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

router.get('/stats/analytics', authMiddleware, async (req: AuthRequest, res: Response) => {
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
router.get('/channels', authMiddleware, async (req: AuthRequest, res: Response) => {
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
router.post('/channels', authMiddleware, async (req: AuthRequest, res: Response) => {
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

        res.json({ success: true, data: channel })
    } catch (err) {
        console.error('Create channel error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// PUT /api/online-orders/channels/:id
router.put('/channels/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
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
router.delete('/channels/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
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
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const {
            search, status, channelId, platform, paymentStatus,
            startDate, endDate,
            page = '1', pageSize = '20',
        } = req.query

        const pageNum = Math.max(1, parseInt(page as string, 10) || 1)
        const size = Math.min(100, Math.max(1, parseInt(pageSize as string, 10) || 20))
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
            const variants = STATUS_VARIANTS[status as string]
            where.status = variants ? { in: variants } : status as string
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
            where.createdAt = {}
            if (startDate) where.createdAt.gte = new Date(startDate as string)
            if (endDate) where.createdAt.lte = new Date(endDate as string)
        }

        const [total, orders] = await Promise.all([
            prisma.onlineOrder.count({ where }),
            prisma.onlineOrder.findMany({
                where,
                include: { items: true, channel: true },
                orderBy: { createdAt: 'desc' },
                skip,
                take: size,
            }),
        ])

        res.json({
            success: true,
            data: {
                items: orders,
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
router.get('/products/stats', authMiddleware, async (req: AuthRequest, res: Response) => {
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
router.get('/products', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { search, channelId, platform, status, page = '1', pageSize = '50' } = req.query

        const pageNum = Math.max(1, parseInt(page as string) || 1)
        const size = Math.min(200, Math.max(1, parseInt(pageSize as string) || 50))

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

        const items = rawProducts.map(p => {
            const ch = channelMap.get(p.channelId)
            const commissionRate = ch?.commissionRate ?? 6
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
                createdAt: p.createdAt.toISOString(),
                updatedAt: p.updatedAt?.toISOString() || null,
                syncedAt: p.syncedAt?.toISOString() || null,
                commissionRate,
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
router.put('/products/:id/link', authMiddleware, async (req: AuthRequest, res: Response) => {
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
        res.status(500).json({ success: false, error: err.message || 'Internal server error' })
    }
})

// PUT /api/online-orders/products/:id — Update price/stock stub
router.put('/products/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    res.json({ success: true, data: { id: req.params.id, ...req.body } })
})



// GET /api/online-orders/:id
router.get('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
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
router.post('/', authMiddleware, async (req: AuthRequest, res: Response) => {
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
router.put('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
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
router.put('/:id/status', authMiddleware, async (req: AuthRequest, res: Response) => {
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
            include: { items: true },
        })
        const oldStatus = oldOrder?.status

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
        // Deduct stock when order is confirmed/processed, restore when cancelled/returned
        const confirmStatuses = ['READY_TO_SHIP', 'PROCESSED', 'SHIPPED', 'confirmed', 'processing', 'shipping']
        const wasNotConfirmed = !oldStatus || !confirmStatuses.includes(oldStatus)
        const isNowConfirmed = confirmStatuses.includes(status)
        const isCancelled = ['CANCELLED', 'TO_RETURN', 'IN_CANCEL', 'cancelled', 'returned'].includes(status)
        const wasConfirmed = oldStatus && confirmStatuses.includes(oldStatus)

        if (order.items?.length) {
            try {
                if (wasNotConfirmed && isNowConfirmed) {
                    // Deduct inventory
                    for (const item of order.items) {
                        if (item.sku) {
                            await prisma.product.updateMany({
                                where: { sku: item.sku },
                                data: { stock: { decrement: item.quantity } },
                            })
                        }
                    }
                    console.log(`[Inventory Sync] ✅ Deducted stock for order ${order.orderNumber} (${order.items.length} items)`)
                } else if (isCancelled && wasConfirmed) {
                    // Restore inventory
                    for (const item of order.items) {
                        if (item.sku) {
                            await prisma.product.updateMany({
                                where: { sku: item.sku },
                                data: { stock: { increment: item.quantity } },
                            })
                        }
                    }
                    console.log(`[Inventory Sync] ✅ Restored stock for cancelled order ${order.orderNumber}`)
                }
            } catch (invErr) {
                console.error(`[Inventory Sync] ⚠️ Error syncing inventory for ${order.orderNumber}:`, invErr)
                // Don't fail the status update due to inventory errors
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

// PATCH /api/online-orders/:id/notes
router.patch('/:id/notes', authMiddleware, async (req: AuthRequest, res: Response) => {
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
router.get('/:id/activity', authMiddleware, async (req: AuthRequest, res: Response) => {
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
router.delete('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
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

        const result = await prisma.onlineOrder.updateMany({
            where: { id: { in: ids } },
            data,
        })

        res.json({ success: true, data: { updated: result.count } })
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
        res.json({ success: false, error: err.message })
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
        if (!channel || channel.platform !== 'shopee') {
            res.status(400).json({ success: false, error: 'Chỉ hỗ trợ in vận đơn Shopee. Đơn này thuộc kênh: ' + (channel?.platform || 'không rõ') })
            return
        }

        // Extract the real Shopee order_sn — strip any SPE- prefix
        let orderSn = order.externalOrderId || ''
        orderSn = orderSn.replace(/^(SPE-|TIK-|LAZ-)/i, '')
        if (!orderSn) {
            res.status(400).json({ success: false, error: 'Đơn này không có mã Shopee (externalOrderId)' })
            return
        }

        console.log(`[Shipping Label] Order: ${order.orderNumber}, Shopee order_sn: ${orderSn}, Status: ${order.externalStatus}`)

        let accessToken = (channel as any).accessToken || ''
        const refreshToken = (channel as any).refreshToken || ''
        const tokenExpiresAt = (channel as any).tokenExpiresAt

        const shopee = new ShopeeService({
            apiKey: channel.apiKey || '',
            apiSecret: channel.apiSecret || '',
            accessToken,
            refreshToken,
            shopId: channel.shopId || '',
        })

        // Auto-refresh token if expired or about to expire (5 min buffer)
        if (tokenExpiresAt && new Date(tokenExpiresAt).getTime() < Date.now() + 5 * 60 * 1000) {
            console.log(`[Shipping Label] Token expired, refreshing...`)
            try {
                const tokens = await shopee.refreshAccessToken()
                accessToken = tokens.accessToken;
                (shopee as any).credentials.accessToken = tokens.accessToken;
                (shopee as any).credentials.refreshToken = tokens.refreshToken;
                // Save new tokens to DB
                await prisma.onlineChannel.update({
                    where: { id: channel.id },
                    data: {
                        accessToken: tokens.accessToken,
                        refreshToken: tokens.refreshToken,
                        tokenExpiresAt: new Date(Date.now() + tokens.expiresIn * 1000),
                    },
                })
                console.log(`[Shipping Label] Token refreshed successfully`)
            } catch (refreshErr: any) {
                console.error('[Shipping Label] Token refresh failed:', refreshErr.message)
            }
        }

        const { pdf, contentType } = await shopee.downloadShippingLabel(orderSn)

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

        // Group by channel (should be same channel, but handle edge case)
        const shopeeOrders = orders.filter(o => o.channel?.platform === 'shopee')
        if (shopeeOrders.length === 0) {
            res.status(400).json({ success: false, error: 'Không có đơn Shopee nào trong danh sách' }); return
        }

        const channel = shopeeOrders[0].channel!

        // Build order_sn list (strip prefix)
        const orderSnList = shopeeOrders.map(o => {
            let sn = o.externalOrderId || ''
            sn = sn.replace(/^(SPE-|TIK-|LAZ-)/i, '')
            return sn
        }).filter(sn => sn.length > 0)

        console.log(`[Shipping Label Batch] ${orderSnList.length} orders: ${orderSnList.join(', ')}`)

        let accessToken = (channel as any).accessToken || ''
        const refreshToken = (channel as any).refreshToken || ''
        const tokenExpiresAt = (channel as any).tokenExpiresAt

        const shopee = new ShopeeService({
            apiKey: channel.apiKey || '',
            apiSecret: channel.apiSecret || '',
            accessToken,
            refreshToken,
            shopId: channel.shopId || '',
        })

        // Auto-refresh token if expired
        if (tokenExpiresAt && new Date(tokenExpiresAt).getTime() < Date.now() + 5 * 60 * 1000) {
            console.log(`[Shipping Label Batch] Token expired, refreshing...`)
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
                console.log(`[Shipping Label Batch] Token refreshed`)
            } catch (refreshErr: any) {
                console.error('[Shipping Label Batch] Token refresh failed:', refreshErr.message)
            }
        }

        const { pdf, contentType, errors } = await shopee.downloadShippingLabelBatch(orderSnList)

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
        res.status(500).json({ success: false, error: err.message || 'Lỗi tải vận đơn hàng loạt' })
    }
})

// ═══════════════════════════════════════════════════════════════════════════════
//  PLATFORM INTEGRATION — OAuth, Sync, Test Connection
// ═══════════════════════════════════════════════════════════════════════════════

import { getPlatformService, isSupportedPlatform, type PlatformOrder } from '../services/platforms'
import { processNewOrders } from '../services/orderSync'

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

        const service = getPlatformService(channel.platform, {
            apiKey: channel.apiKey || '', apiSecret: channel.apiSecret || '',
            shopId: channel.shopId || undefined,
        })
        if (!service) { res.status(400).json({ success: false, error: 'Nền tảng chưa được hỗ trợ' }); return }

        const baseUrl = process.env.APP_BASE_URL || `${req.protocol}://${req.get('host')}`
        const redirectUri = `${baseUrl}/api/online-orders/channels/${channel.id}/callback`
        const state = Buffer.from(JSON.stringify({ channelId: channel.id })).toString('base64')
        const authUrl = service.generateAuthUrl(redirectUri, state)

        res.json({ success: true, data: { authUrl, redirectUri } })
    } catch (err: any) {
        console.error('Generate auth URL error:', err)
        res.status(500).json({ success: false, error: err.message || 'Internal server error' })
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

// POST /api/online-orders/channels/:id/exchange-token  (body: { code })
router.post('/channels/:id/exchange-token', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const channel = await prisma.onlineChannel.findUnique({ where: { id: req.params.id as string } })
        if (!channel) { res.status(404).json({ success: false, error: 'Kênh không tồn tại' }); return }

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
                syncEnabled: true,
            },
        })

        await prisma.syncLog.create({
            data: { channelId: channel.id, action: 'exchange_token', status: 'success', details: `Token obtained, shop: ${tokens.shopId || 'N/A'}` },
        })

        res.json({ success: true, data: { shopId: tokens.shopId, expiresIn: tokens.expiresIn } })
    } catch (err: any) {
        console.error('Exchange token error:', err)
        res.status(500).json({ success: false, error: err.message || 'Internal server error' })
    }
})

// POST /api/online-orders/channels/:id/sync
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

        // Fetch orders from platform (with retry-on-token-error)
        // Với update_time, luôn dùng 15 ngày để bắt đơn cũ đã thay đổi status
        // (lastSyncAt quá ngắn — đơn cũ có thể update_time trong window 15 ngày)
        const since = new Date(Date.now() - 14 * 86400_000)
        let allOrders: PlatformOrder[] = []
        let page = 1
        let hasMore = true

        const fetchWithRetry = async () => {
            while (hasMore && page <= 10) {
                const result = await service.fetchOrders({ since, page, pageSize: 50 })
                allOrders = allOrders.concat(result.orders)
                hasMore = result.hasMore
                page++
            }
        }

        try {
            await fetchWithRetry()
        } catch (fetchErr: any) {
            // If it's a token error, try refresh once and retry
            if (fetchErr.message?.includes('invalid_access_token') || fetchErr.message?.includes('error_auth')) {
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
                    allOrders = []
                    page = 1
                    hasMore = true
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

        for (const order of allOrders) {
            try {
                const existing = await prisma.onlineOrder.findFirst({
                    where: { externalOrderId: order.externalOrderId, channelId: channel.id },
                })

                if (existing) {
                    // Fetch tracking number from logistics API if missing
                    let trackingNo = order.trackingNumber || existing.trackingNumber
                    let carrier = order.shippingCarrier || existing.shippingCarrier
                    if (!trackingNo && channel.platform === 'shopee' && ['shipping', 'delivered', 'completed'].includes(order.status)) {
                        try {
                            const shopeeService = new ShopeeService({
                                apiKey: channel.apiKey || '', apiSecret: channel.apiSecret || '',
                                accessToken: channel.accessToken || undefined,
                                refreshToken: channel.refreshToken || undefined,
                                shopId: channel.shopId || undefined,
                            })
                            trackingNo = await shopeeService.getTrackingNumber(order.externalOrderId) || null
                        } catch { }
                    }

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
                            trackingNumber: order.trackingNumber || null,
                            shippingCarrier: order.shippingCarrier || null,
                            paidAt: order.paidAt ? new Date(order.paidAt) : null,
                            shippedAt: order.shippedAt ? new Date(order.shippedAt) : null,
                            deliveredAt: order.deliveredAt ? new Date(order.deliveredAt) : null,
                            syncedAt: new Date(),
                            createdAt: new Date(order.createdAt),
                            platformFeeRate: channel.commissionRate || 0,
                            platformFee: Math.round(order.total * (channel.commissionRate || 0) / 100),
                            netRevenue: Math.round(order.total - order.total * (channel.commissionRate || 0) / 100 - order.shippingFee),
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

        // Update channel stats
        const orderStats = await prisma.onlineOrder.aggregate({
            where: { channelId: channel.id },
            _count: true,
            _sum: { total: true },
        })
        await prisma.onlineChannel.update({
            where: { id: channel.id },
            data: {
                lastSyncAt: new Date(),
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

                    // Gọi Shopee get_order_detail theo batch 50
                    const BATCH = 50
                    const shopeeForRefresh = new ShopeeService({
                        apiKey: channel.apiKey || '', apiSecret: channel.apiSecret || '',
                        accessToken: (channel as any).accessToken || '',
                        refreshToken: (channel as any).refreshToken || '',
                        shopId: channel.shopId || '',
                    })
                    for (let i = 0; i < orderSns.length; i += BATCH) {
                        const batch = orderSns.slice(i, i + BATCH)
                        try {
                            const detailPath = '/api/v2/order/get_order_detail'
                            const detailUrl = (shopeeForRefresh as any).apiUrl(detailPath) +
                                `&order_sn_list=${batch.join(',')}&response_optional_fields=tracking_no,shipping_carrier`
                            const detailData: any = await (shopeeForRefresh as any).httpGet(detailUrl)
                            const details: any[] = detailData.response?.order_list || []

                            for (const d of details) {
                                const sn: string = d.order_sn
                                const dbId = snToId[sn]
                                if (!dbId) continue
                                const newStatus: string = (shopeeForRefresh as any).mapStatus(d.order_status)
                                const newPayStatus: string = (shopeeForRefresh as any).mapPaymentStatus(d.order_status)

                                const newTracking = d.tracking_no || snToOld[sn]?.trackingNumber || null
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
                        } catch (batchErr: any) {
                            console.error(`[Sync] Batch status refresh error (i=${i}):`, batchErr.message)
                        }
                    }
                    console.log(`[Sync] Status refreshed: ${statusRefreshed}/${orderSns.length} orders updated`)
                }
            } catch (refreshErr: any) {
                console.error('[Sync] Batch status refresh failed:', refreshErr.message)
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
                        syncedAt: new Date(),
                    },
                    update: {
                        name: p.name,
                        sku: p.sku || null,
                        price: p.price,
                        stock: p.stock,
                        status: p.status || 'NORMAL',
                        imageUrl: p.imageUrl || null,
                        syncedAt: new Date(),
                    },
                })
                productsSynced++
            }
            console.log(`[Sync] Product catalog: ${productsSynced} products synced`)
        } catch (prodErr: any) {
            console.error('[Sync] Product catalog sync error:', prodErr.message)
            errors.push(`Product sync: ${prodErr.message}`)
        }

        res.json({
            success: true,
            data: { imported, updated, statusRefreshed, productsSynced, errors: errors.length, total: allOrders.length, converted },
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

        res.status(500).json({ success: false, error: err.message || 'Internal server error' })
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
        res.status(500).json({ success: false, error: err.message || 'Internal server error' })
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
        res.status(500).json({ success: false, error: err.message || 'Internal server error' })
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
        const { status, page = '1', pageSize = '20' } = req.query

        const where: any = {
            code: { startsWith: 'RTN-ON' }, // only online order returns
        }
        if (status && status !== 'all') where.status = status as string

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

        res.json({
            success: true,
            data: {
                data: returns,
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

        const [total, pending, approved, rejected, totalRefunded] = await Promise.all([
            prisma.returnOrder.count({ where: { code: { startsWith: 'RTN-ON' } } }),
            prisma.returnOrder.count({ where: { code: { startsWith: 'RTN-ON' }, status: 'pending' } }),
            prisma.returnOrder.count({ where: { code: { startsWith: 'RTN-ON' }, status: { in: ['approved', 'refunded'] } } }),
            prisma.returnOrder.count({ where: { code: { startsWith: 'RTN-ON' }, status: 'rejected' } }),
            prisma.returnOrder.aggregate({
                where: { code: { startsWith: 'RTN-ON' }, status: { in: ['approved', 'refunded'] } },
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

        const newStatus = action === 'approve' ? 'approved' : 'rejected'
        const updateData: any = {
            status: newStatus,
            notes: reviewNote ? `${returnOrder.notes || ''}\n[Review] ${reviewNote}` : returnOrder.notes,
            processedAt: new Date(),
        }

        if (action === 'approve') {
            updateData.refundedAt = new Date()
            updateData.status = 'refunded' // auto-mark as refunded on approve

            // ── Restore inventory ──
            for (const item of returnOrder.items) {
                if (item.sku) {
                    try {
                        await prisma.product.updateMany({
                            where: { sku: item.sku },
                            data: { stock: { increment: item.quantity } },
                        })
                        console.log(`[Return] ✅ Restored ${item.quantity}x ${item.sku}`)
                    } catch (invErr) {
                        console.error(`[Return] ⚠️ Failed to restore stock for ${item.sku}:`, invErr)
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

        res.json({ success: true, data: updated })
    } catch (err) {
        console.error('Process return error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ═══════════════════════════════════════════════════════════════════════════════
//  SYNC RETURNS FROM SHOPEE
// ═══════════════════════════════════════════════════════════════════════════════

router.post('/channels/:id/sync-returns', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const channel = await prisma.onlineChannel.findUnique({ where: { id: req.params.id as string } })
        if (!channel) { res.status(404).json({ success: false, error: 'Kênh không tồn tại' }); return }

        if (channel.platform !== 'shopee') {
            res.status(400).json({ success: false, error: 'Hiện chỉ hỗ trợ sync trả hàng từ Shopee' })
            return
        }

        const service = new ShopeeService({
            apiKey: channel.apiKey || '', apiSecret: channel.apiSecret || '',
            accessToken: channel.accessToken || undefined,
            refreshToken: channel.refreshToken || undefined,
            shopId: channel.shopId || undefined,
        })

        // Fetch returns from last 15 days
        const since = new Date(Date.now() - 15 * 86400_000)
        const shopeeReturns = await service.fetchReturns({ since })

        let synced = 0, skipped = 0
        const errors: string[] = []

        for (const ret of shopeeReturns) {
            try {
                // Check if already synced
                const existingReturn = await prisma.returnOrder.findFirst({
                    where: { code: `RTN-SH-${ret.returnSn}` },
                })
                if (existingReturn) {
                    // Update status if changed
                    if (existingReturn.status !== ret.status) {
                        await prisma.returnOrder.update({
                            where: { id: existingReturn.id },
                            data: {
                                status: ret.status,
                                notes: `${existingReturn.notes || ''}\n[Shopee] ${ret.shopeeStatus} (${new Date().toLocaleString('vi-VN')})`,
                                ...(ret.status === 'refunded' ? { refundedAt: new Date(), processedAt: new Date() } : {}),
                            },
                        })

                        // If refunded, update order status
                        if (ret.status === 'refunded') {
                            const order = await prisma.onlineOrder.findFirst({
                                where: { externalOrderId: ret.orderSn, channelId: channel.id },
                            })
                            if (order) {
                                await prisma.onlineOrder.update({
                                    where: { id: order.id },
                                    data: { status: 'returned', paymentStatus: 'refunded' },
                                })
                            }
                        }
                    }
                    skipped++
                    continue
                }

                // Find original order
                const order = await prisma.onlineOrder.findFirst({
                    where: { externalOrderId: ret.orderSn, channelId: channel.id },
                    include: { items: true },
                })

                // Create ReturnOrder
                const returnCode = `RTN-SH-${ret.returnSn}`
                const refundAmount = typeof ret.refundAmount === 'number' ? ret.refundAmount : 0

                const returnItems = ret.items.map((i: any) => ({
                    productName: i.name || i.modelName || 'SP Shopee',
                    sku: '',
                    quantity: i.amount || 1,
                    unitPrice: i.itemPrice || 0,
                    returnReason: ret.reason || ret.textReason || 'Trả hàng từ Shopee',
                    condition: 'used',
                }))

                await prisma.returnOrder.create({
                    data: {
                        code: returnCode,
                        originalInvoice: order?.orderNumber || ret.orderSn,
                        customerName: order?.customerName || 'Khách Shopee',
                        customerPhone: order?.customerPhone || undefined,
                        reason: ret.reason || ret.textReason || 'Trả hàng từ Shopee',
                        refundMethod: 'platform_refund',
                        refundAmount,
                        totalRefund: refundAmount,
                        notes: `[Shopee] Status: ${ret.shopeeStatus}\nReturn SN: ${ret.returnSn}\nTracking: ${ret.trackingNumber || 'N/A'}\nNeed return: ${ret.needReturn ? 'Có' : 'Không'}`,
                        staffName: 'Shopee Auto-Sync',
                        status: ret.status,
                        ...(ret.status === 'refunded' ? { refundedAt: ret.updateTime, processedAt: ret.updateTime } : {}),
                        items: {
                            create: returnItems.length > 0 ? returnItems : [{
                                productName: 'SP từ Shopee',
                                quantity: 1,
                                unitPrice: refundAmount,
                                returnReason: ret.reason || 'Trả hàng Shopee',
                                condition: 'used',
                            }],
                        },
                    },
                })

                // Update order status if refunded
                if (order && ret.status === 'refunded') {
                    await prisma.onlineOrder.update({
                        where: { id: order.id },
                        data: { status: 'returned', paymentStatus: 'refunded' },
                    })
                }

                synced++
            } catch (itemErr: any) {
                errors.push(`Return ${ret.returnSn}: ${itemErr.message}`)
            }
        }

        // Audit log
        try {
            await prisma.auditLog.create({
                data: {
                    userId: req.user?.userId,
                    userName: req.user?.email || 'system',
                    action: 'sync_returns',
                    entity: 'OnlineChannel',
                    entityId: channel.id,
                    details: JSON.stringify({ synced, skipped, errors: errors.length, total: shopeeReturns.length }),
                },
            })
        } catch { }

        res.json({
            success: true,
            data: {
                total: shopeeReturns.length,
                synced,
                skipped,
                errors,
            },
        })
    } catch (err: any) {
        console.error('Sync returns error:', err)
        res.status(500).json({ success: false, error: err.message || 'Internal server error' })
    }
})




// POST /api/online-orders/channels/:id/sync-products
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
        res.status(500).json({ success: false, error: err.message || 'Internal server error' })
    }
})

// POST /api/online-orders/fix-totals - TEMPORARY endpoint to fix historical totals
router.post('/fix-totals', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
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
        res.status(500).json({ success: false, error: err.message })
    }
})

export default router
