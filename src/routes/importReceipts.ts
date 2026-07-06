import { Router, Request, Response } from 'express'
import { errorDetail } from '../lib/errorResponse'
import { authMiddleware, getBranchFilter, AuthRequest, getBranchId, canAccessBranch } from '../middleware/auth'
import { calculateCostPrice, getCostPriceMethod } from '../lib/costPrice'
import { nextCode } from '../lib/codeGenerator'
import { getOrCreateDefaultWarehouse, updateWarehouseStock, adjustSellableStock } from '../lib/warehouseHelper'
import { emitStockChanged, emitEntityEvent, webhooksActive } from '../lib/webhookDispatch'

// Payload phiếu nhập cho webhook (kèm thông tin NCC + chi tiết mặt hàng)
const importPayload = (r: any) => ({
    id: r?.id, code: r?.code,
    supplierId: r?.supplierId ?? null,
    supplierName: r?.supplierName ?? null,
    totalCost: r?.totalCost, totalItems: r?.totalItems,
    status: r?.status, paymentStatus: r?.paymentStatus, paidAmount: r?.paidAmount ?? null,
    dueDate: r?.dueDate ?? null, paymentTerm: r?.paymentTerm ?? null,
    branchId: r?.branchId ?? null, createdAt: r?.createdAt,
    items: Array.isArray(r?.items) ? r.items.map((it: any) => ({
        productId: it.productId, productName: it.productName, sku: it.productSku ?? null,
        quantity: it.quantity, costPrice: it.costPrice, lineTotal: it.total,
    })) : undefined,
})

const router = Router()

