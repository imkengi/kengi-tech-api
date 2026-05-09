import { Router, Request, Response } from 'express'
import { authMiddleware, AuthRequest, getBranchFilter } from '../middleware/auth'
import { requireRole } from '../middleware/roleMiddleware'
import { requirePermission } from '../middleware/permissionMiddleware'
import { cacheGet, cacheSet, cacheDel } from '../lib/cache'
import { validate } from '../middleware/validate'
import { CreateProductSchema, UpdateProductSchema } from '../schemas'

const router = Router()

// ─── Products CRUD ──────────────────────────────────────────────────────────

// GET /api/products
router.get('/', authMiddleware, requirePermission('products.view'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        // Cache check
        const cacheKey = `products:${req.user?.storeSchema || 'default'}:${JSON.stringify(req.query)}`
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
        const size = Math.max(1, Math.min(200, parseInt(pageSize as string)))
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
            stock: warehouseStockMap ? (warehouseStockMap.get(p.id) ?? 0) : p.stock,
            minStock: p.minStock,
            maxStock: p.maxStock,
            baseUnit: p.baseUnit,
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
        res.json({
            success: true,
            data: {
                ...product,
                createdAt: product.createdAt.toISOString(),
                updatedAt: product.updatedAt.toISOString()
            }
        })
    } catch (err) {
        console.error('Get product error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

const PRODUCT_ALLOWED_FIELDS = [
    'name', 'sku', 'barcode', 'description', 'categoryId', 'brandId',
    'costPrice', 'sellingPrice', 'taxInclusive', 'stock', 'minStock', 'maxStock',
    'baseUnit', 'trackSerial', 'productType',
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

        const cleanConversions = Array.isArray(unitConversions) ? sanitizeUnitConversions(unitConversions) : null
        const cleanImages = Array.isArray(images) ? sanitizeImages(images) : null

        if (cleanConversions !== null) {
            await prisma.unitConversion.deleteMany({ where: { productId: String(req.params.id) } })
        }
        if (cleanImages !== null) {
            await prisma.productImage.deleteMany({ where: { productId: String(req.params.id) } })
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
    } catch (err) {
        console.error('Delete product error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// POST /api/products/bulk-import
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
