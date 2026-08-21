import { Router, Request, Response } from 'express'
import { authMiddleware, AuthRequest, getBranchFilter, getBranchId, canAccessBranch } from '../middleware/auth'
import { requirePermission } from '../middleware/permissionMiddleware'
import { validate } from '../middleware/validate'
import { CreateTransactionSchema } from '../schemas'
import { cacheGet, cacheSet, cacheDel } from '../lib/cache'
import { publishEvent } from '../lib/pubsub'
import { createJournalEntriesForTransaction, postDebtCollectionJournal, reverseJournalEntriesForTransaction } from '../lib/autoJournal'
import { nextCode } from '../lib/codeGenerator'
import { getOrCreateDefaultWarehouse, updateWarehouseStock, adjustSellableStock } from '../lib/warehouseHelper'
import { emitStockChanged, webhooksActive, emitEntityEvent } from '../lib/webhookDispatch'
import { moTaLoi } from '../lib/gomLoi'

const router = Router()

// Payload gọn cho webhook hóa đơn (Transaction = hóa đơn bán)
const invoicePayload = (t: any) => ({
    id: t?.id,
    receiptNumber: t?.receiptNumber ?? null,
    status: t?.status ?? null,
    total: t?.total ?? null,
    subtotal: t?.subtotal ?? null,
    discount: t?.discount ?? null,
    tax: t?.tax ?? null,
    paymentMethod: t?.paymentMethod ?? null,
    paymentStatus: t?.paymentStatus ?? null,
    customerId: t?.customerId ?? null,
    customerName: t?.customerName ?? null,
    channel: t?.channel ?? null,
    branchId: t?.branchId ?? null,
    itemCount: Array.isArray(t?.items) ? t.items.length : undefined,
    // Chi tiết từng mặt hàng trong hóa đơn (nếu có include items)
    items: Array.isArray(t?.items) ? t.items.map((it: any) => ({
        productId: it.productId,
        productName: it.productName,
        sku: it.sku ?? null,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        discount: it.discount ?? 0,
        lineTotal: it.lineTotal,
    })) : undefined,
    createdAt: t?.createdAt,
})

// Lỗi hết hàng khi trừ kho có guard chống âm — throw bên trong $transaction
// để rollback toàn bộ đơn, handler bắt và trả 409.
class StockConflictError extends Error { }

// Resolve how many base units 1 `selectedUnit` represents for a given product.
// Returns 1 when selectedUnit equals the product's baseUnit or no matching conversion.
// Mirrors POS price logic: if conv.toUnit === selectedUnit, rate = conv.conversionRate;
// if conv.fromUnit === selectedUnit, rate = 1 / conv.conversionRate.
function resolveConversionRate(
    product: { baseUnit: string | null; unitConversions?: { fromUnit: string; toUnit: string; conversionRate: number }[] } | null | undefined,
    selectedUnit?: string | null,
): number {
    if (!product || !selectedUnit) return 1
    if (!product.baseUnit || selectedUnit === product.baseUnit) return 1
    const convs = product.unitConversions || []
    const conv = convs.find(uc => uc.toUnit === selectedUnit || uc.fromUnit === selectedUnit)
    if (!conv || !conv.conversionRate || conv.conversionRate <= 0) return 1
    if (conv.toUnit === selectedUnit) return conv.conversionRate
    return 1 / conv.conversionRate
}

