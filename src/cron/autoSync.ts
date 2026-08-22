import { registryPrisma, getStorePrisma, giuClient } from '../lib/prisma'
import { chayNeuLanhDao } from '../lib/leaderLock'
import { getPlatformService, TikTokService, type PlatformOrder } from '../services/platforms'
import { processNewOrders } from '../services/orderSync'
import { syncChannelReturns } from '../services/returnSync'
import { choXong } from '../lib/choXong'

/**
 * Diễn giải lỗi cho log. `err.message` rỗng là chuyện thường xuyên xảy ra: lỗi
 * ném ra không phải Error, hoặc là AggregateError/undici bọc nguyên nhân thật
 * trong `cause`. Khi đó dòng log chỉ còn "Error syncing X:" — không lần được gì,
 * đúng cảnh gặp lúc 07:34–07:38 ngày 01/08.
 */
function fmtErr(err: any): string {
    if (!err) return '(lỗi rỗng)'
    if (typeof err === 'string') return err
    const parts: string[] = []
    if (err.message) parts.push(String(err.message))
    if (err.name && !err.message) parts.push(String(err.name))
    if (err.code) parts.push(`code=${err.code}`)
    const cause = err.cause
    if (cause) parts.push(`cause=${cause.message || cause.code || cause.name || String(cause)}`)
    if (parts.length === 0) {
        try { return JSON.stringify(err).slice(0, 300) } catch { return String(err) }
    }
    return parts.join(' | ')
}

/**
 * DÃN 10' → 30' (19/08/2026). Đo 7 ngày: cron là thứ ăn kết nối DB, không phải
 * khách — nền 2 giờ sáng vẫn 36–41/50 kết nối. Webhook Shopee/TikTok đã nhận
 * đơn mới + đổi trạng thái theo thời gian thực; lượt quét này giờ là LƯỚI VÉT
 * (đơn lỡ webhook, Lazada chưa có webhook, làm mới token sắp hết hạn) — 30'
 * là đủ, quét 10' chỉ đốt kết nối.
 */
const SYNC_INTERVAL    = 30 * 60 * 1000       // 30 phút
const CLEANUP_INTERVAL = 24 * 60 * 60 * 1000  // 24 tiếng
const CLEANUP_DAYS     = 18                    // Xóa đơn cũ hơn 18 ngày

const FEE_INTERVAL      = 6 * 60 * 60 * 1000   // 6 tiếng
const FEE_BATCH         = 400                  // đơn mỗi vòng, mỗi kênh
const FEE_DEADLINE_MS   = 240_000              // tự dừng, vòng sau chạy tiếp

let syncTimer:    NodeJS.Timeout | null = null
let cleanupTimer: NodeJS.Timeout | null = null
let feeTimer:     NodeJS.Timeout | null = null

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
                        shipByDate: order.shipByDate ? new Date(order.shipByDate) : (existing as any).shipByDate,
                        // Chỉ NÂNG cờ hỏa tốc, không hạ: get_channel_list lỗi thì
                        // isInstant về false giả — đừng để lượt sync sau xóa cờ thật.
                        ...(order.isInstant ? { isInstant: true } : {}),
                        syncedAt: new Date(),
                    },
                })
                // SHOPEE: chi tiết đơn KHÔNG có ngày giao (đã kiểm chứng 31/07) →
                // đơn vừa chuyển sang đã giao/hoàn tất mà chưa có ngày nhận thì
                // hỏi VẬN ĐƠN đúng 1 lần. Hàng đợi xuất HĐ gom theo ngày này.
                if (channel.platform === 'shopee' && !existing.deliveredAt && !order.deliveredAt
                    && ['DELIVERED', 'COMPLETED', 'TO_CONFIRM_RECEIVE'].includes(String(order.status || '').toUpperCase())) {
                    try {
                        const dt = await (service as any).getDeliveredTime?.(order.externalOrderId)
                        if (dt) {
                            await storePrisma.onlineOrder.update({
                                where: { id: existing.id }, data: { deliveredAt: dt },
                            })
                        }
                    } catch { /* vận đơn lỗi/chưa có: để trống, lần sau vá tiếp */ }
                }
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
                        shipByDate: order.shipByDate ? new Date(order.shipByDate) : null,
                        isInstant: order.isInstant || false,
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

