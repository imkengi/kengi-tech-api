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

/* Model theo thứ tự ưu tiên (bảng model ổn định của Google, 30/09/2026). Không viết cứng
 * MỘT model vì hai kiểu hỏng đã gặp trong CÙNG một ngày:
 *   · 404 "no longer available to new users" — Google khoá model cũ với KEY MỚI
 *   · 503 "experiencing high demand" — model quá tải tạm thời
 * 404 ⇒ model đó không bao giờ dùng được với key này: nhớ lại, lượt sau bỏ qua.
 * 503/5xx/mất mạng ⇒ tạm thời: chờ ngắn thử lại CÙNG model một lần, rồi sang model kế.
 * 429 ⇒ hết hạn mức — hạn mức miễn phí tính RIÊNG từng model nên sang model kế ngay.
 * Quá tải thì KHÔNG nhớ lại: không vì vài phút quá tải mà hạ cấp model mãi mãi. */
const DS_MODEL = [...new Set([
    process.env.GEMINI_MODEL, 'gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-2.5-flash',
].filter(Boolean) as string[])]
const GEMINI_URL = (m: string) => `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`
/** Model trả 404 cho từng key — bỏ qua ở các lượt sau (tới khi khởi động lại). */
const khongDungChoKey = new Map<string, Set<string>>()
const MA_TAM_THOI = new Set([500, 502, 503, 504])
const ngu = (ms: number) => new Promise(r => setTimeout(r, ms))

/** Mọi model đều đang quá tải / hết hạn mức / mất mạng — THỬ LẠI SAU là đúng, không phải
 *  lỗi cấu hình. Cron dựa vào lớp lỗi này để hẹn chạy lại thay vì bỏ lỡ cả ngày. */
export class LoiGeminiTamThoi extends Error {
    readonly tamThoi = true
}

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
    // 30/09: AI tự duyệt — CHỈ chạy được khi thương hiệu bật công tắc, vẫn phải gọi đích danh
    'mkt_duyet_noi_dung',
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
    const bo = khongDungChoKey.get(apiKey) || new Set<string>()
    const conLai = DS_MODEL.filter(m => !bo.has(m))
    const thu = conLai.length ? conLai : DS_MODEL   // mọi model từng 404 ⇒ thử lại hết (key có thể đã được mở)
    const vet: string[] = []
    let coTamThoi = false

    for (const model of thu) {
        const body = JSON.stringify({
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents,
            tools,
            /* Dòng Gemini 3: Google KHUYẾN CÁO giữ temperature mặc định 1.0 — hạ thấp có thể
             * làm model LẶP VÒNG (với agent nhiều bước là đốt hết số bước). 0.2 chỉ cho 2.x. */
            ...(/^gemini-2\./.test(model) ? { generationConfig: { temperature: 0.2 } } : {}),
        })
        for (let lan = 0; lan < 2; lan++) {
            let res: Response
            try {
                res = await fetch(`${GEMINI_URL(model)}?key=${apiKey}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body,
                    signal: AbortSignal.timeout(90_000),
                })
            } catch {
                coTamThoi = true
                vet.push(`${model}: không nhận được phản hồi`)
                if (lan === 0) { await ngu(2_000); continue }
                break
            }
            const text = await res.text()
            let data: any = null
            try { data = JSON.parse(text) } catch { /* 5xx của Google có khi là trang HTML */ }
            if (res.ok) {
                if (!data) throw new Error(`Gemini trả về non-JSON (HTTP ${res.status}, ${model}): ${text.slice(0, 300)}`)
                return data
            }
            const loi = data?.error?.message || text.slice(0, 200)
            if (res.status === 404) {
                bo.add(model); khongDungChoKey.set(apiKey, bo)
                vet.push(`${model}: không dùng được với key này`)
                console.warn(`[AiAgent] ${model} → 404 với key này, bỏ qua từ giờ: ${loi}`)
                break
            }
            if (res.status === 429) {
                coTamThoi = true
                vet.push(`${model}: hết hạn mức (429)`)
                break
            }
            if (MA_TAM_THOI.has(res.status)) {
                coTamThoi = true
                vet.push(`${model}: ${res.status} ${/demand|overload/i.test(loi) ? 'quá tải' : 'lỗi tạm thời'}`)
                if (lan === 0) {
                    const cho = Number(res.headers.get('retry-after'))
                    await ngu(Math.min(8_000, cho > 0 ? cho * 1000 : 2_500))
                    continue
                }
                break
            }
            /* Lỗi thật (key sai, yêu cầu sai, nội dung bị chặn…): đổi model cũng vô ích — báo ngay. */
            throw new Error(`Gemini lỗi HTTP ${res.status} (${model}): ${loi}`)
        }
    }
    const chiTiet = vet.slice(-8).join('; ')
    if (coTamThoi) throw new LoiGeminiTamThoi(`Gemini đang quá tải hoặc hết hạn mức ở mọi model đã thử — lỗi TẠM THỜI, thử lại sau ít phút. (${chiTiet})`)
    throw new Error(`Không model Gemini nào dùng được với key này. (${chiTiet})`)
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
        let data: any
        try {
            data = await callGemini(contents, p.apiKey, p.systemPrompt, declarations)
        } catch (e: any) {
            /* Hỏng GIỮA CHỪNG thì những tool đã chạy (có thể đã soạn/đăng bài) phải còn dấu
             * vết: người đọc cần biết lượt này đã làm gì, và cron dựa vào đó để KHÔNG chạy lại
             * một lượt đã ghi dữ liệu (chạy lại là soạn trùng bài). */
            e.toolCalls = toolCalls
            e.steps = step
            throw e
        }
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
