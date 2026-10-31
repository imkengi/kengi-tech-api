/* ═══════════════════════════════════════════════════════════════════════════════
 *  SHOPEE PILOT — bảng điều khiển bán hàng Shopee chạy TRÊN KENGI (31/10/2026)
 *
 *  Chủ shop có sẵn giao diện "Shopee Pilot" (chatbot/mcp/shopee/web, trước chạy bằng
 *  backend riêng trên máy Windows + catalog.local.json + worker). Chủ shop chọn: giữ giao
 *  diện, nối vào kengi. File này là phần máy chủ mà giao diện đó gọi
 *  (routes/shopeePilot.ts → /api/shopee-pilot/*), dữ liệu lấy từ KHO THẬT:
 *    - sản phẩm = listing của gian Shopee đã chọn + hàng kho chưa đăng (lib/shopeeThaoTac.timUngVien)
 *    - giá vốn, tồn bán được, phí sàn đo từ đơn đã đối soát (lib/giaShopee)
 *    - đăng / đổi giá đi ĐÚNG đường của tool MCP (dangSanPhamShopee / doiGiaShopee) ⇒ cùng rào giá sàn.
 *
 *  Mô hình của Pilot giữ nguyên: mọi thao tác ghi đi qua KẾ HOẠCH (draft) → THỰC THI.
 *  Chế độ 'preview' (mặc định) thì thực thi chỉ trả lại kế hoạch, không gọi Shopee.
 *  Rào của chính sách Pilot, máy chủ chặn chứ không dựa vào giao diện:
 *    - giá dưới giá sàn (biên tối thiểu sau phí sàn) — từ lib/giaShopee
 *    - đổi giá quá maxPriceChangeRate mỗi lần (trừ khi đang nâng lên giá sàn)
 *    - quá maxWritesPerDay lần ghi/ngày (giờ VN, tính cả lần hỏng)
 *    - khuyến mãi: giảm quá maxDiscountRate, dài quá maxCampaignDays, giá KM dưới sàn,
 *      mã vừa TĂNG giá trong promotionCooldownHoursAfterIncrease giờ
 *    - khoá idempotency từ giao diện: bấm hai lần không ra hai kế hoạch; thực thi giành
 *      kế hoạch nguyên tử (draft → running) nên hai tab không chạy đúp.
 * ═══════════════════════════════════════════════════════════════════════════════ */

import crypto from 'crypto'
import { ToolError } from './mcpTypes'
import { tinhGiaDeXuat, danhGiaGia, chanGiaDuoiSan, type ThamSoGia, type KetQuaGia, type MauPhi } from './giaShopee'
import { moDichVuShopee, docMauPhi, timHangKho, duongNganh } from './shopeeTuQuan'
import {
    num, giaVonHangLoat, soBan14Ngay, timUngVien, dangSanPhamShopee, doiGiaShopee, timListing, LoiKhongRo, THIEU_MO_TA,
} from './shopeeThaoTac'

// ─── Chính sách ─────────────────────────────────────────────────────────────────

export interface ChinhSachPilot {
    targetMarginRate: number
    minMarginRate: number
    maxPriceChangeRate: number
    maxDiscountRate: number
    maxWritesPerDay: number
    maxCampaignDays: number
    priceStep: number
    packagingCost: number
    adsRate: number
    promotionCooldownHoursAfterIncrease: number
    automation: { publishNewProducts: boolean; reprice: boolean; campaign: { enabled: boolean }; syncStock: boolean }
}

export const CHINH_SACH_MAC_DINH: ChinhSachPilot = {
    targetMarginRate: 0.15,
    minMarginRate: 0.05,
    maxPriceChangeRate: 0.1,
    maxDiscountRate: 0.3,
    maxWritesPerDay: 50,
    maxCampaignDays: 7,
    priceStep: 1000,
    packagingCost: 0,
    adsRate: 0,
    promotionCooldownHoursAfterIncrease: 24,
    automation: { publishNewProducts: true, reprice: true, campaign: { enabled: false }, syncStock: false },
}

const kep = (v: any, d: number, min: number, max: number) => Math.min(Math.max(num(v, d), min), max)

/** Chuẩn hoá chính sách người gửi lên — số lạ thì về mặc định, kẹp trong khoảng an toàn. */
export function chuanHoaChinhSach(x: any): ChinhSachPilot {
    const m = CHINH_SACH_MAC_DINH
    const minMargin = kep(x?.minMarginRate, m.minMarginRate, 0, 0.8)
    const tu = x?.automation || {}
    return {
        minMarginRate: minMargin,
        targetMarginRate: Math.max(minMargin, kep(x?.targetMarginRate, m.targetMarginRate, 0, 0.8)),
        maxPriceChangeRate: kep(x?.maxPriceChangeRate, m.maxPriceChangeRate, 0.01, 1),
        maxDiscountRate: kep(x?.maxDiscountRate, m.maxDiscountRate, 0.01, 0.9),
        maxWritesPerDay: Math.floor(kep(x?.maxWritesPerDay, m.maxWritesPerDay, 1, 1000)),
        maxCampaignDays: Math.floor(kep(x?.maxCampaignDays, m.maxCampaignDays, 1, 180)),
        priceStep: Math.floor(kep(x?.priceStep, m.priceStep, 1, 100000)),
        packagingCost: kep(x?.packagingCost, m.packagingCost, 0, 1e7),
        adsRate: kep(x?.adsRate, m.adsRate, 0, 0.5),
        promotionCooldownHoursAfterIncrease: kep(x?.promotionCooldownHoursAfterIncrease, m.promotionCooldownHoursAfterIncrease, 0, 24 * 30),
        automation: {
            publishNewProducts: typeof tu.publishNewProducts === 'boolean' ? tu.publishNewProducts : m.automation.publishNewProducts,
            reprice: typeof tu.reprice === 'boolean' ? tu.reprice : m.automation.reprice,
            campaign: { enabled: typeof tu?.campaign?.enabled === 'boolean' ? tu.campaign.enabled : m.automation.campaign.enabled },
            syncStock: typeof tu.syncStock === 'boolean' ? tu.syncStock : m.automation.syncStock,
        },
    }
}

/** Chính sách Pilot → tham số giá kiểu tool (lib/shopeeThaoTac.chinhSachGia). */
export function thamSoGia(p: ChinhSachPilot) {
    return {
        bien_loi_nhuan: p.targetMarginRate * 100,
        bien_toi_thieu: p.minMarginRate * 100,
        phi_dong_goi: p.packagingCost,
        phi_quang_cao: p.adsRate * 100,
        lam_tron: p.priceStep,
    }
}

function thamSoTinh(p: ChinhSachPilot, giaVon: number, phi: MauPhi): ThamSoGia {
    return {
        giaVon, phi,
        bienLoiNhuanPct: p.targetMarginRate * 100,
        bienToiThieuPct: p.minMarginRate * 100,
        phiDongGoi: p.packagingCost,
        phiQuangCaoPct: p.adsRate * 100,
        lamTron: p.priceStep,
    }
}

export interface CauHinhPilot { channelId: string | null; executionMode: 'preview' | 'auto'; policy: ChinhSachPilot; updatedAt: number }

// ─── Kho lưu (kế hoạch, nhật ký ghi, cấu hình) ──────────────────────────────────

