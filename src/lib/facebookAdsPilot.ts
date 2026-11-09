/* ═══════════════════════════════════════════════════════════════════════════════
 *  ADS PILOT — quảng cáo Facebook tự lái, mục con của Facebook Pilot (05/11/2026)
 *
 *  Chủ shop: "Trong phần fb pilot có phần ads pilot nữa nha". Pilot đẩy (boost) bài sản phẩm mà Facebook Pilot đã đăng,
 *  tự tạm dừng quảng cáo hết hàng / đổi giá / tiêu tiền không ra khách hỏi, tự tăng ngân sách quảng cáo tốt — trong trần
 *  ngân sách chủ shop đặt. Cùng khuôn lib/facebookPilot.ts: mọi thao tác ghi đi qua KẾ HOẠCH → THỰC THI; khoá
 *  idempotency; giành kế hoạch nguyên tử (draft → running); trần thao tác ghi mỗi ngày (giờ VN); lịch tắt mặc định.
 *  Bảng RIÊNG (FacebookAdsPilot*) — không ăn trần ghi / sổ kế hoạch của phần lên bài.
 *
 *  TIỀN THẬT nên thêm rào riêng (máy chủ chặn, không trông vào giao diện):
 *    - Ba chế độ: 'preview' (không gọi Facebook) · 'approve' (máy chỉ tự làm việc GIẢM chi — tạm dừng, hạ ngân sách;
 *      việc TĂNG chi — bật quảng cáo mới, chạy lại, tăng ngân sách — chờ người bấm) · 'auto' (máy làm cả hai, trong trần).
 *    - Trần ngân sách/ngày (dailyBudgetCap) mặc định 0 ⇒ chưa đặt trần thì KHÔNG việc tăng chi nào chạy, kể cả người bấm.
 *    - Lúc thực thi việc tăng chi, máy chủ đọc SỐNG ngân sách các quảng cáo Pilot đang chạy trên Facebook; đọc không
 *      được ⇒ không bật (hỏng thì đóng). Khoá tiền trên CSDL ⇒ hai lượt song song không cùng lọt trần.
 *    - Chỉ đụng quảng cáo DO PILOT TẠO (mã chiến dịch nằm trong kế hoạch 'boost'). Chiến dịch chủ shop tự chạy chỉ đọc số tổng.
 *    - Một công tắc: chiến dịch tạo ở PAUSED, nhóm QC + quảng cáo ACTIVE bên trong ⇒ chưa bật chiến dịch thì chưa tiêu đồng
 *      nào; dựng dở thì xoá chiến dịch rỗng; tạm dừng = tắt chiến dịch. Nhóm QC luôn có giờ kết thúc (≤ 30 ngày).
 *    - Lúc thực thi soát lại kho: tồn ≥ mức tối thiểu, giá bán CHƯA ĐỔI (bài quảng cáo ghi giá lúc đăng); máy tự chạy thì
 *      còn đòi biết giá vốn + đủ lãi gộp (giá vốn 0 = CHƯA BIẾT, không phải lãi 100%).
 *    - Tài khoản quảng cáo phải ACTIVE và tính tiền bằng VND.
 *    - Người bật lại quảng cáo máy đã tạm dừng ⇒ máy KHÔNG tự tắt lại vì cùng lý do (người thắng máy).
 *  Token: Marketing API cần USER token (hoặc system user) có ads_management — page token không chạy quảng cáo. Máy chủ chưa
 *  có app Facebook qua OAuth (FB_APP_ID rỗng) ⇒ chủ shop DÁN token như page token; lưu FbUserToken (dùng chung Fanpage
 *  Manager / MCP) KÈM danh sách quyền — fanpageCron không lấy token thiếu quyền trang để "chữa" page token (tokenChuaDuocPage).
 *  "Kết quả" của một quảng cáo = bình luận + tin nhắn mới (actions của Insights) — dấu hiệu khách hỏi mua; lượt thích không tính.
 *  Công thức Marketing API (cờ v23+/v24+) nằm ở services/platforms/facebook.ts (thamSoChienDichDayBai / thamSoNhomDayBai).
 * ═══════════════════════════════════════════════════════════════════════════════ */

import crypto from 'crypto'
import { ToolError } from './mcpTypes'
import { TRANG_THAI_BAN } from './sucKhoeTaiChinhKhach'
import { FacebookService, GRAPH_ADS, thamSoChienDichDayBai, thamSoNhomDayBai, laLoiTokenFb, laLoiQuyenFb, quyenThieuFb, isRateLimitError, docLeGraph } from '../services/platforms/facebook'
import { baoChuShop, ketQuaDeBao, baoMayTangChi, guiTinPilot, type GuiDayPilot } from './pilotBaoChuShop'
import { ghiDoiCauHinh, NHAN_ADS } from './pilotDoiCauHinh'
import { docCauHinhFb, khoSqlFb, dauNgayVN, ngayGioVN, vnd, type KhoFbPilot } from './facebookPilot'

// ─── Tiện ích nhỏ ───────────────────────────────────────────────────────────────

const so = (v: any, d: number): number => {
    if (v === null || v === undefined || (typeof v === 'string' && v.trim() === '')) return d
    const n = Number(v)
    return Number.isFinite(n) ? n : d
}
const kep = (v: any, d: number, min: number, max: number) => Math.min(Math.max(so(v, d), min), max)
const docJson = (s: any, d: any = null) => { try { return s ? JSON.parse(s) : d } catch { return d } }
const tenGon = (s: any) => String(s || '').replace(/\s+/g, ' ').trim()
const tron1000 = (n: number) => Math.round(n / 1000) * 1000
const NGAY = 86400_000
const ngayVN = (ms: number) => new Date(ms + 7 * 3600_000).toISOString().slice(0, 10)

/** "act_123" / "123" → "act_123"; chuỗi lạ ⇒ null. */
export function chuanAct(v: any): string | null {
    const s = String(v || '').trim().replace(/^act_/i, '')
    return /^\d{3,25}$/.test(s) ? `act_${s}` : null
}

/** Lãi gộp % theo giá bán. Giá vốn ≤ 0 = CHƯA BIẾT ⇒ null (không phải lãi 100%). */
export function laiGop(gia: number, giaVon: number): number | null {
    if (!(Number(gia) > 0) || !(Number(giaVon) > 0)) return null
    return Math.round(((gia - giaVon) / gia) * 1000) / 10
}

/** Lỗi mạng sau khi đã gửi: không biết Facebook đã nhận chưa ⇒ 'uncertain', đừng tự làm lại. 09/11/2026: FacebookService gắn
 *  khongRoKetCuc cho lệnh ghi gặp HTTP 5xx / hết giờ / phản hồi không phải JSON — cũng là "không rõ" (5xx mang mã lỗi Graph nên
 *  phép thử chữ cũ bỏ sót). Lỗi mạng thô của dịch vụ giả trong bộ kiểm vẫn bắt theo chữ. */
function laLoiMang(e: any): boolean {
    if (e?.khongRoKetCuc === true || e?.hetGio === true) return true
    return !e?.code && !(e instanceof ToolError) && /fetch failed|network|ECONNRESET|ETIMEDOUT|socket|aborted|EAI_AGAIN/i.test(String(e?.message || e))
}

// ─── Chính sách ─────────────────────────────────────────────────────────────────

export interface ChinhSachAds {
    /** tổng ngân sách/ngày của mọi quảng cáo Pilot đang chạy (đ). 0 ⇒ không việc tăng chi nào chạy */
    dailyBudgetCap: number
    /** ngân sách/ngày mỗi quảng cáo mới (đ) */
    budgetPerAd: number
    /** trần ngân sách/ngày MỘT quảng cáo (đ) — tăng ngân sách không vượt */
    maxBudgetPerAd: number
    /** số ngày chạy mỗi quảng cáo (Facebook chỉ nhận ngân sách ngày cho nhóm chạy > 24 giờ ⇒ ≥ 2) */
    days: number
    /** số quảng cáo Pilot chạy cùng lúc */
    maxActiveAds: number
    /** chỉ quảng cáo hàng còn tồn DƯƠNG ít nhất N */
    minStock: number
    /** máy tự quảng cáo chỉ hàng có lãi gộp ≥ X% (giá bán − giá vốn) / giá bán. 0 = không xét */
    minMarginPct: number
    /** chỉ đẩy bài đăng trong N ngày gần đây */
    postMaxAgeDays: number
    /** chi tới mức này mà 0 kết quả (bình luận + tin nhắn) ⇒ tạm dừng. 0 = tắt */
    stopLossVnd: number
    /** chi phí tối đa mỗi kết quả (đ). 0 = không xét (và không tự tăng ngân sách) */
    maxCostPerResult: number
    ageMin: number
    ageMax: number
    /** thao tác ghi quảng cáo mỗi ngày (tính cả lần hỏng) */
    maxActionsPerDay: number
    automation: { boostNewPosts: boolean; pauseOutOfStock: boolean; pauseLosers: boolean; scaleWinners: boolean; resumeRestocked: boolean }
}

/** Facebook không nhận ngân sách ngày quá thấp (theo tiền tệ, ~1 USD với tối ưu hiển thị) — giữ biên an toàn. */
export const NGAN_SACH_TOI_THIEU = 30_000

export const CHINH_SACH_ADS_MAC_DINH: ChinhSachAds = {
    dailyBudgetCap: 0,
    budgetPerAd: 50_000,
    maxBudgetPerAd: 150_000,
    days: 5,
    maxActiveAds: 2,
    minStock: 5,
    minMarginPct: 20,
    postMaxAgeDays: 14,
    stopLossVnd: 100_000,
    maxCostPerResult: 0,
    ageMin: 18,
    ageMax: 65,
    maxActionsPerDay: 20,
    // tiêu tiền phải do chủ shop bật — mặc định máy chỉ được TẮT quảng cáo
    automation: { boostNewPosts: false, pauseOutOfStock: true, pauseLosers: true, scaleWinners: false, resumeRestocked: false },
}

/** Chuẩn hoá chính sách người gửi lên — số lạ về mặc định, kẹp trong khoảng an toàn, tiền tròn nghìn. */
export function chuanHoaChinhSachAds(x: any): ChinhSachAds {
    const m = CHINH_SACH_ADS_MAC_DINH
    const tu = x?.automation || {}
    const bool = (v: any, d: boolean) => (typeof v === 'boolean' ? v : d)
    const budgetPerAd = tron1000(kep(x?.budgetPerAd, m.budgetPerAd, NGAN_SACH_TOI_THIEU, 5_000_000))
    const maxBudgetPerAd = Math.max(budgetPerAd, tron1000(kep(x?.maxBudgetPerAd, m.maxBudgetPerAd, NGAN_SACH_TOI_THIEU, 20_000_000)))
    const ageMin = Math.floor(kep(x?.ageMin, m.ageMin, 18, 65))
    return {
        dailyBudgetCap: tron1000(kep(x?.dailyBudgetCap, m.dailyBudgetCap, 0, 100_000_000)),
        budgetPerAd,
        maxBudgetPerAd,
        days: Math.floor(kep(x?.days, m.days, 2, 30)),
        maxActiveAds: Math.floor(kep(x?.maxActiveAds, m.maxActiveAds, 0, 10)),
        minStock: Math.floor(kep(x?.minStock, m.minStock, 1, 1_000_000)),
        minMarginPct: Math.round(kep(x?.minMarginPct, m.minMarginPct, 0, 90) * 10) / 10,
        postMaxAgeDays: Math.floor(kep(x?.postMaxAgeDays, m.postMaxAgeDays, 1, 60)),
        stopLossVnd: tron1000(kep(x?.stopLossVnd, m.stopLossVnd, 0, 50_000_000)),
        maxCostPerResult: tron1000(kep(x?.maxCostPerResult, m.maxCostPerResult, 0, 10_000_000)),
        ageMin,
        ageMax: Math.max(ageMin, Math.floor(kep(x?.ageMax, m.ageMax, 18, 65))),
        maxActionsPerDay: Math.floor(kep(x?.maxActionsPerDay, m.maxActionsPerDay, 1, 200)),
        automation: {
            boostNewPosts: bool(tu.boostNewPosts, m.automation.boostNewPosts),
            pauseOutOfStock: bool(tu.pauseOutOfStock, m.automation.pauseOutOfStock),
            pauseLosers: bool(tu.pauseLosers, m.automation.pauseLosers),
            scaleWinners: bool(tu.scaleWinners, m.automation.scaleWinners),
            resumeRestocked: bool(tu.resumeRestocked, m.automation.resumeRestocked),
        },
    }
}

export interface LichAds { enabled: boolean; intervalMinutes: number }
export const LICH_ADS_MAC_DINH: LichAds = { enabled: false, intervalMinutes: 120 }
export function chuanHoaLichAds(x: any): LichAds {
    return { enabled: x?.enabled === true, intervalMinutes: Math.floor(kep(x?.intervalMinutes, LICH_ADS_MAC_DINH.intervalMinutes, 30, 24 * 60)) }
}

export type CheDoAds = 'preview' | 'approve' | 'auto'
const CHE_DO: CheDoAds[] = ['preview', 'approve', 'auto']

export interface CauHinhAds {
    mode: CheDoAds
    adAccountId: string | null
    /** FbUserToken Ads Pilot dùng (token dán ở tab Quảng cáo); null ⇒ token user mới nhất (vd. token OAuth của Fanpage Manager) */
    fbUserId: string | null
    policy: ChinhSachAds
    schedule: LichAds
    nextRunAt: number | null
    lastRunAt: number | null
    lastResult: any
    updatedAt: number
}

function cauHinhMacDinh(): CauHinhAds {
    return { mode: 'preview', adAccountId: null, fbUserId: null, policy: chuanHoaChinhSachAds({}), schedule: { ...LICH_ADS_MAC_DINH }, nextRunAt: null, lastRunAt: null, lastResult: null, updatedAt: 0 }
}

// ─── Kho lưu (cấu hình, kế hoạch, nhật ký ghi, khoá tiền) ───────────────────────

export type LoaiKeHoachAds = 'boost' | 'pause' | 'resume' | 'budget'
export interface KeHoachAds {
    id: string
    kind: LoaiKeHoachAds | string
    status: string
    idempotencyKey: string | null
    data: any
    result: any
    createdBy: string | null
    createdAt: number
    updatedAt: number
}
export interface NhatKyAds { id: string; action: string; status: string; planId: string | null; payload: any; response: any; createdAt: number }

export interface KhoAds {
    docCauHinh(): Promise<CauHinhAds | null>
    luuCauHinh(c: CauHinhAds): Promise<void>
    gianhLich(cu: number, moi: number): Promise<boolean>
    ghiKetQuaLich(luc: number, ketQua: any): Promise<void>
    /** Khoá tiền: chỉ MỘT thao tác tăng chi chạy một lúc (giành trên CSDL — prod không có Redis). Tự hết sau `ms`. */
    giuKhoaTien(now: number, ms: number): Promise<boolean>
    traKhoaTien(): Promise<void>
    taoKeHoach(k: KeHoachAds): Promise<KeHoachAds>
    layKeHoach(id: string): Promise<KeHoachAds | null>
    /** Kế hoạch đã lập bằng khoá chống trùng này (bấm hai lần / mạng gửi lại) — null nếu chưa có. */
    layKeHoachTheoKhoa(khoa: string): Promise<KeHoachAds | null>
    /** draft → running, nguyên tử. false = bản khác đã giành / không còn là nháp. */
    gianhKeHoach(id: string): Promise<boolean>
    capNhatKeHoach(id: string, status: string, result: any): Promise<void>
    /** draft → cancelled. false = không còn là nháp. */
    huyKeHoach(id: string): Promise<boolean>
    dsKeHoach(lim: number): Promise<KeHoachAds[]>
    /** Kế hoạch các loại này tạo từ mốc `tuLuc`, mới trước. */
    dsKeHoachLoai(kinds: string[], tuLuc: number): Promise<KeHoachAds[]>
    /** 'running' không cập nhật từ trước `truoc` ⇒ 'uncertain' (tiến trình chết giữa chừng). Trả số kế hoạch đổi. */
    quetDangChay(truoc: number, message: string): Promise<number>
    ghiNhatKy(w: Omit<NhatKyAds, 'id' | 'createdAt'>): Promise<void>
    dsNhatKy(lim: number): Promise<NhatKyAds[]>
    demGhiTuLuc(ms: number): Promise<number>
}

