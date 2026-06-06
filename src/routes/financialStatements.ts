// ─────────────────────────────────────────────────────────────────────────────
//  Financial Statements (Báo cáo tài chính — BCTC) — mounted at /api/reports
//
//    GET /api/reports/balance-sheet     B01-DNN: Bảng cân đối kế toán
//    GET /api/reports/income-statement  B02-DNN: Báo cáo kết quả kinh doanh
//    GET /api/reports/cash-flow         B03-DNN: Báo cáo lưu chuyển tiền tệ
//
//  All figures are derived from the JournalEntry ledger (TT99/2025 chart of
//  accounts). This router is mounted at /api/reports AFTER /api/reports/financial
//  and alongside accountingReportRoutes; its paths never overlap with those.
// ─────────────────────────────────────────────────────────────────────────────

import { Router, Response } from 'express'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { errMsg } from '../lib/errorResponse'
import { accountName } from '../lib/chartOfAccounts'

const router = Router()

const pad2 = (n: number) => String(n).padStart(2, '0')
const isTrue = (v: any) => v === true || v === 'true' || v === '1'

// Today as YYYY-MM-DD (local) — used as the default balance-sheet report date.
function today(): string {
    const d = new Date()
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

// Shift a YYYY-MM-DD string back by `n` whole years (keeps month/day).
function shiftYears(date: string, n: number): string {
    const y = Number(date.slice(0, 4))
    return `${y - n}${date.slice(4)}`
}

// ─── Movement aggregation over a journal-entry set ───────────────────────────
type Entry = { debitAccount: string; creditAccount: string; amount: number }

// Sum of `amount` where the account on `side` starts with `prefix`.
function side(entries: Entry[], prefix: string, s: 'debit' | 'credit'): number {
    let total = 0
    for (const e of entries) {
        const code = s === 'debit' ? e.debitAccount : e.creditAccount
        if (code && code.startsWith(prefix)) total += e.amount
    }
    return total
}
// Net debit movement (debit − credit) for an account group.
const netDebit = (entries: Entry[], prefix: string) => side(entries, prefix, 'debit') - side(entries, prefix, 'credit')
// Net credit movement (credit − debit) for an account group.
const netCredit = (entries: Entry[], prefix: string) => side(entries, prefix, 'credit') - side(entries, prefix, 'debit')

// ═════════════════════════════════════════════════════════════════════════════
//  B01-DNN — Bảng cân đối kế toán (Balance Sheet)
// ═════════════════════════════════════════════════════════════════════════════

// Account groups for each balance-sheet section. `nature` drives sign: assets
// net debit−credit; liabilities & equity net credit−debit. 214 (hao mòn — a
// contra-asset, credit nature) naturally nets negative inside long-term assets.
const SHORT_TERM_ASSETS = ['111', '112', '131', '133', '141', '142', '152', '153', '154', '155', '156', '157']
const LONG_TERM_ASSETS = ['211', '214', '242']
const LIABILITIES = ['331', '333', '334', '338', '341']
const EQUITY = ['411', '421']

// Closing balance per account-prefix as of a date, from the full ledger up to that date.
async function balanceMapAsOf(prisma: any, date: string): Promise<Entry[]> {
    try {
        return await prisma.journalEntry.findMany({
            where: { date: { lte: date } },
            select: { debitAccount: true, creditAccount: true, amount: true },
        })
    } catch {
        return []
    }
}

function buildSection(codes: string[], nature: 'asset' | 'liability' | 'equity', current: Entry[], previous: Entry[] | null) {
    const fn = nature === 'asset' ? netDebit : netCredit
    return codes.map(code => ({
        code,
        name: accountName(code),
        previousPeriod: previous ? Math.round(fn(previous, code)) : null,
        currentPeriod: Math.round(fn(current, code)),
    }))
}

// GET /api/reports/balance-sheet?date=YYYY-MM-DD&comparePreviousYear=true
router.get('/balance-sheet', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const reportDate = req.query.date ? String(req.query.date).slice(0, 10) : today()
        const compare = isTrue(req.query.comparePreviousYear)
        // "Số đầu năm" = closing balance at the end of the prior year (= day before Jan 1).
        const previousDate = `${Number(reportDate.slice(0, 4)) - 1}-12-31`

        const [current, previous] = await Promise.all([
            balanceMapAsOf(prisma, reportDate),
            compare ? balanceMapAsOf(prisma, previousDate) : Promise.resolve(null),
        ])

        const shortTermAssets = buildSection(SHORT_TERM_ASSETS, 'asset', current, previous)
        const longTermAssets = buildSection(LONG_TERM_ASSETS, 'asset', current, previous)
        const liabilities = buildSection(LIABILITIES, 'liability', current, previous)
        const equity = buildSection(EQUITY, 'equity', current, previous)

        const sum = (rows: any[], k: 'currentPeriod' | 'previousPeriod') => rows.reduce((s, r) => s + (r[k] || 0), 0)
        const totalAssets = sum(shortTermAssets, 'currentPeriod') + sum(longTermAssets, 'currentPeriod')
        const totalLiabilities = sum(liabilities, 'currentPeriod')
        const totalEquity = sum(equity, 'currentPeriod')

        res.json({
            success: true,
            data: {
                form: 'B01-DNN',
                title: 'Bảng cân đối kế toán',
                reportDate,
                comparePreviousYear: compare,
                previousDate: compare ? previousDate : null,
                sections: { shortTermAssets, longTermAssets, liabilities, equity },
                totals: {
                    totalShortTermAssets: sum(shortTermAssets, 'currentPeriod'),
                    totalLongTermAssets: sum(longTermAssets, 'currentPeriod'),
                    totalAssets,
                    totalLiabilities,
                    totalEquity,
                    totalResources: totalLiabilities + totalEquity,
                    ...(compare ? {
                        totalAssetsPrevious: sum(shortTermAssets, 'previousPeriod') + sum(longTermAssets, 'previousPeriod'),
                        totalLiabilitiesPrevious: sum(liabilities, 'previousPeriod'),
                        totalEquityPrevious: sum(equity, 'previousPeriod'),
                    } : {}),
                },
                isBalanced: Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 1,
            },
        })
    } catch (err: any) {
        console.error('GET /reports/balance-sheet error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// ═════════════════════════════════════════════════════════════════════════════
//  B02-DNN — Báo cáo kết quả hoạt động kinh doanh (Income Statement)
// ═════════════════════════════════════════════════════════════════════════════

// Compute every P&L figure from a period's journal movements.
function computeIncome(entries: Entry[]) {
    const revenue = netCredit(entries, '511')          // [01] Doanh thu bán hàng & CCDV
    const deductions = netDebit(entries, '521')        // [02] Các khoản giảm trừ doanh thu
    const netRevenue = revenue - deductions            // [10] Doanh thu thuần
    const cogs = netDebit(entries, '632')              // [11] Giá vốn hàng bán
    const grossProfit = netRevenue - cogs              // [20] Lợi nhuận gộp
    const financialIncome = netCredit(entries, '515')  // [21] Doanh thu hoạt động tài chính
    const financialExpense = netDebit(entries, '635')  // [22] Chi phí tài chính
    const sellingExpense = netDebit(entries, '641')    // [25] Chi phí bán hàng
    const adminExpense = netDebit(entries, '642')      // [26] Chi phí quản lý doanh nghiệp
    const operatingProfit = grossProfit + financialIncome - financialExpense - sellingExpense - adminExpense // [30]
    const otherIncome = netCredit(entries, '711')      // [31] Thu nhập khác
    const otherExpense = netDebit(entries, '811')      // [32] Chi phí khác
    const otherProfit = otherIncome - otherExpense     // [40]
    const profitBeforeTax = operatingProfit + otherProfit // [50] Tổng lợi nhuận kế toán trước thuế
    const citExpense = netDebit(entries, '821')        // [51] Chi phí thuế TNDN
    const netProfit = profitBeforeTax - citExpense     // [60] Lợi nhuận sau thuế

    return {
        revenue, deductions, netRevenue, cogs, grossProfit,
        financialIncome, financialExpense, sellingExpense, adminExpense, operatingProfit,
        otherIncome, otherExpense, otherProfit, profitBeforeTax, citExpense, netProfit,
    }
}

// Map computeIncome output to B02-DNN report rows (code = chỉ tiêu, account = TK).
function incomeRows(cur: ReturnType<typeof computeIncome>, prev: ReturnType<typeof computeIncome> | null) {
    const spec: { code: string; name: string; account: string; key: keyof typeof cur }[] = [
        { code: '01', name: 'Doanh thu bán hàng và cung cấp dịch vụ', account: '511', key: 'revenue' },
        { code: '02', name: 'Các khoản giảm trừ doanh thu', account: '521', key: 'deductions' },
        { code: '10', name: 'Doanh thu thuần về bán hàng và CCDV', account: '', key: 'netRevenue' },
        { code: '11', name: 'Giá vốn hàng bán', account: '632', key: 'cogs' },
        { code: '20', name: 'Lợi nhuận gộp về bán hàng và CCDV', account: '', key: 'grossProfit' },
        { code: '21', name: 'Doanh thu hoạt động tài chính', account: '515', key: 'financialIncome' },
        { code: '22', name: 'Chi phí tài chính', account: '635', key: 'financialExpense' },
        { code: '25', name: 'Chi phí bán hàng', account: '641', key: 'sellingExpense' },
        { code: '26', name: 'Chi phí quản lý doanh nghiệp', account: '642', key: 'adminExpense' },
        { code: '30', name: 'Lợi nhuận thuần từ hoạt động kinh doanh', account: '', key: 'operatingProfit' },
        { code: '31', name: 'Thu nhập khác', account: '711', key: 'otherIncome' },
        { code: '32', name: 'Chi phí khác', account: '811', key: 'otherExpense' },
        { code: '40', name: 'Lợi nhuận khác', account: '', key: 'otherProfit' },
        { code: '50', name: 'Tổng lợi nhuận kế toán trước thuế', account: '', key: 'profitBeforeTax' },
        { code: '51', name: 'Chi phí thuế TNDN', account: '821', key: 'citExpense' },
        { code: '60', name: 'Lợi nhuận sau thuế thu nhập doanh nghiệp', account: '', key: 'netProfit' },
    ]
    return spec.map(s => ({
        code: s.code,
        name: s.name,
        account: s.account || null,
        currentPeriod: Math.round(cur[s.key]),
        previousPeriod: prev ? Math.round(prev[s.key]) : null,
    }))
}

// GET /api/reports/income-statement?from=YYYY-MM-DD&to=YYYY-MM-DD&comparePreviousYear=true
router.get('/income-statement', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const year = new Date().getFullYear()
        const from = req.query.from ? String(req.query.from).slice(0, 10) : `${year}-01-01`
        const to = req.query.to ? String(req.query.to).slice(0, 10) : `${year}-12-31`
        const compare = isTrue(req.query.comparePreviousYear)
        const prevFrom = shiftYears(from, 1)
        const prevTo = shiftYears(to, 1)

        const fetch = (gte: string, lte: string) => prisma.journalEntry.findMany({
            where: { date: { gte, lte } },
            select: { debitAccount: true, creditAccount: true, amount: true },
        }).catch(() => [])

        const [current, previous] = await Promise.all([
            fetch(from, to),
            compare ? fetch(prevFrom, prevTo) : Promise.resolve(null),
        ])

        const cur = computeIncome(current)
        const prev = previous ? computeIncome(previous) : null

        res.json({
            success: true,
            data: {
                form: 'B02-DNN',
                title: 'Báo cáo kết quả hoạt động kinh doanh',
                from, to,
                comparePreviousYear: compare,
                ...(compare ? { previousFrom: prevFrom, previousTo: prevTo } : {}),
                rows: incomeRows(cur, prev),
                summary: {
                    ...cur,
                    ...(prev ? { previous: prev } : {}),
                },
            },
        })
    } catch (err: any) {
        console.error('GET /reports/income-statement error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// ═════════════════════════════════════════════════════════════════════════════
//  B03-DNN — Báo cáo lưu chuyển tiền tệ (Cash Flow, direct method)
// ═════════════════════════════════════════════════════════════════════════════

// Cash & cash-equivalent accounts (TK 111, 112 and their sub-accounts).
const CASH_PREFIXES = ['111', '112']
const isCash = (code: string) => !!code && CASH_PREFIXES.some(c => code.startsWith(c))

// GET /api/reports/cash-flow?from=YYYY-MM-DD&to=YYYY-MM-DD
router.get('/cash-flow', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const year = new Date().getFullYear()
        const from = req.query.from ? String(req.query.from).slice(0, 10) : `${year}-01-01`
        const to = req.query.to ? String(req.query.to).slice(0, 10) : `${year}-12-31`

        const [period, beforePeriod] = await Promise.all([
            prisma.journalEntry.findMany({ where: { date: { gte: from, lte: to } }, select: { debitAccount: true, creditAccount: true, amount: true } }).catch(() => []),
            prisma.journalEntry.findMany({ where: { date: { lt: from } }, select: { debitAccount: true, creditAccount: true, amount: true } }).catch(() => []),
        ])

        // Direct method: classify each cash movement by the counter-account.
        let fromCustomers = 0      // Tiền thu từ bán hàng & khách hàng (Có 511, 131, 3331)
        let toSuppliers = 0        // Tiền chi trả người bán (Nợ 331, 152/156, 6xx hàng hóa)
        let toEmployees = 0        // Tiền chi trả người lao động (Nợ 334)
        let toTaxes = 0            // Tiền nộp thuế (Nợ 333)
        let otherOperating = 0     // Các khoản thu/chi hoạt động khác
        let investing = 0          // Đầu tư: mua/bán TSCĐ (Nợ/Có 2xx)
        let financing = 0          // Tài chính: vay/trả nợ vay, vốn (Nợ/Có 341, 411)

        for (const e of period as Entry[]) {
            const debitCash = isCash(e.debitAccount)
            const creditCash = isCash(e.creditAccount)
            if (debitCash === creditCash) continue // skip non-cash or cash↔cash transfers

            if (debitCash) {
                // Cash inflow — counter = creditAccount
                const c = e.creditAccount
                if (c.startsWith('511') || c.startsWith('512') || c.startsWith('131') || c.startsWith('3331') || c.startsWith('33311')) fromCustomers += e.amount
                else if (c.startsWith('341') || c.startsWith('411')) financing += e.amount
                else if (c.startsWith('2')) investing += e.amount // disposal of fixed assets
                else otherOperating += e.amount
            } else {
                // Cash outflow — counter = debitAccount
                const d = e.debitAccount
                if (d.startsWith('334')) toEmployees -= e.amount
                else if (d.startsWith('333')) toTaxes -= e.amount
                else if (d.startsWith('331') || d.startsWith('152') || d.startsWith('153') || d.startsWith('156') || d.startsWith('611') || d.startsWith('632') || d.startsWith('641') || d.startsWith('642') || d.startsWith('635')) toSuppliers -= e.amount
                else if (d.startsWith('2')) investing -= e.amount // purchase of fixed assets
                else if (d.startsWith('341') || d.startsWith('411')) financing -= e.amount
                else otherOperating -= e.amount
            }
        }

        const operatingNet = fromCustomers + toSuppliers + toEmployees + toTaxes + otherOperating
        const netCashFlow = operatingNet + investing + financing

        let openingCash = 0
        for (const e of beforePeriod as Entry[]) {
            if (isCash(e.debitAccount)) openingCash += e.amount
            if (isCash(e.creditAccount)) openingCash -= e.amount
        }
        const closingCash = openingCash + netCashFlow

        const r = (n: number) => Math.round(n)
        res.json({
            success: true,
            data: {
                form: 'B03-DNN',
                title: 'Báo cáo lưu chuyển tiền tệ (phương pháp trực tiếp)',
                from, to,
                operating: {
                    fromCustomers: r(fromCustomers),
                    toSuppliers: r(toSuppliers),
                    toEmployees: r(toEmployees),
                    toTaxes: r(toTaxes),
                    other: r(otherOperating),
                    net: r(operatingNet),
                },
                investing: { net: r(investing) },
                financing: { net: r(financing) },
                netCashFlow: r(netCashFlow),
                openingCash: r(openingCash),
                closingCash: r(closingCash),
            },
        })
    } catch (err: any) {
        console.error('GET /reports/cash-flow error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

export default router
