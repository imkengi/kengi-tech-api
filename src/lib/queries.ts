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
    // Số liệu theo kỳ được chọn (preset). Doanh thu/đơn trong kỳ + tăng trưởng
    // so với kỳ liền trước cùng độ dài. Dùng cho bộ lọc thời gian trên dashboard.
    period: {
        key: string
        label: string
        revenue: number
        orders: number
        revenueGrowth: number
        ordersGrowth: number
        avgOrderValue: number
        // Lợi nhuận gộp = doanh thu kỳ − COGS (SL bán × giá vốn HIỆN TẠI của SP —
        // xấp xỉ, không phải giá vốn tại thời điểm bán); margin = % trên doanh thu.
        profit: number
        profitGrowth: number
        margin: number
    }
}

// Các preset thời gian hỗ trợ cho dashboard. Giữ đồng bộ với FE.
export type DashboardPeriod = 'today' | '7days' | 'thisMonth' | 'lastMonth' | 'thisYear'
const PERIOD_LABELS: Record<DashboardPeriod, string> = {
    today: 'Hôm nay',
    '7days': '7 ngày',
    thisMonth: 'Tháng này',
    lastMonth: 'Tháng trước',
    thisYear: 'Năm nay',
}

export async function getDashboardStats(
    prisma: StorePrisma,
    branchFilter: Record<string, any> = {},
    period: DashboardPeriod = 'thisMonth',
): Promise<DashboardStats> {
    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999)

    // ─── Cửa sổ thời gian cho kỳ đã chọn + kỳ liền trước (để tính tăng trưởng) ──
    // prevEnd luôn = ngay trước pStart (−1ms) nên hai cửa sổ không chồng lấn.
    const periodKey: DashboardPeriod = PERIOD_LABELS[period] ? period : 'thisMonth'
    let pStart: Date, pEnd: Date, prevStart: Date
    switch (periodKey) {
        case 'today':
            pStart = todayStart; pEnd = now
            prevStart = new Date(todayStart); prevStart.setDate(prevStart.getDate() - 1)
            break
        case '7days':
            pStart = new Date(todayStart); pStart.setDate(pStart.getDate() - 6); pEnd = now
            prevStart = new Date(pStart); prevStart.setDate(prevStart.getDate() - 7)
            break
        case 'lastMonth':
            pStart = lastMonthStart; pEnd = lastMonthEnd
            prevStart = new Date(now.getFullYear(), now.getMonth() - 2, 1)
            break
        case 'thisYear':
            pStart = new Date(now.getFullYear(), 0, 1); pEnd = now
            prevStart = new Date(now.getFullYear() - 1, 0, 1)
            break
        case 'thisMonth':
        default:
            pStart = monthStart; pEnd = now
            prevStart = lastMonthStart
            break
    }
    const prevEnd = new Date(pStart.getTime() - 1)

    // The previous implementation issued 16 round-trips. Consolidate into 4
    // FILTER-style aggregate queries (one per table). Each pushes counting and
    // summing fully into Postgres, so the API process never materializes the
    // underlying rows.
    //
    // branchFilter applied to Transaction + Expense (tables that have branchId);
    // Product + Customer don't have branchId, so they use a single aggregate.
    const branchId: string | null = (branchFilter && (branchFilter as any).branchId) || null

    const [txRows, productRows, customerRows, expenseRows, cogsRows] = await Promise.all([
        prisma.$queryRawUnsafe<any[]>(
            `SELECT
                COALESCE(SUM(total) FILTER (WHERE status NOT IN ('voided', 'returned')), 0) AS total_revenue,
                COALESCE(SUM(total) FILTER (WHERE status NOT IN ('voided', 'returned') AND "createdAt" >= $1), 0) AS today_revenue,
                COALESCE(SUM(total) FILTER (WHERE status NOT IN ('voided', 'returned') AND "createdAt" >= $2), 0) AS this_month_revenue,
                COALESCE(SUM(total) FILTER (WHERE status NOT IN ('voided', 'returned') AND "createdAt" >= $3 AND "createdAt" <= $4), 0) AS last_month_revenue,
                COUNT(*) FILTER (WHERE status NOT IN ('voided', 'returned')) AS total_orders,
                COUNT(*) FILTER (WHERE status NOT IN ('voided', 'returned') AND "createdAt" >= $1) AS today_orders,
                COUNT(*) FILTER (WHERE status NOT IN ('voided', 'returned') AND "createdAt" >= $3 AND "createdAt" <= $4) AS last_month_orders,
                COALESCE(SUM(total) FILTER (WHERE status NOT IN ('voided', 'returned') AND "createdAt" >= $6 AND "createdAt" <= $7), 0) AS period_revenue,
                COUNT(*) FILTER (WHERE status NOT IN ('voided', 'returned') AND "createdAt" >= $6 AND "createdAt" <= $7) AS period_orders,
                COALESCE(SUM(total) FILTER (WHERE status NOT IN ('voided', 'returned') AND "createdAt" >= $8 AND "createdAt" <= $9), 0) AS prev_period_revenue,
                COUNT(*) FILTER (WHERE status NOT IN ('voided', 'returned') AND "createdAt" >= $8 AND "createdAt" <= $9) AS prev_period_orders
             FROM "Transaction"
             WHERE ($5::text IS NULL OR "branchId" = $5)`,
            todayStart, monthStart, lastMonthStart, lastMonthEnd, branchId, pStart, pEnd, prevStart, prevEnd,
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
        // COGS theo kỳ (+ kỳ liền trước) cho thẻ Lợi nhuận gộp — giá vốn hiện tại
        prisma.$queryRawUnsafe<any[]>(
            `SELECT
                COALESCE(SUM(ti.quantity * COALESCE(p."costPrice", 0)) FILTER (WHERE t."createdAt" >= $1 AND t."createdAt" <= $2), 0) AS period_cogs,
                COALESCE(SUM(ti.quantity * COALESCE(p."costPrice", 0)) FILTER (WHERE t."createdAt" >= $3 AND t."createdAt" <= $4), 0) AS prev_period_cogs
             FROM "TransactionItem" ti
             JOIN "Transaction" t ON t.id = ti."transactionId"
             LEFT JOIN "Product" p ON p.id = ti."productId"
             WHERE t.status NOT IN ('voided', 'returned')
               AND t."createdAt" >= LEAST($1, $3) AND t."createdAt" <= GREATEST($2, $4)
               AND ($5::text IS NULL OR t."branchId" = $5)`,
            pStart, pEnd, prevStart, prevEnd, branchId,
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

    const periodRevenue = num(tx.period_revenue)
    const periodOrders = num(tx.period_orders)
    const prevPeriodRevenue = num(tx.prev_period_revenue)
    const prevPeriodOrders = num(tx.prev_period_orders)

    const cg = cogsRows[0] || {}
    const periodProfit = periodRevenue - num(cg.period_cogs)
    const prevPeriodProfit = prevPeriodRevenue - num(cg.prev_period_cogs)

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
        period: {
            key: periodKey,
            label: PERIOD_LABELS[periodKey],
            revenue: periodRevenue,
            orders: periodOrders,
            revenueGrowth: calcGrowth(periodRevenue, prevPeriodRevenue),
            ordersGrowth: calcGrowth(periodOrders, prevPeriodOrders),
            avgOrderValue: periodOrders > 0 ? Math.round(periodRevenue / periodOrders) : 0,
            profit: Math.round(periodProfit),
            profitGrowth: calcGrowth(periodProfit, prevPeriodProfit),
            margin: periodRevenue > 0 ? Math.round((periodProfit / periodRevenue) * 100) : 0,
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
    const branchId = (branchFilter as any)?.branchId ?? null

    /* Loi nhuan tren bieu do phai tinh tu GIA VON THAT.
     *
     * Ban truoc uoc "gia von = 70% doanh thu thuan" roi ve len bieu do. Ngay ben
     * canh, the Loi Nhuan Gop lai lay gia von that tu san pham — nen mot man hinh
     * hien HAI so loi nhuan khac nhau cho cung mot ky, va khong so nao noi ro no
     * la uoc luong. Chu cua hang doc bieu do de quyet dinh gia ban.
     *
     * Gop luon theo GIO VN (+7h): may chu chay UTC, nhom theo ngay UTC thi don
     * ban buoi toi bi day sang ngay hom sau.
     */
    /* Giá vốn tính ở BẢNG DẪN XUẤT RIÊNG rồi LEFT JOIN, không dùng truy vấn con
     * tương quan.
     *
     * Bản cũ đặt một subquery tham chiếu t."createdAt" bên trong một truy vấn đã
     * GROUP BY, và Postgres từ chối: 42803 "subquery uses ungrouped column".
     * Tệ hơn, `.catch(() => [])` nuốt trọn lỗi — BIỂU ĐỒ DOANH THU TRÊN TRANG
     * CHỦ im lặng trả rỗng chứ không báo gì. Log production ngày 14/08/2026 ghi
     * đúng lỗi này trên ba revision liên tiếp.
     *
     * Giá vốn dùng COALESCE(NULLIF(baseQuantity,0), quantity) — số lượng theo
     * ĐƠN VỊ GỐC. Bản ghi cũ có baseQuantity = 0 nên phải có nhánh lùi; hàng bán
     * theo vỉ/lốc mà lấy `quantity` trần thì giá vốn hụt nhiều lần. */
    const rows: any[] = await (prisma as any).$queryRawUnsafe(
        `SELECT to_char(d.ngay, 'DD/MM') AS ngay,
                d.doanh_thu,
                d.so_don,
                COALESCE(c.gia_von, 0)::float8 AS gia_von
         FROM (
            SELECT (t."createdAt" + interval '7 hours')::date AS ngay,
                   COALESCE(SUM(t.total), 0)::float8 AS doanh_thu,
                   COUNT(DISTINCT t.id)::int AS so_don
            FROM "Transaction" t
            WHERE t."createdAt" >= $1
              AND t.status NOT IN ('voided', 'returned')
              AND ($2::text IS NULL OR t."branchId" = $2)
            GROUP BY 1
         ) d
         LEFT JOIN (
            SELECT (t2."createdAt" + interval '7 hours')::date AS ngay,
                   SUM(COALESCE(NULLIF(ti."baseQuantity", 0), ti.quantity) * COALESCE(p."costPrice", 0))::float8 AS gia_von
            FROM "TransactionItem" ti
            JOIN "Transaction" t2 ON t2.id = ti."transactionId"
            LEFT JOIN "Product" p ON p.id = ti."productId"
            WHERE t2."createdAt" >= $1
              AND t2.status NOT IN ('voided', 'returned')
              AND ($2::text IS NULL OR t2."branchId" = $2)
            GROUP BY 1
         ) c ON c.ngay = d.ngay
         ORDER BY d.ngay`,
        since, branchId,
    ).catch((e: any) => {
        /* KHÔNG nuốt im lặng nữa: bản cũ hỏng suốt mà không ai biết vì lỗi bị
         * nuốt trọn. Vẫn trả rỗng để trang không sập, nhưng phải để lại vết. */
        console.error('[getRevenueByDays] truy vấn hỏng — biểu đồ doanh thu sẽ rỗng:', e?.message || e)
        return []
    })

    const theoNgay = new Map<string, { revenue: number; orders: number; profit: number }>()
    for (const r of rows || []) {
        theoNgay.set(String(r.ngay), {
            revenue: Math.round(Number(r.doanh_thu) || 0),
            orders: Number(r.so_don) || 0,
            profit: Math.round((Number(r.doanh_thu) || 0) - (Number(r.gia_von) || 0)),
        })
    }

    // Ngay khong ban duoc gi van phai co trong bieu do, khong duoc bo trong
    const ra: RevenueDataPoint[] = []
    for (let i = safetyDays - 1; i >= 0; i--) {
        const d = new Date(Date.now() + 7 * 3600 * 1000)
        d.setUTCDate(d.getUTCDate() - i)
        const key = `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`
        ra.push({ date: key, ...(theoNgay.get(key) ?? { revenue: 0, orders: 0, profit: 0 }) })
    }
    return ra
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
        where: { createdAt: { gte: todayStart }, status: { notIn: ['voided', 'returned'] } },
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