/** Ba bảng của Ads Pilot — tạo lười lần đầu dùng (và trong /admin/migrate). Thời gian epoch ms (BIGINT) như Facebook Pilot. */
export const SQL_TAO_BANG_ADS_PILOT = [
    `CREATE TABLE IF NOT EXISTS "FacebookAdsPilotConfig" (
        "id" TEXT NOT NULL, "mode" TEXT NOT NULL DEFAULT 'preview', "adAccountId" TEXT, "fbUserId" TEXT,
        "policy" TEXT NOT NULL DEFAULT '{}', "schedule" TEXT NOT NULL DEFAULT '{}',
        "nextRunAt" BIGINT, "lastRunAt" BIGINT, "lastResult" TEXT, "lockUntil" BIGINT, "updatedAt" BIGINT NOT NULL DEFAULT 0,
        CONSTRAINT "FacebookAdsPilotConfig_pkey" PRIMARY KEY ("id"))`,
    `CREATE TABLE IF NOT EXISTS "FacebookAdsPilotPlan" (
        "id" TEXT NOT NULL, "kind" TEXT NOT NULL, "status" TEXT NOT NULL, "idempotencyKey" TEXT,
        "data" TEXT NOT NULL DEFAULT '{}', "result" TEXT, "createdBy" TEXT,
        "createdAt" BIGINT NOT NULL, "updatedAt" BIGINT NOT NULL,
        CONSTRAINT "FacebookAdsPilotPlan_pkey" PRIMARY KEY ("id"))`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "FacebookAdsPilotPlan_idempotencyKey_key" ON "FacebookAdsPilotPlan"("idempotencyKey")`,
    `CREATE INDEX IF NOT EXISTS "FacebookAdsPilotPlan_createdAt_idx" ON "FacebookAdsPilotPlan"("createdAt")`,
    `CREATE TABLE IF NOT EXISTS "FacebookAdsPilotWrite" (
        "id" TEXT NOT NULL, "action" TEXT NOT NULL, "status" TEXT NOT NULL, "planId" TEXT,
        "payload" TEXT NOT NULL DEFAULT '{}', "response" TEXT, "createdAt" BIGINT NOT NULL,
        CONSTRAINT "FacebookAdsPilotWrite_pkey" PRIMARY KEY ("id"))`,
    `CREATE INDEX IF NOT EXISTS "FacebookAdsPilotWrite_createdAt_idx" ON "FacebookAdsPilotWrite"("createdAt")`,
]

const daTaoBang = new WeakSet<object>()
const COT_KH = `id, kind, status, "idempotencyKey", data, result, "createdBy", "createdAt"::float8 AS "createdAt", "updatedAt"::float8 AS "updatedAt"`
function hangKeHoach(r: any): KeHoachAds {
    return {
        id: r.id, kind: r.kind, status: r.status, idempotencyKey: r.idempotencyKey ?? null,
        data: docJson(r.data, {}), result: docJson(r.result, null), createdBy: r.createdBy ?? null,
        createdAt: Number(r.createdAt), updatedAt: Number(r.updatedAt),
    }
}

/** Kho lưu trên schema của cửa hàng (raw SQL — không phụ thuộc client Prisma sinh lại). */
export function khoSqlAds(prisma: any): KhoAds {
    const chacBang = async () => {
        if (daTaoBang.has(prisma)) return
        for (const sql of SQL_TAO_BANG_ADS_PILOT) await prisma.$executeRawUnsafe(sql)
        daTaoBang.add(prisma)
    }
    const q = async (sql: string, ...v: any[]) => { await chacBang(); return prisma.$queryRawUnsafe(sql, ...v) as Promise<any[]> }
    const x = async (sql: string, ...v: any[]) => { await chacBang(); return prisma.$executeRawUnsafe(sql, ...v) as Promise<number> }
    return {
        async docCauHinh() {
            const [r] = await q(`SELECT mode, "adAccountId", "fbUserId", policy, schedule, "updatedAt"::float8 AS "updatedAt",
                                        "nextRunAt"::float8 AS "nextRunAt", "lastRunAt"::float8 AS "lastRunAt", "lastResult"
                                   FROM "FacebookAdsPilotConfig" WHERE id = 'default'`)
            if (!r) return null
            return {
                mode: CHE_DO.includes(r.mode) ? r.mode : 'preview', adAccountId: r.adAccountId ?? null, fbUserId: r.fbUserId ?? null,
                policy: chuanHoaChinhSachAds(docJson(r.policy, {})), schedule: chuanHoaLichAds(docJson(r.schedule, {})),
                nextRunAt: r.nextRunAt == null ? null : Number(r.nextRunAt), lastRunAt: r.lastRunAt == null ? null : Number(r.lastRunAt),
                lastResult: docJson(r.lastResult, null), updatedAt: Number(r.updatedAt) || 0,
            }
        },
        async luuCauHinh(c) {
            // KHÔNG ghi lastRunAt / lastResult / lockUntil ở đây — việc của lượt chạy theo lịch và khoá tiền
            await x(`INSERT INTO "FacebookAdsPilotConfig" (id, mode, "adAccountId", "fbUserId", policy, schedule, "nextRunAt", "updatedAt")
                     VALUES ('default', $1, $2, $3, $4, $5, $6, $7)
                     ON CONFLICT (id) DO UPDATE SET mode = EXCLUDED.mode, "adAccountId" = EXCLUDED."adAccountId", "fbUserId" = EXCLUDED."fbUserId",
                     policy = EXCLUDED.policy, schedule = EXCLUDED.schedule, "nextRunAt" = EXCLUDED."nextRunAt", "updatedAt" = EXCLUDED."updatedAt"`,
                c.mode, c.adAccountId, c.fbUserId ?? null, JSON.stringify(c.policy), JSON.stringify(c.schedule || LICH_ADS_MAC_DINH), c.nextRunAt, Date.now())
        },
        async gianhLich(cu, moi) {
            return (await x(`UPDATE "FacebookAdsPilotConfig" SET "nextRunAt" = $2 WHERE id = 'default' AND "nextRunAt" = $1`, cu, moi)) === 1
        },
        async ghiKetQuaLich(luc, ketQua) {
            await x(`UPDATE "FacebookAdsPilotConfig" SET "lastRunAt" = $1, "lastResult" = $2 WHERE id = 'default'`, luc, JSON.stringify(ketQua).slice(0, 20000))
        },
        async giuKhoaTien(now, ms) {
            return (await x(`UPDATE "FacebookAdsPilotConfig" SET "lockUntil" = $2 WHERE id = 'default' AND ("lockUntil" IS NULL OR "lockUntil" < $1)`, now, now + ms)) === 1
        },
        async traKhoaTien() {
            await x(`UPDATE "FacebookAdsPilotConfig" SET "lockUntil" = NULL WHERE id = 'default'`)
        },
        async taoKeHoach(k) {
            const rs = await q(`INSERT INTO "FacebookAdsPilotPlan" (id, kind, status, "idempotencyKey", data, result, "createdBy", "createdAt", "updatedAt")
                                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT ("idempotencyKey") DO NOTHING RETURNING ${COT_KH}`,
                k.id, k.kind, k.status, k.idempotencyKey, JSON.stringify(k.data), k.result == null ? null : JSON.stringify(k.result), k.createdBy, k.createdAt, k.updatedAt)
            if (rs[0]) return hangKeHoach(rs[0])
            const [cu] = k.idempotencyKey ? await q(`SELECT ${COT_KH} FROM "FacebookAdsPilotPlan" WHERE "idempotencyKey" = $1`, k.idempotencyKey) : []
            if (!cu) throw new Error('Không lưu được kế hoạch quảng cáo')
            return hangKeHoach(cu)
        },
        async layKeHoach(id) {
            const [r] = await q(`SELECT ${COT_KH} FROM "FacebookAdsPilotPlan" WHERE id = $1`, id)
            return r ? hangKeHoach(r) : null
        },
        async layKeHoachTheoKhoa(khoa) {
            const [r] = await q(`SELECT ${COT_KH} FROM "FacebookAdsPilotPlan" WHERE "idempotencyKey" = $1`, khoa)
            return r ? hangKeHoach(r) : null
        },
        async gianhKeHoach(id) {
            return (await x(`UPDATE "FacebookAdsPilotPlan" SET status = 'running', "updatedAt" = $2 WHERE id = $1 AND status = 'draft'`, id, Date.now())) === 1
        },
        async capNhatKeHoach(id, status, result) {
            await x(`UPDATE "FacebookAdsPilotPlan" SET status = $2, result = $3, "updatedAt" = $4 WHERE id = $1`, id, status, result == null ? null : JSON.stringify(result), Date.now())
        },
        async huyKeHoach(id) {
            return (await x(`UPDATE "FacebookAdsPilotPlan" SET status = 'cancelled', "updatedAt" = $2 WHERE id = $1 AND status = 'draft'`, id, Date.now())) === 1
        },
        async dsKeHoach(lim) {
            return (await q(`SELECT ${COT_KH} FROM "FacebookAdsPilotPlan" ORDER BY "createdAt" DESC LIMIT $1`, lim)).map(hangKeHoach)
        },
        async dsKeHoachLoai(kinds, tuLuc) {
            return (await q(`SELECT ${COT_KH} FROM "FacebookAdsPilotPlan" WHERE kind = ANY($1::text[]) AND "createdAt" >= $2
                               ORDER BY "createdAt" DESC LIMIT 2000`, kinds, tuLuc)).map(hangKeHoach)
        },
        async quetDangChay(truoc, message) {
            return x(`UPDATE "FacebookAdsPilotPlan" SET status = 'uncertain', result = $2, "updatedAt" = $3 WHERE status = 'running' AND "updatedAt" < $1`,
                truoc, JSON.stringify({ message }), Date.now())
        },
        async ghiNhatKy(w) {
            await x(`INSERT INTO "FacebookAdsPilotWrite" (id, action, status, "planId", payload, response, "createdAt") VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                crypto.randomUUID(), w.action, w.status, w.planId, JSON.stringify(w.payload ?? {}), w.response == null ? null : JSON.stringify(w.response).slice(0, 20000), Date.now())
        },
        async dsNhatKy(lim) {
            const rs = await q(`SELECT id, action, status, "planId", payload, response, "createdAt"::float8 AS "createdAt" FROM "FacebookAdsPilotWrite" ORDER BY "createdAt" DESC LIMIT $1`, lim)
            return rs.map(r => ({ id: r.id, action: r.action, status: r.status, planId: r.planId ?? null, payload: docJson(r.payload, {}), response: docJson(r.response, null), createdAt: Number(r.createdAt) }))
        },
        async demGhiTuLuc(ms) {
            // dòng 'config' (ai đổi cấu hình, X-14) không phải lệnh ghi quảng cáo — không tính trần thao tác / ngày
            const [r] = await q(`SELECT COUNT(*)::int AS n FROM "FacebookAdsPilotWrite" WHERE "createdAt" >= $1 AND action <> 'config'`, ms)
            return Number(r?.n) || 0
        },
    }
}

/** Kho trong bộ nhớ — cho bộ kiểm (cùng hợp đồng với khoSqlAds). */
export function khoBoNhoAds(): KhoAds & { _keHoach: KeHoachAds[]; _nhatKy: NhatKyAds[]; _khoa: { until: number | null } } {
    let cfg: CauHinhAds | null = null
    const keHoach: KeHoachAds[] = []
    const nhatKy: NhatKyAds[] = []
    const khoa = { until: null as number | null }
    const sao = <T>(v: T): T => JSON.parse(JSON.stringify(v))
    return {
        _keHoach: keHoach, _nhatKy: nhatKy, _khoa: khoa,
        async docCauHinh() { return cfg ? sao(cfg) : null },
        async luuCauHinh(c) { cfg = sao({ ...c, lastRunAt: cfg?.lastRunAt ?? null, lastResult: cfg?.lastResult ?? null, updatedAt: Date.now() }) },
        async gianhLich(cu, moi) { if (!cfg || cfg.nextRunAt !== cu) return false; cfg.nextRunAt = moi; return true },
        async ghiKetQuaLich(luc, ketQua) { if (cfg) { cfg.lastRunAt = luc; cfg.lastResult = sao(ketQua) } },
        async giuKhoaTien(now, ms) { if (!cfg) return false; if (khoa.until !== null && khoa.until >= now) return false; khoa.until = now + ms; return true },
        async traKhoaTien() { khoa.until = null },
        async taoKeHoach(k) {
            const cu = k.idempotencyKey ? keHoach.find(x => x.idempotencyKey === k.idempotencyKey) : null
            if (cu) return sao(cu)
            keHoach.push(sao(k)); return sao(k)
        },
        async layKeHoach(id) { const k = keHoach.find(x => x.id === id); return k ? sao(k) : null },
        async layKeHoachTheoKhoa(khoa) { const k = keHoach.find(x => x.idempotencyKey === khoa); return k ? sao(k) : null },
        async gianhKeHoach(id) { const k = keHoach.find(x => x.id === id); if (!k || k.status !== 'draft') return false; k.status = 'running'; k.updatedAt = Date.now(); return true },
        async capNhatKeHoach(id, status, result) { const k = keHoach.find(x => x.id === id); if (k) { k.status = status; k.result = sao(result); k.updatedAt = Date.now() } },
        async huyKeHoach(id) { const k = keHoach.find(x => x.id === id); if (!k || k.status !== 'draft') return false; k.status = 'cancelled'; return true },
        async dsKeHoach(lim) { return sao([...keHoach].sort((a, b) => b.createdAt - a.createdAt).slice(0, lim)) },
        async dsKeHoachLoai(kinds, tuLuc) { return sao(keHoach.filter(k => kinds.includes(String(k.kind)) && k.createdAt >= tuLuc).sort((a, b) => b.createdAt - a.createdAt)) },
        async quetDangChay(truoc, message) {
            let n = 0
            for (const k of keHoach) if (k.status === 'running' && k.updatedAt < truoc) { k.status = 'uncertain'; k.result = { message }; n++ }
            return n
        },
        async ghiNhatKy(w) { nhatKy.push({ ...sao(w), id: crypto.randomUUID(), createdAt: Date.now() }) },
        async dsNhatKy(lim) { return sao([...nhatKy].sort((a, b) => b.createdAt - a.createdAt).slice(0, lim)) },
        async demGhiTuLuc(ms) { return nhatKy.filter(w => w.createdAt >= ms && w.action !== 'config').length },
    }
}

// ─── Ngữ cảnh ───────────────────────────────────────────────────────────────────

/** Phần Graph / Marketing API Ads Pilot dùng — bộ kiểm thay bằng Facebook giả ghi lại mọi lời gọi. */
export interface DichVuAds {
    get(path: string, params?: Record<string, any>): Promise<any>
    post(path: string, params?: Record<string, any>): Promise<any>
}

export interface NgCanhAds {
    prisma: any
    kho: KhoAds
    /** kho Facebook Pilot (bài Pilot đã đăng + fanpage đang chọn); bỏ trống ⇒ bảng thật của cửa hàng */
    khoFb?: KhoFbPilot
    nguoi?: string | null
    /** Facebook giả cho bộ kiểm; bỏ trống ⇒ FacebookService thật trên bản Marketing API riêng (GRAPH_ADS) */
    taoFb?: (token: string) => DichVuAds
    /** đồng hồ giả cho bộ kiểm */
    bayGio?: () => number
    /** push giả cho bộ kiểm (thông báo chủ shop); bỏ trống ⇒ routes/notifications.sendPushToStore */
    guiDay?: GuiDayPilot
}

export const luc = (ctx: NgCanhAds) => (ctx.bayGio ? ctx.bayGio() : Date.now())
export function dichVuAds(ctx: NgCanhAds, token: string): DichVuAds {
    if (ctx.taoFb) return ctx.taoFb(token)
    const s = new FacebookService(token)
    return { get: (p, q) => s.get(p, q || {}, GRAPH_ADS), post: (p, q) => s.post(p, q || {}, GRAPH_ADS) }
}
const ngCanhFb = (ctx: NgCanhAds) => ({ prisma: ctx.prisma, kho: ctx.khoFb || khoSqlFb(ctx.prisma), bayGio: ctx.bayGio })

export async function docCauHinhAds(ctx: NgCanhAds): Promise<CauHinhAds> {
    return (await ctx.kho.docCauHinh()) || cauHinhMacDinh()
}

/** Fanpage của Facebook Pilot — quảng cáo chỉ đẩy bài của đúng page này. `canToken` ⇒ page token phải còn dùng được. */
async function canPageAds(ctx: NgCanhAds, o: { canToken?: boolean } = {}): Promise<any> {
    const r = await docCauHinhFb(ngCanhFb(ctx))
    if (!r.page) {
        throw new ToolError(r.pages.length
            ? `Cửa hàng nối ${r.pages.length} fanpage — chọn fanpage ở Facebook Pilot → Tự động hóa → Sửa chính sách trước.`
            : 'Cửa hàng chưa nối fanpage nào — dán page token ở Facebook Pilot → Kết nối trước.')
    }
    if (o.canToken) {
        if (r.page.status === 'token_expired') throw new ToolError(`Page token của fanpage "${r.page.name}" đã hết hạn hoặc bị thu hồi — dán page token mới ở tab Kết nối.`)
        if (!r.page.accessToken) throw new ToolError(`Fanpage "${r.page.name}" chưa có page token — dán ở tab Kết nối.`)
    }
    return r.page
}

// ─── Token quảng cáo ────────────────────────────────────────────────────────────

export interface TokenAds { fbUserId: string; name: string | null; accessToken: string; scopes: string[]; expiresAt: number | null }

export function docScopes(raw: any): string[] {
    const v = Array.isArray(raw) ? raw : docJson(raw, [])
    return Array.isArray(v) ? v.map(String).filter(s => s && s !== '?') : []
}

/**
 * Token này "chữa" được page token không? (fanpageCron.healPageTokens lấy /me/accounts của user token mới nhất rồi GHI ĐÈ
 * page token.) Token OAuth cũ không ghi quyền ('[]') ⇒ giữ như trước (OAuth xin đủ quyền trang). Token dán cho quảng cáo
 * ghi quyền thật — hoặc '["?"]' khi không đọc được — ⇒ chỉ chữa khi có ĐỦ pages_show_list + pages_manage_posts, kẻo page
 * token đang đăng bài được bị thay bằng page token sinh từ token chỉ có quyền quảng cáo.
 */
export function tokenChuaDuocPage(rawScopes: any): boolean {
    const v = Array.isArray(rawScopes) ? rawScopes : docJson(rawScopes, [])
    if (!Array.isArray(v) || v.length === 0) return true
    const s = v.map(String)
    return s.includes('pages_show_list') && s.includes('pages_manage_posts')
}

/** Quyền rỗng = token OAuth cũ (đã xin ads_management) hoặc không đọc được quyền ⇒ để Facebook tự từ chối nếu thiếu. */
const coQuyenGhi = (scopes: string[]) => scopes.length === 0 || scopes.includes('ads_management')

/** Token của Ads Pilot: đúng người đã dán ở tab Quảng cáo (cfg.fbUserId); chưa dán bao giờ ⇒ token user mới nhất.
 *  Đã dán mà dòng token mất (gỡ ở Fanpage Manager) ⇒ null — KHÔNG lặng lẽ lấy token của người khác. */
async function docTokenAds(prisma: any, fbUserId: string | null): Promise<TokenAds | null> {
    const select = { fbUserId: true, name: true, accessToken: true, scopes: true, tokenExpiresAt: true }
    const t = await (fbUserId
        ? prisma.fbUserToken.findUnique({ where: { fbUserId }, select })
        : prisma.fbUserToken.findFirst({ orderBy: { updatedAt: 'desc' }, select })
    ).catch((e: any) => {
        // bảng chưa có (cửa hàng chưa migrate) ⇒ coi như chưa nối; lỗi khác thì nói ra
        if (!/does not exist|FbUserToken/i.test(String(e?.message || ''))) console.error('[AdsPilot] đọc token lỗi:', e?.message || e)
        return null
    })
    if (!t?.accessToken) return null
    return {
        fbUserId: String(t.fbUserId), name: t.name ?? null, accessToken: String(t.accessToken), scopes: docScopes(t.scopes),
        expiresAt: t.tokenExpiresAt ? new Date(t.tokenExpiresAt).getTime() : null,
    }
}

/** Trường token được ra giao diện — KHÔNG BAO GIỜ trả accessToken. */
function tokenAnToan(t: TokenAds | null, now: number) {
    if (!t) return null
    return {
        fbUserId: t.fbUserId, name: t.name, scopes: t.scopes, canWrite: coQuyenGhi(t.scopes), expiresAt: t.expiresAt,
        expiresInDays: t.expiresAt ? Math.max(0, Math.floor((t.expiresAt - now) / NGAY)) : null,
    }
}

const CHUA_NOI_TOKEN = 'Chưa nối token quảng cáo — dán USER token có quyền ads_management ở Facebook Pilot → Quảng cáo → Kết nối quảng cáo.'
export async function canTokenAds(ctx: NgCanhAds, cfg: CauHinhAds): Promise<TokenAds> {
    const t = await docTokenAds(ctx.prisma, cfg.fbUserId)
    if (!t) throw new ToolError(CHUA_NOI_TOKEN)
    return t
}

/* Graph gắn type 'OAuthException' cả cho lỗi tham số (#100) ⇒ Ads Pilot phân loại theo MÃ lỗi. 09/11/2026: luật này nay là
 * luật chung ở services/platforms/facebook (laLoiTokenFb / laLoiQuyenFb — Fanpage Manager, Facebook Pilot, cron đối soát cùng
 * dùng); giữ tên cũ cho Ads drill + bộ kiểm. */
export const laLoiToken = (e: any) => laLoiTokenFb(e)
export const laLoiQuyen = (e: any) => laLoiQuyenFb(e)
/** #100 subcode 33: đối tượng không tồn tại (chiến dịch đã bị xoá hẳn). */
export const laKhongTonTai = (e: any) => Number(e?.code) === 100 && Number(e?.subcode) === 33

/** Lỗi Facebook → câu cho người vận hành (token hỏng / thiếu quyền nói rõ phải làm gì). */
export function moTaLoi(e: any): string {
    const m = String(e?.message || e).slice(0, 300)
    if (laLoiToken(e)) return `Facebook từ chối token (hết hạn / bị thu hồi / đổi mật khẩu) — dán token mới. (${m})`
    if (laLoiQuyen(e)) {
        const q = quyenThieuFb(e)
        return `Token thiếu quyền${q ? ` ${q}` : ''} cho thao tác này — cần ads_management và quyền quản trị tài khoản quảng cáo / fanpage. (${m})`
    }
    return m
}

/** Lời gọi GHI lên Facebook: lỗi mang dấu daGhi ⇒ mất mạng ở đây mới là 'uncertain' (không biết Facebook đã nhận chưa).
 *  Mất mạng lúc còn ĐỌC (trước mọi lệnh ghi) là 'failed' bình thường — chưa có gì trên Facebook. */
async function ghiFb<T>(f: () => Promise<T>): Promise<T> {
    try { return await f() } catch (e: any) { throw Object.assign(e instanceof Error ? e : new Error(String(e)), { daGhi: true }) }
}

// ─── Tài khoản quảng cáo ────────────────────────────────────────────────────────

export const TRANG_THAI_TK: Record<number, string> = {
    1: 'đang hoạt động', 2: 'bị vô hiệu hoá', 3: 'chưa thanh toán', 7: 'đang xét duyệt rủi ro', 8: 'chờ thanh toán',
    9: 'trong thời gian ân hạn', 100: 'chờ đóng', 101: 'đã đóng', 201: 'đang hoạt động', 202: 'đã đóng',
}

export interface TaiKhoanAds {
    id: string; name: string; status: number; statusText: string; currency: string
    /** tiền theo đơn vị nhỏ nhất của tiền tệ tài khoản (VND = đồng); null = Facebook không trả */
    amountSpent: number | null; spendCap: number | null; balance: number | null
}

function chuanTaiKhoan(a: any): TaiKhoanAds {
    const st = Number(a?.account_status) || 0
    const tien = (v: any) => (v === undefined || v === null || v === '' ? null : Number(v))
    return {
        id: chuanAct(a?.id || a?.account_id) || String(a?.id || ''), name: tenGon(a?.name) || String(a?.id || ''),
        status: st, statusText: TRANG_THAI_TK[st] || `mã trạng thái ${st}`, currency: String(a?.currency || '').toUpperCase(),
        amountSpent: tien(a?.amount_spent), spendCap: tien(a?.spend_cap) || null, balance: tien(a?.balance),
    }
}

const COT_TK = 'id,account_id,name,account_status,currency,amount_spent,spend_cap,balance'
async function dsTaiKhoan(svc: DichVuAds): Promise<TaiKhoanAds[]> {
    const r = await svc.get('me/adaccounts', { fields: COT_TK, limit: 100 })
    return (r?.data || []).map(chuanTaiKhoan)
}
async function docTaiKhoan(svc: DichVuAds, act: string): Promise<TaiKhoanAds> {
    return chuanTaiKhoan(await svc.get(act, { fields: COT_TK }))
}

