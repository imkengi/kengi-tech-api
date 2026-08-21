/**
 * CHỈ SỐ MỞ RỘNG CHO HỒ SƠ SỨC KHOẺ TÀI CHÍNH KHÁCH — chủ shop 18/08/2026:
 * "hãy thêm nhiều chỉ số nữa".
 *
 * Nguyên tắc chọn: mỗi chỉ số trả lời MỘT câu hỏi kinh doanh cụ thể, và mọi con
 * số buộc tội (nợ, chậm, quá hạn) đều neo vào SỔ (Customer.debt) qua FIFO —
 * không lấy phiếu treo thô (xem tapPhieuNoThat ở sucKhoeTaiChinhKhach.ts; đó là
 * bài học Thiên Hưng cùng ngày).
 *
 *   NHỊP MUA      — bao lâu mua một lần, lần cuối cách nay bao lâu, có đang im
 *                   lâu hơn thường lệ không (dấu hiệu sắp mất khách).
 *   ĐỘ LỚN ĐƠN    — giá trị đơn trung bình / trung vị / lớn nhất; đơn 3 tháng
 *                   gần đây to hơn hay nhỏ hơn thường lệ.
 *   XU HƯỚNG      — 3 tháng gần nhất so với 3 tháng liền trước (tiền + số đơn).
 *   NỢ SÂU HƠN    — nợ chiếm bao nhiêu % tổng mua; nợ bằng bao nhiêu tháng mua;
 *                   phân bố nợ THẬT theo bậc tuổi 0–30 / 31–60 / 61–90 / >90
 *                   (aging kế toán); phần nợ nằm ngoài phiếu.
 *   THÓI QUEN TRẢ — chỉ khi hệ có ngày trả đủ; không có → null, không bịa.
 */

import { type PhieuNo, TRANG_THAI_BAN, ngayCua, ngayVN, thangVN } from './sucKhoeTaiChinhKhach'

export interface ChiSoMoRong {
    nhipMua: {
        /** TB số ngày giữa hai NGÀY có mua (2 đơn cùng ngày = 1 lần) */
        tbNgayGiuaHaiLan: number | null
        /** Số ngày từ lần mua cuối tới hôm nay */
        ngayTuLanCuoi: number | null
        /** Đang im lâu hơn thường lệ: ngayTuLanCuoi ≥ 14 VÀ > 2 × tbNgayGiuaHaiLan */
        dangImLau: boolean
        soNgayCoMua: number
    }
    doLonDon: {
        tb: number
        trungVi: number
        lonNhat: number
        /** Đơn TB 3 tháng gần nhất ÷ TB toàn kỳ (1.0 = bằng, 1.5 = to hơn 50%); null nếu chưa có đơn gần */
        heSo3ThangGanNhat: number | null
    }
    xuHuong: {
        tien3ThangGan: number
        tien3ThangTruoc: number
        /** (gần − trước) ÷ trước; null nếu trước = 0 */
        tangTruongTien: number | null
        don3ThangGan: number
        don3ThangTruoc: number
        tangTruongDon: number | null
        nhan: 'tang' | 'giam' | 'on-dinh' | 'chua-du-du-lieu'
    }
    noSauHon: {
        /** duNo ÷ tổng mua toàn kỳ (0..1) */
        noTrenTongMua: number
        /** duNo ÷ mua TB tháng có mua — "nợ bằng mấy tháng mua"; null nếu chưa mua */
        noBangMayThangMua: number | null
        /** Phân bố nợ THẬT (FIFO) theo bậc tuổi, tiền; cộng lại + ngoaiPhieu = duNo */
        bacTuoi: { b0_30: number; b31_60: number; b61_90: number; tren90: number }
        /** Phần dư nợ KHÔNG nằm trong phiếu nào (nợ đầu kỳ nhập tay / ngoài hệ) */
        ngoaiPhieu: number
    }
    thoiQuenTra: {
        /** TB số ngày từ ngày bán tới ngày trả đủ — chỉ tính phiếu có ngày trả; không có → null */
        tbNgayTra: number | null
        soPhieuTinh: number
    }
}

