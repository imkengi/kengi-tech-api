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
;(globalThis as any).fetch = async (url: string, opt: any) => {
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

    console.log(`\n━━ KẾT QUẢ: ${dat} đạt / ${truot} trượt ━━`)
    process.exit(truot ? 1 : 0)
}
main().catch(e => { console.error(e); process.exit(1) })
