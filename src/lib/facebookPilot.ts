/* ═══════════════════════════════════════════════════════════════════════════════
 *  FACEBOOK PILOT — tự lên bài sản phẩm + xử lý bình luận fanpage, chạy TRÊN KENGI (02/11/2026)
 *
 *  Chủ shop (sau Shopee Pilot): "Làm thêm facebook pilot nha". Cùng khuôn lib/shopeePilot.ts:
 *  mọi thao tác ghi đi qua KẾ HOẠCH (draft) → THỰC THI; chế độ 'preview' (mặc định) thì thực thi không gọi
 *  Facebook; lịch tự chạy TẮT mặc định; khoá idempotency; giành kế hoạch nguyên tử (draft → running);
 *  trần thao tác ghi mỗi ngày (giờ VN). Dữ liệu lấy từ KHO THẬT + fanpage đã nối ở Kengi (bảng FbPage —
 *  dán page token qua routes/fanpage.ts /connect-page-token):
 *    - bài đăng: hàng hoá còn tồn DƯƠNG, có giá bán, có ảnh JPG/PNG; tên / giá / mô tả / ảnh lấy từ kho,
 *      không bịa. Bài KHÔNG tự ghi "còn hàng" — bài hẹn giờ có thể lên lúc hàng đã hết.
 *    - đăng / hẹn giờ đi đường của Fanpage Manager (FacebookService.createOrSchedulePost) và ghi
 *      FbScheduledPost ⇒ fanpage-manager và cron đối soát (cron/fanpageCron) thấy như mọi bài khác.
 *      Bài có ảnh LUÔN đi kiểu multi_photo (ảnh tải ẩn rồi gắn vào /feed) để mã trả về là mã BÀI
 *      ("<page>_<post>") — đúng mã scheduled_posts và /posts trả, nên đối soát + nối bình luận về mã hàng chạy.
 *    - bình luận: trả lời câu hỏi giá bằng GIÁ THẬT, ẩn bình luận lộ số điện thoại. GIỮ CHỖ trong sổ
 *      FbAutoReplyLog (unique pageId + commentId) TRƯỚC khi gọi Graph — chung sổ với quy tắc tự trả lời
 *      (services/fanpageAutoReply) ⇒ không bao giờ trả lời một bình luận hai lần.
 *  Rào máy chủ chặn (không trông vào giao diện):
 *    - lúc THỰC THI soát lại: hàng còn tồn ≥ mức tối thiểu, giá bán chưa đổi từ lúc lập kế hoạch,
 *      giờ hẹn còn cách ≥ 10 phút (Facebook không nhận gần hơn)
 *    - mỗi ngày (giờ VN) tối đa postsPerDay bài — đếm cả bài Kengi khác đã hẹn — và các bài cách nhau ≥ minGapMinutes
 *    - từ CẤM trong hồ sơ thương hiệu (FbBrandProfile.bannedWords) ⇒ không lập kế hoạch
 *    - máy tự chạy KHÔNG tự trả lời: bình luận đã có người trả lời, bình luận không rõ người viết (token thiếu
 *      quyền đọc người — có thể là chính page), hàng tồn ≤ 0 (tồn ≤ 0 không chứng minh hết hàng — để nháp chờ
 *      người duyệt, KHÔNG nói "hết hàng")
 *  Messenger (nhắn tin cho khách) NGOÀI tầm bản này: cần app Facebook được duyệt quyền pages_messaging.
 * ═══════════════════════════════════════════════════════════════════════════════ */

import crypto from 'crypto'
import { ToolError } from './mcpTypes'
import { TRANG_THAI_BAN } from './sucKhoeTaiChinhKhach'
import { FacebookService, isRateLimitError, loaiLoiFb, quyenThieuFb, type SchedulePostInput } from '../services/platforms/facebook'
import { baoChuShop } from './pilotBaoChuShop'

// ─── Tiện ích nhỏ ───────────────────────────────────────────────────────────────

const so = (v: any, d: number): number => {
    if (v === null || v === undefined || (typeof v === 'string' && v.trim() === '')) return d
    const n = Number(v)
    return Number.isFinite(n) ? n : d
}
const kep = (v: any, d: number, min: number, max: number) => Math.min(Math.max(so(v, d), min), max)
const docJson = (s: any, d: any = null) => { try { return s ? JSON.parse(s) : d } catch { return d } }
const jsonMang = (raw: any): any[] => {
    if (Array.isArray(raw)) return raw
    const v = docJson(raw, [])
    return Array.isArray(v) ? v : []
}

const VN = 7 * 3600_000
/** 0h hôm nay giờ VN, epoch ms. */
export function dauNgayVN(now = Date.now()): number {
    return Math.floor((now + VN) / 86400_000) * 86400_000 - VN
}
const ngayVN = (now = Date.now()) => new Date(now + VN).toISOString().slice(0, 10)
/** "02/11 20:00" giờ VN. */
export function ngayGioVN(ms: number): string {
    const s = new Date(ms + VN).toISOString()
    return `${s.slice(8, 10)}/${s.slice(5, 7)} ${s.slice(11, 16)}`
}
export const vnd = (n: number) => `${Math.round(n).toLocaleString('vi-VN')}đ`

