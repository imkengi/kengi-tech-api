/**
 * KIỂM TRA TRƯỚC THANH TRA THUẾ — hàm thuần, chạy được với client giả.
 *
 * Khác với module "Tuân thủ pháp lý" (kiểm tra NGHĨA VỤ: có giấy phép chưa, có
 * dùng HĐĐT chưa…), file này soi CHÍNH DỮ LIỆU của cửa hàng theo đúng cách một
 * đoàn thanh tra thuế soi: đối chiếu ba nguồn doanh thu, tìm dấu hiệu bị ấn
 * định thuế, và tìm những khoản sẽ bị loại khi tính thuế.
 *
 * Nguyên tắc viết các phép kiểm tra ở đây:
 *  1. Mỗi cảnh báo phải nói RÕ CĂN CỨ PHÁP LÝ và HẬU QUẢ bằng tiền, vì người
 *     đọc phải quyết định có bỏ công đi sửa hay không.
 *  2. Thà bỏ sót còn hơn báo bừa: chỗ nào dữ liệu không đủ để kết luận thì ghi
 *     "cần đối chiếu chứng từ" chứ không phán là sai phạm.
 *  3. Ngưỡng luật để thành hằng số có chú thích — luật đổi thì sửa một chỗ.
 */

export type MucRuiRo = 'cao' | 'vua' | 'thap'

export interface CanhBaoThue {
    code: string
    muc: MucRuiRo
    tieuDe: string
    /** Diễn giải kèm con số cụ thể */
    chiTiet: string
    /** Điều khoản làm căn cứ */
    canCu: string
    /** Việc cần làm trước khi đoàn thanh tra tới */
    canLam: string
    /** Số tiền có nguy cơ bị truy thu/loại trừ (nếu ước lượng được) */
    tienRuiRo: number | null
    soLuong: number
    viDu: string[]
}

export interface UocTinhPhat {
    /** Tiền thuế có nguy cơ bị truy thu (gộp từ các cảnh báo định lượng được) */
    truyThu: number
    /** Phạt khai sai 20% trên số thuế thiếu — Điều 16 NĐ 125/2020 */
    phatKhaiSai: number
    /** Tiền chậm nộp 0,03%/ngày — Điều 59 Luật Quản lý thuế 38/2019 */
    chamNop: number
    soNgayCham: number
    hanNop: string | null
    tong: number
    /** Ghi rõ đây là ƯỚC TÍNH, không phải số ấn định của cơ quan thuế */
    ghiChu: string
}

export interface GiaiTrinh {
    code: string
    tieuDe: string
    /** Văn bản giải trình soạn sẵn, kế toán sửa lại cho khớp thực tế rồi in */
    noiDung: string
    /** Chứng từ phải kẹp kèm khi nộp bản giải trình này */
    chungTuKem: string[]
}

export interface KhoanBiLoai {
    /** Lý do bị loại — nhóm theo đúng cách kê trên phụ lục quyết toán */
    lyDo: string
    canCu: string
    soLuong: number
    /** Chi phí bị loại khi tính thu nhập chịu thuế */
    chiPhiBiLoai: number
    /** Thuế GTGT đầu vào không được khấu trừ */
    vatBiLoai: number
}

export interface HoSoThue {
    ky: string
    /** Điểm sẵn sàng 0–100 (100 = không phát hiện dấu hiệu nào) */
    diem: number
    xepLoai: string
    canhBao: CanhBaoThue[]
    uocTinhPhat: UocTinhPhat
    /** Ba nguồn doanh thu để đối chiếu */
    doanhThu: { so: number; toKhai: number | null; hoaDon: number }
    thue: { vatRaSo: number; vatRaToKhai: number | null; vatVaoSo: number; vatVaoToKhai: number | null }
    /** Hồ sơ cần chuẩn bị mang ra khi đoàn tới */
    hoSoCanChuanBi: string[]
    /** Bản giải trình soạn sẵn cho từng phát hiện */
    giaiTrinh: GiaiTrinh[]
    /** Bảng kê khoản bị loại — dùng khi lập quyết toán thuế TNDN */
    khoanBiLoai: {
        dong: KhoanBiLoai[]
        tongChiPhiBiLoai: number
        tongVatBiLoai: number
        /** Thuế TNDN phải nộp thêm ước tính theo thuế suất 20% */
        thueTndnUocTinh: number
        ghiChu: string
    }
}

/**
 * Soạn bản giải trình mẫu cho từng phát hiện.
 *
 * Đây là VĂN BẢN NHÁP để kế toán sửa lại cho khớp thực tế, không phải lời khai
 * thay doanh nghiệp — nên mọi mẫu đều để chỗ trống [.....] ở phần lý do, và
 * tuyệt đối không tự bịa nguyên nhân. Viết sẵn phần khung giúp tiết kiệm thời
 * gian lúc đoàn đã ngồi vào bàn, khi mà soạn từ đầu là rất căng.
 */
function soanGiaiTrinh(c: CanhBaoThue, nhanKy: string): GiaiTrinh | null {
    const mo = `Về nội dung "${c.tieuDe}" trong kỳ ${nhanKy}, đơn vị xin giải trình như sau:`
    const ket = 'Đơn vị cam kết số liệu giải trình là trung thực và chịu trách nhiệm trước pháp luật.'
    const mau: Record<string, { noiDung: string; chungTuKem: string[] }> = {
        'dt-so-vs-tokhai': {
            noiDung: `${mo}\n\n1. Nguyên nhân chênh lệch giữa doanh thu trên sổ kế toán và doanh thu đã kê khai: [nêu rõ — ví dụ: hóa đơn xuất sau ngày ghi nhận doanh thu; hàng bán bị trả lại chưa điều chỉnh tờ khai; sai sót nhập liệu].\n2. Số liệu chi tiết: ${c.chiTiet}\n3. Biện pháp xử lý: đơn vị đã/sẽ lập tờ khai bổ sung theo Điều 47 Luật Quản lý thuế 38/2019 cho kỳ nêu trên trước ngày [.....].\n\n${ket}`,
            chungTuKem: ['Bảng đối chiếu doanh thu sổ kế toán và tờ khai từng tháng', 'Sổ chi tiết TK 511, 5212', 'Tờ khai bổ sung (nếu đã lập)'],
        },
        'dt-so-vs-hoadon': {
            noiDung: `${mo}\n\n1. Số liệu: ${c.chiTiet}\n2. Nguyên nhân: [nêu rõ — ví dụ: doanh thu bán lẻ cho khách không lấy hóa đơn đã được lập hóa đơn tổng hợp cuối ngày/cuối kỳ; hoặc hóa đơn xuất lệch kỳ].\n3. Đơn vị đã rà soát và [đã xuất bổ sung hóa đơn số ..... ngày ..... / đang hoàn thiện].\n\n${ket}`,
            chungTuKem: ['Bảng kê hóa đơn đã phát hành trong kỳ', 'Bảng kê doanh thu bán lẻ không lấy hóa đơn', 'Hóa đơn tổng hợp (nếu có)'],
        },
        'tien-mat-vuot-nguong': {
            noiDung: `${mo}\n\n1. Số liệu: ${c.chiTiet}\n2. Giải trình: các khoản nêu trên [đã được thanh toán qua ngân hàng, chứng từ kèm theo / thực tế thanh toán bằng tiền mặt].\n3. Đối với các khoản thực tế thanh toán bằng tiền mặt từ ${vnd(NGUONG_KHONG_TIEN_MAT)} đồng trở lên, đơn vị chủ động không kê khai khấu trừ thuế GTGT đầu vào và loại khỏi chi phí được trừ khi quyết toán thuế TNDN.\n\n${ket}`,
            chungTuKem: ['Ủy nhiệm chi / sao kê ngân hàng của từng giao dịch', 'Hóa đơn GTGT đầu vào tương ứng', 'Bảng kê các khoản tự loại khỏi khấu trừ'],
        },
        'chi-khong-hoa-don': {
            noiDung: `${mo}\n\n1. Số liệu: ${c.chiTiet}\n2. Giải trình: các khoản chi này [đã có hóa đơn nhưng chưa cập nhật số hóa đơn vào phần mềm, hóa đơn gốc kèm theo / không có hóa đơn].\n3. Đối với các khoản không có hóa đơn hợp pháp, đơn vị tự loại khỏi chi phí được trừ khi xác định thu nhập chịu thuế TNDN theo Điều 4 Thông tư 96/2015/TT-BTC.\n\n${ket}`,
            chungTuKem: ['Hóa đơn gốc của các khoản đã bổ sung được', 'Bảng kê các khoản tự loại khỏi chi phí được trừ', 'Chứng từ chi tương ứng'],
        },
        'ton-kho-am': {
            noiDung: `${mo}\n\n1. Số liệu: ${c.chiTiet}\n2. Nguyên nhân: [nêu rõ — ví dụ: phiếu nhập kho chưa được nhập vào phần mềm tại thời điểm bán; sai sót khi kiểm kê; nhầm đơn vị tính].\n3. Biện pháp: đơn vị đã bổ sung phiếu nhập số ..... ngày ..... kèm hóa đơn đầu vào hợp pháp, và đã lập biên bản kiểm kê điều chỉnh tồn kho ngày ......\n\n${ket}`,
            chungTuKem: ['Phiếu nhập kho và hóa đơn đầu vào bổ sung', 'Biên bản kiểm kê kho', 'Thẻ kho / sổ chi tiết vật tư hàng hóa'],
        },
        'ban-duoi-gia-von': {
            noiDung: `${mo}\n\n1. Số liệu: ${c.chiTiet}\n2. Lý do bán thấp hơn giá vốn: [nêu rõ — hàng cận hạn sử dụng, hàng lỗi mẫu/trưng bày, thanh lý hàng chậm luân chuyển, chương trình khuyến mãi đã thông báo tới cơ quan quản lý].\n3. Việc bán hàng nêu trên phù hợp quy luật kinh doanh, giá bán được xác định theo thỏa thuận thực tế với khách hàng, đơn vị không có hành vi hạ giá trên hóa đơn nhằm giảm nghĩa vụ thuế.\n\n${ket}`,
            chungTuKem: ['Quyết định/thông báo chương trình khuyến mãi', 'Biên bản xác định hàng cận hạn, hàng lỗi', 'Bảng kê chi tiết các giao dịch liên quan'],
        },
        'quy-am-trong-ky': {
            noiDung: `${mo}\n\n1. Số liệu: ${c.chiTiet}\n2. Nguyên nhân: [nêu rõ — ví dụ: khoản thu tiền mặt chưa ghi sổ kịp thời; chủ doanh nghiệp cho vay/góp thêm vốn chưa lập chứng từ].\n3. Biện pháp: đơn vị đã bổ sung chứng từ thu số ..... ngày ..... và điều chỉnh sổ quỹ; số dư quỹ tiền mặt sau điều chỉnh khớp với biên bản kiểm kê quỹ ngày ......\n\n${ket}`,
            chungTuKem: ['Biên bản kiểm kê quỹ tiền mặt', 'Phiếu thu bổ sung', 'Hợp đồng vay/biên bản góp vốn của chủ sở hữu (nếu có)'],
        },
        'tncn-thieu-khau-tru': {
            noiDung: `${mo}\n\n1. Số liệu: ${c.chiTiet}\n2. Nguyên nhân: [nêu rõ — ví dụ: chưa cập nhật người phụ thuộc; tính nhầm thu nhập chịu thuế].\n3. Biện pháp: đơn vị đã tính lại thuế TNCN phải khấu trừ, thực hiện khấu trừ bù và khai bổ sung tờ khai 05/KK-TNCN kỳ ..... vào ngày ......\n\n${ket}`,
            chungTuKem: ['Bảng lương chi tiết của kỳ', 'Bảng tính lại thuế TNCN', 'Tờ khai 05/KK-TNCN bổ sung', 'Hồ sơ đăng ký người phụ thuộc'],
        },
    }
    const m = mau[c.code]
    if (!m) return null
    return { code: c.code, tieuDe: c.tieuDe, noiDung: m.noiDung, chungTuKem: m.chungTuKem }
}

