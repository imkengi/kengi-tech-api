// ═══════════════════════════════════════════════════════════════════════════════
// Daily Operation Queries — Optimized queries for common POS tasks
//
// All queries accept a StorePrisma client (per-store isolated)
// No storeId filtering needed — each store has its own schema
// ═══════════════════════════════════════════════════════════════════════════════

import { PrismaClient as StorePrisma } from '../generated/store-client'

// ─── Dashboard Stats (single parallel call) ─────────────────────────────────

export interface DashboardStats {
    revenue: { total: number; today: number; thisMonth: number; growth: number }
    orders: { total: number; today: number; pending: number; growth: number }
    products: { total: number; lowStock: number; outOfStock: number; growth: number }
    customers: { total: number; newThisMonth: number; withDebt: number; growth: number }
    expenses: { thisMonth: number; growth: number }
}

export async function getDashboardStats(prisma: StorePrisma, branchFilter: Record<string, any> = {}): Promise<DashboardStats> {
    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999)

    // The previous implementation issued 16 round-trips. Consolidate into 4
    // FILTER-style aggregate queries (one per table). Each pushes counting and
    // summing fully into Postgres, so the API process never materializes the
    // underlying rows.
    //
    // branchFilter applied to Transaction + Expense (tables that have branchId);
    // Product + Customer don't have branchId, so they use a single aggregate.
    const branchId: string | null = (branchFilter && (branchFilter as any).branchId) || null

    const [txRows, productRows, customerRows, expenseRows] = await Promise.all([
        prisma.$queryRawUnsafe<any[]>(
            `SELECT
                COALESCE(SUM(total) FILTER (WHERE status <> 'voided'), 0) AS total_revenue,
                COALESCE(SUM(total) FILTER (WHERE status <> 'voided' AND "createdAt" >= $1), 0) AS today_revenue,
                COALESCE(SUM(total) FILTER (WHERE status <> 'voided' AND "createdAt" >= $2), 0) AS this_month_revenue,
                COALESCE(SUM(total) FILTER (WHERE status <> 'voided' AND "createdAt" >= $3 AND "createdAt" <= $4), 0) AS last_month_revenue,
                COUNT(*) FILTER (WHERE status <> 'voided') AS total_orders,
                COUNT(*) FILTER (WHERE status <> 'voided' AND "createdAt" >= $1) AS today_orders,
                COUNT(*) FILTER (WHERE status <> 'voided' AND "createdAt" >= $3 AND "createdAt" <= $4) AS last_month_orders
             FROM "Transaction"
             WHERE ($5::text IS NULL OR "branchId" = $5)`,
            todayStart, monthStart, lastMonthStart, lastMonthEnd, branchId,
        ),
        prisma.$queryRawUnsafe<any[]>(
            `SELECT
                COUNT(*) AS total_products,
                COUNT(*) FILTER (WHERE stock > 0 AND stock <= 10) AS low_stock,
                COUNT(*) FILTER (WHERE stock <= 0) AS out_of_stock
             FROM "Product"`,
        ),
        prisma.$queryRawUnsafe<any[]>(
            `SELECT
                COUNT(*) AS total_customers,
                COUNT(*) FILTER (WHERE "createdAt" >= $1) AS new_this_month,
                COUNT(*) FILTER (WHERE "createdAt" >= $2 AND "createdAt" <= $3) AS new_last_month,
                COUNT(*) FILTER (WHERE debt > 0) AS customers_with_debt
             FROM "Customer"`,
            monthStart, lastMonthStart, lastMonthEnd,
        ),
        prisma.$queryRawUnsafe<any[]>(
            `SELECT
                COALESCE(SUM(amount) FILTER (WHERE date >= $1), 0) AS this_month_expenses,
                COALESCE(SUM(amount) FILTER (WHERE date >= $2 AND date <= $3), 0) AS last_month_expenses
             FROM "Expense"
             WHERE ($4::text IS NULL OR "branchId" = $4)`,
            monthStart, lastMonthStart, lastMonthEnd, branchId,
        ),
    ])

    const num = (v: unknown): number => Number(v ?? 0)

    const tx = txRows[0] || {}
    const pr = productRows[0] || {}
    const cu = customerRows[0] || {}
    const ex = expenseRows[0] || {}

    const totalOrders = num(tx.total_orders)
    const todayOrders = num(tx.today_orders)
    const lastMonthOrders = num(tx.last_month_orders)
    const thisMonthRev = num(tx.this_month_revenue)
    const lastMonthRev = num(tx.last_month_revenue)
    const thisMonthExp = num(ex.this_month_expenses)
    const lastMonthExp = num(ex.last_month_expenses)

    const calcGrowth = (current: number, previous: number) =>
        previous > 0 ? Math.round(((current - previous) / previous) * 100) : 0

    return {
        revenue: {
            total: num(tx.total_revenue),
            today: num(tx.today_revenue),
            thisMonth: thisMonthRev,
            growth: calcGrowth(thisMonthRev, lastMonthRev),
        },
        orders: {
            total: totalOrders,
            today: todayOrders,
            pending: 0,
            growth: calcGrowth(todayOrders, Math.round(lastMonthOrders / 30)),
        },
        products: {
            total: num(pr.total_products),
            lowStock: num(pr.low_stock),
            outOfStock: num(pr.out_of_stock),
            growth: 0, // products don't grow month-over-month meaningfully
        },
        customers: {
            total: num(cu.total_customers),
            newThisMonth: num(cu.new_this_month),
            withDebt: num(cu.customers_with_debt),
            growth: calcGrowth(num(cu.new_this_month), num(cu.new_last_month)),
        },
        expenses: {
            thisMonth: thisMonthExp,
            growth: calcGrowth(thisMonthExp, lastMonthExp),
        },
    }
}


