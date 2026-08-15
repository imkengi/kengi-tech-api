import { Router, Response } from 'express'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { type ToolCtx } from '../lib/mcpTypes'
import { chayAgent } from '../services/aiAgentRunner'

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
const MAX_STEPS = 6

const SYSTEM_PROMPT =
    'Bạn là trợ lý vận hành cửa hàng bán lẻ Kengi, trả lời NGẮN GỌN bằng tiếng Việt. ' +
    'Bạn có các công cụ tra cứu/thao tác dữ liệu của cửa hàng — hãy GỌI CÔNG CỤ để lấy số liệu thật, ' +
    'TUYỆT ĐỐI không bịa số. Có thể gọi nhiều công cụ liên tiếp nếu cần. Tiền tệ VND, định dạng có dấu chấm ngăn cách. ' +
    'Khi trả lời số liệu, nêu rõ mốc thời gian. Nếu công cụ báo lỗi, giải thích ngắn cho người dùng và gợi ý cách khắc phục. ' +
    'Bạn cũng vận hành được FANPAGE FACEBOOK của cửa hàng qua nhóm công cụ fanpage_*: gọi fanpage_list_pages trước để biết page nào đang kết nối, ' +
    'fanpage_list_comments để tìm bình luận chưa trả lời rồi fanpage_reply_comment, fanpage_create_post để đăng/lên lịch bài, ' +
    'fanpage_create_rule + fanpage_set_auto_reply để trả lời tự động 24/7. ' +
    'Khi người dùng nhờ LÊN CONTENT / VIẾT BÀI / LÊN KẾ HOẠCH nội dung, dùng nhóm marketing_*: marketing_get_brand để nắm giọng thương hiệu, ' +
    'marketing_content_material để lấy hàng hoá + ảnh THẬT (không bịa tên hàng, giá, ảnh), marketing_suggest_slots để lấy giờ đăng, ' +
    'rồi marketing_save_draft lưu từng bài. Bài lưu bằng marketing_* KHÔNG lên Facebook ngay mà vào hàng đợi chờ chủ shop duyệt ở mục Content AI — ' +
    'hãy nói rõ điều đó cho người dùng. Chỉ dùng fanpage_create_post khi họ yêu cầu đăng thẳng, không qua duyệt. ' +
    'Các thao tác ĐĂNG BÀI, TRẢ LỜI KHÁCH, ẨN BÌNH LUẬN là hành động công khai ra ngoài — hãy nêu rõ nội dung định đăng/gửi và XIN XÁC NHẬN của người dùng trước khi gọi công cụ, trừ khi họ đã bảo cứ làm. ' +
    'TRƯỚC KHI kết luận từ bất kỳ báo cáo THEO KỲ nào (doanh thu tháng, lãi lỗ, thuế, đối chiếu), hãy gọi data_health_check một lần. Nếu có mục ở mức "nang" thì PHẢI nói rõ hạn chế đó kèm số liệu trước khi đưa ra con số — nhiều cửa hàng nhập lịch sử từ phần mềm cũ nên chứng từ nằm sai kỳ, và trình bày con số như sự thật đã chắc là làm chủ shop quyết sai. Con số công cụ trả về là null nghĩa là CHƯA ĐỌC ĐƯỢC, không phải bằng 0 — đừng suy ra là không có. ' +
    'HAI TOOL cùng trả lời "doanh thu theo kỳ" nhưng cắt kỳ khác nhau: revenue_by_day cắt theo NGÀY BÁN trên chứng từ, còn sales_report và profit_report cắt theo NGÀY GHI SỔ. Với cửa hàng nhập lịch sử từ phần mềm cũ, hai con số lệch nhau nhiều lần (đo thật: tháng 7 ra 983 triệu so với 5,0 tỷ). Khi được hỏi doanh thu/lãi của MỘT THÁNG cụ thể, hãy ưu tiên revenue_by_day; nếu dùng sales_report hay profit_report thì PHẢI đọc trường canhBaoLechKy và nói rõ con số gồm cả chứng từ của tháng khác. ' +
    'Hỏi về LÃI/LỖ dùng profit_report, chi phí dùng expense_report, nợ nhà cung cấp dùng supplier_debt, tồn theo kho dùng stock_by_warehouse. '+
    'profit_report tính giá vốn theo giá vốn HIỆN TẠI nên là ước tính — khi báo cáo phải nói rõ, và nếu có cảnh báo thiếu giá vốn thì nhắc chủ shop cập nhật.'

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

    try {
        // Dùng CHUNG vòng lặp với trợ lý tự động (services/aiAgentRunner) — trước
        // đây hai nơi có hai bản sao, sửa một chỗ là lệch nhau.
        // giamSat: true vì có người ngồi xem → tool nhạy cảm không cần khai trước;
        // system prompt vẫn buộc agent xin xác nhận cho thao tác công khai.
        const kq = await chayAgent({
            apiKey,
            systemPrompt: SYSTEM_PROMPT,
            ctx,
            message,
            history,
            maxSteps: MAX_STEPS,
            allowWrite: canWrite,
            giamSat: true,
        })
        res.json({
            success: true,
            data: {
                reply: kq.chamTran ? 'Đã đạt giới hạn số bước xử lý. Vui lòng hỏi cụ thể hơn.' : kq.reply,
                toolCalls: kq.toolCalls.map(t => ({ name: t.name, args: t.args, ok: t.ok })),
            },
        })
    } catch (e: any) {
        console.error('[mcp-agent] lỗi:', e?.message || e)
        res.status(502).json({ success: false, error: e?.message || 'Lỗi gọi trợ lý AI' })
    }
})

export default router