/** Việc TĂNG chi chỉ chạy trên tài khoản đang hoạt động, tính tiền bằng VND (ngân sách Pilot tính bằng đồng). */
function lyDoTaiKhoanKhongTangChi(tk: TaiKhoanAds): string | null {
    if (tk.status !== 1 && tk.status !== 201) return `Tài khoản quảng cáo "${tk.name}" đang ${tk.statusText} — không bật quảng cáo được (vẫn tạm dừng được).`
    if (tk.currency !== 'VND') return `Tài khoản quảng cáo "${tk.name}" tính tiền bằng ${tk.currency || 'tiền tệ lạ'} — Ads Pilot chỉ đặt ngân sách bằng VND.`
    return null
}

// ─── Số liệu (Insights) ─────────────────────────────────────────────────────────

export interface SoLieuAds { spend: number; impressions: number; reach: number; clicks: number; comments: number; messages: number; engagement: number; results: number }
const soLieuRong = (): SoLieuAds => ({ spend: 0, impressions: 0, reach: 0, clicks: 0, comments: 0, messages: 0, engagement: 0, results: 0 })

/** Một dòng Insights → số. Kết quả = bình luận + cuộc trò chuyện Messenger mới (dấu hiệu khách hỏi mua). */
export function docSoLieu(r: any): SoLieuAds {
    if (!r) return soLieuRong()
    const hanhDong = (t: string) => {
        const a = (Array.isArray(r.actions) ? r.actions : []).find((x: any) => x?.action_type === t)
        return a ? Number(a.value) || 0 : 0
    }
    const comments = hanhDong('comment')
    const messages = hanhDong('onsite_conversion.messaging_conversation_started_7d')
    return {
        spend: Number(r.spend) || 0, impressions: Number(r.impressions) || 0, reach: Number(r.reach) || 0, clicks: Number(r.clicks) || 0,
        comments, messages, engagement: hanhDong('post_engagement'), results: comments + messages,
    }
}

// ─── Quảng cáo do Pilot tạo (đọc sống) ──────────────────────────────────────────

export interface QuangCaoPilot {
    planId: string
    planStatus: string
    /** tài khoản quảng cáo chứa chiến dịch (có thể khác tài khoản đang chọn — đổi tài khoản không bỏ rơi quảng cáo cũ) */
    adAccountId: string
    campaignId: string
    adsetId: string | null
    /** trạng thái RIÊNG của nhóm quảng cáo (người tắt nhóm trong Trình quản lý ⇒ bật chiến dịch cũng không chạy) */
    adsetStatus: string | null
    adId: string | null
    postId: string
    postTitle: string
    image: string | null
    productId: string | null
    sku: string | null
    name: string
    /** giá GHI TRONG BÀI lúc đẩy (null = bài không ghi giá ⇒ đổi giá không làm bài sai) */
    priceAtBoost: number | null
    dailyBudget: number
    startAt: number
    endAt: number
    /** trạng thái chiến dịch trên Facebook; null = chưa đọc được */
    status: string | null
    /** vì sao không đọc được chiến dịch này (status null) — null = đọc được (09/11/2026) */
    readError: string | null
    effectiveStatus: string | null
    /** chiến dịch đang được phép tiêu tiền: ACTIVE, nhóm QC không tắt, chưa tới giờ kết thúc */
    running: boolean
    ended: boolean
    life: SoLieuAds
    today: SoLieuAds
    /** số liệu GẦN ĐÂY = 7 ngày trước hôm nay + hôm nay (AD-09, 10/11/2026: luật dừng / tăng ngân sách không chỉ nhìn số trọn đời) */
    recent: SoLieuAds
    costPerResult: number | null
    /** trạng thái RIÊNG của quảng cáo (ad) trong chiến dịch: DISAPPROVED, WITH_ISSUES, PENDING_REVIEW… — null = không đọc được (AD-11) */
    adEffectiveStatus: string | null
    /** quảng cáo không phân phối vì Facebook từ chối / có vấn đề / chờ thanh toán — vẫn GIỮ CHỖ trong trần (AD-11); null = không thấy */
    deliveryIssue: string | null
    product: { stock: number; price: number; costPrice: number; merged: boolean } | null
    /** bán ra (mọi kênh) trong lúc chạy so với cùng số ngày ngay trước — KHÔNG chắc do quảng cáo */
    sold: { during: number; before: number; days: number } | null
    /** thao tác tạm dừng / chạy lại / ngân sách gần nhất đã thực thi — 'pilot' = chu kỳ máy lập */
    lastAction: { kind: string; reason: string | null; by: 'pilot' | 'nguoi'; at: number } | null
    /** lý do máy đã tạm dừng mà sau đó NGƯỜI bật lại (máy không tự tắt lại vì các lý do này) */
    humanOverride: string[]
    warnings: string[]
}

const laMay = (k: KeHoachAds) => String(k.idempotencyKey || '').startsWith('cycle:')

/**
 * Lý do máy đã tạm dừng THÀNH CÔNG mà sau đó máy KHÔNG tự chạy lại — chiến dịch nay ACTIVE thì chỉ có thể là người bật lại
 * (trên Pilot hoặc thẳng trong Trình quản lý quảng cáo). `ds` = kế hoạch pause/resume/budget của MỘT chiến dịch, mới trước.
 */
export function lyDoNguoiDaBo(ds: KeHoachAds[]): string[] {
    const ra: string[] = []
    for (const k of ds) {
        if (k.kind !== 'pause' || k.status !== 'succeeded' || !laMay(k)) continue
        const r = String(k.data?.reason || '')
        if (!r || ra.includes(r)) continue
        // trùng mốc thời gian (chỉ có trong bộ kiểm) ⇒ coi như máy đã chạy lại: nghiêng về phía máy được tắt lại — đỡ tốn tiền
        if (ds.some(v => v.kind === 'resume' && v.status === 'succeeded' && laMay(v) && v.createdAt >= k.createdAt)) continue
        ra.push(r)
    }
    return ra
}
/* ads{id,effective_status}: trạng thái RIÊNG của quảng cáo (AD-11) — chiến dịch ACTIVE mà quảng cáo bị từ chối thì không chạy. Chỉ xin
 * effective_status trong lời gọi chung: tên trường sai làm hỏng CẢ lời đọc chiến dịch; lý do từ chối đọc riêng (lyDoQuangCaoFb). */
const COT_CHIEN_DICH_GOC = 'id,name,status,effective_status,adsets{id,daily_budget,end_time,status,effective_status}'
const COT_CHIEN_DICH = `${COT_CHIEN_DICH_GOC},ads{id,effective_status}`
/** Facebook từ chối TRƯỜNG xin đọc (#100, không phải #100/33 "không tồn tại") — vd "Tried accessing nonexisting field (ads)". */
const laTruongBiTuChoi = (e: any) => Number(e?.code) === 100 && !laKhongTonTai(e)
/** Trạng thái quảng cáo = không phân phối, cần người (Facebook từ chối / có vấn đề / tài khoản chờ thanh toán). */
const QC_CO_VAN_DE: Record<string, string> = {
    DISAPPROVED: 'Facebook TỪ CHỐI quảng cáo này',
    WITH_ISSUES: 'Quảng cáo đang có vấn đề với Facebook',
    PENDING_BILLING_INFO: 'Tài khoản quảng cáo chờ thông tin thanh toán — quảng cáo chưa chạy',
}

/** Lý do Facebook ghi cho quảng cáo có vấn đề — đọc riêng, hỏng thì thôi (chỉ để người đọc hiểu). */
async function lyDoQuangCaoFb(svc: DichVuAds, adId: string): Promise<string | null> {
    try {
        const r = await svc.get(adId, { fields: 'issues_info,ad_review_feedback' })
        const ds: string[] = []
        for (const v of Object.values(r?.ad_review_feedback?.global || {})) if (v) ds.push(String(v))
        for (const i of Array.isArray(r?.issues_info) ? r.issues_info : []) {
            const t = String(i?.error_summary || i?.error_message || '').trim()
            if (t) ds.push(t)
        }
        return ds.length ? [...new Set(ds)].join('; ').replace(/\s+/g, ' ').slice(0, 300) : null
    } catch {
        return null
    }
}

/** Cộng hai khoảng KHÔNG chồng nhau (7 ngày trước hôm nay + hôm nay). reach không cộng được (người trùng) ⇒ lấy lớn hơn, chỉ để xem. */
const congSoLieu = (a: SoLieuAds, b: SoLieuAds): SoLieuAds => ({
    spend: a.spend + b.spend, impressions: a.impressions + b.impressions, reach: Math.max(a.reach, b.reach), clicks: a.clicks + b.clicks,
    comments: a.comments + b.comments, messages: a.messages + b.messages, engagement: a.engagement + b.engagement, results: a.results + b.results,
})
const GAN_DAY = '8 ngày gần đây'
/** Số bài tối đa đọc tương tác tự nhiên mỗi lần tìm bài để đẩy (timBaiDeDay) — mỗi bài một lời gọi Graph. */
export const TUONG_TAC_TOI_DA = 20

/**
 * Trạng thái sống của các chiến dịch theo mã — đọc TỪNG cái, một mã lạ không làm mù cả bảng. 09/11/2026: bỏ lời gọi gộp gốc
 * `GET /?ids=` — Facebook trả lỗi cho mọi lời gọi gốc kiểu đó ở MỌI phiên bản từ 27/10/2026 (changelog Graph v26.0, "Legacy Graph
 * API protocol features deprecated"; trước bản này lượt nào cũng tốn một lời gọi hỏng rồi mới đọc lẻ). Chỉ token hỏng (#190 / #102)
 * mới thôi đọc: lời gọi nào cũng sẽ hỏng y vậy. Lỗi QUYỀN của một chiến dịch không chặn đọc các cái khác.
 * `loiTheoMa` = chiến dịch KHÔNG đọc được ⇒ trạng thái null: vẫn tính vào trần, chặn mọi việc tăng chi, vào việc cần người.
 */
async function docChienDich(svc: DichVuAds, ids: string[], actCua: (id: string) => string | null = () => null): Promise<{ theoMa: Map<string, any>; loiTheoMa: Map<string, string> }> {
    const theoMa = new Map<string, any>()
    const loiTheoMa = new Map<string, string>()
    /** tài khoản quảng cáo còn đọc được không — nhớ trong lượt (mỗi tài khoản một lời gọi) */
    const tkDoc = new Map<string, boolean>()
    const docDuocTk = async (act: string | null): Promise<boolean> => {
        if (!act) return false
        if (!tkDoc.has(act)) tkDoc.set(act, await svc.get(act, { fields: 'id' }).then(() => true, () => false))
        return tkDoc.get(act)!
    }
    /* trường ads{…} (AD-11) bị Facebook từ chối ⇒ đọc lại bằng bộ trường cũ, cả lượt dùng bộ cũ: mất trạng thái quảng cáo, KHÔNG được
     * mất chiến dịch — chiến dịch không đọc được thì máy không tạm dừng được quảng cáo hết hàng nữa. */
    let cot = COT_CHIEN_DICH
    const docMot = async (id: string) => {
        try { return await svc.get(id, { fields: cot }) } catch (e: any) {
            if (cot === COT_CHIEN_DICH_GOC || !laTruongBiTuChoi(e)) throw e
            const r = await svc.get(id, { fields: COT_CHIEN_DICH_GOC })
            cot = COT_CHIEN_DICH_GOC
            return r
        }
    }
    for (const id of ids) {
        if (theoMa.has(id) || loiTheoMa.has(id)) continue
        try { theoMa.set(id, await docMot(id)) } catch (e2: any) {
            /* AD-08 (10/11/2026): #100/33 nghĩa là "không tồn tại, HOẶC không có quyền đọc". Trước đây coi luôn là đã xoá ⇒ chiến dịch rời
             * trần trong khi có thể VẪN đang tiêu tiền (token mất quyền trên tài khoản quảng cáo). Giờ chỉ là "đã xoá" khi CHÍNH tài
             * khoản chứa nó vẫn đọc được; không thì KHÔNG biết ⇒ vẫn chiếm trần, chặn tăng chi, báo người. */
            if (laKhongTonTai(e2)) {
                const act = actCua(id)
                if (await docDuocTk(act)) { theoMa.set(id, { id, status: 'DELETED', effective_status: 'DELETED', khongTonTai: true }); continue }
                loiTheoMa.set(id, `${moTaLoi(e2)} — đọc cả tài khoản quảng cáo ${act || '(không rõ)'} cũng không được: có thể token mất quyền, chiến dịch có thể VẪN đang chạy`)
                continue
            }
            loiTheoMa.set(id, moTaLoi(e2))
            if (laLoiToken(e2)) {
                for (const x of ids) if (!theoMa.has(x) && !loiTheoMa.has(x)) loiTheoMa.set(x, moTaLoi(e2))
                break
            }
        }
    }
    return { theoMa, loiTheoMa }
}

async function docInsightsChienDich(svc: DichVuAds, act: string, ids: string[], datePreset: string): Promise<Map<string, SoLieuAds>> {
    const ra = new Map<string, SoLieuAds>()
    if (!ids.length) return ra
    const r = await svc.get(`${act}/insights`, {
        level: 'campaign', date_preset: datePreset, fields: 'campaign_id,spend,impressions,reach,clicks,actions',
        filtering: [{ field: 'campaign.id', operator: 'IN', value: ids }], limit: 100,
    })
    for (const d of r?.data || []) if (d?.campaign_id) ra.set(String(d.campaign_id), docSoLieu(d))
    return ra
}

const KHUNG_BAN = (tu: number, den: number) => ({
    status: { in: [...TRANG_THAI_BAN] },
    // cắt kỳ theo NGÀY BÁN (transactionDate), phiếu thiếu ngày bán mới rơi về ngày tạo
    OR: [{ transactionDate: { gte: new Date(tu), lt: new Date(den) } }, { transactionDate: null, createdAt: { gte: new Date(tu), lt: new Date(den) } }],
})

async function soLuongBan(prisma: any, productId: string, tu: number, den: number): Promise<number> {
    if (!(den > tu)) return 0
    const r = await prisma.transactionItem.aggregate({ where: { productId, transaction: KHUNG_BAN(tu, den) }, _sum: { quantity: true } })
    return Number(r?._sum?.quantity) || 0
}

/**
 * Quảng cáo do Pilot tạo (MỌI tài khoản quảng cáo Pilot từng dùng — trần ngân sách tính chung) + trạng thái / ngân sách /
 * số liệu SỐNG từ Facebook. `liveError` = có chiến dịch không đọc được TRẠNG THÁI (rào trần phải chặn mọi việc TĂNG chi;
 * 09/11/2026: chiến dịch đọc được vẫn đủ dữ liệu để TẠM DỪNG — xem `readError` từng quảng cáo); `statsError` = chỉ hỏng số liệu.
 * `soLieu: false` ⇒ chỉ trạng thái + ngân sách (đủ cho soát trần, bớt các lời gọi Insights).
 */
export async function docQuangCaoPilot(ctx: NgCanhAds, svc: DichVuAds, now: number, o: { soLieu?: boolean; banHang?: boolean } = {}): Promise<{ ads: QuangCaoPilot[]; liveError: string | null; statsError: string | null; viec: Map<string, KeHoachAds[]> }> {
    // 'running' có mã chiến dịch = đang dựng / bật ở lượt khác (hoặc tiến trình chết giữa chừng) ⇒ VẪN tính vào trần
    const boost = (await ctx.kho.dsKeHoachLoai(['boost'], now - 120 * NGAY))
        .filter(k => k.result?.campaignId && !k.result?.campaignDeleted && ['succeeded', 'failed', 'uncertain', 'running'].includes(k.status) && chuanAct(k.data?.adAccountId))
        .slice(0, 50)
    const viec = new Map<string, KeHoachAds[]>()
    if (!boost.length) return { ads: [], liveError: null, statsError: null, viec }
    for (const v of await ctx.kho.dsKeHoachLoai(['pause', 'resume', 'budget'], now - 120 * NGAY)) {
        const cid = String(v.data?.campaignId || '')
        if (!viec.has(cid)) viec.set(cid, [])
        viec.get(cid)!.push(v)
    }
    const ids = boost.map(k => String(k.result.campaignId))

    // TUẦN TỰ có chủ ý: lời gọi Facebook tuần tự cho dễ đọc nhật ký; Prisma của cửa hàng chỉ 1 kết nối trên prod
    const actTheoMa = new Map(boost.map(k => [String(k.result.campaignId), chuanAct(k.data?.adAccountId)]))
    const { theoMa, loiTheoMa } = await docChienDich(svc, ids, id => actTheoMa.get(id) || null)
    const [dauLoi] = [...loiTheoMa]
    const liveError = dauLoi ? `${loiTheoMa.size}/${ids.length} chiến dịch không đọc được — ${dauLoi[0]}: ${dauLoi[1]}` : null
    let statsError: string | null = null
    const tron = new Map<string, SoLieuAds>(), homNay = new Map<string, SoLieuAds>(), bayNgay = new Map<string, SoLieuAds>()
    if (o.soLieu !== false) {
        const theoTk = new Map<string, string[]>()
        for (const k of boost) {
            const act = chuanAct(k.data?.adAccountId)!
            if (!theoTk.has(act)) theoTk.set(act, [])
            theoTk.get(act)!.push(String(k.result.campaignId))
        }
        for (const [act, maCd] of theoTk) {
            try {
                for (const [id, v] of await docInsightsChienDich(svc, act, maCd, 'maximum')) tron.set(id, v)
                for (const [id, v] of await docInsightsChienDich(svc, act, maCd, 'today')) homNay.set(id, v)
                // last_7d của Facebook = 7 ngày TRƯỚC hôm nay (không gồm hôm nay) ⇒ cộng 'today' thành 8 ngày gần đây (AD-09)
                for (const [id, v] of await docInsightsChienDich(svc, act, maCd, 'last_7d')) bayNgay.set(id, v)
            } catch (e: any) { statsError = statsError || `Số liệu quảng cáo (${act}): ${moTaLoi(e)}` }
        }
    }
    const maSp = [...new Set(boost.map(k => String(k.data?.productId || '')).filter(Boolean))]
    const spDs: any[] = maSp.length ? await ctx.prisma.product.findMany({
        where: { id: { in: maSp } }, select: { id: true, sellingPrice: true, stock: true, costPrice: true, mergedIntoId: true },
    }) : []
    const spTheoId = new Map(spDs.map(s => [String(s.id), s]))

    const ads: QuangCaoPilot[] = []
    for (const k of boost) {
        const d = k.data || {}, r = k.result || {}
        const cid = String(r.campaignId)
        const c = theoMa.get(cid)
        const nhom = (c?.adsets?.data || []).find((s: any) => String(s.id) === String(r.adsetId)) || c?.adsets?.data?.[0] || null
        const endAt = nhom?.end_time ? Date.parse(nhom.end_time) : Number(r.endAt) || 0
        const ended = endAt > 0 && endAt <= now
        const status = c ? String(c.status || '') : null
        const nhomTat = nhom ? ['PAUSED', 'DELETED', 'ARCHIVED'].includes(String(nhom.status || '')) : false
        const running = status === 'ACTIVE' && !ended && !nhomTat && !['DELETED', 'ARCHIVED'].includes(String(c?.effective_status || ''))
        const life = tron.get(cid) || soLieuRong()
        const today = homNay.get(cid) || soLieuRong()
        // quảng cáo của Pilot trong chiến dịch: theo mã đã lưu; không lưu mã mà chiến dịch chỉ có MỘT quảng cáo thì là nó — không đoán
        const dsQc: any[] = Array.isArray(c?.ads?.data) ? c.ads.data : []
        const qcFb = (r.adId ? dsQc.find(x => String(x?.id) === String(r.adId)) : null) || (!r.adId && dsQc.length === 1 ? dsQc[0] : null)
        const adEffectiveStatus = qcFb ? String(qcFb.effective_status || '') || null : null
        const sp = d.productId ? spTheoId.get(String(d.productId)) : null
        const cuaNo = viec.get(cid) || []
        const cuoi = cuaNo.find(v => v.status === 'succeeded') || null
        const humanOverride = status === 'ACTIVE' ? lyDoNguoiDaBo(cuaNo) : []
        const qc: QuangCaoPilot = {
            planId: k.id, planStatus: k.status, adAccountId: chuanAct(d.adAccountId)!, campaignId: cid,
            adsetId: r.adsetId ? String(r.adsetId) : (nhom?.id ? String(nhom.id) : null), adsetStatus: nhom ? String(nhom.status || '') : null,
            adId: r.adId ? String(r.adId) : null,
            postId: String(d.postId || ''), postTitle: String(d.postTitle || ''), image: d.image || null,
            productId: d.productId ? String(d.productId) : null, sku: d.sku || null, name: String(d.name || d.postTitle || ''),
            priceAtBoost: d.priceInPost == null ? null : Number(d.priceInPost),
            dailyBudget: nhom?.daily_budget != null ? Number(nhom.daily_budget) : Number(r.dailyBudget ?? d.dailyBudget) || 0,
            startAt: Number(r.startAt) || k.updatedAt, endAt,
            status, readError: c ? null : loiTheoMa.get(cid) || 'Facebook không trả chiến dịch này', effectiveStatus: c ? String(c.effective_status || '') : null, running, ended,
            life, today, recent: congSoLieu(bayNgay.get(cid) || soLieuRong(), today),
            costPerResult: life.results > 0 ? Math.round(life.spend / life.results) : null,
            adEffectiveStatus, deliveryIssue: adEffectiveStatus && QC_CO_VAN_DE[adEffectiveStatus] ? QC_CO_VAN_DE[adEffectiveStatus] : null,
            product: d.productId ? (sp ? { stock: Number(sp.stock) || 0, price: Number(sp.sellingPrice) || 0, costPrice: Number(sp.costPrice) || 0, merged: !!sp.mergedIntoId } : null) : null,
            sold: null,
            lastAction: cuoi ? { kind: String(cuoi.kind), reason: cuoi.data?.reason || null, by: laMay(cuoi) ? 'pilot' : 'nguoi', at: cuoi.updatedAt } : null,
            humanOverride,
            warnings: [],
        }
        if (k.status === 'running') qc.warnings.push('Đang dựng / bật quảng cáo này.')
        else if (k.status === 'uncertain') qc.warnings.push('Lần tạo / bật bị đứt giữa chừng — kiểm tra trong Trình quản lý quảng cáo.')
        else if (k.status === 'failed') qc.warnings.push(`Chưa bật được: ${String(r.message || 'lỗi không rõ').slice(0, 200)}`)
        if (c?.khongTonTai) qc.warnings.push('Chiến dịch không còn trên Facebook (đã bị xoá?).')
        else if (!c) qc.warnings.push(`Không đọc được trạng thái chiến dịch trên Facebook (${String(qc.readError).slice(0, 200)}) — Pilot không bật / tăng chi cho tới khi đọc lại được; muốn dừng ngay thì bấm Tạm dừng.`)
        if (humanOverride.length) qc.warnings.push(`Có người bật lại sau khi Pilot tạm dừng (${humanOverride.map(x => LY_DO_DUNG[x] || x).join(', ')}) — Pilot không tự tắt lại vì cùng lý do.`)
        ads.push(qc)
    }
    /* AD-11: chiến dịch ACTIVE mà quảng cáo bị từ chối / có vấn đề ⇒ không phân phối nhưng VẪN giữ chỗ trong trần (Facebook duyệt lại
     * là chạy ngay — không bỏ khỏi trần). Lý do Facebook ghi: đọc riêng, chỉ khi đọc đủ số liệu, tối đa 5 quảng cáo đang chạy mỗi lượt. */
    let docLyDo = 0
    for (const a of ads) {
        if (!a.deliveryIssue) continue
        if (o.soLieu !== false && a.running && a.adId && docLyDo < 5) {
            docLyDo++
            const ly = await lyDoQuangCaoFb(svc, a.adId)
            if (ly) a.deliveryIssue = `${a.deliveryIssue}: ${ly}`
        }
        a.warnings.push(a.running
            ? `${a.deliveryIssue} — quảng cáo không phân phối nhưng vẫn giữ chỗ trong trần ngân sách.`
            : `${a.deliveryIssue} — chạy lại cũng không phân phối cho tới khi sửa trong Trình quản lý quảng cáo; Pilot không tự chạy lại.`)
    }
    // bán ra trong lúc chạy — chỉ quảng cáo đang chạy / mới hết ≤ 14 ngày, tối đa 12 mã (mỗi mã 2 truy vấn, TUẦN TỰ)
    if (o.banHang) {
        let dem = 0
        for (const a of ads) {
            if (!a.productId || !a.startAt || dem >= 12) continue
            if (!a.running && !(a.ended && now - a.endAt < 14 * NGAY)) continue
            const den = Math.min(now, a.endAt || now)
            const dai = Math.max(den - a.startAt, NGAY)
            const during = await soLuongBan(ctx.prisma, a.productId, a.startAt, den)
            const before = await soLuongBan(ctx.prisma, a.productId, a.startAt - dai, a.startAt)
            a.sold = { during, before, days: Math.round(dai / NGAY * 10) / 10 }
            dem++
        }
    }
    ads.sort((a, b) => Number(b.running) - Number(a.running) || b.startAt - a.startAt)
    return { ads, liveError, statsError, viec }
}

