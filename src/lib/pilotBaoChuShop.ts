/* ═══════════════════════════════════════════════════════════════════════════════
 *  BÁO CHỦ SHOP khi chu kỳ Pilot chạy theo lịch cần NGƯỜI (03/11/2026)
 *
 *  Chạy theo lịch thì không ai mở trang Pilot: nháp chờ duyệt, lần ghi hỏng / không rõ, chu kỳ gãy (token, API),
 *  cầu dao đẩy tồn, token fanpage sắp hết… trước đây chỉ nằm im trong "Lượt chạy gần nhất" (bài thử chạy thật chu kỳ
 *  trên dữ liệu KENGISTORE: 10 nháp hạ giá TikTok chờ duyệt mà không ai được báo).
 *  Giờ: MỘT thông báo (chuông web + push app) mỗi khi danh sách việc cần người ĐỔI, cách nhau ≥ 3 giờ;
 *  chu kỳ gãy thì báo ngay. Danh sách y như lượt trước ⇒ im (chu kỳ 30 phút không spam).
 *  Kiểu 'warning' — kiểu sẵn có ở chuông web và kênh Android, khỏi khai kiểu mới ở ba nơi.
 * ═══════════════════════════════════════════════════════════════════════════════ */

/** Dấu của lần báo gần nhất — lưu trong lastResult.baoChuShop của cấu hình Pilot. */
export interface DauBao { khoa: string; luc: number; n: number }

export const GIAN_CACH_BAO_MS = 3 * 3600_000

/** Dòng kết quả chu kỳ cần người làm gì đó. */
export function canNguoi(r: any): boolean {
    const st = String(r?.status || ''), m = String(r?.message || '')
    return ['failed', 'uncertain', 'partial'].includes(st) || r?.action === 'token' || /CHỜ NGƯỜI DUYỆT|CẦU DAO|CHƯA CÓ HỒ SƠ ĐĂNG/.test(m)
}

/** Việc cần người trong kết quả chu kỳ: khoá (để so lượt trước) + từng dòng cho thông báo. */
export function viecCanNguoi(results: any[]): { khoa: string; dong: string[] } {
    const can = (Array.isArray(results) ? results : []).filter(canNguoi)
    const khoa = can.map(r => `${r.action}:${r.channel || ''}:${r.sku || ''}:${r.status}`).sort().join('|')
    const dong = can.map(r => `${r.sku ? `${r.sku}: ` : ''}${String(r.message || r.status).replace(/\s+/g, ' ').slice(0, 180)}`)
    return { khoa, dong }
}

/**
 * Báo nếu cần, trả dấu mới để lưu. `ten` = "Shopee Pilot" / "TikTok Pilot" / "Facebook Pilot".
 * Ghi thông báo hỏng ⇒ giữ dấu cũ (lượt sau thử lại), không làm gãy lượt chạy.
 */
export async function baoChuShop(prisma: any, ten: string, kq: { ok: boolean; message?: string; results?: any[] }, truoc: DauBao | null | undefined, now = Date.now()): Promise<DauBao> {
    const cu: DauBao = truoc && typeof truoc.khoa === 'string' ? { khoa: truoc.khoa, luc: Number(truoc.luc) || 0, n: Number(truoc.n) || 0 } : { khoa: '', luc: 0, n: 0 }
    const gay = kq.ok === false
    const { khoa, dong } = gay
        ? { khoa: `loi:${String(kq.message || '').slice(0, 120)}`, dong: [String(kq.message || 'Chu kỳ lỗi không rõ lý do').slice(0, 400)] }
        : viecCanNguoi(kq.results || [])
    if (!khoa) return { khoa: '', luc: cu.luc, n: 0 }          // hết việc ⇒ im; lần sau có việc lại báo
    if (khoa === cu.khoa) return cu                               // y như lượt trước đã báo
    if (!gay && now - cu.luc < GIAN_CACH_BAO_MS) return cu        // đổi mà chưa đủ 3 giờ ⇒ giữ dấu cũ, lượt sau báo
    const title = gay ? `${ten}: chu kỳ tự động bị lỗi` : `${ten} cần anh/chị xem ${dong.length} việc`
    const message = (gay ? `${dong[0]} — mở ${ten} kiểm kết nối.` : dong.slice(0, 4).join(' · ') + (dong.length > 4 ? ` · … và ${dong.length - 4} việc nữa trên ${ten}.` : '')).slice(0, 500)
    try {
        const tin = await prisma.notification.create({ data: { type: 'warning', title, message } })
        const { sendPushToStore } = await import('../routes/notifications')
        sendPushToStore(prisma, title, message, { id: tin?.id, type: 'warning' }).catch(() => { })
    } catch (e: any) {
        console.warn(`[${ten}] ghi thông báo hỏng:`, e?.message || e)
        return cu
    }
    return { khoa, luc: now, n: dong.length }
}
