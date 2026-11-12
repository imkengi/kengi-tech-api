/**
 * Sổ kế toán HỘ KINH DOANH (TT152/2025/TT-BTC) — phần đọc phiếu bán KHỐI LỚN cho sổ S2c, S2d.
 *
 * 12/11/2026: chủ shop KENGISTORE chọn "Cả năm" ở sổ S2c ⇒ máy chủ sập 4 lần trong 20 phút
 * ("FATAL ERROR: Reached heap limit … JavaScript heap out of memory"), mỗi lần trả 503 cho MỌI
 * yêu cầu đang chạy trên bản máy đó — kể cả của cửa hàng khác. Tab "Quyết toán thuế" cũng gọi
 * đúng sổ này cho cả năm. Gốc: `include: { items: { include: { product: true } } }` kéo NGUYÊN
 * hàng Product (35 cột, có cả mô tả) cho từng dòng hàng của cả năm (~25 nghìn phiếu) trong MỘT
 * lượt, mà heap V8 của bản 1Gi chỉ ~520MB. Sổ chỉ cần giá vốn / tên / đơn vị của hàng.
 * ⇒ Đọc THEO LÔ (khoá id tăng dần) và CHỈ chọn đúng các cột sổ dùng.
 */

/** Số phiếu mỗi lô. Mỗi lô là 3 câu (phiếu, dòng hàng, hàng): đủ nhỏ để không ôm heap,
 *  đủ to để sổ cả năm chỉ hơn chục lô. */
export const LO_PHIEU_SO = 2000

type CoFindMany<T> = { findMany: (args: any) => Promise<T[]> }

/**
 * Đọc MỌI bản ghi khớp `where`, theo lô `lo`, khoá `id` tăng dần.
 * `select` phải là danh sách cột HẸP — đừng truyền `include` cả quan hệ (đó chính là thứ đã làm sập máy chủ).
 * Chạy TUẦN TỰ từng lô: pool Prisma prod chỉ 1 kết nối/cửa hàng, giữa hai lô yêu cầu khác còn chen vào được.
 */
// `= any`: route gọi bằng `p.transaction` kiểu any ⇒ không suy ra được T; thiếu mặc định thì TS
// lấy ràng buộc `{ id: string }` và mọi cột khác thành "không tồn tại" (check:kieu bắt được).
export async function docTheoLo<T extends { id: string } = any>(
    model: CoFindMany<T>,
    where: Record<string, any>,
    select: Record<string, any>,
    lo: number = LO_PHIEU_SO,
): Promise<T[]> {
    if (!(Number.isInteger(lo) && lo >= 1)) throw new Error(`docTheoLo: lô phải là số nguyên ≥ 1 (nhận ${lo})`)
    const ra: T[] = []
    let sau: string | null = null
    for (;;) {
        const trang: T[] = await model.findMany({
            where: sau === null ? where : { AND: [where, { id: { gt: sau } }] },
            select: { ...select, id: true },
            orderBy: { id: 'asc' },
            take: lo,
        })
        for (const x of trang) ra.push(x)
        if (trang.length < lo) return ra
        const cuoi: string = trang[trang.length - 1].id
        // So BẰNG chứ không so lớn/nhỏ: thứ tự chuỗi của Postgres (collation) có thể khác JS.
        if (cuoi === sau) throw new Error('docTheoLo: lô sau trả lại đúng khoá cũ — dừng để khỏi lặp vô tận')
        sau = cuoi
    }
}

const moc = (d: unknown): number => {
    if (d === null || d === undefined || d === '') return NaN
    const t = new Date(d as any).getTime()
    return Number.isFinite(t) ? t : NaN
}

/**
 * Xếp y như `orderBy: [{ transactionDate: 'asc' }, { createdAt: 'asc' }]` của Postgres
 * (ASC ⇒ NULL xếp CUỐI), hoà thì theo id — để thứ tự dòng trong ngày giữ như bản đọc một lượt.
 * Xếp TẠI CHỖ và trả lại chính mảng đó.
 */
