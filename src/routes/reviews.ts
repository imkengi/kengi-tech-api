import { Router, Response } from 'express'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { cacheGet, cacheSet, cacheDel } from '../lib/cache'

const router = Router()

// GET /api/reviews — list with optional aggregation
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const schema = req.user?.storeSchema || 'default'
        const cacheKey = `${schema}:reviews:${JSON.stringify(req.query)}`
        const cached = await cacheGet(cacheKey)
        if (cached) return res.json(cached)
        const prisma = req.storePrisma!
        const { search, productId, sortBy } = req.query
        const where: any = {}
        if (productId) where.productId = productId
        if (search) {
            const q = String(search)
            where.OR = [{ productName: { contains: q } }, { customerName: { contains: q } }, { comment: { contains: q } }]
        }
        const data = await prisma.review.findMany({
            where,
            orderBy: sortBy === 'rating' ? { rating: 'desc' } : { createdAt: 'desc' },
        })
        const _response = { success: true, data }
        await cacheSet(cacheKey, _response, 120)
        res.json(_response)
    } catch (err) {
        console.error('List reviews error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// GET /api/reviews/analytics — aggregated product ratings
router.get('/analytics', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const reviews = await prisma.review.findMany({ where: {} })

        // Group by product
        const productMap = new Map<string, {
            productName: string; category: string; reviews: typeof reviews
        }>()

        for (const r of reviews) {
            const key = r.productId || r.productName
            if (!productMap.has(key)) {
                productMap.set(key, { productName: r.productName, category: r.category || 'Khác', reviews: [] })
            }
            productMap.get(key)!.reviews.push(r)
        }

        const analytics = Array.from(productMap.entries()).map(([id, g]) => {
            const totalReviews = g.reviews.length
            const avgRating = g.reviews.reduce((s, r) => s + r.rating, 0) / totalReviews
            const distribution = [0, 0, 0, 0, 0]
            const sentiment = { positive: 0, negative: 0, neutral: 0 }
            for (const r of g.reviews) {
                distribution[r.rating - 1]++
                if (r.sentiment === 'positive') sentiment.positive++
                else if (r.sentiment === 'negative') sentiment.negative++
                else sentiment.neutral++
            }
            return {
                id, productName: g.productName, category: g.category,
                totalReviews, avgRating: Math.round(avgRating * 10) / 10,
                distribution,
                sentiment: {
                    positive: Math.round(sentiment.positive / totalReviews * 100),
                    negative: Math.round(sentiment.negative / totalReviews * 100),
                    neutral: Math.round(sentiment.neutral / totalReviews * 100),
                },
            }
        })

        res.json({ success: true, data: analytics })
    } catch (err) {
        console.error('Review analytics error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// POST /api/reviews
router.post('/', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { productId, productName, category, customerName, rating, comment, sentiment } = req.body
        if (!productName?.trim() || !rating) return res.status(400).json({ success: false, error: 'Product name and rating required' })
        const data = await prisma.review.create({
            data: { productId: productId || null, productName: productName.trim(),
                category: category || null, customerName: customerName || null,
                rating: Number(rating), comment: comment || null,
                sentiment: sentiment || (Number(rating) >= 4 ? 'positive' : Number(rating) <= 2 ? 'negative' : 'neutral'),
            }
        })
        cacheDel(`${req.user?.storeSchema || 'default'}:reviews:*`).catch(() => {})
        res.status(201).json({ success: true, data })
    } catch (err) {
        console.error('Create review error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// DELETE /api/reviews/:id
router.delete('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        await prisma.review.delete({ where: { id: String(req.params.id) } })
        res.json({ success: true })
    } catch (err) {
        console.error('Delete review error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

export default router