/** Đang chiếm trần: mọi quảng cáo được phép tiêu tiền — CHƯA đọc được trạng thái cũng tính (không biết ⇒ coi như đang chi). */
export function dangChiemTran(ads: QuangCaoPilot[], boQuaCampaign?: string): { soChay: number; nganSach: number } {
    const chay = ads.filter(a => (a.running || a.status === null) && a.campaignId !== boQuaCampaign)
    return { soChay: chay.length, nganSach: chay.reduce((s, a) => s + (Number(a.dailyBudget) || 0), 0) }
}

const CHUA_DAT_TRAN = 'Chưa đặt trần ngân sách/ngày cho Ads Pilot — đặt ở Quảng cáo → Chính sách quảng cáo rồi mới bật quảng cáo.'

/** Rào trần TRƯỚC khi tăng chi: đọc sống; đọc không được ⇒ chặn. */
async function soatTrongTran(ctx: NgCanhAds, svc: DichVuAds, cfg: CauHinhAds, o: { them: number; moi: boolean; boQua?: string }): Promise<QuangCaoPilot[]> {
    const pol = cfg.policy
    if (!(pol.dailyBudgetCap > 0)) throw new ToolError(CHUA_DAT_TRAN)
    const { ads, liveError } = await docQuangCaoPilot(ctx, svc, luc(ctx), { soLieu: false })
    if (liveError) throw new ToolError(`Không đọc được ngân sách các quảng cáo Pilot đang chạy trên Facebook — không bật thêm cho an toàn. (${liveError})`)
    const { soChay, nganSach } = dangChiemTran(ads, o.boQua)
    if (o.moi && soChay >= pol.maxActiveAds) throw new ToolError(`Đang có ${soChay} quảng cáo Pilot chạy — chính sách cho tối đa ${pol.maxActiveAds} cùng lúc.`)
    if (nganSach + o.them > pol.dailyBudgetCap) {
        throw new ToolError(`Vượt trần ngân sách: quảng cáo Pilot đang chạy ${vnd(nganSach)}/ngày + ${vnd(o.them)}/ngày > trần ${vnd(pol.dailyBudgetCap)}/ngày.`)
    }
    return ads
}

// ─── Bài nên đẩy ────────────────────────────────────────────────────────────────

export interface BaiDeDay {
    postId: string
    title: string
    image: string | null
    postedAt: number
    /** 'pilot' = bài Facebook Pilot đăng (nối mã chắc); 'ten' = bài Kengi khác có dòng đầu trùng tên hàng */
    source: 'pilot' | 'ten'
    productId: string
    sku: string
    name: string
    price: number
    /** giá ghi trong bài ("Giá: …đ"); null = bài không ghi giá */
    priceInPost: number | null
    stock: number
    costPrice: number | null
    marginPct: number | null
    sold30: number
    engagement: { reactions: number; comments: number; shares: number } | null
    /** chặn cả người lẫn máy */
    reason: string | null
    /** chỉ chặn MÁY tự lập (người vẫn lập được, kế hoạch mang cảnh báo) */
    autoBlock: string | null
}

const dongDau = (msg: string) => tenGon(String(msg || '').split('\n')[0].replace(/^🔹\s*/, ''))
/** "Giá: 26.000đ" trong bài → 26000. */
export function giaTrongBai(msg: string): number | null {
    const m = String(msg || '').match(/Giá:\s*([\d.,]+)\s*(?:đ|₫|vnđ|vnd)/i)
    if (!m) return null
    const n = Number(m[1].replace(/[.,]/g, ''))
    return n > 0 ? n : null
}

/**
 * Bài sản phẩm đã lên fanpage trong postMaxAgeDays ngày, chưa có quảng cáo Pilot: bài Facebook Pilot đăng (nối mã chắc)
 * + bài Kengi khác có dòng đầu trùng tên hàng. Xếp: đủ điều kiện trước, rồi bán chạy 30 ngày, rồi tương tác tự nhiên.
 */
export async function timBaiDeDay(ctx: NgCanhAds, cfg: CauHinhAds, page: any, now: number, o: { tuongTac?: boolean } = {}): Promise<{ list: BaiDeDay[]; scanned: number }> {
    const pol = cfg.policy
    const tu = now - pol.postMaxAgeDays * NGAY
    const daDay = new Set((await ctx.kho.dsKeHoachLoai(['boost'], now - 365 * NGAY))
        .filter(k => ['draft', 'running', 'succeeded', 'uncertain'].includes(k.status) || (k.status === 'failed' && k.result?.campaignId && !k.result?.campaignDeleted))
        .map(k => String(k.data?.postId || '')))

    type Tho = { postId: string; at: number; productId?: string; message: string; image: string | null; source: 'pilot' | 'ten' }
    const tho: Tho[] = []
    for (const k of await ngCanhFb(ctx).kho.dsKeHoachBaiTu(tu)) {
        const d = k.data || {}
        if (k.status !== 'succeeded' || !k.result?.postId || !d.productId || String(d.pageId) !== String(page.pageId)) continue
        const at = Number(d.scheduledAt) || k.createdAt
        if (at > now) continue // còn hẹn giờ — chưa lên fanpage
        tho.push({ postId: String(k.result.postId), at, productId: String(d.productId), message: String(d.message || ''), image: (d.mediaUrls || [])[0] || null, source: 'pilot' })
    }
    const daCo = new Set(tho.map(t => t.postId))
    const khac: any[] = await ctx.prisma.fbScheduledPost.findMany({
        where: { pageId: page.pageId, status: 'published', scheduledAt: { gte: new Date(tu), lte: new Date(now) } },
        orderBy: { scheduledAt: 'desc' }, take: 60,
        select: { fbPostId: true, message: true, mediaUrls: true, scheduledAt: true },
    })
    for (const b of khac) {
        if (!b.fbPostId || daCo.has(String(b.fbPostId))) continue
        tho.push({ postId: String(b.fbPostId), at: new Date(b.scheduledAt).getTime(), message: String(b.message || ''), image: jsonDau(b.mediaUrls), source: 'ten' })
    }
    const canXet = tho.filter(t => !daDay.has(t.postId))

    const idCan = [...new Set(canXet.map(t => t.productId).filter(Boolean) as string[])]
    const tenCan = [...new Set(canXet.filter(t => !t.productId).map(t => dongDau(t.message)).filter(t => t.length >= 4))]
    const chon = { id: true, sku: true, name: true, sellingPrice: true, stock: true, costPrice: true, mergedIntoId: true, productType: true, bundleId: true }
    const spDs: any[] = (idCan.length || tenCan.length) ? await ctx.prisma.product.findMany({
        where: { OR: [...(idCan.length ? [{ id: { in: idCan } }] : []), ...(tenCan.length ? [{ name: { in: tenCan }, productType: 'goods', mergedIntoId: null, bundleId: null }] : [])] },
        select: chon,
    }) : []
    const theoId = new Map(spDs.map(s => [String(s.id), s]))
    const theoTen = new Map(spDs.filter(s => !s.mergedIntoId).map(s => [tenGon(s.name), s]))

    const ghep = canXet.map(t => ({ t, sp: t.productId ? theoId.get(t.productId) : theoTen.get(dongDau(t.message)) })).filter(x => x.sp)
    const maBan = [...new Set(ghep.map(x => String(x.sp.id)))]
    const ban: any[] = maBan.length ? await ctx.prisma.transactionItem.groupBy({
        by: ['productId'], where: { productId: { in: maBan }, transaction: KHUNG_BAN(now - 30 * NGAY, now + 1) }, _sum: { quantity: true },
    }).catch((e: any) => { console.error('[AdsPilot] đọc hàng bán chạy lỗi:', e?.message || e); return [] }) : []
    const daBan = new Map(ban.map(b => [String(b.productId), Number(b._sum?.quantity) || 0]))

    // tương tác tự nhiên của bài — đọc bằng PAGE token, TỪNG bài. 09/11/2026: lời gọi gộp gốc `GET /?ids=` cũ bị Facebook trả lỗi ở
    // MỌI phiên bản từ 27/10/2026 (changelog Graph v26.0) ⇒ mục tương tác đã im lặng mất hẳn. Nay (docLeGraph): tối đa
    // TUONG_TAC_TOI_DA bài mới nhất, mỗi đợt 5 lời gọi Graph song song, dừng sau 15 giây; token hỏng / hạn mức ⇒ thôi đọc, khỏi đốt
    // lượt gọi. Hỏng thì thôi — chỉ để xếp hạng.
    const tuongTac = new Map<string, { reactions: number; comments: number; shares: number }>()
    if (o.tuongTac && ghep.length && page.accessToken) {
        const svc = dichVuAds(ctx, page.accessToken)
        const can = [...new Set([...ghep].sort((a, b) => b.t.at - a.t.at).map(x => x.t.postId))].slice(0, TUONG_TAC_TOI_DA)
        const doc = await docLeGraph(can, id => svc.get(id, { fields: 'reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0),shares' }), {
            dong: 5, hanMs: 15_000,
            dungKhi: e => laLoiToken(e) || isRateLimitError(e),
            onLoi: (id, e) => console.warn(`[AdsPilot] đọc tương tác bài ${id} lỗi:`, moTaLoi(e)),
        })
        for (const [id, p] of doc) {
            tuongTac.set(id, { reactions: Number(p?.reactions?.summary?.total_count) || 0, comments: Number(p?.comments?.summary?.total_count) || 0, shares: Number(p?.shares?.count) || 0 })
        }
    }

    const list: BaiDeDay[] = ghep.map(({ t, sp }) => {
        const price = Number(sp.sellingPrice) || 0
        const stock = Number(sp.stock) || 0
        const cost = Number(sp.costPrice) > 0 ? Number(sp.costPrice) : null
        const margin = laiGop(price, Number(sp.costPrice) || 0)
        const priceInPost = giaTrongBai(t.message)
        const reason = sp.mergedIntoId ? 'Mã đã gộp vào mã khác — lên bài bằng mã đích rồi hãy quảng cáo.'
            : sp.productType && sp.productType !== 'goods' ? 'Mã là dịch vụ, không phải hàng hoá.'
                : !(price > 0) ? 'Mã chưa có giá bán trong kho.'
                    : !(stock >= pol.minStock) ? `Tồn kho ${stock} — chính sách chỉ quảng cáo hàng còn ít nhất ${pol.minStock}.`
                        : priceInPost !== null && Math.abs(priceInPost - price) >= 1 ? `Bài ghi giá ${vnd(priceInPost)}, kho đang bán ${vnd(price)} — lên bài mới rồi hãy quảng cáo.`
                            : null
        const autoBlock = reason ? null
            : pol.minMarginPct > 0 && margin === null ? 'Chưa có giá vốn — không biết lãi, máy không tự quảng cáo (người vẫn lập được).'
                : pol.minMarginPct > 0 && margin !== null && margin < pol.minMarginPct ? `Lãi gộp ${margin}% dưới mức ${pol.minMarginPct}% của chính sách — máy không tự quảng cáo.`
                    : null
        return {
            postId: t.postId, title: dongDau(t.message).slice(0, 120), image: t.image, postedAt: t.at, source: t.source,
            productId: String(sp.id), sku: String(sp.sku || ''), name: tenGon(sp.name), price, priceInPost, stock,
            costPrice: cost, marginPct: margin, sold30: daBan.get(String(sp.id)) || 0, engagement: tuongTac.get(t.postId) || null,
            reason, autoBlock,
        }
    })
    const diem = (b: BaiDeDay) => (b.engagement ? b.engagement.comments * 3 + b.engagement.shares * 2 + b.engagement.reactions : 0)
    list.sort((a, b) => Number(!!a.reason) - Number(!!b.reason) || Number(!!a.autoBlock) - Number(!!b.autoBlock)
        || b.sold30 - a.sold30 || diem(b) - diem(a) || b.postedAt - a.postedAt)
    return { list, scanned: tho.length }
}

function jsonDau(raw: any): string | null {
    const v = Array.isArray(raw) ? raw : docJson(raw, [])
    return Array.isArray(v) && v[0] ? String(v[0]) : null
}

// ─── Kế hoạch ───────────────────────────────────────────────────────────────────

function keHoachMoi(kind: LoaiKeHoachAds, data: any, khoa: string | null | undefined, nguoi: string | null | undefined, now: number): KeHoachAds {
    return { id: crypto.randomUUID(), kind, status: 'draft', idempotencyKey: khoa ? String(khoa).slice(0, 200) : null, data, result: null, createdBy: nguoi ?? null, createdAt: now, updatedAt: now }
}

/** Ngân sách người nhập: KHÔNG kẹp lặng lẽ — sai khoảng thì nói. */
function docNganSach(v: any, pol: ChinhSachAds, macDinh: number): number {
    if (v === undefined || v === null || String(v).trim() === '') return macDinh
    const n = Number(v)
    if (!Number.isFinite(n)) throw new ToolError('Ngân sách không đọc được.')
    if (n < NGAN_SACH_TOI_THIEU) throw new ToolError(`Ngân sách tối thiểu ${vnd(NGAN_SACH_TOI_THIEU)}/ngày.`)
    if (n > pol.maxBudgetPerAd) throw new ToolError(`Ngân sách ${vnd(n)}/ngày vượt trần một quảng cáo ${vnd(pol.maxBudgetPerAd)}/ngày trong chính sách.`)
    return tron1000(n)
}

function docSoNgay(v: any, pol: ChinhSachAds): number {
    if (v === undefined || v === null || String(v).trim() === '') return pol.days
    const n = Math.floor(Number(v))
    if (!(n >= 2 && n <= 30)) throw new ToolError('Số ngày chạy từ 2 đến 30 (Facebook chỉ nhận ngân sách ngày cho quảng cáo chạy hơn 24 giờ).')
    return n
}

function lapKeHoachDayTuBai(ctx: NgCanhAds, cfg: CauHinhAds, page: any, bai: BaiDeDay, b: { dailyBudget?: any; days?: any; idempotencyKey?: string | null }, now: number): Promise<KeHoachAds> {
    const pol = cfg.policy
    if (bai.reason) throw new ToolError(bai.reason)
    const dailyBudget = docNganSach(b.dailyBudget, pol, pol.budgetPerAd)
    const days = docSoNgay(b.days, pol)
    const data = {
        adAccountId: cfg.adAccountId, pageId: String(page.pageId), pageName: page.name, postId: bai.postId, postTitle: bai.title, image: bai.image,
        source: bai.source, productId: bai.productId, sku: bai.sku, name: bai.name, price: bai.price, priceInPost: bai.priceInPost, stock: bai.stock,
        costPrice: bai.costPrice, marginPct: bai.marginPct, sold30: bai.sold30, dailyBudget, days, total: dailyBudget * days,
        ageMin: pol.ageMin, ageMax: pol.ageMax,
        ...(bai.autoBlock ? { warnings: [bai.autoBlock] } : {}),
    }
    return ctx.kho.taoKeHoach(keHoachMoi('boost', data, b.idempotencyKey, ctx.nguoi, now))
}

