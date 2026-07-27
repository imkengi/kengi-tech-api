import { Router, Response } from 'express'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { TOOLS, ToolError, type ToolCtx } from './mcp'

/**
 * TRỢ LÝ AI trong dashboard — POST /api/mcp-agent/chat
 *
 * Bộ não: Gemini (function-calling). Tay chân: các MCP tool (routes/mcp.ts).
 * FE gửi {message, history} → Gemini quyết gọi tool nào (loop tối đa MAX_STEPS)
 * → backend chạy tool trên ĐÚNG store của user đăng nhập (req.storePrisma) →
 * feed kết quả lại cho Gemini → trả câu trả lời tiếng Việt + danh sách tool đã gọi.
 *
 * Auth: authMiddleware (JWT đăng nhập dashboard hoặc X-API-Key) → phạm vi store
 * = store của user, không cần key riêng. Quyền ghi: chỉ admin/manager/owner mới
 * được gọi tool write (chặn ở đây, độc lập với scope API key).
 *
 * Key: GEMINI_API_KEY (env/Secret Manager). Chưa cấu hình → 503.
 */

const router = Router()

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || ''
// gemini-2.0-flash bị Google gỡ (2026-07) → dùng 2.5-flash (nhanh, rẻ, ổn định)
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash'
const GEMINI_URL = (model: string) =>
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`
const MAX_STEPS = 6

const SYSTEM_PROMPT =
    'Bạn là trợ lý vận hành cửa hàng bán lẻ Kengi, trả lời NGẮN GỌN bằng tiếng Việt. ' +
    'Bạn có các công cụ tra cứu/thao tác dữ liệu của cửa hàng — hãy GỌI CÔNG CỤ để lấy số liệu thật, ' +
    'TUYỆT ĐỐI không bịa số. Có thể gọi nhiều công cụ liên tiếp nếu cần. Tiền tệ VND, định dạng có dấu chấm ngăn cách. ' +
    'Khi trả lời số liệu, nêu rõ mốc thời gian. Nếu công cụ báo lỗi, giải thích ngắn cho người dùng và gợi ý cách khắc phục. ' +
    'Bạn cũng vận hành được FANPAGE FACEBOOK của cửa hàng qua nhóm công cụ fanpage_*: gọi fanpage_list_pages trước để biết page nào đang kết nối, ' +
    'fanpage_list_comments để tìm bình luận chưa trả lời rồi fanpage_reply_comment, fanpage_create_post để đăng/lên lịch bài, ' +
    'fanpage_create_rule + fanpage_set_auto_reply để trả lời tự động 24/7. ' +
    'Các thao tác ĐĂNG BÀI, TRẢ LỜI KHÁCH, ẨN BÌNH LUẬN là hành động công khai ra ngoài — hãy nêu rõ nội dung định đăng/gửi và XIN XÁC NHẬN của người dùng trước khi gọi công cụ, trừ khi họ đã bảo cứ làm.'

// JSON Schema (MCP inputSchema) → Gemini function-calling schema. Gemini không
// nhận additionalProperties/'$schema'; type phải UPPERCASE.
function toGeminiSchema(node: any): any {
    if (!node || typeof node !== 'object') return { type: 'STRING' }
    const t = String(node.type || 'string').toUpperCase()
    if (t === 'OBJECT') {
        const props: any = {}
        for (const [k, v] of Object.entries(node.properties || {})) props[k] = toGeminiSchema(v)
        const out: any = { type: 'OBJECT', properties: props }
        if (Array.isArray(node.required) && node.required.length) out.required = node.required
        return out
    }
    if (t === 'ARRAY') {
        const arr: any = { type: 'ARRAY', items: toGeminiSchema(node.items) }
        if (node.description) arr.description = node.description
        return arr
    }
    const out: any = { type: t }
    if (node.description) out.description = node.description
    // Giữ enum: thiếu nó Gemini hay bịa giá trị ngoài tập hợp cho phép
    // (media_type, match_type, action... của nhóm tool fanpage_*).
    if (Array.isArray(node.enum) && node.enum.length) out.enum = node.enum.map(String)
    return out
}

function geminiTools() {
    return [{
        functionDeclarations: TOOLS.map(t => ({
            name: t.name,
            description: t.description,
            parameters: toGeminiSchema(t.inputSchema),
        })),
    }]
}

async function callGemini(contents: any[], apiKey: string): Promise<any> {
    const res = await fetch(`${GEMINI_URL(GEMINI_MODEL)}?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
            contents,
            tools: geminiTools(),
            generationConfig: { temperature: 0.2 },
        }),
    })
    const text = await res.text()
    let data: any
    try { data = JSON.parse(text) } catch { throw new Error(`Gemini trả về non-JSON (HTTP ${res.status}): ${text.slice(0, 300)}`) }
    if (!res.ok) throw new Error(`Gemini lỗi HTTP ${res.status}: ${data?.error?.message || text.slice(0, 200)}`)
    return data
}

