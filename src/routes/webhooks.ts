import { Router, Request, Response } from 'express'
import registryPrisma, { getStorePrisma } from '../lib/prisma'
import { ShopeeService } from '../services/platforms/shopee'
import { cacheGet, cacheSet, cacheDel } from '../lib/cache'

const router = Router()

// ═══════════════════════════════════════════════════════════════════════════════
//  SHOPEE WEBHOOK (PUSH NOTIFICATION)
//  No auth required — Shopee sends POST to this endpoint
//  Push Codes:
//    0  = shop authorization
//    3  = order status change  
//    4  = tracking number update
//    5  = Shopee updates
// ═══════════════════════════════════════════════════════════════════════════════

router.post('/shopee', async (req: Request, res: Response) => {
    // Always respond 200 immediately (Shopee retries on non-200)
    res.json({ success: true })

    try {
        const body = req.body
        const shopId = String(body.shop_id)
        const pushCode = body.code
        const data = body.data || {}

        console.log(`[Shopee Webhook] code=${pushCode} shop=${shopId} data=${JSON.stringify(data).substring(0, 300)}`)

        // Only process order-related push codes
        if (pushCode !== 3 && pushCode !== 4) {
            console.log(`[Shopee Webhook] Ignoring push code ${pushCode}`)
            return
        }

        const orderSn = data.ordersn || data.order_sn
        if (!orderSn) {
            console.log(`[Shopee Webhook] No ordersn in data`)
            return
        }

        // Find which store+channel matches this shopId
        const allStores = await registryPrisma.store.findMany({ where: { status: 'active' } })

        let channel: any = null
        let storePrisma: any = null

        for (const store of allStores) {
            try {
                const prisma = getStorePrisma(store.schema)

                const found = await prisma.onlineChannel.findFirst({
                    where: {
                        platform: 'shopee',
                        shopId: shopId,
                    },
                })

                if (found) {
                    channel = found
                    storePrisma = prisma
                    break
                }
            } catch {
                // Store might not have OnlineChannel table
                continue
            }
        }

        if (!channel || !storePrisma) {
            console.log(`[Shopee Webhook] No channel found for shop_id=${shopId}`)
            return
        }

        // Create ShopeeService to fetch order detail
        const shopee = new ShopeeService({
            apiKey: channel.apiKey,
            apiSecret: channel.apiSecret,
            accessToken: channel.accessToken,
            refreshToken: channel.refreshToken,
            shopId: channel.shopId,
        })

        // Fetch full order detail from Shopee
        const orderDetail = await shopee.getOrderDetail(orderSn)
        if (!orderDetail) {
            console.log(`[Shopee Webhook] Could not fetch order detail for ${orderSn}`)
            return
        }

        // Find existing order in DB
        const existing = await storePrisma.onlineOrder.findFirst({
            where: { externalOrderId: orderSn, channelId: channel.id },
        })

        if (existing) {
            // Update existing order
            await storePrisma.onlineOrder.update({
                where: { id: existing.id },
                data: {
                    status: orderDetail.status,
                    externalStatus: orderDetail.externalStatus,
                    paymentStatus: orderDetail.paymentStatus,
                    trackingNumber: orderDetail.trackingNumber || existing.trackingNumber,
                    shippingCarrier: orderDetail.shippingCarrier || existing.shippingCarrier,
                    shippedAt: orderDetail.shippedAt ? new Date(orderDetail.shippedAt) : existing.shippedAt,
                    deliveredAt: orderDetail.deliveredAt ? new Date(orderDetail.deliveredAt) : existing.deliveredAt,
                    paidAt: orderDetail.paidAt ? new Date(orderDetail.paidAt) : existing.paidAt,
                    syncedAt: new Date(),
                },
            })
            console.log(`[Shopee Webhook] ✅ Updated ${orderSn} → status=${orderDetail.status} tracking=${orderDetail.trackingNumber || 'none'}`)
        } else {
            // Create new order
            await storePrisma.onlineOrder.create({
                data: {
                    orderNumber: orderDetail.orderNumber,
                    channelId: channel.id,
                    channelName: channel.name,
                    platform: 'shopee',
                    externalOrderId: orderSn,
                    externalStatus: orderDetail.externalStatus,
                    customerName: orderDetail.customerName,
                    customerPhone: orderDetail.customerPhone || null,
                    customerEmail: orderDetail.customerEmail || null,
                    shippingAddress: orderDetail.shippingAddress || null,
                    status: orderDetail.status,
                    subtotal: orderDetail.subtotal,
                    discount: orderDetail.discount,
                    shippingFee: orderDetail.shippingFee,
                    total: orderDetail.total,
                    paymentMethod: orderDetail.paymentMethod || null,
                    paymentStatus: orderDetail.paymentStatus,
                    trackingNumber: orderDetail.trackingNumber || null,
                    shippingCarrier: orderDetail.shippingCarrier || null,
                    paidAt: orderDetail.paidAt ? new Date(orderDetail.paidAt) : null,
                    shippedAt: orderDetail.shippedAt ? new Date(orderDetail.shippedAt) : null,
                    deliveredAt: orderDetail.deliveredAt ? new Date(orderDetail.deliveredAt) : null,
                    syncedAt: new Date(),
                    createdAt: new Date(orderDetail.createdAt),
                    platformFeeRate: channel.commissionRate || 0,
                    platformFee: Math.round(orderDetail.total * (channel.commissionRate || 0) / 100),
                    netRevenue: Math.round(orderDetail.total - orderDetail.total * (channel.commissionRate || 0) / 100 - orderDetail.shippingFee),
                    items: {
                        create: orderDetail.items.map(item => ({
                            externalItemId: item.externalItemId || '',
                            productName: item.productName,
                            sku: item.sku || null,
                            quantity: item.quantity,
                            unitPrice: item.unitPrice,
                            discount: item.discount || 0,
                            lineTotal: item.lineTotal,
                        })),
                    },
                },
            })
            console.log(`[Shopee Webhook] ✅ Created new order ${orderSn} → ${orderDetail.status}`)
        }

    } catch (err: any) {
        console.error('[Shopee Webhook] Error:', err.message)
    }
})

export default router
