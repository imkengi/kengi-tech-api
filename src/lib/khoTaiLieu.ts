/* ═══════════════════════════════════════════════════════════════════════════════
 *  KENGI VAULT — KHO TÀI LIỆU RIÊNG TƯ (20/10/2026)
 *
 *  VÌ SAO VIẾT LẠI: bản cũ (routes/storage.ts) ghi tệp vào public/uploads trên ĐĨA TẠM của Cloud Run
 *  (prod không có GCS_BUCKET) ⇒ mỗi lần deploy/khởi động lại là mất tệp. Đo 20/10: 5/5 tệp trên prod
 *  trả 404 (có cả "Biên bản điều chỉnh hoá đơn … đã ký.pdf" của KENGISTORE). Bucket kengi-tech-assets
 *  thì CÔNG KHAI (allUsers xem được) ⇒ cấm dùng cho hợp đồng/chứng từ (xem lib/anhSanPham.ts).
 *
 *  NAY:
 *   · Bucket RIÊNG TƯ `kengi-tech-vault` (uniform access + chặn công khai). Khoá object
 *     `v/<schema>/<fileId>/<ngẫu nhiên>` — KHÔNG BAO GIỜ ghép tên tệp người dùng vào khoá.
 *   · Trình duyệt tải THẲNG lên GCS bằng phiên resumable (không qua Cloud Run ⇒ không vướng trần
 *     thân 32MB và timeout 15 giây của apiClient), chia khối 8 MiB, đứt mạng thì hỏi lại vị trí rồi đi tiếp.
 *   · Xem/tải qua đường ký HMAC sống 30 phút do máy chủ phát luồng (có Range cho video/PDF lớn).
 *     Thẻ <img>/<iframe>/<video> không gửi được header Authorization ⇒ chữ ký gắn schema + id + hạn,
 *     không bao giờ đưa JWT vào URL (cùng cách lib/linkXemVideo.ts).
 *   · VAULT_DRIVER=local (CHỈ máy dev/thử): lưu ở thư mục tạm, máy chủ tự giả lập giao thức resumable
 *     ở PUT /api/storage/cuc-bo/:token để chạy trọn luồng mà không cần GCS.
 * ═══════════════════════════════════════════════════════════════════════════════ */
import crypto from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { Readable } from 'stream'
import { Storage } from '@google-cloud/storage'

/** Trần một tệp. Cột `size` là INTEGER (≤ 2.147.483.647) ⇒ 2 tỷ byte, không phải 2 GiB. */
export const TOI_DA_TEP = 2_000_000_000
/** Khối tải lên — GCS đòi khối giữa chừng là bội của 256 KiB */
export const KHOI_TAI_LEN = 8 * 1024 * 1024
export const HAN_LINK_MS = 30 * 60 * 1000

export const laCucBo = () => process.env.VAULT_DRIVER === 'local'
export const tenBucket = () => process.env.VAULT_BUCKET || 'kengi-tech-vault'
let gcs: Storage | null = null
const bucket = () => { if (!gcs) gcs = new Storage(); return gcs.bucket(tenBucket()) }
const thuMucCucBo = () => process.env.VAULT_LOCAL_DIR || path.join(os.tmpdir(), 'kengi-vault-local')

export function kiemSchema(schema: string): string {
    if (!/^[a-z0-9_]+$/.test(String(schema || ''))) throw new Error('Schema cửa hàng không hợp lệ')
    return schema
}

export function khoaMoi(schema: string, fileId: string): string {
    kiemSchema(schema)
    if (!/^[a-z0-9]+$/i.test(fileId)) throw new Error('Mã tệp không hợp lệ')
    return `v/${schema}/${fileId}/${crypto.randomBytes(8).toString('hex')}`
}
export const khoaAnhNho = (key: string) => `${key}.t.jpg`
/** Khoá này thuộc kho của cửa hàng này? (chống đọc chéo cửa hàng bằng khoá ghép tay) */
export const khoaCuaCuaHang = (key: string | null | undefined, schema: string) => !!key && key.startsWith(`v/${schema}/`)