export function xepTheoNgayChungTu<T extends { id: string; transactionDate?: unknown; createdAt?: unknown }>(ds: T[]): T[] {
    return ds.sort((a, b) => {
        const ta = moc(a.transactionDate), tb = moc(b.transactionDate)
        const thieuA = Number.isNaN(ta), thieuB = Number.isNaN(tb)
        if (thieuA !== thieuB) return thieuA ? 1 : -1
        if (!thieuA && ta !== tb) return ta - tb
        const ca = moc(a.createdAt), cb = moc(b.createdAt)
        const thieuCa = Number.isNaN(ca), thieuCb = Number.isNaN(cb)
        if (thieuCa !== thieuCb) return thieuCa ? 1 : -1
        if (!thieuCa && ca !== cb) return ca - cb
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    })
}

/* ── Cột từng sổ dùng ───────────────────────────────────────────────────────────────────────
 * TransactionItem KHÔNG có cột giá vốn / đơn vị / productSku ⇒ giá vốn của dòng bán xưa nay là
 * giá vốn HIỆN TẠI của hàng (`product.costPrice`), đơn vị là `product.baseUnit`. Giữ nguyên cách
 * tính đó — bản vá 12/11 chỉ đổi CÁCH ĐỌC, không đổi con số. */

/** Sổ S2c (chi tiết doanh thu, chi phí): doanh thu từng phiếu + giá vốn. */
export const CHON_PHIEU_S2C = {
    receiptNumber: true, customerName: true, transactionDate: true, createdAt: true,
    subtotal: true, discount: true,
    items: { select: { quantity: true, product: { select: { costPrice: true } } } },
}

/** Sổ S2d dạng nhật ký (từng dòng nhập/xuất). */
export const CHON_PHIEU_S2D = {
    receiptNumber: true, customerName: true, transactionDate: true, createdAt: true, vatInvoiceNumber: true,
    items: { select: { sku: true, productId: true, productName: true, quantity: true, product: { select: { costPrice: true, name: true, baseUnit: true } } } },
}

/** Sổ S2d tổng hợp theo mã hàng (đầu kỳ / nhập / xuất / cuối kỳ): chỉ cần dòng hàng. */
export const CHON_PHIEU_TON = {
    items: { select: { sku: true, productId: true, productName: true, quantity: true, product: { select: { costPrice: true, baseUnit: true } } } },
}

/** Cột hàng đi kèm dòng PHIẾU NHẬP ở sổ S2d (thay `product: true`). */
export const CHON_HANG_DONG_NHAP = { select: { costPrice: true, name: true, baseUnit: true } }

/* ── Sổ S2c ────────────────────────────────────────────────────────────────────────────── */

/** Map loại chi phí → nhóm chi phí hợp lý theo TT152/2025/TT-BTC (Điều 5). */
export function nhomChiPhiS2c(cat: string): { nhom: string; label: string } {
    const c = (cat || '').toLowerCase()
    if (c === 'a' || c.includes('purchase') || c.includes('hang') || c.includes('nvl') || c.includes('material') || c.includes('hàng hóa') || c.includes('nguyên liệu')) return { nhom: 'a', label: '(a) Nguyên liệu, vật liệu, hàng hóa' }
    if (c === 'b' || c.includes('salary') || c.includes('luong') || c.includes('lương') || c.includes('bh') || c.includes('payroll') || c.includes('labor') || c.includes('nhân công')) return { nhom: 'b', label: '(b) Tiền lương, BHXH, phụ cấp' }
    if (c === 'c' || c.includes('depreciation') || c.includes('khau_hao') || c.includes('khấu hao') || c.includes('tsđ') || c.includes('asset')) return { nhom: 'c', label: '(c) Khấu hao tài sản cố định' }
    if (c === 'd' || c.includes('util') || c.includes('electric') || c.includes('dien') || c.includes('điện') || c.includes('nước') || c.includes('phone') || c.includes('internet') || c.includes('rent') || c.includes('thuê') || c.includes('ship') || c.includes('transport') || c.includes('vận chuyển') || c.includes('service') || c.includes('dịch vụ')) return { nhom: 'd', label: '(d) Dịch vụ mua ngoài' }
    if (c === 'đ' || c.includes('interest') || c.includes('loan') || c.includes('lai') || c.includes('lãi') || c.includes('vay')) return { nhom: 'đ', label: '(đ) Lãi tiền vay' }
    return { nhom: 'e', label: '(e) Chi phí khác' }
}

