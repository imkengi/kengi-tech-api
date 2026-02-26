import { Router, Request, Response } from 'express'
import prisma from '../lib/prisma'
import { authMiddleware } from '../middleware/auth'

const router = Router()

// GET /api/customer-groups
router.get('/', authMiddleware, async (_req: Request, res: Response) => {
    try {
        const groups = await prisma.customerGroup.findMany()
        res.json(groups)
    } catch (err) {
        console.error('Get customer groups error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// POST /api/customer-groups
router.post('/', authMiddleware, async (req: Request, res: Response) => {
    try {
        const group = await prisma.customerGroup.create({ data: req.body })
        res.status(201).json({ success: true, data: group })
    } catch (err) {
        console.error('Create customer group error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

export default router
