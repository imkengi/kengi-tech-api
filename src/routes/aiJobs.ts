// ═══════════════════════════════════════════════════════════════════════════════
//  TRỢ LÝ AI TỰ ĐỘNG  (/api/ai-jobs/*)
//  Chủ shop đặt tác vụ bằng tiếng Việt + lịch chạy; cron đánh thức agent làm.
// ═══════════════════════════════════════════════════════════════════════════════

import { Router, Response } from 'express'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { requireRole } from '../middleware/roleMiddleware'
import { registryPrisma } from '../lib/prisma'
import { TOOLS } from './mcp'
import { TOOL_NHAY_CAM } from '../services/aiAgentRunner'
import { tinhLanChayKe, moTaLich } from '../services/aiAgentSchedule'
import { chayMotJob } from '../cron/aiAgentCron'

const router = Router()

const QUAN_LY = ['admin', 'manager', 'owner', 'superadmin'] as const

/** Bật cờ registry để aiAgentCron chỉ chạm store có job (tránh quét toàn bộ). */
function batCoRegistry(schema?: string) {
    if (!schema) return
    ;(registryPrisma as any).store.updateMany({ where: { schema }, data: { hasAiJobs: true } }).catch(() => { })
}

function doiRa(job: any) {
    let allowedTools: string[] = []
    try { allowedTools = JSON.parse(job.allowedTools || '[]') } catch { /* giữ rỗng */ }
    return { ...job, allowedTools, moTaLich: moTaLich(job) }
}

/** Kiểm tra allowedTools người dùng gửi: tên có thật, và tool ghi phải có allowWrite. */
function kiemTraTool(names: any, allowWrite: boolean): { ok: true; list: string[] } | { ok: false; loi: string } {
    if (names === undefined) return { ok: true, list: [] }
    if (!Array.isArray(names)) return { ok: false, loi: 'allowedTools phải là mảng tên tool' }
    const list = names.map(String).filter(Boolean)
    const khongCo = list.filter(n => !TOOLS.some(t => t.name === n))
    if (khongCo.length) return { ok: false, loi: `Tool không tồn tại: ${khongCo.join(', ')}` }
    if (!allowWrite) {
        const canGhi = list.filter(n => TOOLS.find(t => t.name === n)?.write)
        if (canGhi.length) {
            return { ok: false, loi: `Các tool này ghi dữ liệu nên phải bật allowWrite: ${canGhi.join(', ')}` }
        }
    }
    return { ok: true, list }
}

// ─── GET /api/ai-jobs/tools — bảng chọn cho FE ───────────────────────────────
router.get('/tools', authMiddleware, async (_req: AuthRequest, res: Response) => {
    res.json({
        success: true,
        data: TOOLS.map(t => ({
            name: t.name,
            moTa: t.description,
            ghiDuLieu: !!t.write,
            nhayCam: TOOL_NHAY_CAM.has(t.name),
            nhom: t.name.startsWith('fanpage_') ? 'fanpage'
                : t.name.startsWith('marketing_') ? 'marketing (lên content)'
                    : 'bán lẻ',
        })),
    })
})

