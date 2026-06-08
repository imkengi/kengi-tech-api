// ─────────────────────────────────────────────────────────────────────────────
//  Tài sản cố định (Fixed Assets — TSCĐ) — Phase 4 — mounted at /api/fixed-assets
//
//  Quản lý TSCĐ hữu hình (211) / vô hình (213) theo TT99/2025:
//    - Khấu hao hàng tháng (đường thẳng / số dư giảm dần)
//    - Bút toán khấu hao:  Nợ 627/641/642  /  Có 214 (hao mòn TSCĐ)
//    - Thanh lý/nhượng bán: Nợ 214, Nợ 811 / Có 211; Nợ 112 / Có 711
//
//  Routes:
//    GET    /                         list (status, category, branch)
//    POST   /                         create
//    GET    /summary                  totals by category
//    POST   /depreciate-all           batch monthly depreciation (?month=&year=)
//    GET    /:id                      single + recent depreciation entries
//    PUT    /:id                      update
//    DELETE /:id                      delete
//    POST   /:id/depreciate           monthly depreciation for one asset
//    GET    /:id/depreciation-schedule  full projected schedule
//    POST   /:id/dispose              disposal / liquidation
// ─────────────────────────────────────────────────────────────────────────────

import { Router, Response } from 'express'
import { authMiddleware, AuthRequest, getBranchId, getBranchFilter } from '../middleware/auth'
import { requireRole } from '../middleware/roleMiddleware'
import { errMsg } from '../lib/errorResponse'

const router = Router()

const num = (v: any) => Math.round(Number(v) || 0)

// Tên tài khoản (cho bút toán) — tra cứu nhanh các TK thường dùng.
const ACCOUNT_NAMES: Record<string, string> = {
    '111': 'Tiền mặt', '112': 'Tiền gửi ngân hàng',
    '211': 'TSCĐ hữu hình', '213': 'TSCĐ vô hình',
    '214': 'Hao mòn TSCĐ', '2141': 'Hao mòn TSCĐ hữu hình', '2143': 'Hao mòn TSCĐ vô hình',
    '627': 'Chi phí sản xuất chung', '641': 'Chi phí bán hàng', '642': 'Chi phí quản lý doanh nghiệp',
    '6274': 'Chi phí khấu hao TSCĐ (SXC)', '6414': 'Chi phí khấu hao TSCĐ (BH)', '6424': 'Chi phí khấu hao TSCĐ (QLDN)',
    '711': 'Thu nhập khác', '811': 'Chi phí khác',
}
const accName = (code: string) => ACCOUNT_NAMES[code] || ''

