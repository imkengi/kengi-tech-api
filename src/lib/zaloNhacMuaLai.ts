/**
 * NHẮC MUA LẠI TRƯỚC NGÀY HAY MUA — CHĂM SÓC KHÁCH QUA ZALO (28/10/2026)
 *
 * Chủ shop: "khi đã xác định được số ngày hay mua thì bên gửi tin chăm sóc khách hàng sẽ có mục chăm sóc khách hàng,
 * nghĩa là trước 1 ngày sẽ gợi ý những mặt hàng đã lâu rồi không mua (những mặt hàng này sẽ là được chọn nhóm hàng gợi ý)".
 *
 * Biến: {thuHayMua} {hangLauKhongMua} {hangLauKhongMuaChiTiet} {soMonLauKhongMua}. Bộ lọc người nhận `doiTuong.chiKhachMaiHayMua` = chỉ khách mà
 * NGÀY MAI (giờ VN) là thứ hay mua VÀ có ít nhất một món lâu chưa mua; nhóm hàng được gợi ý = `doiTuong.nhomHangGoiY`
 * (rỗng = mọi nhóm). Lịch đặt chạy hằng ngày (vd 17:00) ⇒ mỗi khách nhận tin đúng một hôm trước ngày mình hay ghé.
 *
 * THỨ HAY MUA — cùng luật với thẻ "Hay mua vào" ở tab Sơ đồ mua hàng (FE SoDoMuaHang.tsx, 28/10): đếm PHIẾU theo thứ
 * (ngày bán = transactionDate ?? createdAt, đổi sang giờ VN) trong 12 tháng; chỉ gọi là thói quen khi ≥ 4 phiếu, thứ cao
 * nhất chiếm ≥ 1/4 số phiếu và tối đa 2 thứ ngang nhau. Hai nơi lệch luật là web nói "hay mua thứ Bảy" mà tin không gửi.
 *
 * MÓN LÂU CHƯA MUA — "đến lượt / quá hạn" của Sơ đồ mua hàng: món mua ≥ 2 lần, nhịp = (lần cuối − lần đầu)/(số lần − 1)
 * ≥ 1 ngày, kể từ lần cuối đã qua ≥ nhịp − 3 ngày (tin đi trước một hôm nên món tới lượt trong 3 ngày tới cũng nhắc),
 * và CHƯA "thôi mua" (quá max(4 × nhịp, nhịp + 90) ngày là khách đã bỏ món — nhắc là làm phiền, luật này cũng của Sơ đồ).
 * Nhịp đọc 24 tháng (một món mua 2 lần/năm cần 2 năm mới thấy nhịp). Hàng đã xoá khỏi danh mục không vào (JOIN Product).
 * Hàng trả: không trừ — khách trả vẫn là "đã mua" theo nghĩa thói quen; Sơ đồ cũng tính vậy.
 *
 * 29/10/2026 — chủ shop xem trước tin rồi chê "sao trông nó rối thế": 7 dòng "- tên (lần cuối dd/mm, hay lấy N)" đọc như
 * bảng kê, "hay lấy 4" không ai hiểu 4 gì. {hangLauKhongMua} nay chỉ là danh sách ĐÁNH SỐ tên món (khách trả lời "lấy
 * món 1, 3" được); ai cần ngày mua cuối + số lượng thường lấy thì dùng {hangLauKhongMuaChiTiet} (đơn vị = Product.baseUnit).
 */

import { TRANG_THAI_TINH } from './tinhLaiTongMuaKhach'
import { moRongNhom } from './zaloDoanhSo'

const LECH_VN_MS = 7 * 3600_000
const NGAY_MS = 86_400_000
export const THANG_THU = 12          // cửa sổ đếm phiếu theo thứ
export const THANG_NHIP = 24         // cửa sổ đọc nhịp mua từng món
export const TOI_DA_MON = 8          // số món nhiều nhất trong một tin
export const SOM_NGAY = 3            // tới lượt trong 3 ngày tới cũng nhắc

/** Tên thứ theo Date.getDay() (0 = Chủ nhật) */
export const TEN_THU = ['Chủ nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy']

/** Tin có dùng biến nhắc mua lại? */
export const dungBienNhacMuaLai = (noiDung: string) => /\{\s*(thuHayMua|hangLauKhongMua|hangLauKhongMuaChiTiet|soMonLauKhongMua)\s*\}/i.test(String(noiDung || ''))

