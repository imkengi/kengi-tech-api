import { Router, Request, Response } from 'express'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { requireRole } from '../middleware/roleMiddleware'
import { postDebtCollectionJournal } from '../lib/autoJournal'

const router = Router()

// Nhận diện bút toán điều chỉnh/hủy (không phải giao dịch bán/thu thật) để loại khỏi
// "chi tiết công nợ". Cũng loại "Nợ từ HĐ" vì nợ hóa đơn đã được liệt kê từ txEntries.
const isAdjustmentDesc = (d: string | null | undefined) =>
    /hủy|xóa nợ|ghi nợ lại|điều chỉnh|nợ từ hđ/i.test(d || '')

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

        // KHÁCH TRẢ TRƯỚC (số dư có, debt âm). Tổng nợ ở trên chỉ cộng người
        // ĐANG NỢ; phần mềm khác (KiotViet…) lại cộng đại số cả âm lẫn dương,
        // nên đối chiếu hai bên thấy lệch đúng bằng khoản này. Trả thêm để
        // người dùng soát được thay vì ngồi đoán (2026-08-07).
        const credits = await prisma.customer.aggregate({
            where: { debt: { lt: 0 } }, _sum: { debt: true }, _count: true,
        })
        const creditBalance = Math.abs(credits._sum.debt || 0)

        res.json({
            success: true,
            data: {
                totalDebt, count, avgDebt, largest,
                creditBalance, creditCount: credits._count || 0,
                netDebt: totalDebt - creditBalance,
            },
        })
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
        // 1. Khách có SỐ DƯ CÔNG NỢ — cả nợ (dương) LẪN trả thừa (âm).
        //
        // Trước đây chỉ lấy debt > 0 nên khách trả thừa không bao giờ về tới
        // giao diện: bộ lọc "Trả thừa" luôn rỗng, và ô TỔNG NỢ cộng thiếu phần
        // âm nên lệch với phần mềm khác (KiotViet cộng đại số). Đo 07/08/2026:
        // Kengi 4.610.937.864 vs KiotViet 4.609.128.863 — chênh đúng 1.809.001
        // là tiền 2 khách trả trước. Trang đã sẵn sàng xử lý số âm (lọc, đếm,
        // cộng đại số); chỉ thiếu dữ liệu ở đây.
        const customersWithDebt = await prisma.customer.findMany({
            where: { debt: { not: 0 } },
            select: { id: true, name: true, phone: true, debt: true },
        })

        // 2. Get all debt entries
        const entries = await prisma.debtEntry.findMany({ orderBy: { createdAt: 'asc' } })

        // 3. Get transactions with unpaid amounts (same pattern as customer debt-history)
        const debtTransactions = await prisma.transaction.findMany({
            where: {
                customerId: { not: null },
                status: { notIn: ['voided', 'returned'] },
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
            totalDebt: number; openingBalance: number; entries: any[]
        }> = {}

        // Add customers with debt from Customer model.
        // Chi tiết công nợ = hóa đơn bán chưa thu (nguồn phát sinh nợ) + các lần thu nợ.
        // Loại bút toán điều chỉnh/hủy (churn). Tổng nợ vẫn lấy Customer.debt (uy quyền);
        // phần chưa liệt kê được dồn vào "dư nợ đầu kỳ" để phiếu luôn cân đối.
        for (const c of customersWithDebt) {
            const debtEntries = entryMap[c.id] || []
            const txEntries = txEntryMap[c.id] || []

            const payments = debtEntries.filter(e => e.type === 'payment')
            const manualDebts = debtEntries.filter(e => e.type === 'debt' && !isAdjustmentDesc(e.description))
            const completed = [...txEntries, ...manualDebts, ...payments].sort((a, b) =>
                new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
            )

            const net = completed.reduce((s, e) => s + (e.type === 'payment' ? -e.amount : e.amount), 0)
            const openingBalance = c.debt - net
            // Số dư luỹ kế: bắt đầu từ dư nợ đầu kỳ, kết thúc đúng bằng tổng nợ.
            let running = openingBalance
            for (const e of completed) {
                running += e.type === 'payment' ? -e.amount : e.amount
                e.balance = running
            }

            summaryMap[c.id] = {
                customerId: c.id,
                customerName: c.name,
                phone: c.phone || '',
                totalDebt: c.debt,
                openingBalance,
                entries: completed,
            }
        }

        /* KHÁCH SỔ = 0 NHƯNG CÓ CHỨNG TỪ TREO (bút toán cũ / hoá đơn chưa gắn phiếu thu — KiotViet
         * thu gộp): sổ (Customer.debt) là nguồn sự thật, chứng từ treo là nguồn PHỤ — không được lấy nó
         * làm "tổng nợ". Bản cũ gán totalDebt = Σ chứng từ ⇒ HUTI 18/08/2026: trang Công Nợ đếm 175 khách /
         * 4,79 tỷ trong khi sổ (và KiotViet, và trang Khách Hàng) nói 170 / 4,76 tỷ — 5 khách sổ 0 (Yến Hồng
         * Hưng 29,2tr, Tuấn Phú 4,2tr…) bị dán nợ oan, đúng ca "phiếu treo ≠ nợ" của trang Sức khoẻ. Nay:
         * totalDebt = 0, số dư đầu kỳ âm để sổ chi tiết vẫn cân về 0, kèm `phieuTreo` để ai cần thì thấy. */
        const themKhachSoKhong = (custId: string, ten: string, sdt: string, ds: any[]) => {
            const dsSap = [...ds].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
            const net = dsSap.reduce((s2, e) => s2 + (e.type === 'payment' ? -e.amount : e.amount), 0)
            let running = -net
            for (const e of dsSap) { running += e.type === 'payment' ? -e.amount : e.amount; e.balance = running }
            summaryMap[custId] = {
                customerId: custId, customerName: ten, phone: sdt,
                totalDebt: 0, openingBalance: -net, entries: dsSap,
                ...({ phieuTreo: Math.max(0, net), phieuTreoKhongPhaiNo: true } as any),
            }
        }
        // DebtEntry customers not yet in the map (sổ 0)
        for (const [custId, custEntries] of Object.entries(entryMap)) {
            if (!summaryMap[custId]) {
                const last = custEntries[custEntries.length - 1]
                // cùng bộ lọc với nhánh chính: phiếu thu + ghi nợ tay (bỏ bút toán điều chỉnh/huỷ) + hoá đơn chưa thu
                const chon = custEntries.filter(e => e.type === 'payment' || (e.type === 'debt' && !isAdjustmentDesc(e.description)))
                themKhachSoKhong(custId, last.customerName, last.phone || '', [...chon, ...(txEntryMap[custId] || [])])
            }
        }
        // tx-only customers not yet in the map (sổ 0)
        for (const [custId, txEntries] of Object.entries(txEntryMap)) {
            if (!summaryMap[custId] && txEntries.length > 0) {
                const cust = customersWithDebt.find(c => c.id === custId)
                themKhachSoKhong(custId, cust?.name || txEntries[0].customerName || 'Khách lẻ', cust?.phone || '', txEntries)
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
// Ghi nợ/thu nợ thủ công điều chỉnh thẳng số dư khách → chỉ admin/manager
// (cùng pattern requireRole của cashReceipts/accounting)
router.post('/', authMiddleware, requireRole('admin', 'manager', 'superadmin'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { customerId, customerName, phone, type, amount, description, paymentType } = req.body
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
            /* CỘNG/TRỪ NGUYÊN TỬ, không ghi đè bằng số đọc TRƯỚC transaction (20/08/2026):
             * `debt: newBalance` với newBalance tính từ lần đọc bên ngoài là "lost update" —
             * hai thao tác cùng lúc thì cái sau đè cái trước. Cập nhật nợ TRƯỚC để lấy số dư
             * thật, rồi mới ghi DebtEntry với đúng số đó. */
            const sau = await tx.customer.update({
                where: { id: customer.id },
                data: type === 'payment'
                    ? { debt: { decrement: entryAmount } }
                    : { debt: { increment: entryAmount } },
                select: { debt: true },
            })
            let soDu = Number(sau?.debt) || 0
            if (soDu < 0) {
                await tx.customer.update({ where: { id: customer.id }, data: { debt: 0 } })
                soDu = 0
            }
            const created = await tx.debtEntry.create({
                data: {
                    customerId: customer.id,
                    customerName: customerName?.trim() || customer.name || 'Khách hàng',
                    phone: phone || customer.phone || null,
                    type: type || 'debt',
                    amount: entryAmount,
                    description: description?.trim() || (type === 'payment' ? 'Trả nợ' : 'Ghi nợ'),
                    balance: soDu,
                },
            })
            // Thu nợ phải có bút toán giảm phải thu: Nợ 111/112 / Có 131.
            // refKey xác định theo DebtEntry vừa tạo — idempotent khi retry
            // nhờ JournalEntry.reference @unique (P2002 = đã post, hàm tự bỏ qua).
            if ((type || 'debt') === 'payment') {
                await postDebtCollectionJournal(tx, {
                    amount: entryAmount,
                    refKey: `COLLECT-DEBT-${created.id}`,
                    date: new Date().toISOString().slice(0, 10),
                    paymentType: paymentType || null,
                    customerName: customer.name,
                    branchId: req.user?.branchId ?? null,
                    userId: req.user?.userId ?? null,
                })
            }
            return created
        })
        res.status(201).json({ success: true, data: entry })
    } catch (err) {
        console.error('Create debt entry error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// DELETE /api/debts/:id — remove a ledger entry AND undo its effect on the balance
// Xóa bút toán làm thay đổi số dư khách → chỉ admin/manager (pattern requireRole của repo)
router.delete('/:id', authMiddleware, requireRole('admin', 'manager', 'superadmin'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const entry = await prisma.debtEntry.findUnique({ where: { id: String(req.params.id) } })
        if (!entry) return res.status(404).json({ success: false, error: 'Không tìm thấy bút toán' })

        // Entry "Nợ từ HĐ" gắn với hóa đơn còn 'partial' — xóa ở đây làm debt giảm
        // nhưng hóa đơn vẫn treo → /debts/summary sinh dư nợ đầu kỳ âm. Chặn lại.
        if ((entry.description || '').startsWith('Nợ từ HĐ')) {
            return res.status(400).json({ success: false, error: 'Không thể xóa bút toán gắn hóa đơn — hãy void/điều chỉnh hóa đơn gốc' })
        }

        await prisma.$transaction(async (tx) => {
            await tx.debtEntry.delete({ where: { id: entry.id } })
            const customer = await tx.customer.findUnique({
                where: { id: entry.customerId },
                select: { debt: true },
            })
            if (!customer) return // customer already deleted — nothing to adjust
            /* Xoá dòng 'debt' thì bớt nợ, xoá 'payment'/'return' thì trả nợ lại. Dùng cộng/trừ
             * nguyên tử rồi kẹp ≥ 0 — cùng lý do với đường tạo dòng ở trên. */
            const sau = await tx.customer.update({
                where: { id: entry.customerId },
                data: entry.type === 'debt'
                    ? { debt: { decrement: entry.amount } }
                    : { debt: { increment: entry.amount } },
                select: { debt: true },
            })
            if ((Number(sau?.debt) || 0) < 0) {
                await tx.customer.update({ where: { id: entry.customerId }, data: { debt: 0 } })
            }
        })

        res.json({ success: true })
    } catch (err) {
        console.error('Delete debt entry error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

export default router
