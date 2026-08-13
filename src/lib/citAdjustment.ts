/**
 * QUYẾT TOÁN THUẾ TNDN CÓ ĐIỀU CHỈNH — hàm thuần, không chạm cơ sở dữ liệu.
 *
 * Phép tính quyết toán đang có trong hệ thống lấy thẳng lãi kế toán rồi nhân
 * 20%. Đó chính là chỗ chênh lệch lớn nhất giữa số doanh nghiệp tự khai và số
 * cơ quan thuế tính, vì thu nhập chịu thuế KHÔNG bằng lợi nhuận kế toán:
 *
 *      Thu nhập chịu thuế = Lợi nhuận kế toán
 *                         + các khoản chi KHÔNG được trừ   (Điều 4 TT 96/2015)
 *                         − các khoản giảm trừ
 *      Thu nhập tính thuế = Thu nhập chịu thuế − lỗ được chuyển (Điều 9 TT 78/2014)
 *
 * Hai dòng giữa trước đây bị bỏ qua hoàn toàn: số thuế tính ra luôn THẤP hơn số
 * thật, và người dùng yên tâm cho tới lúc bị truy thu.
 *
 * Phần khoản bị loại lấy đúng kết quả của bộ soát thuế (taxAudit) chứ không tự
 * tính lại — một nguồn sự thật, sửa luật một chỗ.
 */

export interface DongDieuChinh {
    ma: string
    ten: string
    giaTri: number
    canCu: string
    ghiChu?: string
}

export interface LoDuocChuyen {
    namPhatSinh: number
    loGoc: number
    daChuyenTruoc: number
    chuyenNamNay: number
    conLai: number
    /** Năm cuối cùng còn được chuyển — quá năm này là mất quyền */
    hanChuyenDen: number
}

export interface QuyetToanTndn {
    nam: number
    loiNhuanKeToan: number
    dieuChinhTang: DongDieuChinh[]
    tongDieuChinhTang: number
    dieuChinhGiam: DongDieuChinh[]
    tongDieuChinhGiam: number
    thuNhapChiuThue: number
    loChuyen: LoDuocChuyen[]
    tongLoChuyen: number
    thuNhapTinhThue: number
    thueSuat: number
    thueTndnPhaiNop: number
    daTamNop: number
    conPhaiNop: number
    /** So với cách tính cũ (lãi kế toán × thuế suất) thì chênh bao nhiêu */
    chenhSoVoiCachTinhThieu: number
    canhBao: string[]
    ghiChu: string
}

/** Thuế suất phổ thông — Điều 10 Luật Thuế TNDN */
export const THUE_SUAT_TNDN = 0.2

/** Lỗ được chuyển liên tục, tối đa 5 năm kể từ năm TIẾP SAU năm phát sinh lỗ */
export const SO_NAM_DUOC_CHUYEN_LO = 5

const r0 = (v: number) => Math.round(v || 0)
const vnd = (v: number) => Math.round(v || 0).toLocaleString('vi-VN')

/**
 * Phân bổ lỗ các năm trước vào năm quyết toán.
 *
 * Phải mô phỏng LẦN LƯỢT từng năm chứ không lấy tổng lỗ trừ thẳng: lỗ đã được
 * bù ở những năm ở giữa thì không còn để chuyển nữa, và lỗ quá 5 năm thì mất
 * quyền chuyển. Lấy tổng rồi trừ một lần là cách sai kinh điển, luôn ra số thuế
 * thấp hơn thực tế.
 *
 * @param laiLoTheoNam lãi (dương) / lỗ (âm) của từng năm, gồm cả năm quyết toán
 * @param namQuyetToan năm cần tính
 */
