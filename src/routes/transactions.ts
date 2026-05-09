import { Router, Request, Response } from 'express'
import { authMiddleware, AuthRequest, getBranchFilter, getBranchId } from '../middleware/auth'
import { requirePermission } from '../middleware/permissionMiddleware'
import { validate } from '../middleware/validate'
import { CreateTransactionSchema } from '../schemas'
import { cacheGet, cacheSet, cacheDel } from '../lib/cache'
import { publishEvent } from '../lib/pubsub'

const router = Router()

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
            search, startDate, endDate, paymentMethod, status, cashier,
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

        if (startDate || endDate) {
            where.createdAt = {}
            if (startDate) where.createdAt.gte = new Date(startDate as string)
            if (endDate) where.createdAt.lte = new Date(endDate as string)
        }

        if (status && status !== 'all') where.status = status
        if (cashier) where.createdBy = cashier

        const pageNum = Math.max(1, parseInt(page as string))
        const size = Math.max(1, Math.min(200, parseInt(pageSize as string)))
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
            createdByName: t.createdByName,
            notes: t.notes,
            createdAt: t.createdAt.toISOString(),
            transactionDate: t.transactionDate?.toISOString() || t.createdAt.toISOString(),
            returnedAt: t.returnedAt?.toISOString(),
            returnReason: t.returnReason,
            branchId: t.branchId || null,
            branchName: t.branchId ? (branchMap[t.branchId] || null) : null,
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
        const statsCacheKey = `${schema}:transactions:stats:${startDate || ''}:${endDate || ''}`
        const cachedStats = await cacheGet(statsCacheKey)
        if (cachedStats) return res.json(cachedStats)

        const now = new Date()
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
        const yesterdayStart = new Date(todayStart.getTime() - 86400_000)

        // Use provided date range or default to 30 days
        const rangeStart = startDate ? new Date(startDate as string) : new Date(now.getTime() - 30 * 86400_000)
        const rangeEnd = endDate ? (() => { const d = new Date(endDate as string); d.setHours(23, 59, 59, 999); return d })() : now

        // Get all transactions in the specified range
        const recent = await prisma.transaction.findMany({
            where: { createdAt: { gte: rangeStart, lte: rangeEnd } },
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

        // KPI aggregations
        const totalOrders = recent.length
        const totalRevenue = completed.reduce((s, t) => s + t.total, 0)
        const completedCount = completed.length
        const voidedCount = voided.length
        const returnedCount = returned.length

        // Today vs yesterday
        const todayTx = completed.filter(t => t.createdAt >= todayStart)
        const yesterdayTx = completed.filter(t => t.createdAt >= yesterdayStart && t.createdAt < todayStart)
        const revenueToday = todayTx.reduce((s, t) => s + t.total, 0)
        const revenueYesterday = yesterdayTx.reduce((s, t) => s + t.total, 0)

        // Revenue by hour (today)
        const byHour: { hour: number; revenue: number; count: number }[] = []
        for (let h = 0; h <= now.getHours(); h++) {
            const hourTx = todayTx.filter(t => t.createdAt.getHours() === h)
            byHour.push({
                hour: h,
                revenue: hourTx.reduce((s, t) => s + t.total, 0),
                count: hourTx.length,
            })
        }

        // Revenue by day (last 30 days)
        const byDay: { date: string; revenue: number; count: number }[] = []
        for (let d = 29; d >= 0; d--) {
            const dayStart = new Date(now.getTime() - d * 86400_000)
            dayStart.setHours(0, 0, 0, 0)
            const dayEnd = new Date(dayStart.getTime() + 86400_000)
            const dayTx = completed.filter(t => t.createdAt >= dayStart && t.createdAt < dayEnd)
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

        // Unique cashiers
        const cashierSet = new Map<string, string>()
        for (const t of recent) {
            if (t.createdBy) cashierSet.set(t.createdBy, t.createdByName || t.createdBy)
        }
        const cashiers = Array.from(cashierSet.entries()).map(([id, name]) => ({ id, name }))

        // Total debt
        const totalDebt = partial.reduce((s, t) => {
            const creditPayment = t.payments.find(p => p.type === 'credit')
            return s + (creditPayment?.amount || 0)
        }, 0)

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

        // Generate receipt number
        const count = await prisma.transaction.count()
        let receiptNumber = txData.receiptNumber || `HD${Date.now()}${String(count + 1).padStart(4, '0')}`

        // If this is a revision of an existing transaction, generate .1/.2/.3 suffix
        if (txData.revisionOfId) {
            try {
                const sourceTransaction = await prisma.transaction.findUnique({
                    where: { id: txData.revisionOfId },
                    select: { receiptNumber: true },
                })
                if (sourceTransaction) {
                    // Get the base receipt number (strip any existing .N suffix)
                    const baseReceipt = sourceTransaction.receiptNumber.replace(/\.\d+$/, '')
                    // Count how many revisions already exist
                    const existingRevisions = await prisma.transaction.count({
                        where: { receiptNumber: { startsWith: baseReceipt + '.' } },
                    })
                    receiptNumber = `${baseReceipt}.${existingRevisions + 1}`
                }
            } catch (revErr) {
                console.warn('[Revision] Could not generate revision receipt number:', revErr)
            }
        }

        // Calculate debt amount from credit payments
        const debtAmount = txData.debtAmount || 0

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

        // Van-sales stock check: confirm the vehicle's mobile warehouse has enough of
        // each product (in base units) to cover this sale. Aggregates per-product so
        // duplicate line items can't individually pass the check then collectively
        // exceed available stock.
        if (isVanSale) {
            const stocks = await (prisma as any).warehouseStock.findMany({
                where: { warehouseId: String(vanWarehouseId), productId: { in: productIds } },
            })
            const stockMap = new Map<string, any>(stocks.map((s: any) => [s.productId, s]))

            const requiredByProduct = new Map<string, { qty: number; name: string }>()
            for (const item of itemsWithConversion) {
                const cur = requiredByProduct.get(item.productId) || { qty: 0, name: item.productName }
                cur.qty += item.baseQuantity
                requiredByProduct.set(item.productId, cur)
            }

            for (const [productId, { qty, name }] of requiredByProduct) {
                const stk = stockMap.get(productId)
                const available = stk?.quantity || 0
                if (available < qty) {
                    res.status(400).json({
                        success: false,
                        error: `Sản phẩm "${stk?.productName || name}" chỉ còn ${available} trên xe (cần ${qty})`,
                    })
                    return
                }
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
            tax: txData.tax || 0,
            total: txData.total || 0,
            amountReceived: txData.amountReceived || 0,
            change: txData.change || 0,
            status: txData.status || 'completed',
            createdBy: req.user!.userId,
            createdByName: user?.name || 'Admin',
            notes: txData.notes || null,
            transactionDate: txData.transactionDate ? new Date(txData.transactionDate) : null,
            branchId: branchId || null,
            appliedPromotionIds: promoIds.length > 0 ? JSON.stringify(promoIds) : null,
            items: {
                create: itemsWithConversion.map((item: any) => ({
                    productId: item.productId,
                    productName: item.productName,
                    sku: item.sku || item.productSku || '',
                    quantity: item.quantity,
                    unitPrice: item.unitPrice,
                    discount: item.discount || 0,
                    lineTotal: item.lineTotal,
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

        // Create the transaction and bump Promotion.usageCount in one atomic batch
        // so a partial failure can't leave the receipt persisted while the promo
        // counter stays at zero.
        const writes: any[] = [
            prisma.transaction.create({
                data: createData,
                include: {
                    items: {
                        include: { product: { select: { costPrice: true } } }
                    },
                    payments: true
                },
            }),
            ...promoIds.map(promoId => prisma.promotion.update({
                where: { id: promoId },
                data: { usageCount: { increment: 1 } },
            })),
        ]
        const results = await prisma.$transaction(writes)
        const transaction = results[0]

        // Increment bundle soldCount for any bundles included in the order
        const bundleIds = [...new Set(items.filter((i: any) => i.isBundle && i.bundleId).map((i: any) => i.bundleId))]
        for (const bundleId of bundleIds) {
            await prisma.bundle.update({
                where: { id: bundleId },
                data: { soldCount: { increment: 1 } }
            }).catch(err => {
                console.error(`Failed to increment soldCount for bundle ${bundleId}:`, err)
            })
        }

        // Decrease product stock + create inventory transaction records for each item.
        // Stock and InventoryTransaction.quantity are tracked in the product's BASE unit,
        // so we use baseQuantity (sale-unit qty × conversion rate) — not the raw line qty.
        // For van sales, Product.stock was already decremented when stock was loaded onto
        // the vehicle, so we only touch the vehicle's WarehouseStock here.
        for (const item of itemsWithConversion) {
            const productAfter = isVanSale
                ? await prisma.product.findUnique({ where: { id: item.productId }, select: { costPrice: true } })
                : await prisma.product.update({
                    where: { id: item.productId },
                    data: { stock: { decrement: item.baseQuantity } },
                })

            // Create inventory transaction record for stock tracking
            await prisma.inventoryTransaction.create({
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

        // Van-sales bookkeeping: decrement WarehouseStock on the vehicle, and roll the
        // sale into SalesTripItem.soldQty + SalesTrip totals when a trip is in scope.
        if (isVanSale) {
            for (const item of itemsWithConversion) {
                await (prisma as any).warehouseStock.update({
                    where: { warehouseId_productId: { warehouseId: String(vanWarehouseId), productId: item.productId } },
                    data: { quantity: { decrement: item.baseQuantity } },
                }).catch((err: any) => {
                    console.error(`[VanSale] WarehouseStock decrement failed for product ${item.productId}:`, err)
                })
            }

            if (salesTripId) {
                const totalBaseQty = itemsWithConversion.reduce((s: number, i: any) => s + i.baseQuantity, 0)

                for (const item of itemsWithConversion) {
                    await (prisma as any).salesTripItem.upsert({
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
                    }).catch((err: any) => {
                        console.error(`[VanSale] SalesTripItem upsert failed for product ${item.productId}:`, err)
                    })
                }

                await (prisma as any).salesTrip.update({
                    where: { id: String(salesTripId) },
                    data: {
                        totalSold: { increment: totalBaseQty },
                        totalRevenue: { increment: transaction.total },
                    },
                }).catch((err: any) => {
                    console.error(`[VanSale] SalesTrip totals update failed for ${salesTripId}:`, err)
                })
            }
        }

        // Update customer stats if customer exists
        if (txData.customerId) {
            const customerUpdate: any = {
                totalPurchases: { increment: transaction.total },
                totalOrders: { increment: 1 },
                lastPurchaseDate: new Date(),
            }

            // Add debt if credit payment
            if (debtAmount > 0) {
                customerUpdate.debt = { increment: debtAmount }
            }

            await prisma.customer.update({
                where: { id: txData.customerId },
                data: customerUpdate,
            })

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

                        await (prisma as any).customer.update({
                            where: { id: txData.customerId },
                            data: {
                                loyaltyPoints: newPoints,
                                loyaltyTier: newTier,
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

        res.status(201).json({
            success: true,
            data: {
                ...transaction,
                createdAt: transaction.createdAt.toISOString(),
                transactionDate: transaction.transactionDate?.toISOString() || transaction.createdAt.toISOString(),
            },
        })
    } catch (err) {
        console.error('Create transaction error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// PUT /api/transactions/:id/void
router.put('/:id/void', authMiddleware, async (req: AuthRequest, res: Response) => {
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

        if (existing.status === 'voided' || existing.status === 'returned') {
            res.status(400).json({ success: false, error: 'Transaction already voided/returned' })
            return
        }

        const user = await prisma.user.findUnique({ where: { id: req.user!.userId } })

        const transaction = await prisma.transaction.update({
            where: { id: String(req.params.id) },
            data: { status: 'voided' },
            include: { 
                items: {
                    include: { product: { select: { costPrice: true } } }
                }
            },
        })

        // Restore stock for each item + create inventory records
        for (const item of transaction.items) {
            const updatedProduct = await prisma.product.update({
                where: { id: item.productId },
                data: { stock: { increment: item.quantity } },
            })

            await prisma.inventoryTransaction.create({
                data: {
                    type: 'adjustment',
                    productId: item.productId,
                    productName: item.productName,
                    productSku: item.sku,
                    quantity: item.quantity,
                    reason: `Hủy đơn - ${existing.receiptNumber}`,
                    note: `Hoàn kho do hủy giao dịch ${existing.receiptNumber}`,
                    referenceId: existing.receiptNumber,
                    referenceType: 'void',
                    unitPrice: item.unitPrice || 0,
                    costPriceAfter: updatedProduct.costPrice,
                    userId: req.user!.userId,
                    userName: user?.name || 'Admin',
                },
            })
        }

        // Revert customer stats
        if (existing.customerId) {
            await prisma.customer.update({
                where: { id: existing.customerId },
                data: {
                    totalPurchases: { decrement: existing.total },
                    totalOrders: { decrement: 1 },
                },
            })
        }

        cacheDel(`${req.user?.storeSchema || 'default'}:*:transactions:*`).catch(() => { })
        console.log(`🚫 Transaction ${existing.receiptNumber} voided`)

        // Publish realtime event
        publishEvent(req.user?.storeSchema, 'transaction:voided', {
            id: existing.id,
            receiptNumber: existing.receiptNumber,
            total: existing.total,
        }, branchId).catch(() => { })

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
router.put('/:id/pay-debt', authMiddleware, async (req: AuthRequest, res: Response) => {
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

        if (existing.status !== 'partial') {
            res.status(400).json({ success: false, error: 'Giao dịch không ở trạng thái ghi nợ' })
            return
        }

        // Calculate debt: credit payment amount
        const creditPayment = existing.payments.find(p => p.type === 'credit')
        const debtAmount = creditPayment?.amount || 0
        const payAmount = amount || debtAmount

        // Add new payment record
        await prisma.payment.create({
            data: {
                transactionId: existing.id,
                type: paymentType || 'cash',
                amount: payAmount,
                reference: reference || `Thanh toán nợ ${existing.receiptNumber}`,
            },
        })

        // Update transaction status to completed
        const transaction = await prisma.transaction.update({
            where: { id: existing.id },
            data: {
                status: 'completed',
                amountReceived: existing.amountReceived + payAmount,
            },
            include: { 
                items: { include: { product: { select: { costPrice: true } } } }, 
                payments: true 
            },
        })

        // Reduce customer debt
        if (existing.customerId) {
            try {
                await prisma.customer.update({
                    where: { id: existing.customerId },
                    data: { debt: { decrement: payAmount } },
                })
            } catch { }
        }

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
router.put('/:id/return', authMiddleware, async (req: AuthRequest, res: Response) => {
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
            for (const ri of returnItems) {
                returnQtyMap.set(ri.productId, ri.quantity || existing.items.find(i => i.productId === ri.productId)?.quantity || 0)
            }
        } else {
            for (const item of itemsToReturn) {
                returnQtyMap.set(item.productId, item.quantity)
            }
        }

        // Calculate return total
        const returnTotal = itemsToReturn.reduce((sum, item) => {
            const qty = returnQtyMap.get(item.productId) || item.quantity
            return sum + (item.unitPrice * qty)
        }, 0)

        const transaction = await prisma.transaction.update({
            where: { id: String(req.params.id) },
            data: {
                status: 'returned',
                returnedAt: new Date(),
                returnReason: reason || 'Trả hàng',
            },
            include: { 
                items: { include: { product: { select: { costPrice: true } } } }, 
                payments: true 
            },
        })

        // Generate unique return document code (RT-001, RT-002, ...)
        const returnCount = await prisma.returnOrder.count()
        const returnCode = `RT-${String(returnCount + 1).padStart(3, '0')}`

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
            console.warn(`⚠️ ReturnOrder table not ready: ${roErr.message} — returning without ReturnOrder record`)
        }

        // Restore stock for returned items + create inventory records
        for (const item of itemsToReturn) {
            const qty = returnQtyMap.get(item.productId) || item.quantity
            const updatedProduct = await prisma.product.update({
                where: { id: item.productId },
                data: { stock: { increment: qty } },
            })

            await prisma.inventoryTransaction.create({
                data: {
                    type: 'return',
                    productId: item.productId,
                    productName: item.productName,
                    productSku: item.sku,
                    quantity: qty,
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
                totalOrders: { decrement: 1 },
            }

            // If original sale had credit (debt), reduce customer debt on return
            const existingWithPayments = await prisma.transaction.findUnique({
                where: { id: existing.id },
                include: { payments: true },
            })
            const creditPayment = existingWithPayments?.payments.find(p => p.type === 'credit')
            if (creditPayment && creditPayment.amount > 0) {
                updateData.debt = { decrement: Math.min(creditPayment.amount, returnTotal) }
            }

            await prisma.customer.update({
                where: { id: existing.customerId },
                data: updateData,
            })
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
router.put('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const id = String(req.params.id)
        const { notes, customerName, customerPhone } = req.body

        const existing = await prisma.transaction.findUnique({ where: { id } })
        if (!existing) {
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
router.put('/:id/vat', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const branchId = getBranchId(req)
        const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id
        const { vatInvoiceNumber, vatStatus } = req.body

        const existing = await prisma.transaction.findUnique({ where: { id } })
        if (!existing) {
            return res.status(404).json({ success: false, error: 'Transaction not found' })
        }

        const updateData: any = {}
        if (vatStatus === 'issued') {
            // Auto-generate VAT invoice number if not provided
            const vatCount = await prisma.transaction.count({ where: { ...getBranchFilter(req as any), vatStatus: 'issued' } })
            updateData.vatInvoiceNumber = vatInvoiceNumber || `VAT-${String(vatCount + 1).padStart(6, '0')}`
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
router.post('/:id/revise', authMiddleware, async (req: AuthRequest, res: Response) => {
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

        // 3. Restore stock from old transaction
        for (const item of existing.items) {
            const updatedProduct = await prisma.product.update({
                where: { id: item.productId },
                data: { stock: { increment: item.quantity } },
            })

            await prisma.inventoryTransaction.create({
                data: {
                    type: 'adjustment',
                    productId: item.productId,
                    productName: item.productName,
                    productSku: item.sku,
                    quantity: item.quantity,
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

        // Publish realtime event
        publishEvent(req.user?.storeSchema, 'transaction:revised', {
            oldId: sourceId,
            oldReceipt: existing.receiptNumber,
            newId: newTransactionId,
            newReceipt: newReceiptNumber,
        }, branchId).catch(() => { })

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

export default router
