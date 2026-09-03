// ─────────────────────────────────────────────────────────────────────────────
//  Period Lock (Khoa so ke toan) helpers
//
//  An accounting period is "locked" up to and including `lockDate`. Any voucher
//  (journal entry, cash receipt, expense, ...) dated on or before the current
//  lock date may not be created, edited or deleted.
//
//  The current lock state is the most recently created `PeriodLock` row with
//  `isActive = true`. Unlocking flips active rows to inactive.
// ─────────────────────────────────────────────────────────────────────────────

import { Response, NextFunction } from 'express'
import { AuthRequest } from '../middleware/auth'

export interface CurrentLock {
    lockDate: string
    periodType: string
    note: string | null
    lockedBy: string | null
    lockedByName: string | null
    lockedAt: Date
}

/** Normalise a voucher date (Date | string) to a YYYY-MM-DD string for comparison. */
export function toDateString(value: unknown): string | null {
    if (!value) return null
    if (value instanceof Date) return value.toISOString().slice(0, 10)
    const s = String(value)
    // Already an ISO-ish string — take the date portion.
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
    const d = new Date(s)
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10)
    return null
}

/** Return the current active lock for the given branch, or null if none. */
export async function getCurrentLock(prisma: any, branchId?: string | null): Promise<CurrentLock | null> {
    if (!prisma?.periodLock) return null
    try {
        // A lock with no branchId applies store-wide; a branch-specific lock
        // applies to that branch. Pick the most recent applicable active lock.
        const where: any = { isActive: true }
        if (branchId) where.OR = [{ branchId }, { branchId: null }]
        const lock = await prisma.periodLock.findFirst({
            where,
            orderBy: [{ lockDate: 'desc' }, { createdAt: 'desc' }],
        })
        if (!lock) return null
        return {
            lockDate: lock.lockDate,
            periodType: lock.periodType,
            note: lock.note ?? null,
            lockedBy: lock.lockedBy ?? null,
            lockedByName: lock.lockedByName ?? null,
            lockedAt: lock.createdAt,
        }
    } catch {
        // Table may not exist yet (pre-migration) — treat as unlocked.
        return null
    }
}

/**
 * Throw a typed error when `voucherDate` falls inside a locked period.
 * Returns the current lock (or null) so callers can reuse it.
 */
export async function assertNotLocked(
    prisma: any,
    branchId: string | null | undefined,
    voucherDate: unknown,
): Promise<CurrentLock | null> {
    const lock = await getCurrentLock(prisma, branchId)
    if (!lock) return null
    const d = toDateString(voucherDate)
    // No usable date → conservatively block (a dateless voucher could fall in the locked period).
    if (!d || d <= lock.lockDate) {
        const err: any = new Error(
            `Kỳ kế toán đã khóa sổ đến ${lock.lockDate}. Không thể thêm/sửa/xóa chứng từ trong kỳ đã khóa.`,
        )
        err.code = 'PERIOD_LOCKED'
        err.lockDate = lock.lockDate
        throw err
    }
    return lock
}

/**
 * KHOÁ SỔ Ở TẦNG GHI BÚT TOÁN (03/09/2026).
 *
 * Trước đây khoá sổ chỉ được kiểm ở 3 route (chi phí, phiếu thu, bút toán tay),
 * còn TÁM đường ghi chính — POS, nhập hàng, trả hàng, kiểm kê, lương, TSCĐ,
 * CCDC, sao kê — không kiểm gì cả. Khoá sổ tháng 6 xong, một chứng từ lùi ngày
 * về tháng 6 vẫn vào sổ bình thường, và báo cáo đã nộp với sổ hiện tại lệch nhau
 * mà không có dấu vết nào.
 *
 * Nay hai bộ sinh bút toán (autoJournal.ts, autoJournalPurchase.ts) gọi hàm này
 * MỘT lần cho mỗi chứng từ — mọi đường ghi đều đi qua đó nên chặn một chỗ là kín
 * cả tám route.
 *
 * Trả về lock khi PHẢI CHẶN, null khi được phép ghi. Không ném lỗi để nơi gọi
 * tự quyết (ném ra, hay ghi nhận rồi bỏ qua).
 */
export async function khoaSoChan(
    client: any,
    branchId: string | null | undefined,
    voucherDate: unknown,
): Promise<CurrentLock | null> {
    const lock = await getCurrentLock(client, branchId)
    if (!lock) return null
    const d = toDateString(voucherDate)
    // Không đọc được ngày → chặn cho chắc: chứng từ không ngày có thể rơi vào kỳ đã khoá.
    return (!d || d <= lock.lockDate) ? lock : null
}

/** Lỗi chuẩn cho trường hợp bị khoá sổ chặn — cùng mã với assertNotLocked. */
export function loiKhoaSo(lock: CurrentLock, chungTu: string): Error {
    const err: any = new Error(
        `Kỳ kế toán đã khóa sổ đến ${lock.lockDate}. Không ghi được ${chungTu} vào kỳ đã khóa.`,
    )
    err.code = 'PERIOD_LOCKED'
    err.lockDate = lock.lockDate
    return err
}

/**
 * Express middleware that blocks voucher mutations inside a locked period.
 * Reads the voucher date from `req.body[dateField]` (POST/PUT) and, when absent
 * on edits/deletes, conservatively blocks if any active lock exists.
 *
 * Use AFTER authMiddleware. GET requests pass through untouched.
 */
export function enforcePeriodLock(dateField: string = 'date') {
    return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
        if (req.method === 'GET' || req.method === 'HEAD') { next(); return }
        const prisma: any = req.storePrisma
        if (!prisma) { next(); return }
        try {
            const branchId = req.user?.branchId || null
            const lock = await getCurrentLock(prisma, branchId)
            if (!lock) { next(); return }

            const rawDate = (req.body && req.body[dateField]) ?? undefined
            const d = toDateString(rawDate)
            // On POST we know the date; if it's after the lock, allow.
            // On PUT/DELETE without a date in the body we can't tell — block to be safe.
            if (d && d > lock.lockDate) { next(); return }

            res.status(423).json({
                success: false,
                code: 'PERIOD_LOCKED',
                lockDate: lock.lockDate,
                error: `Kỳ kế toán đã khóa sổ đến ${lock.lockDate}. Không thể thêm/sửa/xóa chứng từ trong kỳ đã khóa.`,
            })
        } catch {
            // Never block on an internal lock-check failure.
            next()
        }
    }
}
