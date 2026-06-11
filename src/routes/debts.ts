import { Router, Request, Response } from 'express'
import { authMiddleware, AuthRequest } from '../middleware/auth'

const router = Router()

// GET /api/debts/stats
router.get('/stats', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const customers = await prisma.customer.findMany({
            where: { debt: { gt: 0 } },
            select: { name: true, debt: true },
            orderBy: { debt: 'desc' },
        })
        const totalDebt = customers.reduce((s, c) => s + c.debt, 0)
        const count = customers.length
        const avgDebt = count > 0 ? Math.round(totalDebt / count) : 0
        const largest = customers[0] || null
        res.json({ success: true, data: { totalDebt, count, avgDebt, largest } })
    } catch (err) {
        console.error('Debt stats error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// GET /api/debts — all entries, optional filter by customerId
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { customerId, type } = req.query
        const where: any = {}
        if (customerId) where.customerId = customerId
        if (type && type !== 'all') where.type = type

        const entries = await prisma.debtEntry.findMany({ where, orderBy: { createdAt: 'desc' } })
        res.json({ success: true, data: entries })
    } catch (err) {
        console.error('Get debts error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// GET /api/debts/summary — grouped by customer with totals
router.get('/summary', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        // 1. Get all customers with debt > 0
        const customersWithDebt = await prisma.customer.findMany({
            where: { debt: { gt: 0 } },
            select: { id: true, name: true, phone: true, debt: true },
        })

        // 2. Get all debt entries
        const entries = await prisma.debtEntry.findMany({ orderBy: { createdAt: 'asc' } })

        // 3. Get transactions with unpaid amounts (same pattern as customer debt-history)
        const debtTransactions = await prisma.transaction.findMany({
            where: {
                OR: [
                    { status: 'partial' },
                    // transactions where amountReceived < total
                ],
            },
            select: {
                id: true, receiptNumber: true, total: true, amountReceived: true,
                customerId: true, customerName: true, createdAt: true, status: true,
            },
            orderBy: { createdAt: 'asc' },
        })

        // 4. Group entries by customerId
        const entryMap: Record<string, typeof entries> = {}
        for (const e of entries) {
            if (!entryMap[e.customerId]) entryMap[e.customerId] = []
            entryMap[e.customerId].push(e)
        }

        // 5. Build transaction-derived entries
        const txEntryMap: Record<string, any[]> = {}
        for (const tx of debtTransactions) {
            if (!tx.customerId) continue
            const unpaid = tx.total - (tx.amountReceived ?? 0)
            if (unpaid <= 0) continue
            if (!txEntryMap[tx.customerId]) txEntryMap[tx.customerId] = []
            txEntryMap[tx.customerId].push({
                id: `tx-${tx.id}`,
                customerId: tx.customerId,
                customerName: tx.customerName || '',
                phone: '',
                type: 'debt',
                amount: unpaid,
                description: `Nợ từ HĐ ${tx.receiptNumber || tx.id.slice(-6).toUpperCase()}`,
                balance: 0, // will be recalculated
                createdAt: tx.createdAt,
            })
        }

        // 6. Build summary: start from customers with debt, merge with entries
        const summaryMap: Record<string, {
            customerId: string; customerName: string; phone: string
            totalDebt: number; entries: any[]
        }> = {}

        // Add customers with debt from Customer model
        for (const c of customersWithDebt) {
            const debtEntries = entryMap[c.id] || []
            const txEntries = txEntryMap[c.id] || []
            // Merge and sort chronologically
            const allEntries = [...debtEntries, ...txEntries].sort((a, b) =>
                new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
            )
            // Deduplicate: if DebtEntry records exist, they're authoritative - skip tx entries
            const finalEntries = debtEntries.length > 0 ? debtEntries : allEntries

            summaryMap[c.id] = {
                customerId: c.id,
                customerName: c.name,
                phone: c.phone || '',
                totalDebt: c.debt,
                entries: finalEntries,
            }
        }

        // Add any DebtEntry customers not yet in the map
        for (const [custId, custEntries] of Object.entries(entryMap)) {
            if (!summaryMap[custId]) {
                const last = custEntries[custEntries.length - 1]
                summaryMap[custId] = {
                    customerId: custId,
                    customerName: last.customerName,
                    phone: last.phone || '',
                    totalDebt: last.balance,
                    entries: custEntries,
                }
            }
        }

        // Add tx-only customers not yet in the map
        for (const [custId, txEntries] of Object.entries(txEntryMap)) {
            if (!summaryMap[custId] && txEntries.length > 0) {
                const cust = customersWithDebt.find(c => c.id === custId)
                summaryMap[custId] = {
                    customerId: custId,
                    customerName: cust?.name || txEntries[0].customerName || 'Khách lẻ',
                    phone: cust?.phone || '',
                    totalDebt: txEntries.reduce((s: number, e: any) => s + e.amount, 0),
                    entries: txEntries,
                }
            }
        }

        const data = Object.values(summaryMap)
        res.json({ success: true, data })
    } catch (err) {
        console.error('Get debt summary error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// POST /api/debts — add debt or payment entry
router.post('/', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { customerId, customerName, phone, type, amount, description } = req.body
        if (!customerId?.trim()) return res.status(400).json({ success: false, error: 'Customer ID required' })
        if (!amount || amount <= 0) return res.status(400).json({ success: false, error: 'Valid amount required' })

        // Customer.debt is the authoritative balance — the ledger entry and the
        // balance must move together, so both writes share one transaction.
        // (DebtEntry has no branchId column; don't apply the branch filter here.)
        const customer = await prisma.customer.findUnique({
            where: { id: customerId.trim() },
            select: { id: true, name: true, phone: true, debt: true },
        })
        if (!customer) return res.status(404).json({ success: false, error: 'Không tìm thấy khách hàng' })

        const currentBalance = Math.max(0, customer.debt ?? 0)
        // A payment can't exceed the outstanding balance.
        const entryAmount = type === 'payment' ? Math.min(Number(amount), currentBalance) : Number(amount)
        if (type === 'payment' && entryAmount <= 0) {
            return res.status(400).json({ success: false, error: 'Khách hàng không còn công nợ' })
        }
        const newBalance = type === 'payment' ? currentBalance - entryAmount : currentBalance + entryAmount

        const entry = await prisma.$transaction(async (tx) => {
            const created = await tx.debtEntry.create({
                data: {
                    customerId: customer.id,
                    customerName: customerName?.trim() || customer.name || 'Khách hàng',
                    phone: phone || customer.phone || null,
                    type: type || 'debt',
                    amount: entryAmount,
                    description: description?.trim() || (type === 'payment' ? 'Trả nợ' : 'Ghi nợ'),
                    balance: newBalance,
                },
            })
            await tx.customer.update({
                where: { id: customer.id },
                data: { debt: newBalance },
            })
            return created
        })
        res.status(201).json({ success: true, data: entry })
    } catch (err) {
        console.error('Create debt entry error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// DELETE /api/debts/:id — remove a ledger entry AND undo its effect on the balance
router.delete('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const entry = await prisma.debtEntry.findUnique({ where: { id: String(req.params.id) } })
        if (!entry) return res.status(404).json({ success: false, error: 'Không tìm thấy bút toán' })

        await prisma.$transaction(async (tx) => {
            await tx.debtEntry.delete({ where: { id: entry.id } })
            const customer = await tx.customer.findUnique({
                where: { id: entry.customerId },
                select: { debt: true },
            })
            if (!customer) return // customer already deleted — nothing to adjust
            const currentDebt = Math.max(0, customer.debt ?? 0)
            // Deleting a 'debt' entry removes that debt; deleting a 'payment'/'return'
            // entry restores it. Clamp so the balance never goes negative.
            const newDebt = entry.type === 'debt'
                ? Math.max(0, currentDebt - entry.amount)
                : currentDebt + entry.amount
            await tx.customer.update({
                where: { id: entry.customerId },
                data: { debt: newDebt },
            })
        })

        res.json({ success: true })
    } catch (err) {
        console.error('Delete debt entry error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

export default router
