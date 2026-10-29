/**
 * MISA meInvoice — KẾT NỐI + ĐỌC hoá đơn điện tử (28/10/2026)
 *
 * meInvoice là phần mềm HĐĐT của MISA, KHÁC AMIS kế toán (services/misa.ts, routes/misaDay.ts): cổng riêng, gói riêng trên
 * developer.misa.vn (ClientID + ClientSecret của gói MEINVOICE) và đăng nhập bằng TÀI KHOẢN meInvoice (MST người bán +
 * email/sđt + mật khẩu). Tài liệu đọc 28/10/2026: developer.misa.vn/products-openapi/MEINVOICE (bản JSON:
 * developer.misa.vn/backend/api/products/docs/MEINVOICE).
 *
 * Ở đây CHỈ ĐỌC (chủ shop 28/10/2026: gửi hoá đơn cho khách gõ /hoadon hoặc khách lấy định kỳ qua nhóm Zalo — lib/hoaDonMisaZalo.ts):
 * đọc hoá đơn kế toán đã xuất trên web app meInvoice. Không phát hành, không đẩy nháp, không xoá.
 *
 * Hai đường đăng nhập tách nhau, cùng một tài khoản:
 *   tích hợp  POST /invoice/token     {taxcode, username, password}  — cho /invoice/* (tải PDF/XML, gửi email…); token sống 14 ngày
 *   web app   POST /invoiceweb/token  {TaxCode, UserName, Password}  — cho /invoiceweb/* (danh sách HĐ trên web); thêm header TaxCode
 * Lấy token: header ClientID + ClientSecret. Mọi lời gọi khác: ClientID + Authorization Bearer.
 *
 * CHƯA ĐO (28/10/2026 — chưa có tài khoản thật): tên trường "mã tra cứu" trong danh sách HĐ web (tài liệu chỉ nói "Số hóa đơn,
 * Mã tra cứu…"); `data` trả mảng hay chuỗi JSON; ToDate có tính trọn ngày không; token web sống bao lâu.
 * ⇒ đọc trường kiểu dò nhiều tên (docTruong), và "soi" trả nguyên tên trường để đo trước khi bật gửi.
 * 29/10/2026 HUTI nối thật, ĐO bằng doTho (POST /api/meinvoice/do-tho): /invoiceweb/paging chỉ thấy HĐ lập trên web app (năm 2026: 11)
 * trong khi tháng 10 đã phát hành 351 HĐ (lập từ AMIS) ⇒ nguồn soi = /invoice/paging (danh sách tích hợp theo ký hiệu, dsHoaDonPhatHanh).
 * Mã tra cứu = TransactionID (12 ký tự); mã khách = BuyerCode; ToDate tính trọn ngày. Hình lạ ⇒ báo "không đọc được", không ra 0.
 */

import { maHoa, giaiMa, coKhoaVault } from './maHoaKhoa'
import { tenSchema } from './zaloKengi'
import { mstHopLe } from './hoaDonKhach'

export const CONG_MAC_DINH = 'https://developer.misa.vn/apis/itg/meinvoice'
const BANG = '"MeInvoiceKetNoi"'
const ID = 'mac-dinh'
const HAN_GOI_MS = 20_000
/** Token tích hợp: tài liệu nói 14 ngày — giữ 13 cho chắc. Token web: tài liệu không nói — giữ 12 giờ (đăng nhập lại rẻ). */
const SONG_TICH_HOP_MS = 13 * 86_400_000
const SONG_WEB_MS = 12 * 3_600_000
/** Một trang danh sách HĐ web tối đa 100 (tài liệu) */
export const MOI_TRANG = 100

export type LoaiToken = 'tichHop' | 'web'

/** Lỗi đọc được cho người vận hành — route hiện NGUYÊN VĂN (lỗi của MISA không phải chi tiết nội bộ) */
export class LoiMeInvoice extends Error {
    constructor(msg: string, public readonly httpStatus?: number) {
        super(msg)
        this.name = 'LoiMeInvoice'
    }
}

// ─── Đọc trả về của MISA ──────────────────────────────────────────────────────

/** Lấy trường theo nhiều tên, không phân biệt hoa thường — MISA trộn `success`/`Success`, `data`/`Data` giữa các API */
export function docTruong(o: any, ...ten: string[]): any {
    if (!o || typeof o !== 'object') return undefined
    for (const t of ten) if (o[t] !== undefined && o[t] !== null) return o[t]
    const thuong = new Map(Object.keys(o).map(k => [k.toLowerCase(), k]))
    for (const t of ten) {
        const k = thuong.get(t.toLowerCase())
        if (k !== undefined && o[k] !== undefined && o[k] !== null) return o[k]
    }
    return undefined
}

/** `data` có thể là chuỗi JSON — MISA hay bọc mảng trong chuỗi */
export function moChuoiJson(v: any): any {
    if (typeof v !== 'string') return v
    const s = v.trim()
    if (!s || !'[{'.includes(s[0])) return v
    try { return JSON.parse(s) } catch { return v }
}

export interface TraVe { ok: boolean; data: any; loi: string }

