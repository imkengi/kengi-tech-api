import { Router, Request, Response } from 'express'
import prisma from '../lib/prisma'
import { authMiddleware } from '../middleware/auth'

const router = Router()

// GET /api/dashboard/stats
router.get('/stats', authMiddleware, async (_req: Request, res: Response) => {
    try {
        const now = new Date()
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
        const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
        const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0)

        const [
            totalRevenue,
            thisMonthTransactions,
            lastMonthTransactions,
            totalProducts,
            lowStockProducts,
            totalCustomers,
            newCustomersThisMonth,
        ] = await Promise.all([
            prisma.transaction.aggregate({ _sum: { total: true } }),
            prisma.transaction.findMany({
                where: { createdAt: { gte: startOfMonth } },
                select: { total: true },
            }),
            prisma.transaction.findMany({
                where: {
                    createdAt: { gte: startOfLastMonth, lte: endOfLastMonth },
                },
                select: { total: true },
            }),
            prisma.product.count(),
            prisma.product.count({ where: { stock: { lte: 10 } } }),
            prisma.customer.count(),
            prisma.customer.count({ where: { createdAt: { gte: startOfMonth } } }),
        ])

        const thisMonthRevenue = thisMonthTransactions.reduce((s, t) => s + t.total, 0)
        const lastMonthRevenue = lastMonthTransactions.reduce((s, t) => s + t.total, 0)
        const revenueGrowth = lastMonthRevenue > 0
            ? Math.round(((thisMonthRevenue - lastMonthRevenue) / lastMonthRevenue) * 100)
            : 0

        res.json({
            success: true,
            data: {
                revenue: {
                    total: totalRevenue._sum.total || 0,
                    thisMonth: thisMonthRevenue,
                    growth: revenueGrowth,
                },
                orders: {
                    total: await prisma.transaction.count(),
                    pending: 0,
                    growth: 0,
                },
                products: {
                    total: totalProducts,
                    lowStock: lowStockProducts,
                },
                customers: {
                    total: totalCustomers,
                    newThisMonth: newCustomersThisMonth,
                },
            },
        })
    } catch (err) {
        console.error('Get dashboard stats error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// GET /api/dashboard/revenue?days=7
router.get('/revenue', authMiddleware, async (req: Request, res: Response) => {
    try {
        const days = Math.min(90, Math.max(1, parseInt(req.query.days as string) || 7))
        const result = []

        for (let i = days - 1; i >= 0; i--) {
            const dayStart = new Date()
            dayStart.setDate(dayStart.getDate() - i)
            dayStart.setHours(0, 0, 0, 0)

            const dayEnd = new Date(dayStart)
            dayEnd.setHours(23, 59, 59, 999)

            const transactions = await prisma.transaction.findMany({
                where: {
                    createdAt: { gte: dayStart, lte: dayEnd },
                    status: { not: 'voided' },
                },
                select: { total: true },
            })

            const revenue = transactions.reduce((s, t) => s + t.total, 0)
            const month = String(dayStart.getMonth() + 1).padStart(2, '0')
            const day = String(dayStart.getDate()).padStart(2, '0')

            result.push({
                date: `${day}/${month}`,
                revenue,
                orders: transactions.length,
            })
        }

        res.json({ success: true, data: result })
    } catch (err) {
        console.error('Get revenue data error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// GET /api/dashboard/top-products
router.get('/top-products', authMiddleware, async (_req: Request, res: Response) => {
    try {
        // Aggregate from transaction items
        const items = await prisma.transactionItem.groupBy({
            by: ['productId', 'productName'],
            _sum: { lineTotal: true, quantity: true },
            orderBy: { _sum: { lineTotal: 'desc' } },
            take: 5,
        })

        const COLORS = ['#6366f1', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6']
        const data = items.map((item, i) => ({
            id: item.productId,
            name: item.productName,
            revenue: item._sum.lineTotal ?? 0,
            quantity: item._sum.quantity ?? 0,
            color: COLORS[i] ?? '#6366f1',
        }))

        res.json({ success: true, data })
    } catch (err) {
        console.error('Get top products error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// GET /api/dashboard/recent-activity
router.get('/recent-activity', authMiddleware, async (_req: Request, res: Response) => {
    try {
        const transactions = await prisma.transaction.findMany({
            orderBy: { createdAt: 'desc' },
            take: 10,
            select: {
                id: true,
                receiptNumber: true,
                customerName: true,
                total: true,
                status: true,
                createdAt: true,
            },
        })

        const data = transactions.map(t => ({
            id: t.id,
            type: 'sale' as const,
            description: `Bán hàng${t.customerName ? ` cho ${t.customerName}` : ''}`,
            amount: t.total,
            time: t.createdAt.toISOString(),
            status: t.status,
        }))

        res.json({ success: true, data })
    } catch (err) {
        console.error('Get recent activity error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

export default router
