/**
 * LỊCH NGHĨA VỤ THUẾ — hàm thuần, không chạm cơ sở dữ liệu.
 *
 * Bản trước sinh lịch theo kiểu "có gì sinh nấy": vừa tờ khai GTGT tháng vừa tờ
 * khai GTGT quý cho MỌI cửa hàng, cộng thêm tờ khai TNDN tạm tính quý. Ba vấn
 * đề, cái sau nặng hơn cái trước:
 *
 *  1. Một cửa hàng chỉ khai theo THÁNG hoặc theo QUÝ, không bao giờ cả hai. Nửa
 *     số hạn nộp sinh ra là việc không bao giờ làm, và tới ngày chúng tự chuyển
 *     sang "quá hạn" — người dùng mở trang ra thấy một bức tường báo động giả.
 *     Báo động giả nhiều thì người ta ngừng đọc, đúng lúc có cái thật thì bỏ qua.
 *  2. Hộ kinh doanh không nộp 03/TNDN và không nộp báo cáo tài chính, nhưng vẫn
 *     bị hiện hai mục đó.
 *  3. "Tờ khai TNDN tạm tính quý" đã BỎ từ năm 2015 (Thông tư 151/2014/TT-BTC).
 *     Nay doanh nghiệp chỉ TẠM NỘP tiền theo quý (Điều 55 NĐ 126/2020) và quyết
 *     toán một lần cuối năm.
 *
 * Vì vậy lịch phải sinh theo LOẠI HÌNH và KỲ KÊ KHAI thật của cửa hàng.
 */

export type LoaiHinh = 'company' | 'household'
export type KyKeKhai = 'month' | 'quarter'

export interface MocNghiaVu {
    taxType: string
    period: string
    /** YYYY-MM-DD */
    dueDate: string
    description: string
    /** Điều khoản làm căn cứ cho hạn nộp này */
    canCu: string
    /** Nộp TỜ KHAI hay chỉ NỘP TIỀN — hai việc khác nhau, hay bị nhầm */
    loaiViec: 'to-khai' | 'nop-tien' | 'bao-cao'
}

const p2 = (n: number) => String(n).padStart(2, '0')
const ngay = (y: number, m: number, d: number) => `${y}-${p2(m)}-${p2(d)}`
const cuoiThang = (y: number, m: number) => new Date(y, m, 0).getDate()

/** Ngưỡng doanh thu năm trước để phải khai GTGT theo THÁNG — Điều 9 NĐ 126/2020 */
export const NGUONG_KHAI_THEO_THANG = 50_000_000_000

/**
 * Suy ra kỳ kê khai GTGT khi cửa hàng chưa khai báo.
 *
 * Luật cho khai theo quý nếu doanh thu năm trước từ 50 tỷ trở xuống; cơ sở mới
 * thành lập cũng bắt đầu bằng quý. Đa số cửa hàng bán lẻ thuộc nhóm này, nên khi
 * không biết gì thì mặc định QUÝ là an toàn: sinh ít mốc hơn và không đẻ ra một
 * loạt "quá hạn" giả.
 */
export function suyKyKeKhai(doanhThuNamTruoc: number | null): KyKeKhai {
    if (doanhThuNamTruoc === null) return 'quarter'
    return doanhThuNamTruoc > NGUONG_KHAI_THEO_THANG ? 'month' : 'quarter'
}

