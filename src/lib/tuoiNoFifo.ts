/**
 * PHÂN BỔ TUỔI NỢ FIFO NEO SỔ — dùng cho báo cáo tuổi nợ 131/331 (routes/tax.ts) và
 * bất kỳ chỗ nào cần chia một số dư sổ vào các rổ tuổi.
 *
 * Quy ước (cùng với trang Công Nợ, segments-live, lib/sucKhoeTaiChinhKhach): tiền trả
 * cover nợ CŨ trước ⇒ nợ còn lại nằm ở các chứng từ MỚI NHẤT. Đi từ chứng từ mới nhất
 * ngược về, mỗi chứng từ nhận min(còn lại, giá trị) vào rổ theo tuổi của NÓ, cho tới khi
 * cạn số dư. Phần số dư vượt quá mọi chứng từ = dư đầu kỳ không chứng từ (nhập tay /
 * đồng bộ) — có trước cả chứng từ cổ nhất trong hệ thống ⇒ rổ >90 kèm cờ, không giấu.
 *
 * Rổ: current ≤ 7 ngày · days30 8–30 · days60 31–60 · days90 61–90 · overdue90 > 90
 * ("current" ≤ 7 khớp "Dưới 7 ngày" của trang Công Nợ; bản cũ chỉ tính "hôm nay").
 */

export interface RoTuoiNo { current: number; days30: number; days60: number; days90: number; overdue90: number }
export interface ChungTuNo { ngay: Date; tien: number }
export interface KetQuaPhanBo {
    ro: RoTuoiNo
    /** Chứng từ cuối cùng được chạm tới (mốc tuổi nợ) — null nếu không có chứng từ nào */
    moc: Date | null
    /** Tuổi (ngày) tại mốc; ≥ 91 khi còn dư đầu kỳ không chứng từ */
    tuoiMoc: number
    /** Phần số dư không có chứng từ nào giải thích (đã dồn vào overdue90) */
    duDauKy: number
}

const NGAY = 86_400_000

export function roRong(): RoTuoiNo { return { current: 0, days30: 0, days60: 0, days90: 0, overdue90: 0 } }

export function doVaoRo(ro: RoTuoiNo, tuoi: number, tien: number): void {
    if (tien <= 0) return
    if (tuoi <= 7) ro.current += tien
    else if (tuoi <= 30) ro.days30 += tien
    else if (tuoi <= 60) ro.days60 += tien
    else if (tuoi <= 90) ro.days90 += tien
    else ro.overdue90 += tien
}

export function tuoiNgay(ngay: Date, homNay: Date): number {
    return Math.max(0, Math.floor((homNay.getTime() - ngay.getTime()) / NGAY))
}

/**
 * @param soDu     số dư sổ hiện tại (> 0)
 * @param chungTu  chứng từ phát sinh nợ (bất kỳ thứ tự — hàm tự sắp mới → cũ)
 */
export function phanBoTuoiNoFifo(soDu: number, chungTu: ChungTuNo[], homNay: Date = new Date()): KetQuaPhanBo {
    const ro = roRong()
    const ds = [...chungTu].filter(c => c && c.ngay instanceof Date && !isNaN(c.ngay.getTime()))
        .sort((a, b) => b.ngay.getTime() - a.ngay.getTime())
    let con = Math.max(0, Number(soDu) || 0)
    let moc: Date | null = null, tuoiMoc = 0
    for (const ct of ds) {
        if (con <= 0) break
        const phan = Math.min(con, Math.max(0, Number(ct.tien) || 0))
        if (phan <= 0) continue
        const tuoi = tuoiNgay(ct.ngay, homNay)
        doVaoRo(ro, tuoi, phan)
        con -= phan; moc = ct.ngay; tuoiMoc = tuoi
    }
    const duDauKy = con > 0 ? con : 0
    if (duDauKy > 0) ro.overdue90 += duDauKy
    return { ro, moc, tuoiMoc: duDauKy > 0 ? Math.max(tuoiMoc, 91) : tuoiMoc, duDauKy }
}
