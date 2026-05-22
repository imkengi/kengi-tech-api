import { Router, Response } from 'express'
import { errorDetail } from '../lib/errorResponse'
import { authMiddleware, getBranchFilter, AuthRequest, getBranchId } from '../middleware/auth'
import { validate } from '../middleware/validate'
import { CreateReturnSchema, UpdateReturnSchema } from '../schemas'
import { nextCode } from '../lib/codeGenerator'

const router = Router()

// ═══════════════════════════════════════════════════════════════════════════════
//  GET /api/returns
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { status, search, reason, startDate, endDate } = req.query
        const where: any = {}
        if (status && status !== 'all') where.status = status
        if (reason && reason !== 'all') where.reason = reason
        if (startDate || endDate) {
            where.createdAt = {}
            if (startDate) where.createdAt.gte = new Date(startDate as string)
            if (endDate) where.createdAt.lte = new Date(endDate as string)
        }
        if (search) {
            where.OR = [
                { code: { contains: String(search) } },
                { customerName: { contains: String(search) } },
                { originalInvoice: { contains: String(search) } },
            ]
        }
        const returns = await prisma.returnOrder.findMany({
            where,
            include: { items: true },
            orderBy: { createdAt: 'desc' },
        })
        res.json({ success: true, data: returns })
    } catch (err) {
        console.error('Get returns error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ═══════════════════════════════════════════════════════════════════════════════
//  GET /api/returns/stats
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/stats', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const returns = await prisma.returnOrder.findMany({ ...getBranchFilter(req as any) })
        const total = returns.length
        const pending = returns.filter(r => r.status === 'pending').length
        const approved = returns.filter(r => r.status === 'approved').length
        const processing = returns.filter(r => r.status === 'processing').length
        const refunded = returns.filter(r => r.status === 'refunded').length
        const rejected = returns.filter(r => r.status === 'rejected').length
        const exchanged = returns.filter(r => r.status === 'exchanged').length
        const totalRefund = returns.filter(r => ['refunded', 'exchanged'].includes(r.status)).reduce((s, r) => s + r.totalRefund, 0)
        const pendingRefund = returns.filter(r => ['pending', 'approved', 'processing'].includes(r.status)).reduce((s, r) => s + r.totalRefund, 0)

        // By reason breakdown
        const byReason: Record<string, number> = {}
        returns.forEach(r => { byReason[r.reason] = (byReason[r.reason] || 0) + 1 })

        // By refund method
        const byMethod: Record<string, number> = {}
        returns.filter(r => r.refundMethod).forEach(r => { byMethod[r.refundMethod!] = (byMethod[r.refundMethod!] || 0) + 1 })

        // Last 30 days trend
        const now = new Date()
        const trend: { date: string; count: number; amount: number }[] = []
        for (let i = 29; i >= 0; i--) {
            const d = new Date(now)
            d.setDate(d.getDate() - i)
            const ds = d.toISOString().slice(0, 10)
            const dayReturns = returns.filter(r => r.createdAt.toISOString().slice(0, 10) === ds)
            trend.push({ date: ds, count: dayReturns.length, amount: dayReturns.reduce((s, r) => s + r.totalRefund, 0) })
        }

        res.json({
            success: true,
            data: {
                total, pending, approved, processing, refunded, rejected, exchanged,
                totalRefund, pendingRefund,
                byReason: Object.entries(byReason).map(([reason, count]) => ({ reason, count })),
                byMethod: Object.entries(byMethod).map(([method, count]) => ({ method, count })),
                trend,
            },
        })
    } catch (err) {
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ═══════════════════════════════════════════════════════════════════════════════
//  GET /api/returns/analytics
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/analytics', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { days = '30' } = req.query
        const since = new Date(Date.now() - Number(days) * 86400_000)

        const returns = await prisma.returnOrder.findMany({
            where: { createdAt: { gte: since } },
            include: { items: true },
        })

        // Return rate (vs total transactions)
        const totalTx = await prisma.transaction.count({ where: { createdAt: { gte: since } } })
        const returnRate = totalTx > 0 ? (returns.length / totalTx * 100) : 0

        // Top returned products
        const productMap: Record<string, { name: string; count: number; amount: number }> = {}
        returns.forEach(r => {
            r.items.forEach(item => {
                const key = item.productName
                if (!productMap[key]) productMap[key] = { name: key, count: 0, amount: 0 }
                productMap[key].count += item.quantity
                productMap[key].amount += item.quantity * item.unitPrice
            })
        })
        const topProducts = Object.values(productMap).sort((a, b) => b.count - a.count).slice(0, 10)

        // Avg processing time (pending → refunded)
        const processed = returns.filter(r => r.processedAt)
        const avgProcessingHours = processed.length > 0
            ? processed.reduce((s, r) => s + (r.processedAt!.getTime() - r.createdAt.getTime()) / 3600000, 0) / processed.length
            : 0

        // Restock rate
        const allItems = returns.flatMap(r => r.items)
        const restockedCount = allItems.filter(i => i.restocked).length
        const restockRate = allItems.length > 0 ? (restockedCount / allItems.length * 100) : 0

        res.json({
            success: true,
            data: {
                returnRate: Math.round(returnRate * 10) / 10,
                topProducts,
                avgProcessingHours: Math.round(avgProcessingHours * 10) / 10,
                restockRate: Math.round(restockRate * 10) / 10,
                totalReturns: returns.length,
                totalRefundAmount: returns.reduce((s, r) => s + r.totalRefund, 0),
            },
        })
    } catch (err) {
        console.error('Return analytics error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ═══════════════════════════════════════════════════════════════════════════════
//  POST /api/returns
// ═══════════════════════════════════════════════════════════════════════════════

router.post('/', authMiddleware, validate(CreateReturnSchema), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { code, originalInvoice, transactionId, originalTransactionId, customerName, customerPhone, reason, items, totalRefund, notes, refundMethod, staffName } = req.body
        if (!originalInvoice?.trim()) return res.status(400).json({ success: false, error: 'Original invoice required' })
        if (!customerName?.trim()) return res.status(400).json({ success: false, error: 'Customer name required' })

        // Accept both transactionId and originalTransactionId from frontend
        let txId = transactionId || originalTransactionId || null
        if (!txId && originalInvoice && originalInvoice !== 'TRẢ NHANH' && originalInvoice !== 'Không Hóa Đơn') {
            const txByInvoice = await prisma.transaction.findFirst({ where: { receiptNumber: originalInvoice.trim() } })
            if (txByInvoice) txId = txByInvoice.id
        }

        // Auto-generate code
        const returnCode = code || await nextCode(prisma, 'returnOrderCodeSeq', 'RT', 4, '-', 'ReturnOrder', 'code')

        const returnOrder = await prisma.returnOrder.create({
            data: {
                code: returnCode,
                originalInvoice: originalInvoice.trim(),
                transactionId: txId,
                customerName: customerName.trim(),
                customerPhone: customerPhone || null,
                reason: reason || 'other',
                totalRefund: Number(totalRefund) || 0,
                refundMethod: refundMethod || null,
                staffName: staffName || null,
                notes: notes || null,
                status: 'refunded',
                processedAt: new Date(),
                refundedAt: new Date(),
                refundAmount: Number(totalRefund) || 0,
                items: {
                    create: (items || []).map((item: any) => ({
                        productId: item.productId || null,
                        productName: item.productName,
                        sku: item.sku || null,
                        quantity: Number(item.quantity) || 1,
                        unitPrice: Number(item.unitPrice) || 0,
                        returnReason: item.returnReason || null,
                        condition: item.condition || null,
                    })),
                },
            },
            include: { items: true },
        })

        // Auto-reduce customer debt if original sale was credit/partial
        if (txId) {
            try {
                const originalTx = await prisma.transaction.findUnique({ where: { id: txId } })
                if (originalTx) {
                    await prisma.transaction.update({
                        where: { id: txId },
                        data: { returnedAt: new Date() }
                    })
                }
                if (originalTx && originalTx.customerId) {
                    const customer = await prisma.customer.findUnique({ where: { id: originalTx.customerId } })
                    if (customer && customer.debt > 0) {
                        const refundAmt = Number(totalRefund) || 0
                        const debtReduction = Math.min(refundAmt, customer.debt)
                        if (debtReduction > 0) {
                            await prisma.customer.update({
                                where: { id: customer.id },
                                data: { debt: { decrement: debtReduction } },
                            })
                            await prisma.debtEntry.create({
                                data: {
                                    customerId: customer.id,
                                    customerName: customer.name,
                                    phone: customer.phone || '',
                                    type: 'return',
                                    amount: debtReduction,
                                    description: `Trả hàng - phiếu ${returnCode} (${originalInvoice})`,
                                    balance: Math.max(0, customer.debt - debtReduction),
                                },
                            })
                            console.log(`📦 Debt reduced by ${debtReduction} for ${customer.name} (return ${returnCode})`)
                        }
                    }
                }
            } catch (debtErr) {
                console.error('Auto debt reduction on return creation failed (non-fatal):', debtErr)
            }
        }

        // Auto-restock items
        try {
            const storeSettings = await prisma.storeSettings.findFirst()
            if (storeSettings?.autoRestockOnReturn) {
                for (const item of returnOrder.items) {
                    if (!item.productId || item.condition === 'damaged' || item.condition === 'defective') continue

                    // Mark as restocked
                    await prisma.returnItem.update({
                        where: { id: item.id },
                        data: { restocked: true },
                    })

                    // Increment stock
                    await prisma.product.update({
                        where: { id: item.productId },
                        data: { stock: { increment: item.quantity } },
                    })

                    // Create inventory transaction
                    await (prisma as any).inventoryTransaction.create({
                        data: {
                            type: 'import',
                            productId: item.productId,
                            productName: item.productName || 'Unknown',
                            productSku: item.sku || '',
                            quantity: item.quantity,
                            reason: `Tự động nhập lại kho từ đơn trả hàng ${returnCode}`,
                            referenceId: returnCode,
                            referenceType: 'sale_return',
                            unitPrice: item.unitPrice || 0,
                            userId: req.user?.userId || 'system',
                            userName: 'Hệ thống - Trả hàng (Auto)',
                        }
                    })
                }
            }
        } catch (restockErr) {
            console.error('Auto restock on return creation failed (non-fatal):', restockErr)
        }

        res.status(201).json({ success: true, data: returnOrder })
    } catch (err: any) {
        console.error('Create return error:', err)
        res.status(500).json({ success: false, error: 'Internal server error', detail: errorDetail(err) })
    }
})

// ═══════════════════════════════════════════════════════════════════════════════
//  PUT /api/returns/:id
// ═══════════════════════════════════════════════════════════════════════════════

router.put('/:id', authMiddleware, validate(UpdateReturnSchema), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const retId = String(req.params.id)
        const { status, notes, refundMethod, staffName } = req.body
        const data: any = {}
        if (status !== undefined) {
            data.status = status
            if (['approved', 'rejected'].includes(status)) data.processedAt = new Date()
            if (['refunded', 'exchanged'].includes(status)) {
                data.processedAt = data.processedAt || new Date()
                data.refundedAt = new Date()
            }
        }
        if (notes !== undefined) data.notes = notes
        if (refundMethod !== undefined) data.refundMethod = refundMethod
        if (staffName !== undefined) data.staffName = staffName

        const returnOrder = await prisma.returnOrder.update({
            where: { id: retId },
            data,
            include: { items: true },
        })
        res.json({ success: true, data: returnOrder })
    } catch (err) {
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ═══════════════════════════════════════════════════════════════════════════════
//  POST /api/returns/:id/process-refund
// ═══════════════════════════════════════════════════════════════════════════════

router.post('/:id/process-refund', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const retId = String(req.params.id)
        const { refundMethod, refundAmount, staffName } = req.body

        const returnOrder = await prisma.returnOrder.findUnique({
            where: { id: retId },
            include: { items: true },
        })
        if (!returnOrder) return res.status(404).json({ success: false, error: 'Không tìm thấy phiếu trả' })
        if (['refunded', 'exchanged', 'rejected'].includes(returnOrder.status)) {
            return res.status(400).json({ success: false, error: 'Phiếu này đã được xử lý' })
        }

        const amount = Number(refundAmount) || returnOrder.totalRefund

        // Update return order
        const updated = await prisma.returnOrder.update({
            where: { id: retId },
            data: {
                status: refundMethod === 'exchange' ? 'exchanged' : 'refunded',
                refundMethod: refundMethod || 'cash',
                refundAmount: amount,
                staffName: staffName || returnOrder.staffName,
                processedAt: returnOrder.processedAt || new Date(),
                refundedAt: new Date(),
            },
            include: { items: true },
        })

        // Create refund transaction record
        try {
            const refundReceiptNumber = await nextCode(prisma, 'refundReceiptCodeSeq', 'RF', 4, '-', 'Transaction', 'receiptNumber')
            await prisma.transaction.create({
                data: {
                    receiptNumber: refundReceiptNumber,
                    customerName: returnOrder.customerName,
                    customerPhone: returnOrder.customerPhone || null,
                    subtotal: -amount,
                    discount: 0,
                    tax: 0,
                    total: -amount,
                    amountReceived: 0,
                    status: 'completed',
                    createdBy: req.user?.userId || 'system',
                    createdByName: req.user?.email || 'Hệ thống',
                    notes: `Hoàn tiền phiếu ${returnOrder.code}`,
                },
            })
        } catch (_) {
            // Transaction creation is optional — don't fail the refund
        }

        // If original sale had debt → reduce customer debt
        if (returnOrder.transactionId) {
            try {
                const originalTx = await prisma.transaction.findUnique({
                    where: { id: returnOrder.transactionId },
                })
                if (originalTx && originalTx.customerId) {
                    const customer = await prisma.customer.findUnique({
                        where: { id: originalTx.customerId },
                    })
                    if (customer && customer.debt > 0) {
                        // Reduce debt by refund amount (max = current debt)
                        const debtReduction = Math.min(amount, customer.debt)
                        if (debtReduction > 0) {
                            await prisma.customer.update({
                                where: { id: customer.id },
                                data: { debt: { decrement: debtReduction } },
                            })
                            // Create DebtEntry for tracking
                            await prisma.debtEntry.create({
                                data: {
                                    customerId: customer.id,
                                    customerName: customer.name,
                                    phone: customer.phone || '',
                                    type: 'payment',
                                    amount: debtReduction,
                                    description: `Giảm nợ do trả hàng - phiếu ${returnOrder.code}`,
                                    balance: Math.max(0, customer.debt - debtReduction),
                                },
                            })
                            console.log(`💰 Debt reduced by ${debtReduction} for customer ${customer.name} (return ${returnOrder.code})`)
                        }
                    }
                }
            } catch (debtErr) {
                console.error('Debt reduction on return failed (non-fatal):', debtErr)
            }
        }

        res.json({ success: true, data: updated })
    } catch (err) {
        console.error('Process refund error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ═══════════════════════════════════════════════════════════════════════════════
//  POST /api/returns/:id/restock
// ═══════════════════════════════════════════════════════════════════════════════

router.post('/:id/restock', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const retId = String(req.params.id)
        const { itemIds } = req.body // Optional: specific items to restock

        const returnOrder = await prisma.returnOrder.findUnique({
            where: { id: retId },
            include: { items: true },
        })
        if (!returnOrder) return res.status(404).json({ success: false, error: 'Không tìm thấy phiếu trả' })

        // Determine which items to restock
        const toRestock = itemIds
            ? returnOrder.items.filter(i => itemIds.includes(i.id) && !i.restocked)
            : returnOrder.items.filter(i => !i.restocked && i.condition !== 'damaged' && i.condition !== 'defective')

        let restocked = 0
        for (const item of toRestock) {
            // Mark item as restocked
            await prisma.returnItem.update({
                where: { id: item.id },
                data: { restocked: true },
            })

            // Update product stock if productId exists
            if (item.productId) {
                try {
                    await prisma.product.update({
                        where: { id: item.productId },
                        data: { stock: { increment: item.quantity } },
                    })

                    // Create inventory transaction to show in stock card
                    await (prisma as any).inventoryTransaction.create({
                        data: {
                            type: 'import',
                            productId: item.productId,
                            productName: item.productName || 'Unknown',
                            productSku: item.sku || '',
                            quantity: item.quantity,
                            reason: `Nhập lại kho từ đơn trả hàng ${returnOrder.code}`,
                            referenceId: returnOrder.code,
                            referenceType: 'sale_return',
                            unitPrice: item.unitPrice || 0,
                            userId: req.user!.userId,
                            userName: 'Hệ thống - Trả hàng',
                        }
                    })
                } catch (e) {
                    // Product may not exist or other error
                    console.error('Error updating stock/transaction for returned item:', e)
                }
            }
            restocked++
        }

        res.json({ success: true, data: { restocked, total: returnOrder.items.length } })
    } catch (err) {
        console.error('Restock error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ═══════════════════════════════════════════════════════════════════════════════
//  DELETE /api/returns/:id
// ═══════════════════════════════════════════════════════════════════════════════

router.delete('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        await prisma.returnOrder.delete({ where: { id: String(req.params.id) } })
        res.json({ success: true })
    } catch (err) {
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

export default router
