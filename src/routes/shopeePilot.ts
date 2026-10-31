// ═══════════════════════════════════════════════════════════════════════════════
//  SHOPEE PILOT — API cho giao diện /shopee-pilot/ (31/10/2026)
//
//  Giao diện Shopee Pilot của chủ shop (public/shopee-pilot) gọi các đường này. Toàn bộ
//  nghiệp vụ ở lib/shopeePilot.ts; ở đây chỉ xác thực + đổi lỗi thành HTTP.
//
//  Xác thực: authMiddleware (X-API-Key + x-store-code, hoặc JWT đăng nhập). Khoá chỉ-đọc
//  đã bị authMiddleware chặn mọi POST; ở đây chặn thêm theo vai trò cho thao tác ghi.
//  Hợp đồng trả về giữ đúng như backend cũ của Pilot: GET /state → object trạng thái,
//  POST /:action → { result } hoặc { error } kèm mã lỗi.
// ═══════════════════════════════════════════════════════════════════════════════

import { Router, Response } from 'express'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { ToolError } from '../lib/mcpTypes'
import {
    khoSql, xayTrangThai, chayChuKy, thucThi, taoKeHoachGia, taoKeHoachDang, taoKeHoachKhuyenMai,
    tuyChonDang, thuocTinhNganh, kiemKetNoi, luuCauHinh, HUONG_DAN_PILOT, type NgCanh,
} from '../lib/shopeePilot'

const router = Router()
const QUAN_LY = ['admin', 'manager', 'owner', 'superadmin']

function ngCanh(req: AuthRequest): NgCanh {
    return { prisma: req.storePrisma as any, kho: khoSql(req.storePrisma as any), nguoi: (req.user as any)?.email || req.user?.userId || null }
}

/** Thao tác ghi (lập kế hoạch, thực thi, chu kỳ, đổi cấu hình): khoá phải có quyền ghi và người phải là quản lý. */
function lyDoKhongGhi(req: AuthRequest): string | null {
    const scopes = (req as any).apiKeyScopes
    if (scopes !== undefined && !/admin|write|\*/i.test(String(scopes))) return 'API key chỉ có quyền đọc — Shopee Pilot cần khoá read,write.'
    if (!QUAN_LY.includes(String(req.user?.role || ''))) return 'Chỉ quản lý / chủ cửa hàng được thao tác Shopee Pilot.'
    return null
}

function traLoi(res: Response, e: any, viec: string) {
    if (e instanceof ToolError) { res.status(400).json({ error: e.message }); return }
    console.error(`[ShopeePilot] ${viec} lỗi:`, e?.message || e)
    res.status(500).json({ error: `Lỗi máy chủ khi ${viec}: ${String(e?.message || e).slice(0, 300)}` })
}

router.get('/state', authMiddleware, async (req: AuthRequest, res: Response) => {
    if (!req.storePrisma) { res.status(401).json({ error: 'Chưa xác thực cửa hàng' }); return }
    try { res.json(await xayTrangThai(ngCanh(req))) } catch (e) { traLoi(res, e, 'đọc trạng thái') }
})

router.get('/guide', authMiddleware, (_req: AuthRequest, res: Response) => {
    res.json({ markdown: HUONG_DAN_PILOT })
})

type Viec = (ctx: NgCanh, body: any) => Promise<any>
const VIEC: Record<string, { ghi: boolean; chay: Viec }> = {
    cycle: { ghi: true, chay: ctx => chayChuKy(ctx) },
    execute: { ghi: true, chay: (ctx, b) => thucThi(ctx, String(b?.planId || '')) },
    price: { ghi: true, chay: (ctx, b) => taoKeHoachGia(ctx, { sku: String(b?.sku || ''), price: Number(b?.price), idempotencyKey: b?.idempotencyKey }) },
    listing: {
        ghi: true,
        chay: (ctx, b) => taoKeHoachDang(ctx, {
            sku: String(b?.sku || ''), title: b?.title, description: b?.description,
            categoryId: Number(b?.categoryId), weightGram: Number(b?.weightGram),
            attributes: b?.attributes, brandId: b?.brandId, brandName: b?.brandName, hidden: b?.hidden === true,
            idempotencyKey: b?.idempotencyKey,
        }),
    },
    campaign: {
        ghi: true,
        chay: (ctx, b) => taoKeHoachKhuyenMai(ctx, {
            name: b?.name, skus: Array.isArray(b?.skus) ? b.skus : [], discountRate: Number(b?.discountRate),
            startTime: Number(b?.startTime), endTime: Number(b?.endTime), purchaseLimit: Number(b?.purchaseLimit), idempotencyKey: b?.idempotencyKey,
        }),
    },
    config: { ghi: true, chay: (ctx, b) => luuCauHinh(ctx, b) },
    connection: { ghi: false, chay: ctx => kiemKetNoi(ctx) },
    'listing-options': { ghi: false, chay: (ctx, b) => tuyChonDang(ctx, { sku: String(b?.sku || ''), tuKhoa: b?.keyword }) },
    'listing-attributes': { ghi: false, chay: (ctx, b) => thuocTinhNganh(ctx, { categoryId: Number(b?.categoryId) }) },
}

router.post('/:action', authMiddleware, async (req: AuthRequest, res: Response) => {
    if (!req.storePrisma) { res.status(401).json({ error: 'Chưa xác thực cửa hàng' }); return }
    const viec = VIEC[String(req.params.action)]
    if (!viec) { res.status(404).json({ error: `Không có thao tác "${req.params.action}"` }); return }
    if (viec.ghi) {
        const lyDo = lyDoKhongGhi(req)
        if (lyDo) { res.status(403).json({ error: lyDo }); return }
    }
    try { res.json({ result: await viec.chay(ngCanh(req), req.body || {}) }) } catch (e) { traLoi(res, e, String(req.params.action)) }
})

export default router
