// ═══════════════════════════════════════════════════════════════════════════════
//  FACEBOOK PILOT — API cho giao diện kengi.vn/pilot-facebook/ (02/11/2026)
//
//  Trang Facebook Pilot của chủ shop (route FE src/app/(dashboard)/pilot-facebook, đăng nhập JWT kengi.vn)
//  gọi các đường này. Nghiệp vụ ở lib/facebookPilot.ts; ở đây chỉ xác thực + đổi lỗi thành HTTP — cùng
//  hợp đồng với routes/shopeePilot.ts: GET /state → object trạng thái, POST /:action → { result } | { error }.
//
//  Nối fanpage (dán page token) KHÔNG đi đường này: trang gọi thẳng /api/fanpage/connect-page-token có sẵn.
//  Tiện ích theo cửa hàng: chỉ cửa hàng được quản trị bật `facebook_pilot` (lib/tienIchCuaHang) mới đọc / ghi
//  được — chưa bật ⇒ 403 { ma: 'chua_bat_tien_ich' }, đọc registry hỏng ⇒ 503 (vẫn chặn, nói thật).
// ═══════════════════════════════════════════════════════════════════════════════

import { Router, Response, NextFunction } from 'express'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { registryPrisma } from '../lib/prisma'
import { ToolError } from '../lib/mcpTypes'
import { lyDoChanPilot, TIEN_ICH_FACEBOOK_PILOT } from '../lib/tienIchCuaHang'
import {
    khoSqlFb, xayTrangThaiFb, chayChuKyFb, thucThiFb, taoKeHoachBai, taoKeHoachTraLoi, taoKeHoachAn, huyKeHoachFb,
    docBinhLuan, kiemKetNoiFb, luuCauHinhFb, timHangFb, xemTruocBai, HUONG_DAN_FB_PILOT, type NgCanhFb,
} from '../lib/facebookPilot'

const router = Router()
const QUAN_LY = ['admin', 'manager', 'owner', 'superadmin']

function ngCanh(req: AuthRequest): NgCanhFb {
    return { prisma: req.storePrisma as any, kho: khoSqlFb(req.storePrisma as any), nguoi: (req.user as any)?.email || req.user?.userId || null }
}

/** Thao tác ghi (lập kế hoạch, thực thi, chu kỳ, đổi cấu hình): khoá phải có quyền ghi và người phải là quản lý. */
function lyDoKhongGhi(req: AuthRequest): string | null {
    const scopes = (req as any).apiKeyScopes
    if (scopes !== undefined && !/admin|write|\*/i.test(String(scopes))) return 'API key chỉ có quyền đọc — Facebook Pilot cần khoá read,write.'
    if (!QUAN_LY.includes(String(req.user?.role || ''))) return 'Chỉ quản lý / chủ cửa hàng được thao tác Facebook Pilot.'
    return null
}

function traLoi(res: Response, e: any, viec: string) {
    if (e instanceof ToolError) { res.status(400).json({ error: e.message }); return }
    // Lỗi Graph (có mã) là lỗi của Facebook — đưa nguyên văn cho người vận hành, không giấu thành "lỗi máy chủ"
    if (e?.code !== undefined && e?.fbtraceId !== undefined) { res.status(502).json({ error: `Facebook: ${e.message}`, code: e.code }); return }
    console.error(`[FacebookPilot] ${viec} lỗi:`, e?.message || e)
    res.status(500).json({ error: `Lỗi máy chủ khi ${viec}: ${String(e?.message || e).slice(0, 300)}` })
}

/** Cửa hàng phải được quản trị bật tiện ích Facebook Pilot — chặn cả đọc lẫn ghi. */
async function chanChuaBat(req: AuthRequest, res: Response, next: NextFunction) {
    const lyDo = await lyDoChanPilot(req.user?.storeCode, TIEN_ICH_FACEBOOK_PILOT)
    if (!lyDo) { next(); return }
    res.status(lyDo.ma === 'chua_bat_tien_ich' ? 403 : 503).json({ error: lyDo.loi, ma: lyDo.ma })
}