/* ── Ngưỡng luật ────────────────────────────────────────────────────────────
 * Từ 01/07/2025 (Luật Thuế GTGT 48/2024, NĐ 181/2025) chứng từ thanh toán
 * KHÔNG DÙNG TIỀN MẶT là điều kiện khấu trừ GTGT với hàng hóa/dịch vụ mua vào
 * từ 5.000.000đ (đã gồm thuế) — trước đó ngưỡng là 20.000.000đ. Nếu kế toán
 * của cửa hàng áp ngưỡng khác, sửa đúng hằng số này. */
export const NGUONG_KHONG_TIEN_MAT = 5_000_000
/** Dưới mức này thì chi lặt vặt còn lập bảng kê được; trên mức này mà thiếu hóa
 *  đơn là gần như chắc chắn bị loại khi quyết toán thuế TNDN. */
export const NGUONG_CHI_CAN_HOA_DON = 2_000_000
/** Phạt khai sai dẫn đến thiếu thuế — Điều 16 NĐ 125/2020 */
export const TY_LE_PHAT_KHAI_SAI = 0.2
/** Tiền chậm nộp mỗi ngày — Điều 59 Luật Quản lý thuế 38/2019 */
export const TY_LE_CHAM_NOP_NGAY = 0.0003
/** Chênh lệch dưới mức này coi như sai số làm tròn, không báo động */
export const NGUONG_LECH_BO_QUA = 1_000

const vnd = (v: number) => Math.round(v).toLocaleString('vi-VN')
const ngayISO = (d: Date) => d.toISOString().slice(0, 10)

/** Số phát sinh Nợ/Có của một nhóm tài khoản theo tiền tố */
function phatSinh(
    entries: Array<{ debitAccount: string; creditAccount: string; amount: number }>,
    tienTo: string,
) {
    let no = 0, co = 0
    for (const e of entries) {
        if (String(e.debitAccount || '').startsWith(tienTo)) no += e.amount
        if (String(e.creditAccount || '').startsWith(tienTo)) co += e.amount
    }
    return { no, co }
}

export interface KhoangKy {
    from: string
    to: string
    start: Date
    end: Date
    /** Mã kỳ của tờ khai: "2026-08" (tháng) hoặc "2026-Q3" (quý) */
    maKy: string
    nhan: string
}