/** Kế hoạch đẩy một bài (người bấm). Bài phải nằm trong danh sách đẩy được (đã lên, chưa có quảng cáo Pilot, nối được mã). */
export async function taoKeHoachDay(ctx: NgCanhAds, b: { postId: string; dailyBudget?: any; days?: any; idempotencyKey?: string }): Promise<KeHoachAds> {
    const now = luc(ctx)
    const cfg = await docCauHinhAds(ctx)
    if (!cfg.adAccountId) throw new ToolError('Chưa chọn tài khoản quảng cáo — chọn ở Chính sách quảng cáo.')
    const page = await canPageAds(ctx)
    const postId = String(b?.postId || '').trim()
    if (!postId) throw new ToolError('Chọn bài cần đẩy.')
    // Bấm hai lần / mạng gửi lại: bài đã có kế hoạch nên rời danh sách đẩy được ⇒ phải trả kế hoạch cũ TRƯỚC khi soát danh sách
    const khoa = b?.idempotencyKey ? String(b.idempotencyKey).slice(0, 200) : null
    const cu = khoa ? await ctx.kho.layKeHoachTheoKhoa(khoa) : null
    if (cu) {
        if (cu.kind !== 'boost' || String(cu.data?.postId) !== postId) throw new ToolError('Khoá chống trùng đã dùng cho việc khác — tải lại trang rồi bấm lại.')
        return cu
    }
    const { list } = await timBaiDeDay(ctx, cfg, page, now)
    const bai = list.find(x => x.postId === postId)
    if (!bai) throw new ToolError(`Bài không nằm trong danh sách đẩy được: đã có quảng cáo Pilot, đăng quá ${cfg.policy.postMaxAgeDays} ngày, chưa lên fanpage, hoặc không nối được mã hàng.`)
    return lapKeHoachDayTuBai(ctx, cfg, page, bai, b, now)
}

async function quangCaoCuaPilot(ctx: NgCanhAds, campaignId: string, now: number): Promise<KeHoachAds> {
    const cid = String(campaignId || '').trim()
    if (!cid) throw new ToolError('Thiếu mã chiến dịch.')
    const k = (await ctx.kho.dsKeHoachLoai(['boost'], now - 365 * NGAY)).find(x => String(x.result?.campaignId || '') === cid && !x.result?.campaignDeleted)
    if (!k) throw new ToolError('Chiến dịch không do Ads Pilot tạo — Pilot không đụng tới quảng cáo bạn tự chạy.')
    return k
}

const LY_DO_DUNG: Record<string, string> = {
    thu_cong: 'Người dùng tạm dừng', het_ton: 'Hết hàng (dưới mức tồn tối thiểu)', mat_hang: 'Mã hàng không còn / đã gộp',
    doi_gia: 'Giá bán đã đổi — bài ghi giá cũ', khong_ket_qua: 'Chi tiền mà không có khách hỏi', dat: 'Chi phí mỗi kết quả quá cao',
}

export async function taoKeHoachDung(ctx: NgCanhAds, b: { campaignId: string; reason?: string; reasonText?: string; idempotencyKey?: string | null }): Promise<KeHoachAds> {
    const now = luc(ctx)
    const goc = await quangCaoCuaPilot(ctx, b.campaignId, now)
    const reason = String(b.reason || 'thu_cong')
    const data = {
        adAccountId: goc.data?.adAccountId, campaignId: String(goc.result.campaignId), adsetId: goc.result?.adsetId || null,
        postId: goc.data?.postId, productId: goc.data?.productId || null, sku: goc.data?.sku || null, name: goc.data?.name || '',
        reason, reasonText: String(b.reasonText || LY_DO_DUNG[reason] || reason).slice(0, 300),
    }
    return ctx.kho.taoKeHoach(keHoachMoi('pause', data, b.idempotencyKey, ctx.nguoi, now))
}

export async function taoKeHoachChayLai(ctx: NgCanhAds, b: { campaignId: string; reasonText?: string; idempotencyKey?: string | null }): Promise<KeHoachAds> {
    const now = luc(ctx)
    const goc = await quangCaoCuaPilot(ctx, b.campaignId, now)
    const data = {
        adAccountId: goc.data?.adAccountId, campaignId: String(goc.result.campaignId), adsetId: goc.result?.adsetId || null,
        postId: goc.data?.postId, productId: goc.data?.productId || null, sku: goc.data?.sku || null, name: goc.data?.name || '',
        priceInPost: goc.data?.priceInPost ?? null, dailyBudget: Number(goc.result?.dailyBudget ?? goc.data?.dailyBudget) || 0,
        reasonText: String(b.reasonText || 'Người dùng chạy lại').slice(0, 300),
    }
    return ctx.kho.taoKeHoach(keHoachMoi('resume', data, b.idempotencyKey, ctx.nguoi, now))
}

export async function taoKeHoachNganSach(ctx: NgCanhAds, b: { campaignId: string; dailyBudget: any; from?: number; reasonText?: string; idempotencyKey?: string | null }): Promise<KeHoachAds> {
    const now = luc(ctx)
    const cfg = await docCauHinhAds(ctx)
    const goc = await quangCaoCuaPilot(ctx, b.campaignId, now)
    if (b.dailyBudget === undefined || b.dailyBudget === null || String(b.dailyBudget).trim() === '') throw new ToolError('Nhập ngân sách mới.')
    const to = docNganSach(b.dailyBudget, cfg.policy, 0)
    const from = Number(b.from ?? goc.result?.dailyBudget ?? goc.data?.dailyBudget) || 0
    const data = {
        adAccountId: goc.data?.adAccountId, campaignId: String(goc.result.campaignId), adsetId: goc.result?.adsetId || null,
        postId: goc.data?.postId, productId: goc.data?.productId || null, sku: goc.data?.sku || null, name: goc.data?.name || '',
        from, to, reasonText: String(b.reasonText || 'Người dùng đổi ngân sách').slice(0, 300),
    }
    return ctx.kho.taoKeHoach(keHoachMoi('budget', data, b.idempotencyKey, ctx.nguoi, now))
}

export async function huyKeHoachAds(ctx: NgCanhAds, id: string): Promise<KeHoachAds> {
    if (!(await ctx.kho.huyKeHoach(String(id || '')))) throw new ToolError('Kế hoạch không còn là bản nháp — không huỷ được.')
    return (await ctx.kho.layKeHoach(String(id)))!
}

/** Việc làm TĂNG tiền chi (cần trần + khoá tiền; chế độ 'approve' thì máy không tự làm). */
export function laTangChi(k: { kind: string; data?: any }): boolean {
    return k.kind === 'boost' || k.kind === 'resume' || (k.kind === 'budget' && Number(k.data?.to) > Number(k.data?.from))
}

const tomTat = (k: KeHoachAds) => ({
    sku: k.data?.sku || null, postId: k.data?.postId || null, campaignId: k.data?.campaignId || k.result?.campaignId || null,
    dailyBudget: k.data?.dailyBudget ?? k.data?.to ?? null, reason: k.data?.reason || null,
})

// ─── Thực thi ───────────────────────────────────────────────────────────────────

/** Trần thao tác/ngày. KHÔNG áp cho việc tạm dừng — hết lượt mà không tắt được quảng cáo hết hàng là mất tiền thật. */
async function conLuotGhi(ctx: NgCanhAds, pol: ChinhSachAds) {
    const n = await ctx.kho.demGhiTuLuc(dauNgayVN(luc(ctx)))
    if (n >= pol.maxActionsPerDay) throw new ToolError(`Đã đủ ${pol.maxActionsPerDay} thao tác quảng cáo hôm nay (giới hạn trong chính sách) — mai chạy tiếp.`)
}

/** Kho lúc thực thi: mã còn, chưa gộp, tồn đủ, giá chưa đổi so với giá bài ghi; máy tự chạy còn đòi đủ lãi gộp. */
async function soatHang(ctx: NgCanhAds, productId: string, giaBai: number | null, pol: ChinhSachAds, tuDong: boolean): Promise<void> {
    const sp = await ctx.prisma.product.findUnique({ where: { id: String(productId) }, select: { id: true, sellingPrice: true, stock: true, costPrice: true, mergedIntoId: true } })
    if (!sp) throw new ToolError('Mã hàng không còn trong kho — không quảng cáo.')
    if (sp.mergedIntoId) throw new ToolError('Mã đã gộp vào mã khác — không quảng cáo bài của mã cũ.')
    if (!(Number(sp.stock) >= pol.minStock)) throw new ToolError(`Tồn kho còn ${Number(sp.stock) || 0} — dưới mức ${pol.minStock} của chính sách, không quảng cáo.`)
    if (giaBai !== null && Math.abs((Number(sp.sellingPrice) || 0) - giaBai) >= 1) {
        throw new ToolError(`Bài ghi giá ${vnd(giaBai)} mà kho đang bán ${vnd(Number(sp.sellingPrice) || 0)} — quảng cáo sẽ ghi sai giá. Lên bài mới rồi lập lại.`)
    }
    if (tuDong && pol.minMarginPct > 0) {
        const m = laiGop(Number(sp.sellingPrice) || 0, Number(sp.costPrice) || 0)
        if (m === null) throw new ToolError('Chưa có giá vốn — máy không tự quảng cáo hàng không biết lãi.')
        if (m < pol.minMarginPct) throw new ToolError(`Lãi gộp ${m}% dưới mức ${pol.minMarginPct}% của chính sách — máy không tự quảng cáo.`)
    }
}

/** Đối tượng: Việt Nam, tuổi theo chính sách lúc lập, chỉ bảng tin Facebook (nơi bài gốc nằm), không để Facebook nới đối tượng. */
const doiTuong = (d: any) => ({
    geo_locations: { countries: ['VN'] }, age_min: Math.floor(Number(d.ageMin) || 18), age_max: Math.floor(Number(d.ageMax) || 65),
    publisher_platforms: ['facebook'], facebook_positions: ['feed'], targeting_automation: { advantage_audience: 0 },
})

async function thucThiDay(ctx: NgCanhAds, plan: KeHoachAds, cfg: CauHinhAds, svc: DichVuAds, tuDong: boolean): Promise<any> {
    const now = luc(ctx)
    const d = plan.data || {}
    const pol = cfg.policy
    const act = String(d.adAccountId)
    if (d.productId) await soatHang(ctx, d.productId, d.priceInPost == null ? null : Number(d.priceInPost), pol, tuDong)
    const lyDoTk = lyDoTaiKhoanKhongTangChi(await docTaiKhoan(svc, act))
    if (lyDoTk) throw new ToolError(lyDoTk)
    const page = await canPageAds(ctx, { canToken: true })
    if (String(d.pageId) !== String(page.pageId)) throw new ToolError(`Kế hoạch lập cho fanpage khác (${d.pageName || d.pageId}) — huỷ rồi lập lại.`)
    // bài phải ĐÃ LÊN và còn trên fanpage — đọc bằng page token (lỗi ở đây là lỗi page token, không phải token quảng cáo)
    let bai: any
    try { bai = await dichVuAds(ctx, page.accessToken).get(String(d.postId), { fields: 'id,is_published' }) } catch (e: any) {
        throw new ToolError(laLoiToken(e)
            ? `Page token của fanpage "${page.name}" bị Facebook từ chối — dán page token mới ở tab Kết nối.`
            : `Không đọc được bài trên fanpage (đã bị xoá?) — ${moTaLoi(e)}`)
    }
    if (bai?.is_published === false) throw new ToolError('Bài chưa lên fanpage (còn hẹn giờ) — chờ bài lên rồi mới đẩy.')
    const dailyBudget = Number(d.dailyBudget)
    if (!(dailyBudget >= NGAN_SACH_TOI_THIEU) || dailyBudget > pol.maxBudgetPerAd) {
        throw new ToolError(`Ngân sách ${vnd(dailyBudget)}/ngày ngoài khoảng ${vnd(NGAN_SACH_TOI_THIEU)}–${vnd(pol.maxBudgetPerAd)} của chính sách hiện tại — lập lại.`)
    }
    const days = Math.min(Math.max(Math.floor(Number(d.days) || pol.days), 2), 30)
    await soatTrongTran(ctx, svc, cfg, { them: dailyBudget, moi: true })

    const batDau = Math.floor(now / 1000)
    const ketThuc = batDau + days * 86400
    const ten = `Kengi Pilot · ${d.sku || d.postId} · ${ngayVN(now)}`
    const tienDo: any = { adAccountId: act, dailyBudget, days, startAt: batDau * 1000, endAt: ketThuc * 1000, priceInPost: d.priceInPost ?? null }
    const ghiTienDo = () => ctx.kho.capNhatKeHoach(plan.id, 'running', { ...tienDo }).catch(() => { })
    try {
        const c = await ghiFb(() => svc.post(`${act}/campaigns`, thamSoChienDichDayBai(ten)))
        tienDo.campaignId = String(c?.id || '')
        if (!tienDo.campaignId) throw new Error('Facebook không trả mã chiến dịch')
        await ghiTienDo()
        const s = await ghiFb(() => svc.post(`${act}/adsets`, thamSoNhomDayBai({
            ten, campaignId: tienDo.campaignId, pageId: String(d.pageId), dailyBudgetVnd: dailyBudget, batDauGiay: batDau, ketThucGiay: ketThuc, targeting: doiTuong(d),
        })))
        tienDo.adsetId = String(s?.id || '')
        if (!tienDo.adsetId) throw new Error('Facebook không trả mã nhóm quảng cáo')
        await ghiTienDo()
        const cr = await ghiFb(() => svc.post(`${act}/adcreatives`, { name: ten, object_story_id: String(d.postId) }))
        tienDo.creativeId = String(cr?.id || '')
        if (!tienDo.creativeId) throw new Error('Facebook không trả mã mẫu quảng cáo')
        await ghiTienDo()
        const ad = await ghiFb(() => svc.post(`${act}/ads`, { name: ten, adset_id: tienDo.adsetId, creative: { creative_id: tienDo.creativeId }, status: 'ACTIVE' }))
        tienDo.adId = String(ad?.id || '')
        if (!tienDo.adId) throw new Error('Facebook không trả mã quảng cáo')
        await ghiTienDo()
    } catch (e: any) {
        // dựng dở: chiến dịch còn TẠM DỪNG ⇒ chưa tiêu đồng nào; xoá chiến dịch rỗng cho sạch Trình quản lý quảng cáo.
        // Mất mạng thì KHÔNG đụng (không biết bước nào đã tới) — để 'uncertain' cho người xem.
        if (tienDo.campaignId && !laLoiMang(e)) {
            await svc.post(tienDo.campaignId, { status: 'DELETED' }).then(() => { tienDo.campaignDeleted = true }).catch(() => { })
        }
        throw Object.assign(e instanceof Error ? e : new Error(String(e)), { tienDo })
    }
    // bật chiến dịch — từ đây mới tiêu tiền
    try {
        await ghiFb(() => svc.post(tienDo.campaignId, { status: 'ACTIVE' }))
    } catch (e: any) {
        throw Object.assign(e instanceof Error ? e : new Error(String(e)), { tienDo: { ...tienDo, activateFailed: true } })
    }
    tienDo.activatedAt = now
    await ctx.kho.ghiNhatKy({ action: 'boost', status: 'succeeded', planId: plan.id, payload: tomTat(plan), response: { campaignId: tienDo.campaignId, adsetId: tienDo.adsetId, adId: tienDo.adId } })
    return tienDo
}

async function thucThiDung(ctx: NgCanhAds, plan: KeHoachAds, svc: DichVuAds): Promise<any> {
    const d = plan.data || {}
    await ghiFb(() => svc.post(String(d.campaignId), { status: 'PAUSED' }))
    await ctx.kho.ghiNhatKy({ action: 'pause', status: 'succeeded', planId: plan.id, payload: tomTat(plan), response: { paused: true } })
    return { paused: true, reason: d.reason || null }
}

const DA_XOA = (a: QuangCaoPilot) => ['DELETED', 'ARCHIVED'].includes(String(a.status)) || ['DELETED', 'ARCHIVED'].includes(String(a.effectiveStatus))

async function thucThiChayLai(ctx: NgCanhAds, plan: KeHoachAds, cfg: CauHinhAds, svc: DichVuAds, tuDong: boolean): Promise<any> {
    const now = luc(ctx)
    const d = plan.data || {}
    const pol = cfg.policy
    if (d.productId) await soatHang(ctx, d.productId, d.priceInPost == null ? null : Number(d.priceInPost), pol, tuDong)
    const lyDoTk = lyDoTaiKhoanKhongTangChi(await docTaiKhoan(svc, String(d.adAccountId)))
    if (lyDoTk) throw new ToolError(lyDoTk)
    const { ads, liveError } = await docQuangCaoPilot(ctx, svc, now, { soLieu: false })
    if (liveError) throw new ToolError(`Không đọc được quảng cáo trên Facebook — không bật lại cho an toàn. (${liveError})`)
    const a = ads.find(x => x.campaignId === String(d.campaignId))
    if (!a) throw new ToolError('Không thấy chiến dịch này trong các quảng cáo Pilot.')
    if (DA_XOA(a)) throw new ToolError('Chiến dịch đã bị xoá / lưu trữ trên Facebook — lập quảng cáo mới cho bài này.')
    if (a.ended || (a.endAt && a.endAt - now < 3600_000)) throw new ToolError('Quảng cáo đã (sắp) hết thời gian chạy — lập quảng cáo mới cho bài này.')
    if (a.running) return { alreadyActive: true }
    if (a.adsetStatus && a.adsetStatus !== 'ACTIVE') throw new ToolError('Nhóm quảng cáo đang bị tắt riêng trong Trình quản lý quảng cáo — bật chiến dịch cũng không chạy; bật nhóm ở đó nếu muốn chạy tiếp.')
    const { soChay, nganSach } = dangChiemTran(ads)
    if (soChay >= pol.maxActiveAds) throw new ToolError(`Đang có ${soChay} quảng cáo Pilot chạy — chính sách cho tối đa ${pol.maxActiveAds} cùng lúc.`)
    if (nganSach + a.dailyBudget > pol.dailyBudgetCap) throw new ToolError(`Vượt trần ngân sách: đang chạy ${vnd(nganSach)}/ngày + ${vnd(a.dailyBudget)}/ngày > trần ${vnd(pol.dailyBudgetCap)}/ngày.`)
    await ghiFb(() => svc.post(String(d.campaignId), { status: 'ACTIVE' }))
    await ctx.kho.ghiNhatKy({ action: 'resume', status: 'succeeded', planId: plan.id, payload: tomTat(plan), response: { active: true } })
    return { active: true, dailyBudget: a.dailyBudget }
}

async function thucThiNganSach(ctx: NgCanhAds, plan: KeHoachAds, cfg: CauHinhAds, svc: DichVuAds, tuDong: boolean): Promise<any> {
    const d = plan.data || {}
    const pol = cfg.policy
    const to = Number(d.to)
    if (!(to >= NGAN_SACH_TOI_THIEU) || to > pol.maxBudgetPerAd) throw new ToolError(`Ngân sách ${vnd(to)}/ngày ngoài khoảng ${vnd(NGAN_SACH_TOI_THIEU)}–${vnd(pol.maxBudgetPerAd)} của chính sách hiện tại.`)
    const { ads, liveError } = await docQuangCaoPilot(ctx, svc, luc(ctx), { soLieu: false })
    const a = ads.find(x => x.campaignId === String(d.campaignId))
    // tăng hay giảm phải biết ngân sách SỐNG của CHÍNH chiến dịch này — không đọc được nó thì không đổi gì
    if (a && a.status === null) throw new ToolError(`Không đọc được chiến dịch này trên Facebook — không đổi ngân sách cho an toàn. (${a.readError || liveError})`)
    if (!a?.adsetId) throw new ToolError('Không thấy nhóm quảng cáo của chiến dịch trên Facebook.')
    if (DA_XOA(a)) throw new ToolError('Chiến dịch đã bị xoá / lưu trữ trên Facebook.')
    // "tăng" hay "giảm" tính theo ngân sách SỐNG (kế hoạch lập từ trước, người có thể đã sửa trong Trình quản lý)
    if (to > a.dailyBudget) {
        // 09/11/2026: chiến dịch KHÁC không đọc được chỉ chặn việc TĂNG (trần có thể đang đếm thiếu); HẠ ngân sách vẫn làm
        if (liveError) throw new ToolError(`Không đọc được quảng cáo trên Facebook — không TĂNG ngân sách cho an toàn (hạ / tạm dừng vẫn làm được). (${liveError})`)
        if (tuDong && cfg.mode !== 'auto') throw new ToolError(`Ngân sách đang là ${vnd(a.dailyBudget)}/ngày — đổi thành ${vnd(to)} là TĂNG chi, chờ người duyệt.`)
        if (!(pol.dailyBudgetCap > 0)) throw new ToolError(CHUA_DAT_TRAN)
        if (a.running) {
            const lyDoTk = lyDoTaiKhoanKhongTangChi(await docTaiKhoan(svc, a.adAccountId))
            if (lyDoTk) throw new ToolError(lyDoTk)
            const { nganSach } = dangChiemTran(ads, a.campaignId)
            if (nganSach + to > pol.dailyBudgetCap) throw new ToolError(`Vượt trần ngân sách: các quảng cáo khác ${vnd(nganSach)}/ngày + ${vnd(to)}/ngày > trần ${vnd(pol.dailyBudgetCap)}/ngày.`)
        }
    }
    await ghiFb(() => svc.post(a.adsetId!, { daily_budget: Math.round(to) }))
    await ctx.kho.ghiNhatKy({ action: 'budget', status: 'succeeded', planId: plan.id, payload: tomTat(plan), response: { from: a.dailyBudget, to } })
    return { from: a.dailyBudget, to }
}

