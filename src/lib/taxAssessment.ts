/**
 * MÔ PHỎNG BỊ ẤN ĐỊNH THUẾ — hàm thuần, chạy được với client giả.
 *
 * Đây là kịch bản xấu nhất của một cuộc thanh tra: cơ quan thuế không chấp nhận
 * sổ sách nữa mà TỰ ẤN ĐỊNH số phải nộp theo Điều 50 Luật Quản lý thuế 38/2019.
 * Lúc đó mọi tranh luận về từng hóa đơn đều vô nghĩa — họ áp tỷ lệ trên doanh
 * thu và bạn phải chứng minh ngược lại.
 *
 * Module này làm hai việc:
 *  1. Liệt kê CĂN CỨ ẤN ĐỊNH đang có thật trong dữ liệu (Điều 50 khoản 1) — mỗi
 *     dấu hiệu dẫn đúng điểm luật, vì đây là chỗ người dùng cần cãi được.
 *  2. Ước tính số thuế nếu bị ấn định, so với số đã kê khai.
 *
 * CẢNH BÁO nằm ngay trong dữ liệu trả về: đây là ƯỚC TÍNH MINH HỌA để thấy mức
 * độ thiệt hại, KHÔNG phải dự báo số cơ quan thuế sẽ ra. Số ấn định thật còn phụ
 * thuộc cơ sở dữ liệu ngành của cơ quan thuế mà bên ngoài không truy cập được.
 */

export type MucCanCu = 'ro-rang' | 'co-dau-hieu'

export interface CanCuAnDinh {
    ma: string
    muc: MucCanCu
    dauHieu: string
    /** Điểm/khoản của Điều 50 hoặc điều luật tương ứng */
    dieuKhoan: string
    chiTiet: string
    /** Cách phản bác nếu thực tế không phải vậy */
    caiThenao: string
}

export interface KichBanAnDinh {
    ten: string
    /** Cách ấn định: theo tỷ lệ % trên doanh thu (hộ KD) hay theo tỷ suất lợi nhuận ngành (DN) */
    cachTinh: string
    canCu: string
    doanhThuAnDinh: number
    thueGtgt: number
    thueTndnHoacTncn: number
    tongThue: number
    /** Chênh so với số đã kê khai — số dương là phải nộp thêm */
    chenhLech: number
}

export interface HoSoAnDinh {
    ky: string
    laHoKinhDoanh: boolean
    canCu: CanCuAnDinh[]
    nguyCo: 'thap' | 'trung-binh' | 'cao'
    doanhThuSo: number
    doanhThuHoaDon: number
    /** Doanh thu cơ quan thuế nhiều khả năng lấy làm gốc ấn định */
    doanhThuGocAnDinh: number
    thueDaKeKhai: number
    kichBan: KichBanAnDinh[]
    tyLeApDung: {
        gtgt: number
        tndnHoacTncn: number
        nganh: string
        canCu: string
    }
    ghiChu: string
    canLamNgay: string[]
}

const r0 = (v: number) => Math.round(v || 0)
const vnd = (v: number) => Math.round(v || 0).toLocaleString('vi-VN')

/**
 * Tỷ lệ % trên doanh thu để tính thuế với hộ/cá nhân kinh doanh —
 * Phụ lục I Thông tư 40/2021/TT-BTC.
 */
export const TY_LE_TT40: Record<string, { gtgt: number; tncn: number; ten: string }> = {
    'phan-phoi': { gtgt: 0.01, tncn: 0.005, ten: 'Phân phối, cung cấp hàng hóa' },
    'dich-vu': { gtgt: 0.05, tncn: 0.02, ten: 'Dịch vụ, xây dựng không bao thầu nguyên vật liệu' },
    'san-xuat': { gtgt: 0.03, tncn: 0.015, ten: 'Sản xuất, vận tải, dịch vụ có gắn với hàng hóa' },
    'khac': { gtgt: 0.02, tncn: 0.01, ten: 'Hoạt động kinh doanh khác' },
}

/** Thuế suất thuế TNDN phổ thông — Điều 10 Luật Thuế TNDN */
export const THUE_SUAT_TNDN = 0.2

