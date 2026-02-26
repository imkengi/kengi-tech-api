import { Router, Request, Response } from 'express'
import prisma from '../lib/prisma'
import { authMiddleware, AuthRequest } from '../middleware/auth'

const router = Router()

// ─── Inventory Transactions ─────────────────────────────────────────────────

// GET /api/inventory/transactions
router.get('/transactions', authMiddleware, async (req: Request, res: Response) => {
    try {
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
            prisma.inventoryTransaction.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                skip,
                take: size,
            }),
        ])

        const data = transactions.map(t => ({
            ...t,
            createdAt: t.createdAt.toISOString(),
        }))

        res.json({
            data,
            total,
            page: pageNum,
            pageSize: size,
            totalPages: Math.ceil(total / size),
        })
    } catch (err) {
        console.error('Get inventory transactions error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ─── Import Receipts ────────────────────────────────────────────────────────

// GET /api/inventory/receipts
router.get('/receipts', authMiddleware, async (_req: Request, res: Response) => {
    try {
        const receipts = await prisma.importReceipt.findMany({
            include: { items: true },
            orderBy: { createdAt: 'desc' },
        })

        const data = receipts.map(r => ({
            ...r,
            createdAt: r.createdAt.toISOString(),
            updatedAt: r.updatedAt.toISOString(),
        }))

        res.json(data)
    } catch (err) {
        console.error('Get import receipts error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// POST /api/inventory/receipts
router.post('/receipts', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const { items, ...receiptData } = req.body

        // Generate receipt code
        const count = await prisma.importReceipt.count()
        const code = `PN${String(count + 1).padStart(3, '0')}`

        const receipt = await prisma.importReceipt.create({
            data: {
                ...receiptData,
                code,
                userId: req.user!.userId,
                userName: receiptData.userName || 'Admin',
                items: {
                    create: items.map((item: any) => ({
                        productId: item.productId,
                        productName: item.productName,
                        productSku: item.productSku,
                        quantity: item.quantity,
                        costPrice: item.costPrice,
                        total: item.total || item.quantity * item.costPrice,
                    })),
                },
            },
            include: { items: true },
        })

        // Update stock for each item and create inventory transactions
        for (const item of items) {
            await prisma.product.update({
                where: { id: item.productId },
                data: { stock: { increment: item.quantity } },
            })

            await prisma.inventoryTransaction.create({
                data: {
                    type: 'import',
                    productId: item.productId,
                    productName: item.productName,
                    productSku: item.productSku,
                    quantity: item.quantity,
                    reason: `Nhập kho theo phiếu ${code}`,
                    referenceId: code,
                    referenceType: 'import_receipt',
                    unitPrice: item.costPrice || 0,
                    costPriceAfter: item.costPrice || 0,
                    supplierId: receiptData.supplierId,
                    supplierName: receiptData.supplierName,
                    userId: req.user!.userId,
                    userName: receiptData.userName || 'Admin',
                },
            })
        }

        res.status(201).json({
            success: true,
            data: {
                ...receipt,
                createdAt: receipt.createdAt.toISOString(),
                updatedAt: receipt.updatedAt.toISOString(),
            },
        })
    } catch (err) {
        console.error('Create import receipt error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ─── Stock Adjustments ──────────────────────────────────────────────────────

// POST /api/inventory/adjustments
router.post('/adjustments', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const { productId, productName, productSku, quantity, reason, note, userId, userName } = req.body

        // Update product stock
        await prisma.product.update({
            where: { id: productId },
            data: { stock: { increment: quantity } },
        })

        // Create inventory transaction record
        const transaction = await prisma.inventoryTransaction.create({
            data: {
                type: 'adjustment',
                productId,
                productName,
                productSku,
                quantity,
                reason,
                note,
                userId: userId || req.user!.userId,
                userName: userName || 'Admin',
            },
        })

        res.status(201).json({
            success: true,
            data: {
                ...transaction,
                createdAt: transaction.createdAt.toISOString(),
            },
        })
    } catch (err) {
        console.error('Stock adjustment error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

export default router
