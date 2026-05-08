import { Router, Request, Response } from 'express'
import { authMiddleware, getBranchFilter, AuthRequest, getBranchId } from '../middleware/auth'
import { cacheGet, cacheSet, cacheDel } from '../lib/cache'

const router = Router()

// GET /api/price-history
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const schema = req.user?.storeSchema || 'default'
        const cacheKey = `${schema}:priceHistory:${JSON.stringify(req.query)}`
        const cached = await cacheGet(cacheKey)
        if (cached) return res.json(cached)
        const prisma = req.storePrisma!
        const { productId, search } = req.query
        const where: any = {}
        if (productId) where.productId = productId
        if (search) { const q = String(search); where.OR = [{ productName: { contains: q } }, { productSku: { contains: q } }] }
        const data = await prisma.priceHistory.findMany({ where, orderBy: { createdAt: 'desc' }, take: 200 })
        const _response = { success: true, data }
        await cacheSet(cacheKey, _response, 300)
        res.json(_response)
    } catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// POST /api/price-history (called when product price changes)
router.post('/', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { productId, productName, productSku, oldPrice, newPrice, changedBy, reason } = req.body
        const data = await prisma.priceHistory.create({ data: { productId, productName, productSku, oldPrice: Number(oldPrice), newPrice: Number(newPrice), changedBy, reason } })
        cacheDel(`${req.user?.storeSchema || 'default'}:priceHistory:*`).catch(() => {})
        res.status(201).json({ success: true, data })
    } catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

export default router
