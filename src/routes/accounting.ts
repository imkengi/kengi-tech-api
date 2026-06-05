// ─────────────────────────────────────────────────────────────────────────────
//  Accounting period operations — /api/accounting
//
//    POST /api/accounting/lock-period      khoa so (freeze a period)
//    POST /api/accounting/unlock-period    bo khoa so (admin only)
//    GET  /api/accounting/lock-status      current lock date
//    GET  /api/accounting/close-period/preview   preview closing entries
//    POST /api/accounting/close-period     ket chuyen cuoi ky -> 911 -> 421 + VAT offset
//    GET  /api/accounting/carry-forward/preview  preview opening balances
//    POST /api/accounting/carry-forward    chuyen so du dau nam moi
// ─────────────────────────────────────────────────────────────────────────────

import { Router, Response } from 'express'
import { authMiddleware, AuthRequest, getBranchId } from '../middleware/auth'
import { requireRole } from '../middleware/roleMiddleware'
import { errMsg } from '../lib/errorResponse'
import { getCurrentLock } from '../lib/periodLock'
import { accountName, classifyAccount } from '../lib/chartOfAccounts'

const router = Router()

// ─── Helpers ─────────────────────────────────────────────────────────────────

const pad2 = (n: number) => String(n).padStart(2, '0')

// Resolve a period (year + optional month/quarter) to an inclusive date range.
function periodRange(year: number, month?: number, quarter?: number): { gte: string; lte: string; label: string; closingDate: string } {
    if (month) {
        const last = new Date(year, month, 0).getDate()
        return { gte: `${year}-${pad2(month)}-01`, lte: `${year}-${pad2(month)}-${pad2(last)}`, label: `T${month}/${year}`, closingDate: `${year}-${pad2(month)}-${pad2(last)}` }
    }
    if (quarter) {
        const startM = (quarter - 1) * 3 + 1
        const endM = startM + 2
        const last = new Date(year, endM, 0).getDate()
        return { gte: `${year}-${pad2(startM)}-01`, lte: `${year}-${pad2(endM)}-${pad2(last)}`, label: `Quý ${quarter}/${year}`, closingDate: `${year}-${pad2(endM)}-${pad2(last)}` }
    }
    return { gte: `${year}-01-01`, lte: `${year}-12-31`, label: `năm ${year}`, closingDate: `${year}-12-31` }
}

interface PlanItem {
    description: string
    debitAccount: string; debitAccountName: string
    creditAccount: string; creditAccountName: string
    amount: number
}

// P&L accounts that close to TK911 (kept inline so this module is self-contained).
const PL_CLOSING: { code: string; type: 'revenue' | 'expense' }[] = [
    { code: '511', type: 'revenue' }, { code: '515', type: 'revenue' }, { code: '711', type: 'revenue' },
    { code: '632', type: 'expense' }, { code: '635', type: 'expense' }, { code: '641', type: 'expense' },
    { code: '642', type: 'expense' }, { code: '811', type: 'expense' }, { code: '821', type: 'expense' },
]

// Build the full period-end closing plan: P&L -> 911, 911 -> 421, and VAT offset 133 <-> 3331.
function buildClosingPlan(entries: { debitAccount: string; creditAccount: string; amount: number }[], label: string): PlanItem[] {
    const plan: PlanItem[] = []
    let totalRevenue = 0
    let totalExpense = 0

    for (const acc of PL_CLOSING) {
        let debitSum = 0, creditSum = 0
        for (const e of entries) {
            if (e.debitAccount === acc.code || e.debitAccount?.startsWith(acc.code)) debitSum += e.amount
            if (e.creditAccount === acc.code || e.creditAccount?.startsWith(acc.code)) creditSum += e.amount
        }
        const balance = acc.type === 'revenue' ? creditSum - debitSum : debitSum - creditSum
        if (balance <= 0) continue
        if (acc.type === 'revenue') {
            plan.push({
                description: `Kết chuyển ${accountName(acc.code)} ${label}`,
                debitAccount: acc.code, debitAccountName: accountName(acc.code),
                creditAccount: '911', creditAccountName: accountName('911'), amount: balance,
            })
            totalRevenue += balance
        } else {
            plan.push({
                description: `Kết chuyển ${accountName(acc.code)} ${label}`,
                debitAccount: '911', debitAccountName: accountName('911'),
                creditAccount: acc.code, creditAccountName: accountName(acc.code), amount: balance,
            })
            totalExpense += balance
        }
    }

    // Result transfer 911 -> 421
    const profit = totalRevenue - totalExpense
    if (profit > 0) {
        plan.push({
            description: `Kết chuyển lãi ${label} sang TK421`,
            debitAccount: '911', debitAccountName: accountName('911'),
            creditAccount: '421', creditAccountName: accountName('421'), amount: profit,
        })
    } else if (profit < 0) {
        plan.push({
            description: `Kết chuyển lỗ ${label} sang TK421`,
            debitAccount: '421', debitAccountName: accountName('421'),
            creditAccount: '911', creditAccountName: accountName('911'), amount: -profit,
        })
    }

    // VAT offset: 133 (input, debit) <-> 3331 (output, credit). Offset the smaller of the two.
    let input133 = 0, output3331 = 0
    for (const e of entries) {
        if (e.debitAccount === '133' || e.debitAccount?.startsWith('133')) input133 += e.amount
        if (e.creditAccount === '133' || e.creditAccount?.startsWith('133')) input133 -= e.amount
        if (e.creditAccount === '3331' || e.creditAccount?.startsWith('3331')) output3331 += e.amount
        if (e.debitAccount === '3331' || e.debitAccount?.startsWith('3331')) output3331 -= e.amount
    }
    const vatOffset = Math.min(Math.max(input133, 0), Math.max(output3331, 0))
    if (vatOffset > 0) {
        // Nợ 3331 / Có 133 — khấu trừ thuế GTGT
        plan.push({
            description: `Kết chuyển khấu trừ thuế GTGT ${label}`,
            debitAccount: '3331', debitAccountName: accountName('3331'),
            creditAccount: '133', creditAccountName: accountName('133'), amount: vatOffset,
        })
    }

    return plan
}

