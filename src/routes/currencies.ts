import { Router, Request, Response } from 'express'
import prisma from '../lib/prisma'
import { authMiddleware } from '../middleware/auth'

const router = Router()

// GET /api/currencies
router.get('/', authMiddleware, async (_req: Request, res: Response) => {
    try {
        const data = await prisma.currency.findMany({ orderBy: { isBase: 'desc' } })
        res.json({ success: true, data })
    } catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// POST /api/currencies
router.post('/', authMiddleware, async (req: Request, res: Response) => {
    try {
        const { code, name, symbol, rate, isBase } = req.body
        if (!code?.trim() || !name?.trim()) return res.status(400).json({ success: false, error: 'Code and name required' })
        const existing = await prisma.currency.findUnique({ where: { code } })
        if (existing) return res.status(400).json({ success: false, error: 'Currency code already exists' })
        if (isBase) await prisma.currency.updateMany({ data: { isBase: false } })
        const data = await prisma.currency.create({ data: { code: code.toUpperCase(), name, symbol: symbol || code, rate: Number(rate) || 1, isBase: isBase || false } })
        res.status(201).json({ success: true, data })
    } catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// PUT /api/currencies/:id
router.put('/:id', authMiddleware, async (req: Request, res: Response) => {
    try {
        const { name, symbol, rate, isBase, status } = req.body
        if (isBase) await prisma.currency.updateMany({ data: { isBase: false } })
        const data = await prisma.currency.update({
            where: { id: req.params.id },
            data: { ...(name && { name }), ...(symbol && { symbol }), ...(rate !== undefined && { rate: Number(rate) }), ...(isBase !== undefined && { isBase }), ...(status && { status }) },
        })
        res.json({ success: true, data })
    } catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// DELETE /api/currencies/:id
router.delete('/:id', authMiddleware, async (req: Request, res: Response) => {
    try {
        const c = await prisma.currency.findUnique({ where: { id: req.params.id } })
        if (c?.isBase) return res.status(400).json({ success: false, error: 'Cannot delete base currency' })
        await prisma.currency.delete({ where: { id: req.params.id } })
        res.json({ success: true })
    } catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

export default router
