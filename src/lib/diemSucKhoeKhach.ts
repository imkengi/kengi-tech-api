/**
 * QUY SỨC KHOẺ TÀI CHÍNH KHÁCH RA ĐIỂM 0–100 — để chủ shop phân loại nhanh.
 *
 * Yêu cầu 18/08/2026: "thêm nhiều biểu đồ trong phần sức khoẻ tài chính, hãy
 * quy ra điểm cho dễ phân loại". Trước đó trang chỉ có nhãn `xepHang`
 * (tot/theo-doi/rui-ro) + hàng chục con số rời — nhìn từng khách thì được,
 * nhưng so 14 khách liên tiếp (cách chủ shop dùng thật, đo 18/08) thì không
 * có một con số nào để xếp cạnh nhau.
 *
 * BỐN THÀNH PHẦN, mỗi cái 25 điểm, cộng lại 100:
 *   1. Gánh nợ        — nợ hiện tại ÷ tổng mua toàn kỳ. Sổ 0 → đủ 25.
 *   2. Tuổi nợ        — tuổi nợ FIFO neo sổ (ngayNoLauNhat). Không nợ → 25;
 *                       giảm tuyến tính về 0 tại 90 ngày.
 *   3. Xu hướng & nhịp — 3 tháng gần vs 3 tháng trước; trừ thêm khi đang im
 *                       lâu hơn thường lệ.
 *   4. Mua chịu trong kỳ — nợ phát sinh (FIFO) ÷ mua trong kỳ.
 *
 * ⚠ ĐIỂM KHÔNG ĐƯỢC CÃI NHÃN. `xepHang` là cảnh báo nợ theo luật cứng mà chủ
 * shop đã xem cả sáng ("nợ già >90 ngày = rủi ro"). Nếu điểm nói "B – Khá"
 * trong khi nhãn nói "Rủi ro" là cùng một màn hình nói hai kiểu — đúng bẫy đã
 * dính ba lần ở dự án này. Nên điểm bị CHẶN TRẦN theo nhãn: rủi ro ⇒ ≤ 39,
 * theo dõi ⇒ ≤ 59 — bằng cách NÉN điểm thô vào dải (0–39 / 40–59) chứ không cắt
 * phẳng, để trong cùng nhãn khách tốt hơn vẫn điểm cao hơn. Bị nén thì nói thẳng
 * ra (`biChanTran` + `lyDoChan`), không âm thầm.
 *
 * ⚠ TÔN TRỌNG "sổ là nguồn sự thật": mọi thành phần nợ đọc từ hồ sơ đã neo
 * `Customer.debt` (FIFO). Cửa hàng KiotViet có khách trả gộp → phiếu treo đầy
 * nhưng sổ 0 → cờ `phieuTreoKhongPhaiNo` → thành phần "mua chịu" cho đủ điểm,
 * không trừ oan (dạng 10 của khong-buoc-toi-oan).
 *
 * ⚠ ĐỘ TIN CẬY đi kèm, không giấu: khách 2 đơn cũng ra một con số, nhưng con
 * số đó yếu. FE hiện `doTinCay` cạnh điểm để chủ shop biết mà không tin quá.
 */

import { tinhSucKhoeTaiChinh, gomTheoThang, type HoSoSucKhoe, type TongHopKyKhach, type PhieuNo } from './sucKhoeTaiChinhKhach'
import { tinhChiSoMoRong, type ChiSoMoRong } from './chiSoKhachMoRong'

export type HangDiem = 'A' | 'B' | 'C' | 'D'

export interface ThanhPhanDiem {
    ma: 'ganh-no' | 'tuoi-no' | 'xu-huong' | 'mua-chiu'
    ten: string
    diem: number
    toiDa: number
    /** Vì sao được/mất điểm — in nguyên văn lên FE. */
    giaiThich: string
}

export interface DiemSucKhoe {
    /** 0–100 sau khi chặn trần; null khi chưa đủ dữ liệu để chấm. */
    tong: number | null
    /** Điểm thô trước khi chặn — để FE nói "thô 65 nhưng chặn còn 39 vì…". */
    tho: number | null
    hang: HangDiem | null
    nhan: string
    thanhPhan: ThanhPhanDiem[]
    biChanTran: boolean
    lyDoChan: string | null
    /** Số đơn ít thì điểm yếu — nói ra, đừng giấu. */
    doTinCay: 'cao' | 'vua' | 'thap'
    lyDoTinCay: string
}

