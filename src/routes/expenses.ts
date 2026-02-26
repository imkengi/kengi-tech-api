import { Router, Request, Response } from 'express'
import prisma from '../lib/prisma'
import { authMiddleware } from '../middleware/auth'

const router = Router()

// GET /api/expenses
router.get('/', authMiddleware, async (req: Request, res: Response) => {
    try {
        const { search, category } = req.query
        const where: any = {}
        if (category && category !== 'all') where.category = category
        if (search) where.description = { contains: String(search) }

        const expenses = await prisma.expense.findMany({ where, orderBy: { date: 'desc' } })
        res.json({ success: true, data: expenses })
    } catch (err) {
        console.error('Get expenses error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// GET /api/expenses/stats
router.get('/stats', authMiddleware, async (_req: Request, res: Response) => {
    try {
        const expenses = await prisma.expense.findMany()
        const total = expenses.reduce((s, e) => s + e.amount, 0)
        const recurring = expenses.filter(e => e.recurring).reduce((s, e) => s + e.amount, 0)
        const categories: Record<string, number> = {}
        expenses.forEach(e => { categories[e.category] = (categories[e.category] || 0) + e.amount })
        res.json({ success: true, data: { total, recurring, count: expenses.length, categories } })
    } catch (err) {
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// POST /api/expenses
router.post('/', authMiddleware, async (req: Request, res: Response) => {
    try {
        const { description, amount, category, paidBy, recurring, date } = req.body
        if (!description?.trim()) return res.status(400).json({ success: false, error: 'Description required' })
        if (!amount || amount <= 0) return res.status(400).json({ success: false, error: 'Valid amount required' })

        const expense = await prisma.expense.create({
            data: {
                description: description.trim(),
                amount: Number(amount),
                category: category || 'other',
                paidBy: paidBy || 'Admin',
                recurring: recurring || false,
                date: date ? new Date(date) : new Date(),
            },
        })
        res.status(201).json({ success: true, data: expense })
    } catch (err) {
        console.error('Create expense error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// PUT /api/expenses/:id
router.put('/:id', authMiddleware, async (req: Request, res: Response) => {
    try {
        const { description, amount, category, paidBy, recurring, date } = req.body
        const expense = await prisma.expense.update({
            where: { id: req.params.id },
            data: {
                ...(description !== undefined && { description }),
                ...(amount !== undefined && { amount: Number(amount) }),
                ...(category !== undefined && { category }),
                ...(paidBy !== undefined && { paidBy }),
                ...(recurring !== undefined && { recurring }),
                ...(date !== undefined && { date: new Date(date) }),
            },
        })
        res.json({ success: true, data: expense })
    } catch (err) {
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// DELETE /api/expenses/:id
router.delete('/:id', authMiddleware, async (req: Request, res: Response) => {
    try {
        await prisma.expense.delete({ where: { id: req.params.id } })
        res.json({ success: true })
    } catch (err) {
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

export default router
