// ─────────────────────────────────────────────────────────────────────────────
//  Công cụ dụng cụ (CCDC) — Phase 4 — mounted at /api/ccdc
//
//  Phân bổ CCDC (TK 153/242) vào chi phí theo TT99/2025:
//    - Phân bổ dần hàng tháng theo số kỳ.
//    - Bút toán phân bổ:  Nợ 627/641/642  /  Có 242 (chi phí trả trước).
//
//  Routes:
//    GET    /                     list (status, category, branch)
//    POST   /                     create
//    GET    /summary              tổng hợp
//    POST   /allocate-all         phân bổ hàng loạt (?month=&year=)
//    GET    /:id                  chi tiết + lịch sử phân bổ
//    PUT    /:id                  update
//    DELETE /:id                  delete
//    POST   /:id/allocate         phân bổ 1 tháng cho 1 CCDC
//    GET    /:id/allocation-history  lịch sử phân bổ
// ─────────────────────────────────────────────────────────────────────────────

import { Router, Response } from 'express'
import { authMiddleware, AuthRequest, getBranchId, getBranchFilter } from '../middleware/auth'
import { requireRole } from '../middleware/roleMiddleware'
import { errMsg } from '../lib/errorResponse'

const router = Router()

const num = (v: any) => Math.round(Number(v) || 0)

const ACCOUNT_NAMES: Record<string, string> = {
    '111': 'Tiền mặt', '112': 'Tiền gửi ngân hàng',
    '153': 'Công cụ, dụng cụ', '242': 'Chi phí trả trước',
    '627': 'Chi phí sản xuất chung', '641': 'Chi phí bán hàng', '642': 'Chi phí quản lý doanh nghiệp',
}
const accName = (code: string) => ACCOUNT_NAMES[code] || ''

// ─── Table provisioning (per-schema, cached once per process) ────────────────
const ensuredSchemas = new Set<string>()
async function ensureTables(req: AuthRequest): Promise<void> {
    const prisma = req.storePrisma! as any
    const key = req.user?.branchSchema || req.user?.storeSchema || 'default'
    if (ensuredSchemas.has(key)) return
    try {
        await prisma.$executeRawUnsafe(`
            CREATE TABLE IF NOT EXISTS "CCDC" (
                "id" TEXT NOT NULL,
                "code" TEXT NOT NULL,
                "name" TEXT NOT NULL,
                "category" TEXT,
                "acquisitionDate" TEXT,
                "totalValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
                "allocationMonths" INTEGER NOT NULL DEFAULT 1,
                "monthlyAllocation" DOUBLE PRECISION NOT NULL DEFAULT 0,
                "allocatedAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
                "remainingAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
                "accountCode" TEXT NOT NULL DEFAULT '242',
                "expenseAccountCode" TEXT NOT NULL DEFAULT '642',
                "status" TEXT NOT NULL DEFAULT 'allocating',
                "branchId" TEXT,
                "notes" TEXT,
                "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT "CCDC_pkey" PRIMARY KEY ("id")
            )
        `)
        await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "CCDC_status_idx" ON "CCDC"("status")`).catch(() => {})
        await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "CCDC_branchId_idx" ON "CCDC"("branchId")`).catch(() => {})

        await prisma.$executeRawUnsafe(`
            CREATE TABLE IF NOT EXISTS "CCDCAllocation" (
                "id" TEXT NOT NULL,
                "ccdcId" TEXT NOT NULL,
                "month" INTEGER NOT NULL,
                "year" INTEGER NOT NULL,
                "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
                "journalEntryId" TEXT,
                "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT "CCDCAllocation_pkey" PRIMARY KEY ("id")
            )
        `)
        await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "CCDCAllocation_ccdcId_idx" ON "CCDCAllocation"("ccdcId")`).catch(() => {})
        await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "CCDCAllocation_year_month_idx" ON "CCDCAllocation"("year","month")`).catch(() => {})
        ensuredSchemas.add(key)
    } catch (e: any) {
        console.error('ensureTables(ccdc) error:', e?.message || e)
    }
}

