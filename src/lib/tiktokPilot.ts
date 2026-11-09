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
 *    - quá maxWritesPerDay lần ghi/ngày (tính cả lần hỏng); chu kỳ tính trần CÒN LẠI trước vòng lặp — hết lượt là MỘT dòng
 *      'skipped', không phải loạt 'failed' báo động giả lên chuông chủ shop (09/11/2026)
 *  Lô 3 (09/11/2026) — quyết theo giá THẬT, không báo động giả, không giành giá người sửa:
 *    - giá đang bán = số DƯƠNG đầu tiên đọc thẳng TikTok (chu kỳ đọc cả lô products/search TRƯỚC khi xếp ứng viên);
 *      giá 0 / rỗng / đọc hỏng ⇒ không đổi (trước: `??` lấy cả "" ⇒ giá 0 lọt rào biên độ lẫn rào chỉ-tăng)
 *    - nghỉ 24 giờ tính theo lúc THỰC THI; giá chủ shop sửa tay (khác giá Pilot ghi lần cuối) ⇒ để yên 7 ngày
 *    - TikTok khoá giá vì khuyến mãi ⇒ 'skipped' + nghỉ mã đó 24 giờ; làm mới token hỏng / mã 105005·106011·106001 ⇒ MỘT
 *      dòng action 'token' (lib/pilotBaoChuShop bắt), lượt đó dừng ghi lên TikTok
 *    - đồng bộ danh mục trong chu kỳ lấy luôn mã NGÀNH cho mã mới (một mã lỗi không dừng lượt)
 *  CHƯA làm: đăng sản phẩm mới lên TikTok, khuyến mãi — cần thử trên gian thật trước (ngành / thuộc tính / kho TikTok).
 *  Pilot CHƯA biết khuyến mãi SẮP chạy (không có API khuyến mãi đã kiểm trên gian thật) ⇒ hướng dẫn chủ shop tắt đổi giá trước đợt lớn.
 * ═══════════════════════════════════════════════════════════════════════════════ */

import crypto from 'crypto'
import { ToolError } from './mcpTypes'
import { tinhGiaDeXuat, danhGiaGia, chanGiaDuoiSan, lyDoPhiChuaDuTin, lyDoChuaBietPhi, dongChuKyChuaBietPhi, SO_DON_TU_GHI, type ThamSoGia, type KetQuaGia, type MauPhi } from './giaShopee'
import { docMauPhiSanPham, docMauPhiTheoNganh, tomTatMauPhi, luuDanhMucSan } from './shopeeTuQuan'
import { num, giaVonHangLoat, soBan14Ngay, daBanCuaListing, timUngVien, THIEU_MO_TA, soatSkuTrung } from './shopeeThaoTac'
import { chuanHoaChinhSach, quyetDinhGia, vuotBienDong, dauNgayVN, dayTonChuKy, cauConDuoiSan, NGHI_DOI_GIA_MS } from './shopeePilot'
import { baoChuShop, ketQuaDeBao } from './pilotBaoChuShop'
import { ghiDoiCauHinh, NHAN_TIKTOK } from './pilotDoiCauHinh'
import { TikTokService } from '../services/platforms/tiktok'

const docJson = (s: any, d: any = null) => { try { return s ? JSON.parse(s) : d } catch { return d } }
const kep = (v: any, d: number, min: number, max: number) => Math.min(Math.max(num(v, d), min), max)
const ngayVN = (now = Date.now()) => new Date(now + 7 * 3600_000).toISOString().slice(0, 10)
const vnd = (n: number) => `${Math.round(n).toLocaleString('vi-VN')}đ`
/** "dd/mm" theo giờ VN — mốc "để yên tới" trên dòng chu kỳ / trang */
const ngayThangVN = (ms: number) => { const d = new Date(ms + 7 * 3600_000).toISOString(); return `${d.slice(8, 10)}/${d.slice(5, 7)}` }

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
    /** kế hoạch ở các trạng thái `trangThai`, CẬP NHẬT (thực thi / bỏ qua) từ mốc `tuLuc`, mới nhất trước (09/11/2026, TT-11):
     *  nghỉ 24 giờ phải tính từ lúc THỰC THI — dsKeHoachTu lọc theo lúc LẬP nên nháp lập 2 ngày trước vừa duyệt lọt ra ngoài.
     *  Cũng là nguồn "giá Pilot ghi lần cuối" (giữ giá người sửa) và mốc nghỉ khi TikTok khoá giá vì khuyến mãi. */
    dsKeHoachTheoTrangThai(trangThai: string[], tuLuc: number): Promise<KeHoachTikTok[]>
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
        async dsKeHoachTheoTrangThai(trangThai, tuLuc) {
            return (await q(`SELECT ${COT_KH} FROM "TikTokPilotPlan" WHERE status = ANY($1::text[]) AND "updatedAt" >= $2 ORDER BY "updatedAt" DESC LIMIT 2000`,
                trangThai, tuLuc)).map(hangKeHoach)
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
            // dòng 'config' (ai đổi cấu hình, X-14) không phải lệnh ghi lên TikTok — không tính trần ghi / ngày
            const [r] = await q(`SELECT COUNT(*)::int AS n FROM "TikTokPilotWrite" WHERE "createdAt" >= $1 AND action <> 'config'`, ms)
            return Number(r?.n) || 0
        },
    }
}

/** Kho trong bộ nhớ — cho bộ kiểm (cùng hợp đồng với khoSqlTikTok). `dongHo` = đồng hồ đóng dấu updatedAt / createdAt sổ ghi
 *  (09/11/2026: bộ kiểm nghỉ 24 giờ / giữ giá 7 ngày chạy đồng hồ giả — mặc định đồng hồ thật như trước). */
export function khoBoNhoTikTok(dongHo: () => number = () => Date.now()): KhoTikTokPilot & { _keHoach: KeHoachTikTok[]; _nhatKy: NhatKyTikTok[] } {
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
        async gianhKeHoach(id) { const k = keHoach.find(x => x.id === id); if (!k || k.status !== 'draft') return false; k.status = 'running'; k.updatedAt = dongHo(); return true },
        async capNhatKeHoach(id, status, result) { const k = keHoach.find(x => x.id === id); if (k) { k.status = status; k.result = sao(result); k.updatedAt = dongHo() } },
        async huyKeHoach(id) { const k = keHoach.find(x => x.id === id); if (!k || k.status !== 'draft') return false; k.status = 'cancelled'; k.updatedAt = dongHo(); return true },
        async dsKeHoach(lim) { return sao([...keHoach].sort((a, b) => b.createdAt - a.createdAt).slice(0, lim)) },
        async dsKeHoachTu(tuLuc) { return sao(keHoach.filter(k => k.createdAt >= tuLuc)) },
        async dsKeHoachTheoTrangThai(trangThai, tuLuc) {
            return sao(keHoach.filter(k => trangThai.includes(k.status) && k.updatedAt >= tuLuc).sort((a, b) => b.updatedAt - a.updatedAt))
        },
        async ghiNhatKy(w) { nhatKy.push({ ...sao(w), id: crypto.randomUUID(), createdAt: dongHo() }) },
        async dsNhatKy(lim) { return sao([...nhatKy].sort((a, b) => b.createdAt - a.createdAt).slice(0, lim)) },
        async demGhiTuLuc(ms) { return nhatKy.filter(w => w.createdAt >= ms && w.action !== 'config').length },
    }
}

// ─── Ngữ cảnh ───────────────────────────────────────────────────────────────────

/** Phần TikTokService Pilot dùng — bộ kiểm thay bằng TikTok giả ghi lại mọi lời gọi. */
export interface DichVuTikTok {
    testConnection(): Promise<{ success: boolean; shopName?: string; error?: string }>
    getProductDetail(productId: string): Promise<any>
    updatePrice(productId: string, price: number, skuId?: string, sellerSku?: string): Promise<void>
    getOrderSettlement(orderId: string): Promise<{ settlementAmount: number; feeAmount: number; revenueAmount: number; affiliateFee?: number | null } | null>
    /** danh mục gian (cùng đường nút "Đồng bộ") — chu kỳ tự làm mới khi bản lưu cũ; bộ kiểm không giả thì chu kỳ bỏ bước này */
    fetchProducts?(): Promise<{ products: any[]; total?: number }>
    /** sản phẩm THÔ của gian (products/search mọi trang: skus[] có id / seller_sku / price, status) — chu kỳ đọc giá SỐNG cả lô
     *  trong vài lời gọi (09/11/2026). Dịch vụ không có (bộ kiểm cũ) ⇒ đọc từng mã getProductDetail. */
    timSanPhamTho?(): Promise<any[]>
    /** mã ngành của một sản phẩm (product detail.category_chains) — bổ sung ngành cho mã mới sau đồng bộ danh mục (09/11/2026) */
    fetchProductCategory?(productId: string): Promise<{ categoryId: string; categoryName: string } | null>
    /** moDichVuTikTok ghi lý do khi làm mới token HỎNG (09/11/2026, TT-20) — lượt đó không ghi gì lên TikTok */
    loiLamMoiToken?: string | null
}

/** banDocSan: bản đọc sàn của lượt chạy thử — shopeePilot.dayTonChuKy đưa lại cho lượt thật (lib/dayTonLenSan, 10/11/2026) */
export interface KetQuaDayTonGon { ok: boolean; loi?: string; data?: any; banDocSan?: any }

