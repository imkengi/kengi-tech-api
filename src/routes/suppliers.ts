import { Router, Request, Response } from 'express'
import { authMiddleware, getBranchFilter, AuthRequest, getBranchId } from '../middleware/auth'
import { requireRole } from '../middleware/roleMiddleware'
import { validate } from '../middleware/validate'
import { CreateSupplierSchema, UpdateSupplierSchema } from '../schemas'
import { cacheGet, cacheSet, cacheDel } from '../lib/cache'

const router = Router()

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
        const _response = { success: true, data: suppliers }
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
            select: { name: true, totalValue: true },
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
                    date: (po.updatedAt || po.createdAt).toISOString(),
                    type: 'payment',
                    label: 'Thanh toán PO',
                    amount: -po.totalAmount,
                    balance: 0,
                })
            }
        }

        // Process ImportReceipts
        for (const ir of importReceipts) {
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
            // If completed, treat as fully paid
            if (ir.status === 'completed' && ir.totalCost > 0) {
                history.push({
                    id: `${ir.id}-pay`,
                    code: `TT-${ir.code}`,
                    date: (ir.updatedAt || ir.createdAt).toISOString(),
                    type: 'payment',
                    label: 'Thanh toán nhập hàng',
                    amount: -ir.totalCost,
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
        let runningBalance = 0
        for (const item of history) {
            runningBalance += item.amount
            item.balance = Math.max(0, runningBalance)
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
        const { name, contactName, phone, email, address, taxCode, status, notes } = req.body
        if (!name?.trim()) return res.status(400).json({ success: false, error: 'Name required' })
        const count = await prisma.supplier.count()
        const code = `NCC-${String(count + 1).padStart(3, '0')}`
        const supplier = await prisma.supplier.create({
            data: { code, name: name.trim(), contactName, phone, email, address, taxCode, status: status || 'active', notes },
        })
        cacheDel(`${req.user?.storeSchema || 'default'}:suppliers:*`).catch(() => { })
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
