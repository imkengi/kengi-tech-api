import { Router, Request, Response } from 'express'
import { authMiddleware, getBranchFilter, AuthRequest, getBranchId } from '../middleware/auth'
import { validate } from '../middleware/validate'
import { CreateQuotationSchema, UpdateQuotationSchema } from '../schemas'

const router = Router()

// Zero-touch migration for multi-tenant schemas
async function ensureQuotationColumns(prisma: any) {
    try {
        await prisma.$executeRawUnsafe(`ALTER TABLE "Quotation" ADD COLUMN IF NOT EXISTS "customerEmail" TEXT`)
        await prisma.$executeRawUnsafe(`ALTER TABLE "Quotation" ADD COLUMN IF NOT EXISTS "subtotal" DOUBLE PRECISION DEFAULT 0`)
        await prisma.$executeRawUnsafe(`ALTER TABLE "Quotation" ADD COLUMN IF NOT EXISTS "discount" DOUBLE PRECISION DEFAULT 0`)
    } catch { /* columns already exist */ }
}

router.get('/stats', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const all = await prisma.quotation.findMany({
            select: { status: true, totalAmount: true, customerName: true, validUntil: true, createdAt: true },
        })

        const byStatus: Record<string, number> = {}
        let totalValue = 0
        let totalValueAccepted = 0
        for (const q of all) {
            const st = q.status || 'draft'
            byStatus[st] = (byStatus[st] || 0) + 1
            totalValue += q.totalAmount
            if (st === 'accepted') totalValueAccepted += q.totalAmount
        }

        const accepted = byStatus['accepted'] || 0
        const sent = all.filter(q => q.status && q.status !== 'draft').length
        const conversionRate = sent > 0 ? Math.round(accepted / sent * 100) : 0
        const avgQuoteValue = all.length > 0 ? Math.round(totalValue / all.length) : 0

        // 7-day trend
        const now = new Date()
        const last7Days: { date: string; count: number; value: number }[] = []
        for (let i = 6; i >= 0; i--) {
            const d = new Date(now)
            d.setDate(d.getDate() - i)
            const key = d.toISOString().slice(0, 10)
            const dayQuotes = all.filter(q => q.createdAt.toISOString().slice(0, 10) === key)
            last7Days.push({ date: key, count: dayQuotes.length, value: dayQuotes.reduce((s, q) => s + q.totalAmount, 0) })
        }

        // Top 5 customers by total value
        const custMap: Record<string, { name: string; value: number; count: number }> = {}
        for (const q of all) {
            const n = q.customerName || 'N/A'
            if (!custMap[n]) custMap[n] = { name: n, value: 0, count: 0 }
            custMap[n].value += q.totalAmount
            custMap[n].count++
        }
        const topCustomers = Object.values(custMap).sort((a, b) => b.value - a.value).slice(0, 5)

        // Expiring in 3 days
        const in3d = new Date(now)
        in3d.setDate(in3d.getDate() + 3)
        const expiringIn3Days = all.filter(q =>
            q.validUntil && q.validUntil > now && q.validUntil <= in3d &&
            !['accepted', 'rejected', 'expired'].includes(q.status || '')
        ).length

        res.json({
            success: true,
            data: {
                total: all.length, byStatus, totalValue, totalValueAccepted,
                conversionRate, avgQuoteValue, last7Days, topCustomers, expiringIn3Days,
            },
        })
    } catch { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// GET /api/quotations
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        await ensureQuotationColumns(prisma)
        const { search, status } = req.query
        const where: any = {}
        if (status && status !== 'all') where.status = status
        if (search) {
            const q = String(search)
            where.OR = [{ code: { contains: q } }, { customerName: { contains: q } }]
        }
        const data = await prisma.quotation.findMany({ where, orderBy: { createdAt: 'desc' } })
        const parsed = data.map(q => ({ ...q, items: JSON.parse(q.items || '[]') }))
        res.json({ success: true, data: parsed })
    } catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// POST /api/quotations
router.post('/', authMiddleware, validate(CreateQuotationSchema), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { customerName, customerPhone, customerEmail, items, totalAmount, total, subtotal, discount, validUntil, notes, code } = req.body
        if (!customerName?.trim()) return res.status(400).json({ success: false, error: 'Customer name required' })
        const finalCode = code || `QT-${String((await prisma.quotation.count()) + 1).padStart(4, '0')}`
        const finalTotal = Number(totalAmount) || Number(total) || 0
        const data = await prisma.quotation.create({
            data: {
                code: finalCode, customerName, customerPhone, customerEmail,
                items: typeof items === 'string' ? items : JSON.stringify(items || []),
                subtotal: Number(subtotal) || finalTotal, discount: Number(discount) || 0,
                totalAmount: finalTotal,
                validUntil: validUntil ? new Date(validUntil) : null, notes,
            },
        })
        res.status(201).json({ success: true, data: { ...data, items: JSON.parse(data.items) } })
    } catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// PUT /api/quotations/:id
router.put('/:id', authMiddleware, validate(UpdateQuotationSchema), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { status, customerName, customerEmail, items, totalAmount, total, subtotal, discount, notes } = req.body
        const qId = String(req.params.id)
        const d: any = {}
        if (status) d.status = status
        if (customerName) d.customerName = customerName
        if (customerEmail !== undefined) d.customerEmail = customerEmail
        if (items) {
            d.items = typeof items === 'string' ? items : JSON.stringify(items)
        }
        if (subtotal !== undefined) d.subtotal = Number(subtotal)
        if (discount !== undefined) d.discount = Number(discount)
        if (totalAmount !== undefined) d.totalAmount = Number(totalAmount)
        else if (total !== undefined) d.totalAmount = Number(total)
        if (notes !== undefined) d.notes = notes
        const data = await prisma.quotation.update({ where: { id: qId }, data: d })
        res.json({ success: true, data: { ...data, items: JSON.parse(data.items) } })
    } catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// DELETE /api/quotations/:id
router.delete('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        await prisma.quotation.delete({ where: { id: String(req.params.id) } }); res.json({ success: true })
    }
    catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

export default router
