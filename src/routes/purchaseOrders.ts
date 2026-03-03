import { Router, Request, Response } from 'express'
import { authMiddleware, getBranchFilter, AuthRequest, getBranchId } from '../middleware/auth'

const router = Router()

// GET /api/purchase-orders
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
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
router.get('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const po = await prisma.purchaseOrder.findUnique({
            where: { id: String(req.params.id) },
            include: { items: true, supplier: true },
        })
        if (!po) return res.status(404).json({ success: false, error: 'Not found' })
        res.json({ success: true, data: po })
    } catch (err) {
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// POST /api/purchase-orders
router.post('/', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
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
router.put('/:id/status', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { status } = req.body
        const validStatuses = ['draft', 'pending', 'confirmed', 'shipping', 'received', 'cancelled']
        if (!validStatuses.includes(status)) return res.status(400).json({ success: false, error: 'Invalid status' })

        // Fetch full PO before update (to check previous status and items)
        const existing: any = await prisma.purchaseOrder.findUnique({
            where: { id: String(req.params.id) },
            include: { items: true },
        })
        if (!existing) return res.status(404).json({ success: false, error: 'Purchase order not found' })

        const data: any = { status }
        if (status === 'received') data.receivedDate = new Date()

        const po: any = await prisma.purchaseOrder.update({
            where: { id: String(req.params.id) },
            data,
            include: { items: true },
        })

        // ─── Auto-update product stock when marking as received ───────────────
        if (status === 'received' && existing.status !== 'received') {
            let updatedCount = 0
            for (const item of existing.items) {
                let product: any = null

                // Try SKU first, then fall back to product name
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
                    await prisma.product.update({
                        where: { id: product.id },
                        data: { stock: { increment: item.quantity } },
                    })
                    updatedCount++
                } else {
                    console.warn(`[PO received] Product not found: SKU=${item.sku} name=${item.productName}`)
                }
            }
            console.log(`[PO received] ${po.code} — stock updated for ${updatedCount}/${existing.items.length} items`)
        }

        res.json({ success: true, data: po })
    } catch (err) {
        console.error('Update PO status error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})


// DELETE /api/purchase-orders/:id
router.delete('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        await prisma.purchaseOrder.delete({ where: { id: String(req.params.id) } })
        res.json({ success: true })
    } catch (err) {
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

export default router
