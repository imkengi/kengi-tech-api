/* ═══════════════════════════════════════════════════════════════════════════════
 *  TIKTOK PILOT — định giá + đẩy tồn cho gian TikTok Shop, chạy TRÊN KENGI (02/11/2026)
 *
 *  Chủ shop (sau Shopee Pilot, Facebook Pilot): "Làm thêm tiktok pilot nhe". Cùng khuôn lib/shopeePilot.ts:
 *  mọi thao tác ghi đi qua KẾ HOẠCH (draft) → THỰC THI; chế độ 'preview' (mặc định) thì thực thi không gọi
 *  TikTok; lịch tự chạy TẮT mặc định; khoá idempotency; giành kế hoạch nguyên tử; trần ghi/ngày theo giờ VN.
 *  Dữ liệu lấy từ KHO THẬT + gian TikTok đã kết nối ở Kênh bán online:
 *    - giá vốn (lib/shopeeThaoTac.giaVonHangLoat — nối sẵn / cùng SKU / ánh xạ SKU / mã gộp), đã bán 14 ngày
 *    - PHÍ TIKTOK ĐO từ đơn đã đối soát (lib/shopeeTuQuan.docMauPhi — đơn TikTok cũng ghi netRevenue/platformFee
 *      từ đối soát tài chính) ⇒ cùng bộ tính giá đề xuất / giá sàn với Shopee Pilot (lib/giaShopee)
 *    - đẩy tồn đi đúng đường của nút "Đẩy tồn" (lib/dayTonLenSan, đã hỗ trợ TikTok)
 *  Rào máy chủ chặn (không trông vào giao diện):
 *    - giá dưới giá sàn (biên tối thiểu sau phí TikTok đo được, đóng gói, quảng cáo, affiliate, thuế GTGT khai)
 *    - đổi giá quá maxPriceChangeRate mỗi lần (trừ khi đang nâng lên giá sàn), so với giá ĐỌC THẲNG từ TikTok
 *    - CHỈ sản phẩm MỘT SKU: OnlineProduct của TikTok là một dòng / sản phẩm mang SKU + giá của SKU đầu, nên hàng
 *      nhiều phân loại không biết giá vốn từng SKU ⇒ không đổi giá (đọc getProductDetail lúc lập kế hoạch + lúc thực thi)
 *    - máy tự chạy (chu kỳ Tự động) KHÔNG hạ giá khi phí chưa đủ tin (lib/giaShopee.lyDoPhiChuaDuTin) — TĂNG giá vẫn
 *      tự làm, kế hoạch hạ giá để nháp chờ người duyệt
 *    - CHƯA BIẾT PHÍ sàn của gian (09/11/2026: chưa đủ đơn để đo, chưa khai phí — KHÔNG mượn số đo gian TikTok khác) ⇒
 *      không giá nào tính / ghi được; chu kỳ báo MỘT dòng kèm đường khai phí, không đọc TikTok
 *    - quá maxWritesPerDay lần ghi/ngày (tính cả lần hỏng)
 *  CHƯA làm: đăng sản phẩm mới lên TikTok, khuyến mãi — cần thử trên gian thật trước (ngành / thuộc tính / kho TikTok).
 * ═══════════════════════════════════════════════════════════════════════════════ */

import crypto from 'crypto'
import { ToolError } from './mcpTypes'
import { tinhGiaDeXuat, danhGiaGia, chanGiaDuoiSan, lyDoPhiChuaDuTin, lyDoChuaBietPhi, dongChuKyChuaBietPhi, SO_DON_TU_GHI, type ThamSoGia, type KetQuaGia, type MauPhi } from './giaShopee'
import { docMauPhiSanPham, docMauPhiTheoNganh, tomTatMauPhi, luuDanhMucSan } from './shopeeTuQuan'
import { num, giaVonHangLoat, soBan14Ngay, timUngVien, THIEU_MO_TA } from './shopeeThaoTac'
import { chuanHoaChinhSach, quyetDinhGia, vuotBienDong, dauNgayVN, dayTonChuKy, NGHI_DOI_GIA_MS } from './shopeePilot'
import { baoChuShop } from './pilotBaoChuShop'
import { TikTokService } from '../services/platforms/tiktok'

const docJson = (s: any, d: any = null) => { try { return s ? JSON.parse(s) : d } catch { return d } }
const kep = (v: any, d: number, min: number, max: number) => Math.min(Math.max(num(v, d), min), max)
const ngayVN = (now = Date.now()) => new Date(now + 7 * 3600_000).toISOString().slice(0, 10)
const vnd = (n: number) => `${Math.round(n).toLocaleString('vi-VN')}đ`

// ─── Chính sách ─────────────────────────────────────────────────────────────────

export interface ChinhSachTikTok {
    targetMarginRate: number
    minMarginRate: number
    maxPriceChangeRate: number
    maxWritesPerDay: number
    priceStep: number
    packagingCost: number
    adsRate: number
    /** hoa hồng affiliate (tỷ lệ giá bán) — CHỈ vào giá sàn: sàn tính như mọi đơn đều qua affiliate */
    affiliateRate: number
    /** thuế GTGT đầu ra trên giá bán (doanh nghiệp khấu trừ) */
    vatRate: number
    /** chu kỳ đổi giá tối đa bao nhiêu sản phẩm */
    maxRepricePerCycle: number
    automation: { reprice: boolean; syncStock: boolean }
}

/** Chuẩn hoá chính sách — phần chung kẹp đúng như Shopee Pilot (lib/shopeePilot.chuanHoaChinhSach), phần riêng ở đây. */
export function chuanHoaChinhSachTikTok(x: any): ChinhSachTikTok {
    const c = chuanHoaChinhSach(x)
    const tu = x?.automation || {}
    return {
        targetMarginRate: c.targetMarginRate, minMarginRate: c.minMarginRate, maxPriceChangeRate: c.maxPriceChangeRate,
        maxWritesPerDay: c.maxWritesPerDay, priceStep: c.priceStep, packagingCost: c.packagingCost, adsRate: c.adsRate,
        affiliateRate: c.affiliateRate, vatRate: c.vatRate,
        maxRepricePerCycle: Math.floor(kep(x?.maxRepricePerCycle, 10, 0, 50)),
        automation: {
            reprice: typeof tu.reprice === 'boolean' ? tu.reprice : true,
            syncStock: typeof tu.syncStock === 'boolean' ? tu.syncStock : false,
        },
    }
}
export const CHINH_SACH_TIKTOK_MAC_DINH: ChinhSachTikTok = chuanHoaChinhSachTikTok({})

/**
 * Chính sách TikTok Pilot của cửa hàng — đọc thẳng, KHÔNG tạo bảng hộ (cùng luật shopeePilot.docChinhSachPilot). Cho nút tay
 * "Đẩy giá lên sàn" (lib/dayGiaLenSan, 09/11/2026): giá sàn ở đó theo đúng biên chủ shop đã đặt cho Pilot.
 * Chưa từng dùng Pilot (chưa có bảng / chưa lưu) ⇒ mặc định. Đọc HỎNG vì lý do khác ⇒ ném lỗi: rơi về mặc định có thể LỎNG
 * hơn mức chủ shop đặt — rào an toàn không mở khi hỏng.
 */
export async function docChinhSachTikTok(prisma: any): Promise<ChinhSachTikTok> {
    let r: any
    try {
        [r] = await prisma.$queryRawUnsafe(`SELECT policy FROM "TikTokPilotConfig" WHERE id = 'default'`)
    } catch (e: any) {
        const loi = `${e?.message || e} ${JSON.stringify(e?.meta || {})}`
        if (/42P01|does not exist|không tồn tại/i.test(loi)) return chuanHoaChinhSachTikTok({})
        throw new ToolError('Không đọc được chính sách TikTok Pilot của cửa hàng — không ghi giá khi chưa biết giá sàn chủ shop đặt. Thử lại sau.')
    }
    return chuanHoaChinhSachTikTok(docJson(r?.policy, {}))
}

function thamSoTinh(p: ChinhSachTikTok, giaVon: number, phi: MauPhi): ThamSoGia {
    return {
        giaVon, phi,
        bienLoiNhuanPct: p.targetMarginRate * 100,
        bienToiThieuPct: p.minMarginRate * 100,
        phiDongGoi: p.packagingCost,
        phiQuangCaoPct: p.adsRate * 100,
        phiAffiliatePct: p.affiliateRate * 100,
        thueGtgtPct: p.vatRate * 100,
        lamTron: p.priceStep,
    }
}

export interface LichTikTok { enabled: boolean; intervalMinutes: number }
export const LICH_TIKTOK_MAC_DINH: LichTikTok = { enabled: false, intervalMinutes: 180 }
export function chuanHoaLichTikTok(x: any): LichTikTok {
    return { enabled: x?.enabled === true, intervalMinutes: Math.floor(kep(x?.intervalMinutes, LICH_TIKTOK_MAC_DINH.intervalMinutes, 30, 24 * 60)) }
}

export interface CauHinhTikTok {
    channelId: string | null
    executionMode: 'preview' | 'auto'
    policy: ChinhSachTikTok
    schedule: LichTikTok
    nextRunAt: number | null
    lastRunAt: number | null
    lastResult: any
    updatedAt: number
}

function cauHinhMacDinh(): CauHinhTikTok {
    return { channelId: null, executionMode: 'preview', policy: chuanHoaChinhSachTikTok({}), schedule: { ...LICH_TIKTOK_MAC_DINH }, nextRunAt: null, lastRunAt: null, lastResult: null, updatedAt: 0 }
}

// ─── Kho lưu ────────────────────────────────────────────────────────────────────

