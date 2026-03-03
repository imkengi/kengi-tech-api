import { Router, Response } from 'express'
import { authMiddleware, AuthRequest } from '../middleware/auth'
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
        await cacheSet(cacheKey, _response, 120)
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

export default router