/* CHỐNG CHẠY CHỒNG.
 *
 * setInterval(runAutoSync, 10') không đợi lượt trước xong. Một lượt kéo lịch sử
 * (khung 14 ngày × 80 trang, trần 20.000 đơn) thừa sức vượt 10 phút, khi đó hai
 * lượt chạy song song trên cùng một kênh và cùng làm mới access token bằng MỘT
 * refresh_token — sàn thường cho dùng một lần, lượt thứ hai hỏng và có thể làm
 * chết kết nối kênh. Chưa kể hai lượt cùng chuyển đơn thành phiếu.
 *
 * VAN AN TOÀN: quá TRAN_TREO thì cho chạy lại, để một lượt treo (mạng chết
 * giữa chừng, promise không bao giờ resolve) không khoá đồng bộ vĩnh viễn —
 * đổi lỗi chồng lấn lấy lỗi đứng hẳn thì còn tệ hơn. */
let dangChayAutoSync: number | null = null
const TRAN_TREO = 60 * 60_000

/**
 * Run auto-sync for all stores with connected channels
 */
async function runAutoSync() {
    if (dangChayAutoSync !== null) {
        const troi = Date.now() - dangChayAutoSync
        if (troi < TRAN_TREO) {
            console.log(`[AutoSync] Lượt trước chạy ${Math.round(troi / 60_000)} phút chưa xong — bỏ lượt này`)
            return
        }
        console.warn(`[AutoSync] Lượt trước treo ${Math.round(troi / 60_000)} phút — chạy lại`)
    }
    dangChayAutoSync = Date.now()
    try {
        // Chỉ store CÓ kênh online (cờ registry) — KHÔNG quét toàn bộ + mở client per-store
        // (đó là nguyên nhân cạn kết nối Cloud SQL). Cờ set khi kết nối kênh.
        const stores = await registryPrisma.store.findMany({ where: { status: 'active', hasOnlineChannels: true } as any }) as any[]
        let totalSynced = 0

        for (const store of stores) {
            /* GIỮ client suốt lượt của cửa hàng này. Một lượt kéo lịch sử có thể
             * dài hàng chục phút mà không ai chạm getStorePrisma() lần nữa → bộ
             * thải nhàn rỗi coi là rỗi và $disconnect() ngay dưới chân — đó là
             * nguyên nhân container chập chờn 12 lần đêm 17→18/08 (xem giuClient). */
            const nhaClient = giuClient(store.schema)
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
                        // ĐƠN MỚI → thông báo + push app (GỘP 1 tin/kênh/vòng cron,
                        // không bắn từng đơn kẻo kéo lịch sử là dội bom hàng trăm tin).
                        if (result.imported > 0) {
                            const tieuDe = `🛒 ${result.imported} đơn hàng mới`
                            const noiDung = `${channel.name} (${String(channel.platform).toUpperCase()})`
                            await (storePrisma as any).notification.create({
                                data: { type: 'new_order', title: tieuDe, message: noiDung },
                            }).catch(() => { })
                            try {
                                const { sendNotification, sendPushToStore } = await import('../routes/notifications')
                                sendNotification(store.schema, 'new_order', { title: tieuDe, message: noiDung })
                                sendPushToStore(storePrisma, tieuDe, noiDung).catch(() => { })
                            } catch { }
                        }
                        // Convert eligible orders to transactions + inventory
                        const converted = await processNewOrders(storePrisma, channel.id)
                        if (converted > 0) {
                            console.log(`[AutoSync] ${store.name}/${channel.name}: ${converted} orders → transactions`)
                        }
                    } catch (err: any) {
                        // err.message rỗng thì dòng log thành "Error syncing X:" cụt lủn,
                        // không lần được gì. Rơi về name/code/chuỗi hoá + nguyên nhân gốc
                        // (undici gói lỗi mạng thật vào `cause`).
                        console.error(`[AutoSync] Error syncing ${store.name}/${channel.name}:`, fmtErr(err))
                    }

                    // ── VÁ DẦN NGÀY NHẬN HÀNG (Shopee) ──────────────────────
                    // Shopee không trả ngày giao trong chi tiết đơn → phải hỏi VẬN
                    // ĐƠN từng đơn. Vá một mạch bị chặn tốc độ ("fetch failed" sau
                    // ~1.000 lượt, 31/07) nên rải mỗi vòng cron một ít: 30 đơn/kênh
                    // × 6 vòng/giờ ≈ 540 đơn/giờ, dọn hết tồn trong ~1 ngày mà không
                    // dội sàn. Hàng đợi xuất HĐ gom theo ngày này nên sai ngày =
                    // xuất hoá đơn sai kỳ thuế.
                    if (channel.platform === 'shopee' && channel.accessToken) {
                        try {
                            const canVa: any[] = await storePrisma.$queryRawUnsafe(
                                `SELECT id, "externalOrderId" FROM "OnlineOrder"
                                 WHERE "channelId" = $1 AND "deliveredAt" IS NULL
                                   AND UPPER(status) IN ('DELIVERED','COMPLETED','TO_CONFIRM_RECEIVE')
                                 ORDER BY "createdAt" DESC LIMIT 30`, channel.id)
                            if (canVa.length) {
                                const svc = getPlatformService('shopee', {
                                    apiKey: channel.apiKey || '', apiSecret: channel.apiSecret || '',
                                    accessToken: channel.accessToken || undefined,
                                    refreshToken: channel.refreshToken || undefined,
                                    shopId: channel.shopId || undefined,
                                })
                                let va = 0, loi = 0
                                for (const o of canVa) {
                                    try {
                                        const dt = await (svc as any).getDeliveredTime?.(String(o.externalOrderId || ''))
                                        if (dt) {
                                            await storePrisma.onlineOrder.update({ where: { id: o.id }, data: { deliveredAt: dt } })
                                            va++
                                        }
                                    } catch { 
                                        loi++
                                        // Lỗi mạng dồn = đang bị chặn tốc độ → NGHỈ ngay,
                                        // vòng cron sau chạy tiếp (đừng cố đấm).
                                        if (loi >= 3) break
                                    }
                                    await new Promise(r => setTimeout(r, 200))
                                }
                                if (va > 0) console.log(`[AutoSync] ${store.name}/${channel.name}: vá ngày nhận cho ${va} đơn`)
                            }
                        } catch { /* bỏ qua, vòng sau vá tiếp */ }
                    }

                    // ── VÁ DẦN NGÀY NHẬN HÀNG (LAZADA) ──────────────────────
                    // ĐO 22/08/2026: trường trạng thái của Lazada VN ĐÓNG BĂNG ở
                    // 'confirmed'. Không phải "chưa cập nhật" — hai đơn J&T đã giao
                    // xong gần một tháng (LZD-530782326931035, LZD-527325447880594)
                    // vẫn trả status='confirmed' ở CẢ cấp đơn LẪN cấp dòng hàng,
                    // delivered_at rỗng. Toàn shop 44/52 đơn mang nhãn đó, có đơn từ
                    // tháng 3. Tài liệu chính chủ còn để "statuses": [] trong ví dụ,
                    // và 'confirmed' KHÔNG nằm trong bảng trạng thái Lazada công bố.
                    //
                    // ⇒ VẬN ĐƠN là nguồn DUY NHẤT còn tiến triển. Mà trước nay chỉ
                    // lượt đồng bộ TAY mới tra nó — cron này chỉ tra cho Shopee. Nên
                    // không ai bấm là đơn nằm lì ở tab "Chờ xử lý" vĩnh viễn, kể cả
                    // khi khách đã nhận hàng. Đúng 5 đơn 01–10/08 kẹt theo đường này.
                    //
                    // Rải 30 đơn/kênh mỗi vòng như Shopee, ưu tiên đơn LÂU NHẤT CHƯA
                    // TRA. Đơn đã có ngày nhận thì loại hẳn — trước đây lượt tay xét
                    // cả 44 đơn xong rồi, đốt sạch hạn giờ 230s và TIMEOUT trước khi
                    // tới 5 đơn thật sự cần (thấy "Truncated response body" 07:31:30
                    // và 07:32:20 ngày 22/08).
                    if (channel.platform === 'lazada' && channel.accessToken) {
                        try {
                            const TRA_DUOC = ['confirmed', 'processing', 'shipping', 'packed', 'repacked',
                                'ready_to_ship', 'ready_to_ship_pending', 'toship', 'shipped']
                            const LO = 30
                            const dem: any[] = await storePrisma.$queryRawUnsafe(
                                `SELECT COUNT(*)::int AS n FROM "OnlineOrder"
                                 WHERE "channelId" = $1 AND "deliveredAt" IS NULL
                                   AND status = ANY($2) AND "externalOrderId" IS NOT NULL`,
                                channel.id, TRA_DUOC)
                            const tongCanTra = Number(dem?.[0]?.n) || 0
                            const canVaLz: any[] = tongCanTra === 0 ? [] : await storePrisma.$queryRawUnsafe(
                                `SELECT id, "externalOrderId", status FROM "OnlineOrder"
                                 WHERE "channelId" = $1 AND "deliveredAt" IS NULL
                                   AND status = ANY($2) AND "externalOrderId" IS NOT NULL
                                 ORDER BY "syncedAt" ASC NULLS FIRST, "createdAt" ASC
                                 LIMIT ${LO}`, channel.id, TRA_DUOC)
                            if (canVaLz.length) {
                                const svcLz = getPlatformService('lazada', {
                                    apiKey: channel.apiKey || '', apiSecret: channel.apiSecret || '',
                                    accessToken: channel.accessToken || undefined,
                                    refreshToken: channel.refreshToken || undefined,
                                    shopId: channel.shopId || undefined,
                                })
                                let va = 0, loi = 0, chuaGiao = 0
                                let loiDau = ''
                                for (const o of canVaLz) {
                                    const eid = String(o.externalOrderId || '').replace(/^LAZ-/i, '')
                                    if (!eid) continue
                                    try {
                                        const dt = await (svcLz as any).getDeliveredTime?.(eid)
                                        if (dt) {
                                            // CHỈ nâng status khi vận đơn có mốc giao thật.
                                            // externalStatus giữ nguyên nhãn sàn — để nhìn thấy
                                            // được là sàn vẫn đứng im, đừng che lại.
                                            await storePrisma.onlineOrder.update({
                                                where: { id: o.id },
                                                data: { status: 'delivered', deliveredAt: dt, syncedAt: new Date() },
                                            })
                                            va++
                                        } else {
                                            // Chưa có sự kiện 1400 → đơn CHƯA giao xong thật.
                                            // Vẫn đóng dấu syncedAt để vòng sau xoay sang đơn
                                            // khác, khỏi kẹt mãi vào cùng một nhúm.
                                            await storePrisma.onlineOrder.update({
                                                where: { id: o.id }, data: { syncedAt: new Date() },
                                            })
                                            chuaGiao++
                                        }
                                    } catch (e: any) {
                                        // Lỗi cấp KÊNH (token/IP whitelist) thì 29 đơn còn lại
                                        // hỏng y hệt — dừng ngay, đừng đốt hạn mức.
                                        const m = fmtErr(e)
                                        if (/từ chối kênh/i.test(m)) { loi++; loiDau = m; break }
                                        loi++
                                        if (!loiDau) loiDau = m
                                        if (loi >= 3) break
                                    }
                                    await new Promise(r => setTimeout(r, 200))
                                }
                                // KHÔNG im lặng khi còn tồn: nói rõ đã tra bao nhiêu trên tổng,
                                // kẻo đọc log tưởng đã quét hết (bệnh "đặt trần rồi báo cáo như
                                // thể không có trần").
                                const conLai = Math.max(0, tongCanTra - canVaLz.length)
                                console.log(`[AutoSync] ${store.name}/${channel.name}: vận đơn Lazada` +
                                    ` — tra ${canVaLz.length}/${tongCanTra} đơn, chốt đã giao ${va},` +
                                    ` chưa giao ${chuaGiao}, lỗi ${loi}${loiDau ? ` (${loiDau})` : ''}` +
                                    `${conLai > 0 ? ` — CÒN ${conLai} đơn để vòng sau` : ''}`)
                            }
                        } catch (e: any) {
                            console.error(`[AutoSync] ${store.name}/${channel.name}: vá vận đơn Lazada hỏng:`, fmtErr(e))
                        }
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
                    console.error(`[AutoSync] Error processing store ${store.name}:`, fmtErr(err))
                }
            } finally {
                nhaClient()
            }
        }

        if (totalSynced > 0) {
            console.log(`[AutoSync] Completed: ${totalSynced} orders synced across ${stores.length} stores`)
        }
    } catch (err: any) {
        console.error("[AutoSync] Fatal error:", fmtErr(err))
    } finally {
        dangChayAutoSync = null
    }
}

