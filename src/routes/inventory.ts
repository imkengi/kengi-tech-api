import { Router, Response } from 'express'
import { authMiddleware, AuthRequest, getBranchFilter } from '../middleware/auth'
import { requireRole } from '../middleware/roleMiddleware'
import { cacheGet, cacheSet, cacheDel } from '../lib/cache'
import { nextCode } from '../lib/codeGenerator'

const router = Router()

// POST /api/inventory/reindex — Recalculate stock from InventoryTransaction history
router.post('/reindex', authMiddleware, requireRole('admin'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!

        // 1. Get all products
        const allProducts = await prisma.product.findMany({ select: { id: true, sku: true, name: true, stock: true } })

        // 2. Sum quantity from InventoryTransaction grouped by productId
        const stockSums = await prisma.inventoryTransaction.groupBy({
            by: ['productId'],
            _sum: { quantity: true },
        })
        const stockMap = new Map<string, number>()
        for (const row of stockSums) {
            stockMap.set(row.productId, row._sum.quantity || 0)
        }

        // 3. Update each product's stock
        let updated = 0
        const changes: { id: string; sku: string; name: string; oldStock: number; newStock: number }[] = []

        for (const product of allProducts) {
            const computedStock = stockMap.get(product.id) ?? 0
            if (product.stock !== computedStock) {
                await prisma.product.update({
                    where: { id: product.id },
                    data: { stock: computedStock },
                })
                changes.push({
                    id: product.id,
                    sku: product.sku,
                    name: product.name,
                    oldStock: product.stock,
                    newStock: computedStock,
                })
                updated++
            }
        }

        // 4. Invalidate caches
        const schema = req.user?.storeSchema || 'default'
        cacheDel(`${schema}:inventory:*`).catch(() => { })
        cacheDel(`${schema}:products:*`).catch(() => { })
        cacheDel(`products:${schema}:*`).catch(() => { })

        res.json({
            success: true,
            data: {
                totalProducts: allProducts.length,
                updated,
                unchanged: allProducts.length - updated,
                changes: changes.slice(0, 50), // Return first 50 changes for review
            },
        })
    } catch (err) {
        console.error('Stock reindex error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// GET /api/inventory -- stock summary
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const schema = req.user?.storeSchema || 'default'
        const cacheKey = `${schema}:inventory:summary`
        const cached = await cacheGet(cacheKey)
        if (cached) return res.json(cached)

        const [totalProducts, lowStock, outOfStock, agg] = await Promise.all([
            prisma.product.count({ where: { productType: { not: 'service' } } }),
            prisma.product.count({ where: { productType: { not: 'service' }, stock: { gt: 0, lte: 10 } } }),
            prisma.product.count({ where: { productType: { not: 'service' }, stock: { lte: 0 } } }),
            prisma.product.aggregate({ where: { productType: { not: 'service' } }, _sum: { stock: true } }),
        ])
        const response = { success: true, data: { totalProducts, lowStock, outOfStock, totalStock: agg._sum.stock || 0 } }
        await cacheSet(cacheKey, response, 300)
        res.json(response)
    } catch (err) {
        console.error('Inventory summary error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// GET /api/inventory/transactions
router.get('/transactions', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { search, type, productId, startDate, endDate, page = '1', pageSize = '20' } = req.query

        const where: any = {}
        if (productId) where.productId = productId as string
        if (search) {
            where.OR = [
                { productName: { contains: search as string, mode: 'insensitive' } },
                { productSku: { contains: search as string, mode: 'insensitive' } },
            ]
        }
        if (type) where.type = type
        if (startDate || endDate) {
            where.createdAt = {}
            if (startDate) where.createdAt.gte = new Date(startDate as string)
            if (endDate) where.createdAt.lte = new Date(endDate as string)
        }

        const pageNum = Math.max(1, parseInt(page as string))
        const size = Math.max(1, Math.min(100, parseInt(pageSize as string)))
        const skip = (pageNum - 1) * size

        const [total, transactions] = await Promise.all([
            prisma.inventoryTransaction.count({ where }),
            prisma.inventoryTransaction.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: size }),
        ])

        res.json({
            data: transactions.map(t => ({ ...t, createdAt: t.createdAt.toISOString() })),
            total, page: pageNum, pageSize: size, totalPages: Math.ceil(total / size),
        })
    } catch (err) {
        console.error('Get inventory transactions error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// GET /api/inventory/io-report
router.get('/io-report', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { startDate, endDate } = req.query

        if (!startDate || !endDate) {
            return res.status(400).json({ success: false, error: 'Missing startDate or endDate' })
        }

        const start = new Date(startDate as string)
        const end = new Date(endDate as string)

        // Single SQL query: join product with inward/outward/later movement
        // aggregates, compute opening from current stock minus later movement,
        // and exclude products with zero activity AND zero opening/closing.
        // This pushes the entire roll-forward to Postgres so the API process
        // never materializes the full Product table.
        const rows = await prisma.$queryRawUnsafe<any[]>(
            `WITH later AS (
                SELECT "productId", COALESCE(SUM(quantity), 0) AS net_later
                FROM "InventoryTransaction"
                WHERE "createdAt" > $2
                GROUP BY "productId"
            ),
            inward AS (
                SELECT "productId", COALESCE(SUM(quantity), 0) AS qty_in
                FROM "InventoryTransaction"
                WHERE "createdAt" >= $1 AND "createdAt" <= $2 AND quantity > 0
                GROUP BY "productId"
            ),
            outward AS (
                SELECT "productId", COALESCE(SUM(quantity), 0) AS qty_out
                FROM "InventoryTransaction"
                WHERE "createdAt" >= $1 AND "createdAt" <= $2 AND quantity < 0
                GROUP BY "productId"
            )
            SELECT
                p.id, p.sku, p.name, COALESCE(p."costPrice", 0) AS cost_price,
                p.stock - COALESCE(later.net_later, 0) AS closing_qty,
                COALESCE(inward.qty_in, 0) AS qty_in,
                COALESCE(outward.qty_out, 0) AS qty_out
            FROM "Product" p
            LEFT JOIN later ON later."productId" = p.id
            LEFT JOIN inward ON inward."productId" = p.id
            LEFT JOIN outward ON outward."productId" = p.id
            WHERE (p."productType" <> 'service' OR p."productType" IS NULL)
              AND (
                  COALESCE(inward.qty_in, 0) <> 0
                  OR COALESCE(outward.qty_out, 0) <> 0
                  OR p.stock - COALESCE(later.net_later, 0) <> 0
                  OR p.stock - COALESCE(later.net_later, 0)
                     - COALESCE(inward.qty_in, 0)
                     - COALESCE(outward.qty_out, 0) <> 0
              )
            ORDER BY p.name ASC`,
            start, end,
        )

        const num = (v: unknown): number => Number(v ?? 0)
        const report = rows.map((r: any) => {
            const closingQty = num(r.closing_qty)
            const qtyIn = num(r.qty_in)
            const qtyOut = num(r.qty_out) // negative
            const openingQty = closingQty - qtyIn - qtyOut
            const cost = num(r.cost_price)
            return {
                productId: r.id,
                sku: r.sku,
                name: r.name,
                costPrice: cost,
                openingQty,
                openingValue: openingQty * cost,
                inQty: qtyIn,
                inValue: qtyIn * cost,
                outQty: Math.abs(qtyOut),
                outValue: Math.abs(qtyOut) * cost,
                closingQty,
                closingValue: closingQty * cost,
            }
        })

        res.json({ success: true, data: report })
    } catch (err) {
        console.error('Inventory IO report error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// GET /api/inventory/receipts
router.get('/receipts', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const receipts = await prisma.importReceipt.findMany({
            where: { ...getBranchFilter(req as any) },
            include: { items: true },
            orderBy: { createdAt: 'desc' },
        })
        res.json(receipts.map(r => ({
            ...r, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
        })))
    } catch (err) {
        console.error('Get import receipts error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// POST /api/inventory/receipts
router.post('/receipts', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { items, ...receiptData } = req.body

        const code = await nextCode(prisma, 'importReceiptCodeSeq', 'PN', 3, '', 'ImportReceipt', 'code')

        const receipt = await prisma.importReceipt.create({
            data: {
                ...receiptData, code,
                userId: req.user!.userId,
                userName: receiptData.userName || 'Admin',
                items: {
                    create: items.map((item: any) => ({
                        productId: item.productId, productName: item.productName,
                        productSku: item.productSku, quantity: item.quantity,
                        costPrice: item.costPrice, total: item.total || item.quantity * item.costPrice,
                    })),
                },
            },
            include: { items: true },
        })

        for (const item of items) {
            await prisma.product.update({
                where: { id: item.productId },
                data: { stock: { increment: item.quantity } },
            })
            await prisma.inventoryTransaction.create({
                data: {
                    type: 'import',
                    productId: item.productId, productName: item.productName,
                    productSku: item.productSku, quantity: item.quantity,
                    reason: `Nhập kho theo phiếu ${code}`, referenceId: code,
                    referenceType: 'import_receipt',
                    unitPrice: item.costPrice || 0, costPriceAfter: item.costPrice || 0,
                    supplierId: receiptData.supplierId, supplierName: receiptData.supplierName,
                    userId: req.user!.userId, userName: receiptData.userName || 'Admin',
                },
            })
        }

        res.status(201).json({
            success: true,
            data: { ...receipt, createdAt: receipt.createdAt.toISOString(), updatedAt: receipt.updatedAt.toISOString() },
        })
        cacheDel(`${req.user?.storeSchema || 'default'}:inventory:*`).catch(() => { })
        cacheDel(`${req.user?.storeSchema || 'default'}:products:*`).catch(() => { })
    } catch (err) {
        console.error('Create import receipt error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// POST /api/inventory/adjustments
router.post('/adjustments', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { productId, productName, productSku, quantity, reason, note, userId, userName } = req.body

        await prisma.product.update({
            where: { id: productId },
            data: { stock: { increment: quantity } },
        })

        const transaction = await prisma.inventoryTransaction.create({
            data: {
                type: 'adjustment',
                productId, productName, productSku, quantity, reason, note,
                userId: userId || req.user!.userId, userName: userName || 'Admin',
            },
        })

        res.status(201).json({
            success: true,
            data: { ...transaction, createdAt: transaction.createdAt.toISOString() },
        })
        cacheDel(`${req.user?.storeSchema || 'default'}:inventory:*`).catch(() => { })
        cacheDel(`${req.user?.storeSchema || 'default'}:products:*`).catch(() => { })
    } catch (err) {
        console.error('Stock adjustment error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// POST /api/inventory/migrate-references — Fix old CUID referenceIds from online_order sync
router.post('/migrate-references', authMiddleware, requireRole('admin'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!

        // Find all inventory transactions with referenceType = 'online_order' (old ones with CUIDs)
        const oldRecords = await prisma.inventoryTransaction.findMany({
            where: { referenceType: 'online_order' },
            select: { id: true, referenceId: true, note: true },
        })

        if (oldRecords.length === 0) {
            return res.json({ success: true, data: { fixed: 0, message: 'No old online_order records found' } })
        }

        let fixed = 0
        let notFound = 0

        for (const record of oldRecords) {
            let newRefId: string | null = null

            // Try to look up the OnlineOrder by CUID
            if (record.referenceId) {
                try {
                    const order = await prisma.onlineOrder.findUnique({
                        where: { id: record.referenceId },
                        select: { orderNumber: true },
                    })
                    if (order) {
                        newRefId = `ONLINE-${order.orderNumber}`
                    }
                } catch { }
            }

            // Fallback: extract order number from note field (e.g. "Đơn SPE-260305BW7C46FC (Shopee)")
            if (!newRefId && record.note) {
                const match = record.note.match(/Đơn\s+([\w-]+)\s/)
                if (match) {
                    newRefId = `ONLINE-${match[1]}`
                }
            }

            if (newRefId) {
                await prisma.inventoryTransaction.update({
                    where: { id: record.id },
                    data: { referenceId: newRefId, referenceType: 'sale' },
                })
                fixed++
            } else {
                notFound++
            }
        }

        // Invalidate caches
        const schema = req.user?.storeSchema || 'default'
        cacheDel(`${schema}:inventory:*`).catch(() => { })

        res.json({ success: true, data: { total: oldRecords.length, fixed, notFound } })
    } catch (err) {
        console.error('Migrate references error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ─── POST /api/inventory/free-return ─────────────────────────────────────────
// Trả hàng nhập tự do (không gắn với phiếu nhập cụ thể)
// Dùng cho: thanh lý, vét kho, trả hàng không rõ nguồn gốc phiếu
router.post('/free-return', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const user = req.user!
        const userName = (user as any).name || user.email || 'Hệ thống'

        const { items, reason, supplierId, supplierName, refundMethod } = req.body
        if (!items || !Array.isArray(items) || items.length === 0) {
            res.status(400).json({ success: false, error: 'Vui lòng chọn ít nhất 1 sản phẩm' }); return
        }
        
        const methodText = refundMethod === 'cash' ? 'Nhận tiền mặt' : refundMethod === 'offset' ? 'Cấn trừ công nợ' : ''
        const baseReason = reason || 'Trả hàng nhập tự do (thanh lý)'
        const defaultReason = methodText ? `${baseReason} - ${methodText}` : baseReason

        const batchId = `FRET-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Date.now().toString(36).toUpperCase()}`
        const results = []

        for (const item of items) {
            const { productId, quantity, unitPrice: providedPrice, reason: itemReason } = item
            if (!productId || !quantity || quantity <= 0) continue

            const product = await prisma.product.findUnique({ where: { id: String(productId) } })
            if (!product) continue

            // Tự động điền giá nhập gần nhất nếu không cung cấp
            let unitPrice = Number(providedPrice) || 0
            if (!unitPrice) {
                const lastImport = await (prisma as any).inventoryTransaction.findFirst({
                    where: { productId: String(productId), type: 'import', unitPrice: { gt: 0 } },
                    orderBy: { createdAt: 'desc' },
                })
                unitPrice = Number((lastImport as any)?.unitPrice) || Number(product.costPrice) || 0
            }

            const newStock = Math.max(0, product.stock - quantity)
            await prisma.product.update({ where: { id: String(productId) }, data: { stock: newStock } })

            await (prisma as any).inventoryTransaction.create({
                data: {
                    type: 'export',
                    productId: String(productId),
                    productName: product.name,
                    productSku: product.sku,
                    quantity: -quantity,
                    reason: itemReason ? (methodText ? `${itemReason} - ${methodText}` : itemReason) : defaultReason,
                    note: batchId,
                    referenceId: batchId,
                    referenceType: 'import_return',
                    unitPrice,
                    supplierId: supplierId || null,
                    supplierName: supplierName || null,
                    userId: user.userId || (user as any).id,
                    userName,
                },
            })

            results.push({ productId, productName: product.name, quantity, unitPrice, newStock })
        }

        res.json({ success: true, data: { batchId, items: results } })
    } catch (err: any) {
        console.error('Free return error:', err?.message || err)
        res.status(500).json({ success: false, error: 'Internal server error', detail: err?.message })
    }
})

// ─── Document type label map ─────────────────────────────────────────────────
// referenceType → loại chứng từ trong thẻ kho
function getDocumentType(referenceType: string | null, type: string, quantity: number): {
    label: string
    shortLabel: string
    direction: 'in' | 'out' | 'adjust'
} {
    if (referenceType === 'import_receipt' || (type === 'import' && !referenceType)) {
        return { label: 'Nhập hàng mua', shortLabel: 'NHM', direction: 'in' }
    }
    if (referenceType === 'import_return') {
        return { label: 'Trả hàng mua', shortLabel: 'THM', direction: 'out' }
    }
    if (referenceType === 'sale' || referenceType === 'online_order') {
        return { label: 'Xuất bán hàng', shortLabel: 'XBH', direction: 'out' }
    }
    if (referenceType === 'sale_return' || referenceType === 'customer_return') {
        return { label: 'Trả hàng bán', shortLabel: 'THB', direction: 'in' }
    }
    if (type === 'adjustment') {
        return quantity >= 0
            ? { label: 'Điều chỉnh tăng', shortLabel: 'DCT', direction: 'in' }
            : { label: 'Điều chỉnh giảm', shortLabel: 'DCG', direction: 'out' }
    }
    if (type === 'stocktaking') {
        return { label: 'Kiểm kho', shortLabel: 'KK', direction: 'adjust' }
    }
    return quantity >= 0
        ? { label: 'Nhập kho', shortLabel: 'NK', direction: 'in' }
        : { label: 'Xuất kho', shortLabel: 'XK', direction: 'out' }
}

// GET /api/inventory/stock-card/:productId — Thẻ kho sản phẩm (lịch sử chứng từ)
router.get('/stock-card/:productId', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { productId } = req.params
        const { startDate, endDate } = req.query

        const product = await prisma.product.findUnique({
            where: { id: String(productId) },
            select: { id: true, name: true, sku: true, stock: true, costPrice: true },
        })
        if (!product) { res.status(404).json({ success: false, error: 'Product not found' }); return }

        const where: any = { productId }
        if (startDate || endDate) {
            where.createdAt = {}
            if (startDate) where.createdAt.gte = new Date(startDate as string)
            if (endDate) where.createdAt.lte = new Date(endDate as string)
        }

        const transactions = await prisma.inventoryTransaction.findMany({
            where,
            orderBy: { createdAt: 'asc' }, // oldest first for running balance
        })

        let runningBalance = 0
        let totalIn = 0
        let totalOut = 0

        const entries = transactions.map(tx => {
            const qty = tx.quantity
            runningBalance += qty
            if (qty > 0) totalIn += qty
            else totalOut += Math.abs(qty)

            const doc = getDocumentType(tx.referenceType, tx.type, qty)

            // For import_return: "Số chứng từ" = batchId (unique per return session)
            // For others: use referenceId as-is
            const displayRefId = tx.referenceType === 'import_return' && tx.note
                ? tx.note              // e.g. "RETURN-20260405-MNLU9OZ5"
                : tx.referenceId       // e.g. "NH-20260405-001"

            return {
                id: tx.id,
                date: tx.createdAt.toISOString(),
                documentType: doc.label,          // e.g. "Trả hàng mua"
                documentShort: doc.shortLabel,     // e.g. "THM"
                direction: doc.direction,
                referenceId: displayRefId,         // Số chứng từ — unique per batch
                parentRef: tx.referenceType === 'import_return' ? tx.referenceId : null,  // mã phiếu gốc
                referenceType: tx.referenceType,
                batchId: tx.note,                 // raw batchId
                productId: tx.productId,
                productName: tx.productName,
                productSku: tx.productSku,
                quantityIn: qty > 0 ? qty : 0,
                quantityOut: qty < 0 ? Math.abs(qty) : 0,
                balanceAfter: runningBalance,
                unitPrice: tx.unitPrice || 0,
                reason: tx.reason,
                supplierName: tx.supplierName,
                customerName: (tx as any).customerName,
                userName: tx.userName,
            }
        })

        res.json({
            success: true,
            data: {
                product: {
                    id: product.id,
                    name: product.name,
                    sku: product.sku,
                    currentStock: product.stock,
                    costPrice: product.costPrice,
                },
                totalIn,
                totalOut,
                openingBalance: runningBalance - (transactions.reduce((s, t) => s + t.quantity, 0)),
                closingBalance: runningBalance,
                entries: entries.reverse(), // newest first for display
            },
        })
    } catch (err: any) {
        console.error('Stock card error:', err?.message || err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

export default router
