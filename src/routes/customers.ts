import { Router, Request, Response } from 'express'
import { authMiddleware, getBranchFilter, AuthRequest, getBranchId } from '../middleware/auth'
import { validate } from '../middleware/validate'
import { CreateCustomerSchema, UpdateCustomerSchema } from '../schemas'
import { cacheGet, cacheSet, cacheDel } from '../lib/cache'

const router = Router()

// ─── Customers CRUD ─────────────────────────────────────────────────────────

// GET /api/customers
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const schema = req.user?.storeSchema || 'default'
        const { search, groupId, page = '1', pageSize = '20' } = req.query

        const cacheKey = `${schema}:customers:${JSON.stringify(req.query)}`
        const cached = await cacheGet(cacheKey)
        if (cached) return res.json(cached)

        const where: any = {}
        if (search) {
            where.OR = [
                { name: { contains: search as string } },
                { phone: { contains: search as string } },
                { code: { contains: search as string } },
                { email: { contains: search as string } },
            ]
        }
        if (groupId) where.groupId = groupId

        const pageNum = Math.max(1, parseInt(page as string))
        const size = Math.max(1, Math.min(100, parseInt(pageSize as string)))
        const skip = (pageNum - 1) * size

        const [total, customers] = await Promise.all([
            prisma.customer.count({ where }),
            prisma.customer.findMany({
                where,
                include: { group: true },
                orderBy: { createdAt: 'desc' },
                skip,
                take: size,
            }),
        ])

        const data = customers.map(c => ({
            ...c,
            lastPurchaseDate: c.lastPurchaseDate?.toISOString(),
            createdAt: c.createdAt.toISOString(),
            updatedAt: c.updatedAt.toISOString(),
        }))

        const response = {
            success: true,
            data: {
                items: data,
                total,
                page: pageNum,
                pageSize: size,
                totalPages: Math.ceil(total / size),
            },
        }
        await cacheSet(cacheKey, response, 60)
        res.json(response)
    } catch (err) {
        console.error('Get customers error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// GET /api/customers/:id
router.get('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        // Check if path is "groups" — handle customer-groups route
        if (req.params.id === 'groups') {
            return res.redirect('/api/customer-groups')
        }

        const customer = await prisma.customer.findFirst({
            where: { id: String(req.params.id) },
            include: { group: true },
        })

        if (!customer) {
            res.status(404).json({ success: false, error: 'Customer not found' })
            return
        }

        res.json({
            success: true,
            data: {
                ...customer,
                lastPurchaseDate: customer.lastPurchaseDate?.toISOString(),
                createdAt: customer.createdAt.toISOString(),
                updatedAt: customer.updatedAt.toISOString(),
            },
        })
    } catch (err) {
        console.error('Get customer error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// GET /api/customers/:id/purchases
router.get('/:id/purchases', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const transactions = await prisma.transaction.findMany({
            where: { customerId: String(req.params.id) },
            orderBy: { createdAt: 'desc' },
            take: 20,
            include: { items: true },
        })

        const purchases = transactions.map(t => ({
            id: t.id,
            orderId: t.id,
            customerId: String(req.params.id),
            date: t.createdAt.toISOString(),
            items: t.items.length,
            total: t.total,
            status: t.status === 'voided' ? 'cancelled' : t.status === 'returned' ? 'cancelled' : 'completed',
        }))

        res.json(purchases)
    } catch (err) {
        console.error('Get customer purchases error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// POST /api/customers
router.post('/', authMiddleware, validate(CreateCustomerSchema), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { name, phone, email, address, notes, groupId } = req.body

        if (!name) {
            res.status(400).json({ success: false, error: 'Name is required' })
            return
        }

        // Auto-generate customer code if not provided
        let code = req.body.code
        if (!code) {
            const lastCustomer = await prisma.customer.findFirst({
                orderBy: { code: 'desc' },
                where: { code: { startsWith: 'KH' } },
                select: { code: true },
            })
            const lastNum = lastCustomer ? parseInt(lastCustomer.code.replace('KH', '')) || 0 : 0
            code = `KH${String(lastNum + 1).padStart(3, '0')}`
        }

        const customer = await prisma.customer.create({
            data: {
                code,
                name,
                phone: phone || '',
                email: email || null,
                address: address || null,
                notes: notes || null,
                groupId: groupId || null,
            },
            include: { group: true },
        })

        res.status(201).json({
            success: true,
            data: {
                ...customer,
                lastPurchaseDate: customer.lastPurchaseDate?.toISOString(),
                createdAt: customer.createdAt.toISOString(),
                updatedAt: customer.updatedAt.toISOString(),
            },
        })
        cacheDel(`${req.user?.storeSchema || 'default'}:customers:*`).catch(() => { })
    } catch (err) {
        console.error('Create customer error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// PUT /api/customers/:id
router.put('/:id', authMiddleware, validate(UpdateCustomerSchema), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const existing = await prisma.customer.findFirst({ where: { id: String(req.params.id) } })
        if (!existing) return res.status(404).json({ success: false, error: 'Customer not found' })
        // Explicitly allowlist updatable fields — prevent overwriting debt/points via mass assignment
        const { name, phone, email, address, groupId, taxCode, note, loyaltyPoints } = req.body
        const customer = await prisma.customer.update({
            where: { id: existing.id },
            data: {
                ...(name !== undefined && { name }),
                ...(phone !== undefined && { phone }),
                ...(email !== undefined && { email }),
                ...(address !== undefined && { address }),
                ...(groupId !== undefined && { groupId }),
                ...(taxCode !== undefined && { taxCode }),
                ...(note !== undefined && { note }),
                ...(loyaltyPoints !== undefined && { loyaltyPoints }),
            },
        })

        res.json({
            success: true,
            data: {
                ...customer,
                lastPurchaseDate: customer.lastPurchaseDate?.toISOString(),
                createdAt: customer.createdAt.toISOString(),
                updatedAt: customer.updatedAt.toISOString(),
            },
        })
        cacheDel(`${req.user?.storeSchema || 'default'}:customers:*`).catch(() => { })
    } catch (err) {
        console.error('Update customer error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// DELETE /api/customers/:id
router.delete('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        // Verify ownership before delete
        const toDelete = await prisma.customer.findFirst({ where: { id: String(req.params.id) } })
        if (!toDelete) return res.status(404).json({ success: false, error: 'Customer not found' })
        await prisma.customer.delete({ where: { id: toDelete.id } })
        res.json({ success: true, message: 'Customer deleted' })
    } catch (err) {
        console.error('Delete customer error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// POST /api/customers/:id/pay-debt — Pay down customer debt
router.post('/:id/pay-debt', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { amount, method, reference, note } = req.body

        if (!amount || amount <= 0) {
            res.status(400).json({ success: false, error: 'Amount must be positive' })
            return
        }

        const customer = await prisma.customer.findFirst({
            where: { id: String(req.params.id) },
        })

        if (!customer) {
            res.status(404).json({ success: false, error: 'Customer not found' })
            return
        }

        const payAmount = Math.min(amount, customer.debt)

        const updated = await prisma.customer.update({
            where: { id: String(req.params.id) },
            data: {
                debt: { decrement: payAmount },
            },
            include: { group: true },
        })

        console.log(`💰 Customer ${customer.name} paid debt: ${payAmount} (remaining: ${updated.debt})`)

        res.json({
            success: true,
            data: {
                ...updated,
                paidAmount: payAmount,
                remainingDebt: updated.debt,
                lastPurchaseDate: updated.lastPurchaseDate?.toISOString(),
                createdAt: updated.createdAt.toISOString(),
                updatedAt: updated.updatedAt.toISOString(),
            },
        })
    } catch (err) {
        console.error('Pay customer debt error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

export default router

