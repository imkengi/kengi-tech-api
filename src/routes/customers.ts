import { Router, Request, Response } from 'express'
import prisma from '../lib/prisma'
import { authMiddleware } from '../middleware/auth'

const router = Router()

// ─── Customers CRUD ─────────────────────────────────────────────────────────

// GET /api/customers
router.get('/', authMiddleware, async (req: Request, res: Response) => {
    try {
        const { search, groupId, page = '1', pageSize = '20' } = req.query

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

        res.json({
            success: true,
            data: {
                items: data,
                total,
                page: pageNum,
                pageSize: size,
                totalPages: Math.ceil(total / size),
            },
        })
    } catch (err) {
        console.error('Get customers error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// GET /api/customers/:id
router.get('/:id', authMiddleware, async (req: Request, res: Response) => {
    try {
        // Check if path is "groups" — handle customer-groups route
        if (req.params.id === 'groups') {
            return res.redirect('/api/customer-groups')
        }

        const customer = await prisma.customer.findUnique({
            where: { id: req.params.id },
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
router.get('/:id/purchases', authMiddleware, async (req: Request, res: Response) => {
    try {
        const transactions = await prisma.transaction.findMany({
            where: { customerId: req.params.id },
            orderBy: { createdAt: 'desc' },
            take: 20,
            include: { items: true },
        })

        const purchases = transactions.map(t => ({
            id: t.id,
            orderId: t.id,
            customerId: req.params.id,
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
router.post('/', authMiddleware, async (req: Request, res: Response) => {
    try {
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
    } catch (err) {
        console.error('Create customer error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// PUT /api/customers/:id
router.put('/:id', authMiddleware, async (req: Request, res: Response) => {
    try {
        const customer = await prisma.customer.update({
            where: { id: req.params.id },
            data: req.body,
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
    } catch (err) {
        console.error('Update customer error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// DELETE /api/customers/:id
router.delete('/:id', authMiddleware, async (req: Request, res: Response) => {
    try {
        await prisma.customer.delete({ where: { id: req.params.id } })
        res.json({ success: true, message: 'Customer deleted' })
    } catch (err) {
        console.error('Delete customer error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// POST /api/customers/:id/pay-debt — Pay down customer debt
router.post('/:id/pay-debt', authMiddleware, async (req: Request, res: Response) => {
    try {
        const { amount, method, reference, note } = req.body

        if (!amount || amount <= 0) {
            res.status(400).json({ success: false, error: 'Amount must be positive' })
            return
        }

        const customer = await prisma.customer.findUnique({
            where: { id: req.params.id },
        })

        if (!customer) {
            res.status(404).json({ success: false, error: 'Customer not found' })
            return
        }

        const payAmount = Math.min(amount, customer.debt)

        const updated = await prisma.customer.update({
            where: { id: req.params.id },
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

