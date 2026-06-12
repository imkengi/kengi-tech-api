// Helpers for auto-generating JournalEntry records from POS transactions.
// Used by both the live POS flow (POST /api/transactions) and the
// batch backfill endpoint (POST /api/tax/auto-journal).
//
// Auto-generated entries are tagged via JournalEntry.referenceType
// (anything other than "manual"), and each entry's `reference` field
// follows a deterministic prefix-based scheme so re-runs are idempotent
// and DELETE /api/tax/auto-journal can clean them up safely.

// referenceType values reserved for auto-generated entries.
// Manual entries keep the model default of "manual".
export const AUTO_JOURNAL_REF_TYPES = [
    'sale',
    'expense',
    'import',
    'payroll',
    'online',
    'cogs',
    'depreciation',
] as const

export type TxWithRelations = {
    id: string
    receiptNumber: string
    customerName?: string | null
    subtotal: number
    discount: number
    tax: number
    total: number
    amountReceived: number
    createdAt: Date
    branchId?: string | null
    items: Array<{
        productId: string
        quantity: number
        product?: { costPrice: number } | null
    }>
    payments: Array<{ type: string; amount: number }>
}

const fmtDate = (d: Date) => d.toISOString().slice(0, 10)

// ─── Đơn sàn TMĐT: hạch toán qua PHÁP NHÂN SÀN ───────────────────────────────
// Bán qua sàn thì người nợ tiền shop là CÔNG TY SÀN (Shopee/TikTok), không phải
// khách lẻ: doanh thu ghi Nợ 131-<SÀN>, phí sàn ghi Nợ 641 / Có 131-<SÀN>,
// khi sàn quyết toán (escrow về tài khoản) kế toán ghi Nợ 112 / Có 131-<SÀN>.
// Tài khoản chi tiết 131-<SÀN> bắt đầu bằng "131" nên mọi báo cáo gộp theo
// prefix/đầu số vẫn tính đúng vào phải thu.
export const PLATFORM_AR: Record<string, { account: string; name: string; label: string }> = {
    shopee: { account: '131-SHOPEE', name: 'Phải thu Công ty Shopee', label: 'Shopee' },
    tiktok: { account: '131-TIKTOK', name: 'Phải thu Công ty TikTok', label: 'TikTok' },
    lazada: { account: '131-LAZADA', name: 'Phải thu Công ty Lazada', label: 'Lazada' },
    online: { account: '131-SAN', name: 'Phải thu sàn TMĐT', label: 'Sàn TMĐT' },
}

/** Nhận diện đơn online + sàn từ receiptNumber (ONLINE-SPE-x / SPE-x / TIK-x...). */
export function detectOnlinePlatform(receiptNumber: string): keyof typeof PLATFORM_AR | null {
    const rn = receiptNumber || ''
    if (!rn.startsWith('ONLINE-') && !/^(SPE|TIK|LZD)-/.test(rn)) return null
    if (/(^|-)SPE-/.test(rn)) return 'shopee'
    if (/(^|-)TIK-/.test(rn)) return 'tiktok'
    if (/(^|-)LZD-/.test(rn)) return 'lazada'
    return 'online'
}

export interface AutoJournalOptions {
    branchId?: string | null
    userId?: string | null
    // When true, skip the existing-reference probe (caller has already deduped).
    skipDupCheck?: boolean
}

export interface AutoJournalResult {
    created: Array<{ type: string; ref: string; amount: number }>
}

/**
 * Create the standard set of journal entries for a completed Transaction:
 *   - Revenue:  Nợ 111/112/131 / Có 511   (cash, bank or AR depending on payment)
 *   - VAT out:  Nợ 111/112/131 / Có 3331
 *   - Discount: Nợ 521 / Có 111/112/131
 *   - COGS:     Nợ 632 / Có 156
 *
 * Idempotent: probes existing JournalEntry.reference values and skips
 * anything already created. Safe to call multiple times for the same Tx.
 */
