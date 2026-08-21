import { Router, Response } from 'express'
import { errorDetail } from '../lib/errorResponse'
import { moTaLoi } from '../lib/gomLoi'
import { authMiddleware, getBranchFilter, AuthRequest, getBranchId } from '../middleware/auth'
import { validate } from '../middleware/validate'
import { requirePermission } from '../middleware/permissionMiddleware'
import { CreateReturnSchema, UpdateReturnSchema } from '../schemas'
import { nextCode } from '../lib/codeGenerator'
import { adjustSellableStock } from '../lib/warehouseHelper'
import { postReturnJournal } from '../lib/autoJournalPurchase'

const router = Router()

// ═══════════════════════════════════════════════════════════════════════════════
//  GET /api/returns
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/', authMiddleware, requirePermission('returns.view'), async (req: AuthRequest, res: Response) => {
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

router.get('/stats', authMiddleware, requirePermission('returns.view'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const returns = await prisma.returnOrder.findMany({ where: getBranchFilter(req as any) })
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

router.get('/analytics', authMiddleware, requirePermission('returns.view'), async (req: AuthRequest, res: Response) => {
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

router.post('/', authMiddleware, requirePermission('returns.create'), validate(CreateReturnSchema), async (req: AuthRequest, res: Response) => {
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
                            /* Trừ nợ và ghi DebtEntry phải CÙNG MỘT KHỐI (20/08/2026): quy ước dự
                             * án là mọi thay đổi Customer.debt đều có dòng sổ (xem memory
                             * debt-ledger-conventions). Tách hai lệnh thì lệnh sau hỏng là nợ giảm
                             * mà sổ không có dòng nào giải thích. `balance` cũng phải là số dư
                             * THẬT sau khi trừ, không phải số tính từ lần đọc trước. */
                            await prisma.$transaction(async (tx: any) => {
                                const sau = await tx.customer.update({
                                    where: { id: customer.id },
                                    data: { debt: { decrement: debtReduction } },
                                    select: { debt: true },
                                })
                                let soDu = Number(sau?.debt) || 0
                                if (soDu < 0) {
                                    await tx.customer.update({ where: { id: customer.id }, data: { debt: 0 } })
                                    soDu = 0
                                }
                                await tx.debtEntry.create({
                                    data: {
                                        customerId: customer.id,
                                        customerName: customer.name,
                                        phone: customer.phone || '',
                                        type: 'return',
                                        amount: debtReduction,
                                        description: `Trả hàng - phiếu ${returnCode} (${originalInvoice})`,
                                        balance: soDu,
                                    },
                                })
                            })
                            console.log(`📦 Debt reduced by ${debtReduction} for ${customer.name} (return ${returnCode})`)
                        }
                    }
                }
            } catch (debtErr) {
                /* Giữ "non-fatal" (phiếu trả vẫn phải lập được), nhưng nói RÕ hậu quả trong log để
                 * còn đi sửa tay: nợ khách chưa được giảm dù đã nhận hàng trả về. */
                console.error(`[tra-hang] KHÔNG giảm được nợ khách cho phiếu ${returnCode} — khách vẫn đang bị ghi nợ phần đã trả:`, moTaLoi(debtErr))
            }
        }

        // Auto-restock items
        // Ghi lại đúng những dòng THỰC SỰ nhập lại kho — bút toán Nợ 156/Có 632
        // chỉ được ghi cho phần hàng quay lại kho, hàng hỏng không tính.
        const dsNhapLai: Array<{ productId: string; quantity: number }> = []
        try {
            const storeSettings = await prisma.storeSettings.findFirst()
            if (storeSettings?.autoRestockOnReturn) {
                for (const item of returnOrder.items) {
                    if (!item.productId || item.condition === 'damaged' || item.condition === 'defective') continue
                    dsNhapLai.push({ productId: item.productId, quantity: item.quantity })

                    // Mark as restocked
                    await prisma.returnItem.update({
                        where: { id: item.id },
                        data: { restocked: true },
                    })

                    // Increment stock — mirror sang kho main của chi nhánh phiếu trả
                    await adjustSellableStock(prisma, item.productId, returnOrder.branchId, item.quantity)

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

        /* ─── Ghi sổ kế toán cho phiếu trả ──────────────────────────────────
         * Nợ 5212 / Có 111|131 (giảm doanh thu), Nợ 3331 (giảm VAT đầu ra theo
         * tỷ lệ thuế của hóa đơn gốc), Nợ 156 / Có 632 cho phần hàng nhập lại.
         * Trước đây trả hàng KHÔNG sinh bút toán nào: doanh thu trên sổ vẫn giữ
         * nguyên dù tiền đã trả lại khách, tồn kho sổ cũng không tăng lại. */
        try {
            let giaVonNhapLai = 0
            for (const d of dsNhapLai) {
                const p = await prisma.product.findUnique({ where: { id: d.productId }, select: { costPrice: true } })
                giaVonNhapLai += (p?.costPrice ?? 0) * (d.quantity ?? 0)
            }
            let vatTra = 0
            if (txId) {
                const goc = await prisma.transaction.findUnique({ where: { id: txId }, select: { tax: true, total: true } })
                if (goc && goc.total > 0 && goc.tax > 0) {
                    vatTra = Math.round((Number(totalRefund) || 0) * (goc.tax / goc.total))
                }
            }
            await postReturnJournal(prisma, {
                code: returnOrder.code,
                customerName: returnOrder.customerName,
                originalInvoice: returnOrder.originalInvoice,
                totalRefund: Number(totalRefund) || 0,
                refundMethod: returnOrder.refundMethod,
                costValue: giaVonNhapLai,
                vatAmount: vatTra,
                branchId: returnOrder.branchId,
                createdAt: returnOrder.createdAt,
            }, { branchId: returnOrder.branchId || null, userId: req.user?.userId || null })
        } catch (jErr) {
            console.error('Ghi sổ phiếu trả hàng thất bại (không chặn nghiệp vụ):', jErr)
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

router.put('/:id', authMiddleware, requirePermission('returns.edit', 'returns.create'), validate(UpdateReturnSchema), async (req: AuthRequest, res: Response) => {
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

router.post('/:id/process-refund', authMiddleware, requirePermission('returns.edit', 'returns.create'), async (req: AuthRequest, res: Response) => {
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
                            /* GIẢM NỢ và GHI SỔ phải CÙNG một transaction (21/08/2026).
                             * Trước đây là hai lệnh rời trên client toàn cục, không có `catch`:
                             * nếu `debtEntry.create` ném thì nợ ĐÃ bị trừ rồi mà không có dòng sổ,
                             * route trả 500 — người dùng bấm lại là **trừ nợ lần hai** cho cùng
                             * một phiếu trả hàng. Nay hỏng thì cả hai cùng lùi, bấm lại an toàn.
                             * Chỉ 2 lệnh nên transaction giữ kết nối rất ngắn (prod pool = 1). */
                            await prisma.$transaction(async (tx) => {
                                await tx.customer.update({
                                    where: { id: customer.id },
                                    data: { debt: { decrement: debtReduction } },
                                })
                                await tx.debtEntry.create({
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

router.post('/:id/restock', authMiddleware, requirePermission('returns.edit', 'returns.create'), async (req: AuthRequest, res: Response) => {
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
                    // mirror Product.stock + kho main của chi nhánh phiếu trả
                    await adjustSellableStock(prisma, item.productId, returnOrder.branchId, item.quantity)

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
//  POST /api/returns/:id/dispose — ghi nhận huỷ hàng trả không dùng lại được
//
//  Ngược với /restock: hàng hỏng, hết hạn, vỡ… KHÔNG nhập lại kho. Nhưng vẫn
//  phải ghi lại, vì hai lý do:
//   - kế toán cần biết giá trị hàng đã huỷ để đưa vào chi phí;
//   - không ghi thì phiếu trả nằm mãi ở trạng thái "chưa xử lý" và người sau
//     không biết lô hàng đó đi đâu.
//
//  Trước đây endpoint này KHÔNG tồn tại, mà giao diện lại bắt lỗi 404 rồi báo
//  "đã huỷ N sản phẩm" — người dùng tin là đã xử lý xong trong khi không có gì
//  được ghi. Đó là lý do phần này được làm thật thay vì gỡ nút đi.
// ═══════════════════════════════════════════════════════════════════════════════
router.post('/:id/dispose', authMiddleware, requirePermission('returns.edit', 'returns.create'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma! as any
        const retId = String(req.params.id)
        const { itemIds, reason } = req.body || {}

        const returnOrder = await prisma.returnOrder.findUnique({
            where: { id: retId },
            include: { items: true },
        })
        if (!returnOrder) return res.status(404).json({ success: false, error: 'Không tìm thấy phiếu trả' })

        /* Không đụng tới hàng ĐÃ nhập lại kho: huỷ một món đã nằm trong kho bán
         * mà không trừ tồn sẽ làm lệch kho. Muốn huỷ thì phải xuất huỷ từ kho,
         * không phải từ phiếu trả. */
        const canHuy = Array.isArray(itemIds) && itemIds.length > 0
            ? returnOrder.items.filter((i: any) => itemIds.includes(i.id) && !i.restocked && !i.disposed)
            : returnOrder.items.filter((i: any) => !i.restocked && !i.disposed &&
                (i.condition === 'damaged' || i.condition === 'defective'))

        const boQua = Array.isArray(itemIds) && itemIds.length > 0
            ? returnOrder.items.filter((i: any) => itemIds.includes(i.id) && i.restocked).length
            : 0

        let disposed = 0
        let giaTri = 0
        for (const item of canHuy) {
            await prisma.returnItem.update({ where: { id: item.id }, data: { disposed: true } })
            disposed++
            giaTri += (Number(item.quantity) || 0) * (Number(item.unitPrice) || 0)

            /* Ghi vào thẻ kho dạng bản ghi huỷ để truy vết được về sau. Hàng trả
             * chưa từng nhập lại kho nên KHÔNG trừ tồn — chỉ ghi dấu. */
            await prisma.inventoryTransaction.create({
                data: {
                    type: 'dispose',
                    productId: item.productId,
                    productName: item.productName || 'Unknown',
                    productSku: item.sku || '',
                    quantity: item.quantity,
                    reason: `Huỷ hàng trả không dùng lại được — phiếu ${returnOrder.code}${reason ? ` (${String(reason).slice(0, 120)})` : ''}`,
                    referenceId: returnOrder.code,
                    referenceType: 'sale_return_dispose',
                    unitPrice: item.unitPrice || 0,
                    userId: req.user!.userId,
                    userName: req.user?.email || 'Hệ thống - Trả hàng',
                },
            }).catch((e: any) => {
                // Thiếu bảng/cột ở store cũ không được phép nuốt mất việc đánh dấu huỷ
                console.error('Ghi thẻ kho khi huỷ hàng trả lỗi:', e?.message || e)
            })
        }

        res.json({
            success: true,
            data: {
                disposed,
                total: returnOrder.items.length,
                giaTriHuy: Math.round(giaTri),
                boQuaViDaNhapKho: boQua,
            },
        })
    } catch (err) {
        console.error('Dispose return items error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ═══════════════════════════════════════════════════════════════════════════════
//  DELETE /api/returns/:id
// ═══════════════════════════════════════════════════════════════════════════════

router.delete('/:id', authMiddleware, requirePermission('returns.delete', 'returns.edit'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        await prisma.returnOrder.delete({ where: { id: String(req.params.id) } })
        res.json({ success: true })
    } catch (err) {
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

export default router
