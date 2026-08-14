/**
 * BỎ THUẾ KHOÁN TỪ 2026 — HỘ KINH DOANH PHẢI NỘP BAO NHIÊU?
 *
 * Nghị quyết 198/2025 bỏ hình thức thuế khoán từ 01/01/2026. Hộ kinh doanh
 * chuyển sang KÊ KHAI theo doanh thu thực. Đây là thay đổi lớn nhất với nhóm
 * khách hàng này trong nhiều năm, và nó đánh vào ba chỗ cùng lúc:
 *
 *   1. TIỀN. Khoán là một mức cố định thoả thuận với cơ quan thuế, thường thấp
 *      hơn nhiều so với doanh thu thật. Kê khai thì nộp theo đúng số bán được.
 *   2. SỔ SÁCH. Phải ghi chép doanh thu, giữ chứng từ — trước đây khoán thì không.
 *   3. HOÁ ĐƠN. Doanh thu từ 1 tỷ/năm phải dùng hoá đơn điện tử khởi tạo từ máy
 *      tính tiền có kết nối cơ quan thuế (NĐ 70/2025).
 *
 * Cỗ máy này lấy doanh thu THẬT trong phần mềm rồi trả lời đúng một câu: sang
 * năm bạn phải nộp bao nhiêu, và chênh bao nhiêu so với mức khoán đang đóng.
 *
 * BA CHỖ CỐ Ý KHÔNG ĐOÁN:
 *  - Ngành nghề quyết định tỷ lệ % thuế (phân phối 1,5% so với dịch vụ 7% — chênh
 *    hơn bốn lần). Không suy từ tên hàng, phải để người dùng chọn.
 *  - Mức khoán đang đóng nằm ở thông báo của cơ quan thuế, phần mềm không có.
 *    Không nhập thì bỏ hẳn phần so sánh, không lấy 0 làm mốc.
 *  - Doanh thu chưa đủ một năm thì quy năm và NÓI RÕ là đã quy — cửa hàng mới mở
 *    ba tháng mà nhân bốn có thể lệch rất xa.
 */

import { TY_LE_TT40 } from './taxAssessment'
import { nguongChiuThueHKD } from './taxAudit'
import { monBaiHoKinhDoanh } from './taxCalendar'

export type NganhHKD = keyof typeof TY_LE_TT40

/** Ngưỡng doanh thu năm buộc dùng hoá đơn điện tử từ máy tính tiền — NĐ 70/2025. */
export const NGUONG_HDDT_MAY_TINH_TIEN = 1_000_000_000

export interface ViecPhaiLam {
    ma: string
    tieuDe: string
    vaSao: string
    canCu: string
    hanChot: string
    muc: 'bat-buoc' | 'nen-lam'
}

export interface KetQuaChuyenDoi {
    ky: { tuNgay: string; denNgay: string; soNgay: number }
    doanhThu: {
        trongKy: number
        quyNam: number
        daQuyNam: boolean
        ghiChu: string
    }
    nganh: { ma: NganhHKD; ten: string; tyLeGtgt: number; tyLeTncn: number }
    chiuThue: {
        nguong: number
        vuotNguong: boolean
        lyDo: string
    }
    phaiNop: {
        gtgt: number
        tncn: number
        monBai: number
        tongNam: number
        binhQuanThang: number
    }
    soVoiKhoan: {
        coSoSanh: boolean
        khoanMoiThang: number | null
        khoanMoiNam: number | null
        chenhMoiNam: number | null
        nhanXet: string
    }
    hoaDon: {
        batBuocMayTinhTien: boolean
        lyDo: string
    }
    viecPhaiLam: ViecPhaiLam[]
    ghiChu: string[]
    thieu: string[]
}

const lam = (n: any) => Math.round(Number(n) || 0)
const so = (n: any) => (Number.isFinite(Number(n)) ? Number(n) : 0)
const tien = (n: number) => lam(n).toLocaleString('vi-VN') + 'đ'
const VN_OFFSET_MS = 7 * 3600 * 1000
const ngayVN = (d: any) => new Date(new Date(d).getTime() + VN_OFFSET_MS).toISOString().slice(0, 10)