export interface KeHoachTikTok {
    id: string
    kind: 'price'
    status: string
    idempotencyKey: string | null
    data: any
    result: any
    createdBy: string | null
    createdAt: number
    updatedAt: number
}
export interface NhatKyTikTok { id: string; action: string; status: string; planId: string | null; payload: any; response: any; createdAt: number }

export interface KhoTikTokPilot {
    docCauHinh(): Promise<CauHinhTikTok | null>
    luuCauHinh(c: CauHinhTikTok): Promise<void>
    taoKeHoach(k: KeHoachTikTok): Promise<KeHoachTikTok>
    layKeHoach(id: string): Promise<KeHoachTikTok | null>
    /** draft → running, nguyên tử. false = bản khác đã giành / không còn là nháp. */
    gianhKeHoach(id: string): Promise<boolean>
    capNhatKeHoach(id: string, status: string, result: any): Promise<void>
    /** draft → cancelled. false = không còn là nháp. */
    huyKeHoach(id: string): Promise<boolean>
    dsKeHoach(lim: number): Promise<KeHoachTikTok[]>
    /** kế hoạch tạo từ mốc `tuLuc` — chu kỳ né sản phẩm nhiều SKU đã biết + kế hoạch đang chờ duyệt */
    dsKeHoachTu(tuLuc: number): Promise<KeHoachTikTok[]>
    ghiNhatKy(w: Omit<NhatKyTikTok, 'id' | 'createdAt'>): Promise<void>
    dsNhatKy(lim: number): Promise<NhatKyTikTok[]>
    demGhiTuLuc(ms: number): Promise<number>
    gianhLich(cu: number, moi: number): Promise<boolean>
    ghiKetQuaLich(luc: number, ketQua: any): Promise<void>
}

/** Ba bảng của TikTok Pilot — tạo lười lần đầu dùng (và trong /admin/migrate). Thời gian là epoch ms (BIGINT). */
export const SQL_TAO_BANG_TIKTOK_PILOT = [
    `CREATE TABLE IF NOT EXISTS "TikTokPilotConfig" (
        "id" TEXT NOT NULL, "channelId" TEXT, "executionMode" TEXT NOT NULL DEFAULT 'preview',
        "policy" TEXT NOT NULL DEFAULT '{}', "schedule" TEXT NOT NULL DEFAULT '{}',
        "nextRunAt" BIGINT, "lastRunAt" BIGINT, "lastResult" TEXT, "updatedAt" BIGINT NOT NULL DEFAULT 0,
        CONSTRAINT "TikTokPilotConfig_pkey" PRIMARY KEY ("id"))`,
    `CREATE TABLE IF NOT EXISTS "TikTokPilotPlan" (
        "id" TEXT NOT NULL, "kind" TEXT NOT NULL, "status" TEXT NOT NULL, "idempotencyKey" TEXT,
        "data" TEXT NOT NULL DEFAULT '{}', "result" TEXT, "createdBy" TEXT,
        "createdAt" BIGINT NOT NULL, "updatedAt" BIGINT NOT NULL,
        CONSTRAINT "TikTokPilotPlan_pkey" PRIMARY KEY ("id"))`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "TikTokPilotPlan_idempotencyKey_key" ON "TikTokPilotPlan"("idempotencyKey")`,
    `CREATE INDEX IF NOT EXISTS "TikTokPilotPlan_createdAt_idx" ON "TikTokPilotPlan"("createdAt")`,
    `CREATE TABLE IF NOT EXISTS "TikTokPilotWrite" (
        "id" TEXT NOT NULL, "action" TEXT NOT NULL, "status" TEXT NOT NULL, "planId" TEXT,
        "payload" TEXT NOT NULL DEFAULT '{}', "response" TEXT, "createdAt" BIGINT NOT NULL,
        CONSTRAINT "TikTokPilotWrite_pkey" PRIMARY KEY ("id"))`,
    `CREATE INDEX IF NOT EXISTS "TikTokPilotWrite_createdAt_idx" ON "TikTokPilotWrite"("createdAt")`,
]

const daTaoBang = new WeakSet<object>()
const COT_KH = `id, kind, status, "idempotencyKey", data, result, "createdBy", "createdAt"::float8 AS "createdAt", "updatedAt"::float8 AS "updatedAt"`
function hangKeHoach(r: any): KeHoachTikTok {
    return {
        id: r.id, kind: r.kind, status: r.status, idempotencyKey: r.idempotencyKey ?? null,
        data: docJson(r.data, {}), result: docJson(r.result, null), createdBy: r.createdBy ?? null,
        createdAt: Number(r.createdAt), updatedAt: Number(r.updatedAt),
    }
}

/** Kho lưu trên schema của cửa hàng (raw SQL — không phụ thuộc client Prisma sinh lại). */
export function khoSqlTikTok(prisma: any): KhoTikTokPilot {
    const chacBang = async () => {
        if (daTaoBang.has(prisma)) return
        for (const sql of SQL_TAO_BANG_TIKTOK_PILOT) await prisma.$executeRawUnsafe(sql)
        daTaoBang.add(prisma)
    }
    const q = async (sql: string, ...v: any[]) => { await chacBang(); return prisma.$queryRawUnsafe(sql, ...v) as Promise<any[]> }
    const x = async (sql: string, ...v: any[]) => { await chacBang(); return prisma.$executeRawUnsafe(sql, ...v) as Promise<number> }
    return {
        async docCauHinh() {
            const [r] = await q(`SELECT "channelId", "executionMode", policy, schedule, "updatedAt"::float8 AS "updatedAt",
                                        "nextRunAt"::float8 AS "nextRunAt", "lastRunAt"::float8 AS "lastRunAt", "lastResult"
                                   FROM "TikTokPilotConfig" WHERE id = 'default'`)
            if (!r) return null
            return {
                channelId: r.channelId ?? null, executionMode: r.executionMode === 'auto' ? 'auto' : 'preview',
                policy: chuanHoaChinhSachTikTok(docJson(r.policy, {})), schedule: chuanHoaLichTikTok(docJson(r.schedule, {})),
                nextRunAt: r.nextRunAt == null ? null : Number(r.nextRunAt), lastRunAt: r.lastRunAt == null ? null : Number(r.lastRunAt),
                lastResult: docJson(r.lastResult, null), updatedAt: Number(r.updatedAt) || 0,
            }
        },
        async luuCauHinh(c) {
            // KHÔNG ghi lastRunAt / lastResult ở đây — đó là việc của lượt chạy theo lịch (ghiKetQuaLich)
            await x(`INSERT INTO "TikTokPilotConfig" (id, "channelId", "executionMode", policy, schedule, "nextRunAt", "updatedAt")
                     VALUES ('default', $1, $2, $3, $4, $5, $6)
                     ON CONFLICT (id) DO UPDATE SET "channelId" = EXCLUDED."channelId", "executionMode" = EXCLUDED."executionMode",
                     policy = EXCLUDED.policy, schedule = EXCLUDED.schedule, "nextRunAt" = EXCLUDED."nextRunAt", "updatedAt" = EXCLUDED."updatedAt"`,
                c.channelId, c.executionMode, JSON.stringify(c.policy), JSON.stringify(c.schedule || LICH_TIKTOK_MAC_DINH), c.nextRunAt, Date.now())
        },
        async gianhLich(cu, moi) {
            return (await x(`UPDATE "TikTokPilotConfig" SET "nextRunAt" = $2 WHERE id = 'default' AND "nextRunAt" = $1`, cu, moi)) === 1
        },
        async ghiKetQuaLich(luc, ketQua) {
            await x(`UPDATE "TikTokPilotConfig" SET "lastRunAt" = $1, "lastResult" = $2 WHERE id = 'default'`, luc, JSON.stringify(ketQua).slice(0, 20000))
        },
        async taoKeHoach(k) {
            const rs = await q(`INSERT INTO "TikTokPilotPlan" (id, kind, status, "idempotencyKey", data, result, "createdBy", "createdAt", "updatedAt")
                                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT ("idempotencyKey") DO NOTHING RETURNING ${COT_KH}`,
                k.id, k.kind, k.status, k.idempotencyKey, JSON.stringify(k.data), k.result == null ? null : JSON.stringify(k.result), k.createdBy, k.createdAt, k.updatedAt)
            if (rs[0]) return hangKeHoach(rs[0])
            const [cu] = k.idempotencyKey ? await q(`SELECT ${COT_KH} FROM "TikTokPilotPlan" WHERE "idempotencyKey" = $1`, k.idempotencyKey) : []
            if (!cu) throw new Error('Không lưu được kế hoạch')
            return hangKeHoach(cu)
        },
        async layKeHoach(id) {
            const [r] = await q(`SELECT ${COT_KH} FROM "TikTokPilotPlan" WHERE id = $1`, id)
            return r ? hangKeHoach(r) : null
        },
        async gianhKeHoach(id) {
            return (await x(`UPDATE "TikTokPilotPlan" SET status = 'running', "updatedAt" = $2 WHERE id = $1 AND status = 'draft'`, id, Date.now())) === 1
        },
        async capNhatKeHoach(id, status, result) {
            await x(`UPDATE "TikTokPilotPlan" SET status = $2, result = $3, "updatedAt" = $4 WHERE id = $1`, id, status, result == null ? null : JSON.stringify(result), Date.now())
        },
        async huyKeHoach(id) {
            return (await x(`UPDATE "TikTokPilotPlan" SET status = 'cancelled', "updatedAt" = $2 WHERE id = $1 AND status = 'draft'`, id, Date.now())) === 1
        },
        async dsKeHoach(lim) {
            return (await q(`SELECT ${COT_KH} FROM "TikTokPilotPlan" ORDER BY "createdAt" DESC LIMIT $1`, lim)).map(hangKeHoach)
        },
        async dsKeHoachTu(tuLuc) {
            return (await q(`SELECT ${COT_KH} FROM "TikTokPilotPlan" WHERE "createdAt" >= $1 ORDER BY "createdAt" DESC LIMIT 2000`, tuLuc)).map(hangKeHoach)
        },
        async ghiNhatKy(w) {
            await x(`INSERT INTO "TikTokPilotWrite" (id, action, status, "planId", payload, response, "createdAt") VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                crypto.randomUUID(), w.action, w.status, w.planId, JSON.stringify(w.payload ?? {}), w.response == null ? null : JSON.stringify(w.response).slice(0, 20000), Date.now())
        },
        async dsNhatKy(lim) {
            const rs = await q(`SELECT id, action, status, "planId", payload, response, "createdAt"::float8 AS "createdAt" FROM "TikTokPilotWrite" ORDER BY "createdAt" DESC LIMIT $1`, lim)
            return rs.map(r => ({ id: r.id, action: r.action, status: r.status, planId: r.planId ?? null, payload: docJson(r.payload, {}), response: docJson(r.response, null), createdAt: Number(r.createdAt) }))
        },
        async demGhiTuLuc(ms) {
            const [r] = await q(`SELECT COUNT(*)::int AS n FROM "TikTokPilotWrite" WHERE "createdAt" >= $1`, ms)
            return Number(r?.n) || 0
        },
    }
}