// Phân bổ 1 tháng cho 1 CCDC. Trả về { allocation, journal } hoặc { skipped }.
export async function allocateForPeriod(prisma: any, ccdc: any, month: number, year: number, branchId: string | null, userId: string | null) {
    if (ccdc.status !== 'allocating') return { skipped: true, reason: `CCDC ở trạng thái ${ccdc.status}` }
    /* Chốt "đã phân bổ kỳ này chưa". Nuốt lỗi đọc ⇒ tưởng chưa ⇒ phân bổ CCDC lần hai cho cùng
     * tháng: chi phí đội lên và remainingAmount bị trừ hai lần (20/08/2026). */
    const existing = await prisma.cCDCAllocation.findFirst({ where: { ccdcId: ccdc.id, month, year } })
    if (existing) return { skipped: true, reason: `Đã phân bổ T${month}/${year}`, allocation: existing }

    const remaining = Number(ccdc.remainingAmount) || 0
    if (remaining <= 0) {
        await prisma.cCDC.update({ where: { id: ccdc.id }, data: { status: 'fully_allocated', remainingAmount: 0 } }).catch(() => {})
        return { skipped: true, reason: 'CCDC đã phân bổ hết' }
    }
    const monthly = Number(ccdc.monthlyAllocation) || 0
    const amount = Math.min(monthly > 0 ? monthly : remaining, remaining)
    if (amount <= 0) return { skipped: true, reason: 'Mức phân bổ tháng = 0' }

    const allocatedAmount = (Number(ccdc.allocatedAmount) || 0) + amount
    const remainingAmount = Math.max(0, remaining - amount)

    // Bút toán: Nợ 627/641/642 / Có 242 (chi phí trả trước).
    const expenseAcc = ccdc.expenseAccountCode || '642'
    const sourceAcc = ccdc.accountCode || '242'
    const date = `${year}-${String(month).padStart(2, '0')}-${String(new Date(year, month, 0).getDate()).padStart(2, '0')}`
    const journal = await prisma.journalEntry.create({
        data: {
            date,
            description: `Phân bổ CCDC ${ccdc.code} - ${ccdc.name} T${month}/${year}`,
            debitAccount: expenseAcc, debitAccountName: accName(expenseAcc) || 'Chi phí',
            creditAccount: sourceAcc, creditAccountName: accName(sourceAcc) || 'Chi phí trả trước',
            amount,
            reference: `CCDC-${ccdc.code}-${year}${String(month).padStart(2, '0')}`,
            referenceType: 'ccdc_allocation', branchId, createdBy: userId,
        },
    }).catch((e: any) => { console.error('ccdc journal error:', e?.message); return null })

    const allocation = await prisma.cCDCAllocation.create({
        data: { ccdcId: ccdc.id, month, year, amount, journalEntryId: journal?.id || null },
    })

    const newStatus = remainingAmount <= 0 ? 'fully_allocated' : 'allocating'
    await prisma.cCDC.update({
        where: { id: ccdc.id },
        data: { allocatedAmount, remainingAmount, status: newStatus },
    }).catch(() => {})

    return { allocation, journal, ccdc: { id: ccdc.id, allocatedAmount, remainingAmount, status: newStatus } }
}

// ─── CRUD ────────────────────────────────────────────────────────────────────

