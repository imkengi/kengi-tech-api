// ═══════════════════════════════════════════════════════════════════════════════
// Error response helpers
//
// Keep internal error details out of API responses. In development we surface the
// real message to aid debugging; in every other environment we fall back to a
// generic message so SQL errors, constraint names, file paths, and other internal
// details are never leaked to clients.
// ═══════════════════════════════════════════════════════════════════════════════

const isDev = (): boolean => process.env.NODE_ENV === 'development'

/**
 * For the `error:` field of a response.
 * Returns the real error message in development, otherwise the generic fallback.
 */
/* Lỗi CÓ CHỦ Ý dành cho người dùng — không phải chi tiết nội bộ, phải hiện nguyên văn.
 *
 * Bộ lọc này từng che mất thông báo có ích: một chứng từ bị khoá sổ từ chối sẽ ra
 * "Internal server error" trên prod, và người dùng không có cách nào biết vì sao —
 * đúng cái bẫy "lỗi của bên thứ ba bị che thành lỗi chung". Mã nào nằm ở đây là
 * mã do CHÍNH hệ thống này sinh ra để nói với người dùng, không lộ gì nội bộ. */
const MA_CHO_NGUOI_DUNG = new Set(['PERIOD_LOCKED', 'TRUNG_SO_HOA_DON'])

export function errMsg(err: unknown, fallback = 'Internal server error'): string {
    const ma = (err as any)?.code
    if (ma && MA_CHO_NGUOI_DUNG.has(String(ma)) && err instanceof Error && err.message) return err.message
    if (isDev()) {
        if (err instanceof Error && err.message) return err.message
        if (typeof err === 'string' && err) return err
    }
    return fallback
}

/**
 * For an optional `detail:` field of a response.
 * Returns the real error message in development, otherwise `undefined` so the
 * key is omitted entirely from the serialized JSON in production.
 */
export function errorDetail(err: unknown): string | undefined {
    if (!isDev()) return undefined
    if (err instanceof Error) return err.message
    if (typeof err === 'string') return err
    return undefined
}

/**
 * Trả lỗi cho client: lỗi CÓ CHỦ Ý dành cho người dùng đi đúng mã HTTP của nó,
 * còn lại mới là 500 + thông báo chung.
 *
 * Vì sao cần: các lỗi như PERIOD_LOCKED ném từ TẦNG SÂU (hàm sinh bút toán) rồi
 * nổi lên qua `catch` của route, mà mọi catch đều kết thúc bằng 500 + errMsg. Đặt
 * tay từng chỗ thì dễ đặt nhầm handler (đã cắn một lần 03/09) — nên gom về đây và
 * thay cả loạt.
 */
export function guiLoi(res: any, err: any, log?: string): void {
    if (err?.code === 'PERIOD_LOCKED') {
        res.status(423).json({
            success: false, code: 'PERIOD_LOCKED',
            lockDate: err.lockDate, error: err.message,
        })
        return
    }
    if (log) console.error(log, err)
    res.status(500).json({ success: false, error: errMsg(err) })
}