/** Bỏ dấu + chữ thường — so khớp câu hỏi khách gõ không dấu. */
const DAU_TO_HOP = new RegExp('[\\u0300-\\u036f]', 'g')
export function boDau(s: string): string {
    return String(s || '').normalize('NFD').replace(DAU_TO_HOP, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase()
}

// ─── Chính sách ─────────────────────────────────────────────────────────────────

export interface ChinhSachFbPilot {
    /** số bài sản phẩm tối đa mỗi ngày (giờ VN), đếm cả bài Kengi khác đã hẹn trên page */
    postsPerDay: number
    /** khung giờ đăng (giờ VN, 0..23). Rỗng ⇒ giờ vàng của hồ sơ thương hiệu ⇒ 9h, 12h, 20h */
    postHours: number[]
    /** hai bài cách nhau tối thiểu (phút) */
    minGapMinutes: number
    /** không đăng lại cùng một mã trong N ngày */
    repostAfterDays: number
    /** chỉ đăng hàng còn ít nhất N (tồn DƯƠNG) */
    minStock: number
    /** số ảnh mỗi bài */
    maxImages: number
    /** ghi giá bán (giá bán lẻ trong kho) vào bài */
    showPrice: boolean
    /** câu kêu gọi cuối bài. Rỗng ⇒ hồ sơ thương hiệu ⇒ câu mặc định */
    cta: string
    /** hashtag. Rỗng ⇒ hashtag thương hiệu trong hồ sơ */
    hashtags: string[]
    /** thao tác ghi lên Facebook mỗi ngày (tính cả lần hỏng) */
    maxWritesPerDay: number
    /** trả lời bình luận tối đa mỗi chu kỳ */
    maxRepliesPerCycle: number
    automation: { posts: boolean; replyPriceQuestions: boolean; hidePhoneComments: boolean }
}

export const CHINH_SACH_FB_MAC_DINH: ChinhSachFbPilot = {
    postsPerDay: 2,
    postHours: [],
    minGapMinutes: 180,
    repostAfterDays: 21,
    minStock: 1,
    maxImages: 4,
    showPrice: true,
    cta: '',
    hashtags: [],
    maxWritesPerDay: 30,
    maxRepliesPerCycle: 10,
    automation: { posts: true, replyPriceQuestions: false, hidePhoneComments: false },
}

export const GIO_DANG_MAC_DINH = [9, 12, 20]
export const CTA_MAC_DINH = 'Inbox shop hoặc để lại bình luận để được tư vấn và đặt hàng.'
const CTA_TRA_LOI = 'Anh/chị nhắn tin cho shop để được tư vấn và đặt hàng nhé.'
/** Mỗi chu kỳ lập tối đa bấy nhiêu bài (khung giờ 3 ngày tới vẫn là trần chính). */
const TRAN_BAI_MOI_CHU_KY = 6

/* Vệ sinh kế hoạch mở (09/11/2026 — chép tinh thần donKeHoachMo của Shopee Pilot). Trước đây nháp không bao giờ hết hạn, giữ
 * khung giờ + chặn mã 21 ngày dù chưa đăng (đo offline: Xem trước theo lịch rồi bật Tự động ⇒ ~3 ngày không lên bài nào, chủ
 * shop không được báo), còn 'running' kẹt thì kẹt mãi. */
/** Nháp do MÁY lập (khoá 'cycle:') quá hạn này chưa thực thi ⇒ chu kỳ tự huỷ — giá / tồn lúc lập đã cũ. */
const HAN_NHAP_MAY_MS = 3 * 86400_000
/** Lượt thực thi 'running' lâu chừng này = máy chết giữa lượt ghi — không ai biết bài đã lên chưa. */
const KET_THUC_THI_MS = 3600_000
/** Người huỷ nháp máy đề xuất ⇒ chu kỳ không đề xuất lại mã / bình luận đó trong chừng này (huỷ = "đừng làm"). */
const NHO_NGUOI_HUY_MS = 14 * 86400_000
/** Khoá 'cycle:' = máy lập (routes/facebookPilot.khoaWeb đổi khoá 'cycle:' từ trình duyệt thành 'web:…' nên không giả được). */
const laNhapMay = (k: { idempotencyKey?: string | null }) => String(k.idempotencyKey || '').startsWith('cycle:')
/** Lượt Xem trước dùng khoá riêng 'cycle:xem:' — sang Tự động thì huỷ mà khoá không chặn lập lại bằng khoá 'cycle:'. */
const laNhapXemTruoc = (k: { idempotencyKey?: string | null }) => String(k.idempotencyKey || '').startsWith('cycle:xem:')

export function chuanHoaGio(x: any): number[] {
    const ds = (Array.isArray(x) ? x : typeof x === 'string' ? x.split(/[\s,;]+/) : [])
        .map(v => Math.floor(so(v, -1)))
        .filter(h => h >= 0 && h <= 23)
    return [...new Set(ds)].sort((a, b) => a - b).slice(0, 8)
}

/** "#Dụng cụ điện, khoan" → ["#Dụngcụđiện", "#khoan"]: một từ mỗi thẻ, bỏ ký tự lạ, không trùng, tối đa 8. */
export function chuanHoaHashtag(x: any): string[] {
    const tho = Array.isArray(x) ? x.map(String) : typeof x === 'string' ? x.split(/[,;\n]+/) : []
    const ra: string[] = []
    const da = new Set<string>()
    for (const t of tho) {
        const sach = String(t).replace(/^#+/, '').replace(/[^\p{L}\p{N}_]+/gu, '').slice(0, 40)
        if (!sach) continue
        const k = sach.toLowerCase()
        if (da.has(k)) continue
        da.add(k)
        ra.push(`#${sach}`)
        if (ra.length >= 8) break
    }
    return ra
}

/** Chuẩn hoá chính sách người gửi lên — số lạ về mặc định, kẹp trong khoảng an toàn. */
export function chuanHoaChinhSachFb(x: any): ChinhSachFbPilot {
    const m = CHINH_SACH_FB_MAC_DINH
    const tu = x?.automation || {}
    const bool = (v: any, d: boolean) => (typeof v === 'boolean' ? v : d)
    return {
        postsPerDay: Math.floor(kep(x?.postsPerDay, m.postsPerDay, 0, 10)),
        postHours: chuanHoaGio(x?.postHours ?? m.postHours),
        minGapMinutes: Math.floor(kep(x?.minGapMinutes, m.minGapMinutes, 60, 1440)),
        repostAfterDays: Math.floor(kep(x?.repostAfterDays, m.repostAfterDays, 1, 365)),
        minStock: Math.floor(kep(x?.minStock, m.minStock, 1, 1_000_000)),
        maxImages: Math.floor(kep(x?.maxImages, m.maxImages, 1, 6)),
        showPrice: bool(x?.showPrice, m.showPrice),
        cta: String(x?.cta ?? m.cta).replace(/\s+/g, ' ').trim().slice(0, 200),
        hashtags: chuanHoaHashtag(x?.hashtags ?? m.hashtags),
        maxWritesPerDay: Math.floor(kep(x?.maxWritesPerDay, m.maxWritesPerDay, 1, 200)),
        maxRepliesPerCycle: Math.floor(kep(x?.maxRepliesPerCycle, m.maxRepliesPerCycle, 0, 50)),
        automation: {
            posts: bool(tu.posts, m.automation.posts),
            replyPriceQuestions: bool(tu.replyPriceQuestions, m.automation.replyPriceQuestions),
            hidePhoneComments: bool(tu.hidePhoneComments, m.automation.hidePhoneComments),
        },
    }
}

export interface LichFb { enabled: boolean; intervalMinutes: number }
export const LICH_FB_MAC_DINH: LichFb = { enabled: false, intervalMinutes: 240 }
export function chuanHoaLichFb(x: any): LichFb {
    return { enabled: x?.enabled === true, intervalMinutes: Math.floor(kep(x?.intervalMinutes, LICH_FB_MAC_DINH.intervalMinutes, 60, 24 * 60)) }
}

export interface CauHinhFbPilot {
    pageId: string | null
    executionMode: 'preview' | 'auto'
    policy: ChinhSachFbPilot
    schedule: LichFb
    nextRunAt: number | null
    lastRunAt: number | null
    lastResult: any
    updatedAt: number
}

function cauHinhMacDinh(): CauHinhFbPilot {
    return { pageId: null, executionMode: 'preview', policy: chuanHoaChinhSachFb({}), schedule: { ...LICH_FB_MAC_DINH }, nextRunAt: null, lastRunAt: null, lastResult: null, updatedAt: 0 }
}

// ─── Kho lưu (kế hoạch, nhật ký ghi, cấu hình) ──────────────────────────────────

export type LoaiKeHoachFb = 'post' | 'reply' | 'hide'
export interface KeHoachFb {
    id: string
    kind: LoaiKeHoachFb
    status: string
    idempotencyKey: string | null
    data: any
    result: any
    createdBy: string | null
    createdAt: number
    updatedAt: number
}
export interface NhatKyFb { id: string; action: string; status: string; planId: string | null; payload: any; response: any; createdAt: number }

export interface KhoFbPilot {
    docCauHinh(): Promise<CauHinhFbPilot | null>
    luuCauHinh(c: CauHinhFbPilot): Promise<void>
    taoKeHoach(k: KeHoachFb): Promise<KeHoachFb>
    layKeHoach(id: string): Promise<KeHoachFb | null>
    /** draft → running, nguyên tử. false = bản khác đã giành / không còn là nháp. */
    gianhKeHoach(id: string): Promise<boolean>
    capNhatKeHoach(id: string, status: string, result: any): Promise<void>
    /** draft → cancelled kèm `result` (lý do; `tuHuy: true` = máy tự huỷ), nguyên tử. false = không còn là nháp. */
    huyKeHoach(id: string, result?: any): Promise<boolean>
    dsKeHoach(lim: number): Promise<KeHoachFb[]>
    /** Kế hoạch đăng bài ĐÃ / ĐANG đăng (running, succeeded, uncertain) tạo từ mốc `tuLuc` — né đăng lặp một mã + đếm khung giờ.
     *  09/11/2026: nháp KHÔNG còn ở đây — nháp chưa đăng từng chặn mã 21 ngày; nháp đi đường dsKeHoachMo. */
    dsKeHoachBaiTu(tuLuc: number): Promise<KeHoachFb[]>
    /** Kế hoạch còn MỞ (nháp, đang chạy) + kế hoạch huỷ từ mốc `huyTuLuc` — chu kỳ dọn nháp quá hạn, bắt lượt kẹt, nhớ người huỷ. */
    dsKeHoachMo(huyTuLuc: number): Promise<KeHoachFb[]>
    /** Kế hoạch trả lời / ẩn của các bình luận này, trừ bản đã huỷ. */
    dsKeHoachBinhLuan(commentIds: string[]): Promise<KeHoachFb[]>
    ghiNhatKy(w: Omit<NhatKyFb, 'id' | 'createdAt'>): Promise<void>
    dsNhatKy(lim: number): Promise<NhatKyFb[]>
    demGhiTuLuc(ms: number): Promise<number>
    /** Giành lượt chạy theo lịch: dời nextRunAt từ `cu` sang `moi` — chỉ một bản máy giành được. */
    gianhLich(cu: number, moi: number): Promise<boolean>
    ghiKetQuaLich(luc: number, ketQua: any): Promise<void>
}

/** Ba bảng của Facebook Pilot — tạo lười lần đầu dùng (và trong /admin/migrate). Thời gian là epoch ms (BIGINT)
 *  như Shopee Pilot, khỏi lệch múi giờ giữa timestamp Prisma và giờ phiên Postgres. */
export const SQL_TAO_BANG_FB_PILOT = [
    `CREATE TABLE IF NOT EXISTS "FacebookPilotConfig" (
        "id" TEXT NOT NULL, "pageId" TEXT, "executionMode" TEXT NOT NULL DEFAULT 'preview',
        "policy" TEXT NOT NULL DEFAULT '{}', "schedule" TEXT NOT NULL DEFAULT '{}',
        "nextRunAt" BIGINT, "lastRunAt" BIGINT, "lastResult" TEXT, "updatedAt" BIGINT NOT NULL DEFAULT 0,
        CONSTRAINT "FacebookPilotConfig_pkey" PRIMARY KEY ("id"))`,
    `CREATE TABLE IF NOT EXISTS "FacebookPilotPlan" (
        "id" TEXT NOT NULL, "kind" TEXT NOT NULL, "status" TEXT NOT NULL, "idempotencyKey" TEXT,
        "data" TEXT NOT NULL DEFAULT '{}', "result" TEXT, "createdBy" TEXT,
        "createdAt" BIGINT NOT NULL, "updatedAt" BIGINT NOT NULL,
        CONSTRAINT "FacebookPilotPlan_pkey" PRIMARY KEY ("id"))`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "FacebookPilotPlan_idempotencyKey_key" ON "FacebookPilotPlan"("idempotencyKey")`,
    `CREATE INDEX IF NOT EXISTS "FacebookPilotPlan_createdAt_idx" ON "FacebookPilotPlan"("createdAt")`,
    `CREATE TABLE IF NOT EXISTS "FacebookPilotWrite" (
        "id" TEXT NOT NULL, "action" TEXT NOT NULL, "status" TEXT NOT NULL, "planId" TEXT,
        "payload" TEXT NOT NULL DEFAULT '{}', "response" TEXT, "createdAt" BIGINT NOT NULL,
        CONSTRAINT "FacebookPilotWrite_pkey" PRIMARY KEY ("id"))`,
    `CREATE INDEX IF NOT EXISTS "FacebookPilotWrite_createdAt_idx" ON "FacebookPilotWrite"("createdAt")`,
]

const daTaoBang = new WeakSet<object>()
const COT_KH = `id, kind, status, "idempotencyKey", data, result, "createdBy", "createdAt"::float8 AS "createdAt", "updatedAt"::float8 AS "updatedAt"`
function hangKeHoach(r: any): KeHoachFb {
    return {
        id: r.id, kind: r.kind, status: r.status, idempotencyKey: r.idempotencyKey ?? null,
        data: docJson(r.data, {}), result: docJson(r.result, null), createdBy: r.createdBy ?? null,
        createdAt: Number(r.createdAt), updatedAt: Number(r.updatedAt),
    }
}

/** Kho lưu trên schema của cửa hàng (raw SQL — không phụ thuộc client Prisma sinh lại). */
export function khoSqlFb(prisma: any): KhoFbPilot {
    const chacBang = async () => {
        if (daTaoBang.has(prisma)) return
        for (const sql of SQL_TAO_BANG_FB_PILOT) await prisma.$executeRawUnsafe(sql)
        daTaoBang.add(prisma)
    }
    const q = async (sql: string, ...v: any[]) => { await chacBang(); return prisma.$queryRawUnsafe(sql, ...v) as Promise<any[]> }
    const x = async (sql: string, ...v: any[]) => { await chacBang(); return prisma.$executeRawUnsafe(sql, ...v) as Promise<number> }
    return {
        async docCauHinh() {
            const [r] = await q(`SELECT "pageId", "executionMode", policy, schedule, "updatedAt"::float8 AS "updatedAt",
                                        "nextRunAt"::float8 AS "nextRunAt", "lastRunAt"::float8 AS "lastRunAt", "lastResult"
                                   FROM "FacebookPilotConfig" WHERE id = 'default'`)
            if (!r) return null
            return {
                pageId: r.pageId ?? null, executionMode: r.executionMode === 'auto' ? 'auto' : 'preview',
                policy: chuanHoaChinhSachFb(docJson(r.policy, {})), schedule: chuanHoaLichFb(docJson(r.schedule, {})),
                nextRunAt: r.nextRunAt == null ? null : Number(r.nextRunAt), lastRunAt: r.lastRunAt == null ? null : Number(r.lastRunAt),
                lastResult: docJson(r.lastResult, null), updatedAt: Number(r.updatedAt) || 0,
            }
        },
        async luuCauHinh(c) {
            // KHÔNG ghi lastRunAt / lastResult ở đây — đó là việc của lượt chạy theo lịch (ghiKetQuaLich)
            await x(`INSERT INTO "FacebookPilotConfig" (id, "pageId", "executionMode", policy, schedule, "nextRunAt", "updatedAt")
                     VALUES ('default', $1, $2, $3, $4, $5, $6)
                     ON CONFLICT (id) DO UPDATE SET "pageId" = EXCLUDED."pageId", "executionMode" = EXCLUDED."executionMode",
                     policy = EXCLUDED.policy, schedule = EXCLUDED.schedule, "nextRunAt" = EXCLUDED."nextRunAt", "updatedAt" = EXCLUDED."updatedAt"`,
                c.pageId, c.executionMode, JSON.stringify(c.policy), JSON.stringify(c.schedule || LICH_FB_MAC_DINH), c.nextRunAt, Date.now())
        },
        async gianhLich(cu, moi) {
            return (await x(`UPDATE "FacebookPilotConfig" SET "nextRunAt" = $2 WHERE id = 'default' AND "nextRunAt" = $1`, cu, moi)) === 1
        },
        async ghiKetQuaLich(luc, ketQua) {
            await x(`UPDATE "FacebookPilotConfig" SET "lastRunAt" = $1, "lastResult" = $2 WHERE id = 'default'`, luc, JSON.stringify(ketQua).slice(0, 20000))
        },
        async taoKeHoach(k) {
            const rs = await q(`INSERT INTO "FacebookPilotPlan" (id, kind, status, "idempotencyKey", data, result, "createdBy", "createdAt", "updatedAt")
                                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT ("idempotencyKey") DO NOTHING RETURNING ${COT_KH}`,
                k.id, k.kind, k.status, k.idempotencyKey, JSON.stringify(k.data), k.result == null ? null : JSON.stringify(k.result), k.createdBy, k.createdAt, k.updatedAt)
            if (rs[0]) return hangKeHoach(rs[0])
            const [cu] = k.idempotencyKey ? await q(`SELECT ${COT_KH} FROM "FacebookPilotPlan" WHERE "idempotencyKey" = $1`, k.idempotencyKey) : []
            if (!cu) throw new Error('Không lưu được kế hoạch')
            return hangKeHoach(cu)
        },
        async layKeHoach(id) {
            const [r] = await q(`SELECT ${COT_KH} FROM "FacebookPilotPlan" WHERE id = $1`, id)
            return r ? hangKeHoach(r) : null
        },
        async gianhKeHoach(id) {
            return (await x(`UPDATE "FacebookPilotPlan" SET status = 'running', "updatedAt" = $2 WHERE id = $1 AND status = 'draft'`, id, Date.now())) === 1
        },
        async capNhatKeHoach(id, status, result) {
            await x(`UPDATE "FacebookPilotPlan" SET status = $2, result = $3, "updatedAt" = $4 WHERE id = $1`, id, status, result == null ? null : JSON.stringify(result), Date.now())
        },
        async huyKeHoach(id, result) {
            return (await x(`UPDATE "FacebookPilotPlan" SET status = 'cancelled', result = $3, "updatedAt" = $2 WHERE id = $1 AND status = 'draft'`,
                id, Date.now(), result == null ? null : JSON.stringify(result))) === 1
        },
        async dsKeHoach(lim) {
            return (await q(`SELECT ${COT_KH} FROM "FacebookPilotPlan" ORDER BY "createdAt" DESC LIMIT $1`, lim)).map(hangKeHoach)
        },
        async dsKeHoachBaiTu(tuLuc) {
            return (await q(`SELECT ${COT_KH} FROM "FacebookPilotPlan" WHERE kind = 'post' AND status IN ('running', 'succeeded', 'uncertain')
                               AND "createdAt" >= $1 ORDER BY "createdAt" DESC LIMIT 2000`, tuLuc)).map(hangKeHoach)
        },
        async dsKeHoachMo(huyTuLuc) {
            return (await q(`SELECT ${COT_KH} FROM "FacebookPilotPlan" WHERE status IN ('draft', 'running') OR (status = 'cancelled' AND "updatedAt" >= $1)
                               ORDER BY "createdAt" DESC LIMIT 2000`, huyTuLuc)).map(hangKeHoach)
        },
        async dsKeHoachBinhLuan(ids) {
            if (!ids.length) return []
            return (await q(`SELECT ${COT_KH} FROM "FacebookPilotPlan" WHERE kind IN ('reply', 'hide') AND status <> 'cancelled'
                               AND data::jsonb->>'commentId' = ANY($1::text[]) ORDER BY "createdAt" DESC`, ids)).map(hangKeHoach)
        },
        async ghiNhatKy(w) {
            await x(`INSERT INTO "FacebookPilotWrite" (id, action, status, "planId", payload, response, "createdAt") VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                crypto.randomUUID(), w.action, w.status, w.planId, JSON.stringify(w.payload ?? {}), w.response == null ? null : JSON.stringify(w.response).slice(0, 20000), Date.now())
        },
        async dsNhatKy(lim) {
            const rs = await q(`SELECT id, action, status, "planId", payload, response, "createdAt"::float8 AS "createdAt" FROM "FacebookPilotWrite" ORDER BY "createdAt" DESC LIMIT $1`, lim)
            return rs.map(r => ({ id: r.id, action: r.action, status: r.status, planId: r.planId ?? null, payload: docJson(r.payload, {}), response: docJson(r.response, null), createdAt: Number(r.createdAt) }))
        },
        async demGhiTuLuc(ms) {
            const [r] = await q(`SELECT COUNT(*)::int AS n FROM "FacebookPilotWrite" WHERE "createdAt" >= $1`, ms)
            return Number(r?.n) || 0
        },
    }
}

/** Kho trong bộ nhớ — cho bộ kiểm (cùng hợp đồng với khoSqlFb). */
export function khoBoNhoFb(): KhoFbPilot & { _keHoach: KeHoachFb[]; _nhatKy: NhatKyFb[] } {
    let cfg: CauHinhFbPilot | null = null
    const keHoach: KeHoachFb[] = []
    const nhatKy: NhatKyFb[] = []
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
        // updatedAt theo đồng hồ thật như khoSqlFb (bộ kiểm muốn "kẹt quá 1 giờ" thì tự lùi updatedAt)
        async gianhKeHoach(id) { const k = keHoach.find(x => x.id === id); if (!k || k.status !== 'draft') return false; k.status = 'running'; k.updatedAt = Date.now(); return true },
        async capNhatKeHoach(id, status, result) { const k = keHoach.find(x => x.id === id); if (k) { k.status = status; k.result = sao(result); k.updatedAt = Date.now() } },
        async huyKeHoach(id, result) {
            const k = keHoach.find(x => x.id === id)
            if (!k || k.status !== 'draft') return false
            k.status = 'cancelled'; k.result = result == null ? null : sao(result); k.updatedAt = Date.now(); return true
        },
        async dsKeHoach(lim) { return sao([...keHoach].sort((a, b) => b.createdAt - a.createdAt).slice(0, lim)) },
        async dsKeHoachBaiTu(tuLuc) {
            return sao(keHoach.filter(k => k.kind === 'post' && ['running', 'succeeded', 'uncertain'].includes(k.status) && k.createdAt >= tuLuc))
        },
        async dsKeHoachMo(huyTuLuc) {
            return sao(keHoach.filter(k => k.status === 'draft' || k.status === 'running' || (k.status === 'cancelled' && k.updatedAt >= huyTuLuc)).sort((a, b) => b.createdAt - a.createdAt))
        },
        async dsKeHoachBinhLuan(ids) {
            return sao(keHoach.filter(k => (k.kind === 'reply' || k.kind === 'hide') && k.status !== 'cancelled' && ids.includes(String(k.data?.commentId))))
        },
        async ghiNhatKy(w) { nhatKy.push({ ...sao(w), id: crypto.randomUUID(), createdAt: Date.now() }) },
        async dsNhatKy(lim) { return sao([...nhatKy].sort((a, b) => b.createdAt - a.createdAt).slice(0, lim)) },
        async demGhiTuLuc(ms) { return nhatKy.filter(w => w.createdAt >= ms).length },
    }
}