router.get('/state', authMiddleware, chanChuaBat, async (req: AuthRequest, res: Response) => {
    if (!req.storePrisma) { res.status(401).json({ error: 'Chưa xác thực cửa hàng' }); return }
    try { res.json(await xayTrangThaiFb(ngCanh(req))) } catch (e) { traLoi(res, e, 'đọc trạng thái') }
})

router.get('/guide', authMiddleware, chanChuaBat, (_req: AuthRequest, res: Response) => {
    res.json({ markdown: HUONG_DAN_FB_PILOT })
})

type Viec = (ctx: NgCanhFb, body: any) => Promise<any>
const VIEC: Record<string, { ghi: boolean; chay: Viec }> = {
    cycle: { ghi: true, chay: ctx => chayChuKyFb(ctx) },
    execute: { ghi: true, chay: (ctx, b) => thucThiFb(ctx, String(b?.planId || '')) },
    post: {
        ghi: true,
        chay: (ctx, b) => taoKeHoachBai(ctx, {
            sku: String(b?.sku || ''), message: typeof b?.message === 'string' ? b.message : undefined,
            scheduledAt: b?.scheduledAt ?? null, publishNow: b?.publishNow === true, idempotencyKey: b?.idempotencyKey,
        }),
    },
    reply: {
        ghi: true,
        chay: (ctx, b) => taoKeHoachTraLoi(ctx, {
            commentId: String(b?.commentId || ''), message: String(b?.message || ''), postId: b?.postId, commentMsg: b?.commentMsg,
            fromName: b?.fromName, productId: b?.productId, sku: b?.sku, price: b?.price, idempotencyKey: b?.idempotencyKey,
        }),
    },
    hide: {
        ghi: true,
        chay: (ctx, b) => taoKeHoachAn(ctx, {
            commentId: String(b?.commentId || ''), postId: b?.postId, commentMsg: b?.commentMsg, fromName: b?.fromName,
            reason: b?.reason, idempotencyKey: b?.idempotencyKey,
        }),
    },
    cancel: { ghi: true, chay: (ctx, b) => huyKeHoachFb(ctx, String(b?.planId || '')) },
    config: { ghi: true, chay: (ctx, b) => luuCauHinhFb(ctx, b) },
    connection: { ghi: false, chay: ctx => kiemKetNoiFb(ctx) },
    comments: { ghi: false, chay: (ctx, b) => docBinhLuan(ctx, { soBai: b?.posts }) },
    'product-search': { ghi: false, chay: (ctx, b) => timHangFb(ctx, { keyword: String(b?.keyword || '') }) },
    preview: { ghi: false, chay: (ctx, b) => xemTruocBai(ctx, { sku: String(b?.sku || '') }) },
}

router.post('/:action', authMiddleware, chanChuaBat, async (req: AuthRequest, res: Response) => {
    if (!req.storePrisma) { res.status(401).json({ error: 'Chưa xác thực cửa hàng' }); return }
    const viec = VIEC[String(req.params.action)]
    if (!viec) { res.status(404).json({ error: `Không có thao tác "${req.params.action}"` }); return }
    if (viec.ghi) {
        const lyDo = lyDoKhongGhi(req)
        if (lyDo) { res.status(403).json({ error: lyDo }); return }
    }
    try {
        const result = await viec.chay(ngCanh(req), req.body || {})
        /* Bật lịch ⇒ bật cờ registry hasAiJobs để cron (aiAgentCron) quét cửa hàng này — cron chỉ chạm store có cờ. */
        if (req.params.action === 'config' && result?.schedule?.enabled) {
            const schema = req.user?.branchSchema || req.user?.storeSchema
            if (schema) await (registryPrisma as any).store.updateMany({ where: { schema }, data: { hasAiJobs: true } }).catch(() => { })
        }
        res.json({ result })
    } catch (e) { traLoi(res, e, String(req.params.action)) }
})

export default router
