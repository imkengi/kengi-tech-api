/**
 * MÔ PHỎNG BUỔI LÀM VIỆC VỚI ĐOÀN THANH TRA — hàm thuần, chạy được với client giả.
 *
 * Danh sách cảnh báo (taxAudit.ts) trả lời câu "dữ liệu của tôi sai chỗ nào".
 * File này trả lời câu khác, khó hơn: "họ sẽ HỎI GÌ, và tôi trả lời ra sao".
 * Mỗi câu hỏi kèm sẵn câu trả lời tính từ dữ liệu thật, chứng từ phải chìa ra,
 * và mức độ an toàn của câu trả lời đó.
 *
 * Nguyên tắc:
 *  1. Câu trả lời phải là SỐ LIỆU THẬT của cửa hàng, không phải mẫu chung chung
 *     — mẫu chung chung thì tra Google cũng có.
 *  2. Chỗ dữ liệu không kết luận được thì để mức "không đủ dữ liệu" kèm việc cần
 *     làm, KHÔNG đoán bừa thành "an toàn".
 *  3. Câu hỏi phải đúng cái đoàn hỏi thật, kèm "vì sao họ hỏi" — biết họ đang
 *     truy điều gì thì mới trả lời trúng.
 */

export type MucSanSang = 'an-toan' | 'can-chuan-bi' | 'nguy-hiem' | 'khong-du-lieu'

export interface CauHoiThanhTra {
    ma: string
    nhom: string
    cauHoi: string
    /** Đoàn đang thật sự truy điều gì đằng sau câu hỏi này */
    vaSao: string
    /** Câu trả lời dựng từ số liệu thật của kỳ */
    traLoi: string
    muc: MucSanSang
    /** Chứng từ phải chìa ra ngay khi trả lời */
    chungTu: string[]
    /** Việc cần làm trước khi đoàn tới, nếu câu trả lời chưa an toàn */
    canLam?: string
    soLieu?: Record<string, number | string | null>
}

export interface NccCanTraCuu {
    ten: string
    mst: string | null
    giaTri: number
    soChungTu: number
    lyDo: string
}

export interface BuoiThanhTraMoPhong {
    ky: string
    cauHoi: CauHoiThanhTra[]
    /** % câu trả lời được xếp an toàn — không phải điểm rủi ro thuế */
    diemTraLoi: number
    soNguyHiem: number
    soCanChuanBi: number
    soKhongDuLieu: number
    nhaCungCapCanTraCuu: NccCanTraCuu[]
    luuY: string
}

const vnd = (v: number) => Math.round(v || 0).toLocaleString('vi-VN')
const r0 = (v: number) => Math.round(v || 0)

/** Ngưỡng thanh toán không dùng tiền mặt — Luật Thuế GTGT 48/2024, NĐ 181/2025 */
const NGUONG_KHONG_TIEN_MAT = 5_000_000

function du(
    entries: Array<{ debitAccount: string; creditAccount: string; amount: number }>,
    tienTo: string,
) {
    let no = 0, co = 0
    for (const e of entries) {
        if (String(e.debitAccount || '').startsWith(tienTo)) no += e.amount
        if (String(e.creditAccount || '').startsWith(tienTo)) co += e.amount
    }
    return { no, co, du: no - co }
}

