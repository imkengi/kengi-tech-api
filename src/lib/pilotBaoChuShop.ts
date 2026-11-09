/* ═══════════════════════════════════════════════════════════════════════════════
 *  BÁO CHỦ SHOP khi chu kỳ Pilot chạy theo lịch cần NGƯỜI (03/11/2026)
 *
 *  Chạy theo lịch thì không ai mở trang Pilot: nháp chờ duyệt, lần ghi hỏng / không rõ, chu kỳ gãy (token, API),
 *  cầu dao đẩy tồn, token fanpage sắp hết… trước đây chỉ nằm im trong "Lượt chạy gần nhất" (bài thử chạy thật chu kỳ
 *  trên dữ liệu KENGISTORE: 10 nháp hạ giá TikTok chờ duyệt mà không ai được báo).
 *  Giờ: MỘT thông báo (chuông web + push app) mỗi khi danh sách việc cần người ĐỔI, cách nhau ≥ 3 giờ;
 *  chu kỳ gãy thì báo ngay. Danh sách y như lượt trước ⇒ im (chu kỳ 30 phút không spam).
 *  Kiểu 'warning' — kiểu sẵn có ở chuông web và kênh Android, khỏi khai kiểu mới ở ba nơi.
 *
 *  X-06 (10/11/2026) — trên điện thoại tin này IM và bấm không mở đúng chỗ: 'warning' rơi vào nhóm "Hệ thống" (kênh Android
 *  IMPORTANCE_LOW, setSilent), bấm vào chỉ mở màn Thông báo — trong khi hướng dẫn hứa "chuông + app báo". Giờ tin Pilot mang
 *  NHÓM riêng 'pilot' (kênh «Pilot tự động» có chuông, app ≥ 1.0.47) và ĐƯỜNG WEB của trang Pilot đó (app chưa có màn Pilot ⇒
 *  bấm vào mở trình duyệt). Vẫn giữ type 'warning' ⇒ chuông web khỏi đổi; nhóm nhận theo TIÊU ĐỀ (DUONG_PILOT_WEB) ở cả
 *  push (nhom/web nói thẳng) lẫn danh sách GET /notifications (routes/notifications.phanNhomThongBao).
 *
 *  X-09 (09/11/2026) — Pilot hỏng mà không báo:
 *   - việc y như lần đã báo mà VẪN còn ⇒ trước im mãi (chủ shop lỡ tin đầu là token hỏng nằm im tới khi tự mở trang);
 *     nay nhắc lại sau NHAC_LAI_MS, câu nói "chưa xử lý từ …";
 *   - Xem trước ⇒ trước chỉ báo khi CẢ chu kỳ gãy; nay vẫn báo chỗ làm Pilot mù (ketQuaDeBao): token hỏng / sắp hết hạn,
 *     một gian hỏng cả lượt khi chạy "tất cả gian". Nháp chờ duyệt / dòng ghi hỏng ở Xem trước vẫn không báo (chưa ghi gì).
 * ═══════════════════════════════════════════════════════════════════════════════ */

/** Dấu của lần báo gần nhất — lưu trong lastResult.baoChuShop của cấu hình Pilot. `tu` = lúc báo LẦN ĐẦU đúng danh sách việc
 *  này (nhắc lại giữ nguyên `tu`; dấu cũ chưa có `tu` thì lấy `luc` — trước 09/11 việc y hệt không bao giờ được báo lại). */
export interface DauBao { khoa: string; luc: number; n: number; tu?: number }

export const GIAN_CACH_BAO_MS = 3 * 3600_000
/** Việc y như lần đã báo mà vẫn còn sau chừng này ⇒ nhắc lại (mỗi ngày một lần, không spam chu kỳ 30 phút). */
export const NHAC_LAI_MS = 24 * 3600_000

/** Nhóm thông báo của tin Pilot — app Android ≥ 1.0.47 có kênh riêng «Pilot tự động» (có chuông). */
export const NHOM_PILOT = 'pilot'

/** Tên Pilot (đầu tiêu đề tin) ⇒ trang Pilot trên kengi.vn. PHẢI khớp bảng DUONG_PILOT của chuông web
 *  (FE src/features/notifications/hooks/useNotifications.ts) và của app (Android NotificationWorker.DUONG_PILOT). */
export const DUONG_PILOT_WEB: ReadonlyArray<readonly [string, string]> = [
    ['Shopee Pilot', '/pilot-shopee'],
    ['TikTok Pilot', '/pilot-tiktok'],
    ['Facebook Pilot', '/pilot-facebook'],
    ['Ads Pilot', '/pilot-facebook#ads'],
]

