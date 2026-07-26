import { registryPrisma, getStorePrisma } from '../lib/prisma'
import { getPlatformService, TikTokService, type PlatformOrder } from '../services/platforms'
import { processNewOrders } from '../services/orderSync'
import { syncChannelReturns } from '../services/returnSync'

const SYNC_INTERVAL    = 10 * 60 * 1000       // 10 phút
const CLEANUP_INTERVAL = 24 * 60 * 60 * 1000  // 24 tiếng
const CLEANUP_DAYS     = 18                    // Xóa đơn cũ hơn 18 ngày

let syncTimer:    NodeJS.Timeout | null = null
let cleanupTimer: NodeJS.Timeout | null = null

/**
 * Sync orders for a single channel
 */
async function syncChannel(storePrisma: any, channel: any): Promise<{ imported: number; updated: number; errors: string[] }> {
    const service = getPlatformService(channel.platform, {
        apiKey: channel.apiKey || '', apiSecret: channel.apiSecret || '',
        accessToken: channel.accessToken || undefined,
        refreshToken: channel.refreshToken || undefined,
        shopId: channel.shopId || undefined,
    })
    if (!service) return { imported: 0, updated: 0, errors: ['Platform not supported'] }

    // ── Auto-refresh token if expired or about to expire (5 min buffer) ──────
    // Without this the cron fails every 10 minutes once the token lapses, until
    // someone presses the manual sync button (which does refresh).
    if (channel.tokenExpiresAt && new Date(channel.tokenExpiresAt).getTime() < Date.now() + 5 * 60 * 1000) {
        try {
            const tokens = await service.refreshAccessToken();
            (service as any).credentials.accessToken = tokens.accessToken;
            (service as any).credentials.refreshToken = tokens.refreshToken;
            await storePrisma.onlineChannel.update({
                where: { id: channel.id },
                data: {
                    accessToken: tokens.accessToken,
                    refreshToken: tokens.refreshToken,
                    tokenExpiresAt: new Date(Date.now() + tokens.expiresIn * 1000),
                },
            })
            console.log(`[AutoSync] Token refreshed for ${channel.name}`)
        } catch (refreshErr: any) {
            console.error(`[AutoSync] Token refresh failed for ${channel.name}:`, refreshErr.message)
            // Continue anyway — the old token might still work briefly
        }
    }

    // ── TikTok: ensure we have the real shop_cipher (self-heal) ──────────────
    // Order endpoints require shop_cipher (NOT open_id). Older connections stored
    // open_id as shopId → TikTok rejects with 106011 "Invalid shop_cipher". The
    // manual /sync route already re-resolves this; the cron must do the same, or
    // it loops forever on the stale cipher. Re-resolve from
    // /authorization/202309/shops and persist if it changed.
    if (channel.platform === 'tiktok' && service instanceof TikTokService && (service as any).credentials.accessToken) {
        try {
            const shops = await service.getAuthorizedShops()
            const cipher = shops[0]?.cipher || shops[0]?.shop_cipher || undefined
            // Webhook payloads carry the numeric shop id — persist it so the webhook
            // handler can match the channel (shopId holds the cipher).
            const numericId = shops[0]?.id ? String(shops[0].id) : undefined
            const heal: any = {}
            if (cipher && cipher !== channel.shopId) {
                (service as any).credentials.shopId = cipher
                heal.shopId = cipher
            }
            if (numericId && numericId !== channel.platformShopId) heal.platformShopId = numericId
            if (Object.keys(heal).length) {
                await storePrisma.onlineChannel.update({ where: { id: channel.id }, data: heal })
                console.log(`[AutoSync] Resolved TikTok shop ids for ${channel.name}: ${JSON.stringify(Object.keys(heal))}`)
            }
        } catch (cipherErr: any) {
            console.error(`[AutoSync] Failed to resolve TikTok shop_cipher for ${channel.name}:`, cipherErr.message)
        }
    }

    // Gia số từ lastSyncAt (lùi 30' để không sót đơn ở biên). Kênh MỚI liên kết
    // (chưa có lastSyncAt) → cron TỰ kéo lịch sử từ syncFromDate người dùng chọn
    // lúc kết nối — không cần bấm sync tay nữa. Shopee chặn cửa sổ >15 ngày nên
    // chia khung 14 ngày (giống route /sync).
    const now = new Date()
    const syncFromDate = (channel as any).syncFromDate ? new Date((channel as any).syncFromDate) : null
    const since = channel.lastSyncAt
        ? new Date(new Date(channel.lastSyncAt).getTime() - 30 * 60_000)
        : (syncFromDate || new Date(Date.now() - 7 * 86400_000))

    const WINDOW_MS = 14 * 86400_000
    const windows: { from: Date; to: Date }[] = []
    if (channel.platform === 'shopee' && now.getTime() - since.getTime() > WINDOW_MS) {
        for (let t = since.getTime(); t < now.getTime(); t += WINDOW_MS) {
            windows.push({ from: new Date(t), to: new Date(Math.min(t + WINDOW_MS, now.getTime())) })
        }
    } else {
        windows.push({ from: since, to: now })
    }

    let allOrders: PlatformOrder[] = []
    // Kéo lịch sử lần đầu: theo NGÀY ĐẶT (create_time) — update_time làm đơn rơi
    // lệch khung, backfill lỗ chỗ. Gia số: update_time để bắt cả đổi trạng thái.
    const isInitialPull = !channel.lastSyncAt
    const timeRangeField: 'create_time' | 'update_time' = isInitialPull ? 'create_time' : 'update_time'
    const PAGE_CAP = isInitialPull ? 80 : 20
    const MAX_ORDERS = isInitialPull ? 20000 : 5000
    for (const win of windows) {
        let page = 1
        let hasMore = true
        // TikTok v202309 paginates by opaque page_token cursor, not numeric page; thread
        // both so each platform reads what it needs (otherwise TikTok re-fetches page 1).
        let pageToken: string | undefined = undefined
        while (hasMore && page <= PAGE_CAP && allOrders.length < MAX_ORDERS) {
            const result: { orders: PlatformOrder[]; hasMore: boolean; total: number; nextPageToken?: string } =
                await service.fetchOrders({ since: win.from, until: win.to, page, pageSize: 50, pageToken, timeRangeField })
            allOrders = allOrders.concat(result.orders)
            pageToken = result.nextPageToken
            hasMore = result.hasMore
            page++
        }
        if (hasMore) {
            console.warn(`[AutoSync] ${channel.name}: CHẠM TRẦN khung ${win.from.toISOString().slice(0, 10)}→${win.to.toISOString().slice(0, 10)} — có thể thiếu đơn`)
        }
    }

    let imported = 0, updated = 0
    const errors: string[] = []

    for (const order of allOrders) {
        try {
            const existing = await storePrisma.onlineOrder.findFirst({
                where: { externalOrderId: order.externalOrderId, channelId: channel.id },
            })
            if (existing) {
                await storePrisma.onlineOrder.update({
                    where: { id: existing.id },
                    data: {
                        status: order.status,
                        externalStatus: order.externalStatus,
                        paymentStatus: order.paymentStatus,
                        trackingNumber: order.trackingNumber || existing.trackingNumber,
                        shippingCarrier: order.shippingCarrier || existing.shippingCarrier,
                        shippedAt: order.shippedAt ? new Date(order.shippedAt) : existing.shippedAt,
                        deliveredAt: order.deliveredAt ? new Date(order.deliveredAt) : existing.deliveredAt,
                        paidAt: order.paidAt ? new Date(order.paidAt) : existing.paidAt,
                        syncedAt: new Date(),
                    },
                })
                updated++
            } else {
                await storePrisma.onlineOrder.create({
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
    const orderStats = await storePrisma.onlineOrder.aggregate({
        where: { channelId: channel.id },
        _count: true,
        _sum: { total: true },
    })
    await storePrisma.onlineChannel.update({
        where: { id: channel.id },
        data: {
            lastSyncAt: new Date(),
            totalOrders: orderStats._count,
            totalRevenue: orderStats._sum.total || 0,
        },
    })

    // Log sync
    await storePrisma.syncLog.create({
        data: {
            channelId: channel.id,
            action: 'auto_sync',
            status: errors.length > 0 ? 'partial' : 'success',
            details: `Auto-sync: Imported ${imported}, Updated ${updated}, Errors ${errors.length}`,
            ordersCount: imported + updated,
        },
    })

    return { imported, updated, errors }
}

/**
 * Run auto-sync for all stores with connected channels
 */
async function runAutoSync() {
    try {
        // Chỉ store CÓ kênh online (cờ registry) — KHÔNG quét toàn bộ + mở client per-store
        // (đó là nguyên nhân cạn kết nối Cloud SQL). Cờ set khi kết nối kênh.
        const stores = await registryPrisma.store.findMany({ where: { status: 'active', hasOnlineChannels: true } as any }) as any[]
        let totalSynced = 0

        for (const store of stores) {
            try {
                const storePrisma = getStorePrisma(store.schema)

                // Find channels with access tokens (connected)
                const channels = await storePrisma.onlineChannel.findMany({
                    where: {
                        status: 'active',
                        accessToken: { not: null },
                    },
                })

                for (const channel of channels) {
                    try {
                        // Kênh mới liên kết (lastSyncAt null): syncChannel tự kéo lịch sử
                        // từ syncFromDate (chia khung 14 ngày cho Shopee) — người dùng
                        // chỉ cần chọn ngày lúc kết nối, cron lo phần còn lại.
                        const result = await syncChannel(storePrisma, channel)
                        if (result.imported > 0 || result.updated > 0) {
                            console.log(`[AutoSync] ${store.name}/${channel.name}: +${result.imported} new, ${result.updated} updated`)
                            totalSynced += result.imported + result.updated
                        }
                        // Convert eligible orders to transactions + inventory
                        const converted = await processNewOrders(storePrisma, channel.id)
                        if (converted > 0) {
                            console.log(`[AutoSync] ${store.name}/${channel.name}: ${converted} orders → transactions`)
                        }
                    } catch (err: any) {
                        console.error(`[AutoSync] Error syncing ${store.name}/${channel.name}:`, err.message)
                    }

                    // Đồng bộ TRẢ HÀNG/HOÀN TIỀN mỗi vòng cron (7 ngày gần nhất).
                    // Shopee KHÔNG có webhook trả hàng → trước đây chỉ cập nhật khi
                    // bấm tay nút trong modal kênh, nên tab Trả hàng đứng im.
                    // TikTok có webhook nhưng chạy thêm ở đây vô hại (idempotent).
                    // NẰM NGOÀI try của syncChannel: kênh lỗi kéo đơn (vd Shopee
                    // "Wrong sign") trước đây bị nhảy cóc luôn phần trả hàng.
                    if (['shopee', 'tiktok'].includes(channel.platform) && channel.accessToken) {
                        try {
                            // 30 NGÀY (không phải 7): Shopee lọc theo NGÀY TẠO phiếu trả,
                            // mà tiền hoàn thường về sau đó cả tuần–nửa tháng. Cửa sổ 7 ngày
                            // bỏ sót đúng lúc phiếu chuyển REFUND_PAID → đơn không bao giờ
                            // được đảo về returned/refunded. An toàn từ khi fetchReturns tự
                            // chia khung 14 ngày (Shopee chặn cửa sổ > 15 ngày).
                            // Đọc LẠI kênh: syncChannel có thể vừa refresh token và ghi DB,
                            // còn object `channel` trong bộ nhớ vẫn giữ token CŨ → trả hàng
                            // gọi bằng token hết hạn rồi refresh lần 2 bằng refresh_token đã
                            // tiêu thụ (hỏng luôn token vừa cấp).
                            const freshCh = await storePrisma.onlineChannel.findUnique({ where: { id: channel.id } }).catch(() => null)
                            const ret = await syncChannelReturns(storePrisma, freshCh || channel, new Date(Date.now() - 30 * 86400_000))
                            if (ret.synced > 0) {
                                console.log(`[AutoSync] ${store.name}/${channel.name}: 🔄 +${ret.synced} đơn trả hàng mới (tổng ${ret.total} phiếu từ sàn)`)
                            }
                        } catch (retErr: any) {
                            console.error(`[AutoSync] Returns sync ${store.name}/${channel.name}:`, retErr.message)
                        }
                    }
                }
            } catch (err: any) {
                // Store might not have onlineChannel table yet — skip silently
                if (!err.message?.includes('does not exist')) {
                    console.error(`[AutoSync] Error processing store ${store.name}:`, err.message)
                }
            }
        }

        if (totalSynced > 0) {
            console.log(`[AutoSync] Completed: ${totalSynced} orders synced across ${stores.length} stores`)
        }
    } catch (err: any) {
        console.error('[AutoSync] Fatal error:', err.message)
    }
}

// ═══════════════════════════════════════════════════════════
//  CLEANUP — Xóa đơn COMPLETED/CANCELLED cũ hơn 18 ngày
// ═══════════════════════════════════════════════════════════

async function runCleanup() {
    const cutoff = new Date(Date.now() - CLEANUP_DAYS * 86400_000)
    const cleanStatuses = ['COMPLETED', 'completed', 'CANCELLED', 'cancelled', 'TO_RETURN', 'returned']

    try {
        const stores = await registryPrisma.store.findMany({ where: { status: 'active', hasOnlineChannels: true } as any }) as any[]
        let totalDeleted = 0

        for (const store of stores) {
            try {
                const storePrisma = getStorePrisma(store.schema)

                // Lấy danh sách id đơn cũ cần xóa
                const oldOrders = await storePrisma.onlineOrder.findMany({
                    where: {
                        status:    { in: cleanStatuses },
                        updatedAt: { lt: cutoff },
                    },
                    select: { id: true, orderNumber: true },
                })

                if (oldOrders.length === 0) continue

                const ids = oldOrders.map((o: any) => o.id)

                // Xóa items trước (cascade nếu DB không tự xóa)
                await storePrisma.onlineOrderItem.deleteMany({
                    where: { onlineOrderId: { in: ids } },
                })

                // Xóa đơn hàng
                const result = await storePrisma.onlineOrder.deleteMany({
                    where: { id: { in: ids } },
                })

                totalDeleted += result.count
                console.log(`[Cleanup] ${store.name}: xóa ${result.count} đơn cũ (>${CLEANUP_DAYS} ngày): ${oldOrders.slice(0, 5).map((o: any) => o.orderNumber).join(', ')}${oldOrders.length > 5 ? '...' : ''}`)

                // Cập nhật lại stats kênh
                const channels = await storePrisma.onlineChannel.findMany({ select: { id: true } })
                for (const ch of channels) {
                    const agg = await storePrisma.onlineOrder.aggregate({
                        where: { channelId: ch.id },
                        _count: true,
                        _sum: { total: true },
                    })
                    await storePrisma.onlineChannel.update({
                        where: { id: ch.id },
                        data: { totalOrders: agg._count, totalRevenue: agg._sum.total || 0 },
                    }).catch(() => {})
                }
            } catch (err: any) {
                if (!err.message?.includes('does not exist')) {
                    console.error(`[Cleanup] Error on store ${store.name}:`, err.message)
                }
            }
        }

        if (totalDeleted > 0) {
            console.log(`[Cleanup] Hoàn thành: đã xóa ${totalDeleted} đơn cũ trên ${stores.length} cửa hàng`)
        }
    } catch (err: any) {
        console.error('[Cleanup] Fatal error:', err.message)
    }
}

/**
 * Start the auto-sync cron
 */
export function startAutoSync() {
    if (syncTimer) return
    console.log(`⏰ Auto-sync started (every ${SYNC_INTERVAL / 60000} minutes)`)

    // Run first sync after 30 seconds (let server warm up)
    setTimeout(() => {
        runAutoSync()
        syncTimer = setInterval(runAutoSync, SYNC_INTERVAL)
    }, 30_000)

    // Cleanup chạy lần đầu sau 5 phút (tránh xung đột lúc khởi động), sau đó mỗi 24h
    setTimeout(() => {
        runCleanup()
        cleanupTimer = setInterval(runCleanup, CLEANUP_INTERVAL)
    }, 5 * 60_000)

    console.log(`🧹 Auto-cleanup started (every 24h, orders >${CLEANUP_DAYS} days old)`)
}

/**
 * Stop the auto-sync cron
 */
export function stopAutoSync() {
    if (syncTimer) {
        clearInterval(syncTimer)
        syncTimer = null
        console.log('⏰ Auto-sync stopped')
    }
    if (cleanupTimer) {
        clearInterval(cleanupTimer)
        cleanupTimer = null
        console.log('🧹 Auto-cleanup stopped')
    }
}