// ─── Chữ ký HMAC ─────────────────────────────────────────────────────────────
function biMat(): string {
    const s = process.env.JWT_SECRET || ''
    if (!s) throw new Error('Máy chủ thiếu JWT_SECRET — không ký được đường xem tệp')
    return s
}
export function ky(muc: string, ...phan: (string | number)[]): string {
    return crypto.createHmac('sha256', `${biMat()}:kengi-vault:${muc}`).update(phan.join('|')).digest('base64url').slice(0, 32)
}
export function dungKy(gui: unknown, dung: string): boolean {
    return typeof gui === 'string' && gui.length === dung.length && crypto.timingSafeEqual(Buffer.from(gui), Buffer.from(dung))
}

export type CheDoXem = 'xem' | 'tai' | 'nho'
/** Hạn làm tròn theo khung 30 phút ⇒ cùng một tệp trong một khung ra CÙNG một đường ⇒ trình duyệt dùng lại
 *  ảnh nhỏ đã tải thay vì tải lại mỗi lần nạp danh sách. Hạn thật 30–60 phút. */
export function hanKhung(now = Date.now()): number {
    return (Math.floor(now / HAN_LINK_MS) + 2) * HAN_LINK_MS
}
/** Đường (tính từ /api) để xem/tải/ảnh nhỏ một tệp */
export function duongXem(schema: string, id: string, cheDo: CheDoXem, het = hanKhung()): string {
    return `/storage/xem/${encodeURIComponent(id)}?s=${schema}&h=${het}&c=${cheDo}&k=${ky('xem', schema, id, het, cheDo)}`
}
export function kiemXem(schema: string, id: string, het: number, cheDo: string, k: unknown): 'ok' | 'sai' | 'het-han' {
    if (!/^[a-z0-9_]+$/.test(schema) || !het || !['xem', 'tai', 'nho'].includes(cheDo)) return 'sai'
    if (!dungKy(k, ky('xem', schema, id, het, cheDo))) return 'sai'
    return Date.now() > het ? 'het-han' : 'ok'
}

export function duongZip(schema: string, ids: string[], het = Date.now() + HAN_LINK_MS): string {
    const ds = ids.join(',')
    return `/storage/zip?s=${schema}&ids=${encodeURIComponent(ds)}&h=${het}&k=${ky('zip', schema, ds, het)}`
}
export function kiemZip(schema: string, ds: string, het: number, k: unknown): 'ok' | 'sai' | 'het-han' {
    if (!/^[a-z0-9_]+$/.test(schema) || !het || !dungKy(k, ky('zip', schema, ds, het))) return 'sai'
    return Date.now() > het ? 'het-han' : 'ok'
}

/** Mã chia sẻ công khai: <shareId>.<schema base64url>.<chữ ký>. Hạn/thu hồi/lượt xem nằm ở bảng StorageShare. */
export function maChiaSe(schema: string, shareId: string): string {
    return `${shareId}.${Buffer.from(schema).toString('base64url')}.${ky('chia-se', shareId, schema)}`
}
export function docMaChiaSe(ma: string): { schema: string; shareId: string } | null {
    const [shareId, s64, k] = String(ma || '').split('.')
    if (!shareId || !s64 || !k || !/^[a-f0-9]{32}$/.test(shareId)) return null
    let schema = ''
    try { schema = Buffer.from(s64, 'base64url').toString('utf8') } catch { return null }
    if (!/^[a-z0-9_]+$/.test(schema) || !dungKy(k, ky('chia-se', shareId, schema))) return null
    return { schema, shareId }
}

// ─── Loại tệp: chỉ cho XEM TẠI CHỖ những loại không chạy được mã ─────────────
const XEM_TAI_CHO = /^(image\/(jpeg|png|gif|webp|bmp|avif)|application\/pdf|video\/(mp4|webm|quicktime)|audio\/(mpeg|mp4|wav|x-wav|ogg|webm|aac|x-m4a)|text\/plain|text\/csv)$/
export const laXemTaiCho = (mime: string | null | undefined) => XEM_TAI_CHO.test(String(mime || '').toLowerCase().split(';')[0]!.trim())

