/* Ký đường phát video Media (14/10/2026) — dùng chung cho routes/sanMedia.ts (GET /:id/xem-link) và
 * /admin/thu-xem-video. Thẻ <video> không gửi được header Authorization nên đường phát mang chữ ký HMAC
 * gắn đúng schema + id + hạn; không bao giờ đưa JWT đăng nhập vào URL. */
import crypto from 'crypto'

export const HAN_XEM_MS = 30 * 60 * 1000

export function kyXem(schema: string, id: string, het: number): string {
    const bi = process.env.JWT_SECRET || ''
    return crypto.createHmac('sha256', `${bi}:xem-video`).update(`${schema}|${id}|${het}`).digest('hex').slice(0, 40)
}

/** Đường (tính từ /api) phát một video Media, sống HAN_XEM_MS */
export function duongXem(schema: string, id: string): { duong: string; het: number } {
    const het = Date.now() + HAN_XEM_MS
    return { duong: `/san-media/xem/${encodeURIComponent(id)}?s=${schema}&h=${het}&k=${kyXem(schema, id, het)}`, het }
}

/** Chữ ký còn đúng + còn hạn không */
export function kiemXem(schema: string, id: string, het: number, k: string): 'ok' | 'sai' | 'het-han' {
    const dung = kyXem(schema, id, het)
    if (!/^[a-z0-9_]+$/.test(schema) || !het || k.length !== dung.length || !crypto.timingSafeEqual(Buffer.from(k), Buffer.from(dung))) return 'sai'
    return Date.now() > het ? 'het-han' : 'ok'
}
