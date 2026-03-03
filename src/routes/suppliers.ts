import { Router, Request, Response } from 'express'
import { authMiddleware, getBranchFilter, AuthRequest, getBranchId } from '../middleware/auth'
import { requireRole } from '../middleware/roleMiddleware'
import { validate } from '../middleware/validate'
import { CreateSupplierSchema, UpdateSupplierSchema } from '../schemas'
import { cacheGet, cacheSet, cacheDel } from '../lib/cache'

const router = Router()

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
        const _response = { success: true, data: suppliers }
        await cacheSet(cacheKey, _response, 120)
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
            include: { purchaseOrders: { take: 10, orderBy: { createdAt: 'desc' } } },
        })
        if (!supplier) return res.status(404).json({ success: false, error: 'Not found' })
        res.json({ success: true, data: supplier })
    } catch (err) {
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// POST /api/suppliers
router.post('/', authMiddleware, requireRole('admin', 'manager'), validate(CreateSupplierSchema), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { name, contactName, phone, email, address, taxCode, status, notes } = req.body
        if (!name?.trim()) return res.status(400).json({ success: false, error: 'Name required' })
        const count = await prisma.supplier.count()
        const code = `NCC-${String(count + 1).padStart(3, '0')}`
        const supplier = await prisma.supplier.create({
            data: { code, name: name.trim(), contactName, phone, email, address, taxCode, status: status || 'active', notes },
        })
        cacheDel(`${req.user?.storeSchema || 'default'}:suppliers:*`).catch(() => {})
        res.status(201).json({ success: true, data: supplier })
    } catch (err) {
        console.error('Create supplier error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// PUT /api/suppliers/:id
router.put('/:id', authMiddleware, requireRole('admin', 'manager'), validate(UpdateSupplierSchema), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { name, contactName, phone, email, address, taxCode, status, notes } = req.body
        const supplier = await prisma.supplier.update({
            where: { id: String(req.params.id) },
            data: { name, contactName, phone, email, address, taxCode, status, notes },
        })
        res.json({ success: true, data: supplier })
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
        await prisma.supplier.delete({ where: { id: String(req.params.id) } })
        res.json({ success: true })
    } catch (err) {
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

export default router
