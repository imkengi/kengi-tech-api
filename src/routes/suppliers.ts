import { Router, Request, Response } from 'express'
import { authMiddleware, getBranchFilter, AuthRequest, getBranchId } from '../middleware/auth'
import { requireRole } from '../middleware/roleMiddleware'
import { validate } from '../middleware/validate'
import { CreateSupplierSchema, UpdateSupplierSchema } from '../schemas'
import { cacheGet, cacheSet, cacheDel } from '../lib/cache'
import { nextCode } from '../lib/codeGenerator'
import { emitEntityEvent } from '../lib/webhookDispatch'

const router = Router()

// Payload gọn cho webhook nhà cung cấp
const supplierPayload = (s: any) => ({
    id: s?.id, code: s?.code, name: s?.name, contactName: s?.contactName ?? null,
    phone: s?.phone ?? null, email: s?.email ?? null, payable: s?.payable ?? null, status: s?.status ?? null,
})

// GET /api/suppliers/stats
router.get('/stats', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const [total, active, inactive] = await Promise.all([
            prisma.supplier.count(),
            prisma.supplier.count({ where: { status: 'active' } }),
            prisma.supplier.count({ where: { status: { not: 'active' } } }),
        ])
        const suppliers = await prisma.supplier.findMany({
            include: { _count: { select: { purchaseOrders: true } } },
            orderBy: { purchaseOrders: { _count: 'desc' } },
            take: 1,
        })
        const topSupplier = suppliers[0] ? { name: suppliers[0].name, poCount: suppliers[0]._count.purchaseOrders } : null
        res.json({ success: true, data: { total, active, inactive, topSupplier } })
    } catch (err) {
        console.error('Supplier stats error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// GET /api/suppliers
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const schema = req.user?.storeSchema || 'default'
        const cacheKey = `${schema}:suppliers:${JSON.stringify(req.query)}`
        const cached = await cacheGet(cacheKey)
        if (cached) return res.json(cached)
        const prisma = req.storePrisma!
        const { search, status } = req.query
        const where: any = {}
        if (status && status !== 'all') where.status = status
        if (search) {
            const q = String(search)
            where.OR = [
                { name: { contains: q } },
                { code: { contains: q } },
                { contactName: { contains: q } },
                { phone: { contains: q } },
            ]
        }
        const suppliers = await prisma.supplier.findMany({ where, orderBy: { createdAt: 'desc' } })

        // Tính động cho MỖI NCC: số đơn, tổng giá trị nhập, và CÔNG NỢ phải trả hiện tại.
        // (Field totalOrders/totalValue lưu trên record NCC không được cập nhật → luôn 0;
        //  công nợ = số dư đầu kỳ (payable) + Σ phiếu nhập chưa trả (totalCost - paidAmount)
        //  + Σ PO chưa nhận. Khớp công thức debt-history ở endpoint chi tiết.)
        const supplierIds = suppliers.map(s => s.id)
        const agg: Record<string, { orders: number; value: number; debt: number }> = {}
        for (const s of suppliers) agg[s.id] = { orders: 0, value: 0, debt: (s as any).payable || 0 }
        if (supplierIds.length) {
            const [receipts, pos] = await Promise.all([
                prisma.importReceipt.findMany({
                    where: { supplierId: { in: supplierIds }, status: { notIn: ['cancelled', 'draft'] } },
                    select: { supplierId: true, totalCost: true, paidAmount: true, paymentStatus: true } as any,
                }),
                prisma.purchaseOrder.findMany({
                    where: { supplierId: { in: supplierIds } },
                    select: { supplierId: true, totalAmount: true, status: true },
                }),
            ])
            for (const ir of receipts as any[]) {
                const a = ir.supplierId && agg[ir.supplierId]; if (!a) continue
                a.orders++; a.value += ir.totalCost || 0
                const paid = ir.paymentStatus === 'paid' ? (ir.totalCost || 0) : Math.min(ir.totalCost || 0, ir.paidAmount || 0)
                a.debt += Math.max(0, (ir.totalCost || 0) - paid)
            }
            for (const po of pos as any[]) {
                const a = po.supplierId && agg[po.supplierId]; if (!a) continue
                a.orders++; a.value += po.totalAmount || 0
                // PO đã nhận coi như đã thanh toán; chưa nhận (và chưa hủy) còn nợ.
                if (po.status !== 'received' && po.status !== 'cancelled') a.debt += po.totalAmount || 0
            }
        }
        const enriched = suppliers.map(s => ({
            ...s,
            totalOrders: agg[s.id]?.orders ?? 0,
            totalValue: agg[s.id]?.value ?? 0,
            debt: Math.max(0, Math.round(agg[s.id]?.debt ?? 0)),
        }))

        const _response = { success: true, data: enriched }
        await cacheSet(cacheKey, _response, 300)
        res.json(_response)
    } catch (err) {
        console.error('Get suppliers error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// GET /api/suppliers/:id
router.get('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const supplier = await prisma.supplier.findUnique({
            where: { id: String(req.params.id) },
        })
        if (!supplier) return res.status(404).json({ success: false, error: 'Not found' })

        // Compute dynamic stats from BOTH PurchaseOrder AND ImportReceipt
        const [poCount, poSum, irCount, irSum] = await Promise.all([
            prisma.purchaseOrder.count({ where: { supplierId: supplier.id } }),
            prisma.purchaseOrder.aggregate({
                where: { supplierId: supplier.id },
                _sum: { totalAmount: true },
            }),
            prisma.importReceipt.count({ where: { supplierId: supplier.id } }),
            prisma.importReceipt.aggregate({
                where: { supplierId: supplier.id },
                _sum: { totalCost: true },
            }),
        ])

        const totalOrders = poCount + irCount
        const totalValue = (poSum._sum.totalAmount || 0) + (irSum._sum.totalCost || 0)

        res.json({
            success: true,
            data: {
                ...supplier,
                totalOrders: totalOrders || supplier.totalOrders,
                totalValue: totalValue || supplier.totalValue,
            },
        })
    } catch (err) {
        console.error('Get supplier by ID error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// GET /api/suppliers/:id/purchases — Purchase history from BOTH PurchaseOrder AND ImportReceipt
router.get('/:id/purchases', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const supplierId = String(req.params.id)

        // Fetch from both tables
        const [purchaseOrders, importReceipts] = await Promise.all([
            prisma.purchaseOrder.findMany({
                where: { supplierId },
                orderBy: { createdAt: 'desc' },
                take: 100,
            }),
            prisma.importReceipt.findMany({
                where: { supplierId },
                orderBy: { createdAt: 'desc' },
                take: 100,
            }),
        ])

        const purchases: any[] = []

        // Map PurchaseOrders
        for (const po of purchaseOrders) {
            purchases.push({
                id: po.id,
                code: po.code,
                date: (po.createdAt).toISOString(),
                items: 0,
                total: po.totalAmount || 0,
                status: po.status,
                source: 'purchase_order',
            })
        }

        // Map ImportReceipts
        for (const ir of importReceipts) {
            purchases.push({
                id: ir.id,
                code: ir.code,
                date: (ir.transactionDate || ir.createdAt).toISOString(),
                items: ir.totalItems || 0,
                total: ir.totalCost || 0,
                status: ir.status,
                source: 'import_receipt',
            })
        }

        // Sort newest first
        purchases.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

        res.json(purchases)
    } catch (err) {
        console.error('Get supplier purchases error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// GET /api/suppliers/:id/debt-history — Build debt movement history from BOTH PurchaseOrders AND ImportReceipts
router.get('/:id/debt-history', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const supplierId = String(req.params.id)

        const supplier = await prisma.supplier.findUnique({
            where: { id: supplierId },
            select: { name: true, totalValue: true, payable: true, createdAt: true },
        })
        if (!supplier) return res.status(404).json({ success: false, error: 'Supplier not found' })

        // Get from both tables and inventory returns
        const [purchaseOrders, importReceipts, inventoryReturns] = await Promise.all([
            prisma.purchaseOrder.findMany({
                where: { supplierId },
                orderBy: { createdAt: 'asc' },
            }),
            prisma.importReceipt.findMany({
                where: { supplierId },
                orderBy: { createdAt: 'asc' },
            }),
            (prisma as any).inventoryTransaction.findMany({
                where: { 
                    supplierId, 
                    type: 'export',
                    reason: { contains: 'Cấn trừ công nợ' }
                },
                orderBy: { createdAt: 'asc' },
            })
        ])

        interface DebtHistoryItem {
            id: string
            code: string
            date: string
            type: 'purchase' | 'payment' | 'return'
            label: string
            amount: number
            balance: number
        }

        const history: DebtHistoryItem[] = []

        // Process PurchaseOrders
        for (const po of purchaseOrders) {
            if (po.status === 'cancelled') continue // khớp với list (PO hủy không tính nợ)
            if (po.totalAmount > 0) {
                history.push({
                    id: po.id,
                    code: po.code,
                    date: po.createdAt.toISOString(),
                    type: 'purchase',
                    label: 'Đặt hàng NCC',
                    amount: po.totalAmount,
                    balance: 0,
                })
            }
            if (po.status === 'received' && po.totalAmount > 0) {
                history.push({
                    id: `${po.id}-pay`,
                    code: `TT-${po.code}`,
                    /**
                     * NGÀY CHỨNG TỪ, KHÔNG PHẢI `updatedAt`.
                     * `updatedAt` là @updatedAt — nó nhảy theo MỌI lần ghi vào
                     * bản ghi (sửa ghi chú, đợt đồng bộ KiotViet quét lại...),
                     * nên cả sổ thanh toán NCC bị dồn về ngày sửa gần nhất.
                     * Ngày đúng của khoản trả là ngày hàng về / ngày kiểm.
                     */
                    date: ((po as any).receivedDate || (po as any).checkedAt || po.createdAt).toISOString(),
                    type: 'payment',
                    label: 'Thanh toán PO',
                    amount: -po.totalAmount,
                    balance: 0,
                })
            }
        }

        // Process ImportReceipts
        for (const ir of importReceipts) {
            // Bỏ cả 'draft' cho KHỚP trang danh sách NCC (nó lọc
            // status notIn ['cancelled','draft']). Trước đây sổ chi tiết tính
            // thêm phiếu nháp nên tổng ở hai màn không bằng nhau.
            if (ir.status === 'cancelled' || ir.status === 'draft') continue
            if (ir.totalCost > 0) {
                history.push({
                    id: ir.id,
                    code: ir.code,
                    date: (ir.transactionDate || ir.createdAt).toISOString(),
                    type: 'purchase',
                    label: 'Nhập hàng',
                    amount: ir.totalCost,
                    balance: 0,
                })
            }
            // Real payment tracking: paidAmount on the receipt. Receipts created
            // before tracking default to paymentStatus 'paid' with paidAmount 0 —
            // treat those as fully settled.
            const paid = (ir as any).paymentStatus === 'paid'
                ? ir.totalCost
                : Math.min(ir.totalCost, (ir as any).paidAmount || 0)
            if (paid > 0) {
                history.push({
                    id: `${ir.id}-pay`,
                    code: `TT-${ir.code}`,
                    // Cùng NGÀY CHỨNG TỪ với dòng nhập hàng ở trên — không dùng
                    // `updatedAt` (xem ghi chú ở phần thanh toán PO)
                    date: (ir.transactionDate || ir.createdAt).toISOString(),
                    type: 'payment',
                    label: 'Thanh toán nhập hàng',
                    amount: -paid,
                    balance: 0,
                })
            }
        }

        // Process Inventory Returns
        for (const ret of inventoryReturns) {
            const val = Math.abs(ret.quantity) * (ret.unitPrice || 0)
            if (val > 0) {
                history.push({
                    id: ret.id,
                    code: ret.referenceId || `RET-${ret.id.substring(0, 4).toUpperCase()}`,
                    date: (ret.transactionDate || ret.createdAt).toISOString(),
                    type: 'return',
                    label: 'Trả hàng cấn trừ nợ',
                    amount: -val,
                    balance: 0,
                })
            }
        }

        // Sort and calculate running balance
        history.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())

        /**
         * SỐ DƯ ĐẦU KỲ — ĐỪNG "sửa" thành suy ngược như bên khách hàng.
         *
         * `Supplier.payable` là SỐ DƯ ĐẦU KỲ (nhập tay / import / đồng bộ),
         * KHÔNG phải số dư hiện tại — khác hẳn `Customer.debt`. Trang danh sách
         * NCC cũng tính: công nợ = payable + Σ phiếu nhập chưa trả + Σ PO chưa
         * nhận. Nên ở đây phải đẩy thẳng payable lên đầu rồi cộng tiếp phát
         * sinh thì dòng cuối mới khớp con số trang danh sách.
         */
        const openingPayable = (supplier as any).payable || 0
        if (Math.round(openingPayable) !== 0) {
            history.unshift({
                id: `${supplierId}-opening`,
                code: 'SDĐK',
                date: history[0]?.date || ((supplier as any).createdAt || new Date(0)).toISOString(),
                type: 'purchase',
                label: 'Số dư đầu kỳ',
                amount: openingPayable,
                balance: openingPayable,
            })
        }

        // KHÔNG kẹp về 0: số âm nghĩa là đã trả thừa cho NCC, kẹp đi là cả cột
        // luỹ kế hiện sai (đã dính đúng lỗi này bên công nợ khách hàng)
        let runningBalance = 0
        for (const item of history) {
            runningBalance += item.amount
            item.balance = runningBalance
        }

        // Return newest first
        history.reverse()

        res.json({ success: true, data: history })
    } catch (err) {
        console.error('Get supplier debt history error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// POST /api/suppliers
router.post('/', authMiddleware, requireRole('admin', 'manager'), validate(CreateSupplierSchema), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { name, contactName, phone, email, address, taxCode, status, notes, payable } = req.body
        if (!name?.trim()) return res.status(400).json({ success: false, error: 'Name required' })
        const code = await nextCode(prisma, 'supplierCodeSeq', 'NCC', 3, '-', 'Supplier', 'code')
        const supplier = await prisma.supplier.create({
            data: { code, name: name.trim(), contactName, phone, email, address, taxCode, status: status || 'active', notes, payable: payable ?? 0 },
        })
        cacheDel(`${req.user?.storeSchema || 'default'}:suppliers:*`).catch(() => { })
        res.status(201).json({ success: true, data: supplier })
        emitEntityEvent(prisma, 'supplier.created', supplierPayload(supplier), req.user?.storeSchema).catch(() => { })
    } catch (err) {
        console.error('Create supplier error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// PUT /api/suppliers/:id
router.put('/:id', authMiddleware, requireRole('admin', 'manager'), validate(UpdateSupplierSchema), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { name, contactName, phone, email, address, taxCode, status, notes, payable } = req.body
        const supplier = await prisma.supplier.update({
            where: { id: String(req.params.id) },
            data: { name, contactName, phone, email, address, taxCode, status, notes, payable },
        })
        res.json({ success: true, data: supplier })
        emitEntityEvent(prisma, 'supplier.updated', supplierPayload(supplier), req.user?.storeSchema).catch(() => { })
    } catch (err) {
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// DELETE /api/suppliers/:id
router.delete('/:id', authMiddleware, requireRole('admin', 'manager'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const poCount = await prisma.purchaseOrder.count({ where: { supplierId: String(req.params.id) } })
        if (poCount > 0) return res.status(400).json({ success: false, error: `Supplier has ${poCount} purchase orders` })
        const toDelete = await prisma.supplier.findUnique({ where: { id: String(req.params.id) } })
        await prisma.supplier.delete({ where: { id: String(req.params.id) } })
        res.json({ success: true })
        if (toDelete) emitEntityEvent(prisma, 'supplier.deleted', supplierPayload(toDelete), req.user?.storeSchema).catch(() => { })
    } catch (err) {
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

export default router