// GET /api/import-receipts
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const branchId = getBranchId(req)
        const {
            search, status,
            page = '1', pageSize = '20',
        } = req.query

        // Branch filter như các route khác: chi nhánh con chỉ thấy phiếu của mình
        const where: any = { ...getBranchFilter(req) }

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
                    importDate: (r as any).transactionDate
                        ? (r as any).transactionDate.toISOString().slice(0, 10)
                        : null,
                    transactionDate: (r as any).transactionDate?.toISOString() || r.createdAt.toISOString(),
                    dueDate: (r as any).dueDate ? (r as any).dueDate.toISOString().slice(0, 10) : null,
                    updatedAt: r.updatedAt.toISOString(),
                    // returnedQtyMap: productId -> returnedQuantity (stored directly on items)
                    returnedQtyMap: Object.fromEntries(
                        (r.items || []).map((i: any) => [i.productId, i.returnedQuantity ?? 0])
                    ),
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
router.get('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const branchId = getBranchId(req)
        const receipt = await prisma.importReceipt.findUnique({
            where: { id: String(req.params.id) },
            include: { items: true },
        })

        if (!receipt) {
            res.status(404).json({ success: false, error: 'Not found' })
            return
        }

        // Branch ownership: prevent reading another branch's receipt by id
        if (!canAccessBranch(req, receipt.branchId)) {
            res.status(404).json({ success: false, error: 'Not found' })
            return
        }

        // returnedQtyMap built from returnedQuantity field directly on items
        const returnedQtyMap: Record<string, number> = Object.fromEntries(
            receipt.items.map(i => [i.productId, (i as any).returnedQuantity ?? 0])
        )
        res.json({
            success: true,
            data: { ...receipt, createdAt: receipt.createdAt.toISOString(), updatedAt: receipt.updatedAt.toISOString(), returnedQtyMap },
        })
    } catch (err) {
        console.error('Get import receipt error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// POST /api/import-receipts
router.post('/', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const branchId = getBranchId(req)
        const { items, ...receiptData } = req.body
        const user = (req as any).user

        // Fetch actual user name from DB
        const dbUser = await prisma.user.findUnique({ where: { id: user.userId || user.id } })
        const userName = dbUser?.name || user.email || 'Unknown'

        // Generate code: NH-YYYYMMDD-XXX
        const today = new Date()
        const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '')
        const code = await nextCode(prisma, 'importReceiptNHCodeSeq', `NH-${dateStr}`, 3, '-', 'ImportReceipt', 'code')

        const totalCost = items.reduce((sum: number, item: any) => sum + (item.quantity * item.costPrice), 0)
        const totalItems = items.reduce((sum: number, item: any) => sum + item.quantity, 0)

        // Công nợ NCC: client gửi paidAmount (số đã trả NCC). Không gửi → coi như
        // trả đủ (giữ nguyên hành vi cũ, không phát sinh nợ ảo).
        const paidAmount = receiptData.paidAmount !== undefined && receiptData.paidAmount !== null
            ? Math.min(Math.max(0, Number(receiptData.paidAmount) || 0), totalCost)
            : totalCost
        const paymentStatus = paidAmount >= totalCost ? 'paid' : (paidAmount > 0 ? 'partial' : 'unpaid')

        const receipt = await prisma.importReceipt.create({ data: { code,
                branchId: branchId || null, // gắn chi nhánh của phiếu — thiếu sẽ khiến branch filter/canAccessBranch không có tác dụng
                supplierId: receiptData.supplierId || null,
                supplierName: receiptData.supplierName || null,
                totalCost,
                totalItems,
                status: receiptData.status || 'draft',
                paidAmount,
                paymentStatus,
                dueDate: receiptData.dueDate ? new Date(receiptData.dueDate) : null,
                paymentTerm: receiptData.paymentTerm || null,
                note: receiptData.note || null,
                userId: user.userId || user.id,
                userName,
                transactionDate: receiptData.importDate ? new Date(receiptData.importDate) : (receiptData.transactionDate ? new Date(receiptData.transactionDate) : null),
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
            // Đồng bộ WarehouseStock theo kho mặc định của chi nhánh phiếu —
            // POS check tồn theo WarehouseStock nên nhập hàng phải tăng cả kho này
            const defaultWarehouse = await getOrCreateDefaultWarehouse(prisma as any, branchId || null)
            const defaultWarehouseId: string | null = defaultWarehouse?.id || null
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
                const _u = await prisma.product.update({
                    where: { id: item.productId },
                    data: {
                        stock: { increment: item.quantity },
                        costPrice: newCostPrice,
                    },
                })

                // Tăng tồn theo kho (WarehouseStock) — best-effort như luồng inventory
                if (defaultWarehouseId) {
                    await updateWarehouseStock(prisma as any, defaultWarehouseId, item.productId, item.quantity)
                        .catch((err: any) => console.error(`[ImportReceipt] WarehouseStock increment failed for product ${item.productId}:`, err))
                }
                // Webhook đầu ra: stock.changed khi nhập hàng (gated + fire-and-forget)
                emitStockChanged(prisma as any, { productId: item.productId, sku: (_u as any).sku, name: (_u as any).name, branchId: branchId ?? null, delta: item.quantity, stock: (_u as any).stock, reason: 'import' }, req.user?.storeSchema).catch(() => { })

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
            data: {
                ...receipt,
                createdAt: receipt.createdAt.toISOString(),
                importDate: (receipt as any).transactionDate
                    ? (receipt as any).transactionDate.toISOString().slice(0, 10)
                    : null,
                updatedAt: receipt.updatedAt.toISOString(),
            },
        })

        // Webhook đầu ra: nhập hàng (post-response, enrich thông tin NCC — gated)
        if (webhooksActive()) {
            try {
                let payload: any = importPayload(receipt)
                if (receipt.supplierId) {
                    const sup = await prisma.supplier.findUnique({ where: { id: receipt.supplierId }, select: { code: true, phone: true, contactName: true } }).catch(() => null)
                    if (sup) payload = { ...payload, supplierCode: sup.code, supplierPhone: sup.phone, supplierContact: sup.contactName }
                }
                emitEntityEvent(prisma, 'import.created', payload, req.user?.storeSchema).catch(() => { })
            } catch { /* webhook không ảnh hưởng phiếu nhập */ }
        }
    } catch (err) {
        console.error('Create import receipt error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// PUT /api/import-receipts/:id/complete — Confirm receipt (draft → completed)
router.put('/:id/complete', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const branchId = getBranchId(req)
        const receipt = await prisma.importReceipt.findUnique({
            where: { id: String(req.params.id) },
            include: { items: true },
        })

        if (!receipt) { res.status(404).json({ success: false, error: 'Not found' }); return }
        if (receipt.status !== 'draft') { res.status(400).json({ success: false, error: 'Only drafts can be completed' }); return }

        // Claim trạng thái trước khi tăng kho (chống race): 2 request đồng thời cùng
        // đọc status='draft' sẽ tăng kho 2 lần. updateMany có điều kiện status='draft'
        // là atomic — chỉ 1 request claim được, request còn lại nhận count=0 → 409.
        const claimed = await prisma.importReceipt.updateMany({
            where: { id: String(req.params.id), status: 'draft' },
            data: { status: 'processing' },
        })
        if (claimed.count === 0) {
            res.status(409).json({ success: false, error: 'Phiếu đã được xử lý' })
            return
        }

        const user = (req as any).user
        const dbUser = await prisma.user.findUnique({ where: { id: user.userId || user.id } })
        const userName = dbUser?.name || user.email || 'Unknown'

        // Update stock for each item + log inventory transactions
        const method = await getCostPriceMethod(prisma as any)
        // Đồng bộ WarehouseStock theo kho mặc định của chi nhánh phiếu —
        // POS check tồn theo WarehouseStock nên nhập hàng phải tăng cả kho này
        const defaultWarehouse = await getOrCreateDefaultWarehouse(prisma as any, receipt.branchId || null)
        const defaultWarehouseId: string | null = defaultWarehouse?.id || null
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

            const _u = await prisma.product.update({
                where: { id: item.productId },
                data: {
                    stock: { increment: item.quantity },
                    costPrice: newCostPrice,
                },
            })
            // Tăng tồn theo kho (WarehouseStock) — best-effort như luồng inventory
            if (defaultWarehouseId) {
                await updateWarehouseStock(prisma as any, defaultWarehouseId, item.productId, item.quantity)
                    .catch((err: any) => console.error(`[ImportReceipt] WarehouseStock increment failed for product ${item.productId}:`, err))
            }
            // Webhook đầu ra: stock.changed khi nhập hàng (gated + fire-and-forget)
            emitStockChanged(prisma as any, { productId: item.productId, sku: (_u as any).sku, name: (_u as any).name, branchId: receipt.branchId ?? null, delta: item.quantity, stock: (_u as any).stock, reason: 'import' }, req.user?.storeSchema).catch(() => { })
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
            where: { id: String(req.params.id) },
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
router.put('/:id/cancel', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const branchId = getBranchId(req)
        const receipt = await prisma.importReceipt.findUnique({ where: { id: String(req.params.id) } })
        if (!receipt) { res.status(404).json({ success: false, error: 'Not found' }); return }
        if (receipt.status !== 'draft') { res.status(400).json({ success: false, error: 'Only drafts can be cancelled' }); return }

        const updated = await prisma.importReceipt.update({
            where: { id: String(req.params.id) },
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

// PUT /api/import-receipts/:id/pay — Trả tiền NCC cho phiếu nhập (một phần hoặc đủ)
// Body: { amount?: number } — không gửi amount = trả nốt phần còn lại.
router.put('/:id/pay', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const receipt = await prisma.importReceipt.findUnique({ where: { id: String(req.params.id) } })
        if (!receipt) { res.status(404).json({ success: false, error: 'Not found' }); return }
        if (!canAccessBranch(req, receipt.branchId)) { res.status(404).json({ success: false, error: 'Not found' }); return }
        if (receipt.status === 'cancelled') {
            res.status(400).json({ success: false, error: 'Phiếu đã hủy — không thể thanh toán' })
            return
        }

        const paid = (receipt as any).paymentStatus === 'paid' ? receipt.totalCost : ((receipt as any).paidAmount ?? 0)
        const remaining = Math.max(0, receipt.totalCost - paid)
        if (remaining <= 0) {
            res.status(400).json({ success: false, error: 'Phiếu đã thanh toán đủ' })
            return
        }

        const rawAmount = req.body?.amount
        const payAmount = rawAmount !== undefined && rawAmount !== null ? Number(rawAmount) : remaining
        if (!Number.isFinite(payAmount) || payAmount <= 0) {
            res.status(400).json({ success: false, error: 'Số tiền thanh toán không hợp lệ' })
            return
        }
        if (payAmount > remaining) {
            res.status(400).json({ success: false, error: `Số tiền vượt quá nợ còn lại (${remaining})` })
            return
        }

        // Chống race đọc-cộng-ghi: 2 request /pay đồng thời cùng đọc paidAmount cũ sẽ
        // mất 1 lần trả hoặc trả vượt totalCost. Gói vào $transaction, đọc lại phiếu
        // bên trong, kiểm tra paid + số trả <= totalCost, và ghi bằng khóa lạc quan
        // theo paidAmount cũ (updateMany có điều kiện) — request thua nhận 409.
        let newPaid = 0
        let updated: any
        try {
            updated = await prisma.$transaction(async (tx) => {
                const fresh = await tx.importReceipt.findUnique({ where: { id: receipt.id } })
                if (!fresh || fresh.status === 'cancelled') throw new Error('PAY_CONFLICT')
                const freshPaid = (fresh as any).paymentStatus === 'paid' ? fresh.totalCost : ((fresh as any).paidAmount ?? 0)
                if (freshPaid + payAmount > fresh.totalCost) throw new Error('PAY_CONFLICT')
                newPaid = freshPaid + payAmount
                const write = await tx.importReceipt.updateMany({
                    where: { id: fresh.id, paidAmount: (fresh as any).paidAmount } as any,
                    data: {
                        paidAmount: newPaid,
                        paymentStatus: newPaid >= fresh.totalCost ? 'paid' : 'partial',
                    } as any,
                })
                if (write.count === 0) throw new Error('PAY_CONFLICT')
                return tx.importReceipt.findUnique({ where: { id: fresh.id }, include: { items: true } })
            })
        } catch (e: any) {
            if (e?.message === 'PAY_CONFLICT') {
                res.status(409).json({ success: false, error: 'Phiếu vừa được thanh toán bởi thao tác khác — vui lòng tải lại và thử lại' })
                return
            }
            throw e
        }
        if (!updated) { res.status(404).json({ success: false, error: 'Not found' }); return }

        // Mirror vào sổ chi (Expense) để sổ quỹ phản ánh dòng tiền ra — best-effort.
        // category 'supplier_payment' → auto-journal ghi Nợ 331/Có 11x (giảm phải
        // trả), KHÔNG vào chi phí 6428. paidBy quyết định vế Có 111 (cash) hay 112.
        const payBy = String(req.body?.paidBy || req.body?.method || 'cash').toLowerCase()
        await (prisma as any).expense.create({
            data: {
                description: `Trả tiền NCC ${receipt.supplierName || ''} - phiếu nhập ${receipt.code}`.trim(),
                amount: payAmount,
                category: 'supplier_payment',
                paidBy: payBy === 'bank' || payBy === 'transfer' ? 'bank' : 'cash',
                date: new Date(),
                branchId: receipt.branchId || null,
            },
        }).catch((e: any) => console.error('Expense mirror failed:', e.message))

        // Audit log (best-effort)
        try {
            const user = await prisma.user.findUnique({ where: { id: req.user!.userId } })
            await prisma.auditLog.create({
                data: {
                    userId: req.user!.userId,
                    userName: user?.name || 'Admin',
                    action: 'pay_supplier',
                    entity: 'ImportReceipt',
                    entityId: receipt.id,
                    details: JSON.stringify({ code: receipt.code, amount: payAmount, remaining: receipt.totalCost - newPaid }),
                },
            })
        } catch { }

        res.json({
            success: true,
            data: { ...updated, createdAt: updated.createdAt.toISOString(), updatedAt: updated.updatedAt.toISOString() },
        })
    } catch (err) {
        console.error('Pay import receipt error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// PUT /api/import-receipts/:id/return — Return imported goods to supplier
router.put('/:id/return', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const receipt = await prisma.importReceipt.findUnique({
            where: { id: String(req.params.id) },
            include: { items: true },
        })
        if (!receipt) { res.status(404).json({ success: false, error: 'Not found' }); return }
        if (receipt.status !== 'completed' && receipt.status !== 'partial_return') {
            res.status(400).json({ success: false, error: 'Chỉ có thể trả hàng phiếu đã hoàn thành' }); return
        }

        const user = (req as any).user
        const dbUser = await prisma.user.findUnique({ where: { id: user.userId || user.id } })
        const userName = dbUser?.name || user.email || 'Unknown'

        const returnItems: { productId: string; quantity: number; reason?: string }[] = req.body.items
        if (!returnItems || returnItems.length === 0) {
            res.status(400).json({ success: false, error: 'Vui lòng chọn sản phẩm cần trả' }); return
        }

        let totalReturnCost = 0
        let totalReturnQty = 0

        // ── Validate & process each return item ──────────────────────────────
        for (const ri of returnItems) {
            const receiptItem = receipt.items.find(i => i.productId === ri.productId)
            if (!receiptItem) {
                res.status(400).json({ success: false, error: `Sản phẩm ${ri.productId} không có trong phiếu` }); return
            }

            // returnedQuantity is tracked directly on the item (not via inventoryTransaction)
            const alreadyReturned = (receiptItem as any).returnedQuantity ?? 0
            const canReturn = receiptItem.quantity - alreadyReturned

            if (ri.quantity <= 0) {
                res.status(400).json({ success: false, error: `Số lượng trả phải lớn hơn 0 cho ${receiptItem.productName}` }); return
            }
            if (ri.quantity > canReturn) {
                res.status(400).json({
                    success: false,
                    error: `${receiptItem.productName}: chỉ còn ${canReturn} SP có thể trả (đã trả ${alreadyReturned}/${receiptItem.quantity})`
                }); return
            }
        }

        // ── Generate unique batchId for this return session ──────────────────
        const now = new Date()
        const batchId = `RETURN-${now.toISOString().slice(0, 10).replace(/-/g, '')}-${Date.now().toString(36).toUpperCase()}`

        // ── All valid — execute updates ───────────────────────────────────────
        for (const ri of returnItems) {
            const receiptItem = receipt.items.find(i => i.productId === ri.productId)!

            // 1. Increment returnedQuantity on the receipt item
            await (prisma as any).importReceiptItem.update({
                where: { id: receiptItem.id },
                data: { returnedQuantity: { increment: ri.quantity } },
            })

            // 2. Decrement product stock (mirror sang kho main của chi nhánh phiếu)
            await adjustSellableStock(prisma, ri.productId, receipt.branchId, -ri.quantity)

            totalReturnCost += receiptItem.costPrice * ri.quantity
            totalReturnQty += ri.quantity

            // 3. Log inventory transaction — note stores batchId for later undo
            await prisma.inventoryTransaction.create({
                data: {
                    type: 'export',
                    productId: ri.productId,
                    productName: receiptItem.productName,
                    productSku: receiptItem.productSku,
                    quantity: -ri.quantity,
                    reason: ri.reason || `Trả hàng nhập theo phiếu ${receipt.code}`,
                    note: batchId,  // ← batch identifier for targeted undo
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

        // ── Determine new status based on accumulated returnedQuantity ────────
        // Re-fetch items to get updated returnedQuantity values
        const updatedItems = await (prisma as any).importReceiptItem.findMany({
            where: { receiptId: receipt.id },
        })
        const totalOriginalQty = updatedItems.reduce((s: number, i: any) => s + i.quantity, 0)
        const totalReturnedQty = updatedItems.reduce((s: number, i: any) => s + (i.returnedQuantity ?? 0), 0)
        const isFullReturn = totalReturnedQty >= totalOriginalQty
        const newStatus = isFullReturn ? 'returned' : 'partial_return'

        const updated = await prisma.importReceipt.update({
            where: { id: String(req.params.id) },
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
                batchId,
            },
        })
    } catch (err: any) {
        console.error('Return import receipt error:', err?.message || err)
        res.status(500).json({ success: false, error: 'Internal server error', detail: errorDetail(err) })
    }
})

// GET /api/import-receipts/:id/return-history — List all return batches for a receipt
router.get('/:id/return-history', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const receipt = await prisma.importReceipt.findUnique({
            where: { id: String(req.params.id) },
            include: { items: true },
        })
        if (!receipt) { res.status(404).json({ success: false, error: 'Not found' }); return }

        // Get all return transactions, grouped by batchId (stored in note field)
        const txns = await prisma.inventoryTransaction.findMany({
            where: { referenceId: receipt.code, referenceType: 'import_return' },
            orderBy: { createdAt: 'asc' },
        })

        // Group by batchId (note field)
        const batchMap = new Map<string, any>()
        for (const txn of txns) {
            const batchId = txn.note || 'LEGACY'
            if (!batchMap.has(batchId)) {
                batchMap.set(batchId, {
                    batchId,
                    createdAt: txn.createdAt.toISOString(),
                    userName: txn.userName,
                    totalQty: 0,
                    totalCost: 0,
                    items: [],
                })
            }
            const batch = batchMap.get(batchId)!
            const qty = Math.abs(txn.quantity)
            batch.totalQty += qty
            batch.totalCost += qty * (txn.unitPrice || 0)
            batch.items.push({
                productId: txn.productId,
                productName: txn.productName,
                productSku: txn.productSku,
                quantity: qty,
                unitPrice: txn.unitPrice || 0,
            })
        }

        res.json({
            success: true,
            data: Array.from(batchMap.values()).reverse(), // newest first
        })
    } catch (err: any) {
        console.error('Return history error:', err?.message || err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// DELETE /api/import-receipts/:id/return/:batchId — Undo a specific return batch
router.delete('/:id/return/:batchId', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const batchId = String(req.params.batchId)

        const receipt = await prisma.importReceipt.findUnique({
            where: { id: String(req.params.id) },
            include: { items: true },
        })
        if (!receipt) { res.status(404).json({ success: false, error: 'Not found' }); return }

        // Find only this batch's transactions (note = batchId)
        const batchTxns = await prisma.inventoryTransaction.findMany({
            where: { referenceId: receipt.code, referenceType: 'import_return', note: batchId },
        })
        if (batchTxns.length === 0) {
            res.status(404).json({ success: false, error: `Không tìm thấy phiếu trả ${batchId}` }); return
        }

        // 1. Restore stock for each product in this batch
        for (const txn of batchTxns) {
            if (!txn.productId) continue
            const returnedQty = Math.abs(txn.quantity)
            await adjustSellableStock(prisma, txn.productId, receipt.branchId, returnedQty)

            // 2. Decrement returnedQuantity on the receipt item
            const receiptItem = receipt.items.find(i => i.productId === txn.productId)
            if (receiptItem) {
                const current = (receiptItem as any).returnedQuantity ?? 0
                await (prisma as any).importReceiptItem.update({
                    where: { id: receiptItem.id },
                    data: { returnedQuantity: Math.max(0, current - returnedQty) },
                })
            }
        }

        // 3. Delete only this batch's transactions
        await prisma.inventoryTransaction.deleteMany({
            where: { referenceId: receipt.code, referenceType: 'import_return', note: batchId },
        })

        // 4. Re-fetch items to recalculate status
        const updatedItems = await (prisma as any).importReceiptItem.findMany({
            where: { receiptId: receipt.id },
        })
        const totalOriginalQty = updatedItems.reduce((s: number, i: any) => s + i.quantity, 0)
        const totalReturnedQty = updatedItems.reduce((s: number, i: any) => s + (i.returnedQuantity ?? 0), 0)

        let newStatus: string
        if (totalReturnedQty <= 0) newStatus = 'completed'
        else if (totalReturnedQty >= totalOriginalQty) newStatus = 'returned'
        else newStatus = 'partial_return'

        const updated = await prisma.importReceipt.update({
            where: { id: String(req.params.id) },
            data: { status: newStatus },
            include: { items: true },
        })

        // Build new returnedQtyMap
        const returnedQtyMap = Object.fromEntries(
            (updated.items || []).map((i: any) => [i.productId, i.returnedQuantity ?? 0])
        )

        res.json({
            success: true,
            message: `Đã hủy phiếu trả ${batchId} thành công`,
            data: {
                ...updated,
                createdAt: updated.createdAt.toISOString(),
                updatedAt: updated.updatedAt.toISOString(),
                returnedQtyMap,
            },
        })
    } catch (err: any) {
        console.error('Undo batch return error:', err?.message || err)
        res.status(500).json({ success: false, error: 'Internal server error', detail: errorDetail(err) })
    }
})

// DELETE /api/import-receipts/:id — delete any receipt, reverse stock if completed

router.delete('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const branchId = getBranchId(req)
        const receipt = await prisma.importReceipt.findUnique({
            where: { id: String(req.params.id) },
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
                        const recalced = Math.round(totalValue / newStock)
                        // Giá vốn không được ÂM — dữ liệu lịch sử thiếu/lệch (totalValue < 0
                        // hoặc kết quả không hợp lệ) thì giữ nguyên giá vốn hiện tại
                        newCostPrice = Number.isFinite(recalced) ? Math.max(0, recalced) : product.costPrice
                    }
                    // Trừ tồn qua helper để mirror sang kho main; costPrice cập nhật riêng.
                    // delta = newStock - product.stock (âm khi thật sự trừ; 0 nếu đã chạm sàn 0)
                    await adjustSellableStock(prisma, item.productId, receipt.branchId, newStock - product.stock)
                    if (newStock > 0 && newCostPrice !== product.costPrice) {
                        await prisma.product.update({
                            where: { id: item.productId },
                            data: { costPrice: newCostPrice },
                        })
                    }
                }
            }

            // Delete related inventory transactions
            await prisma.inventoryTransaction.deleteMany({
                where: { referenceId: receipt.code, referenceType: 'import_receipt' },
            })
        }

        // Delete the receipt (cascade deletes items)
        await prisma.importReceipt.delete({ where: { id: String(req.params.id) } })
        res.json({ success: true, message: 'Deleted' })
    } catch (err: any) {
        console.error('Delete import receipt error:', err?.message || err)
        console.error('Delete import receipt stack:', err?.stack)
        res.status(500).json({ success: false, error: 'Internal server error', detail: errorDetail(err) })
    }
})

export default router
