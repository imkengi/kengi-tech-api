/**
 * P-SIGN — ký tài liệu PDF bằng CHỮ KÝ SỐ TỪ XA của MISA eSign (11/11/2026, chủ shop: "làm kengi.vn/p-sign để làm chỗ ký tài
 * liệu bằng chữ ký số"). Tài liệu đọc 11/11/2026: developer.misa.vn/products-openapi/ESIGN (bản JSON:
 * developer.misa.vn/backend/api/products/docs/ESIGN), V1.0.0.
 *
 * Luồng của MISA (RemoteSigning):
 *   1. Đăng nhập   POST /auth/login-api {userName, password}  (+ /auth/two-factor-auth khi MISA đòi OTP — mã 122)
 *                  ⇒ remoteSigningAccessToken (header AuthorizationRM: Bearer …) + refreshToken
 *   2. Chứng thư   GET  /certificates/by-userId  ⇒ chọn chứng thư keyStatus = ACTIVE
 *   3. Băm         POST /documents/hash  {certificate, certificateChain, pdfDocs:[{documentId, FileToSign, signatureInfo}]}
 *   4. Ký          POST /signing/hash    {UserId, CertAlias, Documents:[{DocumentId, FileToSign = digest, DocumentName}]}
 *                  ⇒ NGƯỜI KÝ mở app MISA eSign trên điện thoại bấm xác nhận, phiên ký sống 120 giây
 *   5. Trạng thái  GET  /signing/status/{transactionId}  ⇒ PENDING | SUCCESS | FAILED (+ signatures)
 *   6. Gắn         POST /documents/attachment  ⇒ tệp PDF đã có chữ ký số
 * Mọi lời gọi: header ClientID + ClientSecret (MISA cấp cho gói ESIGN trên developer.misa.vn).
 *
 * Lưu gì:
 *   "PSignKetNoi"  ClientID + ClientSecret (mã hoá) — của CỬA HÀNG, người có quyền einvoice.config nhập.
 *   "PSignPhien"   phiên eSign của TỪNG NGƯỜI DÙNG Kengi (tài khoản eSign là của một người, ký phải bấm trên điện thoại người đó):
 *                  token + refreshToken (mã hoá). KHÔNG lưu mật khẩu eSign.
 *   "PSignNhatKy"  ai ký tệp tên gì, lúc nào, bằng chứng thư nào, kết cục. KHÔNG lưu nội dung tệp — tệp chỉ đi qua RAM.
 * Giữa bước Ký và bước Gắn, dữ liệu băm do TRÌNH DUYỆT giữ rồi gửi lại (prod nhiều bản máy, không có Redis ⇒ không nhớ trong RAM;
 * sửa dữ liệu đó chỉ làm chữ ký không khớp, không ký được thứ khác).
 *
 * ⚠ CHƯA ĐO VỚI MISA THẬT (11/11/2026 — chưa có ClientID gói ESIGN): hình trả về của chứng thư / băm / gắn, mã lỗi khi người ký
 * từ chối, gốc toạ độ ô chữ ký (đang coi là góc DƯỚI-TRÁI trang, đơn vị point như PDF). Đọc trường kiểu dò nhiều tên (docTruong);
 * hình lạ ⇒ báo "MISA trả dữ liệu Kengi chưa đọc được" kèm tên trường, KHÔNG đoán.
 * Đã đo (không cần tài khoản): cổng https://developer.misa.vn/apis/esign/v1, thiếu ClientID ⇒ 401 {Success:false, Error, DescriptionError}.
 */

import crypto from 'crypto'
import { maHoa, giaiMa, coKhoaVault } from './maHoaKhoa'
import { tenSchema } from './zaloKengi'
import { docTruong, moChuoiJson } from './meInvoice'

export const CONG = 'https://developer.misa.vn/apis/esign/v1'
const BANG_KN = '"PSignKetNoi"'
const BANG_PHIEN = '"PSignPhien"'
const BANG_NK = '"PSignNhatKy"'
const ID = 'mac-dinh'
const HAN_GOI_MS = 25_000
/** Băm / gắn chở cả tệp ⇒ cho lâu hơn */
const HAN_GOI_TEP_MS = 90_000
/** Tệp PDF tối đa. Thân JSON của máy chủ trần 10 MB (index.ts), base64 phình 4/3 và bước Gắn gửi lại dữ liệu băm ~ cỡ tệp. */
export const PDF_TOI_DA = 5 * 1024 * 1024
/** Phiên ký của MISA sống 120 giây (tài liệu) */
export const HAN_KY_GIAY = 120
/** MISA đòi xác thực 2 lớp (tài liệu, mục Xác thực) */
const MA_CAN_OTP = 122

export class LoiPSign extends Error {
    constructor(msg: string, public readonly httpStatus?: number, public readonly ma?: string) {
        super(msg)
        this.name = 'LoiPSign'
    }
}

// ─── Đọc trả về của MISA eSign ────────────────────────────────────────────────

export interface TraVe { ok: boolean; data: any; loi: string; maLoi: number | string | null }

const chuoi = (v: any): string => (v === undefined || v === null ? '' : String(v).trim())

/**
 * Chuẩn hoá thân trả về. Hai hình đã biết:
 *   cổng (gateway)   {Success|success:false, Error|error, DescriptionError|descriptionError}
 *   eSign            {status:{type, code, error, errorCode, userMsg, devMsg, message}, data:{…}}
 * Không có khối `status` mà HTTP 2xx ⇒ coi cả thân là dữ liệu.
 */
