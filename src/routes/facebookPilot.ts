// ═══════════════════════════════════════════════════════════════════════════════
//  FACEBOOK PILOT — API cho giao diện kengi.vn/pilot-facebook/ (02/11/2026)
//
//  Trang Facebook Pilot của chủ shop (route FE src/app/(dashboard)/pilot-facebook, đăng nhập JWT kengi.vn)
//  gọi các đường này. Nghiệp vụ ở lib/facebookPilot.ts; ở đây chỉ xác thực + đổi lỗi thành HTTP — cùng
//  hợp đồng với routes/shopeePilot.ts: GET /state → object trạng thái, POST /:action → { result } | { error }.
//
//  Nối fanpage (dán page token) KHÔNG đi đường này: trang gọi thẳng /api/fanpage/connect-page-token có sẵn.
//  ADS PILOT (05/11/2026): GET /ads/state, GET /ads/guide, POST /ads/:action — quảng cáo trong Facebook Pilot,
//  nghiệp vụ ở lib/facebookAdsPilot.ts, cùng tiện ích facebook_pilot, cùng luật quyền ghi.
//  PHÂN TÍCH SÂU (05/11/2026): GET /ads/drill — chỉ đọc Insights, nghiệp vụ ở lib/facebookAdsDrill.ts.
//  Tiện ích theo cửa hàng: chỉ cửa hàng được quản trị bật `facebook_pilot` (lib/tienIchCuaHang) mới đọc / ghi
//  được — chưa bật ⇒ 403 { ma: 'chua_bat_tien_ich' }, đọc registry hỏng ⇒ 503 (vẫn chặn, nói thật).
// ═══════════════════════════════════════════════════════════════════════════════

import { Router, Response, NextFunction } from 'express'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { registryPrisma } from '../lib/prisma'
import { ToolError } from '../lib/mcpTypes'
import { lyDoChanPilot, TIEN_ICH_FACEBOOK_PILOT } from '../lib/tienIchCuaHang'
import { chanXemPilot } from '../lib/quyenXemPilot'
import {
    khoSqlFb, xayTrangThaiFb, chayChuKyFb, thucThiFb, taoKeHoachBai, taoKeHoachTraLoi, taoKeHoachAn, taoKeHoachBoAn, huyKeHoachFb,
    xacNhanDaKiemFb, dsKeHoachFb, docBinhLuan, kiemKetNoiFb, luuCauHinhFb, timHangFb, xemTruocBai, vietLoiBaiFb, HUONG_DAN_FB_PILOT, type NgCanhFb,
} from '../lib/facebookPilot'
import {
    khoSqlAds, xayTrangThaiAds, chayChuKyAds, thucThiAds, taoKeHoachDay, taoKeHoachDung, taoKeHoachChayLai, taoKeHoachNganSach,
    huyKeHoachAds, noiTokenAds, kiemKetNoiAds, luuCauHinhAds, HUONG_DAN_ADS_PILOT, type NgCanhAds,
} from '../lib/facebookAdsPilot'
import { docDrillAds } from '../lib/facebookAdsDrill'

const router = Router()
const QUAN_LY = ['admin', 'manager', 'owner', 'superadmin']

function ngCanh(req: AuthRequest): NgCanhFb {
    return { prisma: req.storePrisma as any, kho: khoSqlFb(req.storePrisma as any), nguoi: (req.user as any)?.email || req.user?.userId || null }
}

function ngCanhAds(req: AuthRequest): NgCanhAds {
    const prisma = req.storePrisma as any
    return { prisma, kho: khoSqlAds(prisma), khoFb: khoSqlFb(prisma), nguoi: (req.user as any)?.email || req.user?.userId || null }
}

/** Khoá chống trùng từ trình duyệt — 'cycle:' là của máy (luật "người bật lại thì máy không tắt lại" dựa vào nó) ⇒ không cho mượn.
 *  09/11/2026: Facebook Pilot cũng dựa vào nó — nháp 'cycle:' bị chu kỳ tự huỷ khi quá hạn, người huỷ thì nhớ 14 ngày — nên
 *  lên bài / trả lời / ẩn từ web cũng phải qua đây: nháp người lập mà mang khoá máy là bị tự huỷ oan. */
const khoaWeb = (v: any): string | undefined => (v ? (String(v).startsWith('cycle:') ? `web:${v}` : String(v)).slice(0, 200) : undefined)

