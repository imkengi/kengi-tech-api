import { registryPrisma, getStorePrisma } from '../lib/prisma'
import { chayNeuLanhDao } from '../lib/leaderLock'
import { ensureFlashSaleTable, shopeeServiceFromChannel } from '../routes/flashSales'

/**
 * FLASH SALE SCHEDULER — chạy ngầm mỗi 3 phút, đảm bảo TUẦN TỰ:
 * "hết flash sale này mới tới flash sale sau".
 *
 * Vì sao: Shopee giữ tồn campaign ngay khi add item → tạo trước cả loạt là kho
 * bị giam nhiều lần. Nên plan nằm ở hàng đợi local; mỗi tick:
 *   1. active hết giờ (endTime < now) → 'ended' (Shopee tự nhả tồn còn lại).
 *   2. Kênh KHÔNG còn active → lấy plan queued kế tiếp (position):
 *      - Lỡ khung giờ (startTime <= now+2') → 'skipped'.
 *      - Còn kịp → create_shop_flash_sale + get_model_list từng item (build
 *        models với giá KM = giá gốc * (1-%)) + add items + enable → 'active'.
 *      - Lỗi → attempts+1, quá 3 lần → 'failed' (thử plan sau ở tick kế).
 */

const TICK_MS = 3 * 60_000
const MAX_ATTEMPTS = 3
let timer: NodeJS.Timeout | null = null
let running = false

function roundPrice(v: number): number {
    // Giá VND — làm tròn xuống trăm đồng cho sạch số
    return Math.max(100, Math.floor(v / 100) * 100)
}

async function activatePlan(prisma: any, plan: any, channel: any): Promise<void> {
    const service = shopeeServiceFromChannel(channel)
    const pct = Number(plan.discountPercent) || 0
    const stockPer = Math.max(1, Number(plan.stockPerItem) || 1)
    const limit = Math.max(0, Number(plan.purchaseLimit) || 0)
    const items: any[] = Array.isArray(plan.items) ? plan.items : JSON.parse(plan.items || '[]')

    const flashSaleId = await service.flashSaleCreate(Number(plan.timeslotId))
    /* Hỏng ở bước SAU khi đã tạo trên Shopee (lấy model, thêm item, bật) ⇒ xoá đợt vừa tạo rồi mới báo lỗi (15/10/2026):
     * để lại thì Shopee giữ một đợt rỗng, lượt thử lại tạo thêm đợt rỗng nữa. */
    let failedItems: any[] = []
    let soItem = 0
    try {
        ;({ failedItems, soItem } = await napVaBat(service, flashSaleId, items, pct, stockPer, limit))
    } catch (e) {
        try { await service.flashSaleDelete(flashSaleId) } catch { /* đợt đã bật/đang chạy thì không xoá được */ }
        throw e
    }

    await prisma.$executeRawUnsafe(
        `UPDATE "FlashSalePlan"
         SET status='active', "shopeeFlashSaleId"=$1, "failedItems"=$2::jsonb, error=NULL, "updatedAt"=now()
         WHERE id=$3`,
        flashSaleId, JSON.stringify(failedItems), plan.id
    )
    console.log(`[FlashSale] Kích hoạt "${plan.title}" (${plan.id}) → Shopee #${flashSaleId}, ${soItem} item (${failedItems.length} bị từ chối)`)
}

