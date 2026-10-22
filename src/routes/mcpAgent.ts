import { Router, Response } from 'express'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { type ToolCtx } from '../lib/mcpTypes'
import { chayAgent } from '../services/aiAgentRunner'
import { layKeyAi } from '../lib/keyAi'
import { TEN_TOOL_THUE } from './mcpTaxTools'

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
 * Key: Gemini của cửa hàng (hoặc GEMINI_API_KEY env) + DeepSeek dự phòng (lib/keyAi).
 * Chưa có key nào → 503.
 */

const router = Router()

const MAX_STEPS = 6

const SYSTEM_PROMPT =
    'Bạn là trợ lý vận hành cửa hàng bán lẻ Kengi, trả lời NGẮN GỌN bằng tiếng Việt. ' +
    'Bạn có các công cụ tra cứu/thao tác dữ liệu của cửa hàng — hãy GỌI CÔNG CỤ để lấy số liệu thật, ' +
    'TUYỆT ĐỐI không bịa số. Có thể gọi nhiều công cụ liên tiếp nếu cần. Tiền tệ VND, định dạng có dấu chấm ngăn cách. ' +
    'Khi trả lời số liệu, nêu rõ mốc thời gian. Nếu công cụ báo lỗi, giải thích ngắn cho người dùng và gợi ý cách khắc phục. ' +
    'Bạn cũng vận hành được FANPAGE FACEBOOK của cửa hàng qua nhóm công cụ fanpage_*: gọi fanpage_list_pages trước để biết page nào đang kết nối, ' +
    'fanpage_list_comments để tìm bình luận chưa trả lời rồi fanpage_reply_comment, fanpage_create_post để đăng/lên lịch bài, ' +
    'fanpage_create_rule + fanpage_set_auto_reply để trả lời tự động 24/7. ' +
    'Bài đã đăng: fanpage_post_comments đọc hết bình luận 1 bài, fanpage_edit_post sửa chữ, fanpage_delete_post chỉ khi người dùng nói rõ muốn xoá (confirm=true). ' +
    'Hộp thư Messenger: fanpage_list_conversations (only_unread=true) → fanpage_read_conversation để hiểu ngữ cảnh → fanpage_send_message. ' +
    'Quảng cáo: fanpage_ads_accounts → fanpage_ads_campaigns xem chiến dịch nào tốn tiền mà kém; fanpage_boost_post tạo boost ở trạng thái TẠM DỪNG, ' +
    'chỉ gọi fanpage_ads_set_campaign_status ACTIVE khi người dùng xác nhận vì đó là tiêu tiền thật. ' +
    'Khi người dùng nhờ LÊN CONTENT / VIẾT BÀI / LÊN KẾ HOẠCH nội dung, dùng nhóm marketing_*: marketing_get_brand để nắm giọng thương hiệu, ' +
    'marketing_content_material để lấy hàng hoá + ảnh THẬT (không bịa tên hàng, giá, ảnh), marketing_suggest_slots để lấy giờ đăng, ' +
    'rồi marketing_save_draft lưu từng bài. Bài lưu bằng marketing_* KHÔNG lên Facebook ngay mà vào hàng đợi chờ chủ shop duyệt ở mục Content AI — ' +
    'hãy nói rõ điều đó cho người dùng. Chỉ dùng fanpage_create_post khi họ yêu cầu đăng thẳng, không qua duyệt. ' +
    'Các thao tác ĐĂNG BÀI, TRẢ LỜI KHÁCH, ẨN BÌNH LUẬN là hành động công khai ra ngoài — hãy nêu rõ nội dung định đăng/gửi và XIN XÁC NHẬN của người dùng trước khi gọi công cụ, trừ khi họ đã bảo cứ làm. ' +
    'TRƯỚC KHI kết luận từ bất kỳ báo cáo THEO KỲ nào (doanh thu tháng, lãi lỗ, thuế, đối chiếu), hãy gọi data_health_check một lần. Nếu có mục ở mức "nang" thì PHẢI nói rõ hạn chế đó kèm số liệu trước khi đưa ra con số — nhiều cửa hàng nhập lịch sử từ phần mềm cũ nên chứng từ nằm sai kỳ, và trình bày con số như sự thật đã chắc là làm chủ shop quyết sai. Con số công cụ trả về là null nghĩa là CHƯA ĐỌC ĐƯỢC, không phải bằng 0 — đừng suy ra là không có. ' +
    'HAI TOOL cùng trả lời "doanh thu theo kỳ" nhưng cắt kỳ khác nhau: revenue_by_day cắt theo NGÀY BÁN trên chứng từ, còn sales_report và profit_report cắt theo NGÀY GHI SỔ. Với cửa hàng nhập lịch sử từ phần mềm cũ, hai con số lệch nhau nhiều lần (đo thật: tháng 7 ra 983 triệu so với 5,0 tỷ). Khi được hỏi doanh thu/lãi của MỘT THÁNG cụ thể, hãy ưu tiên revenue_by_day; nếu dùng sales_report hay profit_report thì PHẢI đọc trường canhBaoLechKy và nói rõ con số gồm cả chứng từ của tháng khác. ' +
    'Hỏi về LÃI/LỖ dùng profit_report, chi phí dùng expense_report, nợ nhà cung cấp dùng supplier_debt, tồn theo kho dùng stock_by_warehouse. '+
    'Hỏi về THUẾ (doanh thu kê khai / "doanh số trên thuế", tờ khai GTGT, hạn nộp, hoá đơn điện tử, tồn kho thuế, TNCN): tax_vat_return (kèm đối chiếu doanh thu phiếu bán + hoá đơn điện tử đã gửi cơ quan thuế), ' +
    'tax_deadlines, einvoice_status, tax_stock, tax_pit; rủi ro thanh tra dùng tax_audit_check. Trường nào tên bắt đầu bằng canhBao thì PHẢI nói trước con số — số 0 trên tờ khai không có nghĩa là không phải nộp. '+
    'profit_report tính giá vốn theo giá vốn HIỆN TẠI nên là ước tính — khi báo cáo phải nói rõ, và nếu có cảnh báo thiếu giá vốn thì nhắc chủ shop cập nhật.'

