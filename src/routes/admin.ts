import { Router, Request, Response, NextFunction } from 'express'
import { registryPrisma, getStorePrisma, dropStoreSchema, mapWithConcurrency } from '../lib/prisma'
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
            res.status(500).json({ success: false, error: err?.message || 'Reset failed' })
        }
    })
} else {
    router.post('/reset-db', (_req: Request, res: Response) => {
        res.status(403).json({ success: false, error: 'This endpoint is disabled in production' })
    })
}

// ─── POST /admin/migrate — Add new columns to registry + store schemas ───────
router.post('/migrate', async (_req: Request, res: Response) => {
    try {
        // Registry migrations
        await (prisma as any).$executeRawUnsafe(`ALTER TABLE "Store" ADD COLUMN IF NOT EXISTS "plan" TEXT NOT NULL DEFAULT 'full'`)
        await (prisma as any).$executeRawUnsafe(`ALTER TABLE "Store" ADD COLUMN IF NOT EXISTS "addOns" TEXT NOT NULL DEFAULT '[]'`)
        await (prisma as any).$executeRawUnsafe(`ALTER TABLE "Store" ADD COLUMN IF NOT EXISTS "extraBranches" INTEGER NOT NULL DEFAULT 0`)

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

                storeResults.push(`${store.name}: OK`)
            } catch (e: any) {
                storeResults.push(`${store.name}: ${e.message}`)
            }
        }

        res.json({ success: true, message: 'Migration complete', storeResults })
    } catch (err: any) {
        console.error('Migration error:', err)
        res.status(500).json({ success: false, error: err?.message || 'Migration failed' })
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
