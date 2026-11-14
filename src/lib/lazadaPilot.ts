/* ═══════════════════════════════════════════════════════════════════════════════
 *  LAZADA PILOT — định giá + đẩy tồn cho gian Lazada, chạy TRÊN KENGI (14/11/2026)
 *
 *  Chủ shop: "lazada pilot đã đủ chức năng set giá điều chỉnh giá và tính phí chưa" → "làm cho đến khi hoàn thiện chứ sao hỏi"
 *  (bước 3, sau phí THẬT từng đơn — lib/phiLazada — và đổi giá Lazada — lib/dayGiaLenSan). Cùng khuôn TikTok Pilot
 *  (lib/tiktokPilot.ts): mọi thao tác ghi đi qua KẾ HOẠCH (draft) → THỰC THI; chế độ 'preview' (mặc định) thì thực thi không gọi
 *  Lazada; lịch tự chạy TẮT mặc định; khoá idempotency; giành kế hoạch nguyên tử; trần ghi / ngày theo giờ VN; báo chủ shop qua
 *  lib/pilotBaoChuShop. Rào máy chủ chặn (không trông vào giao diện): giá dưới giá sàn (biên tối thiểu sau phí Lazada ĐO từ đơn,
 *  đóng gói, quảng cáo, affiliate, thuế GTGT khai); đổi quá maxPriceChangeRate mỗi lần so với giá ĐỌC THẲNG từ Lazada (trừ khi
 *  đang nâng lên giá sàn); máy tự chạy không HẠ giá khi phí chưa đủ tin; CHƯA BIẾT PHÍ ⇒ không giá nào tính / ghi được.
 *
 *  KHÁC TikTok Pilot:
 *    - Đơn vị đổi giá là TỪNG SKU: Lazada ghi giá theo SKU (UpdatePriceQuantity, chỉ <Price> — LazadaService.updatePrice) nên hàng
 *      nhiều phân loại đổi được; mỗi phân loại lấy giá vốn riêng theo mã kho TRÙNG SellerSku (SKU đại diện của mã — mã một SKU,
 *      hoặc SellerSku = SKU lưu của listing — dùng mã kho đã nối), cùng luật nút "Đẩy giá lên sàn" (lib/dayGiaLenSan).
 *    - Giá đang bán đọc THẲNG GetProducts cả gian (mọi SKU trong 1–2 lời gọi) — hệ thống không có bảng phân loại Lazada. Trang
 *      dùng bản đọc ≤ 5 phút; chu kỳ đọc mới; thực thi dùng bản đọc ≤ 60 giây (chu kỳ vừa đọc thì khỏi đọc lại từng mã).
 *    - SKU có special_price > 0 ⇒ máy để yên CẢ HAI chiều, người cũng không lập được kế hoạch: khách trả giá khuyến mãi (đo 13/11:
 *      đơn thật bán đúng special_price) nên đổi giá gốc không đổi giá khách trả; nâng giá gốc lên trên giá khuyến mãi đang tắt là
 *      bật lại nó; Lazada còn có thể từ chối (4119 SPECIAL_PRICE_RATE_OUT_OF_RANGE). Kengi chưa ghi SalePrice (tài liệu không nói
 *      cách đặt / gỡ) ⇒ đổi ở Lazada Seller Center. SKU khuyến mãi mà DƯỚI GIÁ SÀN ⇒ chu kỳ báo chủ shop.
 *    - Token: Lazada trả IllegalAccessToken / InvalidToken / AccessTokenExpire ⇒ cần uỷ quyền lại (MỘT dòng 'token', dừng ghi
 *      lượt đó). "IP whitelist" KHÔNG phải token — là đường ra mạng của máy chủ (proxy IP tĩnh) — uỷ quyền lại không ích gì ⇒ báo
 *      nguyên văn như lỗi thường.
 *  CHƯA làm: đăng sản phẩm mới, khuyến mãi (SalePrice / flash sale) trên Lazada.
 * ═══════════════════════════════════════════════════════════════════════════════ */

import crypto from 'crypto'
import { ToolError } from './mcpTypes'
import { tinhGiaDeXuat, danhGiaGia, chanGiaDuoiSan, lyDoPhiChuaDuTin, lyDoChuaBietPhi, dongChuKyChuaBietPhi, SO_DON_TU_GHI, type ThamSoGia, type KetQuaGia, type MauPhi } from './giaShopee'
import { docMauPhiSanPham, docMauPhiTheoNganh, tomTatMauPhi, luuDanhMucSan } from './shopeeTuQuan'
import { num, giaVonHangLoat, soBan14Ngay, daBanCuaListing, timUngVien, THIEU_MO_TA, type VonListing } from './shopeeThaoTac'
import { chuanHoaChinhSach, quyetDinhGia, vuotBienDong, dauNgayVN, dayTonChuKy, cauConDuoiSan, NGHI_DOI_GIA_MS } from './shopeePilot'
import { baoChuShop, ketQuaDeBao } from './pilotBaoChuShop'
import { ghiDoiCauHinh, NHAN_LAZADA } from './pilotDoiCauHinh'
import { LazadaService } from '../services/platforms/lazada'

const docJson = (s: any, d: any = null) => { try { return s ? JSON.parse(s) : d } catch { return d } }
const kep = (v: any, d: number, min: number, max: number) => Math.min(Math.max(num(v, d), min), max)
const ngayVN = (now = Date.now()) => new Date(now + 7 * 3600_000).toISOString().slice(0, 10)
const vnd = (n: number) => `${Math.round(n).toLocaleString('vi-VN')}đ`
/** "dd/mm" theo giờ VN */
const ngayThangVN = (ms: number) => { const d = new Date(ms + 7 * 3600_000).toISOString(); return `${d.slice(8, 10)}/${d.slice(5, 7)}` }

// ─── Chính sách ─────────────────────────────────────────────────────────────────

export interface ChinhSachLazada {
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
    /** chu kỳ đổi giá tối đa bao nhiêu SKU */
    maxRepricePerCycle: number
    automation: { reprice: boolean; syncStock: boolean }
}

/** Chuẩn hoá chính sách — phần chung kẹp đúng như Shopee Pilot (lib/shopeePilot.chuanHoaChinhSach), phần riêng ở đây
 *  (cùng mặc định TikTok Pilot: đổi giá BẬT, đẩy tồn TẮT, tối đa 10 SKU / chu kỳ). */
export function chuanHoaChinhSachLazada(x: any): ChinhSachLazada {
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
export const CHINH_SACH_LAZADA_MAC_DINH: ChinhSachLazada = chuanHoaChinhSachLazada({})

/**
 * Chính sách Lazada Pilot của cửa hàng — đọc thẳng, KHÔNG tạo bảng hộ. Cho nút tay "Đẩy giá lên sàn" (lib/dayGiaLenSan): giá sàn
 * ở đó theo đúng biên chủ shop đặt cho Pilot. Chưa từng dùng Pilot ⇒ mặc định. Đọc HỎNG vì lý do khác ⇒ ném: rơi về mặc định có
 * thể LỎNG hơn mức chủ shop đặt — rào an toàn không mở khi hỏng.
 */
export async function docChinhSachLazada(prisma: any): Promise<ChinhSachLazada> {
    let r: any
    try {
        [r] = await prisma.$queryRawUnsafe(`SELECT policy FROM "LazadaPilotConfig" WHERE id = 'default'`)
    } catch (e: any) {
        const loi = `${e?.message || e} ${JSON.stringify(e?.meta || {})}`
        if (/42P01|does not exist|không tồn tại/i.test(loi)) return chuanHoaChinhSachLazada({})
        throw new ToolError('Không đọc được chính sách Lazada Pilot của cửa hàng — không ghi giá khi chưa biết giá sàn chủ shop đặt. Thử lại sau.')
    }
    return chuanHoaChinhSachLazada(docJson(r?.policy, {}))
}

function thamSoTinh(p: ChinhSachLazada, giaVon: number, phi: MauPhi): ThamSoGia {
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

export interface LichLazada { enabled: boolean; intervalMinutes: number }
export const LICH_LAZADA_MAC_DINH: LichLazada = { enabled: false, intervalMinutes: 180 }
export function chuanHoaLichLazada(x: any): LichLazada {
    return { enabled: x?.enabled === true, intervalMinutes: Math.floor(kep(x?.intervalMinutes, LICH_LAZADA_MAC_DINH.intervalMinutes, 30, 24 * 60)) }
}

export interface CauHinhLazada {
    channelId: string | null
    executionMode: 'preview' | 'auto'
    policy: ChinhSachLazada
    schedule: LichLazada
    nextRunAt: number | null
    lastRunAt: number | null
    lastResult: any
    updatedAt: number
}

function cauHinhMacDinh(): CauHinhLazada {
    return { channelId: null, executionMode: 'preview', policy: chuanHoaChinhSachLazada({}), schedule: { ...LICH_LAZADA_MAC_DINH }, nextRunAt: null, lastRunAt: null, lastResult: null, updatedAt: 0 }
}

// ─── Kho lưu ────────────────────────────────────────────────────────────────────

export interface KeHoachLazada {
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
export interface NhatKyLazada { id: string; action: string; status: string; planId: string | null; payload: any; response: any; createdAt: number }

export interface KhoLazadaPilot {
    docCauHinh(): Promise<CauHinhLazada | null>
    luuCauHinh(c: CauHinhLazada): Promise<void>
    taoKeHoach(k: KeHoachLazada): Promise<KeHoachLazada>
    layKeHoach(id: string): Promise<KeHoachLazada | null>
    /** draft → running, nguyên tử. false = bản khác đã giành / không còn là nháp. */
    gianhKeHoach(id: string): Promise<boolean>
    capNhatKeHoach(id: string, status: string, result: any): Promise<void>
    /** draft → cancelled. false = không còn là nháp. */
    huyKeHoach(id: string): Promise<boolean>
    dsKeHoach(lim: number): Promise<KeHoachLazada[]>
    /** kế hoạch tạo từ mốc `tuLuc` */
    dsKeHoachTu(tuLuc: number): Promise<KeHoachLazada[]>
    /** kế hoạch ở các trạng thái `trangThai`, CẬP NHẬT từ mốc `tuLuc`, mới nhất trước — nghỉ 24 giờ tính từ lúc THỰC THI, giá
     *  Pilot ghi lần cuối (giữ giá người sửa) */
    dsKeHoachTheoTrangThai(trangThai: string[], tuLuc: number): Promise<KeHoachLazada[]>
    ghiNhatKy(w: Omit<NhatKyLazada, 'id' | 'createdAt'>): Promise<void>
    dsNhatKy(lim: number): Promise<NhatKyLazada[]>
    demGhiTuLuc(ms: number): Promise<number>
    gianhLich(cu: number, moi: number): Promise<boolean>
    ghiKetQuaLich(luc: number, ketQua: any): Promise<void>
}

/** Ba bảng của Lazada Pilot — tạo lười lần đầu dùng (và trong /admin/migrate). Thời gian là epoch ms (BIGINT). */
export const SQL_TAO_BANG_LAZADA_PILOT = [
    `CREATE TABLE IF NOT EXISTS "LazadaPilotConfig" (
        "id" TEXT NOT NULL, "channelId" TEXT, "executionMode" TEXT NOT NULL DEFAULT 'preview',
        "policy" TEXT NOT NULL DEFAULT '{}', "schedule" TEXT NOT NULL DEFAULT '{}',
        "nextRunAt" BIGINT, "lastRunAt" BIGINT, "lastResult" TEXT, "updatedAt" BIGINT NOT NULL DEFAULT 0,
        CONSTRAINT "LazadaPilotConfig_pkey" PRIMARY KEY ("id"))`,
    `CREATE TABLE IF NOT EXISTS "LazadaPilotPlan" (
        "id" TEXT NOT NULL, "kind" TEXT NOT NULL, "status" TEXT NOT NULL, "idempotencyKey" TEXT,
        "data" TEXT NOT NULL DEFAULT '{}', "result" TEXT, "createdBy" TEXT,
        "createdAt" BIGINT NOT NULL, "updatedAt" BIGINT NOT NULL,
        CONSTRAINT "LazadaPilotPlan_pkey" PRIMARY KEY ("id"))`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "LazadaPilotPlan_idempotencyKey_key" ON "LazadaPilotPlan"("idempotencyKey")`,
    `CREATE INDEX IF NOT EXISTS "LazadaPilotPlan_createdAt_idx" ON "LazadaPilotPlan"("createdAt")`,
    `CREATE TABLE IF NOT EXISTS "LazadaPilotWrite" (
        "id" TEXT NOT NULL, "action" TEXT NOT NULL, "status" TEXT NOT NULL, "planId" TEXT,
        "payload" TEXT NOT NULL DEFAULT '{}', "response" TEXT, "createdAt" BIGINT NOT NULL,
        CONSTRAINT "LazadaPilotWrite_pkey" PRIMARY KEY ("id"))`,
    `CREATE INDEX IF NOT EXISTS "LazadaPilotWrite_createdAt_idx" ON "LazadaPilotWrite"("createdAt")`,
]

const daTaoBang = new WeakSet<object>()
const COT_KH = `id, kind, status, "idempotencyKey", data, result, "createdBy", "createdAt"::float8 AS "createdAt", "updatedAt"::float8 AS "updatedAt"`
function hangKeHoach(r: any): KeHoachLazada {
    return {
        id: r.id, kind: r.kind, status: r.status, idempotencyKey: r.idempotencyKey ?? null,
        data: docJson(r.data, {}), result: docJson(r.result, null), createdBy: r.createdBy ?? null,
        createdAt: Number(r.createdAt), updatedAt: Number(r.updatedAt),
    }
}

/** Kho lưu trên schema của cửa hàng (raw SQL — không phụ thuộc client Prisma sinh lại). */
export function khoSqlLazada(prisma: any): KhoLazadaPilot {
    const chacBang = async () => {
        if (daTaoBang.has(prisma)) return
        for (const sql of SQL_TAO_BANG_LAZADA_PILOT) await prisma.$executeRawUnsafe(sql)
        daTaoBang.add(prisma)
    }
    const q = async (sql: string, ...v: any[]) => { await chacBang(); return prisma.$queryRawUnsafe(sql, ...v) as Promise<any[]> }
    const x = async (sql: string, ...v: any[]) => { await chacBang(); return prisma.$executeRawUnsafe(sql, ...v) as Promise<number> }
    return {
        async docCauHinh() {
            const [r] = await q(`SELECT "channelId", "executionMode", policy, schedule, "updatedAt"::float8 AS "updatedAt",
                                        "nextRunAt"::float8 AS "nextRunAt", "lastRunAt"::float8 AS "lastRunAt", "lastResult"
                                   FROM "LazadaPilotConfig" WHERE id = 'default'`)
            if (!r) return null
            return {
                channelId: r.channelId ?? null, executionMode: r.executionMode === 'auto' ? 'auto' : 'preview',
                policy: chuanHoaChinhSachLazada(docJson(r.policy, {})), schedule: chuanHoaLichLazada(docJson(r.schedule, {})),
                nextRunAt: r.nextRunAt == null ? null : Number(r.nextRunAt), lastRunAt: r.lastRunAt == null ? null : Number(r.lastRunAt),
                lastResult: docJson(r.lastResult, null), updatedAt: Number(r.updatedAt) || 0,
            }
        },
        async luuCauHinh(c) {
            // KHÔNG ghi lastRunAt / lastResult ở đây — đó là việc của lượt chạy theo lịch (ghiKetQuaLich)
            await x(`INSERT INTO "LazadaPilotConfig" (id, "channelId", "executionMode", policy, schedule, "nextRunAt", "updatedAt")
                     VALUES ('default', $1, $2, $3, $4, $5, $6)
                     ON CONFLICT (id) DO UPDATE SET "channelId" = EXCLUDED."channelId", "executionMode" = EXCLUDED."executionMode",
                     policy = EXCLUDED.policy, schedule = EXCLUDED.schedule, "nextRunAt" = EXCLUDED."nextRunAt", "updatedAt" = EXCLUDED."updatedAt"`,
                c.channelId, c.executionMode, JSON.stringify(c.policy), JSON.stringify(c.schedule || LICH_LAZADA_MAC_DINH), c.nextRunAt, Date.now())
        },
        async gianhLich(cu, moi) {
            return (await x(`UPDATE "LazadaPilotConfig" SET "nextRunAt" = $2 WHERE id = 'default' AND "nextRunAt" = $1`, cu, moi)) === 1
        },
        async ghiKetQuaLich(luc, ketQua) {
            await x(`UPDATE "LazadaPilotConfig" SET "lastRunAt" = $1, "lastResult" = $2 WHERE id = 'default'`, luc, JSON.stringify(ketQua).slice(0, 20000))
        },
        async taoKeHoach(k) {
            const rs = await q(`INSERT INTO "LazadaPilotPlan" (id, kind, status, "idempotencyKey", data, result, "createdBy", "createdAt", "updatedAt")
                                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT ("idempotencyKey") DO NOTHING RETURNING ${COT_KH}`,
                k.id, k.kind, k.status, k.idempotencyKey, JSON.stringify(k.data), k.result == null ? null : JSON.stringify(k.result), k.createdBy, k.createdAt, k.updatedAt)
            if (rs[0]) return hangKeHoach(rs[0])
            const [cu] = k.idempotencyKey ? await q(`SELECT ${COT_KH} FROM "LazadaPilotPlan" WHERE "idempotencyKey" = $1`, k.idempotencyKey) : []
            if (!cu) throw new Error('Không lưu được kế hoạch')
            return hangKeHoach(cu)
        },
        async layKeHoach(id) {
            const [r] = await q(`SELECT ${COT_KH} FROM "LazadaPilotPlan" WHERE id = $1`, id)
            return r ? hangKeHoach(r) : null
        },
        async gianhKeHoach(id) {
            return (await x(`UPDATE "LazadaPilotPlan" SET status = 'running', "updatedAt" = $2 WHERE id = $1 AND status = 'draft'`, id, Date.now())) === 1
        },
        async capNhatKeHoach(id, status, result) {
            await x(`UPDATE "LazadaPilotPlan" SET status = $2, result = $3, "updatedAt" = $4 WHERE id = $1`, id, status, result == null ? null : JSON.stringify(result), Date.now())
        },
        async huyKeHoach(id) {
            return (await x(`UPDATE "LazadaPilotPlan" SET status = 'cancelled', "updatedAt" = $2 WHERE id = $1 AND status = 'draft'`, id, Date.now())) === 1
        },
        async dsKeHoach(lim) {
            return (await q(`SELECT ${COT_KH} FROM "LazadaPilotPlan" ORDER BY "createdAt" DESC LIMIT $1`, lim)).map(hangKeHoach)
        },
        async dsKeHoachTu(tuLuc) {
            return (await q(`SELECT ${COT_KH} FROM "LazadaPilotPlan" WHERE "createdAt" >= $1 ORDER BY "createdAt" DESC LIMIT 2000`, tuLuc)).map(hangKeHoach)
        },
        async dsKeHoachTheoTrangThai(trangThai, tuLuc) {
            return (await q(`SELECT ${COT_KH} FROM "LazadaPilotPlan" WHERE status = ANY($1::text[]) AND "updatedAt" >= $2 ORDER BY "updatedAt" DESC LIMIT 2000`,
                trangThai, tuLuc)).map(hangKeHoach)
        },
        async ghiNhatKy(w) {
            await x(`INSERT INTO "LazadaPilotWrite" (id, action, status, "planId", payload, response, "createdAt") VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                crypto.randomUUID(), w.action, w.status, w.planId, JSON.stringify(w.payload ?? {}), w.response == null ? null : JSON.stringify(w.response).slice(0, 20000), Date.now())
        },
        async dsNhatKy(lim) {
            const rs = await q(`SELECT id, action, status, "planId", payload, response, "createdAt"::float8 AS "createdAt" FROM "LazadaPilotWrite" ORDER BY "createdAt" DESC LIMIT $1`, lim)
            return rs.map(r => ({ id: r.id, action: r.action, status: r.status, planId: r.planId ?? null, payload: docJson(r.payload, {}), response: docJson(r.response, null), createdAt: Number(r.createdAt) }))
        },
        async demGhiTuLuc(ms) {
            // dòng 'config' (ai đổi cấu hình) không phải lệnh ghi lên Lazada — không tính trần ghi / ngày
            const [r] = await q(`SELECT COUNT(*)::int AS n FROM "LazadaPilotWrite" WHERE "createdAt" >= $1 AND action <> 'config'`, ms)
            return Number(r?.n) || 0
        },
    }
}

