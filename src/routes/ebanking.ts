// ─────────────────────────────────────────────────────────────────────────────
//  Ngân hàng điện tử (E-Banking) — Phase 4 — mounted at /api/ebanking
//
//  Quản lý tài khoản ngân hàng + sao kê giao dịch + đối soát (reconciliation).
//  Chia sẻ bảng BankAccount/BankTransaction với /api/bank-accounts (mở rộng cột).
//
//  Routes:
//    GET    /accounts                       danh sách tài khoản
//    POST   /accounts                       thêm tài khoản
//    GET    /accounts/:id                    chi tiết tài khoản
//    PUT    /accounts/:id                    cập nhật
//    DELETE /accounts/:id                    xóa
//    GET    /accounts/:id/balance            số dư
//    GET    /accounts/:id/transactions       sao kê
//    POST   /accounts/:id/transactions       thêm giao dịch thủ công
//    POST   /accounts/:id/import-csv         nhập sao kê từ CSV
//    POST   /transactions/auto-reconcile     đối soát tự động
//    POST   /transactions/:id/reconcile      đối soát 1 giao dịch
//    GET    /dashboard                       tổng quan
// ─────────────────────────────────────────────────────────────────────────────

import { Router, Response } from 'express'
import { authMiddleware, AuthRequest, getBranchId, getBranchFilter } from '../middleware/auth'
import { requireRole } from '../middleware/roleMiddleware'
import { errMsg } from '../lib/errorResponse'

const router = Router()

const round2 = (v: any) => Math.round((Number(v) || 0) * 100) / 100

