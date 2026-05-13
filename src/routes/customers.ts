import { Router, Request, Response } from 'express'
import { authMiddleware, getBranchFilter, AuthRequest, getBranchId } from '../middleware/auth'
import { requirePermission } from '../middleware/permissionMiddleware'
import { validate } from '../middleware/validate'
import { CreateCustomerSchema, UpdateCustomerSchema } from '../schemas'
import { cacheGet, cacheSet, cacheDel } from '../lib/cache'
import { nextCode } from '../lib/codeGenerator'

const router = Router()

// ─── Customers CRUD ─────────────────────────────────────────────────────────

// GET /api/customers/stats
router.get('/stats', authMiddleware, requirePermission('customers.view'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const total = await prisma.customer.count()
        const now = new Date()
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
        const newThisMonth = await prisma.customer.count({ where: { createdAt: { gte: monthStart } } })
        const agg = await prisma.customer.aggregate({ _sum: { debt: true, loyaltyPoints: true } })
        res.json({ success: true, data: { total, newThisMonth, totalDebt: agg._sum.debt || 0, totalPoints: agg._sum.loyaltyPoints || 0 } })
    } catch { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// GET /api/customers
router.get('/', authMiddleware, requirePermission('customers.view'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const schema = req.user?.storeSchema || 'default'
        const { search, groupId, salesUserId, page = '1', pageSize = '20' } = req.query

        const cacheKey = `${schema}:customers:${JSON.stringify(req.query)}`
        const cached = await cacheGet(cacheKey)
        if (cached) return res.json(cached)

        const where: any = {}
        if (search) {
            where.OR = [
                { name: { contains: search as string, mode: 'insensitive' } },
                { phone: { contains: search as string, mode: 'insensitive' } },
                { code: { contains: search as string, mode: 'insensitive' } },
                { email: { contains: search as string, mode: 'insensitive' } },
            ]
        }
        if (groupId) where.groupId = groupId
        if (salesUserId) where.salesUserId = salesUserId

        const pageNum = Math.max(1, parseInt(page as string))
        const size = Math.max(1, Math.min(200, parseInt(pageSize as string)))
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
        await cacheSet(cacheKey, response, 300)
        res.json(response)
    } catch (err: any) {
        console.error('Get customers error:', err)
        res.status(500).json({ success: false, error: 'Internal server error', detail: err?.message || String(err) })
    }
})

// GET /api/customers/:id
router.get('/:id', authMiddleware, requirePermission('customers.view'), async (req: AuthRequest, res: Response) => {
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

        // Compute stats dynamically from transactions
        const whereConditions: any[] = [{ customerId: customer.id }]
        if (customer.name) whereConditions.push({ customerName: customer.name })
        if (customer.phone) whereConditions.push({ customerPhone: customer.phone })

        const [txAgg, txCount, lastTx] = await Promise.all([
            prisma.transaction.aggregate({
                where: { OR: whereConditions, status: { not: 'voided' } },
                _sum: { total: true },
            }),
            prisma.transaction.count({
                where: { OR: whereConditions, status: { not: 'voided' } },
            }),
            prisma.transaction.findFirst({
                where: { OR: whereConditions, status: { not: 'voided' } },
                orderBy: { createdAt: 'desc' },
                select: { createdAt: true },
            }),
        ])

        res.json({
            success: true,
            data: {
                ...customer,
                totalPurchases: txAgg._sum.total || 0,
                totalOrders: txCount,
                lastPurchaseDate: lastTx?.createdAt?.toISOString() || customer.lastPurchaseDate?.toISOString(),
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
router.get('/:id/purchases', authMiddleware, requirePermission('customers.view'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const custId = String(req.params.id)

        // Also look up customer name/phone so we can match by those too
        const customer = await prisma.customer.findFirst({ where: { id: custId }, select: { name: true, phone: true } })

        const whereConditions: any[] = [{ customerId: custId }]
        if (customer?.name) whereConditions.push({ customerName: customer.name })
        if (customer?.phone) whereConditions.push({ customerPhone: customer.phone })

        const transactions = await prisma.transaction.findMany({
            where: { OR: whereConditions },
            orderBy: { createdAt: 'desc' },
            take: 50,
            include: { items: true },
        })

        const purchases = transactions.map(t => ({
            id: t.id,
            orderId: t.receiptNumber,
            customerId: custId,
            date: t.createdAt.toISOString(),
            items: t.items.length,
            total: t.total,
            status: t.status === 'voided' ? 'cancelled' : t.status === 'returned' ? 'cancelled' : 'completed',
        }))

        res.json(purchases)
    } catch (err) {
        console.error('Customer purchases error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// GET /api/customers/:id/prices/:productId
router.get('/:id/prices/:productId', authMiddleware, requirePermission('customers.view'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const custId = String(req.params.id)
        const prodId = String(req.params.productId)

        const customer = await prisma.customer.findFirst({ where: { id: custId }, select: { name: true, phone: true } })

        const whereConditions: any[] = [{ customerId: custId }]
        if (customer?.name) whereConditions.push({ customerName: customer.name })
        if (customer?.phone) whereConditions.push({ customerPhone: customer.phone })

        const transactions = await prisma.transaction.findMany({
            where: {
                OR: whereConditions,
                items: { some: { productId: prodId } }
            },
            orderBy: { createdAt: 'desc' },
            take: 50,
            select: {
                id: true,
                receiptNumber: true,
                createdAt: true,
                items: {
                    where: { productId: prodId },
                    select: { unitPrice: true }
                }
            }
        })

        const prices: { price: number; date: Date; receiptNumber: string }[] = []
        const seen = new Set<number>()

        for (const tx of transactions) {
            if (!tx.items || tx.items.length === 0) continue;
            for (const item of tx.items) {
                if (!seen.has(item.unitPrice)) {
                    seen.add(item.unitPrice)
                    prices.push({
                        price: item.unitPrice,
                        date: tx.createdAt,
                        receiptNumber: tx.receiptNumber
                    })
                    if (prices.length >= 5) break
                }
            }
            if (prices.length >= 5) break
        }

        res.json({ success: true, data: prices })
    } catch (err) {
        console.error('Customer product prices error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})


// GET /api/customers/:id/debt-history — Build debt movement history from transactions + DebtEntry
router.get('/:id/debt-history', authMiddleware, requirePermission('customers.view'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const custId = String(req.params.id)

        const customer = await prisma.customer.findFirst({
            where: { id: custId },
            select: { name: true, phone: true, debt: true },
        })
        if (!customer) {
            res.status(404).json({ success: false, error: 'Customer not found' })
            return
        }

        // 1. Get ALL transactions for this customer
        const whereConditions: any[] = [{ customerId: custId }]
        if (customer.name) whereConditions.push({ customerName: customer.name })
        if (customer.phone) whereConditions.push({ customerPhone: customer.phone })

        const transactions = await prisma.transaction.findMany({
            where: { OR: whereConditions },
            include: { payments: true },
            orderBy: { createdAt: 'asc' },
        })

        // 2. Get DebtEntry records
        const debtEntries = await prisma.debtEntry.findMany({
            where: { customerId: custId },
            orderBy: { createdAt: 'asc' },
        })

        // AuditLog source removed — Payment records cover pay_debt events

        console.log(`[debt-history] Customer ${custId}: ${transactions.length} txs, ${debtEntries.length} entries`)

        interface DebtHistoryItem {
            id: string
            code: string
            date: string
            type: 'sale' | 'payment' | 'debt' | 'manual_payment' | 'return'
            label: string
            amount: number
            balance: number
        }

        const history: DebtHistoryItem[] = []
        let ptCounter = 0 // Counter for PT (Phiếu Thu) codes

        // Helper: generate PT code from receipt number or sequential
        const makePTCode = (receiptNumber?: string) => {
            ptCounter++
            if (receiptNumber) {
                // HD026877 → PT026877
                const digits = receiptNumber.replace(/\D/g, '')
                if (digits) return `PT${digits}`
            }
            return `PT${String(ptCounter).padStart(5, '0')}`
        }

        for (const t of transactions) {
            // Skip voided transactions
            if (t.status === 'voided') continue

            // Handle returned transactions — create "Phiếu trả hàng" entry
            if (t.status === 'returned') {
                const digits = t.receiptNumber?.replace(/\D/g, '') || ''
                history.push({
                    id: `${t.id}-return`,
                    code: `TH${digits || String(++ptCounter).padStart(5, '0')}`,
                    date: ((t as any).updatedAt || t.createdAt).toISOString(),
                    type: 'return',
                    label: 'Trả hàng',
                    amount: -t.total,
                    balance: 0,
                })
                continue
            }

            // ── 1. "Bán hàng" entry: total invoice amount (increases debt)
            if (t.total > 0) {
                history.push({
                    id: t.id,
                    code: t.receiptNumber,
                    date: t.createdAt.toISOString(),
                    type: 'sale',
                    label: 'Bán hàng',
                    amount: t.total,
                    balance: 0,
                })
            }

            // ── 2. "Phiếu thu lúc bán": payments at time of sale
            //    = all payments that are NOT credit AND NOT "Thanh toán nợ"
            const salePayments = t.payments.filter(p =>
                p.type !== 'credit' &&
                !(p.reference && p.reference.includes('Thanh toán nợ'))
            )
            const saleReceived = salePayments.reduce((sum, p) => sum + p.amount, 0)
            if (saleReceived > 0) {
                history.push({
                    id: `${t.id}-receipt`,
                    code: makePTCode(t.receiptNumber),
                    date: t.createdAt.toISOString(),
                    type: 'payment',
                    label: 'Phiếu thu',
                    amount: -saleReceived,
                    balance: 0,
                })
            }

            // ── 3. "Phiếu thu trả nợ": each debt payment record
            const debtPaymentRecords = t.payments.filter(p =>
                p.reference && p.reference.includes('Thanh toán nợ')
            )
            for (const dp of debtPaymentRecords) {
                if (dp.amount <= 0) continue
                history.push({
                    id: dp.id,
                    code: makePTCode(t.receiptNumber),
                    date: (dp as any).createdAt?.toISOString?.() || t.createdAt.toISOString(),
                    type: 'payment',
                    label: 'Phiếu thu',
                    amount: -dp.amount,
                    balance: 0,
                })
            }
        }

        // ❌ AuditLog source REMOVED — already covered by Payment records above

        // From DebtEntry records
        for (const e of debtEntries) {
            let entryCode = makePTCode()
            let entryType: DebtHistoryItem['type'] = 'manual_payment'
            let entryLabel = 'Phiếu thu'
            let entryAmount = -e.amount

            if (e.type === 'debt') {
                entryCode = 'GN'
                entryType = 'debt'
                entryLabel = 'Ghi nợ'
                entryAmount = e.amount
            } else if (e.type === 'return') {
                // Generate TH (Trả Hàng) code
                const thNum = String(ptCounter).padStart(5, '0')
                entryCode = `TH${thNum}`
                entryType = 'return'
                entryLabel = 'Phiếu trả hàng'
                entryAmount = -e.amount
            }

            history.push({
                id: e.id,
                code: entryCode,
                date: e.createdAt.toISOString(),
                type: entryType,
                label: entryLabel,
                amount: entryAmount,
                balance: 0,
            })
        }

        // Sort by date ascending and calculate running balance
        history.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
        let runningBalance = 0
        for (const item of history) {
            runningBalance += item.amount
            item.balance = Math.max(0, runningBalance)
        }

        // Return newest first
        history.reverse()

        console.log(`[debt-history] Final history items: ${history.length}`)
        res.json({ success: true, data: history })
    } catch (err) {
        console.error('Get customer debt history error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})


// POST /api/customers/:id/cancel-receipt
// Cancel a "Phiếu thu" — keep the sale, convert it to debt
// Body: { entryId: string } — the debt-history item id
//   - "<txId>-receipt" → sale-time receipt: drop non-credit payments, add credit, status=partial, debt+=amount
//   - Payment.id ("Thanh toán nợ") → debt-payment receipt: delete payment, status=partial, debt+=amount
//   - DebtEntry.id (type=payment) → manual payment: delete entry, debt+=amount
router.post('/:id/cancel-receipt', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const customerId = String(req.params.id)
        const entryId: string = String(req.body?.entryId || '').trim()
        if (!entryId) {
            res.status(400).json({ success: false, error: 'entryId required' })
            return
        }

        const customer = await prisma.customer.findFirst({ where: { id: customerId } })
        if (!customer) {
            res.status(404).json({ success: false, error: 'Customer not found' })
            return
        }

        const user = await prisma.user.findUnique({ where: { id: req.user!.userId } })
        const userName = user?.name || 'Admin'

        let cancelledAmount = 0
        let cancelledCode = ''
        let scope: 'sale-receipt' | 'debt-payment' | 'manual' = 'sale-receipt'

        // ── Case 1: sale-time receipt ────────────────────────────────────────
        if (entryId.endsWith('-receipt')) {
            const txId = entryId.slice(0, -'-receipt'.length)
            const tx = await prisma.transaction.findUnique({
                where: { id: txId },
                include: { payments: true },
            })
            if (!tx) {
                res.status(404).json({ success: false, error: 'Transaction not found' })
                return
            }
            if (tx.status === 'voided' || tx.status === 'returned') {
                res.status(400).json({ success: false, error: 'Giao dịch đã hủy/trả hàng' })
                return
            }
            const saleReceipts = tx.payments.filter(p =>
                p.type !== 'credit' &&
                !(p.reference && p.reference.includes('Thanh toán nợ'))
            )
            cancelledAmount = saleReceipts.reduce((s, p) => s + p.amount, 0)
            if (cancelledAmount <= 0) {
                res.status(400).json({ success: false, error: 'Không có phiếu thu để hủy' })
                return
            }

            await prisma.$transaction(async (tx2) => {
                // Drop non-credit payments
                await tx2.payment.deleteMany({
                    where: { id: { in: saleReceipts.map(p => p.id) } },
                })
                // Ensure a credit payment exists for the cancelled amount
                const existingCredit = tx.payments.find(p => p.type === 'credit')
                if (existingCredit) {
                    await tx2.payment.update({
                        where: { id: existingCredit.id },
                        data: { amount: existingCredit.amount + cancelledAmount },
                    })
                } else {
                    await tx2.payment.create({
                        data: {
                            transactionId: tx.id,
                            type: 'credit',
                            amount: cancelledAmount,
                            reference: `Hủy phiếu thu ${tx.receiptNumber}`,
                        },
                    })
                }
                // Update tx: amountReceived down, status partial
                await tx2.transaction.update({
                    where: { id: tx.id },
                    data: {
                        amountReceived: Math.max(0, (tx.amountReceived ?? 0) - cancelledAmount),
                        status: 'partial',
                    },
                })
                // Customer debt up
                await tx2.customer.update({
                    where: { id: customerId },
                    data: { debt: { increment: cancelledAmount } },
                })
            })

            cancelledCode = `PT${(tx.receiptNumber || '').replace(/\D/g, '')}`
            scope = 'sale-receipt'
        }

        // ── Case 2: debt-payment receipt (Payment.id) ────────────────────────
        else if (await prisma.payment.findUnique({ where: { id: entryId } })) {
            const payment = await prisma.payment.findUnique({
                where: { id: entryId },
                include: { transaction: true },
            })
            if (!payment) {
                res.status(404).json({ success: false, error: 'Payment not found' })
                return
            }
            if (!payment.reference || !payment.reference.includes('Thanh toán nợ')) {
                res.status(400).json({ success: false, error: 'Phiếu này không phải phiếu thu nợ — vui lòng hủy theo đường khác' })
                return
            }
            cancelledAmount = payment.amount
            const tx = payment.transaction

            await prisma.$transaction(async (tx2) => {
                await tx2.payment.delete({ where: { id: payment.id } })
                const newReceived = Math.max(0, (tx.amountReceived ?? 0) - cancelledAmount)
                await tx2.transaction.update({
                    where: { id: tx.id },
                    data: {
                        amountReceived: newReceived,
                        status: newReceived < tx.total ? 'partial' : tx.status,
                    },
                })
                await tx2.customer.update({
                    where: { id: customerId },
                    data: { debt: { increment: cancelledAmount } },
                })
            })

            cancelledCode = `PT${(tx.receiptNumber || '').replace(/\D/g, '')}`
            scope = 'debt-payment'
        }

        // ── Case 3: manual DebtEntry payment ─────────────────────────────────
        else if (await prisma.debtEntry.findUnique({ where: { id: entryId } })) {
            const entry = await prisma.debtEntry.findUnique({ where: { id: entryId } })
            if (!entry) {
                res.status(404).json({ success: false, error: 'Debt entry not found' })
                return
            }
            if (entry.type !== 'payment') {
                res.status(400).json({ success: false, error: 'Mục này không phải phiếu thu' })
                return
            }
            cancelledAmount = entry.amount

            await prisma.$transaction(async (tx2) => {
                await tx2.debtEntry.delete({ where: { id: entry.id } })
                await tx2.customer.update({
                    where: { id: customerId },
                    data: { debt: { increment: cancelledAmount } },
                })
            })

            cancelledCode = 'PT (thủ công)'
            scope = 'manual'
        }

        else {
            res.status(404).json({ success: false, error: 'Không tìm thấy phiếu thu để hủy' })
            return
        }

        // Audit log (best-effort)
        try {
            await prisma.auditLog.create({
                data: {
                    userId: req.user!.userId,
                    userName,
                    action: 'cancel_receipt',
                    entity: 'Customer',
                    entityId: customerId,
                    details: JSON.stringify({ entryId, scope, amount: cancelledAmount, code: cancelledCode }),
                },
            })
        } catch { }

        cacheDel(`${req.user?.storeSchema || 'default'}:*:transactions:*`).catch(() => { })
        cacheDel(`${req.user?.storeSchema || 'default'}:customers:*`).catch(() => { })

        console.log(`🚫 Cancelled receipt ${cancelledCode} (${scope}) — ${cancelledAmount} for customer ${customerId}`)

        res.json({
            success: true,
            data: { entryId, scope, amount: cancelledAmount, code: cancelledCode },
        })
    } catch (err) {
        console.error('Cancel receipt error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})


// POST /api/customers
router.post('/', authMiddleware, requirePermission('customers.create'), validate(CreateCustomerSchema), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { name, phone, email, address, notes, groupId, birthday, gender, taxCode, salesUserId, salesUserName } = req.body

        if (!name) {
            res.status(400).json({ success: false, error: 'Name is required' })
            return
        }

        // Auto-generate customer code if not provided. Uses an atomic sequence
        // so concurrent POST /api/customers cannot mint the same code twice.
        let code = req.body.code
        if (!code) {
            code = await nextCode(prisma, 'customerCodeSeq', 'KH', 3, '', 'Customer', 'code')
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
                birthday: birthday || null,
                gender: gender || null,
                salesUserId: salesUserId || null,
                salesUserName: salesUserName || null,
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
router.put('/:id', authMiddleware, requirePermission('customers.edit'), validate(UpdateCustomerSchema), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const existing = await prisma.customer.findFirst({ where: { id: String(req.params.id) } })
        if (!existing) return res.status(404).json({ success: false, error: 'Customer not found' })
        // Explicitly allowlist updatable fields — prevent overwriting debt/points via mass assignment
        const { name, phone, email, address, groupId, taxCode, note, notes, loyaltyPoints, birthday, gender, salesUserId, salesUserName } = req.body
        const customer = await prisma.customer.update({
            where: { id: existing.id },
            data: {
                ...(name !== undefined && { name }),
                ...(phone !== undefined && { phone }),
                ...(email !== undefined && { email }),
                ...(address !== undefined && { address }),
                ...(groupId !== undefined && { groupId: groupId || null }),
                ...(taxCode !== undefined && { taxCode }),
                ...(note !== undefined && { note }),
                ...(notes !== undefined && { notes }),
                ...(loyaltyPoints !== undefined && { loyaltyPoints }),
                ...(birthday !== undefined && { birthday: birthday || null }),
                ...(gender !== undefined && { gender: gender || null }),
                ...(salesUserId !== undefined && { salesUserId: salesUserId || null }),
                ...(salesUserName !== undefined && { salesUserName: salesUserName || null }),
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
router.delete('/:id', authMiddleware, requirePermission('customers.delete'), async (req: AuthRequest, res: Response) => {
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

// PATCH /api/customers/:id/geocode — Lưu tọa độ geocode vào database
router.patch('/:id/geocode', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { latitude, longitude } = req.body
        if (typeof latitude !== 'number' || typeof longitude !== 'number') {
            res.status(400).json({ success: false, error: 'latitude and longitude are required numbers' })
            return
        }
        const existing = await prisma.customer.findFirst({ where: { id: String(req.params.id) } })
        if (!existing) {
            res.status(404).json({ success: false, error: 'Customer not found' })
            return
        }
        await prisma.customer.update({
            where: { id: existing.id },
            data: { latitude, longitude },
        })
        // Clear cache so next fetch includes new coordinates
        cacheDel(`${req.user?.storeSchema || 'default'}:customers:*`).catch(() => {})
        res.json({ success: true })
    } catch (err) {
        console.error('Geocode customer error:', err)
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

        // Create DebtEntry record for tracking
        const lastEntry = await prisma.debtEntry.findFirst({
            where: { customerId: customer.id },
            orderBy: { createdAt: 'desc' },
        })
        const currentBalance = lastEntry?.balance ?? customer.debt

        await prisma.debtEntry.create({
            data: {
                customerId: customer.id,
                customerName: customer.name,
                phone: customer.phone || '',
                type: 'payment',
                amount: payAmount,
                description: note || reference || `Thanh toán nợ (${method || 'cash'})`,
                balance: Math.max(0, currentBalance - payAmount),
            },
        })

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

