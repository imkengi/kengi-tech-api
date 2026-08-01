/**
 * NGẮT MẠCH CHO PROXY CHUYỂN TIẾP (Tino)
 *
 * Mọi call Shopee và Lazada đều đi qua proxy trên kengi.vn để mượn IP tĩnh đã
 * whitelist. Khi proxy không kết nối được (01/08/2026: Cloud Run bị chặn ở tầng
 * TCP, `ConnectTimeoutError ... kengi.vn:443`), mỗi lệnh gọi vẫn thử đủ 3 lần,
 * mỗi lần chờ tới 10s trước khi undici bỏ cuộc. Một lượt đồng bộ vài trăm đơn
 * biến thành hàng nghìn kết nối chết:
 *
 *   - đốt sạch ngân sách 300s của Cloud Run → 504, không việc gì xong
 *   - và tệ hơn: hosting dùng chung thường TỰ BAN khi thấy dồn dập, nên chính
 *     việc thử lại liên tục có thể kéo dài thời gian bị chặn
 *
 * Ngắt mạch: sau N lần hỏng liên tiếp thì nghỉ COOLDOWN, trong lúc nghỉ mọi lệnh
 * gọi trả lỗi NGAY kèm lý do rõ ràng, thay vì mỗi cái treo 30s. Có một lần thành
 * công là đóng lại ngay.
 *
 * Trạng thái nằm trong tiến trình (không dùng Redis) — cố ý: mỗi instance Cloud
 * Run tự quan sát đường mạng của chính nó, và mất trạng thái khi khởi động lại
 * chỉ nghĩa là thử lại sớm hơn, không gây hại.
 */

const FAIL_THRESHOLD = 5          // số lần hỏng liên tiếp thì mở mạch
const COOLDOWN_MS = 2 * 60_000    // nghỉ 2 phút rồi cho thử lại

let consecutiveFailures = 0
let openedAt = 0

/** Mạch đang mở (đang nghỉ) → chưa nên gọi proxy. */
export function proxyCircuitOpen(): boolean {
    if (openedAt === 0) return false
    if (Date.now() - openedAt > COOLDOWN_MS) {
        // Hết giờ nghỉ: cho MỘT lượt đi thử. Hỏng nữa thì mở lại ngay vì
        // consecutiveFailures vẫn đang ở ngưỡng.
        openedAt = 0
        return false
    }
    return true
}

export function proxyCircuitError(): Error {
    const conLai = Math.max(0, COOLDOWN_MS - (Date.now() - openedAt))
    return new Error(
        `Proxy chuyển tiếp đang mất kết nối (${consecutiveFailures} lần hỏng liên tiếp) — ` +
        `tạm dừng gọi ${Math.ceil(conLai / 1000)}s nữa. Kiểm tra firewall/IP whitelist ở hosting Tino.`
    )
}

export function noteProxySuccess(): void {
    if (consecutiveFailures > 0) {
        console.log(`[Proxy] kết nối lại được sau ${consecutiveFailures} lần hỏng — đóng ngắt mạch`)
    }
    consecutiveFailures = 0
    openedAt = 0
}

export function noteProxyFailure(): void {
    consecutiveFailures++
    if (consecutiveFailures >= FAIL_THRESHOLD && openedAt === 0) {
        openedAt = Date.now()
        console.error(
            `[Proxy] MỞ NGẮT MẠCH sau ${consecutiveFailures} lần hỏng liên tiếp — ` +
            `nghỉ ${COOLDOWN_MS / 1000}s. Gọi tiếp lúc này chỉ đốt thời gian và có thể kéo dài thời gian bị chặn.`
        )
    }
}