/** Lấy model từng item, thêm item vào đợt, bật đợt. Ném lỗi để activatePlan xoá đợt rỗng. */
async function napVaBat(service: any, flashSaleId: number, items: any[], pct: number, stockPer: number, limit: number): Promise<{ failedItems: any[]; soItem: number }> {
    // Build payload từng item: cần model list để đặt giá/tồn theo model.
    const shopeeItems: any[] = []
    for (const it of items) {
        const itemId = Number(it.itemId)
        if (!itemId) continue
        // Giá KM: user điền giá cụ thể (promoPrice) thì ưu tiên; không thì tính
        // theo %. Giá phải < giá gốc model → kẹp trần ở 95% giá model.
        const override = Number(it.promoPrice) || 0
        const promoFor = (basePrice: number) => {
            const byPct = basePrice * (1 - pct / 100)
            const raw = override > 0 ? Math.min(override, basePrice * 0.95) : byPct
            return roundPrice(raw)
        }
        let models: { model_id: number; price: number; stock: number }[] = []
        try { models = await service.getModelList(itemId) } catch { /* item không phân loại */ }
        const entry: any = { item_id: itemId }
        if (limit > 0) entry.purchase_limit = limit
        if (models.length > 0) {
            entry.models = models
                .filter(m => m.stock > 0 && m.price > 0)
                .map(m => ({
                    model_id: m.model_id,
                    input_promo_price: promoFor(m.price),
                    stock: Math.min(m.stock, stockPer),
                }))
            if (entry.models.length === 0) continue // hết tồn mọi phân loại → bỏ item
        } else {
            const base = Number(it.price) || 0
            if (base <= 0) continue
            entry.models = [{
                model_id: 0,
                input_promo_price: promoFor(base),
                stock: stockPer,
            }]
        }
        shopeeItems.push(entry)
    }
    if (shopeeItems.length === 0) throw new Error('Không có item hợp lệ (hết tồn hoặc thiếu giá)')

    const { failedItems } = await service.flashSaleAddItems(flashSaleId, shopeeItems)
    if (failedItems.length >= shopeeItems.length) {
        // Toàn bộ bị từ chối → activatePlan xoá sale rỗng cho sạch, báo lỗi
        throw new Error(`Shopee từ chối toàn bộ ${failedItems.length} item: ${JSON.stringify(failedItems).slice(0, 400)}`)
    }
    await service.flashSaleUpdateStatus(flashSaleId, 1) // enable
    return { failedItems, soItem: shopeeItems.length }
}

async function tickStore(schema: string): Promise<void> {
    const prisma = getStorePrisma(schema)
    await ensureFlashSaleTable(prisma)

    // 1. Đóng các plan active đã hết giờ
    await prisma.$executeRawUnsafe(
        `UPDATE "FlashSalePlan" SET status='ended', "updatedAt"=now()
         WHERE status='active' AND "endTime" < now()`)
    // 1b. Lượt kích hoạt bị đứt giữa chừng (máy tắt, mất kết nối) ⇒ trả về hàng đợi để thử lại
    await prisma.$executeRawUnsafe(
        `UPDATE "FlashSalePlan" SET status='queued', attempts=attempts+1, error='Lượt kích hoạt trước bị đứt giữa chừng — thử lại', "updatedAt"=now()
         WHERE status='dang_kich_hoat' AND "updatedAt" < now() - interval '10 minutes'`)

    // 2. Từng kênh: chưa có active → promote plan kế tiếp
    const channels: any[] = await prisma.$queryRawUnsafe(
        `SELECT DISTINCT "channelId" FROM "FlashSalePlan" WHERE status IN ('queued','active','dang_kich_hoat')`)
    for (const { channelId } of channels) {
        const activeCnt: any[] = await prisma.$queryRawUnsafe(
            `SELECT COUNT(*)::int AS n FROM "FlashSalePlan" WHERE "channelId"=$1 AND status IN ('active','dang_kich_hoat')`, channelId)
        if ((activeCnt[0]?.n ?? 0) > 0) continue // tuần tự: đợi sale hiện tại kết thúc

        // Dọn plan lỡ khung giờ (không kịp đăng ký — cần đệm 2 phút)
        const skipped: any[] = await prisma.$queryRawUnsafe(
            `UPDATE "FlashSalePlan" SET status='skipped', error='Lỡ khung giờ — khung đã bắt đầu/quá sát giờ khi tới lượt', "updatedAt"=now()
             WHERE "channelId"=$1 AND status='queued' AND "startTime" <= now() + interval '2 minutes'
             RETURNING id, title, "startTime"`, channelId)
        if (skipped.length > 0) {
            console.warn(`[FlashSale] Bỏ ${skipped.length} plan lỡ khung giờ (kênh ${channelId}):`,
                skipped.map((s: any) => `${s.title} @${new Date(s.startTime).toISOString()}`).join('; '))
        }

        const nextRows: any[] = await prisma.$queryRawUnsafe(
            `SELECT * FROM "FlashSalePlan"
             WHERE "channelId"=$1 AND status='queued'
             ORDER BY position ASC, "startTime" ASC LIMIT 1`, channelId)
        const plan = nextRows[0]
        if (!plan) continue

        const channel = await prisma.onlineChannel.findUnique({ where: { id: channelId } })
        if (!channel?.accessToken) continue
        /* GIÀNH plan trên dòng CSDL (15/10/2026): khoá "một máy chạy" (chayNeuLanhDao) dựa Redis mà prod KHÔNG có Redis
         * ⇒ hai bản Cloud Run cùng tick có thể cùng đẩy một plan ⇒ hai flash sale trên Shopee, giam tồn hai lần. Ai đổi
         * được queued → dang_kich_hoat thì người đó làm. */
        const gianh: any[] = await prisma.$queryRawUnsafe(
            `UPDATE "FlashSalePlan" SET status='dang_kich_hoat', "updatedAt"=now() WHERE id=$1 AND status='queued' RETURNING id`, plan.id)
        if (!gianh.length) continue
        try {
            await activatePlan(prisma, plan, channel)
        } catch (e: any) {
            const attempts = (Number(plan.attempts) || 0) + 1
            const failed = attempts >= MAX_ATTEMPTS
            await prisma.$executeRawUnsafe(
                `UPDATE "FlashSalePlan" SET attempts=$1, error=$2, status=$3, "updatedAt"=now() WHERE id=$4`,
                attempts, String(e?.message || e).slice(0, 500), failed ? 'failed' : 'queued', plan.id)
            console.error(`[FlashSale] Lỗi kích hoạt plan ${plan.id} (lần ${attempts}${failed ? ' — BỎ' : ''}):`, e?.message || e)
        }
    }
}