/** Kho trong bộ nhớ — cho bộ kiểm (cùng hợp đồng với khoSqlTikTok). */
export function khoBoNhoTikTok(): KhoTikTokPilot & { _keHoach: KeHoachTikTok[]; _nhatKy: NhatKyTikTok[] } {
    let cfg: CauHinhTikTok | null = null
    const keHoach: KeHoachTikTok[] = []
    const nhatKy: NhatKyTikTok[] = []
    const sao = <T>(v: T): T => JSON.parse(JSON.stringify(v))
    return {
        _keHoach: keHoach, _nhatKy: nhatKy,
        async docCauHinh() { return cfg ? sao(cfg) : null },
        async luuCauHinh(c) { cfg = sao({ ...c, lastRunAt: cfg?.lastRunAt ?? null, lastResult: cfg?.lastResult ?? null, updatedAt: Date.now() }) },
        async gianhLich(cu, moi) { if (!cfg || cfg.nextRunAt !== cu) return false; cfg.nextRunAt = moi; return true },
        async ghiKetQuaLich(luc, ketQua) { if (cfg) { cfg.lastRunAt = luc; cfg.lastResult = sao(ketQua) } },
        async taoKeHoach(k) {
            const cu = k.idempotencyKey ? keHoach.find(x => x.idempotencyKey === k.idempotencyKey) : null
            if (cu) return sao(cu)
            keHoach.push(sao(k)); return sao(k)
        },
        async layKeHoach(id) { const k = keHoach.find(x => x.id === id); return k ? sao(k) : null },
        async gianhKeHoach(id) { const k = keHoach.find(x => x.id === id); if (!k || k.status !== 'draft') return false; k.status = 'running'; return true },
        async capNhatKeHoach(id, status, result) { const k = keHoach.find(x => x.id === id); if (k) { k.status = status; k.result = sao(result); k.updatedAt = Date.now() } },
        async huyKeHoach(id) { const k = keHoach.find(x => x.id === id); if (!k || k.status !== 'draft') return false; k.status = 'cancelled'; return true },
        async dsKeHoach(lim) { return sao([...keHoach].sort((a, b) => b.createdAt - a.createdAt).slice(0, lim)) },
        async dsKeHoachTu(tuLuc) { return sao(keHoach.filter(k => k.createdAt >= tuLuc)) },
        async ghiNhatKy(w) { nhatKy.push({ ...sao(w), id: crypto.randomUUID(), createdAt: Date.now() }) },
        async dsNhatKy(lim) { return sao([...nhatKy].sort((a, b) => b.createdAt - a.createdAt).slice(0, lim)) },
        async demGhiTuLuc(ms) { return nhatKy.filter(w => w.createdAt >= ms).length },
    }
}

// ─── Ngữ cảnh ───────────────────────────────────────────────────────────────────

/** Phần TikTokService Pilot dùng — bộ kiểm thay bằng TikTok giả ghi lại mọi lời gọi. */
export interface DichVuTikTok {
    testConnection(): Promise<{ success: boolean; shopName?: string; error?: string }>
    getProductDetail(productId: string): Promise<any>
    updatePrice(productId: string, price: number, skuId?: string, sellerSku?: string): Promise<void>
    getOrderSettlement(orderId: string): Promise<{ settlementAmount: number; feeAmount: number; revenueAmount: number } | null>
    /** danh mục gian (cùng đường nút "Đồng bộ") — chu kỳ tự làm mới khi bản lưu cũ; bộ kiểm không giả thì chu kỳ bỏ bước này */
    fetchProducts?(): Promise<{ products: any[]; total?: number }>
}

export interface KetQuaDayTonGon { ok: boolean; loi?: string; data?: any }

export interface NgCanhTikTok {
    prisma: any
    kho: KhoTikTokPilot
    nguoi?: string | null
    /** TikTok giả cho bộ kiểm; bỏ trống ⇒ TikTokService thật bằng token của gian (tự làm mới khi sắp hết hạn) */
    taoTikTok?: (ch: any) => Promise<DichVuTikTok>
    /** đẩy tồn giả cho bộ kiểm; bỏ trống ⇒ lib/dayTonLenSan */
    dayTon?: (prisma: any, channelId: string, o: { dryRun?: boolean }) => Promise<KetQuaDayTonGon>
    bayGio?: () => number
}

const luc = (ctx: NgCanhTikTok) => (ctx.bayGio ? ctx.bayGio() : Date.now())

/** TikTokService của gian — làm mới access token nếu còn < 5 phút (cùng luật tuTraLoiTikTok / chat.ts). */
export async function moDichVuTikTok(prisma: any, ch: any): Promise<DichVuTikTok> {
    const svc = new TikTokService({
        apiKey: ch.apiKey || '', apiSecret: ch.apiSecret || '', accessToken: ch.accessToken || '',
        refreshToken: ch.refreshToken || '', shopId: ch.shopId || '',
    } as any)
    if (ch.tokenExpiresAt && new Date(ch.tokenExpiresAt).getTime() < Date.now() + 5 * 60_000) {
        try {
            const t = await svc.refreshAccessToken()
            ;(svc as any).credentials.accessToken = t.accessToken
            ;(svc as any).credentials.refreshToken = t.refreshToken
            await prisma.onlineChannel.update({
                where: { id: ch.id },
                data: { accessToken: t.accessToken, refreshToken: t.refreshToken, tokenExpiresAt: new Date(Date.now() + t.expiresIn * 1000) },
            })
        } catch (e: any) {
            console.warn(`[TikTokPilot] làm mới token ${ch.name} hỏng:`, e?.message || e)
        }
    }
    return svc as unknown as DichVuTikTok
}

const dichVu = (ctx: NgCanhTikTok, ch: any) => (ctx.taoTikTok ? ctx.taoTikTok(ch) : moDichVuTikTok(ctx.prisma, ch))

async function dayTon(ctx: NgCanhTikTok, channelId: string, o: { dryRun?: boolean }): Promise<KetQuaDayTonGon> {
    if (ctx.dayTon) return ctx.dayTon(ctx.prisma, channelId, o)
    const { dayTonLenSan } = await import('./dayTonLenSan')
    return dayTonLenSan(ctx.prisma, channelId, o as any) as any
}

export async function docCauHinhTikTok(ctx: NgCanhTikTok): Promise<{ cfg: CauHinhTikTok; kenh: any[]; ch: any | null }> {
    const cfg = (await ctx.kho.docCauHinh()) || cauHinhMacDinh()
    const kenh: any[] = await ctx.prisma.onlineChannel.findMany({ where: { platform: 'tiktok' }, orderBy: { createdAt: 'asc' } })
    const ch = (cfg.channelId && kenh.find(c => c.id === cfg.channelId)) || (kenh.length === 1 ? kenh[0] : null)
    return { cfg, kenh, ch }
}

async function canGian(ctx: NgCanhTikTok) {
    const r = await docCauHinhTikTok(ctx)
    if (!r.ch) {
        throw new ToolError(r.kenh.length
            ? `Cửa hàng có ${r.kenh.length} gian TikTok — chọn gian cho Pilot ở Tự động hóa → Sửa chính sách.`
            : 'Cửa hàng chưa kết nối gian TikTok nào — kết nối ở Kênh bán online trên kengi.vn trước.')
    }
    if (!r.ch.accessToken || !r.ch.shopId) throw new ToolError(`Gian "${r.ch.name}" chưa uỷ quyền API TikTok.`)
    return r as { cfg: CauHinhTikTok; kenh: any[]; ch: any }
}

async function conLuotGhi(ctx: NgCanhTikTok, pol: ChinhSachTikTok) {
    const dem = await ctx.kho.demGhiTuLuc(dauNgayVN(luc(ctx)))
    if (dem >= pol.maxWritesPerDay) throw new ToolError(`Đã đạt giới hạn ${pol.maxWritesPerDay} thao tác ghi hôm nay theo chính sách — để mai hoặc nâng giới hạn.`)
}

/** Lỗi khi sản phẩm có nhiều SKU — chu kỳ nhớ để không hỏi lại TikTok mỗi lượt. */
export class LoiNhieuSku extends ToolError { constructor(msg: string, readonly soSku: number) { super(msg) } }

