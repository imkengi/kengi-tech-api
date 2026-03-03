import { Router, Response } from 'express'
import { authMiddleware, AuthRequest, getBranchFilter } from '../middleware/auth'
import { cacheGet, cacheSet, cacheDel } from '../lib/cache'

const router = Router()

// GET /api/inventory -- stock summary
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const schema = req.user?.storeSchema || 'default'
        const cacheKey = `${schema}:inventory:summary`
        const cached = await cacheGet(cacheKey)
        if (cached) return res.json(cached)

        const [totalProducts, lowStock, outOfStock, agg] = await Promise.all([
            prisma.product.count(),
            prisma.product.count({ where: { stock: { gt: 0, lte: 10 } } }),
            prisma.product.count({ where: { stock: { lte: 0 } } }),
            prisma.product.aggregate({ _sum: { stock: true } }),
        ])
        const response = { success: true, data: { totalProducts, lowStock, outOfStock, totalStock: agg._sum.stock || 0 } }
        await cacheSet(cacheKey, response, 30)
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
                { productName: { contains: search as string } },
                { productSku: { contains: search as string } },
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

        const count = await prisma.importReceipt.count({ where: { ...getBranchFilter(req as any) } })
        const code = `PN${String(count + 1).padStart(3, '0')}`

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

export default router
