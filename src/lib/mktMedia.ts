/* ═══════════════════════════════════════════════════════════════════════════════
 *  MEDIA MARKETING STUDIO (29/09/2026)
 *
 *  Cùng bucket CÔNG KHAI với ảnh sản phẩm (`kengi-tech-assets`, xem lib/anhSanPham.ts):
 *  Facebook/Instagram/Threads TỰ TẢI media về từ URL nên URL phải xem được không cần
 *  đăng nhập. Đĩa Cloud Run là tạm — ghi đĩa là media mất sau lần khởi động kế tiếp.
 *  Tiền tố `mkt/<schema>/<brandId>/`, tên tệp ngẫu nhiên (không bao giờ ghép tên
 *  người dùng gửi vào đường dẫn).
 * ═══════════════════════════════════════════════════════════════════════════════ */
import crypto from 'crypto'
import { Storage } from '@google-cloud/storage'

const BUCKET = process.env.PRODUCT_IMAGE_BUCKET || 'kengi-tech-assets'
const GOC = `https://storage.googleapis.com/${BUCKET}/`
let kho: Storage | null = null
const bucket = () => { if (!kho) kho = new Storage(); return kho.bucket(BUCKET) }

export const TOI_DA_TAI_LEN = 30 * 1024 * 1024   // Cloud Run chặn thân yêu cầu ~32MB

export type LoaiMedia = { mime: 'image/jpeg' | 'image/png' | 'video/mp4' | 'video/quicktime'; type: 'image' | 'video'; duoi: string }

/** Nhận dạng theo BYTE ĐẦU, không tin tên tệp/MIME trình duyệt gửi. */
export function nhanDangMedia(buf: Buffer): LoaiMedia | null {
    if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', type: 'image', duoi: 'jpg' }
    if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', type: 'image', duoi: 'png' }
    if (buf.length > 12 && buf.toString('ascii', 4, 8) === 'ftyp') {
        const nhan = buf.toString('ascii', 8, 12)
        if (nhan === 'qt  ') return { mime: 'video/quicktime', type: 'video', duoi: 'mov' }
        if (!/^(heic|heix|hevc|mif1|msf1|avif)/.test(nhan)) return { mime: 'video/mp4', type: 'video', duoi: 'mp4' }
    }
    return null
}

function thuMuc(schema: string, brandId: string) {
    if (!/^[a-z0-9_]+$/.test(schema) || !/^[a-z0-9]+$/i.test(brandId)) throw new Error('Đường dẫn media không hợp lệ')
    return `mkt/${schema}/${brandId}/`
}

export async function luuMedia(schema: string, brandId: string, buf: Buffer, loai: LoaiMedia) {
    const duong = `${thuMuc(schema, brandId)}${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${loai.duoi}`
    await bucket().file(duong).save(buf, {
        resumable: false, contentType: loai.mime,
        metadata: { cacheControl: 'public, max-age=31536000, immutable' },
    })
    return { storagePath: duong, url: GOC + duong }
}

/** Xoá tệp — CHỈ tệp nằm trong thư mục của đúng cửa hàng + thương hiệu này. */
export async function xoaMedia(storagePath: string | null | undefined, schema: string, brandId: string) {
    if (!storagePath || !storagePath.startsWith(thuMuc(schema, brandId))) return
    await bucket().file(storagePath).delete({ ignoreNotFound: true })
}

/**
 * URL media người dùng dán vào phải là HTTPS CÔNG KHAI: nền tảng tải về từ đó, và máy
 * chủ này cũng tải về (TikTok/YouTube) — URL nội bộ là mở cửa cho SSRF.
 */
export function kiemUrlCongKhai(raw: string): string | null {
    let u: URL
    try { u = new URL(String(raw).trim()) } catch { return null }
    if (u.protocol !== 'https:' || u.username || u.password) return null
    if (/^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|\[|172\.(1[6-9]|2\d|3[01])\.|metadata\.)/i.test(u.hostname)) return null
    if (u.hostname.endsWith('.internal') || u.hostname.endsWith('.local')) return null
    return u.href
}