/** SKU DUY NHẤT của sản phẩm, đọc THẲNG từ TikTok (giá trong hệ thống có thể cũ). Nhiều SKU ⇒ LoiNhieuSku. */
export async function docSkuDuy(fb: DichVuTikTok, productId: string): Promise<{ skuId: string; sellerSku: string | null; gia: number }> {
    const d = await fb.getProductDetail(productId)
    const skus: any[] = Array.isArray(d?.skus) ? d.skus : []
    if (skus.length !== 1) {
        if (!skus.length) throw new ToolError('TikTok không trả SKU nào của sản phẩm này — không đọc được giá đang bán.')
        throw new LoiNhieuSku(`Sản phẩm có ${skus.length} phân loại (SKU) — Pilot chưa đổi giá hàng nhiều phân loại (chưa biết giá vốn từng phân loại); sửa giá trên TikTok Seller Center.`, skus.length)
    }
    const s = skus[0]
    const gia = Number(s?.price?.tax_exclusive_price ?? s?.price?.sale_price) || 0
    if (!s?.id) throw new ToolError('TikTok không trả mã SKU — không đổi giá được.')
    return { skuId: String(s.id), sellerSku: s.seller_sku ? String(s.seller_sku) : null, gia }
}

async function timListingTikTok(prisma: any, channelId: string, a: { itemId?: any; sku?: any }): Promise<any> {
    let l: any = null
    if (a?.itemId) l = await prisma.onlineProduct.findFirst({ where: { channelId, platformProductId: String(a.itemId) } })
    else if (a?.sku) l = await prisma.onlineProduct.findFirst({ where: { channelId, sku: { equals: String(a.sku), mode: 'insensitive' } } })
    else throw new ToolError('Cần mã sản phẩm TikTok hoặc SKU')
    if (!l) throw new ToolError('Không thấy sản phẩm này trên gian (bấm Đồng bộ sản phẩm ở Kênh bán online nếu vừa đăng ngoài hệ thống).')
    return l
}

/** Lời nhắc thuế theo loại hình khai ở Cài đặt cửa hàng (StoreSettings.businessType). */
async function nhacThue(prisma: any, pol: ChinhSachTikTok): Promise<string | null> {
    const s = await prisma.storeSettings?.findFirst?.({ select: { businessType: true } }).catch(() => null)
    const loai = String(s?.businessType || 'company')
    if (loai === 'company' && !(pol.vatRate > 0)) {
        return 'Cửa hàng khai là DOANH NGHIỆP: nếu nộp thuế GTGT theo phương pháp khấu trừ, nhập "Thuế GTGT trên giá bán" ở Sửa chính sách — ' +
            'tiền TikTok chuyển về không trừ thuế đầu ra, chưa khai thì biên lãi thật thấp hơn số Pilot tính.'
    }
    if (loai !== 'company' && pol.vatRate > 0) {
        return 'Cửa hàng khai là HỘ / CÁ NHÂN KINH DOANH: TikTok đã khấu trừ thuế ngay trong tiền về (nằm trong phí đo được) — ' +
            'thuế GTGT trong chính sách đang làm giá sàn cao hơn cần.'
    }
    return null
}

function giaUi(kq: KetQuaGia, ts: ThamSoGia, mauPhi?: MauPhi) {
    const dk = kq.duKien || (kq.giaDeXuat ? danhGiaGia(kq.giaDeXuat, ts) : null)
    const xau = kq.duKienAffiliate || (kq.giaDeXuat ? danhGiaGia(kq.giaDeXuat, ts, true) : null)
    const chuaTin = mauPhi && kq.hopLe ? lyDoPhiChuaDuTin(kq.giaDeXuat, mauPhi, ts.bienToiThieuPct) : null
    return {
        price: kq.hopLe ? kq.giaDeXuat : null,
        floor: kq.giaSan || null,
        breakEven: kq.giaHoaVon || null,
        profit: dk ? dk.loiNhuan : null,
        marginRate: dk ? dk.bienPct / 100 : null,
        affiliateProfit: xau && kq.thamSo.phiAffiliatePct ? xau.loiNhuan : null,
        affiliateMarginRate: xau && kq.thamSo.phiAffiliatePct ? xau.bienPct / 100 : null,
        ...(kq.hopLe ? {} : { reason: kq.lyDo }),
        ...(chuaTin ? { autoBlocked: chuaTin } : {}),
    }
}

// ─── Trạng thái cho giao diện (GET /state) ─────────────────────────────────────

const TRAN_LISTING = 150
/** Trạng thái TikTok coi là đang bán (bộ sản phẩm đồng bộ ghi nguyên status của TikTok) */
const DANG_BAN = ['ACTIVATE', 'LIVE']

export async function xayTrangThaiTikTok(ctx: NgCanhTikTok): Promise<any> {
    const now = luc(ctx)
    const { cfg, kenh, ch } = await docCauHinhTikTok(ctx)
    const pol = cfg.policy
    // TUẦN TỰ có chủ ý: pool Prisma của cửa hàng chỉ 1 kết nối trên prod
    const plans = await ctx.kho.dsKeHoach(60)
    const audit = await ctx.kho.dsNhatKy(100)
    const todayWrites = await ctx.kho.demGhiTuLuc(dauNgayVN(now))
    const thue = await nhacThue(ctx.prisma, pol)
    const channels = kenh.map(c => ({ id: c.id, name: c.name, shopId: c.shopId, authorized: !!(c.accessToken && c.shopId) }))
    const status: any = {
        executionMode: cfg.executionMode, policy: pol, channels,
        shop: ch ? { id: ch.id, name: ch.name, shopId: ch.shopId, authorized: !!(ch.accessToken && ch.shopId), tokenExpiresAt: ch.tokenExpiresAt ? new Date(ch.tokenExpiresAt).getTime() : null } : null,
        schedule: { ...cfg.schedule, nextRunAt: cfg.nextRunAt, lastRunAt: cfg.lastRunAt, lastResult: cfg.lastResult },
        ...(thue ? { taxNote: thue } : {}),
    }
    const goc = { now, todayWrites, plans, audit, status }
    if (!ch) {
        status.notice = kenh.length ? `Cửa hàng có ${kenh.length} gian TikTok — chọn một gian ở Tự động hóa → Sửa chính sách.` : 'Cửa hàng chưa kết nối gian TikTok nào.'
        return { ...goc, products: [], unlisted: [] }
    }
    const listing: any[] = await ctx.prisma.onlineProduct.findMany({ where: { channelId: ch.id }, orderBy: { updatedAt: 'desc' }, take: TRAN_LISTING })
    const von = await giaVonHangLoat(ctx.prisma, listing)
    const daBan = await soBan14Ngay(ctx.prisma, ch.id)
    // Phí THEO NGÀNH (02/11/2026: "mỗi ngành hàng lại 1 % phí khác nhau") — mỗi sản phẩm lấy mô hình đúng ngành của nó
    const bang = await docMauPhiTheoNganh(ctx.prisma, ch)
    const mauPhi = bang.toanGian
    const chuaTuGhi = mauPhi.nguon === 'cau-hinh-kenh' || !!mauPhi.khai || !!mauPhi.chuaBiet || !(mauPhi.soDon >= SO_DON_TU_GHI)
    const tomTatGian = tomTatMauPhi(mauPhi, bang)
    status.feeModel = {
        rate: mauPhi.tyLe, fixedPerOrder: mauPhi.coDinh, source: mauPhi.nguon, orders: mauPhi.soDon, note: mauPhi.ghiChu,
        trusted: !chuaTuGhi,
        // 09/11/2026: bỏ `borrowed` (không mượn số đo gian TikTok khác) — cùng bộ trường với Shopee Pilot: declared = phí KHAI,
        // unknown = CHƯA BIẾT PHÍ (không giá nào tính / ghi được), detail = câu nguồn phí hiện thẳng trên giao diện
        declared: !!mauPhi.khai, unknown: !!mauPhi.chuaBiet, scope: tomTatGian.scope, detail: tomTatGian.detail,
        autoFromPrice: chuaTuGhi ? null : mauPhi.nguon === 'ty-le-don' ? Math.ceil(mauPhi.giaBanTB || 0) : Math.ceil(mauPhi.giaBanMin || 0),
        ...(mauPhi.chuaBiet ? { warning: lyDoChuaBietPhi(mauPhi.soDon, ch.name) } : chuaTuGhi ? { warning: lyDoPhiChuaDuTin(0, mauPhi) } : {}),
        byCategory: [...bang.theoNganh.values()].sort((a, b) => b.soDon - a.soDon).slice(0, 30).map(m => tomTatMauPhi(m, bang)),
        // ngành có hàng trên gian mà chưa đủ đơn đo riêng — sản phẩm các ngành này dùng phí cả gian, máy không tự hạ giá
        unmeasuredCategories: [...bang.viDuNganh.keys()].filter(k => !bang.theoNganh.has(k)).length,
    }
    const nhieuSku = await maNhieuSkuGanDay(ctx, now)
    const products: any[] = listing.map(l => {
        const v = von.get(l.id)
        const giaVon = v && v.giaVon > 0 ? v.giaVon : 0
        const mp = bang.chon(l.categoryId)
        const ts = thamSoTinh(pol, giaVon, mp)
        const kq = tinhGiaDeXuat(ts)
        const dangBan = DANG_BAN.includes(String(l.status || '').toUpperCase())
        const soSku = nhieuSku.get(String(l.platformProductId))
        return {
            sku: l.sku || null, itemId: l.platformProductId, name: l.name, status: l.status, active: dangBan,
            imageUrl: l.imageUrl || null, costPrice: giaVon || null, currentPrice: Number(l.price) || null, stock: Number(l.stock) || 0,
            sold14: daBan.get(String(l.sku || '').toLowerCase()) || 0, mapped: !!v, localSku: v?.sku || null,
            enabled: giaVon > 0 && dangBan && !soSku,
            pricing: { ...giaUi(kq, ts, mp), fee: tomTatMauPhi(mp, bang), snapshot: { price: Number(l.price) || 0, stock: Number(l.stock) || 0 } },
            ...(soSku ? { error: `Sản phẩm có ${soSku} phân loại — Pilot chưa đổi giá hàng nhiều phân loại.` }
                : !v ? { error: 'Chưa nối với mã trong kho (SKU trên TikTok không khớp mã kho) — nối ở Sản Phẩm Trên Sàn để có giá vốn.' }
                    : !giaVon ? { error: 'Mã kho chưa có giá vốn — không tính được lãi, không đổi giá.' }
                        : !dangBan ? { error: `Đang ở trạng thái ${l.status} trên TikTok — chỉ đổi giá sản phẩm đang bán.` } : {}),
        }
    })
    const uv = await timUngVien(ctx.prisma, ch.id, { lim: 30 })
    const unlisted = uv.ungVien.map(u => ({
        sku: u.sku, name: u.ten, category: u.nhomHang || null, stock: u.tonBanDuoc, costPrice: u.giaVon || null, retailPrice: u.giaBanLe || null,
        imageUrl: u.anhDau, missing: u.thieu.filter(t => t !== THIEU_MO_TA),
    }))
    return {
        ...goc, products, unlisted,
        catalogNote: `${listing.length >= TRAN_LISTING ? `${TRAN_LISTING} sản phẩm mới cập nhật nhất` : `${listing.length} sản phẩm trên gian`} · ${uv.ungVien.length}${uv.ungVien.length >= 30 ? '+' : ''} mặt hàng kho còn tồn chưa có trên gian`
            + (listing.length === 0 ? ' · Gian chưa có sản phẩm nào trong hệ thống — bấm Đồng bộ sản phẩm ở Kênh bán online trước.' : ''),
    }
}