// GET /api/transactions
router.get('/', authMiddleware, requirePermission('pos.view'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const branchId = getBranchId(req)

        const {
            search, startDate, endDate, paymentMethod, status, cashier, customerId,
            page = '1', pageSize = '20',
        } = req.query

        const where: any = { ...getBranchFilter(req as any) }
        console.log(`[DEBUG-TX-GET] branchId=${branchId}, where=${JSON.stringify(where)}, headers.x-branch-id=${req.headers['x-branch-id']}, jwt.branchId=${req.user?.branchId}, isMainBranch=${req.user?.isMainBranch}`)

        if (search) {
            where.OR = [
                { receiptNumber: { contains: search as string, mode: 'insensitive' } },
                { customerName: { contains: search as string, mode: 'insensitive' } },
                { customerPhone: { contains: search as string, mode: 'insensitive' } },
            ]
        }

        /* Cắt ngày theo GIỜ VN, và bao TRỌN ngày kết thúc.
         *
         * `new Date('2026-08-15')` là nửa đêm UTC = 07:00 giờ VN. Bản trước
         * dùng thẳng nó cho `lte`, nên lọc "đến 15/08" mất sạch giao dịch từ 7
         * giờ sáng 15/08 trở đi — 17 tiếng cuối ngày biến khỏi danh sách và
         * khỏi mọi con số tính từ danh sách đó. Đầu kỳ hụt 7 tiếng theo chiều
         * ngược lại.
         *
         * Chuỗi có kèm giờ thì tôn trọng nguyên trạng, chỉ nắn dạng YYYY-MM-DD. */
        if (startDate || endDate) {
            const chiNgay = (v: any) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''))
            where.createdAt = {}
            if (startDate) {
                where.createdAt.gte = chiNgay(startDate)
                    ? new Date(`${startDate}T00:00:00+07:00`)
                    : new Date(startDate as string)
            }
            if (endDate) {
                if (chiNgay(endDate)) {
                    // Nửa mở: < đầu ngày HÔM SAU → bao trọn ngày kết thúc
                    where.createdAt.lt = new Date(
                        new Date(`${endDate}T00:00:00+07:00`).getTime() + 86400_000)
                } else {
                    where.createdAt.lte = new Date(endDate as string)
                }
            }
        }

        if (status && status !== 'all') {
            const statusList = (status as string).split(',').map(s => s.trim()).filter(Boolean)
            /**
             * "Hoàn thành" GỒM CẢ ĐƠN GHI NỢ ('partial') — hàng đã giao, bán đã
             * xong, chỉ còn tiền chưa thu đủ. Người dùng vào lịch sử giao dịch
             * xem theo tab Hoàn thành mà đơn ghi nợ biến mất là tưởng chưa bán
             * (yêu cầu 11/08/2026).
             *
             * CHỈ nới ở bộ lọc đọc này. KHÔNG đổi giá trị lưu trong DB: 'partial'
             * đang gánh máy trả nợ — POST /:id/pay-debt chặn đơn không 'partial',
             * tổng nợ tính từ đơn 'partial' — đổi chỗ lưu là gãy cả dây.
             * Tab "Ghi nợ" vẫn lọc đúng tập con vì 'partial' nằm nguyên trong DB.
             */
            if (statusList.includes('completed') && !statusList.includes('partial')) {
                statusList.push('partial')
            }
            where.status = statusList.length > 1 ? { in: statusList } : statusList[0]
        }
        if (cashier) where.createdBy = cashier
        if (customerId) where.customerId = customerId as string

        const pageNum = Math.max(1, parseInt(page as string))
        // Clamp 1000 để frontend export được nhiều dòng hơn
        const size = Math.max(1, Math.min(1000, parseInt(pageSize as string)))
        const skip = (pageNum - 1) * size

        const [total, transactions] = await Promise.all([
            prisma.transaction.count({ where }),
            prisma.transaction.findMany({
                where,
                include: { 
                    items: {
                        include: { product: { select: { costPrice: true } } }
                    }, 
                    payments: true 
                },
                orderBy: { createdAt: 'desc' },
                skip,
                take: size,
            }),
        ])

        // Post-filter by payment method if needed
        let filteredTx = transactions
        let filteredTotal = total
        if (paymentMethod && paymentMethod !== 'all') {
            filteredTx = transactions.filter(t =>
                t.payments.some(p => p.type === paymentMethod)
            )
            filteredTotal = filteredTx.length
        }

        // Build branch name map for overview mode
        const branchIds = [...new Set(transactions.map((t: any) => t.branchId).filter(Boolean))]
        let branchMap: Record<string, string> = {}
        if (branchIds.length > 0) {
            const branches = await prisma.branch.findMany({ where: { id: { in: branchIds } }, select: { id: true, name: true } })
            branchMap = Object.fromEntries(branches.map(b => [b.id, b.name]))
        }

        // Resolve seller names: legacy transactions may have a null createdByName,
        // in which case the client used to fall back to the raw createdBy id (a cuid).
        // Look those names up from the User table by createdBy id so the UI shows a name.
        const sellerIds = [...new Set(filteredTx.map((t: any) => t.createdBy).filter(Boolean))] as string[]
        let userMap: Record<string, string> = {}
        if (sellerIds.length > 0) {
            const users = await prisma.user.findMany({ where: { id: { in: sellerIds } }, select: { id: true, name: true } })
            userMap = Object.fromEntries(users.map(u => [u.id, u.name]))
        }

        const data = filteredTx.map(t => ({
            id: t.id,
            receiptNumber: t.receiptNumber,
            customerId: t.customerId,
            customerName: t.customerName,
            customerPhone: t.customerPhone,
            items: t.items.map(i => ({
                productId: i.productId,
                productName: i.productName,
                sku: i.sku,
                quantity: i.quantity,
                unitPrice: i.unitPrice,
                discount: i.discount,
                lineTotal: i.lineTotal,
                product: (i as any).product || undefined,
            })),
            subtotal: t.subtotal,
            discount: t.discount,
            tax: t.tax,
            total: t.total,
            payments: t.payments.map(p => ({
                type: p.type,
                amount: p.amount,
                reference: p.reference,
            })),
            amountReceived: t.amountReceived,
            change: t.change,
            status: t.status,
            createdBy: t.createdBy,
            createdByName: t.createdByName || (t.createdBy ? userMap[t.createdBy] : null) || null,
            notes: t.notes,
            createdAt: t.createdAt.toISOString(),
            transactionDate: t.transactionDate?.toISOString() || t.createdAt.toISOString(),
            returnedAt: t.returnedAt?.toISOString(),
            returnReason: t.returnReason,
            branchId: t.branchId || null,
            branchName: t.branchId ? (branchMap[t.branchId] || null) : null,
            channel: (t as any).channel || 'direct',
            // Tình trạng HĐĐT — FE lọc "Đã/Chưa xuất HĐ" + badge cần 2 trường này
            vatStatus: (t as any).vatStatus || 'none',
            vatInvoiceNumber: (t as any).vatInvoiceNumber || null,
        }))

        const response = {
            success: true,
            data: {
                items: data,
                total: filteredTotal,
                page: pageNum,
                pageSize: size,
                totalPages: Math.ceil(filteredTotal / size),
            },
        }
        res.json(response)
    } catch (err) {
        console.error('Get transactions error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// GET /api/transactions/stats
router.get('/stats', authMiddleware, requirePermission('pos.view'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const schema = req.user?.storeSchema || 'default'
        const { startDate, endDate } = req.query
        // Lọc theo chi nhánh như các route khác (main branch thấy tất cả)
        const branchFilter = getBranchFilter(req as any)
        // Key phải khớp pattern invalidate `${schema}:*:transactions:*` và tách theo chi nhánh
        const statsCacheKey = `${schema}:${branchFilter.branchId || 'all'}:transactions:stats:${startDate || ''}:${endDate || ''}`
        const cachedStats = await cacheGet(statsCacheKey)
        if (cachedStats) return res.json(cachedStats)

        const now = new Date()
        /* CẮT NGÀY THEO GIỜ VIỆT NAM, không theo giờ máy chủ.
         * Cloud Run chạy UTC nên `now.getFullYear()/getHours()` cho mốc sang ngày rơi vào
         * 07:00 giờ VN ⇒ mọi phiếu bán 0h–7h sáng bị đếm sang HÔM TRƯỚC. Ghép lại từ bản
         * đang chạy trên prod (21/08). */
        const VN_MS = 7 * 3600_000
        const vnNow = new Date(now.getTime() + VN_MS)
        const vnHourNow = vnNow.getUTCHours()
        const vnHourOf = (d: Date) => new Date(d.getTime() + VN_MS).getUTCHours()
        const todayStart = new Date(Date.UTC(vnNow.getUTCFullYear(), vnNow.getUTCMonth(), vnNow.getUTCDate()) - VN_MS)
        const yesterdayStart = new Date(todayStart.getTime() - 86400_000)

        // Use provided date range or default to 30 days
        const rangeStart = startDate ? new Date(startDate as string) : new Date(now.getTime() - 30 * 86400_000)
        const rangeEnd = endDate ? (() => { const d = new Date(endDate as string); d.setHours(23, 59, 59, 999); return d })() : now

        // Get all transactions in the specified range
        const recent = await prisma.transaction.findMany({
            where: { ...branchFilter, createdAt: { gte: rangeStart, lte: rangeEnd } },
            include: { 
                items: {
                    include: { product: { select: { costPrice: true } } }
                }, 
                payments: true 
            },
            orderBy: { createdAt: 'desc' },
        })

        const completed = recent.filter(t => t.status === 'completed')
        const partial = recent.filter(t => t.status === 'partial')
        const voided = recent.filter(t => t.status === 'voided')
        const returned = recent.filter(t => t.status === 'returned')
        // Doanh thu = đơn hoàn thành + đơn GHI NỢ (hàng đã giao, chỉ chưa thu đủ tiền)
        const revenueTx = recent.filter(t => t.status === 'completed' || t.status === 'partial')

        // KPI aggregations
        const totalOrders = recent.length
        const totalRevenue = revenueTx.reduce((s, t) => s + t.total, 0)
        // Đơn ghi nợ TÍNH là hoàn thành (hàng đã giao, bán đã xong) — khớp với
        // bộ lọc "Hoàn thành" ở danh sách, kẻo thẻ KPI và bảng vênh số nhau
        const completedCount = completed.length + partial.length
        const voidedCount = voided.length
        const returnedCount = returned.length

        // Today vs yesterday
        const todayTx = revenueTx.filter(t => t.createdAt >= todayStart)
        const yesterdayTx = revenueTx.filter(t => t.createdAt >= yesterdayStart && t.createdAt < todayStart)
        const revenueToday = todayTx.reduce((s, t) => s + t.total, 0)
        const revenueYesterday = yesterdayTx.reduce((s, t) => s + t.total, 0)

        // Revenue by hour (today)
        const byHour: { hour: number; revenue: number; count: number }[] = []
        for (let h = 0; h <= vnHourNow; h++) {
            const hourTx = todayTx.filter(t => vnHourOf(t.createdAt) === h)
            byHour.push({
                hour: h,
                revenue: hourTx.reduce((s, t) => s + t.total, 0),
                count: hourTx.length,
            })
        }

        // Revenue by day (last 30 days)
        const byDay: { date: string; revenue: number; count: number }[] = []
        for (let d = 29; d >= 0; d--) {
            // Cùng lý do: chốt đầu ngày theo giờ VN chứ không theo giờ máy chủ
            const dayStart = new Date(todayStart.getTime() - d * 86400_000)
            const dayEnd = new Date(dayStart.getTime() + 86400_000)
            const dayTx = revenueTx.filter(t => t.createdAt >= dayStart && t.createdAt < dayEnd)
            byDay.push({
                date: dayStart.toISOString().slice(0, 10),
                revenue: dayTx.reduce((s, t) => s + t.total, 0),
                count: dayTx.length,
            })
        }

        // Payment method breakdown
        const paymentBreakdown: Record<string, number> = {}
        for (const t of completed) {
            for (const p of t.payments) {
                paymentBreakdown[p.type] = (paymentBreakdown[p.type] || 0) + p.amount
            }
        }

        // Top products
        const productMap = new Map<string, { name: string; qty: number; revenue: number }>()
        for (const t of completed) {
            for (const item of t.items) {
                const existing = productMap.get(item.productId) || { name: item.productName, qty: 0, revenue: 0 }
                existing.qty += item.quantity
                existing.revenue += item.lineTotal
                productMap.set(item.productId, existing)
            }
        }
        const topProducts = Array.from(productMap.entries())
            .map(([id, v]) => ({ id, name: v.name, quantity: v.qty, revenue: v.revenue }))
            .sort((a, b) => b.revenue - a.revenue)
            .slice(0, 10)

        // Unique cashiers — resolve names from the User table for legacy
        // transactions whose createdByName was never persisted (avoids showing the raw id).
        const cashierIds = [...new Set(recent.map(t => t.createdBy).filter(Boolean))] as string[]
        const cashierUsers = cashierIds.length
            ? await prisma.user.findMany({ where: { id: { in: cashierIds } }, select: { id: true, name: true } })
            : []
        const cashierNameMap = Object.fromEntries(cashierUsers.map(u => [u.id, u.name]))
        const cashierSet = new Map<string, string>()
        for (const t of recent) {
            if (t.createdBy) cashierSet.set(t.createdBy, t.createdByName || cashierNameMap[t.createdBy] || t.createdBy)
        }
        const cashiers = Array.from(cashierSet.entries()).map(([id, name]) => ({ id, name }))

        // Total debt: nợ còn lại thực = total - amountReceived của đơn 'partial'
        // (payment 'credit' gốc không giảm khi khách trả nợ — /pay-debt chỉ cộng
        // amountReceived — nên cộng payment credit sẽ đếm dư sau khi thu nợ).
        const totalDebt = partial.reduce((s, t) => s + Math.max(0, t.total - (t.amountReceived ?? 0)), 0)

        const statsResponse = {
            success: true,
            data: {
                totalOrders,
                totalRevenue,
                completedCount,
                voidedCount,
                returnedCount,
                revenueToday,
                revenueYesterday,
                ordersToday: todayTx.length,
                ordersYesterday: yesterdayTx.length,
                totalDebt,
                debtCount: partial.length,
                byHour,
                byDay,
                paymentBreakdown,
                topProducts,
                cashiers,
            },
        }
        await cacheSet(statsCacheKey, statsResponse, 300)
        res.json(statsResponse)
    } catch (err) {
        console.error('Get transaction stats error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

/**
 * GET /api/transactions/by-salesperson?from=&to=  — doanh số theo nhân viên bán
 *
 * ⚠ PHẢI KHAI TRƯỚC `/:id`, nếu không Express nuốt luôn thành id.
 *
 * Gom theo `salespersonId` chứ KHÔNG theo `createdBy`: `createdBy` là người bấm
 * máy. Đo 15/08/2026 thấy HUTI bán 20+ đơn/ngày, 14 tỷ doanh thu mà chỉ có
 * ĐÚNG 2 tài khoản — cả cửa hàng ghi chung một login, nên gom theo `createdBy`
 * chỉ ra hai dòng và không nói được ai bán.
 *
 * PHIẾU CHƯA GHI TÊN AI được gom vào một dòng riêng thay vì bỏ đi im lặng:
 * bỏ đi thì tổng các dòng KHÔNG bằng doanh thu thật, người xem cộng lại thấy
 * thiếu mà không hiểu vì sao. Toàn bộ dữ liệu trước hôm nay đều nằm ở dòng đó.
 */
router.get('/by-salesperson', authMiddleware, requirePermission('pos.view'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { from, to } = req.query as any
        if (!from || !to) {
            res.status(400).json({ success: false, error: 'Thiếu khoảng ngày (from, to)' }); return
        }
        // Cắt kỳ theo GIỜ VN: DB lưu UTC, cắt thẳng là lệch 7 tiếng ở hai đầu kỳ.
        const start = new Date(`${String(from).slice(0, 10)}T00:00:00+07:00`)
        const end = new Date(new Date(`${String(to).slice(0, 10)}T00:00:00+07:00`).getTime() + 86400_000)
        if (isNaN(start.getTime()) || isNaN(end.getTime())) {
            res.status(400).json({ success: false, error: 'Khoảng ngày không hợp lệ' }); return
        }

        /* Lọc theo NGÀY BÁN, không theo ngày ghi dòng: cửa hàng nhập lịch sử từ
         * phần mềm cũ có `createdAt` là lúc chạy nhập, cắt theo nó thì doanh số
         * dồn hết vào sai kỳ. Xem [[ngay-ban-vs-ngay-tao-dong]]. */
        const where: any = {
            ...getBranchFilter(req as any),
            // Đơn ghi nợ là 'partial' — lọc mỗi 'completed' là hụt doanh thu.
            status: { in: ['completed', 'partial'] },
            OR: [
                { transactionDate: { gte: start, lt: end } },
                { transactionDate: null, createdAt: { gte: start, lt: end } },
            ],
        }

        /* GOM THEO `salespersonId` THÔI, không gom kèm tên.
         *
         * `salespersonName` là ẢNH CHỤP lúc bán. Gom theo cả hai thì một người
         * đổi tên trong hồ sơ (sửa chính tả, thêm họ) bị XÉ THÀNH NHIỀU DÒNG —
         * phiếu cũ mang tên cũ, phiếu mới mang tên mới, bảng xếp hạng chia đôi
         * doanh số của cùng một người và không ai hiểu vì sao. */
        const rows = await prisma.transaction.groupBy({
            by: ['salespersonId'],
            where,
            _sum: { total: true, tax: true },
            _count: { _all: true },
        })

        /* Tên hiển thị lấy từ hồ sơ HIỆN TẠI để bảng luôn gọi đúng tên người ta
         * đang dùng; ai đã xoá khỏi hồ sơ thì lùi về tên đã lưu trên phiếu gần
         * nhất — mất hồ sơ không được làm mất luôn dòng doanh số. Chạy TUẦN TỰ,
         * pool mỗi cửa hàng chỉ 5 kết nối. */
        const cacId = rows.map((r: any) => r.salespersonId).filter(Boolean) as string[]
        const tenHienTai: Record<string, string> = {}
        if (cacId.length) {
            const nv = await prisma.user.findMany({
                where: { id: { in: cacId } }, select: { id: true, name: true },
            }).catch(() => [])
            for (const u of nv) tenHienTai[u.id] = u.name
        }
        const tenTrenPhieu: Record<string, string> = {}
        for (const id of cacId) {
            if (tenHienTai[id]) continue
            const p = await prisma.transaction.findFirst({
                where: { ...where, salespersonId: id, salespersonName: { not: null } },
                orderBy: { createdAt: 'desc' }, select: { salespersonName: true },
            }).catch(() => null)
            if (p?.salespersonName) tenTrenPhieu[id] = p.salespersonName
        }

        const ds = rows.map((r: any) => {
            const tong = Number(r._sum?.total) || 0
            const thue = Number(r._sum?.tax) || 0
            return {
                nhanVienId: r.salespersonId || null,
                tenNhanVien: r.salespersonId
                    ? (tenHienTai[r.salespersonId] || tenTrenPhieu[r.salespersonId] || '(nhân viên đã xoá)')
                    : 'Chưa ghi tên nhân viên',
                soPhieu: Number(r._count?._all) || 0,
                // `Transaction.total` ĐÃ GỒM thuế — trừ ra mới so được với doanh thu thuần
                doanhThu: tong,
                doanhThuTruocThue: tong - thue,
            }
        }).sort((a: any, b: any) => b.doanhThu - a.doanhThu)

        const tongDoanhThu = ds.reduce((s: number, x: any) => s + x.doanhThu, 0)
        const chuaGhi = ds.find((x: any) => !x.nhanVienId)
        res.json({
            success: true,
            data: {
                ky: { from: String(from).slice(0, 10), to: String(to).slice(0, 10) },
                tongDoanhThu,
                soNhanVienCoDoanhSo: ds.filter((x: any) => x.nhanVienId).length,
                /* Nói thẳng phần chưa ghi tên chiếm bao nhiêu. Bảng xếp hạng mà
                 * 90% doanh thu nằm ở "chưa ghi tên" thì thứ hạng vô nghĩa —
                 * người xem phải biết điều đó trước khi tin bảng. */
                chuaGhiTen: chuaGhi ? {
                    doanhThu: chuaGhi.doanhThu,
                    soPhieu: chuaGhi.soPhieu,
                    tyLePhanTram: tongDoanhThu > 0 ? Math.round((chuaGhi.doanhThu / tongDoanhThu) * 1000) / 10 : 0,
                } : null,
                danhSach: ds,
            },
        })
    } catch (err) {
        console.error('Get sales by salesperson error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// GET /api/transactions/:id
router.get('/:id', authMiddleware, requirePermission('pos.view'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const branchId = getBranchId(req)
        const transaction = await prisma.transaction.findUnique({
            where: { id: String(req.params.id) },
            include: { 
                items: {
                    include: { product: { select: { costPrice: true } } }
                }, 
                payments: true 
            },
        })

        if (!transaction) {
            res.status(404).json({ success: false, error: 'Transaction not found' })
            return
        }

        // Branch ownership: prevent reading another branch's transaction by id
        if (!canAccessBranch(req, transaction.branchId)) {
            res.status(404).json({ success: false, error: 'Transaction not found' })
            return
        }

        res.json({
            success: true,
            data: {
                ...transaction,
                createdAt: transaction.createdAt.toISOString(),
                returnedAt: transaction.returnedAt?.toISOString(),
            },
        })
    } catch (err) {
        console.error('Get transaction error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// POST /api/transactions — POS Checkout
router.post('/', authMiddleware, requirePermission('pos.create_order'), validate(CreateTransactionSchema), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const branchId = getBranchId(req)
        console.log(`[DEBUG-TX-POST] branchId=${branchId}, headers.x-branch-id=${req.headers['x-branch-id']}, jwt.branchId=${req.user?.branchId}, isMainBranch=${req.user?.isMainBranch}`)
        const { items, payments, appliedPromotionIds, ...txData } = req.body

        if (!items || !Array.isArray(items) || items.length === 0) {
            res.status(400).json({ success: false, error: 'Items are required' })
            return
        }

        // Van-sales context: when x-warehouse-id is present, this checkout sells from
        // a vehicle's mobile warehouse instead of the main store stock. Stock for the
        // sale must come from WarehouseStock (loaded onto the vehicle ahead of time)
        // rather than from Product.stock, which was already decremented at trip-load.
        const warehouseHeader = req.headers['x-warehouse-id']
        const salesTripHeader = req.headers['x-sales-trip-id']
        const vanWarehouseId = Array.isArray(warehouseHeader) ? warehouseHeader[0] : warehouseHeader
        const salesTripId = Array.isArray(salesTripHeader) ? salesTripHeader[0] : salesTripHeader
        const isVanSale = !!vanWarehouseId

        // Get user info
        const user = await prisma.user.findUnique({ where: { id: req.user!.userId } })

        /* NHÂN VIÊN ĐƯỢC TÍNH DOANH SỐ.
         *
         * Phải TRA LẠI trong DB, không dùng tên client gửi lên — nếu tin thẳng
         * thì ai cũng sửa được doanh số của người khác bằng cách đổi payload.
         * Chọn phải là nhân viên CÒN LÀM: gán doanh số cho người đã nghỉ là
         * đường để lách chỉ tiêu.
         *
         * Không chọn thì mặc định chính người đang bấm máy — cửa hàng nhỏ một
         * người vừa bán vừa thu tiền vẫn có số liệu đúng mà không phải thao tác
         * gì thêm. Chạy TUẦN TỰ, pool mỗi cửa hàng chỉ 5 kết nối. */
        let nvBan: { id: string; name: string } | null =
            user ? { id: user.id, name: user.name } : null
        const nvBanId = String(txData.salespersonId || '').trim()
        if (nvBanId && nvBanId !== req.user!.userId) {
            const nv = await prisma.user.findFirst({
                where: { id: nvBanId, employeeStatus: 'active' },
                select: { id: true, name: true },
            }).catch(() => null)
            // Không tìm thấy / đã nghỉ → GIỮ mặc định, không ghi id rác vào sổ
            if (nv) nvBan = nv
        }

        // Generate receipt number
        const count = await prisma.transaction.count()
        let receiptNumber = txData.receiptNumber || `HD${Date.now()}${String(count + 1).padStart(4, '0')}`

        // If this is a revision of an existing transaction, generate .1/.2/.3 suffix.
        // Giữ base + suffix ra biến riêng để retry khi 2 revise đồng thời đụng số (P2002).
        let revisionBaseReceipt: string | null = null
        let revisionSuffix = 0
        // Bản gốc đầy đủ (kèm dòng hàng) — dùng để hoàn kho atomic bên trong
        // $transaction phía dưới, không chỉ để đặt số phiếu.
        let revisionSource: any = null
        if (txData.revisionOfId) {
            try {
                const sourceTransaction = await prisma.transaction.findUnique({
                    where: { id: txData.revisionOfId },
                    include: { items: true },
                })
                if (sourceTransaction) {
                    revisionSource = sourceTransaction
                    // Get the base receipt number (strip any existing .N suffix)
                    revisionBaseReceipt = sourceTransaction.receiptNumber.replace(/\.\d+$/, '')
                    // Count how many revisions already exist
                    const existingRevisions = await prisma.transaction.count({
                        where: { receiptNumber: { startsWith: revisionBaseReceipt + '.' } },
                    })
                    revisionSuffix = existingRevisions + 1
                    receiptNumber = `${revisionBaseReceipt}.${revisionSuffix}`
                }
            } catch (revErr) {
                console.warn('[Revision] Could not generate revision receipt number:', revErr)
            }
        }

        // Công nợ SUY RA từ dữ liệu đơn (không tin debtAmount client gửi để tránh lệch
        // với stats total-amountReceived): đơn 'partial' nợ = total - đã thu, else 0 (#15).
        const _status = txData.status || 'completed'
        const _amountReceived = Number(txData.amountReceived) || 0
        const _totalForDebt = Number(txData.total) || 0
        const debtAmount = _status === 'partial'
            ? Math.max(0, Math.round(_totalForDebt - _amountReceived))
            : 0

        // Look up products with their unit conversions so we can convert
        // sale-unit quantities (e.g., 1 cuộn) into base-unit stock movements (e.g., 1000 m).
        const productIds = [...new Set(items.map((i: any) => i.productId).filter(Boolean))] as string[]
        const productsWithConv = productIds.length > 0
            ? await prisma.product.findMany({
                where: { id: { in: productIds } },
                include: { unitConversions: true },
            })
            : []
        const productMap = new Map(productsWithConv.map(p => [p.id, p]))

        // For each line, resolve conversion rate against the live product record.
        const itemsWithConversion = items.map((item: any) => {
            const product = productMap.get(item.productId)
            const selectedUnit: string | null = item.selectedUnit || product?.baseUnit || null
            const rate = resolveConversionRate(product as any, selectedUnit)
            const baseQuantity = Math.round(item.quantity * rate)
            return { ...item, selectedUnit, conversionRate: rate, baseQuantity }
        })

        // Cấu hình cửa hàng: cho phép bán âm kho + tự động hạch toán (đọc 1 lần
        // trước transaction). Guard chống oversell thật nằm BÊN TRONG $transaction
        // bên dưới (updateMany + gte) nên không còn race check-rồi-mới-trừ.
        const settings = await prisma.storeSettings
            .findFirst({ select: { allowNegativeStock: true, autoCreateJournalEntries: true } })
            .catch(() => null)
        const allowNegativeStock = settings?.allowNegativeStock ?? false

        // Ordinary sale: the branch's default "main" warehouse is decremented in
        // lock-step with Product.stock. Resolve it up front (an explicit body
        // warehouseId wins). Van sales decrement the vehicle warehouse instead.
        let defaultWarehouseId: string | null = null
        if (!isVanSale) {
            if (txData.warehouseId) {
                defaultWarehouseId = String(txData.warehouseId)
            } else {
                const wh = await getOrCreateDefaultWarehouse(prisma as any, branchId || null)
                defaultWarehouseId = wh?.id || null
            }
        }

        // Normalize applied promotions list once so we can both persist it on the
        // Transaction (audit trail) and bump Promotion.usageCount atomically below.
        const promoIds: string[] = (Array.isArray(appliedPromotionIds) ? appliedPromotionIds : [])
            .map((v: any) => String(v))
            .filter((v: string) => v.length > 0)

        // Build create data — use undefined to omit optional FK fields
        const createData: any = {
            receiptNumber,
            subtotal: txData.subtotal || 0,
            discount: txData.discount || 0,
            discountType: txData.discountType || 'fixed',
            tax: txData.tax || 0,
            total: txData.total || 0,
            amountReceived: txData.amountReceived || 0,
            change: txData.change || 0,
            status: txData.status || 'completed',
            createdBy: req.user!.userId,
            createdByName: user?.name || 'Admin',
            /* NHÂN VIÊN ĐƯỢC TÍNH DOANH SỐ — do POS chọn, mặc định là chính
             * người đang bấm máy. Tên lấy TỪ DATABASE chứ không lấy tên client
             * gửi lên: client gửi gì cũng tin thì doanh số ai cũng sửa được. */
            salespersonId: nvBan?.id || null,
            salespersonName: nvBan?.name || null,
            notes: txData.notes || null,
            transactionDate: txData.transactionDate ? new Date(txData.transactionDate) : null,
            branchId: branchId || null,
            appliedPromotionIds: promoIds.length > 0 ? JSON.stringify(promoIds) : null,
            channel: isVanSale ? 'van' : (txData.channel || 'direct'),
            items: {
                create: itemsWithConversion.map((item: any) => ({
                    productId: item.productId,
                    productName: item.productName,
                    sku: item.sku || item.productSku || '',
                    quantity: item.quantity,
                    unitPrice: item.unitPrice,
                    discount: item.discount || 0,
                    discountType: item.discountType || 'fixed',
                    lineTotal: item.lineTotal,
                    // Số đã trừ kho thật theo đơn vị gốc — dùng khi hoàn kho (void/return/revise)
                    baseQuantity: item.baseQuantity,
                })),
            },
        }

        // Only set customer fields if customerId is provided and non-empty
        if (txData.customerId) {
            createData.customerId = txData.customerId
            createData.customerName = txData.customerName || null
            createData.customerPhone = txData.customerPhone || null
        }

        // Only add payments if provided
        if (payments && Array.isArray(payments) && payments.length > 0) {
            createData.payments = {
                create: payments.map((p: any) => ({
                    type: p.type,
                    amount: p.amount,
                    reference: p.reference || null,
                })),
            }
        }

        // ── Checkout ATOMIC ──────────────────────────────────────────────────────
        // Tạo đơn + items + payments + trừ Product.stock + WarehouseStock + van-sale
        // + công nợ khách + DebtEntry + bút toán: cùng sống chết trong 1 transaction.
        // Lỗi ở bất kỳ bước nào → rollback hết (hết hàng trả 409, không nuốt lỗi).
        // Retry tối đa 5 lần khi số phiếu revision đụng unique (2 revise đồng thời).
        let transaction: any
        for (let attempt = 0; ; attempt++) {
            createData.receiptNumber = receiptNumber
            try {
                transaction = await prisma.$transaction(async (tx) => {
                    const created = await tx.transaction.create({
                        data: createData,
                        include: {
                            items: {
                                include: { product: { select: { costPrice: true } } }
                            },
                            payments: true
                        },
                    })

                    // Bump promo usage cùng transaction với đơn
                    for (const promoId of promoIds) {
                        await tx.promotion.update({
                            where: { id: promoId },
                            data: { usageCount: { increment: 1 } },
                        })
                    }

                    /**
                     * SỬA ĐƠN (revisionOfId): hoàn kho bản gốc TRƯỚC khi trừ dòng
                     * mới — cùng sống chết trong giao dịch này. Trước đây hoàn kho
                     * nằm ở /:id/revise gọi SAU khi tạo đơn, nên sửa đơn nhiều hàng
                     * bị 409 "hết hàng" oan (kho còn giữ phần đã trừ của bản gốc),
                     * kéo cả luồng gắn phiếu bảo hành chết theo (13/08/2026).
                     * updateMany có điều kiện = giành quyền huỷ race-safe: chỉ MỘT
                     * create được hoàn kho; /:id/revise gọi sau thấy 'voided' là
                     * dừng (400 sẵn có) nên FE bundle cũ 2 bước không hoàn kho đúp.
                     */
                    if (revisionSource) {
                        const gianhQuyenHuy = await tx.transaction.updateMany({
                            where: { id: revisionSource.id, status: { not: 'voided' } },
                            data: {
                                status: 'voided',
                                notes: (revisionSource.notes ? revisionSource.notes + '\n' : '') + `[Cập nhật] → ${receiptNumber}`,
                            },
                        })
                        if (gianhQuyenHuy.count === 1) {
                            const khoGoc = await getOrCreateDefaultWarehouse(tx as any, revisionSource.branchId || null)
                            for (const dong of (revisionSource.items || []) as any[]) {
                                const traLai = dong.baseQuantity > 0 ? dong.baseQuantity : dong.quantity
                                if (!dong.productId || !(traLai > 0)) continue
                                await tx.product.updateMany({
                                    where: { id: dong.productId },
                                    data: { stock: { increment: traLai } },
                                })
                                if (khoGoc?.id) {
                                    await updateWarehouseStock(tx as any, khoGoc.id, dong.productId, traLai)
                                }
                                await tx.inventoryTransaction.create({
                                    data: {
                                        type: 'adjustment',
                                        productId: dong.productId,
                                        productName: dong.productName,
                                        productSku: dong.sku || '',
                                        quantity: traLai,
                                        reason: `Cập nhật phiếu - ${revisionSource.receiptNumber} → ${receiptNumber}`,
                                        note: `Hoàn kho do cập nhật giao dịch ${revisionSource.receiptNumber}`,
                                        referenceId: revisionSource.receiptNumber,
                                        referenceType: 'revision',
                                        unitPrice: dong.unitPrice || 0,
                                        userId: req.user!.userId,
                                        userName: user?.name || 'Admin',
                                    },
                                })
                            }
                            // Trả lại thống kê khách của bản gốc (đơn mới cộng lại bên dưới)
                            if (revisionSource.customerId) {
                                await tx.customer.updateMany({
                                    where: { id: revisionSource.customerId },
                                    data: { totalPurchases: { decrement: revisionSource.total }, totalOrders: { decrement: 1 } },
                                })
                            }
                        }
                    }

                    // Trừ kho + ghi thẻ kho theo ĐƠN VỊ GỐC (baseQuantity).
                    // Van sale: Product.stock đã trừ lúc chất hàng lên xe — chỉ trừ kho xe.
                    for (const item of itemsWithConversion) {
                        let productAfter: { costPrice: number } | null = null
                        if (isVanSale) {
                            productAfter = await tx.product.findUnique({ where: { id: item.productId }, select: { costPrice: true } })
                        } else if (allowNegativeStock) {
                            productAfter = await tx.product.update({
                                where: { id: item.productId },
                                data: { stock: { decrement: item.baseQuantity } },
                            })
                        } else {
                            // Guard chống âm race-safe: chỉ trừ khi còn đủ; count=0 = hết hàng
                            const dec = await tx.product.updateMany({
                                where: { id: item.productId, stock: { gte: item.baseQuantity } },
                                data: { stock: { decrement: item.baseQuantity } },
                            })
                            if (dec.count === 0) {
                                const p = await tx.product.findUnique({ where: { id: item.productId }, select: { stock: true } })
                                throw new StockConflictError(`Sản phẩm "${item.productName}" chỉ còn ${p?.stock ?? 0} trong kho (cần ${item.baseQuantity})`)
                            }
                            productAfter = await tx.product.findUnique({ where: { id: item.productId }, select: { costPrice: true } })
                        }

                        // Kho mặc định đi lock-step với Product.stock
                        if (defaultWarehouseId) {
                            if (allowNegativeStock) {
                                await updateWarehouseStock(tx as any, defaultWarehouseId, item.productId, -item.baseQuantity)
                            } else {
                                const whDec = await (tx as any).warehouseStock.updateMany({
                                    where: { warehouseId: defaultWarehouseId, productId: item.productId, quantity: { gte: item.baseQuantity } },
                                    data: { quantity: { decrement: item.baseQuantity } },
                                })
                                if (whDec.count === 0) {
                                    const row = await (tx as any).warehouseStock.findUnique({
                                        where: { warehouseId_productId: { warehouseId: defaultWarehouseId, productId: item.productId } },
                                    })
                                    if (row) {
                                        throw new StockConflictError(`Sản phẩm "${item.productName}" chỉ còn ${row.quantity} trong kho (cần ${item.baseQuantity})`)
                                    }
                                    // Row chưa tồn tại (dữ liệu cũ chưa reindex) — Product.stock đã guard ở trên,
                                    // upsert theo hành vi cũ để kho bắt đầu được theo dõi.
                                    await updateWarehouseStock(tx as any, defaultWarehouseId, item.productId, -item.baseQuantity)
                                }
                            }
                        }

                        // Create inventory transaction record for stock tracking
                        await tx.inventoryTransaction.create({
                            data: {
                                type: 'sale',
                                productId: item.productId,
                                productName: item.productName,
                                productSku: item.sku || item.productSku || '',
                                quantity: -item.baseQuantity,
                                reason: `Bán hàng - ${receiptNumber}`,
                                note: `Giao dịch ${receiptNumber}`,
                                referenceId: receiptNumber,
                                referenceType: 'sale',
                                unitPrice: item.unitPrice || 0,
                                costPriceAfter: productAfter?.costPrice || 0,
                                userId: req.user!.userId,
                                userName: user?.name || 'Admin',
                            },
                        })
                    }

                    // Van-sales: trừ kho xe (guard chống âm — không bán quá số trên xe)
                    // + cộng dồn SalesTripItem/SalesTrip. Lỗi thật phải rollback cả đơn.
                    if (isVanSale) {
                        for (const item of itemsWithConversion) {
                            const dec = await (tx as any).warehouseStock.updateMany({
                                where: { warehouseId: String(vanWarehouseId), productId: item.productId, quantity: { gte: item.baseQuantity } },
                                data: { quantity: { decrement: item.baseQuantity } },
                            })
                            if (dec.count === 0) {
                                const row = await (tx as any).warehouseStock.findUnique({
                                    where: { warehouseId_productId: { warehouseId: String(vanWarehouseId), productId: item.productId } },
                                })
                                throw new StockConflictError(`Sản phẩm "${item.productName}" chỉ còn ${row?.quantity ?? 0} trên xe (cần ${item.baseQuantity})`)
                            }
                        }

                        if (salesTripId) {
                            const totalBaseQty = itemsWithConversion.reduce((s: number, i: any) => s + i.baseQuantity, 0)

                            for (const item of itemsWithConversion) {
                                await (tx as any).salesTripItem.upsert({
                                    where: { tripId_productId: { tripId: String(salesTripId), productId: item.productId } },
                                    update: { soldQty: { increment: item.baseQuantity } },
                                    create: {
                                        tripId: String(salesTripId),
                                        productId: item.productId,
                                        productName: item.productName,
                                        productSku: item.sku || item.productSku || null,
                                        loadedQty: 0,
                                        soldQty: item.baseQuantity,
                                        unitPrice: item.unitPrice || 0,
                                    },
                                })
                            }

                            await (tx as any).salesTrip.update({
                                where: { id: String(salesTripId) },
                                data: {
                                    totalSold: { increment: totalBaseQty },
                                    totalRevenue: { increment: created.total },
                                },
                            })

                            /* Ghi vết từng đơn vào nhật ký chuyến. Đường chuyển
                             * đơn có sẵn từ lâu đã ghi, còn đường bán thẳng trên
                             * POS thì không — hệ quả là bảng tổng kết chuyến
                             * không liệt kê được đơn nào và không tính được tiền
                             * mặt nhân viên phải nộp. Ghi ở đây để đối soát cuối
                             * chuyến truy ngược được về đúng hoá đơn.
                             *
                             * catch rỗng có chủ đích: mất một dòng nhật ký không
                             * đáng để huỷ cả giao dịch bán đã trừ kho xong. */
                            await (tx as any).salesTripLog.create({
                                data: {
                                    tripId: String(salesTripId),
                                    action: 'sale',
                                    notes: `Bán tại chuyến: ${created.receiptNumber} (${totalBaseQty} sp, ${Math.round(created.total || 0).toLocaleString('vi-VN')}đ)`,
                                    userId: req.user!.userId,
                                    userName: req.user?.email || null,
                                    metadata: JSON.stringify({
                                        transactionId: created.id,
                                        receiptNumber: created.receiptNumber,
                                        total: created.total,
                                    }),
                                },
                            }).catch(() => { })
                        }
                    }

                    // Customer stats + công nợ + DebtEntry — cùng transaction, lỗi thật rollback
                    if (txData.customerId) {
                        const customerUpdate: any = {
                            totalPurchases: { increment: created.total },
                            totalOrders: { increment: 1 },
                            lastPurchaseDate: new Date(),
                        }

                        // Add debt if credit payment
                        if (debtAmount > 0) {
                            customerUpdate.debt = { increment: debtAmount }
                        }

                        const updatedCustomer = await tx.customer.update({
                            where: { id: txData.customerId },
                            data: customerUpdate,
                        })

                        // Ghi sổ chi tiết công nợ cho phần bán chịu — DebtEntry là sổ cái,
                        // Customer.debt là số dư; hai bên phải đi cùng nhau.
                        if (debtAmount > 0) {
                            await tx.debtEntry.create({
                                data: {
                                    customerId: txData.customerId,
                                    customerName: updatedCustomer.name,
                                    phone: updatedCustomer.phone || null,
                                    type: 'debt',
                                    amount: debtAmount,
                                    description: `Nợ từ HĐ ${receiptNumber}`,
                                    balance: Math.max(0, updatedCustomer.debt),
                                },
                            })
                        }
                    }

                    // Bút toán tự động (doanh thu/VAT/giá vốn) — cùng transaction khi bật.
                    // Helper tự bỏ qua ref đã tồn tại (idempotent theo SALE-/VAT-/COGS-...).
                    if (settings?.autoCreateJournalEntries !== false) {
                        await createJournalEntriesForTransaction(tx, created as any, {
                            branchId: branchId || null,
                            userId: req.user!.userId,
                            skipDupCheck: false,
                        })
                    }

                    return created
                }, { timeout: 30000 })
                break
            } catch (txErr: any) {
                // Trùng số phiếu (unique receiptNumber) → sinh lại rồi thử lại (tối đa 5 lần).
                // Xảy ra khi 2 checkout đồng thời cùng đọc count (#14) HOẶC 2 revise đụng suffix.
                if (txErr?.code === 'P2002' && attempt < 4
                    && String(txErr?.meta?.target ?? '').includes('receiptNumber')) {
                    if (revisionBaseReceipt) {
                        revisionSuffix++
                        receiptNumber = `${revisionBaseReceipt}.${revisionSuffix}`
                    } else {
                        // đơn thường: số mới theo timestamp + hậu tố ngẫu nhiên, tránh đụng lại
                        receiptNumber = `HD${Date.now()}${String(Math.floor(Math.random() * 9000) + 1000)}`
                    }
                    continue
                }
                throw txErr
            }
        }

        // Increment bundle soldCount for any bundles included in the order (best-effort)
        const bundleIds = [...new Set(items.filter((i: any) => i.isBundle && i.bundleId).map((i: any) => i.bundleId))]
        for (const bundleId of bundleIds) {
            await prisma.bundle.update({
                where: { id: bundleId },
                data: { soldCount: { increment: 1 } }
            }).catch(err => {
                console.error(`Failed to increment soldCount for bundle ${bundleId}:`, err)
            })
        }

        if (txData.customerId) {
            // ── Loyalty points earn ───────────────────────────────────────────────
            try {
                const customer = await prisma.customer.findUnique({ where: { id: txData.customerId } })
                if (customer) {
                    // 1 point per 1,000đ spent
                    const earnedPoints = Math.floor(transaction.total / 1000)
                    if (earnedPoints > 0) {
                        const newPoints = (customer.loyaltyPoints || 0) + earnedPoints
                        const cumulative = customer.totalPurchases || 0

                        // Auto-tier upgrade based on cumulative spending
                        let newTier = customer.tier || 'bronze'
                        if (cumulative >= 50_000_000) newTier = 'vip'
                        else if (cumulative >= 20_000_000) newTier = 'gold'
                        else if (cumulative >= 5_000_000) newTier = 'silver'
                        else newTier = 'bronze'

                        /* Cột hạng khách tên là `tier`, KHÔNG phải `loyaltyTier`.
                         * Viết sai tên làm cả lệnh update ném lỗi, catch bên dưới
                         * nuốt mất và chỉ log "non-critical" — hậu quả là ĐIỂM
                         * TÍCH LUỸ CHƯA TỪNG ĐƯỢC CỘNG cho khách nào, suốt thời
                         * gian dài, mà không ai biết. Xác nhận trên log
                         * production ngày 14/08/2026. */
                        await (prisma as any).customer.update({
                            where: { id: txData.customerId },
                            data: {
                                loyaltyPoints: newPoints,
                                tier: newTier,
                            },
                        })
                        console.log(`[Loyalty] Customer ${customer.name}: +${earnedPoints} pts → ${newPoints} (tier: ${newTier})`)
                    }
                }
            } catch (loyaltyErr) {
                console.warn('[Loyalty] Points update failed (non-critical):', loyaltyErr)
            }
        }

        cacheDel(`${req.user?.storeSchema || 'default'}:*:transactions:*`).catch(() => { })
        if (promoIds.length > 0) {
            cacheDel(`${req.user?.storeSchema || 'default'}:promotions:*`).catch(() => { })
        }
        console.log(`✅ Transaction ${receiptNumber} created — ${items.length} items, total: ${transaction.total}`)

        // Publish realtime event
        publishEvent(req.user?.storeSchema, 'transaction:created', {
            id: transaction.id,
            receiptNumber,
            total: transaction.total,
            status: transaction.status,
            createdByName: transaction.createdByName,
            customerName: transaction.customerName || 'Khách lẻ',
            itemCount: items.length,
            createdAt: transaction.createdAt.toISOString(),
        }, branchId).catch(() => { })

        // TRẢ KẾT QUẢ BÁN HÀNG TRƯỚC — webhook chạy sau, TUYỆT ĐỐI không chặn/chậm POS.
        res.status(201).json({
            success: true,
            data: {
                ...transaction,
                createdAt: transaction.createdAt.toISOString(),
                transactionDate: transaction.transactionDate?.toISOString() || transaction.createdAt.toISOString(),
            },
        })

        // ── Webhook đầu ra (POST-RESPONSE, fire-and-forget) ───────────────────────
        // Response đã gửi xong nên dù chậm cũng không ảnh hưởng người bán. Bọc try
        // riêng để không bao giờ rơi vào catch phía dưới (tránh "headers already sent").
        if (webhooksActive()) {
            try {
                let invPayload: any = invoicePayload(transaction)
                if (transaction.customerId) {
                    const cust = await prisma.customer.findUnique({ where: { id: transaction.customerId }, select: { code: true, phone: true, email: true } }).catch(() => null)
                    if (cust) invPayload = { ...invPayload, customerCode: cust.code, customerPhone: cust.phone, customerEmail: cust.email }
                }
                emitEntityEvent(prisma, 'invoice.created', invPayload, req.user?.storeSchema).catch(() => { })
                // stock.changed — van-sale không đổi Product.stock (đã trừ lúc chất xe) → bỏ.
                if (!isVanSale) {
                    const deltaByProduct = new Map<string, { delta: number; sku?: string; name?: string }>()
                    for (const item of itemsWithConversion) {
                        const cur = deltaByProduct.get(item.productId) || { delta: 0, sku: item.sku || item.productSku, name: item.productName }
                        cur.delta += item.baseQuantity
                        deltaByProduct.set(item.productId, cur)
                    }
                    const rows = await prisma.product.findMany({
                        where: { id: { in: [...deltaByProduct.keys()] } },
                        select: { id: true, stock: true, sku: true, name: true },
                    })
                    const byId = new Map(rows.map((r: any) => [r.id, r]))
                    for (const [pid, agg] of deltaByProduct) {
                        const r: any = byId.get(pid)
                        emitStockChanged(prisma, {
                            productId: pid, sku: r?.sku ?? agg.sku, name: r?.name ?? agg.name,
                            branchId: branchId ?? null, delta: -agg.delta, stock: r?.stock ?? 0, reason: 'sale',
                        }, req.user?.storeSchema).catch(() => { })
                    }
                }
            } catch { /* webhook lỗi không ảnh hưởng đơn đã bán */ }
        }
    } catch (err) {
        // Hết hàng khi trừ kho trong transaction → đã rollback toàn bộ, trả 409
        if (err instanceof StockConflictError) {
            res.status(409).json({ success: false, error: err.message })
            return
        }
        console.error('Create transaction error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// PUT /api/transactions/:id/void
router.put('/:id/void', authMiddleware, requirePermission('pos.create_order'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const branchId = getBranchId(req)
        const existing = await prisma.transaction.findUnique({
            where: { id: String(req.params.id) },
            include: {
                items: {
                    include: { product: { select: { costPrice: true } } }
                }
            },
        })

        if (!existing) {
            res.status(404).json({ success: false, error: 'Transaction not found' })
            return
        }

        // Chặn thao tác chéo chi nhánh (mirror GET /:id)
        if (!canAccessBranch(req, existing.branchId)) {
            res.status(404).json({ success: false, error: 'Transaction not found' })
            return
        }

        if (existing.status === 'voided' || existing.status === 'returned') {
            res.status(400).json({ success: false, error: 'Transaction already voided/returned' })
            return
        }

        const user = await prisma.user.findUnique({ where: { id: req.user!.userId } })
        const voidWarehouse = await getOrCreateDefaultWarehouse(prisma as any, existing.branchId || null)
        const stockEmits: any[] = []

        // ATOMIC (#8): đổi status + hoàn kho + WarehouseStock + ledger + công nợ cùng
        // sống chết trong 1 transaction — crash giữa chừng không để lệch tồn vs công nợ.
        const transaction = await prisma.$transaction(async (tx: any) => {
            const t = await tx.transaction.update({
                where: { id: String(req.params.id) },
                data: { status: 'voided' },
                include: { items: { include: { product: { select: { costPrice: true } } } } },
            })

            // Hoàn kho theo ĐƠN VỊ GỐC (baseQuantity; cũ=0 → fallback quantity).
            for (const item of t.items) {
                const restoreQty = (item as any).baseQuantity > 0 ? (item as any).baseQuantity : item.quantity
                const updatedProduct = await tx.product.update({
                    where: { id: item.productId },
                    data: { stock: { increment: restoreQty } },
                })
                if (voidWarehouse?.id) await updateWarehouseStock(tx, voidWarehouse.id, item.productId, restoreQty)
                stockEmits.push({ productId: item.productId, sku: (updatedProduct as any).sku, name: (updatedProduct as any).name, delta: restoreQty, stock: (updatedProduct as any).stock })
                await tx.inventoryTransaction.create({
                    data: {
                        type: 'adjustment', productId: item.productId, productName: item.productName,
                        productSku: item.sku, quantity: restoreQty,
                        reason: `Hủy đơn - ${existing.receiptNumber}`, note: `Hoàn kho do hủy giao dịch ${existing.receiptNumber}`,
                        referenceId: existing.receiptNumber, referenceType: 'void',
                        unitPrice: item.unitPrice || 0, costPriceAfter: updatedProduct.costPrice,
                        userId: req.user!.userId, userName: user?.name || 'Admin',
                    },
                })
            }

            // Revert customer stats + outstanding debt of this sale
            if (existing.customerId) {
                const customerUpdate: any = { totalPurchases: { decrement: existing.total }, totalOrders: { decrement: 1 } }
                const outstanding = existing.status === 'partial' ? Math.max(0, existing.total - (existing.amountReceived ?? 0)) : 0
                let voidDebtReduction = 0, voidCustomer: any = null
                if (outstanding > 0) {
                    voidCustomer = await tx.customer.findUnique({
                        where: { id: existing.customerId }, select: { debt: true, name: true, phone: true },
                    })
                    voidDebtReduction = Math.min(outstanding, Math.max(0, voidCustomer?.debt ?? 0))
                    if (voidDebtReduction > 0) customerUpdate.debt = { decrement: voidDebtReduction }
                }
                await tx.customer.update({ where: { id: existing.customerId }, data: customerUpdate })
                if (voidDebtReduction > 0) {
                    await tx.debtEntry.create({
                        data: {
                            customerId: existing.customerId, customerName: voidCustomer?.name || (existing as any).customerName || 'Khách hàng',
                            phone: voidCustomer?.phone || null, type: 'return', amount: voidDebtReduction,
                            description: `Hủy đơn ${existing.receiptNumber} - xóa nợ`,
                            balance: Math.max(0, (voidCustomer?.debt ?? 0) - voidDebtReduction),
                        },
                    })
                }
            }
            return t
        }, { timeout: 30000 })

        // ĐẢO BÚT TOÁN doanh thu 511/VAT 3331/giảm giá 521/giá vốn 632/thu nợ đã post
        // lúc bán (#4, #7) — post-commit, best-effort (GL tách khỏi tồn/công nợ).
        await reverseJournalEntriesForTransaction(prisma, existing.receiptNumber, { branchId: existing.branchId ?? null, userId: req.user!.userId })
            /* Giữ nguyên thiết kế "post-commit, không chặn" (GL tách khỏi tồn/công nợ), nhưng KHÔNG
             * im lặng: hỏng ở đây nghĩa là sổ vẫn còn doanh thu của một phiếu ĐÃ HUỶ. Ghi ERROR để
             * lên Nhật ký lỗi của trang quản trị mà còn đi sửa (20/08/2026). */
            .catch((e: any) => console.error(`[huy-phieu] Đảo bút toán HỎNG cho ${existing.receiptNumber} — sổ còn doanh thu của phiếu đã huỷ:`, moTaLoi(e)))

        // Webhook stock.changed do hoàn kho (post-commit, không chặn)
        for (const s of stockEmits) {
            emitStockChanged(prisma as any, { ...s, branchId: existing.branchId ?? null, reason: 'void' }, req.user?.storeSchema).catch(() => { })
        }

        cacheDel(`${req.user?.storeSchema || 'default'}:*:transactions:*`).catch(() => { })
        console.log(`🚫 Transaction ${existing.receiptNumber} voided`)

        // Publish realtime event
        publishEvent(req.user?.storeSchema, 'transaction:voided', {
            id: existing.id,
            receiptNumber: existing.receiptNumber,
            total: existing.total,
        }, branchId).catch(() => { })

        // Webhook đầu ra: thay đổi hóa đơn (hủy)
        emitEntityEvent(prisma, 'invoice.updated', { ...invoicePayload(transaction), changeType: 'void' }, req.user?.storeSchema).catch(() => { })

        res.json({
            success: true,
            data: {
                ...transaction,
                createdAt: transaction.createdAt.toISOString(),
            },
        })
    } catch (err) {
        console.error('Void transaction error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// PUT /api/transactions/:id/pay-debt — Pay off debt for partial transaction
router.put('/:id/pay-debt', authMiddleware, requirePermission('pos.create_order'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { paymentType, amount, reference } = req.body

        const existing = await prisma.transaction.findUnique({
            where: { id: String(req.params.id) },
            include: { payments: true },
        })

        if (!existing) {
            res.status(404).json({ success: false, error: 'Không tìm thấy giao dịch' })
            return
        }

        // Chặn thao tác chéo chi nhánh (mirror GET /:id)
        if (!canAccessBranch(req, existing.branchId)) {
            res.status(404).json({ success: false, error: 'Không tìm thấy giao dịch' })
            return
        }

        if (existing.status !== 'partial') {
            res.status(400).json({ success: false, error: 'Giao dịch không ở trạng thái ghi nợ' })
            return
        }

        // Remaining debt of this sale = total minus everything received so far.
        // (More reliable than the original credit payment amount, which stays
        // unchanged across partial repayments.)
        const remainingDebt = Math.max(0, existing.total - (existing.amountReceived ?? 0))
        if (remainingDebt <= 0) {
            res.status(400).json({ success: false, error: 'Giao dịch không còn nợ' })
            return
        }

        const payAmount = amount !== undefined && amount !== null ? Number(amount) : remainingDebt
        if (!Number.isFinite(payAmount) || payAmount <= 0) {
            res.status(400).json({ success: false, error: 'Số tiền thanh toán không hợp lệ' })
            return
        }
        if (payAmount > remainingDebt) {
            res.status(400).json({ success: false, error: `Số tiền vượt quá nợ còn lại (${remainingDebt})` })
            return
        }

        const fullyPaid = payAmount >= remainingDebt

        // Payment record + transaction status + customer debt must move together.
        const transaction = await prisma.$transaction(async (tx) => {
            const payment = await tx.payment.create({
                data: {
                    transactionId: existing.id,
                    type: paymentType || 'cash',
                    amount: payAmount,
                    reference: reference || `Thanh toán nợ ${existing.receiptNumber}`,
                },
            })

            const updated = await tx.transaction.update({
                where: { id: existing.id },
                data: {
                    // Keep 'partial' until the debt is fully settled so reports and
                    // follow-up payments still see the remaining balance.
                    status: fullyPaid ? 'completed' : 'partial',
                    amountReceived: existing.amountReceived + payAmount,
                },
                include: {
                    items: { include: { product: { select: { costPrice: true } } } },
                    payments: true
                },
            })

            if (existing.customerId) {
                const customer = await tx.customer.findUnique({
                    where: { id: existing.customerId },
                    select: { debt: true, name: true, phone: true },
                })
                const currentDebt = Math.max(0, customer?.debt ?? 0)
                const debtReduction = Math.min(payAmount, currentDebt)
                if (debtReduction > 0) {
                    await tx.customer.update({
                        where: { id: existing.customerId },
                        data: { debt: { decrement: debtReduction } },
                    })
                    await tx.debtEntry.create({
                        data: {
                            customerId: existing.customerId,
                            customerName: customer?.name || existing.customerName || 'Khách hàng',
                            phone: customer?.phone || null,
                            type: 'payment',
                            amount: debtReduction,
                            description: `Thanh toán nợ HĐ ${existing.receiptNumber}`,
                            balance: Math.max(0, currentDebt - debtReduction),
                        },
                    })
                    // Bút toán giảm phải thu: Nợ 111/112 / Có 131
                    await postDebtCollectionJournal(tx, {
                        amount: debtReduction,
                        refKey: `COLLECT-${existing.receiptNumber}-${payment.id}`, // khóa duy nhất theo lần thu (#19)
                        date: new Date().toISOString().slice(0, 10),
                        paymentType: paymentType,
                        customerName: customer?.name || existing.customerName,
                        receiptNumber: existing.receiptNumber,
                        branchId: (existing as any).branchId ?? null,
                        userId: req.user?.userId ?? null,
                    })
                }
            }

            return updated
        })

        // Audit log
        try {
            const user = await prisma.user.findUnique({ where: { id: req.user!.userId } })
            await prisma.auditLog.create({
                data: {
                    userId: req.user!.userId,
                    userName: user?.name || 'Admin',
                    action: 'pay_debt',
                    entity: 'Transaction',
                    entityId: existing.id,
                    details: JSON.stringify({ amount: payAmount, paymentType, receiptNumber: existing.receiptNumber }),
                },
            })
        } catch { }

        cacheDel(`${req.user?.storeSchema || 'default'}:*:transactions:*`).catch(() => { })
        console.log(`💰 Debt paid for ${existing.receiptNumber}: ${payAmount}`)

        res.json({
            success: true,
            data: {
                ...transaction,
                createdAt: transaction.createdAt.toISOString(),
            },
        })
    } catch (err) {
        console.error('Pay debt error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// PUT /api/transactions/:id/return — Return a transaction
router.put('/:id/return', authMiddleware, requirePermission('pos.create_order'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const branchId = getBranchId(req)
        const { reason, returnItems } = req.body

        const existing = await prisma.transaction.findUnique({
            where: { id: String(req.params.id) },
            include: {
                items: { include: { product: { select: { costPrice: true } } } }
            },
        })

        if (!existing) {
            res.status(404).json({ success: false, error: 'Transaction not found' })
            return
        }

        // Chặn thao tác chéo chi nhánh (mirror GET /:id)
        if (!canAccessBranch(req, existing.branchId)) {
            res.status(404).json({ success: false, error: 'Transaction not found' })
            return
        }

        if (existing.status === 'returned' || existing.status === 'voided') {
            res.status(400).json({ success: false, error: 'Transaction already returned/voided' })
            return
        }

        const user = await prisma.user.findUnique({ where: { id: req.user!.userId } })

        // Determine which items to return (all if returnItems not specified)
        const itemsToReturn = returnItems && Array.isArray(returnItems) && returnItems.length > 0
            ? existing.items.filter(i => returnItems.some((ri: any) => ri.productId === i.productId))
            : existing.items

        // Determine return quantities (from returnItems or use full qty)
        const returnQtyMap = new Map<string, number>()
        if (returnItems && Array.isArray(returnItems) && returnItems.length > 0) {
            /* ⚠ KHÔNG ĐƯỢC TIN SỐ LƯỢNG TRẢ TỪ CLIENT.
             *
             * Bản trước nhận thẳng `ri.quantity`, không kẹp theo số đã bán trên
             * dòng hàng — mà cả tiền hoàn lẫn tồn kho hoàn lại đều nhân theo tỷ
             * lệ qty/item.quantity. Gửi quantity:100 cho món bán 1 cái giá
             * 200.000đ là sinh phiếu trả 20.000.000đ, cộng khống 99 cái vào kho,
             * và trừ 20 triệu khỏi Customer.totalPurchases (âm). Chỉ cần quyền
             * pos.create_order, không có ràng buộc nào chặn.
             *
             * TỪ CHỐI chứ không kẹp âm thầm: kẹp thì người bấm tưởng đã trả 100
             * trong khi hệ chỉ ghi 1, và chênh lệch đó không ai phát hiện ra. */
            for (const ri of returnItems) {
                const dong = existing.items.find(i => i.productId === ri.productId)
                if (!dong) continue
                const xin = Number(ri.quantity)
                if (Number.isFinite(xin) && xin > dong.quantity) {
                    res.status(400).json({
                        success: false,
                        error: `Số lượng trả (${xin}) vượt quá số đã bán (${dong.quantity}) của "${dong.productName}"`,
                    })
                    return
                }
                if (Number.isFinite(xin) && xin < 0) {
                    res.status(400).json({ success: false, error: 'Số lượng trả không được âm' })
                    return
                }
                // Bỏ trống / 0 → hiểu là trả trọn dòng, giữ nguyên nếp cũ
                returnQtyMap.set(ri.productId, (Number.isFinite(xin) && xin > 0) ? xin : dong.quantity)
            }
        } else {
            for (const item of itemsToReturn) {
                returnQtyMap.set(item.productId, item.quantity)
            }
        }

        // Tiền hoàn theo giá THỰC TRẢ: đơn giá hiệu lực = lineTotal/quantity (đã gồm
        // chiết khấu dòng), trừ thêm phần giảm giá cấp đơn phân bổ theo tỷ trọng
        // lineTotal — không dùng unitPrice thô (hoàn dư cho đơn có giảm giá).
        const orderDiscountAmount = existing.discountType === 'percent'
            ? Math.round((existing.subtotal || 0) * (existing.discount || 0) / 100)
            : (existing.discount || 0)
        const returnTotal = itemsToReturn.reduce((sum, item) => {
            const qty = returnQtyMap.get(item.productId) || item.quantity
            if (!item.quantity) return sum
            const discountShare = existing.subtotal > 0
                ? orderDiscountAmount * (item.lineTotal / existing.subtotal)
                : 0
            return sum + Math.round((item.lineTotal - discountShare) * qty / item.quantity)
        }, 0)

        // Trả MỘT PHẦN không được đánh dấu cả đơn 'returned' (dashboard sẽ mất
        // toàn bộ doanh thu đơn). Chỉ 'returned' khi MỌI dòng đều trả đủ số lượng.
        const isFullReturn = existing.items.every(i => (returnQtyMap.get(i.productId) || 0) >= i.quantity)

        const transaction = await prisma.transaction.update({
            where: { id: String(req.params.id) },
            data: {
                status: isFullReturn ? 'returned' : existing.status,
                returnedAt: new Date(),
                returnReason: reason || 'Trả hàng',
            },
            include: {
                items: { include: { product: { select: { costPrice: true } } } },
                payments: true
            },
        })

        // Generate unique return document code (RT-0001, RT-0002, ...)
        const returnCode = await nextCode(prisma, 'returnOrderCodeSeq', 'RT', 4, '-', 'ReturnOrder', 'code')

        // Build return items as JSON for ReturnOrder.items (stored as String)
        const returnItemsJson = itemsToReturn.map((item: any) => ({
            productName: item.productName,
            sku: item.sku,
            quantity: returnQtyMap.get(item.productId) || item.quantity,
            unitPrice: item.unitPrice,
            productId: item.productId,
        }))

        // Create ReturnOrder record (try/catch — table may not be migrated yet)
        let returnOrder: any = null
        try {
            returnOrder = await prisma.returnOrder.create({
                data: {
                    code: returnCode,
                    originalInvoice: existing.receiptNumber,
                    customerName: (existing as any).customerName || 'Khách lẻ',
                    customerPhone: (existing as any).customerPhone || null,
                    reason: reason || 'Trả hàng',
                    items: {
                        create: returnItemsJson.map((i: any) => ({
                            productId: i.productId,
                            productName: i.productName,
                            sku: i.sku,
                            quantity: i.quantity,
                            unitPrice: i.unitPrice,
                        }))
                    },
                    totalRefund: returnTotal,
                    status: 'completed',
                    processedAt: new Date(),
                    notes: `Trả hàng từ giao dịch ${existing.receiptNumber}`,
                },
            })
        } catch (roErr: any) {
            console.warn(`⚠️ ReturnOrder table not ready: ${moTaLoi(roErr)} — returning without ReturnOrder record`)
        }

        // Restore stock for returned items + create inventory records.
        // Hoàn theo ĐƠN VỊ GỐC: trả một phần hoàn tỷ lệ baseQuantity × (qtyTrả/quantity);
        // bản ghi cũ baseQuantity=0 → fallback qty. Hoàn cả kho mặc định chi nhánh.
        const returnWarehouse = await getOrCreateDefaultWarehouse(prisma as any, existing.branchId || null)
        for (const item of itemsToReturn) {
            const qty = returnQtyMap.get(item.productId) || item.quantity
            const baseRestore = (item as any).baseQuantity > 0 && item.quantity > 0
                ? Math.round((item as any).baseQuantity * (qty / item.quantity))
                : qty
            const updatedProduct = await prisma.product.update({
                where: { id: item.productId },
                data: { stock: { increment: baseRestore } },
            })

            // Webhook đầu ra: stock.changed do hoàn kho khi trả hàng
            emitStockChanged(prisma as any, { productId: item.productId, sku: (updatedProduct as any).sku, name: (updatedProduct as any).name, branchId: existing.branchId ?? null, delta: baseRestore, stock: (updatedProduct as any).stock, reason: 'return' }, req.user?.storeSchema).catch(() => { })

            if (returnWarehouse?.id) {
                await updateWarehouseStock(prisma as any, returnWarehouse.id, item.productId, baseRestore)
                    .catch((err: any) => console.error(`[Return] WarehouseStock restore failed for product ${item.productId}:`, err))
            }

            await prisma.inventoryTransaction.create({
                data: {
                    type: 'return',
                    productId: item.productId,
                    productName: item.productName,
                    productSku: item.sku,
                    quantity: baseRestore,
                    reason: `Trả hàng - ${returnCode} (${existing.receiptNumber})`,
                    note: reason || `Trả hàng giao dịch ${existing.receiptNumber}`,
                    referenceId: returnCode,
                    referenceType: 'return',
                    unitPrice: item.unitPrice || 0,
                    costPriceAfter: updatedProduct.costPrice,
                    userId: req.user!.userId,
                    userName: user?.name || 'Admin',
                },
            })
        }

        // Revert customer stats + debt if applicable
        if (existing.customerId) {
            const updateData: any = {
                totalPurchases: { decrement: returnTotal },
            }
            // Chỉ trừ 1 đơn của khách khi trả TOÀN BỘ — trả một phần đơn vẫn tồn tại
            if (isFullReturn) updateData.totalOrders = { decrement: 1 }

            // If the sale still carried unpaid credit, reduce customer debt on
            // return. Use the live remaining debt (total - amountReceived) — the
            // original credit payment record never shrinks after repayments, so
            // relying on it would deduct the debt twice.
            const outstanding = existing.status === 'partial'
                ? Math.max(0, existing.total - (existing.amountReceived ?? 0))
                : 0
            let returnDebtReduction = 0
            let returnCustomer: any = null
            if (outstanding > 0) {
                returnCustomer = await prisma.customer.findUnique({
                    where: { id: existing.customerId },
                    select: { debt: true, name: true, phone: true },
                })
                returnDebtReduction = Math.min(outstanding, returnTotal, Math.max(0, returnCustomer?.debt ?? 0))
                if (returnDebtReduction > 0) updateData.debt = { decrement: returnDebtReduction }
            }

            await prisma.customer.update({
                where: { id: existing.customerId },
                data: updateData,
            })

            // Ghi sổ chi tiết phần giảm nợ do trả hàng (best-effort)
            if (returnDebtReduction > 0) {
                await prisma.debtEntry.create({
                    data: {
                        customerId: existing.customerId,
                        customerName: returnCustomer?.name || (existing as any).customerName || 'Khách hàng',
                        phone: returnCustomer?.phone || null,
                        type: 'return',
                        amount: returnDebtReduction,
                        description: `Trả hàng theo HĐ ${existing.receiptNumber} (${returnCode})`,
                        balance: Math.max(0, (returnCustomer?.debt ?? 0) - returnDebtReduction),
                    },
                }).catch((e: any) => console.error('DebtEntry create failed (non-fatal):', e.message))
            }
        }

        cacheDel(`${req.user?.storeSchema || 'default'}:*:transactions:*`).catch(() => { })
        console.log(`↩️ Transaction ${existing.receiptNumber} returned as ${returnCode} — ${itemsToReturn.length} items`)

        // Publish realtime event
        publishEvent(req.user?.storeSchema, 'transaction:returned', {
            id: existing.id,
            receiptNumber: existing.receiptNumber,
            returnCode,
            totalRefund: returnTotal,
        }, branchId).catch(() => { })

        // Webhook đầu ra: thay đổi hóa đơn (trả hàng)
        emitEntityEvent(prisma, 'invoice.updated', { ...invoicePayload(transaction), changeType: 'return', returnCode, totalRefund: returnTotal }, req.user?.storeSchema).catch(() => { })

        res.json({
            success: true,
            data: {
                ...transaction,
                createdAt: transaction.createdAt.toISOString(),
                returnedAt: transaction.returnedAt?.toISOString(),
                returnOrder: returnOrder ? {
                    code: returnOrder.code,
                    id: returnOrder.id,
                    totalRefund: returnOrder.totalRefund,
                    items: JSON.parse(returnOrder.items),
                } : { code: returnCode, totalRefund: returnTotal },
            },
        })
    } catch (err) {
        console.error('Return transaction error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// PUT /api/transactions/:id — Edit transaction notes/customer info
router.put('/:id', authMiddleware, requirePermission('pos.create_order'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const id = String(req.params.id)
        const { notes, customerName, customerPhone } = req.body

        const existing = await prisma.transaction.findUnique({ where: { id } })
        if (!existing) {
            res.status(404).json({ success: false, error: 'Transaction not found' })
            return
        }

        // Chặn thao tác chéo chi nhánh (mirror GET /:id)
        if (!canAccessBranch(req, existing.branchId)) {
            res.status(404).json({ success: false, error: 'Transaction not found' })
            return
        }

        const updateData: any = {}
        if (notes !== undefined) updateData.notes = notes
        if (customerName !== undefined) updateData.customerName = customerName
        if (customerPhone !== undefined) updateData.customerPhone = customerPhone

        const transaction = await prisma.transaction.update({
            where: { id },
            data: updateData,
            include: { 
                items: { include: { product: { select: { costPrice: true } } } }, 
                payments: true 
            },
        })

        cacheDel(`${req.user?.storeSchema || 'default'}:*:transactions:*`).catch(() => { })
        console.log(`✏️ Transaction ${existing.receiptNumber} updated — notes/customer`)

        res.json({
            success: true,
            data: {
                ...transaction,
                createdAt: transaction.createdAt.toISOString(),
                returnedAt: transaction.returnedAt?.toISOString(),
            },
        })
    } catch (err) {
        console.error('Update transaction error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// PUT /api/transactions/:id/vat — Issue or update VAT invoice info
/* Sửa thông tin hoá đơn VAT — PHẢI có quyền như mọi route ghi khác trong file.
 * Bản trước chỉ có authMiddleware: bất kỳ tài khoản đăng nhập nào (tài xế, nhân
 * viên bảo hành...) cũng sửa/xoá được số hoá đơn VAT của MỌI chi nhánh, vì hàm
 * tra phiếu ở dưới cũng không kiểm chi nhánh. */
router.put('/:id/vat', authMiddleware, requirePermission('pos.create_order'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const branchId = getBranchId(req)
        const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id
        const { vatInvoiceNumber, vatStatus } = req.body

        const existing = await prisma.transaction.findUnique({ where: { id } })
        if (!existing) {
            return res.status(404).json({ success: false, error: 'Transaction not found' })
        }
        // Chi nhánh khác thì coi như không tồn tại — cùng nếp với /void, /return
        if (!canAccessBranch(req, existing.branchId)) {
            return res.status(404).json({ success: false, error: 'Transaction not found' })
        }

        const updateData: any = {}
        if (vatStatus === 'issued') {
            // Auto-generate VAT invoice number if not provided
            updateData.vatInvoiceNumber = vatInvoiceNumber || await nextCode(prisma, 'vatInvoiceCodeSeq', 'VAT', 6, '-', 'Transaction', 'vatInvoiceNumber')
            updateData.vatIssuedAt = new Date()
            updateData.vatStatus = 'issued'
        } else if (vatStatus === 'cancelled') {
            updateData.vatStatus = 'cancelled'
        } else {
            updateData.vatStatus = 'none'
            updateData.vatInvoiceNumber = null
            updateData.vatIssuedAt = null
        }

        const transaction = await prisma.transaction.update({ where: { id }, data: updateData })
        cacheDel(`${req.user?.storeSchema || 'default'}:*:transactions:*`).catch(() => { })
        console.log(`🧾 Transaction ${existing.receiptNumber} VAT: ${updateData.vatStatus} (${updateData.vatInvoiceNumber || 'N/A'})`)

        res.json({ success: true, data: transaction })
    } catch (err) {
        console.error('PUT /transactions/:id/vat error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// POST /api/transactions/:id/revise — Void old transaction and link warranties to new one
router.post('/:id/revise', authMiddleware, requirePermission('pos.create_order'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const branchId = getBranchId(req)
        const sourceId = String(req.params.id)
        const { newTransactionId, newReceiptNumber } = req.body

        if (!newTransactionId || !newReceiptNumber) {
            res.status(400).json({ success: false, error: 'newTransactionId and newReceiptNumber are required' })
            return
        }

        // 1. Find the old transaction
        const existing = await prisma.transaction.findUnique({
            where: { id: sourceId },
            include: { 
                items: { include: { product: { select: { costPrice: true } } } }
            },
        })

        if (!existing) {
            res.status(404).json({ success: false, error: 'Source transaction not found' })
            return
        }

        // Chặn thao tác chéo chi nhánh (mirror GET /:id)
        if (!canAccessBranch(req, existing.branchId)) {
            res.status(404).json({ success: false, error: 'Source transaction not found' })
            return
        }

        if (existing.status === 'voided') {
            res.status(400).json({ success: false, error: 'Transaction already voided' })
            return
        }

        const user = await prisma.user.findUnique({ where: { id: req.user!.userId } })

        // 2. Void the old transaction
        await prisma.transaction.update({
            where: { id: sourceId },
            data: { status: 'voided', notes: (existing.notes ? existing.notes + '\n' : '') + `[Cập nhật] → ${newReceiptNumber}` },
        })

        // 3. Restore stock from old transaction.
        // Hoàn theo ĐƠN VỊ GỐC đã trừ lúc bán (baseQuantity; bản ghi cũ → quantity),
        // kèm hoàn kho mặc định của chi nhánh (nơi bị trừ lock-step lúc bán).
        const reviseWarehouse = await getOrCreateDefaultWarehouse(prisma as any, existing.branchId || null)
        for (const item of existing.items) {
            const restoreQty = (item as any).baseQuantity > 0 ? (item as any).baseQuantity : item.quantity
            const updatedProduct = await prisma.product.update({
                where: { id: item.productId },
                data: { stock: { increment: restoreQty } },
            })

            if (reviseWarehouse?.id) {
                await updateWarehouseStock(prisma as any, reviseWarehouse.id, item.productId, restoreQty)
                    .catch((err: any) => console.error(`[Revision] WarehouseStock restore failed for product ${item.productId}:`, err))
            }
            // Webhook đầu ra: stock.changed do hoàn kho khi sửa đơn (trước khi áp lại)
            emitStockChanged(prisma as any, { productId: item.productId, sku: (updatedProduct as any).sku, name: (updatedProduct as any).name, branchId: existing.branchId ?? null, delta: restoreQty, stock: (updatedProduct as any).stock, reason: 'revise' }, req.user?.storeSchema).catch(() => { })

            await prisma.inventoryTransaction.create({
                data: {
                    type: 'adjustment',
                    productId: item.productId,
                    productName: item.productName,
                    productSku: item.sku,
                    quantity: restoreQty,
                    reason: `Cập nhật phiếu - ${existing.receiptNumber} → ${newReceiptNumber}`,
                    note: `Hoàn kho do cập nhật giao dịch ${existing.receiptNumber}`,
                    referenceId: existing.receiptNumber,
                    referenceType: 'revision',
                    unitPrice: item.unitPrice || 0,
                    costPriceAfter: updatedProduct.costPrice,
                    userId: req.user!.userId,
                    userName: user?.name || 'Admin',
                },
            })
        }

        // 4. Revert customer stats from old transaction
        if (existing.customerId) {
            await prisma.customer.update({
                where: { id: existing.customerId },
                data: {
                    totalPurchases: { decrement: existing.total },
                    totalOrders: { decrement: 1 },
                },
            }).catch(() => {})
        }

        // 5. Link the new transaction as revision of the old one
        try {
            await prisma.transaction.update({
                where: { id: newTransactionId },
                data: { revisionOfId: sourceId },
            })
        } catch (revLinkErr) {
            console.warn('[Revision] Could not set revisionOfId (field may not exist yet):', revLinkErr)
        }

        // 6. Transfer warranties from old transaction to new one
        let warrantyCount = 0
        try {
            const result = await prisma.warranty.updateMany({
                where: { transactionId: sourceId },
                data: { transactionId: newTransactionId },
            })
            warrantyCount = result.count
        } catch (wErr) {
            console.warn('[Revision] Warranty transfer failed (field may not exist):', wErr)
        }

        // 6b. Transfer return orders from old transaction to new one
        let returnOrderCount = 0
        try {
            const result = await prisma.returnOrder.updateMany({
                where: { transactionId: sourceId },
                data: {
                    transactionId: newTransactionId,
                    originalInvoice: newReceiptNumber,
                },
            })
            returnOrderCount = result.count
            if (returnOrderCount > 0) {
                console.log(`[Revision] ${returnOrderCount} return order(s) re-linked: ${existing.receiptNumber} → ${newReceiptNumber}`)
            }
        } catch (roErr) {
            console.warn('[Revision] Return order transfer failed (non-critical):', roErr)
        }

        // 7. Audit log
        try {
            await prisma.auditLog.create({
                data: {
                    userId: req.user!.userId,
                    userName: user?.name || 'Admin',
                    action: 'revise',
                    entity: 'Transaction',
                    entityId: sourceId,
                    details: JSON.stringify({
                        oldReceipt: existing.receiptNumber,
                        newReceipt: newReceiptNumber,
                        newTransactionId,
                        warrantiesTransferred: warrantyCount,
                        returnOrdersTransferred: returnOrderCount,
                    }),
                },
            })
        } catch { }

        cacheDel(`${req.user?.storeSchema || 'default'}:*:transactions:*`).catch(() => { })
        console.log(`📝 Transaction ${existing.receiptNumber} revised → ${newReceiptNumber} (${warrantyCount} warranties transferred)`)

        // Đảo bút toán hóa đơn CŨ (#4): revise = hủy đơn cũ + tạo đơn mới. Đơn mới đã
        // post bút toán riêng; đơn cũ phải đảo để GL không cộng dồn 2 lần.
        await reverseJournalEntriesForTransaction(prisma, existing.receiptNumber, { branchId: existing.branchId ?? null, userId: req.user!.userId })
            /* Giữ nguyên thiết kế "post-commit, không chặn" (GL tách khỏi tồn/công nợ), nhưng KHÔNG
             * im lặng: hỏng ở đây nghĩa là sổ vẫn còn doanh thu của một phiếu ĐÃ HUỶ. Ghi ERROR để
             * lên Nhật ký lỗi của trang quản trị mà còn đi sửa (20/08/2026). */
            .catch((e: any) => console.error(`[huy-phieu] Đảo bút toán HỎNG cho ${existing.receiptNumber} — sổ còn doanh thu của phiếu đã huỷ:`, moTaLoi(e)))

        // Publish realtime event
        publishEvent(req.user?.storeSchema, 'transaction:revised', {
            oldId: sourceId,
            oldReceipt: existing.receiptNumber,
            newId: newTransactionId,
            newReceipt: newReceiptNumber,
        }, branchId).catch(() => { })

        // Webhook đầu ra: thay đổi hóa đơn (sửa → sinh phiếu mới)
        emitEntityEvent(prisma, 'invoice.updated', {
            id: newTransactionId, receiptNumber: newReceiptNumber,
            previousReceiptNumber: existing.receiptNumber, status: 'revised',
            changeType: 'revise', branchId: existing.branchId ?? null,
        }, req.user?.storeSchema).catch(() => { })

        res.json({
            success: true,
            data: {
                oldReceiptNumber: existing.receiptNumber,
                newReceiptNumber,
                newTransactionId,
                warrantiesTransferred: warrantyCount,
            },
        })
    } catch (err) {
        console.error('Revise transaction error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// Chuyến CHƯA ĐÓNG mới nhận thêm đơn. 'planned'/'loaded' là tên cũ, giao diện
// gộp cả hai vào "loading" — bỏ sót là chuyến cũ không chọn được.
const TRIP_NHAN_DON = ['loading', 'active', 'paused', 'planned', 'loaded']

// ─── GET /api/transactions/:id/van-trips ────────────────────────────────────
// Các chuyến đang mở để chọn khi chuyển đơn sang bán lưu động.
router.get('/:id/van-trips', authMiddleware, requirePermission('transactions.convert_van'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const trips = await (prisma as any).salesTrip.findMany({
            where: { status: { in: TRIP_NHAN_DON } },
            select: {
                id: true, code: true, status: true, warehouseId: true,
                salesUserName: true, driverName: true, plannedDate: true, startedAt: true,
                vehicle: { select: { code: true, licensePlate: true } },
            },
            orderBy: { createdAt: 'desc' },
            take: 50,
        })
        res.json({ success: true, data: trips })
    } catch (err) {
        console.error('List van trips error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

/**
 * CHUYỂN ĐƠN THƯỜNG → ĐƠN BÁN HÀNG LƯU ĐỘNG
 *
 * Vì sao cần: nhân viên bán trên xe nhưng quên bật chế độ lưu động ở POS, đơn
 * rơi vào channel 'direct'. Khi đó hàng bị trừ SAI CHỖ và chuyến đối soát thiếu.
 *
 * Hai đường đi kho khác hẳn nhau — đây là chỗ dễ làm sai nhất:
 *   Đơn thường : Product.stock -= n  VÀ  kho main -= n
 *   Chất lên xe: Product.stock -= n, kho main -= n, kho xe += n
 *   Đơn lưu động: CHỈ kho xe -= n   (Product.stock giữ nguyên vì đã trừ lúc chất)
 *
 * Nên hàng bán trên xe mà ghi thành đơn thường thì tồn bán được bị trừ HAI LẦN
 * (một lần lúc chất lên xe, một lần lúc bán) còn hàng trên xe thì vẫn nằm đó.
 * Chuyển đơn phải làm đúng ba việc:
 *   1. Trả n về tồn bán được (Product.stock + kho main) — gỡ lần trừ thừa
 *   2. Trừ n trên kho xe — nơi hàng thật sự đi ra
 *   3. Cộng vào SalesTripItem.soldQty + tổng chuyến để đối soát khớp
 *
 * Ghi một dòng thẻ kho 'adjustment' SỐ DƯƠNG cho khớp Product.stock vừa tăng.
 * KHÔNG đụng dòng 'sale' cũ: đơn vẫn là một lần bán, chỉ đổi nơi xuất hàng.
 *
 * Một chiều duy nhất (thường → lưu động). Chưa làm chiều ngược lại.
 */
router.post('/:id/convert-to-van', authMiddleware, requirePermission('transactions.convert_van'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const txId = String(req.params.id)
        const tripId = String(req.body?.tripId || '').trim()
        if (!tripId) {
            res.status(400).json({ success: false, error: 'Phải chọn chuyến bán hàng lưu động để gắn đơn vào' })
            return
        }

        const transaction = await prisma.transaction.findUnique({
            where: { id: txId },
            include: { items: true },
        })
        if (!transaction) { res.status(404).json({ success: false, error: 'Không tìm thấy đơn hàng' }); return }
        if (!canAccessBranch(req, transaction.branchId)) {
            res.status(403).json({ success: false, error: 'Đơn thuộc chi nhánh khác' }); return
        }
        if ((transaction as any).channel === 'van') {
            res.status(400).json({ success: false, error: 'Đơn này đã là đơn bán hàng lưu động' }); return
        }
        // Đơn đã huỷ/đã trả thì kho đã hoàn — chuyển nữa là cộng trừ lung tung
        if (['cancelled', 'voided', 'returned'].includes(String(transaction.status))) {
            res.status(400).json({ success: false, error: `Đơn đang ở trạng thái "${transaction.status}", không chuyển được` }); return
        }
        if (!transaction.items.length) {
            res.status(400).json({ success: false, error: 'Đơn không có dòng hàng nào' }); return
        }

        const trip = await (prisma as any).salesTrip.findUnique({ where: { id: tripId } })
        if (!trip) { res.status(404).json({ success: false, error: 'Không tìm thấy chuyến' }); return }
        if (!TRIP_NHAN_DON.includes(String(trip.status))) {
            res.status(400).json({
                success: false,
                error: `Chuyến ${trip.code} đang ở trạng thái "${trip.status}" — chỉ gắn đơn được vào chuyến chưa đóng`,
            })
            return
        }

        const user = await prisma.user.findUnique({ where: { id: req.user!.userId }, select: { name: true } })
        // Bản ghi cũ chưa có baseQuantity thì lùi về quantity (xem ghi chú ở model)
        const soLuong = (it: any) => Math.round(Number(it.baseQuantity) || Number(it.quantity) || 0)
        const tongSoLuong = transaction.items.reduce((s, it: any) => s + soLuong(it), 0)

        const ketQua = await prisma.$transaction(async (tx: any) => {
            for (const item of transaction.items as any[]) {
                const qty = soLuong(item)
                if (qty <= 0) continue

                // 2) Trừ kho xe TRƯỚC — thiếu hàng là hỏng cả lệnh, không đụng gì thêm
                const dec = await tx.warehouseStock.updateMany({
                    where: { warehouseId: trip.warehouseId, productId: item.productId, quantity: { gte: qty } },
                    data: { quantity: { decrement: qty } },
                })
                if (dec.count === 0) {
                    const row = await tx.warehouseStock.findUnique({
                        where: { warehouseId_productId: { warehouseId: trip.warehouseId, productId: item.productId } },
                        select: { quantity: true },
                    })
                    throw new Error(
                        `"${item.productName}" chỉ còn ${row?.quantity ?? 0} trên xe (cần ${qty}). ` +
                        `Chất thêm hàng lên chuyến ${trip.code} rồi chuyển lại.`,
                    )
                }

                // 1) Trả về tồn bán được — gỡ lần trừ thừa của đơn thường
                await adjustSellableStock(tx, item.productId, transaction.branchId, qty,
                    `Chuyển đơn ${transaction.receiptNumber} sang bán lưu động`)

                // Thẻ kho: SỐ CÓ DẤU + 'adjustment' theo đúng từ vựng của app
                await tx.inventoryTransaction.create({
                    data: {
                        type: 'adjustment',
                        productId: item.productId,
                        productName: item.productName,
                        productSku: item.sku || '',
                        quantity: qty,
                        reason: `Chuyển ${transaction.receiptNumber} sang bán lưu động (chuyến ${trip.code}) — hàng xuất từ kho xe`,
                        referenceId: transaction.receiptNumber,
                        referenceType: 'convert_van',
                        branchId: transaction.branchId,
                        userId: req.user!.userId,
                        userName: user?.name || 'Admin',
                    },
                })

                // 3) Đối soát chuyến
                await tx.salesTripItem.upsert({
                    where: { tripId_productId: { tripId, productId: item.productId } },
                    update: { soldQty: { increment: qty } },
                    create: {
                        tripId, productId: item.productId,
                        productName: item.productName,
                        productSku: item.sku || null,
                        loadedQty: 0, soldQty: qty,
                        unitPrice: item.unitPrice || 0,
                    },
                })
            }

            await tx.salesTrip.update({
                where: { id: tripId },
                data: {
                    totalSold: { increment: tongSoLuong },
                    totalRevenue: { increment: transaction.total || 0 },
                },
            })

            await tx.salesTripLog.create({
                data: {
                    tripId, action: 'sale',
                    notes: `Chuyển đơn ${transaction.receiptNumber} sang chuyến (${tongSoLuong} sp, ${Math.round(transaction.total || 0).toLocaleString('vi-VN')}đ)`,
                    userId: req.user!.userId,
                    userName: user?.name || 'Admin',
                    metadata: JSON.stringify({
                        transactionId: txId,
                        receiptNumber: transaction.receiptNumber,
                        total: transaction.total,
                        items: transaction.items.map((i: any) => ({ sku: i.sku, qty: soLuong(i) })),
                    }),
                },
            })

            return tx.transaction.update({
                where: { id: txId },
                data: { channel: 'van' },
                include: { items: true },
            })
        })

        await prisma.auditLog.create({
            data: {
                userId: req.user!.userId,
                userName: user?.name || 'Admin',
                action: 'convert_to_van',
                entity: 'transaction',
                entityId: txId,
                details: `Chuyển đơn ${transaction.receiptNumber} sang bán lưu động — chuyến ${trip.code}`,
            },
        }).catch(() => { /* nhật ký hỏng không được giết nghiệp vụ */ })

        cacheDel(`${req.user?.storeSchema || 'default'}:*:transactions:*`).catch(() => { })

        res.json({
            success: true,
            data: ketQua,
            message: `Đã chuyển ${transaction.receiptNumber} sang chuyến ${trip.code}`,
        })
    } catch (err: any) {
        console.error('Convert to van sale error:', err)
        // Lỗi nghiệp vụ (thiếu hàng trên xe) phải đọc được, không nuốt thành 500 câm
        const msg = String(err?.message || '')
        if (/trên xe|chuyến/i.test(msg)) {
            res.status(409).json({ success: false, error: msg.slice(0, 300) })
            return
        }
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

export default router