/** Chuẩn hoá thân trả về: {success, errorCode, descriptionErrorCode, errors, data} (+ Error/ErrorDescription của web app, message của cổng) */
export function docTraVe(status: number, json: any, text: string): TraVe {
    if (json && typeof json === 'object' && !Array.isArray(json)) {
        const thanhCong = docTruong(json, 'success', 'Success')
        const data = moChuoiJson(docTruong(json, 'data', 'Data'))
        const loi = moTaLoi(json)
        const ok = status >= 200 && status < 300 && (thanhCong === true || thanhCong === 'true' || (thanhCong === undefined && !loi))
        return { ok, data, loi: ok ? '' : (loi || `HTTP ${status}`) }
    }
    if (status >= 200 && status < 300 && Array.isArray(json)) return { ok: true, data: json, loi: '' }
    return { ok: false, data: null, loi: (String(text || '').trim().slice(0, 300) || `HTTP ${status}`) }
}

/** Gom lỗi của MISA thành một câu — giữ nguyên chữ của MISA */
export function moTaLoi(json: any): string {
    const phan: string[] = []
    const them = (v: any) => {
        if (v === undefined || v === null || v === '') return
        if (Array.isArray(v)) { v.forEach(them); return }
        if (typeof v === 'object') { them(docTruong(v, 'message', 'Message', 'errorMessage', 'ErrorMessage', 'description', 'Description', 'code', 'Code')); return }
        const s = String(v).trim()
        if (s && !phan.includes(s)) phan.push(s)
    }
    them(docTruong(json, 'errorCode', 'ErrorCode', 'Error'))
    them(docTruong(json, 'descriptionErrorCode', 'DescriptionErrorCode', 'ErrorDescription'))
    them(docTruong(json, 'errors', 'Errors'))
    them(docTruong(json, 'message', 'Message'))   // lỗi của cổng (sai/thiếu ClientID…)
    return phan.join(' — ').slice(0, 400)
}

/** Token nằm trong `data`: chuỗi (tích hợp) hoặc object (web app — tài liệu ghi "Object") */
export function tachToken(data: any): { token: string; songMs: number | null } {
    const d = moChuoiJson(data)
    if (typeof d === 'string') return { token: d.trim(), songMs: null }
    if (d && typeof d === 'object') {
        const t = docTruong(d, 'token', 'access_token', 'accessToken', 'Token', 'AccessToken')
        const giay = Number(docTruong(d, 'expires_in', 'expiresIn', 'ExpiresIn'))
        return { token: typeof t === 'string' ? t.trim() : '', songMs: Number.isFinite(giay) && giay > 0 ? giay * 1000 : null }
    }
    return { token: '', songMs: null }
}

// ─── Hoá đơn đọc về ───────────────────────────────────────────────────────────

export interface HoaDonMisa {
    refId: string | null
    kyHieu: string | null
    so: string | null
    /** YYYY-MM-DD theo giờ VN */
    ngay: string | null
    maKhach: string | null
    /** MST người mua đã chuẩn hoá; '' = không có / không hợp lệ */
    mst: string
    tenNguoiMua: string | null
    tongTien: number | null
    /** Mã tra cứu (TransactionID) — CHƯA ĐO tên trường, có thể null */
    maTraCuu: string | null
    trangThai: string | null
}

const chuoi = (v: any): string | null => {
    if (v === undefined || v === null) return null
    const s = String(v).trim()
    return s ? s : null
}

/** MST: chỉ giữ số + gạch nối; không hợp lệ ⇒ '' */
export function mstChuan(v: any): string {
    const s = String(v ?? '').replace(/[^\d-]/g, '')
    return s && mstHopLe(s) ? s : ''
}

/**
 * Ngày hoá đơn về YYYY-MM-DD giờ VN. "2025-09-26T00:00:00+07:00" hay "2025-09-26" lấy thẳng; có múi giờ khác (Z…) thì đổi về +7
 * — cắt 10 ký tự của giờ UTC là lùi một ngày với hoá đơn lập sau 0h VN.
 */
export function ngayHoaDon(v: any): string | null {
    const s = chuoi(v)
    if (!s) return null
    const m = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?))?\s*(Z|[+-]\d{2}:?\d{2})?$/.exec(s)
    if (!m) return null
    if (!m[3] || m[3] === '+07:00' || m[3] === '+0700') return m[1]
    const t = Date.parse(s)
    return Number.isFinite(t) ? new Date(t + 7 * 3_600_000).toISOString().slice(0, 10) : m[1]
}

export function docHoaDon(raw: any): HoaDonMisa {
    const so = chuoi(docTruong(raw, 'InvNo', 'InvoiceNo', 'InvoiceNumber'))
    const tong = Number(docTruong(raw, 'TotalAmount', 'TotalAmountOC', 'TotalAmountWithVAT', 'TotalAmountWithVATOC'))
    return {
        refId: chuoi(docTruong(raw, 'RefID', 'RefId')),
        kyHieu: chuoi(docTruong(raw, 'InvSeries', 'InvoiceSeries')),
        // web app ghi "<Chưa cấp số>" cho HĐ chưa phát hành
        so: so && /\d/.test(so) ? so : null,
        ngay: ngayHoaDon(docTruong(raw, 'InvDate', 'InvoiceDate')),
        maKhach: chuoi(docTruong(raw, 'AccountObjectCode', 'BuyerCode')),
        mst: mstChuan(docTruong(raw, 'AccountObjectTaxCode', 'BuyerTaxCode')),
        tenNguoiMua: chuoi(docTruong(raw, 'AccountObjectName', 'BuyerLegalName', 'BuyerFullName', 'BuyerName', 'ContactName')),
        tongTien: Number.isFinite(tong) ? tong : null,
        maTraCuu: chuoi(docTruong(raw, 'TransactionID', 'TransactionId', 'LookupCode', 'SearchCode')),
        trangThai: chuoi(docTruong(raw, 'PublishStatus', 'InvoiceStatus', 'Status')),
    }
}