// ═══════════════════════════════════════════════════════════
//  CLEANUP — Xóa đơn COMPLETED/CANCELLED cũ hơn 18 ngày
// ═══════════════════════════════════════════════════════════

/**
 * ĐỐI SOÁT PHÍ SÀN tự động: lấy escrow THẬT của Shopee cho đơn CHƯA có phí.
 * Vì sao phải chạy định kỳ: Shopee quyết toán rải rác NHIỀU NGÀY sau khi đơn phát
 * sinh — đối soát một lần rồi thôi thì hôm sau lại có đơn thiếu phí. Trước đây
 * phải bấm tay từng kênh nên sổ luôn thiếu, và phần code cũ còn tự tính phí =
 * tổng × hoa hồng cấu hình (con số bịa, lệch ~4 lần so với phí thật).
 * 6 luồng song song — mức đã chạy ổn; đẩy cao hơn có nguy cơ bị chặn IP.
 */
async function runFeeSync() {
    const batDau = Date.now()
    try {
        const { ShopeeService, TikTokService: TTS } = await import('../services/platforms')
        const { mapWithConcurrency } = await import('../lib/prisma')
        const stores = await registryPrisma.store.findMany({
            where: { status: 'active' }, select: { code: true, schema: true },
        })
        let tongCapNhat = 0
        for (const store of stores) {
            if (Date.now() - batDau > FEE_DEADLINE_MS) break
            // Giữ client suốt lượt cửa hàng này — lý do xem giuClient() ở lib/prisma.ts.
            const nhaClient = giuClient(store.schema)
            try {
            const sp = getStorePrisma(store.schema) as any
            let channels: any[] = []
            try {
                // TRƯỚC ĐÂY lọc cứng platform:'shopee' → phí đơn TikTok KHÔNG BAO GIỜ
                // được lấy tự động, bật scope seller.finance.info cũng vô ích. Route
                // /sync-fees bấm tay thì có xử lý TikTok, còn cron thì không.
                channels = await sp.onlineChannel.findMany({
                    where: { platform: { in: ['shopee', 'tiktok'] }, status: 'active', accessToken: { not: null } },
                })
            } catch { continue }
            for (const ch of channels) {
                if (Date.now() - batDau > FEE_DEADLINE_MS) break
                const creds = {
                    apiKey: ch.apiKey || '', apiSecret: ch.apiSecret || '',
                    accessToken: ch.accessToken || undefined, refreshToken: ch.refreshToken || undefined,
                    shopId: ch.shopId || undefined,
                }
                const svc: any = ch.platform === 'tiktok' ? new TTS(creds) : new ShopeeService(creds)
                // Chỉ đơn 45 ngày gần nhất: đơn cũ hơn Shopee đã hết escrow, quét
                // lại chỉ tốn lượt gọi mà không bao giờ ra dữ liệu.
                const orders = await sp.onlineOrder.findMany({
                    where: {
                        channelId: ch.id, platformFee: 0,
                        status: { notIn: ['cancelled', 'CANCELLED', 'UNPAID'] },
                        externalOrderId: { not: null },
                        createdAt: { gte: new Date(Date.now() - 45 * 86400_000) },
                    },
                    select: { id: true, externalOrderId: true },
                    orderBy: { createdAt: 'desc' },
                    take: FEE_BATCH,
                }).catch(() => [])
                if (orders.length === 0) continue
                let ok = 0, loi = 0, chuaCo = 0
                let loiDauTien = ''
                await mapWithConcurrency(orders, async (o: any) => {
                    if (Date.now() - batDau > FEE_DEADLINE_MS) return
                    const sn = (o.externalOrderId || '').replace(/^(SPE-|TIK-|LAZ-)/i, '')
                    if (!sn) return
                    try {
                        let phi: number | null = null, thucNhan: number | null = null
                        if (ch.platform === 'tiktok') {
                            const s = await svc.getOrderSettlement(sn)
                            if (s && (s.feeAmount > 0 || s.settlementAmount > 0)) {
                                phi = s.feeAmount; thucNhan = s.settlementAmount
                            }
                        } else {
                            const e = await svc.getEscrowDetail(sn)
                            if (e && (e.escrowAmount > 0 || e.totalFees > 0)) {
                                phi = e.totalFees; thucNhan = e.escrowAmount
                            }
                        }
                        if (phi === null) { chuaCo++; return }
                        await sp.onlineOrder.update({
                            where: { id: o.id },
                            data: { platformFee: phi, netRevenue: thucNhan },
                        })
                        ok++
                    } catch (e: any) {
                        // `catch {}` trống trước đây giấu sạch lý do: sàn từ chối hay
                        // sai chữ ký đều im như nhau, chỉ thấy con số thấp mà không
                        // biết vì sao. Giữ lỗi ĐẦU TIÊN để báo một dòng, khỏi spam.
                        loi++
                        if (!loiDauTien) loiDauTien = fmtErr(e)
                    }
                    // API tài chính TikTok bóp rate gắt hơn Shopee escrow: 6 luồng
                    // bắn liền tay là dính 36009002 "Too many requests" gần cả mẻ
                    // (đo 04/08 08:11). Nghỉ ngắn giữa các call TikTok.
                    if (ch.platform === 'tiktok') await new Promise(r => setTimeout(r, 350))
                // TikTok chạy 2 luồng thay vì 6 — chậm hơn nhưng ăn được cả mẻ;
                // 36009002 trả về null → đơn được vòng sau quét lại, không mất.
                }, ch.platform === 'tiktok' ? 2 : 6)
                if (ok > 0 || loi > 0) {
                    tongCapNhat += ok
                    console.log(`[FeeSync] ${store.code}/${ch.name} (${ch.platform}): +${ok} đơn có phí thật` +
                        ` (quét ${orders.length}, sàn chưa có số: ${chuaCo}, lỗi: ${loi})` +
                        `${loiDauTien ? ` — lỗi đầu: ${loiDauTien}` : ''}`)
                }
            }
            } finally {
                nhaClient()
            }
        }
        if (tongCapNhat > 0) {
            console.log(`[FeeSync] Xong: ${tongCapNhat} đơn, ${Math.round((Date.now() - batDau) / 1000)}s`)
        }
    } catch (err: any) {
        console.error('[FeeSync] Lỗi:', err?.message || err)
    }
}

