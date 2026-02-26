import { Router, Request, Response } from 'express'
import prisma from '../lib/prisma'
import { authMiddleware } from '../middleware/auth'

const router = Router()

// GET /api/price-history
router.get('/', authMiddleware, async (req: Request, res: Response) => {
    try {
        const { productId, search } = req.query
        const where: any = {}
        if (productId) where.productId = productId
        if (search) { const q = String(search); where.OR = [{ productName: { contains: q } }, { productSku: { contains: q } }] }
        const data = await prisma.priceHistory.findMany({ where, orderBy: { createdAt: 'desc' }, take: 200 })
        res.json({ success: true, data })
    } catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// POST /api/price-history (called when product price changes)
router.post('/', authMiddleware, async (req: Request, res: Response) => {
    try {
        const { productId, productName, productSku, oldPrice, newPrice, changedBy, reason } = req.body
        const data = await prisma.priceHistory.create({ data: { productId, productName, productSku, oldPrice: Number(oldPrice), newPrice: Number(newPrice), changedBy, reason } })
        res.status(201).json({ success: true, data })
    } catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

export default router
