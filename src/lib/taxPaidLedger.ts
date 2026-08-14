/**
 * TIỀN THUẾ ĐÃ NỘP — lấy từ SỔ, không suy từ trạng thái tờ khai.
 *
 * Vì sao phải có file riêng: sổ S4 (theo dõi nghĩa vụ thuế của hộ kinh doanh)
 * từng tính "đã nộp" bằng `taxDeclaration.status === 'paid'`. Model đó KHÔNG BAO
 * GIỜ mang trạng thái 'paid' — nơi lưu chỉ nhận draft | submitted | filed. Điều
 * kiện luôn sai, nên:
 *
 *   - cột "đã nộp" của sổ S4 luôn 0;
 *   - cột "còn phải nộp" luôn bằng TOÀN BỘ số thuế;
 *   - con số 0 đó chảy tiếp vào chỉ tiêu [13] "thuế đã tạm nộp trong năm" và
 *     [14] "còn phải nộp = [12] − [13]" của tờ quyết toán hiển thị trên giao
 *     diện — tức là tờ khai in ra nói hộ còn nợ đúng khoản họ đã nộp rồi.
 *
 * Hai cách chữa SAI đã cân nhắc và loại:
 *   1. Quy `filed` → đã nộp. Nộp tờ khai không phải nộp tiền; nói đã nộp trong
 *      khi chưa là sai theo chiều nguy hiểm hơn (người dùng yên tâm rồi bị phạt
 *      chậm nộp tiền thuế 0,03%/ngày theo Điều 59 Luật QLT 38/2019).
 *   2. Rải đều số tiền nộp cho các kỳ trong năm. Chứng từ không ghi kỳ thì
 *      không ai biết nó thuộc kỳ nào; rải đều là bịa số cho từng dòng sổ.
 *
 * Nguồn đáng tin duy nhất trong dữ liệu hiện có: bút toán chi tiền nộp thuế
 * Nợ 333x / Có 111,112. Bên Có phải là tiền mặt/ngân hàng để loại bút toán cấn
 * trừ 133 ↔ 3331 — cái đó chuyển vế trong nội bộ nhóm tài khoản thuế chứ không
 * phải chi tiền ra khỏi doanh nghiệp.
 */

export interface ButToanNopThue {
    date?: string
    amount?: number
    description?: string | null
    reference?: string | null
}

export interface KetQuaTienDaNop {
    /** Tiền đã nộp gán được về từng kỳ (khóa là `period` của tờ khai). */
    theoKy: Map<string, number>
    /** Tiền đã nộp mà chứng từ không cho biết thuộc kỳ nào. */
    chuaGanKy: number
    /** Tổng cả năm — gồm cả phần chưa gán được kỳ. */
    tongNam: number
    soChungTu: number
}

/** Các cách viết cùng một kỳ mà chứng từ có thể dùng: T06/2026, 06/2026, 2026-06. */
export function cacCachVietKy(period: string): string[] {
    const s = String(period || '').trim()
    if (!s) return []
    const ra = new Set<string>([s])
    const m = /^T?(\d{1,2})[\/-](\d{4})$/.exec(s) || /^(\d{4})-(\d{1,2})$/.exec(s)
    if (m) {
        // Nhận cả hai thứ tự tháng/năm và năm-tháng
        const la4Truoc = /^\d{4}/.test(m[1])
        const nam = la4Truoc ? m[1] : m[2]
        const thang = String(Number(la4Truoc ? m[2] : m[1])).padStart(2, '0')
        if (Number(thang) >= 1 && Number(thang) <= 12) {
            ra.add(`${thang}/${nam}`); ra.add(`T${thang}/${nam}`); ra.add(`${nam}-${thang}`)
        }
    }
    const q = /^Q(\d)[\/-](\d{4})$/.exec(s)
    if (q) { ra.add(`Q${q[1]}/${q[2]}`); ra.add(`quý ${q[1]}/${q[2]}`) }
    /* Chuỗi quá ngắn thì bỏ: khớp "1/2026" vào một câu bất kỳ là gán nhầm.
     * Ngưỡng 6 ký tự vừa đủ cho dạng ngắn nhất còn phân biệt được: "01/2026". */
    return [...ra].filter(k => k.length >= 6)
}

/**
 * Gán tiền đã nộp về đúng kỳ dựa trên chứng từ. Kỳ nào chứng từ không nhắc tới
 * thì KHÔNG gán — số đó nằm ở `chuaGanKy` và chỉ được cộng ở mức cả năm.
 *
 * `butToan === null` nghĩa là KHÔNG ĐỌC ĐƯỢC sổ (store cũ chưa có bảng bút
 * toán). Trả về null để nơi gọi hiện ô trống chứ đừng hiện số 0 — "chưa đọc
 * được" và "chưa nộp đồng nào" là hai chuyện khác nhau.
 */
export function tienThueDaNop(
    butToan: ButToanNopThue[] | null,
    kyCuaToKhai: string[],
): KetQuaTienDaNop | null {
    if (butToan === null) return null
    const theoKy = new Map<string, number>()
    let chuaGanKy = 0
    for (const e of butToan) {
        const tien = Number(e?.amount) || 0
        const van = `${e?.description || ''} ${e?.reference || ''}`
        const khop = kyCuaToKhai.find(k => cacCachVietKy(k).some(x => van.includes(x)))
        if (khop) theoKy.set(khop, (theoKy.get(khop) || 0) + tien)
        else chuaGanKy += tien
    }
    const tongNam = butToan.reduce((s, e) => s + (Number(e?.amount) || 0), 0)
    return { theoKy, chuaGanKy, tongNam, soChungTu: butToan.length }
}

/** Điều kiện Prisma cho bút toán nộp thuế trong một năm. */
export function dieuKienButToanNopThue(year: number) {
    return {
        date: { gte: `${year}-01-01`, lte: `${year}-12-31` },
        debitAccount: { startsWith: '333' },
        OR: [
            { creditAccount: { startsWith: '111' } },
            { creditAccount: { startsWith: '112' } },
        ],
    }
}

/** Câu giải thích nguồn số liệu — bắt buộc đi kèm, vì 0 có hai nghĩa. */
export function ghiChuNguonDaNop(kq: KetQuaTienDaNop | null): string {
    if (kq === null) return 'Chưa đọc được sổ nhật ký chung nên cột "đã nộp" để trống. Đây KHÔNG phải kết luận là chưa nộp.'
    if (kq.soChungTu === 0) return 'Chưa có bút toán nộp thuế nào trong sổ (Nợ 333x / Có 111,112) nên cột "đã nộp" bằng 0. Nếu đã nộp tiền thật thì ghi bút toán nộp thuế để sổ S4 và chỉ tiêu [13] khớp với thực tế.'
    const dau = `Lấy từ ${kq.soChungTu} bút toán nộp thuế trong sổ.`
    if (kq.chuaGanKy > 0) {
        return `${dau} Trong đó ${Math.round(kq.chuaGanKy).toLocaleString('vi-VN')} ₫ chưa gán được về kỳ nào (chứng từ không ghi kỳ) — đã cộng vào tổng năm, không rải cho từng kỳ.`
    }
    return dau
}