/**
 * Thực thi một kế hoạch quảng cáo. 'preview' ⇒ không gọi Facebook. `tuDong` (chu kỳ máy) ở chế độ 'approve' chỉ làm việc
 * GIẢM chi — việc tăng chi trả về chờ duyệt. Người bấm ở 'approve' / 'auto' ⇒ làm (đã duyệt), vẫn qua mọi rào.
 */
export async function thucThiAds(ctx: NgCanhAds, planId: string, tuyChon: { tuDong?: boolean } = {}): Promise<any> {
    const plan = await ctx.kho.layKeHoach(String(planId || ''))
    if (!plan) throw new ToolError('Không thấy kế hoạch — tải lại trang.')
    if (plan.status !== 'draft') return plan
    const cfg = await docCauHinhAds(ctx)
    if (cfg.mode === 'preview') return { executed: false, plan }
    const tangChi = laTangChi(plan)
    if (tuyChon.tuDong && tangChi && cfg.mode !== 'auto') return { executed: false, plan, waitingApproval: true }
    const tok = await canTokenAds(ctx, cfg)
    if (!coQuyenGhi(tok.scopes)) throw new ToolError('Token quảng cáo chỉ có quyền đọc (thiếu ads_management) — dán token có quyền ads_management.')
    if (!chuanAct(plan.data?.adAccountId)) throw new ToolError('Kế hoạch thiếu tài khoản quảng cáo — huỷ rồi lập lại.')
    // quảng cáo MỚI chỉ dựng trên tài khoản đang chọn; tạm dừng / chạy lại / ngân sách đi theo tài khoản của chiến dịch
    if (plan.kind === 'boost' && plan.data.adAccountId !== cfg.adAccountId) throw new ToolError('Kế hoạch lập cho tài khoản quảng cáo khác tài khoản đang chọn — huỷ rồi lập lại.')
    if (plan.kind !== 'pause') await conLuotGhi(ctx, cfg.policy)
    if (tangChi && !(cfg.policy.dailyBudgetCap > 0)) throw new ToolError(CHUA_DAT_TRAN)
    const svc = dichVuAds(ctx, tok.accessToken)
    // khoá tiền: đẩy / chạy lại / đổi ngân sách chạy MỘT cái một lúc (hai lượt song song không cùng lọt trần). Tạm dừng không khoá.
    let giuKhoa = false
    if (plan.kind !== 'pause') {
        giuKhoa = await ctx.kho.giuKhoaTien(luc(ctx), 10 * 60_000)
        if (!giuKhoa) throw new ToolError('Một thao tác quảng cáo khác đang chạy — thử lại sau ít phút.')
    }
    try {
        if (!(await ctx.kho.gianhKeHoach(plan.id))) return (await ctx.kho.layKeHoach(plan.id)) || plan
        let status = 'succeeded', result: any = null
        try {
            if (plan.kind === 'boost') result = await thucThiDay(ctx, plan, cfg, svc, !!tuyChon.tuDong)
            else if (plan.kind === 'pause') result = await thucThiDung(ctx, plan, svc)
            else if (plan.kind === 'resume') result = await thucThiChayLai(ctx, plan, cfg, svc, !!tuyChon.tuDong)
            else if (plan.kind === 'budget') result = await thucThiNganSach(ctx, plan, cfg, svc, !!tuyChon.tuDong)
            else throw new ToolError(`Loại kế hoạch lạ: ${plan.kind}`)
        } catch (e: any) {
            // mất mạng SAU khi đã gửi lệnh ghi ⇒ không biết Facebook đã nhận chưa; mất mạng lúc còn đọc ⇒ hỏng bình thường
            status = laLoiMang(e) && e?.daGhi ? 'uncertain' : 'failed'
            result = { ...(e?.tienDo || {}), message: String(e?.message || e).slice(0, 800) }
            if (status === 'uncertain') result.message = `Mất kết nối giữa chừng — không rõ Facebook đã nhận chưa. Mở Trình quản lý quảng cáo kiểm tra trước khi lập lại. (${result.message})`
            else if (laLoiToken(e) || laLoiQuyen(e)) result.message = moTaLoi(e)
            if (e?.tienDo?.activateFailed && status === 'failed') result.message = `Đã dựng xong quảng cáo (đang TẠM DỪNG, chưa tiêu tiền) nhưng bật không được: ${result.message}`
            await ctx.kho.ghiNhatKy({ action: plan.kind, status, planId: plan.id, payload: tomTat(plan), response: result }).catch(() => { })
            if (!(e instanceof ToolError) && !e?.code) console.error(`[AdsPilot] thực thi ${plan.kind} ${plan.id} lỗi:`, e?.message || e)
        }
        // AD-10: chu kỳ máy TỰ làm (không người bấm) — báo cáo chi hằng ngày tách "máy tự" khỏi "người duyệt đề xuất của máy"
        if (status === 'succeeded' && tuyChon.tuDong && result && typeof result === 'object') result = { ...result, tuDong: true }
        await ctx.kho.capNhatKeHoach(plan.id, status, result)
        return (await ctx.kho.layKeHoach(plan.id)) || { ...plan, status, result }
    } finally {
        if (giuKhoa) await ctx.kho.traKhoaTien().catch(() => { })
    }
}

// ─── Luật của chu kỳ (hàm thuần — bộ kiểm canh trực tiếp) ───────────────────────

/**
 * Lý do máy TẠM DỪNG một quảng cáo đang chạy — null = để chạy tiếp. Tạm dừng là hướng an toàn (ngừng tiêu tiền).
 * `coSoLieu: false` (Insights hỏng) ⇒ chỉ xét kho, không xét chi tiêu.
 */
export function lyDoDung(a: QuangCaoPilot, pol: ChinhSachAds, coSoLieu = true): { reason: string; text: string } | null {
    if (pol.automation.pauseOutOfStock && a.productId) {
        if (!a.product) return { reason: 'mat_hang', text: 'Mã hàng không còn trong kho' }
        if (a.product.merged) return { reason: 'mat_hang', text: 'Mã hàng đã gộp vào mã khác' }
        if (!(a.product.stock >= pol.minStock)) return { reason: 'het_ton', text: `Tồn kho còn ${a.product.stock} (chính sách ≥ ${pol.minStock})` }
        if (a.priceAtBoost !== null && Math.abs(a.product.price - a.priceAtBoost) >= 1) {
            return { reason: 'doi_gia', text: `Giá bán đổi từ ${vnd(a.priceAtBoost)} thành ${vnd(a.product.price)} — bài quảng cáo đang ghi giá cũ` }
        }
    }
    if (pol.automation.pauseLosers && coSoLieu) {
        const L = a.life
        if (pol.stopLossVnd > 0 && L.spend >= pol.stopLossVnd && L.results === 0) {
            return { reason: 'khong_ket_qua', text: `Đã chi ${vnd(L.spend)} mà chưa có bình luận / tin nhắn nào (mức dừng ${vnd(pol.stopLossVnd)})` }
        }
        if (pol.maxCostPerResult > 0 && L.results > 0 && L.spend >= 3 * pol.maxCostPerResult && L.spend / L.results > pol.maxCostPerResult) {
            return { reason: 'dat', text: `${vnd(L.spend / L.results)} mỗi bình luận / tin nhắn — trên mức ${vnd(pol.maxCostPerResult)} của chính sách` }
        }
        /* AD-09 (10/11/2026): cùng hai luật trên, xét thêm 8 ngày gần đây — quảng cáo tốt ở tuần đầu rồi "chết" (chi đều mà không ai hỏi)
         * thì số TRỌN ĐỜI vẫn đẹp, máy cũ để chạy mãi. Cùng mã lý do ⇒ người đã bật lại vì lý do đó thì máy cũng không tự tắt lại. */
        const R = a.recent
        if (R) {
            if (pol.stopLossVnd > 0 && R.spend >= pol.stopLossVnd && R.results === 0) {
                return { reason: 'khong_ket_qua', text: `${GAN_DAY} đã chi ${vnd(R.spend)} mà không có bình luận / tin nhắn nào (mức dừng ${vnd(pol.stopLossVnd)})` }
            }
            if (pol.maxCostPerResult > 0 && R.results > 0 && R.spend >= 3 * pol.maxCostPerResult && R.spend / R.results > pol.maxCostPerResult) {
                return { reason: 'dat', text: `${GAN_DAY}: ${vnd(R.spend / R.results)} mỗi bình luận / tin nhắn — trên mức ${vnd(pol.maxCostPerResult)} của chính sách` }
            }
        }
    }
    return null
}

/** Đủ tốt để tăng ngân sách: ≥ 5 kết quả, chi phí mỗi kết quả ≤ nửa mức cho phép. */
const soTot = (s: SoLieuAds | null | undefined, max: number) => !!s && s.results >= 5 && s.spend / s.results <= 0.5 * max

/**
 * Ngân sách mới cho quảng cáo TỐT: +20%, tròn nghìn, không quá trần một quảng cáo. AD-09: phải tốt CẢ trọn đời LẪN 8 ngày gần
 * đây (thiếu số gần đây ⇒ không tăng); AD-11: quảng cáo Facebook từ chối / có vấn đề ⇒ không tăng.
 */
export function nganSachTang(a: QuangCaoPilot, pol: ChinhSachAds): number | null {
    if (!pol.automation.scaleWinners || !(pol.maxCostPerResult > 0)) return null
    if (a.deliveryIssue) return null
    if (!soTot(a.life, pol.maxCostPerResult) || !soTot(a.recent, pol.maxCostPerResult)) return null
    if (a.dailyBudget >= pol.maxBudgetPerAd) return null
    const moi = Math.min(pol.maxBudgetPerAd, tron1000(a.dailyBudget * 1.2))
    return moi > a.dailyBudget ? moi : null
}

/** Máy tự chạy lại quảng cáo nó đã tạm dừng vì HẾT HÀNG, khi kho có hàng lại (và giá bài còn đúng). Quảng cáo Facebook đang từ chối /
 *  có vấn đề thì KHÔNG (chạy lại chỉ chiếm chỗ trong trần mà không phân phối — AD-11). */
export function nenChayLai(a: QuangCaoPilot, pol: ChinhSachAds): boolean {
    return pol.automation.resumeRestocked && !a.running && !a.ended && !DA_XOA(a) && a.status === 'PAUSED' && a.planStatus === 'succeeded'
        && !a.deliveryIssue
        && (!a.adsetStatus || a.adsetStatus === 'ACTIVE')
        && a.lastAction?.kind === 'pause' && a.lastAction.by === 'pilot' && a.lastAction.reason === 'het_ton'
        && !!a.product && !a.product.merged && a.product.stock >= pol.minStock
        && (a.priceAtBoost === null || Math.abs(a.product.price - a.priceAtBoost) < 1)
}

// ─── Chu kỳ ─────────────────────────────────────────────────────────────────────

/** Nháp TĂNG chi máy lập quá 3 ngày không ai duyệt ⇒ huỷ. Nháp tạm dừng KHÔNG hết hạn (đổi khỏi Xem trước là chạy ngay). */
const NHAP_MAY_HET_HAN = 3 * NGAY
const CHO_DUYET = 'CHỜ NGƯỜI DUYỆT'
const TEN_VIEC: Record<string, string> = { boost: 'bật quảng cáo mới', resume: 'bật lại quảng cáo', budget: 'tăng ngân sách', pause: 'tạm dừng' }

/** AD-10: báo cáo chi hằng ngày — lượt chạy theo lịch đầu tiên từ GIO_BAO_CAO giờ sáng (giờ VN) mỗi ngày. */
const GIO_BAO_CAO = 8
const gioVN = (ms: number) => new Date(ms + 7 * 3600_000).getUTCHours()
export interface BaoCaoNgayAds { ngay: string; title: string | null; message: string | null }
const TEN_VIEC_BAO_CAO: Record<string, string> = { pause: 'tạm dừng', budgetUp: 'tăng ngân sách', budgetDown: 'hạ ngân sách', resume: 'chạy lại', boost: 'bật quảng cáo mới' }

/**
 * Báo cáo chi HÔM QUA của quảng cáo Pilot (AD-10, 10/11/2026): chi + kết quả (Insights 'yesterday' từng tài khoản, CHỈ chiến dịch
 * Pilot — "hôm qua" theo múi giờ của tài khoản quảng cáo), việc máy TỰ làm (kế hoạch mang result.tuDong) / việc người làm (web,
 * trợ lý AI, kể cả người duyệt đề xuất của máy) theo sổ nhật ký, số đang chạy SAU lượt này. Hôm qua không chi đồng nào và không
 * thao tác nào ⇒ title null (đánh dấu đã xét, không gửi). Đọc Insights hỏng ⇒ NÉM (không đánh dấu ⇒ lượt sau thử lại).
 */
async function baoCaoChiHomQua(ctx: NgCanhAds, svc: DichVuAds, ads: QuangCaoPilot[], pol: ChinhSachAds, now: number, hienTai: { soChay: number; nganSach: number }): Promise<BaoCaoNgayAds> {
    const ngay = ngayVN(now)
    const dau = dauNgayVN(now), tu = dau - NGAY
    const [, thang, ngayThang] = ngayVN(tu).split('-')
    const theoTk = new Map<string, string[]>()
    for (const a of ads) {
        if (!a.adAccountId) continue
        if (!theoTk.has(a.adAccountId)) theoTk.set(a.adAccountId, [])
        theoTk.get(a.adAccountId)!.push(a.campaignId)
    }
    let chi = 0, ketQua = 0, coChi = 0
    for (const [act, ids] of theoTk) {
        for (const s of (await docInsightsChienDich(svc, act, ids, 'yesterday')).values()) {
            chi += s.spend; ketQua += s.results
            if (s.spend > 0) coChi++
        }
    }
    const nk = (await ctx.kho.dsNhatKy(300)).filter(w => w.createdAt >= tu && w.createdAt < dau && w.status === 'succeeded' && ['boost', 'resume', 'budget', 'pause'].includes(w.action))
    if (!(chi > 0) && !nk.length) return { ngay, title: null, message: null }
    const keHoach = new Map((await ctx.kho.dsKeHoachLoai(['boost', 'resume', 'budget', 'pause'], tu - 30 * NGAY)).map(k => [k.id, k]))
    const dem = () => ({ pause: 0, budgetDown: 0, budgetUp: 0, resume: 0, boost: 0 } as Record<string, number>)
    const may = dem(), nguoi = dem()
    for (const w of nk) {
        const k = w.planId ? keHoach.get(w.planId) : undefined
        // tăng hay hạ theo ngân sách SỐNG lúc làm (nhật ký ghi from/to thật), không theo số lúc lập kế hoạch
        const r = w.response || {}
        const tang = r.to != null && r.from != null ? Number(r.to) > Number(r.from) : !!k && laTangChi(k)
        const loai = w.action === 'budget' ? (tang ? 'budgetUp' : 'budgetDown') : w.action
        const o = k?.result?.tuDong === true ? may : nguoi
        o[loai] = (o[loai] || 0) + 1
    }
    const ke = (o: Record<string, number>) => Object.entries(o).filter(([, n]) => n > 0).map(([k, n]) => `${TEN_VIEC_BAO_CAO[k]} ${n}`).join(', ')
    const message = [
        `Quảng cáo Pilot chi ${vnd(chi)}${coChi ? ` (${coChi} quảng cáo)` : ''}, ${ketQua} bình luận / tin nhắn${ketQua > 0 ? ` — ${vnd(chi / ketQua)} mỗi kết quả` : ''}.`,
        ke(may) ? `Máy tự: ${ke(may)}.` : 'Máy không tự thao tác gì.',
        ke(nguoi) ? `Người làm (web / trợ lý AI): ${ke(nguoi)}.` : '',
        `Hiện ${hienTai.soChay} quảng cáo đang chạy, ${vnd(hienTai.nganSach)}/ngày (trần ${vnd(pol.dailyBudgetCap)}/ngày).`,
    ].filter(Boolean).join(' ')
    return { ngay, title: `Ads Pilot: báo cáo chi hôm qua ${ngayThang}/${thang}`, message: message.slice(0, 500) }
}