export interface NgCanhTikTok {
    prisma: any
    kho: KhoTikTokPilot
    nguoi?: string | null
    /** TikTok giả cho bộ kiểm; bỏ trống ⇒ TikTokService thật bằng token của gian (tự làm mới khi sắp hết hạn) */
    taoTikTok?: (ch: any) => Promise<DichVuTikTok>
    /** đẩy tồn giả cho bộ kiểm; bỏ trống ⇒ lib/dayTonLenSan */
    dayTon?: (prisma: any, channelId: string, o: { dryRun?: boolean; docSanTruoc?: any }) => Promise<KetQuaDayTonGon>
    bayGio?: () => number
    /** dịch vụ đã mở trong lượt này (theo gian) — mở MỘT lần mỗi lượt: mỗi lần mở có thể làm mới token */
    _dichVu?: Map<string, Promise<DichVuTikTok>>
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
            /* 09/11/2026 (TT-20): trước chỉ console.warn rồi chạy tiếp bằng token sắp / đã hết hạn ⇒ mỗi lần ghi sau đó hỏng một
             * kiểu khó hiểu, không ai được bảo phải uỷ quyền lại. Giờ ghi lý do lên dịch vụ: chu kỳ ra MỘT dòng action 'token'
             * (lib/pilotBaoChuShop bắt) và không ghi gì lượt đó; thực thi tay từ chối với cùng câu chỉ đường. */
            const lyDo = String(e?.message || e || 'không rõ').slice(0, 300)
            console.warn(`[TikTokPilot] làm mới token ${ch.name} hỏng:`, lyDo)
            ;(svc as any).loiLamMoiToken = lyDo
        }
    }
    return svc as unknown as DichVuTikTok
}

/** TikTokService của gian, mở MỘT lần mỗi lượt (chu kỳ / thực thi / lập kế hoạch) — cùng khuôn lib/shopeePilot.dichVuCuaLuot:
 *  mỗi lần mở có thể làm mới token (09/11/2026: trước mỗi bước mở lại, một chu kỳ có thể làm mới token vài lần). */
function dichVu(ctx: NgCanhTikTok, ch: any): Promise<DichVuTikTok> {
    const bo = (ctx._dichVu ||= new Map())
    let fb = bo.get(ch.id)
    if (!fb) { fb = ctx.taoTikTok ? ctx.taoTikTok(ch) : moDichVuTikTok(ctx.prisma, ch); bo.set(ch.id, fb) }
    return fb
}

/** Mã lỗi TikTok của token hết hạn / bị thu hồi / sai (09/11/2026, TT-20) — cần chủ shop uỷ quyền lại, thử lại không ích gì. */
const MA_LOI_TOKEN_TIKTOK = /\b(105005|106011|106001)\b/
/** Token TikTok hỏng — chu kỳ dừng ghi, báo MỘT dòng action 'token'. `lyDo` = lời gốc (TikTok / lỗi làm mới), message = câu chỉ đường. */
export class LoiTokenTikTok extends ToolError {
    constructor(readonly lyDo: string, tenGian?: string | null) { super(cauUyQuyenLaiTikTok(tenGian, lyDo)) }
}
export const laLoiTokenTikTok = (e: any): boolean => e instanceof LoiTokenTikTok || MA_LOI_TOKEN_TIKTOK.test(String(e?.message || e || ''))

/** Câu báo uỷ quyền lại — ĐƯỜNG BẤM đứng đầu (thông báo chủ shop cắt 180 ký tự / việc), lý do kỹ thuật để cuối. */
export function cauUyQuyenLaiTikTok(tenGian: string | null | undefined, lyDo: string): string {
    const gian = tenGian ? `gian TikTok "${tenGian}"` : 'gian TikTok'
    const duong = 'Đơn Hàng Online → nút «Kênh bán hàng» → nút «Cấp lại quyền» ở dòng của gian'
    const ly = String(lyDo || 'không rõ').slice(0, 200)
    // mất mạng giữa lúc làm mới thì chưa chắc token hỏng — vẫn dừng ghi lượt này (token có thể đã hết hạn), nói đúng mức.
    // "dừng ghi" chứ không "không ghi gì": mã token có thể tới SAU vài lần ghi đã xong trong cùng lượt
    return laLoiMang(lyDo)
        ? `Không làm mới được token ${gian} (mất kết nối?) — Pilot dừng ghi lên TikTok lượt này; lặp lại thì uỷ quyền lại: ${duong}. (${ly})`
        : `Cần uỷ quyền lại ${gian} — ${duong}. Pilot dừng ghi lên TikTok lượt này. (${ly})`
}

/** TikTok khoá giá vì đang khuyến mãi (09/11/2026, TT-04 một phần). Mã theo tài liệu THỨ CẤP, chưa xác nhận trên tài liệu chính
 *  thức: 12052038 "Product price locked due to ongoing promotion", 12019045 "price is locked" — nên bắt cả câu chữ. Không phải
 *  hỏng: sàn chặn đúng luật của nó ⇒ 'skipped' + nghỉ mã 24 giờ, không vào việc cần người. KHÔNG gọi API khuyến mãi nào. */
export function laLoiKhoaGiaKhuyenMai(e: any): boolean {
    const m = String(e?.message || e || '')
    return /\b(12052038|12019045)\b/.test(m) || /price\s+(is\s+)?locked|locked\s+due\s+to\s+(an?\s+)?(ongoing\s+)?promotion/i.test(m)
}

