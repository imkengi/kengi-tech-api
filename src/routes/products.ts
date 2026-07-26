import { Router, Request, Response } from 'express'
import { authMiddleware, AuthRequest, getBranchFilter, getBranchId } from '../middleware/auth'
import { requireRole } from '../middleware/roleMiddleware'
import { requirePermission } from '../middleware/permissionMiddleware'
import { cacheGet, cacheSet, cacheDel } from '../lib/cache'
import { validate } from '../middleware/validate'
import { CreateProductSchema, UpdateProductSchema } from '../schemas'
import { emitProductEvent } from '../lib/webhookDispatch'
import { adjustSellableStock } from '../lib/warehouseHelper'

const router = Router()

// ─── Products CRUD ──────────────────────────────────────────────────────────

// GET /api/products
router.get('/', authMiddleware, requirePermission('products.view'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        // Branch context: explicit ?branchId wins, then the X-Branch-Id header the
        // frontend sets when the user switches branches, else the caller's own JWT
        // branch. Used below to surface per-branch stock from the branch's default
        // warehouse — without the header check, branch switching had no effect and
        // every request showed main-branch stock.
        const branchContextId = (req.query.branchId as string) || (req.headers['x-branch-id'] as string) || getBranchId(req) || null

        // Cache check — keyed on the branch context so two branches don't share a page.
        const cacheKey = `products:${req.user?.storeSchema || 'default'}:${branchContextId || 'nobranch'}:${JSON.stringify(req.query)}`
        const cached = await cacheGet(cacheKey)
        if (cached) return res.json(cached)

        const {
            search, categoryId, brandId, stockStatus, productType, warehouseId,
            page = '1', pageSize = '20', sortBy = 'createdAt', sortOrder = 'desc' } = req.query

        // Note: Product table does not have branchId column, so no branch filtering
        const where: any = {}

        if (search) {
            where.OR = [
                { name: { contains: search as string, mode: 'insensitive' } },
                { sku: { contains: search as string, mode: 'insensitive' } },
                { barcode: { contains: search as string, mode: 'insensitive' } },
            ]
        }
        if (categoryId) where.categoryId = categoryId as string
        if (brandId) where.brandId = brandId as string
        if (productType) where.productType = productType as string
        if (stockStatus === 'in_stock') where.stock = { gt: 0 }
        if (stockStatus === 'out_of_stock') where.stock = 0

        const pageNum = Math.max(1, parseInt(page as string))
        const size = Math.max(1, Math.min(1000, parseInt(pageSize as string)))
        const skip = (pageNum - 1) * size

        const [total, products] = await Promise.all([
            prisma.product.count({ where }),
            prisma.product.findMany({
                where,
                include: {
                    category: true,
                    brand: true,
                    images: true,
                    unitConversions: true
                },
                orderBy: { [sortBy as string]: sortOrder as string },
                skip,
                take: size
            }),
        ])

        let filteredProducts = products
        let filteredTotal = total
        if (stockStatus === 'low_stock') {
            filteredProducts = products.filter((p: any) => p.stock > 0 && p.stock <= p.minStock)
            filteredTotal = filteredProducts.length
        }

        // When warehouseId is provided (e.g. van sales), replace stock with
        // warehouse-specific quantities and filter to only stocked products.
        let warehouseStockMap: Map<string, number> | null = null
        if (warehouseId) {
            const wStocks = await (prisma as any).warehouseStock.findMany({
                where: { warehouseId: warehouseId as string, quantity: { gt: 0 } },
                select: { productId: true, quantity: true },
            })
            warehouseStockMap = new Map(wStocks.map((ws: any) => [ws.productId, ws.quantity]))
            filteredProducts = filteredProducts.filter((p: any) => warehouseStockMap!.has(p.id))
            filteredTotal = filteredProducts.length
        }

        // Per-branch stock: when a branch context exists, surface the quantity held in
        // that branch's default "main" warehouse as `branchStock`. Product.stock is left
        // as the global cross-warehouse total for backward compatibility.
        let branchStockMap: Map<string, number> | null = null
        if (branchContextId) {
            const branchWarehouse = await (prisma as any).warehouse.findFirst({
                where: { type: 'main', isDefault: true, branchId: branchContextId },
                select: { id: true },
            })
            if (branchWarehouse) {
                const ids = filteredProducts.map((p: any) => p.id)
                const bStocks = ids.length > 0
                    ? await (prisma as any).warehouseStock.findMany({
                        where: { warehouseId: branchWarehouse.id, productId: { in: ids } },
                        select: { productId: true, quantity: true },
                    })
                    : []
                branchStockMap = new Map(bStocks.map((ws: any) => [ws.productId, ws.quantity]))

                // Self-heal: products with no WarehouseStock row for this branch warehouse
                // get one lazily created. For the MAIN branch, seed with Product.stock
                // (legacy global stock lives there). For other branches, start at 0 —
                // stock should arrive via imports or transfers, not be duplicated.
                const isMainBranch = !!(await (prisma as any).branch.findFirst({
                    where: { id: branchContextId, isMainBranch: true },
                    select: { id: true },
                }))
                const missing = filteredProducts.filter((p: any) => !branchStockMap!.has(p.id))
                for (const p of missing) {
                    try {
                        const seedQty = isMainBranch ? (p.stock ?? 0) : 0
                        await (prisma as any).warehouseStock.upsert({
                            where: { warehouseId_productId: { warehouseId: branchWarehouse.id, productId: p.id } },
                            update: {},
                            create: {
                                warehouseId: branchWarehouse.id,
                                productId: p.id,
                                productName: p.name,
                                productSku: p.sku ?? null,
                                quantity: seedQty,
                            },
                        })
                        branchStockMap!.set(p.id, p.stock ?? 0)
                    } catch (err) {
                        console.error('[products] WarehouseStock auto-heal failed for', p.id, err)
                    }
                }
            }
        }

        // MÃ ĐÃ GỘP: hàng nằm ở mã đích, nhưng mã này vẫn phải hiện TỒN QUY ĐỔI
        // (26 cái = 2,6 vỉ) chứ không phải 0 kèm nhãn "Hết" — nếu không người dùng
        // tưởng hết hàng và đi nhập thêm, hoặc sàn thấy 0 rồi tắt phân loại.
        const mergedIds = [...new Set(filteredProducts
            .map((p: any) => p.mergedIntoId).filter(Boolean))] as string[]
        const mergedTargets = mergedIds.length > 0
            ? await prisma.product.findMany({
                where: { id: { in: mergedIds } },
                select: { id: true, sku: true, name: true, stock: true, baseUnit: true },
            })
            : []
        const targetMap = new Map(mergedTargets.map((t: any) => [t.id, t]))

        const data = filteredProducts.map((p: any) => ({
            id: p.id,
            name: p.name,
            sku: p.sku,
            barcode: p.barcode,
            description: p.description,
            productType: p.productType || 'goods',
            categoryId: p.categoryId,
            categoryName: p.category?.name || '',
            brandId: p.brandId,
            brandName: p.brand?.name || '',
            costPrice: p.costPrice,
            sellingPrice: p.sellingPrice,
            taxInclusive: p.taxInclusive,
            stock: p.mergedIntoId && targetMap.has(p.mergedIntoId)
                // Tồn theo ĐƠN VỊ CỦA MÃ NÀY = tồn mã đích ÷ hệ số, giữ số lẻ
                ? Math.round(((targetMap.get(p.mergedIntoId) as any).stock || 0) / (Number(p.mergedRate) || 1) * 100) / 100
                : (warehouseStockMap ? (warehouseStockMap.get(p.id) ?? 0) : p.stock),
            // Thông tin gộp để giao diện hiện nhãn + nhảy sang mã đích
            mergedInto: p.mergedIntoId && targetMap.has(p.mergedIntoId)
                ? {
                    id: p.mergedIntoId,
                    sku: (targetMap.get(p.mergedIntoId) as any).sku,
                    name: (targetMap.get(p.mergedIntoId) as any).name,
                    rate: Number(p.mergedRate) || 1,
                    stockGoc: (targetMap.get(p.mergedIntoId) as any).stock || 0,
                    donViGoc: (targetMap.get(p.mergedIntoId) as any).baseUnit || '',
                }
                : null,
            branchStock: branchStockMap ? (branchStockMap.get(p.id) ?? 0) : null,
            minStock: p.minStock,
            maxStock: p.maxStock,
            baseUnit: p.baseUnit,
            invoiceUnit: (p as any).invoiceUnit ?? null,
            trackSerial: p.trackSerial,
            images: (p.images || []).map((img: any) => ({ id: img.id, url: img.url, isPrimary: img.isPrimary })),
            unitConversions: p.unitConversions || [],
            createdAt: p.createdAt?.toISOString?.() || p.createdAt,
            updatedAt: p.updatedAt?.toISOString?.() || p.updatedAt
        }))

        const response = {
            success: true,
            data: {
                items: data,
                total: filteredTotal,
                page: pageNum,
                pageSize: size,
                totalPages: Math.ceil(filteredTotal / size)
            }
        }
        await cacheSet(cacheKey, response, 300) // Cache 60s
        res.json(response)
    } catch (err) {
        console.error('Get products error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// GET /api/products/stats — aggregate inventory stats across ALL products
router.get('/stats', authMiddleware, requirePermission('products.view'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!

        const cacheKey = `product-stats:${req.user?.storeSchema || 'default'}`
        const cached = await cacheGet(cacheKey)
        if (cached) return res.json(cached)

        // Note: Product table does not have branchId column
        const [total, outOfStock, allProducts] = await Promise.all([
            prisma.product.count(),
            prisma.product.count({ where: { stock: { lte: 0 } } }),
            prisma.product.findMany({
                select: { stock: true, minStock: true, sellingPrice: true, costPrice: true, categoryId: true }
            })
        ])

        // Compute lowStock (0 < stock <= minStock) and inStock (stock > minStock)
        let lowStock = 0
        let totalStockValue = 0
        let totalPrice = 0
        const categoryCounts = new Map<string, number>()

        for (const p of allProducts) {
            const min = p.minStock ?? 5
            if (p.stock > 0 && p.stock <= min) lowStock++
            totalStockValue += p.stock * p.sellingPrice
            totalPrice += p.sellingPrice
            const catId = p.categoryId || '__none__'
            categoryCounts.set(catId, (categoryCounts.get(catId) || 0) + 1)
        }

        const inStock = total - outOfStock - lowStock
        const avgPrice = total > 0 ? Math.round(totalPrice / total) : 0

        // Get category names for top categories
        const topCats = Array.from(categoryCounts.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 6)

        const categoryIds = topCats.map(([id]) => id).filter(id => id !== '__none__')
        const categories = categoryIds.length > 0
            ? await prisma.category.findMany({ where: { id: { in: categoryIds } }, select: { id: true, name: true } })
            : []
        const catNameMap = new Map(categories.map(c => [c.id, c.name]))

        const topCategories = topCats.map(([id, count]) => ({
            id,
            name: id === '__none__' ? 'Không phân loại' : (catNameMap.get(id) || 'Không phân loại'),
            count
        }))

        const response = {
            success: true,
            data: { total, inStock, lowStock, outOfStock, totalStockValue, avgPrice, topCategories }
        }
        await cacheSet(cacheKey, response, 120)
        res.json(response)
    } catch (err) {
        console.error('Get product stats error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// GET /api/products/:id
router.get('/:id', authMiddleware, requirePermission('products.view'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const product = await prisma.product.findFirst({
            where: { id: String(req.params.id) },
            include: {
                category: true,
                brand: true,
                images: true,
                unitConversions: true,
                serials: true
            }
        })
        if (!product) return res.status(404).json({ success: false, error: 'Product not found' })

        // Per-branch stock from the branch's default "main" warehouse (see list route).
        const branchContextId = (req.query.branchId as string) || (req.headers['x-branch-id'] as string) || getBranchId(req) || null
        let branchStock: number | null = null
        if (branchContextId) {
            const branchWarehouse = await (prisma as any).warehouse.findFirst({
                where: { type: 'main', isDefault: true, branchId: branchContextId },
                select: { id: true },
            })
            if (branchWarehouse) {
                const ws = await (prisma as any).warehouseStock.findUnique({
                    where: { warehouseId_productId: { warehouseId: branchWarehouse.id, productId: product.id } },
                    select: { quantity: true },
                })
                if (ws) {
                    branchStock = ws.quantity
                } else {
                    // Self-heal: main branch gets Product.stock, others start at 0
                    const isMain = !!(await (prisma as any).branch.findFirst({
                        where: { id: branchContextId, isMainBranch: true },
                        select: { id: true },
                    }))
                    const seedQty = isMain ? (product.stock ?? 0) : 0
                    branchStock = seedQty
                    try {
                        await (prisma as any).warehouseStock.upsert({
                            where: { warehouseId_productId: { warehouseId: branchWarehouse.id, productId: product.id } },
                            update: {},
                            create: {
                                warehouseId: branchWarehouse.id,
                                productId: product.id,
                                productName: product.name,
                                productSku: product.sku ?? null,
                                quantity: seedQty,
                            },
                        })
                    } catch (err) {
                        console.error('[products] WarehouseStock auto-heal failed for', product.id, err)
                    }
                }
            }
        }

        // Per-branch stock breakdown across every branch's default "main" warehouse.
        // Restricted to admin/manager/superadmin so regular staff can't see other
        // branches' stock; regular staff only get their own `branchStock` above.
        let allBranchStock: Array<{ branchId: string | null; branchName: string | null; warehouseId: string; quantity: number }> | undefined
        const role = req.user?.role
        if (role === 'admin' || role === 'manager' || role === 'superadmin') {
            const mainWarehouses = await (prisma as any).warehouse.findMany({
                where: { type: 'main', isDefault: true },
                select: { id: true, branchId: true },
            })
            const warehouseIds = mainWarehouses.map((w: any) => w.id)
            const stocks = warehouseIds.length > 0
                ? await (prisma as any).warehouseStock.findMany({
                    where: { productId: product.id, warehouseId: { in: warehouseIds } },
                    select: { warehouseId: true, quantity: true },
                })
                : []
            const stockMap = new Map<string, number>(stocks.map((s: any) => [s.warehouseId, s.quantity]))

            const branchIds = [...new Set(mainWarehouses.map((w: any) => w.branchId).filter(Boolean))] as string[]
            const branchMap = new Map<string, string>()
            if (branchIds.length > 0) {
                const branches = await (prisma as any).branch.findMany({
                    where: { id: { in: branchIds } },
                    select: { id: true, name: true },
                })
                branches.forEach((b: any) => branchMap.set(b.id, b.name))
            }

            allBranchStock = mainWarehouses.map((w: any) => ({
                branchId: w.branchId ?? null,
                branchName: w.branchId ? (branchMap.get(w.branchId) ?? null) : null,
                warehouseId: w.id,
                quantity: stockMap.get(w.id) ?? 0,
            }))
        }

        // Mã ĐÃ GỘP: tồn thật nằm ở mã đích → trả TỒN QUY ĐỔI (26 cái = 2,6 vỉ)
        // để màn chi tiết/thẻ kho không hiện 0 như thể mất sạch dữ liệu.
        let mergedInfo: any = null
        let stockOut = product.stock
        if ((product as any).mergedIntoId) {
            const tgt = await prisma.product.findUnique({
                where: { id: (product as any).mergedIntoId },
                select: { id: true, sku: true, name: true, stock: true, baseUnit: true },
            }).catch(() => null)
            if (tgt) {
                const rate = Number((product as any).mergedRate) || 1
                stockOut = Math.round(((tgt.stock || 0) / rate) * 100) / 100
                mergedInfo = { id: tgt.id, sku: tgt.sku, name: tgt.name, rate, stockGoc: tgt.stock || 0, donViGoc: tgt.baseUnit || '' }
            }
        }
        res.json({
            success: true,
            data: {
                ...product,
                stock: stockOut,
                mergedInto: mergedInfo,
                branchStock,
                ...(allBranchStock ? { allBranchStock } : {}),
                createdAt: product.createdAt.toISOString(),
                updatedAt: product.updatedAt.toISOString()
            }
        })
    } catch (err) {
        console.error('Get product error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// GET /api/products/:productId/price-history?customerId=...
// Returns every past sale line of this product (optionally filtered by customer),
// one row per transaction-line, newest first. `price` is the effective per-unit
// amount actually paid (lineTotal / quantity, post-discount), not the list price.
router.get('/:productId/price-history', authMiddleware, requirePermission('products.view'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const productId = String(req.params.productId)
        const customerId = req.query.customerId ? String(req.query.customerId) : undefined
        const limit = Math.max(1, Math.min(500, parseInt(String(req.query.limit ?? '200'))))

        // When a customer is specified, match transactions by id OR by stored
        // name/phone — older transactions may have been keyed to the customer
        // by name/phone before a customer record was attached, so customerId
        // alone can miss legitimate prior purchases.
        let transactionFilter: any = { status: { not: 'voided' } }
        if (customerId) {
            const customer = await prisma.customer.findFirst({
                where: { id: customerId },
                select: { name: true, phone: true },
            })
            const orClauses: any[] = [{ customerId }]
            if (customer?.name) orClauses.push({ customerName: customer.name })
            if (customer?.phone) orClauses.push({ customerPhone: customer.phone })
            transactionFilter = { AND: [{ status: { not: 'voided' } }, { OR: orClauses }] }
        }

        const items = await prisma.transactionItem.findMany({
            where: {
                productId,
                transaction: transactionFilter,
            },
            orderBy: { transaction: { createdAt: 'desc' } },
            take: limit,
            select: {
                unitPrice: true,
                quantity: true,
                discount: true,
                lineTotal: true,
                transaction: {
                    select: {
                        id: true,
                        receiptNumber: true,
                        createdAt: true,
                        customerId: true,
                        customerName: true,
                    },
                },
            },
        })

        const data = items.map(it => {
            const qty = it.quantity || 1
            // Effective per-unit price actually paid (post-discount).
            const effective = qty > 0 ? it.lineTotal / qty : it.unitPrice
            return {
                price: effective,
                unitPrice: it.unitPrice,
                discount: it.discount,
                lineTotal: it.lineTotal,
                quantity: it.quantity,
                date: it.transaction.createdAt.toISOString(),
                receiptNumber: it.transaction.receiptNumber,
                transactionId: it.transaction.id,
                customerId: it.transaction.customerId,
                customerName: it.transaction.customerName,
            }
        })

        res.json({ success: true, data })
    } catch (err) {
        console.error('Product price-history error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

const PRODUCT_ALLOWED_FIELDS = [
    'name', 'sku', 'barcode', 'description', 'categoryId', 'brandId',
    'costPrice', 'sellingPrice', 'taxInclusive', 'stock', 'minStock', 'maxStock',
    'baseUnit', 'invoiceUnit', 'trackSerial', 'productType',
] as const

function sanitizeUnitConversions(arr: any[]): { fromUnit: string; toUnit: string; conversionRate: number }[] {
    return arr
        .filter((uc) => uc && uc.toUnit && String(uc.toUnit).trim())
        .map((uc) => ({
            fromUnit: String(uc.fromUnit ?? ''),
            toUnit: String(uc.toUnit),
            conversionRate: Number(uc.conversionRate) || 1,
        }))
}

function sanitizeImages(arr: any[]): { url: string; isPrimary: boolean }[] {
    return arr
        .filter((img) => img && img.url)
        .map((img) => ({
            url: String(img.url),
            isPrimary: Boolean(img.isPrimary),
        }))
}

function pickProductFields(raw: Record<string, any>): any {
    const out: any = {}
    for (const key of PRODUCT_ALLOWED_FIELDS) {
        if (raw[key] !== undefined) out[key] = raw[key]
    }
    // Empty string FK fields would violate FK constraint — coerce to null
    if (out.categoryId === '') out.categoryId = null
    if (out.brandId === '') out.brandId = null
    return out
}

// POST /api/products
router.post('/', authMiddleware, requirePermission('products.create'), validate(CreateProductSchema), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { unitConversions, images, ...rawData } = req.body
        const productData = pickProductFields(rawData)

        const cleanConversions = Array.isArray(unitConversions) ? sanitizeUnitConversions(unitConversions) : []
        const cleanImages = Array.isArray(images) ? sanitizeImages(images) : []

        const product = await prisma.product.create({
            data: {
                ...productData,
                unitConversions: cleanConversions.length ? {
                    createMany: { data: cleanConversions }
                } : undefined,
                images: cleanImages.length ? {
                    createMany: { data: cleanImages }
                } : undefined
            },
            include: { category: true, brand: true, images: true, unitConversions: true }
        })

        res.status(201).json({
            success: true,
            data: {
                ...product,
                createdAt: product.createdAt.toISOString(),
                updatedAt: product.updatedAt.toISOString()
            }
        })
        // Invalidate products cache
        cacheDel(`products:${req.user?.storeSchema || 'default'}:*`).catch(() => { })
        cacheDel(`product-stats:${req.user?.storeSchema || 'default'}`).catch(() => { })
        emitProductEvent(prisma, 'product.created', product, req.user?.storeSchema).catch(() => { })
    } catch (err) {
        console.error('Create product error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// PUT /api/products/:id
router.put('/:id', authMiddleware, requirePermission('products.edit'), validate(UpdateProductSchema), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        // Verify product belongs to store
        const existing = await prisma.product.findFirst({ where: { id: String(req.params.id) } })
        if (!existing) return res.status(404).json({ success: false, error: 'Product not found' })

        const { unitConversions, images, ...rawUpdates } = req.body
        const updates = pickProductFields(rawUpdates)

        // BẤT BIẾN KHO: Product.stock phải đi qua adjustSellableStock để mirror
        // WarehouseStock (POS check tồn theo kho). KHÔNG cho product.update ghi thẳng
        // stock — nếu không kho lệch → POS 409 không bán được. Sửa tồn ở form SP giờ
        // tính delta rồi áp qua helper (đồng thời phát webhook stock.changed).
        const stockDelta = (updates.stock !== undefined && Number(updates.stock) !== existing.stock)
            ? Number(updates.stock) - existing.stock : 0
        delete updates.stock

        const cleanConversions = Array.isArray(unitConversions) ? sanitizeUnitConversions(unitConversions) : null
        const cleanImages = Array.isArray(images) ? sanitizeImages(images) : null

        if (cleanConversions !== null) {
            await prisma.unitConversion.deleteMany({ where: { productId: String(req.params.id) } })
        }
        if (cleanImages !== null) {
            await prisma.productImage.deleteMany({ where: { productId: String(req.params.id) } })
        }

        if (stockDelta !== 0) {
            await adjustSellableStock(prisma, existing.id, getBranchId(req) ?? null, stockDelta, 'manual-edit')
        }

        const imagesToCreate = (images || []).filter((img: any) => img.url).map(({ id, ...rest }: any) => rest)

        const product = await prisma.product.update({
            where: { id: String(req.params.id) },
            data: {
                ...updates,
                unitConversions: cleanConversions?.length ? {
                    createMany: { data: cleanConversions }
                } : undefined,
                images: imagesToCreate?.length ? {
                    createMany: { data: imagesToCreate }
                } : undefined
            },
            include: { category: true, brand: true, images: true, unitConversions: true }
        })

        res.json({
            success: true,
            data: {
                ...product,
                createdAt: product.createdAt.toISOString(),
                updatedAt: product.updatedAt.toISOString()
            }
        })
        cacheDel(`products:${req.user?.storeSchema || 'default'}:*`).catch(() => { })
        cacheDel(`product-stats:${req.user?.storeSchema || 'default'}`).catch(() => { })
        emitProductEvent(prisma, 'product.updated', product, req.user?.storeSchema).catch(() => { })
    } catch (err) {
        console.error('Update product error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// DELETE /api/products/:id
router.delete('/:id', authMiddleware, requirePermission('products.delete'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const existing = await prisma.product.findFirst({ where: { id: String(req.params.id) } })
        if (!existing) return res.status(404).json({ success: false, error: 'Product not found' })

        await prisma.product.delete({ where: { id: String(req.params.id) } })
        res.json({ success: true })
        cacheDel(`products:${req.user?.storeSchema || 'default'}:*`).catch(() => { })
        cacheDel(`product-stats:${req.user?.storeSchema || 'default'}`).catch(() => { })
        emitProductEvent(prisma, 'product.deleted', existing, req.user?.storeSchema).catch(() => { })
    } catch (err) {
        console.error('Delete product error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// POST /api/products/bulk-import
// POST /api/products/:id/define-combo — ĐỊNH NGHĨA COMBO cho sản phẩm ĐÃ NHẬP.
// Nhiều combo đã được nhập vào kho như một mã hàng bình thường; khai thành phần
// ở đây thì từ đó mọi đơn bán mã này sẽ TỰ BUNG thành từng mặt hàng: kho trừ
// đúng từng mã, tồn kho thuế đúng từng mã, HOÁ ĐƠN XUẤT TỪNG SẢN PHẨM.
// Body: { items: [{ productId, quantity }], name? }. items rỗng = huỷ định nghĩa.
router.post('/:id/define-combo', authMiddleware, requireRole('admin', 'manager'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma! as any
        const id = String(req.params.id)
        const product = await prisma.product.findUnique({ where: { id } })
        if (!product) { res.status(404).json({ success: false, error: 'Không tìm thấy sản phẩm' }); return }

        const raw = Array.isArray(req.body?.items) ? req.body.items : []
        // Huỷ định nghĩa combo
        if (raw.length === 0) {
            await prisma.product.update({ where: { id }, data: { bundleId: null } })
            res.json({ success: true, data: { bundleId: null } })
            return
        }

        const comps: any[] = []
        for (const it of raw) {
            const cp = await prisma.product.findUnique({ where: { id: String(it.productId || '') } }).catch(() => null)
            if (!cp) continue
            if (cp.id === id) { res.status(400).json({ success: false, error: 'Combo không thể chứa chính nó' }); return }
            comps.push({
                productId: cp.id, sku: cp.sku, name: cp.name,
                quantity: Math.max(1, Number(it.quantity) || 1),
                originalPrice: cp.sellingPrice || 0,
            })
        }
        if (comps.length === 0) { res.status(400).json({ success: false, error: 'Không có thành phần hợp lệ' }); return }

        const originalTotal = comps.reduce((s: number, c: any) => s + c.originalPrice * c.quantity, 0)
        const payload = {
            name: String(req.body?.name || `Combo ${product.sku}`),
            items: JSON.stringify(comps),
            originalTotal,
            bundlePrice: product.sellingPrice || 0,
            discount: Math.max(0, originalTotal - (product.sellingPrice || 0)),
            active: true,
        }
        // Sửa lại định nghĩa cũ nếu đã có, tránh đẻ combo rác mỗi lần lưu
        const bundle = product.bundleId
            ? await prisma.bundle.update({ where: { id: product.bundleId }, data: payload }).catch(() => null)
            : null
        const saved = bundle || await prisma.bundle.create({ data: payload })
        await prisma.product.update({ where: { id }, data: { bundleId: saved.id } })
        res.json({ success: true, data: { bundleId: saved.id, items: comps, originalTotal } })
    } catch (err: any) {
        console.error('Define combo error:', err)
        res.status(400).json({ success: false, error: err?.message || 'Lỗi định nghĩa combo' })
    }
})

// GET /api/products/:id/combo — đọc định nghĩa combo hiện tại (nếu có)
router.get('/:id/combo', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma! as any
        const product = await prisma.product.findUnique({ where: { id: String(req.params.id) } })
        if (!product?.bundleId) { res.json({ success: true, data: null }); return }
        const bundle = await prisma.bundle.findUnique({ where: { id: product.bundleId } }).catch(() => null)
        let items: any[] = []
        try { items = JSON.parse(bundle?.items || '[]') } catch { items = [] }
        res.json({ success: true, data: bundle ? { bundleId: bundle.id, name: bundle.name, items } : null })
    } catch (err: any) {
        res.status(500).json({ success: false, error: err?.message || 'Lỗi đọc combo' })
    }
})

// POST /api/products/merge — GỘP 2 mã hàng + đồng hoá số lượng theo hệ số.
// Dùng cho hàng nhập theo vỉ/thùng nhưng bán theo cái (2 mã tách rời làm tồn kho
// thuế không bao giờ khớp). dryRun=true chỉ xem trước, không ghi gì.
router.post('/merge', authMiddleware, requireRole('admin', 'manager'), async (req: AuthRequest, res: Response) => {
    try {
        const { mergeProduct } = await import('../lib/mergeProduct')
        const b = req.body || {}
        const fromSku = String(b.fromSku || '').trim()
        const toSku = String(b.toSku || '').trim()
        const rate = Number(b.rate) || 1
        const dryRun = b.dryRun !== false && b.dryRun !== 'false'
        if (!fromSku || !toSku) { res.status(400).json({ success: false, error: 'Thiếu mã nguồn / mã đích' }); return }
        if (!(rate > 0)) { res.status(400).json({ success: false, error: 'Hệ số quy đổi phải lớn hơn 0' }); return }
        const force = b.force === true || b.force === 'true'
        const data = await mergeProduct(req.storePrisma as any, {
            fromSku, toSku, rate, dryRun, force,
            mainUnit: b.mainUnit === 'source' ? 'source' : 'target',
            unitName: b.unitName ? String(b.unitName) : undefined,
        })
        res.json({ success: true, dryRun, data })
    } catch (err: any) {
        console.error('Merge product error:', err)
        res.status(400).json({ success: false, error: err?.message || 'Lỗi gộp mã hàng' })
    }
})

router.post('/bulk-import', authMiddleware, requireRole('admin', 'manager'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { rows } = req.body
        if (!Array.isArray(rows) || rows.length === 0) {
            return res.status(400).json({ success: false, error: 'No rows provided' })
        }

        const allCategories = await prisma.category.findMany({ where: { ...getBranchFilter(req as any) } })
        const catByName = new Map<string, string>()
        for (const c of allCategories) catByName.set(c.name.toLowerCase(), c.id)

        async function findOrCreateCategory(name: string, level: number, parentId?: string): Promise<string> {
            const key = (parentId ? parentId + ':' : '') + name.toLowerCase()
            if (catByName.has(key)) return catByName.get(key)!
            const existing = await prisma.category.findFirst({
                where: { name, level, parentId: parentId || null }
            })
            if (existing) { catByName.set(key, existing.id); return existing.id }
            const created = await prisma.category.create({
                data: { name, level, parentId: parentId || null }
            })
            catByName.set(key, created.id)
            return created.id
        }

        const existingProducts = await prisma.product.findMany({
            where: { ...getBranchFilter(req as any) },
            select: { id: true, sku: true, stock: true }
        })
        const productBySku = new Map<string, { id: string; stock: number }>()
        for (const p of existingProducts) productBySku.set(p.sku, { id: p.id, stock: p.stock })

        let created = 0, updated = 0, skipped = 0, errors: string[] = []

        for (const row of rows) {
            try {
                if (!row.name || !row.sku) { skipped++; continue }
                const existing = productBySku.get(row.sku)

                let categoryId: string | undefined
                if (row.category) {
                    const names = row.category.split('>').map((s: string) => s.trim())
                    let parentId: string | undefined
                    for (let i = 0; i < names.length; i++) {
                        parentId = await findOrCreateCategory(names[i], i + 1, parentId)
                    }
                    categoryId = parentId
                }
                if (!categoryId) {
                    categoryId = await findOrCreateCategory('Chung', 1)
                }

                const productData: any = {
                    name: row.name,
                    sku: row.sku,
                    barcode: row.barcode || null,
                    description: row.description || null,
                    categoryId,
                    costPrice: parseFloat(row.costPrice) || 0,
                    sellingPrice: parseFloat(row.sellingPrice) || 0,
                    stock: parseInt(row.stock) || 0,
                    minStock: parseInt(row.minStock) || 0,
                    baseUnit: row.unit || 'Cái'
                }

                if (existing) {
                    await prisma.product.update({ where: { id: existing.id }, data: productData })
                    updated++
                } else {
                    await prisma.product.create({ data: productData })
                    created++
                }
            } catch (err: any) {
                errors.push(`${row.sku || 'unknown'}: ${err.message?.slice(0, 60)}`)
                if (errors.length >= 10) break
            }
        }

        res.json({ success: true, created, updated, skipped, errors: errors.slice(0, 10) })
    } catch (err) {
        console.error('Bulk import error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

export default router
