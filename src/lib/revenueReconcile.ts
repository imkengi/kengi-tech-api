/**
 * ĐỐI CHIẾU BA CHIỀU: SỔ SÁCH ↔ HOÁ ĐƠN ↔ DÒNG TIỀN
 *
 * Đây là việc đầu tiên một đoàn thanh tra thuế làm, và cũng là chỗ cửa hàng
 * chết oan nhiều nhất: ba nguồn số cùng nói về một kỳ kinh doanh nhưng không
 * ai đối chiếu chúng với nhau cho đến ngày có quyết định thanh tra.
 *
 *   Chiều 1 — SỔ SÁCH:  doanh thu đã ghi nhận (đơn tại quầy + đơn sàn đã giao)
 *   Chiều 2 — HOÁ ĐƠN:  hoá đơn điện tử đã phát hành (trừ huỷ, trừ trả/điều chỉnh)
 *   Chiều 3 — DÒNG TIỀN: tiền thực vào tài khoản ngân hàng
 *
 * Ba con số này KHÔNG bắt buộc bằng nhau — và đó chính là lý do phải tính cẩn
 * thận thay vì trừ thô rồi la làng:
 *   - Sổ > Hoá đơn: bán lẻ chưa lập hoá đơn. Từ 01/7/2022 (NĐ 123/2020) người
 *     bán phải lập hoá đơn cho MỌI lần bán, không phân biệt giá trị.
 *   - Hoá đơn > Sổ: nguy hiểm hơn nhiều — hoặc bán mà không ghi sổ, hoặc xuất
 *     hoá đơn khống. Cả hai đều là căn cứ ấn định thuế.
 *   - Tiền vào ngân hàng > phần doanh thu thu không dùng tiền mặt: cơ quan thuế
 *     đang đối chiếu sao kê ngân hàng; phần chênh phải giải trình được là vay
 *     mượn / chuyển nội bộ / hoàn tiền, nếu không sẽ bị coi là doanh thu giấu.
 *
 * NGUYÊN TẮC XUYÊN SUỐT: thiếu dữ liệu KHÁC VỚI làm sai. Cửa hàng chưa nhập sao
 * kê ngân hàng thì chiều 3 trả `duocKetLuan: false` kèm lý do — tuyệt đối không
 * quy ra "giấu doanh thu". Một lời buộc tội oan làm người dùng mất niềm tin vào
 * toàn bộ phần thuế, và họ sẽ tắt luôn cảnh báo thật ở lần sau.
 */

/** Kỳ đối chiếu. `from`/`to` là YYYY-MM-DD (bao gồm cả ngày `to`). */
export interface KyDoiChieu {
    from: string
    to: string
    start: Date
    /** Mốc chặn trên, KHÔNG bao gồm — thường là 00:00 của ngày kế tiếp `to`. */
    end: Date
    nhan: string
}

/**
 * Ngưỡng thanh toán không dùng tiền mặt để được khấu trừ GTGT đầu vào.
 * Luật Thuế GTGT 48/2024 (hiệu lực 01/7/2025) hạ ngưỡng cũ 20 triệu xuống còn
 * 5 triệu — rất nhiều cửa hàng chưa biết và vẫn trả tiền mặt như trước.
 */
export const NGUONG_TIEN_MAT = 5_000_000

/** Thuế suất GTGT dùng khi ước tính truy thu mà không biết thuế suất thật. */
export const THUE_SUAT_MAC_DINH = 0.08

export type MucRuiRo = 'cao' | 'vua' | 'thap'

export interface RuiRoDoiChieu {
    ma: string
    muc: MucRuiRo
    tieuDe: string
    /** Vì sao đây là rủi ro — nói bằng lời của người bán hàng, không bằng thuật ngữ. */
    vaSao: string
    canCu: string
    canLam: string
    /** Số tiền liên quan (chênh lệch), null nếu rủi ro không quy ra tiền được. */
    soTien: number | null
    /** Ước tính truy thu — chỉ điền khi tính được từ số thật, không bịa. */
    uocTruyThu?: number
}

export interface ChungTuLech {
    ma: string
    ngay: string
    tien: number
    ghiChu?: string
}

export interface ChieuSoSach {
    duocKetLuan: boolean
    lyDo?: string
    tong: number
    soChungTu: number
    /** Tách riêng để người dùng biết phần nào tại quầy, phần nào từ sàn. */
    taiQuay: number
    donSan: number
}

export interface ChieuHoaDon {
    duocKetLuan: boolean
    lyDo?: string
    /** Doanh thu chưa thuế trên hoá đơn bán ra, đã trừ trả hàng/điều chỉnh giảm. */
    tong: number
    tongCoThue: number
    thueGtgt: number
    soHoaDon: number
    soHuy: number
    soDieuChinh: number
    /** Hoá đơn phát hành HỎNG — chưa tính vào phần đã xuất, phải nói ra. */
    soLoi: number
    tienLoi: number
}