/** Bật lịch ⇒ bật cờ registry hasAiJobs để cron (aiAgentCron) quét cửa hàng này — cron chỉ chạm store có cờ. */
async function batCoLich(req: AuthRequest) {
    const schema = req.user?.branchSchema || req.user?.storeSchema
    if (schema) await (registryPrisma as any).store.updateMany({ where: { schema }, data: { hasAiJobs: true } }).catch(() => { })
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

/** TT-15 (10/11/2026) — quyền XEM (lib/quyenXemPilot): Facebook Pilot (bài, bình luận, giá bán công khai) cần quyền xem
 *  «SP trên sàn»; Ads Pilot có chi tiêu, giá vốn, lãi ⇒ cần thêm «Giá vốn» hoặc «Lợi nhuận». Trước đây chỉ soát đăng nhập. */
const chanXemFb = chanXemPilot('Facebook Pilot', false)
const chanXemAds = chanXemPilot('Ads Pilot', true)

router.get('/state', authMiddleware, chanChuaBat, chanXemFb, async (req: AuthRequest, res: Response) => {
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
            scheduledAt: b?.scheduledAt ?? null, publishNow: b?.publishNow === true, idempotencyKey: khoaWeb(b?.idempotencyKey),
            aiDraft: b?.aiDraft === true,
        }),
    },
    // FB-14 (10/11/2026): AI viết lại đoạn giới thiệu của bài, có rào sự thật — CHỈ soạn chữ cho form, không ghi Facebook.
    // 'ghi: true' vì tốn hạn mức AI của cửa hàng ⇒ chỉ quản lý / khoá có quyền ghi.
    'ai-draft': { ghi: true, chay: (ctx, b) => vietLoiBaiFb(ctx, { sku: String(b?.sku || '') }) },
    reply: {
        ghi: true,
        chay: (ctx, b) => taoKeHoachTraLoi(ctx, {
            commentId: String(b?.commentId || ''), message: String(b?.message || ''), postId: b?.postId, commentMsg: b?.commentMsg,
            fromName: b?.fromName, productId: b?.productId, sku: b?.sku, price: b?.price, idempotencyKey: khoaWeb(b?.idempotencyKey),
            replyTo: typeof b?.replyTo === 'string' ? b.replyTo : null,
        }),
    },
    hide: {
        ghi: true,
        chay: (ctx, b) => taoKeHoachAn(ctx, {
            commentId: String(b?.commentId || ''), postId: b?.postId, commentMsg: b?.commentMsg, fromName: b?.fromName,
            reason: b?.reason, idempotencyKey: khoaWeb(b?.idempotencyKey),
        }),
    },
    // FB-16 (10/11/2026): bỏ ẩn bình luận — cùng đường kế hoạch → thực thi như 'hide'
    unhide: {
        ghi: true,
        chay: (ctx, b) => taoKeHoachBoAn(ctx, {
            commentId: String(b?.commentId || ''), postId: b?.postId, commentMsg: b?.commentMsg, fromName: b?.fromName,
            reason: b?.reason, idempotencyKey: khoaWeb(b?.idempotencyKey),
        }),
    },
    cancel: { ghi: true, chay: (ctx, b) => huyKeHoachFb(ctx, String(b?.planId || '')) },
    // FB-16: người đã mở fanpage kiểm kế hoạch "Chưa rõ kết quả" — outcome 'done' (Facebook CÓ) | 'not_done' (KHÔNG có). Không gọi Facebook.
    resolve: { ghi: true, chay: (ctx, b) => xacNhanDaKiemFb(ctx, { planId: String(b?.planId || ''), outcome: String(b?.outcome || '') }) },
    config: { ghi: true, chay: (ctx, b) => luuCauHinhFb(ctx, b) },
    connection: { ghi: false, chay: ctx => kiemKetNoiFb(ctx) },
    comments: { ghi: false, chay: (ctx, b) => docBinhLuan(ctx, { soBai: b?.posts }) },
    'product-search': { ghi: false, chay: (ctx, b) => timHangFb(ctx, { keyword: String(b?.keyword || '') }) },
    preview: { ghi: false, chay: (ctx, b) => xemTruocBai(ctx, { sku: String(b?.sku || '') }) },
    // FB-16: kế hoạch lọc theo trạng thái / loại + lật trang (before = next của trang trước / plansNext của /state)
    plans: { ghi: false, chay: (ctx, b) => dsKeHoachFb(ctx, { status: b?.status, kind: b?.kind, before: b?.before, limit: b?.limit }) },
}

router.post('/:action', authMiddleware, chanChuaBat, chanXemFb, async (req: AuthRequest, res: Response) => {
    if (!req.storePrisma) { res.status(401).json({ error: 'Chưa xác thực cửa hàng' }); return }
    const viec = VIEC[String(req.params.action)]
    if (!viec) { res.status(404).json({ error: `Không có thao tác "${req.params.action}"` }); return }
    if (viec.ghi) {
        const lyDo = lyDoKhongGhi(req)
        if (lyDo) { res.status(403).json({ error: lyDo }); return }
    }
    try {
        const result = await viec.chay(ngCanh(req), req.body || {})
        if (req.params.action === 'config' && result?.schedule?.enabled) await batCoLich(req)
        res.json({ result })
    } catch (e) { traLoi(res, e, String(req.params.action)) }
})

