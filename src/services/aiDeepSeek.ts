// ═══════════════════════════════════════════════════════════════════════════════
//  DEEPSEEK — nhà cung cấp AI DỰ PHÒNG cho aiAgentRunner (30/09/2026)
//
//  HUTI 30/09 18:05: key Gemini hết hạn mức (429) ở 3.8/3.7/3.6, 3.5 quá tải (503) ⇒ lượt
//  "soạn 3 bài + tự duyệt" hỏng GIỮA CHỪNG: bài đã lưu mà chưa duyệt, chưa hẹn giờ. Chủ shop:
//  "hết hạn mức thì đổi qua deepseek". Runner vẫn giữ hội thoại ở dạng GEMINI; ở đây đổi
//  qua lại dạng OpenAI (DeepSeek dùng chuẩn OpenAI) nên vòng lặp tool không phải sửa.
//
//  Tài liệu (30/09/2026): POST https://api.deepseek.com/chat/completions, model
//  "deepseek-flash" (nhanh, rẻ) / "deepseek-v4-pro". Chế độ "thinking" BẬT SẴN — phải tắt
//  ({ thinking: { type: 'disabled' } }): bật thì mỗi lượt gọi tool phải gửi lại
//  reasoning_content, thiếu là 400.
// ═══════════════════════════════════════════════════════════════════════════════

const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions'
const DS_MODEL_DEEPSEEK = [...new Set([process.env.DEEPSEEK_MODEL, 'deepseek-flash', 'deepseek-v4-pro'].filter(Boolean) as string[])]
const MA_TAM_THOI = new Set([429, 500, 502, 503, 504])
const ngu = (ms: number) => new Promise(r => setTimeout(r, ms))

/** DeepSeek quá tải / mất mạng — cron hẹn chạy lại như lỗi tạm thời của Gemini. */
export class LoiDeepSeekTamThoi extends Error {
    readonly tamThoi = true
}

/** Hội thoại dạng Gemini (contents/parts) → messages dạng OpenAI. */
export function sangOpenAi(contents: any[], systemPrompt: string): any[] {
    const msgs: any[] = [{ role: 'system', content: systemPrompt }]
    let dem = 0
    let choKetQua: string[] = []   // id các lời gọi tool của lượt model gần nhất, theo thứ tự
    for (const c of contents || []) {
        const parts: any[] = c?.parts || []
        const chu = parts.filter(x => typeof x?.text === 'string' && x.text).map(x => x.text).join('\n')
        if (c?.role === 'model') {
            const tool_calls = parts.filter(x => x?.functionCall).map(x => ({
                id: `call_${++dem}`,
                type: 'function',
                function: { name: x.functionCall.name, arguments: JSON.stringify(x.functionCall.args ?? {}) },
            }))
            choKetQua = tool_calls.map(t => t.id)
            msgs.push({ role: 'assistant', content: chu || null, ...(tool_calls.length ? { tool_calls } : {}) })
            continue
        }
        for (const x of parts.filter(p => p?.functionResponse)) {
            msgs.push({
                role: 'tool',
                tool_call_id: choKetQua.shift() ?? `call_${++dem}`,
                content: JSON.stringify(x.functionResponse.response ?? {}),
            })
        }
        if (chu) msgs.push({ role: 'user', content: chu })
    }
    return msgs
}

/** Tool của runner → tools dạng OpenAI (dùng thẳng JSON Schema gốc, không qua bộ đổi của Gemini). */
export function toolOpenAi(dung: { name: string; description: string; inputSchema: any }[]): any[] {
    return dung.map(t => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.inputSchema || { type: 'object', properties: {} } },
    }))
}

/** Trả lời dạng OpenAI → dạng Gemini mà vòng lặp runner đang đọc (candidates[0].content.parts). */
export function sangGemini(data: any): any {
    const msg = data?.choices?.[0]?.message || {}
    const parts: any[] = []
    if (typeof msg.content === 'string' && msg.content.trim()) parts.push({ text: msg.content })
    for (const tc of msg.tool_calls || []) {
        let args: any = {}
        /* JSON hỏng thì đưa {} — tool báo thiếu tham số, model thấy lỗi và gọi lại. */
        try { args = JSON.parse(tc?.function?.arguments || '{}') } catch { args = {} }
        parts.push({ functionCall: { name: tc?.function?.name, args } })
    }
    return { candidates: [{ content: { role: 'model', parts } }] }
}

/**
 * Một lượt gọi DeepSeek. Nhận/trả ĐÚNG dạng Gemini để runner dùng chung vòng lặp.
 * 429/5xx/mất mạng: chờ ngắn, thử lại một lần, rồi sang model kế. 401 = key sai,
 * 402 = tài khoản DeepSeek hết tiền — lỗi thật, báo ngay.
 */
export async function goiDeepSeek(contents: any[], apiKey: string, systemPrompt: string, dung: any[]): Promise<any> {
    const messages = sangOpenAi(contents, systemPrompt)
    const tools = toolOpenAi(dung)
    const vet: string[] = []
    for (const model of DS_MODEL_DEEPSEEK) {
        const body = JSON.stringify({
            model, messages,
            ...(tools.length ? { tools, tool_choice: 'auto' } : {}),
            thinking: { type: 'disabled' },
            max_tokens: 8192,
        })
        for (let lan = 0; lan < 2; lan++) {
            let res: Response
            try {
                res = await fetch(DEEPSEEK_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
                    body,
                    signal: AbortSignal.timeout(120_000),
                })
            } catch {
                vet.push(`${model}: không nhận được phản hồi`)
                if (lan === 0) { await ngu(2_000); continue }
                break
            }
            const text = await res.text()
            let data: any = null
            try { data = JSON.parse(text) } catch { /* trang lỗi HTML */ }
            if (res.ok && data) return sangGemini(data)
            const loi = data?.error?.message || text.slice(0, 200)
            if (res.status === 401) throw new Error(`Key DeepSeek không đúng hoặc đã bị thu hồi (401): ${loi}`)
            if (res.status === 402) throw new Error(`Tài khoản DeepSeek hết tiền (402) — nạp thêm ở platform.deepseek.com: ${loi}`)
            if (MA_TAM_THOI.has(res.status)) {
                vet.push(`${model}: ${res.status}`)
                if (lan === 0) { await ngu(res.status === 429 ? 5_000 : 2_500); continue }
                break
            }
            throw new Error(`DeepSeek lỗi HTTP ${res.status} (${model}): ${loi}`)
        }
    }
    throw new LoiDeepSeekTamThoi(`DeepSeek cũng đang quá tải / mất mạng — lỗi TẠM THỜI. (${vet.join('; ')})`)
}
