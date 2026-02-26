import { Router, Request, Response } from 'express'
import prisma from '../lib/prisma'
import { authMiddleware } from '../middleware/auth'

const router = Router()

// GET /api/sales-orders — List with filters
router.get('/', authMiddleware, async (req: Request, res: Response) => {
    try {
        const { status, salesUserId } = req.query
        const where: any = {}
        if (status && status !== 'all') where.status = String(status)
        if (salesUserId) where.salesUserId = String(salesUserId)

        const orders = await prisma.salesOrder.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            include: {
                salesUser: { select: { id: true, name: true, code: true, avatar: true } },
                customer: { select: { id: true, name: true, code: true, phone: true } },
                items: true,
            },
        })
        res.json({ success: true, data: orders })
    } catch (err) {
        console.error('Get sales orders error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// GET /api/sales-orders/pending/count — Badge count for POS
router.get('/pending/count', authMiddleware, async (_req: Request, res: Response) => {
    try {
        const count = await prisma.salesOrder.count({ where: { status: 'pending' } })
        res.json({ success: true, data: { count } })
    } catch (err) {
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// POST /api/sales-orders — Sales staff creates new order
router.post('/', authMiddleware, async (req: Request, res: Response) => {
    try {
        const currentUser = (req as any).user
        const { customerId, customerName, note, items, discount } = req.body

        if (!items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ success: false, error: 'Cần ít nhất 1 sản phẩm' })
        }

        // Generate order number
        const count = await prisma.salesOrder.count()
        const orderNumber = `SO-${String(count + 1).padStart(4, '0')}`

        // Calculate totals
        const orderItems = items.map((item: any) => ({
            productId: item.productId,
            productName: item.productName,
            sku: item.sku || '',
            quantity: Number(item.quantity) || 1,
            unitPrice: Number(item.unitPrice) || 0,
            lineTotal: (Number(item.quantity) || 1) * (Number(item.unitPrice) || 0),
        }))

        const subtotal = orderItems.reduce((s: number, i: any) => s + i.lineTotal, 0)
        const discountAmount = Number(discount) || 0
        const total = subtotal - discountAmount

        const order = await prisma.salesOrder.create({
            data: {
                orderNumber,
                salesUserId: currentUser.id,
                customerId: customerId || null,
                customerName: customerName || null,
                note: note?.trim() || null,
                subtotal,
                discount: discountAmount,
                total,
                items: {
                    create: orderItems,
                },
            },
            include: {
                salesUser: { select: { id: true, name: true, code: true } },
                items: true,
            },
        })

        res.status(201).json({ success: true, data: order })
    } catch (err) {
        console.error('Create sales order error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// PUT /api/sales-orders/:id/status — Update order status
router.put('/:id/status', authMiddleware, async (req: Request, res: Response) => {
    try {
        const { status } = req.body
        const validStatuses = ['pending', 'processing', 'completed', 'cancelled']
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ success: false, error: 'Invalid status' })
        }

        const order = await prisma.salesOrder.update({
            where: { id: req.params.id },
            data: { status },
            include: {
                salesUser: { select: { id: true, name: true, code: true } },
                items: true,
            },
        })
        res.json({ success: true, data: order })
    } catch (err) {
        console.error('Update sales order status error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// DELETE /api/sales-orders/:id — Delete order (only pending)
router.delete('/:id', authMiddleware, async (req: Request, res: Response) => {
    try {
        const order = await prisma.salesOrder.findUnique({ where: { id: req.params.id } })
        if (!order) return res.status(404).json({ success: false, error: 'Not found' })
        if (order.status !== 'pending' && order.status !== 'cancelled') {
            return res.status(400).json({ success: false, error: 'Chỉ xóa được đơn pending/cancelled' })
        }
        await prisma.salesOrder.delete({ where: { id: req.params.id } })
        res.json({ success: true })
    } catch (err) {
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

export default router
