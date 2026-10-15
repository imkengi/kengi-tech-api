import { registryPrisma, getStorePrisma, giuClient } from '../lib/prisma'
import { moTaLoi } from '../lib/gomLoi'
import { gomThieuTonThue, moTaThieuTonThue } from '../lib/gomThieuTonThue'
import { layHoaDonKhachShopee } from '../lib/hoaDonKhachShopee'
import {
    ensureEInvoiceTablesFor, getActiveConfig, parseConfigExtra,
    findInvoiceQueue, issueInvoiceForTransaction,
} from '../routes/einvoice'

/**
 * HÀNG ĐỢI XUẤT HOÁ ĐƠN THEO NGÀY — yêu cầu cơ quan thuế: chỉ xuất hoá đơn khi
 * khách NHẬN HÀNG thành công.
 *
 * Mỗi tối 20h30 VN (13:30 UTC) chạy 1 lần: với từng store đã BẬT cờ
 * autoIssueOnDelivery (PUT /einvoice/queue/auto) và có cấu hình NCC hoá đơn:
 * gom các phiếu bán online mà đơn gốc đã giao xong trong 7 ngày gần nhất và
 * chưa có hoá đơn → xuất lần lượt qua NCC. Idempotent (đơn đã có HĐ bị bỏ qua),
 * lỗi hôm nay tự thử lại tối hôm sau.
 *
 * Đơn POS bán trực tiếp (khách nhận tại quầy) KHÔNG vào hàng đợi này — xuất
 * theo luồng thủ công/POS như cũ.
 */

const RUN_HOUR_UTC = 13   // 20h30 VN — sau giờ các sàn chốt trạng thái giao trong ngày
const RUN_MINUTE = 30
const LOOKBACK_DAYS = 7
const PER_STORE_CAP = 300

let timer: NodeJS.Timeout | null = null
let lastRunDate = ''       // YYYY-MM-DD UTC — chống chạy lặp trong ngày
let running = false

