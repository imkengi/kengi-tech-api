import { Router, Request, Response, NextFunction } from 'express'
import crypto from 'crypto'
import jwt from 'jsonwebtoken'
import { errMsg } from '../lib/errorResponse'
import { registryPrisma, getStorePrisma, dropStoreSchema, mapWithConcurrency, syncBranchSchemaTables, dangGiuClient, traClient } from '../lib/prisma'
import { chayTheoDot } from '../lib/poolGuard'
import { khoHuHong } from '../lib/warehouseHelper'
import { maHoa, coKhoaVault } from '../lib/maHoaKhoa'
import { computeOrderProfits } from '../lib/onlineOrderProfit'
import { invalidateStoreStatus } from '../lib/storeStatusCache'

const router = Router()

// ─── Admin Auth ─────────────────────────────────────────────────────────────
// 2 lối vào:
//  1. x-admin-key (script/cron/CLI — key ở Secret Manager open-retail-admin-key)
//  2. Bearer JWT scope 'admin-panel' — cấp bởi POST /admin/login cho trang
//     kengi.vn/admin. User/pass so SERVER-SIDE (env ADMIN_PANEL_*), KHÔNG còn
//     bake NEXT_PUBLIC_ADMIN_* vào bundle FE công khai (lộ key).
const ADMIN_KEY = process.env.ADMIN_KEY
if (!ADMIN_KEY) {
    console.warn('⚠️ ADMIN_KEY not configured — admin routes will reject all requests')
}
const JWT_SECRET = process.env.JWT_SECRET || ''
const PANEL_USER = process.env.ADMIN_PANEL_USER || 'superadmin'
const PANEL_PASS = process.env.ADMIN_PANEL_PASS || ''
const PANEL_SCOPE = 'admin-panel'

function safeEqual(a: string, b: string): boolean {
    const ab = Buffer.from(a)
    const bb = Buffer.from(b)
    if (ab.length !== bb.length) return false
    return crypto.timingSafeEqual(ab, bb)
}

// POST /admin/login — PHẢI đứng trước router.use(adminKeyAuth)
router.post('/login', async (req: Request, res: Response) => {
    if (!PANEL_PASS || !JWT_SECRET) {
        res.status(503).json({ success: false, error: 'Admin panel login chưa cấu hình (ADMIN_PANEL_PASS/JWT_SECRET)' })
        return
    }
    const { username, password } = req.body || {}
    if (
        typeof username !== 'string' || typeof password !== 'string' ||
        !safeEqual(username, PANEL_USER) || !safeEqual(password, PANEL_PASS)
    ) {
        // Fail chậm để hạn chế brute-force
        await new Promise((r) => setTimeout(r, 800))
        res.status(401).json({ success: false, error: 'Sai tài khoản hoặc mật khẩu' })
        return
    }
    const token = jwt.sign({ scope: PANEL_SCOPE, username }, JWT_SECRET, { expiresIn: '12h' })
    res.json({ success: true, data: { token, expiresInSeconds: 12 * 3600 } })
})

function adminKeyAuth(req: Request, res: Response, next: NextFunction): void {
    // Lối 1: static key
    const key = req.headers['x-admin-key'] as string
    if (ADMIN_KEY && key && safeEqual(key, ADMIN_KEY)) return next()

    // Lối 2: JWT admin-panel từ /admin/login
    const auth = req.headers.authorization
    if (auth && auth.startsWith('Bearer ') && JWT_SECRET) {
        try {
            const payload = jwt.verify(auth.slice(7), JWT_SECRET, { algorithms: ['HS256'] }) as any
            if (payload?.scope === PANEL_SCOPE) return next()
        } catch { /* sai/hết hạn → 403 bên dưới */ }
    }

    if (!ADMIN_KEY && !JWT_SECRET) {
        res.status(503).json({ success: false, error: 'Admin API not configured' })
        return
    }
    res.status(403).json({ success: false, error: 'Unauthorized' })
}

router.use(adminKeyAuth)

// Use registryPrisma for cross-store operations
const prisma = registryPrisma

// ─── GET /admin/stats ─────────────────────────────────────────────────────────
router.get('/stats', async (_req: Request, res: Response) => {
    try {
        const now = new Date()
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)

        const [totalStores, activeStores, suspendedStores, newStoresThisMonth, allStores] = await chayTheoDot([
            () => prisma.store.count(),
            () => prisma.store.count({ where: { status: 'active' } }),
            () => prisma.store.count({ where: { status: { in: ['suspended', 'inactive'] } } }),
            () => prisma.store.count({ where: { createdAt: { gte: startOfMonth } } }),
            () => prisma.store.findMany({ select: { schema: true } }),
        ])

        // Count users + branches across all store schemas
        let totalUsers = 0
        let totalBranches = 0
        await Promise.all(allStores.map(async (s) => {
            try {
                const sp = getStorePrisma(s.schema)
                const [uCount, bCount] = await Promise.all([
                    sp.user.count(),
                    sp.branch.count(),
                ])
                totalUsers += uCount
                totalBranches += bCount
            } catch { /* skip schemas not initialized */ }
        }))

        res.json({ success: true, data: { totalStores, activeStores, suspendedStores, newStoresThisMonth, totalUsers, totalBranches } })
    } catch (err) {
        console.error('Admin stats error:', err)
        res.status(500).json({ success: false, error: 'Internal server error', detail: (err as any)?.message || String(err) })
    }
})

// ─── GET /admin/stores ─────────────────────────────────────────────────────────
router.get('/stores', async (req: Request, res: Response) => {
    try {
        const search = (req.query.search as string) || ''
        const status = (req.query.status as string) || 'all'
        const page = Math.max(1, parseInt(req.query.page as string) || 1)
        const pageSize = Math.min(100, parseInt(req.query.pageSize as string) || 20)
        const skip = (page - 1) * pageSize

        const where: any = {}
        if (status && status !== 'all') where.status = status
        if (search) {
            where.OR = [
                { name: { contains: search, mode: 'insensitive' } },
                { code: { contains: search, mode: 'insensitive' } },
            ]
        }

        const [rawItems, total] = await Promise.all([
            prisma.store.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: pageSize }),
            prisma.store.count({ where }),
        ])

        // Enrich each store with branchCount + userCount + storageUsed from its schema
        const items = await Promise.all(rawItems.map(async (store) => {
            let branchCount = 0
            let userCount = 0
            let branches: any[] = []
            let storageUsed = 0
            try {
                const sp = getStorePrisma(store.schema)
                const [bList, uCount, storageAgg] = await Promise.all([
                    sp.branch.findMany({ select: { id: true, name: true, code: true, status: true }, take: 10 }),
                    sp.user.count(),
                    (sp as any).storageFile.aggregate({ _sum: { size: true }, _count: true }).catch(() => ({ _sum: { size: 0 }, _count: 0 })),
                ])
                branches = bList
                branchCount = bList.length
                userCount = uCount
                storageUsed = storageAgg?._sum?.size || 0
            } catch { /* schema not initialized yet */ }
            return { ...store, branchCount, userCount, branches, storageUsed }
        }))

        res.json({ success: true, data: { items, total, page, pageSize } })
    } catch (err) {
        console.error('Admin list stores error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})


// ─── GET /admin/stores/:id ─────────────────────────────────────────────────────
router.get('/stores/:id', async (req: Request, res: Response) => {
    try {
        const store = await prisma.store.findUnique({ where: { id: String(req.params.id) } })
        if (!store) return res.status(404).json({ success: false, error: 'Cửa hàng không tồn tại' })

        // Get user count + branches from store schema
        const storePrisma = getStorePrisma(store.schema)
        const [users, branches] = await Promise.all([
            storePrisma.user.findMany({ select: { id: true, name: true, email: true, role: true, employeeStatus: true } }),
            storePrisma.branch.findMany({ select: { id: true, name: true, code: true, status: true, address: true } }),
        ])

        res.json({ success: true, data: { ...store, users, branches } })
    } catch (err) {
        console.error('Admin store detail error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ─── PUT /admin/stores/:id/status ──────────────────────────────────────────────
router.put('/stores/:id/status', async (req: Request, res: Response) => {
    try {
        const { status } = req.body
        if (!['active', 'inactive', 'suspended'].includes(status)) {
            return res.status(400).json({ success: false, error: 'Trạng thái không hợp lệ' })
        }
        const store = await prisma.store.findUnique({ where: { id: String(req.params.id) } })
        if (!store) return res.status(404).json({ success: false, error: 'Cửa hàng không tồn tại' })

        const updated = await prisma.store.update({ where: { id: String(req.params.id) }, data: { status } })
        invalidateStoreStatus(store.id)
        console.log(`[Admin] Store ${store.code} status → ${status}`)

        // Force-logout all users when store is suspended
        if (status === 'suspended' || status === 'inactive') {
            try {
                const result = await (prisma as any).$executeRawUnsafe(
                    `DELETE FROM "public"."RefreshToken" WHERE "storeId" = $1`, store.id
                )
                console.log(`[Admin] Purged refresh tokens for store ${store.code}: ${result} deleted`)
            } catch (err) {
                console.error('Failed to purge refresh tokens:', err)
            }
        }

        res.json({ success: true, data: updated })
    } catch (err) {
        console.error('Admin update status error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ─── PUT /admin/stores/:id/plan ───────────────────────────────────────────────
router.put('/stores/:id/plan', async (req: Request, res: Response) => {
    try {
        const { plan, addOns, extraBranches } = req.body
        const store = await prisma.store.findUnique({ where: { id: String(req.params.id) } })
        if (!store) return res.status(404).json({ success: false, error: 'Cửa hàng không tồn tại' })

        const data: any = {}
        if (plan && ['retail', 'wholesale', 'full'].includes(plan)) data.plan = plan
        if (Array.isArray(addOns)) data.addOns = JSON.stringify(addOns)
        if (typeof extraBranches === 'number') data.extraBranches = extraBranches

        const updated = await prisma.store.update({ where: { id: String(req.params.id) }, data })
        console.log(`[Admin] Store ${store.code} plan updated:`, data)
        res.json({ success: true, data: updated })
    } catch (err) {
        console.error('Admin update plan error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ─── DELETE /admin/stores/:id ──────────────────────────────────────────────────
router.delete('/stores/:id', async (req: Request, res: Response) => {
    try {
        const store = await prisma.store.findUnique({ where: { id: String(req.params.id) } })
        if (!store) return res.status(404).json({ success: false, error: 'Cửa hàng không tồn tại' })

        // Drop the store's PostgreSQL schema (cascades all tables)
        await dropStoreSchema(store.schema)
        // Delete registry entry
        await prisma.store.delete({ where: { id: store.id } })
        invalidateStoreStatus(store.id)

        console.log(`[Admin] Deleted store ${store.code} (schema: ${store.schema})`)
        res.json({ success: true, message: `Đã xóa cửa hàng "${store.name}"` })
    } catch (err) {
        console.error('Admin delete store error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ─── GET /admin/users — List ALL users across all stores ────────────────────
router.get('/users', async (_req: Request, res: Response) => {
    try {
        const stores = await prisma.store.findMany()
        const allUsers: any[] = []
        await mapWithConcurrency(stores, async (store) => {
            try {
                const sp = getStorePrisma(store.schema)
                const users = await sp.user.findMany({ include: { branch: { select: { name: true } } } })
                users.forEach(u => allUsers.push({
                    ...u, storeName: store.name, storeCode: store.code, _storeSchema: store.schema,
                    branchName: (u as any).branch?.name || null
                }))
            } catch { /* schema not ready */ }
        })
        res.json({ success: true, data: allUsers })
    } catch (err) {
        console.error('Admin list users error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ─── PUT /admin/users/:id — Update a user ───────────────────────────────────
// Prefer ?storeId= or ?storeCode= (also accepted in body) to scope the lookup
// to a single tenant schema. Without a hint we fall back to scanning every
// store schema, which is O(stores) and gets slower as the registry grows —
// log a warning so this shows up in metrics until the frontend always passes
// the hint.
router.put('/users/:id', async (req: Request, res: Response) => {
    try {
        const { id } = req.params
        const { password, phone, email } = req.body
        const storeIdHint = String(req.query.storeId || req.body?.storeId || '').trim() || null
        const storeCodeHint = String(req.query.storeCode || req.body?.storeCode || '').trim() || null

        const updateUser = async (sp: any) => {
            const user = await sp.user.findUnique({ where: { id: String(id) } })
            if (!user) return false
            const data: any = {}
            if (password) {
                const bcrypt = await import('bcryptjs')
                data.password = await bcrypt.hash(password, 10)
            }
            if (phone !== undefined) data.phone = phone
            if (email !== undefined) data.email = email
            await sp.user.update({ where: { id: String(id) }, data })
            return true
        }

        // Fast path: caller scoped the request to a specific store
        if (storeIdHint || storeCodeHint) {
            const store = await prisma.store.findUnique({
                where: storeIdHint ? { id: storeIdHint } : { code: storeCodeHint! },
            })
            if (!store) return res.status(404).json({ success: false, error: 'Store not found' })
            const ok = await updateUser(getStorePrisma(store.schema))
            if (!ok) return res.status(404).json({ success: false, error: 'User not found' })
            return res.json({ success: true, message: 'Đã cập nhật' })
        }

        // Slow path: O(stores) scan — early-exit on first match
        console.warn('[Admin] PUT /users/:id called without storeId/storeCode hint — scanning all schemas')
        const stores = await prisma.store.findMany()
        for (const store of stores) {
            try {
                if (await updateUser(getStorePrisma(store.schema))) {
                    return res.json({ success: true, message: 'Đã cập nhật' })
                }
            } catch { /* skip schemas that don't have the table yet */ }
        }
        return res.status(404).json({ success: false, error: 'User not found' })
    } catch (err) {
        console.error('Admin update user error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ─── POST /admin/stores/:id/branches — Add a branch to a store ─────────────
router.post('/stores/:id/branches', async (req: Request, res: Response) => {
    try {
        const store = await prisma.store.findUnique({ where: { id: String(req.params.id) } })
        if (!store) return res.status(404).json({ success: false, error: 'Store not found' })
        const sp = getStorePrisma(store.schema)
        const { name, code, address, phone } = req.body
        if (!name || !code) return res.status(400).json({ success: false, error: 'Tên và mã bắt buộc' })
        const branch = await sp.branch.create({
            data: { name, code, address: address || null, phone: phone || null, status: 'active' },
        })
        res.json({ success: true, data: branch })
    } catch (err: any) {
        if (err?.code === 'P2002') return res.status(409).json({ success: false, error: 'Mã chi nhánh đã tồn tại' })
        console.error('Admin add branch error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ─── PUT /admin/branches/:id — Update branch status/info ────────────────────
router.put('/branches/:id', async (req: Request, res: Response) => {
    try {
        const { id } = req.params
        const stores = await prisma.store.findMany()
        for (const store of stores) {
            try {
                const sp = getStorePrisma(store.schema)
                const branch = await sp.branch.findUnique({ where: { id: String(id) } })
                if (branch) {
                    await sp.branch.update({ where: { id: String(id) }, data: req.body })
                    return res.json({ success: true, message: 'Đã cập nhật chi nhánh' })
                }
            } catch { /* skip */ }
        }
        res.status(404).json({ success: false, error: 'Branch not found' })
    } catch (err) {
        console.error('Admin update branch error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ─── DELETE /admin/branches/:id — Delete a branch ───────────────────────────
router.delete('/branches/:id', async (req: Request, res: Response) => {
    try {
        const { id } = req.params
        const stores = await prisma.store.findMany()
        for (const store of stores) {
            try {
                const sp = getStorePrisma(store.schema)
                const branch = await sp.branch.findUnique({ where: { id: String(id) } })
                if (branch) {
                    await sp.branch.delete({ where: { id: String(id) } })
                    return res.json({ success: true, message: 'Đã xóa chi nhánh' })
                }
            } catch { /* skip */ }
        }
        res.status(404).json({ success: false, error: 'Branch not found' })
    } catch (err) {
        console.error('Admin delete branch error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ─── GET /admin/branch-requests — List ALL branch requests (cross-schema) ───
router.get('/branch-requests', async (req: Request, res: Response) => {
    try {
        const statusFilter = (req.query.status as string) || 'all'
        const stores = await prisma.store.findMany()
        const allRequests: any[] = []
        await mapWithConcurrency(stores, async (store) => {
            try {
                const sp = getStorePrisma(store.schema)
                const rows: any[] = await (sp as any).$queryRawUnsafe(
                    `SELECT * FROM "BranchRequest" ${statusFilter !== 'all' ? `WHERE "status" = $1` : ''} ORDER BY "createdAt" DESC`,
                    ...(statusFilter === 'all' ? [] : [statusFilter])
                ).catch(() => [])
                rows.forEach(r => allRequests.push({ ...r, storeName: store.name, storeCode: store.code, _storeSchema: store.schema }))
            } catch { /* table might not exist */ }
        })
        allRequests.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        res.json({ success: true, data: allRequests })
    } catch (err) {
        console.error('Admin list branch requests error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ─── PUT /admin/branch-requests/:id/approve ─────────────────────────────────
router.put('/branch-requests/:id/approve', async (req: Request, res: Response) => {
    try {
        const { id } = req.params
        const stores = await prisma.store.findMany()
        for (const store of stores) {
            try {
                const sp = getStorePrisma(store.schema)
                const rows: any[] = await (sp as any).$queryRawUnsafe(`SELECT * FROM "BranchRequest" WHERE "id" = $1`, id)
                if (rows.length > 0) {
                    const request = rows[0]
                    // Update status
                    await (sp as any).$executeRawUnsafe(`UPDATE "BranchRequest" SET "status" = 'approved', "updatedAt" = NOW() WHERE "id" = $1`, id)
                    // Create the branch
                    await sp.branch.create({
                        data: {
                            name: request.branchName || request.name || 'Chi nhánh mới',
                            code: request.branchCode || request.code || `${store.code}-CN${Date.now()}`,
                            address: request.address || null,
                            phone: request.phone || null,
                            status: 'active',
                        },
                    })
                    // Notify
                    try {
                        await sp.notification.create({
                            data: { title: '✅ Yêu cầu mở chi nhánh đã được duyệt', message: `Chi nhánh "${request.branchName || request.name}" đã được tạo.`, type: 'success' },
                        })
                    } catch { /* notification table might not exist */ }
                    return res.json({ success: true, message: 'Đã duyệt và tạo chi nhánh' })
                }
            } catch { /* skip */ }
        }
        res.status(404).json({ success: false, error: 'Request not found' })
    } catch (err) {
        console.error('Admin approve branch request error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ─── PUT /admin/branch-requests/:id/reject ──────────────────────────────────
router.put('/branch-requests/:id/reject', async (req: Request, res: Response) => {
    try {
        const { id } = req.params
        const { reason } = req.body
        const stores = await prisma.store.findMany()
        for (const store of stores) {
            try {
                const sp = getStorePrisma(store.schema)
                const rows: any[] = await (sp as any).$queryRawUnsafe(`SELECT * FROM "BranchRequest" WHERE "id" = $1`, id)
                if (rows.length > 0) {
                    await (sp as any).$executeRawUnsafe(
                        `UPDATE "BranchRequest" SET "status" = 'rejected', "rejectedReason" = $1, "updatedAt" = NOW() WHERE "id" = $2`,
                        reason || '', id
                    )
                    try {
                        await sp.notification.create({
                            data: { title: '❌ Yêu cầu mở chi nhánh bị từ chối', message: `Yêu cầu mở chi nhánh đã bị từ chối.${reason ? ` Lý do: ${reason}` : ''}`, type: 'warning' },
                        })
                    } catch { /* skip */ }
                    return res.json({ success: true, message: 'Đã từ chối' })
                }
            } catch { /* skip */ }
        }
        res.status(404).json({ success: false, error: 'Request not found' })
    } catch (err) {
        console.error('Admin reject branch request error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ─── GET /admin/branch-delete-requests — List ALL branch delete requests ────
router.get('/branch-delete-requests', async (req: Request, res: Response) => {
    try {
        const statusFilter = (req.query.status as string) || 'all'
        const stores = await prisma.store.findMany()
        const allRequests: any[] = []
        await mapWithConcurrency(stores, async (store) => {
            try {
                const sp = getStorePrisma(store.schema)
                const rows: any[] = await (sp as any).$queryRawUnsafe(
                    `SELECT * FROM "BranchDeleteRequest" ${statusFilter !== 'all' ? `WHERE "status" = $1` : ''} ORDER BY "createdAt" DESC`,
                    ...(statusFilter === 'all' ? [] : [statusFilter])
                ).catch(() => [])
                rows.forEach(r => allRequests.push({ ...r, storeName: store.name, storeCode: store.code, _storeSchema: store.schema }))
            } catch { /* table might not exist */ }
        })
        allRequests.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        res.json({ success: true, data: allRequests })
    } catch (err) {
        console.error('Admin list branch delete requests error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ─── PUT /admin/branch-delete-requests/:id/approve ──────────────────────────
router.put('/branch-delete-requests/:id/approve', async (req: Request, res: Response) => {
    try {
        const { id } = req.params
        const stores = await prisma.store.findMany()
        for (const store of stores) {
            try {
                const sp = getStorePrisma(store.schema)
                const rows: any[] = await (sp as any).$queryRawUnsafe(`SELECT * FROM "BranchDeleteRequest" WHERE "id" = $1`, id)
                if (rows.length > 0) {
                    const request = rows[0]
                    await (sp as any).$executeRawUnsafe(`UPDATE "BranchDeleteRequest" SET "status" = 'approved', "updatedAt" = NOW() WHERE "id" = $1`, id)
                    // Actually delete the branch
                    try {
                        if (request.branchId) await sp.branch.delete({ where: { id: String(request.branchId) } })
                    } catch { /* branch might already be deleted */ }
                    try {
                        await sp.notification.create({
                            data: { title: '✅ Yêu cầu xóa chi nhánh đã được duyệt', message: `Chi nhánh "${request.branchName || ''}" đã được xóa.`, type: 'success' },
                        })
                    } catch { /* skip */ }
                    return res.json({ success: true, message: 'Đã duyệt xóa chi nhánh' })
                }
            } catch { /* skip */ }
        }
        res.status(404).json({ success: false, error: 'Request not found' })
    } catch (err) {
        console.error('Admin approve branch delete request error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ─── PUT /admin/branch-delete-requests/:id/reject ───────────────────────────
router.put('/branch-delete-requests/:id/reject', async (req: Request, res: Response) => {
    try {
        const { id } = req.params
        const { reason } = req.body
        const stores = await prisma.store.findMany()
        for (const store of stores) {
            try {
                const sp = getStorePrisma(store.schema)
                const rows: any[] = await (sp as any).$queryRawUnsafe(`SELECT * FROM "BranchDeleteRequest" WHERE "id" = $1`, id)
                if (rows.length > 0) {
                    await (sp as any).$executeRawUnsafe(
                        `UPDATE "BranchDeleteRequest" SET "status" = 'rejected', "rejectedReason" = $1, "updatedAt" = NOW() WHERE "id" = $2`,
                        reason || '', id
                    )
                    try {
                        await sp.notification.create({
                            data: { title: '❌ Yêu cầu xóa chi nhánh bị từ chối', message: `Yêu cầu xóa chi nhánh đã bị từ chối.${reason ? ` Lý do: ${reason}` : ''}`, type: 'warning' },
                        })
                    } catch { /* skip */ }
                    return res.json({ success: true, message: 'Đã từ chối' })
                }
            } catch { /* skip */ }
        }
        res.status(404).json({ success: false, error: 'Request not found' })
    } catch (err) {
        console.error('Admin reject branch delete request error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ─── POST /admin/reset-db — Wipe all data (DEVELOPMENT ONLY) ────────────────
if (process.env.NODE_ENV === 'development') {
    router.post('/reset-db', async (_req: Request, res: Response) => {
        try {
            console.log('⚠️ RESET DB: Deleting all stores and their schemas...')
            const stores = await prisma.store.findMany()
            for (const store of stores) {
                try {
                    await dropStoreSchema(store.schema)
                    console.log(`  🗑️ Dropped: ${store.schema}`)
                } catch { }
            }
            await prisma.store.deleteMany({})
            console.log('✅ All stores deleted')
            res.json({ success: true, message: 'Database reset complete', deleted: stores.length })
        } catch (err: any) {
            console.error('Reset DB error:', err)
            res.status(500).json({ success: false, error: errMsg(err, 'Reset failed') })
        }
    })
} else {
    router.post('/reset-db', (_req: Request, res: Response) => {
        res.status(403).json({ success: false, error: 'This endpoint is disabled in production' })
    })
}

// ─── POST /admin/sync-schemas — prisma db push for every branch schema ───────
// Brings ALL existing branch schemas up to date with schema-store.prisma
// (new tables like ChartOfAccount, new columns like FixedAsset.residualValue).
// Body (optional): { schema: "branch_xxx" } to sync a single schema.
router.post('/sync-schemas', async (req: Request, res: Response) => {
    try {
        let schemas: string[]
        if (req.body?.schema) {
            schemas = [String(req.body.schema)]
        } else {
            const rows = await (prisma as any).$queryRawUnsafe(
                `SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'branch_%' ORDER BY schema_name`
            ) as { schema_name: string }[]
            schemas = rows.map(r => r.schema_name)
        }

        const results: { schema: string; status: string; ms: number; dropped?: string[] }[] = []
        for (const schema of schemas) {
            const t0 = Date.now()
            const dropped: string[] = []
            // db push can collide with legacy index/constraint names that drifted
            // from the Prisma naming (e.g. an index where a unique constraint is
            // expected). Drop the conflicting relation and retry — push recreates
            // it in the correct shape. Only _key/_idx names are eligible.
            let lastErr = ''
            let ok = false
            for (let attempt = 0; attempt < 6; attempt++) {
                try {
                    await syncBranchSchemaTables(schema)
                    ok = true
                    break
                } catch (e: any) {
                    lastErr = (e.stderr?.toString?.() || e.message || '')
                    const m = lastErr.match(/relation "([^"]+)" already exists/)
                    const rel = m?.[1]
                    if (!rel || !/_key$|_idx$/.test(rel) || dropped.includes(rel)) break
                    try {
                        await (prisma as any).$executeRawUnsafe(`DROP INDEX IF EXISTS "${schema}"."${rel}"`)
                    } catch {
                        // Constraint-backed index: derive the table from the name prefix
                        const table = rel.split('_')[0]
                        await (prisma as any).$executeRawUnsafe(`ALTER TABLE "${schema}"."${table}" DROP CONSTRAINT IF EXISTS "${rel}"`).catch(() => { })
                    }
                    dropped.push(rel)
                }
            }
            results.push({
                schema,
                status: ok ? 'ok' : `error: ${lastErr.slice(0, 500)}`,
                ms: Date.now() - t0,
                ...(dropped.length ? { dropped } : {}),
            })
        }

        const failed = results.filter(r => r.status !== 'ok')
        res.json({ success: failed.length === 0, synced: results.length - failed.length, failed: failed.length, results })
    } catch (err: any) {
        console.error('Sync schemas error:', err)
        res.status(500).json({ success: false, error: errMsg(err, 'Sync schemas failed') })
    }
})

// ─── POST /admin/migrate — Add new columns to registry + store schemas ───────
// ─── POST /admin/adjust-stock ────────────────────────────────────────────────
// Sửa tồn MỘT mã hàng về con số chỉ định — cho các ca dữ liệu hỏng đã điều tra
// (vd CC095 = -300 ghi thẳng từ file import có số âm, chưa từng bán/nhập).
//
// Body: { storeCode, sku, setTo, reason, apply?: true }
//   - không có apply → DRY-RUN: chỉ báo sẽ đổi gì
//   - apply → đổi Product.stock VÀ WarehouseStock[kho main mặc định] CÙNG MỘT
//     DELTA trong 1 transaction (giữ bất biến kho), ghi InventoryTransaction
//     type 'adjustment' để có dấu vết trên thẻ kho.
// KHÔNG nhận mảng — mỗi lần một mã, ép người gọi nhìn từng con số.
router.post('/adjust-stock', async (req: Request, res: Response) => {
    try {
        const { storeCode, sku, setTo, reason, apply } = req.body || {}
        const laSync = req.body?.mode === 'sync_main'
        if (!storeCode || !sku || !reason || (!laSync && !Number.isFinite(Number(setTo)))) {
            return res.status(400).json({ success: false, error: 'Cần storeCode, sku, reason (+ setTo là số, trừ mode sync_main)' })
        }
        const store = await prisma.store.findFirst({ where: { code: { equals: String(storeCode), mode: 'insensitive' } } })
        if (!store) return res.status(404).json({ success: false, error: `Không tìm thấy store "${storeCode}"` })
        const sp: any = getStorePrisma(store.schema)

        const p = await sp.product.findFirst({ where: { sku: String(sku) } })
        if (!p) return res.status(404).json({ success: false, error: `Không tìm thấy mã "${sku}" ở ${store.code}` })

        // MODE sync_main: KHÔNG đổi tồn tổng — chỉnh kho main mặc định sao cho
        // TỔNG các kho main == Product.stock (chữa lệch 1-2 đơn vị do race).
        // Phải đọc stock BÊN TRONG transaction: store đang bán thật, truyền số
        // cứng từ ngoài vào là tạo tồn ma (dry-run từng bắt được stock đổi từ
        // -650 thành -655 chỉ trong vài giờ).
        if (req.body?.mode === 'sync_main') {
            const ketQua = await sp.$transaction(async (tx: any) => {
                const now = await tx.product.findUnique({ where: { id: p.id }, select: { stock: true } })
                const mains = await tx.warehouse.findMany({
                    where: { type: 'main', isActive: true }, select: { id: true, code: true, isDefault: true, branchId: true },
                })
                const rows = await tx.warehouseStock.findMany({
                    where: { productId: p.id, warehouseId: { in: mains.map((m: any) => m.id) } },
                })
                const tong = rows.reduce((s: number, r: any) => s + r.quantity, 0)
                const lech = now.stock - tong
                const nhanhChinh2 = await tx.branch.findFirst({ where: { isMainBranch: true }, select: { id: true } }).catch(() => null)
                const dich = mains.find((m: any) => m.isDefault && (!nhanhChinh2?.id || m.branchId === nhanhChinh2.id)) || mains.find((m: any) => m.isDefault)
                if (!dich) throw new Error('Không tìm thấy kho main mặc định')
                const dong = rows.find((r: any) => r.warehouseId === dich.id)
                const ke = {
                    store: store.code, sku: p.sku, ten: p.name, mode: 'sync_main',
                    tonTong: now.stock, tongCacKhoMain: tong, lech,
                    khoChinh: dich.code, khoChinhTruoc: dong?.quantity ?? 0, khoChinhSau: (dong?.quantity ?? 0) + lech,
                }
                if (!apply || lech === 0) return { ...ke, daDoi: false }
                await tx.warehouseStock.upsert({
                    where: { warehouseId_productId: { warehouseId: dich.id, productId: p.id } },
                    create: { warehouseId: dich.id, productId: p.id, productName: p.name, productSku: p.sku, quantity: (dong?.quantity ?? 0) + lech },
                    update: { quantity: { increment: lech } },
                })
                await tx.inventoryTransaction.create({
                    data: {
                        type: 'adjustment', productId: p.id, productName: p.name, productSku: p.sku,
                        quantity: 0, reason: `Admin sync_main: ${String(reason)}`,
                        note: `kho ${dich.code} ${dong?.quantity ?? 0} → ${(dong?.quantity ?? 0) + lech} (tồn tổng ${now.stock} giữ nguyên)`,
                        userName: 'Admin (adjust-stock)',
                    },
                })
                return { ...ke, daDoi: true }
            })
            return res.json({ success: true, cheDo: apply ? (ketQua.daDoi ? 'ĐÃ ĐỒNG BỘ' : 'không lệch — không đổi gì') : 'DRY-RUN — chưa đổi gì', keHoach: ketQua })
        }

        // Kho main mặc định của CHI NHÁNH CHÍNH (đúng resolver POS dùng)
        const nhanhChinh = await sp.branch.findFirst({ where: { isMainBranch: true }, select: { id: true } }).catch(() => null)
        const kho = await sp.warehouse.findFirst({
            where: { type: 'main', isDefault: true, isActive: true, ...(nhanhChinh?.id ? { branchId: nhanhChinh.id } : {}) },
        })
        if (!kho) return res.status(500).json({ success: false, error: 'Không tìm thấy kho main mặc định — không dám đổi tồn' })

        const ws = await sp.warehouseStock.findUnique({
            where: { warehouseId_productId: { warehouseId: kho.id, productId: p.id } },
        }).catch(() => null)

        const delta = Number(setTo) - p.stock
        const keHoach = {
            store: store.code, sku: p.sku, ten: p.name,
            tonHienTai: p.stock, tonKhoChinh: ws?.quantity ?? '(chưa có dòng)',
            setTo: Number(setTo), delta,
            kho: kho.code,
            canhBaoLech: ws && ws.quantity !== p.stock ? `Kho chính (${ws.quantity}) đang LỆCH tồn tổng (${p.stock}) — sau khi đổi cả hai đều = ${Number(setTo)}` : null,
        }
        if (!apply) return res.json({ success: true, cheDo: 'DRY-RUN — chưa đổi gì', keHoach })
        if (delta === 0 && ws && ws.quantity === Number(setTo)) {
            return res.json({ success: true, cheDo: 'không cần đổi', keHoach })
        }

        await sp.$transaction(async (tx: any) => {
            await tx.product.update({ where: { id: p.id }, data: { stock: Number(setTo) } })
            // Đặt THẲNG kho chính = setTo (không cộng delta): nếu đang lệch sẵn thì
            // lần sửa này đồng thời chữa luôn độ lệch, sau đó bất biến khớp tuyệt đối.
            await tx.warehouseStock.upsert({
                where: { warehouseId_productId: { warehouseId: kho.id, productId: p.id } },
                create: { warehouseId: kho.id, productId: p.id, productName: p.name, productSku: p.sku, quantity: Number(setTo) },
                update: { quantity: Number(setTo) },
            })
            await tx.inventoryTransaction.create({
                data: {
                    type: 'adjustment', productId: p.id, productName: p.name, productSku: p.sku,
                    quantity: delta, reason: `Admin điều chỉnh: ${String(reason)}`,
                    note: `stock ${p.stock} → ${Number(setTo)} (kho ${kho.code} đặt = ${Number(setTo)})`,
                    userName: 'Admin (adjust-stock)',
                },
            })
        })
        res.json({ success: true, cheDo: 'ĐÃ ÁP DỤNG', keHoach })
    } catch (err: any) {
        console.error('[admin] adjust-stock:', err?.message)
        res.status(500).json({ success: false, error: err?.message || 'Internal server error' })
    }
})

// ─── POST /admin/cleanup-orphan-warehouses ───────────────────────────────────
// Dọn "kho chính mồ côi": kho type=main, isDefault=true, branchId=NULL do bước
// boot-seed lúc tạo store sinh ra. Khi chi nhánh chính đã có kho main riêng thì
// kho mồ côi này KHÔNG bao giờ được resolver chọn (xem getOrCreateDefaultWarehouse)
// nên nằm im — nhưng là mìn: nếu kho thật bị xoá/bỏ cờ mặc định, chi nhánh chính
// sẽ "nhận" kho rỗng này và tồn trông như bốc hơi.
//
// MẶC ĐỊNH CHỈ CHẠY THỬ (dry-run). Body:
//   { storeCode?, apply?: true, hard?: true }
//   - không có apply  → chỉ báo cáo, không đụng dữ liệu
//   - apply           → BỎ CỜ mặc định + ngưng hoạt động (đảo ngược được)
//   - apply + hard    → XOÁ HẲN, chỉ khi kho rỗng và không bị tham chiếu
//
// Ưu tiên vô hiệu hoá thay vì xoá: StockTransfer/SalesTrip trỏ tới Warehouse
// KHÔNG có onDelete cascade → xoá cứng sẽ vỡ khoá ngoại nếu lỡ có tham chiếu.
// ─── GET /admin/warehouse-stock?storeCode= ──────────────────────────────────
/**
 * CHỈ ĐỌC: tồn của TỪNG kho, kèm chi nhánh nào đang giữ nó.
 *
 * Có route này vì khi đi soi cặp kho trùng ở HUTI (10/08/2026) không có cách
 * nào nhìn được kho nào ôm hàng thật, kho nào rỗng — mà đó là câu hỏi bắt buộc
 * phải trả lời TRƯỚC khi gộp hay xoá kho.
 */
router.get('/warehouse-stock', async (req: Request, res: Response) => {
    try {
        const storeCode = String(req.query.storeCode || '').trim()
        if (!storeCode) return res.status(400).json({ success: false, error: 'Thiếu storeCode' })
        const store = await prisma.store.findFirst({
            where: { code: { equals: storeCode, mode: 'insensitive' } },
            select: { code: true, name: true, schema: true },
        })
        if (!store) return res.status(404).json({ success: false, error: 'Không tìm thấy cửa hàng' })

        const sp: any = getStorePrisma(store.schema)
        const [khos, branches] = await Promise.all([
            sp.warehouse.findMany({
                select: {
                    id: true, code: true, name: true, type: true,
                    isDefault: true, isActive: true, branchId: true, vehicleId: true,
                },
                orderBy: [{ type: 'asc' }, { code: 'asc' }],
            }),
            sp.branch.findMany({ select: { id: true, code: true, name: true, isMainBranch: true } }).catch(() => []),
        ])
        const tenChiNhanh: Record<string, string> = {}
        for (const b of branches) tenChiNhanh[b.id] = `${b.name} (${b.code})${b.isMainBranch ? ' — CHÍNH' : ''}`

        const ketQua = []
        for (const w of khos) {
            const [soDong, khac0, tong] = await Promise.all([
                sp.warehouseStock.count({ where: { warehouseId: w.id } }),
                sp.warehouseStock.count({ where: { warehouseId: w.id, quantity: { not: 0 } } }),
                sp.warehouseStock.aggregate({ where: { warehouseId: w.id }, _sum: { quantity: true } })
                    .then((r: any) => Number(r?._sum?.quantity) || 0).catch(() => 0),
            ])
            ketQua.push({
                ma: w.code, ten: w.name, loai: w.type,
                macDinh: w.isDefault, dangHoatDong: w.isActive,
                chiNhanh: w.branchId ? (tenChiNhanh[w.branchId] || w.branchId) : '(mồ côi — không gắn chi nhánh)',
                ganXe: !!w.vehicleId,
                soDongTon: soDong, soMaCoTon: khac0, tongSoLuong: tong,
            })
        }
        /**
         * BẤT BIẾN TỒN KHO: Product.stock == tổng WarehouseStock của các kho
         * `main`. Không đối chiếu con số này thì không thể biết một kho main
         * thứ hai là DỮ LIỆU THẬT hay BẢN SAO THỪA — mà đó là câu hỏi sống còn
         * trước khi gộp hay xoá kho (HUTI 10/08/2026: hai kho main, một cái
         * 128.616 một cái 125.035).
         */
        const [soSp, tongTonSp] = await Promise.all([
            sp.product.count(),
            sp.product.aggregate({ _sum: { stock: true } })
                .then((r: any) => Number(r?._sum?.stock) || 0).catch(() => 0),
        ])
        const tongKhoMain = ketQua
            .filter(k => k.loai === 'main')
            .reduce((s, k) => s + k.tongSoLuong, 0)

        res.json({
            success: true,
            data: {
                store: store.code,
                soChiNhanh: branches.length,
                chiNhanh: branches.map((b: any) => `${b.name} (${b.code})${b.isMainBranch ? ' — CHÍNH' : ''}`),
                soKho: khos.length,
                kho: ketQua,
                batBien: {
                    soSanPham: soSp,
                    tongProductStock: tongTonSp,
                    tongKhoMain,
                    lech: tongKhoMain - tongTonSp,
                    khop: tongKhoMain === tongTonSp,
                },
            },
        })
    } catch (err: any) {
        console.error('[admin] warehouse-stock:', err?.message)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

router.post('/cleanup-orphan-warehouses', async (req: Request, res: Response) => {
    try {
        const { storeCode, apply, hard } = req.body || {}
        const stores = await prisma.store.findMany({
            where: storeCode
                ? { code: { equals: String(storeCode), mode: 'insensitive' } }
                : { status: 'active' },
        })
        if (!stores.length) return res.status(404).json({ success: false, error: 'Không tìm thấy store' })

        const ketQua: any[] = []
        for (const store of stores) {
            const sp: any = getStorePrisma(store.schema)
            try {
                const moCoi = await sp.warehouse.findMany({
                    where: { type: 'main', branchId: null },
                    select: { id: true, code: true, name: true, isDefault: true, isActive: true, vehicleId: true },
                })
                if (!moCoi.length) { ketQua.push({ store: store.code, moCoi: 0 }); continue }

                const chiTiet: any[] = []
                for (const w of moCoi) {
                    // Đếm MỌI thứ đang trỏ tới kho này trước khi động vào
                    /* Vòng lặp này chạy cho TỪNG kho mồ côi của TỪNG cửa hàng —
                     * bắn 5 truy vấn một lượt ở đây là nhân lên rất nhanh. Chia
                     * đợt để tối đa 3 kết nối bất kể có bao nhiêu kho. */
                    const [soTon, tonKhac0, chuyenTu, chuyenDen, chuyenDi] = await chayTheoDot([
                        () => sp.warehouseStock.count({ where: { warehouseId: w.id } }),
                        () => sp.warehouseStock.count({ where: { warehouseId: w.id, quantity: { not: 0 } } }),
                        () => sp.stockTransfer.count({ where: { fromWarehouseId: w.id } }).catch(() => 0),
                        () => sp.stockTransfer.count({ where: { toWarehouseId: w.id } }).catch(() => 0),
                        () => sp.salesTrip.count({ where: { warehouseId: w.id } }).catch(() => 0),
                    ])
                    // Chi nhánh chính đã có kho main riêng chưa? Chưa thì kho mồ côi
                    // này ĐANG được dùng thật — tuyệt đối không đụng.
                    const nhanhChinh = await sp.branch.findFirst({ where: { isMainBranch: true }, select: { id: true } }).catch(() => null)
                    const khoThat = nhanhChinh?.id
                        ? await sp.warehouse.findFirst({ where: { type: 'main', isDefault: true, branchId: nhanhChinh.id }, select: { id: true, code: true } })
                        : null

                    const canTro: string[] = []
                    /**
                     * Rào "chi nhánh chính chưa có kho riêng" chỉ để bảo vệ kho
                     * ĐANG ĐƯỢC DÙNG làm kho mặc định. Áp cho MỌI kho mồ côi là
                     * chặn nhầm: kho mồ côi KHÔNG mặc định và RỖNG thì chẳng ai
                     * dùng, chặn lại chỉ khiến rác nằm mãi (đo 10/08/2026:
                     * HUTITAX có kho "HH" 0 tồn mà công cụ từ chối dọn).
                     */
                    if (!khoThat && w.isDefault) canTro.push('Chi nhánh chính CHƯA có kho main riêng — kho này đang là kho thật, không được dọn')
                    if (tonKhac0 > 0) canTro.push(`Còn ${tonKhac0} mã hàng có tồn khác 0`)
                    if (w.vehicleId) canTro.push('Đang gắn với một xe')
                    if (hard && (chuyenTu + chuyenDen + chuyenDi) > 0) {
                        canTro.push(`Bị tham chiếu bởi ${chuyenTu + chuyenDen} phiếu chuyển kho và ${chuyenDi} chuyến bán hàng — không xoá cứng được`)
                    }

                    const muc: any = {
                        ma: w.code, ten: w.name, isDefault: w.isDefault, isActive: w.isActive,
                        soDongTon: soTon, soDongTonKhac0: tonKhac0,
                        phieuChuyenKho: chuyenTu + chuyenDen, chuyenBanHang: chuyenDi,
                        khoThatCuaNhanhChinh: khoThat?.code || null,
                        antoanDeDon: canTro.length === 0,
                        canTro,
                    }

                    if (apply && !canTro.length) {
                        if (hard) {
                            await sp.warehouseStock.deleteMany({ where: { warehouseId: w.id } })
                            await sp.warehouse.delete({ where: { id: w.id } })
                            muc.daLam = 'ĐÃ XOÁ HẲN'
                        } else {
                            await sp.warehouse.update({ where: { id: w.id }, data: { isDefault: false, isActive: false } })
                            muc.daLam = 'Đã bỏ cờ mặc định + ngưng hoạt động (bật lại được)'
                        }
                    } else if (apply) {
                        muc.daLam = 'BỎ QUA — chưa an toàn'
                    } else {
                        muc.daLam = 'chạy thử, chưa đụng gì'
                    }
                    chiTiet.push(muc)
                }
                ketQua.push({ store: store.code, moCoi: moCoi.length, chiTiet })
            } catch (e: any) {
                ketQua.push({ store: store.code, loi: e?.message?.slice(0, 160) })
            }
        }
        res.json({
            success: true,
            cheDo: apply ? (hard ? 'XOÁ HẲN' : 'vô hiệu hoá (đảo ngược được)') : 'CHẠY THỬ — không đụng dữ liệu',
            ketQua,
        })
    } catch (err: any) {
        console.error('[admin] cleanup-orphan-warehouses:', err?.message)
        res.status(500).json({ success: false, error: err?.message || 'Internal server error' })
    }
})

// ─── POST /admin/gieo-he-tai-khoan ──────────────────────────────────────────
/**
 * Gieo hệ tài khoản TT99 cho MỌI cửa hàng còn trống (26/08/2026, chủ shop:
 * "tất cả các cửa hàng đều phải có chứ"). Bổ trợ cho gieo-lười ở GET
 * /api/accounts — gieo lười lo cửa hàng TƯƠNG LAI, endpoint này quét một
 * lượt cho cửa hàng HIỆN CÓ khỏi chờ ai mở trang. Idempotent: có rồi thì thôi.
 */
router.post('/gieo-he-tai-khoan', async (req: Request, res: Response) => {
    try {
        const { damBaoHeTaiKhoan } = await import('./accounts')
        const stores = await prisma.store.findMany({ where: { status: 'active' }, select: { code: true, schema: true } })
        const ketQua: any[] = []
        for (const st of stores) {
            try {
                const sp: any = getStorePrisma(st.schema)
                const r = await damBaoHeTaiKhoan(sp)
                ketQua.push({ store: st.code, truoc: r.truoc, sau: r.sau, daGieo: r.truoc === 0 && r.sau > 0 })
            } catch (e: any) {
                ketQua.push({ store: st.code, loi: e?.message?.slice(0, 120) })
            }
        }
        res.json({ success: true, ketQua })
    } catch (err: any) {
        console.error('[admin] gieo-he-tai-khoan:', err?.message)
        res.status(500).json({ success: false, error: err?.message || 'Internal server error' })
    }
})

// ─── POST /admin/gop-kho-chinh ───────────────────────────────────────────────
/**
 * HỢP NHẤT KHO CHÍNH — chữa bệnh "một cửa hàng HAI kho chính" (đo HUTI 25/08/2026).
 *
 * Bệnh: boot-seed tạo kho main KHÔNG gắn chi nhánh (mồ côi); tạo chi nhánh chính
 * lại đẻ kho main thứ hai. Hai luồng ghi mỗi luồng chọn một cái:
 *   - POS / nhập tay / đơn sàn → kho CHI NHÁNH CHÍNH (getOrCreateDefaultWarehouse)
 *   - Đồng bộ KiotViet (cũ)   → kho mồ côi (fallback lấy "main đầu tiên tìm thấy")
 * Đo được: kho CN01 đóng băng từ 06/08 (SHD4030 ghi 156, thật 16), kho mồ côi mới
 * là bản sống. `/cleanup-orphan-warehouses` TỪ CHỐI dọn — đúng, vì mồ côi còn tồn
 * khác 0. Cái thiếu là bước GỘP: chính là endpoint này.
 *
 * Cách gộp — thẩm quyền là Product.stock (bất biến WarehouseStock[main] == Product.stock):
 *   1. Kho ĐÍCH = kho main mặc định của chi nhánh chính (đúng kho resolver trả).
 *   2. Đặt từng dòng kho đích := Product.stock — CHỈ ghi dòng đang lệch.
 *   3. XOÁ dòng tồn kho mồ côi (bản sao cũ, không phải tồn thật nằm chỗ khác) rồi
 *      bỏ cờ mặc định + ngưng hoạt động. KHÔNG xoá cứng — StockTransfer/SalesTrip
 *      không có onDelete cascade.
 *   4. Ghim KiotVietConfig.defaultWarehouseId = kho đích — hết mơ hồ vĩnh viễn.
 *
 * KHÔNG ghi InventoryTransaction: Product.stock không đổi một li — đây là sửa BẢN
 * SAO theo kho; thẻ kho cộng dồn từ InventoryTransaction, ghi thêm dòng điều chỉnh
 * sẽ làm CONG tồn luỹ kế trong khi tồn thật đứng yên.
 *
 * RÀO: cửa hàng có >1 kho main gắn chi nhánh (đa chi nhánh giữ tồn riêng) thì
 * Product.stock là TỔNG các nơi — không đổ hết vào một kho được → báo và bỏ qua.
 *
 * Body: { storeCode?, apply?: true } — mặc định CHẠY THỬ, chỉ đếm và trả kế hoạch.
 */
router.post('/gop-kho-chinh', async (req: Request, res: Response) => {
    try {
        const { storeCode, apply } = req.body || {}
        const stores = await prisma.store.findMany({
            where: storeCode
                ? { code: { equals: String(storeCode), mode: 'insensitive' } }
                : { status: 'active' },
        })
        if (!stores.length) return res.status(404).json({ success: false, error: 'Không tìm thấy store' })

        const ketQua: any[] = []
        for (const store of stores) {
            const sp: any = getStorePrisma(store.schema)
            try {
                const nhanhChinh = await sp.branch.findFirst({ where: { isMainBranch: true }, select: { id: true, code: true } }).catch(() => null)
                const khoDich = nhanhChinh?.id
                    ? await sp.warehouse.findFirst({
                        where: { type: 'main', isDefault: true, branchId: nhanhChinh.id },
                        select: { id: true, code: true, name: true },
                    })
                    : null
                const moCoi = await sp.warehouse.findMany({
                    where: { type: 'main', branchId: null },
                    select: { id: true, code: true, isDefault: true, isActive: true },
                })
                if (!khoDich) {
                    ketQua.push({ store: store.code, boQua: 'Chi nhánh chính chưa có kho main riêng — kho mồ côi (nếu có) đang là kho thật, không gộp', soMoCoi: moCoi.length })
                    continue
                }
                if (!moCoi.length) {
                    ketQua.push({ store: store.code, ok: 'Đã đúng 1 kho chính, không có mồ côi', khoChinh: khoDich.code })
                    continue
                }
                const soMainNhanh = await sp.warehouse.count({ where: { type: 'main', isActive: true, branchId: { not: null } } })
                if (soMainNhanh > 1) {
                    ketQua.push({ store: store.code, boQua: `Có ${soMainNhanh} kho main theo chi nhánh — đa chi nhánh giữ tồn riêng, phải xử tay`, moCoi: moCoi.map((w: any) => w.code) })
                    continue
                }

                // ── Kế hoạch: kho đích lệch gì so với Product.stock ──
                const sanPham = await sp.product.findMany({ select: { id: true, sku: true, name: true, stock: true } })
                const dongDich = await sp.warehouseStock.findMany({
                    where: { warehouseId: khoDich.id }, select: { productId: true, quantity: true },
                })
                const mapDich = new Map<string, number>(dongDich.map((r: any) => [String(r.productId), Number(r.quantity) || 0]))
                const lech: Array<{ id: string; sku: string; name: string; tu: number; ve: number }> = []
                for (const p of sanPham) {
                    const dang = mapDich.get(p.id) ?? 0
                    const dung = Number(p.stock) || 0
                    if (dang !== dung) lech.push({ id: p.id, sku: p.sku, name: p.name, tu: dang, ve: dung })
                }

                const tonMoCoi: any[] = []
                for (const w of moCoi) {
                    const soDong = await sp.warehouseStock.count({ where: { warehouseId: w.id } })
                    tonMoCoi.push({ ma: w.code, macDinh: w.isDefault, dangHoatDong: w.isActive, soDongTonSeXoa: soDong })
                }

                const muc: any = {
                    store: store.code,
                    khoDich: { ma: khoDich.code, ten: khoDich.name },
                    soSanPham: sanPham.length,
                    soMaLechTruoc: lech.length,
                    viDuLech: lech.slice(0, 8).map(l => `${l.sku}: ${l.tu} → ${l.ve}`),
                    moCoi: tonMoCoi,
                }

                if (apply) {
                    // Tuần tự — PROD PRISMA_POOL_SIZE=1, tuyệt đối không Promise.all
                    for (const l of lech) {
                        await sp.warehouseStock.upsert({
                            where: { warehouseId_productId: { warehouseId: khoDich.id, productId: l.id } },
                            create: { warehouseId: khoDich.id, productId: l.id, productName: l.name, productSku: l.sku, quantity: l.ve },
                            update: { quantity: l.ve },
                        })
                    }
                    for (const w of moCoi) {
                        const daXoa = await sp.warehouseStock.deleteMany({ where: { warehouseId: w.id } })
                        await sp.warehouse.update({
                            where: { id: w.id },
                            data: {
                                isDefault: false, isActive: false,
                                description: `Đã gộp vào ${khoDich.code} (gop-kho-chinh ${new Date().toISOString().slice(0, 10)})`,
                            },
                        })
                        const t = tonMoCoi.find(x => x.ma === w.code)
                        if (t) t.daXoaDong = daXoa.count
                    }
                    const cfg = await sp.kiotVietConfig.findUnique({ where: { id: 'default' } }).catch(() => null)
                    if (cfg) {
                        await sp.kiotVietConfig.update({ where: { id: 'default' }, data: { defaultWarehouseId: khoDich.id } })
                        muc.kvGhimKho = `${cfg.defaultWarehouseId || '(chưa chọn — fallback mơ hồ)'} → ${khoDich.id}`
                    }

                    // Nghiệm thu bằng số ngay trong cùng phản hồi
                    const dongSau = await sp.warehouseStock.findMany({
                        where: { warehouseId: khoDich.id }, select: { productId: true, quantity: true },
                    })
                    const mapSau = new Map<string, number>(dongSau.map((r: any) => [String(r.productId), Number(r.quantity) || 0]))
                    let lechSau = 0
                    for (const p of sanPham) {
                        if ((mapSau.get(p.id) ?? 0) !== (Number(p.stock) || 0)) lechSau++
                    }
                    muc.soMaLechSau = lechSau
                    muc.daLam = 'ĐÃ GỘP'
                } else {
                    muc.daLam = 'chạy thử, chưa đụng gì'
                }
                ketQua.push(muc)
            } catch (e: any) {
                ketQua.push({ store: store.code, loi: e?.message?.slice(0, 160) })
            }
        }
        res.json({ success: true, cheDo: apply ? 'ĐÃ ÁP DỤNG' : 'CHẠY THỬ — không đụng dữ liệu', ketQua })
    } catch (err: any) {
        console.error('[admin] gop-kho-chinh:', err?.message)
        res.status(500).json({ success: false, error: err?.message || 'Internal server error' })
    }
})

// ─── POST /admin/kho-hu-hong-soat ────────────────────────────────────────────
/**
 * SOÁT + CHỮA KHO HƯ HỎNG ÂM (đo HUTI 25/08/2026: kho hư hỏng CN01 âm −535 ở 11 mã).
 *
 * Vì sao âm được: các luồng sửa chữa cộng/trừ kho hư hỏng THEO CẶP (đẩy vào +n,
 * nhận về −n), nhưng hai thời kỳ làm vế cộng rơi mất chỗ:
 *   1. TRƯỚC 06/08 (chưa seed kho): `if (khoHu)` bỏ qua vế cộng; sau đó kho ra
 *      đời, vế trừ chạy thật → âm.
 *   2. TRƯỚC 22/08 (khoHuHong "bốc đại"): vế cộng vào kho này, vế trừ vào kho kia.
 *
 * May là số ĐÚNG tính lại được từ chứng từ gốc, không phải đoán:
 *   đúng = Σ phiếu sửa ĐANG GIỮ hàng (stockMovedAt/replacedStockAt, chưa supplierReturned)
 *        + Σ trả hàng HƯ HỎNG (InventoryTransaction referenceType='return', reason chứa 'HƯ HỎNG')
 *        + Σ chuyển kho completed VÀO damaged − Σ chuyển RA
 * (ba nguồn GHI THẲNG WarehouseStock, không đi qua nhau → cộng không đếm trùng)
 *
 * apply: đặt kho hư hỏng CHÍNH THỨC (theo resolver khoHuHong) := số tính được,
 * xoá dòng của các kho hư hỏng khác (bản sao thời bốc đại) rồi tắt chúng.
 * Tính ra vẫn âm ⇒ đề xuất 0 + cờ 'am-sau-tinh' (chứng từ cổ hơn cả dữ liệu).
 * KHÔNG đụng Product.stock — kho hư hỏng nằm ngoài tồn bán được.
 *
 * Body: { storeCode?, apply?: true } — mặc định CHỈ BÁO CÁO.
 */
router.post('/kho-hu-hong-soat', async (req: Request, res: Response) => {
    try {
        const { storeCode, apply } = req.body || {}
        const stores = await prisma.store.findMany({
            where: storeCode
                ? { code: { equals: String(storeCode), mode: 'insensitive' } }
                : { status: 'active' },
        })
        if (!stores.length) return res.status(404).json({ success: false, error: 'Không tìm thấy store' })

        const ketQua: any[] = []
        for (const store of stores) {
            const sp: any = getStorePrisma(store.schema)
            try {
                const khoHu = await sp.warehouse.findMany({
                    where: { type: 'damaged' },
                    select: { id: true, code: true, branchId: true, isActive: true, isDefault: true },
                })
                if (!khoHu.length) { ketQua.push({ store: store.code, ok: 'Chưa có kho hư hỏng' }); continue }
                const theoNhanh = khoHu.filter((w: any) => w.branchId)
                if (theoNhanh.length > 1) {
                    ketQua.push({ store: store.code, boQua: `Có ${theoNhanh.length} kho hư hỏng theo chi nhánh — đa chi nhánh, xử tay` })
                    continue
                }
                // Kho đích = đúng kho mà resolver khoHuHong của mọi luồng đang trả
                const khoDichId = await khoHuHong(sp, null)
                const khoDich = khoHu.find((w: any) => w.id === khoDichId) || null
                if (!khoDich) { ketQua.push({ store: store.code, boQua: 'Resolver không trả kho hư hỏng đang hoạt động' }); continue }
                const idKhoHu = khoHu.map((w: any) => w.id)

                // ── Ba nguồn chứng từ (tuần tự — PROD POOL 1) ──
                const dangGiu = await sp.repair.findMany({
                    where: {
                        productId: { not: null }, supplierReturnedAt: null,
                        OR: [{ stockMovedAt: { not: null } }, { replacedStockAt: { not: null } }],
                    },
                    select: { productId: true, quantity: true, code: true },
                }).catch(() => [])
                const traHang = await sp.inventoryTransaction.findMany({
                    where: { referenceType: 'return', reason: { contains: 'HƯ HỎNG' } },
                    select: { productId: true, quantity: true },
                }).catch(() => [])
                const chuyen = await sp.stockTransfer.findMany({
                    where: {
                        status: 'completed',
                        OR: [{ toWarehouseId: { in: idKhoHu } }, { fromWarehouseId: { in: idKhoHu } }],
                    },
                    select: { toWarehouseId: true, fromWarehouseId: true, items: { select: { productId: true, quantity: true } } },
                }).catch(() => [])
                const dongHu = await sp.warehouseStock.findMany({
                    where: { warehouseId: { in: idKhoHu } },
                    select: { warehouseId: true, productId: true, productSku: true, productName: true, quantity: true },
                })

                // ── Tính số đúng theo sản phẩm ──
                const tinh = new Map<string, { suaChua: number; traHang: number; chuyenKho: number; phieu: string[] }>()
                const lay = (pid: string) => {
                    let t = tinh.get(pid)
                    if (!t) { t = { suaChua: 0, traHang: 0, chuyenKho: 0, phieu: [] }; tinh.set(pid, t) }
                    return t
                }
                for (const r of dangGiu) {
                    const t = lay(String(r.productId))
                    t.suaChua += Math.max(1, Number(r.quantity) || 1)
                    if (t.phieu.length < 4) t.phieu.push(r.code)
                }
                for (const r of traHang) lay(String(r.productId)).traHang += Number(r.quantity) || 0
                for (const c of chuyen) {
                    const vao = c.toWarehouseId && idKhoHu.includes(c.toWarehouseId)
                    for (const it of c.items || []) {
                        lay(String(it.productId)).chuyenKho += (vao ? 1 : -1) * (Number(it.quantity) || 0)
                    }
                }

                // Tập soát = mọi mã có dòng ≠ 0 ở bất kỳ kho hư hỏng nào ∪ mọi mã tính ra ≠ 0
                const hienCo = new Map<string, { sku: string; ten: string; tong: number }>()
                for (const d of dongHu) {
                    const cur = hienCo.get(String(d.productId)) || { sku: d.productSku || '', ten: d.productName, tong: 0 }
                    cur.tong += Number(d.quantity) || 0
                    hienCo.set(String(d.productId), cur)
                }
                const tatCa = new Set<string>([...hienCo.keys(), ...tinh.keys()])
                const bang: any[] = []
                for (const pid of tatCa) {
                    const t = tinh.get(pid)
                    const tong = (t ? t.suaChua + t.traHang + t.chuyenKho : 0)
                    const deXuat = Math.max(0, tong)
                    const dang = hienCo.get(pid)
                    const hienTai = dang ? dang.tong : 0
                    if (hienTai === deXuat) continue // đã đúng — khỏi báo
                    let sku = dang?.sku || '', ten = dang?.ten || ''
                    if (!sku) {
                        const p = await sp.product.findUnique({ where: { id: pid }, select: { sku: true, name: true } }).catch(() => null)
                        sku = p?.sku || pid; ten = p?.name || ''
                    }
                    bang.push({
                        sku, ten: ten.slice(0, 40), hienTai, deXuat,
                        tinhTu: t ? { suaChua: t.suaChua, traHang: t.traHang, chuyenKho: t.chuyenKho } : null,
                        phieuGiu: t?.phieu || [],
                        ...(tong < 0 ? { canhBao: 'am-sau-tinh — chứng từ cổ hơn dữ liệu, đề xuất 0' } : {}),
                        _pid: pid,
                    })
                }
                bang.sort((a, b) => a.hienTai - b.hienTai)

                const muc: any = {
                    store: store.code,
                    khoDich: khoDich.code,
                    khoHuKhac: khoHu.filter((w: any) => w.id !== khoDich.id).map((w: any) => w.code),
                    soMaLech: bang.length,
                    bang: bang.map(({ _pid, ...r }) => r),
                }

                if (apply) {
                    for (const r of bang) {
                        if (r.deXuat === 0) {
                            await sp.warehouseStock.deleteMany({ where: { warehouseId: khoDich.id, productId: r._pid } })
                        } else {
                            await sp.warehouseStock.upsert({
                                where: { warehouseId_productId: { warehouseId: khoDich.id, productId: r._pid } },
                                create: { warehouseId: khoDich.id, productId: r._pid, productName: r.ten, productSku: r.sku, quantity: r.deXuat },
                                update: { quantity: r.deXuat },
                            })
                        }
                    }
                    for (const w of khoHu) {
                        if (w.id === khoDich.id) continue
                        await sp.warehouseStock.deleteMany({ where: { warehouseId: w.id } })
                        await sp.warehouse.update({
                            where: { id: w.id },
                            data: { isDefault: false, isActive: false, description: `Đã gộp vào ${khoDich.code} (kho-hu-hong-soat ${new Date().toISOString().slice(0, 10)})` },
                        }).catch(() => null)
                    }
                    const conAm = await sp.warehouseStock.count({
                        where: { warehouseId: { in: idKhoHu }, quantity: { lt: 0 } },
                    })
                    muc.conDongAmSau = conAm
                    muc.daLam = 'ĐÃ CHỮA'
                } else {
                    muc.daLam = 'chỉ báo cáo, chưa đụng gì'
                }
                ketQua.push(muc)
            } catch (e: any) {
                ketQua.push({ store: store.code, loi: e?.message?.slice(0, 160) })
            }
        }
        res.json({ success: true, cheDo: apply ? 'ĐÃ ÁP DỤNG' : 'CHỈ BÁO CÁO', ketQua })
    } catch (err: any) {
        console.error('[admin] kho-hu-hong-soat:', err?.message)
        res.status(500).json({ success: false, error: err?.message || 'Internal server error' })
    }
})

/* GET /admin/tarot-readings — soi các lượt gần nhất.
 *
 * Dựng để truy một báo lỗi "chưa lật lá nào đã thấy trong lịch sử": đọc code
 * thấy saveHistory() chỉ chạy khi lá cuối được lật, nên cần nhìn dữ liệu thật
 * (khoảng cách thời gian giữa các lượt, có luận giải AI kèm chưa) mới biết là
 * ghi thừa hay chỉ là hiểu nhầm khi lịch sử nạp lại từ máy chủ. */
router.get('/tarot-readings', async (req: Request, res: Response) => {
    try {
        const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100)
        const rows: any[] = await (prisma as any).tarotReading.findMany({
            orderBy: { createdAt: 'desc' },
            take: limit,
            select: {
                id: true, userId: true, tool: true, question: true, spread: true,
                readerName: true, cards: true, aiAnswer: true, aiModel: true, createdAt: true, ip: true,
            },
        })

        /* Tên người xem: tài khoản thật thì tra hồ sơ Google (một lượt cho tất
         * cả id, không tra từng dòng); khách vãng lai thì lấy tên họ tự gõ, không
         * có thì ghi "Khách". */
        const idThat = [...new Set(rows.map(r => r.userId).filter((u: string) => u && !u.startsWith('guest:')))]
        const hoSo = new Map<string, any>()
        if (idThat.length) {
            const us: any[] = await (prisma as any).tarotUser.findMany({
                where: { id: { in: idThat } },
                select: { id: true, name: true, email: true, picture: true },
            })
            us.forEach(u => hoSo.set(u.id, u))
        }

        res.json({
            success: true,
            data: rows.map(r => {
                let soLa = 0
                try { soLa = (JSON.parse(r.cards) || []).length } catch { soLa = 0 }
                const laKhach = !r.userId || r.userId.startsWith('guest:')
                const u = hoSo.get(r.userId)
                return {
                    id: r.id,
                    laKhach,
                    /* HAI TÊN KHÁC NHAU, đừng gộp:
                     *  • tenTrenLaSo = người ĐƯỢC xem (chủ lá số / tên người xem
                     *    bài) — một tài khoản xem cho nhiều người là chuyện thường
                     *  • taiKhoan    = ai đang đăng nhập lúc bấm */
                    tenTrenLaSo: r.readerName || '(không ghi tên)',
                    taiKhoan: laKhach ? 'Khách (chưa đăng nhập)' : (u?.name || u?.email || '(không rõ)'),
                    email: laKhach ? '' : (u?.email || ''),
                    anh: laKhach ? '' : (u?.picture || ''),
                    tool: r.tool || 'tarot',
                    question: r.question,
                    spread: r.spread,
                    ip: r.ip || '',
                    soLa,
                    coAi: !!r.aiAnswer,
                    aiModel: r.aiModel || '',
                    createdAt: r.createdAt,
                }
            }),
        })
    } catch (err: any) {
        if (err?.code === 'P2021' || /does not exist/i.test(String(err?.message || ''))) {
            res.status(503).json({ success: false, error: 'Chưa tạo bảng tarot.', code: 'CHUA_MIGRATE' })
            return
        }
        console.error('[admin] tarot-readings:', err?.message)
        res.status(500).json({ success: false, error: errMsg(err, 'Không đọc được danh sách lượt') })
    }
})

/* GET /admin/tarot-visits — ai vào trang, lúc nào, từ IP nào.
 *
 * Tách khỏi /tarot-readings vì hai thứ khác nhau: vào trang rồi thoát cũng là
 * một lượt truy cập, nhưng KHÔNG phải một lượt xem bài. */
router.get('/tarot-visits', async (req: Request, res: Response) => {
    try {
        const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 200)
        const rows: any[] = await (prisma as any).tarotVisit.findMany({
            orderBy: { createdAt: 'desc' },
            take: limit,
        })

        const idThat = [...new Set(rows.map(r => r.userId).filter((u: string) => u && !u.startsWith('guest:')))]
        const hoSo = new Map<string, any>()
        if (idThat.length) {
            const us: any[] = await (prisma as any).tarotUser.findMany({
                where: { id: { in: idThat } },
                select: { id: true, name: true, email: true },
            })
            us.forEach(u => hoSo.set(u.id, u))
        }

        res.json({
            success: true,
            data: rows.map(r => {
                const laKhach = !r.userId || String(r.userId).startsWith('guest:')
                const u = hoSo.get(r.userId)
                return {
                    id: r.id,
                    laKhach,
                    taiKhoan: laKhach ? 'Khách' : (u?.name || u?.email || '(không rõ)'),
                    email: laKhach ? '' : (u?.email || ''),
                    // Mã máy rút gọn để nhận ra cùng một trình duyệt quay lại.
                    maMay: laKhach && r.userId ? String(r.userId).replace('guest:', '').slice(0, 8) : '',
                    ip: r.ip || '',
                    tool: r.tool || 'tarot',
                    thietBi: /Mobile|Android|iPhone/i.test(String(r.userAgent || '')) ? 'Điện thoại' : 'Máy tính',
                    createdAt: r.createdAt,
                }
            }),
        })
    } catch (err: any) {
        if (err?.code === 'P2021' || /does not exist/i.test(String(err?.message || ''))) {
            res.status(503).json({ success: false, error: 'Chưa tạo bảng lượt truy cập.', code: 'CHUA_MIGRATE' })
            return
        }
        console.error('[admin] tarot-visits:', err?.message)
        res.status(500).json({ success: false, error: errMsg(err, 'Không đọc được lượt truy cập') })
    }
})

/* GET /admin/tarot-config — cấu hình AI của trang tarot.
 *
 * KHÔNG trả khoá thật ra ngoài, chỉ trả 4 ký tự cuối để người quản trị nhận ra
 * mình đang dùng khoá nào. Đọc được khoá qua API admin là biến một lần lộ token
 * admin thành một lần lộ khoá OpenAI. */
router.get('/tarot-config', async (_req: Request, res: Response) => {
    try {
        const cf = await (prisma as any).tarotSetting.findUnique({ where: { id: 'default' } })
        res.json({
            success: true,
            data: {
                provider: cf?.provider || 'openai',
                coKhoa: !!cf?.openaiApiKey,
                duoiKhoa: cf?.openaiApiKey ? `••••${String(cf.openaiApiKey).slice(-4)}` : '',
                model: cf?.model || 'gpt-5.6-terra',
                reasoningEffort: cf?.reasoningEffort || 'medium',
                aiDailyLimit: cf?.aiDailyLimit ?? 20,
                aiDailyLimitIp: cf?.aiDailyLimitIp ?? 60,
                requireLogin: !!cf?.requireLogin,
                visionProvider: cf?.visionProvider || 'openai',
                coKhoaThiGiac: !!cf?.visionApiKey,
                duoiKhoaThiGiac: cf?.visionApiKey ? `••••${String(cf.visionApiKey).slice(-4)}` : '',
                visionModel: cf?.visionModel || 'gpt-5.6-terra',
                /* ─── Thu tiền lượt luận giải AI ───
                 * Số tài khoản KHÔNG che: nó nằm sẵn trong mã QR mà ai vào trang
                 * cũng quét được, che ở đây chỉ làm chủ trang khó đối chiếu. */
                creditEnabled: !!cf?.creditEnabled,
                freeDailyLimit: cf?.freeDailyLimit ?? 3,
                bankBin: cf?.bankBin || '',
                bankAccountNo: cf?.bankAccountNo || '',
                bankAccountName: cf?.bankAccountName || '',
                creditPackages: cf?.creditPackages || '',
                updatedAt: cf?.updatedAt || null,
            },
        })
    } catch (err: any) {
        if (err?.code === 'P2021' || /does not exist/i.test(String(err?.message || ''))) {
            res.status(503).json({ success: false, error: 'Chưa tạo bảng tarot.', code: 'CHUA_MIGRATE' })
            return
        }
        console.error('[admin] tarot-config GET:', err?.message)
        res.status(500).json({ success: false, error: errMsg(err, 'Không đọc được cấu hình tarot') })
    }
})

/* PUT /admin/tarot-config — nhập/đổi khoá OpenAI, model, mức suy luận, trần lượt.
 * Gửi openaiApiKey = chuỗi rỗng để XOÁ khoá (tắt AI). Không gửi trường nào thì
 * giữ nguyên trường đó. */
router.put('/tarot-config', async (req: Request, res: Response) => {
    try {
        const MUC = ['none', 'low', 'medium', 'high', 'xhigh', 'max']
        const NHA = ['openai', 'deepseek']
        const data: any = {}

        if (req.body?.provider !== undefined) {
            const p = String(req.body.provider || '').trim().toLowerCase()
            if (!NHA.includes(p)) {
                res.status(400).json({ success: false, error: `Nhà cung cấp phải là: ${NHA.join(' hoặc ')}` })
                return
            }
            data.provider = p
        }

        if (req.body?.openaiApiKey !== undefined) {
            const key = String(req.body.openaiApiKey || '').trim()
            // Ô nhập hiển thị khoá đã che; người dùng bấm Lưu mà không sửa thì
            // đừng ghi đè khoá thật bằng mấy dấu chấm.
            if (key.startsWith('••')) {
                /* bỏ qua */
            } else if (!key) {
                data.openaiApiKey = null
            } else if (key.length < 20) {
                res.status(400).json({ success: false, error: 'Khoá OpenAI trông không hợp lệ (quá ngắn).' })
                return
            } else {
                data.openaiApiKey = key
            }
        }
        if (req.body?.model !== undefined) data.model = String(req.body.model || '').trim().slice(0, 80) || 'gpt-5.6-terra'
        if (req.body?.reasoningEffort !== undefined) {
            const m = String(req.body.reasoningEffort || '').trim()
            if (!MUC.includes(m)) {
                res.status(400).json({ success: false, error: `Mức suy luận phải là một trong: ${MUC.join(', ')}` })
                return
            }
            data.reasoningEffort = m
        }
        if (req.body?.aiDailyLimit !== undefined) {
            const n = Number(req.body.aiDailyLimit)
            if (!Number.isFinite(n) || n < 0 || n > 1000) {
                res.status(400).json({ success: false, error: 'Trần lượt AI mỗi ngày phải trong khoảng 0–1000 (0 = không giới hạn).' })
                return
            }
            data.aiDailyLimit = Math.floor(n)
        }
        if (req.body?.aiDailyLimitIp !== undefined) {
            const n = Number(req.body.aiDailyLimitIp)
            if (!Number.isFinite(n) || n < 0 || n > 5000) {
                res.status(400).json({ success: false, error: 'Trần lượt AI theo IP phải trong khoảng 0–5000 (0 = không giới hạn).' })
                return
            }
            data.aiDailyLimitIp = Math.floor(n)
        }
        if (req.body?.requireLogin !== undefined) data.requireLogin = !!req.body.requireLogin

        /* Khoá THỊ GIÁC — tách hẳn khoá chữ vì DeepSeek không nhìn được ảnh. */
        if (req.body?.visionProvider !== undefined) {
            const p2 = String(req.body.visionProvider || '').trim().toLowerCase()
            if (!['openai', 'gemini'].includes(p2)) {
                res.status(400).json({ success: false, error: 'Nhà cung cấp AI nhìn ảnh phải là: openai hoặc gemini' })
                return
            }
            data.visionProvider = p2
        }
        if (req.body?.visionModel !== undefined) data.visionModel = String(req.body.visionModel || '').trim().slice(0, 80) || 'gpt-5.6-terra'
        if (req.body?.visionApiKey !== undefined) {
            const k2 = String(req.body.visionApiKey || '').trim()
            if (k2.startsWith('••')) { /* ô hiển thị khoá đã che — bỏ qua, đừng xoá khoá thật */ }
            else if (!k2) data.visionApiKey = null
            else if (k2.length < 20) {
                res.status(400).json({ success: false, error: 'Khoá AI nhìn ảnh trông không hợp lệ (quá ngắn).' })
                return
            } else data.visionApiKey = k2
        }

        /* ─── Thu tiền lượt luận giải AI ─────────────────────────────────
         * BẬT CÔNG TẮC MÀ CHƯA KHAI TÀI KHOẢN NHẬN TIỀN = chặn hết người xem:
         * hết lượt miễn phí là họ gặp panel nạp, mà panel không dựng nổi QR vì
         * không có số tài khoản. Chặn ngay tại đây, đừng để phát hiện qua tin
         * nhắn than phiền. */
        if (req.body?.creditEnabled !== undefined) data.creditEnabled = !!req.body.creditEnabled
        if (req.body?.freeDailyLimit !== undefined) {
            const n = Number(req.body.freeDailyLimit)
            if (!Number.isFinite(n) || n < 0 || n > 100) {
                res.status(400).json({ success: false, error: 'Số lượt miễn phí mỗi ngày phải trong khoảng 0–100 (0 = thu tiền ngay từ lượt đầu).' })
                return
            }
            data.freeDailyLimit = Math.floor(n)
        }
        if (req.body?.bankBin !== undefined) {
            const bin = String(req.body.bankBin || '').trim()
            if (bin && !/^\d{6}$/.test(bin)) {
                res.status(400).json({ success: false, error: 'Mã ngân hàng (BIN) phải là 6 chữ số, ví dụ 970422 cho MBBank.' })
                return
            }
            data.bankBin = bin || null
        }
        if (req.body?.bankAccountNo !== undefined) {
            const stk = String(req.body.bankAccountNo || '').trim()
            if (stk && !/^[0-9]{4,20}$/.test(stk)) {
                res.status(400).json({ success: false, error: 'Số tài khoản chỉ gồm chữ số (4–20 ký tự).' })
                return
            }
            data.bankAccountNo = stk || null
        }
        if (req.body?.bankAccountName !== undefined) {
            data.bankAccountName = String(req.body.bankAccountName || '').trim().slice(0, 120) || null
        }
        if (req.body?.creditPackages !== undefined) {
            const raw = String(req.body.creditPackages || '').trim()
            if (!raw) data.creditPackages = null
            else {
                let goi: any
                try { goi = JSON.parse(raw) } catch { goi = null }
                if (!Array.isArray(goi) || !goi.length) {
                    res.status(400).json({ success: false, error: 'Bảng gói nạp phải là danh sách JSON, ví dụ [{"id":"nc5","vnd":10000,"credits":5}].' })
                    return
                }
                const xau = goi.find((g: any) => !g?.id || !(Number(g?.vnd) > 0) || !(Number(g?.credits) > 0))
                if (xau) {
                    res.status(400).json({ success: false, error: 'Mỗi gói phải có id, vnd > 0 và credits > 0.' })
                    return
                }
                data.creditPackages = JSON.stringify(goi.slice(0, 8).map((g: any) => ({
                    id: String(g.id).slice(0, 20),
                    vnd: Math.round(Number(g.vnd)),
                    credits: Math.round(Number(g.credits)),
                })))
            }
        }

        if (data.creditEnabled) {
            const cfCu: any = await (prisma as any).tarotSetting.findUnique({ where: { id: 'default' } }).catch(() => null)
            const bin = data.bankBin !== undefined ? data.bankBin : cfCu?.bankBin
            const stk = data.bankAccountNo !== undefined ? data.bankAccountNo : cfCu?.bankAccountNo
            if (!bin || !stk) {
                res.status(400).json({ success: false, error: 'Muốn bật thu credit thì phải khai đủ ngân hàng và số tài khoản nhận tiền trước — không có thì người xem hết lượt miễn phí sẽ không nạp được.' })
                return
            }
        }

        const cf = await (prisma as any).tarotSetting.upsert({
            where: { id: 'default' },
            create: { id: 'default', ...data },
            update: data,
        })
        res.json({
            success: true,
            data: {
                provider: cf.provider || 'openai',
                coKhoa: !!cf.openaiApiKey,
                duoiKhoa: cf.openaiApiKey ? `••••${String(cf.openaiApiKey).slice(-4)}` : '',
                model: cf.model,
                reasoningEffort: cf.reasoningEffort,
                aiDailyLimit: cf.aiDailyLimit,
                aiDailyLimitIp: cf.aiDailyLimitIp ?? 60,
                requireLogin: !!cf.requireLogin,
                visionProvider: cf.visionProvider || 'openai',
                coKhoaThiGiac: !!cf.visionApiKey,
                duoiKhoaThiGiac: cf.visionApiKey ? `••••${String(cf.visionApiKey).slice(-4)}` : '',
                visionModel: cf.visionModel || 'gpt-5.6-terra',
                creditEnabled: !!cf.creditEnabled,
                freeDailyLimit: cf.freeDailyLimit ?? 3,
                bankBin: cf.bankBin || '',
                bankAccountNo: cf.bankAccountNo || '',
                bankAccountName: cf.bankAccountName || '',
                creditPackages: cf.creditPackages || '',
                updatedAt: cf.updatedAt,
            },
        })
    } catch (err: any) {
        if (err?.code === 'P2021' || /does not exist/i.test(String(err?.message || ''))) {
            res.status(503).json({ success: false, error: 'Chưa tạo bảng tarot.', code: 'CHUA_MIGRATE' })
            return
        }
        console.error('[admin] tarot-config PUT:', err?.message)
        res.status(500).json({ success: false, error: errMsg(err, 'Không lưu được cấu hình tarot') })
    }
})

/* GET /admin/tarot-stats — lượt xem tarot ở studio.kengi.vn.
 *
 * Trang tarot đứng ngoài hệ bán lẻ nên không có chỗ nào trong dashboard cửa
 * hàng đếm hộ. Số liệu lấy thẳng từ 2 bảng registry: mỗi lần lật đủ bài là một
 * dòng TarotReading, mỗi người đăng nhập Google là một dòng TarotUser.
 *
 * Trả cả mốc ngày để trang admin vẽ được cột 14 ngày mà không phải gọi nhiều lần. */
router.get('/tarot-stats', async (_req: Request, res: Response) => {
    try {
        const p = prisma as any
        const now = new Date()
        const dauNgay = new Date(now.getFullYear(), now.getMonth(), now.getDate())
        const bay = new Date(dauNgay.getTime() - 6 * 86400000)
        const bamuoi = new Date(dauNgay.getTime() - 29 * 86400000)

        /* Chạy TUẦN TỰ chứ không Promise.all: pool prod chỉ 5 kết nối, trang
         * admin còn nhiều thẻ khác gọi song song. */
        const soNguoi = await p.tarotUser.count()
        // Khách vãng lai: userId dạng 'guest:<mã>', đếm số mã khác nhau.
        let soKhach = 0
        try {
            const r: any[] = await p.$queryRawUnsafe(
                `SELECT COUNT(DISTINCT "userId")::int AS so FROM "TarotReading" WHERE "userId" LIKE 'guest:%'`
            )
            soKhach = Number(r?.[0]?.so ?? 0)
        } catch { /* bảng chưa có cột/dữ liệu */ }
        const soLuot = await p.tarotReading.count()
        const luotHomNay = await p.tarotReading.count({ where: { createdAt: { gte: dauNgay } } })
        const luot7Ngay = await p.tarotReading.count({ where: { createdAt: { gte: bay } } })
        const luot30Ngay = await p.tarotReading.count({ where: { createdAt: { gte: bamuoi } } })
        const nguoiMoi7Ngay = await p.tarotUser.count({ where: { createdAt: { gte: bay } } })
        const dangHoatDong7Ngay = await p.tarotUser.count({ where: { lastLoginAt: { gte: bay } } })

        // Cột theo ngày (14 ngày gần nhất) — gộp ở DB cho nhẹ.
        const moc = new Date(dauNgay.getTime() - 13 * 86400000)
        const theoNgay: any[] = await p.$queryRawUnsafe(
            `SELECT to_char("createdAt" AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD') AS ngay,
                    COUNT(*)::int AS soLuot
             FROM "TarotReading"
             WHERE "createdAt" >= $1
             GROUP BY 1 ORDER BY 1`,
            moc
        )

        // Ai xem nhiều nhất — để biết là người thật hay một máy bấm liên tục.
        const topNguoi: any[] = await p.$queryRawUnsafe(
            `SELECT u."email", u."name", COUNT(r.*)::int AS "soLuot", MAX(r."createdAt") AS "lanCuoi"
             FROM "TarotUser" u LEFT JOIN "TarotReading" r ON r."userId" = u."id"
             GROUP BY u."id", u."email", u."name"
             ORDER BY COUNT(r.*) DESC, MAX(r."createdAt") DESC NULLS LAST
             LIMIT 10`
        )

        /* Lượt TRUY CẬP (mở trang) — khác hẳn lượt xem bài. Bảng mới nên có thể
         * chưa tồn tại ở môi trường chưa migrate. */
        let truyCap = { tong: 0, homNay: 0, ngay7: 0 }
        try {
            truyCap = {
                tong: await p.tarotVisit.count(),
                homNay: await p.tarotVisit.count({ where: { createdAt: { gte: dauNgay } } }),
                ngay7: await p.tarotVisit.count({ where: { createdAt: { gte: bay } } }),
            }
        } catch { /* chưa tạo bảng TarotVisit */ }

        const ganNhat = await p.tarotReading.findFirst({
            orderBy: { createdAt: 'desc' },
            select: { createdAt: true, question: true, spread: true },
        })

        /* Tách theo công cụ: tarot, thần số học, tử vi, bản đồ sao. Cột `tool`
         * mới có sau nên bảng cũ chưa migrate thì coi như tất cả là tarot. */
        let theoCongCu: { tool: string; soLuot: number }[] = []
        try {
            const rows: any[] = await p.$queryRawUnsafe(
                `SELECT COALESCE("tool", 'tarot') AS tool, COUNT(*)::int AS so
                 FROM "TarotReading" GROUP BY 1 ORDER BY 2 DESC`
            )
            theoCongCu = rows.map(r => ({ tool: r.tool, soLuot: Number(r.so ?? 0) }))
        } catch { /* chưa có cột tool */ }

        res.json({
            success: true,
            data: {
                soNguoi, soKhach, soLuot, luotHomNay, luot7Ngay, luot30Ngay,
                nguoiMoi7Ngay, dangHoatDong7Ngay,
                ganNhat, theoCongCu, truyCap,
                theoNgay: theoNgay.map(r => ({ ngay: r.ngay, soLuot: Number(r.soluot ?? r.soLuot ?? 0) })),
                topNguoi: topNguoi.map(r => ({
                    email: r.email,
                    name: r.name || '',
                    soLuot: Number(r.soLuot ?? 0),
                    lanCuoi: r.lanCuoi || null,
                })),
            },
        })
    } catch (err: any) {
        // Bảng chưa tạo (chưa chạy /admin/migrate-tarot) thì nói thẳng, đừng để
        // thẻ trên trang admin hiện "lỗi máy chủ" chung chung.
        if (err?.code === 'P2021' || /does not exist/i.test(String(err?.message || ''))) {
            res.status(503).json({
                success: false,
                error: 'Chưa tạo bảng tarot. Gọi POST /api/admin/migrate-tarot một lần.',
                code: 'CHUA_MIGRATE',
            })
            return
        }
        console.error('[admin] tarot-stats:', err?.message)
        res.status(500).json({ success: false, error: errMsg(err, 'Không đọc được số liệu tarot') })
    }
})

/* ═══════════════════════════════════════════════════════════════════════════
 *  DUYỆT ĐƠN NẠP CREDIT — đối soát bằng TAY
 *
 *  Không có webhook ngân hàng nào ở đây (chủ trang chốt duyệt tay 27/08/2026).
 *  Quy trình: người xem chọn gói → máy chủ sinh mã NCxxxxxx → họ chuyển khoản
 *  kèm mã đó → chủ trang mở app ngân hàng, thấy tiền về, vào đây bấm duyệt.
 *
 *  ĐỐI CHIẾU TRƯỚC KHI BẤM. Nút này CỘNG TIỀN THẬT vào ví người ta và không có
 *  đường lùi: đã cộng rồi thì người dùng tiêu ngay lượt sau.
 * ═══════════════════════════════════════════════════════════════════════════ */

/* GET /admin/tarot-topups — danh sách đơn nạp, mặc định xem đơn đang chờ. */
router.get('/tarot-topups', async (req: Request, res: Response) => {
    try {
        const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 100)
        const trangThai = String(req.query.status || 'pending')
        const where = ['pending', 'paid', 'cancelled'].includes(trangThai) ? { status: trangThai } : {}

        const rows: any[] = await (prisma as any).tarotTopupOrder.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            take: limit,
        })

        /* Tra hồ sơ Google MỘT LƯỢT cho tất cả id — pool chỉ 1 kết nối, tra từng
         * dòng là 30 vòng đi về cho một cái bảng 30 dòng. */
        const idNguoi = [...new Set(rows.map(r => r.userId).filter(Boolean))]
        const hoSo = new Map<string, any>()
        if (idNguoi.length) {
            const us: any[] = await (prisma as any).tarotUser.findMany({
                where: { id: { in: idNguoi } },
                select: { id: true, name: true, email: true },
            })
            us.forEach(u => hoSo.set(u.id, u))
        }

        // Số dư hiện tại, cũng một lượt.
        const vi = new Map<string, number>()
        if (idNguoi.length) {
            const tks: any[] = await (prisma as any).tarotCreditAccount.findMany({
                where: { userId: { in: idNguoi } },
                select: { userId: true, balance: true },
            })
            tks.forEach(t => vi.set(t.userId, t.balance))
        }

        res.json({
            success: true,
            data: rows.map(r => ({
                id: r.id,
                code: r.code,
                userId: r.userId,
                email: hoSo.get(r.userId)?.email || r.email || '',
                name: hoSo.get(r.userId)?.name || r.name || '',
                soDuHienTai: vi.get(r.userId) ?? 0,
                vnd: r.vnd,
                credits: r.credits,
                status: r.status,
                note: r.note || '',
                paidAt: r.paidAt,
                createdAt: r.createdAt,
            })),
        })
    } catch (err: any) {
        if (err?.code === 'P2021' || /does not exist/i.test(String(err?.message || ''))) {
            res.status(503).json({ success: false, error: 'Chưa tạo bảng credit. Gọi POST /api/admin/migrate-tarot một lần.', code: 'CHUA_MIGRATE' })
            return
        }
        console.error('[admin] tarot-topups:', err?.message)
        res.status(500).json({ success: false, error: errMsg(err, 'Không đọc được danh sách đơn nạp') })
    }
})

/* POST /admin/tarot-topups/:id/confirm — xác nhận đã nhận tiền, cộng credit. */
router.post('/tarot-topups/:id/confirm', async (req: Request, res: Response) => {
    try {
        const id = String(req.params.id || '')
        const ghiChu = String(req.body?.note || '').trim().slice(0, 300) || null

        /* CHỐT TRẠNG THÁI TRƯỚC, CỘNG TIỀN SAU — và chốt bằng updateMany có điều
         * kiện status='pending'. Hai tab admin cùng bấm duyệt một đơn thì tab
         * thứ hai nhận count = 0 và dừng lại; cộng tiền trước rồi mới đổi trạng
         * thái là cộng đúp, người dùng được không hai lần tiền. */
        const chot = await (prisma as any).tarotTopupOrder.updateMany({
            where: { id, status: 'pending' },
            data: { status: 'paid', paidAt: new Date(), note: ghiChu },
        })
        if (!chot.count) {
            const don = await (prisma as any).tarotTopupOrder.findUnique({ where: { id } })
            res.status(409).json({
                success: false,
                error: don ? `Đơn này đã ở trạng thái "${don.status}" rồi, không duyệt lại được.` : 'Không tìm thấy đơn nạp này.',
            })
            return
        }

        const don = await (prisma as any).tarotTopupOrder.findUnique({ where: { id } })
        const tk = await (prisma as any).tarotCreditAccount.upsert({
            where: { userId: don.userId },
            create: { userId: don.userId, balance: don.credits },
            update: { balance: { increment: don.credits } },
        })
        await (prisma as any).tarotCreditLedger.create({
            data: { userId: don.userId, delta: don.credits, reason: 'topup', orderId: don.id, balance: tk.balance },
        }).catch((e: any) => console.error('[admin] không ghi được sổ credit:', e?.message))

        res.json({ success: true, data: { code: don.code, credits: don.credits, soDuMoi: tk.balance } })
    } catch (err: any) {
        if (err?.code === 'P2021' || /does not exist/i.test(String(err?.message || ''))) {
            res.status(503).json({ success: false, error: 'Chưa tạo bảng credit. Gọi POST /api/admin/migrate-tarot một lần.', code: 'CHUA_MIGRATE' })
            return
        }
        console.error('[admin] tarot-topups confirm:', err?.message)
        res.status(500).json({ success: false, error: errMsg(err, 'Không duyệt được đơn nạp') })
    }
})

/* POST /admin/tarot-topups/:id/cancel — huỷ đơn treo (chuyển nhầm, bỏ ngang). */
router.post('/tarot-topups/:id/cancel', async (req: Request, res: Response) => {
    try {
        const id = String(req.params.id || '')
        const ghiChu = String(req.body?.note || '').trim().slice(0, 300) || null
        const chot = await (prisma as any).tarotTopupOrder.updateMany({
            where: { id, status: 'pending' },
            data: { status: 'cancelled', note: ghiChu },
        })
        if (!chot.count) {
            res.status(409).json({ success: false, error: 'Đơn này không còn ở trạng thái chờ nên không huỷ được.' })
            return
        }
        res.json({ success: true })
    } catch (err: any) {
        console.error('[admin] tarot-topups cancel:', err?.message)
        res.status(500).json({ success: false, error: errMsg(err, 'Không huỷ được đơn nạp') })
    }
})

/* POST /admin/migrate-tarot — CHỈ tạo 2 bảng của trang tarot.
 *
 * Tách khỏi /migrate vì /migrate quét TOÀN BỘ schema cửa hàng: hàng trăm câu
 * ALTER (dù no-op vẫn xin khoá ACCESS EXCLUSIVE) chạy trên pool 5 kết nối. Bật
 * tính năng cho một trang xem tarot không đáng để đụng vào dữ liệu bán hàng của
 * 9 cửa hàng lúc 18–20h. Hai bảng này nằm ở registry, không liên quan cửa hàng
 * nào — chạy riêng gọn hơn nhiều. */
router.post('/migrate-tarot', async (_req: Request, res: Response) => {
    try {
        const cauLenh = [
            `CREATE TABLE IF NOT EXISTS "TarotUser" (
                "id" TEXT NOT NULL,
                "googleSub" TEXT NOT NULL,
                "email" TEXT NOT NULL,
                "name" TEXT,
                "picture" TEXT,
                "locale" TEXT,
                "lastLoginAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT "TarotUser_pkey" PRIMARY KEY ("id")
            )`,
            `CREATE UNIQUE INDEX IF NOT EXISTS "TarotUser_googleSub_key" ON "TarotUser"("googleSub")`,
            `CREATE INDEX IF NOT EXISTS "TarotUser_email_idx" ON "TarotUser"("email")`,
            `CREATE TABLE IF NOT EXISTS "TarotReading" (
                "id" TEXT NOT NULL,
                "userId" TEXT NOT NULL,
                "question" TEXT NOT NULL,
                "readerName" TEXT,
                "topic" TEXT,
                "spread" TEXT NOT NULL DEFAULT 'three',
                "cards" TEXT NOT NULL,
                "summary" TEXT,
                "aiAnswer" TEXT,
                "aiReading" TEXT,
                "aiModel" TEXT,
                "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT "TarotReading_pkey" PRIMARY KEY ("id")
            )`,
            `CREATE INDEX IF NOT EXISTS "TarotReading_userId_createdAt_idx" ON "TarotReading"("userId", "createdAt")`,
            // Cấu hình AI — một dòng duy nhất id='default', khoá OpenAI nhập ở trang admin.
            `CREATE TABLE IF NOT EXISTS "TarotSetting" (
                "id" TEXT NOT NULL DEFAULT 'default',
                "provider" TEXT NOT NULL DEFAULT 'openai',
                "openaiApiKey" TEXT,
                "model" TEXT NOT NULL DEFAULT 'gpt-5.6-terra',
                "reasoningEffort" TEXT NOT NULL DEFAULT 'medium',
                "aiDailyLimit" INTEGER NOT NULL DEFAULT 20,
                "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT "TarotSetting_pkey" PRIMARY KEY ("id")
            )`,
            // Bảng có từ trước các bản thêm cột thì bổ sung cho đủ.
            `ALTER TABLE "TarotSetting" ADD COLUMN IF NOT EXISTS "aiDailyLimit" INTEGER NOT NULL DEFAULT 20`,
            `ALTER TABLE "TarotSetting" ADD COLUMN IF NOT EXISTS "provider" TEXT NOT NULL DEFAULT 'openai'`,
            // Phân biệt lượt tarot với lượt "xem chi tiết" của thần số học/tử vi/bản đồ sao.
            `ALTER TABLE "TarotReading" ADD COLUMN IF NOT EXISTS "tool" TEXT NOT NULL DEFAULT 'tarot'`,
            `CREATE INDEX IF NOT EXISTS "TarotReading_tool_createdAt_idx" ON "TarotReading"("tool", "createdAt")`,
            // Khách vãng lai (không đăng nhập) — userId dạng 'guest:<uuid>', ip để chặn đốt hạn mức AI.
            `ALTER TABLE "TarotReading" ADD COLUMN IF NOT EXISTS "ip" TEXT`,
            `CREATE INDEX IF NOT EXISTS "TarotReading_ip_createdAt_idx" ON "TarotReading"("ip", "createdAt")`,
            `ALTER TABLE "TarotSetting" ADD COLUMN IF NOT EXISTS "aiDailyLimitIp" INTEGER NOT NULL DEFAULT 60`,
            `ALTER TABLE "TarotSetting" ADD COLUMN IF NOT EXISTS "requireLogin" BOOLEAN NOT NULL DEFAULT false`,
            // Khoá riêng cho phần nhìn ảnh (xem chỉ tay) — DeepSeek không nhìn được ảnh.
            `ALTER TABLE "TarotSetting" ADD COLUMN IF NOT EXISTS "visionProvider" TEXT NOT NULL DEFAULT 'openai'`,
            `ALTER TABLE "TarotSetting" ADD COLUMN IF NOT EXISTS "visionApiKey" TEXT`,
            `ALTER TABLE "TarotSetting" ADD COLUMN IF NOT EXISTS "visionModel" TEXT NOT NULL DEFAULT 'gpt-5.6-terra'`,
            // Lượt truy cập trang — bảng RIÊNG, không trộn vào TarotReading kẻo
            // phồng con số "lượt xem bài".
            `CREATE TABLE IF NOT EXISTS "TarotVisit" (
                "id" TEXT NOT NULL,
                "userId" TEXT,
                "ip" TEXT,
                "tool" TEXT NOT NULL DEFAULT 'tarot',
                "userAgent" TEXT,
                "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT "TarotVisit_pkey" PRIMARY KEY ("id")
            )`,
            `CREATE INDEX IF NOT EXISTS "TarotVisit_createdAt_idx" ON "TarotVisit"("createdAt")`,
            `CREATE INDEX IF NOT EXISTS "TarotVisit_userId_idx" ON "TarotVisit"("userId")`,

            /* ─── CREDIT: thu tiền lượt luận giải AI, nạp qua QR VietQR ───────
             * Ba bảng này chỉ được ĐỘNG TỚI khi chủ trang bật công tắc
             * creditEnabled. Tạo sẵn ở đây để lúc bật không phải chạy migrate
             * lần nữa (bật công tắc mà bảng chưa có = trang tự tắt tính năng AI
             * cho toàn bộ người xem, không ai hiểu vì sao). */
            `ALTER TABLE "TarotSetting" ADD COLUMN IF NOT EXISTS "creditEnabled" BOOLEAN NOT NULL DEFAULT false`,
            `ALTER TABLE "TarotSetting" ADD COLUMN IF NOT EXISTS "freeDailyLimit" INTEGER NOT NULL DEFAULT 3`,
            `ALTER TABLE "TarotSetting" ADD COLUMN IF NOT EXISTS "bankBin" TEXT`,
            `ALTER TABLE "TarotSetting" ADD COLUMN IF NOT EXISTS "bankAccountNo" TEXT`,
            `ALTER TABLE "TarotSetting" ADD COLUMN IF NOT EXISTS "bankAccountName" TEXT`,
            `ALTER TABLE "TarotSetting" ADD COLUMN IF NOT EXISTS "creditPackages" TEXT`,
            `CREATE TABLE IF NOT EXISTS "TarotCreditAccount" (
                "userId" TEXT NOT NULL,
                "balance" INTEGER NOT NULL DEFAULT 0,
                "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT "TarotCreditAccount_pkey" PRIMARY KEY ("userId")
            )`,
            `CREATE TABLE IF NOT EXISTS "TarotCreditLedger" (
                "id" TEXT NOT NULL,
                "userId" TEXT NOT NULL,
                "delta" INTEGER NOT NULL,
                "reason" TEXT NOT NULL,
                "orderId" TEXT,
                "balance" INTEGER NOT NULL,
                "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT "TarotCreditLedger_pkey" PRIMARY KEY ("id")
            )`,
            `CREATE INDEX IF NOT EXISTS "TarotCreditLedger_userId_createdAt_idx" ON "TarotCreditLedger"("userId", "createdAt")`,
            `CREATE TABLE IF NOT EXISTS "TarotTopupOrder" (
                "id" TEXT NOT NULL,
                "code" TEXT NOT NULL,
                "userId" TEXT NOT NULL,
                "email" TEXT,
                "name" TEXT,
                "vnd" INTEGER NOT NULL,
                "credits" INTEGER NOT NULL,
                "status" TEXT NOT NULL DEFAULT 'pending',
                "note" TEXT,
                "paidAt" TIMESTAMP(3),
                "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT "TarotTopupOrder_pkey" PRIMARY KEY ("id")
            )`,
            // Mã nội dung chuyển khoản phải DUY NHẤT: trùng mã là tiền đã vào
            // tài khoản mà không biết cộng cho ai.
            `CREATE UNIQUE INDEX IF NOT EXISTS "TarotTopupOrder_code_key" ON "TarotTopupOrder"("code")`,
            `CREATE INDEX IF NOT EXISTS "TarotTopupOrder_status_createdAt_idx" ON "TarotTopupOrder"("status", "createdAt")`,
            `CREATE INDEX IF NOT EXISTS "TarotTopupOrder_userId_createdAt_idx" ON "TarotTopupOrder"("userId", "createdAt")`,
        ]
        for (const sql of cauLenh) await (prisma as any).$executeRawUnsafe(sql)

        // Đọc lại từ information_schema để trả bằng chứng bảng đã có thật.
        const bang: any[] = await (prisma as any).$queryRawUnsafe(
            `SELECT table_name FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name IN
                   ('TarotUser','TarotReading','TarotSetting','TarotVisit',
                    'TarotCreditAccount','TarotCreditLedger','TarotTopupOrder')
             ORDER BY table_name`
        )
        res.json({ success: true, data: { tables: bang.map(r => r.table_name) } })
    } catch (err: any) {
        console.error('[admin] migrate-tarot:', err?.message)
        res.status(500).json({ success: false, error: errMsg(err, 'Không tạo được bảng tarot') })
    }
})

router.post('/migrate', async (_req: Request, res: Response) => {
    try {
        // Registry migrations
        await (prisma as any).$executeRawUnsafe(`ALTER TABLE "Store" ADD COLUMN IF NOT EXISTS "plan" TEXT NOT NULL DEFAULT 'full'`)
        await (prisma as any).$executeRawUnsafe(`ALTER TABLE "Store" ADD COLUMN IF NOT EXISTS "addOns" TEXT NOT NULL DEFAULT '[]'`)
        await (prisma as any).$executeRawUnsafe(`ALTER TABLE "Store" ADD COLUMN IF NOT EXISTS "extraBranches" INTEGER NOT NULL DEFAULT 0`)
        await (prisma as any).$executeRawUnsafe(`ALTER TABLE "Store" ADD COLUMN IF NOT EXISTS "hasWebhooks" BOOLEAN NOT NULL DEFAULT false`)
        await (prisma as any).$executeRawUnsafe(`ALTER TABLE "Store" ADD COLUMN IF NOT EXISTS "hasOnlineChannels" BOOLEAN NOT NULL DEFAULT false`)
        await (prisma as any).$executeRawUnsafe(`ALTER TABLE "Store" ADD COLUMN IF NOT EXISTS "hasFanpages" BOOLEAN NOT NULL DEFAULT false`)
        await (prisma as any).$executeRawUnsafe(`ALTER TABLE "Store" ADD COLUMN IF NOT EXISTS "hasAiJobs" BOOLEAN NOT NULL DEFAULT false`)
        // mktWorker lọc theo cờ này; thiếu cột thì worker ném P2022 mỗi 60 giây.
        await (prisma as any).$executeRawUnsafe(`ALTER TABLE "Store" ADD COLUMN IF NOT EXISTS "hasMarketing" BOOLEAN NOT NULL DEFAULT false`)
        /* Cửa hàng DEMO (2026-08-15): loại khỏi màn hình giám sát + báo cáo gộp,
         * KHÔNG xoá dữ liệu. KENGIONLINE có ngày 19/07 "bán" 31 iPhone = 1,005
         * tỷ — chủ shop xác nhận là demo; để lẫn thì bảng sức khoẻ kêu oan và
         * doanh thu gộp phồng 1,15 tỷ. Cột chỉ dùng qua SQL thô, KHÔNG thêm vào
         * schema.prisma — client biết cột trước khi mọi store migrate là mọi
         * truy vấn Store sập (kể cả đăng nhập). */
        await (prisma as any).$executeRawUnsafe(`ALTER TABLE "Store" ADD COLUMN IF NOT EXISTS "isDemo" BOOLEAN NOT NULL DEFAULT false`)

        /* NGUYỆT CÁC TAROT (2026-08-15) — bảng registry cho kengi.vn/tarot.
         * Hệ tài khoản đứng riêng (đăng nhập Google), không dính tài khoản cửa
         * hàng, nên đặt ở schema public chứ không phải schema cửa hàng. */
        await (prisma as any).$executeRawUnsafe(`
            CREATE TABLE IF NOT EXISTS "TarotUser" (
                "id" TEXT NOT NULL,
                "googleSub" TEXT NOT NULL,
                "email" TEXT NOT NULL,
                "name" TEXT,
                "picture" TEXT,
                "locale" TEXT,
                "lastLoginAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT "TarotUser_pkey" PRIMARY KEY ("id")
            )`)
        await (prisma as any).$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "TarotUser_googleSub_key" ON "TarotUser"("googleSub")`)
        await (prisma as any).$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "TarotUser_email_idx" ON "TarotUser"("email")`)
        await (prisma as any).$executeRawUnsafe(`
            CREATE TABLE IF NOT EXISTS "TarotReading" (
                "id" TEXT NOT NULL,
                "userId" TEXT NOT NULL,
                "question" TEXT NOT NULL,
                "readerName" TEXT,
                "topic" TEXT,
                "spread" TEXT NOT NULL DEFAULT 'three',
                "cards" TEXT NOT NULL,
                "summary" TEXT,
                "aiAnswer" TEXT,
                "aiReading" TEXT,
                "aiModel" TEXT,
                "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT "TarotReading_pkey" PRIMARY KEY ("id")
            )`)
        await (prisma as any).$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "TarotReading_userId_createdAt_idx" ON "TarotReading"("userId", "createdAt")`)

        // Store schema migrations — platform fees + geocode
        const stores = await prisma.store.findMany({ select: { schema: true, name: true } }) as any[]
        const storeResults: string[] = []
        for (const store of stores) {
            try {
                const sp = getStorePrisma(store.schema)

                /* NHÂN VIÊN ĐƯỢC TÍNH DOANH SỐ trên phiếu bán (2026-08-15).
                 * Tách hẳn khỏi `createdBy` (người bấm máy): đo thấy HUTI bán
                 * 20+ đơn/ngày, 14 tỷ doanh thu mà chỉ có ĐÚNG 2 tài khoản, cả
                 * cửa hàng ghi chung một login nên `createdBy` không tách được
                 * ai bán. Không đặt khoá ngoại — nhân viên nghỉ việc bị xoá thì
                 * lịch sử doanh số vẫn phải còn; tên lưu kèm để báo cáo cũ đọc
                 * được sau khi hồ sơ đã xoá. */
                await (sp as any).$executeRawUnsafe(`ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "salespersonId" TEXT`)
                await (sp as any).$executeRawUnsafe(`ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "salespersonName" TEXT`)
                await (sp as any).$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Transaction_salespersonId_idx" ON "Transaction"("salespersonId")`)

                // Platform fees (existing)
                await (sp as any).$executeRawUnsafe(`ALTER TABLE "OnlineOrder" ADD COLUMN IF NOT EXISTS "platformFee" DOUBLE PRECISION NOT NULL DEFAULT 0`)
                await (sp as any).$executeRawUnsafe(`ALTER TABLE "OnlineOrder" ADD COLUMN IF NOT EXISTS "platformFeeRate" DOUBLE PRECISION NOT NULL DEFAULT 0`)
                await (sp as any).$executeRawUnsafe(`ALTER TABLE "OnlineOrder" ADD COLUMN IF NOT EXISTS "netRevenue" DOUBLE PRECISION NOT NULL DEFAULT 0`)
                // Shopee Ads Smart Voucher — chỉ quan sát (2026-06-24)
                await (sp as any).$executeRawUnsafe(`ALTER TABLE "OnlineOrder" ADD COLUMN IF NOT EXISTS "adsVoucherDiscount" DOUBLE PRECISION NOT NULL DEFAULT 0`)
                await (sp as any).$executeRawUnsafe(`ALTER TABLE "OnlineChannel" ADD COLUMN IF NOT EXISTS "commissionRate" DOUBLE PRECISION NOT NULL DEFAULT 6`)
                // Geocode coordinates
                await (sp as any).$executeRawUnsafe(`ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "latitude" DOUBLE PRECISION`)
                await (sp as any).$executeRawUnsafe(`ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "longitude" DOUBLE PRECISION`)
                // Import receipt return tracking (2026-04-05)
                await (sp as any).$executeRawUnsafe(`ALTER TABLE "ImportReceiptItem" ADD COLUMN IF NOT EXISTS "returnedQuantity" INTEGER NOT NULL DEFAULT 0`)
                
                // Employees / User fields
                await (sp as any).$executeRawUnsafe(`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "salary" DOUBLE PRECISION DEFAULT 0`)
                await (sp as any).$executeRawUnsafe(`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "hireDate" TIMESTAMP(3) DEFAULT NULL`)
                await (sp as any).$executeRawUnsafe(`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "shifts" INTEGER NOT NULL DEFAULT 0`)
                await (sp as any).$executeRawUnsafe(`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "totalSales" DOUBLE PRECISION NOT NULL DEFAULT 0`)
                await (sp as any).$executeRawUnsafe(`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "notes" TEXT`)

                // Transaction sales channel tracking (2026-05-13)
                await (sp as any).$executeRawUnsafe(`ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "channel" TEXT NOT NULL DEFAULT 'direct'`)

                await (sp as any).$executeRawUnsafe(`
                    CREATE TABLE IF NOT EXISTS "MisaPurchaseDoc" (
                        "id" TEXT NOT NULL,
                        "soChungTu" TEXT NOT NULL,
                        "soHoaDon" TEXT,
                        "ngayChungTu" TIMESTAMP(3),
                        "ngayHachToan" TIMESTAMP(3),
                        "ngayHoaDon" TIMESTAMP(3),
                        "tongGiaTri" DOUBLE PRECISION NOT NULL DEFAULT 0,
                        "tongThue" DOUBLE PRECISION NOT NULL DEFAULT 0,
                        "tongChietKhau" DOUBLE PRECISION NOT NULL DEFAULT 0,
                        "tongTra" DOUBLE PRECISION NOT NULL DEFAULT 0,
                        "tongGiamGia" DOUBLE PRECISION NOT NULL DEFAULT 0,
                        "batchId" TEXT,
                        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        CONSTRAINT "MisaPurchaseDoc_pkey" PRIMARY KEY ("id")
                    )
                `)
                await (sp as any).$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "MisaPurchaseDoc_soChungTu_key" ON "MisaPurchaseDoc"("soChungTu")`)
                await (sp as any).$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "MisaPurchaseDoc_ngayChungTu_idx" ON "MisaPurchaseDoc"("ngayChungTu")`)
                await (sp as any).$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "MisaPurchaseDoc_soHoaDon_idx" ON "MisaPurchaseDoc"("soHoaDon")`)
                await (sp as any).$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "MisaPurchaseDoc_batchId_idx" ON "MisaPurchaseDoc"("batchId")`)

                await (sp as any).$executeRawUnsafe(`
                    CREATE TABLE IF NOT EXISTS "MisaPurchaseLine" (
                        "id" TEXT NOT NULL,
                        "docId" TEXT NOT NULL,
                        "maHang" TEXT NOT NULL,
                        "tenHang" TEXT,
                        "dvt" TEXT,
                        "soLuong" DOUBLE PRECISION NOT NULL DEFAULT 0,
                        "donGia" DOUBLE PRECISION NOT NULL DEFAULT 0,
                        "giaTri" DOUBLE PRECISION NOT NULL DEFAULT 0,
                        "thueGtgt" DOUBLE PRECISION NOT NULL DEFAULT 0,
                        "chietKhau" DOUBLE PRECISION NOT NULL DEFAULT 0,
                        "soLuongTra" DOUBLE PRECISION NOT NULL DEFAULT 0,
                        "giaTriTra" DOUBLE PRECISION NOT NULL DEFAULT 0,
                        "giamGia" DOUBLE PRECISION NOT NULL DEFAULT 0,
                        "productId" TEXT,
                        "dongSo" INTEGER,
                        CONSTRAINT "MisaPurchaseLine_pkey" PRIMARY KEY ("id"),
                        CONSTRAINT "MisaPurchaseLine_docId_fkey" FOREIGN KEY ("docId") REFERENCES "MisaPurchaseDoc"("id") ON DELETE CASCADE ON UPDATE CASCADE
                    )
                `)
                await (sp as any).$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "MisaPurchaseLine_docId_idx" ON "MisaPurchaseLine"("docId")`)
                await (sp as any).$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "MisaPurchaseLine_maHang_idx" ON "MisaPurchaseLine"("maHang")`)
                await (sp as any).$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "MisaPurchaseLine_productId_idx" ON "MisaPurchaseLine"("productId")`)

                /**
                 * GỠ INDEX HÀM đã thử ngày 18/08/2026 — CHÚNG LÀM CHẬM HẲN.
                 * Ý định: giúp các join LOWER(TRIM(sku)). Thực tế planner chuyển
                 * các phép gộp toàn bảng (GROUP BY LOWER(TRIM(sku)) trong nhánh
                 * "đã xuất HĐ"/"nhập VAT") từ SeqScan+HashAggregate sang quét
                 * index ngẫu nhiên → /einvoice/tax-stock-gap 30 ngày tụt từ 5,4s
                 * xuống 79s, khoảng "tất cả" quá 240s. Đo xong gỡ ngay, giữ
                 * DROP idempotent để mọi cửa hàng đều sạch.
                 */
                await (sp as any).$executeRawUnsafe(`DROP INDEX IF EXISTS "Product_sku_lower_idx"`)
                await (sp as any).$executeRawUnsafe(`DROP INDEX IF EXISTS "TransactionItem_sku_lower_idx"`)
                await (sp as any).$executeRawUnsafe(`DROP INDEX IF EXISTS "ImportReceiptItem_sku_lower_idx"`)
                await (sp as any).$executeRawUnsafe(`DROP INDEX IF EXISTS "OnlineOrder_online_receipt_idx"`)

                // Repair ↔ hoá đơn bán + nối khách theo id (2026-08-13)
                /* IMEI / số máy (24/08/2026) — mã nhận dạng thiết bị, tra phiếu bằng số này.
                 *
                 * ⚠ BÀI HỌC PHẢI GHI LẠI: `/admin/migrate` KHÔNG đọc schema Prisma. Nó là
                 * DANH SÁCH CÂU LỆNH ALTER VIẾT TAY ngay tại đây. Thêm trường vào
                 * `schema-store.prisma` rồi gọi migrate thì nó chạy xong danh sách CŨ và báo
                 * "OK" cho mọi cửa hàng — trong khi cột mới CHƯA HỀ được tạo. Mà client Prisma
                 * lúc đó ĐÃ biết trường mới, nên mọi `findMany` trên bảng đó ném P2022 và cả
                 * trang chết. Đã dính đúng vậy: thêm `imei`, migrate báo OK 8/8 cửa hàng, rồi
                 * `GET /api/repairs` 500 sạch, trang Sửa Chữa trắng.
                 * ⇒ ĐỔI SCHEMA THÌ PHẢI THÊM MỘT DÒNG ALTER Ở ĐÂY. */
                await (sp as any).$executeRawUnsafe(`ALTER TABLE "Repair" ADD COLUMN IF NOT EXISTS "imei" TEXT`)
                await (sp as any).$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Repair_imei_idx" ON "Repair"("imei")`)
                await (sp as any).$executeRawUnsafe(`ALTER TABLE "Repair" ADD COLUMN IF NOT EXISTS "customerId" TEXT`)
                await (sp as any).$executeRawUnsafe(`ALTER TABLE "Repair" ADD COLUMN IF NOT EXISTS "transactionId" TEXT`)
                await (sp as any).$executeRawUnsafe(`ALTER TABLE "Repair" ADD COLUMN IF NOT EXISTS "soldReceiptNumber" TEXT`)
                // Gửi NCC theo lô + chọn NCC (2026-08-19)
                await (sp as any).$executeRawUnsafe(`ALTER TABLE "Repair" ADD COLUMN IF NOT EXISTS "supplierId" TEXT`)
                await (sp as any).$executeRawUnsafe(`ALTER TABLE "Repair" ADD COLUMN IF NOT EXISTS "supplierName" TEXT`)
                await (sp as any).$executeRawUnsafe(`ALTER TABLE "Repair" ADD COLUMN IF NOT EXISTS "supplierBatchCode" TEXT`)
                await (sp as any).$executeRawUnsafe(`ALTER TABLE "Repair" ADD COLUMN IF NOT EXISTS "sentToSupplierAt" TIMESTAMP(3)`)
                await (sp as any).$executeRawUnsafe(`ALTER TABLE "Repair" ADD COLUMN IF NOT EXISTS "queuedForSupplierAt" TIMESTAMP(3)`)

                // SalesTrip pause support (2026-05-13)
                await (sp as any).$executeRawUnsafe(`ALTER TABLE "SalesTrip" ADD COLUMN IF NOT EXISTS "pausedAt" TIMESTAMP`)

                // SalesTripLog activity history (2026-05-13)
                await (sp as any).$executeRawUnsafe(`
                    CREATE TABLE IF NOT EXISTS "SalesTripLog" (
                        "id" TEXT NOT NULL,
                        "tripId" TEXT NOT NULL,
                        "action" TEXT NOT NULL,
                        "notes" TEXT,
                        "userId" TEXT NOT NULL,
                        "userName" TEXT,
                        "metadata" TEXT,
                        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        CONSTRAINT "SalesTripLog_pkey" PRIMARY KEY ("id"),
                        CONSTRAINT "SalesTripLog_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "SalesTrip"("id") ON DELETE CASCADE ON UPDATE CASCADE
                    )
                `)
                await (sp as any).$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "SalesTripLog_tripId_idx" ON "SalesTripLog"("tripId")`)
                await (sp as any).$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "SalesTripLog_createdAt_idx" ON "SalesTripLog"("createdAt")`)

                // Supplier payable + Import receipt payment/due-date tracking (2026-06)
                // db push trong container không áp dụng được — thêm cột trực tiếp ở đây.
                await (sp as any).$executeRawUnsafe(`ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "payable" DOUBLE PRECISION NOT NULL DEFAULT 0`)
                await (sp as any).$executeRawUnsafe(`ALTER TABLE "ImportReceipt" ADD COLUMN IF NOT EXISTS "paidAmount" DOUBLE PRECISION NOT NULL DEFAULT 0`)
                await (sp as any).$executeRawUnsafe(`ALTER TABLE "ImportReceipt" ADD COLUMN IF NOT EXISTS "paymentStatus" TEXT NOT NULL DEFAULT 'paid'`)
                await (sp as any).$executeRawUnsafe(`ALTER TABLE "ImportReceipt" ADD COLUMN IF NOT EXISTS "dueDate" TIMESTAMP(3)`)
                await (sp as any).$executeRawUnsafe(`ALTER TABLE "ImportReceipt" ADD COLUMN IF NOT EXISTS "paymentTerm" TEXT`)

                // Hoàn kho đúng đơn vị gốc + chống trừ kho 2 lần đơn sàn (2026-07-02)
                await (sp as any).$executeRawUnsafe(`ALTER TABLE "TransactionItem" ADD COLUMN IF NOT EXISTS "baseQuantity" DOUBLE PRECISION NOT NULL DEFAULT 0`)
                // Tài khoản nhận tiền của NCC — dựng mã VietQR ở trang Hạn thanh toán (03/09/2026)
                await (sp as any).$executeRawUnsafe(`ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "bankBin" TEXT`)
                await (sp as any).$executeRawUnsafe(`ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "bankAccountNo" TEXT`)
                await (sp as any).$executeRawUnsafe(`ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "bankAccountName" TEXT`)
                // Nhóm NCC dùng chung một tài khoản nhận tiền (03/09/2026)
                await (sp as any).$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "SupplierGroup" (
                    "id" TEXT NOT NULL PRIMARY KEY,
                    "name" TEXT NOT NULL,
                    "note" TEXT,
                    "bankBin" TEXT,
                    "bankAccountNo" TEXT,
                    "bankAccountName" TEXT,
                    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
                )`)
                await (sp as any).$executeRawUnsafe(`ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "groupId" TEXT`)
                await (sp as any).$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Supplier_groupId_idx" ON "Supplier"("groupId")`)
                // Nhật ký kho hư hỏng (04/09/2026)
                await (sp as any).$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "DamagedEntry" (
                    "id" TEXT NOT NULL PRIMARY KEY,
                    "warehouseId" TEXT NOT NULL,
                    "loai" TEXT NOT NULL,
                    "productId" TEXT NOT NULL,
                    "productName" TEXT NOT NULL,
                    "productSku" TEXT,
                    "quantity" INTEGER NOT NULL,
                    "nguon" TEXT,
                    "cachXuLy" TEXT,
                    "phiSuaChua" DOUBLE PRECISION NOT NULL DEFAULT 0,
                    "productDichId" TEXT,
                    "giaVonMoi" DOUBLE PRECISION,
                    "lyDo" TEXT,
                    "ghiChu" TEXT,
                    "branchId" TEXT,
                    "userId" TEXT,
                    "userName" TEXT,
                    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
                )`)
                await (sp as any).$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "DamagedEntry_warehouseId_idx" ON "DamagedEntry"("warehouseId")`)
                await (sp as any).$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "DamagedEntry_productId_idx" ON "DamagedEntry"("productId")`)
                await (sp as any).$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "DamagedEntry_createdAt_idx" ON "DamagedEntry"("createdAt")`)
                await (sp as any).$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "DamagedEntry_loai_idx" ON "DamagedEntry"("loai")`)
                // Từng lô, không gom chung (04/09/2026)
                await (sp as any).$executeRawUnsafe(`ALTER TABLE "DamagedEntry" ADD COLUMN IF NOT EXISTS "conLai" INTEGER`)
                await (sp as any).$executeRawUnsafe(`ALTER TABLE "DamagedEntry" ADD COLUMN IF NOT EXISTS "nguonEntryId" TEXT`)
                // Tên đăng nhập ngắn cho nhân viên (04/09/2026)
                await (sp as any).$executeRawUnsafe(`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "username" TEXT`)
                await (sp as any).$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "User_username_key" ON "User"("username")`)
                // URL Apps Script của trang quay video đóng gói — lưu theo cửa hàng (03/09/2026)
                await (sp as any).$executeRawUnsafe(`ALTER TABLE "StoreSettings" ADD COLUMN IF NOT EXISTS "driveAppsScriptUrl" TEXT`)
                // Nhật ký đóng gói — đếm đơn/ngày + chấm công cho nhân viên đóng hàng (03/09/2026)
                await (sp as any).$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "PackingLog" (
                    "id" TEXT NOT NULL PRIMARY KEY,
                    "branchId" TEXT,
                    "userId" TEXT NOT NULL,
                    "userName" TEXT NOT NULL,
                    "orderCode" TEXT NOT NULL,
                    "workDate" TIMESTAMP(3) NOT NULL,
                    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
                )`)
                await (sp as any).$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "PackingLog_userId_orderCode_workDate_key" ON "PackingLog"("userId","orderCode","workDate")`)
                await (sp as any).$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "PackingLog_workDate_idx" ON "PackingLog"("workDate")`)
                await (sp as any).$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "PackingLog_userId_workDate_idx" ON "PackingLog"("userId","workDate")`)
                await (sp as any).$executeRawUnsafe(`ALTER TABLE "OnlineOrder" ADD COLUMN IF NOT EXISTS "stockDeducted" BOOLEAN NOT NULL DEFAULT false`)

                // Mã ngành hàng sản phẩm sàn (2026-07-06) — TikTok category_chains / Shopee category_id
                await (sp as any).$executeRawUnsafe(`ALTER TABLE "OnlineProduct" ADD COLUMN IF NOT EXISTS "categoryId" TEXT`)
                await (sp as any).$executeRawUnsafe(`ALTER TABLE "OnlineProduct" ADD COLUMN IF NOT EXISTS "categoryName" TEXT`)

                // Webhook đầu ra — 2 bảng (2026-07-06). db push không chạy được trong
                // prod nên CREATE TABLE trực tiếp, khớp schema-store.prisma.
                await (sp as any).$executeRawUnsafe(`
                    CREATE TABLE IF NOT EXISTS "WebhookEndpoint" (
                        "id" TEXT NOT NULL,
                        "url" TEXT NOT NULL,
                        "secret" TEXT NOT NULL,
                        "events" TEXT NOT NULL DEFAULT '[]',
                        "description" TEXT,
                        "isActive" BOOLEAN NOT NULL DEFAULT true,
                        "failureCount" INTEGER NOT NULL DEFAULT 0,
                        "lastStatus" TEXT,
                        "lastFiredAt" TIMESTAMP(3),
                        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        CONSTRAINT "WebhookEndpoint_pkey" PRIMARY KEY ("id")
                    )
                `)
                await (sp as any).$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "WebhookEndpoint_isActive_idx" ON "WebhookEndpoint"("isActive")`)
                await (sp as any).$executeRawUnsafe(`
                    CREATE TABLE IF NOT EXISTS "WebhookDelivery" (
                        "id" TEXT NOT NULL,
                        "endpointId" TEXT NOT NULL,
                        "eventType" TEXT NOT NULL,
                        "payload" TEXT NOT NULL,
                        "status" TEXT NOT NULL DEFAULT 'pending',
                        "attempts" INTEGER NOT NULL DEFAULT 0,
                        "maxAttempts" INTEGER NOT NULL DEFAULT 6,
                        "nextRetryAt" TIMESTAMP(3),
                        "responseCode" INTEGER,
                        "lastError" TEXT,
                        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        "deliveredAt" TIMESTAMP(3),
                        CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id"),
                        CONSTRAINT "WebhookDelivery_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "WebhookEndpoint"("id") ON DELETE CASCADE ON UPDATE CASCADE
                    )
                `)
                await (sp as any).$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "WebhookDelivery_status_nextRetryAt_idx" ON "WebhookDelivery"("status", "nextRetryAt")`)
                await (sp as any).$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "WebhookDelivery_endpointId_idx" ON "WebhookDelivery"("endpointId")`)
                await (sp as any).$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "WebhookDelivery_createdAt_idx" ON "WebhookDelivery"("createdAt")`)

                // Idempotency bút toán: unique trên JournalEntry.reference.
                // Nếu dữ liệu cũ đã lỡ double-post thì index tạo fail — báo riêng để xử lý tay,
                // KHÔNG tự xóa bút toán.
                try {
                    await (sp as any).$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "JournalEntry_reference_key" ON "JournalEntry"("reference")`)
                } catch (idxErr: any) {
                    storeResults.push(`${store.name}: JournalEntry.reference unique FAILED (trùng ref cũ?): ${String(idxErr?.message || idxErr).slice(0, 200)}`)
                }

                // Fanpage Manager — 5 bảng Fb* (2026-07-02). db push không chạy được
                // trong prod nên CREATE TABLE trực tiếp, khớp schema-store.prisma.
                await (sp as any).$executeRawUnsafe(`
                    CREATE TABLE IF NOT EXISTS "FbUserToken" (
                        "id" TEXT NOT NULL,
                        "fbUserId" TEXT NOT NULL,
                        "name" TEXT,
                        "accessToken" TEXT NOT NULL,
                        "tokenExpiresAt" TIMESTAMP(3),
                        "scopes" TEXT NOT NULL DEFAULT '[]',
                        "connectedBy" TEXT,
                        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        CONSTRAINT "FbUserToken_pkey" PRIMARY KEY ("id")
                    )
                `)
                await (sp as any).$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "FbUserToken_fbUserId_key" ON "FbUserToken"("fbUserId")`)
                await (sp as any).$executeRawUnsafe(`
                    CREATE TABLE IF NOT EXISTS "FbPage" (
                        "id" TEXT NOT NULL,
                        "pageId" TEXT NOT NULL,
                        "name" TEXT NOT NULL,
                        "category" TEXT,
                        "avatar" TEXT,
                        "fanCount" INTEGER NOT NULL DEFAULT 0,
                        "accessToken" TEXT NOT NULL,
                        "tokenExpiresAt" TIMESTAMP(3),
                        "igUserId" TEXT,
                        "adAccountId" TEXT,
                        "webhookSubscribed" BOOLEAN NOT NULL DEFAULT false,
                        "autoReplyEnabled" BOOLEAN NOT NULL DEFAULT false,
                        "status" TEXT NOT NULL DEFAULT 'active',
                        "connectedBy" TEXT,
                        "lastSyncAt" TIMESTAMP(3),
                        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        CONSTRAINT "FbPage_pkey" PRIMARY KEY ("id")
                    )
                `)
                await (sp as any).$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "FbPage_pageId_key" ON "FbPage"("pageId")`)
                await (sp as any).$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "FbPage_status_idx" ON "FbPage"("status")`)
                await (sp as any).$executeRawUnsafe(`
                    CREATE TABLE IF NOT EXISTS "FbScheduledPost" (
                        "id" TEXT NOT NULL,
                        "pageId" TEXT NOT NULL,
                        "fbPostId" TEXT,
                        "message" TEXT NOT NULL DEFAULT '',
                        "mediaType" TEXT NOT NULL DEFAULT 'text',
                        "mediaUrls" TEXT NOT NULL DEFAULT '[]',
                        "linkUrl" TEXT,
                        "scheduledAt" TIMESTAMP(3) NOT NULL,
                        "status" TEXT NOT NULL DEFAULT 'scheduled',
                        "errorMessage" TEXT,
                        "publishedAt" TIMESTAMP(3),
                        "createdBy" TEXT,
                        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        CONSTRAINT "FbScheduledPost_pkey" PRIMARY KEY ("id"),
                        CONSTRAINT "FbScheduledPost_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "FbPage"("pageId") ON DELETE CASCADE ON UPDATE CASCADE
                    )
                `)
                await (sp as any).$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "FbScheduledPost_pageId_idx" ON "FbScheduledPost"("pageId")`)
                await (sp as any).$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "FbScheduledPost_status_idx" ON "FbScheduledPost"("status")`)
                await (sp as any).$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "FbScheduledPost_scheduledAt_idx" ON "FbScheduledPost"("scheduledAt")`)
                await (sp as any).$executeRawUnsafe(`
                    CREATE TABLE IF NOT EXISTS "FbCommentRule" (
                        "id" TEXT NOT NULL,
                        "pageId" TEXT NOT NULL,
                        "name" TEXT NOT NULL DEFAULT '',
                        "keyword" TEXT NOT NULL,
                        "matchType" TEXT NOT NULL DEFAULT 'contains',
                        "replyText" TEXT NOT NULL,
                        "privateReply" BOOLEAN NOT NULL DEFAULT false,
                        "hideComment" BOOLEAN NOT NULL DEFAULT false,
                        "enabled" BOOLEAN NOT NULL DEFAULT true,
                        "priority" INTEGER NOT NULL DEFAULT 0,
                        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        CONSTRAINT "FbCommentRule_pkey" PRIMARY KEY ("id"),
                        CONSTRAINT "FbCommentRule_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "FbPage"("pageId") ON DELETE CASCADE ON UPDATE CASCADE
                    )
                `)
                await (sp as any).$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "FbCommentRule_pageId_idx" ON "FbCommentRule"("pageId")`)
                await (sp as any).$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "FbCommentRule_enabled_idx" ON "FbCommentRule"("enabled")`)
                await (sp as any).$executeRawUnsafe(`
                    CREATE TABLE IF NOT EXISTS "FbAutoReplyLog" (
                        "id" TEXT NOT NULL,
                        "pageId" TEXT NOT NULL,
                        "commentId" TEXT NOT NULL,
                        "ruleId" TEXT,
                        "postId" TEXT,
                        "fromName" TEXT,
                        "commentMsg" TEXT,
                        "action" TEXT NOT NULL DEFAULT 'reply',
                        "replyText" TEXT,
                        "success" BOOLEAN NOT NULL DEFAULT true,
                        "errorMessage" TEXT,
                        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        CONSTRAINT "FbAutoReplyLog_pkey" PRIMARY KEY ("id"),
                        CONSTRAINT "FbAutoReplyLog_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "FbPage"("pageId") ON DELETE CASCADE ON UPDATE CASCADE
                    )
                `)
                await (sp as any).$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "FbAutoReplyLog_pageId_commentId_key" ON "FbAutoReplyLog"("pageId", "commentId")`)
                await (sp as any).$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "FbAutoReplyLog_pageId_idx" ON "FbAutoReplyLog"("pageId")`)
                await (sp as any).$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "FbAutoReplyLog_createdAt_idx" ON "FbAutoReplyLog"("createdAt")`)

                // Content AI (2026-08-15): hồ sơ thương hiệu · kế hoạch · bài nháp
                // chờ duyệt — khớp 3 model FbBrandProfile/FbContentPlan/FbContentDraft.
                await (sp as any).$executeRawUnsafe(`
                    CREATE TABLE IF NOT EXISTS "FbBrandProfile" (
                        "id" TEXT NOT NULL,
                        "brandName" TEXT NOT NULL DEFAULT '',
                        "industry" TEXT NOT NULL DEFAULT '',
                        "audience" TEXT NOT NULL DEFAULT '',
                        "toneOfVoice" TEXT NOT NULL DEFAULT 'than-thien',
                        "usp" TEXT NOT NULL DEFAULT '',
                        "cta" TEXT NOT NULL DEFAULT '',
                        "hashtags" TEXT NOT NULL DEFAULT '[]',
                        "bannedWords" TEXT NOT NULL DEFAULT '[]',
                        "emojiLevel" TEXT NOT NULL DEFAULT 'vua',
                        "postsPerWeek" INTEGER NOT NULL DEFAULT 5,
                        "bestHours" TEXT NOT NULL DEFAULT '[]',
                        "pillarMix" TEXT NOT NULL DEFAULT '{}',
                        "notes" TEXT NOT NULL DEFAULT '',
                        "createdBy" TEXT,
                        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        CONSTRAINT "FbBrandProfile_pkey" PRIMARY KEY ("id")
                    )
                `)
                await (sp as any).$executeRawUnsafe(`
                    CREATE TABLE IF NOT EXISTS "FbContentPlan" (
                        "id" TEXT NOT NULL,
                        "pageId" TEXT NOT NULL,
                        "title" TEXT NOT NULL,
                        "goal" TEXT NOT NULL DEFAULT '',
                        "fromDate" TIMESTAMP(3) NOT NULL,
                        "toDate" TIMESTAMP(3) NOT NULL,
                        "status" TEXT NOT NULL DEFAULT 'active',
                        "summary" TEXT,
                        "createdBy" TEXT,
                        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        CONSTRAINT "FbContentPlan_pkey" PRIMARY KEY ("id")
                    )
                `)
                await (sp as any).$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "FbContentPlan_pageId_status_idx" ON "FbContentPlan"("pageId", "status")`)
                await (sp as any).$executeRawUnsafe(`
                    CREATE TABLE IF NOT EXISTS "FbContentDraft" (
                        "id" TEXT NOT NULL,
                        "planId" TEXT,
                        "pageId" TEXT NOT NULL,
                        "pillar" TEXT NOT NULL DEFAULT 'khac',
                        "title" TEXT NOT NULL DEFAULT '',
                        "hook" TEXT NOT NULL DEFAULT '',
                        "message" TEXT NOT NULL,
                        "hashtags" TEXT NOT NULL DEFAULT '[]',
                        "mediaIdea" TEXT NOT NULL DEFAULT '',
                        "mediaUrls" TEXT NOT NULL DEFAULT '[]',
                        "linkUrl" TEXT,
                        "productIds" TEXT NOT NULL DEFAULT '[]',
                        "suggestedAt" TIMESTAMP(3),
                        "status" TEXT NOT NULL DEFAULT 'pending',
                        "rejectReason" TEXT,
                        "scheduledPostId" TEXT,
                        "fbPostId" TEXT,
                        "source" TEXT NOT NULL DEFAULT 'ai',
                        "createdBy" TEXT,
                        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        CONSTRAINT "FbContentDraft_pkey" PRIMARY KEY ("id"),
                        CONSTRAINT "FbContentDraft_planId_fkey" FOREIGN KEY ("planId") REFERENCES "FbContentPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE
                    )
                `)
                await (sp as any).$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "FbContentDraft_pageId_status_idx" ON "FbContentDraft"("pageId", "status")`)
                await (sp as any).$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "FbContentDraft_suggestedAt_idx" ON "FbContentDraft"("suggestedAt")`)

                // Trợ lý AI tự động theo lịch (2026-07-27). db push là no-op ở prod
                // nên phải tạo bằng raw SQL như các bảng Fb* ở trên.
                await (sp as any).$executeRawUnsafe(`
                    CREATE TABLE IF NOT EXISTS "AiAgentJob" (
                        "id" TEXT NOT NULL,
                        "name" TEXT NOT NULL,
                        "prompt" TEXT NOT NULL,
                        "scheduleKind" TEXT NOT NULL DEFAULT 'daily',
                        "atHour" INTEGER NOT NULL DEFAULT 8,
                        "atMinute" INTEGER NOT NULL DEFAULT 0,
                        "intervalMinutes" INTEGER NOT NULL DEFAULT 60,
                        "enabled" BOOLEAN NOT NULL DEFAULT true,
                        "allowWrite" BOOLEAN NOT NULL DEFAULT false,
                        "allowedTools" TEXT NOT NULL DEFAULT '[]',
                        "maxSteps" INTEGER NOT NULL DEFAULT 8,
                        "lastRunAt" TIMESTAMP(3),
                        "nextRunAt" TIMESTAMP(3),
                        "createdBy" TEXT,
                        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        CONSTRAINT "AiAgentJob_pkey" PRIMARY KEY ("id")
                    )
                `)
                await (sp as any).$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "AiAgentJob_enabled_nextRunAt_idx" ON "AiAgentJob"("enabled", "nextRunAt")`)
                await (sp as any).$executeRawUnsafe(`
                    CREATE TABLE IF NOT EXISTS "AiAgentRun" (
                        "id" TEXT NOT NULL,
                        "jobId" TEXT NOT NULL,
                        "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        "finishedAt" TIMESTAMP(3),
                        "status" TEXT NOT NULL DEFAULT 'running',
                        "summary" TEXT,
                        "toolCalls" TEXT NOT NULL DEFAULT '[]',
                        "steps" INTEGER NOT NULL DEFAULT 0,
                        "chamTran" BOOLEAN NOT NULL DEFAULT false,
                        "errorMessage" TEXT,
                        "trigger" TEXT NOT NULL DEFAULT 'cron',
                        CONSTRAINT "AiAgentRun_pkey" PRIMARY KEY ("id"),
                        CONSTRAINT "AiAgentRun_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "AiAgentJob"("id") ON DELETE CASCADE ON UPDATE CASCADE
                    )
                `)
                await (sp as any).$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "AiAgentRun_jobId_idx" ON "AiAgentRun"("jobId")`)
                await (sp as any).$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "AiAgentRun_startedAt_idx" ON "AiAgentRun"("startedAt")`)

                // SMTP email công ty cho CRM (2026-07-12)
                await (sp as any).$executeRawUnsafe(`ALTER TABLE "StoreSettings" ADD COLUMN IF NOT EXISTS "smtpConfig" TEXT`)

                // Key Gemini riêng cửa hàng cho Trợ lý AI (2026-07-19)
                await (sp as any).$executeRawUnsafe(`ALTER TABLE "StoreSettings" ADD COLUMN IF NOT EXISTS "geminiApiKey" TEXT`)

                // Thư mục Drive riêng cửa hàng cho video đóng gói (2026-08-01) —
                // thiếu cột này thì storeSettings.findFirst() (SELECT đủ cột theo
                // schema) trả P2022 → GET /api/store-settings 500 cho MỌI cửa hàng.
                await (sp as any).$executeRawUnsafe(`ALTER TABLE "StoreSettings" ADD COLUMN IF NOT EXISTS "driveFolderId" TEXT`)

                // Cờ hoá đơn VAT đầu vào cho phiếu nhập (2026-07-24) — chỉ phiếu có
                // HĐ GTGT mới tính vào tồn kho thuế (gate xuất HĐ).
                await (sp as any).$executeRawUnsafe(`ALTER TABLE "ImportReceipt" ADD COLUMN IF NOT EXISTS "hasVatInvoice" BOOLEAN NOT NULL DEFAULT false`)
                await (sp as any).$executeRawUnsafe(`ALTER TABLE "ImportReceipt" ADD COLUMN IF NOT EXISTS "vatInvoiceNo" TEXT`)
                // Chi phí cấp phiếu để phân bổ vào giá vốn (2026-07-24)
                for (const c of ['vatAmount', 'shippingFee', 'importTax', 'otherFees', 'totalDiscount']) {
                    await (sp as any).$executeRawUnsafe(`ALTER TABLE "ImportReceipt" ADD COLUMN IF NOT EXISTS "${c}" DOUBLE PRECISION NOT NULL DEFAULT 0`)
                }
                // Cổng kiểm hàng cho đặt hàng nhập (2026-08-04): chấp nhận phiếu
                // mới ghi kho — lưu ai kiểm, lúc nào, và lý do khi từ chối.
                await (sp as any).$executeRawUnsafe(`ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "checkedBy" TEXT`)
                await (sp as any).$executeRawUnsafe(`ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "checkedByName" TEXT`)
                await (sp as any).$executeRawUnsafe(`ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "checkedAt" TIMESTAMP(3)`)
                await (sp as any).$executeRawUnsafe(`ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "rejectReason" TEXT`)
                // Hộp thư Gmail riêng để check trong app (04/08/2026)
                await (sp as any).$executeRawUnsafe(`ALTER TABLE "StoreSettings" ADD COLUMN IF NOT EXISTS "mailboxConfig" TEXT`)
                // Hoá đơn đầu vào bóc từ email HĐĐT (05/08/2026) — giữ đủ dữ liệu
                // khấu trừ VAT trên phiếu chi
                await (sp as any).$executeRawUnsafe(`ALTER TABLE "Expense" ADD COLUMN IF NOT EXISTS "vatAmount" DOUBLE PRECISION`)
                for (const c of ['supplierName', 'supplierTaxCode', 'invoiceNo', 'invoiceSymbol', 'lookupCode', 'taxAuthorityCode', 'sourceRef']) {
                    await (sp as any).$executeRawUnsafe(`ALTER TABLE "Expense" ADD COLUMN IF NOT EXISTS "${c}" TEXT`)
                }
                await (sp as any).$executeRawUnsafe(`ALTER TABLE "Expense" ADD COLUMN IF NOT EXISTS "invoiceDate" TIMESTAMP(3)`)
                await (sp as any).$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Expense_sourceRef_idx" ON "Expense"("sourceRef")`)

                // Đơn hỏa tốc Shopee — Instant Delivery (05/08/2026): cờ instant +
                // hạn bàn giao ĐVVC riêng (trước đây ship_by_date bị map nhầm vào shippedAt)
                await (sp as any).$executeRawUnsafe(`ALTER TABLE "OnlineOrder" ADD COLUMN IF NOT EXISTS "isInstant" BOOLEAN NOT NULL DEFAULT false`)
                await (sp as any).$executeRawUnsafe(`ALTER TABLE "OnlineOrder" ADD COLUMN IF NOT EXISTS "shipByDate" TIMESTAMP(3)`)
                // Cờ "đã thử lên phiếu mà không khớp SKU nào" — chặn quét lại mỗi lượt
                // đồng bộ (05/09/2026: 1.033 đơn × ~5 lượt/ngày × ~4 truy vấn trên pool 1).
                await (sp as any).$executeRawUnsafe(`ALTER TABLE "OnlineOrder" ADD COLUMN IF NOT EXISTS "khongKhopSku" BOOLEAN NOT NULL DEFAULT false`)
                await (sp as any).$executeRawUnsafe(`ALTER TABLE "OnlineOrder" ADD COLUMN IF NOT EXISTS "khongKhopLuc" TIMESTAMP(3)`)

                // Ánh xạ mã hàng trên SÀN → sản phẩm kho (2026-07-23) — đơn TikTok/
                // Shopee dùng SKU riêng không khớp kho khiến đơn không lên phiếu.
                await (sp as any).$executeRawUnsafe(`
                    CREATE TABLE IF NOT EXISTS "SkuMapping" (
                        "id" TEXT NOT NULL,
                        "platformSku" TEXT NOT NULL,
                        "productId" TEXT NOT NULL,
                        "platform" TEXT,
                        "note" TEXT,
                        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        CONSTRAINT "SkuMapping_pkey" PRIMARY KEY ("id"),
                        CONSTRAINT "SkuMapping_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE
                    )
                `)
                // Con trỏ "đã gộp" (thay cho việc đổi mã — đổi mã làm gãy đẩy tồn lên sàn)
                await (sp as any).$executeRawUnsafe(`ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "mergedIntoId" TEXT`)
                await (sp as any).$executeRawUnsafe(`ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "mergedRate" DOUBLE PRECISION NOT NULL DEFAULT 1`)
                // SỬA HẬU QUẢ bản gộp cũ: trả lại mã gốc cho sản phẩm bị đổi thành
                // "<sku>__MERGED" (chỉ khi mã gốc chưa bị ai dùng lại)
                await (sp as any).$executeRawUnsafe(`
                    UPDATE "Product" p SET sku = left(p.sku, length(p.sku) - 8)
                    WHERE p.sku LIKE '%\_\_MERGED'
                      AND NOT EXISTS (SELECT 1 FROM "Product" q WHERE q.sku = left(p.sku, length(p.sku) - 8))`)
                // …rồi gắn con trỏ gộp theo đúng ánh xạ mà bước gộp đã tạo
                await (sp as any).$executeRawUnsafe(`
                    UPDATE "Product" p
                    SET "mergedIntoId" = m."productId", "mergedRate" = COALESCE(m."conversionRate", 1)
                    FROM "SkuMapping" m
                    WHERE m."platformSku" = p.sku AND m.platform IS NULL
                      AND p.name LIKE '[ĐÃ GỘP%' AND p."mergedIntoId" IS NULL`)

                // DỌN tên đã bị bản gộp cũ chèn tiền tố "[ĐÃ GỘP → X] " — tên là dữ
                // liệu gốc (in hoá đơn/tem), không được sửa. Chạy SAU bước gắn con trỏ
                // ở trên vì bước đó dò theo chính tiền tố này.
                // KHÔNG dùng regex: chuỗi regex trong mã nguồn dễ mất dấu thoát
                // (\s thành chữ "s") làm lệnh chạy nhưng không khớp gì. Cắt theo VỊ
                // TRÍ dấu "]" cho chắc; lặp 5 lần vì có tên bị chèn tiền tố chồng
                // nhau do gộp lặp nhiều lần.
                for (let pass = 0; pass < 5; pass++) {
                    await (sp as any).$executeRawUnsafe(
                        `UPDATE "Product"
                         SET name = btrim(substr(name, strpos(name, ']') + 1))
                         WHERE name LIKE $1 AND strpos(name, ']') > 0`,
                        '[ĐÃ GỘP →%')
                }

                // Sản phẩm đã nhập nhưng thực chất là COMBO
                await (sp as any).$executeRawUnsafe(`ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "bundleId" TEXT`)

                // Ánh xạ SKU → COMBO (SKU sàn là combo nhiều món)
                await (sp as any).$executeRawUnsafe(`ALTER TABLE "SkuMapping" ADD COLUMN IF NOT EXISTS "bundleId" TEXT`)

                // Hệ số quy đổi cho ánh xạ SKU (hoá đơn ghi vỉ, kho đếm cái)
                await (sp as any).$executeRawUnsafe(`ALTER TABLE "SkuMapping" ADD COLUMN IF NOT EXISTS "conversionRate" DOUBLE PRECISION NOT NULL DEFAULT 1`)

                // ĐVT xuất hoá đơn (nhập theo vỉ, bán theo cái, HĐ ghi theo vỉ)
                await (sp as any).$executeRawUnsafe(`ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "invoiceUnit" TEXT`)

                // Thông tin xuất HĐ khách yêu cầu (JSON {name,taxCode,address,email})
                // — có là cron tự xuất khi giao xong + tự gửi email hoá đơn
                await (sp as any).$executeRawUnsafe(`ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "vatBuyerInfo" TEXT`)

                // Bảng thông báo bền (xuất HĐ…) — schema cũ có thể chưa tạo
                await (sp as any).$executeRawUnsafe(`
                    CREATE TABLE IF NOT EXISTS "Notification" (
                        "id" TEXT NOT NULL,
                        "title" TEXT NOT NULL,
                        "message" TEXT NOT NULL,
                        "type" TEXT NOT NULL DEFAULT 'info',
                        "read" BOOLEAN NOT NULL DEFAULT false,
                        "userId" TEXT,
                        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
                    )`)

                // Doanh thu ghi chép tay của HKD (sổ S2b) — bảng CHƯA từng được tạo
                // dù route /api/tax/hkd-revenue dùng nó → GET/POST đều 500 (2026-07-25)
                await (sp as any).$executeRawUnsafe(`
                    CREATE TABLE IF NOT EXISTS "HkdRevenueEntry" (
                        "id" TEXT NOT NULL,
                        "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        "soChungTu" TEXT,
                        "dienGiai" TEXT NOT NULL,
                        "doanhThu" DOUBLE PRECISION NOT NULL DEFAULT 0,
                        "chietKhau" DOUBLE PRECISION NOT NULL DEFAULT 0,
                        "thueGTGT" DOUBLE PRECISION NOT NULL DEFAULT 0,
                        "doanhThuThuan" DOUBLE PRECISION NOT NULL DEFAULT 0,
                        "tncnUocTinh" DOUBLE PRECISION NOT NULL DEFAULT 0,
                        "phuongThucTT" TEXT NOT NULL DEFAULT 'Tiền mặt',
                        "ghiChu" TEXT,
                        "branchId" TEXT,
                        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        CONSTRAINT "HkdRevenueEntry_pkey" PRIMARY KEY ("id")
                    )
                `)
                await (sp as any).$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "HkdRevenueEntry_date_idx" ON "HkdRevenueEntry"("date")`)
                await (sp as any).$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "HkdRevenueEntry_branchId_idx" ON "HkdRevenueEntry"("branchId")`)

                await (sp as any).$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "SkuMapping_platformSku_platform_key" ON "SkuMapping"("platformSku", "platform")`)
                await (sp as any).$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "SkuMapping_productId_idx" ON "SkuMapping"("productId")`)

                // Log email chào hàng + theo dõi phản hồi (2026-07-12)
                await (sp as any).$executeRawUnsafe(`
                    CREATE TABLE IF NOT EXISTS "CrmEmailLog" (
                        "id" TEXT NOT NULL,
                        "customerId" TEXT,
                        "customerName" TEXT NOT NULL,
                        "email" TEXT NOT NULL,
                        "subject" TEXT NOT NULL,
                        "messageId" TEXT,
                        "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        "repliedAt" TIMESTAMP(3),
                        "replySubject" TEXT,
                        CONSTRAINT "CrmEmailLog_pkey" PRIMARY KEY ("id")
                    )
                `)
                await (sp as any).$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "CrmEmailLog_email_idx" ON "CrmEmailLog"("email")`)
                await (sp as any).$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "CrmEmailLog_repliedAt_idx" ON "CrmEmailLog"("repliedAt")`)
                await (sp as any).$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "CrmEmailLog_sentAt_idx" ON "CrmEmailLog"("sentAt")`)

                // CRM: công việc / cơ hội bán hàng / nhật ký (2026-07-26) — trước
                // đây chỉ nằm ở localStorage nên mỗi máy một dữ liệu.
                await (sp as any).$executeRawUnsafe(`
                    CREATE TABLE IF NOT EXISTS "CrmTask" (
                        "id" TEXT NOT NULL,
                        "title" TEXT NOT NULL,
                        "description" TEXT,
                        "customerId" TEXT,
                        "customerName" TEXT,
                        "status" TEXT NOT NULL DEFAULT 'todo',
                        "priority" TEXT NOT NULL DEFAULT 'medium',
                        "type" TEXT,
                        "dueDate" TIMESTAMP(3),
                        "assignee" TEXT,
                        "createdBy" TEXT,
                        "completedAt" TIMESTAMP(3),
                        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        CONSTRAINT "CrmTask_pkey" PRIMARY KEY ("id")
                    )
                `)
                await (sp as any).$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "CrmTask_status_idx" ON "CrmTask"("status")`)
                await (sp as any).$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "CrmTask_dueDate_idx" ON "CrmTask"("dueDate")`)
                await (sp as any).$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "CrmTask_customerId_idx" ON "CrmTask"("customerId")`)

                await (sp as any).$executeRawUnsafe(`
                    CREATE TABLE IF NOT EXISTS "CrmDeal" (
                        "id" TEXT NOT NULL,
                        "title" TEXT NOT NULL,
                        "customerId" TEXT,
                        "customerName" TEXT,
                        "value" DOUBLE PRECISION NOT NULL DEFAULT 0,
                        "stage" TEXT NOT NULL DEFAULT 'lead',
                        "probability" INTEGER NOT NULL DEFAULT 0,
                        "assignee" TEXT,
                        "note" TEXT,
                        "sortOrder" INTEGER NOT NULL DEFAULT 0,
                        "expectedCloseDate" TIMESTAMP(3),
                        "closedAt" TIMESTAMP(3),
                        "createdBy" TEXT,
                        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        CONSTRAINT "CrmDeal_pkey" PRIMARY KEY ("id")
                    )
                `)
                await (sp as any).$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "CrmDeal_stage_idx" ON "CrmDeal"("stage")`)
                await (sp as any).$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "CrmDeal_customerId_idx" ON "CrmDeal"("customerId")`)
                await (sp as any).$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "CrmDeal_expectedCloseDate_idx" ON "CrmDeal"("expectedCloseDate")`)

                await (sp as any).$executeRawUnsafe(`
                    CREATE TABLE IF NOT EXISTS "CrmActivity" (
                        "id" TEXT NOT NULL,
                        "module" TEXT NOT NULL,
                        "action" TEXT NOT NULL,
                        "description" TEXT NOT NULL,
                        "userId" TEXT,
                        "userName" TEXT,
                        "entityId" TEXT,
                        "entityName" TEXT,
                        "metadata" TEXT,
                        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        CONSTRAINT "CrmActivity_pkey" PRIMARY KEY ("id")
                    )
                `)
                await (sp as any).$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "CrmActivity_createdAt_idx" ON "CrmActivity"("createdAt")`)
                await (sp as any).$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "CrmActivity_module_idx" ON "CrmActivity"("module")`)
                await (sp as any).$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "CrmActivity_entityId_idx" ON "CrmActivity"("entityId")`)

                // CRM đợt 2 (2026-07-26): nhật ký Zalo + chiến dịch chăm sóc
                await (sp as any).$executeRawUnsafe(`
                    CREATE TABLE IF NOT EXISTS "CrmZaloLog" (
                        "id" TEXT NOT NULL,
                        "customerId" TEXT NOT NULL,
                        "customerName" TEXT,
                        "direction" TEXT NOT NULL DEFAULT 'out',
                        "content" TEXT NOT NULL,
                        "staffName" TEXT,
                        "starred" BOOLEAN NOT NULL DEFAULT false,
                        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        CONSTRAINT "CrmZaloLog_pkey" PRIMARY KEY ("id")
                    )
                `)
                await (sp as any).$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "CrmZaloLog_customerId_idx" ON "CrmZaloLog"("customerId")`)
                await (sp as any).$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "CrmZaloLog_createdAt_idx" ON "CrmZaloLog"("createdAt")`)

                await (sp as any).$executeRawUnsafe(`
                    CREATE TABLE IF NOT EXISTS "CrmCampaign" (
                        "id" TEXT NOT NULL,
                        "name" TEXT NOT NULL,
                        "channel" TEXT NOT NULL DEFAULT 'email',
                        "status" TEXT NOT NULL DEFAULT 'draft',
                        "template" TEXT NOT NULL DEFAULT '',
                        "targetTiers" TEXT NOT NULL DEFAULT '[]',
                        "targetCount" INTEGER NOT NULL DEFAULT 0,
                        "sentCount" INTEGER NOT NULL DEFAULT 0,
                        "openRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
                        "responseRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
                        "scheduledAt" TIMESTAMP(3),
                        "sentAt" TIMESTAMP(3),
                        "createdBy" TEXT,
                        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        CONSTRAINT "CrmCampaign_pkey" PRIMARY KEY ("id")
                    )
                `)
                await (sp as any).$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "CrmCampaign_status_idx" ON "CrmCampaign"("status")`)
                await (sp as any).$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "CrmCampaign_channel_idx" ON "CrmCampaign"("channel")`)

                // Quản lý xe — nhật ký nhiên liệu + giấy tờ xe (2026-07-09).
                // db push không chạy trong prod nên CREATE TABLE trực tiếp, khớp schema-store.prisma.
                await (sp as any).$executeRawUnsafe(`
                    CREATE TABLE IF NOT EXISTS "VehicleFuelLog" (
                        "id" TEXT NOT NULL,
                        "vehicleId" TEXT NOT NULL,
                        "fuelDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        "liters" DOUBLE PRECISION NOT NULL DEFAULT 0,
                        "pricePerLiter" DOUBLE PRECISION NOT NULL DEFAULT 0,
                        "cost" DOUBLE PRECISION NOT NULL DEFAULT 0,
                        "kmAtFill" DOUBLE PRECISION NOT NULL DEFAULT 0,
                        "fuelType" TEXT,
                        "station" TEXT,
                        "isFullTank" BOOLEAN NOT NULL DEFAULT true,
                        "notes" TEXT,
                        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        CONSTRAINT "VehicleFuelLog_pkey" PRIMARY KEY ("id"),
                        CONSTRAINT "VehicleFuelLog_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE
                    )
                `)
                await (sp as any).$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "VehicleFuelLog_vehicleId_idx" ON "VehicleFuelLog"("vehicleId")`)
                await (sp as any).$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "VehicleFuelLog_fuelDate_idx" ON "VehicleFuelLog"("fuelDate")`)
                await (sp as any).$executeRawUnsafe(`
                    CREATE TABLE IF NOT EXISTS "VehicleDocument" (
                        "id" TEXT NOT NULL,
                        "vehicleId" TEXT NOT NULL,
                        "type" TEXT NOT NULL,
                        "name" TEXT NOT NULL,
                        "documentNumber" TEXT,
                        "fileUrl" TEXT,
                        "issuer" TEXT,
                        "issueDate" TIMESTAMP(3),
                        "expiryDate" TIMESTAMP(3),
                        "notes" TEXT,
                        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        CONSTRAINT "VehicleDocument_pkey" PRIMARY KEY ("id"),
                        CONSTRAINT "VehicleDocument_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE
                    )
                `)
                await (sp as any).$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "VehicleDocument_vehicleId_idx" ON "VehicleDocument"("vehicleId")`)
                await (sp as any).$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "VehicleDocument_expiryDate_idx" ON "VehicleDocument"("expiryDate")`)

                // ─── Cổng đồng bộ KiotViet ─────────────────────────────────
                await (sp as any).$executeRawUnsafe(`
                    CREATE TABLE IF NOT EXISTS "KiotVietConfig" (
                        "id" TEXT NOT NULL DEFAULT 'default',
                        "clientId" TEXT NOT NULL,
                        "clientSecret" TEXT NOT NULL,
                        "retailer" TEXT NOT NULL,
                        "webhookToken" TEXT NOT NULL,
                        "webhookSecret" TEXT,
                        "strictSignature" BOOLEAN NOT NULL DEFAULT false,
                        "enabled" BOOLEAN NOT NULL DEFAULT false,
                        "syncProducts" BOOLEAN NOT NULL DEFAULT true,
                        "syncCustomers" BOOLEAN NOT NULL DEFAULT true,
                        "syncSuppliers" BOOLEAN NOT NULL DEFAULT true,
                        "syncInvoices" BOOLEAN NOT NULL DEFAULT false,
                        "overwriteNames" BOOLEAN NOT NULL DEFAULT false,
                        "overwritePrices" BOOLEAN NOT NULL DEFAULT false,
                        "overwriteStock" BOOLEAN NOT NULL DEFAULT false,
                        "defaultCategoryId" TEXT,
                        "defaultWarehouseId" TEXT,
                        "branchIds" TEXT,
                        "lastSyncAt" TIMESTAMP(3),
                        "lastWebhookAt" TIMESTAMP(3),
                        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        CONSTRAINT "KiotVietConfig_pkey" PRIMARY KEY ("id")
                    )
                `)
                await (sp as any).$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "KiotVietConfig_webhookToken_key" ON "KiotVietConfig"("webhookToken")`)

                await (sp as any).$executeRawUnsafe(`
                    CREATE TABLE IF NOT EXISTS "KiotVietMap" (
                        "id" TEXT NOT NULL,
                        "entity" TEXT NOT NULL,
                        "kvId" TEXT NOT NULL,
                        "kvCode" TEXT,
                        "localId" TEXT NOT NULL,
                        "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        CONSTRAINT "KiotVietMap_pkey" PRIMARY KEY ("id")
                    )
                `)
                await (sp as any).$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "KiotVietMap_entity_kvId_key" ON "KiotVietMap"("entity", "kvId")`)
                await (sp as any).$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "KiotVietMap_entity_localId_idx" ON "KiotVietMap"("entity", "localId")`)
                await (sp as any).$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "KiotVietMap_kvCode_idx" ON "KiotVietMap"("kvCode")`)

                await (sp as any).$executeRawUnsafe(`
                    CREATE TABLE IF NOT EXISTS "KiotVietSyncLog" (
                        "id" TEXT NOT NULL,
                        "entity" TEXT NOT NULL,
                        "mode" TEXT NOT NULL DEFAULT 'manual',
                        "dryRun" BOOLEAN NOT NULL DEFAULT false,
                        "fromDate" TIMESTAMP(3),
                        "toDate" TIMESTAMP(3),
                        "fetched" INTEGER NOT NULL DEFAULT 0,
                        "created" INTEGER NOT NULL DEFAULT 0,
                        "updated" INTEGER NOT NULL DEFAULT 0,
                        "skipped" INTEGER NOT NULL DEFAULT 0,
                        "failed" INTEGER NOT NULL DEFAULT 0,
                        "status" TEXT NOT NULL DEFAULT 'running',
                        "errors" TEXT,
                        "details" TEXT,
                        "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        "heartbeatAt" TIMESTAMP(3),
                        "finishedAt" TIMESTAMP(3),
                        CONSTRAINT "KiotVietSyncLog_pkey" PRIMARY KEY ("id")
                    )
                `)
                // Bảng đã tạo từ đợt trước thì thêm cột nhịp tim vào
                await (sp as any).$executeRawUnsafe(`ALTER TABLE "KiotVietSyncLog" ADD COLUMN IF NOT EXISTS "heartbeatAt" TIMESTAMP(3)`)
                await (sp as any).$executeRawUnsafe(`ALTER TABLE "KiotVietSyncLog" ADD COLUMN IF NOT EXISTS "attempts" INTEGER NOT NULL DEFAULT 0`)
                await (sp as any).$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "KiotVietSyncLog_mode_idx" ON "KiotVietSyncLog"("mode")`)
                await (sp as any).$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "KiotVietSyncLog_status_idx" ON "KiotVietSyncLog"("status")`)
                await (sp as any).$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "KiotVietSyncLog_startedAt_idx" ON "KiotVietSyncLog"("startedAt")`)

                /**
                 * LỆCH SCHEMA LÀM SẬP ĐĂNG NHẬP — vá gấp 10/08/2026.
                 *
                 * Tính năng kết nối Google Drive thêm 4 cột vào StoreSettings
                 * trong schema Prisma nhưng KHÔNG hề thêm ALTER ở đây. Prisma
                 * sinh client SELECT đủ mọi cột, nên chỉ cần thiếu một cột là
                 * `storeSettings.findUnique()` NÉM LỖI — mà đăng nhập có gọi nó.
                 * Kết quả: nhập đúng mật khẩu vẫn nhận 500 "Internal server
                 * error", nhìn như sập máy chủ:
                 *
                 *   Login error: Invalid `prisma.storeSettings.findUnique()`
                 *   The column `StoreSettings.driveOauthToken` does not exist
                 *
                 * Bài học: production KHÔNG chạy `prisma migrate`, nên thêm cột
                 * vào schema mà quên thêm ALTER ở đây là gài mìn hẹn giờ.
                 */
                await (sp as any).$executeRawUnsafe(`ALTER TABLE "StoreSettings" ADD COLUMN IF NOT EXISTS "driveFolderId" TEXT`)
                await (sp as any).$executeRawUnsafe(`ALTER TABLE "StoreSettings" ADD COLUMN IF NOT EXISTS "driveOauthToken" TEXT`)
                await (sp as any).$executeRawUnsafe(`ALTER TABLE "StoreSettings" ADD COLUMN IF NOT EXISTS "driveOauthEmail" TEXT`)
                await (sp as any).$executeRawUnsafe(`ALTER TABLE "StoreSettings" ADD COLUMN IF NOT EXISTS "driveOauthAt" TIMESTAMP(3)`)

                // ─── Phiếu sửa/bảo hành: nguồn hàng + móc nối tồn kho ──────
                // Xem đầu routes/repairs.ts. Ba dấu mốc thời gian là thứ giữ cho
                // mỗi khoản tồn chỉ ghi MỘT lần và hoàn lại được khi xoá phiếu.
                await (sp as any).$executeRawUnsafe(`ALTER TABLE "Repair" ADD COLUMN IF NOT EXISTS "source" TEXT NOT NULL DEFAULT 'customer'`)
                await (sp as any).$executeRawUnsafe(`ALTER TABLE "Repair" ADD COLUMN IF NOT EXISTS "productId" TEXT`)
                await (sp as any).$executeRawUnsafe(`ALTER TABLE "Repair" ADD COLUMN IF NOT EXISTS "productSku" TEXT`)
                await (sp as any).$executeRawUnsafe(`ALTER TABLE "Repair" ADD COLUMN IF NOT EXISTS "quantity" INTEGER NOT NULL DEFAULT 1`)
                await (sp as any).$executeRawUnsafe(`ALTER TABLE "Repair" ADD COLUMN IF NOT EXISTS "branchId" TEXT`)
                await (sp as any).$executeRawUnsafe(`ALTER TABLE "Repair" ADD COLUMN IF NOT EXISTS "stockMovedAt" TIMESTAMP(3)`)
                await (sp as any).$executeRawUnsafe(`ALTER TABLE "Repair" ADD COLUMN IF NOT EXISTS "replacedStockAt" TIMESTAMP(3)`)
                await (sp as any).$executeRawUnsafe(`ALTER TABLE "Repair" ADD COLUMN IF NOT EXISTS "supplierReturnedAt" TIMESTAMP(3)`)
                await (sp as any).$executeRawUnsafe(`ALTER TABLE "Repair" ADD COLUMN IF NOT EXISTS "newUnitIssuedAt" TIMESTAMP(3)`)
                await (sp as any).$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Repair_branchId_idx" ON "Repair"("branchId")`)
                await (sp as any).$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Repair_status_idx" ON "Repair"("status")`)
                await (sp as any).$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Repair_source_idx" ON "Repair"("source")`)
                await (sp as any).$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Repair_productId_idx" ON "Repair"("productId")`)

                // ─── Cổng đồng bộ MISA AMIS ────────────────────────────────
                await (sp as any).$executeRawUnsafe(`
                    CREATE TABLE IF NOT EXISTS "MisaConfig" (
                        "id" TEXT NOT NULL DEFAULT 'default',
                        "appId" TEXT NOT NULL,
                        "accessCode" TEXT NOT NULL,
                        "orgCompanyCode" TEXT NOT NULL,
                        "baseUrl" TEXT,
                        "enabled" BOOLEAN NOT NULL DEFAULT false,
                        "syncProducts" BOOLEAN NOT NULL DEFAULT true,
                        "syncPartners" BOOLEAN NOT NULL DEFAULT true,
                        "syncStocks" BOOLEAN NOT NULL DEFAULT true,
                        "syncBalance" BOOLEAN NOT NULL DEFAULT false,
                        "overwriteNames" BOOLEAN NOT NULL DEFAULT false,
                        "overwritePrices" BOOLEAN NOT NULL DEFAULT false,
                        "overwriteStock" BOOLEAN NOT NULL DEFAULT false,
                        "overwriteDebt" BOOLEAN NOT NULL DEFAULT false,
                        "negateDebt" BOOLEAN NOT NULL DEFAULT false,
                        "defaultCategoryId" TEXT,
                        "defaultWarehouseId" TEXT,
                        "lastSyncTime" TEXT,
                        "lastSyncAt" TIMESTAMP(3),
                        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        CONSTRAINT "MisaConfig_pkey" PRIMARY KEY ("id")
                    )
                `)
                // Cột thêm sau đợt đọc lại tài liệu MISA (công nợ + mốc nước)
                await (sp as any).$executeRawUnsafe(`ALTER TABLE "MisaConfig" ADD COLUMN IF NOT EXISTS "overwriteDebt" BOOLEAN NOT NULL DEFAULT false`)
                await (sp as any).$executeRawUnsafe(`ALTER TABLE "MisaConfig" ADD COLUMN IF NOT EXISTS "negateDebt" BOOLEAN NOT NULL DEFAULT false`)
                await (sp as any).$executeRawUnsafe(`ALTER TABLE "MisaConfig" ADD COLUMN IF NOT EXISTS "lastSyncTime" TEXT`)
                await (sp as any).$executeRawUnsafe(`
                    CREATE TABLE IF NOT EXISTS "MisaMap" (
                        "id" TEXT NOT NULL,
                        "entity" TEXT NOT NULL,
                        "misaId" TEXT NOT NULL,
                        "misaCode" TEXT,
                        "localId" TEXT NOT NULL,
                        "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        CONSTRAINT "MisaMap_pkey" PRIMARY KEY ("id")
                    )
                `)
                await (sp as any).$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "MisaMap_entity_misaId_key" ON "MisaMap"("entity", "misaId")`)
                await (sp as any).$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "MisaMap_entity_localId_idx" ON "MisaMap"("entity", "localId")`)
                await (sp as any).$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "MisaMap_misaCode_idx" ON "MisaMap"("misaCode")`)
                await (sp as any).$executeRawUnsafe(`
                    CREATE TABLE IF NOT EXISTS "MisaSyncLog" (
                        "id" TEXT NOT NULL,
                        "entity" TEXT NOT NULL,
                        "mode" TEXT NOT NULL DEFAULT 'manual',
                        "dryRun" BOOLEAN NOT NULL DEFAULT false,
                        "fromDate" TIMESTAMP(3),
                        "fetched" INTEGER NOT NULL DEFAULT 0,
                        "created" INTEGER NOT NULL DEFAULT 0,
                        "updated" INTEGER NOT NULL DEFAULT 0,
                        "skipped" INTEGER NOT NULL DEFAULT 0,
                        "failed" INTEGER NOT NULL DEFAULT 0,
                        "status" TEXT NOT NULL DEFAULT 'running',
                        "errors" TEXT,
                        "details" TEXT,
                        "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        "heartbeatAt" TIMESTAMP(3),
                        "attempts" INTEGER NOT NULL DEFAULT 0,
                        "finishedAt" TIMESTAMP(3),
                        CONSTRAINT "MisaSyncLog_pkey" PRIMARY KEY ("id")
                    )
                `)
                await (sp as any).$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "MisaSyncLog_mode_idx" ON "MisaSyncLog"("mode")`)
                await (sp as any).$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "MisaSyncLog_status_idx" ON "MisaSyncLog"("status")`)
                await (sp as any).$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "MisaSyncLog_startedAt_idx" ON "MisaSyncLog"("startedAt")`)

                /* Mau in dong bo giua cac may (2026-08-14).
                 * Truoc day mau in chi nam trong localStorage cua tung trinh
                 * duyet: sua tren may tinh thi may POS van in mau cu, va xoa du
                 * lieu trinh duyet la mat sach. */
                await (sp as any).$executeRawUnsafe(`
                    CREATE TABLE IF NOT EXISTS "PrintTemplate" (
                        "id" TEXT NOT NULL,
                        "name" TEXT NOT NULL,
                        "type" TEXT NOT NULL,
                        "htmlSource" TEXT NOT NULL,
                        "linkedPrinter" TEXT NOT NULL DEFAULT '',
                        "isDefault" BOOLEAN NOT NULL DEFAULT false,
                        "isBuiltIn" BOOLEAN NOT NULL DEFAULT false,
                        "daSuaTay" BOOLEAN NOT NULL DEFAULT false,
                        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        CONSTRAINT "PrintTemplate_pkey" PRIMARY KEY ("id")
                    )
                `)
                await (sp as any).$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "PrintTemplate_type_idx" ON "PrintTemplate"("type")`)

                /* Huy hang tra khong dung lai duoc (2026-08-14).
                 * Truoc day giao dien co nut "huy hang loai" nhung backend khong
                 * co endpoint; hook bat 404 roi bao thanh cong gia. Cot nay de
                 * ghi nhan that, tach khoi restocked vi mot mon chi duoc di MOT
                 * trong hai duong. */
                await (sp as any).$executeRawUnsafe(`ALTER TABLE "ReturnItem" ADD COLUMN IF NOT EXISTS "disposed" BOOLEAN NOT NULL DEFAULT false`)

                /* Ban phan tich AI da luu (2026-08-14).
                 * Moi luot chay tro ly ton 30-60 giay cho va ton han muc Gemini
                 * cua chinh cua hang; truoc day ket qua chi nam trong bo nho
                 * trinh duyet, doi tab la mat va phai chay lai tu dau. */
                await (sp as any).$executeRawUnsafe(`
                    CREATE TABLE IF NOT EXISTS "AiReport" (
                        "id" TEXT NOT NULL,
                        "loai" TEXT NOT NULL DEFAULT 'khac',
                        "ky" TEXT NOT NULL DEFAULT '',
                        "tuNgay" TEXT,
                        "denNgay" TEXT,
                        "tieuDe" TEXT NOT NULL,
                        "noiDung" TEXT NOT NULL,
                        "toolCalls" TEXT,
                        "createdBy" TEXT,
                        "createdByName" TEXT,
                        "branchId" TEXT,
                        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        CONSTRAINT "AiReport_pkey" PRIMARY KEY ("id")
                    )
                `)
                await (sp as any).$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "AiReport_loai_idx" ON "AiReport"("loai")`)
                await (sp as any).$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "AiReport_createdAt_idx" ON "AiReport"("createdAt")`)

                /* Hoi thoai voi tro ly AI (2026-08-14).
                 * Truoc day toan bo cuoc tro chuyen chi nam trong useState —
                 * bam F5 la mat sach, ke ca nhung cau tra loi vua ton han muc
                 * Gemini va vai chuc giay cho. */
                await (sp as any).$executeRawUnsafe(`
                    CREATE TABLE IF NOT EXISTS "AiChat" (
                        "id" TEXT NOT NULL,
                        "tieuDe" TEXT NOT NULL,
                        "noiDung" TEXT NOT NULL,
                        "soLuot" INTEGER NOT NULL DEFAULT 0,
                        "createdBy" TEXT,
                        "createdByName" TEXT,
                        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        CONSTRAINT "AiChat_pkey" PRIMARY KEY ("id")
                    )
                `)
                await (sp as any).$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "AiChat_updatedAt_idx" ON "AiChat"("updatedAt")`)
                await (sp as any).$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "AiChat_createdBy_idx" ON "AiChat"("createdBy")`)

                /* Ma dong hang ben san (2026-08-14).
                 * Webhook GHI cot nay tu lau nhung schema chua bao gio co no:
                 * ca lenh tao don nem loi "Unknown argument externalItemId" —
                 * 152 don tu webhook trong 7 ngay khong luu duoc. returnSync
                 * cung DOC chinh cot nay de khop hang tra, nen doi chieu tra
                 * hang khong bao gio khop. */
                await (sp as any).$executeRawUnsafe(`ALTER TABLE "OnlineOrderItem" ADD COLUMN IF NOT EXISTS "externalItemId" TEXT`)

                /* Repair.customerId — co trong schema nhung log production bao
                 * "does not exist in the current database" o mot so cua hang. */
                await (sp as any).$executeRawUnsafe(`ALTER TABLE "Repair" ADD COLUMN IF NOT EXISTS "customerId" TEXT`)
                // Gửi NCC theo lô + chọn NCC (2026-08-19) — ghép lại từ bản đang chạy trên prod 21/08.
                // Cây này ra đời trước nên thiếu; thiếu cột thì route repairs ghi xuống sẽ nổ.
                await (sp as any).$executeRawUnsafe(`ALTER TABLE "Repair" ADD COLUMN IF NOT EXISTS "supplierId" TEXT`)
                await (sp as any).$executeRawUnsafe(`ALTER TABLE "Repair" ADD COLUMN IF NOT EXISTS "supplierName" TEXT`)
                await (sp as any).$executeRawUnsafe(`ALTER TABLE "Repair" ADD COLUMN IF NOT EXISTS "supplierBatchCode" TEXT`)
                await (sp as any).$executeRawUnsafe(`ALTER TABLE "Repair" ADD COLUMN IF NOT EXISTS "sentToSupplierAt" TIMESTAMP(3)`)
                await (sp as any).$executeRawUnsafe(`ALTER TABLE "Repair" ADD COLUMN IF NOT EXISTS "queuedForSupplierAt" TIMESTAMP(3)`)
                // 18/08/2026 — điều khoản thanh toán mặc định của NCC (xem schema Supplier)
                await (sp as any).$executeRawUnsafe(`ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "paymentTermDays" INTEGER`)
                await (sp as any).$executeRawUnsafe(`ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "paymentTerms" TEXT`)
                // 18/08/2026 chiều — kiểu điều khoản đầy đủ (net/dom/eom) cho NCC
                await (sp as any).$executeRawUnsafe(`ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "paymentTermType" TEXT`)
                await (sp as any).$executeRawUnsafe(`ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "paymentTermDom" INTEGER`)
                await (sp as any).$executeRawUnsafe(`ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "paymentTermMonthOffset" INTEGER`)

                /* 21/08/2026 — ĐỔ EXCEL MISA (mua/bán không có API, chỉ xuất Excel).
                 * Ba bảng giữ nguyên văn sổ MISA, KHÔNG đẻ ra Transaction — POS đã ghi
                 * đơn thật rồi, đổ thêm một bộ nữa là đếm trùng doanh thu. Khai tay ở đây
                 * vì `db push` không chạy được trên prod (xem sync-schemas). */
                await (sp as any).$executeRawUnsafe(`
                    CREATE TABLE IF NOT EXISTS "MisaImportBatch" (
                        "id" TEXT NOT NULL,
                        "loai" TEXT NOT NULL,
                        "tenFile" TEXT NOT NULL,
                        "kyBaoCao" TEXT,
                        "tongDong" INTEGER NOT NULL DEFAULT 0,
                        "docDuoc" INTEGER NOT NULL DEFAULT 0,
                        "boQua" INTEGER NOT NULL DEFAULT 0,
                        "soChungTu" INTEGER NOT NULL DEFAULT 0,
                        "tongTien" DOUBLE PRECISION NOT NULL DEFAULT 0,
                        "tongThue" DOUBLE PRECISION NOT NULL DEFAULT 0,
                        "chiTiet" TEXT,
                        "apply" BOOLEAN NOT NULL DEFAULT false,
                        "userId" TEXT,
                        "userName" TEXT,
                        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        CONSTRAINT "MisaImportBatch_pkey" PRIMARY KEY ("id")
                    )
                `)
                await (sp as any).$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "MisaImportBatch_loai_createdAt_idx" ON "MisaImportBatch"("loai", "createdAt")`)

                await (sp as any).$executeRawUnsafe(`
                    CREATE TABLE IF NOT EXISTS "MisaSaleDoc" (
                        "id" TEXT NOT NULL,
                        "soChungTu" TEXT NOT NULL,
                        "soHoaDon" TEXT,
                        "ngayChungTu" TIMESTAMP(3),
                        "ngayHachToan" TIMESTAMP(3),
                        "ngayHoaDon" TIMESTAMP(3),
                        "maKhach" TEXT,
                        "tenKhach" TEXT,
                        "nguonTenKhach" TEXT DEFAULT 'cot',
                        "dienGiai" TEXT,
                        "customerId" TEXT,
                        "tongDoanhSo" DOUBLE PRECISION NOT NULL DEFAULT 0,
                        "tongThue" DOUBLE PRECISION NOT NULL DEFAULT 0,
                        "tongChietKhau" DOUBLE PRECISION NOT NULL DEFAULT 0,
                        "tongTra" DOUBLE PRECISION NOT NULL DEFAULT 0,
                        "thieuGiaVon" BOOLEAN NOT NULL DEFAULT true,
                        "batchId" TEXT,
                        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        CONSTRAINT "MisaSaleDoc_pkey" PRIMARY KEY ("id")
                    )
                `)
                await (sp as any).$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "MisaSaleDoc_soChungTu_key" ON "MisaSaleDoc"("soChungTu")`)
                await (sp as any).$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "MisaSaleDoc_ngayChungTu_idx" ON "MisaSaleDoc"("ngayChungTu")`)
                await (sp as any).$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "MisaSaleDoc_soHoaDon_idx" ON "MisaSaleDoc"("soHoaDon")`)
                await (sp as any).$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "MisaSaleDoc_customerId_idx" ON "MisaSaleDoc"("customerId")`)
                await (sp as any).$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "MisaSaleDoc_batchId_idx" ON "MisaSaleDoc"("batchId")`)

                await (sp as any).$executeRawUnsafe(`
                    CREATE TABLE IF NOT EXISTS "MisaSaleLine" (
                        "id" TEXT NOT NULL,
                        "docId" TEXT NOT NULL,
                        "maHang" TEXT NOT NULL,
                        "tenHang" TEXT,
                        "dvt" TEXT,
                        "soLuong" DOUBLE PRECISION NOT NULL DEFAULT 0,
                        "donGia" DOUBLE PRECISION NOT NULL DEFAULT 0,
                        "doanhSo" DOUBLE PRECISION NOT NULL DEFAULT 0,
                        "chietKhau" DOUBLE PRECISION NOT NULL DEFAULT 0,
                        "soLuongTra" DOUBLE PRECISION NOT NULL DEFAULT 0,
                        "giaTriTra" DOUBLE PRECISION NOT NULL DEFAULT 0,
                        "giamGia" DOUBLE PRECISION NOT NULL DEFAULT 0,
                        "thueGtgt" DOUBLE PRECISION NOT NULL DEFAULT 0,
                        "tkThueGtgt" TEXT,
                        "giaVon" DOUBLE PRECISION,
                        "productId" TEXT,
                        "dongSo" INTEGER,
                        CONSTRAINT "MisaSaleLine_pkey" PRIMARY KEY ("id"),
                        CONSTRAINT "MisaSaleLine_docId_fkey" FOREIGN KEY ("docId") REFERENCES "MisaSaleDoc"("id") ON DELETE CASCADE ON UPDATE CASCADE
                    )
                `)
                await (sp as any).$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "MisaSaleLine_docId_idx" ON "MisaSaleLine"("docId")`)
                await (sp as any).$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "MisaSaleLine_maHang_idx" ON "MisaSaleLine"("maHang")`)
                await (sp as any).$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "MisaSaleLine_productId_idx" ON "MisaSaleLine"("productId")`)

                /**
                 * GỠ INDEX HÀM đã thử ngày 18/08/2026 — CHÚNG LÀM CHẬM HẲN.
                 * Ý định: giúp các join LOWER(TRIM(sku)). Thực tế planner chuyển
                 * các phép gộp toàn bảng (GROUP BY LOWER(TRIM(sku)) trong nhánh
                 * "đã xuất HĐ"/"nhập VAT") từ SeqScan+HashAggregate sang quét
                 * index ngẫu nhiên → /einvoice/tax-stock-gap 30 ngày tụt từ 5,4s
                 * xuống 79s, khoảng "tất cả" quá 240s. Đo xong gỡ ngay, giữ
                 * DROP idempotent để mọi cửa hàng đều sạch.
                 */
                await (sp as any).$executeRawUnsafe(`DROP INDEX IF EXISTS "Product_sku_lower_idx"`)
                await (sp as any).$executeRawUnsafe(`DROP INDEX IF EXISTS "TransactionItem_sku_lower_idx"`)
                await (sp as any).$executeRawUnsafe(`DROP INDEX IF EXISTS "ImportReceiptItem_sku_lower_idx"`)
                await (sp as any).$executeRawUnsafe(`DROP INDEX IF EXISTS "OnlineOrder_online_receipt_idx"`)

                storeResults.push(`${store.name}: OK`)
            } catch (e: any) {
                storeResults.push(`${store.name}: ${e.message}`)
            }
        }

        res.json({ success: true, message: 'Migration complete', storeResults })
    } catch (err: any) {
        console.error('Migration error:', err)
        res.status(500).json({ success: false, error: errMsg(err, 'Migration failed') })
    }
})

// ─── GET /admin/upgrade-requests — List ALL upgrade requests (cross-schema) ──
router.get('/upgrade-requests', async (req: Request, res: Response) => {
    try {
        const statusFilter = (req.query.status as string) || 'all'
        const allStores = await prisma.store.findMany({ select: { code: true, name: true, schema: true } }) as any[]

        const allRequests: any[] = []
        await Promise.all(allStores.map(async (store) => {
            try {
                const sp = getStorePrisma(store.schema)
                const rows: any[] = await (sp as any).$queryRawUnsafe(
                    statusFilter === 'all'
                        ? `SELECT * FROM "UpgradeRequest" ORDER BY "createdAt" DESC`
                        : `SELECT * FROM "UpgradeRequest" WHERE "status" = $1 ORDER BY "createdAt" DESC`,
                    ...(statusFilter === 'all' ? [] : [statusFilter])
                ).catch(() => [])
                rows.forEach(r => allRequests.push({ ...r, _storeSchema: store.schema }))
            } catch { /* table might not exist */ }
        }))

        // Sort all combined requests by createdAt desc
        allRequests.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

        res.json({ success: true, data: allRequests })
    } catch (err) {
        console.error('Admin list upgrade requests error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ─── PUT /admin/upgrade-requests/:storeCode/:id/approve ─────────────────────
router.put('/upgrade-requests/:storeCode/:id/approve', async (req: Request, res: Response) => {
    try {
        const { storeCode, id } = req.params
        const store = await prisma.store.findUnique({ where: { code: String(storeCode) } })
        if (!store) return res.status(404).json({ success: false, error: 'Store not found' })

        const sp = getStorePrisma(store.schema)

        // Update request status
        await (sp as any).$executeRawUnsafe(
            `UPDATE "UpgradeRequest" SET "status" = 'approved', "updatedAt" = NOW() WHERE "id" = $1`, id
        )

        // Get the request details
        const rows: any[] = await (sp as any).$queryRawUnsafe(`SELECT * FROM "UpgradeRequest" WHERE "id" = $1`, id)
        const request = rows[0]

        if (request) {
            // Update registry with new plan
            await (prisma as any).store.update({
                where: { code: String(storeCode) },
                data: {
                    plan: request.requestedPlan,
                    addOns: request.addOns || '[]',
                    extraBranches: request.extraBranches || 0,
                },
            })

            // Auto-create extra branches if requested
            const addOns = typeof request.addOns === 'string' ? (() => { try { return JSON.parse(request.addOns) } catch { return [] } })() : (request.addOns || [])
            if (Array.isArray(addOns) && addOns.includes('extra_branch') && request.extraBranches > 0) {
                const existingBranches = await sp.branch.count()
                for (let i = 0; i < request.extraBranches; i++) {
                    const branchNum = existingBranches + i + 1
                    try {
                        await sp.branch.create({
                            data: {
                                name: `Chi nhánh ${branchNum}`,
                                code: `${storeCode}-CN${branchNum}`,
                                status: 'active',
                            },
                        })
                        console.log(`[Admin] Auto-created branch: ${storeCode}-CN${branchNum}`)
                    } catch (branchErr) {
                        console.error(`[Admin] Failed to create branch ${branchNum}:`, branchErr)
                    }
                }
            }

            console.log(`[Admin] Approved upgrade: ${storeCode} → ${request.requestedPlan}`)

            // Create notification for store
            try {
                const planNames: Record<string, string> = { retail: 'Bán Lẻ', wholesale: 'Bán Sỉ', full: 'Đầy Đủ' }
                await sp.notification.create({
                    data: {
                        title: '✅ Yêu cầu nâng cấp đã được duyệt',
                        message: `Gói dịch vụ của bạn đã được nâng cấp lên ${planNames[request.requestedPlan] || request.requestedPlan}${request.extraBranches > 0 ? `. ${request.extraBranches} chi nhánh mới đã được tạo.` : ''}`,
                        type: 'success',
                    },
                })
            } catch { /* notification table might not exist */ }
        }

        res.json({ success: true, message: 'Đã duyệt yêu cầu nâng cấp' })
    } catch (err) {
        console.error('Admin approve upgrade error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ─── PUT /admin/upgrade-requests/:storeCode/:id/reject ──────────────────────
router.put('/upgrade-requests/:storeCode/:id/reject', async (req: Request, res: Response) => {
    try {
        const { storeCode, id } = req.params
        const { reason } = req.body
        const store = await prisma.store.findUnique({ where: { code: String(storeCode) } })
        if (!store) return res.status(404).json({ success: false, error: 'Store not found' })

        const sp = getStorePrisma(store.schema)
        await (sp as any).$executeRawUnsafe(
            `UPDATE "UpgradeRequest" SET "status" = 'rejected', "rejectedReason" = $1, "updatedAt" = NOW() WHERE "id" = $2`,
            reason || '', id
        )

        console.log(`[Admin] Rejected upgrade: ${storeCode} (reason: ${reason || 'none'})`)

        // Create notification for store
        try {
            await sp.notification.create({
                data: {
                    title: '❌ Yêu cầu nâng cấp bị từ chối',
                    message: `Yêu cầu nâng cấp gói dịch vụ đã bị từ chối.${reason ? ` Lý do: ${reason}` : ''}`,
                    type: 'warning',
                },
            })
        } catch { /* notification table might not exist */ }

        res.json({ success: true, message: 'Đã từ chối yêu cầu nâng cấp' })
    } catch (err) {
        console.error('Admin reject upgrade error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})
/* ĐÃ GỠ: bản khai TRÙNG thứ hai của `POST /admin/sync-schemas`.
 *
 * Nó nằm sau bản ở dòng ~613 nên Express KHÔNG BAO GIỜ gọi tới — mã chết hoàn
 * toàn im lặng suốt thời gian qua. Việc nó định làm là thêm hai cột
 * `SalesTripItem.actualQty` và `.damagedQty` bằng ALTER thô; đã kiểm prod
 * 15/08/2026, hai cột đó CÓ THẬT (không dòng log P2022 nào trong 7 ngày) nên
 * gỡ đi không mất gì — chúng đã vào bằng đường khác.
 *
 * Phát hiện nhờ phép dò route trùng mới thêm vào scripts/check-api-contract.ts,
 * sau khi chính tôi đặt trùng tên `/admin/store-health` và mất một lúc mới hiểu
 * vì sao gọi ra lại nhận dữ liệu kênh sàn của KENGISTORE.
 */

// ─── POST /admin/seed-coa ─────────────────────────────────────────────────────
// (Re)seed the full Vietnamese chart of accounts (TT99/2025, có dấu) into EVERY
// store. force mặc định = true: cập nhật lại tên TK hệ thống (sửa tên không dấu
// cũ), tạo TK còn thiếu; TK người dùng tự thêm (isSystem=false) không bị đụng.
router.post('/seed-coa', async (req: Request, res: Response) => {
    try {
        const { COA_SEED } = await import('../lib/chartOfAccounts')
        const force = req.body?.force !== false
        const stores = await registryPrisma.store.findMany({ select: { name: true, schema: true, code: true } }) as any[]
        const results: { store: string; created: number; updated: number; skipped: number; error?: string }[] = []

        for (const store of stores) {
            let created = 0, updated = 0, skipped = 0
            try {
                const sp: any = getStorePrisma(store.schema)
                for (const acc of COA_SEED) {
                    const data = {
                        code: acc.code, name: acc.name, nameEn: acc.nameEn ?? null,
                        level: acc.level, parentCode: acc.parentCode ?? null,
                        type: acc.type, nature: acc.nature, description: acc.description ?? null,
                        isSystem: true, isActive: true,
                    }
                    const existing = await sp.chartOfAccount.findUnique({ where: { code: acc.code } })
                    if (existing) {
                        if (!force) { skipped++; continue }
                        const { code: _c, ...updateData } = data
                        await sp.chartOfAccount.update({ where: { code: acc.code }, data: updateData })
                        updated++
                    } else {
                        await sp.chartOfAccount.create({ data }).then(() => created++).catch((e: any) => {
                            if (e?.code === 'P2002') skipped++; else throw e
                        })
                    }
                }
                results.push({ store: store.code, created, updated, skipped })
                console.log(`✅ COA seeded: ${store.code} (+${created} new, ${updated} updated)`)
            } catch (err: any) {
                results.push({ store: store.code, created, updated, skipped, error: err?.message?.slice(0, 200) })
                console.error(`❌ COA seed failed: ${store.code}`, err?.message?.slice(0, 300))
            }
        }

        res.json({ success: true, total: COA_SEED.length, stores: results })
    } catch (err) {
        console.error('Seed COA error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ─── POST /admin/fix-online-journal ──────────────────────────────────────────
// Dọn dữ liệu bút toán đơn TMĐT cũ trong MỌI store:
//   1. Doanh thu/giá vốn cũ (ONLINE-/OCOGS-): xóa nếu đã có bộ chuẩn
//      (SALE-/COGS-ONLINE-), ngược lại đổi sang ref chuẩn + Nợ 131-<SÀN>.
//   2. XÓA HẾT bút toán phí per-đơn (PFEE-/FEE-ONLINE-) — phí sàn nay ghi nhận
//      theo hoá đơn GTGT cuối kỳ (PFEEINV-*), không book ước tính per-đơn nữa.
//   3. SALE-/VAT-ONLINE- đã ghi nhầm Nợ 111/112/131 → sửa về 131-<SÀN>.
//   4. Sửa mojibake (BÃƒÂ¡n → Bán) trong description/tên TK của TOÀN BỘ bút toán.
router.post('/fix-online-journal', async (_req: Request, res: Response) => {
    try {
        const { PLATFORM_AR, detectOnlinePlatform } = await import('../lib/autoJournal')
        const { fixMojibake } = await import('../lib/fixMojibake')
        const stores = await registryPrisma.store.findMany({ select: { name: true, schema: true, code: true } }) as any[]
        const results: any[] = []

        const arFor = (orderNumber: string) => {
            const pf = detectOnlinePlatform(orderNumber) || detectOnlinePlatform(`ONLINE-${orderNumber}`)
            return PLATFORM_AR[pf || 'online'] ?? PLATFORM_AR.online!
        }

        for (const store of stores) {
            let deleted = 0, rebooked = 0, repointed = 0, demojibaked = 0
            try {
                const sp: any = getStorePrisma(store.schema)
                const entries: any[] = await sp.journalEntry.findMany({
                    select: {
                        id: true, reference: true, referenceType: true, description: true,
                        debitAccount: true, debitAccountName: true, creditAccount: true, creditAccountName: true,
                    },
                })
                const refSet = new Set(entries.map(e => e.reference).filter(Boolean))

                for (const e of entries) {
                    const ref: string = e.reference || ''

                    // 1+2: bộ ref cũ ONLINE-/PFEE-/OCOGS-
                    let m: RegExpMatchArray | null
                    if ((m = ref.match(/^ONLINE-(.+)$/)) && e.referenceType === 'online') {
                        const orderNumber = m[1]!
                        if (refSet.has(`SALE-ONLINE-${orderNumber}`)) {
                            await sp.journalEntry.delete({ where: { id: e.id } }).catch(() => { })
                            deleted++
                        } else {
                            const ar = arFor(orderNumber)
                            await sp.journalEntry.update({
                                where: { id: e.id },
                                data: {
                                    reference: `SALE-ONLINE-${orderNumber}`,
                                    debitAccount: ar.account, debitAccountName: ar.name,
                                    description: `Bán hàng qua ${ar.label} ${orderNumber}`,
                                },
                            }).catch(() => { })
                            refSet.add(`SALE-ONLINE-${orderNumber}`)
                            rebooked++
                        }
                        continue
                    }
                    // Phí sàn per-đơn (ước tính) bị bỏ — phí giờ ghi theo hoá đơn
                    // GTGT cuối kỳ (PFEEINV-*). Xoá hết bút toán phí per-đơn cũ.
                    // Lưu ý: /^PFEE-/ KHÔNG khớp PFEEINV-* (sau "PFEE" là "I", không phải "-").
                    if (ref.match(/^PFEE-/) || ref.match(/^FEE-ONLINE-/)) {
                        await sp.journalEntry.delete({ where: { id: e.id } }).catch(() => { })
                        deleted++
                        continue
                    }
                    if ((m = ref.match(/^OCOGS-(.+)$/))) {
                        const orderNumber = m[1]!
                        if (refSet.has(`COGS-ONLINE-${orderNumber}`)) {
                            await sp.journalEntry.delete({ where: { id: e.id } }).catch(() => { })
                            deleted++
                        } else {
                            await sp.journalEntry.update({
                                where: { id: e.id },
                                data: { reference: `COGS-ONLINE-${orderNumber}`, description: `Giá vốn online ${orderNumber}` },
                            }).catch(() => { })
                            refSet.add(`COGS-ONLINE-${orderNumber}`)
                            rebooked++
                        }
                        continue
                    }

                    // 3: SALE-/VAT-ONLINE- ghi nhầm tiền mặt/ngân hàng/131 chung
                    if ((m = ref.match(/^(SALE|VAT)-ONLINE-(.+)$/)) && ['111', '112', '131'].includes(e.debitAccount)) {
                        const ar = arFor(m[2]!)
                        await sp.journalEntry.update({
                            where: { id: e.id },
                            data: { debitAccount: ar.account, debitAccountName: ar.name },
                        }).catch(() => { })
                        repointed++
                        continue
                    }
                    // 4: mojibake trong description / tên TK
                    const fixedDesc = fixMojibake(e.description)
                    const fixedDn = fixMojibake(e.debitAccountName)
                    const fixedCn = fixMojibake(e.creditAccountName)
                    if (fixedDesc !== (e.description || '') || fixedDn !== (e.debitAccountName || '') || fixedCn !== (e.creditAccountName || '')) {
                        await sp.journalEntry.update({
                            where: { id: e.id },
                            data: {
                                ...(fixedDesc !== (e.description || '') ? { description: fixedDesc } : {}),
                                ...(fixedDn !== (e.debitAccountName || '') ? { debitAccountName: fixedDn } : {}),
                                ...(fixedCn !== (e.creditAccountName || '') ? { creditAccountName: fixedCn } : {}),
                            },
                        }).catch(() => { })
                        demojibaked++
                    }
                }

                results.push({ store: store.code, total: entries.length, deleted, rebooked, repointed, demojibaked })
                console.log(`✅ fix-online-journal ${store.code}: -${deleted} dup, ${rebooked} rebooked, ${repointed} repointed, ${demojibaked} demojibaked`)
            } catch (err: any) {
                results.push({ store: store.code, error: err?.message?.slice(0, 200) })
                console.error(`❌ fix-online-journal failed: ${store.code}`, err?.message?.slice(0, 300))
            }
        }

        res.json({ success: true, stores: results })
    } catch (err) {
        console.error('fix-online-journal error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ─── POST /admin/fix-debt-journal ────────────────────────────────────────────
// Dọn dữ liệu kế toán công nợ LỊCH SỬ (mọi store):
//   A. TK 331: bút toán trả tiền NCC cũ ghi nhầm Nợ 6428 (CP khác) → sửa về Nợ 331.
//   B. TK 131: đơn bán chịu cũ chỉ có vế Nợ 131 (chưa trừ tiền đã thu) → thêm bút
//      toán COLLECT-<HĐ>-BF: Nợ 111/112 / Có 131 cho phần đã thu còn THIẾU, để 131
//      khớp Customer.debt. Idempotent (chỉ bù phần chưa có COLLECT-).
router.post('/fix-debt-journal', async (_req: Request, res: Response) => {
    try {
        const stores = await registryPrisma.store.findMany({ select: { schema: true, code: true } }) as any[]
        const results: any[] = []

        for (const store of stores) {
            let repointed331 = 0, backfilled131 = 0
            try {
                const sp: any = getStorePrisma(store.schema)

                // A. Trả tiền NCC ghi nhầm 6428 → 331
                const supPays: any[] = await sp.journalEntry.findMany({
                    where: { debitAccount: '6428', reference: { startsWith: 'EXP-' }, description: { startsWith: 'Trả tiền NCC' } },
                    select: { id: true },
                }).catch(() => [])
                for (const e of supPays) {
                    await sp.journalEntry.update({
                        where: { id: e.id },
                        data: { debitAccount: '331', debitAccountName: 'Phải trả người bán' },
                    }).catch(() => { })
                    repointed331++
                }

                // B. Bù bút toán thu tiền cho đơn bán chịu (Nợ 131) còn thiếu
                const creditSales: any[] = await sp.journalEntry.findMany({
                    where: { reference: { startsWith: 'SALE-' }, referenceType: 'sale', debitAccount: '131' },
                    select: { reference: true, branchId: true, date: true },
                }).catch(() => [])
                for (const sale of creditSales) {
                    const receipt = String(sale.reference).replace(/^SALE-/, '')
                    if (!receipt || receipt.startsWith('ONLINE-')) continue
                    const tx = await sp.transaction.findFirst({
                        where: { receiptNumber: receipt },
                        select: { amountReceived: true, total: true, status: true, customerName: true, payments: { select: { type: true } } },
                    }).catch(() => null)
                    if (!tx || tx.status === 'voided') continue
                    const collected = Math.min(Math.round(tx.amountReceived || 0), Math.round(tx.total || 0))
                    if (collected <= 0) continue
                    const existing: any[] = await sp.journalEntry.findMany({
                        where: { reference: { startsWith: `COLLECT-${receipt}` }, creditAccount: { startsWith: '131' } },
                        select: { amount: true },
                    }).catch(() => [])
                    const already = Math.round(existing.reduce((s: number, x: any) => s + (x.amount || 0), 0))
                    const missing = collected - already
                    if (missing <= 0) continue
                    const payType = tx.payments?.[0]?.type
                    const isBank = payType === 'bank' || payType === 'transfer'
                    await sp.journalEntry.create({
                        data: {
                            date: sale.date,
                            description: `Thu tiền bán hàng ${receipt}${tx.customerName ? ' - KH: ' + tx.customerName : ''}`,
                            debitAccount: isBank ? '112' : '111', debitAccountName: isBank ? 'Tiền gửi ngân hàng' : 'Tiền mặt',
                            creditAccount: '131', creditAccountName: 'Phải thu khách hàng',
                            amount: missing, reference: `COLLECT-${receipt}-BF`, referenceType: 'sale',
                            branchId: sale.branchId || null,
                        },
                    }).catch(() => { })
                    backfilled131++
                }

                results.push({ store: store.code, repointed331, backfilled131 })
                console.log(`✅ fix-debt-journal ${store.code}: 331→${repointed331}, 131 backfill ${backfilled131}`)
            } catch (err: any) {
                results.push({ store: store.code, error: err?.message?.slice(0, 200) })
                console.error(`❌ fix-debt-journal ${store.code}:`, err?.message?.slice(0, 300))
            }
        }
        res.json({ success: true, stores: results })
    } catch (err) {
        console.error('fix-debt-journal error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ─── GET /admin/cloud-metrics ─────────────────────────────────────────────────
// Fetches real Cloud Run metrics from Google Cloud Monitoring API + DB stats
router.get('/cloud-metrics', async (_req: Request, res: Response) => {
    try {
        const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT_ID || 'kengi-tech'
        const SERVICE_NAME = process.env.CLOUD_RUN_SERVICE_NAME || 'kengi-tech-api'
        const REGION = process.env.CLOUD_RUN_REGION || 'asia-southeast1'

        const now = new Date()
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate())
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
        const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)
        const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59)

        // ── Real DB stats (actual data) ──────────────────────────────────────
        const stores = await prisma.store.findMany({ select: { schema: true } })
        let totalTransactionsToday = 0
        let totalTransactionsMonth = 0
        let totalTransactionsLastMonth = 0
        let totalRevenue = 0
        let totalRevenueLastMonth = 0

        await mapWithConcurrency(stores, async (s) => {
            try {
                const sp = getStorePrisma(s.schema)
                const [todayTx, monthTx, lastMonthTx, monthRev, lastMonthRev] = await Promise.all([
                    (sp as any).transaction.count({ where: { createdAt: { gte: startOfDay } } }).catch(() => 0),
                    (sp as any).transaction.count({ where: { createdAt: { gte: startOfMonth } } }).catch(() => 0),
                    (sp as any).transaction.count({ where: { createdAt: { gte: lastMonthStart, lte: lastMonthEnd } } }).catch(() => 0),
                    (sp as any).transaction.aggregate({ where: { createdAt: { gte: startOfMonth } }, _sum: { total: true } }).catch(() => ({ _sum: { total: 0 } })),
                    (sp as any).transaction.aggregate({ where: { createdAt: { gte: lastMonthStart, lte: lastMonthEnd } }, _sum: { total: true } }).catch(() => ({ _sum: { total: 0 } })),
                ])
                totalTransactionsToday += todayTx
                totalTransactionsMonth += monthTx
                totalTransactionsLastMonth += lastMonthTx
                totalRevenue += (monthRev?._sum?.total || 0)
                totalRevenueLastMonth += (lastMonthRev?._sum?.total || 0)
            } catch { /* skip */ }
        })

        // ── Cloud Run metrics via GCP Monitoring REST API ─────────────────────
        let gcpData: any = null
        let gcpSource: 'live' | 'estimated' = 'estimated'
        try {
            // Use Application Default Credentials (available on Cloud Run automatically)
            const { GoogleAuth } = await import('google-auth-library').catch(() => ({ GoogleAuth: null }))
            if (GoogleAuth) {
                const auth = new (GoogleAuth as any)({ scopes: ['https://www.googleapis.com/auth/monitoring.read'] })
                const client = await auth.getClient()
                const token = await client.getAccessToken()
                const accessToken = token?.token || token

                const monitoringBase = `https://monitoring.googleapis.com/v3/projects/${PROJECT_ID}`
                const filter = encodeURIComponent(`resource.type="cloud_run_revision" AND resource.labels.service_name="${SERVICE_NAME}" AND resource.labels.location="${REGION}"`)

                // Fetch request_count (last 24h in hourly intervals)
                const reqCountUrl = `${monitoringBase}/timeSeries?filter=${filter} AND metric.type="run.googleapis.com/request_count"&interval.startTime=${startOfDay.toISOString()}&interval.endTime=${now.toISOString()}&aggregation.alignmentPeriod=3600s&aggregation.perSeriesAligner=ALIGN_SUM`

                // Fetch request_latencies (last 24h)
                const latencyUrl = `${monitoringBase}/timeSeries?filter=${filter} AND metric.type="run.googleapis.com/request_latencies"&interval.startTime=${startOfDay.toISOString()}&interval.endTime=${now.toISOString()}&aggregation.alignmentPeriod=86400s&aggregation.perSeriesAligner=ALIGN_PERCENTILE_50`

                const [reqCountRes, latencyRes] = await Promise.all([
                    fetch(reqCountUrl, { headers: { Authorization: `Bearer ${accessToken}` } }).then(r => r.json() as Promise<any>).catch(() => null),
                    fetch(latencyUrl, { headers: { Authorization: `Bearer ${accessToken}` } }).then(r => r.json() as Promise<any>).catch(() => null),
                ])

                // Parse request counts per hour
                const hourlyRequests: { hour: string; count: number }[] = []
                if (reqCountRes?.timeSeries?.length > 0) {
                    const series = reqCountRes.timeSeries[0]
                    let totalGcpRequests = 0
                    for (const pt of (series?.points || [])) {
                        const t = new Date(pt.interval?.startTime || pt.interval?.endTime)
                        hourlyRequests.push({ hour: `${String(t.getHours()).padStart(2, '0')}:00`, count: parseInt(pt.value?.int64Value || pt.value?.doubleValue || '0') })
                        totalGcpRequests += parseInt(pt.value?.int64Value || pt.value?.doubleValue || '0')
                    }
                    gcpSource = 'live'
                    const avgLatencyMs = latencyRes?.timeSeries?.[0]?.points?.[0]?.value?.distributionValue?.mean || null

                    gcpData = {
                        requestsToday: totalGcpRequests,
                        requestsThisMonth: Math.round(totalGcpRequests * (now.getDate())),
                        hourlyRequests,
                        avgLatencyMs,
                    }
                }
            }
        } catch (gcpErr) {
            console.warn('[cloud-metrics] GCP Monitoring unavailable:', (gcpErr as any)?.message)
        }

        // ── Estimated cost (GCP pricing approximation) ────────────────────────
        const requestsThisMonth = gcpData?.requestsThisMonth || (totalTransactionsMonth * 15) // ~15 API calls per transaction
        const vcpuSeconds = requestsThisMonth * 0.3  // ~300ms avg per request
        const memGbSeconds = requestsThisMonth * 0.3 * 0.5  // 512MB instance
        const cloudRunCost = Math.max(0, (vcpuSeconds - 180000) * 0.00002400 + (memGbSeconds - 360000) * 0.00000250)
        const networkCost = (requestsThisMonth / 1_000_000) * 0.12
        const sqlCost = 24.10  // fixed: db-n1-standard-2
        const storageCost = 3.87
        const cdnCost = 6.22
        const loggingCost = (requestsThisMonth / 1_000_000) * 0.5
        const secretCost = 0.18
        const totalUSD = cloudRunCost + networkCost + sqlCost + storageCost + cdnCost + loggingCost + secretCost

        const services = [
            { name: 'Cloud Run', icon: '🚀', cost: parseFloat((cloudRunCost + networkCost).toFixed(2)), usage: `${(requestsThisMonth / 1000).toFixed(1)}K requests`, trend: gcpData ? Math.round((gcpData.requestsThisMonth - totalTransactionsLastMonth * 15) / Math.max(1, totalTransactionsLastMonth * 15) * 100) : 0 },
            { name: 'Cloud SQL', icon: '🗄️', cost: sqlCost, usage: 'db-n1-standard-2 · 30GB', trend: 0 },
            { name: 'Cloud Storage', icon: '💾', cost: storageCost, usage: `${stores.length * 12} GB`, trend: -3 },
            { name: 'Cloud CDN', icon: '🌐', cost: cdnCost, usage: `${Math.round(requestsThisMonth * 0.05 / 1000)} GB egress`, trend: 8 },
            { name: 'Cloud Logging', icon: '📋', cost: parseFloat(loggingCost.toFixed(2)), usage: `${(requestsThisMonth / 1_000_000).toFixed(1)} GB logs`, trend: 0 },
            { name: 'Secret Manager', icon: '🔑', cost: secretCost, usage: '4 secrets · 1K ops', trend: 0 },
        ]

        // ── Storage breakdown per store ──────────────────────────────────────
        const FREE_STORAGE_BYTES = 500 * 1024 * 1024 // 500 MB free per store
        const STORAGE_PRICE_PER_GB_VND = 5000 // 5,000₫/GB/month

        const allStoresForStorage = await prisma.store.findMany({ select: { id: true, code: true, name: true, schema: true, status: true } })
        const storageBreakdown: any[] = []
        let totalStorageBytes = 0
        let totalStorageFeeVND = 0

        await Promise.all(allStoresForStorage.map(async (store) => {
            try {
                const sp = getStorePrisma(store.schema)
                const agg = await (sp as any).storageFile.aggregate({ _sum: { size: true }, _count: true }).catch(() => ({ _sum: { size: 0 }, _count: 0 }))
                const usedBytes = agg?._sum?.size || 0
                const fileCount = agg?._count || 0
                const billableBytes = Math.max(0, usedBytes - FREE_STORAGE_BYTES)
                const billableGB = billableBytes / (1024 * 1024 * 1024)
                const feeVND = Math.ceil(billableGB * STORAGE_PRICE_PER_GB_VND)
                totalStorageBytes += usedBytes
                totalStorageFeeVND += feeVND
                storageBreakdown.push({
                    storeId: store.id,
                    storeCode: store.code,
                    storeName: store.name,
                    status: store.status,
                    fileCount,
                    usedBytes,
                    freeBytes: FREE_STORAGE_BYTES,
                    billableBytes,
                    feeVND,
                })
            } catch { /* schema not ready */ }
        }))

        // Sort by usedBytes desc
        storageBreakdown.sort((a, b) => b.usedBytes - a.usedBytes)

        const topPages = [
            { path: '/api/transactions', requests: Math.round(totalTransactionsMonth * 3), avgLatency: '145ms' },
            { path: '/api/products', requests: Math.round(totalTransactionsMonth * 2), avgLatency: '89ms' },
            { path: '/api/auth', requests: Math.round(totalTransactionsMonth * 1.2), avgLatency: '210ms' },
            { path: '/api/customers', requests: Math.round(totalTransactionsMonth * 0.8), avgLatency: '98ms' },
            { path: '/api/dashboard', requests: Math.round(totalTransactionsMonth * 0.5), avgLatency: '180ms' },
        ]

        res.json({
            success: true,
            data: {
                source: gcpSource,
                collectedAt: now.toISOString(),
                visits: {
                    todayTransactions: totalTransactionsToday,
                    thisMonthTransactions: totalTransactionsMonth,
                    lastMonthTransactions: totalTransactionsLastMonth,
                    todayRequests: gcpData?.requestsToday || totalTransactionsToday * 15,
                    thisMonthRequests: requestsThisMonth,
                    hourly: gcpData?.hourlyRequests || [],
                    avgLatencyMs: gcpData?.avgLatencyMs || null,
                },
                revenue: {
                    thisMonth: totalRevenue,
                    lastMonth: totalRevenueLastMonth,
                },
                costs: {
                    totalUSD: parseFloat(totalUSD.toFixed(2)),
                    projectedUSD: parseFloat((totalUSD * (30 / now.getDate())).toFixed(2)),
                    lastMonthEstimateUSD: parseFloat((totalUSD * 0.91).toFixed(2)),
                    breakdown: services,
                },
                storage: {
                    totalBytes: totalStorageBytes,
                    totalFeeVND: totalStorageFeeVND,
                    freePerStore: FREE_STORAGE_BYTES,
                    pricePerGBVND: STORAGE_PRICE_PER_GB_VND,
                    breakdown: storageBreakdown,
                },
                topEndpoints: topPages,
            }
        })
    } catch (err) {
        console.error('Admin cloud-metrics error:', err)
        res.status(500).json({ success: false, error: 'Internal server error', detail: (err as any)?.message })
    }
})

// ─── POST /admin/sync-returns ────────────────────────────────────────────────
// CHẨN ĐOÁN + chạy tay đồng bộ TRẢ HÀNG/HOÀN TIỀN cho từng kênh sàn.
// Phải chạy TỪ Cloud Run vì Shopee chặn theo IP đã khai báo (gọi từ máy local
// sẽ dính source_ip_undeclared) → đây là cách duy nhất kiểm chứng thật.
// Body/query: { storeCode?, days? } — mặc định mọi store, 7 ngày.
router.post('/sync-returns', async (req: Request, res: Response) => {
    try {
        const { syncChannelReturns } = await import('../services/returnSync')
        const storeCode = String(req.query.storeCode || req.body?.storeCode || '').trim()
        const days = Math.min(Math.max(1, Number(req.query.days || req.body?.days) || 7), 90)
        const since = new Date(Date.now() - days * 86400_000)

        const stores = await prisma.store.findMany({
            where: { status: 'active', ...(storeCode ? { code: storeCode } : {}) },
            select: { code: true, name: true, schema: true },
        })
        const out: any[] = []
        for (const store of stores) {
            const sp = getStorePrisma(store.schema)
            let channels: any[] = []
            try {
                channels = await sp.onlineChannel.findMany({
                    where: { status: 'active', accessToken: { not: null }, platform: { in: ['shopee', 'tiktok'] } },
                })
            } catch { continue } // store chưa có bảng kênh
            for (const ch of channels) {
                const row: any = { store: store.code, channel: ch.name, platform: ch.platform }
                const t0 = Date.now()
                try {
                    const r = await syncChannelReturns(sp, ch, since)
                    Object.assign(row, { ok: true, total: r.total, synced: r.synced, skipped: r.skipped, errors: r.errors.slice(0, 3) })
                } catch (e: any) {
                    Object.assign(row, { ok: false, error: e?.message || String(e) })
                }
                row.ms = Date.now() - t0
                out.push(row)
            }
        }
        res.json({ success: true, data: { since: since.toISOString(), days, channels: out } })
    } catch (err: any) {
        console.error('Admin sync-returns error:', err)
        res.status(500).json({ success: false, error: err?.message || 'Internal server error' })
    }
})

// ─── GET /admin/returns-summary ──────────────────────────────────────────────
// CHỈ ĐỌC: thống kê phiếu trả hàng theo nguồn (RTN-SH- Shopee / RTN-TT- TikTok /
// khác = tạo tay) và theo trạng thái, để đối chiếu xem sàn đã đổ về những gì.
router.get('/returns-summary', async (req: Request, res: Response) => {
    try {
        const storeCode = String(req.query.storeCode || '').trim()
        const stores = await prisma.store.findMany({
            where: { status: 'active', ...(storeCode ? { code: storeCode } : {}) },
            select: { code: true, schema: true },
        })
        const out: any[] = []
        for (const store of stores) {
            const sp = getStorePrisma(store.schema)
            try {
                const rows = await sp.$queryRawUnsafe(`
                    SELECT CASE WHEN code LIKE 'RTN-SH-%' THEN 'shopee'
                                WHEN code LIKE 'RTN-TT-%' THEN 'tiktok'
                                ELSE 'khac' END AS nguon,
                           status, COUNT(*)::int AS n,
                           COALESCE(SUM("totalRefund"),0)::float8 AS tien,
                           to_char(MIN("createdAt") + interval '7 hours','YYYY-MM-DD') AS dau,
                           to_char(MAX("createdAt") + interval '7 hours','YYYY-MM-DD') AS cuoi
                    FROM "ReturnOrder" GROUP BY 1,2 ORDER BY 1,3 DESC`)
                out.push({ store: store.code, rows })
            } catch (e: any) {
                out.push({ store: store.code, error: e?.message })
            }
        }
        res.json({ success: true, data: out })
    } catch (err: any) {
        console.error('Admin returns-summary error:', err)
        res.status(500).json({ success: false, error: err?.message || 'Internal server error' })
    }
})

// ─── GET /admin/store-health?storeCode=KENGISTORE ────────────────────────────
// CHỈ ĐỌC: soi mắt xích sàn → đơn → phiếu bán → hoá đơn của 1 cửa hàng.
//  (a) kênh sàn + lần đồng bộ cuối + hạn token
//  (b) phiếu trả ĐÃ HOÀN TIỀN nhưng đơn chưa đảo về returned (sót đảo hiệu ứng)
//  (c) đơn ĐÃ XUẤT HOÁ ĐƠN nhưng sau đó có phiếu trả đang mở (phải điều chỉnh HĐ)
//  (d) đơn có phiếu trả đang mở mà vẫn nằm chờ xuất HĐ (đã chặn auto-xuất)
/* ─────────────────────────────────────────────────────────────────────────────
 *  ĐO PHƠI NHIỄM GIÁ VỐN — GET /api/admin/do-gia-von?ngay=90   (04/09/2026)
 *
 *  CHỈ ĐỌC, không ghi gì. Dựng để trả lời một câu trước khi đụng vào schema:
 *  *"bút toán giá vốn hàng bán đang sai/thiếu bao nhiêu, ở đâu?"*
 *
 *  Vì sao phải đo trước: bút toán giá vốn hiện đọc `product.costPrice` — tức là
 *  giá vốn **hiện tại**, không phải giá vốn **lúc bán**. Hai hệ quả:
 *    1. Hàng chưa khai giá vốn (costPrice = 0) ⇒ `cogsAmount = 0` ⇒ khối ghi sổ bị
 *       bỏ qua HOÀN TOÀN, im lặng. Sổ có doanh thu mà không có giá vốn ⇒ lãi ảo.
 *    2. Đổi giá vốn hôm nay là đổi luôn con số của đơn bán tháng trước nếu ghi lại.
 *
 *  Sửa triệt để cần thêm cột giá vốn vào TransactionItem + migrate + vá 5 đường ghi.
 *  Đó là việc lớn — nên đo xem nó đáng bao nhiêu tiền đã, rồi mới quyết.
 *
 *  Chạy TUẦN TỰ từng cửa hàng: pool prod mỗi cửa hàng đúng 1 kết nối.
 *  Mọi trần đọc đều KHAI RA trong kết quả — cắt ngầm rồi báo như thể không cắt là
 *  đúng lỗi đã cắn nhiều lần (xem memory tran-cat-am-tham).
 * ───────────────────────────────────────────────────────────────────────────── */
/* ─────────────────────────────────────────────────────────────────────────────
 *  % LỢI NHUẬN ĐƠN SÀN + PHÍ SÀN CÓ ĐÚNG KHÔNG — GET /admin/do-loi-nhuan-san (06/09/2026)
 *  CHỈ ĐỌC. ?ngay=30 (mặc định) · ?tran=2000 đơn mỗi cửa hàng.
 *
 *  Vì sao cần: phí sàn trên đơn có BA nghĩa khác nhau nằm chung một cột:
 *    (a) phí THẬT — đã đối soát escrow/settlement với sàn
 *    (b) phí ƯỚC TÍNH — đơn tạo qua webhook ghi tổng tiền × hoa hồng cấu hình (6%)
 *        rồi để đó như phí thật (webhooks.ts:295-297)
 *    (c) 0 — "chưa đối soát" (đường sync tay/cron cố ý để 0)
 *  Cộng gộp ba thứ này rồi chia ra "% lợi nhuận" là ra một con số không có nghĩa.
 *  Bộ đo này TÁCH ba nhóm, và chỉ tính % trên nhóm (a) có đủ giá vốn.
 *
 *  Nhận diện (b): platformFee ≈ round(total × platformFeeRate/100) trong ±1đ. Đây
 *  là suy đoán theo HÌNH DẠNG số — phí thật từ escrow gần như không bao giờ khớp
 *  đúng công thức đó. Báo là "hình dạng ước tính", không báo là "chắc chắn".
 *
 *  Kiểm phí: với đơn (a), |total − platformFee − netRevenue| phải ≈ 0 nếu phí được
 *  định nghĩa là "giá bán − thực nhận". Lệch nhiều = giá bán sàn dùng để tính phí
 *  KHÔNG phải tổng tiền ta lưu (voucher, trợ giá…) → % phí hiển thị sai.
 *
 *  Chạy TUẦN TỰ từng cửa hàng — pool prod mỗi cửa hàng đúng 1 kết nối.
 * ───────────────────────────────────────────────────────────────────────────── */
/* ─────────────────────────────────────────────────────────────────────────────
 *  ESCROW THÔ CỦA MỘT ĐƠN SHOPEE — GET /admin/do-escrow-tho?storeCode=&code=  (06/09/2026)
 *  CHỈ ĐỌC. Hỏi thẳng Shopee get_escrow_detail và trả về NGUYÊN `order_income`
 *  + `buyer_payment_info`, không rút gọn.
 *
 *  Vì sao cần: bất biến `total − phí = thực nhận` vỡ ở 13–18% đơn đã đối soát.
 *  `getEscrowDetail()` chỉ đọc 8 trường của order_income nên không nhìn thấy
 *  voucher_from_seller / seller_discount / seller_return_refund — đúng những
 *  trường phân biệt "voucher shop tài trợ" với "trả hàng một phần". Đoán thì
 *  sửa sai chỗ; đọc nguyên văn rồi mới sửa.
 *  Không trả token; chỉ trả số liệu phí của đơn.
 * ───────────────────────────────────────────────────────────────────────────── */
router.get('/do-escrow-tho', async (req: Request, res: Response) => {
    try {
        const storeCode = String(req.query.storeCode || 'KENGISTORE').trim()
        const code = String(req.query.code || '').trim().replace(/^ONLINE-/i, '').replace(/^SPE-/i, '')
        if (!code) { res.status(400).json({ success: false, error: 'thiếu ?code=' }); return }
        const store = await prisma.store.findFirst({ where: { code: storeCode }, select: { schema: true } })
        if (!store) { res.status(404).json({ success: false, error: 'store?' }); return }
        const sp: any = getStorePrisma(store.schema)
        const don = await sp.onlineOrder.findFirst({
            where: { OR: [{ externalOrderId: code }, { externalOrderId: `SPE-${code}` }, { orderNumber: `SPE-${code}` }] },
            select: {
                orderNumber: true, externalOrderId: true, channelId: true, status: true,
                subtotal: true, discount: true, shippingFee: true, total: true,
                platformFee: true, netRevenue: true, adsVoucherDiscount: true,
                items: { select: { productName: true, sku: true, quantity: true, unitPrice: true, discount: true, lineTotal: true } },
            },
        })
        if (!don) { res.status(404).json({ success: false, error: 'không thấy đơn trong kho' }); return }
        const ch = await sp.onlineChannel.findUnique({ where: { id: don.channelId } })
        if (!ch || ch.platform !== 'shopee') { res.status(400).json({ success: false, error: 'kênh không phải Shopee' }); return }
        const svc: any = new ShopeeService({
            apiKey: ch.apiKey || '', apiSecret: ch.apiSecret || '',
            accessToken: ch.accessToken || undefined, refreshToken: ch.refreshToken || undefined,
            shopId: ch.shopId || undefined,
        })
        const sn = (don.externalOrderId || '').replace(/^SPE-/i, '')
        const url = svc.apiUrl('/api/v2/payment/get_escrow_detail') + `&order_sn=${encodeURIComponent(sn)}`
        const data = await svc.httpGet(url)
        const income = data?.response?.order_income ?? null
        const pay = data?.response?.buyer_payment_info ?? null
        /* Suy ngược để đối chiếu ngay trong cùng một màn. */
        const doiChieu = income ? {
            totalTaLuu: Number(don.total) || 0,
            order_original_price: income.order_original_price ?? null,
            order_selling_price: income.order_selling_price ?? null,
            escrow_amount: income.escrow_amount ?? null,
            hoTaLuu_tru_sellingPrice: (Number(don.total) || 0) - (Number(income.order_selling_price) || 0),
            voucher_from_seller: income.voucher_from_seller ?? null,
            seller_discount: income.seller_discount ?? null,
            seller_return_refund: income.seller_return_refund ?? null,
            voucher_from_shopee: income.voucher_from_shopee ?? null,
            coins: income.coins ?? null,
        } : null
        res.json({
            success: true,
            data: {
                don, loiShopee: data?.error ? { error: data.error, message: data.message } : null,
                doiChieu, order_income: income, buyer_payment_info: pay,
            },
        })
    } catch (err: any) {
        res.status(500).json({ success: false, error: String(err?.message || err).slice(0, 300) })
    }
})

router.get('/do-loi-nhuan-san', async (req: Request, res: Response) => {
    try {
        const soNgay = Math.min(365, Math.max(1, Number(req.query.ngay) || 30))
        const TRAN = Math.min(5000, Math.max(100, Number(req.query.tran) || 2000))
        const tuNgay = new Date(Date.now() - soNgay * 86400_000)
        const HUY = new Set(['CANCELLED', 'IN_CANCEL', 'TO_RETURN', 'cancelled', 'cancelling', 'returned', 'UNPAID'])

        const stores = await prisma.store.findMany({ orderBy: { code: 'asc' } })
        const ketQua: any[] = []

        for (const store of stores) {
            if ((store as any).isDemo) continue
            const d: any = { cuaHang: store.code, ten: store.name }
            try {
                const sp: any = getStorePrisma((store as any).schema)
                const orders: any[] = await sp.onlineOrder.findMany({
                    where: { createdAt: { gte: tuNgay } },
                    select: {
                        id: true, orderNumber: true, externalOrderId: true, platform: true, status: true,
                        subtotal: true, discount: true, total: true, shippingFee: true,
                        platformFee: true, platformFeeRate: true, netRevenue: true, adsVoucherDiscount: true,
                        items: { select: { productId: true, sku: true, quantity: true } },
                    },
                    orderBy: { createdAt: 'desc' },
                    take: TRAN,
                })
                d.soDonDoc = orders.length
                d.biCatTran = orders.length >= TRAN   // ⚠ báo trần, đừng để người đọc tưởng đã đếm hết
                if (!orders.length) { d.ketLuan = 'Không có đơn sàn trong kỳ.'; ketQua.push(d); continue }

                /* % hoa hồng ĐANG CẤU HÌNH trên từng kênh — để so với % phí THẬT đo
                 * được ở nhóm daDoiSoat. Đây chính là câu "hàm tính phí đúng chưa":
                 * ước tính = total × commissionRate; đúng hay sai là so với escrow. */
                const kenh: any[] = await sp.onlineChannel.findMany({
                    select: { name: true, platform: true, commissionRate: true, status: true },
                }).catch(() => [])
                d.cauHinhKenh = kenh.map((k: any) => ({
                    kenh: k.name, san: k.platform, trangThai: k.status,
                    hoaHongCauHinhPhanTram: Number(k.commissionRate) || 0,
                }))

                const loi = await computeOrderProfits(sp, orders)

                type Nhom = {
                    soDon: number; doanhThu: number; phi: number; thucNhan: number; giaVon: number; loiNhuan: number
                    thieuGiaVon: number; doanhThuThieuGiaVon: number
                }
                const nhomMoi = (): Nhom => ({ soDon: 0, doanhThu: 0, phi: 0, thucNhan: 0, giaVon: 0, loiNhuan: 0, thieuGiaVon: 0, doanhThuThieuGiaVon: 0 })
                const cong = (n: Nhom, o: any, p: any) => {
                    n.soDon++
                    const dt = Number(o.subtotal) || 0
                    n.doanhThu += dt
                    n.phi += Number(o.platformFee) || 0
                    n.thucNhan += Number(o.netRevenue) || 0
                    if (p?.missingCost) { n.thieuGiaVon++; n.doanhThuThieuGiaVon += dt; return }
                    n.giaVon += Number(p?.cost) || 0
                    n.loiNhuan += Number(p?.profit) || 0
                }

                /* Ba nhóm theo nghĩa của cột phí, tách theo sàn. */
                const theoSan: Record<string, { daDoiSoat: Nhom; hinhDangUocTinh: Nhom; chuaDoiSoat: Nhom; huy: number }> = {}
                /* Kiểm bất biến phí trên nhóm đã đối soát. Giữ 5 đơn lệch LỚN NHẤT
                 * kèm mã đơn + giảm giá + ship + ads voucher — để phân biệt được
                 * "voucher shop tài trợ" với "trả hàng một phần" thay vì đoán. */
                let soKiem = 0, lechTren1d = 0, tongLech = 0, lechLonNhat = 0
                let viDuLech: any = null
                const topLech: any[] = []

                for (const o of orders) {
                    const san = String(o.platform || 'khac')
                    if (!theoSan[san]) theoSan[san] = { daDoiSoat: nhomMoi(), hinhDangUocTinh: nhomMoi(), chuaDoiSoat: nhomMoi(), huy: 0 }
                    const s = theoSan[san]
                    if (HUY.has(String(o.status))) { s.huy++; continue }
                    const p = loi.get(o.id)
                    const phi = Number(o.platformFee) || 0, net = Number(o.netRevenue) || 0
                    const total = Number(o.total) || 0, rate = Number(o.platformFeeRate) || 0

                    if (phi === 0 && net === 0) { cong(s.chuaDoiSoat, o, p); continue }
                    const uocTinh = rate > 0 && Math.abs(phi - Math.round(total * rate / 100)) <= 1
                    if (uocTinh) { cong(s.hinhDangUocTinh, o, p); continue }

                    cong(s.daDoiSoat, o, p)
                    // bất biến: total − phí − thực nhận ≈ 0 ?
                    const lech = Math.abs(total - phi - net)
                    soKiem++
                    tongLech += lech
                    if (lech > 1) lechTren1d++
                    if (lech > lechLonNhat) { lechLonNhat = lech; viDuLech = { id: o.id, total, phi, thucNhan: net, lech } }
                    if (lech > 1) {
                        topLech.push({
                            maDon: o.orderNumber, maSan: o.externalOrderId, trangThai: o.status,
                            subtotal: Number(o.subtotal) || 0, giamGia: Number(o.discount) || 0,
                            ship: Number(o.shippingFee) || 0, adsVoucher: Number(o.adsVoucherDiscount) || 0,
                            total, phi, thucNhan: net, lech: Math.round(lech),
                            // giá bán sàn suy ngược = phí + thực nhận; hở = total − giá bán sàn
                            giaBanSanSuyNguoc: phi + net,
                        })
                        topLech.sort((a, b) => b.lech - a.lech)
                        if (topLech.length > 5) topLech.length = 5
                    }
                }

                const pt = (a: number, b: number) => b > 0 ? Math.round(a / b * 1000) / 10 : null
                const tomTat = (n: Nhom) => ({
                    soDon: n.soDon,
                    doanhThu: Math.round(n.doanhThu),
                    phiSan: Math.round(n.phi),
                    /* % phí trên doanh thu — null khi không có gì để chia, KHÔNG phải 0 */
                    phiSanPhanTram: pt(n.phi, n.doanhThu),
                    thucNhan: Math.round(n.thucNhan),
                    giaVon: Math.round(n.giaVon),
                    loiNhuan: Math.round(n.loiNhuan),
                    /* % lợi nhuận CHỈ trên đơn có đủ giá vốn — mẫu số là doanh thu của
                     * đúng những đơn đó, không phải cả nhóm. */
                    loiNhuanPhanTram: pt(n.loiNhuan, n.doanhThu - n.doanhThuThieuGiaVon),
                    donThieuGiaVon: n.thieuGiaVon,
                    doanhThuThieuGiaVon: Math.round(n.doanhThuThieuGiaVon),
                })

                d.theoSan = Object.fromEntries(Object.entries(theoSan).map(([san, s]) => [san, {
                    huy: s.huy,
                    daDoiSoat: tomTat(s.daDoiSoat),
                    hinhDangUocTinh: tomTat(s.hinhDangUocTinh),
                    chuaDoiSoat: tomTat(s.chuaDoiSoat),
                }]))
                d.kiemPhi = {
                    soDonKiem: soKiem,
                    lechTren1d,
                    lechTrungBinh: soKiem ? Math.round(tongLech / soKiem) : null,
                    lechLonNhat: Math.round(lechLonNhat),
                    viDu: viDuLech,
                    top5Lech: topLech,
                    yNghia: 'Trên đơn đã đối soát: |total − phí − thựcNhận|. ≈0 = phí đúng nghĩa "giá bán − thực nhận". ' +
                        'Lệch lớn = giá bán sàn dùng tính phí ≠ tổng tiền ta lưu → % phí hiển thị sai.',
                }
            } catch (e: any) {
                d.docDuoc = false
                d.loi = String(e?.message || e).slice(0, 200)
            }
            ketQua.push(d)
        }

        res.json({
            success: true,
            data: {
                soNgay, tran: TRAN,
                luuY: 'Ba nhóm phí: daDoiSoat = phí THẬT từ sàn; hinhDangUocTinh = phí ≈ total × rate (đơn webhook ghi ước tính như thật); ' +
                    'chuaDoiSoat = 0/0. Chỉ tin % của nhóm daDoiSoat. `null` = không có gì để chia, không phải 0.',
                cuaHang: ketQua,
            },
        })
    } catch (err: any) {
        res.status(500).json({ success: false, error: String(err?.message || err) })
    }
})

router.get('/do-gia-von', async (req: Request, res: Response) => {
    try {
        const soNgay = Math.min(365, Math.max(1, Number(req.query.ngay) || 90))
        /* MỐC CẮT tuỳ chọn (?moc=2026-09-03T11:30:00Z) — đếm riêng đơn đồng bộ SAU
         * một thời điểm. Cần vì các mốc tròn (24h, 7 ngày) đều trùm lên lúc bản vá
         * lên prod, nên không phân biệt được "rò đã bịt" với "rò đang chảy".
         * `Transaction.createdAt` là LÚC ĐỒNG BỘ (ngày đặt nằm ở transactionDate),
         * nên so với giờ deploy là đúng thứ cần so. */
        const mocRaw = String(req.query.moc || '')
        const mocCat = mocRaw && !isNaN(new Date(mocRaw).getTime()) ? new Date(mocRaw).getTime() : null
        const TRAN_DON = 3000
        const tuNgay = new Date(Date.now() - soNgay * 86400_000)

        const stores = await prisma.store.findMany()
        const ketQua: any[] = []

        for (const store of stores) {
            if ((store as any).isDemo) continue
            const ten = store.name
            try {
                const sp: any = getStorePrisma((store as any).schema)

                const donDs = await sp.transaction.findMany({
                    where: { createdAt: { gte: tuNgay }, status: { notIn: ['cancelled'] } },
                    select: {
                        receiptNumber: true, total: true, subtotal: true, createdAt: true,
                        // Nhận dạng ĐƯỜNG GHI đã tạo đơn — để biết chỗ nào đang rò
                        channel: true, createdByName: true, status: true,
                        items: { select: { productId: true, quantity: true, baseQuantity: true, lineTotal: true } },
                    },
                    take: TRAN_DON,
                    orderBy: { createdAt: 'desc' },
                })
                if (donDs.length === 0) { ketQua.push({ ten, soDon: 0 }); continue }

                // Giá vốn HIỆN TẠI của mọi mã hàng có mặt trong kỳ
                const dsMa = Array.from(new Set(
                    donDs.flatMap((d: any) => d.items.map((i: any) => i.productId)).filter(Boolean),
                )) as string[]
                const hangDs = dsMa.length
                    ? await sp.product.findMany({ where: { id: { in: dsMa } }, select: { id: true, costPrice: true } })
                    : []
                const giaVonTheoMa = new Map<string, number>(
                    hangDs.map((h: any) => [h.id, Number(h.costPrice) || 0]),
                )

                let donKhongGiaVon = 0, donCoMotPhan = 0
                let doanhThuKhongGiaVon = 0, tongDoanhThu = 0
                const maThieu = new Map<string, number>()   // productId → số dòng

                for (const d of donDs) {
                    const dt = Number(d.subtotal ?? d.total) || 0
                    tongDoanhThu += dt
                    let coGiaVon = 0, thieuGiaVon = 0
                    for (const it of d.items) {
                        const gv = giaVonTheoMa.get(String(it.productId)) ?? 0
                        if (gv > 0) coGiaVon++
                        else {
                            thieuGiaVon++
                            maThieu.set(String(it.productId), (maThieu.get(String(it.productId)) || 0) + 1)
                        }
                    }
                    if (thieuGiaVon > 0 && coGiaVon === 0) { donKhongGiaVon++; doanhThuKhongGiaVon += dt }
                    else if (thieuGiaVon > 0) donCoMotPhan++
                }

                /* Đối chiếu với SỔ: đơn nào không có bút toán COGS-. Đây mới là con số
                 * thật sự đáng lo — thiếu giá vốn trên sổ nghĩa là lãi trên báo cáo
                 * cao hơn lãi thật. */
                /* Đếm CẢ HAI: bút toán doanh thu (SALE-) và giá vốn (COGS-).
                 * Tách ra vì hai nguyên nhân cần hai bản vá khác hẳn nhau:
                 *   · có SALE- mà thiếu COGS-  ⇒ lỗi RIÊNG của khối giá vốn
                 *   · thiếu CẢ HAI             ⇒ đơn chưa vào sổ, không dính giá vốn
                 * Gộp chung rồi kết luận là vá nhầm chỗ. */
                let soCoButToan = 0, soCoDoanhThu = 0, soCoDoanhThuThieuGiaVon = 0
                /* CHIA THEO MỐC THỜI GIAN — câu quyết định là "rò rỉ đã bịt chưa".
                 * Đơn cũ không vào sổ thì ghi bù là xong; đơn HÔM NAY vẫn không vào sổ
                 * nghĩa là đường ghi đang hỏng, ghi bù bao nhiêu cũng lại hụt tiếp. */
                const bay = Date.now() - 7 * 86400_000
                const bamuoi = Date.now() - 30 * 86400_000
                /* Mốc 24 GIỜ là câu quyết định: hai đường đồng bộ (KiotViet, đơn sàn)
                 * mới được nối vào sổ ngày 03/09, nên "7 ngày" gồm 6 ngày TRƯỚC bản
                 * vá — không phân biệt được rò cũ với rò đang chảy. */
                const motNgay = Date.now() - 86400_000
                const chuaVao = { trong24Gio: 0, trong7Ngay: 0, tu8Den30: 0, tren30: 0, sauMoc: 0 }
                let tongSauMoc = 0
                /* Đơn ĐÃ HUỶ đếm RIÊNG. Huỷ đơn chỉ ghi bút toán ĐẢO (VOID-<ref>) và
                 * giữ nguyên SALE- gốc, nên đơn huỷ mà không có SALE- nghĩa là nó chưa
                 * từng vào sổ — nhưng ghi bù cho nó thì vô nghĩa, hai vế triệt tiêu
                 * nhau. Gộp vào con số "cần ghi bù" là thổi phồng việc phải làm. */
                let chuaVaoDaHuy = 0
                const theoNguon = new Map<string, number>()
                for (let i = 0; i < donDs.length; i += 400) {
                    const lo = donDs.slice(i, i + 400)
                    const refs = lo.flatMap((d: any) => [`COGS-${d.receiptNumber}`, `SALE-${d.receiptNumber}`])
                    const co = await sp.journalEntry.findMany({
                        where: { reference: { in: refs } }, select: { reference: true },
                    })
                    const tap = new Set(co.map((x: any) => x.reference))
                    for (const d of lo) {
                        if (mocCat !== null && new Date(d.createdAt).getTime() >= mocCat
                            && String(d.status) !== 'voided') tongSauMoc++
                        const coGv = tap.has(`COGS-${d.receiptNumber}`)
                        const coDt = tap.has(`SALE-${d.receiptNumber}`)
                        if (coGv) soCoButToan++
                        if (coDt) soCoDoanhThu++
                        if (coDt && !coGv) soCoDoanhThuThieuGiaVon++
                        if (!coDt) {
                            if (String(d.status) === 'voided') { chuaVaoDaHuy++; continue }
                            const t = new Date(d.createdAt).getTime()
                            if (mocCat !== null && t >= mocCat) chuaVao.sauMoc++
                            if (t >= motNgay) chuaVao.trong24Gio++
                            if (t >= bay) chuaVao.trong7Ngay++
                            else if (t >= bamuoi) chuaVao.tu8Den30++
                            else chuaVao.tren30++
                            /* Gom theo NGUỒN TẠO ĐƠN. Log không có dòng [ghi-so] nào
                             * ⇒ hàm ghi sổ không hề được GỌI, nên phải tìm xem đường
                             * nào tạo ra những đơn này. */
                            const k = `${d.channel || 'khong-ro'} · ${d.createdByName || 'khong-ro'} · ${d.status}`
                            theoNguon.set(k, (theoNguon.get(k) || 0) + 1)
                        }
                    }
                }

                ketQua.push({
                    ten,
                    soDon: donDs.length,
                    chamTran: donDs.length >= TRAN_DON,
                    tongDoanhThu: Math.round(tongDoanhThu),
                    donKhongCoGiaVonNao: donKhongGiaVon,
                    doanhThuKhongGiaVon: Math.round(doanhThuKhongGiaVon),
                    donThieuMotPhan: donCoMotPhan,
                    soMaHangChuaKhaiGiaVon: maThieu.size,
                    donCoButToanGiaVon: soCoButToan,
                    donTHIEUButToanGiaVon: donDs.length - soCoButToan,
                    donCoButToanDoanhThu: soCoDoanhThu,
                    // ĐÂY mới là lỗi riêng của khối giá vốn: sổ có doanh thu mà không có giá vốn
                    donCoDoanhThuNhungTHIEUGiaVon: soCoDoanhThuThieuGiaVon,
                    // Còn đây là đơn CHƯA VÀO SỔ, không liên quan gì tới giá vốn
                    donChuaVaoSoHoanToan: donDs.length - soCoDoanhThu,
                    chuaVaoSoTheoMoc: chuaVao,
                    chuaVaoSoNhungDaHuy: chuaVaoDaHuy,
                    // Mẫu số đi kèm: có bao nhiêu đơn đồng bộ SAU mốc, để biết
                    // "0 đơn chưa vào sổ" là ĐÃ BỊT hay chỉ là KHÔNG CÓ ĐƠN NÀO
                    ...(mocCat !== null ? { tongDonSauMoc: tongSauMoc } : {}),
                    canGhiBu: donDs.length - soCoDoanhThu - chuaVaoDaHuy,
                    chuaVaoSoTheoNguon: Object.fromEntries(
                        Array.from(theoNguon.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8),
                    ),
                    tiLeThieu: donDs.length ? Math.round((donDs.length - soCoButToan) * 1000 / donDs.length) / 10 : 0,
                })
            } catch (e: any) {
                // Đọc hỏng phải NÓI RA, đừng để cửa hàng biến mất khỏi bảng rồi bị
                // hiểu thành "cửa hàng này không sao".
                ketQua.push({ ten, loi: String(e?.message || e) })
            }
        }

        res.json({
            success: true,
            data: {
                soNgay, tranDocMoiCuaHang: TRAN_DON,
                ghiChu: 'donTHIEUButToanGiaVon = đơn có doanh thu trên sổ nhưng KHÔNG có bút toán COGS- ⇒ lãi trên báo cáo cao hơn thật',
                cuaHang: ketQua,
            },
        })
    } catch (err: any) {
        console.error('GET /admin/do-gia-von lỗi:', err)
        res.status(500).json({ success: false, error: String(err?.message || err) })
    }
})

/* ─── AI ĐANG ĐƯỢC TÍNH LÀ "SHIPPER ĐÃ LẤY" — GET /admin/shipper-hom-nay (04/09/2026)
 *  Chỉ đọc. Chủ shop: "shipper chưa lấy mà sao có 2 rồi".
 *  Trả về ĐÍCH DANH từng đơn kèm nguồn của mốc thời gian, để đối chiếu tay với sàn
 *  thay vì tranh luận trên một con số tổng. */
router.get('/shipper-hom-nay', async (req: Request, res: Response) => {
    try {
        const code = String(req.query.store || '').trim()
        if (!code) { res.status(400).json({ success: false, error: 'Thiếu ?store=' }); return }
        const store = await prisma.store.findFirst({ where: { code } })
        if (!store) { res.status(404).json({ success: false, error: 'Không thấy cửa hàng' }); return }
        const sp: any = getStorePrisma((store as any).schema)

        const vnNow = new Date(Date.now() + 7 * 3600_000)
        const dauNgayVN = new Date(Date.UTC(vnNow.getUTCFullYear(), vnNow.getUTCMonth(), vnNow.getUTCDate()) - 7 * 3600_000)

        const ds = await sp.onlineOrder.findMany({
            where: { shippedAt: { gte: dauNgayVN } },
            select: {
                orderNumber: true, platform: true, channelName: true, status: true,
                externalStatus: true, trackingNumber: true, shippingCarrier: true,
                shippedAt: true, deliveredAt: true, createdAt: true, syncedAt: true, total: true,
            },
            orderBy: { shippedAt: 'desc' },
            take: 50,
        })
        res.json({
            success: true,
            data: {
                tuLuc: dauNgayVN.toISOString(),
                so: ds.length,
                ghiChu: 'shippedAt lấy từ: Shopee pickup_done_time · TikTok collection_time · Lazada shipped_at',
                donHang: ds,
            },
        })
    } catch (err: any) {
        console.error('GET /admin/shipper-hom-nay lỗi:', err)
        res.status(500).json({ success: false, error: String(err?.message || err) })
    }
})

/* ─── NHẬT KÝ QUÉT MÃ CÓ NỐI ĐƯỢC SANG ĐƠN SÀN KHÔNG — GET /admin/do-dong-goi
 *  (04/09/2026) CHỈ ĐỌC.
 *
 *  Chủ shop: "đơn là đơn thực đóng chứ không phải đơn bắt đầu đếm từ hôm nay".
 *  Muốn tính doanh số theo LÚC ĐÓNG thì phải nối PackingLog.orderCode sang
 *  OnlineOrder. Mà `orderCode` là thứ nhân viên QUÉT — có thể là mã đơn, có thể là
 *  mã vận đơn (chú thích schema nói đúng như vậy).
 *
 *  Phải đo TỈ LỆ NỐI ĐƯỢC trước khi đổi trục thời gian của cả bảng: nối hụt thì
 *  doanh số tụt mà không ai biết vì sao — đúng kiểu sai âm thầm tệ nhất.
 *  Trả về cả VÀI MÃ KHÔNG NỐI ĐƯỢC để còn nhìn tận mắt chúng là cái gì. */
router.get('/do-dong-goi', async (req: Request, res: Response) => {
    try {
        const code = String(req.query.store || '').trim()
        if (!code) { res.status(400).json({ success: false, error: 'Thiếu ?store=' }); return }
        const store = await prisma.store.findFirst({ where: { code } })
        if (!store) { res.status(404).json({ success: false, error: 'Không thấy cửa hàng' }); return }
        const sp: any = getStorePrisma((store as any).schema)

        const soNgay = Math.min(30, Math.max(1, Number(req.query.ngay) || 1))
        const vnNow = new Date(Date.now() + 7 * 3600_000)
        const dauNgayCong = new Date(Date.UTC(vnNow.getUTCFullYear(), vnNow.getUTCMonth(), vnNow.getUTCDate()))
        const tuNgayCong = new Date(dauNgayCong.getTime() - (soNgay - 1) * 86400_000)
        const dauNgayVN = new Date(dauNgayCong.getTime() - 7 * 3600_000)

        const logs = await sp.packingLog.findMany({
            where: { workDate: { gte: tuNgayCong } },
            select: { orderCode: true, createdAt: true, userName: true },
            take: 20000,
        })
        const maDaQuet = Array.from(new Set(logs.map((l: any) => String(l.orderCode || '').trim()).filter(Boolean)))

        // Nối theo HAI đường, đo riêng từng đường
        const theoSoDon = maDaQuet.length ? await sp.onlineOrder.findMany({
            where: { orderNumber: { in: maDaQuet } },
            select: { orderNumber: true, trackingNumber: true, total: true, netRevenue: true, status: true, createdAt: true },
        }) : []
        const theoVanDon = maDaQuet.length ? await sp.onlineOrder.findMany({
            where: { trackingNumber: { in: maDaQuet } },
            select: { orderNumber: true, trackingNumber: true, total: true, netRevenue: true, status: true, createdAt: true },
        }) : []

        const bang = new Map<string, any>()
        for (const d of theoSoDon) bang.set(String(d.orderNumber), d)
        for (const d of theoVanDon) if (d.trackingNumber) bang.set(String(d.trackingNumber), d)

        const noiDuoc = maDaQuet.filter((m: any) => bang.has(String(m)))
        const khongNoi = maDaQuet.filter((m: any) => !bang.has(String(m)))
        const tien = (d: any) => (Number(d.netRevenue) > 0 ? Number(d.netRevenue) : Number(d.total)) || 0
        const laHuy = (st: string) => ['CANCELLED', 'IN_CANCEL', 'TO_RETURN', 'cancelled', 'cancelling', 'returned']
            .includes(String(st))

        // Trong số đơn ĐÃ ĐÓNG hôm nay, bao nhiêu là đơn của NGÀY TRƯỚC
        let donCu = 0, tienDong = 0
        for (const m of noiDuoc) {
            const d = bang.get(String(m))
            if (!laHuy(d.status)) tienDong += tien(d)
            if (new Date(d.createdAt) < dauNgayVN) donCu++
        }

        // Đối chứng: doanh số tính theo NGÀY ĐƠN VỀ, cách bảng đang chạy hiện nay
        const donVeHomNay = await sp.onlineOrder.findMany({
            where: { createdAt: { gte: dauNgayVN } },
            select: { total: true, netRevenue: true, status: true },
            take: 5000,
        })
        const tienDonVe = donVeHomNay.filter((d: any) => !laHuy(d.status)).reduce((a: number, d: any) => a + tien(d), 0)

        res.json({
            success: true,
            data: {
                soNgay, tuNgayCong: tuNgayCong.toISOString(),
                nhatKy: { dong: logs.length, maRieng: maDaQuet.length },
                noi: {
                    duoc: noiDuoc.length,
                    hong: khongNoi.length,
                    tiLe: maDaQuet.length ? Math.round((noiDuoc.length / maDaQuet.length) * 1000) / 10 : null,
                    theoSoDon: theoSoDon.length,
                    theoVanDon: theoVanDon.length,
                },
                maKhongNoiDuoc: khongNoi.slice(0, 20),
                soSanh: {
                    tienTheoLucDong: tienDong,
                    tienTheoDonVe: tienDonVe,
                    donDaDongLaDonCu: donCu,
                    ghiChu: 'tienTheoLucDong chỉ tính được trên phần NỐI ĐƯỢC — nối hụt bao nhiêu thì thiếu bấy nhiêu',
                },
            },
        })
    } catch (err: any) {
        console.error('GET /admin/do-dong-goi lỗi:', err)
        res.status(500).json({ success: false, error: String(err?.message || err) })
    }
})

/* ─── TRỢ LÝ AI ĐÃ CẤU HÌNH CHƯA — GET /admin/do-tro-ly (05/09/2026)
 *  CHỈ ĐỌC, và TUYỆT ĐỐI không trả về giá trị khoá.
 *
 *  Vì sao cần: trợ lý AI (/api/mcp-agent/chat) đọc `StoreSettings.geminiApiKey`
 *  của TỪNG cửa hàng; thiếu là trả 503 "chưa cấu hình". Nhìn từ ngoài thì giống
 *  hệt "trợ lý hỏng" — nên phải phân biệt được hai chuyện đó mà không cần ai đọc
 *  khoá ra.
 *
 *  Chỉ trả CÓ/KHÔNG và độ dài khoá. Độ dài đủ để phát hiện dán thiếu/dán nhầm
 *  (khoá Gemini ~39 ký tự) mà không lộ được ký tự nào. */
router.get('/do-tro-ly', async (_req: Request, res: Response) => {
    try {
        /* Cột là `status` ('active'|'inactive'|'suspended'), KHÔNG phải `isActive`,
         * và Store không có `isDemo` (cờ demo được đánh bằng SQL thô ngoài schema).
         * Prisma của registry có kiểu đầy đủ nên nó bắt được ngay — khác hẳn
         * storePrisma dùng `as any`, chỗ đó cột sai chỉ ra undefined lặng lẽ. */
        const stores = await prisma.store.findMany({
            where: { status: 'active' },
            select: { code: true, name: true, schema: true, hasAiJobs: true },
            orderBy: { code: 'asc' },
        })
        const ra: any[] = []
        // TUẦN TỰ — pool prod = 1 kết nối, chạy song song là chúng tự xếp hàng
        // sau nhau mà còn tốn thêm lượt xác thực.
        for (const st of stores as any[]) {
            let coKhoa: boolean | null = null
            let doDai = 0
            try {
                const sp: any = getStorePrisma(st.schema)
                const cf = await sp.storeSettings.findFirst({ select: { geminiApiKey: true } as any })
                const k = String(cf?.geminiApiKey ?? '')
                coKhoa = k.length > 0
                doDai = k.length
            } catch {
                // Cột chưa migrate hoặc đọc hỏng — KHÔNG coi là "chưa cấu hình",
                // vì đọc hỏng khác hẳn không có (null nói rõ là không đọc được).
                coKhoa = null
            }
            ra.push({
                cuaHang: st.code, ten: st.name, coTacVuTuDong: !!st.hasAiJobs,
                daCauHinhTroLy: coKhoa,
                doDaiKhoa: doDai,       // chỉ độ dài, không có ký tự nào
                ghiChu: coKhoa === null ? 'KHÔNG ĐỌC ĐƯỢC (khác với chưa cấu hình)'
                    : coKhoa ? (doDai < 30 ? 'Có khoá nhưng NGẮN BẤT THƯỜNG — nghi dán thiếu' : 'OK')
                        : 'Chưa nhập khoá → /api/mcp-agent/chat sẽ trả 503',
            })
        }
        res.json({
            success: true,
            data: {
                soCuaHang: ra.length,
                daCauHinh: ra.filter(x => x.daCauHinhTroLy === true).length,
                chuaCauHinh: ra.filter(x => x.daCauHinhTroLy === false).length,
                khongDocDuoc: ra.filter(x => x.daCauHinhTroLy === null).length,
                chiTiet: ra,
                ghiChu: 'Chỉ trả có/không và độ dài. Khoá KHÔNG bao giờ đi ra khỏi máy chủ.',
            },
        })
    } catch (err: any) {
        console.error('GET /admin/do-tro-ly lỗi:', err)
        res.status(500).json({ success: false, error: String(err?.message || err) })
    }
})

/* ─── APP FACEBOOK CẤU HÌNH ĐÚNG CHƯA — GET /admin/do-app-fb (05/09/2026)
 *  CHỈ ĐỌC. KHÔNG in App Secret ra, kể cả một phần.
 *
 *  Vì sao cần: nút "Đăng nhập bằng Facebook" ở Fanpage Manager hỏng thì Facebook
 *  chỉ hiện một hộp thoại cụt ngủn, không nói vì sao. Ba nguyên nhân hay gặp đều
 *  KIỂM ĐƯỢC TỪ MÁY CHỦ, không cần ai bấm gì:
 *    1. App ID / App Secret không khớp nhau → xin app token là hỏng ngay
 *    2. Miền kengi.vn chưa khai trong App Domains → FB.login bị chặn im lặng
 *    3. App đang ở chế độ phát triển → chỉ tài khoản có vai trò trong app đăng
 *       nhập được, người ngoài bấm là lỗi
 *
 *  Hỏi thẳng Graph API bằng chính app token của app đó — không đụng tài khoản
 *  Facebook của ai. */
router.get('/do-app-fb', async (_req: Request, res: Response) => {
    const APP_ID = process.env.FB_APP_ID || ''
    const APP_SECRET = process.env.FB_APP_SECRET || ''
    const ra: any = {
        coAppId: !!APP_ID,
        coAppSecret: !!APP_SECRET,
        appId: APP_ID || null,          // App ID KHÔNG phải bí mật, hiện được
        doDaiSecret: APP_SECRET.length, // chỉ độ dài, không ký tự nào
    }
    if (!APP_ID || !APP_SECRET) {
        ra.ketLuan = 'Máy chủ THIẾU FB_APP_ID hoặc FB_APP_SECRET → nút đăng nhập Facebook không thể chạy.'
        res.json({ success: true, data: ra })
        return
    }
    try {
        const tok = `${APP_ID}|${APP_SECRET}`
        const url = `https://graph.facebook.com/v21.0/${APP_ID}` +
            `?fields=name,link,app_domains,privacy_policy_url,category` +
            `&access_token=${encodeURIComponent(tok)}`
        const r = await fetch(url)
        const j: any = await r.json()

        if (j?.error) {
            /* Lỗi ở BƯỚC NÀY gần như luôn là cặp ID/Secret không khớp — nói thẳng
             * thay vì trả nguyên văn lỗi Graph API cho người không đọc được nó. */
            ra.ketLuan = 'App ID và App Secret trên máy chủ KHÔNG khớp nhau (Facebook từ chối app token).'
            ra.loiGraph = String(j.error?.message || '').slice(0, 200)
            res.json({ success: true, data: ra })
            return
        }

        const mien: string[] = Array.isArray(j?.app_domains) ? j.app_domains : []
        ra.tenApp = j?.name ?? null
        ra.mienDaKhai = mien
        ra.coKengiVn = mien.some(m => String(m).toLowerCase().includes('kengi.vn'))
        ra.coChinhSachRiengTu = !!j?.privacy_policy_url

        const van: string[] = []
        if (!mien.length) {
            van.push('App CHƯA khai App Domains nào. Facebook có thể chặn FB.login từ kengi.vn — ' +
                'vào developers.facebook.com → app → Settings → Basic → App Domains, thêm "kengi.vn".')
        } else if (!ra.coKengiVn) {
            van.push(`App Domains hiện là [${mien.join(', ')}] — KHÔNG có kengi.vn. ` +
                'FB.login gọi từ kengi.vn sẽ bị chặn. Thêm "kengi.vn" vào App Domains.')
        }
        if (!ra.coChinhSachRiengTu) {
            van.push('App chưa khai Privacy Policy URL — Facebook bắt buộc có trước khi đưa app ' +
                'sang chế độ Live; đang ở chế độ phát triển thì chỉ tài khoản có vai trò trong app ' +
                'mới đăng nhập được.')
        }
        ra.canSua = van
        ra.ketLuan = van.length
            ? 'App có thật nhưng CÒN THIẾU cấu hình — xem `canSua`.'
            : 'App ID/Secret khớp, App Domains có kengi.vn. Nếu vẫn hỏng thì do quyền (App Review) hoặc tài khoản không quản trị fanpage nào.'
        res.json({ success: true, data: ra })
    } catch (err: any) {
        ra.ketLuan = 'Không hỏi được Facebook (mạng máy chủ) — KHÔNG kết luận là app hỏng.'
        ra.loi = String(err?.message || err).slice(0, 200)
        res.json({ success: true, data: ra })
    }
})

/* ─── ĐÃ CÓ AI NỐI FANPAGE THẬT CHƯA — GET /admin/do-fanpage (05/09/2026)
 *  CHỈ ĐỌC. KHÔNG in accessToken, kể cả một phần.
 *
 *  Vì sao cần: cả hôm nay tôi vá đường nối fanpage rồi kết luận "chưa ai nối được"
 *  — nhưng đó là SUY ĐOÁN từ chỗ tôi không thấy, không phải phép đo. Registry có
 *  sẵn cờ `Store.hasFanpages` (do chính /connect-page-token bật lên) và bảng
 *  FbPage nằm trong schema từng cửa hàng. Hỏi thẳng là ra.
 *
 *  Hai mức bằng chứng, KHÁC NHAU — đừng lẫn:
 *    · CÓ DÒNG trong FbPage  = đã từng nối được một lần
 *    · TOKEN CÒN SỐNG        = ĐANG dùng được ngay bây giờ
 *  Một page nối từ 3 tháng trước thì có dòng nhưng token đã chết. Vì vậy mặc định
 *  hỏi luôn Graph API bằng chính token đã lưu (?thu=0 để tắt nếu chỉ cần đếm).
 *
 *  Chạy TUẦN TỰ từng cửa hàng: pool prod mỗi cửa hàng đúng 1 kết nối.
 * ───────────────────────────────────────────────────────────────────────────── */
/* ─────────────────────────────────────────────────────────────────────────────
 *  CHUYỂN DỮ LIỆU Fb* → Mkt*  —  POST /admin/chuyen-marketing   (05/09/2026)
 *
 *  ⚠ MẶC ĐỊNH CHẠY THỬ. Chỉ đếm và trả mẫu; muốn ghi thật phải gửi {"apply":true}.
 *
 *  Bản đồ:
 *    FbPage         → MktAccount   (platform='facebook', token được MÃ HOÁ lại)
 *    FbContentPlan  → MktCampaign
 *    FbContentDraft → MktContent
 *    FbScheduledPost→ MktPublication (+ MktContent riêng nếu bài không có bản nháp)
 *
 *  CHỐNG TRÙNG: giữ NGUYÊN id cũ làm id mới. Chạy lại lần hai phải ra "bỏ qua —
 *  đã có", tuyệt đối không đẻ thêm bản ghi. (MktAccount dùng khoá tự nhiên
 *  platform+externalId vì id cũ là pageId của Facebook chứ không phải cuid.)
 *
 *  Chạy TUẦN TỰ từng cửa hàng — pool prod mỗi cửa hàng đúng 1 kết nối.
 * ───────────────────────────────────────────────────────────────────────────── */
router.post('/chuyen-marketing', async (req: Request, res: Response) => {
    try {
        const ghiThat = req.body?.apply === true

        /* Không có khoá vault thì KHÔNG chuyển được token — dừng ngay, đừng ghi
         * một nửa. Chạy thử vẫn cho phép để chủ shop xem trước sẽ chuyển những gì. */
        const coKhoa = coKhoaVault()
        if (ghiThat && !coKhoa) {
            res.status(400).json({
                success: false,
                error: 'Thiếu MARKETING_VAULT_KEY nên không mã hoá được token. ' +
                    'Khai secret rồi deploy lại; chạy thử (bỏ apply) thì vẫn xem trước được.',
            })
            return
        }

        const stores = await registryPrisma.store.findMany({
            where: { status: 'active' },
            select: { code: true, name: true, schema: true },
            orderBy: { code: 'asc' },
        })

        const chiTiet: any[] = []
        let tongChuyen = 0, tongBoQua = 0, tongDocHong = 0

        for (const st of stores) {
            const d: any = { cuaHang: st.code, ten: st.name }
            try {
                const sp: any = getStorePrisma(st.schema)

                const [pages, plans, drafts, posts] = [
                    await sp.fbPage.findMany(),
                    await sp.fbContentPlan.findMany(),
                    await sp.fbContentDraft.findMany(),
                    await sp.fbScheduledPost.findMany(),
                ]
                d.nguon = { page: pages.length, chienDich: plans.length, noiDung: drafts.length, baiHen: posts.length }

                if (!pages.length && !plans.length && !drafts.length && !posts.length) {
                    d.ketLuan = 'Không có gì để chuyển.'
                    chiTiet.push(d)
                    continue
                }

                let chuyen = 0, boQua = 0
                const mauBoQua: string[] = []
                /* pageId (Facebook) → MktAccount.id (cuid) — publication cần id nội bộ. */
                const banDoTaiKhoan = new Map<string, string>()

                // ── 1. FbPage → MktAccount ────────────────────────────────────
                for (const p of pages) {
                    const daCo = await sp.mktAccount.findUnique({
                        where: { platform_externalId: { platform: 'facebook', externalId: p.pageId } },
                    })
                    if (daCo) {
                        banDoTaiKhoan.set(p.pageId, daCo.id); boQua++
                        mauBoQua.push(`page ${p.pageId}: đã có`)
                        continue
                    }
                    if (!ghiThat) { chuyen++; banDoTaiKhoan.set(p.pageId, 'CHAY-THU'); continue }
                    const moi = await sp.mktAccount.create({
                        data: {
                            platform: 'facebook', externalId: p.pageId, name: p.name || '',
                            avatar: p.avatar ?? null, category: p.category ?? null,
                            followers: typeof p.fanCount === 'number' ? p.fanCount : null,
                            accessToken: maHoa(p.accessToken),   // ← thô → mã hoá
                            tokenExpiresAt: p.tokenExpiresAt ?? null,
                            status: p.status || 'active', connectedBy: p.connectedBy ?? null,
                        },
                    })
                    banDoTaiKhoan.set(p.pageId, moi.id); chuyen++
                }

                // ── 2. FbContentPlan → MktCampaign (giữ nguyên id) ────────────
                for (const pl of plans) {
                    if (await sp.mktCampaign.findUnique({ where: { id: pl.id } })) {
                        boQua++; mauBoQua.push(`chiến dịch ${pl.id}: đã có`); continue
                    }
                    if (!ghiThat) { chuyen++; continue }
                    await sp.mktCampaign.create({
                        data: {
                            id: pl.id, name: pl.title, goal: pl.goal || '',
                            status: pl.status === 'cancelled' ? 'paused' : (pl.status === 'done' ? 'done' : 'active'),
                            startAt: pl.fromDate, endAt: pl.toDate, createdBy: pl.createdBy ?? null,
                        },
                    })
                    chuyen++
                }

                // ── 3. FbContentDraft → MktContent (giữ nguyên id) ────────────
                const draftTheoPost = new Map<string, any>()
                for (const dr of drafts) {
                    if (dr.scheduledPostId) draftTheoPost.set(dr.scheduledPostId, dr)
                    if (await sp.mktContent.findUnique({ where: { id: dr.id } })) {
                        boQua++; mauBoQua.push(`nội dung ${dr.id}: đã có`); continue
                    }
                    if (!ghiThat) { chuyen++; continue }
                    /* Bài ĐÃ lên lịch/đã đăng nghĩa là chủ shop từng duyệt → coi
                     * revision 1 là đã duyệt. Bài `pending` thì KHÔNG được tự duyệt hộ. */
                    const daDuyet = ['scheduled', 'published'].includes(dr.status)
                    await sp.mktContent.create({
                        data: {
                            id: dr.id, campaignId: dr.planId ?? null,
                            title: dr.title || '', body: dr.message || '',
                            hashtags: dr.hashtags || '[]', linkUrl: dr.linkUrl ?? null,
                            assetIds: '[]', productIds: dr.productIds || '[]',
                            revision: 1, approvedRevision: daDuyet ? 1 : null,
                            approvedAt: daDuyet ? dr.updatedAt : null,
                            rejectReason: dr.rejectReason ?? null,
                            status: dr.status === 'published' ? 'done'
                                : dr.status === 'scheduled' ? 'scheduled'
                                    : dr.status === 'rejected' ? 'rejected' : 'pending',
                            source: dr.source || 'ai', createdBy: dr.createdBy ?? null,
                        },
                    })
                    chuyen++
                }

                // ── 4. FbScheduledPost → MktPublication ───────────────────────
                for (const po of posts) {
                    if (await sp.mktPublication.findUnique({ where: { id: po.id } })) {
                        boQua++; mauBoQua.push(`bài hẹn ${po.id}: đã có`); continue
                    }
                    const accId = banDoTaiKhoan.get(po.pageId)
                    if (!accId) {
                        /* Bài hẹn trỏ tới page KHÔNG còn trong FbPage — không dựng
                         * được tài khoản đích. Nói rõ lý do thay vì im lặng bỏ. */
                        boQua++; mauBoQua.push(`bài hẹn ${po.id}: page ${po.pageId} không còn trong FbPage`)
                        continue
                    }
                    if (!ghiThat) { chuyen++; continue }

                    /* Bài hẹn không có bản nháp nào trỏ tới → dựng một MktContent
                     * riêng, nếu không thì mất hẳn nội dung bài. */
                    let contentId = draftTheoPost.get(po.id)?.id
                    if (!contentId) {
                        const c = await sp.mktContent.create({
                            data: {
                                title: '', body: po.message || '', linkUrl: po.linkUrl ?? null,
                                revision: 1, approvedRevision: 1, approvedAt: po.createdAt,
                                status: po.status === 'published' ? 'done' : 'scheduled',
                                source: 'manual', createdBy: po.createdBy ?? null,
                            },
                        })
                        contentId = c.id
                    }
                    await sp.mktPublication.create({
                        data: {
                            id: po.id, contentId, accountId: accId,
                            idempotencyKey: `${contentId}|${accId}|1`,
                            scheduledAt: po.scheduledAt,
                            status: po.status === 'published' ? 'sent'
                                : po.status === 'failed' ? 'failed'
                                    : po.status === 'cancelled' ? 'cancelled' : 'queued',
                            remotePostId: po.fbPostId ?? null,
                            errorMessage: po.errorMessage ?? null,
                            sentAt: po.publishedAt ?? null,
                        },
                    })
                    chuyen++
                }

                d.seChuyen = chuyen
                d.boQua = boQua
                if (mauBoQua.length) d.viDuBoQua = mauBoQua.slice(0, 5)
                tongChuyen += chuyen; tongBoQua += boQua
            } catch (e: any) {
                /* Đọc hỏng KHÁC "không có gì" — ghi riêng, đừng để lẫn vào số 0. */
                d.docDuoc = false
                d.loi = String(e?.message || e).slice(0, 200)
                tongDocHong++
            }
            chiTiet.push(d)
        }

        res.json({
            success: true,
            data: {
                cheDo: ghiThat ? 'GHI THẬT' : 'CHẠY THỬ (gửi {"apply":true} để ghi)',
                coKhoaVault: coKhoa,
                soCuaHang: stores.length,
                soCuaHangDocHong: tongDocHong,
                tongSeChuyen: tongChuyen,
                tongBoQua: tongBoQua,
                chiTiet,
                ketLuan: tongDocHong > 0
                    ? `⚠ ${tongDocHong} cửa hàng ĐỌC HỎNG — số liệu dưới đây THIẾU, đừng coi là "không có gì".`
                    : tongChuyen === 0
                        ? 'Không có bản ghi nào cần chuyển (đã chuyển xong, hoặc chưa từng có dữ liệu Fb*).'
                        : `${ghiThat ? 'Đã chuyển' : 'Sẽ chuyển'} ${tongChuyen} bản ghi.`,
            },
        })
    } catch (err: any) {
        res.status(500).json({ success: false, error: String(err?.message || err) })
    }
})

router.get('/do-fanpage', async (req: Request, res: Response) => {
    try {
        const thuToken = String(req.query.thu ?? '1') !== '0'
        const stores = await prisma.store.findMany()
        const ketQua: any[] = []
        let tongPage = 0, tongSong = 0, tongChet = 0, tongKhongThu = 0

        for (const store of stores) {
            const dong: any = {
                cuaHang: store.name,
                ma: (store as any).code ?? null,
                coCoHasFanpages: !!(store as any).hasFanpages,
            }
            try {
                const sp: any = getStorePrisma((store as any).schema)
                const pages = await sp.fbPage.findMany({
                    select: {
                        pageId: true, name: true, status: true, fanCount: true,
                        tokenExpiresAt: true, webhookSubscribed: true,
                        autoReplyEnabled: true, lastSyncAt: true, connectedBy: true,
                        createdAt: true, accessToken: true,
                    },
                    orderBy: { createdAt: 'asc' },
                })
                dong.soPage = pages.length
                tongPage += pages.length

                const ds: any[] = []
                for (const pg of pages) {
                    const tok = String(pg.accessToken || '')
                    const mo: any = {
                        pageId: pg.pageId,
                        ten: pg.name,
                        trangThai: pg.status,
                        fan: pg.fanCount,
                        /* CHỈ độ dài — không một ký tự nào của token đi ra ngoài. */
                        doDaiToken: tok.length,
                        hanToken: pg.tokenExpiresAt,
                        webhook: pg.webhookSubscribed,
                        tuTraLoi: pg.autoReplyEnabled,
                        noiLuc: pg.createdAt,
                        dongBoCuoi: pg.lastSyncAt,
                    }
                    if (!thuToken) {
                        mo.tokenConSong = null
                        mo.ghiChu = 'chưa thử (?thu=0) — KHÔNG kết luận là chết'
                        tongKhongThu++
                    } else if (!tok) {
                        mo.tokenConSong = false
                        mo.ghiChu = 'không có token trong CSDL'
                        tongChet++
                    } else {
                        try {
                            const r = await fetch(
                                'https://graph.facebook.com/v21.0/me?fields=id,name' +
                                '&access_token=' + encodeURIComponent(tok))
                            const j: any = await r.json()
                            if (j?.error) {
                                mo.tokenConSong = false
                                mo.ghiChu = 'Facebook từ chối: ' + String(j.error?.message || '').slice(0, 160)
                                tongChet++
                            } else {
                                mo.tokenConSong = true
                                mo.graphTraVe = { id: j?.id ?? null, name: j?.name ?? null }
                                /* Token của page khác page đã lưu = đã lưu nhầm. */
                                mo.khopPageId = String(j?.id || '') === String(pg.pageId)
                                tongSong++
                            }
                        } catch (e: any) {
                            /* Lỗi MẠNG không phải bằng chứng token chết. */
                            mo.tokenConSong = null
                            mo.ghiChu = 'không hỏi được Facebook (mạng máy chủ): ' +
                                String(e?.message || e).slice(0, 120)
                            tongKhongThu++
                        }
                    }
                    ds.push(mo)
                }
                dong.pages = ds

                /* Cờ registry và bảng thật lệch nhau thì fanpageCron sẽ bỏ sót
                 * (cờ false mà có page) hoặc quét thừa (cờ true mà rỗng). */
                if (!!(store as any).hasFanpages !== (pages.length > 0)) {
                    dong.canhBaoLechCo = `Store.hasFanpages=${!!(store as any).hasFanpages} ` +
                        `nhưng bảng FbPage có ${pages.length} dòng — fanpageCron sẽ ` +
                        (pages.length > 0 ? 'BỎ SÓT cửa hàng này.' : 'quét thừa cửa hàng này.')
                }
            } catch (e: any) {
                /* Đọc hỏng ≠ không có. Nói rõ là hỏng. */
                dong.docDuoc = false
                dong.loi = String(e?.message || e).slice(0, 180)
            }
            ketQua.push(dong)
        }

        const coDong = ketQua.filter(d => (d.soPage || 0) > 0)
        const ketLuan = tongPage === 0
            ? 'CHƯA cửa hàng nào nối fanpage — bảng FbPage rỗng ở tất cả cửa hàng đọc được.'
            : (tongSong > 0
                ? `${tongSong}/${tongPage} page có token CÒN SỐNG ngay lúc đo ⇒ đường nối fanpage CHẠY ĐƯỢC thật.`
                : `Có ${tongPage} page đã từng nối nhưng KHÔNG page nào còn token sống — phải nối lại.`)

        res.json({
            success: true,
            data: {
                thuTokenThat: thuToken,
                soCuaHang: stores.length,
                soCuaHangDocHong: ketQua.filter(d => d.docDuoc === false).length,
                tongPage, tongTokenSong: tongSong, tongTokenChet: tongChet,
                tongChuaThu: tongKhongThu,
                cuaHangCoPage: coDong.map(d => d.cuaHang),
                ketLuan,
                chiTiet: ketQua,
            },
        })
    } catch (err: any) {
        res.status(500).json({ success: false, error: String(err?.message || err).slice(0, 300) })
    }
})

router.get('/store-health', async (req: Request, res: Response) => {
    try {
        const storeCode = String(req.query.storeCode || 'KENGISTORE').trim()
        const store = await prisma.store.findFirst({ where: { code: storeCode }, select: { code: true, schema: true } })
        if (!store) { res.status(404).json({ success: false, error: 'Store not found' }); return }
        const sp = getStorePrisma(store.schema)

        const OPEN = `LOWER(ro.status) IN ('pending','approved','processing','refunded')`
        const [channels, refundedNotReversed, invoicedButReturned, openInQueue] = await chayTheoDot([
            () => sp.$queryRawUnsafe(`
                SELECT name, platform, status,
                       to_char("lastSyncAt",'YYYY-MM-DD HH24:MI') AS "lastSyncAt",
                       to_char("tokenExpiresAt" + interval '7 hours','YYYY-MM-DD') AS "tokenExpiresAt"
                FROM "OnlineChannel" ORDER BY platform, name`),
            () => sp.$queryRawUnsafe(`
                SELECT COUNT(*)::int AS n
                FROM "ReturnOrder" ro JOIN "OnlineOrder" o ON o."orderNumber" = ro."originalInvoice"
                WHERE LOWER(ro.status) = 'refunded' AND o.status NOT IN ('returned','cancelled','CANCELLED')`),
            () => sp.$queryRawUnsafe(`
                SELECT ro.code, ro.status, o."orderNumber", o.platform,
                       ro."totalRefund"::float8 AS refund, e."invoiceNumber"
                FROM "ReturnOrder" ro
                JOIN "OnlineOrder" o ON o."orderNumber" = ro."originalInvoice"
                JOIN "Transaction" t ON t."receiptNumber" = ('ONLINE-' || o."orderNumber")
                JOIN "EInvoice" e ON e."transactionId" = t.id AND e.status IN ('issued','SENT')
                WHERE ${OPEN} ORDER BY ro."createdAt" DESC LIMIT 50`),
            () => sp.$queryRawUnsafe(`
                SELECT COUNT(DISTINCT o.id)::int AS n
                FROM "ReturnOrder" ro
                JOIN "OnlineOrder" o ON o."orderNumber" = ro."originalInvoice"
                JOIN "Transaction" t ON t."receiptNumber" = ('ONLINE-' || o."orderNumber")
                WHERE ${OPEN} AND t.status IN ('completed','partial','returned')
                  AND NOT EXISTS (SELECT 1 FROM "EInvoice" e WHERE e."transactionId" = t.id AND e.status IN ('issued','SENT'))`),
        ])
        res.json({
            success: true,
            data: {
                store: store.code,
                channels,
                refundedNotReversed: (refundedNotReversed as any[])[0]?.n ?? 0,
                invoicedButReturned: invoicedButReturned,
                openReturnStillInQueue: (openInQueue as any[])[0]?.n ?? 0,
            },
        })
    } catch (err: any) {
        console.error('Admin store-health error:', err)
        res.status(500).json({ success: false, error: err?.message || 'Internal server error' })
    }
})

// ─── POST /admin/merge-product ───────────────────────────────────────────────
// Gộp 2 mã hàng kèm đồng hoá số lượng (xem src/lib/mergeProduct.ts).
// Body: { storeCode, fromSku, toSku, rate, dryRun }
router.post('/merge-product', async (req: Request, res: Response) => {
    try {
        const { mergeProduct } = await import('../lib/mergeProduct')
        const b = req.body || {}
        const storeCode = String(b.storeCode || '').trim()
        const fromSku = String(b.fromSku || '').trim()
        const toSku = String(b.toSku || '').trim()
        const rate = Number(b.rate) || 1
        const dryRun = b.dryRun !== false && b.dryRun !== 'false'
        if (!storeCode || !fromSku || !toSku) { res.status(400).json({ success: false, error: 'Thiếu storeCode/fromSku/toSku' }); return }
        if (!(rate > 0)) { res.status(400).json({ success: false, error: 'rate phải > 0' }); return }
        const store = await prisma.store.findFirst({ where: { code: storeCode }, select: { schema: true } })
        if (!store) { res.status(404).json({ success: false, error: 'Không tìm thấy cửa hàng' }); return }
        const data = await mergeProduct(getStorePrisma(store.schema), {
            fromSku, toSku, rate, dryRun, force: b.force === true,
            mainUnit: b.mainUnit === 'source' ? 'source' : 'target',
            unitName: b.unitName ? String(b.unitName) : undefined,
        })
        res.json({ success: true, dryRun, data })
    } catch (err: any) {
        console.error('Admin merge-product error:', err)
        res.status(500).json({ success: false, error: err?.message || 'Internal server error' })
    }
})

// ─── POST /admin/clean-fake-fees ─────────────────────────────────────────────
// DỌN PHÍ SÀN ẢO: bản sync cũ ghi platformFee = tổng × hoa hồng cấu hình rồi hiện
// như phí thật. Phí thật của sàn (escrow/settlement) gần như không bao giờ ra
// đúng một tỷ lệ phẳng, nên dấu hiệu nhận diện là:
//   platformFeeRate > 0 VÀ platformFee = ROUND(total × platformFeeRate / 100)
// Đơn đã đối soát thật thì sync-fees ghi đè platformFee (giữ nguyên rate) nên
// đẳng thức vỡ → không bị đụng tới.
// Body: { storeCode?, dryRun } — dryRun mặc định TRUE, chỉ đếm.
router.post('/clean-fake-fees', async (req: Request, res: Response) => {
    try {
        const b = req.body || {}
        const storeCode = String(b.storeCode || '').trim()
        const dryRun = b.dryRun !== false && b.dryRun !== 'false'
        const stores = await prisma.store.findMany({
            where: { status: 'active', ...(storeCode ? { code: storeCode } : {}) },
            select: { code: true, schema: true },
        })
        const COND = `"platformFeeRate" > 0
                      AND "platformFee" > 0
                      AND ROUND(("total" * "platformFeeRate" / 100)::numeric) = ROUND("platformFee"::numeric)`
        const out: any[] = []
        for (const store of stores) {
            const sp = getStorePrisma(store.schema) as any
            try {
                const stat = await sp.$queryRawUnsafe(`
                    SELECT COUNT(*)::int AS n,
                           COALESCE(SUM("platformFee"),0)::float8 AS "tongPhiAo",
                           COALESCE(SUM("total"),0)::float8 AS "tongDon",
                           to_char(MIN("createdAt") + interval '7 hours','YYYY-MM-DD') AS dau,
                           to_char(MAX("createdAt") + interval '7 hours','YYYY-MM-DD') AS cuoi
                    FROM "OnlineOrder" WHERE ${COND}`)
                const row = (stat as any[])[0] || {}
                if ((row.n || 0) > 0 && !dryRun) {
                    await sp.$executeRawUnsafe(
                        `UPDATE "OnlineOrder"
                         SET "platformFee" = 0, "platformFeeRate" = 0, "netRevenue" = 0
                         WHERE ${COND}`)
                }
                out.push({ store: store.code, ...row })
            } catch (e: any) {
                out.push({ store: store.code, error: e?.message })
            }
        }
        res.json({ success: true, dryRun, data: out })
    } catch (err: any) {
        console.error('Admin clean-fake-fees error:', err)
        res.status(500).json({ success: false, error: err?.message || 'Internal server error' })
    }
})

// ─── GET /admin/shopee-escrow ────────────────────────────────────────────────
// CHỈ ĐỌC: gọi thẳng get_escrow_detail của Shopee cho 1 đơn và trả NGUYÊN VĂN
// phần order_income, để xem sàn thực sự đưa những khoản phí nào ở từng trạng
// thái đơn (đơn chưa hoàn tất vẫn có phí giao dịch — đừng đoán, phải nhìn).
// ?storeCode=KENGISTORE&orderSn=xxx (bỏ tiền tố SPE-)
router.get('/shopee-escrow', async (req: Request, res: Response) => {
    try {
        const { ShopeeService } = await import('../services/platforms')
        const storeCode = String(req.query.storeCode || '').trim()
        const orderSn = String(req.query.orderSn || '').replace(/^SPE-/i, '').trim()
        if (!storeCode || !orderSn) { res.status(400).json({ success: false, error: 'Thiếu storeCode/orderSn' }); return }
        const store = await prisma.store.findFirst({ where: { code: storeCode }, select: { schema: true } })
        if (!store) { res.status(404).json({ success: false, error: 'Không tìm thấy cửa hàng' }); return }
        const sp = getStorePrisma(store.schema) as any

        const order = await sp.onlineOrder.findFirst({
            where: { OR: [{ externalOrderId: orderSn }, { externalOrderId: `SPE-${orderSn}` }, { orderNumber: { contains: orderSn } }] },
            select: { channelId: true, status: true, total: true, platformFee: true, orderNumber: true },
        })
        const channel = await sp.onlineChannel.findFirst({
            where: order?.channelId ? { id: order.channelId } : { platform: 'shopee', status: 'active' },
        })
        if (!channel) { res.status(404).json({ success: false, error: 'Không có kênh Shopee' }); return }

        const svc = new ShopeeService({
            apiKey: channel.apiKey || '', apiSecret: channel.apiSecret || '',
            accessToken: channel.accessToken || undefined, refreshToken: channel.refreshToken || undefined,
            shopId: channel.shopId || undefined,
        })
        const raw = await (svc as any).httpGet(
            (svc as any).apiUrl('/api/v2/payment/get_escrow_detail') + `&order_sn=${orderSn}`)
        res.json({
            success: true,
            data: {
                donTrongHeThong: order || null,
                kenh: channel.name,
                shopeeError: raw?.error || null,
                shopeeMessage: raw?.message || null,
                orderIncome: raw?.response?.order_income ?? null,
                buyerPaymentInfo: raw?.response?.buyer_payment_info ?? null,
            },
        })
    } catch (err: any) {
        console.error('Admin shopee-escrow error:', err)
        res.status(500).json({ success: false, error: err?.message || 'Internal server error' })
    }
})

// ─── POST /admin/clean-dup-mappings ──────────────────────────────────────────
// DỌN ÁNH XẠ SKU TRÙNG. Ràng buộc duy nhất (platformSku, platform) KHÔNG chặn
// được khi platform = NULL — Postgres coi mọi NULL là khác nhau — nên lệnh gộp
// dùng ON CONFLICT không bao giờ trúng và mỗi lần chạy lại đẻ thêm một dòng.
// Hậu quả: đơn về lấy nhằm dòng nào thì theo hệ số dòng đó → trừ kho sai ngẫu nhiên.
// Giữ lại: dòng có hệ số KHỚP mergedRate của sản phẩm mang mã đó; không có thì
// giữ hệ số lớn nhất; hoà thì giữ dòng mới nhất.
// Body: { storeCode?, dryRun } — dryRun mặc định TRUE.
router.post('/clean-dup-mappings', async (req: Request, res: Response) => {
    try {
        const b = req.body || {}
        const storeCode = String(b.storeCode || '').trim()
        const dryRun = b.dryRun !== false && b.dryRun !== 'false'
        const stores = await prisma.store.findMany({
            where: { status: 'active', ...(storeCode ? { code: storeCode } : {}) },
            select: { code: true, schema: true },
        })
        const RANKED = `
            SELECT m.id, LOWER(TRIM(m."platformSku")) AS k, m."conversionRate" AS rate,
                   ROW_NUMBER() OVER (
                       PARTITION BY LOWER(TRIM(m."platformSku"))
                       ORDER BY (CASE WHEN p."mergedRate" IS NOT NULL
                                       AND ABS(COALESCE(m."conversionRate",1) - p."mergedRate") < 0.001
                                      THEN 0 ELSE 1 END),
                                COALESCE(m."conversionRate",1) DESC,
                                m."createdAt" DESC
                   ) AS rn
            FROM "SkuMapping" m
            LEFT JOIN "Product" p ON LOWER(TRIM(p.sku)) = LOWER(TRIM(m."platformSku"))
            WHERE m.platform IS NULL`
        const out: any[] = []
        for (const store of stores) {
            const sp = getStorePrisma(store.schema) as any
            try {
                const dups = await sp.$queryRawUnsafe(
                    `SELECT k, COUNT(*)::int AS n, array_agg(rate ORDER BY rn) AS rates
                     FROM (${RANKED}) x GROUP BY k HAVING COUNT(*) > 1 ORDER BY 2 DESC`)
                const rows = dups as any[]
                if (rows.length > 0 && !dryRun) {
                    await sp.$executeRawUnsafe(
                        `DELETE FROM "SkuMapping" WHERE id IN (SELECT id FROM (${RANKED}) x WHERE rn > 1)`)
                    // Chặn tái diễn: chỉ mục duy nhất RIÊNG cho nhóm platform IS NULL
                    await sp.$executeRawUnsafe(
                        `CREATE UNIQUE INDEX IF NOT EXISTS "SkuMapping_sku_null_platform_key"
                         ON "SkuMapping" (LOWER(TRIM("platformSku"))) WHERE platform IS NULL`)
                }
                out.push({
                    store: store.code,
                    maTrung: rows.length,
                    dongSeXoa: rows.reduce((a: number, r: any) => a + (r.n - 1), 0),
                    chiTiet: rows.slice(0, 10).map((r: any) => ({ ma: r.k, soDong: r.n, heSo: r.rates })),
                })
            } catch (e: any) {
                out.push({ store: store.code, error: e?.message })
            }
        }
        res.json({ success: true, dryRun, data: out })
    } catch (err: any) {
        console.error('Admin clean-dup-mappings error:', err)
        res.status(500).json({ success: false, error: err?.message || 'Internal server error' })
    }
})

// ─── POST /admin/sync-fees ───────────────────────────────────────────────────
// ĐỐI SOÁT PHÍ SÀN thật (escrow Shopee) cho các đơn CHƯA có phí. Chạy theo LÔ
// (limit) để không đụng trần 300s của Cloud Run — gọi lặp tới khi hết.
// Body: { storeCode, limit? }
router.post('/sync-fees', async (req: Request, res: Response) => {
    try {
        const { ShopeeService } = await import('../services/platforms')
        const b = req.body || {}
        const storeCode = String(b.storeCode || '').trim()
        const limit = Math.min(Math.max(1, Number(b.limit) || 300), 800)
        if (!storeCode) { res.status(400).json({ success: false, error: 'Thiếu storeCode' }); return }
        const store = await prisma.store.findFirst({ where: { code: storeCode }, select: { schema: true } })
        if (!store) { res.status(404).json({ success: false, error: 'Không tìm thấy cửa hàng' }); return }
        const sp = getStorePrisma(store.schema) as any

        const channels = await sp.onlineChannel.findMany({
            where: { platform: 'shopee', status: 'active', accessToken: { not: null } },
        })
        const out: any[] = []
        const batDau = Date.now()
        for (const ch of channels) {
            const svc = new ShopeeService({
                apiKey: ch.apiKey || '', apiSecret: ch.apiSecret || '',
                accessToken: ch.accessToken || undefined, refreshToken: ch.refreshToken || undefined,
                shopId: ch.shopId || undefined,
            })
            const orders = await sp.onlineOrder.findMany({
                where: {
                    channelId: ch.id, platformFee: 0,
                    status: { notIn: ['cancelled', 'CANCELLED', 'UNPAID'] },
                    externalOrderId: { not: null },
                },
                select: { id: true, externalOrderId: true },
                orderBy: { createdAt: 'desc' },
                take: limit,
            })
            let ok = 0, chuaCo = 0, loi = 0
            // 6 LUỒNG song song: tuần tự thì mỗi đơn ~1 giây, 800 đơn không bao giờ
            // quét hết trong 230s. Giữ ở 6 (đúng mức lệnh đối soát bên giao diện đã
            // chạy ổn) — đẩy cao hơn có nguy cơ Shopee/CSF chặn IP như đợt livestream.
            await mapWithConcurrency(orders, async (o: any) => {
                if (Date.now() - batDau > 230_000) return   // chừa chỗ trả lời
                const sn = (o.externalOrderId || '').replace(/^SPE-/i, '')
                if (!sn) { chuaCo++; return }
                try {
                    const e = await (svc as any).getEscrowDetail(sn)
                    if (e && (e.escrowAmount > 0 || e.totalFees > 0)) {
                        await sp.onlineOrder.update({
                            where: { id: o.id },
                            data: { platformFee: e.totalFees, netRevenue: e.escrowAmount },
                        })
                        ok++
                    } else chuaCo++
                } catch { loi++ }
            }, 6)
            out.push({ kenh: ch.name, quet: orders.length, capNhat: ok, chuaCoDuLieu: chuaCo, loi })
        }
        res.json({ success: true, data: { kenh: out, giay: Math.round((Date.now() - batDau) / 1000) } })
    } catch (err: any) {
        console.error('Admin sync-fees error:', err)
        res.status(500).json({ success: false, error: err?.message || 'Internal server error' })
    }
})

// ─── GET /admin/order-trace?code=… ───────────────────────────────────────────
// CHỈ ĐỌC: tra trọn vòng đời 1 đơn sàn — đơn gốc, phiếu bán, phiếu trả hàng,
// hoá đơn điện tử. Nhận mã đơn sàn có/không prefix (260703PVMJ7K94 hoặc
// SPE-260703PVMJ7K94) lẫn mã phiếu bán (ONLINE-SPE-…).
router.get('/order-trace', async (req: Request, res: Response) => {
    try {
        const storeCode = String(req.query.storeCode || 'KENGISTORE').trim()
        const code = String(req.query.code || '').trim()
        if (!code) { res.status(400).json({ success: false, error: 'thiếu ?code=' }); return }
        const store = await prisma.store.findFirst({ where: { code: storeCode }, select: { schema: true } })
        if (!store) { res.status(404).json({ success: false, error: 'store?' }); return }
        const sp = getStorePrisma(store.schema) as any
        // Khớp lỏng: chứa mã (bỏ mọi prefix ONLINE-/SPE-/TIK-)
        const bare = code.replace(/^ONLINE-/i, '').replace(/^(SPE|TIK)-/i, '')
        const like = `%${bare}%`
        const orders = await sp.$queryRawUnsafe(
            `SELECT o.id, o."orderNumber", o."externalOrderId", o.platform, o.status, o."paymentStatus",
                    o.total, o."createdAt", o."deliveredAt", o."channelId", c.name AS "channelName"
             FROM "OnlineOrder" o LEFT JOIN "OnlineChannel" c ON c.id = o."channelId"
             WHERE o."orderNumber" ILIKE $1 OR o."externalOrderId" ILIKE $1 LIMIT 5`, like)
        const txs = await sp.$queryRawUnsafe(
            `SELECT id, "receiptNumber", status, total, "vatStatus", "vatInvoiceNumber", "createdAt"
             FROM "Transaction" WHERE "receiptNumber" ILIKE $1 LIMIT 5`, like)
        const returns = await sp.$queryRawUnsafe(
            `SELECT id, code, "originalInvoice", status, "refundAmount", "createdAt", "refundedAt"
             FROM "ReturnOrder" WHERE "originalInvoice" ILIKE $1 OR code ILIKE $1 LIMIT 10`, like)
        const invoices = await sp.$queryRawUnsafe(
            `SELECT e.id, e."invoiceNumber", e."invoiceSymbol", e.status, e."totalAmount",
                    e."invoiceDate", e."replacedByInvoiceId", e."transactionId"
             FROM "EInvoice" e JOIN "Transaction" t ON t.id = e."transactionId"
             WHERE t."receiptNumber" ILIKE $1 LIMIT 10`, like)
        res.json({
            success: true,
            data: {
                timKiem: bare,
                donSan: orders, phieuBan: txs, phieuTra: returns, hoaDon: invoices,
                ketLuan: {
                    coDonSan: (orders as any[]).length > 0,
                    /* CÂU HỎI TRUNG TÂM của công cụ này: đơn đã VÀO SỔ chưa.
                     * Thiếu nó thì người dùng phải tự đếm `phieuBan.length` —
                     * đúng việc tôi phải làm bằng tay suốt buổi soát 16/08 khi
                     * kiểm 9 đơn trượt có tự lên phiếu lại không (7/9 lành sau
                     * 3 phút). Đơn đã bán mà thiếu phiếu = doanh thu ngoài sổ. */
                    coPhieuBan: (txs as any[]).length > 0,
                    /* `daVaoSo` NỐI ĐÍCH DANH, không dựa vào `txs.length`.
                     *
                     * Mọi mảng ở trên tìm bằng `ILIKE '%<mã>%'` — khớp mờ, cố ý,
                     * để người dùng gõ thiếu tiền tố vẫn ra. Nhưng một trường
                     * tên "đã vào sổ" mà dựng trên khớp mờ là câu trả lời dứt
                     * khoát đặt trên bằng chứng lỏng: một phiếu của đơn KHÁC có
                     * mã chứa chuỗi này cũng làm nó thành true.
                     *
                     * Quy ước nối là `receiptNumber = 'ONLINE-' || orderNumber`
                     * (xem dedup-by-subtraction-trap) — so đúng bằng nó. */
                    daVaoSo: (orders as any[]).some((o: any) =>
                        (txs as any[]).some((t: any) =>
                            String(t.receiptNumber || '').toUpperCase()
                            === `ONLINE-${String(o.orderNumber || '')}`.toUpperCase())),
                    coTraHang: (returns as any[]).length > 0,
                    daXuatHoaDon: (invoices as any[]).some((i: any) => ['SENT', 'issued', 'SIGNED'].includes(i.status)),
                },
            },
        })
    } catch (err: any) {
        res.status(500).json({ success: false, error: err?.message })
    }
})

// ─── POST /admin/backfill-delivered ──────────────────────────────────────────
// Vá NGÀY KHÁCH NHẬN HÀNG cho đơn SHOPEE (sàn không trả ngày giao trong chi tiết
// đơn → phải lấy từ vận đơn). Hàng đợi xuất HĐ gom theo ngày này nên sai ngày =
// xuất hoá đơn sai kỳ. MẶC ĐỊNH CHẠY THỬ, apply=1 mới ghi.
router.post('/backfill-delivered', async (req: Request, res: Response) => {
    try {
        const storeCode = String(req.query.storeCode || req.body?.storeCode || 'KENGISTORE').trim()
        const days = Math.min(Math.max(1, Number(req.query.days || req.body?.days) || 60), 365)
        const limit = Math.min(Math.max(1, Number(req.query.limit || req.body?.limit) || 200), 1000)
        const apply = String(req.query.apply || req.body?.apply || '') === '1'
        const store = await prisma.store.findFirst({ where: { code: storeCode }, select: { schema: true } })
        if (!store) { res.status(404).json({ success: false, error: 'store?' }); return }
        const sp = getStorePrisma(store.schema) as any
        const since = new Date(Date.now() - days * 86400_000)
        const t0 = Date.now()
        const DEADLINE = 240_000 // Cloud Run 300s — chừa chỗ trả response

        const channels = await sp.onlineChannel.findMany({
            where: { status: 'active', accessToken: { not: null }, platform: 'shopee' },
        })
        const { ShopeeService } = await import('../services/platforms/shopee')
        const out: any[] = []
        for (const ch of channels) {
            const row: any = { channel: ch.name }
            try {
                // Đơn đã giao/hoàn tất mà CHƯA có ngày nhận
                const orders: any[] = await sp.$queryRawUnsafe(
                    `SELECT id, "orderNumber", "externalOrderId", "createdAt"
                     FROM "OnlineOrder"
                     WHERE "channelId" = $1 AND "deliveredAt" IS NULL
                       AND "createdAt" >= $2
                       AND UPPER(status) IN ('DELIVERED','COMPLETED','TO_CONFIRM_RECEIVE')
                     ORDER BY "createdAt" DESC LIMIT ${limit}`, ch.id, since)
                row.donThieuNgay = orders.length
                // ?countOnly=1 — CHỈ ĐẾM, không gọi API sàn (tránh dội Shopee)
                if (String(req.query.countOnly || '') === '1') {
                    const tong: any[] = await sp.$queryRawUnsafe(
                        `SELECT COUNT(*)::int AS n FROM "OnlineOrder"
                         WHERE "channelId" = $1 AND "deliveredAt" IS NULL
                           AND UPPER(status) IN ('DELIVERED','COMPLETED','TO_CONFIRM_RECEIVE')`, ch.id)
                    const daCo: any[] = await sp.$queryRawUnsafe(
                        `SELECT COUNT(*)::int AS n FROM "OnlineOrder"
                         WHERE "channelId" = $1 AND "deliveredAt" IS NOT NULL`, ch.id)
                    row.tongConThieu = tong[0]?.n ?? 0
                    row.daCoNgayNhan = daCo[0]?.n ?? 0
                    out.push(row); continue
                }
                if (!orders.length) { out.push(row); continue }

                const svc = new ShopeeService({
                    apiKey: ch.apiKey || '', apiSecret: ch.apiSecret || '',
                    accessToken: ch.accessToken || undefined, refreshToken: ch.refreshToken || undefined,
                    shopId: ch.shopId || undefined,
                })
                let lay = 0, khongCo = 0, loi = 0, ghi = 0, hetGio = false
                const mau: any[] = []
                // Tuần tự + nghỉ ngắn: API vận đơn gọi từng đơn, bắn ồ ạt dễ dính
                // giới hạn tốc độ của Shopee (đã từng bị chặn IP vì flood).
                for (const o of orders) {
                    if (Date.now() - t0 > DEADLINE) { hetGio = true; break }
                    try {
                        const dt = await svc.getDeliveredTime(String(o.externalOrderId || ''))
                        if (dt) {
                            lay++
                            if (mau.length < 5) mau.push({
                                orderNumber: o.orderNumber,
                                dat: String(o.createdAt).slice(0, 10),
                                nhan: dt.toISOString().slice(0, 16).replace('T', ' '),
                            })
                            if (apply) {
                                await sp.onlineOrder.update({ where: { id: o.id }, data: { deliveredAt: dt } })
                                ghi++
                            }
                        } else khongCo++
                    } catch (e: any) {
                        loi++
                        // Giữ lại lý do lỗi — nuốt im lặng thì không biết vì sao
                        // dừng (hết hạn token? bị chặn tốc độ? đơn không có vận đơn?)
                        if (!row.lyDoLoi) row.lyDoLoi = String(e?.message || e).slice(0, 200)
                    }
                    await new Promise(r => setTimeout(r, 120))
                }
                Object.assign(row, { layDuoc: lay, khongCoDuLieu: khongCo, loi, daGhi: ghi, hetGio, mau })
            } catch (e: any) { row.loi = e?.message }
            out.push(row)
        }
        res.json({ success: true, data: { chayThu: !apply, days, giay: Math.round((Date.now() - t0) / 1000), channels: out } })
    } catch (err: any) {
        res.status(500).json({ success: false, error: err?.message })
    }
})

// ─── GET /admin/shopee-auth-urls ─────────────────────────────────────────────
// Phát link KẾT NỐI LẠI (authorize) cho mọi kênh Shopee của store. Link Shopee
// ký theo timestamp nên CHỈ SỐNG VÀI PHÚT — hết hạn thì gọi lại endpoint này.
// Callback dùng đúng đường sẵn có nên token mới tự ghi đè vào kênh.
router.get('/shopee-auth-urls', async (req: Request, res: Response) => {
    try {
        const storeCode = String(req.query.storeCode || 'KENGISTORE').trim()
        const store = await prisma.store.findFirst({ where: { code: storeCode }, select: { schema: true } })
        if (!store) { res.status(404).json({ success: false, error: 'store?' }); return }
        const sp = getStorePrisma(store.schema) as any
        const channels = await sp.onlineChannel.findMany({
            where: { platform: 'shopee' },
            select: { id: true, name: true, apiKey: true, apiSecret: true, shopId: true, status: true, tokenExpiresAt: true },
        })
        const { ShopeeService } = await import('../services/platforms/shopee')
        const baseUrl = process.env.APP_BASE_URL || 'https://api.kengi.vn'
        const out = channels.map((ch: any) => {
            try {
                const svc = new ShopeeService({ apiKey: ch.apiKey || '', apiSecret: ch.apiSecret || '', shopId: ch.shopId || undefined })
                const redirectUri = `${baseUrl}/api/online-orders/channels/${ch.id}/callback`
                const state = Buffer.from(JSON.stringify({ channelId: ch.id })).toString('base64')
                return {
                    channel: ch.name, channelId: ch.id, shopId: ch.shopId, status: ch.status,
                    tokenHetHan: ch.tokenExpiresAt,
                    authUrl: svc.generateAuthUrl(redirectUri, state),
                }
            } catch (e: any) {
                return { channel: ch.name, channelId: ch.id, loi: e?.message }
            }
        })
        res.json({ success: true, data: { luuY: 'Link ký theo thời gian, chỉ sống vài phút — bấm ngay sau khi lấy', channels: out } })
    } catch (err: any) {
        res.status(500).json({ success: false, error: err?.message })
    }
})

// ─── GET /admin/channel-auth-urls ────────────────────────────────────────────
// Soi cấu hình OAuth của MỌI kênh (hoặc lọc ?platform=lazada): App Key đã lưu
// chưa, URL uỷ quyền sinh ra trông thế nào. Dựng để truy lỗi "Thiếu Tham số"
// bên Lazada — lỗi đó chỉ xảy ra khi client_id rỗng.
// KHÔNG trả App Secret; App Key chỉ trả 4 ký tự cuối (bản đầy đủ nằm trong
// authUrl vì trình duyệt vốn nhìn thấy nó).
router.get('/channel-auth-urls', async (req: Request, res: Response) => {
    try {
        const storeCode = String(req.query.storeCode || 'KENGISTORE').trim()
        const platform = String(req.query.platform || '').trim()
        const store = await prisma.store.findFirst({ where: { code: storeCode }, select: { schema: true } })
        if (!store) { res.status(404).json({ success: false, error: 'store?' }); return }
        const sp = getStorePrisma(store.schema) as any
        const channels = await sp.onlineChannel.findMany({
            where: platform ? { platform } : {},
            select: { id: true, name: true, platform: true, apiKey: true, apiSecret: true, shopId: true, status: true, tokenExpiresAt: true },
        })
        const { getPlatformService } = await import('../services/platforms')
        const baseUrl = process.env.APP_BASE_URL || 'https://api.kengi.vn'
        const out = channels.map((ch: any) => {
            const apiKey = (ch.apiKey || '').trim()
            const apiSecret = (ch.apiSecret || '').trim()
            const info: any = {
                channel: ch.name, channelId: ch.id, platform: ch.platform, status: ch.status,
                apiKeyDaiKyTu: apiKey.length,
                apiKeyDuoi4: apiKey ? apiKey.slice(-4) : null,
                apiSecretDaiKyTu: apiSecret.length,
                tokenHetHan: ch.tokenExpiresAt,
            }
            if (!apiKey || !apiSecret) {
                info.loi = `Thiếu ${[!apiKey && 'App Key', !apiSecret && 'App Secret'].filter(Boolean).join(' và ')} trong DB`
                return info
            }
            try {
                const svc = getPlatformService(ch.platform, { apiKey, apiSecret, shopId: ch.shopId || undefined })
                if (!svc) { info.loi = 'Nền tảng không có tích hợp API'; return info }
                const redirectUri = ch.platform === 'tiktok'
                    ? `${baseUrl}/api/online-orders/tiktok/callback`
                    : `${baseUrl}/api/online-orders/channels/${ch.id}/callback`
                const state = Buffer.from(JSON.stringify({ channelId: ch.id })).toString('base64')
                info.redirectUri = redirectUri
                info.authUrl = svc.generateAuthUrl(redirectUri, state)
            } catch (e: any) {
                info.loi = e?.message
            }
            return info
        })
        res.json({ success: true, data: { channels: out } })
    } catch (err: any) {
        res.status(500).json({ success: false, error: err?.message })
    }
})

// ─── POST /admin/reconcile-refunds ───────────────────────────────────────────
// ĐỐI SOÁT HOÀN TIỀN THEO TỔNG TIỀN ĐƠN (đường vòng khi get_return_list của
// Shopee im lặng — đã xác minh 31/07/2026: API phiếu trả không báo gì sau 14/07
// nhưng get_order_detail vẫn trừ đúng khoản khách trả vào total_amount).
// So tổng tiền Shopee hiện tại với tổng đã lưu; thiếu hụt = khách đã được hoàn.
// MẶC ĐỊNH CHẠY THỬ (không ghi) — apply=1 mới tạo phiếu trả.
router.post('/reconcile-refunds', async (req: Request, res: Response) => {
    try {
        const storeCode = String(req.query.storeCode || req.body?.storeCode || 'KENGISTORE').trim()
        const days = Math.min(Math.max(1, Number(req.query.days || req.body?.days) || 30), 180)
        // ĐÃ CHỨNG MINH SAI (31/07/2026): total_amount của Shopee là số khách
        // THỰC TRẢ (đã trừ voucher sàn + xu), còn tổng mình lưu là tiền hàng sau
        // giảm giá shop → 82% đơn "chênh" chỉ vì voucher, KHÔNG phải hoàn tiền.
        // Chạy thử để chẩn đoán thì được; GHI DỮ LIỆU thì cấm.
        const apply = false
        if (String(req.query.apply || req.body?.apply || '') === '1') {
            res.status(400).json({
                success: false,
                error: 'Đã khoá: chênh lệch tổng tiền KHÔNG phải tín hiệu hoàn tiền (đa số là voucher sàn/xu). '
                    + 'Ghi theo cách này sẽ tạo hàng loạt phiếu trả khống.',
            })
            return
        }
        const limit = Math.min(Math.max(1, Number(req.query.limit || req.body?.limit) || 500), 2000)
        const store = await prisma.store.findFirst({ where: { code: storeCode }, select: { schema: true } })
        if (!store) { res.status(404).json({ success: false, error: 'store?' }); return }
        const sp = getStorePrisma(store.schema) as any
        const since = new Date(Date.now() - days * 86400_000)

        const channels = await sp.onlineChannel.findMany({
            where: { status: 'active', accessToken: { not: null }, platform: 'shopee' },
        })
        const { ShopeeService } = await import('../services/platforms/shopee')
        const out: any[] = []
        for (const ch of channels) {
            const row: any = { channel: ch.name }
            try {
                // Đơn đã giao/hoàn tất, CHƯA có phiếu trả nào — chỉ những đơn này
                // mới cần soi (đơn đã có phiếu trả thì đã xử lý rồi).
                const orders: any[] = await sp.$queryRawUnsafe(
                    `SELECT o.id, o."orderNumber", o."externalOrderId", o.total
                     FROM "OnlineOrder" o
                     WHERE o."channelId" = $1
                       AND o."createdAt" >= $2
                       AND UPPER(o.status) IN ('DELIVERED','COMPLETED')
                       AND NOT EXISTS (
                           SELECT 1 FROM "ReturnOrder" ro
                           WHERE ro."originalInvoice" = o."orderNumber"
                              OR o."orderNumber" LIKE '%-' || ro."originalInvoice")
                     ORDER BY o."createdAt" DESC LIMIT ${limit}`, ch.id, since)
                row.donKiemTra = orders.length
                if (!orders.length) { out.push(row); continue }

                const svc = new ShopeeService({
                    apiKey: ch.apiKey || '', apiSecret: ch.apiSecret || '',
                    accessToken: ch.accessToken || undefined, refreshToken: ch.refreshToken || undefined,
                    shopId: ch.shopId || undefined,
                })
                const sns = orders.map(o => String(o.externalOrderId || '').trim()).filter(Boolean)
                const totals = await svc.getOrderTotals(sns)
                row.sanTraVe = Object.keys(totals).length

                const lech: any[] = []
                for (const o of orders) {
                    const sn = String(o.externalOrderId || '')
                    const t = totals[sn]
                    if (!t) continue
                    const daLuu = Number(o.total) || 0
                    const hienTai = t.total
                    // Chênh > 1.000đ mới tính (né lệch làm tròn/phí lặt vặt)
                    if (hienTai > 0 && daLuu - hienTai > 1000) {
                        lech.push({
                            orderNumber: o.orderNumber, sn,
                            daLuu, sanHienTai: hienTai, hoan: daLuu - hienTai,
                            trangThaiSan: t.status,
                            ngayCapNhat: t.updateTime?.toISOString().slice(0, 10),
                        })
                    }
                }
                row.soDonHoanTien = lech.length
                row.tongTienHoan = lech.reduce((s, x) => s + x.hoan, 0)
                row.mau = lech.slice(0, 10)

                if (apply && lech.length) {
                    let taoMoi = 0
                    for (const x of lech) {
                        const code = `RTN-SH-DIFF-${x.sn}`
                        const da = await sp.returnOrder.findFirst({ where: { code } })
                        if (da) continue
                        await sp.returnOrder.create({
                            data: {
                                code,
                                channelId: ch.id,
                                originalInvoice: x.orderNumber,
                                customerName: 'Khách Shopee',
                                reason: 'Khách trả hàng/hoàn tiền (phát hiện qua chênh lệch tổng tiền đơn)',
                                refundMethod: 'platform_refund',
                                refundAmount: x.hoan,
                                totalRefund: x.hoan,
                                status: 'refunded',
                                staffName: 'Đối soát tự động',
                                notes: `[Shopee] Tổng đã lưu ${x.daLuu.toLocaleString('vi-VN')}đ → sàn hiện ${x.sanHienTai.toLocaleString('vi-VN')}đ`
                                    + `\nPhát hiện qua get_order_detail (get_return_list không báo).`,
                                ...(x.ngayCapNhat ? { createdAt: new Date(x.ngayCapNhat) } : {}),
                                refundedAt: new Date(),
                                items: {
                                    create: [{
                                        productName: 'Hàng khách trả (chưa rõ chi tiết)',
                                        quantity: 1, unitPrice: x.hoan,
                                        returnReason: 'Hoàn tiền Shopee', condition: 'used',
                                    }],
                                },
                            },
                        })
                        taoMoi++
                    }
                    row.daTaoPhieu = taoMoi
                }
            } catch (e: any) { row.loi = e?.message }
            out.push(row)
        }
        res.json({ success: true, data: { chayThu: !apply, days, channels: out } })
    } catch (err: any) {
        res.status(500).json({ success: false, error: err?.message })
    }
})

// ─── GET /admin/mailbox-debug?storeCode=&n= ──────────────────────────────────
// CHẨN ĐOÁN: dump nội dung THẬT của thư ngân hàng sau khi chuẩn hoá, kèm kết
// quả từng bước kiểm tra — để biết bộ bóc trượt ở đâu thay vì đoán.
router.get('/mailbox-debug', async (req: Request, res: Response) => {
    try {
        const storeCode = String(req.query.storeCode || 'KENGISTORE').trim()
        const store = await prisma.store.findFirst({ where: { code: storeCode }, select: { schema: true } })
        if (!store) { res.status(404).json({ success: false, error: 'store?' }); return }
        const sp = getStorePrisma(store.schema) as any
        const n = Math.min(30, Math.max(1, Number(req.query.n) || 3))

        const s = await sp.storeSettings.findUnique({ where: { id: 'default' }, select: { mailboxConfig: true } })
        if (!s?.mailboxConfig) { res.json({ success: false, error: 'chua gan hop thu' }); return }
        const cfg = JSON.parse(s.mailboxConfig)

        const { ImapFlow } = require('imapflow') as typeof import('imapflow')
        const { simpleParser } = require('mailparser') as typeof import('mailparser')
        const { htmlToText, parseBankEmail, toFieldMap } = await import('../services/bankEmailParser')
        const { parseEInvoiceEmail } = await import('../services/einvoiceEmailParser')
        // Dump dài để nếu vẫn trượt thì có đủ dữ liệu, khỏi deploy thêm vòng nữa
        const dumpLen = Math.min(6000, Math.max(300, Number(req.query.chars) || 700))
        // ?mode=invoice → soi thư HOÁ ĐƠN (cùng tiêu chí tìm với scan-invoices)
        // thay vì thư ngân hàng, kèm số phiếu pending đang nằm trong DB
        const invoiceMode = String(req.query.mode || '') === 'invoice'
        const ownTaxCode = invoiceMode
            ? await sp.eInvoiceConfig.findFirst({ select: { taxCode: true } })
                .then((c: any) => c?.taxCode || '').catch(() => '')
            : ''
        const pendingInDb = invoiceMode
            ? await sp.expense.findMany({
                where: { status: 'pending' },
                select: { description: true, amount: true, date: true, sourceRef: true, createdAt: true },
                orderBy: { createdAt: 'desc' }, take: 25,
            })
            : undefined
        // MỌI phiếu sinh từ quét hoá đơn, bất kể trạng thái — để phân biệt
        // "không tạo được" với "tạo rồi nhưng bị huỷ/xoá/duyệt mất"
        const invoiceExpensesAll = invoiceMode
            ? await sp.expense.findMany({
                where: { OR: [{ category: 'Hoá đơn đầu vào' }, { sourceRef: { not: null } }] },
                select: { description: true, amount: true, status: true, sourceRef: true, branchId: true, createdAt: true, cancelledAt: true },
                orderBy: { createdAt: 'desc' }, take: 50,
            }).catch((e: any) => [{ loi: e?.message?.slice(0, 200) }])
            : undefined

        const host = (cfg.host || '').trim() || 'imap.gmail.com'
        const client = new ImapFlow({ host, port: 993, secure: true, auth: { user: cfg.user, pass: cfg.pass }, logger: false })
        await client.connect()
        const out: any[] = []
        try {
            const lock = await client.getMailboxLock('INBOX', { readOnly: true })
            try {
                const uids = invoiceMode
                    // ĐÚNG tiêu chí của scan-invoices — lệch tiêu chí là chẩn sai bệnh
                    ? await client.search({
                        since: new Date(Date.now() - 90 * 86400_000),
                        or: [{ subject: 'hóa đơn điện tử' }, { subject: 'hoá đơn điện tử' }, { subject: 'Hoa don dien tu' }],
                    }, { uid: true }) as number[]
                    : await client.search({ from: 'mbbank.com.vn' }, { uid: true }) as number[]
                for (const uid of (uids || []).slice(-n)) {
                    // fetchOne trả `false` khi không có thư — ép kiểu để TS thôi kêu
                    const msg = await client.fetchOne(String(uid), { source: true }, { uid: true }) as any
                    if (!msg || !msg.source) continue
                    const mail = await simpleParser(msg.source)
                    const rawText = mail.text || ''
                    const fromHtml = htmlToText(typeof mail.html === 'string' ? mail.html : '')
                    // Bộ bóc ưu tiên `text` khi dài đủ — dump CẢ HAI để so
                    const used = rawText.trim().length > (invoiceMode ? 60 : 40) ? rawText : fromHtml
                    out.push({
                        subject: mail.subject,
                        from: mail.from?.text,
                        coTextThuan: rawText.trim().length,
                        coHtml: (typeof mail.html === 'string' ? mail.html.length : 0),
                        // Đoạn đầu của bản ĐANG DÙNG — nhìn là biết nhãn/giá trị
                        // có nằm cùng dòng không
                        banDangDung: used.slice(0, dumpLen),
                        // Bản đồ nhãn→giá trị mà bộ bóc ngân hàng thực sự nhìn thấy
                        ...(invoiceMode ? {} : { banDoNhan: toFieldMap((mail.subject || '') + '\n' + used) }),
                        ketQuaBoc: invoiceMode
                            ? parseEInvoiceEmail({
                                subject: mail.subject || '', from: mail.from?.text || '',
                                text: mail.text || '', html: typeof mail.html === 'string' ? mail.html : null,
                                ownTaxCode,
                            })
                            : parseBankEmail({
                                subject: mail.subject || '', from: mail.from?.text || '',
                                text: mail.text || '', html: typeof mail.html === 'string' ? mail.html : null,
                                receivedAt: mail.date || undefined,
                            }),
                    })
                }
            } finally { lock.release() }
        } finally { await client.logout().catch(() => { }) }
        res.json({ success: true, data: out, pendingInDb, invoiceExpensesAll })
    } catch (err: any) {
        res.status(500).json({ success: false, error: err?.message || String(err) })
    }
})

// ─── GET /admin/returns-raw?from=&to=&find= ─────────────────────────────────
// CHỈ ĐỌC: gọi thẳng API trả hàng của sàn, trả về DANH SÁCH THÔ (không ghi DB)
// để đối chiếu "sàn có phiếu mà hệ thống không có". find= lọc theo mã đơn.
router.get('/returns-raw', async (req: Request, res: Response) => {
    try {
        const storeCode = String(req.query.storeCode || 'KENGISTORE').trim()
        const store = await prisma.store.findFirst({ where: { code: storeCode }, select: { schema: true } })
        if (!store) { res.status(404).json({ success: false, error: 'store?' }); return }
        const sp = getStorePrisma(store.schema) as any
        const days = Math.min(Math.max(1, Number(req.query.days) || 45), 180)
        const since = req.query.from ? new Date(String(req.query.from) + 'T00:00:00+07:00')
            : new Date(Date.now() - days * 86400_000)
        const until = req.query.to ? new Date(String(req.query.to) + 'T23:59:59+07:00') : undefined
        const find = String(req.query.find || '').trim().toUpperCase()

        const channels = await sp.onlineChannel.findMany({
            where: { status: 'active', accessToken: { not: null }, platform: { in: ['shopee', 'tiktok'] } },
        })
        const { ShopeeService } = await import('../services/platforms/shopee')
        const { TikTokService } = await import('../services/platforms/tiktok')
        const out: any[] = []
        for (const ch of channels) {
            const creds = {
                apiKey: ch.apiKey || '', apiSecret: ch.apiSecret || '',
                accessToken: ch.accessToken || undefined, refreshToken: ch.refreshToken || undefined,
                shopId: ch.shopId || undefined,
            }
            const svc: any = ch.platform === 'tiktok' ? new TikTokService(creds) : new ShopeeService(creds)
            const row: any = { channel: ch.name, platform: ch.platform }
            try {
                const list: any[] = await svc.fetchReturns({ since, until })
                row.tongSanTraVe = list.length
                // Đối chiếu với DB: phiếu nào sàn có mà mình chưa lưu
                const codes = list.map((r: any) => `${ch.platform === 'tiktok' ? 'RTN-TT-' : 'RTN-SH-'}${r.returnSn}`)
                const co = codes.length ? await sp.$queryRawUnsafe(
                    `SELECT code FROM "ReturnOrder" WHERE code = ANY($1::text[])`, codes) : []
                const coSet = new Set((co as any[]).map((x: any) => x.code))
                row.daCoTrongDB = coSet.size
                row.thieuTrongDB = codes.length - coSet.size
                row.mauThieu = list.filter((r: any, i: number) => !coSet.has(codes[i]))
                    .slice(0, 5).map((r: any) => ({ returnSn: r.returnSn, orderSn: r.orderSn, status: r.status, createTime: r.createTime }))
                if (find) {
                    row.timThay = list.filter((r: any) =>
                        String(r.orderSn || '').toUpperCase().includes(find) ||
                        String(r.returnSn || '').toUpperCase().includes(find))
                }
                // ?dump=1 — in TOÀN BỘ mã đơn sàn trả về (soi xem sàn có báo đơn nào)
                if (String(req.query.dump || '') === '1') {
                    row.tatCa = list.map((r: any) => `${r.orderSn}|${r.returnSn}|${r.status}|${r.createTime instanceof Date ? r.createTime.toISOString().slice(0, 10) : ''}`)
                }
                // ?raw=1 — gọi thẳng get_return_list KHÔNG qua map, xem Shopee trả gì
                if (String(req.query.raw || '') === '1' && ch.platform === 'shopee') {
                    // Dò theo NGÀY TẠO và cả NGÀY CẬP NHẬT — phiếu tạo lâu rồi mà
                    // mới đổi trạng thái sẽ lọt lưới nếu chỉ lọc theo ngày tạo.
                    const field = (String(req.query.timeField || 'create_time') as any)
                    row.thoShopee = await (svc as any).debugReturnList(since, until, field)
                        .catch((e: any) => `LOI ${e?.message}`)
                }
                // ?byStatus=1 — quét từng trạng thái trong khung 14 ngày gần nhất
                if (String(req.query.byStatus || '') === '1' && ch.platform === 'shopee') {
                    row.theoTrangThai = await (svc as any).debugReturnByStatus(since, until)
                        .catch((e: any) => `LOI ${e?.message}`)
                }
                // ?orderRaw=<mã đơn> — dump thô chi tiết đơn + escrow của 1 đơn
                if (req.query.orderRaw && ch.platform === 'shopee') {
                    row.donTho = await (svc as any).debugOrderRaw(String(req.query.orderRaw))
                        .catch((e: any) => `LOI ${e?.message}`)
                }
                // ?returnSn=<mã phiếu> — hỏi thẳng get_return_detail 1 phiếu. Dùng khi
                // Seller Center CÓ phiếu mà get_return_list KHÔNG trả (nghi Shopee đổi
                // hệ case giữa 07/2026): detail ra dữ liệu = list lọc sót; detail báo
                // not-found = case nằm ngoài tầm API v2 cũ.
                if (req.query.returnSn && ch.platform === 'shopee') {
                    row.phieuTho = await (svc as any).getReturnDetail(String(req.query.returnSn))
                        .catch((e: any) => `LOI ${e?.message}`)
                }
                // ?noFilter=1 — gọi get_return_list KHÔNG kèm lọc thời gian. Đo 04/08:
                // lọc create_time/update_time đều mù với case sau ~12/07 dù
                // get_return_detail vẫn thấy case → nghi filter hỏng phía Shopee;
                // nếu bản không-lọc ra case mới thì fix = bỏ lọc server, cắt client.
                if (String(req.query.noFilter || '') === '1' && ch.platform === 'shopee') {
                    try {
                        const url = (svc as any).apiUrl('/api/v2/returns/get_return_list') + `&page_no=1&page_size=50`
                        const data = await (svc as any).httpGet(url)
                        const list = (data.response?.return || []) as any[]
                        row.khongLoc = {
                            soPhieu: list.length, more: data.response?.more,
                            loi: data.error || undefined, message: data.message || undefined,
                            maDon: list.map((r: any) =>
                                `${r.order_sn}|${r.return_sn}|${r.status}|${r.create_time ? new Date(r.create_time * 1000).toISOString().slice(0, 10) : ''}`),
                        }
                    } catch (e: any) { row.khongLoc = `LOI ${e?.message}` }
                }
                // MÂU THUẪN ĐƠN↔PHIẾU: đơn (sync vẫn chạy) nhảy TO_RETURN sau mốc nghi
                // câm mà list phiếu không có case tương ứng → chứng minh sàn còn case
                // mà API returns không nhả, không cần chờ đối chiếu tay Seller Center.
                if (String(req.query.viTri || '') === '1' && ch.platform === 'shopee') {
                    const cutoff = new Date(String(req.query.cutoff || '2026-07-13') + 'T00:00:00+07:00')
                    const donTra = await sp.onlineOrder.findMany({
                        where: {
                            channelId: ch.id,
                            status: { in: ['TO_RETURN', 'returned', 'IN_CANCEL', 'cancelling'] },
                            updatedAt: { gte: cutoff },
                        },
                        select: { orderNumber: true, externalOrderId: true, status: true, updatedAt: true },
                        orderBy: { updatedAt: 'desc' },
                        take: 30,
                    }).catch(() => [])
                    const sanCo = new Set((row.tatCa || []).map((x: string) => x.split('|')[0]))
                    row.donTraThieuPhieu = donTra
                        .filter((o: any) => !sanCo.has((o.externalOrderId || '').replace(/^SPE-/i, '')))
                        .map((o: any) => `${o.orderNumber}|${o.status}|${new Date(o.updatedAt).toISOString().slice(0, 10)}`)
                }
            } catch (e: any) { row.loi = e?.message }
            out.push(row)
        }
        res.json({ success: true, data: { since: since.toISOString(), until: until?.toISOString() || 'nay', channels: out } })
    } catch (err: any) {
        res.status(500).json({ success: false, error: err?.message })
    }
})

// ─── GET /admin/notif-probe ──────────────────────────────────────────────────
// Chẩn đoán thông báo: ?storeCode=… → 5 bản ghi Notification mới nhất;
// &emit=1 tạo một bản ghi loại 'einvoice' để nghiệm thu ĐÚNG đường thật của web
// (poll GET /notifications → toast). SSE đã gỡ 02/09/2026 nên không còn số client.
router.get('/notif-probe', async (req: Request, res: Response) => {
    try {
        const storeCode = String(req.query.storeCode || 'KENGISTORE').trim()
        const store = await prisma.store.findFirst({ where: { code: storeCode }, select: { schema: true } })
        if (!store) { res.status(404).json({ success: false, error: 'store?' }); return }
        const sp = getStorePrisma(store.schema) as any
        const { sendPushToStore, ensureDeviceTokenTable } = await import('./notifications')
        const rows = await sp.notification.findMany({ orderBy: { createdAt: 'desc' }, take: 5 }).catch((e: any) => `LOI: ${e?.message}`)
        const out: any = { schema: store.schema, notifRows: rows }
        // Thiết bị đã đăng ký nhận push FCM
        await ensureDeviceTokenTable(sp)
        out.devices = await sp.$queryRawUnsafe(
            `SELECT LEFT(token, 16) AS token_dau, platform, "updatedAt" FROM "DeviceToken" ORDER BY "updatedAt" DESC LIMIT 10`
        ).catch((e: any) => `LOI: ${e?.message}`)
        // &push=1 → bắn push thật tới các thiết bị đã đăng ký
        if (String(req.query.push || '') === '1') {
            out.pushSent = await sendPushToStore(sp, '🔔 TEST push Kengi',
                `Bắn thử lúc ${new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}`)
        }
        if (String(req.query.emit || '') === '1') {
            out.emitted = await sp.notification.create({
                data: {
                    type: 'einvoice',
                    title: '🧾 TEST đẩy thông báo',
                    message: `Bắn thử lúc ${new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}`,
                },
            }).then(() => 'da tao ban ghi — web se toast trong <=15 giay')
                .catch((e: any) => `LOI: ${e?.message}`)
        }
        // &seed=1 → tạo 3 bản ghi Notification mẫu — worker poll của app Android
        // (chạy mỗi lần mở app) sẽ vẽ chúng qua ĐÚNG code path thông báo mới,
        // dùng để nghiệm thu khay thông báo khi FCM trên máy ảo không deliver.
        if (String(req.query.seed || '') === '1') {
            const gio = new Date().toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })
            const mk = (title: string, message: string) =>
                sp.notification.create({ data: { title, message, type: 'system' } })
                    .then(() => 'ok').catch((e: any) => `LOI: ${e?.message}`)
            out.seeded = [
                await mk('🧾 Xuất hoá đơn thành công', `Hoá đơn số 00123 đã phát hành lúc ${gio}`),
                await mk('📦 Đơn sàn mới', 'Shopee: 2 đơn mới đang chờ xử lý'),
                await mk('⚠️ Tồn kho cảnh báo', 'Bộ sạc nhanh 65W GaN sắp hết hàng (còn 3 cái)'),
            ]
        }
        res.json({ success: true, data: out })
    } catch (err: any) {
        res.status(500).json({ success: false, error: err?.message })
    }
})

// ─── POST /admin/dedupe-device-tokens ────────────────────────────────────────
// Dọn token FCM rơi rớt chéo cửa hàng: một máy đăng nhập lần lượt nhiều store
// để lại token ở mọi schema từng vào → nhận push của cả cửa hàng không còn dùng.
// Luật: MỘT token chỉ ở lại store có "updatedAt" MỚI NHẤT (store đăng nhập gần
// nhất), xoá khỏi các store còn lại. Không mất mát thật: app mở lên là tự đăng
// ký lại vào đúng store đang đăng nhập.
// ?dryRun=1 → chỉ liệt kê, không xoá.
router.post('/dedupe-device-tokens', async (req: Request, res: Response) => {
    try {
        const dryRun = String(req.query.dryRun || '') === '1'
        const { ensureDeviceTokenTable } = await import('./notifications')
        const stores = await prisma.store.findMany({ select: { code: true, schema: true } })

        // Gom (token → danh sách store kèm updatedAt). Tuần tự từng schema: pool
        // Prisma mỗi store rất nhỏ, quét song song là cạn kết nối.
        const map = new Map<string, { code: string; schema: string; updatedAt: Date }[]>()
        for (const s of stores) {
            if (!s.schema) continue
            try {
                const sp = getStorePrisma(s.schema) as any
                await ensureDeviceTokenTable(sp)
                const rows: any[] = await sp.$queryRawUnsafe(`SELECT token, "updatedAt" FROM "DeviceToken"`)
                for (const r of rows) {
                    const list = map.get(r.token) || []
                    list.push({ code: s.code, schema: s.schema, updatedAt: new Date(r.updatedAt) })
                    map.set(r.token, list)
                }
            } catch { /* store chưa có bảng — bỏ qua */ }
        }

        const ketQua: any[] = []
        let daXoa = 0
        for (const [token, list] of map.entries()) {
            if (list.length <= 1) continue
            const giu = list.reduce((a, b) => (b.updatedAt > a.updatedAt ? b : a))
            const xoa = list.filter(x => x.schema !== giu.schema)
            ketQua.push({ token: token.slice(0, 16), giuLai: giu.code, goKhoi: xoa.map(x => x.code) })
            if (!dryRun) {
                for (const x of xoa) {
                    try {
                        const sp = getStorePrisma(x.schema) as any
                        await sp.$executeRawUnsafe(`DELETE FROM "DeviceToken" WHERE token = $1`, token)
                        daXoa++
                    } catch { /* bỏ qua lỗi lẻ */ }
                }
            }
        }
        res.json({ success: true, data: { dryRun, tokenTrungLap: ketQua.length, daXoa, chiTiet: ketQua } })
    } catch (err: any) {
        res.status(500).json({ success: false, error: err?.message })
    }
})

// ─── GET /admin/vnpt-probe ───────────────────────────────────────────────────
// CHỈ ĐỌC: đăng nhập VNPT bằng tài khoản tích hợp rồi dò các đường liệt kê DẢI
// KÝ HIỆU bên hệ biên lai — trả nguyên văn để biết tài khoản có dải nào/tên gì.
router.get('/vnpt-probe', async (req: Request, res: Response) => {
    try {
        const storeCode = String(req.query.storeCode || 'KENGISTORE').trim()
        const store = await prisma.store.findFirst({ where: { code: storeCode }, select: { schema: true } })
        if (!store) { res.status(404).json({ success: false, error: 'store?' }); return }
        const sp = getStorePrisma(store.schema) as any
        const cfg = await sp.eInvoiceConfig.findFirst({ where: { isActive: true } })
        if (!cfg) { res.status(404).json({ success: false, error: 'chưa có cấu hình' }); return }
        // Bộ SAAS mới: đăng nhập qua provider (tự dò gốc api-hst/gateway-hst)
        // rồi tra dải ký hiệu MTT + danh sách hoá đơn gần đây bên pos-api.
        let exx: any = {}; try { exx = JSON.parse(cfg.extra || '{}') } catch { }
        const { VnptProvider } = await import('../services/einvoice/vnpt')
        const pcfg = {
            apiUrl: String(cfg.apiUrl || ''),   // `baseUrl` không phải cột của EInvoiceConfig
            // ?u= thử biến thể username (vd bỏ hậu tố _admin) với password đã lưu.
            // Cột thật của row là apiUsername/apiPassword (+ legacy apiKey/apiSecret);
            // KHÔNG có cột username/password trần — map sai là gửi chuỗi rỗng đi.
            apiKey: String(req.query.u || '') || cfg.apiUsername || cfg.apiKey || exx.username || '',
            apiSecret: cfg.apiPassword || cfg.apiSecret || exx.password || '',
            taxCode: cfg.taxCode || '',
            templateId: cfg.templateId || '',
            serialNo: cfg.serialNo || '',
            extra: cfg.extra || '',
        }
        const provider = new VnptProvider()
        let session: any
        try {
            session = await provider.login(pcfg)
        } catch (e: any) {
            res.json({ success: true, data: { loginLoi: e?.message } }); return
        }
        const out: any = { root: session.root, clientIdCo: !!session.clientId }
        const hdrs = { 'Content-Type': 'application/json', Authorization: session.token, 'Client-Id': session.clientId }
        // ?mode=tc: dò giá trị type_cert hợp lệ cho "không ký số" — gửi HDons RỖNG
        // nên không thể phát hành thật; chỉ xem thông báo lỗi đổi thế nào.
        // ?mode=dl&fkey=…: xem THÔ download-by-fkeys trả gì với từng typeDownload
        // (để biết shape thật mà nhận diện file, không đoán mò).
        if (String(req.query.mode || '') === 'dl') {
            const fkey = String(req.query.fkey || '')
            for (const t of [1, 2, 3]) {
                try {
                    const r = await fetch(`${session.root}/pos-api/api/v1/saas/portal/download-by-fkeys`, {
                        method: 'POST', headers: hdrs, body: JSON.stringify({ typeDownload: t, lstFkey: [fkey] }),
                    })
                    out[`dl${t}`] = { status: r.status, body: (await r.text()).slice(0, 350) }
                } catch (e: any) { out[`dl${t}`] = { loi: e?.message } }
            }
            try {
                const r = await fetch(`${session.root}/pos-api/api/v1/saas/portal/get-pos-by-fkey`, {
                    method: 'POST', headers: hdrs, body: JSON.stringify({ fkey }),
                })
                out.detail = { status: r.status, body: (await r.text()).slice(0, 500) }
            } catch (e: any) { out.detail = { loi: e?.message } }
            res.json({ success: true, data: out }); return
        }
        if (String(req.query.mode || '') === 'tc') {
            const cands: (string | null)[] = [null, '', 'NONE', 'NOSIGN', 'KHONGKYSO', 'KCS', 'TOKEN', 'HSM', 'ESEAL', 'SMARTCA']
            for (const tc of cands) {
                const body: any = { KHMSHDon: 2, KHHDon: 'C26MNH', HDons: [] }
                if (tc !== null) { body.type_cert = tc; body.serial_number = '' }
                try {
                    const r = await fetch(`${session.root}/pos-api/api/v1/saas/posinvoice/create-and-publish`, {
                        method: 'POST', headers: hdrs, body: JSON.stringify(body),
                    })
                    out[`tc:${tc === null ? '(bo trong)' : tc || '(rong)'}`] = (await r.text()).slice(0, 160)
                } catch (e: any) { out[`tc:${tc}`] = e?.message }
            }
            res.json({ success: true, data: out }); return
        }
        const probes: [string, string, any][] = [
            // Chứng thư số của đơn vị — lấy serial cho type_cert HSM/ESEAL
            ['caConfig', `${session.root}/admin-api/api/v1/saas/ca-config/findAll?page=0&size=10`, {}],
            ['sysConfig', `${session.root}/admin-api/admin-api/api/v1/saas/orgs/get-system-config`, null],
            ['sysConfig2', `${session.root}/admin-api/api/v1/saas/orgs/get-system-config`, null],
            ['symbolGets', `${session.root}/pos-api/api/v1/saas/symbol/gets?page=0&size=20`, {}],
            ['listByDate', `${session.root}/pos-api/api/v1/saas/portal/get-list-by-date?page=0&size=3`, {
                startDate: new Date(Date.now() - 30 * 86400_000).toISOString(),
                endDate: new Date().toISOString(),
            }],
            ['orgInfo', `${session.root}/admin-api/api/v1/saas/orgs/info`, null],
        ]
        for (const [name, url, body] of probes) {
            try {
                const r = await fetch(url, {
                    method: body === null ? 'GET' : 'POST',
                    headers: hdrs,
                    body: body === null ? undefined : JSON.stringify(body),
                })
                out[name] = { status: r.status, body: (await r.text()).slice(0, 800) }
            } catch (e: any) { out[name] = { loi: e?.message } }
        }
        res.json({ success: true, data: out })
    } catch (err: any) {
        res.status(500).json({ success: false, error: err?.message })
    }
})

// ─── GET /admin/debt-trace?storeCode=&phieu= ────────────────────────────────
/**
 * CHỈ ĐỌC: tái hiện đúng con số "Nợ cũ" mà nút In hoá đơn sẽ in ra cho một
 * phiếu — cùng hàm dựng lịch sử (`buildDebtHistory`) và cùng phép tìm dòng
 * như FE (`printReceipt.ts` → noCuTruocHoaDon). Có nó vì khi người dùng báo
 * "nợ cũ in sai" thì phải nhìn được từng dòng sổ quanh phiếu đó, thay vì
 * đoán mò trong thuật toán.
 */
/**
 * GET /admin/kiotviet-no-ncc?storeCode=HUTI[&apply=1]
 *
 * ĐỐI CHIẾU CÔNG NỢ PHẢI TRẢ NCC (Supplier.payable) VỚI KIOTVIET — chỉ đọc; apply=1 sửa.
 * Cùng bệnh với công nợ khách (xem /kiotviet-no-khach, 18/08/2026: 39 khách / 857,7tr
 * giấu): payable cũng đồng bộ với luật `!existing.payable || overwritePrices`. Khác một
 * điểm: NCC ít (vài chục) và KV có danh sách phân trang mang sẵn `debt`, nên đọc MỘT
 * lượt danh sách rồi so — không cần gọi từng id.
 *
 * Tiện thể trả lời câu còn treo: danh sách KV có mang `debt` không? Nếu KHÔNG, đó là lý
 * do đồng bộ khách (đọc `kv.debt` từ danh sách) không tự sửa được 39 khách kia.
 */
router.get('/kiotviet-no-ncc', async (req: Request, res: Response) => {
    try {
        const storeCode = String(req.query.storeCode || '').trim()
        const store = await prisma.store.findFirst({ where: { code: storeCode }, select: { schema: true, name: true } })
        if (!store) { res.status(404).json({ success: false, error: 'Không tìm thấy cửa hàng' }); return }
        const sp = getStorePrisma(store.schema) as any
        const cfg = await sp.kiotVietConfig.findUnique({ where: { id: 'default' } }).catch(() => null)
        if (!cfg) { res.json({ success: true, ketLuan: 'Cửa hàng chưa cấu hình KiotViet' }); return }
        const { doiChieuNoNcc } = await import('../services/kiotvietRunner')
        const kq = await doiChieuNoNcc(sp, cfg, String(req.query.apply || '') === '1')
        res.json({ success: true, cuaHang: store.name, ...kq, danhSachLech: kq.danhSachLech.slice(0, 100),
            ghiChu: 'chenh > 0: KiotViet nói NỢ NCC nhiều hơn Kengi (Kengi giấu nợ phải trả); chenh < 0: Kengi giữ nợ đã trả. Sửa: &apply=1. Cùng hàm với cron đối chiếu 24h.' })
    } catch (err: any) {
        res.status(500).json({ success: false, error: err?.message })
    }
})

/**
 * GET /admin/kiotviet-no-khach?storeCode=HUTI&customerId=<localId>
 *   (hoặc &code=HN73 — mã khách Kengi)
 *
 * HỎI THẲNG KIOTVIET "khách này giờ nợ bao nhiêu" rồi đặt cạnh sổ Kengi. CHỈ ĐỌC,
 * không ghi gì. Sinh ra từ câu chủ shop hỏi 18/08/2026: "sao Phúc Hải (HN73)
 * công nợ 0 mà lịch sử 647 phiếu toàn Bán hàng?" — sổ Kengi neo vào số KiotViet
 * trả về ở lần chứng từ gần nhất (lamTuoiNoKhach), mà lần hỏi đó lỗi thì "giữ
 * số cũ" âm thầm. Đây là cách phân biệt "KiotViet cũng nói 0" với "Kengi cầm số
 * cũ" mà không phải mở KiotViet bằng tay.
 */
router.get('/kiotviet-no-khach', async (req: Request, res: Response) => {
    try {
        const storeCode = String(req.query.storeCode || '').trim()
        const store = await prisma.store.findFirst({ where: { code: storeCode }, select: { schema: true, name: true } })
        if (!store) { res.status(404).json({ success: false, error: 'Không tìm thấy cửa hàng' }); return }
        const sp = getStorePrisma(store.schema) as any
        let localId = String(req.query.customerId || '').trim()
        const code = String(req.query.code || '').trim()
        if (!localId && code) {
            const c = await sp.customer.findFirst({ where: { code }, select: { id: true } })
            localId = c?.id || ''
        }
        /* all=1 — QUÉT TOÀN BỘ khách có ánh xạ KiotViet, chỉ đọc, báo ai lệch. Đi
         * tuần tự có nghỉ 120ms để không đập KiotViet; trần 800 khách/lượt.
         * Đo 18/08: mẫu 12 khách chỉ lệch 1 (Phúc Hải) — nhưng mẫu ≠ toàn bộ. */
        /* all=1 — QUÉT TOÀN BỘ khách có ánh xạ KiotViet (chỉ đọc); all=1&apply=1 — quét
         * xong SỬA LUÔN. Cùng hàm với cron đối chiếu hằng ngày (doiChieuNoKhach). */
        if (String(req.query.all || '') === '1') {
            const cfgAll = await sp.kiotVietConfig.findUnique({ where: { id: 'default' } }).catch(() => null)
            if (!cfgAll) { res.json({ success: true, ketLuan: 'Cửa hàng chưa cấu hình KiotViet' }); return }
            const { doiChieuNoKhach } = await import('../services/kiotvietRunner')
            const kq = await doiChieuNoKhach(sp, cfgAll, String(req.query.apply || '') === '1')
            res.json({ success: true, cuaHang: store.name, ...kq, danhSachLech: kq.danhSachLech.slice(0, 100),
                caiDat: { enabled: cfgAll.enabled, syncCustomers: cfgAll.syncCustomers, overwritePrices: cfgAll.overwritePrices, lastWebhookAt: cfgAll.lastWebhookAt },   // overwritePrices bật = webhook từng ghi đè 0 lên nợ (18/08)
                ghiChu: 'chenh > 0: KiotViet nói nợ NHIỀU hơn Kengi (Kengi đang giấu nợ); chenh < 0: KiotViet nói ít hơn (khách trả dư / đã trả). Sửa hàng loạt: &apply=1.' })
            return
        }
        if (!localId) { res.status(400).json({ success: false, error: 'Cần customerId hoặc code' }); return }
        const kh = await sp.customer.findUnique({ where: { id: localId }, select: { id: true, code: true, name: true, debt: true, updatedAt: true } })
        if (!kh) { res.status(404).json({ success: false, error: 'Không tìm thấy khách' }); return }
        const map = await sp.kiotVietMap.findFirst({ where: { entity: 'customer', localId }, select: { kvId: true, kvCode: true, syncedAt: true } })
        if (!map) {
            res.json({ success: true, khach: kh, ketLuan: 'Khách này KHÔNG có ánh xạ KiotViet — sổ Kengi là nguồn duy nhất, không có gì để đối chiếu' })
            return
        }
        const cfg = await sp.kiotVietConfig.findUnique({ where: { id: 'default' } }).catch(() => null)
        if (!cfg) { res.json({ success: true, khach: kh, kvId: map.kvId, ketLuan: 'Cửa hàng chưa cấu hình KiotViet' }); return }
        const { credsOf } = await import('../services/kiotvietRunner')
        const { KV } = await import('../services/kiotviet')
        let kvDebt: number | null = null, kvName: string | null = null, loiKV: string | null = null
        try {
            const kv: any = await KV.customerById(credsOf(cfg), map.kvId)
            const d = kv?.debt ?? kv?.data?.debt
            kvDebt = Number.isFinite(Number(d)) ? Number(d) : null
            kvName = kv?.name ?? kv?.data?.name ?? null
        } catch (e: any) { loiKV = String(e?.message || e).slice(0, 200) }
        const kengiDebt = Number(kh.debt) || 0
        const khop = kvDebt !== null && Math.abs(kvDebt - kengiDebt) <= 1
        /* apply=1 — ÉP LÀM TƯƠI bằng đúng hàm hệ thống dùng khi có chứng từ
         * (lamTuoiNoKhach: hỏi KV rồi ghi, không cộng trừ). Chỉ ghi khi lệch. */
        let daLamTuoi: any = null
        if (String(req.query.apply || '') === '1' && !khop && kvDebt !== null && !loiKV) {
            const { lamTuoiNoKhach } = await import('../services/kiotvietSync')
            await lamTuoiNoKhach(sp, { creds: credsOf(cfg), apply: true } as any, map.kvId)
            const sau = await sp.customer.findUnique({ where: { id: localId }, select: { debt: true } })
            daLamTuoi = { truoc: kengiDebt, sau: Number(sau?.debt) || 0, thanhCong: Math.abs((Number(sau?.debt) || 0) - kvDebt) <= 1 }
            console.log(`[admin] làm tươi nợ ${kh.code} từ KiotViet: ${kengiDebt} → ${daLamTuoi.sau} (KV ${kvDebt})`)
        }
        res.json({
            success: true,
            khach: { id: kh.id, code: kh.code, name: kh.name, kengiDebt, kengiUpdatedAt: kh.updatedAt },
            kiotviet: { kvId: map.kvId, kvCode: map.kvCode, kvName, kvDebt, loi: loiKV, mapSyncedAt: map.syncedAt },
            khop, daLamTuoi,
            ketLuan: loiKV ? 'Không hỏi được KiotViet lúc này — chưa kết luận được'
                : kvDebt === null ? 'KiotViet không trả trường debt — chưa kết luận được'
                    : khop ? 'KiotViet cũng nói đúng số này — sổ Kengi ĐÚNG'
                        : `LỆCH: KiotViet nói ${kvDebt.toLocaleString('vi-VN')} còn Kengi giữ ${kengiDebt.toLocaleString('vi-VN')} — lần làm tươi gần nhất có thể đã lỗi; chạy lại đồng bộ khách để cập nhật`,
        })
    } catch (err: any) {
        res.status(500).json({ success: false, error: err?.message })
    }
})

router.get('/debt-trace', async (req: Request, res: Response) => {
    try {
        const storeCode = String(req.query.storeCode || '').trim()
        const phieu = String(req.query.phieu || '').trim()
        if (!storeCode || !phieu) return res.status(400).json({ success: false, error: 'Thiếu storeCode hoặc phieu' })
        const store = await prisma.store.findFirst({
            where: { code: { equals: storeCode, mode: 'insensitive' } }, select: { schema: true },
        })
        if (!store) return res.status(404).json({ success: false, error: 'Không tìm thấy cửa hàng' })
        const sp: any = getStorePrisma(store.schema)

        const t = await sp.transaction.findFirst({
            where: { receiptNumber: phieu },
            select: {
                id: true, receiptNumber: true, customerId: true, customerName: true,
                total: true, amountReceived: true, status: true, createdAt: true,
            },
        })
        if (!t) return res.status(404).json({ success: false, error: `Không thấy phiếu ${phieu}` })
        if (!t.customerId) {
            return res.json({ success: true, transaction: t, noCuSeIn: 0, ghiChu: 'Phiếu không gắn khách — FE in nợ cũ 0' })
        }

        const { buildDebtHistory } = await import('./customers')
        const { customer, history } = await buildDebtHistory(sp, t.customerId)

        // Đúng phép tìm của FE: dòng Bán hàng của CHÍNH phiếu, khớp id trước rồi tới code
        const row = history.find((r: any) => r?.type === 'sale' &&
            (r.id === t.id || (t.receiptNumber && r.code === t.receiptNumber)))
        const debtAmount = t.status === 'partial' ? Math.max(0, t.total - (t.amountReceived ?? 0)) : 0
        const noCu = row && typeof row.balance === 'number'
            ? row.balance - (Number(row.amount) || 0)
            : (customer ? (customer.debt ?? 0) - debtAmount : 0)

        const idx = row ? history.indexOf(row) : -1
        return res.json({
            success: true,
            transaction: t,
            customerDebt: customer?.debt ?? null,
            // Neo phải khớp: dòng mới nhất (history[0] vì đã đảo) = đúng số dư hiện tại
            neoKhop: history.length ? Math.abs((history[0].balance ?? 0) - (customer?.debt ?? 0)) <= 1 : null,
            /* TÓM TẮT SỔ — để trả lời "sao khách này nợ 0 mà lịch sử toàn Bán hàng?"
             * (câu chủ shop hỏi 18/08 về Phúc Hải HN73, 647 dòng). Số dư ở đây NEO
             * vào Customer.debt (KiotViet trả về mỗi lần có chứng từ, xem
             * lamTuoiNoKhach) rồi chạy ngược; nếu Σbán − Σthu ≠ debt thì sổ Kengi
             * THIẾU chứng từ (thường là phiếu thu gộp chưa đồng bộ) — số dư lịch sử
             * chạy âm là dấu hiệu, KHÔNG phải khách nợ thật. */
            tomTat: (() => {
                let soBan = 0, tongBan = 0, soThu = 0, tongThu = 0, soKhac = 0
                for (const h of history as any[]) {
                    const a = Number(h?.amount) || 0
                    if (h?.type === 'sale') { soBan++; tongBan += a }
                    else if (h?.type === 'payment') { soThu++; tongThu += a }
                    else soKhac++
                }
                const soDuSo = Number(customer?.debt) || 0
                return { soBan, tongBan: Math.round(tongBan), soThu, tongThu: Math.round(tongThu), soKhac,
                    chenhBanTru: Math.round(tongBan - tongThu), soDuSo,
                    soThieuTrongSo: Math.round((tongBan - tongThu) - soDuSo),
                    ghiChu: Math.abs((tongBan - tongThu) - soDuSo) > 1000
                        ? 'Σbán − Σthu KHÁC số dư sổ ⇒ sổ Kengi thiếu chứng từ (phiếu thu gộp chưa đồng bộ / nợ đầu kỳ). Số dư sổ là của KiotViet — đối chiếu bên KiotViet trước khi kết luận.'
                        : 'Σbán − Σthu khớp số dư sổ.' }
            })(),
            timThayDong: !!row,
            noCuSeIn: Math.round(noCu),
            dongBanHang: row || null,
            // 6 dòng sổ quanh phiếu (mới → cũ) để nhìn bằng mắt
            lanCan: idx >= 0 ? history.slice(Math.max(0, idx - 3), idx + 4) : history.slice(0, 8),
            tongSoDong: history.length,
        })
    } catch (err: any) {
        console.error('debt-trace error:', err)
        res.status(500).json({ success: false, error: err?.message })
    }
})

// ─── GET /admin/repair-trace?storeCode= ─────────────────────────────────────
/**
 * CHỈ ĐỌC: soi vì sao "đổi mới không vào kho hư hỏng" — liệt kê phiếu sửa
 * gần nhất (kèm mốc ghi kho), thẻ kho referenceType='repair', và các dòng
 * tồn của kho hư hỏng (kể cả ÂM — di sản chiều sai trước 10/08).
 */
/**
 * GET /admin/online-status-probe?storeCode=  — CHỈ ĐỌC.
 * Soi đơn online "kẹt" trạng thái: gom theo (sàn, trạng thái Kengi) × tuổi đơn,
 * kèm mẫu đơn cũ nhất mỗi nhóm để đối chiếu với sàn. Đơn chưa kết thúc mà
 * quá 7–14 ngày là dấu hiệu Kengi lệch sàn (webhook trượt / trạng thái lạ
 * không có trong bảng map). Dùng để đo trước khi sửa (19/08/2026).
 */
router.get('/online-status-probe', async (req: Request, res: Response) => {
    try {
        const storeCode = String(req.query.storeCode || '').trim()
        if (!storeCode) return res.status(400).json({ success: false, error: 'Thiếu storeCode' })
        const store = await prisma.store.findFirst({
            where: { code: { equals: storeCode, mode: 'insensitive' } }, select: { schema: true },
        })
        if (!store) return res.status(404).json({ success: false, error: 'Không thấy cửa hàng' })
        const sp: any = getStorePrisma(store.schema)
        const rows: any[] = await sp.$queryRawUnsafe(`
            SELECT o.platform, o.status,
                   COUNT(*)::int AS tong,
                   COUNT(*) FILTER (WHERE o."createdAt" < now() - interval '7 days')::int  AS qua7,
                   COUNT(*) FILTER (WHERE o."createdAt" < now() - interval '14 days')::int AS qua14,
                   COUNT(*) FILTER (WHERE o."createdAt" < now() - interval '30 days')::int AS qua30,
                   MIN(o."createdAt") AS cuNhat,
                   MAX(o."updatedAt") AS capNhatMoiNhat
            FROM "OnlineOrder" o
            GROUP BY o.platform, o.status
            ORDER BY o.platform, tong DESC`)
        // mẫu 3 đơn cũ nhất của mỗi nhóm CHƯA kết thúc
        const ketThuc = ['COMPLETED','CANCELLED','completed','cancelled','TO_RETURN','returned']
        const mau: any[] = await sp.$queryRawUnsafe(`
            SELECT platform, status, "externalStatus", "orderNumber", "createdAt", "updatedAt", "deliveredAt" FROM (
              SELECT o.platform, o.status, o."externalStatus", o."orderNumber", o."createdAt", o."updatedAt", o."deliveredAt",
                     ROW_NUMBER() OVER (PARTITION BY o.platform, o.status ORDER BY o."createdAt")::int AS rn
              FROM "OnlineOrder" o
              WHERE NOT (o.status = ANY($1)) AND o."createdAt" < now() - interval '7 days'
            ) t WHERE rn <= 3 ORDER BY platform, status, "createdAt"`, ketThuc)
        // externalStatus (mã gốc sàn) nào KHÔNG khớp status đã map — nghi map thiếu
        const lech: any[] = await sp.$queryRawUnsafe(`
            SELECT o.platform, o."externalStatus", o.status, COUNT(*)::int AS tong
            FROM "OnlineOrder" o
            WHERE o."externalStatus" IS NOT NULL AND o."externalStatus" <> o.status
            GROUP BY 1,2,3 ORDER BY tong DESC LIMIT 40`)
        res.json({ success: true, theoTrangThai: rows, mauDonCu: mau, maGocKhacMap: lech })
    } catch (err: any) {
        res.status(500).json({ success: false, error: err?.message || String(err) })
    }
})

/**
 * GET /admin/online-live-check?storeCode=&orderNumber=  — CHỈ ĐỌC, không ghi.
 * Hỏi SÀN trạng thái hiện tại của một đơn (getOrderDetail bằng token của kênh)
 * rồi đặt cạnh trạng thái Kengi đang lưu — để phân biệt "Kengi lệch sàn" với
 * "sàn thật sự còn để trạng thái đó" trước khi sửa (19/08/2026).
 */
router.get('/online-live-check', async (req: Request, res: Response) => {
    try {
        const storeCode = String(req.query.storeCode || '').trim()
        const orderNumber = String(req.query.orderNumber || '').trim()
        if (!storeCode || !orderNumber) return res.status(400).json({ success: false, error: 'Thiếu storeCode/orderNumber' })
        const store = await prisma.store.findFirst({
            where: { code: { equals: storeCode, mode: 'insensitive' } }, select: { schema: true },
        })
        if (!store) return res.status(404).json({ success: false, error: 'Không thấy cửa hàng' })
        const sp: any = getStorePrisma(store.schema)
        const o = await sp.onlineOrder.findFirst({ where: { orderNumber }, include: { channel: true } })
        if (!o) return res.status(404).json({ success: false, error: 'Không thấy đơn' })
        const { getPlatformService } = await import('../services/platforms')
        const ch = o.channel
        const svc: any = getPlatformService(ch.platform, {
            apiKey: ch.apiKey || '', apiSecret: ch.apiSecret || '',
            accessToken: ch.accessToken || undefined, refreshToken: ch.refreshToken || undefined,
            shopId: ch.shopId || undefined, shopCipher: (ch as any).shopCipher || undefined,
        } as any)
        if (!svc) return res.status(400).json({ success: false, error: 'Sàn không hỗ trợ' })
        const eid = String(o.externalOrderId || '').replace(/^(SPE-|TIK-|LAZ-)/i, '')
        const live = await svc.getOrderDetail(eid)
        res.json({
            success: true,
            kengi: { status: o.status, externalStatus: o.externalStatus, updatedAt: o.updatedAt, deliveredAt: o.deliveredAt, syncedAt: (o as any).syncedAt },
            san: live ? { status: live.status, externalStatus: live.externalStatus, deliveredAt: live.deliveredAt, shippedAt: live.shippedAt } : null,
            lech: live ? live.status !== o.status : null,
        })
    } catch (err: any) {
        res.status(500).json({ success: false, error: err?.message || String(err) })
    }
})

/**
 * GET /admin/lazada-raw?storeCode=&orderNumber=  — CHỈ ĐỌC, không ghi.
 *
 * Vì sao có (22/08/2026): 44/52 đơn Lazada của KENGISTORE mang externalStatus
 * "confirmed", kể cả đơn đã giao xong từ tháng 3 — mà "confirmed" KHÔNG nằm trong
 * bảng trạng thái Lazada công bố. Bộ nối đang đọc `statuses[0]` ở cấp ĐƠN và bỏ
 * hẳn `status` của từng DÒNG HÀNG mà /order/items/get trả về. Trước khi sửa thì
 * phải NHÌN payload thật đã — đoán rồi map bừa là bịa dữ liệu đơn hàng.
 *
 * Trả về khoá + giá trị thô của /order/get và /order/items/get, có che số điện
 * thoại/địa chỉ vì đây là dữ liệu khách.
 */
router.get('/lazada-raw', async (req: Request, res: Response) => {
    try {
        const storeCode = String(req.query.storeCode || '').trim()
        const orderNumber = String(req.query.orderNumber || '').trim()
        if (!storeCode || !orderNumber) return res.status(400).json({ success: false, error: 'Thiếu storeCode/orderNumber' })
        const store = await prisma.store.findFirst({
            where: { code: { equals: storeCode, mode: 'insensitive' } }, select: { schema: true },
        })
        if (!store) return res.status(404).json({ success: false, error: 'Không thấy cửa hàng' })
        const sp: any = getStorePrisma(store.schema)
        const o = await sp.onlineOrder.findFirst({ where: { orderNumber }, include: { channel: true } })
        if (!o) return res.status(404).json({ success: false, error: 'Không thấy đơn' })
        if (o.channel?.platform !== 'lazada') return res.status(400).json({ success: false, error: 'Đơn này không phải Lazada' })

        const { getPlatformService } = await import('../services/platforms')
        const ch = o.channel
        const svc: any = getPlatformService('lazada', {
            apiKey: ch.apiKey || '', apiSecret: ch.apiSecret || '',
            accessToken: ch.accessToken || undefined, refreshToken: ch.refreshToken || undefined,
            shopId: ch.shopId || undefined,
        } as any)
        const eid = String(o.externalOrderId || '').replace(/^LAZ-/i, '')

        // buildUrl/httpGet là protected — cùng file class nên phải đi qua `as any`.
        const urlDon = svc.buildUrl('/order/get', { order_id: eid })
        const donThoRaw = await svc.httpGet(urlDon)
        const urlHang = svc.buildUrl('/order/items/get', { order_id: eid })
        const hangTho = await svc.httpGet(urlHang)

        const che = (v: any) => typeof v === 'string' && v.length > 4 ? v.slice(0, 2) + '***' : v
        const don = donThoRaw?.data || {}
        const donAnToan: any = {}
        for (const [k, v] of Object.entries(don)) {
            donAnToan[k] = /phone|address|first_name|last_name|email/i.test(k) ? che(v) : v
        }

        const hang = Array.isArray(hangTho?.data) ? hangTho.data : []

        // VẬN ĐƠN — với shop này đây là nguồn DUY NHẤT còn tiến triển: trường trạng
        // thái của Orders API đóng băng ở "confirmed" kể cả đơn J&T đã giao xong.
        let vanDon: any = null
        try {
            const urlTrace = svc.buildUrl('/logistic/order/trace', { order_id: eid })
            const traceTho = await svc.httpGet(urlTrace)
            const modules: any[] = traceTho?.result?.module || traceTho?.data?.module || []
            const sk: any[] = []
            for (const m of modules) {
                for (const pk of (m?.package_detail_info_list || [])) {
                    for (const e of (pk?.logistic_detail_info_list || [])) sk.push(e)
                }
            }
            vanDon = {
                code: traceTho?.code,
                soSuKien: sk.length,
                suKien: sk.map((e: any) => ({
                    status_code: e.status_code,
                    detail_type: e.detail_type,
                    title: e.title,
                    event_time: e.event_time ?? e.receive_time,
                })),
            }
        } catch (e: any) {
            vanDon = { loi: e?.message || String(e) }
        }

        res.json({
            success: true,
            vanDon,
            kengi: { status: o.status, externalStatus: o.externalStatus, deliveredAt: o.deliveredAt },
            donGet: {
                code: donThoRaw?.code,
                khoa: Object.keys(don),
                statuses: don.statuses,
                status: don.status,
                tatCa: donAnToan,
            },
            itemsGet: {
                code: hangTho?.code,
                soDong: hang.length,
                khoaDongDau: hang[0] ? Object.keys(hang[0]) : [],
                trangThaiTungDong: hang.map((it: any) => ({
                    order_item_id: it.order_item_id,
                    sku: it.sku,
                    status: it.status,
                    reason: it.reason,
                    delivered_at: it.delivered_at,
                    shipment_provider: it.shipment_provider,
                })),
            },
        })
    } catch (err: any) {
        res.status(500).json({ success: false, error: err?.message || String(err) })
    }
})

router.get('/repair-trace', async (req: Request, res: Response) => {
    try {
        const storeCode = String(req.query.storeCode || '').trim()
        if (!storeCode) return res.status(400).json({ success: false, error: 'Thiếu storeCode' })
        const store = await prisma.store.findFirst({
            where: { code: { equals: storeCode, mode: 'insensitive' } }, select: { schema: true },
        })
        if (!store) return res.status(404).json({ success: false, error: 'Không thấy cửa hàng' })
        const sp: any = getStorePrisma(store.schema)
        const [phieu, theKho, khoHu] = await Promise.all([
            sp.repair.findMany({
                orderBy: { updatedAt: 'desc' }, take: 12,
                select: {
                    code: true, source: true, status: true, productId: true, productName: true,
                    quantity: true, branchId: true, stockMovedAt: true, replacedStockAt: true,
                    supplierReturnedAt: true, updatedAt: true,
                },
            }),
            sp.inventoryTransaction.findMany({
                where: { referenceType: 'repair' },
                orderBy: { createdAt: 'desc' }, take: 15,
                select: { createdAt: true, productName: true, productSku: true, quantity: true, reason: true },
            }),
            sp.warehouse.findMany({
                where: { type: 'damaged' },
                select: {
                    id: true, code: true, branchId: true, isActive: true,
                    stocks: {
                        where: { quantity: { not: 0 } },
                        select: { quantity: true, productSku: true, productName: true },
                        take: 40,
                    },
                },
            }),
        ])
        res.json({ success: true, phieu, theKho, khoHu })
    } catch (err: any) {
        console.error('repair-trace error:', err)
        res.status(500).json({ success: false, error: err?.message })
    }
})

/* GET /admin/kiotviet-log?store=HUTI&limit=30 — đọc nhật ký đồng bộ KiotViet.
 *
 * Webhook ghi MỘT dòng cho mọi thông báo nhận được (kể cả loại chưa đồng bộ),
 * nên bảng này là chỗ duy nhất trả lời được "webhook có tới mà sao không ra
 * đơn". Log Cloud Run không đủ: handler trả 200 rồi xử lý ngầm, thành công thì
 * im lặng hoàn toàn. */
router.get('/kiotviet-log', async (req: Request, res: Response) => {
    try {
        const code = String(req.query.store || '')
        const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 30))
        if (!code) return res.status(400).json({ success: false, error: 'Cần ?store=' })
        const store = await registryPrisma.store.findFirst({ where: { code } })
        if (!store) return res.status(404).json({ success: false, error: 'Không thấy cửa hàng' })
        const sp = getStorePrisma(store.schema)
        const rows = await sp.kiotVietSyncLog.findMany({
            orderBy: { startedAt: 'desc' }, take: limit,
            select: {
                entity: true, mode: true, status: true, fetched: true, created: true,
                updated: true, skipped: true, failed: true, errors: true, details: true,
                startedAt: true, finishedAt: true,
            },
        })
        res.json({ success: true, data: { cuaHang: code, so: rows.length, dong: rows } })
    } catch (err: any) {
        console.error('kiotviet-log error:', err)
        res.status(500).json({ success: false, error: String(err?.message || err).slice(0, 300) })
    }
})

// ─── POST /admin/tidy-kiotviet-2026?storeCode=&apply= ──────────────────────
/**
 * DỌN SỔ VỀ TỪ 2026 + BỎ GHI CHÚ NGUỒN (người dùng chốt 12/08/2026):
 *  1. Xoá DebtEntry "Trả nợ — phiếu thu TT... (KiotViet)" TRƯỚC 01/01/2026 —
 *     đám phiếu thu mồ côi 2022–2025 nhập từ sổ quỹ KV trong khi hoá đơn
 *     cùng thời chưa từng nhập (ngoài trần 50k) → sao kê toàn phiếu thu
 *     không có hoá đơn xen kẽ. Số dư KHÔNG đổi: neo vẫn là Customer.debt,
 *     phần thiếu dồn vào "Dư nợ đầu kỳ". GIỮ NGUYÊN bảng map debtPayment
 *     để lần đồng bộ sau không tái nhập chúng.
 *  2. Xoá ghi chú "Nhập từ KiotViet (mã ...)" trên hoá đơn đã đồng bộ —
 *     bản in hiện "*GC: ..." người dùng không muốn.
 * apply=false: chỉ đếm.
 */
router.post('/tidy-kiotviet-2026', async (req: Request, res: Response) => {
    try {
        const storeCode = String(req.query.storeCode || '').trim()
        const apply = String(req.query.apply || '') === 'true'
        if (!storeCode) return res.status(400).json({ success: false, error: 'Thiếu storeCode' })
        const store = await prisma.store.findFirst({
            where: { code: { equals: storeCode, mode: 'insensitive' } }, select: { schema: true },
        })
        if (!store) return res.status(404).json({ success: false, error: 'Không thấy cửa hàng' })
        const sp: any = getStorePrisma(store.schema)
        const moc2026 = new Date('2026-01-01T00:00:00.000Z')

        const dkPhieuThuCu = {
            description: { contains: '(KiotViet)' },
            type: 'payment',
            createdAt: { lt: moc2026 },
        }
        const dkGhiChu = { notes: { startsWith: 'Nhập từ KiotViet' } }

        const [soPhieuThuCu, tongTienCu, soGhiChu] = await Promise.all([
            sp.debtEntry.count({ where: dkPhieuThuCu }),
            sp.debtEntry.aggregate({ where: dkPhieuThuCu, _sum: { amount: true } }),
            sp.transaction.count({ where: dkGhiChu }),
        ])

        let daXoa = 0, daXoaGhiChu = 0
        if (apply) {
            daXoa = (await sp.debtEntry.deleteMany({ where: dkPhieuThuCu })).count
            daXoaGhiChu = (await sp.transaction.updateMany({ where: dkGhiChu, data: { notes: null } })).count
        }
        res.json({
            success: true, cheDo: apply ? 'GHI THẬT' : 'dò khô',
            phieuThuCuTruoc2026: soPhieuThuCu,
            tongTienPhieuThuCu: tongTienCu._sum.amount || 0,
            hoaDonCoGhiChu: soGhiChu,
            daXoa, daXoaGhiChu,
        })
    } catch (err: any) {
        console.error('tidy-kiotviet-2026 error:', err)
        res.status(500).json({ success: false, error: err?.message })
    }
})

// ─── POST /admin/fix-kiotviet-discount?storeCode=&apply= ────────────────────
/**
 * VÁ GIẢM GIÁ DÒNG CỦA HOÁ ĐƠN ĐÃ ĐỒNG BỘ TỪ KIOTVIET.
 *
 * KiotViet tính giảm giá theo MỖI ĐƠN VỊ, Kengi theo CẢ DÒNG. Bản sync cũ bê
 * thẳng con số qua nên dòng hàng không cộng ra tổng phiếu (đo HD030345: ba
 * dòng cộng 4.510.104 trong khi tổng là 2.817.040). Bản sync đã sửa, nhưng
 * hoá đơn nhập TRƯỚC đó vẫn sai — route này vá chúng.
 *
 * KHÔNG ĐOÁN. `Transaction.total` lấy thẳng từ `kv.total` nên là số có thẩm
 * quyền; mọi cách sửa đều phải cộng ra đúng nó thì mới ghi:
 *
 *   cầnGiảm = Σ(qty × đơn giá) − (total + giảm giá phiếu)
 *
 * Thử hai cách rồi mới chọn, vì bản cũ lưu `lineTotal` theo hai kiểu khác
 * nhau tuỳ payload có `subTotal` hay không:
 *   A. suy từ lineTotal đã lưu   (payload CÓ subTotal → lineTotal vốn đã đúng)
 *   B. nhân giảm-mỗi-đơn-vị với số lượng (payload KHÔNG có subTotal)
 *
 * Cách nào cộng khớp `cầnGiảm` thì dùng. Không cách nào khớp → BỎ QUA và liệt
 * kê ra, tuyệt đối không ghi bừa lên sổ tiền.
 *
 * apply=false (mặc định) chỉ đọc và đếm.
 */
router.post('/fix-kiotviet-discount', async (req: Request, res: Response) => {
    try {
        const storeCode = String(req.query.storeCode || '').trim()
        const apply = String(req.query.apply || '') === 'true'
        if (!storeCode) return res.status(400).json({ success: false, error: 'Thiếu storeCode' })
        const store = await prisma.store.findFirst({
            where: { code: { equals: storeCode, mode: 'insensitive' } },
            select: { code: true, name: true, schema: true },
        })
        if (!store) return res.status(404).json({ success: false, error: 'Không tìm thấy cửa hàng' })
        const sp: any = getStorePrisma(store.schema)

        // Lọc theo số phiếu để soi kỹ MỘT hoá đơn trước khi ghi cả loạt
        const loc = String(req.query.phieu || '').trim()
        const dsHoaDon = await sp.transaction.findMany({
            where: { createdByName: 'KiotViet Sync', ...(loc ? { receiptNumber: loc } : {}) },
            select: {
                id: true, receiptNumber: true, total: true, discount: true, subtotal: true, createdAt: true,
                items: { select: { id: true, quantity: true, unitPrice: true, discount: true, lineTotal: true } },
            },
        })

        const dem = { tong: dsHoaDon.length, dungSan: 0, vaDuoc: 0, khongVaDuoc: 0, daGhi: 0 }
        const lechTruoc: number[] = []
        const khongVa: any[] = []
        const viDu: any[] = []

        for (const t of dsHoaDon) {
            const items = t.items || []
            if (!items.length) continue
            const gop = items.reduce((s: number, i: any) => s + i.quantity * i.unitPrice, 0)
            const canGiam = gop - (Number(t.total) || 0) - (Number(t.discount) || 0)
            const dangGiam = items.reduce((s: number, i: any) => s + (Number(i.discount) || 0), 0)
            if (Math.abs(dangGiam - canGiam) <= 1) { dem.dungSan++; continue }

            const hopLe = (ds: number[]) =>
                ds.every((d, k) => d >= -1 && d <= items[k].quantity * items[k].unitPrice + 1) &&
                Math.abs(ds.reduce((s, d) => s + d, 0) - canGiam) <= 1

            const cachA = items.map((i: any) => i.quantity * i.unitPrice - (Number(i.lineTotal) || 0))
            const cachB = items.map((i: any) => (Number(i.discount) || 0) * i.quantity)
            const chon = hopLe(cachA) ? cachA : hopLe(cachB) ? cachB : null

            if (!chon) {
                dem.khongVaDuoc++
                if (khongVa.length < 50) {
                    khongVa.push({
                        phieu: t.receiptNumber, tong: t.total, gopDong: Math.round(gop),
                        canGiam: Math.round(canGiam), dangGiam: Math.round(dangGiam),
                        // Ngày chứng từ — để chạy lát rebuild đúng khoảng, khỏi quét
                        // cả 50k trang chỉ vì vài phiếu cũ nằm ngoài cửa sổ
                        ngay: t.createdAt ? new Date(t.createdAt).toISOString().slice(0, 10) : null,
                    })
                }
                continue
            }

            dem.vaDuoc++
            lechTruoc.push(canGiam - dangGiam)
            if (viDu.length < 5) {
                viDu.push({
                    phieu: t.receiptNumber, cach: chon === cachA ? 'A (từ lineTotal)' : 'B (× số lượng)',
                    tong: t.total, gopDong: Math.round(gop), canGiam: Math.round(canGiam),
                    dong: items.map((i: any, k: number) => ({
                        sl: i.quantity, donGia: Math.round(i.unitPrice),
                        giamTruoc: Math.round(i.discount), giamSau: Math.round(chon[k]),
                        dongTruoc: Math.round(i.lineTotal),
                        dongSau: Math.round(i.quantity * i.unitPrice - chon[k]),
                        // Con số NGƯỜI DÙNG thấy: giao diện tự tính lại gộp − giảm,
                        // KHÔNG dùng lineTotal đã lưu. Đây mới là chỗ vỡ.
                        manHinhTruoc: Math.round(i.quantity * i.unitPrice - i.discount),
                    })),
                })
            }
            if (!apply) continue

            await sp.$transaction(async (tx: any) => {
                for (let k = 0; k < items.length; k++) {
                    const i = items[k]
                    const d = Math.round(chon[k])
                    await tx.transactionItem.update({
                        where: { id: i.id },
                        data: { discount: d, lineTotal: i.quantity * i.unitPrice - d },
                    })
                }
                await tx.transaction.update({
                    where: { id: t.id },
                    data: { subtotal: gop - chon.reduce((s: number, d: number) => s + d, 0) },
                })
            })
            dem.daGhi++
        }

        res.json({
            success: true,
            cuaHang: `${store.name} (${store.code})`,
            cheDo: apply ? 'GHI THẬT' : 'dò khô — không ghi gì',
            dem,
            tongMucLech: Math.round(lechTruoc.reduce((s, x) => s + x, 0)),
            viDu,
            khongVaDuoc: khongVa,
        })
    } catch (err: any) {
        console.error('fix-kiotviet-discount error:', err)
        res.status(500).json({ success: false, error: err?.message })
    }
})

/* ═══════════════════════════════════════════════════════════════════════════
 *  CHẠY TAY CÁC CRON THUẾ
 *
 *  Hai cron thuế chạy theo lịch (soát tháng: ngày 16; nhắc hạn: 08:00 hằng
 *  ngày). Không có cách gọi tay thì muốn kiểm chứng trên production phải chờ
 *  đúng ngày đúng giờ — và nếu nó hỏng thì cũng phải chờ tháng sau mới biết đã
 *  sửa được chưa.
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * POST /admin/fix-percent-discount-journal?storeCode=&apply=&from=&to=
 *
 * VÁ BÚT TOÁN GIẢM GIÁ GHI THEO PHẦN TRĂM.
 *
 * Cột `Transaction.discount` là SỐ TIỀN hoặc PHẦN TRĂM tùy `discountType`. Bản
 * ghi sổ tự động trước đây ghi thẳng con số đó vào TK 521, nên đơn giảm 10% bị
 * ghi thành 10 ĐỒNG. Hai hậu quả:
 *   - doanh thu thuần trên sổ cao hơn thực tế;
 *   - bút toán thu tiền lệch, nên số dư TK 111 trôi dần khỏi tiền thật trong két.
 *
 * Mã nguồn đã sửa nên bút toán MỚI ghi đúng; route này vá những bút toán ĐÃ ghi.
 *
 * apply=false (mặc định) chỉ đọc và liệt kê. Chỉ sửa đúng số tiền của bút toán
 * DISC- đã có — không tạo mới, không xóa, không đụng bút toán nào khác.
 */
router.post('/fix-percent-discount-journal', async (req: Request, res: Response) => {
    try {
        const storeCode = String(req.query.storeCode || '').trim()
        const apply = String(req.query.apply || '') === 'true'
        if (!storeCode) return res.status(400).json({ success: false, error: 'Thiếu storeCode' })

        const store = await prisma.store.findFirst({
            where: { code: { equals: storeCode, mode: 'insensitive' } },
            select: { code: true, name: true, schema: true },
        })
        if (!store) return res.status(404).json({ success: false, error: 'Không tìm thấy cửa hàng' })
        const sp: any = getStorePrisma(store.schema)

        const from = String(req.query.from || '').slice(0, 10)
        const to = String(req.query.to || '').slice(0, 10)
        const loc: any = { discountType: 'percent', discount: { gt: 0 } }
        if (/^\d{4}-\d{2}-\d{2}$/.test(from)) loc.createdAt = { gte: new Date(from + 'T00:00:00.000Z') }
        if (/^\d{4}-\d{2}-\d{2}$/.test(to)) {
            loc.createdAt = { ...(loc.createdAt || {}), lte: new Date(to + 'T23:59:59.999Z') }
        }

        const dsGiam = await sp.transaction.findMany({
            where: loc,
            select: { receiptNumber: true, subtotal: true, discount: true, total: true, tax: true, createdAt: true },
        })

        const canSua: any[] = []
        let daSua = 0
        for (const t of dsGiam) {
            const dung = Math.round((t.subtotal || 0) * (t.discount || 0) / 100)
            const bt = await sp.journalEntry.findFirst({
                where: { reference: `DISC-${t.receiptNumber}` },
                select: { id: true, amount: true },
            }).catch(() => null)
            if (!bt) continue
            if (Math.abs((bt.amount || 0) - dung) < 1) continue

            canSua.push({
                phieu: t.receiptNumber,
                ngay: new Date(t.createdAt).toISOString().slice(0, 10),
                giamPhanTram: t.discount,
                dangGhi: Math.round(bt.amount || 0),
                phaiLa: dung,
                lech: dung - Math.round(bt.amount || 0),
            })
            if (apply) {
                await sp.journalEntry.update({ where: { id: bt.id }, data: { amount: dung } })
                daSua++
            }
        }

        res.json({
            success: true,
            data: {
                cuaHang: store.name,
                soDonGiamPhanTram: dsGiam.length,
                soButToanSai: canSua.length,
                tongLech: canSua.reduce((s, x) => s + x.lech, 0),
                daSua: apply ? daSua : 0,
                cheDo: apply ? 'ĐÃ GHI' : 'chỉ xem trước (thêm apply=true để ghi)',
                viDu: canSua.slice(0, 20),
            },
        })
    } catch (err: any) {
        console.error('fix-percent-discount-journal error:', err)
        res.status(500).json({ success: false, error: err?.message })
    }
})

// POST /api/admin/run-tax-audit — chạy ngay vòng soát thuế tháng trước
router.post('/run-tax-audit', async (_req: Request, res: Response) => {
    try {
        const { chaySoatThueNgay } = await import('../cron/taxAuditCron')
        // Chạy nền: quét mọi cửa hàng có thể lâu hơn giới hạn chờ của HTTP
        chaySoatThueNgay().catch(e => console.error('run-tax-audit lỗi:', e))
        res.json({ success: true, message: 'Đã kích hoạt vòng soát thuế — xem tiến độ trong log' })
    } catch (err: any) {
        res.status(500).json({ success: false, error: err?.message })
    }
})

// POST /api/admin/run-tax-deadline-reminder — chạy ngay vòng nhắc hạn nộp
router.post('/run-tax-deadline-reminder', async (_req: Request, res: Response) => {
    try {
        const { chayNhacHanNopNgay } = await import('../cron/taxDeadlineCron')
        chayNhacHanNopNgay().catch(e => console.error('run-tax-deadline-reminder lỗi:', e))
        res.json({ success: true, message: 'Đã kích hoạt vòng nhắc hạn nộp — xem tiến độ trong log' })
    } catch (err: any) {
        res.status(500).json({ success: false, error: err?.message })
    }
})

/**
 * POST /api/admin/backfill-loyalty?apply=1
 *
 * Tính lại điểm tích luỹ từ lịch sử đơn hàng, bù cho quãng thời gian phép cộng
 * điểm ném lỗi âm thầm (ghi nhầm cột `loyaltyTier` thay vì `tier`).
 *
 * Mặc định CHẠY THỬ — chỉ báo sẽ đổi gì. Thêm ?apply=1 mới ghi thật.
 *
 * Chỉ CỘNG THÊM, không bao giờ trừ: một số khách đã được chỉnh điểm tay, và lấy
 * lại điểm khách đang có là chuyện không thể giải thích ở quầy. Lấy giá trị lớn
 * hơn giữa điểm hiện tại và điểm tính từ lịch sử.
 */
router.post('/backfill-loyalty', async (req: Request, res: Response) => {
    try {
        const ghiThat = String((req.query as any)?.apply || '') === '1'
        const stores = await registryPrisma.store.findMany({ where: { status: 'active' } as any }) as any[]
        const ketQua: any[] = []

        // Tuần tự từng cửa hàng — pool mỗi store rất nhỏ.
        for (const store of stores) {
            const sp: any = getStorePrisma(store.schema)
            try {
                /* Gộp bằng SQL, KHÔNG kéo hết đơn về Node: floor theo TỪNG đơn
                 * (đúng luật "1 điểm mỗi 1.000đ của một đơn"), không phải floor
                 * của tổng — hai cách ra số khác nhau. */
                const rows: any[] = await sp.$queryRawUnsafe(
                    `SELECT t."customerId" AS id,
                            COALESCE(SUM(FLOOR(t.total / 1000)), 0)::int AS diem,
                            COALESCE(SUM(t.total), 0)::float8 AS "tongMua"
                     FROM "Transaction" t
                     WHERE t."customerId" IS NOT NULL
                       AND t.status IN ('completed', 'partial')
                     GROUP BY 1`,
                )
                const theoKhach = new Map<string, number>()
                const muaTheoKhach = new Map<string, number>()
                for (const r of rows) {
                    theoKhach.set(String(r.id), Number(r.diem) || 0)
                    muaTheoKhach.set(String(r.id), Number(r.tongMua) || 0)
                }

                const khach = await sp.customer.findMany({
                    where: { id: { in: [...theoKhach.keys()] } },
                    select: { id: true, name: true, loyaltyPoints: true, tier: true, totalPurchases: true },
                })

                /* Đối chiếu luôn cột totalPurchases với tổng đơn thật. Hạng khách
                 * tính từ cột này, nên nếu nó sai thì hạng cũng sai — và không ai
                 * nhìn ra vì không có chỗ nào đối chiếu. */
                let soLechTongMua = 0
                let tongLech = 0
                const vdLech: any[] = []
                for (const k of khach) {
                    const that = muaTheoKhach.get(String(k.id)) || 0
                    const dangLuu = Number(k.totalPurchases) || 0
                    if (Math.abs(that - dangLuu) < 1000) continue
                    soLechTongMua++
                    tongLech += that - dangLuu
                    if (vdLech.length < 3) vdLech.push({ ten: k.name, dangLuu: Math.round(dangLuu), tinhTuDon: Math.round(that) })
                }

                let soDoi = 0, tongThem = 0
                const vd: any[] = []
                for (const k of khach) {
                    const nen = theoKhach.get(String(k.id)) || 0
                    const dangCo = Number(k.loyaltyPoints) || 0
                    const moi = Math.max(dangCo, nen)

                    const luy = Number(k.totalPurchases) || 0
                    const hang = luy >= 50_000_000 ? 'vip' : luy >= 20_000_000 ? 'gold' : luy >= 5_000_000 ? 'silver' : 'bronze'

                    if (moi === dangCo && hang === k.tier) continue
                    soDoi++
                    tongThem += moi - dangCo
                    if (vd.length < 5) vd.push({ ten: k.name, diemCu: dangCo, diemMoi: moi, hangCu: k.tier, hangMoi: hang })
                    if (ghiThat) {
                        await sp.customer.update({
                            where: { id: k.id },
                            data: { loyaltyPoints: moi, tier: hang },
                        }).catch(() => { })
                    }
                }
                ketQua.push({
                    store: store.name, soKhachCoDon: khach.length, soKhachDoi: soDoi,
                    tongDiemThem: tongThem, viDu: vd,
                    tongMuaLech: { soKhach: soLechTongMua, chenh: Math.round(tongLech), viDu: vdLech },
                })
            } catch (e: any) {
                ketQua.push({ store: store.name, loi: String(e?.message || e).slice(0, 200) })
            }
        }

        res.json({
            success: true,
            chayThat: ghiThat,
            message: ghiThat
                ? 'Đã ghi điểm tích luỹ bù cho các cửa hàng'
                : 'CHẠY THỬ — chưa ghi gì. Thêm ?apply=1 để ghi thật.',
            ketQua,
        })
    } catch (err: any) {
        console.error('backfill-loyalty error:', err)
        res.status(500).json({ success: false, error: err?.message })
    }
})

// POST /api/admin/run-weekly-brief — chạy ngay vòng bản tin đầu tuần
router.post('/run-weekly-brief', async (req: Request, res: Response) => {
    try {
        /* ?dryRun=1 — tính đủ nhưng KHÔNG tạo thông báo, chỉ in ra log. Dùng để
         * kiểm hai phép tính nặng (lịch tiền + đặt hàng) trên dữ liệu THẬT mà
         * không làm phiền cửa hàng nào: chạy trên dữ liệu giả không bắt được lỗi
         * truy vấn. */
        const chayThu = String((req.query as any)?.dryRun || '') === '1'
        const { chayBanTinNgay } = await import('../cron/weeklyBriefCron')
        chayBanTinNgay(chayThu).catch(e => console.error('run-weekly-brief lỗi:', e))
        res.json({
            success: true,
            message: chayThu
                ? 'Đã kích hoạt CHẠY THỬ bản tin (không gửi thông báo) — xem kết quả trong log'
                : 'Đã kích hoạt vòng bản tin đầu tuần — xem tiến độ trong log',
        })
    } catch (err: any) {
        res.status(500).json({ success: false, error: err?.message })
    }
})

/**
 * GET /api/admin/reconcile-sweep?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Soát đối chiếu ba chiều cho TOÀN BỘ cửa hàng và trả về một bảng gọn — để
 * người vận hành nhìn một phát biết cửa hàng nào đang lệch thật, thay vì mở
 * từng cửa hàng một.
 *
 * CHỈ ĐỌC, không ghi gì, không gửi thông báo cho ai. Chạy TUẦN TỰ từng cửa hàng
 * vì mỗi lượt đối chiếu là vài truy vấn nặng — bắn song song cả cụm là cạn pool.
 *
 * Cột `duocKetLuan` quan trọng hơn cột số: `false` nghĩa là THIẾU DỮ LIỆU (chưa
 * nhập sao kê, chưa dùng hoá đơn điện tử trên phần mềm), tuyệt đối không đọc
 * thành "cửa hàng này làm sai".
 */
router.get('/reconcile-sweep', async (req: Request, res: Response) => {
    try {
        const { doiChieuBaChieu } = await import('../lib/revenueReconcile')
        const q = req.query as any
        const hopLe = (s: any) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))

        let from: string, to: string
        if (hopLe(q.from) && hopLe(q.to)) { from = String(q.from); to = String(q.to) }
        else {
            const nay = new Date(Date.now() + 7 * 3600_000)
            from = new Date(Date.UTC(nay.getUTCFullYear(), nay.getUTCMonth() - 1, 1)).toISOString().slice(0, 10)
            to = new Date(Date.UTC(nay.getUTCFullYear(), nay.getUTCMonth(), 0)).toISOString().slice(0, 10)
        }

        const stores = await registryPrisma.store.findMany({ select: { name: true, schema: true, code: true } }) as any[]
        const bang: any[] = []

        for (const store of stores) {
            try {
                const kq: any = await doiChieuBaChieu(getStorePrisma(store.schema), {
                    from, to,
                    start: new Date(`${from}T00:00:00+07:00`),
                    end: new Date(new Date(`${to}T00:00:00+07:00`).getTime() + 86400_000),
                    nhan: `${from} → ${to}`,
                })
                bang.push({
                    cuaHang: store.name, ma: store.code,
                    doanhThuSo: kq.soSach.tong,
                    soChungTu: kq.soSach.soChungTu,
                    hoaDonDaXuat: kq.hoaDon.tongCoThue,
                    soHoaDon: kq.hoaDon.soHoaDon,
                    /* Cửa hàng KHÔNG dùng hoá đơn điện tử trên phần mềm thì phép
                     * trừ sổ − hoá đơn không có nghĩa. Trả null thay vì con số,
                     * vì một ô ghi "chưa xuất hoá đơn 5,4 tỷ" sẽ bị đọc thành
                     * cáo buộc — trong khi sự thật chỉ là họ phát hành ở nơi
                     * khác. Ai muốn biết vì sao thì nhìn cột duocKetLuan. */
                    tyLeXuatHoaDon: kq.hoaDon.duocKetLuan ? kq.lech.tyLeXuatHoaDon : null,
                    chuaXuatHoaDon: kq.hoaDon.duocKetLuan ? kq.lech.chuaXuatHoaDon : null,
                    hoaDonVuotSo: kq.hoaDon.duocKetLuan ? kq.lech.hoaDonVuotSo : null,
                    tienVaoChuaGiaiTrinh: kq.dongTien.duocKetLuan ? kq.dongTien.chuaGiaiThich : null,
                    chiTienMatLon: kq.chiTienMatLon.danhSach.length,
                    duocKetLuan: {
                        soSach: kq.soSach.duocKetLuan,
                        hoaDon: kq.hoaDon.duocKetLuan,
                        dongTien: kq.dongTien.duocKetLuan,
                    },
                    ruiRo: kq.ruiRo.map((r: any) => ({ ma: r.ma, muc: r.muc, soTien: r.soTien })),
                    chuaDocDuoc: kq.thieu,
                })
            } catch (e: any) {
                /* Một cửa hàng hỏng không được làm hỏng cả bảng — và phải ghi rõ
                 * là LỖI ĐỌC, không được để trống rồi bị hiểu thành "sạch". */
                bang.push({ cuaHang: store.name, ma: store.code, loi: String(e?.message || e).slice(0, 200) })
            }
        }

        res.json({ success: true, data: { ky: { from, to }, soCuaHang: bang.length, bang } })
    } catch (err: any) {
        console.error('GET /admin/reconcile-sweep error:', err)
        res.status(500).json({ success: false, error: err?.message || 'Internal server error' })
    }
})

/**
 * GET /api/admin/reconcile-why?store=CODE&from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Vì sao một cửa hàng bị báo lệch. Bảng tổng ở /reconcile-sweep chỉ nói CÓ lệch;
 * cái này nói lệch từ đâu ra, để không đi kết luận cửa hàng làm sai trong khi
 * thực ra dữ liệu nằm ở chỗ khác.
 *
 * Trả về: cơ cấu hoá đơn trong kỳ (theo trạng thái, theo loại), bao nhiêu hoá
 * đơn KHÔNG gắn phiếu bán, bao nhiêu gắn vào phiếu KHÔNG TỒN TẠI trong schema
 * này, và cơ cấu phiếu bán theo trạng thái. Kèm vài mẫu để soi tay.
 *
 * CHỈ ĐỌC. Truy vấn tuần tự.
 */
router.get('/reconcile-why', async (req: Request, res: Response) => {
    try {
        const q = req.query as any
        const ma = String(q.store || '').trim()
        if (!ma) return res.status(400).json({ success: false, error: 'Thiếu ?store=<mã cửa hàng>' })
        const hopLe = (s: any) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))
        if (!hopLe(q.from) || !hopLe(q.to)) return res.status(400).json({ success: false, error: 'Cần ?from & ?to dạng YYYY-MM-DD' })
        const from = String(q.from), to = String(q.to)

        const store: any = await registryPrisma.store.findFirst({ where: { code: ma }, select: { name: true, schema: true, code: true } })
        if (!store) return res.status(404).json({ success: false, error: `Không có cửa hàng mã "${ma}"` })
        const p: any = getStorePrisma(store.schema)

        const start = new Date(`${from}T00:00:00+07:00`)
        const end = new Date(new Date(`${to}T00:00:00+07:00`).getTime() + 86400_000)

        const hoaDon: any[] = await p.eInvoice.findMany({
            where: { invoiceDate: { gte: from, lte: to } },
            select: { id: true, invoiceNumber: true, invoiceDate: true, invoiceType: true, status: true, totalAmount: true, transactionId: true },
        })

        const dem = (ds: any[], khoa: string) => ds.reduce((m: any, x: any) => {
            const k = String(x[khoa] ?? '(trống)')
            m[k] = (m[k] || 0) + 1
            return m
        }, {})
        const tong = (ds: any[]) => Math.round(ds.reduce((s: number, x: any) => s + (Number(x.totalAmount) || 0), 0))

        const coGan = hoaDon.filter(h => h.transactionId)
        const khongGan = hoaDon.filter(h => !h.transactionId)

        // Hoá đơn có gắn phiếu bán — phiếu đó có thật trong schema này không?
        const idPhieu = Array.from(new Set(coGan.map(h => String(h.transactionId))))
        const phieuCo: any[] = idPhieu.length
            ? await p.transaction.findMany({ where: { id: { in: idPhieu } }, select: { id: true, status: true, createdAt: true, total: true } })
            : []
        const boPhieu = new Map(phieuCo.map((t: any) => [String(t.id), t]))
        const ganNhungMat = coGan.filter(h => !boPhieu.has(String(h.transactionId)))
        const ganVaCo = coGan.filter(h => boPhieu.has(String(h.transactionId)))

        /* Phiếu có thật nhưng NGÀY nằm ngoài kỳ → hoá đơn kỳ này của hàng bán kỳ
         * trước. Đây là nguyên nhân lệch rất hay gặp và hoàn toàn hợp lệ. */
        const ngoaiKy = ganVaCo.filter(h => {
            const t = boPhieu.get(String(h.transactionId))
            const d = new Date(t.createdAt).getTime()
            return d < start.getTime() || d >= end.getTime()
        })

        const phieuTrongKy: any[] = await p.transaction.findMany({
            where: { createdAt: { gte: start, lt: end } },
            select: { status: true, total: true },
        })

        res.json({
            success: true,
            data: {
                cuaHang: store.name, ma: store.code, ky: { from, to },
                hoaDon: {
                    soLuong: hoaDon.length,
                    tongTien: tong(hoaDon),
                    theoTrangThai: dem(hoaDon, 'status'),
                    theoLoai: dem(hoaDon, 'invoiceType'),
                    khongGanPhieuBan: { so: khongGan.length, tien: tong(khongGan) },
                    ganPhieuKhongTonTai: { so: ganNhungMat.length, tien: tong(ganNhungMat) },
                    ganPhieuNgoaiKy: { so: ngoaiKy.length, tien: tong(ngoaiKy) },
                    mau: hoaDon.slice(0, 5).map(h => ({
                        so: h.invoiceNumber, ngay: h.invoiceDate, loai: h.invoiceType,
                        trangThai: h.status, tien: Math.round(Number(h.totalAmount) || 0),
                        phieuBan: h.transactionId ? (boPhieu.has(String(h.transactionId)) ? 'có' : 'KHÔNG TỒN TẠI') : 'không gắn',
                    })),
                },
                phieuBanTrongKy: {
                    soLuong: phieuTrongKy.length,
                    theoTrangThai: dem(phieuTrongKy, 'status'),
                    tongTheoTrangThai: phieuTrongKy.reduce((m: any, t: any) => {
                        const k = String(t.status)
                        m[k] = Math.round((m[k] || 0) + (Number(t.total) || 0))
                        return m
                    }, {}),
                },
            },
        })
    } catch (err: any) {
        console.error('GET /admin/reconcile-why error:', err)
        res.status(500).json({ success: false, error: err?.message || 'Internal server error' })
    }
})

/**
 * GET /api/admin/einvoice-error-sweep?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Hoá đơn phát hành hỏng của TOÀN BỘ cửa hàng, gom theo nguyên nhân.
 *
 * Hỏng ở đây không phải lỗi kỹ thuật vặt: bán xong mà hoá đơn không ra thì về
 * mặt thuế giống như chưa lập hoá đơn. Trước giờ chúng nằm im trong bảng, không
 * màn hình nào hiện.
 *
 * CHỈ ĐỌC, chạy tuần tự từng cửa hàng.
 */
router.get('/einvoice-error-sweep', async (req: Request, res: Response) => {
    try {
        const q = req.query as any
        const hopLe = (s: any) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))
        const nay = new Date(Date.now() + 7 * 3600_000)
        const from = hopLe(q.from) ? String(q.from)
            : new Date(Date.UTC(nay.getUTCFullYear(), nay.getUTCMonth() - 2, 1)).toISOString().slice(0, 10)
        const to = hopLe(q.to) ? String(q.to) : nay.toISOString().slice(0, 10)

        const chuanHoa = (s: any) => String(s || '(không ghi lý do)')
            .replace(/\d+/g, '#').replace(/\s+/g, ' ').trim().slice(0, 160)

        const stores = await registryPrisma.store.findMany({ select: { name: true, schema: true, code: true } }) as any[]
        const bang: any[] = []

        for (const store of stores) {
            try {
                const p: any = getStorePrisma(store.schema)
                const ds: any[] = await p.eInvoice.findMany({
                    where: { invoiceDate: { gte: from, lte: to }, status: 'ERROR' },
                    select: { invoiceDate: true, totalAmount: true, errorMessage: true },
                    take: 3000,
                })
                if (ds.length === 0) { bang.push({ cuaHang: store.name, ma: store.code, so: 0, tien: 0, nguyenNhan: [] }); continue }
                const nhom = new Map<string, { so: number; tien: number }>()
                for (const h of ds) {
                    const k = chuanHoa(h.errorMessage)
                    const o = nhom.get(k) || { so: 0, tien: 0 }
                    o.so++; o.tien += Number(h.totalAmount) || 0
                    nhom.set(k, o)
                }
                bang.push({
                    cuaHang: store.name, ma: store.code,
                    so: ds.length,
                    tien: Math.round(ds.reduce((s, h) => s + (Number(h.totalAmount) || 0), 0)),
                    nguyenNhan: Array.from(nhom.entries())
                        .map(([lyDo, v]) => ({ lyDo, so: v.so, tien: Math.round(v.tien) }))
                        .sort((a, b) => b.so - a.so).slice(0, 6),
                })
            } catch (e: any) {
                bang.push({ cuaHang: store.name, ma: store.code, loi: String(e?.message || e).slice(0, 200) })
            }
        }

        const tong = bang.filter(b => !b.loi).reduce((s, b) => s + b.so, 0)
        res.json({ success: true, data: { ky: { from, to }, tongSoHoaDonHong: tong, bang } })
    } catch (err: any) {
        console.error('GET /admin/einvoice-error-sweep error:', err)
        res.status(500).json({ success: false, error: err?.message || 'Internal server error' })
    }
})

/**
 * POST /api/admin/einvoice-fkey-repair?store=CODE&from&to&apply=1
 *
 * Ghi bù hàng loạt cho hoá đơn kẹt ở trạng thái ERROR vì "Fkey đã được sử dụng".
 *
 * Câu đó nghĩa là hoá đơn ĐÃ phát hành thành công bên VNPT — lần gửi trước tới
 * đích nhưng phản hồi không về. Bản vá ở tầng phát hành chỉ cứu được các lần
 * SẮP TỚI; những tờ đã kẹt vẫn nằm im và mọi báo cáo vẫn thiếu chúng.
 *
 * MẶC ĐỊNH CHẠY THỬ, KHÔNG GHI GÌ. Phải truyền apply=1 mới thật sự cập nhật.
 * Đây là ghi vào sổ hoá đơn — thứ không có nút hoàn tác — nên phải nhìn kết quả
 * chạy thử trước rồi mới quyết định.
 *
 * Chỉ điền phần CÒN TRỐNG (số hoá đơn, mã tra cứu) và chỉ chuyển sang SENT khi
 * VNPT xác nhận cơ quan thuế đã cấp mã. Không ghi đè dữ liệu đang có.
 */
router.post('/einvoice-fkey-repair', async (req: Request, res: Response) => {
    try {
        const q = req.query as any
        const ma = String(q.store || '').trim()
        if (!ma) return res.status(400).json({ success: false, error: 'Thiếu ?store=<mã cửa hàng>' })
        const apply = String(q.apply || '') === '1'
        const hopLe = (s: any) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))
        const nay = new Date(Date.now() + 7 * 3600_000)
        const from = hopLe(q.from) ? String(q.from)
            : new Date(Date.UTC(nay.getUTCFullYear(), nay.getUTCMonth() - 3, 1)).toISOString().slice(0, 10)
        const to = hopLe(q.to) ? String(q.to) : nay.toISOString().slice(0, 10)
        const tran = Math.min(300, Math.max(1, Number(q.limit) || 200))

        const store: any = await registryPrisma.store.findFirst({ where: { code: ma }, select: { name: true, schema: true, code: true } })
        if (!store) return res.status(404).json({ success: false, error: `Không có cửa hàng mã "${ma}"` })
        const prisma: any = getStorePrisma(store.schema)

        const { getActiveConfig } = await import('./einvoice')
        const cfgRow: any = await getActiveConfig(prisma).catch(() => null)
        if (!cfgRow) return res.status(400).json({ success: false, error: 'Cửa hàng chưa cấu hình nhà cung cấp hoá đơn điện tử' })

        const { VnptProvider, vnptFkey } = await import('../services/einvoice/vnpt')
        const vnpt: any = new (VnptProvider as any)()

        const ds: any[] = await prisma.eInvoice.findMany({
            where: { invoiceDate: { gte: from, lte: to }, status: 'ERROR' },
            select: {
                id: true, invoiceDate: true, totalAmount: true, errorMessage: true, transactionId: true,
                invoiceNumber: true, lookupCode: true, invoiceType: true,
                adjustsInvoiceId: true, replacesInvoiceId: true,
            },
            orderBy: { invoiceDate: 'asc' },
            take: tran,
        })
        const ungVien = ds.filter(h => /fkey/i.test(String(h.errorMessage || '')) && /đã được sử dụng|already/i.test(String(h.errorMessage || '')))

        const ketQua: any[] = []
        let suaDuoc = 0, khongThay = 0
        for (const h of ungVien) {
            // Fkey theo loại hoá đơn — cùng công thức với luồng phát hành
            const fkey = h.invoiceType === 'ADJUSTMENT' && h.adjustsInvoiceId ? vnptFkey(`${h.adjustsInvoiceId}A`)
                : h.invoiceType === 'REPLACEMENT' && h.replacesInvoiceId ? vnptFkey(`${h.replacesInvoiceId}R`)
                    : vnptFkey(h.transactionId || h.id)
            let kq: any
            try { kq = await vnpt.findByFkey(cfgRow, fkey) } catch (e: any) { kq = { found: false, loi: String(e?.message || e) } }

            if (!kq?.found || !kq.invoiceNumber) {
                khongThay++
                ketQua.push({ id: h.id, ngay: h.invoiceDate, tien: Math.round(Number(h.totalAmount) || 0), fkey, ketQua: 'VNPT không trả về hoá đơn' })
                continue
            }
            const data: any = {}
            if (kq.invoiceNumber && !h.invoiceNumber) data.invoiceNumber = kq.invoiceNumber
            if (kq.lookupCode && !h.lookupCode) data.lookupCode = kq.lookupCode
            if (kq.sent) { data.status = 'SENT'; data.sentAt = new Date(); data.errorMessage = null }

            if (apply && Object.keys(data).length) {
                await prisma.eInvoice.update({ where: { id: h.id }, data }).catch(() => { })
            }
            suaDuoc++
            ketQua.push({
                id: h.id, ngay: h.invoiceDate, tien: Math.round(Number(h.totalAmount) || 0), fkey,
                soHoaDon: kq.invoiceNumber, maCQT: kq.lookupCode || null, daGuiCQT: !!kq.sent,
                seCapNhat: Object.keys(data),
                ketQua: apply ? 'đã ghi' : 'sẽ ghi (chạy thử)',
            })
        }

        res.json({
            success: true,
            data: {
                cuaHang: store.name, ma: store.code, ky: { from, to },
                chayThat: apply,
                soHoaDonLoi: ds.length,
                soUngVienTrungFkey: ungVien.length,
                traRaHoaDon: suaDuoc,
                khongTraRa: khongThay,
                chiTiet: ketQua.slice(0, 100),
                ghiChu: apply
                    ? 'Đã ghi bù. Chạy lại báo cáo hoá đơn hỏng để xác nhận.'
                    : 'ĐANG CHẠY THỬ — chưa ghi gì. Xem kỹ rồi thêm apply=1 nếu đồng ý.',
            },
        })
    } catch (err: any) {
        console.error('POST /admin/einvoice-fkey-repair error:', err)
        res.status(500).json({ success: false, error: err?.message || 'Internal server error' })
    }
})

/**
 * GET /api/admin/opportunity-probe?store=CODE&from&to
 *
 * Chạy cỗ máy CƠ HỘI TĂNG TRƯỞNG trên dữ liệu THẬT của một cửa hàng và trả về
 * bản tóm tắt gọn, không kèm bảng chi tiết dài.
 *
 * Vì sao cần: cỗ máy đó có 48 ca test nhưng toàn trên dữ liệu mẫu do chính mình
 * dựng. Dữ liệu mẫu chỉ chứa những tình huống mình NGHĨ RA — hai lỗi nặng nhất
 * hôm nay (doanh thu biến mất vì phép trừ, hoá đơn kẹt vì trùng khoá) đều lọt
 * qua hàng chục ca test và chỉ lộ ra khi chạm dữ liệu thật.
 *
 * CHỈ ĐỌC.
 */
router.get('/opportunity-probe', async (req: Request, res: Response) => {
    try {
        const { coHoiTangTruong } = await import('../lib/growthOpportunity')
        const q = req.query as any
        const ma = String(q.store || '').trim()
        if (!ma) return res.status(400).json({ success: false, error: 'Thiếu ?store=<mã cửa hàng>' })
        const store: any = await registryPrisma.store.findFirst({ where: { code: ma }, select: { name: true, schema: true, code: true } })
        if (!store) return res.status(404).json({ success: false, error: `Không có cửa hàng mã "${ma}"` })

        const hopLe = (s: any) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))
        const den = hopLe(q.to) ? new Date(`${q.to}T23:59:59+07:00`) : new Date()
        const tu = hopLe(q.from) ? new Date(`${q.from}T00:00:00+07:00`) : new Date(den.getTime() - 90 * 86400_000)
        const nhan = (d: Date) => new Date(d.getTime() + 7 * 3600_000).toISOString().slice(0, 10)

        const t0 = Date.now()
        const kq: any = await coHoiTangTruong(getStorePrisma(store.schema), { tu, den, moTa: `${nhan(tu)} → ${nhan(den)}` })
        const giay = Math.round((Date.now() - t0) / 100) / 10

        res.json({
            success: true,
            data: {
                cuaHang: store.name, ma: store.code, ky: kq.ky, chayHet: `${giay}s`,
                quyMo: kq.quyMo,
                siLe: { duocKetLuan: kq.siLe.duocKetLuan, lyDo: kq.siLe.lyDo, nguongSi: kq.siLe.nguongSi, nhom: kq.siLe.nhom },
                banKem: {
                    duocKetLuan: kq.banKem.duocKetLuan, lyDo: kq.banKem.lyDo,
                    soDonNhieuMon: kq.banKem.soDonNhieuMon, tyLeDonNhieuMon: kq.banKem.tyLeDonNhieuMon,
                    soCap: kq.banKem.cap.length,
                    top3: kq.banKem.cap.slice(0, 3).map((c: any) => ({ a: c.tenA, b: c.tenB, lift: c.lift, doi: c.soDonCoCa2, tiemNang: c.tiemNangLoiNhuan })),
                },
                tapTrung: {
                    duocKetLuan: kq.tapTrung.duocKetLuan, lyDo: kq.tapTrung.lyDo,
                    soMaHang: kq.tapTrung.soMaHang, soMaTao80: kq.tapTrung.soMaTao80LaiSuat,
                    tyLeMaTao80: kq.tapTrung.tyLeMaTao80, hhi: kq.tapTrung.hhiHang,
                    topKhachChiemTyLe: kq.tapTrung.topKhachChiemTyLe, soCanhBao: kq.tapTrung.canhBao.length,
                },
                muaVu: {
                    duocKetLuan: kq.muaVu.duocKetLuan, lyDo: kq.muaVu.lyDo,
                    gioVang: kq.muaVu.gioVang, ngayVang: kq.muaVu.ngayVang,
                    xuHuong: kq.muaVu.xuHuong, soMatHangTheoMua: kq.muaVu.matHangTheoMua.length,
                    gioCoBan: kq.muaVu.theoGio.map((g: any) => g.gio),
                },
                doNhayGia: {
                    duocKetLuan: kq.doNhayGia.duocKetLuan, lyDo: kq.doNhayGia.lyDo,
                    soMaDaXet: kq.doNhayGia.soMaDaXet, soMaDoDuoc: kq.doNhayGia.soMaDoDuoc,
                    top3: kq.doNhayGia.matHang.slice(0, 3).map((m: any) => ({
                        ten: m.ten, doCoGian: m.doCoGian, doTinCay: m.doTinCay, nhay: m.nhay, tang5: m.tang5,
                    })),
                },
                khuyenNghi: kq.khuyenNghi.map((k: any) => ({ ma: k.ma, tieuDe: k.tieuDe, uocTinh: k.uocTinh })),
                ghiChu: kq.ghiChu, thieu: kq.thieu,
            },
        })
    } catch (err: any) {
        console.error('GET /admin/opportunity-probe error:', err)
        res.status(500).json({ success: false, error: err?.message || 'Internal server error' })
    }
})

/**
 * GET /api/admin/engine-probe?store=CODE
 *
 * Chạy hai cỗ máy ĐIỂM ĐẶT HÀNG và LỊCH TIỀN TỚI trên dữ liệu THẬT, trả bản tóm
 * tắt gọn. Cùng lý do với opportunity-probe: cả hai đều mới, đều có test đầy đủ
 * trên dữ liệu mẫu, và đều CHƯA từng chạm dữ liệu thật.
 *
 * Hôm nay đã ba lần dữ liệu thật lộ ra lỗi mà hàng chục ca test không thấy —
 * dữ liệu mẫu chỉ chứa những tình huống mình nghĩ ra được.
 *
 * CHỈ ĐỌC.
 */
router.get('/engine-probe', async (req: Request, res: Response) => {
    try {
        const q = req.query as any
        const ma = String(q.store || '').trim()
        if (!ma) return res.status(400).json({ success: false, error: 'Thiếu ?store=<mã cửa hàng>' })
        const store: any = await registryPrisma.store.findFirst({ where: { code: ma }, select: { name: true, schema: true, code: true } })
        if (!store) return res.status(404).json({ success: false, error: `Không có cửa hàng mã "${ma}"` })
        const prisma = getStorePrisma(store.schema)

        const { keHoachDatHang } = await import('../lib/reorderPlan')
        const { duBaoDongTien } = await import('../lib/cashForecast')

        const t1 = Date.now()
        let datHang: any = null, loiDatHang: string | null = null
        try { datHang = await keHoachDatHang(prisma, { soMaToiDa: 5 }) }
        catch (e: any) { loiDatHang = String(e?.message || e).slice(0, 300) }
        const giay1 = Math.round((Date.now() - t1) / 100) / 10

        const t2 = Date.now()
        let tien: any = null, loiTien: string | null = null
        try { tien = await duBaoDongTien(prisma, {}) }
        catch (e: any) { loiTien = String(e?.message || e).slice(0, 300) }
        const giay2 = Math.round((Date.now() - t2) / 100) / 10

        res.json({
            success: true,
            data: {
                cuaHang: store.name, ma: store.code,
                datHang: loiDatHang ? { loi: loiDatHang } : {
                    chayHet: `${giay1}s`,
                    ky: datHang?.ky, thamSo: datHang?.thamSo, tomTat: datHang?.tomTat,
                    thieuChinh: datHang?.thieuChinh,
                    /* Phải trả cả ghiChu/thieu: chính những dòng này nói ra giới
                     * hạn của con số. Probe mà cắt chúng đi thì lúc soi kết quả
                     * sẽ tưởng engine im lặng, rồi đi sửa nhầm chỗ. */
                    ghiChu: datHang?.ghiChu,
                    thieu: datHang?.thieu,
                    mauHetHang: (datHang?.hetHang || []).slice(0, 3),
                    mauCanDat: (datHang?.canDat || []).slice(0, 3),
                },
                dongTien: loiTien ? { loi: loiTien } : { chayHet: `${giay2}s`, ...tien },
                truyVetMaAmSau: await (async () => {
                    /* Truy vết đúng mã âm sâu nhất: đây là công cụ người dùng mở
                     * để hiểu tồn âm, nên phải soi trên dữ liệu thật xem dòng
                     * thời gian có xếp đúng theo ngày nghiệp vụ không. */
                    try {
                        const sp = await prisma.product.findFirst({
                            where: { stock: { lt: 0 } }, orderBy: { stock: 'asc' },
                            select: { id: true, sku: true, name: true, stock: true },
                        })
                        if (!sp) return { khong: 'không có mã nào tồn âm' }
                        const { truyVetTonKho } = await import('../lib/stockTrace')
                        const tv: any = await truyVetTonKho(prisma, String(sp.id), { soBuocToiDa: 400 })
                        const ngay = (tv.buoc || []).map((b: any) => String(b.ngay).slice(0, 10))
                        const tangDan = ngay.every((v: string, i: number) => i === 0 || v >= ngay[i - 1])
                        return {
                            sku: sp.sku, ton: sp.stock, soBuoc: tv.soBuoc,
                            xepTangDanTheoNgay: tangDan,
                            ngayDau: ngay[0] ?? null, ngayCuoi: ngay[ngay.length - 1] ?? null,
                            khopSo: tv.khopSo, lech: tv.lech,
                            buocDauTienAm: tv.buocDauTienAm
                                ? { ngay: tv.buocDauTienAm.ngay, conLai: tv.buocDauTienAm.conLai, chungTu: tv.buocDauTienAm.chungTu }
                                : null,
                        }
                    } catch (e: any) {
                        return { loi: String(e?.message || e).slice(0, 300) }
                    }
                })(),
                dauVetThoiGian: await (async () => {
                    /* "Cửa hàng mới 31 ngày" và "dữ liệu được nhập vào 31 ngày
                     * trước" cho ra cùng một MIN(createdAt) nhưng ý nghĩa ngược
                     * nhau. kiotvietSync ghi transactionDate = ngày bán thật,
                     * còn createdAt là lúc chạy nhập. Phải đo mới biết. */
                    try {
                        const r: any[] = await prisma.$queryRawUnsafe(
                            `SELECT COUNT(*)::int AS tong,
                                    COUNT("transactionDate")::int AS "coNgayBan",
                                    MIN("createdAt") AS "taoMin", MAX("createdAt") AS "taoMax",
                                    MIN("transactionDate") AS "banMin", MAX("transactionDate") AS "banMax",
                                    COUNT(DISTINCT ("createdAt" + interval '7 hours')::date)::int AS "soNgayTao",
                                    COUNT(DISTINCT ("transactionDate" + interval '7 hours')::date)::int AS "soNgayBan"
                             FROM "Transaction"
                             WHERE status IN ('completed', 'partial')`)
                        const x = r?.[0] || {}
                        const d = (v: any) => v ? new Date(v).toISOString().slice(0, 10) : null
                        /* Lệch giữa hai cách cắt kỳ, theo từng tháng. Đây là con
                         * số quyết định có nên đổi cách cắt kỳ ở mảng thuế hay
                         * không — đổi là thay đổi doanh thu đã kê khai, nên phải
                         * đo chứ không suy. */
                        const theoThang: any[] = await prisma.$queryRawUnsafe(
                            `SELECT thang,
                                    SUM(CASE WHEN nguon = 'tao' THEN tien ELSE 0 END)::float8 AS "theoNgayTao",
                                    SUM(CASE WHEN nguon = 'ban' THEN tien ELSE 0 END)::float8 AS "theoNgayBan"
                             FROM (
                                 SELECT to_char("createdAt" + interval '7 hours', 'YYYY-MM') AS thang,
                                        'tao' AS nguon, total AS tien
                                 FROM "Transaction" WHERE status IN ('completed','partial')
                                 UNION ALL
                                 SELECT to_char(COALESCE("transactionDate","createdAt") + interval '7 hours', 'YYYY-MM') AS thang,
                                        'ban' AS nguon, total AS tien
                                 FROM "Transaction" WHERE status IN ('completed','partial')
                             ) z
                             GROUP BY thang ORDER BY thang`)
                        /* Lịch sử NHẬP HÀNG có được nhập vào cùng độ dài với
                         * lịch sử bán không? Nếu bán có 5 tháng mà nhập chỉ có
                         * 1 tháng thì tồn âm và "bán vượt hoá đơn vào" là hệ
                         * quả tất yếu của dữ liệu, không phải bằng chứng mua
                         * hàng trôi nổi. */
                        const pn: any[] = await prisma.$queryRawUnsafe(
                            `SELECT COUNT(*)::int AS tong,
                                    COUNT("transactionDate")::int AS "coNgayHd",
                                    MIN(COALESCE("transactionDate","createdAt")) AS "somNhat",
                                    MAX(COALESCE("transactionDate","createdAt")) AS "muonNhat",
                                    COALESCE(SUM("totalCost"),0)::float8 AS tien
                               FROM "ImportReceipt" WHERE status <> 'cancelled'`)
                        const y = pn?.[0] || {}
                        return {
                            phieuNhap: {
                                tong: y.tong, soCoNgayHoaDon: y.coNgayHd,
                                tu: d(y.somNhat), den: d(y.muonNhat),
                                tongTien: Math.round(Number(y.tien) || 0),
                            },
                            tongGiaoDich: x.tong, soCoNgayBan: x.coNgayBan,
                            ngayTao: { tu: d(x.taoMin), den: d(x.taoMax), soNgayKhacNhau: x.soNgayTao },
                            ngayBan: { tu: d(x.banMin), den: d(x.banMax), soNgayKhacNhau: x.soNgayBan },
                            lechTheoThang: theoThang.map((m: any) => ({
                                thang: m.thang,
                                theoNgayTao: Math.round(Number(m.theoNgayTao) || 0),
                                theoNgayBan: Math.round(Number(m.theoNgayBan) || 0),
                                lech: Math.round((Number(m.theoNgayTao) || 0) - (Number(m.theoNgayBan) || 0)),
                            })),
                        }
                    } catch (e: any) {
                        return { loi: String(e?.message || e).slice(0, 300) }
                    }
                })(),
                soatThue: await (async () => {
                    /* Bộ soát sẵn sàng thanh tra là cỗ máy nói nặng nhất trong cả
                     * phần mềm — nó chấm điểm và ước tính tiền phạt. Cửa hàng
                     * chưa có dữ liệu mà bị chấm điểm thấp kèm số tiền phạt là
                     * doạ người chưa làm gì sai. */
                    try {
                        const { kiemTraThue } = await import('../lib/taxAudit')
                        const nay3 = new Date(Date.now() + 7 * 3600_000)
                        const y = nay3.getUTCFullYear()
                        const m = nay3.getUTCMonth() + 1
                        const p2 = (n: number) => String(n).padStart(2, '0')
                        const cuoi = new Date(Date.UTC(y, m, 0)).getUTCDate()
                        const from3 = `${y}-${p2(m)}-01`
                        const to3 = `${y}-${p2(m)}-${p2(cuoi)}`
                        const k: any = await kiemTraThue(prisma, {
                            from: from3, to: to3,
                            start: new Date(`${from3}T00:00:00.000Z`),
                            end: new Date(new Date(`${to3}T23:59:59.999Z`).getTime() + 7 * 3600_000),
                            maKy: `${y}-${p2(m)}`, nhan: `tháng ${m}/${y}`,
                        })
                        return {
                            ky: k.ky, diem: k.diem, xepLoai: k.xepLoai,
                            soCanhBao: (k.canhBao || []).length,
                            canhBaoNang: (k.canhBao || []).filter((c: any) => c.muc === 'cao').map((c: any) => c.code),
                            chiTietNang: (k.canhBao || []).filter((c: any) => c.muc === 'cao').map((c: any) => ({
                                code: c.code, tieuDe: c.tieuDe, tienRuiRo: c.tienRuiRo,
                                chiTiet: String(c.chiTiet || '').slice(0, 400),
                            })),
                            uocTinhPhat: k.uocTinhPhat?.tong ?? null,
                            doanhThu: k.doanhThu,
                        }
                    } catch (e: any) {
                        return { loi: String(e?.message || e).slice(0, 300) }
                    }
                })(),
                sucKhoe: await (async () => {
                    try {
                        const { sucKhoeDuLieu } = await import('../lib/dataHealth')
                        const nay2 = new Date(Date.now() + 7 * 3600_000)
                        const to2 = nay2.toISOString().slice(0, 10)
                        const from2 = new Date(nay2.getTime() - 90 * 86400_000).toISOString().slice(0, 10)
                        return await sucKhoeDuLieu(prisma, {
                            from: from2, to: to2,
                            start: new Date(`${from2}T00:00:00+07:00`),
                            end: new Date(new Date(`${to2}T00:00:00+07:00`).getTime() + 86400_000),
                        })
                    } catch (e: any) {
                        return { loi: String(e?.message || e).slice(0, 300) }
                    }
                })(),
                hkd: await (async () => {
                    /* Chuyển đổi hộ kinh doanh 2026 — cỗ máy nói những câu rất
                     * nặng ("sang năm bạn nộp bao nhiêu"), càng phải soi trên số
                     * thật trước khi tin. */
                    try {
                        const { tinhChuyenDoiHKD } = await import('../lib/hkdTransition')
                        const den2 = new Date()
                        const tu2 = new Date(den2.getTime() - 365 * 86400_000)
                        const t3 = Date.now()
                        const k: any = await tinhChuyenDoiHKD(prisma, { tu: tu2, den: den2 })
                        return {
                            chayHet: `${Math.round((Date.now() - t3) / 100) / 10}s`,
                            ...k,
                            // Danh sách việc phải làm có thể rất dài — chỉ lấy mẫu
                            viecPhaiLam: Array.isArray(k?.viecPhaiLam) ? k.viecPhaiLam.slice(0, 4) : k?.viecPhaiLam,
                        }
                    } catch (e: any) {
                        return { loi: String(e?.message || e).slice(0, 300) }
                    }
                })(),
            },
        })
    } catch (err: any) {
        console.error('GET /admin/engine-probe error:', err)
        res.status(500).json({ success: false, error: err?.message || 'Internal server error' })
    }
})

/**
 * GET /api/admin/dup-invoice-sweep?months=12
 *
 * Tìm những phiếu nhập ĐÃ trùng số hoá đơn cùng một nhà cung cấp.
 *
 * Chốt chặn vừa thêm chỉ ngăn phiếu SẮP nhập. Những cặp đã trùng sẵn thì vẫn
 * đang khai trùng thuế GTGT được khấu trừ và trùng chi phí được trừ — đó là rủi
 * ro đang chạy, không phải rủi ro tương lai.
 *
 * CHỈ ĐỌC. Chạy tuần tự từng cửa hàng.
 */
router.get('/dup-invoice-sweep', async (req: Request, res: Response) => {
    try {
        const thang = Math.max(1, Math.min(36, Number((req.query as any)?.months) || 12))
        const tu = new Date(Date.now() - thang * 30 * 86400_000)
        const chuan = (v: any) => String(v || '').replace(/\s+/g, '').toLowerCase()

        const stores = await registryPrisma.store.findMany({ select: { name: true, schema: true, code: true } }) as any[]
        const bang: any[] = []

        for (const store of stores) {
            try {
                const p: any = getStorePrisma(store.schema)
                const ds: any[] = await p.importReceipt.findMany({
                    where: {
                        createdAt: { gte: tu },
                        status: { not: 'cancelled' },
                        vatInvoiceNo: { not: null },
                    },
                    select: {
                        id: true, code: true, vatInvoiceNo: true, supplierId: true, supplierName: true,
                        totalCost: true, vatAmount: true, createdAt: true,
                    },
                    orderBy: { createdAt: 'asc' },
                    take: 5000,
                })

                /* Khoá gom = nhà cung cấp + số hoá đơn đã chuẩn hoá. Dùng
                 * supplierId nếu có, không thì tên — hai phiếu cùng tên NCC mà
                 * một cái chưa gắn mã vẫn phải gom chung. */
                const nhom = new Map<string, any[]>()
                for (const r of ds) {
                    const so = chuan(r.vatInvoiceNo)
                    if (!so) continue
                    const ncc = r.supplierId || chuan(r.supplierName)
                    if (!ncc) continue
                    const k = `${ncc}|${so}`
                    if (!nhom.has(k)) nhom.set(k, [])
                    nhom.get(k)!.push(r)
                }

                const trung = Array.from(nhom.values()).filter(v => v.length > 1)
                bang.push({
                    cuaHang: store.name, ma: store.code,
                    soPhieuXet: ds.length,
                    soCapTrung: trung.length,
                    /* Tiền khai trùng = tổng của các phiếu THỪA (bỏ phiếu đầu
                     * tiên trong mỗi nhóm — đó mới là phiếu thật). */
                    vatKhaiTrung: Math.round(trung.reduce((s, v) =>
                        s + v.slice(1).reduce((s2: number, r: any) => s2 + (Number(r.vatAmount) || 0), 0), 0)),
                    chiPhiKhaiTrung: Math.round(trung.reduce((s, v) =>
                        s + v.slice(1).reduce((s2: number, r: any) => s2 + (Number(r.totalCost) || 0), 0), 0)),
                    /* Kèm HÀNG HOÁ của các phiếu thừa: mỗi phiếu nhập cộng tồn
                     * kho, nên biết mã nào đang thừa bao nhiêu mới quyết được có
                     * huỷ hay không — và huỷ xong phải soát lại đúng những mã đó.
                     * Chỉ tra hàng cho các phiếu THỪA (bỏ phiếu đầu mỗi nhóm). */
                    mau: await (async () => {
                        const ra: any[] = []
                        for (const v of trung.slice(0, 5)) {
                            const idThua = v.slice(1).map((r: any) => r.id)
                            let hang: any[] = []
                            if (idThua.length) {
                                hang = await p.importReceiptItem.findMany({
                                    where: { receiptId: { in: idThua } },
                                    select: { productName: true, productSku: true, quantity: true, total: true },
                                    take: 40,
                                }).catch(() => [])
                            }
                            ra.push({
                                nhaCungCap: v[0].supplierName || v[0].supplierId,
                                soHoaDon: v[0].vatInvoiceNo,
                                phieu: v.map((r: any, i: number) => ({
                                    code: r.code,
                                    tien: Math.round(Number(r.totalCost) || 0),
                                    ngay: new Date(r.createdAt).toISOString().slice(0, 10),
                                    laPhieuGoc: i === 0,
                                })),
                                hangThuaTon: hang.map((it: any) => ({
                                    ten: it.productName, sku: it.productSku,
                                    soLuongThua: Number(it.quantity) || 0,
                                    tien: Math.round(Number(it.total) || 0),
                                })),
                            })
                        }
                        return ra
                    })(),
                })
            } catch (e: any) {
                bang.push({ cuaHang: store.name, ma: store.code, loi: String(e?.message || e).slice(0, 200) })
            }
        }

        const tong = bang.filter(b => !b.loi).reduce((s, b) => s + b.soCapTrung, 0)
        res.json({ success: true, data: { soThang: thang, tongSoCapTrung: tong, bang } })
    } catch (err: any) {
        console.error('GET /admin/dup-invoice-sweep error:', err)
        res.status(500).json({ success: false, error: err?.message || 'Internal server error' })
    }
})

// POST /api/admin/run-reconcile — chạy ngay vòng đối chiếu ba chiều tháng trước
router.post('/run-reconcile', async (req: Request, res: Response) => {
    try {
        // ?dryRun=1 — tính đủ trên dữ liệu thật nhưng không tạo thông báo nào.
        const chayThu = String((req.query as any)?.dryRun || '') === '1'
        const { chayDoiChieuNgay } = await import('../cron/reconcileCron')
        chayDoiChieuNgay(chayThu).catch(e => console.error('run-reconcile lỗi:', e))
        res.json({
            success: true,
            message: chayThu
                ? 'Đã kích hoạt CHẠY THỬ đối chiếu (không gửi thông báo) — xem kết quả trong log'
                : 'Đã kích hoạt vòng đối chiếu ba chiều — xem tiến độ trong log',
        })
    } catch (err: any) {
        res.status(500).json({ success: false, error: err?.message })
    }
})

// ════════════════════════════════════════════════════════════════════════════
// SỨC KHOẺ TOÀN HỆ THỐNG — một chỗ nhìn ra cửa hàng nào đang có vấn đề
// ════════════════════════════════════════════════════════════════════════════
/**
 * Ngày 15/08/2026 HUTI mất đơn nguyên ngày mà không ai biết, tới khi chủ shop
 * tự phát hiện. Người quản trị 9 cửa hàng KHÔNG có chỗ nào nhìn ra điều đó:
 * tám thẻ hiện có đều là cấu hình và vận hành, không thẻ nào trả lời "cửa hàng
 * nào đang hỏng". Muốn biết thì phải mở từng cửa hàng một.
 *
 * Endpoint này chạy cỗ máy `sucKhoeDuLieu` cho mọi cửa hàng rồi gom lại.
 *
 * TUẦN TỰ QUA TỪNG CỬA HÀNG, không Promise.all: mỗi cửa hàng đã tốn vài truy
 * vấn, bắn song song 9 cửa hàng là cạn pool đúng lúc người ta đang bán hàng —
 * xem [[prisma-pool-promiseall-trap]]. Chậm hơn nhưng đây là màn hình quản
 * trị, mở vài lần một ngày.
 *
 * ĐỆM 3 PHÚT vì cùng lý do: mở đi mở lại thẻ không được phép nện vào pool của
 * 9 cửa hàng đang bán. Thêm `?moi=1` để ép chạy lại khi đang xử lý sự cố.
 */
/* `soNgay` PHẢI nằm trong khoá đệm. Bản đầu chỉ xét thời hạn, nên đổi bộ lọc
 * kỳ trong vòng 3 phút là nhận lại số liệu của kỳ CŨ — mọi con số bên trong
 * (kể cả "đơn sàn chưa vào sổ") thuộc kỳ khác hẳn cái người dùng đang chọn. */
type DemSucKhoe = { luc: number; soNgay: number; du: any }
let demSucKhoeHeThong: DemSucKhoe | null = null
const TTL_SUC_KHOE = 3 * 60_000

// ════════════════════════════════════════════════════════════════════════════
// TRUNG TÂM LỖI — prod đang hỏng chỗ nào, gom thành nhóm đọc được
// ════════════════════════════════════════════════════════════════════════════
/**
 * GET /admin/errors?gio=6 — lỗi production trong N giờ gần nhất.
 *
 * Ngày 15/08/2026 tôi phải chạy `gcloud logging read` hàng chục lần mới trả lời
 * được "hệ thống đang hỏng gì" — người quản trị không có cửa đó, nên thực tế
 * không ai biết cho tới khi khách phàn nàn.
 *
 * GIÁ TRỊ NẰM Ở CHỖ GOM NHÓM, không phải ở việc hiện log thô. 500 dòng
 * "Timed out fetching a new connection" là MỘT vấn đề, không phải 500 vấn đề;
 * đổ nguyên log ra màn hình thì vẫn không ai đọc. Chuẩn hoá chữ ký (bỏ id, số,
 * ngày giờ) rồi đếm — đúng thao tác tay đã dùng cả ngày hôm nay.
 *
 * Đọc Cloud Logging bằng ADC của service account Cloud Run (đang có
 * roles/editor). Không có quyền / gọi hỏng thì nói THẲNG là không đọc được,
 * tuyệt đối không trả mảng rỗng — "không đọc được" mà hiện thành "không có
 * lỗi" là trấn an sai, đúng thứ tệ nhất với một màn hình giám sát.
 */
type DemLoi = { luc: number; gio: number; du: any }
let demLoi: DemLoi | null = null
const TTL_LOI = 2 * 60_000

router.get('/errors', async (req: Request, res: Response) => {
    try {
        const gio = Math.min(72, Math.max(1, Number(req.query.gio) || 6))
        const epMoi = String(req.query.moi || '') === '1'
        if (!epMoi && demLoi && demLoi.gio === gio && Date.now() - demLoi.luc < TTL_LOI) {
            res.json({ success: true, data: { ...demLoi.du, tuDem: true } }); return
        }

        const { GoogleAuth } = await import('google-auth-library').catch(() => ({ GoogleAuth: null }))
        if (!GoogleAuth) {
            res.json({ success: true, data: { docDuoc: false, viSao: 'Không nạp được google-auth-library' } }); return
        }
        const auth = new (GoogleAuth as any)({ scopes: ['https://www.googleapis.com/auth/logging.read'] })
        const client = await auth.getClient()
        const token = await client.getAccessToken()
        const accessToken = token?.token || token

        // Khai tại chỗ: hai hằng này là biến cục bộ của route thống kê Cloud Run
        const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT_ID || 'kengi-tech'
        const SERVICE_NAME = process.env.CLOUD_RUN_SERVICE_NAME || 'kengi-tech-api'

        const tu = new Date(Date.now() - gio * 3600_000).toISOString()
        const loc = `resource.type="cloud_run_revision" AND resource.labels.service_name="${SERVICE_NAME}"`
            + ` AND timestamp>="${tu}" AND (severity>=ERROR OR httpRequest.status>=500)`

        const r: any = await fetch('https://logging.googleapis.com/v2/entries:list', {
            method: 'POST',
            headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                resourceNames: [`projects/${PROJECT_ID}`],
                filter: loc,
                orderBy: 'timestamp desc',
                pageSize: 1000,
            }),
        }).then(x => x.json()).catch((e: any) => ({ _loi: String(e?.message || e) }))

        if (r?._loi || r?.error) {
            res.json({
                success: true,
                data: {
                    docDuoc: false,
                    viSao: String(r?.error?.message || r?._loi || 'Cloud Logging trả lỗi').slice(0, 300),
                },
            })
            return
        }

        const dong: any[] = Array.isArray(r?.entries) ? r.entries : []
        const { gomLoi } = await import('../lib/gomLoi')
        const { nhom, duongLoi, so5xx } = gomLoi(dong)

        const ds = nhom.slice(0, 30)
        const du = {
            docDuoc: true,
            ky: { gio, tu },
            /* `chamTran` = đã lấy đủ 1000 dòng, tức CÒN NỮA mà không đọc hết.
             * Không nói ra thì con số hiện trên màn hình trông như tổng số thật. */
            soDongDoc: dong.length,
            chamTran: dong.length >= 1000,
            soNhom: nhom.length,
            so5xx,
            duongLoi: duongLoi.slice(0, 12),
            nhom: ds,
            chayLuc: new Date().toISOString(),
        }
        demLoi = { luc: Date.now(), gio, du }
        res.json({ success: true, data: { ...du, tuDem: false } })
    } catch (e: any) {
        res.status(500).json({ success: false, error: String(e?.message || e) })
    }
})

/**
 * POST /admin/lien-ket-listing — nối listing sàn sang hàng kho hàng loạt.
 * Body: { store: 'CODE', capNoi: [{ listingId, productId }] }
 *
 * Người dùng DUYỆT rồi mới gọi — bộ gợi ý không bao giờ tự nối.
 *
 * BA CHỐT CHẶN, vì nối sai là doanh thu và trừ kho chạy vào nhầm mặt hàng:
 *   1. Cả listing lẫn hàng kho phải THUỘC ĐÚNG cửa hàng đang thao tác.
 *   2. KHÔNG ĐÈ listing đã nối sẵn — chỉ nối cái đang trống. Đè lên một liên
 *      kết người dùng đã tự đặt là âm thầm đổi chỗ doanh thu của họ.
 *   3. Trả về từng dòng bỏ qua kèm LÝ DO, không im lặng nuốt.
 *
 * Nối là việc ĐẢO NGƯỢC ĐƯỢC (đặt localProductId về null), nên không cần xác
 * nhận hai lớp — nhưng vẫn phải nói rõ đã làm gì.
 */
router.post('/lien-ket-listing', async (req: Request, res: Response) => {
    try {
        const b = req.body || {}
        const ma = String(b.store || '').trim()
        const capNoi: any[] = Array.isArray(b.capNoi) ? b.capNoi.slice(0, 500) : []
        if (!ma || !capNoi.length) {
            res.status(400).json({ success: false, error: 'Thiếu store hoặc danh sách capNoi' }); return
        }
        const store: any = await registryPrisma.store.findFirst({
            where: { code: ma }, select: { schema: true, code: true },
        })
        if (!store) { res.status(404).json({ success: false, error: 'Không tìm thấy cửa hàng' }); return }
        const sp: any = getStorePrisma(store.schema)

        const daNoi: any[] = []
        const boQua: any[] = []
        // TUẦN TỰ — pool mỗi cửa hàng chỉ 5 kết nối, và đây là vòng ghi.
        for (const c of capNoi) {
            const listingId = String(c?.listingId || '')
            const productId = String(c?.productId || '')
            if (!listingId || !productId) { boQua.push({ listingId, lyDo: 'thiếu id' }); continue }
            try {
                const lt = await sp.onlineProduct.findUnique({
                    where: { id: listingId }, select: { id: true, name: true, localProductId: true },
                })
                if (!lt) { boQua.push({ listingId, lyDo: 'không có listing này trong cửa hàng' }); continue }
                if (lt.localProductId) {
                    boQua.push({ listingId, ten: lt.name, lyDo: 'listing ĐÃ nối sẵn — không đè' }); continue
                }
                const hk = await sp.product.findUnique({ where: { id: productId }, select: { id: true, name: true } })
                if (!hk) { boQua.push({ listingId, lyDo: 'không có hàng kho này trong cửa hàng' }); continue }

                await sp.onlineProduct.update({ where: { id: listingId }, data: { localProductId: productId } })
                daNoi.push({ listingId, tenListing: lt.name, productId, tenHangKho: hk.name })
            } catch (e: any) {
                boQua.push({ listingId, lyDo: String(e?.message || e).slice(0, 150) })
            }
        }

        res.json({
            success: true,
            data: {
                soDaNoi: daNoi.length,
                soBoQua: boQua.length,
                daNoi: daNoi.slice(0, 200),
                boQua: boQua.slice(0, 200),
                /* Nhắc luôn điều người dùng cần biết nhất sau khi bấm. */
                ghiChu: 'Đơn đang kẹt sẽ tự lên phiếu ở lượt đồng bộ kênh kế tiếp — không cần vá tay.',
            },
        })
    } catch (e: any) {
        res.status(500).json({ success: false, error: String(e?.message || e) })
    }
})

/**
 * POST /admin/danh-dau-demo — { store: 'CODE', laDemo: true|false }
 * Đánh dấu cửa hàng demo để màn hình giám sát bỏ qua. Đảo ngược được.
 */
router.post('/danh-dau-demo', async (req: Request, res: Response) => {
    try {
        const ma = String(req.body?.store || '').trim()
        const laDemo = !!req.body?.laDemo
        if (!ma) { res.status(400).json({ success: false, error: 'Thiếu store' }); return }
        const n: number = await (registryPrisma as any).$executeRawUnsafe(
            `UPDATE "Store" SET "isDemo" = $1 WHERE code = $2`, laDemo, ma,
        )
        if (!n) { res.status(404).json({ success: false, error: 'Không tìm thấy cửa hàng' }); return }
        res.json({ success: true, data: { store: ma, laDemo } })
    } catch (e: any) {
        res.status(500).json({ success: false, error: String(e?.message || e) })
    }
})

/**
 * GET /admin/goi-y-lien-ket?store=CODE — GỢI Ý nối listing sàn ↔ hàng kho.
 *
 * Đo KENGISTORE 15/08/2026: 641 listing, 0 cái được nối — và đó là gốc rễ của
 * ~740 triệu đơn đã bán mà không lên phiếu. Nối tay 641 cái là việc rất nản.
 *
 * CHỈ GỢI Ý, TUYỆT ĐỐI KHÔNG TỰ NỐI. Nối sai là doanh thu và trừ kho chạy vào
 * nhầm mặt hàng — sai âm thầm và khó lần hơn hẳn việc chưa nối. Người dùng
 * nhìn rồi mới bấm, và endpoint này không có đường ghi nào.
 */
router.get('/goi-y-lien-ket', async (req: Request, res: Response) => {
    try {
        const ma = String(req.query.store || '').trim()
        const store: any = await registryPrisma.store.findFirst({
            where: { code: ma }, select: { name: true, schema: true, code: true },
        })
        if (!store) { res.status(404).json({ success: false, error: 'Không tìm thấy cửa hàng' }); return }
        const sp: any = getStorePrisma(store.schema)

        // Tuần tự — pool mỗi cửa hàng chỉ 5 kết nối.
        const listings = await sp.onlineProduct.findMany({
            where: { localProductId: null },
            select: { id: true, name: true, sku: true },
            take: 1000,
        }).catch(() => null)
        if (!listings) {
            res.json({ success: true, data: { docDuoc: false, viSao: 'Không đọc được bảng OnlineProduct' } })
            return
        }
        const hangKho = await sp.product.findMany({
            select: { id: true, name: true, sku: true },
            take: 5000,
        }).catch(() => [])

        const { goiYLienKet } = await import('../lib/goiYLienKet')
        const gy = goiYLienKet(listings, hangKho)
        const dem = (m: string) => gy.filter(x => x.mucTinCay === m).length

        res.json({
            success: true,
            data: {
                docDuoc: true,
                cuaHang: store.code,
                soListingChuaNoi: listings.length,
                soHangKho: hangKho.length,
                soGoiYDuoc: gy.length,
                theoTinCay: { cao: dem('cao'), vua: dem('vua'), thap: dem('thap') },
                /* Nói thẳng phần KHÔNG gợi được: người dùng cần biết còn bao
                 * nhiêu cái phải tự tìm, chứ không chỉ thấy phần máy làm hộ. */
                soKhongGoiDuoc: listings.length - gy.length,
                goiY: gy.slice(0, 300),
            },
        })
    } catch (e: any) {
        res.status(500).json({ success: false, error: String(e?.message || e) })
    }
})

/**
 * GET /admin/don-ket?store=CODE&limit=50 — ĐƠN SÀN ĐÃ BÁN MÀ CHƯA LÊN PHIẾU.
 *
 * Đo 15/08/2026: KENGISTORE có 777 đơn (373.148.233đ, bằng 9,1% doanh thu đã
 * ghi sổ cùng kỳ) ở trạng thái đáng lẽ phải lên phiếu mà vẫn không có phiếu.
 *
 * Endpoint này vừa để CHẨN ĐOÁN vừa để XỬ LÝ: trả kèm `soDongHang` vì nghi
 * nguyên nhân là đơn không có dòng hàng nào — `convertOnlineOrderToTransaction`
 * thoát ở nhánh `transactionItems.length === 0` và chỉ ghi console.log rồi nuốt,
 * nên nó thử lại mỗi lượt đồng bộ và thất bại mỗi lần, im lặng (log
 * "No matching products for order …" chạm trần 100 dòng chỉ trong 6 giờ).
 *
 * Đếm dòng hàng bằng MỘT truy vấn gộp, không N+1: pool mỗi cửa hàng chỉ 5.
 */
router.get('/don-ket', async (req: Request, res: Response) => {
    try {
        const ma = String(req.query.store || '').trim()
        const gioiHan = Math.min(200, Math.max(1, Number(req.query.limit) || 50))
        const store: any = await registryPrisma.store.findFirst({
            where: { code: ma }, select: { name: true, schema: true, code: true },
        })
        if (!store) { res.status(404).json({ success: false, error: 'Không tìm thấy cửa hàng' }); return }
        const sp: any = getStorePrisma(store.schema)

        const dong: any[] = await sp.$queryRawUnsafe(
            `SELECT o."orderNumber", o.status, o.total::float8 AS total, o.platform,
                    o."createdAt",
                    (SELECT COUNT(*)::int FROM "OnlineOrderItem" i WHERE i."onlineOrderId" = o.id) AS "soDongHang"
             FROM "OnlineOrder" o
             LEFT JOIN "Transaction" t ON t."receiptNumber" = 'ONLINE-' || o."orderNumber"
             WHERE t.id IS NULL
               AND o."createdAt" < now() - interval '2 days'
               AND o.status IN ('confirmed','processing','shipping','completed','delivered',
                                'READY_TO_SHIP','PROCESSED','SHIPPED','COMPLETED',
                                'AWAITING_SHIPMENT','AWAITING_COLLECTION','PARTIALLY_SHIPPING',
                                'IN_TRANSIT','DELIVERED')
             ORDER BY o."createdAt" DESC
             LIMIT ${gioiHan}`,
        ).catch((e: any) => { throw new Error(String(e?.message || e).slice(0, 200)) })

        /* SKU NÀO ĐANG CHẶN — đây mới là thứ hành động được.
         *
         * Đã đo và LOẠI giả thuyết "đơn không có dòng hàng": 100/100 đơn kẹt đều
         * có dòng. Gốc rễ nằm ở orderSync: lệnh push dòng hàng nằm TRONG
         * `if (product)`, nên item không khớp được hàng kho thì không được thêm
         * gì cả, `transactionItems` rỗng và đơn không bao giờ lên phiếu.
         * (Chú thích "still add to transaction without productId" ngay dưới đó
         * mô tả SAI mã hiện tại.)
         *
         * Gom theo SKU để biết cần ánh xạ bao nhiêu mã — nếu vài mã chặn hàng
         * trăm đơn thì đó là việc làm trong mươi phút, không phải dự án. */
        const theoSku: any[] = await sp.$queryRawUnsafe(
            `SELECT COALESCE(i.sku, '(không có SKU)') AS sku,
                    MAX(i."productName") AS "tenTrenSan",
                    COUNT(DISTINCT o.id)::int AS "soDon",
                    COALESCE(SUM(o.total), 0)::float8 AS "tien"
             FROM "OnlineOrder" o
             JOIN "OnlineOrderItem" i ON i."onlineOrderId" = o.id
             LEFT JOIN "Transaction" t ON t."receiptNumber" = 'ONLINE-' || o."orderNumber"
             WHERE t.id IS NULL
               AND i."productId" IS NULL
               AND o."createdAt" < now() - interval '2 days'
               AND o.status IN ('confirmed','processing','shipping','completed','delivered',
                                'READY_TO_SHIP','PROCESSED','SHIPPED','COMPLETED',
                                'AWAITING_SHIPMENT','AWAITING_COLLECTION','PARTIALLY_SHIPPING',
                                'IN_TRANSIT','DELIVERED')
             GROUP BY 1 ORDER BY 3 DESC LIMIT 30`,
        ).catch(() => [])

        /* LISTING ĐÃ NỐI SANG HÀNG KHO CHƯA — bước cuối của chuỗi chẩn đoán.
         *
         * Với đơn KHÔNG CÓ SKU (chiếm ~98% giá trị kẹt ở KENGISTORE), orderSync
         * chỉ còn một đường: dò `OnlineProduct` của kênh theo TÊN trùng khít,
         * và chỉ nhận listing đã có `localProductId`. Listing chưa nối thì đơn
         * không bao giờ khớp được hàng nào. */
        const lk: any[] = await sp.$queryRawUnsafe(
            `SELECT COUNT(*)::int AS tong,
                    COUNT("localProductId")::int AS "daNoi"
             FROM "OnlineProduct"`,
        ).catch(() => [])

        /* DỰ BÁO TRUNG THỰC: nối hết listing thì bao nhiêu đơn kẹt sẽ về?
         *
         * Đường khớp của orderSync với đơn không SKU là TÊN hàng trùng khít với
         * listing CÙNG KÊNH. Đơn nào tên không khớp listing nào (listing đã đổi
         * tên / bị xoá) thì nối mấy cũng không cứu — phải nói rõ nhóm đó thay
         * vì hứa "nối xong là về hết". */
        const duBao: any[] = await sp.$queryRawUnsafe(
            `SELECT
                COUNT(DISTINCT o.id) FILTER (WHERE op.id IS NOT NULL AND op."localProductId" IS NOT NULL)::int AS "seVeChuKyToi",
                COUNT(DISTINCT o.id) FILTER (WHERE op.id IS NOT NULL AND op."localProductId" IS NULL)::int  AS "veSauKhiNoi",
                COUNT(DISTINCT o.id) FILTER (WHERE op.id IS NULL)::int AS "moCoi",
                COALESCE(SUM(o.total) FILTER (WHERE op.id IS NULL), 0)::float8 AS "tienMoCoi"
             FROM "OnlineOrder" o
             JOIN "OnlineOrderItem" i ON i."onlineOrderId" = o.id
             LEFT JOIN "Transaction" t ON t."receiptNumber" = 'ONLINE-' || o."orderNumber"
             LEFT JOIN "OnlineProduct" op ON op."channelId" = o."channelId" AND op.name = i."productName"
             WHERE t.id IS NULL
               AND i."productId" IS NULL
               AND o."createdAt" < now() - interval '2 days'
               AND o.status IN ('confirmed','processing','shipping','completed','delivered',
                                'READY_TO_SHIP','PROCESSED','SHIPPED','COMPLETED',
                                'AWAITING_SHIPMENT','AWAITING_COLLECTION','PARTIALLY_SHIPPING',
                                'IN_TRANSIT','DELIVERED')`,
        ).catch(() => [])

        /* 15 ĐƠN MỒ CÔI LÀ ĐƠN NÀO — con số không xử tay được, danh sách mới
         * xử được. Kèm tên hàng trên đơn để người dùng biết phải tạo SkuMapping
         * hay đổi tên listing nào. */
        const moCoiDs: any[] = await sp.$queryRawUnsafe(
            `SELECT o."orderNumber", o.platform, o.total::float8 AS total,
                    o."createdAt", i."productName", i.sku
             FROM "OnlineOrder" o
             JOIN "OnlineOrderItem" i ON i."onlineOrderId" = o.id
             LEFT JOIN "Transaction" t ON t."receiptNumber" = 'ONLINE-' || o."orderNumber"
             LEFT JOIN "OnlineProduct" op ON op."channelId" = o."channelId" AND op.name = i."productName"
             WHERE t.id IS NULL
               AND i."productId" IS NULL
               AND op.id IS NULL
               AND o."createdAt" < now() - interval '2 days'
               AND o.status IN ('confirmed','processing','shipping','completed','delivered',
                                'READY_TO_SHIP','PROCESSED','SHIPPED','COMPLETED',
                                'AWAITING_SHIPMENT','AWAITING_COLLECTION','PARTIALLY_SHIPPING',
                                'IN_TRANSIT','DELIVERED')
             ORDER BY o.total DESC
             LIMIT 50`,
        ).catch(() => [])

        const khongCoDong = dong.filter(d => Number(d.soDongHang) === 0)
        res.json({
            success: true,
            data: {
                cuaHang: store.code,
                soDonLayVe: dong.length,
                /* Chia đôi theo NGUYÊN NHÂN, không đổ một đống: đơn không có
                 * dòng hàng cần đồng bộ lại từ sàn, đơn CÓ dòng mà vẫn kẹt là
                 * bệnh khác và phải mở ra xem. */
                soDonKhongCoDongHang: khongCoDong.length,
                /* Danh sách SKU cần ánh xạ — mở "Ánh xạ SKU" nối sang hàng kho
                 * là các đơn này tự lên phiếu ở lượt đồng bộ kế tiếp. */
                /* seVeChuKyToi: item khớp listing ĐÃ nối — chỉ là chưa tới lượt.
                 * veSauKhiNoi: khớp listing CHƯA nối — nối là về.
                 * moCoi: KHÔNG khớp listing nào — nối mấy cũng không cứu, phải
                 * xử tay (đổi tên listing / thêm SkuMapping). */
                donMoCoi: moCoiDs.map(m => ({
                    maDon: m.orderNumber, san: m.platform,
                    tien: Number(m.total) || 0,
                    tenHang: m.productName, sku: m.sku,
                    ngay: m.createdAt,
                })),
                duBaoThuHoi: duBao?.[0] ? {
                    seVeChuKyToi: Number(duBao[0].seVeChuKyToi) || 0,
                    veSauKhiNoi: Number(duBao[0].veSauKhiNoi) || 0,
                    moCoi: Number(duBao[0].moCoi) || 0,
                    tienMoCoi: Number(duBao[0].tienMoCoi) || 0,
                } : null,
                lienKetListing: lk?.[0] ? {
                    tong: Number(lk[0].tong) || 0,
                    daNoi: Number(lk[0].daNoi) || 0,
                    chuaNoi: (Number(lk[0].tong) || 0) - (Number(lk[0].daNoi) || 0),
                } : null,
                skuDangChan: theoSku.map(x => ({
                    sku: x.sku, tenTrenSan: x.tenTrenSan,
                    soDon: Number(x.soDon) || 0, tien: Number(x.tien) || 0,
                })),
                tienDonKhongCoDongHang: khongCoDong.reduce((a, b) => a + (Number(b.total) || 0), 0),
                donHang: dong.map(d => ({
                    maDon: d.orderNumber, san: d.platform, trangThai: d.status,
                    tien: Number(d.total) || 0,
                    soDongHang: Number(d.soDongHang) || 0,
                    ngay: d.createdAt,
                })),
            },
        })
    } catch (e: any) {
        res.status(500).json({ success: false, error: String(e?.message || e) })
    }
})

/**
 * GET /admin/store-staff?store=CODE — ai đang làm ở cửa hàng này.
 *
 * Hai danh sách KHÁC NHAU mà rất dễ tưởng là một:
 *   - `User`     = tài khoản ĐĂNG NHẬP được (vận hành POS).
 *   - `Employee` = hồ sơ NHÂN SỰ cho bảng lương, không đăng nhập được, không
 *                  nối gì với User.
 *
 * Đo 15/08/2026: HUTI bán 20+ đơn/ngày, 14 tỷ doanh thu, mà chỉ có ĐÚNG 2 tài
 * khoản (admin + manager) — nghĩa là người bán thật không hề có tài khoản, cả
 * cửa hàng ghi chung một login. Muốn tính doanh số theo nhân viên thì phải lấy
 * từ hồ sơ nhân sự, không thể lấy từ danh sách tài khoản.
 */
router.get('/store-staff', async (req: Request, res: Response) => {
    try {
        const ma = String(req.query.store || '').trim()
        const store: any = await registryPrisma.store.findFirst({
            where: { code: ma }, select: { name: true, schema: true, code: true },
        })
        if (!store) { res.status(404).json({ success: false, error: 'Không tìm thấy cửa hàng' }); return }
        const sp: any = getStorePrisma(store.schema)

        // Tuần tự — pool mỗi cửa hàng chỉ 5 kết nối.
        const nhanSu = await sp.employee.findMany({
            select: { id: true, code: true, name: true, position: true, status: true, branchId: true },
            orderBy: { name: 'asc' }, take: 200,
        }).catch(() => null)
        const taiKhoan = await sp.user.findMany({
            select: { id: true, name: true, role: true, isActive: true },
            orderBy: { name: 'asc' }, take: 200,
        }).catch(() => null)

        res.json({
            success: true,
            data: {
                cuaHang: store.code,
                /* null = KHÔNG ĐỌC ĐƯỢC (bảng chưa migrate chẳng hạn), khác hẳn
                 * mảng rỗng = đọc được và đúng là chưa có ai. */
                nhanSu, soNhanSu: nhanSu?.length ?? null,
                soNhanSuDangLam: nhanSu ? nhanSu.filter((e: any) => e.status === 'active').length : null,
                taiKhoan, soTaiKhoan: taiKhoan?.length ?? null,
            },
        })
    } catch (e: any) {
        res.status(500).json({ success: false, error: String(e?.message || e) })
    }
})

/**
 * POST /admin/tinh-lai-tong-mua?store=CODE — dựng lại tổng mua cho khách cũ.
 *
 * Ba trường `totalPurchases` / `totalOrders` / `lastPurchaseDate` chỉ được
 * đường POS duy trì; đồng bộ KiotViet trước nay không đụng tới, nên dữ liệu cũ
 * đứng ở 0 hết. Đo HUTI 16/08/2026: 187 khách có định danh, 125 khách quay lại,
 * mà tổng mua của MỌI khách đều bằng 0 — trang Khách Hàng trông như trống trong
 * khi trang Phân Khúc (tính sống từ phiếu) vẫn ra số.
 *
 * TÍNH LẠI, KHÔNG CỘNG DỒN — chạy bao nhiêu lần cũng ra một kết quả, nên bấm
 * nhầm hai lần không hỏng gì.
 *
 * Chạy TUẦN TỰ từng khách: pool mỗi cửa hàng chỉ 2 kết nối, và Cloud SQL
 * db-f1-micro chỉ có 50 slot cho tất cả instance cộng lại (xem
 * [[prisma-pool-promiseall-trap]]). Chậm hơn nhưng không làm nghẽn quầy.
 */
router.post('/tinh-lai-tong-mua', async (req: Request, res: Response) => {
    try {
        const ma = String(req.query.store || '').trim()
        const store: any = await registryPrisma.store.findFirst({
            where: { code: ma }, select: { name: true, schema: true, code: true },
        })
        if (!store) { res.status(404).json({ success: false, error: 'Không tìm thấy cửa hàng' }); return }
        const sp: any = getStorePrisma(store.schema)
        const { tinhLaiChoKhach } = await import('../lib/tinhLaiTongMuaKhach')

        // Chỉ khách CÓ phiếu — quét cả danh bạ là tốn công cho những người chưa mua
        const coPhieu: any[] = await sp.transaction.groupBy({
            by: ['customerId'],
            where: { customerId: { not: null }, status: { in: ['completed', 'partial'] } },
        }).catch(() => [])

        let xong = 0, hong = 0
        const viDu: any[] = []
        for (const r of coPhieu) {
            const kq = await tinhLaiChoKhach(sp, String(r.customerId))
            if (kq) {
                xong++
                if (viDu.length < 5) viDu.push({ khach: r.customerId, ...kq })
            } else hong++
        }

        res.json({
            success: true,
            data: {
                cuaHang: store.code,
                soKhachCoPhieu: coPhieu.length,
                daTinhLai: xong,
                /* `khongGhiDuoc` tách riêng chứ không gộp vào "xong": không ghi
                 * được mà báo thành công là đúng kiểu trấn an sai. */
                khongGhiDuoc: hong,
                viDu,
            },
        })
    } catch (e: any) {
        res.status(500).json({ success: false, error: String(e?.message || e) })
    }
})

// Không khai guard riêng: `router.use(adminKeyAuth)` phía trên đã chặn hết.
// Tên là `/health-overview` chứ KHÔNG phải `/store-health`: tên kia đã có chủ
// từ dòng ~2566 (soi sâu MỘT cửa hàng). Express lấy route khai trước, nên đặt
// trùng tên là route này thành mã chết im lặng — đã dính thật 15/08/2026, gọi
// ra thì nhận dữ liệu kênh của KENGISTORE. Bộ soát hợp đồng cũ không bắt được
// vì với nó cả hai đường đều "có tồn tại"; nay đã thêm phép dò trùng.
router.get('/health-overview', async (req: Request, res: Response) => {
    try {
        const chiMot = String(req.query.store || '').trim().toUpperCase()
        const epMoi = String(req.query.moi || '') === '1'
        const soNgay = Math.min(365, Math.max(7, Number(req.query.ngay) || 90))

        // Đệm chỉ dùng cho lượt xem TOÀN BỘ; soi riêng một cửa hàng thì luôn tươi.
        if (!chiMot && !epMoi && demSucKhoeHeThong && demSucKhoeHeThong.soNgay === soNgay
            && Date.now() - demSucKhoeHeThong.luc < TTL_SUC_KHOE) {
            res.json({ success: true, data: { ...demSucKhoeHeThong.du, tuDem: true } })
            return
        }

        /* Đọc bằng SQL thô vì cột isDemo cố ý KHÔNG có trong schema.prisma
         * (xem ghi chú ở /admin/migrate). COALESCE để chạy được cả trước khi
         * migrate thêm cột. */
        const tatCa: any[] = await (registryPrisma as any).$queryRawUnsafe(
            `SELECT name, schema, code, status,
                    COALESCE((to_jsonb("Store") ->> 'isDemo')::boolean, false) AS "laDemo"
             FROM "Store" ORDER BY code ASC`,
        )
        const stores = chiMot ? tatCa.filter(s => String(s.code).toUpperCase() === chiMot) : tatCa
        if (!stores.length) {
            res.status(404).json({ success: false, error: 'Không tìm thấy cửa hàng' }); return
        }

        const { sucKhoeDuLieu } = await import('../lib/dataHealth')
        const nay = new Date(Date.now() + 7 * 3600_000)
        const to = nay.toISOString().slice(0, 10)
        const from = new Date(nay.getTime() - soNgay * 86400_000).toISOString().slice(0, 10)
        const ky = {
            from, to,
            start: new Date(`${from}T00:00:00+07:00`),
            end: new Date(new Date(`${to}T00:00:00+07:00`).getTime() + 86400_000),
        }

        const cuaHang: any[] = []
        for (const s of stores) {
            /* Một cửa hàng hỏng KHÔNG được làm hỏng cả bảng — đó chính là kiểu
             * im lặng mà màn hình này sinh ra để phá. Ghi lỗi vào đúng dòng của
             * nó rồi đi tiếp. */
            /* Quét xong TRẢ LẠI client mà chính lượt quét này tạo ra.
             *
             * Không trả thì mỗi lần mở trang quản trị là để lại 9 client ấm =
             * 18 kết nối trên instance phục vụ nó — mà thanh tình trạng gọi
             * endpoint này ở MỌI lần mở trang. Cloud SQL db-f1-micro chỉ có 50
             * slot cho tất cả instance cộng lại, đo 16/08 đỉnh chạm 48/50.
             * Cửa hàng nào VỐN đã ấm (đang bán) thì giữ nguyên — đóng client
             * của quầy đang bán là mỗi request của họ phải nối lại. */
            const vonAm = dangGiuClient(s.schema)
            try {
                const sp: any = getStorePrisma(s.schema)
                const kq = await sucKhoeDuLieu(sp, ky)
                const nang = (kq.muc || []).filter((m: any) => m.muc === 'nang')
                const vua = (kq.muc || []).filter((m: any) => m.muc === 'vua')
                cuaHang.push({
                    code: s.code, name: s.name, trangThai: s.status, laDemo: !!s.laDemo,
                    diem: kq.diem, xepLoai: kq.xepLoai,
                    soNang: nang.length, soVua: vua.length,
                    // Chỉ gửi phần NẶNG kèm chi tiết; phần vừa gửi tên thôi cho nhẹ
                    nang: nang.map((m: any) => ({ ma: m.ma, ten: m.ten, so: m.so, canLam: m.canLam })),
                    vua: vua.map((m: any) => ({ ma: m.ma, ten: m.ten, so: m.so })),
                    /* `thieu` = phép soát KHÔNG ĐỌC ĐƯỢC. Phải hiện tách hẳn khỏi
                     * "không có vấn đề" — gộp hai thứ đó là trấn an sai. */
                    chuaDocDuoc: (kq.thieu || []).length,
                })
            } catch (e: any) {
                cuaHang.push({
                    code: s.code, name: s.name, trangThai: s.status, laDemo: !!s.laDemo,
                    loi: String(e?.message || e).slice(0, 200),
                })
            } finally {
                if (!vonAm) traClient(s.schema)
            }
        }

        /* Xếp và đếm nằm ở src/lib/tongHopSucKhoe.ts để kiểm được — hai chỗ
         * sai im lặng nhất của màn hình giám sát. Xem scripts/check-tong-hop-
         * suc-khoe.ts (14 ca). */
        const { xepCuaHang, tomTatSucKhoe } = await import('../lib/tongHopSucKhoe')
        const daXep = xepCuaHang(cuaHang)

        const du = {
            ky: { from, to, soNgay },
            ...tomTatSucKhoe(daXep),
            cuaHang: daXep,
            chayLuc: new Date().toISOString(),
        }
        if (!chiMot) demSucKhoeHeThong = { luc: Date.now(), soNgay, du }
        res.json({ success: true, data: { ...du, tuDem: false } })
    } catch (e: any) {
        res.status(500).json({ success: false, error: String(e?.message || e) })
    }
})

/* ── Hai route CHẨN ĐOÁN đơn sàn (ghép lại từ bản đang chạy trên prod, 21/08).
 * Cây này ra đời trước nên không có; deploy mà thiếu là mất công cụ soi lệch
 * trạng thái giữa sổ Kengi và trạng thái thật bên sàn. ── */
// ─── GET /admin/repair-trace?storeCode= ─────────────────────────────────────
/**
 * CHỈ ĐỌC: soi vì sao "đổi mới không vào kho hư hỏng" — liệt kê phiếu sửa
 * gần nhất (kèm mốc ghi kho), thẻ kho referenceType='repair', và các dòng
 * tồn của kho hư hỏng (kể cả ÂM — di sản chiều sai trước 10/08).
 */
/**
 * GET /admin/online-status-probe?storeCode=  — CHỈ ĐỌC.
 * Soi đơn online "kẹt" trạng thái: gom theo (sàn, trạng thái Kengi) × tuổi đơn,
 * kèm mẫu đơn cũ nhất mỗi nhóm để đối chiếu với sàn. Đơn chưa kết thúc mà
 * quá 7–14 ngày là dấu hiệu Kengi lệch sàn (webhook trượt / trạng thái lạ
 * không có trong bảng map). Dùng để đo trước khi sửa (19/08/2026).
 */
router.get('/online-status-probe', async (req: Request, res: Response) => {
    try {
        const storeCode = String(req.query.storeCode || '').trim()
        if (!storeCode) return res.status(400).json({ success: false, error: 'Thiếu storeCode' })
        const store = await prisma.store.findFirst({
            where: { code: { equals: storeCode, mode: 'insensitive' } }, select: { schema: true },
        })
        if (!store) return res.status(404).json({ success: false, error: 'Không thấy cửa hàng' })
        const sp: any = getStorePrisma(store.schema)
        const rows: any[] = await sp.$queryRawUnsafe(`
            SELECT o.platform, o.status,
                   COUNT(*)::int AS tong,
                   COUNT(*) FILTER (WHERE o."createdAt" < now() - interval '7 days')::int  AS qua7,
                   COUNT(*) FILTER (WHERE o."createdAt" < now() - interval '14 days')::int AS qua14,
                   COUNT(*) FILTER (WHERE o."createdAt" < now() - interval '30 days')::int AS qua30,
                   MIN(o."createdAt") AS cuNhat,
                   MAX(o."updatedAt") AS capNhatMoiNhat
            FROM "OnlineOrder" o
            GROUP BY o.platform, o.status
            ORDER BY o.platform, tong DESC`)
        // mẫu 3 đơn cũ nhất của mỗi nhóm CHƯA kết thúc
        const ketThuc = ['COMPLETED','CANCELLED','completed','cancelled','TO_RETURN','returned']
        const mau: any[] = await sp.$queryRawUnsafe(`
            SELECT platform, status, "externalStatus", "orderNumber", "createdAt", "updatedAt", "deliveredAt" FROM (
              SELECT o.platform, o.status, o."externalStatus", o."orderNumber", o."createdAt", o."updatedAt", o."deliveredAt",
                     ROW_NUMBER() OVER (PARTITION BY o.platform, o.status ORDER BY o."createdAt")::int AS rn
              FROM "OnlineOrder" o
              WHERE NOT (o.status = ANY($1)) AND o."createdAt" < now() - interval '7 days'
            ) t WHERE rn <= 3 ORDER BY platform, status, "createdAt"`, ketThuc)
        // externalStatus (mã gốc sàn) nào KHÔNG khớp status đã map — nghi map thiếu
        const lech: any[] = await sp.$queryRawUnsafe(`
            SELECT o.platform, o."externalStatus", o.status, COUNT(*)::int AS tong
            FROM "OnlineOrder" o
            WHERE o."externalStatus" IS NOT NULL AND o."externalStatus" <> o.status
            GROUP BY 1,2,3 ORDER BY tong DESC LIMIT 40`)
        res.json({ success: true, theoTrangThai: rows, mauDonCu: mau, maGocKhacMap: lech })
    } catch (err: any) {
        res.status(500).json({ success: false, error: err?.message || String(err) })
    }
})

/**
 * GET /admin/online-live-check?storeCode=&orderNumber=  — CHỈ ĐỌC, không ghi.
 * Hỏi SÀN trạng thái hiện tại của một đơn (getOrderDetail bằng token của kênh)
 * rồi đặt cạnh trạng thái Kengi đang lưu — để phân biệt "Kengi lệch sàn" với
 * "sàn thật sự còn để trạng thái đó" trước khi sửa (19/08/2026).
 */
router.get('/online-live-check', async (req: Request, res: Response) => {
    try {
        const storeCode = String(req.query.storeCode || '').trim()
        const orderNumber = String(req.query.orderNumber || '').trim()
        if (!storeCode || !orderNumber) return res.status(400).json({ success: false, error: 'Thiếu storeCode/orderNumber' })
        const store = await prisma.store.findFirst({
            where: { code: { equals: storeCode, mode: 'insensitive' } }, select: { schema: true },
        })
        if (!store) return res.status(404).json({ success: false, error: 'Không thấy cửa hàng' })
        const sp: any = getStorePrisma(store.schema)
        const o = await sp.onlineOrder.findFirst({ where: { orderNumber }, include: { channel: true } })
        if (!o) return res.status(404).json({ success: false, error: 'Không thấy đơn' })
        const { getPlatformService } = await import('../services/platforms')
        const ch = o.channel
        const svc: any = getPlatformService(ch.platform, {
            apiKey: ch.apiKey || '', apiSecret: ch.apiSecret || '',
            accessToken: ch.accessToken || undefined, refreshToken: ch.refreshToken || undefined,
            shopId: ch.shopId || undefined, shopCipher: (ch as any).shopCipher || undefined,
        } as any)
        if (!svc) return res.status(400).json({ success: false, error: 'Sàn không hỗ trợ' })
        const eid = String(o.externalOrderId || '').replace(/^(SPE-|TIK-|LAZ-)/i, '')
        const live = await svc.getOrderDetail(eid)
        res.json({
            success: true,
            kengi: { status: o.status, externalStatus: o.externalStatus, updatedAt: o.updatedAt, deliveredAt: o.deliveredAt, syncedAt: (o as any).syncedAt },
            san: live ? { status: live.status, externalStatus: live.externalStatus, deliveredAt: live.deliveredAt, shippedAt: live.shippedAt } : null,
            lech: live ? live.status !== o.status : null,
        })
    } catch (err: any) {
        res.status(500).json({ success: false, error: err?.message || String(err) })
    }
})

export default router
