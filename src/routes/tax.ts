import { Router, Request, Response } from 'express'
import { authMiddleware, getBranchFilter, AuthRequest, getBranchId } from '../middleware/auth'

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

// DELETE /api/tax/:id
router.delete('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id
        await prisma.taxConfig.delete({ where: { id } }); res.json({ success: true })
    } catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// ═══════════════════════════════════════════════════════════════════════════════
//  STORE INFO (Tax / Business profile)
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/tax/store-info
router.get('/store-info', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const store = await (prisma as any).store.findFirst()
        if (!store) return res.json({ success: true, data: null })
        res.json({
            success: true,
            data: {
                id: store.id,
                name: store.name,
                address: store.address,
                phone: store.phone,
                email: store.email,
                website: store.website,
                businessType: store.businessType,
                taxCode: store.taxCode,
                ownerName: store.ownerName,
                ownerIdNumber: store.ownerIdNumber,
                representativeName: store.representativeName,
            },
        })
    } catch (err) {
        console.error('GET /store-info error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// PUT /api/tax/store-info
router.put('/store-info', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { name, address, phone, email, website, businessType, taxCode, ownerName, ownerIdNumber, representativeName } = req.body
        const store = await (prisma as any).store.findFirst()
        if (!store) return res.status(404).json({ success: false, error: 'Store not found' })
        const data = await (prisma as any).store.update({
            where: { id: store.id },
            data: {
                ...(name !== undefined && { name }),
                ...(address !== undefined && { address }),
                ...(phone !== undefined && { phone }),
                ...(email !== undefined && { email }),
                ...(website !== undefined && { website }),
                ...(businessType !== undefined && { businessType }),
                ...(taxCode !== undefined && { taxCode }),
                ...(ownerName !== undefined && { ownerName }),
                ...(ownerIdNumber !== undefined && { ownerIdNumber }),
                ...(representativeName !== undefined && { representativeName }),
            },
        })
        res.json({ success: true, data })
    } catch (err) {
        console.error('PUT /store-info error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
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
            where: { status: 'completed', createdAt: { gte: startDate, lte: endDate } },
            select: { total: true },
        })
        const totalRevenue = transactions.reduce((s, t) => s + (t.total || 0), 0)
        const threshold = 500000000
        res.json({
            success: true,
            data: { totalRevenue, threshold, isAboveThreshold: totalRevenue >= threshold, year },
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
            status: 'completed',
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
        where: { status: 'completed', createdAt: { gte: startDate, lte: endDate } },
        select: { subtotal: true, tax: true, total: true, discount: true },
    })
    const imports = await prisma.importReceipt.findMany({
        where: { status: 'completed', createdAt: { gte: startDate, lte: endDate } },
        select: { totalCost: true },
    })
    const taxConfigs = await prisma.taxConfig.findMany({ where: { ...getBranchFilter(req as any), status: 'active' } })
    const defaultRate = taxConfigs.find((t: any) => t.isDefault)?.rate ?? 10

    const totalSalesSubtotal = transactions.reduce((s: number, t: any) => s + (t.subtotal || 0), 0)
    const totalSalesTax = transactions.reduce((s: number, t: any) => s + (t.tax || 0), 0)
    let ct21 = 0, ct22 = 0, ct23 = 0, ct24 = 0, ct25 = 0, ct26 = 0, ct27 = 0, ct28 = 0

    if (defaultRate === 0) { ct22 = totalSalesSubtotal }
    else if (defaultRate === 5) { ct23 = totalSalesSubtotal; ct24 = totalSalesTax }
    else if (defaultRate === 8) { ct25 = totalSalesSubtotal; ct26 = totalSalesTax }
    else { ct27 = totalSalesSubtotal; ct28 = totalSalesTax }

    const ct29 = ct21 + ct22 + ct23 + ct25 + ct27
    const ct30 = ct24 + ct26 + ct28
    const totalImportCost = imports.reduce((s: number, i: any) => s + (i.totalCost || 0), 0)
    const ct31 = totalImportCost
    const ct32 = totalImportCost * (defaultRate / 100)
    const ct33 = ct32
    const ct34 = 0
    const ct35 = ct30 - ct33 - ct34
    const ct36 = 0, ct37 = 0
    const ct38 = ct35 > 0 ? ct35 + ct36 - ct37 : 0
    const ct39 = ct35 < 0 ? Math.abs(ct35) - ct36 + ct37 : 0
    const ct40a = 0
    const ct40b = ct39 - ct40a

    return { ct21, ct22, ct23, ct24, ct25, ct26, ct27, ct28, ct29, ct30, ct31, ct32, ct33, ct34, ct35, ct36, ct37, ct38, ct39, ct40a, ct40b }
}

// ── Helper: calculate 01/CNKD data (Household / Individual business) ────────
async function calculate01CNKD(prisma: any, periodType: string, year: number, month?: number, quarter?: number) {
    const { startDate, endDate } = getPeriodDateRange(periodType, year, month, quarter)

    // Total revenue from completed transactions
    const transactions = await prisma.transaction.findMany({
        where: { status: 'completed', createdAt: { gte: startDate, lte: endDate } },
        select: { total: true },
    })
    const cnkdRevenue = transactions.reduce((s: number, t: any) => s + (t.total || 0), 0)

    // VAT rate for retail/trade: 1% (Thông tư 40/2021)
    const cnkdVatRate = 1
    // PIT rate for retail/trade: 0.5%
    const cnkdPitRate = 0.5
    const cnkdThreshold = 500000000 // 500 triệu/năm

    // Annualized revenue for threshold check (estimate)
    const monthsInPeriod = periodType === 'quarter' ? 3 : 1
    const annualizedRevenue = cnkdRevenue * (12 / monthsInPeriod)

    // If annualized revenue below threshold → no tax
    const isAboveThreshold = annualizedRevenue > cnkdThreshold
    const cnkdVatAmount = isAboveThreshold ? cnkdRevenue * (cnkdVatRate / 100) : 0
    const cnkdPitAmount = isAboveThreshold ? cnkdRevenue * (cnkdPitRate / 100) : 0
    const cnkdTotalTax = cnkdVatAmount + cnkdPitAmount

    return { cnkdRevenue, cnkdVatRate, cnkdVatAmount, cnkdPitRate, cnkdPitAmount, cnkdTotalTax, cnkdThreshold }
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
        const { periodType = 'month', taxCode, companyName, companyAddress, transactionIds } = req.body
        const year = Number(req.body.year)
        const month = req.body.month ? Number(req.body.month) : undefined
        const quarter = req.body.quarter ? Number(req.body.quarter) : undefined

        if (!year || !taxCode || !companyName) {
            return res.status(400).json({ success: false, error: 'year, taxCode, companyName required' })
        }

        // Check annual revenue to decide form type
        const yearStart = new Date(year, 0, 1)
        const yearEnd = new Date(year, 11, 31, 23, 59, 59, 999)
        const allYearTx = await prisma.transaction.findMany({
            where: { status: 'completed', createdAt: { gte: yearStart, lte: yearEnd } },
            select: { total: true },
        })
        const annualRevenue = allYearTx.reduce((s, t) => s + (t.total || 0), 0)
        const isAboveThreshold = annualRevenue >= 500000000
        const formType = isAboveThreshold ? '01_GTGT' : '01_CNKD'
        const businessType = isAboveThreshold ? 'company' : 'household'

        const period = periodType === 'quarter'
            ? `Q${quarter}/${year}`
            : `T${String(month).padStart(2, '0')}/${year}`

        console.log(`Creating declaration: form=${formType}, revenue=${annualRevenue}, period=${period}, selectedIds=${transactionIds?.length || 'all'}`)

        let calculated: any = {}

        if (transactionIds && transactionIds.length > 0) {
            // Calculate from selected transactions only
            const selectedTx = await prisma.transaction.findMany({
                where: { id: { in: transactionIds }, status: 'completed' },
                select: { subtotal: true, tax: true, total: true, discount: true },
            })

            if (formType === '01_GTGT') {
                const taxConfigs = await prisma.taxConfig.findMany({ where: { ...getBranchFilter(req as any), status: 'active' } })
                const defaultRate = taxConfigs.find(t => t.isDefault)?.rate ?? 10
                const totalSubtotal = selectedTx.reduce((s, t) => s + (t.subtotal || 0), 0)
                const totalTax = selectedTx.reduce((s, t) => s + (t.tax || 0), 0)
                let ct21 = 0, ct22 = 0, ct23 = 0, ct24 = 0, ct25 = 0, ct26 = 0, ct27 = 0, ct28 = 0
                if (defaultRate === 0) { ct22 = totalSubtotal }
                else if (defaultRate === 5) { ct23 = totalSubtotal; ct24 = totalTax }
                else if (defaultRate === 8) { ct25 = totalSubtotal; ct26 = totalTax }
                else { ct27 = totalSubtotal; ct28 = totalTax }
                const ct29 = ct21 + ct22 + ct23 + ct25 + ct27
                const ct30 = ct24 + ct26 + ct28

                // Input VAT from imports in the same period
                const { startDate, endDate } = getPeriodDateRange(periodType, year, month, quarter)
                const imports = await prisma.importReceipt.findMany({
                    where: { status: 'completed', createdAt: { gte: startDate, lte: endDate } },
                    select: { totalCost: true },
                })
                const totalImportCost = imports.reduce((s, i) => s + (i.totalCost || 0), 0)
                const ct31 = totalImportCost, ct32 = totalImportCost * (defaultRate / 100), ct33 = ct32
                const ct34 = 0, ct35 = ct30 - ct33 - ct34
                const ct36 = 0, ct37 = 0
                const ct38 = ct35 > 0 ? ct35 + ct36 - ct37 : 0
                const ct39 = ct35 < 0 ? Math.abs(ct35) - ct36 + ct37 : 0
                const ct40a = 0, ct40b = ct39 - ct40a
                calculated = { ct21, ct22, ct23, ct24, ct25, ct26, ct27, ct28, ct29, ct30, ct31, ct32, ct33, ct34, ct35, ct36, ct37, ct38, ct39, ct40a, ct40b }
            } else {
                const cnkdRevenue = selectedTx.reduce((s, t) => s + (t.total || 0), 0)
                const cnkdVatRate = 1, cnkdPitRate = 0.5
                const cnkdVatAmount = cnkdRevenue * (cnkdVatRate / 100)
                const cnkdPitAmount = cnkdRevenue * (cnkdPitRate / 100)
                const cnkdTotalTax = cnkdVatAmount + cnkdPitAmount
                calculated = { cnkdRevenue, cnkdVatRate, cnkdVatAmount, cnkdPitRate, cnkdPitAmount, cnkdTotalTax, cnkdThreshold: 500000000 }
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

        const data = await prisma.taxDeclaration.create({
            data: {
                formType,
                businessType,
                period, periodType, year,
                month: periodType === 'month' ? (month || null) : null,
                quarter: periodType === 'quarter' ? (quarter || null) : null,
                taxCode, companyName, companyAddress: companyAddress || null,
                ...calculated,
            },
        })

        res.status(201).json({ success: true, data })
    } catch (err: any) {
        console.error('POST /declarations error:', err)
        res.status(500).json({ success: false, error: err?.message || 'Internal server error' })
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
        res.status(500).json({ success: false, error: err?.message || 'Internal server error' })
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
        res.status(500).json({ success: false, error: err?.message || 'Internal server error' })
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
        res.status(500).json({ success: false, error: err?.message || 'Internal server error' })
    }
})

export default router