/** Có khoá (bất kể giá trị, kể cả null) không — phân biệt "MISA ghi rõ danh sách rỗng" với "hình lạ" */
function coKhoa(o: any, ...ten: string[]): boolean {
    if (!o || typeof o !== 'object') return false
    const thuong = new Set(Object.keys(o).map(k => k.toLowerCase()))
    return ten.some(t => thuong.has(t.toLowerCase()))
}

// docTruong không phân biệt hoa thường
const KHOA_DS = ['Items', 'Data', 'List', 'PageData']
const KHOA_TONG = ['Total', 'TotalCount', 'TotalRecord']

/**
 * Danh sách trong `data` của API phân trang: mảng thẳng, hoặc bọc {Items|Data|List…, Total…}.
 * `docDuoc=false` = MISA trả HÌNH LẠ (object không có khoá danh sách, chuỗi không phải JSON…) ⇒ KHÔNG được hiểu là "0 hoá đơn".
 */
export function tachDanhSach(data: any): { ds: any[]; tong: number | null; docDuoc: boolean } {
    const d = moChuoiJson(data)
    // success=true mà không kèm data ⇒ MISA không có gì để trả
    if (d === undefined || d === null || (typeof d === 'string' && !d.trim())) return { ds: [], tong: null, docDuoc: true }
    if (Array.isArray(d)) return { ds: d, tong: null, docDuoc: true }
    if (typeof d === 'object') {
        const ds = moChuoiJson(docTruong(d, ...KHOA_DS))
        const t = Number(docTruong(d, ...KHOA_TONG))
        const tong = Number.isFinite(t) ? t : null
        if (Array.isArray(ds)) return { ds, tong, docDuoc: true }
        // rỗng THẬT: khoá danh sách có mặt mà null, object rỗng, hoặc chỉ có tổng = 0
        const rongThat = (ds === undefined && coKhoa(d, ...KHOA_DS)) || Object.keys(d).length === 0 || (tong === 0 && !coKhoa(d, ...KHOA_DS))
        return { ds: [], tong, docDuoc: rongThat }
    }
    return { ds: [], tong: null, docDuoc: false }
}

/** HÌNH của dữ liệu (tên khoá, độ dài — không lộ giá trị) cho cảnh báo "không đọc được" */
export function moTaHinh(data: any): string {
    const d = moChuoiJson(data)
    if (d === null || d === undefined) return 'rỗng'
    if (Array.isArray(d)) return `mảng ${d.length} phần tử`
    if (typeof d === 'object') return `object {${Object.keys(d).slice(0, 12).join(', ')}}`
    return `${typeof d} "${String(d).slice(0, 60)}"`
}

// ─── Kết nối lưu theo cửa hàng (bảng tạo lười — cùng nếp lib/zaloKengi.ts) ─────

const daTaoBang = new Set<string>()