export interface KeHoach {
    id: string
    kind: 'publish' | 'price' | 'campaign'
    status: string
    idempotencyKey: string | null
    data: any
    result: any
    createdBy: string | null
    createdAt: number
    updatedAt: number
}
export interface NhatKy { id: string; action: string; status: string; planId: string | null; payload: any; response: any; createdAt: number }

export interface KhoPilot {
    docCauHinh(): Promise<CauHinhPilot | null>
    luuCauHinh(c: CauHinhPilot): Promise<void>
    taoKeHoach(k: KeHoach): Promise<KeHoach>
    timKeHoachTheoKhoa(khoa: string): Promise<KeHoach | null>
    layKeHoach(id: string): Promise<KeHoach | null>
    /** draft → running, nguyên tử. false = bản khác đã giành / không còn là draft. */
    gianhKeHoach(id: string): Promise<boolean>
    capNhatKeHoach(id: string, status: string, result: any): Promise<void>
    dsKeHoach(lim: number): Promise<KeHoach[]>
    ghiNhatKy(w: Omit<NhatKy, 'id' | 'createdAt'>): Promise<void>
    dsNhatKy(lim: number): Promise<NhatKy[]>
    demGhiTuLuc(ms: number): Promise<number>
    /** Lần gần nhất (ms) đổi giá TĂNG thành công cho SKU này qua Pilot, null nếu chưa có. */
    lanTangGiaCuoi(sku: string): Promise<number | null>
}

const docJson = (s: any, d: any = null) => { try { return s ? JSON.parse(s) : d } catch { return d } }

/** Ba bảng của Pilot — tạo lười lần đầu dùng (và trong /admin/migrate). Cột thời gian là epoch ms (BIGINT)
 *  để khỏi lệch múi giờ giữa timestamp không múi giờ của Prisma và giờ phiên Postgres. */
export const SQL_TAO_BANG_PILOT = [
    `CREATE TABLE IF NOT EXISTS "ShopeePilotConfig" (
        "id" TEXT NOT NULL, "channelId" TEXT, "executionMode" TEXT NOT NULL DEFAULT 'preview',
        "policy" TEXT NOT NULL DEFAULT '{}', "updatedAt" BIGINT NOT NULL DEFAULT 0,
        CONSTRAINT "ShopeePilotConfig_pkey" PRIMARY KEY ("id"))`,
    `CREATE TABLE IF NOT EXISTS "ShopeePilotPlan" (
        "id" TEXT NOT NULL, "kind" TEXT NOT NULL, "status" TEXT NOT NULL, "idempotencyKey" TEXT,
        "data" TEXT NOT NULL DEFAULT '{}', "result" TEXT, "createdBy" TEXT,
        "createdAt" BIGINT NOT NULL, "updatedAt" BIGINT NOT NULL,
        CONSTRAINT "ShopeePilotPlan_pkey" PRIMARY KEY ("id"))`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "ShopeePilotPlan_idempotencyKey_key" ON "ShopeePilotPlan"("idempotencyKey")`,
    `CREATE INDEX IF NOT EXISTS "ShopeePilotPlan_createdAt_idx" ON "ShopeePilotPlan"("createdAt")`,
    `CREATE TABLE IF NOT EXISTS "ShopeePilotWrite" (
        "id" TEXT NOT NULL, "action" TEXT NOT NULL, "status" TEXT NOT NULL, "planId" TEXT,
        "payload" TEXT NOT NULL DEFAULT '{}', "response" TEXT, "createdAt" BIGINT NOT NULL,
        CONSTRAINT "ShopeePilotWrite_pkey" PRIMARY KEY ("id"))`,
    `CREATE INDEX IF NOT EXISTS "ShopeePilotWrite_createdAt_idx" ON "ShopeePilotWrite"("createdAt")`,
]

const daTaoBang = new WeakSet<object>()

const COT_KH = `id, kind, status, "idempotencyKey", data, result, "createdBy", "createdAt"::float8 AS "createdAt", "updatedAt"::float8 AS "updatedAt"`
function hangKeHoach(r: any): KeHoach {
    return {
        id: r.id, kind: r.kind, status: r.status, idempotencyKey: r.idempotencyKey ?? null,
        data: docJson(r.data, {}), result: docJson(r.result, null), createdBy: r.createdBy ?? null,
        createdAt: Number(r.createdAt), updatedAt: Number(r.updatedAt),
    }
}

/** Kho lưu trên schema của cửa hàng (raw SQL — không phụ thuộc client Prisma sinh lại). */
export function khoSql(prisma: any): KhoPilot {
    const chacBang = async () => {
        if (daTaoBang.has(prisma)) return
        for (const sql of SQL_TAO_BANG_PILOT) await prisma.$executeRawUnsafe(sql)
        daTaoBang.add(prisma)
    }
    const q = async (sql: string, ...v: any[]) => { await chacBang(); return prisma.$queryRawUnsafe(sql, ...v) as Promise<any[]> }
    const x = async (sql: string, ...v: any[]) => { await chacBang(); return prisma.$executeRawUnsafe(sql, ...v) as Promise<number> }
    return {
        async docCauHinh() {
            const [r] = await q(`SELECT "channelId", "executionMode", policy, "updatedAt"::float8 AS "updatedAt" FROM "ShopeePilotConfig" WHERE id = 'default'`)
            if (!r) return null
            return { channelId: r.channelId ?? null, executionMode: r.executionMode === 'auto' ? 'auto' : 'preview', policy: chuanHoaChinhSach(docJson(r.policy, {})), updatedAt: Number(r.updatedAt) || 0 }
        },
        async luuCauHinh(c) {
            await x(`INSERT INTO "ShopeePilotConfig" (id, "channelId", "executionMode", policy, "updatedAt") VALUES ('default', $1, $2, $3, $4)
                     ON CONFLICT (id) DO UPDATE SET "channelId" = EXCLUDED."channelId", "executionMode" = EXCLUDED."executionMode",
                     policy = EXCLUDED.policy, "updatedAt" = EXCLUDED."updatedAt"`,
                c.channelId, c.executionMode, JSON.stringify(c.policy), Date.now())
        },
        async taoKeHoach(k) {
            const rs = await q(`INSERT INTO "ShopeePilotPlan" (id, kind, status, "idempotencyKey", data, result, "createdBy", "createdAt", "updatedAt")
                                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT ("idempotencyKey") DO NOTHING RETURNING ${COT_KH}`,
                k.id, k.kind, k.status, k.idempotencyKey, JSON.stringify(k.data), k.result == null ? null : JSON.stringify(k.result), k.createdBy, k.createdAt, k.updatedAt)
            if (rs[0]) return hangKeHoach(rs[0])
            const cu = k.idempotencyKey ? await this.timKeHoachTheoKhoa(k.idempotencyKey) : null
            if (!cu) throw new Error('Không lưu được kế hoạch')
            return cu
        },
        async timKeHoachTheoKhoa(khoa) {
            const [r] = await q(`SELECT ${COT_KH} FROM "ShopeePilotPlan" WHERE "idempotencyKey" = $1`, khoa)
            return r ? hangKeHoach(r) : null
        },
        async layKeHoach(id) {
            const [r] = await q(`SELECT ${COT_KH} FROM "ShopeePilotPlan" WHERE id = $1`, id)
            return r ? hangKeHoach(r) : null
        },
        async gianhKeHoach(id) {
            return (await x(`UPDATE "ShopeePilotPlan" SET status = 'running', "updatedAt" = $2 WHERE id = $1 AND status = 'draft'`, id, Date.now())) === 1
        },
        async capNhatKeHoach(id, status, result) {
            await x(`UPDATE "ShopeePilotPlan" SET status = $2, result = $3, "updatedAt" = $4 WHERE id = $1`, id, status, result == null ? null : JSON.stringify(result), Date.now())
        },
        async dsKeHoach(lim) {
            return (await q(`SELECT ${COT_KH} FROM "ShopeePilotPlan" ORDER BY "createdAt" DESC LIMIT $1`, lim)).map(hangKeHoach)
        },
        async ghiNhatKy(w) {
            await x(`INSERT INTO "ShopeePilotWrite" (id, action, status, "planId", payload, response, "createdAt") VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                crypto.randomUUID(), w.action, w.status, w.planId, JSON.stringify(w.payload ?? {}), w.response == null ? null : JSON.stringify(w.response).slice(0, 20000), Date.now())
        },
        async dsNhatKy(lim) {
            const rs = await q(`SELECT id, action, status, "planId", payload, response, "createdAt"::float8 AS "createdAt" FROM "ShopeePilotWrite" ORDER BY "createdAt" DESC LIMIT $1`, lim)
            return rs.map(r => ({ id: r.id, action: r.action, status: r.status, planId: r.planId ?? null, payload: docJson(r.payload, {}), response: docJson(r.response, null), createdAt: Number(r.createdAt) }))
        },
        async demGhiTuLuc(ms) {
            const [r] = await q(`SELECT COUNT(*)::int AS n FROM "ShopeePilotWrite" WHERE "createdAt" >= $1`, ms)
            return Number(r?.n) || 0
        },
        async lanTangGiaCuoi(sku) {
            const [r] = await q(`SELECT MAX("updatedAt")::float8 AS t FROM "ShopeePilotPlan"
                                 WHERE kind = 'price' AND status = 'succeeded' AND LOWER(data::jsonb->>'sku') = LOWER($1)
                                   AND (data::jsonb->>'price')::float8 > (data::jsonb->'snapshot'->>'price')::float8`, sku)
            return r?.t ? Number(r.t) : null
        },
    }
}

