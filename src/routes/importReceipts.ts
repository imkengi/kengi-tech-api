import { Router, Request, Response } from 'express'
import prisma from '../lib/prisma'
import { authMiddleware } from '../middleware/auth'
import { calculateCostPrice, getCostPriceMethod } from '../lib/costPrice'

const router = Router()

// GET /api/import-receipts
router.get('/', authMiddleware, async (req: Request, res: Response) => {
    try {
        const {
            search, status,
            page = '1', pageSize = '20',
        } = req.query

        const where: any = {}

        if (search) {
            const s = String(search)
            where.OR = [
                { code: { contains: s } },
                { supplierName: { contains: s } },
                { note: { contains: s } },
            ]
        }
        if (status) where.status = String(status)

        const pageNum = Math.max(1, parseInt(String(page)))
        const size = Math.max(1, Math.min(100, parseInt(String(pageSize))))
        const skip = (pageNum - 1) * size

        const [total, receipts] = await Promise.all([
            prisma.importReceipt.count({ where }),
            prisma.importReceipt.findMany({
                where,
                include: { items: true },
                orderBy: { createdAt: 'desc' },
                skip,
                take: size,
            }),
        ])

        res.json({
            success: true,
            data: {
                items: receipts.map(r => ({
                    ...r,
                    createdAt: r.createdAt.toISOString(),
                    updatedAt: r.updatedAt.toISOString(),
                })),
                total,
                page: pageNum,
                pageSize: size,
                totalPages: Math.ceil(total / size),
            },
        })
    } catch (err) {
        console.error('Get import receipts error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// GET /api/import-receipts/:id
router.get('/:id', authMiddleware, async (req: Request, res: Response) => {
    try {
        const receipt = await prisma.importReceipt.findUnique({
            where: { id: req.params.id },
            include: { items: true },
        })

        if (!receipt) {
            res.status(404).json({ success: false, error: 'Not found' })
            return
        }

        res.json({
            success: true,
            data: { ...receipt, createdAt: receipt.createdAt.toISOString(), updatedAt: receipt.updatedAt.toISOString() },
        })
    } catch (err) {
        console.error('Get import receipt error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// POST /api/import-receipts
router.post('/', authMiddleware, async (req: Request, res: Response) => {
    try {
        const { items, ...receiptData } = req.body
        const user = (req as any).user

        // Fetch actual user name from DB
        const dbUser = await prisma.user.findUnique({ where: { id: user.userId || user.id } })
        const userName = dbUser?.name || user.email || 'Unknown'

        // Generate code: NH-YYYYMMDD-XXX
        const today = new Date()
        const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '')
        const count = await prisma.importReceipt.count({
            where: {
                createdAt: {
                    gte: new Date(today.getFullYear(), today.getMonth(), today.getDate()),
                },
            },
        })
        const code = `NH-${dateStr}-${String(count + 1).padStart(3, '0')}`

        const totalCost = items.reduce((sum: number, item: any) => sum + (item.quantity * item.costPrice), 0)
        const totalItems = items.reduce((sum: number, item: any) => sum + item.quantity, 0)

        const receipt = await prisma.importReceipt.create({
            data: {
                code,
                supplierId: receiptData.supplierId || null,
                supplierName: receiptData.supplierName || null,
                totalCost,
                totalItems,
                status: receiptData.status || 'draft',
                note: receiptData.note || null,
                userId: user.userId || user.id,
                userName,
                items: {
                    create: items.map((item: any) => ({
                        productId: item.productId,
                        productName: item.productName,
                        productSku: item.productSku,
                        quantity: item.quantity,
                        costPrice: item.costPrice,
                        total: item.quantity * item.costPrice,
                    })),
                },
            },
            include: { items: true },
        })

        // If completed immediately, update product stock + log inventory transactions
        if (receipt.status === 'completed') {
            const method = await getCostPriceMethod(prisma as any)
            for (const item of receipt.items) {
                // Fetch product BEFORE updating stock to get current state
                const productBefore = await prisma.product.findUnique({ where: { id: item.productId } })
                const currentStock = productBefore?.stock ?? 0
                const currentCostPrice = productBefore?.costPrice ?? 0

                // Calculate new cost price based on chosen method
                const newCostPrice = calculateCostPrice(method, {
                    productId: item.productId,
                    currentStock,
                    currentCostPrice,
                    transactionQty: item.quantity,
                    transactionUnitPrice: item.costPrice || 0,
                })

                // Update stock AND costPrice
                await prisma.product.update({
                    where: { id: item.productId },
                    data: {
                        stock: { increment: item.quantity },
                        costPrice: newCostPrice,
                    },
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
                        costPriceAfter: newCostPrice,
                        supplierId: receiptData.supplierId || null,
                        supplierName: receiptData.supplierName || null,
                        userId: user.userId || user.id,
                        userName,
                    },
                })
            }
        }

        res.status(201).json({
            success: true,
            data: { ...receipt, createdAt: receipt.createdAt.toISOString(), updatedAt: receipt.updatedAt.toISOString() },
        })
    } catch (err) {
        console.error('Create import receipt error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// PUT /api/import-receipts/:id/complete — Confirm receipt (draft → completed)
router.put('/:id/complete', authMiddleware, async (req: Request, res: Response) => {
    try {
        const receipt = await prisma.importReceipt.findUnique({
            where: { id: req.params.id },
            include: { items: true },
        })

        if (!receipt) { res.status(404).json({ success: false, error: 'Not found' }); return }
        if (receipt.status !== 'draft') { res.status(400).json({ success: false, error: 'Only drafts can be completed' }); return }

        const user = (req as any).user
        const dbUser = await prisma.user.findUnique({ where: { id: user.userId || user.id } })
        const userName = dbUser?.name || user.email || 'Unknown'

        // Update stock for each item + log inventory transactions
        const method = await getCostPriceMethod(prisma as any)
        for (const item of receipt.items) {
            // Fetch product BEFORE updating stock
            const productBefore = await prisma.product.findUnique({ where: { id: item.productId } })
            const currentStock = productBefore?.stock ?? 0
            const currentCostPrice = productBefore?.costPrice ?? 0

            const newCostPrice = calculateCostPrice(method, {
                productId: item.productId,
                currentStock,
                currentCostPrice,
                transactionQty: item.quantity,
                transactionUnitPrice: item.costPrice || 0,
            })

            await prisma.product.update({
                where: { id: item.productId },
                data: {
                    stock: { increment: item.quantity },
                    costPrice: newCostPrice,
                },
            })
            await prisma.inventoryTransaction.create({
                data: {
                    type: 'import',
                    productId: item.productId,
                    productName: item.productName,
                    productSku: item.productSku,
                    quantity: item.quantity,
                    reason: `Nhập kho theo phiếu ${receipt.code}`,
                    referenceId: receipt.code,
                    referenceType: 'import_receipt',
                    unitPrice: item.costPrice || 0,
                    costPriceAfter: newCostPrice,
                    supplierId: receipt.supplierId,
                    supplierName: receipt.supplierName,
                    userId: user.userId || user.id,
                    userName,
                },
            })
        }

        const updated = await prisma.importReceipt.update({
            where: { id: req.params.id },
            data: { status: 'completed' },
            include: { items: true },
        })

        res.json({
            success: true,
            data: { ...updated, createdAt: updated.createdAt.toISOString(), updatedAt: updated.updatedAt.toISOString() },
        })
    } catch (err) {
        console.error('Complete import receipt error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// PUT /api/import-receipts/:id/cancel
router.put('/:id/cancel', authMiddleware, async (req: Request, res: Response) => {
    try {
        const receipt = await prisma.importReceipt.findUnique({ where: { id: req.params.id } })
        if (!receipt) { res.status(404).json({ success: false, error: 'Not found' }); return }
        if (receipt.status !== 'draft') { res.status(400).json({ success: false, error: 'Only drafts can be cancelled' }); return }

        const updated = await prisma.importReceipt.update({
            where: { id: req.params.id },
            data: { status: 'cancelled' },
            include: { items: true },
        })

        res.json({
            success: true,
            data: { ...updated, createdAt: updated.createdAt.toISOString(), updatedAt: updated.updatedAt.toISOString() },
        })
    } catch (err) {
        console.error('Cancel import receipt error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// PUT /api/import-receipts/:id/return — Return imported goods to supplier
router.put('/:id/return', authMiddleware, async (req: Request, res: Response) => {
    try {
        const receipt = await prisma.importReceipt.findUnique({
            where: { id: req.params.id },
            include: { items: true },
        })
        if (!receipt) { res.status(404).json({ success: false, error: 'Not found' }); return }
        if (receipt.status !== 'completed' && receipt.status !== 'partial_return') {
            res.status(400).json({ success: false, error: 'Chỉ có thể trả hàng phiếu đã hoàn thành' }); return
        }

        const user = (req as any).user
        const dbUser = await prisma.user.findUnique({ where: { id: user.userId || user.id } })
        const userName = dbUser?.name || user.email || 'Unknown'

        // req.body.items = [{ productId, quantity, reason? }]
        const returnItems: { productId: string; quantity: number; reason?: string }[] = req.body.items
        if (!returnItems || returnItems.length === 0) {
            res.status(400).json({ success: false, error: 'Vui lòng chọn sản phẩm cần trả' }); return
        }

        // Validate quantities
        let totalReturnCost = 0
        let totalReturnQty = 0
        for (const ri of returnItems) {
            const receiptItem = receipt.items.find(i => i.productId === ri.productId)
            if (!receiptItem) {
                res.status(400).json({ success: false, error: `Sản phẩm ${ri.productId} không có trong phiếu` }); return
            }
            if (ri.quantity <= 0 || ri.quantity > receiptItem.quantity) {
                res.status(400).json({ success: false, error: `Số lượng trả không hợp lệ cho ${receiptItem.productName}` }); return
            }

            // Update product stock (decrement)
            const product = await prisma.product.findUnique({ where: { id: ri.productId } })
            if (product) {
                const newStock = Math.max(0, product.stock - ri.quantity)
                await prisma.product.update({
                    where: { id: ri.productId },
                    data: { stock: newStock },
                })
            }

            totalReturnCost += receiptItem.costPrice * ri.quantity
            totalReturnQty += ri.quantity

            // Log inventory transaction
            await prisma.inventoryTransaction.create({
                data: {
                    type: 'export',
                    productId: ri.productId,
                    productName: receiptItem.productName,
                    productSku: receiptItem.productSku,
                    quantity: -ri.quantity,
                    reason: ri.reason || `Trả hàng nhập theo phiếu ${receipt.code}`,
                    referenceId: receipt.code,
                    referenceType: 'import_return',
                    unitPrice: receiptItem.costPrice,
                    supplierId: receipt.supplierId,
                    supplierName: receipt.supplierName,
                    userId: user.userId || user.id,
                    userName,
                },
            })
        }

        // Check if full or partial return
        const totalOriginalQty = receipt.items.reduce((s, i) => s + i.quantity, 0)
        const isFullReturn = totalReturnQty >= totalOriginalQty
        const newStatus = isFullReturn ? 'returned' : 'partial_return'

        const updated = await prisma.importReceipt.update({
            where: { id: req.params.id },
            data: { status: newStatus },
            include: { items: true },
        })

        res.json({
            success: true,
            data: {
                ...updated,
                createdAt: updated.createdAt.toISOString(),
                updatedAt: updated.updatedAt.toISOString(),
                returnedQty: totalReturnQty,
                returnedCost: totalReturnCost,
            },
        })
    } catch (err: any) {
        console.error('Return import receipt error:', err?.message || err)
        res.status(500).json({ success: false, error: 'Internal server error', detail: err?.message })
    }
})

// DELETE /api/import-receipts/:id — delete any receipt, reverse stock if completed
router.delete('/:id', authMiddleware, async (req: Request, res: Response) => {
    try {
        const receipt = await prisma.importReceipt.findUnique({
            where: { id: req.params.id },
            include: { items: true },
        })
        if (!receipt) { res.status(404).json({ success: false, error: 'Not found' }); return }

        // If receipt was completed, reverse stock changes
        if (receipt.status === 'completed') {
            const method = await getCostPriceMethod(prisma as any)
            for (const item of receipt.items) {
                const product = await prisma.product.findUnique({ where: { id: item.productId } })
                if (product) {
                    const newStock = Math.max(0, product.stock - item.quantity)
                    // Recalculate cost price after removing this import
                    let newCostPrice = product.costPrice
                    if (method === 'average' && newStock > 0) {
                        const totalValue = (product.costPrice * product.stock) - (item.costPrice * item.quantity)
                        newCostPrice = Math.round(totalValue / newStock)
                    }
                    await prisma.product.update({
                        where: { id: item.productId },
                        data: {
                            stock: newStock,
                            costPrice: newStock > 0 ? newCostPrice : product.costPrice,
                        },
                    })
                }
            }

            // Delete related inventory transactions
            await prisma.inventoryTransaction.deleteMany({
                where: { referenceId: receipt.code, referenceType: 'import_receipt' },
            })
        }

        // Delete the receipt (cascade deletes items)
        await prisma.importReceipt.delete({ where: { id: req.params.id } })
        res.json({ success: true, message: 'Deleted' })
    } catch (err: any) {
        console.error('Delete import receipt error:', err?.message || err)
        console.error('Delete import receipt stack:', err?.stack)
        res.status(500).json({ success: false, error: 'Internal server error', detail: err?.message })
    }
})

export default router
