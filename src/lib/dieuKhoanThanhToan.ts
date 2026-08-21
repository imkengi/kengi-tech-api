/**
 * ĐIỀU KHOẢN THANH TOÁN NHÀ CUNG CẤP — logic thuần, kiểm được.
 *
 * Yêu cầu chủ shop 18/08/2026: "thêm điều khoản thanh toán cho nhà cung cấp".
 * Trước đó FE đã gửi `paymentTerms` lên POST/PUT /suppliers và schema zod đã
 * nhận, nhưng route KHÔNG ghi và model KHÔNG có cột — rơi im lặng. Nay có hai
 * cột trên Supplier: `paymentTermDays` (số, để máy tính hạn) và `paymentTerms`
 * (nhãn hiển thị).
 *
 * Phiếu nhập đã có `dueDate` + `paymentTerm` ở CẤP PHIẾU từ trước. Quy tắc ưu
 * tiên: phiếu tự ghi hạn thì giữ; không ghi mà NCC có điều khoản thì suy ra;
 * cả hai đều không có thì để trống (KHÔNG bịa hạn — trống nghĩa là chưa thoả
 * thuận, khác với "trả ngay").
 */

/** Đọc số ngày từ nhãn tự do khi người dùng chỉ gõ nhãn: "Sau 30 ngày" → 30, "Net 45" → 45, "trả ngay"/"COD" → 0. */
export function suySoNgayTuNhan(nhan: string | null | undefined): number | null {
    const s = String(nhan || '').trim().toLowerCase()
    if (!s) return null
    if (/tr[aả]\s*ngay|cod|ti[eề]n\s*m[aặ]t\s*ngay|thanh\s*to[aá]n\s*ngay/.test(s)) return 0
    const m = s.match(/(\d{1,3})\s*(ng[aà]y|day|d\b|n\b)|net\s*(\d{1,3})|(\d{1,3})\s*$/)
    if (!m) return null
    const n = Number(m[1] || m[3] || m[4])
    return Number.isFinite(n) && n >= 0 && n <= 365 ? n : null
}

/**
 * Hạn trả của một phiếu nhập.
 * @param ngayNhap        ngày lập phiếu
 * @param dueDatePhieu    hạn phiếu tự ghi (ưu tiên tuyệt đối)
 * @param soNgayNcc       điều khoản NCC (paymentTermDays)
 */
export function tinhHanTra(
    ngayNhap: Date | string,
    dueDatePhieu: Date | string | null | undefined,
    soNgayNcc: number | null | undefined,
): Date | null {
    if (dueDatePhieu) {
        const d = dueDatePhieu instanceof Date ? dueDatePhieu : new Date(dueDatePhieu)
        if (!isNaN(d.getTime())) return d
    }
    if (soNgayNcc === null || soNgayNcc === undefined || !Number.isFinite(soNgayNcc) || soNgayNcc < 0) return null
    const g = ngayNhap instanceof Date ? new Date(ngayNhap.getTime()) : new Date(ngayNhap)
    if (isNaN(g.getTime())) return null
    g.setUTCDate(g.getUTCDate() + Math.floor(soNgayNcc))
    return g
}

/** Số ngày quá hạn (dương = đã quá, 0 = đúng hạn/chưa tới, null = không có hạn). */
export function soNgayQuaHan(hanTra: Date | null | undefined, homNay: Date = new Date()): number | null {
    if (!hanTra) return null
    const ms = homNay.getTime() - hanTra.getTime()
    return ms > 0 ? Math.floor(ms / 86_400_000) : 0
}

// ─── QUY TẮC ĐIỀU KHOẢN ĐẦY ĐỦ (18/08/2026, yêu cầu "thêm nhiều option như lúc nhập hàng") ──
//
// Form nhập hàng đã có 5 kiểu: trả ngay / sau N ngày / ngày cố định trong tháng /
// cuối tháng / ngày cụ thể. NCC trước đây chỉ lưu được "sau N ngày"
// (paymentTermDays). Nay lưu thêm KIỂU + tham số để phiếu nhập suy đúng hạn.
// Ngày tính theo GIỜ VN (+7): "cuối tháng" là cuối tháng ở Việt Nam, không phải UTC.

export type KieuDieuKhoan = 'net' | 'dom' | 'eom'

export interface QuyTacDieuKhoan {
    /** net = sau N ngày; dom = ngày cố định trong tháng; eom = cuối tháng. null/undefined = chưa đặt. */
    type?: KieuDieuKhoan | null
    /** net: số ngày (0 = trả ngay) */
    days?: number | null
    /** dom: ngày trong tháng 1..31 (quá số ngày của tháng thì lấy ngày cuối) */
    dom?: number | null
    /** dom/eom: 0 = tháng này, 1 = tháng sau, … */
    monthOffset?: number | null
}

