// ─────────────────────────────────────────────────────────────────────────────
//  VIỆC CẦN XỬ LÝ NGAY — bộ tổng hợp dùng chung
//
//  Một nguồn duy nhất cho: bảng "Việc cần xử lý" ở trang Tổng Quan (web),
//  và tool MCP `viec_can_lam` (AI agent). Sửa luật ở ĐÂY thì cả hai cùng đổi —
//  hai bản chép tay sẽ lệch nhau ngay lần sửa đầu tiên.
//
//  Luật chung cho mỗi việc:
//    • Chỉ đưa vào khi CÓ HÀNH ĐỘNG CỤ THỂ để làm. "Doanh thu giảm" không phải
//      việc cần xử lý — "5 phiếu nhập quá hạn trả tiền" mới là.
//    • Đọc hỏng thì BỎ QUA việc đó, KHÔNG trả 0. Cột chưa migrate ở store cũ mà
//      báo "0 việc" là trấn an sai (memory: khong-buoc-toi-oan).
//    • Chạy TUẦN TỰ: pool prod mỗi store chỉ 1 kết nối, Promise.all chỉ xếp
//      hàng chứ không nhanh hơn, mà lỗi thì khó lần.
// ─────────────────────────────────────────────────────────────────────────────

export type MucDo = 'khan' | 'canhBao' | 'nhac'

export interface ViecCanLam {
    /** khoá ổn định để FE nhớ trạng thái ẩn/hiện */
    ma: string
    nhom: 'kho' | 'tien' | 'don' | 'thue' | 'soSach' | 'dichVu'
    mucDo: MucDo
    tieuDe: string
    /** câu mô tả ngắn: nói RÕ con số và vì sao phải làm */
    chiTiet: string
    soLuong: number
    soTien?: number
    /** đường dẫn trang xử lý trên web */
    duongDan: string
    /** nhãn nút hành động */
    nhanNut: string
}

export interface KetQuaViecCanLam {
    items: ViecCanLam[]
    tongViec: number
    tongKhan: number
    /** những mục KHÔNG đọc được (cột thiếu / bảng chưa có) — nói thẳng thay vì im lặng */
    khongDocDuoc: string[]
    tinhLuc: string
}

const dauNgay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())

/** Chạy một phép đo; hỏng thì ghi vào danh sách "không đọc được" và trả null. */
async function doAn(ten: string, fn: () => Promise<any>, hong: string[]): Promise<any> {
    try {
        return await fn()
    } catch {
        hong.push(ten)
        return null
    }
}

