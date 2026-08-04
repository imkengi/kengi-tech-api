import { Router, Request, Response } from 'express'
import { authMiddleware, getBranchFilter, AuthRequest, getBranchId } from '../middleware/auth'
import { requireRole } from '../middleware/roleMiddleware'
import { nextCode, withCodeCollisionRetry } from '../lib/codeGenerator'
import { adjustSellableStock } from '../lib/warehouseHelper'

const router = Router()

// Allowed status transitions
// CỔNG KIỂM HÀNG (2026-08-04): hàng về KHÔNG ghi kho ngay. Phiếu vào "checking"
// (chờ kiểm), người kiểm CHẤP NHẬN (→received) thì kho mới được ghi; sai lệch
// thì TỪ CHỐI (→rejected, kèm lý do) — không đụng tồn kho. Đường tắt
// shipping→received cũ đã bỏ: mọi phiếu đều phải qua tay người kiểm.
const STATUS_TRANSITIONS: Record<string, string[]> = {
    draft: ['pending', 'cancelled'],
    pending: ['confirmed', 'cancelled'],
    // Hàng có thể về khi phiếu còn ở "confirmed" (NCC giao không báo) → cho vào
    // thẳng bàn kiểm, khỏi phải bấm shipping giả.
    confirmed: ['shipping', 'checking', 'cancelled'],
    shipping: ['checking', 'cancelled'],
    checking: ['received', 'rejected'],
    // NCC xử lý xong (giao bù, đổi hàng...) → kiểm lại; hoặc huỷ hẳn phiếu
    rejected: ['checking', 'cancelled'],
    received: [],
    cancelled: [],
}