export function docTraVe(status: number, json: any, text: string): TraVe {
    const http2xx = status >= 200 && status < 300
    if (json && typeof json === 'object' && !Array.isArray(json)) {
        const st = docTruong(json, 'status')
        const cong = docTruong(json, 'Success', 'success')
        const phan: string[] = []
        const them = (v: any) => { const s = chuoi(v); if (s && !phan.includes(s)) phan.push(s) }
        let loiTrongThan = false
        let maLoi: number | string | null = null
        if (st && typeof st === 'object') {
            const e = docTruong(st, 'error')
            const kieu = chuoi(docTruong(st, 'type')).toLowerCase()
            maLoi = docTruong(st, 'errorCode') ?? null
            loiTrongThan = e === true || e === 'true' || kieu === 'fail' || kieu === 'error'
            if (loiTrongThan) { them(docTruong(st, 'userMsg')); them(docTruong(st, 'message')); them(docTruong(st, 'devMsg')); if (maLoi !== null && maLoi !== '') them(`mã ${maLoi}`) }
        }
        if (cong === false || cong === 'false') {
            loiTrongThan = true
            maLoi = maLoi ?? chuoi(docTruong(json, 'Error', 'error', 'errorCode')) ?? null
            them(docTruong(json, 'DescriptionError', 'descriptionError', 'errorDescription', 'userMsg', 'message'))
            them(docTruong(json, 'Error', 'error', 'errorCode'))
        }
        if (!http2xx && !phan.length) {
            them(docTruong(json, 'userMsg', 'message', 'Message', 'errorDescription', 'devMsg', 'title'))
            them(docTruong(json, 'errorCode', 'Error', 'error'))
        }
        const ok = http2xx && !loiTrongThan
        const coData = Object.prototype.hasOwnProperty.call(json, 'data') || Object.prototype.hasOwnProperty.call(json, 'Data')
        const data = coData ? moChuoiJson(docTruong(json, 'data', 'Data')) : json
        return { ok, data, loi: ok ? '' : (phan.join(' — ').slice(0, 400) || `HTTP ${status}`), maLoi }
    }
    if (http2xx && Array.isArray(json)) return { ok: true, data: json, loi: '', maLoi: null }
    return { ok: false, data: null, loi: chuoi(text).slice(0, 300) || `HTTP ${status}`, maLoi: null }
}

/** Tên các trường của một giá trị — để báo "chưa đọc được" mà không lộ nội dung */
export function moTaHinh(d: any): string {
    if (d === null || d === undefined) return 'rỗng'
    if (Array.isArray(d)) return `mảng ${d.length}${d[0] && typeof d[0] === 'object' ? ` {${Object.keys(d[0]).slice(0, 12).join(', ')}}` : ''}`
    if (typeof d === 'object') return `object {${Object.keys(d).slice(0, 14).join(', ')}}`
    return typeof d
}

export interface KetQuaDangNhap {
    /** Có token ⇒ đã vào */
    token: string
    refreshToken: string
    songMs: number | null
    misaUserId: string
    ten: string
    /** MISA đòi OTP */
    canOtp: boolean
    /** Kênh OTP mặc định MISA báo */
    kenhOtp: { email: boolean; sdt: boolean; ungDung: boolean }
}

/** Đọc trả về của login / two-factor / refresh. Không token + (mã 122 hoặc có khối `default`) ⇒ cần OTP. */
export function docDangNhap(tv: TraVe): KetQuaDangNhap {
    const d = tv.data && typeof tv.data === 'object' ? tv.data : {}
    const token = chuoi(docTruong(d, 'remoteSigningAccessToken'))
    const u = docTruong(d, 'user') || {}
    const md = docTruong(d, 'default') || {}
    const giay = Number(docTruong(d, 'expiresIn', 'expires_in'))
    const kenhOtp = { email: docTruong(md, 'email') === true, sdt: docTruong(md, 'phoneNumber') === true, ungDung: docTruong(md, 'appAuthenticator') === true }
    const canOtp = !token && (Number(tv.maLoi) === MA_CAN_OTP || kenhOtp.email || kenhOtp.sdt || kenhOtp.ungDung)
    return {
        token,
        refreshToken: chuoi(docTruong(d, 'refreshToken')),
        songMs: Number.isFinite(giay) && giay > 0 ? giay * 1000 : null,
        misaUserId: chuoi(docTruong(u, 'id')),
        ten: [chuoi(docTruong(u, 'firstName')), chuoi(docTruong(u, 'lastName'))].filter(Boolean).join(' ') || chuoi(docTruong(u, 'username', 'email')),
        canOtp,
        kenhOtp,
    }
}

// ─── Chứng thư số ─────────────────────────────────────────────────────────────

export interface ChungThu {
    keyAlias: string
    misaUserId: string
    /** ACTIVE | INACTIVE | … (nguyên văn MISA) */
    trangThai: string
    /** Tên chủ thể (CN) — đọc từ chính chứng thư; không đọc được ⇒ '' */
    chuThe: string
    toChuc: string
    mst: string
    soSeri: string
    hieuLucTu: string | null
    hieuLucDen: string | null
    /** Dùng được để ký: ACTIVE và còn hạn */
    dungDuoc: boolean
    lyDoKhongDung: string
}
export interface ChungThuDayDu extends ChungThu { certificate: string; chain: string[] }

/** Tách một thuộc tính trong chuỗi subject của Node ("CN=…\nO=…") */
function thuocTinh(subject: string, ten: string): string {
    for (const dong of String(subject || '').split(/\n/)) {
        const i = dong.indexOf('=')
        if (i > 0 && dong.slice(0, i).trim().toUpperCase() === ten.toUpperCase()) return dong.slice(i + 1).trim()
    }
    return ''
}

/** Đọc một chứng thư MISA trả về. Trường `certiticateChain` viết sai chính tả NGAY TRONG tài liệu MISA ⇒ dò cả hai. */
export function docChungThu(raw: any, bayGio = Date.now()): ChungThuDayDu {
    const certificate = chuoi(docTruong(raw, 'certificate', 'Certificate')).replace(/\s+/g, '')
    const ch = docTruong(raw, 'certiticateChain', 'certificateChain', 'CertificateChain')
    const chain = Array.isArray(ch) ? ch.map((x: any) => chuoi(x).replace(/\s+/g, '')).filter(Boolean) : []
    const trangThai = chuoi(docTruong(raw, 'keyStatus', 'KeyStatus'))
    let chuThe = '', toChuc = '', mst = '', soSeri = '', tu: string | null = null, den: string | null = null, docDuoc = false
    if (certificate) {
        try {
            const x = new crypto.X509Certificate(Buffer.from(certificate, 'base64'))
            chuThe = thuocTinh(x.subject, 'CN')
            toChuc = thuocTinh(x.subject, 'O')
            // MST nằm ở UID / OID 0.9.2342.19200300.100.1.1 dạng "MST:0123456789" (chứng thư công cộng VN)
            const uid = thuocTinh(x.subject, 'UID') || thuocTinh(x.subject, '0.9.2342.19200300.100.1.1')
            mst = (uid.match(/MST\s*:\s*([0-9-]+)/i)?.[1] || '')
            soSeri = x.serialNumber
            tu = new Date(x.validFrom).toISOString()
            den = new Date(x.validTo).toISOString()
            docDuoc = true
        } catch { /* chứng thư không phân tích được ⇒ vẫn liệt kê, chỉ thiếu tên */ }
    }
    let lyDo = ''
    if (!certificate) lyDo = 'MISA không trả nội dung chứng thư'
    else if (trangThai.toUpperCase() !== 'ACTIVE') lyDo = `Chứng thư đang ở trạng thái ${trangThai || 'không rõ'}`
    else if (docDuoc && den && Date.parse(den) < bayGio) lyDo = 'Chứng thư đã hết hạn'
    else if (docDuoc && tu && Date.parse(tu) > bayGio) lyDo = 'Chứng thư chưa tới ngày hiệu lực'
    return {
        keyAlias: chuoi(docTruong(raw, 'keyAlias', 'KeyAlias', 'certAlias')),
        misaUserId: chuoi(docTruong(raw, 'userId', 'UserId')),
        trangThai, chuThe, toChuc, mst, soSeri, hieuLucTu: tu, hieuLucDen: den,
        dungDuoc: !lyDo, lyDoKhongDung: lyDo,
        certificate, chain,
    }
}