async function damBaoBang(sp: any): Promise<void> {
    const schema = await tenSchema(sp)
    if (daTaoBang.has(schema)) return
    try {
        await sp.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS ${BANG} (
            "id" TEXT PRIMARY KEY,
            "dungChungAmis" BOOLEAN NOT NULL DEFAULT false,
            "clientId" TEXT,
            "clientSecret" TEXT,
            "mst" TEXT NOT NULL,
            "taiKhoan" TEXT NOT NULL,
            "matKhau" TEXT NOT NULL,
            "coMa" BOOLEAN NOT NULL DEFAULT true,
            "congRieng" TEXT,
            "tokenTichHop" TEXT, "hanTichHop" BIGINT,
            "tokenWeb" TEXT, "hanWeb" BIGINT,
            "thuLuc" BIGINT, "thuKetQua" TEXT,
            "nguoiLuu" TEXT,
            "capNhatLuc" BIGINT NOT NULL
        )`)
    } catch (e: any) {
        if (!/already exists|duplicate key value/i.test(String(e?.message || ''))) throw e
    }
    daTaoBang.add(schema)
}

export interface KetNoiMeInvoice {
    dungChungAmis: boolean
    clientId: string
    clientSecret: string
    mst: string
    taiKhoan: string
    matKhau: string
    coMa: boolean
    cong: string
    tokenTichHop: string | null; hanTichHop: number | null
    tokenWeb: string | null; hanWeb: number | null
    thuLuc: number | null; thuKetQua: string | null
    capNhatLuc: number
}

/** Cổng tự đặt chỉ nhận https *.misa.vn / *.meinvoice.vn — không để ô cấu hình thành đường gọi tuỳ ý (SSRF) */
export function congHopLe(v: any): string | null {
    const s = String(v ?? '').trim().replace(/\/+$/, '')
    if (!s) return null
    try {
        const u = new URL(s)
        const h = u.hostname.toLowerCase()
        if (u.protocol !== 'https:') return null
        if (!(h === 'misa.vn' || h.endsWith('.misa.vn') || h === 'meinvoice.vn' || h.endsWith('.meinvoice.vn'))) return null
        return s
    } catch { return null }
}

const giai = (v: any): string => (v ? giaiMa(String(v)) : '')
const so = (v: any): number | null => (v === null || v === undefined ? null : Number(v))

/** Cấu hình đã lưu; null = chưa kết nối. KHÔNG nuốt lỗi giải mã: "khoá đổi" phải khác "chưa kết nối". */
export async function docKetNoi(sp: any): Promise<KetNoiMeInvoice | null> {
    await damBaoBang(sp)
    const r: any[] = await sp.$queryRawUnsafe(`SELECT * FROM ${BANG} WHERE "id" = $1`, ID)
    const d = r[0]
    if (!d) return null
    let clientId = String(d.clientId || '')
    let clientSecret = ''
    try { clientSecret = giai(d.clientSecret) } catch { throw new LoiMeInvoice('Không giải mã được Client Secret meInvoice đã lưu (khoá mã hoá máy chủ đã đổi?) — nhập lại kết nối.') }
    if (d.dungChungAmis) {
        // ClientID/Secret của gói AMIS trên cùng developer.misa.vn — chỉ dùng được nếu MISA duyệt thêm gói MEINVOICE cho ứng dụng đó
        const amis = await sp.misaConfig.findUnique({ where: { id: 'default' }, select: { clientId: true, clientSecret: true } }).catch(() => null)
        clientId = String(amis?.clientId || '').trim()
        clientSecret = String(amis?.clientSecret || '').trim()
    }
    let matKhau = ''
    try { matKhau = giai(d.matKhau) } catch { throw new LoiMeInvoice('Không giải mã được mật khẩu meInvoice đã lưu (khoá mã hoá máy chủ đã đổi?) — nhập lại kết nối.') }
    const giaiToken = (v: any) => { try { return v ? giaiMa(String(v)) : null } catch { return null } }
    return {
        dungChungAmis: !!d.dungChungAmis,
        clientId, clientSecret,
        mst: String(d.mst || ''),
        taiKhoan: String(d.taiKhoan || ''),
        matKhau,
        coMa: d.coMa !== false,
        cong: congHopLe(d.congRieng) || CONG_MAC_DINH,
        tokenTichHop: giaiToken(d.tokenTichHop), hanTichHop: so(d.hanTichHop),
        tokenWeb: giaiToken(d.tokenWeb), hanWeb: so(d.hanWeb),
        thuLuc: so(d.thuLuc), thuKetQua: d.thuKetQua ? String(d.thuKetQua) : null,
        capNhatLuc: Number(d.capNhatLuc) || 0,
    }
}

/** Màn hình: KHÔNG trả bí mật nào — Client Secret / mật khẩu / token chỉ báo có hay không */
export function moTaKetNoi(kn: KetNoiMeInvoice | null, bayGio = Date.now()) {
    if (!kn) return { coKetNoi: false as const }
    let thu: any = null
    try { thu = kn.thuKetQua ? JSON.parse(kn.thuKetQua) : null } catch { thu = null }
    return {
        coKetNoi: true as const,
        dungChungAmis: kn.dungChungAmis,
        clientId: kn.clientId ? (kn.clientId.length > 12 ? `${kn.clientId.slice(0, 8)}…` : kn.clientId) : '',
        coClientSecret: !!kn.clientSecret,
        mst: kn.mst,
        taiKhoan: kn.taiKhoan,
        coMa: kn.coMa,
        congRieng: kn.cong !== CONG_MAC_DINH ? kn.cong : null,
        tokenTichHopCon: !!kn.tokenTichHop && (kn.hanTichHop || 0) > bayGio,
        tokenWebCon: !!kn.tokenWeb && (kn.hanWeb || 0) > bayGio,
        thuLuc: kn.thuLuc ? new Date(kn.thuLuc).toISOString() : null,
        thu,
        capNhatLuc: kn.capNhatLuc ? new Date(kn.capNhatLuc).toISOString() : null,
    }
}

export interface NhapKetNoi {
    dungChungAmis?: boolean
    clientId?: string
    clientSecret?: string
    mst?: string
    taiKhoan?: string
    matKhau?: string
    coMa?: boolean
    congRieng?: string | null
}

/** Lưu kết nối. Bí mật để trống = giữ bản đã lưu. Đổi thông tin đăng nhập ⇒ xoá token cũ (token của tài khoản cũ). */
export async function luuKetNoi(sp: any, b: NhapKetNoi, nguoi: string): Promise<void> {
    if (!coKhoaVault()) throw new LoiMeInvoice('Máy chủ chưa có khoá mã hoá (MARKETING_VAULT_KEY) — không lưu được mật khẩu meInvoice.')
    await damBaoBang(sp)
    const cu: any = ((await sp.$queryRawUnsafe(`SELECT * FROM ${BANG} WHERE "id" = $1`, ID)) as any[])[0] || null
    const dungChungAmis = b.dungChungAmis === undefined ? !!cu?.dungChungAmis : !!b.dungChungAmis
    const clientId = String(b.clientId ?? '').trim() || String(cu?.clientId || '')
    const clientSecretMoi = String(b.clientSecret ?? '').trim()
    const mst = String(b.mst ?? '').replace(/\s+/g, '') || String(cu?.mst || '')
    const taiKhoan = String(b.taiKhoan ?? '').trim() || String(cu?.taiKhoan || '')
    const matKhauMoi = String(b.matKhau ?? '')
    const coMa = b.coMa === undefined ? (cu ? cu.coMa !== false : true) : !!b.coMa
    let congRieng: string | null = cu?.congRieng || null
    if (b.congRieng !== undefined) {
        if (b.congRieng === null || String(b.congRieng).trim() === '') congRieng = null
        else {
            congRieng = congHopLe(b.congRieng)
            if (!congRieng) throw new LoiMeInvoice('Địa chỉ cổng phải là https và thuộc misa.vn / meinvoice.vn.')
        }
    }

    if (!/^\d{10}(-\d{3})?$/.test(mst)) throw new LoiMeInvoice('MST người bán phải là 10 số (hoặc 10 số-3 số chi nhánh).')
    if (!taiKhoan) throw new LoiMeInvoice('Thiếu tài khoản đăng nhập meInvoice (email hoặc số điện thoại).')
    if (!matKhauMoi && !cu?.matKhau) throw new LoiMeInvoice('Thiếu mật khẩu meInvoice.')
    if (!dungChungAmis) {
        if (!clientId) throw new LoiMeInvoice('Thiếu ClientID (MISA cấp khi đăng ký gói MEINVOICE trên developer.misa.vn).')
        if (!clientSecretMoi && !cu?.clientSecret) throw new LoiMeInvoice('Thiếu ClientSecret (MISA cấp cùng ClientID).')
    }

    const doiDangNhap = !cu || mst !== cu.mst || taiKhoan !== cu.taiKhoan || !!matKhauMoi || !!clientSecretMoi
        || clientId !== String(cu.clientId || '') || dungChungAmis !== !!cu.dungChungAmis || (congRieng || null) !== (cu.congRieng || null)
    const clientSecret = clientSecretMoi ? maHoa(clientSecretMoi) : (cu?.clientSecret || null)
    const matKhau = matKhauMoi ? maHoa(matKhauMoi) : cu.matKhau
    const bayGio = Date.now()

    await sp.$executeRawUnsafe(
        `INSERT INTO ${BANG} ("id","dungChungAmis","clientId","clientSecret","mst","taiKhoan","matKhau","coMa","congRieng","nguoiLuu","capNhatLuc")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT ("id") DO UPDATE SET "dungChungAmis"=$2,"clientId"=$3,"clientSecret"=$4,"mst"=$5,"taiKhoan"=$6,"matKhau"=$7,
            "coMa"=$8,"congRieng"=$9,"nguoiLuu"=$10,"capNhatLuc"=$11`,
        ID, dungChungAmis, clientId || null, clientSecret, mst, taiKhoan, matKhau, coMa, congRieng, nguoi.slice(0, 120), bayGio,
    )
    if (doiDangNhap) await xoaToken(sp)
}

export async function xoaKetNoi(sp: any): Promise<boolean> {
    await damBaoBang(sp)
    const n = await sp.$executeRawUnsafe(`DELETE FROM ${BANG} WHERE "id" = $1`, ID)
    return Number(n) > 0
}

async function xoaToken(sp: any, loai?: LoaiToken): Promise<void> {
    const cot = loai === 'tichHop' ? `"tokenTichHop"=NULL,"hanTichHop"=NULL`
        : loai === 'web' ? `"tokenWeb"=NULL,"hanWeb"=NULL`
        : `"tokenTichHop"=NULL,"hanTichHop"=NULL,"tokenWeb"=NULL,"hanWeb"=NULL`
    await sp.$executeRawUnsafe(`UPDATE ${BANG} SET ${cot} WHERE "id" = $1`, ID)
}

// ─── Gọi MISA ─────────────────────────────────────────────────────────────────

interface KetQuaHttp { status: number; json: any; text: string }

async function goiHttp(url: string, method: string, headers: Record<string, string>, body?: any): Promise<KetQuaHttp> {
    const ctl = new AbortController()
    const hen = setTimeout(() => ctl.abort(), HAN_GOI_MS)
    try {
        const r = await fetch(url, {
            method, headers, signal: ctl.signal,
            ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        })
        const text = await r.text()
        let json: any = null
        try { json = text ? JSON.parse(text) : null } catch { json = null }
        return { status: r.status, json, text }
    } catch (e: any) {
        if (e?.name === 'AbortError') throw new LoiMeInvoice(`MISA meInvoice không trả lời sau ${HAN_GOI_MS / 1000} giây.`)
        throw new LoiMeInvoice(`Không gọi được MISA meInvoice: ${e?.message || e}`)
    } finally {
        clearTimeout(hen)
    }
}

const DUONG_TOKEN: Record<LoaiToken, string> = { tichHop: '/invoice/token', web: '/invoiceweb/token' }
const NHAN_TOKEN: Record<LoaiToken, string> = { tichHop: 'Đăng nhập API tích hợp', web: 'Đăng nhập web app' }

/** Đăng nhập lấy token mới (không đọc bộ nhớ) — tài liệu: tích hợp gửi chữ thường, web app gửi chữ hoa đầu */
export async function dangNhap(kn: KetNoiMeInvoice, loai: LoaiToken): Promise<{ token: string; songMs: number }> {
    if (!kn.clientId) throw new LoiMeInvoice(kn.dungChungAmis ? 'Đang chọn dùng chung ClientID với AMIS nhưng kết nối AMIS chưa có ClientID.' : 'Thiếu ClientID meInvoice.')
    const than = loai === 'tichHop'
        ? { taxcode: kn.mst, username: kn.taiKhoan, password: kn.matKhau }
        : { TaxCode: kn.mst, UserName: kn.taiKhoan, Password: kn.matKhau }
    const r = await goiHttp(kn.cong + DUONG_TOKEN[loai], 'POST', {
        'Content-Type': 'application/json',
        ClientID: kn.clientId,
        ...(kn.clientSecret ? { ClientSecret: kn.clientSecret } : {}),
    }, than)
    const tv = docTraVe(r.status, r.json, r.text)
    if (!tv.ok) throw new LoiMeInvoice(`${NHAN_TOKEN[loai]} meInvoice lỗi: ${tv.loi}`, r.status)
    const { token, songMs } = tachToken(tv.data)
    if (!token) throw new LoiMeInvoice(`${NHAN_TOKEN[loai]} meInvoice: MISA báo thành công nhưng không trả token.`)
    return { token, songMs: Math.min(songMs ?? Infinity, loai === 'tichHop' ? SONG_TICH_HOP_MS : SONG_WEB_MS) }
}

/** Token còn hạn (chừa 5 phút) thì dùng lại, không thì đăng nhập + lưu (mã hoá) */
async function layToken(sp: any, kn: KetNoiMeInvoice, loai: LoaiToken): Promise<string> {
    const [tk, han] = loai === 'tichHop' ? [kn.tokenTichHop, kn.hanTichHop] : [kn.tokenWeb, kn.hanWeb]
    if (tk && (han || 0) - 5 * 60_000 > Date.now()) return tk
    const { token, songMs } = await dangNhap(kn, loai)
    const het = Date.now() + songMs
    const [cotTk, cotHan] = loai === 'tichHop' ? ['"tokenTichHop"', '"hanTichHop"'] : ['"tokenWeb"', '"hanWeb"']
    await sp.$executeRawUnsafe(`UPDATE ${BANG} SET ${cotTk} = $2, ${cotHan} = $3 WHERE "id" = $1`, ID, maHoa(token), het)
    if (loai === 'tichHop') { kn.tokenTichHop = token; kn.hanTichHop = het } else { kn.tokenWeb = token; kn.hanWeb = het }
    return token
}

const laLoiToken = (status: number, loi: string) => status === 401 || /token|unauthori[sz]ed|hết hạn|het han/i.test(loi)

export interface KetQuaGoi { status: number; tv: TraVe; text: string }

/** Gọi một API (sau đăng nhập), trả NGUYÊN TRẠNG kể cả khi MISA báo lỗi — để đo. Token bị từ chối ⇒ đăng nhập lại MỘT lần. */
export async function goiApiTho(sp: any, kn: KetNoiMeInvoice, loai: LoaiToken, duong: string, body?: any, method = 'POST'): Promise<KetQuaGoi> {
    let kq: KetQuaGoi | null = null
    for (let lan = 0; lan < 2; lan++) {
        const token = await layToken(sp, kn, loai)
        const r = await goiHttp(kn.cong + duong, method, {
            'Content-Type': 'application/json',
            ClientID: kn.clientId,
            Authorization: `Bearer ${token}`,
            ...(loai === 'web' ? { TaxCode: kn.mst } : {}),
        }, body)
        kq = { status: r.status, tv: docTraVe(r.status, r.json, r.text), text: r.text }
        if (kq.tv.ok || lan > 0 || !laLoiToken(r.status, kq.tv.loi)) break
        await xoaToken(sp, loai)
        if (loai === 'tichHop') kn.tokenTichHop = null; else kn.tokenWeb = null
    }
    return kq!
}

/** Gọi một API (sau đăng nhập); MISA báo lỗi ⇒ ném NGUYÊN VĂN. */
export async function goiApi(sp: any, kn: KetNoiMeInvoice, loai: LoaiToken, duong: string, body?: any, method = 'POST'): Promise<any> {
    const { status, tv } = await goiApiTho(sp, kn, loai, duong, body, method)
    if (tv.ok) return tv.data
    throw new LoiMeInvoice(`MISA meInvoice ${duong.split('?')[0]}: ${tv.loi}`, status)
}

/** Thử đăng nhập CẢ HAI đường (lấy token mới, lưu lại) — kết quả từng đường, lỗi nguyên văn của MISA */
export async function thuKetNoi(sp: any) {
    const kn = await docKetNoi(sp)
    if (!kn) throw new LoiMeInvoice('Cửa hàng chưa nhập kết nối meInvoice.')
    const ket: Record<LoaiToken, { ok: boolean; loi?: string }> = { tichHop: { ok: false }, web: { ok: false } }
    for (const loai of ['tichHop', 'web'] as LoaiToken[]) {
        try {
            if (loai === 'tichHop') kn.tokenTichHop = null; else kn.tokenWeb = null
            await layToken(sp, kn, loai)
            ket[loai] = { ok: true }
        } catch (e: any) {
            ket[loai] = { ok: false, loi: String(e?.message || e).slice(0, 400) }
        }
    }
    const bayGio = Date.now()
    await sp.$executeRawUnsafe(`UPDATE ${BANG} SET "thuLuc" = $2, "thuKetQua" = $3 WHERE "id" = $1`, ID, bayGio, JSON.stringify(ket))
    return { ...ket, ok: ket.tichHop.ok && ket.web.ok, luc: new Date(bayGio).toISOString() }
}

export const TRANG_THAI_WEB: Record<string, string> = { '0': 'Chưa phát hành', '4': 'Chờ cấp mã', '6': 'Đã cấp mã', '7': 'Bị từ chối cấp mã' }

/**
 * Danh sách trên WEB APP (chỉ còn dùng để dò): hoá đơn thường, và hoá đơn MÁY TÍNH TIỀN ở đường riêng /paging/calculating (luôn có mã).
 * ĐO 29/10/2026 HUTI: web app chỉ thấy HĐ lập trên web (năm 2026: 11 cái) — HĐ lập từ AMIS không nằm đây ⇒ KHÔNG phải nguồn soi.
 */
export const NGUON_WEB = {
    thuong: { nhan: 'hoá đơn thường', duong: '/invoiceweb/paging' },
    mtt: { nhan: 'hoá đơn máy tính tiền', duong: '/invoiceweb/paging/calculating' },
} as const
export type NguonWeb = keyof typeof NGUON_WEB

export interface DongHd { raw: any; nguon: NguonWeb }

const laMayTinhTien = (r: any) => { const v = docTruong(r, 'IsInvoiceCalculatingMachine'); return v === true || v === 'true' }

/**
 * Hoá đơn ĐÃ PHÁT HÀNH trong [tu, den] (YYYY-MM-DD) — POST /invoice/paging "Danh sách hóa đơn theo ký hiệu" (token TÍCH HỢP).
 * ĐO 29/10/2026 HUTI: tháng 10 = 351 HĐ 1C26TSG, mọi kênh lập (AMIS, web app; máy tính tiền có cờ IsInvoiceCalculatingMachine);
 * data = {PageData, TotalCount, Summary}; FromDate=ToDate một ngày ⇒ đúng HĐ ngày đó (27/10 = 14, 28/10 = 27) ⇒ đi TỪNG NGÀY,
 * Skip/Take 100 tới hết TotalCount, tối đa `tranTrang` trang. Không lặng lẽ thiếu:
 *   ngayCat       ngày chạm trần trang
 *   khongDocDuoc  MISA trả thành công mà hình lạ (moTaHinh) — ngày đó KHÔNG được hiểu là không có hoá đơn
 *   thieu         đọc ít hơn TotalCount MISA báo
 */
export async function dsHoaDonPhatHanh(sp: any, kn: KetNoiMeInvoice, tu: string, den: string, tranTrang = 5) {
    const ngay: string[] = []
    for (let t = Date.parse(tu + 'T00:00:00Z'); t <= Date.parse(den + 'T00:00:00Z'); t += 86_400_000) ngay.push(new Date(t).toISOString().slice(0, 10))
    if (!ngay.length || ngay.length > 31) throw new LoiMeInvoice('Khoảng ngày phải từ 1 tới 31 ngày.')
    const dong: DongHd[] = []
    const daCo = new Set<string>()
    const ngayCat = new Set<string>()
    const khongDocDuoc: { ngay: string; hinh: string }[] = []
    const thieu: { ngay: string; misa: number; doc: number }[] = []
    const demNguon: Record<NguonWeb, number> = { thuong: 0, mtt: 0 }
    for (const n of ngay) {
        let doc = 0
        let tongNgay: number | null = null
        let hong = false
        for (let trang = 0; ; trang++) {
            if (trang >= tranTrang) { ngayCat.add(n); break }
            const data = await goiApi(sp, kn, 'tichHop', `/invoice/paging?invoiceWithCode=${kn.coMa ? 'true' : 'false'}`, {
                FromDate: n, ToDate: n, Skip: trang * MOI_TRANG, Take: MOI_TRANG, ListInvTemplate: [],
            })
            const { ds, tong, docDuoc } = tachDanhSach(data)
            if (!docDuoc) { khongDocDuoc.push({ ngay: n, hinh: moTaHinh(data) }); hong = true; break }
            if (tong !== null) tongNgay = tong
            doc += ds.length
            for (const r of ds) {
                // trang chồng nhau ⇒ đếm một lần (RefID, rồi mã tra cứu, rồi ký hiệu + số)
                const h = docHoaDon(r)
                const khoa = h.refId || h.maTraCuu || (h.kyHieu && h.so ? `${h.kyHieu}#${h.so}` : '')
                if (khoa && daCo.has(khoa)) continue
                if (khoa) daCo.add(khoa)
                const nguon: NguonWeb = laMayTinhTien(r) ? 'mtt' : 'thuong'
                dong.push({ raw: r, nguon })
                demNguon[nguon]++
            }
            if (ds.length < MOI_TRANG || (tongNgay !== null && doc >= tongNgay)) break
        }
        if (!hong && !ngayCat.has(n) && tongNgay !== null && doc < tongNgay) thieu.push({ ngay: n, misa: tongNgay, doc })
    }
    return { tho: dong.map(d => d.raw), dong, ngayCat: [...ngayCat].sort(), khongDocDuoc, thieu, demNguon }
}