export function phanBoLoChuyen(
    laiLoTheoNam: Map<number, number>,
    namQuyetToan: number,
    thuNhapChiuThue: number,
): { loChuyen: LoDuocChuyen[]; tongLoChuyen: number } {
    type Kho = { nam: number; conLai: number; goc: number; daDung: number }
    const khoLo: Kho[] = []

    const namDau = namQuyetToan - SO_NAM_DUOC_CHUYEN_LO
    for (let n = namDau; n <= namQuyetToan; n++) {
        // Bỏ lỗ đã hết hạn chuyển: lỗ năm X chỉ được chuyển tới hết năm X+5
        for (const k of khoLo) if (n > k.nam + SO_NAM_DUOC_CHUYEN_LO) k.conLai = 0

        const laiLo = n === namQuyetToan ? thuNhapChiuThue : (laiLoTheoNam.get(n) ?? 0)

        if (laiLo < 0) {
            // Năm lỗ: ghi vào kho, không bù được gì
            if (n !== namQuyetToan) khoLo.push({ nam: n, conLai: -laiLo, goc: -laiLo, daDung: 0 })
            continue
        }

        // Năm lãi: bù lỗ cũ nhất trước
        let con = laiLo
        for (const k of khoLo.sort((a, b) => a.nam - b.nam)) {
            if (con <= 0) break
            if (k.conLai <= 0) continue
            const dung = Math.min(k.conLai, con)
            k.conLai -= dung
            con -= dung
            if (n === namQuyetToan) k.daDung += dung
            else k.daDung += 0   // đã dùng ở năm trước, không tính vào bảng năm nay
        }
    }

    const loChuyen: LoDuocChuyen[] = khoLo
        .filter(k => k.daDung > 0 || (k.conLai > 0 && namQuyetToan <= k.nam + SO_NAM_DUOC_CHUYEN_LO))
        .map(k => ({
            namPhatSinh: k.nam,
            loGoc: r0(k.goc),
            daChuyenTruoc: r0(k.goc - k.conLai - k.daDung),
            chuyenNamNay: r0(k.daDung),
            conLai: r0(k.conLai),
            hanChuyenDen: k.nam + SO_NAM_DUOC_CHUYEN_LO,
        }))
        .sort((a, b) => a.namPhatSinh - b.namPhatSinh)

    return { loChuyen, tongLoChuyen: r0(loChuyen.reduce((s, l) => s + l.chuyenNamNay, 0)) }
}

