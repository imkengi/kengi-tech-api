// ─────────────────────────────────────────────────────────────────────────────
//  Tax declarations (Tờ khai thuế) — mounted at /api/tax (alongside tax.ts)
//
//    GET  /api/tax/vat-return         Tờ khai GTGT 01/GTGT (auto từ TK 3331 / 133)
//    GET  /api/tax/vat-purchase-list  Bảng kê mua vào 01-2/GTGT
//    GET  /api/tax/vat-sales-list     Bảng kê bán ra 01-1/GTGT
//    GET  /api/tax/cit-return         Tờ khai TNDN 03/TNDN (cả năm)
//    GET  /api/tax/cit-quarterly      Tạm tính TNDN quý
//    POST /api/tax/export-xml         Xuất XML tờ khai (HTKK/Mtax — QĐ 1450/QĐ-TCT)
//
//  Mounted after tax.ts at the same /api/tax prefix; none of these paths exist
//  in tax.ts so there is no route collision. Figures derive from the JournalEntry
//  ledger plus the Transaction / ImportReceipt source documents.
// ─────────────────────────────────────────────────────────────────────────────

import { Router, Response } from 'express'
import { authMiddleware, AuthRequest, getBranchFilter } from '../middleware/auth'
import { errMsg } from '../lib/errorResponse'

const router = Router()

const pad2 = (n: number) => String(n).padStart(2, '0')
const CIT_RATE = 0.20 // Thuế suất TNDN phổ thông 20%

// ─── Period helpers ──────────────────────────────────────────────────────────

// Resolve month|quarter|year into an inclusive YYYY-MM-DD string range, a Date
// range (for createdAt filters), and the HTKK period label / type.
function resolvePeriod(q: any): {
    gte: string; lte: string; start: Date; end: Date
    year: number; month?: number; quarter?: number
    periodType: 'month' | 'quarter' | 'year'; period: string
} {
    const year = Number(q.year) || new Date().getFullYear()
    const month = q.month ? Number(q.month) : undefined
    const quarter = q.quarter ? Number(q.quarter) : undefined

    if (month) {
        const last = new Date(year, month, 0).getDate()
        return {
            gte: `${year}-${pad2(month)}-01`, lte: `${year}-${pad2(month)}-${pad2(last)}`,
            start: new Date(year, month - 1, 1), end: new Date(year, month, 0, 23, 59, 59, 999),
            year, month, periodType: 'month', period: `${pad2(month)}/${year}`,
        }
    }
    if (quarter) {
        const startM = (quarter - 1) * 3 + 1
        const endM = startM + 2
        const last = new Date(year, endM, 0).getDate()
        return {
            gte: `${year}-${pad2(startM)}-01`, lte: `${year}-${pad2(endM)}-${pad2(last)}`,
            start: new Date(year, startM - 1, 1), end: new Date(year, endM, 0, 23, 59, 59, 999),
            year, quarter, periodType: 'quarter', period: `Q${quarter}/${year}`,
        }
    }
    return {
        gte: `${year}-01-01`, lte: `${year}-12-31`,
        start: new Date(year, 0, 1), end: new Date(year, 11, 31, 23, 59, 59, 999),
        year, periodType: 'year', period: `${year}`,
    }
}

type Entry = { debitAccount: string; creditAccount: string; amount: number }
const sideSum = (entries: Entry[], prefix: string, s: 'debit' | 'credit') =>
    entries.reduce((t, e) => {
        const code = s === 'debit' ? e.debitAccount : e.creditAccount
        return code && code.startsWith(prefix) ? t + e.amount : t
    }, 0)

// Default VAT rate (%) from the store's tax config, falling back to 10%.
async function defaultVatRate(prisma: any, req: AuthRequest): Promise<number> {
    try {
        const configs = await prisma.taxConfig.findMany({ where: { ...getBranchFilter(req as any), status: 'active' } })
        const def = configs.find((t: any) => t.isDefault)
        return def?.rate ?? configs[0]?.rate ?? 10
    } catch {
        return 10
    }
}

