// ─────────────────────────────────────────────────────────────────────────────
//  Enhanced accounting reports — mounted at /api/reports
//
//    GET /api/reports/trial-balance                Bảng cân đối phát sinh
//    GET /api/reports/general-ledger/:accountCode  Sổ cái (one account)
//    GET /api/reports/general-journal              Sổ nhật ký chung
//    GET /api/reports/sub-ledger/:type/:id         Sổ chi tiết (customer | supplier)
//    GET /api/reports/cash-book                    Sổ quỹ tiền mặt (TK 111)
//    GET /api/reports/bank-book                    Sổ tiền gửi ngân hàng (TK 112)
//
//  NOTE: this router is mounted at /api/reports AFTER /api/reports/financial, so
//  it must never define a `/financial*` path.
// ─────────────────────────────────────────────────────────────────────────────

import { Router, Response } from 'express'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { errMsg } from '../lib/errorResponse'
import { accountName } from '../lib/chartOfAccounts'

const router = Router()

const pad2 = (n: number) => String(n).padStart(2, '0')

// Resolve year/month/quarter query into an inclusive YYYY-MM-DD range + the day before the period start.
function rangeFromQuery(q: any): { gte: string; lte: string; dayBefore: string; year: number; label: string } {
    const year = Number(q.year) || new Date().getFullYear()
    const month = q.month ? Number(q.month) : undefined
    const quarter = q.quarter ? Number(q.quarter) : undefined
    if (month) {
        const last = new Date(year, month, 0).getDate()
        const gte = `${year}-${pad2(month)}-01`
        return { gte, lte: `${year}-${pad2(month)}-${pad2(last)}`, dayBefore: gte, year, label: `T${month}/${year}` }
    }
    if (quarter) {
        const startM = (quarter - 1) * 3 + 1
        const endM = startM + 2
        const last = new Date(year, endM, 0).getDate()
        const gte = `${year}-${pad2(startM)}-01`
        return { gte, lte: `${year}-${pad2(endM)}-${pad2(last)}`, dayBefore: gte, year, label: `Quý ${quarter}/${year}` }
    }
    const gte = `${year}-01-01`
    return { gte, lte: `${year}-12-31`, dayBefore: gte, year, label: `năm ${year}` }
}