const NGAY_MS = 86_400_000
/* TRANG_THAI_BAN / ngayCua / ngayVN / thangVN NHẬP từ sucKhoeTaiChinhKhach.ts —
 * bản đầu chép lại cả bốn, đúng cái bẫy hằng trùng mà check-hang-trung được
 * dựng để canh (cùng ngày). Chép rồi trôi lệch là hai hồ sơ nói hai kiểu. */

function trungVi(xs: number[]): number {
    if (!xs.length) return 0
    const s = [...xs].sort((a, b) => a - b)
    const m = Math.floor(s.length / 2)
    return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2)
}

/**
 * @param phieu      mọi phiếu của khách (đã map daTra = amountReceived)
 * @param duNo       Customer.debt — nguồn sự thật
 * @param ngayTraDu  (tùy chọn) id phiếu → ngày trả đủ; không có thì thoiQuenTra = null
 */
export function tinhChiSoMoRong(
    phieu: PhieuNo[],
    duNo: number,
    homNay: Date = new Date(),
    ngayTraDu?: Map<string, Date>,
): ChiSoMoRong {
    const daBan = phieu.filter(p => TRANG_THAI_BAN.has(String(p?.status)))
    const coNgay = daBan
        .map(p => ({ p, d: ngayCua(p) }))
        .filter((x): x is { p: PhieuNo; d: Date } => x.d !== null)

    // ── NHỊP MUA ──────────────────────────────────────────────────────────
    const ngayMua = [...new Set(coNgay.map(x => ngayVN(x.d)))].sort()
    let tbNgayGiuaHaiLan: number | null = null
    if (ngayMua.length >= 2) {
        const first = new Date(ngayMua[0] + 'T00:00:00Z').getTime()
        const last = new Date(ngayMua[ngayMua.length - 1] + 'T00:00:00Z').getTime()
        tbNgayGiuaHaiLan = Math.round((last - first) / NGAY_MS / (ngayMua.length - 1) * 10) / 10
    }
    const lanCuoi = coNgay.length ? coNgay.reduce((m, x) => (x.d > m ? x.d : m), coNgay[0].d) : null
    const ngayTuLanCuoi = lanCuoi ? Math.max(0, Math.floor((homNay.getTime() - lanCuoi.getTime()) / NGAY_MS)) : null
    const dangImLau = tbNgayGiuaHaiLan !== null && ngayTuLanCuoi !== null
        && ngayTuLanCuoi >= 14 && ngayTuLanCuoi > 2 * tbNgayGiuaHaiLan

    // ── ĐỘ LỚN ĐƠN ────────────────────────────────────────────────────────
    const gt = daBan.map(p => Number(p.total) || 0)
    const tb = gt.length ? Math.round(gt.reduce((a, b) => a + b, 0) / gt.length) : 0
    const moc90 = new Date(homNay.getTime() - 90 * NGAY_MS)
    const gt90 = coNgay.filter(x => x.d >= moc90).map(x => Number(x.p.total) || 0)
    const tb90 = gt90.length ? gt90.reduce((a, b) => a + b, 0) / gt90.length : 0
    const heSo3ThangGanNhat = tb > 0 && gt90.length ? Math.round((tb90 / tb) * 100) / 100 : null

    // ── XU HƯỚNG (3 tháng gần vs 3 tháng liền trước) ─────────────────────
    const moc180 = new Date(homNay.getTime() - 180 * NGAY_MS)
    const gan = coNgay.filter(x => x.d >= moc90)
    const truoc = coNgay.filter(x => x.d >= moc180 && x.d < moc90)
    const sum = (xs: typeof coNgay) => xs.reduce((s, x) => s + (Number(x.p.total) || 0), 0)
    const tien3ThangGan = Math.round(sum(gan))
    const tien3ThangTruoc = Math.round(sum(truoc))
    const tangTruongTien = tien3ThangTruoc > 0 ? Math.round(((tien3ThangGan - tien3ThangTruoc) / tien3ThangTruoc) * 1000) / 1000 : null
    const tangTruongDon = truoc.length > 0 ? Math.round(((gan.length - truoc.length) / truoc.length) * 1000) / 1000 : null
    let nhan: ChiSoMoRong['xuHuong']['nhan'] = 'chua-du-du-lieu'
    if (tangTruongTien !== null) nhan = tangTruongTien > 0.15 ? 'tang' : tangTruongTien < -0.15 ? 'giam' : 'on-dinh'

    // ── NỢ SÂU HƠN (neo sổ, FIFO) ────────────────────────────────────────
    const tongMua = gt.reduce((a, b) => a + b, 0)
    /* Đi lại đúng thứ tự FIFO (mới → cũ): phiếu mới nhất tính ĐỦ, chỉ phiếu
     * CUỐI CÙNG trong chuỗi bị cắt phần dư. Bản đầu kẹp TỈ LỆ đều mọi bậc → phiếu
     * mới bị bớt oan (ca 4 bộ kiểm: 0-30 ra 43 thay vì 60). */
    const duNoDuong = Math.max(0, duNo)
    const bac = { b0_30: 0, b31_60: 0, b61_90: 0, tren90: 0 }
    const treoMoiTruoc = coNgay
        .filter(x => String(x.p.status) === 'partial')
        .map(x => ({ d: x.d, con: Math.max(0, (Number(x.p.total) || 0) - (Number(x.p.daTra) || 0)) }))
        .filter(x => x.con > 0)
        .sort((a, b) => b.d.getTime() - a.d.getTime())
    let conPhaiPhu = duNoDuong
    let trongPhieu = 0
    for (const x of treoMoiTruoc) {
        if (conPhaiPhu <= 0) break
        const lay = Math.min(x.con, conPhaiPhu)          // phiếu biên chỉ lấy phần còn thiếu
        const tuoi = Math.floor((homNay.getTime() - x.d.getTime()) / NGAY_MS)
        if (tuoi <= 30) bac.b0_30 += lay
        else if (tuoi <= 60) bac.b31_60 += lay
        else if (tuoi <= 90) bac.b61_90 += lay
        else bac.tren90 += lay
        trongPhieu += lay
        conPhaiPhu -= lay
    }
    bac.b0_30 = Math.round(bac.b0_30); bac.b31_60 = Math.round(bac.b31_60)
    bac.b61_90 = Math.round(bac.b61_90); bac.tren90 = Math.round(bac.tren90)
    const ngoaiPhieu = Math.max(0, Math.round(duNoDuong - trongPhieu))
    const thangSet = new Set(coNgay.map(x => thangVN(x.d)))
    const tbThang = thangSet.size ? tongMua / thangSet.size : 0

    // ── THÓI QUEN TRẢ ────────────────────────────────────────────────────
    let tbNgayTra: number | null = null
    let soPhieuTinh = 0
    if (ngayTraDu && ngayTraDu.size) {
        const ds: number[] = []
        for (const x of coNgay) {
            const t = ngayTraDu.get(x.p.id)
            if (t) ds.push(Math.max(0, (t.getTime() - x.d.getTime()) / NGAY_MS))
        }
        if (ds.length) {
            tbNgayTra = Math.round((ds.reduce((a, b) => a + b, 0) / ds.length) * 10) / 10
            soPhieuTinh = ds.length
        }
    }

    return {
        nhipMua: { tbNgayGiuaHaiLan, ngayTuLanCuoi, dangImLau, soNgayCoMua: ngayMua.length },
        doLonDon: { tb, trungVi: trungVi(gt), lonNhat: gt.length ? Math.max(...gt) : 0, heSo3ThangGanNhat },
        xuHuong: { tien3ThangGan, tien3ThangTruoc, tangTruongTien, don3ThangGan: gan.length, don3ThangTruoc: truoc.length, tangTruongDon, nhan },
        noSauHon: {
            noTrenTongMua: tongMua > 0 ? Math.round((duNoDuong / tongMua) * 1000) / 1000 : 0,
            noBangMayThangMua: tbThang > 0 ? Math.round((duNoDuong / tbThang) * 10) / 10 : null,
            bacTuoi: bac,
            ngoaiPhieu,
        },
        thoiQuenTra: { tbNgayTra, soPhieuTinh },
    }
}