/**
 * DÒ trạng thái (chỉ đọc): POST /invoice/status theo mã tra cứu (inputType=1). Tài liệu TỰ MÂU THUẪN (StatusItem {StatusCode…} hay
 * InvoiceStatus {SendTaxStatus, IsDelete, ReferenceType…}) ⇒ đo hình thật trước khi dùng để chặn gửi.
 */
export async function doTrangThai(sp: any, kn: KetNoiMeInvoice, maTraCuu: string[], mayTinhTien = false) {
    const duong = `/invoice/status?inputType=1&invoiceWithCode=${kn.coMa ? 'true' : 'false'}&invoiceCalcu=${mayTinhTien ? 'true' : 'false'}`
    try {
        const { status, tv, text } = await goiApiTho(sp, kn, 'tichHop', duong, maTraCuu)
        const d = moChuoiJson(tv.data)
        const ds = Array.isArray(d) ? d : []
        return {
            duong, httpStatus: status, ok: tv.ok, loi: tv.loi || null, hinh: tv.ok ? moTaHinh(tv.data) : null,
            truong: ds[0] && typeof ds[0] === 'object' ? Object.keys(ds[0]).sort() : null,
            mau: ds.slice(0, 3).map(rutGon),
            khung: d && typeof d === 'object' && !Array.isArray(d) ? rutGon(d) : null,
            tho: !tv.ok ? String(text || '').slice(0, 600) : null,
        }
    } catch (e: any) {
        if (!(e instanceof LoiMeInvoice)) throw e
        return { duong, ok: false, loi: e.message }
    }
}

