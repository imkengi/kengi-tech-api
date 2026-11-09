import crypto from 'crypto'

/* ═══ Thiết bị tin cậy của 2FA — lưu trong cột User.trustedDevices (JSON, schema cửa hàng) ═══════════════════
 *
 * Thống nhất 09/11/2026 (chủ shop chọn "phương án B": có hạt TOTP thì chỉ hỏi mã app, chưa có hạt thì mã email).
 * Trước đó có HAI kho thiết bị tin cậy cho hai cổng 2FA ở POST /auth/login:
 *   - cổng OTP email: Map trong RAM (bản cũ của tệp này) — mất khi deploy, mỗi bản Cloud Run một kho riêng, còn web
 *     không lưu token verify-otp trả về nên chưa lần nào dùng tới;
 *   - cổng TOTP: cột này, với `id` DO CLIENT TỰ CHỌN — web gửi vân tay 'dev_' + hash 32-bit (UA | ngôn ngữ | màn hình |
 *     múi giờ), đoán được; Android 1.0.46 gửi hằng 'android_dev' — một khoá vượt CHUNG cho mọi máy. Ai có mật khẩu
 *     gửi đúng chuỗi đó là qua bước TOTP. GET /trusted-devices còn trả nguyên khoá vượt ấy.
 * Nay MỘT kho cho cả hai cách: token ngẫu nhiên 32 byte DO MÁY CHỦ CẤP sau khi qua 2FA (client xin bằng
 * `rememberDevice: true` và tự lưu lại), cột chỉ giữ BĂM SHA-256, hạn 30 ngày; mỗi mục có `id` công khai riêng để
 * liệt kê / xoá. Mục kiểu cũ (không có tokenHash) không bao giờ khớp và rơi khỏi cột ở lần ghi kế tiếp.
 */

export const THIET_BI_TIN_CAY = { SO_NGAY: 30, TOI_DA: 10 } as const

export interface ThietBiTinCay {
    /** công khai — dùng để liệt kê / xoá; KHÔNG dùng để vượt 2FA */
    id: string
    /** sha256(token) dạng hex — token thô chỉ trả cho client MỘT lần, lúc cấp */
    tokenHash: string
    name: string
    browser: string
    os: string
    ip: string
    createdAt: string
    lastUsed: string
    expiresAt: string
}
export type ThietBiCongKhai = Omit<ThietBiTinCay, 'tokenHash'>

const LA_HEX_64 = /^[0-9a-f]{64}$/
const bam = (token: string) => crypto.createHash('sha256').update(token).digest('hex')
const cat = (v: unknown, macDinh: string, toiDa = 120) => {
    const s = typeof v === 'string' ? v.trim() : ''
    return (s || macDinh).slice(0, toiDa)
}

/** Token thiết bị client gửi kèm /login (body.deviceToken hoặc header x-device-token). Chỉ nhận đúng dạng token máy
 *  chủ cấp (64 ký tự hex) — vân tay 'dev_…' của web cũ và hằng 'android_dev' của Android 1.0.46 bị bỏ qua. */
export function layTokenThietBi(body: unknown, header: unknown): string | null {
    for (const v of [(body as any)?.deviceToken, header]) {
        if (typeof v === 'string' && LA_HEX_64.test(v)) return v
    }
    return null
}

/** Đọc cột trustedDevices: chỉ giữ mục kiểu mới (có tokenHash) còn hạn. JSON hỏng ⇒ []. */
export function docThietBi(raw: string | null | undefined, now = new Date()): ThietBiTinCay[] {
    let arr: unknown
    try { arr = JSON.parse(raw || '[]') } catch { return [] }
    if (!Array.isArray(arr)) return []
    return arr.filter((d: any) =>
        d && typeof d.id === 'string' && typeof d.tokenHash === 'string' && LA_HEX_64.test(d.tokenHash)
        && typeof d.expiresAt === 'string' && Date.parse(d.expiresAt) > now.getTime(),
    ) as ThietBiTinCay[]
}

/** Thiết bị khớp token (so băm, an toàn thời gian), hoặc null. */
export function timThietBi(raw: string | null | undefined, token: string, now = new Date()): ThietBiTinCay | null {
    if (!LA_HEX_64.test(token)) return null
    const h = Buffer.from(bam(token), 'hex')
    for (const d of docThietBi(raw, now)) {
        if (crypto.timingSafeEqual(h, Buffer.from(d.tokenHash, 'hex'))) return d
    }
    return null
}

/** Ghi nhận thiết bị vừa dùng ⇒ chuỗi JSON mới cho cột (đồng thời lọc bỏ mục kiểu cũ / hết hạn). */
export function chamThietBi(raw: string | null | undefined, id: string, now = new Date()): string {
    return JSON.stringify(docThietBi(raw, now).map(d => d.id === id ? { ...d, lastUsed: now.toISOString() } : d))
}

/** Thêm thiết bị ⇒ token thô (trả client MỘT lần) + chuỗi JSON mới cho cột. Quá TOI_DA thì bỏ mục cũ nhất. */
export function themThietBi(
    raw: string | null | undefined,
    info: { name?: unknown; browser?: unknown; os?: unknown; ip?: unknown },
    now = new Date(),
): { token: string; json: string; thietBi: ThietBiTinCay } {
    const token = crypto.randomBytes(32).toString('hex')
    const thietBi: ThietBiTinCay = {
        id: 'tb_' + crypto.randomBytes(9).toString('hex'),
        tokenHash: bam(token),
        name: cat(info.name, 'Thiết bị không tên'),
        browser: cat(info.browser, 'Unknown', 60),
        os: cat(info.os, 'Unknown', 120),
        ip: cat(info.ip, 'Unknown', 64),
        createdAt: now.toISOString(),
        lastUsed: now.toISOString(),
        expiresAt: new Date(now.getTime() + THIET_BI_TIN_CAY.SO_NGAY * 24 * 60 * 60 * 1000).toISOString(),
    }
    const ds = [...docThietBi(raw, now), thietBi].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
    while (ds.length > THIET_BI_TIN_CAY.TOI_DA) ds.shift()
    return { token, json: JSON.stringify(ds), thietBi }
}

/** Bỏ một thiết bị theo id công khai ⇒ chuỗi JSON mới cho cột. */
export function boThietBi(raw: string | null | undefined, id: string, now = new Date()): string {
    return JSON.stringify(docThietBi(raw, now).filter(d => d.id !== id))
}

/** Danh sách trả ra ngoài (GET /auth/trusted-devices): không có tokenHash. */
export function thietBiCongKhai(raw: string | null | undefined, now = new Date()): ThietBiCongKhai[] {
    return docThietBi(raw, now).map(({ tokenHash: _bo, ...d }) => d)
}