// ─── Ngữ cảnh ───────────────────────────────────────────────────────────────────

/** Phần FacebookService Pilot dùng — bộ kiểm thay bằng Facebook giả ghi lại mọi lời gọi. */
export interface DichVuFb {
    get(path: string, params?: Record<string, any>): Promise<any>
    identifyToken(): Promise<{ type: string; id: string; name?: string }>
    createOrSchedulePost(input: SchedulePostInput): Promise<{ id: string; post_id?: string }>
    replyToComment(commentId: string, message: string): Promise<{ id: string }>
    hideComment(commentId: string, hidden?: boolean): Promise<{ success: boolean }>
    listScheduledPosts(pageId: string): Promise<any[]>
}

export interface NgCanhFb {
    prisma: any
    kho: KhoFbPilot
    nguoi?: string | null
    /** Facebook giả cho bộ kiểm; bỏ trống ⇒ FacebookService thật bằng page token */
    taoFb?: (token: string) => DichVuFb
    /** đồng hồ giả cho bộ kiểm */
    bayGio?: () => number
}

const luc = (ctx: NgCanhFb) => (ctx.bayGio ? ctx.bayGio() : Date.now())
const dichVu = (ctx: NgCanhFb, token: string): DichVuFb => (ctx.taoFb ? ctx.taoFb(token) : new FacebookService(token))

/** Trường page được phép ra giao diện — KHÔNG BAO GIỜ trả accessToken. */
function pageAnToan(p: any) {
    return {
        pageId: String(p.pageId), name: p.name, avatar: p.avatar || null, fanCount: Number(p.fanCount) || 0, status: p.status,
        tokenExpiresAt: p.tokenExpiresAt ? new Date(p.tokenExpiresAt).getTime() : null,
        webhookSubscribed: !!p.webhookSubscribed, autoReplyEnabled: !!p.autoReplyEnabled,
    }
}

export async function docCauHinhFb(ctx: NgCanhFb): Promise<{ cfg: CauHinhFbPilot; pages: any[]; page: any | null }> {
    const cfg = (await ctx.kho.docCauHinh()) || cauHinhMacDinh()
    const pages: any[] = await ctx.prisma.fbPage.findMany({
        where: { status: { not: 'disconnected' } },
        orderBy: { createdAt: 'asc' },
        select: { pageId: true, name: true, avatar: true, fanCount: true, status: true, tokenExpiresAt: true, webhookSubscribed: true, autoReplyEnabled: true, accessToken: true },
    })
    const page = (cfg.pageId && pages.find(p => p.pageId === cfg.pageId)) || (pages.length === 1 ? pages[0] : null)
    return { cfg, pages, page }
}

async function canPage(ctx: NgCanhFb): Promise<{ cfg: CauHinhFbPilot; pages: any[]; page: any }> {
    const r = await docCauHinhFb(ctx)
    if (!r.page) {
        throw new ToolError(r.pages.length
            ? `Cửa hàng nối ${r.pages.length} fanpage — chọn fanpage cho Pilot ở Tự động hóa → Sửa chính sách.`
            : 'Cửa hàng chưa nối fanpage nào — dán page token ở tab Kết nối trước.')
    }
    if (r.page.status === 'token_expired') throw new ToolError(`Token của fanpage "${r.page.name}" đã hết hạn hoặc bị thu hồi — dán page token mới ở tab Kết nối.`)
    if (!r.page.accessToken) throw new ToolError(`Fanpage "${r.page.name}" chưa có token.`)
    return r
}

/** Hồ sơ thương hiệu (Content AI) — singleton của cửa hàng. Bảng chưa có ⇒ null. */
async function docHoSo(prisma: any): Promise<any | null> {
    return prisma.fbBrandProfile?.findFirst?.({ orderBy: { createdAt: 'asc' } }).catch(() => null) ?? null
}

/** Khung giờ đăng hiệu lực: chính sách ⇒ giờ vàng của hồ sơ thương hiệu ⇒ 9h, 12h, 20h. */
export function gioDang(pol: ChinhSachFbPilot, hoSo: any): number[] {
    if (pol.postHours.length) return pol.postHours
    const tuHoSo = chuanHoaGio(jsonMang(hoSo?.bestHours))
    return tuHoSo.length ? tuHoSo : GIO_DANG_MAC_DINH
}

async function conLuotGhi(ctx: NgCanhFb, pol: ChinhSachFbPilot) {
    const n = await ctx.kho.demGhiTuLuc(dauNgayVN(luc(ctx)))
    if (n >= pol.maxWritesPerDay) {
        // gắn cờ để chu kỳ biết mà dừng thực thi lại nháp cũ, khỏi báo cùng một lỗi cho từng nháp (09/11/2026)
        const e: any = new ToolError(`Đã đủ ${pol.maxWritesPerDay} thao tác ghi lên Facebook hôm nay (giới hạn trong chính sách) — mai chạy tiếp.`)
        e.hetLuotGhi = true
        throw e
    }
}

// ─── Soạn bài ──────────────────────────────────────────────────────────────────