/** Nhận dạng theo BYTE ĐẦU — tên tệp/MIME trình duyệt gửi chỉ là lời khai. */
export function nhanDangByte(b: Buffer): string | null {
    if (b.length >= 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'application/pdf'
    if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
    if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
    if (b.length >= 6 && (b.toString('ascii', 0, 6) === 'GIF87a' || b.toString('ascii', 0, 6) === 'GIF89a')) return 'image/gif'
    if (b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
    if (b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WAVE') return 'audio/wav'
    if (b.length >= 2 && b[0] === 0x42 && b[1] === 0x4d) return 'image/bmp'
    if (b.length >= 12 && b.toString('ascii', 4, 8) === 'ftyp') {
        const nhan = b.toString('ascii', 8, 12)
        if (/^(heic|heix|hevc|mif1|msf1)/.test(nhan)) return 'image/heic'
        if (/^avi[fs]/.test(nhan)) return 'image/avif'
        if (nhan === 'qt  ') return 'video/quicktime'
        if (/^M4A/.test(nhan)) return 'audio/mp4'
        return 'video/mp4'
    }
    if (b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'video/webm'
    if (b.length >= 3 && (b.toString('ascii', 0, 3) === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0))) return 'audio/mpeg'
    if (b.length >= 4 && b.toString('ascii', 0, 4) === 'OggS') return 'audio/ogg'
    if (b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && (b[2] === 0x03 || b[2] === 0x05)) return 'application/zip' // docx/xlsx/pptx/zip
    if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))) return 'application/x-ole' // doc/xls cũ
    if (b.length >= 6 && b.toString('ascii', 0, 6) === 'Rar!\x1a\x07') return 'application/vnd.rar'
    return null
}

/** Có phải chữ thuần (UTF-8 không có byte điều khiển lạ) — để cho xem text/csv tại chỗ */
export function laChuThuan(b: Buffer): boolean {
    if (!b.length) return false
    for (let i = 0; i < Math.min(b.length, 4096); i++) {
        const c = b[i]!
        if (c === 0) return false
        if (c < 0x09 || (c > 0x0d && c < 0x20 && c !== 0x1b)) return false
    }
    const t = b.toString('utf8', 0, Math.min(b.length, 4096))
    return !/<\s*(script|html|svg|iframe|object|embed)\b/i.test(t)
}

/**
 * MIME dùng để PHÁT tệp: khai báo của trình duyệt chỉ được tin khi byte đầu khớp và nằm trong danh sách
 * xem-tại-chỗ; HTML/SVG/XML/JS… luôn là octet-stream + attachment (không cho chạy mã trên api.kengi.vn).
 */
export function mimePhat(khai: string, dau: Buffer): { mime: string; xemTaiCho: boolean } {
    const khaiSach = String(khai || '').toLowerCase().split(';')[0]!.trim()
    const that = nhanDangByte(dau)
    if (that && XEM_TAI_CHO.test(that)) return { mime: that, xemTaiCho: true }
    if (!that && (khaiSach === 'text/plain' || khaiSach === 'text/csv') && laChuThuan(dau)) return { mime: `${khaiSach}; charset=utf-8`, xemTaiCho: true }
    // Văn phòng (docx/xlsx…) giữ MIME khai để hệ điều hành chọn đúng ứng dụng, nhưng chỉ cho tải về
    if (that === 'application/zip' && /officedocument|opendocument|zip/.test(khaiSach)) return { mime: khaiSach, xemTaiCho: false }
    if (that === 'application/x-ole' && /msword|ms-excel|ms-powerpoint/.test(khaiSach)) return { mime: khaiSach, xemTaiCho: false }
    if (that && !/html|svg|xml|javascript/.test(that)) return { mime: that, xemTaiCho: false }
    return { mime: 'application/octet-stream', xemTaiCho: false }
}