async function runCleanup() {
    const cutoff = new Date(Date.now() - CLEANUP_DAYS * 86400_000)
    const cleanStatuses = ['COMPLETED', 'completed', 'CANCELLED', 'cancelled', 'TO_RETURN', 'returned']

    try {
        const stores = await registryPrisma.store.findMany({ where: { status: 'active', hasOnlineChannels: true } as any }) as any[]
        let totalDeleted = 0

        for (const store of stores) {
            const nhaClient = giuClient(store.schema)   // lý do: xem giuClient() ở lib/prisma.ts
            try {
                const storePrisma = getStorePrisma(store.schema)

                // Lấy danh sách id đơn cũ ỨNG VIÊN xoá
                const oldOrders = await storePrisma.onlineOrder.findMany({
                    where: {
                        status:    { in: cleanStatuses },
                        updatedAt: { lt: cutoff },
                    },
                    select: { id: true, orderNumber: true, status: true },
                })

                if (oldOrders.length === 0) continue

                /* ⚠ ĐƠN ĐÃ BÁN MÀ CHƯA LÊN PHIẾU THÌ TUYỆT ĐỐI KHÔNG ĐƯỢC XOÁ.
                 *
                 * Bản trước xoá theo trạng thái + tuổi, không hề hỏi đơn đã vào
                 * sổ chưa. Hậu quả đo được 15/08/2026: KENGISTORE có 644 đơn
                 * COMPLETED chưa lên phiếu (353,7 triệu) vì listing sàn chưa nối
                 * — và cron này đang xoá dần chúng, 3 đơn chỉ trong buổi sáng
                 * (SPE-260728TTKAQS95, SPE-260728TMMN2U6G, SPE-260728TMHC6XGV).
                 * Mỗi đơn bị xoá là mất luôn dòng hàng và mọi khả năng thu hồi:
                 * doanh thu đó biến mất khỏi sổ VĨNH VIỄN, không dấu vết.
                 *
                 * Xoá chỉ an toàn khi đơn ĐÃ có phiếu bán (dữ liệu đã vào sổ,
                 * bảng OnlineOrder chỉ còn là bản sao) hoặc khi đơn HUỶ/TRẢ —
                 * loại này không bao giờ lên phiếu nên giữ lại vô nghĩa.
                 *
                 * Đơn không rơi vào hai nhóm trên thì GIỮ, kể cả đã rất cũ:
                 * đĩa rẻ hơn doanh thu mất trắng. */
                const { chonDonDuocXoa, maPhieuCuaDon, TRANG_THAI_DA_BAN } = await import('../lib/donDuocXoa')
                const canHoi = oldOrders.filter((o: any) =>
                    (TRANG_THAI_DA_BAN as readonly string[]).includes(String(o.status)))
                const daCoPhieu = new Set<string>()
                // Chạy theo lô để không nhét hàng nghìn phần tử vào một câu IN
                for (let i = 0; i < canHoi.length; i += 500) {
                    const lo = canHoi.slice(i, i + 500)
                    const co = await storePrisma.transaction.findMany({
                        where: { receiptNumber: { in: lo.map((o: any) => maPhieuCuaDon(o.orderNumber)) } },
                        select: { receiptNumber: true },
                    })
                    for (const t of co) daCoPhieu.add(String(t.receiptNumber))
                }
                const { duocXoa, giuLai } = chonDonDuocXoa(oldOrders as any, daCoPhieu)
                if (giuLai.length > 0) {
                    console.log(`[Cleanup] ${store.name}: GIỮ ${giuLai.length} đơn đã bán mà chưa lên phiếu (không xoá)`)
                }
                if (duocXoa.length === 0) continue

                const ids = duocXoa.map((o: any) => o.id)

                // Xóa items trước (cascade nếu DB không tự xóa)
                await storePrisma.onlineOrderItem.deleteMany({
                    where: { onlineOrderId: { in: ids } },
                })

                // Xóa đơn hàng
                const result = await storePrisma.onlineOrder.deleteMany({
                    where: { id: { in: ids } },
                })

                totalDeleted += result.count
                console.log(`[Cleanup] ${store.name}: xóa ${result.count} đơn cũ (>${CLEANUP_DAYS} ngày): ${duocXoa.slice(0, 5).map((o: any) => o.orderNumber).join(', ')}${duocXoa.length > 5 ? '...' : ''}`)

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
                    console.error(`[Cleanup] Error on store ${store.name}:`, fmtErr(err))
                }
            } finally {
                nhaClient()
            }
        }

        if (totalDeleted > 0) {
            console.log(`[Cleanup] Hoàn thành: đã xóa ${totalDeleted} đơn cũ trên ${stores.length} cửa hàng`)
        }
    } catch (err: any) {
        console.error("[Cleanup] Fatal error:", fmtErr(err))
    }
}

