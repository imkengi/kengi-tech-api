import { Router, Request, Response } from 'express'
import prisma from '../lib/prisma'
import { authMiddleware } from '../middleware/auth'

const router = Router()

// GET /api/store-settings — Get store settings
router.get('/', authMiddleware, async (req: Request, res: Response) => {
    try {
        const store = await prisma.store.findFirst({
            select: {
                id: true,
                costPriceMethod: true,
            },
        })
        res.json({ success: true, data: store || { costPriceMethod: 'fixed' } })
    } catch (err) {
        console.error('Get store settings error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// PUT /api/store-settings — Update store settings
router.put('/', authMiddleware, async (req: Request, res: Response) => {
    try {
        const { costPriceMethod } = req.body
        if (!['fixed', 'average', 'lastImport'].includes(costPriceMethod)) {
            res.status(400).json({ success: false, error: 'Invalid cost price method' })
            return
        }

        const store = await prisma.store.findFirst()
        if (!store) {
            res.status(404).json({ success: false, error: 'Store not found' })
            return
        }

        const updated = await prisma.store.update({
            where: { id: store.id },
            data: { costPriceMethod },
        })

        res.json({ success: true, data: { costPriceMethod: updated.costPriceMethod } })
    } catch (err) {
        console.error('Update store settings error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

export default router