export interface ThuHayMua { dinh: number[]; ro: boolean; tong: number; max: number }
export interface MonGoiY { productId: string; ten: string; sku: string | null; donVi: string; lanCuoi: Date; nhipNgay: number; quaNgay: number; soLan: number; slMoiLan: number }
export interface ThoiQuenMua { thu: ThuHayMua; mon: MonGoiY[] }

/** Thứ hay mua từ số phiếu theo thứ (mảng 7 phần tử, chỉ số = getDay) */
export function thuHayMua(dem: number[]): ThuHayMua {
    const d = Array.from({ length: 7 }, (_, i) => Math.max(0, Number(dem[i]) || 0))
    const tong = d.reduce((a, b) => a + b, 0)
    const max = Math.max(...d)
    const dinh = max > 0 ? d.map((so, thu) => (so === max ? thu : -1)).filter(t => t >= 0) : []
    return { dinh, ro: tong >= 4 && max / tong >= 0.25 && dinh.length <= 2, tong, max }
}

/** Một món có đang "lâu chưa mua" không. `lanMua` = các NGÀY mua (bất kỳ thứ tự). null = chưa tới lượt / mua 1 lần / thôi mua. */
export function monLauKhongMua(lanMua: Date[], luc: Date): { lanCuoi: Date; nhipNgay: number; quaNgay: number } | null {
    const ds = [...new Set(lanMua.map(d => d.getTime()))].sort((a, b) => a - b)
    if (ds.length < 2) return null
    const dau = ds[0]!, cuoi = ds[ds.length - 1]!
    const nhip = (cuoi - dau) / NGAY_MS / (ds.length - 1)
    if (nhip < 1) return null                                   // mua dồn một lúc, không có nhịp
    const qua = Math.floor((luc.getTime() - cuoi) / NGAY_MS)
    if (qua < 0) return null
    if (qua > Math.max(4 * nhip, nhip + 90)) return null         // thôi mua
    if (qua < nhip - SOM_NGAY) return null                       // chưa tới lượt
    return { lanCuoi: new Date(cuoi), nhipNgay: Math.round(nhip), quaNgay: qua }
}

/** Thứ (getDay) của NGÀY MAI theo giờ VN */
export const thuNgayMaiVN = (luc: Date) => new Date(luc.getTime() + LECH_VN_MS + NGAY_MS).getUTCDay()

/** Khách này mai có phải ngày hay mua không */
export const maiLaNgayHayMua = (tq: ThoiQuenMua | undefined, luc: Date) => !!tq && tq.thu.ro && tq.thu.dinh.includes(thuNgayMaiVN(luc))

/**
 * Thói quen mua của từng khách: thứ hay mua + các món lâu chưa mua (lọc theo nhóm hàng đã chọn, kể cả nhóm con).
 * Hai câu SQL gộp cho CẢ danh sách khách — lịch nhắc chạy mỗi ngày cho hàng trăm nhóm Zalo, không hỏi từng người.
 */
