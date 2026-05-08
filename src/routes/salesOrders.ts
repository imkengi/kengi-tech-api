import { Router, Response } from 'express'
import { authMiddleware, AuthRequest, getBranchFilter } from '../middleware/auth'
import { requireRole } from '../middleware/roleMiddleware'
import { cacheDel } from '../lib/cache'

const router = Router()

const VALID_STATUSES = ['pending', 'processing', 'completed', 'cancelled'] as const
type Status = typeof VALID_STATUSES[number]

// Roles that can process / view all sales orders
const PROCESSOR_ROLES = ['admin', 'manager', 'cashier', 'superadmin']

const ORDER_INCLUDE = {
    salesUser: { select: { id: true, name: true, code: true, avatar: true, role: true } },
    customer: { select: { id: true, name: true, code: true, phone: true } },
    items: true,
}

function isProcessor(role?: string): boolean {
    return !!role && PROCESSOR_ROLES.includes(role)
}

function invalidateCache(req: AuthRequest) {
    const schema = req.user?.storeSchema || 'default'
    cacheDel(`${schema}:salesOrders:*`).catch(() => { })
}

// ─── GET /api/sales-orders/pending-count ────────────────────────────────────
// Badge count for POS — must be declared BEFORE /:id to avoid shadowing
router.get('/pending-count', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const where: any = { ...getBranchFilter(req), status: 'pending' }
        if (!isProcessor(req.user?.role)) where.salesUserId = req.user!.userId

        const count = await prisma.salesOrder.count({ where })
        res.json({ success: true, data: { count } })
    } catch (err) {
        console.error('Get pending sales-order count error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// Backwards-compat alias used by existing frontend
router.get('/pending/count', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const where: any = { ...getBranchFilter(req), status: 'pending' }
        if (!isProcessor(req.user?.role)) where.salesUserId = req.user!.userId
        const count = await prisma.salesOrder.count({ where })
        res.json({ success: true, data: { count } })
    } catch (err) {
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ─── GET /api/sales-orders ──────────────────────────────────────────────────
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { status, salesUserId, search, page = '1', pageSize = '20' } = req.query

        const where: any = { ...getBranchFilter(req) }
        if (status && status !== 'all') {
            if (!VALID_STATUSES.includes(status as Status)) {
                return res.status(400).json({ success: false, error: 'Invalid status' })
            }
            where.status = String(status)
        }

        // Sales role only sees their own orders, even if they pass salesUserId
        if (!isProcessor(req.user?.role)) {
            where.salesUserId = req.user!.userId
        } else if (salesUserId) {
            where.salesUserId = String(salesUserId)
        }

        if (search) {
            where.OR = [
                { orderNumber: { contains: String(search) } },
                { customerName: { contains: String(search) } },
                { note: { contains: String(search) } },
            ]
        }

        const pageNum = Math.max(1, parseInt(String(page)))
        const size = Math.max(1, Math.min(100, parseInt(String(pageSize))))
        const skip = (pageNum - 1) * size

        const [total, orders] = await Promise.all([
            prisma.salesOrder.count({ where }),
            prisma.salesOrder.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                include: ORDER_INCLUDE,
                skip,
                take: size,
            }),
        ])

        res.json({
            success: true,
            data: {
                items: orders,
                total,
                page: pageNum,
                pageSize: size,
                totalPages: Math.ceil(total / size),
            },
        })
    } catch (err) {
        console.error('Get sales orders error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ─── GET /api/sales-orders/:id ──────────────────────────────────────────────
router.get('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const order = await prisma.salesOrder.findUnique({
            where: { id: String(req.params.id) },
            include: ORDER_INCLUDE,
        })
        if (!order) return res.status(404).json({ success: false, error: 'Không tìm thấy đơn hàng' })

        // Sales role can only view their own orders
        if (!isProcessor(req.user?.role) && order.salesUserId !== req.user!.userId) {
            return res.status(403).json({ success: false, error: 'Bạn không có quyền xem đơn hàng này' })
        }

        res.json({ success: true, data: order })
    } catch (err) {
        console.error('Get sales order detail error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ─── POST /api/sales-orders ─────────────────────────────────────────────────
router.post('/', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { customerId, customerName, note, items, discount } = req.body

        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ success: false, error: 'Cần ít nhất 1 sản phẩm' })
        }

        const orderItems = items.map((item: any) => {
            const quantity = Number(item.quantity) || 1
            const unitPrice = Number(item.unitPrice) || 0
            return {
                productId: String(item.productId),
                productName: String(item.productName || ''),
                sku: String(item.sku || ''),
                quantity,
                unitPrice,
                lineTotal: quantity * unitPrice,
            }
        })

        const subtotal = orderItems.reduce((s, i) => s + i.lineTotal, 0)
        const discountAmount = Math.max(0, Number(discount) || 0)
        const total = Math.max(0, subtotal - discountAmount)

        // Generate sequential order number
        const count = await prisma.salesOrder.count()
        const orderNumber = `SO-${String(count + 1).padStart(6, '0')}`

        const order = await prisma.salesOrder.create({
            data: {
                orderNumber,
                status: 'pending',
                salesUserId: req.user!.userId,
                customerId: customerId || null,
                customerName: customerName?.trim() || null,
                note: note?.trim() || null,
                subtotal,
                discount: discountAmount,
                total,
                branchId: req.user?.branchId || null,
                items: { create: orderItems },
            },
            include: ORDER_INCLUDE,
        })

        invalidateCache(req)
        res.status(201).json({ success: true, data: order })
    } catch (err) {
        console.error('Create sales order error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ─── PATCH /api/sales-orders/:id/process ────────────────────────────────────
// Admin / Manager / Cashier processes a pending order: pending → processing → completed
router.patch(
    '/:id/process',
    authMiddleware,
    requireRole('admin', 'manager', 'cashier', 'superadmin'),
    async (req: AuthRequest, res: Response) => {
        try {
            const prisma = req.storePrisma!
            const { status } = req.body as { status?: Status }

            const targetStatus: Status = status && VALID_STATUSES.includes(status) ? status : 'processing'
            if (targetStatus === 'cancelled') {
                return res.status(400).json({ success: false, error: 'Dùng endpoint /cancel để hủy đơn' })
            }

            const existing = await prisma.salesOrder.findUnique({ where: { id: String(req.params.id) } })
            if (!existing) return res.status(404).json({ success: false, error: 'Không tìm thấy đơn hàng' })
            if (existing.status === 'cancelled') {
                return res.status(400).json({ success: false, error: 'Đơn đã bị hủy, không thể xử lý' })
            }
            if (existing.status === 'completed') {
                return res.status(400).json({ success: false, error: 'Đơn đã hoàn tất' })
            }

            const order = await prisma.salesOrder.update({
                where: { id: String(req.params.id) },
                data: {
                    status: targetStatus,
                    processedById: req.user!.userId,
                    processedAt: new Date(),
                },
                include: ORDER_INCLUDE,
            })

            invalidateCache(req)
            res.json({ success: true, data: order })
        } catch (err) {
            console.error('Process sales order error:', err)
            res.status(500).json({ success: false, error: 'Internal server error' })
        }
    }
)

// ─── PATCH /api/sales-orders/:id/cancel ─────────────────────────────────────
router.patch('/:id/cancel', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { reason } = req.body || {}

        const existing = await prisma.salesOrder.findUnique({ where: { id: String(req.params.id) } })
        if (!existing) return res.status(404).json({ success: false, error: 'Không tìm thấy đơn hàng' })

        // Sales: can only cancel own pending order. Processors: can cancel pending or processing.
        const isOwner = existing.salesUserId === req.user!.userId
        const processor = isProcessor(req.user?.role)
        if (!processor && !isOwner) {
            return res.status(403).json({ success: false, error: 'Bạn không có quyền hủy đơn này' })
        }
        if (existing.status === 'completed') {
            return res.status(400).json({ success: false, error: 'Đơn đã hoàn tất, không thể hủy' })
        }
        if (existing.status === 'cancelled') {
            return res.status(400).json({ success: false, error: 'Đơn đã bị hủy' })
        }
        if (!processor && existing.status !== 'pending') {
            return res.status(400).json({ success: false, error: 'Chỉ hủy được đơn ở trạng thái pending' })
        }

        const order = await prisma.salesOrder.update({
            where: { id: String(req.params.id) },
            data: {
                status: 'cancelled',
                cancelReason: reason?.toString().trim() || null,
                processedById: req.user!.userId,
                processedAt: new Date(),
            },
            include: ORDER_INCLUDE,
        })

        invalidateCache(req)
        res.json({ success: true, data: order })
    } catch (err) {
        console.error('Cancel sales order error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

export default router