/** Danh sách chứng thư: mảng ở gốc, hoặc dưới certificates / items / data */
export function tachDsChungThu(data: any): { ds: any[]; docDuoc: boolean } {
    const d = moChuoiJson(data)
    if (Array.isArray(d)) return { ds: d, docDuoc: true }
    if (d && typeof d === 'object') {
        const m = moChuoiJson(docTruong(d, 'certificates', 'Certificates', 'items', 'Items', 'data', 'Data'))
        if (Array.isArray(m)) return { ds: m, docDuoc: true }
        // một chứng thư đơn lẻ
        if (docTruong(d, 'keyAlias', 'KeyAlias')) return { ds: [d], docDuoc: true }
    }
    return { ds: [], docDuoc: false }
}

/** Bỏ nội dung chứng thư trước khi trả trình duyệt (không bí mật nhưng nặng, và trình duyệt không cần) */
export const chungThuGon = (c: ChungThuDayDu): ChungThu => {
    const { certificate: _c, chain: _ch, ...gon } = c
    return gon
}

// ─── Ô chữ ký + thân băm ──────────────────────────────────────────────────────

export interface ViTriKy { trang: number; x: number; y: number; rong: number; cao: number }
export interface HienThiKy { nguoiKy: string; noiKy: string; lyDo: string; lienHe: string; hienNgay: boolean; anhChuKy?: string }

const nguyen = (v: any) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : NaN)

/** Kiểm ô chữ ký (đơn vị point của PDF). Trả lỗi đọc được, hoặc ô đã làm tròn. */
export function kiemViTri(v: any): ViTriKy {
    const o: ViTriKy = { trang: nguyen(v?.trang), x: nguyen(v?.x), y: nguyen(v?.y), rong: nguyen(v?.rong), cao: nguyen(v?.cao) }
    if (!(o.trang >= 1 && o.trang <= 2000)) throw new LoiPSign('Trang đặt chữ ký không hợp lệ.')
    if (!(o.x >= 0 && o.x <= 14400) || !(o.y >= 0 && o.y <= 14400)) throw new LoiPSign('Vị trí chữ ký nằm ngoài trang.')
    if (!(o.rong >= 40 && o.rong <= 1200) || !(o.cao >= 20 && o.cao <= 1200)) throw new LoiPSign('Ô chữ ký quá nhỏ hoặc quá lớn (rộng 40–1200, cao 20–1200 point).')
    return o
}

const cat = (v: any, n: number) => chuoi(v).replace(/[\u0000-\u001f]/g, ' ').slice(0, n)

/** dd/MM/yyyy HH:mm:ss theo giờ Việt Nam */
export function gioKyVN(ms: number): string {
    const d = new Date(ms + 7 * 3600_000)
    const hai = (n: number) => String(n).padStart(2, '0')
    return `${hai(d.getUTCDate())}/${hai(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${hai(d.getUTCHours())}:${hai(d.getUTCMinutes())}:${hai(d.getUTCSeconds())}`
}

/**
 * Các dòng chữ trên chữ ký (chủ shop 11/11/2026: "sao chữ ký có mỗi như này" — ô chỉ có tên): Ký bởi / Ngày ký / Lý do / Nơi ký /
 * Liên hệ. FE vẽ khung xem trước bằng ĐÚNG luật này (p-sign/kieu.ts dongChuKy) — sửa một bên phải sửa bên kia.
 */
export function dongChuKy(ht: HienThiKy, bayGio: number): string[] {
    const d = [`Ký bởi: ${cat(ht.nguoiKy, 120)}`]
    if (ht.hienNgay !== false) d.push(`Ngày ký: ${gioKyVN(bayGio)}`)
    if (cat(ht.lyDo, 160)) d.push(`Lý do: ${cat(ht.lyDo, 160)}`)
    if (cat(ht.noiKy, 80)) d.push(`Nơi ký: ${cat(ht.noiKy, 80)}`)
    if (cat(ht.lienHe, 80)) d.push(`Liên hệ: ${cat(ht.lienHe, 80)}`)
    return d
}

/** Thân POST /documents/hash — đúng tên trường của ví dụ trong tài liệu MISA */
export function thanBam(ct: ChungThuDayDu, documentId: string, pdfBase64: string, viTri: ViTriKy, ht: HienThiKy, bayGio = Date.now()) {
    const coAnh = !!ht.anhChuKy
    return {
        certificate: ct.certificate,
        certificateChain: ct.chain,
        pdfDocs: [{
            documentId,
            FileToSign: pdfBase64,
            signatureInfo: {
                textColor: 0,
                // 0 chỉ diễn giải · 1 diễn giải + ảnh · 2 chỉ ảnh
                renderingMode: coAnh ? 1 : 0,
                positionX: viTri.x,
                positionY: viTri.y,
                width: viTri.rong,
                height: viTri.cao,
                fontSize: 8,
                signatureImage: coAnh ? ht.anhChuKy : '',
                fontData: '',
                hashAlgorithm: 'SHA256',
                signatureDescription: {
                    signedBy: cat(ht.nguoiKy, 120),
                    // ngày ký đã nằm trong displayText ⇒ tắt dòng ngày của MISA kẻo hiện hai lần
                    showSignedDate: false,
                    location: cat(ht.noiKy, 80),
                    reason: cat(ht.lyDo, 160),
                    contact: cat(ht.lienHe, 80),
                    // "Thông tin ký tự custom, xuống dòng bằng ký tự \n" (tài liệu MISA, mục SignatureDescription)
                    displayText: dongChuKy(ht, bayGio).join('\n'),
                },
                page: viTri.trang,
                // tên trường chữ ký trong PDF — phải khác nhau giữa các lần ký cùng một tệp
                signatureName: `kengi${Date.now().toString(36)}`,
            },
        }],
    }
}