/** Sản phẩm đã biết nhiều SKU trong 24 giờ qua (kế hoạch 'skipped' có nhieuSku) — chu kỳ khỏi hỏi lại TikTok. */
async function maNhieuSkuGanDay(ctx: NgCanhTikTok, now: number): Promise<Map<string, number>> {
    const ra = new Map<string, number>()
    for (const k of await ctx.kho.dsKeHoachTu(now - 24 * 3600_000)) {
        if (k.status === 'skipped' && Number(k.data?.nhieuSku) > 1 && k.data?.itemId) ra.set(String(k.data.itemId), Number(k.data.nhieuSku))
    }
    return ra
}

// ─── Kế hoạch ───────────────────────────────────────────────────────────────────

function keHoachMoi(data: any, khoa: string | null | undefined, nguoi: string | null | undefined, now: number, status = 'draft'): KeHoachTikTok {
    return { id: crypto.randomUUID(), kind: 'price', status, idempotencyKey: khoa ? String(khoa).slice(0, 200) : null, data, result: null, createdBy: nguoi ?? null, createdAt: now, updatedAt: now }
}

/** Kế hoạch đổi giá MỘT sản phẩm (theo mã TikTok hoặc SKU). Giá dưới sàn / vượt biên độ / nhiều SKU ⇒ từ chối. */
export async function taoKeHoachGiaTikTok(ctx: NgCanhTikTok, b: { itemId?: string; sku?: string; price: number; idempotencyKey?: string }): Promise<KeHoachTikTok> {
    const now = luc(ctx)
    const { cfg, ch } = await canGian(ctx)
    const gia = Math.round(num(b.price, 0))
    if (!(gia > 0)) throw new ToolError('Giá mới không hợp lệ')
    const l = await timListingTikTok(ctx.prisma, ch.id, { itemId: b.itemId, sku: b.sku })
    const v = (await giaVonHangLoat(ctx.prisma, [l])).get(l.id)
    if (!v || !(v.giaVon > 0)) throw new ToolError(`${l.sku || l.platformProductId} chưa có giá vốn trong kho — không đổi giá khi không biết lãi/lỗ.`)
    const mauPhi = await docMauPhiSanPham(ctx.prisma, ch, l.categoryId)   // phí ĐÚNG ngành của sản phẩm
    const ts = thamSoTinh(cfg.policy, v.giaVon, mauPhi)
    const kq = tinhGiaDeXuat(ts)
    // Không tính được giá sàn (CHƯA BIẾT PHÍ sàn của gian, biên + phí ≥ 100%…) ⇒ không giá nào qua được chanGiaDuoiSan — nói ngay,
    // khỏi đọc TikTok cho một kế hoạch chắc chắn không lập được (09/11/2026)
    if (!kq.hopLe && !(kq.giaSan > 0)) throw new ToolError(mauPhi.chuaBiet ? lyDoChuaBietPhi(mauPhi.soDon, ch.name) : kq.lyDo || 'Không tính được giá sàn')
    // Giá đang bán + SKU: đọc THẲNG TikTok — hàng nhiều phân loại dừng ở đây
    const song = await docSkuDuy(await dichVu(ctx, ch), String(l.platformProductId))
    const giaCu = song.gia || Number(l.price) || 0
    const chan = chanGiaDuoiSan(gia, kq) || vuotBienDong(giaCu, gia, cfg.policy.maxPriceChangeRate, kq.giaSan)
    if (chan) throw new ToolError(chan)
    const dk = danhGiaGia(gia, ts), xau = danhGiaGia(gia, ts, true)
    const phiChuaTin = lyDoPhiChuaDuTin(gia, mauPhi, cfg.policy.minMarginRate * 100)
    return ctx.kho.taoKeHoach(keHoachMoi({
        sku: l.sku || song.sellerSku || null, itemId: String(l.platformProductId), skuId: song.skuId, name: l.name, price: gia,
        snapshot: { price: giaCu, stock: Number(l.stock) || 0 },
        economics: {
            marginRate: dk.bienPct / 100, profit: dk.loiNhuan, floor: kq.giaSan, suggested: kq.hopLe ? kq.giaDeXuat : null, cost: v.giaVon,
            fee: tomTatMauPhi(mauPhi),
            ...(kq.thamSo.phiAffiliatePct > 0 ? { affiliateProfit: xau.loiNhuan, affiliateMarginRate: xau.bienPct / 100 } : {}),
        },
        ...(phiChuaTin ? { feeWarning: phiChuaTin } : {}),
    }, b.idempotencyKey, ctx.nguoi, now))
}

export async function huyKeHoachTikTok(ctx: NgCanhTikTok, id: string): Promise<KeHoachTikTok> {
    if (!(await ctx.kho.huyKeHoach(String(id || '')))) throw new ToolError('Kế hoạch không còn là bản nháp — không huỷ được.')
    return (await ctx.kho.layKeHoach(String(id)))!
}

/** Lỗi mạng sau khi đã gửi: không biết TikTok đã nhận chưa ⇒ 'uncertain'. */
function laLoiMang(e: any): boolean {
    return !(e instanceof ToolError) && /fetch failed|network|ECONNRESET|ETIMEDOUT|socket|aborted|EAI_AGAIN|timeout/i.test(String(e?.message || e))
}

export async function thucThiTikTok(ctx: NgCanhTikTok, planId: string, tuyChon: { tuDong?: boolean } = {}): Promise<any> {
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
        result = await doiGiaTikTok(ctx, ch, d, cfg.policy, tuyChon.tuDong === true)
        await ctx.kho.ghiNhatKy({ action: 'price', status, planId: plan.id, payload: { sku: d.sku, itemId: d.itemId, price: d.price }, response: result })
    } catch (e: any) {
        status = laLoiMang(e) ? 'uncertain' : 'failed'
        result = { message: String(e?.message || e).slice(0, 800) }
        if (status === 'uncertain') result.message = `Mất kết nối giữa chừng — không rõ TikTok đã nhận giá mới chưa. Kiểm tra trên Seller Center trước khi lập lại. (${result.message})`
        await ctx.kho.ghiNhatKy({ action: 'price', status, planId: plan.id, payload: { sku: d.sku, itemId: d.itemId, price: d.price }, response: result }).catch(() => { })
        if (!(e instanceof ToolError)) console.error(`[TikTokPilot] thực thi ${plan.id} lỗi:`, e?.message || e)
    }
    await ctx.kho.capNhatKeHoach(plan.id, status, result)
    return (await ctx.kho.layKeHoach(plan.id)) || { ...plan, status, result }
}