export const TOI_DA_MOI_PHAN = 25

/** Trần điểm theo nhãn cảnh báo nợ — điểm không được cãi nhãn. */
export const TRAN_THEO_XEP_HANG: Record<HoSoSucKhoe['xepHang'], number | null> = {
    'rui-ro': 39,
    'theo-doi': 59,
    'tot': null,
    'chua-du-du-lieu': null,
}

/** Sàn của dải nén theo nhãn: điểm thô trong [sàn, 100] được nén vào [sàn, trần] để giữ thứ tự trong nhóm. */
export const SAN_THEO_XEP_HANG: Record<HoSoSucKhoe['xepHang'], number | null> = {
    'rui-ro': 0,
    'theo-doi': 40,
    'tot': null,
    'chua-du-du-lieu': null,
}

/** Ngưỡng hạng theo điểm. */
export const NGUONG_HANG: Array<{ tu: number; hang: HangDiem; nhan: string }> = [
    { tu: 80, hang: 'A', nhan: 'Tốt' },
    { tu: 60, hang: 'B', nhan: 'Khá' },
    { tu: 40, hang: 'C', nhan: 'Cần theo dõi' },
    { tu: 0, hang: 'D', nhan: 'Rủi ro' },
]

export function hangCuaDiem(diem: number): { hang: HangDiem; nhan: string } {
    for (const n of NGUONG_HANG) if (diem >= n.tu) return { hang: n.hang, nhan: n.nhan }
    return { hang: 'D', nhan: 'Rủi ro' }
}

const kep = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x))
const lam = (x: number) => Math.round(x)
const pctS = (x: number) => `${Math.round(x * 100)}%`

/**
 * @param hoSo       kết quả tinhSucKhoeTaiChinh (đã neo Customer.debt)
 * @param tongHopKy  kết quả gomTheoThang(...).tongHop
 * @param moRong     kết quả tinhChiSoMoRong
 * @param soDon      tổng số đơn của khách (Customer.totalOrders) — cho độ tin cậy
 */