export function lichNghiaVuThue(
    year: number,
    tuyChon: {
        loaiHinh: LoaiHinh
        kyKeKhai: KyKeKhai
        /** Có trả lương cho người lao động không — quyết định nghĩa vụ TNCN */
        coNhanVien: boolean
    },
): MocNghiaVu[] {
    const { loaiHinh, kyKeKhai, coNhanVien } = tuyChon
    const out: MocNghiaVu[] = []
    const laHkd = loaiHinh === 'household'

    /** Hạn nộp hồ sơ khai thuế — Điều 44 Luật Quản lý thuế 38/2019 */
    const hanThang = (m: number) => {
        const y = m === 12 ? year + 1 : year
        const mm = m === 12 ? 1 : m + 1
        return ngay(y, mm, 20)
    }
    const hanQuy = (q: number) => {
        const thangCuoi = q * 3
        const y = thangCuoi === 12 ? year + 1 : year
        const mm = thangCuoi === 12 ? 1 : thangCuoi + 1
        return ngay(y, mm, cuoiThang(y, mm))
    }

    // ── Lệ phí môn bài: cả hai loại hình ─────────────────────────────────────
    out.push({
        taxType: 'MON_BAI',
        period: `MB-${year}`,
        dueDate: ngay(year, 1, 30),
        description: laHkd
            ? `Lệ phí môn bài ${year} — hộ kinh doanh: 300k/500k/1tr theo doanh thu năm trước`
            : `Lệ phí môn bài ${year} — doanh nghiệp: 2tr (vốn ≤10 tỷ) / 3tr (vốn >10 tỷ)`,
        canCu: 'Điều 5 NĐ 139/2016/NĐ-CP, sửa đổi bởi NĐ 22/2020/NĐ-CP',
        loaiViec: 'nop-tien',
    })

    if (laHkd) {
        /* Hộ kinh doanh nộp thuế theo phương pháp kê khai dùng tờ khai 01/CNKD.
         * Từ 01/01/2026 bỏ hẳn thuế khoán (Nghị quyết 198/2025/QH15) nên mọi hộ
         * đều phải kê khai theo doanh thu thực. */
        const soKy = kyKeKhai === 'month' ? 12 : 4
        for (let i = 1; i <= soKy; i++) {
            out.push({
                taxType: '01_CNKD',
                period: kyKeKhai === 'month' ? `T${p2(i)}/${year}` : `Q${i}/${year}`,
                dueDate: kyKeKhai === 'month' ? hanThang(i) : hanQuy(i),
                description: `Tờ khai thuế hộ kinh doanh 01/CNKD ${kyKeKhai === 'month' ? `tháng ${i}` : `quý ${i}`}/${year}`,
                canCu: 'Thông tư 40/2021/TT-BTC; Điều 44 Luật Quản lý thuế 38/2019',
                loaiViec: 'to-khai',
            })
        }
    } else {
        // ── Tờ khai GTGT theo đúng một kỳ, không sinh cả hai ─────────────────
        const soKy = kyKeKhai === 'month' ? 12 : 4
        for (let i = 1; i <= soKy; i++) {
            out.push({
                taxType: kyKeKhai === 'month' ? '01_GTGT' : '01_GTGT_Q',
                period: kyKeKhai === 'month' ? `T${p2(i)}/${year}` : `Q${i}/${year}`,
                dueDate: kyKeKhai === 'month' ? hanThang(i) : hanQuy(i),
                description: `Tờ khai thuế GTGT ${kyKeKhai === 'month' ? `tháng ${i}` : `quý ${i}`}/${year}`,
                canCu: 'Điều 8, 9 NĐ 126/2020/NĐ-CP; Điều 44 Luật Quản lý thuế 38/2019',
                loaiViec: 'to-khai',
            })
        }

        /* Tạm nộp thuế TNDN quý — NỘP TIỀN, KHÔNG nộp tờ khai. Tờ khai tạm tính
         * quý đã bỏ từ 2015 (TT 151/2014). Hạn là ngày 30 của tháng đầu quý sau
         * (Điều 55 NĐ 126/2020), khác hẳn hạn nộp tờ khai GTGT quý. */
        for (let q = 1; q <= 4; q++) {
            const thangSau = q * 3 + 1
            const y = thangSau > 12 ? year + 1 : year
            const mm = thangSau > 12 ? thangSau - 12 : thangSau
            out.push({
                taxType: 'TNDN_TAM_NOP',
                period: `TN-Q${q}/${year}`,
                dueDate: ngay(y, mm, 30),
                description: `Tạm nộp thuế TNDN quý ${q}/${year} (nộp tiền, không phải nộp tờ khai)`,
                canCu: 'Điều 55 NĐ 126/2020/NĐ-CP',
                loaiViec: 'nop-tien',
            })
        }

        out.push({
            taxType: '03_TNDN',
            period: `QTT-TNDN-${year}`,
            dueDate: ngay(year + 1, 3, 31),
            description: `Quyết toán thuế TNDN năm ${year} — tổng tạm nộp 4 quý phải đạt ≥80% số phải nộp cả năm, thiếu thì bị tính tiền chậm nộp`,
            canCu: 'Điều 44 Luật Quản lý thuế 38/2019; Điều 55 NĐ 126/2020',
            loaiViec: 'to-khai',
        })

        out.push({
            taxType: 'BCTC',
            period: `BCTC-${year}`,
            dueDate: ngay(year + 1, 3, 31),
            description: `Báo cáo tài chính năm ${year} — nộp cho cơ quan thuế chậm nhất 90 ngày kể từ khi kết thúc năm`,
            canCu: 'Điều 80 Thông tư 133/2016/TT-BTC',
            loaiViec: 'bao-cao',
        })
    }

    // ── Thuế TNCN: chỉ khi có trả lương ──────────────────────────────────────
    if (coNhanVien) {
        /* Kỳ khai TNCN khấu trừ đi theo kỳ khai GTGT (Điều 8, 9 NĐ 126/2020) —
         * khai GTGT quý mà khai TNCN tháng là sai kỳ. */
        const soKy = kyKeKhai === 'month' ? 12 : 4
        for (let i = 1; i <= soKy; i++) {
            out.push({
                taxType: '05_KK_TNCN',
                period: kyKeKhai === 'month' ? `TNCN-T${p2(i)}/${year}` : `TNCN-Q${i}/${year}`,
                dueDate: kyKeKhai === 'month' ? hanThang(i) : hanQuy(i),
                description: `Tờ khai khấu trừ thuế TNCN ${kyKeKhai === 'month' ? `tháng ${i}` : `quý ${i}`}/${year}`,
                canCu: 'Điều 8, 9 NĐ 126/2020/NĐ-CP',
                loaiViec: 'to-khai',
            })
        }
        out.push({
            taxType: '05_QTT_TNCN',
            period: `QTT-TNCN-${year}`,
            dueDate: ngay(year + 1, 3, 31),
            description: `Quyết toán thuế TNCN năm ${year} cho người lao động`,
            canCu: 'Điều 44 Luật Quản lý thuế 38/2019',
            loaiViec: 'to-khai',
        })
    }

    return out.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.taxType.localeCompare(b.taxType))
}

