// ─────────────────────────────────────────────────────────────────────────────
//  GIẢM TRỪ GIA CẢNH THUẾ TNCN — NGUỒN SỰ THẬT DUY NHẤT (14/11/2026)
//
//  Trước 14/11/2026 mức 11tr / 4,4tr viết cứng ở 6 chỗ BE + 4 chỗ FE ⇒ bảng lương, quyết toán năm,
//  phép soát thuế năm 2026 đều tính theo mức CŨ (thuế TNCN ra CAO hơn luật). Từ nay MỌI chỗ tính TNCN
//  từ tiền lương phải gọi file này. FE giữ bản sao `open-retail/src/lib/giamTruGiaCanh.ts`;
//  `npm run check:giam-tru` so hai bảng và chặn số viết cứng quay lại.
//
//  Mức theo NĂM KỲ TÍNH THUẾ (đã tra văn bản gốc 14/11/2026):
//    • 2020–2025: bản thân 11.000.000đ/tháng, mỗi người phụ thuộc 4.400.000đ/tháng
//      — NQ 954/2020/UBTVQH14. Quyết toán năm 2025 vẫn dùng mức này (Cục Thuế, CV 1296/CT-NVT).
//    • từ 2026:  15.500.000đ/tháng (186tr/năm) và 6.200.000đ/tháng
//      — NQ 110/2025/UBTVQH15 (thông qua 17/10/2025, hiệu lực 01/01/2026, áp dụng từ kỳ tính thuế 2026),
//        nay ghi thẳng ở khoản 1 Điều 10 Luật Thuế TNCN 109/2025/QH15 (khoản 2 Điều 29: phần tiền lương,
//        tiền công của cá nhân cư trú áp dụng từ kỳ tính thuế 2026).
//
//  NĂM KỲ TÍNH THUẾ của một khoản lương = năm TRẢ lương, không phải năm của tháng công — khoản 3 Điều 8
//  Luật 109/2025/QH15: "thời điểm xác định thu nhập tính thuế từ tiền lương, tiền công là thời điểm tổ
//  chức, cá nhân trả thu nhập cho người nộp thuế hoặc thời điểm người nộp thuế nhận được thu nhập".
//  Lương T12/2025 trả 09/01/2026 thuộc kỳ 2026 ⇒ mức mới (Thuế tỉnh Đồng Nai trả lời câu hỏi 261225-17
//  trên Cổng TTĐT Bộ Tài chính, portal.mof.gov.vn/hoidapcstc/home/cthoidap/158785).
//
//  ⚠ Phần mềm CHƯA lưu ngày trả lương thật: `paidAt` của PayrollRecord/PayrollPeriod là lúc BẤM "đã trả"
//  (nhập bù cả năm rồi bấm một lượt là cả năm dời sang năm sau), còn bút toán chi lương mang ngày CUỐI
//  THÁNG của kỳ. Nên chỉ dùng `ngayTra` khi người dùng nói rõ ngày trả; không có thì lấy năm của kỳ lương.
//
//  Đổi mức lần sau: THÊM một dòng vào BANG_MUC, đừng sửa dòng cũ — năm cũ vẫn phải ra số cũ.
// ─────────────────────────────────────────────────────────────────────────────

export interface MucGiamTruGiaCanh {
    /** Áp dụng từ kỳ tính thuế năm này cho tới dòng kế tiếp. */
    tuNam: number
    /** Giảm trừ cho bản thân người nộp thuế, đồng/tháng. */
    banThanThang: number
    /** Giảm trừ cho MỖI người phụ thuộc, đồng/tháng. */
    nguoiPhuThuocThang: number
    canCu: string
}

/** Xếp theo `tuNam` TĂNG dần. Không khai mức trước 2020 (9tr/3,6tr) vì phần mềm không có bảng lương
 *  nào trước đó — hỏi năm < 2020 thì NÉM, đừng lặng lẽ trả mức của năm khác. */
