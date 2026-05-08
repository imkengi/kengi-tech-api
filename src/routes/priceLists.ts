import { Router, Request, Response } from 'express'
import { authMiddleware, getBranchFilter, AuthRequest, getBranchId } from '../middleware/auth'
import { requireRole } from '../middleware/roleMiddleware'
import { validate } from '../middleware/validate'
import { CreatePriceListSchema, UpdatePriceListSchema, CreatePriceRuleSchema, UpdatePriceRuleSchema } from '../schemas'
import { cacheGet, cacheSet, cacheDel } from '../lib/cache'

const router = Router()

// POST /api/price-lists/migrate — create PriceListItem table if not exists
router.post('/migrate', authMiddleware, requireRole('admin'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma! as any
        await prisma.$executeRawUnsafe(`
            CREATE TABLE IF NOT EXISTS "PriceListItem" (
                "id" TEXT NOT NULL,
                "priceListId" TEXT NOT NULL,
                "productId" TEXT NOT NULL,
                "price" DOUBLE PRECISION NOT NULL,
                CONSTRAINT "PriceListItem_pkey" PRIMARY KEY ("id"),
                CONSTRAINT "PriceListItem_priceListId_productId_key" UNIQUE ("priceListId", "productId"),
                CONSTRAINT "PriceListItem_priceListId_fkey" FOREIGN KEY ("priceListId") REFERENCES "PriceList"("id") ON DELETE CASCADE ON UPDATE CASCADE
            )
        `)
        await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "PriceListItem_priceListId_idx" ON "PriceListItem"("priceListId")`)
        await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "PriceListItem_productId_idx" ON "PriceListItem"("productId")`)
        res.json({ success: true, message: 'PriceListItem table created/verified' })
    } catch (err) {
        console.error('Migration error:', err)
        res.status(500).json({ success: false, error: 'Migration failed' })
    }
})