/** Mô tả sản phẩm (có thể là HTML từ trang Ảnh & mô tả) → chữ thường. */
export function boHtml(s: string): string {
    return String(s || '')
        .replace(/<\s*br\s*\/?>/gi, '\n')
        .replace(/<\/\s*(p|div|li|h[1-6]|tr)\s*>/gi, '\n')
        .replace(/<li[^>]*>/gi, '• ')
        .replace(/<\s*(p|div|h[1-6]|tr)(\s[^>]*)?>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
        .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(Number(d)))
        .replace(/[ \t]+/g, ' ')
        .replace(/ *\n */g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
}

/** Cắt còn ≤ n ký tự, ưu tiên dừng ở cuối câu / xuống dòng, rồi tới khoảng trắng. */
export function rutGon(s: string, n: number): string {
    if (s.length <= n) return s
    const dau = s.slice(0, n)
    const cuoiCau = Math.max(dau.lastIndexOf('. '), dau.lastIndexOf('! '), dau.lastIndexOf('? '), dau.lastIndexOf('\n'))
    if (cuoiCau >= n * 0.5) return dau.slice(0, cuoiCau + 1).trim()
    const cach = dau.lastIndexOf(' ')
    return `${(cach >= n * 0.5 ? dau.slice(0, cach) : dau).trim()}…`
}

const tenGon = (s: string) => String(s || '').replace(/\s+/g, ' ').trim()

export interface HangSoan { name: string; sellingPrice: number; description?: string | null }

/**
 * Bài đăng một mã hàng — CHỈ từ dữ liệu kho + hồ sơ thương hiệu, không thêm lời hứa nào (giao toàn quốc,
 * chính hãng, còn hàng…). Dòng đầu luôn là tên hàng: bình luận trên bài được nối về mã hàng nhờ dòng này.
 */
export function soanBai(sp: HangSoan, pol: ChinhSachFbPilot, hoSo: any): { message: string; tuCam: string[] } {
    const emoji = String(hoSo?.emojiLevel || 'vua') !== 'khong'
    const dong: string[] = [`${emoji ? '🔹 ' : ''}${tenGon(sp.name)}`]
    if (pol.showPrice && Number(sp.sellingPrice) > 0) dong.push(`${emoji ? '💰 ' : ''}Giá: ${vnd(Number(sp.sellingPrice))}`)
    const moTa = rutGon(boHtml(sp.description || ''), 400)
    if (moTa) dong.push('', moTa)
    const cta = pol.cta || String(hoSo?.cta || '').replace(/\s+/g, ' ').trim() || CTA_MAC_DINH
    dong.push('', `${emoji ? '👉 ' : ''}${cta}`)
    const the = pol.hashtags.length ? pol.hashtags : chuanHoaHashtag(jsonMang(hoSo?.hashtags))
    if (the.length) dong.push('', the.join(' '))
    const message = dong.join('\n').slice(0, 2000)
    return { message, tuCam: tuCamTrong(message, hoSo) }
}

/** Từ CẤM của thương hiệu có trong đoạn chữ. */
export function tuCamTrong(chu: string, hoSo: any): string[] {
    const thap = String(chu || '').toLowerCase()
    return [...new Set(jsonMang(hoSo?.bannedWords).map((w: any) => String(w).toLowerCase().trim()).filter(Boolean))].filter(w => thap.includes(w))
}

/** Ảnh dùng được cho bài: URL http(s), không WebP / HEIC / AVIF / SVG (Graph API nhận JPG, PNG, GIF, BMP, TIFF). Ảnh chính trước. */
export function anhHopLe(images: { url: string; isPrimary?: boolean }[], toiDa: number): string[] {
    const ds = [...(images || [])].sort((a, b) => Number(!!b.isPrimary) - Number(!!a.isPrimary))
    const ra: string[] = []
    for (const im of ds) {
        const u = String(im?.url || '').trim()
        if (!/^https?:\/\//i.test(u)) continue
        if (/\.(webp|heic|heif|avif|svg)(\?|#|$)/i.test(u)) continue
        if (!ra.includes(u)) ra.push(u)
        if (ra.length >= toiDa) break
    }
    return ra
}

// ─── Khung giờ ──────────────────────────────────────────────────────────────────

/**
 * Khung giờ trống trong `soNgay` ngày (giờ VN, tính từ hôm nay): theo giờ đăng, cách mọi bài đã có (`ban`) ít nhất
 * minGapMinutes, mỗi ngày không quá postsPerDay bài (đếm cả bài đã có trong ngày), và còn cách hiện tại ≥ 15 phút.
 */
export function khungGioTrong(now: number, gio: number[], pol: ChinhSachFbPilot, ban: number[], soNgay = 3): number[] {
    const ra: number[] = []
    if (pol.postsPerDay <= 0) return ra
    const daDung = [...ban]
    const dau = dauNgayVN(now)
    for (let d = 0; d < soNgay; d++) {
        const ngay = dau + d * 86400_000
        let trongNgay = daDung.filter(t => t >= ngay && t < ngay + 86400_000).length
        for (const h of gio) {
            if (trongNgay >= pol.postsPerDay) break
            const t = ngay + h * 3600_000
            if (t < now + 15 * 60_000) continue
            if (daDung.some(b => Math.abs(b - t) < pol.minGapMinutes * 60_000)) continue
            ra.push(t); daDung.push(t); trongNgay++
        }
    }
    return ra
}

/**
 * Giờ của các bài đã có quanh hiện tại: bài Kengi đã hẹn / đã đăng (FbScheduledPost) + kế hoạch Pilot ĐÃ / ĐANG đăng chưa có
 * dòng FbScheduledPost (đang chạy, không rõ — có thể đã lên) + nháp CÒN thực thi được (giờ hẹn cách ≥ 10 phút).
 * 09/11/2026: nháp quá giờ / đã huỷ không giữ khung nữa — trước đây nháp Xem trước giữ khung 3 ngày ⇒ bật Tự động không lên
 * bài nào. Nháp còn hạn vẫn giữ khung CỦA NÓ: không thì nhiều nháp lập liền tay từ form cùng rơi vào một khung trống đầu tiên,
 * và mỗi lượt Xem trước lại lập thêm một loạt nháp chồng lên cùng các khung.
 */
async function gioDaCo(ctx: NgCanhFb, pageId: string, now: number): Promise<number[]> {
    const ds: any[] = await ctx.prisma.fbScheduledPost.findMany({
        where: { pageId, status: { in: ['scheduled', 'published'] }, scheduledAt: { gte: new Date(dauNgayVN(now) - 86400_000), lte: new Date(now + 5 * 86400_000) } },
        select: { scheduledAt: true },
    })
    const cuaPage = (k: KeHoachFb) => String(k.data?.pageId || pageId) === String(pageId)
    const gio = (k: KeHoachFb) => Number(k.data?.scheduledAt) || (k.status === 'draft' ? 0 : k.updatedAt)
    const daDang = (await ctx.kho.dsKeHoachBaiTu(now - 7 * 86400_000)).filter(cuaPage)
    const nhap = (await ctx.kho.dsKeHoachMo(now)).filter(k => k.kind === 'post' && k.status === 'draft' && cuaPage(k))
    return [
        ...ds.map(r => new Date(r.scheduledAt).getTime()),
        // đăng xong (succeeded) thì có dòng FbScheduledPost rồi — chỉ đếm bản chưa có dòng đó, khỏi đếm đôi
        ...daDang.filter(k => k.status !== 'succeeded' || !k.result?.scheduledPostId).map(gio).filter(t => t > 0),
        ...nhap.map(gio).filter(t => t >= now + 10 * 60_000),
    ]
}

/** "2026-11-02T20:00" (không múi giờ ⇒ giờ VN), chuỗi ISO có múi giờ, hoặc epoch ms → epoch ms. */
export function docGio(v: any): number {
    if (typeof v === 'number') return v
    const s = String(v || '').trim()
    if (!s) return NaN
    if (/^\d{10,}$/.test(s)) return Number(s)
    const coMuiGio = /(Z|[+-]\d{2}:?\d{2})$/i.test(s)
    return Date.parse(coMuiGio ? s : `${s.replace(' ', 'T')}${/T\d{2}:\d{2}$/.test(s.replace(' ', 'T')) ? ':00' : ''}+07:00`)
}

// ─── Ứng viên đăng bài ──────────────────────────────────────────────────────────

export interface UngVienFb {
    productId: string
    sku: string
    name: string
    price: number
    stock: number
    sold30: number
    images: string[]
    message: string
}

/** `dangCoKeHoach` (09/11/2026): mã đang có kế hoạch mở (nháp / đang chạy) hoặc người vừa huỷ nháp máy đề xuất (14 ngày) —
 *  trước đây nháp tính vào `daDangGanDay` (chặn 21 ngày như đã đăng). */
export interface LoaiTruFb { thieuAnh: number; anhKhongDung: number; daDangGanDay: number; tuCam: number; dangCoKeHoach: number }

const DIEU_KIEN_HANG = { productType: 'goods', mergedIntoId: null, bundleId: null }

/** Mã hàng / bình luận mà chu kỳ phải né: kế hoạch còn mở (khỏi lập trùng), hoặc nháp MÁY bị NGƯỜI huỷ trong 14 ngày. */
export interface NeKeHoachFb { maHang: Set<string>; binhLuan: Set<string> }
function themNe(ne: NeKeHoachFb, k: KeHoachFb) {
    if (k.kind === 'post' && k.data?.productId) ne.maHang.add(String(k.data.productId))
    if ((k.kind === 'reply' || k.kind === 'hide') && k.data?.commentId) ne.binhLuan.add(String(k.data.commentId))
}
/** Bản CHỈ ĐỌC (trang trạng thái, form) — chu kỳ dùng bản dọn của donKeHoachMoFb. */
async function keHoachCanNe(ctx: NgCanhFb, now: number): Promise<NeKeHoachFb> {
    const ne: NeKeHoachFb = { maHang: new Set(), binhLuan: new Set() }
    for (const k of await ctx.kho.dsKeHoachMo(now - NHO_NGUOI_HUY_MS)) {
        if (k.status !== 'cancelled' || (laNhapMay(k) && !k.result?.tuHuy)) themNe(ne, k)
    }
    return ne
}

async function maDaDangGanDay(ctx: NgCanhFb, pol: ChinhSachFbPilot, now: number): Promise<Map<string, number>> {
    const tu = now - pol.repostAfterDays * 86400_000
    const ra = new Map<string, number>()
    for (const k of await ctx.kho.dsKeHoachBaiTu(tu)) {
        const id = String(k.data?.productId || '')
        if (id && !ra.has(id)) ra.set(id, k.createdAt)
    }
    // Bài Content AI (FbContentDraft) nhắc mã nào thì mã đó cũng coi như vừa lên bài
    const nhap: any[] = await (ctx.prisma.fbContentDraft?.findMany?.({
        where: { status: { in: ['pending', 'scheduled', 'published'] }, createdAt: { gte: new Date(tu) } },
        select: { productIds: true, createdAt: true },
    }) ?? Promise.resolve([])).catch(() => [])
    for (const d of nhap) {
        for (const id of jsonMang(d.productIds)) if (id && !ra.has(String(id))) ra.set(String(id), new Date(d.createdAt).getTime())
    }
    return ra
}

/**
 * Hàng đủ điều kiện lên bài: hàng hoá, chưa gộp, không combo, tồn ≥ minStock, có giá bán, có ảnh dùng được,
 * chưa lên bài trong repostAfterDays ngày, không có kế hoạch đang mở / người vừa huỷ đề xuất (`neMa` — chu kỳ truyền bản
 * vừa dọn), bài soạn ra không dính từ cấm. Xếp: bán chạy 30 ngày, rồi tồn nhiều.
 */
export async function timUngVienFb(ctx: NgCanhFb, pol: ChinhSachFbPilot, o: { lim: number; hoSo?: any; neMa?: Set<string> } = { lim: 30 }): Promise<{ ungVien: UngVienFb[]; loaiTru: LoaiTruFb; daXet: number }> {
    const now = luc(ctx)
    const hoSo = o.hoSo !== undefined ? o.hoSo : await docHoSo(ctx.prisma)
    /* Hai nguồn, TUẦN TỰ (pool 1 kết nối): hàng bán chạy 30 ngày + hàng tồn nhiều. Chỉ lấy theo tồn thì cửa hàng
     * nghìn mã bỏ sót đúng hàng bán chạy mà tồn ít. */
    const ban: any[] = await ctx.prisma.transactionItem.groupBy({
        by: ['productId'],
        where: { transaction: { status: { in: [...TRANG_THAI_BAN] }, createdAt: { gte: new Date(now - 30 * 86400_000) } } },
        _sum: { quantity: true },
        orderBy: { _sum: { quantity: 'desc' } },
        take: 200,
    }).catch((e: any) => {
        // không xếp được theo bán chạy thì vẫn xếp theo tồn — nhưng nói ra, đừng im
        console.error('[FacebookPilot] đọc hàng bán chạy lỗi:', e?.message || e)
        return []
    })
    const daBan = new Map(ban.filter(b => b.productId).map(b => [String(b.productId), Number(b._sum?.quantity) || 0]))
    const chon = { id: true, sku: true, name: true, description: true, sellingPrice: true, stock: true, images: { select: { url: true, isPrimary: true } } }
    const dieuKien = { ...DIEU_KIEN_HANG, stock: { gte: pol.minStock }, sellingPrice: { gt: 0 } }
    const banChay: any[] = daBan.size ? await ctx.prisma.product.findMany({ where: { ...dieuKien, id: { in: [...daBan.keys()] } }, select: chon }) : []
    const tonNhieu: any[] = await ctx.prisma.product.findMany({ where: dieuKien, select: chon, orderBy: { stock: 'desc' }, take: 300 })
    const rows = [...banChay, ...tonNhieu.filter(r => !daBan.has(r.id))]
    const daDang = await maDaDangGanDay(ctx, pol, now)
    const neMa = o.neMa || (await keHoachCanNe(ctx, now)).maHang
    const loaiTru: LoaiTruFb = { thieuAnh: 0, anhKhongDung: 0, daDangGanDay: 0, tuCam: 0, dangCoKeHoach: 0 }
    const ungVien: UngVienFb[] = []
    for (const r of rows) {
        const anh = anhHopLe(r.images || [], pol.maxImages)
        if (!anh.length) { (r.images || []).length ? loaiTru.anhKhongDung++ : loaiTru.thieuAnh++; continue }
        if (daDang.has(r.id)) { loaiTru.daDangGanDay++; continue }
        if (neMa.has(String(r.id))) { loaiTru.dangCoKeHoach++; continue }
        const bai = soanBai(r, pol, hoSo)
        if (bai.tuCam.length) { loaiTru.tuCam++; continue }
        ungVien.push({
            productId: r.id, sku: r.sku, name: tenGon(r.name), price: Number(r.sellingPrice) || 0, stock: Number(r.stock) || 0,
            sold30: daBan.get(r.id) || 0, images: anh, message: bai.message,
        })
    }
    ungVien.sort((a, b) => b.sold30 - a.sold30 || b.stock - a.stock)
    return { ungVien: ungVien.slice(0, Math.max(0, o.lim)), loaiTru, daXet: rows.length }
}

/** Một mã hàng theo SKU (không phân biệt hoa thường) kèm ảnh — cho form lên bài. */
async function motHang(ctx: NgCanhFb, sku: string): Promise<any | null> {
    const ma = String(sku || '').trim()
    if (!ma) throw new ToolError('Nhập mã hàng')
    return ctx.prisma.product.findFirst({
        where: { sku: { equals: ma, mode: 'insensitive' } },
        select: { id: true, sku: true, name: true, description: true, sellingPrice: true, stock: true, productType: true, mergedIntoId: true, bundleId: true, images: { select: { url: true, isPrimary: true } } },
    })
}

function lyDoKhongDang(sp: any, pol: ChinhSachFbPilot): string | null {
    if (sp.productType && sp.productType !== 'goods') return 'Mã là dịch vụ, không phải hàng hoá.'
    if (sp.mergedIntoId) return 'Mã đã gộp vào mã khác — lên bài bằng mã đích.'
    if (sp.bundleId) return 'Mã là combo — lên bài từng mã thành phần.'
    if (!(Number(sp.sellingPrice) > 0)) return 'Mã chưa có giá bán trong kho.'
    if (!(Number(sp.stock) >= pol.minStock)) return `Tồn kho ${Number(sp.stock) || 0} — chính sách chỉ lên bài hàng còn ít nhất ${pol.minStock}.`
    if (!anhHopLe(sp.images || [], pol.maxImages).length) {
        return (sp.images || []).length ? 'Ảnh của mã là WebP / HEIC — Facebook không nhận, cần ảnh JPG hoặc PNG.' : 'Mã chưa có ảnh — thêm ảnh ở Ảnh & mô tả sản phẩm.'
    }
    return null
}

// ─── Trạng thái cho giao diện (GET /state) ─────────────────────────────────────

export async function xayTrangThaiFb(ctx: NgCanhFb): Promise<any> {
    const now = luc(ctx)
    const { cfg, pages, page } = await docCauHinhFb(ctx)
    const pol = cfg.policy
    // TUẦN TỰ có chủ ý: pool Prisma của cửa hàng chỉ 1 kết nối trên prod
    const plans = await ctx.kho.dsKeHoach(80)
    const audit = await ctx.kho.dsNhatKy(100)
    const todayWrites = await ctx.kho.demGhiTuLuc(dauNgayVN(now))
    const hoSo = await docHoSo(ctx.prisma)
    const status: any = {
        executionMode: cfg.executionMode, policy: pol,
        schedule: { ...cfg.schedule, nextRunAt: cfg.nextRunAt, lastRunAt: cfg.lastRunAt, lastResult: cfg.lastResult },
        pages: pages.map(pageAnToan), page: page ? pageAnToan(page) : null,
        postHours: gioDang(pol, hoSo),
        brand: hoSo ? {
            exists: true, cta: hoSo.cta || '', hashtags: chuanHoaHashtag(jsonMang(hoSo.hashtags)), bestHours: chuanHoaGio(jsonMang(hoSo.bestHours)),
            bannedWords: jsonMang(hoSo.bannedWords).length, emojiLevel: hoSo.emojiLevel || 'vua',
        } : { exists: false },
    }
    const goc = { now, todayWrites, plans, audit, status }
    if (!page) {
        status.notice = pages.length ? `Cửa hàng nối ${pages.length} fanpage — chọn fanpage cho Pilot ở Tự động hóa → Sửa chính sách.` : 'Cửa hàng chưa nối fanpage nào — dán page token ở tab Kết nối.'
        return { ...goc, candidates: [], excluded: null, upcoming: [], recent: [], slots: [] }
    }
    if (page.status === 'token_expired') status.notice = `Token của fanpage "${page.name}" đã hết hạn hoặc bị thu hồi — dán page token mới ở tab Kết nối.`
    else if (page.tokenExpiresAt && new Date(page.tokenExpiresAt).getTime() - now < 7 * 86400_000) {
        const con = Math.max(0, Math.floor((new Date(page.tokenExpiresAt).getTime() - now) / 86400_000))
        status.notice = `Page token còn khoảng ${con} ngày — dán token mới ở tab Kết nối trước khi hết hạn, kẻo bài hẹn giờ không lên.`
    }
    const ban = await gioDaCo(ctx, page.pageId, now)
    const slots = khungGioTrong(now, status.postHours, pol, ban).slice(0, 6)
    const uv = await timUngVienFb(ctx, pol, { lim: 30, hoSo })
    const sapToi: any[] = await ctx.prisma.fbScheduledPost.findMany({
        where: { pageId: page.pageId, status: 'scheduled', scheduledAt: { gte: new Date(now - 3600_000) } },
        orderBy: { scheduledAt: 'asc' }, take: 20,
        select: { id: true, message: true, mediaUrls: true, scheduledAt: true, status: true, fbPostId: true },
    })
    const ganDay: any[] = await ctx.prisma.fbScheduledPost.findMany({
        where: { pageId: page.pageId, status: 'published' },
        orderBy: { scheduledAt: 'desc' }, take: 10,
        select: { id: true, message: true, mediaUrls: true, scheduledAt: true, publishedAt: true, status: true, fbPostId: true },
    })
    const bai = (r: any) => ({
        id: r.id, title: String(r.message || '').split('\n')[0].replace(/^🔹\s*/, '').slice(0, 120), message: r.message,
        image: jsonMang(r.mediaUrls)[0] || null, at: new Date(r.scheduledAt).getTime(),
        publishedAt: r.publishedAt ? new Date(r.publishedAt).getTime() : null, status: r.status, postId: r.fbPostId || null,
    })
    return {
        ...goc, candidates: uv.ungVien, excluded: { ...uv.loaiTru, scanned: uv.daXet }, slots,
        upcoming: sapToi.map(bai), recent: ganDay.map(bai),
    }
}

// ─── Kế hoạch ───────────────────────────────────────────────────────────────────

function keHoachMoi(kind: LoaiKeHoachFb, data: any, khoa: string | null | undefined, nguoi: string | null | undefined, now: number): KeHoachFb {
    return { id: crypto.randomUUID(), kind, status: 'draft', idempotencyKey: khoa ? String(khoa).slice(0, 200) : null, data, result: null, createdBy: nguoi ?? null, createdAt: now, updatedAt: now }
}

export interface DauVaoBai { sku: string; message?: string; scheduledAt?: number | string | null; publishNow?: boolean; idempotencyKey?: string }

/** Kế hoạch lên bài một mã hàng. Không chọn giờ ⇒ khung giờ trống gần nhất theo chính sách. */
export async function taoKeHoachBai(ctx: NgCanhFb, b: DauVaoBai): Promise<KeHoachFb> {
    const now = luc(ctx)
    const { cfg, page } = await canPage(ctx)
    const pol = cfg.policy
    const sp = await motHang(ctx, b.sku)
    if (!sp) throw new ToolError(`Không thấy mã hàng "${b.sku}" trong kho.`)
    const lyDo = lyDoKhongDang(sp, pol)
    if (lyDo) throw new ToolError(lyDo)
    const hoSo = await docHoSo(ctx.prisma)
    const tuSoan = soanBai(sp, pol, hoSo)
    const message = String(b.message || '').trim() ? String(b.message).trim().slice(0, 5000) : tuSoan.message
    const cam = tuCamTrong(message, hoSo)
    if (cam.length) throw new ToolError(`Bài có từ CẤM của thương hiệu: ${cam.join(', ')} — sửa nội dung (hoặc mô tả sản phẩm) rồi lập lại.`)

    const canhBao: string[] = []
    let scheduledAt: number | null = null
    if (!b.publishNow) {
        const ban = await gioDaCo(ctx, page.pageId, now)
        if (b.scheduledAt !== undefined && b.scheduledAt !== null && String(b.scheduledAt).trim() !== '') {
            scheduledAt = docGio(b.scheduledAt)
            if (!Number.isFinite(scheduledAt)) throw new ToolError('Giờ đăng không đọc được.')
            if (scheduledAt < now + 10 * 60_000) throw new ToolError('Giờ hẹn phải cách hiện tại ít nhất 10 phút — Facebook không nhận gần hơn.')
            if (scheduledAt > now + 28 * 86400_000) throw new ToolError('Chỉ hẹn trước tối đa 28 ngày.')
            if (ban.some(t => Math.abs(t - scheduledAt!) < pol.minGapMinutes * 60_000)) canhBao.push(`Gần một bài khác dưới ${pol.minGapMinutes} phút.`)
            const ngay = dauNgayVN(scheduledAt)
            if (ban.filter(t => t >= ngay && t < ngay + 86400_000).length >= pol.postsPerDay) canhBao.push(`Ngày này đã có ${pol.postsPerDay}+ bài (chính sách ${pol.postsPerDay} bài/ngày).`)
        } else {
            const [dau] = khungGioTrong(now, gioDang(pol, hoSo), pol, ban)
            if (!dau) {
                throw new ToolError(`Không còn khung giờ trống trong 3 ngày tới theo chính sách (${pol.postsPerDay} bài/ngày, cách nhau ≥ ${pol.minGapMinutes} phút) — chọn giờ hoặc đăng ngay.`)
            }
            scheduledAt = dau
        }
    }
    const data = {
        pageId: page.pageId, pageName: page.name, productId: sp.id, sku: sp.sku, name: tenGon(sp.name),
        price: Number(sp.sellingPrice) || 0, stock: Number(sp.stock) || 0, message,
        mediaUrls: anhHopLe(sp.images || [], pol.maxImages), scheduledAt, edited: message !== tuSoan.message,
        ...(canhBao.length ? { warnings: canhBao } : {}),
    }
    return ctx.kho.taoKeHoach(keHoachMoi('post', data, b.idempotencyKey, ctx.nguoi, now))
}

export interface DauVaoTraLoi {
    commentId: string; message: string; postId?: string | null; commentMsg?: string | null; fromName?: string | null
    productId?: string | null; sku?: string | null; price?: number | null; idempotencyKey?: string
}

export async function taoKeHoachTraLoi(ctx: NgCanhFb, b: DauVaoTraLoi): Promise<KeHoachFb> {
    const now = luc(ctx)
    const { page } = await canPage(ctx)
    const commentId = String(b.commentId || '').trim()
    if (!commentId) throw new ToolError('Thiếu mã bình luận')
    const message = String(b.message || '').trim().slice(0, 1000)
    if (!message) throw new ToolError('Nhập câu trả lời')
    const cam = tuCamTrong(message, await docHoSo(ctx.prisma))
    if (cam.length) throw new ToolError(`Câu trả lời có từ CẤM của thương hiệu: ${cam.join(', ')}.`)
    const data = {
        pageId: page.pageId, commentId, postId: b.postId || null, commentMsg: String(b.commentMsg || '').slice(0, 500),
        fromName: b.fromName ? String(b.fromName).slice(0, 100) : null, message,
        ...(b.productId ? { productId: String(b.productId), sku: b.sku || null, price: Number(b.price) || 0 } : {}),
    }
    return ctx.kho.taoKeHoach(keHoachMoi('reply', data, b.idempotencyKey, ctx.nguoi, now))
}

export async function taoKeHoachAn(ctx: NgCanhFb, b: { commentId: string; postId?: string | null; commentMsg?: string | null; fromName?: string | null; reason?: string; idempotencyKey?: string }): Promise<KeHoachFb> {
    const now = luc(ctx)
    const { page } = await canPage(ctx)
    const commentId = String(b.commentId || '').trim()
    if (!commentId) throw new ToolError('Thiếu mã bình luận')
    const data = {
        pageId: page.pageId, commentId, postId: b.postId || null, commentMsg: String(b.commentMsg || '').slice(0, 500),
        fromName: b.fromName ? String(b.fromName).slice(0, 100) : null, reason: String(b.reason || '').slice(0, 200) || 'Ẩn bình luận',
    }
    return ctx.kho.taoKeHoach(keHoachMoi('hide', data, b.idempotencyKey, ctx.nguoi, now))
}

/** Người huỷ một nháp. Nháp MÁY đề xuất (khoá 'cycle:') ⇒ chu kỳ nhớ 14 ngày, không đề xuất lại mã / bình luận đó (09/11/2026 —
 *  trước đây không nhớ gì; còn nháp chưa đăng thì chặn mã 21 ngày như bài đã lên). */
export async function huyKeHoachFb(ctx: NgCanhFb, id: string): Promise<KeHoachFb> {
    const k = await ctx.kho.layKeHoach(String(id || ''))
    const ai = `Người huỷ${ctx.nguoi ? ` (${String(ctx.nguoi).slice(0, 80)})` : ''}`
    const message = k && laNhapMay(k)
        ? `${ai} — chu kỳ không đề xuất lại ${k.kind === 'post' ? 'mã này' : 'bình luận này'} trong 14 ngày.`
        : `${ai}.`
    if (!k || !(await ctx.kho.huyKeHoach(k.id, { message }))) throw new ToolError('Kế hoạch không còn là bản nháp — không huỷ được.')
    return (await ctx.kho.layKeHoach(k.id))!
}

/** Lệnh ghi không rõ kết cục ⇒ 'uncertain', đừng tự đăng lại. 09/11/2026: FacebookService gắn khongRoKetCuc (HTTP 5xx / hết giờ /
 *  phản hồi không phải JSON / đứt mạng sau khi gửi) — true là không rõ, false là chắc chưa ghi (ảnh tải ẩn hỏng trước /feed).
 *  Lỗi mạng thô (dịch vụ giả của bộ kiểm) vẫn bắt theo chữ. */
function laLoiMang(e: any): boolean {
    if (e?.khongRoKetCuc === true) return true
    if (e?.khongRoKetCuc === false) return false
    return !e?.code && !(e instanceof ToolError) && /fetch failed|network|ECONNRESET|ETIMEDOUT|socket|aborted|EAI_AGAIN/i.test(String(e?.message || e))
}

// ─── Thực thi ───────────────────────────────────────────────────────────────────

export async function thucThiFb(ctx: NgCanhFb, planId: string, tuyChon: { tuDong?: boolean } = {}): Promise<any> {
    const plan = await ctx.kho.layKeHoach(planId)
    if (!plan) throw new ToolError('Không thấy kế hoạch — tải lại trang.')
    if (plan.status !== 'draft') return plan
    const { cfg, page } = await canPage(ctx)
    if (plan.data?.pageId && String(plan.data.pageId) !== String(page.pageId)) {
        throw new ToolError(`Kế hoạch lập cho fanpage khác (${plan.data.pageName || plan.data.pageId}) — huỷ rồi lập lại cho fanpage đang chọn.`)
    }
    if (cfg.executionMode !== 'auto') return { executed: false, plan }
    await conLuotGhi(ctx, cfg.policy)
    if (!(await ctx.kho.gianhKeHoach(plan.id))) return (await ctx.kho.layKeHoach(plan.id)) || plan

    const fb = dichVu(ctx, page.accessToken)
    let status = 'succeeded', result: any = null
    try {
        if (plan.kind === 'post') result = await dangBai(ctx, plan, page, fb, cfg.policy)
        else if (plan.kind === 'reply') ({ status, result } = await traLoiBinhLuan(ctx, plan, page, fb))
        else if (plan.kind === 'hide') result = await anBinhLuan(ctx, plan, fb)
        else throw new ToolError(`Loại kế hoạch lạ: ${plan.kind}`)
    } catch (e: any) {
        /* 09/11/2026 — phân loại theo MÃ lỗi Graph (services/platforms/facebook.loaiLoiFb). Trước đây mọi lỗi mang type
         * 'OAuthException' (cả #100 ảnh hỏng, #200 thiếu quyền, #4/#17/#32/#613 hạn mức) đều đánh dấu fanpage token_expired
         * ⇒ canPage chặn mọi chu kỳ sau tới khi chủ shop dán token mới. Giờ chỉ #190 / #102 mới đụng trạng thái trang. */
        const goc = String(e?.message || e).slice(0, 800)
        const loai = e instanceof ToolError ? 'khac' : loaiLoiFb(e)
        if (laLoiMang(e)) {
            status = 'uncertain'
            result = { message: `Không rõ Facebook đã nhận chưa (mất kết nối / hết giờ / Facebook lỗi máy chủ) — mở fanpage kiểm tra trước khi lập lại. (${goc})` }
        } else if (loai === 'tam_thoi') {
            // Facebook chưa nhận gì (từ chối hẳn vì hạn mức) ⇒ trả về NHÁP: lượt sau (hoặc người bấm lại) thử tiếp; trang giữ nguyên
            status = 'draft'
            result = { tamThoi: true, message: `Facebook đang giới hạn lượt gọi / lỗi tạm thời — giữ nháp, thử lại sau (fanpage vẫn bình thường). (${goc})` }
        } else {
            status = 'failed'
            result = { message: goc }
            if (loai === 'token') {
                await ctx.prisma.fbPage.update({ where: { pageId: page.pageId }, data: { status: 'token_expired' } }).catch(() => { })
                result.message = `Facebook từ chối token của fanpage — dán page token mới ở tab Kết nối. (${goc})`
            } else if (loai === 'quyen') {
                const q = quyenThieuFb(e)
                result.message = `Page token thiếu quyền${q ? ` ${q}` : ''} cho thao tác này — cấp lại quyền rồi dán token mới ở tab Kết nối. (${goc})`
            } else if (loai === 'du_lieu') {
                result.message = `Facebook từ chối dữ liệu của riêng kế hoạch này (ảnh / chữ / bình luận không còn) — fanpage vẫn chạy bình thường. (${goc})`
            }
        }
        await ctx.kho.ghiNhatKy({ action: plan.kind, status: status === 'draft' ? 'failed' : status, planId: plan.id, payload: { sku: plan.data?.sku, commentId: plan.data?.commentId }, response: result }).catch(() => { })
        if (!(e instanceof ToolError) && !e?.code) console.error(`[FacebookPilot] thực thi ${plan.kind} ${plan.id} lỗi:`, e?.message || e)
    }
    await ctx.kho.capNhatKeHoach(plan.id, status, result)
    return (await ctx.kho.layKeHoach(plan.id)) || { ...plan, status, result }
}

async function dangBai(ctx: NgCanhFb, plan: KeHoachFb, page: any, fb: DichVuFb, pol: ChinhSachFbPilot): Promise<any> {
    const now = luc(ctx)
    const d = plan.data || {}
    // Soát lại với kho HIỆN TẠI — kế hoạch có thể lập từ hôm trước
    const sp = await ctx.prisma.product.findUnique({ where: { id: String(d.productId || '') }, select: { id: true, sku: true, sellingPrice: true, stock: true, mergedIntoId: true } })
    if (!sp) throw new ToolError('Mã hàng không còn trong kho — không lên bài.')
    if (sp.mergedIntoId) throw new ToolError('Mã đã gộp vào mã khác từ lúc lập kế hoạch — lập lại bằng mã đích.')
    if (!(Number(sp.stock) >= pol.minStock)) throw new ToolError(`Tồn kho còn ${Number(sp.stock) || 0} — dưới mức ${pol.minStock} của chính sách, không lên bài.`)
    if (Math.abs((Number(sp.sellingPrice) || 0) - (Number(d.price) || 0)) >= 1) {
        throw new ToolError(`Giá bán đã đổi từ ${vnd(Number(d.price) || 0)} thành ${vnd(Number(sp.sellingPrice) || 0)} từ lúc lập kế hoạch — lập lại để bài ghi đúng giá.`)
    }
    const hen = d.scheduledAt ? Number(d.scheduledAt) : null
    if (hen && hen < now + 10 * 60_000) throw new ToolError(`Giờ hẹn ${ngayGioVN(hen)} đã qua hoặc cách hiện tại dưới 10 phút — Facebook không nhận. Lập lại kế hoạch.`)
    const media = (Array.isArray(d.mediaUrls) ? d.mediaUrls : []).filter((u: any) => /^https?:\/\//i.test(String(u)))
    // Có ảnh ⇒ LUÔN multi_photo: mã trả về là mã bài "<page>_<post>" (khớp scheduled_posts + /posts), không phải mã ảnh
    const mediaType = media.length ? 'multi_photo' : 'text'
    const r = await fb.createOrSchedulePost({ pageId: page.pageId, message: String(d.message || ''), mediaType, mediaUrls: media, scheduledAtMs: hen })
    const postId = String(r?.post_id || r?.id || '')
    const rec = await ctx.prisma.fbScheduledPost.create({
        data: {
            pageId: page.pageId, fbPostId: postId || null, message: String(d.message || ''),
            mediaType, mediaUrls: JSON.stringify(media), linkUrl: null,
            scheduledAt: new Date(hen || now), status: hen ? 'scheduled' : 'published', publishedAt: hen ? null : new Date(now),
            createdBy: ctx.nguoi ? String(ctx.nguoi).slice(0, 100) : 'facebook-pilot',
        },
    }).catch((e: any) => { console.error('[FacebookPilot] ghi FbScheduledPost lỗi:', e?.message || e); return null })
    await ctx.kho.ghiNhatKy({ action: 'post', status: 'succeeded', planId: plan.id, payload: { sku: d.sku, scheduledAt: hen }, response: { id: r?.id, post_id: r?.post_id } })
    return { postId, scheduledAt: hen, published: !hen, scheduledPostId: rec?.id || null }
}

const laTrungKhoa = (e: any) => e?.code === 'P2002' || /unique constraint|duplicate key/i.test(String(e?.message || ''))

async function traLoiBinhLuan(ctx: NgCanhFb, plan: KeHoachFb, page: any, fb: DichVuFb): Promise<{ status: string; result: any }> {
    const d = plan.data || {}
    if (d.productId) {
        const sp = await ctx.prisma.product.findUnique({ where: { id: String(d.productId) }, select: { sellingPrice: true } })
        if (sp && Math.abs((Number(sp.sellingPrice) || 0) - (Number(d.price) || 0)) >= 1) {
            throw new ToolError(`Giá bán đã đổi từ ${vnd(Number(d.price) || 0)} thành ${vnd(Number(sp.sellingPrice) || 0)} — soạn lại câu trả lời cho đúng giá.`)
        }
    }
    const khoa = { pageId_commentId: { pageId: page.pageId, commentId: String(d.commentId) } }
    // GIỮ CHỖ trong sổ chung với quy tắc tự trả lời TRƯỚC khi gọi Graph — trùng khoá = đã có bên trả lời rồi
    try {
        await ctx.prisma.fbAutoReplyLog.create({
            data: {
                pageId: page.pageId, commentId: String(d.commentId), postId: d.postId || null, fromName: d.fromName || null,
                commentMsg: String(d.commentMsg || '').slice(0, 1000), action: 'processing', success: false,
            },
        })
    } catch (e: any) {
        if (!laTrungKhoa(e)) throw e
        const result = { message: 'Bình luận này đã được trả lời (bởi Pilot hoặc quy tắc tự trả lời) — không trả lời lần hai.' }
        await ctx.kho.ghiNhatKy({ action: 'reply', status: 'skipped', planId: plan.id, payload: { commentId: d.commentId }, response: result })
        return { status: 'skipped', result }
    }
    try {
        const r = await fb.replyToComment(String(d.commentId), String(d.message))
        await ctx.prisma.fbAutoReplyLog.update({ where: khoa, data: { action: 'pilot_reply', replyText: String(d.message), success: true } }).catch(() => { })
        await ctx.kho.ghiNhatKy({ action: 'reply', status: 'succeeded', planId: plan.id, payload: { commentId: d.commentId }, response: { id: r?.id } })
        return { status: 'succeeded', result: { replyId: r?.id || null } }
    } catch (e: any) {
        // Facebook từ chối hẳn ⇒ trả chỗ trong sổ để lần sau thử lại được; mất mạng giữa chừng ⇒ GIỮ (có thể đã gửi)
        if (laLoiMang(e)) await ctx.prisma.fbAutoReplyLog.update({ where: khoa, data: { action: 'pilot_reply', replyText: String(d.message), success: false, errorMessage: 'không rõ đã gửi chưa' } }).catch(() => { })
        else await ctx.prisma.fbAutoReplyLog.delete({ where: khoa }).catch(() => { })
        throw e
    }
}

async function anBinhLuan(ctx: NgCanhFb, plan: KeHoachFb, fb: DichVuFb): Promise<any> {
    const d = plan.data || {}
    await fb.hideComment(String(d.commentId), true)
    await ctx.kho.ghiNhatKy({ action: 'hide', status: 'succeeded', planId: plan.id, payload: { commentId: d.commentId }, response: { hidden: true } })
    return { hidden: true }
}

// ─── Bình luận ──────────────────────────────────────────────────────────────────

/** Có số điện thoại Việt Nam (di động 10 số / cố định 11 số, cho phép dấu cách, chấm, gạch giữa các số). */
export function coSoDienThoai(chu: string): boolean {
    for (const m of String(chu || '').match(/\+?\d[\d\s.\-]{7,16}\d/g) || []) {
        const so = m.replace(/\D/g, '')
        if (/^(84\d{9}|0\d{9,10})$/.test(so)) return true
    }
    return false
}

const HOI_GIA_CO_DAU = /giá|bao nhiêu|bao tiền|nhiêu tiền|mấy tiền|còn hàng|còn không|còn ko\b|còn k\b/i
const HOI_GIA_KHONG_DAU = /\b(gia bao|gia sao|gia nhieu|gia the nao|gia ntn|xin gia|cho gia|check gia|bao nhieu|bao tien|nhieu tien|may tien|bn|ib|inb|inbox|con hang|con khong|con ko)\b/

/** Bình luận hỏi giá / hỏi còn hàng / xin inbox. "giá" phải có dấu (không dấu "gia" trùng "gia đình"). */
export function laHoiGia(chu: string): boolean {
    const s = String(chu || '')
    return HOI_GIA_CO_DAU.test(s) || HOI_GIA_KHONG_DAU.test(boDau(s))
}

/** Câu trả lời giá — CHỈ giá bán trong kho. Tồn dương mới nói "có hàng"; tồn ≤ 0 không nói "hết hàng". */
export function cauTraLoiGia(sp: { name: string; sellingPrice: number; stock: number }): string {
    const ten = tenGon(sp.name)
    return Number(sp.stock) > 0
        ? `Dạ ${ten} giá ${vnd(Number(sp.sellingPrice))}, shop đang có hàng ạ. ${CTA_TRA_LOI}`
        : `Dạ ${ten} giá ${vnd(Number(sp.sellingPrice))} ạ. Anh/chị nhắn tin cho shop để kiểm tra hàng giúp mình nhé.`
}

const dongDau = (msg: string) => tenGon(String(msg || '').split('\n')[0].replace(/^🔹\s*/, ''))

export interface BinhLuanFb {
    id: string
    message: string
    fromName: string | null
    fromId: string | null
    fromPage: boolean
    createdTime: number
    isHidden: boolean
    replies: number
    postId: string
    postTitle: string
    permalink: string | null
    askPrice: boolean
    hasPhone: boolean
    product: { productId: string; sku: string; name: string; price: number; stock: number } | null
    suggestion: string | null
    handled: { action: string; success: boolean } | null
    plan: { id: string; kind: string; status: string } | null
}

/** Bình luận mới trên các bài gần nhất (đọc thẳng Facebook) kèm cờ + gợi ý trả lời bằng giá thật. */
export async function docBinhLuan(ctx: NgCanhFb, o: { soBai?: number } = {}): Promise<{ comments: BinhLuanFb[]; soBai: number; thieuFrom: number; page: any }> {
    const { page } = await canPage(ctx)
    const fb = dichVu(ctx, page.accessToken)
    const soBai = Math.floor(kep(o.soBai, 15, 1, 25))
    const data = await fb.get(`${page.pageId}/posts`, {
        fields: 'id,message,created_time,permalink_url,comments.order(reverse_chronological).limit(25){id,message,from,created_time,is_hidden,comment_count}',
        limit: soBai,
    })
    const posts: any[] = data?.data || []

    // Bài → mã hàng: bài Pilot đã đăng (mã bài trong kết quả kế hoạch), rồi dòng đầu = tên hàng
    const theoBai = new Map<string, string>()
    for (const k of await ctx.kho.dsKeHoachBaiTu(luc(ctx) - 180 * 86400_000)) {
        if (k.status === 'succeeded' && k.result?.postId && k.data?.productId) theoBai.set(String(k.result.postId), String(k.data.productId))
    }
    const tenDau = [...new Set(posts.filter(p => !theoBai.has(String(p.id))).map(p => dongDau(p.message)).filter(t => t.length >= 4))]
    const idCan = [...new Set([...theoBai.values()])]
    const spDs: any[] = (idCan.length || tenDau.length) ? await ctx.prisma.product.findMany({
        where: { OR: [...(idCan.length ? [{ id: { in: idCan } }] : []), ...(tenDau.length ? [{ name: { in: tenDau } }] : [])], ...DIEU_KIEN_HANG },
        select: { id: true, sku: true, name: true, sellingPrice: true, stock: true },
    }) : []
    const spTheoId = new Map(spDs.map(s => [String(s.id), s]))
    const spTheoTen = new Map(spDs.map(s => [tenGon(s.name), s]))

    const tho: { c: any; p: any }[] = []
    for (const p of posts) for (const c of p.comments?.data || []) tho.push({ c, p })
    const ids = tho.map(x => String(x.c.id))
    const daXuLy: any[] = ids.length ? await ctx.prisma.fbAutoReplyLog.findMany({ where: { pageId: page.pageId, commentId: { in: ids } }, select: { commentId: true, action: true, success: true } }).catch(() => []) : []
    const soCu = new Map(daXuLy.map(r => [String(r.commentId), r]))
    const khCu = new Map<string, KeHoachFb>()
    for (const k of await ctx.kho.dsKeHoachBinhLuan(ids)) if (!khCu.has(String(k.data?.commentId))) khCu.set(String(k.data.commentId), k)

    let thieuFrom = 0
    const comments: BinhLuanFb[] = tho.map(({ c, p }) => {
        const idSp = theoBai.get(String(p.id))
        const s = (idSp && spTheoId.get(idSp)) || spTheoTen.get(dongDau(p.message)) || null
        const msg = String(c.message || '')
        const hoiGia = laHoiGia(msg)
        if (!c.from) thieuFrom++
        const so = soCu.get(String(c.id))
        const kh = khCu.get(String(c.id))
        return {
            id: String(c.id), message: msg, fromName: c.from?.name || null, fromId: c.from?.id ? String(c.from.id) : null,
            fromPage: !!c.from?.id && String(c.from.id) === String(page.pageId),
            createdTime: Date.parse(c.created_time) || 0, isHidden: !!c.is_hidden, replies: Number(c.comment_count) || 0,
            postId: String(p.id), postTitle: dongDau(p.message).slice(0, 120), permalink: p.permalink_url || null,
            askPrice: hoiGia, hasPhone: coSoDienThoai(msg),
            product: s ? { productId: String(s.id), sku: s.sku, name: tenGon(s.name), price: Number(s.sellingPrice) || 0, stock: Number(s.stock) || 0 } : null,
            suggestion: hoiGia && s && Number(s.sellingPrice) > 0 ? cauTraLoiGia(s) : null,
            handled: so ? { action: String(so.action), success: !!so.success } : null,
            plan: kh ? { id: kh.id, kind: kh.kind, status: kh.status } : null,
        }
    })
    comments.sort((a, b) => b.createdTime - a.createdTime)
    return { comments, soBai: posts.length, thieuFrom, page: pageAnToan(page) }
}

// ─── Chu kỳ ─────────────────────────────────────────────────────────────────────

/**
 * Kế hoạch còn mở (09/11/2026, chép tinh thần donKeHoachMo của Shopee Pilot) — trước đây nằm im mãi:
 *   - 'running' quá 1 giờ ⇒ 'uncertain' + việc cần người (máy chết giữa lượt ghi, bài có thể đã lên) — KHÔNG tự đăng lại
 *   - nháp MÁY lập (khoá 'cycle:') đã quá giờ hẹn (Facebook không nhận giờ cách < 10 phút) hoặc quá 3 ngày ⇒ tự huỷ, ghi lý do.
 *     Nháp NGƯỜI lập không bao giờ tự huỷ.
 *   - chế độ Tự động mà còn nháp của lượt Xem trước (khoá 'cycle:xem:') ⇒ huỷ để lập lại theo giá / tồn / khung giờ hiện tại
 * Trả: mã hàng / bình luận chu kỳ phải né (kế hoạch còn mở, hoặc nháp máy bị NGƯỜI huỷ trong 14 ngày), và — chỉ Tự động — nháp
 * máy còn hạn cần thực thi lại: bài hụt lượt ghi ở lượt trước, việc Facebook từng từ chối vì giới hạn lượt gọi (result.tamThoi).
 */
async function donKeHoachMoFb(ctx: NgCanhFb, tuDong: boolean, results: any[], now: number): Promise<NeKeHoachFb & { thuLai: KeHoachFb[] }> {
    const ne: NeKeHoachFb = { maHang: new Set(), binhLuan: new Set() }
    const thuLai: KeHoachFb[] = []
    let soHuy = 0
    for (const k of await ctx.kho.dsKeHoachMo(now - NHO_NGUOI_HUY_MS)) {
        if (k.status === 'cancelled') {
            // người huỷ nháp máy đề xuất = "đừng làm" ⇒ nhớ; máy tự huỷ (quá hạn / Xem trước) thì lượt sau được lập lại
            if (laNhapMay(k) && !k.result?.tuHuy) themNe(ne, k)
            continue
        }
        if (k.status === 'running') {
            if (now - k.updatedAt > KET_THUC_THI_MS) {
                const kiem = k.kind === 'post' ? 'mở fanpage kiểm bài đã lên chưa' : k.kind === 'reply' ? 'mở bài kiểm câu trả lời đã có chưa' : 'mở bài kiểm bình luận đã ẩn chưa'
                const message = `Lượt thực thi dừng giữa chừng quá 1 giờ (máy chủ khởi động lại?) — không rõ Facebook đã nhận chưa: ${kiem}. Máy không tự làm lại.`
                await ctx.kho.capNhatKeHoach(k.id, 'uncertain', { message })
                results.push({ action: k.kind, status: 'uncertain', sku: k.data?.sku || null, planId: k.id, message })
            }
            themNe(ne, k)
            continue
        }
        if (laNhapMay(k)) {
            const hen = Number(k.data?.scheduledAt) || 0
            const quaGio = hen > 0 && hen < now + 10 * 60_000
            const quaHan = now - k.createdAt > HAN_NHAP_MAY_MS
            if (quaGio || quaHan || (tuDong && laNhapXemTruoc(k))) {
                const message = quaGio ? `Nháp máy lập đã quá giờ hẹn ${ngayGioVN(hen)} — tự huỷ; chu kỳ lập lại vào khung giờ còn trống.`
                    : quaHan ? 'Nháp máy lập quá 3 ngày chưa thực thi — tự huỷ; chu kỳ lập lại theo giá / tồn hiện tại nếu vẫn cần.'
                        : 'Nháp của lượt Xem trước — chế độ Tự động lập lại theo giá / tồn / khung giờ hiện tại.'
                if (await ctx.kho.huyKeHoach(k.id, { message, tuHuy: true })) soHuy++
                continue
            }
            // nháp máy của lượt Tự động: bài (hụt lượt ghi / chưa kịp thực thi) hoặc việc Facebook từng báo "thử lại sau"
            if (tuDong && !laNhapXemTruoc(k) && (k.kind === 'post' || k.result?.tamThoi)) thuLai.push(k)
        }
        themNe(ne, k)
    }
    if (soHuy) results.push({ action: 'plan', status: 'skipped', message: `Huỷ ${soHuy} nháp cũ của máy (quá giờ hẹn / quá 3 ngày / còn từ lượt Xem trước).` })
    return { ...ne, thuLai }
}

export async function chayChuKyFb(ctx: NgCanhFb): Promise<any> {
    const now = luc(ctx)
    const { cfg, page } = await canPage(ctx)
    const pol = cfg.policy
    const tuDong = cfg.executionMode === 'auto'
    // khoá riêng cho lượt Xem trước — sang Tự động, nháp xem trước bị huỷ mà khoá không chặn lập lại (09/11/2026)
    const tienTo = tuDong ? 'cycle' : 'cycle:xem'
    const results: any[] = []

    if (page.tokenExpiresAt) {
        const con = Math.floor((new Date(page.tokenExpiresAt).getTime() - now) / 86400_000)
        if (con <= 7) results.push({ action: 'token', status: 'skipped', message: `Page token còn khoảng ${Math.max(0, con)} ngày — dán token mới ở tab Kết nối trước khi hết hạn, kẻo bài hẹn giờ không lên.` })
    }

    const mo = await donKeHoachMoFb(ctx, tuDong, results, now)
    /** Facebook giới hạn lượt gọi (#4/#17/#32/#613…) ⇒ LÙI: lượt này không ghi / lập thêm gì, lượt sau làm tiếp. */
    let tamDung: string | null = null
    const xemTamDung = (p: any) => { if (p?.status === 'draft' && p?.result?.tamThoi) tamDung = String(p.result.message || 'Facebook đang giới hạn lượt gọi') }
    // giờ hẹn gần trước (hạn mức ghi mỗi ngày có hạn); việc bình luận (không hẹn giờ) làm trước hết
    mo.thuLai.sort((a, b) => (Number(a.data?.scheduledAt) || 0) - (Number(b.data?.scheduledAt) || 0))
    for (const k of mo.thuLai) {
        if (tamDung) break
        try {
            const r: any = await thucThiFb(ctx, k.id, { tuDong: true })
            const p = r.plan || r
            xemTamDung(p)
            const hen = Number(k.data?.scheduledAt) || 0
            results.push({
                action: k.kind, status: p.status, sku: k.data?.sku || null, planId: k.id,
                message: `Thực thi lại nháp máy${k.data?.name ? ` ${k.data.name}` : ''}${hen ? ` · hẹn ${ngayGioVN(hen)}` : ''}${p.result?.message ? ` — ${p.result.message}` : ''}`,
            })
        } catch (e: any) {
            // hết lượt ghi hôm nay ⇒ nháp nằm chờ (quá giờ hẹn thì tự huỷ) — mục lên bài bên dưới tự báo hạn mức nếu còn lập bài
            if (e?.hetLuotGhi) break
            results.push({ action: k.kind, status: 'failed', sku: k.data?.sku || null, planId: k.id, message: String(e?.message || e).slice(0, 300) })
        }
    }

    if (pol.automation.posts && pol.postsPerDay > 0 && !tamDung) {
        const hoSo = await docHoSo(ctx.prisma)
        const ban = await gioDaCo(ctx, page.pageId, now)
        const slots = khungGioTrong(now, gioDang(pol, hoSo), pol, ban)
        if (!slots.length) {
            results.push({ action: 'post', status: 'unchanged', message: `3 ngày tới đã đủ ${pol.postsPerDay} bài/ngày (hoặc không còn khung giờ cách các bài khác ≥ ${pol.minGapMinutes} phút).` })
        } else {
            const uv = await timUngVienFb(ctx, pol, { lim: slots.length, hoSo, neMa: mo.maHang })
            const n = Math.min(slots.length, uv.ungVien.length, TRAN_BAI_MOI_CHU_KY)
            for (let i = 0; i < n; i++) {
                if (tamDung) break
                const u = uv.ungVien[i]
                const t = slots[i]
                try {
                    let plan: any = await taoKeHoachBai(ctx, { sku: u.sku, scheduledAt: t, idempotencyKey: `${tienTo}:post:${u.productId}:${t}` })
                    if (tuDong && plan.status === 'draft') plan = await thucThiFb(ctx, plan.id, { tuDong: true })
                    const p = plan.plan || plan
                    xemTamDung(p)
                    results.push({
                        action: 'post', status: p.status, sku: u.sku, planId: p.id,
                        message: `${u.name} · ${vnd(u.price)} · hẹn ${ngayGioVN(t)}${p.result?.message ? ` — ${p.result.message}` : ''}`,
                    })
                } catch (e: any) {
                    results.push({ action: 'post', status: 'failed', sku: u.sku, message: String(e?.message || e).slice(0, 300) })
                }
            }
            if (!uv.ungVien.length) {
                const l = uv.loaiTru
                results.push({
                    action: 'post', status: 'unchanged',
                    message: `Không còn mặt hàng đủ điều kiện lên bài (soát ${uv.daXet} mã còn tồn ≥ ${pol.minStock} có giá): ${l.thieuAnh} chưa có ảnh, ${l.anhKhongDung} chỉ có ảnh WebP/HEIC, ${l.daDangGanDay} đã lên bài trong ${pol.repostAfterDays} ngày, ${l.dangCoKeHoach} đang có kế hoạch / người vừa huỷ đề xuất, ${l.tuCam} dính từ cấm.`,
                })
            } else if (slots.length > n && uv.ungVien.length > n) {
                results.push({ action: 'post', status: 'skipped', message: `Mỗi chu kỳ lập tối đa ${TRAN_BAI_MOI_CHU_KY} bài — chu kỳ sau lập tiếp.` })
            }
        }
    }

    if ((pol.automation.replyPriceQuestions || pol.automation.hidePhoneComments) && !tamDung) {
        let bl: Awaited<ReturnType<typeof docBinhLuan>> | null = null
        try { bl = await docBinhLuan(ctx, { soBai: 10 }) } catch (e: any) {
            // giới hạn lượt gọi ⇒ lượt sau đọc lại, khỏi báo chủ shop như hỏng
            results.push({ action: 'comments', status: isRateLimitError(e) ? 'skipped' : 'failed', message: `Không đọc được bình luận: ${String(e?.message || e).slice(0, 300)}` })
        }
        if (bl) {
            let soTraLoi = 0, soAn = 0
            for (const c of bl.comments) {
                if (tamDung) break
                if (c.handled || c.plan || c.fromPage) continue
                // nháp máy cho bình luận này bị NGƯỜI huỷ (14 ngày) ⇒ không đề xuất lại — kể cả khi vừa đổi Xem trước → Tự động
                if (mo.binhLuan.has(c.id)) continue
                if (now - c.createdTime > 3 * 86400_000) continue
                if (pol.automation.hidePhoneComments && c.hasPhone && !c.isHidden && c.fromId) {
                    try {
                        let plan: any = await taoKeHoachAn(ctx, { commentId: c.id, postId: c.postId, commentMsg: c.message, fromName: c.fromName, reason: 'Bình luận lộ số điện thoại', idempotencyKey: `${tienTo}:hide:${c.id}` })
                        if (tuDong && plan.status === 'draft') plan = await thucThiFb(ctx, plan.id, { tuDong: true })
                        const p = plan.plan || plan
                        xemTamDung(p)
                        soAn++
                        results.push({ action: 'hide', status: p.status, planId: p.id, message: `Ẩn bình luận có số điện thoại của ${c.fromName || 'khách'} trên "${c.postTitle.slice(0, 50)}"${p.result?.message ? ` — ${p.result.message}` : ''}` })
                    } catch (e: any) {
                        results.push({ action: 'hide', status: 'failed', message: String(e?.message || e).slice(0, 300) })
                    }
                }
                if (tamDung) break
                if (pol.automation.replyPriceQuestions && c.askPrice && c.suggestion && c.product && soTraLoi < pol.maxRepliesPerCycle) {
                    // Máy chỉ TỰ GỬI khi chắc là khách, chưa ai trả lời, và tồn dương — còn lại để nháp chờ người duyệt
                    const choDuyet = !c.fromId ? 'không rõ người viết (token thiếu quyền đọc người bình luận)'
                        : c.replies > 0 ? 'bình luận đã có người trả lời'
                            : !(c.product.stock > 0) ? `tồn kho ${c.product.stock} — kiểm hàng trước khi trả lời`
                                : null
                    try {
                        let plan: any = await taoKeHoachTraLoi(ctx, {
                            commentId: c.id, message: c.suggestion, postId: c.postId, commentMsg: c.message, fromName: c.fromName,
                            productId: c.product.productId, sku: c.product.sku, price: c.product.price, idempotencyKey: `${tienTo}:reply:${c.id}`,
                        })
                        if (tuDong && !choDuyet && plan.status === 'draft') plan = await thucThiFb(ctx, plan.id, { tuDong: true })
                        const p = plan.plan || plan
                        xemTamDung(p)
                        soTraLoi++
                        results.push({
                            action: 'reply', status: p.status, planId: p.id, sku: c.product.sku,
                            message: `${c.fromName || 'Khách'}: "${c.message.slice(0, 60)}" → giá ${vnd(c.product.price)}${p.result?.message ? ` — ${p.result.message}` : ''}${tuDong && choDuyet ? ` — CHỜ NGƯỜI DUYỆT: ${choDuyet}` : ''}`,
                        })
                    } catch (e: any) {
                        results.push({ action: 'reply', status: 'failed', message: String(e?.message || e).slice(0, 300) })
                    }
                }
            }
            if (!soTraLoi && !soAn) results.push({ action: 'comments', status: 'unchanged', message: `Soát ${bl.comments.length} bình luận trên ${bl.soBai} bài gần nhất: không có gì cần xử lý.` })
            if (bl.thieuFrom && bl.thieuFrom === bl.comments.length) {
                results.push({ action: 'comments', status: 'skipped', message: 'Token không đọc được người bình luận (thiếu quyền pages_read_user_content) — máy không tự trả lời / ẩn được, chỉ lập nháp.' })
            }
        }
    }
    // 'skipped' (không phải 'failed'): hạn mức tự hồi, fanpage vẫn bình thường — khỏi báo chủ shop như hỏng (09/11/2026)
    if (tamDung) results.push({ action: 'cycle', status: 'skipped', message: `${tamDung} — lượt này dừng ghi; nháp giữ nguyên, lượt sau làm tiếp.`.slice(0, 400) })
    if (!results.length) results.push({ action: 'cycle', status: 'unchanged', message: 'Chính sách đang tắt cả lên bài lẫn xử lý bình luận.' })
    return { executionMode: cfg.executionMode, results }
}

// ─── Kiểm tra kết nối (chỉ đọc) ─────────────────────────────────────────────────

export async function kiemKetNoiFb(ctx: NgCanhFb): Promise<any> {
    const now = luc(ctx)
    const { page } = await docCauHinhFb(ctx).then(r => {
        if (!r.page) throw new ToolError(r.pages.length ? 'Chọn fanpage cho Pilot trước (Tự động hóa → Sửa chính sách).' : 'Cửa hàng chưa nối fanpage nào — dán page token trước.')
        return r
    })
    const fb = dichVu(ctx, page.accessToken)
    const buoc: { ten: string; ok: boolean; chiTiet: string }[] = []
    const thu = async (ten: string, f: () => Promise<string>) => {
        try { buoc.push({ ten, ok: true, chiTiet: await f() }) } catch (e: any) { buoc.push({ ten, ok: false, chiTiet: String(e?.message || e).slice(0, 300) }) }
    }
    await thu('Token là PAGE token của đúng fanpage', async () => {
        const t = await fb.identifyToken()
        if (t.type && t.type !== 'page') throw new Error(`Đây là token loại "${t.type}", không phải page token.`)
        if (String(t.id) !== String(page.pageId)) throw new Error(`Token thuộc page ${t.id}, không phải ${page.pageId}.`)
        return t.name || page.name
    })
    let coBinhLuan = 0, coNguoi = 0
    await thu('Đọc bài viết (pages_read_engagement)', async () => {
        const r = await fb.get(`${page.pageId}/posts`, { fields: 'id,comments.limit(10){id,from}', limit: 5 })
        const ds: any[] = r?.data || []
        for (const p of ds) for (const c of p.comments?.data || []) { coBinhLuan++; if (c.from) coNguoi++ }
        return `${ds.length} bài gần nhất`
    })
    buoc.push(coBinhLuan === 0
        ? { ten: 'Đọc người bình luận (pages_read_user_content)', ok: true, chiTiet: 'Chưa có bình luận nào trên 5 bài gần nhất để thử.' }
        : coNguoi > 0
            ? { ten: 'Đọc người bình luận (pages_read_user_content)', ok: true, chiTiet: `${coNguoi}/${coBinhLuan} bình luận đọc được người viết.` }
            : { ten: 'Đọc người bình luận (pages_read_user_content)', ok: false, chiTiet: `0/${coBinhLuan} bình luận đọc được người viết — thiếu quyền này thì máy không phân biệt khách với page, chỉ lập nháp trả lời.` })
    await thu('Đọc bài đã hẹn giờ (scheduled_posts)', async () => `${(await fb.listScheduledPosts(page.pageId)).length} bài đang hẹn`)
    const het = page.tokenExpiresAt ? new Date(page.tokenExpiresAt).getTime() : null
    buoc.push(het
        ? { ten: 'Hạn token', ok: het - now > 7 * 86400_000, chiTiet: `còn khoảng ${Math.max(0, Math.floor((het - now) / 86400_000))} ngày (token dán tay không tự gia hạn)` }
        : { ten: 'Hạn token', ok: true, chiTiet: 'không ghi hạn (token không hết hạn hoặc đã gia hạn qua tài khoản)' })
    return { page: page.name, pageId: page.pageId, dat: buoc.filter(b => b.ok).length, tong: buoc.length, buoc }
}

// ─── Cấu hình ───────────────────────────────────────────────────────────────────

export async function luuCauHinhFb(ctx: NgCanhFb, b: any): Promise<CauHinhFbPilot> {
    const { cfg, pages } = await docCauHinhFb(ctx)
    let pageId = cfg.pageId
    if (b?.pageId !== undefined) {
        if (b.pageId && !pages.some(p => String(p.pageId) === String(b.pageId))) throw new ToolError('Fanpage không thuộc cửa hàng này (hoặc đã ngắt kết nối).')
        pageId = b.pageId ? String(b.pageId) : null
    }
    const executionMode = b?.executionMode === 'auto' ? 'auto' : b?.executionMode === 'preview' ? 'preview' : cfg.executionMode
    const policy = chuanHoaChinhSachFb({ ...cfg.policy, ...(b?.policy || {}), automation: { ...cfg.policy.automation, ...(b?.policy?.automation || {}) } })
    const schedule = b?.schedule ? chuanHoaLichFb({ ...cfg.schedule, ...b.schedule }) : cfg.schedule
    /* Lịch bật mới / đổi nhịp ⇒ lượt kế = bây giờ + nhịp. Giữ nguyên ⇒ giữ lượt đã hẹn. Tắt ⇒ bỏ hẹn. */
    const doiLich = schedule.enabled !== cfg.schedule.enabled || schedule.intervalMinutes !== cfg.schedule.intervalMinutes
    const nextRunAt = !schedule.enabled ? null : (!doiLich && cfg.nextRunAt) ? cfg.nextRunAt : luc(ctx) + schedule.intervalMinutes * 60_000
    const moi: CauHinhFbPilot = { ...cfg, pageId, executionMode, policy, schedule, nextRunAt, updatedAt: Date.now() }
    await ctx.kho.luuCauHinh(moi)
    /* Xem trước → Tự động (09/11/2026): nháp của lượt Xem trước soạn theo giá / tồn / khung giờ LÚC ĐÓ — huỷ ngay để chu kỳ Tự động
     * lập lại theo số hiện tại; trước đây chúng giữ chỗ khung giờ + chặn mã 21 ngày nên chu kỳ Tự động đầu không đăng được bài nào.
     * Hỏng ở đây không chặn lưu cấu hình — chu kỳ (donKeHoachMoFb) dọn lại lần nữa. */
    if (executionMode === 'auto' && cfg.executionMode !== 'auto') {
        try {
            for (const k of await ctx.kho.dsKeHoachMo(luc(ctx))) {
                if (k.status === 'draft' && laNhapXemTruoc(k)) {
                    await ctx.kho.huyKeHoach(k.id, { message: 'Nháp của lượt Xem trước — chế độ Tự động lập lại theo giá / tồn / khung giờ hiện tại.', tuHuy: true })
                }
            }
        } catch (e: any) {
            console.error('[FacebookPilot] huỷ nháp Xem trước khi bật Tự động lỗi:', e?.message || e)
        }
    }
    return moi
}

// ─── Trợ giúp form ──────────────────────────────────────────────────────────────

/** Tìm hàng để lên bài (tên / mã), kèm lý do chưa lên được. */
export async function timHangFb(ctx: NgCanhFb, b: { keyword: string }): Promise<{ products: any[] }> {
    const tu = String(b?.keyword || '').trim().slice(0, 80)
    if (tu.length < 2) return { products: [] }
    const { cfg } = await docCauHinhFb(ctx)
    const rows: any[] = await ctx.prisma.product.findMany({
        where: { ...DIEU_KIEN_HANG, OR: [{ name: { contains: tu, mode: 'insensitive' } }, { sku: { contains: tu, mode: 'insensitive' } }] },
        select: { id: true, sku: true, name: true, sellingPrice: true, stock: true, productType: true, mergedIntoId: true, bundleId: true, images: { select: { url: true, isPrimary: true } } },
        orderBy: { stock: 'desc' }, take: 30,
    })
    const daDang = await maDaDangGanDay(ctx, cfg.policy, luc(ctx))
    return {
        products: rows.map(r => ({
            sku: r.sku, name: tenGon(r.name), price: Number(r.sellingPrice) || 0, stock: Number(r.stock) || 0,
            image: anhHopLe(r.images || [], 1)[0] || null, postedRecently: daDang.has(r.id),
            reason: lyDoKhongDang(r, cfg.policy),
        })),
    }
}

/** Bài soạn sẵn cho một mã + giờ trống gần nhất — để form lên bài hiện trước khi lập kế hoạch. */
export async function xemTruocBai(ctx: NgCanhFb, b: { sku: string }): Promise<any> {
    const now = luc(ctx)
    const { cfg, page } = await canPage(ctx)
    const sp = await motHang(ctx, b?.sku)
    if (!sp) throw new ToolError(`Không thấy mã hàng "${b?.sku}" trong kho.`)
    const hoSo = await docHoSo(ctx.prisma)
    const bai = soanBai(sp, cfg.policy, hoSo)
    const [slot] = khungGioTrong(now, gioDang(cfg.policy, hoSo), cfg.policy, await gioDaCo(ctx, page.pageId, now))
    return {
        sku: sp.sku, name: tenGon(sp.name), price: Number(sp.sellingPrice) || 0, stock: Number(sp.stock) || 0,
        message: bai.message, bannedWords: bai.tuCam, images: anhHopLe(sp.images || [], cfg.policy.maxImages),
        reason: lyDoKhongDang(sp, cfg.policy), nextSlot: slot ?? null,
    }
}

// ─── Chạy theo lịch (gọi từ cron/aiAgentCron) ───────────────────────────────────

/**
 * Chạy MỘT chu kỳ nếu tới hẹn. Cửa hàng chưa từng dùng Facebook Pilot thì bảng không tồn tại ⇒ im lặng trả
 * 'khong-dung' (KHÔNG tạo bảng hộ). Giành lượt bằng cách dời nextRunAt nguyên tử — nhiều bản máy chỉ một bản chạy.
 */
export async function chayTheoLichFb(prisma: any, kho?: KhoFbPilot, ngoai: Partial<NgCanhFb> = {}): Promise<'khong-dung' | 'chua-toi' | 'bi-gianh' | 'da-chay' | 'loi'> {
    const now = ngoai.bayGio ? ngoai.bayGio() : Date.now()
    let den: number, lich: LichFb
    if (kho) {
        const c = await kho.docCauHinh()
        if (!c || c.nextRunAt == null) return 'khong-dung'
        den = c.nextRunAt; lich = c.schedule
    } else {
        let r: any
        try {
            [r] = await prisma.$queryRawUnsafe(`SELECT "nextRunAt"::float8 AS "nextRunAt", schedule FROM "FacebookPilotConfig" WHERE id = 'default'`)
        } catch {
            return 'khong-dung'
        }
        if (!r || r.nextRunAt == null) return 'khong-dung'
        den = Number(r.nextRunAt); lich = chuanHoaLichFb(docJson(r.schedule, {}))
    }
    if (!lich.enabled) return 'khong-dung'
    if (den > now) return 'chua-toi'
    const k = kho || khoSqlFb(prisma)
    if (!(await k.gianhLich(den, now + lich.intervalMinutes * 60_000))) return 'bi-gianh'
    const truoc = (await k.docCauHinh().catch(() => null))?.lastResult?.baoChuShop
    let ketQua: any
    try {
        const kq = await chayChuKyFb({ ...ngoai, prisma, kho: k, nguoi: 'lich' })
        ketQua = { ok: true, executionMode: kq.executionMode, results: kq.results }
    } catch (e: any) {
        ketQua = { ok: false, message: String(e?.message || e).slice(0, 500) }
    }
    // Xem trước chưa đăng gì — chỉ chu kỳ gãy (token hết hạn…) mới báo; Tự động thì báo mọi việc cần người (lib/pilotBaoChuShop)
    const bao = ketQua.ok && ketQua.executionMode !== 'auto' ? truoc : await baoChuShop(prisma, 'Facebook Pilot', ketQua, truoc, now).catch(() => truoc)
    await k.ghiKetQuaLich(now, { ...ketQua, ...(bao ? { baoChuShop: bao } : {}) }).catch(() => { })
    return ketQua.ok ? 'da-chay' : 'loi'
}

export const HUONG_DAN_FB_PILOT = `FACEBOOK PILOT TRÊN KENGI

Pilot lên bài sản phẩm cho fanpage và xử lý bình luận, dữ liệu lấy thẳng từ kho của cửa hàng — tên, giá, mô tả, ảnh đều là số thật.

1. Kết nối
   - Mở kengi.vn → Bán Hàng Online → Facebook Pilot (https://kengi.vn/pilot-facebook/), đăng nhập bằng tài khoản Kengi.
   - Tab Kết nối: dán PAGE token (Graph API Explorer → chọn app → ô bên dưới chọn đúng PAGE, không để "User Token" → Generate;
     rồi Access Token Debugger → Extend để được token ~60 ngày). Cần các quyền pages_show_list, pages_read_engagement,
     pages_manage_posts, pages_manage_engagement, pages_read_user_content.
   - Token dán tay không tự gia hạn: Pilot nhắc trước 7 ngày, dán token mới là xong.
   - Bấm "Kiểm tra kết nối": gọi chỉ đọc từng quyền (đọc bài, đọc người bình luận, bài đã hẹn giờ, hạn token).

2. Bài đăng
   - Chỉ hàng hoá còn tồn (≥ mức tối thiểu trong chính sách), có giá bán, có ảnh JPG/PNG. Ảnh WebP / HEIC Facebook không nhận.
   - Bài gồm tên hàng, giá bán, mô tả trong kho (rút gọn), câu kêu gọi và hashtag (lấy từ chính sách, không có thì từ hồ sơ thương hiệu
     của Content AI). Pilot KHÔNG thêm lời hứa nào (giao toàn quốc, chính hãng, còn hàng…) — muốn có thì ghi vào mô tả hoặc câu kêu gọi.
   - Một mã không lên lại trong N ngày (chính sách). Từ cấm trong hồ sơ thương hiệu thì không lập kế hoạch.
   - Khung giờ: theo giờ đăng trong chính sách (trống thì giờ vàng của hồ sơ thương hiệu, không có nữa thì 9h, 12h, 20h), mỗi ngày tối đa
     N bài — đếm cả bài Kengi khác đã hẹn — và các bài cách nhau tối thiểu X phút.
   - Lúc thực thi máy chủ soát lại: hàng còn tồn, giá chưa đổi từ lúc lập kế hoạch, giờ hẹn còn cách ≥ 10 phút. Sai một điều là không đăng.

3. Bình luận
   - Tab Bình luận đọc bình luận mới trên 15 bài gần nhất, đánh dấu: hỏi giá / xin inbox, có số điện thoại, đã có người trả lời.
   - Bài do Pilot đăng (hoặc bài có dòng đầu là tên hàng) được nối về mã hàng ⇒ gợi ý câu trả lời bằng GIÁ THẬT trong kho.
     Tồn dương mới nói "có hàng"; tồn ≤ 0 không nói "hết hàng", chỉ mời khách nhắn tin.
   - Mỗi bình luận chỉ được trả lời MỘT lần — dùng chung sổ với Quy tắc tự trả lời của Fanpage Manager.
   - Ẩn bình luận có số điện thoại: bảo vệ thông tin khách (người khác không đọc được số), khách vẫn thấy bình luận của mình.

4. Kế hoạch → thực thi
   - Mọi thao tác ghi tạo KẾ HOẠCH trước. Chế độ Xem trước: thực thi không gọi Facebook. Chế độ Tự động: thực thi đăng / trả lời thật.
   - Giới hạn: số thao tác ghi mỗi ngày, số câu trả lời mỗi chu kỳ.
   - Lỗi Facebook xét theo MÃ: chỉ #190 / #102 là token hỏng (fanpage chuyển "token hết hạn", dán token mới). Giới hạn lượt gọi
     (#4, #17, #32, #613) ⇒ giữ nháp, lượt sau thử lại, fanpage vẫn bình thường. Thiếu quyền (#10, #200–299) ⇒ báo tên quyền.
     #100 ⇒ hỏng riêng kế hoạch đó. Hết giờ / Facebook lỗi máy chủ khi đang ghi ⇒ "không rõ kết quả": mở fanpage kiểm, máy không tự làm lại.

5. Chu kỳ
   - Lập bài cho các khung giờ trống trong 3 ngày tới (tối đa 6 bài mỗi chu kỳ), soát bình luận 10 bài gần nhất (nếu bật).
   - Máy tự trả lời chỉ khi: biết chắc người viết là khách, bình luận chưa có ai trả lời, hàng tồn dương. Còn lại để nháp chờ người duyệt.
   - Chạy theo lịch: bật ở Sửa chính sách (mỗi 60–1440 phút), máy chủ tự chạy, không cần mở trang.
   - Dọn kế hoạch mỗi chu kỳ: nháp MÁY lập quá giờ hẹn hoặc quá 3 ngày thì tự huỷ (nháp người lập giữ nguyên); thực thi kẹt quá 1 giờ
     ⇒ "không rõ kết quả" để người kiểm. Chuyển Xem trước → Tự động: nháp của lượt Xem trước bị huỷ, chu kỳ lập lại theo số hiện tại.
   - Người huỷ nháp máy đề xuất ⇒ máy không đề xuất lại mã / bình luận đó trong 14 ngày. Chỉ bài ĐÃ gửi Facebook mới tính vào
     "không lên lại trong N ngày"; nháp còn hạn chỉ giữ khung giờ của nó.

6. Chưa làm
   - Nhắn tin Messenger cho khách: cần app Facebook được duyệt quyền pages_messaging.
`
