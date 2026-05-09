import { Router, Request, Response } from 'express'
import { authMiddleware, AuthRequest, getBranchFilter } from '../middleware/auth'
import { requireRole } from '../middleware/roleMiddleware'
import { cacheGet, cacheSet, cacheDel } from '../lib/cache'

const router = Router()

// GET /api/branches/stats
router.get('/stats', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const all = await prisma.branch.findMany()
        const active = all.filter((b: any) => b.status === 'active').length
        const mainBranch = all.find((b: any) => b.isMainBranch)
        const employeeCounts = await prisma.user.groupBy({ by: ['branchId'], _count: true })
        const perBranch = all.map((b: any) => ({
            id: b.id, name: b.name, code: b.code, isMain: b.isMainBranch,
            employees: employeeCounts.find((e: any) => e.branchId === b.id)?._count || 0
        }))
        res.json({ success: true, data: { total: all.length, active, mainBranch: mainBranch?.name || null, perBranch } })
    } catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// GET /api/branches
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const schema = req.user?.storeSchema || 'default'
        const cacheKey = `${schema}:branches:${JSON.stringify(req.query)}`
        const cached = await cacheGet(cacheKey)
        if (cached) return res.json(cached)
        const prisma = req.storePrisma!
        // Branch model doesn't have branchId — filter by id for sub-branch users
        const branchWhere: any = { status: 'active' }
        if (!req.user?.isMainBranch && req.user?.branchId) {
            branchWhere.id = req.user.branchId // CN phụ chỉ thấy branch của mình
        }
        const data = await prisma.branch.findMany({
            where: branchWhere,
            orderBy: { createdAt: 'asc' },
        })
        const _response = { success: true, data }
        await cacheSet(cacheKey, _response, 300)
        res.json(_response)
    } catch (err) {
        console.error('List branches error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ─── POST /api/branches/request — Submit branch request for superadmin approval
router.post('/request', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { name, code, address, phone } = req.body

        if (!name?.trim() || !code?.trim()) {
            return res.status(400).json({ success: false, error: 'Tên và mã chi nhánh là bắt buộc' })
        }

        // Check if branch code already exists
        const existingBranch = await prisma.branch.findFirst({
            where: { code: code.trim().toUpperCase() },
        })
        if (existingBranch) {
            return res.status(409).json({ success: false, error: 'Mã chi nhánh đã tồn tại' })
        }

        // Check if there's already a pending request with the same code
        const existingRequest = await (prisma as any).branchRequest.findFirst({
            where: { branchCode: code.trim().toUpperCase(), status: 'pending' },
        })
        if (existingRequest) {
            return res.status(409).json({ success: false, error: 'Đã có yêu cầu mở chi nhánh với mã này đang chờ duyệt' })
        }

        // Get store name
        const store = await (prisma as any).store.findFirst({ select: { name: true } })

        // Get requester name
        const user = await prisma.user.findUnique({ where: { id: req.user!.userId }, select: { name: true } })

        const request = await (prisma as any).branchRequest.create({
            data: {
                storeName: store?.name || '',
                branchName: name.trim(),
                branchCode: code.trim().toUpperCase(),
                address: address?.trim() || null,
                phone: phone?.trim() || null,
                requestedBy: req.user!.userId,
                requestedByName: user?.name || '',
            },
        })

        cacheDel(`${req.user?.storeSchema || 'default'}:branches:*`).catch(() => { })
        res.status(201).json({
            success: true,
            data: request,
            message: 'Yêu cầu mở chi nhánh đã được gửi, vui lòng chờ superadmin duyệt',
        })
    } catch (err) {
        console.error('Create branch request error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ─── GET /api/branches/requests — List my store's branch requests
router.get('/requests', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const requests = await (prisma as any).branchRequest.findMany({
            where: {},
            orderBy: { createdAt: 'desc' },
        })
        res.json({ success: true, data: requests })
    } catch (err) {
        console.error('List branch requests error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ─── GET /api/branches/limit — Check branch limit for current store
router.get('/limit', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const allBranches = await prisma.branch.findMany({ where: { status: 'active' } })
        const currentCount = allBranches.length

        // Get store from registry to check addOns & extraBranches
        const { registryPrisma } = require('../lib/prisma')
        const store = await registryPrisma.store.findUnique({ where: { id: req.user?.storeId } })
        let storeAddOns: string[] = []
        try { storeAddOns = JSON.parse(store?.addOns || '[]') } catch { storeAddOns = [] }

        const hasExtraBranch = storeAddOns.includes('extra_branch')
        const extraBranches = hasExtraBranch ? (store?.extraBranches || 0) : 0
        const maxBranches = 1 + extraBranches // 1 CN chính miễn phí + extra đã thanh toán

        res.json({
            success: true,
            data: {
                currentCount,
                maxBranches,
                remaining: Math.max(0, maxBranches - currentCount),
                hasExtraBranch,
                extraBranches,
            },
        })
    } catch (err) {
        console.error('Branch limit error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// POST /api/branches — Self-create branch if within paid limit
router.post('/', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { name, code, address, phone } = req.body

        if (!name?.trim() || !code?.trim()) {
            return res.status(400).json({ success: false, error: 'Tên và mã chi nhánh là bắt buộc' })
        }

        // Check duplicate code
        const existingBranch = await prisma.branch.findFirst({ where: { code: code.trim().toUpperCase() } })
        if (existingBranch) {
            return res.status(409).json({ success: false, error: 'Mã chi nhánh đã tồn tại' })
        }

        // Check branch limit from registry
        const { registryPrisma } = require('../lib/prisma')
        const store = await registryPrisma.store.findUnique({ where: { id: req.user?.storeId } })
        let storeAddOns: string[] = []
        try { storeAddOns = JSON.parse(store?.addOns || '[]') } catch { storeAddOns = [] }

        const hasExtraBranch = storeAddOns.includes('extra_branch')
        const extraBranches = hasExtraBranch ? (store?.extraBranches || 0) : 0
        const maxBranches = 1 + extraBranches

        const allBranches = await prisma.branch.findMany({ where: { status: 'active' } })
        if (allBranches.length >= maxBranches) {
            return res.status(403).json({
                success: false,
                error: `Đã đạt giới hạn ${maxBranches} chi nhánh. Vui lòng liên hệ admin để nâng cấp gói thêm chi nhánh.`,
            })
        }

        // Create branch directly
        const branch = await prisma.branch.create({
            data: { name: name.trim(), code: code.trim().toUpperCase(), address: address?.trim() || null, phone: phone?.trim() || null },
        })

        cacheDel(`${req.user?.storeSchema || 'default'}:branches:*`).catch(() => { })
        res.status(201).json({ success: true, data: branch, message: 'Chi nhánh đã được tạo thành công' })
    } catch (err) {
        console.error('Create branch error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// GET /api/branches/:id/detail — Branch detail with aggregated stats
router.get('/:id/detail', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma! as any
        const branchId = req.params.id as string

        const branch = await prisma.branch.findFirst({ where: { id: branchId } })
        if (!branch) return res.status(404).json({ success: false, error: 'Chi nhánh không tồn tại' })

        const thirtyDaysAgo = new Date()
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

        // Parallel queries for stats
        const [
            employeeCount,
            transactionStats,
            expenseStats,
            customerCount,
            recentTransactions,
        ] = await Promise.all([
            // Employees belonging to this branch
            prisma.user.count({ where: { branchId } }).catch(() => 0),
            // Transaction stats (30 days)
            prisma.transaction.aggregate({
                where: { branchId, createdAt: { gte: thirtyDaysAgo }, status: { not: 'voided' } },
                _count: true,
                _sum: { total: true },
            }).catch(() => ({ _count: 0, _sum: { total: 0 } })),
            // Expense stats (30 days)
            prisma.expense.aggregate({
                where: { branchId, date: { gte: thirtyDaysAgo } },
                _count: true,
                _sum: { amount: true },
            }).catch(() => ({ _count: 0, _sum: { amount: 0 } })),
            // Unique customers who bought at this branch
            prisma.transaction.findMany({
                where: { branchId, customerId: { not: null } },
                select: { customerId: true },
                distinct: ['customerId'],
            }).then((r: any[]) => r.length).catch(() => 0),
            // Recent 10 transactions
            prisma.transaction.findMany({
                where: { branchId },
                orderBy: { createdAt: 'desc' },
                take: 10,
                select: {
                    id: true, receiptNumber: true, customerName: true, total: true,
                    status: true, createdAt: true, createdByName: true,
                },
            }).catch(() => []),
        ])

        // Get employees list
        const employees = await prisma.user.findMany({
            where: { branchId },
            select: { id: true, name: true, email: true, role: true, status: true },
            orderBy: { name: 'asc' },
        }).catch(() => [])

        res.json({
            success: true,
            data: {
                branch: {
                    id: branch.id,
                    name: branch.name,
                    code: branch.code,
                    address: branch.address,
                    phone: branch.phone,
                    isMainBranch: branch.isMainBranch || false,
                    status: branch.status,
                    createdAt: branch.createdAt?.toISOString(),
                },
                stats: {
                    employeeCount,
                    transactionCount: transactionStats._count || 0,
                    revenue: transactionStats._sum?.total || 0,
                    expenseCount: expenseStats._count || 0,
                    expenseTotal: expenseStats._sum?.amount || 0,
                    customerCount,
                },
                employees,
                recentTransactions: recentTransactions.map((t: any) => ({
                    ...t,
                    createdAt: t.createdAt?.toISOString(),
                })),
            },
        })
    } catch (err) {
        console.error('Branch detail error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// PUT /api/branches/:id
router.put('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const id = req.params.id as string
        const { name, code, address, phone, status } = req.body
        const existing = await prisma.branch.findFirst({ where: { id } })
        if (!existing) return res.status(404).json({ success: false, error: 'Not found' })

        // Cannot change isMainBranch
        const data: any = {}
        if (name !== undefined) data.name = name.trim()
        if (code !== undefined) data.code = code.trim().toUpperCase()
        if (address !== undefined) data.address = address
        if (phone !== undefined) data.phone = phone
        if (status !== undefined) data.status = status

        const updated = await prisma.branch.update({ where: { id }, data })
        res.json({ success: true, data: updated })
    } catch (err) {
        console.error('Update branch error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// DELETE /api/branches/:id — Main branch: blocked. Sub-branch: needs admin approval
router.delete('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const id = req.params.id as string
        const existing = await prisma.branch.findFirst({ where: { id } })
        if (!existing) return res.status(404).json({ success: false, error: 'Not found' })

        // Cannot delete main branch
        if (existing.isMainBranch) {
            return res.status(403).json({
                success: false,
                error: 'Không thể xóa chi nhánh chính. Chi nhánh chính là bắt buộc cho mỗi cửa hàng.',
            })
        }

        // Get store and user info for the request
        const store = await (prisma as any).store.findFirst({ select: { name: true } })
        const user = await prisma.user.findUnique({ where: { id: req.user!.userId }, select: { name: true } })

        // Create delete request instead of deleting directly
        const deleteRequest = await (prisma as any).branchDeleteRequest.create({
            data: {
                branchId: id,
                branchName: existing.name,
                branchCode: existing.code,
                storeName: store?.name || '',
                requestedBy: req.user!.userId,
                requestedByName: user?.name || '',
                reason: req.body?.reason || null,
            },
        })

        res.json({
            success: true,
            data: deleteRequest,
            message: 'Yêu cầu xóa chi nhánh đã được gửi, vui lòng chờ admin duyệt.',
        })
    } catch (err) {
        console.error('Delete branch request error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// POST /api/branches/migrate-branch-ids — One-time: assign null branchIds to main branch
// Admin/superadmin only — runs UPDATE across 11 tables, must not be exposed to regular users.
router.post('/migrate-branch-ids', authMiddleware, requireRole('admin', 'superadmin'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma! as any
        const mainBranch = await prisma.branch.findFirst({ where: { isMainBranch: true } })
        if (!mainBranch) return res.status(404).json({ success: false, error: 'No main branch found' })

        const tables = ['Product', 'Customer', 'Transaction', 'ImportReceipt', 'PurchaseOrder', 'Category', 'Brand', 'Expense', 'SalesOrder', 'Supplier', 'ReturnOrder']
        const results: Record<string, string> = {}

        for (const table of tables) {
            try {
                const r = await prisma.$executeRawUnsafe(
                    `UPDATE "${table}" SET "branchId" = $1 WHERE "branchId" IS NULL`,
                    mainBranch.id
                )
                results[table] = `${r} rows updated`
            } catch (e: any) {
                results[table] = `error: ${e.message?.substring(0, 100)}`
            }
        }

        res.json({ success: true, mainBranchId: mainBranch.id, results })
    } catch (err) {
        console.error('Migrate branch IDs error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

export default router
