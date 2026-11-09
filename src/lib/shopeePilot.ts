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
 *      mã vừa TĂNG giá trong promotionCooldownHoursAfterIncrease giờ; lúc THỰC THI soát lại
 *      từng dòng với giá vốn / phí / chính sách HIỆN TẠI (kế hoạch cũ không lọt giá dưới sàn)
 *    - giá sàn tính như mọi đơn đều qua affiliate (affiliateRate) và trừ thuế GTGT đầu ra (vatRate)
 *    - máy tự chạy (chu kỳ Tự động) KHÔNG đăng mới / hạ giá khi phí sàn chưa đủ tin (lib/giaShopee.lyDoPhiChuaDuTin):
 *      kế hoạch để nháp chờ người duyệt. TĂNG giá thì vẫn tự làm — lãi mỗi đơn tăng theo giá, không bao giờ lỗ thêm
 *    - CHƯA BIẾT PHÍ sàn của gian (09/11/2026: chưa đủ đơn để đo, chưa khai phí — không mượn số đo gian khác) ⇒ không
 *      giá nào tính / ghi được, người lẫn máy; chu kỳ báo MỘT dòng kèm đường khai phí (lib/giaShopee.dongChuKyChuaBietPhi)
 *    - khoá idempotency từ giao diện: bấm hai lần không ra hai kế hoạch; thực thi giành
 *      kế hoạch nguyên tử (draft → running) nên hai tab không chạy đúp.
 * ═══════════════════════════════════════════════════════════════════════════════ */

import crypto from 'crypto'
import { ToolError } from './mcpTypes'
import { tinhGiaDeXuat, danhGiaGia, chanGiaDuoiSan, lyDoPhiChuaDuTin, lyDoChuaBietPhi, dongChuKyChuaBietPhi, SO_DON_TU_GHI, type ThamSoGia, type KetQuaGia, type MauPhi } from './giaShopee'
import { moDichVuShopee, docMauPhiSanPham, docMauPhiTheoNganh, tomTatMauPhi, timHangKho, duongNganh, luuDanhMucSan } from './shopeeTuQuan'
import {
    num, giaVonHangLoat, soBan14Ngay, timUngVien, dangSanPhamShopee, doiGiaShopee, timListing, LoiKhongRo, THIEU_MO_TA,
    chinhSachGia, giaSongShopee, maDangKhuyenMai, type ChinhSachGia, type GiaSongShopee,
} from './shopeeThaoTac'
import { baoChuShop } from './pilotBaoChuShop'
import { cauDaoTon } from './dayTonLenSan'

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
    /** hoa hồng affiliate, tỷ lệ giá bán — CHỈ vào giá sàn: sàn tính như mọi đơn đều qua affiliate (01/11/2026) */
    affiliateRate: number
    /** thuế suất GTGT đầu ra (doanh nghiệp khấu trừ) — 0 với hộ kinh doanh vì Shopee đã khấu trừ trong tiền về */
    vatRate: number
    promotionCooldownHoursAfterIncrease: number
    /** chu kỳ tự đăng tối đa bao nhiêu mặt hàng (chỉ hàng có hồ sơ đăng) */
    maxPublishPerCycle: number
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
    affiliateRate: 0,
    vatRate: 0,
    promotionCooldownHoursAfterIncrease: 24,
    maxPublishPerCycle: 3,
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
        affiliateRate: kep(x?.affiliateRate, m.affiliateRate, 0, 0.5),
        vatRate: kep(x?.vatRate, m.vatRate, 0, 0.1),
        promotionCooldownHoursAfterIncrease: kep(x?.promotionCooldownHoursAfterIncrease, m.promotionCooldownHoursAfterIncrease, 0, 24 * 30),
        maxPublishPerCycle: Math.floor(kep(x?.maxPublishPerCycle, m.maxPublishPerCycle, 0, 20)),
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
        hoa_hong_affiliate: p.affiliateRate * 100,
        thue_gtgt: p.vatRate * 100,
        lam_tron: p.priceStep,
    }
}

/** Chính sách Pilot làm `nen` cho thao tác ghi (lib/shopeeThaoTac): tham số truyền vào chỉ được chặt hơn. */
export function nenGia(p: ChinhSachPilot): ChinhSachGia {
    return chinhSachGia(thamSoGia(p))
}

/**
 * Chính sách Pilot của cửa hàng cho tool AI (routes/mcpShopeeTools) — đọc thẳng, KHÔNG tạo bảng hộ.
 * Chưa từng dùng Pilot (chưa có bảng / chưa lưu) ⇒ mặc định (đúng mức tool vẫn dùng: mục tiêu 15%, sàn 5%).
 * Đọc HỎNG vì lý do khác ⇒ ném lỗi: rơi về mặc định có thể LỎNG hơn mức chủ shop đặt — rào an toàn không mở khi hỏng.
 */
export async function docChinhSachPilot(prisma: any): Promise<ChinhSachPilot> {
    let r: any
    try {
        [r] = await prisma.$queryRawUnsafe(`SELECT policy FROM "ShopeePilotConfig" WHERE id = 'default'`)
    } catch (e: any) {
        const loi = `${e?.message || e} ${JSON.stringify(e?.meta || {})}`
        if (/42P01|does not exist|không tồn tại/i.test(loi)) return chuanHoaChinhSach({})
        throw new ToolError('Không đọc được chính sách Shopee Pilot của cửa hàng — không ghi giá khi chưa biết giá sàn chủ shop đặt. Thử lại sau.')
    }
    return chuanHoaChinhSach(docJson(r?.policy, {}))
}

/** Chính sách → tham số tính giá (lib/giaShopee). Chỉ đọc các trường giá — chính sách TikTok Pilot cùng tên trường; nút tay
 *  "Đẩy giá lên sàn" (lib/dayGiaLenSan, 09/11/2026) dùng chung để giá sàn ở đó đúng bằng giá sàn Pilot tính. */
export function thamSoTinh(p: Pick<ChinhSachPilot, 'targetMarginRate' | 'minMarginRate' | 'packagingCost' | 'adsRate' | 'affiliateRate' | 'vatRate' | 'priceStep'>, giaVon: number, phi: MauPhi): ThamSoGia {
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

/**
 * HỒ SƠ ĐĂNG HÀNG (01/11/2026): kho Kengi không có ngành Shopee, cân nặng, thuộc tính — chủ shop khai
 * MỘT lần cho cả NHÓM HÀNG (theo tên nhóm trong kho) hoặc cho MỘT MÃ; chu kỳ dùng hồ sơ để tự đăng.
 * Hồ sơ theo mã thắng hồ sơ theo nhóm.
 */
export interface HoSoDang {
    id: string
    scope: 'nhom' | 'sku'
    key: string
    categoryId: number
    categoryPath?: string
    weightGram: number
    attributes: { attribute_id: number; value_id?: number; gia_tri?: string; don_vi?: string }[]
    brandId?: number
    brandName?: string
    hidden?: boolean
    updatedAt?: number
}

/** `allChannels` (03/11/2026): lượt theo lịch chạy chu kỳ cho MỌI gian Shopee của cửa hàng (cùng chính sách) —
 *  trước chỉ chạy được gian đang chọn, cửa hàng ba gian thì hai gian không bao giờ tự động. */
export interface LichPilot { enabled: boolean; intervalMinutes: number; allChannels?: boolean }

export interface CauHinhPilot {
    channelId: string | null
    executionMode: 'preview' | 'auto'
    policy: ChinhSachPilot
    updatedAt: number
    profiles: HoSoDang[]
    schedule: LichPilot
    nextRunAt: number | null
    lastRunAt: number | null
    lastResult: any
}

export const LICH_MAC_DINH: LichPilot = { enabled: false, intervalMinutes: 180 }

export function chuanHoaLich(x: any): LichPilot {
    return {
        enabled: x?.enabled === true, intervalMinutes: Math.floor(kep(x?.intervalMinutes, LICH_MAC_DINH.intervalMinutes, 30, 24 * 60)),
        ...(x?.allChannels === true ? { allChannels: true } : {}),
    }
}

/** Chuẩn hoá một hồ sơ người gửi lên. Ném ToolError nếu thiếu thứ bắt buộc. */
export function chuanHoaHoSo(x: any): HoSoDang {
    const scope = x?.scope === 'sku' ? 'sku' : 'nhom'
    const key = String(x?.key || '').trim()
    if (!key) throw new ToolError(scope === 'sku' ? 'Nhập mã hàng cho hồ sơ' : 'Chọn nhóm hàng cho hồ sơ')
    const categoryId = Math.floor(num(x?.categoryId, 0))
    if (!(categoryId > 0)) throw new ToolError('Chọn ngành hàng Shopee cho hồ sơ')
    const weightGram = Math.round(num(x?.weightGram, 0))
    if (!(weightGram > 0) || weightGram > 300000) throw new ToolError('Cân nặng đã đóng gói phải là số gram thật (> 0)')
    const attributes = (Array.isArray(x?.attributes) ? x.attributes : [])
        .map((a: any) => ({
            attribute_id: Math.floor(num(a?.attribute_id, 0)),
            ...(num(a?.value_id, 0) > 0 ? { value_id: Math.floor(num(a.value_id, 0)) } : {}),
            ...(String(a?.gia_tri ?? '').trim() ? { gia_tri: String(a.gia_tri).trim().slice(0, 200) } : {}),
            ...(a?.don_vi ? { don_vi: String(a.don_vi).slice(0, 20) } : {}),
        }))
        .filter((a: any) => a.attribute_id > 0 && (a.value_id || a.gia_tri))
    return {
        id: String(x?.id || crypto.randomUUID()),
        scope, key: key.slice(0, 120), categoryId,
        ...(x?.categoryPath ? { categoryPath: String(x.categoryPath).slice(0, 300) } : {}),
        weightGram, attributes,
        ...(num(x?.brandId, 0) > 0 ? { brandId: Math.floor(num(x.brandId, 0)), brandName: String(x?.brandName || '').slice(0, 100) } : {}),
        hidden: x?.hidden === true,
        updatedAt: Date.now(),
    }
}

/** Hồ sơ áp cho một mặt hàng: theo mã trước, rồi theo nhóm (so tên không phân biệt hoa thường). */
export function timHoSo(profiles: HoSoDang[], sku: string, nhom?: string | null): HoSoDang | null {
    const t = (v: any) => String(v || '').trim().toLowerCase()
    return profiles.find(h => h.scope === 'sku' && t(h.key) === t(sku))
        || (nhom ? profiles.find(h => h.scope === 'nhom' && t(h.key) === t(nhom)) : undefined)
        || null
}

function cauHinhMacDinh(): CauHinhPilot {
    return { channelId: null, executionMode: 'preview', policy: chuanHoaChinhSach({}), updatedAt: 0, profiles: [], schedule: { ...LICH_MAC_DINH }, nextRunAt: null, lastRunAt: null, lastResult: null }
}

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
    /** kế hoạch còn MỞ (nháp chờ duyệt / đang chạy) + kế hoạch huỷ từ mốc `huyTuLuc` — chu kỳ né mã đang chờ duyệt / người
     *  vừa huỷ, huỷ nháp quá hạn, bắt lượt kẹt */
    dsKeHoachMo(huyTuLuc: number): Promise<KeHoach[]>
    /** draft → cancelled (kèm result), nguyên tử. false = không còn là nháp. */
    huyKeHoach(id: string, result: any): Promise<boolean>
    ghiNhatKy(w: Omit<NhatKy, 'id' | 'createdAt'>): Promise<void>
    dsNhatKy(lim: number): Promise<NhatKy[]>
    demGhiTuLuc(ms: number): Promise<number>
    /** Lần gần nhất (ms) đổi giá TĂNG thành công cho SKU này qua Pilot, null nếu chưa có. */
    lanTangGiaCuoi(sku: string): Promise<number | null>
    /** Giành lượt chạy theo lịch: dời nextRunAt từ `cu` sang `moi` — chỉ một bản máy giành được. */
    gianhLich(cu: number, moi: number): Promise<boolean>
    ghiKetQuaLich(luc: number, ketQua: any): Promise<void>
}

const docJson = (s: any, d: any = null) => { try { return s ? JSON.parse(s) : d } catch { return d } }

/** Ba bảng của Pilot — tạo lười lần đầu dùng (và trong /admin/migrate). Cột thời gian là epoch ms (BIGINT)
 *  để khỏi lệch múi giờ giữa timestamp không múi giờ của Prisma và giờ phiên Postgres. */