// ═════════════════════════════════════════════════════════════════════════════
//  01/GTGT — Tờ khai thuế GTGT
// ═════════════════════════════════════════════════════════════════════════════

// GET /api/tax/vat-return?month=&year=  (or ?quarter=&year=)
router.get('/vat-return', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const p = resolvePeriod(req.query)
        const entries: Entry[] = await prisma.journalEntry.findMany({
            where: { date: { gte: p.gte, lte: p.lte } },
            select: { debitAccount: true, creditAccount: true, amount: true },
        }).catch(() => [])

        // VAT output = Có 3331 (net of any reversals on the debit side).
        const outputVat = sideSum(entries, '3331', 'credit') - sideSum(entries, '3331', 'debit')
        // VAT input = Nợ 133 (net of any reversals on the credit side).
        const inputVat = sideSum(entries, '133', 'debit') - sideSum(entries, '133', 'credit')
        const vatPayable = outputVat - inputVat

        res.json({
            success: true,
            data: {
                form: '01/GTGT',
                title: 'Tờ khai thuế giá trị gia tăng',
                period: p.period,
                periodType: p.periodType,
                year: p.year, month: p.month ?? null, quarter: p.quarter ?? null,
                outputVat: Math.round(outputVat),
                inputVat: Math.round(inputVat),
                vatPayable: Math.round(Math.max(vatPayable, 0)),
                vatCarryForward: Math.round(Math.max(-vatPayable, 0)), // [43] thuế GTGT còn được khấu trừ
            },
        })
    } catch (err: any) {
        console.error('GET /tax/vat-return error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// ═════════════════════════════════════════════════════════════════════════════
//  01-2/GTGT — Bảng kê hóa đơn hàng hóa, dịch vụ mua vào
// ═════════════════════════════════════════════════════════════════════════════

// GET /api/tax/vat-purchase-list?month=&year=  (or ?quarter=&year=)
router.get('/vat-purchase-list', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const p = resolvePeriod(req.query)
        const rate = await defaultVatRate(prisma, req)

        const receipts = await prisma.importReceipt.findMany({
            where: { status: 'completed', createdAt: { gte: p.start, lte: p.end } },
            select: { id: true, code: true, supplierId: true, supplierName: true, totalCost: true, transactionDate: true, createdAt: true },
            orderBy: { createdAt: 'asc' },
        }).catch(() => [])

        // Resolve supplier tax codes in one query.
        const supplierIds = Array.from(new Set(receipts.map((r: any) => r.supplierId).filter(Boolean)))
        const suppliers = supplierIds.length
            ? await prisma.supplier.findMany({ where: { id: { in: supplierIds } }, select: { id: true, name: true, taxCode: true } }).catch(() => [])
            : []
        const taxCodeById = new Map<string, { name: string; taxCode: string | null }>(
            suppliers.map((s: any) => [s.id, { name: s.name, taxCode: s.taxCode }]),
        )

        // ImportReceipt.totalCost is recorded ex-VAT (goods value); VAT is derived at the default rate.
        const rows = receipts.map((r: any) => {
            const sup = r.supplierId ? taxCodeById.get(r.supplierId) : undefined
            const goodsValue = r.totalCost || 0
            const vatAmount = Math.round(goodsValue * rate / 100)
            return {
                invoiceNo: r.code,
                date: r.transactionDate || r.createdAt,
                supplierName: r.supplierName || sup?.name || '',
                supplierTaxCode: sup?.taxCode || '',
                goodsValue: Math.round(goodsValue),
                vatRate: rate,
                vatAmount,
            }
        })

        res.json({
            success: true,
            data: {
                form: '01-2/GTGT',
                title: 'Bảng kê hóa đơn, chứng từ hàng hóa, dịch vụ mua vào',
                period: p.period,
                rows,
                totals: {
                    count: rows.length,
                    goodsValue: rows.reduce((s: number, r: any) => s + r.goodsValue, 0),
                    vatAmount: rows.reduce((s: number, r: any) => s + r.vatAmount, 0),
                },
            },
        })
    } catch (err: any) {
        console.error('GET /tax/vat-purchase-list error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// ═════════════════════════════════════════════════════════════════════════════
//  01-1/GTGT — Bảng kê hóa đơn hàng hóa, dịch vụ bán ra
// ═════════════════════════════════════════════════════════════════════════════

// GET /api/tax/vat-sales-list?month=&year=  (or ?quarter=&year=)
router.get('/vat-sales-list', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const p = resolvePeriod(req.query)

        // Only invoiced sales carry VAT (tax > 0 or a VAT invoice was issued).
        const txs = await prisma.transaction.findMany({
            where: {
                status: { in: ['completed', 'partial'] },
                createdAt: { gte: p.start, lte: p.end },
                OR: [{ tax: { gt: 0 } }, { vatStatus: 'issued' }],
            },
            select: {
                receiptNumber: true, vatInvoiceNumber: true, customerName: true,
                subtotal: true, tax: true, total: true, transactionDate: true, createdAt: true,
            },
            orderBy: { createdAt: 'asc' },
        }).catch(() => [])

        const rows = txs.map((t: any) => ({
            invoiceNo: t.vatInvoiceNumber || t.receiptNumber,
            date: t.transactionDate || t.createdAt,
            customerName: t.customerName || 'Khách lẻ',
            customerTaxCode: '', // Customer model has no tax code field; left blank for HTKK
            goodsValue: Math.round(t.subtotal || ((t.total || 0) - (t.tax || 0))),
            vatAmount: Math.round(t.tax || 0),
        }))

        res.json({
            success: true,
            data: {
                form: '01-1/GTGT',
                title: 'Bảng kê hóa đơn, chứng từ hàng hóa, dịch vụ bán ra',
                period: p.period,
                rows,
                totals: {
                    count: rows.length,
                    goodsValue: rows.reduce((s: number, r: any) => s + r.goodsValue, 0),
                    vatAmount: rows.reduce((s: number, r: any) => s + r.vatAmount, 0),
                },
            },
        })
    } catch (err: any) {
        console.error('GET /tax/vat-sales-list error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// ═════════════════════════════════════════════════════════════════════════════
//  03/TNDN — Tờ khai thuế thu nhập doanh nghiệp
// ═════════════════════════════════════════════════════════════════════════════

// Compute revenue / deductible expenses / taxable income from a period's ledger.
function computeCit(entries: Entry[]) {
    const net = (prefix: string, side: 'debit' | 'credit') =>
        side === 'credit'
            ? sideSum(entries, prefix, 'credit') - sideSum(entries, prefix, 'debit')
            : sideSum(entries, prefix, 'debit') - sideSum(entries, prefix, 'credit')

    const salesRevenue = net('511', 'credit') - net('521', 'debit') // doanh thu thuần
    const financialIncome = net('515', 'credit')
    const otherIncome = net('711', 'credit')
    const revenue = salesRevenue + financialIncome + otherIncome

    const cogs = net('632', 'debit')
    const financialExpense = net('635', 'debit')
    const sellingExpense = net('641', 'debit')
    const adminExpense = net('642', 'debit')
    const otherExpense = net('811', 'debit')
    const deductibleExpenses = cogs + financialExpense + sellingExpense + adminExpense + otherExpense

    const taxableIncome = revenue - deductibleExpenses
    const assessableIncome = Math.max(taxableIncome, 0) // không tính thuế trên số lỗ
    const citPayable = Math.round(assessableIncome * CIT_RATE)

    return {
        revenue: Math.round(revenue),
        salesRevenue: Math.round(salesRevenue),
        financialIncome: Math.round(financialIncome),
        otherIncome: Math.round(otherIncome),
        deductibleExpenses: Math.round(deductibleExpenses),
        cogs: Math.round(cogs),
        financialExpense: Math.round(financialExpense),
        sellingExpense: Math.round(sellingExpense),
        adminExpense: Math.round(adminExpense),
        otherExpense: Math.round(otherExpense),
        taxableIncome: Math.round(taxableIncome),
        citRate: CIT_RATE,
        citPayable,
    }
}

async function citForPeriod(prisma: any, gte: string, lte: string) {
    const entries: Entry[] = await prisma.journalEntry.findMany({
        where: { date: { gte, lte } },
        select: { debitAccount: true, creditAccount: true, amount: true },
    }).catch(() => [])
    return computeCit(entries)
}

// GET /api/tax/cit-return?year=
router.get('/cit-return', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const p = resolvePeriod({ year: req.query.year })
        const data = await citForPeriod(prisma, p.gte, p.lte)
        res.json({
            success: true,
            data: {
                form: '03/TNDN',
                title: 'Tờ khai quyết toán thuế thu nhập doanh nghiệp',
                period: p.period,
                year: p.year,
                ...data,
            },
        })
    } catch (err: any) {
        console.error('GET /tax/cit-return error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// GET /api/tax/cit-quarterly?quarter=&year=
router.get('/cit-quarterly', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const quarter = Number(req.query.quarter) || Math.floor(new Date().getMonth() / 3) + 1
        const p = resolvePeriod({ quarter, year: req.query.year })
        const data = await citForPeriod(prisma, p.gte, p.lte)
        res.json({
            success: true,
            data: {
                form: '03/TNDN (tạm tính)',
                title: 'Tạm tính thuế thu nhập doanh nghiệp theo quý',
                period: p.period,
                year: p.year,
                quarter,
                provisional: true,
                ...data,
            },
        })
    } catch (err: any) {
        console.error('GET /tax/cit-quarterly error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// ═════════════════════════════════════════════════════════════════════════════
//  POST /api/tax/export-xml — Xuất XML tờ khai (QĐ 1450/QĐ-TCT)
// ═════════════════════════════════════════════════════════════════════════════

function escXml(s: any): string {
    return String(s ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}
const num = (v: number) => Math.round(v || 0)

// Shared <TTChung> (thông tin chung) block for every form.
function ttChung(opts: { maTKhai: string; tenTKhai: string; store: any; p: ReturnType<typeof resolvePeriod>; ngayLap: string }): string {
    const { maTKhai, tenTKhai, store, p, ngayLap } = opts
    return `    <TTChung>
      <maTKhai>${escXml(maTKhai)}</maTKhai>
      <tenTKhai>${escXml(tenTKhai)}</tenTKhai>
      <mst>${escXml(store?.taxCode || '')}</mst>
      <tenNNT>${escXml(store?.name || '')}</tenNNT>
      <dchiNNT>${escXml(store?.address || '')}</dchiNNT>
      <kyKKhaiThue>${escXml(p.period)}</kyKKhaiThue>
      <kyKKhaiLoai>${p.periodType === 'month' ? 'M' : p.periodType === 'quarter' ? 'Q' : 'Y'}</kyKKhaiLoai>
      <kyKKhaiNam>${p.year}</kyKKhaiNam>
      ${p.month ? `<kyKKhaiThang>${pad2(p.month)}</kyKKhaiThang>` : ''}
      ${p.quarter ? `<kyKKhaiQuy>${p.quarter}</kyKKhaiQuy>` : ''}
      <ngayLapTKhai>${escXml(ngayLap)}</ngayLapTKhai>
      <soLan>0</soLan>
    </TTChung>`
}

function wrapHoSo(maTKhai: string, ttChungXml: string, ctieuXml: string): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<HSoThueDTu>
  <HSoKhaiThue>
${ttChungXml}
    <CTieuTKhaiChinh maTKhai="${escXml(maTKhai)}">
${ctieuXml}
    </CTieuTKhaiChinh>
  </HSoKhaiThue>
</HSoThueDTu>`
}

// GET-equivalent figure builders reused inside the XML export.
async function vatFigures(prisma: any, gte: string, lte: string) {
    const entries: Entry[] = await prisma.journalEntry.findMany({
        where: { date: { gte, lte } }, select: { debitAccount: true, creditAccount: true, amount: true },
    }).catch(() => [])
    const outputVat = sideSum(entries, '3331', 'credit') - sideSum(entries, '3331', 'debit')
    const inputVat = sideSum(entries, '133', 'debit') - sideSum(entries, '133', 'credit')
    return { outputVat, inputVat, vatPayable: outputVat - inputVat }
}

// POST /api/tax/export-xml  { type: 'vat'|'cit'|'pit', year, month?, quarter? }
router.post('/export-xml', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const body = req.body || {}
        const type = String(body.type || req.query.type || '').toLowerCase()
        if (!['vat', 'cit', 'pit'].includes(type)) {
            return res.status(400).json({ success: false, error: "type phải là 'vat', 'cit' hoặc 'pit'" })
        }

        const p = resolvePeriod(body)
        const store = await prisma.storeSettings.findFirst().catch(() => null)
        const now = new Date()
        const ngayLap = `${pad2(now.getDate())}/${pad2(now.getMonth() + 1)}/${now.getFullYear()}`

        let maTKhai = '', tenTKhai = '', ctieu = ''

        if (type === 'vat') {
            maTKhai = '01/GTGT'
            tenTKhai = 'Tờ khai thuế giá trị gia tăng'
            const f = await vatFigures(prisma, p.gte, p.lte)
            ctieu = `      <ct35>${num(f.outputVat)}</ct35>
      <ct25>${num(f.inputVat)}</ct25>
      <ct36>${num(f.outputVat - f.inputVat)}</ct36>
      <ct40>${num(Math.max(f.vatPayable, 0))}</ct40>
      <ct43>${num(Math.max(-f.vatPayable, 0))}</ct43>`
        } else if (type === 'cit') {
            maTKhai = '03/TNDN'
            tenTKhai = 'Tờ khai quyết toán thuế thu nhập doanh nghiệp'
            const c = await citForPeriod(prisma, p.gte, p.lte)
            ctieu = `      <ctA1>${num(c.revenue)}</ctA1>
      <ctB1>${num(c.deductibleExpenses)}</ctB1>
      <ctC1>${num(c.taxableIncome)}</ctC1>
      <ctC4>${num(Math.max(c.taxableIncome, 0))}</ctC4>
      <ctC7>${c.citRate * 100}</ctC7>
      <ctD1>${num(c.citPayable)}</ctD1>`
        } else {
            maTKhai = '05/KK-TNCN'
            tenTKhai = 'Tờ khai khấu trừ thuế thu nhập cá nhân'
            // PIT withholding (TK 3335) collected in the period.
            const entries: Entry[] = await prisma.journalEntry.findMany({
                where: { date: { gte: p.gte, lte: p.lte } }, select: { debitAccount: true, creditAccount: true, amount: true },
            }).catch(() => [])
            const pitWithheld = sideSum(entries, '3335', 'credit') - sideSum(entries, '3335', 'debit')
            ctieu = `      <ct21>${num(pitWithheld)}</ct21>
      <ct30>${num(Math.max(pitWithheld, 0))}</ct30>`
        }

        const xml = wrapHoSo(maTKhai, ttChung({ maTKhai, tenTKhai, store, p, ngayLap }), ctieu)
        const filename = `ToKhai_${maTKhai.replace(/\//g, '-')}_${p.period.replace(/\//g, '-')}.xml`

        // Return as JSON (xml string) by default; ?download=true streams the file.
        if (body.download === true || req.query.download === 'true') {
            res.setHeader('Content-Type', 'application/xml; charset=utf-8')
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
            return res.send(xml)
        }
        res.json({ success: true, data: { type, form: maTKhai, period: p.period, filename, xml } })
    } catch (err: any) {
        console.error('POST /tax/export-xml error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

export default router
