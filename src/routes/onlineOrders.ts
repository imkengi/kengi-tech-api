import { Router, Response } from 'express'
import { authMiddleware, AuthRequest, getBranchFilter } from '../middleware/auth'

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

        const completedCount = byStatus.find(s => s.status === 'completed')?._count ?? 0

        res.json({
            success: true,
            data: {
                totalOrders,
                totalRevenue: totals._sum.total ?? 0,
                totalShippingFee: totals._sum.shippingFee ?? 0,
                totalDiscount: totals._sum.discount ?? 0,
                totalPlatformFee: canSeeProfits ? (totals._sum.platformFee ?? 0) : undefined,
                totalNetRevenue: canSeeProfits ? (totals._sum.netRevenue ?? 0) : undefined,
                completionRate: totalOrders > 0 ? Math.round((completedCount / totalOrders) * 100) : 0,
                pendingCount: byStatus.find(s => s.status === 'pending')?._count ?? 0,
                processingCount: (byStatus.find(s => s.status === 'confirmed')?._count ?? 0)
                    + (byStatus.find(s => s.status === 'processing')?._count ?? 0),
                shippingCount: byStatus.find(s => s.status === 'shipping')?._count ?? 0,
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
        if (status && status !== 'all') where.status = status
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
        const count = await prisma.onlineOrder.count({
            where: { orderNumber: { startsWith: prefix } },
        })
        const orderNumber = `${prefix}-${String(count + 1).padStart(4, '0')}`

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

        const validStatuses = ['pending', 'confirmed', 'processing', 'shipping', 'delivered', 'completed', 'cancelled', 'returned']
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
        if (status === 'shipping') {
            updateData.shippedAt = new Date()
            if (trackingNumber) updateData.trackingNumber = trackingNumber
            if (shippingCarrier) updateData.shippingCarrier = shippingCarrier
        }
        if (status === 'delivered') updateData.deliveredAt = new Date()
        if (status === 'completed') updateData.paymentStatus = 'paid'
        if (status === 'completed' && !updateData.paidAt) updateData.paidAt = new Date()

        const order = await prisma.onlineOrder.update({
            where: { id: id as string },
            data: updateData,
            include: { items: true, channel: true },
        })

        // ── Inventory auto-sync ──────────────────────────────────────────
        // Deduct stock when confirmed, restore when cancelled
        const confirmStatuses = ['confirmed', 'processing', 'shipping']
        const wasNotConfirmed = !oldStatus || !confirmStatuses.includes(oldStatus)
        const isNowConfirmed = confirmStatuses.includes(status)
        const isCancelled = status === 'cancelled' || status === 'returned'
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
        if (!['pending', 'cancelled'].includes(order.status)) {
            res.status(400).json({ success: false, error: 'Chỉ có thể xóa đơn ở trạng thái Chờ xử lý hoặc Đã hủy' })
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
        if (status === 'shipping') data.shippedAt = new Date()
        if (status === 'delivered') data.deliveredAt = new Date()
        if (status === 'completed' || status === 'delivered') data.paymentStatus = 'paid'

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

        // Fetch orders from platform
        const since = channel.lastSyncAt || new Date(Date.now() - 7 * 86400_000)
        let allOrders: PlatformOrder[] = []
        let page = 1
        let hasMore = true

        while (hasMore && page <= 10) { // Max 10 pages safety
            const result = await service.fetchOrders({ since, page, pageSize: 50 })
            allOrders = allOrders.concat(result.orders)
            hasMore = result.hasMore
            page++
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

        res.json({
            success: true,
            data: { imported, updated, errors: errors.length, total: allOrders.length, converted },
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
        const returnCount = await prisma.returnOrder.count()
        const returnCode = `RTN-ON-${String(returnCount + 1).padStart(5, '0')}`

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

export default router
