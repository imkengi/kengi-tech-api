// ═══════════════════════════════════════════════════════════════════════════════
//  AI AGENT CRON — đánh thức trợ lý theo lịch để nó TỰ làm việc
//
//  Mỗi 5 phút: tìm job tới hạn (nextRunAt <= bây giờ) ở các store CÓ job
//  (cờ registry hasAiJobs — không quét toàn bộ store, tránh cạn kết nối Prisma
//  như bài học của fanpageCron), chạy vòng agent, ghi AiAgentRun.
//
//  AN TOÀN: job mặc định CHỈ ĐỌC. Muốn ghi phải bật allowWrite; riêng tool đẩy
//  ra ngoài (đăng bài, trả lời khách, lên đơn, thu nợ) còn phải gọi đích danh
//  trong allowedTools — xem TOOL_NHAY_CAM ở services/aiAgentRunner.
// ═══════════════════════════════════════════════════════════════════════════════

import { registryPrisma, getStorePrisma } from '../lib/prisma'
import { chayNeuLanhDao } from '../lib/leaderLock'
import { chayAgent } from '../services/aiAgentRunner'
import { tinhLanChayKe, SYSTEM_PROMPT_TU_DONG } from '../services/aiAgentSchedule'
import { ToolCtx } from '../lib/mcpTypes'

const CHU_KY = 5 * 60 * 1000            // quét mỗi 5 phút
const TRAN_JOB_MOI_LUOT = 5             // tối đa 5 job/store mỗi lượt, tránh nghẽn
const GEMINI_KEY_ENV = process.env.GEMINI_API_KEY || ''

let timer: NodeJS.Timeout | null = null
let dangChay = false

/** Lấy key Gemini của store (admin cấu hình) hoặc key chung ở env. */
async function layApiKey(storePrisma: any): Promise<string> {
    try {
        const s = await storePrisma.storeSettings.findFirst({ select: { geminiApiKey: true } })
        if (s?.geminiApiKey) return s.geminiApiKey
    } catch { /* cột chưa migrate → dùng env */ }
    return GEMINI_KEY_ENV
}

/** Chọn 1 user làm "người thực hiện" cho tool ghi (Transaction.createdBy là FK bắt buộc). */
async function layActor(storePrisma: any): Promise<{ id?: string; name?: string; branchId?: string | null }> {
    const u = await storePrisma.user.findFirst({
        where: { role: { in: ['admin', 'owner', 'superadmin'] } },
        orderBy: { createdAt: 'asc' },
        select: { id: true, name: true, branchId: true },
    }).catch(() => null)
    return u ? { id: u.id, name: u.name || 'Trợ lý AI', branchId: u.branchId ?? null } : {}
}

/** Chạy 1 job, ghi lại toàn bộ dấu vết. Không ném lỗi ra ngoài. */
export async function chayMotJob(
    storePrisma: any,
    job: any,
    storeCode: string,
    trigger: 'cron' | 'manual' = 'cron',
): Promise<{ runId: string; status: string }> {
    const run = await storePrisma.aiAgentRun.create({
        data: { jobId: job.id, status: 'running', trigger },
    })

    let status = 'ok'
    let summary: string | null = null
    let errorMessage: string | null = null
    let toolCalls: any[] = []
    let steps = 0
    let chamTran = false

    try {
        const apiKey = await layApiKey(storePrisma)
        if (!apiKey) throw new Error('Chưa cấu hình Gemini API Key (Cài đặt → Trợ lý AI)')

        const actor = await layActor(storePrisma)
        const ctx: ToolCtx = {
            prisma: storePrisma,
            scopes: job.allowWrite ? 'read,write' : 'read',
            storeCode,
            userId: actor.id,
            userName: actor.name || 'Trợ lý AI (tự động)',
            branchId: actor.branchId ?? null,
        }

        let allowed: string[] = []
        try { allowed = JSON.parse(job.allowedTools || '[]') } catch { allowed = [] }

        const kq = await chayAgent({
            apiKey,
            systemPrompt: SYSTEM_PROMPT_TU_DONG,
            ctx,
            message: job.prompt,
            maxSteps: job.maxSteps || 8,
            allowWrite: !!job.allowWrite,
            allowedTools: allowed,
        })
        summary = kq.reply
        toolCalls = kq.toolCalls
        steps = kq.steps
        chamTran = kq.chamTran
    } catch (e: any) {
        status = 'error'
        errorMessage = e?.message || String(e)
        console.error(`[AiAgentCron] job "${job.name}" (${storeCode}) lỗi:`, errorMessage)
    }

    await storePrisma.aiAgentRun.update({
        where: { id: run.id },
        data: {
            finishedAt: new Date(), status, summary, errorMessage,
            toolCalls: JSON.stringify(toolCalls).slice(0, 60_000), steps, chamTran,
        },
    }).catch(() => { })

    // Hẹn lượt kế TỪ BÂY GIỜ (không cộng dồn từ nextRunAt cũ) — server ngủ vài
    // tiếng rồi tỉnh dậy sẽ không bắn bù một loạt lượt đã lỡ.
    await storePrisma.aiAgentJob.update({
        where: { id: job.id },
        data: { lastRunAt: new Date(), nextRunAt: tinhLanChayKe(job, new Date()) },
    }).catch(() => { })

    return { runId: run.id, status }
}

async function quet(): Promise<void> {
    if (dangChay) return          // lượt trước chưa xong (job có thể chạy lâu) → bỏ lượt này
    dangChay = true
    try {
        const stores = await registryPrisma.store.findMany({
            where: { status: 'active', hasAiJobs: true } as any,
        }) as any[]
        for (const store of stores) {
            try {
                const sp = getStorePrisma(store.schema)
                const jobs = await sp.aiAgentJob.findMany({
                    where: { enabled: true, nextRunAt: { lte: new Date() } },
                    orderBy: { nextRunAt: 'asc' },
                    take: TRAN_JOB_MOI_LUOT,
                })
                for (const job of jobs) {
                    console.log(`[AiAgentCron] ▶ ${store.code}/${job.name}`)
                    const r = await chayMotJob(sp, job, store.code, 'cron')
                    console.log(`[AiAgentCron] ✔ ${store.code}/${job.name} → ${r.status}`)
                }
            } catch (e: any) {
                // Store chưa migrate bảng AiAgentJob → bỏ qua êm
                if (!/does not exist|AiAgentJob/i.test(e?.message || '')) {
                    console.error(`[AiAgentCron] store ${store.code}:`, e?.message)
                }
            }
        }
    } catch (e: any) {
        console.error('[AiAgentCron] Fatal:', e?.message)
    } finally {
        dangChay = false
    }
}

export function startAiAgentCron(): void {
    if (timer) return
    console.log(`⏰ AI agent cron started (every ${CHU_KY / 60000} minutes)`)
    // Trễ 90s để không đụng đợt khởi động cùng các cron khác
    // Chỉ một bản chạy mỗi nhịp — job AI có nextRunAt riêng nên chạy trùng trên
    // 2–3 bản là nguy cơ chạy job đúp, ngoài chuyện đốt kết nối (19/08/2026)
    const chay = () => chayNeuLanhDao('ai-agent', CHU_KY - 30_000, quet)
    setTimeout(() => { chay(); timer = setInterval(chay, CHU_KY) }, 90_000)
}

export function stopAiAgentCron(): void {
    if (timer) { clearInterval(timer); timer = null; console.log('⏰ AI agent cron stopped') }
}