async function dayTon(ctx: NgCanhTikTok, channelId: string, o: { dryRun?: boolean; docSanTruoc?: any }): Promise<KetQuaDayTonGon> {
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

/** Chạm trần thao tác ghi / ngày theo chính sách — KHÔNG phải hỏng (09/11/2026, TT-10): chu kỳ dừng ghi, giữ nháp, báo MỘT dòng
 *  'skipped'; thực thi tay vẫn nhận lỗi này (400) như trước. */
export class LoiHetLuotGhi extends ToolError { }

async function conLuotGhi(ctx: NgCanhTikTok, pol: ChinhSachTikTok) {
    const dem = await ctx.kho.demGhiTuLuc(dauNgayVN(luc(ctx)))
    if (dem >= pol.maxWritesPerDay) throw new LoiHetLuotGhi(`Đã đạt giới hạn ${pol.maxWritesPerDay} thao tác ghi hôm nay theo chính sách — để mai hoặc nâng giới hạn.`)
}

/** Lỗi khi sản phẩm có nhiều SKU — chu kỳ nhớ để không hỏi lại TikTok mỗi lượt. */
export class LoiNhieuSku extends ToolError { constructor(msg: string, readonly soSku: number) { super(msg) } }

/** Giá một SKU TikTok = số DƯƠNG đầu tiên trong tax_exclusive_price, sale_price (09/11/2026, TT-09). `??` cũ nhận cả "" / "0" của
 *  tax_exclusive_price ⇒ giá sống 0 ⇒ vuotBienDong(0, …) trả null và `gia > 0` qua rào chỉ-tăng. Không có số dương ⇒ 0. */
export function giaSkuTikTok(s: any): number {
    for (const v of [s?.price?.tax_exclusive_price, s?.price?.sale_price]) {
        const n = Number(v)
        if (Number.isFinite(n) && n > 0) return n
    }
    return 0
}

/** Giá + SKU đọc THẲNG từ TikTok cho một sản phẩm (lô products/search hoặc product detail). */
export interface GiaSongTikTok {
    soSku: number
    /** mã / seller SKU / giá — chỉ khi đúng MỘT SKU */
    skuId: string | null
    sellerSku: string | null
    gia: number
    /** MỌI số giá dương của SKU (tax_exclusive_price, sale_price) — nhận giá Pilot đã ghi dù TikTok trả ở trường nào */
    cacGia: number[]
    /** status của sản phẩm trên TikTok (null = không trả) */
    trangThai: string | null
}

export function giaSongTuSanPham(p: any): GiaSongTikTok {
    const skus: any[] = Array.isArray(p?.skus) ? p.skus : []
    const s = skus.length === 1 ? skus[0] : null
    const cacGia = s ? [s?.price?.tax_exclusive_price, s?.price?.sale_price].map(Number).filter(n => Number.isFinite(n) && n > 0) : []
    return {
        soSku: skus.length, skuId: s?.id ? String(s.id) : null, sellerSku: s?.seller_sku ? String(s.seller_sku) : null,
        gia: s ? giaSkuTikTok(s) : 0, cacGia, trangThai: p?.status ? String(p.status) : null,
    }
}

/** Soát một giá sống trước khi dùng để ĐỔI giá: đúng MỘT SKU, có mã SKU, giá > 0 — không thì ném (không đổi). */
function skuDuyTu(s: GiaSongTikTok): { skuId: string; sellerSku: string | null; gia: number } {
    if (s.soSku !== 1) {
        if (!s.soSku) throw new ToolError('TikTok không trả SKU nào của sản phẩm này — không đọc được giá đang bán, không đổi giá.')
        throw new LoiNhieuSku(`Sản phẩm có ${s.soSku} phân loại (SKU) — Pilot chưa đổi giá hàng nhiều phân loại (chưa biết giá vốn từng phân loại); sửa giá trên TikTok Seller Center.`, s.soSku)
    }
    if (!s.skuId) throw new ToolError('TikTok không trả mã SKU — không đổi giá được.')
    // giá 0 / rỗng: không biết giá đang bán ⇒ rào biên độ và rào chỉ-tăng mất tác dụng — không đổi (09/11/2026)
    if (!(s.gia > 0)) throw new ToolError('TikTok trả giá đang bán 0 / rỗng — không đọc được giá đang bán, không đổi giá.')
    return { skuId: s.skuId, sellerSku: s.sellerSku, gia: s.gia }
}

/** SKU DUY NHẤT của sản phẩm + giá đang bán, đọc THẲNG từ TikTok (giá trong hệ thống có thể cũ). Nhiều SKU ⇒ LoiNhieuSku;
 *  đọc hỏng / giá 0 ⇒ ToolError "không đọc được giá đang bán — không đổi giá" (09/11/2026: trước giá 0 vẫn đi tiếp). */
export async function docSkuDuy(fb: DichVuTikTok, productId: string): Promise<{ skuId: string; sellerSku: string | null; gia: number }> {
    let d: any
    try {
        d = await fb.getProductDetail(productId)
    } catch (e: any) {
        // chưa gửi gì lên TikTok ⇒ ToolError ('failed'), không phải lỗi mạng sau khi gửi ('uncertain'); giữ nguyên lời TikTok
        const loi = String(e?.message || e).slice(0, 200)
        if (laLoiTokenTikTok(e)) throw new LoiTokenTikTok(e instanceof LoiTokenTikTok ? e.lyDo : loi)
        throw new ToolError(`Không đọc được giá đang bán trên TikTok — không đổi giá. (${loi})`)
    }
    return skuDuyTu(giaSongTuSanPham(d))
}

/** Giá sống theo LÔ cho chu kỳ (09/11/2026, TT-09 — như lib/shopeePilot.giaSongShopee): quyết giá theo giá đang bán THẬT, không
 *  theo bản lưu (cũ tới 2 giờ — đồng bộ danh mục). products/search mọi trang trong vài lời gọi; dịch vụ không có (bộ kiểm cũ) ⇒
 *  từng mã getProductDetail. Lô hỏng (hoặc mọi mã đều hỏng, hoặc lỗi token) ⇒ NÉM: chu kỳ không đổi giá mã nào. Mã TikTok không
 *  trả / đọc lẻ hỏng thì vắng trong map ⇒ chu kỳ không đổi mã đó. */
export async function giaSongLoTikTok(fb: DichVuTikTok, ids: string[]): Promise<Map<string, GiaSongTikTok>> {
    const can = new Set(ids.map(String))
    const ra = new Map<string, GiaSongTikTok>()
    if (typeof fb.timSanPhamTho === 'function') {
        for (const p of await fb.timSanPhamTho()) if (can.has(String(p?.id))) ra.set(String(p.id), giaSongTuSanPham(p))
        return ra
    }
    let loiDau: any = null
    for (const id of can) {
        try {
            ra.set(id, giaSongTuSanPham(await fb.getProductDetail(id)))
        } catch (e: any) {
            if (laLoiTokenTikTok(e)) throw e
            loiDau ||= e
        }
    }
    if (loiDau && !ra.size) throw loiDau
    return ra
}

/** SKU trùng giữa nhiều listing ⇒ từ chối, bắt chọn theo mã sản phẩm TikTok (SP-11 / shopeeThaoTac.soatSkuTrung) — không chọn bừa. */
export async function timListingTikTok(prisma: any, channelId: string, a: { itemId?: any; sku?: any }): Promise<any> {
    let l: any = null
    if (a?.itemId) l = await prisma.onlineProduct.findFirst({ where: { channelId, platformProductId: String(a.itemId) } })
    else if (a?.sku) l = await prisma.onlineProduct.findFirst({ where: { channelId, sku: { equals: String(a.sku), mode: 'insensitive' } } })
    else throw new ToolError('Cần mã sản phẩm TikTok hoặc SKU')
    if (!l) throw new ToolError('Không thấy sản phẩm này trên gian (bấm Đồng bộ sản phẩm ở Kênh bán online nếu vừa đăng ngoài hệ thống).')
    if (!a?.itemId) await soatSkuTrung(prisma, channelId, String(a.sku), l)
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
/** Số nháp tối đa /state trả cho khối "Chờ duyệt" (kèm `draftsTotal`). */
export const TRAN_NHAP_UI = 300
/** Dòng GHI NHỚ của máy trong sổ kế hoạch: 'skipped' không mang giá (đã biết nhiều phân loại / giá người vừa sửa) — không phải kế
 *  hoạch người cần xem. 'skipped' có giá là lần thử thật bị TikTok khoá giá (khuyến mãi). */
const laGhiNho = (k: KeHoachTikTok) => k.status === 'skipped' && !(Number(k.data?.price) > 0)
/** Trạng thái TikTok coi là đang bán (bộ sản phẩm đồng bộ ghi nguyên status của TikTok) */
const DANG_BAN = ['ACTIVATE', 'LIVE']

export async function xayTrangThaiTikTok(ctx: NgCanhTikTok): Promise<any> {
    const now = luc(ctx)
    const { cfg, kenh, ch } = await docCauHinhTikTok(ctx)
    const pol = cfg.policy
    // TUẦN TỰ có chủ ý: pool Prisma của cửa hàng chỉ 1 kết nối trên prod
    // 10/11/2026 (TT-13): bỏ dòng GHI NHỚ của máy ('skipped' không có giá — nhiều phân loại, giá người sửa) khỏi danh sách kế hoạch
    // ở máy chủ: trước chúng chiếm chỗ trong 60 dòng mới nhất, trình duyệt lọc đi ⇒ danh sách hụt, nháp thật bị đẩy khuất.
    // 'skipped' CÓ giá = lần thử thật bị TikTok khoá giá (khuyến mãi) — vẫn giữ.
    const plans = (await ctx.kho.dsKeHoach(300)).filter(k => !laGhiNho(k)).slice(0, 60)
    // MỌI nháp đang mở (không chỉ phần lọt vào 60 kế hoạch mới nhất) — khối "Chờ duyệt" duyệt / huỷ hàng loạt
    const moHet = await ctx.kho.dsKeHoachTheoTrangThai(['draft'], 0)
    const drafts = moHet.slice(0, TRAN_NHAP_UI)
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
    const goc = { now, todayWrites, plans, audit, status, drafts, draftsTotal: moHet.length }
    if (!ch) {
        status.notice = kenh.length ? `Cửa hàng có ${kenh.length} gian TikTok — chọn một gian ở Tự động hóa → Sửa chính sách.` : 'Cửa hàng chưa kết nối gian TikTok nào.'
        return { ...goc, products: [], unlisted: [] }
    }
    const listing: any[] = await ctx.prisma.onlineProduct.findMany({ where: { channelId: ch.id }, orderBy: { updatedAt: 'desc' }, take: TRAN_LISTING })
    const von = await giaVonHangLoat(ctx.prisma, listing)
    // đọc hỏng ⇒ null: cột "đã bán 14 ngày" hiện "—", không hiện 0 (TT-18, 10/11/2026)
    const daBan = await soBan14Ngay(ctx.prisma, ch.id).catch((e: any) => { console.error('[TikTokPilot] đọc số bán 14 ngày hỏng:', e?.message || e); return null })
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
        // 09/11/2026 (TT-12): sản phẩm CHƯA RÕ NGÀNH (TikTok search không trả ngành; chu kỳ / nút Đồng bộ lấy dần) — chỉ có nghĩa khi
        // gian đã đo phí riêng từng ngành: lúc đó mã chưa rõ ngành dùng phí cả gian gắn cờ ⇒ máy chỉ tự TĂNG giá
        uncategorized: bang.theoNganh.size ? listing.filter(l => !String(l.categoryId ?? '').trim()).length : 0,
    }
    const nhieuSku = await maNhieuSkuGanDay(ctx, now)
    const deYen = await maDangDeYen(ctx, now)
    const products: any[] = listing.map(l => {
        const v = von.get(l.id)
        const giaVon = v && v.giaVon > 0 ? v.giaVon : 0
        const mp = bang.chon(l.categoryId)
        const ts = thamSoTinh(pol, giaVon, mp)
        const kq = tinhGiaDeXuat(ts)
        const dangBan = DANG_BAN.includes(String(l.status || '').toUpperCase())
        const soSku = nhieuSku.get(String(l.platformProductId))
        const hold = lyDoDeYen(deYen, String(l.platformProductId), Number(l.price) || 0)
        return {
            sku: l.sku || null, itemId: l.platformProductId, name: l.name, status: l.status, active: dangBan,
            imageUrl: l.imageUrl || null, costPrice: giaVon || null, currentPrice: Number(l.price) || null, stock: Number(l.stock) || 0,
            sold14: daBan ? daBanCuaListing(daBan, l) : null, mapped: !!v, localSku: v?.sku || null,
            enabled: giaVon > 0 && dangBan && !soSku,
            // máy đang để yên mã này (chủ shop vừa sửa giá tay / TikTok khoá giá vì khuyến mãi) — người vẫn lập kế hoạch được
            ...(hold ? { hold } : {}),
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

/** Giá chủ shop vừa sửa tay ⇒ máy để yên chừng này kể từ lúc PHÁT HIỆN (09/11/2026, TT-14). */
const GIU_GIA_NGUOI_SUA_MS = 7 * 86400_000
/** TikTok khoá giá vì khuyến mãi ⇒ máy nghỉ mã đó chừng này kể từ lần bị từ chối (09/11/2026, TT-04). */
const NGHI_KHUYEN_MAI_MS = 24 * 3600_000
/** Cửa sổ tìm "giá Pilot ghi lần cuối": mã Pilot không ghi trong chừng này coi như chưa từng ghi ⇒ xét như cũ. */
const CUA_SO_GIA_PILOT_MS = 30 * 86400_000
const gioNgayVN = (ms: number) => { const d = new Date(ms + 7 * 3600_000).toISOString(); return `${d.slice(11, 16)} ${d.slice(8, 10)}/${d.slice(5, 7)}` }

interface DeYen { nguoiSua: Map<string, KeHoachTikTok>; khuyenMai: Map<string, KeHoachTikTok>; theoKhoa: Map<string, KeHoachTikTok> }

/** Mã máy đang ĐỂ YÊN (09/11/2026): giá chủ shop vừa sửa tay (7 ngày từ lúc phát hiện) và mã TikTok vừa khoá giá vì khuyến mãi
 *  (24 giờ từ lần bị từ chối). Đọc dòng 'skipped' của sổ kế hoạch (bảng đã có — không đổi schema, không gọi TikTok). */
async function maDangDeYen(ctx: NgCanhTikTok, now: number): Promise<DeYen> {
    const ra: DeYen = { nguoiSua: new Map(), khuyenMai: new Map(), theoKhoa: new Map() }
    for (const k of await ctx.kho.dsKeHoachTheoTrangThai(['skipped'], now - GIU_GIA_NGUOI_SUA_MS)) {   // mới nhất trước
        if (k.idempotencyKey) ra.theoKhoa.set(k.idempotencyKey, k)
        const id = k.data?.itemId ? String(k.data.itemId) : ''
        if (!id) continue
        if (k.data?.nguoiSua && k.createdAt + GIU_GIA_NGUOI_SUA_MS > now && !ra.nguoiSua.has(id)) ra.nguoiSua.set(id, k)
        if (k.result?.khoaKhuyenMai && k.updatedAt + NGHI_KHUYEN_MAI_MS > now && !ra.khuyenMai.has(id)) ra.khuyenMai.set(id, k)
    }
    return ra
}

/** Lý do máy để yên một mã, cho trang (/state). Giá tay: chỉ khi giá lưu còn đúng giá đã thấy — đổi nữa thì chu kỳ xét lại. */
function lyDoDeYen(d: DeYen, id: string, giaLuu: number): { reason: 'manual' | 'promo'; until: number; message: string } | null {
    const km = d.khuyenMai.get(id)
    if (km) {
        const den = km.updatedAt + NGHI_KHUYEN_MAI_MS
        return { reason: 'promo', until: den, message: `Đang khuyến mãi — TikTok khoá giá, chưa đổi được. Pilot nghỉ mã này tới ${gioNgayVN(den)}.` }
    }
    const tay = d.nguoiSua.get(id)
    const n = tay?.data?.nguoiSua
    if (tay && n && Math.abs(giaLuu - Number(n.gia)) < 1) {
        const den = tay.createdAt + GIU_GIA_NGUOI_SUA_MS
        return { reason: 'manual', until: den, message: `Chủ shop vừa sửa giá tay trên TikTok (Pilot ghi ${vnd(Number(n.giaPilot) || 0)}, nay ${vnd(Number(n.gia) || 0)}) — Pilot để yên tới ${ngayThangVN(den)}.` }
    }
    return null
}

/** Giá Pilot ĐÃ GHI lần cuối cho từng mã: kế hoạch 'succeeded' mới nhất + các lần 'uncertain' sau nó (không rõ TikTok nhận chưa thì
 *  cả giá mới lẫn giá trước lần ghi đều có thể đang nằm trên sàn). Mã vắng = Pilot chưa ghi trong cửa sổ ⇒ không suy ra được. */
function giaPilotDaGhi(ds: KeHoachTikTok[]): Map<string, { gia: number[]; cuoi: KeHoachTikTok }> {
    const theoMa = new Map<string, KeHoachTikTok[]>()
    for (const k of ds) {
        if (!k.data?.itemId || (k.status !== 'succeeded' && k.status !== 'uncertain')) continue
        const id = String(k.data.itemId)
        const ks = theoMa.get(id)
        if (ks) ks.push(k); else theoMa.set(id, [k])
    }
    const ra = new Map<string, { gia: number[]; cuoi: KeHoachTikTok }>()
    for (const [id, ks] of theoMa) {
        ks.sort((a, b) => b.updatedAt - a.updatedAt)
        const gia: number[] = []
        for (const k of ks) {
            const p = Number(k.data?.price)
            if (p > 0) gia.push(p)
            if (k.status === 'succeeded') break   // lần ghi CHẮC CHẮN gần nhất — các lần trước nó không còn là giá đang bán
            const s = Number(k.data?.snapshot?.price)
            if (s > 0) gia.push(s)
        }
        if (gia.length) ra.set(id, { gia, cuoi: ks[0] })
    }
    return ra
}

// ─── Kế hoạch ───────────────────────────────────────────────────────────────────

function keHoachMoi(data: any, khoa: string | null | undefined, nguoi: string | null | undefined, now: number, status = 'draft'): KeHoachTikTok {
    return { id: crypto.randomUUID(), kind: 'price', status, idempotencyKey: khoa ? String(khoa).slice(0, 200) : null, data, result: null, createdBy: nguoi ?? null, createdAt: now, updatedAt: now }
}

/** Kế hoạch đổi giá MỘT sản phẩm (theo mã TikTok hoặc SKU). Giá dưới sàn / vượt biên độ / nhiều SKU / không đọc được giá đang bán
 *  ⇒ từ chối. `giaSong`: chu kỳ đã đọc lô giá sống ngay trước đó — khỏi đọc lại từng mã. */
export async function taoKeHoachGiaTikTok(ctx: NgCanhTikTok, b: { itemId?: string; sku?: string; price: number; idempotencyKey?: string; giaSong?: GiaSongTikTok }): Promise<KeHoachTikTok> {
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
    // Giá đang bán + SKU: đọc THẲNG TikTok — hàng nhiều phân loại dừng ở đây. 09/11/2026 (TT-09): giá sống 0 / rỗng / đọc hỏng ⇒
    // TỪ CHỐI (trước rơi về giá lưu — cũ tới 2 giờ, có khi chính là số 0 — nên rào biên độ so với một giá không có thật)
    const song = b.giaSong ? skuDuyTu(b.giaSong) : await docSkuDuy(await dichVu(ctx, ch), String(l.platformProductId))
    const giaCu = song.gia
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
        const msg = String(e?.message || e).slice(0, 800)
        if (laLoiKhoaGiaKhuyenMai(e)) {
            /* 09/11/2026 (TT-04): TikTok khoá giá vì đang khuyến mãi — sàn từ chối đúng luật của nó, không phải hỏng ⇒ 'skipped'
             * (không vào việc cần người); `khoaKhuyenMai` là mốc để chu kỳ nghỉ mã này 24 giờ (khỏi lượt nào cũng thử lại). */
            status = 'skipped'
            result = { khoaKhuyenMai: true, message: `Đang khuyến mãi — TikTok khoá giá, chưa đổi được. Pilot nghỉ mã này 24 giờ. (${msg.slice(0, 300)})` }
        } else {
            status = laLoiMang(e) ? 'uncertain' : 'failed'
            result = { message: msg }
            if (status === 'uncertain') result.message = `Mất kết nối giữa chừng — không rõ TikTok đã nhận giá mới chưa. Kiểm tra trên Seller Center trước khi lập lại. (${result.message})`
            // token hỏng (TT-20): chu kỳ đọc cờ này ⇒ MỘT dòng 'token' rồi dừng ghi cả lượt
            if (laLoiTokenTikTok(e)) { result.loiToken = true; result.lyDoToken = e instanceof LoiTokenTikTok ? e.lyDo : msg.slice(0, 300) }
        }
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
    // làm mới token hỏng lúc mở dịch vụ ⇒ không ghi (09/11/2026, TT-20) — đường uỷ quyền lại nằm ngay trong câu báo
    if (fb.loiLamMoiToken) throw new LoiTokenTikTok(fb.loiLamMoiToken, ch.name)
    // giá 0 / rỗng / đọc hỏng ⇒ docSkuDuy ném (09/11/2026, TT-09): rào biên độ + chỉ-tăng dưới đây luôn so với giá DƯƠNG thật
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
                    // 09/11/2026: nháp Tự động còn lại = lượt trước chạm trần ghi / dừng giữa chừng (TT-10 giữ nháp) — không phải Xem trước
                    const lyDo = quaHan ? 'Nháp máy lập quá 3 ngày chưa duyệt — tự huỷ.'
                        : String(k.idempotencyKey).startsWith('cycle:xem:') ? 'Nháp của lượt Xem trước — chế độ Tự động lập lại theo giá hiện tại.'
                            : 'Nháp máy lập chưa kịp ghi (hết lượt ghi hôm nay / lượt trước dừng giữa chừng) — tự huỷ, lập lại theo giá hiện tại.'
                    await ctx.kho.capNhatKeHoach(k.id, 'cancelled', { tuHuy: true, message: lyDo })
                    soHuy++
                }
                continue
            }
        }
        if (k.data?.itemId) choDuyet.add(String(k.data.itemId))
    }
    if (soHuy) results.push({ action: 'plan', status: 'skipped', message: `Huỷ ${soHuy} nháp cũ của máy (quá 3 ngày chưa duyệt / còn từ lượt Xem trước / chưa kịp ghi).` })
    return choDuyet
}

/** Mã còn thiếu ngành được hỏi tối đa mỗi chu kỳ (một lời gọi + nghỉ 250ms mỗi mã — chu kỳ không kéo quá lâu; còn thì lượt sau). */
const TRAN_NGANH_MOI_CHU_KY = 30

/**
 * Bổ sung mã NGÀNH cho sản phẩm TikTok còn thiếu (09/11/2026, TT-12). products/search không trả ngành nên luuDanhMucSan để null cho
 * mã mới ⇒ "chưa rõ ngành" ⇒ máy chỉ được TĂNG giá mã đó (phí cả gian gắn cờ). Đọc ngành từng mã (product detail), nghỉ `nghiMs`
 * giữa các lời gọi; một mã lỗi thì ghi lại rồi ĐI TIẾP (trước: nút Đồng bộ dừng cả lượt ở mã lỗi đầu tiên) — lỗi token hoặc 3 lỗi
 * liền (rate-limit / sàn trục trặc) thì dừng, lần sau làm tiếp. Dùng chung: chu kỳ TikTok Pilot + nút Đồng bộ (routes/onlineOrders).
 */
export async function boSungNganhTikTok(prisma: any, channelId: string, svc: Pick<DichVuTikTok, 'fetchProductCategory'>, o: { toiDa?: number; nghiMs?: number } = {}):
    Promise<{ thieu: number; daCo: number; khongCo: number; loi: string[]; dung: 'token' | 'lien-tiep' | null }> {
    const ra = { thieu: 0, daCo: 0, khongCo: 0, loi: [] as string[], dung: null as 'token' | 'lien-tiep' | null }
    if (typeof svc.fetchProductCategory !== 'function') return ra
    const thieu: any[] = await prisma.onlineProduct.findMany({
        where: { channelId, platform: 'tiktok', categoryId: null }, select: { id: true, platformProductId: true, sku: true }, take: o.toiDa ?? 80,
    })
    ra.thieu = thieu.length
    const nghi = o.nghiMs ?? 250
    let lienTiep = 0
    for (let i = 0; i < thieu.length; i++) {
        const m = thieu[i]
        if (i > 0 && nghi > 0) await new Promise(r => setTimeout(r, nghi))
        try {
            const cat = await svc.fetchProductCategory!(String(m.platformProductId))
            lienTiep = 0
            if (cat?.categoryId) {
                await prisma.onlineProduct.update({ where: { id: m.id }, data: { categoryId: String(cat.categoryId), categoryName: cat.categoryName || null } })
                ra.daCo++
            } else ra.khongCo++
        } catch (e: any) {
            ra.loi.push(`${m.sku || m.platformProductId}: ${String(e?.message || e).slice(0, 160)}`)
            if (laLoiTokenTikTok(e)) { ra.dung = 'token'; break }
            if (++lienTiep >= 3) { ra.dung = 'lien-tiep'; break }
        }
    }
    return ra
}

/** Danh mục cũ hơn 2 giờ ⇒ đồng bộ lại (cùng đường ghi với nút "Đồng bộ") rồi lấy NGÀNH cho mã còn thiếu (09/11/2026, TT-12).
 *  Dịch vụ không có fetchProducts (bộ kiểm) ⇒ bỏ qua. Lỗi token ⇒ `baoToken` (MỘT dòng 'token' cho cả lượt), không thêm dòng
 *  'catalog' hỏng cho cùng một việc. */
async function lamMoiDanhMucTikTok(ctx: NgCanhTikTok, ch: any, now: number, baoToken: (lyDo: string, e?: any) => void): Promise<any | null> {
    const moi = await ctx.prisma.onlineProduct.findFirst({ where: { channelId: ch.id, syncedAt: { not: null } }, orderBy: { syncedAt: 'desc' }, select: { syncedAt: true } }).catch(() => null)
    const t = moi?.syncedAt ? new Date(moi.syncedAt).getTime() : 0
    if (now - t < TUOI_DANH_MUC_MS) return null
    try {
        const fb = await dichVu(ctx, ch)
        if (typeof fb.fetchProducts !== 'function') return null
        const { products } = await fb.fetchProducts()
        if (!products?.length) return { action: 'catalog', status: 'failed', message: 'TikTok trả danh mục rỗng — giữ bản cũ (kiểm uỷ quyền API của gian).' }
        const n = await luuDanhMucSan(ctx.prisma, ch, products)
        // mã mới chưa có ngành ⇒ hỏi ngành ngay trong chu kỳ — trước chỉ nút Đồng bộ làm, mã mới bị "chưa rõ ngành" (chỉ được tăng giá)
        const ng = await boSungNganhTikTok(ctx.prisma, ch.id, fb, { toiDa: TRAN_NGANH_MOI_CHU_KY })
        if (ng.dung === 'token') baoToken(ng.loi[ng.loi.length - 1] || 'lỗi token khi đọc ngành sản phẩm')
        const nganh = !ng.thieu ? '' : ` Lấy ngành ${ng.daCo}/${ng.thieu} mã chưa rõ ngành`
            + (ng.khongCo ? ` (${ng.khongCo} mã TikTok không trả ngành)` : '')
            + (ng.loi.length ? ` — ${ng.loi.length} mã lỗi: ${ng.loi.slice(0, 2).join('; ')}` : '')
            + (ng.dung ? '; dừng giữa chừng, lượt sau làm tiếp' : ng.thieu >= TRAN_NGANH_MOI_CHU_KY ? `; tối đa ${TRAN_NGANH_MOI_CHU_KY} mã mỗi lượt, còn thì lượt sau lấy tiếp` : '') + '.'
        return { action: 'catalog', status: 'succeeded', message: `Đồng bộ lại ${n} sản phẩm từ TikTok (bản trước: ${t ? new Date(t + 7 * 3600_000).toISOString().slice(0, 16).replace('T', ' ') : 'chưa có'}).${nganh}` }
    } catch (e: any) {
        if (laLoiTokenTikTok(e)) { baoToken(String(e?.message || e), e); return null }
        return { action: 'catalog', status: 'failed', message: `Không đồng bộ được danh mục từ TikTok: ${String(e?.message || e).slice(0, 200)}` }
    }
}

export async function chayChuKyTikTok(ctx0: NgCanhTikTok): Promise<any> {
    // dịch vụ TikTok mở MỘT lần cho cả lượt — cả thực thi từng kế hoạch bên trong (09/11/2026)
    const ctx: NgCanhTikTok = { ...ctx0, _dichVu: new Map() }
    const now = luc(ctx)
    const { cfg, ch } = await canGian(ctx)
    const pol = cfg.policy
    const tuDong = cfg.executionMode === 'auto'
    const results: any[] = []
    /* TOKEN HỎNG (09/11/2026, TT-20): làm mới token lúc mở dịch vụ hỏng, hoặc TikTok trả 105005 / 106011 / 106001 ⇒ MỘT dòng action
     * 'token' (lib/pilotBaoChuShop bắt: chủ shop được báo đúng việc — uỷ quyền lại) và KHÔNG ghi gì thêm lượt này. Trước: lỗi làm mới
     * chỉ console.warn, chu kỳ chạy tiếp bằng token hết hạn, mỗi mã một dòng 'failed' khó hiểu. */
    let loiToken: string | null = null
    const baoToken = (lyDo: string, e?: any) => {
        if (loiToken) return
        loiToken = e instanceof LoiTokenTikTok ? e.lyDo : lyDo
        results.push({ action: 'token', status: 'failed', canNguoi: true, message: cauUyQuyenLaiTikTok(ch.name, loiToken) })
    }
    const moNhap = await donKeHoachMoTikTok(ctx, tuDong, results, now)
    const fb0 = await dichVu(ctx, ch)
    if (fb0.loiLamMoiToken) baoToken(fb0.loiLamMoiToken)
    // token đã hỏng thì khỏi đọc danh mục bằng nó (đọc hỏng chỉ thêm một dòng lỗi nữa cho cùng một việc)
    const danhMuc = loiToken ? null : await lamMoiDanhMucTikTok(ctx, ch, now, baoToken)
    if (danhMuc) results.push(danhMuc)

    if (pol.automation.syncStock) {
        if (loiToken && tuDong) {
            results.push({ action: 'stock', status: 'skipped', message: 'Không đẩy tồn lượt này — token TikTok của gian cần uỷ quyền lại (xem dòng token).' })
        } else {
            // chạy thử trước — cầu dao (lib/dayTonLenSan.cauDaoTon, đếm trên toàn bộ listing) nhảy thì không đẩy
            const ton = await dayTonChuKy({ tuDong, san: 'TikTok', gian: ch.name, day: o => dayTon(ctx, ch.id, o), conLuot: () => conLuotGhi(ctx, pol), ghi: w => ctx.kho.ghiNhatKy(w) })
            results.push(ton)
            // đẩy tồn (lần ghi đầu của lượt) gặp mã token ⇒ MỘT dòng 'token', không đổi giá lượt này — mỗi lần ghi giá sau cũng sẽ
            // hỏng y vậy, ăn trần ghi / ngày và thêm một dòng 'failed' khó hiểu (09/11/2026, TT-20)
            if (tuDong && (ton?.status === 'failed' || ton?.status === 'partial') && laLoiTokenTikTok(ton?.message)) baoToken(String(ton.message))
        }
    }

    /* CHƯA BIẾT PHÍ sàn của gian (09/11/2026, chủ shop: "xem phí phải ghi rõ ra không thể mượn được"): gian chưa đủ đơn đối soát
     * để đo phí, chưa khai phí ⇒ không giá nào tính / ghi được. Không đổi giá, báo MỘT dòng — khỏi soát từng mã rồi im lặng
     * "không mã nào cần đổi giá" (quyetDinhGia bỏ qua mã không có giá sàn), khỏi đọc TikTok vô ích. Đẩy tồn vẫn chạy. */
    const bangPhiGian = pol.automation.reprice && pol.maxRepricePerCycle > 0 ? await docMauPhiTheoNganh(ctx.prisma, ch) : null
    const chuaBietPhi = !!bangPhiGian?.toanGian.chuaBiet && !bangPhiGian.theoNganh.size
    if (chuaBietPhi) results.push({ action: 'cycle', status: 'skipped', canNguoi: true, message: dongChuKyChuaBietPhi(bangPhiGian!.toanGian.soDon, ch.name, 'chưa đổi giá mã nào') })

    if (bangPhiGian && !chuaBietPhi && loiToken) {
        results.push({ action: 'price', status: 'skipped', message: 'Không đổi giá lượt này — token TikTok của gian cần uỷ quyền lại (xem dòng token).' })
    } else if (bangPhiGian && !chuaBietPhi) {
        const listing: any[] = await ctx.prisma.onlineProduct.findMany({ where: { channelId: ch.id, status: { in: DANG_BAN } }, orderBy: { updatedAt: 'desc' }, take: 300 })
        const von = await giaVonHangLoat(ctx.prisma, listing)
        // TT-18 (10/11/2026): đếm theo SKU + hàng kho đã nối (listing nối tay không SKU); đọc hỏng ⇒ null ⇒ luật bán chậm nghỉ lượt
        // này (trước: Map rỗng ⇒ mọi mã "14 ngày không bán" ⇒ hạ giá cả hàng bán chạy)
        const daBan = await soBan14Ngay(ctx.prisma, ch.id).catch((e: any) => {
            console.error('[TikTokPilot] chu kỳ: đọc số bán 14 ngày hỏng:', e?.message || e)
            return null
        })
        if (!daBan) results.push({ action: 'price', status: 'skipped', message: 'Không đọc được số đã bán 14 ngày — lượt này KHÔNG hạ giá hàng "bán chậm"; mã dưới giá sàn / lãi dưới mục tiêu vẫn xét như thường.' })
        const bangPhi = bangPhiGian
        const nhieuSku = await maNhieuSkuGanDay(ctx, now)
        const polS = chuanHoaChinhSach(pol)
        let soChoDuyet = 0, soVuaDoi = 0, soChuaBietPhi = 0, soNhieuSku = 0
        // Bước 1 — lọc bằng dữ liệu trong hệ thống (không gọi TikTok): nhiều SKU đã biết, nháp chờ duyệt, giá vốn, phí
        const xet: { l: any; v: any; mauPhi: MauPhi }[] = []
        for (const l of listing) {
            const id = String(l.platformProductId)
            if (nhieuSku.has(id)) continue
            if (moNhap.has(id)) { soChoDuyet++; continue }
            const v = von.get(l.id)
            if (!v || !(v.giaVon > 0)) continue
            const mauPhi = bangPhi.chon(l.categoryId)   // phí ĐÚNG ngành — mỗi ngành TikTok thu một khác
            // chưa biết phí (ngành chưa đo trong gian chưa khai phí) ⇒ quyetDinhGia sẽ im lặng "giữ nguyên" — đếm ra để nói
            if (mauPhi.chuaBiet) { soChuaBietPhi++; continue }
            xet.push({ l, v, mauPhi })
        }
        /* Bước 2 — TRẦN GHI CÒN LẠI hôm nay (09/11/2026, TT-10), tính TRƯỚC vòng lặp, sau đẩy tồn (đẩy tồn cũng ăn một lượt ghi).
         * Trước: chỉ trần mỗi chu kỳ; chạm trần ngày giữa chừng ⇒ thucThi ném, chu kỳ ghi 'failed' từng mã còn lại ⇒ chuông báo
         * "ghi hỏng" cho việc chính sách chặn đúng như đặt. Xem trước không ghi gì lên TikTok ⇒ chỉ trần mỗi chu kỳ. */
        const daGhiHomNay = tuDong ? await ctx.kho.demGhiTuLuc(dauNgayVN(now)) : 0
        const tranGhi = tuDong ? Math.min(pol.maxRepricePerCycle, pol.maxWritesPerDay - daGhiHomNay) : pol.maxRepricePerCycle
        const hetTranNgay = tuDong && tranGhi < pol.maxRepricePerCycle   // trần NGÀY chặn trước trần chu kỳ
        /* Bước 3 — GIÁ SỐNG theo lô (09/11/2026, TT-09 — như Shopee Pilot): quyết theo giá đang bán THẬT trên TikTok, không theo bản
         * lưu (cũ tới 2 giờ). Đọc hỏng ⇒ không đổi giá mã nào, MỘT dòng lý do. Hết lượt ghi ⇒ khỏi đọc. */
        let song: Map<string, GiaSongTikTok> | null = null
        if (tranGhi <= 0) {
            /* HẾT TRẦN NGÀY mà còn mã bán DƯỚI GIÁ SÀN thật (10/11/2026, SP-13 — như Shopee Pilot): máy không nâng được tới mai ⇒ chủ shop
             * phải biết (trước: một dòng 'skipped' im lặng). Lọc bằng giá LƯU, XÁC NHẬN bằng giá SỐNG — đọc không phải lệnh ghi, không ăn
             * trần. Đọc hỏng ⇒ im như cũ (thà im còn hơn báo sai); lỗi token ⇒ dòng 'token'. Không đọc gì khi giá lưu không nghi mã nào. */
            const sanCua = (x: { v: any; mauPhi: MauPhi }) => tinhGiaDeXuat(thamSoTinh(pol, x.v.giaVon, x.mauPhi)).giaSan
            const nghi = xet.filter(x => { const g = Number(x.l.price) || 0, san = sanCua(x); return g > 0 && san > 0 && g < san })
            const duoi: string[] = []
            if (nghi.length) {
                try {
                    const s0 = await giaSongLoTikTok(await dichVu(ctx, ch), nghi.map(x => String(x.l.platformProductId)))
                    for (const x of nghi) {
                        const s = s0.get(String(x.l.platformProductId)), san = sanCua(x)
                        if (!s || s.soSku !== 1 || !(s.gia > 0) || (s.trangThai && !DANG_BAN.includes(s.trangThai.toUpperCase()))) continue
                        if (s.gia < san) duoi.push(`${x.l.sku || x.l.platformProductId} ${vnd(s.gia)} < sàn ${vnd(san)}`)
                    }
                } catch (e: any) {
                    if (laLoiTokenTikTok(e)) baoToken(String(e?.message || e), e)
                }
            }
            results.push({
                action: 'price', status: 'skipped', ...(duoi.length ? { canNguoi: true } : {}),
                message: `Đã hết lượt ghi hôm nay (${daGhiHomNay}/${pol.maxWritesPerDay} theo chính sách) — ${duoi.length ? cauConDuoiSan('TikTok', duoi) : 'đổi giá để mai, hoặc nâng «Thao tác ghi mỗi ngày» ở Sửa chính sách.'}`,
            })
        } else if (!xet.length) {
            song = new Map()
        } else {
            try { song = await giaSongLoTikTok(await dichVu(ctx, ch), xet.map(x => String(x.l.platformProductId))) } catch (e: any) {
                if (laLoiTokenTikTok(e)) baoToken(String(e?.message || e), e)
                else results.push({ action: 'price', status: 'failed', message: `Không đọc được giá đang bán trên TikTok — chu kỳ không đổi giá mã nào (${String(e?.message || e).slice(0, 200)}).` })
            }
        }
        const bo = { khongThay: 0, khongBan: 0, khongGia: 0, nguoiSua: 0, nguoiSuaDuoiSan: 0, khuyenMai: 0 }
        let denNguoiSua = 0
        const uv: { l: any; mauPhi: MauPhi; s: GiaSongTikTok; giaCu: number; quyet: { gia: number; lyDo: string }; uu: number }[] = []
        if (song) {
            // máy đổi giá cùng mã cách nhau ≥ 24 giờ tính từ lúc THỰC THI (09/11/2026, TT-11 — trước tính từ lúc LẬP nháp) — trừ mã
            // đang dưới giá sàn. 'uncertain' (có thể TikTok đã nhận) cũng tính là vừa đổi.
            const daThucThi = await ctx.kho.dsKeHoachTheoTrangThai(['succeeded', 'uncertain'], now - CUA_SO_GIA_PILOT_MS)
            const vuaDoi = new Set(daThucThi.filter(k => now - k.updatedAt < NGHI_DOI_GIA_MS).map(k => String(k.data?.itemId)))
            const giaPilot = giaPilotDaGhi(daThucThi)
            const deYen = await maDangDeYen(ctx, now)
            for (const { l, v, mauPhi } of xet) {
                const id = String(l.platformProductId)
                const s = song.get(id)
                if (!s) { bo.khongThay++; continue }
                if (s.soSku > 1) {
                    soNhieuSku++
                    // nhớ 24 giờ — các lượt sau khỏi xét lại sản phẩm này
                    await ctx.kho.taoKeHoach(keHoachMoi({ itemId: id, sku: l.sku || null, name: l.name, nhieuSku: s.soSku },
                        `skip:nhieu-sku:${id}:${ngayVN(now)}`, ctx.nguoi, now, 'skipped')).catch(() => { })
                    continue
                }
                if (s.trangThai && !DANG_BAN.includes(s.trangThai.toUpperCase())) { bo.khongBan++; continue }
                // giá 0 / rỗng (hoặc không có mã SKU): không biết giá đang bán ⇒ không đổi (rào biên độ / chỉ-tăng cần giá DƯƠNG)
                if (s.soSku !== 1 || !s.skuId || !(s.gia > 0)) { bo.khongGia++; continue }
                const giaCu = s.gia
                const ts = thamSoTinh(pol, v.giaVon, mauPhi)
                const kq = tinhGiaDeXuat(ts)
                const quyet = quyetDinhGia({
                    giaCu, ton: Number(l.stock) || 0, daBan14: daBan ? daBanCuaListing(daBan, l) : null,
                    kq, bienHienTaiPct: danhGiaGia(giaCu, ts).bienPct, pol: polS,
                })
                /* GIÁ NGƯỜI VỪA SỬA (09/11/2026, TT-14): giá đang bán ≠ giá Pilot ghi lần cuối ⇒ người vừa sửa (Seller Center, nút đẩy
                 * giá…) ⇒ máy để yên 7 ngày kể từ lúc PHÁT HIỆN — phát hiện cả khi máy chưa định đổi mã đó. Mã Pilot chưa ghi (30 ngày)
                 * thì không suy ra được ⇒ xét như cũ. Mốc lưu ở dòng 'skipped' của sổ kế hoạch (không đổi schema). */
                const g = giaPilot.get(id)
                if (g && !s.cacGia.some(x => g.gia.some(y => Math.abs(x - y) < 1))) {
                    const khoa = `skip:nguoi-sua:${id}:${g.cuoi.id}:${Math.round(giaCu)}`
                    const giu = deYen.theoKhoa.get(khoa) || await ctx.kho.taoKeHoach(keHoachMoi(
                        { itemId: id, sku: l.sku || null, name: l.name, nguoiSua: { gia: giaCu, giaPilot: g.gia[0], planId: g.cuoi.id } },
                        khoa, ctx.nguoi, now, 'skipped')).catch(() => null)
                    // giá lưu theo giá thật — trang hiện đúng giá đang bán cùng lý do để yên
                    if (Math.abs((Number(l.price) || 0) - giaCu) >= 1) await ctx.prisma.onlineProduct.update({ where: { id: l.id }, data: { price: giaCu } }).catch(() => { })
                    const den = giu ? giu.createdAt + GIU_GIA_NGUOI_SUA_MS : now + GIU_GIA_NGUOI_SUA_MS   // không lưu được mốc ⇒ vẫn để yên lượt này
                    if (den > now) {
                        if (quyet) { bo.nguoiSua++; denNguoiSua = Math.max(denNguoiSua, den); if (giaCu < kq.giaSan) bo.nguoiSuaDuoiSan++ }
                        continue
                    }
                }
                if (!quyet) continue
                // TikTok vừa khoá giá mã này vì khuyến mãi (TT-04) ⇒ nghỉ 24 giờ: thử lại là lại bị từ chối, lại ăn một lượt ghi
                if (deYen.khuyenMai.has(id)) { bo.khuyenMai++; continue }
                const uu = giaCu < kq.giaSan ? 0 : quyet.gia > giaCu ? 1 : 2
                if (uu > 0 && vuaDoi.has(id)) { soVuaDoi++; continue }
                uv.push({ l, mauPhi, s, giaCu, quyet, uu })
            }
        }
        // đang dưới giá sàn (lỗ / sát lỗ qua affiliate) trước, rồi tăng, hạ giá sau cùng
        uv.sort((a, b) => a.uu - b.uu)
        let soGhi = 0, soNhap = 0, soHoi = 0, hetLuot = false, i = 0
        for (; i < uv.length; i++) {
            const u = uv[i]
            if (loiToken || soGhi >= tranGhi || soHoi >= tranGhi * 3 + TRAN_NHAP_MOI_CHU_KY) break
            const id = String(u.l.platformProductId)
            // Phí chưa đủ tin ⇒ máy KHÔNG tự HẠ giá: để nháp chờ người duyệt. TĂNG giá thì được.
            const chuaTin = tuDong ? lyDoPhiChuaDuTin(u.quyet.gia, u.mauPhi, pol.minMarginRate * 100) : null
            if (chuaTin && !(u.quyet.gia > u.giaCu) && soNhap >= TRAN_NHAP_MOI_CHU_KY) continue
            soHoi++
            try {
                let plan: any = await taoKeHoachGiaTikTok(ctx, { itemId: id, price: u.quyet.gia, giaSong: u.s, idempotencyKey: `${tuDong ? 'cycle' : 'cycle:xem'}:price:${id}:${ngayVN(now)}:${u.quyet.gia}` })
                if (plan.status !== 'draft') continue   // cùng khoá trong ngày đã thực thi / hỏng — đã báo ở lượt đó
                const choDuyet = chuaTin && !(u.quyet.gia > (Number(plan.data?.snapshot?.price) || u.giaCu)) ? chuaTin : null
                if (tuDong && !choDuyet) {
                    plan = await thucThiTikTok(ctx, plan.id, { tuDong: true })
                    soGhi++
                    const xong = plan.plan || plan
                    // TikTok báo token hỏng ngay lúc ghi ⇒ MỘT dòng 'token' thay cho dòng giá này, dừng ghi cả lượt
                    if (xong.result?.loiToken) { baoToken(String(xong.result.lyDoToken || xong.result.message || '')); break }
                }
                else if (choDuyet) soNhap++
                else soGhi++   // Xem trước: nháp thay cho lần ghi
                const p = plan.plan || plan
                results.push({
                    action: 'price', status: p.status, sku: u.l.sku || u.l.platformProductId, planId: p.id,
                    ...(choDuyet ? { canNguoi: true } : {}),
                    message: `${vnd(Number(p.data?.snapshot?.price) || u.giaCu)} → ${vnd(u.quyet.gia)}: ${u.quyet.lyDo}${p.result?.message ? ` — ${p.result.message}` : ''}${p.result?.warning ? ` — ${p.result.warning}` : ''}${choDuyet ? ` — CHỜ NGƯỜI DUYỆT: ${choDuyet}` : ''}`,
                })
            } catch (e: any) {
                // chạm trần ghi / ngày giữa chừng (lượt khác vừa ghi) — không phải hỏng: giữ nháp, MỘT dòng 'skipped' ở cuối
                if (e instanceof LoiHetLuotGhi) { hetLuot = true; break }
                if (laLoiTokenTikTok(e)) { baoToken(String(e?.message || e), e); break }
                if (e instanceof LoiNhieuSku) {
                    soNhieuSku++
                    await ctx.kho.taoKeHoach(keHoachMoi({ itemId: id, sku: u.l.sku || null, name: u.l.name, nhieuSku: e.soSku },
                        `skip:nhieu-sku:${id}:${ngayVN(now)}`, ctx.nguoi, now, 'skipped')).catch(() => { })
                    continue
                }
                soGhi++   // lỗi lập kế hoạch cũng tính một lượt — chu kỳ không quay mãi trên mã hỏng
                results.push({ action: 'price', status: 'failed', sku: u.l.sku || u.l.platformProductId, message: String(e?.message || e).slice(0, 300) })
            }
        }
        const con = uv.length - i   // ứng viên chưa tới lượt
        if (soNhieuSku) results.push({ action: 'price', status: 'skipped', message: `${soNhieuSku} sản phẩm nhiều phân loại — Pilot chưa đổi giá hàng nhiều phân loại, sửa trên TikTok Seller Center.` })
        if (soVuaDoi) results.push({ action: 'price', status: 'skipped', message: `${soVuaDoi} sản phẩm vừa đổi giá trong 24 giờ — chờ xem đơn rồi mới đổi tiếp.` })
        if (soChoDuyet) results.push({ action: 'price', status: 'skipped', message: `${soChoDuyet} sản phẩm đang có nháp chờ duyệt / người vừa huỷ — duyệt hoặc huỷ trên TikTok Pilot (nháp máy lập tự huỷ sau 3 ngày, mã người huỷ thì 14 ngày không đề xuất lại).` })
        if (soChuaBietPhi) results.push({ action: 'price', status: 'skipped', canNguoi: true, message: `${soChuaBietPhi} sản phẩm CHƯA BIẾT PHÍ sàn (ngành chưa đủ đơn để đo, gian chưa khai phí) — không tính được giá. Khai phí sàn của gian ở Kênh bán online.` })
        if (bo.nguoiSua) {
            results.push({ action: 'price', status: 'skipped', message: `${bo.nguoiSua} mã chủ shop vừa sửa giá tay trên TikTok — Pilot để yên tới ${ngayThangVN(denNguoiSua)}`
                + `${bo.nguoiSuaDuoiSan ? ` (trong đó ${bo.nguoiSuaDuoiSan} mã đang dưới giá sàn — xem lại giá trên Seller Center)` : ''}.` })
        }
        if (bo.khuyenMai) results.push({ action: 'price', status: 'skipped', message: `${bo.khuyenMai} mã đang khuyến mãi — TikTok khoá giá; Pilot nghỉ các mã này 24 giờ kể từ lần bị từ chối.` })
        const boQua = [bo.khongBan && `${bo.khongBan} không còn bán trên TikTok`, bo.khongGia && `${bo.khongGia} TikTok trả giá 0 / rỗng`,
            bo.khongThay && `${bo.khongThay} TikTok không trả sản phẩm`].filter(Boolean).join(', ')
        if (boQua) results.push({ action: 'price', status: 'skipped', message: `Bỏ qua theo giá đọc thẳng từ TikTok: ${boQua} — không đổi giá các mã này.` })
        if (song && !loiToken) {
            if (hetLuot || (hetTranNgay && soGhi >= tranGhi && con > 0)) {
                const daGhi = await ctx.kho.demGhiTuLuc(dauNgayVN(now))
                // mã chưa tới lượt mà giá SỐNG (đọc lượt này) dưới giá sàn ⇒ chờ tới mai là bán dưới mức lãi tối thiểu ⇒ cần người (SP-13)
                const duoi = uv.slice(i).filter(u => u.uu === 0).map(u => {
                    const v = von.get(u.l.id)
                    return `${u.l.sku || u.l.platformProductId} ${vnd(u.giaCu)} < sàn ${vnd(v ? tinhGiaDeXuat(thamSoTinh(pol, v.giaVon, u.mauPhi)).giaSan : 0)}`
                })
                results.push({
                    action: 'price', status: 'skipped', ...(duoi.length ? { canNguoi: true } : {}),
                    message: `Đã hết lượt ghi hôm nay (${daGhi}/${pol.maxWritesPerDay} theo chính sách)${con > 0 ? ` — còn ${con} sản phẩm để mai` : ''}${duoi.length ? `; ${cauConDuoiSan('TikTok', duoi)}` : '.'}`,
                })
            } else if (!soGhi && !soNhap && !soNhieuSku) {
                // còn mã bị giữ / chưa biết phí / không đọc được giá thì không biết có cần đổi hay không — đừng nói "không mã nào cần đổi"
                const chua = soChuaBietPhi || bo.nguoiSua || bo.khuyenMai || boQua
                results.push({ action: 'price', status: 'unchanged', message: `Soát ${listing.length} sản phẩm đang bán: ${chua ? 'chưa đổi giá mã nào' : 'không mã nào cần đổi giá'}.` })
            } else if (soGhi >= tranGhi && con > 0) {
                results.push({ action: 'price', status: 'skipped', message: `Mỗi chu kỳ đổi tối đa ${tranGhi} sản phẩm — còn ${con} sản phẩm chờ chu kỳ sau.` })
            }
        }
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
    // làm mới token hỏng lúc mở dịch vụ (09/11/2026, TT-20) — nói ngay bước đầu, kèm đường uỷ quyền lại
    if (fb.loiLamMoiToken) buoc.push({ ten: 'Làm mới token', ok: false, chiTiet: cauUyQuyenLaiTikTok(ch.name, fb.loiLamMoiToken) })
    await thu('Thông tin gian (authorization/shops)', async () => { const r = await fb.testConnection(); if (!r.success) throw new Error(r.error || 'không rõ'); return r.shopName || 'OK' })
    const mau = await ctx.prisma.onlineProduct.findFirst({ where: { channelId: ch.id, status: { in: DANG_BAN } }, orderBy: { updatedAt: 'desc' } }).catch(() => null)
    if (mau) {
        await thu(`Chi tiết sản phẩm (products/${mau.platformProductId})`, async () => {
            const d = await fb.getProductDetail(String(mau.platformProductId))
            const skus: any[] = d?.skus || []
            // cùng cách đọc giá với chu kỳ: số DƯƠNG đầu tiên (09/11/2026 — `??` cũ hiện 0đ khi tax_exclusive_price rỗng)
            return `${skus.length} SKU · giá ${skus.map(s => vnd(giaSkuTikTok(s))).slice(0, 3).join(', ')}`
        })
    } else buoc.push({ ten: 'Chi tiết sản phẩm', ok: false, chiTiet: 'Gian chưa có sản phẩm đang bán trong hệ thống — bấm Đồng bộ sản phẩm ở Kênh bán online.' })
    const don = await ctx.prisma.onlineOrder.findFirst({
        where: { channelId: ch.id, createdAt: { lte: new Date(now - 7 * 86400_000) } }, orderBy: { createdAt: 'desc' }, select: { externalOrderId: true },
    }).catch(() => null)
    if (don?.externalOrderId) {
        await thu('Đối soát tài chính (finance statement_transactions)', async () => {
            const s = await fb.getOrderSettlement(String(don.externalOrderId))
            if (!s) return 'Đơn chưa có đối soát (bình thường với đơn mới) — đọc được API tài chính.'
            // hoa hồng affiliate (10/11/2026, TT-02): đọc được thì mô hình phí tách riêng, giá sàn tính đơn qua affiliate theo số đo
            const aff = s.affiliateFee == null ? ' · chưa đọc được hoa hồng affiliate' : s.affiliateFee > 0 ? ` · trong đó hoa hồng affiliate ${vnd(s.affiliateFee)}` : ' · không qua affiliate'
            return `Thực nhận ${vnd(s.settlementAmount)} · phí ${vnd(s.feeAmount)}${aff}`
        })
    } else buoc.push({ ten: 'Đối soát tài chính', ok: true, chiTiet: 'Chưa có đơn cũ hơn 7 ngày để thử.' })
    const het = ch.tokenExpiresAt ? new Date(ch.tokenExpiresAt).getTime() : null
    buoc.push({
        ten: 'Token API', ok: !!ch.accessToken && !fb.loiLamMoiToken,
        chiTiet: (het ? `access token tới ${new Date(het + 7 * 3600_000).toISOString().slice(0, 16).replace('T', ' ')} (giờ VN) — Kengi tự làm mới bằng refresh token` : 'không ghi hạn')
            + (fb.loiLamMoiToken ? ' · lần làm mới vừa rồi HỎNG — xem bước «Làm mới token»' : ''),
    })
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
    // X-14: ai đổi gì — dòng sổ 'config' (không tính vào trần ghi / ngày)
    await ghiDoiCauHinh(ctx.kho, {
        nguoi: ctx.nguoi, nhan: NHAN_TIKTOK, docRieng: { channelId: v => kenh.find(c => c.id === v)?.name || String(v) },
        cu: { channelId: cfg.channelId, executionMode: cfg.executionMode, policy: cfg.policy, schedule: cfg.schedule },
        moi: { channelId, executionMode, policy, schedule },
    })
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
    // Xem trước chưa ghi gì lên sàn ⇒ chỉ chu kỳ gãy + token hỏng mới báo (ketQuaDeBao, X-09); Tự động ⇒ mọi việc cần người
    const bao = await baoChuShop(prisma, 'TikTok Pilot', ketQuaDeBao(ketQua, ketQua.executionMode !== 'auto'), truoc, now).catch(() => truoc)
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
   - Giá đang bán luôn đọc THẲNG từ TikTok (không theo bản lưu trong hệ thống). TikTok trả giá 0 / rỗng hoặc đọc hỏng ⇒ không
     đổi giá mã đó; chu kỳ đọc hỏng cả lô ⇒ không đổi giá mã nào, báo một dòng lý do.
   - Phí theo NGÀNH: chu kỳ đồng bộ danh mục lấy luôn mã ngành cho sản phẩm mới (tối đa 30 mã mỗi lượt, một mã lỗi không dừng
     lượt). Mã còn chưa rõ ngành dùng phí cả gian và máy chỉ tự TĂNG giá mã đó.
   - Máy (chu kỳ Tự động) chỉ tự HẠ giá khi phí đã đo từ ≥ 30 đơn đối soát và đủ chắc ở mức giá đó. TĂNG giá thì máy vẫn tự làm.

4. Kế hoạch → thực thi
   - Mọi thao tác ghi tạo KẾ HOẠCH trước. Chế độ Xem trước: thực thi không gọi TikTok. Chế độ Tự động: thực thi ghi lên TikTok thật.
   - Giới hạn: đổi giá tối đa X% mỗi lần, số thao tác ghi mỗi ngày, số sản phẩm đổi giá mỗi chu kỳ.

5. Chu kỳ
   - Đẩy tồn từ kho Kengi lên gian (nếu bật — cùng đường nút "Đẩy tồn"), soát và đổi giá tối đa N sản phẩm.
   - Chạy theo lịch: bật ở Sửa chính sách (mỗi 30–1440 phút), máy chủ tự chạy, không cần mở trang.
   - Mỗi sản phẩm máy đổi giá tối đa 1 lần / 24 giờ tính từ lúc GHI lên TikTok (trừ hàng đang dưới giá sàn); hàng đang lỗ được
     xét trước.
   - Giá chủ shop SỬA TAY (Seller Center, nút Đẩy giá…): giá đang bán khác giá Pilot ghi lần cuối ⇒ máy để yên mã đó 7 ngày kể từ
     lúc thấy, chu kỳ báo một dòng "N mã chủ shop vừa sửa giá tay — Pilot để yên tới dd/mm". Mã Pilot chưa từng ghi thì xét như thường.
   - Hết lượt ghi trong ngày (Thao tác ghi mỗi ngày): chu kỳ dừng ghi, báo MỘT dòng — không phải lỗi; mai làm tiếp.
   - Danh mục trong hệ thống cũ hơn 2 giờ thì chu kỳ tự đồng bộ lại. Đẩy tồn có cầu dao: nhiều mã đang có hàng sẽ về 0 ⇒ không đẩy.
   - Nháp chờ duyệt không chiếm lượt đổi giá; máy lập tự huỷ sau 3 ngày; Huỷ = 14 ngày không đề xuất lại.
     Có việc cần người (nháp chờ duyệt, ghi hỏng, cầu dao, chưa biết phí, token hỏng): báo trên chuông web + app Android (nhóm
     «Pilot tự động», có tiếng từ app 1.0.47; bấm vào mở trang Pilot này trên trình duyệt) khi danh sách đổi (cách nhau ≥ 3 giờ);
     chu kỳ lỗi báo ngay; việc còn nguyên sau 24 giờ thì nhắc lại.
   - Token TikTok hỏng (làm mới không được, TikTok báo token hết hạn / bị thu hồi): Pilot DỪNG ghi lên TikTok lượt đó, báo
     "Cần uỷ quyền lại gian TikTok" — Đơn Hàng Online → nút «Kênh bán hàng» → nút «Cấp lại quyền» ở dòng của gian.

6. Khuyến mãi
   - TikTok khoá giá sản phẩm đang khuyến mãi: lần đổi giá bị từ chối được ghi "đang khuyến mãi — TikTok khoá giá" (không phải
     lỗi), máy nghỉ mã đó 24 giờ.
   - TikTok Pilot CHƯA biết khuyến mãi SẮP chạy — nên tắt Tự động đổi giá («Điều chỉnh giá bán» ở Sửa chính sách) trước đợt
     khuyến mãi lớn.

7. Chưa làm
   - Đăng sản phẩm mới lên TikTok và tạo khuyến mãi — cần thử trên gian thật trước (ngành hàng, thuộc tính, kho của TikTok).
`