export async function thoiQuenMuaCuaKhach(
    sp: any, customerIds: string[], opts: { luc?: Date; categoryIds?: string[]; toiDaMon?: number } = {},
): Promise<Map<string, ThoiQuenMua>> {
    const ra = new Map<string, ThoiQuenMua>()
    const khach = [...new Set(customerIds.filter(Boolean))]
    if (!khach.length) return ra
    const luc = opts.luc || new Date()
    const toiDa = opts.toiDaMon ?? TOI_DA_MON
    const categoryIds = opts.categoryIds || []
    const { tatCa } = await moRongNhom(sp, categoryIds)
    if (categoryIds.length && !tatCa.length) return ra          // nhóm đã chọn không còn trong danh mục ⇒ không món nào
    const tuThu = new Date(luc.getTime() - THANG_THU * 30.5 * NGAY_MS)
    const tuNhip = new Date(luc.getTime() - THANG_NHIP * 30.5 * NGAY_MS)

    const theoThu: any[] = await sp.$queryRawUnsafe(
        `SELECT t."customerId" AS k,
                EXTRACT(DOW FROM (COALESCE(t."transactionDate", t."createdAt") + interval '7 hours'))::int AS thu,
                COUNT(*)::int AS so
           FROM "Transaction" t
          WHERE t."customerId" = ANY($1::text[]) AND t."status" = ANY($2::text[])
            AND COALESCE(t."transactionDate", t."createdAt") >= $3
          GROUP BY 1, 2`,
        khach, [...TRANG_THAI_TINH], tuThu,
    )
    const dem = new Map<string, number[]>()
    for (const r of theoThu) {
        const d = dem.get(r.k) || Array(7).fill(0)
        d[Number(r.thu)] = Number(r.so) || 0
        dem.set(r.k, d)
    }
    for (const id of khach) ra.set(id, { thu: thuHayMua(dem.get(id) || []), mon: [] })

    // Ngày mua từng món — gom theo NGÀY VN, trả chuỗi 'YYYY-MM-DD' (Prisma đọc text[] chắc hơn timestamp[])
    const locNhom = categoryIds.length ? `AND p."categoryId" = ANY($4::text[])` : ''
    const thamSo: any[] = [khach, [...TRANG_THAI_TINH], tuNhip]
    if (categoryIds.length) thamSo.push(tatCa)
    const mon: any[] = await sp.$queryRawUnsafe(
        `SELECT t."customerId" AS k, ti."productId" AS p, p."name" AS ten, p."sku" AS sku, p."baseUnit" AS dv,
                array_agg(DISTINCT to_char(COALESCE(t."transactionDate", t."createdAt") + interval '7 hours', 'YYYY-MM-DD')) AS ngay,
                COALESCE(SUM(ti."quantity"), 0)::float AS sl
           FROM "Transaction" t
           JOIN "TransactionItem" ti ON ti."transactionId" = t."id"
           JOIN "Product" p ON p."id" = ti."productId"
          WHERE t."customerId" = ANY($1::text[]) AND t."status" = ANY($2::text[])
            AND COALESCE(t."transactionDate", t."createdAt") >= $3 ${locNhom}
          GROUP BY 1, 2, 3, 4, 5`,
        ...thamSo,
    )
    for (const r of mon) {
        const tq = ra.get(r.k)
        if (!tq) continue
        const ngay = (Array.isArray(r.ngay) ? r.ngay : []).map((s: string) => new Date(Date.parse(`${s}T00:00:00+07:00`))).filter((d: Date) => Number.isFinite(d.getTime()))
        const kq = monLauKhongMua(ngay, luc)
        if (!kq) continue
        const soLan = new Set(ngay.map((d: Date) => d.getTime())).size
        tq.mon.push({ productId: r.p, ten: String(r.ten || ''), sku: r.sku || null, donVi: String(r.dv || '').trim(), lanCuoi: kq.lanCuoi, nhipNgay: kq.nhipNgay, quaNgay: kq.quaNgay, soLan, slMoiLan: Math.max(1, Math.round((Number(r.sl) || 0) / soLan)) })
    }
    // Quá lượt nhiều nhất lên đầu; tin chỉ nêu TOI_DA_MON món kẻo dài
    for (const tq of ra.values()) {
        tq.mon.sort((a, b) => (b.quaNgay - b.nhipNgay) - (a.quaNgay - a.nhipNgay))
        if (tq.mon.length > toiDa) tq.mon = tq.mon.slice(0, toiDa)
    }
    return ra
}

const ddmm = (d: Date) => { const v = new Date(d.getTime() + LECH_VN_MS); return `${String(v.getUTCDate()).padStart(2, '0')}/${String(v.getUTCMonth() + 1).padStart(2, '0')}` }

/**
 * Biến chèn vào tin của MỘT khách. Không có thói quen rõ / không có món ⇒ KHÔNG đặt biến đó: zaloGui.dienMau bỏ cả
 * dòng còn chứa biến (như {noDauNgay}) — đừng gửi "mấy món này lâu chưa lấy:" rồi trống không.
 */
export function bienNhacMuaLai(tq: ThoiQuenMua | undefined): Record<string, string> {
    const bien: Record<string, string> = {}
    if (!tq) return bien
    if (tq.thu.ro) bien.thuHayMua = tq.thu.dinh.map(t => TEN_THU[t]).join(' và ')
    if (tq.mon.length) {
        bien.hangLauKhongMua = tq.mon.map((m, i) => `${i + 1}. ${m.ten}`).join('\n')
        bien.hangLauKhongMuaChiTiet = tq.mon.map((m, i) => `${i + 1}. ${m.ten} (lần cuối ${ddmm(m.lanCuoi)}, thường lấy ${m.slMoiLan}${m.donVi ? ` ${m.donVi}` : ''})`).join('\n')
        bien.soMonLauKhongMua = String(tq.mon.length)
    }
    return bien
}
