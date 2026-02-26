import { Router, Request, Response } from 'express'
import prisma from '../lib/prisma'
import { authMiddleware } from '../middleware/auth'

const router = Router()

// GET /api/promotions
router.get('/', authMiddleware, async (req: Request, res: Response) => {
    try {
        const { search, status, type, page = '1', pageSize = '20' } = req.query

        const where: any = {}
        if (search) {
            where.OR = [
                { name: { contains: search as string } },
                { code: { contains: search as string } },
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

        const data = promotions.map(p => ({
            ...p,
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
router.post('/', authMiddleware, async (req: Request, res: Response) => {
    try {
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
router.put('/:id', authMiddleware, async (req: Request, res: Response) => {
    try {
        const { categoryIds, productIds, startDate, endDate, ...updates } = req.body

        const data: any = { ...updates }
        if (startDate) data.startDate = new Date(startDate)
        if (endDate) data.endDate = new Date(endDate)
        if (categoryIds !== undefined) data.categoryIds = JSON.stringify(categoryIds)
        if (productIds !== undefined) data.productIds = JSON.stringify(productIds)

        const promotion = await prisma.promotion.update({
            where: { id: req.params.id },
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
router.delete('/:id', authMiddleware, async (req: Request, res: Response) => {
    try {
        await prisma.promotion.delete({ where: { id: req.params.id } })
        res.json({ success: true, message: 'Promotion deleted' })
    } catch (err) {
        console.error('Delete promotion error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

export default router
