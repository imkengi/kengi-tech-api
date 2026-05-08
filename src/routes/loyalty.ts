import { Router, Response } from 'express'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { validate } from '../middleware/validate'
import { CreateLoyaltyMemberSchema, UpdateLoyaltyMemberSchema, LoyaltyPointsSchema } from '../schemas'
import { cacheGet, cacheSet, cacheDel } from '../lib/cache'

const router = Router()

// GET /api/loyalty/stats
router.get('/stats', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const members = await prisma.loyaltyMember.findMany({
            select: { totalPoints: true, tier: true, lifetimePoints: true },
        })
        const total = members.length
        const totalPoints = members.reduce((s, m) => s + m.totalPoints, 0)
        const avgPoints = total > 0 ? Math.round(totalPoints / total) : 0
        const tierDist: Record<string, number> = {}
        for (const m of members) {
            tierDist[m.tier] = (tierDist[m.tier] ?? 0) + 1
        }
        res.json({ success: true, data: { total, totalPoints, avgPoints, tierDist } })
    } catch (err) {
        console.error('Loyalty stats error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// GET /api/loyalty
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const schema = req.user?.storeSchema || 'default'
        const cacheKey = `${schema}:loyalty:${JSON.stringify(req.query)}`
        const cached = await cacheGet(cacheKey)
        if (cached) return res.json(cached)
        const prisma = req.storePrisma!
        const { search, tier } = req.query
        const where: any = {}
        if (tier && tier !== 'all') where.tier = tier
        if (search) {
            const q = String(search)
            where.OR = [{ name: { contains: q } }, { phone: { contains: q } }]
        }
        const data = await prisma.loyaltyMember.findMany({
            where,
            include: { transactions: { orderBy: { createdAt: 'desc' }, take: 10 } },
            orderBy: { totalPoints: 'desc' },
        })
        const _response = { success: true, data }
        await cacheSet(cacheKey, _response, 300)
        res.json(_response)
    } catch (err) {
        console.error('List loyalty members error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// POST /api/loyalty — Create member
router.post('/', authMiddleware, validate(CreateLoyaltyMemberSchema), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { name, phone, customerId, tier } = req.body
        if (!name?.trim()) return res.status(400).json({ success: false, error: 'Name required' })
        const data = await prisma.loyaltyMember.create({
            data: { name: name.trim(), phone: phone || null, customerId: customerId || null, tier: tier || 'bronze' },
            include: { transactions: true },
        })
        cacheDel(`${req.user?.storeSchema || 'default'}:loyalty:*`).catch(() => { })
        res.status(201).json({ success: true, data })
    } catch (err) {
        console.error('Create loyalty member error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// POST /api/loyalty/:id/points — Add/redeem points
router.post('/:id/points', authMiddleware, validate(LoyaltyPointsSchema), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const loyaltyId = String(req.params.id)
        const { action, amount, description } = req.body
        if (!action || !amount) return res.status(400).json({ success: false, error: 'Action and amount required' })
        const pts = Number(amount)
        // Create transaction
        await prisma.loyaltyTransaction.create({
            data: { memberId: loyaltyId, action, amount: pts, description: description || null },
        })
        // Update member totals
        const updateData: any = {}
        if (action === 'earn' || action === 'bonus') {
            updateData.totalPoints = { increment: pts }
            updateData.lifetimePoints = { increment: pts }
        } else if (action === 'redeem' || action === 'expire') {
            updateData.totalPoints = { decrement: pts }
        }

        // Auto-upgrade tier based on lifetime points
        const member = await prisma.loyaltyMember.update({
            where: { id: loyaltyId },
            data: updateData,
            include: { transactions: { orderBy: { createdAt: 'desc' }, take: 10 } },
        })

        // Calculate tier
        let newTier = 'bronze'
        if (member.lifetimePoints >= 5000) newTier = 'diamond'
        else if (member.lifetimePoints >= 2000) newTier = 'gold'
        else if (member.lifetimePoints >= 500) newTier = 'silver'

        if (newTier !== member.tier) {
            await prisma.loyaltyMember.update({ where: { id: loyaltyId }, data: { tier: newTier } })
            member.tier = newTier
        }

        res.json({ success: true, data: member })
    } catch (err) {
        console.error('Loyalty points error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// PUT /api/loyalty/:id
router.put('/:id', authMiddleware, validate(UpdateLoyaltyMemberSchema), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const loyId = String(req.params.id)
        const { name, phone, tier, totalSpent } = req.body
        const data = await prisma.loyaltyMember.update({
            where: { id: loyId },
            data: {
                ...(name !== undefined && { name }),
                ...(phone !== undefined && { phone }),
                ...(tier !== undefined && { tier }),
                ...(totalSpent !== undefined && { totalSpent }),
            },
            include: { transactions: { orderBy: { createdAt: 'desc' }, take: 10 } },
        })
        res.json({ success: true, data })
    } catch (err) {
        console.error('Update loyalty member error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// DELETE /api/loyalty/:id
router.delete('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        await prisma.loyaltyMember.delete({ where: { id: String(req.params.id) } })
        res.json({ success: true })
    } catch (err) {
        console.error('Delete loyalty member error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

export default router