// GET /api/price-lists/stats
router.get('/stats', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const total = await prisma.priceList.count()
        const active = await prisma.priceList.count({ where: { active: true } })
        const totalRules = await prisma.priceRule.count()
        res.json({ success: true, data: { total, active, inactive: total - active, totalRules } })
    } catch { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// GET /api/price-lists — all price lists with rules
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const schema = req.user?.storeSchema || 'default'
        const cacheKey = `${schema}:priceLists:${JSON.stringify(req.query)}`
        const cached = await cacheGet(cacheKey)
        if (cached) return res.json(cached)
        const prisma = req.storePrisma!
        const lists = await prisma.priceList.findMany({
            include: { rules: { orderBy: { priority: 'asc' } } },
            orderBy: { createdAt: 'desc' },
        })
        const _response = { success: true, data: lists }
        await cacheSet(cacheKey, _response, 300)
        res.json(_response)
    } catch (err) {
        console.error('Get price lists error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// GET /api/price-lists/:id
router.get('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const list = await prisma.priceList.findUnique({
            where: { id: String(req.params.id) },
            include: { rules: { orderBy: { priority: 'asc' } } },
        })
        if (!list) { res.status(404).json({ success: false, error: 'Not found' }); return }
        res.json({ success: true, data: list })
    } catch (err) {
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// POST /api/price-lists — create price list
router.post('/', authMiddleware, requireRole('admin', 'manager'), validate(CreatePriceListSchema), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { name, description, currency, isDefault, active } = req.body
        if (!name?.trim()) { res.status(400).json({ success: false, error: 'Name required' }); return }

        // If setting as default, unset other defaults
        if (isDefault) {
            await prisma.priceList.updateMany({ where: { isDefault: true }, data: { isDefault: false } })
        }

        const list = await prisma.priceList.create({
            data: {
                name: name.trim(),
                description: description || null,
                currency: currency || 'VND',
                isDefault: isDefault || false,
                active: active !== false,
            },
            include: { rules: true },
        })
        cacheDel(`${req.user?.storeSchema || 'default'}:priceLists:*`).catch(() => { })
        res.status(201).json({ success: true, data: list })
    } catch (err) {
        console.error('Create price list error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// PUT /api/price-lists/:id — update price list
router.put('/:id', authMiddleware, requireRole('admin', 'manager'), validate(UpdatePriceListSchema), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const plId = String(req.params.id)
        const { name, description, currency, isDefault, active } = req.body
        const data: any = {}
        if (name !== undefined) data.name = name
        if (description !== undefined) data.description = description
        if (currency !== undefined) data.currency = currency
        if (active !== undefined) data.active = active
        if (isDefault !== undefined) {
            data.isDefault = isDefault
            if (isDefault) {
                await prisma.priceList.updateMany({ where: { isDefault: true, NOT: { id: plId } }, data: { isDefault: false } })
            }
        }

        const list = await prisma.priceList.update({
            where: { id: plId },
            data,
            include: { rules: true },
        })
        res.json({ success: true, data: list })
    } catch (err) {
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// DELETE /api/price-lists/:id
router.delete('/:id', authMiddleware, requireRole('admin', 'manager'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const plId = String(req.params.id)
        const list = await prisma.priceList.findUnique({ where: { id: plId } })
        if (list?.isDefault) { res.status(400).json({ success: false, error: 'Cannot delete default price list' }); return }
        await prisma.priceList.delete({ where: { id: plId } })
        cacheDel(`${req.user?.storeSchema || 'default'}:priceLists:*`).catch(() => { })
        res.json({ success: true })
    } catch (err) {
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ─── Price Rules ────────────────────────────────────────────────────────────

// POST /api/price-lists/:id/rules — add rule to a price list
router.post('/:id/rules', authMiddleware, requireRole('admin', 'manager'), validate(CreatePriceRuleSchema), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const plId = String(req.params.id)
        const { name, type, value, scope, scopeIds, appliesTo, priority, startDate, endDate, customerGroup, minQty, note } = req.body

        const rule = await prisma.priceRule.create({
            data: {
                priceListId: plId,
                name: name.trim(),
                type: type || 'discount',
                value: Number(value) || 0,
                scope: scope || 'all',
                scopeIds: scopeIds ? JSON.stringify(scopeIds) : null,
                appliesTo: appliesTo || 'sellingPrice',
                priority: Number(priority) || 1,
                startDate: startDate ? new Date(startDate) : new Date(),
                endDate: endDate ? new Date(endDate) : null,
                active: true,
                customerGroup: customerGroup || null,
                minQty: minQty ? Number(minQty) : null,
                note: note || null,
            },
        })
        cacheDel(`${req.user?.storeSchema || 'default'}:priceLists:*`).catch(() => { })
        res.status(201).json({ success: true, data: rule })
    } catch (err) {
        console.error('Create price rule error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// PUT /api/price-lists/rules/:ruleId — update a rule
router.put('/rules/:ruleId', authMiddleware, requireRole('admin', 'manager'), validate(UpdatePriceRuleSchema), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const ruleId = String(req.params.ruleId)
        const { name, type, value, scope, scopeIds, appliesTo, priority, startDate, endDate, active, customerGroup, minQty, note } = req.body
        const data: any = {}
        if (name !== undefined) data.name = name
        if (type !== undefined) data.type = type
        if (value !== undefined) data.value = Number(value)
        if (scope !== undefined) data.scope = scope
        if (scopeIds !== undefined) data.scopeIds = JSON.stringify(scopeIds)
        if (appliesTo !== undefined) data.appliesTo = appliesTo
        if (priority !== undefined) data.priority = Number(priority)
        if (startDate !== undefined) data.startDate = new Date(startDate)
        if (endDate !== undefined) data.endDate = endDate ? new Date(endDate) : null
        if (active !== undefined) data.active = active
        if (customerGroup !== undefined) data.customerGroup = customerGroup
        if (minQty !== undefined) data.minQty = minQty ? Number(minQty) : null
        if (note !== undefined) data.note = note

        const rule = await prisma.priceRule.update({ where: { id: ruleId }, data })
        res.json({ success: true, data: rule })
    } catch (err) {
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// DELETE /api/price-lists/rules/:ruleId
router.delete('/rules/:ruleId', authMiddleware, requireRole('admin', 'manager'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        await prisma.priceRule.delete({ where: { id: String(req.params.ruleId) } })
        res.json({ success: true })
    } catch (err) {
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ─── Price List Items (direct product prices) ──────────────────────────────

// GET /api/price-lists/:id/items — get products + prices in a price list
router.get('/:id/items', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const plId = String(req.params.id)
        const search = String(req.query.search || '')

        const items = await prisma.priceListItem.findMany({
            where: { priceListId: plId },
            orderBy: { productId: 'asc' },
        })

        // Fetch product details for each item
        const productIds = items.map(i => i.productId)
        const products = productIds.length > 0
            ? await prisma.product.findMany({
                where: { id: { in: productIds } },
                select: { id: true, name: true, sku: true, sellingPrice: true, costPrice: true, categoryId: true, category: { select: { name: true } } },
            })
            : []

        const productMap = new Map(products.map(p => [p.id, p]))

        let result = items.map(item => {
            const prod = productMap.get(item.productId)
            return {
                id: item.id,
                productId: item.productId,
                price: item.price,
                productName: prod?.name || 'Sản phẩm đã xóa',
                sku: prod?.sku || '',
                sellingPrice: prod?.sellingPrice || 0,
                costPrice: prod?.costPrice || 0,
                categoryName: prod?.category?.name || '',
            }
        })

        // Search filter
        if (search) {
            const s = search.toLowerCase()
            result = result.filter(r => r.productName.toLowerCase().includes(s) || r.sku.toLowerCase().includes(s))
        }

        res.json({ success: true, data: result })
    } catch (err) {
        console.error('Get price list items error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// PUT /api/price-lists/:id/items — bulk upsert product prices
router.put('/:id/items', authMiddleware, requireRole('admin', 'manager'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const plId = String(req.params.id)
        const { items } = req.body as { items: { productId: string; price: number }[] }

        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ success: false, error: 'Items array required' })
        }

        // Upsert each item
        const results = await Promise.all(
            items.map(item =>
                prisma.priceListItem.upsert({
                    where: { priceListId_productId: { priceListId: plId, productId: item.productId } },
                    create: { priceListId: plId, productId: item.productId, price: Number(item.price) },
                    update: { price: Number(item.price) },
                })
            )
        )

        cacheDel(`${req.user?.storeSchema || 'default'}:priceLists:*`).catch(() => { })
        res.json({ success: true, data: { updated: results.length } })
    } catch (err) {
        console.error('Update price list items error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// DELETE /api/price-lists/:id/items/:productId — remove product from price list
router.delete('/:id/items/:productId', authMiddleware, requireRole('admin', 'manager'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const plId = String(req.params.id)
        const productId = String(req.params.productId)

        await prisma.priceListItem.delete({
            where: { priceListId_productId: { priceListId: plId, productId } },
        })
        cacheDel(`${req.user?.storeSchema || 'default'}:priceLists:*`).catch(() => { })
        res.json({ success: true })
    } catch (err) {
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

export default router
