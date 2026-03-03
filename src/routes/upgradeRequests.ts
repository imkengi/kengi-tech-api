import { Router, Response } from 'express'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { registryPrisma } from '../lib/prisma'
import { cacheGet, cacheSet, cacheDel } from '../lib/cache'

const router = Router()

// ─── POST /api/upgrade-requests — Submit upgrade request ────────────────────
router.post('/', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { requestedPlan, addOns, extraBranches, monthlyTotal } = req.body

        if (!requestedPlan || !['retail', 'wholesale', 'full'].includes(requestedPlan)) {
            return res.status(400).json({ success: false, error: 'Gói không hợp lệ (retail/wholesale/full)' })
        }

        // Get current plan from registry
        const storeCode = req.user?.storeCode
        if (!storeCode) return res.status(400).json({ success: false, error: 'Missing store code' })

        const store = await registryPrisma.store.findUnique({ where: { code: storeCode } }) as any
        if (!store) return res.status(404).json({ success: false, error: 'Store not found in registry' })

        // Check if there's already a pending request
        const existingPending = await (prisma as any).$queryRawUnsafe(`
            SELECT id FROM "UpgradeRequest" WHERE status = 'pending' LIMIT 1
        `).catch(() => [])
        if (existingPending?.length > 0) {
            return res.status(409).json({ success: false, error: 'Đã có yêu cầu nâng cấp đang chờ duyệt' })
        }

        // Get requester name
        const user = await prisma.user.findUnique({ where: { id: req.user!.userId }, select: { name: true } })

        // Ensure table exists
        await (prisma as any).$executeRawUnsafe(`
            CREATE TABLE IF NOT EXISTS "UpgradeRequest" (
                "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
                "storeCode" TEXT NOT NULL,
                "storeName" TEXT NOT NULL DEFAULT '',
                "requestedBy" TEXT NOT NULL DEFAULT '',
                "requestedByName" TEXT NOT NULL DEFAULT '',
                "currentPlan" TEXT NOT NULL DEFAULT 'full',
                "requestedPlan" TEXT NOT NULL,
                "addOns" TEXT NOT NULL DEFAULT '[]',
                "extraBranches" INTEGER NOT NULL DEFAULT 0,
                "monthlyTotal" INTEGER NOT NULL DEFAULT 0,
                "status" TEXT NOT NULL DEFAULT 'pending',
                "rejectedReason" TEXT,
                "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT "UpgradeRequest_pkey" PRIMARY KEY ("id")
            )
        `)

        const id = `upg-${Date.now()}`
        await (prisma as any).$executeRawUnsafe(`
            INSERT INTO "UpgradeRequest" ("id", "storeCode", "storeName", "requestedBy", "requestedByName", "currentPlan", "requestedPlan", "addOns", "extraBranches", "monthlyTotal", "status")
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending')
        `, id, storeCode, store.name || '', req.user!.userId, user?.name || '',
            store.plan || 'full', requestedPlan,
            JSON.stringify(addOns || []), extraBranches || 0, monthlyTotal || 0
        )

        cacheDel(`${req.user?.storeSchema || 'default'}:upgradeRequests:*`).catch(() => {})
        res.status(201).json({
            success: true,
            data: { id, status: 'pending' },
            message: 'Yêu cầu nâng cấp đã được gửi, vui lòng chờ superadmin duyệt',
        })
    } catch (err) {
        console.error('Create upgrade request error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ─── GET /api/upgrade-requests — List my store's upgrade requests ───────────
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const schema = req.user?.storeSchema || 'default'
        const cacheKey = `${schema}:upgradeRequests:${JSON.stringify(req.query)}`
        const cached = await cacheGet(cacheKey)
        if (cached) return res.json(cached)
        const prisma = req.storePrisma!

        // Ensure table exists first
        await (prisma as any).$executeRawUnsafe(`
            CREATE TABLE IF NOT EXISTS "UpgradeRequest" (
                "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
                "storeCode" TEXT NOT NULL,
                "storeName" TEXT NOT NULL DEFAULT '',
                "requestedBy" TEXT NOT NULL DEFAULT '',
                "requestedByName" TEXT NOT NULL DEFAULT '',
                "currentPlan" TEXT NOT NULL DEFAULT 'full',
                "requestedPlan" TEXT NOT NULL,
                "addOns" TEXT NOT NULL DEFAULT '[]',
                "extraBranches" INTEGER NOT NULL DEFAULT 0,
                "monthlyTotal" INTEGER NOT NULL DEFAULT 0,
                "status" TEXT NOT NULL DEFAULT 'pending',
                "rejectedReason" TEXT,
                "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT "UpgradeRequest_pkey" PRIMARY KEY ("id")
            )
        `).catch(() => { })

        const requests = await (prisma as any).$queryRawUnsafe(`
            SELECT * FROM "UpgradeRequest" ORDER BY "createdAt" DESC
        `).catch(() => [])

        const _response = { success: true, data: requests || [] }
        await cacheSet(cacheKey, _response, 120)
        res.json(_response)
    } catch (err) {
        console.error('List upgrade requests error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ─── DELETE /api/upgrade-requests/:id — Cancel pending request ──────────────
router.delete('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const id = req.params.id

        await (prisma as any).$executeRawUnsafe(`
            DELETE FROM "UpgradeRequest" WHERE "id" = $1 AND "status" = 'pending'
        `, id)

        res.json({ success: true, message: 'Đã hủy yêu cầu nâng cấp' })
    } catch (err) {
        console.error('Cancel upgrade request error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

export default router
