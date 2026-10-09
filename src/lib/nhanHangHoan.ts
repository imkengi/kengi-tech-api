// Đọc dòng trạm quay ghi vào ghi chú phiếu trả / đơn giao thất bại (09/10/2026).
// THUẦN — không DB — để lib/viecVuTra.ts (danh sách Việc cần làm) và lib/hangHoanHu.ts (đưa
// vào kho hư hỏng) dùng chung một luật mà không kéo nhau vòng tròn.
//
//   "[Nhận hàng hoàn] <giờ> — <tình trạng> — [video …] — ["ghi chú"] — <email người quay>"
//   "[Vào kho hư hỏng] <giờ> — 2×SHD1351 (trừ tồn bán được) — khiếu nại thắng lần 1"

export const DAU_NHAN_HOAN = '[Nhận hàng hoàn]'
export const DAU_VAO_KHO_HU = '[Vào kho hư hỏng]'

export interface LanNhanHoan {
    /** nguyên dòng, bỏ dấu đầu */
    dong: string
    luc: string
    /** "Vỡ, hư hỏng", "Khác: hộp móp…" — phần thứ hai của dòng */
    tinhTrang: string
    nguyenVen: boolean
    /** email người quay (phần cuối dòng nếu là email) */
    nguoi: string | null
}

/** Lần nhận hàng hoàn GẦN NHẤT. Nhãn bản cũ (sáng 09/10) có " — " bên trong ("Nguyên vẹn —
 *  bán lại được", "Lỗi kỹ thuật — không hoạt động") — chỉ cần phần đầu là đủ phân loại. */
export function lanNhanCuoi(notes?: string | null): LanNhanHoan | null {
    const goc = String(notes || '').split(/\r?\n/).map(d => d.trim()).filter(d => d.startsWith(DAU_NHAN_HOAN)).pop()
    if (!goc) return null
    const dong = goc.slice(DAU_NHAN_HOAN.length).trim()
    const phan = dong.split(' — ').map(p => p.trim())
    const tinhTrang = phan[1] || ''
    const cuoi = phan[phan.length - 1] || ''
    return {
        dong, luc: phan[0] || '', tinhTrang,
        nguyenVen: /^nguyên vẹn/i.test(tinhTrang),
        nguoi: /^[^\s@]+@[^\s@]+$/.test(cuoi) ? cuoi : null,
    }
}

export const daVaoKhoHu = (notes?: string | null) => String(notes || '').includes(DAU_VAO_KHO_HU)

/** Đã nhận, KHÔNG nguyên vẹn, CHƯA vào kho hư hỏng ⇒ còn chờ khiếu nại thắng. */
export function choKhieuNaiThang(notes?: string | null): LanNhanHoan | null {
    const n = lanNhanCuoi(notes)
    return n && !n.nguyenVen && !daVaoKhoHu(notes) ? n : null
}