export async function createJournalEntriesForTransaction(
    prisma: any,
    tx: TxWithRelations,
    opts: AutoJournalOptions = {},
): Promise<AutoJournalResult> {
    const result: AutoJournalResult = { created: [] }

    const saleRef = `SALE-${tx.receiptNumber}`
    const vatRef = `VAT-${tx.receiptNumber}`
    const discRef = `DISC-${tx.receiptNumber}`
    const cogsRef = `COGS-${tx.receiptNumber}`
    const feeRef = `FEE-${tx.receiptNumber}`

    // Probe existing refs (unless caller already deduped) — keep this scoped
    // to just the refs for this tx so we don't load the whole table.
    let existing = new Set<string>()
    if (!opts.skipDupCheck) {
        try {
            const rows = await prisma.journalEntry.findMany({
                where: { reference: { in: [saleRef, vatRef, discRef, cogsRef, feeRef] } },
                select: { reference: true },
            })
            existing = new Set(rows.map((r: any) => r.reference).filter(Boolean))
        } catch (_) { /* table may not exist yet */ }
    }

    const date = fmtDate(tx.createdAt)
    const revenue = tx.subtotal || (tx.total - (tx.tax || 0))
    const vatAmount = tx.tax || 0
    const branchId = opts.branchId ?? tx.branchId ?? null
    const userId = opts.userId ?? null

    // Choose debit account from payment mix:
    //   đơn SÀN TMĐT          → 131-<SÀN> (phải thu pháp nhân Shopee/TikTok...)
    //   fully paid in cash       → 111 (Tiền mặt)
    //   fully paid via bank/xfer → 112 (Tiền gửi ngân hàng)
    //   otherwise                → 131 (Phải thu khách hàng)
    const onlinePlatform = detectOnlinePlatform(tx.receiptNumber)
    const platformAr = onlinePlatform ? PLATFORM_AR[onlinePlatform] : null
    const totalPaid = tx.payments?.reduce((s, p) => s + (p.amount || 0), 0) || tx.amountReceived || 0
    const isPaid = totalPaid >= tx.total
    let debitAccount: string
    let debitName: string
    if (platformAr) {
        debitAccount = platformAr.account
        debitName = platformAr.name
    } else if (isPaid) {
        const payType = tx.payments?.[0]?.type || 'cash'
        debitAccount = payType === 'bank' || payType === 'transfer' ? '112' : '111'
        debitName = debitAccount === '112' ? 'Tiền gửi ngân hàng' : 'Tiền mặt'
    } else {
        debitAccount = '131'
        debitName = 'Phải thu khách hàng'
    }

    // 1. Revenue entry — Nợ TK11x/131 / Có TK511
    if (revenue > 0 && !existing.has(saleRef)) {
        try {
            await prisma.journalEntry.create({
                data: {
                    date,
                    description: platformAr
                        ? `Bán hàng qua ${platformAr.label} ${tx.receiptNumber}${tx.customerName ? ' - KH: ' + tx.customerName : ''}`
                        : `Bán hàng ${tx.receiptNumber}${tx.customerName ? ' - KH: ' + tx.customerName : ''}`,
                    debitAccount, debitAccountName: debitName,
                    creditAccount: '511', creditAccountName: 'Doanh thu bán hàng',
                    amount: revenue, reference: saleRef, referenceType: 'sale',
                    branchId, createdBy: userId,
                },
            })
            result.created.push({ type: 'sale', ref: saleRef, amount: revenue })
        } catch (_) { /* unique-conflict or schema missing — non-fatal */ }
    }

    // 2. VAT-out entry — Nợ TK11x/131 / Có TK3331
    if (vatAmount > 0 && !existing.has(vatRef)) {
        try {
            await prisma.journalEntry.create({
                data: {
                    date,
                    description: `Thuế GTGT đầu ra ${tx.receiptNumber}`,
                    debitAccount, debitAccountName: debitName,
                    creditAccount: '3331', creditAccountName: 'Thuế GTGT phải nộp',
                    amount: vatAmount, reference: vatRef, referenceType: 'sale',
                    branchId, createdBy: userId,
                },
            })
            result.created.push({ type: 'vat-out', ref: vatRef, amount: vatAmount })
        } catch (_) { }
    }

    // 3. Discount entry — Nợ TK521 / Có TK11x/131
    if (tx.discount > 0 && !existing.has(discRef)) {
        try {
            await prisma.journalEntry.create({
                data: {
                    date,
                    description: `Giảm giá hàng bán ${tx.receiptNumber}`,
                    debitAccount: '521', debitAccountName: 'Chiết khấu thương mại',
                    creditAccount: debitAccount, creditAccountName: debitName,
                    amount: tx.discount, reference: discRef, referenceType: 'sale',
                    branchId, createdBy: userId,
                },
            })
            result.created.push({ type: 'discount', ref: discRef, amount: tx.discount })
        } catch (_) { }
    }

    // 4. COGS entry — Nợ TK632 / Có TK156
    if (!existing.has(cogsRef)) {
        const cogsAmount = tx.items?.reduce((s, item) => {
            const cost = item.product?.costPrice || 0
            return s + (cost * item.quantity)
        }, 0) || 0
        if (cogsAmount > 0) {
            try {
                await prisma.journalEntry.create({
                    data: {
                        date,
                        description: `Giá vốn hàng bán ${tx.receiptNumber}`,
                        debitAccount: '632', debitAccountName: 'Giá vốn hàng bán',
                        creditAccount: '156', creditAccountName: 'Hàng hóa',
                        amount: cogsAmount, reference: cogsRef, referenceType: 'sale',
                        branchId, createdBy: userId,
                    },
                })
                result.created.push({ type: 'cogs', ref: cogsRef, amount: cogsAmount })
            } catch (_) { }
        }
    }

    // 5. Phí sàn (chỉ đơn TMĐT) — Nợ TK641 / Có TK131-<SÀN>
    // Lấy platformFee từ OnlineOrder gốc (ước theo commissionRate lúc sync;
    // /channels/:id/sync-fees sẽ cập nhật lại bút toán này bằng phí thật).
    if (platformAr && !existing.has(feeRef)) {
        try {
            const orderNumber = tx.receiptNumber.replace(/^ONLINE-/, '')
            const onlineOrder = await prisma.onlineOrder.findFirst({
                where: { orderNumber },
                select: { platformFee: true },
            })
            const fee = onlineOrder?.platformFee || 0
            if (fee > 0) {
                await prisma.journalEntry.create({
                    data: {
                        date,
                        description: `Phí sàn ${platformAr.label} ${tx.receiptNumber}`,
                        debitAccount: '641', debitAccountName: 'Chi phí bán hàng',
                        creditAccount: platformAr.account, creditAccountName: platformAr.name,
                        amount: fee, reference: feeRef, referenceType: 'sale',
                        branchId, createdBy: userId,
                    },
                })
                result.created.push({ type: 'platform-fee', ref: feeRef, amount: fee })
            }
        } catch (_) { /* onlineOrder table missing or fee unknown — non-fatal */ }
    }

    return result
}
