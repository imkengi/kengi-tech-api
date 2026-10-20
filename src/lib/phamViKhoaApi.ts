// Phạm vi của API key theo scope — hàm THUẦN cho middleware/auth.ts (soát ở scripts/check-chatbot-san-pham.ts).
// 20/10/2026: scope 'chatbot' = khoá nằm trong n8n của chatbot trả lời KHÁCH ⇒ CHỈ được gọi webhook trả lời + tra sản
// phẩm / kênh. KHÔNG gồm /api/chatbot/shops (kho kiến thức — thứ chatbot nói với khách): lộ khoá cũng không sửa được.
const DUONG_KHOA_CHATBOT = /^\/api\/chatbot\/(webhook|san-pham|kenh)\/?$/

/** Lý do chặn (chuỗi) khi khoá KHÔNG được gọi đường này; null = cho qua (scope khác tự kiểm ghi/đọc ở authMiddleware). */
export function lyDoChanKhoa(scopes: unknown, url: unknown): string | null {
    const scope = String(scopes ?? '').trim().toLowerCase()
    const duong = String(url ?? '').split('?')[0]
    if (scope === 'chatbot' && !DUONG_KHOA_CHATBOT.test(duong)) return 'Khoá API chatbot chỉ dùng được cho /api/chatbot/webhook, /san-pham, /kenh'
    return null
}

/**
 * Khoá này có được đổi lấy JWT ở POST /api/auth/token không? JWT ở đó KHÔNG mang scope (toàn quyền của người tạo khoá)
 * ⇒ khoá chatbot mà đổi được là thoát phạm vi /api/chatbot. Chỉ chặn 'chatbot' — các scope cũ giữ hành vi cũ.
 */
export function khoaDoiDuocToken(scopes: unknown): boolean {
    return String(scopes ?? '').trim().toLowerCase() !== 'chatbot'
}