/** Lấy tài liệu PDF đã băm từ trả về của /documents/hash — phải có digest để ký */
export function docKetQuaBam(data: any): any | null {
    const d = moChuoiJson(data)
    if (!d || typeof d !== 'object') return null
    const m = moChuoiJson(docTruong(d, 'pdfDocs', 'PdfDocs'))
    const doc = Array.isArray(m) ? m[0] : null
    if (!doc || typeof doc !== 'object' || !chuoi(docTruong(doc, 'digest'))) return null
    return doc
}

/** Thân POST /signing/hash */
export function thanKy(misaUserId: string, certAlias: string, docBam: any, tenTep: string, loiNhan: string) {
    return {
        DataToBeDisplayed: cat(loiNhan, 200),
        UserId: misaUserId,
        CertAlias: certAlias,
        Documents: [{
            DocumentId: chuoi(docTruong(docBam, 'documentId')).slice(0, 36),
            FileToSign: chuoi(docTruong(docBam, 'digest')),
            DocumentName: cat(tenTep, 100),
        }],
    }
}

export interface TrangThaiKy { trangThai: 'cho' | 'xong' | 'loi'; maLoi: string; moTa: string; chuKy: { documentId: string; signature: string }[] }

/** Đọc GET /signing/status. Trạng thái lạ ⇒ 'cho' KHÔNG được: coi là lỗi đọc để người dùng thấy, không quay mãi. */
export function docTrangThaiKy(data: any): TrangThaiKy | null {
    const d = moChuoiJson(data)
    if (!d || typeof d !== 'object') return null
    const s = chuoi(docTruong(d, 'status', 'Status')).toUpperCase()
    const ck = moChuoiJson(docTruong(d, 'signatures', 'Signatures'))
    const chuKy = (Array.isArray(ck) ? ck : []).map((x: any) => ({ documentId: chuoi(docTruong(x, 'documentId')), signature: chuoi(docTruong(x, 'signature')) })).filter(x => x.signature)
    const maLoi = chuoi(docTruong(d, 'errorCode', 'ErrorCode'))
    const moTa = chuoi(docTruong(d, 'errorDescription', 'ErrorDescription', 'userMsg', 'devMsg'))
    if (s === 'PENDING') return { trangThai: 'cho', maLoi, moTa, chuKy: [] }
    if (s === 'SUCCESS') return { trangThai: 'xong', maLoi, moTa, chuKy }
    if (s === 'FAILED') return { trangThai: 'loi', maLoi, moTa, chuKy: [] }
    return null
}

/** Thân POST /documents/attachment: nguyên tài liệu đã băm (documentBytes, digest, sh, documentHash, signatureName…) + chữ ký */
export function thanGan(ct: ChungThuDayDu, docBam: any, signature: string) {
    return { pdfDocs: [{ ...docBam, signature }], certificate: ct.certificate, CertificateChain: ct.chain }
}

/** Tệp đã gắn chữ ký (base64) từ trả về của /documents/attachment */
export function docTepDaKy(data: any): string {
    const d = moChuoiJson(data)
    if (!d || typeof d !== 'object') return ''
    const m = moChuoiJson(docTruong(d, 'pdfDocs', 'PdfDocs'))
    const doc = Array.isArray(m) ? m[0] : null
    return chuoi(docTruong(doc, 'document', 'Document')).replace(/\s+/g, '')
}

/** base64 có phải PDF không (4 byte đầu %PDF) + cỡ thật */
export function kiemPdf(b64: any): { b64: string; bytes: number } {
    const s = typeof b64 === 'string' ? b64.replace(/^data:[^,]*,/, '').replace(/\s+/g, '') : ''
    if (!s || !/^[A-Za-z0-9+/]+={0,2}$/.test(s)) throw new LoiPSign('Tệp gửi lên không đọc được.')
    const bytes = Math.floor(s.length * 3 / 4) - (s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0)
    if (bytes > PDF_TOI_DA) throw new LoiPSign(`Tệp nặng ${(bytes / 1048576).toFixed(1)} MB — P-Sign nhận tối đa ${PDF_TOI_DA / 1048576} MB.`)
    if (Buffer.from(s.slice(0, 8), 'base64').toString('latin1').slice(0, 4) !== '%PDF') throw new LoiPSign('Tệp không phải PDF. P-Sign hiện chỉ ký tệp PDF.')
    return { b64: s, bytes }
}

// ─── Bảng (tạo lười — cùng nếp lib/meInvoice.ts) ──────────────────────────────

const daTaoBang = new Set<string>()

async function damBaoBang(sp: any): Promise<void> {
    const schema = await tenSchema(sp)
    if (daTaoBang.has(schema)) return
    const tao = async (sql: string) => {
        try { await sp.$executeRawUnsafe(sql) } catch (e: any) {
            if (!/already exists|duplicate key value/i.test(String(e?.message || ''))) throw e
        }
    }
    await tao(`CREATE TABLE IF NOT EXISTS ${BANG_KN} (
        "id" TEXT PRIMARY KEY, "clientId" TEXT NOT NULL, "clientSecret" TEXT NOT NULL, "nguoiLuu" TEXT, "capNhatLuc" BIGINT NOT NULL
    )`)
    await tao(`CREATE TABLE IF NOT EXISTS ${BANG_PHIEN} (
        "userId" TEXT PRIMARY KEY, "taiKhoan" TEXT NOT NULL, "misaUserId" TEXT, "ten" TEXT,
        "token" TEXT, "refreshToken" TEXT, "han" BIGINT, "capNhatLuc" BIGINT NOT NULL
    )`)
    await tao(`CREATE TABLE IF NOT EXISTS ${BANG_NK} (
        "id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL, "nguoi" TEXT, "taiKhoan" TEXT, "tenTep" TEXT NOT NULL, "kichThuoc" INTEGER,
        "certAlias" TEXT, "chuThe" TEXT, "transactionId" TEXT, "trangThai" TEXT NOT NULL, "loi" TEXT, "taoLuc" BIGINT NOT NULL, "xongLuc" BIGINT
    )`)
    await tao(`CREATE INDEX IF NOT EXISTS "PSignNhatKy_taoLuc_idx" ON ${BANG_NK} ("taoLuc" DESC)`)
    daTaoBang.add(schema)
}