/** Kho trong bộ nhớ — cho bộ kiểm (cùng hợp đồng với khoSql). */
export function khoBoNho(): KhoPilot & { _keHoach: KeHoach[]; _nhatKy: NhatKy[] } {
    let cfg: CauHinhPilot | null = null
    const keHoach: KeHoach[] = []
    const nhatKy: NhatKy[] = []
    const sao = <T>(v: T): T => JSON.parse(JSON.stringify(v))
    return {
        _keHoach: keHoach, _nhatKy: nhatKy,
        async docCauHinh() { return cfg ? sao(cfg) : null },
        async luuCauHinh(c) { cfg = sao({ ...c, updatedAt: Date.now() }) },
        async taoKeHoach(k) {
            const cu = k.idempotencyKey ? keHoach.find(x => x.idempotencyKey === k.idempotencyKey) : null
            if (cu) return sao(cu)
            keHoach.push(sao(k)); return sao(k)
        },
        async timKeHoachTheoKhoa(khoa) { const k = keHoach.find(x => x.idempotencyKey === khoa); return k ? sao(k) : null },
        async layKeHoach(id) { const k = keHoach.find(x => x.id === id); return k ? sao(k) : null },
        async gianhKeHoach(id) { const k = keHoach.find(x => x.id === id); if (!k || k.status !== 'draft') return false; k.status = 'running'; return true },
        async capNhatKeHoach(id, status, result) { const k = keHoach.find(x => x.id === id); if (k) { k.status = status; k.result = sao(result); k.updatedAt = Date.now() } },
        async dsKeHoach(lim) { return sao([...keHoach].sort((a, b) => b.createdAt - a.createdAt).slice(0, lim)) },
        async ghiNhatKy(w) { nhatKy.push({ ...sao(w), id: crypto.randomUUID(), createdAt: Date.now() }) },
        async dsNhatKy(lim) { return sao([...nhatKy].sort((a, b) => b.createdAt - a.createdAt).slice(0, lim)) },
        async demGhiTuLuc(ms) { return nhatKy.filter(w => w.createdAt >= ms).length },
        async lanTangGiaCuoi(sku) {
            const ds = keHoach.filter(k => k.kind === 'price' && k.status === 'succeeded' && String(k.data?.sku).toLowerCase() === sku.toLowerCase() && k.data.price > k.data?.snapshot?.price)
            return ds.length ? Math.max(...ds.map(k => k.updatedAt)) : null
        },
    }
}

// ─── Ngữ cảnh ───────────────────────────────────────────────────────────────────

export interface NgCanh { prisma: any; kho: KhoPilot; nguoi?: string | null }

/** 0h hôm nay giờ VN, epoch ms. */
export function dauNgayVN(now = Date.now()): number {
    const VN = 7 * 3600_000
    return Math.floor((now + VN) / 86400_000) * 86400_000 - VN
}
const ngayVN = (now = Date.now()) => new Date(now + 7 * 3600_000).toISOString().slice(0, 10)
const vnd = (n: number) => `${Math.round(n).toLocaleString('vi-VN')}đ`
const pct = (r: number) => `${(Math.round(r * 1000) / 10).toLocaleString('vi-VN')}%`

export async function docCauHinh(ctx: NgCanh): Promise<{ cfg: CauHinhPilot; kenh: any[]; ch: any | null }> {
    const cfg = (await ctx.kho.docCauHinh()) || { channelId: null, executionMode: 'preview' as const, policy: chuanHoaChinhSach({}), updatedAt: 0 }
    const kenh: any[] = await ctx.prisma.onlineChannel.findMany({ where: { platform: 'shopee' }, orderBy: { createdAt: 'asc' } })
    const ch = (cfg.channelId && kenh.find(c => c.id === cfg.channelId)) || (kenh.length === 1 ? kenh[0] : null)
    return { cfg, kenh, ch }
}

async function canGian(ctx: NgCanh) {
    const r = await docCauHinh(ctx)
    if (!r.ch) {
        throw new ToolError(r.kenh.length
            ? `Cửa hàng có ${r.kenh.length} gian Shopee — chọn gian cho Pilot ở Tự động hóa → Sửa chính sách.`
            : 'Cửa hàng chưa kết nối gian Shopee nào — kết nối ở Kênh bán online trên kengi.vn trước.')
    }
    if (!r.ch.accessToken || !r.ch.shopId) throw new ToolError(`Gian "${r.ch.name}" chưa uỷ quyền API Shopee.`)
    return r as { cfg: CauHinhPilot; kenh: any[]; ch: any }
}

function giaUi(kq: KetQuaGia, ts: ThamSoGia) {
    const dk = kq.duKien || (kq.giaDeXuat ? danhGiaGia(kq.giaDeXuat, ts) : null)
    return {
        price: kq.hopLe ? kq.giaDeXuat : null,
        floor: kq.giaSan || null,
        breakEven: kq.giaHoaVon || null,
        profit: dk ? dk.loiNhuan : null,
        marginRate: dk ? dk.bienPct / 100 : null,
        ...(kq.hopLe ? {} : { reason: kq.lyDo }),
    }
}