// ─── Table provisioning (per-schema, cached once per process) ────────────────
const ensuredSchemas = new Set<string>()
async function ensureTables(req: AuthRequest): Promise<void> {
    const prisma = req.storePrisma! as any
    const key = req.user?.branchSchema || req.user?.storeSchema || 'default'
    if (ensuredSchemas.has(key)) return
    try {
        // BankAccount / BankTransaction already exist (see /api/bank-accounts).
        // Create-if-missing covers fresh schemas; ALTER adds the Phase-4 columns.
        await prisma.$executeRawUnsafe(`
            CREATE TABLE IF NOT EXISTS "BankAccount" (
                "id" TEXT NOT NULL,
                "bankName" TEXT NOT NULL DEFAULT '',
                "accountNumber" TEXT NOT NULL DEFAULT '',
                "accountName" TEXT,
                "isDefault" BOOLEAN NOT NULL DEFAULT false,
                "status" TEXT NOT NULL DEFAULT 'active',
                "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT "BankAccount_pkey" PRIMARY KEY ("id")
            )
        `).catch(() => {})
        const baCols: Array<[string, string]> = [
            ['bankBranch', 'TEXT'],
            ['currency', `TEXT NOT NULL DEFAULT 'VND'`],
            ['balance', 'DOUBLE PRECISION NOT NULL DEFAULT 0'],
            ['lastSyncAt', 'TIMESTAMP(3)'],
            ['branchId', 'TEXT'],
        ]
        for (const [col, type] of baCols) {
            await prisma.$executeRawUnsafe(`ALTER TABLE "BankAccount" ADD COLUMN IF NOT EXISTS "${col}" ${type};`).catch(() => {})
        }
        await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "BankAccount_branchId_idx" ON "BankAccount"("branchId")`).catch(() => {})

        await prisma.$executeRawUnsafe(`
            CREATE TABLE IF NOT EXISTS "BankTransaction" (
                "id" TEXT NOT NULL,
                "bankAccountId" TEXT,
                "type" TEXT NOT NULL DEFAULT 'credit',
                "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
                "description" TEXT NOT NULL DEFAULT '',
                "reference" TEXT,
                "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT "BankTransaction_pkey" PRIMARY KEY ("id")
            )
        `).catch(() => {})
        const btCols: Array<[string, string]> = [
            ['transactionDate', 'TIMESTAMP(3)'],
            ['referenceNo', 'TEXT'],
            ['counterpartyName', 'TEXT'],
            ['counterpartyAccount', 'TEXT'],
            ['isReconciled', 'BOOLEAN NOT NULL DEFAULT false'],
            ['reconciledAt', 'TIMESTAMP(3)'],
            ['journalEntryId', 'TEXT'],
            ['matchedSaleId', 'TEXT'],
            ['matchedExpenseId', 'TEXT'],
            ['branchId', 'TEXT'],
            ['notes', 'TEXT'],
        ]
        for (const [col, type] of btCols) {
            await prisma.$executeRawUnsafe(`ALTER TABLE "BankTransaction" ADD COLUMN IF NOT EXISTS "${col}" ${type};`).catch(() => {})
        }
        await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "BankTransaction_isReconciled_idx" ON "BankTransaction"("isReconciled")`).catch(() => {})
        await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "BankTransaction_transactionDate_idx" ON "BankTransaction"("transactionDate")`).catch(() => {})
        await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "BankTransaction_branchId_idx" ON "BankTransaction"("branchId")`).catch(() => {})

        await prisma.$executeRawUnsafe(`
            CREATE TABLE IF NOT EXISTS "BankConnectionConfig" (
                "id" TEXT NOT NULL,
                "bankName" TEXT NOT NULL DEFAULT '',
                "apiUrl" TEXT, "apiKey" TEXT, "apiSecret" TEXT,
                "lastSyncAt" TIMESTAMP(3),
                "syncStatus" TEXT NOT NULL DEFAULT 'idle',
                "isActive" BOOLEAN NOT NULL DEFAULT true,
                "branchId" TEXT,
                "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT "BankConnectionConfig_pkey" PRIMARY KEY ("id")
            )
        `).catch(() => {})
        await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "BankConnectionConfig_isActive_idx" ON "BankConnectionConfig"("isActive")`).catch(() => {})
        ensuredSchemas.add(key)
    } catch (e: any) {
        console.error('ensureTables(ebanking) error:', e?.message || e)
    }
}

// type 'credit' (tiền vào) tăng số dư, 'debit' (tiền ra) giảm số dư.
const signed = (type: string, amount: number) => (type === 'debit' ? -1 : 1) * (Number(amount) || 0)

// Cập nhật số dư tài khoản.
async function applyToBalance(prisma: any, bankAccountId: string, delta: number) {
    /* Số dư cũ đọc hỏng ⇒ hàm lặng lẽ trả null ⇒ giao dịch VẪN được ghi nhưng SỐ DƯ KHÔNG ĐỔI:
     * sổ ngân hàng trôi dần khỏi chính các giao dịch của nó, không có dấu hiệu nào. Ghi hỏng cũng
     * vậy. Cả hai đều phải nổi lên để bên gọi biết mà xử (20/08/2026). */
    const acc = await prisma.bankAccount.findUnique({ where: { id: bankAccountId } })
    if (!acc) return null
    const balance = round2((Number(acc.balance) || 0) + delta)
    return prisma.bankAccount.update({ where: { id: bankAccountId }, data: { balance } })
}

const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

// ═════════════════════════════════════════════════════════════════════════════
//  Bank accounts
// ═════════════════════════════════════════════════════════════════════════════

// GET /api/ebanking/accounts
router.get('/accounts', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        await ensureTables(req)
        const prisma = req.storePrisma! as any
        const where: any = { ...getBranchFilter(req) }
        if (req.query.status) where.status = String(req.query.status)
        const data = await prisma.bankAccount.findMany({ where, orderBy: { createdAt: 'asc' } })
        res.json({ success: true, data })
    } catch (err: any) {
        console.error('GET /ebanking/accounts error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// POST /api/ebanking/accounts
router.post('/accounts', authMiddleware, requireRole('admin', 'manager', 'superadmin'), async (req: AuthRequest, res: Response) => {
    try {
        await ensureTables(req)
        const prisma = req.storePrisma! as any
        const b = req.body || {}
        if (!b.bankName?.trim() || !b.accountNumber?.trim()) {
            return res.status(400).json({ success: false, error: 'Tên ngân hàng (bankName) và số tài khoản (accountNumber) là bắt buộc' })
        }
        if (b.isDefault) await prisma.bankAccount.updateMany({ data: { isDefault: false } }).catch(() => {})
        const data = await prisma.bankAccount.create({
            data: {
                bankName: String(b.bankName).trim(),
                accountNumber: String(b.accountNumber).trim(),
                accountName: b.accountName?.trim() || null,
                bankBranch: b.bankBranch?.trim() || null,
                currency: b.currency || 'VND',
                balance: round2(b.balance),
                isDefault: !!b.isDefault,
                status: b.status || 'active',
                branchId: getBranchId(req) || null,
            },
        })
        res.status(201).json({ success: true, data })
    } catch (err: any) {
        console.error('POST /ebanking/accounts error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// GET /api/ebanking/accounts/:id
router.get('/accounts/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        await ensureTables(req)
        const prisma = req.storePrisma! as any
        const acc = await prisma.bankAccount.findUnique({ where: { id: String(req.params.id) } })
        if (!acc) return res.status(404).json({ success: false, error: 'Không tìm thấy tài khoản' })
        const txCount = await prisma.bankTransaction.count({ where: { bankAccountId: acc.id } })
        res.json({ success: true, data: { ...acc, transactionCount: txCount } })
    } catch (err: any) {
        console.error('GET /ebanking/accounts/:id error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// PUT /api/ebanking/accounts/:id
router.put('/accounts/:id', authMiddleware, requireRole('admin', 'manager', 'superadmin'), async (req: AuthRequest, res: Response) => {
    try {
        await ensureTables(req)
        const prisma = req.storePrisma! as any
        const id = String(req.params.id)
        // Đọc hỏng ≠ không tìm thấy.
        const acc = await prisma.bankAccount.findUnique({ where: { id } })
        if (!acc) return res.status(404).json({ success: false, error: 'Không tìm thấy tài khoản' })
        const b = req.body || {}
        if (b.isDefault) await prisma.bankAccount.updateMany({ data: { isDefault: false } }).catch(() => {})
        const data: any = {}
        for (const f of ['bankName', 'accountNumber', 'accountName', 'bankBranch', 'currency', 'status']) {
            if (b[f] !== undefined) data[f] = typeof b[f] === 'string' ? b[f].trim() : b[f]
        }
        if (b.isDefault !== undefined) data.isDefault = !!b.isDefault
        const updated = await prisma.bankAccount.update({ where: { id }, data })
        res.json({ success: true, data: updated })
    } catch (err: any) {
        console.error('PUT /ebanking/accounts/:id error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// DELETE /api/ebanking/accounts/:id
router.delete('/accounts/:id', authMiddleware, requireRole('admin', 'manager', 'superadmin'), async (req: AuthRequest, res: Response) => {
    try {
        await ensureTables(req)
        const prisma = req.storePrisma! as any
        const id = String(req.params.id)
        // Đọc hỏng ≠ không tìm thấy.
        const acc = await prisma.bankAccount.findUnique({ where: { id } })
        if (!acc) return res.status(404).json({ success: false, error: 'Không tìm thấy tài khoản' })
        /* ĐẾM HỎNG ⇒ 0 ⇒ chốt "còn giao dịch thì không cho xoá" TỰ MỞ, và tài khoản ngân hàng
         * kèm lịch sử bị xoá thật (20/08/2026). Đếm không được thì không xoá. */
        const txCount = await prisma.bankTransaction.count({ where: { bankAccountId: id } })
        if (txCount > 0) return res.status(400).json({ success: false, error: `Không thể xóa: tài khoản còn ${txCount} giao dịch` })
        await prisma.bankAccount.delete({ where: { id } })
        res.json({ success: true, data: { id, deleted: true } })
    } catch (err: any) {
        console.error('DELETE /ebanking/accounts/:id error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// GET /api/ebanking/accounts/:id/balance
router.get('/accounts/:id/balance', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        await ensureTables(req)
        const prisma = req.storePrisma! as any
        const id = String(req.params.id)
        const acc = await prisma.bankAccount.findUnique({ where: { id } })
        if (!acc) return res.status(404).json({ success: false, error: 'Không tìm thấy tài khoản' })
        /* Số dư tính lại từ giao dịch (đối chiếu với số dư lưu trữ). Nuốt lỗi ⇒ tính ra 0 ⇒ màn
         * hình báo "lệch toàn bộ số dư" — một cảnh báo giả trên tiền ngân hàng. */
        const txns = await prisma.bankTransaction.findMany({ where: { bankAccountId: id } })
        const computed = round2(txns.reduce((s: number, t: any) => s + signed(t.type, t.amount), 0))
        res.json({
            success: true,
            data: {
                bankAccountId: id, currency: acc.currency || 'VND',
                storedBalance: round2(acc.balance), computedFromTransactions: computed,
                inSync: round2(acc.balance) === computed, transactionCount: txns.length,
            },
        })
    } catch (err: any) {
        console.error('GET /ebanking/accounts/:id/balance error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// ═════════════════════════════════════════════════════════════════════════════
//  Transactions
// ═════════════════════════════════════════════════════════════════════════════

// GET /api/ebanking/accounts/:id/transactions
router.get('/accounts/:id/transactions', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        await ensureTables(req)
        const prisma = req.storePrisma! as any
        const id = String(req.params.id)
        const acc = await prisma.bankAccount.findUnique({ where: { id } }).catch(() => null)
        if (!acc) return res.status(404).json({ success: false, error: 'Không tìm thấy tài khoản' })
        const where: any = { bankAccountId: id }
        if (req.query.type) where.type = String(req.query.type)
        if (req.query.reconciled !== undefined) where.isReconciled = String(req.query.reconciled) === 'true'
        const page = Math.max(1, Number(req.query.page) || 1)
        const pageSize = Math.min(500, Math.max(1, Number(req.query.pageSize) || 100))
        const [total, data] = await Promise.all([
            // Nuốt lỗi ⇒ "0 giao dịch" trên sao kê một tài khoản đang có tiền chạy qua.
            prisma.bankTransaction.count({ where }),
            prisma.bankTransaction.findMany({ where, orderBy: { date: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
        ])
        res.json({ success: true, data, pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } })
    } catch (err: any) {
        console.error('GET /ebanking/accounts/:id/transactions error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// POST /api/ebanking/accounts/:id/transactions — thêm giao dịch thủ công
router.post('/accounts/:id/transactions', authMiddleware, requireRole('admin', 'manager', 'superadmin'), async (req: AuthRequest, res: Response) => {
    try {
        await ensureTables(req)
        const prisma = req.storePrisma! as any
        const id = String(req.params.id)
        const acc = await prisma.bankAccount.findUnique({ where: { id } }).catch(() => null)
        if (!acc) return res.status(404).json({ success: false, error: 'Không tìm thấy tài khoản' })
        const b = req.body || {}
        const type = b.type === 'debit' ? 'debit' : 'credit'
        const amount = round2(b.amount)
        if (amount <= 0) return res.status(400).json({ success: false, error: 'Số tiền (amount) phải > 0' })
        const when = b.transactionDate ? new Date(b.transactionDate) : new Date()

        /* Ghi giao dịch và cộng số dư phải CÙNG SỐNG CÙNG CHẾT (20/08/2026): trước đây tạo giao
         * dịch xong mới cộng số dư ở lệnh riêng — cộng hỏng thì giao dịch vẫn nằm đó còn số dư
         * đứng yên, sổ ngân hàng lệch dần mà không ai biết. */
        const { tx, account } = await prisma.$transaction(async (t: any) => {
            const tx = await t.bankTransaction.create({
                data: {
                    bankAccountId: id, type, amount,
                    description: b.description || (type === 'credit' ? 'Tiền vào' : 'Tiền ra'),
                    transactionDate: when, date: when,
                    reference: b.referenceNo || b.reference || null,
                    referenceNo: b.referenceNo || b.reference || null,
                    counterpartyName: b.counterpartyName ?? null,
                    counterpartyAccount: b.counterpartyAccount ?? null,
                    isReconciled: false,
                    notes: b.notes ?? null,
                    branchId: acc.branchId || getBranchId(req) || null,
                },
            })
            const account = await applyToBalance(t, id, signed(type, amount))
            return { tx, account }
        })
        res.status(201).json({ success: true, data: { transaction: tx, account } })
    } catch (err: any) {
        console.error('POST /ebanking/accounts/:id/transactions error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// POST /api/ebanking/accounts/:id/import-csv — nhập sao kê từ CSV
// Body: { csv: "date,amount,type,description,referenceNo,counterparty\n..." }
//   hoặc { rows: [{ transactionDate, amount, type, description, referenceNo, counterpartyName }] }
router.post('/accounts/:id/import-csv', authMiddleware, requireRole('admin', 'manager', 'superadmin'), async (req: AuthRequest, res: Response) => {
    try {
        await ensureTables(req)
        const prisma = req.storePrisma! as any
        const id = String(req.params.id)
        const acc = await prisma.bankAccount.findUnique({ where: { id } }).catch(() => null)
        if (!acc) return res.status(404).json({ success: false, error: 'Không tìm thấy tài khoản' })
        const b = req.body || {}

        let rows: any[] = []
        if (Array.isArray(b.rows)) {
            rows = b.rows
        } else if (typeof b.csv === 'string' && b.csv.trim()) {
            const lines = b.csv.split(/\r?\n/).map((l: string) => l.trim()).filter(Boolean)
            // Bỏ dòng tiêu đề nếu cột đầu không phải ngày.
            const looksLikeHeader = lines.length && /date|ngày|amount|số tiền/i.test(lines[0])
            const dataLines = looksLikeHeader ? lines.slice(1) : lines
            rows = dataLines.map((line: string) => {
                const c = line.split(',').map((x) => x.trim())
                return { transactionDate: c[0], amount: c[1], type: c[2], description: c[3], referenceNo: c[4], counterpartyName: c[5] }
            })
        } else {
            return res.status(400).json({ success: false, error: 'Cần cung cấp csv (chuỗi) hoặc rows (mảng)' })
        }
        if (rows.length === 0) return res.status(400).json({ success: false, error: 'Không có dòng dữ liệu để nhập' })

        let imported = 0, skipped = 0, balanceDelta = 0
        const errors: string[] = []
        for (let i = 0; i < rows.length; i++) {
            const r = rows[i]
            const amount = round2(r.amount)
            if (!amount || amount <= 0) { skipped++; errors.push(`Dòng ${i + 1}: số tiền không hợp lệ`); continue }
            const rawType = String(r.type || '').toLowerCase()
            const type = (rawType.includes('debit') || rawType.includes('ra') || rawType === '-' || amount < 0) ? 'debit' : 'credit'
            const when = r.transactionDate ? new Date(r.transactionDate) : new Date()
            const validDate = isNaN(when.getTime()) ? new Date() : when
            /* MỖI DÒNG một transaction nhỏ, KHÔNG ôm cả file trong một transaction: prod chỉ có
             * 1 kết nối Prisma, ôm cả file nghĩa là khoá API suốt lúc nhập. Đổi lại mỗi dòng đã
             * ghi thì số dư của nó cũng đã cộng — nhập dở chừng vẫn nhất quán (20/08/2026). */
            await prisma.$transaction(async (t: any) => {
                await t.bankTransaction.create({
                    data: {
                        bankAccountId: id, type, amount: Math.abs(amount),
                        description: r.description || 'Giao dịch nhập từ CSV',
                        transactionDate: validDate, date: validDate,
                        reference: r.referenceNo || null, referenceNo: r.referenceNo || null,
                        counterpartyName: r.counterpartyName || null,
                        isReconciled: false,
                        branchId: acc.branchId || getBranchId(req) || null,
                    },
                })
                await applyToBalance(t, id, signed(type, Math.abs(amount)))
            })
            imported++
            balanceDelta += signed(type, Math.abs(amount))
        }
        const account = await prisma.bankAccount.findUnique({ where: { id } })
        await prisma.bankAccount.update({ where: { id }, data: { lastSyncAt: new Date() } }).catch(() => {})
        res.json({ success: true, data: { imported, skipped, errors: errors.slice(0, 20), account } })
    } catch (err: any) {
        console.error('POST /ebanking/accounts/:id/import-csv error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// POST /api/ebanking/transactions/auto-reconcile — đối soát tự động
// Khớp tiền vào (credit) với đơn bán hàng và tiền ra (debit) với chi phí theo
// số tiền + ngày. Body/query: { bankAccountId? }
router.post('/transactions/auto-reconcile', authMiddleware, requireRole('admin', 'manager', 'superadmin'), async (req: AuthRequest, res: Response) => {
    try {
        await ensureTables(req)
        const prisma = req.storePrisma! as any
        const bankAccountId = req.query.bankAccountId || req.body?.bankAccountId
        const where: any = { isReconciled: false }
        if (bankAccountId) where.bankAccountId = String(bankAccountId)
        /* Cũng bỏ `.catch(() => [])`: đọc hỏng mà trả rỗng thì đối soát tự động báo "khớp 0 giao
         * dịch" y như khi thật sự không có gì để khớp. */
        const txns = await prisma.bankTransaction.findMany({ where, take: 1000 })

        let matched = 0
        const results: any[] = []
        for (const t of txns) {
            const amount = round2(t.amount)
            const when = new Date(t.transactionDate || t.date || t.createdAt)
            let matchedSaleId: string | null = null
            let matchedExpenseId: string | null = null

            if (t.type === 'credit') {
                // Khớp với đơn bán hàng theo tổng tiền + ngày.
                const sales = await prisma.transaction.findMany({
                    /* loc-trang-thai-co-y: doi soat tien vao chi khop don DA THU DU.
                     * Don ghi no tra no di duong pay-debt, so tien ve thuong khac
                     * tong don — khop theo tong don se ghep sai cap va sinh but
                     * toan sai, kho lan ra hon la khong khop duoc. */
                    where: { total: amount, status: 'completed' },
                    orderBy: { createdAt: 'desc' }, take: 50,
                }).catch(() => [])
                const hit = sales.find((s: any) => sameDay(new Date(s.transactionDate || s.createdAt), when))
                if (hit) matchedSaleId = hit.id
            } else {
                // Khớp với chi phí theo số tiền + ngày.
                const expenses = await prisma.expense.findMany({
                    where: { amount, status: 'active' },
                    orderBy: { createdAt: 'desc' }, take: 50,
                }).catch(() => [])
                const hit = expenses.find((e: any) => sameDay(new Date(e.date || e.createdAt), when))
                if (hit) matchedExpenseId = hit.id
            }

            if (matchedSaleId || matchedExpenseId) {
                await prisma.bankTransaction.update({
                    where: { id: t.id },
                    data: { isReconciled: true, reconciledAt: new Date(), matchedSaleId, matchedExpenseId },
                }).catch(() => {})
                matched++
                results.push({ transactionId: t.id, type: t.type, amount, matchedSaleId, matchedExpenseId })
            }
        }
        res.json({ success: true, data: { scanned: txns.length, matched, unmatched: txns.length - matched, results } })
    } catch (err: any) {
        console.error('POST /ebanking/transactions/auto-reconcile error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// POST /api/ebanking/transactions/:id/reconcile — đối soát thủ công 1 giao dịch
// Body: { matchedSaleId?, matchedExpenseId?, journalEntryId?, reconciled?,
//         counterAccount?, counterAccountName? }
// Khi đối soát và có counterAccount (mà chưa gắn bút toán), tự tạo bút toán:
//   credit (tiền vào): Nợ 112 / Có counterAccount
//   debit  (tiền ra) : Nợ counterAccount / Có 112
router.post('/transactions/:id/reconcile', authMiddleware, requireRole('admin', 'manager', 'superadmin'), async (req: AuthRequest, res: Response) => {
    try {
        await ensureTables(req)
        const prisma = req.storePrisma! as any
        const id = String(req.params.id)
        const tx = await prisma.bankTransaction.findUnique({ where: { id } }).catch(() => null)
        if (!tx) return res.status(404).json({ success: false, error: 'Không tìm thấy giao dịch' })
        const b = req.body || {}
        // FE gửi { matchType: 'sale'|'expense', matchId } — quy về matchedSaleId/matchedExpenseId
        if (b.matchType && b.matchId) {
            if (b.matchType === 'sale') b.matchedSaleId = b.matchId
            else if (b.matchType === 'expense') b.matchedExpenseId = b.matchId
        }
        const reconciled = b.reconciled === undefined ? true : !!b.reconciled

        // Tạo bút toán nếu được yêu cầu (có counterAccount) và chưa có bút toán.
        let journalEntryId: string | null = b.journalEntryId ?? tx.journalEntryId ?? null
        let journalEntry: any = null
        if (reconciled && !journalEntryId && b.counterAccount) {
            const amount = round2(tx.amount)
            if (amount > 0) {
                const counter = String(b.counterAccount)
                const counterName = b.counterAccountName || ''
                const isCredit = tx.type !== 'debit'
                const debitAccount = isCredit ? '112' : counter
                const debitAccountName = isCredit ? 'Tiền gửi ngân hàng' : counterName
                const creditAccount = isCredit ? counter : '112'
                const creditAccountName = isCredit ? counterName : 'Tiền gửi ngân hàng'
                const when = new Date(tx.transactionDate || tx.date || tx.createdAt)
                const date = (isNaN(when.getTime()) ? new Date() : when).toISOString().slice(0, 10)
                journalEntry = await prisma.journalEntry.create({
                    data: {
                        date, description: `Đối soát NH: ${tx.description || ''}`.trim(),
                        debitAccount, debitAccountName, creditAccount, creditAccountName,
                        amount, reference: `RECON-${tx.referenceNo || tx.reference || id}`,
                        referenceType: 'bank_reconcile', branchId: tx.branchId || getBranchId(req) || null,
                        createdBy: req.user?.userId || null,
                    },
                }).catch((e: any) => { console.error('reconcile journal error:', e?.message); return null })
                if (journalEntry) journalEntryId = journalEntry.id
            }
        }

        const updated = await prisma.bankTransaction.update({
            where: { id },
            data: {
                isReconciled: reconciled,
                reconciledAt: reconciled ? new Date() : null,
                matchedSaleId: b.matchedSaleId ?? tx.matchedSaleId ?? null,
                matchedExpenseId: b.matchedExpenseId ?? tx.matchedExpenseId ?? null,
                journalEntryId,
            },
        })
        res.json({ success: true, data: { transaction: updated, journalEntry } })
    } catch (err: any) {
        console.error('POST /ebanking/transactions/:id/reconcile error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// ═════════════════════════════════════════════════════════════════════════════
//  FE-compat aliases — màn hình dashboard-ebanking (useEBanking.ts) được viết
//  theo spec "Phase 4" khác path/shape với các route gốc ở trên. Bộ alias này
//  nhận đúng path + shape FE gửi và trả đúng shape FE đọc, để màn đối soát
//  ngân hàng hoạt động mà không phải sửa cả hai phía.
// ═════════════════════════════════════════════════════════════════════════════

// Map BankTransaction (DB) → shape FE: accountId, amount CÓ DẤU (âm = tiền ra),
// direction, reconciled, matchType/matchId.
function toFeTxn(t: any, accNameById?: Map<string, string>): any {
    const amt = Number(t.amount) || 0
    const isDebit = t.type === 'debit'
    return {
        id: t.id,
        accountId: t.bankAccountId,
        accountName: accNameById?.get(t.bankAccountId) || '',
        date: (t.transactionDate || t.date || t.createdAt)?.toISOString?.() || t.date,
        description: t.description || '',
        reference: t.referenceNo || t.reference || '',
        amount: isDebit ? -Math.abs(amt) : Math.abs(amt),
        direction: isDebit ? 'debit' : 'credit',
        balance: 0,
        reconciled: !!t.isReconciled,
        matchType: t.matchedSaleId ? 'sale' : t.matchedExpenseId ? 'expense' : null,
        matchId: t.matchedSaleId || t.matchedExpenseId || null,
        counterparty: t.counterpartyName || '',
    }
}

// GET /api/ebanking/transactions?accountId=&from=&to=&reconciled=
router.get('/transactions', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        await ensureTables(req)
        const prisma = req.storePrisma! as any
        // Cùng lý do với /summary: tổng số dư 0đ do đọc hỏng là trấn an sai trên tiền ngân hàng.
        const accounts = await prisma.bankAccount.findMany({ where: { ...getBranchFilter(req) } })
        const accNameById = new Map<string, string>(accounts.map((a: any) => [a.id, a.accountName || a.bankName || '']))

        const where: any = {}
        const accountId = req.query.accountId ? String(req.query.accountId) : ''
        if (accountId && accountId !== 'ALL') where.bankAccountId = accountId
        else if (accounts.length) where.bankAccountId = { in: accounts.map((a: any) => a.id) }
        if (req.query.reconciled !== undefined) where.isReconciled = String(req.query.reconciled) === 'true'
        const from = String(req.query.from || '')
        const to = String(req.query.to || '')
        if (/^\d{4}-\d{2}-\d{2}$/.test(from) || /^\d{4}-\d{2}-\d{2}$/.test(to)) {
            where.date = {
                ...(from ? { gte: new Date(`${from}T00:00:00.000Z`) } : {}),
                ...(to ? { lte: new Date(`${to}T23:59:59.999Z`) } : {}),
            }
        }

        /* KHÔNG `.catch(() => [])` (20/08/2026): ensureTables() đã tạo bảng nếu thiếu, nên lỗi đọc
         * ở đây là lỗi thật. Nuốt nó thành mảng rỗng + HTTP 200 nghĩa là màn hình sao kê hiện
         * "chưa có giao dịch nào" — trình duyệt không có cách nào biết là hỏng. Thà 500. */
        const TRAN_SAO_KE = 1000
        const data = await prisma.bankTransaction.findMany({ where, orderBy: { date: 'desc' }, take: TRAN_SAO_KE })
        res.json({ success: true, daCatBot: data.length >= TRAN_SAO_KE, data: data.map((t: any) => toFeTxn(t, accNameById)) })
    } catch (err: any) {
        console.error('GET /ebanking/transactions error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// POST /api/ebanking/transactions — thêm GD thủ công (amount có dấu hoặc direction)
router.post('/transactions', authMiddleware, requireRole('admin', 'manager', 'superadmin'), async (req: AuthRequest, res: Response) => {
    try {
        await ensureTables(req)
        const prisma = req.storePrisma! as any
        const b = req.body || {}
        const accountId = String(b.accountId || '')
        const acc = accountId ? await prisma.bankAccount.findUnique({ where: { id: accountId } }).catch(() => null) : null
        if (!acc) return res.status(400).json({ success: false, error: 'accountId không hợp lệ' })

        const raw = Number(b.amount) || 0
        const type = b.direction === 'debit' || raw < 0 ? 'debit' : 'credit'
        const amount = round2(Math.abs(raw))
        if (amount <= 0) return res.status(400).json({ success: false, error: 'Số tiền phải khác 0' })
        const when = b.date ? new Date(b.date) : new Date()

        // Cùng luật với POST /accounts/:id/transactions: ghi giao dịch và cộng số dư cùng một khối.
        const tx = await prisma.$transaction(async (t: any) => {
            const row = await t.bankTransaction.create({
                data: {
                    bankAccountId: accountId, type, amount,
                    description: b.description || (type === 'credit' ? 'Tiền vào' : 'Tiền ra'),
                    transactionDate: when, date: when,
                    reference: b.reference || null, referenceNo: b.reference || null,
                    counterpartyName: b.counterparty || null,
                    isReconciled: false,
                    branchId: acc.branchId || getBranchId(req) || null,
                },
            })
            await applyToBalance(t, accountId, signed(type, amount))
            return row
        })
        res.status(201).json({ success: true, data: toFeTxn(tx) })
    } catch (err: any) {
        console.error('POST /ebanking/transactions error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// POST /api/ebanking/transactions/import — { accountId, rows } (CSV đã parse phía FE)
router.post('/transactions/import', authMiddleware, requireRole('admin', 'manager', 'superadmin'), async (req: AuthRequest, res: Response) => {
    try {
        await ensureTables(req)
        const prisma = req.storePrisma! as any
        const b = req.body || {}
        const accountId = String(b.accountId || '')
        const acc = accountId ? await prisma.bankAccount.findUnique({ where: { id: accountId } }).catch(() => null) : null
        if (!acc) return res.status(400).json({ success: false, error: 'accountId không hợp lệ' })
        const rows: any[] = Array.isArray(b.rows) ? b.rows : []
        if (rows.length === 0) return res.status(400).json({ success: false, error: 'Không có dòng dữ liệu để nhập' })

        let imported = 0, skipped = 0, balanceDelta = 0
        for (const r of rows) {
            const raw = Number(r.amount) || 0
            if (!raw) { skipped++; continue }
            const rawType = String(r.type ?? r.direction ?? '').toLowerCase()
            const type = (rawType.includes('debit') || rawType.includes('ra') || raw < 0) ? 'debit' : 'credit'
            const amount = round2(Math.abs(raw))
            const when = new Date(r.transactionDate || r.date || Date.now())
            const validDate = isNaN(when.getTime()) ? new Date() : when
            /* Bản cũ có hai lỗi: (1) ghi hỏng thì `.catch` chỉ đếm skipped, nhưng `balanceDelta`
             * VẪN cộng ⇒ số dư tính cả dòng chưa hề ghi được; (2) số dư cộng một lần ở cuối, hỏng
             * là cả file có giao dịch mà không có số dư. Nay mỗi dòng một transaction nhỏ, và chỉ
             * dòng nào ghi được mới cộng (20/08/2026). */
            try {
                await prisma.$transaction(async (t: any) => {
                    await t.bankTransaction.create({
                        data: {
                            bankAccountId: accountId, type, amount,
                            description: r.description || 'Giao dịch nhập từ CSV',
                            transactionDate: validDate, date: validDate,
                            reference: r.referenceNo || r.reference || null,
                            referenceNo: r.referenceNo || r.reference || null,
                            counterpartyName: r.counterpartyName || r.counterparty || null,
                            isReconciled: false,
                            branchId: acc.branchId || getBranchId(req) || null,
                        },
                    })
                    await applyToBalance(t, accountId, signed(type, amount))
                })
                imported++
                balanceDelta += signed(type, amount)
            } catch { skipped++ }
        }
        await prisma.bankAccount.update({ where: { id: accountId }, data: { lastSyncAt: new Date() } }).catch(() => { })
        res.json({ success: true, data: { imported, skipped } })
    } catch (err: any) {
        console.error('POST /ebanking/transactions/import error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// POST /api/ebanking/reconcile/auto — { accountId? } (alias của transactions/auto-reconcile)
router.post('/reconcile/auto', authMiddleware, requireRole('admin', 'manager', 'superadmin'), async (req: AuthRequest, res: Response) => {
    try {
        await ensureTables(req)
        const prisma = req.storePrisma! as any
        const accountId = req.body?.accountId ? String(req.body.accountId) : ''
        const where: any = { isReconciled: false }
        if (accountId && accountId !== 'ALL') where.bankAccountId = accountId
        const txns = await prisma.bankTransaction.findMany({ where, take: 1000 }).catch(() => [])

        let matched = 0
        for (const t of txns) {
            const amount = round2(t.amount)
            const when = new Date(t.transactionDate || t.date || t.createdAt)
            let matchedSaleId: string | null = null
            let matchedExpenseId: string | null = null
            if (t.type === 'credit') {
                const sales = await prisma.transaction.findMany({
                    /* loc-trang-thai-co-y: doi soat tien vao chi khop don DA THU DU.
                     * Don ghi no tra no di duong pay-debt, so tien ve thuong khac
                     * tong don — khop theo tong don se ghep sai cap va sinh but
                     * toan sai, kho lan ra hon la khong khop duoc. */
                    where: { total: amount, status: 'completed' },
                    orderBy: { createdAt: 'desc' }, take: 50,
                }).catch(() => [])
                const hit = sales.find((s: any) => sameDay(new Date(s.transactionDate || s.createdAt), when))
                if (hit) matchedSaleId = hit.id
            } else {
                const expenses = await prisma.expense.findMany({
                    where: { amount, status: 'active' },
                    orderBy: { createdAt: 'desc' }, take: 50,
                }).catch(() => [])
                const hit = expenses.find((e: any) => sameDay(new Date(e.date || e.createdAt), when))
                if (hit) matchedExpenseId = hit.id
            }
            if (matchedSaleId || matchedExpenseId) {
                await prisma.bankTransaction.update({
                    where: { id: t.id },
                    data: { isReconciled: true, reconciledAt: new Date(), matchedSaleId, matchedExpenseId },
                }).catch(() => { })
                matched++
            }
        }
        res.json({ success: true, data: { scanned: txns.length, matched } })
    } catch (err: any) {
        console.error('POST /ebanking/reconcile/auto error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// GET /api/ebanking/overview — tổng quan theo shape FE (kèm unreconciledAmount + series 6 tháng)
router.get('/overview', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        await ensureTables(req)
        const prisma = req.storePrisma! as any
        // /overview: nuốt lỗi ⇒ tổng số dư 0đ + biểu đồ 6 tháng phẳng lì, trông như không có tiền.
        const accounts = await prisma.bankAccount.findMany({ where: { ...getBranchFilter(req) } })
        const totalBalance = round2(accounts.reduce((s: number, a: any) => s + (Number(a.balance) || 0), 0))
        const accIds = accounts.map((a: any) => a.id)
        const txWhere: any = accIds.length ? { bankAccountId: { in: accIds } } : {}

        const unrec = await prisma.bankTransaction.findMany({ where: { ...txWhere, isReconciled: false }, select: { amount: true } })
        const unreconciledAmount = round2(unrec.reduce((s: number, t: any) => s + Math.abs(Number(t.amount) || 0), 0))

        // Series 6 tháng gần nhất: tổng tiền vào/ra theo tháng
        const now = new Date()
        const seriesStart = new Date(now.getFullYear(), now.getMonth() - 5, 1)
        const txns = await prisma.bankTransaction.findMany({
            where: { ...txWhere, date: { gte: seriesStart } },
            select: { amount: true, type: true, date: true },
        })
        const buckets = new Map<string, { inflow: number; outflow: number }>()
        for (let i = 0; i < 6; i++) {
            const d = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1)
            buckets.set(`${d.getMonth() + 1}/${d.getFullYear()}`, { inflow: 0, outflow: 0 })
        }
        for (const t of txns) {
            const d = new Date(t.date)
            const key = `${d.getMonth() + 1}/${d.getFullYear()}`
            const bucket = buckets.get(key)
            if (!bucket) continue
            if (t.type === 'debit') bucket.outflow += Number(t.amount) || 0
            else bucket.inflow += Number(t.amount) || 0
        }

        res.json({
            success: true,
            data: {
                accounts: accounts.map((a: any) => ({
                    id: a.id, accountName: a.accountName || '', bankName: a.bankName || '',
                    accountNumber: a.accountNumber || '', balance: round2(a.balance), currency: a.currency || 'VND',
                })),
                totalBalance,
                unreconciledCount: unrec.length,
                unreconciledAmount,
                series: Array.from(buckets.entries()).map(([label, v]) => ({ label, inflow: round2(v.inflow), outflow: round2(v.outflow) })),
            },
        })
    } catch (err: any) {
        console.error('GET /ebanking/overview error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// GET /api/ebanking/dashboard — tổng quan
router.get('/dashboard', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        await ensureTables(req)
        const prisma = req.storePrisma! as any
        const filter = getBranchFilter(req)
        /* Bảng tổng ngân hàng: nuốt lỗi ⇒ "tổng số dư 0đ, 0 giao dịch chưa đối soát" — trấn an
         * sai trên tiền mặt trong ngân hàng (20/08/2026). */
        const accounts = await prisma.bankAccount.findMany({ where: { ...filter } })
        const totalBalance = round2(accounts.reduce((s: number, a: any) => s + (Number(a.balance) || 0), 0))

        const accIds = accounts.map((a: any) => a.id)
        const txWhere: any = accIds.length ? { bankAccountId: { in: accIds } } : {}
        const [unreconciled, recent] = await Promise.all([
            prisma.bankTransaction.count({ where: { ...txWhere, isReconciled: false } }),
            prisma.bankTransaction.findMany({ where: txWhere, orderBy: { date: 'desc' }, take: 10 }),
        ])

        // Tổng tiền vào/ra trong tháng hiện tại.
        const now = new Date()
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
        const monthTxns = await prisma.bankTransaction.findMany({
            where: { ...txWhere, date: { gte: monthStart } },
        })
        let monthCredit = 0, monthDebit = 0
        for (const t of monthTxns) {
            if (t.type === 'debit') monthDebit += Number(t.amount) || 0
            else monthCredit += Number(t.amount) || 0
        }

        res.json({
            success: true,
            data: {
                accountCount: accounts.length,
                totalBalance,
                unreconciledCount: unreconciled,
                month: { credit: round2(monthCredit), debit: round2(monthDebit), net: round2(monthCredit - monthDebit) },
                accounts: accounts.map((a: any) => ({ id: a.id, bankName: a.bankName, accountNumber: a.accountNumber, balance: round2(a.balance), currency: a.currency || 'VND' })),
                recentTransactions: recent,
            },
        })
    } catch (err: any) {
        console.error('GET /ebanking/dashboard error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// ═════════════════════════════════════════════════════════════════════════════
//  Bank connection config (provider open-banking credentials) — STUB sync
// ═════════════════════════════════════════════════════════════════════════════

function maskConfig(c: any) {
    if (!c) return null
    return {
        id: c.id, bankName: c.bankName, apiUrl: c.apiUrl || '',
        apiKey: c.apiKey ? '********' : '',
        apiSecret: c.apiSecret ? '********' : '',
        lastSyncAt: c.lastSyncAt, syncStatus: c.syncStatus || 'idle',
        isActive: c.isActive ?? true, createdAt: c.createdAt, updatedAt: c.updatedAt,
    }
}

// GET /api/ebanking/connections — list configured bank connections (secrets masked)
router.get('/connections', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        await ensureTables(req)
        const prisma = req.storePrisma! as any
        const data = await prisma.bankConnectionConfig.findMany({ orderBy: { createdAt: 'asc' } }).catch(() => [])
        res.json({ success: true, data: data.map(maskConfig) })
    } catch (err: any) {
        console.error('GET /ebanking/connections error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// POST /api/ebanking/connections — create/update a bank connection config
router.post('/connections', authMiddleware, requireRole('admin', 'manager', 'superadmin'), async (req: AuthRequest, res: Response) => {
    try {
        await ensureTables(req)
        const prisma = req.storePrisma! as any
        const b = req.body || {}
        if (!b.bankName?.trim()) return res.status(400).json({ success: false, error: 'Tên ngân hàng (bankName) là bắt buộc' })
        const existing = await prisma.bankConnectionConfig.findFirst({ where: { bankName: String(b.bankName).trim() } }).catch(() => null)
        const data: any = {
            bankName: String(b.bankName).trim(),
            apiUrl: b.apiUrl ?? null,
            isActive: b.isActive === undefined ? true : !!b.isActive,
        }
        if (b.apiKey !== undefined && b.apiKey !== '********') data.apiKey = b.apiKey || null
        if (b.apiSecret !== undefined && b.apiSecret !== '********') data.apiSecret = b.apiSecret || null
        const saved = existing
            ? await prisma.bankConnectionConfig.update({ where: { id: existing.id }, data })
            : await prisma.bankConnectionConfig.create({ data: { ...data, branchId: getBranchId(req) || null, syncStatus: 'idle' } })
        res.status(existing ? 200 : 201).json({ success: true, data: maskConfig(saved) })
    } catch (err: any) {
        console.error('POST /ebanking/connections error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// DELETE /api/ebanking/connections/:id
router.delete('/connections/:id', authMiddleware, requireRole('admin', 'manager', 'superadmin'), async (req: AuthRequest, res: Response) => {
    try {
        await ensureTables(req)
        const prisma = req.storePrisma! as any
        const id = String(req.params.id)
        const cfg = await prisma.bankConnectionConfig.findUnique({ where: { id } }).catch(() => null)
        if (!cfg) return res.status(404).json({ success: false, error: 'Không tìm thấy kết nối' })
        await prisma.bankConnectionConfig.delete({ where: { id } })
        res.json({ success: true, data: { id, deleted: true } })
    } catch (err: any) {
        console.error('DELETE /ebanking/connections/:id error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// POST /api/ebanking/connections/:id/sync — STUB: simulate a statement sync.
router.post('/connections/:id/sync', authMiddleware, requireRole('admin', 'manager', 'superadmin'), async (req: AuthRequest, res: Response) => {
    try {
        await ensureTables(req)
        const prisma = req.storePrisma! as any
        const id = String(req.params.id)
        const cfg = await prisma.bankConnectionConfig.findUnique({ where: { id } }).catch(() => null)
        if (!cfg) return res.status(404).json({ success: false, error: 'Không tìm thấy kết nối' })
        // STUB: real implementation would call the bank's open-banking API.
        console.log(`[ebanking][STUB] sync bank=${cfg.bankName} url=${cfg.apiUrl || '(none)'}`)
        const updated = await prisma.bankConnectionConfig.update({
            where: { id }, data: { lastSyncAt: new Date(), syncStatus: 'idle' },
        })
        res.json({ success: true, data: { connection: maskConfig(updated), message: `Đồng bộ sao kê ${cfg.bankName} thành công (mô phỏng)`, imported: 0 } })
    } catch (err: any) {
        console.error('POST /ebanking/connections/:id/sync error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

export default router
