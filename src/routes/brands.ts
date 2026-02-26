import { Router, Request, Response } from 'express'
import prisma from '../lib/prisma'
import { authMiddleware } from '../middleware/auth'

const router = Router()

// GET /api/brands
router.get('/', authMiddleware, async (_req: Request, res: Response) => {
    try {
        const brands = await prisma.brand.findMany({
            orderBy: { createdAt: 'desc' },
        })

        const data = brands.map(b => ({
            ...b,
            createdAt: b.createdAt.toISOString(),
        }))

        res.json(data)
    } catch (err) {
        console.error('Get brands error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// POST /api/brands
router.post('/', authMiddleware, async (req: Request, res: Response) => {
    try {
        const brand = await prisma.brand.create({ data: req.body })

        res.status(201).json({
            success: true,
            data: {
                ...brand,
                createdAt: brand.createdAt.toISOString(),
            },
        })
    } catch (err) {
        console.error('Create brand error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

export default router