// ─── Period Lock ─────────────────────────────────────────────────────────────

// GET /api/accounting/lock-status
router.get('/lock-status', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const branchId = getBranchId(req) || null
        const lock = await getCurrentLock(prisma, branchId)
        res.json({
            success: true,
            data: {
                locked: !!lock,
                lockDate: lock?.lockDate ?? null,
                periodType: lock?.periodType ?? null,
                lockedBy: lock?.lockedByName ?? lock?.lockedBy ?? null,
                lockedAt: lock?.lockedAt ?? null,
                note: lock?.note ?? null,
            },
        })
    } catch (err: any) {
        console.error('GET /accounting/lock-status error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// POST /api/accounting/lock-period  { lockDate?, year?, month?, quarter?, periodType?, note? }
router.post('/lock-period', authMiddleware, requireRole('admin', 'manager', 'superadmin'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const body = req.body || {}
        let lockDate: string | null = body.lockDate ? String(body.lockDate).slice(0, 10) : null
        let periodType = body.periodType ? String(body.periodType) : 'custom'

        // Derive lockDate (= last day of period) from year/month/quarter when not given explicitly.
        if (!lockDate && body.year) {
            const r = periodRange(Number(body.year), body.month ? Number(body.month) : undefined, body.quarter ? Number(body.quarter) : undefined)
            lockDate = r.closingDate
            periodType = body.month ? 'month' : body.quarter ? 'quarter' : 'year'
        }
        if (!lockDate || !/^\d{4}-\d{2}-\d{2}$/.test(lockDate)) {
            return res.status(400).json({ success: false, error: 'lockDate (YYYY-MM-DD) hoặc year[+month|quarter] là bắt buộc' })
        }

        const branchId = getBranchId(req) || null

        // Reject locking to a date earlier than the current active lock (locks only move forward).
        const current = await getCurrentLock(prisma, branchId)
        if (current && lockDate < current.lockDate) {
            return res.status(400).json({
                success: false,
                error: `Kỳ đã khóa đến ${current.lockDate}. Không thể khóa lùi về ${lockDate}. Hãy bỏ khóa trước.`,
            })
        }

        // Deactivate any previous active locks for this scope, then create the new one.
        await prisma.periodLock.updateMany({
            where: { isActive: true, ...(branchId ? { branchId } : {}) },
            data: { isActive: false, unlockedAt: new Date(), unlockedBy: req.user?.userId || null, unlockReason: 'Thay bằng mốc khóa mới' },
        }).catch(() => { })

        const lock = await prisma.periodLock.create({
            data: {
                lockDate, periodType,
                note: body.note ? String(body.note) : null,
                isActive: true,
                lockedBy: req.user?.userId || null,
                lockedByName: (req.user as any)?.email || null,
                branchId,
            },
        })
        res.status(201).json({ success: true, data: lock })
    } catch (err: any) {
        console.error('POST /accounting/lock-period error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// POST /api/accounting/unlock-period — admin only
router.post('/unlock-period', authMiddleware, requireRole('admin', 'superadmin'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const branchId = getBranchId(req) || null
        const current = await getCurrentLock(prisma, branchId)
        if (!current) {
            return res.status(400).json({ success: false, error: 'Không có kỳ nào đang khóa' })
        }
        const result = await prisma.periodLock.updateMany({
            where: { isActive: true, ...(branchId ? { OR: [{ branchId }, { branchId: null }] } : {}) },
            data: {
                isActive: false,
                unlockedAt: new Date(),
                unlockedBy: req.user?.userId || null,
                unlockReason: req.body?.reason ? String(req.body.reason) : 'Bỏ khóa sổ',
            },
        })
        res.json({ success: true, data: { unlocked: result.count, previousLockDate: current.lockDate } })
    } catch (err: any) {
        console.error('POST /accounting/unlock-period error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// ─── Period-End Closing ──────────────────────────────────────────────────────

function closingRefFor(year: number, month?: number, quarter?: number): string {
    if (month) return `CLOSE-${year}-${pad2(month)}`
    if (quarter) return `CLOSE-${year}-Q${quarter}`
    return `CLOSE-${year}`
}

// GET /api/accounting/close-period/preview?year=&month=&quarter=
router.get('/close-period/preview', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const year = Number(req.query.year) || new Date().getFullYear()
        const month = req.query.month ? Number(req.query.month) : undefined
        const quarter = req.query.quarter ? Number(req.query.quarter) : undefined
        const { gte, lte, label } = periodRange(year, month, quarter)
        const entries = await prisma.journalEntry.findMany({
            where: { date: { gte, lte } },
            select: { debitAccount: true, creditAccount: true, amount: true },
        })
        const plan = buildClosingPlan(entries, label)
        const total = plan.reduce((s, p) => s + p.amount, 0)
        res.json({ success: true, data: { plan, periodLabel: label, totalDebit: total, totalCredit: total } })
    } catch (err: any) {
        console.error('GET /accounting/close-period/preview error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// POST /api/accounting/close-period?year=&month=&quarter=
router.post('/close-period', authMiddleware, requireRole('admin', 'manager', 'superadmin'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const year = Number(req.query.year ?? req.body?.year) || new Date().getFullYear()
        const month = (req.query.month ?? req.body?.month) ? Number(req.query.month ?? req.body?.month) : undefined
        const quarter = (req.query.quarter ?? req.body?.quarter) ? Number(req.query.quarter ?? req.body?.quarter) : undefined
        const { gte, lte, label, closingDate } = periodRange(year, month, quarter)

        const entries = await prisma.journalEntry.findMany({
            where: { date: { gte, lte } },
            select: { debitAccount: true, creditAccount: true, amount: true, reference: true, referenceType: true },
        })

        const closingRef = closingRefFor(year, month, quarter)
        const already = entries.filter((e: any) => e.referenceType === 'closing' && e.reference?.startsWith(closingRef))
        if (already.length > 0) {
            return res.status(409).json({
                success: false,
                error: `Đã có ${already.length} bút toán kết chuyển cho kỳ ${label}. Xóa bút toán cũ trước khi tạo lại.`,
            })
        }

        const plan = buildClosingPlan(entries, label)
        if (plan.length === 0) {
            return res.status(400).json({ success: false, error: `Không có số dư nào để kết chuyển trong kỳ ${label}` })
        }

        const branchId = getBranchId(req) || null
        const userId = req.user?.userId || null
        const created: any[] = []
        for (let i = 0; i < plan.length; i++) {
            const p = plan[i]!
            try {
                const entry = await prisma.journalEntry.create({
                    data: {
                        date: closingDate, description: p.description,
                        debitAccount: p.debitAccount, debitAccountName: p.debitAccountName,
                        creditAccount: p.creditAccount, creditAccountName: p.creditAccountName,
                        amount: p.amount,
                        reference: `${closingRef}-${pad2(i + 1)}`,
                        referenceType: 'closing', branchId, createdBy: userId,
                    },
                })
                created.push(entry)
            } catch (e) {
                console.error('Failed to create closing entry', p, e)
            }
        }
        res.status(201).json({
            success: true,
            data: { created, periodLabel: label, totalCreated: created.length, totalAmount: created.reduce((s, c) => s + (c.amount || 0), 0) },
        })
    } catch (err: any) {
        console.error('POST /accounting/close-period error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// ─── Year-End Carry Forward ──────────────────────────────────────────────────

// Compute closing balances per account up to `${year}-12-31`, keeping only
// balance-sheet accounts (asset/liability/equity) — P&L accounts net to zero
// after closing and are never carried forward.
async function computeOpeningBalances(prisma: any, year: number) {
    const entries = await prisma.journalEntry.findMany({
        where: { date: { lte: `${year}-12-31` } },
        select: { debitAccount: true, debitAccountName: true, creditAccount: true, creditAccountName: true, amount: true },
    })
    const acc: Record<string, { debit: number; credit: number; name: string }> = {}
    for (const e of entries) {
        if (!acc[e.debitAccount]) acc[e.debitAccount] = { debit: 0, credit: 0, name: e.debitAccountName || accountName(e.debitAccount) }
        if (!acc[e.creditAccount]) acc[e.creditAccount] = { debit: 0, credit: 0, name: e.creditAccountName || accountName(e.creditAccount) }
        acc[e.debitAccount].debit += e.amount
        acc[e.creditAccount].credit += e.amount
    }
    const carry: { code: string; name: string; balance: number; debit: number; credit: number }[] = []
    for (const [code, b] of Object.entries(acc)) {
        const cls = classifyAccount(code)
        if (cls !== 'asset' && cls !== 'liability' && cls !== 'equity') continue // skip P&L
        const balance = b.debit - b.credit // >0 = debit balance, <0 = credit balance
        if (Math.abs(balance) < 1) continue
        carry.push({ code, name: b.name, balance, debit: Math.max(balance, 0), credit: Math.max(-balance, 0) })
    }
    carry.sort((a, b) => a.code.localeCompare(b.code))
    return carry
}

// GET /api/accounting/carry-forward/preview?year=2025
router.get('/carry-forward/preview', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const fromYear = Number(req.query.year) || (new Date().getFullYear() - 1)
        const toYear = fromYear + 1
        const carry = await computeOpeningBalances(prisma, fromYear)
        const totalDebit = carry.reduce((s, c) => s + c.debit, 0)
        const totalCredit = carry.reduce((s, c) => s + c.credit, 0)
        res.json({
            success: true,
            data: { fromYear, toYear, openingDate: `${toYear}-01-01`, accounts: carry, totalDebit, totalCredit, isBalanced: Math.abs(totalDebit - totalCredit) < 1 },
        })
    } catch (err: any) {
        console.error('GET /accounting/carry-forward/preview error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// POST /api/accounting/carry-forward  { year } — create opening balances for year+1
// One balanced opening journal entry per account, dated Jan 1 of the new year,
// posted against TK911-equivalent opening-balance technique: we use a paired
// "số dư đầu kỳ" entry (Nợ TK / Có 4211 for debit balances; Nợ 4211 / Có TK for
// credit balances) so the new year's books open in balance.
router.post('/carry-forward', authMiddleware, requireRole('admin', 'manager', 'superadmin'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const fromYear = Number(req.query.year ?? req.body?.year) || (new Date().getFullYear() - 1)
        const toYear = fromYear + 1
        const openingDate = `${toYear}-01-01`
        const openingRef = `OPENING-${toYear}`

        // Idempotency: refuse if opening entries for the new year already exist.
        const existing = await prisma.journalEntry.findFirst({
            where: { referenceType: 'opening', reference: { startsWith: openingRef } },
            select: { id: true },
        })
        if (existing) {
            return res.status(409).json({ success: false, error: `Đã có số dư đầu kỳ năm ${toYear}. Xóa các bút toán đầu kỳ cũ trước khi tạo lại.` })
        }

        const carry = await computeOpeningBalances(prisma, fromYear)
        if (carry.length === 0) {
            return res.status(400).json({ success: false, error: `Không có số dư nào để chuyển sang năm ${toYear}` })
        }

        const branchId = getBranchId(req) || null
        const userId = req.user?.userId || null
        const OPENING_COUNTER = '4211' // LNST chua phan phoi nam truoc — opening-balance balancing account

        const created: any[] = []
        let i = 0
        for (const c of carry) {
            if (c.code === OPENING_COUNTER) continue // avoid self-referential opening entry
            i++
            const isDebitBalance = c.balance > 0
            const data = isDebitBalance
                ? { debitAccount: c.code, debitAccountName: c.name, creditAccount: OPENING_COUNTER, creditAccountName: accountName(OPENING_COUNTER) }
                : { debitAccount: OPENING_COUNTER, debitAccountName: accountName(OPENING_COUNTER), creditAccount: c.code, creditAccountName: c.name }
            try {
                const entry = await prisma.journalEntry.create({
                    data: {
                        date: openingDate,
                        description: `Số dư đầu kỳ ${toYear} - ${c.code} ${c.name}`,
                        ...data,
                        amount: Math.abs(c.balance),
                        reference: `${openingRef}-${pad2(i)}`,
                        referenceType: 'opening', branchId, createdBy: userId,
                    },
                })
                created.push(entry)
            } catch (e) {
                console.error('Failed to create opening entry', c, e)
            }
        }

        res.status(201).json({
            success: true,
            data: { fromYear, toYear, openingDate, totalCreated: created.length, created },
        })
    } catch (err: any) {
        console.error('POST /accounting/carry-forward error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

export default router