/** Ghi giá lên TikTok — soát lại với giá vốn / phí / chính sách / giá đang bán HIỆN TẠI (kế hoạch có thể lập từ trước). */
async function doiGiaTikTok(ctx: NgCanhTikTok, ch: any, d: any, pol: ChinhSachTikTok, tuDong: boolean): Promise<any> {
    const l = await timListingTikTok(ctx.prisma, ch.id, { itemId: d.itemId })
    const v = (await giaVonHangLoat(ctx.prisma, [l])).get(l.id)
    if (!v || !(v.giaVon > 0)) throw new ToolError(`${l.sku || l.platformProductId} thiếu giá vốn — không đổi giá khi không biết lãi/lỗ.`)
    const gia = Math.round(Number(d.price) || 0)
    const mauPhi = await docMauPhiSanPham(ctx.prisma, ch, l.categoryId)
    const kq = tinhGiaDeXuat(thamSoTinh(pol, v.giaVon, mauPhi))
    const chan = chanGiaDuoiSan(gia, kq)
    if (chan) throw new ToolError(`Giá vốn / phí / chính sách đã đổi từ lúc lập kế hoạch: ${chan}`)
    const fb = await dichVu(ctx, ch)
    const song = await docSkuDuy(fb, String(l.platformProductId))
    if (d.skuId && String(d.skuId) !== song.skuId) throw new ToolError('SKU của sản phẩm trên TikTok đã đổi từ lúc lập kế hoạch — lập lại kế hoạch.')
    const loiBien = vuotBienDong(song.gia, gia, pol.maxPriceChangeRate, kq.giaSan)
    if (loiBien) throw new ToolError(`Giá trên TikTok đã đổi từ lúc lập kế hoạch. ${loiBien}`)
    // Máy tự chạy + phí chưa đủ tin ⇒ chỉ được TĂNG giá (lãi mỗi đơn tăng theo giá, không bao giờ lỗ thêm)
    const phiChuaTin = tuDong ? lyDoPhiChuaDuTin(gia, mauPhi, pol.minMarginRate * 100) : null
    if (phiChuaTin && !(gia > song.gia)) throw new ToolError(`Không tự hạ giá: ${phiChuaTin}`)
    await fb.updatePrice(String(l.platformProductId), gia, song.skuId)
    await ctx.prisma.onlineProduct.update({ where: { id: l.id }, data: { price: gia } }).catch(() => { })
    console.log(`[TikTokPilot] ĐỔI GIÁ ${l.sku || l.platformProductId} (${ch.name}) ${song.gia} → ${gia}`)
    return {
        item_id: String(l.platformProductId), sku_id: song.skuId, old_price: song.gia, new_price: gia,
        ...(phiChuaTin ? { warning: `Chỉ được TĂNG giá vì phí TikTok chưa đủ tin — giá sàn có thể còn thấp, xem lại trên TikTok Pilot. ${phiChuaTin}` } : {}),
    }
}

// ─── Chu kỳ ─────────────────────────────────────────────────────────────────────

/** Nháp CHỜ NGƯỜI DUYỆT mới tối đa mỗi chu kỳ — nháp không ăn trần đổi giá (03/11/2026: mười nháp hạ giá lặp lại mỗi lượt
 *  chiếm trọn 10 chỗ ⇒ 57 mã lãi cao 14 ngày không bán của KENGISTORE không bao giờ được xét). */
const TRAN_NHAP_MOI_CHU_KY = 20
const HAN_NHAP_MS = 3 * 86400_000
const KET_THUC_THI_MS = 3600_000
const TUOI_DANH_MUC_MS = 2 * 3600_000

/**
 * Kế hoạch còn mở (03/11/2026): 'running' quá 1 giờ ⇒ 'uncertain' (máy chết giữa lượt ghi — báo chủ shop kiểm Seller Center);
 * nháp máy lập quá 3 ngày, hoặc nháp của lượt Xem trước khi đã sang Tự động ⇒ huỷ. Trả mã sản phẩm đang có nháp chờ duyệt.
 */
async function donKeHoachMoTikTok(ctx: NgCanhTikTok, tuDong: boolean, results: any[], now: number): Promise<Set<string>> {
    const choDuyet = new Set<string>()
    let soHuy = 0
    for (const k of await ctx.kho.dsKeHoachTu(now - 30 * 86400_000)) {
        // người huỷ (14 ngày) ⇒ né; máy tự huỷ (quá hạn / Xem trước) thì lượt sau được lập lại
        if (k.status === 'cancelled') { if (!k.result?.tuHuy && now - k.updatedAt < 14 * 86400_000 && k.data?.itemId) choDuyet.add(String(k.data.itemId)); continue }
        if (k.status === 'running') {
            if (now - k.updatedAt > KET_THUC_THI_MS) {
                const message = 'Lượt thực thi dừng giữa chừng (máy chủ khởi động lại?) — không rõ TikTok đã nhận giá mới chưa. Kiểm trên Seller Center rồi lập lại nếu cần.'
                await ctx.kho.capNhatKeHoach(k.id, 'uncertain', { message })
                results.push({ action: 'price', status: 'uncertain', sku: k.data?.sku || k.data?.itemId, planId: k.id, message })
            }
            continue
        }
        if (k.status !== 'draft') continue
        if (String(k.idempotencyKey || '').startsWith('cycle:')) {
            const quaHan = now - k.createdAt > HAN_NHAP_MS
            const canDuyet = !!k.data?.feeWarning && !(Number(k.data?.price) > Number(k.data?.snapshot?.price))
            if (quaHan || (tuDong && !canDuyet)) {
                if (await ctx.kho.huyKeHoach(k.id)) {
                    await ctx.kho.capNhatKeHoach(k.id, 'cancelled', { tuHuy: true, message: quaHan ? 'Nháp máy lập quá 3 ngày chưa duyệt — tự huỷ.' : 'Nháp của lượt Xem trước — chế độ Tự động lập lại theo giá hiện tại.' })
                    soHuy++
                }
                continue
            }
        }
        if (k.data?.itemId) choDuyet.add(String(k.data.itemId))
    }
    if (soHuy) results.push({ action: 'plan', status: 'skipped', message: `Huỷ ${soHuy} nháp cũ của máy (quá 3 ngày chưa duyệt / còn từ lượt Xem trước).` })
    return choDuyet
}

/** Danh mục cũ hơn 2 giờ ⇒ đồng bộ lại (cùng đường ghi với nút "Đồng bộ"). Dịch vụ không có fetchProducts (bộ kiểm) ⇒ bỏ qua. */
async function lamMoiDanhMucTikTok(ctx: NgCanhTikTok, ch: any, now: number): Promise<any | null> {
    const moi = await ctx.prisma.onlineProduct.findFirst({ where: { channelId: ch.id, syncedAt: { not: null } }, orderBy: { syncedAt: 'desc' }, select: { syncedAt: true } }).catch(() => null)
    const t = moi?.syncedAt ? new Date(moi.syncedAt).getTime() : 0
    if (now - t < TUOI_DANH_MUC_MS) return null
    try {
        const fb = await dichVu(ctx, ch)
        if (typeof fb.fetchProducts !== 'function') return null
        const { products } = await fb.fetchProducts()
        if (!products?.length) return { action: 'catalog', status: 'failed', message: 'TikTok trả danh mục rỗng — giữ bản cũ (kiểm uỷ quyền API của gian).' }
        const n = await luuDanhMucSan(ctx.prisma, ch, products)
        return { action: 'catalog', status: 'succeeded', message: `Đồng bộ lại ${n} sản phẩm từ TikTok (bản trước: ${t ? new Date(t + 7 * 3600_000).toISOString().slice(0, 16).replace('T', ' ') : 'chưa có'}).` }
    } catch (e: any) {
        return { action: 'catalog', status: 'failed', message: `Không đồng bộ được danh mục từ TikTok: ${String(e?.message || e).slice(0, 200)}` }
    }
}

