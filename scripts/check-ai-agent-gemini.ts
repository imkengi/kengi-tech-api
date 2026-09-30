/**
 * KIỂM BỘ CHẠY AI (Gemini) TRƯỚC NHỮNG KIỂU HỎNG ĐÃ GẶP THẬT  —  npm run check:aigemini
 *
 * 30/09/2026 trong CÙNG một buổi: key mới gọi gemini-2.5-flash nhận 404 "no longer available
 * to new users", đổi sang gemini-3.8-flash thì nhận 503 "high demand". Bộ chạy cũ gặp lỗi là
 * bỏ cuộc ⇒ tác vụ "mỗi sáng 7:00" mất trắng cả ngày.
 *
 * fetch GIẢ (không gọi Google thật), prisma GIẢ, DATABASE_URL trỏ cổng chết (máy dev .env = PROD).
 */
process.env.DATABASE_URL = 'postgresql://khong:khong@127.0.0.1:1/khong-bao-gio'
process.env.DIRECT_URL = process.env.DATABASE_URL
delete process.env.GEMINI_MODEL

const daGoi: { model: string; body: any }[] = []
let kichBan: (model: string, lan: number) => { status: number; body?: any; headers?: any } = () => ({ status: 200 })
/* DeepSeek GIẢ (dạng OpenAI) — ghi lại body + header từng lời gọi */
const goiDS: { body: any; headers: any }[] = []
let kichBanDS: (body: any, lan: number) => { status: number; body?: any } = () => ({ status: 500 })
;(globalThis as any).fetch = async (url: string, opt: any) => {
    if (String(url).includes('api.deepseek.com')) {
        const body = JSON.parse(opt.body)
        goiDS.push({ body, headers: opt.headers })
        const r = kichBanDS(body, goiDS.length)
        return new Response(JSON.stringify(r.body ?? {}), { status: r.status })
    }
    const model = /models\/([^:]+):/.exec(url)?.[1] || '?'
    daGoi.push({ model, body: JSON.parse(opt.body) })
    const r = kichBan(model, daGoi.filter(g => g.model === model).length)
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status, headers: r.headers })
}
const traLoi = (text: string) => ({ status: 200, body: { candidates: [{ content: { parts: [{ text }] } }] } })
const goiTool = (name: string, args: any = {}) => ({ status: 200, body: { candidates: [{ content: { parts: [{ functionCall: { name, args }, thoughtSignature: 'sig-abc' }] } }] } })

let dat = 0, truot = 0
function kiem(ten: string, dung: boolean, chiTiet?: any) {
    if (dung) { dat++; console.log('  ✅', ten) }
    else { truot++; console.log('  ❌', ten, chiTiet !== undefined ? JSON.stringify(chiTiet).slice(0, 400) : '') }
}

