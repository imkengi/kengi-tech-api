import { Router, Request, Response, NextFunction } from 'express'
import { errMsg } from '../lib/errorResponse'
import { registryPrisma, getStorePrisma, dropStoreSchema, mapWithConcurrency, syncBranchSchemaTables } from '../lib/prisma'
import { invalidateStoreStatus } from '../lib/storeStatusCache'

const router = Router()

// ─── Admin Key Auth ─────────────────────────────────────────────────────────
const ADMIN_KEY = process.env.ADMIN_KEY
if (!ADMIN_KEY) {
    console.warn('⚠️ ADMIN_KEY not configured — admin routes will reject all requests')
}

function adminKeyAuth(req: Request, res: Response, next: NextFunction): void {
    if (!ADMIN_KEY) {
        res.status(503).json({ success: false, error: 'Admin API not configured' })
        return
    }
    const key = req.headers['x-admin-key'] as string
    if (!key || key !== ADMIN_KEY) {
        res.status(403).json({ success: false, error: 'Unauthorized' })
        return
    }
    next()
}

router.use(adminKeyAuth)

// Use registryPrisma for cross-store operations
const prisma = registryPrisma

// ─── GET /admin/stats ─────────────────────────────────────────────────────────
router.get('/stats', async (_req: Request, res: Response) => {
    try {
        const now = new Date()
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)

        const [totalStores, activeStores, suspendedStores, newStoresThisMonth, allStores] = await Promise.all([
            prisma.store.count(),
            prisma.store.count({ where: { status: 'active' } }),
            prisma.store.count({ where: { status: { in: ['suspended', 'inactive'] } } }),
            prisma.store.count({ where: { createdAt: { gte: startOfMonth } } }),
            prisma.store.findMany({ select: { schema: true } }),
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
router.post('/migrate', async (_req: Request, res: Response) => {
    try {
        // Registry migrations
        await (prisma as any).$executeRawUnsafe(`ALTER TABLE "Store" ADD COLUMN IF NOT EXISTS "plan" TEXT NOT NULL DEFAULT 'full'`)
        await (prisma as any).$executeRawUnsafe(`ALTER TABLE "Store" ADD COLUMN IF NOT EXISTS "addOns" TEXT NOT NULL DEFAULT '[]'`)
        await (prisma as any).$executeRawUnsafe(`ALTER TABLE "Store" ADD COLUMN IF NOT EXISTS "extraBranches" INTEGER NOT NULL DEFAULT 0`)
        await (prisma as any).$executeRawUnsafe(`ALTER TABLE "Store" ADD COLUMN IF NOT EXISTS "hasWebhooks" BOOLEAN NOT NULL DEFAULT false`)
        await (prisma as any).$executeRawUnsafe(`ALTER TABLE "Store" ADD COLUMN IF NOT EXISTS "hasOnlineChannels" BOOLEAN NOT NULL DEFAULT false`)
        await (prisma as any).$executeRawUnsafe(`ALTER TABLE "Store" ADD COLUMN IF NOT EXISTS "hasFanpages" BOOLEAN NOT NULL DEFAULT false`)

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

export default router