/* HỎI AI VỀ THUẾ (22/10/2026 — chủ shop: "làm MCP thuế để hỏi trợ lý AI"): FE gửi chuDe='thue' từ các
 * trang Thuế / Tuân thủ / Hoá đơn ĐT. Chỉ nạp nhóm công cụ thuế + sổ sách (mcpTaxTools.TEN_TOOL_THUE) —
 * bớt hàng chục công cụ fanpage/marketing không liên quan để model chọn đúng — và KHÔNG có công cụ ghi. */
const SYSTEM_PROMPT_THUE =
    'Bạn là trợ lý THUẾ & KẾ TOÁN của cửa hàng Kengi, trả lời NGẮN GỌN bằng tiếng Việt, dễ hiểu với chủ shop không chuyên kế toán. ' +
    'LUÔN GỌI CÔNG CỤ để lấy số thật — TUYỆT ĐỐI không bịa số, không đoán luật. Nêu rõ kỳ (tháng/quý/năm) của mọi con số. Tiền VND, có dấu chấm ngăn cách. ' +
    'Chọn công cụ: thuế GTGT kỳ này phải nộp bao nhiêu → tax_vat_return; sắp phải nộp gì, có trễ hạn không, còn nợ thuế bao nhiêu → tax_deadlines; ' +
    'hoá đơn điện tử (đơn chưa xuất hoá đơn, hoá đơn lỗi, hoá đơn phải điều chỉnh vì khách trả hàng) → einvoice_status; ' +
    'tồn kho thuế, mã thiếu hoá đơn đầu vào → tax_stock; thuế TNCN của nhân viên → tax_pit; ' +
    'rủi ro nếu bị thanh tra → tax_audit_check rồi tax_assessment_risk / tax_remediation_plan / tax_audit_drill; ' +
    'đối chiếu doanh thu sổ sách – tờ khai – hoá đơn → tax_reconcile_3way; quyết toán TNDN → tax_cit_settlement; ' +
    'hộ kinh doanh bỏ thuế khoán 2026 → hkd_bo_thue_khoan_2026; truy một chứng từ → tax_trace_document; sổ cái, cân đối, báo cáo tài chính → accounting_*. ' +
    'TRƯỚC KHI kết luận về số liệu theo kỳ, gọi data_health_check một lần; có mục mức "nang" thì PHẢI nói rõ hạn chế đó trước khi đưa số. ' +
    'Số null nghĩa là CHƯA ĐỌC ĐƯỢC / chưa suy ra được, KHÔNG phải 0 — đừng nói "không phải nộp". Không đọc được dữ liệu KHÔNG phải là vi phạm — đừng kết tội cửa hàng. ' +
    'Số "tạm tính" / "ước tính" phải gọi đúng là tạm tính / ước tính. Công cụ trả về BẤT KỲ trường nào tên bắt đầu bằng canhBao (canhBaoSoChuaGhi, canhBaoKhongApDung, canhBaoChuaRo, canhBaoMucGiamTru, canhBaoCat…), tamTinh hay ghiChu cảnh báo thì PHẢI nói lại cho chủ shop TRƯỚC khi đưa con số. ' +
    'Nêu nghĩa vụ, hạn nộp hay mức phạt thì kèm căn cứ pháp lý nếu công cụ có trả (canCu). ' +
    'Không hướng dẫn trốn thuế, khai sai hay lập chứng từ khống; được gợi ý cách làm đúng luật và cách khắc phục. ' +
    'Bạn KHÔNG có công cụ ghi: không lập hay nộp tờ khai, không xuất hay huỷ hoá đơn — được nhờ thì chỉ chủ shop làm ở trang tương ứng. ' +
    'Câu trả lời có số thuế quan trọng thì cuối câu nhắc ngắn: đây là số phần mềm tự tính, nên để kế toán kiểm trước khi nộp chính thức.'