// ─── Trạng thái cho giao diện (GET /state) ─────────────────────────────────────

const TRAN_LISTING = 100
const TRAN_UNG_VIEN = 30

export async function xayTrangThai(ctx: NgCanh): Promise<any> {
    const { cfg, kenh, ch } = await docCauHinh(ctx)
    const pol = cfg.policy
    const [plans, audit, todayWrites] = await Promise.all([ctx.kho.dsKeHoach(60), ctx.kho.dsNhatKy(100), ctx.kho.demGhiTuLuc(dauNgayVN())])
    const channels = kenh.map(c => ({ id: c.id, name: c.name, shopId: c.shopId, authorized: !!(c.accessToken && c.shopId) }))
    const status: any = {
        mode: 'live', environment: 'production', executionMode: cfg.executionMode, policy: pol,
        channels, shop: ch ? { id: ch.id, name: ch.name, shopId: ch.shopId, authorized: !!(ch.accessToken && ch.shopId) } : null,
    }
    const goc = { csrfToken: 'kengi', now: Date.now(), todayWrites, plans, audit, status }
    if (!ch) {
        status.notice = kenh.length ? `Cửa hàng có ${kenh.length} gian Shopee — chọn một gian ở Tự động hóa → Sửa chính sách.` : 'Cửa hàng chưa kết nối gian Shopee nào.'
        return { ...goc, products: [] }
    }

    const listing: any[] = await ctx.prisma.onlineProduct.findMany({
        where: { channelId: ch.id, status: { in: ['NORMAL', 'UNLIST'] } },
        orderBy: { updatedAt: 'desc' },
        take: TRAN_LISTING,
    })
    const [von, daBan, mauPhi, uv] = await Promise.all([
        giaVonHangLoat(ctx.prisma, listing),
        soBan14Ngay(ctx.prisma, ch.id),
        docMauPhi(ctx.prisma, ch),
        timUngVien(ctx.prisma, ch.id, { lim: TRAN_UNG_VIEN }),
    ])
    status.feeModel = { rate: mauPhi.tyLe, fixedPerOrder: mauPhi.coDinh, source: mauPhi.nguon, orders: mauPhi.soDon, note: mauPhi.ghiChu }

    const products: any[] = []
    for (const l of listing) {
        const v = von.get(l.id)
        const giaVon = v && v.giaVon > 0 ? v.giaVon : 0
        const ts = thamSoTinh(pol, giaVon, mauPhi)
        const kq = tinhGiaDeXuat(ts)
        const coPhanLoai = !(Number(l.price) > 0)
        products.push({
            sku: l.sku || v?.sku || `ITEM-${l.platformProductId}`,
            itemId: l.platformProductId,
            enabled: giaVon > 0 && !coPhanLoai,
            listingStatus: l.status,
            costPrice: giaVon || null,
            currentPrice: Number(l.price) || null,
            stock: Number(l.stock) || 0,
            sold14: daBan.get(String(l.sku || '').toLowerCase()) || 0,
            imageUrl: l.imageUrl || null,
            listing: { item_name: l.name, description: v?.moTa || '' },
            pricing: { ...giaUi(kq, ts), snapshot: { price: Number(l.price) || 0, stock: Number(l.stock) || 0 } },
            ...(coPhanLoai ? { error: 'Sản phẩm có phân loại — giá từng phân loại sửa trên Shopee.' }
                : !giaVon ? { error: 'Chưa có giá vốn trong kho — không tính được lãi, không đổi giá.' } : {}),
        })
    }
    for (const u of uv.ungVien) {
        const ts = thamSoTinh(pol, u.giaVon || 0, mauPhi)
        const kq = tinhGiaDeXuat(ts)
        const thieu = u.thieu.filter(t => t !== THIEU_MO_TA)
        products.push({
            sku: u.sku, itemId: null, enabled: thieu.length === 0,
            costPrice: u.giaVon || null, currentPrice: u.giaBanLe || null, stock: u.tonBanDuoc,
            imageUrl: u.anhDau, sold14: 0,
            listing: { item_name: u.ten, description: u.moTa },
            pricing: giaUi(kq, ts),
            ...(thieu.length ? { error: `Thiếu ${thieu.join(', ')} trong kho — bổ sung trên kengi.vn rồi mới đăng được.` } : {}),
        })
    }
    return {
        ...goc, products,
        catalogNote: `${listing.length >= TRAN_LISTING ? `${TRAN_LISTING} sản phẩm đang bán mới cập nhật nhất` : `${listing.length} sản phẩm trên gian`} · ${uv.ungVien.length} mặt hàng kho còn tồn chưa đăng`
            + (listing.length === 0 ? ' · Gian chưa có sản phẩm nào trong hệ thống — nếu gian đã bán trên Shopee, bấm Đồng bộ ở kengi.vn trước để tránh đăng trùng.' : ''),
    }
}

// ─── Kế hoạch ───────────────────────────────────────────────────────────────────

function keHoachMoi(kind: KeHoach['kind'], data: any, khoa: string | null, nguoi?: string | null): KeHoach {
    const t = Date.now()
    return { id: crypto.randomUUID(), kind, status: 'draft', idempotencyKey: khoa ? String(khoa).slice(0, 200) : null, data, result: null, createdBy: nguoi ?? null, createdAt: t, updatedAt: t }
}

/** Đổi giá có vượt biên độ mỗi lần không. Ngoại lệ: đang DƯỚI giá sàn thì được nâng thẳng lên tới giá sàn. */
export function vuotBienDong(giaCu: number, giaMoi: number, maxRate: number, giaSan: number): string | null {
    if (!(giaCu > 0)) return null
    const doi = Math.abs(giaMoi - giaCu) / giaCu
    if (doi <= maxRate + 1e-9) return null
    if (giaCu < giaSan && giaMoi > giaCu && giaMoi <= giaSan) return null
    return `Đổi ${pct(doi)} so với giá đang bán ${vnd(giaCu)} — vượt biên độ ${pct(maxRate)} mỗi lần theo chính sách. ` +
        `Lần này chỉ được trong khoảng ${vnd(Math.ceil(giaCu * (1 - maxRate)))}–${vnd(Math.floor(giaCu * (1 + maxRate)))}.`
}