// ─── GET /api/ai-jobs ────────────────────────────────────────────────────────
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const jobs = await req.storePrisma!.aiAgentJob.findMany({
            orderBy: { createdAt: 'desc' },
            include: { runs: { orderBy: { startedAt: 'desc' }, take: 1 } },
        })
        res.json({ success: true, data: jobs.map(doiRa) })
    } catch (e: any) {
        if (/does not exist/i.test(e?.message || '')) {
            return res.json({ success: true, data: [], canhBao: 'Bảng tác vụ AI chưa được tạo — chạy /admin/migrate.' })
        }
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ─── POST /api/ai-jobs ───────────────────────────────────────────────────────
router.post('/', authMiddleware, requireRole(...QUAN_LY), async (req: AuthRequest, res: Response) => {
    try {
        const b = req.body || {}
        const name = String(b.name || '').trim()
        const prompt = String(b.prompt || '').trim()
        if (!name) return res.status(400).json({ success: false, error: 'Thiếu tên tác vụ' })
        if (prompt.length < 10) return res.status(400).json({ success: false, error: 'Chỉ thị quá ngắn — mô tả rõ việc cần làm để agent hiểu' })

        const allowWrite = !!b.allowWrite
        const kt = kiemTraTool(b.allowedTools, allowWrite)
        if (!kt.ok) return res.status(400).json({ success: false, error: kt.loi })

        // Tool nhạy cảm (đăng bài, trả lời khách, lên đơn, thu nợ) chỉ chạy khi
        // được gọi ĐÍCH DANH — chặn ngay ở API cho người dùng biết, thay vì để
        // runner lặng lẽ loại rồi agent báo "không có công cụ".
        const scheduleKind = b.scheduleKind === 'interval' ? 'interval' : 'daily'
        const lich = {
            scheduleKind,
            atHour: Math.min(Math.max(Number(b.atHour ?? 8), 0), 23),
            atMinute: Math.min(Math.max(Number(b.atMinute ?? 0), 0), 59),
            intervalMinutes: Math.max(Number(b.intervalMinutes ?? 60), 5),
        }

        const job = await req.storePrisma!.aiAgentJob.create({
            data: {
                name, prompt, ...lich,
                enabled: b.enabled !== false,
                allowWrite,
                allowedTools: JSON.stringify(kt.list),
                maxSteps: Math.min(Math.max(Number(b.maxSteps ?? 8), 1), 20),
                nextRunAt: tinhLanChayKe(lich),
                createdBy: req.user?.userId,
            },
        })
        batCoRegistry(req.user?.storeSchema)
        res.json({ success: true, data: doiRa(job) })
    } catch (e: any) {
        if (/does not exist/i.test(e?.message || '')) {
            return res.status(503).json({ success: false, error: 'Bảng tác vụ AI chưa được tạo — chạy /admin/migrate trước.' })
        }
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ─── PATCH /api/ai-jobs/:id ──────────────────────────────────────────────────
router.patch('/:id', authMiddleware, requireRole(...QUAN_LY), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const cu = await prisma.aiAgentJob.findUnique({ where: { id: String(req.params.id) } })
        if (!cu) return res.status(404).json({ success: false, error: 'Không tìm thấy tác vụ' })

        const b = req.body || {}
        const data: any = {}
        if (typeof b.name === 'string' && b.name.trim()) data.name = b.name.trim()
        if (typeof b.prompt === 'string' && b.prompt.trim().length >= 10) data.prompt = b.prompt.trim()
        if (typeof b.enabled === 'boolean') data.enabled = b.enabled
        if (typeof b.allowWrite === 'boolean') data.allowWrite = b.allowWrite
        if (b.maxSteps !== undefined) data.maxSteps = Math.min(Math.max(Number(b.maxSteps), 1), 20)

        const allowWrite = data.allowWrite ?? cu.allowWrite
        if (b.allowedTools !== undefined) {
            const kt = kiemTraTool(b.allowedTools, allowWrite)
            if (!kt.ok) return res.status(400).json({ success: false, error: kt.loi })
            data.allowedTools = JSON.stringify(kt.list)
        } else if (data.allowWrite === false) {
            // Tắt quyền ghi mà giữ nguyên allowlist cũ chứa tool ghi → mâu thuẫn
            let cuList: string[] = []
            try { cuList = JSON.parse(cu.allowedTools || '[]') } catch { /* rỗng */ }
            const conGhi = cuList.filter(n => TOOLS.find(t => t.name === n)?.write)
            if (conGhi.length) {
                return res.status(400).json({
                    success: false,
                    error: `Tắt allowWrite thì phải bỏ các tool ghi khỏi danh sách: ${conGhi.join(', ')}`,
                })
            }
        }

        // Đổi lịch → tính lại mốc kế tiếp
        const doiLich = ['scheduleKind', 'atHour', 'atMinute', 'intervalMinutes'].some(k => b[k] !== undefined)
        if (doiLich) {
            const lich = {
                scheduleKind: b.scheduleKind === 'interval' ? 'interval' : (b.scheduleKind === 'daily' ? 'daily' : cu.scheduleKind),
                atHour: b.atHour !== undefined ? Math.min(Math.max(Number(b.atHour), 0), 23) : cu.atHour,
                atMinute: b.atMinute !== undefined ? Math.min(Math.max(Number(b.atMinute), 0), 59) : cu.atMinute,
                intervalMinutes: b.intervalMinutes !== undefined ? Math.max(Number(b.intervalMinutes), 5) : cu.intervalMinutes,
            }
            Object.assign(data, lich, { nextRunAt: tinhLanChayKe(lich) })
        }

        if (!Object.keys(data).length) return res.status(400).json({ success: false, error: 'Không có trường nào để cập nhật' })
        const job = await prisma.aiAgentJob.update({ where: { id: cu.id }, data })
        batCoRegistry(req.user?.storeSchema)
        res.json({ success: true, data: doiRa(job) })
    } catch { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// ─── DELETE /api/ai-jobs/:id ─────────────────────────────────────────────────
router.delete('/:id', authMiddleware, requireRole(...QUAN_LY), async (req: AuthRequest, res: Response) => {
    try {
        await req.storePrisma!.aiAgentJob.delete({ where: { id: String(req.params.id) } })
        res.json({ success: true })
    } catch { res.status(404).json({ success: false, error: 'Không tìm thấy tác vụ' }) }
})

// ─── POST /api/ai-jobs/:id/run — chạy thử NGAY (không đợi lịch) ──────────────
router.post('/:id/run', authMiddleware, requireRole(...QUAN_LY), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const job = await prisma.aiAgentJob.findUnique({ where: { id: String(req.params.id) } })
        if (!job) return res.status(404).json({ success: false, error: 'Không tìm thấy tác vụ' })

        const r = await chayMotJob(prisma, job, String(req.user?.storeCode || ''), 'manual')
        const run = await prisma.aiAgentRun.findUnique({ where: { id: r.runId } })
        res.json({
            success: true,
            data: { ...run, toolCalls: JSON.parse(run?.toolCalls || '[]') },
        })
    } catch (e: any) {
        res.status(500).json({ success: false, error: e?.message || 'Internal server error' })
    }
})

// ─── GET /api/ai-jobs/:id/runs — nhật ký chạy ────────────────────────────────
router.get('/:id/runs', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const runs = await req.storePrisma!.aiAgentRun.findMany({
            where: { jobId: String(req.params.id) },
            orderBy: { startedAt: 'desc' },
            take: Math.min(Number(req.query.limit) || 20, 100),
        })
        res.json({
            success: true,
            data: runs.map((r: any) => {
                let tc: any[] = []
                try { tc = JSON.parse(r.toolCalls || '[]') } catch { /* rỗng */ }
                return { ...r, toolCalls: tc }
            }),
        })
    } catch { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

export default router