/**
 * 'tichHop' = POST /invoice/paging "Danh sách hóa đơn theo ký hiệu" (token TÍCH HỢP, body Skip/Take/ListInvTemplate) — tài liệu: dùng khi
 * đối tác đồng bộ danh sách HĐ về. 29/10/2026 HUTI: web app chỉ có 11 HĐ năm 2026 mà số HĐ tháng 10 đã 00003393 ⇒ HĐ lập từ AMIS
 * không nằm ở web app; đo đường này trước khi đổi nguồn soi.
 */
export type NguonDo = NguonWeb | 'tichHop'
export interface BienTheDo { nguon: NguonDo; coMa: boolean; trangThai: string; tu: string; den: string; start: number; length: number; kyHieu?: string[] }

/** Bản ghi rút gọn để đo: giữ tên trường, cắt giá trị dài, object/mảng con chỉ còn khung */
function rutGon(o: any): any {
    if (!o || typeof o !== 'object' || Array.isArray(o)) return o
    return Object.fromEntries(Object.entries(o).map(([k, v]) => [k,
        typeof v === 'string' && v.length > 160 ? v.slice(0, 160) + '…'
            : v && typeof v === 'object' ? (Array.isArray(v) ? `[mảng ${v.length}]` : `{${Object.keys(v).slice(0, 15).join(', ')}}`)
                : v]))
}