export function tinhDiemSucKhoe(
    hoSo: HoSoSucKhoe,
    tongHopKy: TongHopKyKhach | null | undefined,
    moRong: ChiSoMoRong | null | undefined,
    soDon: number,
): DiemSucKhoe {
    const M = TOI_DA_MOI_PHAN
    const thanhPhan: ThanhPhanDiem[] = []
    const coNo = (hoSo.duNo || 0) > 0

    // ── 1. Gánh nợ: nợ ÷ tổng mua ─────────────────────────────────────────
    {
        const ti = moRong?.noSauHon?.noTrenTongMua ?? 0
        /* KHÔNG ĐỌC ĐƯỢC ≠ KHÔNG CÓ (18/08/2026): khách có nợ nhưng chưa thấy mua trong kỳ (nợ nhập
         * từ KiotViet không kèm phiếu, hoặc nợ cũ hơn cửa sổ) → tỷ lệ = 0 chỉ vì mẫu số 0, không phải
         * vì nợ nhẹ. Đo HUTI: Giang HN30 nợ 16,9tr / 1 đơn / mua 0đ được chấm 56 như khách sạch.
         * Chấm TRUNG TÍNH (nửa điểm) và nói rõ, không cho đủ cũng không trừ oan. */
        const chuaThayMua = coNo && ti === 0 && (moRong?.noSauHon?.noBangMayThangMua ?? null) === null   // tỷ lệ 0 CHỈ VÌ mẫu số 0
        // 0% → đủ; 40% trở lên → 0. Tuyến tính ở giữa.
        const d = !coNo ? M : chuaThayMua ? lam(M / 2) : lam(M * kep(1 - ti / 0.4, 0, 1))
        thanhPhan.push({
            ma: 'ganh-no', ten: 'Gánh nợ', diem: d, toiDa: M,
            giaiThich: !coNo ? 'Sổ không ghi nợ'
                : chuaThayMua ? 'Có nợ nhưng chưa thấy mua trong kỳ — không tính được gánh nợ, chấm trung tính'
                : `Nợ bằng ${pctS(ti)} tổng mua${ti >= 0.4 ? ' — quá nặng' : ti >= 0.2 ? ' — đáng kể' : ''}`,
        })
    }

    // ── 2. Tuổi nợ (FIFO neo sổ) ──────────────────────────────────────────
    {
        const tuoi = hoSo.ngayNoLauNhat
        // Có nợ mà không có phiếu để neo FIFO (tuoi=null) → KHÔNG được coi như không nợ (bản đầu cho đủ 25):
        // chấm trung tính + nói rõ. Không nợ thì đủ điểm như cũ.
        const khongNeoDuoc = coNo && tuoi === null
        const d = !coNo ? M : khongNeoDuoc ? lam(M / 2) : lam(M * kep(1 - (tuoi as number) / 90, 0, 1))
        thanhPhan.push({
            ma: 'tuoi-no', ten: 'Tuổi nợ', diem: d, toiDa: M,
            giaiThich: !coNo ? 'Không có nợ theo sổ'
                : khongNeoDuoc ? 'Có nợ nhưng không có phiếu để neo tuổi nợ — chấm trung tính'
                : `Nợ già nhất ${tuoi} ngày${(tuoi as number) > 90 ? ' — quá hạn xa' : (tuoi as number) > 30 ? ' — cần theo dõi' : ''}`,
        })
    }

    // ── 3. Xu hướng & nhịp mua ────────────────────────────────────────────
    {
        const xh = moRong?.xuHuong?.nhan ?? 'chua-du-du-lieu'
        let d = xh === 'tang' ? M : xh === 'on-dinh' ? lam(M * 0.8) : xh === 'giam' ? lam(M * 0.4) : lam(M * 0.6)
        const gt: string[] = [
            xh === 'tang' ? 'Mua đang tăng' : xh === 'on-dinh' ? 'Mua ổn định' : xh === 'giam' ? 'Mua đang giảm' : 'Chưa đủ dữ liệu xu hướng',
        ]
        if (moRong?.nhipMua?.dangImLau) {
            d = Math.max(0, d - lam(M * 0.4))
            gt.push(`im ${moRong.nhipMua.ngayTuLanCuoi} ngày, lâu hơn nhịp thường lệ`)
        }
        thanhPhan.push({ ma: 'xu-huong', ten: 'Xu hướng & nhịp mua', diem: d, toiDa: M, giaiThich: gt.join(' · ') })
    }

    // ── 4. Mua chịu trong kỳ (FIFO neo sổ) ────────────────────────────────
    {
        const ti = tongHopKy?.tiLeNoTrenMuaKy ?? 0
        const d = (hoSo.phieuTreoKhongPhaiNo || !coNo) ? M : lam(M * kep(1 - ti, 0, 1))
        thanhPhan.push({
            ma: 'mua-chiu', ten: 'Mua chịu trong kỳ', diem: d, toiDa: M,
            giaiThich: hoSo.phieuTreoKhongPhaiNo ? 'Trả gộp / phiếu thu chung — không phải mua chịu'
                : !coNo ? 'Không còn nợ phát sinh trong kỳ'
                    : `Nợ phát sinh bằng ${pctS(ti)} tiền mua trong kỳ`,
        })
    }

    // ── Chưa đủ dữ liệu → không chấm ──────────────────────────────────────
    if (hoSo.xepHang === 'chua-du-du-lieu' || soDon <= 0) {
        return {
            tong: null, tho: null, hang: null, nhan: 'Chưa đủ dữ liệu', thanhPhan,
            biChanTran: false, lyDoChan: null,
            doTinCay: 'thap', lyDoTinCay: soDon <= 0 ? 'Khách chưa có đơn nào' : 'Chưa đủ dữ liệu để chấm',
        }
    }

    const tho = thanhPhan.reduce((s, t) => s + t.diem, 0)
    const tran = TRAN_THEO_XEP_HANG[hoSo.xepHang]
    /* NÉN VÀO DẢI, KHÔNG CẮT PHẲNG (18/08/2026). Bản đầu `tong = tran` khi thô > trần ⇒ HUTI: hơn
     * 100 khách có nợ đều hiện đúng "59" — mất hết thứ tự trong nhóm, "phân loại" thành ba cục
     * A / 59 / D, đúng thứ chủ shop nhờ làm cho dễ phân loại lại thành khó. Nay điểm thô trong
     * [sàn, 100] được nén tuyến tính vào [sàn, trần]: theo dõi 40–59, rủi ro 0–39 — vẫn không
     * vượt trần (điểm không cãi nhãn), nhưng khách thô 95 đứng trên khách thô 65. */
    const san = SAN_THEO_XEP_HANG[hoSo.xepHang] ?? 0
    let tong = tho, biChan = false
    if (tran !== null && tho > san) {
        const nen = san + Math.round((tho - san) * (tran - san) / (100 - san))
        tong = Math.min(tran, Math.max(san, nen))
        biChan = tong !== tho
    }
    const { hang, nhan } = hangCuaDiem(tong)

    const doTinCay: DiemSucKhoe['doTinCay'] = soDon >= 10 ? 'cao' : soDon >= 3 ? 'vua' : 'thap'
    const lyDoTinCay = soDon >= 10 ? `Dựa trên ${soDon} đơn`
        : soDon >= 3 ? `Chỉ ${soDon} đơn — điểm còn dao động`
            : `Chỉ ${soDon} đơn — điểm rất yếu, đừng dựa vào một mình nó`

    return {
        tong, tho, hang, nhan, thanhPhan,
        biChanTran: biChan,
        lyDoChan: biChan
            ? `Điểm thô ${tho} nhưng cảnh báo nợ ở mức "${hoSo.xepHang === 'rui-ro' ? 'rủi ro' : 'theo dõi'}" nên nén vào dải ${san}–${tran} còn ${tong} — điểm không được nói khoẻ hơn cảnh báo nợ, nhưng vẫn giữ thứ tự trong nhóm`
            : null,
        doTinCay, lyDoTinCay,
    }
}