/** Tiêu đề tin ("<tên Pilot> cần…", "<tên Pilot>: chu kỳ…", "<tên Pilot> vẫn còn…") hoặc chính tên Pilot ⇒ đường trang Pilot đó;
 *  tin khác ⇒ undefined. So khớp ĐẦU chuỗi + ranh giới (hết chuỗi / dấu cách / dấu hai chấm) — "Shopee Pilots…" không khớp. */
export function duongPilotCuaTieuDe(title: string | null | undefined): string | undefined {
    const t = String(title || '')
    return DUONG_PILOT_WEB.find(([ten]) => t.startsWith(ten) && /^($|[\s:])/.test(t.slice(ten.length)))?.[1]
}

/** Dòng làm Pilot MÙ — phải báo kể cả ở Xem trước: token hỏng / sắp hết hạn, một gian hỏng cả lượt ("tất cả gian"). */
export function hongCanBao(r: any): boolean {
    return r?.action === 'token' || (r?.action === 'cycle' && r?.status === 'failed')
}

/** Kết quả đưa vào baoChuShop theo chế độ: Tự động / Duyệt tay ⇒ nguyên vẹn; Xem trước ⇒ chu kỳ gãy vẫn nguyên vẹn, còn lại
 *  chỉ giữ dòng hongCanBao (nháp chờ duyệt / lần ghi hỏng ở Xem trước chưa đụng sàn ⇒ không báo). */
export function ketQuaDeBao<T extends { ok: boolean; results?: any[] }>(kq: T, xemTruoc: boolean): T {
    if (!xemTruoc || kq.ok === false) return kq
    return { ...kq, results: (Array.isArray(kq.results) ? kq.results : []).filter(hongCanBao) }
}

