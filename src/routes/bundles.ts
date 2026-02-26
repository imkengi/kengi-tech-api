import { Router, Request, Response } from 'express'
import prisma from '../lib/prisma'
import { authMiddleware } from '../middleware/auth'

const router = Router()

// GET /api/bundles
router.get('/', authMiddleware, async (req: Request, res: Response) => {
    try {
        const { active, category, search } = req.query
        const where: any = {}
        if (active === 'true') where.active = true
        if (active === 'false') where.active = false
        if (category && category !== 'all') where.category = category
        if (search) where.name = { contains: String(search) }

        const bundles = await prisma.bundle.findMany({ where, orderBy: { createdAt: 'desc' } })
        const data = bundles.map(b => ({ ...b, items: JSON.parse(b.items || '[]') }))
        res.json({ success: true, data })
    } catch (err) {
        console.error('Get bundles error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// POST /api/bundles
router.post('/', authMiddleware, async (req: Request, res: Response) => {
    try {
        const { name, category, items, originalTotal, bundlePrice, discount, active, validUntil, maxUsage } = req.body
        if (!name?.trim()) return res.status(400).json({ success: false, error: 'Bundle name required' })

        const bundle = await prisma.bundle.create({
            data: {
                name: name.trim(),
                category: category || null,
                items: JSON.stringify(items || []),
                originalTotal: Number(originalTotal) || 0,
                bundlePrice: Number(bundlePrice) || 0,
                discount: Number(discount) || 0,
                active: active !== false,
                validUntil: validUntil ? new Date(validUntil) : null,
                maxUsage: maxUsage ? Number(maxUsage) : null,
            },
        })
        res.status(201).json({ success: true, data: { ...bundle, items: JSON.parse(bundle.items) } })
    } catch (err) {
        console.error('Create bundle error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// PUT /api/bundles/:id
router.put('/:id', authMiddleware, async (req: Request, res: Response) => {
    try {
        const { name, category, items, originalTotal, bundlePrice, discount, active, soldCount, validUntil, maxUsage } = req.body
        const data: any = {}
        if (name !== undefined) data.name = name
        if (category !== undefined) data.category = category
        if (items !== undefined) data.items = JSON.stringify(items)
        if (originalTotal !== undefined) data.originalTotal = Number(originalTotal)
        if (bundlePrice !== undefined) data.bundlePrice = Number(bundlePrice)
        if (discount !== undefined) data.discount = Number(discount)
        if (active !== undefined) data.active = active
        if (soldCount !== undefined) data.soldCount = Number(soldCount)
        if (validUntil !== undefined) data.validUntil = validUntil ? new Date(validUntil) : null
        if (maxUsage !== undefined) data.maxUsage = maxUsage ? Number(maxUsage) : null

        const bundle = await prisma.bundle.update({ where: { id: req.params.id }, data })
        res.json({ success: true, data: { ...bundle, items: JSON.parse(bundle.items) } })
    } catch (err) {
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// DELETE /api/bundles/:id
router.delete('/:id', authMiddleware, async (req: Request, res: Response) => {
    try {
        await prisma.bundle.delete({ where: { id: req.params.id } })
        res.json({ success: true })
    } catch (err) {
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

export default router