// ─── Table provisioning (per-schema, cached once per process) ────────────────
const ensuredSchemas = new Set<string>()
async function ensureTables(req: AuthRequest): Promise<void> {
    const prisma = req.storePrisma! as any
    const key = req.user?.branchSchema || req.user?.storeSchema || 'default'
    if (ensuredSchemas.has(key)) return
    try {
        // FixedAsset existed since the TT88 era (tax.ts). Create-if-missing covers
        // fresh schemas; the ALTER block adds the Phase-4 columns to legacy tables.
        await prisma.$executeRawUnsafe(`
            CREATE TABLE IF NOT EXISTS "FixedAsset" (
                "id" TEXT NOT NULL,
                "code" TEXT NOT NULL,
                "name" TEXT NOT NULL,
                "category" TEXT NOT NULL DEFAULT 'tangible',
                "acquisitionDate" TEXT NOT NULL DEFAULT '',
                "originalCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
                "usefulLifeMonths" INTEGER NOT NULL DEFAULT 0,
                "method" TEXT NOT NULL DEFAULT 'straight-line',
                "accumulatedDepreciation" DOUBLE PRECISION NOT NULL DEFAULT 0,
                "netBookValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
                "monthlyDepreciation" DOUBLE PRECISION NOT NULL DEFAULT 0,
                "depreciationAccount" TEXT NOT NULL DEFAULT '6424',
                "residualValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
                "status" TEXT NOT NULL DEFAULT 'active',
                "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT "FixedAsset_pkey" PRIMARY KEY ("id")
            )
        `).catch(() => {})
        const faCols: Array<[string, string]> = [
            ['acquisitionCost', 'DOUBLE PRECISION NOT NULL DEFAULT 0'],
            ['depreciationMethod', `TEXT NOT NULL DEFAULT 'straight_line'`],
            ['accountCode', `TEXT NOT NULL DEFAULT '211'`],
            ['depAccAccountCode', `TEXT NOT NULL DEFAULT '2141'`],
            ['expenseAccountCode', `TEXT NOT NULL DEFAULT '6424'`],
            ['disposalDate', 'TEXT'],
            ['disposalAmount', 'DOUBLE PRECISION'],
            ['department', 'TEXT'],
            ['description', 'TEXT'],
            ['branchId', 'TEXT'],
            ['notes', 'TEXT'],
        ]
        for (const [col, type] of faCols) {
            await prisma.$executeRawUnsafe(`ALTER TABLE "FixedAsset" ADD COLUMN IF NOT EXISTS "${col}" ${type};`).catch(() => {})
        }
        await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "FixedAsset_status_idx" ON "FixedAsset"("status")`).catch(() => {})
        await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "FixedAsset_category_idx" ON "FixedAsset"("category")`).catch(() => {})
        await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "FixedAsset_branchId_idx" ON "FixedAsset"("branchId")`).catch(() => {})

        await prisma.$executeRawUnsafe(`
            CREATE TABLE IF NOT EXISTS "DepreciationEntry" (
                "id" TEXT NOT NULL,
                "assetId" TEXT NOT NULL,
                "month" INTEGER NOT NULL,
                "year" INTEGER NOT NULL,
                "beginningValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
                "depreciationAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
                "accumulatedDepreciation" DOUBLE PRECISION NOT NULL DEFAULT 0,
                "endingValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
                "journalEntryId" TEXT,
                "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT "DepreciationEntry_pkey" PRIMARY KEY ("id")
            )
        `)
        await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "DepreciationEntry_assetId_idx" ON "DepreciationEntry"("assetId")`).catch(() => {})
        await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "DepreciationEntry_year_month_idx" ON "DepreciationEntry"("year","month")`).catch(() => {})
        ensuredSchemas.add(key)
    } catch (e: any) {
        console.error('ensureTables(fixedAssets) error:', e?.message || e)
    }
}

// Net book value (giá trị còn lại) of an asset given its accumulated depreciation.
function netBook(asset: any): number {
    const cost = Number(asset.acquisitionCost ?? asset.originalCost) || 0
    return Math.max(0, cost - (Number(asset.accumulatedDepreciation) || 0))
}

// Khấu hao 1 tháng cho 1 TSCĐ, dựa trên giá trị đầu kỳ (net book value).
function monthlyDepreciation(asset: any, beginningValue: number): number {
    const cost = Number(asset.acquisitionCost ?? asset.originalCost) || 0
    const residual = Number(asset.residualValue) || 0
    const life = Number(asset.usefulLifeMonths) || 0
    if (life <= 0) return 0
    const method = asset.depreciationMethod || asset.method || 'straight_line'
    let dep: number
    if (method === 'declining_balance') {
        // Số dư giảm dần (gấp đôi): tỷ lệ tháng = 2 / số tháng sử dụng.
        dep = beginningValue * (2 / life)
    } else {
        // Đường thẳng: (nguyên giá - giá trị thu hồi) / số tháng.
        dep = Math.max(0, cost - residual) / life
    }
    // Không khấu hao vượt quá giá trị thu hồi.
    if (beginningValue - dep < residual) dep = beginningValue - residual
    return Math.max(0, Math.round(dep))
}

// Tạo bút toán khấu hao + cập nhật TSCĐ + ghi DepreciationEntry cho 1 kỳ.
// Trả về { entry, journal } hoặc { skipped } nếu đã khấu hao kỳ này / đã hết KH.
async function depreciateAssetForPeriod(prisma: any, asset: any, month: number, year: number, branchId: string | null, userId: string | null) {
    if (asset.status !== 'active') return { skipped: true, reason: `Tài sản ở trạng thái ${asset.status}` }
    const existing = await prisma.depreciationEntry.findFirst({ where: { assetId: asset.id, month, year } }).catch(() => null)
    if (existing) return { skipped: true, reason: `Đã khấu hao T${month}/${year}`, entry: existing }

    const beginningValue = netBook(asset)
    const residual = Number(asset.residualValue) || 0
    if (beginningValue <= residual) {
        await prisma.fixedAsset.update({ where: { id: asset.id }, data: { status: 'fully_depreciated', netBookValue: beginningValue } }).catch(() => {})
        return { skipped: true, reason: 'Tài sản đã khấu hao hết' }
    }

    const depreciationAmount = monthlyDepreciation(asset, beginningValue)
    if (depreciationAmount <= 0) return { skipped: true, reason: 'Mức khấu hao tháng = 0' }

    const accumulatedDepreciation = (Number(asset.accumulatedDepreciation) || 0) + depreciationAmount
    const cost = Number(asset.acquisitionCost ?? asset.originalCost) || 0
    const endingValue = Math.max(0, cost - accumulatedDepreciation)

    // Bút toán: Nợ 627/641/642 (chi phí khấu hao) / Có 214 (hao mòn TSCĐ).
    const expenseAcc = asset.expenseAccountCode || asset.depreciationAccount || '6424'
    const depAcc = asset.depAccAccountCode || '2141'
    const date = `${year}-${String(month).padStart(2, '0')}-${String(new Date(year, month, 0).getDate()).padStart(2, '0')}`
    const journal = await prisma.journalEntry.create({
        data: {
            date,
            description: `Khấu hao TSCĐ ${asset.code} - ${asset.name} T${month}/${year}`,
            debitAccount: expenseAcc, debitAccountName: accName(expenseAcc) || 'Chi phí khấu hao',
            creditAccount: depAcc, creditAccountName: accName(depAcc) || 'Hao mòn TSCĐ',
            amount: depreciationAmount,
            reference: `DEP-${asset.code}-${year}${String(month).padStart(2, '0')}`,
            referenceType: 'depreciation', branchId, createdBy: userId,
        },
    }).catch((e: any) => { console.error('depreciation journal error:', e?.message); return null })

    const entry = await prisma.depreciationEntry.create({
        data: {
            assetId: asset.id, month, year,
            beginningValue, depreciationAmount, accumulatedDepreciation, endingValue,
            journalEntryId: journal?.id || null,
        },
    })

    const newStatus = endingValue <= residual ? 'fully_depreciated' : 'active'
    await prisma.fixedAsset.update({
        where: { id: asset.id },
        data: { accumulatedDepreciation, netBookValue: endingValue, status: newStatus },
    }).catch(() => {})

    return { entry, journal, asset: { id: asset.id, accumulatedDepreciation, netBookValue: endingValue, status: newStatus } }
}

// ─── CRUD ────────────────────────────────────────────────────────────────────

// GET /api/fixed-assets
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        await ensureTables(req)
        const prisma = req.storePrisma! as any
        const where: any = { ...getBranchFilter(req) }
        if (req.query.status) where.status = String(req.query.status)
        if (req.query.category) where.category = String(req.query.category)
        const data = await prisma.fixedAsset.findMany({ where, orderBy: { code: 'asc' } })
        res.json({ success: true, data })
    } catch (err: any) {
        console.error('GET /fixed-assets error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// POST /api/fixed-assets
router.post('/', authMiddleware, requireRole('admin', 'manager', 'superadmin'), async (req: AuthRequest, res: Response) => {
    try {
        await ensureTables(req)
        const prisma = req.storePrisma! as any
        const b = req.body || {}
        if (!b.name) return res.status(400).json({ success: false, error: 'Tên tài sản (name) là bắt buộc' })
        const cost = num(b.acquisitionCost ?? b.originalCost)
        if (cost <= 0) return res.status(400).json({ success: false, error: 'Nguyên giá (acquisitionCost) phải > 0' })
        const life = Number(b.usefulLifeMonths) || 0
        if (life <= 0) return res.status(400).json({ success: false, error: 'Thời gian sử dụng (usefulLifeMonths) phải > 0' })

        const code = (b.code || `TS${Date.now().toString().slice(-6)}`).toString().trim()
        const existing = await prisma.fixedAsset.findFirst({ where: { code } }).catch(() => null)
        if (existing) return res.status(409).json({ success: false, error: `Mã tài sản "${code}" đã tồn tại` })

        const category = b.category || 'tangible'
        const residualValue = num(b.residualValue)
        const accountCode = b.accountCode || (category === 'intangible' ? '213' : '211')
        const depAccAccountCode = b.depAccAccountCode || (category === 'intangible' ? '2143' : '2141')
        const expenseAccountCode = b.expenseAccountCode || '6424'
        const depreciationMethod = b.depreciationMethod || b.method || 'straight_line'
        const monthly = monthlyDepreciation(
            { acquisitionCost: cost, residualValue, usefulLifeMonths: life, depreciationMethod },
            cost,
        )

        const data = await prisma.fixedAsset.create({
            data: {
                code, name: String(b.name), category,
                acquisitionDate: b.acquisitionDate || new Date().toISOString().slice(0, 10),
                acquisitionCost: cost, originalCost: cost,
                residualValue, usefulLifeMonths: life,
                depreciationMethod, method: depreciationMethod,
                accountCode, depAccAccountCode, expenseAccountCode,
                depreciationAccount: expenseAccountCode,
                accumulatedDepreciation: 0, netBookValue: cost, monthlyDepreciation: monthly,
                status: 'active',
                department: b.department ?? null, description: b.description ?? null,
                notes: b.notes ?? null, branchId: getBranchId(req) || null,
            },
        })
        res.status(201).json({ success: true, data })
    } catch (err: any) {
        console.error('POST /fixed-assets error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// GET /api/fixed-assets/summary — tổng hợp theo nhóm
router.get('/summary', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        await ensureTables(req)
        const prisma = req.storePrisma! as any
        const assets = await prisma.fixedAsset.findMany({ where: { ...getBranchFilter(req) } })
        const byCategory: Record<string, any> = {}
        let totalCost = 0, totalAccumulated = 0, totalNetBook = 0
        for (const a of assets) {
            const cost = Number(a.acquisitionCost ?? a.originalCost) || 0
            const acc = Number(a.accumulatedDepreciation) || 0
            const nbv = netBook(a)
            const cat = a.category || 'tangible'
            if (!byCategory[cat]) byCategory[cat] = { category: cat, count: 0, totalCost: 0, accumulatedDepreciation: 0, netBookValue: 0 }
            byCategory[cat].count++
            byCategory[cat].totalCost += cost
            byCategory[cat].accumulatedDepreciation += acc
            byCategory[cat].netBookValue += nbv
            totalCost += cost; totalAccumulated += acc; totalNetBook += nbv
        }
        const byStatus: Record<string, number> = {}
        for (const a of assets) byStatus[a.status] = (byStatus[a.status] || 0) + 1
        res.json({
            success: true,
            data: {
                totalAssets: assets.length,
                totalCost, accumulatedDepreciation: totalAccumulated, netBookValue: totalNetBook,
                byCategory: Object.values(byCategory), byStatus,
            },
        })
    } catch (err: any) {
        console.error('GET /fixed-assets/summary error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// POST /api/fixed-assets/depreciate-all?month=&year= — khấu hao hàng loạt
router.post('/depreciate-all', authMiddleware, requireRole('admin', 'manager', 'superadmin'), async (req: AuthRequest, res: Response) => {
    try {
        await ensureTables(req)
        const prisma = req.storePrisma! as any
        const now = new Date()
        const month = Number(req.query.month ?? req.body?.month) || (now.getMonth() + 1)
        const year = Number(req.query.year ?? req.body?.year) || now.getFullYear()
        if (month < 1 || month > 12) return res.status(400).json({ success: false, error: 'month không hợp lệ (1-12)' })

        const branchId = getBranchId(req) || null
        const userId = req.user?.userId || null
        const assets = await prisma.fixedAsset.findMany({ where: { status: 'active', ...getBranchFilter(req) } })

        const results: any[] = []
        let processed = 0, skipped = 0, totalDepreciation = 0
        for (const asset of assets) {
            const r = await depreciateAssetForPeriod(prisma, asset, month, year, branchId, userId)
            if (r.skipped) { skipped++; results.push({ assetId: asset.id, code: asset.code, skipped: true, reason: r.reason }) }
            else {
                processed++
                totalDepreciation += Number(r.entry.depreciationAmount) || 0
                results.push({ assetId: asset.id, code: asset.code, depreciationAmount: r.entry.depreciationAmount, journalEntryId: r.journal?.id || null })
            }
        }
        res.json({ success: true, data: { month, year, processed, skipped, totalDepreciation, results } })
    } catch (err: any) {
        console.error('POST /fixed-assets/depreciate-all error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// GET /api/fixed-assets/:id — chi tiết + lịch sử khấu hao gần đây
router.get('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        await ensureTables(req)
        const prisma = req.storePrisma! as any
        const asset = await prisma.fixedAsset.findUnique({ where: { id: String(req.params.id) } }).catch(() => null)
        if (!asset) return res.status(404).json({ success: false, error: 'Không tìm thấy tài sản' })
        const depreciationEntries = await prisma.depreciationEntry.findMany({
            where: { assetId: asset.id }, orderBy: [{ year: 'desc' }, { month: 'desc' }], take: 24,
        }).catch(() => [])
        res.json({ success: true, data: { ...asset, netBookValue: netBook(asset), depreciationEntries } })
    } catch (err: any) {
        console.error('GET /fixed-assets/:id error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// PUT /api/fixed-assets/:id
router.put('/:id', authMiddleware, requireRole('admin', 'manager', 'superadmin'), async (req: AuthRequest, res: Response) => {
    try {
        await ensureTables(req)
        const prisma = req.storePrisma! as any
        const id = String(req.params.id)
        const asset = await prisma.fixedAsset.findUnique({ where: { id } }).catch(() => null)
        if (!asset) return res.status(404).json({ success: false, error: 'Không tìm thấy tài sản' })
        const b = req.body || {}
        const data: any = {}
        for (const f of ['name', 'category', 'acquisitionDate', 'accountCode', 'depAccAccountCode', 'expenseAccountCode', 'department', 'description', 'notes', 'status']) {
            if (b[f] !== undefined) data[f] = b[f]
        }
        if (b.depreciationMethod !== undefined) { data.depreciationMethod = b.depreciationMethod; data.method = b.depreciationMethod }
        if (b.expenseAccountCode !== undefined) data.depreciationAccount = b.expenseAccountCode
        if (b.residualValue !== undefined) data.residualValue = num(b.residualValue)
        if (b.usefulLifeMonths !== undefined) data.usefulLifeMonths = Number(b.usefulLifeMonths) || 0
        if (b.acquisitionCost !== undefined) { data.acquisitionCost = num(b.acquisitionCost); data.originalCost = num(b.acquisitionCost) }
        if (b.code !== undefined && b.code !== asset.code) {
            const dup = await prisma.fixedAsset.findFirst({ where: { code: String(b.code) } }).catch(() => null)
            if (dup) return res.status(409).json({ success: false, error: `Mã tài sản "${b.code}" đã tồn tại` })
            data.code = String(b.code)
        }
        // Recompute net book value + monthly depreciation when cost/life/residual change.
        const merged = { ...asset, ...data }
        data.netBookValue = netBook(merged)
        data.monthlyDepreciation = monthlyDepreciation(merged, netBook(merged))
        const updated = await prisma.fixedAsset.update({ where: { id }, data })
        res.json({ success: true, data: updated })
    } catch (err: any) {
        console.error('PUT /fixed-assets/:id error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// DELETE /api/fixed-assets/:id
router.delete('/:id', authMiddleware, requireRole('admin', 'manager', 'superadmin'), async (req: AuthRequest, res: Response) => {
    try {
        await ensureTables(req)
        const prisma = req.storePrisma! as any
        const id = String(req.params.id)
        const asset = await prisma.fixedAsset.findUnique({ where: { id } }).catch(() => null)
        if (!asset) return res.status(404).json({ success: false, error: 'Không tìm thấy tài sản' })
        await prisma.depreciationEntry.deleteMany({ where: { assetId: id } }).catch(() => {})
        await prisma.fixedAsset.delete({ where: { id } })
        res.json({ success: true, data: { id, deleted: true } })
    } catch (err: any) {
        console.error('DELETE /fixed-assets/:id error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// POST /api/fixed-assets/:id/depreciate — khấu hao 1 tháng cho 1 tài sản
router.post('/:id/depreciate', authMiddleware, requireRole('admin', 'manager', 'superadmin'), async (req: AuthRequest, res: Response) => {
    try {
        await ensureTables(req)
        const prisma = req.storePrisma! as any
        const asset = await prisma.fixedAsset.findUnique({ where: { id: String(req.params.id) } }).catch(() => null)
        if (!asset) return res.status(404).json({ success: false, error: 'Không tìm thấy tài sản' })
        const now = new Date()
        const month = Number(req.query.month ?? req.body?.month) || (now.getMonth() + 1)
        const year = Number(req.query.year ?? req.body?.year) || now.getFullYear()
        if (month < 1 || month > 12) return res.status(400).json({ success: false, error: 'month không hợp lệ (1-12)' })

        const r = await depreciateAssetForPeriod(prisma, asset, month, year, getBranchId(req) || null, req.user?.userId || null)
        if (r.skipped) return res.status(400).json({ success: false, error: r.reason, data: r.entry || null })
        res.json({ success: true, data: { entry: r.entry, journalEntry: r.journal, asset: r.asset } })
    } catch (err: any) {
        console.error('POST /fixed-assets/:id/depreciate error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// GET /api/fixed-assets/:id/depreciation-schedule — lịch khấu hao đầy đủ (dự kiến)
router.get('/:id/depreciation-schedule', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        await ensureTables(req)
        const prisma = req.storePrisma! as any
        const asset = await prisma.fixedAsset.findUnique({ where: { id: String(req.params.id) } }).catch(() => null)
        if (!asset) return res.status(404).json({ success: false, error: 'Không tìm thấy tài sản' })

        const cost = Number(asset.acquisitionCost ?? asset.originalCost) || 0
        const residual = Number(asset.residualValue) || 0
        const life = Number(asset.usefulLifeMonths) || 0
        const schedule: any[] = []
        let beginningValue = cost
        let accumulated = 0
        // Tháng bắt đầu khấu hao = tháng kế tiếp ngày ghi tăng (đơn giản hóa: từ acquisitionDate).
        const start = asset.acquisitionDate ? new Date(asset.acquisitionDate) : new Date()
        let m = (start.getMonth() + 1), y = start.getFullYear()
        for (let i = 0; i < life && beginningValue > residual; i++) {
            const dep = monthlyDepreciation(asset, beginningValue)
            if (dep <= 0) break
            accumulated += dep
            const endingValue = Math.max(0, cost - accumulated)
            schedule.push({ period: `${y}-${String(m).padStart(2, '0')}`, month: m, year: y, beginningValue, depreciationAmount: dep, accumulatedDepreciation: accumulated, endingValue })
            beginningValue = endingValue
            m++; if (m > 12) { m = 1; y++ }
        }
        res.json({ success: true, data: { assetId: asset.id, code: asset.code, name: asset.name, method: asset.depreciationMethod || asset.method, totalPeriods: schedule.length, schedule } })
    } catch (err: any) {
        console.error('GET /fixed-assets/:id/depreciation-schedule error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// POST /api/fixed-assets/:id/dispose — thanh lý / nhượng bán TSCĐ
// Body: { disposalDate?, disposalAmount? }
router.post('/:id/dispose', authMiddleware, requireRole('admin', 'manager', 'superadmin'), async (req: AuthRequest, res: Response) => {
    try {
        await ensureTables(req)
        const prisma = req.storePrisma! as any
        const id = String(req.params.id)
        const asset = await prisma.fixedAsset.findUnique({ where: { id } }).catch(() => null)
        if (!asset) return res.status(404).json({ success: false, error: 'Không tìm thấy tài sản' })
        if (asset.status === 'disposed') return res.status(400).json({ success: false, error: 'Tài sản đã được thanh lý' })

        const b = req.body || {}
        const disposalDate = b.disposalDate || new Date().toISOString().slice(0, 10)
        const disposalAmount = num(b.disposalAmount)
        const branchId = getBranchId(req) || null
        const userId = req.user?.userId || null

        const cost = Number(asset.acquisitionCost ?? asset.originalCost) || 0
        const accumulated = Number(asset.accumulatedDepreciation) || 0
        const remainingNbv = Math.max(0, cost - accumulated)
        const assetAcc = asset.accountCode || (asset.category === 'intangible' ? '213' : '211')
        const depAcc = asset.depAccAccountCode || '2141'
        const ref = `DISPOSE-${asset.code}`
        const journals: any[] = []

        const mkJournal = async (debit: string, credit: string, amount: number, desc: string) => {
            if (amount <= 0) return
            const j = await prisma.journalEntry.create({
                data: {
                    date: disposalDate, description: desc,
                    debitAccount: debit, debitAccountName: accName(debit),
                    creditAccount: credit, creditAccountName: accName(credit),
                    amount, reference: ref, referenceType: 'asset_disposal', branchId, createdBy: userId,
                },
            }).catch((e: any) => { console.error('disposal journal error:', e?.message); return null })
            if (j) journals.push(j)
        }

        // 1) Xóa giá trị hao mòn lũy kế: Nợ 214 / Có 211 (213).
        await mkJournal(depAcc, assetAcc, accumulated, `Thanh lý TSCĐ ${asset.code} - kết chuyển hao mòn`)
        // 2) Kết chuyển giá trị còn lại vào chi phí khác: Nợ 811 / Có 211 (213).
        await mkJournal('811', assetAcc, remainingNbv, `Thanh lý TSCĐ ${asset.code} - giá trị còn lại`)
        // 3) Thu từ thanh lý (nếu có): Nợ 112 / Có 711.
        await mkJournal('112', '711', disposalAmount, `Thu thanh lý TSCĐ ${asset.code}`)

        const updated = await prisma.fixedAsset.update({
            where: { id },
            data: { status: 'disposed', disposalDate, disposalAmount, netBookValue: 0 },
        })
        res.json({ success: true, data: { asset: updated, journalEntries: journals, netBookValueWrittenOff: remainingNbv, proceeds: disposalAmount } })
    } catch (err: any) {
        console.error('POST /fixed-assets/:id/dispose error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

export default router