export async function taoKeHoachGia(ctx: NgCanh, b: { sku: string; price: number; idempotencyKey?: string }): Promise<KeHoach> {
    if (b.idempotencyKey) { const cu = await ctx.kho.timKeHoachTheoKhoa(b.idempotencyKey); if (cu) return cu }
    const { cfg, ch } = await canGian(ctx)
    const gia = Math.round(num(b.price, 0))
    if (!(gia > 0)) throw new ToolError('Giá mới không hợp lệ')
    const l = await timListing(ctx.prisma, ch.id, { sku: b.sku })
    const giaCu = Number(l.price) || 0
    if (!(giaCu > 0)) throw new ToolError('Sản phẩm có phân loại — giá từng phân loại sửa trên Shopee.')
    const v = (await giaVonHangLoat(ctx.prisma, [l])).get(l.id)
    if (!v || !(v.giaVon > 0)) throw new ToolError(`${b.sku} chưa có giá vốn trong kho — không đổi giá khi không biết lãi/lỗ.`)
    const ts = thamSoTinh(cfg.policy, v.giaVon, await docMauPhi(ctx.prisma, ch))
    const kq = tinhGiaDeXuat(ts)
    const chan = chanGiaDuoiSan(gia, kq) || vuotBienDong(giaCu, gia, cfg.policy.maxPriceChangeRate, kq.giaSan)
    if (chan) throw new ToolError(chan)
    const dk = danhGiaGia(gia, ts)
    return ctx.kho.taoKeHoach(keHoachMoi('price', {
        sku: l.sku || b.sku, itemId: l.platformProductId, price: gia,
        snapshot: { price: giaCu, stock: Number(l.stock) || 0 },
        economics: { marginRate: dk.bienPct / 100, profit: dk.loiNhuan, floor: kq.giaSan, suggested: kq.hopLe ? kq.giaDeXuat : null },
    }, b.idempotencyKey || null, ctx.nguoi))
}

export interface DauVaoDang {
    sku: string; title?: string; description?: string; categoryId: number; weightGram: number
    attributes?: { attribute_id: number; value_id?: number; gia_tri?: string; don_vi?: string }[]
    brandId?: number; brandName?: string; hidden?: boolean; idempotencyKey?: string
}

export async function taoKeHoachDang(ctx: NgCanh, b: DauVaoDang): Promise<KeHoach> {
    if (b.idempotencyKey) { const cu = await ctx.kho.timKeHoachTheoKhoa(b.idempotencyKey); if (cu) return cu }
    const { cfg, ch } = await canGian(ctx)
    const args = {
        sku: b.sku, ten: b.title, mo_ta: b.description, category_id: num(b.categoryId, 0), can_nang_gram: num(b.weightGram, 0),
        thuoc_tinh: Array.isArray(b.attributes) ? b.attributes : [], brand_id: num(b.brandId, 0), ten_thuong_hieu: b.brandName || '',
        an_sau_khi_dang: b.hidden === true, ...thamSoGia(cfg.policy),
    }
    // Soát đủ mọi rào bằng chính đường đăng thật (chạy thử): trùng, giá sàn, tồn, tên/mô tả, ảnh, vận chuyển
    const thu = await dangSanPhamShopee(ctx.prisma, { ...args, chay_thu: true }, { ch })
    return ctx.kho.taoKeHoach(keHoachMoi('publish', {
        sku: b.sku, args,
        payload: thu.thanYeuCau,
        images: thu.anhSeNap,
        economics: { marginRate: thu.phanTichGia.duKien.bienPct / 100, profit: thu.phanTichGia.duKien.loiNhuan, floor: thu.phanTichGia.giaSan, suggested: thu.phanTichGia.giaDeXuat },
        feeNote: thu.phanTichGia.mauPhi,
    }, b.idempotencyKey || null, ctx.nguoi))
}

export interface DauVaoKhuyenMai {
    name: string; skus: string[]; discountRate: number; startTime: number; endTime: number; purchaseLimit: number; idempotencyKey?: string
}

export async function taoKeHoachKhuyenMai(ctx: NgCanh, b: DauVaoKhuyenMai): Promise<KeHoach> {
    if (b.idempotencyKey) { const cu = await ctx.kho.timKeHoachTheoKhoa(b.idempotencyKey); if (cu) return cu }
    const { cfg, ch } = await canGian(ctx)
    const pol = cfg.policy
    const ten = String(b.name || '').trim()
    if (!ten || ten.length > 100) throw new ToolError('Tên chương trình 1–100 ký tự')
    const giam = num(b.discountRate, 0)
    if (!(giam > 0) || giam > pol.maxDiscountRate + 1e-9) throw new ToolError(`Mức giảm phải trong khoảng 1%–${pct(pol.maxDiscountRate)} theo chính sách`)
    const batDau = Math.floor(num(b.startTime, 0)), ketThuc = Math.floor(num(b.endTime, 0))
    const bayGio = Math.floor(Date.now() / 1000)
    if (batDau < bayGio + 5 * 60) throw new ToolError('Giờ bắt đầu phải sau thời điểm hiện tại ít nhất 5 phút')
    if (ketThuc - batDau < 3600) throw new ToolError('Chương trình phải dài ít nhất 1 giờ')
    if (ketThuc - batDau > pol.maxCampaignDays * 86400) throw new ToolError(`Chương trình dài tối đa ${pol.maxCampaignDays} ngày theo chính sách`)
    const gioiHanMua = Math.floor(num(b.purchaseLimit, 0))
    if (!(gioiHanMua >= 1)) throw new ToolError('Giới hạn mua mỗi sản phẩm phải ≥ 1')
    const skus = [...new Set((b.skus || []).map(s => String(s).trim()).filter(Boolean))]
    if (!skus.length) throw new ToolError('Chọn ít nhất một sản phẩm')

    const mauPhi = await docMauPhi(ctx.prisma, ch)
    const lines: any[] = [], tuChoi: { sku: string; reason: string }[] = []
    const listings: any[] = []
    for (const sku of skus) {
        try { listings.push(await timListing(ctx.prisma, ch.id, { sku })) } catch { tuChoi.push({ sku, reason: 'Không có trên gian' }) }
    }
    const von = await giaVonHangLoat(ctx.prisma, listings)
    // Chương trình khác đang chạy / sắp chạy trên mã (Shopee từ chối mã đã trong chương trình khác)
    const dangKm = new Map<string, string>()
    let canhBao: string | undefined
    try {
        const svc = await moDichVuShopee(ctx.prisma, ch)
        const ids = listings.map(l => Number(l.platformProductId)).filter(n => n > 0)
        for (let i = 0; i < ids.length; i += 50) {
            for (const x of await svc.getItemPromotion(ids.slice(i, i + 50))) {
                const p = (x?.promotion || []).find((p: any) => /ongoing|upcoming/i.test(String(p?.promotion_staging || '')))
                if (p) dangKm.set(String(x.item_id), String(p.promotion_type || 'chương trình khác'))
            }
        }
    } catch (e: any) {
        canhBao = `Chưa kiểm được chương trình đang chạy trên các mã (${String(e?.message || e).slice(0, 120)}) — Shopee sẽ tự từ chối mã trùng lúc thực thi.`
    }
    const buoc = pol.priceStep
    for (const l of listings) {
        const sku = l.sku || l.platformProductId
        const giaCu = Number(l.price) || 0
        const v = von.get(l.id)
        if (!(giaCu > 0)) { tuChoi.push({ sku, reason: 'Có phân loại — chưa hỗ trợ giảm giá theo phân loại' }); continue }
        if (!v || !(v.giaVon > 0)) { tuChoi.push({ sku, reason: 'Chưa có giá vốn' }); continue }
        if (dangKm.has(String(l.platformProductId))) { tuChoi.push({ sku, reason: `Đang/sắp có ${dangKm.get(String(l.platformProductId))}` }); continue }
        const lanTang = await ctx.kho.lanTangGiaCuoi(sku)
        if (lanTang && Date.now() - lanTang < pol.promotionCooldownHoursAfterIncrease * 3600_000) {
            tuChoi.push({ sku, reason: `Vừa tăng giá lúc ${new Date(lanTang + 7 * 3600_000).toISOString().slice(11, 16)} — chờ đủ ${pol.promotionCooldownHoursAfterIncrease} giờ` }); continue
        }
        const ts = thamSoTinh(pol, v.giaVon, mauPhi)
        const kq = tinhGiaDeXuat(ts)
        let giaKm = Math.ceil((giaCu * (1 - giam)) / buoc) * buoc
        let dieuChinh = false
        if (giaKm < kq.giaSan) { giaKm = Math.ceil(kq.giaSan / buoc) * buoc; dieuChinh = true }
        if (giaKm >= giaCu) { tuChoi.push({ sku, reason: `Giá sàn ${vnd(kq.giaSan)} không thấp hơn giá đang bán ${vnd(giaCu)} — không giảm được` }); continue }
        const dk = danhGiaGia(giaKm, ts)
        lines.push({ sku, itemId: l.platformProductId, originalPrice: giaCu, price: giaKm, discountRate: 1 - giaKm / giaCu, floor: kq.giaSan, profit: dk.loiNhuan, marginRate: dk.bienPct / 100, ...(dieuChinh ? { adjusted: 'Nâng lên giá sàn' } : {}) })
    }
    if (!lines.length) throw new ToolError(`Không mã nào đủ điều kiện: ${tuChoi.map(t => `${t.sku} (${t.reason})`).join('; ')}`)
    return ctx.kho.taoKeHoach(keHoachMoi('campaign', {
        name: ten, startTime: batDau, endTime: ketThuc, purchaseLimit: gioiHanMua, discountRate: giam, lines, rejected: tuChoi,
        ...(canhBao ? { warning: canhBao } : {}),
    }, b.idempotencyKey || null, ctx.nguoi))
}