/** dd/mm hh:mm giờ Việt Nam */
const ngayGioVN = (ms: number) => {
    const d = new Date(ms + 7 * 3600_000), p = (n: number) => String(n).padStart(2, '0')
    return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`
}

/** Dòng kết quả chu kỳ cần người làm gì đó. "CHƯA BIẾT PHÍ" (09/11/2026): gian chưa đủ đơn đo phí, chưa khai phí ⇒ chu kỳ không
 *  đổi giá / đăng mới được gì — chủ shop phải khai phí (MỘT dòng cho cả gian, lib/giaShopee.dongChuKyChuaBietPhi). */
export function canNguoi(r: any): boolean {
    const st = String(r?.status || ''), m = String(r?.message || '')
    return ['failed', 'uncertain', 'partial'].includes(st) || r?.action === 'token' || /CHỜ NGƯỜI DUYỆT|CẦU DAO|CHƯA CÓ HỒ SƠ ĐĂNG|CHƯA BIẾT PHÍ/.test(m)
}

/** Việc cần người trong kết quả chu kỳ: khoá (để so lượt trước) + từng dòng cho thông báo. */
export function viecCanNguoi(results: any[]): { khoa: string; dong: string[] } {
    const can = (Array.isArray(results) ? results : []).filter(canNguoi)
    const khoa = can.map(r => `${r.action}:${r.channel || ''}:${r.sku || ''}:${r.status}`).sort().join('|')
    const dong = can.map(r => `${r.sku ? `${r.sku}: ` : ''}${String(r.message || r.status).replace(/\s+/g, ' ').slice(0, 180)}`)
    return { khoa, dong }
}

/** Hàm bắn push — mặc định routes/notifications.sendPushToStore; bộ kiểm bơm bản giả để soi khoá gửi đi. */
export type GuiDayPilot = (prisma: any, title: string, message: string, extra: { id?: string; type?: string; nhom?: string; web?: string }) => Promise<unknown>

/**
 * Ghi MỘT tin Pilot: chuông web (type 'warning') + push nhóm 'pilot', bấm vào mở trang Pilot của `ten`. Ghi CSDL hỏng ⇒ NÉM (người
 * gọi quyết giữ dấu cũ / thử lại lượt sau); push là phụ — bắn rồi thôi, hỏng (kể cả ném đồng bộ) không làm hỏng tin đã ghi.
 */
export async function guiTinPilot(prisma: any, ten: string, title: string, message: string, guiDay?: GuiDayPilot): Promise<void> {
    const tin = await prisma.notification.create({ data: { type: 'warning', title, message } })
    const gui: GuiDayPilot = guiDay || (await import('../routes/notifications')).sendPushToStore
    const web = duongPilotCuaTieuDe(ten)
    void (async () => gui(prisma, title, message, { id: tin?.id, type: 'warning', nhom: NHOM_PILOT, ...(web ? { web } : {}) }))().catch(() => { })
}

/** AD-10: dòng kết quả chu kỳ mà MÁY vừa tự làm TỐN THÊM TIỀN (bật quảng cáo mới / chạy lại / tăng ngân sách) — nguồn gắn `tienMay: true`. */
export function dongMayTangChi(results: any[]): string[] {
    return (Array.isArray(results) ? results : []).filter(r => r?.tienMay === true && r?.status === 'succeeded')
        .map(r => `${r.sku ? `${r.sku}: ` : ''}${String(r.message || '').replace(/\s+/g, ' ').slice(0, 180)}`)
}

/**
 * AD-10 (10/11/2026) — máy tự tiêu thêm tiền thì chủ shop phải biết NGAY, không đợi mở trang. Việc một lần (lượt sau không còn) ⇒ KHÔNG
 * qua dấu chống lặp của baoChuShop (đổi chưa đủ 3 giờ là nó giữ lại "lượt sau báo" — việc một lần thì mất). Số tin tự có trần: tăng
 * ngân sách ≤ 1 lần / nhóm QC / ngày, bật mới + chạy lại nằm trong trần thao tác / ngày. Trả true khi đã ghi tin.
 */
export async function baoMayTangChi(prisma: any, ten: string, results: any[], duoi = '', guiDay?: GuiDayPilot): Promise<boolean> {
    const dong = dongMayTangChi(results)
    if (!dong.length) return false
    const title = `${ten}: máy vừa tự tăng chi (${dong.length} việc)`
    const message = (dong.slice(0, 4).join(' · ') + (dong.length > 4 ? ` · … và ${dong.length - 4} việc nữa` : '') + (duoi ? ` — ${duoi}` : '')).slice(0, 500)
    try {
        await guiTinPilot(prisma, ten, title, message, guiDay)
        return true
    } catch (e: any) {
        console.warn(`[${ten}] ghi thông báo tăng chi hỏng:`, e?.message || e)
        return false
    }
}

/**
 * Báo nếu cần, trả dấu mới để lưu. `ten` = "Shopee Pilot" / "TikTok Pilot" / "Facebook Pilot" / "Ads Pilot".
 * Ghi thông báo hỏng ⇒ giữ dấu cũ (lượt sau thử lại), không làm gãy lượt chạy.
 */
export async function baoChuShop(prisma: any, ten: string, kq: { ok: boolean; message?: string; results?: any[] }, truoc: DauBao | null | undefined, now = Date.now(), guiDay?: GuiDayPilot): Promise<DauBao> {
    const cu: DauBao = truoc && typeof truoc.khoa === 'string'
        ? { khoa: truoc.khoa, luc: Number(truoc.luc) || 0, n: Number(truoc.n) || 0, ...(Number(truoc.tu) > 0 ? { tu: Number(truoc.tu) } : {}) }
        : { khoa: '', luc: 0, n: 0 }
    const gay = kq.ok === false
    const { khoa, dong } = gay
        ? { khoa: `loi:${String(kq.message || '').slice(0, 120)}`, dong: [String(kq.message || 'Chu kỳ lỗi không rõ lý do').slice(0, 400)] }
        : viecCanNguoi(kq.results || [])
    if (!khoa) return { khoa: '', luc: cu.luc, n: 0 }          // hết việc ⇒ im; lần sau có việc lại báo
    const lap = khoa === cu.khoa
    if (lap && now - cu.luc < NHAC_LAI_MS) return cu             // y như lần đã báo, chưa đủ một ngày ⇒ im
    if (!lap && !gay && now - cu.luc < GIAN_CACH_BAO_MS) return cu // đổi mà chưa đủ 3 giờ ⇒ giữ dấu cũ, lượt sau báo
    const tu = lap ? (cu.tu || cu.luc) : now
    const title = gay ? `${ten}: chu kỳ tự động ${lap ? 'vẫn ' : ''}bị lỗi`
        : lap ? `${ten} vẫn còn ${dong.length} việc cần anh/chị xem` : `${ten} cần anh/chị xem ${dong.length} việc`
    const message = ((lap ? `Chưa xử lý từ ${ngayGioVN(tu)}: ` : '')
        + (gay ? `${dong[0]} — mở ${ten} kiểm kết nối.` : dong.slice(0, 4).join(' · ') + (dong.length > 4 ? ` · … và ${dong.length - 4} việc nữa trên ${ten}.` : ''))).slice(0, 500)
    try {
        // push là phụ (trong guiTinPilot): hỏng không được làm mất dấu — thông báo đã ghi rồi
        await guiTinPilot(prisma, ten, title, message, guiDay)
    } catch (e: any) {
        console.warn(`[${ten}] ghi thông báo hỏng:`, e?.message || e)
        return cu
    }
    return { khoa, luc: now, n: dong.length, tu }
}
