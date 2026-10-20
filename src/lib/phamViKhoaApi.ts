// Phạm vi của API key theo scope — hàm THUẦN cho middleware/auth.ts (soát ở scripts/check-chatbot-san-pham.ts + check-pham-vi-khoa.ts).
// 20/10/2026: scope 'chatbot' = khoá nằm trong n8n của chatbot trả lời KHÁCH ⇒ CHỈ được gọi /api/chatbot/*.

/** Lý do chặn (chuỗi) khi khoá KHÔNG được gọi đường này; null = cho qua (scope khác tự kiểm ghi/đọc ở authMiddleware). */
export function lyDoChanKhoa(scopes: unknown, url: unknown): string | null {
    const scope = String(scopes ?? '').trim().toLowerCase()
    const duong = String(url ?? '').split('?')[0]
    if (scope === 'chatbot' && !/^\/api\/chatbot(\/|$)/.test(duong)) return 'Khoá API chatbot chỉ dùng được cho /api/chatbot'
    return null
}

/**
 * Luật GHI theo scope khoá — MỘT chỗ cho cả nhánh X-API-Key lẫn JWT đổi từ khoá ở /auth/token.
 * Khoá chỉ-đọc (scope không chứa admin / write / *; rỗng = 'read') KHÔNG được POST/PUT/PATCH/DELETE.
 * Trừ /api/mcp: JSON-RPC nên LUÔN POST kể cả khi chỉ đọc; quyền ghi ở đó do chính mcp.ts kiểm theo
 * cờ tool.write + scope — chặn ở đây thì khoá chỉ-đọc không gọi được tool nào (đo thật 15/08).
 * Trả lý do chặn hoặc null = cho qua.
 */
export function lyDoChanGhi(scopes: unknown, method: unknown, url: unknown): string | null {
    if (/admin|write|\*/i.test(String(scopes || 'read'))) return null
    if (['GET', 'HEAD', 'OPTIONS'].includes(String(method ?? ''))) return null
    if (/^\/api\/mcp\/?$/.test(String(url ?? '').split('?')[0])) return null
    return 'API key chỉ có quyền đọc — không thể ghi/sửa/xóa (scope=read)'
}

/**
 * JWT đổi từ API key ở POST /api/auth/token mang claim `apiKeyScopes` (20/10/2026). Trước đó JWT ấy KHÔNG mang scope
 * ⇒ khoá 'read' chỉ cần đổi token là có JWT toàn quyền người tạo khoá (ghi / sửa / xoá được hết).
 * Có claim ⇒ áp đúng luật của nhánh X-API-Key (phạm vi đường + chặn ghi). Không có claim = JWT đăng nhập thường ⇒ null
 * (phân quyền theo vai trò lo). Có mặt claim là đủ — giá trị rỗng / null vẫn bị coi là 'read', không phải toàn quyền.
 */
export function lyDoChanJwtKhoa(payload: unknown, method: unknown, url: unknown): string | null {
    if (!payload || typeof payload !== 'object' || !('apiKeyScopes' in payload)) return null
    const scopes = (payload as { apiKeyScopes?: unknown }).apiKeyScopes
    return lyDoChanKhoa(scopes, url) ?? lyDoChanGhi(scopes, method, url)
}

/**
 * Khoá này có được đổi lấy JWT ở POST /api/auth/token không? Nay JWT ở đó mang scope (apiKeyScopes) nhưng không phải
 * mọi chỗ nhận JWT đều chạy qua authMiddleware (websocket, livestream…) ⇒ khoá chatbot vẫn KHÔNG cho đổi: nó không có
 * lý do gì cần token. Chỉ chặn 'chatbot' — các scope khác đổi được, quyền ghi bị giới hạn theo lyDoChanJwtKhoa.
 */
export function khoaDoiDuocToken(scopes: unknown): boolean {
    return String(scopes ?? '').trim().toLowerCase() !== 'chatbot'
}
