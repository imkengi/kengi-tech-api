/* ═══════════════════════════════════════════════════════════════════════════════
 *  KHO ẢNH SẢN PHẨM (27/09/2026)
 *
 *  Ảnh sản phẩm nhân viên tải lên phải SỐNG QUA mọi lần khởi động lại, nên KHÔNG
 *  ghi đĩa như routes/uploads.ts (Cloud Run xoá đĩa mỗi lần khởi động, và mỗi bản
 *  một đĩa riêng). Lưu vào bucket công khai `kengi-tech-assets` (asia-southeast1,
 *  allUsers đã có objectViewer — đo 27/09: chỉ chứa logo.png), dưới tiền tố
 *  `anh-sp/<schema>/<productId>/`. Service account mặc định của Cloud Run là
 *  projectEditor ⇒ legacyBucketOwner ⇒ ghi được, không cần thêm khoá hay biến môi trường.
 *
 *  CỐ Ý không bật GCS_BUCKET cho lib/storage.ts: đường đó còn chở "kho tài liệu
 *  nội bộ" (routes/storage.ts) — bật lên là tài liệu nội bộ thành công khai.
 * ═══════════════════════════════════════════════════════════════════════════════ */
import crypto from 'crypto'
import { Storage } from '@google-cloud/storage'

const BUCKET = process.env.PRODUCT_IMAGE_BUCKET || 'kengi-tech-assets'
const GOC = `https://storage.googleapis.com/${BUCKET}/`

let khoGcs: Storage | null = null
function bucket() {
    if (!khoGcs) khoGcs = new Storage()
    return khoGcs.bucket(BUCKET)
}

export type LoaiAnh = 'image/jpeg' | 'image/png' | 'image/webp'

/** Nhận dạng ảnh theo BYTE ĐẦU, không tin tên tệp/MIME trình duyệt gửi. */
export function nhanDangAnh(buf: Buffer): LoaiAnh | 'heic' | null {
    if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
    if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
    if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
    // Ảnh iPhone (HEIC/HEIF): trình duyệt không vẽ được thì cũng không bán được trên sàn
    if (buf.length > 12 && buf.toString('ascii', 4, 8) === 'ftyp' && /^(heic|heix|hevc|mif1|msf1)$/.test(buf.toString('ascii', 8, 12))) return 'heic'
    return null
}

function thuMucCuaHang(schema: string): string {
    if (!/^[a-z0-9_]+$/.test(schema)) throw new Error('Schema cửa hàng không hợp lệ')
    return `anh-sp/${schema}/`
}

/** Ghi ảnh lên bucket, trả về đường dẫn công khai. Tên tệp ngẫu nhiên ⇒ cache mãi được. */
export async function luuAnhSanPham(schema: string, productId: string, buf: Buffer, loai: LoaiAnh): Promise<string> {
    if (!/^[a-z0-9]+$/i.test(productId)) throw new Error('Mã sản phẩm không hợp lệ')
    const duoi = loai === 'image/png' ? 'png' : loai === 'image/webp' ? 'webp' : 'jpg'
    const ten = `${thuMucCuaHang(schema)}${productId}/${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${duoi}`
    await bucket().file(ten).save(buf, {
        resumable: false,
        contentType: loai,
        metadata: { cacheControl: 'public, max-age=31536000, immutable' },
    })
    return GOC + ten
}

/** Ảnh này do kho ảnh của CHÍNH cửa hàng này lưu? (ảnh dán link ngoài thì không xoá hộ) */
export function laAnhCuaCuaHang(url: string, schema: string): boolean {
    return url.startsWith(GOC + thuMucCuaHang(schema))
}

/** Xoá tệp trên bucket — chỉ tệp của đúng cửa hàng; tệp đã mất thì thôi. */
export async function xoaAnhSanPham(url: string, schema: string): Promise<void> {
    if (!laAnhCuaCuaHang(url, schema)) return
    await bucket().file(url.slice(GOC.length)).delete({ ignoreNotFound: true })
}

/** TỰ KIỂM trên prod (POST /api/admin/thu-kho-anh-san-pham): ghi một ảnh PNG 1×1 vào
 *  `anh-sp/_thu/`, đọc lại qua đường CÔNG KHAI như trình duyệt, rồi xoá. Chứng minh
 *  service account ghi được + ảnh xem được mà không cần đăng nhập cửa hàng nào. */
export async function thuKhoAnh(): Promise<{ url: string; ghi: string; docCongKhai: string; xoa: string }> {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
    const ten = `anh-sp/_thu/${Date.now()}-${crypto.randomBytes(3).toString('hex')}.png`
    const url = GOC + ten
    const kq = { url, ghi: 'chưa', docCongKhai: 'chưa', xoa: 'chưa' }
    try {
        await bucket().file(ten).save(png, { resumable: false, contentType: 'image/png' })
        kq.ghi = 'được'
    } catch (e: any) { kq.ghi = `LỖI: ${e?.message || e}`; return kq }
    try {
        const r = await fetch(url, { cache: 'no-store' } as any)
        const buf = Buffer.from(await r.arrayBuffer())
        kq.docCongKhai = `${r.status} ${r.headers.get('content-type') || ''} ${buf.equals(png) ? 'đúng nội dung' : 'SAI nội dung'}`
    } catch (e: any) { kq.docCongKhai = `LỖI: ${e?.message || e}` }
    try {
        await bucket().file(ten).delete({ ignoreNotFound: true })
        kq.xoa = 'được'
    } catch (e: any) { kq.xoa = `LỖI: ${e?.message || e}` }
    return kq
}