export interface ChieuDongTien {
    duocKetLuan: boolean
    lyDo?: string
    /** Tổng tiền vào tài khoản ngân hàng trong kỳ. */
    tienVao: number
    /** Phần doanh thu bán hàng được thanh toán không dùng tiền mặt. */
    doanhThuKhongTienMat: number
    /** Phần tiền vào chưa gắn được với doanh thu nào. */
    chuaGiaiThich: number
    soGiaoDich: number
}

export interface NgayLech {
    ngay: string
    soSach: number
    hoaDon: number
    lech: number
}

export interface ChiTienMatLon {
    id: string
    ngay: string
    tien: number
    vat: number
    nhaCungCap: string
    soHoaDon: string
}

export interface KetQuaDoiChieu {
    ky: { from: string; to: string; nhan: string }
    soSach: ChieuSoSach
    hoaDon: ChieuHoaDon
    dongTien: ChieuDongTien
    lech: {
        /** Sổ có mà hoá đơn không có (dương = còn thiếu hoá đơn). */
        chuaXuatHoaDon: number
        /** Hoá đơn có mà sổ không có (dương = hoá đơn vượt sổ). */
        hoaDonVuotSo: number
        tyLeXuatHoaDon: number | null
    }
    theoNgay: NgayLech[]
    /** Chứng từ bán hàng chưa gắn hoá đơn, lớn nhất trước. */
    chungTuChuaCoHoaDon: ChungTuLech[]
    /** Chi tiền mặt từ ngưỡng 5 triệu — mất khấu trừ GTGT. */
    chiTienMatLon: { danhSach: ChiTienMatLon[]; tongTien: number; tongVatMat: number }
    ruiRo: RuiRoDoiChieu[]
    /** Truy vấn nào hỏng — để giao diện nói "chưa đọc được" thay vì "không có". */
    thieu: string[]
    ghiChu: string[]
}

/* ---------------------------------------------------------------- tiện ích */

const lam = (n: any) => Math.round(Number(n) || 0)

/** Ngày theo giờ Việt Nam — cột giờ trong DB là UTC nên phải cộng 7 tiếng. */
function ngayVN(d: any): string {
    const t = new Date(d)
    if (isNaN(t.getTime())) return ''
    return new Date(t.getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10)
}

async function thu<T>(ten: string, thieu: string[], fn: () => Promise<T>, macDinh: T): Promise<T> {
    try { return await fn() } catch (e: any) {
        thieu.push(`${ten}: ${String(e?.message || e).slice(0, 120)}`)
        return macDinh
    }
}

/* ---------------------------------------------------------------- chính */

