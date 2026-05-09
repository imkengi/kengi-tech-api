import { Router, Request, Response } from 'express'
import { authMiddleware, getBranchFilter, AuthRequest, getBranchId } from '../middleware/auth'
import { requireRole } from '../middleware/roleMiddleware'
import { validate } from '../middleware/validate'
import { CreatePromotionSchema, UpdatePromotionSchema } from '../schemas'
import { cacheGet, cacheSet, cacheDel } from '../lib/cache'

const router = Router()

// GET /api/promotions/stats
router.get('/stats', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const all = await prisma.promotion.findMany({ select: { status: true, type: true } })
        const byType: Record<string, number> = {}
        const byStatus: Record<string, number> = {}
        for (const p of all) {
            byType[p.type] = (byType[p.type] || 0) + 1
            byStatus[p.status] = (byStatus[p.status] || 0) + 1
        }
        res.json({ success: true, data: { total: all.length, byType, byStatus } })
    } catch { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// GET /api/promotions
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const schema = req.user?.storeSchema || 'default'
        const cacheKey = `${schema}:promotions:${JSON.stringify(req.query)}`
        const cached = await cacheGet(cacheKey)
        const prisma = req.storePrisma!
        const { search, status, type, page = '1', pageSize = '20' } = req.query

        const where: any = {}
        if (search) {
            where.OR = [
                { name: { contains: search as string, mode: 'insensitive' } },
                { code: { contains: search as string, mode: 'insensitive' } },
            ]
        }
        if (status && status !== 'all') where.status = status
        if (type && type !== 'all') where.type = type

        const pageNum = Math.max(1, parseInt(page as string))
        const size = Math.max(1, Math.min(100, parseInt(pageSize as string)))
        const skip = (pageNum - 1) * size

        const [total, promotions] = await Promise.all([
            prisma.promotion.count({ where }),
            prisma.promotion.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                skip,
                take: size,
            }),
        ])

        // Derive the real usage count for each promotion on this page from the audit
        // trail on Transaction.appliedPromotionIds. Falls back to the stored
        // Promotion.usageCount counter if the aggregate fails or returns nothing
        // (e.g. legacy receipts created before audit-trail tracking landed).
        const derivedCounts = new Map<string, number>()
        if (promotions.length > 0) {
            try {
                const ids = promotions.map(p => p.id)
                const rows = await prisma.$queryRaw<Array<{ promo_id: string; uses: bigint | number }>>`
                    SELECT elem AS promo_id, COUNT(*)::bigint AS uses
                    FROM "Transaction" t,
                         jsonb_array_elements_text(t."appliedPromotionIds"::jsonb) elem
                    WHERE t."appliedPromotionIds" IS NOT NULL
                      AND elem = ANY(${ids}::text[])
                    GROUP BY elem
                `
                for (const r of rows) derivedCounts.set(r.promo_id, Number(r.uses))
            } catch (aggErr) {
                console.warn('[Promotions] usageCount derivation failed, falling back to stored counter:', aggErr)
            }
        }

        const data = promotions.map(p => ({
            ...p,
            usageCount: Math.max(p.usageCount || 0, derivedCounts.get(p.id) || 0),
            categoryIds: p.categoryIds ? JSON.parse(p.categoryIds) : [],
            productIds: p.productIds ? JSON.parse(p.productIds) : [],
            startDate: p.startDate.toISOString(),
            endDate: p.endDate.toISOString(),
            createdAt: p.createdAt.toISOString(),
            updatedAt: p.updatedAt.toISOString(),
        }))

        res.json({
            data,
            total,
            page: pageNum,
            pageSize: size,
            totalPages: Math.ceil(total / size),
        })
    } catch (err) {
        console.error('Get promotions error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// POST /api/promotions
router.post('/', authMiddleware, requireRole('admin', 'manager'), validate(CreatePromotionSchema), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { categoryIds, productIds, startDate, endDate, ...data } = req.body

        const promotion = await prisma.promotion.create({
            data: {
                ...data,
                startDate: new Date(startDate),
                endDate: new Date(endDate),
                categoryIds: categoryIds ? JSON.stringify(categoryIds) : null,
                productIds: productIds ? JSON.stringify(productIds) : null,
            },
        })

        cacheDel(`${req.user?.storeSchema || 'default'}:promotions:*`).catch(() => { })
        res.status(201).json({
            success: true,
            data: {
                ...promotion,
                categoryIds: promotion.categoryIds ? JSON.parse(promotion.categoryIds) : [],
                productIds: promotion.productIds ? JSON.parse(promotion.productIds) : [],
                startDate: promotion.startDate.toISOString(),
                endDate: promotion.endDate.toISOString(),
                createdAt: promotion.createdAt.toISOString(),
                updatedAt: promotion.updatedAt.toISOString(),
            },
        })
    } catch (err) {
        console.error('Create promotion error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// PUT /api/promotions/:id
router.put('/:id', authMiddleware, requireRole('admin', 'manager'), validate(UpdatePromotionSchema), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { categoryIds, productIds, startDate, endDate, ...updates } = req.body
        const promoId = String(req.params.id)

        const data: any = { ...updates }
        if (startDate) data.startDate = new Date(startDate)
        if (endDate) data.endDate = new Date(endDate)
        if (categoryIds !== undefined) data.categoryIds = JSON.stringify(categoryIds)
        if (productIds !== undefined) data.productIds = JSON.stringify(productIds)

        const promotion = await prisma.promotion.update({
            where: { id: promoId },
            data,
        })

        res.json({
            success: true,
            data: {
                ...promotion,
                categoryIds: promotion.categoryIds ? JSON.parse(promotion.categoryIds) : [],
                productIds: promotion.productIds ? JSON.parse(promotion.productIds) : [],
                startDate: promotion.startDate.toISOString(),
                endDate: promotion.endDate.toISOString(),
                createdAt: promotion.createdAt.toISOString(),
                updatedAt: promotion.updatedAt.toISOString(),
            },
        })
    } catch (err) {
        console.error('Update promotion error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// DELETE /api/promotions/:id
router.delete('/:id', authMiddleware, requireRole('admin', 'manager'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        await prisma.promotion.delete({ where: { id: String(req.params.id) } })
        res.json({ success: true, message: 'Promotion deleted' })
    } catch (err) {
        console.error('Delete promotion error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

export default router