export const BANG_MUC_GIAM_TRU: readonly MucGiamTruGiaCanh[] = [
    { tuNam: 2020, banThanThang: 11_000_000, nguoiPhuThuocThang: 4_400_000, canCu: 'Nghị quyết 954/2020/UBTVQH14' },
    { tuNam: 2026, banThanThang: 15_500_000, nguoiPhuThuocThang: 6_200_000, canCu: 'Nghị quyết 110/2025/UBTVQH15; khoản 1 Điều 10 Luật Thuế TNCN 109/2025/QH15' },
]

/** Mức giảm trừ gia cảnh của KỲ TÍNH THUẾ `namKyTinhThue` (năm dương lịch, vd 2026). */
export function mucGiamTruGiaCanh(namKyTinhThue: number): MucGiamTruGiaCanh & { namKyTinhThue: number } {
    const nam = Number(namKyTinhThue)
    if (!Number.isInteger(nam) || nam < BANG_MUC_GIAM_TRU[0].tuNam || nam > 9999) {
        throw new RangeError(`Không có mức giảm trừ gia cảnh cho kỳ tính thuế "${namKyTinhThue}" (bảng chỉ khai từ ${BANG_MUC_GIAM_TRU[0].tuNam}).`)
    }
    let muc = BANG_MUC_GIAM_TRU[0]
    for (const m of BANG_MUC_GIAM_TRU) if (m.tuNam <= nam) muc = m
    return { ...muc, namKyTinhThue: nam }
}

/** Năm dương lịch theo giờ Việt Nam (UTC+7) của một mốc thời gian; không đọc được ⇒ null. */
export function namTheoGioVN(ngay: Date | string | number | null | undefined): number | null {
    if (ngay === null || ngay === undefined || ngay === '') return null
    const ms = new Date(ngay as any).getTime()
    if (!Number.isFinite(ms)) return null
    return new Date(ms + 7 * 3600_000).getUTCFullYear()
}

/** Năm kỳ tính thuế của MỘT kỳ lương: có ngày trả lương ⇒ năm của ngày trả (khoản 3 Điều 8 Luật
 *  109/2025/QH15); không có ⇒ năm của kỳ lương. Ngày trả có nhưng không đọc được ⇒ NÉM — đoán sai năm
 *  là đổi mức giảm trừ của cả kỳ. */
export function namKyTinhThueLuong(kyLuong: { nam: number; ngayTra?: Date | string | number | null }): number {
    const { nam, ngayTra } = kyLuong
    if (ngayTra === null || ngayTra === undefined || ngayTra === '') return Number(nam)
    const namTra = namTheoGioVN(ngayTra)
    if (namTra === null) throw new RangeError(`Ngày trả lương không hợp lệ: "${String(ngayTra)}"`)
    return namTra
}

/** Tổng giảm trừ gia cảnh MỘT tháng cho một người: bản thân + số người phụ thuộc × mức mỗi người. */
export function giamTruThang(namKyTinhThue: number, soNguoiPhuThuoc: number) {
    const muc = mucGiamTruGiaCanh(namKyTinhThue)
    const npt = Math.max(0, Math.floor(Number(soNguoiPhuThuoc) || 0))
    const banThan = muc.banThanThang
    const nguoiPhuThuoc = npt * muc.nguoiPhuThuocThang
    return { banThan, nguoiPhuThuoc, tong: banThan + nguoiPhuThuoc, muc }
}

/** Cho phép SOÁT (thà im còn hơn báo sai): giảm trừ một tháng CAO NHẤT có thể áp cho kỳ lương khi không
 *  chắc ngày trả. Lương tháng 12 hay trả sang tháng 1 năm sau ⇒ kỳ tính thuế có thể là năm sau (mức mới
 *  cao hơn) — soát theo mức thấp là tố oan người đã tính đúng theo mức mới. */
export function giamTruThangToiDa(kyLuong: { nam: number; thang: number }, soNguoiPhuThuoc: number) {
    const nam = Number(kyLuong.nam)
    const cungNam = giamTruThang(nam, soNguoiPhuThuoc)
    if (Number(kyLuong.thang) !== 12) return cungNam
    const namSau = giamTruThang(nam + 1, soNguoiPhuThuoc)
    return namSau.tong > cungNam.tong ? namSau : cungNam
}