async function runQueueForStore(schema: string, storeName: string): Promise<void> {
    const prisma = getStorePrisma(schema)
    await ensureEInvoiceTablesFor(prisma, schema)

    const config = await getActiveConfig(prisma)
    if (!config) return
    const extra = parseConfigExtra(config)

    // HĐ đã xuất mà khách có khai HĐ công ty/hộ KD trên Shopee ⇒ điền sẵn + báo xuất thay thế (không tự xuất)
    try { await soatHoaDonDaXuat(prisma, storeName) } catch (e: any) { console.warn(`[EInvoiceQueue] ${storeName}: soát HĐ đã xuất hỏng —`, e?.message || e) }

    // Hai chế độ chạy song song:
    // 1) auto TOÀN CỤC (autoIssueOnDelivery): xuất mọi đơn giao xong từ mốc bật.
    // 2) đơn KHÁCH YÊU CẦU HĐ (vatBuyerInfo gắn trên phiếu): LUÔN tự xuất khi
    //    giao xong + gửi email — kể cả khi auto toàn cục tắt.
    const lookback = new Date(Date.now() - LOOKBACK_DAYS * 86400_000)
    const anchor = extra.autoIssueSince ? new Date(extra.autoIssueSince) : null
    // Mốc đủ điều kiện = ĐÚNG lúc bật nút, KHÔNG kẹp về 7 ngày. Bản cũ kẹp
    // `anchor > lookback ? anchor : lookback` rồi quét từ lookback → đơn giao
    // xong muộn (trạng thái sàn về trễ), đêm cron lỗi, hay chạm trần vài đêm
    // liền là rơi khỏi cửa sổ 7 ngày VĨNH VIỄN — sót hoá đơn với CQT.
    const autoFrom = extra.autoIssueOnDelivery && anchor ? anchor : null

    // Quét từ mốc bật nút để gom hết tồn đọng. findInvoiceQueue xếp ASC (cũ
    // trước) + trần 300/đêm nên tồn nhiều thì rút dần qua các đêm, không phình
    // một lượt chạy. Auto tắt thì giữ cửa sổ 7 ngày cho nhánh khách-yêu-cầu-HĐ.
    const sweepFrom = autoFrom && autoFrom < lookback ? autoFrom : lookback
    const all = await findInvoiceQueue(prisma, { from: sweepFrom, limit: PER_STORE_CAP })
    // Đơn có trả hàng/hoàn tiền KHÔNG auto-xuất — chỉ hiện trên UI để xử lý tay
    const clean = all.filter((r: any) => !r.hasReturn)
    const returns = all.length - clean.length
    if (returns > 0) console.log(`[EInvoiceQueue] ${storeName}: bỏ qua ${returns} đơn có trả hàng/hoàn tiền`)
    /* THÔNG TIN HĐ KHÁCH KHAI TRÊN SHOPEE (15/10/2026) — hỏi NGAY TRƯỚC khi xuất (Shopee không có push cho yêu cầu hoá đơn):
     * HĐ công ty/hộ KD có MST rõ ⇒ ghi lên phiếu ⇒ xuất đúng tên đơn vị/MST/email ngay lần đầu. Trước đây phải bấm "Lấy từ
     * Shopee" tay — quên là xuất thiếu MST, khách nhắn đòi, lại xuất thay thế (lib/hoaDonKhachShopee.ts). */
    const canHoi = clean.filter((r: any) => !r.hasBuyerInfo && /^ONLINE-SPE-/i.test(String(r.receiptNumber || '')))
    if (canHoi.length) {
        try {
            const kq = await layHoaDonKhachShopee(prisma, canHoi, { ghi: true })
            const da = new Set(kq.daGhiPhieu)
            for (const r of clean) if (da.has(r.id)) r.hasBuyerInfo = true
            console.log(`[EInvoiceQueue] ${storeName}: hỏi Shopee thông tin HĐ ${kq.daHoi} đơn → ${kq.coKhai} có khai, ` +
                `${kq.dungDuoc} HĐ công ty/hộ KD, ghi ${kq.daGhiPhieu.length} phiếu` +
                (kq.caNhanBiChe ? `, ${kq.caNhanBiChe} cá nhân bị Shopee che (bỏ)` : '') +
                (kq.loi.length ? ` | lỗi: ${kq.loi.slice(0, 2).join('; ')}` : ''))
        } catch (e: any) { console.warn(`[EInvoiceQueue] ${storeName}: hỏi thông tin HĐ Shopee hỏng —`, e?.message || e) }
    }
    const rows = clean.filter((r: any) => r.hasBuyerInfo
        || (autoFrom && new Date(r.deliveredAt || r.orderDate) >= autoFrom))
    if (rows.length === 0) return

    let issued = 0, failed = 0
    const errors: string[] = []
    /* Giữ TOÀN BỘ lỗi để gộp theo mã hàng. `errors` chỉ giữ 3 cái làm ví dụ, mà
     * ba ví dụ không cho biết rốt cuộc phải nhập chứng từ cho mã nào — đo tối
     * 16/08/2026: KENGISTORE hỏng 59/119 phiếu, chủ shop chỉ thấy 3 dòng. */
    const tatCaLoi: string[] = []
    for (const r of rows) {
        try {
            const rs = await issueInvoiceForTransaction(prisma, r.id, {}, schema, { thongBaoLe: false })
            if (rs.success && !rs.skipped) issued++
            else if (!rs.success) {
                failed++
                tatCaLoi.push(moTaLoi(rs.error))
                if (errors.length < 3) errors.push(`${r.receiptNumber}: ${rs.error}`)
            }
        } catch (e: any) {
            failed++
            tatCaLoi.push(moTaLoi(e))
            if (errors.length < 3) errors.push(`${r.receiptNumber}: ${moTaLoi(e)}`)
        }
        // Nhẹ tay với API NCC hoá đơn
        await new Promise((r2) => setTimeout(r2, 300))
    }
    /* Gộp theo MÃ HÀNG: 59 dòng lỗi rối rắm co về vài mã cần mua chứng từ đầu
     * vào — đó mới là việc chủ shop làm được. Ví dụ rời vẫn giữ để lần dấu. */
    const gomLai = gomThieuTonThue(tatCaLoi)
    const tomTat = moTaThieuTonThue(gomLai)
    /* Chỉ được BỎ ví dụ khi bản gộp thật sự nói ra được VIỆC PHẢI LÀM, tức có
     * danh sách mã. Bản gộp cũng trả chuỗi không rỗng khi chỉ có "N lỗi khác" —
     * lúc đó bỏ ví dụ đi là chủ shop mất sạch chi tiết, tệ hơn trước khi vá. */
    const gopDuDung = gomLai.theoSku.length > 0
    console.log(`[EInvoiceQueue] ${storeName}: ${rows.length} phiếu đủ điều kiện → xuất ${issued}, lỗi ${failed}` +
        (tomTat ? ` | ${tomTat}` : '') +
        (errors.length ? ` | vd: ${errors.join('; ')}` : ''))
    // Thông báo tổng kết đêm (web + app Android đọc chung GET /notifications)
    if (issued > 0 || failed > 0) {
        // MỘT tin + MỘT push cho cả đêm (06/10/2026) — thay cho push từng hoá đơn.
        const tin = await (prisma as any).notification.create({
            data: {
                type: 'einvoice',
                title: `🧾 Tự động xuất hoá đơn: ${issued} thành công${failed ? `, ${failed} lỗi` : ''}`,
                /* Ưu tiên bản gộp theo mã trong thông báo — nó nói ĐƯỢC VIỆC PHẢI LÀM,
                 * còn ba mã phiếu ví dụ thì chủ shop không tra ngược ra hàng hoá. */
                message: (`Cron 20:30 xử lý ${rows.length} phiếu đủ điều kiện.`
                    + (tomTat ? ` ${tomTat}` : '')
                    + (!gopDuDung && errors.length ? ` · Lỗi: ${errors.join('; ')}` : '')).slice(0, 500),
            },
        }).catch(() => null)
        if (tin) {
            const { sendPushToStore } = await import('../routes/notifications')
            sendPushToStore(prisma, tin.title, tin.message, { id: tin.id, type: 'einvoice' }).catch(() => { })
        }
    }
    if (rows.length >= PER_STORE_CAP) {
        console.warn(`[EInvoiceQueue] ${storeName}: chạm trần ${PER_STORE_CAP} phiếu/đêm — phần còn lại xuất đêm sau`)
    }
}

