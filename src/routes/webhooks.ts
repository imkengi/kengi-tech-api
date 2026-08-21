import { Router, Request, Response } from 'express'
import crypto from 'crypto'
import registryPrisma, { getStorePrisma } from '../lib/prisma'
import { ShopeeService } from '../services/platforms/shopee'
import { TikTokService } from '../services/platforms/tiktok'
import { convertOnlineOrderToTransaction } from '../services/orderSync'
import { syncChannelReturns } from '../services/returnSync'
import { reverseOnlineOrderEffects, isReversalStatus } from '../services/onlineOrderReversal'
import { moTaLoi } from '../lib/gomLoi'
import { cacheGet, cacheSet, cacheDel } from '../lib/cache'
import { publishEvent } from '../lib/pubsub'
import { processComment } from '../services/fanpageAutoReply'

const router = Router()

// Cache shop_id → store schema for 1h. Avoids scanning every active store schema
// on every webhook delivery; invalidates naturally when channel credentials rotate.
const SHOP_SCHEMA_TTL = 3600
const shopSchemaCacheKey = (shopId: string) => `webhook:shopee:shop:${shopId}:schema`
const tiktokSchemaCacheKey = (shopId: string) => `webhook:tiktok:shop:${shopId}:schema`
const fbPageSchemaCacheKey = (pageId: string) => `webhook:facebook:page:${pageId}:schema`

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

        // Process order pushes (3, 4) + new chat message push (10)
        if (pushCode !== 3 && pushCode !== 4 && pushCode !== 10) {
            console.log(`[Shopee Webhook] Ignoring push code ${pushCode}`)
            return
        }

        const orderSn = data.ordersn || data.order_sn
        if (!orderSn && pushCode !== 10) {
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

        // ── Code 10: tin nhắn chat mới → đẩy realtime cho FE refresh khung chat ──
        // (FE đang poll chat; event này cho phép refresh tức thì khi có socket.)
        if (pushCode === 10) {
            let content: any = data.content || data
            if (typeof content === 'string') { try { content = JSON.parse(content) } catch { } }
            publishEvent(resolvedSchema || undefined, 'chat:new-platform-message', {
                platform: 'shopee',
                channelId: channel.id,
                channelName: channel.name,
                conversationId: String(content.conversation_id || ''),
                messageId: String(content.message_id || ''),
                fromUserName: content.from_user_name || content.from_user_id || '',
                messageType: content.message_type || 'text',
                text: content.content?.text || '',
            }).catch(() => { })
            console.log(`[Shopee Webhook] 💬 New chat message → published for channel ${channel.name}`)
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

            // Đơn chuyển sang hủy/hoàn chung cuộc → đảo hiệu ứng (hoàn kho + void
            // HĐ đã convert + đảo bút toán). Idempotent nên gọi lặp lại vô hại.
            if (isReversalStatus(orderDetail.status)) {
                try {
                    await reverseOnlineOrderEffects(storePrisma, existing)
                } catch (revErr: any) {
                    console.error(`[Shopee Webhook] Reversal failed for ${orderSn}:`, revErr.message)
                }
            }
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
function verifyTikTokSignature(rawBody: Buffer, appKey: string, appSecret: string, signature: string): boolean {
    const safeEq = (expected: string) => {
        try {
            const a = Buffer.from(expected, 'hex')
            const b = Buffer.from(signature, 'hex')
            return a.length === b.length && crypto.timingSafeEqual(a, b)
        } catch {
            return false
        }
    }
    // Known variants in the wild: HMAC(body) and HMAC(app_key + body)
    return safeEq(crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex'))
        || safeEq(crypto.createHmac('sha256', appSecret).update(appKey + rawBody.toString('utf8')).digest('hex'))
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

        // Push types we process: 1 = order status change, 2 = reverse order
        // (return/refund) status change, 4 = package update
        if (pushType !== 1 && pushType !== 2 && pushType !== 4) {
            console.log(`[TikTok Webhook] Ignoring push type ${pushType}`)
            return
        }

        const orderId = data.order_id
        if (pushType !== 2 && !orderId) {
            console.log(`[TikTok Webhook] No order_id in data`)
            return
        }

        // ── Find channel by shopId (cached schema lookup → fall back to scan) ──
        // TikTok's webhook `shop_id` matches the shop_cipher or shopId stored in our
        // onlineChannel record.
        let channel: any = null
        let storePrisma: any = null
        let resolvedSchema: string | null = null

        // TikTok webhooks carry the NUMERIC shop id, while channel.shopId stores the
        // shop_cipher (order APIs require the cipher) — so match on either shopId or
        // platformShopId (populated at connect + self-healed by sync/cron).
        const channelWhere = {
            platform: 'tiktok',
            OR: [{ shopId }, { platformShopId: shopId }],
        }

        const cachedSchema = shopId ? await cacheGet<string>(tiktokSchemaCacheKey(shopId)) : null
        if (cachedSchema) {
            try {
                const prisma = getStorePrisma(cachedSchema)
                const found = await prisma.onlineChannel.findFirst({ where: channelWhere })
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
                    const found = await prisma.onlineChannel.findFirst({ where: channelWhere })
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
        } else if (!verifyTikTokSignature(rawBody, channel.apiKey || '', appSecret, signature)) {
            // TikTok's exact signing base string is poorly documented (body-only vs
            // app_key+body variants exist in the wild). The handler re-fetches the
            // authoritative order from TikTok's API with our own credentials anyway,
            // so a signature mismatch can't inject data — log loudly but continue
            // rather than silently dropping real status updates.
            console.warn(`[TikTok Webhook] ⚠️ Signature mismatch for shop_id=${shopId} — processing anyway (order re-fetched from API)`)
        }

        // ── Type 2: return/refund status change → sync returns realtime ──
        // Webhook là kênh cập nhật chính cho trả hàng; nút sync tay chỉ là fallback.
        // Debounce 60s/kênh: một đợt event dồn dập chỉ chạy 1 lần quét (7 ngày).
        if (pushType === 2) {
            const debounceKey = `webhook:tiktok:returns:${channel.id}`
            if (await cacheGet(debounceKey)) {
                console.log(`[TikTok Webhook] Returns sync debounced for ${channel.name}`)
                return
            }
            await cacheSet(debounceKey, '1', 60)
            try {
                const r = await syncChannelReturns(storePrisma, channel, new Date(Date.now() - 7 * 86400_000))
                console.log(`[TikTok Webhook] 🔄 Returns synced for ${channel.name}: +${r.synced} new, ${r.skipped} existing, ${r.errors.length} errors`)
            } catch (retErr: any) {
                console.error(`[TikTok Webhook] Returns sync failed for ${channel.name}:`, retErr.message)
            }
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
                console.error(`[TikTok Webhook] Token refresh failed: ${moTaLoi(refreshErr)}`)
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

            // Đơn CANCELLED/hoàn → đảo hiệu ứng (hoàn kho + void HĐ + đảo bút toán)
            if (isReversalStatus(orderDetail.status)) {
                try {
                    await reverseOnlineOrderEffects(storePrisma, existing)
                } catch (revErr: any) {
                    console.error(`[TikTok Webhook] Reversal failed for ${orderId}:`, revErr.message)
                }
            }

            // Auto-convert eligible orders to transactions
            try {
                await convertOnlineOrderToTransaction(storePrisma, existing.id)
            } catch (convErr: any) {
                /* `${convErr.message}` RỖNG với lỗi Prisma (nội dung ở code/meta) — mà đây
                 * là đường cập nhật CHÍNH của TikTok, hỏng ở đây là đơn không vào sổ. */
                console.warn(`[TikTok Webhook] Order conversion failed for ${orderId}: ${moTaLoi(convErr)}`)
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
                /* `${convErr.message}` RỖNG với lỗi Prisma (nội dung ở code/meta) — mà đây
                 * là đường cập nhật CHÍNH của TikTok, hỏng ở đây là đơn không vào sổ. */
                console.warn(`[TikTok Webhook] Order conversion failed for ${orderId}: ${moTaLoi(convErr)}`)
            }
        }

    } catch (err: any) {
        console.error('[TikTok Webhook] Error:', err.message)
    }
})

// ═══════════════════════════════════════════════════════════════════════════════
//  FACEBOOK PAGE WEBHOOK (Fanpage Manager)
//  GET  = xác minh (hub.challenge) khi đăng ký callback URL trong FB App
//  POST = sự kiện `feed` (comment mới) → chạy engine auto-reply server-side
//  FB gửi numeric page id trong entry[].id → khớp FbPage.pageId (quét store).
// ═══════════════════════════════════════════════════════════════════════════════

// Cache MISS trong bộ nhớ (pageId → timestamp, TTL 10 phút): pageId lạ không có
// cache hit ở trên → mỗi request spam sẽ quét lại MỌI schema. Nhớ pageId không
// tìm thấy để các request sau trả về null ngay, khỏi quét.
const FB_PAGE_MISS_TTL_MS = 10 * 60 * 1000
const fbPageMissCache = new Map<string, number>()

// Tìm store schema + FbPage theo pageId (cache 1h → fallback quét).
async function resolveFbPage(pageId: string): Promise<{ storePrisma: any; page: any; schema: string } | null> {
    // MISS cache: pageId đã biết là không có → khỏi quét lại trong TTL
    const missedAt = fbPageMissCache.get(pageId)
    if (missedAt !== undefined) {
        if (Date.now() - missedAt < FB_PAGE_MISS_TTL_MS) return null
        fbPageMissCache.delete(pageId) // hết TTL → cho quét lại
    }

    const cached = await cacheGet<string>(fbPageSchemaCacheKey(pageId))
    if (cached) {
        try {
            const prisma = getStorePrisma(cached)
            const page = await prisma.fbPage.findUnique({ where: { pageId } })
            if (page) return { storePrisma: prisma, page, schema: cached }
        } catch { /* schema stale → quét lại */ }
    }
    const stores = await registryPrisma.store.findMany({ where: { status: 'active' } })
    for (const store of stores) {
        try {
            const prisma = getStorePrisma(store.schema)
            const page = await prisma.fbPage.findUnique({ where: { pageId } })
            if (page) {
                await cacheSet(fbPageSchemaCacheKey(pageId), store.schema, SHOP_SCHEMA_TTL)
                return { storePrisma: prisma, page, schema: store.schema }
            }
        } catch { continue }
    }
    // Không tìm thấy → ghi nhớ MISS. Dọn entry hết hạn khi Map phình (bị spam
    // pageId ngẫu nhiên) để không rò bộ nhớ.
    if (fbPageMissCache.size > 1000) {
        const now = Date.now()
        for (const [k, t] of fbPageMissCache) {
            if (now - t >= FB_PAGE_MISS_TTL_MS) fbPageMissCache.delete(k)
        }
    }
    fbPageMissCache.set(pageId, Date.now())
    return null
}

// Facebook webhook signature: header `X-Hub-Signature-256` = 'sha256=' +
// HMAC-SHA256(app_secret, raw_body) hex — mirror pattern verify của Shopee/TikTok
// ở trên (rawBody stash sẵn trong express.json verify hook, xem src/index.ts).
function verifyFacebookSignature(rawBody: Buffer, appSecret: string, header: string): boolean {
    const expected = 'sha256=' + crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex')
    try {
        const a = Buffer.from(expected)
        const b = Buffer.from(header)
        if (a.length !== b.length) return false
        return crypto.timingSafeEqual(a, b)
    } catch {
        return false
    }
}

// GET /api/webhooks/facebook — verification handshake
router.get('/facebook', (req: Request, res: Response) => {
    const mode = req.query['hub.mode']
    const token = req.query['hub.verify_token']
    const challenge = req.query['hub.challenge']
    const verifyToken = process.env.FB_WEBHOOK_VERIFY_TOKEN || ''
    if (mode === 'subscribe' && token === verifyToken && verifyToken) {
        return res.status(200).send(String(challenge))
    }
    return res.sendStatus(403)
})

// POST /api/webhooks/facebook — feed events
router.post('/facebook', async (req: Request, res: Response) => {
    // ── Verify chữ ký TRƯỚC KHI xử lý — khác Shopee/TikTok (re-fetch từ API),
    // body FB được dùng TRỰC TIẾP (processComment ghi DB + gọi Graph API) nên
    // thiếu secret hoặc sai chữ ký là từ chối thẳng, không có chế độ lenient.
    const fbAppSecret = process.env.FB_APP_SECRET || ''
    const fbSignature = String(req.header('x-hub-signature-256') || '').trim()
    const fbRawBody: Buffer | undefined = (req as any).rawBody
    if (!fbAppSecret || !fbSignature || !fbRawBody
        || !verifyFacebookSignature(fbRawBody, fbAppSecret, fbSignature)) {
        console.warn(`[FB Webhook] ❌ Từ chối: ${!fbAppSecret ? 'thiếu FB_APP_SECRET' : !fbSignature ? 'thiếu X-Hub-Signature-256' : 'chữ ký không hợp lệ'}`)
        res.sendStatus(403)
        return
    }

    // Trả 200 ngay (FB retry nếu non-200)
    res.sendStatus(200)

    try {
        const body = req.body
        if (body?.object !== 'page') return

        for (const entry of body.entry || []) {
            const pageId = String(entry.id)
            const commentChanges = (entry.changes || []).filter(
                (c: any) => c.field === 'feed' && c.value?.item === 'comment' && c.value?.verb === 'add',
            )
            if (!commentChanges.length) continue

            const resolved = await resolveFbPage(pageId)
            if (!resolved) {
                console.log(`[FB Webhook] Không tìm thấy page ${pageId} (chưa kết nối)`)
                continue
            }
            if (!resolved.page.autoReplyEnabled) continue

            for (const change of commentChanges) {
                const v = change.value
                try {
                    await processComment(resolved.storePrisma, resolved.page, {
                        commentId: String(v.comment_id),
                        postId: v.post_id ? String(v.post_id) : undefined,
                        message: String(v.message || ''),
                        fromId: v.from?.id ? String(v.from.id) : undefined,
                        fromName: v.from?.name,
                    })
                } catch (e: any) {
                    console.error(`[FB Webhook] auto-reply error page=${pageId}:`, e.message)
                }
            }
        }
    } catch (err: any) {
        console.error('[FB Webhook] Error:', err.message)
    }
})

export default router
