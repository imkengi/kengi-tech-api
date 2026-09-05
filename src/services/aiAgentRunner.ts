// ═══════════════════════════════════════════════════════════════════════════════
//  AI AGENT RUNNER — vòng lặp gọi Gemini + chạy tool, dùng chung cho:
//    1. Trợ lý trong dashboard (/api/mcp-agent/chat) — người hỏi, agent trả lời
//    2. Trợ lý TỰ ĐỘNG theo lịch (cron/aiAgentCron) — không có người ngồi xem
//
//  Vì (2) chạy khi không ai giám sát, mặc định ở đây là AN TOÀN:
//  không truyền allowWrite thì agent CHỈ gọi được tool đọc.
// ═══════════════════════════════════════════════════════════════════════════════

import { TOOLS } from '../routes/mcp'
import { ToolCtx, ToolError } from '../lib/mcpTypes'
import { toGeminiSchema } from '../lib/geminiSchema'

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash'
const GEMINI_URL = (m: string) => `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`

/**
 * Tool ĐẨY RA NGOÀI cho người lạ thấy hoặc động vào tiền/kho.
 * Job tự động muốn dùng phải khai TÊN CỤ THỂ trong allowedTools — bật allowWrite
 * chung chung là chưa đủ. Mục đích: một job "quét bình luận" lỡ hiểu sai chỉ thị
 * cũng không thể tự lên đơn hay đăng bài lên fanpage.
 */
export const TOOL_NHAY_CAM = new Set([
    // Marketing Studio 05/09/2026: soan bai va len lich deu la thao tac
    // co the dan toi noi dung xuat hien tren trang khach hang.
    'mkt_soan_noi_dung',
    'mkt_len_lich_dang',
    'create_sale',
    'record_debt_payment',
    'fanpage_create_post',
    'fanpage_reply_comment',
    'fanpage_hide_comment',
    'fanpage_manage_scheduled_post',
    // Thêm 2026-08-15: sửa/xoá công khai + tiêu tiền quảng cáo
    'fanpage_edit_post',
    'fanpage_delete_post',
    'fanpage_delete_comment',
    'fanpage_like_comment',
    'fanpage_ads_set_campaign_status',
    'fanpage_boost_post',
    'fanpage_send_message',
])

export type KetQuaChay = {
    reply: string
    toolCalls: { name: string; args: any; ok: boolean; error?: string }[]
    steps: number
    chamTran: boolean
}

export type ThamSoChay = {
    apiKey: string
    systemPrompt: string
    ctx: ToolCtx
    /** Lời người dùng hỏi, hoặc chỉ thị của job tự động */
    message: string
    /** Lịch sử hội thoại (chỉ dùng cho chat) */
    history?: any[]
    maxSteps?: number
    /** Cho phép tool ghi. Mặc định FALSE — job tự động phải bật có chủ đích. */
    allowWrite?: boolean
    /** Chỉ cho phép đúng các tool này (tên). Rỗng/không truyền = mọi tool hợp lệ. */
    allowedTools?: string[]
    /**
     * CÓ NGƯỜI ĐANG NGỒI XEM (luồng chat dashboard).
     * Khi true, tool nhạy cảm không cần khai đích danh — người dùng thấy ngay
     * agent định làm gì và chặn được. Job tự động PHẢI để false (mặc định).
     */
    giamSat?: boolean
    /** Ghi log từng bước (job tự động dùng để soi lại) */
    onStep?: (info: { step: number; calls: string[] }) => void
}

