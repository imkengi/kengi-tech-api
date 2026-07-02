// ═══════════════════════════════════════════════════════════════════════════════
//  ONLINE ORDER REVERSAL — đảo mọi hiệu ứng khi đơn sàn bị HỦY/HOÀN:
//    (a) hoàn kho theo items của đơn (nếu đã trừ — cờ stockDeducted)
//    (b) void Transaction đã convert từ đơn (receiptNumber ONLINE-<orderNumber>)
//    (c) đảo bút toán SALE-/VAT-/DISC-/COGS-/COLLECT- (reference REV-<refGốc>)
//
//  IDEMPOTENT — gọi nhiều lần vô hại:
//    - kho:      updateMany({ stockDeducted: true → false }) là atomic claim,
//                lần 2 count=0 → bỏ qua (chống race hoàn 2 lần)
//    - hóa đơn:  chỉ void khi status chưa 'voided'
//    - bút toán: reference @unique → create trùng ném P2002 = đã đảo rồi, bỏ qua
//
//  Gọi từ: webhook Shopee/TikTok khi đơn hủy, returnSync khi refunded,
//  PUT /online-orders/:id/status + bulk-update khi chuyển cancelled/returned.
// ═══════════════════════════════════════════════════════════════════════════════

type StorePrisma = any

// Trạng thái CHUNG CUỘC cần đảo hiệu ứng. IN_CANCEL/cancelling là "chờ duyệt hủy"
// — chưa đảo (sàn có thể từ chối, đơn quay lại trạng thái cũ).
const REVERSAL_STATUSES = new Set(['CANCELLED', 'cancelled', 'TO_RETURN', 'returned'])

export function isReversalStatus(status?: string | null): boolean {
    return !!status && REVERSAL_STATUSES.has(status)
}

// Các prefix bút toán tự sinh cho 1 receiptNumber (xem src/lib/autoJournal.ts —
// KHÔNG đổi các prefix này, DELETE /api/tax/auto-journal dọn theo chúng)
const JOURNAL_PREFIXES = ['SALE-', 'VAT-', 'DISC-', 'COGS-', 'COLLECT-'] as const

export interface ReversalOptions {
    userId?: string | null
    reason?: string
}

export interface ReversalResult {
    stockRestored: boolean
    transactionVoided: boolean
    journalsReversed: number
}

const fmtDate = (d: Date) => d.toISOString().slice(0, 10)

/**
 * Đảo toàn bộ hiệu ứng của một đơn sàn đã hủy/hoàn. `order` cần tối thiểu
 * { id, orderNumber } — items sẽ được nạp lại nếu thiếu. An toàn gọi lặp lại.
 */