const NHAN_NHOM_S2C: Record<string, string> = {
    a: '(a) Nguyên liệu, vật liệu, hàng hóa',
    b: '(b) Tiền lương, BHXH, phụ cấp',
    c: '(c) Khấu hao tài sản cố định',
    d: '(d) Dịch vụ mua ngoài',
    'đ': '(đ) Lãi tiền vay',
    e: '(e) Chi phí khác',
}

/**
 * Dựng sổ S2c từ phiếu bán (đã xếp theo ngày chứng từ) + phiếu chi trong kỳ.
 * Mỗi phiếu bán: 1 dòng doanh thu (tiền hàng − chiết khấu) + 1 dòng giá vốn nếu > 0.
 * `fmtDate` truyền từ route để ngày in ra y hệt các sổ khác.
 */
export function tinhSoS2c(txs: any[], expenses: any[], fmtDate: (d: any) => string): { rows: any[]; summary: any } {
    const rows: any[] = []
    for (const t of txs) {
        const ngay = fmtDate(t.transactionDate || t.createdAt)
        const soChungTu = t.receiptNumber || ''
        const tenKH = t.customerName ? ' - ' + t.customerName : ''
        const dtBan = (t.subtotal || 0) - (t.discount || 0)
        rows.push({ ngay, soChungTu, dienGiai: `Bán hàng${tenKH}`, doanhThu: dtBan, chiPhi: 0, loiNhuan: dtBan, nhom: '', loaiChiPhi: 'Doanh thu' })
        let cogs = 0
        for (const item of (t.items || [])) cogs += (item.quantity || 0) * (item.product?.costPrice || 0)
        if (cogs > 0) {
            rows.push({ ngay, soChungTu, dienGiai: `Giá vốn hàng bán${tenKH}`, doanhThu: 0, chiPhi: cogs, loiNhuan: -cogs, nhom: 'a', loaiChiPhi: '(a) Nguyên liệu, vật liệu, hàng hóa (COGS)' })
        }
    }
    for (const e of expenses) {
        const { nhom, label } = nhomChiPhiS2c(e.category || '')
        // Số hoá đơn nằm trong mô tả dạng "[INV-001] Nội dung"
        const hdMatch = (e.description || '').match(/^\[([^\]]+)\]\s*(.+)$/)
        const soChungTu = hdMatch ? hdMatch[1] : `CP-${String(e.id || '').slice(-6)}`
        const dienGiai = hdMatch ? hdMatch[2] : (e.description || e.category || 'Chi phí')
        rows.push({ ngay: fmtDate(e.date), soChungTu, dienGiai, doanhThu: 0, chiPhi: e.amount || 0, loiNhuan: -(e.amount || 0), nhom, loaiChiPhi: label, expenseId: e.id })
    }

    rows.sort((a, b) => a.ngay.localeCompare(b.ngay))
    rows.forEach((r, i) => { r.stt = i + 1 })

    let tongDoanhThu = 0, tongChiPhi = 0
    const chiPhiTheoNhom: Record<string, { label: string; soTien: number }> = {}
    for (const [k, v] of Object.entries(NHAN_NHOM_S2C)) chiPhiTheoNhom[k] = { label: v, soTien: 0 }
    for (const r of rows) {
        tongDoanhThu += r.doanhThu
        tongChiPhi += r.chiPhi
        if (r.nhom && chiPhiTheoNhom[r.nhom]) chiPhiTheoNhom[r.nhom].soTien += r.chiPhi
    }
    const chenhLech = tongDoanhThu - tongChiPhi // Dòng (3) = (1) − (2)
    return { rows, summary: { tongDoanhThu, tongChiPhi, tongLoiNhuan: chenhLech, chenhLech, chiPhiTheoNhom } }
}