// ─── Revenue by Date Range (single optimized query) ─────────────────────────

export interface RevenueDataPoint {
    date: string
    revenue: number
    orders: number
    profit: number
}

export async function getRevenueByDays(prisma: StorePrisma, days: number = 7, branchFilter: Record<string, any> = {}): Promise<RevenueDataPoint[]> {
    const safetyDays = Math.min(90, Math.max(1, days))
    const since = new Date()
    since.setDate(since.getDate() - safetyDays)
    since.setHours(0, 0, 0, 0)

    const transactions = await prisma.transaction.findMany({
        where: {
            ...branchFilter,
            createdAt: { gte: since },
            status: { not: 'voided' },
        },
        select: { total: true, subtotal: true, discount: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
    })

    // Group by date in memory
    const byDate = new Map<string, { revenue: number; orders: number; profit: number }>()

    // Initialize all days
    for (let i = safetyDays - 1; i >= 0; i--) {
        const d = new Date()
        d.setDate(d.getDate() - i)
        const key = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
        byDate.set(key, { revenue: 0, orders: 0, profit: 0 })
    }

    // Fill with actual data
    for (const tx of transactions) {
        const d = tx.createdAt
        const key = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
        const entry = byDate.get(key)
        if (entry) {
            entry.revenue += tx.total
            entry.orders += 1
            entry.profit += tx.total - (tx.subtotal - tx.discount) * 0.7 // rough estimate
        }
    }

    return Array.from(byDate.entries()).map(([date, data]) => ({
        date,
        ...data,
    }))
}

// ─── Top Products ───────────────────────────────────────────────────────────

export interface TopProduct {
    id: string
    name: string
    sku: string
    revenue: number
    quantity: number
    color: string
}

export async function getTopProducts(prisma: StorePrisma, limit: number = 10): Promise<TopProduct[]> {
    const items = await prisma.transactionItem.groupBy({
        by: ['productId', 'productName', 'sku'],
        _sum: { lineTotal: true, quantity: true },
        orderBy: { _sum: { lineTotal: 'desc' } },
        take: limit,
    })

    const COLORS = ['#6366f1', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#06b6d4', '#84cc16']
    return items.map((item, i) => ({
        id: item.productId,
        name: item.productName,
        sku: item.sku || '',
        revenue: item._sum.lineTotal ?? 0,
        quantity: item._sum.quantity ?? 0,
        color: COLORS[i % COLORS.length],
    }))
}

// ─── Low Stock Alerts ───────────────────────────────────────────────────────

export interface LowStockAlert {
    id: string
    name: string
    sku: string
    stock: number
    minStock: number
    status: 'out_of_stock' | 'critical' | 'low'
}

export async function getLowStockAlerts(prisma: StorePrisma): Promise<LowStockAlert[]> {
    const products = await prisma.product.findMany({
        where: { stock: { lte: 10 } },  // use a reasonable threshold
        select: { id: true, name: true, sku: true, stock: true, minStock: true },
        orderBy: { stock: 'asc' },
        take: 50,
    })

    return products.map(p => ({
        ...p,
        status: p.stock <= 0 ? 'out_of_stock' as const
            : p.stock <= Math.max(p.minStock * 0.3, 2) ? 'critical' as const
                : 'low' as const,
    }))
}

// ─── Today's Shift Summary ─────────────────────────────────────────────────

export interface ShiftSummary {
    userId: string
    userName: string
    transactions: number
    revenue: number
}

export async function getTodayShiftSummary(prisma: StorePrisma): Promise<ShiftSummary[]> {
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)

    const transactions = await prisma.transaction.findMany({
        where: { createdAt: { gte: todayStart }, status: { not: 'voided' } },
        select: { createdBy: true, createdByName: true, total: true },
    })

    const byUser = new Map<string, { userName: string; transactions: number; revenue: number }>()
    for (const tx of transactions) {
        const entry = byUser.get(tx.createdBy) || { userName: tx.createdByName || 'N/A', transactions: 0, revenue: 0 }
        entry.transactions++
        entry.revenue += tx.total
        byUser.set(tx.createdBy, entry)
    }

    return Array.from(byUser.entries()).map(([userId, data]) => ({ userId, ...data }))
        .sort((a, b) => b.revenue - a.revenue)
}

// ─── Customer Debt Summary ──────────────────────────────────────────────────

export async function getCustomerDebtSummary(prisma: StorePrisma, limit: number = 20) {
    return prisma.customer.findMany({
        where: { debt: { gt: 0 } },
        select: { id: true, code: true, name: true, phone: true, debt: true, totalPurchases: true, lastPurchaseDate: true },
        orderBy: { debt: 'desc' },
        take: limit,
    })
}

// ─── Recent Activity ────────────────────────────────────────────────────────

export async function getRecentActivity(prisma: StorePrisma, limit: number = 10, branchFilter: Record<string, any> = {}) {
    const transactions = await prisma.transaction.findMany({
        where: branchFilter,
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: { id: true, receiptNumber: true, customerName: true, total: true, status: true, createdAt: true },
    })

    return transactions.map(t => ({
        id: t.id,
        type: 'sale' as const,
        description: `Bán hàng${t.customerName ? ` cho ${t.customerName}` : ''}`,
        amount: t.total,
        time: t.createdAt.toISOString(),
        status: t.status,
    }))
}