export async function chayChuKyTikTok(ctx: NgCanhTikTok): Promise<any> {
    const now = luc(ctx)
    const { cfg, ch } = await canGian(ctx)
    const pol = cfg.policy
    const tuDong = cfg.executionMode === 'auto'
    const results: any[] = []
    const moNhap = await donKeHoachMoTikTok(ctx, tuDong, results, now)
    const danhMuc = await lamMoiDanhMucTikTok(ctx, ch, now)
    if (danhMuc) results.push(danhMuc)

    if (pol.automation.syncStock) {
        // chạy thử trước — cầu dao (lib/dayTonLenSan.cauDaoTon, đếm trên toàn bộ listing) nhảy thì không đẩy
        results.push(await dayTonChuKy({ tuDong, san: 'TikTok', gian: ch.name, day: o => dayTon(ctx, ch.id, o), conLuot: () => conLuotGhi(ctx, pol), ghi: w => ctx.kho.ghiNhatKy(w) }))
    }

    /* CHƯA BIẾT PHÍ sàn của gian (09/11/2026, chủ shop: "xem phí phải ghi rõ ra không thể mượn được"): gian chưa đủ đơn đối soát
     * để đo phí, chưa khai phí ⇒ không giá nào tính / ghi được. Không đổi giá, báo MỘT dòng — khỏi soát từng mã rồi im lặng
     * "không mã nào cần đổi giá" (quyetDinhGia bỏ qua mã không có giá sàn), khỏi đọc TikTok vô ích. Đẩy tồn vẫn chạy. */
    const bangPhiGian = pol.automation.reprice && pol.maxRepricePerCycle > 0 ? await docMauPhiTheoNganh(ctx.prisma, ch) : null
    const chuaBietPhi = !!bangPhiGian?.toanGian.chuaBiet && !bangPhiGian.theoNganh.size
    if (chuaBietPhi) results.push({ action: 'cycle', status: 'skipped', message: dongChuKyChuaBietPhi(bangPhiGian!.toanGian.soDon, ch.name, 'chưa đổi giá mã nào') })

    if (bangPhiGian && !chuaBietPhi) {
        const listing: any[] = await ctx.prisma.onlineProduct.findMany({ where: { channelId: ch.id, status: { in: DANG_BAN } }, orderBy: { updatedAt: 'desc' }, take: 300 })
        const von = await giaVonHangLoat(ctx.prisma, listing)
        const daBan = await soBan14Ngay(ctx.prisma, ch.id)
        const bangPhi = bangPhiGian
        const nhieuSku = await maNhieuSkuGanDay(ctx, now)
        const polS = chuanHoaChinhSach(pol)
        let soChoDuyet = 0, soVuaDoi = 0, soChuaBietPhi = 0
        // máy đổi giá cùng mã cách nhau ≥ 24 giờ (lib/shopeePilot.NGHI_DOI_GIA_MS) — trừ mã đang dưới giá sàn
        const vuaDoi = new Set((await ctx.kho.dsKeHoachTu(now - NGHI_DOI_GIA_MS)).filter(k => k.status === 'succeeded' && now - k.updatedAt < NGHI_DOI_GIA_MS).map(k => String(k.data?.itemId)))
        const uv: { l: any; mauPhi: MauPhi; giaCu: number; quyet: { gia: number; lyDo: string }; uu: number }[] = []
        for (const l of listing) {
            const id = String(l.platformProductId)
            if (nhieuSku.has(id)) continue
            if (moNhap.has(id)) { soChoDuyet++; continue }
            const v = von.get(l.id)
            if (!v || !(v.giaVon > 0) || !(Number(l.price) > 0)) continue
            const mauPhi = bangPhi.chon(l.categoryId)   // phí ĐÚNG ngành — mỗi ngành TikTok thu một khác
            // chưa biết phí (ngành chưa đo trong gian chưa khai phí) ⇒ quyetDinhGia sẽ im lặng "giữ nguyên" — đếm ra để nói
            if (mauPhi.chuaBiet) { soChuaBietPhi++; continue }
            const ts = thamSoTinh(pol, v.giaVon, mauPhi)
            const kq = tinhGiaDeXuat(ts)
            const giaCu = Number(l.price)
            const quyet = quyetDinhGia({
                giaCu, ton: Number(l.stock) || 0, daBan14: daBan.get(String(l.sku || '').toLowerCase()) || 0,
                kq, bienHienTaiPct: danhGiaGia(giaCu, ts).bienPct, pol: polS,
            })
            if (!quyet) continue
            const uu = giaCu < kq.giaSan ? 0 : quyet.gia > giaCu ? 1 : 2
            if (uu > 0 && vuaDoi.has(id)) { soVuaDoi++; continue }
            uv.push({ l, mauPhi, giaCu, quyet, uu })
        }
        // đang dưới giá sàn (lỗ / sát lỗ qua affiliate) trước, rồi tăng, hạ giá sau cùng
        uv.sort((a, b) => a.uu - b.uu)
        const tran = pol.maxRepricePerCycle
        let soGhi = 0, soNhap = 0, soNhieuSku = 0, soHoi = 0
        for (const u of uv) {
            if (soGhi >= tran || soHoi >= tran * 3 + TRAN_NHAP_MOI_CHU_KY) break
            const id = String(u.l.platformProductId)
            // Phí chưa đủ tin ⇒ máy KHÔNG tự HẠ giá: để nháp chờ người duyệt. TĂNG giá thì được.
            const duKien = tuDong ? lyDoPhiChuaDuTin(u.quyet.gia, u.mauPhi, pol.minMarginRate * 100) : null
            if (duKien && !(u.quyet.gia > u.giaCu) && soNhap >= TRAN_NHAP_MOI_CHU_KY) continue
            soHoi++
            try {
                let plan: any = await taoKeHoachGiaTikTok(ctx, { itemId: id, price: u.quyet.gia, idempotencyKey: `${tuDong ? 'cycle' : 'cycle:xem'}:price:${id}:${ngayVN(now)}:${u.quyet.gia}` })
                if (plan.status !== 'draft') continue   // cùng khoá trong ngày đã thực thi / hỏng — đã báo ở lượt đó
                const chuaTin = tuDong ? lyDoPhiChuaDuTin(u.quyet.gia, u.mauPhi, pol.minMarginRate * 100) : null
                const choDuyet = chuaTin && !(u.quyet.gia > (Number(plan.data?.snapshot?.price) || u.giaCu)) ? chuaTin : null
                if (tuDong && !choDuyet) { plan = await thucThiTikTok(ctx, plan.id, { tuDong: true }); soGhi++ }
                else if (choDuyet) soNhap++
                else soGhi++   // Xem trước: nháp thay cho lần ghi
                const p = plan.plan || plan
                results.push({
                    action: 'price', status: p.status, sku: u.l.sku || u.l.platformProductId, planId: p.id,
                    message: `${vnd(Number(p.data?.snapshot?.price) || u.giaCu)} → ${vnd(u.quyet.gia)}: ${u.quyet.lyDo}${p.result?.message ? ` — ${p.result.message}` : ''}${p.result?.warning ? ` — ${p.result.warning}` : ''}${choDuyet ? ` — CHỜ NGƯỜI DUYỆT: ${choDuyet}` : ''}`,
                })
            } catch (e: any) {
                if (e instanceof LoiNhieuSku) {
                    soNhieuSku++
                    // nhớ 24 giờ để các lượt sau khỏi hỏi lại TikTok sản phẩm này
                    await ctx.kho.taoKeHoach(keHoachMoi({ itemId: id, sku: u.l.sku || null, name: u.l.name, nhieuSku: e.soSku },
                        `skip:nhieu-sku:${id}:${ngayVN(now)}`, ctx.nguoi, now, 'skipped')).catch(() => { })
                    continue
                }
                soGhi++   // lỗi lập kế hoạch cũng tính một lượt — chu kỳ không quay mãi trên mã hỏng
                results.push({ action: 'price', status: 'failed', sku: u.l.sku || u.l.platformProductId, message: String(e?.message || e).slice(0, 300) })
            }
        }
        if (soNhieuSku) results.push({ action: 'price', status: 'skipped', message: `${soNhieuSku} sản phẩm nhiều phân loại — Pilot chưa đổi giá hàng nhiều phân loại, sửa trên TikTok Seller Center.` })
        if (soVuaDoi) results.push({ action: 'price', status: 'skipped', message: `${soVuaDoi} sản phẩm vừa đổi giá trong 24 giờ — chờ xem đơn rồi mới đổi tiếp.` })
        if (soChoDuyet) results.push({ action: 'price', status: 'skipped', message: `${soChoDuyet} sản phẩm đang có nháp chờ duyệt / người vừa huỷ — duyệt hoặc huỷ trên TikTok Pilot (nháp máy lập tự huỷ sau 3 ngày, mã người huỷ thì 14 ngày không đề xuất lại).` })
        if (soChuaBietPhi) results.push({ action: 'price', status: 'skipped', message: `${soChuaBietPhi} sản phẩm CHƯA BIẾT PHÍ sàn (ngành chưa đủ đơn để đo, gian chưa khai phí) — không tính được giá. Khai phí sàn của gian ở Kênh bán online.` })
        // mã chưa biết phí thì không biết có cần đổi hay không — đừng nói "không mã nào cần đổi giá"
        if (!soGhi && !soNhap && !soNhieuSku && !soChuaBietPhi) results.push({ action: 'price', status: 'unchanged', message: `Soát ${listing.length} sản phẩm đang bán: không mã nào cần đổi giá.` })
        else if (soGhi >= tran && uv.length > soGhi + soNhap + soNhieuSku) results.push({ action: 'price', status: 'skipped', message: `Mỗi chu kỳ đổi tối đa ${tran} sản phẩm — còn ${uv.length - soGhi - soNhap - soNhieuSku} sản phẩm chờ chu kỳ sau.` })
    }
    if (!results.length) results.push({ action: 'cycle', status: 'unchanged', message: 'Chính sách đang tắt cả đổi giá lẫn đẩy tồn.' })
    return { executionMode: cfg.executionMode, results }
}

// ─── Kiểm tra kết nối (chỉ đọc) ─────────────────────────────────────────────────

export async function kiemKetNoiTikTok(ctx: NgCanhTikTok): Promise<any> {
    const now = luc(ctx)
    const { ch } = await canGian(ctx)
    const fb = await dichVu(ctx, ch)
    const buoc: { ten: string; ok: boolean; chiTiet: string }[] = []
    const thu = async (ten: string, f: () => Promise<string>) => {
        try { buoc.push({ ten, ok: true, chiTiet: await f() }) } catch (e: any) { buoc.push({ ten, ok: false, chiTiet: String(e?.message || e).slice(0, 300) }) }
    }
    await thu('Thông tin gian (authorization/shops)', async () => { const r = await fb.testConnection(); if (!r.success) throw new Error(r.error || 'không rõ'); return r.shopName || 'OK' })
    const mau = await ctx.prisma.onlineProduct.findFirst({ where: { channelId: ch.id, status: { in: DANG_BAN } }, orderBy: { updatedAt: 'desc' } }).catch(() => null)
    if (mau) {
        await thu(`Chi tiết sản phẩm (products/${mau.platformProductId})`, async () => {
            const d = await fb.getProductDetail(String(mau.platformProductId))
            const skus: any[] = d?.skus || []
            return `${skus.length} SKU · giá ${skus.map(s => vnd(Number(s?.price?.tax_exclusive_price ?? s?.price?.sale_price) || 0)).slice(0, 3).join(', ')}`
        })
    } else buoc.push({ ten: 'Chi tiết sản phẩm', ok: false, chiTiet: 'Gian chưa có sản phẩm đang bán trong hệ thống — bấm Đồng bộ sản phẩm ở Kênh bán online.' })
    const don = await ctx.prisma.onlineOrder.findFirst({
        where: { channelId: ch.id, createdAt: { lte: new Date(now - 7 * 86400_000) } }, orderBy: { createdAt: 'desc' }, select: { externalOrderId: true },
    }).catch(() => null)
    if (don?.externalOrderId) {
        await thu('Đối soát tài chính (finance statement_transactions)', async () => {
            const s = await fb.getOrderSettlement(String(don.externalOrderId))
            if (!s) return 'Đơn chưa có đối soát (bình thường với đơn mới) — đọc được API tài chính.'
            return `Thực nhận ${vnd(s.settlementAmount)} · phí ${vnd(s.feeAmount)}`
        })
    } else buoc.push({ ten: 'Đối soát tài chính', ok: true, chiTiet: 'Chưa có đơn cũ hơn 7 ngày để thử.' })
    const het = ch.tokenExpiresAt ? new Date(ch.tokenExpiresAt).getTime() : null
    buoc.push({ ten: 'Token API', ok: !!ch.accessToken, chiTiet: het ? `access token tới ${new Date(het + 7 * 3600_000).toISOString().slice(0, 16).replace('T', ' ')} (giờ VN) — Kengi tự làm mới bằng refresh token` : 'không ghi hạn' })
    const soListing = await ctx.prisma.onlineProduct.count({ where: { channelId: ch.id } }).catch(() => 0)
    return { gian: ch.name, shopId: ch.shopId, soSanPhamTrongHeThong: soListing, dat: buoc.filter(x => x.ok).length, tong: buoc.length, buoc }
}

