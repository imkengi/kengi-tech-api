import { Router, Request, Response, NextFunction } from 'express'
import crypto from 'crypto'
import jwt from 'jsonwebtoken'
import { errMsg } from '../lib/errorResponse'
import { registryPrisma, getStorePrisma, dropStoreSchema, mapWithConcurrency, syncBranchSchemaTables } from '../lib/prisma'
import { chayTheoDot } from '../lib/poolGuard'
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

        // Store schema migrations — platform fees + geocode
        const stores = await prisma.store.findMany({ select: { schema: true, name: true } }) as any[]
        const storeResults: string[] = []
        for (const store of stores) {
            try {
                const sp = getStorePrisma(store.schema)
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

                // Repair ↔ hoá đơn bán + nối khách theo id (2026-08-13)
                await (sp as any).$executeRawUnsafe(`ALTER TABLE "Repair" ADD COLUMN IF NOT EXISTS "customerId" TEXT`)
                await (sp as any).$executeRawUnsafe(`ALTER TABLE "Repair" ADD COLUMN IF NOT EXISTS "transactionId" TEXT`)
                await (sp as any).$executeRawUnsafe(`ALTER TABLE "Repair" ADD COLUMN IF NOT EXISTS "soldReceiptNumber" TEXT`)

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
// ─── POST /admin/sync-schemas ─────────────────────────────────────────────────
// Push latest Prisma schema to all existing store databases (adds missing tables)
router.post('/sync-schemas', async (_req: Request, res: Response) => {
    try {
        const stores = await prisma.store.findMany({ select: { id: true, name: true, schema: true, code: true } })
        const results: { store: string; schema: string; status: string }[] = []

        for (const store of stores) {
            // Schema names come from the registry and are restricted to safe identifier
            // chars by createBranchSchema; this guard is belt-and-suspenders before
            // interpolating into raw DDL.
            if (!/^[a-z0-9_]+$/i.test(store.schema)) {
                results.push({ store: store.code, schema: store.schema, status: 'error: invalid schema name' })
                continue
            }
            try {
                await prisma.$executeRawUnsafe(`ALTER TABLE "${store.schema}"."SalesTripItem" ADD COLUMN IF NOT EXISTS "actualQty" INTEGER NOT NULL DEFAULT 0`)
                await prisma.$executeRawUnsafe(`ALTER TABLE "${store.schema}"."SalesTripItem" ADD COLUMN IF NOT EXISTS "damagedQty" INTEGER NOT NULL DEFAULT 0`)
                results.push({ store: store.code, schema: store.schema, status: 'ok' })
                console.log(`✅ Schema synced: ${store.code} (${store.schema})`)
            } catch (err: any) {
                results.push({ store: store.code, schema: store.schema, status: `error: ${err?.message?.slice(0, 200)}` })
                console.error(`❌ Schema sync failed: ${store.code}`, err?.message?.slice(0, 400))
            }
        }

        res.json({ success: true, synced: results.filter(r => r.status === 'ok').length, total: stores.length, results })
    } catch (err) {
        console.error('Sync schemas error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

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
                    fetch(reqCountUrl, { headers: { Authorization: `Bearer ${accessToken}` } }).then(r => r.json()).catch(() => null),
                    fetch(latencyUrl, { headers: { Authorization: `Bearer ${accessToken}` } }).then(r => r.json()).catch(() => null),
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
router.get('/store-health', async (req: Request, res: Response) => {
    try {
        const storeCode = String(req.query.storeCode || 'KENGISTORE').trim()
        const store = await prisma.store.findFirst({ where: { code: storeCode }, select: { code: true, schema: true } })
        if (!store) { res.status(404).json({ success: false, error: 'Store not found' }); return }
        const sp = getStorePrisma(store.schema)

        const OPEN = `LOWER(ro.status) IN ('pending','approved','processing','refunded')`
        const [channels, refundedNotReversed, invoicedButReturned, openInQueue] = await Promise.all([
            sp.$queryRawUnsafe(`
                SELECT name, platform, status,
                       to_char("lastSyncAt",'YYYY-MM-DD HH24:MI') AS "lastSyncAt",
                       to_char("tokenExpiresAt" + interval '7 hours','YYYY-MM-DD') AS "tokenExpiresAt"
                FROM "OnlineChannel" ORDER BY platform, name`),
            sp.$queryRawUnsafe(`
                SELECT COUNT(*)::int AS n
                FROM "ReturnOrder" ro JOIN "OnlineOrder" o ON o."orderNumber" = ro."originalInvoice"
                WHERE LOWER(ro.status) = 'refunded' AND o.status NOT IN ('returned','cancelled','CANCELLED')`),
            sp.$queryRawUnsafe(`
                SELECT ro.code, ro.status, o."orderNumber", o.platform,
                       ro."totalRefund"::float8 AS refund, e."invoiceNumber"
                FROM "ReturnOrder" ro
                JOIN "OnlineOrder" o ON o."orderNumber" = ro."originalInvoice"
                JOIN "Transaction" t ON t."receiptNumber" = ('ONLINE-' || o."orderNumber")
                JOIN "EInvoice" e ON e."transactionId" = t.id AND e.status IN ('issued','SENT')
                WHERE ${OPEN} ORDER BY ro."createdAt" DESC LIMIT 50`),
            sp.$queryRawUnsafe(`
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
// Chẩn đoán thông báo: ?storeCode=… → 5 bản ghi Notification mới nhất + số
// client SSE đang mở trên INSTANCE này; &emit=1 bắn thử 'einvoice_issued' vào
// key schema của store để xem web có nhận không.
router.get('/notif-probe', async (req: Request, res: Response) => {
    try {
        const storeCode = String(req.query.storeCode || 'KENGISTORE').trim()
        const store = await prisma.store.findFirst({ where: { code: storeCode }, select: { schema: true } })
        if (!store) { res.status(404).json({ success: false, error: 'store?' }); return }
        const sp = getStorePrisma(store.schema) as any
        const { sseStats, sendNotification, sendPushToStore, ensureDeviceTokenTable } = await import('./notifications')
        const rows = await sp.notification.findMany({ orderBy: { createdAt: 'desc' }, take: 5 }).catch((e: any) => `LOI: ${e?.message}`)
        const out: any = { schema: store.schema, sseClients: sseStats(), notifRows: rows }
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
            out.emitted = sendNotification(store.schema, 'einvoice_issued', {
                title: '🧾 TEST đẩy thông báo', message: `Bắn thử lúc ${new Date().toISOString()}`,
            })
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
            apiUrl: String(cfg.apiUrl || cfg.baseUrl || ''),
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
                    mau: trung.slice(0, 5).map(v => ({
                        nhaCungCap: v[0].supplierName || v[0].supplierId,
                        soHoaDon: v[0].vatInvoiceNo,
                        phieu: v.map((r: any) => ({ code: r.code, tien: Math.round(Number(r.totalCost) || 0), ngay: new Date(r.createdAt).toISOString().slice(0, 10) })),
                    })),
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

export default router