// ─── MỘT CHUỖI TÍNH DÙNG CHUNG cho báo cáo chi tiết VÀ bảng tổng quan ─────────
//
// Bảng tổng quan (GET /customers/financial-overview) vốn tính bằng một câu SQL
// gộp, KHÔNG có FIFO nên không có tuổi nợ và không thể có điểm. Muốn có điểm
// trong bảng mà không đẻ ra HAI con điểm khác nhau cho cùng một khách ở hai màn
// hình, cả hai endpoint PHẢI đi qua đúng một hàm này với cùng đầu vào. Đây là
// cách "một nguồn sự thật" bằng cấu trúc, không cần test đối chiếu.


export interface TronBoSucKhoe {
    hoSo: HoSoSucKhoe
    theoThang: ReturnType<typeof gomTheoThang>
    moRong: ChiSoMoRong
    diem: DiemSucKhoe
}

/**
 * @param dauVao     phiếu của khách (đã map daTra = amountReceived), MỚI NHẤT trước
 * @param duNo       Customer.debt — nguồn sự thật
 * @param homNay     mốc "hôm nay" (truyền vào để test được)
 * @param soThang    kỳ báo cáo theo tháng (12 mặc định; 0 = tất cả)
 * @param soDon      Customer.totalOrders (độ tin cậy); rơi về dauVao.length nếu 0
 */
/** Kỳ CỐ ĐỊNH để chấm điểm — điểm là một thước đo, không được đổi khi người xem đổi kỳ hiển thị. */
export const KY_CHAM_DIEM_THANG = 12

export function tinhTronBo(dauVao: PhieuNo[], duNo: number, homNay: Date, soThang: number, soDon: number): TronBoSucKhoe {
    const hoSo = tinhSucKhoeTaiChinh(dauVao, duNo)
    const theoThang = gomTheoThang(dauVao, homNay, soThang, duNo)
    const moRong = tinhChiSoMoRong(dauVao, duNo, homNay)
    /* ĐIỂM LUÔN TÍNH TRÊN 12 THÁNG dù bảng tháng đang hiển thị 6 tháng hay tất cả.
     * Nếu không, cùng một khách ra hai điểm: chi tiết (kỳ 6 tháng) ≠ tổng quan (12) —
     * đúng cái bẫy "hai màn hình hai số" đã cố tránh. Chỉ tính lại khi kỳ ≠ 12. */
    const tongHopChamDiem = soThang === KY_CHAM_DIEM_THANG ? theoThang.tongHop : gomTheoThang(dauVao, homNay, KY_CHAM_DIEM_THANG, duNo).tongHop
    const diem = tinhDiemSucKhoe(hoSo, tongHopChamDiem, moRong, soDon || dauVao.length)
    return { hoSo, theoThang, moRong, diem }
}
