import { Router, Request, Response } from 'express'
import prisma from '../lib/prisma'
import { authMiddleware } from '../middleware/auth'

const router = Router()

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/reports/financial?period=thisMonth|lastMonth|3months|6months|year
// Comprehensive financial report: P&L, Balance Sheet, Cashflow, KPIs
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/', authMiddleware, async (req: Request, res: Response) => {
    try {
        const period = (req.query.period as string) || 'thisMonth'
        const now = new Date()

        // ─── Build date range ──────────────────────────────────────────────
        let startDate: Date
        let endDate: Date = now

        switch (period) {
            case 'lastMonth': {
                startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1)
                endDate = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999)
                break
            }
            case '3months':
                startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)
                break
            case '6months':
                startDate = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000)
                break
            case 'year':
                startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000)
                break
            default: // thisMonth
                startDate = new Date(now.getFullYear(), now.getMonth(), 1)
                break
        }

        // ─── Fetch data in parallel ────────────────────────────────────────
        const [
            transactions,
            expenses,
            allProducts,
            debtEntries,
            previousPeriodTx,
        ] = await Promise.all([
            // Current period transactions with items + product cost price
            prisma.transaction.findMany({
                where: {
                    createdAt: { gte: startDate, lte: endDate },
                    status: { not: 'voided' },
                },
                include: {
                    items: {
                        include: {
                            product: {
                                select: { costPrice: true },
                            },
                        },
                    },
                    payments: true,
                },
            }),
            // Expenses in period
            prisma.expense.findMany({
                where: {
                    date: { gte: startDate, lte: endDate },
                },
            }),
            // All products (for inventory valuation)
            prisma.product.findMany({
                select: {
                    id: true,
                    name: true,
                    costPrice: true,
                    sellingPrice: true,
                    stock: true,
                    categoryId: true,
                },
            }),
            // Debt entries in period
            prisma.debtEntry.findMany({
                where: {
                    createdAt: { gte: startDate, lte: endDate },
                },
            }),
            // Previous period transactions (for growth comparison)
            (() => {
                const duration = endDate.getTime() - startDate.getTime()
                const prevStart = new Date(startDate.getTime() - duration)
                const prevEnd = new Date(startDate.getTime() - 1)
                return prisma.transaction.findMany({
                    where: {
                        createdAt: { gte: prevStart, lte: prevEnd },
                        status: { not: 'voided' },
                    },
                    select: { total: true },
                })
            })(),
        ])

        // ═══ P&L Calculations ═══════════════════════════════════════════════

        // Revenue
        const totalRevenue = transactions.reduce((s, t) => s + t.total, 0)
        const totalDiscount = transactions.reduce((s, t) => s + t.discount, 0)
        const totalTax = transactions.reduce((s, t) => s + t.tax, 0)

        // COGS (Cost of Goods Sold) — from transaction items × product cost
        const totalCOGS = transactions.reduce((s, t) => {
            return s + t.items.reduce((is, item) => {
                const cost = item.product?.costPrice ?? 0
                return is + (cost * item.quantity)
            }, 0)
        }, 0)

        const grossProfit = totalRevenue - totalCOGS
        const grossMargin = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0

        // Operating Expenses (by category)
        const expenseByCategory: Record<string, number> = {}
        let totalExpenses = 0
        expenses.forEach(e => {
            const cat = e.category || 'Khác'
            expenseByCategory[cat] = (expenseByCategory[cat] || 0) + e.amount
            totalExpenses += e.amount
        })

        const operatingProfit = grossProfit - totalExpenses
        const netProfit = operatingProfit // Simplified (no interest/tax adjustments)
        const netMargin = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0

        // ═══ Revenue by day ═════════════════════════════════════════════════
        const revenueByDay: Record<string, { date: string; revenue: number; expense: number; orders: number; cogs: number }> = {}
        transactions.forEach(tx => {
            const day = tx.createdAt.toISOString().slice(0, 10) // YYYY-MM-DD
            if (!revenueByDay[day]) revenueByDay[day] = { date: day, revenue: 0, expense: 0, orders: 0, cogs: 0 }
            revenueByDay[day].revenue += tx.total
            revenueByDay[day].orders += 1
            revenueByDay[day].cogs += tx.items.reduce((s, item) => s + ((item.product?.costPrice ?? 0) * item.quantity), 0)
        })
        expenses.forEach(ex => {
            const day = new Date(ex.date).toISOString().slice(0, 10)
            if (!revenueByDay[day]) revenueByDay[day] = { date: day, revenue: 0, expense: 0, orders: 0, cogs: 0 }
            revenueByDay[day].expense += ex.amount
        })
        const dailyData = Object.values(revenueByDay).sort((a, b) => a.date.localeCompare(b.date))

        // ═══ Revenue by payment method ═══════════════════════════════════════
        const paymentBreakdown: Record<string, number> = {}
        transactions.forEach(tx => {
            tx.payments.forEach(p => {
                paymentBreakdown[p.type] = (paymentBreakdown[p.type] || 0) + p.amount
            })
        })

        // ═══ Balance Sheet ══════════════════════════════════════════════════
        const inventoryCostValue = allProducts.reduce((s, p) => s + (p.costPrice * p.stock), 0)
        const inventoryRetailValue = allProducts.reduce((s, p) => s + (p.sellingPrice * p.stock), 0)
        const cashBalance = totalRevenue - totalExpenses
        const totalAssets = cashBalance + inventoryCostValue

        // Accounts receivable (unpaid debts)
        const accountsReceivable = debtEntries
            .filter(d => d.type === 'debt')
            .reduce((s, d) => s + d.amount, 0)
        const debtPayments = debtEntries
            .filter(d => d.type === 'payment')
            .reduce((s, d) => s + d.amount, 0)
        const netReceivable = accountsReceivable - debtPayments

        // ═══ Cashflow ═══════════════════════════════════════════════════════
        const cashInflow = totalRevenue + debtPayments
        const cashOutflow = totalExpenses + totalCOGS
        const netCashflow = cashInflow - cashOutflow

        // ═══ KPIs & Comparisons ═════════════════════════════════════════════
        const prevRevenue = previousPeriodTx.reduce((s, t) => s + t.total, 0)
        const revenueGrowth = prevRevenue > 0
            ? ((totalRevenue - prevRevenue) / prevRevenue) * 100
            : (totalRevenue > 0 ? 100 : 0)

        const avgOrderValue = transactions.length > 0 ? totalRevenue / transactions.length : 0
        const totalOrders = transactions.length
        const totalSKUs = allProducts.length
        const lowStockCount = allProducts.filter(p => p.stock <= 10 && p.stock >= 0).length

        // Top 5 products by revenue in period
        const productRevenue: Record<string, { name: string; revenue: number; quantity: number; cost: number }> = {}
        transactions.forEach(tx => {
            tx.items.forEach(item => {
                const key = item.productId
                if (!productRevenue[key]) productRevenue[key] = { name: item.productName, revenue: 0, quantity: 0, cost: 0 }
                productRevenue[key].revenue += item.lineTotal
                productRevenue[key].quantity += item.quantity
                productRevenue[key].cost += (item.product?.costPrice ?? 0) * item.quantity
            })
        })
        const topProducts = Object.values(productRevenue)
            .sort((a, b) => b.revenue - a.revenue)
            .slice(0, 10)
            .map(p => ({ ...p, profit: p.revenue - p.cost, margin: p.revenue > 0 ? ((p.revenue - p.cost) / p.revenue * 100) : 0 }))

        // ═══ Response ═══════════════════════════════════════════════════════
        res.json({
            success: true,
            data: {
                period: { start: startDate.toISOString(), end: endDate.toISOString(), label: period },

                // P&L Statement
                pnl: {
                    revenue: totalRevenue,
                    discount: totalDiscount,
                    tax: totalTax,
                    cogs: totalCOGS,
                    grossProfit,
                    grossMargin,
                    expenses: totalExpenses,
                    expenseByCategory,
                    operatingProfit,
                    netProfit,
                    netMargin,
                },

                // Balance Sheet
                balance: {
                    assets: {
                        cash: cashBalance,
                        inventoryCost: inventoryCostValue,
                        inventoryRetail: inventoryRetailValue,
                        accountsReceivable: netReceivable,
                        total: totalAssets + Math.max(0, netReceivable),
                    },
                    liabilities: {
                        accountsPayable: 0, // TODO: from purchase orders
                        total: 0,
                    },
                    equity: {
                        retainedEarnings: netProfit,
                        inventoryCapital: inventoryCostValue,
                        total: netProfit + inventoryCostValue,
                    },
                },

                // Cashflow
                cashflow: {
                    inflow: cashInflow,
                    outflow: cashOutflow,
                    net: netCashflow,
                    byActivity: {
                        operating: { inflow: totalRevenue, outflow: totalCOGS },
                        expenses: { inflow: 0, outflow: totalExpenses },
                        financing: { inflow: debtPayments, outflow: 0 },
                    },
                },

                // KPIs
                kpis: {
                    totalOrders,
                    avgOrderValue,
                    revenueGrowth,
                    totalSKUs,
                    lowStockCount,
                },

                // Charts
                dailyData,
                paymentBreakdown,
                topProducts,
            },
        })
    } catch (err) {
        console.error('Financial report error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

export default router
