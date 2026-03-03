import { Router, Response } from 'express'
import { authMiddleware, getBranchFilter, AuthRequest } from '../middleware/auth'
import { validate } from '../middleware/validate'
import { CreateCategorySchema, UpdateCategorySchema } from '../schemas'
import { cacheGet, cacheSet, cacheDel } from '../lib/cache'

const router = Router()

// GET /api/categories — tree or flat
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const schema = req.user?.storeSchema || 'default'
        const { format, parentId, level } = req.query

        const cacheKey = `${schema}:categories:${format || 'flat'}:${parentId || ''}:${level || ''}`
        const cached = await cacheGet(cacheKey)
        if (cached) return res.json(cached)

        const where: any = {}
        if (parentId) where.parentId = parentId as string
        if (level) where.level = parseInt(level as string)

        if (format === 'tree') {
            const allCategories = await prisma.category.findMany({
                where: { ...getBranchFilter(req as any) },
                orderBy: [{ level: 'asc' }, { name: 'asc' }],
                include: { _count: { select: { products: true } } },
            })

            const roots = allCategories.filter(c => c.level === 1)
            const tree = roots.map(root => {
                const subs = allCategories
                    .filter(c => c.parentId === root.id)
                    .map(sub => ({
                        ...mapCategory(sub),
                        productCount: sub._count.products,
                        children: allCategories
                            .filter(c => c.parentId === sub.id)
                            .map(leaf => ({
                                ...mapCategory(leaf),
                                productCount: leaf._count.products,
                                children: [],
                            })),
                    }))
                return {
                    ...mapCategory(root),
                    productCount: root._count.products,
                    children: subs,
                }
            })
            const treeResponse = { success: true, data: tree }
            await cacheSet(cacheKey, treeResponse, 120)
            res.json(treeResponse)
        } else {
            const categories = await prisma.category.findMany({
                where,
                orderBy: [{ level: 'asc' }, { name: 'asc' }],
                include: {
                    parent: { select: { id: true, name: true } },
                    _count: { select: { products: true, children: true } },
                    products: {
                        select: { stock: true, costPrice: true, sellingPrice: true, minStock: true },
                    },
                },
            })
            const data = categories.map(c => {
                const prods = (c as any).products ?? []
                const totalStock = prods.reduce((s: number, p: any) => s + (p.stock ?? 0), 0)
                const totalStockValue = prods.reduce((s: number, p: any) => s + ((p.costPrice ?? 0) * (p.stock ?? 0)), 0)
                const totalRetailValue = prods.reduce((s: number, p: any) => s + ((p.sellingPrice ?? 0) * (p.stock ?? 0)), 0)
                const outOfStockCount = prods.filter((p: any) => (p.stock ?? 0) <= 0).length
                const lowStockCount = prods.filter((p: any) => (p.stock ?? 0) > 0 && (p.stock ?? 0) <= (p.minStock ?? 5)).length
                return {
                    ...mapCategory(c),
                    parentName: (c as any).parent?.name ?? null,
                    productCount: (c as any)._count?.products ?? 0,
                    childrenCount: (c as any)._count?.children ?? 0,
                    totalStock,
                    totalStockValue,
                    totalRetailValue,
                    outOfStockCount,
                    lowStockCount,
                }
            })
            const flatResponse = { success: true, data }
            await cacheSet(cacheKey, flatResponse, 120)
            res.json(flatResponse)
        }
    } catch (err) {
        console.error('Get categories error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// GET /api/categories/:id
router.get('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const category = await prisma.category.findFirst({
            where: { id: req.params.id as string },
            include: {
                parent: { select: { id: true, name: true } },
                children: { include: { children: true, _count: { select: { products: true } } } },
                _count: { select: { products: true } },
            },
        })
        if (!category) { res.status(404).json({ success: false, error: 'Category not found' }); return }

        res.json({
            success: true,
            data: {
                ...mapCategory(category),
                parent: category.parent,
                children: category.children.map((c: any) => ({
                    ...mapCategory(c),
                    productCount: c._count?.products ?? 0,
                    children: c.children?.map((gc: any) => ({ ...mapCategory(gc) })) ?? [],
                })),
                productCount: category._count.products,
            },
        })
    } catch (err) {
        console.error('Get category error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// POST /api/categories
router.post('/', authMiddleware, validate(CreateCategorySchema), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { name, description, color, parentId } = req.body
        if (!name) { res.status(400).json({ success: false, error: 'Name is required' }); return }

        let level = 1
        if (parentId) {
            const parent = await prisma.category.findUnique({ where: { id: parentId }, select: { level: true } })
            if (!parent) { res.status(400).json({ success: false, error: 'Parent category not found' }); return }
            if (parent.level >= 3) { res.status(400).json({ success: false, error: 'Maximum 3 levels allowed' }); return }
            level = parent.level + 1
        }

        const category = await prisma.category.create({ data: { name, description, color, parentId, level } })
        cacheDel(`${req.user?.storeSchema || 'default'}:categories:*`).catch(() => { })
        res.status(201).json({ success: true, data: mapCategory(category) })
    } catch (err) {
        console.error('Create category error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// PUT /api/categories/:id
router.put('/:id', authMiddleware, validate(UpdateCategorySchema), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { name, description, color, parentId } = req.body
        const catId = String(req.params.id)

        const existing = await prisma.category.findFirst({ where: { id: catId } })
        if (!existing) { res.status(404).json({ success: false, error: 'Category not found' }); return }

        let level = existing.level
        if (parentId !== undefined && parentId !== existing.parentId) {
            if (parentId === null) { level = 1 }
            else {
                const parent = await prisma.category.findUnique({ where: { id: parentId }, select: { level: true } })
                if (!parent) { res.status(400).json({ success: false, error: 'Parent category not found' }); return }
                if (parent.level >= 3) { res.status(400).json({ success: false, error: 'Maximum 3 levels allowed' }); return }
                level = parent.level + 1
            }
        }

        const category = await prisma.category.update({
            where: { id: req.params.id as string },
            data: { ...(name !== undefined && { name }), ...(description !== undefined && { description }), ...(color !== undefined && { color }), ...(parentId !== undefined && { parentId }), level },
        })
        cacheDel(`${req.user?.storeSchema || 'default'}:categories:*`).catch(() => { })
        res.json({ success: true, data: mapCategory(category) })
    } catch (err) {
        console.error('Update category error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// DELETE /api/categories/:id
router.delete('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const childCount = await prisma.category.count({ where: { parentId: req.params.id as string } })
        if (childCount > 0) { res.status(400).json({ success: false, error: `Cannot delete: has ${childCount} sub-categories` }); return }

        const productCount = await prisma.product.count({ where: { categoryId: req.params.id as string } })
        if (productCount > 0) { res.status(400).json({ success: false, error: `Cannot delete: has ${productCount} products` }); return }

        await prisma.category.delete({ where: { id: req.params.id as string } })
        cacheDel(`${req.user?.storeSchema || 'default'}:categories:*`).catch(() => { })
        res.json({ success: true, message: 'Category deleted' })
    } catch (err) {
        console.error('Delete category error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

function mapCategory(c: any) {
    return {
        id: c.id, name: c.name, description: c.description, color: c.color,
        level: c.level, parentId: c.parentId,
        createdAt: c.createdAt instanceof Date ? c.createdAt.toISOString() : c.createdAt,
    }
}

export default router
