import { Router, Request, Response } from 'express'
import prisma from '../lib/prisma'
import { authMiddleware, AuthRequest } from '../middleware/auth'

const router = Router()

// GET /api/transactions
router.get('/', authMiddleware, async (req: Request, res: Response) => {
    try {
        const {
            search, startDate, endDate, paymentMethod, status, cashier,
            page = '1', pageSize = '20',
        } = req.query

        const where: any = {}

        if (search) {
            where.OR = [
                { receiptNumber: { contains: search as string } },
                { customerName: { contains: search as string } },
                { customerPhone: { contains: search as string } },
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
        const size = Math.max(1, Math.min(100, parseInt(pageSize as string)))
        const skip = (pageNum - 1) * size

        const [total, transactions] = await Promise.all([
            prisma.transaction.count({ where }),
            prisma.transaction.findMany({
                where,
                include: { items: true, payments: true },
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
            returnedAt: t.returnedAt?.toISOString(),
            returnReason: t.returnReason,
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
        console.error('Get transactions error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// GET /api/transactions/:id
router.get('/:id', authMiddleware, async (req: Request, res: Response) => {
    try {
        const transaction = await prisma.transaction.findUnique({
            where: { id: req.params.id },
            include: { items: true, payments: true },
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
router.post('/', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const { items, payments, ...txData } = req.body

        if (!items || !Array.isArray(items) || items.length === 0) {
            res.status(400).json({ success: false, error: 'Items are required' })
            return
        }

        // Get user info
        const user = await prisma.user.findUnique({ where: { id: req.user!.userId } })

        // Generate receipt number
        const count = await prisma.transaction.count()
        const receiptNumber = txData.receiptNumber || `HD${Date.now()}${String(count + 1).padStart(4, '0')}`

        // Calculate debt amount from credit payments
        const debtAmount = txData.debtAmount || 0

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
            items: {
                create: items.map((item: any) => ({
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

        const transaction = await prisma.transaction.create({
            data: createData,
            include: { items: true, payments: true },
        })


        // Decrease product stock + create inventory transaction records for each item
        for (const item of items) {
            const updatedProduct = await prisma.product.update({
                where: { id: item.productId },
                data: { stock: { decrement: item.quantity } },
            })

            // Create inventory transaction record for stock tracking
            await prisma.inventoryTransaction.create({
                data: {
                    type: 'sale',
                    productId: item.productId,
                    productName: item.productName,
                    productSku: item.sku || item.productSku || '',
                    quantity: -item.quantity,
                    reason: `Bán hàng - ${receiptNumber}`,
                    note: `Giao dịch ${receiptNumber}`,
                    referenceId: receiptNumber,
                    referenceType: 'sale',
                    unitPrice: item.unitPrice || 0,
                    costPriceAfter: updatedProduct.costPrice,
                    userId: req.user!.userId,
                    userName: user?.name || 'Admin',
                },
            })
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
        }

        console.log(`✅ Transaction ${receiptNumber} created — ${items.length} items, total: ${transaction.total}`)

        res.status(201).json({
            success: true,
            data: {
                ...transaction,
                createdAt: transaction.createdAt.toISOString(),
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
        const existing = await prisma.transaction.findUnique({
            where: { id: req.params.id },
            include: { items: true },
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
            where: { id: req.params.id },
            data: { status: 'voided' },
            include: { items: true },
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

        console.log(`🚫 Transaction ${existing.receiptNumber} voided`)

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

// PUT /api/transactions/:id/return — Return a transaction
router.put('/:id/return', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const { reason, returnItems } = req.body

        const existing = await prisma.transaction.findUnique({
            where: { id: req.params.id },
            include: { items: true },
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

        // Calculate return total
        const returnTotal = itemsToReturn.reduce((sum, item) => sum + item.lineTotal, 0)

        const transaction = await prisma.transaction.update({
            where: { id: req.params.id },
            data: {
                status: 'returned',
                returnedAt: new Date(),
                returnReason: reason || 'Trả hàng',
            },
            include: { items: true, payments: true },
        })

        // Restore stock for returned items + create inventory records
        for (const item of itemsToReturn) {
            const updatedProduct = await prisma.product.update({
                where: { id: item.productId },
                data: { stock: { increment: item.quantity } },
            })

            await prisma.inventoryTransaction.create({
                data: {
                    type: 'return',
                    productId: item.productId,
                    productName: item.productName,
                    productSku: item.sku,
                    quantity: item.quantity,
                    reason: `Trả hàng - ${existing.receiptNumber}`,
                    note: reason || `Trả hàng giao dịch ${existing.receiptNumber}`,
                    referenceId: existing.receiptNumber,
                    referenceType: 'return',
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
                    totalPurchases: { decrement: returnTotal },
                    totalOrders: { decrement: 1 },
                },
            })
        }

        console.log(`↩️ Transaction ${existing.receiptNumber} returned — ${itemsToReturn.length} items`)

        res.json({
            success: true,
            data: {
                ...transaction,
                createdAt: transaction.createdAt.toISOString(),
                returnedAt: transaction.returnedAt?.toISOString(),
            },
        })
    } catch (err) {
        console.error('Return transaction error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

export default router