export async function doiChieuBaChieu(
    prisma: any,
    ky: KyDoiChieu,
    tuyChon?: { thueSuat?: number },
): Promise<KetQuaDoiChieu> {
    const thieu: string[] = []
    const ghiChu: string[] = []
    const thueSuat = tuyChon?.thueSuat ?? THUE_SUAT_MAC_DINH

    /* Các truy vấn chạy TUẦN TỰ, không Promise.all: pool Prisma mỗi cửa hàng chỉ
     * vài kết nối, bắn song song là một lượt xem báo cáo có thể hút cạn pool và
     * làm sập các request khác đang chạy. */

    // ---- Chiều 1: sổ sách ----------------------------------------------
    /* Đơn GHI NỢ mang status 'partial' — nó vẫn là bán thật, vẫn trừ kho, vẫn
     * được xuất hoá đơn. Chỉ đếm 'completed' là bỏ sót chúng khỏi sổ, và hậu quả
     * không phải "thiếu số" mà là VU OAN: hoá đơn của đơn ghi nợ trở thành "hoá
     * đơn vượt sổ" — chiều lệch nặng nhất. Đã gặp thật ngày 14/08/2026 ở một cửa
     * hàng: lệch ảo 677 triệu. Mọi module thuế khác trong repo đều dùng
     * ['completed','partial']. */
    /* CẮT KỲ THEO NGÀY BÁN, ĐỂ SO CÙNG MỘT THƯỚC ĐO.
     *
     * Vế hoá đơn bên dưới cắt theo `invoiceDate` — ngày nghiệp vụ thật. Vế sổ
     * mà cắt theo `createdAt` là so hai thước đo khác nhau, và với cửa hàng
     * nhập lịch sử từ phần mềm cũ thì lệch không phải vài phần trăm mà là toàn
     * bộ: KENGISTORE có 5 tháng bán hàng mang cùng một khoảng `createdAt` vài
     * tuần, nên tháng nhập liệu "sổ vượt hoá đơn" hàng tỷ còn các tháng trước
     * đó "hoá đơn vượt sổ" — cả hai đều là ảo ảnh của phép so sai cơ sở.
     *
     * Đây là công cụ ĐỐI CHIẾU, không sinh số kê khai, nên sửa ở đây không đụng
     * tới tờ khai nào. Dạng OR là idiom sẵn có trong repo (importReceipts.ts),
     * tương đương COALESCE nhưng viết được bằng Prisma. */
    const giaoDich = await thu('transaction', thieu, () => prisma.transaction.findMany({
        where: {
            status: { in: ['completed', 'partial'] },
            OR: [
                { transactionDate: { gte: ky.start, lt: ky.end } },
                { transactionDate: null, createdAt: { gte: ky.start, lt: ky.end } },
            ],
        },
        select: { id: true, receiptNumber: true, total: true, createdAt: true, transactionDate: true, vatInvoiceNumber: true, vatStatus: true, channel: true },
    }), [] as any[])

    const donSan = await thu('onlineOrder', thieu, () => prisma.onlineOrder.findMany({
        where: { createdAt: { gte: ky.start, lt: ky.end }, status: { in: ['delivered', 'completed'] } },
        select: { id: true, orderNumber: true, total: true, createdAt: true, platform: true },
    }), [] as any[])

    const tienQuay = giaoDich.reduce((s: number, t: any) => s + (Number(t.total) || 0), 0)

    /* CHỐNG ĐẾM TRÙNG — phải nối ĐÍCH DANH, tuyệt đối không trừ áng chừng.
     *
     * Đơn sàn khi đồng bộ về sẽ sinh một phiếu bán có receiptNumber dạng
     * 'ONLINE-<mã đơn>' và channel='online'. Nếu cộng cả hai nguồn thì phần đó
     * bị tính hai lần.
     *
     * Bản đầu tiên trừ THẲNG toàn bộ phiếu có channel='online', với giả định số
     * đó chắc chắn đã nằm bên đơn sàn. Giả định đó SAI khi đơn sàn tương ứng
     * không lọt vào tập đang đếm — khác trạng thái, hoặc ngày tạo rơi ngoài kỳ.
     * Khi ấy doanh thu không bị trừ trùng mà BIẾN MẤT HẲN.
     *
     * Hậu quả đo được trên dữ liệu thật ngày 14/08/2026 (cửa hàng KENGISTORE,
     * tháng 7): sổ có 9.523 phiếu / 5,0 tỷ nhưng bộ đối chiếu chỉ thấy 3 triệu,
     * rồi kết luận ngược hoàn toàn với sự thật — báo "hoá đơn vượt sổ 677 triệu"
     * trong khi thực tế là còn 4,3 tỷ doanh thu CHƯA xuất hoá đơn.
     *
     * Cách đúng: lấy trọn phiếu bán làm sổ, rồi chỉ CỘNG THÊM những đơn sàn chưa
     * có phiếu tương ứng. Không phép trừ nào cả, nên không có gì rơi mất. */
    const maPhieu = new Set(giaoDich.map((t: any) => String(t.receiptNumber || '')))
    const sanChuaCoPhieu = donSan.filter((o: any) => !maPhieu.has(`ONLINE-${String(o.orderNumber || '')}`))
    const tienSanThem = sanChuaCoPhieu.reduce((s: number, o: any) => s + (Number(o.total) || 0), 0)

    const soDonSanDaCoPhieu = donSan.length - sanChuaCoPhieu.length
    if (soDonSanDaCoPhieu > 0) {
        ghiChu.push(`${soDonSanDaCoPhieu} đơn sàn đã có phiếu bán tương ứng trong sổ — chỉ đếm MỘT lần để không thổi phồng doanh thu.`)
    }

    /* ── HOÁ ĐƠN ĐIỆN TỬ BẮT ĐẦU MUỘN HƠN LỊCH SỬ BÁN ───────────────────────
     *
     * Cửa hàng chuyển sang phần mềm này giữa chừng thường nhập được lịch sử BÁN
     * nhưng KHÔNG có hoá đơn điện tử của quãng trước — hồi đó họ phát hành qua
     * hệ thống khác. Sau khi vế sổ được cắt đúng theo ngày bán (sửa ở trên), các
     * kỳ cũ bỗng có doanh thu mà không có tờ hoá đơn nào, và phép đối chiếu sẽ
     * kết luận "toàn bộ doanh thu kỳ này chưa xuất hoá đơn" — đúng cái cáo buộc
     * nặng nhất của module, dựng trên một khoảng trống dữ liệu.
     *
     * Đo trên KENGISTORE: hoá đơn điện tử sớm nhất nằm ở tháng 7/2026, trong khi
     * bán từ 21/03. Nếu không chặn, riêng tháng 3–6 sẽ thành hơn 4 tỷ "chưa xuất
     * hoá đơn".
     *
     * Không đọc được thì để `null` và giữ nguyên cách kết luận cũ. */
    let hoaDonDauTien: string | null = null
    {
        /* Tờ PHÁT HÀNH ĐƯỢC sớm nhất, không phải tờ sớm nhất bất kể trạng thái.
         * Hoá đơn DRAFT/ERROR chưa có số và chưa gửi cơ quan thuế, nên chúng
         * không chứng minh được cửa hàng đã bắt đầu phát hành. Đo thật trên
         * KENGISTORE: 4 tờ đầu tiên (27–28/07) đều ERROR, phát hành thật bắt
         * đầu 29/07 — lấy tờ ERROR làm mốc thì chốt chặn tưởng đã phát hành từ
         * 27/07 và bỏ lọt đúng quãng cần được bảo vệ. */
        const r: any[] | null = await thu('eInvoice.dauTien', thieu, () => prisma.eInvoice.findFirst({
            where: {
                invoiceType: { not: 'PURCHASE' },
                status: { notIn: ['DRAFT', 'ERROR'] },
            },
            orderBy: { invoiceDate: 'asc' },
            select: { invoiceDate: true },
        }).then((x: any) => x ? [x] : []), null as any)
        const v = r?.[0]?.invoiceDate
        if (v) hoaDonDauTien = String(v).slice(0, 10)
    }
    /* Kỳ đang soát nằm TRỌN trước tờ hoá đơn đầu tiên → không có gì để đối
     * chiếu, và tuyệt đối không được gọi đó là "chưa xuất hoá đơn". */
    const kyTruocKhiCoHoaDon = !!hoaDonDauTien && ky.to < hoaDonDauTien

    const soSach: ChieuSoSach = {
        duocKetLuan: giaoDich.length > 0 || donSan.length > 0,
        lyDo: (giaoDich.length === 0 && donSan.length === 0)
            ? 'Kỳ này chưa có giao dịch bán nào trong phần mềm — không có gì để đối chiếu.'
            : undefined,
        tong: lam(tienQuay + tienSanThem),
        soChungTu: giaoDich.length + sanChuaCoPhieu.length,
        taiQuay: lam(tienQuay),
        donSan: lam(tienSanThem),
    }

    // ---- Chiều 2: hoá đơn điện tử --------------------------------------
    const hoaDonRaw = await thu('eInvoice', thieu, () => prisma.eInvoice.findMany({
        where: { invoiceDate: { gte: ky.from, lte: ky.to } },
        select: {
            id: true, invoiceNumber: true, invoiceDate: true, invoiceType: true, status: true,
            totalBeforeVat: true, vatAmount: true, totalAmount: true, transactionId: true,
        },
    }), [] as any[])

    const conHieuLuc = hoaDonRaw.filter((h: any) => {
        const st = String(h.status || '').toUpperCase()
        return st !== 'CANCELLED' && st !== 'REPLACED' && st !== 'DRAFT' && st !== 'ERROR'
    })
    const huy = hoaDonRaw.filter((h: any) => String(h.status || '').toUpperCase() === 'CANCELLED')
    /* Hoá đơn PHÁT HÀNH HỎNG bị loại khỏi phần "đã xuất" — đúng, vì chúng chưa
     * có số và chưa gửi cơ quan thuế. Nhưng loại IM LẶNG là sai: cửa hàng sẽ
     * thấy tỷ lệ phủ hoá đơn tụt mà không hiểu vì sao, rồi đi tìm nhầm chỗ.
     * Đếm riêng và nói ra. */
    const loi = hoaDonRaw.filter((h: any) => String(h.status || '').toUpperCase() === 'ERROR')
    const tienLoi = loi.reduce((s: number, h: any) => s + (Number(h.totalAmount) || 0), 0)
    const dieuChinh = conHieuLuc.filter((h: any) => {
        const lo = String(h.invoiceType || '').toUpperCase()
        return lo === 'RETURN' || lo === 'ADJUSTMENT'
    })

    /* Hoá đơn trả hàng / điều chỉnh giảm ghi ÂM vào doanh thu kỳ: nếu cộng dồn
     * như hoá đơn bán, doanh thu trên hoá đơn sẽ cao hơn thực tế và phần mềm sẽ
     * đi tố cửa hàng "xuất hoá đơn vượt sổ" trong khi họ làm đúng. */
    const dauCua = (h: any) => {
        const lo = String(h.invoiceType || '').toUpperCase()
        return (lo === 'RETURN' || lo === 'ADJUSTMENT') ? -1 : 1
    }
    const tongChuaThue = conHieuLuc.reduce((s: number, h: any) => s + dauCua(h) * (Number(h.totalBeforeVat) || 0), 0)
    const tongCoThue = conHieuLuc.reduce((s: number, h: any) => s + dauCua(h) * (Number(h.totalAmount) || 0), 0)
    const tongThue = conHieuLuc.reduce((s: number, h: any) => s + dauCua(h) * (Number(h.vatAmount) || 0), 0)

    /* Kỳ nằm trước tờ phát hành được đầu tiên → KHÔNG kết luận được, dùng chính
     * cờ `duocKetLuan` sẵn có thay vì thêm cờ mới: mọi nơi tiêu thụ kết quả
     * (bảng quét admin, giao diện) đều đã tôn trọng cờ này và sẽ hiện "—" kèm lý
     * do. Nếu chỉ chặn ở phần rủi ro thì cùng một màn hình vừa nói "chưa có lịch
     * sử hoá đơn" vừa hiện ô "chưa xuất 865 triệu" — hai câu chuyện. */
    const hoaDon: ChieuHoaDon = {
        duocKetLuan: hoaDonRaw.length > 0 && !kyTruocKhiCoHoaDon,
        lyDo: hoaDonRaw.length === 0
            ? 'Kỳ này chưa có hoá đơn điện tử nào trong phần mềm. Nếu cửa hàng phát hành hoá đơn bằng phần mềm khác thì đối chiếu ở đây không phản ánh đúng — hãy nhập hoặc đồng bộ hoá đơn về trước khi kết luận.'
            : kyTruocKhiCoHoaDon
                ? `Kỳ này nằm trước tờ hoá đơn phát hành được đầu tiên (${hoaDonDauTien}). Những tờ có trong kỳ đều chưa phát hành xong, nên không đối chiếu được — không kết luận là cửa hàng chưa xuất hoá đơn.`
                : undefined,
        tong: lam(tongChuaThue),
        tongCoThue: lam(tongCoThue),
        thueGtgt: lam(tongThue),
        soHoaDon: conHieuLuc.length,
        soHuy: huy.length,
        soDieuChinh: dieuChinh.length,
        soLoi: loi.length,
        tienLoi: lam(tienLoi),
    }

    // ---- Chiều 3: dòng tiền ngân hàng ----------------------------------
    const bank = await thu('bankTransaction', thieu, () => prisma.bankTransaction.findMany({
        where: { date: { gte: ky.start, lt: ky.end }, type: { in: ['credit', 'deposit'] } },
        select: { id: true, amount: true, date: true, description: true, matchedSaleId: true, isReconciled: true },
    }), [] as any[])

    const tienVao = bank.reduce((s: number, b: any) => s + (Number(b.amount) || 0), 0)

    /* Phần doanh thu thu không dùng tiền mặt: lấy từ chính phiếu thu của giao
     * dịch bán, không suy đoán từ mô tả sao kê. */
    const idGiaoDich = giaoDich.map((t: any) => t.id)
    const phieuThu = idGiaoDich.length === 0 ? [] : await thu('payment', thieu, () => prisma.payment.findMany({
        where: { transactionId: { in: idGiaoDich }, type: { in: ['transfer', 'card', 'bank', 'banking', 'qr'] } },
        select: { amount: true },
    }), [] as any[])
    const thuKhongTienMat = phieuThu.reduce((s: number, p: any) => s + (Number(p.amount) || 0), 0)

    /* Tiền sàn về cũng là tiền vào ngân hàng và KHÔNG phải doanh thu giấu —
     * cộng vào phần giải thích được, nếu không phần mềm sẽ báo động giả mỗi
     * lần Shopee/TikTok quyết toán. */
    /* JournalEntry.date là CHUỖI 'YYYY-MM-DD', không phải DateTime — so bằng đối
     * tượng Date sẽ không khớp gì cả và toàn bộ tiền sàn về sẽ rơi vào cột "chưa
     * giải trình", tức là phần mềm đi tố cửa hàng giấu doanh thu vì lỗi của
     * chính nó. */
    const tienSanVe = await thu('journalEntry', thieu, () => prisma.journalEntry.findMany({
        where: { date: { gte: ky.from, lte: ky.to }, referenceType: 'platform-settlement' },
        select: { amount: true },
    }), [] as any[])
    const tienSanTong = tienSanVe.reduce((s: number, e: any) => s + (Number(e.amount) || 0), 0)

    const giaiThichDuoc = thuKhongTienMat + tienSanTong
    const dongTien: ChieuDongTien = {
        duocKetLuan: bank.length > 0,
        lyDo: bank.length === 0
            ? 'Chưa có giao dịch ngân hàng nào được nhập cho kỳ này. Không có sao kê thì không kết luận được gì về dòng tiền — đây KHÔNG phải dấu hiệu sai phạm.'
            : undefined,
        tienVao: lam(tienVao),
        doanhThuKhongTienMat: lam(giaiThichDuoc),
        chuaGiaiThich: lam(Math.max(0, tienVao - giaiThichDuoc)),
        soGiaoDich: bank.length,
    }

    // ---- Lệch sổ ↔ hoá đơn ---------------------------------------------
    const chuaXuat = lam(soSach.tong - hoaDon.tongCoThue)
    const lech = {
        chuaXuatHoaDon: Math.max(0, chuaXuat),
        hoaDonVuotSo: Math.max(0, -chuaXuat),
        tyLeXuatHoaDon: soSach.tong > 0 ? Math.round((hoaDon.tongCoThue / soSach.tong) * 1000) / 10 : null,
    }

    // ---- Lệch theo từng ngày -------------------------------------------
    const bangNgay = new Map<string, { so: number; hd: number }>()
    const cong = (ng: string, khoa: 'so' | 'hd', tien: number) => {
        if (!ng) return
        const o = bangNgay.get(ng) || { so: 0, hd: 0 }
        o[khoa] += tien
        bangNgay.set(ng, o)
    }
    /* Dùng ĐÚNG tập đã dựng ở chiều 1: mọi phiếu bán, cộng thêm đơn sàn chưa có
     * phiếu. Nếu chỗ này đếm khác chiều 1 thì tổng và bảng ngày sẽ chỏi nhau, và
     * người dùng không biết tin con số nào. */
    for (const t of giaoDich) cong(ngayVN(t.transactionDate || t.createdAt), 'so', Number(t.total) || 0)
    for (const o of sanChuaCoPhieu) cong(ngayVN(o.createdAt), 'so', Number(o.total) || 0)
    for (const h of conHieuLuc) cong(String(h.invoiceDate || ''), 'hd', dauCua(h) * (Number(h.totalAmount) || 0))

    const theoNgay: NgayLech[] = Array.from(bangNgay.entries())
        .map(([ngay, v]) => ({ ngay, soSach: lam(v.so), hoaDon: lam(v.hd), lech: lam(v.so - v.hd) }))
        .sort((a, b) => a.ngay.localeCompare(b.ngay))

    // ---- Chứng từ chưa có hoá đơn --------------------------------------
    const idDaGanHoaDon = new Set(conHieuLuc.map((h: any) => String(h.transactionId || '')).filter(Boolean))
    const chungTuChuaCoHoaDon: ChungTuLech[] = giaoDich
        .filter((t: any) => !idDaGanHoaDon.has(String(t.id)) && !t.vatInvoiceNumber)
        .map((t: any) => ({ ma: String(t.receiptNumber || t.id), ngay: ngayVN(t.transactionDate || t.createdAt), tien: lam(t.total) }))
        .sort((a, b) => b.tien - a.tien)
        .slice(0, 100)

    // ---- Chi tiền mặt vượt ngưỡng khấu trừ ------------------------------
    const chiRaw = await thu('expense', thieu, () => prisma.expense.findMany({
        where: {
            date: { gte: ky.start, lt: ky.end },
            status: 'active',
            amount: { gte: NGUONG_TIEN_MAT },
            bankAccountId: null,
        },
        select: { id: true, date: true, amount: true, vatAmount: true, supplierName: true, invoiceNo: true, description: true },
    }), [] as any[])

    /* Chỉ tính khoản CÓ số hoá đơn: không có hoá đơn thì cửa hàng vốn đã không
     * khấu trừ, cảnh báo thêm chỉ gây nhiễu. */
    const chiCoHoaDon = chiRaw.filter((e: any) => String(e.invoiceNo || '').trim())
    const chiTienMatLon = {
        danhSach: chiCoHoaDon
            .map((e: any) => ({
                id: String(e.id),
                ngay: ngayVN(e.date),
                tien: lam(e.amount),
                vat: lam(e.vatAmount),
                nhaCungCap: String(e.supplierName || e.description || '—'),
                soHoaDon: String(e.invoiceNo || ''),
            }))
            .sort((a: ChiTienMatLon, b: ChiTienMatLon) => b.tien - a.tien)
            .slice(0, 50),
        tongTien: lam(chiCoHoaDon.reduce((s: number, e: any) => s + (Number(e.amount) || 0), 0)),
        tongVatMat: lam(chiCoHoaDon.reduce((s: number, e: any) => s + (Number(e.vatAmount) || 0), 0)),
    }
    if (chiCoHoaDon.length > 0) {
        ghiChu.push('Phần mềm nhận ra "chi tiền mặt" từ việc phiếu chi không gắn tài khoản ngân hàng. Nếu thực tế đã chuyển khoản, hãy gắn tài khoản vào phiếu chi — cảnh báo sẽ tự hết.')
    }

    // ---- Xếp rủi ro -----------------------------------------------------
    const ruiRo: RuiRoDoiChieu[] = []

    /* Kỳ nằm trọn trước tờ hoá đơn đầu tiên: nêu ra nhưng KHÔNG gọi là chưa xuất
     * hoá đơn — phần mềm không có hoá đơn của quãng đó, chứ không biết cửa hàng
     * có phát hành hay không. Xem khối giải thích ở chỗ đo `hoaDonDauTien`. */
    if (kyTruocKhiCoHoaDon && lech.chuaXuatHoaDon > 0) {
        ruiRo.push({
            ma: 'chua-co-lich-su-hoa-don',
            muc: 'vua',
            tieuDe: `Kỳ này chưa có hoá đơn điện tử nào trong phần mềm`,
            vaSao: `Sổ bán hàng ghi ${soSach.tong.toLocaleString('vi-VN')}đ, nhưng tờ hoá đơn điện tử sớm nhất trong phần mềm là ngày ${hoaDonDauTien}. Cửa hàng bắt đầu dùng phần mềm này sau kỳ đang soát, nên KHÔNG kết luận được là chưa xuất hoá đơn — rất có thể hồi đó phát hành qua hệ thống khác.`,
            canCu: 'Điều 90 Luật Quản lý thuế 38/2019 — nghĩa vụ lập hoá đơn tính theo lần bán, không phụ thuộc phần mềm nào đang dùng.',
            canLam: `Đối chiếu với hệ thống hoá đơn cũ của kỳ này. Nếu quãng đó thật sự chưa xuất hoá đơn thì mới cần xuất bù; nếu đã xuất qua hệ thống khác thì nhập lại vào đây để các kỳ sau đối chiếu được.`,
            /* KHÔNG ước truy thu: chưa biết cửa hàng có xuất hoá đơn hồi đó hay
             * không thì gắn một con số truy thu vào là doạ người bằng số bịa. */
            soTien: lech.chuaXuatHoaDon,
        })
    }

    if (!kyTruocKhiCoHoaDon && hoaDon.duocKetLuan && soSach.duocKetLuan && lech.chuaXuatHoaDon > 0) {
        const tyLe = lech.tyLeXuatHoaDon ?? 0
        ruiRo.push({
            ma: 'chua-xuat-hoa-don',
            muc: tyLe < 50 ? 'cao' : tyLe < 90 ? 'vua' : 'thap',
            tieuDe: `Còn ${lam(lech.chuaXuatHoaDon).toLocaleString('vi-VN')}đ doanh thu chưa có hoá đơn`,
            vaSao: `Sổ bán hàng ghi ${soSach.tong.toLocaleString('vi-VN')}đ nhưng hoá đơn đã phát hành chỉ ${hoaDon.tongCoThue.toLocaleString('vi-VN')}đ (đạt ${tyLe}%). Phần chênh là các lần bán chưa lập hoá đơn.`,
            canCu: 'Điều 90 Luật Quản lý thuế 38/2019 và Điều 4 NĐ 123/2020: người bán phải lập hoá đơn cho mọi lần bán, kể cả bán lẻ giá trị nhỏ. Không lập hoá đơn bị phạt theo Điều 24 NĐ 125/2020, kèm truy thu GTGT phần doanh thu bỏ sót.',
            canLam: 'Xuất bù hoá đơn cho các chứng từ ở danh sách bên dưới, hoặc bật hoá đơn tự động khi bán để kỳ sau không phát sinh tiếp.',
            soTien: lech.chuaXuatHoaDon,
            uocTruyThu: lam(lech.chuaXuatHoaDon / (1 + thueSuat) * thueSuat),
        })
    }

    if (hoaDon.duocKetLuan && soSach.duocKetLuan && lech.hoaDonVuotSo > 0) {
        /* Ngưỡng 0,5% để không báo động vì lẻ tiền làm tròn. */
        const dangKe = soSach.tong === 0 || lech.hoaDonVuotSo / Math.max(1, soSach.tong) > 0.005
        if (dangKe) {
            ruiRo.push({
                ma: 'hoa-don-vuot-so',
                muc: 'cao',
                tieuDe: `Hoá đơn nhiều hơn sổ ${lam(lech.hoaDonVuotSo).toLocaleString('vi-VN')}đ`,
                vaSao: 'Đã phát hành hoá đơn cho phần doanh thu không tìm thấy trong sổ bán hàng. Hai khả năng: bán mà quên ghi vào phần mềm, hoặc hoá đơn bị lập nhầm/lập trùng. Chiều lệch này nặng hơn chiều thiếu hoá đơn vì cơ quan thuế có sẵn dữ liệu hoá đơn của bạn.',
                canCu: 'Điều 50 Luật Quản lý thuế 38/2019: sổ sách không khớp chứng từ là căn cứ để cơ quan thuế ấn định thuế thay vì chấp nhận số khai.',
                canLam: 'Mở bảng lệch theo ngày, tìm ngày lệch lớn nhất rồi soát lại hoá đơn ngày đó: thiếu phiếu bán thì ghi bổ sung, hoá đơn sai thì lập hoá đơn thay thế hoặc điều chỉnh.',
                soTien: lech.hoaDonVuotSo,
            })
        }
    }

    if (dongTien.duocKetLuan && dongTien.chuaGiaiThich > 0) {
        const tyLe = dongTien.tienVao > 0 ? dongTien.chuaGiaiThich / dongTien.tienVao : 0
        ruiRo.push({
            ma: 'tien-vao-chua-giai-trinh',
            muc: tyLe > 0.5 ? 'cao' : tyLe > 0.2 ? 'vua' : 'thap',
            tieuDe: `${lam(dongTien.chuaGiaiThich).toLocaleString('vi-VN')}đ vào tài khoản chưa gắn được với doanh thu`,
            vaSao: 'Tiền vào ngân hàng nhiều hơn phần doanh thu thu qua chuyển khoản và tiền sàn quyết toán. Có thể là vay mượn, chuyển giữa tài khoản của chính mình, khách hoàn cọc — nhưng phải nói được là gì.',
            canCu: 'Điều 98 Luật Quản lý thuế 38/2019 cho cơ quan thuế quyền yêu cầu ngân hàng cung cấp thông tin tài khoản. Khoản tiền vào không giải trình được thường bị quy về doanh thu chưa kê khai.',
            canLam: 'Vào sổ ngân hàng, ghi chú nguồn cho từng khoản lớn (vay, góp vốn, chuyển nội bộ, hoàn tiền) và đối soát khoản nào là tiền bán hàng thì gắn vào phiếu bán tương ứng.',
            soTien: dongTien.chuaGiaiThich,
        })
    }

    if (chiTienMatLon.danhSach.length > 0) {
        ruiRo.push({
            ma: 'chi-tien-mat-vuot-nguong',
            muc: chiTienMatLon.tongVatMat > 0 ? 'vua' : 'thap',
            tieuDe: `${chiCoHoaDon.length} khoản mua vào từ ${(NGUONG_TIEN_MAT / 1e6)} triệu trả tiền mặt`,
            vaSao: chiTienMatLon.tongVatMat > 0
                ? `Các khoản này có hoá đơn nhưng trả tiền mặt nên mất quyền khấu trừ ${chiTienMatLon.tongVatMat.toLocaleString('vi-VN')}đ thuế GTGT đầu vào, và phần chi phí cũng khó được chấp nhận khi tính thuế TNDN.`
                : 'Các khoản này có hoá đơn nhưng trả tiền mặt nên mất quyền khấu trừ thuế GTGT đầu vào; hoá đơn chưa tách phần thuế nên chưa tính được số mất cụ thể.',
            canCu: `Luật Thuế GTGT 48/2024 hiệu lực 01/7/2025: hàng hoá, dịch vụ mua vào từ ${(NGUONG_TIEN_MAT / 1e6)} triệu đồng phải có chứng từ thanh toán không dùng tiền mặt mới được khấu trừ. Ngưỡng cũ 20 triệu đã bị bãi bỏ.`,
            canLam: 'Từ nay chuyển khoản cho mọi hoá đơn mua vào từ 5 triệu. Các khoản đã lỡ trả tiền mặt: liên hệ nhà cung cấp xin đổi sang chuyển khoản nếu chưa quyết toán, còn không thì loại phần thuế này ra khỏi số được khấu trừ để tránh bị truy thu.',
            soTien: chiTienMatLon.tongTien,
            uocTruyThu: chiTienMatLon.tongVatMat || undefined,
        })
    }

    if (hoaDon.soLoi > 0) {
        /* Tờ hỏng đứng RIÊNG, không gộp vào "chưa xuất hoá đơn": hai thứ này
         * chữa khác hẳn nhau. Chưa xuất thì đi xuất; hỏng thì phải xem vì sao
         * hỏng — và một phần trong đó thật ra ĐÃ phát hành thành công, xuất lại
         * là hỏng tiếp. */
        ruiRo.push({
            ma: 'hoa-don-phat-hanh-loi',
            muc: hoaDon.tienLoi > 0 && soSach.tong > 0 && hoaDon.tienLoi / soSach.tong > 0.02 ? 'vua' : 'thap',
            tieuDe: `${hoaDon.soLoi} hoá đơn phát hành hỏng (${lam(hoaDon.tienLoi).toLocaleString('vi-VN')}đ)`,
            vaSao: 'Những tờ này chưa có số hoá đơn nên KHÔNG được tính vào phần đã xuất ở trên — tỷ lệ phủ hoá đơn vì thế thấp hơn thực tế. Về mặt thuế, hoá đơn hỏng giống như chưa lập hoá đơn.',
            canCu: 'Điều 90 Luật Quản lý thuế 38/2019: bán hàng phải lập hoá đơn. Hoá đơn chưa phát hành được thì nghĩa vụ vẫn còn nguyên.',
            canLam: 'Mở Hóa Đơn VAT → bảng "hoá đơn phát hành hỏng" để xem nguyên nhân từng nhóm. Lưu ý nhóm báo trùng khoá: đó là hoá đơn ĐÃ phát hành thành công, phải ghi bù chứ không được xuất lại.',
            soTien: hoaDon.tienLoi,
        })
        ghiChu.push(`${hoaDon.soLoi} hoá đơn ở trạng thái phát hành hỏng chưa được tính vào phần đã xuất — con số "đã xuất hoá đơn" ở trên vì thế THẤP HƠN thực tế.`)
    }

    if (!hoaDon.duocKetLuan && soSach.duocKetLuan && soSach.tong > 0) {
        ruiRo.push({
            ma: 'khong-co-hoa-don-nao',
            muc: 'vua',
            tieuDe: 'Kỳ này chưa thấy hoá đơn điện tử nào trong phần mềm',
            vaSao: `Có ${soSach.tong.toLocaleString('vi-VN')}đ doanh thu nhưng không có hoá đơn nào để đối chiếu. Nếu cửa hàng phát hành hoá đơn ở phần mềm khác thì con số đối chiếu ở trang này chưa dùng được — đây là cảnh báo về DỮ LIỆU, chưa phải kết luận về nghĩa vụ thuế.`,
            canCu: 'NĐ 70/2025: hộ, cá nhân kinh doanh có doanh thu từ 1 tỷ đồng/năm phải dùng hoá đơn điện tử khởi tạo từ máy tính tiền kết nối cơ quan thuế.',
            canLam: 'Kết nối nhà cung cấp hoá đơn điện tử vào phần mềm, hoặc nhập hoá đơn đã phát hành về, rồi chạy lại đối chiếu.',
            soTien: null,
        })
    }

    ruiRo.sort((a, b) => {
        const w = { cao: 0, vua: 1, thap: 2 }
        if (w[a.muc] !== w[b.muc]) return w[a.muc] - w[b.muc]
        return (b.soTien || 0) - (a.soTien || 0)
    })

    if (thieu.length > 0) {
        ghiChu.push('Một số bảng dữ liệu chưa đọc được — các con số liên quan đang để trống, KHÔNG được hiểu là bằng không.')
    }
    ghiChu.push('Số ước tính truy thu chỉ để hình dung mức độ, không phải số cơ quan thuế sẽ ra quyết định.')

    return {
        ky: { from: ky.from, to: ky.to, nhan: ky.nhan },
        soSach, hoaDon, dongTien,
        lech, theoNgay, chungTuChuaCoHoaDon, chiTienMatLon,
        ruiRo, thieu, ghiChu,
    }
}