export interface KetNoi { clientId: string; clientSecret: string; nguoiLuu: string | null; capNhatLuc: number }

export async function docKetNoi(sp: any): Promise<KetNoi | null> {
    await damBaoBang(sp)
    const r: any[] = await sp.$queryRawUnsafe(`SELECT * FROM ${BANG_KN} WHERE "id" = $1`, ID)
    if (!r[0]) return null
    // giải không được (khoá vault đổi) ⇒ NÉM, không giả "chưa kết nối"
    return { clientId: String(r[0].clientId), clientSecret: giaiMa(String(r[0].clientSecret)), nguoiLuu: r[0].nguoiLuu || null, capNhatLuc: Number(r[0].capNhatLuc) }
}

/** Che ClientID: chỉ hiện 6 ký tự đầu + 4 cuối */
export const cheMa = (s: string) => (s.length <= 12 ? s.slice(0, 3) + '…' : `${s.slice(0, 6)}…${s.slice(-4)}`)

export async function luuKetNoi(sp: any, b: { clientId?: any; clientSecret?: any }, nguoi: string): Promise<void> {
    if (!coKhoaVault()) throw new LoiPSign('Máy chủ chưa có khoá mã hoá (MARKETING_VAULT_KEY) — không lưu được Client Secret.')
    await damBaoBang(sp)
    const cu: any = ((await sp.$queryRawUnsafe(`SELECT * FROM ${BANG_KN} WHERE "id" = $1`, ID)) as any[])[0] || null
    const clientId = chuoi(b.clientId) || (cu ? String(cu.clientId) : '')
    const secretMoi = chuoi(b.clientSecret)
    if (!clientId) throw new LoiPSign('Chưa nhập Client ID.')
    if (clientId.length > 200 || secretMoi.length > 400) throw new LoiPSign('Client ID / Client Secret dài bất thường.')
    if (!secretMoi && !cu) throw new LoiPSign('Chưa nhập Client Secret.')
    const secret = secretMoi ? maHoa(secretMoi) : String(cu.clientSecret)
    await sp.$executeRawUnsafe(
        `INSERT INTO ${BANG_KN} ("id","clientId","clientSecret","nguoiLuu","capNhatLuc") VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT ("id") DO UPDATE SET "clientId" = EXCLUDED."clientId", "clientSecret" = EXCLUDED."clientSecret", "nguoiLuu" = EXCLUDED."nguoiLuu", "capNhatLuc" = EXCLUDED."capNhatLuc"`,
        ID, clientId, secret, nguoi.slice(0, 120), Date.now())
    // đổi ClientID ⇒ token cũ thuộc ứng dụng khác: xoá mọi phiên
    if (cu && String(cu.clientId) !== clientId) await sp.$executeRawUnsafe(`DELETE FROM ${BANG_PHIEN}`)
}

export async function xoaKetNoi(sp: any): Promise<boolean> {
    await damBaoBang(sp)
    await sp.$executeRawUnsafe(`DELETE FROM ${BANG_PHIEN}`)
    return (await sp.$executeRawUnsafe(`DELETE FROM ${BANG_KN} WHERE "id" = $1`, ID)) > 0
}

export interface Phien { userId: string; taiKhoan: string; misaUserId: string; ten: string; token: string; refreshToken: string; han: number | null }

export async function docPhien(sp: any, userId: string): Promise<Phien | null> {
    await damBaoBang(sp)
    const r: any[] = await sp.$queryRawUnsafe(`SELECT * FROM ${BANG_PHIEN} WHERE "userId" = $1`, userId)
    const d = r[0]
    if (!d || !d.token) return null
    // phiên giải không được thì chỉ cần đăng nhập lại ⇒ coi như chưa đăng nhập (khác kết nối: ở đó mất bí mật phải nói)
    try {
        return {
            userId, taiKhoan: String(d.taiKhoan), misaUserId: chuoi(d.misaUserId), ten: chuoi(d.ten),
            token: giaiMa(String(d.token)), refreshToken: d.refreshToken ? giaiMa(String(d.refreshToken)) : '', han: d.han === null ? null : Number(d.han),
        }
    } catch { return null }
}

async function luuPhien(sp: any, userId: string, taiKhoan: string, k: KetQuaDangNhap, cu?: Phien | null): Promise<void> {
    await damBaoBang(sp)
    const bayGio = Date.now()
    await sp.$executeRawUnsafe(
        `INSERT INTO ${BANG_PHIEN} ("userId","taiKhoan","misaUserId","ten","token","refreshToken","han","capNhatLuc") VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT ("userId") DO UPDATE SET "taiKhoan" = EXCLUDED."taiKhoan", "misaUserId" = EXCLUDED."misaUserId", "ten" = EXCLUDED."ten",
            "token" = EXCLUDED."token", "refreshToken" = EXCLUDED."refreshToken", "han" = EXCLUDED."han", "capNhatLuc" = EXCLUDED."capNhatLuc"`,
        userId, taiKhoan.slice(0, 200), k.misaUserId || cu?.misaUserId || null, (k.ten || cu?.ten || '').slice(0, 200),
        maHoa(k.token), (k.refreshToken || cu?.refreshToken) ? maHoa(k.refreshToken || cu!.refreshToken) : null, k.songMs ? bayGio + k.songMs : null, bayGio)
}

export async function xoaPhien(sp: any, userId: string): Promise<void> {
    await damBaoBang(sp)
    await sp.$executeRawUnsafe(`DELETE FROM ${BANG_PHIEN} WHERE "userId" = $1`, userId)
}

// ─── Gọi MISA ─────────────────────────────────────────────────────────────────

interface KetQuaHttp { status: number; json: any; text: string }

async function goiHttp(duong: string, method: string, headers: Record<string, string>, body?: any, hanMs = HAN_GOI_MS): Promise<KetQuaHttp> {
    const ctl = new AbortController()
    const hen = setTimeout(() => ctl.abort(), hanMs)
    try {
        const r = await fetch(CONG + duong, { method, headers, signal: ctl.signal, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) })
        const text = await r.text()
        let json: any = null
        try { json = text ? JSON.parse(text) : null } catch { json = null }
        return { status: r.status, json, text }
    } catch (e: any) {
        if (e?.name === 'AbortError') throw new LoiPSign(`MISA eSign không trả lời sau ${hanMs / 1000} giây.`, 504)
        throw new LoiPSign(`Không gọi được MISA eSign: ${e?.message || e}`, 502)
    } finally {
        clearTimeout(hen)
    }
}

