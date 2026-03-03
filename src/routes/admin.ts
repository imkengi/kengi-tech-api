import { Router, Request, Response, NextFunction } from 'express'
import { registryPrisma, getStorePrisma, dropStoreSchema } from '../lib/prisma'

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

        // Enrich each store with branchCount + userCount from its schema
        const items = await Promise.all(rawItems.map(async (store) => {
            let branchCount = 0
            let userCount = 0
            let branches: any[] = []
            try {
                const sp = getStorePrisma(store.schema)
                const [bList, uCount] = await Promise.all([
                    sp.branch.findMany({ select: { id: true, name: true, code: true, status: true }, take: 10 }),
                    sp.user.count(),
                ])
                branches = bList
                branchCount = bList.length
                userCount = uCount
            } catch { /* schema not initialized yet */ }
            return { ...store, branchCount, userCount, branches }
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
        console.log(`[Admin] Store ${store.code} status → ${status}`)
        res.json({ success: true, data: updated })
    } catch (err) {
        console.error('Admin update status error:', err)
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
        await Promise.all(stores.map(async (store) => {
            try {
                const sp = getStorePrisma(store.schema)
                const users = await sp.user.findMany({ include: { branch: { select: { name: true } } } })
                users.forEach(u => allUsers.push({
                    ...u, storeName: store.name, storeCode: store.code, _storeSchema: store.schema,
                    branchName: (u as any).branch?.name || null
                }))
            } catch { /* schema not ready */ }
        }))
        res.json({ success: true, data: allUsers })
    } catch (err) {
        console.error('Admin list users error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ─── PUT /admin/users/:id — Update a user (cross-schema lookup) ─────────────
router.put('/users/:id', async (req: Request, res: Response) => {
    try {
        const { id } = req.params
        const { password, phone, email } = req.body
        const stores = await prisma.store.findMany()
        let found = false
        for (const store of stores) {
            try {
                const sp = getStorePrisma(store.schema)
                const user = await sp.user.findUnique({ where: { id: String(id) } })
                if (user) {
                    const data: any = {}
                    if (password) {
                        const bcrypt = await import('bcryptjs')
                        data.password = await bcrypt.hash(password, 10)
                    }
                    if (phone !== undefined) data.phone = phone
                    if (email !== undefined) data.email = email
                    await sp.user.update({ where: { id: String(id) }, data })
                    found = true
                    break
                }
            } catch { /* skip */ }
        }
        if (!found) return res.status(404).json({ success: false, error: 'User not found' })
        res.json({ success: true, message: 'Đã cập nhật' })
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
        await Promise.all(stores.map(async (store) => {
            try {
                const sp = getStorePrisma(store.schema)
                const rows: any[] = await (sp as any).$queryRawUnsafe(
                    `SELECT * FROM "BranchRequest" ${statusFilter !== 'all' ? `WHERE "status" = $1` : ''} ORDER BY "createdAt" DESC`,
                    ...(statusFilter === 'all' ? [] : [statusFilter])
                ).catch(() => [])
                rows.forEach(r => allRequests.push({ ...r, storeName: store.name, storeCode: store.code, _storeSchema: store.schema }))
            } catch { /* table might not exist */ }
        }))
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
        await Promise.all(stores.map(async (store) => {
            try {
                const sp = getStorePrisma(store.schema)
                const rows: any[] = await (sp as any).$queryRawUnsafe(
                    `SELECT * FROM "BranchDeleteRequest" ${statusFilter !== 'all' ? `WHERE "status" = $1` : ''} ORDER BY "createdAt" DESC`,
                    ...(statusFilter === 'all' ? [] : [statusFilter])
                ).catch(() => [])
                rows.forEach(r => allRequests.push({ ...r, storeName: store.name, storeCode: store.code, _storeSchema: store.schema }))
            } catch { /* table might not exist */ }
        }))
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

        // Store schema migrations — platform fees
        const stores = await prisma.store.findMany({ select: { schema: true, name: true } }) as any[]
        const storeResults: string[] = []
        for (const store of stores) {
            try {
                const sp = getStorePrisma(store.schema)
                await (sp as any).$executeRawUnsafe(`ALTER TABLE "OnlineOrder" ADD COLUMN IF NOT EXISTS "platformFee" DOUBLE PRECISION NOT NULL DEFAULT 0`)
                await (sp as any).$executeRawUnsafe(`ALTER TABLE "OnlineOrder" ADD COLUMN IF NOT EXISTS "platformFeeRate" DOUBLE PRECISION NOT NULL DEFAULT 0`)
                await (sp as any).$executeRawUnsafe(`ALTER TABLE "OnlineOrder" ADD COLUMN IF NOT EXISTS "netRevenue" DOUBLE PRECISION NOT NULL DEFAULT 0`)
                await (sp as any).$executeRawUnsafe(`ALTER TABLE "OnlineChannel" ADD COLUMN IF NOT EXISTS "commissionRate" DOUBLE PRECISION NOT NULL DEFAULT 6`)
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
            try {
                // Run prisma db push for this store's schema
                const base = (process.env.DATABASE_URL || '').replace(/[?&]schema=[^&]*/g, '').replace(/\?$/, '')
                const sep = base.includes('?') ? '&' : '?'
                const schemaUrl = `${base}${sep}schema=${store.schema}`

                const { execSync } = require('child_process')
                execSync('npx prisma db push --schema=prisma/schema-store.prisma --skip-generate --accept-data-loss', {
                    stdio: 'pipe',
                    env: { ...process.env, STORE_DATABASE_URL: schemaUrl, DATABASE_URL: schemaUrl },
                    timeout: 30000,
                })
                results.push({ store: store.code, schema: store.schema, status: 'ok' })
                console.log(`✅ Schema synced: ${store.code} (${store.schema})`)
            } catch (err: any) {
                results.push({ store: store.code, schema: store.schema, status: `error: ${err?.message?.slice(0, 100)}` })
                console.error(`❌ Schema sync failed: ${store.code}`, err?.message?.slice(0, 200))
            }
        }

        res.json({ success: true, synced: results.filter(r => r.status === 'ok').length, total: stores.length, results })
    } catch (err) {
        console.error('Sync schemas error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

export default router
