import { Router, Response } from 'express'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { errMsg } from '../lib/errorResponse'
import { ShopeeService } from '../services/platforms/shopee'

/**
 * FLASH SALE HÀNG LOẠT (Shopee) — /api/flash-sales
 *
 * Nghiệp vụ then chốt: Shopee GIỮ TỒN campaign ngay khi thêm item → KHÔNG tạo
 * hết flash sale lên Shopee một lượt. Người dùng xếp N kế hoạch (plan) vào HÀNG
 * ĐỢI; cron flashSaleScheduler chỉ đẩy plan kế tiếp lên Shopee SAU KHI plan
 * trước kết thúc ("hết flash sale này mới tới flash sale sau").
 *
 * Bảng FlashSalePlan tạo raw SQL per-store (CREATE IF NOT EXISTS) — tránh vòng
 * migration schema-store (xem memory: db push prod là no-op). Trạng thái plan:
 *   queued → active (đã lên Shopee, đang giữ tồn) → ended
 *          ↘ skipped (lỡ khung giờ) / failed (Shopee từ chối 3 lần) / cancelled
 */

const router = Router()

// Vận hành nội bộ: chấp nhận x-admin-key + x-store-code (giống /api/mcp) để
// debug/hỗ trợ; còn lại đi authMiddleware (JWT dashboard / X-API-Key).
router.use(async (req: AuthRequest, res: Response, next) => {
    const adminKey = req.headers['x-admin-key'] as string
    if (adminKey && process.env.ADMIN_KEY && adminKey === process.env.ADMIN_KEY) {
        const code = String(req.headers['x-store-code'] || '').trim()
        if (code) {
            const { registryPrisma, getStorePrisma } = await import('../lib/prisma')
            const store = await registryPrisma.store.findFirst({ where: { code: { equals: code, mode: 'insensitive' } } })
            if (store) {
                req.storePrisma = getStorePrisma(store.schema)
                next()
                return
            }
        }
        res.status(400).json({ success: false, error: 'x-admin-key cần kèm x-store-code hợp lệ' })
        return
    }
    authMiddleware(req, res, next)
})