/* HĐ ĐÃ XUẤT (30 ngày) không MST mà khách có khai HĐ công ty/hộ KD trên Shopee — khai sau khi xuất, hoặc xuất trước khi có bước
 * tự lấy (đo 15/10: Kengi Tools đơn SPE-260922P2CABRFF) ⇒ ghi thông tin lên phiếu (nút "🔁 Xuất HĐ thay thế với thông tin này" ở
 * chi tiết đơn tự điền sẵn) + MỘT thông báo. KHÔNG tự xuất thay thế — HĐ thay thế là chứng từ với cơ quan thuế, chủ shop bấm. */
async function soatHoaDonDaXuat(prisma: any, storeName: string): Promise<void> {
    const ds: any[] = await prisma.$queryRawUnsafe(
        `SELECT DISTINCT t.id, t."receiptNumber" FROM "Transaction" t JOIN "EInvoice" e ON e."transactionId" = t.id
         WHERE t."receiptNumber" LIKE 'ONLINE-SPE-%' AND t."vatBuyerInfo" IS NULL
           AND e.status IN ('ISSUING','issued','SIGNED','SENT') AND coalesce(e."buyerTaxCode", '') = ''
           AND coalesce(e."issuedAt", e."createdAt") >= now() - interval '30 days'
         LIMIT 500`)
    if (!ds.length) return
    const kq = await layHoaDonKhachShopee(prisma, ds, { ghi: true })
    console.log(`[EInvoiceQueue] ${storeName}: soát ${kq.daHoi} HĐ đã xuất không MST → ${kq.dungDuoc} khách có khai HĐ công ty/hộ KD, ` +
        `điền sẵn ${kq.daGhiDon.length}` + (kq.loi.length ? ` | lỗi: ${kq.loi.slice(0, 2).join('; ')}` : ''))
    if (!kq.daGhiDon.length) return
    const tin = await prisma.notification.create({
        data: {
            type: 'einvoice',
            title: `🧾 ${kq.daGhiDon.length} đơn Shopee khách yêu cầu HĐ công ty — cần xuất HĐ thay thế`,
            message: (`Hoá đơn đã xuất KHÔNG có MST trong khi khách khai HĐ công ty/hộ kinh doanh trên Shopee. Thông tin đã điền sẵn — ` +
                `mở chi tiết đơn, bấm "Xuất HĐ thay thế với thông tin này": ${kq.daGhiDon.slice(0, 10).join(', ')}` +
                `${kq.daGhiDon.length > 10 ? ` …(+${kq.daGhiDon.length - 10})` : ''}`).slice(0, 500),
        },
    }).catch(() => null)
    if (tin) {
        const { sendPushToStore } = await import('../routes/notifications')
        sendPushToStore(prisma, tin.title, tin.message, { id: tin.id, type: 'einvoice' }).catch(() => { })
    }
}