export async function kiemTraThue(prisma: any, ky: KhoangKy): Promise<HoSoThue> {
    const { from, to, start, end, maKy, nhan } = ky
    const canhBao: CanhBaoThue[] = []

    /* Số gốc dùng để lập bảng kê khoản bị loại. Phải giữ riêng thay vì suy ngược
     * từ `tienRuiRo` của cảnh báo — tienRuiRo là số đã quy đổi (vd đã nhân 20%),
     * suy ngược là chỗ rất dễ sai mà không ai phát hiện. */
    let _chiKhongHd = 0, _soChiKhongHd = 0
    let _chiTienMat = 0, _vatTienMat = 0, _soTienMat = 0
    let _vatThieuTt = 0, _soThieuTt = 0

    // ── Số liệu trên SỔ ──────────────────────────────────────────────────────
    const butToan: Array<{ debitAccount: string; creditAccount: string; amount: number; date: string }> =
        await prisma.journalEntry.findMany({
            where: { date: { gte: from, lte: to } },
            select: { debitAccount: true, creditAccount: true, amount: true, date: true },
        })
    const ps511 = phatSinh(butToan, '511')
    const ps521 = phatSinh(butToan, '521')     // giảm trừ doanh thu (hàng bán bị trả lại)
    const ps3331 = phatSinh(butToan, '3331')
    const ps133 = phatSinh(butToan, '133')
    // Doanh thu thuần trên sổ = phát sinh Có 511 − các khoản giảm trừ 521
    const dtSo = Math.round(ps511.co - ps511.no - (ps521.no - ps521.co))
    const vatRaSo = Math.round(ps3331.co - ps3331.no)
    const vatVaoSo = Math.round(ps133.no - ps133.co)

    // ── Số liệu trên TỜ KHAI đã lập ──────────────────────────────────────────
    let dtToKhai: number | null = null
    let vatRaToKhai: number | null = null
    let vatVaoToKhai: number | null = null
    let coToKhai = false
    try {
        const tk = await prisma.taxDeclaration.findFirst({ where: { period: maKy } })
        if (tk) {
            coToKhai = true
            // ct29 = tổng doanh thu HHDV bán ra, ct30 = tổng thuế GTGT đầu ra,
            // ct33 = thuế GTGT đầu vào được khấu trừ (theo cách app tự lập tờ khai)
            dtToKhai = Math.round(tk.ct29 ?? 0)
            vatRaToKhai = Math.round(tk.ct30 ?? 0)
            vatVaoToKhai = Math.round(tk.ct33 ?? tk.ct32 ?? 0)
        }
    } catch { /* chưa có bảng TaxDeclaration */ }

    // ── Số liệu trên HÓA ĐƠN ĐIỆN TỬ đã phát hành ────────────────────────────
    let dtHoaDon = 0
    let soHdHuy = 0, soHdTong = 0
    try {
        const hds = await prisma.eInvoice.findMany({
            where: { invoiceDate: { gte: from, lte: to } },
            select: { invoiceNumber: true, invoiceType: true, status: true, totalBeforeVat: true, vatAmount: true, totalAmount: true, buyerTaxCode: true, buyerName: true, paymentMethod: true },
        })
        soHdTong = hds.length
        for (const h of hds) {
            const st = String(h.status || '').toUpperCase()
            if (st === 'CANCELLED' || st === 'REPLACED') { soHdHuy++; continue }
            if (st === 'DRAFT' || st === 'ERROR') continue
            const loai = String(h.invoiceType || 'SALE').toUpperCase()
            dtHoaDon += (loai === 'RETURN' ? -1 : 1) * (h.totalBeforeVat || 0)
        }
        dtHoaDon = Math.round(dtHoaDon)

        // Hóa đơn hủy/thay thế nhiều bất thường
        if (soHdTong >= 20 && soHdHuy / soHdTong >= 0.1) canhBao.push({
            code: 'hoadon-huy-nhieu', muc: 'vua',
            tieuDe: `${soHdHuy}/${soHdTong} hóa đơn bị hủy hoặc thay thế`,
            chiTiet: `Tỉ lệ ${(soHdHuy / soHdTong * 100).toFixed(1)}% — đoàn thanh tra thường lấy mẫu chính nhóm hóa đơn này để hỏi lý do hủy và đối chiếu với hàng đã giao.`,
            canCu: 'Điều 19 NĐ 123/2020 — xử lý hóa đơn có sai sót; hủy hóa đơn phải có biên bản thỏa thuận với người mua.',
            canLam: 'Chuẩn bị biên bản hủy/điều chỉnh cho từng hóa đơn, kèm chứng từ chứng minh hàng không giao hoặc giao sai.',
            tienRuiRo: null, soLuong: soHdHuy, viDu: [],
        })
    } catch { /* chưa có bảng EInvoice */ }

    // ── 1. Đối chiếu ba nguồn doanh thu ──────────────────────────────────────
    if (coToKhai && dtToKhai !== null) {
        const lech = dtSo - dtToKhai
        if (Math.abs(lech) >= NGUONG_LECH_BO_QUA) canhBao.push({
            code: 'dt-so-vs-tokhai', muc: Math.abs(lech) > Math.max(dtToKhai, 1) * 0.02 ? 'cao' : 'vua',
            tieuDe: 'Doanh thu trên sổ lệch với tờ khai GTGT',
            chiTiet: `Sổ ghi ${vnd(dtSo)} ₫, tờ khai kỳ ${nhan} khai ${vnd(dtToKhai)} ₫ — lệch ${vnd(Math.abs(lech))} ₫. Đây là phép đối chiếu ĐẦU TIÊN mà đoàn thanh tra làm; lệch mà không giải trình được thì bị ấn định theo số cao hơn.`,
            canCu: 'Điều 50 Luật Quản lý thuế 38/2019 — ấn định thuế khi số liệu kê khai không trung thực.',
            canLam: lech > 0
                ? 'Sổ cao hơn tờ khai: kiểm tra có doanh thu chưa kê khai không, nếu có phải khai bổ sung trước khi bị phát hiện (được giảm nhẹ).'
                : 'Tờ khai cao hơn sổ: kiểm tra bút toán doanh thu còn thiếu, hoặc tờ khai đã kê nhầm; số đã khai thì không được tự ý giảm mà phải khai điều chỉnh.',
            tienRuiRo: Math.abs(lech), soLuong: 0, viDu: [],
        })
    } else if (dtSo > 0) {
        canhBao.push({
            code: 'thieu-to-khai', muc: 'cao',
            tieuDe: `Kỳ ${nhan} có doanh thu nhưng chưa có tờ khai GTGT`,
            chiTiet: `Sổ ghi nhận ${vnd(dtSo)} ₫ doanh thu mà hệ thống chưa lưu tờ khai nào cho kỳ này.`,
            canCu: 'Điều 44 Luật Quản lý thuế 38/2019 — thời hạn nộp hồ sơ khai thuế; Điều 13 NĐ 125/2020 — phạt chậm nộp hồ sơ khai thuế.',
            canLam: 'Lập và nộp tờ khai cho kỳ này; nếu đã nộp ngoài hệ thống thì nhập lại vào phần Tờ Khai GTGT để đối chiếu về sau.',
            tienRuiRo: null, soLuong: 0, viDu: [],
        })
    }

    if (dtHoaDon > 0 || dtSo > 0) {
        const lech = dtSo - dtHoaDon
        if (Math.abs(lech) >= Math.max(NGUONG_LECH_BO_QUA, dtSo * 0.01)) canhBao.push({
            code: 'dt-so-vs-hoadon', muc: Math.abs(lech) > Math.max(dtSo, 1) * 0.05 ? 'cao' : 'vua',
            tieuDe: 'Doanh thu trên sổ lệch với hóa đơn điện tử đã phát hành',
            chiTiet: `Sổ ghi ${vnd(dtSo)} ₫, tổng hóa đơn đã phát hành (trừ hóa đơn trả lại) là ${vnd(dtHoaDon)} ₫ — lệch ${vnd(Math.abs(lech))} ₫.`,
            canCu: 'Điều 90 Luật Quản lý thuế 38/2019 và Điều 4 NĐ 123/2020 — bán hàng phải lập hóa đơn, kể cả khi khách không lấy.',
            canLam: lech > 0
                ? 'Sổ nhiều hơn hóa đơn: có doanh thu chưa xuất hóa đơn — rà lại các đơn bán lẻ không lấy hóa đơn và xuất bù (hoặc lập hóa đơn tổng hợp theo quy định).'
                : 'Hóa đơn nhiều hơn sổ: kiểm tra hóa đơn xuất trùng hoặc doanh thu chưa ghi sổ.',
            tienRuiRo: Math.abs(lech), soLuong: 0, viDu: [],
        })
    }

    // ── 2. Đối chiếu thuế GTGT ───────────────────────────────────────────────
    if (vatRaToKhai !== null) {
        const lech = vatRaSo - vatRaToKhai
        if (Math.abs(lech) >= NGUONG_LECH_BO_QUA) canhBao.push({
            code: 'vat-ra-lech', muc: 'cao',
            tieuDe: 'Thuế GTGT đầu ra trên sổ lệch với tờ khai',
            chiTiet: `Sổ (TK 3331) ${vnd(vatRaSo)} ₫, tờ khai ${vnd(vatRaToKhai)} ₫ — lệch ${vnd(Math.abs(lech))} ₫. Số này bị soi trực tiếp vì liên quan tới tiền phải nộp.`,
            canCu: 'Điều 8, 12 Luật Thuế GTGT 48/2024 — xác định thuế đầu ra.',
            canLam: 'Đối chiếu bảng kê hóa đơn bán ra với sổ 3331 từng tháng, tìm hóa đơn ghi sổ sai thuế suất hoặc chưa ghi.',
            tienRuiRo: Math.abs(lech), soLuong: 0, viDu: [],
        })
    }
    if (vatVaoToKhai !== null) {
        const lech = vatVaoSo - vatVaoToKhai
        if (Math.abs(lech) >= NGUONG_LECH_BO_QUA) canhBao.push({
            code: 'vat-vao-lech', muc: 'vua',
            tieuDe: 'Thuế GTGT đầu vào trên sổ lệch với tờ khai',
            chiTiet: `Sổ (TK 133) ${vnd(vatVaoSo)} ₫, tờ khai ${vnd(vatVaoToKhai)} ₫ — lệch ${vnd(Math.abs(lech))} ₫.`,
            canCu: 'Điều 14 Luật Thuế GTGT 48/2024 — điều kiện khấu trừ thuế đầu vào.',
            canLam: 'Rà bảng kê hóa đơn mua vào: hóa đơn nào chưa ghi sổ, hóa đơn nào đã kê khai nhưng không đủ điều kiện khấu trừ.',
            tienRuiRo: Math.abs(lech), soLuong: 0, viDu: [],
        })
    }

    // ── 3. Thanh toán tiền mặt vượt ngưỡng cho hóa đơn có VAT ────────────────
    try {
        const chi = await prisma.expense.findMany({
            where: { date: { gte: start, lte: end } },
            select: { id: true, description: true, amount: true, vatAmount: true, invoiceNo: true, supplierName: true, paidBy: true, bankAccountId: true, status: true, category: true },
        })
        const tienMatVuot = chi.filter((e: any) =>
            (e.status ?? 'active') === 'active'
            && String(e.category || '') !== 'supplier_payment'
            && (e.amount || 0) >= NGUONG_KHONG_TIEN_MAT
            && ((e.vatAmount || 0) > 0 || e.invoiceNo)
            && !e.bankAccountId
            && String(e.paidBy || 'cash').toLowerCase() !== 'bank'
            && String(e.paidBy || 'cash').toLowerCase() !== 'transfer')
        if (tienMatVuot.length > 0) {
            const vatMat = tienMatVuot.reduce((s: number, e: any) => s + (e.vatAmount || 0), 0)
            const chiMat = tienMatVuot.reduce((s: number, e: any) => s + (e.amount || 0), 0)
            _chiTienMat = Math.round(chiMat - vatMat); _vatTienMat = Math.round(vatMat); _soTienMat = tienMatVuot.length
            canhBao.push({
                code: 'tien-mat-vuot-nguong', muc: 'cao',
                tieuDe: `${tienMatVuot.length} khoản mua vào từ ${vnd(NGUONG_KHONG_TIEN_MAT)} ₫ trả bằng tiền mặt`,
                chiTiet: `Tổng ${vnd(chiMat)} ₫, trong đó ${vnd(vatMat)} ₫ thuế GTGT có nguy cơ bị loại khỏi khấu trừ, và phần chi phí tương ứng bị loại khi tính thuế TNDN.`,
                canCu: `Điều 14 Luật Thuế GTGT 48/2024 và NĐ 181/2025 — mua vào từ ${vnd(NGUONG_KHONG_TIEN_MAT)} ₫ phải có chứng từ thanh toán không dùng tiền mặt mới được khấu trừ; Điều 4 TT 96/2015 với chi phí được trừ.`,
                canLam: 'Tìm lại chứng từ chuyển khoản nếu thực tế đã chuyển khoản mà ghi nhầm; khoản nào đúng là trả tiền mặt thì chủ động loại khỏi khấu trừ trước, đừng để đoàn thanh tra loại rồi phạt kê khai sai.',
                tienRuiRo: Math.round(vatMat + chiMat * 0.2),
                soLuong: tienMatVuot.length,
                viDu: tienMatVuot.slice(0, 5).map((e: any) => `${(e.description || '').slice(0, 32)} · ${vnd(e.amount)} ₫`),
            })
        }

        // ── 4. Chi phí không có hóa đơn ──────────────────────────────────────
        const khongHoaDon = chi.filter((e: any) =>
            (e.status ?? 'active') === 'active'
            && String(e.category || '') !== 'supplier_payment'
            && (e.amount || 0) >= NGUONG_CHI_CAN_HOA_DON
            && !e.invoiceNo)
        if (khongHoaDon.length > 0) {
            const tong = khongHoaDon.reduce((s: number, e: any) => s + (e.amount || 0), 0)
            _chiKhongHd = Math.round(tong); _soChiKhongHd = khongHoaDon.length
            canhBao.push({
                code: 'chi-khong-hoa-don', muc: 'vua',
                tieuDe: `${khongHoaDon.length} khoản chi từ ${vnd(NGUONG_CHI_CAN_HOA_DON)} ₫ chưa có số hóa đơn`,
                chiTiet: `Tổng ${vnd(tong)} ₫. Chi phí không có hóa đơn hợp lệ sẽ bị loại khi quyết toán thuế TNDN — thuế phải nộp thêm ước tính ${vnd(tong * 0.2)} ₫ theo thuế suất 20%.`,
                canCu: 'Điều 4 TT 96/2015/TT-BTC — điều kiện chi phí được trừ: có đủ hóa đơn, chứng từ hợp pháp.',
                canLam: 'Bổ sung số hóa đơn cho các khoản đã có hóa đơn giấy/điện tử; khoản nào thực sự không có hóa đơn thì tách riêng để loại khi quyết toán, tránh bị phạt kê khai sai.',
                tienRuiRo: Math.round(tong * 0.2),
                soLuong: khongHoaDon.length,
                viDu: khongHoaDon.slice(0, 5).map((e: any) => `${(e.description || '').slice(0, 32)} · ${vnd(e.amount)} ₫`),
            })
        }
    } catch { /* bỏ qua nếu thiếu bảng */ }

    // ── 5. Phiếu nhập có hóa đơn GTGT nhưng trả ngay bằng tiền mặt ───────────
    try {
        const nhaps = await prisma.importReceipt.findMany({
            where: { status: 'completed', createdAt: { gte: start, lte: end } },
            select: { code: true, totalCost: true, vatAmount: true, paidAmount: true, hasVatInvoice: true, supplierName: true },
        })
        const nghiNgo = nhaps.filter((r: any) =>
            r.hasVatInvoice && (r.paidAmount || 0) >= NGUONG_KHONG_TIEN_MAT)
        if (nghiNgo.length > 0) {
            const vat = nghiNgo.reduce((s: number, r: any) => s + (r.vatAmount || 0), 0)
            canhBao.push({
                code: 'nhap-tra-tien-mat', muc: 'vua',
                tieuDe: `${nghiNgo.length} phiếu nhập có hóa đơn GTGT trả ngay từ ${vnd(NGUONG_KHONG_TIEN_MAT)} ₫`,
                chiTiet: `Tổng thuế GTGT đầu vào liên quan ${vnd(vat)} ₫. Hệ thống không lưu phương thức thanh toán của phần trả ngay nên KHÔNG kết luận là sai — nhưng đây đúng là nhóm đoàn thanh tra sẽ đòi chứng từ.`,
                canCu: `Điều 14 Luật Thuế GTGT 48/2024 — chứng từ thanh toán không dùng tiền mặt với giao dịch từ ${vnd(NGUONG_KHONG_TIEN_MAT)} ₫.`,
                canLam: 'Kẹp ủy nhiệm chi / sao kê ngân hàng vào từng phiếu nhập trong nhóm này trước khi đoàn tới.',
                tienRuiRo: Math.round(vat),
                soLuong: nghiNgo.length,
                viDu: nghiNgo.slice(0, 5).map((r: any) => `${r.code}${r.supplierName ? ' · ' + r.supplierName : ''}`),
            })
        }
    } catch { /* bỏ qua */ }

    // ── 6. Tồn kho âm — dấu hiệu mua bán không hóa đơn ───────────────────────
    try {
        const am = await prisma.product.findMany({
            where: { stock: { lt: 0 } },
            select: { name: true, sku: true, stock: true, costPrice: true },
        })
        if (am.length > 0) {
            const giaTri = am.reduce((s: number, p: any) => s + Math.abs(p.stock || 0) * (p.costPrice || 0), 0)
            canhBao.push({
                code: 'ton-kho-am', muc: 'cao',
                tieuDe: `${am.length} mặt hàng đang có tồn kho ÂM`,
                chiTiet: `Giá trị tương ứng khoảng ${vnd(giaTri)} ₫. Bán ra nhiều hơn số đã nhập là dấu hiệu điển hình của mua hàng không hóa đơn — cơ quan thuế có quyền ấn định cả doanh thu lẫn chi phí.`,
                canCu: 'Điều 50 Luật Quản lý thuế 38/2019 — ấn định thuế; Điều 14 NĐ 125/2020 — xử phạt hành vi khai sai.',
                canLam: 'Rà lại phiếu nhập bị thiếu, nhập bổ sung kèm hóa đơn đầu vào hợp lệ; nếu là sai sót kiểm kê thì lập biên bản kiểm kê và điều chỉnh trước khi khóa sổ.',
                tienRuiRo: Math.round(giaTri),
                soLuong: am.length,
                viDu: am.slice(0, 5).map((p: any) => `${p.name} (${p.stock})`),
            })
        }
    } catch { /* bỏ qua */ }

    // ── 7. Quỹ tiền mặt âm tại một thời điểm bất kỳ trong kỳ ─────────────────
    {
        const theoNgay: Record<string, number> = {}
        for (const e of butToan) {
            const d = String(e.date)
            if (String(e.debitAccount || '').startsWith('111')) theoNgay[d] = (theoNgay[d] ?? 0) + e.amount
            if (String(e.creditAccount || '').startsWith('111')) theoNgay[d] = (theoNgay[d] ?? 0) - e.amount
        }
        // Số dư đầu kỳ của quỹ để cộng dồn cho đúng
        let duDau = 0
        try {
            const truoc: Array<{ debitAccount: string; creditAccount: string; amount: number }> =
                await prisma.journalEntry.findMany({
                    where: { date: { lt: from } },
                    select: { debitAccount: true, creditAccount: true, amount: true },
                })
            const p = phatSinh(truoc, '111')
            duDau = p.no - p.co
        } catch { /* bỏ qua */ }
        let duy = duDau
        const ngayAm: string[] = []
        let amNhat = 0
        for (const d of Object.keys(theoNgay).sort()) {
            duy += theoNgay[d]!
            if (duy < -NGUONG_LECH_BO_QUA) {
                ngayAm.push(`${d} (${vnd(duy)} ₫)`)
                if (duy < amNhat) amNhat = duy
            }
        }
        if (ngayAm.length > 0) canhBao.push({
            code: 'quy-am-trong-ky', muc: 'cao',
            tieuDe: `Sổ quỹ tiền mặt âm ở ${ngayAm.length} ngày trong kỳ`,
            chiTiet: `Âm sâu nhất ${vnd(amNhat)} ₫. Quỹ tiền mặt không thể âm trên thực tế — đây là bằng chứng sổ sách không phản ánh đúng, thường dẫn tới việc bác bỏ toàn bộ sổ và ấn định thuế.`,
            canCu: 'Điều 50 Luật Quản lý thuế 38/2019; nguyên tắc ghi sổ theo Luật Kế toán 88/2015.',
            canLam: 'Tìm khoản thu chưa ghi (thu nợ, góp vốn, vay chủ) và bổ sung chứng từ; tuyệt đối không lùi ngày phiếu chi để che.',
            tienRuiRo: Math.abs(Math.round(amNhat)),
            soLuong: ngayAm.length,
            viDu: ngayAm.slice(0, 5),
        })
    }

    // ── 8. Bán dưới giá vốn ──────────────────────────────────────────────────
    try {
        const txs = await prisma.transaction.findMany({
            where: { status: { in: ['completed', 'partial'] }, createdAt: { gte: start, lte: end } },
            select: {
                receiptNumber: true,
                items: { select: { productId: true, productName: true, quantity: true, lineTotal: true, product: { select: { costPrice: true } } } },
            },
        })
        let soDong = 0, tienLo = 0
        const viDu: string[] = []
        for (const t of txs) {
            for (const i of (t.items ?? [])) {
                const von = (i.product?.costPrice ?? 0) * (i.quantity ?? 0)
                if (von <= 0) continue
                const thu = i.lineTotal ?? 0
                if (thu < von) {
                    soDong++; tienLo += von - thu
                    if (viDu.length < 5) viDu.push(`${t.receiptNumber} · ${i.productName}`)
                }
            }
        }
        /* Hàng xuất giá 0 đồng = hàng cho/biếu/tặng/khuyến mãi. Theo Điều 4 NĐ
         * 123/2020 vẫn PHẢI lập hóa đơn; và nếu chương trình khuyến mãi không
         * được thực hiện theo pháp luật thương mại thì phải tính thuế GTGT đầu
         * ra theo giá bán hàng cùng loại. Đây là lỗi bị bắt rất thường xuyên. */
        let soDongTang = 0, giaTriTang = 0
        const viDuTang: string[] = []
        for (const t of txs) {
            for (const i of (t.items ?? [])) {
                if ((i.quantity ?? 0) <= 0) continue
                if ((i.lineTotal ?? 0) > 0) continue
                const von = (i.product?.costPrice ?? 0) * (i.quantity ?? 0)
                if (von <= 0) continue
                soDongTang++; giaTriTang += von
                if (viDuTang.length < 5) viDuTang.push(`${t.receiptNumber} · ${i.productName} ×${i.quantity}`)
            }
        }
        if (soDongTang > 0) canhBao.push({
            code: 'hang-tang-gia-0', muc: 'vua',
            tieuDe: `${soDongTang} dòng hàng xuất giá 0 đồng (hàng tặng/khuyến mãi)`,
            chiTiet: `Giá vốn tương ứng ${vnd(giaTriTang)} ₫. Hàng cho, biếu, tặng và hàng khuyến mãi vẫn phải lập hóa đơn; nếu chương trình khuyến mãi không được đăng ký/thông báo theo pháp luật thương mại thì còn phải tính thuế GTGT đầu ra theo giá bán hàng cùng loại.`,
            canCu: 'Điều 4 NĐ 123/2020 — lập hóa đơn kể cả hàng cho, biếu, tặng, khuyến mãi; khoản 5 Điều 7 TT 219/2013 — giá tính thuế hàng khuyến mãi.',
            canLam: 'Đối chiếu với hồ sơ đăng ký/thông báo chương trình khuyến mãi; phần không thuộc chương trình hợp lệ thì lập hóa đơn và kê khai thuế đầu ra bổ sung.',
            tienRuiRo: Math.round(giaTriTang * 0.1), soLuong: soDongTang, viDu: viDuTang,
        })

        if (soDong > 0) canhBao.push({
            code: 'ban-duoi-gia-von', muc: 'vua',
            tieuDe: `${soDong} dòng bán dưới giá vốn`,
            chiTiet: `Tổng phần thấp hơn giá vốn là ${vnd(tienLo)} ₫. Bán lỗ kéo dài bị nghi là hạ giá trên hóa đơn để giấu doanh thu, và cơ quan thuế có quyền ấn định lại giá.`,
            canCu: 'Điều 50 Luật Quản lý thuế 38/2019 — ấn định khi giá giao dịch không theo giá thị trường.',
            canLam: 'Chuẩn bị giải trình cho từng trường hợp: hàng cận hạn, hàng trưng bày, chương trình khuyến mãi đã đăng ký. Khuyến mãi phải có quyết định/thông báo kèm theo.',
            tienRuiRo: Math.round(tienLo), soLuong: soDong, viDu,
        })
    } catch { /* bỏ qua */ }

    /* ── 9. Hồ sơ khai thuế quá hạn ──────────────────────────────────────────
     * Đọc bảng TaxDeadline NHƯNG không phụ thuộc vào việc bảng đã được seed:
     * bảng này chỉ được sinh khi ai đó mở trang Lịch thuế, nên nếu chưa ai mở,
     * phép kiểm tra sẽ câm lặng — đúng lúc cần nó nhất. Vì vậy khi bảng rỗng,
     * tự dựng hạn nộp trong bộ nhớ theo Điều 44 Luật Quản lý thuế 38/2019. */
    try {
        const homNay = ngayISO(new Date())
        const dl = await prisma.taxDeadline.findMany({
            select: { taxType: true, period: true, dueDate: true, status: true },
        })
        if (!dl || dl.length === 0) {
            // Tự dựng: tờ khai GTGT tháng (hạn 20 tháng sau) + lệ phí môn bài (30/01)
            const namKy = Number(maKy.slice(0, 4))
            const tuDung: Array<{ taxType: string; period: string; dueDate: string }> = []
            for (let m = 1; m <= 12; m++) {
                const nam = m === 12 ? namKy + 1 : namKy
                const thang = m === 12 ? 1 : m + 1
                tuDung.push({
                    taxType: '01_GTGT', period: `T${String(m).padStart(2, '0')}/${namKy}`,
                    dueDate: `${nam}-${String(thang).padStart(2, '0')}-20`,
                })
            }
            /* CỐ Ý không tự dựng lệ phí môn bài ở đây: dữ liệu trong phần mềm
             * không cho biết đã nộp hay chưa, cảnh báo là tố oan. Khoản này đã
             * nằm trong lịch thuế chính thức (tax.ts) và trong danh mục hồ sơ
             * cần chuẩn bị bên dưới. */

            /* Danh sách kỳ ĐÃ khai. Nếu không đọc được danh sách này thì TUYỆT
             * ĐỐI không cảnh báo: coi mọi kỳ là chưa khai sẽ tố oan doanh nghiệp
             * đã nộp đầy đủ — thà im còn hơn báo sai ở mảng thuế. */
            let daKhai: Set<string> | null = null
            try {
                const tks = await prisma.taxDeclaration.findMany({ select: { period: true } })
                daKhai = new Set<string>((tks || []).map((t: any) => String(t.period)))
            } catch { daKhai = null }
            const treTuDung = daKhai === null ? [] : tuDung.filter(d => {
                if (d.dueDate >= homNay) return false
                const m = /^T(\d{2})\/(\d{4})$/.exec(d.period)
                if (!m) return false
                return !daKhai!.has(`${m[2]}-${m[1]}`)
            })
            if (treTuDung.length > 0) canhBao.push({
                code: 'to-khai-tre-han-uoc', muc: 'vua',
                tieuDe: `${treTuDung.length} kỳ có thể đã quá hạn khai thuế`,
                chiTiet: `Hệ thống chưa có lịch thuế nên tự dựng theo quy định: quá hạn sớm nhất là ${treTuDung.map(d => d.dueDate).sort()[0]}. Danh sách này dựa trên việc CHƯA thấy tờ khai trong phần mềm — nếu đã nộp ngoài hệ thống thì nhập lại để đối chiếu.`,
                canCu: 'Điều 44 Luật Quản lý thuế 38/2019 — thời hạn nộp hồ sơ khai thuế; Điều 13 NĐ 125/2020 — phạt chậm nộp.',
                canLam: 'Mở trang Lịch thuế để hệ thống lập lịch chính thức, rồi đánh dấu các kỳ đã nộp.',
                tienRuiRo: null, soLuong: treTuDung.length,
                viDu: treTuDung.slice(0, 5).map(d => `${d.taxType} kỳ ${d.period} · hạn ${d.dueDate}`),
            })
        }
        const treHan = (dl || []).filter((d: any) => d.status !== 'filed' && d.status !== 'paid' && String(d.dueDate) < homNay)
        if (treHan.length > 0) canhBao.push({
            code: 'to-khai-tre-han', muc: 'cao',
            tieuDe: `${treHan.length} hồ sơ khai thuế đã quá hạn`,
            chiTiet: `Quá hạn lâu nhất: ${treHan.map((d: any) => d.dueDate).sort()[0]}. Chậm nộp hồ sơ bị phạt riêng, độc lập với tiền thuế; chậm nộp tiền thuế còn tính thêm 0,03%/ngày.`,
            canCu: 'Điều 13 NĐ 125/2020 — phạt chậm nộp hồ sơ khai thuế; Điều 59 Luật Quản lý thuế 38/2019 — tiền chậm nộp.',
            canLam: 'Nộp ngay hồ sơ còn thiếu; nộp trước khi cơ quan thuế lập biên bản thì mức phạt nhẹ hơn đáng kể.',
            tienRuiRo: null, soLuong: treHan.length,
            viDu: treHan.slice(0, 5).map((d: any) => `${d.taxType} kỳ ${d.period} · hạn ${d.dueDate}`),
        })
    } catch { /* bỏ qua */ }

    /* ── 9a. Số hóa đơn: nhảy số, trùng số, lùi ngày ─────────────────────────
     * Ba phép này đoàn thanh tra làm gần như mặc định vì chúng phát hiện việc
     * "giấu" hóa đơn (nhảy số), xuất trùng (trùng số) và hợp thức hóa chứng từ
     * sau khi sự việc đã xảy ra (lùi ngày). Hóa đơn bị HỦY vẫn giữ số nên vẫn
     * nằm trong dữ liệu — số thiếu nghĩa là số đó chưa từng được ghi nhận. */
    try {
        const hds = await prisma.eInvoice.findMany({
            where: { invoiceDate: { gte: from, lte: to } },
            select: { invoiceNumber: true, invoiceSymbol: true, invoiceDate: true, status: true, createdAt: true },
        })
        const theoKyHieu: Record<string, Array<{ so: number; goc: string }>> = {}
        const trungSo: string[] = []
        for (const h of (hds || [])) {
            const st = String(h.status || '').toUpperCase()
            if (st === 'DRAFT' || st === 'ERROR') continue      // chưa phát hành thì chưa có số chính thức
            const so = Number(String(h.invoiceNumber || '').replace(/\D/g, ''))
            if (!so) continue
            const kh = String(h.invoiceSymbol || '(không ký hiệu)')
            const ds = theoKyHieu[kh] ?? (theoKyHieu[kh] = [])
            if (ds.some(x => x.so === so)) trungSo.push(`${kh} · ${h.invoiceNumber}`)
            else ds.push({ so, goc: String(h.invoiceNumber) })
        }

        const thieuSo: string[] = []
        let tongThieu = 0
        for (const [kh, ds] of Object.entries(theoKyHieu)) {
            if (ds.length < 2) continue
            const sos = ds.map(x => x.so).sort((a, b) => a - b)
            const min = sos[0]!, max = sos[sos.length - 1]!
            // Dải quá rộng so với số hóa đơn thực có → nhiều khả năng dữ liệu nhập
            // thiếu chứ không phải nhảy số; không kết luận để khỏi báo bừa.
            if (max - min > sos.length * 50) continue
            const coSo = new Set(sos)
            for (let n = min; n <= max; n++) {
                if (coSo.has(n)) continue
                tongThieu++
                if (thieuSo.length < 5) thieuSo.push(`${kh} · số ${n}`)
            }
        }
        if (tongThieu > 0) canhBao.push({
            code: 'hoa-don-nhay-so', muc: 'cao',
            tieuDe: `${tongThieu} số hóa đơn bị thiếu trong dải đã phát hành`,
            chiTiet: 'Hóa đơn phải liên tục theo ký hiệu; hóa đơn hủy vẫn giữ số nên vẫn phải có mặt. Số bị khuyết là dấu hiệu có hóa đơn không được ghi nhận vào hệ thống.',
            canCu: 'Điều 10 NĐ 123/2020 — ký hiệu và số hóa đơn liên tục theo thứ tự; Điều 19 NĐ 123/2020 — xử lý hóa đơn sai sót.',
            canLam: 'Tra cứu các số bị khuyết trên cổng hóa đơn điện tử, tải về và nhập lại vào hệ thống; số nào thực sự chưa dùng thì lập biên bản ghi nhận.',
            tienRuiRo: null, soLuong: tongThieu, viDu: thieuSo,
        })
        if (trungSo.length > 0) canhBao.push({
            code: 'hoa-don-trung-so', muc: 'cao',
            tieuDe: `${trungSo.length} hóa đơn trùng số trong cùng ký hiệu`,
            chiTiet: 'Hai hóa đơn cùng ký hiệu và cùng số là lỗi nghiêm trọng về quản lý hóa đơn, thường do nhập tay hoặc đồng bộ hai lần.',
            canCu: 'Điều 10 NĐ 123/2020 — mỗi số hóa đơn chỉ dùng một lần trong cùng ký hiệu.',
            canLam: 'Đối chiếu với dữ liệu trên cổng hóa đơn điện tử của cơ quan thuế, xóa bản ghi trùng trong phần mềm (không xóa hóa đơn đã phát hành thật).',
            tienRuiRo: null, soLuong: trungSo.length, viDu: trungSo.slice(0, 5),
        })

        // Lùi ngày: ngày trên hóa đơn sớm hơn ngày bản ghi được tạo quá 1 ngày
        const luiNgay = (hds || []).filter((h: any) => {
            const st = String(h.status || '').toUpperCase()
            if (st === 'DRAFT' || st === 'ERROR') return false
            if (!h.invoiceDate || !h.createdAt) return false
            const ngayHd = new Date(`${h.invoiceDate}T00:00:00.000Z`).getTime()
            const ngayTao = new Date(ngayISO(new Date(h.createdAt)) + 'T00:00:00.000Z').getTime()
            return ngayTao - ngayHd > 86400000
        })
        if (luiNgay.length > 0) canhBao.push({
            code: 'hoa-don-lui-ngay', muc: 'vua',
            tieuDe: `${luiNgay.length} hóa đơn có ngày sớm hơn ngày lập trên hệ thống`,
            chiTiet: 'Ngày ghi trên hóa đơn sớm hơn thời điểm bản ghi được tạo từ 2 ngày trở lên. Có thể do nhập bù hóa đơn cũ, nhưng đây cũng là dấu hiệu hợp thức hóa chứng từ nên đoàn thanh tra sẽ hỏi.',
            canCu: 'Điều 9 NĐ 123/2020 — thời điểm lập hóa đơn là thời điểm chuyển giao hàng hóa, cung cấp dịch vụ.',
            canLam: 'Chuẩn bị chứng từ giao hàng/nghiệm thu chứng minh thời điểm thực tế; nếu là nhập bù dữ liệu cũ thì ghi chú rõ trong hồ sơ.',
            tienRuiRo: null, soLuong: luiNgay.length,
            viDu: luiNgay.slice(0, 5).map((h: any) => `${h.invoiceSymbol || ''} ${h.invoiceNumber || ''} · HĐ ${h.invoiceDate}`.trim()),
        })
    } catch { /* chưa có bảng EInvoice — bỏ qua */ }

    /* ── 9b. Hóa đơn giá trị lớn cho khách doanh nghiệp mà thiếu MST người mua ─
     * Người mua là doanh nghiệp thì phải có MST trên hóa đơn mới khấu trừ được;
     * bên bán bị hỏi vì xuất hóa đơn thiếu chỉ tiêu bắt buộc. */
    try {
        const hds = await prisma.eInvoice.findMany({
            where: { invoiceDate: { gte: from, lte: to } },
            select: { invoiceNumber: true, status: true, invoiceType: true, totalAmount: true, buyerName: true, buyerTaxCode: true },
        })
        const thieuMstMua = (hds || []).filter((h: any) => {
            const st = String(h.status || '').toUpperCase()
            if (st === 'CANCELLED' || st === 'DRAFT' || st === 'ERROR' || st === 'REPLACED') return false
            if (String(h.invoiceType || 'SALE').toUpperCase() !== 'SALE') return false
            if ((h.totalAmount || 0) < NGUONG_KHONG_TIEN_MAT) return false
            if (h.buyerTaxCode) return false
            // Chỉ nghi ngờ khi tên người mua trông như tổ chức — khách lẻ không cần MST
            const ten = String(h.buyerName || '')
            return /công ty|cty|doanh nghiệp|dn |tnhh|cổ phần|cp |hộ kinh doanh|hkd/i.test(ten)
        })
        if (thieuMstMua.length > 0) canhBao.push({
            code: 'hoa-don-ra-thieu-mst-mua', muc: 'vua',
            tieuDe: `${thieuMstMua.length} hóa đơn bán cho tổ chức nhưng thiếu mã số thuế người mua`,
            chiTiet: `Giá trị từ ${vnd(NGUONG_KHONG_TIEN_MAT)} ₫ trở lên. Thiếu MST người mua là thiếu chỉ tiêu bắt buộc trên hóa đơn, bên mua không khấu trừ được và thường quay lại yêu cầu bên bán điều chỉnh.`,
            canCu: 'Điều 10 NĐ 123/2020 — nội dung bắt buộc của hóa đơn, gồm mã số thuế người mua khi người mua là tổ chức.',
            canLam: 'Liên hệ khách lấy MST và lập hóa đơn điều chỉnh/thay thế theo Điều 19 NĐ 123/2020.',
            tienRuiRo: null, soLuong: thieuMstMua.length,
            viDu: thieuMstMua.slice(0, 5).map((h: any) => `${h.invoiceNumber || '(chưa số)'} · ${h.buyerName || ''}`.trim()),
        })
    } catch { /* bỏ qua */ }

    /* ── 9c. Bán nhiều hơn lượng nhập CÓ HÓA ĐƠN đầu vào ─────────────────────
     * Đây là kết luận mạnh nhất mà đoàn thanh tra rút ra được từ số liệu: bán ra
     * vượt quá số đã mua có hóa đơn nghĩa là có nguồn hàng không chứng từ. Hệ
     * thống đã chặn việc XUẤT hóa đơn khi thiếu tồn kho thuế, nhưng chưa bao giờ
     * tổng hợp lại cho người dùng thấy toàn cảnh.
     *
     * Dùng SQL thô vì phải gộp theo SKU trên hai bảng lớn; bọc try/catch để nơi
     * nào chưa có bảng/cột thì bỏ qua thay vì làm hỏng cả bản soát. */
    try {
        const rows: any[] = await prisma.$queryRawUnsafe(`
            WITH nhap AS (
                SELECT LOWER(TRIM(ii."productSku")) AS k,
                       SUM(ii.quantity - COALESCE(ii."returnedQuantity",0))::float8 AS q
                FROM "ImportReceiptItem" ii
                JOIN "ImportReceipt" r ON r.id = ii."receiptId"
                WHERE r."hasVatInvoice" = true AND r.status = 'completed'
                GROUP BY 1
            ), ban AS (
                SELECT LOWER(TRIM(i.sku)) AS k,
                       SUM(COALESCE(NULLIF(i."baseQuantity",0), i.quantity))::float8 AS q,
                       MAX(i."productName") AS ten
                FROM "TransactionItem" i
                JOIN "Transaction" t ON t.id = i."transactionId"
                WHERE t.status IN ('completed','partial','returned') AND i.sku IS NOT NULL AND TRIM(i.sku) <> ''
                GROUP BY 1
            )
            SELECT b.k AS sku, b.ten, b.q AS ban, COALESCE(n.q,0) AS nhap, (b.q - COALESCE(n.q,0)) AS thieu
            FROM ban b LEFT JOIN nhap n ON n.k = b.k
            WHERE b.q - COALESCE(n.q,0) > 0
            ORDER BY (b.q - COALESCE(n.q,0)) DESC
            LIMIT 50
        `)
        if (rows && rows.length > 0) {
            const tongThieu = rows.reduce((s: number, r: any) => s + Number(r.thieu || 0), 0)
            canhBao.push({
                code: 'ban-vuot-hoa-don-vao', muc: 'cao',
                tieuDe: `${rows.length} mã bán ra nhiều hơn lượng nhập có hóa đơn`,
                chiTiet: `Tổng chênh khoảng ${Math.round(tongThieu).toLocaleString('vi-VN')} đơn vị. Phần bán vượt này không có hóa đơn đầu vào tương ứng — đoàn thanh tra thường coi đây là bằng chứng mua hàng trôi nổi và có thể ấn định cả doanh thu lẫn chi phí.`,
                canCu: 'Điều 50 Luật Quản lý thuế 38/2019 — ấn định thuế; Điều 14 Luật Thuế GTGT 48/2024 — điều kiện khấu trừ.',
                canLam: 'Bổ sung hóa đơn đầu vào cho phần hàng đã bán; mã nào không có nguồn hóa đơn thì chuẩn bị phương án giải trình và tính trước phần thuế có thể bị truy thu.',
                tienRuiRo: null, soLuong: rows.length,
                viDu: rows.slice(0, 5).map((r: any) => `${r.ten || r.sku} · thiếu ${Math.round(Number(r.thieu))}`),
            })
        }
    } catch { /* thiếu bảng hoặc DB không phải Postgres — bỏ qua */ }

    // ── 10. Hóa đơn đầu vào thiếu thông tin bắt buộc để khấu trừ ─────────────
    try {
        const chiVat = await prisma.expense.findMany({
            where: { date: { gte: start, lte: end } },
            select: { id: true, description: true, amount: true, vatAmount: true, invoiceNo: true, supplierTaxCode: true, invoiceDate: true, status: true, category: true },
        })
        const thieuTt = chiVat.filter((e: any) =>
            (e.status ?? 'active') === 'active'
            && String(e.category || '') !== 'supplier_payment'
            && (e.vatAmount || 0) > 0
            && (!e.supplierTaxCode || !e.invoiceNo || !e.invoiceDate))
        if (thieuTt.length > 0) {
            const vat = thieuTt.reduce((s: number, e: any) => s + (e.vatAmount || 0), 0)
            _vatThieuTt = Math.round(vat); _soThieuTt = thieuTt.length
            canhBao.push({
                code: 'hoa-don-vao-thieu-thong-tin', muc: 'vua',
                tieuDe: `${thieuTt.length} hóa đơn đầu vào thiếu thông tin bắt buộc`,
                chiTiet: `Thiếu mã số thuế người bán, số hóa đơn hoặc ngày hóa đơn — tổng thuế GTGT liên quan ${vnd(vat)} ₫ có thể bị loại khỏi khấu trừ vì không đủ căn cứ đối chiếu với dữ liệu hóa đơn của cơ quan thuế.`,
                canCu: 'Điều 14 Luật Thuế GTGT 48/2024 — hóa đơn hợp pháp là điều kiện khấu trừ; Điều 10 NĐ 123/2020 — nội dung bắt buộc của hóa đơn.',
                canLam: 'Mở lại từng hóa đơn giấy/PDF và nhập bổ sung MST người bán, số và ngày hóa đơn vào phiếu chi tương ứng.',
                tienRuiRo: Math.round(vat), soLuong: thieuTt.length,
                viDu: thieuTt.slice(0, 5).map((e: any) => `${(e.description || '').slice(0, 32)} · ${vnd(e.vatAmount || 0)} ₫ VAT`),
            })
        }
    } catch { /* bỏ qua */ }

    /* ── 11. Thuế TNCN từ lương ──────────────────────────────────────────────
     * Nhóm bị soi nhiều thứ hai sau GTGT: chi lương vào chi phí thì phải chứng
     * minh được đã khấu trừ và kê khai TNCN, và người lao động phải có MST. */
    try {
        const kyLuong = await prisma.payrollPeriod.findMany({
            where: { year: Number(maKy.slice(0, 4)) },
            select: { id: true, month: true, year: true, status: true, totalGross: true },
        }).catch(() => [])
        const thangKy = /^\d{4}-(\d{2})$/.exec(maKy)
        const ky = thangKy
            ? (kyLuong as any[]).filter(p => p.month === Number(thangKy[1]))
            : (kyLuong as any[])
        if (ky.length > 0) {
            const dsEntry = await prisma.payrollEntry.findMany({
                where: { periodId: { in: ky.map((p: any) => p.id) } },
                select: { employeeId: true, employeeName: true, grossSalary: true, taxableIncome: true, pitAmount: true, totalInsuranceEmployee: true, dependents: true },
            })
            // Thu nhập vượt ngưỡng chịu thuế mà pitAmount = 0 → thiếu khấu trừ
            const NGUONG_GIAM_TRU = 11_000_000
            const thieuKhauTru = dsEntry.filter((e: any) =>
                (e.grossSalary || 0) - (e.totalInsuranceEmployee || 0)
                - NGUONG_GIAM_TRU - (e.dependents || 0) * 4_400_000 > 0
                && (e.pitAmount || 0) <= 0)
            if (thieuKhauTru.length > 0) {
                const thuNhap = thieuKhauTru.reduce((s: number, e: any) => s + (e.grossSalary || 0), 0)
                canhBao.push({
                    code: 'tncn-thieu-khau-tru', muc: 'cao',
                    tieuDe: `${thieuKhauTru.length} lao động có thu nhập trên ngưỡng nhưng không khấu trừ TNCN`,
                    chiTiet: `Tổng thu nhập nhóm này ${vnd(thuNhap)} ₫ trong kỳ. Doanh nghiệp trả lương có nghĩa vụ khấu trừ trước khi chi; không khấu trừ thì bị truy thu và phạt, đồng thời khoản lương đó có nguy cơ bị loại khỏi chi phí được trừ.`,
                    canCu: 'Điều 24, 25 Luật Thuế TNCN; Điều 4 TT 96/2015 về chi phí tiền lương được trừ.',
                    canLam: 'Tính lại TNCN cho các lao động này, khấu trừ bù và khai bổ sung tờ khai 05/KK-TNCN của kỳ tương ứng.',
                    tienRuiRo: null, soLuong: thieuKhauTru.length,
                    viDu: thieuKhauTru.slice(0, 5).map((e: any) => `${e.employeeName || e.employeeId} · ${vnd(e.grossSalary || 0)} ₫`),
                })
            }
            // Lao động trong bảng lương chưa có mã số thuế
            const dsNv = await prisma.employee.findMany({
                where: { id: { in: dsEntry.map((e: any) => e.employeeId).filter(Boolean) } },
                select: { id: true, name: true, taxCode: true },
            }).catch(() => [])
            const thieuMst = (dsNv as any[]).filter(n => !n.taxCode)
            if (thieuMst.length > 0) canhBao.push({
                code: 'tncn-thieu-mst', muc: 'vua',
                tieuDe: `${thieuMst.length} lao động trong bảng lương chưa có mã số thuế`,
                chiTiet: 'Thiếu MST thì không kê khai được vào tờ khai khấu trừ TNCN, và người lao động cũng không quyết toán được — đoàn thanh tra thường yêu cầu bổ sung ngay tại chỗ.',
                canCu: 'Điều 30 Luật Quản lý thuế 38/2019 — đăng ký thuế cho cá nhân có thu nhập.',
                canLam: 'Đăng ký MST cá nhân qua cơ quan thuế hoặc ủy quyền doanh nghiệp đăng ký thay, rồi cập nhật vào hồ sơ nhân sự.',
                tienRuiRo: null, soLuong: thieuMst.length,
                viDu: thieuMst.slice(0, 5).map((n: any) => n.name || n.id),
            })
        } else if (dtSo > 0) {
            // Có doanh thu mà không có bảng lương nào trong kỳ
            canhBao.push({
                code: 'thieu-bang-luong', muc: 'thap',
                tieuDe: 'Kỳ có doanh thu nhưng không có bảng lương',
                chiTiet: 'Cửa hàng có bán hàng mà không ghi nhận chi phí nhân công nào. Nếu thực tế có thuê người, phần lương trả ngoài sổ vừa không được tính chi phí, vừa là rủi ro về bảo hiểm và TNCN.',
                canCu: 'Điều 4 TT 96/2015 — chi phí tiền lương phải có hợp đồng, bảng lương, chứng từ chi.',
                canLam: 'Lập bảng lương cho kỳ; nếu chủ hộ tự làm không thuê ai thì bỏ qua cảnh báo này.',
                tienRuiRo: null, soLuong: 0, viDu: [],
            })
        }
    } catch { /* bỏ qua nếu thiếu bảng lương */ }

    /* ── 12. Riêng HỘ KINH DOANH ─────────────────────────────────────────────
     * Từ 01/01/2026 bỏ thuế khoán (NQ 198/2025), HKD chuyển sang kê khai theo
     * doanh thu thực — nên phần sổ sách và hóa đơn của HKD bị soi kỹ hơn trước. */
    try {
        const cauHinh = await prisma.storeSettings.findFirst({ select: { businessType: true } }).catch(() => null)
        const laHkd = cauHinh?.businessType === 'household' || cauHinh?.businessType === 'individual'
        if (laHkd) {
            const nam = Number(maKy.slice(0, 4))
            const dsHkd = await prisma.hkdRevenueEntry.findMany({
                where: { date: { gte: new Date(`${nam}-01-01T00:00:00.000Z`), lte: new Date(`${nam}-12-31T23:59:59.999Z`) } },
                select: { doanhThuThuan: true, doanhThu: true },
            }).catch(() => [])
            const dtNam = (dsHkd as any[]).reduce((s, r) => s + (r.doanhThuThuan || r.doanhThu || 0), 0)
            const NGUONG_HKD_CHIU_THUE = 200_000_000
            const NGUONG_HKD_POS = 1_000_000_000
            if (dtNam >= NGUONG_HKD_CHIU_THUE) canhBao.push({
                code: 'hkd-vuot-nguong-chiu-thue', muc: 'vua',
                tieuDe: `Doanh thu năm ${nam} đã vượt ngưỡng chịu thuế của hộ kinh doanh`,
                chiTiet: `Sổ doanh thu HKD ghi nhận ${vnd(dtNam)} ₫, vượt mức ${vnd(NGUONG_HKD_CHIU_THUE)} ₫/năm — phát sinh nghĩa vụ nộp thuế GTGT và TNCN theo tỷ lệ trên doanh thu.`,
                canCu: 'Luật Thuế GTGT 48/2024 — ngưỡng doanh thu không chịu thuế của hộ, cá nhân kinh doanh (200 triệu/năm từ 2026).',
                canLam: 'Kê khai và nộp thuế theo doanh thu thực; giữ đủ hóa đơn đầu vào để chứng minh nguồn hàng.',
                tienRuiRo: null, soLuong: 0, viDu: [],
            })
            if (dtNam >= NGUONG_HKD_POS) canhBao.push({
                code: 'hkd-phai-ket-noi-pos', muc: 'cao',
                tieuDe: 'Doanh thu vượt 1 tỷ — bắt buộc dùng hóa đơn điện tử khởi tạo từ máy tính tiền',
                chiTiet: `Doanh thu năm ${nam} là ${vnd(dtNam)} ₫. Hộ kinh doanh nhóm này phải xuất hóa đơn điện tử từ máy tính tiền có kết nối dữ liệu với cơ quan thuế.`,
                canCu: 'Nghị định 70/2025/NĐ-CP sửa đổi NĐ 123/2020 — hóa đơn điện tử khởi tạo từ máy tính tiền.',
                canLam: 'Kích hoạt kết nối máy tính tiền với cơ quan thuế và xuất hóa đơn cho từng lần bán.',
                tienRuiRo: null, soLuong: 0, viDu: [],
            })
        }
    } catch { /* bỏ qua */ }

    // ── Chấm điểm sẵn sàng ───────────────────────────────────────────────────
    const tru: Record<MucRuiRo, number> = { cao: 22, vua: 9, thap: 3 }
    let diem = 100
    for (const c of canhBao) diem -= tru[c.muc]
    diem = Math.max(0, Math.min(100, diem))
    const xepLoai = diem >= 90 ? 'Sẵn sàng' : diem >= 70 ? 'Cần bổ sung hồ sơ' : diem >= 45 ? 'Rủi ro cao' : 'Rất rủi ro'

    const thuTu: Record<MucRuiRo, number> = { cao: 0, vua: 1, thap: 2 }
    canhBao.sort((a, b) => thuTu[a.muc] - thuTu[b.muc] || (b.tienRuiRo ?? 0) - (a.tienRuiRo ?? 0))

    /* ── Ước tính tiền phải nộp thêm ─────────────────────────────────────────
     * CHỈ gộp những cảnh báo mà số tiền thực sự là THUẾ có nguy cơ bị truy thu.
     * Các cảnh báo còn lại (tồn kho âm, bán dưới giá vốn, hóa đơn hủy nhiều) là
     * dấu hiệu dẫn tới ấn định — mức ấn định do cơ quan thuế quyết, không thể
     * ước lượng nghiêm túc từ dữ liệu ở đây nên KHÔNG cộng vào, tránh dọa nhầm. */
    const MA_TINH_TRUY_THU = new Set([
        'vat-ra-lech',                   // chênh thuế đầu ra so tờ khai
        'tien-mat-vuot-nguong',          // VAT bị loại + chi phí bị loại
        'chi-khong-hoa-don',             // thuế TNDN phải nộp thêm
        'hoa-don-vao-thieu-thong-tin',   // VAT đầu vào bị loại
        'nhap-tra-tien-mat',             // VAT đầu vào rủi ro
    ])
    const truyThu = Math.round(
        canhBao.filter(c => MA_TINH_TRUY_THU.has(c.code)).reduce((s, c) => s + (c.tienRuiRo ?? 0), 0),
    )
    const phatKhaiSai = Math.round(truyThu * TY_LE_PHAT_KHAI_SAI)

    /* Hạn nộp: tờ khai tháng — ngày 20 tháng sau; quý — ngày cuối tháng đầu quý
     * sau (Điều 44 Luật Quản lý thuế 38/2019). Tiền chậm nộp tính từ hạn đó. */
    let hanNop: string | null = null
    {
        const m = /^(\d{4})-(\d{2})$/.exec(maKy)
        const q = /^(\d{4})-Q([1-4])$/.exec(maKy)
        if (m) {
            const nam = Number(m[1]), thang = Number(m[2])
            const d = new Date(Date.UTC(nam, thang, 20)) // tháng sau, ngày 20
            hanNop = d.toISOString().slice(0, 10)
        } else if (q) {
            const nam = Number(q[1]), quy = Number(q[2])
            // cuối tháng đầu tiên của quý sau
            const thangSau = quy * 3 + 1
            const d = new Date(Date.UTC(nam, thangSau, 0))
            hanNop = d.toISOString().slice(0, 10)
        }
    }
    let soNgayCham = 0
    if (hanNop && truyThu > 0) {
        const cach = Math.floor((Date.now() - new Date(`${hanNop}T00:00:00.000Z`).getTime()) / 86400000)
        soNgayCham = Math.max(0, cach)
    }
    const chamNop = Math.round(truyThu * TY_LE_CHAM_NOP_NGAY * soNgayCham)

    const uocTinhPhat: UocTinhPhat = {
        truyThu, phatKhaiSai, chamNop, soNgayCham, hanNop,
        tong: truyThu + phatKhaiSai + chamNop,
        ghiChu: 'Ước tính theo mức phạt khai sai 20% (Điều 16 NĐ 125/2020) và tiền chậm nộp 0,03%/ngày (Điều 59 Luật Quản lý thuế 38/2019), tính từ hạn nộp của kỳ tới hôm nay. Chỉ gộp phần thuế định lượng được; các dấu hiệu dẫn tới ẤN ĐỊNH thuế (tồn kho âm, bán dưới giá vốn) không cộng vào vì mức ấn định do cơ quan thuế quyết định. Đây KHÔNG phải số liệu chính thức.',
    }

    return {
        ky: nhan,
        diem, xepLoai,
        canhBao,
        uocTinhPhat,
        doanhThu: { so: dtSo, toKhai: dtToKhai, hoaDon: dtHoaDon },
        thue: { vatRaSo, vatRaToKhai, vatVaoSo, vatVaoToKhai },
        hoSoCanChuanBi: [
            'Sổ nhật ký chung, sổ cái các tài khoản 111, 112, 131, 331, 156, 511, 632, 641, 642 của kỳ thanh tra',
            'Bảng cân đối phát sinh và Báo cáo tài chính đã nộp',
            'Toàn bộ tờ khai GTGT, TNDN, TNCN đã nộp kèm giấy nộp tiền',
            'Bảng kê hóa đơn bán ra, mua vào; file XML hóa đơn điện tử',
            'Hợp đồng, biên bản giao nhận, chứng từ thanh toán cho các giao dịch lớn',
            'Ủy nhiệm chi / sao kê ngân hàng cho mọi khoản mua vào từ ' + vnd(NGUONG_KHONG_TIEN_MAT) + ' ₫',
            'Biên bản kiểm kê kho, biên bản xử lý hàng thiếu/thừa/hỏng',
            'Hợp đồng lao động, bảng lương, chứng từ khấu trừ thuế TNCN',
            'Quyết định/thông báo chương trình khuyến mãi (nếu có bán dưới giá vốn)',
            'Biên bản hủy, điều chỉnh hóa đơn kèm thỏa thuận với người mua',
            'Chứng từ nộp lệ phí môn bài của năm (hạn 30/01 hằng năm)',
        ],
        giaiTrinh: canhBao.map(c => soanGiaiTrinh(c, nhan)).filter((g): g is GiaiTrinh => g !== null),
        khoanBiLoai: (() => {
            const dong: KhoanBiLoai[] = []
            if (_soChiKhongHd > 0) dong.push({
                lyDo: 'Chi phí không có hóa đơn, chứng từ hợp pháp',
                canCu: 'Điều 4 TT 96/2015/TT-BTC',
                soLuong: _soChiKhongHd, chiPhiBiLoai: _chiKhongHd, vatBiLoai: 0,
            })
            if (_soTienMat > 0) dong.push({
                lyDo: `Mua vào từ ${vnd(NGUONG_KHONG_TIEN_MAT)} ₫ không có chứng từ thanh toán không dùng tiền mặt`,
                canCu: 'Điều 14 Luật Thuế GTGT 48/2024; Điều 4 TT 96/2015/TT-BTC',
                soLuong: _soTienMat, chiPhiBiLoai: _chiTienMat, vatBiLoai: _vatTienMat,
            })
            if (_soThieuTt > 0) dong.push({
                lyDo: 'Hóa đơn đầu vào thiếu thông tin bắt buộc (MST người bán, số hoặc ngày hóa đơn)',
                canCu: 'Điều 10 NĐ 123/2020; Điều 14 Luật Thuế GTGT 48/2024',
                soLuong: _soThieuTt, chiPhiBiLoai: 0, vatBiLoai: _vatThieuTt,
            })
            const tongChiPhiBiLoai = dong.reduce((s, d) => s + d.chiPhiBiLoai, 0)
            const tongVatBiLoai = dong.reduce((s, d) => s + d.vatBiLoai, 0)
            return {
                dong, tongChiPhiBiLoai, tongVatBiLoai,
                thueTndnUocTinh: Math.round(tongChiPhiBiLoai * 0.2),
                ghiChu: 'Bảng kê để lập quyết toán thuế TNDN (chỉ tiêu "các khoản chi không được trừ" trên tờ khai 03/TNDN). Doanh nghiệp CHỦ ĐỘNG loại các khoản này trước khi nộp thì chỉ phải nộp thuế; để cơ quan thuế phát hiện thì còn bị phạt khai sai 20% và tiền chậm nộp.',
            }
        })(),
    }
}