const WRITE_ROLES = ['admin', 'manager', 'owner', 'superadmin']

router.post('/chat', authMiddleware, async (req: AuthRequest, res: Response) => {
    const prisma = req.storePrisma
    if (!prisma) {
        res.status(401).json({ success: false, error: 'Chưa xác thực store' })
        return
    }

    // Key theo TỪNG CỬA HÀNG (admin cấu hình trong Cài đặt) → fallback env dùng chung.
    let apiKey = GEMINI_API_KEY
    try {
        const s = await prisma.storeSettings.findFirst({ select: { geminiApiKey: true } as any }) as any
        if (s?.geminiApiKey) apiKey = s.geminiApiKey
    } catch { /* cột chưa migrate → dùng env */ }
    if (!apiKey) {
        res.status(503).json({ success: false, error: 'Trợ lý AI chưa cấu hình — vào Cài đặt → Trợ lý AI để nhập Gemini API Key (chỉ admin)' })
        return
    }

    const message = String(req.body?.message || '').trim()
    if (!message) { res.status(400).json({ success: false, error: 'Thiếu message' }); return }

    const role = String(req.user?.role || '')
    const canWrite = WRITE_ROLES.includes(role)
    const ctx: ToolCtx = {
        prisma,
        scopes: canWrite ? 'read,write' : 'read',
        storeCode: String(req.user?.storeCode || ''),
        userId: req.user?.userId,
        userName: (req.user as any)?.name,
        branchId: req.user?.branchId ?? null,
    }

    // Lịch sử hội thoại từ FE: [{role:'user'|'model', text}] → contents Gemini
    const history: any[] = Array.isArray(req.body?.history)
        ? req.body.history
            .filter((m: any) => m && (m.role === 'user' || m.role === 'model') && typeof m.text === 'string')
            .slice(-12)
            .map((m: any) => ({ role: m.role, parts: [{ text: m.text }] }))
        : []
    const contents: any[] = [...history, { role: 'user', parts: [{ text: message }] }]

    const toolCalls: { name: string; args: any; ok: boolean }[] = []

    try {
        for (let step = 0; step < MAX_STEPS; step++) {
            const data = await callGemini(contents, apiKey)
            const cand = data?.candidates?.[0]
            const parts: any[] = cand?.content?.parts || []
            const calls = parts.filter(p => p.functionCall).map(p => p.functionCall)

            if (calls.length === 0) {
                const reply = parts.filter(p => p.text).map(p => p.text).join('\n').trim()
                res.json({ success: true, data: { reply: reply || '(không có nội dung trả lời)', toolCalls } })
                return
            }

            // Ghi lại lượt model (kèm functionCall) rồi chạy từng tool
            contents.push({ role: 'model', parts })
            const responseParts: any[] = []
            for (const fc of calls) {
                const tool = TOOLS.find(t => t.name === fc.name)
                let payload: any
                let ok = true
                if (!tool) {
                    payload = { error: `Tool không tồn tại: ${fc.name}` }; ok = false
                } else if (tool.write && !canWrite) {
                    payload = { error: `Cần quyền quản lý để thực hiện "${fc.name}" (vai trò hiện tại: ${role || 'không rõ'})` }; ok = false
                } else {
                    try {
                        payload = await tool.run(fc.args || {}, ctx)
                    } catch (e: any) {
                        payload = { error: e instanceof ToolError ? e.message : `Lỗi hệ thống: ${e?.message || e}` }
                        ok = false
                    }
                }
                toolCalls.push({ name: fc.name, args: fc.args || {}, ok })
                responseParts.push({ functionResponse: { name: fc.name, response: { result: payload } } })
            }
            contents.push({ role: 'user', parts: responseParts })
        }
        res.json({ success: true, data: { reply: 'Đã đạt giới hạn số bước xử lý. Vui lòng hỏi cụ thể hơn.', toolCalls } })
    } catch (e: any) {
        console.error('[mcp-agent] lỗi:', e?.message || e)
        res.status(502).json({ success: false, error: e?.message || 'Lỗi gọi trợ lý AI' })
    }
})

export default router