const dauCong = (kn: KetNoi): Record<string, string> => ({ 'Content-Type': 'application/json', ClientID: kn.clientId, ClientSecret: kn.clientSecret })

async function canKetNoi(sp: any): Promise<KetNoi> {
    const kn = await docKetNoi(sp)
    if (!kn) throw new LoiPSign('Cửa hàng chưa nhập Client ID / Client Secret của MISA eSign.', 409, 'chua_ket_noi')
    return kn
}

const CAN_DANG_NHAP = 'Phiên MISA eSign đã hết — đăng nhập lại tài khoản eSign.'

/** Bước 1: đăng nhập. Trả {daVao} hoặc {canOtp, kenhOtp}. KHÔNG lưu mật khẩu. */
export async function dangNhap(sp: any, userId: string, taiKhoan: string, matKhau: string) {
    const kn = await canKetNoi(sp)
    const tk = chuoi(taiKhoan)
    if (!tk || !matKhau) throw new LoiPSign('Nhập tài khoản và mật khẩu MISA eSign.')
    const r = await goiHttp('/auth/login-api', 'POST', dauCong(kn), { userName: tk, password: String(matKhau) })
    const tv = docTraVe(r.status, r.json, r.text)
    const k = docDangNhap(tv)
    if (k.token) { await luuPhien(sp, userId, tk, k); return { daVao: true as const, ten: k.ten, taiKhoan: tk } }
    if (k.canOtp) return { daVao: false as const, canOtp: true as const, kenhOtp: k.kenhOtp, taiKhoan: tk }
    if (!tv.ok) throw new LoiPSign(`MISA eSign từ chối đăng nhập: ${tv.loi}`, r.status)
    throw new LoiPSign(`MISA eSign báo đăng nhập thành công nhưng không trả token (${moTaHinh(tv.data)}).`)
}

/** Xác thực OTP. loaiOtp: 0 = mã qua SĐT/email, 1 = mã trong ứng dụng */
export async function xacThucOtp(sp: any, userId: string, taiKhoan: string, ma: string, loaiOtp: number) {
    const kn = await canKetNoi(sp)
    const tk = chuoi(taiKhoan), code = chuoi(ma)
    if (!tk || !/^[0-9A-Za-z]{4,10}$/.test(code)) throw new LoiPSign('Mã OTP không đúng dạng.')
    const r = await goiHttp('/auth/two-factor-auth', 'POST', dauCong(kn), { userName: tk, code, otpType: loaiOtp === 1 ? 1 : 0, remember: true })
    const tv = docTraVe(r.status, r.json, r.text)
    const k = docDangNhap(tv)
    if (!k.token) throw new LoiPSign(tv.ok ? `MISA eSign không trả token sau OTP (${moTaHinh(tv.data)}).` : `MISA eSign từ chối mã OTP: ${tv.loi}`, r.status)
    await luuPhien(sp, userId, tk, k)
    return { daVao: true as const, ten: k.ten, taiKhoan: tk }
}

export async function guiLaiOtp(sp: any, taiKhoan: string) {
    const kn = await canKetNoi(sp)
    const r = await goiHttp('/auth/resend-otp-auth', 'POST', dauCong(kn), { userName: chuoi(taiKhoan), language: 'vi-VN' })
    const tv = docTraVe(r.status, r.json, r.text)
    if (!tv.ok) throw new LoiPSign(`MISA eSign chưa gửi lại được mã: ${tv.loi}`, r.status)
    return { daGui: true }
}

const laLoiToken = (status: number, tv: TraVe) => status === 401 && !/CLIENT_?ID|CLIENT_?SECRET/i.test(`${tv.maLoi || ''} ${tv.loi}`)

/** Token bị từ chối ⇒ làm mới bằng refreshToken MỘT lần; không được ⇒ xoá phiên, báo đăng nhập lại */
async function lamMoi(sp: any, kn: KetNoi, p: Phien): Promise<Phien> {
    if (!p.refreshToken) { await xoaPhien(sp, p.userId); throw new LoiPSign(CAN_DANG_NHAP, 409, 'can_dang_nhap') }
    const r = await goiHttp('/auth/refreshtoken', 'POST', dauCong(kn), { refreshToken: p.refreshToken })
    const tv = docTraVe(r.status, r.json, r.text)
    const k = docDangNhap(tv)
    if (!k.token) { await xoaPhien(sp, p.userId); throw new LoiPSign(CAN_DANG_NHAP, 409, 'can_dang_nhap') }
    await luuPhien(sp, p.userId, p.taiKhoan, k, p)
    return { ...p, token: k.token, refreshToken: k.refreshToken || p.refreshToken, han: k.songMs ? Date.now() + k.songMs : null }
}

/** Gọi API nghiệp vụ bằng phiên của người dùng; MISA báo lỗi ⇒ ném NGUYÊN VĂN */
async function goiCoPhien(sp: any, userId: string, duong: string, method: string, body?: any, opt: { hanMs?: number; coToken?: boolean; headerThem?: Record<string, string> } = {}): Promise<any> {
    const kn = await canKetNoi(sp)
    let p = await docPhien(sp, userId)
    if (!p) throw new LoiPSign('Chưa đăng nhập tài khoản MISA eSign.', 409, 'can_dang_nhap')
    for (let lan = 0; ; lan++) {
        const r = await goiHttp(duong, method, { ...dauCong(kn), ...(opt.coToken === false ? {} : { AuthorizationRM: `Bearer ${p.token}` }), ...(opt.headerThem || {}) }, body, opt.hanMs)
        const tv = docTraVe(r.status, r.json, r.text)
        if (tv.ok) return tv.data
        if (lan === 0 && laLoiToken(r.status, tv)) { p = await lamMoi(sp, kn, p); continue }
        throw new LoiPSign(`MISA eSign ${duong.split('?')[0].replace(/\/[0-9a-f-]{20,}$/i, '')}: ${tv.loi}`, r.status)
    }
}

export async function dsChungThu(sp: any, userId: string): Promise<ChungThuDayDu[]> {
    const data = await goiCoPhien(sp, userId, '/certificates/by-userId', 'GET')
    const { ds, docDuoc } = tachDsChungThu(data)
    if (!docDuoc) throw new LoiPSign(`MISA trả danh sách chứng thư ở dạng Kengi chưa đọc được (${moTaHinh(data)}).`)
    return ds.map(x => docChungThu(x)).filter(c => c.keyAlias)
}

