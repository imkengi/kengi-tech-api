/**
 * CHE MÃ BÍ MẬT NẰM TRONG ĐƯỜNG DẪN trước khi ghi log (12/11/2026).
 *
 * Dòng log request của index.ts in nguyên `req.path`. Ba đường mang mã bí mật NGAY TRONG địa chỉ:
 *   POST /api/kiotviet/webhook/:storeCode/:token   — ai cầm token là giả được webhook KiotViet của cửa hàng
 *   GET  /api/meinvoice/hd/:ma/:token              — đường khách mở hoá đơn
 *   PUT  /api/storage/cuc-bo/:token                — phiên tải tệp
 * ⇒ token nằm trong Cloud Logging, ai đọc được log là cầm được (đo 11/11/2026: soi log thấy nguyên token webhook HUTI).
 *
 * Luật: (1) ba khuôn đường trên — che đoạn token; (2) lưới an toàn cho đường thêm sau: MỌI đoạn dài ≥ 32 ký tự chỉ gồm
 * chữ / số / - / _ (token, chữ ký) đều che. Mã bản ghi cuid (25 ký tự) và mã đơn thì GIỮ — log mất mã là hết lần được việc.
 * Giữ 4 ký tự đầu để còn phân biệt hai token khác nhau khi soi log.
 */
const KHUON: RegExp[] = [
    /^(\/api\/kiotviet\/webhook\/[^/]+\/)([^/]+)(.*)$/,
    /^(\/api\/meinvoice\/hd\/[^/]+\/)([^/]+)(.*)$/,
    /^(\/api\/storage\/cuc-bo\/)([^/]+)(.*)$/,
]
const che = (d: string) => (d.length <= 4 ? '***' : `${d.slice(0, 4)}***`)

export function cheBiMatDuongDan(duong: string): string {
    let s = String(duong || '')
    for (const k of KHUON) {
        const m = s.match(k)
        if (m) { s = m[1] + che(m[2]) + m[3]; break }
    }
    return s.split('/').map(d => (/^[A-Za-z0-9_-]{32,}$/.test(d) ? che(d) : d)).join('/')
}