export const SQL_TAO_BANG_PILOT = [
    `CREATE TABLE IF NOT EXISTS "ShopeePilotConfig" (
        "id" TEXT NOT NULL, "channelId" TEXT, "executionMode" TEXT NOT NULL DEFAULT 'preview',
        "policy" TEXT NOT NULL DEFAULT '{}', "updatedAt" BIGINT NOT NULL DEFAULT 0,
        CONSTRAINT "ShopeePilotConfig_pkey" PRIMARY KEY ("id"))`,
    `ALTER TABLE "ShopeePilotConfig" ADD COLUMN IF NOT EXISTS "profiles" TEXT NOT NULL DEFAULT '[]'`,
    `ALTER TABLE "ShopeePilotConfig" ADD COLUMN IF NOT EXISTS "schedule" TEXT NOT NULL DEFAULT '{}'`,
    `ALTER TABLE "ShopeePilotConfig" ADD COLUMN IF NOT EXISTS "nextRunAt" BIGINT`,
    `ALTER TABLE "ShopeePilotConfig" ADD COLUMN IF NOT EXISTS "lastRunAt" BIGINT`,
    `ALTER TABLE "ShopeePilotConfig" ADD COLUMN IF NOT EXISTS "lastResult" TEXT`,
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
            const [r] = await q(`SELECT "channelId", "executionMode", policy, profiles, schedule, "updatedAt"::float8 AS "updatedAt",
                                        "nextRunAt"::float8 AS "nextRunAt", "lastRunAt"::float8 AS "lastRunAt", "lastResult"
                                   FROM "ShopeePilotConfig" WHERE id = 'default'`)
            if (!r) return null
            const hs = docJson(r.profiles, [])
            return {
                channelId: r.channelId ?? null, executionMode: r.executionMode === 'auto' ? 'auto' : 'preview',
                policy: chuanHoaChinhSach(docJson(r.policy, {})), updatedAt: Number(r.updatedAt) || 0,
                profiles: Array.isArray(hs) ? hs : [], schedule: chuanHoaLich(docJson(r.schedule, {})),
                nextRunAt: r.nextRunAt == null ? null : Number(r.nextRunAt), lastRunAt: r.lastRunAt == null ? null : Number(r.lastRunAt),
                lastResult: docJson(r.lastResult, null),
            }
        },
        async luuCauHinh(c) {
            // KHÔNG ghi lastRunAt / lastResult ở đây — đó là việc của lượt chạy theo lịch (ghiKetQuaLich)
            await x(`INSERT INTO "ShopeePilotConfig" (id, "channelId", "executionMode", policy, profiles, schedule, "nextRunAt", "updatedAt")
                     VALUES ('default', $1, $2, $3, $4, $5, $6, $7)
                     ON CONFLICT (id) DO UPDATE SET "channelId" = EXCLUDED."channelId", "executionMode" = EXCLUDED."executionMode",
                     policy = EXCLUDED.policy, profiles = EXCLUDED.profiles, schedule = EXCLUDED.schedule,
                     "nextRunAt" = EXCLUDED."nextRunAt", "updatedAt" = EXCLUDED."updatedAt"`,
                c.channelId, c.executionMode, JSON.stringify(c.policy), JSON.stringify(c.profiles || []), JSON.stringify(c.schedule || LICH_MAC_DINH), c.nextRunAt, Date.now())
        },
        async gianhLich(cu, moi) {
            return (await x(`UPDATE "ShopeePilotConfig" SET "nextRunAt" = $2 WHERE id = 'default' AND "nextRunAt" = $1`, cu, moi)) === 1
        },
        async ghiKetQuaLich(luc, ketQua) {
            await x(`UPDATE "ShopeePilotConfig" SET "lastRunAt" = $1, "lastResult" = $2 WHERE id = 'default'`, luc, JSON.stringify(ketQua).slice(0, 20000))
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
        async dsKeHoachMo(huyTuLuc) {
            return (await q(`SELECT ${COT_KH} FROM "ShopeePilotPlan" WHERE status IN ('draft', 'running') OR (status = 'cancelled' AND "updatedAt" >= $1)
                             ORDER BY "createdAt" DESC LIMIT 2000`, huyTuLuc)).map(hangKeHoach)
        },
        async huyKeHoach(id, result) {
            return (await x(`UPDATE "ShopeePilotPlan" SET status = 'cancelled', result = $2, "updatedAt" = $3 WHERE id = $1 AND status = 'draft'`,
                id, result == null ? null : JSON.stringify(result), Date.now())) === 1
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
        async luuCauHinh(c) { cfg = sao({ ...c, lastRunAt: cfg?.lastRunAt ?? null, lastResult: cfg?.lastResult ?? null, updatedAt: Date.now() }) },
        async gianhLich(cu, moi) { if (!cfg || cfg.nextRunAt !== cu) return false; cfg.nextRunAt = moi; return true },
        async ghiKetQuaLich(luc, ketQua) { if (cfg) { cfg.lastRunAt = luc; cfg.lastResult = sao(ketQua) } },
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
        async dsKeHoachMo(huyTuLuc) {
            return sao(keHoach.filter(k => k.status === 'draft' || k.status === 'running' || (k.status === 'cancelled' && k.updatedAt >= huyTuLuc)).sort((a, b) => b.createdAt - a.createdAt))
        },
        async huyKeHoach(id, result) {
            const k = keHoach.find(x => x.id === id)
            if (!k || k.status !== 'draft') return false
            k.status = 'cancelled'; k.result = result == null ? null : sao(result); k.updatedAt = Date.now(); return true
        },
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

export interface NgCanh {
    prisma: any; kho: KhoPilot; nguoi?: string | null
    /** gian làm việc của lượt này, thắng gian chọn trong cấu hình — lịch chạy mọi gian, thực thi theo gian của kế hoạch */
    kenhId?: string | null
    /** đẩy tồn giả cho bộ kiểm; bỏ trống ⇒ lib/dayTonLenSan */
    dayTon?: (prisma: any, channelId: string, o: { dryRun?: boolean }) => Promise<any>
}

/** 0h hôm nay giờ VN, epoch ms. */
export function dauNgayVN(now = Date.now()): number {
    const VN = 7 * 3600_000
    return Math.floor((now + VN) / 86400_000) * 86400_000 - VN
}
const ngayVN = (now = Date.now()) => new Date(now + 7 * 3600_000).toISOString().slice(0, 10)
const vnd = (n: number) => `${Math.round(n).toLocaleString('vi-VN')}đ`
const pct = (r: number) => `${(Math.round(r * 1000) / 10).toLocaleString('vi-VN')}%`

export async function docCauHinh(ctx: NgCanh): Promise<{ cfg: CauHinhPilot; kenh: any[]; ch: any | null }> {
    const cfg = (await ctx.kho.docCauHinh()) || cauHinhMacDinh()
    const kenh: any[] = await ctx.prisma.onlineChannel.findMany({ where: { platform: 'shopee' }, orderBy: { createdAt: 'asc' } })
    const id = ctx.kenhId || cfg.channelId
    const ch = (id && kenh.find(c => c.id === id)) || (!ctx.kenhId && kenh.length === 1 ? kenh[0] : null)
    return { cfg, kenh, ch }
}

async function canGian(ctx: NgCanh) {
    const r = await docCauHinh(ctx)
    if (!r.ch) {
        if (ctx.kenhId) throw new ToolError('Gian Shopee của kế hoạch này không còn trong cửa hàng (đã ngắt kết nối?).')
        throw new ToolError(r.kenh.length
            ? `Cửa hàng có ${r.kenh.length} gian Shopee — chọn gian cho Pilot ở Tự động hóa → Sửa chính sách.`
            : 'Cửa hàng chưa kết nối gian Shopee nào — kết nối ở Kênh bán online trên kengi.vn trước.')
    }
    if (!r.ch.accessToken || !r.ch.shopId) throw new ToolError(`Gian "${r.ch.name}" chưa uỷ quyền API Shopee.`)
    return r as { cfg: CauHinhPilot; kenh: any[]; ch: any }
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
        // đơn đi qua affiliate (trọn hoa hồng, max mức khai / mức đo cao nhất) — trường hợp xấu nhất giá sàn phải giữ
        affiliateProfit: xau && kq.thamSo.phiAffiliatePct ? xau.loiNhuan : null,
        affiliateMarginRate: xau && kq.thamSo.phiAffiliatePct ? xau.bienPct / 100 : null,
        ...(kq.hopLe ? {} : { reason: kq.lyDo }),
        ...(chuaTin ? { autoBlocked: chuaTin } : {}),
    }
}

/** Nhóm hàng trong kho kèm số mã (hàng hoá, chưa gộp, không combo) và số mã còn tồn — cho bộ chọn hồ sơ. */
async function nhomHangKho(prisma: any): Promise<{ name: string; total: number | null; inStock: number | null }[]> {
    const rs: any[] | null = await prisma.$queryRawUnsafe(
        `SELECT c.name, COUNT(p.id)::int AS total, (COUNT(p.id) FILTER (WHERE p.stock > 0))::int AS "inStock"
           FROM "Category" c
           LEFT JOIN "Product" p ON p."categoryId" = c.id AND p."productType" = 'goods' AND p."mergedIntoId" IS NULL AND p."bundleId" IS NULL
          GROUP BY c.name ORDER BY c.name LIMIT 500`,
    ).catch(() => null)
    if (rs && rs.length) return rs.filter(r => r.name).map(r => ({ name: String(r.name), total: Number(r.total) || 0, inStock: Number(r.inStock) || 0 }))
    const ten: any[] = await prisma.category.findMany({ select: { name: true }, orderBy: { name: 'asc' }, take: 500 }).catch(() => [])
    return [...new Set(ten.map(c => c.name).filter(Boolean))].map(name => ({ name, total: null, inStock: null }))
}

/** Lời nhắc thuế theo loại hình khai ở Cài đặt cửa hàng (StoreSettings.businessType). */
async function nhacThue(prisma: any, pol: ChinhSachPilot): Promise<string | null> {
    const s = await prisma.storeSettings?.findFirst?.({ select: { businessType: true } }).catch(() => null)
    const loai = String(s?.businessType || 'company')
    if (loai === 'company' && !(pol.vatRate > 0)) {
        return 'Cửa hàng khai là DOANH NGHIỆP: nếu nộp thuế GTGT theo phương pháp khấu trừ, nhập "Thuế GTGT trên giá bán" ở Sửa chính sách — ' +
            'tiền Shopee chuyển về không trừ thuế đầu ra, chưa khai thì biên lãi thật thấp hơn số Pilot tính.'
    }
    if (loai !== 'company' && pol.vatRate > 0) {
        return 'Cửa hàng khai là HỘ / CÁ NHÂN KINH DOANH: Shopee đã khấu trừ thuế ngay trong tiền về (nằm trong phí đo được) — ' +
            'thuế GTGT trong chính sách đang làm giá sàn cao hơn cần.'
    }
    return null
}

// ─── Trạng thái cho giao diện (GET /state) ─────────────────────────────────────

const TRAN_LISTING = 100
const TRAN_UNG_VIEN = 30

export async function xayTrangThai(ctx: NgCanh): Promise<any> {
    const { cfg, kenh, ch } = await docCauHinh(ctx)
    const pol = cfg.policy
    const [plans, audit, todayWrites] = await Promise.all([ctx.kho.dsKeHoach(60), ctx.kho.dsNhatKy(100), ctx.kho.demGhiTuLuc(dauNgayVN())])
    const channels = kenh.map(c => ({ id: c.id, name: c.name, shopId: c.shopId, authorized: !!(c.accessToken && c.shopId) }))
    const [nhomKho, thue] = await Promise.all([nhomHangKho(ctx.prisma), nhacThue(ctx.prisma, pol)])
    const status: any = {
        mode: 'live', environment: 'production', executionMode: cfg.executionMode, policy: pol,
        channels, shop: ch ? { id: ch.id, name: ch.name, shopId: ch.shopId, authorized: !!(ch.accessToken && ch.shopId) } : null,
        profiles: cfg.profiles,
        schedule: { ...cfg.schedule, nextRunAt: cfg.nextRunAt, lastRunAt: cfg.lastRunAt, lastResult: cfg.lastResult },
        khoCategories: nhomKho.map(c => c.name),
        khoGroups: nhomKho,
        ...(thue ? { taxNote: thue } : {}),
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
    const [von, daBan, bang, uv] = await Promise.all([
        giaVonHangLoat(ctx.prisma, listing),
        soBan14Ngay(ctx.prisma, ch.id),
        docMauPhiTheoNganh(ctx.prisma, ch),
        timUngVien(ctx.prisma, ch.id, { lim: TRAN_UNG_VIEN }),
    ])
    // phí cả gian (số tổng quan); từng sản phẩm tính theo phí NGÀNH của nó (bang.chon) — mỗi ngành Shopee thu một khác
    const mauPhi = bang.toanGian
    const chuaTuGhi = mauPhi.nguon === 'cau-hinh-kenh' || !!mauPhi.khai || !!mauPhi.chuaBiet || !(mauPhi.soDon >= SO_DON_TU_GHI)
    const tomTatGian = tomTatMauPhi(mauPhi, bang)
    const aff = mauPhi.affiliate
    const affSan = Math.max(pol.affiliateRate, Math.min(aff?.tyLeMax ?? 0, 0.5))
    status.feeModel = {
        rate: mauPhi.tyLe, fixedPerOrder: mauPhi.coDinh, source: mauPhi.nguon, orders: mauPhi.soDon, note: mauPhi.ghiChu,
        minOrderPrice: mauPhi.giaBanMin ?? null,
        // Hoa hồng affiliate đo từng đơn (OnlineOrder.affiliateFee) — separated: `rate` là phí KHÔNG gồm hoa hồng.
        // floorAffiliateRate = hoa hồng giá sàn đang dùng = max(mức khai, mức cao nhất đo được ở một đơn).
        affiliate: aff ? { separated: aff.tachRieng, avgRate: aff.tyLeTB, maxRate: aff.tyLeMax, ordersKnown: aff.soDonBiet, ordersWithAffiliate: aff.soDonCo } : null,
        floorAffiliateRate: affSan,
        ...(aff && aff.tyLeMax > pol.affiliateRate + 0.0005 ? {
            affiliateWarning: `Có đơn trả hoa hồng affiliate tới ${Math.round(aff.tyLeMax * 1000) / 10}% giá bán — cao hơn mức khai ` +
                `${Math.round(pol.affiliateRate * 1000) / 10}% trong chính sách, nên giá sàn đang tính theo ${Math.round(affSan * 1000) / 10}% để đơn affiliate không lỗ. ` +
                'Mức đo tự hạ khi những đơn đó ra khỏi dữ liệu đo (tối đa 90 ngày).',
        } : {}),
        trusted: !chuaTuGhi,
        // 09/11/2026 (chủ shop: "xem phí phải ghi rõ ra không thể mượn được"): bỏ `borrowed` — không còn mượn số đo gian khác.
        // declared = phí KHAI ở kênh (chưa đủ đơn để đo); unknown = CHƯA BIẾT PHÍ (chưa đủ đơn, chưa khai) ⇒ không giá nào
        // tính / ghi được; detail = câu nguồn phí hiện THẲNG trên giao diện (cùng khuôn tomTatMauPhi), scope cùng bộ giá trị.
        declared: !!mauPhi.khai, unknown: !!mauPhi.chuaBiet, scope: tomTatGian.scope, detail: tomTatGian.detail,
        byCategory: [...bang.theoNganh.values()].sort((a, b) => b.soDon - a.soDon).slice(0, 30).map(m => tomTatMauPhi(m, bang)),
        // ngành có hàng trên gian mà chưa đủ đơn đo riêng — sản phẩm các ngành này dùng phí cả gian, máy không tự hạ giá
        unmeasuredCategories: [...bang.viDuNganh.keys()].filter(k => !bang.theoNganh.has(k)).length,
        // từ giá này trở lên máy mới tự ghi (dưới đó: kế hoạch để nháp chờ người duyệt); null = máy chưa tự ghi giá nào
        autoFromPrice: chuaTuGhi ? null : mauPhi.nguon === 'ty-le-don' ? Math.ceil(mauPhi.giaBanTB || 0) : Math.ceil(mauPhi.giaBanMin || 0),
        ...(mauPhi.chuaBiet ? { warning: lyDoChuaBietPhi(mauPhi.soDon, ch.name) }
            : chuaTuGhi ? { warning: lyDoPhiChuaDuTin(0, mauPhi) }
            : mauPhi.nguon === 'ty-le-don' && mauPhi.giaBanTB ? { warning: `Phí đo là tỷ lệ trung bình (chưa tách được phí cố định mỗi đơn) — giá dưới ${vnd(mauPhi.giaBanTB)} (giá trung bình các đơn đã đo) chu kỳ Tự động và AI không tự đăng / hạ giá về đó, chờ người duyệt.` }
                : mauPhi.giaBanMin ? { warning: `Giá dưới ${vnd(mauPhi.giaBanMin)} (đơn rẻ nhất đã đo phí) chu kỳ Tự động và AI không tự đăng / hạ giá về đó, chờ người duyệt.` } : {}),
    }

    const products: any[] = []
    for (const l of listing) {
        const v = von.get(l.id)
        const giaVon = v && v.giaVon > 0 ? v.giaVon : 0
        const mp = bang.chon(l.categoryId)
        const ts = thamSoTinh(pol, giaVon, mp)
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
            pricing: { ...giaUi(kq, ts, mp), fee: tomTatMauPhi(mp, bang), snapshot: { price: Number(l.price) || 0, stock: Number(l.stock) || 0 } },
            hasModels: coPhanLoai,
            ...(coPhanLoai ? { error: 'Sản phẩm có phân loại — giá từng phân loại sửa trên Shopee (khuyến mãi theo phân loại thì làm được ở trang Khuyến mãi).' }
                : !giaVon ? { error: 'Chưa có giá vốn trong kho — không tính được lãi, không đổi giá.' } : {}),
        })
    }
    for (const u of uv.ungVien) {
        const hoSo = timHoSo(cfg.profiles, u.sku, u.nhomHang)
        // hàng chưa đăng: ngành Shopee sẽ đăng vào là ngành của hồ sơ — chưa có hồ sơ thì chưa rõ ngành
        const mp = bang.chon(hoSo?.categoryId)
        const ts = thamSoTinh(pol, u.giaVon || 0, mp)
        const kq = tinhGiaDeXuat(ts)
        const thieu = u.thieu.filter(t => t !== THIEU_MO_TA)
        products.push({
            sku: u.sku, itemId: null, enabled: thieu.length === 0, category: u.nhomHang || null,
            profile: hoSo ? { id: hoSo.id, scope: hoSo.scope, key: hoSo.key, categoryPath: hoSo.categoryPath || `Ngành ${hoSo.categoryId}`, weightGram: hoSo.weightGram } : null,
            costPrice: u.giaVon || null, currentPrice: u.giaBanLe || null, stock: u.tonBanDuoc,
            imageUrl: u.anhDau, sold14: 0,
            listing: { item_name: u.ten, description: u.moTa },
            pricing: { ...giaUi(kq, ts, mp), fee: tomTatMauPhi(mp, bang) },
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

/** ShopeeService của gian, mở MỘT lần mỗi lượt (chu kỳ / thực thi) — mỗi lần mở có thể làm mới token. */
async function dichVuCuaLuot(ctx: NgCanh, ch: any): Promise<any> {
    const bo: Map<string, Promise<any>> = ((ctx as any)._dichVu ||= new Map())
    if (!bo.has(ch.id)) bo.set(ch.id, moDichVuShopee(ctx.prisma, ch))
    return bo.get(ch.id)
}

/** Hàng đang chạy KM: giá đang bán < giá gốc. update_price đổi giá GỐC ⇒ đổi luôn mức giảm của chương trình. */
const dangGiamGia = (s: GiaSongShopee | null | undefined) => !!s && s.giaBan > 0 && s.giaBan < s.giaGoc

export async function taoKeHoachGia(ctx: NgCanh, b: { sku?: string; itemId?: string; price: number; idempotencyKey?: string; giaSong?: GiaSongShopee }): Promise<KeHoach> {
    if (b.idempotencyKey) { const cu = await ctx.kho.timKeHoachTheoKhoa(b.idempotencyKey); if (cu) return cu }
    const { cfg, ch } = await canGian(ctx)
    const gia = Math.round(num(b.price, 0))
    if (!(gia > 0)) throw new ToolError('Giá mới không hợp lệ')
    // theo item_id khi có (chu kỳ biết đúng listing đã soát) — SKU có thể trùng giữa hai listing hoặc trống
    const l = await timListing(ctx.prisma, ch.id, b.itemId ? { item_id: b.itemId } : { sku: b.sku })
    const mauPhi = await docMauPhiSanPham(ctx.prisma, ch, l.categoryId)   // phí ĐÚNG ngành của sản phẩm
    // Chưa biết phí sàn của gian ⇒ không giá nào ghi được (tinhGiaDeXuat hỏng, chanGiaDuoiSan chặn) — nói ngay đường khai phí,
    // khỏi đọc giá trên Shopee cho một kế hoạch chắc chắn không lập được (09/11/2026)
    if (mauPhi.chuaBiet) throw new ToolError(lyDoChuaBietPhi(mauPhi.soDon, ch.name))
    // Giá GỐC đang để trên Shopee: chu kỳ đọc sẵn cả lô; người / AI lập lẻ thì đọc ở đây, đọc hỏng mới dùng bản lưu
    let song: GiaSongShopee | null = b.giaSong || null
    if (!song) {
        try { song = (await giaSongShopee(await dichVuCuaLuot(ctx, ch), [l.platformProductId])).get(String(l.platformProductId)) || null } catch { song = null }
    }
    if (song?.coPhanLoai) throw new ToolError('Sản phẩm có phân loại — giá từng phân loại sửa trên Shopee.')
    if (dangGiamGia(song)) throw new ToolError(`Sản phẩm đang chạy khuyến mãi (giá gốc ${vnd(song!.giaGoc)}, đang bán ${vnd(song!.giaBan)}) — đổi giá gốc lúc này là đổi luôn mức giảm; đợi chương trình kết thúc.`)
    const giaCu = song?.giaGoc || Number(l.price) || 0
    if (!(giaCu > 0)) throw new ToolError('Sản phẩm có phân loại — giá từng phân loại sửa trên Shopee.')
    const v = (await giaVonHangLoat(ctx.prisma, [l])).get(l.id)
    if (!v || !(v.giaVon > 0)) throw new ToolError(`${b.sku} chưa có giá vốn trong kho — không đổi giá khi không biết lãi/lỗ.`)
    const ts = thamSoTinh(cfg.policy, v.giaVon, mauPhi)
    const kq = tinhGiaDeXuat(ts)
    const chan = chanGiaDuoiSan(gia, kq) || vuotBienDong(giaCu, gia, cfg.policy.maxPriceChangeRate, kq.giaSan)
    if (chan) throw new ToolError(chan)
    const dk = danhGiaGia(gia, ts), xau = danhGiaGia(gia, ts, true)
    const phiChuaTin = lyDoPhiChuaDuTin(gia, mauPhi, cfg.policy.minMarginRate * 100)
    return ctx.kho.taoKeHoach(keHoachMoi('price', {
        sku: l.sku || b.sku || null, itemId: l.platformProductId, price: gia, channelId: ch.id, channelName: ch.name,
        snapshot: { price: giaCu, stock: Number(l.stock) || 0, source: song ? 'shopee' : 'kengi' },
        economics: {
            marginRate: dk.bienPct / 100, profit: dk.loiNhuan, floor: kq.giaSan, suggested: kq.hopLe ? kq.giaDeXuat : null,
            fee: tomTatMauPhi(mauPhi),
            // hoa hồng giá sàn dùng = max(mức khai, mức đo cao nhất) — đo được mà chưa khai vẫn phải hiện
            ...(kq.thamSo.phiAffiliatePct > 0 ? { affiliateProfit: xau.loiNhuan, affiliateMarginRate: xau.bienPct / 100 } : {}),
        },
        ...(phiChuaTin ? { feeWarning: phiChuaTin, warning: phiChuaTin } : {}),
    }, b.idempotencyKey || null, ctx.nguoi))
}

export interface DauVaoDang {
    sku: string; title?: string; description?: string; categoryId: number; weightGram: number
    attributes?: { attribute_id: number; value_id?: number; gia_tri?: string; don_vi?: string }[]
    brandId?: number; brandName?: string; hidden?: boolean; idempotencyKey?: string
    /** Lưu ngành + cân nặng + thuộc tính này làm hồ sơ đăng cho nhóm hàng của mã / cho riêng mã */
    saveProfile?: 'nhom' | 'sku' | null
    categoryPath?: string
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
    const thu = await dangSanPhamShopee(ctx.prisma, { ...args, chay_thu: true }, { ch, nen: nenGia(cfg.policy), tuDong: false })
    if (b.saveProfile === 'nhom' || b.saveProfile === 'sku') {
        const p = await timHangKho(ctx.prisma, b.sku)
        const key = b.saveProfile === 'sku' ? p.sku : p.category?.name
        if (key) {
            await luuHoSo(ctx, {
                scope: b.saveProfile, key, categoryId: args.category_id, categoryPath: b.categoryPath, weightGram: args.can_nang_gram,
                attributes: args.thuoc_tinh, brandId: args.brand_id, brandName: args.ten_thuong_hieu, hidden: args.an_sau_khi_dang,
            })
        }
    }
    return ctx.kho.taoKeHoach(keHoachMoi('publish', {
        sku: b.sku, args, channelId: ch.id, channelName: ch.name,
        payload: thu.thanYeuCau,
        images: thu.anhSeNap,
        economics: {
            marginRate: thu.phanTichGia.duKien.bienPct / 100, profit: thu.phanTichGia.duKien.loiNhuan, floor: thu.phanTichGia.giaSan, suggested: thu.phanTichGia.giaDeXuat,
            ...(thu.phanTichGia.duKienAffiliate.hoaHongAffiliate > 0 ? { affiliateProfit: thu.phanTichGia.duKienAffiliate.loiNhuan, affiliateMarginRate: thu.phanTichGia.duKienAffiliate.bienPct / 100 } : {}),
        },
        feeNote: thu.phanTichGia.mauPhi,
        ...(thu.phanTichGia.canhBaoPhi ? { feeWarning: thu.phanTichGia.canhBaoPhi, warning: thu.phanTichGia.canhBaoPhi } : {}),
    }, b.idempotencyKey || null, ctx.nguoi))
}

/** Thêm / sửa hồ sơ đăng (trùng phạm vi + khoá thì thay). */
export async function luuHoSo(ctx: NgCanh, b: any): Promise<HoSoDang> {
    const { cfg } = await docCauHinh(ctx)
    const moi = chuanHoaHoSo(b)
    const t = (v: string) => v.trim().toLowerCase()
    const con = cfg.profiles.filter(h => h.id !== moi.id && !(h.scope === moi.scope && t(h.key) === t(moi.key)))
    if (con.length >= 300) throw new ToolError('Tối đa 300 hồ sơ đăng')
    await ctx.kho.luuCauHinh({ ...cfg, profiles: [...con, moi] })
    return moi
}

export async function xoaHoSo(ctx: NgCanh, id: string): Promise<{ daXoa: boolean }> {
    const { cfg } = await docCauHinh(ctx)
    const con = cfg.profiles.filter(h => h.id !== id)
    if (con.length === cfg.profiles.length) return { daXoa: false }
    await ctx.kho.luuCauHinh({ ...cfg, profiles: con })
    return { daXoa: true }
}

/** Tìm ngành Shopee theo từ khoá (Shopee gợi ý + tìm trong cây ngành) — cho trình sửa hồ sơ. */
export async function timNganh(ctx: NgCanh, b: { keyword: string }): Promise<{ categories: { id: number; path: string }[]; categoryError?: string }> {
    const { ch } = await canGian(ctx)
    const tk = String(b?.keyword || '').trim()
    if (!tk) throw new ToolError('Nhập từ khoá ngành')
    const svc = await moDichVuShopee(ctx.prisma, ch)
    const cay = await svc.getCategories('vi').catch(() => [] as any[])
    const theoId = new Map(cay.map((c: any) => [c.id, c]))
    const ra: { id: number; path: string }[] = []
    let loi: string | undefined
    try {
        for (const id of await svc.categoryRecommend(tk)) {
            const c: any = theoId.get(id)
            if (c && c.coCon) continue
            ra.push({ id, path: duongNganh(cay, id) || `Ngành ${id}` })
        }
    } catch (e: any) { loi = String(e?.message || e).slice(0, 200) }
    const thuong = tk.toLowerCase()
    for (const c of cay.filter((c: any) => !c.coCon)) {
        if (ra.length >= 25) break
        const path = duongNganh(cay, c.id)
        if (path.toLowerCase().includes(thuong) && !ra.some(r => r.id === c.id)) ra.push({ id: c.id, path })
    }
    return { categories: ra, ...(loi ? { categoryError: loi } : {}) }
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

    const bang = await docMauPhiTheoNganh(ctx.prisma, ch)   // giá sàn KM theo phí NGÀNH của từng mã
    // Cả gian chưa biết phí ⇒ không mã nào có giá sàn: nói MỘT lần, không lặp lý do theo từng mã, khỏi gọi Shopee (09/11/2026)
    if (bang.toanGian.chuaBiet && !bang.theoNganh.size) throw new ToolError(lyDoChuaBietPhi(bang.toanGian.soDon, ch.name))
    const phiDong = new Map<any, MauPhi>()
    const lines: any[] = [], tuChoi: { sku: string; reason: string }[] = []
    const listings: any[] = []
    for (const sku of skus) {
        try { listings.push(await timListing(ctx.prisma, ch.id, { sku })) } catch { tuChoi.push({ sku, reason: 'Không có trên gian' }) }
    }
    const von = await giaVonHangLoat(ctx.prisma, listings)
    // Chương trình khác đang chạy / sắp chạy trên mã (Shopee từ chối mã đã trong chương trình khác)
    const dangKm = new Map<string, string>()
    let canhBao: string | undefined
    const svc = await moDichVuShopee(ctx.prisma, ch)
    try {
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
    /** Giá khuyến mãi của MỘT mức giá với MỘT giá vốn: giảm theo %, không dưới sàn, phải thấp hơn giá đang bán. */
    const tinhKm = (giaCu: number, giaVon: number, mauPhi: MauPhi): { ok: true; price: number; floor: number; profit: number; marginRate: number; adjusted?: string } | { ok: false; reason: string } => {
        const ts = thamSoTinh(pol, giaVon, mauPhi)
        const kq = tinhGiaDeXuat(ts)
        // không tính được giá sàn (chưa biết phí sàn, biên + phí ≥ 100%…) ⇒ giaSan = 0: trước 09/11/2026 dòng đó lọt vào kế hoạch
        // như "giảm được" với sàn 0 (tới lúc thực thi soatLaiDongKhuyenMai mới bỏ, lại ghi nhầm lý do "không còn tra ra giá vốn")
        if (!kq.hopLe && !(kq.giaSan > 0)) return { ok: false, reason: kq.lyDo || 'Không tính được giá sàn' }
        let giaKm = Math.ceil((giaCu * (1 - giam)) / buoc) * buoc
        let dieuChinh = false
        if (giaKm < kq.giaSan) { giaKm = Math.ceil(kq.giaSan / buoc) * buoc; dieuChinh = true }
        if (giaKm >= giaCu) return { ok: false, reason: `Giá sàn ${vnd(kq.giaSan)} không thấp hơn giá đang bán ${vnd(giaCu)} — không giảm được` }
        const dk = danhGiaGia(giaKm, ts)
        return { ok: true, price: giaKm, floor: kq.giaSan, profit: dk.loiNhuan, marginRate: dk.bienPct / 100, ...(dieuChinh ? { adjusted: 'Nâng lên giá sàn' } : {}) }
    }
    for (const l of listings) {
        const sku = l.sku || l.platformProductId
        const giaCu = Number(l.price) || 0
        const mp = bang.chon(l.categoryId)
        if (dangKm.has(String(l.platformProductId))) { tuChoi.push({ sku, reason: `Đang/sắp có ${dangKm.get(String(l.platformProductId))}` }); continue }
        const lanTang = await ctx.kho.lanTangGiaCuoi(sku)
        if (lanTang && Date.now() - lanTang < pol.promotionCooldownHoursAfterIncrease * 3600_000) {
            tuChoi.push({ sku, reason: `Vừa tăng giá lúc ${new Date(lanTang + 7 * 3600_000).toISOString().slice(11, 16)} — chờ đủ ${pol.promotionCooldownHoursAfterIncrease} giờ` }); continue
        }
        if (!(giaCu > 0)) {
            /* CÓ PHÂN LOẠI (01/11/2026): giá KM từng phân loại, giá vốn theo SKU của phân loại đó (model_sku → kho). Phân loại
             * không tra ra giá vốn hoặc không giảm được thì để ngoài chương trình, KHÔNG đoán vốn theo phân loại khác. */
            let models: any[] = []
            try { models = await svc.getModelList(Number(l.platformProductId)) } catch (e: any) { tuChoi.push({ sku, reason: `Không đọc được phân loại: ${String(e?.message || e).slice(0, 120)}` }); continue }
            const vonMd = await giaVonHangLoat(ctx.prisma, models.map(m => ({ id: String(m.model_id), sku: m.sku || null })))
            const mdOk: any[] = [], mdLoai: string[] = []
            for (const m of models) {
                const tenMd = m.name || m.sku || String(m.model_id)
                const giaMd = Number(m.price) || 0
                const vm = vonMd.get(String(m.model_id))
                if (!(giaMd > 0)) { mdLoai.push(`${tenMd}: không đọc được giá`); continue }
                if (!vm || !(vm.giaVon > 0)) { mdLoai.push(`${tenMd}: chưa có giá vốn (SKU "${m.sku || ''}")`); continue }
                const r = tinhKm(giaMd, vm.giaVon, mp)
                if (!r.ok) { mdLoai.push(`${tenMd}: ${r.reason}`); continue }
                mdOk.push({ modelId: Number(m.model_id), name: tenMd, sku: m.sku || null, originalPrice: giaMd, price: r.price, floor: r.floor, profit: r.profit, marginRate: r.marginRate, ...(r.adjusted ? { adjusted: r.adjusted } : {}) })
            }
            if (!mdOk.length) { tuChoi.push({ sku, reason: `Không phân loại nào giảm được — ${mdLoai.join('; ').slice(0, 300)}` }); continue }
            const dong = {
                sku, itemId: l.platformProductId, models: mdOk, ...(mdLoai.length ? { skippedModels: mdLoai } : {}),
                originalPrice: Math.min(...mdOk.map(m => m.originalPrice)), price: Math.min(...mdOk.map(m => m.price)),
                profit: Math.min(...mdOk.map(m => m.profit)), marginRate: Math.min(...mdOk.map(m => m.marginRate)),
                feeRate: mp.tyLe,
            }
            lines.push(dong); phiDong.set(dong, mp)
            continue
        }
        const v = von.get(l.id)
        if (!v || !(v.giaVon > 0)) { tuChoi.push({ sku, reason: 'Chưa có giá vốn' }); continue }
        const r = tinhKm(giaCu, v.giaVon, mp)
        if (!r.ok) { tuChoi.push({ sku, reason: r.reason }); continue }
        const { ok: _ok, ...km } = r
        const dong = { sku, itemId: l.platformProductId, originalPrice: giaCu, discountRate: 1 - km.price / giaCu, ...km, feeRate: mp.tyLe }
        lines.push(dong); phiDong.set(dong, mp)
    }
    if (!lines.length) throw new ToolError(`Không mã nào đủ điều kiện: ${tuChoi.map(t => `${t.sku} (${t.reason})`).join('; ')}`)
    // mỗi dòng soát theo phí NGÀNH của chính nó — dòng đầu tiên chưa đủ tin là đủ để không tự chạy
    const phiChuaTin = lines.map(l => lyDoPhiChuaDuTin(l.price, phiDong.get(l)!, pol.minMarginRate * 100)).find(Boolean) || null
    const nhac = [canhBao, phiChuaTin].filter(Boolean).join(' · ')
    return ctx.kho.taoKeHoach(keHoachMoi('campaign', {
        name: ten, startTime: batDau, endTime: ketThuc, purchaseLimit: gioiHanMua, discountRate: giam, lines, rejected: tuChoi,
        channelId: ch.id, channelName: ch.name,
        ...(nhac ? { warning: nhac } : {}),
        ...(phiChuaTin ? { feeWarning: phiChuaTin } : {}),
    }, b.idempotencyKey || null, ctx.nguoi))
}

// ─── Thực thi ───────────────────────────────────────────────────────────────────

async function conLuotGhi(ctx: NgCanh, pol: ChinhSachPilot): Promise<void> {
    const dem = await ctx.kho.demGhiTuLuc(dauNgayVN())
    if (dem >= pol.maxWritesPerDay) throw new ToolError(`Đã đạt giới hạn ${pol.maxWritesPerDay} thao tác ghi hôm nay theo chính sách — để mai hoặc nâng giới hạn.`)
}

/** Người huỷ một kế hoạch còn nháp (03/11/2026) — chu kỳ nhớ 14 ngày, không đề xuất lại mã đó (huỷ = "đừng làm"). */
export async function huyKeHoach(ctx: NgCanh, id: string): Promise<KeHoach> {
    const message = `Người huỷ${ctx.nguoi ? ` (${String(ctx.nguoi).slice(0, 80)})` : ''} — chu kỳ không đề xuất lại mã này trong 14 ngày.`
    if (!(await ctx.kho.huyKeHoach(String(id || ''), { message }))) throw new ToolError('Kế hoạch không còn là bản nháp — không huỷ được.')
    return (await ctx.kho.layKeHoach(String(id)))!
}

/** `tuDong` = máy gọi (chu kỳ Tự động) — phí sàn chưa đủ tin thì thao tác ghi tự từ chối (lớp rào thứ hai sau chayChuKy). */
export async function thucThi(ctx: NgCanh, planId: string, tuyChon: { tuDong?: boolean } = {}): Promise<any> {
    const plan = await ctx.kho.layKeHoach(planId)
    if (!plan) throw new ToolError('Không thấy kế hoạch — tải lại trang.')
    if (plan.status !== 'draft') return plan
    // kế hoạch ghi lên ĐÚNG gian nó được lập (lịch chạy mọi gian) — kế hoạch cũ chưa mang gian thì theo gian đang chọn
    const { cfg, ch } = await canGian(plan.data?.channelId ? { ...ctx, kenhId: String(plan.data.channelId) } : ctx)
    if (cfg.executionMode !== 'auto') return { executed: false, plan }
    await conLuotGhi(ctx, cfg.policy)
    if (!(await ctx.kho.gianhKeHoach(plan.id))) return (await ctx.kho.layKeHoach(plan.id)) || plan

    const d = plan.data || {}
    const tuDong = tuyChon.tuDong === true
    let status = 'succeeded', result: any = null
    try {
        if (plan.kind === 'publish') {
            const r = await dangSanPhamShopee(ctx.prisma, { ...d.args, gia: d.payload?.original_price, chay_thu: false }, { ch, nen: nenGia(cfg.policy), tuDong, svc: await dichVuCuaLuot(ctx, ch) })
            result = { item_id: r.itemId, link: r.link, ...(r.anhLoi ? { message: `Một số ảnh không nạp được: ${r.anhLoi.join(' | ')}` } : {}) }
            await ctx.kho.ghiNhatKy({ action: 'publish', status, planId: plan.id, payload: { item_sku: d.sku, item_id: r.itemId }, response: r })
        } else if (plan.kind === 'price') {
            // Giá trên sàn có thể đã đổi từ lúc lập kế hoạch — soát lại biên độ với giá GỐC đang để trên Shopee
            const svc = await dichVuCuaLuot(ctx, ch)
            const l = await timListing(ctx.prisma, ch.id, { item_id: d.itemId })
            let song: GiaSongShopee | null = null
            try {
                song = (await giaSongShopee(svc, [d.itemId])).get(String(d.itemId)) || null
            } catch (e: any) {
                if (tuDong) throw new ToolError(`Không đọc được giá đang để trên Shopee (${String(e?.message || e).slice(0, 160)}) — máy không đổi giá khi không thấy giá hiện tại.`)
            }
            if (tuDong && !song) throw new ToolError('Shopee không trả thông tin sản phẩm này (đã xoá / bị khoá?) — máy không đổi giá.')
            if (song?.coPhanLoai) throw new ToolError('Sản phẩm giờ đã có phân loại — giá từng phân loại sửa trên Shopee.')
            if (dangGiamGia(song)) throw new ToolError(`Sản phẩm đang chạy khuyến mãi (giá gốc ${vnd(song!.giaGoc)}, đang bán ${vnd(song!.giaBan)}) — không đổi giá gốc giữa chương trình.`)
            if (tuDong && song?.trangThai && song.trangThai !== 'NORMAL') throw new ToolError(`Sản phẩm đang ở trạng thái ${song.trangThai} trên Shopee — máy không đổi giá.`)
            const v = (await giaVonHangLoat(ctx.prisma, [l])).get(l.id)
            const kq = tinhGiaDeXuat(thamSoTinh(cfg.policy, v?.giaVon || 0, await docMauPhiSanPham(ctx.prisma, ch, song?.nganh || l.categoryId)))
            const loiBien = vuotBienDong(song?.giaGoc || Number(l.price) || 0, d.price, cfg.policy.maxPriceChangeRate, kq.giaSan)
            if (loiBien) throw new ToolError(`Giá trên sàn đã đổi từ lúc lập kế hoạch. ${loiBien}`)
            const r = await doiGiaShopee(ctx.prisma, { item_id: d.itemId, gia_moi: d.price, ...thamSoGia(cfg.policy), ly_do: 'Shopee Pilot' }, { ch, nen: nenGia(cfg.policy), tuDong, svc })
            result = { item_id: r.itemId, old_price: r.giaCu, new_price: r.giaMoi, ...(r.canhBao ? { warning: r.canhBao } : {}) }
            await ctx.kho.ghiNhatKy({ action: 'price', status, planId: plan.id, payload: { item_sku: d.sku, item_id: d.itemId, price: d.price }, response: r })
        } else if (plan.kind === 'campaign') {
            const r = await thucThiKhuyenMai(ctx, plan, ch, cfg.policy)
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

/**
 * Soát lại từng dòng khuyến mãi với giá vốn / phí sàn / chính sách HIỆN TẠI (01/11/2026): kế hoạch có thể lập
 * từ hôm trước, giá vốn tăng sau lần nhập hàng mới hay chủ shop vừa nâng biên tối thiểu / affiliate ⇒ giá KM
 * trong kế hoạch có thể đã dưới giá sàn. Dòng (phân loại) như vậy bị BỎ, không gửi lên Shopee.
 */
export async function soatLaiDongKhuyenMai(ctx: NgCanh, d: any, ch: any, pol: ChinhSachPilot): Promise<{ lines: any[]; boQua: string[] }> {
    const bang = await docMauPhiTheoNganh(ctx.prisma, ch)
    // Cả gian chưa biết phí (kế hoạch lập lúc còn phí khai, chủ shop vừa trả ô phí về 6% mặc định…) ⇒ không dòng nào giữ được
    // giá sàn — nói MỘT lần lý do thật kèm đường khai phí, đừng liệt kê từng dòng "dưới giá sàn" (09/11/2026)
    if (bang.toanGian.chuaBiet && !bang.theoNganh.size) throw new ToolError(`Không tạo chương trình: ${lyDoChuaBietPhi(bang.toanGian.soDon, ch.name)}`)
    /** Giá sàn hiện tại; 0 kèm lý do khi không tính được — trước 09/11/2026 mọi ca 0 đều ghi "không còn tra ra giá vốn". */
    const giaSan = (giaVon: number, mauPhi: MauPhi): { san: number; lyDo: string } => {
        if (!(giaVon > 0)) return { san: 0, lyDo: 'không còn tra ra giá vốn' }
        const kq = tinhGiaDeXuat(thamSoTinh(pol, giaVon, mauPhi))
        if (kq.giaSan > 0) return { san: kq.giaSan, lyDo: '' }
        return { san: 0, lyDo: mauPhi.chuaBiet ? 'chưa biết phí sàn của gian' : `không tính được giá sàn (${String(kq.lyDo || '').slice(0, 120)})` }
    }
    const dong: any[] = Array.isArray(d?.lines) ? d.lines : []
    const ids = dong.map(l => String(l.itemId))
    const ls: any[] = await ctx.prisma.onlineProduct.findMany({ where: { channelId: ch.id, platformProductId: { in: ids } } })
    const theoItem = new Map<string, any>(ls.filter(l => ids.includes(String(l.platformProductId))).map(l => [String(l.platformProductId), l]))
    const von = await giaVonHangLoat(ctx.prisma, [...theoItem.values()])
    const coPL = dong.filter(l => Array.isArray(l.models) && l.models.length)
    const vonMd = await giaVonHangLoat(ctx.prisma, coPL.flatMap(l => l.models.map((m: any) => ({ id: String(m.modelId), sku: m.sku || null }))))
    const lines: any[] = [], boQua: string[] = []
    for (const l of dong) {
        const li = theoItem.get(String(l.itemId))
        const mp = bang.chon(li?.categoryId)   // phí ngành HIỆN TẠI của mã
        if (Array.isArray(l.models) && l.models.length) {
            const con: any[] = []
            for (const m of l.models) {
                const s = giaSan(vonMd.get(String(m.modelId))?.giaVon || 0, mp)
                if (!s.san) boQua.push(`${l.sku} / ${m.name || m.modelId}: ${s.lyDo}`)
                else if (m.price < s.san) boQua.push(`${l.sku} / ${m.name || m.modelId}: giá KM ${vnd(m.price)} dưới giá sàn hiện tại ${vnd(s.san)}`)
                else con.push(m)
            }
            if (con.length) lines.push({ ...l, models: con })
            continue
        }
        const s = giaSan((li ? von.get(li.id) : undefined)?.giaVon || 0, mp)
        if (!s.san) boQua.push(`${l.sku}: ${s.lyDo}`)
        else if (l.price < s.san) boQua.push(`${l.sku}: giá KM ${vnd(l.price)} dưới giá sàn hiện tại ${vnd(s.san)}`)
        else lines.push(l)
    }
    return { lines, boQua }
}

async function thucThiKhuyenMai(ctx: NgCanh, plan: KeHoach, ch: any, pol: ChinhSachPilot): Promise<{ status: string; result: any }> {
    const d = plan.data
    const soat = await soatLaiDongKhuyenMai(ctx, d, ch, pol)
    const boQua = soat.boQua.length ? ` Bỏ ${soat.boQua.length} dòng dưới giá sàn hiện tại (giá vốn / phí / chính sách đã đổi từ lúc lập kế hoạch): ${soat.boQua.join('; ').slice(0, 600)}.` : ''
    if (!soat.lines.length) throw new ToolError(`Không còn mã nào giữ được giá sàn lúc thực thi — không tạo chương trình.${boQua}`)
    const svc = await dichVuCuaLuot(ctx, ch)
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

    const items = soat.lines.map((l: any) => Array.isArray(l.models) && l.models.length
        ? { item_id: Number(l.itemId), purchase_limit: d.purchaseLimit, model_list: l.models.map((m: any) => ({ model_id: Number(m.modelId), model_promotion_price: m.price })) }
        : { item_id: Number(l.itemId), purchase_limit: d.purchaseLimit, item_promotion_price: l.price })
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
    const theoItem = new Map(soat.lines.map((l: any) => [Number(l.itemId), l.sku]))
    const tb = (loi.length ? `Shopee từ chối ${loi.length}/${items.length} mã: ${loi.map(x => `${theoItem.get(x.itemId) || x.itemId} (${x.lyDo})`).join('; ')}${st === 'failed' ? ' — đã xoá chương trình rỗng.' : ''}` : '') + boQua
    return {
        status: st === 'succeeded' && soat.boQua.length ? 'partial' : st,
        result: {
            discount_id: st === 'failed' ? undefined : discountId,
            ...(tb ? { message: tb.trim() } : {}),
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
    // Làm tròn theo bước giá có thể vượt qua giá đang bán (bước lớn hơn biên độ) ⇒ kẹp để chiều đổi không bao giờ ngược
    let gia = mucTieu > giaCu
        ? Math.min(mucTieu, Math.max(giaCu, Math.floor((giaCu * (1 + m)) / buoc) * buoc))
        : Math.max(mucTieu, Math.min(giaCu, Math.ceil((giaCu * (1 - m)) / buoc) * buoc))
    if (gia < kq.giaSan) { gia = kq.giaSan; lyDo += ' (nâng thẳng lên giá sàn, vượt biên độ mỗi lần)' }
    if (Math.abs(gia - giaCu) < Math.max(1, buoc / 2)) return null
    return { gia, lyDo }
}

const TRAN_DOI_GIA_MOI_CHU_KY = 10
/** Mỗi chu kỳ lập tối đa chừng này nháp CHỜ NGƯỜI DUYỆT mới. Nháp không ăn trần đổi giá: trước 03/11/2026 mười nháp lặp
 *  lại mỗi lượt chiếm trọn 10 chỗ ⇒ các mã sau không bao giờ tới lượt (đo TikTok KENGISTORE). Danh sách duyệt cũng không phình. */
const TRAN_NHAP_MOI_CHU_KY = 20
/** Nháp do MÁY lập quá hạn này chưa ai duyệt thì chu kỳ huỷ — giá vốn / phí / giá đang bán đã khác; lượt sau lập lại nếu vẫn cần. */
const HAN_NHAP_MS = 3 * 86400_000
/** Lượt thực thi 'running' lâu chừng này = máy chết giữa chừng — không ai biết đã ghi lên sàn chưa. */
const KET_THUC_THI_MS = 3600_000
/** Danh mục trong hệ thống cũ hơn chừng này thì chu kỳ tự đồng bộ lại (như bấm "Đồng bộ" ở trang Đơn online). */
const TUOI_DANH_MUC_MS = 2 * 3600_000
/** Máy đổi giá cùng một mã cách nhau ít nhất chừng này (03/11/2026) — đủ để thấy đơn phản ứng với mức giá mới. Bài thử trên
 *  KENGISTORE: không có khoảng nghỉ thì một mã bị nâng 2–3 nấc liền (+10% mỗi chu kỳ 30 phút). Mã đang DƯỚI giá sàn (lỗ) thì
 *  vẫn nâng ngay — dừng lỗ trước. */
export const NGHI_DOI_GIA_MS = 24 * 3600_000
const gioVN = (ms: number) => new Date(ms + 7 * 3600_000).toISOString().slice(0, 16).replace('T', ' ')

/** Nháp máy lập mà CẦN người duyệt (phí chưa đủ tin ⇒ máy không tự hạ giá / tự đăng). Nháp khác của máy là của lượt Xem trước. */
function laNhapChoDuyet(k: KeHoach): boolean {
    if (!k.data?.feeWarning) return false
    return k.kind !== 'price' || !(Number(k.data.price) > Number(k.data?.snapshot?.price))
}

/** Người huỷ kế hoạch máy đề xuất ⇒ chu kỳ không đề xuất lại mã đó trong chừng này (khỏi ngày nào cũng hỏi lại). */
const NHO_NGUOI_HUY_MS = 14 * 86400_000

/**
 * Kế hoạch còn mở của gian (03/11/2026) — trước đây nằm im mãi, không ai biết:
 *   - 'running' quá 1 giờ ⇒ 'uncertain' (máy chết giữa lượt ghi; báo chủ shop kiểm Seller Center)
 *   - nháp máy lập quá 3 ngày ⇒ huỷ; chế độ Tự động mà còn nháp của lượt Xem trước ⇒ huỷ để lập lại theo giá hiện tại
 * Trả các mã đang có nháp chờ duyệt hoặc NGƯỜI vừa huỷ (14 ngày) — chu kỳ né: khỏi nháp trùng mỗi ngày, khỏi để nháp ăn trần.
 */
async function donKeHoachMo(ctx: NgCanh, cuaGian: (k: KeHoach) => boolean, tuDong: boolean, results: any[], now = Date.now()): Promise<Set<string>> {
    const choDuyet = new Set<string>()
    const ne = (k: KeHoach) => {
        if (k.kind === 'price' && k.data?.itemId) choDuyet.add(String(k.data.itemId))
        if (k.kind === 'publish' && k.data?.sku) choDuyet.add(`sku:${String(k.data.sku).toLowerCase()}`)
    }
    let soHuy = 0
    for (const k of await ctx.kho.dsKeHoachMo(now - NHO_NGUOI_HUY_MS)) {
        if (!cuaGian(k)) continue
        if (k.status === 'cancelled') {
            if (!k.result?.tuHuy) ne(k)   // người huỷ — máy tự huỷ (quá hạn / Xem trước) thì lượt sau được lập lại
            continue
        }
        if (k.status === 'running') {
            if (now - k.updatedAt > KET_THUC_THI_MS) {
                const message = 'Lượt thực thi dừng giữa chừng (máy chủ khởi động lại?) — không rõ Shopee đã nhận chưa. Kiểm trên Seller Center rồi lập lại nếu cần.'
                await ctx.kho.capNhatKeHoach(k.id, 'uncertain', { message })
                results.push({ action: k.kind, status: 'uncertain', sku: k.data?.sku, planId: k.id, message })
            }
            continue
        }
        if (String(k.idempotencyKey || '').startsWith('cycle:')) {
            const quaHan = now - k.createdAt > HAN_NHAP_MS
            if (quaHan || (tuDong && !laNhapChoDuyet(k))) {
                const message = quaHan ? 'Nháp máy lập quá 3 ngày chưa duyệt — tự huỷ; chu kỳ lập lại theo giá vốn / phí hiện tại nếu vẫn cần.'
                    : 'Nháp của lượt Xem trước — chế độ Tự động lập lại theo giá hiện tại.'
                if (await ctx.kho.huyKeHoach(k.id, { message, tuHuy: true })) soHuy++
                continue
            }
        }
        ne(k)
    }
    if (soHuy) results.push({ action: 'plan', status: 'skipped', message: `Huỷ ${soHuy} nháp cũ của máy (quá 3 ngày chưa duyệt / còn từ lượt Xem trước).` })
    return choDuyet
}

/** Danh mục cũ hơn 2 giờ ⇒ đồng bộ lại (cùng đường ghi với nút "Đồng bộ": lib/shopeeTuQuan.luuDanhMucSan — chỉ thêm / sửa,
 *  không đánh dấu ngừng bán). Hỏng thì báo, chu kỳ vẫn chạy: quyết giá đọc giá sống từ Shopee. null = còn tươi. */
async function lamMoiDanhMuc(ctx: NgCanh, ch: any): Promise<any | null> {
    const moi = await ctx.prisma.onlineProduct.findFirst({ where: { channelId: ch.id, syncedAt: { not: null } }, orderBy: { syncedAt: 'desc' }, select: { syncedAt: true } }).catch(() => null)
    const t = moi?.syncedAt ? new Date(moi.syncedAt).getTime() : 0
    if (Date.now() - t < TUOI_DANH_MUC_MS) return null
    try {
        const { products } = await (await dichVuCuaLuot(ctx, ch)).fetchProducts()
        if (!products?.length) return { action: 'catalog', status: 'failed', message: 'Shopee trả danh mục rỗng — giữ bản cũ (kiểm token / quyền API của gian).' }
        const n = await luuDanhMucSan(ctx.prisma, ch, products)
        return { action: 'catalog', status: 'succeeded', message: `Đồng bộ lại ${n} sản phẩm đang bán từ Shopee (bản trước: ${t ? gioVN(t) : 'chưa có'}).` }
    } catch (e: any) {
        return { action: 'catalog', status: 'failed', message: `Không đồng bộ được danh mục từ Shopee: ${String(e?.message || e).slice(0, 200)}` }
    }
}

/* Cầu dao đẩy tồn (03/11/2026) chuyển về lõi lib/dayTonLenSan (09/11/2026): lõi soát trên TOÀN BỘ listing trước khi gọi sàn,
 * nút tay "Đẩy tồn kho lên sàn" cũng qua đó. Re-export cho người gọi cũ (bộ kiểm check-pilot-tu-dong B1–B5). */
export { cauDaoTon }

/** Đẩy tồn trong chu kỳ — chạy thử trước, cầu dao nhảy thì KHÔNG đẩy. Dùng chung Shopee / TikTok Pilot.
 *  KHÔNG BAO GIỜ truyền chapNhanVeKhong cho lõi: chỉ người bấm nút tay được nhận rủi ro đưa mã đang có hàng về 0. */
export async function dayTonChuKy(o: {
    tuDong: boolean; san: string; gian: string
    day: (op: { dryRun?: boolean }) => Promise<any>; conLuot: () => Promise<void>; ghi: (w: any) => Promise<void>
}): Promise<any> {
    const thu: any = await o.day({ dryRun: true }).catch((e: any) => ({ ok: false, loi: String(e?.message || e) }))
    if (!o.tuDong) {
        return { action: 'stock', status: 'preview', message: thu.ok ? `Xem trước: sẽ đẩy ${thu.data?.seDay ?? '?'} mã, giữ nguyên ${thu.data?.seBoQua ?? '?'}. Chưa gọi ${o.san}.` : String(thu.loi || 'không rõ') }
    }
    if (!thu.ok) return { action: 'stock', status: 'failed', message: `Không tính được tồn cần đẩy: ${String(thu.loi || 'không rõ').slice(0, 200)}` }
    // Lõi (09/11/2026) trả `cauDao` đếm trên TOÀN BỘ listing — `bang` chỉ có 300 dòng đầu. Lõi cũ / đẩy giả không có trường đó ⇒ như trước.
    const cauDao = thu.data && thu.data.cauDao !== undefined ? thu.data.cauDao : cauDaoTon(thu.data?.bang)
    if (cauDao) return { action: 'stock', status: 'skipped', message: `CẦU DAO — không đẩy tồn: ${cauDao} CHỜ NGƯỜI DUYỆT.` }
    // chạm trần thao tác ghi / ngày theo chính sách — không phải hỏng, khỏi báo chủ shop như lỗi (nâng trần ở chính sách nếu cần)
    try { await o.conLuot() } catch (e: any) { return { action: 'stock', status: 'skipped', message: String(e?.message || e).slice(0, 300) } }
    try {
        const r = await o.day({})
        /* Tồn đổi giữa lượt chạy thử và lượt thật ⇒ lõi tự chặn (409, chưa gọi sàn lần nào): đó là cầu dao, không phải hỏng —
         * 'skipped' + chữ CẦU DAO để chủ shop được báo đúng việc cần duyệt; không ghi nhật ký ghi (không có gì lên sàn). */
        if (!r?.ok && (r?.http === 409 || r?.data?.cauDao)) {
            return { action: 'stock', status: 'skipped', message: `CẦU DAO — không đẩy tồn: ${r.data?.cauDao || String(r.loi || '').replace(/^CẦU DAO — không đẩy tồn:\s*/, '')} CHỜ NGƯỜI DUYỆT.` }
        }
        const d = r.data || {}
        const st = !r.ok ? 'failed' : d.failed ? 'partial' : 'succeeded'
        const message = r.ok ? `Đẩy ${d.pushed ?? 0} mã, giữ nguyên ${d.skipped ?? 0}, lỗi ${d.failed ?? 0}${d.errors?.length ? `: ${d.errors.slice(0, 3).join('; ')}` : ''}` : String(r.loi || 'không rõ')
        await o.ghi({ action: 'stock', status: st, planId: null, payload: { channel: o.gian }, response: { message } })
        return { action: 'stock', status: st, message }
    } catch (e: any) {
        return { action: 'stock', status: 'failed', message: String(e?.message || e).slice(0, 300) }
    }
}

export async function chayChuKy(ctx: NgCanh): Promise<any> {
    const { cfg, ch } = await canGian(ctx)
    const pol = cfg.policy
    const tuDong = cfg.executionMode === 'auto'
    // khoá riêng cho lượt Xem trước — sang Tự động, nháp xem trước bị huỷ mà khoá không chặn lập lại trong ngày
    const tienTo = tuDong ? 'cycle' : 'cycle:xem'
    const results: any[] = []
    // kế hoạch lập trước khi kế hoạch mang gian (03/11/2026) thuộc gian đang chọn
    const moNhap = await donKeHoachMo(ctx, k => String(k.data?.channelId || cfg.channelId || ch.id) === ch.id, tuDong, results)
    const danhMuc = await lamMoiDanhMuc(ctx, ch)
    if (danhMuc) results.push(danhMuc)

    if (pol.automation.syncStock) {
        const day = (o: { dryRun?: boolean }) => ctx.dayTon ? ctx.dayTon(ctx.prisma, ch.id, o) : import('./dayTonLenSan').then(m => m.dayTonLenSan(ctx.prisma, ch.id, o))
        results.push(await dayTonChuKy({ tuDong, san: 'Shopee', gian: ch.name, day, conLuot: () => conLuotGhi(ctx, pol), ghi: w => ctx.kho.ghiNhatKy(w) }))
    }

    /* CHƯA BIẾT PHÍ sàn của gian (09/11/2026, chủ shop: "xem phí phải ghi rõ ra không thể mượn được"): gian chưa đủ đơn đối soát
     * để đo phí, cũng chưa khai phí ⇒ không giá nào tính / ghi được. Bỏ cả đổi giá lẫn đăng mới, báo MỘT dòng: khỏi đọc giá sống
     * Shopee vô ích, khỏi lập rồi hỏng từng mã — mỗi mã một dòng "failed" là mỗi mã một việc trên chuông chủ shop. Đẩy tồn, đồng
     * bộ danh mục không cần phí nên vẫn chạy. */
    const bangPhiGian = pol.automation.reprice || pol.automation.publishNewProducts ? await docMauPhiTheoNganh(ctx.prisma, ch) : null
    const chuaBietPhi = !!bangPhiGian?.toanGian.chuaBiet && !bangPhiGian.theoNganh.size
    if (chuaBietPhi) {
        const viec = [pol.automation.reprice && 'đổi giá', pol.automation.publishNewProducts && 'đăng mới'].filter(Boolean).join(' / ')
        results.push({ action: 'cycle', status: 'skipped', message: dongChuKyChuaBietPhi(bangPhiGian!.toanGian.soDon, ch.name, `chưa ${viec} mã nào`) })
    }

    if (pol.automation.reprice && bangPhiGian && !chuaBietPhi) {
        const bangPhi = bangPhiGian
        const tranGhi = tuDong ? Math.min(TRAN_DOI_GIA_MOI_CHU_KY, pol.maxWritesPerDay - await ctx.kho.demGhiTuLuc(dauNgayVN())) : TRAN_DOI_GIA_MOI_CHU_KY
        const listing: any[] = await ctx.prisma.onlineProduct.findMany({ where: { channelId: ch.id, status: 'NORMAL' }, orderBy: { updatedAt: 'desc' }, take: 300 })
        const [von, daBan] = await Promise.all([giaVonHangLoat(ctx.prisma, listing), soBan14Ngay(ctx.prisma, ch.id)])
        const coVon = listing.filter(l => (von.get(l.id)?.giaVon || 0) > 0)
        const vuaDoi = new Set((await ctx.kho.dsKeHoach(500)).filter(k => k.kind === 'price' && k.status === 'succeeded' && Date.now() - k.updatedAt < NGHI_DOI_GIA_MS)
            .map(k => String(k.data?.itemId)))
        /* GIÁ SỐNG (03/11/2026): quyết theo giá GỐC đang để trên Shopee, không theo bản lưu — bản lưu chỉ mới bằng lần Đồng bộ
         * cuối và là giá ĐANG BÁN (đã trừ KM). Hàng phân loại / đang KM / không còn bán: bỏ qua. Đọc hỏng ⇒ chu kỳ không đổi giá. */
        let song: Map<string, GiaSongShopee> | null = null
        if (tranGhi <= 0) {
            results.push({ action: 'price', status: 'skipped', message: `Đã đủ ${pol.maxWritesPerDay} lần ghi hôm nay theo chính sách — đổi giá để mai.` })
        } else if (coVon.length) {
            try { song = await giaSongShopee(await dichVuCuaLuot(ctx, ch), coVon.map(l => l.platformProductId)) } catch (e: any) {
                results.push({ action: 'price', status: 'failed', message: `Không đọc được giá đang để trên Shopee — chu kỳ không đổi giá (${String(e?.message || e).slice(0, 200)})` })
            }
        }
        if (song) {
            const bo = { phanLoai: 0, khuyenMai: 0, khongBan: 0, khongThay: 0, choDuyet: 0, vuaDoi: 0, chuaBietPhi: 0 }
            const uv: { l: any; v: any; s: GiaSongShopee; mauPhi: MauPhi; quyet: { gia: number; lyDo: string }; uu: number }[] = []
            for (const l of coVon) {
                const s = song.get(String(l.platformProductId))
                if (!s) { bo.khongThay++; continue }
                if (s.coPhanLoai) { bo.phanLoai++; continue }
                if (s.trangThai && s.trangThai !== 'NORMAL') { bo.khongBan++; continue }
                if (!(s.giaGoc > 0)) { bo.khongThay++; continue }
                if (dangGiamGia(s)) { bo.khuyenMai++; continue }
                if (moNhap.has(String(l.platformProductId))) { bo.choDuyet++; continue }
                const v = von.get(l.id)!
                const mauPhi = bangPhi.chon(s.nganh || l.categoryId)   // phí ĐÚNG ngành — mỗi ngành Shopee thu một khác
                // chưa biết phí (ngành chưa đo trong gian chưa khai phí) ⇒ quyetDinhGia sẽ im lặng "giữ nguyên" — đếm ra để nói
                if (mauPhi.chuaBiet) { bo.chuaBietPhi++; continue }
                const ts = thamSoTinh(pol, v.giaVon, mauPhi)
                const kq = tinhGiaDeXuat(ts)
                const quyet = quyetDinhGia({
                    giaCu: s.giaGoc, ton: Number(l.stock) || 0, daBan14: daBan.get(String(l.sku || '').toLowerCase()) || 0,
                    kq, bienHienTaiPct: danhGiaGia(s.giaGoc, ts).bienPct, pol,
                })
                if (!quyet) continue
                const uu = s.giaGoc < kq.giaSan ? 0 : quyet.gia > s.giaGoc ? 1 : 2
                if (uu > 0 && vuaDoi.has(String(l.platformProductId))) { bo.vuaDoi++; continue }
                uv.push({ l, v, s, mauPhi, quyet, uu })
            }
            // đang dưới giá sàn (lỗ / sát lỗ qua affiliate) trước, rồi tăng, hạ giá sau cùng
            uv.sort((a, b) => a.uu - b.uu)
            const xet = uv.slice(0, tranGhi * 3 + TRAN_NHAP_MOI_CHU_KY)
            // chương trình đang / SẮP chạy: đổi giá gốc là đổi luôn mức giảm (tăng ngay trước đợt giảm còn dính luật "tăng giá ảo")
            let km = new Map<string, string>()
            if (xet.length) {
                try { km = await maDangKhuyenMai(await dichVuCuaLuot(ctx, ch), xet.map(u => u.l.platformProductId)) } catch (e: any) {
                    results.push({ action: 'price', status: 'skipped', message: `Chưa kiểm được chương trình sắp chạy trên các mã (${String(e?.message || e).slice(0, 120)}) — chỉ né được chương trình đang chạy.` })
                }
            }
            let soGhi = 0, soNhap = 0
            for (const u of xet) {
                if (soGhi >= tranGhi) break
                const id = String(u.l.platformProductId)
                if (km.has(id)) { bo.khuyenMai++; continue }
                const sku = u.l.sku || u.v.sku
                // Phí sàn chưa đủ tin ⇒ máy KHÔNG tự HẠ giá: để nháp chờ người duyệt. TĂNG giá thì được (lãi mỗi đơn tăng
                // theo giá — không bao giờ lỗ thêm); doiGiaShopee soát lại chiều tăng với giá đọc thẳng từ Shopee.
                const chuaTin = tuDong ? lyDoPhiChuaDuTin(u.quyet.gia, u.mauPhi, pol.minMarginRate * 100) : null
                const choDuyet = chuaTin && !(u.quyet.gia > u.s.giaGoc) ? chuaTin : null
                if (choDuyet && soNhap >= TRAN_NHAP_MOI_CHU_KY) continue
                try {
                    let plan: any = await taoKeHoachGia(ctx, { sku, itemId: id, price: u.quyet.gia, giaSong: u.s, idempotencyKey: `${tienTo}:price:${id}:${ngayVN()}:${u.quyet.gia}` })
                    // cùng khoá trong ngày đã thực thi / hỏng (đã báo ở lượt đó) — không ăn trần, không báo lặp
                    if (plan.status !== 'draft') continue
                    if (tuDong && !choDuyet) { plan = await thucThi(ctx, plan.id, { tuDong: true }); soGhi++ }
                    else if (choDuyet) soNhap++
                    else soGhi++   // Xem trước: nháp thay cho lần ghi
                    const p = plan.plan || plan
                    results.push({
                        action: 'price', status: p.status, sku, planId: p.id,
                        message: `${vnd(u.s.giaGoc)} → ${vnd(u.quyet.gia)}: ${u.quyet.lyDo}${p.result?.message ? ` — ${p.result.message}` : ''}${p.result?.warning ? ` — ${p.result.warning}` : ''}${choDuyet ? ` — CHỜ NGƯỜI DUYỆT: ${choDuyet}` : ''}`,
                    })
                } catch (e: any) {
                    soGhi++   // lỗi lập kế hoạch cũng tính một lượt — chu kỳ không quay mãi trên mã hỏng
                    results.push({ action: 'price', status: 'failed', sku, message: String(e?.message || e).slice(0, 300) })
                }
            }
            const boQua = [bo.chuaBietPhi && `${bo.chuaBietPhi} CHƯA BIẾT PHÍ sàn (khai phí ở Kênh bán online)`,
                bo.choDuyet && `${bo.choDuyet} đang chờ duyệt / người vừa huỷ`, bo.vuaDoi && `${bo.vuaDoi} vừa đổi giá trong 24 giờ (chờ xem đơn)`, bo.khuyenMai && `${bo.khuyenMai} đang / sắp chạy khuyến mãi`,
                bo.phanLoai && `${bo.phanLoai} có phân loại (sửa giá từng phân loại trên Shopee)`, bo.khongBan && `${bo.khongBan} không còn bán trên Shopee`,
                bo.khongThay && `${bo.khongThay} Shopee không trả giá`].filter(Boolean).join(', ')
            // mã chưa biết phí thì không biết có cần đổi hay không — đừng nói "không mã nào cần đổi giá"
            if (!soGhi && !soNhap) results.push({ action: 'price', status: 'unchanged', message: `Soát ${coVon.length} sản phẩm có giá vốn: ${bo.chuaBietPhi ? 'chưa đổi giá mã nào' : 'không mã nào cần đổi giá'}.${boQua ? ` Bỏ qua: ${boQua}.` : ''}` })
            else if (boQua) results.push({ action: 'price', status: 'skipped', message: `Bỏ qua: ${boQua}.` })
            if (soGhi >= tranGhi && uv.length > soGhi + soNhap) results.push({ action: 'price', status: 'skipped', message: `Mỗi chu kỳ đổi tối đa ${tranGhi} mã — còn ${uv.length - soGhi - soNhap} mã chờ chu kỳ sau.` })
        } else if (!coVon.length) {
            results.push({ action: 'price', status: 'unchanged', message: `Soát ${listing.length} sản phẩm đang bán: không mã nào có giá vốn để tính giá.` })
        }
    }

    if (pol.automation.publishNewProducts && !chuaBietPhi) {
        /* TỰ ĐĂNG (01/11/2026): chỉ hàng có HỒ SƠ ĐĂNG (ngành + cân nặng + thuộc tính do chủ shop khai theo nhóm/mã).
         * Hàng chưa có hồ sơ thì báo theo nhóm để chủ shop khai — không đoán ngành, không đoán cân nặng. */
        const uv = await timUngVien(ctx.prisma, ch.id, { lim: 100, chiDuDieuKien: true })
        const coHoSo = uv.ungVien.map(u => ({ u, hs: timHoSo(cfg.profiles, u.sku, u.nhomHang) })).filter(x => x.hs && !moNhap.has(`sku:${String(x.u.sku).toLowerCase()}`))
        const chuaHoSo = uv.ungVien.filter(u => !timHoSo(cfg.profiles, u.sku, u.nhomHang))
        let daDang = 0, soNhapDang = 0
        for (const { u, hs } of coHoSo) {
            if (daDang >= pol.maxPublishPerCycle) break
            try {
                let plan: any = await taoKeHoachDang(ctx, {
                    sku: u.sku, categoryId: hs!.categoryId, weightGram: hs!.weightGram, attributes: hs!.attributes,
                    brandId: hs!.brandId, brandName: hs!.brandName, hidden: hs!.hidden === true,
                    idempotencyKey: `${tienTo}:publish:${ch.id}:${u.sku}:${ngayVN()}`,
                })
                if (plan.status !== 'draft') continue   // đã đăng / hỏng hôm nay — đã báo ở lượt đó
                const choDuyet = tuDong ? (plan.data?.feeWarning as string | undefined) : undefined
                if (choDuyet) { if (soNhapDang >= TRAN_NHAP_MOI_CHU_KY) continue; soNhapDang++ } else daDang++
                if (tuDong && !choDuyet) plan = await thucThi(ctx, plan.id, { tuDong: true })
                const kh = plan.plan || plan
                results.push({
                    action: 'publish', status: kh.status, sku: u.sku, planId: kh.id,
                    message: `Theo hồ sơ ${hs!.scope === 'sku' ? 'mã' : 'nhóm'} "${hs!.key}" · giá ${vnd(kh.data?.payload?.original_price || 0)}${kh.result?.message ? ` — ${kh.result.message}` : ''}${choDuyet ? ` — CHỜ NGƯỜI DUYỆT: ${choDuyet}` : ''}`,
                })
            } catch (e: any) {
                daDang++
                results.push({ action: 'publish', status: 'failed', sku: u.sku, message: `Theo hồ sơ "${hs!.key}": ${String(e?.message || e).slice(0, 300)}` })
            }
        }
        if (coHoSo.length > daDang) results.push({ action: 'publish', status: 'skipped', message: `Còn ${coHoSo.length - daDang} mặt hàng có hồ sơ — mỗi chu kỳ đăng tối đa ${pol.maxPublishPerCycle}.` })
        if (chuaHoSo.length) {
            const theoNhom = new Map<string, number>()
            for (const u of chuaHoSo) theoNhom.set(u.nhomHang || '(không nhóm)', (theoNhom.get(u.nhomHang || '(không nhóm)') || 0) + 1)
            results.push({
                action: 'publish', status: 'skipped',
                message: `${chuaHoSo.length}${uv.ungVien.length >= 100 ? '+' : ''} mặt hàng đủ điều kiện nhưng CHƯA CÓ HỒ SƠ ĐĂNG (ngành + cân nặng): ${[...theoNhom].slice(0, 8).map(([n, c]) => `${n} (${c})`).join(', ')}. Khai hồ sơ ở Tự động hóa → Hồ sơ đăng hàng.`,
            })
        }
        if (!uv.ungVien.length) results.push({ action: 'publish', status: 'unchanged', message: 'Không còn mặt hàng kho đủ điều kiện (còn tồn, có giá vốn, có ảnh) mà chưa đăng.' })
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
    const bang = await docMauPhiTheoNganh(ctx.prisma, ch)
    const giaTheo = (mp: MauPhi) => {
        const ts = thamSoTinh(cfg.policy, Number(p.costPrice) || 0, mp)
        return { ...giaUi(tinhGiaDeXuat(ts), ts, mp), fee: tomTatMauPhi(mp, bang) }
    }
    return {
        sku: p.sku, title: p.name, description: p.description || '',
        // mỗi ngành gợi ý kèm giá theo phí CỦA NGÀNH ĐÓ (mỗi ngành Shopee thu một khác); `pricing` = phí cả gian khi chưa chọn ngành
        categories: goiY.filter(g => g.leaf !== false).map(g => ({ ...g, pricing: giaTheo(bang.chon(g.id)) })),
        ...(loi ? { categoryError: loi } : {}),
        pricing: giaTheo(bang.toanGian),
    }
}

/**
 * Tìm mặt hàng kho cho bộ chọn của HỒ SƠ ĐĂNG (01/11/2026, chủ shop: "chưa chọn nhóm hàng hoặc mã hàng cho AI agent
 * xử lý") — theo tên / mã / mã vạch, chỉ hàng hoá đăng riêng được (không dịch vụ, mã đã gộp, combo). Mỗi dòng kèm
 * nhóm, tồn, đủ giá vốn / ảnh chưa, đã có trên gian chưa, đã có hồ sơ nào áp chưa — để chọn đúng mã.
 */
export async function timHangChoHoSo(ctx: NgCanh, b: { keyword: string }): Promise<{ products: any[] }> {
    const tk = String(b?.keyword || '').trim()
    if (!tk) return { products: [] }
    const { cfg, ch } = await docCauHinh(ctx)
    const ds: any[] = await ctx.prisma.product.findMany({
        where: {
            productType: 'goods', mergedIntoId: null, bundleId: null,
            OR: [{ name: { contains: tk, mode: 'insensitive' } }, { sku: { contains: tk, mode: 'insensitive' } }, { barcode: tk }],
        },
        select: { id: true, sku: true, name: true, stock: true, costPrice: true, category: { select: { name: true } }, _count: { select: { images: true } } },
        orderBy: [{ stock: 'desc' }, { updatedAt: 'desc' }],
        take: 30,
    })
    const daCo: any[] = ch ? await ctx.prisma.onlineProduct.findMany({ where: { channelId: ch.id }, select: { localProductId: true, sku: true } }).catch(() => []) : []
    const daCoId = new Set(daCo.map(l => l.localProductId).filter(Boolean))
    const daCoSku = new Set(daCo.map(l => String(l.sku || '').trim().toLowerCase()).filter(Boolean))
    return {
        products: ds.map(p => {
            const hs = timHoSo(cfg.profiles, p.sku, p.category?.name)
            return {
                sku: p.sku, name: p.name, category: p.category?.name || null, stock: Number(p.stock) || 0,
                hasCost: Number(p.costPrice) > 0, hasImage: (p._count?.images || 0) > 0,
                listed: daCoId.has(p.id) || daCoSku.has(String(p.sku || '').toLowerCase()),
                profile: hs ? { scope: hs.scope, key: hs.key } : null,
            }
        }),
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

/**
 * KIỂM TRA API SHOPEE (01/11/2026) — gọi CHỈ ĐỌC từng nhóm API Pilot dùng, để sau khi deploy biết ngay gian thật
 * gọi được gì (các API đăng hàng / khuyến mãi viết theo tài liệu, chưa đo trên gian thật). `thuNapAnh`: nạp thêm
 * MỘT ảnh 1×1 lên kho ảnh Shopee (không gắn vào sản phẩm nào) để thử đường tải ảnh qua máy trung chuyển Tino.
 */
export async function kiemKetNoi(ctx: NgCanh, b: { thuNapAnh?: boolean } = {}): Promise<any> {
    const { ch } = await canGian(ctx)
    const svc = await moDichVuShopee(ctx.prisma, ch)
    const buoc: { ten: string; ok: boolean; chiTiet: string }[] = []
    const thu = async (ten: string, f: () => Promise<string>) => {
        try { buoc.push({ ten, ok: true, chiTiet: await f() }) } catch (e: any) { buoc.push({ ten, ok: false, chiTiet: String(e?.message || e).slice(0, 300) }) }
    }
    await thu('Thông tin gian (shop/get_shop_info)', async () => { const r = await svc.testConnection(); if (!r.success) throw new Error(r.error || 'không rõ'); return r.shopName || 'OK' })
    await thu('Giới hạn đăng (product/get_item_limit)', async () => { const r = await svc.getItemLimit(); return `giá ${vnd(Number(r?.price_limit?.min_limit) || 0)}–${vnd(Number(r?.price_limit?.max_limit) || 0)}, tên ≤ ${r?.item_name_length_limit?.max_limit ?? '?'} ký tự` })
    let la = 0
    await thu('Cây ngành (product/get_category)', async () => { const ds = await svc.getCategories('vi'); la = ds.find(c => !c.coCon)?.id || 0; return `${ds.length} ngành, ${ds.filter(c => !c.coCon).length} ngành lá` })
    const mau = await ctx.prisma.product.findFirst({ where: { productType: 'goods', stock: { gt: 0 } }, select: { name: true }, orderBy: { updatedAt: 'desc' } }).catch(() => null)
    await thu(`Gợi ý ngành (product/category_recommend "${(mau?.name || 'ổ cắm điện').slice(0, 40)}")`, async () => {
        const ids = await svc.categoryRecommend(mau?.name || 'ổ cắm điện'); if (ids[0]) la = ids[0]; return ids.length ? `ngành ${ids.slice(0, 3).join(', ')}` : 'không gợi ý ngành nào'
    })
    if (la) {
        await thu(`Thuộc tính ngành ${la} (product/get_attribute_tree)`, async () => { const t = await svc.getCategoryAttributes(la, 'vi'); return `${t.length} thuộc tính, ${t.filter(x => x.batBuoc).length} bắt buộc` })
        await thu(`Thương hiệu ngành ${la} (product/get_brand_list)`, async () => { const r = await svc.getBrandList(la); return `${r.thuongHieu.length}${r.conNua ? '+' : ''} thương hiệu, ${r.batBuoc ? 'BẮT BUỘC' : 'không bắt buộc'}` })
    }
    await thu('Kênh vận chuyển (logistics/get_channel_list)', async () => { const ds = await svc.getLogisticsChannels(); return `${ds.filter((c: any) => c.enabled !== false).length}/${ds.length} kênh đang bật` })
    await thu('Chương trình giảm giá (discount/get_discount_list)', async () => { const ds = await svc.getDiscountList('ongoing'); return `${ds.length} chương trình đang chạy` })
    if (b?.thuNapAnh) {
        // PNG 1×1 trong suốt — chỉ thử đường nạp ảnh, không gắn vào sản phẩm nào
        const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
        await thu('Nạp ảnh thử (media_space/upload_image)', async () => { const r = await svc.uploadImage(png, 'image/png'); return `image_id ${r.imageId}` })
    }
    const soListing = await ctx.prisma.onlineProduct.count({ where: { channelId: ch.id } })
    return {
        gian: ch.name, shopId: ch.shopId, tokenHetHan: ch.tokenExpiresAt, soSanPhamTrongHeThong: soListing,
        dat: buoc.filter(x => x.ok).length, tong: buoc.length, buoc,
    }
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
    const schedule = b?.schedule ? chuanHoaLich({ ...cfg.schedule, ...b.schedule }) : cfg.schedule
    /* Lịch bật mới / đổi nhịp ⇒ lượt kế = bây giờ + nhịp. Lịch giữ nguyên ⇒ giữ lượt kế đã hẹn. Tắt ⇒ bỏ hẹn. */
    const doiLich = schedule.enabled !== cfg.schedule.enabled || schedule.intervalMinutes !== cfg.schedule.intervalMinutes
    const nextRunAt = !schedule.enabled ? null : (!doiLich && cfg.nextRunAt) ? cfg.nextRunAt : Date.now() + schedule.intervalMinutes * 60_000
    const moi: CauHinhPilot = { ...cfg, channelId, executionMode, policy, schedule, nextRunAt, updatedAt: Date.now() }
    await ctx.kho.luuCauHinh(moi)
    return moi
}

// ─── Chạy theo lịch (gọi từ cron/aiAgentCron) ───────────────────────────────────

/**
 * Chạy MỘT chu kỳ nếu tới hẹn. Gọi mỗi nhịp cron cho các cửa hàng có cờ hasAiJobs (Pilot bật lịch thì bật cờ đó).
 * Cửa hàng chưa từng dùng Pilot thì bảng không tồn tại ⇒ im lặng trả 'khong-dung' (KHÔNG tạo bảng hộ).
 * Giành lượt bằng cách dời nextRunAt nguyên tử — nhiều bản máy cùng quét chỉ một bản chạy.
 */
export async function chayTheoLich(prisma: any, kho?: KhoPilot): Promise<'khong-dung' | 'chua-toi' | 'bi-gianh' | 'da-chay' | 'loi'> {
    let den: number, lich: LichPilot
    if (kho) {
        const c = await kho.docCauHinh()
        if (!c || c.nextRunAt == null) return 'khong-dung'
        den = c.nextRunAt; lich = c.schedule
    } else {
        let r: any
        try {
            [r] = await prisma.$queryRawUnsafe(`SELECT "nextRunAt"::float8 AS "nextRunAt", schedule FROM "ShopeePilotConfig" WHERE id = 'default'`)
        } catch {
            return 'khong-dung'
        }
        if (!r || r.nextRunAt == null) return 'khong-dung'
        den = Number(r.nextRunAt); lich = chuanHoaLich(docJson(r.schedule, {}))
    }
    if (!lich.enabled) return 'khong-dung'
    if (den > Date.now()) return 'chua-toi'
    const k = kho || khoSql(prisma)
    if (!(await k.gianhLich(den, Date.now() + lich.intervalMinutes * 60_000))) return 'bi-gianh'
    const luc = Date.now()
    const truoc = (await k.docCauHinh().catch(() => null))?.lastResult?.baoChuShop
    let ketQua: any
    try {
        ketQua = { ok: true, ...(await chuKyTheoLich(prisma, k, lich)) }
    } catch (e: any) {
        ketQua = { ok: false, message: String(e?.message || e).slice(0, 500) }
    }
    // Xem trước thì chưa ghi gì lên sàn — chỉ chu kỳ gãy mới báo; Tự động thì báo mọi việc cần người (lib/pilotBaoChuShop)
    const bao = ketQua.ok && ketQua.executionMode !== 'auto' ? truoc : await baoChuShop(prisma, 'Shopee Pilot', ketQua, truoc).catch(() => truoc)
    await k.ghiKetQuaLich(luc, { ...ketQua, ...(bao ? { baoChuShop: bao } : {}) }).catch(() => { })
    return ketQua.ok ? 'da-chay' : 'loi'
}

/** Một lượt theo lịch: gian đang chọn, hoặc MỌI gian Shopee đã uỷ quyền khi bật "Chạy cho tất cả gian" (lich.allChannels). */
async function chuKyTheoLich(prisma: any, k: KhoPilot, lich: LichPilot): Promise<{ executionMode: string; results: any[] }> {
    if (!lich.allChannels) return chayChuKy({ prisma, kho: k, nguoi: 'lich' })
    const kenh: any[] = ((await prisma.onlineChannel.findMany({ where: { platform: 'shopee' }, orderBy: { createdAt: 'asc' } })) || [])
        .filter((c: any) => c.accessToken && c.shopId)
    if (!kenh.length) return chayChuKy({ prisma, kho: k, nguoi: 'lich' })   // ném đúng lỗi "chưa kết nối / chưa uỷ quyền"
    const results: any[] = []
    let executionMode = 'preview'
    for (const c of kenh) {
        try {
            const kq = await chayChuKy({ prisma, kho: k, nguoi: 'lich', kenhId: c.id })
            executionMode = kq.executionMode
            for (const r of kq.results || []) results.push({ ...r, channel: c.name, message: `[${c.name}] ${r.message ?? ''}` })
        } catch (e: any) {
            results.push({ action: 'cycle', status: 'failed', channel: c.name, message: `[${c.name}] ${String(e?.message || e).slice(0, 300)}` })
        }
    }
    return { executionMode, results }
}

export const HUONG_DAN_PILOT = `SHOPEE PILOT TRÊN KENGI

Pilot giờ chạy trên máy chủ kengi, dữ liệu lấy thẳng từ kho của cửa hàng — không còn catalog.local.json, .env hay worker trên máy.

1. Kết nối
   - Mở kengi.vn → Bán Hàng Online → Shopee Pilot (https://kengi.vn/pilot-shopee/), đăng nhập bằng tài khoản Kengi.
   - Mọi người có quyền xem Sản Phẩm Trên Sàn đều xem được; lập kế hoạch, thực thi, đổi chính sách chỉ quản lý / chủ cửa hàng.
   - Gian Shopee lấy từ Kênh bán online của kengi. Cửa hàng có nhiều gian thì chọn gian ở Tự động hóa → Sửa chính sách.

2. Sản phẩm
   - Gồm sản phẩm đang có trên gian + hàng trong kho còn tồn chưa đăng.
   - Giá vốn, tồn kho, mô tả, ảnh lấy từ kho kengi. Thiếu giá vốn hoặc ảnh thì không đăng được.

3. Định giá
   - Phí Shopee đo từ chính các đơn đã đối soát của gian — KHÔNG lấy số đo của gian khác (gian Mall / gian thường, ngành hàng
     khác nhau thì phí khác nhau). Mỗi chỗ hiện phí đều ghi rõ nguồn: đo từ bao nhiêu đơn, của ngành nào / cả gian, hay số khai.
   - Gian chưa đủ 8 đơn đã đối soát: dùng phí sàn chủ shop KHAI cho gian ở Kênh bán online (Đơn Hàng Online → nút «Kênh bán
     hàng» → nút «Key» ở dòng của gian → ô «Phí sàn (%)») — người duyệt được, máy không tự đăng mới / hạ giá theo số khai.
     Ô phí còn để mặc định 6% (chưa khai) thì CHƯA BIẾT PHÍ: không tính được giá, không ghi được giá nào cho tới khi khai phí.
   - Giá đề xuất = đạt lãi mục tiêu sau phí sàn, đóng gói, quảng cáo, thuế GTGT (nếu khai). Giá sàn = lãi tối thiểu
     NGAY CẢ KHI đơn đi qua affiliate (cộng trọn "Hoa hồng affiliate"). Máy chủ từ chối mọi giá dưới giá sàn.
   - Doanh nghiệp nộp GTGT khấu trừ: khai "Thuế GTGT trên giá bán" — tiền Shopee chuyển về không trừ thuế đầu ra.
   - Máy (chu kỳ Tự động, AI) chỉ tự đăng mới / hạ giá khi phí đã đo từ ≥ 30 đơn đối soát và đủ chắc ở mức giá đó. Phí khai,
     mới đo từ ít đơn, giá thấp hơn mọi đơn đã đo, hay phí các đơn lệch nhau nhiều: kế hoạch để nháp chờ người duyệt.
     TĂNG giá (vd hàng đang bán dưới giá sàn) thì máy vẫn tự làm — tăng giá không bao giờ làm lỗ thêm.
   - Khuyến mãi soát lại giá sàn lúc thực thi; dòng nào giá vốn / phí đã đổi làm giá KM dưới sàn thì bị bỏ.

4. Kế hoạch → thực thi
   - Mọi thao tác ghi tạo KẾ HOẠCH trước. Chế độ Xem trước: thực thi không gọi Shopee. Chế độ Tự động: thực thi ghi lên Shopee thật.
   - Giới hạn: đổi giá tối đa X% mỗi lần, số thao tác ghi mỗi ngày, mức giảm khuyến mãi tối đa, thời lượng chương trình.

5. Hồ sơ đăng hàng
   - Kho Kengi không có ngành Shopee, cân nặng, thuộc tính. Khai một lần ở Tự động hóa → Hồ sơ đăng hàng:
     cho cả NHÓM HÀNG (chọn trong danh sách nhóm của kho, kèm số mã) hoặc cho MỘT MÃ (tìm theo tên / mã; mã thắng nhóm).
     Cũng lưu được ngay trong form Đăng hàng.
   - Cân nặng theo nhóm chỉ dùng khi các mã trong nhóm cùng cỡ.

6. Chu kỳ
   - Đồng bộ tồn (nếu bật), soát và đổi giá tối đa 10 mã mỗi chu kỳ.
   - Tự đăng tối đa N mã có hồ sơ (chính sách "Tự đăng tối đa mỗi chu kỳ"); mã chưa có hồ sơ được báo theo nhóm.
   - Chạy theo lịch: bật ở Sửa chính sách (mỗi 30–1440 phút), máy chủ tự chạy, không cần mở trang.
     Cửa hàng nhiều gian: bật "Lịch chạy cho cả N gian" — mỗi kế hoạch ghi đúng gian của nó.
   - Giá quyết theo giá GỐC đọc thẳng từ Shopee; bỏ qua hàng đang / sắp chạy khuyến mãi, hàng có phân loại.
     Mỗi mã máy đổi giá tối đa 1 lần / 24 giờ (trừ mã đang dưới giá sàn); mã đang lỗ được xét trước.
   - Danh mục trong hệ thống cũ hơn 2 giờ thì chu kỳ tự đồng bộ lại (như bấm Đồng bộ).
   - Đẩy tồn có cầu dao: lượt đẩy làm nhiều mã đang có hàng về 0 thì KHÔNG đẩy, báo người kiểm tồn kho / kho mẹ.
   - Nháp chờ duyệt: máy lập thì tự huỷ sau 3 ngày; bấm Huỷ = máy không đề xuất lại mã đó trong 14 ngày.
   - Gian chưa biết phí sàn: chu kỳ không đổi giá, không đăng mới (vẫn đẩy tồn, đồng bộ danh mục), báo MỘT dòng kèm đường khai phí.
   - Có việc cần người (nháp chờ duyệt, ghi hỏng, cầu dao, chưa biết phí, chu kỳ lỗi): chuông + app báo một lần mỗi khi danh sách đổi.

7. Kiểm tra API Shopee
   - Trang Kết nối Shopee → Kiểm tra API Shopee: gọi chỉ đọc từng nhóm API (ngành, thuộc tính, thương hiệu, vận chuyển, khuyến mãi).
   - "Thử cả nạp ảnh" nạp một ảnh 1×1 lên kho ảnh Shopee (không gắn vào sản phẩm nào) để thử đường tải ảnh.
`