/** Gọi từ /api/cron/tick (mỗi 3 phút, 15/10/2026): Cloud Run bóp CPU khi không có request ⇒ setInterval đứng im ban đêm,
 *  plan khung 0h–2h tới lượt mà không ai đẩy ⇒ bị bỏ "lỡ khung giờ". Nhịp ngoài có CPU cả đêm. */
export async function nhipFlashSale(): Promise<string> {
    if (running) return 'dang-chay'
    await runScheduler()
    return 'xong'
}

async function runScheduler(): Promise<void> {
    if (running) return
    running = true
    try {
        const stores = await registryPrisma.store.findMany({
            where: { status: 'active', hasOnlineChannels: true } as any,
        }) as any[]
        for (const store of stores) {
            try {
                await tickStore(store.schema)
            } catch (e: any) {
                // Store chưa có bảng onlineChannel... — bỏ qua im lặng như AutoSync
                if (!String(e?.message || '').includes('does not exist')) {
                    console.error(`[FlashSale] Lỗi store ${store.name}:`, e?.message || e)
                }
            }
        }
    } catch (e: any) {
        console.error('[FlashSale] Fatal:', e?.message || e)
    } finally {
        running = false
    }
}

export function startFlashSaleScheduler(): void {
    if (timer) return
    console.log(`⚡ Flash sale scheduler started (every ${TICK_MS / 60000} minutes)`)
    // Lệch pha 90s so với AutoSync khởi động để tránh dồn pool connection lúc boot
    // Chỉ MỘT bản Cloud Run chạy mỗi nhịp (khoá Redis) — trước đây 2–3 bản cùng
    // quét flash sale của mọi cửa hàng online, đốt kết nối DB vô ích (19/08/2026)
    const chay = () => chayNeuLanhDao('flash-sale', TICK_MS - 15_000, runScheduler)
    setTimeout(() => {
        chay()
        timer = setInterval(chay, TICK_MS)
    }, 90_000)
}

export function stopFlashSaleScheduler(): void {
    if (timer) { clearInterval(timer); timer = null }
}