// ─── Bảng (lazy, memo theo schema) ───────────────────────────────────────────
const tableReady = new Set<string>()
export async function ensureFlashSaleTable(prisma: any): Promise<void> {
    const schema = (prisma as any).__schema || 'default'
    if (tableReady.has(schema)) return
    await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "FlashSalePlan" (
            id TEXT PRIMARY KEY,
            "channelId" TEXT NOT NULL,
            title TEXT,
            "timeslotId" BIGINT NOT NULL,
            "startTime" TIMESTAMPTZ NOT NULL,
            "endTime" TIMESTAMPTZ NOT NULL,
            items JSONB NOT NULL,
            "discountPercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
            "stockPerItem" INTEGER NOT NULL DEFAULT 0,
            "purchaseLimit" INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'queued',
            position INTEGER NOT NULL DEFAULT 0,
            "shopeeFlashSaleId" BIGINT,
            "failedItems" JSONB,
            error TEXT,
            attempts INTEGER NOT NULL DEFAULT 0,
            "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
            "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
        )`)
    tableReady.add(schema)
}

const uid = () => 'fsp_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36)

/** Dựng ShopeeService từ channel — dùng chung cho route + cron. */
export function shopeeServiceFromChannel(channel: any): ShopeeService {
    return new ShopeeService({
        apiKey: channel.apiKey || '',
        apiSecret: channel.apiSecret || '',
        accessToken: channel.accessToken || '',
        refreshToken: channel.refreshToken || '',
        shopId: channel.shopId || '',
    } as any)
}

async function getShopeeChannel(prisma: any, channelId: string) {
    const channel = await prisma.onlineChannel.findUnique({ where: { id: channelId } })
    if (!channel) throw new Error('Không tìm thấy kênh')
    if (channel.platform !== 'shopee') throw new Error('Flash sale hiện chỉ hỗ trợ kênh Shopee')
    if (!channel.accessToken) throw new Error('Kênh chưa kết nối API (thiếu access token)')

    // TỰ CHỮA cờ registry: cron flashSaleScheduler/autoSync chỉ quét store có
    // hasOnlineChannels=true. Kênh tạo qua đường cũ (trước khi có cột) bị thiếu
    // cờ → plan nằm queued mãi không ai kích hoạt (case KENGISTORE 2026-07-14).
    const schema = (prisma as any).__schema
    if (schema) {
        const { registryPrisma } = await import('../lib/prisma')
        ;(registryPrisma as any).store.updateMany({
            where: { schema, hasOnlineChannels: false } as any,
            data: { hasOnlineChannels: true },
        }).catch(() => { })
    }
    return channel
}

// ─── GET /slots?channelId=&days=7 — khung giờ Shopee còn trống ───────────────
router.get('/slots', async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const channel = await getShopeeChannel(prisma, String(req.query.channelId || ''))
        const service = shopeeServiceFromChannel(channel)
        const now = Math.floor(Date.now() / 1000)
        const days = Math.min(Number(req.query.days) || 7, 7) // Shopee giới hạn ~7 ngày
        const slots = await service.flashSaleGetTimeSlots(now, now + days * 86400)
        // Shopee trả cả khung ĐANG chạy / sắp bắt đầu — không còn kịp đăng ký
        // (cron cần đệm ≥2') → lọc bỏ để người dùng không chọn nhầm rồi bị skip.
        const usable = slots.filter(s => Number(s.start_time) > now + 5 * 60)
        res.json({ success: true, data: usable })
    } catch (err: any) {
        res.status(400).json({ success: false, error: errMsg(err) })
    }
})

// ─── GET /plans?channelId= — hàng đợi + trạng thái ───────────────────────────
router.get('/plans', async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        await ensureFlashSaleTable(prisma)
        const channelId = String(req.query.channelId || '')
        const rows = await prisma.$queryRawUnsafe(
            `SELECT * FROM "FlashSalePlan" ${channelId ? `WHERE "channelId" = $1` : ''}
             ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'queued' THEN 1 ELSE 2 END, position ASC, "startTime" ASC
             LIMIT 100`,
            ...(channelId ? [channelId] : [])
        )
        // timeslotId/shopeeFlashSaleId là BIGINT → pg trả BigInt, JSON.stringify
        // nổ "Do not know how to serialize a BigInt" (chỉ lộ khi bảng CÓ dữ liệu).
        const safe = (rows as any[]).map(r =>
            Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'bigint' ? Number(v) : v]))
        )
        res.json({ success: true, data: safe })
    } catch (err: any) {
        res.status(400).json({ success: false, error: errMsg(err) })
    }
})

// ─── POST /plans — xếp N flash sale vào hàng đợi (KHÔNG đẩy Shopee ngay) ─────
// body: { channelId, slots: [{timeslotId,startTime,endTime}], discountPercent,
//         stockPerItem, purchaseLimit, items: [{itemId, name, price}] }
router.post('/plans', async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        await ensureFlashSaleTable(prisma)
        const { channelId, slots, discountPercent, stockPerItem, purchaseLimit, items, title } = req.body || {}
        await getShopeeChannel(prisma, String(channelId || '')) // validate kênh

        const slotList: any[] = Array.isArray(slots) ? slots : []
        const itemList: any[] = Array.isArray(items) ? items : []
        if (slotList.length === 0) { res.status(400).json({ success: false, error: 'Chưa chọn khung giờ nào' }); return }
        if (itemList.length === 0) { res.status(400).json({ success: false, error: 'Chưa chọn sản phẩm nào' }); return }
        if (itemList.length > 50) { res.status(400).json({ success: false, error: 'Shopee tối đa 50 sản phẩm/flash sale' }); return }
        const pct = Number(discountPercent)
        if (!Number.isFinite(pct) || pct < 5 || pct > 90) {
            res.status(400).json({ success: false, error: 'Phần trăm giảm phải trong khoảng 5–90%' }); return
        }
        const stock = Math.max(1, Number(stockPerItem) || 1)
        const limit = Math.max(0, Number(purchaseLimit) || 0)

        const maxPos: any[] = await prisma.$queryRawUnsafe(`SELECT COALESCE(MAX(position),0)::int AS p FROM "FlashSalePlan"`)
        let pos = (maxPos[0]?.p ?? 0) + 1
        const created: string[] = []
        for (const s of slotList) {
            const start = new Date(Number(s.startTime) * 1000)
            const end = new Date(Number(s.endTime) * 1000)
            if (isNaN(start.getTime()) || isNaN(end.getTime()) || !s.timeslotId) continue
            const id = uid()
            await prisma.$executeRawUnsafe(
                `INSERT INTO "FlashSalePlan"
                 (id, "channelId", title, "timeslotId", "startTime", "endTime", items,
                  "discountPercent", "stockPerItem", "purchaseLimit", status, position)
                 VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,'queued',$11)`,
                id, String(channelId), String(title || `Flash sale -${pct}%`),
                Number(s.timeslotId), start, end, JSON.stringify(itemList),
                pct, stock, limit, pos++
            )
            created.push(id)
        }
        if (created.length === 0) { res.status(400).json({ success: false, error: 'Không có khung giờ hợp lệ' }); return }
        res.json({
            success: true,
            data: { created: created.length },
            message: `Đã xếp ${created.length} flash sale vào hàng đợi — hệ thống sẽ tự đẩy lên Shopee tuần tự (hết sale trước mới tới sale sau).`,
        })
    } catch (err: any) {
        res.status(400).json({ success: false, error: errMsg(err) })
    }
})

// ─── DELETE /plans/:id — huỷ plan ────────────────────────────────────────────
router.delete('/plans/:id', async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        await ensureFlashSaleTable(prisma)
        const rows: any[] = await prisma.$queryRawUnsafe(`SELECT * FROM "FlashSalePlan" WHERE id = $1`, req.params.id)
        const plan = rows[0]
        if (!plan) { res.status(404).json({ success: false, error: 'Không tìm thấy kế hoạch' }); return }

        if (plan.status === 'active' && plan.shopeeFlashSaleId) {
            // Đang giữ tồn trên Shopee → tắt + xoá bên Shopee trước
            const channel = await getShopeeChannel(prisma, plan.channelId)
            const service = shopeeServiceFromChannel(channel)
            try { await service.flashSaleUpdateStatus(Number(plan.shopeeFlashSaleId), 2) } catch { /* đã tắt/đang chạy */ }
            try { await service.flashSaleDelete(Number(plan.shopeeFlashSaleId)) } catch { /* sale đang chạy không xoá được */ }
        }
        await prisma.$executeRawUnsafe(
            `UPDATE "FlashSalePlan" SET status='cancelled', "updatedAt"=now() WHERE id=$1`, req.params.id)
        res.json({ success: true, message: 'Đã huỷ kế hoạch flash sale' })
    } catch (err: any) {
        res.status(400).json({ success: false, error: errMsg(err) })
    }
})

export default router
