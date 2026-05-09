import { Router, Request, Response } from 'express'
import { authMiddleware, getBranchFilter, AuthRequest, getBranchId } from '../middleware/auth'
import { cacheGet, cacheSet, cacheDel } from '../lib/cache'

const router = Router()

// GET /api/currencies
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const schema = req.user?.storeSchema || 'default'
        const cacheKey = `${schema}:currencies:${JSON.stringify(req.query)}`
        const cached = await cacheGet(cacheKey)
        if (cached) return res.json(cached)
        const prisma = req.storePrisma!
        const data = await prisma.currency.findMany({ orderBy: { isBase: 'desc' } })
        const _response = { success: true, data }
        await cacheSet(cacheKey, _response, 300)
        res.json(_response)
    } catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// POST /api/currencies
router.post('/', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { code, name, symbol, rate, isBase } = req.body
        if (!code?.trim() || !name?.trim()) return res.status(400).json({ success: false, error: 'Code and name required' })
        const existing = await prisma.currency.findUnique({ where: { code } })
        if (existing) return res.status(400).json({ success: false, error: 'Currency code already exists' })
        if (isBase) await prisma.currency.updateMany({ data: { isBase: false } })
        const data = await prisma.currency.create({ data: { code: code.toUpperCase(), name, symbol: symbol || code, rate: Number(rate) || 1, isBase: isBase || false } })
        cacheDel(`${req.user?.storeSchema || 'default'}:currencies:*`).catch(() => {})
        res.status(201).json({ success: true, data })
    } catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// PUT /api/currencies/:id
router.put('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { name, symbol, rate, isBase, status } = req.body
        if (isBase) await prisma.currency.updateMany({ data: { isBase: false } })
        const data = await prisma.currency.update({
            where: { id: String(req.params.id) },
            data: { ...(name && { name }), ...(symbol && { symbol }), ...(rate !== undefined && { rate: Number(rate) }), ...(isBase !== undefined && { isBase }), ...(status && { status }) },
        })
        res.json({ success: true, data })
    } catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// DELETE /api/currencies/:id
router.delete('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const c = await prisma.currency.findUnique({ where: { id: String(req.params.id) } })
        if (c?.isBase) return res.status(400).json({ success: false, error: 'Cannot delete base currency' })
        await prisma.currency.delete({ where: { id: String(req.params.id) } })
        res.json({ success: true })
    } catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

export default router