export async function moPhongThanhTra(
    prisma: any,
    ky: { from: string; to: string; start: Date; end: Date; maKy: string; nhan: string },
): Promise<BuoiThanhTraMoPhong> {
    const { from, to, start, end, maKy, nhan } = ky
    const ch: CauHoiThanhTra[] = []
    const them = (c: CauHoiThanhTra) => ch.push(c)

    /* Nạp một lần dùng chung — mô phỏng này chạy cùng lúc với bộ soát cảnh báo,
     * bắn thêm hai chục truy vấn nữa là cạn pool của cửa hàng. */
    const an = async <T,>(fn: () => Promise<T>, mac: T): Promise<T> => {
        try { return await fn() } catch { return mac }
    }

    const butToan: any[] = await an(() => prisma.journalEntry.findMany({
        where: { date: { gte: from, lte: to } },
        select: { debitAccount: true, creditAccount: true, amount: true, date: true, reference: true },
    }), [])
    const butToanTruoc: any[] = await an(() => prisma.journalEntry.findMany({
        where: { date: { lt: from } },
        select: { debitAccount: true, creditAccount: true, amount: true },
    }), [])
    const hoaDon: any[] = await an(() => prisma.eInvoice.findMany({
        where: { invoiceDate: { gte: from, lte: to } },
        select: {
            invoiceNumber: true, invoiceSymbol: true, invoiceDate: true, status: true,
            invoiceType: true, transactionId: true, totalBeforeVat: true, totalAmount: true,
        },
    }), [])
    const giaoDich: any[] = await an(() => prisma.transaction.findMany({
        where: { status: { in: ['completed', 'partial'] }, createdAt: { gte: start, lte: end } },
        select: { id: true, receiptNumber: true, total: true, channel: true, createdAt: true },
    }), [])
    const phieuChi: any[] = await an(() => prisma.expense.findMany({
        where: { date: { gte: start, lte: end } },
        select: {
            description: true, amount: true, vatAmount: true, invoiceNo: true, category: true,
            supplierName: true, supplierTaxCode: true, paidBy: true, bankAccountId: true, status: true,
        },
    }), [])
    const phieuNhap: any[] = await an(() => prisma.importReceipt.findMany({
        where: { status: 'completed', createdAt: { gte: start, lte: end } },
        select: {
            code: true, totalCost: true, vatAmount: true, hasVatInvoice: true,
            vatInvoiceNo: true, supplierName: true, paidAmount: true,
        },
    }), [])
    /* Phải phân biệt "chưa lập tờ khai" với "không đọc được bảng tờ khai".
     * Gộp hai thứ này lại thì mỗi lần truy vấn hỏng, phần dưới trả lời "CHƯA có
     * tờ khai kỳ này" ở mức nguy hiểm — buộc tội trong khi thực tế chỉ là ta
     * không đọc được. Đây đúng là lỗi đã mắc ở phép soát tờ khai quá hạn. */
    let khongDocDuocToKhai = false
    const toKhai: any = await prisma.taxDeclaration.findFirst({
        where: { period: maKy },
        select: { ct29: true, ct30: true, ct33: true, ct40a: true, status: true, filedAt: true },
    }).catch(() => { khongDocDuocToKhai = true; return null })
    const cauHinh: any = await an(() => prisma.storeSettings.findFirst({
        select: { businessType: true, taxCode: true },
    }), null)

    const laHkd = cauHinh?.businessType === 'household'

    // ══ NHÓM 1 — DOANH THU ═══════════════════════════════════════════════════
    const NHOM_DT = 'Doanh thu'
    const ps511 = du(butToan, '511'), ps521 = du(butToan, '521')
    const dtSo = r0(ps511.co - ps511.no - (ps521.no - ps521.co))
    const dtToKhai = toKhai ? r0(toKhai.ct29) : null
    const dtHoaDon = r0(hoaDon
        .filter(h => ['SIGNED', 'SENT'].includes(String(h.status)) && h.invoiceType !== 'RETURN')
        .reduce((s, h) => s + (h.totalBeforeVat || 0), 0))

    them({
        ma: 'dt-khop',
        nhom: NHOM_DT,
        cauHoi: 'Doanh thu trên sổ kế toán, trên tờ khai và trên hóa đơn điện tử có khớp nhau không?',
        vaSao: 'Đây luôn là câu đầu tiên. Ba nguồn lệch nhau là đoàn có cớ ấn định doanh thu theo Điều 50 Luật Quản lý thuế.',
        traLoi: dtToKhai === null
            ? `Sổ ghi ${vnd(dtSo)}đ, hóa đơn điện tử ${vnd(dtHoaDon)}đ. CHƯA có tờ khai kỳ ${maKy} trong hệ thống để đối chiếu.`
            : `Sổ ${vnd(dtSo)}đ · tờ khai [29] ${vnd(dtToKhai)}đ · hóa đơn ${vnd(dtHoaDon)}đ.` +
            (Math.abs(dtSo - dtToKhai) < 1000 && Math.abs(dtSo - dtHoaDon) < 1000
                ? ' Ba nguồn khớp nhau.'
                : ` Lệch so với tờ khai ${vnd(Math.abs(dtSo - dtToKhai))}đ, lệch so với hóa đơn ${vnd(Math.abs(dtSo - dtHoaDon))}đ.`),
        muc: dtToKhai === null ? 'khong-du-lieu'
            : (Math.abs(dtSo - dtToKhai) < 1000 && Math.abs(dtSo - dtHoaDon) < 1000) ? 'an-toan' : 'nguy-hiem',
        chungTu: ['Sổ cái TK 511', 'Tờ khai 01/GTGT kỳ ' + maKy, 'Bảng kê hóa đơn bán ra'],
        canLam: dtToKhai === null ? `Lập tờ khai kỳ ${maKy} rồi soát lại.`
            : (Math.abs(dtSo - dtToKhai) >= 1000 || Math.abs(dtSo - dtHoaDon) >= 1000)
                ? 'Tìm nguyên nhân lệch từng khoản và chuẩn bị bản giải trình có số liệu đối chiếu, trước khi đoàn tự kết luận.'
                : undefined,
        soLieu: { so: dtSo, toKhai: dtToKhai, hoaDon: dtHoaDon },
    })

    const idHoaDon = new Set(hoaDon.map(h => h.transactionId).filter(Boolean))
    const khongHd = giaoDich.filter(g => !idHoaDon.has(g.id))
    const tienKhongHd = r0(khongHd.reduce((s, g) => s + (g.total || 0), 0))
    them({
        ma: 'dt-ban-khong-hoa-don',
        nhom: NHOM_DT,
        cauHoi: 'Bán cho khách lẻ không lấy hóa đơn thì cửa hàng xử lý thế nào?',
        vaSao: 'Điều 90 Luật Quản lý thuế buộc lập hóa đơn kể cả khi khách không lấy. Đây là chỗ hộ/doanh nghiệp bán lẻ hay bị bắt nhất.',
        traLoi: khongHd.length === 0
            ? 'Mọi phiếu bán trong kỳ đều đã có hóa đơn điện tử đi kèm.'
            : `${khongHd.length} phiếu bán chưa có hóa đơn điện tử, tổng ${vnd(tienKhongHd)}đ` +
            (dtSo > 0 ? ` (≈${Math.round(tienKhongHd / dtSo * 100)}% doanh thu sổ).` : '.'),
        muc: khongHd.length === 0 ? 'an-toan'
            : tienKhongHd > dtSo * 0.1 ? 'nguy-hiem' : 'can-chuan-bi',
        chungTu: ['Bảng kê hóa đơn bán ra', 'Danh sách phiếu bán trong kỳ'],
        canLam: khongHd.length > 0
            ? 'Xuất hóa đơn bù cho các phiếu còn thiếu, hoặc lập hóa đơn tổng hợp cuối ngày cho khách lẻ theo NĐ 123/2020.'
            : undefined,
        soLieu: { soPhieu: khongHd.length, tien: tienKhongHd },
    })

    const donSan = giaoDich.filter(g => g.channel && g.channel !== 'direct')
    const tienSan = r0(donSan.reduce((s, g) => s + (g.total || 0), 0))
    them({
        ma: 'dt-san-tmdt',
        nhom: NHOM_DT,
        cauHoi: 'Doanh thu bán qua sàn thương mại điện tử kê khai ở đâu?',
        vaSao: 'Từ 2025 sàn khấu trừ nộp thay và dữ liệu doanh thu sàn được chuyển thẳng cho cơ quan thuế — họ đã có số trước khi hỏi bạn.',
        traLoi: donSan.length === 0
            ? 'Kỳ này không ghi nhận đơn nào ngoài kênh bán trực tiếp tại cửa hàng.'
            : `${donSan.length} đơn ngoài kênh trực tiếp, tổng ${vnd(tienSan)}đ. Phải nằm trong doanh thu kê khai và có hóa đơn tương ứng.`,
        muc: donSan.length === 0 ? 'an-toan' : 'can-chuan-bi',
        chungTu: donSan.length ? ['Đối soát của sàn (Shopee/TikTok/Lazada)', 'Sao kê tài khoản nhận tiền sàn'] : [],
        canLam: donSan.length > 0
            ? 'Tải bảng đối soát từng sàn, đối chiếu với doanh thu ghi sổ — số của sàn là số cơ quan thuế đang cầm.'
            : undefined,
        soLieu: { soDon: donSan.length, tien: tienSan },
    })

    // ══ NHÓM 2 — HÓA ĐƠN ═════════════════════════════════════════════════════
    const NHOM_HD = 'Hóa đơn'
    const theoKy = new Map<string, number[]>()
    for (const h of hoaDon) {
        if (!h.invoiceNumber) continue
        const k = h.invoiceSymbol || '(không ký hiệu)'
        if (!theoKy.has(k)) theoKy.set(k, [])
        theoKy.get(k)!.push(Number(h.invoiceNumber))
    }
    let soNhay = 0
    const viDuNhay: string[] = []
    for (const [k, ds] of theoKy) {
        const sap = [...new Set(ds)].sort((a, b) => a - b)
        for (let i = 1; i < sap.length; i++) {
            const thieu = sap[i] - sap[i - 1] - 1
            if (thieu > 0) {
                soNhay += thieu
                if (viDuNhay.length < 3) viDuNhay.push(`${k}: thiếu ${thieu} số giữa ${sap[i - 1]} và ${sap[i]}`)
            }
        }
    }
    const daHuy = hoaDon.filter(h => h.status === 'CANCELLED')
    them({
        ma: 'hd-dai-so',
        nhom: NHOM_HD,
        cauHoi: 'Dải số hóa đơn trong kỳ có liên tục không? Những số bị hủy vì lý do gì?',
        vaSao: 'Số hóa đơn biến mất mà không có biên bản hủy là dấu hiệu xuất hóa đơn ngoài sổ — lỗi nặng nhất trong nhóm hóa đơn.',
        traLoi: soNhay === 0
            ? `Dải số liên tục, có ${daHuy.length} hóa đơn hủy đã ghi nhận trạng thái.`
            : `Có ${soNhay} số hóa đơn không xuất hiện trong hệ thống. ${viDuNhay.join('; ')}.`,
        muc: soNhay === 0 ? 'an-toan' : 'nguy-hiem',
        chungTu: ['Bảng kê hóa đơn bán ra (kèm cả hóa đơn hủy)', 'Biên bản hủy/thay thế hóa đơn'],
        canLam: soNhay > 0
            ? 'Tra cứu các số còn thiếu trên cổng hoadondientu.gdt.gov.vn; nếu đã hủy thì lấy biên bản hủy kẹp vào hồ sơ.'
            : daHuy.length > 0 ? 'Chuẩn bị sẵn biên bản hủy cho từng hóa đơn đã hủy.' : undefined,
        soLieu: { soNhay, soHuy: daHuy.length, tongHoaDon: hoaDon.length },
    })

    const gdTheoId = new Map(giaoDich.map(g => [g.id, g]))
    let lechNgay = 0
    for (const h of hoaDon) {
        if (!h.transactionId || !h.invoiceDate) continue
        const g = gdTheoId.get(h.transactionId)
        if (!g) continue
        const ngayBan = new Date(g.createdAt).toISOString().slice(0, 10)
        if (ngayBan !== h.invoiceDate) lechNgay++
    }
    them({
        ma: 'hd-thoi-diem',
        nhom: NHOM_HD,
        cauHoi: 'Hóa đơn được lập tại thời điểm nào so với lúc giao hàng?',
        vaSao: 'Điều 9 NĐ 123/2020 buộc lập hóa đơn tại thời điểm chuyển giao hàng. Lập dồn cuối tháng là lỗi bị phạt hành chính và làm sai kỳ kê khai.',
        traLoi: lechNgay === 0
            ? 'Mọi hóa đơn có gắn phiếu bán đều lập đúng ngày bán hàng.'
            : `${lechNgay} hóa đơn có ngày lập khác ngày bán hàng trên phiếu.`,
        muc: lechNgay === 0 ? 'an-toan' : lechNgay > hoaDon.length * 0.2 ? 'nguy-hiem' : 'can-chuan-bi',
        chungTu: ['Phiếu bán hàng', 'Hóa đơn điện tử tương ứng', 'Biên bản giao nhận (nếu giao sau)'],
        canLam: lechNgay > 0
            ? 'Rà từng trường hợp: giao hàng nhiều đợt thì phải có biên bản giao nhận chứng minh thời điểm, còn lại phải chỉnh quy trình xuất hóa đơn ngay khi bán.'
            : undefined,
        soLieu: { lechNgay },
    })

    const nhapTrung = new Map<string, number>()
    for (const c of phieuChi) {
        if (!c.invoiceNo || c.status === 'cancelled') continue
        const k = `${c.supplierTaxCode || c.supplierName || ''}|${c.invoiceNo}`
        nhapTrung.set(k, (nhapTrung.get(k) || 0) + 1)
    }
    const soTrung = [...nhapTrung.values()].filter(v => v > 1).length
    them({
        ma: 'hd-vao-trung',
        nhom: NHOM_HD,
        cauHoi: 'Có hóa đơn đầu vào nào bị kê khai khấu trừ hai lần không?',
        vaSao: 'Khấu trừ trùng là lỗi máy tính của cơ quan thuế tự phát hiện khi đối chiếu dữ liệu hóa đơn toàn quốc — không cần đoàn tìm tay.',
        traLoi: soTrung === 0
            ? 'Không có số hóa đơn đầu vào nào trùng của cùng một nhà cung cấp trong kỳ.'
            : `${soTrung} số hóa đơn đầu vào bị nhập trùng (cùng nhà cung cấp, cùng số hóa đơn).`,
        muc: soTrung === 0 ? 'an-toan' : 'nguy-hiem',
        chungTu: ['Bảng kê hóa đơn mua vào'],
        canLam: soTrung > 0 ? 'Xóa bản nhập trùng và điều chỉnh lại thuế đầu vào đã khấu trừ của kỳ.' : undefined,
        soLieu: { soTrung },
    })

    // ══ NHÓM 3 — CHI PHÍ ═════════════════════════════════════════════════════
    const NHOM_CP = 'Chi phí'
    const chiHoatDong = phieuChi.filter(c => c.status !== 'cancelled')
    const chiKhongHd = chiHoatDong.filter(c => !c.invoiceNo)
    const tienChiKhongHd = r0(chiKhongHd.reduce((s, c) => s + (c.amount || 0), 0))
    const nhapKhongHd = phieuNhap.filter(n => !n.hasVatInvoice)
    const tienNhapKhongHd = r0(nhapKhongHd.reduce((s, n) => s + (n.totalCost || 0), 0))
    const tongKhongHd = tienChiKhongHd + tienNhapKhongHd
    them({
        ma: 'cp-khong-hoa-don',
        nhom: NHOM_CP,
        cauHoi: 'Những khoản chi nào không có hóa đơn? Vì sao vẫn hạch toán vào chi phí?',
        vaSao: 'Điều 4 TT 96/2015 loại thẳng khoản chi không có hóa đơn khỏi chi phí được trừ — mỗi đồng bị loại là 20% thuế TNDN truy thu.',
        traLoi: tongKhongHd === 0
            ? 'Mọi khoản chi và phiếu nhập trong kỳ đều có hóa đơn.'
            : `${chiKhongHd.length} khoản chi (${vnd(tienChiKhongHd)}đ) và ${nhapKhongHd.length} phiếu nhập (${vnd(tienNhapKhongHd)}đ) không có hóa đơn. Tổng ${vnd(tongKhongHd)}đ, thuế TNDN có nguy cơ ${vnd(tongKhongHd * 0.2)}đ.`,
        muc: tongKhongHd === 0 ? 'an-toan' : 'nguy-hiem',
        chungTu: ['Bảng kê hóa đơn mua vào', 'Hợp đồng, bảng kê 01/TNDN (nếu mua của cá nhân không kinh doanh)'],
        canLam: tongKhongHd > 0
            ? 'Xin bổ sung hóa đơn; khoản mua của cá nhân không kinh doanh phải lập Bảng kê 01/TNDN kèm hợp đồng và chứng từ thanh toán mới được tính chi phí.'
            : undefined,
        soLieu: { soKhoan: chiKhongHd.length + nhapKhongHd.length, tien: tongKhongHd },
    })

    const chiTienMatLon = chiHoatDong.filter(c =>
        (c.amount || 0) >= NGUONG_KHONG_TIEN_MAT && c.invoiceNo && !c.bankAccountId &&
        (!c.paidBy || /tiền mặt|cash|tm/i.test(String(c.paidBy))))
    const tienMatLon = r0(chiTienMatLon.reduce((s, c) => s + (c.amount || 0), 0))
    them({
        ma: 'cp-tien-mat-5tr',
        nhom: NHOM_CP,
        cauHoi: 'Khoản mua từ 5 triệu trở lên thanh toán bằng hình thức nào?',
        vaSao: 'Từ 01/7/2025 ngưỡng bắt buộc chuyển khoản hạ từ 20 triệu xuống 5 triệu (Luật Thuế GTGT 48/2024, NĐ 181/2025). Rất nhiều nơi vẫn làm theo mức cũ và bị loại hàng loạt.',
        traLoi: chiTienMatLon.length === 0
            ? 'Không có khoản chi từ 5 triệu nào trả bằng tiền mặt trong kỳ.'
            : `${chiTienMatLon.length} khoản chi từ 5 triệu trả tiền mặt, tổng ${vnd(tienMatLon)}đ — không được khấu trừ GTGT và không được tính chi phí.`,
        muc: chiTienMatLon.length === 0 ? 'an-toan' : 'nguy-hiem',
        chungTu: ['Ủy nhiệm chi / sao kê ngân hàng cho từng khoản từ 5 triệu'],
        canLam: chiTienMatLon.length > 0
            ? 'Từ nay chuyển khoản mọi khoản từ 5 triệu; khoản đã lỡ trả tiền mặt phải tự loại khỏi chi phí khi quyết toán thay vì chờ đoàn loại.'
            : undefined,
        soLieu: { soKhoan: chiTienMatLon.length, tien: tienMatLon, nguong: NGUONG_KHONG_TIEN_MAT },
    })

    const chiThueNha = chiHoatDong.filter(c => c.category === 'rent')
    const tienThueNha = r0(chiThueNha.reduce((s, c) => s + (c.amount || 0), 0))
    them({
        ma: 'cp-thue-nha',
        nhom: NHOM_CP,
        cauHoi: 'Thuê mặt bằng của cá nhân thì ai nộp thuế thay chủ nhà?',
        vaSao: 'Thuê nhà của cá nhân có doanh thu trên 100 triệu/năm phải nộp thay 5% GTGT + 5% TNCN; không có chứng từ nộp thay thì tiền thuê bị loại khỏi chi phí.',
        traLoi: chiThueNha.length === 0
            ? 'Kỳ này không ghi nhận khoản chi thuê mặt bằng.'
            : `${chiThueNha.length} khoản thuê mặt bằng, tổng ${vnd(tienThueNha)}đ. Phần mềm không biết chủ nhà là cá nhân hay tổ chức — phải tự đối chiếu hợp đồng.`,
        muc: chiThueNha.length === 0 ? 'an-toan' : 'khong-du-lieu',
        chungTu: chiThueNha.length ? ['Hợp đồng thuê mặt bằng', 'Chứng từ nộp thuế thay chủ nhà (nếu thuê của cá nhân)', 'Chứng từ thanh toán tiền thuê'] : [],
        canLam: chiThueNha.length > 0
            ? 'Kiểm tra hợp đồng: nếu chủ nhà là cá nhân và tiền thuê trên 100 triệu/năm thì phải có chứng từ nộp thuế thay, hoặc hợp đồng ghi rõ chủ nhà tự nộp.'
            : undefined,
        soLieu: { soKhoan: chiThueNha.length, tien: tienThueNha },
    })

    // ══ NHÓM 4 — KHO ═════════════════════════════════════════════════════════
    const NHOM_KHO = 'Hàng tồn kho'
    const ps156 = du([...butToanTruoc, ...butToan], '156')
    const amKho: any[] = await an(() => prisma.product.findMany({
        where: { stock: { lt: 0 } },
        select: { name: true, sku: true, stock: true },
    }), [])
    them({
        ma: 'kho-am',
        nhom: NHOM_KHO,
        cauHoi: 'Có mặt hàng nào tồn kho âm không? Bán hàng chưa nhập kho lấy đâu ra?',
        vaSao: 'Tồn âm là bằng chứng trực tiếp của mua hàng không hóa đơn — đoàn sẽ ấn định giá vốn và truy thu phần chênh.',
        traLoi: amKho.length === 0
            ? 'Không có mặt hàng nào tồn kho âm.'
            : `${amKho.length} mặt hàng đang âm kho, ví dụ: ${amKho.slice(0, 3).map((p: any) => `${p.sku || p.name} (${p.stock})`).join(', ')}.`,
        muc: amKho.length === 0 ? 'an-toan' : 'nguy-hiem',
        chungTu: ['Bảng nhập - xuất - tồn', 'Phiếu nhập kho của các mặt hàng âm'],
        canLam: amKho.length > 0
            ? 'Tìm phiếu nhập bị bỏ sót và nhập bổ sung kèm hóa đơn; không có hóa đơn thì phải chuẩn bị giải trình nguồn hàng.'
            : undefined,
        soLieu: { soMatHang: amKho.length },
    })

    them({
        ma: 'kho-doi-chieu',
        nhom: NHOM_KHO,
        cauHoi: 'Giá trị tồn kho trên sổ và kiểm kê thực tế chênh nhau bao nhiêu?',
        vaSao: 'Chênh lệch không giải thích được sẽ bị coi là hàng bán không xuất hóa đơn (thiếu) hoặc hàng mua không hóa đơn (thừa).',
        traLoi: `Dư Nợ TK 156 cuối kỳ ${vnd(ps156.du)}đ. Phần mềm KHÔNG có số kiểm kê thực tế của kỳ này để đối chiếu.`,
        muc: 'khong-du-lieu',
        chungTu: ['Biên bản kiểm kê kho có chữ ký', 'Sổ cái TK 156', 'Bảng nhập - xuất - tồn'],
        canLam: 'Lập biên bản kiểm kê cuối kỳ có chữ ký người kiểm kê — đây là chứng từ đoàn luôn đòi và hầu hết cửa hàng không có.',
        soLieu: { duNo156: ps156.du },
    })

    // ══ NHÓM 5 — TIỀN ════════════════════════════════════════════════════════
    const NHOM_TIEN = 'Tiền mặt & ngân hàng'
    const ps111 = du([...butToanTruoc, ...butToan], '111')
    // Quỹ theo ngày — tìm ngày âm
    const ngayThu = new Map<string, number>()
    let luy = du(butToanTruoc, '111').du
    for (const b of [...butToan].sort((a, b) => String(a.date).localeCompare(String(b.date)))) {
        const d = String(b.date)
        if (String(b.debitAccount || '').startsWith('111')) luy += b.amount
        if (String(b.creditAccount || '').startsWith('111')) luy -= b.amount
        ngayThu.set(d, luy)
    }
    const ngayAm = [...ngayThu.entries()].filter(([, v]) => v < -1000)
    them({
        ma: 'tien-quy-am',
        nhom: NHOM_TIEN,
        cauHoi: 'Tồn quỹ tiền mặt cuối kỳ là bao nhiêu? Có ngày nào quỹ âm không?',
        vaSao: 'Quỹ âm nghĩa là chi nhiều hơn tiền đang có — hoặc bỏ sót doanh thu, hoặc chứng từ chi là khống. Đoàn luôn dựng lại sổ quỹ theo ngày.',
        traLoi: ngayAm.length === 0
            ? `Tồn quỹ cuối kỳ ${vnd(ps111.du)}đ, không có ngày nào âm.`
            : `Tồn quỹ cuối kỳ ${vnd(ps111.du)}đ nhưng có ${ngayAm.length} ngày quỹ ÂM, thấp nhất ${vnd(Math.min(...ngayAm.map(([, v]) => v)))}đ ngày ${ngayAm[0][0]}.`,
        muc: ngayAm.length === 0 ? (ps111.du < 0 ? 'nguy-hiem' : 'an-toan') : 'nguy-hiem',
        chungTu: ['Sổ quỹ tiền mặt', 'Biên bản kiểm kê quỹ cuối kỳ'],
        canLam: ngayAm.length > 0
            ? 'Rà lại ngày âm: thường do quên ghi nhận tiền thu hoặc ghi chi trước ngày thực chi. Nếu chủ hộ bỏ tiền túi vào thì phải hạch toán khoản vay/góp vốn có chứng từ.'
            : undefined,
        soLieu: { tonCuoi: ps111.du, soNgayAm: ngayAm.length },
    })

    const ps341 = du([...butToanTruoc, ...butToan], '341')
    const ps3388 = du([...butToanTruoc, ...butToan], '3388')
    const vayCaNhan = -ps341.du + -ps3388.du
    them({
        ma: 'tien-vay-chu-ho',
        nhom: NHOM_TIEN,
        cauHoi: 'Tiền chủ cửa hàng bỏ vào hoặc rút ra hạch toán ở đâu?',
        vaSao: 'Tiền vào/ra không chứng từ là chỗ đoàn nghi doanh thu ngoài sổ. Khoản vay cá nhân còn bị soi lãi vay có vượt trần được trừ không.',
        traLoi: vayCaNhan > 0
            ? `Đang treo ${vnd(vayCaNhan)}đ ở nhóm vay/phải trả khác (TK 341, 3388).`
            : 'Không có số dư vay hoặc phải trả khác trong sổ.',
        muc: vayCaNhan > 0 ? 'can-chuan-bi' : 'an-toan',
        chungTu: vayCaNhan > 0 ? ['Hợp đồng vay/giấy nhận nợ', 'Chứng từ chuyển tiền', 'Sổ cái TK 341, 3388'] : [],
        canLam: vayCaNhan > 0
            ? 'Chuẩn bị hợp đồng vay có ngày tháng và chứng từ chuyển tiền; khoản vay cá nhân trả lãi vượt 150% lãi suất cơ bản sẽ bị loại phần vượt.'
            : undefined,
        soLieu: { duVay: vayCaNhan },
    })

    // ══ NHÓM 6 — LAO ĐỘNG ════════════════════════════════════════════════════
    const NHOM_LD = 'Lao động & tiền lương'
    const kyLuong: any[] = await an(() => prisma.payrollPeriod.findMany({
        select: { id: true, month: true, year: true },
    }), [])
    const y1 = Number(from.slice(0, 4)) * 12 + Number(from.slice(5, 7))
    const y2 = Number(to.slice(0, 4)) * 12 + Number(to.slice(5, 7))
    const kyTrong = kyLuong.filter(k => {
        const v = k.year * 12 + k.month
        return v >= y1 && v <= y2
    })
    const dongLuong: any[] = kyTrong.length
        ? await an(() => prisma.payrollEntry.findMany({
            where: { periodId: { in: kyTrong.map(k => k.id) } },
            select: { employeeName: true, grossSalary: true, pitAmount: true, totalInsuranceEmployee: true },
        }), [])
        : []
    const tongLuong = r0(dongLuong.reduce((s, e) => s + (e.grossSalary || 0), 0))
    const tongTncn = r0(dongLuong.reduce((s, e) => s + (e.pitAmount || 0), 0))
    const coBh = dongLuong.filter(e => (e.totalInsuranceEmployee || 0) > 0).length

    them({
        ma: 'ld-bang-luong',
        nhom: NHOM_LD,
        cauHoi: 'Cửa hàng có bao nhiêu lao động? Chi phí lương trong kỳ là bao nhiêu?',
        vaSao: 'Chi phí lương chỉ được trừ khi có đủ hợp đồng lao động, bảng chấm công, bảng lương và chứng từ chi. Thiếu một thứ là loại cả khoản.',
        traLoi: dongLuong.length === 0
            ? 'Kỳ này KHÔNG có bảng lương nào trong hệ thống.'
            : `${dongLuong.length} lượt trả lương, tổng thu nhập ${vnd(tongLuong)}đ, trong đó ${coBh} lượt có trừ bảo hiểm.`,
        muc: dongLuong.length === 0 ? 'khong-du-lieu' : coBh === 0 ? 'can-chuan-bi' : 'an-toan',
        chungTu: ['Bảng thanh toán tiền lương', 'Hợp đồng lao động', 'Bảng chấm công', 'Chứng từ chi lương'],
        canLam: dongLuong.length === 0
            ? 'Nếu thực tế có trả lương mà chưa lập bảng lương thì toàn bộ chi phí lương sẽ bị loại — lập bổ sung ngay.'
            : coBh === 0 ? 'Không lượt nào trừ bảo hiểm: nếu có hợp đồng từ 1 tháng trở lên thì thuộc diện đóng BHXH bắt buộc, cần rà lại.'
                : undefined,
        soLieu: { soLuot: dongLuong.length, tongLuong, coBaoHiem: coBh },
    })

    them({
        ma: 'ld-tncn',
        nhom: NHOM_LD,
        cauHoi: 'Thuế TNCN khấu trừ của người lao động trong kỳ là bao nhiêu, đã nộp chưa?',
        vaSao: 'Khấu trừ mà không nộp là chiếm dụng tiền thuế; không khấu trừ khi phải khấu trừ thì cửa hàng phải nộp thay.',
        traLoi: dongLuong.length === 0
            ? 'Không có dữ liệu lương để tính TNCN khấu trừ.'
            : tongTncn > 0
                ? `Đã khấu trừ ${vnd(tongTncn)}đ TNCN trong kỳ.`
                : `Không khấu trừ đồng TNCN nào (tổng thu nhập ${vnd(tongLuong)}đ) — hợp lý nếu mọi người đều dưới ngưỡng chịu thuế sau giảm trừ.`,
        muc: dongLuong.length === 0 ? 'khong-du-lieu' : 'an-toan',
        chungTu: ['Bảng lương chi tiết', 'Tờ khai khấu trừ TNCN', 'Chứng từ nộp thuế TNCN', 'Đăng ký người phụ thuộc'],
        canLam: dongLuong.length > 0 && tongTncn === 0 && tongLuong > 11_000_000 * dongLuong.length
            ? 'Thu nhập bình quân cao mà không khấu trừ đồng nào — kiểm tra lại phần giảm trừ gia cảnh và hồ sơ người phụ thuộc.'
            : undefined,
        soLieu: { tncn: tongTncn },
    })

    // ══ NHÓM 7 — NGHĨA VỤ THUẾ ═══════════════════════════════════════════════
    const NHOM_NV = 'Nghĩa vụ thuế'
    const ps3331 = du([...butToanTruoc, ...butToan], '3331')
    const conPhaiNop = -ps3331.du
    them({
        ma: 'nv-con-phai-nop',
        nhom: NHOM_NV,
        cauHoi: 'Thuế GTGT còn phải nộp đến cuối kỳ là bao nhiêu?',
        vaSao: 'Số dư Có 3331 phải khớp với nghĩa vụ trên hệ thống thuế điện tử. Lệch là dấu hiệu kê khai thiếu hoặc quên hạch toán khoản đã nộp.',
        traLoi: conPhaiNop > 0
            ? `Dư Có TK 3331 ${vnd(conPhaiNop)}đ — phải khớp với số còn nợ trên thuedientu.gdt.gov.vn.`
            : conPhaiNop < 0
                ? `TK 3331 đang dư NỢ ${vnd(-conPhaiNop)}đ — nộp thừa hoặc thiếu bút toán ghi nhận thuế phải nộp.`
                : 'Không còn số dư thuế GTGT phải nộp.',
        muc: conPhaiNop < -1000 ? 'can-chuan-bi' : 'an-toan',
        chungTu: ['Sổ cái TK 3331', 'Giấy nộp tiền vào ngân sách', 'Tra cứu nghĩa vụ thuế trên thuedientu'],
        canLam: 'In bản tra cứu nghĩa vụ thuế trên thuedientu.gdt.gov.vn và đối chiếu với sổ trước khi đoàn tới.',
        soLieu: { duCo3331: conPhaiNop },
    })

    them({
        ma: 'nv-nop-dung-han',
        nhom: NHOM_NV,
        cauHoi: `Tờ khai kỳ ${maKy} nộp ngày nào? Có kỳ nào nộp muộn không?`,
        vaSao: 'Nộp muộn bị phạt hành chính riêng (NĐ 125/2020) và là tình tiết tăng nặng khi xét các lỗi khác.',
        traLoi: khongDocDuocToKhai
            ? 'Không đọc được dữ liệu tờ khai của cửa hàng nên chưa kết luận được — phải mở sổ tờ khai kiểm tra trực tiếp.'
            : !toKhai
                ? `CHƯA có tờ khai kỳ ${maKy} trong hệ thống.`
                : toKhai.filedAt
                    ? `Tờ khai kỳ ${maKy} trạng thái "${toKhai.status}", ghi nhận nộp ngày ${new Date(toKhai.filedAt).toISOString().slice(0, 10)}.`
                    : `Tờ khai kỳ ${maKy} đã lập, trạng thái "${toKhai.status}" nhưng CHƯA ghi nhận ngày nộp.`,
        muc: khongDocDuocToKhai ? 'khong-du-lieu'
            : !toKhai ? 'nguy-hiem' : toKhai.filedAt ? 'an-toan' : 'can-chuan-bi',
        chungTu: ['Thông báo tiếp nhận hồ sơ khai thuế', 'Tờ khai đã ký gửi'],
        canLam: khongDocDuocToKhai
            ? `Kiểm tra thủ công tờ khai kỳ ${maKy} trên thuedientu.gdt.gov.vn.`
            : !toKhai ? `Lập và nộp tờ khai kỳ ${maKy} ngay.`
                : !toKhai.filedAt ? 'Cập nhật ngày nộp và lưu thông báo tiếp nhận của cơ quan thuế.' : undefined,
    })

    if (laHkd) {
        them({
            ma: 'nv-hkd-2026',
            nhom: NHOM_NV,
            cauHoi: 'Hộ kinh doanh đã chuyển sang kê khai theo sổ sách chưa?',
            vaSao: 'Nghị quyết 198/2025 bỏ thuế khoán từ 01/01/2026 — hộ kinh doanh phải kê khai theo doanh thu thực và giữ sổ sách như doanh nghiệp.',
            traLoi: `Cửa hàng đang đặt loại hình "hộ kinh doanh". Doanh thu sổ kỳ này ${vnd(dtSo)}đ.`,
            muc: 'can-chuan-bi',
            chungTu: ['Sổ S1-S7 theo TT 88/2021', 'Hóa đơn điện tử từ máy tính tiền (nếu doanh thu từ 1 tỷ/năm)'],
            canLam: 'Duy trì đủ bộ sổ S1–S7 theo TT 88/2021; doanh thu từ 1 tỷ/năm phải dùng hóa đơn điện tử khởi tạo từ máy tính tiền theo NĐ 70/2025.',
        })
    }

    // ── Nhà cung cấp cần tra cứu tình trạng hoạt động ────────────────────────
    const nccMap = new Map<string, NccCanTraCuu>()
    const gopNcc = (ten: string, mst: string | null, tien: number) => {
        const k = (mst || ten || '').trim().toLowerCase()
        if (!k) return
        if (!nccMap.has(k)) nccMap.set(k, { ten: ten || '(không tên)', mst: mst || null, giaTri: 0, soChungTu: 0, lyDo: '' })
        const o = nccMap.get(k)!
        o.giaTri += tien
        o.soChungTu++
        if (!o.mst && mst) o.mst = mst
    }
    for (const n of phieuNhap) if (n.hasVatInvoice) gopNcc(n.supplierName || '', null, n.totalCost || 0)
    for (const c of chiHoatDong) if (c.invoiceNo) gopNcc(c.supplierName || '', c.supplierTaxCode || null, c.amount || 0)

    const nhaCungCapCanTraCuu = [...nccMap.values()]
        .sort((a, b) => b.giaTri - a.giaTri)
        .slice(0, 10)
        .map(o => ({
            ...o,
            giaTri: r0(o.giaTri),
            /* Không thể biết NCC có bỏ trốn hay không từ dữ liệu nội bộ — chỉ nêu lý
             * do vì sao NCC này đáng tra cứu, việc kết luận là của cổng thuế. */
            lyDo: !o.mst
                ? 'Chưa lưu MST người bán — không tra cứu được, hóa đơn dễ bị bác'
                : o.soChungTu === 1 && o.giaTri >= 20_000_000
                    ? 'Giá trị lớn nhưng chỉ giao dịch một lần trong kỳ'
                    : 'Giá trị mua vào lớn nhất kỳ',
        }))

    const soNguyHiem = ch.filter(c => c.muc === 'nguy-hiem').length
    const soCanChuanBi = ch.filter(c => c.muc === 'can-chuan-bi').length
    const soKhongDuLieu = ch.filter(c => c.muc === 'khong-du-lieu').length
    const soAnToan = ch.filter(c => c.muc === 'an-toan').length

    return {
        ky: nhan,
        cauHoi: ch,
        diemTraLoi: ch.length ? Math.round(soAnToan / ch.length * 100) : 0,
        soNguyHiem, soCanChuanBi, soKhongDuLieu,
        nhaCungCapCanTraCuu,
        luuY: 'Câu trả lời ở đây dựng từ dữ liệu trong phần mềm. Trước khi làm việc thật, kế toán phải đối chiếu lại với chứng từ gốc — đoàn thanh tra làm việc trên chứng từ giấy, không trên màn hình.',
    }
}
