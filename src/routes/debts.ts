import { Router, Request, Response } from 'express'
import { authMiddleware, getBranchFilter, AuthRequest, getBranchId } from '../middleware/auth'

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

        // Get current balance for this customer
        const lastEntry = await prisma.debtEntry.findFirst({
            where: { ...getBranchFilter(req as any), customerId },
            orderBy: { createdAt: 'desc' },
        })
        const currentBalance = lastEntry?.balance ?? 0
        const newBalance = type === 'debt' ? currentBalance + Number(amount) : currentBalance - Number(amount)

        const entry = await prisma.debtEntry.create({
            data: {
                customerId: customerId.trim(),
                customerName: customerName?.trim() || 'Khách hàng',
                phone: phone || null,
                type: type || 'debt',
                amount: Number(amount),
                description: description?.trim() || (type === 'debt' ? 'Ghi nợ' : 'Trả nợ'),
                balance: Math.max(0, newBalance),
            },
        })
        res.status(201).json({ success: true, data: entry })
    } catch (err) {
        console.error('Create debt entry error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// DELETE /api/debts/:id
router.delete('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        await prisma.debtEntry.delete({ where: { id: String(req.params.id) } })
        res.json({ success: true })
    } catch (err) {
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

export default router