// ─── Nhật ký ──────────────────────────────────────────────────────────────────

const ID_RE = /^[0-9a-f-]{36}$/i

async function ghiNhatKy(sp: any, d: { id: string; userId: string; nguoi: string; taiKhoan: string; tenTep: string; kichThuoc: number; certAlias: string; chuThe: string; transactionId: string }) {
    await sp.$executeRawUnsafe(
        `INSERT INTO ${BANG_NK} ("id","userId","nguoi","taiKhoan","tenTep","kichThuoc","certAlias","chuThe","transactionId","trangThai","taoLuc") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'cho',$10)`,
        d.id, d.userId, d.nguoi.slice(0, 120), d.taiKhoan.slice(0, 200), d.tenTep.slice(0, 200), d.kichThuoc, d.certAlias, d.chuThe.slice(0, 200), d.transactionId, Date.now())
}

/** Chỉ đổi dòng còn 'cho' của CHÍNH người đó ⇒ gọi lại không lật kết cục đã chốt */
async function chotNhatKy(sp: any, userId: string, id: string, trangThai: 'xong' | 'loi', loi = '') {
    await sp.$executeRawUnsafe(`UPDATE ${BANG_NK} SET "trangThai" = $3, "loi" = $4, "xongLuc" = $5 WHERE "id" = $1 AND "userId" = $2 AND "trangThai" = 'cho'`,
        id, userId, trangThai, loi.slice(0, 400) || null, Date.now())
}

export async function dsNhatKy(sp: any, gioiHan = 50) {
    await damBaoBang(sp)
    const r: any[] = await sp.$queryRawUnsafe(`SELECT "id","nguoi","taiKhoan","tenTep","kichThuoc","chuThe","trangThai","loi","taoLuc","xongLuc" FROM ${BANG_NK} ORDER BY "taoLuc" DESC LIMIT ${Math.min(200, Math.max(1, Math.floor(gioiHan)))}`)
    const bayGio = Date.now()
    return r.map(d => {
        const taoLuc = Number(d.taoLuc)
        // còn 'cho' mà quá hạn ký của MISA (120 giây, chừa thêm) ⇒ người dùng đã bỏ ngang: hiện đúng là hết hạn, không treo "đang chờ"
        const trangThai = d.trangThai === 'cho' && bayGio - taoLuc > (HAN_KY_GIAY + 180) * 1000 ? 'het_han' : String(d.trangThai)
        return { id: String(d.id), nguoi: d.nguoi || '', taiKhoan: d.taiKhoan || '', tenTep: String(d.tenTep), kichThuoc: d.kichThuoc === null ? null : Number(d.kichThuoc), chuThe: d.chuThe || '', trangThai, loi: d.loi || '', taoLuc, xongLuc: d.xongLuc === null ? null : Number(d.xongLuc) }
    })
}

// ─── Ký ───────────────────────────────────────────────────────────────────────

export interface YeuCauKy { tenTep: any; pdf: any; certAlias: any; viTri: any; hienThi: any }