// ─── Thực thi ───────────────────────────────────────────────────────────────────

async function conLuotGhi(ctx: NgCanh, pol: ChinhSachPilot): Promise<void> {
    const dem = await ctx.kho.demGhiTuLuc(dauNgayVN())
    if (dem >= pol.maxWritesPerDay) throw new ToolError(`Đã đạt giới hạn ${pol.maxWritesPerDay} thao tác ghi hôm nay theo chính sách — để mai hoặc nâng giới hạn.`)
}

export async function thucThi(ctx: NgCanh, planId: string): Promise<any> {
    const plan = await ctx.kho.layKeHoach(planId)
    if (!plan) throw new ToolError('Không thấy kế hoạch — tải lại trang.')
    if (plan.status !== 'draft') return plan
    const { cfg, ch } = await canGian(ctx)
    if (cfg.executionMode !== 'auto') return { executed: false, plan }
    await conLuotGhi(ctx, cfg.policy)
    if (!(await ctx.kho.gianhKeHoach(plan.id))) return (await ctx.kho.layKeHoach(plan.id)) || plan

    const d = plan.data || {}
    let status = 'succeeded', result: any = null
    try {
        if (plan.kind === 'publish') {
            const r = await dangSanPhamShopee(ctx.prisma, { ...d.args, gia: d.payload?.original_price, chay_thu: false }, { ch })
            result = { item_id: r.itemId, link: r.link, ...(r.anhLoi ? { message: `Một số ảnh không nạp được: ${r.anhLoi.join(' | ')}` } : {}) }
            await ctx.kho.ghiNhatKy({ action: 'publish', status, planId: plan.id, payload: { item_sku: d.sku, item_id: r.itemId }, response: r })
        } else if (plan.kind === 'price') {
            // Giá trên sàn có thể đã đổi từ lúc lập kế hoạch — soát lại biên độ với giá HIỆN TẠI
            const l = await timListing(ctx.prisma, ch.id, { item_id: d.itemId })
            const v = (await giaVonHangLoat(ctx.prisma, [l])).get(l.id)
            const kq = tinhGiaDeXuat(thamSoTinh(cfg.policy, v?.giaVon || 0, await docMauPhi(ctx.prisma, ch)))
            const loiBien = vuotBienDong(Number(l.price) || 0, d.price, cfg.policy.maxPriceChangeRate, kq.giaSan)
            if (loiBien) throw new ToolError(`Giá trên sàn đã đổi từ lúc lập kế hoạch. ${loiBien}`)
            const r = await doiGiaShopee(ctx.prisma, { item_id: d.itemId, gia_moi: d.price, ...thamSoGia(cfg.policy), ly_do: 'Shopee Pilot' }, { ch })
            result = { item_id: r.itemId, old_price: r.giaCu, new_price: r.giaMoi }
            await ctx.kho.ghiNhatKy({ action: 'price', status, planId: plan.id, payload: { item_sku: d.sku, item_id: d.itemId, price: d.price }, response: r })
        } else if (plan.kind === 'campaign') {
            const r = await thucThiKhuyenMai(ctx, plan, ch)
            status = r.status; result = r.result
        } else {
            throw new ToolError(`Loại kế hoạch lạ: ${plan.kind}`)
        }
    } catch (e: any) {
        status = e instanceof LoiKhongRo ? 'uncertain' : 'failed'
        result = { message: String(e?.message || e).slice(0, 800) }
        if (plan.kind !== 'campaign') {
            await ctx.kho.ghiNhatKy({ action: plan.kind, status, planId: plan.id, payload: { item_sku: d.sku, item_id: d.itemId }, response: result }).catch(() => { })
        }
        if (!(e instanceof ToolError)) console.error(`[ShopeePilot] thực thi ${plan.kind} ${plan.id} lỗi:`, e?.message || e)
    }
    await ctx.kho.capNhatKeHoach(plan.id, status, result)
    return (await ctx.kho.layKeHoach(plan.id)) || { ...plan, status, result }
}

async function thucThiKhuyenMai(ctx: NgCanh, plan: KeHoach, ch: any): Promise<{ status: string; result: any }> {
    const d = plan.data
    const svc = await moDichVuShopee(ctx.prisma, ch)
    let discountId: number
    try {
        discountId = await svc.addDiscount(d.name, d.startTime, d.endTime)
    } catch (e: any) {
        const loi = String(e?.message || e)
        const khongRo = !/^Shopee add_discount/.test(loi)
        await ctx.kho.ghiNhatKy({ action: 'campaign', status: khongRo ? 'uncertain' : 'failed', planId: plan.id, payload: { discount_name: d.name }, response: { message: loi } })
        if (khongRo) throw new LoiKhongRo(`KHÔNG RÕ Shopee đã tạo chương trình "${d.name}" chưa (${loi.slice(0, 200)}) — kiểm tra trên Seller Center trước khi tạo lại.`)
        throw new ToolError(loi)
    }
    await ctx.kho.ghiNhatKy({ action: 'campaign', status: 'succeeded', planId: plan.id, payload: { discount_name: d.name, discount_id: discountId }, response: { discount_id: discountId } })

    const items = d.lines.map((l: any) => ({ item_id: Number(l.itemId), purchase_limit: d.purchaseLimit, item_promotion_price: l.price }))
    let loi: { itemId: number; lyDo: string }[] = []
    try {
        loi = (await svc.addDiscountItems(discountId, items)).loi
    } catch (e: any) {
        loi = items.map((it: any) => ({ itemId: it.item_id, lyDo: String(e?.message || e).slice(0, 200) }))
    }
    const st = loi.length === 0 ? 'succeeded' : loi.length >= items.length ? 'failed' : 'partial'
    await ctx.kho.ghiNhatKy({ action: 'campaignItems', status: st, planId: plan.id, payload: { discount_name: d.name, discount_id: discountId, items: items.length }, response: { loi } })
    if (st === 'failed') {
        // Chương trình rỗng — dọn đi cho khỏi rác trên Seller Center (chưa bắt đầu nên xoá được)
        await svc.deleteDiscount(discountId).catch(() => { })
    }
    const theoItem = new Map(d.lines.map((l: any) => [Number(l.itemId), l.sku]))
    return {
        status: st,
        result: {
            discount_id: st === 'failed' ? undefined : discountId,
            ...(loi.length ? { message: `Shopee từ chối ${loi.length}/${items.length} mã: ${loi.map(x => `${theoItem.get(x.itemId) || x.itemId} (${x.lyDo})`).join('; ')}${st === 'failed' ? ' — đã xoá chương trình rỗng.' : ''}` } : {}),
        },
    }
}

