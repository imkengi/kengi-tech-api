import { registryPrisma, getStorePrisma, giuClient } from '../lib/prisma'
import { runSync } from '../services/kiotvietRunner'
import { errMsg } from '../lib/errorResponse'

/**
 * CRON ĐÊM KIOTVIET — 00:00 VN (28/08/2026, chủ shop: "làm cron 12h đêm đồng bộ
 * mấy cái không có webhook, như phiếu nhập hàng, phiếu trả á").
 *
 * Vì sao cần: webhook KiotViet KHÔNG có loại cho phiếu nhập (purchaseOrder) và
 * phiếu trả — giữa hai lần bấm đồng bộ tay, chứng từ kho lệch dần. Webhook lại
 * còn TỰ TẮT sau nhiều lần giao hỏng (đã cắn HUTI 36 giờ), nên lượt quét đêm
 * cũng là lưới an toàn cho cả tồn kho.
 *
 * Phạm vi mỗi đêm (theo đúng thứ tự phụ thuộc của SYNC_ENTITIES):
 *   categories → products → suppliers → returns → purchaseOrders
 * - products chạy trước để pha phiếu nhập TÁCH NHÃN thẻ kho được (xem
 *   ganTheKhoPhieuNhap) và tự chữa trôi tồn nếu webhook stock chết.
 * - KHÔNG đụng invoices/cashflow: hoá đơn đã có webhook riêng, còn sổ quỹ đụng
 *   tiền — muốn lên lịch phải là quyết định riêng của chủ shop.
 * - Chứng từ quét cửa sổ 3 ngày (bù đêm hỏng vẫn không sót); danh mục thì bộ
 *   chạy LUÔN lấy trọn bộ, không dính fromDate (quy ước data-sync-gate).
 *
 * Idempotent: saveMap chống trùng theo id KiotViet — chạy lại chỉ cập nhật.
 * Nhịp tim + watchdog dùng chung KiotVietSyncLog với lượt bấm tay (mode 'cron').
 */

const RUN_HOUR_UTC = 17    // 00:00 VN
const RUN_MINUTE = 0
const LOOKBACK_DAYS = 3
const ENTITIES = ['categories', 'products', 'suppliers', 'returns', 'purchaseOrders']
const STALE_MS = 2 * 60_000

let timer: NodeJS.Timeout | null = null
let lastRunDate = ''
let running = false

async function runForStore(schema: string, storeName: string): Promise<void> {
    const sp: any = getStorePrisma(schema)
    const cfg = await sp.kiotVietConfig.findUnique({ where: { id: 'default' } }).catch(() => null)
    if (!cfg || !cfg.enabled || !cfg.clientId || !cfg.clientSecret || !cfg.retailer) return

    // Không chạy chồng lên đợt khác (tay HAY cron) — hai đợt song song đua nhau
    // tạo cùng bản ghi. Đợt cũ mất nhịp tim > 2 phút thì tự đóng rồi chạy tiếp.
    const dangChay = await sp.kiotVietSyncLog.findFirst({
        where: { status: 'running' },
        orderBy: { startedAt: 'desc' },
        select: { id: true, heartbeatAt: true, startedAt: true },
    }).catch(() => null)
    if (dangChay) {
        const lastBeat = dangChay.heartbeatAt || dangChay.startedAt
        if (Date.now() - new Date(lastBeat).getTime() > STALE_MS) {
            await sp.kiotVietSyncLog.update({
                where: { id: dangChay.id },
                data: { status: 'failed', finishedAt: new Date(), errors: 'Mất tín hiệu quá 2 phút — cron đêm tự đóng để chạy tiếp.' },
            }).catch(() => { })
        } else {
            console.log(`[KVNightly] ${storeName}: đang có đợt khác còn sống — bỏ qua đêm nay`)
            return
        }
    }

    const fromDate = new Date(Date.now() - LOOKBACK_DAYS * 86400_000)
    const log = await sp.kiotVietSyncLog.create({
        data: {
            entity: ENTITIES.join(','), mode: 'cron', dryRun: false,
            fromDate, toDate: null, status: 'running', startedAt: new Date(),
        },
    })
    console.log(`[KVNightly] ${storeName}: bắt đầu ${ENTITIES.join(',')} (chứng từ từ ${fromDate.toISOString().slice(0, 10)})`)
    try {
        await runSync(sp, cfg, ENTITIES, fromDate, null, true, log.id)
        console.log(`[KVNightly] ${storeName}: xong — chi tiết ở lịch sử đồng bộ (log ${log.id})`)
    } catch (e: any) {
        await sp.kiotVietSyncLog.update({
            where: { id: log.id },
            data: { status: 'failed', errors: errMsg(e).slice(0, 2000), finishedAt: new Date() },
        }).catch(() => { })
        console.error(`[KVNightly] ${storeName}: hỏng —`, e?.message || e)
    }
}

async function runAll(): Promise<void> {
    if (running) return
    running = true
    try {
        const stores = await registryPrisma.store.findMany({
            where: { status: 'active' },
            select: { code: true, name: true, schema: true },
        }) as any[]
        // TUẦN TỰ từng store — PROD PRISMA_POOL_SIZE=1; giữ client suốt lượt vì
        // một đợt HUTI (3.6k sản phẩm) chạy vài phút, quá hạn thải nhàn rỗi.
        for (const st of stores) {
            const nha = giuClient(st.schema)
            try {
                await runForStore(st.schema, st.name || st.code)
            } catch (e: any) {
                console.error(`[KVNightly] Lỗi store ${st.code}:`, e?.message || e)
            } finally {
                nha()
            }
        }
    } catch (e: any) {
        /* Cùng bài học với cron hoá đơn 27/08: P1001 thoáng qua lúc nửa đêm không
         * được đốt cả đêm — trả cờ để tick 10' sau chạy bù (idempotent). */
        console.error('[KVNightly] Fatal:', e?.message || e)
        lastRunDate = ''
    } finally {
        running = false
    }
}

export function startKiotVietNightlyCron(): void {
    if (timer) return
    console.log(`🔄 KiotViet nightly cron started (daily ${RUN_HOUR_UTC}:${String(RUN_MINUTE).padStart(2, '0')} UTC = 00:00 VN)`)
    timer = setInterval(() => {
        const now = new Date()
        const today = now.toISOString().slice(0, 10)
        if (lastRunDate === today) return
        // "Từ 17:00 UTC trở đi trong ngày mà chưa chạy là chạy" — restart giữa
        // đêm hay lỗi thoáng qua đều tự chạy bù, không so cứng đúng khung giờ.
        const denGio = now.getUTCHours() > RUN_HOUR_UTC
            || (now.getUTCHours() === RUN_HOUR_UTC && now.getUTCMinutes() >= RUN_MINUTE)
        if (denGio) {
            lastRunDate = today
            void runAll()
        }
    }, 10 * 60_000)
}

export function stopKiotVietNightlyCron(): void {
    if (timer) { clearInterval(timer); timer = null }
}