/**
 * Start the auto-sync cron
 */
export function startAutoSync() {
    if (syncTimer) return
    console.log(`⏰ Auto-sync started (every ${SYNC_INTERVAL / 60000} minutes)`)

    // Run first sync after 30 seconds (let server warm up)
    /* CHỈ MỘT BẢN CHẠY MỖI NHỊP (khoá Redis — xem lib/leaderLock.ts).
     * Cloud Run nhân 2–3 bản lúc đông, mỗi bản một bộ hẹn giờ riêng nên cùng một
     * lượt quét chạy 2–3 lần song song; mỗi lượt mở client tới đủ 9 cửa hàng mà
     * pool mỗi cửa hàng chỉ 1 kết nối. Đo 12–18/08/2026: đỉnh 51/50 kết nối.
     * KHÔNG có Redis thì hàm trả true (chạy như cũ) — hỏng thì MỞ, không chặn. */
    const chayLuot = () => chayNeuLanhDao('auto-sync', SYNC_INTERVAL - 30_000, runAutoSync)
    setTimeout(() => {
        chayLuot()
        syncTimer = setInterval(chayLuot, SYNC_INTERVAL)
    }, 30_000)

    // WATCHDOG KIOTVIET: mỗi 90 giây dò đợt đồng bộ mất nhịp tim rồi CHẠY TIẾP
    // phần còn dở. Cloud Run thay máy mỗi lần deploy nên việc chạy nền hay đứt
    // giữa chừng — không có cái này thì người dùng phải tự bấm lại (2026-08-06).
    // Đợi 45 giây cho máy khởi động xong rồi mới bắt đầu dò.
    // DÃN 90s → 5' và bọc khoá (19/08/2026): watchdog cũ mỗi 90 giây mở client
    // tới TẤT CẢ cửa hàng (kể cả không nối KiotViet), trên MỌI bản Cloud Run →
    // không cửa hàng nào rảnh đủ 10' để được thải kết nối. Đợt đồng bộ đứt
    // giữa chừng chờ tối đa 5' mới được nối lại — chấp nhận được, ai cần gấp
    // vẫn bấm đồng bộ tay.
    setTimeout(() => {
        const tick = () => chayNeuLanhDao('kiotviet-watchdog', 4 * 60_000, () =>
            import('../services/kiotvietRunner')
                .then(m => m.resumeStalledSyncs())
                .catch(e => console.error('[KiotViet watchdog]', e?.message || e)))
        tick()
        setInterval(tick, 5 * 60_000)
    }, 45_000)

    // Cleanup chạy lần đầu sau 5 phút (tránh xung đột lúc khởi động), sau đó mỗi 24h
    setTimeout(() => {
        // Dọn đơn cũ + dọn video đóng hàng quá 45 ngày chung nhịp 24h.
        // Video cleanup tự bọc lỗi từng store — không cho nó làm đổ cleanup đơn.
        const runAllCleanup = () => {
            runCleanup()
            /* ĐỐI CHIẾU NỢ KHÁCH VỚI KIOTVIET mỗi 24h — lưới an toàn cho lamTuoiNoKhach.
             * 18/08/2026: 39/593 khách HUTI kẹt debt=0 trong khi KV nói > 0 (857,7 triệu).
             * Chạy nền, tự bọc lỗi từng cửa hàng, không được làm đổ cleanup. */
            import('./doiChieuNoKiotViet')
                .then(m => m.runDoiChieuNoKiotViet())
                .catch(e => console.error('[DoiChieuNoKV] không chạy được:', e?.message || e))
            import('./driveVideoCleanup')
                .then(m => m.runDriveVideoCleanup())
                .catch(e => console.error('[VideoCleanup] không chạy được:', e?.message || e))
        }
        const chayDon = () => chayNeuLanhDao('auto-cleanup', 60 * 60_000, runAllCleanup)
        chayDon()
        cleanupTimer = setInterval(chayDon, CLEANUP_INTERVAL)
    }, 5 * 60_000)

    // Đối soát phí sàn: lần đầu sau 10 phút, sau đó mỗi 6 tiếng
    setTimeout(() => {
        const chayPhi = () => chayNeuLanhDao('fee-sync', 60 * 60_000, runFeeSync)
        chayPhi()
        feeTimer = setInterval(chayPhi, FEE_INTERVAL)
    }, 10 * 60_000)

    console.log(`🧹 Auto-cleanup started (every 24h, orders >${CLEANUP_DAYS} days old)`)
    console.log(`💰 Auto fee-sync started (every ${FEE_INTERVAL / 3600000}h, ${FEE_BATCH} orders/channel)`)
}