// GET /api/ccdc
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        await ensureTables(req)
        const prisma = req.storePrisma! as any
        const where: any = { ...getBranchFilter(req) }
        if (req.query.status) where.status = String(req.query.status)
        if (req.query.category) where.category = String(req.query.category)
        const data = await prisma.cCDC.findMany({ where, orderBy: { code: 'asc' } })
        res.json({ success: true, data })
    } catch (err: any) {
        console.error('GET /ccdc error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// POST /api/ccdc
router.post('/', authMiddleware, requireRole('admin', 'manager', 'superadmin'), async (req: AuthRequest, res: Response) => {
    try {
        await ensureTables(req)
        const prisma = req.storePrisma! as any
        const b = req.body || {}
        if (!b.name) return res.status(400).json({ success: false, error: 'Tên CCDC (name) là bắt buộc' })
        const totalValue = num(b.totalValue)
        if (totalValue <= 0) return res.status(400).json({ success: false, error: 'Tổng giá trị (totalValue) phải > 0' })
        const allocationMonths = Number(b.allocationMonths) || 1
        if (allocationMonths < 1) return res.status(400).json({ success: false, error: 'Số kỳ phân bổ (allocationMonths) phải >= 1' })

        const code = (b.code || `CC${Date.now().toString().slice(-6)}`).toString().trim()
        const existing = await prisma.cCDC.findFirst({ where: { code } }).catch(() => null)
        if (existing) return res.status(409).json({ success: false, error: `Mã CCDC "${code}" đã tồn tại` })

        const monthlyAllocation = Math.round(totalValue / allocationMonths)
        const data = await prisma.cCDC.create({
            data: {
                code, name: String(b.name), category: b.category ?? null,
                acquisitionDate: b.acquisitionDate || new Date().toISOString().slice(0, 10),
                totalValue, allocationMonths, monthlyAllocation,
                allocatedAmount: 0, remainingAmount: totalValue,
                accountCode: b.accountCode || '242',
                expenseAccountCode: b.expenseAccountCode || '642',
                status: 'allocating',
                notes: b.notes ?? null, branchId: getBranchId(req) || null,
            },
        })
        res.status(201).json({ success: true, data })
    } catch (err: any) {
        console.error('POST /ccdc error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// GET /api/ccdc/summary
router.get('/summary', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        await ensureTables(req)
        const prisma = req.storePrisma! as any
        const items = await prisma.cCDC.findMany({ where: { ...getBranchFilter(req) } })
        let totalValue = 0, allocated = 0, remaining = 0
        const byStatus: Record<string, number> = {}
        for (const c of items) {
            totalValue += Number(c.totalValue) || 0
            allocated += Number(c.allocatedAmount) || 0
            remaining += Number(c.remainingAmount) || 0
            byStatus[c.status] = (byStatus[c.status] || 0) + 1
        }
        res.json({ success: true, data: { totalItems: items.length, totalValue, allocatedAmount: allocated, remainingAmount: remaining, byStatus } })
    } catch (err: any) {
        console.error('GET /ccdc/summary error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// POST /api/ccdc/allocate-all?month=&year=
router.post('/allocate-all', authMiddleware, requireRole('admin', 'manager', 'superadmin'), async (req: AuthRequest, res: Response) => {
    try {
        await ensureTables(req)
        const prisma = req.storePrisma! as any
        const now = new Date()
        const month = Number(req.query.month ?? req.body?.month) || (now.getMonth() + 1)
        const year = Number(req.query.year ?? req.body?.year) || now.getFullYear()
        if (month < 1 || month > 12) return res.status(400).json({ success: false, error: 'month không hợp lệ (1-12)' })

        const branchId = getBranchId(req) || null
        const userId = req.user?.userId || null
        const items = await prisma.cCDC.findMany({ where: { status: 'allocating', ...getBranchFilter(req) } })

        const results: any[] = []
        let processed = 0, skipped = 0, totalAllocated = 0
        for (const ccdc of items) {
            const r = await allocateForPeriod(prisma, ccdc, month, year, branchId, userId)
            if (r.skipped) { skipped++; results.push({ ccdcId: ccdc.id, code: ccdc.code, skipped: true, reason: r.reason }) }
            else {
                processed++
                totalAllocated += Number(r.allocation.amount) || 0
                results.push({ ccdcId: ccdc.id, code: ccdc.code, amount: r.allocation.amount, journalEntryId: r.journal?.id || null })
            }
        }
        res.json({ success: true, data: { month, year, processed, skipped, totalAllocated, results } })
    } catch (err: any) {
        console.error('POST /ccdc/allocate-all error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// GET /api/ccdc/:id
router.get('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        await ensureTables(req)
        const prisma = req.storePrisma! as any
        const ccdc = await prisma.cCDC.findUnique({ where: { id: String(req.params.id) } }).catch(() => null)
        if (!ccdc) return res.status(404).json({ success: false, error: 'Không tìm thấy CCDC' })
        const allocations = await prisma.cCDCAllocation.findMany({
            where: { ccdcId: ccdc.id }, orderBy: [{ year: 'desc' }, { month: 'desc' }], take: 24,
        }).catch(() => [])
        res.json({ success: true, data: { ...ccdc, allocations } })
    } catch (err: any) {
        console.error('GET /ccdc/:id error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// PUT /api/ccdc/:id
router.put('/:id', authMiddleware, requireRole('admin', 'manager', 'superadmin'), async (req: AuthRequest, res: Response) => {
    try {
        await ensureTables(req)
        const prisma = req.storePrisma! as any
        const id = String(req.params.id)
        const ccdc = await prisma.cCDC.findUnique({ where: { id } }).catch(() => null)
        if (!ccdc) return res.status(404).json({ success: false, error: 'Không tìm thấy CCDC' })
        const b = req.body || {}
        const data: any = {}
        for (const f of ['name', 'category', 'acquisitionDate', 'accountCode', 'expenseAccountCode', 'notes', 'status']) {
            if (b[f] !== undefined) data[f] = b[f]
        }
        // Cho phép điều chỉnh giá trị/số kỳ khi chưa phân bổ xong → tính lại mức tháng + còn lại.
        let recompute = false
        let totalValue = Number(ccdc.totalValue) || 0
        let allocationMonths = Number(ccdc.allocationMonths) || 1
        if (b.totalValue !== undefined) { totalValue = num(b.totalValue); data.totalValue = totalValue; recompute = true }
        if (b.allocationMonths !== undefined) { allocationMonths = Number(b.allocationMonths) || 1; data.allocationMonths = allocationMonths; recompute = true }
        if (recompute) {
            const allocated = Number(ccdc.allocatedAmount) || 0
            data.monthlyAllocation = Math.round(totalValue / Math.max(1, allocationMonths))
            data.remainingAmount = Math.max(0, totalValue - allocated)
            if (data.remainingAmount <= 0) data.status = 'fully_allocated'
        }
        if (b.code !== undefined && b.code !== ccdc.code) {
            const dup = await prisma.cCDC.findFirst({ where: { code: String(b.code) } }).catch(() => null)
            if (dup) return res.status(409).json({ success: false, error: `Mã CCDC "${b.code}" đã tồn tại` })
            data.code = String(b.code)
        }
        const updated = await prisma.cCDC.update({ where: { id }, data })
        res.json({ success: true, data: updated })
    } catch (err: any) {
        console.error('PUT /ccdc/:id error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// DELETE /api/ccdc/:id
router.delete('/:id', authMiddleware, requireRole('admin', 'manager', 'superadmin'), async (req: AuthRequest, res: Response) => {
    try {
        await ensureTables(req)
        const prisma = req.storePrisma! as any
        const id = String(req.params.id)
        const ccdc = await prisma.cCDC.findUnique({ where: { id } }).catch(() => null)
        if (!ccdc) return res.status(404).json({ success: false, error: 'Không tìm thấy CCDC' })
        await prisma.cCDCAllocation.deleteMany({ where: { ccdcId: id } }).catch(() => {})
        await prisma.cCDC.delete({ where: { id } })
        res.json({ success: true, data: { id, deleted: true } })
    } catch (err: any) {
        console.error('DELETE /ccdc/:id error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// POST /api/ccdc/:id/allocate — phân bổ 1 tháng cho 1 CCDC
router.post('/:id/allocate', authMiddleware, requireRole('admin', 'manager', 'superadmin'), async (req: AuthRequest, res: Response) => {
    try {
        await ensureTables(req)
        const prisma = req.storePrisma! as any
        const ccdc = await prisma.cCDC.findUnique({ where: { id: String(req.params.id) } }).catch(() => null)
        if (!ccdc) return res.status(404).json({ success: false, error: 'Không tìm thấy CCDC' })
        const now = new Date()
        const month = Number(req.query.month ?? req.body?.month) || (now.getMonth() + 1)
        const year = Number(req.query.year ?? req.body?.year) || now.getFullYear()
        if (month < 1 || month > 12) return res.status(400).json({ success: false, error: 'month không hợp lệ (1-12)' })

        const r = await allocateForPeriod(prisma, ccdc, month, year, getBranchId(req) || null, req.user?.userId || null)
        if (r.skipped) return res.status(400).json({ success: false, error: r.reason, data: r.allocation || null })
        res.json({ success: true, data: { allocation: r.allocation, journalEntry: r.journal, ccdc: r.ccdc } })
    } catch (err: any) {
        console.error('POST /ccdc/:id/allocate error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// GET /api/ccdc/:id/allocation-history
router.get('/:id/allocation-history', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        await ensureTables(req)
        const prisma = req.storePrisma! as any
        const ccdc = await prisma.cCDC.findUnique({ where: { id: String(req.params.id) } }).catch(() => null)
        if (!ccdc) return res.status(404).json({ success: false, error: 'Không tìm thấy CCDC' })
        const allocations = await prisma.cCDCAllocation.findMany({ where: { ccdcId: ccdc.id }, orderBy: [{ year: 'desc' }, { month: 'desc' }] })
        res.json({ success: true, data: allocations })
    } catch (err: any) {
        console.error('GET /ccdc/:id/allocation-history error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

export default router
