/**
 * CHỜ MỘT VIỆC ĐANG CHẠY KẾT THÚC, CÓ TRẦN — logic thuần, kiểm được.
 *
 * Dùng lúc tắt container: `stopAutoSync()` mới chỉ huỷ hẹn giờ; lượt autoSync
 * đang chạy vẫn tiếp tục và cần DB. Đóng DB ngay là mất engine dưới chân cron
 * (đo 18/08/2026: `1495-ptf` nhận SIGTERM đúng lúc đang chuyển đơn → 48 đơn
 * hỏng trong 0,66 s). Chờ nó xong rồi mới đóng — nhưng CÓ TRẦN, vì Cloud Run
 * kill cứng ~10 s sau SIGTERM; chờ vô hạn còn tệ hơn.
 *
 * Tách khỏi autoSync.ts để mô phỏng được cả ba nhánh mà không cần server:
 *   - đang rỗi          → về ngay
 *   - chạy, xong kịp    → chờ đúng đến lúc xong
 *   - chạy quá trần     → bỏ cuộc đúng trần
 */
export async function choXong(
    dangChay: () => boolean,
    tranMs: number,
    nhipMs = 200,
    ngu: (ms: number) => Promise<void> = (ms) => new Promise(r => setTimeout(r, ms)),
    bayGio: () => number = () => Date.now(),
): Promise<boolean> {
    const bat = bayGio()
    while (dangChay() && bayGio() - bat < tranMs) {
        await ngu(nhipMs)
    }
    return !dangChay()
}

/* ═══════════════════════════════════════════════════════════════════════════
 * CỜ "ĐANG TẮT" — để vòng lặp dài tự dừng giữa chừng.
 *
 * Đo 03:02 UTC 18/08/2026 (`1497-qcn`, mã tắt mới): SIGTERM đến đúng lúc
 * autoSync đang chuyển đơn; shutdown CHỜ ĐỦ 6 s rồi bỏ cuộc — đúng thiết kế —
 * nhưng lượt chưa xong nên vẫn 11 đơn hỏng (bản cũ: 48). Trần không nới được
 * nhiều: Cloud Run SIGKILL cố định 10 s sau SIGTERM, không cấu hình được.
 *
 * Sửa gốc: shutdown BẬT CỜ NÀY ĐẦU TIÊN; vòng lặp chuyển đơn kiểm cờ trước mỗi
 * đơn, thấy đang tắt thì thoát ngay thay vì làm nốt cả cửa hàng. Lượt kết thúc
 * trong <1 s, không đơn nào dở lúc đóng DB, đơn chưa kịp thì lượt sau chuyển.
 * ═══════════════════════════════════════════════════════════════════════════ */
let _dangTat = false
export function batCoDangTat(): void { _dangTat = true }
export function dangTat(): boolean { return _dangTat }
/** Chỉ cho bộ kiểm — reset cờ giữa các ca. */
export function _resetCoDangTat(): void { _dangTat = false }