async function runQueue(): Promise<void> {
    if (running) return
    running = true
    try {
        const stores = await registryPrisma.store.findMany({
            where: { status: 'active', hasOnlineChannels: true } as any,
        }) as any[]
        for (const store of stores) {
            // Giữ client suốt lượt (119 phiếu × 300ms + gọi VNPT có thể vượt 10 phút) — xem giuClient().
            const nhaClient = giuClient(store.schema)
            try {
                await runQueueForStore(store.schema, store.name)
            } catch (e: any) {
                if (!String(e?.message || '').includes('does not exist')) {
                    console.error(`[EInvoiceQueue] Lỗi store ${store.name}:`, e?.message || e)
                }
            } finally {
                nhaClient()
            }
        }
    } catch (e: any) {
        /* 27/08/2026 20:39: P1001 (khong voi toi Cloud SQL — gio nay nhieu cron
         * don cung luc) lam findMany nem loi → ca dem khong xuat mot hoa don nao,
         * vi lastRunDate da bi danh dau TRUOC khi chay. Tra lai co de tick 10'
         * sau THU LAI — issueInvoiceForTransaction idempotent nen chay bu an toan. */
        console.error('[EInvoiceQueue] Fatal:', e?.message || e)
        lastRunDate = ''
    } finally {
        running = false
    }
}

export function startEInvoiceQueueCron(): void {
    if (timer) return
    console.log(`🧾 E-invoice queue cron started (daily ${RUN_HOUR_UTC}:${RUN_MINUTE} UTC = 20:30 VN)`)
    // Tick 10 phút: tới giờ + chưa chạy hôm nay → chạy. Instance restart giữa
    // ngày không sao — issueInvoiceForTransaction idempotent.
    timer = setInterval(() => {
        const now = new Date()
        const today = now.toISOString().slice(0, 10)
        if (lastRunDate === today) return
        /* "Tu 13:30 UTC tro di trong ngay" chu khong phai "dung khung 13:3x":
         * truoc day so sanh === gio nen Fatal luc 13:39 la het cua thu lai (tick
         * sau roi sang 14h). Gio moi tick 10' con chua-chay-hom-nay deu chay bu
         * duoc — ke ca instance restart giua toi. */
        const denGio = now.getUTCHours() > RUN_HOUR_UTC
            || (now.getUTCHours() === RUN_HOUR_UTC && now.getUTCMinutes() >= RUN_MINUTE)
        if (denGio) {
            lastRunDate = today
            runQueue()
        }
    }, 10 * 60_000)
}

export function stopEInvoiceQueueCron(): void {
    if (timer) { clearInterval(timer); timer = null }
}
