import { Router, Request, Response } from 'express'
import { authMiddleware, getBranchFilter, AuthRequest, getBranchId } from '../middleware/auth'
import { requireRole } from '../middleware/roleMiddleware'
import { validate } from '../middleware/validate'
import { CreatePriceListSchema, UpdatePriceListSchema, CreatePriceRuleSchema, UpdatePriceRuleSchema } from '../schemas'
import { cacheGet, cacheSet, cacheDel } from '../lib/cache'

const router = Router()

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
        await cacheSet(cacheKey, _response, 120)
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
        cacheDel(`${req.user?.storeSchema || 'default'}:priceLists:*`).catch(() => {})
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
        cacheDel(`${req.user?.storeSchema || 'default'}:priceLists:*`).catch(() => {})
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
        cacheDel(`${req.user?.storeSchema || 'default'}:priceLists:*`).catch(() => {})
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

export default router
