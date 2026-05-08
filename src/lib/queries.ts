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
    const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 2, 1)
    const prevMonthEnd = new Date(now.getFullYear(), now.getMonth() - 1, 0, 23, 59, 59, 999)

    // branchFilter applied to Transaction + Expense (tables that have branchId)
    // Product + Customer don't have branchId column
    const [
        totalRevenue,
        todayRevenue,
        thisMonthRevenue,
        lastMonthRevenue,
        totalOrders,
        todayOrders,
        lastMonthOrders,
        totalProducts,
        lowStockProducts,
        outOfStockProducts,
        totalCustomers,
        newCustomersThisMonth,
        newCustomersLastMonth,
        customersWithDebt,
        thisMonthExpenses,
        lastMonthExpenses,
    ] = await Promise.all([
        prisma.transaction.aggregate({ _sum: { total: true }, where: { ...branchFilter, status: { not: 'voided' } } }),
        prisma.transaction.aggregate({ _sum: { total: true }, where: { ...branchFilter, createdAt: { gte: todayStart }, status: { not: 'voided' } } }),
        prisma.transaction.aggregate({ _sum: { total: true }, where: { ...branchFilter, createdAt: { gte: monthStart }, status: { not: 'voided' } } }),
        prisma.transaction.aggregate({ _sum: { total: true }, where: { ...branchFilter, createdAt: { gte: lastMonthStart, lte: lastMonthEnd }, status: { not: 'voided' } } }),
        prisma.transaction.count({ where: { ...branchFilter, status: { not: 'voided' } } }),
        prisma.transaction.count({ where: { ...branchFilter, createdAt: { gte: todayStart }, status: { not: 'voided' } } }),
        prisma.transaction.count({ where: { ...branchFilter, createdAt: { gte: lastMonthStart, lte: lastMonthEnd }, status: { not: 'voided' } } }),
        prisma.product.count(),
        prisma.product.count({ where: { stock: { gt: 0, lte: 10 } } }),
        prisma.product.count({ where: { stock: { lte: 0 } } }),
        prisma.customer.count(),
        prisma.customer.count({ where: { createdAt: { gte: monthStart } } }),
        prisma.customer.count({ where: { createdAt: { gte: lastMonthStart, lte: lastMonthEnd } } }),
        prisma.customer.count({ where: { debt: { gt: 0 } } }),
        prisma.expense.aggregate({ _sum: { amount: true }, where: { ...branchFilter, date: { gte: monthStart } } }),
        prisma.expense.aggregate({ _sum: { amount: true }, where: { ...branchFilter, date: { gte: lastMonthStart, lte: lastMonthEnd } } }),
    ])

    const calcGrowth = (current: number, previous: number) =>
        previous > 0 ? Math.round(((current - previous) / previous) * 100) : 0

    const thisMonthRev = thisMonthRevenue._sum.total || 0
    const lastMonthRev = lastMonthRevenue._sum.total || 0
    const thisMonthExp = thisMonthExpenses._sum.amount || 0
    const lastMonthExp = lastMonthExpenses._sum.amount || 0

    return {
        revenue: {
            total: totalRevenue._sum.total || 0,
            today: todayRevenue._sum.total || 0,
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
            total: totalProducts,
            lowStock: lowStockProducts,
            outOfStock: outOfStockProducts,
            growth: 0, // products don't grow month-over-month meaningfully
        },
        customers: {
            total: totalCustomers,
            newThisMonth: newCustomersThisMonth,
            withDebt: customersWithDebt,
            growth: calcGrowth(newCustomersThisMonth, newCustomersLastMonth),
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