// ─── Chu kỳ ─────────────────────────────────────────────────────────────────────

/** Quyết giá mới cho một listing đang bán. null = giữ nguyên. */
export function quyetDinhGia(o: { giaCu: number; ton: number; daBan14: number; kq: KetQuaGia; bienHienTaiPct: number; pol: ChinhSachPilot }): { gia: number; lyDo: string } | null {
    const { giaCu, kq, pol } = o
    if (!(giaCu > 0) || !(kq.giaSan > 0)) return null
    const mucTieuPct = pol.targetMarginRate * 100
    let mucTieu = 0, lyDo = ''
    if (giaCu < kq.giaSan) { mucTieu = kq.hopLe ? kq.giaDeXuat : kq.giaSan; lyDo = `Đang dưới giá sàn ${vnd(kq.giaSan)}` }
    else if (kq.hopLe && o.bienHienTaiPct < mucTieuPct - 0.5) { mucTieu = kq.giaDeXuat; lyDo = `Lãi ${o.bienHienTaiPct.toLocaleString('vi-VN')}% dưới mục tiêu ${mucTieuPct.toLocaleString('vi-VN')}%` }
    else if (kq.hopLe && o.daBan14 === 0 && o.ton > 0 && o.bienHienTaiPct > mucTieuPct + 10 && kq.giaDeXuat < giaCu) { mucTieu = kq.giaDeXuat; lyDo = '14 ngày không bán được, lãi cao hơn mục tiêu trên 10 điểm' }
    if (!mucTieu) return null
    const buoc = pol.priceStep, m = pol.maxPriceChangeRate
    let gia = mucTieu > giaCu
        ? Math.min(mucTieu, Math.floor((giaCu * (1 + m)) / buoc) * buoc)
        : Math.max(mucTieu, Math.ceil((giaCu * (1 - m)) / buoc) * buoc)
    if (gia < kq.giaSan) { gia = kq.giaSan; lyDo += ' (nâng thẳng lên giá sàn, vượt biên độ mỗi lần)' }
    if (Math.abs(gia - giaCu) < Math.max(1, buoc / 2)) return null
    return { gia, lyDo }
}

const TRAN_DOI_GIA_MOI_CHU_KY = 10

export async function chayChuKy(ctx: NgCanh): Promise<any> {
    const { cfg, ch } = await canGian(ctx)
    const pol = cfg.policy
    const tuDong = cfg.executionMode === 'auto'
    const results: any[] = []

    if (pol.automation.syncStock) {
        const { dayTonLenSan } = await import('./dayTonLenSan')
        if (tuDong) {
            try {
                await conLuotGhi(ctx, pol)
                const r = await dayTonLenSan(ctx.prisma, ch.id, {})
                const d = r.data || {}
                const st = !r.ok ? 'failed' : d.failed ? 'partial' : 'succeeded'
                const message = r.ok ? `Đẩy ${d.pushed} mã, giữ nguyên ${d.skipped}, lỗi ${d.failed}${d.errors?.length ? `: ${d.errors.slice(0, 3).join('; ')}` : ''}` : r.loi
                await ctx.kho.ghiNhatKy({ action: 'stock', status: st, planId: null, payload: { channel: ch.name }, response: { message } })
                results.push({ action: 'stock', status: st, message })
            } catch (e: any) {
                results.push({ action: 'stock', status: 'failed', message: String(e?.message || e).slice(0, 300) })
            }
        } else {
            const r = await dayTonLenSan(ctx.prisma, ch.id, { dryRun: true }).catch((e: any) => ({ ok: false, loi: String(e?.message || e) } as any))
            results.push({ action: 'stock', status: 'preview', message: r.ok ? `Xem trước: sẽ đẩy ${r.data?.seDay} mã, giữ nguyên ${r.data?.seBoQua}. Chưa gọi Shopee.` : r.loi })
        }
    }

    if (pol.automation.reprice) {
        const listing: any[] = await ctx.prisma.onlineProduct.findMany({ where: { channelId: ch.id, status: 'NORMAL' }, orderBy: { updatedAt: 'desc' }, take: 300 })
        const [von, daBan, mauPhi] = await Promise.all([giaVonHangLoat(ctx.prisma, listing), soBan14Ngay(ctx.prisma, ch.id), docMauPhi(ctx.prisma, ch)])
        let soDoi = 0
        for (const l of listing) {
            if (soDoi >= TRAN_DOI_GIA_MOI_CHU_KY) break
            const v = von.get(l.id)
            if (!v || !(v.giaVon > 0) || !(Number(l.price) > 0)) continue
            const ts = thamSoTinh(pol, v.giaVon, mauPhi)
            const kq = tinhGiaDeXuat(ts)
            const quyet = quyetDinhGia({
                giaCu: Number(l.price), ton: Number(l.stock) || 0, daBan14: daBan.get(String(l.sku || '').toLowerCase()) || 0,
                kq, bienHienTaiPct: danhGiaGia(Number(l.price), ts).bienPct, pol,
            })
            if (!quyet) continue
            soDoi++
            const sku = l.sku || v.sku
            const giaCu = Number(l.price)
            try {
                let plan: any = await taoKeHoachGia(ctx, { sku, price: quyet.gia, idempotencyKey: `cycle:price:${sku}:${ngayVN()}:${quyet.gia}` })
                if (tuDong && plan.status === 'draft') plan = await thucThi(ctx, plan.id)
                const p = plan.plan || plan
                results.push({ action: 'price', status: p.status, sku, planId: p.id, message: `${vnd(giaCu)} → ${vnd(quyet.gia)}: ${quyet.lyDo}${p.result?.message ? ` — ${p.result.message}` : ''}` })
            } catch (e: any) {
                results.push({ action: 'price', status: 'failed', sku, message: String(e?.message || e).slice(0, 300) })
            }
        }
        if (!soDoi) results.push({ action: 'price', status: 'unchanged', message: `Soát ${listing.length} sản phẩm đang bán: không mã nào cần đổi giá.` })
        else if (soDoi >= TRAN_DOI_GIA_MOI_CHU_KY) results.push({ action: 'price', status: 'skipped', message: `Mỗi chu kỳ đổi tối đa ${TRAN_DOI_GIA_MOI_CHU_KY} mã — chạy chu kỳ tiếp để soát phần còn lại.` })
    }

    if (pol.automation.publishNewProducts) {
        const uv = await timUngVien(ctx.prisma, ch.id, { lim: 50, chiDuDieuKien: true })
        results.push({
            action: 'publish', status: 'skipped',
            message: uv.ungVien.length
                ? `${uv.ungVien.length}${uv.ungVien.length >= 50 ? '+' : ''} mặt hàng kho đủ điều kiện chưa đăng. Đăng hàng mới cần chọn ngành Shopee + cân nặng thật: bấm "Đăng hàng" ở trang Sản phẩm, hoặc giao cho tác vụ AI (công cụ shopee_create_listing).`
                : 'Không còn mặt hàng kho đủ điều kiện (còn tồn, có giá vốn, có ảnh) mà chưa đăng.',
        })
    }
    if (pol.automation.campaign.enabled) {
        results.push({ action: 'campaign', status: 'skipped', message: 'Chu kỳ không tự tạo khuyến mãi — tạo ở trang Khuyến mãi để chọn mã, mức giảm và thời gian.' })
    }
    return { mode: 'live', executionMode: cfg.executionMode, results }
}

