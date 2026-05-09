import { Router, Response } from 'express'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { requirePermission } from '../middleware/permissionMiddleware'
import { isBigQueryEnabled, queryBQ } from '../lib/bigquery'
import { cacheGet, cacheSet } from '../lib/cache'

const router = Router()

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/reports/financial?period=thisMonth|lastMonth|3months|6months|year
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/', authMiddleware, requirePermission('reports.view'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const schema = req.user?.storeSchema || 'default'
        const period = (req.query.period as string) || 'thisMonth'

        const cacheKey = `${schema}:reports:financial:${period}`
        const cached = await cacheGet(cacheKey)
        if (cached) return res.json(cached)

        const now = new Date()

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
            default:
                startDate = new Date(now.getFullYear(), now.getMonth(), 1)
                break
        }

        const startISO = startDate.toISOString()
        const endISO = endDate.toISOString()

        if (isBigQueryEnabled()) {
            try {
                const data = await buildReportFromBigQuery(startISO, endISO, period)
                return res.json({ success: true, data, source: 'bigquery' })
            } catch (bqErr: any) {
                console.warn('[Report] BigQuery failed, falling back to Prisma:', bqErr.message)
            }
        }

        const data = await buildReportFromPrisma(prisma, startDate, endDate, period)
        const response = { success: true, data, source: 'prisma' }
        await cacheSet(cacheKey, response, 300)
        res.json(response)
    } catch (err) {
        console.error('Financial report error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ═══════════════════════════════════════════════════════════════════════════════
// BigQuery report builder
// ═══════════════════════════════════════════════════════════════════════════════
async function buildReportFromBigQuery(startISO: string, endISO: string, period: string) {
    const [pnlResult, expenseResult, dailyResult, paymentResult, topProductsResult, debtResult, prevResult] = await Promise.all([
        queryBQ(`SELECT COUNT(*) as totalOrders, COALESCE(SUM(total),0) as totalRevenue, COALESCE(SUM(discount),0) as totalDiscount, COALESCE(SUM(tax),0) as totalTax FROM transactions WHERE createdAt >= @startDate AND createdAt <= @endDate AND status != 'voided'`, { startDate: startISO, endDate: endISO }),
        queryBQ(`SELECT category, COALESCE(SUM(amount),0) as total FROM expenses WHERE date >= @startDate AND date <= @endDate GROUP BY category`, { startDate: startISO, endDate: endISO }),
        queryBQ(`SELECT FORMAT_DATE('%Y-%m-%d', DATE(t.createdAt)) as date, COALESCE(SUM(t.total),0) as revenue, COUNT(*) as orders, COALESCE(SUM(ti.costPrice*ti.quantity),0) as cogs FROM transactions t LEFT JOIN transaction_items ti ON t.id=ti.transactionId WHERE t.createdAt >= @startDate AND t.createdAt <= @endDate AND t.status != 'voided' GROUP BY date ORDER BY date`, { startDate: startISO, endDate: endISO }),
        queryBQ(`SELECT paymentMethod, COALESCE(SUM(total),0) as amount FROM transactions WHERE createdAt >= @startDate AND createdAt <= @endDate AND status != 'voided' GROUP BY paymentMethod`, { startDate: startISO, endDate: endISO }),
        queryBQ(`SELECT productId, productName as name, COALESCE(SUM(lineTotal),0) as revenue, COALESCE(SUM(quantity),0) as quantity, COALESCE(SUM(costPrice*quantity),0) as cost FROM transaction_items ti JOIN transactions t ON t.id=ti.transactionId WHERE t.createdAt >= @startDate AND t.createdAt <= @endDate AND t.status != 'voided' GROUP BY productId, productName ORDER BY revenue DESC LIMIT 10`, { startDate: startISO, endDate: endISO }),
        queryBQ(`SELECT type, COALESCE(SUM(amount),0) as total FROM debt_entries WHERE createdAt >= @startDate AND createdAt <= @endDate GROUP BY type`, { startDate: startISO, endDate: endISO }),
        (() => {
            const start = new Date(startISO), end = new Date(endISO)
            const dur = end.getTime() - start.getTime()
            const ps = new Date(start.getTime() - dur).toISOString()
            const pe = new Date(start.getTime() - 1).toISOString()
            return queryBQ(`SELECT COALESCE(SUM(total),0) as revenue FROM transactions WHERE createdAt >= @startDate AND createdAt <= @endDate AND status != 'voided'`, { startDate: ps, endDate: pe })
        })(),
    ])

    const pnl = pnlResult[0] || { totalOrders: 0, totalRevenue: 0, totalDiscount: 0, totalTax: 0 }
    const totalCOGS = dailyResult.reduce((s: number, d: any) => s + (d.cogs || 0), 0)
    const grossProfit = pnl.totalRevenue - totalCOGS
    const grossMargin = pnl.totalRevenue > 0 ? (grossProfit / pnl.totalRevenue) * 100 : 0
    const expenseByCategory: Record<string, number> = {}
    let totalExpenses = 0
    expenseResult.forEach((e: any) => { expenseByCategory[e.category] = e.total; totalExpenses += e.total })
    const operatingProfit = grossProfit - totalExpenses
    const netProfit = operatingProfit
    const netMargin = pnl.totalRevenue > 0 ? (netProfit / pnl.totalRevenue) * 100 : 0

    const dailyExpenses = await queryBQ(`SELECT FORMAT_DATE('%Y-%m-%d', DATE(date)) as date, COALESCE(SUM(amount),0) as expense FROM expenses WHERE date >= @startDate AND date <= @endDate GROUP BY date`, { startDate: startISO, endDate: endISO }).catch(() => [] as any[])
    const expByDay: Record<string, number> = {}
    dailyExpenses.forEach((e: any) => { expByDay[e.date] = e.expense })
    const dailyData = dailyResult.map((d: any) => ({ date: d.date, revenue: d.revenue, orders: d.orders, cogs: d.cogs, expense: expByDay[d.date] || 0 }))

    const paymentBreakdown: Record<string, number> = {}
    paymentResult.forEach((p: any) => { paymentBreakdown[p.paymentMethod || 'cash'] = p.amount })
    const topProducts = topProductsResult.map((p: any) => ({ name: p.name, revenue: p.revenue, quantity: p.quantity, cost: p.cost, profit: p.revenue - p.cost, margin: p.revenue > 0 ? ((p.revenue - p.cost) / p.revenue * 100) : 0 }))

    const debtAmt = debtResult.find((d: any) => d.type === 'debt')?.total || 0
    const debtPay = debtResult.find((d: any) => d.type === 'payment')?.total || 0
    const netReceivable = Math.max(0, debtAmt - debtPay)
    const prevRevenue = prevResult[0]?.revenue || 0
    const revenueGrowth = prevRevenue > 0 ? ((pnl.totalRevenue - prevRevenue) / prevRevenue) * 100 : (pnl.totalRevenue > 0 ? 100 : 0)

    const inv = await queryBQ(`SELECT COALESCE(SUM(costPrice*stock),0) as inventoryCost, COALESCE(SUM(sellingPrice*stock),0) as inventoryRetail, COUNT(*) as totalSKUs, COUNTIF(stock<=10 AND stock>=0) as lowStock FROM products_snapshot WHERE snapshotDate=(SELECT MAX(snapshotDate) FROM products_snapshot)`).catch(() => [{ inventoryCost: 0, inventoryRetail: 0, totalSKUs: 0, lowStock: 0 }])
    const invData = inv[0] || { inventoryCost: 0, inventoryRetail: 0, totalSKUs: 0, lowStock: 0 }

    const cashBalance = Math.max(0, pnl.totalRevenue + debtPay - totalExpenses)
    const totalAssets = cashBalance + invData.inventoryCost + netReceivable
    const accountsPayable = 0 // BigQuery: no AP data readily available
    const totalLiabilities = accountsPayable
    const totalEquity = totalAssets - totalLiabilities
    const contributedCapital = totalEquity - netProfit

    return {
        period: { start: startISO, end: endISO, label: period },
        pnl: { revenue: pnl.totalRevenue, discount: pnl.totalDiscount, tax: pnl.totalTax, cogs: totalCOGS, grossProfit, grossMargin, expenses: totalExpenses, expenseByCategory, operatingProfit, netProfit, netMargin },
        balance: {
            assets: { cash: cashBalance, inventoryCost: invData.inventoryCost, inventoryRetail: invData.inventoryRetail, accountsReceivable: netReceivable, total: totalAssets },
            liabilities: { accountsPayable, total: totalLiabilities },
            equity: { retainedEarnings: netProfit, inventoryCapital: contributedCapital, total: totalEquity },
        },
        cashflow: {
            inflow: pnl.totalRevenue + debtPay, outflow: totalExpenses + totalCOGS, net: (pnl.totalRevenue + debtPay) - (totalExpenses + totalCOGS),
            byActivity: { operating: { inflow: pnl.totalRevenue, outflow: totalCOGS }, expenses: { inflow: 0, outflow: totalExpenses }, financing: { inflow: debtPay, outflow: 0 } },
        },
        kpis: { totalOrders: pnl.totalOrders, avgOrderValue: pnl.totalOrders > 0 ? pnl.totalRevenue / pnl.totalOrders : 0, revenueGrowth, totalSKUs: invData.totalSKUs, lowStockCount: invData.lowStock },
        dailyData, paymentBreakdown, topProducts,
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Prisma report builder
// KEY PRINCIPLE: equity = assets - liabilities (always balances by definition)
// ═══════════════════════════════════════════════════════════════════════════════
async function buildReportFromPrisma(prisma: any, startDate: Date, endDate: Date, period: string) {
    const duration = endDate.getTime() - startDate.getTime()
    const prevStart = new Date(startDate.getTime() - duration)
    const prevEnd = new Date(startDate.getTime() - 1)

    const [transactions, expenses, allProducts, debtEntries, previousPeriodTx, importReceipts] = await Promise.all([
        prisma.transaction.findMany({
            where: { createdAt: { gte: startDate, lte: endDate }, status: { not: 'voided' } },
            include: { items: { include: { product: { select: { costPrice: true } } } }, payments: true },
        }),
        prisma.expense.findMany({ where: { date: { gte: startDate, lte: endDate } } }),
        prisma.product.findMany({ 
            where: { productType: { not: 'service' } },
            select: { id: true, name: true, costPrice: true, sellingPrice: true, stock: true } 
        }),
        prisma.debtEntry.findMany({ where: { createdAt: { gte: startDate, lte: endDate } } }),
        prisma.transaction.findMany({
            where: { createdAt: { gte: prevStart, lte: prevEnd }, status: { not: 'voided' } },
            select: { total: true },
        }),
        // Accounts payable: unpaid import receipts (all time up to endDate)
        prisma.importReceipt.findMany({
            where: { createdAt: { lte: endDate } },
            select: { totalAmount: true, paidAmount: true },
        }).catch(() => [] as any[]),
    ])

    // ─── P&L ──────────────────────────────────────────────────────────────────
    const totalRevenue = transactions.reduce((s: number, t: any) => s + t.total, 0)
    const totalDiscount = transactions.reduce((s: number, t: any) => s + t.discount, 0)
    const totalTax = transactions.reduce((s: number, t: any) => s + t.tax, 0)
    const totalCOGS = transactions.reduce((s: number, t: any) =>
        s + t.items.reduce((is: number, item: any) => is + ((item.product?.costPrice ?? 0) * item.quantity), 0), 0)
    const grossProfit = totalRevenue - totalCOGS
    const grossMargin = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0

    const expenseByCategory: Record<string, number> = {}
    let totalExpenses = 0
    expenses.forEach((e: any) => {
        const cat = e.category || 'Khác'
        expenseByCategory[cat] = (expenseByCategory[cat] || 0) + e.amount
        totalExpenses += e.amount
    })
    const operatingProfit = grossProfit - totalExpenses
    const netProfit = operatingProfit
    const netMargin = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0

    // ─── Daily data ───────────────────────────────────────────────────────────
    const revenueByDay: Record<string, { date: string; revenue: number; expense: number; orders: number; cogs: number }> = {}
    transactions.forEach((tx: any) => {
        const day = tx.createdAt.toISOString().slice(0, 10)
        if (!revenueByDay[day]) revenueByDay[day] = { date: day, revenue: 0, expense: 0, orders: 0, cogs: 0 }
        revenueByDay[day].revenue += tx.total
        revenueByDay[day].orders += 1
        revenueByDay[day].cogs += tx.items.reduce((s: number, item: any) => s + ((item.product?.costPrice ?? 0) * item.quantity), 0)
    })
    expenses.forEach((ex: any) => {
        const day = new Date(ex.date).toISOString().slice(0, 10)
        if (!revenueByDay[day]) revenueByDay[day] = { date: day, revenue: 0, expense: 0, orders: 0, cogs: 0 }
        revenueByDay[day].expense += ex.amount
    })
    const dailyData = Object.values(revenueByDay).sort((a, b) => a.date.localeCompare(b.date))

    const paymentBreakdown: Record<string, number> = {}
    transactions.forEach((tx: any) => {
        tx.payments.forEach((p: any) => { paymentBreakdown[p.type] = (paymentBreakdown[p.type] || 0) + p.amount })
    })

    const productRevenue: Record<string, { name: string; revenue: number; quantity: number; cost: number }> = {}
    transactions.forEach((tx: any) => {
        tx.items.forEach((item: any) => {
            if (!productRevenue[item.productId]) productRevenue[item.productId] = { name: item.productName, revenue: 0, quantity: 0, cost: 0 }
            productRevenue[item.productId].revenue += item.lineTotal
            productRevenue[item.productId].quantity += item.quantity
            productRevenue[item.productId].cost += (item.product?.costPrice ?? 0) * item.quantity
        })
    })
    const topProducts = Object.values(productRevenue).sort((a, b) => b.revenue - a.revenue).slice(0, 10)
        .map(p => ({ ...p, profit: p.revenue - p.cost, margin: p.revenue > 0 ? ((p.revenue - p.cost) / p.revenue * 100) : 0 }))

    // ─── Balance Sheet — cốt lõi: equity = assets - liabilities ───────────────
    // ASSETS
    const inventoryCostValue = allProducts.reduce((s: number, p: any) => s + (p.costPrice * p.stock), 0)
    const inventoryRetailValue = allProducts.reduce((s: number, p: any) => s + (p.sellingPrice * p.stock), 0)
    const totalAR = debtEntries.filter((d: any) => d.type === 'debt').reduce((s: number, d: any) => s + d.amount, 0)
    const totalARPaid = debtEntries.filter((d: any) => d.type === 'payment').reduce((s: number, d: any) => s + d.amount, 0)
    const netReceivable = Math.max(0, totalAR - totalARPaid)
    // Cash: revenue thu được + nợ đã thu - chi phí hoạt động
    const cashBalance = Math.max(0, totalRevenue + totalARPaid - totalExpenses)
    const totalAssets = cashBalance + inventoryCostValue + netReceivable

    // LIABILITIES: phải trả NCC = tổng giá trị đơn nhập chưa nhận hàng đầy đủ
    // ImportReceipt schema: totalCost, status ('draft'|'partial'|'completed')
    const accountsPayable = (importReceipts as any[]).reduce((s, r) => {
        // Chỉ tính các đơn chưa completed (draft/partial)
        if (r.status === 'completed') return s
        return s + (r.totalCost || 0)
    }, 0)
    const totalLiabilities = accountsPayable

    // EQUITY = ASSETS - LIABILITIES (luôn cân bằng theo định nghĩa kế toán)
    const totalEquity = totalAssets - totalLiabilities
    // Breakdown equity: Lợi nhuận giữ lại (kỳ này) + Vốn chủ tích lũy (số dư)
    const retainedEarnings = netProfit
    const contributedCapital = totalEquity - retainedEarnings // vốn góp + tích lũy trước kỳ

    // Growth
    const prevRevenue = (previousPeriodTx as any[]).reduce((s, t) => s + t.total, 0)
    const revenueGrowth = prevRevenue > 0 ? ((totalRevenue - prevRevenue) / prevRevenue) * 100 : (totalRevenue > 0 ? 100 : 0)

    return {
        period: { start: startDate.toISOString(), end: endDate.toISOString(), label: period },
        pnl: { revenue: totalRevenue, discount: totalDiscount, tax: totalTax, cogs: totalCOGS, grossProfit, grossMargin, expenses: totalExpenses, expenseByCategory, operatingProfit, netProfit, netMargin },
        balance: {
            assets: { cash: cashBalance, inventoryCost: inventoryCostValue, inventoryRetail: inventoryRetailValue, accountsReceivable: netReceivable, total: totalAssets },
            liabilities: { accountsPayable, total: totalLiabilities },
            // equity.total = assets.total - liabilities.total → LUÔN CÂN BẰNG
            equity: { retainedEarnings, inventoryCapital: contributedCapital, total: totalEquity },
        },
        cashflow: {
            inflow: totalRevenue + totalARPaid, outflow: totalExpenses + totalCOGS,
            net: (totalRevenue + totalARPaid) - (totalExpenses + totalCOGS),
            byActivity: { operating: { inflow: totalRevenue, outflow: totalCOGS }, expenses: { inflow: 0, outflow: totalExpenses }, financing: { inflow: totalARPaid, outflow: 0 } },
        },
        kpis: { totalOrders: transactions.length, avgOrderValue: transactions.length > 0 ? totalRevenue / transactions.length : 0, revenueGrowth, totalSKUs: allProducts.length, lowStockCount: allProducts.filter((p: any) => p.stock <= 10 && p.stock >= 0).length },
        dailyData, paymentBreakdown, topProducts,
    }
}

export default router
