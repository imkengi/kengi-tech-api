import { Router, Request, Response } from 'express'
import prisma from '../lib/prisma'
import { authMiddleware } from '../middleware/auth'

const router = Router()

// GET /api/purchase-orders
router.get('/', authMiddleware, async (req: Request, res: Response) => {
    try {
        const { search, status } = req.query
        const where: any = {}
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
router.get('/:id', authMiddleware, async (req: Request, res: Response) => {
    try {
        const po = await prisma.purchaseOrder.findUnique({
            where: { id: req.params.id },
            include: { items: true, supplier: true },
        })
        if (!po) return res.status(404).json({ success: false, error: 'Not found' })
        res.json({ success: true, data: po })
    } catch (err) {
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// POST /api/purchase-orders
router.post('/', authMiddleware, async (req: Request, res: Response) => {
    try {
        const { supplierId, supplierName, items, notes, expectedDate } = req.body
        if (!supplierName?.trim()) return res.status(400).json({ success: false, error: 'Supplier name required' })
        if (!items?.length) return res.status(400).json({ success: false, error: 'At least one item required' })

        const count = await prisma.purchaseOrder.count()
        const code = `PO-${String(count + 1).padStart(3, '0')}`
        const totalAmount = items.reduce((s: number, it: any) => s + (it.quantity || 0) * (it.unitPrice || 0), 0)

        const po = await prisma.purchaseOrder.create({
            data: {
                code,
                supplierId: supplierId || null,
                supplierName: supplierName.trim(),
                status: 'draft',
                totalAmount,
                notes,
                expectedDate: expectedDate ? new Date(expectedDate) : null,
                items: {
                    create: items.map((it: any) => ({
                        productName: it.productName,
                        sku: it.sku || null,
                        quantity: it.quantity || 1,
                        unitPrice: it.unitPrice || 0,
                    })),
                },
            },
            include: { items: true },
        })
        res.status(201).json({ success: true, data: po })
    } catch (err) {
        console.error('Create PO error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// PUT /api/purchase-orders/:id/status
router.put('/:id/status', authMiddleware, async (req: Request, res: Response) => {
    try {
        const { status } = req.body
        const validStatuses = ['draft', 'pending', 'confirmed', 'shipping', 'received', 'cancelled']
        if (!validStatuses.includes(status)) return res.status(400).json({ success: false, error: 'Invalid status' })

        const data: any = { status }
        if (status === 'received') data.receivedDate = new Date()

        const po = await prisma.purchaseOrder.update({
            where: { id: req.params.id },
            data,
            include: { items: true },
        })
        res.json({ success: true, data: po })
    } catch (err) {
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// DELETE /api/purchase-orders/:id
router.delete('/:id', authMiddleware, async (req: Request, res: Response) => {
    try {
        await prisma.purchaseOrder.delete({ where: { id: req.params.id } })
        res.json({ success: true })
    } catch (err) {
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

export default router