/**
 * Tỷ suất lợi nhuận trên doanh thu dùng khi ấn định với doanh nghiệp.
 * Cơ quan thuế lấy từ cơ sở dữ liệu doanh nghiệp cùng ngành, cùng quy mô
 * (Điều 15 NĐ 126/2020) — bên ngoài không truy cập được, nên để mức bán lẻ
 * thường gặp và cho phép người dùng chỉnh.
 */
export const TY_SUAT_LOI_NHUAN_MAC_DINH = 0.05

export async function moPhongAnDinh(
    prisma: any,
    ky: { from: string; to: string; start: Date; end: Date; maKy: string; nhan: string },
    tuyChon?: { tySuatLoiNhuan?: number; nganh?: keyof typeof TY_LE_TT40 },
): Promise<HoSoAnDinh> {
    const { from, to, start, end, maKy, nhan } = ky
    const an = async <T,>(fn: () => Promise<T>, mac: T): Promise<T> => {
        try { return await fn() } catch { return mac }
    }

    const butToan: any[] = await an(() => prisma.journalEntry.findMany({
        where: { date: { gte: from, lte: to } },
        select: { debitAccount: true, creditAccount: true, amount: true, date: true },
    }), [])
    const butToanTruoc: any[] = await an(() => prisma.journalEntry.findMany({
        where: { date: { lt: from } },
        select: { debitAccount: true, creditAccount: true, amount: true },
    }), [])
    const hoaDon: any[] = await an(() => prisma.eInvoice.findMany({
        where: { invoiceDate: { gte: from, lte: to } },
        select: { status: true, invoiceType: true, totalBeforeVat: true, transactionId: true },
    }), [])
    const giaoDich: any[] = await an(() => prisma.transaction.findMany({
        where: { status: { in: ['completed', 'partial'] }, createdAt: { gte: start, lte: end } },
        select: { id: true, total: true },
    }), [])
    const toKhai: any = await an(() => prisma.taxDeclaration.findFirst({
        where: { period: maKy },
        select: { ct29: true, ct30: true, ct33: true, ct40a: true },
    }), null)
    const cauHinh: any = await an(() => prisma.storeSettings.findFirst({
        select: { businessType: true },
    }), null)
    const amKho: any[] = await an(() => prisma.product.findMany({
        where: { stock: { lt: 0 } }, select: { sku: true, name: true, stock: true },
    }), [])
    const phieuNhap: any[] = await an(() => prisma.importReceipt.findMany({
        where: { status: 'completed', createdAt: { gte: start, lte: end } },
        select: { totalCost: true, hasVatInvoice: true },
    }), [])

    const laHkd = cauHinh?.businessType === 'household'

    const ps = (list: any[], tienTo: string) => {
        let no = 0, co = 0
        for (const e of list) {
            if (String(e.debitAccount || '').startsWith(tienTo)) no += e.amount
            if (String(e.creditAccount || '').startsWith(tienTo)) co += e.amount
        }
        return { no, co, du: no - co }
    }

    const p511 = ps(butToan, '511'), p521 = ps(butToan, '521')
    const doanhThuSo = r0(p511.co - p511.no - (p521.no - p521.co))
    const doanhThuHoaDon = r0(hoaDon
        .filter(h => ['SIGNED', 'SENT'].includes(String(h.status)) && h.invoiceType !== 'RETURN')
        .reduce((s, h) => s + (h.totalBeforeVat || 0), 0))
    const doanhThuPhieuBan = r0(giaoDich.reduce((s, g) => s + (g.total || 0), 0))

    /* Gốc ấn định lấy MỨC CAO NHẤT trong các nguồn — cơ quan thuế luôn chọn số
     * bất lợi nhất cho người nộp thuế khi các nguồn lệch nhau, và họ có quyền
     * dùng cả dữ liệu ngoài sổ (sao kê, dữ liệu sàn). */
    const doanhThuGocAnDinh = Math.max(doanhThuSo, doanhThuHoaDon, doanhThuPhieuBan)

    // ── Căn cứ ấn định thật sự có trong dữ liệu ──────────────────────────────
    const canCu: CanCuAnDinh[] = []

    if (!toKhai) {
        canCu.push({
            ma: 'khong-nop-to-khai',
            muc: 'ro-rang',
            dauHieu: `Chưa có tờ khai kỳ ${maKy} trong hệ thống`,
            dieuKhoan: 'Điểm b khoản 1 Điều 50 Luật Quản lý thuế 38/2019',
            chiTiet: 'Không nộp hoặc nộp không đầy đủ hồ sơ khai thuế là căn cứ ấn định trực tiếp, không cần chứng minh gì thêm.',
            caiThenao: 'Nếu đã nộp qua thuedientu thì in Thông báo tiếp nhận và cập nhật lại vào phần mềm — dữ liệu thiếu ở đây không có nghĩa là chưa nộp.',
        })
    }

    const lechToKhai = toKhai ? Math.abs(doanhThuSo - r0(toKhai.ct29)) : 0
    if (toKhai && lechToKhai > Math.max(1000, doanhThuSo * 0.02)) {
        canCu.push({
            ma: 'so-lieu-khong-trung-thuc',
            muc: 'ro-rang',
            dauHieu: `Doanh thu sổ lệch tờ khai ${vnd(lechToKhai)}đ`,
            dieuKhoan: 'Điểm đ khoản 1 Điều 50 Luật Quản lý thuế 38/2019',
            chiTiet: 'Phản ánh không trung thực, không đầy đủ căn cứ tính thuế. Đây là căn cứ ấn định hay bị dùng nhất với hộ và doanh nghiệp nhỏ.',
            caiThenao: 'Lập bảng đối chiếu từng khoản chênh (hàng bán trả lại, hóa đơn điều chỉnh, doanh thu chưa đến kỳ) rồi khai bổ sung trước khi có quyết định thanh tra.',
        })
    }

    if (amKho.length > 0) {
        canCu.push({
            ma: 'ton-kho-am',
            muc: 'ro-rang',
            dauHieu: `${amKho.length} mặt hàng tồn kho âm`,
            dieuKhoan: 'Điểm e khoản 1 Điều 50 Luật Quản lý thuế 38/2019',
            chiTiet: 'Bán ra nhiều hơn số nhập vào là bằng chứng mua hàng không hóa đơn — cơ quan thuế ấn định luôn cả giá vốn lẫn doanh thu tương ứng.',
            caiThenao: 'Rà lại phiếu nhập bị bỏ sót; hàng mua của cá nhân không kinh doanh phải lập Bảng kê 01/TNDN kèm hợp đồng và chứng từ thanh toán.',
        })
    }

    // Quỹ tiền mặt âm theo ngày
    let luy = ps(butToanTruoc, '111').du
    let ngayAm = 0
    for (const b of [...butToan].sort((a, b) => String(a.date).localeCompare(String(b.date)))) {
        if (String(b.debitAccount || '').startsWith('111')) luy += b.amount
        if (String(b.creditAccount || '').startsWith('111')) luy -= b.amount
        if (luy < -1000) ngayAm++
    }
    if (ngayAm > 0) {
        canCu.push({
            ma: 'quy-am',
            muc: 'ro-rang',
            dauHieu: `${ngayAm} ngày tồn quỹ tiền mặt âm`,
            dieuKhoan: 'Điểm đ khoản 1 Điều 50 Luật Quản lý thuế 38/2019',
            chiTiet: 'Chi nhiều hơn tiền đang có nghĩa là sổ quỹ không phản ánh đúng thực tế: hoặc thiếu doanh thu, hoặc chứng từ chi là khống.',
            caiThenao: 'Truy lại ngày âm và bổ sung chứng từ thu tiền thật (góp vốn, vay chủ hộ có giấy nhận nợ) — không được sửa lùi ngày chi.',
        })
    }

    const nhapKhongHd = phieuNhap.filter(n => !n.hasVatInvoice)
    const tienNhapKhongHd = r0(nhapKhongHd.reduce((s, n) => s + (n.totalCost || 0), 0))
    const tongNhap = r0(phieuNhap.reduce((s, n) => s + (n.totalCost || 0), 0))
    if (tongNhap > 0 && tienNhapKhongHd > tongNhap * 0.3) {
        canCu.push({
            ma: 'mua-vao-khong-hoa-don',
            muc: 'co-dau-hieu',
            dauHieu: `${Math.round(tienNhapKhongHd / tongNhap * 100)}% giá trị hàng nhập không có hóa đơn (${vnd(tienNhapKhongHd)}đ)`,
            dieuKhoan: 'Điểm e khoản 1 Điều 50 Luật Quản lý thuế 38/2019',
            chiTiet: 'Phần lớn đầu vào không có hóa đơn khiến sổ sách không đủ căn cứ xác định chi phí — cơ quan thuế có quyền ấn định chi phí theo tỷ lệ ngành thay vì theo sổ.',
            caiThenao: 'Chuẩn hóa nguồn nhập: yêu cầu hóa đơn từ nhà cung cấp, hoặc lập bảng kê mua của cá nhân không kinh doanh kèm hợp đồng.',
        })
    }

    const idHd = new Set(hoaDon.map(h => h.transactionId).filter(Boolean))
    const banKhongHd = giaoDich.filter(g => !idHd.has(g.id))
    const tienBanKhongHd = r0(banKhongHd.reduce((s, g) => s + (g.total || 0), 0))
    if (doanhThuPhieuBan > 0 && tienBanKhongHd > doanhThuPhieuBan * 0.2) {
        canCu.push({
            ma: 'ban-khong-xuat-hoa-don',
            muc: 'co-dau-hieu',
            dauHieu: `${banKhongHd.length} phiếu bán chưa xuất hóa đơn (${vnd(tienBanKhongHd)}đ)`,
            dieuKhoan: 'Điều 90 Luật Quản lý thuế 38/2019; Điều 50 khoản 1 điểm đ',
            chiTiet: 'Bán hàng không lập hóa đơn vừa là hành vi bị phạt riêng, vừa là căn cứ để cho rằng sổ sách không phản ánh đủ doanh thu.',
            caiThenao: 'Xuất hóa đơn bù hoặc lập hóa đơn tổng hợp cho khách lẻ theo NĐ 123/2020, làm đều đặn từng ngày thay vì dồn.',
        })
    }

    const nguyCo: HoSoAnDinh['nguyCo'] =
        canCu.some(c => c.muc === 'ro-rang') ? (canCu.length >= 3 ? 'cao' : 'trung-binh')
            : canCu.length > 0 ? 'trung-binh' : 'thap'

    // ── Kịch bản ấn định ─────────────────────────────────────────────────────
    const nganh = tuyChon?.nganh || 'phan-phoi'
    const tl = TY_LE_TT40[nganh] || TY_LE_TT40['phan-phoi']
    const tySuat = tuyChon?.tySuatLoiNhuan ?? TY_SUAT_LOI_NHUAN_MAC_DINH

    // Thuế đã kê khai của kỳ: GTGT phải nộp + TNDN tạm tính trên lãi sổ
    const p3331 = ps(butToan, '3331'), p133 = ps(butToan, '133')
    const gtgtTheoSo = Math.max(0, r0(p3331.co - p3331.no) - r0(p133.no - p133.co))
    const gtgtDaKhai = toKhai ? Math.max(0, r0(toKhai.ct40a)) : gtgtTheoSo
    const p632 = ps(butToan, '632'), p641 = ps(butToan, '641'), p642 = ps(butToan, '642')
    const laiSo = doanhThuSo - r0(p632.no - p632.co) - r0(p641.no - p641.co) - r0(p642.no - p642.co)
    const tndnTheoSo = laiSo > 0 ? r0(laiSo * THUE_SUAT_TNDN) : 0
    const thueDaKeKhai = gtgtDaKhai + (laHkd ? 0 : tndnTheoSo)

    const kichBan: KichBanAnDinh[] = []

    if (laHkd) {
        const gtgt = r0(doanhThuGocAnDinh * tl.gtgt)
        const tncn = r0(doanhThuGocAnDinh * tl.tncn)
        kichBan.push({
            ten: 'Ấn định theo tỷ lệ % trên doanh thu',
            cachTinh: `Doanh thu ${vnd(doanhThuGocAnDinh)}đ × (${(tl.gtgt * 100).toFixed(1)}% GTGT + ${(tl.tncn * 100).toFixed(1)}% TNCN)`,
            canCu: `Phụ lục I Thông tư 40/2021/TT-BTC — ngành "${tl.ten}"`,
            doanhThuAnDinh: doanhThuGocAnDinh,
            thueGtgt: gtgt,
            thueTndnHoacTncn: tncn,
            tongThue: gtgt + tncn,
            chenhLech: gtgt + tncn - thueDaKeKhai,
        })
    } else {
        // Kịch bản 1: chỉ loại chi phí không đủ điều kiện, vẫn dùng doanh thu sổ
        const thuNhapAnDinh1 = Math.max(0, laiSo) + tienNhapKhongHd
        const tndn1 = r0(thuNhapAnDinh1 * THUE_SUAT_TNDN)
        kichBan.push({
            ten: 'Loại chi phí không có hóa đơn, giữ nguyên doanh thu sổ',
            cachTinh: `(Lãi trên sổ ${vnd(Math.max(0, laiSo))}đ + chi phí bị loại ${vnd(tienNhapKhongHd)}đ) × 20%`,
            canCu: 'Điều 4 Thông tư 96/2015/TT-BTC; Điều 10 Luật Thuế TNDN',
            doanhThuAnDinh: doanhThuSo,
            thueGtgt: gtgtDaKhai,
            thueTndnHoacTncn: tndn1,
            tongThue: gtgtDaKhai + tndn1,
            chenhLech: gtgtDaKhai + tndn1 - thueDaKeKhai,
        })

        // Kịch bản 2: ấn định theo tỷ suất lợi nhuận ngành trên doanh thu gốc
        const thuNhapAnDinh2 = r0(doanhThuGocAnDinh * tySuat)
        const tndn2 = r0(thuNhapAnDinh2 * THUE_SUAT_TNDN)
        const gtgt2 = r0(doanhThuGocAnDinh * 0.1) - r0(p133.no - p133.co)
        kichBan.push({
            ten: 'Ấn định theo tỷ suất lợi nhuận ngành',
            cachTinh: `Doanh thu ${vnd(doanhThuGocAnDinh)}đ × tỷ suất lợi nhuận ${(tySuat * 100).toFixed(1)}% × thuế suất 20%`,
            canCu: 'Điều 15 Nghị định 126/2020/NĐ-CP — ấn định theo cơ sở dữ liệu doanh nghiệp cùng ngành, cùng quy mô',
            doanhThuAnDinh: doanhThuGocAnDinh,
            thueGtgt: Math.max(0, gtgt2),
            thueTndnHoacTncn: tndn2,
            tongThue: Math.max(0, gtgt2) + tndn2,
            chenhLech: Math.max(0, gtgt2) + tndn2 - thueDaKeKhai,
        })
    }

    const canLamNgay: string[] = []
    if (canCu.some(c => c.muc === 'ro-rang')) {
        canLamNgay.push('Xử lý dứt điểm các căn cứ ấn định "rõ ràng" ở trên — còn một cái là cơ quan thuế có quyền bỏ qua toàn bộ sổ sách của bạn.')
    }
    canLamNgay.push('Khai bổ sung trước khi cơ quan thuế công bố quyết định thanh tra: tự phát hiện thì chỉ nộp thuế thiếu + tiền chậm nộp, để họ phát hiện thì thêm 20% phạt khai sai (Điều 16 NĐ 125/2020).')
    canLamNgay.push('Chuẩn bị bộ chứng từ gốc đầy đủ: khi có đủ hóa đơn, hợp đồng, chứng từ thanh toán thì cơ quan thuế KHÔNG được ấn định mà phải tính theo sổ.')
    if (amKho.length > 0 || ngayAm > 0) {
        canLamNgay.push('Ưu tiên xử lý tồn kho âm và quỹ âm trước — đây là hai dấu hiệu đoàn nhìn là biết ngay, không cần đối chiếu gì.')
    }

    return {
        ky: nhan,
        laHoKinhDoanh: laHkd,
        canCu,
        nguyCo,
        doanhThuSo,
        doanhThuHoaDon,
        doanhThuGocAnDinh,
        thueDaKeKhai,
        kichBan,
        tyLeApDung: {
            gtgt: laHkd ? tl.gtgt : 0.1,
            tndnHoacTncn: laHkd ? tl.tncn : THUE_SUAT_TNDN,
            nganh: tl.ten,
            canCu: laHkd
                ? 'Phụ lục I Thông tư 40/2021/TT-BTC'
                : 'Điều 10 Luật Thuế TNDN; tỷ suất lợi nhuận theo Điều 15 NĐ 126/2020',
        },
        ghiChu: 'Đây là ƯỚC TÍNH MINH HỌA để thấy mức thiệt hại nếu bị ấn định, KHÔNG phải dự báo số cơ quan thuế sẽ ra. Số ấn định thật dựa trên cơ sở dữ liệu ngành của cơ quan thuế mà bên ngoài không truy cập được, và có thể cao hơn hoặc thấp hơn.',
        canLamNgay,
    }
}