const tenTepSach = (v: any) => {
    const s = cat(v, 100).replace(/[\\/:*?"<>|]/g, '_')
    return /\.pdf$/i.test(s) ? s : `${s || 'tai-lieu'}.pdf`
}

/** Ảnh chữ ký (tuỳ chọn): PNG/JPEG base64, tối đa 300 KB */
function kiemAnh(v: any): string {
    if (v === undefined || v === null || v === '') return ''
    const s = String(v).replace(/^data:image\/(png|jpe?g);base64,/i, '').replace(/\s+/g, '')
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(s) || s.length > 400_000) throw new LoiPSign('Ảnh chữ ký không đọc được hoặc nặng quá 300 KB.')
    const dau = Buffer.from(s.slice(0, 12), 'base64')
    const png = dau[0] === 0x89 && dau[1] === 0x50, jpg = dau[0] === 0xff && dau[1] === 0xd8
    if (!png && !jpg) throw new LoiPSign('Ảnh chữ ký phải là PNG hoặc JPG.')
    return s
}

/**
 * Bước 3 + 4: băm tệp rồi gửi yêu cầu ký. Sau lời gọi này người ký phải bấm xác nhận trên app MISA eSign trong 120 giây.
 * Trả `docBam` cho trình duyệt giữ — bước hoàn tất gửi lại.
 */
export async function batDauKy(sp: any, user: { userId: string; nguoi: string }, yc: YeuCauKy) {
    const { b64, bytes } = kiemPdf(yc.pdf)
    const viTri = kiemViTri(yc.viTri)
    const certAlias = chuoi(yc.certAlias)
    if (!certAlias) throw new LoiPSign('Chưa chọn chứng thư số.')
    const tenTep = tenTepSach(yc.tenTep)
    const p = await docPhien(sp, user.userId)
    if (!p) throw new LoiPSign('Chưa đăng nhập tài khoản MISA eSign.', 409, 'can_dang_nhap')

    const ct = (await dsChungThu(sp, user.userId)).find(c => c.keyAlias === certAlias)
    if (!ct) throw new LoiPSign('Không thấy chứng thư đã chọn trong tài khoản MISA eSign này.')
    if (!ct.dungDuoc) throw new LoiPSign(`Không ký được bằng chứng thư này: ${ct.lyDoKhongDung}.`)

    const ht: HienThiKy = {
        nguoiKy: chuoi(yc.hienThi?.nguoiKy) || ct.chuThe || p.ten || p.taiKhoan,
        noiKy: chuoi(yc.hienThi?.noiKy), lyDo: chuoi(yc.hienThi?.lyDo) || 'Ký tài liệu', lienHe: chuoi(yc.hienThi?.lienHe),
        hienNgay: yc.hienThi?.hienNgay !== false, anhChuKy: kiemAnh(yc.hienThi?.anhChuKy),
    }
    const documentId = crypto.randomUUID()
    // băm: tài liệu ghi chỉ cần ClientID + ClientSecret; gửi kèm token cũng không sao và đỡ một ca 401 lạ
    const dataBam = await goiCoPhien(sp, user.userId, '/documents/hash', 'POST', thanBam(ct, documentId, b64, viTri, ht), { hanMs: HAN_GOI_TEP_MS })
    const docBam = docKetQuaBam(dataBam)
    if (!docBam) throw new LoiPSign(`MISA băm tệp xong nhưng trả dữ liệu Kengi chưa đọc được (${moTaHinh(dataBam)}).`)

    const misaUserId = ct.misaUserId || p.misaUserId
    if (!misaUserId) throw new LoiPSign('MISA không cho biết mã người dùng eSign — đăng xuất rồi đăng nhập lại tài khoản eSign.')
    const dataKy = await goiCoPhien(sp, user.userId, '/signing/hash', 'POST', thanKy(misaUserId, certAlias, docBam, tenTep, `Kengi P-Sign: ${tenTep}`))
    const transactionId = chuoi(docTruong(moChuoiJson(dataKy), 'transactionId', 'TransactionId'))
    if (!ID_RE.test(transactionId)) throw new LoiPSign(`MISA nhận yêu cầu ký nhưng không trả mã giao dịch (${moTaHinh(dataKy)}).`)

    const nhatKyId = crypto.randomUUID()
    await ghiNhatKy(sp, { id: nhatKyId, userId: user.userId, nguoi: user.nguoi, taiKhoan: p.taiKhoan, tenTep, kichThuoc: bytes, certAlias, chuThe: ct.chuThe, transactionId })
    return { nhatKyId, transactionId, hanGiay: HAN_KY_GIAY, tenTep, docBam }
}

/** Bước 5: hỏi trạng thái. Lỗi / từ chối ⇒ chốt nhật ký. KHÔNG trả chữ ký ra trình duyệt. */
export async function hoiTrangThai(sp: any, userId: string, transactionId: string, nhatKyId?: string) {
    if (!ID_RE.test(transactionId)) throw new LoiPSign('Mã giao dịch ký không đúng.')
    const data = await goiCoPhien(sp, userId, `/signing/status/${transactionId}`, 'GET')
    const t = docTrangThaiKy(data)
    if (!t) throw new LoiPSign(`MISA trả trạng thái ký Kengi chưa đọc được (${moTaHinh(data)}).`)
    if (t.trangThai === 'loi' && nhatKyId && ID_RE.test(nhatKyId)) await chotNhatKy(sp, userId, nhatKyId, 'loi', [t.maLoi, t.moTa].filter(Boolean).join(' — ') || 'MISA báo ký không thành công')
    return { trangThai: t.trangThai, maLoi: t.maLoi, moTa: t.moTa }
}

/** Bước 6: lấy chữ ký từ MISA (không tin trình duyệt) rồi gắn vào tệp. Trả PDF đã ký (base64). */
export async function hoanTat(sp: any, userId: string, b: { transactionId: any; nhatKyId: any; certAlias: any; docBam: any }) {
    const transactionId = chuoi(b.transactionId), nhatKyId = chuoi(b.nhatKyId), certAlias = chuoi(b.certAlias)
    if (!ID_RE.test(transactionId) || !ID_RE.test(nhatKyId)) throw new LoiPSign('Thiếu mã giao dịch ký.')
    const docBam = b.docBam
    if (!docBam || typeof docBam !== 'object' || Array.isArray(docBam) || !chuoi(docTruong(docBam, 'digest'))) throw new LoiPSign('Thiếu dữ liệu băm của tệp — ký lại từ đầu.')
    // giao dịch phải là của chính người này trong cửa hàng này
    const nk: any[] = await sp.$queryRawUnsafe(`SELECT "tenTep","trangThai" FROM ${BANG_NK} WHERE "id" = $1 AND "userId" = $2 AND "transactionId" = $3`, nhatKyId, userId, transactionId)
    if (!nk[0]) throw new LoiPSign('Không thấy lượt ký này.', 404)

    const data = await goiCoPhien(sp, userId, `/signing/status/${transactionId}`, 'GET')
    const t = docTrangThaiKy(data)
    if (!t) throw new LoiPSign(`MISA trả trạng thái ký Kengi chưa đọc được (${moTaHinh(data)}).`)
    if (t.trangThai === 'cho') throw new LoiPSign('Chưa xác nhận ký trên app MISA eSign.', 409, 'chua_xac_nhan')
    if (t.trangThai === 'loi') {
        const ly = [t.maLoi, t.moTa].filter(Boolean).join(' — ') || 'MISA báo ký không thành công'
        await chotNhatKy(sp, userId, nhatKyId, 'loi', ly)
        throw new LoiPSign(`Ký không thành công: ${ly}`)
    }
    const idDoc = chuoi(docTruong(docBam, 'documentId'))
    const ck = t.chuKy.find(x => x.documentId === idDoc) || (t.chuKy.length === 1 ? t.chuKy[0] : null)
    if (!ck) throw new LoiPSign('MISA báo đã ký nhưng không trả chữ ký của tệp này.')

    const ct = (await dsChungThu(sp, userId)).find(c => c.keyAlias === certAlias)
    if (!ct) throw new LoiPSign('Không thấy chứng thư đã dùng để ký.')
    const dataGan = await goiCoPhien(sp, userId, '/documents/attachment', 'POST', thanGan(ct, docBam, ck.signature), { hanMs: HAN_GOI_TEP_MS })
    const pdf = docTepDaKy(dataGan)
    if (!pdf || Buffer.from(pdf.slice(0, 8), 'base64').toString('latin1').slice(0, 4) !== '%PDF') {
        await chotNhatKy(sp, userId, nhatKyId, 'loi', 'MISA không trả tệp đã gắn chữ ký')
        throw new LoiPSign(`MISA đã ký nhưng không trả tệp PDF đã gắn chữ ký (${moTaHinh(dataGan)}).`)
    }
    await chotNhatKy(sp, userId, nhatKyId, 'xong')
    const ten = String(nk[0].tenTep).replace(/\.pdf$/i, '') + '-da-ky.pdf'
    return { tenTep: ten, pdf }
}

/** Trạng thái cho trang: kết nối của cửa hàng (không bí mật) + phiên eSign của người đang dùng */
export async function trangThai(sp: any, userId: string) {
    const kn = await docKetNoi(sp)
    const p = kn ? await docPhien(sp, userId) : null
    return {
        ketNoi: kn ? { coKetNoi: true, clientId: cheMa(kn.clientId), nguoiLuu: kn.nguoiLuu, capNhatLuc: kn.capNhatLuc } : { coKetNoi: false },
        phien: p ? { dangNhap: true, taiKhoan: p.taiKhoan, ten: p.ten, han: p.han } : { dangNhap: false },
        gioiHan: { pdfToiDa: PDF_TOI_DA, hanKyGiay: HAN_KY_GIAY },
    }
}
