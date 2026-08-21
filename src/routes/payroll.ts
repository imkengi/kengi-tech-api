import { Router, Response } from 'express'
import { authMiddleware, AuthRequest, getBranchId, getBranchFilter } from '../middleware/auth'
import { requireRole } from '../middleware/roleMiddleware'
import { errMsg } from '../lib/errorResponse'
import { cacheGet, cacheSet, cacheDel } from '../lib/cache'

const router = Router()

// GET /api/payroll?year=2024&month=2
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const schema = req.user?.storeSchema || 'default'
        const cacheKey = `${schema}:payroll:${JSON.stringify(req.query)}`
        const cached = await cacheGet(cacheKey)
        if (cached) return res.json(cached)
        const prisma = req.storePrisma!
        const { year, month } = req.query
        const where: any = {}
        if (year) where.year = Number(year)
        if (month) where.month = Number(month)

        const records = await (prisma as any).payrollRecord.findMany({
            where,
            orderBy: [{ year: 'desc' }, { month: 'desc' }, { employeeName: 'asc' }],
        })
        const _response = { success: true, data: records }
        await cacheSet(cacheKey, _response, 300)
        res.json(_response)
    } catch (err) {
        console.error('Get payroll error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// GET /api/payroll/history — list distinct months that have payroll records
router.get('/history', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const records = await (prisma as any).payrollRecord.findMany({
            select: { year: true, month: true, status: true },
            orderBy: [{ year: 'desc' }, { month: 'desc' }],
            distinct: ['year', 'month'],
        })
        res.json({ success: true, data: records })
    } catch (err) {
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// POST /api/payroll — save/upsert a full payroll run for a month
router.post('/', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { year, month, rows } = req.body

        if (!year || !month || !Array.isArray(rows) || rows.length === 0) {
            return res.status(400).json({ success: false, error: 'year, month and rows required' })
        }

        // Upsert each row (unique by employeeId+year+month)
        const results = await Promise.all(
            rows.map((row: any) =>
                prisma.payrollRecord.upsert({
                    where: {
                        employeeId_year_month: {
                            employeeId: row.id,
                            year: Number(year),
                            month: Number(month),
                        },
                    },
                    create: {
                        year: Number(year),
                        month: Number(month),
                        employeeId: row.id,
                        employeeName: row.name,
                        employeeCode: row.code || null,
                        department: row.department || null,
                        grossSalary: row.grossSalary || 0,
                        workdays: row.workdays || 26,
                        actualDays: row.actualDays || 26,
                        bonus: row.bonus || 0,
                        actualGross: row.actualGross || 0,
                        bhxh_emp: row.bhxh_emp || 0,
                        bhyt_emp: row.bhyt_emp || 0,
                        bhtn_emp: row.bhtn_emp || 0,
                        bhxh_er: row.bhxh_er || 0,
                        bhyt_er: row.bhyt_er || 0,
                        bhtn_er: row.bhtn_er || 0,
                        pit: row.pit || 0,
                        netSalary: row.netSalary || 0,
                        totalCost: row.totalCost || 0,
                        dependents: row.dependents || 0,
                        status: row.status || 'draft',
                    },
                    update: {
                        employeeName: row.name,
                        employeeCode: row.code || null,
                        department: row.department || null,
                        grossSalary: row.grossSalary || 0,
                        workdays: row.workdays || 26,
                        actualDays: row.actualDays || 26,
                        bonus: row.bonus || 0,
                        actualGross: row.actualGross || 0,
                        bhxh_emp: row.bhxh_emp || 0,
                        bhyt_emp: row.bhyt_emp || 0,
                        bhtn_emp: row.bhtn_emp || 0,
                        bhxh_er: row.bhxh_er || 0,
                        bhyt_er: row.bhyt_er || 0,
                        bhtn_er: row.bhtn_er || 0,
                        pit: row.pit || 0,
                        netSalary: row.netSalary || 0,
                        totalCost: row.totalCost || 0,
                        dependents: row.dependents || 0,
                        status: row.status || 'draft',
                    },
                })
            )
        )

        res.json({ success: true, data: results, count: results.length })
    } catch (err) {
        console.error('Save payroll error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// PUT /api/payroll/:id/status — mark as paid/pending/draft
router.put('/:id/status', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { status } = req.body
        if (!['draft', 'pending', 'paid'].includes(status)) {
            return res.status(400).json({ success: false, error: 'Invalid status' })
        }
        const record = await (prisma as any).payrollRecord.update({
            where: { id: String(req.params.id) },
            data: {
                status,
                paidAt: status === 'paid' ? new Date() : null,
            },
        })
        res.json({ success: true, data: record })
    } catch (err) {
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// PUT /api/payroll/bulk-status — mark all rows for a month as paid
router.put('/bulk-status', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { year, month, status } = req.body
        if (!year || !month || !status) return res.status(400).json({ success: false, error: 'year, month, status required' })

        const result = await (prisma as any).payrollRecord.updateMany({
            where: { year: Number(year), month: Number(month) },
            data: {
                status,
                paidAt: status === 'paid' ? new Date() : undefined,
            },
        })
        res.json({ success: true, count: result.count })
    } catch (err) {
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ═════════════════════════════════════════════════════════════════════════════
//  Phase 4 — Tiền lương (rich model): Employee + PayrollPeriod + PayrollEntry
//
//  Flow: draft ──calculate──▶ entries ──confirm──▶ confirmed ──pay──▶ paid
//  Pay generates journal: Nợ 334 (Phải trả người LĐ) / Có 112 (Tiền gửi NH).
//
//  PIT (thuế TNCN) — biểu thuế lũy tiến từng phần:
//    0-5M:5% 5-10M:10% 10-18M:15% 18-32M:20% 32-52M:25% 52-80M:30% >80M:35%
//  Giảm trừ: bản thân 11.000.000đ; mỗi người phụ thuộc 4.400.000đ.
//  BHXH/BHYT/BHTN: người LĐ 8%/1.5%/1%; người SDLĐ 17.5%/3%/1%.
// ═════════════════════════════════════════════════════════════════════════════

const PERSONAL_DEDUCTION = 11_000_000
const DEPENDENT_DEDUCTION = 4_400_000
const BHXH_EMP = 0.08, BHYT_EMP = 0.015, BHTN_EMP = 0.01
const BHXH_ER = 0.175, BHYT_ER = 0.03, BHTN_ER = 0.01
const pround = (v: any) => Math.round(Number(v) || 0)

// ─── Table provisioning (per-schema, cached once per process) ────────────────
const ensuredPayrollSchemas = new Set<string>()
async function ensurePayrollTables(req: AuthRequest): Promise<void> {
    const prisma = req.storePrisma! as any
    const key = req.user?.branchSchema || req.user?.storeSchema || 'default'
    if (ensuredPayrollSchemas.has(key)) return
    try {
        await prisma.$executeRawUnsafe(`
            CREATE TABLE IF NOT EXISTS "Employee" (
                "id" TEXT NOT NULL, "code" TEXT NOT NULL, "name" TEXT NOT NULL,
                "position" TEXT, "department" TEXT,
                "baseSalary" DOUBLE PRECISION NOT NULL DEFAULT 0,
                "bankAccount" TEXT, "bankName" TEXT, "taxCode" TEXT,
                "socialInsuranceNo" TEXT, "startDate" TEXT, "endDate" TEXT,
                "status" TEXT NOT NULL DEFAULT 'active',
                "dependents" INTEGER NOT NULL DEFAULT 0,
                "notes" TEXT, "branchId" TEXT,
                "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
            )
        `)
        await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Employee_status_idx" ON "Employee"("status")`).catch(() => {})
        await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Employee_code_idx" ON "Employee"("code")`).catch(() => {})
        await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Employee_branchId_idx" ON "Employee"("branchId")`).catch(() => {})

        await prisma.$executeRawUnsafe(`
            CREATE TABLE IF NOT EXISTS "PayrollPeriod" (
                "id" TEXT NOT NULL, "month" INTEGER NOT NULL, "year" INTEGER NOT NULL,
                "status" TEXT NOT NULL DEFAULT 'draft',
                "totalGross" DOUBLE PRECISION NOT NULL DEFAULT 0,
                "totalDeductions" DOUBLE PRECISION NOT NULL DEFAULT 0,
                "totalNet" DOUBLE PRECISION NOT NULL DEFAULT 0,
                "notes" TEXT, "branchId" TEXT, "createdBy" TEXT,
                "confirmedAt" TIMESTAMP(3), "paidAt" TIMESTAMP(3),
                "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT "PayrollPeriod_pkey" PRIMARY KEY ("id")
            )
        `)
        await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "PayrollPeriod_status_idx" ON "PayrollPeriod"("status")`).catch(() => {})
        await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "PayrollPeriod_year_month_idx" ON "PayrollPeriod"("year","month")`).catch(() => {})
        await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "PayrollPeriod_branchId_idx" ON "PayrollPeriod"("branchId")`).catch(() => {})

        await prisma.$executeRawUnsafe(`
            CREATE TABLE IF NOT EXISTS "PayrollEntry" (
                "id" TEXT NOT NULL, "periodId" TEXT NOT NULL, "employeeId" TEXT NOT NULL,
                "employeeCode" TEXT, "employeeName" TEXT,
                "workDays" DOUBLE PRECISION NOT NULL DEFAULT 0,
                "baseSalary" DOUBLE PRECISION NOT NULL DEFAULT 0,
                "allowances" DOUBLE PRECISION NOT NULL DEFAULT 0,
                "overtimePay" DOUBLE PRECISION NOT NULL DEFAULT 0,
                "grossSalary" DOUBLE PRECISION NOT NULL DEFAULT 0,
                "bhxhEmployee" DOUBLE PRECISION NOT NULL DEFAULT 0,
                "bhytEmployee" DOUBLE PRECISION NOT NULL DEFAULT 0,
                "bhtnEmployee" DOUBLE PRECISION NOT NULL DEFAULT 0,
                "bhxhEmployer" DOUBLE PRECISION NOT NULL DEFAULT 0,
                "bhytEmployer" DOUBLE PRECISION NOT NULL DEFAULT 0,
                "bhtnEmployer" DOUBLE PRECISION NOT NULL DEFAULT 0,
                "totalInsuranceEmployee" DOUBLE PRECISION NOT NULL DEFAULT 0,
                "totalInsuranceEmployer" DOUBLE PRECISION NOT NULL DEFAULT 0,
                "totalInsuranceDeduction" DOUBLE PRECISION NOT NULL DEFAULT 0,
                "taxableIncome" DOUBLE PRECISION NOT NULL DEFAULT 0,
                "personalDeduction" DOUBLE PRECISION NOT NULL DEFAULT 0,
                "dependentDeduction" DOUBLE PRECISION NOT NULL DEFAULT 0,
                "dependents" INTEGER NOT NULL DEFAULT 0,
                "assessableIncome" DOUBLE PRECISION NOT NULL DEFAULT 0,
                "pitAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
                "netSalary" DOUBLE PRECISION NOT NULL DEFAULT 0,
                "bankTransferAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
                "notes" TEXT,
                "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT "PayrollEntry_pkey" PRIMARY KEY ("id")
            )
        `)
        await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "PayrollEntry_periodId_idx" ON "PayrollEntry"("periodId")`).catch(() => {})
        await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "PayrollEntry_employeeId_idx" ON "PayrollEntry"("employeeId")`).catch(() => {})
        ensuredPayrollSchemas.add(key)
    } catch (e: any) {
        console.error('ensurePayrollTables error:', e?.message || e)
    }
}

// PIT (thuế TNCN lũy tiến). `base` = thu nhập tính thuế (sau BH + giảm trừ gia cảnh).
function computePIT(base: number): number {
    if (base <= 0) return 0
    const brackets: Array<[number, number]> = [
        [5_000_000, 0.05], [10_000_000, 0.10], [18_000_000, 0.15],
        [32_000_000, 0.20], [52_000_000, 0.25], [80_000_000, 0.30], [Infinity, 0.35],
    ]
    let tax = 0, prev = 0
    for (const [cap, rate] of brackets) {
        if (base <= prev) break
        tax += (Math.min(base, cap) - prev) * rate
        prev = cap
    }
    return Math.round(tax)
}

// Compute a full payroll entry for one employee in a period.
function computeEntry(emp: any, opts: { workDays?: number; standardDays?: number; allowances?: number; overtimePay?: number; notes?: string }) {
    const standardDays = Number(opts.standardDays) || 26
    const workDays = opts.workDays != null ? Number(opts.workDays) : standardDays
    const baseSalaryFull = Number(emp.baseSalary) || 0
    const baseSalary = standardDays > 0 ? pround(baseSalaryFull * workDays / standardDays) : baseSalaryFull
    const allowances = pround(opts.allowances)
    const overtimePay = pround(opts.overtimePay)
    const grossSalary = baseSalary + allowances + overtimePay

    // Cơ sở đóng BH: lương cơ bản đầy đủ (lương đóng bảo hiểm).
    const insBase = baseSalaryFull
    const bhxhEmployee = pround(insBase * BHXH_EMP)
    const bhytEmployee = pround(insBase * BHYT_EMP)
    const bhtnEmployee = pround(insBase * BHTN_EMP)
    const bhxhEmployer = pround(insBase * BHXH_ER)
    const bhytEmployer = pround(insBase * BHYT_ER)
    const bhtnEmployer = pround(insBase * BHTN_ER)
    const totalInsuranceEmployee = bhxhEmployee + bhytEmployee + bhtnEmployee
    const totalInsuranceEmployer = bhxhEmployer + bhytEmployer + bhtnEmployer

    const taxableIncome = Math.max(0, grossSalary - totalInsuranceEmployee) // thu nhập chịu thuế
    const dependents = Number(emp.dependents) || 0
    const personalDeduction = PERSONAL_DEDUCTION
    const dependentDeduction = DEPENDENT_DEDUCTION * dependents
    const assessableIncome = Math.max(0, taxableIncome - personalDeduction - dependentDeduction) // thu nhập tính thuế
    const pitAmount = computePIT(assessableIncome)
    const netSalary = grossSalary - totalInsuranceEmployee - pitAmount

    return {
        employeeId: emp.id, employeeCode: emp.code || null, employeeName: emp.name || null,
        workDays, baseSalary, allowances, overtimePay, grossSalary,
        bhxhEmployee, bhytEmployee, bhtnEmployee, bhxhEmployer, bhytEmployer, bhtnEmployer,
        totalInsuranceEmployee, totalInsuranceEmployer, totalInsuranceDeduction: totalInsuranceEmployee,
        taxableIncome, personalDeduction, dependentDeduction, dependents, assessableIncome,
        pitAmount, netSalary, bankTransferAmount: netSalary, notes: opts.notes ?? null,
    }
}

export async function recalcPeriodTotals(prisma: any, periodId: string) {
    /* Tổng kỳ lương GHI ĐÈ vào PayrollPeriod. Nuốt lỗi ⇒ entries rỗng ⇒ ghi tổng lương = 0 đè
   * lên số đúng — sai vĩnh viễn cho tới khi ai đó tính lại (20/08/2026). */
    const entries = await prisma.payrollEntry.findMany({ where: { periodId } })
    let totalGross = 0, totalDeductions = 0, totalNet = 0
    for (const e of entries) {
        totalGross += Number(e.grossSalary) || 0
        totalDeductions += (Number(e.totalInsuranceEmployee) || 0) + (Number(e.pitAmount) || 0)
        totalNet += Number(e.netSalary) || 0
    }
    return prisma.payrollPeriod.update({
        where: { id: periodId },
        data: { totalGross: pround(totalGross), totalDeductions: pround(totalDeductions), totalNet: pround(totalNet) },
    }).catch(() => null)
}

// ─── Employees ───────────────────────────────────────────────────────────────

// GET /api/payroll/employees
router.get('/employees', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        await ensurePayrollTables(req)
        const prisma = req.storePrisma! as any
        const where: any = { ...getBranchFilter(req) }
        if (req.query.status) where.status = String(req.query.status)
        if (req.query.department) where.department = String(req.query.department)
        const data = await prisma.employee.findMany({ where, orderBy: { code: 'asc' } })
        res.json({ success: true, data })
    } catch (err: any) {
        console.error('GET /payroll/employees error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// POST /api/payroll/employees
router.post('/employees', authMiddleware, requireRole('admin', 'manager', 'superadmin'), async (req: AuthRequest, res: Response) => {
    try {
        await ensurePayrollTables(req)
        const prisma = req.storePrisma! as any
        const b = req.body || {}
        if (!b.name) return res.status(400).json({ success: false, error: 'Tên nhân viên (name) là bắt buộc' })
        const code = (b.code || `NV${Date.now().toString().slice(-6)}`).toString().trim()
        /* Employee.code chỉ có @@index, KHÔNG @unique — chốt này là thứ DUY NHẤT chặn nhân viên
         * trùng mã, mà nhân viên đôi kéo theo dòng lương đôi (20/08/2026). */
        const existing = await prisma.employee.findFirst({ where: { code } })
        if (existing) return res.status(409).json({ success: false, error: `Mã nhân viên "${code}" đã tồn tại` })
        const data = await prisma.employee.create({
            data: {
                code, name: String(b.name), position: b.position ?? null, department: b.department ?? null,
                baseSalary: pround(b.baseSalary), bankAccount: b.bankAccount ?? null, bankName: b.bankName ?? null,
                taxCode: b.taxCode ?? null, socialInsuranceNo: b.socialInsuranceNo ?? null,
                startDate: b.startDate ?? null, endDate: b.endDate ?? null,
                status: b.status || 'active', dependents: Number(b.dependents) || 0,
                notes: b.notes ?? null, branchId: getBranchId(req) || null,
            },
        })
        res.status(201).json({ success: true, data })
    } catch (err: any) {
        console.error('POST /payroll/employees error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// GET /api/payroll/employees/:id
router.get('/employees/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        await ensurePayrollTables(req)
        const prisma = req.storePrisma! as any
        const emp = await prisma.employee.findUnique({ where: { id: String(req.params.id) } }).catch(() => null)
        if (!emp) return res.status(404).json({ success: false, error: 'Không tìm thấy nhân viên' })
        res.json({ success: true, data: emp })
    } catch (err: any) {
        console.error('GET /payroll/employees/:id error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// PUT /api/payroll/employees/:id
router.put('/employees/:id', authMiddleware, requireRole('admin', 'manager', 'superadmin'), async (req: AuthRequest, res: Response) => {
    try {
        await ensurePayrollTables(req)
        const prisma = req.storePrisma! as any
        const id = String(req.params.id)
        const emp = await prisma.employee.findUnique({ where: { id } }).catch(() => null)
        if (!emp) return res.status(404).json({ success: false, error: 'Không tìm thấy nhân viên' })
        const b = req.body || {}
        const data: any = {}
        for (const f of ['name', 'position', 'department', 'bankAccount', 'bankName', 'taxCode', 'socialInsuranceNo', 'startDate', 'endDate', 'status', 'notes']) {
            if (b[f] !== undefined) data[f] = b[f]
        }
        if (b.baseSalary !== undefined) data.baseSalary = pround(b.baseSalary)
        if (b.dependents !== undefined) data.dependents = Number(b.dependents) || 0
        if (b.code !== undefined && b.code !== emp.code) {
            const dup = await prisma.employee.findFirst({ where: { code: String(b.code) } })   // xem ghi chú chốt trùng ở trên
            if (dup) return res.status(409).json({ success: false, error: `Mã nhân viên "${b.code}" đã tồn tại` })
            data.code = String(b.code)
        }
        const updated = await prisma.employee.update({ where: { id }, data })
        res.json({ success: true, data: updated })
    } catch (err: any) {
        console.error('PUT /payroll/employees/:id error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// DELETE /api/payroll/employees/:id
router.delete('/employees/:id', authMiddleware, requireRole('admin', 'manager', 'superadmin'), async (req: AuthRequest, res: Response) => {
    try {
        await ensurePayrollTables(req)
        const prisma = req.storePrisma! as any
        const id = String(req.params.id)
        const emp = await prisma.employee.findUnique({ where: { id } }).catch(() => null)
        if (!emp) return res.status(404).json({ success: false, error: 'Không tìm thấy nhân viên' })
        await prisma.employee.delete({ where: { id } })
        res.json({ success: true, data: { id, deleted: true } })
    } catch (err: any) {
        console.error('DELETE /payroll/employees/:id error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// ─── Periods ───────────────────────────────────────────────────────────────

// GET /api/payroll/periods
router.get('/periods', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        await ensurePayrollTables(req)
        const prisma = req.storePrisma! as any
        const where: any = { ...getBranchFilter(req) }
        if (req.query.status) where.status = String(req.query.status)
        if (req.query.year) where.year = Number(req.query.year)
        const data = await prisma.payrollPeriod.findMany({ where, orderBy: [{ year: 'desc' }, { month: 'desc' }] })
        res.json({ success: true, data })
    } catch (err: any) {
        console.error('GET /payroll/periods error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// POST /api/payroll/periods
router.post('/periods', authMiddleware, requireRole('admin', 'manager', 'superadmin'), async (req: AuthRequest, res: Response) => {
    try {
        await ensurePayrollTables(req)
        const prisma = req.storePrisma! as any
        const b = req.body || {}
        const month = Number(b.month), year = Number(b.year)
        if (!month || month < 1 || month > 12) return res.status(400).json({ success: false, error: 'month (1-12) là bắt buộc' })
        if (!year) return res.status(400).json({ success: false, error: 'year là bắt buộc' })
        const branchId = getBranchId(req) || null
        /* Chốt trùng KỲ LƯƠNG: nuốt lỗi ⇒ tạo kỳ thứ hai cho cùng tháng ⇒ chi phí lương đôi. */
        const existing = await prisma.payrollPeriod.findFirst({ where: { month, year, ...(branchId ? { branchId } : {}) } })
        if (existing) return res.status(409).json({ success: false, error: `Kỳ lương T${month}/${year} đã tồn tại`, data: existing })
        const data = await prisma.payrollPeriod.create({
            data: { month, year, status: 'draft', notes: b.notes ?? null, branchId, createdBy: req.user?.userId || null },
        })
        res.status(201).json({ success: true, data })
    } catch (err: any) {
        console.error('POST /payroll/periods error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// GET /api/payroll/periods/:id
router.get('/periods/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        await ensurePayrollTables(req)
        const prisma = req.storePrisma! as any
        const period = await prisma.payrollPeriod.findUnique({ where: { id: String(req.params.id) } }).catch(() => null)
        if (!period) return res.status(404).json({ success: false, error: 'Không tìm thấy kỳ lương' })
        const entryCount = await prisma.payrollEntry.count({ where: { periodId: period.id } }).catch(() => 0)
        res.json({ success: true, data: { ...period, entryCount } })
    } catch (err: any) {
        console.error('GET /payroll/periods/:id error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// PUT /api/payroll/periods/:id — draft only
router.put('/periods/:id', authMiddleware, requireRole('admin', 'manager', 'superadmin'), async (req: AuthRequest, res: Response) => {
    try {
        await ensurePayrollTables(req)
        const prisma = req.storePrisma! as any
        const id = String(req.params.id)
        const period = await prisma.payrollPeriod.findUnique({ where: { id } }).catch(() => null)
        if (!period) return res.status(404).json({ success: false, error: 'Không tìm thấy kỳ lương' })
        if (period.status !== 'draft') return res.status(400).json({ success: false, error: `Chỉ sửa được kỳ lương nháp. Trạng thái: ${period.status}` })
        const b = req.body || {}
        const data: any = {}
        if (b.notes !== undefined) data.notes = b.notes
        if (b.month !== undefined) data.month = Number(b.month)
        if (b.year !== undefined) data.year = Number(b.year)
        const updated = await prisma.payrollPeriod.update({ where: { id }, data })
        res.json({ success: true, data: updated })
    } catch (err: any) {
        console.error('PUT /payroll/periods/:id error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// DELETE /api/payroll/periods/:id — draft only
router.delete('/periods/:id', authMiddleware, requireRole('admin', 'manager', 'superadmin'), async (req: AuthRequest, res: Response) => {
    try {
        await ensurePayrollTables(req)
        const prisma = req.storePrisma! as any
        const id = String(req.params.id)
        const period = await prisma.payrollPeriod.findUnique({ where: { id } }).catch(() => null)
        if (!period) return res.status(404).json({ success: false, error: 'Không tìm thấy kỳ lương' })
        if (period.status !== 'draft') return res.status(400).json({ success: false, error: `Chỉ xóa được kỳ lương nháp. Trạng thái: ${period.status}` })
        await prisma.payrollEntry.deleteMany({ where: { periodId: id } }).catch(() => {})
        await prisma.payrollPeriod.delete({ where: { id } })
        res.json({ success: true, data: { id, deleted: true } })
    } catch (err: any) {
        console.error('DELETE /payroll/periods/:id error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// POST /api/payroll/periods/:id/calculate — auto-calc entries for active employees
// Body: { standardDays?, overrides?: { [employeeId]: { workDays, allowances, overtimePay, notes } } }
router.post('/periods/:id/calculate', authMiddleware, requireRole('admin', 'manager', 'superadmin'), async (req: AuthRequest, res: Response) => {
    try {
        await ensurePayrollTables(req)
        const prisma = req.storePrisma! as any
        const id = String(req.params.id)
        const period = await prisma.payrollPeriod.findUnique({ where: { id } }).catch(() => null)
        if (!period) return res.status(404).json({ success: false, error: 'Không tìm thấy kỳ lương' })
        if (period.status !== 'draft') return res.status(400).json({ success: false, error: `Chỉ tính được kỳ lương nháp. Trạng thái: ${period.status}` })
        const b = req.body || {}
        const standardDays = Number(b.standardDays) || 26
        const overrides = b.overrides || {}
        const employees = await prisma.employee.findMany({ where: { status: 'active', ...getBranchFilter(req) } })
        if (employees.length === 0) return res.status(400).json({ success: false, error: 'Không có nhân viên đang làm việc để tính lương' })
        /* KHÔNG nuốt lỗi ở lệnh XOÁ này (21/08/2026).
         * Route "tính lại" cố ý chạy được nhiều lần: xoá dòng cũ rồi tạo dòng mới. Nếu lệnh xoá
         * hỏng mà bị nuốt, vòng dưới vẫn tạo dòng mới ĐÈ LÊN dòng cũ ⇒ **kỳ lương có bản ghi TRÙNG**,
         * và `recalcPeriodTotals` cộng cả hai ⇒ tổng lương/BHXH/TNCN **nhân đôi**, mà API vẫn báo
         * thành công. `deleteMany` không ném khi không có gì để xoá (trả count 0), nên ném ở đây
         * nghĩa là lỗi thật — phải dừng, đừng tạo trùng. */
        await prisma.payrollEntry.deleteMany({ where: { periodId: id } })
        const created: any[] = []
        for (const emp of employees) {
            const ov = overrides[emp.id] || {}
            const computed = computeEntry(emp, { workDays: ov.workDays, standardDays, allowances: ov.allowances, overtimePay: ov.overtimePay, notes: ov.notes })
            const entry = await prisma.payrollEntry.create({ data: { periodId: id, ...computed } })
            created.push(entry)
        }
        const period2 = await recalcPeriodTotals(prisma, id)
        res.json({ success: true, data: { period: period2, entries: created, count: created.length } })
    } catch (err: any) {
        console.error('POST /payroll/periods/:id/calculate error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// POST /api/payroll/periods/:id/confirm — draft → confirmed
router.post('/periods/:id/confirm', authMiddleware, requireRole('admin', 'manager', 'superadmin'), async (req: AuthRequest, res: Response) => {
    try {
        await ensurePayrollTables(req)
        const prisma = req.storePrisma! as any
        const id = String(req.params.id)
        const period = await prisma.payrollPeriod.findUnique({ where: { id } }).catch(() => null)
        if (!period) return res.status(404).json({ success: false, error: 'Không tìm thấy kỳ lương' })
        if (period.status !== 'draft') return res.status(400).json({ success: false, error: `Chỉ xác nhận được kỳ lương nháp. Trạng thái: ${period.status}` })
        const count = await prisma.payrollEntry.count({ where: { periodId: id } }).catch(() => 0)
        if (count === 0) return res.status(400).json({ success: false, error: 'Kỳ lương chưa có bảng lương. Hãy tính lương trước.' })
        await recalcPeriodTotals(prisma, id)
        const updated = await prisma.payrollPeriod.update({ where: { id }, data: { status: 'confirmed', confirmedAt: new Date() } })
        res.json({ success: true, data: updated })
    } catch (err: any) {
        console.error('POST /payroll/periods/:id/confirm error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// POST /api/payroll/periods/:id/pay — confirmed → paid + journal (Nợ 334/Có 112)
router.post('/periods/:id/pay', authMiddleware, requireRole('admin', 'manager', 'superadmin'), async (req: AuthRequest, res: Response) => {
    try {
        await ensurePayrollTables(req)
        const prisma = req.storePrisma! as any
        const id = String(req.params.id)
        const period = await prisma.payrollPeriod.findUnique({ where: { id } }).catch(() => null)
        if (!period) return res.status(404).json({ success: false, error: 'Không tìm thấy kỳ lương' })
        if (period.status === 'paid') return res.status(400).json({ success: false, error: 'Kỳ lương đã chi trả' })
        if (period.status !== 'confirmed') return res.status(400).json({ success: false, error: `Chỉ chi trả được kỳ lương đã xác nhận. Trạng thái: ${period.status}` })
        await recalcPeriodTotals(prisma, id)
        const refreshed = await prisma.payrollPeriod.findUnique({ where: { id } })
        /* `findUnique` trả `T | null` — phải chặn (21/08/2026). Đây là đường CHI TRẢ LƯƠNG: kỳ lương
         * biến mất giữa chừng (ai đó xoá, hoặc đọc hỏng) thì `refreshed.totalNet` ném TypeError,
         * route 500 giữa lúc đang chi. Lỗi này TypeScript thấy ngay khi bỏ `as any` — nó bị che vì
         * cả file ép `any`. Xem `DE-XUAT-bo-as-any.md`. */
        if (!refreshed) return res.status(409).json({ success: false, error: 'Kỳ lương vừa bị thay đổi hoặc xoá — tải lại rồi thử lại' })
        const totalNet = pround(refreshed.totalNet)
        const branchId = getBranchId(req) || null
        const userId = req.user?.userId || null
        const monthLabel = `T${period.month}/${period.year}`
        const payDate = new Date(period.year, period.month, 0).toISOString().slice(0, 10) // last day of month
        const ref = `PAYROLL-${period.year}-${String(period.month).padStart(2, '0')}`
        /* GHI SỔ VÀ ĐÁNH DẤU "ĐÃ CHI" PHẢI ĐI CÙNG NHAU (20/08/2026). Bản cũ: bút toán hỏng thì chỉ
         * `console.error` rồi VẪN đặt status='paid' — kỳ lương báo đã chi trong khi sổ không có
         * đồng nào chi lương. Đúng cơ chế làm "sổ kế toán không phản ánh" (xem memory cùng tên). */
        const created: any[] = []
        const updated = await prisma.$transaction(async (t: any) => {
            if (totalNet > 0) {
                // Chi lương: Nợ 334 (Phải trả người LĐ) / Có 112 (Tiền gửi ngân hàng)
                const entry = await t.journalEntry.create({
                    data: {
                        date: payDate, description: `Chi lương ${monthLabel}`,
                        debitAccount: '334', debitAccountName: 'Phải trả người lao động',
                        creditAccount: '112', creditAccountName: 'Tiền gửi ngân hàng',
                        amount: totalNet, reference: `${ref}-PAY`, referenceType: 'payroll',
                        branchId, createdBy: userId,
                    },
                })
                created.push(entry)
            }
            return t.payrollPeriod.update({ where: { id }, data: { status: 'paid', paidAt: new Date() } })
        })
        res.json({ success: true, data: { period: updated, journalEntries: created, totalPaid: totalNet } })
    } catch (err: any) {
        console.error('POST /payroll/periods/:id/pay error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// GET /api/payroll/periods/:id/entries
router.get('/periods/:id/entries', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        await ensurePayrollTables(req)
        const prisma = req.storePrisma! as any
        const id = String(req.params.id)
        const period = await prisma.payrollPeriod.findUnique({ where: { id } }).catch(() => null)
        if (!period) return res.status(404).json({ success: false, error: 'Không tìm thấy kỳ lương' })
        const entries = await prisma.payrollEntry.findMany({ where: { periodId: id }, orderBy: { employeeCode: 'asc' } })
        res.json({ success: true, data: entries })
    } catch (err: any) {
        console.error('GET /payroll/periods/:id/entries error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// GET /api/payroll/periods/:id/payslip/:employeeId
router.get('/periods/:id/payslip/:employeeId', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        await ensurePayrollTables(req)
        const prisma = req.storePrisma! as any
        const id = String(req.params.id)
        const employeeId = String(req.params.employeeId)
        const period = await prisma.payrollPeriod.findUnique({ where: { id } }).catch(() => null)
        if (!period) return res.status(404).json({ success: false, error: 'Không tìm thấy kỳ lương' })
        const entry = await prisma.payrollEntry.findFirst({ where: { periodId: id, employeeId } }).catch(() => null)
        if (!entry) return res.status(404).json({ success: false, error: 'Không tìm thấy bảng lương của nhân viên trong kỳ này' })
        const employee = await prisma.employee.findUnique({ where: { id: employeeId } }).catch(() => null)
        res.json({
            success: true,
            data: {
                period: { id: period.id, month: period.month, year: period.year, status: period.status, label: `T${period.month}/${period.year}` },
                employee, payslip: entry,
            },
        })
    } catch (err: any) {
        console.error('GET /payroll/periods/:id/payslip/:employeeId error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

export default router

