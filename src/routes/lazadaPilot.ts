// ═══════════════════════════════════════════════════════════════════════════════
//  LAZADA PILOT — API cho giao diện kengi.vn/pilot-lazada/ (14/11/2026)
//
//  Trang Lazada Pilot của chủ shop (route FE src/app/(dashboard)/pilot-lazada, đăng nhập JWT kengi.vn) gọi các
//  đường này. Nghiệp vụ ở lib/lazadaPilot.ts; ở đây chỉ xác thực + đổi lỗi thành HTTP — cùng hợp đồng với
//  routes/tiktokPilot.ts: GET /state → object trạng thái, POST /:action → { result } | { error }.
//  Tiện ích theo cửa hàng: chỉ cửa hàng được quản trị bật `lazada_pilot` (lib/tienIchCuaHang) mới đọc / ghi được —
//  chưa bật ⇒ 403 { ma: 'chua_bat_tien_ich' }, đọc registry hỏng ⇒ 503 (vẫn chặn, nói thật).
//  Khác TikTok: kế hoạch giá theo TỪNG SKU — POST /price nhận { itemId, skuId?, sellerSku?, price }.
// ═══════════════════════════════════════════════════════════════════════════════

import { Router, Response, NextFunction } from 'express'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { registryPrisma } from '../lib/prisma'
import { ToolError } from '../lib/mcpTypes'
import { lyDoChanPilot, TIEN_ICH_LAZADA_PILOT } from '../lib/tienIchCuaHang'
import { chanXemPilot } from '../lib/quyenXemPilot'
import {
    khoSqlLazada, xayTrangThaiLazada, chayChuKyLazada, thucThiLazada, taoKeHoachGiaLazada, huyKeHoachLazada,
    kiemKetNoiLazada, luuCauHinhLazada, HUONG_DAN_LAZADA_PILOT, type NgCanhLazada,
} from '../lib/lazadaPilot'

const router = Router()
const QUAN_LY = ['admin', 'manager', 'owner', 'superadmin']

function ngCanh(req: AuthRequest): NgCanhLazada {
    return { prisma: req.storePrisma as any, kho: khoSqlLazada(req.storePrisma as any), nguoi: (req.user as any)?.email || req.user?.userId || null }
}

/** Thao tác ghi (lập kế hoạch, thực thi, chu kỳ, đổi cấu hình): khoá phải có quyền ghi và người phải là quản lý. */
function lyDoKhongGhi(req: AuthRequest): string | null {
    const scopes = (req as any).apiKeyScopes
    if (scopes !== undefined && !/admin|write|\*/i.test(String(scopes))) return 'API key chỉ có quyền đọc — Lazada Pilot cần khoá read,write.'
    if (!QUAN_LY.includes(String(req.user?.role || ''))) return 'Chỉ quản lý / chủ cửa hàng được thao tác Lazada Pilot.'
    return null
}

function traLoi(res: Response, e: any, viec: string) {
    if (e instanceof ToolError) { res.status(400).json({ error: e.message }); return }
    console.error(`[LazadaPilot] ${viec} lỗi:`, e?.message || e)
    res.status(500).json({ error: `Lỗi máy chủ khi ${viec}: ${String(e?.message || e).slice(0, 300)}` })
}

/** Cửa hàng phải được quản trị bật tiện ích Lazada Pilot — chặn cả đọc lẫn ghi. */
async function chanChuaBat(req: AuthRequest, res: Response, next: NextFunction) {
    const lyDo = await lyDoChanPilot(req.user?.storeCode, TIEN_ICH_LAZADA_PILOT)
    if (!lyDo) { next(); return }
    res.status(lyDo.ma === 'chua_bat_tien_ich' ? 403 : 503).json({ error: lyDo.loi, ma: lyDo.ma })
}

/** Trạng thái / kết quả mang giá vốn, lãi, phí từng SKU ⇒ cần quyền xem «SP trên sàn» + «Giá vốn» hoặc «Lợi nhuận». */
const chanXem = chanXemPilot('Lazada Pilot', true)

router.get('/state', authMiddleware, chanChuaBat, chanXem, async (req: AuthRequest, res: Response) => {
    if (!req.storePrisma) { res.status(401).json({ error: 'Chưa xác thực cửa hàng' }); return }
    try { res.json(await xayTrangThaiLazada(ngCanh(req))) } catch (e) { traLoi(res, e, 'đọc trạng thái') }
})

router.get('/guide', authMiddleware, chanChuaBat, (_req: AuthRequest, res: Response) => {
    res.json({ markdown: HUONG_DAN_LAZADA_PILOT })
})

type Viec = (ctx: NgCanhLazada, body: any) => Promise<any>
const VIEC: Record<string, { ghi: boolean; chay: Viec }> = {
    cycle: { ghi: true, chay: ctx => chayChuKyLazada(ctx) },
    execute: { ghi: true, chay: (ctx, b) => thucThiLazada(ctx, String(b?.planId || '')) },
    price: {
        ghi: true,
        chay: (ctx, b) => taoKeHoachGiaLazada(ctx, {
            itemId: b?.itemId ? String(b.itemId) : undefined,
            skuId: b?.skuId ? String(b.skuId) : undefined,
            sellerSku: b?.sellerSku ? String(b.sellerSku) : undefined,
            price: Number(b?.price), idempotencyKey: b?.idempotencyKey,
        }),
    },
    cancel: { ghi: true, chay: (ctx, b) => huyKeHoachLazada(ctx, String(b?.planId || '')) },
    config: { ghi: true, chay: (ctx, b) => luuCauHinhLazada(ctx, b) },
    connection: { ghi: false, chay: ctx => kiemKetNoiLazada(ctx) },
}

router.post('/:action', authMiddleware, chanChuaBat, chanXem, async (req: AuthRequest, res: Response) => {
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