/**
 * DÒ THÔ (chỉ đọc): gọi thẳng API danh sách theo từng biến thể, trả HÌNH dữ liệu MISA trả về + tối đa 2 bản ghi rút gọn — đo trước khi
 * map. 29/10/2026: soi HUTI ra 0 cả tuần mà không phân biệt được "không có hoá đơn" với "đọc sai chỗ / sai hình".
 */
export async function doTho(sp: any, kn: KetNoiMeInvoice, bienThe: BienTheDo[]) {
    const ket: any[] = []
    for (const b of bienThe) {
        const tichHop = b.nguon === 'tichHop'
        const duong = `${b.nguon === 'tichHop' ? '/invoice/paging' : NGUON_WEB[b.nguon].duong}?invoiceWithCode=${b.coMa ? 'true' : 'false'}`
        const than = tichHop
            ? { FromDate: b.tu, ToDate: b.den, Skip: b.start, Take: b.length, ListInvTemplate: b.kyHieu || [] }
            : { Start: b.start, Length: b.length, Sort: 'InvDate', FromDate: b.tu, ToDate: b.den, PublishStatus: b.trangThai }
        try {
            const { status, tv, text } = await goiApiTho(sp, kn, tichHop ? 'tichHop' : 'web', duong, than)
            const tach = tv.ok ? tachDanhSach(tv.data) : null
            const d = moChuoiJson(tv.data)
            ket.push({
                bienThe: { ...b, duong }, httpStatus: status, ok: tv.ok, loi: tv.loi || null,
                hinh: tv.ok ? moTaHinh(tv.data) : null,
                docDuoc: tach?.docDuoc ?? null, soDong: tach ? tach.ds.length : null, tong: tach?.tong ?? null,
                truong: tach?.ds[0] && typeof tach.ds[0] === 'object' ? Object.keys(tach.ds[0]).sort() : null,
                mau: tach ? tach.ds.slice(0, 2).map(rutGon) : null,
                // ký hiệu-số từng HĐ (không lộ người mua) — đối chiếu đủ/thiếu với màn hình MISA
                dsSo: tach ? tach.ds.slice(0, 100).map(r => `${docTruong(r, 'InvSeries') ?? ''}-${docTruong(r, 'InvNo') ?? ''}`) : null,
                // object mà không đọc ra danh sách ⇒ cho xem khung để biết danh sách nằm ở khoá nào
                khung: tach && !tach.docDuoc && d && typeof d === 'object' && !Array.isArray(d) ? rutGon(d) : null,
                // MISA báo lỗi / không phải JSON ⇒ mấy trăm ký tự đầu nguyên văn
                tho: !tv.ok ? String(text || '').slice(0, 600) : null,
            })
        } catch (e: any) {
            if (!(e instanceof LoiMeInvoice)) throw e
            ket.push({ bienThe: { ...b, duong }, ok: false, loi: e.message })
        }
    }
    return ket
}