// ─── Trợ giúp form đăng hàng ────────────────────────────────────────────────────

export async function tuyChonDang(ctx: NgCanh, b: { sku: string; tuKhoa?: string }): Promise<any> {
    const { cfg, ch } = await canGian(ctx)
    const p = await timHangKho(ctx.prisma, b.sku)
    const svc = await moDichVuShopee(ctx.prisma, ch)
    const cay = await svc.getCategories('vi').catch(() => [] as any[])
    const theoId = new Map(cay.map((c: any) => [c.id, c]))
    let goiY: any[] = [], loi: string | undefined
    try {
        goiY = (await svc.categoryRecommend(String(b.tuKhoa || p.name))).map(id => ({ id, path: duongNganh(cay, id) || `Ngành ${id}`, leaf: theoId.has(id) ? !(theoId.get(id) as any).coCon : null }))
    } catch (e: any) { loi = String(e?.message || e).slice(0, 200) }
    if (b.tuKhoa) {
        const tk = String(b.tuKhoa).toLowerCase()
        for (const c of cay.filter((c: any) => !c.coCon)) {
            const path = duongNganh(cay, c.id)
            if (path.toLowerCase().includes(tk) && !goiY.some(g => g.id === c.id)) goiY.push({ id: c.id, path, leaf: true })
            if (goiY.length >= 20) break
        }
    }
    const mauPhi = await docMauPhi(ctx.prisma, ch)
    const ts = thamSoTinh(cfg.policy, Number(p.costPrice) || 0, mauPhi)
    return {
        sku: p.sku, title: p.name, description: p.description || '',
        categories: goiY.filter(g => g.leaf !== false),
        ...(loi ? { categoryError: loi } : {}),
        pricing: giaUi(tinhGiaDeXuat(ts), ts),
    }
}

export async function thuocTinhNganh(ctx: NgCanh, b: { categoryId: number }): Promise<any> {
    const { ch } = await canGian(ctx)
    const id = num(b.categoryId, 0)
    if (!(id > 0)) throw new ToolError('Chọn ngành hàng')
    const svc = await moDichVuShopee(ctx.prisma, ch)
    const tt = await svc.getCategoryAttributes(id, 'vi')
    let thuongHieu: any = { batBuoc: false, thuongHieu: [] }
    try { thuongHieu = await svc.getBrandList(id) } catch { /* không đọc được thì để No brand */ }
    return { categoryId: id, attributes: tt.filter(t => t.batBuoc), brand: thuongHieu }
}

export async function kiemKetNoi(ctx: NgCanh): Promise<any> {
    const { ch } = await canGian(ctx)
    const svc = await moDichVuShopee(ctx.prisma, ch)
    const kq = await svc.testConnection()
    const soListing = await ctx.prisma.onlineProduct.count({ where: { channelId: ch.id } })
    return { gian: ch.name, shopId: ch.shopId, ketNoi: kq, tokenHetHan: ch.tokenExpiresAt, soSanPhamTrongHeThong: soListing }
}

export async function luuCauHinh(ctx: NgCanh, b: any): Promise<CauHinhPilot> {
    const { cfg, kenh } = await docCauHinh(ctx)
    let channelId = cfg.channelId
    if (b?.channelId !== undefined) {
        if (b.channelId && !kenh.some(c => c.id === b.channelId)) throw new ToolError('Gian Shopee không thuộc cửa hàng này')
        channelId = b.channelId || null
    }
    const executionMode = b?.executionMode === 'auto' ? 'auto' : b?.executionMode === 'preview' ? 'preview' : cfg.executionMode
    const policy = chuanHoaChinhSach({ ...cfg.policy, ...(b?.policy || {}), automation: { ...cfg.policy.automation, ...(b?.policy?.automation || {}) } })
    const moi: CauHinhPilot = { channelId, executionMode, policy, updatedAt: Date.now() }
    await ctx.kho.luuCauHinh(moi)
    return moi
}

export const HUONG_DAN_PILOT = `SHOPEE PILOT TRÊN KENGI

Pilot giờ chạy trên máy chủ kengi, dữ liệu lấy thẳng từ kho của cửa hàng — không còn catalog.local.json, .env hay worker trên máy.

1. Kết nối
   - Mở https://api.kengi.vn/shopee-pilot/
   - Nhập mã cửa hàng và một API key quyền read,write (tạo ở kengi.vn → Trợ lý AI → Nối AI ngoài (MCP)).
   - Gian Shopee lấy từ Kênh bán online của kengi. Cửa hàng có nhiều gian thì chọn gian ở Tự động hóa → Sửa chính sách.

2. Sản phẩm
   - Gồm sản phẩm đang có trên gian + hàng trong kho còn tồn chưa đăng.
   - Giá vốn, tồn kho, mô tả, ảnh lấy từ kho kengi. Thiếu giá vốn hoặc ảnh thì không đăng được.

3. Định giá
   - Phí Shopee đo từ chính các đơn đã đối soát của gian (gian mới thì mượn số đo gian Shopee khác của cửa hàng).
   - Giá đề xuất = đạt lãi mục tiêu sau phí sàn, đóng gói, quảng cáo. Giá sàn = lãi tối thiểu. Máy chủ từ chối mọi giá dưới giá sàn.

4. Kế hoạch → thực thi
   - Mọi thao tác ghi tạo KẾ HOẠCH trước. Chế độ Xem trước: thực thi không gọi Shopee. Chế độ Tự động: thực thi ghi lên Shopee thật.
   - Giới hạn: đổi giá tối đa X% mỗi lần, số thao tác ghi mỗi ngày, mức giảm khuyến mãi tối đa, thời lượng chương trình.

5. Chu kỳ
   - Đồng bộ tồn (nếu bật), soát và đổi giá tối đa 10 mã mỗi chu kỳ, báo số hàng chưa đăng.
   - Đăng hàng mới cần ngành + cân nặng thật nên làm ở trang Sản phẩm, hoặc giao cho tác vụ AI (shopee_create_listing).
`