const VN_MS = 7 * 3600_000
/** Tách (năm, tháng 0-11, ngày) theo giờ VN. */
function ymdVN(d: Date): { y: number; m: number; day: number } {
    const t = new Date(d.getTime() + VN_MS)
    return { y: t.getUTCFullYear(), m: t.getUTCMonth(), day: t.getUTCDate() }
}
/** Dựng mốc 00:00 giờ VN của (y, m, day) — trả về Date UTC tương ứng (17:00Z hôm trước). */
function mocVN(y: number, m: number, day: number): Date {
    return new Date(Date.UTC(y, m, day) - VN_MS)
}
const ngayCuoiThang = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate()

/**
 * Hạn trả theo quy tắc đầy đủ. Ưu tiên: dueDate phiếu tự ghi → quy tắc NCC → null.
 * Trả null (KHÔNG bịa) khi không có quy tắc — trống nghĩa là "chưa thoả thuận".
 */
export function tinhHanTraTheoQuyTac(
    ngayNhap: Date | string,
    dueDatePhieu: Date | string | null | undefined,
    quyTac: QuyTacDieuKhoan | null | undefined,
): Date | null {
    if (dueDatePhieu) {
        const d = dueDatePhieu instanceof Date ? dueDatePhieu : new Date(dueDatePhieu)
        if (!isNaN(d.getTime())) return d
    }
    if (!quyTac || !quyTac.type) return null
    const g = ngayNhap instanceof Date ? new Date(ngayNhap.getTime()) : new Date(ngayNhap)
    if (isNaN(g.getTime())) return null
    const { y, m, day } = ymdVN(g)
    if (quyTac.type === 'net') {
        const n = quyTac.days
        if (n === null || n === undefined || !Number.isFinite(n) || n < 0) return null
        return mocVN(y, m, day + Math.floor(n))
    }
    const off = Math.max(0, Math.floor(Number(quyTac.monthOffset) || 0))
    if (quyTac.type === 'eom') {
        return mocVN(y, m + off, ngayCuoiThang(y, m + off))
    }
    if (quyTac.type === 'dom') {
        const dm = Math.floor(Number(quyTac.dom) || 0)
        if (dm < 1 || dm > 31) return null
        const last = ngayCuoiThang(y, m + off)
        return mocVN(y, m + off, Math.min(dm, last))
    }
    return null
}

/** Nhãn hiển thị tự sinh từ quy tắc — MỘT chỗ, FE và BE dùng chung câu chữ. */
export function nhanQuyTac(q: QuyTacDieuKhoan | null | undefined): string | null {
    if (!q || !q.type) return null
    const thang = (o: number) => o === 0 ? 'tháng này' : o === 1 ? 'tháng sau' : `${o} tháng sau`
    const off = Math.max(0, Math.floor(Number(q.monthOffset) || 0))
    if (q.type === 'net') {
        const n = q.days ?? null
        if (n === null || n === undefined) return null
        return n === 0 ? 'Trả ngay' : `Sau ${n} ngày`
    }
    if (q.type === 'eom') return `Cuối ${thang(off)}`
    /* "Ngày 15 của 2 tháng sau" chứ không phải "Ngày 15 2 tháng sau" — hai con số dính nhau
     * đọc thành "ngày 152". Ca thật chủ shop nêu 21/08: mua tháng 1, công nợ 15 tháng 3. */
    if (q.type === 'dom') return q.dom ? `Ngày ${q.dom} ${off === 0 ? 'tháng này' : 'của ' + thang(off)}` : null
    return null
}

/**
 * Suy quy tắc từ các cột Supplier — chấp nhận cả bản ghi CŨ chỉ có paymentTermDays
 * (chưa có type): coi là 'net'. Đây là đường lùi để 9 cửa hàng đã đặt số ngày
 * hôm sáng 18/08 không bị mất điều khoản khi thêm cột type.
 */
export function quyTacTuSupplier(s: { paymentTermType?: string | null; paymentTermDays?: number | null; paymentTermDom?: number | null; paymentTermMonthOffset?: number | null } | null | undefined): QuyTacDieuKhoan | null {
    if (!s) return null
    const t = String(s.paymentTermType || '').toLowerCase()
    if (t === 'eom' || t === 'dom') return { type: t, days: null, dom: s.paymentTermDom ?? null, monthOffset: s.paymentTermMonthOffset ?? 0 }
    if (t === 'net' || (s.paymentTermDays !== null && s.paymentTermDays !== undefined)) {
        return { type: 'net', days: s.paymentTermDays ?? null, dom: null, monthOffset: null }
    }
    return null
}

/** Mức cảnh báo cho một hạn trả — MỘT chỗ ở BE, FE chỉ tô màu theo mức. */
export type MucHan = 'qua-han' | 'sap-den' | 'chua-den' | 'khong-han'
export function mucHanTra(hanTra: Date | null | undefined, homNay: Date = new Date(), sapDenNgay = 7): MucHan {
    if (!hanTra) return 'khong-han'
    const qua = soNgayQuaHan(hanTra, homNay)
    if (qua !== null && qua > 0) return 'qua-han'
    const conLai = Math.ceil((hanTra.getTime() - homNay.getTime()) / 86_400_000)
    return conLai <= sapDenNgay ? 'sap-den' : 'chua-den'
}