export async function tinhChuyenDoiHKD(
    prisma: any,
    ky: { tu: Date; den: Date },
    tuyChon?: { nganh?: NganhHKD; khoanMoiThang?: number; nam?: number },
): Promise<KetQuaChuyenDoi> {
    const thieu: string[] = []
    const ghiChu: string[] = []

    const nam = tuyChon?.nam ?? new Date(Date.now() + VN_OFFSET_MS).getUTCFullYear()
    const maNganh: NganhHKD = (tuyChon?.nganh && TY_LE_TT40[tuyChon.nganh]) ? tuyChon.nganh : 'phan-phoi'
    const nganh = TY_LE_TT40[maNganh]!

    // ── Doanh thu thật trong kỳ ──────────────────────────────────────────
    let doanhThuKy = 0
    try {
        const r = await prisma.transaction.aggregate({
            /* Đơn ghi nợ ('partial') vẫn là doanh thu chịu thuế — bỏ ra là khai
             * thiếu, và khai thiếu thì bị truy thu cộng phạt. */
            where: { createdAt: { gte: ky.tu, lte: ky.den }, status: { in: ['completed', 'partial'] } },
            _sum: { total: true },
        })
        doanhThuKy = so(r?._sum?.total)
    } catch (e: any) {
        thieu.push(`Không đọc được doanh thu: ${String(e?.message || e).slice(0, 140)}`)
    }

    /* Đơn sàn đã giao cũng là doanh thu của hộ, kể cả khi chưa đẩy về thành giao
     * dịch tại quầy. Bỏ sót nó là khai thiếu đúng phần cơ quan thuế dễ đối chiếu
     * nhất, vì sàn có báo cáo riêng cho cơ quan thuế. */
    try {
        const r = await prisma.onlineOrder.aggregate({
            where: { createdAt: { gte: ky.tu, lte: ky.den }, status: { in: ['delivered', 'completed'] } },
            _sum: { total: true },
        })
        const tienSan = so(r?._sum?.total)
        if (tienSan > 0) {
            doanhThuKy += tienSan
            ghiChu.push(`Đã cộng ${tien(tienSan)} doanh thu đơn sàn đã giao — sàn có báo cáo riêng cho cơ quan thuế nên bỏ sót phần này là chỗ dễ bị đối chiếu ra nhất.`)
        }
    } catch (e: any) {
        thieu.push(`Không đọc được đơn sàn: ${String(e?.message || e).slice(0, 140)}`)
    }

    /* DỮ LIỆU CÓ PHỦ HẾT KỲ KHÔNG?
     *
     * Cả con số thuế phải nộp cả năm dựng trên doanh thu của kỳ này. Nếu cửa
     * hàng mới nhập dữ liệu vào phần mềm được vài tháng thì tổng đó KHÔNG phải
     * doanh thu một năm — mà module vẫn ghi "kỳ đủ dài nên dùng thẳng doanh thu
     * thực tế" và đưa ra một con số nộp thuế nghe rất chắc chắn.
     *
     * Đo trên dữ liệu thật 14/08/2026: một cửa hàng có 5,76 tỷ trong cửa sổ 365
     * ngày, nhưng gần như toàn bộ nằm trong 90 ngày cuối — phần đầu năm chưa
     * từng được nhập vào hệ thống. Nói ra để người dùng biết con số này là SÀN,
     * không phải mức đúng. */
    let soNgayCoBan = 0
    try {
        const r: any[] = await prisma.$queryRawUnsafe(
            /* Đếm theo NGÀY BÁN. Câu ghi chú bên dưới hỏi "dữ liệu có phủ hết kỳ
             * không" — đó là câu hỏi về ngày bán, không phải ngày nhập liệu.
             * Cửa hàng nhập lịch sử từ phần mềm cũ có `createdAt` gom trong vài
             * tuần nên đếm theo nó ra "chỉ 32 ngày phát sinh bán" cho một cửa
             * hàng bán 147 ngày, rồi khuyên đừng tin con số thuế vừa tính —
             * trong khi doanh thu ở đây đã đủ. Một lời cảnh báo thừa làm người
             * ta bỏ qua cả những cảnh báo thật.
             *
             * CỐ Ý chỉ đổi phép ĐẾM NGÀY, không đổi cách cắt kỳ của doanh thu:
             * đổi cắt kỳ là đổi số thuế đã kê khai, việc đó chờ người dùng
             * quyết. Ở đây hai câu hỏi khác nhau nên dùng hai thước đo là đúng,
             * miễn là nói rõ câu này đo cái gì. */
            `SELECT COUNT(DISTINCT (COALESCE(t."transactionDate", t."createdAt") + interval '7 hours')::date)::int AS n
             FROM "Transaction" t
             WHERE t.status IN ('completed','partial')
               AND COALESCE(t."transactionDate", t."createdAt") >= $1
               AND COALESCE(t."transactionDate", t."createdAt") <= $2`,
            ky.tu, ky.den,
        )
        soNgayCoBan = Number(r?.[0]?.n) || 0
    } catch { /* đếm được thì tốt, không đếm được thì thôi — không chặn báo cáo */ }

    const soNgay = Math.max(1, Math.round((ky.den.getTime() - ky.tu.getTime()) / 86400_000))
    if (soNgayCoBan > 0 && soNgayCoBan < soNgay * 0.6) {
        ghiChu.push(`Trong ${soNgay} ngày của kỳ chỉ có ${soNgayCoBan} ngày phát sinh bán (đếm theo NGÀY BÁN trên chứng từ). Nếu cửa hàng đã bán cả kỳ mà mới nhập dữ liệu gần đây thì doanh thu ở đây THẤP HƠN thực tế, và số thuế tính ra chỉ là mức sàn — không phải mức đúng.`)
    }
    const daQuyNam = soNgay < 350
    const quyNam = daQuyNam ? doanhThuKy * (365 / soNgay) : doanhThuKy

    // ── Có thuộc diện chịu thuế không ────────────────────────────────────
    const nguong = nguongChiuThueHKD(nam)
    const vuot = quyNam > nguong

    // ── Số phải nộp theo kê khai ─────────────────────────────────────────
    const gtgt = vuot ? quyNam * nganh.gtgt : 0
    const tncn = vuot ? quyNam * nganh.tncn : 0
    const mb = monBaiHoKinhDoanh(quyNam)
    const monBai = so(mb.soTien)
    const tongNam = gtgt + tncn + monBai

    // ── So với mức khoán đang đóng ───────────────────────────────────────
    const khoanThang = tuyChon?.khoanMoiThang
    const coSoSanh = typeof khoanThang === 'number' && khoanThang > 0
    const khoanNam = coSoSanh ? khoanThang! * 12 : null
    const chenh = coSoSanh ? tongNam - (khoanNam! + monBai) : null

    let nhanXet: string
    if (!coSoSanh) {
        nhanXet = 'Chưa nhập mức khoán đang đóng nên chưa so được. Mức khoán nằm trong thông báo của cơ quan thuế, phần mềm không có — nhập vào để biết sang năm chênh bao nhiêu.'
    } else if (chenh! > 0) {
        nhanXet = `Sang kê khai phải nộp thêm khoảng ${tien(chenh!)} mỗi năm (${tien(chenh! / 12)} mỗi tháng) so với mức khoán hiện tại. Đây là tiền thật, nên tính vào giá bán từ bây giờ chứ đừng đợi tới lúc nộp.`
    } else {
        nhanXet = `Sang kê khai nộp ÍT hơn khoảng ${tien(Math.abs(chenh!))} mỗi năm so với mức khoán hiện tại — mức khoán đang cao hơn doanh thu thực tế.`
    }

    // ── Hoá đơn điện tử từ máy tính tiền ─────────────────────────────────
    const batBuocMTT = quyNam >= NGUONG_HDDT_MAY_TINH_TIEN

    // ── Việc phải làm ────────────────────────────────────────────────────
    const viecPhaiLam: ViecPhaiLam[] = []

    if (vuot) {
        viecPhaiLam.push({
            ma: 'ke-khai',
            tieuDe: 'Nộp tờ khai thuế theo doanh thu thực',
            vaSao: `Doanh thu quy năm ${tien(quyNam)} vượt ngưỡng ${tien(nguong)}, nên phát sinh nghĩa vụ GTGT và TNCN theo tỷ lệ ngành ${nganh.ten.toLowerCase()}.`,
            canCu: 'Nghị quyết 198/2025 bỏ thuế khoán từ 01/01/2026; tỷ lệ % tính trên doanh thu theo Thông tư 40/2021.',
            hanChot: 'Chậm nhất ngày 20 tháng sau nếu khai tháng, hoặc ngày cuối tháng đầu quý sau nếu khai quý',
            muc: 'bat-buoc',
        })
    } else {
        viecPhaiLam.push({
            ma: 'theo-doi-nguong',
            tieuDe: 'Theo dõi mốc vượt ngưỡng trong năm',
            vaSao: `Doanh thu quy năm ${tien(quyNam)} còn dưới ngưỡng ${tien(nguong)}. Nhưng ngưỡng tính trên CẢ NĂM — bán tốt vài tháng cuối là vượt, và nghĩa vụ phát sinh từ lúc vượt chứ không phải từ đầu năm sau.`,
            canCu: 'Luật Thuế GTGT 48/2024: ngưỡng doanh thu không chịu thuế của hộ, cá nhân kinh doanh là 200 triệu đồng/năm từ 2026.',
            hanChot: 'Theo dõi liên tục trong năm',
            muc: 'nen-lam',
        })
    }

    viecPhaiLam.push({
        ma: 'so-sach',
        tieuDe: 'Giữ sổ doanh thu và chứng từ mua vào',
        vaSao: 'Khoán thì không cần sổ, kê khai thì có. Không có sổ và chứng từ thì cơ quan thuế được quyền ấn định thay vì chấp nhận số bạn khai.',
        canCu: 'Điều 50 Luật Quản lý thuế 38/2019 — căn cứ ấn định thuế khi sổ sách không đầy đủ.',
        hanChot: 'Từ 01/01/2026',
        muc: 'bat-buoc',
    })

    if (batBuocMTT) {
        viecPhaiLam.push({
            ma: 'hddt-may-tinh-tien',
            tieuDe: 'Dùng hoá đơn điện tử khởi tạo từ máy tính tiền',
            vaSao: `Doanh thu quy năm ${tien(quyNam)} đạt mốc 1 tỷ, nên thuộc diện bắt buộc kết nối máy tính tiền với cơ quan thuế.`,
            canCu: 'Nghị định 70/2025 — hộ, cá nhân kinh doanh doanh thu từ 1 tỷ đồng/năm.',
            hanChot: 'Từ 01/01/2026',
            muc: 'bat-buoc',
        })
    }

    viecPhaiLam.push({
        ma: 'mon-bai',
        tieuDe: `Lệ phí môn bài ${monBai > 0 ? tien(monBai) + '/năm' : 'được miễn'}`,
        vaSao: mb.dienGiai,
        canCu: 'Nghị định 139/2016 và Nghị định 22/2020 về lệ phí môn bài.',
        hanChot: 'Chậm nhất ngày 30/01 hằng năm',
        muc: monBai > 0 ? 'bat-buoc' : 'nen-lam',
    })

    // ── Ghi chú ──────────────────────────────────────────────────────────
    if (daQuyNam) {
        ghiChu.push(`Kỳ đang xem dài ${soNgay} ngày nên doanh thu đã được QUY RA NĂM để so ngưỡng. Cửa hàng mới mở hoặc có mùa vụ mạnh thì con số quy năm này lệch khá xa thực tế — xem lại sau khi có đủ 12 tháng.`)
    }
    ghiChu.push(`Tỷ lệ thuế phụ thuộc NGÀNH: đang tính theo "${nganh.ten}" (GTGT ${(nganh.gtgt * 100).toFixed(1)}% + TNCN ${(nganh.tncn * 100).toFixed(1)}%). Chọn sai ngành thì số này sai hoàn toàn — dịch vụ chịu gấp hơn bốn lần phân phối.`)
    ghiChu.push('Đây là ước tính để chuẩn bị, không phải số quyết toán. Cơ quan thuế có thể áp tỷ lệ khác nếu hộ kinh doanh nhiều ngành nghề.')

    return {
        ky: { tuNgay: ngayVN(ky.tu), denNgay: ngayVN(ky.den), soNgay },
        doanhThu: {
            trongKy: lam(doanhThuKy),
            quyNam: lam(quyNam),
            daQuyNam,
            ghiChu: daQuyNam
                ? `Đã quy từ ${tien(doanhThuKy)} của ${soNgay} ngày ra mức cả năm`
                : 'Kỳ đủ dài nên dùng thẳng doanh thu thực tế',
        },
        nganh: { ma: maNganh, ten: nganh.ten, tyLeGtgt: nganh.gtgt, tyLeTncn: nganh.tncn },
        chiuThue: {
            nguong,
            vuotNguong: vuot,
            lyDo: vuot
                ? `Doanh thu quy năm ${tien(quyNam)} vượt ngưỡng ${tien(nguong)}/năm`
                : `Doanh thu quy năm ${tien(quyNam)} chưa tới ngưỡng ${tien(nguong)}/năm`,
        },
        phaiNop: {
            gtgt: lam(gtgt),
            tncn: lam(tncn),
            monBai,
            tongNam: lam(tongNam),
            binhQuanThang: lam(tongNam / 12),
        },
        soVoiKhoan: {
            coSoSanh,
            khoanMoiThang: coSoSanh ? lam(khoanThang!) : null,
            khoanMoiNam: coSoSanh ? lam(khoanNam!) : null,
            chenhMoiNam: coSoSanh ? lam(chenh!) : null,
            nhanXet,
        },
        hoaDon: {
            batBuocMayTinhTien: batBuocMTT,
            lyDo: batBuocMTT
                ? `Doanh thu quy năm ${tien(quyNam)} đạt mốc 1 tỷ — bắt buộc theo NĐ 70/2025`
                : `Doanh thu quy năm ${tien(quyNam)} chưa tới mốc 1 tỷ, chưa bắt buộc máy tính tiền kết nối cơ quan thuế`,
        },
        viecPhaiLam,
        ghiChu,
        thieu,
    }
}