const WRITE_ROLES = ['admin', 'manager', 'owner', 'superadmin']

router.post('/chat', authMiddleware, async (req: AuthRequest, res: Response) => {
    const prisma = req.storePrisma
    if (!prisma) {
        res.status(401).json({ success: false, error: 'Chưa xác thực store' })
        return
    }

    // Key theo TỪNG CỬA HÀNG (admin cấu hình trong Cài đặt) → fallback env dùng chung.
    // DeepSeek là dự phòng: Gemini hết hạn mức / quá tải thì câu trả lời vẫn ra.
    const key = await layKeyAi(prisma)
    const apiKey = key.gemini
    if (!apiKey && !key.deepseek) {
        res.status(503).json({ success: false, error: 'Trợ lý AI chưa cấu hình — vào Cài đặt → Trợ lý AI để nhập Gemini API Key (chỉ admin)' })
        return
    }

    const message = String(req.body?.message || '').trim()
    if (!message) { res.status(400).json({ success: false, error: 'Thiếu message' }); return }

    const role = String(req.user?.role || '')
    const thue = req.body?.chuDe === 'thue'
    // Chế độ thuế CHỈ ĐỌC dù người hỏi có quyền ghi
    const canWrite = !thue && WRITE_ROLES.includes(role)
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
            deepseekKey: key.deepseek,
            systemPrompt: thue ? SYSTEM_PROMPT_THUE : SYSTEM_PROMPT,
            ctx,
            message,
            history,
            // Câu hỏi thuế hay phải gọi chuỗi: soát dữ liệu → tờ khai → lịch nộp → đối chiếu
            maxSteps: thue ? 8 : MAX_STEPS,
            allowWrite: canWrite,
            ...(thue ? { allowedTools: TEN_TOOL_THUE } : {}),
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
