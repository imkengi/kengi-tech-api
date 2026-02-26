import { Router, Request, Response } from 'express'
import prisma from '../lib/prisma'
import { authMiddleware } from '../middleware/auth'

const router = Router()

// GET /api/categories — returns flat list OR tree
// ?format=tree  → nested tree structure
// ?format=flat  → flat list (default)
// ?parentId=xxx → children of a specific parent
// ?level=1      → only root categories
router.get('/', authMiddleware, async (req: Request, res: Response) => {
    try {
        const { format, parentId, level } = req.query

        const where: any = {}
        if (parentId) where.parentId = parentId as string
        if (level) where.level = parseInt(level as string)

        if (format === 'tree') {
            // Fetch all categories and build tree client-side
            const allCategories = await prisma.category.findMany({
                orderBy: [{ level: 'asc' }, { name: 'asc' }],
                include: { _count: { select: { products: true } } },
            })

            // Build tree: root → children → grandchildren
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

            res.json({ success: true, data: tree })
        } else {
            // Flat list
            const categories = await prisma.category.findMany({
                where,
                orderBy: [{ level: 'asc' }, { name: 'asc' }],
                include: {
                    parent: { select: { id: true, name: true } },
                    _count: { select: { products: true, children: true } },
                },
            })

            const data = categories.map(c => ({
                ...mapCategory(c),
                parentName: (c as any).parent?.name ?? null,
                productCount: (c as any)._count?.products ?? 0,
                childrenCount: (c as any)._count?.children ?? 0,
            }))

            res.json({ success: true, data })
        }
    } catch (err) {
        console.error('Get categories error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// GET /api/categories/:id
router.get('/:id', authMiddleware, async (req: Request, res: Response) => {
    try {
        const category = await prisma.category.findUnique({
            where: { id: req.params.id as string },
            include: {
                parent: { select: { id: true, name: true } },
                children: {
                    include: {
                        children: true, // 2 levels deep
                        _count: { select: { products: true } },
                    },
                },
                _count: { select: { products: true } },
            },
        })

        if (!category) {
            res.status(404).json({ success: false, error: 'Category not found' })
            return
        }

        res.json({
            success: true,
            data: {
                ...mapCategory(category),
                parent: category.parent,
                children: category.children.map(c => ({
                    ...mapCategory(c),
                    productCount: (c as any)._count?.products ?? 0,
                    children: (c as any).children?.map((gc: any) => ({
                        ...mapCategory(gc),
                    })) ?? [],
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
router.post('/', authMiddleware, async (req: Request, res: Response) => {
    try {
        const { name, description, color, parentId } = req.body

        if (!name) {
            res.status(400).json({ success: false, error: 'Name is required' })
            return
        }

        // Determine level from parent
        let level = 1
        if (parentId) {
            const parent = await prisma.category.findUnique({
                where: { id: parentId },
                select: { level: true },
            })
            if (!parent) {
                res.status(400).json({ success: false, error: 'Parent category not found' })
                return
            }
            if (parent.level >= 3) {
                res.status(400).json({ success: false, error: 'Maximum 3 levels allowed' })
                return
            }
            level = parent.level + 1
        }

        const category = await prisma.category.create({
            data: { name, description, color, parentId, level },
        })

        res.status(201).json({
            success: true,
            data: mapCategory(category),
        })
    } catch (err) {
        console.error('Create category error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// PUT /api/categories/:id
router.put('/:id', authMiddleware, async (req: Request, res: Response) => {
    try {
        const { name, description, color, parentId } = req.body

        const existing = await prisma.category.findUnique({
            where: { id: req.params.id as string },
        })
        if (!existing) {
            res.status(404).json({ success: false, error: 'Category not found' })
            return
        }

        // If parentId is being changed, validate new level
        let level = existing.level
        if (parentId !== undefined && parentId !== existing.parentId) {
            if (parentId === null) {
                level = 1
            } else {
                const parent = await prisma.category.findUnique({
                    where: { id: parentId },
                    select: { level: true },
                })
                if (!parent) {
                    res.status(400).json({ success: false, error: 'Parent category not found' })
                    return
                }
                if (parent.level >= 3) {
                    res.status(400).json({ success: false, error: 'Maximum 3 levels allowed' })
                    return
                }
                level = parent.level + 1
            }
        }

        const category = await prisma.category.update({
            where: { id: req.params.id as string },
            data: {
                ...(name !== undefined && { name }),
                ...(description !== undefined && { description }),
                ...(color !== undefined && { color }),
                ...(parentId !== undefined && { parentId }),
                level,
            },
        })

        res.json({
            success: true,
            data: mapCategory(category),
        })
    } catch (err) {
        console.error('Update category error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// DELETE /api/categories/:id
router.delete('/:id', authMiddleware, async (req: Request, res: Response) => {
    try {
        // Check if category has children
        const childCount = await prisma.category.count({
            where: { parentId: req.params.id as string },
        })
        if (childCount > 0) {
            res.status(400).json({
                success: false,
                error: `Cannot delete: category has ${childCount} sub-categories. Delete children first.`,
            })
            return
        }

        // Check if category has products
        const productCount = await prisma.product.count({
            where: { categoryId: req.params.id as string },
        })
        if (productCount > 0) {
            res.status(400).json({
                success: false,
                error: `Cannot delete: category has ${productCount} products. Move products first.`,
            })
            return
        }

        await prisma.category.delete({ where: { id: req.params.id as string } })
        res.json({ success: true, message: 'Category deleted' })
    } catch (err) {
        console.error('Delete category error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// Helper
function mapCategory(c: any) {
    return {
        id: c.id,
        name: c.name,
        description: c.description,
        color: c.color,
        level: c.level,
        parentId: c.parentId,
        createdAt: c.createdAt instanceof Date ? c.createdAt.toISOString() : c.createdAt,
    }
}

export default router