async function callGemini(contents: any[], apiKey: string, systemPrompt: string, tools: any[]): Promise<any> {
    const res = await fetch(`${GEMINI_URL(GEMINI_MODEL)}?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents,
            tools,
            generationConfig: { temperature: 0.2 },
        }),
    })
    const text = await res.text()
    let data: any
    try { data = JSON.parse(text) } catch { throw new Error(`Gemini trả về non-JSON (HTTP ${res.status}): ${text.slice(0, 300)}`) }
    if (!res.ok) throw new Error(`Gemini lỗi HTTP ${res.status}: ${data?.error?.message || text.slice(0, 200)}`)
    return data
}

/** Lọc bộ tool theo quyền + allowlist, rồi bọc thành function declarations Gemini. */
export function chonTool(allowWrite: boolean, allowedTools?: string[], giamSat = false) {
    const chiDinh = allowedTools && allowedTools.length ? new Set(allowedTools) : null
    const dung = TOOLS.filter(t => {
        if (chiDinh && !chiDinh.has(t.name)) return false
        if (t.write && !allowWrite) return false
        // Tool nhạy cảm BẮT BUỘC được gọi tên trong allowlist, không nhận "cho hết".
        // Ngoại lệ: luồng CÓ NGƯỜI GIÁM SÁT (chat) — người dùng thấy agent định làm
        // gì và chặn được ngay, nên không cần khai trước từng tool.
        if (TOOL_NHAY_CAM.has(t.name) && !chiDinh && !giamSat) return false
        return true
    })
    return {
        dung,
        declarations: [{
            functionDeclarations: dung.map(t => ({
                name: t.name,
                description: t.description,
                parameters: toGeminiSchema(t.inputSchema),
            })),
        }],
    }
}

/**
 * Chạy một lượt agent tới khi model thôi gọi tool hoặc chạm trần bước.
 * KHÔNG ném lỗi tool ra ngoài — lỗi nghiệp vụ được đưa lại cho model để nó tự
 * xoay (vd hết tồn thì báo lại chủ shop), giống hệt luồng chat.
 */
export async function chayAgent(p: ThamSoChay): Promise<KetQuaChay> {
    const maxSteps = Math.min(Math.max(p.maxSteps ?? 8, 1), 20)
    const allowWrite = !!p.allowWrite
    const { dung, declarations } = chonTool(allowWrite, p.allowedTools, !!p.giamSat)
    if (!dung.length) throw new Error('Không có tool nào khả dụng với cấu hình quyền hiện tại')

    const contents: any[] = [...(p.history || []), { role: 'user', parts: [{ text: p.message }] }]
    const toolCalls: KetQuaChay['toolCalls'] = []

    for (let step = 0; step < maxSteps; step++) {
        const data = await callGemini(contents, p.apiKey, p.systemPrompt, declarations)
        const parts: any[] = data?.candidates?.[0]?.content?.parts || []
        const calls = parts.filter(x => x.functionCall).map(x => x.functionCall)

        if (!calls.length) {
            const reply = parts.filter(x => x.text).map(x => x.text).join('\n').trim()
            return { reply: reply || '(không có nội dung trả lời)', toolCalls, steps: step + 1, chamTran: false }
        }

        p.onStep?.({ step: step + 1, calls: calls.map((c: any) => c.name) })
        contents.push({ role: 'model', parts })

        const responseParts: any[] = []
        for (const fc of calls) {
            const tool = dung.find(t => t.name === fc.name)
            let payload: any
            let ok = true
            let loi: string | undefined
            if (!tool) {
                // Model gọi tool ngoài allowlist → nói rõ để nó không thử lại
                loi = `Tool "${fc.name}" không nằm trong danh sách được phép của tác vụ này.`
                payload = { error: loi }; ok = false
            } else {
                try {
                    payload = await tool.run(fc.args || {}, p.ctx)
                } catch (e: any) {
                    loi = e instanceof ToolError ? e.message : `Lỗi hệ thống: ${e?.message || e}`
                    payload = { error: loi }; ok = false
                }
            }
            toolCalls.push({ name: fc.name, args: fc.args || {}, ok, error: loi })
            responseParts.push({ functionResponse: { name: fc.name, response: { result: payload } } })
        }
        contents.push({ role: 'user', parts: responseParts })
    }

    return {
        reply: 'Đã đạt giới hạn số bước xử lý.',
        toolCalls,
        steps: maxSteps,
        chamTran: true,
    }
}