/** Content-Disposition chuẩn RFC 6266/5987: tên có dấu tiếng Việt vẫn giữ nguyên khi lưu về máy */
export function contentDisposition(kieu: 'inline' | 'attachment', ten: string): string {
    const sach = String(ten || 'tep').replace(/[\r\n"\\]/g, '_').replace(/[\/]/g, '_').slice(0, 200) || 'tep'
    const ascii = sach.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').replace(/[^\x20-\x7e]/g, '_')
    return `${kieu}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(sach)}`
}

// ─── Đọc/ghi object ──────────────────────────────────────────────────────────
export interface ThongTinDoiTuong { size: number; md5: string | null; contentType: string }

const duongCucBo = (key: string) => {
    if (!/^v\/[a-z0-9_]+\/[a-z0-9]+\/[a-f0-9]+(\.t\.jpg)?$/i.test(key)) throw new Error('Khoá object không hợp lệ')
    return path.join(thuMucCucBo(), ...key.split('/'))
}

/**
 * Mở phiên tải lên. GCS: phiên resumable gắn `origin` (để GCS trả header CORS cho trình duyệt) +
 * `contentLength` (GCS từ chối tải quá đúng số byte đã khai) + ifGenerationMatch=0 (không ghi đè object có sẵn).
 * Trả URL tuyệt đối (GCS) hoặc đường tính từ /api (cục bộ).
 */
export async function taoPhienTaiLen(key: string, contentType: string, size: number, origin?: string): Promise<string> {
    if (laCucBo()) {
        const p = duongCucBo(key)
        fs.mkdirSync(path.dirname(p), { recursive: true })
        fs.writeFileSync(`${p}.phien.json`, JSON.stringify({ contentType, size }))
        try { fs.unlinkSync(`${p}.part`) } catch { /* chưa có */ }
        const het = Date.now() + 7 * 24 * 3600_000
        return `/storage/cuc-bo/${Buffer.from(key).toString('base64url')}.${het}.${ky('cuc-bo', key, het)}`
    }
    const [uri] = await bucket().file(key).createResumableUpload({
        origin,
        metadata: { contentType, contentLength: size },
        preconditionOpts: { ifGenerationMatch: 0 },
    } as any)
    return uri
}

export async function thongTin(key: string): Promise<ThongTinDoiTuong | null> {
    if (laCucBo()) {
        try {
            const m = JSON.parse(fs.readFileSync(`${duongCucBo(key)}.meta.json`, 'utf8'))
            return { size: Number(m.size), md5: m.md5 || null, contentType: m.contentType || 'application/octet-stream' }
        } catch { return null }
    }
    try {
        const [m]: any = await bucket().file(key).getMetadata()
        return {
            size: Number(m.size),
            md5: m.md5Hash ? Buffer.from(m.md5Hash, 'base64').toString('hex') : null,
            contentType: m.contentType || 'application/octet-stream',
        }
    } catch (e: any) {
        if (e?.code === 404) return null
        throw e
    }
}

/** Luồng đọc [start, end] (end tính cả, như header Range) */
export function luongDoc(key: string, start?: number, end?: number): Readable {
    if (laCucBo()) return fs.createReadStream(duongCucBo(key), { start, end })
    return bucket().file(key).createReadStream({ start, end, validation: start === undefined && end === undefined ? 'crc32c' : false } as any)
}

export async function docDoan(key: string, start: number, end: number): Promise<Buffer> {
    const phan: Buffer[] = []
    for await (const c of luongDoc(key, start, end)) phan.push(Buffer.from(c))
    return Buffer.concat(phan)
}

export async function docHet(key: string, toiDa: number): Promise<Buffer> {
    const tt = await thongTin(key)
    if (!tt) throw new Error('Tệp không còn trong kho')
    if (tt.size > toiDa) throw new Error(`Tệp ${Math.round(tt.size / 1048576)}MB quá trần ${Math.round(toiDa / 1048576)}MB`)
    return tt.size ? docDoan(key, 0, tt.size - 1) : Buffer.alloc(0)
}

export async function ghi(key: string, buf: Buffer, contentType: string): Promise<void> {
    if (laCucBo()) {
        const p = duongCucBo(key)
        fs.mkdirSync(path.dirname(p), { recursive: true })
        fs.writeFileSync(p, buf)
        fs.writeFileSync(`${p}.meta.json`, JSON.stringify({ contentType, size: buf.length, md5: crypto.createHash('md5').update(buf).digest('hex') }))
        return
    }
    await bucket().file(key).save(buf, { resumable: false, contentType, metadata: { cacheControl: 'private, max-age=0' } })
}

export async function xoa(key: string | null | undefined): Promise<void> {
    if (!key) return
    if (laCucBo()) {
        const p = duongCucBo(key)
        for (const duoi of ['', '.meta.json', '.part', '.phien.json']) { try { fs.unlinkSync(p + duoi) } catch { /* không có */ } }
        try { fs.rmdirSync(path.dirname(p)) } catch { /* còn tệp khác (ảnh nhỏ) hoặc đã xoá */ }
        return
    }
    await bucket().file(key).delete({ ignoreNotFound: true } as any)
}

/**
 * Giả lập giao thức tải resumable của GCS cho VAULT_DRIVER=local (PUT /api/storage/cuc-bo/:token):
 *  - `Content-Range: bytes a-b/tổng` + thân = khối; a phải đúng số byte đã nhận, sai thì 308 kèm Range hiện có.
 *  - `Content-Range: bytes * /tổng` (không thân) = hỏi đã nhận tới đâu.
 *  - Đủ tổng ⇒ 200, ghi meta (md5) như GCS.
 */
export async function nhanKhoiCucBo(token: string, contentRange: string | undefined, than: Buffer):
    Promise<{ status: number; range?: string; loi?: string }> {
    if (!laCucBo()) return { status: 404, loi: 'Không bật kho cục bộ' }
    const [k64, hetS, k] = String(token || '').split('.')
    const key = Buffer.from(String(k64 || ''), 'base64url').toString('utf8')
    const het = Number(hetS)
    if (!key || !het || !dungKy(k, ky('cuc-bo', key, het)) || Date.now() > het) return { status: 403, loi: 'Phiên tải lên sai hoặc hết hạn' }
    const p = duongCucBo(key)
    let phien: { contentType: string; size: number }
    try { phien = JSON.parse(fs.readFileSync(`${p}.phien.json`, 'utf8')) } catch { return { status: 404, loi: 'Không có phiên' } }
    if (fs.existsSync(`${p}.meta.json`)) return { status: 200 }
    const daCo = fs.existsSync(`${p}.part`) ? fs.statSync(`${p}.part`).size : 0
    const rangeHienCo = daCo ? `bytes=0-${daCo - 1}` : undefined
    const m = /^bytes (\*|(\d+)-(\d+))\/(\d+|\*)$/.exec(String(contentRange || '').trim())
    if (!m) return { status: 400, loi: 'Thiếu/sai Content-Range' }
    const tong = m[4] === '*' ? phien.size : Number(m[4])
    if (tong !== phien.size) return { status: 400, loi: `Tổng ${tong} khác cỡ đã khai ${phien.size}` }
    if (m[1] === '*') return { status: daCo === tong ? 200 : 308, range: rangeHienCo }
    const a = Number(m[2]), b = Number(m[3])
    if (a !== daCo || b - a + 1 !== than.length || b >= tong) return { status: 308, range: rangeHienCo }
    fs.appendFileSync(`${p}.part`, than)
    const moi = daCo + than.length
    if (moi < tong) return { status: 308, range: `bytes=0-${moi - 1}` }
    const md5 = crypto.createHash('md5')
    for await (const c of fs.createReadStream(`${p}.part`)) md5.update(c as Buffer)
    fs.renameSync(`${p}.part`, p)
    fs.writeFileSync(`${p}.meta.json`, JSON.stringify({ contentType: phien.contentType, size: tong, md5: md5.digest('hex') }))
    return { status: 200 }
}

// ─── Bảng: tự vá lười theo schema ────────────────────────────────────────────
/*
 * Các dòng dưới đây CŨNG được viết THẲNG trong /admin/migrate (routes/admin.ts) — bộ soát
 * `npm run check:migrate` quét admin.ts tìm từng cột. Ở đây là lưới an toàn: code Vault lên trước khi ai đó
 * gọi /admin/migrate thì lượt gọi đầu tiên của mỗi cửa hàng tự thêm cột, không 500 (P2022) như các vụ cũ.
 */
export const DDL_VAULT: string[] = [
    `CREATE TABLE IF NOT EXISTS "{s}"."StorageFile" ("id" TEXT NOT NULL, "name" TEXT NOT NULL, "url" TEXT NOT NULL, "size" INTEGER NOT NULL, "type" TEXT NOT NULL, "category" TEXT NOT NULL, "referenceId" TEXT, "referenceName" TEXT, "description" TEXT, "uploadedBy" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "StorageFile_pkey" PRIMARY KEY ("id"))`,
    `ALTER TABLE "{s}"."StorageFile" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'ready'`,
    `ALTER TABLE "{s}"."StorageFile" ADD COLUMN IF NOT EXISTS "objectKey" TEXT`,
    `ALTER TABLE "{s}"."StorageFile" ADD COLUMN IF NOT EXISTS "thumbKey" TEXT`,
    `ALTER TABLE "{s}"."StorageFile" ADD COLUMN IF NOT EXISTS "folderId" TEXT`,
    `ALTER TABLE "{s}"."StorageFile" ADD COLUMN IF NOT EXISTS "tags" TEXT[] DEFAULT ARRAY[]::TEXT[]`,
    `ALTER TABLE "{s}"."StorageFile" ADD COLUMN IF NOT EXISTS "referenceType" TEXT`,
    `ALTER TABLE "{s}"."StorageFile" ADD COLUMN IF NOT EXISTS "md5" TEXT`,
    `ALTER TABLE "{s}"."StorageFile" ADD COLUMN IF NOT EXISTS "pinned" BOOLEAN NOT NULL DEFAULT false`,
    `ALTER TABLE "{s}"."StorageFile" ADD COLUMN IF NOT EXISTS "expiresAt" TIMESTAMP(3)`,
    `ALTER TABLE "{s}"."StorageFile" ADD COLUMN IF NOT EXISTS "remindDays" INTEGER`,
    `ALTER TABLE "{s}"."StorageFile" ADD COLUMN IF NOT EXISTS "reminded" TEXT`,
    `ALTER TABLE "{s}"."StorageFile" ADD COLUMN IF NOT EXISTS "aiStatus" TEXT`,
    `ALTER TABLE "{s}"."StorageFile" ADD COLUMN IF NOT EXISTS "aiData" JSONB`,
    `ALTER TABLE "{s}"."StorageFile" ADD COLUMN IF NOT EXISTS "aiText" TEXT`,
    `ALTER TABLE "{s}"."StorageFile" ADD COLUMN IF NOT EXISTS "aiError" TEXT`,
    `ALTER TABLE "{s}"."StorageFile" ADD COLUMN IF NOT EXISTS "aiAt" TIMESTAMP(3)`,
    `ALTER TABLE "{s}"."StorageFile" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1`,
    `ALTER TABLE "{s}"."StorageFile" ADD COLUMN IF NOT EXISTS "versionOf" TEXT`,
    `ALTER TABLE "{s}"."StorageFile" ADD COLUMN IF NOT EXISTS "uploaderId" TEXT`,
    `ALTER TABLE "{s}"."StorageFile" ADD COLUMN IF NOT EXISTS "updatedBy" TEXT`,
    `ALTER TABLE "{s}"."StorageFile" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3)`,
    `ALTER TABLE "{s}"."StorageFile" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT`,
    `CREATE INDEX IF NOT EXISTS "StorageFile_category_idx" ON "{s}"."StorageFile"("category")`,
    `CREATE INDEX IF NOT EXISTS "StorageFile_referenceId_idx" ON "{s}"."StorageFile"("referenceId")`,
    `CREATE INDEX IF NOT EXISTS "StorageFile_status_idx" ON "{s}"."StorageFile"("status")`,
    `CREATE INDEX IF NOT EXISTS "StorageFile_folderId_idx" ON "{s}"."StorageFile"("folderId")`,
    `CREATE INDEX IF NOT EXISTS "StorageFile_referenceType_referenceId_idx" ON "{s}"."StorageFile"("referenceType", "referenceId")`,
    `CREATE INDEX IF NOT EXISTS "StorageFile_expiresAt_idx" ON "{s}"."StorageFile"("expiresAt")`,
    `CREATE INDEX IF NOT EXISTS "StorageFile_md5_idx" ON "{s}"."StorageFile"("md5")`,
    `CREATE INDEX IF NOT EXISTS "StorageFile_versionOf_idx" ON "{s}"."StorageFile"("versionOf")`,
    `CREATE TABLE IF NOT EXISTS "{s}"."StorageFolder" ("id" TEXT NOT NULL, "name" TEXT NOT NULL, "parentId" TEXT, "color" TEXT, "createdBy" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "StorageFolder_pkey" PRIMARY KEY ("id"))`,
    `CREATE INDEX IF NOT EXISTS "StorageFolder_parentId_idx" ON "{s}"."StorageFolder"("parentId")`,
    `CREATE TABLE IF NOT EXISTS "{s}"."StorageActivity" ("id" TEXT NOT NULL, "fileId" TEXT, "action" TEXT NOT NULL, "actor" TEXT NOT NULL, "actorId" TEXT, "detail" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "StorageActivity_pkey" PRIMARY KEY ("id"))`,
    `CREATE INDEX IF NOT EXISTS "StorageActivity_fileId_idx" ON "{s}"."StorageActivity"("fileId")`,
    `CREATE INDEX IF NOT EXISTS "StorageActivity_createdAt_idx" ON "{s}"."StorageActivity"("createdAt")`,
    `CREATE TABLE IF NOT EXISTS "{s}"."StorageShare" ("id" TEXT NOT NULL, "fileId" TEXT NOT NULL, "createdBy" TEXT NOT NULL, "note" TEXT, "expiresAt" TIMESTAMP(3) NOT NULL, "maxViews" INTEGER, "views" INTEGER NOT NULL DEFAULT 0, "revokedAt" TIMESTAMP(3), "lastViewAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "StorageShare_pkey" PRIMARY KEY ("id"))`,
    `CREATE INDEX IF NOT EXISTS "StorageShare_fileId_idx" ON "{s}"."StorageShare"("fileId")`,
    `CREATE TABLE IF NOT EXISTS "{s}"."StorageConfig" ("key" TEXT NOT NULL, "value" TEXT NOT NULL, "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "StorageConfig_pkey" PRIMARY KEY ("key"))`,
]
/** Cột cuối cùng thêm vào — có nó là coi như đủ bộ (một câu hỏi thay vì 40 câu DDL mỗi lần khởi động) */
const COT_MOC = ['deletedBy', 'versionOf', 'aiText']

const daVa = new Map<string, Promise<void>>()
export function damBaoBangVault(prisma: any, schema: string): Promise<void> {
    kiemSchema(schema)
    let p = daVa.get(schema)
    if (!p) {
        p = (async () => {
            const co: any[] = await prisma.$queryRawUnsafe(
                `SELECT (SELECT count(*)::int FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'StorageFile' AND column_name = ANY($2::text[])) AS cot,
                        (SELECT count(*)::int FROM information_schema.tables WHERE table_schema = $1 AND table_name IN ('StorageFolder','StorageActivity','StorageShare','StorageConfig')) AS bang`,
                schema, COT_MOC)
            if (co[0]?.cot === COT_MOC.length && co[0]?.bang === 4) return
            for (const cau of DDL_VAULT) await prisma.$executeRawUnsafe(cau.replace(/\{s\}/g, schema))
            console.log(`🗄️ Kengi Vault: đã vá bảng cho ${schema}`)
        })().catch((e) => { daVa.delete(schema); throw e })
        daVa.set(schema, p)
    }
    return p
}