/**
 * Những mốc do hệ thống sinh trước đây nhưng KHÔNG còn đúng với hồ sơ hiện tại —
 * ví dụ đã đổi sang khai quý thì 12 mốc khai tháng phải bỏ đi, nếu không chúng
 * tự chuyển thành "quá hạn" và làm hỏng cả bảng nghĩa vụ.
 *
 * Chỉ trả về mốc CHƯA ĐỘNG TỚI: đã nộp, đã gắn tờ khai, hay có ghi chú của người
 * dùng thì giữ nguyên — xóa dữ liệu người ta đã làm việc trên đó là điều không
 * bao giờ được phép, kể cả khi nó "không còn đúng".
 */
export function mocCanDon(
    dangCo: Array<{ id: string; taxType: string; period: string; status: string; filedAt?: any; declarationId?: string | null; notes?: string | null }>,
    mocDung: MocNghiaVu[],
): string[] {
    const khoaDung = new Set(mocDung.map(m => `${m.taxType}|${m.period}`))
    const LOAI_HE_THONG_QUAN_LY = new Set([
        '01_GTGT', '01_GTGT_Q', '01_CNKD', '03_TNDN', 'TNDN_TAM_NOP',
        '05_KK_TNCN', '06_TNCN', '05_QTT_TNCN', 'BCTC', 'MON_BAI',
    ])
    return dangCo
        .filter(d => LOAI_HE_THONG_QUAN_LY.has(d.taxType))
        .filter(d => !khoaDung.has(`${d.taxType}|${d.period}`))
        .filter(d => (d.status === 'pending' || d.status === 'overdue')
            && !d.filedAt && !d.declarationId && !d.notes)
        .map(d => d.id)
}
