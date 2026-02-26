import { Router, Request, Response } from 'express'
import prisma from '../lib/prisma'
import { authMiddleware } from '../middleware/auth'

const router = Router()

// ─── Products CRUD ──────────────────────────────────────────────────────────

// GET /api/products
router.get('/', authMiddleware, async (req: Request, res: Response) => {
    try {
        const {
            search, categoryId, brandId, stockStatus,
            page = '1', pageSize = '20', sortBy = 'createdAt', sortOrder = 'desc',
        } = req.query

        const where: any = {}

        if (search) {
            where.OR = [
                { name: { contains: search as string } },
                { sku: { contains: search as string } },
                { barcode: { contains: search as string } },
            ]
        }
        if (categoryId) where.categoryId = categoryId
        if (brandId) where.brandId = brandId
        if (stockStatus === 'out_of_stock') where.stock = 0
        else if (stockStatus === 'low_stock') where.stock = { gt: 0 }  // post-filter for minStock below
        else if (stockStatus === 'in_stock') where.stock = { gt: 0 }

        const pageNum = Math.max(1, parseInt(page as string))
        const size = Math.max(1, Math.min(100, parseInt(pageSize as string)))
        const skip = (pageNum - 1) * size

        // For low_stock, we need raw comparison — simplify with post-filter
        const [total, products] = await Promise.all([
            prisma.product.count({ where }),
            prisma.product.findMany({
                where,
                include: {
                    category: true,
                    brand: true,
                    unitConversions: true,
                    images: true,
                    serials: true,
                },
                orderBy: { [sortBy as string]: sortOrder },
                skip,
                take: stockStatus === 'low_stock' ? undefined : size, // fetch all for low_stock post-filter
            }),
        ])

        // Post-filter for low_stock (stock > 0 AND stock <= minStock)
        let filteredProducts = products
        let filteredTotal = total
        if (stockStatus === 'low_stock') {
            filteredProducts = products.filter(p => p.stock > 0 && p.stock <= p.minStock)
            filteredTotal = filteredProducts.length
        }

        // Map to match frontend type shape
        const data = filteredProducts.map(p => ({
            id: p.id,
            name: p.name,
            sku: p.sku,
            barcode: p.barcode,
            description: p.description,
            categoryId: p.categoryId,
            categoryName: (p as any).category?.name ?? null,
            brandId: p.brandId,
            brandName: (p as any).brand?.name ?? null,
            costPrice: p.costPrice,
            sellingPrice: p.sellingPrice,
            taxInclusive: p.taxInclusive,
            stock: p.stock,
            minStock: p.minStock,
            maxStock: p.maxStock,
            baseUnit: p.baseUnit,
            trackSerial: p.trackSerial,
            unitConversions: p.unitConversions,
            images: p.images,
            serials: (p as any).serials ?? [],
            createdAt: p.createdAt.toISOString(),
            updatedAt: p.updatedAt.toISOString(),
        }))

        res.json({
            success: true,
            data: {
                items: data,
                total: filteredTotal,
                page: pageNum,
                pageSize: size,
                totalPages: Math.ceil(filteredTotal / size),
            },
        })
    } catch (err) {
        console.error('Get products error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// GET /api/products/:id
router.get('/:id', authMiddleware, async (req: Request, res: Response) => {
    try {
        const product = await prisma.product.findUnique({
            where: { id: req.params.id },
            include: { category: true, brand: true, unitConversions: true, images: true, serials: true },
        })

        if (!product) {
            res.status(404).json({ success: false, error: 'Product not found' })
            return
        }

        res.json({
            success: true,
            data: {
                ...product,
                createdAt: product.createdAt.toISOString(),
                updatedAt: product.updatedAt.toISOString(),
            },
        })
    } catch (err) {
        console.error('Get product error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// POST /api/products
router.post('/', authMiddleware, async (req: Request, res: Response) => {
    try {
        const { unitConversions, images, ...productData } = req.body

        const product = await prisma.product.create({
            data: {
                ...productData,
                unitConversions: unitConversions?.length ? {
                    create: unitConversions.map((uc: any) => ({
                        fromUnit: uc.fromUnit,
                        toUnit: uc.toUnit,
                        conversionRate: uc.conversionRate,
                    })),
                } : undefined,
                images: images?.length ? {
                    create: images.map((img: any) => ({
                        url: img.url,
                        isPrimary: img.isPrimary || false,
                    })),
                } : undefined,
            },
            include: { category: true, brand: true, unitConversions: true, images: true, serials: true },
        })

        res.status(201).json({
            success: true,
            data: {
                ...product,
                createdAt: product.createdAt.toISOString(),
                updatedAt: product.updatedAt.toISOString(),
            },
        })
    } catch (err) {
        console.error('Create product error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// PUT /api/products/:id
router.put('/:id', authMiddleware, async (req: Request, res: Response) => {
    try {
        const { unitConversions, images, ...rawUpdates } = req.body

        // Only allow fields that exist in Prisma Product model
        const allowedFields = [
            'name', 'sku', 'barcode', 'description', 'categoryId', 'brandId',
            'costPrice', 'sellingPrice', 'taxInclusive', 'stock', 'minStock',
            'maxStock', 'baseUnit', 'trackSerial',
        ]
        const updates: any = {}
        for (const key of allowedFields) {
            if (key in rawUpdates && rawUpdates[key] !== undefined) {
                updates[key] = rawUpdates[key]
            }
        }

        // If unitConversions provided, delete old ones and create new
        if (unitConversions) {
            await prisma.unitConversion.deleteMany({ where: { productId: req.params.id } })
        }
        if (images) {
            await prisma.productImage.deleteMany({ where: { productId: req.params.id } })
        }

        const product = await prisma.product.update({
            where: { id: req.params.id },
            data: {
                ...updates,
                unitConversions: unitConversions?.length ? {
                    create: unitConversions.map((uc: any) => ({
                        fromUnit: uc.fromUnit,
                        toUnit: uc.toUnit,
                        conversionRate: uc.conversionRate,
                    })),
                } : undefined,
                images: images?.length ? {
                    create: images.map((img: any) => ({
                        url: img.url,
                        isPrimary: img.isPrimary || false,
                    })),
                } : undefined,
            },
            include: { category: true, brand: true, unitConversions: true, images: true, serials: true },
        })

        res.json({
            success: true,
            data: {
                ...product,
                createdAt: product.createdAt.toISOString(),
                updatedAt: product.updatedAt.toISOString(),
            },
        })
    } catch (err) {
        console.error('Update product error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// DELETE /api/products/:id
router.delete('/:id', authMiddleware, async (req: Request, res: Response) => {
    try {
        await prisma.product.delete({ where: { id: req.params.id } })
        res.json({ success: true, message: 'Product deleted' })
    } catch (err) {
        console.error('Delete product error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ─── Serial / IMEI Management ───────────────────────────────────────────────

// GET /api/products/:id/serials
router.get('/:id/serials', authMiddleware, async (req: Request, res: Response) => {
    try {
        const { status } = req.query
        const where: any = { productId: req.params.id }
        if (status) where.status = status

        const serials = await prisma.productSerial.findMany({
            where,
            orderBy: { createdAt: 'desc' },
        })
        res.json({ success: true, data: serials })
    } catch (err) {
        console.error('Get serials error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// POST /api/products/:id/serials
router.post('/:id/serials', authMiddleware, async (req: Request, res: Response) => {
    try {
        const { serial, serials: serialList, note } = req.body
        const productId = req.params.id

        // Support both single serial and batch
        const toCreate = serialList?.length
            ? serialList.map((s: string) => ({ serial: s.trim(), note }))
            : [{ serial: serial?.trim(), note }]

        const created = []
        for (const item of toCreate) {
            if (!item.serial) continue
            const record = await prisma.productSerial.create({
                data: {
                    productId,
                    serial: item.serial,
                    note: item.note || null,
                },
            })
            created.push(record)
        }

        res.status(201).json({ success: true, data: created })
    } catch (err: any) {
        if (err.code === 'P2002') {
            res.status(409).json({ success: false, error: 'Serial đã tồn tại cho sản phẩm này' })
            return
        }
        console.error('Add serial error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// PUT /api/products/:id/serials/:serialId
router.put('/:id/serials/:serialId', authMiddleware, async (req: Request, res: Response) => {
    try {
        const { status, note } = req.body
        const data: any = {}
        if (status) {
            data.status = status
            if (status === 'sold') data.soldAt = new Date()
        }
        if (note !== undefined) data.note = note

        const updated = await prisma.productSerial.update({
            where: { id: req.params.serialId },
            data,
        })
        res.json({ success: true, data: updated })
    } catch (err) {
        console.error('Update serial error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// DELETE /api/products/:id/serials/:serialId
router.delete('/:id/serials/:serialId', authMiddleware, async (req: Request, res: Response) => {
    try {
        await prisma.productSerial.delete({ where: { id: req.params.serialId } })
        res.json({ success: true, message: 'Serial deleted' })
    } catch (err) {
        console.error('Delete serial error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

export default router