export async function reverseOnlineOrderEffects(
    sp: StorePrisma,
    order: { id: string; orderNumber?: string; items?: any[] },
    opts: ReversalOptions = {},
): Promise<ReversalResult> {
    const result: ReversalResult = { stockRestored: false, transactionVoided: false, journalsReversed: 0 }

    // Nạp bản mới nhất kèm items (caller thường chỉ có bản ghi không include items)
    const full = await sp.onlineOrder.findUnique({
        where: { id: order.id },
        include: { items: true },
    })
    if (!full) return result

    // ── (a) Hoàn kho — chỉ khi đơn ĐÃ trừ (stockDeducted=true) ──────────────
    // updateMany điều kiện stockDeducted:true là atomic: 2 request đồng thời chỉ
    // 1 bên claim được → không hoàn kho 2 lần. Đơn cũ trước khi có cờ (đã trừ
    // nhưng stockDeducted=false) không hoàn tự động được — chấp nhận, chỉnh tay.
    const claim = await sp.onlineOrder.updateMany({
        where: { id: full.id, stockDeducted: true },
        data: { stockDeducted: false },
    })
    if (claim.count > 0) {
        result.stockRestored = true
        for (const item of full.items || []) {
            try {
                // Ưu tiên productId (chính xác), fallback SKU — mirror đúng cách
                // trừ kho hiện tại (PUT /:id/status trừ theo SKU, convert theo productId)
                if (item.productId) {
                    await sp.product.update({
                        where: { id: item.productId },
                        data: { stock: { increment: item.quantity } },
                    })
                } else if (item.sku) {
                    await sp.product.updateMany({
                        where: { sku: item.sku },
                        data: { stock: { increment: item.quantity } },
                    })
                }
            } catch (e: any) {
                console.error(`[OrderReversal] Hoàn kho lỗi cho item ${item.productName} (đơn ${full.orderNumber}):`, e.message)
            }
        }
        // Log sổ kho (best-effort) cho các item định danh được sản phẩm
        for (const item of full.items || []) {
            if (!item.productId) continue
            try {
                await sp.inventoryTransaction.create({
                    data: {
                        type: 'in',
                        productId: item.productId,
                        productName: item.productName,
                        productSku: item.sku || '',
                        quantity: item.quantity,
                        reason: 'Hoàn kho do hủy/hoàn đơn online',
                        note: opts.reason || `Đơn ${full.orderNumber} hủy/hoàn`,
                        referenceId: `ONLINE-${full.orderNumber}`,
                        referenceType: 'sale',
                        userId: opts.userId || null,
                        userName: 'Hệ thống',
                    },
                })
            } catch { /* log kho không được phép chặn luồng đảo */ }
        }
        console.log(`[OrderReversal] ✅ Hoàn kho ${full.items?.length || 0} items cho đơn ${full.orderNumber}`)
    }

    // ── (b) Void Transaction đã convert ──────────────────────────────────────
    // orderSync đặt receiptNumber = `ONLINE-<orderNumber>` (orderNumber tự mang
    // prefix sàn SPE-/TIK-...). Quét thêm orderNumber trần đề phòng dữ liệu cũ.
    const receiptCandidates = [`ONLINE-${full.orderNumber}`, full.orderNumber].filter(Boolean) as string[]
    const tx = await sp.transaction.findFirst({
        where: { receiptNumber: { in: receiptCandidates } },
    })
    if (tx && tx.status !== 'voided') {
        const voided = await sp.transaction.updateMany({
            where: { id: tx.id, NOT: { status: 'voided' } },
            data: { status: 'voided' },
        })
        result.transactionVoided = voided.count > 0
        // KHÔNG hoàn kho TransactionItem ở đây: cả 2 đường trừ kho (PUT status
        // và convert trong orderSync) đều claim chung cờ stockDeducted trước khi
        // trừ → cờ là NGUỒN SỰ THẬT DUY NHẤT, bước (a) đã hoàn đủ. Hoàn thêm
        // theo TransactionItem sẽ thành hoàn 2 lần.
        if (result.transactionVoided) {
            console.log(`[OrderReversal] ✅ Voided transaction ${tx.receiptNumber} (đơn ${full.orderNumber})`)
        }
    }

    // ── (c) Đảo bút toán SALE-/VAT-/DISC-/COGS-/COLLECT- ────────────────────
    // Với mỗi ref đang tồn tại → tạo bút toán đảo (đổi chỗ Nợ/Có, cùng amount),
    // reference = 'REV-' + refGốc. Ref @unique → P2002 = đã đảo rồi, bỏ qua.
    const refs: string[] = []
    const receiptSet = new Set<string>(receiptCandidates)
    if (tx?.receiptNumber) receiptSet.add(tx.receiptNumber)
    for (const rn of receiptSet) {
        for (const p of JOURNAL_PREFIXES) refs.push(`${p}${rn}`)
    }
    try {
        const entries = await sp.journalEntry.findMany({ where: { reference: { in: refs } } })
        const today = fmtDate(new Date())
        for (const e of entries) {
            try {
                await sp.journalEntry.create({
                    data: {
                        date: today,
                        description: `Đảo bút toán do hủy/hoàn đơn ${full.orderNumber}`,
                        // Đổi chỗ Nợ/Có so với bút toán gốc (vd SALE Nợ 131-SHOPEE /
                        // Có 511 → đảo thành Nợ 511 / Có 131-SHOPEE, giảm phải thu sàn)
                        debitAccount: e.creditAccount,
                        debitAccountName: e.creditAccountName,
                        creditAccount: e.debitAccount,
                        creditAccountName: e.debitAccountName,
                        amount: e.amount,
                        reference: `REV-${e.reference}`,
                        referenceType: e.referenceType, // giữ nhóm 'online'/'sale' như bản gốc
                        branchId: e.branchId,
                        createdBy: opts.userId || null,
                    },
                })
                result.journalsReversed++
            } catch (err: any) {
                if (err?.code !== 'P2002') {
                    console.error(`[OrderReversal] Đảo bút toán ${e.reference} lỗi:`, err.message)
                }
                // P2002 = REV- đã tồn tại (đảo rồi) — im lặng bỏ qua
            }
        }
    } catch (e: any) {
        // Bảng JournalEntry có thể chưa tồn tại ở schema cũ — không chặn luồng
        console.warn(`[OrderReversal] Không quét được bút toán cho đơn ${full.orderNumber}:`, e.message)
    }

    if (result.journalsReversed > 0) {
        console.log(`[OrderReversal] ✅ Đảo ${result.journalsReversed} bút toán cho đơn ${full.orderNumber}`)
    }
    return result
}