/** Kho trong bộ nhớ — cho bộ kiểm (cùng hợp đồng với khoSqlLazada). `dongHo` = đồng hồ đóng dấu updatedAt / createdAt sổ ghi. */
export function khoBoNhoLazada(dongHo: () => number = () => Date.now()): KhoLazadaPilot & { _keHoach: KeHoachLazada[]; _nhatKy: NhatKyLazada[] } {
    let cfg: CauHinhLazada | null = null
    const keHoach: KeHoachLazada[] = []
    const nhatKy: NhatKyLazada[] = []
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

/** Phần LazadaService Pilot dùng — bộ kiểm thay bằng Lazada giả ghi lại mọi lời gọi. */
export interface DichVuLazada {
    testConnection(): Promise<{ success: boolean; shopName?: string; error?: string }>
    /** GetProducts cả gian, mọi trang (items[].skus[] có SkuId / SellerSku / price / special_price / Status) — NÉM khi hỏng */
    docSanPhamTho(o?: { options1?: boolean; toiDaTrang?: number }): Promise<{ items: any[]; tong: number; catTai?: string }>
    /** UpdatePriceQuantity MỘT SKU, chỉ <Price> — GHI SÀN THẬT */
    updatePrice(itemId: string, price: number, skuId?: string, sellerSku?: string): Promise<void>
    /** danh mục gian (cùng đường nút "Đồng bộ") — chu kỳ tự làm mới khi bản lưu cũ; bộ kiểm không giả thì chu kỳ bỏ bước này */
    fetchProducts?(): Promise<{ products: any[]; total?: number }>
    /** giao dịch tài chính thô (QueryTransactionDetails) — bước kiểm kết nối; bộ kiểm không giả thì bỏ bước đó */
    docGiaoDichTaiChinh?(o: { tu: string; den: string; toiDaTrang?: number }): Promise<{ dong: any[]; catTai?: string }>
    /** moDichVuLazada ghi lý do khi làm mới token HỎNG — lượt đó không ghi gì lên Lazada */
    loiLamMoiToken?: string | null
}

/** banDocSan: bản đọc sàn của lượt chạy thử — shopeePilot.dayTonChuKy đưa lại cho lượt thật (lib/dayTonLenSan) */
export interface KetQuaDayTonGon { ok: boolean; loi?: string; data?: any; banDocSan?: any }

export interface NgCanhLazada {
    prisma: any
    kho: KhoLazadaPilot
    nguoi?: string | null
    /** Lazada giả cho bộ kiểm; bỏ trống ⇒ LazadaService thật bằng token của gian (tự làm mới khi sắp hết hạn) */
    taoLazada?: (ch: any) => Promise<DichVuLazada>
    /** đẩy tồn giả cho bộ kiểm; bỏ trống ⇒ lib/dayTonLenSan */
    dayTon?: (prisma: any, channelId: string, o: { dryRun?: boolean; docSanTruoc?: any }) => Promise<KetQuaDayTonGon>
    bayGio?: () => number
    /** dịch vụ đã mở trong lượt này (theo gian) — mở MỘT lần mỗi lượt: mỗi lần mở có thể làm mới token */
    _dichVu?: Map<string, Promise<DichVuLazada>>
}

const luc = (ctx: NgCanhLazada) => (ctx.bayGio ? ctx.bayGio() : Date.now())

/** LazadaService của gian — làm mới access token nếu còn < 5 phút (cùng luật cron/autoSync). Làm mới hỏng ⇒ đọc lại kênh (bản
 *  khác có thể VỪA làm mới — refresh token mình cầm đã bị thay): token KHÁC còn hạn thì dùng; không thì ghi lý do lên dịch vụ. */
export async function moDichVuLazada(prisma: any, ch: any): Promise<DichVuLazada> {
    const svc = new LazadaService({
        apiKey: ch.apiKey || '', apiSecret: ch.apiSecret || '', accessToken: ch.accessToken || '',
        refreshToken: ch.refreshToken || '', shopId: ch.shopId || '',
    } as any)
    if (ch.tokenExpiresAt && new Date(ch.tokenExpiresAt).getTime() < Date.now() + 5 * 60_000) {
        try {
            const t = await svc.refreshAccessToken()
            if (!t?.accessToken) throw new Error('Lazada không trả access token mới')
            ;(svc as any).credentials.accessToken = t.accessToken
            ;(svc as any).credentials.refreshToken = t.refreshToken || ch.refreshToken || ''
            const het = new Date(Date.now() + (Number(t.expiresIn) || 604800) * 1000)
            await prisma.onlineChannel.update({
                where: { id: ch.id },
                data: { accessToken: t.accessToken, refreshToken: t.refreshToken || ch.refreshToken, tokenExpiresAt: het },
            })
            Object.assign(ch, { accessToken: t.accessToken, refreshToken: t.refreshToken || ch.refreshToken, tokenExpiresAt: het })
        } catch (e: any) {
            const lyDo = String(e?.message || e || 'không rõ').slice(0, 300)
            let moi: any = null
            try { moi = await prisma.onlineChannel.findUnique({ where: { id: ch.id } }) } catch { moi = null }
            const hetMoi = moi?.tokenExpiresAt ? new Date(moi.tokenExpiresAt).getTime() : 0
            if (moi?.accessToken && moi.accessToken !== ch.accessToken && (!hetMoi || hetMoi > Date.now() + 60_000)) {
                ;(svc as any).credentials.accessToken = moi.accessToken
                ;(svc as any).credentials.refreshToken = moi.refreshToken || ''
                Object.assign(ch, { accessToken: moi.accessToken, refreshToken: moi.refreshToken, tokenExpiresAt: moi.tokenExpiresAt })
                console.log(`[LazadaPilot] làm mới token ${ch.name} hỏng (${lyDo}) — dùng token bản khác vừa làm mới`)
            } else {
                console.warn(`[LazadaPilot] làm mới token ${ch.name} hỏng:`, lyDo)
                ;(svc as any).loiLamMoiToken = lyDo
            }
        }
    }
    return svc as unknown as DichVuLazada
}

/** LazadaService của gian, mở MỘT lần mỗi lượt (chu kỳ / thực thi / lập kế hoạch). */
function dichVu(ctx: NgCanhLazada, ch: any): Promise<DichVuLazada> {
    const bo = (ctx._dichVu ||= new Map())
    let fb = bo.get(ch.id)
    if (!fb) { fb = ctx.taoLazada ? ctx.taoLazada(ch) : moDichVuLazada(ctx.prisma, ch); bo.set(ch.id, fb) }
    return fb
}

/** Lỗi TOKEN của Lazada (hết hạn / sai / thiếu) — cần chủ shop uỷ quyền lại. KHÔNG gồm "IP whitelist" (đường ra mạng của máy chủ). */
const MA_LOI_TOKEN_LAZADA = /IllegalAccessToken|InvalidToken|AccessTokenExpire|MissingParameter:access_token|Lazada refresh error/i
/** Token Lazada hỏng — chu kỳ dừng ghi, báo MỘT dòng action 'token'. `lyDo` = lời gốc, message = câu chỉ đường. */
export class LoiTokenLazada extends ToolError {
    constructor(readonly lyDo: string, tenGian?: string | null) { super(cauUyQuyenLaiLazada(tenGian, lyDo)) }
}
export const laLoiTokenLazada = (e: any): boolean => e instanceof LoiTokenLazada || MA_LOI_TOKEN_LAZADA.test(String(e?.message || e || ''))

/** Câu báo uỷ quyền lại — ĐƯỜNG BẤM đứng đầu (thông báo chủ shop cắt 180 ký tự / việc), lý do kỹ thuật để cuối. */
export function cauUyQuyenLaiLazada(tenGian: string | null | undefined, lyDo: string): string {
    const gian = tenGian ? `gian Lazada "${tenGian}"` : 'gian Lazada'
    const duong = 'Đơn Hàng Online → nút «Kênh bán hàng» → nút «Cấp lại quyền» ở dòng của gian'
    const ly = String(lyDo || 'không rõ').slice(0, 200)
    return laLoiMang(lyDo)
        ? `Không làm mới được token ${gian} (mất kết nối?) — Pilot dừng ghi lên Lazada lượt này; lặp lại thì uỷ quyền lại: ${duong}. (${ly})`
        : `Cần uỷ quyền lại ${gian} — ${duong}. Pilot dừng ghi lên Lazada lượt này. (${ly})`
}

/** Lỗi mạng sau khi đã gửi: không biết Lazada đã nhận chưa ⇒ 'uncertain'. */
function laLoiMang(e: any): boolean {
    return !(e instanceof ToolError) && /fetch failed|network|ECONNRESET|ETIMEDOUT|socket|aborted|EAI_AGAIN|timeout/i.test(String(e?.message || e))
}

async function dayTon(ctx: NgCanhLazada, channelId: string, o: { dryRun?: boolean; docSanTruoc?: any }): Promise<KetQuaDayTonGon> {
    if (ctx.dayTon) return ctx.dayTon(ctx.prisma, channelId, o)
    const { dayTonLenSan } = await import('./dayTonLenSan')
    return dayTonLenSan(ctx.prisma, channelId, o as any) as any
}

export async function docCauHinhLazada(ctx: NgCanhLazada): Promise<{ cfg: CauHinhLazada; kenh: any[]; ch: any | null }> {
    const cfg = (await ctx.kho.docCauHinh()) || cauHinhMacDinh()
    const kenh: any[] = await ctx.prisma.onlineChannel.findMany({ where: { platform: 'lazada' }, orderBy: { createdAt: 'asc' } })
    const ch = (cfg.channelId && kenh.find(c => c.id === cfg.channelId)) || (kenh.length === 1 ? kenh[0] : null)
    return { cfg, kenh, ch }
}

async function canGian(ctx: NgCanhLazada) {
    const r = await docCauHinhLazada(ctx)
    if (!r.ch) {
        throw new ToolError(r.kenh.length
            ? `Cửa hàng có ${r.kenh.length} gian Lazada — chọn gian cho Pilot ở Tự động hóa → Sửa chính sách.`
            : 'Cửa hàng chưa kết nối gian Lazada nào — kết nối ở Kênh bán online trên kengi.vn trước.')
    }
    if (!r.ch.accessToken) throw new ToolError(`Gian "${r.ch.name}" chưa uỷ quyền API Lazada.`)
    return r as { cfg: CauHinhLazada; kenh: any[]; ch: any }
}

/** Chạm trần thao tác ghi / ngày theo chính sách — KHÔNG phải hỏng: chu kỳ dừng ghi, giữ nháp, báo MỘT dòng 'skipped'. */
export class LoiHetLuotGhi extends ToolError { }

async function conLuotGhi(ctx: NgCanhLazada, pol: ChinhSachLazada) {
    const dem = await ctx.kho.demGhiTuLuc(dauNgayVN(luc(ctx)))
    if (dem >= pol.maxWritesPerDay) throw new LoiHetLuotGhi(`Đã đạt giới hạn ${pol.maxWritesPerDay} thao tác ghi hôm nay theo chính sách — để mai hoặc nâng giới hạn.`)
}

// ─── Giá sống từng SKU ──────────────────────────────────────────────────────────

/** Một SKU Lazada đọc THẲNG (GetProducts) — đơn vị đổi giá của Lazada Pilot. */
export interface SkuSongLazada {
    itemId: string
    /** SkuId (chuỗi) — '' khi Lazada không trả */
    skuId: string
    /** SellerSku — '' khi không có */
    sellerSku: string
    /** khoá SKU trong sổ kế hoạch: `<item_id>:<SkuId>` (không có SkuId thì `<item_id>:s:<SellerSku>`) */
    khoa: string
    ten: string
    /** tên phân loại (saleProp) — '' khi mã một SKU */
    phanLoai: string
    soSku: number
    /** giá gốc `price` (0 = rỗng / hỏng) */
    giaGoc: number
    /** `special_price` (0 = không có) */
    giaKm: number
    ton: number
    /** trạng thái MÃ đã chuẩn hoá (LazadaService.trangThaiMa: NORMAL / UNLIST / DELETED / BANNED / giá trị lạ) */
    trangThaiMa: string
    /** `Status` thô của SKU ('active' …, '' khi không trả) */
    trangThaiSku: string
    anh: string | null
    /** primary_category của mã */
    nganh: string | null
}

export const khoaSkuLazada = (itemId: any, skuId: any, sellerSku?: any): string =>
    `${String(itemId)}:${String(skuId ?? '').trim() || `s:${String(sellerSku ?? '').trim()}`}`

/** Mọi SKU của MỘT mã GetProducts. */
export function skuTuMaLazada(it: any): SkuSongLazada[] {
    const itemId = String(it?.item_id ?? '').trim()
    if (!itemId) return []
    const skus: any[] = (Array.isArray(it?.skus) ? it.skus : []).filter(Boolean)
    const ten = String(it?.attributes?.name || it?.attributes?.name_en || '').trim()
    const anhMa = (Array.isArray(it?.images) ? it.images : []).find((x: any) => typeof x === 'string' && x.trim()) || null
    const nganh = it?.primary_category != null && String(it.primary_category).trim() ? String(it.primary_category) : null
    return skus.map(s => {
        const skuId = String(s?.SkuId ?? '').trim(), sellerSku = String(s?.SellerSku ?? '').trim()
        const anhSku = (Array.isArray(s?.Images) ? s.Images : []).find((x: any) => typeof x === 'string' && x.trim()) || null
        const goc = Number(s?.price), km = Number(s?.special_price)
        return {
            itemId, skuId, sellerSku, khoa: khoaSkuLazada(itemId, skuId, sellerSku),
            ten: ten || sellerSku || itemId,
            phanLoai: skus.length > 1 ? LazadaService.tenPhanLoaiSku(s) : '',
            soSku: skus.length,
            giaGoc: Number.isFinite(goc) && goc > 0 ? goc : 0,
            giaKm: Number.isFinite(km) && km > 0 ? km : 0,
            ton: LazadaService.tonDangBanSku(s),
            trangThaiMa: LazadaService.trangThaiMa(it?.status),
            trangThaiSku: String(s?.Status ?? '').trim(),
            anh: anhSku || anhMa, nganh,
        }
    })
}

/** SKU đang bán: mã Active VÀ SKU active (SKU không trả Status thì theo mã). */
export const skuDangBanLazada = (s: SkuSongLazada) => s.trangThaiMa === 'NORMAL' && (!s.trangThaiSku || s.trangThaiSku.toLowerCase() === 'active')

/** SKU đại diện của listing (dòng OnlineProduct): mã một SKU, hoặc SellerSku = SKU lưu — dùng mã kho đã nối của listing. */
export const laSkuDaiDien = (l: any, s: SkuSongLazada) => s.soSku === 1
    || (!!String(l?.sku || '').trim() && s.sellerSku.toLowerCase() === String(l.sku).trim().toLowerCase())

/** Giá khách trả của SKU (special_price khi thấp hơn giá gốc). */
const giaKhachTra = (s: SkuSongLazada) => (s.giaKm > 0 && (s.giaGoc <= 0 || s.giaKm < s.giaGoc) ? s.giaKm : s.giaGoc)

/** Lý do để yên SKU có special_price — cùng lời nút "Đẩy giá lên sàn" (lib/dayGiaLenSan.lyDoKhuyenMaiLazada). */
export function lyDoKhuyenMaiLazada(s: Pick<SkuSongLazada, 'giaGoc' | 'giaKm'>): string {
    const xem = 'Kengi chưa ghi giá khuyến mãi Lazada — để yên; đổi ở Lazada Seller Center.'
    return s.giaGoc > 0 && s.giaKm < s.giaGoc
        ? `Đang có giá khuyến mãi ${vnd(s.giaKm)} (giá gốc ${vnd(s.giaGoc)}) — khách trả giá khuyến mãi, đổi giá gốc không đổi giá khách trả. ${xem}`
        : `Có giá khuyến mãi ${vnd(s.giaKm)} đang tắt (không thấp hơn giá gốc ${vnd(s.giaGoc)}) — nâng giá gốc lên trên mức này là bật lại giá khuyến mãi, Lazada cũng có thể từ chối. ${xem}`
}

/** SKU đang có giá khuyến mãi — không ai đổi giá gốc qua Pilot (thực thi ⇒ 'skipped', không phải hỏng). */
export class LoiKhuyenMaiLazada extends ToolError { constructor(readonly s: SkuSongLazada) { super(lyDoKhuyenMaiLazada(s)) } }

/** Bản đọc GetProducts cả gian, gom theo mã. */
export interface BanDocLazada { luc: number; theoMa: Map<string, SkuSongLazada[]>; soMa: number; soSku: number; catTai?: string }

/** Bản đọc gần nhất theo gian — trang dùng ≤ 5 phút, thực thi ≤ 60 giây (chu kỳ vừa đọc thì khỏi đọc lại). */
const boNhoDoc = new WeakMap<object, Map<string, BanDocLazada>>()
export const TUOI_DOC_TRANG_MS = 5 * 60_000
export const TUOI_DOC_THUC_THI_MS = 60_000
/** Bộ kiểm: xoá bản đọc nhớ. */
export function xoaBoNhoDocLazada(prisma: any) { boNhoDoc.delete(prisma) }

/** Đọc SỐNG cả gian (hoặc dùng bản đọc còn tươi ≤ `tuoiToiDa`). Hỏng ⇒ NÉM (lỗi Lazada nguyên văn) — người gọi không đổi giá. */
export async function docSanLazada(ctx: NgCanhLazada, ch: any, fb: DichVuLazada, tuoiToiDa: number): Promise<BanDocLazada> {
    const now = luc(ctx)
    let bo = boNhoDoc.get(ctx.prisma)
    if (!bo) { bo = new Map(); boNhoDoc.set(ctx.prisma, bo) }
    const cu = bo.get(ch.id)
    if (cu && now >= cu.luc && now - cu.luc <= tuoiToiDa) return cu
    const r = await fb.docSanPhamTho()
    const theoMa = new Map<string, SkuSongLazada[]>()
    let soSku = 0
    for (const it of r?.items || []) {
        const ds = skuTuMaLazada(it)
        if (!ds.length || theoMa.has(ds[0].itemId)) continue
        theoMa.set(ds[0].itemId, ds)
        soSku += ds.length
    }
    const kq: BanDocLazada = { luc: now, theoMa, soMa: theoMa.size, soSku, ...(r?.catTai ? { catTai: r.catTai } : {}) }
    bo.set(ch.id, kq)
    return kq
}

/** Ghi giá xong ⇒ sửa giá trong bản đọc nhớ (trang / lần thực thi kế tiếp khỏi thấy giá cũ). */
function suaGiaTrongBanDoc(ctx: NgCanhLazada, chId: string, khoa: string, gia: number) {
    const ban = boNhoDoc.get(ctx.prisma)?.get(chId)
    for (const ds of ban?.theoMa.values() || []) for (const s of ds) if (s.khoa === khoa) s.giaGoc = gia
}

function timSkuTrongBan(ban: BanDocLazada, itemId: string, a: { skuId?: any; sellerSku?: any }): SkuSongLazada | null {
    const ds = ban.theoMa.get(String(itemId)) || []
    const skuId = String(a?.skuId ?? '').trim(), sellerSku = String(a?.sellerSku ?? '').trim().toLowerCase()
    if (skuId) return ds.find(s => s.skuId === skuId) || null
    if (sellerSku) return ds.find(s => s.sellerSku.toLowerCase() === sellerSku) || null
    return ds.length === 1 ? ds[0] : null
}

/** Soát một SKU sống trước khi dùng để ĐỔI giá: thấy SKU, đang bán, không khuyến mãi, giá gốc > 0, có mã — không thì ném. */
function skuDuyTu(s: SkuSongLazada | null, catTai?: string): SkuSongLazada {
    if (!s) throw new ToolError(`Lazada không trả SKU này lúc đọc (đã xoá / đổi mã${catTai ? ` / ${catTai}` : ''}) — không đổi giá.`)
    if (!skuDangBanLazada(s)) throw new ToolError(`SKU đang ở trạng thái ${s.trangThaiMa}${s.trangThaiSku ? ` / ${s.trangThaiSku}` : ''} trên Lazada — chỉ đổi giá SKU đang bán.`)
    if (s.giaKm > 0) throw new LoiKhuyenMaiLazada(s)
    // giá 0 / rỗng: không biết giá đang bán ⇒ rào biên độ và rào chỉ-tăng mất tác dụng — không đổi
    if (!(s.giaGoc > 0)) throw new ToolError('Lazada trả giá gốc 0 / rỗng — không đọc được giá đang bán, không đổi giá.')
    if (!s.skuId && !s.sellerSku) throw new ToolError('Lazada không trả SkuId lẫn SellerSku — không biết đổi giá SKU nào.')
    return s
}

/** SKU sống của một mã (đọc / dùng bản đọc ≤ `tuoi`). Đọc hỏng ⇒ ToolError (chưa gửi gì lên Lazada ⇒ 'failed', không 'uncertain'). */
async function docSkuLazada(ctx: NgCanhLazada, ch: any, fb: DichVuLazada, itemId: string, a: { skuId?: any; sellerSku?: any }, tuoi: number): Promise<SkuSongLazada> {
    let ban: BanDocLazada
    try {
        ban = await docSanLazada(ctx, ch, fb, tuoi)
    } catch (e: any) {
        const loi = String(e?.message || e).slice(0, 200)
        if (laLoiTokenLazada(e)) throw new LoiTokenLazada(e instanceof LoiTokenLazada ? e.lyDo : loi, ch.name)
        throw new ToolError(`Không đọc được giá đang bán trên Lazada — không đổi giá. (${loi})`)
    }
    // mã nhiều phân loại mà không nói SKU nào ⇒ nói đúng việc (không phải "Lazada không trả SKU")
    const soSku = (ban.theoMa.get(String(itemId)) || []).length
    if (soSku > 1 && !String(a?.skuId ?? '').trim() && !String(a?.sellerSku ?? '').trim()) {
        throw new ToolError(`Mã này có ${soSku} SKU (phân loại) trên Lazada — chọn SKU cần đổi giá (mỗi phân loại một dòng trên Lazada Pilot).`)
    }
    return skuDuyTu(timSkuTrongBan(ban, itemId, a), ban.catTai)
}

/** Dòng OnlineProduct của mã trên gian — thiếu ⇒ bảo đồng bộ (lập kế hoạch cần ngành + mã kho đã nối của listing). */
async function timListingLazada(prisma: any, channelId: string, itemId: any): Promise<any> {
    if (!itemId) throw new ToolError('Cần mã sản phẩm Lazada (item_id)')
    const l = await prisma.onlineProduct.findFirst({ where: { channelId, platformProductId: String(itemId) } })
    if (!l) throw new ToolError('Không thấy mã này trên gian trong hệ thống — bấm Đồng bộ sản phẩm ở Kênh bán online nếu vừa đăng ngoài hệ thống.')
    return l
}

/** Giá vốn của MỘT SKU: SKU đại diện dùng mã kho đã nối của listing; còn lại mã kho TRÙNG SellerSku (ánh xạ / mã gộp như mọi nơi). */
async function vonSku(prisma: any, l: any, s: SkuSongLazada): Promise<VonListing | undefined> {
    const m = await giaVonHangLoat(prisma, [{ id: s.khoa, localProductId: laSkuDaiDien(l, s) ? l.localProductId ?? null : null, sku: s.sellerSku || null }])
    return m.get(s.khoa)
}

/** Lời nhắc thuế theo loại hình khai ở Cài đặt cửa hàng (StoreSettings.businessType). */
async function nhacThue(prisma: any, pol: ChinhSachLazada): Promise<string | null> {
    const s = await prisma.storeSettings?.findFirst?.({ select: { businessType: true } }).catch(() => null)
    const loai = String(s?.businessType || 'company')
    if (loai === 'company' && !(pol.vatRate > 0)) {
        return 'Cửa hàng khai là DOANH NGHIỆP: nếu nộp thuế GTGT theo phương pháp khấu trừ, nhập "Thuế GTGT trên giá bán" ở Sửa chính sách — ' +
            'tiền Lazada chuyển về không trừ thuế đầu ra, chưa khai thì biên lãi thật thấp hơn số Pilot tính.'
    }
    if (loai !== 'company' && pol.vatRate > 0) {
        return 'Cửa hàng khai là HỘ / CÁ NHÂN KINH DOANH: Lazada đã khấu trừ thuế ngay trong tiền về (nằm trong phí đo được) — ' +
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

// ─── Để yên: giá người vừa sửa ──────────────────────────────────────────────────

/** Giá chủ shop vừa sửa tay ⇒ máy để yên chừng này kể từ lúc PHÁT HIỆN (như TikTok Pilot TT-14). */
const GIU_GIA_NGUOI_SUA_MS = 7 * 86400_000
/** Cửa sổ tìm "giá Pilot ghi lần cuối": SKU Pilot không ghi trong chừng này coi như chưa từng ghi ⇒ xét như cũ. */
const CUA_SO_GIA_PILOT_MS = 30 * 86400_000

interface DeYen { nguoiSua: Map<string, KeHoachLazada>; theoKhoa: Map<string, KeHoachLazada> }

/** SKU máy đang ĐỂ YÊN vì giá chủ shop vừa sửa tay (7 ngày từ lúc phát hiện) — đọc dòng 'skipped' của sổ kế hoạch. */
async function maDangDeYen(ctx: NgCanhLazada, now: number): Promise<DeYen> {
    const ra: DeYen = { nguoiSua: new Map(), theoKhoa: new Map() }
    for (const k of await ctx.kho.dsKeHoachTheoTrangThai(['skipped'], now - GIU_GIA_NGUOI_SUA_MS)) {   // mới nhất trước
        if (k.idempotencyKey) ra.theoKhoa.set(k.idempotencyKey, k)
        const khoa = k.data?.khoa ? String(k.data.khoa) : ''
        if (khoa && k.data?.nguoiSua && k.createdAt + GIU_GIA_NGUOI_SUA_MS > now && !ra.nguoiSua.has(khoa)) ra.nguoiSua.set(khoa, k)
    }
    return ra
}

function lyDoDeYen(d: DeYen, khoa: string, giaSong: number): { reason: 'manual'; until: number; message: string } | null {
    const tay = d.nguoiSua.get(khoa)
    const n = tay?.data?.nguoiSua
    if (tay && n && Math.abs(giaSong - Number(n.gia)) < 1) {
        const den = tay.createdAt + GIU_GIA_NGUOI_SUA_MS
        return { reason: 'manual', until: den, message: `Chủ shop vừa sửa giá tay trên Lazada (Pilot ghi ${vnd(Number(n.giaPilot) || 0)}, nay ${vnd(Number(n.gia) || 0)}) — Pilot để yên tới ${ngayThangVN(den)}.` }
    }
    return null
}

/** Giá Pilot ĐÃ GHI lần cuối cho từng SKU: kế hoạch 'succeeded' mới nhất + các lần 'uncertain' sau nó (không rõ Lazada nhận chưa
 *  thì cả giá mới lẫn giá trước lần ghi đều có thể đang nằm trên sàn). SKU vắng = Pilot chưa ghi trong cửa sổ. */
function giaPilotDaGhi(ds: KeHoachLazada[]): Map<string, { gia: number[]; cuoi: KeHoachLazada }> {
    const theoKhoa = new Map<string, KeHoachLazada[]>()
    for (const k of ds) {
        if (!k.data?.khoa || (k.status !== 'succeeded' && k.status !== 'uncertain')) continue
        const khoa = String(k.data.khoa)
        const ks = theoKhoa.get(khoa)
        if (ks) ks.push(k); else theoKhoa.set(khoa, [k])
    }
    const ra = new Map<string, { gia: number[]; cuoi: KeHoachLazada }>()
    for (const [khoa, ks] of theoKhoa) {
        ks.sort((a, b) => b.updatedAt - a.updatedAt)
        const gia: number[] = []
        for (const k of ks) {
            const p = Number(k.data?.price)
            if (p > 0) gia.push(p)
            if (k.status === 'succeeded') break
            const s = Number(k.data?.snapshot?.price)
            if (s > 0) gia.push(s)
        }
        if (gia.length) ra.set(khoa, { gia, cuoi: ks[0] })
    }
    return ra
}

// ─── Trạng thái cho giao diện (GET /state) ─────────────────────────────────────

/** Số SKU tối đa /state trả. */
const TRAN_SKU_UI = 300
/** Số nháp tối đa /state trả cho khối "Chờ duyệt" (kèm `draftsTotal`). */
export const TRAN_NHAP_UI = 300
/** Dòng GHI NHỚ của máy ('skipped' không mang giá — giá người vừa sửa) — không phải kế hoạch người cần xem. */
const laGhiNho = (k: KeHoachLazada) => k.status === 'skipped' && !(Number(k.data?.price) > 0)

export async function xayTrangThaiLazada(ctx: NgCanhLazada): Promise<any> {
    const now = luc(ctx)
    const { cfg, kenh, ch } = await docCauHinhLazada(ctx)
    const pol = cfg.policy
    // TUẦN TỰ có chủ ý: pool Prisma của cửa hàng chỉ 1 kết nối trên prod
    const plans = (await ctx.kho.dsKeHoach(300)).filter(k => !laGhiNho(k)).slice(0, 60)
    const moHet = await ctx.kho.dsKeHoachTheoTrangThai(['draft'], 0)
    const drafts = moHet.slice(0, TRAN_NHAP_UI)
    const audit = await ctx.kho.dsNhatKy(100)
    const todayWrites = await ctx.kho.demGhiTuLuc(dauNgayVN(now))
    const thue = await nhacThue(ctx.prisma, pol)
    const channels = kenh.map(c => ({ id: c.id, name: c.name, shopId: c.shopId, authorized: !!c.accessToken }))
    const status: any = {
        executionMode: cfg.executionMode, policy: pol, channels,
        shop: ch ? { id: ch.id, name: ch.name, shopId: ch.shopId, authorized: !!ch.accessToken, tokenExpiresAt: ch.tokenExpiresAt ? new Date(ch.tokenExpiresAt).getTime() : null } : null,
        schedule: { ...cfg.schedule, nextRunAt: cfg.nextRunAt, lastRunAt: cfg.lastRunAt, lastResult: cfg.lastResult },
        ...(thue ? { taxNote: thue } : {}),
    }
    const goc = { now, todayWrites, plans, audit, status, drafts, draftsTotal: moHet.length }
    if (!ch) {
        status.notice = kenh.length ? `Cửa hàng có ${kenh.length} gian Lazada — chọn một gian ở Tự động hóa → Sửa chính sách.` : 'Cửa hàng chưa kết nối gian Lazada nào.'
        return { ...goc, products: [], unlisted: [] }
    }
    const listing: any[] = await ctx.prisma.onlineProduct.findMany({ where: { channelId: ch.id }, orderBy: { updatedAt: 'desc' }, take: 1000 })
    const theoMa = new Map<string, any>(listing.map(l => [String(l.platformProductId), l]))
    const bang = await docMauPhiTheoNganh(ctx.prisma, ch)
    const mauPhi = bang.toanGian
    const chuaTuGhi = mauPhi.nguon === 'cau-hinh-kenh' || !!mauPhi.khai || !!mauPhi.chuaBiet || !(mauPhi.soDon >= SO_DON_TU_GHI)
    const tomTatGian = tomTatMauPhi(mauPhi, bang)
    status.feeModel = {
        rate: mauPhi.tyLe, fixedPerOrder: mauPhi.coDinh, source: mauPhi.nguon, orders: mauPhi.soDon, note: mauPhi.ghiChu,
        trusted: !chuaTuGhi,
        declared: !!mauPhi.khai, unknown: !!mauPhi.chuaBiet, scope: tomTatGian.scope, detail: tomTatGian.detail,
        autoFromPrice: chuaTuGhi ? null : mauPhi.nguon === 'ty-le-don' ? Math.ceil(mauPhi.giaBanTB || 0) : Math.ceil(mauPhi.giaBanMin || 0),
        ...(mauPhi.chuaBiet ? { warning: lyDoChuaBietPhi(mauPhi.soDon, ch.name) } : chuaTuGhi ? { warning: lyDoPhiChuaDuTin(0, mauPhi) } : {}),
        byCategory: [...bang.theoNganh.values()].sort((a, b) => b.soDon - a.soDon).slice(0, 30).map(m => tomTatMauPhi(m, bang)),
        unmeasuredCategories: [...bang.viDuNganh.keys()].filter(k => !bang.theoNganh.has(k)).length,
        uncategorized: bang.theoNganh.size ? listing.filter(l => !String(l.categoryId ?? '').trim()).length : 0,
    }

    /* SKU từ bản đọc SỐNG (≤ 5 phút) — hệ thống không lưu phân loại Lazada. Đọc hỏng ⇒ hiện SKU đại diện theo bản lưu, KHÔNG cho
     * lập kế hoạch (lập kế hoạch cũng đọc sống — đọc hỏng là từ chối), nói rõ lý do ở `readError`. */
    let ban: BanDocLazada | null = null
    try { ban = await docSanLazada(ctx, ch, await dichVu(ctx, ch), TUOI_DOC_TRANG_MS) } catch (e: any) {
        status.readError = `Không đọc được giá đang bán trên Lazada (${String(e?.message || e).slice(0, 200)}) — bảng dưới hiện theo bản lưu, chưa lập được kế hoạch giá.`
        if (laLoiTokenLazada(e)) status.readError = cauUyQuyenLaiLazada(ch.name, String(e?.message || e))
    }
    type Dong = { l: any | null; s: SkuSongLazada }
    const dong: Dong[] = []
    if (ban) {
        status.liveRead = { at: ban.luc, items: ban.soMa, skus: ban.soSku, ...(ban.catTai ? { note: ban.catTai } : {}) }
        for (const [itemId, ds] of ban.theoMa) for (const s of ds) dong.push({ l: theoMa.get(itemId) || null, s })
        // đang bán trước, rồi theo listing mới cập nhật — cùng thứ tự mã trong một mã
        dong.sort((a, b) => Number(skuDangBanLazada(b.s)) - Number(skuDangBanLazada(a.s)))
    } else {
        for (const l of listing) {
            dong.push({
                l, s: {
                    itemId: String(l.platformProductId), skuId: '', sellerSku: String(l.sku || ''), khoa: khoaSkuLazada(l.platformProductId, '', l.sku),
                    ten: l.name, phanLoai: '', soSku: 1, giaGoc: Number(l.price) || 0, giaKm: 0, ton: Number(l.stock) || 0,
                    trangThaiMa: String(l.status || ''), trangThaiSku: '', anh: l.imageUrl || null, nganh: l.categoryId || null,
                },
            })
        }
    }
    const xem = dong.slice(0, TRAN_SKU_UI)
    const von = await giaVonHangLoat(ctx.prisma, xem.map(d => ({ id: d.s.khoa, localProductId: d.l && laSkuDaiDien(d.l, d.s) ? d.l.localProductId ?? null : null, sku: d.s.sellerSku || null })))
    // đọc hỏng ⇒ null: cột "đã bán 14 ngày" hiện "—", không hiện 0
    const daBan = await soBan14Ngay(ctx.prisma, ch.id).catch((e: any) => { console.error('[LazadaPilot] đọc số bán 14 ngày hỏng:', e?.message || e); return null })
    const deYen = await maDangDeYen(ctx, now)
    const products: any[] = xem.map(({ l, s }) => {
        const v = von.get(s.khoa)
        const giaVon = v && v.giaVon > 0 ? v.giaVon : 0
        const mp = bang.chon(l?.categoryId || s.nganh)
        const ts = thamSoTinh(pol, giaVon, mp)
        const kq = tinhGiaDeXuat(ts)
        const dangBan = skuDangBanLazada(s)
        const hold = lyDoDeYen(deYen, s.khoa, s.giaGoc)
        const loi = !ban ? 'Chưa đọc được giá đang bán trên Lazada — tải lại trang.'
            : !l ? 'Mã chưa có trong hệ thống — bấm Đồng bộ sản phẩm ở Kênh bán online.'
                : !dangBan ? `Đang ở trạng thái ${s.trangThaiMa}${s.trangThaiSku ? ` / ${s.trangThaiSku}` : ''} trên Lazada — chỉ đổi giá SKU đang bán.`
                    : s.giaKm > 0 ? lyDoKhuyenMaiLazada(s)
                        : !v ? 'Chưa nối với mã trong kho (SellerSku không trùng mã kho) — nối ở Sản Phẩm Trên Sàn để có giá vốn.'
                            : !giaVon ? 'Mã kho chưa có giá vốn — không tính được lãi, không đổi giá.'
                                : !(s.giaGoc > 0) ? 'Lazada trả giá gốc 0 / rỗng — không đổi giá.' : null
        return {
            key: s.khoa, itemId: s.itemId, skuId: s.skuId || null, sellerSku: s.sellerSku || null, sku: s.sellerSku || null,
            name: s.ten, variant: s.phanLoai || null, skuCount: s.soSku, status: s.trangThaiMa, active: dangBan,
            imageUrl: s.anh || l?.imageUrl || null, costPrice: giaVon || null,
            currentPrice: s.giaGoc || null, promoPrice: s.giaKm || null, customerPrice: giaKhachTra(s) || null, stock: s.ton,
            sold14: daBan ? daBanCuaListing(daBan, { sku: s.sellerSku, localProductId: v?.productId || (l && laSkuDaiDien(l, s) ? l.localProductId : null) }) : null,
            mapped: !!v, localSku: v?.sku || null,
            enabled: !loi,
            ...(hold ? { hold } : {}),
            pricing: { ...giaUi(kq, ts, mp), fee: tomTatMauPhi(mp, bang), snapshot: { price: s.giaGoc, stock: s.ton } },
            ...(loi ? { error: loi } : {}),
        }
    })
    /* Hàng kho "chưa có trên gian": timUngVien chỉ biết SKU đại diện lưu ở listing — phân loại KHÁC đang bán trên Lazada (SellerSku
     * trùng mã kho, hoặc đã ra giá vốn từ mã kho) cũng là ĐÃ CÓ, đừng bảo chủ shop đăng lại. */
    const skuSong = new Set(dong.map(d => d.s.sellerSku.toLowerCase()).filter(Boolean))
    const hangDaCo = new Set([...von.values()].map(v => v.productId).filter(Boolean))
    const uv = await timUngVien(ctx.prisma, ch.id, { lim: 60 })
    const ungVien = uv.ungVien.filter(u => !skuSong.has(String(u.sku || '').trim().toLowerCase()) && !hangDaCo.has(u.id)).slice(0, 30)
    const unlisted = ungVien.map(u => ({
        sku: u.sku, name: u.ten, category: u.nhomHang || null, stock: u.tonBanDuoc, costPrice: u.giaVon || null, retailPrice: u.giaBanLe || null,
        imageUrl: u.anhDau, missing: u.thieu.filter(t => t !== THIEU_MO_TA),
    }))
    const soMa = ban ? ban.soMa : listing.length
    return {
        ...goc, products, unlisted,
        catalogNote: `${ban ? `${ban.soMa} mã / ${ban.soSku} SKU đọc thẳng từ Lazada lúc ${new Date(ban.luc + 7 * 3600_000).toISOString().slice(11, 16)}` : `${listing.length} mã theo bản lưu`}`
            + `${dong.length > TRAN_SKU_UI ? ` · hiện ${TRAN_SKU_UI} SKU đầu` : ''} · ${ungVien.length}${ungVien.length >= 30 ? '+' : ''} mặt hàng kho còn tồn chưa có trên gian`
            + (soMa === 0 ? ' · Gian chưa có sản phẩm nào — bấm Đồng bộ sản phẩm ở Kênh bán online trước.' : ''),
    }
}

// ─── Kế hoạch ───────────────────────────────────────────────────────────────────

function keHoachMoi(data: any, khoa: string | null | undefined, nguoi: string | null | undefined, now: number, status = 'draft'): KeHoachLazada {
    return { id: crypto.randomUUID(), kind: 'price', status, idempotencyKey: khoa ? String(khoa).slice(0, 200) : null, data, result: null, createdBy: nguoi ?? null, createdAt: now, updatedAt: now }
}

/** Kế hoạch đổi giá MỘT SKU (item_id + SkuId / SellerSku; mã một SKU thì item_id là đủ). Dưới sàn / vượt biên độ / SKU khuyến mãi
 *  / không đọc được giá đang bán ⇒ từ chối. `song`: chu kỳ đã đọc cả gian ngay trước đó — khỏi đọc lại. */
export async function taoKeHoachGiaLazada(ctx: NgCanhLazada, b: { itemId?: string; skuId?: string; sellerSku?: string; price: number; idempotencyKey?: string; song?: SkuSongLazada }): Promise<KeHoachLazada> {
    const now = luc(ctx)
    const { cfg, ch } = await canGian(ctx)
    const gia = Math.round(num(b.price, 0))
    if (!(gia > 0)) throw new ToolError('Giá mới không hợp lệ')
    const l = await timListingLazada(ctx.prisma, ch.id, b.itemId)
    const s = b.song ? skuDuyTu(b.song) : await docSkuLazada(ctx, ch, await dichVu(ctx, ch), String(l.platformProductId), { skuId: b.skuId, sellerSku: b.sellerSku }, TUOI_DOC_THUC_THI_MS)
    const nhan = s.sellerSku || s.skuId
    const v = await vonSku(ctx.prisma, l, s)
    if (!v || !(v.giaVon > 0)) throw new ToolError(`${nhan} chưa có giá vốn trong kho — không đổi giá khi không biết lãi/lỗ.`)
    const mauPhi = await docMauPhiSanPham(ctx.prisma, ch, l.categoryId || s.nganh)   // phí ĐÚNG ngành của mã
    const ts = thamSoTinh(cfg.policy, v.giaVon, mauPhi)
    const kq = tinhGiaDeXuat(ts)
    if (!kq.hopLe && !(kq.giaSan > 0)) throw new ToolError(mauPhi.chuaBiet ? lyDoChuaBietPhi(mauPhi.soDon, ch.name) : kq.lyDo || 'Không tính được giá sàn')
    const giaCu = s.giaGoc
    const chan = chanGiaDuoiSan(gia, kq) || vuotBienDong(giaCu, gia, cfg.policy.maxPriceChangeRate, kq.giaSan)
    if (chan) throw new ToolError(chan)
    const dk = danhGiaGia(gia, ts), xau = danhGiaGia(gia, ts, true)
    const phiChuaTin = lyDoPhiChuaDuTin(gia, mauPhi, cfg.policy.minMarginRate * 100)
    return ctx.kho.taoKeHoach(keHoachMoi({
        khoa: s.khoa, itemId: s.itemId, skuId: s.skuId || null, sellerSku: s.sellerSku || null, sku: nhan,
        name: s.ten, ...(s.phanLoai ? { variant: s.phanLoai } : {}), price: gia,
        snapshot: { price: giaCu, stock: s.ton },
        economics: {
            marginRate: dk.bienPct / 100, profit: dk.loiNhuan, floor: kq.giaSan, suggested: kq.hopLe ? kq.giaDeXuat : null, cost: v.giaVon,
            fee: tomTatMauPhi(mauPhi),
            ...(kq.thamSo.phiAffiliatePct > 0 ? { affiliateProfit: xau.loiNhuan, affiliateMarginRate: xau.bienPct / 100 } : {}),
        },
        ...(phiChuaTin ? { feeWarning: phiChuaTin } : {}),
    }, b.idempotencyKey, ctx.nguoi, now))
}

export async function huyKeHoachLazada(ctx: NgCanhLazada, id: string): Promise<KeHoachLazada> {
    if (!(await ctx.kho.huyKeHoach(String(id || '')))) throw new ToolError('Kế hoạch không còn là bản nháp — không huỷ được.')
    return (await ctx.kho.layKeHoach(String(id)))!
}

export async function thucThiLazada(ctx: NgCanhLazada, planId: string, tuyChon: { tuDong?: boolean } = {}): Promise<any> {
    const plan = await ctx.kho.layKeHoach(planId)
    if (!plan) throw new ToolError('Không thấy kế hoạch — tải lại trang.')
    if (plan.status !== 'draft') return plan
    const { cfg, ch } = await canGian(ctx)
    if (cfg.executionMode !== 'auto') return { executed: false, plan }
    await conLuotGhi(ctx, cfg.policy)
    if (!(await ctx.kho.gianhKeHoach(plan.id))) return (await ctx.kho.layKeHoach(plan.id)) || plan

    const d = plan.data || {}
    const payload = { sku: d.sku, itemId: d.itemId, skuId: d.skuId, price: d.price }
    let status = 'succeeded', result: any = null
    try {
        result = await doiGiaLazada(ctx, ch, d, cfg.policy, tuyChon.tuDong === true)
        await ctx.kho.ghiNhatKy({ action: 'price', status, planId: plan.id, payload, response: result })
    } catch (e: any) {
        const msg = String(e?.message || e).slice(0, 800)
        if (e instanceof LoiKhuyenMaiLazada) {
            // SKU vừa có giá khuyến mãi (đọc ngay trước khi ghi) — chưa gửi gì lên Lazada; sàn không chặn gì, chính Pilot để yên ⇒ 'skipped'
            status = 'skipped'
            result = { khuyenMai: true, message: msg }
        } else {
            status = laLoiMang(e) ? 'uncertain' : 'failed'
            result = { message: msg }
            if (status === 'uncertain') result.message = `Mất kết nối giữa chừng — không rõ Lazada đã nhận giá mới chưa. Kiểm tra trên Lazada Seller Center trước khi lập lại. (${result.message})`
            // token hỏng: chu kỳ đọc cờ này ⇒ MỘT dòng 'token' rồi dừng ghi cả lượt
            if (laLoiTokenLazada(e)) { result.loiToken = true; result.lyDoToken = e instanceof LoiTokenLazada ? e.lyDo : msg.slice(0, 300) }
        }
        await ctx.kho.ghiNhatKy({ action: 'price', status, planId: plan.id, payload, response: result }).catch(() => { })
        if (!(e instanceof ToolError)) console.error(`[LazadaPilot] thực thi ${plan.id} lỗi:`, e?.message || e)
    }
    await ctx.kho.capNhatKeHoach(plan.id, status, result)
    return (await ctx.kho.layKeHoach(plan.id)) || { ...plan, status, result }
}

/** Ghi giá lên Lazada — soát lại với giá vốn / phí / chính sách / giá đang bán HIỆN TẠI (kế hoạch có thể lập từ trước). */
async function doiGiaLazada(ctx: NgCanhLazada, ch: any, d: any, pol: ChinhSachLazada, tuDong: boolean): Promise<any> {
    const l = await timListingLazada(ctx.prisma, ch.id, d.itemId)
    const fb = await dichVu(ctx, ch)
    // làm mới token hỏng lúc mở dịch vụ ⇒ không ghi — đường uỷ quyền lại nằm ngay trong câu báo
    if (fb.loiLamMoiToken) throw new LoiTokenLazada(fb.loiLamMoiToken, ch.name)
    // giá 0 / rỗng / SKU khuyến mãi / đọc hỏng ⇒ ném: rào biên độ + chỉ-tăng dưới đây luôn so với giá gốc DƯƠNG thật
    const s = await docSkuLazada(ctx, ch, fb, String(d.itemId), { skuId: d.skuId, sellerSku: d.sellerSku }, TUOI_DOC_THUC_THI_MS)
    if (d.khoa && String(d.khoa) !== s.khoa) throw new ToolError('SKU trên Lazada đã đổi từ lúc lập kế hoạch — lập lại kế hoạch.')
    if (d.sellerSku && s.sellerSku && String(d.sellerSku).toLowerCase() !== s.sellerSku.toLowerCase()) {
        throw new ToolError(`SellerSku của SKU đã đổi trên Lazada (${d.sellerSku} → ${s.sellerSku}) — giá vốn có thể khác, lập lại kế hoạch.`)
    }
    const nhan = s.sellerSku || s.skuId
    const v = await vonSku(ctx.prisma, l, s)
    if (!v || !(v.giaVon > 0)) throw new ToolError(`${nhan} thiếu giá vốn — không đổi giá khi không biết lãi/lỗ.`)
    const gia = Math.round(Number(d.price) || 0)
    const mauPhi = await docMauPhiSanPham(ctx.prisma, ch, l.categoryId || s.nganh)
    const kq = tinhGiaDeXuat(thamSoTinh(pol, v.giaVon, mauPhi))
    const chan = chanGiaDuoiSan(gia, kq)
    if (chan) throw new ToolError(`Giá vốn / phí / chính sách đã đổi từ lúc lập kế hoạch: ${chan}`)
    const loiBien = vuotBienDong(s.giaGoc, gia, pol.maxPriceChangeRate, kq.giaSan)
    if (loiBien) throw new ToolError(`Giá trên Lazada đã đổi từ lúc lập kế hoạch. ${loiBien}`)
    // Máy tự chạy + phí chưa đủ tin ⇒ chỉ được TĂNG giá (lãi mỗi đơn tăng theo giá, không bao giờ lỗ thêm)
    const phiChuaTin = tuDong ? lyDoPhiChuaDuTin(gia, mauPhi, pol.minMarginRate * 100) : null
    if (phiChuaTin && !(gia > s.giaGoc)) throw new ToolError(`Không tự hạ giá: ${phiChuaTin}`)
    // giữ giá cũ TRƯỚC khi ghi: `s` là chính đối tượng trong bản đọc nhớ — suaGiaTrongBanDoc sửa nó sang giá mới
    const giaCu = s.giaGoc
    await fb.updatePrice(s.itemId, gia, s.skuId || undefined, s.sellerSku || undefined)
    suaGiaTrongBanDoc(ctx, ch.id, s.khoa, gia)
    // listing lưu giá của SKU ĐẠI DIỆN (chuyenSanPham) — chỉ SKU đó cập nhật dòng OnlineProduct
    if (laSkuDaiDien(l, s)) await ctx.prisma.onlineProduct.update({ where: { id: l.id }, data: { price: gia } }).catch(() => { })
    console.log(`[LazadaPilot] ĐỔI GIÁ ${nhan} (${ch.name}) ${giaCu} → ${gia}`)
    return {
        item_id: s.itemId, sku_id: s.skuId || null, seller_sku: s.sellerSku || null, old_price: giaCu, new_price: gia,
        ...(phiChuaTin ? { warning: `Chỉ được TĂNG giá vì phí Lazada chưa đủ tin — giá sàn có thể còn thấp, xem lại trên Lazada Pilot. ${phiChuaTin}` } : {}),
    }
}

// ─── Chu kỳ ─────────────────────────────────────────────────────────────────────

/** Nháp CHỜ NGƯỜI DUYỆT mới tối đa mỗi chu kỳ — nháp không ăn trần đổi giá. */
const TRAN_NHAP_MOI_CHU_KY = 20
const HAN_NHAP_MS = 3 * 86400_000
const KET_THUC_THI_MS = 3600_000
const TUOI_DANH_MUC_MS = 2 * 3600_000

/**
 * Kế hoạch còn mở: 'running' quá 1 giờ ⇒ 'uncertain' (máy chết giữa lượt ghi — báo chủ shop kiểm Seller Center); nháp máy lập quá
 * 3 ngày, hoặc nháp của lượt Xem trước khi đã sang Tự động ⇒ huỷ. Trả KHOÁ SKU đang có nháp chờ duyệt / người vừa huỷ (14 ngày).
 */
async function donKeHoachMoLazada(ctx: NgCanhLazada, tuDong: boolean, results: any[], now: number): Promise<Set<string>> {
    const choDuyet = new Set<string>()
    let soHuy = 0
    for (const k of await ctx.kho.dsKeHoachTu(now - 30 * 86400_000)) {
        const khoa = k.data?.khoa ? String(k.data.khoa) : ''
        // người huỷ (14 ngày) ⇒ né; máy tự huỷ (quá hạn / Xem trước) thì lượt sau được lập lại
        if (k.status === 'cancelled') { if (!k.result?.tuHuy && now - k.updatedAt < 14 * 86400_000 && khoa) choDuyet.add(khoa); continue }
        if (k.status === 'running') {
            if (now - k.updatedAt > KET_THUC_THI_MS) {
                const message = 'Lượt thực thi dừng giữa chừng (máy chủ khởi động lại?) — không rõ Lazada đã nhận giá mới chưa. Kiểm trên Lazada Seller Center rồi lập lại nếu cần.'
                await ctx.kho.capNhatKeHoach(k.id, 'uncertain', { message })
                results.push({ action: 'price', status: 'uncertain', sku: k.data?.sku || k.data?.itemId, planId: k.id, message })
            }
            continue
        }
        if (k.status !== 'draft') continue
        if (String(k.idempotencyKey || '').startsWith('cycle:')) {
            const quaHan = now - k.createdAt > HAN_NHAP_MS
            // nháp HẠ giá chờ người (phí chưa đủ tin) — máy không tự huỷ, người duyệt / huỷ / hết 3 ngày
            const canDuyet = !!k.data?.feeWarning && !(Number(k.data?.price) > Number(k.data?.snapshot?.price))
            if (quaHan || (tuDong && !canDuyet)) {
                if (await ctx.kho.huyKeHoach(k.id)) {
                    const lyDo = quaHan ? 'Nháp máy lập quá 3 ngày chưa duyệt — tự huỷ.'
                        : String(k.idempotencyKey).startsWith('cycle:xem:') ? 'Nháp của lượt Xem trước — chế độ Tự động lập lại theo giá hiện tại.'
                            : 'Nháp máy lập chưa kịp ghi (hết lượt ghi hôm nay / lượt trước dừng giữa chừng) — tự huỷ, lập lại theo giá hiện tại.'
                    await ctx.kho.capNhatKeHoach(k.id, 'cancelled', { tuHuy: true, message: lyDo })
                    soHuy++
                }
                continue
            }
        }
        if (khoa) choDuyet.add(khoa)
    }
    if (soHuy) results.push({ action: 'plan', status: 'skipped', message: `Huỷ ${soHuy} nháp cũ của máy (quá 3 ngày chưa duyệt / còn từ lượt Xem trước / chưa kịp ghi).` })
    return choDuyet
}

/** Danh mục cũ hơn 2 giờ ⇒ đồng bộ lại (cùng đường ghi với nút "Đồng bộ": upsert theo kênh + mã, không xoá, giữ mã kho đã nối).
 *  Lazada trả luôn ngành (primary_category) nên khỏi bước hỏi ngành từng mã như TikTok. Dịch vụ không có fetchProducts ⇒ bỏ qua. */
async function lamMoiDanhMucLazada(ctx: NgCanhLazada, ch: any, now: number, baoToken: (lyDo: string, e?: any) => void): Promise<any | null> {
    const moi = await ctx.prisma.onlineProduct.findFirst({ where: { channelId: ch.id, syncedAt: { not: null } }, orderBy: { syncedAt: 'desc' }, select: { syncedAt: true } }).catch(() => null)
    const t = moi?.syncedAt ? new Date(moi.syncedAt).getTime() : 0
    if (now - t < TUOI_DANH_MUC_MS) return null
    try {
        const fb = await dichVu(ctx, ch)
        if (typeof fb.fetchProducts !== 'function') return null
        const { products } = await fb.fetchProducts()
        if (!products?.length) return { action: 'catalog', status: 'failed', message: 'Lazada trả danh mục rỗng — giữ bản cũ (kiểm uỷ quyền API của gian).' }
        const n = await luuDanhMucSan(ctx.prisma, ch, products)
        return { action: 'catalog', status: 'succeeded', message: `Đồng bộ lại ${n} mã từ Lazada (bản trước: ${t ? new Date(t + 7 * 3600_000).toISOString().slice(0, 16).replace('T', ' ') : 'chưa có'}).` }
    } catch (e: any) {
        if (laLoiTokenLazada(e)) { baoToken(String(e?.message || e), e); return null }
        return { action: 'catalog', status: 'failed', message: `Không đồng bộ được danh mục từ Lazada: ${String(e?.message || e).slice(0, 200)}` }
    }
}

export async function chayChuKyLazada(ctx0: NgCanhLazada): Promise<any> {
    // dịch vụ Lazada mở MỘT lần cho cả lượt — cả thực thi từng kế hoạch bên trong
    const ctx: NgCanhLazada = { ...ctx0, _dichVu: new Map() }
    const now = luc(ctx)
    const { cfg, ch } = await canGian(ctx)
    const pol = cfg.policy
    const tuDong = cfg.executionMode === 'auto'
    const results: any[] = []
    /* TOKEN HỎNG: làm mới token lúc mở dịch vụ hỏng, hoặc Lazada trả IllegalAccessToken / InvalidToken / AccessTokenExpire ⇒ MỘT
     * dòng action 'token' (lib/pilotBaoChuShop bắt: chủ shop được báo đúng việc — uỷ quyền lại) và KHÔNG ghi gì thêm lượt này. */
    let loiToken: string | null = null
    const baoToken = (lyDo: string, e?: any) => {
        if (loiToken) return
        loiToken = e instanceof LoiTokenLazada ? e.lyDo : lyDo
        results.push({ action: 'token', status: 'failed', canNguoi: true, message: cauUyQuyenLaiLazada(ch.name, loiToken) })
    }
    const moNhap = await donKeHoachMoLazada(ctx, tuDong, results, now)
    const fb0 = await dichVu(ctx, ch)
    if (fb0.loiLamMoiToken) baoToken(fb0.loiLamMoiToken)
    const danhMuc = loiToken ? null : await lamMoiDanhMucLazada(ctx, ch, now, baoToken)
    if (danhMuc) results.push(danhMuc)

    if (pol.automation.syncStock) {
        if (loiToken && tuDong) {
            results.push({ action: 'stock', status: 'skipped', message: 'Không đẩy tồn lượt này — token Lazada của gian cần uỷ quyền lại (xem dòng token).' })
        } else {
            // chạy thử trước — cầu dao (lib/dayTonLenSan.cauDaoTon, đếm trên toàn bộ listing) nhảy thì không đẩy
            const ton = await dayTonChuKy({ tuDong, san: 'Lazada', gian: ch.name, day: o => dayTon(ctx, ch.id, o), conLuot: () => conLuotGhi(ctx, pol), ghi: w => ctx.kho.ghiNhatKy(w) })
            results.push(ton)
            if (tuDong && (ton?.status === 'failed' || ton?.status === 'partial') && laLoiTokenLazada(ton?.message)) baoToken(String(ton.message))
        }
    }

    /* CHƯA BIẾT PHÍ sàn của gian (chưa đủ đơn để đo, chưa khai phí — KHÔNG mượn số đo gian khác) ⇒ không giá nào tính / ghi được:
     * MỘT dòng kèm đường khai phí, khỏi đọc Lazada vô ích. Đẩy tồn vẫn chạy. */
    const bangPhi = pol.automation.reprice && pol.maxRepricePerCycle > 0 ? await docMauPhiTheoNganh(ctx.prisma, ch) : null
    const chuaBietPhi = !!bangPhi?.toanGian.chuaBiet && !bangPhi.theoNganh.size
    if (chuaBietPhi) results.push({ action: 'cycle', status: 'skipped', canNguoi: true, message: dongChuKyChuaBietPhi(bangPhi!.toanGian.soDon, ch.name, 'chưa đổi giá SKU nào') })

    if (bangPhi && !chuaBietPhi && loiToken) {
        results.push({ action: 'price', status: 'skipped', message: 'Không đổi giá lượt này — token Lazada của gian cần uỷ quyền lại (xem dòng token).' })
    } else if (bangPhi && !chuaBietPhi) {
        /* Bước 1 — GIÁ SỐNG cả gian (1–2 lời gọi): quyết theo giá đang bán THẬT, không theo bản lưu. Đọc hỏng ⇒ không đổi giá SKU
         * nào, MỘT dòng lý do. Đọc không phải lệnh ghi ⇒ không ăn trần ghi / ngày (đọc cả khi hết lượt: còn phải soát mã dưới sàn). */
        let ban: BanDocLazada | null = null
        try { ban = await docSanLazada(ctx, ch, await dichVu(ctx, ch), 0) } catch (e: any) {
            if (laLoiTokenLazada(e)) baoToken(String(e?.message || e), e)
            else results.push({ action: 'price', status: 'failed', message: `Không đọc được giá đang bán trên Lazada — chu kỳ không đổi giá SKU nào (${String(e?.message || e).slice(0, 200)}).` })
        }
        if (ban) {
            const listing: any[] = await ctx.prisma.onlineProduct.findMany({ where: { channelId: ch.id }, take: 2000 })
            const theoMa = new Map<string, any>(listing.map(l => [String(l.platformProductId), l]))
            let soChoDuyet = 0, soVuaDoi = 0, soChuaBietPhi = 0, soSkuBan = 0
            const bo = { chuaDongBo: 0, khongGia: 0, nguoiSua: 0, nguoiSuaDuoiSan: 0, khuyenMai: 0 }
            let denNguoiSua = 0
            const vdKm: string[] = [], duoiSanKm: string[] = []
            // Bước 2 — lọc bằng dữ liệu trong hệ thống: SKU đang bán, mã đã đồng bộ, nháp chờ duyệt
            const dong: { l: any; s: SkuSongLazada }[] = []
            for (const [itemId, ds] of ban.theoMa) {
                for (const s of ds) {
                    if (!skuDangBanLazada(s)) continue   // mã / SKU chủ shop tắt trên Lazada — không phải việc của Pilot, khỏi báo mỗi lượt
                    soSkuBan++
                    const l = theoMa.get(itemId)
                    if (!l) { bo.chuaDongBo++; continue }
                    if (moNhap.has(s.khoa)) { soChoDuyet++; continue }
                    dong.push({ l, s })
                }
            }
            const von = await giaVonHangLoat(ctx.prisma, dong.map(d => ({ id: d.s.khoa, localProductId: laSkuDaiDien(d.l, d.s) ? d.l.localProductId ?? null : null, sku: d.s.sellerSku || null })))
            // đọc hỏng ⇒ null ⇒ luật bán chậm nghỉ lượt này (Map rỗng sẽ coi mọi SKU "14 ngày không bán" ⇒ hạ giá cả hàng bán chạy)
            const daBan = await soBan14Ngay(ctx.prisma, ch.id).catch((e: any) => {
                console.error('[LazadaPilot] chu kỳ: đọc số bán 14 ngày hỏng:', e?.message || e)
                return null
            })
            if (!daBan) results.push({ action: 'price', status: 'skipped', message: 'Không đọc được số đã bán 14 ngày — lượt này KHÔNG hạ giá hàng "bán chậm"; SKU dưới giá sàn / lãi dưới mục tiêu vẫn xét như thường.' })
            const polS = chuanHoaChinhSach(pol)
            const daThucThi = await ctx.kho.dsKeHoachTheoTrangThai(['succeeded', 'uncertain'], now - CUA_SO_GIA_PILOT_MS)
            // máy đổi giá cùng SKU cách nhau ≥ 24 giờ tính từ lúc THỰC THI — trừ SKU đang dưới giá sàn
            const vuaDoi = new Set(daThucThi.filter(k => now - k.updatedAt < NGHI_DOI_GIA_MS).map(k => String(k.data?.khoa)))
            const giaPilot = giaPilotDaGhi(daThucThi)
            const deYen = await maDangDeYen(ctx, now)
            const uv: { l: any; s: SkuSongLazada; mauPhi: MauPhi; giaSan: number; giaCu: number; quyet: { gia: number; lyDo: string }; uu: number }[] = []
            for (const { l, s } of dong) {
                const v = von.get(s.khoa)
                if (!v || !(v.giaVon > 0)) continue
                const mauPhi = bangPhi.chon(l.categoryId || s.nganh)   // phí ĐÚNG ngành
                // chưa biết phí (ngành chưa đo trong gian chưa khai phí) ⇒ quyetDinhGia sẽ im lặng "giữ nguyên" — đếm ra để nói
                if (mauPhi.chuaBiet) { soChuaBietPhi++; continue }
                const nhan = s.sellerSku || s.skuId
                const ts = thamSoTinh(pol, v.giaVon, mauPhi)
                const kq = tinhGiaDeXuat(ts)
                /* GIÁ KHUYẾN MÃI (special_price) ⇒ để yên cả hai chiều. Dưới giá sàn (theo giá KHÁCH TRẢ) mà kẹt khuyến mãi ⇒ máy
                 * không nâng được ⇒ chủ shop phải biết (dòng riêng, cần người). */
                if (s.giaKm > 0) {
                    bo.khuyenMai++
                    if (vdKm.length < 3) vdKm.push(`${nhan} ${vnd(giaKhachTra(s))}`)
                    if (kq.giaSan > 0 && giaKhachTra(s) < kq.giaSan) duoiSanKm.push(`${nhan} ${vnd(giaKhachTra(s))} < sàn ${vnd(kq.giaSan)}`)
                    continue
                }
                if (!(s.giaGoc > 0) || (!s.skuId && !s.sellerSku)) { bo.khongGia++; continue }
                const giaCu = s.giaGoc
                const quyet = quyetDinhGia({
                    giaCu, ton: s.ton,
                    daBan14: daBan ? daBanCuaListing(daBan, { sku: s.sellerSku, localProductId: v.productId || (laSkuDaiDien(l, s) ? l.localProductId : null) }) : null,
                    kq, bienHienTaiPct: danhGiaGia(giaCu, ts).bienPct, pol: polS,
                })
                /* GIÁ NGƯỜI VỪA SỬA: giá gốc đang bán ≠ giá Pilot ghi lần cuối ⇒ người vừa sửa (Seller Center, nút Đẩy giá…) ⇒ máy để
                 * yên 7 ngày kể từ lúc PHÁT HIỆN — cả khi máy chưa định đổi SKU đó. SKU Pilot chưa ghi (30 ngày) thì xét như cũ. */
                const g = giaPilot.get(s.khoa)
                if (g && !g.gia.some(y => Math.abs(giaCu - y) < 1)) {
                    const khoa = `skip:nguoi-sua:${s.khoa}:${g.cuoi.id}:${Math.round(giaCu)}`
                    const giu = deYen.theoKhoa.get(khoa) || await ctx.kho.taoKeHoach(keHoachMoi(
                        { khoa: s.khoa, itemId: s.itemId, skuId: s.skuId || null, sku: nhan, name: s.ten, nguoiSua: { gia: giaCu, giaPilot: g.gia[0], planId: g.cuoi.id } },
                        khoa, ctx.nguoi, now, 'skipped')).catch(() => null)
                    // listing lưu giá SKU đại diện — trang hiện đúng giá đang bán
                    if (laSkuDaiDien(l, s) && Math.abs((Number(l.price) || 0) - giaCu) >= 1) await ctx.prisma.onlineProduct.update({ where: { id: l.id }, data: { price: giaCu } }).catch(() => { })
                    const den = giu ? giu.createdAt + GIU_GIA_NGUOI_SUA_MS : now + GIU_GIA_NGUOI_SUA_MS
                    if (den > now) {
                        if (quyet) { bo.nguoiSua++; denNguoiSua = Math.max(denNguoiSua, den); if (giaCu < kq.giaSan) bo.nguoiSuaDuoiSan++ }
                        continue
                    }
                }
                if (!quyet) continue
                const uu = giaCu < kq.giaSan ? 0 : quyet.gia > giaCu ? 1 : 2
                if (uu > 0 && vuaDoi.has(s.khoa)) { soVuaDoi++; continue }
                uv.push({ l, s, mauPhi, giaSan: kq.giaSan, giaCu, quyet, uu })
            }
            // đang dưới giá sàn trước, rồi tăng, hạ giá sau cùng
            uv.sort((a, b) => a.uu - b.uu)

            /* Bước 3 — TRẦN GHI CÒN LẠI hôm nay, tính TRƯỚC vòng lặp, sau đẩy tồn (đẩy tồn cũng ăn một lượt ghi). Xem trước không ghi
             * gì lên Lazada ⇒ chỉ trần mỗi chu kỳ. */
            const daGhiHomNay = tuDong ? await ctx.kho.demGhiTuLuc(dauNgayVN(now)) : 0
            const tranGhi = tuDong ? Math.min(pol.maxRepricePerCycle, pol.maxWritesPerDay - daGhiHomNay) : pol.maxRepricePerCycle
            const hetTranNgay = tuDong && tranGhi < pol.maxRepricePerCycle
            const cauDuoi = (ds: typeof uv) => ds.filter(u => u.uu === 0).map(u => `${u.s.sellerSku || u.s.skuId} ${vnd(u.giaCu)} < sàn ${vnd(u.giaSan)}`)
            let soGhi = 0, soNhap = 0, soHoi = 0, hetLuot = false, i = 0
            if (tranGhi <= 0) {
                // HẾT TRẦN NGÀY mà còn SKU bán DƯỚI GIÁ SÀN (giá SỐNG vừa đọc) ⇒ máy không nâng được tới mai ⇒ chủ shop phải biết
                const duoi = cauDuoi(uv)
                results.push({
                    action: 'price', status: 'skipped', ...(duoi.length ? { canNguoi: true } : {}),
                    message: `Đã hết lượt ghi hôm nay (${daGhiHomNay}/${pol.maxWritesPerDay} theo chính sách) — ${duoi.length ? cauConDuoiSan('Lazada', duoi) : 'đổi giá để mai, hoặc nâng «Thao tác ghi mỗi ngày» ở Sửa chính sách.'}`,
                })
                i = uv.length
            } else {
                for (; i < uv.length; i++) {
                    const u = uv[i]
                    if (loiToken || soGhi >= tranGhi || soHoi >= tranGhi * 3 + TRAN_NHAP_MOI_CHU_KY) break
                    const ha = !(u.quyet.gia > u.giaCu)
                    // Phí chưa đủ tin ⇒ máy KHÔNG tự HẠ giá: để nháp chờ người duyệt. TĂNG giá thì được.
                    const chuaTin = tuDong ? lyDoPhiChuaDuTin(u.quyet.gia, u.mauPhi, pol.minMarginRate * 100) : null
                    if (chuaTin && ha && soNhap >= TRAN_NHAP_MOI_CHU_KY) continue
                    soHoi++
                    const nhan = u.s.sellerSku || u.s.skuId
                    try {
                        let plan: any = await taoKeHoachGiaLazada(ctx, {
                            itemId: u.s.itemId, skuId: u.s.skuId, sellerSku: u.s.sellerSku, price: u.quyet.gia, song: u.s,
                            idempotencyKey: `${tuDong ? 'cycle' : 'cycle:xem'}:price:${u.s.khoa}:${ngayVN(now)}:${u.quyet.gia}`,
                        })
                        if (plan.status !== 'draft') continue   // cùng khoá trong ngày đã thực thi / hỏng — đã báo ở lượt đó
                        const choDuyet = chuaTin && !(u.quyet.gia > (Number(plan.data?.snapshot?.price) || u.giaCu)) ? chuaTin : null
                        if (tuDong && !choDuyet) {
                            plan = await thucThiLazada(ctx, plan.id, { tuDong: true })
                            soGhi++
                            const xong = plan.plan || plan
                            // Lazada báo token hỏng ngay lúc ghi ⇒ MỘT dòng 'token' thay cho dòng giá này, dừng ghi cả lượt
                            if (xong.result?.loiToken) { baoToken(String(xong.result.lyDoToken || xong.result.message || '')); break }
                        }
                        else if (choDuyet) soNhap++
                        else soGhi++   // Xem trước: nháp thay cho lần ghi
                        const p = plan.plan || plan
                        results.push({
                            action: 'price', status: p.status, sku: nhan, planId: p.id,
                            ...(choDuyet ? { canNguoi: true } : {}),
                            message: `${vnd(Number(p.data?.snapshot?.price) || u.giaCu)} → ${vnd(u.quyet.gia)}: ${u.quyet.lyDo}${p.result?.message ? ` — ${p.result.message}` : ''}${p.result?.warning ? ` — ${p.result.warning}` : ''}${choDuyet ? ` — CHỜ NGƯỜI DUYỆT: ${choDuyet}` : ''}`,
                        })
                    } catch (e: any) {
                        if (e instanceof LoiHetLuotGhi) { hetLuot = true; break }
                        if (laLoiTokenLazada(e)) { baoToken(String(e?.message || e), e); break }
                        if (e instanceof LoiKhuyenMaiLazada) { bo.khuyenMai++; continue }
                        soGhi++   // lỗi lập kế hoạch cũng tính một lượt — chu kỳ không quay mãi trên SKU hỏng
                        results.push({ action: 'price', status: 'failed', sku: nhan, message: String(e?.message || e).slice(0, 300) })
                    }
                }
            }
            const con = uv.length - i   // ứng viên chưa tới lượt
            if (soVuaDoi) results.push({ action: 'price', status: 'skipped', message: `${soVuaDoi} SKU vừa đổi giá trong 24 giờ — chờ xem đơn rồi mới đổi tiếp.` })
            if (soChoDuyet) results.push({ action: 'price', status: 'skipped', message: `${soChoDuyet} SKU đang có nháp chờ duyệt / người vừa huỷ — duyệt hoặc huỷ trên Lazada Pilot (nháp máy lập tự huỷ sau 3 ngày, SKU người huỷ thì 14 ngày không đề xuất lại).` })
            if (soChuaBietPhi) results.push({ action: 'price', status: 'skipped', canNguoi: true, message: `${soChuaBietPhi} SKU CHƯA BIẾT PHÍ sàn (ngành chưa đủ đơn để đo, gian chưa khai phí) — không tính được giá. Khai phí sàn của gian ở Kênh bán online.` })
            if (bo.nguoiSua) {
                results.push({ action: 'price', status: 'skipped', message: `${bo.nguoiSua} SKU chủ shop vừa sửa giá tay trên Lazada — Pilot để yên tới ${ngayThangVN(denNguoiSua)}`
                    + `${bo.nguoiSuaDuoiSan ? ` (trong đó ${bo.nguoiSuaDuoiSan} SKU đang dưới giá sàn — xem lại giá trên Lazada Seller Center)` : ''}.` })
            }
            // SKU DƯỚI GIÁ SÀN kẹt giá khuyến mãi — dòng RIÊNG, việc nói trước (tin báo chỉ giữ 180 ký tự đầu mỗi dòng)
            if (duoiSanKm.length) {
                results.push({
                    action: 'price', status: 'skipped', canNguoi: true,
                    message: `${duoiSanKm.length} SKU DƯỚI GIÁ SÀN đang chạy giá khuyến mãi Lazada — Pilot không đổi giá khuyến mãi, sửa trên Lazada Seller Center: ${duoiSanKm.slice(0, 3).join('; ')}${duoiSanKm.length > 3 ? '; …' : ''}.`,
                })
            }
            if (bo.khuyenMai) {
                results.push({
                    action: 'price', status: 'skipped',
                    message: `${bo.khuyenMai} SKU đang có giá khuyến mãi Lazada — Pilot để yên giá gốc (khách trả giá khuyến mãi; Kengi chưa ghi giá khuyến mãi): ${vdKm.join('; ')}${bo.khuyenMai > vdKm.length ? '; …' : ''}.`,
                })
            }
            const boQua = [bo.khongGia && `${bo.khongGia} SKU Lazada trả giá gốc 0 / rỗng`, bo.chuaDongBo && `${bo.chuaDongBo} SKU của mã chưa đồng bộ vào hệ thống`].filter(Boolean).join(', ')
            if (boQua) results.push({ action: 'price', status: 'skipped', message: `Bỏ qua theo giá đọc thẳng từ Lazada: ${boQua} — không đổi giá các SKU này.` })
            if (!loiToken && tranGhi > 0) {
                if (hetLuot || (hetTranNgay && soGhi >= tranGhi && con > 0)) {
                    const daGhi = await ctx.kho.demGhiTuLuc(dauNgayVN(now))
                    // SKU chưa tới lượt mà giá SỐNG dưới giá sàn ⇒ chờ tới mai là bán dưới mức lãi tối thiểu ⇒ cần người
                    const duoi = cauDuoi(uv.slice(i))
                    results.push({
                        action: 'price', status: 'skipped', ...(duoi.length ? { canNguoi: true } : {}),
                        message: `Đã hết lượt ghi hôm nay (${daGhi}/${pol.maxWritesPerDay} theo chính sách)${con > 0 ? ` — còn ${con} SKU để mai` : ''}${duoi.length ? `; ${cauConDuoiSan('Lazada', duoi)}` : '.'}`,
                    })
                } else if (!soGhi && !soNhap) {
                    // còn SKU bị giữ / chưa biết phí / không đọc được giá thì không biết có cần đổi hay không — đừng nói "không SKU nào cần đổi"
                    const chua = soChuaBietPhi || bo.nguoiSua || bo.khuyenMai || boQua
                    results.push({ action: 'price', status: 'unchanged', message: `Soát ${soSkuBan} SKU đang bán: ${chua ? 'chưa đổi giá SKU nào' : 'không SKU nào cần đổi giá'}.` })
                } else if (soGhi >= tranGhi && con > 0) {
                    results.push({ action: 'price', status: 'skipped', message: `Mỗi chu kỳ đổi tối đa ${tranGhi} SKU — còn ${con} SKU chờ chu kỳ sau.` })
                }
            }
        }
    }
    if (!results.length) results.push({ action: 'cycle', status: 'unchanged', message: 'Chính sách đang tắt cả đổi giá lẫn đẩy tồn.' })
    return { executionMode: cfg.executionMode, results }
}

// ─── Kiểm tra kết nối (chỉ đọc) ─────────────────────────────────────────────────

export async function kiemKetNoiLazada(ctx: NgCanhLazada): Promise<any> {
    const now = luc(ctx)
    const { ch } = await canGian(ctx)
    const fb = await dichVu(ctx, ch)
    const buoc: { ten: string; ok: boolean; chiTiet: string }[] = []
    const thu = async (ten: string, f: () => Promise<string>) => {
        try { buoc.push({ ten, ok: true, chiTiet: await f() }) } catch (e: any) { buoc.push({ ten, ok: false, chiTiet: String(e?.message || e).slice(0, 300) }) }
    }
    if (fb.loiLamMoiToken) buoc.push({ ten: 'Làm mới token', ok: false, chiTiet: cauUyQuyenLaiLazada(ch.name, fb.loiLamMoiToken) })
    await thu('Thông tin gian (seller/get)', async () => { const r = await fb.testConnection(); if (!r.success) throw new Error(r.error || 'không rõ'); return r.shopName || 'OK' })
    // đọc MỚI — làm mới luôn bản đọc trang / thực thi dùng chung
    await thu('Sản phẩm + giá từng SKU (products/get)', async () => {
        const ban = await docSanLazada(ctx, ch, fb, 0)
        const skus = [...ban.theoMa.values()].flat()
        const ban2 = skus.filter(skuDangBanLazada)
        const km = ban2.filter(s => s.giaKm > 0).length
        const nhieu = [...ban.theoMa.values()].filter(ds => ds.length > 1).length
        return `${ban.soMa} mã / ${ban.soSku} SKU (${ban2.length} đang bán, ${nhieu} mã nhiều phân loại) · ${km} SKU có giá khuyến mãi — Pilot để yên`
            + (ban.catTai ? ` · ${ban.catTai}` : '')
    })
    if (typeof fb.docGiaoDichTaiChinh === 'function') {
        await thu('Giao dịch tài chính 7 ngày (finance/transaction/details)', async () => {
            const den = ngayVN(now), tu = ngayVN(now - 7 * 86400_000)
            const r = await fb.docGiaoDichTaiChinh!({ tu, den, toiDaTrang: 1 })
            const n = r?.dong?.length || 0
            return `${n}${r?.catTai ? '+' : ''} dòng giao dịch ${tu} → ${den} — đọc được API tài chính (phí THẬT từng đơn ghi mỗi 6 giờ).`
        })
    }
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

export async function luuCauHinhLazada(ctx: NgCanhLazada, b: any): Promise<CauHinhLazada> {
    const { cfg, kenh } = await docCauHinhLazada(ctx)
    let channelId = cfg.channelId
    if (b?.channelId !== undefined) {
        if (b.channelId && !kenh.some(c => c.id === b.channelId)) throw new ToolError('Gian Lazada không thuộc cửa hàng này')
        channelId = b.channelId || null
    }
    const executionMode = b?.executionMode === 'auto' ? 'auto' : b?.executionMode === 'preview' ? 'preview' : cfg.executionMode
    const policy = chuanHoaChinhSachLazada({ ...cfg.policy, ...(b?.policy || {}), automation: { ...cfg.policy.automation, ...(b?.policy?.automation || {}) } })
    const schedule = b?.schedule ? chuanHoaLichLazada({ ...cfg.schedule, ...b.schedule }) : cfg.schedule
    const doiLich = schedule.enabled !== cfg.schedule.enabled || schedule.intervalMinutes !== cfg.schedule.intervalMinutes
    const nextRunAt = !schedule.enabled ? null : (!doiLich && cfg.nextRunAt) ? cfg.nextRunAt : luc(ctx) + schedule.intervalMinutes * 60_000
    const moi: CauHinhLazada = { ...cfg, channelId, executionMode, policy, schedule, nextRunAt, updatedAt: Date.now() }
    await ctx.kho.luuCauHinh(moi)
    // ai đổi gì — dòng sổ 'config' (không tính vào trần ghi / ngày)
    await ghiDoiCauHinh(ctx.kho, {
        nguoi: ctx.nguoi, nhan: NHAN_LAZADA, docRieng: { channelId: v => kenh.find(c => c.id === v)?.name || String(v) },
        cu: { channelId: cfg.channelId, executionMode: cfg.executionMode, policy: cfg.policy, schedule: cfg.schedule },
        moi: { channelId, executionMode, policy, schedule },
    })
    return moi
}

// ─── Chạy theo lịch (gọi từ cron/aiAgentCron) ───────────────────────────────────

/** Chạy MỘT chu kỳ nếu tới hẹn. Chưa từng dùng Pilot ⇒ bảng không có ⇒ 'khong-dung' (KHÔNG tạo bảng hộ). */
export async function chayTheoLichLazada(prisma: any, kho?: KhoLazadaPilot, ngoai: Partial<NgCanhLazada> = {}): Promise<'khong-dung' | 'chua-toi' | 'bi-gianh' | 'da-chay' | 'loi'> {
    const now = ngoai.bayGio ? ngoai.bayGio() : Date.now()
    let den: number, lich: LichLazada
    if (kho) {
        const c = await kho.docCauHinh()
        if (!c || c.nextRunAt == null) return 'khong-dung'
        den = c.nextRunAt; lich = c.schedule
    } else {
        let r: any
        try {
            [r] = await prisma.$queryRawUnsafe(`SELECT "nextRunAt"::float8 AS "nextRunAt", schedule FROM "LazadaPilotConfig" WHERE id = 'default'`)
        } catch {
            return 'khong-dung'
        }
        if (!r || r.nextRunAt == null) return 'khong-dung'
        den = Number(r.nextRunAt); lich = chuanHoaLichLazada(docJson(r.schedule, {}))
    }
    if (!lich.enabled) return 'khong-dung'
    if (den > now) return 'chua-toi'
    const k = kho || khoSqlLazada(prisma)
    if (!(await k.gianhLich(den, now + lich.intervalMinutes * 60_000))) return 'bi-gianh'
    const truoc = (await k.docCauHinh().catch(() => null))?.lastResult?.baoChuShop
    let ketQua: any
    try {
        const kq = await chayChuKyLazada({ ...ngoai, prisma, kho: k, nguoi: 'lich' })
        ketQua = { ok: true, executionMode: kq.executionMode, results: kq.results }
    } catch (e: any) {
        ketQua = { ok: false, message: String(e?.message || e).slice(0, 500) }
    }
    // Xem trước chưa ghi gì lên sàn ⇒ chỉ chu kỳ gãy + token hỏng mới báo (ketQuaDeBao); Tự động ⇒ mọi việc cần người
    const bao = await baoChuShop(prisma, 'Lazada Pilot', ketQuaDeBao(ketQua, ketQua.executionMode !== 'auto'), truoc, now).catch(() => truoc)
    await k.ghiKetQuaLich(now, { ...ketQua, ...(bao ? { baoChuShop: bao } : {}) }).catch(() => { })
    return ketQua.ok ? 'da-chay' : 'loi'
}

export const HUONG_DAN_LAZADA_PILOT = `LAZADA PILOT TRÊN KENGI

Pilot chạy trên máy chủ Kengi, dữ liệu lấy thẳng từ kho của cửa hàng, đơn Lazada và giao dịch tài chính Lazada.

1. Kết nối
   - Mở kengi.vn → Bán Hàng Online → Lazada Pilot (https://kengi.vn/pilot-lazada/), đăng nhập bằng tài khoản Kengi.
   - Gian Lazada lấy từ Kênh bán online của Kengi (đã uỷ quyền API). Cửa hàng có nhiều gian thì chọn gian ở Tự động hóa → Sửa chính sách.
   - Lập kế hoạch, thực thi, đổi chính sách chỉ quản lý / chủ cửa hàng.

2. Sản phẩm — TỪNG SKU
   - Lazada đặt giá theo từng SKU (phân loại), nên Pilot làm việc theo SKU: mỗi dòng là một SKU đọc THẲNG từ Lazada (giá gốc,
     giá khuyến mãi, tồn, trạng thái). Hàng nhiều phân loại đổi giá được — mỗi phân loại một giá vốn.
   - Giá vốn: SKU đại diện của mã (mã một SKU, hoặc SKU trùng SKU lưu của mã) theo mã kho đã nối; các phân loại khác theo mã kho
     TRÙNG SellerSku (cả ánh xạ SKU, mã gộp). Chưa nối thì không có giá vốn, không đổi giá.

3. Định giá
   - Phí Lazada đo từ chính các đơn của gian — phí THẬT từng đơn lấy từ giao dịch tài chính Lazada (ghi mỗi 6 giờ). KHÔNG lấy số
     đo của gian khác. Mỗi chỗ hiện phí đều ghi rõ nguồn: đo từ bao nhiêu đơn, của ngành nào / cả gian, hay số khai.
   - Gian chưa đủ 8 đơn đo được phí: dùng phí sàn chủ shop KHAI cho gian (Đơn Hàng Online → nút «Kênh bán hàng» → nút «Key» ở
     dòng của gian → ô «Phí sàn (%)») — người duyệt được, máy không tự hạ giá theo số khai. Ô phí còn để mặc định 6% (chưa
     khai) thì CHƯA BIẾT PHÍ: không tính được giá, không đổi được giá nào cho tới khi khai phí; chu kỳ báo một dòng.
   - Giá đề xuất = đạt lãi mục tiêu sau phí Lazada, đóng gói, quảng cáo, thuế GTGT (nếu khai). Giá sàn = lãi tối thiểu NGAY CẢ KHI
     đơn đi qua affiliate (cộng trọn "Hoa hồng affiliate"). Máy chủ từ chối mọi giá dưới giá sàn.
   - Pilot chỉ đổi GIÁ GỐC (Price). SKU đang có GIÁ KHUYẾN MÃI (special price) thì để yên cả hai chiều — khách trả giá khuyến mãi;
     nâng giá gốc lên trên giá khuyến mãi đang tắt là bật lại nó. Đổi giá khuyến mãi ở Lazada Seller Center. SKU khuyến mãi mà
     giá khách trả DƯỚI GIÁ SÀN thì chu kỳ báo chủ shop.
   - Giá đang bán luôn đọc THẲNG từ Lazada (trang: bản đọc ≤ 5 phút; chu kỳ: đọc mới; thực thi: bản đọc ≤ 60 giây). Lazada trả giá
     0 / rỗng hoặc đọc hỏng ⇒ không đổi giá SKU đó; chu kỳ đọc hỏng ⇒ không đổi giá SKU nào, báo một dòng lý do.
   - Máy (chu kỳ Tự động) chỉ tự HẠ giá khi phí đã đo từ ≥ 30 đơn và đủ chắc ở mức giá đó. TĂNG giá thì máy vẫn tự làm.

4. Kế hoạch → thực thi
   - Mọi thao tác ghi tạo KẾ HOẠCH trước. Chế độ Xem trước: thực thi không gọi Lazada. Chế độ Tự động: thực thi ghi lên Lazada thật.
   - Giới hạn: đổi giá tối đa X% mỗi lần, số thao tác ghi mỗi ngày, số SKU đổi giá mỗi chu kỳ.

5. Chu kỳ
   - Đẩy tồn từ kho Kengi lên gian (nếu bật — cùng đường nút "Đẩy tồn"), soát và đổi giá tối đa N SKU.
   - Chạy theo lịch: bật ở Sửa chính sách (mỗi 30–1440 phút), máy chủ tự chạy, không cần mở trang.
   - Mỗi SKU máy đổi giá tối đa 1 lần / 24 giờ tính từ lúc GHI lên Lazada (trừ SKU đang dưới giá sàn); SKU đang lỗ được xét trước.
   - Giá chủ shop SỬA TAY (Seller Center, nút Đẩy giá…): giá đang bán khác giá Pilot ghi lần cuối ⇒ máy để yên SKU đó 7 ngày kể từ
     lúc thấy. SKU Pilot chưa từng ghi thì xét như thường.
   - Hết lượt ghi trong ngày (Thao tác ghi mỗi ngày): chu kỳ dừng ghi, báo MỘT dòng — không phải lỗi; mai làm tiếp.
   - Danh mục trong hệ thống cũ hơn 2 giờ thì chu kỳ tự đồng bộ lại. Đẩy tồn có cầu dao: nhiều mã đang có hàng sẽ về 0 ⇒ không đẩy.
   - Nháp chờ duyệt không chiếm lượt đổi giá; máy lập tự huỷ sau 3 ngày; Huỷ = 14 ngày không đề xuất lại.
     Có việc cần người (nháp chờ duyệt, ghi hỏng, cầu dao, chưa biết phí, token hỏng): báo trên chuông web + app Android (nhóm
     «Pilot tự động») khi danh sách đổi (cách nhau ≥ 3 giờ); chu kỳ lỗi báo ngay; việc còn nguyên sau 24 giờ thì nhắc lại.
   - Token Lazada hỏng (làm mới không được, Lazada báo token sai / hết hạn): Pilot DỪNG ghi lên Lazada lượt đó, báo "Cần uỷ quyền
     lại gian Lazada" — Đơn Hàng Online → nút «Kênh bán hàng» → nút «Cấp lại quyền» ở dòng của gian.

6. Chưa làm
   - Đăng sản phẩm mới lên Lazada, tạo / sửa giá khuyến mãi (special price, flash sale).
`