/** `o.baoCaoNgayCu` — CHỈ lượt chạy theo lịch truyền (ngày đã gửi báo cáo chi gần nhất, null = chưa bao giờ): tới giờ thì kèm báo cáo. */
export async function chayChuKyAds(ctx: NgCanhAds, o: { baoCaoNgayCu?: string | null } = {}): Promise<any> {
    const now = luc(ctx)
    const cfg = await docCauHinhAds(ctx)
    const pol = cfg.policy
    const tok = await canTokenAds(ctx, cfg)
    const svc = dichVuAds(ctx, tok.accessToken)
    const results: any[] = []
    const thucThiMay = cfg.mode !== 'preview'
    const daBao = new Set<string>()

    const dut = await ctx.kho.quetDangChay(now - 30 * 60_000, 'Thao tác dừng giữa chừng quá 30 phút (máy chủ khởi động lại?) — mở Trình quản lý quảng cáo kiểm tra trước khi lập lại.')
    if (dut) results.push({ action: 'ads', status: 'uncertain', message: `${dut} thao tác quảng cáo dừng giữa chừng — mở Trình quản lý quảng cáo kiểm tra.` })
    for (const k of await ctx.kho.dsKeHoachLoai(['boost', 'resume', 'budget'], now - 30 * NGAY)) {
        if (k.status === 'draft' && laMay(k) && now - k.createdAt > NHAP_MAY_HET_HAN) await ctx.kho.huyKeHoach(k.id)
    }
    if (tok.expiresAt && tok.expiresAt - now < 7 * NGAY) {
        results.push({ action: 'token', status: 'skipped', message: `Token quảng cáo còn khoảng ${Math.max(0, Math.floor((tok.expiresAt - now) / NGAY))} ngày — dán token mới ở tab Quảng cáo trước khi hết hạn, kẻo Pilot không tạm dừng được quảng cáo hết hàng.` })
    }

    let lyDoTk: string | null = null
    if (cfg.adAccountId) {
        // 09/11/2026: đọc tài khoản hỏng KHÔNG làm gãy chu kỳ (trước đây ném ở đây ⇒ không tạm dừng được quảng cáo nào) —
        // chưa đọc được thì coi như tài khoản không cho TĂNG chi; tạm dừng không cần tài khoản
        try { lyDoTk = lyDoTaiKhoanKhongTangChi(await docTaiKhoan(svc, cfg.adAccountId)) } catch (e: any) {
            lyDoTk = `Không đọc được tài khoản quảng cáo ${cfg.adAccountId}: ${moTaLoi(e)} — lượt này không bật quảng cáo mới (vẫn tạm dừng được).`
        }
        if (lyDoTk) results.push({ action: 'account', status: 'failed', message: lyDoTk })
    }

    const { ads, liveError, statsError, viec } = await docQuangCaoPilot(ctx, svc, now, { soLieu: true })
    /* 09/11/2026 — chiến dịch không đọc được KHÔNG làm gãy chu kỳ nữa. Trước đây ném ngay ở đây, TRƯỚC vòng tạm dừng ⇒ một chiến
     * dịch lỗi #17 / mất quyền làm mọi quảng cáo hết hàng (đọc được) chạy tiếp tiêu tiền. Giờ liveError CHỈ chặn việc TĂNG chi
     * (chạy lại, tăng ngân sách, quảng cáo mới); tạm dừng vẫn chạy cho mọi chiến dịch đọc được. Chiến dịch không đọc được: trạng
     * thái null — vẫn chiếm trần (dangChiemTran), mỗi cái một dòng việc cần người. */
    const khongDoc = ads.filter(a => a.status === null)
    for (const a of khongDoc.slice(0, 5)) {
        results.push({
            action: 'ads', status: 'failed', sku: a.sku, planId: a.planId,
            message: `${a.name || a.campaignId}: không đọc được chiến dịch ${a.campaignId} trên Facebook (${String(a.readError || liveError).slice(0, 200)}) — lượt này Pilot không bật / tăng chi quảng cáo nào; kiểm trong Trình quản lý quảng cáo, cần dừng ngay thì bấm Tạm dừng.`,
        })
    }
    if (khongDoc.length > 5) results.push({ action: 'ads', status: 'failed', message: `… và ${khongDoc.length - 5} chiến dịch Pilot nữa không đọc được trên Facebook.` })
    if (statsError) results.push({ action: 'ads', status: 'failed', message: `${statsError} — lượt này chỉ soát kho (hết hàng / đổi giá), chưa soát chi tiêu.` })

    /** `vuaLam` = chính lượt này vừa thực thi kế hoạch ⇒ thành công + tăng chi thì dòng mang `tienMay` (AD-10: báo chủ shop ngay). */
    const ghiBuoc = (action: string, p: any, sku: string | null, message: string, vuaLam = false) => {
        const k = p?.plan || p
        if (k?.id) daBao.add(k.id)
        const cho = k?.status === 'draft' && cfg.mode === 'approve' && laTangChi(k) ? ` — ${CHO_DUYET}: ${TEN_VIEC[k.kind] || 'tăng chi'}` : ''
        results.push({
            action, status: k?.status, sku, planId: k?.id, message: `${message}${cho}${k?.result?.message ? ` — ${k.result.message}` : ''}`,
            ...(vuaLam && k?.status === 'succeeded' && laTangChi(k) && !k?.result?.alreadyActive ? { tienMay: true } : {}),
        })
    }
    /** Nháp máy ⇒ thực thi nếu chế độ cho (thucThiAds tự giữ việc tăng chi lại ở 'approve'), rồi ghi một dòng. */
    const lam = async (action: string, p: KeHoachAds, sku: string | null, message: string): Promise<KeHoachAds> => {
        const chay = thucThiMay && p.status === 'draft'
        const r = chay ? await thucThiAds(ctx, p.id, { tuDong: true }) : p
        ghiBuoc(action, r, sku, message, chay)
        return r?.plan || r
    }
    // chỗ trống trong trần cho việc tăng chi máy định làm lượt này (tính dần, kẻo nhiều việc cùng lọt)
    let { soChay, nganSach } = dangChiemTran(ads)
    /** số THẬT đang chạy: chỉ cộng / trừ việc đã xong trên Facebook (soChay / nganSach còn giữ chỗ cho nháp chờ duyệt) — cho tin báo chủ shop */
    const soThat = { soChay, nganSach }
    /** AD-11: quảng cáo đang bật mà Facebook từ chối / có vấn đề ⇒ việc cần người (máy không tự tắt: tắt cũng không đỡ đồng nào). */
    const baoQcVanDe = (a: QuangCaoPilot) => {
        if (!a.deliveryIssue) return
        results.push({
            action: 'ads', status: 'failed', sku: a.sku, planId: a.planId,
            message: `${a.name || a.campaignId}: ${a.deliveryIssue} — quảng cáo không phân phối nhưng vẫn giữ chỗ trong trần; sửa trong Trình quản lý quảng cáo, hoặc bấm Tạm dừng để trả chỗ.`,
        })
    }

    for (const a of ads) {
        const ds = viec.get(a.campaignId) || []
        const cuaMay = (kind: string, loc: (k: KeHoachAds) => boolean = () => true) => ds.filter(k => k.kind === kind && laMay(k) && loc(k))
        try {
            if (a.running) {
                const ly = lyDoDung(a, pol, !statsError)
                if (ly) {
                    if (a.humanOverride.includes(ly.reason)) {
                        results.push({ action: 'pause', status: 'skipped', sku: a.sku, message: `${a.name}: ${ly.text} — có người bật lại sau khi Pilot tạm dừng, Pilot không tự tắt lại.` })
                        baoQcVanDe(a)
                        continue
                    }
                    const cungLyDo = cuaMay('pause', k => k.data?.reason === ly.reason)
                    const cu = cungLyDo[0] || null
                    if (cu?.status === 'running' || cu?.status === 'cancelled') continue // đang làm ở lượt khác / người đã bỏ đề xuất này
                    // nháp cũ (Xem trước) ⇒ dùng lại; hỏng / không rõ / máy đã tự chạy lại sau lần dừng trước ⇒ lập lần mới (khoá mới)
                    const p = cu?.status === 'draft' ? cu : await taoKeHoachDung(ctx, {
                        campaignId: a.campaignId, reason: ly.reason, reasonText: ly.text, idempotencyKey: `cycle:pause:${a.campaignId}:${ly.reason}:${cungLyDo.length}`,
                    })
                    const k = await lam('pause', p, a.sku, `${a.name}: ${ly.text}`)
                    if (k?.status === 'succeeded') { soChay--; nganSach -= a.dailyBudget; soThat.soChay--; soThat.nganSach -= a.dailyBudget }
                    continue
                }
                if (a.deliveryIssue) { baoQcVanDe(a); continue }
                const moi = statsError ? null : nganSachTang(a, pol)
                if (moi !== null && a.adsetId) {
                    if (liveError) {
                        results.push({ action: 'budget', status: 'unchanged', sku: a.sku, message: `${a.name}: quảng cáo tốt nhưng còn chiến dịch Pilot không đọc được (trần có thể đang đếm thiếu) — lượt này không tăng ngân sách.` })
                        continue
                    }
                    const nhap = cuaMay('budget', k => k.status === 'draft')[0] || null
                    const khoa = `cycle:budget:${a.adsetId}:${ngayVN(now)}`
                    if (!nhap && ds.some(k => k.idempotencyKey === khoa)) continue // hôm nay máy đã tăng / đã thử
                    if (!nhap && nganSach - a.dailyBudget + moi > pol.dailyBudgetCap) {
                        results.push({ action: 'budget', status: 'unchanged', sku: a.sku, message: `${a.name}: quảng cáo tốt nhưng tăng lên ${vnd(moi)}/ngày sẽ vượt trần ${vnd(pol.dailyBudgetCap)}/ngày — giữ nguyên.` })
                        continue
                    }
                    // nganSachTang đã bắt CẢ trọn đời lẫn gần đây tốt ⇒ ghi số GẦN ĐÂY (cái người cần thấy để tin việc tăng chi hôm nay)
                    const R = a.recent
                    const soGanDay = `${R.results} kết quả ${GAN_DAY}, ${vnd(R.spend / Math.max(1, R.results))} mỗi kết quả; trọn đời ${a.life.results} kết quả`
                    const p = nhap || await taoKeHoachNganSach(ctx, {
                        campaignId: a.campaignId, dailyBudget: moi, from: a.dailyBudget,
                        reasonText: `Quảng cáo tốt: ${soGanDay}`, idempotencyKey: khoa,
                    })
                    const to = Number(p.data?.to) || moi
                    const k = await lam('budget', p, a.sku, `${a.name}: tăng ngân sách ${vnd(a.dailyBudget)} → ${vnd(to)}/ngày (${soGanDay})`)
                    if (k?.status === 'succeeded' || k?.status === 'draft') nganSach += to - a.dailyBudget
                    if (k?.status === 'succeeded') soThat.nganSach += to - a.dailyBudget
                }
            } else if (nenChayLai(a, pol)) {
                if (liveError) {
                    results.push({ action: 'resume', status: 'unchanged', sku: a.sku, message: `${a.name}: có hàng lại (tồn ${a.product!.stock}) nhưng còn chiến dịch Pilot không đọc được (trần có thể đang đếm thiếu) — lượt này không chạy lại.` })
                    continue
                }
                const lanDung = ds.find(k => k.status === 'succeeded')!
                const sauDung = cuaMay('resume', k => k.createdAt > lanDung.createdAt)
                const cu = sauDung[0] || null
                if (cu?.status === 'running' || cu?.status === 'cancelled') continue
                if (cu?.status === 'failed' && now - cu.createdAt < NGAY) continue // hỏng rồi (đã báo) ⇒ mai thử lại, không lặp mỗi lượt
                if (!(cu?.status === 'draft') && (soChay >= pol.maxActiveAds || nganSach + a.dailyBudget > pol.dailyBudgetCap)) {
                    results.push({ action: 'resume', status: 'unchanged', sku: a.sku, message: `${a.name}: có hàng lại (tồn ${a.product!.stock}) nhưng hết chỗ trong trần (${soChay}/${pol.maxActiveAds} quảng cáo, ${vnd(nganSach)}/${vnd(pol.dailyBudgetCap)} mỗi ngày) — để tạm dừng.` })
                    continue
                }
                const p = cu?.status === 'draft' ? cu : await taoKeHoachChayLai(ctx, {
                    campaignId: a.campaignId, reasonText: `Có hàng lại: tồn ${a.product!.stock}`, idempotencyKey: `cycle:resume:${a.campaignId}:${cuaMay('resume').length}`,
                })
                const k = await lam('resume', p, a.sku, `${a.name}: có hàng lại (tồn ${a.product!.stock}) — chạy lại quảng cáo`)
                if (k?.status === 'succeeded' || k?.status === 'draft') { soChay++; nganSach += a.dailyBudget }
                // alreadyActive (ai đó vừa bật trước máy) vẫn cộng: cuối lượt nó ĐANG chạy — chỉ là không phải máy tiêu thêm (không tienMay)
                if (k?.status === 'succeeded') { soThat.soChay++; soThat.nganSach += a.dailyBudget }
            }
        } catch (e: any) {
            results.push({ action: 'ads', status: 'failed', sku: a.sku, message: `${a.name}: ${String(e?.message || e).slice(0, 300)}` })
        }
    }

    if (pol.automation.boostNewPosts) {
        if (!cfg.adAccountId) {
            results.push({ action: 'boost', status: 'skipped', message: 'Chưa chọn tài khoản quảng cáo — Pilot không lập quảng cáo mới.' })
        } else if (lyDoTk) { /* đã báo ở dòng tài khoản */ } else if (!(pol.dailyBudgetCap > 0)) {
            results.push({ action: 'boost', status: 'skipped', message: 'Chưa đặt trần ngân sách/ngày — Pilot không lập quảng cáo mới.' })
        } else if (pol.maxActiveAds <= 0) {
            results.push({ action: 'boost', status: 'skipped', message: 'Chính sách cho 0 quảng cáo chạy cùng lúc — Pilot không lập quảng cáo mới.' })
        } else if (liveError) {
            results.push({ action: 'boost', status: 'skipped', message: 'Còn chiến dịch Pilot không đọc được (trần có thể đang đếm thiếu) — lượt này không lập quảng cáo mới.' })
        } else {
            // đọc lại sau các bước ở trên (đã tạm dừng / chạy lại thật) cho đúng chỗ còn trống
            const sau = thucThiMay ? await docQuangCaoPilot(ctx, svc, now, { soLieu: false }) : null
            const dang = sau ? dangChiemTran(sau.ads) : { soChay, nganSach }
            const nhap = (await ctx.kho.dsKeHoachLoai(['boost'], now - 30 * NGAY)).filter(k => k.status === 'draft')
            let cho = pol.maxActiveAds - dang.soChay - nhap.length
            let du = pol.dailyBudgetCap - dang.nganSach - nhap.reduce((s, k) => s + (Number(k.data?.dailyBudget) || 0), 0)
            if (sau?.liveError) {
                // 09/11/2026: không ném nữa — các bước tạm dừng ở trên đã xong; chỉ việc lập quảng cáo mới (TĂNG chi) dừng lại
                results.push({ action: 'boost', status: 'skipped', message: `Đọc lại quảng cáo Pilot không được (${sau.liveError}) — lượt này không lập quảng cáo mới.` })
            } else if (cho <= 0 || du < pol.budgetPerAd) {
                results.push({ action: 'boost', status: 'unchanged', message: `Hết chỗ cho quảng cáo mới: ${dang.soChay}/${pol.maxActiveAds} đang chạy, ${vnd(dang.nganSach)}/${vnd(pol.dailyBudgetCap)} ngân sách/ngày${nhap.length ? `, ${nhap.length} nháp chờ duyệt` : ''}.` })
            } else {
                const page = await canPageAds(ctx)
                const uv = await timBaiDeDay(ctx, cfg, page, now, { tuongTac: true })
                let lap = 0
                for (const b of uv.list) {
                    if (cho <= 0 || du < pol.budgetPerAd) break
                    if (b.reason || b.autoBlock) continue
                    try {
                        const p = await lapKeHoachDayTuBai(ctx, cfg, page, b, { idempotencyKey: `cycle:boost:${b.postId}` }, now)
                        if (p.status !== 'draft' || p.createdAt !== now) continue // bài này máy đã đề xuất (người huỷ / đã chạy / đã hỏng) — không đề xuất lại
                        cho--; du -= pol.budgetPerAd; lap++
                        const k = await lam('boost', p, b.sku, `${b.name} · ${vnd(pol.budgetPerAd)}/ngày × ${pol.days} ngày`)
                        if (k?.status === 'succeeded') { soThat.soChay++; soThat.nganSach += Number(k.data?.dailyBudget) || pol.budgetPerAd }
                    } catch (e: any) {
                        results.push({ action: 'boost', status: 'failed', sku: b.sku, message: String(e?.message || e).slice(0, 300) })
                    }
                }
                if (!lap) {
                    const chan = uv.list.filter(b => b.reason || b.autoBlock).length
                    results.push({ action: 'boost', status: 'unchanged', message: uv.list.length ? `Soát ${uv.list.length} bài sản phẩm chưa quảng cáo: ${chan} chưa đủ điều kiện máy tự đẩy (tồn / giá / giá vốn / lãi gộp), còn lại máy đã đề xuất trước đây.` : `Không có bài sản phẩm nào đăng trong ${pol.postMaxAgeDays} ngày qua mà chưa quảng cáo.` })
                }
            }
        }
    }
    // nháp tăng chi máy lập ở lượt TRƯỚC còn chờ ⇒ nhắc lại (danh sách việc cần người giữ nguyên ⇒ chuông không báo lặp)
    if (cfg.mode === 'approve') {
        for (const k of await ctx.kho.dsKeHoachLoai(['boost', 'resume', 'budget'], now - 30 * NGAY)) {
            if (k.status !== 'draft' || !laMay(k) || daBao.has(k.id)) continue
            results.push({ action: k.kind, status: 'draft', sku: k.data?.sku || null, planId: k.id, message: `${k.data?.name || k.data?.sku || ''} — ${CHO_DUYET}: ${TEN_VIEC[k.kind] || 'tăng chi'}` })
        }
    }
    if (!results.length) {
        results.push({ action: 'cycle', status: 'unchanged', message: ads.length ? `Soát ${ads.length} quảng cáo Pilot (${ads.filter(a => a.running).length} đang chạy): không có gì cần làm.` : 'Chưa có quảng cáo Pilot nào. Đẩy bài ở mục "Bài nên đẩy", hoặc bật "Tự lập quảng cáo cho bài mới" trong chính sách.' })
    }
    let baoCaoNgay: BaoCaoNgayAds | null = null
    if (o.baoCaoNgayCu !== undefined && o.baoCaoNgayCu !== ngayVN(now) && gioVN(now) >= GIO_BAO_CAO) {
        try { baoCaoNgay = await baoCaoChiHomQua(ctx, svc, ads, pol, now, soThat) } catch { /* đọc số hỏng ⇒ lượt sau thử lại */ }
    }
    // tongChay: số THẬT đang chạy SAU lượt này (không tính chỗ giữ cho nháp chờ duyệt)
    return { mode: cfg.mode, results, tongChay: { soChay: soThat.soChay, nganSach: soThat.nganSach, tran: pol.dailyBudgetCap }, ...(baoCaoNgay ? { baoCaoNgay } : {}) }
}

// ─── Kết nối token ──────────────────────────────────────────────────────────────

/**
 * Nối token quảng cáo (dán tay): kiểm là USER token, đọc quyền + hạn (debug_token, hỏng thì /me/permissions), đọc tài khoản
 * quảng cáo, rồi lưu FbUserToken kèm quyền. Không bao giờ trả token về.
 */
export async function noiTokenAds(ctx: NgCanhAds, b: { accessToken: string }): Promise<any> {
    const now = luc(ctx)
    const token = String(b?.accessToken || '').trim()
    if (token.length < 20 || /\s/.test(token)) throw new ToolError('Dán token quảng cáo (một chuỗi liền, thường bắt đầu bằng EAA…).')
    const svc = dichVuAds(ctx, token)
    let me: any
    try { me = await svc.get('me', { metadata: 1, fields: 'id,name' }) } catch (e: any) { throw new ToolError(`Token không dùng được: ${moTaLoi(e)}`) }
    const loai = String(me?.metadata?.type || '').toLowerCase()
    if (loai === 'page') {
        throw new ToolError('Đây là PAGE token (token của fanpage) — quảng cáo cần USER token: trong Graph API Explorer để ô "User or Page" là User Token, tick quyền ads_read + ads_management rồi Generate.')
    }
    let scopes: string[] = [], hetHan: number | null = null, docDuocQuyen = false
    try {
        const dbg = (await svc.get('debug_token', { input_token: token }))?.data || {}
        if (Array.isArray(dbg.scopes)) { scopes = dbg.scopes.map(String); docDuocQuyen = true }
        if (Number(dbg.expires_at) > 0) hetHan = Number(dbg.expires_at) * 1000
    } catch { /* debug_token đòi token của nhà phát triển app — không được thì đọc /me/permissions */ }
    if (!docDuocQuyen) {
        try {
            const p = await svc.get('me/permissions')
            scopes = (p?.data || []).filter((x: any) => x?.status === 'granted').map((x: any) => String(x.permission))
            docDuocQuyen = true
        } catch { /* system user token có thể không đọc được — để Facebook tự từ chối khi thiếu quyền */ }
    }
    if (docDuocQuyen && !scopes.includes('ads_management') && !scopes.includes('ads_read')) {
        throw new ToolError(`Token thiếu quyền quảng cáo (đang có: ${scopes.join(', ') || 'không quyền nào'}) — tick ads_read và ads_management rồi tạo lại token.`)
    }
    let ds: TaiKhoanAds[]
    try { ds = await dsTaiKhoan(svc) } catch (e: any) { throw new ToolError(`Token không đọc được tài khoản quảng cáo: ${moTaLoi(e)}`) }
    if (!ds.length) throw new ToolError('Tài khoản Facebook của token này không quản lý tài khoản quảng cáo nào.')

    const fbUserId = String(me?.id || '')
    if (!fbUserId) throw new ToolError('Facebook không trả mã tài khoản của token.')
    // '["?"]' = không đọc được quyền — vẫn ghi KHÁC rỗng để fanpageCron không lấy token này chữa page token (tokenChuaDuocPage)
    const scopesLuu = JSON.stringify(docDuocQuyen ? scopes : ['?'])
    await ctx.prisma.fbUserToken.upsert({
        where: { fbUserId },
        create: { fbUserId, name: me?.name || null, accessToken: token, scopes: scopesLuu, tokenExpiresAt: hetHan ? new Date(hetHan) : null, connectedBy: ctx.nguoi ? String(ctx.nguoi).slice(0, 100) : null },
        update: { name: me?.name || null, accessToken: token, scopes: scopesLuu, tokenExpiresAt: hetHan ? new Date(hetHan) : null },
    })
    const cfg = await docCauHinhAds(ctx)
    // tài khoản đang chọn không thuộc token mới ⇒ một tài khoản thì chọn luôn, nhiều thì để người chọn (quảng cáo Pilot
    // trên tài khoản cũ vẫn được soát — docQuangCaoPilot đọc mọi tài khoản Pilot từng dùng)
    let adAccountId = cfg.adAccountId
    if (!adAccountId || !ds.some(a => a.id === adAccountId)) adAccountId = ds.length === 1 ? ds[0].id : null
    await ctx.kho.luuCauHinh({ ...cfg, adAccountId, fbUserId })
    const t: TokenAds = { fbUserId, name: me?.name || null, accessToken: token, scopes: docDuocQuyen ? scopes : [], expiresAt: hetHan }
    return { token: tokenAnToan(t, now), adAccounts: ds, adAccountId }
}