export function quyetToanTndn(dl: {
    nam: number
    /** Lợi nhuận kế toán trước thuế của năm quyết toán */
    loiNhuanKeToan: number
    /** Bảng khoản bị loại lấy từ bộ soát thuế — một nguồn sự thật */
    khoanBiLoai: Array<{ lyDo: string; canCu: string; chiPhiBiLoai: number; vatBiLoai: number }>
    /** Lãi/lỗ kế toán các năm trước (dương = lãi) */
    laiLoTheoNam: Map<number, number>
    /** Thuế TNDN đã tạm nộp trong năm */
    daTamNop: number
    thueSuat?: number
}): QuyetToanTndn {
    const thueSuat = dl.thueSuat ?? THUE_SUAT_TNDN
    const canhBao: string[] = []

    // ── Điều chỉnh tăng: chi không được trừ ──────────────────────────────────
    const dieuChinhTang: DongDieuChinh[] = (dl.khoanBiLoai || [])
        .filter(k => (k.chiPhiBiLoai || 0) > 0 || (k.vatBiLoai || 0) > 0)
        .map((k, i) => ({
            ma: `B4.${i + 1}`,
            ten: k.lyDo,
            /* VAT đầu vào không được khấu trừ cũng thành chi phí — nhưng chỉ được
             * trừ khi bản thân khoản chi hợp lệ. Khoản chi đã bị loại thì phần
             * thuế của nó cũng bị loại theo, nên cộng cả hai vào điều chỉnh tăng. */
            giaTri: r0((k.chiPhiBiLoai || 0) + (k.vatBiLoai || 0)),
            canCu: k.canCu,
        }))
    const tongDieuChinhTang = r0(dieuChinhTang.reduce((s, d) => s + d.giaTri, 0))

    /* Điều chỉnh giảm (thu nhập miễn thuế, hoàn nhập dự phòng…) không suy ra được
     * từ dữ liệu bán lẻ thông thường. Để 0 và nói rõ, thay vì bịa một con số làm
     * giảm thuế — bịa ở đây là tự tạo rủi ro truy thu. */
    const dieuChinhGiam: DongDieuChinh[] = []
    const tongDieuChinhGiam = 0

    const thuNhapChiuThue = r0(dl.loiNhuanKeToan + tongDieuChinhTang - tongDieuChinhGiam)

    // ── Chuyển lỗ ────────────────────────────────────────────────────────────
    const { loChuyen, tongLoChuyen } = thuNhapChiuThue > 0
        ? phanBoLoChuyen(dl.laiLoTheoNam, dl.nam, thuNhapChiuThue)
        : { loChuyen: [], tongLoChuyen: 0 }

    const thuNhapTinhThue = Math.max(0, r0(thuNhapChiuThue - tongLoChuyen))
    const thueTndnPhaiNop = r0(thuNhapTinhThue * thueSuat)
    const conPhaiNop = r0(thueTndnPhaiNop - (dl.daTamNop || 0))

    // Cách tính cũ: lãi kế toán × thuế suất, không điều chỉnh gì
    const thueCachCu = Math.max(0, r0(dl.loiNhuanKeToan * thueSuat))
    const chenh = r0(thueTndnPhaiNop - thueCachCu)

    if (tongDieuChinhTang > 0) {
        canhBao.push(`Có ${vnd(tongDieuChinhTang)}đ chi phí không được trừ phải cộng vào thu nhập chịu thuế — nếu chỉ lấy lãi kế toán nhân thuế suất thì khai thiếu ${vnd(chenh)}đ tiền thuế.`)
    }
    if (thuNhapChiuThue < 0) {
        canhBao.push(`Năm ${dl.nam} lỗ ${vnd(-thuNhapChiuThue)}đ sau điều chỉnh. Số lỗ này được chuyển vào thu nhập của các năm sau, liên tục và tối đa 5 năm (hết năm ${dl.nam + SO_NAM_DUOC_CHUYEN_LO}); phải kê trên phụ lục 03-2A/TNDN mới được chuyển.`)
    }
    const loSapHet = loChuyen.filter(l => l.conLai > 0 && l.hanChuyenDen === dl.nam)
    if (loSapHet.length > 0) {
        canhBao.push(`Lỗ năm ${loSapHet.map(l => l.namPhatSinh).join(', ')} hết hạn chuyển sau năm ${dl.nam} — phần chưa bù hết (${vnd(loSapHet.reduce((s, l) => s + l.conLai, 0))}đ) sẽ mất quyền chuyển.`)
    }
    if (conPhaiNop > 0) {
        canhBao.push(`Còn phải nộp ${vnd(conPhaiNop)}đ. Hạn nộp hồ sơ quyết toán và tiền thuế là ngày cuối tháng thứ 3 kể từ khi kết thúc năm (31/3/${dl.nam + 1}) — nộp muộn tính tiền chậm nộp 0,03%/ngày.`)
    } else if (conPhaiNop < 0) {
        canhBao.push(`Đã tạm nộp thừa ${vnd(-conPhaiNop)}đ — được bù trừ vào kỳ sau hoặc làm thủ tục hoàn theo Điều 60 Luật Quản lý thuế.`)
    }

    return {
        nam: dl.nam,
        loiNhuanKeToan: r0(dl.loiNhuanKeToan),
        dieuChinhTang,
        tongDieuChinhTang,
        dieuChinhGiam,
        tongDieuChinhGiam,
        thuNhapChiuThue,
        loChuyen,
        tongLoChuyen,
        thuNhapTinhThue,
        thueSuat,
        thueTndnPhaiNop,
        daTamNop: r0(dl.daTamNop),
        conPhaiNop,
        chenhSoVoiCachTinhThieu: chenh,
        canhBao,
        ghiChu: 'Lãi/lỗ các năm trước lấy theo SỔ KẾ TOÁN. Số lỗ được chuyển hợp lệ phải khớp tờ khai quyết toán đã nộp của các năm đó (phụ lục 03-2A/TNDN) — nếu hai số lệch nhau thì lấy theo tờ khai. Khoản điều chỉnh giảm để 0 vì không suy ra được từ dữ liệu bán lẻ; nếu có thu nhập miễn thuế thì kế toán tự bổ sung.',
    }
}
