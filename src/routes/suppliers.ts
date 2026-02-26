import { Router, Request, Response } from 'express'
import prisma from '../lib/prisma'
import { authMiddleware } from '../middleware/auth'

const router = Router()

// GET /api/suppliers
router.get('/', authMiddleware, async (req: Request, res: Response) => {
    try {
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
        res.json({ success: true, data: suppliers })
    } catch (err) {
        console.error('Get suppliers error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// GET /api/suppliers/:id
router.get('/:id', authMiddleware, async (req: Request, res: Response) => {
    try {
        const supplier = await prisma.supplier.findUnique({
            where: { id: req.params.id },
            include: { purchaseOrders: { take: 10, orderBy: { createdAt: 'desc' } } },
        })
        if (!supplier) return res.status(404).json({ success: false, error: 'Not found' })
        res.json({ success: true, data: supplier })
    } catch (err) {
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// POST /api/suppliers
router.post('/', authMiddleware, async (req: Request, res: Response) => {
    try {
        const { name, contactName, phone, email, address, taxCode, status, notes } = req.body
        if (!name?.trim()) return res.status(400).json({ success: false, error: 'Name required' })
        const count = await prisma.supplier.count()
        const code = `NCC-${String(count + 1).padStart(3, '0')}`
        const supplier = await prisma.supplier.create({
            data: { code, name: name.trim(), contactName, phone, email, address, taxCode, status: status || 'active', notes },
        })
        res.status(201).json({ success: true, data: supplier })
    } catch (err) {
        console.error('Create supplier error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// PUT /api/suppliers/:id
router.put('/:id', authMiddleware, async (req: Request, res: Response) => {
    try {
        const { name, contactName, phone, email, address, taxCode, status, notes } = req.body
        const supplier = await prisma.supplier.update({
            where: { id: req.params.id },
            data: { name, contactName, phone, email, address, taxCode, status, notes },
        })
        res.json({ success: true, data: supplier })
    } catch (err) {
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// DELETE /api/suppliers/:id
router.delete('/:id', authMiddleware, async (req: Request, res: Response) => {
    try {
        const poCount = await prisma.purchaseOrder.count({ where: { supplierId: req.params.id } })
        if (poCount > 0) return res.status(400).json({ success: false, error: `Supplier has ${poCount} purchase orders` })
        await prisma.supplier.delete({ where: { id: req.params.id } })
        res.json({ success: true })
    } catch (err) {
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

export default router