/** Kiểm tra kết nối quảng cáo — chỉ đọc. Cùng khuôn kiemKetNoiFb ({ dat, tong, buoc }). */
export async function kiemKetNoiAds(ctx: NgCanhAds): Promise<any> {
    const now = luc(ctx)
    const cfg = await docCauHinhAds(ctx)
    const tok = await canTokenAds(ctx, cfg)
    const svc = dichVuAds(ctx, tok.accessToken)
    const buoc: { ten: string; ok: boolean; chiTiet: string }[] = []
    const thu = async (ten: string, f: () => Promise<string>) => {
        try { buoc.push({ ten, ok: true, chiTiet: await f() }) } catch (e: any) { buoc.push({ ten, ok: false, chiTiet: moTaLoi(e) }) }
    }
    await thu('Token là USER token còn dùng được', async () => {
        const me = await svc.get('me', { metadata: 1, fields: 'id,name' })
        if (String(me?.metadata?.type || '').toLowerCase() === 'page') throw new Error('Đây là page token, không chạy quảng cáo được.')
        return me?.name || String(me?.id || '')
    })
    buoc.push(tok.scopes.length
        ? { ten: 'Quyền quảng cáo (ads_management)', ok: tok.scopes.includes('ads_management'), chiTiet: tok.scopes.includes('ads_management') ? 'Có quyền tạo / sửa quảng cáo.' : `Thiếu ads_management (đang có: ${tok.scopes.join(', ')}) — chỉ đọc được số.` }
        : { ten: 'Quyền quảng cáo (ads_management)', ok: true, chiTiet: 'Không đọc được danh sách quyền — Facebook sẽ báo nếu thiếu.' })
    let tk: TaiKhoanAds | null = null
    if (!cfg.adAccountId) buoc.push({ ten: 'Tài khoản quảng cáo', ok: false, chiTiet: 'Chưa chọn tài khoản quảng cáo — chọn ở Chính sách quảng cáo.' })
    else {
        await thu('Tài khoản quảng cáo đang hoạt động', async () => {
            tk = await docTaiKhoan(svc, cfg.adAccountId!)
            if (tk.status !== 1 && tk.status !== 201) throw new Error(`"${tk.name}" đang ${tk.statusText}.`)
            return `${tk.name} (${tk.id})`
        })
        buoc.push(tk
            ? { ten: 'Tiền tệ VND', ok: (tk as TaiKhoanAds).currency === 'VND', chiTiet: (tk as TaiKhoanAds).currency === 'VND' ? 'Ngân sách tính bằng đồng.' : `Tài khoản tính bằng ${(tk as TaiKhoanAds).currency} — Ads Pilot chỉ đặt ngân sách bằng VND.` }
            : { ten: 'Tiền tệ VND', ok: false, chiTiet: 'Chưa đọc được tài khoản.' })
        await thu('Đọc số liệu quảng cáo (Insights)', async () => {
            const r = await svc.get(`${cfg.adAccountId}/insights`, { level: 'account', date_preset: 'last_7d', fields: 'spend' })
            const chi = Number(r?.data?.[0]?.spend) || 0
            const tienTe = (tk as TaiKhoanAds | null)?.currency
            // Insights trả số theo tiền tệ của tài khoản — tài khoản USD mà ghi "đ" là đọc sai số tiền
            return `7 ngày qua chi ${!tienTe || tienTe === 'VND' ? vnd(chi) : `${chi.toLocaleString('vi-VN')} ${tienTe}`}`
        })
    }
    await thu('Fanpage của Facebook Pilot (page token còn dùng được)', async () => (await canPageAds(ctx, { canToken: true })).name)
    buoc.push(tok.expiresAt
        ? { ten: 'Hạn token', ok: tok.expiresAt - now > 7 * NGAY, chiTiet: `còn khoảng ${Math.max(0, Math.floor((tok.expiresAt - now) / NGAY))} ngày (token dán tay không tự gia hạn)` }
        : { ten: 'Hạn token', ok: true, chiTiet: 'không ghi hạn (token không hết hạn, hoặc Facebook không cho đọc hạn)' })
    return { page: tok.name || 'Token quảng cáo', dat: buoc.filter(x => x.ok).length, tong: buoc.length, buoc }
}

// ─── Cấu hình ───────────────────────────────────────────────────────────────────

export async function luuCauHinhAds(ctx: NgCanhAds, b: any): Promise<CauHinhAds> {
    const cfg = await docCauHinhAds(ctx)
    let adAccountId = cfg.adAccountId
    if (b?.adAccountId !== undefined) {
        const moi = b.adAccountId ? chuanAct(b.adAccountId) : null
        if (b.adAccountId && !moi) throw new ToolError('Mã tài khoản quảng cáo không đúng dạng act_<số>.')
        if (moi && moi !== cfg.adAccountId) {
            const tok = await canTokenAds(ctx, cfg)
            const ds = await dsTaiKhoan(dichVuAds(ctx, tok.accessToken)).catch((e: any) => { throw new ToolError(`Không đọc được tài khoản quảng cáo: ${moTaLoi(e)}`) })
            if (!ds.some(a => a.id === moi)) throw new ToolError('Tài khoản quảng cáo không thuộc token đang nối.')
        }
        adAccountId = moi
    }
    const mode: CheDoAds = CHE_DO.includes(b?.mode) ? b.mode : cfg.mode
    const policy = chuanHoaChinhSachAds({ ...cfg.policy, ...(b?.policy || {}), automation: { ...cfg.policy.automation, ...(b?.policy?.automation || {}) } })
    const schedule = b?.schedule ? chuanHoaLichAds({ ...cfg.schedule, ...b.schedule }) : cfg.schedule
    /* Lịch bật mới / đổi nhịp ⇒ lượt kế = bây giờ + nhịp. Giữ nguyên ⇒ giữ lượt đã hẹn. Tắt ⇒ bỏ hẹn. */
    const doiLich = schedule.enabled !== cfg.schedule.enabled || schedule.intervalMinutes !== cfg.schedule.intervalMinutes
    const nextRunAt = !schedule.enabled ? null : (!doiLich && cfg.nextRunAt) ? cfg.nextRunAt : luc(ctx) + schedule.intervalMinutes * 60_000
    const moi: CauHinhAds = { ...cfg, adAccountId, mode, policy, schedule, nextRunAt, updatedAt: Date.now() }
    await ctx.kho.luuCauHinh(moi)
    // X-14: ai đổi gì (trần ngân sách = tiền thật) — dòng sổ 'config', không tính vào trần thao tác / ngày
    await ghiDoiCauHinh(ctx.kho, {
        nguoi: ctx.nguoi, nhan: NHAN_ADS,
        cu: { mode: cfg.mode, adAccountId: cfg.adAccountId, policy: cfg.policy, schedule: cfg.schedule },
        moi: { mode, adAccountId, policy, schedule },
    })
    // tài khoản mặc định của fanpage Pilot — Fanpage Manager / công cụ MCP quảng cáo cùng mặc định (best-effort)
    if (adAccountId && adAccountId !== cfg.adAccountId) {
        const page = await docCauHinhFb(ngCanhFb(ctx)).then(r => r.page).catch(() => null)
        if (page) await ctx.prisma.fbPage.update({ where: { pageId: page.pageId }, data: { adAccountId } }).catch(() => { })
    }
    return moi
}

// ─── Trạng thái cho giao diện (GET /ads/state) ─────────────────────────────────

export async function xayTrangThaiAds(ctx: NgCanhAds): Promise<any> {
    const now = luc(ctx)
    const cfg = await docCauHinhAds(ctx)
    // TUẦN TỰ có chủ ý: pool Prisma của cửa hàng chỉ 1 kết nối trên prod
    const plans = await ctx.kho.dsKeHoach(60)
    const audit = await ctx.kho.dsNhatKy(80)
    const todayActions = await ctx.kho.demGhiTuLuc(dauNgayVN(now))
    const tok = await docTokenAds(ctx.prisma, cfg.fbUserId)
    const fb = await docCauHinhFb(ngCanhFb(ctx)).catch(() => null)
    const page = fb?.page || null
    const status: any = {
        mode: cfg.mode, policy: cfg.policy, adAccountId: cfg.adAccountId,
        schedule: { ...cfg.schedule, nextRunAt: cfg.nextRunAt, lastRunAt: cfg.lastRunAt, lastResult: cfg.lastResult },
        token: tokenAnToan(tok, now), page: page ? { pageId: String(page.pageId), name: page.name, status: page.status } : null,
    }
    const goc: any = { now, todayActions, plans, audit, status, accounts: [], account: null, ads: [], totals: null, account7d: null, candidates: [], liveError: null, statsError: null }
    if (!page) status.notice = fb?.pages?.length ? 'Chọn fanpage cho Facebook Pilot trước (Tự động hóa → Sửa chính sách) — quảng cáo đẩy bài của fanpage đó.' : 'Cửa hàng chưa nối fanpage — dán page token ở tab Kết nối trước.'
    else if (!tok) status.notice = CHUA_NOI_TOKEN
    else if (!cfg.adAccountId) status.notice = 'Chọn tài khoản quảng cáo ở Chính sách quảng cáo.'
    else if (tok.expiresAt && tok.expiresAt - now < 7 * NGAY) status.notice = `Token quảng cáo còn khoảng ${Math.max(0, Math.floor((tok.expiresAt - now) / NGAY))} ngày — dán token mới trước khi hết hạn.`

    // Chưa nối / mất token mà còn quảng cáo Pilot ⇒ vẫn liệt kê (trạng thái "không đọc được") — đừng để quảng cáo đang tiêu tiền biến khỏi màn hình
    const svc: DichVuAds = tok ? dichVuAds(ctx, tok.accessToken) : { get: async () => { throw new ToolError(CHUA_NOI_TOKEN) }, post: async () => { throw new ToolError(CHUA_NOI_TOKEN) } }
    if (tok) {
        try { goc.accounts = await dsTaiKhoan(svc) } catch (e: any) { goc.liveError = moTaLoi(e) }
        goc.account = goc.accounts.find((a: TaiKhoanAds) => a.id === cfg.adAccountId) || null
        // Tài khoản đã chọn không bật được quảng cáo (bị khoá / tính bằng USD) ⇒ nói ngay đầu tab, đừng để người lập xong bấm thực thi mới biết
        const lyDoTk = goc.account ? lyDoTaiKhoanKhongTangChi(goc.account) : null
        if (lyDoTk && !status.notice) status.notice = `${lyDoTk} Đổi tài khoản ở Chính sách quảng cáo.`
        else if (cfg.adAccountId && !goc.account && !goc.liveError && !status.notice) status.notice = `Token quảng cáo không thấy tài khoản ${cfg.adAccountId} — người dán token cần quyền trên tài khoản đó, hoặc chọn tài khoản khác ở Chính sách quảng cáo.`
    }
    const r = await docQuangCaoPilot(ctx, svc, now, { soLieu: !!tok, banHang: true })
    goc.ads = r.ads
    goc.liveError = goc.liveError || (tok ? r.liveError : null)
    goc.statsError = tok ? r.statsError : null
    if (tok && cfg.adAccountId) {
        try {
            const t7 = await svc.get(`${cfg.adAccountId}/insights`, { level: 'account', date_preset: 'last_7d', fields: 'spend,impressions,reach,clicks,actions' })
            goc.account7d = docSoLieu(t7?.data?.[0])
        } catch (e: any) { goc.statsError = goc.statsError || `Số liệu 7 ngày: ${moTaLoi(e)}` }
    }
    if (goc.ads.length) {
        const { soChay, nganSach } = dangChiemTran(goc.ads)
        goc.totals = {
            running: soChay, committedDaily: nganSach,
            spendToday: goc.ads.reduce((s: number, a: QuangCaoPilot) => s + a.today.spend, 0),
            spendLife: goc.ads.reduce((s: number, a: QuangCaoPilot) => s + a.life.spend, 0),
            results: goc.ads.reduce((s: number, a: QuangCaoPilot) => s + a.life.results, 0),
        }
    }
    if (page) {
        try { goc.candidates = (await timBaiDeDay(ctx, cfg, page, now, { tuongTac: true })).list.slice(0, 30) } catch (e: any) {
            console.error('[AdsPilot] tìm bài nên đẩy lỗi:', e?.message || e)
        }
    }
    return goc
}

// ─── Chạy theo lịch (gọi từ cron/aiAgentCron) ───────────────────────────────────

/**
 * Chạy MỘT chu kỳ quảng cáo nếu tới hẹn. Cửa hàng chưa từng dùng Ads Pilot ⇒ bảng không có ⇒ im lặng 'khong-dung'
 * (KHÔNG tạo bảng hộ). Giành lượt bằng cách dời nextRunAt nguyên tử — nhiều bản máy chỉ một bản chạy.
 */
export async function chayTheoLichAds(prisma: any, kho?: KhoAds, ngoai: Partial<NgCanhAds> = {}): Promise<'khong-dung' | 'chua-toi' | 'bi-gianh' | 'da-chay' | 'loi'> {
    const now = ngoai.bayGio ? ngoai.bayGio() : Date.now()
    let den: number, lich: LichAds
    if (kho) {
        const c = await kho.docCauHinh()
        if (!c || c.nextRunAt == null) return 'khong-dung'
        den = c.nextRunAt; lich = c.schedule
    } else {
        let r: any
        try {
            [r] = await prisma.$queryRawUnsafe(`SELECT "nextRunAt"::float8 AS "nextRunAt", schedule FROM "FacebookAdsPilotConfig" WHERE id = 'default'`)
        } catch {
            return 'khong-dung'
        }
        if (!r || r.nextRunAt == null) return 'khong-dung'
        den = Number(r.nextRunAt); lich = chuanHoaLichAds(docJson(r.schedule, {}))
    }
    if (!lich.enabled) return 'khong-dung'
    if (den > now) return 'chua-toi'
    const k = kho || khoSqlAds(prisma)
    if (!(await k.gianhLich(den, now + lich.intervalMinutes * 60_000))) return 'bi-gianh'
    const cuoi = (await k.docCauHinh().catch(() => null))?.lastResult
    const truoc = cuoi?.baoChuShop
    const baoCaoCu: string | null = typeof cuoi?.baoCaoNgay === 'string' ? cuoi.baoCaoNgay : null
    let ketQua: any, kq: any = null
    try {
        kq = await chayChuKyAds({ ...ngoai, prisma, kho: k, nguoi: 'lich' }, { baoCaoNgayCu: baoCaoCu })
        ketQua = { ok: true, mode: kq.mode, results: kq.results }
    } catch (e: any) {
        ketQua = { ok: false, message: String(e?.message || e).slice(0, 500) }
    }
    // Xem trước chưa làm gì ⇒ chỉ chu kỳ gãy + token quảng cáo sắp hết hạn mới báo (ketQuaDeBao, X-09); còn lại báo mọi việc cần người
    const bao = await baoChuShop(prisma, 'Ads Pilot', ketQuaDeBao(ketQua, ketQua.mode === 'preview'), truoc, now, ngoai.guiDay).catch(() => truoc)
    // AD-10: máy vừa tự tăng chi (Tự động) ⇒ một tin NGAY, ngoài dấu chống lặp; báo cáo chi hôm qua mỗi ngày một tin
    let baoCaoNgay = baoCaoCu
    if (kq) {
        const t = kq.tongChay
        const duoi = t ? `sau lượt này ${t.soChay} quảng cáo đang chạy, ${vnd(t.nganSach)}/ngày (trần ${vnd(t.tran)}/ngày). Muốn máy thôi tự tăng chi: chuyển Ads Pilot sang Duyệt tay.` : ''
        await baoMayTangChi(prisma, 'Ads Pilot', kq.results, duoi, ngoai.guiDay).catch(() => false)
        const bc: BaoCaoNgayAds | undefined = kq.baoCaoNgay
        if (bc && !bc.title) baoCaoNgay = bc.ngay
        else if (bc?.title && await guiTinPilot(prisma, 'Ads Pilot', bc.title, bc.message || '', ngoai.guiDay).then(() => true, () => false)) baoCaoNgay = bc.ngay
    }
    await k.ghiKetQuaLich(now, { ...ketQua, ...(bao ? { baoChuShop: bao } : {}), ...(baoCaoNgay ? { baoCaoNgay } : {}) }).catch(() => { })
    return ketQua.ok ? 'da-chay' : 'loi'
}

export const HUONG_DAN_ADS_PILOT = `ADS PILOT — QUẢNG CÁO FACEBOOK TỰ LÁI (TRONG FACEBOOK PILOT)

Ads Pilot đẩy (boost) các bài sản phẩm Facebook Pilot đã đăng, tự tạm dừng quảng cáo khi hết hàng, đổi giá hoặc tiêu tiền mà
không có khách hỏi — trong trần ngân sách bạn đặt. Số liệu lấy thẳng từ Facebook và kho của cửa hàng.

1. Kết nối quảng cáo
   - Mở kengi.vn → Bán Hàng Online → Facebook Pilot (https://kengi.vn/pilot-facebook/) → tab Quảng cáo.
   - Quảng cáo cần USER token (page token không chạy quảng cáo): Graph API Explorer → chọn app → ô "User or Page" để User Token →
     tick ads_read, ads_management → Generate; rồi Access Token Debugger → Extend để được token ~60 ngày. Hoặc dùng token
     system user trong Business Settings (không hết hạn).
   - Bấm "Dán token quảng cáo", dán token. Máy chủ kiểm là USER token, đọc quyền + tài khoản quảng cáo rồi mới lưu; token không
     bao giờ trả về trình duyệt. Chọn tài khoản quảng cáo ở Chính sách quảng cáo (tài khoản phải tính tiền bằng VND).
   - "Kiểm tra kết nối" gọi chỉ đọc: token, quyền, tài khoản, tiền tệ, số liệu, fanpage, hạn token.

2. Tiền — ba lớp rào
   - Trần ngân sách/ngày: tổng ngân sách các quảng cáo Pilot đang chạy không vượt trần. Mặc định 0 = Pilot KHÔNG bật quảng cáo
     nào, kể cả khi bạn bấm. Facebook có thể chi lệch một ngày (tới ~75% ngân sách ngày) nhưng cả tuần vẫn theo ngân sách.
   - Mỗi quảng cáo: ngân sách/ngày (≥ 30.000đ), số ngày chạy (2–30) — luôn có ngày kết thúc, không chạy mãi.
   - Chế độ: Xem trước (không gọi Facebook) · Duyệt tay (máy chỉ tự TẮT / hạ ngân sách; bật quảng cáo, chạy lại, tăng ngân sách
     chờ bạn bấm) · Tự động (máy làm cả hai, trong trần).
   - Lúc bật, máy chủ đọc SỐNG ngân sách các quảng cáo Pilot đang chạy trên Facebook; đọc không được thì không bật.

3. Bài được đẩy
   - Bài sản phẩm đã LÊN fanpage trong N ngày gần đây (bài Facebook Pilot đăng, hoặc bài Kengi có dòng đầu là tên hàng).
   - Hàng còn tồn ≥ mức tối thiểu, có giá bán, giá trong bài khớp giá kho. Máy TỰ đẩy còn đòi biết giá vốn và lãi gộp ≥ X%
     (giá vốn 0 = chưa biết, không phải lãi 100%) — bạn vẫn lập tay được, kế hoạch mang cảnh báo.
   - Xếp: bán chạy 30 ngày, rồi bài được tương tác tự nhiên nhiều (bình luận, chia sẻ, cảm xúc).
   - Quảng cáo nhắm Việt Nam, tuổi theo chính sách, bảng tin Facebook, tối ưu tương tác bài.

4. Máy tự làm (bật trong chính sách)
   - Tạm dừng khi hết hàng / đổi giá (bài quảng cáo ghi giá cũ) — mặc định BẬT.
   - Tạm dừng khi chi tới mức dừng mà chưa có bình luận / tin nhắn nào, hoặc chi phí mỗi kết quả quá mức — mặc định BẬT.
   - Tự lập quảng cáo cho bài mới — mặc định TẮT. Tăng ngân sách quảng cáo tốt (+20%, cần đặt "chi phí tối đa mỗi kết quả") — TẮT.
     Chạy lại quảng cáo máy đã tạm dừng vì hết hàng khi có hàng lại — TẮT.
   - Bạn bật lại một quảng cáo máy đã tạm dừng ⇒ máy không tự tắt lại vì cùng lý do.
   - Kết quả = bình luận + tin nhắn mới trên quảng cáo. "Bán ra trong lúc chạy" là số bán mọi kênh so với cùng số ngày trước đó —
     để tham khảo, không chắc do quảng cáo.

5. Kế hoạch → thực thi
   - Mọi thao tác (đẩy bài, tạm dừng, chạy lại, đổi ngân sách) tạo KẾ HOẠCH trước; lúc thực thi máy chủ soát lại kho, tài khoản,
     trần. Chiến dịch dựng ở trạng thái tạm dừng rồi mới bật — dựng hỏng giữa chừng thì xoá chiến dịch rỗng, không tiêu tiền.
   - Pilot chỉ đụng quảng cáo do Pilot tạo; chiến dịch bạn tự chạy chỉ hiện số tổng 7 ngày.
   - Chạy theo lịch: bật trong chính sách (mỗi 30–1440 phút), máy chủ tự chạy; nháp chờ duyệt / lần hỏng được báo trên chuông web
     + app Android (nhóm «Pilot tự động», có tiếng từ app 1.0.47; bấm vào mở tab Quảng cáo trên trình duyệt).
   - Mỗi lần máy tự TĂNG chi (bật quảng cáo mới / chạy lại / tăng ngân sách — chỉ ở chế độ Tự động) có một tin báo ngay; mỗi ngày
     (từ 8 giờ sáng) một tin báo cáo chi hôm qua: tiền chi, bình luận / tin nhắn, việc máy tự làm — chỉ khi hôm qua có chi hoặc có
     thao tác.
`