/**
 * Stop the auto-sync cron
 */
/**
 * Chờ lượt autoSync đang chạy kết thúc, TỐI ĐA `tranMs`. Dùng lúc tắt container.
 *
 * Vì sao (đo 02:01 UTC 18/08/2026): thứ tự tắt cũ là `disconnectAll()` TRƯỚC
 * `stopAutoSync()` — đóng engine DB trong khi vòng lặp chuyển đơn còn chạy →
 * 286 ms sau SIGTERM có 20 lỗi "Engine is not yet connected", 11 đơn chuyển
 * hỏng (tự lành lượt sau). Cloud Run chỉ cho ~10 s sau SIGTERM rồi kill cứng,
 * nên KHÔNG chờ vô hạn — quá trần thì cứ đóng, mất vài đơn còn hơn bị kill.
 */
export async function choAutoSyncXong(tranMs = 6_000): Promise<boolean> {
    // Logic chờ ở lib/choXong.ts (thuần, có bộ kiểm 3 nhánh); đây chỉ nối trạng thái thật vào.
    return choXong(() => dangChayAutoSync !== null, tranMs)
}

export function stopAutoSync() {
    if (syncTimer) {
        clearInterval(syncTimer)
        syncTimer = null
        console.log('⏰ Auto-sync stopped')
    }
    if (feeTimer) {
        clearInterval(feeTimer)
        feeTimer = null
    }
    if (cleanupTimer) {
        clearInterval(cleanupTimer)
        cleanupTimer = null
        console.log('🧹 Auto-cleanup stopped')
    }
}
