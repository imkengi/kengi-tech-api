import { Router, Request, Response } from 'express'
import { errMsg } from '../lib/errorResponse'
import { authMiddleware, getBranchFilter, AuthRequest, getBranchId } from '../middleware/auth'
import { createJournalEntriesForTransaction, AUTO_JOURNAL_REF_TYPES, PLATFORM_AR } from '../lib/autoJournal'
import { postImportReceiptJournal, postExpenseJournal, postReturnJournal } from '../lib/autoJournalPurchase'
import { COA_SEED, accountName } from '../lib/chartOfAccounts'
import { enforcePeriodLock, assertNotLocked } from '../lib/periodLock'
import { giaiTrinhKhaiBoSung } from '../lib/amendmentExplain'
import { ganTienChoMoc, type MocNghiaVu } from '../lib/taxCalendar'
import { nguongChiuThueHKD } from '../lib/taxAudit'
import { suyHoSoThue, gieoLichNghiaVu } from '../lib/taxCalendarStore'

const router = Router()

// ═══════════════════════════════════════════════════════════════════════════════
//  TAX CONFIG (existing CRUD)
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/tax
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const data = await prisma.taxConfig.findMany({ where: { ...getBranchFilter(req as any) } })
        res.json({ success: true, data })
    } catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// POST /api/tax
router.post('/', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { name, rate, description, isDefault } = req.body
        if (!name?.trim()) return res.status(400).json({ success: false, error: 'Name required' })
        if (isDefault) await prisma.taxConfig.updateMany({ data: { isDefault: false } })
        const data = await prisma.taxConfig.create({ data: { name, rate: Number(rate) || 0, description, isDefault: isDefault || false } })
        res.status(201).json({ success: true, data })
    } catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// ─── Store Info (for tax declarations) ──────────────────────────────────────

// GET /api/tax/store-info
router.get('/store-info', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const store = await prisma.storeSettings.findFirst() as any
        res.json({
            success: true,
            data: {
                name: store?.name || '',
                address: store?.address || '',
                phone: store?.phone || '',
                email: store?.email || '',
                website: store?.website || '',
                businessType: store?.businessType || 'company',
                taxCode: store?.taxCode || '',
                ownerName: store?.ownerName || '',
                ownerIdNumber: store?.ownerIdNumber || '',
                representativeName: store?.representativeName || '',
            }
        })
    } catch (err) {
        console.error('Get store-info error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// PUT /api/tax/store-info
router.put('/store-info', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { name, address, phone, email, website, businessType, taxCode, ownerName, ownerIdNumber, representativeName } = req.body
        const data: any = {}
        if (name !== undefined) data.name = name
        if (address !== undefined) data.address = address
        if (phone !== undefined) data.phone = phone
        if (email !== undefined) data.email = email
        if (website !== undefined) data.website = website
        if (businessType !== undefined) data.businessType = businessType
        if (taxCode !== undefined) data.taxCode = taxCode
        if (ownerName !== undefined) data.ownerName = ownerName
        if (ownerIdNumber !== undefined) data.ownerIdNumber = ownerIdNumber
        if (representativeName !== undefined) data.representativeName = representativeName

        const updated = await prisma.storeSettings.upsert({
            where: { id: 'default' },
            create: { id: 'default', name: name || 'My Store', updatedAt: new Date(), ...data },
            update: data,
        }) as any
        res.json({
            success: true,
            data: {
                name: updated.name || '',
                address: updated.address || '',
                phone: updated.phone || '',
                email: updated.email || '',
                website: updated.website || '',
                businessType: updated.businessType || 'company',
                taxCode: updated.taxCode || '',
                ownerName: updated.ownerName || '',
                ownerIdNumber: updated.ownerIdNumber || '',
                representativeName: updated.representativeName || '',
            }
        })
    } catch (err) {
        console.error('Update store-info error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})


// --- HKD Revenue Entries ---

// GET /api/tax/hkd-revenue
router.get('/hkd-revenue', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const p = req.storePrisma! as any
        const year = Number(req.query.year) || new Date().getFullYear()
        const month = Number(req.query.month) || 0
        const bf = getBranchFilter(req as any)
        const where: any = { ...bf }
        if (month) { where.date = { gte: new Date(year, month - 1, 1), lte: new Date(year, month - 1, 31, 23, 59, 59) } }
        else { where.date = { gte: new Date(year, 0, 1), lte: new Date(year, 11, 31, 23, 59, 59) } }
        const entries = await p.hkdRevenueEntry.findMany({ where, orderBy: { date: 'asc' } })
        const summary = entries.reduce((a: any, e: any) => ({ tongDoanhThu: a.tongDoanhThu + e.doanhThu, tongChietKhau: a.tongChietKhau + e.chietKhau, tongThueGTGT: a.tongThueGTGT + e.thueGTGT, tongDoanhThuThuan: a.tongDoanhThuThuan + e.doanhThuThuan, tongThu: a.tongThu + e.doanhThuThuan }), { tongDoanhThu: 0, tongChietKhau: 0, tongThueGTGT: 0, tongDoanhThuThuan: 0, tongThu: 0 })
        const rows = entries.map((e: any, i: number) => ({ stt: i + 1, id: e.id, ngay: new Date(e.date).toLocaleDateString('vi-VN'), soChungTu: e.soChungTu || `HKD-${String(i + 1).padStart(4, '0')}`, dienGiai: e.dienGiai, soHoaDonVAT: '', doanhThuChuaThue: e.doanhThu, chietKhau: e.chietKhau, thueGTGT: e.thueGTGT, doanhThuThuan: e.doanhThuThuan, tongThu: e.doanhThuThuan, phuongThucTT: e.phuongThucTT, ghiChu: e.ghiChu || '', tncnUocTinh: e.tncnUocTinh }))
        res.json({ success: true, data: { rows, summary } })
    } catch (err) { console.error('HKD revenue GET:', err); res.status(500).json({ success: false, error: 'Server error' }) }
})

// POST /api/tax/hkd-revenue
router.post('/hkd-revenue', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const p = req.storePrisma! as any
        const { date, soChungTu, dienGiai, doanhThu, chietKhau, thueGTGT, phuongThucTT, ghiChu } = req.body
        if (!dienGiai?.trim()) return res.status(400).json({ success: false, error: 'Dien giai la bat buoc' })
        const dt = Number(doanhThu) || 0, ck = Number(chietKhau) || 0, vat = Number(thueGTGT) || 0
        const thuThuan = dt - ck, tncn = Math.round(dt * 0.005)
        const branchId = getBranchId(req as any)
        const entry = await p.hkdRevenueEntry.create({ data: { date: date ? new Date(date) : new Date(), soChungTu: soChungTu || null, dienGiai, doanhThu: dt, chietKhau: ck, thueGTGT: vat, doanhThuThuan: thuThuan, tncnUocTinh: tncn, phuongThucTT: phuongThucTT || 'Tiền mặt', ghiChu: ghiChu || null, branchId: branchId || null } })
        res.status(201).json({ success: true, data: entry })
    } catch (err) { console.error('HKD revenue POST:', err); res.status(500).json({ success: false, error: 'Server error' }) }
})

// PUT /api/tax/hkd-revenue/:id
router.put('/hkd-revenue/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const p = req.storePrisma! as any
        const { date, soChungTu, dienGiai, doanhThu, chietKhau, thueGTGT, phuongThucTT, ghiChu } = req.body
        const dt = Number(doanhThu) || 0, ck = Number(chietKhau) || 0, vat = Number(thueGTGT) || 0
        const thuThuan = dt - ck, tncn = Math.round(dt * 0.005)
        const entry = await p.hkdRevenueEntry.update({ where: { id: req.params.id }, data: { ...(date && { date: new Date(date) }), ...(soChungTu !== undefined && { soChungTu }), ...(dienGiai && { dienGiai }), doanhThu: dt, chietKhau: ck, thueGTGT: vat, doanhThuThuan: thuThuan, tncnUocTinh: tncn, ...(phuongThucTT && { phuongThucTT }), ...(ghiChu !== undefined && { ghiChu }) } })
        res.json({ success: true, data: entry })
    } catch (err) { console.error('HKD revenue PUT:', err); res.status(500).json({ success: false, error: 'Server error' }) }
})

// DELETE /api/tax/hkd-revenue/:id
router.delete('/hkd-revenue/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const p = req.storePrisma! as any
        await p.hkdRevenueEntry.delete({ where: { id: req.params.id } })
        res.json({ success: true })
    } catch (err) { console.error('HKD revenue DELETE:', err); res.status(500).json({ success: false, error: 'Server error' }) }
})
// PUT /api/tax/:id
router.put('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { name, rate, description, isDefault, status } = req.body
        if (isDefault) await prisma.taxConfig.updateMany({ data: { isDefault: false } })
        const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id
        const data = await prisma.taxConfig.update({ where: { id }, data: { ...(name && { name }), ...(rate !== undefined && { rate: Number(rate) }), ...(description !== undefined && { description }), ...(isDefault !== undefined && { isDefault }), ...(status && { status }) } })
        res.json({ success: true, data })
    } catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// Các route DELETE 1 đoạn có TÊN CỐ ĐỊNH khai báo ở dưới file — `/:id` đăng ký
// trước nên trước đây NUỐT hết (xoá phí sàn/đối soát/bút toán tự động luôn trả 500
// và không xoá gì). Gặp các tên này thì next() cho Express chạy tiếp xuống route thật.
const TAX_LITERAL_DELETE = new Set(['platform-fee-invoice', 'platform-settlement', 'auto-journal'])

// DELETE /api/tax/:id
router.delete('/:id', authMiddleware, async (req: AuthRequest, res: Response, next) => {
    const id0 = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id
    if (TAX_LITERAL_DELETE.has(String(id0))) return next()
    try {
        const prisma = req.storePrisma!
        const id = id0
        await prisma.taxConfig.delete({ where: { id } }); res.json({ success: true })
    } catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// ═══════════════════════════════════════════════════════════════════════════════
//  REVENUE CHECK & INVOICE LISTING
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/tax/revenue-check?year=2026
router.get('/revenue-check', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const year = Number(req.query.year) || new Date().getFullYear()
        const startDate = new Date(year, 0, 1)
        const endDate = new Date(year, 11, 31, 23, 59, 59, 999)

        const transactions = await prisma.transaction.findMany({
            where: { status: { in: ['completed', 'partial'] }, createdAt: { gte: startDate, lte: endDate } },
            select: { total: true },
        })
        const totalRevenue = transactions.reduce((s, t) => s + (t.total || 0), 0)
        /* 500.000.000 KHONG phai nguong chiu thue cua ho kinh doanh — do la moc
         * bac le phi mon bai cao nhat. Nguong that: 100 trieu/nam (TT 40/2021),
         * nang len 200 trieu/nam tu 01/01/2026 (Luat Thue GTGT 48/2024). */
        const threshold = nguongChiuThueHKD(year)
        res.json({
            success: true,
            data: {
                totalRevenue, threshold,
                isAboveThreshold: totalRevenue >= threshold,
                year,
                canCu: year >= 2026
                    ? 'Luat Thue GTGT 48/2024/QH15 — 200 trieu/nam tu 01/01/2026'
                    : 'Thong tu 40/2021/TT-BTC — 100 trieu/nam',
            },
        })
    } catch (err) {
        console.error('GET /revenue-check error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// GET /api/tax/invoices?year=2026&month=2&vatOnly=true
router.get('/invoices', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const year = Number(req.query.year) || new Date().getFullYear()
        const month = req.query.month ? Number(req.query.month) : undefined
        const vatOnly = req.query.vatOnly === 'true'

        let startDate: Date, endDate: Date
        if (month) {
            startDate = new Date(year, month - 1, 1)
            endDate = new Date(year, month, 0, 23, 59, 59, 999)
        } else {
            startDate = new Date(year, 0, 1)
            endDate = new Date(year, 11, 31, 23, 59, 59, 999)
        }

        const where: any = {
            status: { in: ['completed', 'partial'] },
            createdAt: { gte: startDate, lte: endDate },
        }
        if (vatOnly) {
            where.vatStatus = 'issued'
        }

        const transactions = await prisma.transaction.findMany({
            where,
            select: {
                id: true, receiptNumber: true, customerName: true, customerPhone: true,
                subtotal: true, tax: true, total: true, discount: true,
                vatInvoiceNumber: true, vatIssuedAt: true, vatStatus: true,
                createdAt: true, transactionDate: true,
            },
            orderBy: { createdAt: 'desc' },
        })

        const summary = {
            count: transactions.length,
            totalRevenue: transactions.reduce((s, t) => s + (t.total || 0), 0),
            totalTax: transactions.reduce((s, t) => s + (t.tax || 0), 0),
            totalSubtotal: transactions.reduce((s, t) => s + (t.subtotal || 0), 0),
        }

        res.json({ success: true, data: transactions, summary })
    } catch (err) {
        console.error('GET /invoices error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ═══════════════════════════════════════════════════════════════════════════════
//  TAX DECLARATIONS (01/GTGT + 01/CNKD)
// ═══════════════════════════════════════════════════════════════════════════════

// ── Helper: get date range for period ───────────────────────────────────────
function getPeriodDateRange(periodType: string, year: number, month?: number, quarter?: number) {
    let startDate: Date, endDate: Date
    if (periodType === 'quarter' && quarter) {
        const startMonth = (quarter - 1) * 3 // 0-indexed
        startDate = new Date(year, startMonth, 1)
        endDate = new Date(year, startMonth + 3, 0, 23, 59, 59, 999)
    } else {
        const m = (month || 1) - 1 // 0-indexed
        startDate = new Date(year, m, 1)
        endDate = new Date(year, m + 1, 0, 23, 59, 59, 999)
    }
    return { startDate, endDate }
}

// ── Helper: calculate 01/GTGT data from transactions & imports ──────────────
async function calculate01GTGT(prisma: any, req: any, periodType: string, year: number, month?: number, quarter?: number) {
    const { startDate, endDate } = getPeriodDateRange(periodType, year, month, quarter)

    const transactions = await prisma.transaction.findMany({
        where: { status: { in: ['completed', 'partial'] }, createdAt: { gte: startDate, lte: endDate } },
        select: { subtotal: true, tax: true, total: true, discount: true, discountType: true },
    })
    const imports = await prisma.importReceipt.findMany({
        where: { status: 'completed', createdAt: { gte: startDate, lte: endDate } },
        select: { totalCost: true, vatAmount: true, hasVatInvoice: true },
    })
    // Chi phí có hóa đơn cũng phát sinh thuế GTGT đầu vào được khấu trừ
    const chiPhiKy = await prisma.expense.findMany({
        where: { date: { gte: startDate, lte: endDate } },
        select: { amount: true, vatAmount: true, invoiceNo: true, status: true },
    }).catch(() => [])
    const taxConfigs = await prisma.taxConfig.findMany({ where: { ...getBranchFilter(req as any), status: 'active' } })
    const defaultRate = taxConfigs.find((t: any) => t.isDefault)?.rate ?? 10

    /* Doanh thu kê khai phải là doanh thu THUẦN — trừ giảm giá.
     *
     * Bản trước lấy thẳng `subtotal` (giá trước giảm giá), nên với cửa hàng có
     * giảm giá thì chỉ tiêu [29] luôn CAO hơn doanh thu trên sổ đúng bằng tổng
     * giảm giá (sổ ghi 511 = subtotal và 521 = giảm giá, doanh thu thuần là hiệu
     * hai bên). Hệ quả kép: tờ khai khai vống doanh thu, và phép soát "sổ lệch
     * tờ khai" kêu mỗi kỳ khiến kế toán đi tìm một sai sót không tồn tại.
     *
     * `discount` có thể là SỐ TIỀN hoặc PHẦN TRĂM tùy `discountType`. */
    const tienGiamGia = (t: any) => String(t.discountType || '') === 'percent'
        ? Math.round((t.subtotal || 0) * (t.discount || 0) / 100)
        : Math.round(t.discount || 0)
    const totalSalesSubtotal = transactions.reduce(
        (s: number, t: any) => s + (t.subtotal || 0) - tienGiamGia(t), 0)
    const totalSalesTax = transactions.reduce((s: number, t: any) => s + (t.tax || 0), 0)
    let ct21 = 0, ct22 = 0, ct23 = 0, ct24 = 0, ct25 = 0, ct26 = 0, ct27 = 0, ct28 = 0
    let nguonDoanhThu = 'phiếu bán hàng'

    /* TÁCH DOANH THU THEO TỪNG THUẾ SUẤT.
     *
     * Bản trước dồn TOÀN BỘ doanh thu vào đúng một dòng, chọn theo thuế suất mặc
     * định của cửa hàng. Cửa hàng bán lẫn hàng 10% với hàng 5% hay hàng không
     * chịu thuế (rau, thịt tươi) thì tờ khai sai cả cơ cấu lẫn số thuế.
     *
     * Dòng hóa đơn điện tử có sẵn `vatRate` từng dòng — và đó mới là số CƠ QUAN
     * THUẾ nhìn thấy, vì hóa đơn đã lên hệ thống của họ. Có hóa đơn thì lấy hóa
     * đơn làm gốc; chưa dùng hóa đơn điện tử thì mới lùi về cách cũ. */
    const dongHoaDon: any[] = await prisma.eInvoiceItem.findMany({
        where: {
            eInvoice: {
                invoiceDate: {
                    gte: startDate.toISOString().slice(0, 10),
                    lte: endDate.toISOString().slice(0, 10),
                },
                status: { in: ['SIGNED', 'SENT'] },
            },
        },
        select: { vatRate: true, vatAmount: true, amount: true, eInvoice: { select: { invoiceType: true } } },
    }).catch(() => [])

    if (dongHoaDon.length > 0) {
        nguonDoanhThu = 'hóa đơn điện tử đã phát hành'
        for (const d of dongHoaDon) {
            // Hóa đơn trả lại / điều chỉnh giảm phải TRỪ khỏi doanh thu kỳ
            const dau = d.eInvoice?.invoiceType === 'RETURN' ? -1 : 1
            const tien = dau * (d.amount || 0)
            const thue = dau * (d.vatAmount || 0)
            const r = Number(d.vatRate) || 0
            if (r === 5) { ct23 += tien; ct24 += thue }
            else if (r === 8) { ct25 += tien; ct26 += thue }
            else if (r === 10) { ct27 += tien; ct28 += thue }
            else {
                /* vatRate = 0 có thể là "không chịu thuế" [21] hoặc "thuế suất 0%"
                 * [22] — dữ liệu hóa đơn không phân biệt được. Với bán lẻ, hàng
                 * không chịu thuế (nông sản tươi) phổ biến hơn nhiều so với 0%
                 * (chỉ dành cho hàng xuất khẩu), nên xếp vào [21]. Hai chỉ tiêu
                 * này đều sửa tay được trên màn hình tờ khai. */
                ct21 += tien
            }
        }
        /* BÁN KHÔNG XUẤT HÓA ĐƠN VẪN PHẢI KÊ KHAI.
         *
         * Nhiều cửa hàng chỉ xuất hóa đơn khi khách yêu cầu. Lấy hóa đơn làm gốc
         * mà bỏ qua phần còn lại là KHAI THIẾU doanh thu — hướng sai nguy hiểm
         * hơn hẳn khai thừa, vì bị truy thu kèm phạt 20% và tiền chậm nộp. Nghĩa
         * vụ thuế phát sinh khi bán hàng, không phải khi xuất hóa đơn (Điều 90
         * Luật Quản lý thuế còn buộc lập hóa đơn cả khi khách không lấy).
         *
         * Nên: hóa đơn cho phần tách thuế suất, cộng thêm phần bán chưa có hóa
         * đơn vào dòng thuế suất mặc định của cửa hàng. */
        const dtHoaDon = ct21 + ct22 + ct23 + ct25 + ct27
        const conThieu = Math.round(totalSalesSubtotal - dtHoaDon)
        if (conThieu > 1000) {
            const thueThieu = Math.round(conThieu * defaultRate / 100)
            if (defaultRate === 0) ct22 += conThieu
            else if (defaultRate === 5) { ct23 += conThieu; ct24 += thueThieu }
            else if (defaultRate === 8) { ct25 += conThieu; ct26 += thueThieu }
            else { ct27 += conThieu; ct28 += thueThieu }
            nguonDoanhThu = `hóa đơn điện tử đã phát hành + ${conThieu.toLocaleString('vi-VN')}đ doanh thu chưa xuất hóa đơn (tính theo thuế suất ${defaultRate}%)`
        }

        ct21 = Math.round(ct21); ct22 = Math.round(ct22)
        ct23 = Math.round(ct23); ct24 = Math.round(ct24)
        ct25 = Math.round(ct25); ct26 = Math.round(ct26)
        ct27 = Math.round(ct27); ct28 = Math.round(ct28)
    } else if (defaultRate === 0) { ct22 = totalSalesSubtotal }
    else if (defaultRate === 5) { ct23 = totalSalesSubtotal; ct24 = totalSalesTax }
    else if (defaultRate === 8) { ct25 = totalSalesSubtotal; ct26 = totalSalesTax }
    else { ct27 = totalSalesSubtotal; ct28 = totalSalesTax }

    const ct29 = ct21 + ct22 + ct23 + ct25 + ct27
    const ct30 = ct24 + ct26 + ct28

    /* THUẾ GTGT ĐẦU VÀO PHẢI LẤY SỐ THẬT TRÊN HÓA ĐƠN.
     *
     * Bản trước tính: giá trị mua vào = tổng giá nhập, thuế đầu vào = tổng giá
     * nhập × 10%. Ba chỗ sai cùng lúc:
     *   1. Nhân với thuế suất BÁN RA của cửa hàng, không phải thuế suất ghi trên
     *      hóa đơn mua vào (hàng 5%, 8%, không chịu thuế đều bị nhân 10%).
     *   2. Không nhìn `hasVatInvoice` — lô hàng mua KHÔNG có hóa đơn cũng được
     *      tính khấu trừ, tức là kê khai khấu trừ số thuế không tồn tại.
     *   3. `totalCost` đã BAO GỒM thuế, nhân tiếp 10% là cộng thuế trên thuế.
     *
     * Đây không phải sai lệch hiển thị: khai khấu trừ thừa là nộp thiếu thuế,
     * và khi cơ quan thuế đối chiếu dữ liệu hóa đơn toàn quốc thì ra ngay.
     *
     * Nay cộng đúng `vatAmount` của những phiếu CÓ hóa đơn, và gộp cả chi phí có
     * hóa đơn (điện, nước, thuê mặt bằng…) — chúng cũng là thuế đầu vào được
     * khấu trừ mà bản trước bỏ sót hoàn toàn. */
    const nhapCoHoaDon = imports.filter((i: any) => i.hasVatInvoice)
    const vatNhap = nhapCoHoaDon.reduce((s: number, i: any) => s + (i.vatAmount || 0), 0)
    const giaTriNhap = nhapCoHoaDon.reduce(
        (s: number, i: any) => s + Math.max(0, (i.totalCost || 0) - (i.vatAmount || 0)), 0)

    const chiCoHoaDon = (chiPhiKy || []).filter((c: any) => c.invoiceNo && c.status !== 'cancelled')
    const vatChi = chiCoHoaDon.reduce((s: number, c: any) => s + (c.vatAmount || 0), 0)
    const giaTriChi = chiCoHoaDon.reduce(
        (s: number, c: any) => s + Math.max(0, (c.amount || 0) - (c.vatAmount || 0)), 0)

    const ct31 = Math.round(giaTriNhap + giaTriChi)
    const ct32 = Math.round(vatNhap + vatChi)
    const ct33 = ct32
    const ct34 = 0
    const ct35 = ct30 - ct33 - ct34
    const ct36 = 0, ct37 = 0
    const ct38 = ct35 > 0 ? ct35 + ct36 - ct37 : 0
    const ct39 = ct35 < 0 ? Math.abs(ct35) - ct36 + ct37 : 0
    const ct40a = 0
    const ct40b = ct39 - ct40a

    return {
        ct21, ct22, ct23, ct24, ct25, ct26, ct27, ct28, ct29, ct30,
        ct31, ct32, ct33, ct34, ct35, ct36, ct37, ct38, ct39, ct40a, ct40b,
        /* Nói rõ số liệu dựng từ đâu — kế toán cần biết mình đang đối chiếu với
         * hóa đơn hay với phiếu bán trước khi ký nộp. Trường này không phải chỉ
         * tiêu của tờ khai nên nơi lưu phải lọc bỏ. */
        nguonDoanhThu,
    }
}

// ── Helper: calculate 01/CNKD data (Household / Individual business) ────────
/**
 * Doanh thu LŨY KẾ TỪ ĐẦU NĂM tới hết ngày `denNgay` — dùng để xét ngưỡng chịu
 * thuế của hộ kinh doanh.
 *
 * Tách riêng vì hai nơi lập tờ khai 01/CNKD (cả kỳ và theo giao dịch được chọn)
 * đều cần; để mỗi nơi tự tính thì sớm muộn hai bên ra hai kết quả khác nhau —
 * mà đây là con số quyết định hộ có phải nộp thuế hay không.
 */
async function doanhThuLuyKeNam(prisma: any, year: number, denNgay: Date): Promise<number> {
    const agg = await prisma.transaction.aggregate({
        where: {
            status: { in: ['completed', 'partial'] },
            createdAt: { gte: new Date(year, 0, 1), lte: denNgay },
        },
        _sum: { total: true },
    }).catch(() => null)
    return Number(agg?._sum?.total || 0)
}

async function calculate01CNKD(prisma: any, periodType: string, year: number, month?: number, quarter?: number) {
    const { startDate, endDate } = getPeriodDateRange(periodType, year, month, quarter)

    // Total revenue from completed transactions
    const transactions = await prisma.transaction.findMany({
        where: { status: { in: ['completed', 'partial'] }, createdAt: { gte: startDate, lte: endDate } },
        select: { total: true },
    })
    const cnkdRevenue = transactions.reduce((s: number, t: any) => s + (t.total || 0), 0)

    // VAT rate for retail/trade: 1% (Thông tư 40/2021)
    const cnkdVatRate = 1
    // PIT rate for retail/trade: 0.5%
    const cnkdPitRate = 0.5
    const cnkdThreshold = nguongChiuThueHKD(year)

    /* NGƯỠNG CHỊU THUẾ XÉT THEO DOANH THU THẬT CỦA NĂM, KHÔNG SUY RA TỪ MỘT KỲ.
     *
     * Bản trước lấy doanh thu kỳ nhân 12 (hoặc nhân 4 với quý) rồi so ngưỡng.
     * Cách đó quyết định SAI ở cả hai hướng và hướng nào cũng tốn tiền thật:
     *   - tháng Tết bán gấp ba ngày thường bị quy đổi thành cả năm vượt ngưỡng →
     *     tính thuế cho hộ đáng lẽ được miễn;
     *   - tháng ế bị quy đổi thành dưới ngưỡng → bỏ thuế của hộ đã vượt, tới cuối
     *     năm bị truy thu kèm tiền chậm nộp.
     *
     * Luật xét theo doanh thu của NĂM DƯƠNG LỊCH (Thông tư 40/2021; ngưỡng nâng
     * lên 200 triệu từ 01/01/2026 theo Luật Thuế GTGT 48/2024). Nên cộng doanh
     * thu thật từ đầu năm tới hết kỳ đang khai — số đã biết chắc, không dự báo. */
    const doanhThuNam = (await doanhThuLuyKeNam(prisma, year, endDate)) || cnkdRevenue

    const isAboveThreshold = doanhThuNam > cnkdThreshold
    const cnkdVatAmount = isAboveThreshold ? cnkdRevenue * (cnkdVatRate / 100) : 0
    const cnkdPitAmount = isAboveThreshold ? cnkdRevenue * (cnkdPitRate / 100) : 0
    const cnkdTotalTax = cnkdVatAmount + cnkdPitAmount

    return {
        cnkdRevenue, cnkdVatRate, cnkdVatAmount, cnkdPitRate, cnkdPitAmount, cnkdTotalTax, cnkdThreshold,
        nguonDoanhThu: isAboveThreshold
            ? `Doanh thu lũy kế từ đầu năm ${Math.round(doanhThuNam).toLocaleString('vi-VN')}đ đã vượt ngưỡng ${Math.round(cnkdThreshold).toLocaleString('vi-VN')}đ/năm — kỳ này phải nộp thuế`
            : `Doanh thu lũy kế từ đầu năm ${Math.round(doanhThuNam).toLocaleString('vi-VN')}đ, chưa vượt ngưỡng ${Math.round(cnkdThreshold).toLocaleString('vi-VN')}đ/năm — kỳ này chưa phát sinh thuế, nhưng vượt ngưỡng vào tháng nào thì từ đó phải nộp`,
    }
}

// ── XML builder helpers ─────────────────────────────────────────────────────
function escXml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

function build01GTGT_Xml(decl: any): string {
    const pad2 = (n: number) => String(n).padStart(2, '0')
    const now = new Date()
    const ngayLap = `${pad2(now.getDate())}/${pad2(now.getMonth() + 1)}/${now.getFullYear()}`
    const fmtNum = (v: number) => Math.round(v)

    return `<?xml version="1.0" encoding="UTF-8"?>
<HSoThueDTu>
  <HSoKhaiThue>
    <TTChung>
      <ma_nd>01/GTGT</ma_nd>
      <ten_nd>TỜ KHAI THUẾ GIÁ TRỊ GIA TĂNG (Mẫu số 01/GTGT)</ten_nd>
      <mso_thue>${escXml(decl.taxCode)}</mso_thue>
      <ten_NNT>${escXml(decl.companyName)}</ten_NNT>
      <dchi_NNT>${escXml(decl.companyAddress || '')}</dchi_NNT>
      <ky_khai>${escXml(decl.period)}</ky_khai>
      <ky_khai_loai>${decl.periodType === 'month' ? 'T' : 'Q'}</ky_khai_loai>
      <ky_khai_nam>${decl.year}</ky_khai_nam>
      ${decl.month ? `<ky_khai_thang>${pad2(decl.month)}</ky_khai_thang>` : ''}
      ${decl.quarter ? `<ky_khai_quy>${decl.quarter}</ky_khai_quy>` : ''}
      <ngay_lap>${ngayLap}</ngay_lap>
      <lan_nop>1</lan_nop>
      <bo_sung>0</bo_sung>
    </TTChung>
    <CTieuTKhai>
      <ct21>${fmtNum(decl.ct21)}</ct21>
      <ct22>${fmtNum(decl.ct22)}</ct22>
      <ct23>${fmtNum(decl.ct23)}</ct23>
      <ct24>${fmtNum(decl.ct24)}</ct24>
      <ct25>${fmtNum(decl.ct25)}</ct25>
      <ct26>${fmtNum(decl.ct26)}</ct26>
      <ct27>${fmtNum(decl.ct27)}</ct27>
      <ct28>${fmtNum(decl.ct28)}</ct28>
      <ct29>${fmtNum(decl.ct29)}</ct29>
      <ct30>${fmtNum(decl.ct30)}</ct30>
      <ct31>${fmtNum(decl.ct31)}</ct31>
      <ct32>${fmtNum(decl.ct32)}</ct32>
      <ct33>${fmtNum(decl.ct33)}</ct33>
      <ct34>${fmtNum(decl.ct34)}</ct34>
      <ct35>${fmtNum(decl.ct35)}</ct35>
      <ct36>${fmtNum(decl.ct36)}</ct36>
      <ct37>${fmtNum(decl.ct37)}</ct37>
      <ct38>${fmtNum(decl.ct38)}</ct38>
      <ct39>${fmtNum(decl.ct39)}</ct39>
      <ct40a>${fmtNum(decl.ct40a)}</ct40a>
      <ct40b>${fmtNum(decl.ct40b)}</ct40b>
    </CTieuTKhai>
  </HSoKhaiThue>
</HSoThueDTu>`
}

function build01CNKD_Xml(decl: any): string {
    const pad2 = (n: number) => String(n).padStart(2, '0')
    const now = new Date()
    const ngayLap = `${pad2(now.getDate())}/${pad2(now.getMonth() + 1)}/${now.getFullYear()}`
    const fmtNum = (v: number) => Math.round(v)

    return `<?xml version="1.0" encoding="UTF-8"?>
<HSoThueDTu>
  <HSoKhaiThue>
    <TTChung>
      <ma_nd>01/CNKD</ma_nd>
      <ten_nd>TỜ KHAI THUẾ ĐỐI VỚI CÁ NHÂN KINH DOANH (Mẫu số 01/CNKD)</ten_nd>
      <mso_thue>${escXml(decl.taxCode)}</mso_thue>
      <ten_NNT>${escXml(decl.companyName)}</ten_NNT>
      <dchi_NNT>${escXml(decl.companyAddress || '')}</dchi_NNT>
      <loai_hinh>${decl.businessType === 'household' ? 'HKD' : 'CNKD'}</loai_hinh>
      <ky_khai>${escXml(decl.period)}</ky_khai>
      <ky_khai_loai>${decl.periodType === 'month' ? 'T' : 'Q'}</ky_khai_loai>
      <ky_khai_nam>${decl.year}</ky_khai_nam>
      ${decl.month ? `<ky_khai_thang>${pad2(decl.month)}</ky_khai_thang>` : ''}
      ${decl.quarter ? `<ky_khai_quy>${decl.quarter}</ky_khai_quy>` : ''}
      <ngay_lap>${ngayLap}</ngay_lap>
      <lan_nop>1</lan_nop>
      <bo_sung>0</bo_sung>
    </TTChung>
    <CTieuTKhai>
      <nganh_nghe>Ban le</nganh_nghe>
      <doanh_thu>${fmtNum(decl.cnkdRevenue)}</doanh_thu>
      <nguong_chiu_thue>${fmtNum(decl.cnkdThreshold)}</nguong_chiu_thue>
      <ty_le_thue_gtgt>${decl.cnkdVatRate}</ty_le_thue_gtgt>
      <thue_gtgt>${fmtNum(decl.cnkdVatAmount)}</thue_gtgt>
      <ty_le_thue_tncn>${decl.cnkdPitRate}</ty_le_thue_tncn>
      <thue_tncn>${fmtNum(decl.cnkdPitAmount)}</thue_tncn>
      <tong_thue>${fmtNum(decl.cnkdTotalTax)}</tong_thue>
    </CTieuTKhai>
  </HSoKhaiThue>
</HSoThueDTu>`
}

// ── GET /api/tax/declarations ───────────────────────────────────────────────
router.get('/declarations', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const data = await prisma.taxDeclaration.findMany({ orderBy: { createdAt: 'desc' } })
        res.json({ success: true, data })
    } catch (err) {
        console.error('GET /declarations error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ── POST /api/tax/declarations ──────────────────────────────────────────────
router.post('/declarations', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { periodType = 'month', taxCode, companyName, companyAddress, transactionIds, businessType: reqBusinessType } = req.body
        const year = Number(req.body.year)
        const month = req.body.month ? Number(req.body.month) : undefined
        const quarter = req.body.quarter ? Number(req.body.quarter) : undefined

        if (!year || !taxCode || !companyName) {
            return res.status(400).json({ success: false, error: 'year, taxCode, companyName required' })
        }

        // Check annual revenue (used as fallback suggestion only)
        const yearStart = new Date(year, 0, 1)
        const yearEnd = new Date(year, 11, 31, 23, 59, 59, 999)
        const allYearTx = await prisma.transaction.findMany({
            where: { status: { in: ['completed', 'partial'] }, createdAt: { gte: yearStart, lte: yearEnd } },
            select: { total: true },
        })
        const annualRevenue = allYearTx.reduce((s, t) => s + (t.total || 0), 0)

        /* Chọn mẫu tờ khai theo LOẠI HÌNH, không phải theo doanh thu.
         *
         * Bản trước đoán: doanh thu ≥ 500 triệu thì coi là doanh nghiệp. Đoán sai
         * là lập nhầm mẫu tờ khai — hộ kinh doanh doanh thu 600 triệu (rất phổ
         * biến) bị đẩy sang mẫu 01/GTGT của doanh nghiệp. Trong khi cửa hàng đã
         * khai loại hình trong cài đặt, cứ hỏi thẳng chỗ đó.
         *
         * Doanh thu chỉ dùng làm phương án cuối khi cài đặt cũng không có. */
        const cauHinhCh = await prisma.storeSettings.findFirst({
            select: { businessType: true },
        }).catch(() => null)
        const businessType = (reqBusinessType === 'company' || reqBusinessType === 'household')
            ? reqBusinessType
            : (cauHinhCh?.businessType === 'household' || cauHinhCh?.businessType === 'company')
                ? cauHinhCh.businessType
                : (annualRevenue >= 500000000 ? 'company' : 'household')
        const formType = businessType === 'company' ? '01_GTGT' : '01_CNKD'

        const period = periodType === 'quarter'
            ? `Q${quarter}/${year}`
            : `T${String(month).padStart(2, '0')}/${year}`

        console.log(`Creating declaration: form=${formType}, revenue=${annualRevenue}, period=${period}, selectedIds=${transactionIds?.length || 'all'}`)

        let calculated: any = {}

        if (transactionIds && transactionIds.length > 0) {
            // Calculate from selected transactions only
            const selectedTx = await prisma.transaction.findMany({
                where: { id: { in: transactionIds }, status: { in: ['completed', 'partial'] } },
                select: { subtotal: true, tax: true, total: true, discount: true, discountType: true },
            })

            if (formType === '01_GTGT') {
                const taxConfigs = await prisma.taxConfig.findMany({ where: { ...getBranchFilter(req as any), status: 'active' } })
                const defaultRate = taxConfigs.find(t => t.isDefault)?.rate ?? 10
                // Doanh thu kê khai là doanh thu THUẦN — trừ giảm giá, và `discount`
                // có thể là phần trăm tùy `discountType` (xem chú thích ở nhánh cả kỳ)
                const totalSubtotal = selectedTx.reduce((s, t: any) => s + (t.subtotal || 0)
                    - (String(t.discountType || '') === 'percent'
                        ? Math.round((t.subtotal || 0) * (t.discount || 0) / 100)
                        : Math.round(t.discount || 0)), 0)
                const totalTax = selectedTx.reduce((s, t) => s + (t.tax || 0), 0)
                let ct21 = 0, ct22 = 0, ct23 = 0, ct24 = 0, ct25 = 0, ct26 = 0, ct27 = 0, ct28 = 0
                if (defaultRate === 0) { ct22 = totalSubtotal }
                else if (defaultRate === 5) { ct23 = totalSubtotal; ct24 = totalTax }
                else if (defaultRate === 8) { ct25 = totalSubtotal; ct26 = totalTax }
                else { ct27 = totalSubtotal; ct28 = totalTax }
                const ct29 = ct21 + ct22 + ct23 + ct25 + ct27
                const ct30 = ct24 + ct26 + ct28

                /* Thuế GTGT đầu vào — lấy SỐ THẬT trên hóa đơn, giống nhánh tính
                 * cả kỳ. Bản trước ở đây nhân tổng giá nhập với thuế suất BÁN RA
                 * của cửa hàng và không nhìn `hasVatInvoice`, tức là kê khai khấu
                 * trừ cả số thuế không tồn tại; `totalCost` lại đã gồm thuế nên
                 * còn cộng thuế trên thuế. */
                const { startDate, endDate } = getPeriodDateRange(periodType, year, month, quarter)
                const imports = await prisma.importReceipt.findMany({
                    where: { status: 'completed', createdAt: { gte: startDate, lte: endDate } },
                    select: { totalCost: true, vatAmount: true, hasVatInvoice: true },
                })
                const chiKy = await prisma.expense.findMany({
                    where: { date: { gte: startDate, lte: endDate } },
                    select: { amount: true, vatAmount: true, invoiceNo: true, status: true },
                }).catch(() => [] as any[])

                const nhapCoHd = imports.filter((i: any) => i.hasVatInvoice)
                const chiCoHd = (chiKy as any[]).filter(c => c.invoiceNo && c.status !== 'cancelled')
                const ct31 = Math.round(
                    nhapCoHd.reduce((s: number, i: any) => s + Math.max(0, (i.totalCost || 0) - (i.vatAmount || 0)), 0)
                    + chiCoHd.reduce((s: number, c: any) => s + Math.max(0, (c.amount || 0) - (c.vatAmount || 0)), 0))
                const ct32 = Math.round(
                    nhapCoHd.reduce((s: number, i: any) => s + (i.vatAmount || 0), 0)
                    + chiCoHd.reduce((s: number, c: any) => s + (c.vatAmount || 0), 0))
                const ct33 = ct32
                const ct34 = 0, ct35 = ct30 - ct33 - ct34
                const ct36 = 0, ct37 = 0
                const ct38 = ct35 > 0 ? ct35 + ct36 - ct37 : 0
                const ct39 = ct35 < 0 ? Math.abs(ct35) - ct36 + ct37 : 0
                const ct40a = 0, ct40b = ct39 - ct40a
                calculated = { ct21, ct22, ct23, ct24, ct25, ct26, ct27, ct28, ct29, ct30, ct31, ct32, ct33, ct34, ct35, ct36, ct37, ct38, ct39, ct40a, ct40b }
            } else {
                const cnkdRevenue = selectedTx.reduce((s, t) => s + (t.total || 0), 0)
                const cnkdVatRate = 1, cnkdPitRate = 0.5
                const nguong = nguongChiuThueHKD(year)

                /* Nhánh này TRƯỚC ĐÂY tính thuế vô điều kiện, không xét ngưỡng —
                 * trong khi nhánh lập cả kỳ thì có xét. Hộ kinh doanh chưa tới
                 * ngưỡng mà chọn vài giao dịch để lập tờ khai là bị tính thuế
                 * không phải nộp. Dùng chung một phép xét cho cả hai nhánh. */
                const { endDate: cuoiKy } = getPeriodDateRange(periodType, year, month, quarter)
                const dtNam = (await doanhThuLuyKeNam(prisma, year, cuoiKy)) || cnkdRevenue
                const vuotNguong = dtNam > nguong

                const cnkdVatAmount = vuotNguong ? cnkdRevenue * (cnkdVatRate / 100) : 0
                const cnkdPitAmount = vuotNguong ? cnkdRevenue * (cnkdPitRate / 100) : 0
                const cnkdTotalTax = cnkdVatAmount + cnkdPitAmount
                calculated = {
                    cnkdRevenue, cnkdVatRate, cnkdVatAmount, cnkdPitRate, cnkdPitAmount,
                    cnkdTotalTax, cnkdThreshold: nguong,
                    nguonDoanhThu: `Giao dịch được chọn; ngưỡng xét theo doanh thu lũy kế từ đầu năm ${Math.round(dtNam).toLocaleString('vi-VN')}đ`,
                }
            }
        } else {
            // Fallback: calculate from all transactions in period
            if (formType === '01_GTGT') {
                calculated = await calculate01GTGT(prisma, req, periodType, year, month, quarter)
            } else {
                calculated = await calculate01CNKD(prisma, periodType, year, month, quarter)
            }
        }

        console.log('Calculated:', JSON.stringify(calculated))

        /* `nguonDoanhThu` là thông tin cho người đọc, KHÔNG phải cột của bảng —
         * để lẫn trong `...calculated` là Prisma báo "Unknown argument" và việc
         * lập tờ khai hỏng hẳn. Tách ra trước khi ghi, trả kèm ở response. */
        const { nguonDoanhThu, ...chiTieu } = calculated as any

        const data = await prisma.taxDeclaration.create({
            data: {
                formType,
                businessType,
                period, periodType, year,
                month: periodType === 'month' ? (month || null) : null,
                quarter: periodType === 'quarter' ? (quarter || null) : null,
                taxCode, companyName, companyAddress: companyAddress || null,
                ...chiTieu,
            },
        })

        res.status(201).json({ success: true, data: { ...data, nguonDoanhThu: nguonDoanhThu ?? null } })
    } catch (err: any) {
        console.error('POST /declarations error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// ── PUT /api/tax/declarations/:id ───────────────────────────────────────────
router.put('/declarations/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id
        const { status, notes, filedAt, ...fields } = req.body
        const updateData: any = {}
        if (status) updateData.status = status
        if (notes !== undefined) updateData.notes = notes
        if (filedAt) updateData.filedAt = new Date(filedAt)
        // Allow updating individual chỉ tiêu (for manual adjustments)
        const allowedFields = [
            'ct21', 'ct22', 'ct23', 'ct24', 'ct25', 'ct26', 'ct27', 'ct28',
            'ct31', 'ct32', 'ct33', 'ct34', 'ct36', 'ct37', 'ct40a',
            'cnkdRevenue', 'cnkdVatRate', 'cnkdPitRate',
        ]
        for (const f of allowedFields) {
            if (fields[f] !== undefined) updateData[f] = Number(fields[f])
        }
        // Auto-recalculate summaries if any ct field changed
        if (Object.keys(updateData).some(k => k.startsWith('ct'))) {
            const existing = await prisma.taxDeclaration.findUnique({ where: { id } })
            if (existing) {
                const merged = { ...existing, ...updateData }
                merged.ct29 = merged.ct21 + merged.ct22 + merged.ct23 + merged.ct25 + merged.ct27
                merged.ct30 = merged.ct24 + merged.ct26 + merged.ct28
                merged.ct35 = merged.ct30 - merged.ct33 - merged.ct34
                merged.ct38 = merged.ct35 > 0 ? merged.ct35 + merged.ct36 - merged.ct37 : 0
                merged.ct39 = merged.ct35 < 0 ? Math.abs(merged.ct35) - merged.ct36 + merged.ct37 : 0
                merged.ct40b = merged.ct39 - merged.ct40a
                updateData.ct29 = merged.ct29
                updateData.ct30 = merged.ct30
                updateData.ct35 = merged.ct35
                updateData.ct38 = merged.ct38
                updateData.ct39 = merged.ct39
                updateData.ct40b = merged.ct40b
            }
        }
        // Auto-recalculate CNKD if relevant fields changed
        if (Object.keys(updateData).some(k => k.startsWith('cnkd'))) {
            const existing = await prisma.taxDeclaration.findUnique({ where: { id } })
            if (existing) {
                const merged = { ...existing, ...updateData }
                merged.cnkdVatAmount = merged.cnkdRevenue * (merged.cnkdVatRate / 100)
                merged.cnkdPitAmount = merged.cnkdRevenue * (merged.cnkdPitRate / 100)
                merged.cnkdTotalTax = merged.cnkdVatAmount + merged.cnkdPitAmount
                updateData.cnkdVatAmount = merged.cnkdVatAmount
                updateData.cnkdPitAmount = merged.cnkdPitAmount
                updateData.cnkdTotalTax = merged.cnkdTotalTax
            }
        }

        const data = await prisma.taxDeclaration.update({ where: { id }, data: updateData })
        res.json({ success: true, data })
    } catch (err: any) {
        console.error('PUT /declarations/:id error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// ── DELETE /api/tax/declarations/:id ────────────────────────────────────────
router.delete('/declarations/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id
        await prisma.taxDeclaration.delete({ where: { id } })
        res.json({ success: true })
    } catch (err: any) {
        console.error('DELETE /declarations/:id error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// ── GET /api/tax/declarations/:id/xml ───────────────────────────────────────
router.get('/declarations/:id/xml', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id
        const decl = await prisma.taxDeclaration.findUnique({ where: { id } })
        if (!decl) return res.status(404).json({ success: false, error: 'Not found' })

        let xml: string
        if (decl.formType === '01_CNKD') {
            xml = build01CNKD_Xml(decl)
        } else {
            xml = build01GTGT_Xml(decl)
        }

        const filename = `ToKhai_${decl.formType}_${decl.period.replace('/', '-')}.xml`
        res.setHeader('Content-Type', 'application/xml; charset=utf-8')
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
        res.send(xml)
    } catch (err: any) {
        console.error('GET /declarations/:id/xml error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// --- VAT Amendments (To khai bo sung 01/GTGT - TT80/2021) ---------------------

const VAT_LINE_FIELDS = [
    'ct21', 'ct22', 'ct23', 'ct24', 'ct25', 'ct26', 'ct27', 'ct28',
    'ct29', 'ct30', 'ct31', 'ct32', 'ct33', 'ct34', 'ct35',
    'ct36', 'ct37', 'ct38', 'ct39', 'ct40a', 'ct40b',
] as const

function recalcVatTotals(d: Record<string, any>) {
    d.ct29 = (d.ct21 || 0) + (d.ct22 || 0) + (d.ct23 || 0) + (d.ct25 || 0) + (d.ct27 || 0)
    d.ct30 = (d.ct24 || 0) + (d.ct26 || 0) + (d.ct28 || 0)
    d.ct35 = (d.ct30 || 0) - (d.ct33 || 0) - (d.ct34 || 0)
    d.ct38 = d.ct35 > 0 ? d.ct35 + (d.ct36 || 0) - (d.ct37 || 0) : 0
    d.ct39 = d.ct35 < 0 ? Math.abs(d.ct35) - (d.ct36 || 0) + (d.ct37 || 0) : 0
    d.ct40b = (d.ct39 || 0) - (d.ct40a || 0)
    return d
}

function snapshotVatLines(decl: Record<string, any>): Record<string, number> {
    const snap: Record<string, number> = {}
    for (const f of VAT_LINE_FIELDS) snap[f] = Number(decl[f] || 0)
    return snap
}

function parseAmendmentNotes(raw: string | null | undefined): any {
    if (!raw) return {}
    try { return JSON.parse(raw) || {} } catch { return {} }
}

function buildVatDiff(originalSnap: Record<string, number>, amendment: Record<string, any>) {
    const diff: Array<{ field: string; originalValue: number; amendedValue: number; difference: number }> = []
    for (const f of VAT_LINE_FIELDS) {
        const originalValue = Number(originalSnap[f] || 0)
        const amendedValue = Number(amendment[f] || 0)
        if (originalValue !== amendedValue) {
            diff.push({ field: f, originalValue, amendedValue, difference: amendedValue - originalValue })
        }
    }
    return diff
}

// POST /api/tax/vat-amendment - create amendment for an existing VAT declaration
router.post('/vat-amendment', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { originalId, amendmentReason, fields } = req.body as {
            originalId?: string
            amendmentReason?: string
            fields?: Record<string, number | string>
        }

        if (!originalId) {
            return res.status(400).json({ success: false, error: 'originalId la bat buoc' })
        }
        if (!amendmentReason || !String(amendmentReason).trim()) {
            return res.status(400).json({ success: false, error: 'amendmentReason (ly do khai bo sung) la bat buoc' })
        }

        const original = await prisma.taxDeclaration.findUnique({ where: { id: originalId } })
        if (!original) {
            return res.status(404).json({ success: false, error: 'Khong tim thay to khai goc' })
        }
        if (original.formType !== '01_GTGT') {
            return res.status(400).json({ success: false, error: 'Chi ho tro khai bo sung cho to khai 01/GTGT' })
        }

        const prevCount = await (prisma.taxDeclaration as any).count({
            where: { formType: '01_GTGT_BS', originalId },
        })
        const amendmentNumber = prevCount + 1

        const amended: Record<string, any> = {}
        for (const f of VAT_LINE_FIELDS) amended[f] = Number((original as any)[f] || 0)
        if (fields && typeof fields === 'object') {
            for (const f of VAT_LINE_FIELDS) {
                const v = (fields as any)[f]
                if (v !== undefined && v !== null && v !== '') {
                    amended[f] = Number(v)
                }
            }
        }
        recalcVatTotals(amended)

        const originalSnapshot = snapshotVatLines(original as any)
        const notesPayload = JSON.stringify({
            amendmentNumber,
            amendmentReason,
            originalPeriod: original.period,
            originalSnapshot,
        })

        const amendmentPeriod = `${original.period}-BS${amendmentNumber}`

        const data = await prisma.taxDeclaration.create({
            data: {
                formType: '01_GTGT_BS',
                businessType: original.businessType,
                period: amendmentPeriod,
                periodType: original.periodType,
                year: original.year,
                month: original.month,
                quarter: original.quarter,
                taxCode: original.taxCode,
                companyName: original.companyName,
                companyAddress: original.companyAddress,
                ...amended,
                originalId: original.id,
                amendmentNumber,
                amendmentReason,
                notes: notesPayload,
                status: 'draft',
            } as any,
        })

        res.status(201).json({ success: true, data })
    } catch (err: any) {
        console.error('POST /vat-amendment error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// GET /api/tax/vat-amendment?year=&month= - list amendments for a period
router.get('/vat-amendment', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const where: any = { formType: '01_GTGT_BS' }
        if (req.query.year) where.year = Number(req.query.year)
        if (req.query.month) where.month = Number(req.query.month)
        if (req.query.quarter) where.quarter = Number(req.query.quarter)
        if (req.query.originalId) where.originalId = String(req.query.originalId)

        const rows = await prisma.taxDeclaration.findMany({
            where,
            orderBy: [{ year: 'desc' }, { month: 'desc' }, { amendmentNumber: 'desc' } as any],
        })
        res.json({ success: true, data: rows })
    } catch (err: any) {
        console.error('GET /vat-amendment error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// GET /api/tax/vat-amendment/:id - single amendment with diff vs original
router.get('/vat-amendment/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id

        const amendment = await prisma.taxDeclaration.findUnique({ where: { id } })
        if (!amendment || amendment.formType !== '01_GTGT_BS') {
            return res.status(404).json({ success: false, error: 'Khong tim thay to khai bo sung' })
        }

        const original = (amendment as any).originalId
            ? await prisma.taxDeclaration.findUnique({ where: { id: (amendment as any).originalId } })
            : null

        const notes = parseAmendmentNotes(amendment.notes)
        const originalSnap: Record<string, number> = notes.originalSnapshot
            || (original ? snapshotVatLines(original as any) : {})

        const diff = buildVatDiff(originalSnap, amendment as any)

        res.json({
            success: true,
            data: {
                amendment,
                original,
                originalSnapshot: originalSnap,
                amendmentNumber: (amendment as any).amendmentNumber,
                amendmentReason: (amendment as any).amendmentReason,
                diff,
            },
        })
    } catch (err: any) {
        console.error('GET /vat-amendment/:id error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// GET /api/tax/vat-amendment/:id/diff - field-by-field diff
router.get('/vat-amendment/:id/diff', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id

        const amendment = await prisma.taxDeclaration.findUnique({ where: { id } })
        if (!amendment || amendment.formType !== '01_GTGT_BS') {
            return res.status(404).json({ success: false, error: 'Khong tim thay to khai bo sung' })
        }

        const notes = parseAmendmentNotes(amendment.notes)
        let originalSnap: Record<string, number> = notes.originalSnapshot || {}
        if (!originalSnap || Object.keys(originalSnap).length === 0) {
            const original = (amendment as any).originalId
                ? await prisma.taxDeclaration.findUnique({ where: { id: (amendment as any).originalId } })
                : null
            originalSnap = original ? snapshotVatLines(original as any) : {}
        }

        const diff = buildVatDiff(originalSnap, amendment as any)
        res.json({
            success: true,
            data: {
                amendmentId: amendment.id,
                originalId: (amendment as any).originalId,
                diff,
            },
        })
    } catch (err: any) {
        console.error('GET /vat-amendment/:id/diff error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

/**
 * GET /api/tax/vat-amendment/:id/explanation?ngayNop=&daThanhTra=
 *   — bản giải trình 01-1/KHBS + tiền chậm nộp tự tính.
 *
 * Hệ thống đã lập được tờ khai bổ sung và so chênh lệch. Nhưng hai thứ người
 * khai hay quên rồi bị truy sau lại nằm ngoài đó: bản giải trình bắt buộc nộp
 * kèm (Điều 47 Luật QLT; TT 80/2021), và TIỀN CHẬM NỘP 0,03%/ngày mà người nộp
 * thuế phải TỰ tính tự nộp chứ không chờ cơ quan thuế ra thông báo (Điều 59).
 */
router.get('/vat-amendment/:id/explanation', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id

        const amendment = await prisma.taxDeclaration.findUnique({ where: { id } })
        if (!amendment || amendment.formType !== '01_GTGT_BS') {
            return res.status(404).json({ success: false, error: 'Khong tim thay to khai bo sung' })
        }

        const notes = parseAmendmentNotes(amendment.notes)
        let originalSnap: Record<string, number> = notes.originalSnapshot || {}
        if (!originalSnap || Object.keys(originalSnap).length === 0) {
            const original = (amendment as any).originalId
                ? await prisma.taxDeclaration.findUnique({ where: { id: (amendment as any).originalId } })
                : null
            originalSnap = original ? snapshotVatLines(original as any) : {}
        }

        // Ngày nộp mặc định là hôm nay theo giờ VN — lệch múi giờ là lệch cả ngày chậm nộp
        const ngayNop = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.ngayNop || ''))
            ? String(req.query.ngayNop)
            : new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10)

        const data = giaiTrinhKhaiBoSung(originalSnap, snapshotVatLines(amendment as any), {
            kyGoc: String((amendment as any).period || '').replace(/-BS\d*$/, ''),
            lanBoSung: Number((amendment as any).amendmentNumber || 1),
            // Cột amendmentReason trước, rồi mới tới bản chép trong notes — KHÔNG rơi
            // xuống notes thô, vì notes là JSON và sẽ đổ nguyên khối vào văn bản in.
            lyDo: String((amendment as any).amendmentReason || notes.amendmentReason || ''),
            tenDonVi: (amendment as any).companyName || undefined,
            maSoThue: (amendment as any).taxCode || undefined,
            ngayNop,
            daCoQuyetDinhThanhTra: String(req.query.daThanhTra || '') === 'true',
        })

        res.json({ success: true, data: { amendmentId: amendment.id, ...data } })
    } catch (err: any) {
        console.error('GET /vat-amendment/:id/explanation error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// POST /api/tax/vat-amendment/:id/submit - finalize an amendment
router.post('/vat-amendment/:id/submit', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id

        const amendment = await prisma.taxDeclaration.findUnique({ where: { id } })
        if (!amendment || amendment.formType !== '01_GTGT_BS') {
            return res.status(404).json({ success: false, error: 'Khong tim thay to khai bo sung' })
        }
        if (amendment.status === 'submitted' || amendment.status === 'filed') {
            return res.status(400).json({ success: false, error: 'To khai bo sung da duoc nop' })
        }

        const filedAt = new Date()
        const submitted = await prisma.taxDeclaration.update({
            where: { id },
            data: { status: 'submitted', filedAt },
        })

        // Link the original declaration: mark it as amended and record the latest
        // amendment id in its notes JSON so the UI can surface the history.
        const origId = (amendment as any).originalId
        if (origId) {
            const original = await prisma.taxDeclaration.findUnique({ where: { id: origId } })
            if (original) {
                const origNotes = parseAmendmentNotes(original.notes)
                const amendments: Array<{ id: string; amendmentNumber: number | null; filedAt: string }> =
                    Array.isArray(origNotes.amendments) ? origNotes.amendments : []
                amendments.push({
                    id: amendment.id,
                    amendmentNumber: (amendment as any).amendmentNumber || null,
                    filedAt: filedAt.toISOString(),
                })
                const merged = { ...origNotes, amendments, latestAmendmentId: amendment.id }
                await prisma.taxDeclaration.update({
                    where: { id: original.id },
                    data: { status: 'amended', notes: JSON.stringify(merged) },
                })
            }
        }

        res.json({ success: true, data: submitted })
    } catch (err: any) {
        console.error('POST /vat-amendment/:id/submit error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})


// ═══════════════════════════════════════════════════════════════════════════════
//  ACCOUNTING MODULE — Wave 1+2 Routes
// ═══════════════════════════════════════════════════════════════════════════════

// ── GET /api/tax/summary?year=2026 (Dashboard KPI — Enhanced) ───────────────
router.get('/summary', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const year = Number(req.query.year) || new Date().getFullYear()
        const start = new Date(year, 0, 1), end = new Date(year, 11, 31, 23, 59, 59, 999)
        const prevStart = new Date(year - 1, 0, 1), prevEnd = new Date(year - 1, 11, 31, 23, 59, 59, 999)

        // Current year data
        const [txs, expenses, prevTxs, prevExpenses, imports] = await Promise.all([
            prisma.transaction.findMany({ where: { status: { in: ['completed', 'partial'] }, createdAt: { gte: start, lte: end } }, select: { total: true, tax: true, subtotal: true, discount: true }, }),
            prisma.expense.findMany({ where: { date: { gte: start, lte: end } }, select: { amount: true } }),
            prisma.transaction.findMany({ where: { status: { in: ['completed', 'partial'] }, createdAt: { gte: prevStart, lte: prevEnd } }, select: { total: true } }).catch(() => []),
            prisma.expense.findMany({ where: { date: { gte: prevStart, lte: prevEnd } }, select: { amount: true } }).catch(() => []),
            prisma.importReceipt.findMany({ where: { status: { not: 'draft' }, createdAt: { gte: start, lte: end } }, select: { totalCost: true } }).catch(() => []),
        ])

        let journalEntries: any[] = []
        let prevJournalEntries: any[] = []
        try { journalEntries = await prisma.journalEntry.findMany({ where: { date: { gte: year + '-01-01', lte: year + '-12-31' } } }) } catch (_) { }
        try {
            prevJournalEntries = await prisma.journalEntry.findMany({
                where: { date: { gte: (year - 1) + '-01-01', lte: (year - 1) + '-12-31' }, OR: [{ creditAccount: { startsWith: '511' } }, { debitAccount: { startsWith: '511' } }] },
                select: { debitAccount: true, creditAccount: true, amount: true },
            })
        } catch (_) { }

        // Doanh thu & giá vốn lấy TỪ SỔ NHẬT KÝ (đồng nhất với Kết Quả Kinh Doanh B02):
        // DT = net credit TK 511, giá vốn = net debit TK 632. KHÔNG dùng Transaction
        // (thiếu doanh thu đơn online ghi thẳng sổ) hay ImportReceipt (tiền nhập hàng
        // ≠ giá vốn hàng bán). Fallback về cách cũ khi store chưa hạch toán sổ.
        const netCredit = (entries: any[], prefix: string) => entries.reduce((s: number, j: any) =>
            s + ((j.creditAccount?.startsWith(prefix) ? j.amount : 0) - (j.debitAccount?.startsWith(prefix) ? j.amount : 0)), 0)
        const netDebit = (entries: any[], prefix: string) => entries.reduce((s: number, j: any) =>
            s + ((j.debitAccount?.startsWith(prefix) ? j.amount : 0) - (j.creditAccount?.startsWith(prefix) ? j.amount : 0)), 0)

        const revFromJournal = netCredit(journalEntries, '511')
        const cogsFromJournal = netDebit(journalEntries, '632')
        const totalRevenue = revFromJournal > 0 ? revFromJournal : txs.reduce((s, t) => s + (t.subtotal || t.total || 0), 0)
        const totalCOGS = cogsFromJournal > 0 ? cogsFromJournal : imports.reduce((s: number, i: any) => s + (i.totalCost || 0), 0)
        const totalTax = txs.reduce((s, t) => s + (t.tax || 0), 0)
        const totalExpenses = expenses.reduce((s, e) => s + (e.amount || 0), 0)
        const grossProfit = totalRevenue - totalCOGS
        const netProfit = grossProfit - totalExpenses
        const totalDiscount = txs.reduce((s, t) => s + ((t as any).discount || 0), 0)

        // Previous year for trend comparison (cùng cơ sở với doanh thu kỳ này)
        const prevRevenue = revFromJournal > 0 ? netCredit(prevJournalEntries, '511') : prevTxs.reduce((s: number, t: any) => s + (t.total || 0), 0)
        const prevExpenseTotal = prevExpenses.reduce((s: number, e: any) => s + (e.amount || 0), 0)

        // Journal aggregates
        const jDebit = journalEntries.reduce((s, j) => s + j.amount, 0)
        const jCredit = jDebit  // double-entry: always balanced per entry

        // Monthly breakdown for chart
        const monthlyRevenue = Array.from({ length: 12 }, (_, m) => {
            const mTxs = txs.filter((t: any) => {
                // We don't have createdAt in select, use index-based estimation
                return true
            })
            return 0
        })

        res.json({
            success: true, data: {
                totalRevenue, totalTax, totalExpenses, totalCOGS, totalDiscount,
                grossProfit, netProfit,
                journalCount: journalEntries.length,
                totalDebit: jDebit, totalCredit: jCredit,
                isBalanced: true,
                txCount: txs.length,
                expenseCount: expenses.length,
                importCount: imports.length,
                // Trends (vs previous year)
                revenueTrend: prevRevenue > 0 ? ((totalRevenue - prevRevenue) / prevRevenue * 100) : null,
                expenseTrend: prevExpenseTotal > 0 ? ((totalExpenses - prevExpenseTotal) / prevExpenseTotal * 100) : null,
            }
        })
    } catch (err) { console.error('GET /summary error:', err); res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// ── JOURNAL ENTRIES CRUD ────────────────────────────────────────────────────

// GET /api/tax/journal-entries?year=2026&month=3
router.get('/journal-entries', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const year = Number(req.query.year) || new Date().getFullYear()
        const month = req.query.month ? Number(req.query.month) : undefined
        const dateGte = month ? `${year}-${String(month).padStart(2, '0')}-01` : `${year}-01-01`
        const dateEnd = month ? `${year}-${String(month).padStart(2, '0')}-31` : `${year}-12-31`
        const entries = await prisma.journalEntry.findMany({
            where: { date: { gte: dateGte, lte: dateEnd } },
            orderBy: { date: 'desc' },
        })
        const totalDebit = entries.reduce((s, e) => s + e.amount, 0)
        const totalCredit = totalDebit
        res.json({ success: true, data: entries, summary: { count: entries.length, totalDebit, totalCredit, isBalanced: true } })
    } catch (err) { console.error('GET /journal-entries error:', err); res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// POST /api/tax/journal-entries
router.post('/journal-entries', authMiddleware, enforcePeriodLock('date'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { date, description, debitAccount, debitAccountName, creditAccount, creditAccountName, amount, debitAmount, creditAmount, reference, referenceType, notes } = req.body
        if (!date || !description || !debitAccount || !creditAccount || (amount === undefined && debitAmount === undefined && creditAmount === undefined)) {
            return res.status(400).json({ success: false, error: 'Thiếu thông tin bắt buộc' })
        }

        // Resolve amounts: prefer explicit debit/credit, fall back to single amount
        const dAmt = Number(debitAmount ?? amount)
        const cAmt = Number(creditAmount ?? amount)

        // ─── Balance validation (Nguyên tắc kép: Tổng Nợ = Tổng Có) ──────────────
        if (!Number.isFinite(dAmt) || !Number.isFinite(cAmt) || dAmt <= 0 || cAmt <= 0) {
            return res.status(400).json({ success: false, error: 'Số tiền phải > 0' })
        }
        if (dAmt !== cAmt) {
            return res.status(400).json({
                success: false,
                error: `Bút toán chưa cân đối: Tổng Nợ (${dAmt.toLocaleString('vi-VN')}) ≠ Tổng Có (${cAmt.toLocaleString('vi-VN')})`,
            })
        }
        if (debitAccount === creditAccount) {
            return res.status(400).json({ success: false, error: 'TK Nợ và TK Có không được trùng nhau' })
        }

        const data = await prisma.journalEntry.create({
            data: {
                date, description, debitAccount, debitAccountName: debitAccountName || null,
                creditAccount, creditAccountName: creditAccountName || null,
                amount: dAmt, reference: reference || null,
                referenceType: referenceType || 'manual',
                notes: notes || null,
                branchId: (req as any).branchId || null, createdBy: (req as any).userId || null,
            }
        })
        res.status(201).json({ success: true, data })
    } catch (err) { console.error('POST /journal-entries error:', err); res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// PUT /api/tax/journal-entries/:id — kế toán chỉnh sửa bút toán (đổi TK Nợ/Có,
// số tiền, diễn giải, ngày). Áp dụng cho cả bút toán tự sinh lẫn nhập tay —
// chặn sửa trong kỳ đã khóa sổ (cả ngày cũ lẫn ngày mới), ghi audit log.
router.put('/journal-entries/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id
        const entry = await prisma.journalEntry.findUnique({ where: { id } })
        if (!entry) return res.status(404).json({ success: false, error: 'Không tìm thấy bút toán' })

        const { date, description, debitAccount, debitAccountName, creditAccount, creditAccountName, amount, notes } = req.body

        // Khóa sổ: chặn sửa chứng từ thuộc kỳ đã khóa (ngày hiện tại của bút toán
        // VÀ ngày mới nếu đổi ngày — không cho "kéo" chứng từ ra/vào kỳ khóa).
        const branchForLock = (req as any).branchId ?? req.user?.branchId ?? null
        try {
            await assertNotLocked(prisma, branchForLock, entry.date)
            if (date && date !== entry.date) await assertNotLocked(prisma, branchForLock, date)
        } catch (lockErr: any) {
            if (lockErr?.code === 'PERIOD_LOCKED') {
                return res.status(423).json({ success: false, code: 'PERIOD_LOCKED', lockDate: lockErr.lockDate, error: lockErr.message })
            }
            throw lockErr
        }

        // Merge + validate
        const newDebit = debitAccount !== undefined ? String(debitAccount).trim() : entry.debitAccount
        const newCredit = creditAccount !== undefined ? String(creditAccount).trim() : entry.creditAccount
        const newAmount = amount !== undefined ? Number(amount) : entry.amount
        if (!newDebit || !newCredit) {
            return res.status(400).json({ success: false, error: 'TK Nợ và TK Có không được để trống' })
        }
        if (newDebit === newCredit) {
            return res.status(400).json({ success: false, error: 'TK Nợ và TK Có không được trùng nhau' })
        }
        if (!Number.isFinite(newAmount) || newAmount <= 0) {
            return res.status(400).json({ success: false, error: 'Số tiền phải > 0' })
        }

        // Tên TK: ưu tiên client gửi, đổi mã TK thì tra lại danh mục, giữ tên cũ nếu không đổi
        const resolveName = (code: string, provided: any, prevCode: string, prevName: string | null) => {
            if (provided !== undefined && provided !== null && String(provided).trim()) return String(provided).trim()
            if (code !== prevCode) {
                const looked = accountName(code)
                return looked !== code ? looked : prevName // mã lạ (vd 131-SHOPEE): giữ tên cũ nếu có
            }
            return prevName
        }

        const updated = await prisma.journalEntry.update({
            where: { id },
            data: {
                ...(date !== undefined ? { date: String(date) } : {}),
                ...(description !== undefined ? { description: String(description) } : {}),
                debitAccount: newDebit,
                debitAccountName: resolveName(newDebit, debitAccountName, entry.debitAccount, entry.debitAccountName),
                creditAccount: newCredit,
                creditAccountName: resolveName(newCredit, creditAccountName, entry.creditAccount, entry.creditAccountName),
                amount: newAmount,
                ...(notes !== undefined ? { notes: notes || null } : {}),
            },
        })

        // Audit log (best-effort) — lưu giá trị trước/sau để truy vết điều chỉnh
        try {
            await prisma.auditLog.create({
                data: {
                    userId: req.user?.userId,
                    userName: req.user?.email || 'system',
                    action: 'edit_journal_entry',
                    entity: 'JournalEntry',
                    entityId: id,
                    details: JSON.stringify({
                        before: { date: entry.date, debitAccount: entry.debitAccount, creditAccount: entry.creditAccount, amount: entry.amount, description: entry.description },
                        after: { date: updated.date, debitAccount: updated.debitAccount, creditAccount: updated.creditAccount, amount: updated.amount, description: updated.description },
                    }),
                },
            })
        } catch { }

        res.json({ success: true, data: updated })
    } catch (err) { console.error('PUT /journal-entries error:', err); res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// DELETE /api/tax/journal-entries/:id
router.delete('/journal-entries/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id
        const entry = await prisma.journalEntry.findUnique({ where: { id } })
        if (!entry) return res.status(404).json({ success: false, error: 'Không tìm thấy bút toán' })
        // Khóa sổ: chặn xóa chứng từ thuộc kỳ đã khóa.
        try {
            await assertNotLocked(prisma, (req as any).branchId ?? req.user?.branchId ?? null, entry.date)
        } catch (lockErr: any) {
            if (lockErr?.code === 'PERIOD_LOCKED') {
                return res.status(423).json({ success: false, code: 'PERIOD_LOCKED', lockDate: lockErr.lockDate, error: lockErr.message })
            }
            throw lockErr
        }
        await prisma.journalEntry.delete({ where: { id } })
        res.json({ success: true })
    } catch (err) { console.error('DELETE /journal-entries error:', err); res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// ── HOÁ ĐƠN PHÍ SÀN (Platform Fee Invoice) ─────────────────────────────────
// Phí sàn KHÔNG tự book per-đơn theo commissionRate nữa. Kế toán nhập hoá đơn
// GTGT do sàn (Shopee/TikTok/Lazada) xuất về cuối kỳ; mỗi hoá đơn sinh 2 bút
// toán cân đối, idempotent theo platform + key (kỳ hoặc số HĐ):
//   Nợ 641 / Có 131-<SÀN>   = phí dịch vụ chưa thuế
//   Nợ 133 / Có 131-<SÀN>   = thuế GTGT đầu vào được khấu trừ
// Sàn trừ thẳng vào escrow nên ghi giảm 131-<SÀN> (phải thu từ sàn).

function platformKeyOf(platform: string): keyof typeof PLATFORM_AR {
    const p = String(platform || '').toLowerCase()
    return (p in PLATFORM_AR ? p : 'online') as keyof typeof PLATFORM_AR
}
function feeInvoiceRefs(platformKey: string, key: string) {
    const tag = `${platformKey.toUpperCase()}-${key}`
    return { feeRef: `PFEEINV-${tag}`, vatRef: `PFEEINV-VAT-${tag}` }
}

// GET /api/tax/platform-fee-invoices?year=&month= — liệt kê hoá đơn phí đã nhập
router.get('/platform-fee-invoices', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const entries = await prisma.journalEntry.findMany({
            where: { referenceType: 'platform-fee-invoice', reference: { startsWith: 'PFEEINV-', not: { startsWith: 'PFEEINV-VAT-' } } },
            orderBy: { date: 'desc' },
        })
        const vats = await prisma.journalEntry.findMany({ where: { reference: { startsWith: 'PFEEINV-VAT-' } } })
        const vatByRef = new Map(vats.map((v: any) => [v.reference, v.amount]))
        const data = entries.map((e: any) => {
            const vat = vatByRef.get(e.reference?.replace('PFEEINV-', 'PFEEINV-VAT-')) || 0
            return { id: e.id, reference: e.reference, date: e.date, description: e.description, platformAccount: e.creditAccount, feeExVat: e.amount, vat, total: e.amount + vat, notes: e.notes }
        })
        res.json({ success: true, data })
    } catch (err) { console.error('GET /platform-fee-invoices error:', err); res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// POST /api/tax/platform-fee-invoice — nhập/ghi đè 1 hoá đơn phí sàn
//   body: { platform, period?|invoiceNo?, date, totalAmount, taxRate=10, amountIncludesVat=true, notes? }
router.post('/platform-fee-invoice', authMiddleware, enforcePeriodLock('date'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const b = req.body || {}
        const platformKey = platformKeyOf(b.platform)
        const ar = PLATFORM_AR[platformKey]!
        const key = String(b.invoiceNo || b.period || '').trim()
        const date = String(b.date || '').trim()
        if (!key) return res.status(400).json({ success: false, error: 'Thiếu kỳ (period) hoặc số hoá đơn (invoiceNo)' })
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ success: false, error: 'Ngày hoá đơn (date) không hợp lệ, cần YYYY-MM-DD' })
        const total = Number(b.totalAmount)
        if (!Number.isFinite(total) || total <= 0) return res.status(400).json({ success: false, error: 'totalAmount phải > 0' })
        const taxRate = b.taxRate === undefined ? 10 : Number(b.taxRate)
        if (!Number.isFinite(taxRate) || taxRate < 0) return res.status(400).json({ success: false, error: 'taxRate không hợp lệ' })
        const includesVat = b.amountIncludesVat === undefined ? true : !!b.amountIncludesVat

        const feeExVat = includesVat ? Math.round(total / (1 + taxRate / 100)) : Math.round(total)
        const vat = includesVat ? total - feeExVat : Math.round(total * taxRate / 100)

        const { feeRef, vatRef } = feeInvoiceRefs(platformKey, key)
        const branchId = (req as any).branchId || null
        const createdBy = (req as any).userId || null
        const label = `Phí sàn ${ar.label} kỳ ${key}${b.invoiceNo ? ` - HĐ ${b.invoiceNo}` : ''}`

        // Idempotent: ghi đè bản nhập trước của cùng platform+key
        await prisma.journalEntry.deleteMany({ where: { reference: { in: [feeRef, vatRef] } } })

        const created: any[] = []
        created.push(await prisma.journalEntry.create({
            data: {
                date, description: label,
                debitAccount: '641', debitAccountName: accountName('641') || 'Chi phí bán hàng',
                creditAccount: ar.account, creditAccountName: ar.name,
                amount: feeExVat, reference: feeRef, referenceType: 'platform-fee-invoice',
                notes: b.notes || null, branchId, createdBy,
            },
        }))
        if (vat > 0) {
            created.push(await prisma.journalEntry.create({
                data: {
                    date, description: `VAT ${label}`,
                    debitAccount: '133', debitAccountName: accountName('133') || 'Thuế GTGT được khấu trừ',
                    creditAccount: ar.account, creditAccountName: ar.name,
                    amount: vat, reference: vatRef, referenceType: 'platform-fee-invoice',
                    notes: b.notes || null, branchId, createdBy,
                },
            }))
        }
        res.status(201).json({ success: true, data: { platform: platformKey, key, date, feeExVat, vat, total: feeExVat + vat, entries: created } })
    } catch (err) { console.error('POST /platform-fee-invoice error:', err); res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// DELETE /api/tax/platform-fee-invoice?platform=&key= — xoá 1 hoá đơn phí (cả 2 dòng)
router.delete('/platform-fee-invoice', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const platformKey = platformKeyOf(req.query.platform as string)
        const key = String(req.query.key || '').trim()
        if (!key) return res.status(400).json({ success: false, error: 'Thiếu key' })
        const { feeRef, vatRef } = feeInvoiceRefs(platformKey, key)
        const fee = await prisma.journalEntry.findFirst({ where: { reference: feeRef } })
        if (fee) {
            try {
                await assertNotLocked(prisma, (req as any).branchId ?? req.user?.branchId ?? null, fee.date)
            } catch (lockErr: any) {
                if (lockErr?.code === 'PERIOD_LOCKED') return res.status(423).json({ success: false, code: 'PERIOD_LOCKED', lockDate: lockErr.lockDate, error: lockErr.message })
                throw lockErr
            }
        }
        const r = await prisma.journalEntry.deleteMany({ where: { reference: { in: [feeRef, vatRef] } } })
        res.json({ success: true, deleted: r.count })
    } catch (err) { console.error('DELETE /platform-fee-invoice error:', err); res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// ── QUYẾT TOÁN SÀN (escrow về tài khoản ngân hàng) ──────────────────────────
// Khi sàn (Shopee/TikTok/Lazada) quyết toán chuyển tiền escrow về tài khoản
// ngân hàng của shop, kế toán nhập 1 bản ghi quyết toán; mỗi bản sinh 1 bút
// toán idempotent theo platform + key (số sao kê hoặc ngày):
//   Nợ 112 / Có 131-<SÀN>   = tiền sàn trả về, giảm phải thu từ sàn
// Đây là cơ chế làm giảm số dư 131-<SÀN> (escrow sàn đang giữ) trên CĐKT.

function settlementRef(platformKey: string, key: string) {
    return `PSETTLE-${platformKey.toUpperCase()}-${key}`
}

// GET /api/tax/platform-settlements — liệt kê các phiếu quyết toán sàn đã nhập
router.get('/platform-settlements', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const entries = await prisma.journalEntry.findMany({
            where: { referenceType: 'platform-settlement', reference: { startsWith: 'PSETTLE-' } },
            orderBy: { date: 'desc' },
        })
        const data = entries.map((e: any) => ({
            id: e.id, reference: e.reference, date: e.date, description: e.description,
            platformAccount: e.creditAccount, amount: e.amount, notes: e.notes,
        }))
        res.json({ success: true, data })
    } catch (err) { console.error('GET /platform-settlements error:', err); res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// POST /api/tax/platform-settlement — nhập/ghi đè 1 phiếu quyết toán sàn
//   body: { platform, date(YYYY-MM-DD), amount, reference?(số sao kê), notes? }
router.post('/platform-settlement', authMiddleware, enforcePeriodLock('date'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const b = req.body || {}
        const platformKey = platformKeyOf(b.platform)
        const ar = PLATFORM_AR[platformKey]!
        const date = String(b.date || '').trim()
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ success: false, error: 'Ngày quyết toán (date) không hợp lệ, cần YYYY-MM-DD' })
        const amount = Math.round(Number(b.amount))
        if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ success: false, error: 'amount phải > 0' })
        const key = String(b.reference || date).trim()

        const ref = settlementRef(platformKey, key)
        const branchId = (req as any).branchId || null
        const createdBy = (req as any).userId || null
        const label = `Quyết toán ${ar.label}${b.reference ? ` - sao kê ${b.reference}` : ` ngày ${date}`}`

        // Idempotent: ghi đè bản nhập trước của cùng platform+key
        await prisma.journalEntry.deleteMany({ where: { reference: ref } })

        const created = await prisma.journalEntry.create({
            data: {
                date, description: label,
                debitAccount: '112', debitAccountName: accountName('112') || 'Tiền gửi ngân hàng',
                creditAccount: ar.account, creditAccountName: ar.name,
                amount, reference: ref, referenceType: 'platform-settlement',
                notes: b.notes || null, branchId, createdBy,
            },
        })
        res.status(201).json({ success: true, data: { platform: platformKey, key, date, amount, entry: created } })
    } catch (err) { console.error('POST /platform-settlement error:', err); res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// DELETE /api/tax/platform-settlement?platform=&key= — xoá 1 phiếu quyết toán
router.delete('/platform-settlement', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const platformKey = platformKeyOf(req.query.platform as string)
        const key = String(req.query.key || '').trim()
        if (!key) return res.status(400).json({ success: false, error: 'Thiếu key' })
        const ref = settlementRef(platformKey, key)
        const entry = await prisma.journalEntry.findFirst({ where: { reference: ref } })
        if (entry) {
            try {
                await assertNotLocked(prisma, (req as any).branchId ?? req.user?.branchId ?? null, entry.date)
            } catch (lockErr: any) {
                if (lockErr?.code === 'PERIOD_LOCKED') return res.status(423).json({ success: false, code: 'PERIOD_LOCKED', lockDate: lockErr.lockDate, error: lockErr.message })
                throw lockErr
            }
        }
        const r = await prisma.journalEntry.deleteMany({ where: { reference: ref } })
        res.json({ success: true, deleted: r.count })
    } catch (err) { console.error('DELETE /platform-settlement error:', err); res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// ── LEDGER (Sổ Cái) ────────────────────────────────────────────────────────

// GET /api/tax/ledger?account=111&year=2026&month=3
router.get('/ledger', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const account = req.query.account as string
        const year = Number(req.query.year) || new Date().getFullYear()
        const month = req.query.month ? Number(req.query.month) : undefined
        if (!account) return res.status(400).json({ success: false, error: 'account query param required' })

        const dateGte = month ? `${year}-${String(month).padStart(2, '0')}-01` : `${year}-01-01`
        const dateEnd = month ? `${year}-${String(month).padStart(2, '0')}-31` : `${year}-12-31`

        const [entries, openingEntries] = await Promise.all([
            prisma.journalEntry.findMany({
                where: {
                    OR: [{ debitAccount: account }, { creditAccount: account }],
                    date: { gte: dateGte, lte: dateEnd },
                },
                orderBy: { date: 'asc' },
            }),
            // Số dư đầu kỳ = lũy kế trước ngày bắt đầu kỳ
            prisma.journalEntry.findMany({
                where: {
                    OR: [{ debitAccount: account }, { creditAccount: account }],
                    date: { lt: dateGte },
                },
                select: { debitAccount: true, creditAccount: true, amount: true },
            }),
        ])

        let openingBalance = 0
        for (const e of openingEntries) {
            if (e.debitAccount === account) openingBalance += e.amount
            if (e.creditAccount === account) openingBalance -= e.amount
        }

        let runningBalance = openingBalance
        const ledgerEntries = entries.map(e => {
            const debit = e.debitAccount === account ? e.amount : 0
            const credit = e.creditAccount === account ? e.amount : 0
            runningBalance += debit - credit
            return {
                id: e.id, date: e.date, description: e.description,
                counterAccount: e.debitAccount === account ? e.creditAccount : e.debitAccount,
                debit, credit, balance: runningBalance,
                reference: e.reference,
                referenceType: e.referenceType || 'manual',
            }
        })

        const totalDebit = ledgerEntries.reduce((s, e) => s + e.debit, 0)
        const totalCredit = ledgerEntries.reduce((s, e) => s + e.credit, 0)

        res.json({
            success: true,
            data: {
                account,
                accountCode: account,
                accountName: accountName(account),
                entries: ledgerEntries,
                openingBalance,
                totalDebit, totalCredit,
                closingBalance: runningBalance,
            }
        })
    } catch (err) { console.error('GET /ledger error:', err); res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// ── TRIAL BALANCE (Bảng Cân Đối PS) ────────────────────────────────────────

// GET /api/tax/trial-balance?year=2026&month=3
router.get('/trial-balance', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const year = Number(req.query.year) || new Date().getFullYear()
        const month = req.query.month ? Number(req.query.month) : undefined
        const dateGte = month ? `${year}-${String(month).padStart(2, '0')}-01` : `${year}-01-01`
        const dateEnd = month ? `${year}-${String(month).padStart(2, '0')}-31` : `${year}-12-31`

        const entries = await prisma.journalEntry.findMany({
            where: { date: { gte: dateGte, lte: dateEnd } },
        })

        // Aggregate by account
        const accountMap: any = {}
        for (const e of entries) {
            // Debit side
            if (!accountMap[e.debitAccount]) accountMap[e.debitAccount] = { code: e.debitAccount, name: e.debitAccountName || e.debitAccount, debit: 0, credit: 0 }
            accountMap[e.debitAccount].debit += e.amount
            // Credit side
            if (!accountMap[e.creditAccount]) accountMap[e.creditAccount] = { code: e.creditAccount, name: e.creditAccountName || e.creditAccount, debit: 0, credit: 0 }
            accountMap[e.creditAccount].credit += e.amount
        }

        const accounts = Object.values(accountMap).sort((a: any, b: any) => a.code.localeCompare(b.code))
        const totalDebit = (accounts as any[]).reduce((s, a) => s + a.debit, 0)
        const totalCredit = (accounts as any[]).reduce((s, a) => s + a.credit, 0)

        res.json({
            success: true,
            data: {
                accounts,
                totalDebit, totalCredit,
                isBalanced: Math.abs(totalDebit - totalCredit) < 1,
            }
        })
    } catch (err) { console.error('GET /trial-balance error:', err); res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// ── CASH BOOK (Sổ Quỹ Tiền Mặt) ───────────────────────────────────────────

// GET /api/tax/cash-book?year=2026&month=3
router.get('/cash-book', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const year = Number(req.query.year) || new Date().getFullYear()
        const month = req.query.month ? Number(req.query.month) : undefined
        const dateGte = month ? `${year}-${String(month).padStart(2, '0')}-01` : `${year}-01-01`
        const dateEnd = month ? `${year}-${String(month).padStart(2, '0')}-31` : `${year}-12-31`

        // accountType=bank → sổ tiền gửi NH (TK 112); mặc định tiền mặt (TK 111)
        const prefix = String(req.query.accountType || '') === 'bank' ? '112' : '111'
        const [entries, openingEntries] = await Promise.all([
            prisma.journalEntry.findMany({
                where: {
                    OR: [{ debitAccount: { startsWith: prefix } }, { creditAccount: { startsWith: prefix } }],
                    date: { gte: dateGte, lte: dateEnd },
                },
                orderBy: { date: 'asc' },
            }),
            prisma.journalEntry.findMany({
                where: {
                    OR: [{ debitAccount: { startsWith: prefix } }, { creditAccount: { startsWith: prefix } }],
                    date: { lt: dateGte },
                },
                select: { debitAccount: true, creditAccount: true, amount: true },
            }),
        ])

        let openingBalance = 0
        for (const e of openingEntries) {
            if (e.debitAccount.startsWith(prefix)) openingBalance += e.amount
            if (e.creditAccount.startsWith(prefix)) openingBalance -= e.amount
        }

        let balance = openingBalance
        const cashEntries = entries.map(e => {
            const receipt = e.debitAccount.startsWith(prefix) ? e.amount : 0
            const payment = e.creditAccount.startsWith(prefix) ? e.amount : 0
            balance += receipt - payment
            return {
                id: e.id, date: e.date, description: e.description,
                counterAccount: e.debitAccount.startsWith(prefix) ? e.creditAccount : e.debitAccount,
                receipt, payment, balance, reference: e.reference,
                referenceType: e.referenceType || 'manual',
            }
        })

        const totalReceipts = cashEntries.reduce((s, e) => s + e.receipt, 0)
        const totalPayments = cashEntries.reduce((s, e) => s + e.payment, 0)

        // Daily balances for chart
        const dailyMap: any = {}
        let dBal = 0
        for (const e of cashEntries) {
            dBal += e.receipt - e.payment
            dailyMap[e.date] = dBal
        }
        const dailyBalances = Object.entries(dailyMap).map(([date, balance]) => ({ date, balance }))

        res.json({
            success: true,
            data: {
                entries: cashEntries,
                openingBalance: 0,
                closingBalance: balance,
                totalReceipts, totalPayments,
                dailyBalances,
            }
        })
    } catch (err) { console.error('GET /cash-book error:', err); res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// ── DEBT AGING (Công Nợ Phải Thu/Trả) ──────────────────────────────────────

// GET /api/tax/debt-aging?type=receivable&year=2026
router.get('/debt-aging', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const debtType = (req.query.type as string) || 'receivable'
        const now = new Date()

        if (debtType === 'receivable') {
            // Customers with debt > 0
            const customers = await prisma.customer.findMany({
                where: { debt: { gt: 0 } },
                select: { id: true, name: true, debt: true, lastPurchaseDate: true },
                orderBy: { debt: 'desc' },
            })
            const rows = customers.map(c => {
                const daysSince = c.lastPurchaseDate ? Math.floor((now.getTime() - new Date(c.lastPurchaseDate).getTime()) / 86400000) : 999
                const current = daysSince <= 0 ? c.debt : 0
                const days30 = daysSince > 0 && daysSince <= 30 ? c.debt : 0
                const days60 = daysSince > 30 && daysSince <= 60 ? c.debt : 0
                const days90 = daysSince > 60 && daysSince <= 90 ? c.debt : 0
                const overdue90 = daysSince > 90 ? c.debt : 0
                return { partnerId: c.id, partnerName: c.name, totalDebt: c.debt, current, days30, days60, days90, overdue90, lastTransactionDate: c.lastPurchaseDate }
            })
            const totalDebt = rows.reduce((s, r) => s + r.totalDebt, 0)
            const totalCurrent = rows.reduce((s, r) => s + r.current, 0)
            const totalOverdue = totalDebt - totalCurrent
            const agingSummary = {
                current: rows.reduce((s, r) => s + r.current, 0),
                days30: rows.reduce((s, r) => s + r.days30, 0),
                days60: rows.reduce((s, r) => s + r.days60, 0),
                days90: rows.reduce((s, r) => s + r.days90, 0),
                overdue90: rows.reduce((s, r) => s + r.overdue90, 0),
            }
            res.json({ success: true, data: { rows, totalDebt, totalCurrent, totalOverdue, agingSummary } })
        } else {
            // Payable: import receipts not fully paid (paymentStatus unpaid/partial).
            // Outstanding = totalCost - paidAmount.
            const imports = await prisma.importReceipt.findMany({
                where: {
                    status: { not: 'cancelled' },
                    paymentStatus: { in: ['unpaid', 'partial'] },
                } as any,
                select: { id: true, supplierName: true, totalCost: true, paidAmount: true, createdAt: true } as any,
                orderBy: { totalCost: 'desc' },
            })
            const rows = (imports as any[]).map(i => {
                const remaining = Math.max(0, (i.totalCost || 0) - (i.paidAmount || 0))
                const daysSince = Math.floor((now.getTime() - new Date(i.createdAt).getTime()) / 86400000)
                return {
                    partnerId: i.id, partnerName: i.supplierName || 'NCC', totalDebt: remaining,
                    current: daysSince <= 0 ? remaining : 0,
                    days30: daysSince > 0 && daysSince <= 30 ? remaining : 0,
                    days60: daysSince > 30 && daysSince <= 60 ? remaining : 0,
                    days90: daysSince > 60 && daysSince <= 90 ? remaining : 0,
                    overdue90: daysSince > 90 ? remaining : 0,
                    lastTransactionDate: i.createdAt,
                }
            }).filter(r => r.totalDebt > 0)
            const totalDebt = rows.reduce((s, r) => s + r.totalDebt, 0)
            const totalCurrent = rows.reduce((s, r) => s + r.current, 0)
            const totalOverdue = totalDebt - totalCurrent
            const agingSummary = {
                current: totalCurrent,
                days30: rows.reduce((s, r) => s + r.days30, 0),
                days60: rows.reduce((s, r) => s + r.days60, 0),
                days90: rows.reduce((s, r) => s + r.days90, 0),
                overdue90: rows.reduce((s, r) => s + r.overdue90, 0),
            }
            res.json({ success: true, data: { rows, totalDebt, totalCurrent, totalOverdue, agingSummary } })
        }
    } catch (err) { console.error('GET /debt-aging error:', err); res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// ── FIXED ASSETS (TSCĐ + Khấu Hao) ─────────────────────────────────────────

// ─── Fixed Asset helpers ──────────────────────────────────────────────────────
// Compute monthly depreciation given method, depreciable base, useful life, and current net book value.
// straight-line: (originalCost - residualValue) / usefulLifeMonths
// declining-balance: netBookValue * (2 / usefulLifeMonths), floored at residualValue
function computeMonthlyDepreciation(method: string, originalCost: number, residualValue: number, usefulLifeMonths: number, currentNetBook: number): number {
    if (!usefulLifeMonths || usefulLifeMonths <= 0) return 0
    const base = Math.max(0, originalCost - residualValue)
    if (method === 'declining-balance') {
        const rate = 2 / usefulLifeMonths
        return Math.max(0, Math.round(currentNetBook * rate))
    }
    return Math.round(base / usefulLifeMonths)
}

// Build full month-by-month depreciation schedule for an asset.
function buildDepreciationSchedule(asset: any): { entries: any[]; totalDepreciation: number } {
    const original = Number(asset.originalCost) || 0
    const residual = Number(asset.residualValue) || 0
    const life = Number(asset.usefulLifeMonths) || 0
    const method = asset.method || 'straight-line'
    const acqDate = new Date(asset.acquisitionDate)
    const entries: any[] = []
    let netBook = original
    let accumulated = 0
    const depreciableTotal = Math.max(0, original - residual)

    for (let i = 1; i <= life && accumulated < depreciableTotal; i++) {
        let monthly = computeMonthlyDepreciation(method, original, residual, life, netBook)
        // Cap so accumulated never exceeds depreciableTotal
        if (accumulated + monthly > depreciableTotal) monthly = depreciableTotal - accumulated
        accumulated += monthly
        netBook = original - accumulated
        const periodDate = new Date(acqDate.getFullYear(), acqDate.getMonth() + i, 0)
        entries.push({
            period: i,
            year: periodDate.getFullYear(),
            month: periodDate.getMonth() + 1,
            date: periodDate.toISOString().slice(0, 10),
            depreciation: monthly,
            accumulated,
            netBookValue: netBook,
        })
    }
    return { entries, totalDepreciation: accumulated }
}

// Recalculate runtime depreciation values for an asset as of `asOf` date (default now).
function recalcAsset(asset: any, asOf: Date = new Date()): any {
    const original = Number(asset.originalCost) || 0
    const residual = Number(asset.residualValue) || 0
    const life = Number(asset.usefulLifeMonths) || 0
    const method = asset.method || 'straight-line'
    const acqDate = new Date(asset.acquisitionDate)
    if (asset.status === 'disposed') {
        return { ...asset, monthlyDepreciation: 0 }
    }
    const monthsElapsed = Math.max(0, (asOf.getFullYear() - acqDate.getFullYear()) * 12 + (asOf.getMonth() - acqDate.getMonth()))
    const monthsUsed = Math.min(life, monthsElapsed)
    const depreciableTotal = Math.max(0, original - residual)
    const monthlyDep = computeMonthlyDepreciation(method, original, residual, life, original)
    const accumulated = Math.min(depreciableTotal, monthlyDep * monthsUsed)
    const netBook = original - accumulated
    const status = accumulated >= depreciableTotal && depreciableTotal > 0 ? 'fully-depreciated' : asset.status
    return { ...asset, accumulatedDepreciation: accumulated, netBookValue: netBook, monthlyDepreciation: monthlyDep, status }
}

// ─── FIXED ASSETS (TSCĐ + Khấu Hao) ──────────────────────────────────────────

// GET /api/tax/fixed-assets/summary — totals + count by category
router.get('/fixed-assets/summary', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma! as any
        const assets = await prisma.fixedAsset.findMany()
        const processed = assets.map((a: any) => recalcAsset(a))
        const active = processed.filter((a: any) => a.status === 'active')

        const byCategory: Record<string, { count: number; originalCost: number; accumulatedDepreciation: number; netBookValue: number }> = {}
        for (const a of processed) {
            const cat = a.category || 'other'
            if (!byCategory[cat]) byCategory[cat] = { count: 0, originalCost: 0, accumulatedDepreciation: 0, netBookValue: 0 }
            byCategory[cat].count++
            byCategory[cat].originalCost += a.originalCost || 0
            byCategory[cat].accumulatedDepreciation += a.accumulatedDepreciation || 0
            byCategory[cat].netBookValue += a.netBookValue || 0
        }

        res.json({
            success: true,
            data: {
                totalOriginalCost: processed.reduce((s: number, a: any) => s + (a.originalCost || 0), 0),
                totalAccumulatedDepreciation: processed.reduce((s: number, a: any) => s + (a.accumulatedDepreciation || 0), 0),
                totalNetBookValue: processed.reduce((s: number, a: any) => s + (a.netBookValue || 0), 0),
                totalMonthlyDepreciation: active.reduce((s: number, a: any) => s + (a.monthlyDepreciation || 0), 0),
                totalCount: processed.length,
                activeCount: active.length,
                disposedCount: processed.filter((a: any) => a.status === 'disposed').length,
                fullyDepreciatedCount: processed.filter((a: any) => a.status === 'fully-depreciated').length,
                byCategory,
            },
        })
    } catch (err) { console.error('GET /fixed-assets/summary error:', err); res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// POST /api/tax/fixed-assets/depreciation/run?year=&month= — run monthly depreciation
router.post('/fixed-assets/depreciation/run', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma! as any
        const year = Number(req.query.year) || new Date().getFullYear()
        const month = Number(req.query.month) || (new Date().getMonth() + 1)
        if (month < 1 || month > 12) return res.status(400).json({ success: false, error: 'Tháng không hợp lệ (1-12)' })
        const branchId = (req as any).branchId || null
        const userId = (req as any).userId || null

        const assets = await prisma.fixedAsset.findMany({ where: { status: 'active' } })
        const monthEndDate = new Date(year, month, 0)
        const depDate = monthEndDate.toISOString().slice(0, 10)

        // Pre-load existing refs for the period for idempotency
        const existingDepRefs = await prisma.journalEntry.findMany({
            where: { referenceType: 'depreciation', date: depDate },
            select: { reference: true },
        })
        const existingRefSet = new Set(existingDepRefs.map((e: any) => e.reference).filter(Boolean))

        const created: any[] = []
        const skipped: any[] = []
        let totalAmount = 0

        for (const asset of assets) {
            const acqDate = new Date(asset.acquisitionDate)
            const acqYear = acqDate.getFullYear()
            const acqMonth = acqDate.getMonth() + 1
            // Skip if depreciation period precedes acquisition
            if (year < acqYear || (year === acqYear && month < acqMonth)) {
                skipped.push({ assetId: asset.id, code: asset.code, reason: 'Trước ngày mua' })
                continue
            }

            const original = Number(asset.originalCost) || 0
            const residual = Number(asset.residualValue) || 0
            const life = Number(asset.usefulLifeMonths) || 0
            const depreciableTotal = Math.max(0, original - residual)
            const currentAccumulated = Number(asset.accumulatedDepreciation) || 0
            if (currentAccumulated >= depreciableTotal) {
                skipped.push({ assetId: asset.id, code: asset.code, reason: 'Đã khấu hao hết' })
                continue
            }

            const ref = `DEP-${asset.code}-${year}-${String(month).padStart(2, '0')}`
            if (existingRefSet.has(ref)) {
                skipped.push({ assetId: asset.id, code: asset.code, reason: 'Đã chạy kỳ này', reference: ref })
                continue
            }

            const currentNetBook = original - currentAccumulated
            let monthly = computeMonthlyDepreciation(asset.method || 'straight-line', original, residual, life, currentNetBook)
            // Cap so we don't over-depreciate
            const remaining = depreciableTotal - currentAccumulated
            if (monthly > remaining) monthly = remaining
            if (monthly <= 0) {
                skipped.push({ assetId: asset.id, code: asset.code, reason: 'Số tiền khấu hao = 0' })
                continue
            }

            const debitAccount = asset.depreciationAccount || '6424'
            const debitAccountName = debitAccount.startsWith('627') ? 'CP sản xuất chung - khấu hao'
                : debitAccount.startsWith('641') ? 'CP bán hàng - khấu hao'
                : debitAccount.startsWith('642') ? 'CP QLDN - khấu hao'
                : 'CP khấu hao TSCĐ'

            try {
                const entry = await prisma.journalEntry.create({
                    data: {
                        date: depDate,
                        description: `Khấu hao T${month}/${year} - ${asset.name}`,
                        debitAccount, debitAccountName,
                        creditAccount: '214', creditAccountName: 'Hao mòn TSCĐ',
                        amount: monthly, reference: ref, referenceType: 'depreciation',
                        branchId, createdBy: userId,
                    },
                })

                // Update asset cumulative depreciation + net book value
                const newAccumulated = currentAccumulated + monthly
                const newNetBook = original - newAccumulated
                const newStatus = newAccumulated >= depreciableTotal ? 'fully-depreciated' : 'active'
                await prisma.fixedAsset.update({
                    where: { id: asset.id },
                    data: {
                        accumulatedDepreciation: newAccumulated,
                        netBookValue: newNetBook,
                        status: newStatus,
                    },
                })

                created.push({ assetId: asset.id, code: asset.code, name: asset.name, amount: monthly, reference: ref, entryId: entry.id })
                totalAmount += monthly
            } catch (e: any) {
                skipped.push({ assetId: asset.id, code: asset.code, reason: e?.message || 'Lỗi tạo bút toán' })
            }
        }

        res.json({
            success: true,
            data: {
                year, month, date: depDate,
                created, skipped,
                summary: { createdCount: created.length, skippedCount: skipped.length, totalAmount },
            },
        })
    } catch (err) { console.error('POST /fixed-assets/depreciation/run error:', err); res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// GET /api/tax/fixed-assets — list with optional filters (?category=&status=)
router.get('/fixed-assets', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma! as any
        const category = (req.query.category as string) || undefined
        const status = (req.query.status as string) || undefined
        const where: any = {}
        if (category) where.category = category
        if (status) where.status = status

        const assets = await prisma.fixedAsset.findMany({ where, orderBy: { createdAt: 'desc' } })
        const processed = assets.map((a: any) => recalcAsset(a))
        const active = processed.filter((a: any) => a.status === 'active')

        const summary = {
            totalOriginalCost: processed.reduce((s: number, a: any) => s + (a.originalCost || 0), 0),
            totalAccumulated: processed.reduce((s: number, a: any) => s + (a.accumulatedDepreciation || 0), 0),
            totalNetBook: processed.reduce((s: number, a: any) => s + (a.netBookValue || 0), 0),
            totalMonthlyDep: active.reduce((s: number, a: any) => s + (a.monthlyDepreciation || 0), 0),
            activeCount: active.length,
        }

        res.json({ success: true, data: { assets: processed, summary } })
    } catch (err) { console.error('GET /fixed-assets error:', err); res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// POST /api/tax/fixed-assets — create
router.post('/fixed-assets', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma! as any
        const {
            code, name, category, acquisitionDate, originalCost, usefulLifeMonths,
            depreciationMethod, method, residualValue, department, description, depreciationAccount,
        } = req.body
        if (!code?.trim() || !name?.trim()) {
            return res.status(400).json({ success: false, error: 'Mã và tên tài sản là bắt buộc' })
        }
        const cost = Number(originalCost)
        const life = Number(usefulLifeMonths)
        if (!cost || cost <= 0) return res.status(400).json({ success: false, error: 'Nguyên giá phải > 0' })
        if (!life || life <= 0) return res.status(400).json({ success: false, error: 'Thời gian sử dụng (tháng) phải > 0' })
        const residual = Number(residualValue) || 0
        if (residual < 0 || residual >= cost) return res.status(400).json({ success: false, error: 'Giá trị thu hồi không hợp lệ' })

        const depMethod = depreciationMethod || method || 'straight-line'
        if (!['straight-line', 'declining-balance'].includes(depMethod)) {
            return res.status(400).json({ success: false, error: 'Phương pháp khấu hao không hợp lệ' })
        }

        const monthlyDep = computeMonthlyDepreciation(depMethod, cost, residual, life, cost)

        const data = await prisma.fixedAsset.create({
            data: {
                code: code.trim(),
                name: name.trim(),
                category: category || 'other',
                acquisitionDate: acquisitionDate || new Date().toISOString().slice(0, 10),
                originalCost: cost,
                usefulLifeMonths: life,
                method: depMethod,
                residualValue: residual,
                department: department?.trim() || null,
                description: description?.trim() || null,
                monthlyDepreciation: monthlyDep,
                accumulatedDepreciation: 0,
                netBookValue: cost,
                depreciationAccount: depreciationAccount || '6424',
                status: 'active',
            },
        })
        res.status(201).json({ success: true, data })
    } catch (err: any) {
        console.error('POST /fixed-assets error:', err)
        if (err?.code === 'P2002') return res.status(400).json({ success: false, error: 'Mã tài sản đã tồn tại' })
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// GET /api/tax/fixed-assets/:id/depreciation — full depreciation schedule
router.get('/fixed-assets/:id/depreciation', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma! as any
        const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id
        const asset = await prisma.fixedAsset.findUnique({ where: { id } })
        if (!asset) return res.status(404).json({ success: false, error: 'Không tìm thấy tài sản' })

        const schedule = buildDepreciationSchedule(asset)
        res.json({
            success: true,
            data: {
                assetId: asset.id,
                code: asset.code,
                name: asset.name,
                method: asset.method,
                originalCost: asset.originalCost,
                residualValue: asset.residualValue || 0,
                usefulLifeMonths: asset.usefulLifeMonths,
                acquisitionDate: asset.acquisitionDate,
                schedule: schedule.entries,
                totalDepreciation: schedule.totalDepreciation,
            },
        })
    } catch (err) { console.error('GET /fixed-assets/:id/depreciation error:', err); res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// GET /api/tax/fixed-assets/:id — single asset (with depreciation schedule)
router.get('/fixed-assets/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma! as any
        const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id
        const asset = await prisma.fixedAsset.findUnique({ where: { id } })
        if (!asset) return res.status(404).json({ success: false, error: 'Không tìm thấy tài sản' })

        const processed = recalcAsset(asset)
        const schedule = buildDepreciationSchedule(asset)

        res.json({ success: true, data: { ...processed, schedule: schedule.entries } })
    } catch (err) { console.error('GET /fixed-assets/:id error:', err); res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// PUT /api/tax/fixed-assets/:id — update asset details
router.put('/fixed-assets/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma! as any
        const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id
        const existing = await prisma.fixedAsset.findUnique({ where: { id } })
        if (!existing) return res.status(404).json({ success: false, error: 'Không tìm thấy tài sản' })

        const {
            code, name, category, acquisitionDate, originalCost, usefulLifeMonths,
            depreciationMethod, method, residualValue, department, description,
            depreciationAccount, status,
        } = req.body

        const data: any = {}
        if (code !== undefined) data.code = String(code).trim()
        if (name !== undefined) data.name = String(name).trim()
        if (category !== undefined) data.category = category
        if (acquisitionDate !== undefined) data.acquisitionDate = acquisitionDate
        if (originalCost !== undefined) {
            const v = Number(originalCost)
            if (!v || v <= 0) return res.status(400).json({ success: false, error: 'Nguyên giá phải > 0' })
            data.originalCost = v
        }
        if (usefulLifeMonths !== undefined) {
            const v = Number(usefulLifeMonths)
            if (!v || v <= 0) return res.status(400).json({ success: false, error: 'Thời gian sử dụng phải > 0' })
            data.usefulLifeMonths = v
        }
        const depMethod = depreciationMethod || method
        if (depMethod !== undefined) {
            if (!['straight-line', 'declining-balance'].includes(depMethod)) {
                return res.status(400).json({ success: false, error: 'Phương pháp khấu hao không hợp lệ' })
            }
            data.method = depMethod
        }
        if (residualValue !== undefined) {
            const v = Number(residualValue)
            if (v < 0) return res.status(400).json({ success: false, error: 'Giá trị thu hồi không hợp lệ' })
            data.residualValue = v
        }
        if (department !== undefined) data.department = department ? String(department).trim() : null
        if (description !== undefined) data.description = description ? String(description).trim() : null
        if (depreciationAccount !== undefined) data.depreciationAccount = depreciationAccount
        if (status !== undefined) data.status = status

        // Recompute monthly depreciation if any of the relevant fields changed
        const recomputeKeys = ['originalCost', 'usefulLifeMonths', 'method', 'residualValue']
        if (recomputeKeys.some(k => k in data)) {
            const merged = { ...existing, ...data }
            const accumulated = Number(merged.accumulatedDepreciation) || 0
            const currentNetBook = (Number(merged.originalCost) || 0) - accumulated
            data.monthlyDepreciation = computeMonthlyDepreciation(
                merged.method || 'straight-line',
                Number(merged.originalCost) || 0,
                Number(merged.residualValue) || 0,
                Number(merged.usefulLifeMonths) || 0,
                currentNetBook,
            )
            data.netBookValue = currentNetBook
        }

        const updated = await prisma.fixedAsset.update({ where: { id }, data })
        res.json({ success: true, data: updated })
    } catch (err: any) {
        console.error('PUT /fixed-assets/:id error:', err)
        if (err?.code === 'P2002') return res.status(400).json({ success: false, error: 'Mã tài sản đã tồn tại' })
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// DELETE /api/tax/fixed-assets/:id — soft delete (mark as disposed)
router.delete('/fixed-assets/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma! as any
        const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id
        const existing = await prisma.fixedAsset.findUnique({ where: { id } })
        if (!existing) return res.status(404).json({ success: false, error: 'Không tìm thấy tài sản' })
        if (existing.status === 'disposed') {
            return res.status(400).json({ success: false, error: 'Tài sản đã thanh lý trước đó' })
        }

        const disposalDate = (req.body?.disposalDate as string) || new Date().toISOString().slice(0, 10)
        const updated = await prisma.fixedAsset.update({
            where: { id },
            data: { status: 'disposed', disposalDate, monthlyDepreciation: 0 },
        })
        res.json({ success: true, data: updated })
    } catch (err) { console.error('DELETE /fixed-assets/:id error:', err); res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// ── PAYROLL ACCOUNTING (Bảng Lương KT) ──────────────────────────────────────

// GET /api/tax/payroll-accounting?year=2026&month=3
router.get('/payroll-accounting', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const year = Number(req.query.year) || new Date().getFullYear()
        const month = Number(req.query.month) || new Date().getMonth() + 1

        const records = await prisma.payrollRecord.findMany({
            where: { year, month },
            orderBy: { employeeName: 'asc' },
        })

        const rows = records.map(r => ({
            employeeId: r.employeeId,
            employeeName: r.employeeName,
            department: r.department || 'Chung',
            grossSalary: r.actualGross || r.grossSalary,
            bhxh: r.bhxh_emp,
            bhyt: r.bhyt_emp,
            bhtn: r.bhtn_emp,
            taxableIncome: (r.actualGross || r.grossSalary) - r.bhxh_emp - r.bhyt_emp - r.bhtn_emp - 11000000 - (r.dependents * 4400000),
            pitAmount: r.pit,
            netSalary: r.netSalary,
        }))

        const summary = {
            totalGross: rows.reduce((s, r) => s + r.grossSalary, 0),
            totalInsuranceEmployee: records.reduce((s, r) => s + r.bhxh_emp + r.bhyt_emp + r.bhtn_emp, 0),
            totalInsuranceEmployer: records.reduce((s, r) => s + r.bhxh_er + r.bhyt_er + r.bhtn_er, 0),
            totalPit: rows.reduce((s, r) => s + r.pitAmount, 0),
            totalNet: rows.reduce((s, r) => s + r.netSalary, 0),
            totalCost: records.reduce((s, r) => s + r.totalCost, 0),
            headcount: rows.length,
        }

        res.json({ success: true, data: { rows, summary } })
    } catch (err) { console.error('GET /payroll-accounting error:', err); res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// ── REVENUE ANALYSIS (Phân Tích Thu Chi) ────────────────────────────────────

// GET /api/tax/revenue-analysis?year=2026
router.get('/revenue-analysis', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const year = Number(req.query.year) || new Date().getFullYear()
        const start = new Date(year, 0, 1), end = new Date(year, 11, 31, 23, 59, 59, 999)

        const [txs, expenses, imports] = await Promise.all([
            prisma.transaction.findMany({ where: { status: { in: ['completed', 'partial'] }, createdAt: { gte: start, lte: end } }, select: { total: true, subtotal: true, tax: true, discount: true, createdAt: true } }),
            prisma.expense.findMany({ where: { date: { gte: start, lte: end } }, select: { amount: true, category: true, date: true } }),
            prisma.importReceipt.findMany({ where: { createdAt: { gte: start, lte: end } }, select: { totalCost: true, createdAt: true } }),
        ])

        const netRevenue = txs.reduce((s, t) => s + (t.total || 0), 0)
        const cogs = imports.reduce((s, i) => s + (i.totalCost || 0), 0)
        const grossProfit = netRevenue - cogs
        const grossMargin = netRevenue > 0 ? (grossProfit / netRevenue) * 100 : 0
        const totalExpenses = expenses.reduce((s, e) => s + (e.amount || 0), 0)
        const netProfit = grossProfit - totalExpenses
        const netMargin = netRevenue > 0 ? (netProfit / netRevenue) * 100 : 0
        const taxDue = txs.reduce((s, t) => s + (t.tax || 0), 0)

        // Monthly breakdown
        const monthlyMap: Record<string, { revenue: number; cogs: number; expenses: number }> = {}
        for (let m = 1; m <= 12; m++) monthlyMap[`T${m}`] = { revenue: 0, cogs: 0, expenses: 0 }
        txs.forEach(t => { const m = new Date(t.createdAt).getMonth() + 1; monthlyMap[`T${m}`].revenue += t.total || 0 })
        imports.forEach(i => { const m = new Date(i.createdAt).getMonth() + 1; monthlyMap[`T${m}`].cogs += i.totalCost || 0 })
        expenses.forEach(e => { const m = new Date(e.date).getMonth() + 1; monthlyMap[`T${m}`].expenses += e.amount || 0 })
        const monthly = Object.entries(monthlyMap).map(([month, d]) => ({
            month, revenue: d.revenue, cogs: d.cogs, netProfit: d.revenue - d.cogs - d.expenses,
        }))

        // Cost breakdown by category
        const catMap: Record<string, number> = {}
        expenses.forEach(e => { catMap[e.category] = (catMap[e.category] || 0) + (e.amount || 0) })
        const totalCost = cogs + totalExpenses
        const costBreakdown = [
            { category: 'Giá vốn hàng bán', amount: cogs, percentage: totalCost > 0 ? (cogs / totalCost) * 100 : 0 },
            ...Object.entries(catMap).map(([category, amount]) => ({
                category, amount, percentage: totalCost > 0 ? (amount / totalCost) * 100 : 0,
            })),
        ].filter(c => c.amount > 0)

        // Cash flow (simplified)
        const cashFlow = monthly.map(m => ({
            month: m.month,
            inflow: m.revenue,
            outflow: m.cogs + (monthlyMap[m.month]?.expenses || 0),
        }))

        // P&L Summary
        const plSummary = [
            { label: 'Doanh thu bán hàng', amount: netRevenue, level: 0, isTotal: false },
            { label: 'Giá vốn hàng bán', amount: -cogs, level: 1, isTotal: false },
            { label: 'Lợi nhuận gộp', amount: grossProfit, level: 0, isTotal: true },
            ...Object.entries(catMap).map(([cat, amt]) => ({ label: cat, amount: -amt, level: 1, isTotal: false })),
            { label: 'Tổng chi phí hoạt động', amount: -totalExpenses, level: 0, isTotal: true },
            { label: 'Thuế GTGT', amount: -taxDue, level: 1, isTotal: false },
            { label: 'Lợi nhuận ròng', amount: netProfit, level: 0, isTotal: true },
        ]

        res.json({
            success: true, data: {
                kpis: { netRevenue, cogs, grossProfit, grossMargin, totalExpenses, netProfit, netMargin, taxDue, ebitda: netProfit + taxDue },
                monthly, costBreakdown, cashFlow, plSummary,
            }
        })
    } catch (err) { console.error('GET /revenue-analysis error:', err); res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// ── AUTO-JOURNAL (Đồng bộ dữ liệu → Bút toán kế toán) ─────────────────────

// POST /api/tax/auto-journal?year=2026&month=3
// Generates journal entries from Transaction, Expense, ImportReceipt, PayrollRecord
router.post('/auto-journal', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const year = Number(req.query.year) || new Date().getFullYear()
        const month = req.query.month ? Number(req.query.month) : undefined
        const start = month ? new Date(year, month - 1, 1) : new Date(year, 0, 1)
        const end = month ? new Date(year, month, 0, 23, 59, 59, 999) : new Date(year, 11, 31, 23, 59, 59, 999)

        // Get existing auto-generated references to avoid duplicates
        let existingRefs = new Set<string>()
        try {
            const existing = await prisma.journalEntry.findMany({
                where: { referenceType: { not: 'manual' } },
                select: { reference: true },
            })
            existingRefs = new Set(existing.map(e => e.reference).filter(Boolean) as string[])
        } catch (_) { /* table may not exist yet */ }

        const created: any[] = []
        const fmtDate = (d: Date) => d.toISOString().slice(0, 10)
        const branchId = (req as any).branchId || null
        const userId = (req as any).userId || null

        /* HKD/cá nhân không được khấu trừ VAT đầu vào → VAT nằm trong giá vốn,
         * không tách sang 1331. Phải đọc đúng loại hình, nếu không sổ của HKD sẽ
         * mọc ra một khoản thuế được khấu trừ không có thật. */
        const _bt = (await prisma.storeSettings.findFirst({ select: { businessType: true } }).catch(() => null))?.businessType || 'company'
        const _hkdKhongKhauTru = _bt === 'household' || _bt === 'individual'

        // ═══ 1. TRANSACTIONS → Revenue + VAT + COGS journal entries ═══
        const txs = await prisma.transaction.findMany({
            where: { status: { in: ['completed', 'partial'] }, createdAt: { gte: start, lte: end } },
            include: { payments: true, items: { include: { product: { select: { costPrice: true } } } } },
            orderBy: { createdAt: 'asc' },
        })

        for (const tx of txs) {
            // Skip when every ref for this tx has already been created.
            // The helper is idempotent on its own, but pre-skipping avoids one DB probe per tx.
            const allRefs = [`SALE-${tx.receiptNumber}`, `VAT-${tx.receiptNumber}`, `DISC-${tx.receiptNumber}`, `COGS-${tx.receiptNumber}`]
            if (allRefs.every(r => existingRefs.has(r))) continue

            const result = await createJournalEntriesForTransaction(prisma, tx as any, {
                branchId, userId, skipDupCheck: true,
            })
            for (const entry of result.created) {
                created.push(entry)
                existingRefs.add(entry.ref)
            }
        }

        // ═══ 2. EXPENSES → Operating expense journal entries ═══
        const expenses = await prisma.expense.findMany({
            where: { date: { gte: start, lte: end } },
            orderBy: { date: 'asc' },
        })

        /* Ghi bù chi phí — dùng CHUNG postExpenseJournal với đường ghi lúc phát
         * sinh (routes/expenses.ts). Trước đây khối này có bộ map tài khoản
         * riêng và không tách VAT đầu vào, nên cùng một khoản chi ghi bù và ghi
         * live ra hai kết quả khác nhau. Phiếu đã hủy thì bỏ qua. */
        for (const exp of expenses) {
            if ((exp as any).status === 'cancelled' || (exp as any).status === 'pending') continue
            const ref = `EXP-${exp.id}`
            if (existingRefs.has(ref)) continue
            const r = await postExpenseJournal(prisma, exp as any, {
                branchId: exp.branchId || branchId, userId, vatKhauTru: !_hkdKhongKhauTru,
            })
            for (const entry of r.created) { created.push(entry); existingRefs.add(entry.ref) }
        }

        // ═══ 3. IMPORT RECEIPTS → Inventory + Payable journal entries ═══
        const imports = await prisma.importReceipt.findMany({
            where: { status: { not: 'draft' }, createdAt: { gte: start, lte: end } },
            orderBy: { createdAt: 'asc' },
        })

        /* Ghi bù phiếu nhập — dùng CHUNG postImportReceiptJournal với đường ghi
         * lúc phát sinh. Bản cũ ở đây chỉ ghi Nợ 156 = totalCost: bỏ mất VAT đầu
         * vào (1331), bỏ phí vận chuyển/thuế NK/chiết khấu khỏi giá vốn, và
         * không hề ghi phần đã trả tiền NCC → TK 331 phình mãi không giảm. */
        for (const imp of imports) {
            const ref = `IMP-${imp.code}`
            if (existingRefs.has(ref)) continue
            const r = await postImportReceiptJournal(prisma, imp as any, {
                branchId: imp.branchId || branchId, userId, vatKhauTru: !_hkdKhongKhauTru,
            })
            for (const entry of r.created) { created.push(entry); existingRefs.add(entry.ref) }
        }

        // ═══ 3b. RETURN ORDERS → giảm doanh thu + nhập lại kho ═══
        // Trả hàng trước đây không hề có mặt trong backfill: doanh thu trên sổ
        // giữ nguyên dù tiền đã trả lại khách.
        try {
            const rets = await prisma.returnOrder.findMany({
                where: { status: { in: ['refunded', 'exchanged'] }, createdAt: { gte: start, lte: end } },
                include: { items: true },
                orderBy: { createdAt: 'asc' },
            })
            for (const ret of rets) {
                if (existingRefs.has(`RET-${ret.code}`)) continue
                // Giá vốn hàng nhập lại: chỉ tính dòng đã đánh dấu restocked
                let giaVon = 0
                for (const it of (ret as any).items ?? []) {
                    if (!it.productId || !it.restocked) continue
                    const p = await prisma.product.findUnique({ where: { id: it.productId }, select: { costPrice: true } })
                    giaVon += (p?.costPrice ?? 0) * (it.quantity ?? 0)
                }
                let vatTra = 0
                if (ret.transactionId) {
                    const goc = await prisma.transaction.findUnique({ where: { id: ret.transactionId }, select: { tax: true, total: true } })
                    if (goc && goc.total > 0 && goc.tax > 0) vatTra = Math.round((ret.totalRefund || 0) * (goc.tax / goc.total))
                }
                const r = await postReturnJournal(prisma, {
                    code: ret.code, customerName: ret.customerName, originalInvoice: ret.originalInvoice,
                    totalRefund: ret.totalRefund || 0, refundMethod: ret.refundMethod,
                    costValue: giaVon, vatAmount: vatTra,
                    branchId: ret.branchId, createdAt: ret.createdAt,
                }, { branchId: ret.branchId || branchId, userId })
                for (const entry of r.created) { created.push(entry); existingRefs.add(entry.ref) }
            }
        } catch (e) { console.error('Backfill bút toán trả hàng lỗi (bỏ qua):', e) }

        // ═══ 4. PAYROLL → Salary expense journal entries ═══
        try {
            const payrollRecords = await prisma.payrollRecord.findMany({
                where: { year, ...(month ? { month } : {}) },
                orderBy: { employeeName: 'asc' },
            })

            if (payrollRecords.length > 0) {
                // Use actual PayrollRecord data
                for (const pr of payrollRecords) {
                    const ref = `PAY-${pr.employeeId}-${pr.year}-${pr.month}`
                    if (existingRefs.has(ref)) continue

                    const date = `${pr.year}-${String(pr.month).padStart(2, '0')}-25`
                    try {
                        // Nợ TK622 (CP nhân công), Có TK334 (Phải trả NLĐ) — Net salary
                        await prisma.journalEntry.create({
                            data: {
                                date, description: `Lương T${pr.month}/${pr.year} - ${pr.employeeName}`,
                                debitAccount: '622', debitAccountName: 'CP nhân công trực tiếp',
                                creditAccount: '334', creditAccountName: 'Phải trả người lao động',
                                amount: pr.totalCost, reference: ref, referenceType: 'payroll',
                                branchId, createdBy: userId,
                            }
                        })
                        created.push({ type: 'payroll', ref, amount: pr.totalCost })
                    } catch (_) { }

                    // BHXH employer contribution — Nợ TK622, Có TK3383
                    const bhxhER = (pr.bhxh_er || 0) + (pr.bhyt_er || 0) + (pr.bhtn_er || 0)
                    if (bhxhER > 0) {
                        const bhRef = `BH-${pr.employeeId}-${pr.year}-${pr.month}`
                        if (!existingRefs.has(bhRef)) {
                            try {
                                await prisma.journalEntry.create({
                                    data: {
                                        date, description: `BHXH công ty T${pr.month}/${pr.year} - ${pr.employeeName}`,
                                        debitAccount: '622', debitAccountName: 'CP nhân công trực tiếp',
                                        creditAccount: '3383', creditAccountName: 'BHXH, BHYT, BHTN',
                                        amount: bhxhER, reference: bhRef, referenceType: 'payroll',
                                        branchId, createdBy: userId,
                                    }
                                })
                                created.push({ type: 'payroll', ref: bhRef, amount: bhxhER })
                            } catch (_) { }
                        }
                    }
                }
            } else {
                // Fallback: auto-compute from User.salary for active employees
                const months = month ? [month] : Array.from({ length: 12 }, (_, i) => i + 1)
                const activeEmployees = await prisma.user.findMany({
                    where: { employeeStatus: 'active', salary: { gt: 0 } },
                    select: { id: true, name: true, salary: true, code: true },
                })

                for (const m of months) {
                    for (const emp of activeEmployees) {
                        const ref = `PAY-${emp.id}-${year}-${m}`
                        if (existingRefs.has(ref)) continue
                        if (!emp.salary || emp.salary <= 0) continue

                        const date = `${year}-${String(m).padStart(2, '0')}-25`
                        // Simple payroll: salary is the total cost
                        const salaryAmount = emp.salary
                        try {
                            await prisma.journalEntry.create({
                                data: {
                                    date, description: `Lương T${m}/${year} - ${emp.name}`,
                                    debitAccount: '622', debitAccountName: 'CP nhân công trực tiếp',
                                    creditAccount: '334', creditAccountName: 'Phải trả người lao động',
                                    amount: salaryAmount, reference: ref, referenceType: 'payroll',
                                    branchId, createdBy: userId,
                                }
                            })
                            created.push({ type: 'payroll', ref, amount: salaryAmount })
                        } catch (_) { }
                    }
                }
            }
        } catch (_) { /* PayrollRecord or User table might not exist */ }

        // ═══ 5. ONLINE ORDERS → E-commerce revenue journal entries ═══
        // Đơn sàn TMĐT: tiền NẰM BÊN SÀN tới khi rút — doanh thu ghi Nợ
        // 131-<SÀN> (phải thu pháp nhân Shopee/TikTok), KHÔNG ghi 111/112.
        // Phí sàn trừ vào phải thu: Nợ 641 / Có 131-<SÀN>. Khi sàn chuyển tiền
        // về tài khoản, kế toán ghi Nợ 112 / Có 131-<SÀN>.
        //
        // Dùng CÙNG bộ reference với đường Transaction (SALE-/FEE-/COGS-ONLINE-
        // <orderNumber>) — đơn đã convert thành Transaction (section 1) tự bị
        // skip, hết ghi sổ kép như bộ ref cũ (ONLINE-/PFEE-/OCOGS-).
        try {
            const onlineOrders = await (prisma as any).onlineOrder.findMany({
                where: { status: { in: ['completed', 'delivered', 'COMPLETED', 'DELIVERED'] }, createdAt: { gte: start, lte: end } },
                include: { items: { include: { product: { select: { costPrice: true } } } } },
                orderBy: { createdAt: 'asc' },
            })

            for (const ord of onlineOrders) {
                const saleRef = `SALE-ONLINE-${ord.orderNumber}`
                const cogsRef = `COGS-ONLINE-${ord.orderNumber}`
                // Bộ ref cũ (trước khi sửa nghiệp vụ) — nếu còn thì coi như đã ghi,
                // POST /admin/fix-online-journal sẽ chuyển chúng về bộ ref/TK mới.
                const legacyBooked = existingRefs.has(`ONLINE-${ord.orderNumber}`)

                const date = fmtDate(ord.createdAt)
                const revenue = ord.subtotal || (ord.total - (ord.shippingFee || 0))
                const ar = PLATFORM_AR[ord.platform] ?? PLATFORM_AR.online!

                // Revenue entry — Nợ 131-<SÀN> / Có 511
                if (revenue > 0 && !existingRefs.has(saleRef) && !legacyBooked) {
                    try {
                        await prisma.journalEntry.create({
                            data: {
                                date, description: `Bán hàng qua ${ar.label} ${ord.orderNumber}${ord.customerName ? ' - KH: ' + ord.customerName : ''}`,
                                debitAccount: ar.account, debitAccountName: ar.name,
                                creditAccount: '511', creditAccountName: 'Doanh thu bán hàng',
                                amount: revenue, reference: saleRef, referenceType: 'online',
                                branchId, createdBy: userId,
                            }
                        })
                        created.push({ type: 'online', ref: saleRef, amount: revenue })
                        existingRefs.add(saleRef)
                    } catch (_) { }
                }

                // Phí sàn KHÔNG book per-đơn — ghi nhận theo hoá đơn GTGT cuối kỳ
                // qua POST /api/tax/platform-fee-invoice (Nợ 641 + Nợ 133 / Có 131-<SÀN>).

                // COGS entry — Nợ 632 / Có 156
                if (!existingRefs.has(cogsRef) && !existingRefs.has(`OCOGS-${ord.orderNumber}`)) {
                    const cogsAmount = (ord.items || []).reduce((s: number, item: any) => {
                        const cost = item.product?.costPrice || 0
                        return s + (cost * item.quantity)
                    }, 0)
                    if (cogsAmount > 0) {
                        try {
                            await prisma.journalEntry.create({
                                data: {
                                    date, description: `Giá vốn online ${ord.orderNumber}`,
                                    debitAccount: '632', debitAccountName: 'Giá vốn hàng bán',
                                    creditAccount: '156', creditAccountName: 'Hàng hóa',
                                    amount: cogsAmount, reference: cogsRef, referenceType: 'cogs',
                                    branchId, createdBy: userId,
                                }
                            })
                            created.push({ type: 'cogs', ref: cogsRef, amount: cogsAmount })
                            existingRefs.add(cogsRef)
                        } catch (_) { }
                    }
                }
            }
        } catch (_) { /* OnlineOrder table might not exist */ }

        // ═══ 6. DEPRECIATION → Fixed asset depreciation journal entries ═══
        try {
            const assets = await (prisma as any).fixedAsset.findMany({
                where: { status: 'active', monthlyDepreciation: { gt: 0 } },
            })

            // Only create depreciation entries for the specific month (or each month in year)
            const depMonths = month ? [month] : Array.from({ length: 12 }, (_, i) => i + 1)
            for (const asset of assets) {
                for (const m of depMonths) {
                    const depRef = `DEP-${asset.code}-${year}-${String(m).padStart(2, '0')}`
                    if (existingRefs.has(depRef)) continue

                    const depDate = `${year}-${String(m).padStart(2, '0')}-28` // End of month
                    try {
                        await prisma.journalEntry.create({
                            data: {
                                date: depDate,
                                description: `Khấu hao T${m}/${year} - ${asset.name}`,
                                debitAccount: asset.depreciationAccount || '6274',
                                debitAccountName: 'CP khấu hao TSCĐ',
                                creditAccount: '214', creditAccountName: 'Hao mòn TSCĐ',
                                amount: asset.monthlyDepreciation, reference: depRef, referenceType: 'depreciation',
                                branchId, createdBy: userId,
                            }
                        })
                        created.push({ type: 'depreciation', ref: depRef, amount: asset.monthlyDepreciation })
                    } catch (_) { }
                }
            }
        } catch (_) { /* FixedAsset table might not exist */ }

        // Summary
        const summary = {
            totalCreated: created.length,
            sales: created.filter(c => c.type === 'sale').length,
            vat: created.filter(c => c.type === 'vat-out').length,
            cogs: created.filter(c => c.type === 'cogs').length,
            expenses: created.filter(c => c.type === 'expense').length,
            imports: created.filter(c => c.type === 'import').length,
            payroll: created.filter(c => c.type === 'payroll').length,
            online: created.filter(c => c.type === 'online').length,
            platformFees: created.filter(c => c.type === 'platform-fee').length,
            depreciation: created.filter(c => c.type === 'depreciation').length,
            totalAmount: created.reduce((s, c) => s + c.amount, 0),
        }

        res.json({ success: true, data: { created, summary } })
    } catch (err) { console.error('POST /auto-journal error:', err); res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// DELETE /api/tax/auto-journal?year=2026&month=3
// Removes all auto-generated journal entries for a period — i.e. anything
// whose referenceType is in AUTO_JOURNAL_REF_TYPES. Manual entries (default
// referenceType = 'manual') and closing entries are preserved. Lets the user
// "undo" a batch run so they can re-run after fixing source data.
router.delete('/auto-journal', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const year = Number(req.query.year) || new Date().getFullYear()
        const month = req.query.month ? Number(req.query.month) : undefined

        // JournalEntry.date is a string in YYYY-MM-DD — use string range to avoid date parsing issues.
        const dateGte = month ? `${year}-${String(month).padStart(2, '0')}-01` : `${year}-01-01`
        const dateLte = month ? `${year}-${String(month).padStart(2, '0')}-31` : `${year}-12-31`

        const result = await prisma.journalEntry.deleteMany({
            where: {
                referenceType: { in: [...AUTO_JOURNAL_REF_TYPES] },
                date: { gte: dateGte, lte: dateLte },
            },
        })

        const periodLabel = month ? `T${month}/${year}` : `năm ${year}`
        res.json({
            success: true,
            data: {
                deleted: result.count,
                periodLabel,
                referenceTypes: AUTO_JOURNAL_REF_TYPES,
            },
        })
    } catch (err) {
        console.error('DELETE /auto-journal error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ─── CLOSING ENTRIES (Kết chuyển cuối kỳ TK911) ──────────────────────────────

interface ClosingPlanItem {
    description: string
    debitAccount: string
    debitAccountName: string
    creditAccount: string
    creditAccountName: string
    amount: number
}

// Account map for closing: code → { name, normalBalance: 'credit' | 'debit' }
// Revenue/income accounts (credit balance) close TO TK911 via Nợ X / Có 911
// Expense/cost accounts (debit balance) close TO TK911 via Nợ 911 / Có X
const CLOSING_ACCOUNTS: { code: string; name: string; type: 'revenue' | 'expense' }[] = [
    { code: '511', name: 'Doanh thu bán hàng & CCDV', type: 'revenue' },
    { code: '515', name: 'DT hoạt động tài chính', type: 'revenue' },
    { code: '711', name: 'Thu nhập khác', type: 'revenue' },
    { code: '632', name: 'Giá vốn hàng bán', type: 'expense' },
    { code: '635', name: 'Chi phí tài chính', type: 'expense' },
    { code: '641', name: 'Chi phí bán hàng', type: 'expense' },
    { code: '642', name: 'Chi phí QLDN', type: 'expense' },
    { code: '811', name: 'Chi phí khác', type: 'expense' },
    { code: '821', name: 'Chi phí thuế TNDN', type: 'expense' },
]

/**
 * Compute closing plan from journal entries for a period.
 * For each P&L account, balance = sum(credit) - sum(debit) for revenue,
 * sum(debit) - sum(credit) for expenses. Then build the 8 transfer entries
 * + one result-transfer to TK421.
 *
 * `accountCode` may be a sub-account (e.g. '5111') — we match by prefix.
 */
function buildClosingPlan(entries: { debitAccount: string; creditAccount: string; amount: number }[], periodLabel: string): ClosingPlanItem[] {
    const plan: ClosingPlanItem[] = []

    let totalRevenue = 0 // credits to 911
    let totalExpense = 0 // debits from 911

    for (const acc of CLOSING_ACCOUNTS) {
        // Sum debit and credit for entries touching this account (or its sub-accounts)
        let debitSum = 0
        let creditSum = 0
        for (const e of entries) {
            if (e.debitAccount === acc.code || e.debitAccount?.startsWith(acc.code)) debitSum += e.amount
            if (e.creditAccount === acc.code || e.creditAccount?.startsWith(acc.code)) creditSum += e.amount
        }
        // Net balance to close
        const balance = acc.type === 'revenue' ? creditSum - debitSum : debitSum - creditSum
        if (balance <= 0) continue // nothing to close (or contra-balance — skip)

        if (acc.type === 'revenue') {
            // Nợ TKxxx / Có 911
            plan.push({
                description: `Kết chuyển ${acc.name} ${periodLabel}`,
                debitAccount: acc.code, debitAccountName: acc.name,
                creditAccount: '911', creditAccountName: 'Xác định KQKD',
                amount: balance,
            })
            totalRevenue += balance
        } else {
            // Nợ 911 / Có TKxxx
            plan.push({
                description: `Kết chuyển ${acc.name} ${periodLabel}`,
                debitAccount: '911', debitAccountName: 'Xác định KQKD',
                creditAccount: acc.code, creditAccountName: acc.name,
                amount: balance,
            })
            totalExpense += balance
        }
    }

    // Result transfer to TK421 (Lợi nhuận chưa phân phối)
    const profit = totalRevenue - totalExpense
    if (profit > 0) {
        plan.push({
            description: `Kết chuyển lãi ${periodLabel} sang TK421`,
            debitAccount: '911', debitAccountName: 'Xác định KQKD',
            creditAccount: '421', creditAccountName: 'LNST chưa phân phối',
            amount: profit,
        })
    } else if (profit < 0) {
        plan.push({
            description: `Kết chuyển lỗ ${periodLabel} sang TK421`,
            debitAccount: '421', debitAccountName: 'LNST chưa phân phối',
            creditAccount: '911', creditAccountName: 'Xác định KQKD',
            amount: -profit,
        })
    }

    return plan
}

// GET /api/tax/closing-entries/preview?year=2026&month=3
// Returns the planned closing entries without persisting them.
router.get('/closing-entries/preview', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const year = Number(req.query.year) || new Date().getFullYear()
        const month = req.query.month ? Number(req.query.month) : undefined
        const dateGte = month ? `${year}-${String(month).padStart(2, '0')}-01` : `${year}-01-01`
        const dateEnd = month ? `${year}-${String(month).padStart(2, '0')}-31` : `${year}-12-31`
        const periodLabel = month ? `T${month}/${year}` : `năm ${year}`

        const entries = await prisma.journalEntry.findMany({
            where: { date: { gte: dateGte, lte: dateEnd } },
            select: { debitAccount: true, creditAccount: true, amount: true },
        })

        const plan = buildClosingPlan(entries, periodLabel)
        const totalDebit = plan.reduce((s, p) => s + p.amount, 0)
        res.json({ success: true, data: { plan, periodLabel, totalDebit, totalCredit: totalDebit } })
    } catch (err) {
        console.error('GET /closing-entries/preview error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// POST /api/tax/closing-entries?year=2026&month=3
// Calculates and creates period-end closing entries (kết chuyển cuối kỳ TK911).
router.post('/closing-entries', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const year = Number(req.query.year) || new Date().getFullYear()
        const month = req.query.month ? Number(req.query.month) : undefined
        const dateGte = month ? `${year}-${String(month).padStart(2, '0')}-01` : `${year}-01-01`
        const dateEnd = month ? `${year}-${String(month).padStart(2, '0')}-31` : `${year}-12-31`
        const periodLabel = month ? `T${month}/${year}` : `năm ${year}`
        // Closing entry date = last day of period
        const closingDate = month
            ? new Date(year, month, 0).toISOString().slice(0, 10)
            : `${year}-12-31`

        const entries = await prisma.journalEntry.findMany({
            where: { date: { gte: dateGte, lte: dateEnd } },
            select: { debitAccount: true, creditAccount: true, amount: true, reference: true, referenceType: true },
        })

        // Idempotency: refuse to re-run if closing entries already exist for this period
        const closingRef = month ? `CLOSE-${year}-${String(month).padStart(2, '0')}` : `CLOSE-${year}`
        const existing = entries.filter(e => e.referenceType === 'closing' && e.reference?.startsWith(closingRef))
        if (existing.length > 0) {
            return res.status(409).json({
                success: false,
                error: `Đã có ${existing.length} bút toán kết chuyển cho kỳ ${periodLabel}. Xóa bút toán cũ trước khi tạo lại.`,
            })
        }

        const plan = buildClosingPlan(entries, periodLabel)
        if (plan.length === 0) {
            return res.status(400).json({ success: false, error: `Không có số dư nào để kết chuyển trong kỳ ${periodLabel}` })
        }

        const branchId = (req as any).branchId || null
        const userId = (req as any).userId || null
        const created: any[] = []
        for (let i = 0; i < plan.length; i++) {
            const p = plan[i]!
            try {
                const entry = await prisma.journalEntry.create({
                    data: {
                        date: closingDate,
                        description: p.description,
                        debitAccount: p.debitAccount, debitAccountName: p.debitAccountName,
                        creditAccount: p.creditAccount, creditAccountName: p.creditAccountName,
                        amount: p.amount,
                        reference: `${closingRef}-${String(i + 1).padStart(2, '0')}`,
                        referenceType: 'closing',
                        branchId, createdBy: userId,
                    },
                })
                created.push(entry)
            } catch (e) {
                console.error('Failed to create closing entry', p, e)
            }
        }

        res.status(201).json({
            success: true,
            data: {
                created,
                periodLabel,
                totalCreated: created.length,
                totalAmount: created.reduce((s, c) => s + (c.amount || 0), 0),
            },
        })
    } catch (err) {
        console.error('POST /closing-entries error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ── BALANCE SHEET (Bảng Cân Đối Kế Toán) ───────────────────────────────────

router.get('/balance-sheet', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const year = Number(req.query.year) || new Date().getFullYear()
        const month = req.query.month ? Number(req.query.month) : undefined
        const dateEnd = month ? `${year}-${String(month).padStart(2, '0')}-31` : `${year}-12-31`

        let entries: any[] = []
        try { entries = await prisma.journalEntry.findMany({ where: { date: { lte: dateEnd } } }) } catch (_) { }

        // Aggregate by account — compute net balance per account
        const accountBalances: Record<string, { debit: number; credit: number; name: string }> = {}
        for (const e of entries) {
            if (!accountBalances[e.debitAccount]) accountBalances[e.debitAccount] = { debit: 0, credit: 0, name: e.debitAccountName || '' }
            if (!accountBalances[e.creditAccount]) accountBalances[e.creditAccount] = { debit: 0, credit: 0, name: e.creditAccountName || '' }
            accountBalances[e.debitAccount].debit += e.amount
            accountBalances[e.creditAccount].credit += e.amount
        }

        // Classify accounts by VN chart of accounts
        const classify = (code: string) => {
            const c1 = code.charAt(0)
            if (c1 === '1') return 'asset'        // Tài sản
            if (c1 === '2') return 'asset'         // Tài sản dài hạn
            if (c1 === '3') return 'liability'     // Nợ phải trả
            if (c1 === '4') return 'equity'        // Vốn chủ sở hữu
            if (c1 === '5') return 'revenue'       // Doanh thu
            if (c1 === '6') return 'expense'       // Chi phí
            if (c1 === '7') return 'revenue'       // Thu nhập khác
            if (c1 === '8') return 'expense'       // Chi phí khác
            return 'other'
        }

        const assets: { code: string; name: string; balance: number }[] = []
        const liabilities: { code: string; name: string; balance: number }[] = []
        const equity: { code: string; name: string; balance: number }[] = []

        for (const [code, bal] of Object.entries(accountBalances)) {
            const cls = classify(code)
            const balance = bal.debit - bal.credit
            const item = { code, name: bal.name || code, balance: Math.abs(balance) }
            if (cls === 'asset') assets.push({ ...item, balance })
            else if (cls === 'liability') liabilities.push({ ...item, balance: -balance })
            else if (cls === 'equity') equity.push({ ...item, balance: -balance })
        }

        // Retained earnings = Revenue - Expenses (accumulated from journal)
        let retainedEarnings = 0
        for (const [code, bal] of Object.entries(accountBalances)) {
            const cls = classify(code)
            if (cls === 'revenue') retainedEarnings += (bal.credit - bal.debit)
            if (cls === 'expense') retainedEarnings -= (bal.debit - bal.credit)
        }
        if (retainedEarnings !== 0) {
            equity.push({ code: '421', name: 'Lợi nhuận chưa phân phối', balance: retainedEarnings })
        }

        const totalAssets = assets.reduce((s, a) => s + a.balance, 0)
        const totalLiabilities = liabilities.reduce((s, l) => s + l.balance, 0)
        const totalEquity = equity.reduce((s, e) => s + e.balance, 0)

        res.json({
            success: true, data: {
                assets: assets.sort((a, b) => a.code.localeCompare(b.code)),
                liabilities: liabilities.sort((a, b) => a.code.localeCompare(b.code)),
                equity: equity.sort((a, b) => a.code.localeCompare(b.code)),
                totalAssets, totalLiabilities, totalEquity,
                isBalanced: Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 1,
            }
        })
    } catch (err) { console.error('GET /balance-sheet error:', err); res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// ── INCOME STATEMENT (Báo Cáo Kết Quả Kinh Doanh) ──────────────────────────

router.get('/income-statement', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const year = Number(req.query.year) || new Date().getFullYear()
        const month = req.query.month ? Number(req.query.month) : undefined
        const dateGte = month ? `${year}-${String(month).padStart(2, '0')}-01` : `${year}-01-01`
        const dateEnd = month ? `${year}-${String(month).padStart(2, '0')}-31` : `${year}-12-31`

        let entries: any[] = []
        try { entries = await prisma.journalEntry.findMany({ where: { date: { gte: dateGte, lte: dateEnd } } }) } catch (_) { }

        // Also get raw transaction/expense data for supplemental info
        const start = month ? new Date(year, month - 1, 1) : new Date(year, 0, 1)
        const end = month ? new Date(year, month, 0, 23, 59, 59, 999) : new Date(year, 11, 31, 23, 59, 59, 999)

        const [txs, rawExpenses] = await Promise.all([
            prisma.transaction.findMany({ where: { status: { in: ['completed', 'partial'] }, createdAt: { gte: start, lte: end } }, select: { total: true, tax: true, subtotal: true, discount: true } }),
            prisma.expense.findMany({ where: { date: { gte: start, lte: end } }, select: { amount: true, category: true } }),
        ])

        // From journal entries
        const sumByAccount = (acctPrefix: string, side: 'debit' | 'credit') =>
            entries.filter(e => (side === 'debit' ? e.debitAccount : e.creditAccount).startsWith(acctPrefix))
                .reduce((s, e) => s + e.amount, 0)

        const revenue511 = sumByAccount('511', 'credit')      // Doanh thu bán hàng
        const discount521 = sumByAccount('521', 'debit')       // Chiết khấu
        const netRevenue = revenue511 - discount521
        const cogs632 = sumByAccount('632', 'debit')           // Giá vốn
        const grossProfit = netRevenue - cogs632
        const sellingExp641 = sumByAccount('641', 'debit')     // CP bán hàng
        const adminExp642 = sumByAccount('642', 'debit')       // CP QLDN
        const laborExp622 = sumByAccount('622', 'debit')       // CP nhân công
        const totalOpExp = sellingExp641 + adminExp642 + laborExp622
        const operatingProfit = grossProfit - totalOpExp
        const financialIncome515 = sumByAccount('515', 'credit')   // Doanh thu hoat dong tai chinh (TT200 line 21)
        const financialExpense635 = sumByAccount('635', 'debit')   // Chi phi tai chinh (TT200 line 22)
        const otherIncome711 = sumByAccount('711', 'credit')   // Thu nhap khac (TT200 line 31)
        const otherExpense811 = sumByAccount('811', 'debit')   // Chi phi khac (TT200 line 32)
        const profitBeforeTax = operatingProfit + financialIncome515 - financialExpense635 + otherIncome711 - otherExpense811
        const taxExpense = sumByAccount('3331', 'credit')      // Thuế GTGT
        const netIncome = profitBeforeTax  // Simplified — tax already in revenue

        // Raw data for supplemental info
        const totalRawRevenue = txs.reduce((s, t) => s + (t.subtotal || t.total || 0), 0)
        const totalRawExpenses = rawExpenses.reduce((s, e) => s + (e.amount || 0), 0)

        // Expense breakdown by category
        const expByCategory: Record<string, number> = {}
        rawExpenses.forEach(e => {
            const cat = (e as any).category || 'other'
            expByCategory[cat] = (expByCategory[cat] || 0) + (e.amount || 0)
        })

        res.json({
            success: true, data: {
                // Income Statement lines
                revenue: revenue511,
                discount: discount521,
                netRevenue,
                cogs: cogs632,
                grossProfit,
                sellingExpenses: sellingExp641,
                adminExpenses: adminExp642,
                laborExpenses: laborExp622,
                totalOperatingExpenses: totalOpExp,
                operatingProfit,
                financialIncome: financialIncome515,
                financialExpense: financialExpense635,
                otherIncome: otherIncome711,
                otherExpenses: otherExpense811,
                profitBeforeTax,
                taxExpense,
                netIncome,
                // Margin ratios
                grossMargin: totalRawRevenue > 0 ? (grossProfit / totalRawRevenue * 100) : 0,
                netMargin: totalRawRevenue > 0 ? (netIncome / totalRawRevenue * 100) : 0,
                // Supplemental
                txCount: txs.length,
                rawRevenue: totalRawRevenue,
                rawExpenses: totalRawExpenses,
                expenseBreakdown: Object.entries(expByCategory).map(([category, amount]) => ({ category, amount })),
            }
        })
    } catch (err) { console.error('GET /income-statement error:', err); res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// ── ACCOUNT BALANCES (Số dư tài khoản) ──────────────────────────────────────

router.get('/account-balances', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const year = Number(req.query.year) || new Date().getFullYear()
        const dateEnd = `${year}-12-31`

        let entries: any[] = []
        try { entries = await prisma.journalEntry.findMany({ where: { date: { lte: dateEnd } } }) } catch (_) { }

        const balances: Record<string, { debit: number; credit: number; name: string; count: number }> = {}
        for (const e of entries) {
            if (!balances[e.debitAccount]) balances[e.debitAccount] = { debit: 0, credit: 0, name: e.debitAccountName || '', count: 0 }
            if (!balances[e.creditAccount]) balances[e.creditAccount] = { debit: 0, credit: 0, name: e.creditAccountName || '', count: 0 }
            balances[e.debitAccount].debit += e.amount
            balances[e.debitAccount].count++
            balances[e.creditAccount].credit += e.amount
            balances[e.creditAccount].count++
        }

        const result = Object.entries(balances).map(([code, b]) => ({
            code, name: b.name, debit: b.debit, credit: b.credit,
            balance: b.debit - b.credit, count: b.count,
        })).sort((a, b) => a.code.localeCompare(b.code))

        res.json({ success: true, data: result })
    } catch (err) { console.error('GET /account-balances error:', err); res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// ── CASH FLOW STATEMENT (Báo Cáo Lưu Chuyển Tiền Tệ) ───────────────────────

router.get('/cash-flow', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const year = Number(req.query.year) || new Date().getFullYear()
        const month = req.query.month ? Number(req.query.month) : undefined
        const dateGte = month ? `${year}-${String(month).padStart(2, '0')}-01` : `${year}-01-01`
        const dateEnd = month ? `${year}-${String(month).padStart(2, '0')}-31` : `${year}-12-31`

        let entries: any[] = []
        try { entries = await prisma.journalEntry.findMany({ where: { date: { gte: dateGte, lte: dateEnd } } }) } catch (_) { }

        // Helper: sum amounts where cash accounts (111,112) are on debit or credit side
        const cashAccounts = ['111', '112', '1111', '1112', '1121', '1122']
        const isCash = (code: string) => cashAccounts.some(c => code.startsWith(c))

        // OPERATING ACTIVITIES — Cash from revenue (TK511→cash), Cash expenses (cash→TK6xx)
        let cashFromSales = 0, cashFromExpenses = 0, cashFromPayroll = 0, cashFromTax = 0
        // INVESTING — Fixed assets (TK211, TK213)
        let cashInvesting = 0
        // FINANCING — Loans (TK341), Equity (TK411)
        let cashFinancing = 0

        for (const e of entries) {
            const debitIsCash = isCash(e.debitAccount)
            const creditIsCash = isCash(e.creditAccount)

            if (debitIsCash) {
                // Cash inflow
                if (e.creditAccount.startsWith('511') || e.creditAccount.startsWith('512')) cashFromSales += e.amount
                else if (e.creditAccount.startsWith('131')) cashFromSales += e.amount // receivable collected
                else if (e.creditAccount.startsWith('711')) cashFromSales += e.amount // other income
                else if (e.creditAccount.startsWith('341') || e.creditAccount.startsWith('411')) cashFinancing += e.amount
                else if (e.creditAccount.startsWith('2')) cashInvesting += e.amount // asset disposal
            }
            if (creditIsCash) {
                // Cash outflow
                if (e.debitAccount.startsWith('6')) cashFromExpenses -= e.amount
                else if (e.debitAccount.startsWith('331')) cashFromExpenses -= e.amount // pay supplier
                else if (e.debitAccount.startsWith('334')) cashFromPayroll -= e.amount // pay salary
                else if (e.debitAccount.startsWith('333')) cashFromTax -= e.amount // pay tax
                else if (e.debitAccount.startsWith('2')) cashInvesting -= e.amount // buy assets
                else if (e.debitAccount.startsWith('341') || e.debitAccount.startsWith('411')) cashFinancing -= e.amount // repay loan
            }
        }

        const operatingCashFlow = cashFromSales + cashFromExpenses + cashFromPayroll + cashFromTax
        const netCashFlow = operatingCashFlow + cashInvesting + cashFinancing

        // Opening/closing cash — sum all cash account balances
        let allEntries: any[] = []
        try { allEntries = await prisma.journalEntry.findMany({ where: { date: { lte: dateEnd } } }) } catch (_) { }
        let openingEntries: any[] = []
        try { openingEntries = await prisma.journalEntry.findMany({ where: { date: { lt: dateGte } } }) } catch (_) { }

        let closingCash = 0, openingCash = 0
        for (const e of allEntries) {
            if (isCash(e.debitAccount)) closingCash += e.amount
            if (isCash(e.creditAccount)) closingCash -= e.amount
        }
        for (const e of openingEntries) {
            if (isCash(e.debitAccount)) openingCash += e.amount
            if (isCash(e.creditAccount)) openingCash -= e.amount
        }

        res.json({
            success: true, data: {
                operating: {
                    cashFromSales, cashFromExpenses, cashFromPayroll, cashFromTax,
                    total: operatingCashFlow,
                },
                investing: { total: cashInvesting },
                financing: { total: cashFinancing },
                netCashFlow, openingCash, closingCash,
            }
        })
    } catch (err) { console.error('GET /cash-flow error:', err); res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// ── SEED TEST DATA ──────────────────────────────────────────────────────────

router.post('/seed-test-data', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const userId = (req as any).userId || 'seed'
        const branchId = (req as any).branchId || null
        const doReset = req.query.reset === 'true'
        const counts = { transactions: 0, expenses: 0, imports: 0, onlineOrders: 0, fixedAssets: 0, payroll: 0, products: 0, customers: 0, suppliers: 0, returns: 0, warranties: 0, repairs: 0, branches: 0, schedules: 0, attendance: 0, salesCheckins: 0 }

        // ── Helpers ──
        const rng = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min
        const pick = <T>(arr: T[]) => arr[rng(0, arr.length - 1)]
        const pad = (n: number, l = 2) => String(n).padStart(l, '0')

        // 13 months: Mar 2025 → Mar 2026
        const months = [
            { year: 2025, month: 3 }, { year: 2025, month: 4 }, { year: 2025, month: 5 },
            { year: 2025, month: 6 }, { year: 2025, month: 7 }, { year: 2025, month: 8 },
            { year: 2025, month: 9 }, { year: 2025, month: 10 }, { year: 2025, month: 11 },
            { year: 2025, month: 12 }, { year: 2026, month: 1 }, { year: 2026, month: 2 },
            { year: 2026, month: 3 },
        ]
        const randDate = (y: number, m: number) => {
            const d = rng(1, 28)
            return new Date(y, m - 1, d, rng(8, 20), rng(0, 59))
        }

        // ═══ RESET (optional) ═══
        if (doReset) {
            console.log('🗑️ Resetting data...')
            const tables = [
                'JournalEntry', 'TransactionItem', 'TransactionPayment', 'Transaction',
                'Expense', 'ImportReceiptItem', 'ImportReceipt',
                'OnlineOrderItem', 'OnlineOrder', 'FixedAsset', 'PayrollRecord',
                'DebtEntry', 'ReturnItem', 'ReturnOrder', 'Warranty', 'Repair',
                'Schedule', 'Attendance', 'SalesCheckin',
                'Customer', 'Supplier', 'Product', 'Category', 'Brand',
            ]
            for (const t of tables) {
                try { await (prisma as any).$executeRawUnsafe(`TRUNCATE TABLE "${t}" CASCADE`) } catch (_) { }
            }
            console.log('✅ Reset complete')
        }

        // ═══ 1. CATEGORIES + PRODUCTS ═══
        const categoryNames = ['Điện thoại', 'Laptop', 'Tablet', 'Phụ kiện', 'Đồng hồ', 'Loa/Tai nghe']
        const categoryMap: Record<string, string> = {}
        for (const catName of categoryNames) {
            try {
                const cat = await (prisma as any).category.create({ data: { name: catName } })
                categoryMap[catName] = cat.id
            } catch (_) { }
        }
        // Fallback: if categories weren't created (already exist), load them
        if (Object.keys(categoryMap).length < 3) {
            const existing = await (prisma as any).category.findMany()
            for (const c of existing) categoryMap[c.name] = c.id
        }

        const sampleProducts = [
            { name: 'iPhone 15 Pro Max 256GB', sku: 'IP15PM-256', price: 34990000, costPrice: 28500000, cat: 'Điện thoại' },
            { name: 'iPhone 15 128GB', sku: 'IP15-128', price: 22990000, costPrice: 18500000, cat: 'Điện thoại' },
            { name: 'iPhone 14 128GB', sku: 'IP14-128', price: 17990000, costPrice: 14500000, cat: 'Điện thoại' },
            { name: 'Samsung Galaxy S24 Ultra', sku: 'SS-S24U', price: 31990000, costPrice: 25200000, cat: 'Điện thoại' },
            { name: 'Samsung Galaxy S24', sku: 'SS-S24', price: 22990000, costPrice: 18200000, cat: 'Điện thoại' },
            { name: 'Samsung Galaxy A15', sku: 'SS-A15', price: 4690000, costPrice: 3600000, cat: 'Điện thoại' },
            { name: 'OPPO Reno 11 5G', sku: 'OPPO-R11', price: 9990000, costPrice: 7800000, cat: 'Điện thoại' },
            { name: 'Xiaomi Redmi Note 13', sku: 'XM-RN13', price: 5490000, costPrice: 4200000, cat: 'Điện thoại' },
            { name: 'MacBook Air M3 13"', sku: 'MBA-M3-13', price: 27990000, costPrice: 23000000, cat: 'Laptop' },
            { name: 'MacBook Pro M3 14"', sku: 'MBP-M3-14', price: 42990000, costPrice: 35000000, cat: 'Laptop' },
            { name: 'Laptop Dell Inspiron 15', sku: 'DELL-I15', price: 15990000, costPrice: 12500000, cat: 'Laptop' },
            { name: 'iPad Air M2', sku: 'IPAD-M2', price: 16990000, costPrice: 13500000, cat: 'Tablet' },
            { name: 'iPad Gen 10', sku: 'IPAD-G10', price: 9990000, costPrice: 7800000, cat: 'Tablet' },
            { name: 'Samsung Galaxy Tab S9', sku: 'SGT-S9', price: 19990000, costPrice: 15800000, cat: 'Tablet' },
            { name: 'AirPods Pro 2 USB-C', sku: 'APP2-USBC', price: 5990000, costPrice: 4200000, cat: 'Phụ kiện' },
            { name: 'AirPods 3', sku: 'AP3-2022', price: 4290000, costPrice: 3100000, cat: 'Phụ kiện' },
            { name: 'Apple Watch Ultra 2', sku: 'AWU2-49', price: 21490000, costPrice: 17000000, cat: 'Đồng hồ' },
            { name: 'Apple Watch SE 2', sku: 'AWSE2', price: 6990000, costPrice: 5200000, cat: 'Đồng hồ' },
            { name: 'Samsung Galaxy Watch 6', sku: 'SGW6', price: 7490000, costPrice: 5800000, cat: 'Đồng hồ' },
            { name: 'JBL Flip 6', sku: 'JBL-F6', price: 2990000, costPrice: 1800000, cat: 'Loa/Tai nghe' },
            { name: 'Sony WH-1000XM5', sku: 'SONY-XM5', price: 7490000, costPrice: 5500000, cat: 'Loa/Tai nghe' },
            { name: 'Ốp lưng iPhone 15 PM', sku: 'CASE-IP15PM', price: 350000, costPrice: 80000, cat: 'Phụ kiện' },
            { name: 'Cáp sạc USB-C 2m', sku: 'CABLE-USBC', price: 250000, costPrice: 50000, cat: 'Phụ kiện' },
            { name: 'Kính cường lực iPhone', sku: 'GLASS-IP', price: 150000, costPrice: 25000, cat: 'Phụ kiện' },
            { name: 'Pin sạc dự phòng 20000mAh', sku: 'PB-20K', price: 690000, costPrice: 350000, cat: 'Phụ kiện' },
            { name: 'Chuột Logitech MX Master 3S', sku: 'LG-MXM3S', price: 2490000, costPrice: 1500000, cat: 'Phụ kiện' },
            { name: 'Bàn phím Logitech K380', sku: 'LG-K380', price: 890000, costPrice: 520000, cat: 'Phụ kiện' },
            { name: 'Bộ sạc nhanh 65W GaN', sku: 'CHRG-65W', price: 890000, costPrice: 380000, cat: 'Phụ kiện' },
            { name: 'Đế sạc không dây MagSafe', sku: 'MS-CHR', price: 990000, costPrice: 450000, cat: 'Phụ kiện' },
            { name: 'Túi chống sốc Laptop 14"', sku: 'BAG-14', price: 390000, costPrice: 150000, cat: 'Phụ kiện' },
        ]
        let products: any[] = []
        for (const p of sampleProducts) {
            const catId = categoryMap[p.cat]
            if (!catId) continue
            try {
                const created = await (prisma as any).product.create({
                    data: { name: p.name, sku: p.sku, barcode: p.sku, stock: rng(10, 200), costPrice: p.costPrice, sellingPrice: p.price, baseUnit: 'cái', categoryId: catId }
                })
                counts.products++
                products.push({ id: created.id, name: p.name, sku: p.sku, price: p.price, costPrice: p.costPrice })
            } catch (_) { }
        }
        if (products.length < 5) products = await (prisma as any).product.findMany({ take: 30 })

        // ═══ 2. CUSTOMERS (20) ═══
        const custData = [
            { name: 'Nguyễn Văn An', phone: '0901234567', email: 'an.nguyen@gmail.com', address: '123 Nguyễn Huệ, Q.1, HCM' },
            { name: 'Trần Thị Bình', phone: '0912345678', email: 'binh.tran@gmail.com', address: '456 Lê Lợi, Q.1, HCM' },
            { name: 'Lê Hoàng Dũng', phone: '0923456789', email: 'dung.le@yahoo.com', address: '789 Cách Mạng T8, Q.3, HCM' },
            { name: 'Phạm Minh Quân', phone: '0934567890', email: 'quan.pham@outlook.com', address: '12 Nguyễn Trãi, Q.5, HCM' },
            { name: 'Hoàng Thùy Linh', phone: '0945678901', email: 'linh.hoang@gmail.com', address: '34 Hai Bà Trưng, Q.1, HCM' },
            { name: 'Võ Đình Bảo', phone: '0956789012', email: 'bao.vo@gmail.com', address: '567 Điện Biên Phủ, Bình Thạnh' },
            { name: 'Đặng Kim Ngân', phone: '0967890123', email: 'ngan.dang@gmail.com', address: '89 Phan Xích Long, Phú Nhuận' },
            { name: 'Bùi Thanh Tùng', phone: '0978901234', email: 'tung.bui@gmail.com', address: '101 Quang Trung, Gò Vấp' },
            { name: 'Ngô Thị Mai', phone: '0989012345', email: 'mai.ngo@gmail.com', address: '202 Lý Thường Kiệt, Q.10' },
            { name: 'Huỳnh Gia Huy', phone: '0990123456', email: 'huy.huynh@gmail.com', address: '303 Võ Văn Tần, Q.3' },
            { name: 'Trương Thị Hà', phone: '0901112233', email: 'ha.truong@gmail.com', address: '15 NTM Khai, Q.1' },
            { name: 'Lý Quốc Đạt', phone: '0912223344', email: 'dat.ly@gmail.com', address: '42 Trần Hưng Đạo, Q.5' },
            { name: 'Đinh Thế Anh', phone: '0923334455', email: 'anh.dinh@gmail.com', address: '77 Nguyễn Văn Cừ, Q.5' },
            { name: 'Phan Như Quỳnh', phone: '0934445566', email: 'quynh.phan@gmail.com', address: '158 Pasteur, Q.3' },
            { name: 'CT TNHH Minh Phát', phone: '02838123456', email: 'minhphat@corp.vn', address: '27 NĐ Chiểu, Q.3' },
            { name: 'CT Bách Khoa Tech', phone: '02839876543', email: 'bktech@corp.vn', address: '100 Tô Hiến Thành, Q.10' },
            { name: 'GĐ Trần Minh Tuấn', phone: '0908765432', email: 'tuan.tran@biz.vn', address: '201 Lũy Bán Bích, Tân Phú' },
            { name: 'Café An Nhiên', phone: '0918765432', email: 'annhien@cafe.vn', address: '35 Nguyễn Huệ, Q.1' },
            { name: 'CH Thiên Long', phone: '0928765432', email: 'thienlong@shop.vn', address: '88 Trần Quốc Toản, Q.3' },
            { name: 'Vũ Hoàng Nam', phone: '0938765432', email: 'nam.vu@gmail.com', address: '55 Lạc Long Quân, Tân Bình' },
        ]
        let customers: any[] = []
        for (let i = 0; i < custData.length; i++) {
            try {
                const c = await prisma.customer.create({ data: { code: `KH-${pad(i + 1, 3)}`, name: custData[i].name, phone: custData[i].phone, email: custData[i].email, address: custData[i].address } })
                customers.push(c)
                counts.customers++
            } catch (_) { }
        }
        if (customers.length < 5) try { customers = await prisma.customer.findMany({ take: 20 }) } catch (_) { }

        // ═══ 3. SUPPLIERS (8) ═══
        const supplierData = [
            { name: 'Công ty TNHH Apple Việt Nam', phone: '02838001001', email: 'apple.vn@supplier.com', address: '1 Lê Duẩn, Q.1, HCM', contact: 'Nguyễn Văn Hùng' },
            { name: 'Samsung Vina Electronics', phone: '02838002002', email: 'samsung.vn@supplier.com', address: 'KCN Yên Phong, Bắc Ninh', contact: 'Trần Quốc Bảo' },
            { name: 'Phụ Kiện Sài Gòn JSC', phone: '02838003003', email: 'pksg@supplier.com', address: '112 NTM Khai, Q.3, HCM', contact: 'Lê Minh Đức' },
            { name: 'Synnex FPT Distribution', phone: '02838004004', email: 'synnex@fpt.com.vn', address: '89 Lê Thánh Tôn, Q.1', contact: 'Phạm Hồng Phúc' },
            { name: 'Digiworld Corporation', phone: '02838005005', email: 'digiworld@dw.com.vn', address: 'Tầng 12, Etown, Tân Bình', contact: 'Hoàng Minh Tuệ' },
            { name: 'JBL & Harman Vietnam', phone: '02838006006', email: 'jbl.vn@harman.com', address: '45 Trường Sơn, Tân Bình', contact: 'Vũ Đức Thắng' },
            { name: 'Logitech Asia Pacific', phone: '02838007007', email: 'logitech@logi.com', address: '15 NK Khởi Nghĩa, Q.1', contact: 'Đàm Thu Hà' },
            { name: 'Dell Technologies VN', phone: '02838008008', email: 'dell.vn@dell.com', address: '30 LT Tôn, Q.1', contact: 'Nguyễn Đình Quang' },
        ]
        for (let i = 0; i < supplierData.length; i++) {
            try {
                await (prisma as any).supplier.create({ data: { code: `NCC-${pad(i + 1, 3)}`, name: supplierData[i].name, phone: supplierData[i].phone, email: supplierData[i].email, address: supplierData[i].address, contactName: supplierData[i].contact } })
                counts.suppliers++
            } catch (_) { }
        }
        const supplierNames = supplierData.map(s => s.name)

        // ═══ 4. USER for createdBy ═══
        let createdByUser: any = null
        try { createdByUser = await prisma.user.findFirst() } catch (_) { }
        const creatorId = createdByUser?.id || userId
        const creatorName = createdByUser?.name || 'Nhân viên'

        // ═══ 5. TRANSACTIONS (seasonal: ~400 total over 13 months) ═══
        for (const { year, month } of months) {
            let baseCount = 30
            if (month === 12) baseCount = 50
            else if (month === 1 || month === 2) baseCount = 40
            else if (month >= 6 && month <= 8) baseCount = 20

            const txCount = rng(baseCount - 5, baseCount + 5)
            for (let t = 0; t < txCount; t++) {
                const date = randDate(year, month)
                const itemCount = rng(1, 4)
                const txItems: any[] = []
                let subtotal = 0

                for (let j = 0; j < itemCount; j++) {
                    const product = pick(products)
                    const qty = rng(1, 3)
                    const disc = rng(0, 5) === 0 ? rng(50000, 500000) : 0
                    const lineTotal = (product.price * qty) - disc
                    txItems.push({ productId: product.id, productName: product.name, sku: product.sku, quantity: qty, unitPrice: product.price, discount: disc, lineTotal })
                    subtotal += lineTotal
                }

                const taxRate = 0.1
                const tax = Math.round(subtotal * taxRate)
                const total = subtotal + tax
                const payType = pick(['cash', 'cash', 'cash', 'bank', 'transfer'])
                const isPaid = rng(1, 10) <= 8
                const amountReceived = isPaid ? total : 0
                const cust = rng(1, 3) <= 2 ? pick(customers) : null
                const receipt = `HCM-${year}${pad(month)}${pad(t + 1, 4)}`

                try {
                    await prisma.transaction.create({
                        data: {
                            receiptNumber: receipt,
                            customerId: cust?.id || null, customerName: cust?.name || null, customerPhone: cust?.phone || null,
                            branchId, subtotal, discount: 0, tax, total,
                            amountReceived, change: Math.max(0, amountReceived - total),
                            status: 'completed',
                            createdBy: creatorId, createdByName: creatorName,
                            transactionDate: date, createdAt: date,
                            items: { create: txItems },
                            payments: isPaid ? { create: [{ type: payType, amount: total }] } : undefined,
                        }
                    })
                    counts.transactions++
                } catch (_) { }
            }
        }

        // ═══ 6. EXPENSES (monthly fixed + variable) ═══
        const expCategories = [
            { cat: 'rent', desc: 'Thuê mặt bằng cửa hàng', min: 18000000, max: 22000000, monthly: true },
            { cat: 'utilities', desc: 'Điện nước', min: 3500000, max: 7000000, monthly: true },
            { cat: 'salary', desc: 'Lương nhân viên cửa hàng', min: 35000000, max: 55000000, monthly: true },
            { cat: 'transport', desc: 'Chi phí vận chuyển hàng', min: 2000000, max: 5000000, monthly: true },
            { cat: 'marketing', desc: 'Quảng cáo online', min: 5000000, max: 15000000, monthly: false },
            { cat: 'maintenance', desc: 'Bảo trì sửa chữa', min: 500000, max: 3000000, monthly: false },
            { cat: 'supplies', desc: 'Văn phòng phẩm', min: 300000, max: 1500000, monthly: false },
            { cat: 'insurance', desc: 'Bảo hiểm cửa hàng', min: 2000000, max: 4000000, monthly: false },
            { cat: 'other', desc: 'Chi phí khác', min: 300000, max: 2000000, monthly: false },
        ]
        for (const { year, month } of months) {
            for (const ec of expCategories.filter(c => c.monthly)) {
                const date = randDate(year, month)
                try {
                    await prisma.expense.create({ data: { description: `${ec.desc} T${month}/${year}`, amount: rng(ec.min, ec.max), category: ec.cat, date, paidBy: ec.cat === 'rent' ? 'bank' : pick(['cash', 'bank']), branchId } })
                    counts.expenses++
                } catch (_) { }
            }
            for (let e = 0; e < rng(2, 5); e++) {
                const ec = pick(expCategories.filter(c => !c.monthly))
                try {
                    await prisma.expense.create({ data: { description: `${ec.desc} T${month}/${year}`, amount: rng(ec.min, ec.max), category: ec.cat, date: randDate(year, month), paidBy: pick(['cash', 'bank']), branchId } })
                    counts.expenses++
                } catch (_) { }
            }
        }

        // ═══ 7. IMPORT RECEIPTS (3-6 per month) ═══
        for (const { year, month } of months) {
            const impCount = rng(3, 6)
            for (let i = 0; i < impCount; i++) {
                const date = randDate(year, month)
                const supplier = pick(supplierNames)
                const itemCount = rng(2, 5)
                let totalCost = 0
                const items: any[] = []
                for (let j = 0; j < itemCount; j++) {
                    const p = pick(products)
                    const qty = rng(5, 30)
                    const cost = p.costPrice || rng(500000, 20000000)
                    totalCost += cost * qty
                    items.push({ productId: p.id, productName: p.name, sku: p.sku, quantity: qty, unitCost: cost, lineTotal: cost * qty })
                }
                const code = `IMP-HCM-${year}${pad(month)}${pad(i + 1, 3)}`
                try {
                    await prisma.importReceipt.create({
                        data: { code, supplierName: supplier, totalCost, totalItems: items.reduce((s: number, it: any) => s + it.quantity, 0), status: 'completed', branchId, userId: creatorId, userName: creatorName, transactionDate: date, createdAt: date, items: { create: items } }
                    })
                    counts.imports++
                } catch (_) { }
            }
        }

        // ═══ 8. ONLINE ORDERS (5-8 per month) ═══
        const platforms = ['Shopee', 'Lazada', 'Tiki', 'TikTok Shop']
        const customerNames = custData.map(c => c.name)
        const customerPhones = custData.map(c => c.phone)
        for (const { year, month } of months) {
            for (let o = 0; o < rng(5, 8); o++) {
                const date = randDate(year, month)
                const platform = pick(platforms)
                const itemCount = rng(1, 3)
                let subtotal = 0
                const items: any[] = []
                for (let j = 0; j < itemCount; j++) {
                    const p = pick(products)
                    const qty = rng(1, 2)
                    const disc = rng(0, 3) === 0 ? rng(50000, 200000) : 0
                    const lineTotal = (p.price * qty) - disc
                    subtotal += lineTotal
                    items.push({ productId: p.id, productName: p.name, sku: p.sku, quantity: qty, unitPrice: p.price, discount: disc, lineTotal })
                }
                const shippingFee = rng(0, 50000)
                const total = subtotal + shippingFee
                const feeRate = platform === 'Shopee' ? 0.06 : platform === 'Lazada' ? 0.05 : platform === 'Tiki' ? 0.04 : 0.03
                const platformFee = Math.round(subtotal * feeRate)
                const isPaid = rng(1, 10) <= 7
                try {
                    await (prisma as any).onlineOrder.create({
                        data: {
                            orderNumber: `ON-${platform.substring(0, 2).toUpperCase()}-${year}${pad(month)}${pad(o + 1, 3)}`,
                            platform, customerName: pick(customerNames), customerPhone: pick(customerPhones),
                            status: pick(['completed', 'delivered']),
                            subtotal, discount: 0, shippingFee, total,
                            paymentMethod: 'bank', paymentStatus: isPaid ? 'paid' : 'unpaid',
                            paidAt: isPaid ? date : null,
                            platformFee, platformFeeRate: feeRate, netRevenue: total - platformFee,
                            createdAt: date, updatedAt: date,
                            items: { create: items },
                        }
                    })
                    counts.onlineOrders++
                } catch (_) { }
            }
        }

        // ═══ 9. FIXED ASSETS ═══
        const assets = [
            { code: 'FA-HCM-001', name: 'Tủ trưng bày kính cường lực', category: 'furniture', originalCost: 45000000, usefulLifeMonths: 60 },
            { code: 'FA-HCM-002', name: 'Máy tính POS Dell', category: 'machine', originalCost: 18000000, usefulLifeMonths: 36 },
            { code: 'FA-HCM-003', name: 'Camera an ninh Hikvision', category: 'machine', originalCost: 12000000, usefulLifeMonths: 48 },
            { code: 'FA-HCM-004', name: 'Biển hiệu LED cửa hàng', category: 'furniture', originalCost: 25000000, usefulLifeMonths: 60 },
            { code: 'FA-HCM-005', name: 'Máy in hóa đơn Epson', category: 'machine', originalCost: 8500000, usefulLifeMonths: 36 },
        ]
        for (const a of assets) {
            const monthly = Math.round(a.originalCost / a.usefulLifeMonths)
            try {
                await (prisma as any).fixedAsset.create({
                    data: { ...a, acquisitionDate: '2025-03-01', method: 'straight-line', monthlyDepreciation: monthly, accumulatedDepreciation: 0, netBookValue: a.originalCost, depreciationAccount: '6274', status: 'active' }
                })
                counts.fixedAssets++
            } catch (_) { }
        }

        // ═══ 10. PAYROLL ═══
        try {
            const employees = await prisma.user.findMany({ where: { salary: { gt: 0 } }, select: { id: true, name: true, salary: true } })
            for (const { year, month } of months) {
                for (const emp of employees) {
                    try {
                        await (prisma as any).payrollRecord.create({
                            data: {
                                month, year, employeeId: emp.id, employeeName: emp.name || 'NV',
                                grossSalary: emp.salary, netSalary: Math.round((emp.salary || 0) * 0.895),
                                totalCost: Math.round((emp.salary || 0) * 1.215),
                                bhxh_emp: Math.round((emp.salary || 0) * 0.08),
                                bhyt_emp: Math.round((emp.salary || 0) * 0.015),
                                bhtn_emp: Math.round((emp.salary || 0) * 0.01),
                                bhxh_er: Math.round((emp.salary || 0) * 0.175),
                                bhyt_er: Math.round((emp.salary || 0) * 0.03),
                                bhtn_er: Math.round((emp.salary || 0) * 0.01),
                                pit: 0,
                            }
                        })
                        counts.payroll++
                    } catch (_) { }
                }
            }
        } catch (_) { }

        // ═══ 11. RETURN ORDERS (~3 per month) ═══
        const returnReasons = ['Hàng lỗi', 'Sai sản phẩm', 'Không đúng mô tả', 'Khách đổi ý', 'Hàng hư hỏng khi vận chuyển']
        const returnConditions = ['new', 'used', 'damaged', 'defective']
        const refundMethods = ['cash', 'bank_transfer', 'store_credit', 'exchange']
        for (const { year, month } of months) {
            const retCount = rng(2, 4)
            for (let r = 0; r < retCount; r++) {
                const date = randDate(year, month)
                const cust = pick(customers)
                const code = `RET-HCM-${year}${pad(month)}${pad(r + 1, 3)}`
                const originalInvoice = `HCM-${year}${pad(month)}${pad(rng(1, 20), 4)}`
                const itemCount = rng(1, 2)
                const retItems: any[] = []
                let totalRefund = 0
                for (let j = 0; j < itemCount; j++) {
                    const p = pick(products)
                    const qty = 1
                    totalRefund += p.price
                    retItems.push({ productName: p.name, sku: p.sku, quantity: qty, unitPrice: p.price, returnReason: pick(returnReasons), condition: pick(returnConditions) })
                }
                try {
                    await (prisma as any).returnOrder.create({
                        data: {
                            code, originalInvoice, customerName: cust.name, customerPhone: cust.phone,
                            reason: pick(returnReasons), refundMethod: pick(refundMethods),
                            refundAmount: totalRefund, totalRefund,
                            status: pick(['approved', 'refunded', 'exchanged', 'processing']),
                            staffName: creatorName, branchId,
                            createdAt: date, updatedAt: date,
                            processedAt: rng(1, 3) <= 2 ? new Date(date.getTime() + rng(1, 3) * 86400000) : null,
                            items: { create: retItems },
                        }
                    })
                    counts.returns++
                } catch (_) { }
            }
        }

        // ═══ 12. WARRANTIES (~5 per month) ═══
        for (const { year, month } of months) {
            const warCount = rng(3, 6)
            for (let w = 0; w < warCount; w++) {
                const p = pick(products.filter(pr => pr.price > 5000000)) || pick(products)
                const cust = pick(customers)
                const startDate = randDate(year, month)
                const warrantyMonths = pick([6, 12, 18, 24])
                const endDate = new Date(startDate.getTime() + warrantyMonths * 30 * 86400000)
                const code = `WR-HCM-${year}${pad(month)}${pad(w + 1, 3)}`
                try {
                    await (prisma as any).warranty.create({
                        data: {
                            code, productId: p.id, productName: p.name,
                            customerName: cust.name, customerPhone: cust.phone,
                            serialNumber: `SN-${p.sku}-${rng(10000, 99999)}`,
                            startDate, endDate,
                            status: endDate > new Date() ? 'active' : 'expired',
                            notes: `Bảo hành ${warrantyMonths} tháng`,
                        }
                    })
                    counts.warranties++
                } catch (_) { }
            }
        }

        // ═══ 13. REPAIRS (~2 per month) ═══
        const repairIssues = ['Màn hình bị vỡ', 'Pin chai không giữ sạc', 'Không nhận sạc', 'Loa bị rè', 'Camera mờ', 'Nút nguồn kẹt', 'Wifi yếu', 'Sọc màn hình', 'Mất vân tay', 'Phần mềm lỗi']
        const repairStatuses = ['received', 'diagnosing', 'repairing', 'completed', 'delivered']
        for (const { year, month } of months) {
            const repCount = rng(1, 3)
            for (let r = 0; r < repCount; r++) {
                const p = pick(products.filter(pr => pr.price > 3000000)) || pick(products)
                const cust = pick(customers)
                const date = randDate(year, month)
                const cost = rng(200000, 5000000)
                const code = `REP-HCM-${year}${pad(month)}${pad(r + 1, 3)}`
                const status = pick(repairStatuses)
                try {
                    await (prisma as any).repair.create({
                        data: {
                            code, productName: p.name,
                            customerName: cust.name, customerPhone: cust.phone,
                            issue: pick(repairIssues), status, cost,
                            estimatedDate: new Date(date.getTime() + rng(3, 7) * 86400000),
                            completedDate: (status === 'completed' || status === 'delivered') ? new Date(date.getTime() + rng(3, 10) * 86400000) : null,
                            notes: `Sửa chữa ${p.name}`,
                            createdAt: date, updatedAt: date,
                        }
                    })
                    counts.repairs++
                } catch (_) { }
            }
        }

        // ═══ 14. BRANCHES ═══
        const branchData = [
            { name: 'Chi nhánh Q.7', code: 'HCM-Q7', address: '123 Nguyễn Thị Thập, Q.7, HCM', phone: '02837001001' },
            { name: 'Chi nhánh Thủ Đức', code: 'HCM-TD', address: '456 Võ Văn Ngân, TP.Thủ Đức, HCM', phone: '02837002002' },
            { name: 'Chi nhánh Bình Tân', code: 'HCM-BT', address: '789 Lê Văn Quới, Bình Tân, HCM', phone: '02837003003' },
        ]
        for (const b of branchData) {
            try {
                await (prisma as any).branch.create({ data: { name: b.name, code: b.code, address: b.address, phone: b.phone, status: 'active' } })
                counts.branches++
            } catch (_) { }
        }

        // ═══ 15. SCHEDULES (lịch ca) ═══
        const shiftTypes = ['morning', 'afternoon', 'evening']
        const shiftLabels: Record<string, string> = { morning: 'Ca sáng (8:00-14:00)', afternoon: 'Ca chiều (14:00-20:00)', evening: 'Ca tối (18:00-22:00)' }
        try {
            const allUsers = await prisma.user.findMany({ select: { id: true, name: true } })
            if (allUsers.length > 0) {
                for (const { year, month } of months) {
                    const daysInMonth = new Date(year, month, 0).getDate()
                    for (let d = 1; d <= daysInMonth; d++) {
                        const date = new Date(year, month - 1, d)
                        const dayOfWeek = date.getDay()
                        // Skip some Sundays randomly
                        if (dayOfWeek === 0 && rng(1, 3) <= 2) continue
                        // Assign 1-2 users per shift, 2 shifts per day
                        const dayShifts = dayOfWeek === 6 ? ['morning', 'afternoon'] : ['morning', 'afternoon']
                        for (const shift of dayShifts) {
                            const user = pick(allUsers)
                            try {
                                await (prisma as any).schedule.create({
                                    data: { userId: user.id, userName: user.name || 'NV', date, shift, status: pick(['scheduled', 'confirmed']), branchId, notes: shiftLabels[shift] }
                                })
                                counts.schedules++
                            } catch (_) { }
                        }
                    }
                }
            }
        } catch (_) { }

        // ═══ 16. ATTENDANCE (chấm công) ═══
        try {
            const allUsers = await prisma.user.findMany({ select: { id: true, name: true, role: true } })
            if (allUsers.length > 0) {
                for (const { year, month } of months) {
                    const daysInMonth = new Date(year, month, 0).getDate()
                    for (let d = 1; d <= daysInMonth; d++) {
                        const date = new Date(year, month - 1, d)
                        const dayOfWeek = date.getDay()
                        if (dayOfWeek === 0) continue // Chủ nhật nghỉ
                        for (const user of allUsers) {
                            // 90% đi làm, 5% nghỉ phép, 5% vắng
                            const rand = rng(1, 100)
                            let status = 'present'
                            let checkIn: Date | null = null
                            let checkOut: Date | null = null
                            let note: string | null = null
                            if (rand <= 90) {
                                status = 'present'
                                const inH = rng(7, 8), inM = rng(0, 59)
                                checkIn = new Date(year, month - 1, d, inH, inM)
                                const outH = rng(17, 19), outM = rng(0, 59)
                                checkOut = new Date(year, month - 1, d, outH, outM)
                                if (inH >= 8 && inM > 15) { status = 'late'; note = 'Đi trễ ' + inM + ' phút' }
                            } else if (rand <= 95) {
                                status = 'leave'
                                note = pick(['Nghỉ phép', 'Nghỉ ốm', 'Việc gia đình'])
                            } else {
                                status = 'absent'
                                note = 'Vắng không phép'
                            }
                            try {
                                await (prisma as any).attendance.create({
                                    data: { userId: user.id, userName: user.name || 'NV', role: user.role, date, checkIn, checkOut, status, note, branchId }
                                })
                                counts.attendance++
                            } catch (_) { }
                        }
                    }
                }
            }
        } catch (_) { }

        // ═══ 17. SALES CHECKINS (giám sát sale) ═══
        const hcmLocations = [
            { lat: 10.7769, lng: 106.7009, addr: '123 Nguyễn Huệ, Q.1, HCM' },
            { lat: 10.7731, lng: 106.6982, addr: '456 Lê Lợi, Q.1, HCM' },
            { lat: 10.7867, lng: 106.6802, addr: '789 CMT8, Q.3, HCM' },
            { lat: 10.7588, lng: 106.6683, addr: '12 Nguyễn Trãi, Q.5, HCM' },
            { lat: 10.8017, lng: 106.7148, addr: '34 Hai Bà Trưng, Q.1, HCM' },
            { lat: 10.8113, lng: 106.6813, addr: '101 Quang Trung, Gò Vấp' },
            { lat: 10.7942, lng: 106.6753, addr: '89 Phan Xích Long, Phú Nhuận' },
            { lat: 10.7657, lng: 106.6652, addr: '202 Lý Thường Kiệt, Q.10' },
            { lat: 10.7356, lng: 106.7241, addr: '55 Nguyễn Thị Thập, Q.7' },
            { lat: 10.8488, lng: 106.7713, addr: '456 Võ Văn Ngân, Thủ Đức' },
        ]
        const checkinTypes = ['check_in', 'check_out', 'visit']
        const visitNotes = ['Gặp KH tư vấn sản phẩm mới', 'Thu nợ khách hàng', 'Giao hàng tận nơi', 'Khảo sát thị trường', 'Chăm sóc khách hàng cũ', 'Giới thiệu chương trình khuyến mãi', 'Thu thập feedback', 'Demo sản phẩm tại cửa hàng KH']
        try {
            const salesUsers = await prisma.user.findMany({ select: { id: true, name: true } })
            if (salesUsers.length > 0) {
                for (const { year, month } of months) {
                    const daysInMonth = new Date(year, month, 0).getDate()
                    for (let d = 1; d <= daysInMonth; d++) {
                        const dayOfWeek = new Date(year, month - 1, d).getDay()
                        if (dayOfWeek === 0) continue
                        const checkinCount = rng(3, 6)
                        for (let c = 0; c < checkinCount; c++) {
                            const user = pick(salesUsers)
                            const loc = pick(hcmLocations)
                            const type = pick(checkinTypes)
                            const hour = type === 'check_in' ? rng(7, 9) : type === 'check_out' ? rng(17, 19) : rng(9, 17)
                            const cust = type === 'visit' ? pick(customers) : null
                            const createdAt = new Date(year, month - 1, d, hour, rng(0, 59))
                            try {
                                await (prisma as any).salesCheckin.create({
                                    data: {
                                        userId: user.id, type,
                                        latitude: loc.lat + (Math.random() - 0.5) * 0.005,
                                        longitude: loc.lng + (Math.random() - 0.5) * 0.005,
                                        address: loc.addr,
                                        note: type === 'visit' ? pick(visitNotes) : type === 'check_in' ? 'Check-in đầu ca' : 'Check-out cuối ca',
                                        customerId: cust?.id || null,
                                        customerName: cust?.name || null,
                                        createdAt,
                                    }
                                })
                                counts.salesCheckins++
                            } catch (_) { }
                        }
                    }
                }
            }
        } catch (_) { }

        res.json({
            success: true,
            message: `Đã tạo data 13 tháng (T3/2025 – T3/2026)${doReset ? ' (đã xóa data cũ)' : ''}`,
            data: counts,
        })
    } catch (err) { console.error('POST /seed-test-data error:', err); res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// NOTE: export default router moved to end of file — sau các route HKD S1-S7
// ===============================================================
//  HKD ACCOUNTING BOOKS (S1-S7) - TT88/2021/TT-BTC
// ===============================================================

function hkdDateRange(year: number, month?: number) {
    // new Date(year, month, day) đã tạo local time — không cần convert thêm
    // DB lưu UTC, Prisma tự handle timezone khi query
    let start: Date, end: Date
    if (month) {
        start = new Date(year, month - 1, 1, 0, 0, 0, 0)
        end = new Date(year, month, 0, 23, 59, 59, 999)
    } else {
        start = new Date(year, 0, 1, 0, 0, 0, 0)
        end = new Date(year, 11, 31, 23, 59, 59, 999)
    }
    return { start, end }
}
const fmtDate = (d: any) => { try { return new Date(d).toLocaleDateString('en-CA') } catch { return '' } } // en-CA = YYYY-MM-DD format, uses local timezone

// S1: Doanh thu
router.get('/hkd/s1', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const p = req.storePrisma! as any
        const year = Number(req.query.year) || new Date().getFullYear()
        const month = req.query.month ? Number(req.query.month) : undefined
        const { start, end } = hkdDateRange(year, month)
        // Filter by transactionDate if set, otherwise by createdAt
        const txs = await p.transaction.findMany({
            where: {
                status: { in: ['completed', 'partial'] },
                OR: [
                    { transactionDate: { gte: start, lte: end } },
                    { transactionDate: null, createdAt: { gte: start, lte: end } },
                ]
            },
            orderBy: [{ transactionDate: 'desc' }, { createdAt: 'desc' }]
        })
        // Phiếu nào ĐÃ XUẤT HOÁ ĐƠN ĐIỆN TỬ (issued/SENT) — để sổ doanh thu lọc được
        // "chỉ báo cáo hoá đơn đã xuất". Bảng EInvoice có thể chưa tồn tại ở store
        // chưa dùng HĐĐT → lỗi thì coi như chưa phiếu nào có hoá đơn.
        const hdMap = new Map<string, string>()
        try {
            const ids = txs.map((t: any) => t.id)
            // CHIA LÔ: Postgres chỉ nhận 65535 bind param — sổ cả năm vài chục nghìn
            // phiếu thì query ném lỗi, catch nuốt mất và MỌI dòng thành "chưa xuất HĐ".
            const CHUNK = 2000
            for (let i = 0; i < ids.length; i += CHUNK) {
                const invs = await p.eInvoice.findMany({
                    // 'issued' KHÔNG phải trạng thái hệ thống từng ghi — bộ phát hành
                    // đặt SIGNED rồi SENT (xem schema: DRAFT|SIGNED|SENT|CANCELLED|…).
                    // Lọc nhầm khiến hóa đơn đã ký nhưng chưa gửi bị coi là chưa xuất,
                    // và sổ doanh thu hộ kinh doanh ghi sai cả cột số hóa đơn.
                    where: { transactionId: { in: ids.slice(i, i + CHUNK) }, status: { in: ['SIGNED', 'SENT'] } },
                    select: { transactionId: true, invoiceNumber: true, invoiceSymbol: true, issuedAt: true },
                    orderBy: { issuedAt: 'asc' },
                })
                for (const iv of invs) {
                    if (iv.transactionId) hdMap.set(iv.transactionId, [iv.invoiceSymbol, iv.invoiceNumber].filter(Boolean).join(' '))
                }
            }
        } catch (e: any) {
            // Không im lặng: store chưa có bảng EInvoice là bình thường, còn lại phải thấy
            console.warn('[hkd/s1] không đọc được EInvoice:', e?.message || e)
        }

        const getDate = (t: any) => t.transactionDate || t.createdAt
        const rows = txs.map((t: any, i: number) => ({
            stt: i + 1,
            id: t.id,
            daXuatHD: hdMap.has(t.id),
            soHoaDonDT: hdMap.get(t.id) || '',
            ngay: fmtDate(getDate(t)),
            soChungTu: t.receiptNumber || t.code || '',
            customerName: t.customerName || '',
            soHoaDonVAT: t.vatInvoiceNumber || '',
            doanhThuChuaThue: t.subtotal || 0,
            chietKhau: t.discount || 0,
            thueGTGT: t.tax || 0,
            doanhThuThuan: (t.subtotal || 0) - (t.discount || 0),
            tongThu: t.total || 0,
            phuongThucTT: t.paymentMethod || 'cash',
        }))

        const summary = {
            tongDoanhThu: rows.reduce((s: number, r: any) => s + r.doanhThuChuaThue, 0),
            tongChietKhau: rows.reduce((s: number, r: any) => s + r.chietKhau, 0),
            tongThue: rows.reduce((s: number, r: any) => s + r.thueGTGT, 0),
            tongThueGTGT: rows.reduce((s: number, r: any) => s + r.thueGTGT, 0),
            tongDoanhThuThuan: rows.reduce((s: number, r: any) => s + r.doanhThuThuan, 0),
            tongThu: rows.reduce((s: number, r: any) => s + r.tongThu, 0),
            soPhieu: rows.length,
            soPhieuDaXuatHD: rows.filter((r: any) => r.daXuatHD).length,
        }
        res.json({ success: true, data: { rows, summary, year, month } })
    } catch (err) { console.error('GET /hkd/s1:', err); res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// S2: Hang hoa — Nhật ký giao dịch (nhập/xuất chi tiết từng dòng)
router.get('/hkd/s2', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const p = req.storePrisma! as any
        const year = Number(req.query.year) || new Date().getFullYear()
        const month = req.query.month ? Number(req.query.month) : undefined
        const { start, end } = hkdDateRange(year, month)
        const orDateFilter = (): any => ({
            OR: [
                { transactionDate: { gte: start, lte: end } },
                { transactionDate: null, createdAt: { gte: start, lte: end } },
            ]
        })
        const [imports, sales] = await Promise.all([
            // FIX 1: Lọc status completed — phiếu hủy/nháp không vào sổ
            p.importReceipt.findMany({
                where: { status: 'completed', createdAt: { gte: start, lte: end } },
                include: { items: { include: { product: true } } },
                orderBy: { createdAt: 'asc' }
            }),
            p.transaction.findMany({
                where: { status: { in: ['completed', 'partial'] }, ...orDateFilter() },
                include: { items: { include: { product: true } } },
                orderBy: [{ transactionDate: 'asc' }, { createdAt: 'asc' }]
            }),
        ])
        // Phiếu bán nào ĐÃ XUẤT HOÁ ĐƠN ĐIỆN TỬ → để sổ S2d lọc "chỉ dòng đã có
        // hoá đơn" (đối chiếu với tồn kho thuế: chỉ chứng từ có hoá đơn mới tính).
        const hdSet = new Set<string>()
        try {
            const ids = sales.map((t: any) => t.id)
            const CHUNK = 2000
            for (let i = 0; i < ids.length; i += CHUNK) {
                const invs = await p.eInvoice.findMany({
                    // 'issued' KHÔNG phải trạng thái hệ thống từng ghi — bộ phát hành
                    // đặt SIGNED rồi SENT (xem schema: DRAFT|SIGNED|SENT|CANCELLED|…).
                    // Lọc nhầm khiến hóa đơn đã ký nhưng chưa gửi bị coi là chưa xuất,
                    // và sổ doanh thu hộ kinh doanh ghi sai cả cột số hóa đơn.
                    where: { transactionId: { in: ids.slice(i, i + CHUNK) }, status: { in: ['SIGNED', 'SENT'] } },
                    select: { transactionId: true },
                })
                for (const iv of invs) if (iv.transactionId) hdSet.add(iv.transactionId)
            }
        } catch (e: any) {
            console.warn('[hkd/s2] không đọc được EInvoice:', e?.message || e)
        }

        const rows: any[] = []
        let idx = 1
        for (const imp of imports) {
            for (const item of (imp.items || [])) {
                const maHang = item.productSku || item.sku || (item.productId ? item.productId.slice(-8).toUpperCase() : '—')
                const qty = item.quantity || 0
                const cp = item.costPrice || item.product?.costPrice || 0
                const tt = item.total || (qty * cp)
                // FIX 2: Dùng transactionDate nếu có, fallback createdAt
                const ngay = fmtDate(imp.transactionDate || imp.createdAt)
                rows.push({
                    stt: idx++, ngay, soChungTu: imp.receiptNumber || imp.code || '',
                    supplierName: imp.supplierName || 'NCC', type: 'import',
                    maHang, tenHangHoa: item.productName || item.name || item.product?.name || '',
                    dvt: item.unit || item.product?.baseUnit || 'cái',
                    nhapSoLuong: qty, nhapDonGia: cp, nhapThanhTien: tt,
                    xuatSoLuong: 0, xuatDonGia: 0, xuatThanhTien: 0,
                    // Nhập: có hoá đơn VAT đầu vào hay không (quyết định tồn kho thuế)
                    coHoaDon: !!(imp as any).hasVatInvoice,
                    soHoaDon: (imp as any).vatInvoiceNo || '',
                    dienGiai: `Nhập kho từ ${imp.supplierName || 'NCC'}`,
                })
            }
        }
        for (const sale of sales) {
            for (const item of (sale.items || [])) {
                const maHang = item.sku || item.productSku || (item.productId ? item.productId.slice(-8).toUpperCase() : '—')
                const qty = item.quantity || 0
                // FIX 3: Ưu tiên costPrice trực tiếp trên item, fallback product.costPrice
                const gv = item.costPrice || item.product?.costPrice || 0
                rows.push({
                    stt: idx++, ngay: fmtDate(sale.transactionDate || sale.createdAt),
                    soChungTu: sale.receiptNumber || '', supplierName: '', type: 'sale',
                    maHang, tenHangHoa: item.productName || item.name || item.product?.name || '',
                    dvt: item.product?.baseUnit || 'cái',
                    nhapSoLuong: 0, nhapDonGia: 0, nhapThanhTien: 0,
                    xuatSoLuong: qty, xuatDonGia: gv, xuatThanhTien: qty * gv,
                    // Xuất: phiếu bán đã xuất hoá đơn điện tử hay chưa
                    coHoaDon: hdSet.has(sale.id),
                    soHoaDon: sale.vatInvoiceNumber || '',
                    dienGiai: `Xuất bán - ${sale.customerName || 'Khách lẻ'}`,
                })
            }
        }
        rows.sort((a, b) => a.ngay.localeCompare(b.ngay))
        rows.forEach((r, i) => r.stt = i + 1)
        const summary = {
            tongNhap: rows.reduce((s, r) => s + r.nhapThanhTien, 0),
            tongXuat: rows.reduce((s, r) => s + r.xuatThanhTien, 0),
            soPhieuNhap: imports.length,
            soPhieuXuat: sales.length,
        }
        res.json({ success: true, data: { rows, summary, year, month } })
    } catch (err) { console.error('GET /hkd/s2:', err); res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// S2 Tổng hợp theo mã hàng: đầu kỳ / nhập / xuất / tồn cuối kỳ
router.get('/hkd/s2-summary', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const p = req.storePrisma! as any
        const year = Number(req.query.year) || new Date().getFullYear()
        const month = req.query.month ? Number(req.query.month) : undefined
        const { start: kyStart, end: kyEnd } = hkdDateRange(year, month)
        const dauKyEnd = new Date(kyStart.getTime() - 1)
        const veryOldStart = new Date('2000-01-01T00:00:00Z')
        const orDate = (s: Date, e: Date): any => ({
            OR: [{ transactionDate: { gte: s, lte: e } }, { transactionDate: null, createdAt: { gte: s, lte: e } }]
        })
        const [prevImports, prevSales, kyImports, kySales] = await Promise.all([
            p.importReceipt.findMany({ where: { createdAt: { gte: veryOldStart, lte: dauKyEnd } }, include: { items: true } }),
            p.transaction.findMany({ where: { status: { in: ['completed', 'partial'] }, ...orDate(veryOldStart, dauKyEnd) }, include: { items: { include: { product: true } } } }),
            p.importReceipt.findMany({ where: { createdAt: { gte: kyStart, lte: kyEnd } }, include: { items: true } }),
            p.transaction.findMany({ where: { status: { in: ['completed', 'partial'] }, ...orDate(kyStart, kyEnd) }, include: { items: { include: { product: true } } } }),
        ])
        // ImportReceiptItem key: productSku. TransactionItem key: sku
        const itemKey = (item: any) => item.productSku || item.sku || (item.productId ? item.productId.slice(-8).toUpperCase() : item.productName || '—')
        const ensure = (map: Record<string, any>, item: any) => {
            const key = itemKey(item)
            if (!map[key]) map[key] = { maHang: key, tenHang: item.productName || item.name || '', dvt: item.unit || item.product?.baseUnit || 'cái', sl: 0, tt: 0 }
            return map[key]
        }
        const dauKyMap: Record<string, any> = {}
        // ImportReceipt: total = costPrice * quantity (already stored), costPrice per item
        for (const imp of prevImports) for (const item of (imp.items || [])) { const r = ensure(dauKyMap, item); r.sl += item.quantity || 0; r.tt += item.total || ((item.quantity || 0) * (item.costPrice || 0)) }
        // TransactionItem: no costPrice field → use item.product.costPrice
        for (const sale of prevSales) for (const item of (sale.items || [])) { const r = ensure(dauKyMap, item); r.sl -= item.quantity || 0; r.tt -= (item.quantity || 0) * (item.product?.costPrice || 0) }
        const nhapMap: Record<string, any> = {}
        const xuatMap: Record<string, any> = {}
        for (const imp of kyImports) for (const item of (imp.items || [])) { const r = ensure(nhapMap, item); r.sl += item.quantity || 0; r.tt += item.total || ((item.quantity || 0) * (item.costPrice || 0)) }
        for (const sale of kySales) for (const item of (sale.items || [])) { const r = ensure(xuatMap, item); r.sl += item.quantity || 0; r.tt += (item.quantity || 0) * (item.product?.costPrice || 0) }
        const allKeys = new Set([...Object.keys(dauKyMap), ...Object.keys(nhapMap), ...Object.keys(xuatMap)])
        const rowsRaw = Array.from(allKeys).sort().map((key) => {
            const dk = dauKyMap[key] || { maHang: key, tenHang: '', dvt: 'cái', sl: 0, tt: 0 }
            const nh = nhapMap[key] || { sl: 0, tt: 0 }
            const xu = xuatMap[key] || { sl: 0, tt: 0 }
            const cuoiKySL = dk.sl + nh.sl - xu.sl
            const cuoiKyTT = dk.tt + nh.tt - xu.tt
            return { maHang: dk.maHang, tenHang: dk.tenHang || nhapMap[key]?.tenHang || xuatMap[key]?.tenHang || '', dvt: dk.dvt, dauKySL: dk.sl, dauKyTT: dk.tt, nhapSL: nh.sl, nhapTT: nh.tt, xuatSL: xu.sl, xuatTT: xu.tt, cuoiKySL, cuoiKyTT }
        })
        // Chỉ giữ sản phẩm có ít nhất 1 giá trị khác 0 (tồn đầu, nhập, xuất, hoặc tồn cuối)
        const rows = rowsRaw
            .filter(r => r.dauKySL !== 0 || r.nhapSL !== 0 || r.xuatSL !== 0 || r.cuoiKySL !== 0 || r.dauKyTT !== 0 || r.nhapTT !== 0 || r.xuatTT !== 0 || r.cuoiKyTT !== 0)
            .map((r, i) => ({ stt: i + 1, ...r }))
        res.json({ success: true, data: { rows, summary: { tongDauKy: rows.reduce((s, r) => s + r.dauKyTT, 0), tongNhap: rows.reduce((s, r) => s + r.nhapTT, 0), tongXuat: rows.reduce((s, r) => s + r.xuatTT, 0), tongCuoiKy: rows.reduce((s, r) => s + r.cuoiKyTT, 0), soMatHang: rows.length }, year, month } })
    } catch (err) { console.error('GET /hkd/s2-summary:', err); res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// S3: Chi tiet doanh thu, chi phi
router.get('/hkd/s3', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const p = req.storePrisma! as any
        const year = Number(req.query.year) || new Date().getFullYear()
        const month = req.query.month ? Number(req.query.month) : undefined
        const { start, end } = hkdDateRange(year, month)
        const txOrDate: any = { OR: [{ transactionDate: { gte: start, lte: end } }, { transactionDate: null, createdAt: { gte: start, lte: end } }] }
        // Fetch transactions với items+product để tính COGS (giá vốn hàng bán)
        const [txs, expenses] = await Promise.all([
            p.transaction.findMany({ where: { status: { in: ['completed', 'partial'] }, ...txOrDate }, include: { items: { include: { product: true } } }, orderBy: [{ transactionDate: 'asc' }, { createdAt: 'asc' }] }),
            p.expense.findMany({ where: { date: { gte: start, lte: end } }, orderBy: { date: 'asc' } }),
        ])
        // Map expense category → nhóm chi phí hợp lý theo TT152/2025/TT-BTC (Điều 5)
        const catToNhom = (cat: string): { nhom: string; label: string } => {
            const c = (cat || '').toLowerCase()
            if (c === 'a' || c.includes('purchase') || c.includes('hang') || c.includes('nvl') || c.includes('material') || c.includes('hàng hóa') || c.includes('nguyên liệu')) return { nhom: 'a', label: '(a) Nguyên liệu, vật liệu, hàng hóa' }
            if (c === 'b' || c.includes('salary') || c.includes('luong') || c.includes('lương') || c.includes('bh') || c.includes('payroll') || c.includes('labor') || c.includes('nhân công')) return { nhom: 'b', label: '(b) Tiền lương, BHXH, phụ cấp' }
            if (c === 'c' || c.includes('depreciation') || c.includes('khau_hao') || c.includes('khấu hao') || c.includes('tsđ') || c.includes('asset')) return { nhom: 'c', label: '(c) Khấu hao tài sản cố định' }
            if (c === 'd' || c.includes('util') || c.includes('electric') || c.includes('dien') || c.includes('điện') || c.includes('nước') || c.includes('phone') || c.includes('internet') || c.includes('rent') || c.includes('thuê') || c.includes('ship') || c.includes('transport') || c.includes('vận chuyển') || c.includes('service') || c.includes('dịch vụ')) return { nhom: 'd', label: '(d) Dịch vụ mua ngoài' }
            if (c === 'đ' || c.includes('interest') || c.includes('loan') || c.includes('lai') || c.includes('lãi') || c.includes('vay')) return { nhom: 'đ', label: '(đ) Lãi tiền vay' }
            return { nhom: 'e', label: '(e) Chi phí khác' }
        }

        // Rows: mỗi dòng là 1 nghiệp vụ có doanhThu + chiPhi + loiNhuan + loaiChiPhi
        const rows: any[] = []
        // (1) Doanh thu + (2a) COGS — mỗi hóa đơn tạo 2 dòng: 1 dòng DT + 1 dòng giá vốn
        for (const t of txs) {
            const ngay = fmtDate(t.transactionDate || t.createdAt)
            const soChungTu = t.receiptNumber || ''
            const tenKH = t.customerName ? ' - ' + t.customerName : ''
            // Dòng doanh thu
            const dtBan = (t.subtotal || 0) - (t.discount || 0)
            rows.push({ ngay, soChungTu, dienGiai: `Bán hàng${tenKH}`, doanhThu: dtBan, chiPhi: 0, loiNhuan: dtBan, nhom: '', loaiChiPhi: 'Doanh thu' })
            // Dòng giá vốn hàng bán (COGS) = Σ quantity × costPrice của từng item
            const cogs = (t.items || []).reduce((sum: number, item: any) => {
                const gv = item.costPrice || item.product?.costPrice || 0
                return sum + (item.quantity || 0) * gv
            }, 0)
            if (cogs > 0) {
                rows.push({ ngay, soChungTu, dienGiai: `Giá vốn hàng bán${tenKH}`, doanhThu: 0, chiPhi: cogs, loiNhuan: -cogs, nhom: 'a', loaiChiPhi: '(a) Nguyên liệu, vật liệu, hàng hóa (COGS)' })
            }
        }
        // (2b-e) Chi phí từ expense → phân nhóm tự động theo category
        for (const e of expenses) {
            const { nhom, label } = catToNhom(e.category || '')
            // Parse số hóa đơn từ description: format "[INV-001] Nội dung" hoặc giữ nguyên
            const hdMatch = (e.description || '').match(/^\[([^\]]+)\]\s*(.+)$/)
            const soChungTu = hdMatch ? hdMatch[1] : `CP-${e.id.slice(-6)}`
            const dienGiai = hdMatch ? hdMatch[2] : (e.description || e.category || 'Chi phí')
            rows.push({ ngay: fmtDate(e.date), soChungTu, dienGiai, doanhThu: 0, chiPhi: e.amount || 0, loiNhuan: -(e.amount || 0), nhom, loaiChiPhi: label, expenseId: e.id })
        }

        rows.sort((a, b) => a.ngay.localeCompare(b.ngay))
        rows.forEach((r, i) => r.stt = i + 1)

        const tongDoanhThu = rows.reduce((s, r) => s + r.doanhThu, 0)
        const tongChiPhi = rows.reduce((s, r) => s + r.chiPhi, 0)

        // Tổng chi phí theo nhóm (a,b,c,d,đ,e) — để hiển thị đúng mẫu S2c-HKD
        const nhomLabels: Record<string, string> = {
            a: '(a) Nguyên liệu, vật liệu, hàng hóa',
            b: '(b) Tiền lương, BHXH, phụ cấp',
            c: '(c) Khấu hao tài sản cố định',
            d: '(d) Dịch vụ mua ngoài',
            'đ': '(đ) Lãi tiền vay',
            e: '(e) Chi phí khác',
        }
        const chiPhiTheoNhom: Record<string, { label: string; soTien: number }> = {}
        for (const [k, v] of Object.entries(nhomLabels)) chiPhiTheoNhom[k] = { label: v, soTien: 0 }
        for (const r of rows) { if (r.nhom && chiPhiTheoNhom[r.nhom]) chiPhiTheoNhom[r.nhom].soTien += r.chiPhi }

        const chenhLech = tongDoanhThu - tongChiPhi  // Dòng (3) = (1) − (2)
        const summary = {
            tongDoanhThu, tongChiPhi,
            tongLoiNhuan: chenhLech, chenhLech,
            chiPhiTheoNhom,
        }
        res.json({ success: true, data: { rows, summary, year, month } })
    } catch (err) { console.error('GET /hkd/s3:', err); res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// S4: Nghia vu thue — fields phai khop voi frontend S4View
router.get('/hkd/s4', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const p = req.storePrisma! as any
        const year = Number(req.query.year) || new Date().getFullYear()
        const decls = await p.taxDeclaration.findMany({ where: { year }, orderBy: { createdAt: 'asc' } })
        const rows = decls.map((d: any, i: number) => {
            const isCnkd = d.formType === '01_CNKD'
            const doanhThu = isCnkd ? (d.cnkdRevenue || 0) : (d.ct29 || 0)
            const vatPhaiNop = isCnkd ? (d.cnkdVatAmount || 0) : (d.ct38 > 0 ? d.ct38 : 0)
            const tncnPhaiNop = isCnkd ? (d.cnkdPitAmount || 0) : 0
            const tongPhaiNop = vatPhaiNop + tncnPhaiNop
            // Tỷ lệ thuế = GTGT 1.5% + TNCN 0.5% nếu là HKD, hoặc 10% VAT nếu là DN
            const tyLeThue = isCnkd ? 2.0 : (doanhThu > 0 ? Math.round(vatPhaiNop / doanhThu * 1000) / 10 : 0)
            return {
                stt: i + 1,
                ky: d.period,
                loaiThue: isCnkd ? 'HKD (GTGT+TNCN)' : 'DN (VAT)',
                doanhThu,
                tyLeThue,
                soThue: tongPhaiNop,             // Field frontend dùng: r.soThue
                vatPhaiNop,
                tncnPhaiNop,
                tongPhaiNop,
                tongGTGT: vatPhaiNop,
                tongTNCN: tncnPhaiNop,
                daKhaiNop: d.status === 'paid' ? tongPhaiNop : 0,
                tongDaNop: d.status === 'paid' ? tongPhaiNop : 0,
                conPhaiNop: d.status !== 'paid' ? tongPhaiNop : 0,
                trangThai: d.status,
                ghiChu: d.notes || ''
            }
        })
        const summary = {
            tongGTGT: rows.reduce((s: number, r: any) => s + r.vatPhaiNop, 0),
            tongTNCN: rows.reduce((s: number, r: any) => s + r.tncnPhaiNop, 0),
            tongPhaiNop: rows.reduce((s: number, r: any) => s + r.tongPhaiNop, 0),
            tongDaNop: rows.reduce((s: number, r: any) => s + r.daKhaiNop, 0),
            tongPhatSinh: rows.reduce((s: number, r: any) => s + r.tongPhaiNop, 0),
            tongDaKhaiNop: rows.reduce((s: number, r: any) => s + r.daKhaiNop, 0),
            tongConPhaiNop: rows.reduce((s: number, r: any) => s + r.conPhaiNop, 0),
        }
        res.json({ success: true, data: { rows, summary, year } })
    } catch (err) { console.error('GET /hkd/s4:', err); res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// S5: Luong — su dung PayrollRecord neu co, fallback sang User.salary
router.get('/hkd/s5', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const p = req.storePrisma! as any
        const year = Number(req.query.year) || new Date().getFullYear()
        const month = req.query.month ? Number(req.query.month) : undefined
        const { start, end } = hkdDateRange(year, month)

        // Ưu tiên dùng PayrollRecord
        let payrollRecords: any[] = []
        try {
            payrollRecords = await p.payrollRecord.findMany({
                where: { year, ...(month ? { month } : {}) },
                orderBy: { employeeName: 'asc' },
            })
        } catch (_) { }

        let rows: any[]
        if (payrollRecords.length > 0) {
            // Dùng PayrollRecord — trả về field giống usePayrollAccounting
            rows = payrollRecords.map((r: any, i: number) => {
                const gross = r.actualGross || r.grossSalary || 0
                const bhxh = r.bhxh_emp || r.bhxhEmployee || Math.round(gross * 0.08)
                const bhyt = r.bhyt_emp || r.bhytEmployee || Math.round(gross * 0.015)
                const bhtn = r.bhtn_emp || r.bhtnEmployee || Math.round(gross * 0.01)
                const tncn = r.pit || r.pitAmount || 0
                const net = r.netSalary || (gross - bhxh - bhyt - bhtn - tncn)
                return {
                    stt: i + 1,
                    maNV: (r.employeeId || '').slice(-6).toUpperCase(),
                    tenNV: r.employeeName || '',
                    chucVu: r.department || r.position || '',
                    luongCB: gross,
                    phuCap: r.allowances || 0,
                    khauTru: r.deductions || 0,
                    thuNhapThucTe: gross + (r.allowances || 0) - (r.deductions || 0),
                    bhxh, bhyt, bhtn, tncn,
                    luongThucLanh: net,
                    // Legacy aliases
                    luongCoBan: gross,
                    bhxhNLD: bhxh + bhyt + bhtn,
                    luongThucLinh: net,
                }
            })
        } else {
            // Fallback: User.salary
            const employees = await p.user.findMany({ where: { role: { not: 'customer' } } }).catch(() => [])
            const monthsInPeriod = month ? 1 : 12
            rows = employees.filter((e: any) => (e.salary || 0) > 0).map((emp: any, i: number) => {
                const gross = (emp.salary || 0) * monthsInPeriod
                const bhxh = Math.round(gross * 0.08)
                const bhyt = Math.round(gross * 0.015)
                const bhtn = Math.round(gross * 0.01)
                const tncn = 0
                const net = gross - bhxh - bhyt - bhtn
                return {
                    stt: i + 1,
                    maNV: emp.id.slice(-6).toUpperCase(),
                    tenNV: emp.name || emp.username || '',
                    chucVu: emp.role || '',
                    luongCB: gross, phuCap: 0, khauTru: 0,
                    thuNhapThucTe: gross,
                    bhxh, bhyt, bhtn, tncn,
                    luongThucLanh: net,
                    luongCoBan: gross,
                    bhxhNLD: bhxh + bhyt + bhtn,
                    luongThucLinh: net,
                }
            })
        }

        const summary = {
            tongLuong: rows.reduce((s: number, r: any) => s + r.luongCB, 0),
            tongBH: rows.reduce((s: number, r: any) => s + r.bhxh + r.bhyt + r.bhtn, 0),
            tongTNCN: rows.reduce((s: number, r: any) => s + r.tncn, 0),
            tongThucLinh: rows.reduce((s: number, r: any) => s + r.luongThucLanh, 0),
            // Legacy aliases
            tongLuongCoBan: rows.reduce((s: number, r: any) => s + r.luongCB, 0),
            tongLuongThucLinh: rows.reduce((s: number, r: any) => s + r.luongThucLanh, 0),
            soNhanVien: rows.length,
        }
        res.json({ success: true, data: { rows, summary, year, month } })
    } catch (err) { console.error('GET /hkd/s5:', err); res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// ═══ Bank Account CRUD ═══════════════════════════════════════════════════════
router.get('/hkd/bank-accounts', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const p = req.storePrisma! as any
        const accounts = await p.bankAccount.findMany({ orderBy: { createdAt: 'asc' } })
        res.json({ success: true, data: accounts })
    } catch (err) { console.error('GET /bank-accounts:', err); res.status(500).json({ success: false, error: 'Internal server error' }) }
})
router.post('/hkd/bank-accounts', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const p = req.storePrisma! as any
        const { bankName, accountNumber, accountName, isDefault } = req.body
        if (!bankName?.trim() || !accountNumber?.trim()) return res.status(400).json({ success: false, error: 'Tên NH và số TK bắt buộc' })
        if (isDefault) await p.bankAccount.updateMany({ data: { isDefault: false } })
        const acc = await p.bankAccount.create({ data: { bankName: bankName.trim(), accountNumber: accountNumber.trim(), accountName: accountName?.trim() || null, isDefault: !!isDefault } })
        res.status(201).json({ success: true, data: acc })
    } catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }) }
})
router.put('/hkd/bank-accounts/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const p = req.storePrisma! as any
        const { bankName, accountNumber, accountName, isDefault } = req.body
        if (isDefault) await p.bankAccount.updateMany({ data: { isDefault: false } })
        const acc = await p.bankAccount.update({ where: { id: req.params.id }, data: { bankName, accountNumber, accountName, isDefault: !!isDefault } })
        res.json({ success: true, data: acc })
    } catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }) }
})
router.delete('/hkd/bank-accounts/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const p = req.storePrisma! as any
        await p.bankAccount.delete({ where: { id: req.params.id } })
        res.json({ success: true })
    } catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// ═══ Bank Transaction CRUD ═══════════════════════════════════════════════════
router.get('/hkd/bank-transactions', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const p = req.storePrisma! as any
        const year = Number(req.query.year) || new Date().getFullYear()
        const month = req.query.month ? Number(req.query.month) : undefined
        const { start, end } = hkdDateRange(year, month)
        const txs = await p.bankTransaction.findMany({ where: { date: { gte: start, lte: end } }, include: { bankAccount: true }, orderBy: { date: 'asc' } })
        res.json({ success: true, data: txs })
    } catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }) }
})
router.post('/hkd/bank-transactions', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const p = req.storePrisma! as any
        const { bankAccountId, type, amount, description, reference, date } = req.body
        if (!description?.trim()) return res.status(400).json({ success: false, error: 'Diễn giải bắt buộc' })
        if (!amount || Number(amount) <= 0) return res.status(400).json({ success: false, error: 'Số tiền phải > 0' })
        const tx = await p.bankTransaction.create({ data: { bankAccountId: bankAccountId || null, type: type || 'deposit', amount: Number(amount), description: description.trim(), reference: reference?.trim() || null, date: date ? new Date(date) : new Date() } })
        res.status(201).json({ success: true, data: tx })
    } catch (err) { console.error('POST /bank-transactions:', err); res.status(500).json({ success: false, error: 'Internal server error' }) }
})
router.put('/hkd/bank-transactions/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const p = req.storePrisma! as any
        const { bankAccountId, type, amount, description, reference, date } = req.body
        const tx = await p.bankTransaction.update({ where: { id: req.params.id }, data: { bankAccountId: bankAccountId || null, type, amount: Number(amount), description: description?.trim(), reference: reference?.trim() || null, ...(date && { date: new Date(date) }) } })
        res.json({ success: true, data: tx })
    } catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }) }
})
router.delete('/hkd/bank-transactions/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const p = req.storePrisma! as any
        await p.bankTransaction.delete({ where: { id: req.params.id } })
        res.json({ success: true })
    } catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// S6: Sổ chi tiết tiền (S2e) — Tiền mặt auto, Tiền gửi từ BankTransaction
router.get('/hkd/s6', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const p = req.storePrisma! as any
        const year = Number(req.query.year) || new Date().getFullYear()
        const month = req.query.month ? Number(req.query.month) : undefined
        const { start, end } = hkdDateRange(year, month)
        
        // ═══ TIỀN MẶT (auto từ POS + Expense) ═══
        // Đầu kỳ tiền mặt
        const prevTxs = await p.transaction.findMany({ where: { status: { in: ['completed', 'partial'] }, createdAt: { lt: start } } })
        const prevExps = await p.expense.findMany({ where: { date: { lt: start } } })
        let tienMatDauKy = 0
        // Sổ quỹ là THỰC THU: đơn ghi nợ (partial) chỉ cộng phần đã thu (amountReceived)
        for (const t of prevTxs) { if (t.paymentMethod === 'Tiền mặt') tienMatDauKy += (t.status === 'partial' ? (t.amountReceived || 0) : (t.totalAmount || 0)) }
        for (const e of prevExps) {
            if (e.paidBy !== 'Tiền mặt') continue
            tienMatDauKy += e.category === 'hkd_cash_thu' ? (e.amount||0) : -(e.amount||0)
        }
        // Giao dịch tiền mặt trong kỳ
        const txs = await p.transaction.findMany({ where: { status: { in: ['completed', 'partial'] }, createdAt: { gte: start, lte: end } }, orderBy: { createdAt: 'asc' } })
        const expenses = await p.expense.findMany({ where: { date: { gte: start, lte: end } }, orderBy: { date: 'asc' } })
        const tmEvents: any[] = []
        for (const t of txs) {
            if (t.paymentMethod !== 'Tiền mặt') continue
            tmEvents.push({ id: t.id, rawDate: t.transactionDate || t.createdAt, soChungTu: t.receiptNumber || `HD-${t.id.slice(-6)}`, dienGiai: `Thu tiền bán hàng - ${t.customerName || 'Khách lẻ'}`, thu: t.status === 'partial' ? (t.amountReceived || 0) : t.totalAmount, chi: 0, isManual: false })
        }
        for (const e of expenses) {
            if (e.paidBy !== 'Tiền mặt') continue
            const isThu = e.category === 'hkd_cash_thu'
            const hdMatch = (e.description || '').match(/^\[([^\]]+)\]\s*(.+)$/)
            tmEvents.push({ id: e.id, rawDate: e.date, soChungTu: hdMatch ? hdMatch[1] : (isThu ? `THU-${e.id.slice(-6)}` : `CHI-${e.id.slice(-6)}`), dienGiai: hdMatch ? hdMatch[2] : (e.description || ''), thu: isThu ? e.amount : 0, chi: isThu ? 0 : e.amount, isManual: ['hkd_cash_thu','hkd_cash_chi'].includes(e.category) })
        }
        tmEvents.sort((a, b) => new Date(a.rawDate).getTime() - new Date(b.rawDate).getTime())
        const tienMatRows: any[] = []; let tmBal = tienMatDauKy, tmThu = 0, tmChi = 0, sttTM = 1
        for (const e of tmEvents) {
            tmBal += e.thu - e.chi; tmThu += e.thu; tmChi += e.chi
            tienMatRows.push({ ...e, ngay: fmtDate(e.rawDate), tonCuoi: tmBal, stt: sttTM++ })
        }

        // ═══ TIỀN GỬI (từ BankTransaction — nhập tay) ═══
        let tienGuiDauKy = 0
        try {
            const prevBankTxs = await p.bankTransaction.findMany({ where: { date: { lt: start } } })
            for (const bt of prevBankTxs) { tienGuiDauKy += bt.type === 'deposit' ? bt.amount : -bt.amount }
        } catch (_) { /* BankTransaction table may not exist yet */ }

        const tienGuiRows: any[] = []; let tgBal = tienGuiDauKy, tgThu = 0, tgChi = 0, sttTG = 1
        try {
            const bankTxs = await p.bankTransaction.findMany({ where: { date: { gte: start, lte: end } }, include: { bankAccount: true }, orderBy: { date: 'asc' } })
            for (const bt of bankTxs) {
                const isDep = bt.type === 'deposit'
                const thu = isDep ? bt.amount : 0, chi = isDep ? 0 : bt.amount
                tgBal += thu - chi; tgThu += thu; tgChi += chi
                tienGuiRows.push({ id: bt.id, stt: sttTG++, ngay: fmtDate(bt.date), soChungTu: bt.reference || '', dienGiai: bt.description, thu, chi, tonCuoi: tgBal, isManual: true, bankName: bt.bankAccount?.bankName || '' })
            }
        } catch (_) { /* BankTransaction table may not exist yet */ }

        res.json({ 
            success: true, 
            data: { 
                year, month,
                tienMat: { dauKy: tienMatDauKy, rows: tienMatRows, tongThu: tmThu, tongChi: tmChi, cuoiKy: tmBal },
                tienGui: { dauKy: tienGuiDauKy, rows: tienGuiRows, tongThu: tgThu, tongChi: tgChi, cuoiKy: tgBal }
            } 
        })
    } catch (err) { console.error('GET /hkd/s6:', err); res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// S6 CRUD — Thêm/Sửa/Xóa entry sổ quỹ thủ công
router.post('/hkd/s6', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const p = req.storePrisma! as any
        const { ngay, soChungTu, dienGiai, thu, chi, phuongThucTT } = req.body
        if (!dienGiai?.trim()) return res.status(400).json({ success: false, error: 'Diễn giải bắt buộc' })
        const isThu = !!(thu && Number(thu) > 0)
        const amount = isThu ? Number(thu) : Number(chi)
        if (!amount || amount <= 0) return res.status(400).json({ success: false, error: 'Số tiền phải > 0' })
        // Format description = [soChungTu] dienGiai nếu có số CT
        const description = soChungTu?.trim() ? `[${soChungTu.trim()}] ${dienGiai.trim()}` : dienGiai.trim()
        const entry = await p.expense.create({
            data: { description, amount, category: isThu ? 'hkd_cash_thu' : 'hkd_cash_chi', paidBy: phuongThucTT || 'Tiền mặt', date: ngay ? new Date(ngay) : new Date(), recurring: false }
        })
        res.status(201).json({ success: true, data: entry })
    } catch (err) { console.error('POST /hkd/s6:', err); res.status(500).json({ success: false, error: 'Internal server error' }) }
})

router.put('/hkd/s6/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const p = req.storePrisma! as any
        const { ngay, soChungTu, dienGiai, thu, chi, phuongThucTT } = req.body
        const isThu = !!(thu && Number(thu) > 0)
        const amount = isThu ? Number(thu) : Number(chi)
        const description = soChungTu?.trim() ? `[${soChungTu.trim()}] ${dienGiai.trim()}` : dienGiai.trim()
        const entry = await p.expense.update({
            where: { id: req.params.id },
            data: { description, amount, category: isThu ? 'hkd_cash_thu' : 'hkd_cash_chi', paidBy: phuongThucTT || 'Tiền mặt', ...(ngay && { date: new Date(ngay) }) }
        })
        res.json({ success: true, data: entry })
    } catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

router.delete('/hkd/s6/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const p = req.storePrisma! as any
        await p.expense.delete({ where: { id: req.params.id } })
        res.json({ success: true })
    } catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// S7: Nhat ky thu chi tien gui ngan hang — fix Promise.all
router.get('/hkd/s7', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const p = req.storePrisma! as any
        const year = Number(req.query.year) || new Date().getFullYear()
        const month = req.query.month ? Number(req.query.month) : undefined
        const { start, end } = hkdDateRange(year, month)
        const txOrDate7 = { OR: [{ transactionDate: { gte: start, lte: end } }, { transactionDate: null, createdAt: { gte: start, lte: end } }] }
        const BANK_KEYWORDS = ['bank','transfer','banking','chuyen_khoan','momo','vnpay','zalopay','atm','Bank','Transfer']
        const [allTxs, allExp] = await Promise.all([
            p.transaction.findMany({ where: { status: { in: ['completed', 'partial'] }, ...txOrDate7 }, orderBy: [{ transactionDate: 'asc' }, { createdAt: 'asc' }] }),
            p.expense.findMany({ where: { date: { gte: start, lte: end }, paidBy: { in: BANK_KEYWORDS } }, orderBy: { date: 'asc' } }),
        ])
        const bankTxs = allTxs.filter((t: any) => BANK_KEYWORDS.includes((t.paymentMethod || '').toLowerCase()))
        const items = [
            // Sổ tiền gửi là THỰC THU: đơn ghi nợ chỉ tính phần đã thu
            ...bankTxs.map((t: any) => ({ ngay: fmtDate(t.transactionDate || t.createdAt), soChungTu: t.receiptNumber || '', dienGiai: `Thu - ${t.customerName || 'Khách'}`, thu: t.status === 'partial' ? (t.amountReceived || 0) : (t.total || 0), chi: 0, phuongThucTT: t.paymentMethod || 'bank' })),
            ...allExp.map((e: any) => ({ ngay: fmtDate(e.date), soChungTu: `CP-${e.id.slice(-6)}`, dienGiai: e.description || e.category || 'Chi', thu: 0, chi: e.amount || 0, phuongThucTT: e.paidBy || 'bank' })),
        ].sort((a, b) => a.ngay.localeCompare(b.ngay))
        let balance = 0
        const rows = items.map((item, i) => { balance += item.thu - item.chi; return { stt: i + 1, ...item, tonCuoi: balance } })
        res.json({ success: true, data: { rows, summary: { tongThu: rows.reduce((s, r) => s + r.thu, 0), tongChi: rows.reduce((s, r) => s + r.chi, 0), tonCuoiKy: balance }, year, month } })
    } catch (err) { console.error('GET /hkd/s7:', err); res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// ─── INVENTORY COUNT (Kiểm kê — BC26-BH hàng hóa / D02-TS TSCĐ) ────────────

// Normalize countDate to YYYY-MM-DD string (matches JournalEntry.date format).
function normalizeCountDate(input: any): string | null {
    if (!input) return new Date().toISOString().slice(0, 10)
    const d = input instanceof Date ? input : new Date(String(input))
    if (isNaN(d.getTime())) return null
    return d.toISOString().slice(0, 10)
}

// Generate count code: KK-YYYYMMDD-NNN where NNN is daily sequence (zero-padded).
async function nextInventoryCountCode(prisma: any, dateStr: string): Promise<string> {
    const ymd = dateStr.replace(/-/g, '')
    const prefix = `KK-${ymd}-`
    const todays = await prisma.inventoryCount.findMany({
        where: { code: { startsWith: prefix } },
        select: { code: true },
    })
    let max = 0
    for (const c of todays) {
        const n = parseInt(c.code.slice(prefix.length), 10)
        if (!isNaN(n) && n > max) max = n
    }
    return `${prefix}${String(max + 1).padStart(3, '0')}`
}

// POST /api/tax/inventory-count — create a new count session and auto-populate items
router.post('/inventory-count', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma! as any
        const { countDate, type, warehouseId, notes } = req.body

        if (!['goods', 'fixed-assets'].includes(type)) {
            return res.status(400).json({ success: false, error: 'type phải là "goods" hoặc "fixed-assets"' })
        }
        const dateStr = normalizeCountDate(countDate)
        if (!dateStr) return res.status(400).json({ success: false, error: 'countDate không hợp lệ' })

        const branchId = getBranchId(req) || null
        const userId = req.user?.userId || null
        const code = await nextInventoryCountCode(prisma, dateStr)

        // Build item payload depending on type.
        const itemsData: any[] = []
        if (type === 'goods') {
            if (warehouseId) {
                // Populate from warehouse stocks (joined with product for cost + unit)
                const stocks = await prisma.warehouseStock.findMany({
                    where: { warehouseId, quantity: { gt: 0 } },
                })
                const productIds = stocks.map((s: any) => s.productId)
                const products = productIds.length
                    ? await prisma.product.findMany({ where: { id: { in: productIds } } })
                    : []
                const productMap = new Map(products.map((p: any) => [p.id, p]))
                for (const s of stocks) {
                    const p: any = productMap.get(s.productId)
                    itemsData.push({
                        refId: s.productId,
                        refCode: s.productSku || p?.sku || null,
                        name: s.productName || p?.name || s.productId,
                        unit: p?.baseUnit || 'cái',
                        systemQty: Number(s.quantity) || 0,
                        unitCost: Number(p?.costPrice) || 0,
                    })
                }
            } else {
                // Use Product.stock (global, not per-warehouse)
                const products = await prisma.product.findMany({
                    where: { productType: 'goods' },
                    orderBy: { name: 'asc' },
                })
                for (const p of products) {
                    itemsData.push({
                        refId: p.id,
                        refCode: p.sku,
                        name: p.name,
                        unit: p.baseUnit || 'cái',
                        systemQty: Number(p.stock) || 0,
                        unitCost: Number(p.costPrice) || 0,
                    })
                }
            }
        } else {
            // type === 'fixed-assets'
            const assets = await prisma.fixedAsset.findMany({
                where: { status: { not: 'disposed' } },
                orderBy: { code: 'asc' },
            })
            for (const a of assets) {
                const processed = recalcAsset(a)
                itemsData.push({
                    refId: a.id,
                    refCode: a.code,
                    name: a.name,
                    unit: null,
                    systemQty: 1,
                    unitCost: Number(processed.netBookValue) || 0,
                    originalCost: Number(a.originalCost) || 0,
                    accumulatedDep: Number(processed.accumulatedDepreciation) || 0,
                    netBookValue: Number(processed.netBookValue) || 0,
                })
            }
        }

        const created = await prisma.inventoryCount.create({
            data: {
                code,
                countDate: dateStr,
                type,
                status: 'draft',
                warehouseId: warehouseId || null,
                notes: notes || null,
                totalItems: itemsData.length,
                branchId,
                createdBy: userId,
                items: { create: itemsData },
            },
            include: { items: true },
        })

        res.status(201).json({ success: true, data: created })
    } catch (err: any) {
        console.error('POST /inventory-count error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// GET /api/tax/inventory-count — list with filters (?type=&status=&from=&to=)
router.get('/inventory-count', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma! as any
        const type = req.query.type as string | undefined
        const status = req.query.status as string | undefined
        const from = req.query.from as string | undefined
        const to = req.query.to as string | undefined

        const where: any = { ...getBranchFilter(req) }
        if (type) where.type = type
        if (status) where.status = status
        if (from || to) {
            where.countDate = {}
            if (from) where.countDate.gte = from
            if (to) where.countDate.lte = to
        }

        const data = await prisma.inventoryCount.findMany({
            where,
            orderBy: { countDate: 'desc' },
        })
        res.json({ success: true, data })
    } catch (err) {
        console.error('GET /inventory-count error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// GET /api/tax/inventory-count/:id — single count session with items
router.get('/inventory-count/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma! as any
        const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id
        const session = await prisma.inventoryCount.findUnique({
            where: { id },
            include: { items: { orderBy: { name: 'asc' } } },
        })
        if (!session) return res.status(404).json({ success: false, error: 'Không tìm thấy phiên kiểm kê' })
        res.json({ success: true, data: session })
    } catch (err) {
        console.error('GET /inventory-count/:id error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// PUT /api/tax/inventory-count/:id/items — bulk-update counted quantities (+ variance)
router.put('/inventory-count/:id/items', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma! as any
        const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id
        const session = await prisma.inventoryCount.findUnique({ where: { id } })
        if (!session) return res.status(404).json({ success: false, error: 'Không tìm thấy phiên kiểm kê' })
        if (session.status !== 'draft') {
            return res.status(400).json({ success: false, error: 'Phiên kiểm kê đã được chốt, không thể chỉnh sửa' })
        }

        const items = Array.isArray(req.body?.items) ? req.body.items : []
        if (!items.length) return res.status(400).json({ success: false, error: 'items rỗng' })

        const existing = await prisma.inventoryCountItem.findMany({ where: { countId: id } })
        const itemMap = new Map(existing.map((it: any) => [it.id, it]))

        const updated: any[] = []
        for (const incoming of items) {
            const it: any = itemMap.get(incoming.itemId)
            if (!it) continue
            const countedQty = incoming.countedQty === null || incoming.countedQty === undefined
                ? null
                : Number(incoming.countedQty)
            if (countedQty !== null && !Number.isFinite(countedQty)) {
                return res.status(400).json({ success: false, error: `countedQty không hợp lệ cho item ${incoming.itemId}` })
            }
            const variance = countedQty === null ? 0 : countedQty - (Number(it.systemQty) || 0)
            const updateData: any = {
                countedQty,
                variance,
                notes: incoming.notes !== undefined ? (incoming.notes || null) : it.notes,
            }
            // Asset condition (good | damaged | missing | disposed)
            if (incoming.condition !== undefined) updateData.condition = incoming.condition || null
            const u = await prisma.inventoryCountItem.update({ where: { id: it.id }, data: updateData })
            updated.push(u)
        }

        res.json({ success: true, data: { updatedCount: updated.length, items: updated } })
    } catch (err: any) {
        console.error('PUT /inventory-count/:id/items error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// POST /api/tax/inventory-count/:id/finalize — lock + generate adjustment journal entries
router.post('/inventory-count/:id/finalize', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma! as any
        const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id
        const session = await prisma.inventoryCount.findUnique({
            where: { id },
            include: { items: true },
        })
        if (!session) return res.status(404).json({ success: false, error: 'Không tìm thấy phiên kiểm kê' })
        if (session.status !== 'draft') {
            return res.status(400).json({ success: false, error: 'Phiên kiểm kê đã được chốt trước đó' })
        }

        const branchId = getBranchId(req) || null
        const userId = req.user?.userId || null
        const journalDate = session.countDate

        const entries: any[] = []
        let surplusCount = 0, shortageCount = 0
        let surplusValue = 0, shortageValue = 0

        if (session.type === 'goods') {
            for (const item of session.items) {
                if (item.countedQty === null || item.countedQty === undefined) continue
                const variance = Number(item.variance) || 0
                if (variance === 0) continue
                const unitCost = Number(item.unitCost) || 0
                const amount = Math.abs(variance) * unitCost
                const ref = `KK-${session.code}-${item.refCode || item.refId}`

                if (variance > 0) {
                    // Hàng thừa: Nợ TK156 / Có TK338
                    surplusCount++
                    surplusValue += amount
                    if (amount > 0) {
                        const e = await prisma.journalEntry.create({
                            data: {
                                date: journalDate,
                                description: `Kiểm kê thừa - ${item.name} (+${variance})`,
                                debitAccount: '156', debitAccountName: 'Hàng hóa',
                                creditAccount: '338', creditAccountName: 'Phải trả, phải nộp khác (hàng thừa chờ xử lý)',
                                amount, reference: ref, referenceType: 'inventory-count',
                                branchId, createdBy: userId,
                            },
                        })
                        entries.push(e)
                    }
                } else {
                    // Hàng thiếu: Nợ TK138 / Có TK156
                    shortageCount++
                    shortageValue += amount
                    if (amount > 0) {
                        const e = await prisma.journalEntry.create({
                            data: {
                                date: journalDate,
                                description: `Kiểm kê thiếu - ${item.name} (${variance})`,
                                debitAccount: '138', debitAccountName: 'Phải thu khác (hàng thiếu chờ xử lý)',
                                creditAccount: '156', creditAccountName: 'Hàng hóa',
                                amount, reference: ref, referenceType: 'inventory-count',
                                branchId, createdBy: userId,
                            },
                        })
                        entries.push(e)
                    }
                }

                // Adjust system stock to match counted value (single source of truth post-count)
                const newQty = Number(item.countedQty) || 0
                if (session.warehouseId) {
                    await prisma.warehouseStock.updateMany({
                        where: { warehouseId: session.warehouseId, productId: item.refId },
                        data: { quantity: Math.round(newQty) },
                    })
                } else {
                    await prisma.product.update({
                        where: { id: item.refId },
                        data: { stock: Math.round(newQty) },
                    }).catch(() => { /* product may have been deleted */ })
                }
            }
        } else {
            // type === 'fixed-assets'
            for (const item of session.items) {
                const condition = (item.condition || '').toLowerCase()
                const isDisposed = condition === 'disposed' || condition === 'missing'
                if (!isDisposed) continue

                const original = Number(item.originalCost) || 0
                const accumDep = Number(item.accumulatedDep) || 0
                const nbv = Number(item.netBookValue) || 0
                shortageCount++
                shortageValue += nbv

                const ref = `KK-${session.code}-${item.refCode || item.refId}`
                // Nợ TK214 / Có TK211 — write off accumulated depreciation against original cost
                if (accumDep > 0) {
                    const e = await prisma.journalEntry.create({
                        data: {
                            date: journalDate,
                            description: `Thanh lý TSCĐ kiểm kê - ${item.name} (KH lũy kế)`,
                            debitAccount: '214', debitAccountName: 'Hao mòn TSCĐ',
                            creditAccount: '211', creditAccountName: 'TSCĐ hữu hình',
                            amount: accumDep, reference: ref, referenceType: 'inventory-count',
                            branchId, createdBy: userId,
                        },
                    })
                    entries.push(e)
                }
                // If remaining NBV > 0: Nợ TK811 / Có TK211 — loss on disposal
                if (nbv > 0) {
                    const e = await prisma.journalEntry.create({
                        data: {
                            date: journalDate,
                            description: `Thanh lý TSCĐ kiểm kê - ${item.name} (GTCL)`,
                            debitAccount: '811', debitAccountName: 'Chi phí khác (thanh lý TSCĐ)',
                            creditAccount: '211', creditAccountName: 'TSCĐ hữu hình',
                            amount: nbv, reference: ref, referenceType: 'inventory-count',
                            branchId, createdBy: userId,
                        },
                    })
                    entries.push(e)
                }

                // Mark asset as disposed
                await prisma.fixedAsset.update({
                    where: { id: item.refId },
                    data: { status: 'disposed', disposalDate: journalDate, monthlyDepreciation: 0 },
                }).catch(() => { /* asset may have been deleted */ })
            }
        }

        const finalized = await prisma.inventoryCount.update({
            where: { id },
            data: {
                status: 'finalized',
                finalizedAt: new Date(),
                finalizedBy: userId,
                surplusCount,
                shortageCount,
                surplusValue,
                shortageValue,
            },
            include: { items: true },
        })

        res.json({
            success: true,
            data: {
                session: finalized,
                journalEntries: entries,
                summary: {
                    surplusCount, shortageCount,
                    surplusValue, shortageValue,
                    netVariance: surplusValue - shortageValue,
                    entryCount: entries.length,
                },
            },
        })
    } catch (err: any) {
        console.error('POST /inventory-count/:id/finalize error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// GET /api/tax/inventory-count/:id/report — BC26-BH (goods) or D02-TS (fixed-assets)
router.get('/inventory-count/:id/report', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma! as any
        const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id
        const session = await prisma.inventoryCount.findUnique({
            where: { id },
            include: { items: { orderBy: { name: 'asc' } } },
        })
        if (!session) return res.status(404).json({ success: false, error: 'Không tìm thấy phiên kiểm kê' })

        if (session.type === 'goods') {
            // BC26-BH: Biên bản kiểm kê hàng hóa
            const columns = [
                { key: 'stt', label: 'STT' },
                { key: 'tenHang', label: 'Tên hàng' },
                { key: 'maHang', label: 'Mã hàng' },
                { key: 'dvt', label: 'ĐVT' },
                { key: 'soSoSach', label: 'Số sổ sách' },
                { key: 'soKiemKe', label: 'Số kiểm kê' },
                { key: 'chenhLech', label: 'Chênh lệch' },
                { key: 'donGia', label: 'Đơn giá' },
                { key: 'giaTriChenhLech', label: 'Giá trị chênh lệch' },
                { key: 'ghiChu', label: 'Ghi chú' },
            ]
            const rows = session.items.map((it: any, i: number) => {
                const sys = Number(it.systemQty) || 0
                const cnt = it.countedQty === null ? null : Number(it.countedQty)
                const variance = cnt === null ? 0 : cnt - sys
                const value = variance * (Number(it.unitCost) || 0)
                return {
                    stt: i + 1,
                    tenHang: it.name,
                    maHang: it.refCode || '',
                    dvt: it.unit || '',
                    soSoSach: sys,
                    soKiemKe: cnt,
                    chenhLech: variance,
                    donGia: Number(it.unitCost) || 0,
                    giaTriChenhLech: value,
                    ghiChu: it.notes || '',
                }
            })
            const summary = {
                tongSoSach: rows.reduce((s: number, r: any) => s + (r.soSoSach || 0), 0),
                tongKiemKe: rows.reduce((s: number, r: any) => s + (r.soKiemKe || 0), 0),
                tongChenhLech: rows.reduce((s: number, r: any) => s + (r.chenhLech || 0), 0),
                tongGiaTriChenhLech: rows.reduce((s: number, r: any) => s + (r.giaTriChenhLech || 0), 0),
                surplusCount: session.surplusCount,
                shortageCount: session.shortageCount,
                surplusValue: session.surplusValue,
                shortageValue: session.shortageValue,
            }
            return res.json({
                success: true,
                data: {
                    form: 'BC26-BH',
                    title: 'Biên bản kiểm kê hàng hóa',
                    sessionCode: session.code,
                    countDate: session.countDate,
                    status: session.status,
                    warehouseId: session.warehouseId,
                    notes: session.notes,
                    columns, rows, summary,
                },
            })
        }

        // D02-TS: Bảng kiểm kê TSCĐ
        const columns = [
            { key: 'stt', label: 'STT' },
            { key: 'tenTSCD', label: 'Tên TSCĐ' },
            { key: 'maTSCD', label: 'Mã' },
            { key: 'nguyenGia', label: 'Nguyên giá' },
            { key: 'khauHaoLK', label: 'Khấu hao LK' },
            { key: 'giaTriConLai', label: 'Giá trị còn lại' },
            { key: 'tinhTrang', label: 'Tình trạng' },
            { key: 'ghiChu', label: 'Ghi chú' },
        ]
        const conditionLabel = (c: string | null) => {
            switch ((c || '').toLowerCase()) {
                case 'good': return 'Tốt'
                case 'damaged': return 'Hư hỏng'
                case 'missing': return 'Mất'
                case 'disposed': return 'Thanh lý'
                default: return 'Chưa kiểm kê'
            }
        }
        const rows = session.items.map((it: any, i: number) => ({
            stt: i + 1,
            tenTSCD: it.name,
            maTSCD: it.refCode || '',
            nguyenGia: Number(it.originalCost) || 0,
            khauHaoLK: Number(it.accumulatedDep) || 0,
            giaTriConLai: Number(it.netBookValue) || 0,
            tinhTrang: conditionLabel(it.condition),
            ghiChu: it.notes || '',
        }))
        const summary = {
            tongNguyenGia: rows.reduce((s: number, r: any) => s + (r.nguyenGia || 0), 0),
            tongKhauHaoLK: rows.reduce((s: number, r: any) => s + (r.khauHaoLK || 0), 0),
            tongGiaTriConLai: rows.reduce((s: number, r: any) => s + (r.giaTriConLai || 0), 0),
            totalCount: rows.length,
            goodCount: session.items.filter((it: any) => (it.condition || '').toLowerCase() === 'good').length,
            damagedCount: session.items.filter((it: any) => (it.condition || '').toLowerCase() === 'damaged').length,
            disposedCount: session.items.filter((it: any) => {
                const c = (it.condition || '').toLowerCase()
                return c === 'disposed' || c === 'missing'
            }).length,
        }
        res.json({
            success: true,
            data: {
                form: 'D02-TS',
                title: 'Bảng kiểm kê tài sản cố định',
                sessionCode: session.code,
                countDate: session.countDate,
                status: session.status,
                notes: session.notes,
                columns, rows, summary,
            },
        })
    } catch (err: any) {
        console.error('GET /inventory-count/:id/report error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// ─── Z-REPORTS (Báo cáo Z — chốt ca cuối ngày POS) ───────────────────────────

// Normalize an arbitrary date string/Date into midnight UTC of that calendar day.
// Used as the canonical key on ZReport so (registerId, date) uniqueness fires
// regardless of what time-of-day the client sends.
function zReportDayKey(input: any): Date | null {
    if (!input) return null
    const d = input instanceof Date ? input : new Date(String(input))
    if (isNaN(d.getTime())) return null
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

// GET /api/tax/z-reports/calculate?date=YYYY-MM-DD&registerId=...
// Computes Z-Report figures from POS transactions for the given day.
// Returns calculated values for the frontend to review before persisting.
// NOTE: Transaction has no registerId column today, so `registerId` is echoed
// back but does not filter the orders query — date + branch isolation only.
router.get('/z-reports/calculate', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma! as any
        const dateStr = req.query.date as string | undefined
        const registerId = (req.query.registerId as string | undefined) || ''
        const day = zReportDayKey(dateStr)
        if (!day) return res.status(400).json({ success: false, error: 'date là bắt buộc (YYYY-MM-DD)' })
        const dayStart = day
        const dayEnd = new Date(day.getTime() + 24 * 60 * 60 * 1000 - 1)

        const branchFilter = getBranchFilter(req as any)
        // Transactions for the day: prefer transactionDate, fall back to createdAt
        const txWhere: any = {
            status: { in: ['completed', 'partial'] },
            OR: [
                { transactionDate: { gte: dayStart, lte: dayEnd } },
                { transactionDate: null, createdAt: { gte: dayStart, lte: dayEnd } },
            ],
            ...branchFilter,
        }
        const txs = await prisma.transaction.findMany({
            where: txWhere,
            include: { payments: true },
        })

        let totalSales = 0
        let totalDiscounts = 0
        let cashSales = 0
        let cardSales = 0
        for (const tx of txs) {
            totalSales += Number(tx.total) || 0
            totalDiscounts += Number(tx.discount) || 0
            for (const p of (tx.payments || [])) {
                const t = String(p.type || '').toLowerCase()
                const amt = Number(p.amount) || 0
                if (t === 'cash' || t === 'tiền mặt') cashSales += amt
                else if (t === 'card' || t === 'credit_card' || t === 'debit_card' || t === 'pos') cardSales += amt
            }
        }

        // Returns: ReturnOrder refunded/processed during the day
        const returns = await prisma.returnOrder.findMany({
            where: {
                status: { in: ['refunded', 'approved', 'processing', 'exchanged'] },
                OR: [
                    { refundedAt: { gte: dayStart, lte: dayEnd } },
                    { processedAt: { gte: dayStart, lte: dayEnd } },
                    { refundedAt: null, processedAt: null, createdAt: { gte: dayStart, lte: dayEnd } },
                ],
                ...branchFilter,
            },
        })
        const totalReturns = returns.reduce((s: number, r: any) => s + (Number(r.totalRefund || r.refundAmount) || 0), 0)
        const netSales = totalSales - totalReturns - totalDiscounts

        res.json({
            success: true,
            data: {
                date: dateStr,
                registerId,
                cashSales,
                cardSales,
                totalSales,
                totalReturns,
                totalDiscounts,
                netSales,
                transactionCount: txs.length,
                returnCount: returns.length,
            },
        })
    } catch (err) {
        console.error('GET /z-reports/calculate error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// GET /api/tax/z-reports?from=&to=&registerId=
router.get('/z-reports', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma! as any
        const from = req.query.from ? zReportDayKey(req.query.from) : null
        const to = req.query.to ? zReportDayKey(req.query.to) : null
        const registerId = req.query.registerId as string | undefined

        const where: any = { ...getBranchFilter(req as any) }
        if (from || to) {
            where.date = {}
            if (from) where.date.gte = from
            if (to) where.date.lte = new Date(to.getTime() + 24 * 60 * 60 * 1000 - 1)
        }
        if (registerId) where.registerId = registerId

        const data = await prisma.zReport.findMany({ where, orderBy: { date: 'desc' } })
        res.json({ success: true, data })
    } catch (err) {
        console.error('GET /z-reports error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// GET /api/tax/z-reports/:id
router.get('/z-reports/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma! as any
        const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id
        const data = await prisma.zReport.findFirst({ where: { id, ...getBranchFilter(req as any) } })
        if (!data) return res.status(404).json({ success: false, error: 'Z-Report not found' })
        res.json({ success: true, data })
    } catch (err) {
        console.error('GET /z-reports/:id error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// POST /api/tax/z-reports
router.post('/z-reports', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma! as any
        const {
            date, registerId,
            cashStart, cashEnd, cashSales, cardSales,
            totalSales, totalReturns, totalDiscounts, netSales, cashDifference,
            notes,
        } = req.body

        if (!date) return res.status(400).json({ success: false, error: 'date là bắt buộc' })
        if (!registerId?.toString().trim()) return res.status(400).json({ success: false, error: 'registerId là bắt buộc' })
        const day = zReportDayKey(date)
        if (!day) return res.status(400).json({ success: false, error: 'date không hợp lệ' })

        const regId = registerId.toString().trim()
        const existing = await prisma.zReport.findFirst({ where: { registerId: regId, date: day } })
        if (existing) {
            return res.status(409).json({
                success: false,
                error: `Đã có Z-Report cho máy ${regId} ngày ${day.toISOString().slice(0, 10)}`,
                data: existing,
            })
        }

        const num = (v: any) => Number(v) || 0
        const created = await prisma.zReport.create({
            data: {
                date: day,
                registerId: regId,
                cashStart: num(cashStart),
                cashEnd: num(cashEnd),
                cashSales: num(cashSales),
                cardSales: num(cardSales),
                totalSales: num(totalSales),
                totalReturns: num(totalReturns),
                totalDiscounts: num(totalDiscounts),
                netSales: num(netSales),
                cashDifference: num(cashDifference),
                notes: notes || null,
                branchId: getBranchId(req as any) || null,
                createdBy: req.user?.userId || null,
            },
        })
        res.status(201).json({ success: true, data: created })
    } catch (err) {
        console.error('POST /z-reports error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// Quarterly Corporate Income Tax declaration per TT200/2014 + circular 80/2021.
// Line codes (ct01..ct07) match mã chỉ tiêu on form 03/TNDN.

const CIT_DEFAULT_RATE = 20 // % — standard CIT rate

function citQuarterRange(year: number, quarter: number) {
    const startMonth = (quarter - 1) * 3 // 0,3,6,9
    const dateGte = `${year}-${String(startMonth + 1).padStart(2, '0')}-01`
    const endMonth = startMonth + 3 // 3,6,9,12
    const dateLte = `${year}-${String(endMonth).padStart(2, '0')}-31`
    const txStart = new Date(year, startMonth, 1)
    const txEnd = new Date(year, endMonth, 0, 23, 59, 59, 999)
    return { dateGte, dateLte, txStart, txEnd }
}

function citPeriodKey(year: number, quarter: number) {
    return `CIT-Q${quarter}/${year}`
}

async function computeCitLines(prisma: any, year: number, quarter: number) {
    const { dateGte, dateLte } = citQuarterRange(year, quarter)
    const entries = await prisma.journalEntry.findMany({
        where: { date: { gte: dateGte, lte: dateLte } },
        select: { debitAccount: true, creditAccount: true, amount: true },
    })

    const sumCredit = (prefix: string) =>
        entries.filter((e: any) => e.creditAccount?.startsWith(prefix))
            .reduce((s: number, e: any) => s + (e.amount || 0), 0)
    const sumDebit = (prefix: string) =>
        entries.filter((e: any) => e.debitAccount?.startsWith(prefix))
            .reduce((s: number, e: any) => s + (e.amount || 0), 0)

    const rev511 = sumCredit('511')
    const rev515 = sumCredit('515')
    const rev711 = sumCredit('711')
    const exp632 = sumDebit('632')
    const exp635 = sumDebit('635')
    const exp641 = sumDebit('641')
    const exp642 = sumDebit('642')
    const exp811 = sumDebit('811')

    const totalRevenue = rev511 + rev515 + rev711
    const totalExpenses = exp632 + exp635 + exp641 + exp642 + exp811

    const ct01 = totalRevenue
    const ct02 = 0
    const ct03 = ct01 - totalExpenses
    const ct04 = 0
    const ct05 = Math.max(0, ct03 - ct04)
    const ct06 = CIT_DEFAULT_RATE
    const ct07 = Math.round(ct05 * ct06 / 100)

    const lineItems = [
        { code: 'ct01', label: 'Tổng doanh thu', value: ct01 },
        { code: 'ct02', label: 'Doanh thu miễn thuế', value: ct02 },
        { code: 'ct03', label: 'Thu nhập chịu thuế', value: ct03 },
        { code: 'ct04', label: 'Lỗ kết chuyển', value: ct04 },
        { code: 'ct05', label: 'TNCT sau chuyển lỗ', value: ct05 },
        { code: 'ct06', label: 'Thuế suất (%)', value: ct06 },
        { code: 'ct07', label: 'Thuế TNDN phải nộp', value: ct07 },
    ]

    return {
        lineItems,
        revenue: { tk511: rev511, tk515: rev515, tk711: rev711, total: totalRevenue },
        expenses: { tk632: exp632, tk635: exp635, tk641: exp641, tk642: exp642, tk811: exp811, total: totalExpenses },
    }
}

// GET /api/tax/cit-declaration/calculate?year=2026&quarter=1
router.get('/cit-declaration/calculate', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma! as any
        const year = Number(req.query.year) || new Date().getFullYear()
        const quarter = Number(req.query.quarter)
        if (!quarter || quarter < 1 || quarter > 4) {
            return res.status(400).json({ success: false, error: 'quarter phải từ 1 đến 4' })
        }
        const data = await computeCitLines(prisma, year, quarter)
        res.json({ success: true, data: { year, quarter, period: citPeriodKey(year, quarter), formType: '03_TNDN', ...data } })
    } catch (err) {
        console.error('GET /cit-declaration/calculate error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// GET /api/tax/cit-declaration?year=2026 — list CIT declarations for the year
router.get('/cit-declaration', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const year = Number(req.query.year) || new Date().getFullYear()
        const rows = await prisma.taxDeclaration.findMany({
            where: { formType: '03_TNDN', year },
            orderBy: [{ year: 'desc' }, { quarter: 'desc' }],
        })
        const data = rows.map(r => {
            let lineItems: any[] = []
            try { lineItems = r.notes ? JSON.parse(r.notes).lineItems || [] : [] } catch (_) { }
            return {
                id: r.id, period: r.period, year: r.year, quarter: r.quarter,
                formType: r.formType, status: r.status,
                taxCode: r.taxCode, companyName: r.companyName,
                filedAt: r.filedAt, createdAt: r.createdAt, updatedAt: r.updatedAt,
                lineItems,
            }
        })
        res.json({ success: true, data })
    } catch (err) {
        console.error('GET /cit-declaration error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// POST /api/tax/cit-declaration — persist a CIT declaration (one per year+quarter)
router.post('/cit-declaration', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma! as any
        const year = Number(req.body.year)
        const quarter = Number(req.body.quarter)
        const status = (req.body.status as string) || 'draft'
        const notesText = (req.body.notes as string) || ''
        const bodyLines = Array.isArray(req.body.lineItems) ? req.body.lineItems : null

        if (!year || !quarter || quarter < 1 || quarter > 4) {
            return res.status(400).json({ success: false, error: 'year và quarter (1-4) là bắt buộc' })
        }
        if (!['draft', 'submitted', 'filed'].includes(status)) {
            return res.status(400).json({ success: false, error: 'status không hợp lệ' })
        }

        const period = citPeriodKey(year, quarter)
        const existing = await prisma.taxDeclaration.findFirst({
            where: { formType: '03_TNDN', year, quarter },
        })
        if (existing) {
            return res.status(409).json({
                success: false,
                error: `Đã có tờ khai TNDN cho ${period}`,
                data: existing,
            })
        }

        // Pull store profile for taxCode/companyName (mirrors VAT POST /declarations)
        const storeProfile: any = await prisma.store.findFirst().catch(() => null)
            || await prisma.storeSettings.findFirst().catch(() => null)
        const taxCode = (req.body.taxCode as string) || storeProfile?.taxCode || ''
        const companyName = (req.body.companyName as string) || storeProfile?.name || ''
        const companyAddress = (req.body.companyAddress as string) || storeProfile?.address || null

        // If lineItems weren't supplied, compute from journal entries
        let lineItems = bodyLines
        if (!lineItems || lineItems.length === 0) {
            const computed = await computeCitLines(prisma, year, quarter)
            lineItems = computed.lineItems
        }

        const payload = JSON.stringify({ lineItems, userNotes: notesText })

        const data = await prisma.taxDeclaration.create({
            data: {
                formType: '03_TNDN',
                businessType: 'company',
                period,
                periodType: 'quarter',
                year,
                quarter,
                month: null,
                taxCode, companyName, companyAddress,
                status,
                filedAt: status === 'filed' ? new Date() : null,
                notes: payload,
            },
        })

        res.status(201).json({
            success: true,
            data: { ...data, lineItems },
        })
    } catch (err: any) {
        console.error('POST /cit-declaration error:', err)
        if (err?.code === 'P2002') {
            return res.status(409).json({ success: false, error: 'Tờ khai cho kỳ này đã tồn tại' })
        }
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// GET /api/tax/cit-declaration/appendix/pl01-1?year=&quarter=
// PL01-1: chi tiết doanh thu — nhóm theo danh mục sản phẩm (Category)
router.get('/cit-declaration/appendix/pl01-1', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma! as any
        const year = Number(req.query.year) || new Date().getFullYear()
        const quarter = Number(req.query.quarter)
        if (!quarter || quarter < 1 || quarter > 4) {
            return res.status(400).json({ success: false, error: 'quarter phải từ 1 đến 4' })
        }
        const { txStart, txEnd } = citQuarterRange(year, quarter)
        const bf = getBranchFilter(req as any)

        const txs = await prisma.transaction.findMany({
            where: {
                status: { in: ['completed', 'partial'] },
                ...bf,
                OR: [
                    { transactionDate: { gte: txStart, lte: txEnd } },
                    { transactionDate: null, createdAt: { gte: txStart, lte: txEnd } },
                ],
            },
            include: {
                items: { include: { product: { include: { category: true } } } },
            },
        })

        // Aggregate by category
        const byCategory: Record<string, { categoryId: string; categoryName: string; quantity: number; revenue: number; discount: number; netRevenue: number; itemCount: number }> = {}
        let totalQuantity = 0, totalRevenue = 0, totalDiscount = 0
        for (const tx of txs) {
            for (const it of (tx.items || [])) {
                const cat = it.product?.category
                const key = cat?.id || 'other'
                const name = cat?.name || 'Khác'
                if (!byCategory[key]) byCategory[key] = { categoryId: key, categoryName: name, quantity: 0, revenue: 0, discount: 0, netRevenue: 0, itemCount: 0 }
                const gross = (it.unitPrice || 0) * (it.quantity || 0)
                const disc = it.discount || 0
                const net = it.lineTotal || (gross - disc)
                byCategory[key].quantity += it.quantity || 0
                byCategory[key].revenue += gross
                byCategory[key].discount += disc
                byCategory[key].netRevenue += net
                byCategory[key].itemCount += 1
                totalQuantity += it.quantity || 0
                totalRevenue += gross
                totalDiscount += disc
            }
        }

        const rows = Object.values(byCategory)
            .sort((a, b) => b.netRevenue - a.netRevenue)
            .map((r, i) => ({ stt: i + 1, ...r }))
        const totalNetRevenue = totalRevenue - totalDiscount

        res.json({
            success: true,
            data: {
                year, quarter, period: citPeriodKey(year, quarter),
                appendix: 'PL01-1',
                title: 'Phụ lục PL01-1: Chi tiết doanh thu theo nhóm hàng',
                rows,
                summary: { totalQuantity, totalRevenue, totalDiscount, totalNetRevenue, transactionCount: txs.length },
            },
        })
    } catch (err) {
        console.error('GET /cit-declaration/appendix/pl01-1 error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// GET /api/tax/cit-declaration/appendix/pl01-2?year=&quarter=
// PL01-2: chi tiết chi phí — nhóm theo tài khoản chi phí (TK632, TK635, TK641, TK642, TK811)
router.get('/cit-declaration/appendix/pl01-2', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma! as any
        const year = Number(req.query.year) || new Date().getFullYear()
        const quarter = Number(req.query.quarter)
        if (!quarter || quarter < 1 || quarter > 4) {
            return res.status(400).json({ success: false, error: 'quarter phải từ 1 đến 4' })
        }
        const { dateGte, dateLte } = citQuarterRange(year, quarter)

        const entries = await prisma.journalEntry.findMany({
            where: { date: { gte: dateGte, lte: dateLte } },
            select: { debitAccount: true, debitAccountName: true, amount: true },
        })

        const groups: Array<{ code: string; label: string }> = [
            { code: '632', label: 'Giá vốn hàng bán' },
            { code: '635', label: 'Chi phí tài chính' },
            { code: '641', label: 'Chi phí bán hàng' },
            { code: '642', label: 'Chi phí quản lý doanh nghiệp' },
            { code: '811', label: 'Chi phí khác' },
        ]

        // Aggregate amounts and collect sub-account breakdown per group
        const rows = groups.map((g, idx) => {
            const matched = entries.filter((e: any) => e.debitAccount?.startsWith(g.code))
            const amount = matched.reduce((s: number, e: any) => s + (e.amount || 0), 0)
            const subMap: Record<string, { code: string; name: string; amount: number; count: number }> = {}
            for (const e of matched) {
                const k = e.debitAccount
                if (!subMap[k]) subMap[k] = { code: k, name: e.debitAccountName || k, amount: 0, count: 0 }
                subMap[k].amount += e.amount || 0
                subMap[k].count += 1
            }
            return {
                stt: idx + 1,
                accountCode: g.code,
                accountName: g.label,
                amount,
                entryCount: matched.length,
                breakdown: Object.values(subMap).sort((a, b) => b.amount - a.amount),
            }
        })

        const totalExpenses = rows.reduce((s, r) => s + r.amount, 0)

        res.json({
            success: true,
            data: {
                year, quarter, period: citPeriodKey(year, quarter),
                appendix: 'PL01-2',
                title: 'Phụ lục PL01-2: Chi tiết chi phí theo tài khoản',
                rows,
                summary: { totalExpenses, entryCount: entries.length },
            },
        })
    } catch (err) {
        console.error('GET /cit-declaration/appendix/pl01-2 error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// Tính thuế TNCN cuối năm cho từng nhân viên từ PayrollRecord.
// Biểu lũy tiến từng phần 5%→35% theo Luật thuế TNCN.
// Mức giảm trừ: bản thân 11tr/tháng (NĐ44/2023), phụ thuộc 4.4tr/tháng/người.

const PIT_FORM_TYPE = '05_QTT_TNCN'
const PIT_SELF_DEDUCTION_PER_MONTH = 11_000_000
const PIT_DEPENDENT_DEDUCTION_PER_MONTH = 4_400_000

// Biểu thuế lũy tiến từng phần — annual brackets (VND), Vietnamese PIT law
const PIT_BRACKETS_ANNUAL: { upTo: number; rate: number }[] = [
    { upTo: 60_000_000, rate: 0.05 },
    { upTo: 120_000_000, rate: 0.10 },
    { upTo: 216_000_000, rate: 0.15 },
    { upTo: 384_000_000, rate: 0.20 },
    { upTo: 624_000_000, rate: 0.25 },
    { upTo: 960_000_000, rate: 0.30 },
    { upTo: Infinity, rate: 0.35 },
]

function calculatePitProgressive(taxableIncome: number): number {
    if (taxableIncome <= 0) return 0
    let tax = 0
    let prevCap = 0
    for (const b of PIT_BRACKETS_ANNUAL) {
        const slice = Math.min(taxableIncome, b.upTo) - prevCap
        if (slice <= 0) break
        tax += slice * b.rate
        prevCap = b.upTo
        if (taxableIncome <= b.upTo) break
    }
    return Math.round(tax)
}

interface PitEmployeeBreakdown {
    employeeId: string
    employeeCode: string | null
    name: string
    department: string | null
    monthsWorked: number
    totalIncome: number          // Tổng thu nhập chịu thuế
    totalInsurance: number       // BHXH + BHYT + BHTN (phần NLĐ) — khấu trừ trước thuế
    selfDeduction: number        // Giảm trừ bản thân
    dependentDeduction: number   // Giảm trừ người phụ thuộc
    deductions: number           // Tổng giảm trừ (BH + bản thân + phụ thuộc)
    taxableIncome: number        // Thu nhập tính thuế
    taxAmount: number            // Thuế TNCN phải nộp theo biểu lũy tiến
    pitWithheld: number          // Thuế TNCN đã khấu trừ trong năm (sum monthly pit)
    balanceDue: number           // taxAmount - pitWithheld (>0: nộp thêm, <0: hoàn)
}

function aggregatePitByEmployee(records: any[]): PitEmployeeBreakdown[] {
    const byEmp = new Map<string, any[]>()
    for (const r of records) {
        const key = r.employeeId || r.employeeName
        if (!key) continue
        if (!byEmp.has(key)) byEmp.set(key, [])
        byEmp.get(key)!.push(r)
    }

    const result: PitEmployeeBreakdown[] = []
    for (const [employeeId, recs] of byEmp.entries()) {
        const sample = recs[0]
        let totalIncome = 0
        let totalInsurance = 0
        let dependentMonths = 0
        let pitWithheld = 0
        const monthsSeen = new Set<number>()
        for (const r of recs) {
            const gross = Number(r.actualGross) || Number(r.grossSalary) || 0
            const bonus = Number(r.bonus) || 0
            // actualGross may or may not already include bonus depending on how payroll was entered.
            // If actualGross < grossSalary, treat bonus as not yet rolled in.
            const hasBonusInActual = gross >= Number(r.grossSalary || 0)
            totalIncome += gross + (hasBonusInActual ? 0 : bonus)
            totalInsurance += (Number(r.bhxh_emp) || 0) + (Number(r.bhyt_emp) || 0) + (Number(r.bhtn_emp) || 0)
            dependentMonths += Number(r.dependents) || 0
            pitWithheld += Number(r.pit) || 0
            if (typeof r.month === 'number') monthsSeen.add(r.month)
        }
        const monthsWorked = monthsSeen.size || recs.length
        const selfDeduction = monthsWorked * PIT_SELF_DEDUCTION_PER_MONTH
        const dependentDeduction = dependentMonths * PIT_DEPENDENT_DEDUCTION_PER_MONTH
        const deductions = totalInsurance + selfDeduction + dependentDeduction
        const taxableIncome = Math.max(0, totalIncome - deductions)
        const taxAmount = calculatePitProgressive(taxableIncome)
        result.push({
            employeeId,
            employeeCode: sample.employeeCode || null,
            name: sample.employeeName || '',
            department: sample.department || null,
            monthsWorked,
            totalIncome: Math.round(totalIncome),
            totalInsurance: Math.round(totalInsurance),
            selfDeduction,
            dependentDeduction,
            deductions: Math.round(deductions),
            taxableIncome: Math.round(taxableIncome),
            taxAmount,
            pitWithheld: Math.round(pitWithheld),
            balanceDue: taxAmount - Math.round(pitWithheld),
        })
    }
    result.sort((a, b) => a.name.localeCompare(b.name, 'vi'))
    return result
}

function pitSummary(employees: PitEmployeeBreakdown[]) {
    return {
        totalEmployees: employees.length,
        totalIncome: employees.reduce((s, e) => s + e.totalIncome, 0),
        totalDeductions: employees.reduce((s, e) => s + e.deductions, 0),
        totalTaxableIncome: employees.reduce((s, e) => s + e.taxableIncome, 0),
        totalTax: employees.reduce((s, e) => s + e.taxAmount, 0),
        totalWithheld: employees.reduce((s, e) => s + e.pitWithheld, 0),
        totalBalanceDue: employees.reduce((s, e) => s + e.balanceDue, 0),
    }
}

// Parse the structured PIT payload we store inside TaxDeclaration.notes.
// Returns null if notes is plain text (legacy / user-entered) rather than our JSON envelope.
function parsePitNotes(notes: string | null | undefined): { userNotes?: string; employees?: PitEmployeeBreakdown[]; summary?: any } | null {
    if (!notes) return null
    try {
        const obj = JSON.parse(notes)
        if (obj && obj.__pit === true) return obj
        return null
    } catch { return null }
}

// GET /api/tax/pit-settlement/calculate?year=2024
// Tính thuế TNCN năm từ PayrollRecord (không lưu).
router.get('/pit-settlement/calculate', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma! as any
        const year = Number(req.query.year) || new Date().getFullYear()
        const records = await prisma.payrollRecord.findMany({
            where: { year },
            orderBy: [{ employeeName: 'asc' }, { month: 'asc' }],
        })
        const employees = aggregatePitByEmployee(records)
        res.json({
            success: true,
            data: {
                year,
                summary: pitSummary(employees),
                employees,
            },
        })
    } catch (err) {
        console.error('GET /pit-settlement/calculate error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// POST /api/tax/pit-settlement
// Lưu bản quyết toán TNCN năm (Form 05/QTT-TNCN) vào TaxDeclaration.
// period = `QTT-{year}` (unique). Chi tiết per-employee lưu trong notes (JSON envelope).
router.post('/pit-settlement', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const year = Number(req.body.year)
        if (!year) return res.status(400).json({ success: false, error: 'year là bắt buộc' })

        const employees: PitEmployeeBreakdown[] = Array.isArray(req.body.employees) ? req.body.employees : []
        const status = (req.body.status as string) || 'draft'
        const userNotes = typeof req.body.notes === 'string' ? req.body.notes : ''

        const summary = pitSummary(employees)
        const totalTax = Number(req.body.totalTax) || summary.totalTax

        const store: any = await (prisma as any).storeSettings.findFirst().catch(() => null)
        const taxCode = store?.taxCode || ''
        const companyName = store?.name || 'My Store'
        const companyAddress = store?.address || null

        const period = `QTT-${year}`
        const existing = await prisma.taxDeclaration.findUnique({ where: { period } })
        if (existing) {
            return res.status(409).json({
                success: false,
                error: `Đã có quyết toán TNCN cho năm ${year}. Xóa bản cũ trước khi tạo lại.`,
                data: existing,
            })
        }

        const notesPayload = JSON.stringify({
            __pit: true,
            userNotes,
            summary,
            employees,
        })

        const data = await prisma.taxDeclaration.create({
            data: {
                formType: PIT_FORM_TYPE,
                period,
                periodType: 'year',
                year,
                month: null,
                quarter: null,
                taxCode,
                companyName,
                companyAddress,
                businessType: store?.businessType || 'company',
                status,
                notes: notesPayload,
            },
        })

        res.status(201).json({
            success: true,
            data: {
                id: data.id,
                year,
                period,
                status: data.status,
                totalTax,
                summary,
                employees,
            },
        })
    } catch (err: any) {
        console.error('POST /pit-settlement error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// GET /api/tax/pit-settlement?year=2024
// Liệt kê các bản quyết toán TNCN. Không truyền year → liệt kê tất cả.
router.get('/pit-settlement', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const yearQ = req.query.year ? Number(req.query.year) : undefined
        const where: any = { formType: PIT_FORM_TYPE }
        if (yearQ) where.year = yearQ
        const decls = await prisma.taxDeclaration.findMany({ where, orderBy: { year: 'desc' } })
        const data = decls.map(d => {
            const parsed = parsePitNotes(d.notes)
            return {
                id: d.id,
                year: d.year,
                period: d.period,
                status: d.status,
                taxCode: d.taxCode,
                companyName: d.companyName,
                filedAt: d.filedAt,
                createdAt: d.createdAt,
                updatedAt: d.updatedAt,
                userNotes: parsed?.userNotes || '',
                summary: parsed?.summary || null,
                totalEmployees: parsed?.employees?.length || 0,
            }
        })
        res.json({ success: true, data })
    } catch (err) {
        console.error('GET /pit-settlement error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// GET /api/tax/pit-settlement/:year/employees
// Chi tiết per-employee. Ưu tiên đọc từ bản quyết toán đã lưu;
// nếu chưa lưu thì tính trực tiếp từ PayrollRecord.
router.get('/pit-settlement/:year/employees', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma! as any
        const year = Number(req.params.year)
        if (!year) return res.status(400).json({ success: false, error: 'year không hợp lệ' })

        const decl = await prisma.taxDeclaration.findUnique({ where: { period: `QTT-${year}` } })
        const parsed = decl ? parsePitNotes(decl.notes) : null
        if (parsed?.employees) {
            return res.json({
                success: true,
                data: {
                    year,
                    source: 'saved',
                    declarationId: decl.id,
                    status: decl.status,
                    summary: parsed.summary || pitSummary(parsed.employees),
                    employees: parsed.employees,
                },
            })
        }

        const records = await prisma.payrollRecord.findMany({
            where: { year },
            orderBy: [{ employeeName: 'asc' }, { month: 'asc' }],
        })
        const employees = aggregatePitByEmployee(records)
        res.json({
            success: true,
            data: {
                year,
                source: 'calculated',
                summary: pitSummary(employees),
                employees,
            },
        })
    } catch (err) {
        console.error('GET /pit-settlement/:year/employees error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

//
// 3 loại điều chỉnh:
//   "increase"        — điều chỉnh tăng số lượng / đơn giá
//   "decrease"        — điều chỉnh giảm số lượng / đơn giá
//   "info_correction" — điều chỉnh thông tin (mã số thuế, tên, địa chỉ...)
//
// Bút toán khi duyệt (approve):
//   increase  → Nợ 131/Có 511 + Nợ 131/Có 3331  (tăng doanh thu + VAT đầu ra)
//   decrease  → Nợ 511/Có 131 + Nợ 3331/Có 131  (giảm doanh thu + VAT đầu ra,
//                                                  thể hiện âm trên 01/GTGT)
//   info_correction → không phát sinh bút toán (chỉ điều chỉnh thông tin)

const ADJ_TYPES = ['increase', 'decrease', 'info_correction'] as const
type AdjustmentType = typeof ADJ_TYPES[number]

function normalizeAdjustmentDate(input: any): string | null {
    if (!input) return new Date().toISOString().slice(0, 10)
    const d = input instanceof Date ? input : new Date(String(input))
    if (isNaN(d.getTime())) return null
    return d.toISOString().slice(0, 10)
}

async function nextAdjustmentInvoiceCode(prisma: any, dateStr: string): Promise<string> {
    const ymd = dateStr.replace(/-/g, '')
    const prefix = `HDDC-${ymd}-`
    const todays = await prisma.adjustmentInvoice.findMany({
        where: { code: { startsWith: prefix } },
        select: { code: true },
    })
    let max = 0
    for (const c of todays) {
        const n = parseInt(c.code.slice(prefix.length), 10)
        if (!isNaN(n) && n > max) max = n
    }
    return `${prefix}${String(max + 1).padStart(3, '0')}`
}

// Apply the sign convention: increase/info_correction keep positive numbers,
// decrease forces negative. Quantities/amounts are stored signed so the SQL
// aggregates roll up correctly on the VAT return.
function signedAdjustmentItem(raw: any, type: AdjustmentType): any {
    const itemType = (raw.adjustmentType as AdjustmentType) || type
    const absQty = Math.abs(Number(raw.quantity) || 0)
    const unitPrice = Number(raw.unitPrice) || 0
    const vatRate = Number(raw.vatRate) || 0
    const signedQty = itemType === 'decrease' ? -absQty : absQty
    const amount = signedQty * unitPrice
    const vatAmount = amount * (vatRate / 100)
    return {
        productName: String(raw.productName || '').trim(),
        productCode: raw.productCode || null,
        unit: raw.unit || null,
        quantity: signedQty,
        unitPrice,
        amount,
        vatRate,
        vatAmount,
        adjustmentType: itemType,
        notes: raw.notes || null,
    }
}

function totalsFromItems(items: any[]): { subtotal: number; vatAmount: number; totalAmount: number } {
    const subtotal = items.reduce((s, it) => s + (Number(it.amount) || 0), 0)
    const vatAmount = items.reduce((s, it) => s + (Number(it.vatAmount) || 0), 0)
    return { subtotal, vatAmount, totalAmount: subtotal + vatAmount }
}

// POST /api/tax/adjustment-invoices — create draft adjustment invoice
router.post('/adjustment-invoices', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma! as any
        const {
            adjustmentDate, type, originalInvoiceId, originalInvoiceNumber, originalInvoiceDate,
            originalInvoiceSerial, reason, buyerName, buyerTaxCode, buyerAddress,
            correctionData, items, notes,
        } = req.body

        if (!ADJ_TYPES.includes(type)) {
            return res.status(400).json({ success: false, error: `type phải là một trong: ${ADJ_TYPES.join(', ')}` })
        }
        const dateStr = normalizeAdjustmentDate(adjustmentDate)
        if (!dateStr) return res.status(400).json({ success: false, error: 'adjustmentDate không hợp lệ' })
        if (!originalInvoiceNumber?.toString().trim()) {
            return res.status(400).json({ success: false, error: 'originalInvoiceNumber là bắt buộc' })
        }
        const origDate = normalizeAdjustmentDate(originalInvoiceDate)
        if (!origDate) return res.status(400).json({ success: false, error: 'originalInvoiceDate không hợp lệ' })
        if (!reason?.toString().trim()) {
            return res.status(400).json({ success: false, error: 'reason (lý do điều chỉnh) là bắt buộc' })
        }

        const rawItems: any[] = Array.isArray(items) ? items : []
        // info_correction may have no quantitative items; increase/decrease must.
        if (type !== 'info_correction' && rawItems.length === 0) {
            return res.status(400).json({ success: false, error: 'Phải có ít nhất 1 dòng điều chỉnh' })
        }
        const itemsData = rawItems.map(it => signedAdjustmentItem(it, type as AdjustmentType))
        const totals = totalsFromItems(itemsData)

        const branchId = getBranchId(req) || null
        const userId = req.user?.userId || null
        const code = await nextAdjustmentInvoiceCode(prisma, dateStr)

        const created = await prisma.adjustmentInvoice.create({
            data: {
                code,
                adjustmentDate: dateStr,
                type,
                status: 'draft',
                originalInvoiceId: originalInvoiceId || null,
                originalInvoiceNumber: String(originalInvoiceNumber).trim(),
                originalInvoiceDate: origDate,
                originalInvoiceSerial: originalInvoiceSerial || null,
                reason: String(reason).trim(),
                buyerName: buyerName || null,
                buyerTaxCode: buyerTaxCode || null,
                buyerAddress: buyerAddress || null,
                correctionData: correctionData ? JSON.stringify(correctionData) : null,
                subtotal: totals.subtotal,
                vatAmount: totals.vatAmount,
                totalAmount: totals.totalAmount,
                notes: notes || null,
                branchId,
                createdBy: userId,
                items: { create: itemsData },
            },
            include: { items: true },
        })

        res.status(201).json({ success: true, data: created })
    } catch (err: any) {
        console.error('POST /adjustment-invoices error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// GET /api/tax/adjustment-invoices?from=&to=&type=&originalInvoiceId=&status=
router.get('/adjustment-invoices', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma! as any
        const from = req.query.from as string | undefined
        const to = req.query.to as string | undefined
        const type = req.query.type as string | undefined
        const originalInvoiceId = req.query.originalInvoiceId as string | undefined
        const status = req.query.status as string | undefined

        const where: any = { ...getBranchFilter(req) }
        if (type) where.type = type
        if (status) where.status = status
        if (originalInvoiceId) where.originalInvoiceId = originalInvoiceId
        if (from || to) {
            where.adjustmentDate = {}
            if (from) where.adjustmentDate.gte = from
            if (to) where.adjustmentDate.lte = to
        }

        const data = await prisma.adjustmentInvoice.findMany({
            where,
            orderBy: { adjustmentDate: 'desc' },
        })
        res.json({ success: true, data })
    } catch (err) {
        console.error('GET /adjustment-invoices error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// GET /api/tax/adjustment-invoices/:id — single adjustment invoice with items
router.get('/adjustment-invoices/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma! as any
        const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id
        const data = await prisma.adjustmentInvoice.findUnique({
            where: { id },
            include: { items: true },
        })
        if (!data) return res.status(404).json({ success: false, error: 'Không tìm thấy hóa đơn điều chỉnh' })
        res.json({ success: true, data })
    } catch (err) {
        console.error('GET /adjustment-invoices/:id error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// PUT /api/tax/adjustment-invoices/:id — update draft (cannot edit approved invoice)
router.put('/adjustment-invoices/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma! as any
        const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id
        const existing = await prisma.adjustmentInvoice.findUnique({ where: { id } })
        if (!existing) return res.status(404).json({ success: false, error: 'Không tìm thấy hóa đơn điều chỉnh' })
        if (existing.status !== 'draft') {
            return res.status(400).json({ success: false, error: 'Chỉ có thể chỉnh sửa hóa đơn điều chỉnh ở trạng thái draft' })
        }

        const {
            adjustmentDate, type, originalInvoiceId, originalInvoiceNumber, originalInvoiceDate,
            originalInvoiceSerial, reason, buyerName, buyerTaxCode, buyerAddress,
            correctionData, items, notes,
        } = req.body

        const updateData: any = {}

        if (type !== undefined) {
            if (!ADJ_TYPES.includes(type)) {
                return res.status(400).json({ success: false, error: `type phải là một trong: ${ADJ_TYPES.join(', ')}` })
            }
            updateData.type = type
        }
        if (adjustmentDate !== undefined) {
            const dateStr = normalizeAdjustmentDate(adjustmentDate)
            if (!dateStr) return res.status(400).json({ success: false, error: 'adjustmentDate không hợp lệ' })
            updateData.adjustmentDate = dateStr
        }
        if (originalInvoiceId !== undefined) updateData.originalInvoiceId = originalInvoiceId || null
        if (originalInvoiceNumber !== undefined) {
            if (!String(originalInvoiceNumber).trim()) {
                return res.status(400).json({ success: false, error: 'originalInvoiceNumber không được rỗng' })
            }
            updateData.originalInvoiceNumber = String(originalInvoiceNumber).trim()
        }
        if (originalInvoiceDate !== undefined) {
            const origDate = normalizeAdjustmentDate(originalInvoiceDate)
            if (!origDate) return res.status(400).json({ success: false, error: 'originalInvoiceDate không hợp lệ' })
            updateData.originalInvoiceDate = origDate
        }
        if (originalInvoiceSerial !== undefined) updateData.originalInvoiceSerial = originalInvoiceSerial || null
        if (reason !== undefined) {
            if (!String(reason).trim()) return res.status(400).json({ success: false, error: 'reason không được rỗng' })
            updateData.reason = String(reason).trim()
        }
        if (buyerName !== undefined) updateData.buyerName = buyerName || null
        if (buyerTaxCode !== undefined) updateData.buyerTaxCode = buyerTaxCode || null
        if (buyerAddress !== undefined) updateData.buyerAddress = buyerAddress || null
        if (correctionData !== undefined) {
            updateData.correctionData = correctionData ? JSON.stringify(correctionData) : null
        }
        if (notes !== undefined) updateData.notes = notes || null

        // Replace items wholesale when provided.
        if (Array.isArray(items)) {
            const effectiveType: AdjustmentType = (updateData.type || existing.type) as AdjustmentType
            if (effectiveType !== 'info_correction' && items.length === 0) {
                return res.status(400).json({ success: false, error: 'Phải có ít nhất 1 dòng điều chỉnh' })
            }
            const itemsData = items.map((it: any) => signedAdjustmentItem(it, effectiveType))
            const totals = totalsFromItems(itemsData)
            updateData.subtotal = totals.subtotal
            updateData.vatAmount = totals.vatAmount
            updateData.totalAmount = totals.totalAmount

            await prisma.adjustmentInvoiceItem.deleteMany({ where: { adjustmentId: id } })
            updateData.items = { create: itemsData }
        }

        const updated = await prisma.adjustmentInvoice.update({
            where: { id },
            data: updateData,
            include: { items: true },
        })

        res.json({ success: true, data: updated })
    } catch (err: any) {
        console.error('PUT /adjustment-invoices/:id error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// POST /api/tax/adjustment-invoices/:id/approve — finalize + create journal entries
//
// Bút toán theo TT200/TT133:
//   increase: tổng tiền hàng (subtotal) > 0
//     Nợ 131 / Có 511   subtotal
//     Nợ 131 / Có 3331  vatAmount        (chỉ khi vatAmount != 0)
//   decrease: subtotal < 0 (lưu signed); ta đảo bút toán
//     Nợ 511 / Có 131   |subtotal|
//     Nợ 3331 / Có 131  |vatAmount|
//   info_correction: không phát sinh bút toán tài chính
router.post('/adjustment-invoices/:id/approve', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma! as any
        const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id
        const inv = await prisma.adjustmentInvoice.findUnique({
            where: { id },
            include: { items: true },
        })
        if (!inv) return res.status(404).json({ success: false, error: 'Không tìm thấy hóa đơn điều chỉnh' })
        if (inv.status !== 'draft') {
            return res.status(400).json({ success: false, error: 'Hóa đơn điều chỉnh đã được duyệt trước đó' })
        }

        const branchId = getBranchId(req) || null
        const userId = req.user?.userId || null
        const journalDate = inv.adjustmentDate
        const ref = `HDDC-${inv.code}`
        const entries: any[] = []

        if (inv.type === 'increase') {
            if (inv.subtotal !== 0) {
                const e = await prisma.journalEntry.create({
                    data: {
                        date: journalDate,
                        description: `Điều chỉnh tăng doanh thu - HĐ gốc ${inv.originalInvoiceNumber}: ${inv.reason}`,
                        debitAccount: '131', debitAccountName: 'Phải thu khách hàng',
                        creditAccount: '511', creditAccountName: 'Doanh thu bán hàng và cung cấp dịch vụ',
                        amount: Math.abs(Number(inv.subtotal) || 0),
                        reference: ref, referenceType: 'adjustment-invoice',
                        branchId, createdBy: userId,
                    },
                })
                entries.push(e)
            }
            if (inv.vatAmount !== 0) {
                const e = await prisma.journalEntry.create({
                    data: {
                        date: journalDate,
                        description: `Điều chỉnh tăng VAT đầu ra - HĐ gốc ${inv.originalInvoiceNumber}`,
                        debitAccount: '131', debitAccountName: 'Phải thu khách hàng',
                        creditAccount: '3331', creditAccountName: 'Thuế GTGT đầu ra phải nộp',
                        amount: Math.abs(Number(inv.vatAmount) || 0),
                        reference: ref, referenceType: 'adjustment-invoice',
                        branchId, createdBy: userId,
                    },
                })
                entries.push(e)
            }
        } else if (inv.type === 'decrease') {
            if (inv.subtotal !== 0) {
                const e = await prisma.journalEntry.create({
                    data: {
                        date: journalDate,
                        description: `Điều chỉnh giảm doanh thu - HĐ gốc ${inv.originalInvoiceNumber}: ${inv.reason}`,
                        debitAccount: '511', debitAccountName: 'Doanh thu bán hàng và cung cấp dịch vụ',
                        creditAccount: '131', creditAccountName: 'Phải thu khách hàng',
                        amount: Math.abs(Number(inv.subtotal) || 0),
                        reference: ref, referenceType: 'adjustment-invoice',
                        branchId, createdBy: userId,
                    },
                })
                entries.push(e)
            }
            if (inv.vatAmount !== 0) {
                const e = await prisma.journalEntry.create({
                    data: {
                        date: journalDate,
                        description: `Điều chỉnh giảm VAT đầu ra - HĐ gốc ${inv.originalInvoiceNumber}`,
                        debitAccount: '3331', debitAccountName: 'Thuế GTGT đầu ra phải nộp',
                        creditAccount: '131', creditAccountName: 'Phải thu khách hàng',
                        amount: Math.abs(Number(inv.vatAmount) || 0),
                        reference: ref, referenceType: 'adjustment-invoice',
                        branchId, createdBy: userId,
                    },
                })
                entries.push(e)
            }
        }
        // info_correction: không có bút toán — chỉ duyệt và lưu correctionData.

        const approved = await prisma.adjustmentInvoice.update({
            where: { id },
            data: {
                status: 'approved',
                approvedAt: new Date(),
                approvedBy: userId,
                journalEntryIds: JSON.stringify(entries.map(e => e.id)),
            },
            include: { items: true },
        })

        res.json({
            success: true,
            data: {
                invoice: approved,
                journalEntries: entries,
                summary: {
                    type: inv.type,
                    subtotal: inv.subtotal,
                    vatAmount: inv.vatAmount,
                    totalAmount: inv.totalAmount,
                    entryCount: entries.length,
                },
            },
        })
    } catch (err: any) {
        console.error('POST /adjustment-invoices/:id/approve error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// =============================================================================
//  SPRINT 3: B03-DN Cash Flow Statement + Chart of Accounts + Multi-currency
// =============================================================================

// --- B03-DN Cash Flow Statement (TT200/2014, indirect method) ----------------

type CashFlowEntry = { debitAccount: string; creditAccount: string; amount: number }

function startsWithAny(s: string | null | undefined, prefixes: string[]) {
    if (!s) return false
    return prefixes.some(p => s.startsWith(p))
}

function sumDebitsTo(entries: CashFlowEntry[], prefixes: string[]): number {
    return entries
        .filter(e => startsWithAny(e.debitAccount, prefixes))
        .reduce((s, e) => s + (e.amount || 0), 0)
}

function sumCreditsTo(entries: CashFlowEntry[], prefixes: string[]): number {
    return entries
        .filter(e => startsWithAny(e.creditAccount, prefixes))
        .reduce((s, e) => s + (e.amount || 0), 0)
}

function netDebitChange(entries: CashFlowEntry[], prefixes: string[]): number {
    return sumDebitsTo(entries, prefixes) - sumCreditsTo(entries, prefixes)
}

function netCreditChange(entries: CashFlowEntry[], prefixes: string[]): number {
    return sumCreditsTo(entries, prefixes) - sumDebitsTo(entries, prefixes)
}

function cashFlowDateRange(year: number, month?: number) {
    if (month) {
        const startDate = `${year}-${String(month).padStart(2, '0')}-01`
        const endDay = new Date(year, month, 0).getDate()
        const endDate = `${year}-${String(month).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`
        return { startDate, endDate }
    }
    return { startDate: `${year}-01-01`, endDate: `${year}-12-31` }
}

async function computeCashFlow(prisma: any, year: number, month?: number) {
    const { startDate, endDate } = cashFlowDateRange(year, month)

    let periodEntries: CashFlowEntry[] = []
    try {
        periodEntries = await prisma.journalEntry.findMany({
            where: { date: { gte: startDate, lte: endDate } },
            select: { debitAccount: true, creditAccount: true, amount: true },
        })
    } catch (_) { periodEntries = [] }

    let openingEntries: CashFlowEntry[] = []
    try {
        openingEntries = await prisma.journalEntry.findMany({
            where: { date: { lt: startDate } },
            select: { debitAccount: true, creditAccount: true, amount: true },
        })
    } catch (_) { openingEntries = [] }

    const rev511 = sumCreditsTo(periodEntries, ['511'])
    const rev515 = sumCreditsTo(periodEntries, ['515'])
    const rev711 = sumCreditsTo(periodEntries, ['711'])
    const exp632 = sumDebitsTo(periodEntries, ['632'])
    const exp635 = sumDebitsTo(periodEntries, ['635'])
    const exp641 = sumDebitsTo(periodEntries, ['641'])
    const exp642 = sumDebitsTo(periodEntries, ['642'])
    const exp811 = sumDebitsTo(periodEntries, ['811'])
    const totalRevenue = rev511 + rev515 + rev711
    const totalExpenses = exp632 + exp635 + exp641 + exp642 + exp811
    const ct01 = totalRevenue - totalExpenses

    const ct02 = sumCreditsTo(periodEntries, ['214'])
    const ct03 = netCreditChange(periodEntries, ['229'])
    const ct04 = netCreditChange(periodEntries, ['413'])
    const ct05 = 0
    const ct06 = exp635 - rev515

    const ct08 = ct01 + ct02 + ct03 + ct04 + ct05 + ct06

    const deltaReceivables = netDebitChange(periodEntries, ['131'])
    const ct09 = -deltaReceivables
    const deltaInventory = netDebitChange(periodEntries, ['152', '155', '156'])
    const ct10 = -deltaInventory
    const deltaPayables = netCreditChange(periodEntries, ['331'])
    const ct11 = deltaPayables
    const deltaPrepaid = netDebitChange(periodEntries, ['142', '242'])
    const ct12 = -deltaPrepaid

    const ct14 = -periodEntries
        .filter(e => e.debitAccount?.startsWith('635') && startsWithAny(e.creditAccount, ['111', '112']))
        .reduce((s, e) => s + (e.amount || 0), 0)
    const ct15 = -periodEntries
        .filter(e => e.debitAccount?.startsWith('3334') && startsWithAny(e.creditAccount, ['111', '112']))
        .reduce((s, e) => s + (e.amount || 0), 0)

    const ct20 = ct08 + ct09 + ct10 + ct11 + ct12 + ct14 + ct15

    const ct21 = -periodEntries
        .filter(e => startsWithAny(e.debitAccount, ['211', '213']) && startsWithAny(e.creditAccount, ['111', '112']))
        .reduce((s, e) => s + (e.amount || 0), 0)
    const ct22 = periodEntries
        .filter(e => startsWithAny(e.creditAccount, ['211', '213']) && startsWithAny(e.debitAccount, ['111', '112']))
        .reduce((s, e) => s + (e.amount || 0), 0)
    const ct30 = ct21 + ct22

    const ct33 = periodEntries
        .filter(e => e.creditAccount?.startsWith('341') && startsWithAny(e.debitAccount, ['111', '112']))
        .reduce((s, e) => s + (e.amount || 0), 0)
    const ct34 = -periodEntries
        .filter(e => e.debitAccount?.startsWith('341') && startsWithAny(e.creditAccount, ['111', '112']))
        .reduce((s, e) => s + (e.amount || 0), 0)
    const ct36 = -periodEntries
        .filter(e => e.debitAccount?.startsWith('421') && startsWithAny(e.creditAccount, ['111', '112']))
        .reduce((s, e) => s + (e.amount || 0), 0)
    const ct40 = ct33 + ct34 + ct36

    const ct50 = ct20 + ct30 + ct40
    const ct60 = netDebitChange(openingEntries, ['111', '112'])
    const ct70 = ct60 + ct50

    return {
        period: month ? `T${String(month).padStart(2, '0')}/${year}` : `Y${year}`,
        startDate, endDate,
        operating: {
            ct01_profitBeforeTax: ct01,
            ct02_depreciation: ct02,
            ct03_provisions: ct03,
            ct04_fxGainLoss: ct04,
            ct05_investmentGainLoss: ct05,
            ct06_interestExpense: ct06,
            ct08_profitBeforeWCChanges: ct08,
            ct09_deltaReceivables: ct09,
            ct10_deltaInventory: ct10,
            ct11_deltaPayables: ct11,
            ct12_deltaPrepaid: ct12,
            ct14_interestPaid: ct14,
            ct15_citPaid: ct15,
            ct20_netCashOperating: ct20,
        },
        investing: {
            ct21_acquireFixedAssets: ct21,
            ct22_disposeFixedAssets: ct22,
            ct30_netCashInvesting: ct30,
        },
        financing: {
            ct33_borrowingsReceived: ct33,
            ct34_borrowingsRepaid: ct34,
            ct36_dividendsPaid: ct36,
            ct40_netCashFinancing: ct40,
        },
        ct50_netCashChange: ct50,
        ct60_openingCash: ct60,
        ct70_closingCash: ct70,
    }
}

// GET /api/tax/cash-flow-statement?year=&month=
router.get('/cash-flow-statement', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const year = Number(req.query.year) || new Date().getFullYear()
        const month = req.query.month ? Number(req.query.month) : undefined
        if (month && (month < 1 || month > 12)) {
            return res.status(400).json({ success: false, error: 'month phai trong khoang 1-12' })
        }

        const current = await computeCashFlow(prisma, year, month)
        const prior = await computeCashFlow(prisma, year - 1, month)

        res.json({
            success: true,
            data: {
                current,
                prior,
                comparison: {
                    operatingDelta: current.operating.ct20_netCashOperating - prior.operating.ct20_netCashOperating,
                    investingDelta: current.investing.ct30_netCashInvesting - prior.investing.ct30_netCashInvesting,
                    financingDelta: current.financing.ct40_netCashFinancing - prior.financing.ct40_netCashFinancing,
                    netChangeDelta: current.ct50_netCashChange - prior.ct50_netCashChange,
                    closingCashDelta: current.ct70_closingCash - prior.ct70_closingCash,
                },
            },
        })
    } catch (err: any) {
        console.error('GET /cash-flow-statement error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// --- Chart of Accounts (Thong tu 99/2025/TT-BTC) — seed shared from lib --------

// POST /api/tax/chart-of-accounts/seed
router.post('/chart-of-accounts/seed', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma
        if (!prisma) {
            return res.status(400).json({ success: false, error: 'Store context required' })
        }
        const force = req.body?.force === true || req.query.force === 'true'

        let created = 0, skipped = 0, updated = 0
        const errors: Array<{ code: string; error: string }> = []

        for (const acc of COA_SEED) {
            try {
                const data = {
                    code: acc.code,
                    name: acc.name,
                    nameEn: acc.nameEn ?? null,
                    level: acc.level,
                    parentCode: acc.parentCode ?? null,
                    type: acc.type,
                    nature: acc.nature,
                    description: acc.description ?? null,
                    isSystem: true,
                    isActive: true,
                }
                const existing = await prisma.chartOfAccount.findUnique({ where: { code: acc.code } })
                if (existing) {
                    if (!force) { skipped++; continue }
                    const { code: _ignored, ...updateData } = data
                    await prisma.chartOfAccount.update({ where: { code: acc.code }, data: updateData })
                    updated++
                } else {
                    try {
                        await prisma.chartOfAccount.create({ data })
                        created++
                    } catch (e: any) {
                        // P2002 = unique constraint violation (concurrent seed); treat as skip.
                        if (e?.code === 'P2002') { skipped++ } else { throw e }
                    }
                }
            } catch (itemErr: any) {
                errors.push({ code: acc.code, error: itemErr?.message || String(itemErr) })
            }
        }

        res.json({
            success: true,
            data: {
                created, updated, skipped,
                failed: errors.length,
                total: COA_SEED.length,
                ...(errors.length > 0 ? { errors } : {}),
            },
        })
    } catch (err: any) {
        console.error('POST /chart-of-accounts/seed error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// GET /api/tax/chart-of-accounts
router.get('/chart-of-accounts', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const where: any = {}
        if (req.query.type) where.type = String(req.query.type)
        if (req.query.parentCode) where.parentCode = String(req.query.parentCode)
        if (req.query.isActive !== undefined) where.isActive = req.query.isActive === 'true'
        if (req.query.q) {
            const q = String(req.query.q)
            where.OR = [
                { code: { contains: q } },
                { name: { contains: q } },
                { nameEn: { contains: q } },
            ]
        }
        const data = await prisma.chartOfAccount.findMany({
            where,
            orderBy: [{ code: 'asc' }],
        })
        res.json({ success: true, data })
    } catch (err: any) {
        console.error('GET /chart-of-accounts error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// GET /api/tax/chart-of-accounts/tree
router.get('/chart-of-accounts/tree', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const rows = await prisma.chartOfAccount.findMany({
            where: { isActive: true },
            orderBy: [{ code: 'asc' }],
        })
        type Node = any
        const byCode = new Map<string, Node>()
        for (const r of rows) byCode.set(r.code, { ...r, children: [] })
        const roots: Node[] = []
        for (const r of rows) {
            const node = byCode.get(r.code)
            if (r.parentCode && byCode.has(r.parentCode)) {
                byCode.get(r.parentCode).children.push(node)
            } else {
                roots.push(node)
            }
        }
        res.json({ success: true, data: roots })
    } catch (err: any) {
        console.error('GET /chart-of-accounts/tree error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// GET /api/tax/chart-of-accounts/:code
router.get('/chart-of-accounts/:code', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const code = Array.isArray(req.params.code) ? req.params.code[0] : req.params.code
        const acc = await prisma.chartOfAccount.findUnique({ where: { code } })
        if (!acc) return res.status(404).json({ success: false, error: 'Not found' })
        res.json({ success: true, data: acc })
    } catch (err: any) {
        console.error('GET /chart-of-accounts/:code error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// POST /api/tax/chart-of-accounts
router.post('/chart-of-accounts', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const { code, name, nameEn, level, parentCode, type, nature, description, isActive } = req.body || {}
        if (!code || !name || !type || !nature) {
            return res.status(400).json({ success: false, error: 'code, name, type, nature la bat buoc' })
        }
        const existing = await prisma.chartOfAccount.findUnique({ where: { code } }).catch(() => null)
        if (existing) {
            return res.status(409).json({ success: false, error: `Account ${code} da ton tai` })
        }
        if (parentCode) {
            const parent = await prisma.chartOfAccount.findUnique({ where: { code: parentCode } }).catch(() => null)
            if (!parent) return res.status(400).json({ success: false, error: `parentCode ${parentCode} khong ton tai` })
        }
        const data = await prisma.chartOfAccount.create({
            data: {
                code: String(code),
                name: String(name),
                nameEn: nameEn ? String(nameEn) : null,
                level: Number(level) || (parentCode ? 2 : 1),
                parentCode: parentCode ? String(parentCode) : null,
                type: String(type),
                nature: String(nature),
                description: description ? String(description) : null,
                isActive: isActive !== false,
                isSystem: false,
            },
        })
        res.status(201).json({ success: true, data })
    } catch (err: any) {
        console.error('POST /chart-of-accounts error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// PUT /api/tax/chart-of-accounts/:code
router.put('/chart-of-accounts/:code', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const code = Array.isArray(req.params.code) ? req.params.code[0] : req.params.code
        const existing = await prisma.chartOfAccount.findUnique({ where: { code } }).catch(() => null)
        if (!existing) return res.status(404).json({ success: false, error: 'Not found' })

        const { name, nameEn, level, parentCode, type, nature, description, isActive } = req.body || {}
        const updateData: any = {}
        if (name !== undefined) updateData.name = String(name)
        if (nameEn !== undefined) updateData.nameEn = nameEn === null ? null : String(nameEn)
        if (level !== undefined) updateData.level = Number(level)
        if (parentCode !== undefined) updateData.parentCode = parentCode === null || parentCode === '' ? null : String(parentCode)
        if (type !== undefined) updateData.type = String(type)
        if (nature !== undefined) updateData.nature = String(nature)
        if (description !== undefined) updateData.description = description === null ? null : String(description)
        if (isActive !== undefined) updateData.isActive = Boolean(isActive)

        const data = await prisma.chartOfAccount.update({ where: { code }, data: updateData })
        res.json({ success: true, data })
    } catch (err: any) {
        console.error('PUT /chart-of-accounts/:code error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// DELETE /api/tax/chart-of-accounts/:code - soft delete
router.delete('/chart-of-accounts/:code', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const code = Array.isArray(req.params.code) ? req.params.code[0] : req.params.code
        const existing = await prisma.chartOfAccount.findUnique({ where: { code } }).catch(() => null)
        if (!existing) return res.status(404).json({ success: false, error: 'Not found' })
        if (existing.isSystem) {
            return res.status(400).json({ success: false, error: 'Khong the xoa tai khoan he thong' })
        }
        const data = await prisma.chartOfAccount.update({ where: { code }, data: { isActive: false } })
        res.json({ success: true, data })
    } catch (err: any) {
        console.error('DELETE /chart-of-accounts/:code error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// --- Exchange Rates + FX revaluation ----------------------------------------

router.get('/exchange-rates', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const where: any = {}
        if (req.query.fromCurrency) where.fromCurrency = String(req.query.fromCurrency)
        if (req.query.toCurrency) where.toCurrency = String(req.query.toCurrency)
        if (req.query.date) where.date = String(req.query.date)
        if (req.query.dateGte || req.query.dateLte) {
            where.date = {
                ...(req.query.dateGte ? { gte: String(req.query.dateGte) } : {}),
                ...(req.query.dateLte ? { lte: String(req.query.dateLte) } : {}),
            }
        }
        const data = await prisma.exchangeRate.findMany({
            where,
            orderBy: [{ date: 'desc' }, { fromCurrency: 'asc' }],
        })
        res.json({ success: true, data })
    } catch (err: any) {
        console.error('GET /exchange-rates error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

router.get('/exchange-rates/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id
        const data = await prisma.exchangeRate.findUnique({ where: { id } })
        if (!data) return res.status(404).json({ success: false, error: 'Not found' })
        res.json({ success: true, data })
    } catch (err: any) {
        console.error('GET /exchange-rates/:id error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

router.post('/exchange-rates', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const { date, fromCurrency, toCurrency, rate, source, notes } = req.body || {}
        if (!date || !fromCurrency || !toCurrency || rate === undefined || rate === null) {
            return res.status(400).json({ success: false, error: 'date, fromCurrency, toCurrency, rate la bat buoc' })
        }
        const data = await prisma.exchangeRate.upsert({
            where: {
                date_fromCurrency_toCurrency: {
                    date: String(date),
                    fromCurrency: String(fromCurrency),
                    toCurrency: String(toCurrency),
                },
            },
            create: {
                date: String(date),
                fromCurrency: String(fromCurrency),
                toCurrency: String(toCurrency),
                rate: Number(rate),
                source: source ? String(source) : null,
                notes: notes ? String(notes) : null,
            },
            update: {
                rate: Number(rate),
                source: source ? String(source) : null,
                notes: notes ? String(notes) : null,
            },
        })
        res.status(201).json({ success: true, data })
    } catch (err: any) {
        console.error('POST /exchange-rates error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

router.put('/exchange-rates/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id
        const { rate, source, notes } = req.body || {}
        const updateData: any = {}
        if (rate !== undefined) updateData.rate = Number(rate)
        if (source !== undefined) updateData.source = source === null ? null : String(source)
        if (notes !== undefined) updateData.notes = notes === null ? null : String(notes)
        const data = await prisma.exchangeRate.update({ where: { id }, data: updateData })
        res.json({ success: true, data })
    } catch (err: any) {
        console.error('PUT /exchange-rates/:id error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

router.delete('/exchange-rates/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id
        await prisma.exchangeRate.delete({ where: { id } })
        res.json({ success: true })
    } catch (err: any) {
        console.error('DELETE /exchange-rates/:id error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// POST /api/tax/exchange-rates/revalue - month-end FX revaluation for TK112/131/331 via TK413
router.post('/exchange-rates/revalue', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const { date, fromCurrency, toCurrency, newRate, balances } = req.body || {}
        if (!date || !fromCurrency || !toCurrency || newRate === undefined) {
            return res.status(400).json({ success: false, error: 'date, fromCurrency, toCurrency, newRate la bat buoc' })
        }
        if (!Array.isArray(balances) || balances.length === 0) {
            return res.status(400).json({ success: false, error: 'balances (mang) la bat buoc' })
        }

        const FX_ACCOUNT = '413'
        const FX_ACCOUNT_NAME = 'Chenh lech ty gia hoi doai'
        const branchId = getBranchId(req as any) || null
        const createdEntries: any[] = []
        let totalGain = 0, totalLoss = 0

        for (const b of balances as Array<any>) {
            const account = String(b.account || '').trim()
            if (!account) continue
            const foreignAmount = Number(b.foreignAmount || 0)
            const oldRate = Number(b.oldRate || 0)
            const isLiability = Boolean(b.isLiability) || account.startsWith('331') || account.startsWith('341')
            const newValue = foreignAmount * Number(newRate)
            const oldValue = foreignAmount * oldRate
            const delta = newValue - oldValue
            if (delta === 0) continue

            let debitAccount: string, creditAccount: string, amount = Math.abs(delta), isGain: boolean
            if (!isLiability) {
                isGain = delta > 0
                if (isGain) { debitAccount = account; creditAccount = FX_ACCOUNT }
                else { debitAccount = FX_ACCOUNT; creditAccount = account }
            } else {
                isGain = delta < 0
                if (isGain) { debitAccount = account; creditAccount = FX_ACCOUNT }
                else { debitAccount = FX_ACCOUNT; creditAccount = account }
            }

            if (isGain) totalGain += amount
            else totalLoss += amount

            const entry = await prisma.journalEntry.create({
                data: {
                    date: String(date),
                    description: `Danh gia lai ngoai te ${fromCurrency}/${toCurrency} TK${account} (${isGain ? 'lai' : 'lo'} ty gia)`,
                    debitAccount,
                    creditAccount,
                    amount,
                    reference: `FX-REVAL-${String(date)}`,
                    referenceType: 'fx-revaluation',
                    notes: JSON.stringify({
                        fromCurrency, toCurrency, newRate: Number(newRate), oldRate, foreignAmount,
                        account, isLiability, delta, kind: isGain ? 'gain' : 'loss',
                        userDescription: b.description || null,
                    }),
                    branchId,
                    createdBy: (req as any).user?.id || null,
                },
            })
            createdEntries.push(entry)
        }

        res.status(201).json({
            success: true,
            data: {
                date, fromCurrency, toCurrency, newRate: Number(newRate),
                fxAccount: FX_ACCOUNT,
                fxAccountName: FX_ACCOUNT_NAME,
                entriesCreated: createdEntries.length,
                totalGain,
                totalLoss,
                netImpact: totalGain - totalLoss,
                entries: createdEntries,
            },
        })
    } catch (err: any) {
        console.error('POST /exchange-rates/revalue error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})


// =============================================================================
//  SPRINT 4 + 5: Compliance + Reporting
// =============================================================================

// --- Audit Log helper (used by Sprint 4 endpoints) --------------------------

async function logTaxAction(
    prisma: any,
    req: AuthRequest,
    args: { action: string; entityType: string; entityId?: string | null; changes?: any },
) {
    try {
        const ip = (req.headers?.['x-forwarded-for'] as string)?.split(',')[0]?.trim()
            || (req as any).ip
            || (req.socket as any)?.remoteAddress
            || null
        await prisma.taxAuditLog.create({
            data: {
                action: args.action,
                entityType: args.entityType,
                entityId: args.entityId || null,
                userId: (req as any).user?.id || null,
                userName: (req as any).user?.name || (req as any).user?.email || null,
                changes: args.changes !== undefined ? JSON.stringify(args.changes) : null,
                ip,
            },
        })
    } catch (e) {
        // audit must never break the main request
        console.error('logTaxAction error:', e)
    }
}

// --- Tax Deadlines (Lich nop thue) ------------------------------------------

function lastDayOfMonth(year: number, month1to12: number): number {
    return new Date(year, month1to12, 0).getDate()
}

function fmtDateYMD(y: number, m1to12: number, d: number): string {
    return `${y}-${String(m1to12).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}



// GET /api/tax/deadlines?year= - list (auto-seed for year if missing)
router.get('/deadlines', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const year = Number(req.query.year) || new Date().getFullYear()

        /* Lịch nghĩa vụ phải theo ĐÚNG hồ sơ của cửa hàng.
         *
         * Bản trước sinh cả tờ khai GTGT tháng LẪN quý cho mọi cửa hàng: một nơi
         * chỉ khai một kiểu, nên nửa số mốc là việc không bao giờ làm — rồi tới
         * hạn chúng tự chuyển sang "quá hạn" và biến trang nghĩa vụ thuế thành
         * một bức tường báo động giả. Hộ kinh doanh còn bị hiện cả quyết toán
         * TNDN và báo cáo tài chính, hai thứ họ không phải nộp. */
        const hoSo = await suyHoSoThue(prisma, year, String(req.query.kyKeKhai || ''))
        const loaiHinh = hoSo.loaiHinh
        const seeds = await gieoLichNghiaVu(prisma, year, hoSo)


        // Auto-mark overdue: pending items whose dueDate < today
        const today = new Date().toISOString().slice(0, 10)
        await prisma.taxDeadline.updateMany({
            where: { status: 'pending', dueDate: { lt: today } },
            data: { status: 'overdue' },
        })

        const where: any = {}
        if (req.query.year) {
            const y = Number(req.query.year)
            where.OR = [
                { period: { contains: `/${y}` } },
                { period: { contains: `-${y}` } },
            ]
        }
        if (req.query.taxType) where.taxType = String(req.query.taxType)
        if (req.query.status) where.status = String(req.query.status)

        const data = await prisma.taxDeadline.findMany({
            where,
            orderBy: [{ dueDate: 'asc' }],
        })
        // Bổ sung field FE cần: type/label/daysUntilDue/estimatedAmount + status
        // upcoming|due_soon (giữ nguyên field gốc để không vỡ chỗ khác)
        const seedTheoKhoa = new Map(seeds.map((x: MocNghiaVu) => [`${x.taxType}|${x.period}`, x]))

        /* Số tiền phải nộp của từng mốc. Bảng TaxDeadline không có cột tiền nên
         * trang nghĩa vụ thuế đang hiện 0đ cho tất cả — một danh sách hạn nộp
         * không kèm số tiền chỉ trả lời được "khi nào", còn câu người ta cần là
         * "phải chuẩn bị bao nhiêu". Ba truy vấn gộp một lần rồi tra tại chỗ. */
        const tienTheoKhoa = new Map<string, any>()
        try {
            const toKhaiNam: any[] = await prisma.taxDeclaration.findMany({
                where: { year },
                select: { period: true, formType: true, ct38: true, ct40a: true, cnkdTotalTax: true },
            }).catch(() => [])
            const toKhaiTheoKy = new Map<string, number>()
            for (const t of toKhaiNam) {
                if (String(t.formType || '').includes('_BS')) continue   // bản bổ sung không phải số gốc
                /* So thue phai nop nam o [38]; [40a] la de nghi hoan va he thong
                 * de luon bang 0 khi tu tinh to khai. Doc [40a] la moi moc han
                 * nop deu hien 0 dong. */
                toKhaiTheoKy.set(String(t.period),
                    Number(t.formType === '01_CNKD'
                        ? t.cnkdTotalTax
                        : (t.ct38 || t.ct40a)) || 0)
            }

            const kyLuong: any[] = await prisma.payrollPeriod.findMany({
                where: { year },
                select: { id: true, month: true },
            }).catch(() => [])
            const tncnTheoKy = new Map<string, number>()
            if (kyLuong.length) {
                const dong: any[] = await prisma.payrollEntry.findMany({
                    where: { periodId: { in: kyLuong.map((k: any) => k.id) } },
                    select: { periodId: true, pitAmount: true },
                }).catch(() => [])
                const thangCua = new Map(kyLuong.map((k: any) => [k.id, k.month]))
                for (const e of dong) {
                    const m = thangCua.get(e.periodId)
                    if (!m) continue
                    const kThang = `${year}-${String(m).padStart(2, '0')}`
                    const kQuy = `${year}-Q${Math.ceil(m / 3)}`
                    tncnTheoKy.set(kThang, (tncnTheoKy.get(kThang) || 0) + (e.pitAmount || 0))
                    tncnTheoKy.set(kQuy, (tncnTheoKy.get(kQuy) || 0) + (e.pitAmount || 0))
                }
            }

            const btNam: any[] = await prisma.journalEntry.findMany({
                where: { date: { gte: `${year}-01-01`, lte: `${year}-12-31` } },
                select: { date: true, debitAccount: true, creditAccount: true, amount: true },
            }).catch(() => [])
            const laiTheoQuy = new Map<number, number>()
            const laDoanhThu = (tk: string) => /^(511|515|711)/.test(tk)
            const laChiPhi = (tk: string) => /^(632|635|641|642|811)/.test(tk)
            for (const e of btNam) {
                const q = Math.ceil(Number(String(e.date).slice(5, 7)) / 3)
                if (!q) continue
                let v = 0
                if (laDoanhThu(String(e.creditAccount || ''))) v += e.amount
                if (laDoanhThu(String(e.debitAccount || ''))) v -= e.amount
                if (laChiPhi(String(e.debitAccount || ''))) v -= e.amount
                if (laChiPhi(String(e.creditAccount || ''))) v += e.amount
                laiTheoQuy.set(q, (laiTheoQuy.get(q) || 0) + v)
            }

            const dtNamTruoc: any[] = await prisma.journalEntry.findMany({
                where: { date: { gte: `${year - 1}-01-01`, lte: `${year - 1}-12-31` } },
                select: { debitAccount: true, creditAccount: true, amount: true },
            }).catch(() => [])
            const doanhThuNamTruoc = dtNamTruoc.length
                ? dtNamTruoc.reduce((s: number, e: any) =>
                    s + (String(e.creditAccount || '').startsWith('511') ? e.amount : 0)
                    - (String(e.debitAccount || '').startsWith('511') ? e.amount : 0), 0)
                : null

            for (const m of seeds) {
                tienTheoKhoa.set(`${m.taxType}|${m.period}`, ganTienChoMoc(m, {
                    loaiHinh, doanhThuNamTruoc, toKhaiTheoKy, tncnTheoKy, laiTheoQuy,
                }))
            }
        } catch (e: any) {
            console.warn('[Deadlines] không ước tính được số tiền:', e?.message || e)
        }
        const nowMs = Date.now()
        const enriched = data.map((d: any) => {
            const daysUntilDue = Math.ceil((new Date(d.dueDate).getTime() - nowMs) / 86400000)
            const feStatus = d.status === 'pending'
                ? (daysUntilDue <= 7 ? 'due_soon' : 'upcoming')
                : d.status
            /* Bảng TaxDeadline không có cột căn cứ pháp lý và loại việc, mà hai
             * thứ đó lại quan trọng: rất nhiều người nhầm "tạm nộp thuế TNDN
             * quý" là phải nộp tờ khai, rồi đi tìm mẫu tờ khai không tồn tại.
             * Gắn lại từ lịch chuẩn vừa dựng, khớp theo loại + kỳ. */
            const chuan = seedTheoKhoa.get(`${d.taxType}|${d.period}`)
            const tien = tienTheoKhoa.get(`${d.taxType}|${d.period}`)
            return {
                ...d,
                type: d.taxType,
                label: d.description || d.taxType,
                daysUntilDue,
                /* null khi không suy ra được — KHÔNG quy về 0, vì "0đ" nghĩa là
                 * không phải nộp gì, còn "chưa biết" là phải đi tra. Hai điều
                 * hoàn toàn khác nhau với người đang chuẩn bị tiền nộp thuế. */
                estimatedAmount: d.estimatedAmount ?? tien?.soTien ?? null,
                nguonSoTien: tien ? (tien.tuToKhai ? 'to-khai' : 'uoc-tinh') : null,
                dienGiaiSoTien: tien?.dienGiai ?? null,
                status: feStatus,
                rawStatus: d.status,
                canCu: chuan?.canCu ?? null,
                loaiViec: chuan?.loaiViec ?? null,
            }
        })
        res.json({ success: true, data: enriched })
    } catch (err: any) {
        console.error('GET /deadlines error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// POST /api/tax/deadlines/:id/submit — đánh dấu đã nộp (FE TaxDeadlinesTab)
router.post('/deadlines/:id/submit', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id
        const existing = await prisma.taxDeadline.findUnique({ where: { id } }).catch(() => null)
        if (!existing) return res.status(404).json({ success: false, error: 'Không tìm thấy hạn nộp' })
        const data = await prisma.taxDeadline.update({
            where: { id },
            data: { status: 'submitted', submittedAt: new Date() },
        })
        res.json({ success: true, data })
    } catch (err: any) {
        console.error('POST /deadlines/:id/submit error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// GET /api/tax/deadlines/overdue - list overdue items
router.get('/deadlines/overdue', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const today = new Date().toISOString().slice(0, 10)
        // Refresh overdue status first
        await prisma.taxDeadline.updateMany({
            where: { status: 'pending', dueDate: { lt: today } },
            data: { status: 'overdue' },
        })
        const data = await prisma.taxDeadline.findMany({
            where: { status: 'overdue' },
            orderBy: [{ dueDate: 'asc' }],
        })
        res.json({ success: true, data })
    } catch (err: any) {
        console.error('GET /deadlines/overdue error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// PUT /api/tax/deadlines/:id - mark as submitted (or other status update)
router.put('/deadlines/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id
        const { status, declarationId, notes, reminderSent } = req.body || {}

        const updateData: any = {}
        if (status !== undefined) {
            if (!['pending', 'submitted', 'overdue'].includes(String(status))) {
                return res.status(400).json({ success: false, error: 'status khong hop le' })
            }
            updateData.status = String(status)
            if (status === 'submitted' && !req.body?.filedAt) {
                updateData.filedAt = new Date()
            }
        }
        if (req.body?.filedAt !== undefined) {
            updateData.filedAt = req.body.filedAt ? new Date(req.body.filedAt) : null
        }
        if (declarationId !== undefined) updateData.declarationId = declarationId || null
        if (notes !== undefined) updateData.notes = notes || null
        if (reminderSent !== undefined) updateData.reminderSent = Boolean(reminderSent)

        const data = await prisma.taxDeadline.update({ where: { id }, data: updateData })
        await logTaxAction(prisma, req, {
            action: 'deadline.update',
            entityType: 'TaxDeadline',
            entityId: id,
            changes: updateData,
        })
        res.json({ success: true, data })
    } catch (err: any) {
        console.error('PUT /deadlines/:id error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// --- Audit Log endpoints ----------------------------------------------------

// GET /api/tax/audit-log?from=&to=&entityType=&userId=
router.get('/audit-log', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const where: any = {}
        if (req.query.from || req.query.to) {
            where.timestamp = {
                ...(req.query.from ? { gte: new Date(String(req.query.from)) } : {}),
                ...(req.query.to ? { lte: new Date(String(req.query.to)) } : {}),
            }
        }
        if (req.query.entityType) where.entityType = String(req.query.entityType)
        if (req.query.entityId) where.entityId = String(req.query.entityId)
        if (req.query.userId) where.userId = String(req.query.userId)
        if (req.query.action) where.action = String(req.query.action)

        const limit = Math.min(Number(req.query.limit) || 200, 1000)
        const data = await prisma.taxAuditLog.findMany({
            where,
            orderBy: [{ timestamp: 'desc' }],
            take: limit,
        })
        res.json({ success: true, data })
    } catch (err: any) {
        console.error('GET /audit-log error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// POST /api/tax/audit-log - manual log entry
router.post('/audit-log', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const { action, entityType, entityId, changes } = req.body || {}
        if (!action || !entityType) {
            return res.status(400).json({ success: false, error: 'action, entityType la bat buoc' })
        }
        await logTaxAction(prisma, req, { action, entityType, entityId, changes })
        res.status(201).json({ success: true })
    } catch (err: any) {
        console.error('POST /audit-log error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// --- Tax Budget --------------------------------------------------------------

// GET /api/tax/budget?year=&month=&accountCode=
router.get('/budget', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const where: any = {}
        if (req.query.year) where.year = Number(req.query.year)
        if (req.query.month !== undefined && req.query.month !== '') where.month = Number(req.query.month)
        if (req.query.accountCode) where.accountCode = String(req.query.accountCode)

        const data = await prisma.taxBudget.findMany({
            where,
            orderBy: [{ year: 'desc' }, { month: 'asc' }, { accountCode: 'asc' }],
        })
        res.json({ success: true, data })
    } catch (err: any) {
        console.error('GET /budget error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// POST /api/tax/budget - upsert budget
router.post('/budget', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const { accountCode, year, month, amount, notes } = req.body || {}
        if (!accountCode || !year || amount === undefined) {
            return res.status(400).json({ success: false, error: 'accountCode, year, amount la bat buoc' })
        }
        const monthVal = month === undefined || month === null || month === '' ? null : Number(month)
        const data = await prisma.taxBudget.upsert({
            where: {
                accountCode_year_month: {
                    accountCode: String(accountCode),
                    year: Number(year),
                    month: monthVal as any,
                },
            },
            create: {
                accountCode: String(accountCode),
                year: Number(year),
                month: monthVal,
                amount: Number(amount),
                notes: notes ? String(notes) : null,
            },
            update: {
                amount: Number(amount),
                notes: notes !== undefined ? (notes ? String(notes) : null) : undefined,
            },
        })
        await logTaxAction(prisma, req, {
            action: 'budget.upsert',
            entityType: 'TaxBudget',
            entityId: data.id,
            changes: { accountCode, year, month: monthVal, amount },
        })
        res.status(201).json({ success: true, data })
    } catch (err: any) {
        console.error('POST /budget error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// PUT /api/tax/budget/:id
router.put('/budget/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id
        const { amount, notes } = req.body || {}
        const updateData: any = {}
        if (amount !== undefined) updateData.amount = Number(amount)
        if (notes !== undefined) updateData.notes = notes === null ? null : String(notes)
        const data = await prisma.taxBudget.update({ where: { id }, data: updateData })
        await logTaxAction(prisma, req, {
            action: 'budget.update', entityType: 'TaxBudget', entityId: id, changes: updateData,
        })
        res.json({ success: true, data })
    } catch (err: any) {
        console.error('PUT /budget/:id error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// DELETE /api/tax/budget/:id
router.delete('/budget/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id
        await prisma.taxBudget.delete({ where: { id } })
        await logTaxAction(prisma, req, { action: 'budget.delete', entityType: 'TaxBudget', entityId: id })
        res.json({ success: true })
    } catch (err: any) {
        console.error('DELETE /budget/:id error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// GET /api/tax/budget-vs-actual?year=&month= - compare budget vs actual
router.get('/budget-vs-actual', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const year = Number(req.query.year) || new Date().getFullYear()
        const month = req.query.month ? Number(req.query.month) : undefined

        const { startDate, endDate } = cashFlowDateRange(year, month)

        // Pull budgets: if month given, get monthly budgets for that month; else year-level (month null)
        const budgetWhere: any = { year }
        if (month) {
            // Combine month-specific and yearly budgets (yearly = month null)
            budgetWhere.OR = [{ month }, { month: null }]
        } else {
            budgetWhere.month = null
        }
        const budgets: any[] = await prisma.taxBudget.findMany({ where: budgetWhere })

        // Pull journal entries for period
        let entries: any[] = []
        try {
            entries = await prisma.journalEntry.findMany({
                where: { date: { gte: startDate, lte: endDate } },
                select: { debitAccount: true, creditAccount: true, amount: true },
            })
        } catch (_) { entries = [] }

        // Pull chart of accounts for nature lookup
        const codes = new Set<string>(budgets.map(b => b.accountCode))
        for (const e of entries) {
            if (e.debitAccount) codes.add(e.debitAccount)
            if (e.creditAccount) codes.add(e.creditAccount)
        }
        let coaList: any[] = []
        try {
            coaList = await prisma.chartOfAccount.findMany({
                where: { code: { in: Array.from(codes) } },
                select: { code: true, name: true, type: true, nature: true },
            })
        } catch (_) { coaList = [] }
        const coaByCode = new Map<string, any>(coaList.map(c => [c.code, c]))

        // Compute actual per accountCode appearing in budgets
        type Row = {
            accountCode: string; accountName: string | null; nature: string | null;
            budget: number; actual: number; debits: number; credits: number;
            variance: number; variancePct: number; status: 'over' | 'under' | 'on-target' | 'no-budget';
        }
        const rows: Row[] = []

        // Helper: actual based on nature
        const computeActual = (code: string, nature: string | null) => {
            let debits = 0, credits = 0
            for (const e of entries) {
                if (e.debitAccount === code || e.debitAccount?.startsWith(code + '.')) debits += e.amount || 0
                if (e.creditAccount === code || e.creditAccount?.startsWith(code + '.')) credits += e.amount || 0
            }
            const actual = nature === 'Credit' ? credits - debits : debits - credits
            return { debits, credits, actual }
        }

        for (const b of budgets) {
            const coa = coaByCode.get(b.accountCode)
            const { debits, credits, actual } = computeActual(b.accountCode, coa?.nature || null)
            const variance = actual - b.amount
            const variancePct = b.amount === 0 ? 0 : (variance / b.amount) * 100
            let status: Row['status'] = 'on-target'
            if (Math.abs(variancePct) > 5) status = variance > 0 ? 'over' : 'under'
            rows.push({
                accountCode: b.accountCode,
                accountName: coa?.name || null,
                nature: coa?.nature || null,
                budget: b.amount,
                actual, debits, credits,
                variance, variancePct, status,
            })
        }

        res.json({
            success: true,
            data: {
                year, month: month || null,
                startDate, endDate,
                rows,
                summary: {
                    totalBudget: rows.reduce((s, r) => s + r.budget, 0),
                    totalActual: rows.reduce((s, r) => s + r.actual, 0),
                    totalVariance: rows.reduce((s, r) => s + r.variance, 0),
                    overCount: rows.filter(r => r.status === 'over').length,
                    underCount: rows.filter(r => r.status === 'under').length,
                },
            },
        })
    } catch (err: any) {
        console.error('GET /budget-vs-actual error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// =============================================================================
//  SPRINT 5: Reports + Exports
// =============================================================================

// --- Helper: opening balance + period flow for an account prefix ------------

type LedgerEntry = { date: string; debitAccount: string; creditAccount: string; amount: number; description?: string | null; reference?: string | null }

async function loadJournalEntries(prisma: any, startDate?: string, endDate?: string): Promise<LedgerEntry[]> {
    try {
        const where: any = {}
        if (startDate || endDate) {
            where.date = {
                ...(startDate ? { gte: startDate } : {}),
                ...(endDate ? { lte: endDate } : {}),
            }
        }
        return await prisma.journalEntry.findMany({
            where,
            orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
        })
    } catch (_) { return [] }
}

function balanceForCode(entries: LedgerEntry[], code: string, nature: string | null): { debits: number; credits: number; balance: number } {
    let debits = 0, credits = 0
    for (const e of entries) {
        if (e.debitAccount === code) debits += e.amount || 0
        if (e.creditAccount === code) credits += e.amount || 0
    }
    const balance = nature === 'Credit' ? credits - debits : debits - credits
    return { debits, credits, balance }
}

// GET /api/tax/reports/summary?year=
router.get('/reports/summary', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const year = Number(req.query.year) || new Date().getFullYear()
        const startDate = `${year}-01-01`
        const endDate = `${year}-12-31`

        const periodEntries = await loadJournalEntries(prisma, startDate, endDate)
        const openingEntries = await loadJournalEntries(prisma, undefined, `${year - 1}-12-31`)
        const allUntilEnd = [...openingEntries, ...periodEntries]

        const sumDr = (es: LedgerEntry[], prefixes: string[]) =>
            es.filter(e => prefixes.some(p => e.debitAccount?.startsWith(p)))
                .reduce((s, e) => s + (e.amount || 0), 0)
        const sumCr = (es: LedgerEntry[], prefixes: string[]) =>
            es.filter(e => prefixes.some(p => e.creditAccount?.startsWith(p)))
                .reduce((s, e) => s + (e.amount || 0), 0)
        const netDr = (es: LedgerEntry[], prefixes: string[]) => sumDr(es, prefixes) - sumCr(es, prefixes)
        const netCr = (es: LedgerEntry[], prefixes: string[]) => sumCr(es, prefixes) - sumDr(es, prefixes)

        // Income statement (period flows)
        const revenue511 = sumCr(periodEntries, ['511'])
        const revenue515 = sumCr(periodEntries, ['515'])
        const revenue711 = sumCr(periodEntries, ['711'])
        const totalRevenue = revenue511 + revenue515 + revenue711
        const cogs = sumDr(periodEntries, ['632'])
        const opex = sumDr(periodEntries, ['641', '642'])
        const finExp = sumDr(periodEntries, ['635'])
        const otherExp = sumDr(periodEntries, ['811'])
        const cit = sumDr(periodEntries, ['821'])
        const totalExpenses = cogs + opex + finExp + otherExp + cit
        const grossProfit = revenue511 - cogs
        const operatingProfit = grossProfit - opex
        const profitBeforeTax = totalRevenue - (cogs + opex + finExp + otherExp)
        const netProfit = profitBeforeTax - cit

        // Balance sheet (ending balances)
        const currentAssets = netDr(allUntilEnd, ['111', '112', '121', '128', '131', '133', '138', '141', '142', '152', '153', '154', '155', '156', '157'])
        const longTermAssets = netDr(allUntilEnd, ['211', '212', '213', '217', '221', '242']) - netCr(allUntilEnd, ['214', '229'])
        const totalAssets = currentAssets + longTermAssets
        const currentLiabilities = netCr(allUntilEnd, ['331', '333', '334', '335', '338'])
        const longTermLiabilities = netCr(allUntilEnd, ['341'])
        const totalLiabilities = currentLiabilities + longTermLiabilities
        const equity = netCr(allUntilEnd, ['411', '413', '414', '418', '421']) - netDr(allUntilEnd, ['419'])
        const cashPosition = netDr(allUntilEnd, ['111', '112'])

        // Tax obligations (closing balances of payable accounts)
        const vatPayable = netCr(allUntilEnd, ['3331'])
        const citPayable = netCr(allUntilEnd, ['3334'])
        const pitPayable = netCr(allUntilEnd, ['3335'])

        // Ratios
        const currentRatio = currentLiabilities === 0 ? null : currentAssets / currentLiabilities
        const debtRatio = totalAssets === 0 ? null : totalLiabilities / totalAssets
        const roe = equity === 0 ? null : netProfit / equity
        const grossMargin = revenue511 === 0 ? null : grossProfit / revenue511
        const netMargin = totalRevenue === 0 ? null : netProfit / totalRevenue

        res.json({
            success: true,
            data: {
                year, startDate, endDate,
                incomeStatement: {
                    revenue: { sales: revenue511, financial: revenue515, other: revenue711, total: totalRevenue },
                    cogs,
                    grossProfit,
                    operatingExpenses: opex,
                    operatingProfit,
                    financialExpenses: finExp,
                    otherExpenses: otherExp,
                    profitBeforeTax,
                    cit,
                    netProfit,
                    totalExpenses,
                },
                balanceSheet: {
                    currentAssets, longTermAssets, totalAssets,
                    currentLiabilities, longTermLiabilities, totalLiabilities,
                    equity,
                    cashPosition,
                },
                taxObligations: { vatPayable, citPayable, pitPayable },
                ratios: { currentRatio, debtRatio, roe, grossMargin, netMargin },
            },
        })
    } catch (err: any) {
        console.error('GET /reports/summary error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// GET /api/tax/reports/tax-obligations?year= - upcoming tax payments
router.get('/reports/tax-obligations', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const year = Number(req.query.year) || new Date().getFullYear()
        const today = new Date().toISOString().slice(0, 10)

        /* KHÔNG gieo lịch ở đây. Việc gieo nằm ở GET /deadlines, nơi biết loại
         * hình và kỳ kê khai thật của cửa hàng. Trước đây hai endpoint cùng gieo
         * bằng hai bộ luật khác nhau: /deadlines dọn mốc khai tháng thừa xong,
         * người dùng mở trang Nghĩa Vụ Thuế là chúng mọc lại ngay. */
        await prisma.taxDeadline.updateMany({
            where: { status: 'pending', dueDate: { lt: today } },
            data: { status: 'overdue' },
        })

        // Closing balance of each payable account
        const endDate = `${year}-12-31`
        const allEntries = await loadJournalEntries(prisma, undefined, endDate)
        const netCr = (prefixes: string[]) => {
            let dr = 0, cr = 0
            for (const e of allEntries) {
                if (prefixes.some(p => e.debitAccount?.startsWith(p))) dr += e.amount || 0
                if (prefixes.some(p => e.creditAccount?.startsWith(p))) cr += e.amount || 0
            }
            return cr - dr
        }

        const vatPayable = netCr(['3331'])
        const citPayable = netCr(['3334'])
        const pitPayable = netCr(['3335'])

        // Upcoming pending/overdue deadlines for the year
        const upcoming = await prisma.taxDeadline.findMany({
            where: {
                status: { in: ['pending', 'overdue'] },
                OR: [
                    { period: { contains: `/${year}` } },
                    { period: { contains: `-${year}` } },
                ],
            },
            orderBy: [{ dueDate: 'asc' }],
        })

        res.json({
            success: true,
            data: {
                year,
                balances: { vatPayable, citPayable, pitPayable, total: vatPayable + citPayable + pitPayable },
                upcomingDeadlines: upcoming,
                today,
            },
        })
    } catch (err: any) {
        console.error('GET /reports/tax-obligations error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// --- Exports (data only — frontend handles rendering) -----------------------

// GET /api/tax/export/trial-balance?year=&month=
router.get('/export/trial-balance', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const year = Number(req.query.year) || new Date().getFullYear()
        const month = req.query.month ? Number(req.query.month) : undefined
        const { startDate, endDate } = cashFlowDateRange(year, month)

        const periodEntries = await loadJournalEntries(prisma, startDate, endDate)
        const openingEntries = await loadJournalEntries(prisma, undefined, startDate)
        // openingEntries above includes entries on startDate; we want strictly before.
        // Re-pull explicitly with lt to be precise.
        const openingStrict = await prisma.journalEntry.findMany({
            where: { date: { lt: startDate } },
            select: { debitAccount: true, creditAccount: true, amount: true },
        }).catch(() => [])

        // Collect all account codes from both
        const codes = new Set<string>()
        for (const e of openingStrict) {
            if (e.debitAccount) codes.add(e.debitAccount)
            if (e.creditAccount) codes.add(e.creditAccount)
        }
        for (const e of periodEntries) {
            if (e.debitAccount) codes.add(e.debitAccount)
            if (e.creditAccount) codes.add(e.creditAccount)
        }

        let coaList: any[] = []
        try {
            coaList = await prisma.chartOfAccount.findMany({
                where: { code: { in: Array.from(codes) } },
                select: { code: true, name: true, nature: true, type: true },
            })
        } catch (_) { coaList = [] }
        const coaByCode = new Map<string, any>(coaList.map(c => [c.code, c]))

        type TBRow = {
            accountCode: string; accountName: string | null; nature: string | null; type: string | null;
            openingDebit: number; openingCredit: number;
            periodDebit: number; periodCredit: number;
            closingDebit: number; closingCredit: number;
        }

        const sortedCodes = Array.from(codes).sort()
        const rows: TBRow[] = sortedCodes.map(code => {
            const coa = coaByCode.get(code)
            const nature = coa?.nature || null

            let openDr = 0, openCr = 0
            for (const e of openingStrict) {
                if (e.debitAccount === code) openDr += e.amount || 0
                if (e.creditAccount === code) openCr += e.amount || 0
            }
            const openingNet = nature === 'Credit' ? openCr - openDr : openDr - openCr
            const openingDebit = openingNet >= 0 && nature !== 'Credit' ? openingNet : (nature !== 'Credit' && openingNet < 0 ? 0 : 0)
            const openingCredit = nature === 'Credit' ? Math.max(openingNet, 0) : (openingNet < 0 ? -openingNet : 0)

            let periodDr = 0, periodCr = 0
            for (const e of periodEntries) {
                if (e.debitAccount === code) periodDr += e.amount || 0
                if (e.creditAccount === code) periodCr += e.amount || 0
            }

            const closingNet = nature === 'Credit'
                ? (openCr + periodCr) - (openDr + periodDr)
                : (openDr + periodDr) - (openCr + periodCr)
            const closingDebit = nature === 'Credit' ? (closingNet < 0 ? -closingNet : 0) : Math.max(closingNet, 0)
            const closingCredit = nature === 'Credit' ? Math.max(closingNet, 0) : (closingNet < 0 ? -closingNet : 0)

            return {
                accountCode: code,
                accountName: coa?.name || null,
                nature, type: coa?.type || null,
                openingDebit, openingCredit,
                periodDebit: periodDr, periodCredit: periodCr,
                closingDebit, closingCredit,
            }
        })

        const totals = rows.reduce(
            (acc, r) => ({
                openingDebit: acc.openingDebit + r.openingDebit,
                openingCredit: acc.openingCredit + r.openingCredit,
                periodDebit: acc.periodDebit + r.periodDebit,
                periodCredit: acc.periodCredit + r.periodCredit,
                closingDebit: acc.closingDebit + r.closingDebit,
                closingCredit: acc.closingCredit + r.closingCredit,
            }),
            { openingDebit: 0, openingCredit: 0, periodDebit: 0, periodCredit: 0, closingDebit: 0, closingCredit: 0 },
        )

        res.json({
            success: true,
            data: {
                year, month: month || null,
                startDate, endDate,
                rows,
                totals,
                isBalanced: Math.abs(totals.periodDebit - totals.periodCredit) < 0.01,
            },
        })
    } catch (err: any) {
        console.error('GET /export/trial-balance error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// GET /api/tax/export/general-ledger?accountCode=&year=&month=
router.get('/export/general-ledger', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const accountCode = String(req.query.accountCode || '').trim()
        if (!accountCode) {
            return res.status(400).json({ success: false, error: 'accountCode la bat buoc' })
        }
        const year = Number(req.query.year) || new Date().getFullYear()
        const month = req.query.month ? Number(req.query.month) : undefined
        const { startDate, endDate } = cashFlowDateRange(year, month)

        // Lookup nature for running balance interpretation
        let coa: any = null
        try {
            coa = await prisma.chartOfAccount.findUnique({ where: { code: accountCode } })
        } catch (_) { coa = null }
        const nature = coa?.nature || null

        // Opening balance (all entries strictly before startDate)
        const openingEntries: any[] = await prisma.journalEntry.findMany({
            where: {
                date: { lt: startDate },
                OR: [{ debitAccount: accountCode }, { creditAccount: accountCode }],
            },
            select: { debitAccount: true, creditAccount: true, amount: true },
        }).catch(() => [])

        let openDr = 0, openCr = 0
        for (const e of openingEntries) {
            if (e.debitAccount === accountCode) openDr += e.amount || 0
            if (e.creditAccount === accountCode) openCr += e.amount || 0
        }
        const openingBalance = nature === 'Credit' ? openCr - openDr : openDr - openCr

        // Period transactions
        const periodEntries: any[] = await prisma.journalEntry.findMany({
            where: {
                date: { gte: startDate, lte: endDate },
                OR: [{ debitAccount: accountCode }, { creditAccount: accountCode }],
            },
            orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
        }).catch(() => [])

        let running = openingBalance
        const rows = periodEntries.map((e: any) => {
            const isDebitSide = e.debitAccount === accountCode
            const debit = isDebitSide ? e.amount || 0 : 0
            const credit = !isDebitSide ? e.amount || 0 : 0
            const delta = nature === 'Credit' ? credit - debit : debit - credit
            running += delta
            return {
                id: e.id,
                date: e.date,
                description: e.description,
                reference: e.reference,
                referenceType: e.referenceType,
                counterpartyAccount: isDebitSide ? e.creditAccount : e.debitAccount,
                counterpartyName: isDebitSide ? e.creditAccountName : e.debitAccountName,
                debit, credit,
                runningBalance: running,
            }
        })

        const totalDebit = rows.reduce((s, r) => s + r.debit, 0)
        const totalCredit = rows.reduce((s, r) => s + r.credit, 0)
        const closingBalance = running

        res.json({
            success: true,
            data: {
                accountCode,
                accountName: coa?.name || null,
                nature,
                type: coa?.type || null,
                year, month: month || null,
                startDate, endDate,
                openingBalance,
                rows,
                totalDebit, totalCredit,
                closingBalance,
                rowCount: rows.length,
            },
        })
    } catch (err: any) {
        console.error('GET /export/general-ledger error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// GET /api/tax/export/journal-book?year=&month=
router.get('/export/journal-book', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const year = Number(req.query.year) || new Date().getFullYear()
        const month = req.query.month ? Number(req.query.month) : undefined
        const { startDate, endDate } = cashFlowDateRange(year, month)

        const limit = Math.min(Number(req.query.limit) || 5000, 20000)

        const entries: any[] = await prisma.journalEntry.findMany({
            where: { date: { gte: startDate, lte: endDate } },
            orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
            take: limit,
        }).catch(() => [])

        const totalDebit = entries.reduce((s, e) => s + (e.amount || 0), 0)
        const totalCredit = totalDebit // every entry is debit=credit by construction

        res.json({
            success: true,
            data: {
                year, month: month || null,
                startDate, endDate,
                rows: entries.map(e => ({
                    id: e.id,
                    date: e.date,
                    description: e.description,
                    debitAccount: e.debitAccount,
                    debitAccountName: e.debitAccountName,
                    creditAccount: e.creditAccount,
                    creditAccountName: e.creditAccountName,
                    amount: e.amount,
                    reference: e.reference,
                    referenceType: e.referenceType,
                    notes: e.notes,
                    createdAt: e.createdAt,
                })),
                totalDebit, totalCredit,
                rowCount: entries.length,
                truncated: entries.length === limit,
            },
        })
    } catch (err: any) {
        console.error('GET /export/journal-book error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

export default router