// ─── ADS PILOT ──────────────────────────────────────────────────────────────────

router.get('/ads/state', authMiddleware, chanChuaBat, chanXemAds, async (req: AuthRequest, res: Response) => {
    if (!req.storePrisma) { res.status(401).json({ error: 'Chưa xác thực cửa hàng' }); return }
    try { res.json(await xayTrangThaiAds(ngCanhAds(req))) } catch (e) { traLoi(res, e, 'đọc trạng thái quảng cáo') }
})

/** Phân tích sâu quảng cáo — CHỈ ĐỌC Insights (tài khoản → chiến dịch → nhóm → quảng cáo, chia theo tỉnh / tuổi / giờ…). */
router.get('/ads/drill', authMiddleware, chanChuaBat, chanXemAds, async (req: AuthRequest, res: Response) => {
    if (!req.storePrisma) { res.status(401).json({ error: 'Chưa xác thực cửa hàng' }); return }
    const q = req.query as Record<string, any>
    const mot = (v: any) => (Array.isArray(v) ? v[0] : v)
    try {
        res.json(await docDrillAds(ngCanhAds(req), {
            level: mot(q.level), id: mot(q.id), account: mot(q.account), preset: mot(q.preset), since: mot(q.since), until: mot(q.until),
            compare: mot(q.compare), breakdown: mot(q.breakdown), result: mot(q.result), group: mot(q.group), fresh: mot(q.fresh),
        }))
    } catch (e) { traLoi(res, e, 'đọc phân tích quảng cáo') }
})

router.get('/ads/guide', authMiddleware, chanChuaBat, (_req: AuthRequest, res: Response) => {
    res.json({ markdown: HUONG_DAN_ADS_PILOT })
})

type ViecAds = (ctx: NgCanhAds, body: any) => Promise<any>
const VIEC_ADS: Record<string, { ghi: boolean; chay: ViecAds }> = {
    cycle: { ghi: true, chay: ctx => chayChuKyAds(ctx) },
    execute: { ghi: true, chay: (ctx, b) => thucThiAds(ctx, String(b?.planId || '')) },
    boost: {
        ghi: true,
        chay: (ctx, b) => taoKeHoachDay(ctx, { postId: String(b?.postId || ''), dailyBudget: b?.dailyBudget, days: b?.days, idempotencyKey: khoaWeb(b?.idempotencyKey) }),
    },
    pause: { ghi: true, chay: (ctx, b) => taoKeHoachDung(ctx, { campaignId: String(b?.campaignId || ''), reason: 'thu_cong', idempotencyKey: khoaWeb(b?.idempotencyKey) }) },
    resume: { ghi: true, chay: (ctx, b) => taoKeHoachChayLai(ctx, { campaignId: String(b?.campaignId || ''), idempotencyKey: khoaWeb(b?.idempotencyKey) }) },
    budget: {
        ghi: true,
        chay: (ctx, b) => taoKeHoachNganSach(ctx, { campaignId: String(b?.campaignId || ''), dailyBudget: b?.dailyBudget, idempotencyKey: khoaWeb(b?.idempotencyKey) }),
    },
    cancel: { ghi: true, chay: (ctx, b) => huyKeHoachAds(ctx, String(b?.planId || '')) },
    config: { ghi: true, chay: (ctx, b) => luuCauHinhAds(ctx, b) },
    // token chỉ đi vào, không bao giờ ra: kết quả là tokenAnToan (tên, quyền, hạn) + danh sách tài khoản quảng cáo
    token: { ghi: true, chay: (ctx, b) => noiTokenAds(ctx, { accessToken: String(b?.accessToken || '') }) },
    connection: { ghi: false, chay: ctx => kiemKetNoiAds(ctx) },
}

router.post('/ads/:action', authMiddleware, chanChuaBat, chanXemAds, async (req: AuthRequest, res: Response) => {
    if (!req.storePrisma) { res.status(401).json({ error: 'Chưa xác thực cửa hàng' }); return }
    const viec = VIEC_ADS[String(req.params.action)]
    if (!viec) { res.status(404).json({ error: `Không có thao tác quảng cáo "${req.params.action}"` }); return }
    if (viec.ghi) {
        const lyDo = lyDoKhongGhi(req)
        if (lyDo) { res.status(403).json({ error: lyDo }); return }
    }
    try {
        const result = await viec.chay(ngCanhAds(req), req.body || {})
        if (req.params.action === 'config' && result?.schedule?.enabled) await batCoLich(req)
        res.json({ result })
    } catch (e) { traLoi(res, e, `quảng cáo ${req.params.action}`) }
})

export default router