// ─── Trial Balance (Bảng cân đối phát sinh) ──────────────────────────────────
// Opening balance + period movements + closing balance for every account.
router.get('/trial-balance', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const { gte, lte, dayBefore, label } = rangeFromQuery(req.query)

        const [opening, period] = await Promise.all([
            prisma.journalEntry.findMany({ where: { date: { lt: dayBefore } }, select: { debitAccount: true, debitAccountName: true, creditAccount: true, creditAccountName: true, amount: true } }),
            prisma.journalEntry.findMany({ where: { date: { gte, lte } }, select: { debitAccount: true, debitAccountName: true, creditAccount: true, creditAccountName: true, amount: true } }),
        ])

        type Row = { code: string; name: string; openingDebit: number; openingCredit: number; periodDebit: number; periodCredit: number }
        const map = new Map<string, Row>()
        const ensure = (code: string, name?: string): Row => {
            let r = map.get(code)
            if (!r) { r = { code, name: name || accountName(code), openingDebit: 0, openingCredit: 0, periodDebit: 0, periodCredit: 0 }; map.set(code, r) }
            else if (name && (r.name === code)) r.name = name
            return r
        }

        // Opening: accumulate net into opening debit/credit per natural side.
        const openNet = new Map<string, number>()
        for (const e of opening) {
            openNet.set(e.debitAccount, (openNet.get(e.debitAccount) || 0) + e.amount)
            openNet.set(e.creditAccount, (openNet.get(e.creditAccount) || 0) - e.amount)
            ensure(e.debitAccount, e.debitAccountName)
            ensure(e.creditAccount, e.creditAccountName)
        }
        for (const [code, net] of openNet) {
            const r = ensure(code)
            if (net >= 0) r.openingDebit = net; else r.openingCredit = -net
        }
        for (const e of period) {
            ensure(e.debitAccount, e.debitAccountName).periodDebit += e.amount
            ensure(e.creditAccount, e.creditAccountName).periodCredit += e.amount
        }

        const accounts = Array.from(map.values()).map(r => {
            const closingNet = (r.openingDebit - r.openingCredit) + (r.periodDebit - r.periodCredit)
            return {
                code: r.code, name: r.name,
                openingDebit: r.openingDebit, openingCredit: r.openingCredit,
                periodDebit: r.periodDebit, periodCredit: r.periodCredit,
                closingDebit: closingNet >= 0 ? closingNet : 0,
                closingCredit: closingNet < 0 ? -closingNet : 0,
            }
        }).sort((a, b) => a.code.localeCompare(b.code))

        const sum = (k: keyof typeof accounts[0]) => accounts.reduce((s, a) => s + (a[k] as number), 0)
        const totals = {
            openingDebit: sum('openingDebit'), openingCredit: sum('openingCredit'),
            periodDebit: sum('periodDebit'), periodCredit: sum('periodCredit'),
            closingDebit: sum('closingDebit'), closingCredit: sum('closingCredit'),
        }
        res.json({
            success: true,
            data: {
                period: label, accounts, totals,
                isBalanced: Math.abs(totals.periodDebit - totals.periodCredit) < 1,
            },
        })
    } catch (err: any) {
        console.error('GET /reports/trial-balance error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// ─── General Journal (Sổ nhật ký chung) ──────────────────────────────────────
router.get('/general-journal', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const { gte, lte, label } = rangeFromQuery(req.query)
        const take = Math.min(Number(req.query.limit) || 5000, 20000)
        const entries = await prisma.journalEntry.findMany({
            where: { date: { gte, lte } },
            orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
            take: take + 1,
        })
        const truncated = entries.length > take
        if (truncated) entries.length = take
        const rows = entries.map((e: any) => ({
            id: e.id, date: e.date, reference: e.reference, referenceType: e.referenceType || 'manual',
            description: e.description,
            debitAccount: e.debitAccount, debitAccountName: e.debitAccountName || accountName(e.debitAccount),
            creditAccount: e.creditAccount, creditAccountName: e.creditAccountName || accountName(e.creditAccount),
            amount: e.amount,
        }))
        const total = rows.reduce((s: number, r: any) => s + r.amount, 0)
        res.json({ success: true, data: { period: label, entries: rows, count: rows.length, totalDebit: total, totalCredit: total, truncated } })
    } catch (err: any) {
        console.error('GET /reports/general-journal error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// ─── General Ledger for a single account (Sổ cái) ────────────────────────────
router.get('/general-ledger/:accountCode', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const account = Array.isArray(req.params.accountCode) ? req.params.accountCode[0] : req.params.accountCode
        const { gte, lte, dayBefore, label } = rangeFromQuery(req.query)
        // Match the account and its sub-accounts (e.g. 111 also covers 1111, 1112).
        const matches = (code: string) => code === account || code.startsWith(account)

        const [openingEntries, periodEntries] = await Promise.all([
            prisma.journalEntry.findMany({
                where: { date: { lt: dayBefore }, OR: [{ debitAccount: { startsWith: account } }, { creditAccount: { startsWith: account } }] },
                select: { debitAccount: true, creditAccount: true, amount: true },
            }),
            prisma.journalEntry.findMany({
                where: { date: { gte, lte }, OR: [{ debitAccount: { startsWith: account } }, { creditAccount: { startsWith: account } }] },
                orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
            }),
        ])

        let opening = 0
        for (const e of openingEntries) {
            if (matches(e.debitAccount)) opening += e.amount
            if (matches(e.creditAccount)) opening -= e.amount
        }

        let balance = opening
        const rows = periodEntries.map((e: any) => {
            const debit = matches(e.debitAccount) ? e.amount : 0
            const credit = matches(e.creditAccount) ? e.amount : 0
            balance += debit - credit
            return {
                id: e.id, date: e.date, description: e.description, reference: e.reference,
                referenceType: e.referenceType || 'manual',
                counterAccount: matches(e.debitAccount) ? e.creditAccount : e.debitAccount,
                debit, credit, balance,
            }
        })
        const totalDebit = rows.reduce((s: number, r: any) => s + r.debit, 0)
        const totalCredit = rows.reduce((s: number, r: any) => s + r.credit, 0)
        res.json({
            success: true,
            data: {
                account, accountName: accountName(account), period: label,
                openingBalance: opening, entries: rows, totalDebit, totalCredit, closingBalance: balance,
            },
        })
    } catch (err: any) {
        console.error('GET /reports/general-ledger/:accountCode error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// ─── Sub-ledger by object (Sổ chi tiết — customer | supplier) ─────────────────
router.get('/sub-ledger/:type/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const type = String(req.params.type)
        const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id
        const { gte, lte, label } = rangeFromQuery(req.query)
        const start = new Date(`${gte}T00:00:00.000Z`)
        const end = new Date(`${lte}T23:59:59.999Z`)

        if (type === 'customer') {
            const [customer, debtEntries, txs] = await Promise.all([
                prisma.customer.findUnique({ where: { id } }).catch(() => null),
                prisma.debtEntry.findMany({ where: { customerId: id, createdAt: { gte: start, lte: end } }, orderBy: { createdAt: 'asc' } }).catch(() => []),
                prisma.transaction.findMany({ where: { customerId: id, createdAt: { gte: start, lte: end } }, select: { id: true, receiptNumber: true, total: true, amountReceived: true, status: true, createdAt: true } }).catch(() => []),
            ])
            // Debt entries already model receivable movements (type: debit/credit) with a running balance.
            const rows = debtEntries.map((d: any) => ({
                id: d.id, date: d.createdAt, description: d.description,
                type: d.type, amount: d.amount, balance: d.balance,
            }))
            const totalDebit = debtEntries.filter((d: any) => d.type === 'debit').reduce((s: number, d: any) => s + d.amount, 0)
            const totalCredit = debtEntries.filter((d: any) => d.type !== 'debit').reduce((s: number, d: any) => s + d.amount, 0)
            return res.json({
                success: true,
                data: {
                    type, period: label, account: '131', accountName: accountName('131'),
                    object: customer ? { id: customer.id, name: customer.name, phone: customer.phone, currentDebt: customer.debt } : { id },
                    entries: rows, transactions: txs, totalDebit, totalCredit,
                    closingBalance: customer?.debt ?? (rows.length ? rows[rows.length - 1].balance : 0),
                },
            })
        }

        if (type === 'supplier') {
            const [supplier, receipts] = await Promise.all([
                prisma.supplier.findUnique({ where: { id } }).catch(() => null),
                prisma.importReceipt.findMany({ where: { supplierId: id, createdAt: { gte: start, lte: end } }, orderBy: { createdAt: 'asc' }, select: { id: true, code: true, totalCost: true, status: true, createdAt: true, transactionDate: true, note: true } }).catch(() => []),
            ])
            let balance = 0
            const rows = receipts.map((r: any) => {
                // Each import receipt increases the payable to the supplier (credit side of 331).
                const credit = r.totalCost || 0
                balance += credit
                return {
                    id: r.id, date: r.transactionDate || r.createdAt, description: `Nhập hàng ${r.code}${r.note ? ' - ' + r.note : ''}`,
                    code: r.code, status: r.status, debit: 0, credit, balance,
                }
            })
            const totalCredit = rows.reduce((s: number, r: any) => s + r.credit, 0)
            return res.json({
                success: true,
                data: {
                    type, period: label, account: '331', accountName: accountName('331'),
                    object: supplier ? { id: supplier.id, name: supplier.name, phone: supplier.phone } : { id },
                    entries: rows, totalDebit: 0, totalCredit, closingBalance: balance,
                },
            })
        }

        return res.status(400).json({ success: false, error: "type phải là 'customer' hoặc 'supplier'" })
    } catch (err: any) {
        console.error('GET /reports/sub-ledger/:type/:id error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// ─── Cash Book / Bank Book (Sổ quỹ tiền mặt / tiền gửi) ───────────────────────
// Shared builder over a cash-account prefix (111 or 112) from the journal.
async function buildCashBook(prisma: any, q: any, accountPrefix: string) {
    const { gte, lte, dayBefore, label } = rangeFromQuery(q)
    const matches = (code: string) => code === accountPrefix || code.startsWith(accountPrefix)

    const [openingEntries, periodEntries] = await Promise.all([
        prisma.journalEntry.findMany({
            where: { date: { lt: dayBefore }, OR: [{ debitAccount: { startsWith: accountPrefix } }, { creditAccount: { startsWith: accountPrefix } }] },
            select: { debitAccount: true, creditAccount: true, amount: true },
        }),
        prisma.journalEntry.findMany({
            where: { date: { gte, lte }, OR: [{ debitAccount: { startsWith: accountPrefix } }, { creditAccount: { startsWith: accountPrefix } }] },
            orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
        }),
    ])

    let opening = 0
    for (const e of openingEntries) {
        if (matches(e.debitAccount)) opening += e.amount
        if (matches(e.creditAccount)) opening -= e.amount
    }

    let balance = opening
    const entries = periodEntries.map((e: any) => {
        const receipt = matches(e.debitAccount) ? e.amount : 0
        const payment = matches(e.creditAccount) ? e.amount : 0
        balance += receipt - payment
        return {
            id: e.id, date: e.date, description: e.description, reference: e.reference,
            referenceType: e.referenceType || 'manual',
            counterAccount: matches(e.debitAccount) ? e.creditAccount : e.debitAccount,
            receipt, payment, balance,
        }
    })
    const totalReceipts = entries.reduce((s: number, e: any) => s + e.receipt, 0)
    const totalPayments = entries.reduce((s: number, e: any) => s + e.payment, 0)
    return { period: label, account: accountPrefix, accountName: accountName(accountPrefix), openingBalance: opening, entries, totalReceipts, totalPayments, closingBalance: balance }
}

// GET /api/reports/cash-book
router.get('/cash-book', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const data = await buildCashBook(req.storePrisma!, req.query, '111')
        res.json({ success: true, data })
    } catch (err: any) {
        console.error('GET /reports/cash-book error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// GET /api/reports/bank-book
router.get('/bank-book', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const data = await buildCashBook(req.storePrisma!, req.query, '112')
        res.json({ success: true, data })
    } catch (err: any) {
        console.error('GET /reports/bank-book error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

export default router
