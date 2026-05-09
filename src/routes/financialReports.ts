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
//
// Aggregations are pushed into SQL so even period=year stops loading all
// transactions+items into the API. Daily granularity for short windows,
// monthly granularity for windows > 90 days (yearly view).
// ═══════════════════════════════════════════════════════════════════════════════
async function buildReportFromPrisma(prisma: any, startDate: Date, endDate: Date, period: string) {
    const duration = endDate.getTime() - startDate.getTime()
    const prevStart = new Date(startDate.getTime() - duration)
    const prevEnd = new Date(startDate.getTime() - 1)

    // Switch to monthly buckets when the window exceeds ~90 days, so a 1-year
    // report returns 12 rows instead of 365.
    const bucketUnit = duration > 90 * 24 * 60 * 60 * 1000 ? 'month' : 'day'

    const [
        pnlRows,
        expenseRows,
        productAggRows,
        productLowStockRows,
        debtRows,
        prevTxRows,
        importReceipts,
        dailyTxRows,
        dailyExpenseRows,
        paymentRows,
        topProductRows,
    ] = await Promise.all([
        // Transaction P&L summary + COGS in one query (joined to TransactionItem×Product)
        prisma.$queryRawUnsafe(
            `SELECT
                COALESCE(SUM(t.total), 0) AS total_revenue,
                COALESCE(SUM(t.discount), 0) AS total_discount,
                COALESCE(SUM(t.tax), 0) AS total_tax,
                COUNT(DISTINCT t.id) AS total_orders,
                COALESCE((
                    SELECT SUM(p.\"costPrice\" * ti.quantity)
                    FROM \"TransactionItem\" ti
                    JOIN \"Transaction\" t2 ON t2.id = ti.\"transactionId\"
                    LEFT JOIN \"Product\" p ON p.id = ti.\"productId\"
                    WHERE t2.\"createdAt\" >= $1 AND t2.\"createdAt\" <= $2 AND t2.status <> 'voided'
                ), 0) AS total_cogs
             FROM \"Transaction\" t
             WHERE t.\"createdAt\" >= $1 AND t.\"createdAt\" <= $2 AND t.status <> 'voided'`,
            startDate, endDate,
        ),
        prisma.$queryRawUnsafe(
            `SELECT category, COALESCE(SUM(amount), 0) AS total
             FROM \"Expense\"
             WHERE date >= $1 AND date <= $2
             GROUP BY category`,
            startDate, endDate,
        ),
        // Inventory totals: cost+retail value, SKU count
        prisma.$queryRawUnsafe(
            `SELECT
                COALESCE(SUM(\"costPrice\" * stock), 0) AS inventory_cost,
                COALESCE(SUM(\"sellingPrice\" * stock), 0) AS inventory_retail,
                COUNT(*) AS total_skus
             FROM \"Product\"
             WHERE \"productType\" <> 'service' OR \"productType\" IS NULL`,
        ),
        // Low-stock count (separate so the WHERE doesn't blow away the totals)
        prisma.$queryRawUnsafe(
            `SELECT COUNT(*) AS low_stock_count
             FROM \"Product\"
             WHERE (\"productType\" <> 'service' OR \"productType\" IS NULL)
               AND stock >= 0 AND stock <= 10`,
        ),
        prisma.$queryRawUnsafe(
            `SELECT type, COALESCE(SUM(amount), 0) AS total
             FROM \"DebtEntry\"
             WHERE \"createdAt\" >= $1 AND \"createdAt\" <= $2
             GROUP BY type`,
            startDate, endDate,
        ),
        prisma.$queryRawUnsafe(
            `SELECT COALESCE(SUM(total), 0) AS revenue
             FROM \"Transaction\"
             WHERE \"createdAt\" >= $1 AND \"createdAt\" <= $2 AND status <> 'voided'`,
            prevStart, prevEnd,
        ),
        // Accounts payable: unpaid import receipts (all time up to endDate)
        prisma.importReceipt.findMany({
            where: { createdAt: { lte: endDate } },
            select: { totalCost: true, status: true },
        }).catch(() => [] as any[]),
        // Daily/monthly transaction buckets — revenue + orders + COGS
        prisma.$queryRawUnsafe(
            `SELECT
                to_char(date_trunc('${bucketUnit}', t.\"createdAt\"), 'YYYY-MM-DD') AS bucket,
                COALESCE(SUM(t.total), 0) AS revenue,
                COUNT(*) AS orders,
                COALESCE((
                    SELECT SUM(p.\"costPrice\" * ti.quantity)
                    FROM \"TransactionItem\" ti
                    JOIN \"Transaction\" t2 ON t2.id = ti.\"transactionId\"
                    LEFT JOIN \"Product\" p ON p.id = ti.\"productId\"
                    WHERE t2.status <> 'voided'
                      AND date_trunc('${bucketUnit}', t2.\"createdAt\") = date_trunc('${bucketUnit}', t.\"createdAt\")
                ), 0) AS cogs
             FROM \"Transaction\" t
             WHERE t.\"createdAt\" >= $1 AND t.\"createdAt\" <= $2 AND t.status <> 'voided'
             GROUP BY 1
             ORDER BY 1`,
            startDate, endDate,
        ),
        prisma.$queryRawUnsafe(
            `SELECT
                to_char(date_trunc('${bucketUnit}', date), 'YYYY-MM-DD') AS bucket,
                COALESCE(SUM(amount), 0) AS expense
             FROM \"Expense\"
             WHERE date >= $1 AND date <= $2
             GROUP BY 1
             ORDER BY 1`,
            startDate, endDate,
        ),
        // Payment breakdown — group by payment.type
        prisma.$queryRawUnsafe(
            `SELECT pm.type, COALESCE(SUM(pm.amount), 0) AS amount
             FROM \"Payment\" pm
             JOIN \"Transaction\" t ON t.id = pm.\"transactionId\"
             WHERE t.\"createdAt\" >= $1 AND t.\"createdAt\" <= $2 AND t.status <> 'voided'
             GROUP BY pm.type`,
            startDate, endDate,
        ),
        // Top products — already aggregate-only, top 10
        prisma.$queryRawUnsafe(
            `SELECT
                ti.\"productId\" AS product_id,
                MAX(ti.\"productName\") AS name,
                COALESCE(SUM(ti.\"lineTotal\"), 0) AS revenue,
                COALESCE(SUM(ti.quantity), 0) AS quantity,
                COALESCE(SUM(COALESCE(p.\"costPrice\", 0) * ti.quantity), 0) AS cost
             FROM \"TransactionItem\" ti
             JOIN \"Transaction\" t ON t.id = ti.\"transactionId\"
             LEFT JOIN \"Product\" p ON p.id = ti.\"productId\"
             WHERE t.\"createdAt\" >= $1 AND t.\"createdAt\" <= $2 AND t.status <> 'voided'
             GROUP BY ti.\"productId\"
             ORDER BY revenue DESC
             LIMIT 10`,
            startDate, endDate,
        ),
    ])

    const num = (v: unknown): number => Number(v ?? 0)

    // ─── P&L ──────────────────────────────────────────────────────────────────
    const pnl = (pnlRows as any[])[0] || {}
    const totalRevenue = num(pnl.total_revenue)
    const totalDiscount = num(pnl.total_discount)
    const totalTax = num(pnl.total_tax)
    const totalOrders = num(pnl.total_orders)
    const totalCOGS = num(pnl.total_cogs)
    const grossProfit = totalRevenue - totalCOGS
    const grossMargin = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0

    const expenseByCategory: Record<string, number> = {}
    let totalExpenses = 0
    for (const e of expenseRows as any[]) {
        const cat = e.category || 'Khác'
        const amt = num(e.total)
        expenseByCategory[cat] = (expenseByCategory[cat] || 0) + amt
        totalExpenses += amt
    }
    const operatingProfit = grossProfit - totalExpenses
    const netProfit = operatingProfit
    const netMargin = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0

    // ─── Daily/monthly buckets (already grouped in SQL) ───────────────────────
    const bucketMap: Record<string, { date: string; revenue: number; expense: number; orders: number; cogs: number }> = {}
    for (const row of dailyTxRows as any[]) {
        bucketMap[row.bucket] = {
            date: row.bucket,
            revenue: num(row.revenue),
            orders: num(row.orders),
            cogs: num(row.cogs),
            expense: 0,
        }
    }
    for (const row of dailyExpenseRows as any[]) {
        if (!bucketMap[row.bucket]) {
            bucketMap[row.bucket] = { date: row.bucket, revenue: 0, expense: 0, orders: 0, cogs: 0 }
        }
        bucketMap[row.bucket].expense = num(row.expense)
    }
    const dailyData = Object.values(bucketMap).sort((a, b) => a.date.localeCompare(b.date))

    const paymentBreakdown: Record<string, number> = {}
    for (const row of paymentRows as any[]) {
        if (row.type) paymentBreakdown[row.type] = num(row.amount)
    }

    const topProducts = (topProductRows as any[]).map((p) => {
        const revenue = num(p.revenue)
        const cost = num(p.cost)
        return {
            name: p.name,
            revenue,
            quantity: num(p.quantity),
            cost,
            profit: revenue - cost,
            margin: revenue > 0 ? ((revenue - cost) / revenue) * 100 : 0,
        }
    })

    // ─── Balance Sheet — cốt lõi: equity = assets - liabilities ───────────────
    const productAgg = (productAggRows as any[])[0] || {}
    const inventoryCostValue = num(productAgg.inventory_cost)
    const inventoryRetailValue = num(productAgg.inventory_retail)
    const totalSKUs = num(productAgg.total_skus)
    const lowStockCount = num(((productLowStockRows as any[])[0] || {}).low_stock_count)

    const debtMap: Record<string, number> = {}
    for (const row of debtRows as any[]) debtMap[row.type] = num(row.total)
    const totalAR = debtMap['debt'] || 0
    const totalARPaid = debtMap['payment'] || 0
    const netReceivable = Math.max(0, totalAR - totalARPaid)
    const cashBalance = Math.max(0, totalRevenue + totalARPaid - totalExpenses)
    const totalAssets = cashBalance + inventoryCostValue + netReceivable

    // LIABILITIES: phải trả NCC = tổng giá trị đơn nhập chưa hoàn tất
    const accountsPayable = (importReceipts as any[]).reduce((s, r) => {
        if (r.status === 'completed') return s
        return s + (r.totalCost || 0)
    }, 0)
    const totalLiabilities = accountsPayable

    // EQUITY = ASSETS - LIABILITIES (luôn cân bằng theo định nghĩa kế toán)
    const totalEquity = totalAssets - totalLiabilities
    const retainedEarnings = netProfit
    const contributedCapital = totalEquity - retainedEarnings

    // Growth vs previous period
    const prevRevenue = num(((prevTxRows as any[])[0] || {}).revenue)
    const revenueGrowth = prevRevenue > 0 ? ((totalRevenue - prevRevenue) / prevRevenue) * 100 : (totalRevenue > 0 ? 100 : 0)

    return {
        period: { start: startDate.toISOString(), end: endDate.toISOString(), label: period },
        pnl: { revenue: totalRevenue, discount: totalDiscount, tax: totalTax, cogs: totalCOGS, grossProfit, grossMargin, expenses: totalExpenses, expenseByCategory, operatingProfit, netProfit, netMargin },
        balance: {
            assets: { cash: cashBalance, inventoryCost: inventoryCostValue, inventoryRetail: inventoryRetailValue, accountsReceivable: netReceivable, total: totalAssets },
            liabilities: { accountsPayable, total: totalLiabilities },
            equity: { retainedEarnings, inventoryCapital: contributedCapital, total: totalEquity },
        },
        cashflow: {
            inflow: totalRevenue + totalARPaid, outflow: totalExpenses + totalCOGS,
            net: (totalRevenue + totalARPaid) - (totalExpenses + totalCOGS),
            byActivity: { operating: { inflow: totalRevenue, outflow: totalCOGS }, expenses: { inflow: 0, outflow: totalExpenses }, financing: { inflow: totalARPaid, outflow: 0 } },
        },
        kpis: {
            totalOrders,
            avgOrderValue: totalOrders > 0 ? totalRevenue / totalOrders : 0,
            revenueGrowth,
            totalSKUs,
            lowStockCount,
        },
        dailyData, paymentBreakdown, topProducts,
    }
}

export default router
