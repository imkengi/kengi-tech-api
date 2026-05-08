import { Router, Response } from 'express'
import { authMiddleware, getBranchFilter, AuthRequest } from '../middleware/auth'
import { validate } from '../middleware/validate'
import { CreateBrandSchema, UpdateBrandSchema } from '../schemas'
import { cacheGet, cacheSet, cacheDel } from '../lib/cache'

const router = Router()

// GET /api/brands/stats
router.get('/stats', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const brands = await prisma.brand.findMany()
        const distribution = await prisma.product.groupBy({ by: ['brandId'], _count: true })
        const totalProducts = await prisma.product.count()
        const noBrand = totalProducts - distribution.reduce((s: number, d: any) => s + d._count, 0)
        const topBrand = distribution.sort((a: any, b: any) => b._count - a._count)[0]
        const topBrandName = topBrand ? brands.find((b: any) => b.id === topBrand.brandId)?.name : null
        const byBrand = brands.map((b: any) => ({
            id: b.id, name: b.name, products: distribution.find((d: any) => d.brandId === b.id)?._count || 0
        })).sort((a: any, b: any) => b.products - a.products)
        res.json({ success: true, data: { total: brands.length, totalProducts, noBrand, topBrand: topBrandName, byBrand } })
    } catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// GET /api/brands
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const schema = req.user?.storeSchema || 'default'
        const cacheKey = `${schema}:brands:${JSON.stringify(req.query)}`
        const cached = await cacheGet(cacheKey)
        if (cached) return res.json(cached)
        const prisma = req.storePrisma!
        const brands = await prisma.brand.findMany({
            where: { ...getBranchFilter(req as any) },
            orderBy: { createdAt: 'desc' },
        })
        const _response = brands.map(b => ({ ...b, createdAt: b.createdAt.toISOString() }))
        await cacheSet(cacheKey, _response, 300)
        res.json(_response)
    } catch (err) {
        console.error('Get brands error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// POST /api/brands
router.post('/', authMiddleware, validate(CreateBrandSchema), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const brand = await prisma.brand.create({ data: { ...req.body } })
        cacheDel(`${req.user?.storeSchema || 'default'}:brands:*`).catch(() => { })
        res.status(201).json({ success: true, data: { ...brand, createdAt: brand.createdAt.toISOString() } })
    } catch (err) {
        console.error('Create brand error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// PUT /api/brands/:id
router.put('/:id', authMiddleware, validate(UpdateBrandSchema), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { id } = req.params
        const { name, description } = req.body

        const existing = await prisma.brand.findFirst({
            where: { id: String(id), ...getBranchFilter(req as any) },
        })
        if (!existing) return res.status(404).json({ success: false, error: 'Brand not found' }) as any

        // Check for duplicate name (exclude current brand)
        if (name) {
            const dup = await prisma.brand.findFirst({
                where: { name, id: { not: String(id) }, ...getBranchFilter(req as any) },
            })
            if (dup) return res.status(409).json({ success: false, error: 'Brand name already exists' }) as any
        }

        const brand = await prisma.brand.update({
            where: { id: String(id) },
            data: {
                ...(name !== undefined && { name }),
                ...(description !== undefined && { description }),
            },
        })
        res.json({ success: true, data: { ...brand, createdAt: brand.createdAt.toISOString() } })
    } catch (err) {
        console.error('Update brand error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// DELETE /api/brands/:id
router.delete('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { id } = req.params

        const existing = await prisma.brand.findFirst({
            where: { id: String(id), ...getBranchFilter(req as any) },
        })
        if (!existing) return res.status(404).json({ success: false, error: 'Brand not found' }) as any

        // Check if brand has products before deleting
        const productCount = await prisma.product.count({ where: { brandId: String(id) } })
        if (productCount > 0) {
            return res.status(409).json({
                success: false,
                error: `Cannot delete brand: ${productCount} product(s) are using this brand. Remove or reassign them first.`,
            }) as any
        }

        await prisma.brand.delete({ where: { id: String(id) } })
        res.json({ success: true, message: 'Brand deleted successfully' })
    } catch (err) {
        console.error('Delete brand error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

export default router