// ─── Cấu hình ───────────────────────────────────────────────────────────────────

export async function luuCauHinhTikTok(ctx: NgCanhTikTok, b: any): Promise<CauHinhTikTok> {
    const { cfg, kenh } = await docCauHinhTikTok(ctx)
    let channelId = cfg.channelId
    if (b?.channelId !== undefined) {
        if (b.channelId && !kenh.some(c => c.id === b.channelId)) throw new ToolError('Gian TikTok không thuộc cửa hàng này')
        channelId = b.channelId || null
    }
    const executionMode = b?.executionMode === 'auto' ? 'auto' : b?.executionMode === 'preview' ? 'preview' : cfg.executionMode
    const policy = chuanHoaChinhSachTikTok({ ...cfg.policy, ...(b?.policy || {}), automation: { ...cfg.policy.automation, ...(b?.policy?.automation || {}) } })
    const schedule = b?.schedule ? chuanHoaLichTikTok({ ...cfg.schedule, ...b.schedule }) : cfg.schedule
    const doiLich = schedule.enabled !== cfg.schedule.enabled || schedule.intervalMinutes !== cfg.schedule.intervalMinutes
    const nextRunAt = !schedule.enabled ? null : (!doiLich && cfg.nextRunAt) ? cfg.nextRunAt : luc(ctx) + schedule.intervalMinutes * 60_000
    const moi: CauHinhTikTok = { ...cfg, channelId, executionMode, policy, schedule, nextRunAt, updatedAt: Date.now() }
    await ctx.kho.luuCauHinh(moi)
    return moi
}

// ─── Chạy theo lịch (gọi từ cron/aiAgentCron) ───────────────────────────────────

/** Chạy MỘT chu kỳ nếu tới hẹn. Chưa từng dùng Pilot ⇒ bảng không có ⇒ 'khong-dung' (KHÔNG tạo bảng hộ). */
export async function chayTheoLichTikTok(prisma: any, kho?: KhoTikTokPilot, ngoai: Partial<NgCanhTikTok> = {}): Promise<'khong-dung' | 'chua-toi' | 'bi-gianh' | 'da-chay' | 'loi'> {
    const now = ngoai.bayGio ? ngoai.bayGio() : Date.now()
    let den: number, lich: LichTikTok
    if (kho) {
        const c = await kho.docCauHinh()
        if (!c || c.nextRunAt == null) return 'khong-dung'
        den = c.nextRunAt; lich = c.schedule
    } else {
        let r: any
        try {
            [r] = await prisma.$queryRawUnsafe(`SELECT "nextRunAt"::float8 AS "nextRunAt", schedule FROM "TikTokPilotConfig" WHERE id = 'default'`)
        } catch {
            return 'khong-dung'
        }
        if (!r || r.nextRunAt == null) return 'khong-dung'
        den = Number(r.nextRunAt); lich = chuanHoaLichTikTok(docJson(r.schedule, {}))
    }
    if (!lich.enabled) return 'khong-dung'
    if (den > now) return 'chua-toi'
    const k = kho || khoSqlTikTok(prisma)
    if (!(await k.gianhLich(den, now + lich.intervalMinutes * 60_000))) return 'bi-gianh'
    const truoc = (await k.docCauHinh().catch(() => null))?.lastResult?.baoChuShop
    let ketQua: any
    try {
        const kq = await chayChuKyTikTok({ ...ngoai, prisma, kho: k, nguoi: 'lich' })
        ketQua = { ok: true, executionMode: kq.executionMode, results: kq.results }
    } catch (e: any) {
        ketQua = { ok: false, message: String(e?.message || e).slice(0, 500) }
    }
    // Xem trước chưa ghi gì lên sàn — chỉ chu kỳ gãy mới báo; Tự động thì báo mọi việc cần người (lib/pilotBaoChuShop)
    const bao = ketQua.ok && ketQua.executionMode !== 'auto' ? truoc : await baoChuShop(prisma, 'TikTok Pilot', ketQua, truoc, now).catch(() => truoc)
    await k.ghiKetQuaLich(now, { ...ketQua, ...(bao ? { baoChuShop: bao } : {}) }).catch(() => { })
    return ketQua.ok ? 'da-chay' : 'loi'
}

export const HUONG_DAN_TIKTOK_PILOT = `TIKTOK PILOT TRÊN KENGI

Pilot chạy trên máy chủ Kengi, dữ liệu lấy thẳng từ kho của cửa hàng và đơn TikTok đã đối soát.

1. Kết nối
   - Mở kengi.vn → Bán Hàng Online → TikTok Pilot (https://kengi.vn/pilot-tiktok/), đăng nhập bằng tài khoản Kengi.
   - Gian TikTok lấy từ Kênh bán online của Kengi (đã uỷ quyền API). Cửa hàng có nhiều gian thì chọn gian ở Tự động hóa → Sửa chính sách.
   - Lập kế hoạch, thực thi, đổi chính sách chỉ quản lý / chủ cửa hàng.

2. Sản phẩm
   - Gồm sản phẩm đang có trên gian (đồng bộ ở Kênh bán online) + hàng trong kho còn tồn chưa có trên gian.
   - Giá vốn lấy từ mã kho đã nối (SKU trùng mã kho, ánh xạ SKU, mã gộp). Chưa nối thì không có giá vốn, không đổi giá.

3. Định giá
   - Phí TikTok đo từ chính các đơn đã đối soát của gian — KHÔNG lấy số đo của gian khác (gian khác nhau, ngành hàng khác
     nhau thì phí khác nhau). Mỗi chỗ hiện phí đều ghi rõ nguồn: đo từ bao nhiêu đơn, của ngành nào / cả gian, hay số khai.
   - Gian chưa đủ 8 đơn đã đối soát: dùng phí sàn chủ shop KHAI cho gian ở Kênh bán online (Đơn Hàng Online → nút «Kênh bán
     hàng» → nút «Key» ở dòng của gian → ô «Phí sàn (%)») — người duyệt được, máy không tự hạ giá theo số khai.
     Ô phí còn để mặc định 6% (chưa khai) thì CHƯA BIẾT PHÍ: không tính được giá, không đổi được giá nào cho tới khi khai phí;
     chu kỳ báo một dòng kèm đường khai phí.
   - Giá đề xuất = đạt lãi mục tiêu sau phí TikTok, đóng gói, quảng cáo, thuế GTGT (nếu khai). Giá sàn = lãi tối thiểu NGAY CẢ KHI
     đơn đi qua affiliate (cộng trọn "Hoa hồng affiliate"). Máy chủ từ chối mọi giá dưới giá sàn.
   - Chỉ đổi giá sản phẩm MỘT phân loại: Pilot đọc thẳng TikTok giá đang bán và mã SKU lúc lập kế hoạch và lúc thực thi.
     Hàng nhiều phân loại sửa giá trên TikTok Seller Center.
   - Máy (chu kỳ Tự động) chỉ tự HẠ giá khi phí đã đo từ ≥ 30 đơn đối soát và đủ chắc ở mức giá đó. TĂNG giá thì máy vẫn tự làm.

4. Kế hoạch → thực thi
   - Mọi thao tác ghi tạo KẾ HOẠCH trước. Chế độ Xem trước: thực thi không gọi TikTok. Chế độ Tự động: thực thi ghi lên TikTok thật.
   - Giới hạn: đổi giá tối đa X% mỗi lần, số thao tác ghi mỗi ngày, số sản phẩm đổi giá mỗi chu kỳ.

5. Chu kỳ
   - Đẩy tồn từ kho Kengi lên gian (nếu bật — cùng đường nút "Đẩy tồn"), soát và đổi giá tối đa N sản phẩm.
   - Chạy theo lịch: bật ở Sửa chính sách (mỗi 30–1440 phút), máy chủ tự chạy, không cần mở trang.
   - Mỗi sản phẩm máy đổi giá tối đa 1 lần / 24 giờ (trừ hàng đang dưới giá sàn); hàng đang lỗ được xét trước.
   - Danh mục trong hệ thống cũ hơn 2 giờ thì chu kỳ tự đồng bộ lại. Đẩy tồn có cầu dao: nhiều mã đang có hàng sẽ về 0 ⇒ không đẩy.
   - Nháp chờ duyệt không chiếm lượt đổi giá; máy lập tự huỷ sau 3 ngày; Huỷ = 14 ngày không đề xuất lại.
     Có việc cần người (nháp chờ duyệt, ghi hỏng, cầu dao, chưa biết phí): chuông + app báo một lần mỗi khi danh sách đổi.

6. Chưa làm
   - Đăng sản phẩm mới lên TikTok và tạo khuyến mãi — cần thử trên gian thật trước (ngành hàng, thuộc tính, kho của TikTok).
`
