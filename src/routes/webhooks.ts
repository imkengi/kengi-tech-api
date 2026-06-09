import { Router, Request, Response } from 'express'
import crypto from 'crypto'
import registryPrisma, { getStorePrisma } from '../lib/prisma'
import { ShopeeService } from '../services/platforms/shopee'
import { TikTokService } from '../services/platforms/tiktok'
import { convertOnlineOrderToTransaction } from '../services/orderSync'
import { cacheGet, cacheSet, cacheDel } from '../lib/cache'

const router = Router()

// Cache shop_id → store schema for 1h. Avoids scanning every active store schema
// on every webhook delivery; invalidates naturally when channel credentials rotate.
const SHOP_SCHEMA_TTL = 3600
const shopSchemaCacheKey = (shopId: string) => `webhook:shopee:shop:${shopId}:schema`
const tiktokSchemaCacheKey = (shopId: string) => `webhook:tiktok:shop:${shopId}:schema`

// Shopee push signature: HMAC-SHA256(partner_key, push_url + "|" + raw_body) hex.
// Sent in the Authorization header. Returns true when signature matches.
function verifyShopeeSignature(rawBody: Buffer, url: string, partnerKey: string, signature: string): boolean {
    const baseString = `${url}|${rawBody.toString('utf8')}`
    const expected = crypto.createHmac('sha256', partnerKey).update(baseString).digest('hex')
    try {
        const a = Buffer.from(expected, 'hex')
        const b = Buffer.from(signature, 'hex')
        if (a.length !== b.length) return false
        return crypto.timingSafeEqual(a, b)
    } catch {
        return false
    }
}

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

        const rawBody: Buffer | undefined = (req as any).rawBody
        const signature = String(req.header('authorization') || req.header('x-shopee-signature') || '').trim()
        const pushUrl = process.env.SHOPEE_WEBHOOK_URL ||
            `${req.protocol}://${req.get('host')}${req.originalUrl}`

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

        // ── Find channel by shop_id (cached schema lookup → fall back to scan) ──
        let channel: any = null
        let storePrisma: any = null
        let resolvedSchema: string | null = null

        const cachedSchema = shopId ? await cacheGet<string>(shopSchemaCacheKey(shopId)) : null
        if (cachedSchema) {
            try {
                const prisma = getStorePrisma(cachedSchema)
                const found = await prisma.onlineChannel.findFirst({
                    where: { platform: 'shopee', shopId },
                })
                if (found) {
                    channel = found
                    storePrisma = prisma
                    resolvedSchema = cachedSchema
                }
            } catch {
                // Cached schema went stale (store removed, table missing) — fall through to scan.
            }
        }

        if (!channel) {
            const allStores = await registryPrisma.store.findMany({ where: { status: 'active' } })
            for (const store of allStores) {
                try {
                    const prisma = getStorePrisma(store.schema)
                    const found = await prisma.onlineChannel.findFirst({
                        where: { platform: 'shopee', shopId },
                    })
                    if (found) {
                        channel = found
                        storePrisma = prisma
                        resolvedSchema = store.schema
                        break
                    }
                } catch {
                    // Store might not have OnlineChannel table
                    continue
                }
            }
        }

        if (!channel || !storePrisma) {
            console.log(`[Shopee Webhook] No channel found for shop_id=${shopId}`)
            return
        }

        if (resolvedSchema && resolvedSchema !== cachedSchema) {
            await cacheSet(shopSchemaCacheKey(shopId), resolvedSchema, SHOP_SCHEMA_TTL)
        }

        // ── Verify HMAC signature (env-wide partner key, then per-channel apiSecret) ──
        const partnerKey = process.env.SHOPEE_PARTNER_KEY || channel.apiSecret || ''
        if (!partnerKey) {
            console.warn(`[Shopee Webhook] No partner key available for shop_id=${shopId} — processing without signature check`)
        } else if (!signature) {
            console.warn(`[Shopee Webhook] Missing Authorization header for shop_id=${shopId} — processing without signature check`)
        } else if (!rawBody) {
            console.warn(`[Shopee Webhook] Raw body unavailable — processing without signature check`)
        } else if (!verifyShopeeSignature(rawBody, pushUrl, partnerKey, signature)) {
            console.warn(`[Shopee Webhook] ❌ Invalid signature for shop_id=${shopId} — rejecting`)
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

// ═══════════════════════════════════════════════════════════════════════════════
//  TIKTOK SHOP WEBHOOK (PUSH NOTIFICATION)
//  No auth required — TikTok sends POST to this endpoint
//  The Push Notification URL must be registered in TikTok Partner Center.
//  Event types (type field):
//    1  = ORDER_STATUS_CHANGE
//    2  = REVERSE_ORDER_STATUS_CHANGE (return/refund)
//    6  = PACKAGE_UPDATE
//    9  = PRODUCT_STATUS_CHANGE
// ═══════════════════════════════════════════════════════════════════════════════

// TikTok push signature: HMAC-SHA256(app_secret, path + timestamp + raw_body) hex.
// Sent in the `x-tts-sign` header. Very few public docs clarify the exact algorithm,
// so we accept both a strict verification and a lenient mode when no app_secret is
// available for the shop.
function verifyTikTokSignature(rawBody: Buffer, appSecret: string, signature: string): boolean {
    // TikTok signs the raw body with app_secret using HMAC-SHA256
    const expected = crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex')
    try {
        const a = Buffer.from(expected, 'hex')
        const b = Buffer.from(signature, 'hex')
        if (a.length !== b.length) return false
        return crypto.timingSafeEqual(a, b)
    } catch {
        return false
    }
}

router.post('/tiktok', async (req: Request, res: Response) => {
    // Always respond 200 immediately (TikTok retries on non-200)
    res.json({ success: true })

    try {
        const body = req.body
        const pushType = body.type
        const shopId = String(body.shop_id || '')
        const data = body.data || {}

        const rawBody: Buffer | undefined = (req as any).rawBody
        const signature = String(req.header('x-tts-sign') || '').trim()

        console.log(`[TikTok Webhook] type=${pushType} shop=${shopId} data=${JSON.stringify(data).substring(0, 300)}`)

        // Only process order-related push types (1 = order status change, 6 = package update)
        if (pushType !== 1 && pushType !== 6) {
            console.log(`[TikTok Webhook] Ignoring push type ${pushType}`)
            return
        }

        const orderId = data.order_id
        if (!orderId) {
            console.log(`[TikTok Webhook] No order_id in data`)
            return
        }

        // ── Find channel by shopId (cached schema lookup → fall back to scan) ──
        // TikTok's webhook `shop_id` matches the shop_cipher or shopId stored in our
        // onlineChannel record.
        let channel: any = null
        let storePrisma: any = null
        let resolvedSchema: string | null = null

        const cachedSchema = shopId ? await cacheGet<string>(tiktokSchemaCacheKey(shopId)) : null
        if (cachedSchema) {
            try {
                const prisma = getStorePrisma(cachedSchema)
                const found = await prisma.onlineChannel.findFirst({
                    where: { platform: 'tiktok', shopId },
                })
                if (found) {
                    channel = found
                    storePrisma = prisma
                    resolvedSchema = cachedSchema
                }
            } catch {
                // Cached schema went stale — fall through to scan.
            }
        }

        if (!channel) {
            const allStores = await registryPrisma.store.findMany({ where: { status: 'active' } })
            for (const store of allStores) {
                try {
                    const prisma = getStorePrisma(store.schema)
                    const found = await prisma.onlineChannel.findFirst({
                        where: { platform: 'tiktok', shopId },
                    })
                    if (found) {
                        channel = found
                        storePrisma = prisma
                        resolvedSchema = store.schema
                        break
                    }
                } catch {
                    continue
                }
            }
        }

        if (!channel || !storePrisma) {
            console.log(`[TikTok Webhook] No channel found for shop_id=${shopId}`)
            return
        }

        if (resolvedSchema && resolvedSchema !== cachedSchema) {
            await cacheSet(tiktokSchemaCacheKey(shopId), resolvedSchema, SHOP_SCHEMA_TTL)
        }

        // ── Verify HMAC signature ──
        const appSecret = channel.apiSecret || process.env.TIKTOK_APP_SECRET || ''
        if (!appSecret) {
            console.warn(`[TikTok Webhook] No app secret for shop_id=${shopId} — processing without signature check`)
        } else if (!signature) {
            console.warn(`[TikTok Webhook] Missing x-tts-sign header — processing without signature check`)
        } else if (!rawBody) {
            console.warn(`[TikTok Webhook] Raw body unavailable — processing without signature check`)
        } else if (!verifyTikTokSignature(rawBody, appSecret, signature)) {
            console.warn(`[TikTok Webhook] ❌ Invalid signature for shop_id=${shopId} — rejecting`)
            return
        }

        // ── Fetch full order detail from TikTok API ──
        const tiktok = new TikTokService({
            apiKey: channel.apiKey,
            apiSecret: channel.apiSecret,
            accessToken: channel.accessToken,
            refreshToken: channel.refreshToken,
            shopId: channel.shopId,
        })

        // Handle token refresh if needed
        let orderDetail = await tiktok.getOrderDetail(orderId)

        if (!orderDetail && channel.refreshToken) {
            try {
                const newTokens = await tiktok.refreshAccessToken()
                if (newTokens.accessToken) {
                    // Update channel credentials
                    await storePrisma.onlineChannel.update({
                        where: { id: channel.id },
                        data: {
                            accessToken: newTokens.accessToken,
                            refreshToken: newTokens.refreshToken || channel.refreshToken,
                            tokenExpiresAt: new Date(Date.now() + (newTokens.expiresIn || 86400) * 1000),
                        },
                    })
                    // Retry with new token
                    const refreshedTiktok = new TikTokService({
                        apiKey: channel.apiKey,
                        apiSecret: channel.apiSecret,
                        accessToken: newTokens.accessToken,
                        refreshToken: newTokens.refreshToken || channel.refreshToken,
                        shopId: channel.shopId,
                    })
                    orderDetail = await refreshedTiktok.getOrderDetail(orderId)
                }
            } catch (refreshErr: any) {
                console.error(`[TikTok Webhook] Token refresh failed: ${refreshErr.message}`)
            }
        }

        if (!orderDetail) {
            console.log(`[TikTok Webhook] Could not fetch order detail for ${orderId}`)
            return
        }

        // ── Upsert order in DB ──
        const existing = await storePrisma.onlineOrder.findFirst({
            where: { externalOrderId: String(orderId), channelId: channel.id },
        })

        if (existing) {
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
            console.log(`[TikTok Webhook] ✅ Updated ${orderId} → status=${orderDetail.status} tracking=${orderDetail.trackingNumber || 'none'}`)

            // Auto-convert eligible orders to transactions
            try {
                await convertOnlineOrderToTransaction(storePrisma, existing.id)
            } catch (convErr: any) {
                console.warn(`[TikTok Webhook] Order conversion failed for ${orderId}: ${convErr.message}`)
            }
        } else {
            const newOrder = await storePrisma.onlineOrder.create({
                data: {
                    orderNumber: orderDetail.orderNumber,
                    channelId: channel.id,
                    channelName: channel.name,
                    platform: 'tiktok',
                    externalOrderId: String(orderId),
                    externalStatus: orderDetail.externalStatus,
                    customerName: orderDetail.customerName,
                    customerPhone: orderDetail.customerPhone || null,
                    customerEmail: null,
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
            console.log(`[TikTok Webhook] ✅ Created new order ${orderId} → ${orderDetail.status}`)

            // Auto-convert if eligible
            try {
                await convertOnlineOrderToTransaction(storePrisma, newOrder.id)
            } catch (convErr: any) {
                console.warn(`[TikTok Webhook] Order conversion failed for ${orderId}: ${convErr.message}`)
            }
        }

    } catch (err: any) {
        console.error('[TikTok Webhook] Error:', err.message)
    }
})

export default router
