// Phạm vi của API key theo scope — hàm THUẦN cho middleware/auth.ts, routes/auth.ts, livestream.ts (soát ở scripts/check-chatbot-san-pham.ts + check-pham-vi-khoa.ts).
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
 * Luật GHI theo scope khoá — MỘT chỗ cho cả nhánh X-API-Key lẫn JWT đổi từ khoá ở /auth/token.
 * Khoá chỉ-đọc (scope không chứa admin / write / *; rỗng = 'read') KHÔNG được POST/PUT/PATCH/DELETE.
 * Trừ /api/mcp: JSON-RPC nên LUÔN POST kể cả khi chỉ đọc; quyền ghi ở đó do chính mcp.ts kiểm theo
 * cờ tool.write + scope — chặn ở đây thì khoá chỉ-đọc không gọi được tool nào (đo thật 15/08).
 * Trừ khoá 'chatbot' POST /api/chatbot/webhook: n8n chuyển tin nhắn khách để kengi.vn soạn câu trả lời — việc CHÍNH của
 * khoá này, mà handler chỉ đọc (agent scopes 'read', 2 công cụ tra cứu). Thiếu lối này thì webhook 403 với chính khoá đó.
 * Trả lý do chặn hoặc null = cho qua.
 */
export function lyDoChanGhi(scopes: unknown, method: unknown, url: unknown): string | null {
    if (/admin|write|\*/i.test(String(scopes || 'read'))) return null
    if (['GET', 'HEAD', 'OPTIONS'].includes(String(method ?? ''))) return null
    const duong = String(url ?? '').split('?')[0]
    if (/^\/api\/mcp\/?$/.test(duong)) return null
    if (String(scopes ?? '').trim().toLowerCase() === 'chatbot' && method === 'POST' && /^\/api\/chatbot\/webhook\/?$/.test(duong)) return null
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
 * ĐÚC PHIÊN từ một request đã xác thực — chỉ cho người đăng nhập, KHÔNG cho API key (20/10/2026).
 * POST /auth/switch-branch gọi createTokenPair ⇒ access token + refresh token 90 ngày LƯU CSDL, đổi vòng mãi qua /auth/refresh;
 * GET /livestream/session-token ⇒ studio token 12h (token gốc của khoá chỉ sống 1h). Phiên mới KHÔNG mang scope khoá (bản ghi
 * refresh token không có chỗ chứa claim) và sống tiếp sau khi khoá bị thu hồi / hết hạn ⇒ khoá write/admin lộ ra thì thu hồi
 * khoá vẫn còn phiên. "Đi bằng khoá" = cờ viaApiKey (authMiddleware gắn cho CẢ X-API-Key lẫn JWT đổi từ khoá) HOẶC payload
 * có claim apiKeyScopes (chỗ tự jwt.verify, không qua authMiddleware — livestream). Log 30 ngày (đo 20/10): không tích hợp nào
 * gọi hai đường này bằng khoá — switch-branch 0 lượt, session-token chỉ trình duyệt. Trả lý do chặn hoặc null = cho qua.
 */
export function lyDoChanDucPhien(viaApiKey: unknown, payload: unknown, goiY: string): string | null {
    const quaKhoa = !!viaApiKey || (!!payload && typeof payload === 'object' && 'apiKeyScopes' in payload)
    if (!quaKhoa) return null
    return `Khoá API không đúc được phiên đăng nhập mới (phiên ấy không mang phạm vi của khoá và vẫn sống sau khi thu hồi khoá) — ${goiY}`
}

/**
 * Khoá này có được đổi lấy JWT ở POST /api/auth/token không? Nay JWT ở đó mang scope (apiKeyScopes) nhưng không phải
 * mọi chỗ nhận JWT đều chạy qua authMiddleware (websocket, livestream…) ⇒ khoá chatbot vẫn KHÔNG cho đổi: nó không có
 * lý do gì cần token. Chỉ chặn 'chatbot' — các scope khác đổi được, quyền ghi bị giới hạn theo lyDoChanJwtKhoa.
 */
export function khoaDoiDuocToken(scopes: unknown): boolean {
    return String(scopes ?? '').trim().toLowerCase() !== 'chatbot'
}