async function main() {
    const { chayAgent, LoiGeminiTamThoi } = await import('../src/services/aiAgentRunner')
    const { chayMotJob } = await import('../src/cron/aiAgentCron')
    const brand = { id: 'b1', name: 'Bếp', archivedAt: null, createdAt: new Date(0), bannedWords: '[]' }
    const prismaTool: any = new Proxy({}, {
        get: (_t, m: string) => ({
            findMany: async () => (m === 'mktBrand' ? [brand] : []),
            updateMany: async () => ({ count: 0 }),
            update: async ({ data }: any) => Object.assign(brand, data),
            count: async () => 0,
        }),
    })
    const ctx: any = { prisma: prismaTool, scopes: 'read,write', storeCode: 'THU' }
    const chay = (apiKey: string, extra: any = {}) =>
        chayAgent({ apiKey, systemPrompt: 's', ctx, message: 'làm việc', allowedTools: ['mkt_danh_sach_thuong_hieu'], ...extra })

    console.log('━━ Chọn model')
    daGoi.length = 0
    kichBan = () => traLoi('xong')
    let r: any = await chay('K1')
    kiem('mặc định gemini-3.8-flash', daGoi.map(g => g.model).join() === 'gemini-3.8-flash', daGoi.map(g => g.model))
    kiem('Gemini 3: KHÔNG ép temperature (Google khuyến cáo giữ 1.0, hạ thấp dễ lặp vòng)', daGoi[0].body.generationConfig === undefined, daGoi[0].body.generationConfig)

    console.log('━━ 503 quá tải: thử lại cùng model rồi sang model kế')
    daGoi.length = 0
    kichBan = (m) => (m === 'gemini-3.8-flash' ? { status: 503, body: { error: { message: 'This model is currently experiencing high demand.' } }, headers: { 'retry-after': '1' } } : traLoi('xong bằng 3.7'))
    const t0 = Date.now()
    r = await chay('K2')
    kiem('3.8 hỏng 2 lần (1 lần thử lại) → 3.7 chạy', daGoi.map(g => g.model).join() === 'gemini-3.8-flash,gemini-3.8-flash,gemini-3.7-flash' && r.reply === 'xong bằng 3.7', daGoi.map(g => g.model))
    kiem('tôn trọng Retry-After (chờ ~1 giây, không treo lâu)', Date.now() - t0 < 5_000, Date.now() - t0)
    daGoi.length = 0
    kichBan = () => traLoi('ok')
    await chay('K2')
    kiem('quá tải KHÔNG bị nhớ: lượt sau vẫn ưu tiên 3.8', daGoi[0].model === 'gemini-3.8-flash', daGoi.map(g => g.model))

    console.log('━━ 404 (model khoá với key mới): nhớ lại, lượt sau bỏ qua')
    daGoi.length = 0
    kichBan = (m) => (m === 'gemini-3.8-flash' ? { status: 404, body: { error: { message: 'no longer available to new users' } } } : traLoi('ok'))
    await chay('K3')
    kiem('404 không thử lại cùng model', daGoi.map(g => g.model).join() === 'gemini-3.8-flash,gemini-3.7-flash', daGoi.map(g => g.model))
    daGoi.length = 0
    kichBan = () => traLoi('ok')
    await chay('K3')
    kiem('lượt sau bỏ qua model đã 404 với key này', daGoi[0].model === 'gemini-3.7-flash', daGoi.map(g => g.model))

    console.log('━━ 429 hết hạn mức: sang model kế NGAY (hạn mức tính riêng từng model)')
    daGoi.length = 0
    kichBan = (m) => (m === 'gemini-3.8-flash' ? { status: 429, body: { error: { message: 'quota' } } } : traLoi('ok'))
    await chay('K4')
    kiem('429 không thử lại cùng model', daGoi.map(g => g.model).join() === 'gemini-3.8-flash,gemini-3.7-flash', daGoi.map(g => g.model))

    console.log('━━ Lỗi thật thì báo ngay')
    daGoi.length = 0
    kichBan = () => ({ status: 400, body: { error: { message: 'API key not valid' } } })
    let loi: any = null
    try { await chay('K5') } catch (e) { loi = e }
    kiem('400 (key sai) → báo ngay sau 1 lần gọi, không thử model khác', daGoi.length === 1 && /API key not valid/.test(loi?.message) && !(loi instanceof LoiGeminiTamThoi), { n: daGoi.length, m: loi?.message })

    console.log('━━ Mọi model quá tải → lỗi TẠM THỜI')
    daGoi.length = 0
    kichBan = () => ({ status: 503, body: { error: { message: 'high demand' } }, headers: { 'retry-after': '0.01' } })
    loi = null
    try { await chay('K6') } catch (e) { loi = e }
    kiem('ném LoiGeminiTamThoi (tamThoi=true)', loi instanceof LoiGeminiTamThoi && loi.tamThoi === true, loi?.message)
    kiem('đã thử đủ các model 3.x trước khi bỏ cuộc', ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash'].every(m => daGoi.some(g => g.model === m)))
    kiem('model 2.x vẫn giữ temperature 0.2', daGoi.find(g => g.model === 'gemini-2.5-flash')?.body.generationConfig?.temperature === 0.2)

    console.log('━━ Hỏng GIỮA CHỪNG: giữ dấu vết tool đã chạy + giữ thought signature')
    daGoi.length = 0
    kichBan = (_m) => (daGoi.length === 1 ? goiTool('mkt_danh_sach_thuong_hieu') : { status: 503, body: { error: { message: 'high demand' } }, headers: { 'retry-after': '0.01' } })
    loi = null
    try { await chay('K7') } catch (e) { loi = e }
    kiem('lỗi mang theo toolCalls + steps', Array.isArray(loi?.toolCalls) && loi.toolCalls.length === 1 && loi.toolCalls[0].name === 'mkt_danh_sach_thuong_hieu' && loi.steps === 1, { tc: loi?.toolCalls, s: loi?.steps })
    const buoc2 = daGoi[1]?.body?.contents || []
    kiem('lượt gọi sau gửi lại NGUYÊN part có thoughtSignature (Gemini 3 bắt buộc)', buoc2.some((c: any) => c.role === 'model' && c.parts?.[0]?.thoughtSignature === 'sig-abc'), buoc2)

    console.log('━━ 429: đọc đúng loại hạn mức (theo phút / theo NGÀY)')
    const { doc429 } = await import('../src/services/aiAgentRunner')
    const q429 = (quotaId: string, retry?: string) => ({ error: { code: 429, message: 'You exceeded your current quota', status: 'RESOURCE_EXHAUSTED', details: [
        { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaMetric: 'generativelanguage.googleapis.com/generate_content_free_tier_requests', quotaId }] },
        ...(retry ? [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: retry }] : []),
    ] } })
    const PHUT = 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier', NGAY = 'GenerateRequestsPerDayPerProjectPerModel-FreeTier'
    kiem('quotaId …PerDay… ⇒ hết hạn mức NGÀY', doc429(q429(NGAY)).theoNgay === true)
    const qp = doc429(q429(PHUT, '38.2s'))
    kiem('quotaId …PerMinute… + RetryInfo 38.2s ⇒ theo phút, chờ 38.200 ms', !qp.theoNgay && qp.choMs === 38200, qp)
    daGoi.length = 0
    kichBan = (m, lan) => (m === 'gemini-3.8-flash' && lan === 1 ? { status: 429, body: q429(PHUT, '0.2s') } : traLoi('ok sau khi chờ'))
    r = await chay('K8')
    kiem('hết theo PHÚT, không có dự phòng ⇒ chờ retryDelay rồi thử lại CÙNG model', daGoi.map(g => g.model).join() === 'gemini-3.8-flash,gemini-3.8-flash' && r.reply === 'ok sau khi chờ', daGoi.map(g => g.model))
    daGoi.length = 0
    kichBan = (m) => (m === 'gemini-2.5-flash' ? { status: 404, body: { error: { message: 'no longer available' } } } : { status: 429, body: q429(NGAY, '3600s') })
    loi = null
    try { await chay('K9') } catch (e) { loi = e }
    kiem('hết hạn mức NGÀY ⇒ nói rõ "hạn mức NGÀY", giờ làm mới, gợi ý thêm key DeepSeek', loi instanceof LoiGeminiTamThoi && /hạn mức NGÀY/.test(loi.message) && /14:00/.test(loi.message) && /DeepSeek/.test(loi.message), loi?.message)

    console.log('━━ Hết hạn mức ⇒ chuyển sang DeepSeek, chạy tiếp TỪ ĐÚNG BƯỚC ĐÓ (HUTI 30/09 18:05)')
    const { sangOpenAi, sangGemini } = await import('../src/services/aiDeepSeek')
    const dsGoiTool = (name: string, args = '{}') => ({ status: 200, body: { choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'x1', type: 'function', function: { name, arguments: args } }] }, finish_reason: 'tool_calls' }] } })
    const dsTraLoi = (text: string) => ({ status: 200, body: { choices: [{ message: { role: 'assistant', content: text }, finish_reason: 'stop' }] } })
    daGoi.length = 0; goiDS.length = 0
    kichBan = (m) => (m === 'gemini-2.5-flash' ? { status: 404, body: { error: { message: 'no longer available' } } }
        : daGoi.length === 1 ? goiTool('mkt_danh_sach_thuong_hieu') : { status: 429, body: q429(NGAY) })
    kichBanDS = (_b, lan) => (lan === 1 ? dsGoiTool('mkt_danh_sach_thuong_hieu') : dsTraLoi('xong bằng DeepSeek'))
    r = await chay('K10', { deepseekKey: 'sk-thu-DSK' })
    kiem('lượt KHÔNG hỏng: xong bằng DeepSeek', r.reply === 'xong bằng DeepSeek' && r.toolCalls.length === 2 && r.toolCalls.every((t: any) => t.ok), r)
    kiem('kết quả ghi rõ đã chuyển sang DeepSeek + lý do', /hạn mức NGÀY/.test(r.doiSangDeepSeek || ''), r.doiSangDeepSeek)
    kiem('bước 1 bằng Gemini; bước 2 thử hết Gemini rồi sang DeepSeek; bước 3 đi thẳng DeepSeek', daGoi.length === 6 && goiDS.length === 2, { gemini: daGoi.map(g => g.model), ds: goiDS.length })
    const ds1 = goiDS[0]
    kiem('DeepSeek: model deepseek-flash, TẮT thinking (bật thì phải gửi lại reasoning_content)', ds1.body.model === 'deepseek-flash' && ds1.body.thinking?.type === 'disabled', ds1.body.model)
    kiem('DeepSeek: key đi qua header Bearer', ds1.headers?.Authorization === 'Bearer sk-thu-DSK')
    kiem('DeepSeek: tool dạng OpenAI, dùng JSON Schema gốc', ds1.body.tools?.[0]?.type === 'function' && ds1.body.tools[0].function.name === 'mkt_danh_sach_thuong_hieu' && ds1.body.tools[0].function.parameters?.type === 'object', ds1.body.tools?.[0])
    const vai = ds1.body.messages.map((m: any) => m.role).join()
    kiem('DeepSeek nhận ĐỦ hội thoại Gemini trước đó: system, user, assistant(tool_calls), tool', vai === 'system,user,assistant,tool' && ds1.body.messages[2].tool_calls[0].id === ds1.body.messages[3].tool_call_id, ds1.body.messages)
    const doi = sangOpenAi([
        { role: 'user', parts: [{ text: 'hỏi' }] },
        { role: 'model', parts: [{ functionCall: { name: 'a', args: { x: 1 } } }, { functionCall: { name: 'b', args: {} } }] },
        { role: 'user', parts: [{ functionResponse: { name: 'a', response: { result: 1 } } }, { functionResponse: { name: 'b', response: { result: 2 } } }] },
    ], 'S')
    kiem('nhiều tool trong một bước: mỗi kết quả khớp đúng id lời gọi', doi[2].tool_calls.map((t: any) => t.id).join() === [doi[3].tool_call_id, doi[4].tool_call_id].join() && JSON.parse(doi[2].tool_calls[0].function.arguments).x === 1, doi)
    const ve = sangGemini({ choices: [{ message: { content: 'ok', tool_calls: [{ function: { name: 'a', arguments: '{"y":2}' } }, { function: { name: 'b', arguments: '{hỏng' } }] } }] })
    kiem('trả lời DeepSeek → dạng Gemini (JSON hỏng thành {} để tool báo thiếu tham số)', ve.candidates[0].content.parts[0].text === 'ok' && ve.candidates[0].content.parts[1].functionCall.args.y === 2 && JSON.stringify(ve.candidates[0].content.parts[2].functionCall.args) === '{}', ve)
    daGoi.length = 0; goiDS.length = 0
    kichBanDS = () => dsTraLoi('chỉ có DeepSeek')
    r = await chay('', { deepseekKey: 'sk-thu-DSK' })
    kiem('không có key Gemini mà có DeepSeek ⇒ chạy DeepSeek luôn', r.reply === 'chỉ có DeepSeek' && daGoi.length === 0 && goiDS.length === 1, { g: daGoi.length, d: goiDS.length })
    daGoi.length = 0; goiDS.length = 0
    kichBan = (m) => (m === 'gemini-2.5-flash' ? { status: 404, body: {} } : { status: 429, body: q429(NGAY) })
    kichBanDS = () => ({ status: 402, body: { error: { message: 'Insufficient Balance' } } })
    loi = null
    try { await chay('K11', { deepseekKey: 'sk-thu-DSK' }) } catch (e) { loi = e }
    kiem('DeepSeek hết tiền (402) ⇒ báo rõ, không thử lại vô ích', /hết tiền/.test(loi?.message || '') && goiDS.length === 1, { m: loi?.message, n: goiDS.length })

    // ─── Cron: hẹn chạy lại khi lỗi tạm thời ─────────────────────────────────
    console.log('━━ Cron: lỗi tạm thời → hẹn lại 15 phút; đã ghi thì KHÔNG chạy lại')
    const runs: any[] = []
    let jobGhi: any = null
    const sp: any = {
        storeSettings: { findFirst: async () => ({ geminiApiKey: 'KCRON' }) },
        user: { findFirst: async () => ({ id: 'u1', name: 'Chủ', branchId: null }) },
        aiAgentRun: {
            create: async ({ data }: any) => { const x = { id: 'r' + runs.length, startedAt: new Date(Date.now() + runs.length), ...data }; runs.push(x); return x },
            update: async ({ where, data }: any) => Object.assign(runs.find(x => x.id === where.id), data),
            findMany: async ({ where }: any) => runs.filter(x => x.id !== where.id.not).sort((a, b) => b.startedAt - a.startedAt),
        },
        aiAgentJob: { update: async ({ data }: any) => { jobGhi = data; return data } },
        mktBrand: prismaTool.mktBrand,
    }
    const job = { id: 'j1', name: 'Soạn bài', prompt: 'x', scheduleKind: 'daily', atHour: 7, atMinute: 0, intervalMinutes: 60, allowWrite: true, allowedTools: '["mkt_danh_sach_thuong_hieu","mkt_cap_nhat_ho_so_thuong_hieu"]', maxSteps: 8 }
    kichBan = () => ({ status: 503, body: { error: { message: 'high demand' } }, headers: { 'retry-after': '0.01' } })
    await chayMotJob(sp, job, 'THU', 'cron')
    const cho = jobGhi.nextRunAt.getTime() - Date.now()
    kiem('lỗi tạm thời → hẹn lại ~15 phút (không đợi tới 7:00 mai)', cho > 14 * 60_000 && cho <= 15 * 60_000, cho)
    kiem('ghi rõ "tự thử lại lúc … (lần 1/6)"', /^Tạm thời — tự thử lại lúc .+\(lần 1\/6\)/.test(runs.at(-1).errorMessage), runs.at(-1).errorMessage)
    for (let i = 2; i <= 6; i++) await chayMotJob(sp, job, 'THU', 'cron')
    kiem('lần thứ 6 vẫn hẹn lại', /\(lần 6\/6\)/.test(runs.at(-1).errorMessage), runs.at(-1).errorMessage)
    await chayMotJob(sp, job, 'THU', 'cron')
    const theoLich = jobGhi.nextRunAt.getTime() - Date.now()
    kiem('quá 6 lần liên tiếp → thôi, quay về lịch thường', theoLich > 15 * 60_000 && !/^Tạm thời/.test(runs.at(-1).errorMessage), { theoLich, m: runs.at(-1).errorMessage })

    runs.length = 0
    daGoi.length = 0
    kichBan = () => (daGoi.length === 1 ? goiTool('mkt_cap_nhat_ho_so_thuong_hieu', { thuongHieu: 'b1', notes: 'x' }) : { status: 503, body: { error: { message: 'high demand' } }, headers: { 'retry-after': '0.01' } })
    await chayMotJob(sp, job, 'THU', 'cron')
    kiem('đã GHI một phần rồi mới hỏng → KHÔNG tự chạy lại (tránh soạn trùng)', !/^Tạm thời/.test(runs.at(-1).errorMessage) && /ĐÃ làm một phần/.test(runs.at(-1).errorMessage) && jobGhi.nextRunAt.getTime() - Date.now() > 15 * 60_000, runs.at(-1).errorMessage)
    kiem('…và lượt đó lưu lại công cụ đã gọi', JSON.parse(runs.at(-1).toolCalls).some((t: any) => t.name === 'mkt_cap_nhat_ho_so_thuong_hieu' && t.ok), runs.at(-1).toolCalls)

    runs.length = 0
    daGoi.length = 0
    kichBan = () => ({ status: 503, body: { error: { message: 'high demand' } }, headers: { 'retry-after': '0.01' } })
    await chayMotJob(sp, job, 'THU', 'manual')
    kiem('bấm "Chạy ngay" (manual) → không tự hẹn lại, người bấm tự quyết', !/^Tạm thời — tự thử lại/.test(runs.at(-1).errorMessage) && /TẠM THỜI/.test(runs.at(-1).errorMessage), runs.at(-1).errorMessage)

    runs.length = 0
    daGoi.length = 0; goiDS.length = 0
    sp.storeSettings.findFirst = async () => ({ geminiApiKey: 'KCRON2', deepseekApiKey: 'sk-thu-cron' })
    kichBan = (m) => (m === 'gemini-2.5-flash' ? { status: 404, body: {} } : { status: 429, body: q429(NGAY) })
    kichBanDS = () => dsTraLoi('Đã soạn 3 bài')
    await chayMotJob(sp, job, 'THU', 'cron')
    kiem('cron: cửa hàng có key DeepSeek ⇒ lượt chạy XONG (ok), tóm tắt ghi "chạy bằng DeepSeek"', runs.at(-1).status === 'ok' && /Chạy bằng DeepSeek dự phòng/.test(runs.at(-1).summary || '') && goiDS[0]?.headers?.Authorization === 'Bearer sk-thu-cron', runs.at(-1))

    console.log(`\n━━ KẾT QUẢ: ${dat} đạt / ${truot} trượt ━━`)
    process.exit(truot ? 1 : 0)
}
main().catch(e => { console.error(e); process.exit(1) })