// GET /api/purchase-orders/stats
router.get('/stats', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const all = await prisma.purchaseOrder.findMany({
            where: { ...getBranchFilter(req as any) },
            select: { status: true, totalAmount: true },
        })
        const byStatus: Record<string, number> = {}
        let totalValue = 0
        for (const o of all) { byStatus[o.status] = (byStatus[o.status] || 0) + 1; if (o.status !== 'cancelled') totalValue += o.totalAmount }
        res.json({ success: true, data: { total: all.length, byStatus, totalValue } })
    } catch { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// GET /api/purchase-orders
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { search, status } = req.query
        const where: any = { ...getBranchFilter(req as any) }
        if (status && status !== 'all') where.status = status
        if (search) {
            const q = String(search)
            where.OR = [
                { code: { contains: q } },
                { supplierName: { contains: q } },
            ]
        }
        const orders = await prisma.purchaseOrder.findMany({
            where,
            include: { items: true },
            orderBy: { createdAt: 'desc' },
        })
        res.json({ success: true, data: orders })
    } catch (err) {
        console.error('Get POs error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// GET /api/purchase-orders/:id
router.get('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const po = await prisma.purchaseOrder.findFirst({
            where: { id: String(req.params.id), ...getBranchFilter(req as any) },
            include: { items: true, supplier: true },
        })
        if (!po) return res.status(404).json({ success: false, error: 'Not found' })
        res.json({ success: true, data: po })
    } catch (err) {
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// POST /api/purchase-orders
router.post('/', authMiddleware, requireRole('admin', 'manager'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { supplierId, supplierName, items, notes, expectedDate } = req.body
        if (!supplierName?.trim()) return res.status(400).json({ success: false, error: 'Supplier name required' })
        if (!items?.length) return res.status(400).json({ success: false, error: 'At least one item required' })

        const branchId = getBranchId(req) || null
        const totalAmount = items.reduce((s: number, it: any) => s + (it.quantity || 0) * (it.unitPrice || 0), 0)

        const buildData = (code: string) => ({
            code,
            supplierId: supplierId || null,
            supplierName: supplierName.trim(),
            status: 'draft',
            totalAmount,
            notes,
            expectedDate: expectedDate ? new Date(expectedDate) : null,
            branchId,
            items: {
                create: items.map((it: any) => ({
                    productName: it.productName,
                    sku: it.sku || null,
                    quantity: it.quantity || 1,
                    unitPrice: it.unitPrice || 0,
                })),
            },
        })

        const po = await withCodeCollisionRetry(async () => {
            const code = await nextCode(prisma, 'purchaseOrderCodeSeq', 'PO', 3, '-', 'PurchaseOrder', 'code')
            return prisma.purchaseOrder.create({
                data: buildData(code) as any,
                include: { items: true },
            })
        })

        res.status(201).json({ success: true, data: po })
    } catch (err) {
        console.error('Create PO error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// PUT /api/purchase-orders/:id  — edit a PO (only when status is draft or pending)
router.put('/:id', authMiddleware, requireRole('admin', 'manager'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { supplierId, supplierName, items, notes, expectedDate } = req.body

        const existing = await prisma.purchaseOrder.findFirst({
            where: { id: String(req.params.id), ...getBranchFilter(req as any) },
        })
        if (!existing) return res.status(404).json({ success: false, error: 'Purchase order not found' })

        if (existing.status !== 'draft' && existing.status !== 'pending') {
            return res.status(409).json({
                success: false,
                error: `Không thể chỉnh sửa đơn ở trạng thái "${existing.status}". Chỉ có thể sửa đơn nháp hoặc chờ duyệt.`,
            })
        }

        const data: any = {}
        if (supplierId !== undefined) data.supplierId = supplierId || null
        if (supplierName !== undefined) {
            if (!supplierName?.trim()) return res.status(400).json({ success: false, error: 'Supplier name required' })
            data.supplierName = supplierName.trim()
        }
        if (notes !== undefined) data.notes = notes
        if (expectedDate !== undefined) data.expectedDate = expectedDate ? new Date(expectedDate) : null

        if (Array.isArray(items)) {
            if (items.length === 0) return res.status(400).json({ success: false, error: 'At least one item required' })
            data.totalAmount = items.reduce((s: number, it: any) => s + (it.quantity || 0) * (it.unitPrice || 0), 0)
        }

        const po: any = await prisma.$transaction(async (tx: any) => {
            if (Array.isArray(items)) {
                await tx.purchaseOrderItem.deleteMany({ where: { purchaseOrderId: existing.id } })
                await tx.purchaseOrderItem.createMany({
                    data: items.map((it: any) => ({
                        purchaseOrderId: existing.id,
                        productName: it.productName,
                        sku: it.sku || null,
                        quantity: it.quantity || 1,
                        unitPrice: it.unitPrice || 0,
                    })),
                })
            }
            return tx.purchaseOrder.update({
                where: { id: existing.id },
                data,
                include: { items: true },
            })
        })

        res.json({ success: true, data: po })
    } catch (err) {
        console.error('Update PO error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// PUT /api/purchase-orders/:id/status
router.put('/:id/status', authMiddleware, requireRole('admin', 'manager'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { status } = req.body
        const validStatuses = ['draft', 'pending', 'confirmed', 'shipping', 'checking', 'received', 'rejected', 'cancelled']
        if (!validStatuses.includes(status)) return res.status(400).json({ success: false, error: 'Invalid status' })

        // Fetch full PO before update (to check previous status and items)
        const existing: any = await prisma.purchaseOrder.findFirst({
            where: { id: String(req.params.id), ...getBranchFilter(req as any) },
            include: { items: true },
        })
        if (!existing) return res.status(404).json({ success: false, error: 'Purchase order not found' })

        // ─── State machine guard ──────────────────────────────────────────────
        if (status !== existing.status) {
            const allowed = STATUS_TRANSITIONS[existing.status] || []
            if (!allowed.includes(status)) {
                return res.status(409).json({
                    success: false,
                    error: `Không thể chuyển trạng thái từ "${existing.status}" sang "${status}".`,
                })
            }
        }

        // ─── Pre-resolve products for stock increment (used inside the txn) ───
        const isReceiving = status === 'received' && existing.status !== 'received'
        let stockUpdates: Array<{ productId: string; quantity: number }> = []
        if (isReceiving) {
            for (const item of existing.items) {
                let product: any = null
                if (item.sku?.trim()) {
                    product = await prisma.product.findFirst({
                        where: { sku: { equals: item.sku.trim(), mode: 'insensitive' } },
                    })
                }
                if (!product && item.productName?.trim()) {
                    product = await prisma.product.findFirst({
                        where: { name: { equals: item.productName.trim(), mode: 'insensitive' } },
                    })
                }
                if (product) {
                    stockUpdates.push({ productId: product.id, quantity: item.quantity })
                } else {
                    console.warn(`[PO received] Product not found: SKU=${item.sku} name=${item.productName}`)
                }
            }
        }

        const data: any = { status }
        if (status === 'received') {
            data.receivedDate = new Date()
            // Ghi dấu NGƯỜI KIỂM chấp nhận phiếu — received giờ chỉ tới được từ
            // "checking" nên đây chính là chữ ký của người duyệt ghi kho.
            data.checkedBy = req.user?.userId || null
            data.checkedByName = (req.user as any)?.email || (req.user as any)?.name || null
            data.checkedAt = new Date()
        }
        if (status === 'rejected') {
            data.rejectReason = String(req.body?.rejectReason || '').trim() || 'Không đạt kiểm hàng'
            data.checkedBy = req.user?.userId || null
            data.checkedByName = (req.user as any)?.email || (req.user as any)?.name || null
            data.checkedAt = new Date()
        }
        // Kiểm lại sau từ chối → xoá dấu vết lượt kiểm cũ
        if (status === 'checking') {
            data.rejectReason = null
        }

        // ─── Atomic update: PO status + all stock increments in one transaction ─
        const po: any = await prisma.$transaction(async (tx: any) => {
            const updated = await tx.purchaseOrder.update({
                where: { id: existing.id },
                data,
                include: { items: true },
            })
            for (const u of stockUpdates) {
                // Mirror sang kho main của chi nhánh PO (existing.branchId có thể null)
                await adjustSellableStock(tx, u.productId, existing.branchId, u.quantity)
            }
            return updated
        })

        if (isReceiving) {
            console.log(`[PO received] ${po.code} — stock updated for ${stockUpdates.length}/${existing.items.length} items`)
        }

        res.json({ success: true, data: po })
    } catch (err) {
        console.error('Update PO status error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})


// DELETE /api/purchase-orders/:id
router.delete('/:id', authMiddleware, requireRole('admin', 'manager'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const existing = await prisma.purchaseOrder.findFirst({
            where: { id: String(req.params.id), ...getBranchFilter(req as any) },
            select: { id: true },
        })
        if (!existing) return res.status(404).json({ success: false, error: 'Purchase order not found' })
        await prisma.purchaseOrder.delete({ where: { id: existing.id } })
        res.json({ success: true })
    } catch (err) {
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

export default router