export async function tinhViecCanLam(prisma: any, opts?: { branchFilter?: any }): Promise<KetQuaViecCanLam> {
    const items: ViecCanLam[] = []
    const hong: string[] = []
    const bo = opts?.branchFilter ?? {}
    const homNay = dauNgay(new Date())

    // ─── 1. Hết hàng (chặn bán) ──────────────────────────────────────────────
    const hetHang = await doAn('Hàng hết', () => prisma.product.count({
        where: { stock: { lte: 0 }, productType: { not: 'service' } },
    }), hong)
    if (hetHang && hetHang > 0) {
        items.push({
            ma: 'het-hang', nhom: 'kho', mucDo: 'khan',
            tieuDe: `${hetHang} mã đã hết hàng`,
            chiTiet: 'Khách hỏi là không bán được, và đơn sàn đang treo cũng không giao được. Đặt hàng hoặc tạm ẩn khỏi gian hàng.',
            soLuong: hetHang, duongDan: '/dashboard-products?stock=out_of_stock', nhanNut: 'Xem hàng hết',
        })
    }

    // ─── 2. Sắp hết hàng (0 < tồn ≤ tồn tối thiểu) ───────────────────────────
    const sapHet = await doAn('Hàng sắp hết', async () => {
        const ds = await prisma.product.findMany({
            where: { stock: { gt: 0 }, productType: { not: 'service' } },
            select: { stock: true, minStock: true },
            take: 5000,
        })
        return ds.filter((p: any) => p.stock <= (p.minStock ?? 0)).length
    }, hong)
    if (sapHet && sapHet > 0) {
        items.push({
            ma: 'sap-het-hang', nhom: 'kho', mucDo: 'canhBao',
            tieuDe: `${sapHet} mã sắp hết hàng`,
            chiTiet: 'Tồn đã chạm mức tối thiểu — đặt hàng bây giờ thì kịp, để hết rồi mới đặt là mất doanh thu những ngày chờ về.',
            soLuong: sapHet, duongDan: '/dashboard-products?stock=low_stock', nhanNut: 'Lên đơn đặt hàng',
        })
    }

    // ─── 3. Tồn kho ÂM (dữ liệu sai, không phải chuyện bán hàng) ─────────────
    const tonAm = await doAn('Tồn kho âm', () => prisma.product.count({ where: { stock: { lt: 0 } } }), hong)
    if (tonAm && tonAm > 0) {
        items.push({
            ma: 'ton-am', nhom: 'kho', mucDo: 'khan',
            tieuDe: `${tonAm} mã đang âm kho`,
            chiTiet: 'Tồn âm nghĩa là đã bán nhiều hơn số đã nhập — hoặc thiếu phiếu nhập, hoặc bán nhầm mã. Giá vốn và lãi của những mã này đang sai.',
            soLuong: tonAm, duongDan: '/dashboard-inventory?filter=negative', nhanNut: 'Truy nguyên',
        })
    }

    // ─── 4. Nợ nhà cung cấp tới hạn / quá hạn ────────────────────────────────
    const denHan = await doAn('Hạn trả NCC', async () => {
        const moc = new Date(homNay.getFullYear(), homNay.getMonth(), homNay.getDate() + 4) // hết ngày hôm nay+3
        const ds = await prisma.importReceipt.findMany({
            where: {
                dueDate: { not: null, lt: moc },
                paymentStatus: { not: 'paid' },
                status: { notIn: ['cancelled', 'draft', 'returned'] },
                ...bo,
            },
            select: { totalCost: true, paidAmount: true, dueDate: true },
            take: 2000,
        })
        const quaHan = ds.filter((r: any) => r.dueDate && new Date(r.dueDate) < homNay).length
        const conNo = ds.reduce((s: number, r: any) => s + Math.max(0, (r.totalCost || 0) - (r.paidAmount || 0)), 0)
        return { tong: ds.length, quaHan, conNo }
    }, hong)
    if (denHan && denHan.tong > 0) {
        items.push({
            ma: 'han-tra-ncc', nhom: 'tien', mucDo: denHan.quaHan > 0 ? 'khan' : 'canhBao',
            tieuDe: denHan.quaHan > 0
                ? `${denHan.quaHan} phiếu nhập QUÁ HẠN trả tiền`
                : `${denHan.tong} phiếu nhập tới hạn trả trong 3 ngày`,
            chiTiet: `Còn nợ ${(denHan.conNo || 0).toLocaleString('vi-VN')}đ. Trả trễ là mất chiết khấu và mất cửa lấy hàng gối đầu lần sau.`,
            soLuong: denHan.quaHan > 0 ? denHan.quaHan : denHan.tong,
            soTien: denHan.conNo,
            duongDan: '/dashboard-payment-due', nhanNut: 'Xem hạn thanh toán',
        })
    }

    // ─── 5. Khách còn nợ ─────────────────────────────────────────────────────
    const khachNo = await doAn('Công nợ khách', async () => {
        const ds = await prisma.customer.findMany({
            where: { debt: { gt: 0 } },
            select: { debt: true },
            take: 5000,
        })
        return { so: ds.length, tong: ds.reduce((s: number, c: any) => s + (c.debt || 0), 0) }
    }, hong)
    if (khachNo && khachNo.so > 0) {
        items.push({
            ma: 'khach-no', nhom: 'tien', mucDo: 'canhBao',
            tieuDe: `${khachNo.so} khách đang nợ`,
            chiTiet: `Tổng ${(khachNo.tong || 0).toLocaleString('vi-VN')}đ chưa thu. Tiền nằm ở khách là tiền không quay được vòng hàng.`,
            soLuong: khachNo.so, soTien: khachNo.tong,
            duongDan: '/dashboard-debt', nhanNut: 'Xem công nợ',
        })
    }

    // ─── 6. Đơn sàn chờ xử lý ────────────────────────────────────────────────
    const donSan = await doAn('Đơn sàn chờ xử lý', () => prisma.onlineOrder.count({
        where: {
            status: {
                in: [
                    'pending', 'confirmed', 'UNPAID', 'READY_TO_SHIP', 'AWAITING_SHIPMENT',
                    'PROCESSED', 'AWAITING_COLLECTION', 'processing',
                ],
            },
        },
    }), hong)
    if (donSan && donSan > 0) {
        items.push({
            ma: 'don-san-cho', nhom: 'don', mucDo: 'khan',
            tieuDe: `${donSan} đơn sàn chờ xử lý`,
            chiTiet: 'Sàn tính giờ xác nhận — chậm là bị phạt tỉ lệ giao trễ và tụt hiển thị gian hàng.',
            soLuong: donSan, duongDan: '/dashboard-online-orders', nhanNut: 'Xử lý đơn',
        })
    }

    // ─── 7. Hoá đơn điện tử: đơn chờ phát hành / phát hành lỗi ───────────────
    const hddChoXuat = await doAn('Hàng đợi hoá đơn điện tử', () => prisma.transaction.count({
        where: { vatStatus: { in: ['pending', 'queued', 'processing'] } },
    }), hong)
    if (hddChoXuat && hddChoXuat > 0) {
        items.push({
            ma: 'hddt-cho-xuat', nhom: 'thue', mucDo: 'canhBao',
            tieuDe: `${hddChoXuat} đơn đang chờ xuất hoá đơn điện tử`,
            chiTiet: 'Đơn nằm trong hàng đợi — nếu quá lâu thường là thiếu tồn kho thuế hoặc lỗi kết nối nhà cung cấp HĐĐT.',
            soLuong: hddChoXuat, duongDan: '/dashboard-einvoice', nhanNut: 'Mở hàng đợi',
        })
    }
    const hddLoi = await doAn('Hoá đơn điện tử lỗi', () => prisma.transaction.count({
        where: { vatStatus: { in: ['error', 'failed'] } },
    }), hong)
    if (hddLoi && hddLoi > 0) {
        items.push({
            ma: 'hddt-loi', nhom: 'thue', mucDo: 'khan',
            tieuDe: `${hddLoi} đơn phát hành hoá đơn LỖI`,
            chiTiet: 'Đã bán mà chưa có hoá đơn hợp lệ giao khách — để lâu là rơi khỏi kỳ kê khai.',
            soLuong: hddLoi, duongDan: '/dashboard-einvoice', nhanNut: 'Xem lỗi',
        })
    }

    // ─── 8. Sao kê ngân hàng chưa đối soát ───────────────────────────────────
    const chuaDoiSoat = await doAn('Sao kê chưa đối soát', () => prisma.bankTransaction.count({
        where: { isReconciled: false },
    }), hong)
    if (chuaDoiSoat && chuaDoiSoat > 0) {
        items.push({
            ma: 'sao-ke-chua-doi-soat', nhom: 'soSach', mucDo: 'canhBao',
            tieuDe: `${chuaDoiSoat} dòng sao kê chưa đối soát`,
            chiTiet: 'Tiền đã vào/ra tài khoản nhưng chưa gắn vào phiếu nào — sổ ngân hàng và sổ kế toán đang lệch đúng bằng những dòng này.',
            soLuong: chuaDoiSoat, duongDan: '/dashboard-ebanking', nhanNut: 'Đối soát',
        })
    }

    // ─── 9. Phiếu nhập trùng số hoá đơn (khai trùng thuế) ────────────────────
    const trungHD = await doAn('Phiếu nhập trùng số hoá đơn', async () => {
        const tu = new Date(Date.now() - 12 * 30 * 86400_000)
        const ds = await prisma.importReceipt.findMany({
            where: { createdAt: { gte: tu }, status: { not: 'cancelled' }, vatInvoiceNo: { not: null } },
            select: { vatInvoiceNo: true, supplierId: true, supplierName: true },
            take: 5000,
        })
        const chuan = (v: any) => String(v || '').replace(/\s+/g, '').toLowerCase()
        const dem = new Map<string, number>()
        for (const r of ds) {
            const so = chuan(r.vatInvoiceNo)
            const ncc = r.supplierId || chuan(r.supplierName)
            if (!so || !ncc) continue
            const k = `${ncc}|${so}`
            dem.set(k, (dem.get(k) || 0) + 1)
        }
        return [...dem.values()].filter(n => n > 1).length
    }, hong)
    if (trungHD && trungHD > 0) {
        items.push({
            ma: 'trung-so-hoa-don', nhom: 'thue', mucDo: 'khan',
            tieuDe: `${trungHD} số hoá đơn nhập bị trùng`,
            chiTiet: 'Cùng một tờ hoá đơn vào sổ hai lần: tồn kho thừa, giá vốn lệch, nợ NCC ghi thừa và thuế GTGT khấu trừ khai trùng.',
            soLuong: trungHD, duongDan: '/dashboard-import', nhanNut: 'Xem phiếu trùng',
        })
    }

    // ─── 10. Phiếu nhập còn nháp ─────────────────────────────────────────────
    const nhapNhap = await doAn('Phiếu nhập nháp', () => prisma.importReceipt.count({
        where: { status: 'draft' },
    }), hong)
    if (nhapNhap && nhapNhap > 0) {
        items.push({
            ma: 'phieu-nhap-nhap', nhom: 'kho', mucDo: 'nhac',
            tieuDe: `${nhapNhap} phiếu nhập còn nháp`,
            chiTiet: 'Phiếu nháp CHƯA cộng vào tồn kho — hàng đã về kho mà sổ vẫn báo thiếu.',
            soLuong: nhapNhap, duongDan: '/dashboard-import', nhanNut: 'Hoàn tất phiếu',
        })
    }

    // ─── 11. Phiếu sửa chữa đang mở ──────────────────────────────────────────
    const suaChua = await doAn('Phiếu sửa chữa', () => prisma.repair.count({
        where: { status: { in: ['received', 'diagnosing', 'repairing', 'waiting_part', 'processing'] } },
    }), hong)
    if (suaChua && suaChua > 0) {
        items.push({
            ma: 'sua-chua-mo', nhom: 'dichVu', mucDo: 'nhac',
            tieuDe: `${suaChua} phiếu sửa chữa đang mở`,
            chiTiet: 'Máy của khách đang giữ tại cửa hàng — khách chờ lâu không báo là mất khách và mang tiếng.',
            soLuong: suaChua, duongDan: '/dashboard-repairs', nhanNut: 'Xem phiếu',
        })
    }

    // ─── 12. Báo giá chưa chốt ───────────────────────────────────────────────
    const baoGia = await doAn('Báo giá chờ chốt', () => prisma.quotation.count({
        where: { status: { in: ['draft', 'sent', 'pending'] } },
    }), hong)
    if (baoGia && baoGia > 0) {
        items.push({
            ma: 'bao-gia-cho', nhom: 'don', mucDo: 'nhac',
            tieuDe: `${baoGia} báo giá chưa chốt`,
            chiTiet: 'Khách đã hỏi giá mà chưa quay lại — gọi lại sớm là đơn, để nguội là mất về tay chỗ khác.',
            soLuong: baoGia, duongDan: '/dashboard-quotations', nhanNut: 'Theo dõi báo giá',
        })
    }

    const uuTien: Record<MucDo, number> = { khan: 0, canhBao: 1, nhac: 2 }
    items.sort((a, b) => uuTien[a.mucDo] - uuTien[b.mucDo] || b.soLuong - a.soLuong)

    return {
        items,
        tongViec: items.length,
        tongKhan: items.filter(i => i.mucDo === 'khan').length,
        khongDocDuoc: hong,
        tinhLuc: new Date().toISOString(),
    }
}
