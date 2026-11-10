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
 *    - (09/11/2026) bài HẸN đã giao cho Facebook được soát lại lần nữa TRƯỚC GIỜ LÊN ~1 tiếng (soatBaiHenSapLen, nhịp ngoài mỗi
 *      phút): mã không còn / gộp, tồn < mức tối thiểu, hay giá đổi mà chữ bài còn ghi giá cũ ⇒ RÚT (xoá bài hẹn chưa lên) + báo
 *      chủ shop; không rút được ⇒ báo KHẨN để xoá tay. Trước đây chỉ soát lúc giao — bài hẹn 3 ngày lên với giá / tồn cũ.
 *    - (10/11/2026, FB-15) bài Pilot ĐÃ LÊN mà giá bán trong kho đổi ⇒ chu kỳ sửa dòng "Giá: …" Pilot viết trên bài (kế hoạch 'edit',
 *      POST /{post-id} — Facebook chỉ cho sửa bài do chính app tạo). Đọc chữ SỐNG trước khi sửa; chữ không còn đúng dòng giá Pilot
 *      viết (người đã sửa tay) ⇒ không đụng. Tồn ≤ 0 KHÔNG được ghi "hết hàng" lên bài (tồn ≤ 0 không chứng minh hết) — chỉ nêu.
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
import { baoChuShop, ketQuaDeBao, NHOM_PILOT, duongPilotCuaTieuDe } from './pilotBaoChuShop'
import { ghiDoiCauHinh, NHAN_FACEBOOK } from './pilotDoiCauHinh'

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
/** JSON với khoá xếp thứ tự — hai giá trị cùng nội dung ra cùng chuỗi (kho bộ nhớ so như `result::jsonb IS NOT DISTINCT FROM`). */
const jsonChuan = (v: any): string => JSON.stringify(v ?? null, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x)
    ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x))
/** Bảng chưa tồn tại (Postgres 42P01 / Prisma P2021) = cửa hàng chưa từng dùng tính năng. Lỗi khác (sai tên cột 42703…) KHÔNG
 *  tính — nuốt nó là nhịp soát im lặng chết hẳn. */
export function laThieuBang(e: any): boolean {
    const ma = String(e?.meta?.code || e?.code || '')
    return ma === '42P01' || ma === 'P2021' || /relation "[^"]+" does not exist/i.test(String(e?.meta?.message || e?.message || ''))
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
    /** editPrices (10/11/2026, FB-15): sửa dòng giá trên bài Pilot đã lên khi giá bán trong kho đổi — Xem trước ⇒ chỉ nháp để xem */
    automation: { posts: boolean; replyPriceQuestions: boolean; hidePhoneComments: boolean; editPrices: boolean }
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
    automation: { posts: true, replyPriceQuestions: false, hidePhoneComments: false, editPrices: true },
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
            editPrices: bool(tu.editPrices, m.automation.editPrices),
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

/** 'unhide' (10/11/2026, FB-16): bỏ ẩn một bình luận — cùng đường kế hoạch → thực thi như 'hide'. */
/** 'edit' (10/11/2026, FB-15): sửa dòng giá Pilot viết trên MỘT bài đã lên — data.postId / giaCu / giaMoi. */
export type LoaiKeHoachFb = 'post' | 'reply' | 'hide' | 'unhide' | 'edit'
/** Kế hoạch gắn với MỘT bình luận (trả lời / ẩn / bỏ ẩn) — chu kỳ né bình luận đã có kế hoạch loại này. */
export const LOAI_BINH_LUAN: LoaiKeHoachFb[] = ['reply', 'hide', 'unhide']
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
    /** (10/11/2026, FB-16) Kế hoạch lọc theo trạng thái / loại (mảng rỗng = mọi giá trị), mới trước, lật trang bằng con trỏ
     *  (createdAt, id) của dòng CUỐI trang trước — thứ tự (createdAt DESC, id DESC) nên hai kế hoạch cùng mili-giây không lọt / lặp. */
    dsKeHoachLoc(o: { status?: string[]; kind?: string[]; truoc?: { createdAt: number; id: string } | null; lim: number }): Promise<KeHoachFb[]>
    /** (10/11/2026, FB-16) Số kế hoạch theo trạng thái — chip lọc + tổng nháp. */
    demKeHoach(): Promise<Record<string, number>>
    /** Kế hoạch đăng bài ĐÃ / ĐANG đăng (running, succeeded, uncertain) tạo từ mốc `tuLuc` — né đăng lặp một mã + đếm khung giờ.
     *  09/11/2026: nháp KHÔNG còn ở đây — nháp chưa đăng từng chặn mã 21 ngày; nháp đi đường dsKeHoachMo. */
    dsKeHoachBaiTu(tuLuc: number): Promise<KeHoachFb[]>
    /** Kế hoạch còn MỞ (nháp, đang chạy) + kế hoạch huỷ từ mốc `huyTuLuc` — chu kỳ dọn nháp quá hạn, bắt lượt kẹt, nhớ người huỷ. */
    dsKeHoachMo(huyTuLuc: number): Promise<KeHoachFb[]>
    /** Kế hoạch trả lời / ẩn của các bình luận này, trừ bản đã huỷ. */
    dsKeHoachBinhLuan(commentIds: string[]): Promise<KeHoachFb[]>
    /** (09/11/2026) Kế hoạch đăng bài 'succeeded' có bài HẸN ứng với các dòng FbScheduledPost này (result.scheduledPostId) — lượt
     *  soát bài sắp lên. KHÔNG tạo bảng hộ: cửa hàng chưa từng dùng Pilot thì bảng chưa có ⇒ []. */
    dsKeHoachBaiHen(scheduledPostIds: string[]): Promise<KeHoachFb[]>
    /** (10/11/2026, FB-15) MỌI kế hoạch sửa giá ('edit', mọi trạng thái) của các bài này (data.postId), cũ trước — chuỗi sửa của bài. */
    dsKeHoachSuaBai(postIds: string[]): Promise<KeHoachFb[]>
    /** (09/11/2026) Đổi trạng thái + kết quả NẾU kế hoạch còn y như `cu` (so cả result) — nguyên tử. Lượt soát bài hẹn dùng để
     *  giành / nhả / chốt một bài giữa nhiều bản máy (prod không có Redis): bản nào đổi được mới gọi Facebook. */
    doiKeHoachNeu(id: string, cu: { status: string; result: any }, moi: { status: string; result: any }): Promise<boolean>
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
        async dsKeHoachLoc(o) {
            const dk: string[] = [], v: any[] = []
            // $n = vị trí tham số (Postgres) — chuỗi lệnh chỉ ghép SỐ THỨ TỰ, mọi giá trị đi qua tham số
            const tt = () => `$${v.length}`
            if (o.status?.length) { v.push(o.status); dk.push(`status = ANY(${tt()}::text[])`) }
            if (o.kind?.length) { v.push(o.kind); dk.push(`kind = ANY(${tt()}::text[])`) }
            if (o.truoc) {
                v.push(o.truoc.createdAt); const ttLuc = tt()
                v.push(o.truoc.id)
                dk.push(`("createdAt" < ${ttLuc} OR ("createdAt" = ${ttLuc} AND id < ${tt()}))`)
            }
            v.push(o.lim)
            return (await q(`SELECT ${COT_KH} FROM "FacebookPilotPlan" ${dk.length ? `WHERE ${dk.join(' AND ')} ` : ''}ORDER BY "createdAt" DESC, id DESC LIMIT ${tt()}`, ...v)).map(hangKeHoach)
        },
        async demKeHoach() {
            const rs = await q(`SELECT status, COUNT(*)::int AS n FROM "FacebookPilotPlan" GROUP BY status`)
            return Object.fromEntries(rs.map(r => [String(r.status), Number(r.n) || 0]))
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
            return (await q(`SELECT ${COT_KH} FROM "FacebookPilotPlan" WHERE kind IN ('reply', 'hide', 'unhide') AND status <> 'cancelled'
                               AND data::jsonb->>'commentId' = ANY($1::text[]) ORDER BY "createdAt" DESC`, ids)).map(hangKeHoach)
        },
        async dsKeHoachBaiHen(ids) {
            if (!ids.length) return []
            let rs: any[]
            try {
                // gọi thẳng, KHÔNG qua chacBang: nhịp mỗi phút không được tạo bảng hộ cửa hàng chưa từng dùng Pilot
                rs = await prisma.$queryRawUnsafe(`SELECT ${COT_KH} FROM "FacebookPilotPlan" WHERE kind = 'post' AND status = 'succeeded'
                                                     AND result IS NOT NULL AND result::jsonb->>'scheduledPostId' = ANY($1::text[])`, ids)
            } catch (e: any) {
                if (laThieuBang(e)) return []
                throw e
            }
            return rs.map(hangKeHoach)
        },
        async dsKeHoachSuaBai(ids) {
            if (!ids.length) return []
            return (await q(`SELECT ${COT_KH} FROM "FacebookPilotPlan" WHERE kind = 'edit' AND data::jsonb->>'postId' = ANY($1::text[])
                               ORDER BY "createdAt" ASC, id ASC LIMIT 5000`, ids)).map(hangKeHoach)
        },
        async doiKeHoachNeu(id, cu, moi) {
            return (await x(`UPDATE "FacebookPilotPlan" SET status = $4, result = $5, "updatedAt" = $6
                              WHERE id = $1 AND status = $2 AND result::jsonb IS NOT DISTINCT FROM $3::jsonb`,
                id, cu.status, cu.result == null ? null : JSON.stringify(cu.result), moi.status, moi.result == null ? null : JSON.stringify(moi.result), Date.now())) === 1
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
            // dòng 'config' (ai đổi cấu hình, X-14) và 'resolve' (người đánh dấu đã kiểm, FB-16) không phải lệnh ghi lên Facebook —
            // không tính trần ghi / ngày
            const [r] = await q(`SELECT COUNT(*)::int AS n FROM "FacebookPilotWrite" WHERE "createdAt" >= $1 AND action NOT IN ('config', 'resolve')`, ms)
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
        async dsKeHoachLoc(o) {
            const sau = (a: KeHoachFb, b: { createdAt: number; id: string }) => a.createdAt < b.createdAt || (a.createdAt === b.createdAt && a.id < b.id)
            return sao(keHoach
                .filter(k => (!o.status?.length || o.status.includes(k.status)) && (!o.kind?.length || o.kind.includes(k.kind)) && (!o.truoc || sau(k, o.truoc)))
                .sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
                .slice(0, o.lim))
        },
        async demKeHoach() {
            const dem: Record<string, number> = {}
            for (const k of keHoach) dem[k.status] = (dem[k.status] || 0) + 1
            return dem
        },
        async dsKeHoachBaiTu(tuLuc) {
            return sao(keHoach.filter(k => k.kind === 'post' && ['running', 'succeeded', 'uncertain'].includes(k.status) && k.createdAt >= tuLuc))
        },
        async dsKeHoachMo(huyTuLuc) {
            return sao(keHoach.filter(k => k.status === 'draft' || k.status === 'running' || (k.status === 'cancelled' && k.updatedAt >= huyTuLuc)).sort((a, b) => b.createdAt - a.createdAt))
        },
        async dsKeHoachBinhLuan(ids) {
            return sao(keHoach.filter(k => LOAI_BINH_LUAN.includes(k.kind) && k.status !== 'cancelled' && ids.includes(String(k.data?.commentId))))
        },
        async dsKeHoachBaiHen(ids) {
            return sao(keHoach.filter(k => k.kind === 'post' && k.status === 'succeeded' && k.result?.scheduledPostId != null && ids.includes(String(k.result.scheduledPostId))))
        },
        async dsKeHoachSuaBai(ids) {
            return sao(keHoach.filter(k => k.kind === 'edit' && ids.includes(String(k.data?.postId)))
                .sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)))
        },
        async doiKeHoachNeu(id, cu, moi) {
            const k = keHoach.find(x => x.id === id)
            if (!k || k.status !== cu.status || jsonChuan(k.result) !== jsonChuan(cu.result)) return false
            k.status = moi.status; k.result = moi.result == null ? null : sao(moi.result); k.updatedAt = Date.now(); return true
        },
        async ghiNhatKy(w) { nhatKy.push({ ...sao(w), id: crypto.randomUUID(), createdAt: Date.now() }) },
        async dsNhatKy(lim) { return sao([...nhatKy].sort((a, b) => b.createdAt - a.createdAt).slice(0, lim)) },
        async demGhiTuLuc(ms) { return nhatKy.filter(w => w.createdAt >= ms && w.action !== 'config' && w.action !== 'resolve').length },
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
    /** Xoá bài — Pilot CHỈ dùng để rút bài HẸN chưa lên của chính nó (soatBaiHenSapLen), sau khi thấy bài còn trong scheduled_posts. */
    deletePost(postId: string): Promise<{ success: boolean }>
    /** (10/11/2026, FB-15) Sửa chữ bài ĐÃ LÊN — Pilot CHỈ dùng để thay dòng giá nó viết (suaGiaBai), sau khi đọc chữ sống. */
    editPost(postId: string, message: string): Promise<{ success: boolean }>
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
    return { cfg, pages, page: chonTrangPilot(cfg, pages) }
}

/** Trang Pilot làm việc: trang đã chọn ở chính sách, chưa chọn thì trang DUY NHẤT đang nối. Một chỗ cho cả chu kỳ lẫn kích sớm. */
export function chonTrangPilot<T extends { pageId: string }>(cfg: { pageId: string | null }, pages: T[]): T | null {
    return (cfg.pageId && pages.find(p => p.pageId === cfg.pageId)) || (pages.length === 1 ? pages[0] : null)
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
        // đăng xong thì có dòng FbScheduledPost rồi — chỉ đếm bản chưa có dòng đó, khỏi đếm đôi. 09/11/2026: xét theo scheduledPostId,
        // không theo 'succeeded' — bài hẹn rút không được chuyển 'uncertain' (soatBaiHenSapLen) vẫn giữ dòng 'scheduled' của nó
        ...daDang.filter(k => !k.result?.scheduledPostId).map(gio).filter(t => t > 0),
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
    if (LOAI_BINH_LUAN.includes(k.kind) && k.data?.commentId) ne.binhLuan.add(String(k.data.commentId))
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

/** Trang trạng thái trả bấy nhiêu kế hoạch mới nhất; xem cũ hơn / lọc ⇒ thao tác đọc 'plans' (dsKeHoachFb) theo con trỏ. */
const SO_KE_HOACH_TRANG = 80
/** Nháp đang mở trả kèm trạng thái tối đa bấy nhiêu (draftsTotal là số thật) — khối Chờ duyệt. */
const TRAN_NHAP_TRANG = 300
const conTroKeHoach = (k: KeHoachFb) => `${k.createdAt}:${k.id}`
function docConTro(v: any): { createdAt: number; id: string } | null {
    const m = /^(\d{1,16}):([\w-]{1,80})$/.exec(String(v ?? '').trim())
    return m ? { createdAt: Number(m[1]), id: m[2] } : null
}

export async function xayTrangThaiFb(ctx: NgCanhFb): Promise<any> {
    const now = luc(ctx)
    const { cfg, pages, page } = await docCauHinhFb(ctx)
    const pol = cfg.policy
    // TUẦN TỰ có chủ ý: pool Prisma của cửa hàng chỉ 1 kết nối trên prod
    const trang = await ctx.kho.dsKeHoachLoc({ lim: SO_KE_HOACH_TRANG + 1 })
    const plans = trang.slice(0, SO_KE_HOACH_TRANG)
    const planCounts = await ctx.kho.demKeHoach()
    /* FB-16 (10/11/2026): MỌI nháp đang mở (tới 300), không chỉ phần lọt vào 80 kế hoạch mới nhất — nháp cũ bị kế hoạch mới đẩy
     * khuất thì không ai thấy để duyệt (khuôn drafts / draftsTotal của Shopee, TikTok lô 16). */
    const drafts = planCounts.draft ? await ctx.kho.dsKeHoachLoc({ status: ['draft'], lim: TRAN_NHAP_TRANG }) : []
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
    const goc = {
        now, todayWrites, plans, plansNext: trang.length > plans.length ? conTroKeHoach(plans[plans.length - 1]) : null,
        planCounts, drafts, draftsTotal: planCounts.draft || 0, audit, status,
    }
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
    /** bình luận nằm TRONG một luồng ⇒ câu trả lời gửi vào bình luận gốc của luồng (Facebook chỉ có hai tầng) */
    replyTo?: string | null
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
    const replyTo = String(b.replyTo || '').trim()
    if (replyTo && !/^[A-Za-z0-9_]{1,80}$/.test(replyTo)) throw new ToolError('Mã bình luận gốc của luồng không hợp lệ')
    const data = {
        pageId: page.pageId, commentId, postId: b.postId || null, commentMsg: String(b.commentMsg || '').slice(0, 500),
        fromName: b.fromName ? String(b.fromName).slice(0, 100) : null, message,
        ...(replyTo && replyTo !== commentId ? { replyTo } : {}),
        ...(b.productId ? { productId: String(b.productId), sku: b.sku || null, price: Number(b.price) || 0 } : {}),
    }
    return ctx.kho.taoKeHoach(keHoachMoi('reply', data, b.idempotencyKey, ctx.nguoi, now))
}

export interface DauVaoAnHien { commentId: string; postId?: string | null; commentMsg?: string | null; fromName?: string | null; reason?: string; idempotencyKey?: string }

async function lapAnHien(ctx: NgCanhFb, kind: 'hide' | 'unhide', b: DauVaoAnHien): Promise<KeHoachFb> {
    const now = luc(ctx)
    const { page } = await canPage(ctx)
    const commentId = String(b.commentId || '').trim()
    if (!commentId) throw new ToolError('Thiếu mã bình luận')
    const data = {
        pageId: page.pageId, commentId, postId: b.postId || null, commentMsg: String(b.commentMsg || '').slice(0, 500),
        fromName: b.fromName ? String(b.fromName).slice(0, 100) : null,
        reason: String(b.reason || '').slice(0, 200) || (kind === 'hide' ? 'Ẩn bình luận' : 'Hiện lại bình luận'),
    }
    return ctx.kho.taoKeHoach(keHoachMoi(kind, data, b.idempotencyKey, ctx.nguoi, now))
}

export const taoKeHoachAn = (ctx: NgCanhFb, b: DauVaoAnHien) => lapAnHien(ctx, 'hide', b)

/** FB-16 (10/11/2026): BỎ ẨN — ẩn nhầm (tay hay máy) trước đây không gỡ được từ Kengi. Có kế hoạch bỏ ẩn (kể cả đã xong) thì chu kỳ
 *  không tự ẩn lại bình luận đó (dsKeHoachBinhLuan / themNe tính cả 'unhide'). */
export const taoKeHoachBoAn = (ctx: NgCanhFb, b: DauVaoAnHien) => lapAnHien(ctx, 'unhide', b)

/** Người huỷ một nháp. Nháp MÁY đề xuất (khoá 'cycle:') ⇒ chu kỳ nhớ 14 ngày, không đề xuất lại mã / bình luận đó (09/11/2026 —
 *  trước đây không nhớ gì; còn nháp chưa đăng thì chặn mã 21 ngày như bài đã lên). */
export async function huyKeHoachFb(ctx: NgCanhFb, id: string): Promise<KeHoachFb> {
    const k = await ctx.kho.layKeHoach(String(id || ''))
    const ai = `Người huỷ${ctx.nguoi ? ` (${String(ctx.nguoi).slice(0, 80)})` : ''}`
    const message = k && laNhapMay(k)
        ? k.kind === 'edit'
            ? `${ai} — chu kỳ không đề xuất lại lần sửa giá này trong 14 ngày (giá bán đổi tiếp thì đề xuất theo giá mới).`
            : `${ai} — chu kỳ không đề xuất lại ${k.kind === 'post' ? 'mã này' : 'bình luận này'} trong 14 ngày.`
        : `${ai}.`
    if (!k || !(await ctx.kho.huyKeHoach(k.id, { message }))) throw new ToolError('Kế hoạch không còn là bản nháp — không huỷ được.')
    return (await ctx.kho.layKeHoach(k.id))!
}

/** Lời chốt của người kiểm, theo loại kế hoạch: [Facebook CÓ, Facebook KHÔNG có]. */
const CHU_DA_KIEM: Record<string, [string, string]> = {
    post: ['bài ĐÃ có trên fanpage — máy coi như đã đăng (không lên lại mã này trong số ngày của chính sách)',
        'bài KHÔNG có trên fanpage — mã được lên bài lại (chu kỳ sau, hoặc bấm Lên bài)'],
    reply: ['câu trả lời ĐÃ có trên Facebook',
        'câu trả lời KHÔNG có trên Facebook — bình luận mở lại: bấm Trả lời ở tab Bình luận (máy không tự trả lời lại bình luận này)'],
    hide: ['bình luận ĐÃ ẩn', 'bình luận CHƯA ẩn — bấm Ẩn bình luận ở tab Bình luận nếu vẫn cần (máy không tự ẩn lại bình luận này)'],
    unhide: ['bình luận ĐÃ hiện lại', 'bình luận VẪN đang ẩn — bấm Bỏ ẩn ở tab Bình luận nếu vẫn cần'],
    edit: ['bài ĐÃ ghi giá mới — máy coi như đã sửa',
        'bài VẪN ghi giá cũ — chu kỳ sau máy lập lại kế hoạch sửa giá (Tự động: sửa luôn; Xem trước: chỉ lập nháp để xem)'],
}

/**
 * FB-16 (10/11/2026) — người mở fanpage kiểm một kế hoạch "Chưa rõ kết quả" ('uncertain', hoặc 'running' kẹt quá 1 giờ mà chu kỳ
 * chưa chuyển) rồi CHỐT: Facebook CÓ (`done`) hay KHÔNG có (`not_done`) thứ kế hoạch định ghi. Trước đây 'uncertain' nằm mãi: bài
 * chặn mã N ngày + giữ khung giờ dù có thể chưa lên; câu trả lời giữ chỗ trong sổ tự trả lời nên không ai trả lời lại được.
 *   - CÓ    ⇒ 'succeeded'. Trả lời: dòng sổ Pilot giữ dở thành "đã trả lời" (không có dòng thì ghi mới) — quy tắc tự trả lời của
 *             Fanpage Manager không trả lời lần hai.
 *   - KHÔNG ⇒ 'failed'. Bài: nhả mã + khung giờ; dòng bài hẹn 'scheduled' CỦA CHÍNH kế hoạch ⇒ 'cancelled'. Trả lời: nhả chỗ trong
 *             sổ — CHỈ dòng Pilot giữ dở ('pilot_reply' chưa thành, hoặc 'processing' quá 1 giờ), không xoá dòng đã trả lời xong.
 * Máy không bao giờ tự đoán thay người. Giữ MỌI trường kết quả cũ — kể cả `rutBai`: lượt soát bài hẹn thấy rutBai là không đụng lại
 * bài người đã kiểm (soatBaiHenSapLen) — rồi thêm `daKiem`. Không gọi Facebook, không tính trần ghi / ngày (nhật ký 'resolve').
 * Đổi bằng CAS (doiKeHoachNeu): hai người bấm cùng lúc thì một người thắng, người kia được báo tải lại.
 */
export async function xacNhanDaKiemFb(ctx: NgCanhFb, b: { planId: string; outcome: string }): Promise<KeHoachFb> {
    const now = luc(ctx)
    const co = b.outcome === 'done' ? true : b.outcome === 'not_done' ? false : null
    if (co === null) throw new ToolError('Chọn kết quả kiểm: "done" (Facebook CÓ) hoặc "not_done" (Facebook KHÔNG có).')
    const k = await ctx.kho.layKeHoach(String(b.planId || ''))
    if (!k) throw new ToolError('Không thấy kế hoạch — tải lại trang.')
    const chu = CHU_DA_KIEM[k.kind]
    if (!chu) throw new ToolError(`Loại kế hoạch lạ: ${k.kind}`)
    if (k.status === 'running' && !(now - k.updatedAt > KET_THUC_THI_MS)) throw new ToolError('Kế hoạch đang thực thi — chờ ít phút rồi tải lại trang.')
    if (k.status !== 'uncertain' && k.status !== 'running') throw new ToolError('Chỉ kế hoạch "Chưa rõ kết quả" mới cần đánh dấu đã kiểm.')
    const ai = ctx.nguoi ? ` (${String(ctx.nguoi).slice(0, 80)})` : ''
    const message = `Đã kiểm${ai}: ${co ? chu[0] : chu[1]}.`
    const cu = k.result
    const moi = {
        ...(cu && typeof cu === 'object' ? cu : {}),
        ...(cu?.message ? { messageTruoc: String(cu.message).slice(0, 800) } : {}),
        message, daKiem: { ketLuan: co ? 'co' : 'khong', nguoi: ctx.nguoi ? String(ctx.nguoi).slice(0, 100) : null, luc: now },
    }
    if (!(await ctx.kho.doiKeHoachNeu(k.id, { status: k.status, result: cu }, { status: co ? 'succeeded' : 'failed', result: moi }))) {
        throw new ToolError('Kế hoạch vừa được đổi ở nơi khác — tải lại trang.')
    }
    const d = k.data || {}
    if (k.kind === 'reply' && d.pageId && d.commentId) {
        const where = { pageId: String(d.pageId), commentId: String(d.commentId), success: false }
        if (co) {
            const n = await ctx.prisma.fbAutoReplyLog.updateMany({
                where: { ...where, action: { in: ['pilot_reply', 'processing'] } },
                data: { action: 'pilot_reply', replyText: String(d.message || ''), success: true, errorMessage: null },
            }).then((r: any) => Number(r?.count) || 0).catch(() => -1)
            if (n === 0) {
                await ctx.prisma.fbAutoReplyLog.create({
                    data: {
                        pageId: String(d.pageId), commentId: String(d.commentId), postId: d.postId || null, fromName: d.fromName || null,
                        commentMsg: String(d.commentMsg || '').slice(0, 1000), action: 'pilot_reply', replyText: String(d.message || ''), success: true,
                    },
                }).catch(() => { }) // trùng khoá = sổ đã có dòng (đã trả lời) — đúng ý
            }
        } else {
            await ctx.prisma.fbAutoReplyLog.deleteMany({
                where: { ...where, OR: [{ action: 'pilot_reply' }, { action: 'processing', createdAt: { lt: new Date(now - KET_THUC_THI_MS) } }] },
            }).catch((e: any) => console.error('[FacebookPilot] đã kiểm — nhả sổ trả lời lỗi:', e?.message || e))
        }
    }
    if (k.kind === 'post' && !co && cu?.scheduledPostId) {
        await ctx.prisma.fbScheduledPost.updateMany({
            where: { id: String(cu.scheduledPostId), status: 'scheduled' },
            data: { status: 'cancelled', errorMessage: `Người kiểm xác nhận bài không có trên fanpage (Facebook Pilot)${ai}`.slice(0, 500) },
        }).catch((e: any) => console.error('[FacebookPilot] đã kiểm — ghi FbScheduledPost lỗi:', e?.message || e))
    }
    await ctx.kho.ghiNhatKy({
        action: 'resolve', status: 'succeeded', planId: k.id,
        payload: { kind: k.kind, sku: d.sku, commentId: d.commentId, ketLuan: co ? 'co' : 'khong', actor: ctx.nguoi ? String(ctx.nguoi).slice(0, 100) : null },
        response: { message },
    }).catch(() => { })
    return (await ctx.kho.layKeHoach(k.id))!
}

const TRANG_THAI_KE_HOACH = ['draft', 'running', 'uncertain', 'failed', 'succeeded', 'skipped', 'cancelled']
const LOAI_KE_HOACH: string[] = ['post', ...LOAI_BINH_LUAN, 'edit']
const mangChu = (v: any, hop: string[]) => [...new Set((Array.isArray(v) ? v : v == null || v === '' ? [] : [v]).map(String).filter(x => hop.includes(x)))]

/** FB-16 (10/11/2026) — thao tác ĐỌC 'plans': kế hoạch lọc theo trạng thái / loại, lật trang bằng `before` (= `next` của trang trước,
 *  hoặc `plansNext` của trang trạng thái). Giá trị lọc lạ bị bỏ (không lọc theo nó) chứ không ném. */
export async function dsKeHoachFb(ctx: NgCanhFb, b: { status?: any; kind?: any; before?: any; limit?: any } = {}): Promise<{ plans: KeHoachFb[]; next: string | null }> {
    const lim = Math.floor(kep(b.limit, 50, 1, 100))
    const ds = await ctx.kho.dsKeHoachLoc({
        status: mangChu(b.status, TRANG_THAI_KE_HOACH), kind: mangChu(b.kind, LOAI_KE_HOACH), truoc: docConTro(b.before), lim: lim + 1,
    })
    const plans = ds.slice(0, lim)
    return { plans, next: ds.length > lim ? conTroKeHoach(plans[plans.length - 1]) : null }
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
        else if (plan.kind === 'hide') result = await anBinhLuan(ctx, plan, fb, true)
        else if (plan.kind === 'unhide') result = await anBinhLuan(ctx, plan, fb, false)
        else if (plan.kind === 'edit') ({ status, result } = await suaGiaBai(ctx, plan, fb))
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
                result.loiToken = true // khối Chờ duyệt dừng loạt duyệt ở đây (cùng cờ với Shopee / TikTok Pilot)
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
        // sổ FbAutoReplyLog khoá theo bình luận ĐƯỢC trả lời (d.commentId); câu trả lời gửi vào gốc luồng nếu có
        const r = await fb.replyToComment(String(d.replyTo || d.commentId), String(d.message))
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

async function anBinhLuan(ctx: NgCanhFb, plan: KeHoachFb, fb: DichVuFb, an: boolean): Promise<any> {
    const d = plan.data || {}
    await fb.hideComment(String(d.commentId), an)
    await ctx.kho.ghiNhatKy({ action: an ? 'hide' : 'unhide', status: 'succeeded', planId: plan.id, payload: { commentId: d.commentId }, response: { hidden: an } })
    return { hidden: an }
}

/**
 * Thực thi kế hoạch 'edit' (FB-15): soát lại lúc THỰC THI — nháp có thể được duyệt sau một ngày:
 *   - mã còn, chưa gộp, giá bán VẪN là giá kế hoạch định ghi (đổi tiếp ⇒ không sửa, chu kỳ sau lập theo giá mới)
 *   - đọc chữ SỐNG của bài (GET /{post-id}), thay dòng "Giá: <giá cũ>" trên CHÍNH chữ đó — người sửa gì khác trên bài thì giữ nguyên
 *   - chữ đã ghi giá mới ⇒ 'succeeded' không gọi sửa (không tốn lượt ghi); không còn dòng giá cũ ⇒ 'skipped' + thôi theo dõi bài
 *     (còn giá cũ dạng khác ⇒ 'failed' cần người sửa tay) — Pilot không bao giờ ghi đè chữ người đã viết lại.
 * Lỗi Graph đi chung đường phân loại của thucThiFb (mạng ⇒ 'uncertain', hạn mức ⇒ giữ nháp, #190 ⇒ token_expired…).
 */
async function suaGiaBai(ctx: NgCanhFb, plan: KeHoachFb, fb: DichVuFb): Promise<{ status: string; result: any }> {
    const d = plan.data || {}
    const postId = String(d.postId || '')
    const giaCu = Math.round(Number(d.giaCu) || 0), giaKh = Math.round(Number(d.giaMoi) || 0)
    if (!postId || !(giaCu > 0) || !(giaKh > 0)) throw new ToolError('Kế hoạch sửa giá thiếu mã bài / giá — huỷ đi, chu kỳ sau lập lại.')
    const sp = await ctx.prisma.product.findUnique({ where: { id: String(d.productId || '') }, select: { id: true, sellingPrice: true, mergedIntoId: true } })
    if (!sp) throw new ToolError('Mã hàng không còn trong kho — không sửa giá bài; sửa tay trên fanpage nếu cần.')
    if (sp.mergedIntoId) throw new ToolError('Mã đã gộp vào mã khác — không sửa giá bài; sửa tay trên fanpage nếu cần.')
    const giaNay = Math.round(Number(sp.sellingPrice) || 0)
    if (Math.abs(giaNay - giaKh) >= 1) {
        throw new ToolError(`Giá bán đã đổi tiếp thành ${vnd(giaNay)} từ lúc lập kế hoạch (định ghi ${vnd(giaKh)}) — không sửa; chu kỳ sau lập lại theo giá mới.`)
    }
    const tren = await fb.get(postId, { fields: 'id,message' })
    const chu = typeof tren?.message === 'string' ? tren.message : ''
    const moi = thayGiaTrongBai(chu, giaCu, giaKh)
    if (moi === null) {
        if (coDongGia(chu, giaKh)) {
            return { status: 'succeeded', result: { postId, giaCu, giaMoi: giaKh, khongCanSua: true, messageMoi: chu.normalize('NFC').slice(0, 5000), message: `Bài trên Facebook đã ghi ${dongGiaBai(giaKh)} — không cần sửa.` } }
        }
        if (chuCoGia(chu, giaCu)) {
            return { status: 'failed', result: { postId, boQuan: true, message: `Bài vẫn ghi giá cũ ${vnd(giaCu)} nhưng không đúng dòng "${dongGiaBai(giaCu)}" Pilot viết (đã viết lại?) — Pilot không sửa chữ người viết: sửa tay trên fanpage.` } }
        }
        return { status: 'skipped', result: { postId, boQuan: true, message: 'Chữ bài trên Facebook không còn giá cũ (đã sửa tay / bỏ dòng giá) — Pilot thôi theo dõi giá bài này.' } }
    }
    await fb.editPost(postId, moi)
    await ctx.kho.ghiNhatKy({ action: 'edit', status: 'succeeded', planId: plan.id, payload: { sku: d.sku, postId, giaCu, giaMoi: giaKh }, response: { success: true } })
    // dòng FbScheduledPost của bài (Fanpage Manager hiện chữ này) — phụ, hỏng không làm hỏng lần sửa đã xong
    await ctx.prisma.fbScheduledPost.updateMany({ where: { fbPostId: postId }, data: { message: moi } })
        .catch((e: any) => console.error('[FacebookPilot] sửa giá bài — ghi FbScheduledPost lỗi:', e?.message || e))
    return { status: 'succeeded', result: { postId, giaCu, giaMoi: giaKh, messageMoi: moi.slice(0, 5000), message: 'Đã sửa dòng giá trên bài.' } }
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

/* ── Nhận "hỏi giá" (FB-07, 10/11/2026) ──
 * Máy TỰ trả lời giá CÔNG KHAI dưới bài ⇒ thà bỏ sót (người trả lời) còn hơn trả lời giá cho một lời chê hay một lời khen.
 * Trước đây bắt chữ "giá" ở bất kỳ đâu và "còn không" ở bất kỳ đâu: "Đánh giá 5 sao", "giá trị", "hàng tốt giá hợp lý",
 * "mua về còn không biết dùng", "pin dùng được bao nhiêu lâu", "mua cho gia đình" đều bị coi là hỏi giá. Giờ:
 *   1. lời chê / phàn nàn / khiếu nại (laPhanNan) ⇒ KHÔNG BAO GIỜ là hỏi giá — để người trả lời
 *   2. gỡ cụm có chữ "giá" mà không phải giá: đánh giá, đáng giá, giá trị, giá đỡ / treo / kệ / phơi / sách / vẽ
 *   3. "giá" chỉ tính khi: cả bình luận chỉ là "giá"; hoặc 2 chữ kế tiếp có từ hỏi (sao, bao, bn, nhiêu, thế, ạ, shop, vậy, ?…);
 *      hoặc chữ ngay trước là xin / cho / báo / check / hỏi / ib / gửi / biết / xem / đăng / ghi
 *   4. "bao nhiêu" sau tính từ đo (nặng, dài, pin, công suất…) hoặc trước đơn vị (lâu, tháng, W, kg, cái, màu…) ⇒ hỏi thông số
 *   5. "còn không / ko / k / hông" chỉ tính ở cuối câu hoặc trước tiểu từ (ạ, shop, vậy, bạn, ?…)
 *   6. "bn" chỉ tính khi đứng một mình, sau "giá", hoặc trước tiểu từ / "tiền" — "bn ơi", "cảm ơn bn" là "bạn"
 * Không dấu: "gia" trùng "gia đình / gia dụng / gia công" ⇒ chỉ nhận cụm chắc chắn (gia bao, gia sao, xin gia…).
 */
const CHU = '\\p{L}\\p{N}'
/** Biểu thức có ranh giới chữ TIẾNG VIỆT — \b của JS chỉ hiểu chữ ASCII ("tệ" kết thúc bằng ệ). Chạy trên chữ thường NFC. */
const tuRieng = (...mau: string[]) => new RegExp(`(?<![${CHU}])(?:${mau.join('|')})(?![${CHU}])`, 'u')
const chuThuong = (s: string) => String(s || '').normalize('NFC').toLowerCase()

/** Lời chê / khiếu nại. "đắt hàng / đắt khách" là lời CHÚC, không phải chê. */
const PHAN_NAN_CO_DAU = tuRieng('đắt(?! (?:hàng|khách))', 'chát', 'cắt cổ', 'lừa', 'dỏm', 'dởm', 'lởm', 'hàng giả', 'đồ giả', 'hàng nhái',
    'fake', 'scam', 'thất vọng', 'tệ', 'kém chất lượng', 'chất lượng kém', 'bị (?:hỏng|hư|lỗi|vỡ|bể|rách|móp)', 'móp',
    'không giống (?:hình|ảnh)', 'khác (?:hình|ảnh)', '(?:chưa|không) nhận được', 'giao chậm', 'hoàn tiền', 'trả (?:lại )?hàng', 'bóc phốt', 'phốt')
/** Bản không dấu — CHỈ cụm không trùng nghĩa khác: "cat co" cũng là "cắt cỏ" (máy cắt cỏ), "dat qua" cũng là "đặt qua", "hang gia"
 *  cũng là "hàng giá…" ⇒ không có ở đây. */
const PHAN_NAN_KHONG_DAU = tuRieng('lua dao', 'bi lua', 'hang nhai', 'hang fake', 'that vong', 'kem chat luong', 'chat luong kem',
    'bi (?:hong|loi|vo|be|rach|mop)', 'khong giong (?:hinh|anh)', 'chua nhan duoc', 'giao cham', 'hoan tien', 'tra (?:lai )?hang', 'boc phot')

/** Bình luận chê / phàn nàn / khiếu nại — máy không tự trả lời giá, giao diện gắn nhãn để người trả lời. */
export function laPhanNan(chu: string): boolean {
    const s = chuThuong(chu)
    return PHAN_NAN_CO_DAU.test(s) || PHAN_NAN_KHONG_DAU.test(boDau(s))
}

const KHONG_PHAI_GIA = new RegExp(`(?<![${CHU}])(?:đánh giá|đáng giá|giá trị|giá (?:đỡ|treo|kệ|phơi|sách|vẽ))(?![${CHU}])`, 'gu')
/** Bản không dấu — "dang gia" để yên (cũng là "đăng giá" = xin đăng giá). */
const KHONG_PHAI_GIA_KHONG_DAU = new RegExp(`(?<![${CHU}])(?:danh gia|gia tri)(?![${CHU}])`, 'gu')
const HOI_SAU_GIA = new Set(['?', 'sao', 'bao', 'bn', 'nhiêu', 'nhiu', 'thế', 'ntn', 'mấy', 'ạ', 'shop', 'sốp', 'shp', 'ad', 'admin', 'vậy', 'nhỉ',
    'hả', 'ib', 'inb', 'inbox', 'với', 'sỉ', 'lẻ', 'bán', 'buôn', 'cái', 'bộ', 'chiếc', 'combo', 'set'])
const TRUOC_GIA = new Set(['xin', 'cho', 'báo', 'check', 'hỏi', 'ib', 'inb', 'inbox', 'gửi', 'biết', 'xem', 'đăng', 'ghi'])
/** Từ HỎI mạnh ở 2 chữ cuối câu có "giá" ("giá bên mình sao ạ", "giá bên shop thế nào") — không gồm tiểu từ ạ / vậy / nhé:
 *  "giá rẻ vậy", "giá tốt, cảm ơn shop ạ" là khen. */
const HOI_CUOI_CAU = new Set(['?', 'sao', 'nào', 'ntn', 'bn', 'nhiêu', 'nhiu'])
/** Cụm chắc chắn hỏi giá / hỏi hàng — có dấu và không dấu ("con hang" cũng là "còn hàng").
 *  "nhiêu" đứng một mình (miền Nam: "nhiêu vậy shop", "bán nhiêu") — có dấu mới chắc ("nhieu" cũng là "nhiều"). */
const GIA_RO_CO_DAU = tuRieng('bao tiền', 'nhiêu tiền', 'mấy tiền', 'mấy (?:k|nghìn|ngàn)',
    `(?<!bao )nhiêu(?=\\s*(?:$|[?!.,…]|(?:vậy|vay|z|v|shop|sốp|ạ|ad|bạn|b|em|chị|anh|ơi|hả|nhỉ|thế)(?![${CHU}])))`)
const GIA_RO_KHONG_DAU = tuRieng('gia (?:bao|sao|nhieu|nhiu|the nao|ntn|bn|si)', '(?:xin|check|hoi|ib|inb|inbox) gia', 'bao gia(?! dinh)',
    'gia\\s*\\?', 'bnhiu', 'bnhieu', 'con hang', 'ib', 'inb', 'inbox')
/** Chữ không dấu hoàn toàn: "nhieu tien" / "may tien" mới chắc là "nhiêu tiền" / "mấy tiền" (có dấu thì "nhiều tiền" là than tốn tiền). */
const GIA_RO_CHI_KHONG_DAU = tuRieng('bao tien', 'nhieu tien', 'may tien')
/* "bao nhiêu" xét trên chữ CÓ dấu (mỗi từ có cả dạng không dấu): bỏ dấu thì "ship về Đà Nẵng bao nhiêu" thành "…nang bao nhieu" = "nặng". */
const BAO_NHIEU = new RegExp(`(?<![${CHU}])bao (?:nhiêu|nhieu|nhiu)(?![${CHU}])`, 'gu')
const DO_TRUOC_BAO_NHIEU = new RegExp(`(?<![${CHU}])(?:nặng|nang|dài|dai|rộng|rong|cao|mạnh|manh|tải|tai|pin|size|công suất|cong suat|dung lượng|dung luong|kích thước|kich thuoc|trọng lượng|trong luong|đường kính|duong kinh|bảo hành|bao hanh)(?:\\s+(?:được|duoc))?\\s*$`, 'u')
const DON_VI_SAU_BAO_NHIEU = new RegExp(`^\\s*(?:%|(?:lâu|lau|ngày|ngay|tuần|tuan|tháng|thang|năm|nam|giờ|gio|tiếng|tieng|phút|phut|giây|giay|tuổi|tuoi|cân|can|ký|ky|kg|gram|cm|mm|mét|met|m|lít|lit|ml|w|kw|vol|volt|mah|gb|tb|inch|size|màu|mau|mẫu|loại|loai|người|nguoi|lần|lan|km|phần trăm|phan tram|cái|cai|chiếc|chiec|viên|vien|hộp|hop|cuốn|cuon|tấm|tam|bộ|bo)(?![${CHU}]))`, 'u')
const TIEU_TU = '(?:a|ad|admin|shop|sop|shp|vay|z|v|nhi|ban|b|em|chi|anh|oi|ha|nha|nhe|ak|ah|ta)'
const CON_KHONG = new RegExp(`(?<![${CHU}])con (?:khong|ko|k|hong|hok|hem)(?=\\s*(?:$|[?!.,…]|${TIEU_TU}(?![${CHU}])))`, 'u')
const BN = new RegExp(`^\\s*bn\\s*[?!.]*\\s*$|(?<![${CHU}])gia\\s+bn(?![${CHU}])|(?<![${CHU}])bn(?=\\s*(?:\\?|(?:vay|z|v|a|ad|shop|sop|shp|tien|1|mot|cai)(?![${CHU}])))`, 'u')

/** "giá" có dấu đứng cạnh từ hỏi (xem khối chú thích trên). `s` đã gỡ KHONG_PHAI_GIA. */
function coGiaKemTuHoi(s: string): boolean {
    const tu = s.replace(/\?/g, ' ? ').split(/[^\p{L}\p{N}?]+/u).filter(Boolean)
    const cuoiHoi = tu.length <= 12 && tu.slice(-2).some(t => HOI_CUOI_CAU.has(t))
    for (let i = 0; i < tu.length; i++) {
        if (tu[i] !== 'giá' && tu[i] !== 'gía') continue   // "gía" = gõ dấu lệch, rất hay gặp
        if (tu.length === 1 || cuoiHoi) return true
        if (tu.slice(i + 1, i + 3).some(t => HOI_SAU_GIA.has(t))) return true
        // "giá như nào / như thế nào" là hỏi; "giá như…" một mình là "phải chi" ("giá như biết sớm")
        if (tu[i + 1] === 'như' && (tu[i + 2] === 'nào' || tu[i + 2] === 'thế')) return true
        if (i > 0 && TRUOC_GIA.has(tu[i - 1])) return true
    }
    return false
}

/** "bao nhiêu" hỏi GIÁ — không phải "nặng bao nhiêu", "bao nhiêu lâu", "bao nhiêu W". `s` là chữ thường CÓ dấu. */
function coBaoNhieuHoiGia(s: string): boolean {
    for (const m of s.matchAll(BAO_NHIEU)) {
        const i = m.index ?? 0
        if (DO_TRUOC_BAO_NHIEU.test(s.slice(0, i))) continue
        if (DON_VI_SAU_BAO_NHIEU.test(s.slice(i + m[0].length))) continue
        return true
    }
    return false
}

/** Bình luận hỏi giá / hỏi còn hàng / xin inbox (quy tắc ở khối chú thích trên). */
export function laHoiGia(chu: string): boolean {
    const goc = chuThuong(chu)
    if (!goc.trim() || laPhanNan(goc)) return false
    const s = goc.replace(KHONG_PHAI_GIA, ' ')
    // "già / giả / giã / giạ" không phải "giá": đổi chỗ trước khi bỏ dấu, kẻo "hàng giả sao" thành "hang gia sao"
    const k = boDau(s.replace(/(?<![\p{L}\p{N}])gi[àảãạ](?![\p{L}\p{N}])/gu, 'gx')).replace(KHONG_PHAI_GIA_KHONG_DAU, ' ')
    return coGiaKemTuHoi(s) || GIA_RO_CO_DAU.test(s) || GIA_RO_KHONG_DAU.test(k) || (boDau(goc) === goc && GIA_RO_CHI_KHONG_DAU.test(k))
        || coBaoNhieuHoiGia(s) || CON_KHONG.test(k) || BN.test(k)
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
    /** chê / phàn nàn / khiếu nại — máy không tự trả lời giá (FB-07) */
    complaint: boolean
    hasPhone: boolean
    product: { productId: string; sku: string; name: string; price: number; stock: number } | null
    /** vì sao bài không nối được về một mã (tên trùng nhiều mã / mã Pilot đã đăng không còn bán) — FB-08 */
    productNote: string | null
    suggestion: string | null
    handled: { action: string; success: boolean } | null
    plan: { id: string; kind: string; status: string } | null
    /** bình luận TRẢ LỜI trong một luồng: mã bình luận nó trả lời (null = bình luận gốc dưới bài) — FB-09 */
    parentId: string | null
    parentFromName: string | null
    /** gốc của luồng — câu trả lời của shop gửi vào đây (null = bình luận gốc, trả lời thẳng vào nó) */
    replyTo: string | null
    /** bình luận trong luồng mà shop ĐÃ có mặt (gốc là của fanpage, hoặc fanpage trả lời trước nó) ⇒ máy không tự trả lời */
    shopDaVao: boolean
    /** fanpage đã viết SAU bình luận này trong cùng luồng (người của shop trả lời tay trên Facebook) ⇒ coi như đã có shop lo */
    shopTraLoi: boolean
}

const TRUONG_BL = 'id,message,from,created_time,is_hidden,comment_count'
const TRUONG_BL_LUONG = `${TRUONG_BL},parent{id,from}`
/** Bình luận cũ hơn mốc này máy không xử lý nữa — cũng là mốc dừng lật trang. */
export const HAN_BINH_LUAN_MS = 3 * 86400_000
/** Tối đa bấy nhiêu lời gọi ĐỌC THÊM trang bình luận trong một lượt (ngoài lời gọi đầu) — giữ hạn mức Facebook. */
export const TRAN_TRANG_BL = 4

/** Bình luận mới trên các bài gần nhất (đọc thẳng Facebook) kèm cờ + gợi ý trả lời bằng giá thật. */
/* FB-09 (10/11/2026): đọc CẢ bình luận trả lời trong luồng (filter=stream) — trước đây chỉ bình luận gốc, 25 cái mới nhất mỗi bài:
 * khách hỏi giá / để số điện thoại bên trong một luồng thì máy không thấy. Mới nhất trước, 50 cái / bài; bài còn bình luận trong
 * 3 ngày chưa đọc hết thì lật thêm trang (tối đa TRAN_TRANG_BL lời gọi / lượt). Facebook không nhận kiểu đọc luồng (lỗi không phải
 * token / hạn mức / mạng, hoặc trả thứ tự cũ → mới) ⇒ đọc lại kiểu cũ và NÓI RA ở ghiChu — không âm thầm soát hẹp. */
export async function docBinhLuan(ctx: NgCanhFb, o: { soBai?: number } = {}): Promise<{ comments: BinhLuanFb[]; soBai: number; thieuFrom: number; page: any; luong: boolean; ghiChu: string[] }> {
    const { page } = await canPage(ctx)
    const fb = dichVu(ctx, page.accessToken)
    const now = luc(ctx)
    const soBai = Math.floor(kep(o.soBai, 15, 1, 25))
    const ghiChu: string[] = []
    const docCu = () => fb.get(`${page.pageId}/posts`, {
        fields: `id,message,created_time,permalink_url,comments.order(reverse_chronological).limit(25){${TRUONG_BL}}`,
        limit: soBai,
    })
    const tg = (c: any) => Date.parse(c?.created_time) || 0
    let luong = true
    let data: any
    try {
        data = await fb.get(`${page.pageId}/posts`, {
            fields: `id,message,created_time,permalink_url,comments.filter(stream).order(reverse_chronological).limit(50){${TRUONG_BL_LUONG}}`,
            limit: soBai,
        })
    } catch (e: any) {
        if (e?.isTokenError || isRateLimitError(e) || laLoiMang(e)) throw e
        luong = false
        ghiChu.push(`Facebook không cho đọc bình luận trong luồng (${String(e?.message || e).slice(0, 160)}) — lượt này chỉ soát bình luận gốc dưới bài (25 cái mới nhất mỗi bài).`)
        data = await docCu()
    }
    // còn trang mà trang đầu xếp cũ → mới ⇒ Facebook bỏ qua thứ tự: bình luận MỚI nằm ở trang chưa đọc ⇒ không dùng được
    if (luong && (data?.data || []).some((p: any) => {
        const ds: any[] = p.comments?.data || []
        return p.comments?.paging?.next && ds.length >= 2 && tg(ds[0]) < tg(ds[ds.length - 1])
    })) {
        luong = false
        ghiChu.push('Facebook không trả bình luận trong luồng theo thứ tự mới nhất trước — lượt này chỉ soát bình luận gốc dưới bài (25 cái mới nhất mỗi bài).')
        data = await docCu()
    }
    const posts: any[] = data?.data || []

    // Lật thêm trang cho bài còn bình luận trong hạn chưa đọc hết — bài mới trước, tối đa TRAN_TRANG_BL lời gọi
    if (luong) {
        let conGoi = TRAN_TRANG_BL
        let boDo = 0
        let hong = false
        for (const p of posts) {
            let pg = p.comments?.paging
            let ds: any[] = p.comments?.data || []
            while (!hong && pg?.next && pg?.cursors?.after && ds.length && now - Math.min(...ds.map(tg)) <= HAN_BINH_LUAN_MS) {
                if (conGoi <= 0) { boDo++; break }
                conGoi--
                try {
                    const them = await fb.get(`${p.id}/comments`, { filter: 'stream', order: 'reverse_chronological', limit: 50, after: pg.cursors.after, fields: TRUONG_BL_LUONG })
                    ds = them?.data || []
                    p.comments.data = [...(p.comments.data || []), ...ds]
                    pg = them?.paging
                } catch (e: any) {
                    ghiChu.push(`Đọc thêm trang bình luận bị hỏng (${String(e?.message || e).slice(0, 160)}) — lượt này mới soát phần mới nhất của mỗi bài.`)
                    hong = true
                }
            }
        }
        if (boDo) ghiChu.push(`${boDo} bài còn bình luận trong 3 ngày chưa đọc hết (mỗi lượt chỉ đọc thêm ${TRAN_TRANG_BL} trang) — phần cũ hơn của các bài đó chưa được soát.`)
    }

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
    /* FB-08 (10/11/2026): tên → mã CHỈ khi đúng MỘT mã mang tên đó. Cùng tên nhiều mã (khác size / màu…) trước đây lấy mã ĐỌC SAU
     * CÙNG ⇒ máy tự trả lời giá của mã khác. Chỉ xét tên có trong tenDau (đã đọc ĐỦ mọi mã mang tên đó); bài ngắn < 4 chữ không nối. */
    const tenCan = new Set(tenDau)
    const theoTen = new Map<string, any[]>()
    for (const s of spDs) {
        const t = tenGon(s.name)
        if (tenCan.has(t) && !(theoTen.get(t) || []).some(x => x.id === s.id)) theoTen.set(t, [...(theoTen.get(t) || []), s])
    }

    const tho: { c: any; p: any }[] = []
    const daCo = new Set<string>()
    for (const p of posts) for (const c of p.comments?.data || []) {
        if (!c?.id || daCo.has(String(c.id))) continue      // lật trang có thể trả trùng khi có bình luận mới chen vào
        daCo.add(String(c.id))
        tho.push({ c, p })
    }
    // Luồng: gốc = bình luận không có parent; Facebook chỉ hai tầng nhưng vẫn leo tới gốc cho chắc
    const theoId = new Map(tho.map(x => [String(x.c.id), x.c]))
    const laPage = (f: any) => !!f?.id && String(f.id) === String(page.pageId)
    const gocCua = (c: any): string => {
        let x = c
        for (let i = 0; i < 5 && x?.parent?.id; i++) {
            const cha = theoId.get(String(x.parent.id))
            if (!cha) return String(x.parent.id)
            x = cha
        }
        return String(x.id)
    }
    const luongTheoGoc = new Map<string, any[]>()
    for (const { c } of tho) {
        const g = gocCua(c)
        luongTheoGoc.set(g, [...(luongTheoGoc.get(g) || []), c])
    }
    const khacNguoi = (a: any, b: any) => String(a.id) !== String(b.id) && !(a.from?.id && b.from?.id && String(a.from.id) === String(b.from.id))
    const soTraLoiCua = (c: any): number => {
        if (!luong) return Number(c.comment_count) || 0
        const g = gocCua(c)
        const con = (luongTheoGoc.get(g) || []).filter(x => String(x.id) !== g)
        if (!c.parent?.id) return con.filter(x => khacNguoi(x, c)).length + Math.max(0, (Number(c.comment_count) || 0) - con.length)
        return con.filter(x => tg(x) > tg(c) && khacNguoi(x, c)).length
    }
    const shopDaVaoCua = (c: any): boolean => {
        if (!c.parent?.id) return false
        const g = gocCua(c)
        if (laPage(theoId.get(g)?.from) || laPage(c.parent?.from)) return true
        return (luongTheoGoc.get(g) || []).some(x => String(x.id) !== String(c.id) && laPage(x.from) && tg(x) <= tg(c))
    }
    const shopTraLoiCua = (c: any): boolean => {
        if (!luong || laPage(c.from)) return false
        const g = gocCua(c)
        return (luongTheoGoc.get(g) || []).some(x => String(x.id) !== String(c.id) && String(x.id) !== g && laPage(x.from) && (!c.parent?.id || tg(x) > tg(c)))
    }
    const ids = tho.map(x => String(x.c.id))
    const daXuLy: any[] = ids.length ? await ctx.prisma.fbAutoReplyLog.findMany({ where: { pageId: page.pageId, commentId: { in: ids } }, select: { commentId: true, action: true, success: true } }).catch(() => []) : []
    const soCu = new Map(daXuLy.map(r => [String(r.commentId), r]))
    const khCu = new Map<string, KeHoachFb>()
    for (const k of await ctx.kho.dsKeHoachBinhLuan(ids)) if (!khCu.has(String(k.data?.commentId))) khCu.set(String(k.data.commentId), k)

    let thieuFrom = 0
    const comments: BinhLuanFb[] = tho.map(({ c, p }) => {
        const idSp = theoBai.get(String(p.id))
        // bài do Pilot đăng ⇒ CHỈ theo mã đã đăng: mã đó không còn bán thì không rơi về tên (tên có thể là của mã khác)
        const cungTen = idSp ? [] : (theoTen.get(dongDau(p.message)) || [])
        const s = idSp ? (spTheoId.get(idSp) || null) : cungTen.length === 1 ? cungTen[0] : null
        const productNote = idSp && !s ? 'Mã hàng Pilot đã đăng ở bài này không còn trong kho bán (đã xoá / gộp mã / đổi loại) — không tự gắn giá.'
            : cungTen.length > 1 ? `Dòng đầu bài trùng tên ${cungTen.length} mã hàng trong kho (${cungTen.slice(0, 3).map(x => x.sku).join(', ')}${cungTen.length > 3 ? '…' : ''}) — không biết khách hỏi mã nào, không tự gắn giá.`
                : null
        const msg = String(c.message || '')
        const hoiGia = laHoiGia(msg)
        if (!c.from) thieuFrom++
        const so = soCu.get(String(c.id))
        const kh = khCu.get(String(c.id))
        return {
            id: String(c.id), message: msg, fromName: c.from?.name || null, fromId: c.from?.id ? String(c.from.id) : null,
            fromPage: !!c.from?.id && String(c.from.id) === String(page.pageId),
            createdTime: Date.parse(c.created_time) || 0, isHidden: !!c.is_hidden, replies: soTraLoiCua(c),
            postId: String(p.id), postTitle: dongDau(p.message).slice(0, 120), permalink: p.permalink_url || null,
            askPrice: hoiGia, complaint: laPhanNan(msg), hasPhone: coSoDienThoai(msg),
            product: s ? { productId: String(s.id), sku: s.sku, name: tenGon(s.name), price: Number(s.sellingPrice) || 0, stock: Number(s.stock) || 0 } : null,
            productNote,
            suggestion: hoiGia && s && Number(s.sellingPrice) > 0 ? cauTraLoiGia(s) : null,
            handled: so ? { action: String(so.action), success: !!so.success } : null,
            plan: kh ? { id: kh.id, kind: kh.kind, status: kh.status } : null,
            parentId: c.parent?.id ? String(c.parent.id) : null,
            parentFromName: c.parent?.id ? (c.parent.from?.name || theoId.get(String(c.parent.id))?.from?.name || null) : null,
            replyTo: c.parent?.id ? gocCua(c) : null,
            shopDaVao: shopDaVaoCua(c),
            shopTraLoi: shopTraLoiCua(c),
        }
    })
    comments.sort((a, b) => b.createdTime - a.createdTime)
    return { comments, soBai: posts.length, thieuFrom, page: pageAnToan(page), luong, ghiChu }
}

// ─── Sửa giá bài đã lên (10/11/2026, FB-15) ─────────────────────────────────────

/* Trước đây bài Pilot đã lên giữ giá lúc đăng mãi: giá kho đổi ⇒ khách đọc bài thấy giá cũ, hỏi / đặt theo giá cũ. Nay mỗi chu kỳ soát
 * bài Pilot đã lên ≤ 30 ngày: giá bán trong kho ≠ giá bài đang ghi THEO PILOT (giá lúc đăng, hoặc giá lần sửa thành công cuối) ⇒ đọc
 * chữ SỐNG (một lần /{page}/posts) ⇒ thay đúng dòng "Giá: <giá cũ>" Pilot viết:
 *   - Tự động ⇒ sửa luôn (tính trần ghi / ngày, tối đa TRAN_SUA_MOI_CHU_KY bài mỗi chu kỳ, bài mới trước); hết lượt ghi ⇒ báo chủ shop,
 *     nháp nằm chờ chu kỳ sau. Xem trước ⇒ nháp 'edit' CHỈ ĐỂ XEM (Xem trước không ghi gì lên Facebook, kể cả khi người bấm Thực thi).
 *   - chữ đã ghi giá mới (người sửa tay) ⇒ ghi nhận, không gọi sửa; còn giá cũ mà không đúng dòng Pilot viết ⇒ báo người sửa tay; không
 *     còn giá cũ ⇒ thôi theo dõi bài đó. Pilot KHÔNG ghi đè chữ người đã viết lại.
 *   - KHÔNG gọi Facebook khi không bài nào lệch giá (chỉ đọc CSDL). Bài hẹn mới tới giờ < 30 phút thuộc phần soatBaiHenSapLen.
 *   - Tồn ≤ 0 KHÔNG ghi "hết hàng" lên bài (tồn ≤ 0 không chứng minh hết — memory warehouse-stock-invariant): chỉ nêu trong kết quả.
 * Chuỗi sửa của một bài = các kế hoạch 'edit' (data.postId). Khoá = bài + kế hoạch sửa thành công trước (hoặc 'goc') + giá mới + lượt
 * ⇒ cùng một bước đổi giá không lập trùng; nháp máy hết hạn / tự huỷ ⇒ lượt sau lập lại (tối đa SUA_GIA_TOI_DA_LUOT); người huỷ ⇒
 * nhớ 14 ngày; hỏng ⇒ 24 giờ sau thử lại; còn kế hoạch 'uncertain' ⇒ chờ người «Đã kiểm», không sửa tiếp bài đó. */
const SUA_GIA_TRONG_MS = 30 * 86400_000
const SUA_GIA_SAU_GIO_LEN_MS = 30 * 60_000
const TRAN_SUA_MOI_CHU_KY = 10
const SUA_GIA_TOI_DA_LUOT = 5
const SUA_GIA_THU_LAI_MS = 24 * 3600_000
/** taoKeHoachBai cho hẹn trước tối đa 28 ngày — đọc kế hoạch lùi thêm ngần này để không sót bài hẹn xa đã lên. */
const HEN_TRUOC_TOI_DA_MS = 28 * 86400_000

/** Dòng giá Pilot ghi trong bài (soanBai): "Giá: 26.000đ". */
export const dongGiaBai = (gia: number) => `Giá: ${vnd(gia)}`
const thoatRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** "Giá: 26.000đ" không dính chữ / số liền sau ("Giá: 26.000đồng" là chữ người viết, không phải dòng Pilot). */
const reDongGia = (gia: number, co: string) => new RegExp(`${thoatRe(dongGiaBai(gia))}(?![\\p{L}\\d])`, co)
/** Chữ bài (chuẩn hoá NFC) có dòng giá đúng khuôn Pilot cho `gia`. */
export function coDongGia(chu: string, gia: number): boolean {
    return Math.round(Number(gia) || 0) > 0 && reDongGia(gia, 'u').test(String(chu || '').normalize('NFC'))
}
/** Thay MỌI dòng "Giá: <giaCu>" đúng khuôn Pilot bằng "Giá: <giaMoi>" (chữ chuẩn hoá NFC). null = không có dòng nào để thay. */
export function thayGiaTrongBai(chu: string, giaCu: number, giaMoi: number): string | null {
    const s = String(chu || '').normalize('NFC')
    if (!coDongGia(s, giaCu) || !(Math.round(Number(giaMoi) || 0) > 0)) return null
    return s.replace(reDongGia(giaCu, 'gu'), () => dongGiaBai(giaMoi))
}

export interface GiaBaiTheoPilot {
    /** giá bài đang ghi theo Pilot: giá lúc đăng, hoặc giá của lần sửa THÀNH CÔNG cuối */
    gia: number
    /** id kế hoạch sửa thành công cuối ('goc' = chưa sửa lần nào) — mắt xích của khoá kế hoạch sửa kế tiếp */
    chuoi: string
    /** có lần sửa kết luận thôi theo dõi bài (người viết lại giá / bỏ dòng giá) */
    boQuan: boolean
    /** kế hoạch sửa còn mở (nháp / đang chạy) */
    mo: KeHoachFb[]
    /** kế hoạch sửa chưa rõ kết quả — chờ người «Đã kiểm» */
    chuaRo: KeHoachFb | null
}
/** Gộp chuỗi kế hoạch 'edit' của MỘT bài thành giá bài đang ghi theo Pilot. Thứ tự = thứ tự LẬP (createdAt): mỗi bài chỉ có
 *  một lần sửa mở / chưa rõ tại một lúc (chu kỳ không lập lần sau khi lần trước chưa xong), nên lập sau = áp lên bài sau — kể cả
 *  lần "chưa rõ" được người đánh dấu «Đã kiểm: CÓ» về sau (updatedAt mới nhưng vẫn là lần áp cuối). */
export function giaBaiTheoPilot(bai: KeHoachFb, sua: KeHoachFb[]): GiaBaiTheoPilot {
    let gia = Math.round(Number(bai.data?.price) || 0), chuoi = 'goc', luc = -Infinity
    for (const e of sua) {
        if (e.status !== 'succeeded' || !(e.createdAt >= luc)) continue
        luc = e.createdAt; gia = Math.round(Number(e.data?.giaMoi) || 0); chuoi = e.id
    }
    return {
        gia, chuoi,
        boQuan: sua.some(e => e.result?.boQuan === true),
        mo: sua.filter(e => e.status === 'draft' || e.status === 'running'),
        chuaRo: sua.find(e => e.status === 'uncertain') || null,
    }
}

interface ViecSuaGia { k: KeHoachFb; postId: string; len: number; sp: any; st: GiaBaiTheoPilot; giaMoi: number; luot: number; nhap: KeHoachFb | null }
/** mã hàng không lặp (hai bài cùng mã), tối đa 5 mã */
const dsMa = (ds: string[]) => { const m = [...new Set(ds)]; return `${m.slice(0, 5).join(', ')}${m.length > 5 ? ` và ${m.length - 5} mã khác` : ''}` }

/** Bước soát giá bài đã lên của chu kỳ (khối chú thích ở trên). Đẩy dòng kết quả vào `o.results`; lỗi chung để người gọi bắt. */
async function suaGiaBaiDaLen(ctx: NgCanhFb, o: {
    page: any; tuDong: boolean; tienTo: string; now: number; results: any[]; xemTamDung: (p: any) => void; dangTamDung: () => boolean
}): Promise<void> {
    const { page, tuDong, tienTo, now, results } = o
    const dsBai = new Map<string, { k: KeHoachFb; len: number }>()
    for (const k of await ctx.kho.dsKeHoachBaiTu(now - SUA_GIA_TRONG_MS - HEN_TRUOC_TOI_DA_MS)) {
        const d = k.data || {}, r = k.result || {}
        if ((k.status !== 'succeeded' && k.status !== 'uncertain') || !r.postId || !d.productId || String(d.pageId || '') !== String(page.pageId)) continue
        const hen = Number(d.scheduledAt) || 0
        if (hen && hen > now - SUA_GIA_SAU_GIO_LEN_MS) continue // chưa lên / vừa lên — việc của soatBaiHenSapLen
        const len = hen || k.createdAt
        if (len < now - SUA_GIA_TRONG_MS) continue
        if (!dsBai.has(String(r.postId))) dsBai.set(String(r.postId), { k, len })
    }
    if (!dsBai.size) return

    const ids = [...new Set([...dsBai.values()].map(x => String(x.k.data.productId)))]
    const spDs: any[] = await ctx.prisma.product.findMany({ where: { id: { in: ids } }, select: { id: true, sku: true, name: true, sellingPrice: true, stock: true, mergedIntoId: true } })
    const spTheoId = new Map(spDs.map(s => [String(s.id), s]))
    const suaTheoBai = new Map<string, KeHoachFb[]>()
    for (const e of await ctx.kho.dsKeHoachSuaBai([...dsBai.keys()])) {
        const id = String(e.data?.postId || '')
        suaTheoBai.set(id, [...(suaTheoBai.get(id) || []), e])
    }

    const viec: ViecSuaGia[] = []
    const hetTon: string[] = [], chuaRo: string[] = [], quaLuot: string[] = []
    for (const [postId, { k, len }] of dsBai) {
        const sp = spTheoId.get(String(k.data.productId))
        if (!sp || sp.mergedIntoId) continue // mã mất / gộp: không biết giá đúng là giá nào — không sửa
        if (!(Number(sp.stock) > 0)) hetTon.push(String(sp.sku))
        const giaMoi = Math.round(Number(sp.sellingPrice) || 0)
        const sua = suaTheoBai.get(postId) || []
        const st = giaBaiTheoPilot(k, sua)
        if (st.boQuan || !(st.gia > 0)) continue
        if (st.mo.some(e => e.status === 'running')) continue // lượt khác đang sửa bài này
        if (st.chuaRo) { chuaRo.push(String(sp.sku)); continue }
        const lech = giaMoi > 0 && Math.abs(giaMoi - st.gia) >= 1
        let nhap: KeHoachFb | null = null
        for (const e of st.mo) {
            if (!nhap && lech && Math.round(Number(e.data?.giaMoi) || 0) === giaMoi && String(e.data?.chuoi || '') === st.chuoi) { nhap = e; continue }
            // nháp máy lỗi thời (giá đổi tiếp / trở về giá bài đang ghi / chuỗi đã đổi) ⇒ tự huỷ êm, lượt này lập theo giá hiện tại
            if (laNhapMay(e)) await ctx.kho.huyKeHoach(e.id, { tuHuy: true, message: `Giá bán nay là ${vnd(giaMoi)} — nháp sửa giá cũ tự huỷ.` })
        }
        if (!lech) continue
        if (nhap) { viec.push({ k, postId, len, sp, st, giaMoi, luot: 0, nhap }); continue }
        const cung = sua.filter(e => String(e.data?.chuoi || '') === st.chuoi && Math.round(Number(e.data?.giaMoi) || 0) === giaMoi)
        if (cung.some(e => e.status === 'cancelled' && !e.result?.tuHuy && now - e.updatedAt < NHO_NGUOI_HUY_MS)) continue // người huỷ = "đừng sửa"
        if (cung.some(e => e.status === 'failed' && !e.result?.daKiem && now - e.updatedAt < SUA_GIA_THU_LAI_MS)) continue // vừa hỏng (đã báo)
        // trần đếm lần HỎNG thật — nháp máy tự huỷ (hết hạn 3 ngày ở Xem trước, giá đổi tiếp) không phải lần thử
        if (cung.filter(e => e.status === 'failed').length >= SUA_GIA_TOI_DA_LUOT) { quaLuot.push(String(sp.sku)); continue }
        viec.push({ k, postId, len, sp, st, giaMoi, luot: cung.length + 1, nhap: null })
    }

    if (chuaRo.length) results.push({ action: 'edit', status: 'skipped', message: `${chuaRo.length} bài có lần sửa giá trước CHƯA RÕ kết quả (${dsMa(chuaRo)}) — mở bài kiểm rồi bấm «Đã kiểm» ở tab Nhật ký; máy không sửa tiếp bài đó.` })
    if (quaLuot.length) results.push({ action: 'edit', status: 'skipped', ...(tuDong ? { canNguoi: true } : {}), message: `Sửa giá hỏng ${SUA_GIA_TOI_DA_LUOT} lần ở ${quaLuot.length} bài (${dsMa(quaLuot)}) — máy thôi thử; sửa tay dòng giá trên fanpage.` })
    if (hetTon.length) {
        results.push({ action: 'edit', status: 'skipped', message: `${hetTon.length} bài Pilot đã lên đang mời mua mà tồn kho ≤ 0 (${dsMa(hetTon)}) — tồn ≤ 0 chưa chắc là hết hàng nên Pilot KHÔNG ghi "hết hàng" lên bài; nếu hết thật, sửa hoặc ẩn bài trên fanpage.` })
    }
    if (!viec.length) return

    // bài mới trước (khách còn đọc nhiều); phần dư để chu kỳ sau
    const lam = viec.sort((a, b) => b.len - a.len).slice(0, TRAN_SUA_MOI_CHU_KY)
    if (viec.length > lam.length) results.push({ action: 'edit', status: 'skipped', message: `Mỗi chu kỳ sửa giá tối đa ${TRAN_SUA_MOI_CHU_KY} bài — còn ${viec.length - lam.length} bài, chu kỳ sau sửa tiếp.` })
    const fb = dichVu(ctx, page.accessToken)
    let dsTren: any[] = []
    if (lam.some(v => !v.nhap)) {
        try {
            const r = await fb.get(`${page.pageId}/posts`, { fields: 'id,message,permalink_url', limit: 100 })
            dsTren = Array.isArray(r?.data) ? r.data : []
        } catch (e: any) {
            results.push({ action: 'edit', status: isRateLimitError(e) ? 'skipped' : 'failed', message: `Không đọc được bài trên fanpage để sửa giá (${lam.length} bài lệch giá kho): ${String(e?.message || e).slice(0, 300)}` })
            return
        }
    }
    const tren = new Map(dsTren.map(p => [String(p?.id), p]))
    const khongThay: string[] = []
    let hetLuot = false
    for (const v of lam) {
        if (o.dangTamDung()) break
        const sku = String(v.sp.sku)
        const ten = tenGon(v.sp.name || v.k.data?.name || sku)
        const tg = ngayGioVN(v.len)
        let p: KeHoachFb | null = v.nhap
        if (!p) {
            let bai = tren.get(v.postId)
            // danh sách đủ 100 bài ⇒ bài cũ có thể nằm ngoài trang đầu: đọc lẻ
            if (!bai && dsTren.length >= 100) bai = await fb.get(v.postId, { fields: 'id,message,permalink_url' }).catch(() => null)
            if (!bai) { khongThay.push(sku); continue }
            const chu = typeof bai.message === 'string' ? bai.message : ''
            const data: any = {
                pageId: page.pageId, pageName: page.name, postId: v.postId, postPlanId: v.k.id, productId: String(v.sp.id), sku, name: ten,
                giaCu: v.st.gia, giaMoi: v.giaMoi, chuoi: v.st.chuoi, luot: v.luot, postedAt: v.len,
                permalink: bai.permalink_url || null, dongCu: dongGiaBai(v.st.gia), dongMoi: dongGiaBai(v.giaMoi),
            }
            const khoa = `${tienTo}:edit:${v.postId}:${v.st.chuoi}:${v.giaMoi}:${v.luot}`
            const moi = thayGiaTrongBai(chu, v.st.gia, v.giaMoi)
            if (moi === null) {
                // không có dòng giá cũ Pilot viết ⇒ KHÔNG lập lệnh sửa; ghi kết luận (không gọi Facebook, không tính lượt ghi)
                const ketLuan = coDongGia(chu, v.giaMoi)
                    ? { status: 'succeeded', result: { postId: v.postId, giaCu: v.st.gia, giaMoi: v.giaMoi, khongCanSua: true, messageMoi: chu.normalize('NFC').slice(0, 5000), message: `Bài trên Facebook đã ghi ${dongGiaBai(v.giaMoi)} (sửa tay) — Pilot không cần sửa.` } }
                    : chuCoGia(chu, v.st.gia)
                        ? { status: 'failed', result: { postId: v.postId, boQuan: true, message: `Bài vẫn ghi giá cũ ${vnd(v.st.gia)} nhưng không đúng dòng "${dongGiaBai(v.st.gia)}" Pilot viết — Pilot không sửa chữ người viết: sửa tay thành ${vnd(v.giaMoi)} trên fanpage.` } }
                        : { status: 'skipped', result: { postId: v.postId, boQuan: true, message: 'Chữ bài trên Facebook không còn giá cũ (đã sửa tay / bỏ dòng giá) — Pilot thôi theo dõi giá bài này.' } }
                const kl = await ctx.kho.taoKeHoach({ ...keHoachMoi('edit', data, khoa, ctx.nguoi, now), status: ketLuan.status, result: ketLuan.result })
                results.push({ action: 'edit', status: kl.status, sku, planId: kl.id, message: `${ten} (bài ${tg}): ${kl.result?.message || ''}` })
                continue
            }
            p = await ctx.kho.taoKeHoach(keHoachMoi('edit', { ...data, messageCu: chu.normalize('NFC').slice(0, 5000), messageMoi: moi.slice(0, 5000) }, khoa, ctx.nguoi, now))
        }
        // Xem trước KHÔNG ghi gì lên Facebook (thucThiFb trả executed:false, kể cả người bấm) ⇒ nháp chỉ để xem, không phải việc chờ
        // duyệt; chỉ Tự động hết lượt ghi mới là việc cần người (bài công khai ghi giá cũ tới lượt sau)
        let canNguoi = false
        if (tuDong && p.status === 'draft' && laNhapMay(p) && !laNhapXemTruoc(p) && !hetLuot) {
            try {
                const r: any = await thucThiFb(ctx, p.id, { tuDong: true })
                p = (r.plan || r) as KeHoachFb
                o.xemTamDung(p)
            } catch (e: any) {
                if (!e?.hetLuotGhi) {
                    results.push({ action: 'edit', status: 'failed', sku, planId: p.id, message: `${ten} (bài ${tg}): ${String(e?.message || e).slice(0, 300)}` })
                    continue
                }
                hetLuot = true
            }
        }
        if (tuDong && hetLuot && p.status === 'draft') canNguoi = true
        const duoi = p.status !== 'draft' ? '' : !tuDong
            ? ' — Xem trước: CHƯA sửa trên Facebook (bật Tự động để Pilot sửa; cần gấp thì sửa tay trên fanpage)'
            : canNguoi ? ' — HẾT LƯỢT GHI hôm nay: bài còn ghi giá cũ tới lượt sau (nâng trần ghi trong chính sách hoặc sửa tay)' : ''
        results.push({
            action: 'edit', status: p.status, sku, planId: p.id, ...(canNguoi ? { canNguoi: true } : {}),
            message: `${ten} (bài ${tg}): ${String(p.data?.dongCu || '')} → ${String(p.data?.dongMoi || '')}${p.result?.message ? ` — ${p.result.message}` : ''}${duoi}`,
        })
    }
    if (khongThay.length) results.push({ action: 'edit', status: 'skipped', message: `${khongThay.length} bài lệch giá kho không thấy trên fanpage (${dsMa(khongThay)}) — đã xoá, hoặc chưa lên; bỏ qua.` })
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
                const kiem = k.kind === 'post' ? 'mở fanpage kiểm bài đã lên chưa' : k.kind === 'reply' ? 'mở bài kiểm câu trả lời đã có chưa'
                    : k.kind === 'edit' ? 'mở bài kiểm dòng giá đã đổi chưa'
                        : k.kind === 'unhide' ? 'mở bài kiểm bình luận đã hiện lại chưa' : 'mở bài kiểm bình luận đã ẩn chưa'
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
            // nháp máy của lượt Tự động: bài (hụt lượt ghi / chưa kịp thực thi) hoặc việc Facebook từng báo "thử lại sau".
            // Nháp sửa giá ('edit') KHÔNG vào đây: bước soát giá bài (suaGiaBaiDaLen) tự xét lại theo giá HIỆN TẠI rồi mới thực thi
            // (nháp lỗi thời bị huỷ êm thay vì thực thi để hỏng rồi báo chủ shop)
            if (tuDong && !laNhapXemTruoc(k) && k.kind !== 'edit' && (k.kind === 'post' || k.result?.tamThoi)) thuLai.push(k)
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

    // FB-15 (10/11/2026): bài Pilot đã lên mà giá kho đổi ⇒ sửa dòng giá — TRƯỚC khi lập bài mới: giá sai trên bài công khai gấp hơn
    // bài mới, mà trần ghi / ngày dùng chung
    if (pol.automation.editPrices && !tamDung) {
        try {
            await suaGiaBaiDaLen(ctx, { page, tuDong, tienTo, now, results, xemTamDung, dangTamDung: () => !!tamDung })
        } catch (e: any) {
            results.push({ action: 'edit', status: 'failed', message: `Soát giá bài đã lên hỏng: ${String(e?.message || e).slice(0, 300)}` })
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
                if (now - c.createdTime > HAN_BINH_LUAN_MS) continue
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
                // người của shop đã trả lời tay ngay trong luồng (sau bình luận này) ⇒ không soạn nháp đè lên
                if (pol.automation.replyPriceQuestions && c.askPrice && c.suggestion && c.product && !c.shopTraLoi && soTraLoi < pol.maxRepliesPerCycle) {
                    // Máy chỉ TỰ GỬI khi chắc là khách, chưa ai trả lời, và tồn dương — còn lại để nháp chờ người duyệt
                    const choDuyet = !c.fromId ? 'không rõ người viết (token thiếu quyền đọc người bình luận)'
                        : c.shopDaVao ? 'khách hỏi tiếp trong luồng shop đã trả lời — cần người đọc cả luồng'
                            : c.replies > 0 ? 'bình luận đã có người trả lời'
                            : !(c.product.stock > 0) ? `tồn kho ${c.product.stock} — kiểm hàng trước khi trả lời`
                                : null
                    try {
                        let plan: any = await taoKeHoachTraLoi(ctx, {
                            commentId: c.id, message: c.suggestion, postId: c.postId, commentMsg: c.message, fromName: c.fromName,
                            productId: c.product.productId, sku: c.product.sku, price: c.product.price, idempotencyKey: `${tienTo}:reply:${c.id}`,
                            replyTo: c.replyTo,
                        })
                        if (tuDong && !choDuyet && plan.status === 'draft') plan = await thucThiFb(ctx, plan.id, { tuDong: true })
                        const p = plan.plan || plan
                        xemTamDung(p)
                        soTraLoi++
                        results.push({
                            action: 'reply', status: p.status, planId: p.id, sku: c.product.sku,
                            ...(tuDong && choDuyet ? { canNguoi: true } : {}),
                            message: `${c.fromName || 'Khách'}: "${c.message.slice(0, 60)}" → giá ${vnd(c.product.price)}${p.result?.message ? ` — ${p.result.message}` : ''}${tuDong && choDuyet ? ` — CHỜ NGƯỜI DUYỆT: ${choDuyet}` : ''}`,
                        })
                    } catch (e: any) {
                        results.push({ action: 'reply', status: 'failed', message: String(e?.message || e).slice(0, 300) })
                    }
                }
            }
            if (!soTraLoi && !soAn) results.push({ action: 'comments', status: 'unchanged', message: `Soát ${bl.comments.length} bình luận${bl.luong ? ' (cả trả lời trong luồng)' : ''} trên ${bl.soBai} bài gần nhất: không có gì cần xử lý.` })
            for (const g of bl.ghiChu) results.push({ action: 'comments', status: 'skipped', message: g.slice(0, 400) })
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
    // X-14: ai đổi gì — dòng sổ 'config' (không tính vào trần ghi / ngày)
    await ghiDoiCauHinh(ctx.kho, {
        nguoi: ctx.nguoi, nhan: NHAN_FACEBOOK, docRieng: { pageId: v => pages.find(p => String(p.pageId) === String(v))?.name || String(v) },
        cu: { pageId: cfg.pageId, executionMode: cfg.executionMode, policy: cfg.policy, schedule: cfg.schedule },
        moi: { pageId, executionMode, policy, schedule },
    })
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
    // Xem trước chưa đăng gì ⇒ chỉ chu kỳ gãy + token sắp hết hạn mới báo (ketQuaDeBao, X-09); Tự động ⇒ mọi việc cần người
    const bao = await baoChuShop(prisma, 'Facebook Pilot', ketQuaDeBao(ketQua, ketQua.executionMode !== 'auto'), truoc, now).catch(() => truoc)
    await k.ghiKetQuaLich(now, { ...ketQua, ...(bao ? { baoChuShop: bao } : {}) }).catch(() => { })
    return ketQua.ok ? 'da-chay' : 'loi'
}

// ─── Kích sớm khi có bình luận mới (10/11/2026, FB-09) ──────────────────────────────────────────

/** Có bình luận mới ⇒ lượt theo lịch kế tiếp dời về sau bấy lâu (gom vài bình luận tới dồn vào một lượt). */
export const TRE_KICH_BL_MS = 60_000
/** Hai lượt chạy cách nhau ít nhất bấy lâu dù bình luận tới liên tục — giữ hạn mức Facebook, chặn vòng lặp webhook. */
export const SAN_KICH_BL_MS = 10 * 60_000

/**
 * Webhook Facebook báo có bình luận mới trên `pageId` ⇒ kéo lượt chạy theo lịch về now + 1 phút, để khách hỏi giá không phải chờ
 * hết một chu kỳ (mặc định 4 giờ). KHÔNG chạy gì ở đây và không gọi Facebook: chỉ dời "nextRunAt" bằng chính phép giành nguyên
 * tử của lịch (gianhLich) — lượt chạy thật vẫn do nhịp cron làm, vẫn một bản máy một lượt.
 * Chỉ kích khi chủ shop ĐÃ bật: lịch tự chạy + chế độ Tự động + (tự trả lời giá hoặc tự ẩn số điện thoại) + đúng fanpage của Pilot.
 * Xem trước thì không kích (không có gì gửi đi, chỉ tốn lượt đọc).
 */
export async function kichSomTheoBinhLuan(prisma: any, pageId: string, o: { kho?: KhoFbPilot; bayGio?: () => number } = {}): Promise<'khong-dung' | 'sap-chay' | 'vua-chay' | 'bi-gianh' | 'da-kich' | 'loi'> {
    try {
        const now = o.bayGio ? o.bayGio() : Date.now()
        if (!o.kho) {
            // cửa hàng chưa từng mở Facebook Pilot ⇒ bảng chưa có: thôi, KHÔNG tạo bảng hộ (khoSqlFb sẽ tạo)
            try {
                const [r]: any[] = await prisma.$queryRawUnsafe(`SELECT "nextRunAt"::float8 AS "nextRunAt" FROM "FacebookPilotConfig" WHERE id = 'default'`)
                if (!r || r.nextRunAt == null) return 'khong-dung'
            } catch {
                return 'khong-dung'
            }
        }
        const k = o.kho || khoSqlFb(prisma)
        const cfg = await k.docCauHinh()
        if (!cfg || cfg.nextRunAt == null || !cfg.schedule?.enabled || cfg.executionMode !== 'auto') return 'khong-dung'
        const tuDongHoa = cfg.policy?.automation
        if (!tuDongHoa?.replyPriceQuestions && !tuDongHoa?.hidePhoneComments) return 'khong-dung'
        const pages: { pageId: string }[] = await prisma.fbPage.findMany({ where: { status: { not: 'disconnected' } }, select: { pageId: true } })
        if (chonTrangPilot(cfg, pages)?.pageId !== String(pageId)) return 'khong-dung'
        if (cfg.nextRunAt <= now + TRE_KICH_BL_MS) return 'sap-chay'
        const lanTruoc = Math.max(Number(cfg.lastRunAt) || 0, cfg.nextRunAt - cfg.schedule.intervalMinutes * 60_000)
        if (lanTruoc > now - SAN_KICH_BL_MS) return 'vua-chay'
        return (await k.gianhLich(cfg.nextRunAt, now + TRE_KICH_BL_MS)) ? 'da-kich' : 'bi-gianh'
    } catch {
        return 'loi'
    }
}

// ─── Soát bài hẹn sắp lên (09/11/2026 — gọi từ cron/aiAgentCron mỗi nhịp phút) ──────────────────

/* Pilot giao bài HẸN GIỜ cho Facebook trước tới 3 ngày; tồn / giá chỉ soát lúc giao (dangBai). Giá đổi hay hàng hết sau đó thì
 * bài vẫn lên với số cũ. Nhịp ngoài (POST /api/cron/tick mỗi phút → aiAgentCron.quetTuNgoai → nhipSoatBaiHenFb) soát lại bài hẹn CỦA PILOT
 * sắp lên — dòng FbScheduledPost 'scheduled' nối được về kế hoạch 'succeeded' (result.scheduledPostId VÀ result.postId khớp
 * fbPostId) — đọc SỐNG kho rồi RÚT (xoá bài hẹn chưa lên) khi:
 *   - mã không còn / đã gộp / tồn < minStock của chính sách HIỆN TẠI;
 *   - giá bán đổi ≥ 1đ VÀ chữ bài còn hiện giá cũ (chữ không ghi giá thì giá đổi không làm bài sai).
 * Chữ + giờ lên lấy ở dòng FbScheduledPost (Fanpage Manager sửa được cả hai), đối chiếu thêm bản Facebook trả về.
 * CHỈ xoá khi Facebook còn liệt kê bài trong scheduled_posts VÀ giờ lên còn cách ≥ BIEN_XOA_MS — không bao giờ xoá bài đã công
 * khai, không bao giờ đụng bài không do Pilot tạo. Rút xong: kế hoạch 'cancelled' + tuHuy (không chặn mã 21 ngày, không thành
 * "người huỷ ⇒ nhớ 14 ngày"), dòng FbScheduledPost 'cancelled', nhật ký 'withdraw', MỘT tin gộp cho chủ shop. Không rút được
 * (token / quyền / không rõ kết cục / quá sát giờ / đã lên) ⇒ kế hoạch 'uncertain' + tin KHẨN "vào fanpage xử lý tay".
 * Hạn mức / đọc hỏng tạm thời ⇒ nhả, nhịp sau thử lại. Nhiều bản máy (prod không có Redis): giành từng kế hoạch bằng
 * doiKeHoachNeu (CAS trên dòng CSDL) TRƯỚC khi gọi Facebook ⇒ hai lượt song song không cùng xoá, không cùng báo.
 */

/** Soát bài có giờ lên trong 60 phút tới: đủ sát giờ để quyết theo số LÚC LÊN (hôm nay hết hàng, mai về thì bài hẹn ngày kia
 *  vẫn đúng — rút sớm là mất bài oan), đủ rộng để hạn mức Facebook / vài nhịp hụt vẫn còn hàng chục lượt thử. */
export const SOAT_TRUOC_MS = 60 * 60_000
/** Quá giờ ≤ 30 phút mà dòng vẫn 'scheduled' (đêm không có đối soát fanpageCron) — chỉ để BÁO bài đã lên với số cũ, không xoá. */
export const SOAT_TRE_MS = 30 * 60_000
/** Chỉ gửi lệnh xoá khi giờ lên còn cách ≥ 3 phút: lệnh ghi chờ tối đa 90 giây ⇒ lệnh xoá tới Facebook TRƯỚC giờ lên. */
export const BIEN_XOA_MS = 3 * 60_000
/** Một lượt giữ một kế hoạch tối đa bấy nhiêu (đọc 30 giây + xoá 90 giây + ghi sổ); chết giữa chừng thì lượt sau giành lại. */
const HAN_GIU_SOAT_MS = 5 * 60_000

/** Chữ bài có hiện giá `gia` không — "26.000đ" (bài máy soạn), "26,000", "26 000", "26000", "26k", "26,5k", "26 nghìn",
 *  "1,2tr", "1tr2", "1 triệu"… Ranh giới số: "126.000" hay "26.000.000" không phải 26.000; "26kg" không phải giá. */
export function chuCoGia(chu: string, gia: number): boolean {
    const n = Math.round(Number(gia) || 0)
    if (!(n > 0)) return false
    const s = String(chu || '').normalize('NFC').replace(/[    ]/g, ' ')
    const dau = '(?<![\\d.,])'
    const het = '(?![\\p{L}\\d])'
    const NGHIN = '(?:k|nghìn|ngàn|nghin|ngan)'
    const TRIEU = '(?:tr|triệu|trieu)'
    const mau = [`${dau}${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '#').split('#').join('[., ]?')}(?![.,]?\\d)`]
    const le = (du: number, chuSo: number) => String(du).padStart(chuSo, '0').replace(/0+$/, '')
    if (n >= 1000 && n % 10 === 0) {
        const a = Math.floor(n / 1000), d = le(n % 1000, 3)
        mau.push(d ? `${dau}${a}[.,]${d} ?${NGHIN}${het}` : `${dau}${a} ?${NGHIN}${het}`)
        if (d) mau.push(`${dau}${a} ?k ?${d}${het}`)
    }
    if (n >= 1_000_000 && n % 10_000 === 0) {
        const a = Math.floor(n / 1_000_000), d = le(n % 1_000_000, 6)
        mau.push(d ? `${dau}${a}[.,]${d} ?${TRIEU}${het}` : `${dau}${a} ?${TRIEU}${het}`)
        if (d) mau.push(`${dau}${a} ?${TRIEU} ?${d}${het}`, `${dau}${a} ?${TRIEU} ?${(n % 1_000_000) / 1000} ?${NGHIN}${het}`)
    }
    return mau.some(m => new RegExp(m, 'iu').test(s))
}

export interface LyDoRut { loai: 'ma' | 'ton' | 'gia'; lyDo: string }
/** Lý do RÚT một bài hẹn của Pilot theo kho HIỆN TẠI; null = bài vẫn đúng. `chu` = chữ bài sẽ lên, `giaCu` = giá lúc lập kế hoạch. */
export function lyDoRutBai(sp: { sellingPrice?: any; stock?: any; mergedIntoId?: any } | null, giaCu: number, chu: string, pol: ChinhSachFbPilot): LyDoRut | null {
    if (!sp) return { loai: 'ma', lyDo: 'mã hàng không còn trong kho' }
    if (sp.mergedIntoId) return { loai: 'ma', lyDo: 'mã đã gộp vào mã khác' }
    if (!(Number(sp.stock) >= pol.minStock)) return { loai: 'ton', lyDo: `tồn kho còn ${Number(sp.stock) || 0}, dưới mức ${pol.minStock} của chính sách` }
    const moi = Number(sp.sellingPrice) || 0, cu = Number(giaCu) || 0
    if (Math.abs(moi - cu) >= 1 && chuCoGia(chu, cu)) return { loai: 'gia', lyDo: `giá bán đã đổi từ ${vnd(cu)} thành ${vnd(moi)} mà bài còn ghi giá cũ` }
    return null
}

const SCHEMA_HOP_LE = /^[A-Za-z0-9_]+$/
/** Câu dò NHẸ chạy bằng kết nối REGISTRY (cùng CSDL, ghi rõ schema — như lib/donTonMaGop): số bài hẹn CỦA PILOT có giờ lên trong
 *  cửa sổ soát. 0 ⇒ nhịp không mở client riêng cho cửa hàng (cả cụm chỉ ~45 kết nối, client bị chạm mỗi phút thì không bao giờ
 *  được thải). Bảng kế hoạch chưa có (chưa từng dùng Pilot) ⇒ câu ném 42P01, người gọi bỏ qua êm (laThieuBang). Giờ so bằng đồng
 *  hồ CSDL theo UTC như mọi cột Prisma DateTime (timestamp không múi giờ, giữ giờ UTC), nới mỗi bên 1 phút — soatBaiHenSapLen
 *  lọc lại chính xác theo đồng hồ máy chủ. */
export function sqlDemBaiHenSapLen(schema: string): string {
    if (!SCHEMA_HOP_LE.test(schema)) throw new Error(`schema lạ: ${schema}`)
    const truoc = Math.ceil(SOAT_TRUOC_MS / 60_000) + 1, tre = Math.ceil(SOAT_TRE_MS / 60_000) + 1
    return `SELECT COUNT(*)::int AS n FROM "${schema}"."FbScheduledPost" s
             WHERE s.status = 'scheduled' AND s."fbPostId" IS NOT NULL
               AND s."scheduledAt" >= (NOW() AT TIME ZONE 'UTC') - interval '${tre} minutes'
               AND s."scheduledAt" <= (NOW() AT TIME ZONE 'UTC') + interval '${truoc} minutes'
               AND EXISTS (SELECT 1 FROM "${schema}"."FacebookPilotPlan" p WHERE p.kind = 'post' AND p.status = 'succeeded'
                             AND p.result IS NOT NULL AND p.result::jsonb->>'scheduledPostId' = s.id)`
}

/** da_rut = đã xoá bài hẹn · can_nguoi = không xoá được (token / quyền / không rõ kết cục…) · qua_gio = còn < BIEN_XOA_MS, không
 *  kịp xoá an toàn · da_len = Facebook không còn bài hẹn và giờ đã tới · khong_con_hen = Facebook không còn bài hẹn mà giờ chưa tới
 *  (xoá tay / đăng sớm) · thu_lai = hạn mức / đọc hỏng tạm thời, nhịp sau thử lại · giu_nguyen = chữ trên Facebook không còn giá cũ. */
export type KetCucSoatBaiHen = 'da_rut' | 'can_nguoi' | 'qua_gio' | 'da_len' | 'khong_con_hen' | 'thu_lai' | 'giu_nguyen'
export interface ViecSoatBaiHen { planId: string; sku: string | null; scheduledAt: number; lyDo: string; ketCuc: KetCucSoatBaiHen; message: string; baoChu: boolean }
export interface KetQuaSoatBaiHen {
    /** khong-co = không có bài hẹn nào của Pilot trong cửa sổ · da-soat = đã xét (có thể chẳng phải làm gì) */
    trangThai: 'khong-co' | 'da-soat'
    daXet: number
    viec: ViecSoatBaiHen[]
    daBao: boolean
}

/**
 * Soát các bài hẹn của Pilot sắp lên (xem khối chú thích ở trên). Đọc nhẹ: một truy vấn FbScheduledPost theo chỉ mục
 * status + scheduledAt; không có bài trong cửa sổ thì dừng. TUẦN TỰ (pool 1 kết nối) — người gọi giữ client (giuClient).
 * Bài không có lý do rút ⇒ không gọi Facebook, không ghi gì. Ngân sách thời gian `nganSachMs` (mặc định 40 giây, đồng hồ thật):
 * hết thì dừng, bài còn lại nhịp sau soát tiếp (còn trong cửa sổ).
 */
export async function soatBaiHenSapLen(prisma: any, kho?: KhoFbPilot, ngoai: Partial<NgCanhFb> & { nganSachMs?: number } = {}): Promise<KetQuaSoatBaiHen> {
    const dongHo = () => (ngoai.bayGio ? ngoai.bayGio() : Date.now())
    const batDau = Date.now()
    const nganSach = ngoai.nganSachMs ?? 40_000
    const now = dongHo()
    const ra: KetQuaSoatBaiHen = { trangThai: 'khong-co', daXet: 0, viec: [], daBao: false }
    const guong: any[] = await prisma.fbScheduledPost.findMany({
        where: { status: 'scheduled', fbPostId: { not: null }, scheduledAt: { gte: new Date(now - SOAT_TRE_MS), lte: new Date(now + SOAT_TRUOC_MS) } },
        select: { id: true, pageId: true, fbPostId: true, message: true, scheduledAt: true },
        orderBy: { scheduledAt: 'asc' },
        take: 200,
    })
    if (!guong.length) return ra
    const k = kho || khoSqlFb(prisma)
    const theoId = new Map(guong.map(g => [String(g.id), g]))
    const cap = (await k.dsKeHoachBaiHen([...theoId.keys()]))
        .map(p => ({ p, g: theoId.get(String(p.result?.scheduledPostId)) }))
        // CHỈ bài của Pilot, còn HẸN: kế hoạch nối đúng dòng FbScheduledPost VÀ đúng mã bài Facebook, lúc giao là bài hẹn (published
        // false). Dòng FbScheduledPost của Fanpage Manager / Content AI không có kế hoạch nối tới ⇒ không bao giờ bị đụng.
        .filter((x): x is { p: KeHoachFb; g: any } => !!x.g && x.p.result?.published === false && !!x.p.result?.postId && String(x.p.result.postId) === String(x.g.fbPostId))
        .sort((a, b) => new Date(a.g.scheduledAt).getTime() - new Date(b.g.scheduledAt).getTime())
    if (!cap.length) return ra
    ra.trangThai = 'da-soat'
    const pol = ((await k.docCauHinh()) || cauHinhMacDinh()).policy
    const trang = new Map<string, any>()                     // pageId → dòng FbPage (đọc một lần mỗi lượt)
    const henTrenFb = new Map<string, any[] | { loi: any }>() // pageId → scheduled_posts Facebook trả (một lần mỗi lượt)
    const luot = crypto.randomUUID()

    for (const { p, g } of cap) {
        if (Date.now() - batDau > nganSach) break
        ra.daXet++
        const hen = new Date(g.scheduledAt).getTime()
        const d = p.data || {}
        const sp = await docHangBaiHen(prisma, String(d.productId || ''))
        const ly = lyDoRutBai(sp, Number(d.price) || 0, String(g.message || d.message || ''), pol)
        if (!ly) continue
        const goc = p.result || {}
        const truoc = goc.rutBai
        if (truoc && !(truoc.trangThai === 'dang' && Number(truoc.han) < dongHo())) continue // lượt khác đang giữ bài này
        const { rutBai: _cu, ...sach } = goc
        const giu = { ...sach, rutBai: { trangThai: 'dang', luot, luc: dongHo(), han: dongHo() + HAN_GIU_SOAT_MS, lyDo: ly.lyDo } }
        if (!(await k.doiKeHoachNeu(p.id, { status: 'succeeded', result: goc }, { status: 'succeeded', result: giu }))) continue

        // ── giữ được bài: hỏi Facebook rồi quyết ──
        let kq: { ketCuc: KetCucSoatBaiHen; loi?: string; loai?: string; daGoiXoa?: boolean; len?: number }
        const loiFb = (e: any, laXoa: boolean): typeof kq => {
            const loai = loaiLoiFb(e)
            const loi = String(e?.message || e).slice(0, 300)
            // lệnh ĐỌC hỏng vì mạng / hết giờ / Facebook 5xx cũng chỉ là tạm — đọc lại nhịp sau (đọc không đổi gì trên Facebook)
            if (loai === 'tam_thoi' || (!laXoa && (e?.hetGio || !e?.code || Number(e?.httpStatus) >= 500))) return { ketCuc: 'thu_lai', loi, loai }
            return { ketCuc: 'can_nguoi', loi, loai, daGoiXoa: laXoa }
        }
        if (!trang.has(g.pageId)) {
            const [pg] = await prisma.fbPage.findMany({ where: { pageId: String(g.pageId) }, select: { pageId: true, name: true, status: true, accessToken: true } })
            trang.set(g.pageId, pg || null)
        }
        const pg = trang.get(g.pageId)
        if (!pg || pg.status !== 'active' || !pg.accessToken) {
            kq = { ketCuc: 'can_nguoi', loi: !pg ? 'fanpage không còn nối ở Kengi' : pg.status === 'token_expired' ? 'token fanpage đã hết hạn — dán token mới ở tab Kết nối' : pg.status === 'disconnected' ? 'fanpage đã ngắt nối ở Kengi' : 'fanpage chưa có token' }
        } else {
            const fb: DichVuFb = ngoai.taoFb ? ngoai.taoFb(pg.accessToken) : new FacebookService(pg.accessToken)
            let ds = henTrenFb.get(g.pageId)
            if (!ds) {
                try { ds = await fb.listScheduledPosts(pg.pageId) } catch (e: any) { ds = { loi: e } }
                henTrenFb.set(g.pageId, ds)
            }
            if (!Array.isArray(ds)) kq = loiFb(ds.loi, false)
            else {
                const tren = ds.find(x => String(x?.id) === String(g.fbPostId))
                if (!tren) {
                    kq = ds.length >= 100
                        ? { ketCuc: 'can_nguoi', loi: 'fanpage có từ 100 bài hẹn trở lên — không đọc hết danh sách để biết bài còn hẹn hay không' }
                        : { ketCuc: hen <= dongHo() + BIEN_XOA_MS ? 'da_len' : 'khong_con_hen' }
                } else if (ly.loai === 'gia' && typeof tren.message === 'string' && !chuCoGia(tren.message, Number(d.price) || 0)) {
                    kq = { ketCuc: 'giu_nguyen' } // chữ đã sửa thẳng trên Facebook, không còn giá cũ ⇒ bài không sai
                } else {
                    const henFb = Number(tren.scheduledPublishTime) > 0 ? Number(tren.scheduledPublishTime) * 1000 : hen
                    const len = Math.min(hen, henFb)
                    if (len - dongHo() < BIEN_XOA_MS) kq = { ketCuc: 'qua_gio', len }
                    else {
                        try {
                            await fb.deletePost(String(g.fbPostId))
                            kq = { ketCuc: 'da_rut', daGoiXoa: true }
                        } catch (e: any) {
                            kq = loiFb(e, true)
                        }
                    }
                }
            }
            if (kq.loai === 'token') {
                await prisma.fbPage.update({ where: { pageId: pg.pageId }, data: { status: 'token_expired' } }).catch(() => { })
                trang.set(g.pageId, { ...pg, status: 'token_expired' })
            }
        }

        // ── ghi kết cục: CAS từ đúng bản đang giữ ──
        const sku = (d.sku || sp?.sku || null) as string | null
        const tg = ngayGioVN(hen)
        if (kq.ketCuc === 'thu_lai' || kq.ketCuc === 'giu_nguyen') {
            await k.doiKeHoachNeu(p.id, { status: 'succeeded', result: giu }, { status: 'succeeded', result: sach })
            if (kq.ketCuc === 'thu_lai') console.warn(`[FacebookPilot] rút bài hẹn ${p.id} (${sku}) tạm hoãn — nhịp sau thử lại:`, kq.loi)
            ra.viec.push({ planId: p.id, sku, scheduledAt: hen, lyDo: ly.lyDo, ketCuc: kq.ketCuc, message: kq.loi || 'Chữ bài trên Facebook không còn giá cũ — giữ nguyên.', baoChu: false })
            continue
        }
        const q = kq.loai === 'quyen' ? quyenThieuFb({ message: kq.loi }) : null
        const vi = kq.loai === 'khong_ro' ? 'không rõ Facebook đã xoá chưa (hết giờ / Facebook lỗi máy chủ)'
            : kq.loai === 'token' ? `Facebook từ chối token của fanpage — dán page token mới ở tab Kết nối (${kq.loi})`
                : kq.loai === 'quyen' ? `page token thiếu quyền${q ? ` ${q}` : ''} (${kq.loi})` : kq.loi || 'lỗi lạ'
        const soCu = ly.loai === 'gia' ? 'giá cũ' : ly.loai === 'ton' ? 'tồn cũ' : 'mã hàng cũ'
        const message = kq.ketCuc === 'da_rut' ? `Đã RÚT bài hẹn ${tg} trước giờ lên — ${ly.lyDo}. Bài chưa lên Facebook; lập kế hoạch mới để đăng theo số hiện tại.`
            : kq.ketCuc === 'can_nguoi' ? `KHẨN: bài hẹn ${tg} sẽ lên với ${soCu} (${ly.lyDo}) — Pilot không rút được: ${vi}. Vào fanpage xoá tay bài hẹn này.`
                : kq.ketCuc === 'qua_gio' ? `KHẨN: bài hẹn ${ngayGioVN(kq.len || hen)} sẽ lên với ${soCu} (${ly.lyDo}) — còn dưới ${BIEN_XOA_MS / 60_000} phút, Pilot không kịp rút an toàn. Sửa hoặc xoá tay trên fanpage.`
                    : kq.ketCuc === 'da_len' ? `Bài hẹn ${tg} đã lên Facebook với ${soCu} (${ly.lyDo}) — Pilot KHÔNG xoá bài đã công khai. Sửa hoặc xoá tay trên fanpage nếu cần.`
                        : `Facebook không còn bài hẹn ${tg} trong danh sách hẹn giờ — đã bị xoá tay, hoặc đã đăng sớm (khi đó bài mang ${soCu}: ${ly.lyDo}). Pilot không xoá gì; kiểm trên fanpage.`
        const luc = dongHo()
        const daChot = kq.ketCuc === 'da_rut'
            ? await k.doiKeHoachNeu(p.id, { status: 'succeeded', result: giu }, { status: 'cancelled', result: { ...sach, tuHuy: true, message, rutBai: { trangThai: 'da_rut', luc, lyDo: ly.lyDo } } })
            : await k.doiKeHoachNeu(p.id, { status: 'succeeded', result: giu }, { status: 'uncertain', result: { ...sach, message, rutBai: { trangThai: kq.ketCuc, luc, lyDo: ly.lyDo, ...(kq.loi ? { loi: kq.loi } : {}) } } })
        if (!daChot) console.warn(`[FacebookPilot] rút bài hẹn ${p.id}: kế hoạch đã bị lượt khác đổi (quá hạn giữ?) — kết cục ${kq.ketCuc} không ghi`)
        if (kq.ketCuc === 'da_rut') {
            await prisma.fbScheduledPost.updateMany({ where: { id: g.id, status: 'scheduled' }, data: { status: 'cancelled', errorMessage: `Facebook Pilot rút bài hẹn: ${ly.lyDo}`.slice(0, 500) } })
                .catch((e: any) => console.error('[FacebookPilot] rút bài hẹn — ghi FbScheduledPost lỗi:', e?.message || e))
        }
        if (kq.daGoiXoa) {
            await k.ghiNhatKy({ action: 'withdraw', status: kq.ketCuc === 'da_rut' ? 'succeeded' : kq.loai === 'khong_ro' ? 'uncertain' : 'failed', planId: p.id, payload: { sku, postId: g.fbPostId, scheduledAt: hen, lyDo: ly.lyDo }, response: { message } })
                .catch((e: any) => console.error('[FacebookPilot] rút bài hẹn — ghi nhật ký lỗi:', e?.message || e))
        }
        ra.viec.push({ planId: p.id, sku, scheduledAt: hen, lyDo: ly.lyDo, ketCuc: kq.ketCuc, message, baoChu: daChot })
    }

    // ── MỘT tin gộp cho chủ shop mỗi lượt — chỉ việc vừa chốt (CAS) ⇒ mỗi bài báo đúng một lần dù nhiều bản máy cùng soát ──
    const bao = ra.viec.filter(v => v.baoChu)
    if (bao.length) {
        const khan = bao.filter(v => v.ketCuc !== 'da_rut').length
        const title = khan
            ? `Facebook Pilot KHẨN: ${khan} bài hẹn giờ cần xử lý tay trên fanpage`
            : `Facebook Pilot: đã rút ${bao.length} bài hẹn giờ vì giá / tồn / mã hàng đã đổi`
        const message = bao.map(v => `• ${v.sku || 'Bài'}: ${v.message}`).join('\n').slice(0, 2000)
        try {
            const tin = await prisma.notification.create({ data: { type: 'warning', title, message } })
            ra.daBao = true
            const { sendPushToStore } = await import('../routes/notifications')
            // X-06: nhóm 'pilot' (kênh có chuông trên app) + đường trang Facebook Pilot — tin KHẨN mà rơi kênh "Hệ thống" im là vô nghĩa
            sendPushToStore(prisma, title, message, { id: tin?.id, type: 'warning', nhom: NHOM_PILOT, web: duongPilotCuaTieuDe('Facebook Pilot') }).catch(() => { })
        } catch (e: any) {
            console.error('[FacebookPilot] rút bài hẹn — ghi thông báo chủ shop lỗi:', e?.message || e)
        }
    }
    return ra
}

/** Hàng của bài hẹn, đọc SỐNG (đủ trường lyDoRutBai cần + sku cho tin báo). */
async function docHangBaiHen(prisma: any, id: string): Promise<{ id: string; sku: string; sellingPrice: any; stock: any; mergedIntoId: string | null } | null> {
    if (!id) return null
    return prisma.product.findUnique({ where: { id }, select: { id: true, sku: true, sellingPrice: true, stock: true, mergedIntoId: true } })
}

export const HUONG_DAN_FB_PILOT = `FACEBOOK PILOT TRÊN KENGI

Pilot lên bài sản phẩm cho fanpage và xử lý bình luận, dữ liệu lấy thẳng từ kho của cửa hàng — tên, giá, mô tả, ảnh đều là số thật.

1. Kết nối
   - Mở kengi.vn → Bán Hàng Online → Facebook Pilot (https://kengi.vn/pilot-facebook/), đăng nhập bằng tài khoản Kengi.
   - Tab Kết nối → «Dán token»: dán USER token đã gia hạn (cách bền nhất) hoặc PAGE token. Lấy USER token: Graph API Explorer →
     chọn app → ô "User or Page" để User Token → tick pages_show_list, pages_read_engagement, pages_manage_posts,
     pages_manage_engagement, pages_read_user_content → Generate (Facebook hỏi fanpage nào thì tick fanpage cần nối); rồi bấm ⓘ cạnh
     token → Open in Access Token Tool → «Extend Access Token», chép token mới.
   - Dán USER token: Kengi tự lấy page token của fanpage — page token lấy từ USER token đã gia hạn không hết hạn. Tài khoản quản lý
     nhiều fanpage thì Kengi hỏi chọn fanpage. USER token KHÔNG được lưu.
   - Kengi đọc hạn THẬT của token từ Facebook khi Facebook cho đọc; không đọc được thì tạm tính 55 ngày và nói rõ là tạm tính.
     Token chỉ còn vài giờ (chép thẳng, chưa gia hạn) thì báo ngay lúc dán. Token có hạn: Pilot nhắc trước 7 ngày, dán token mới là xong.
   - Bấm "Kiểm tra kết nối": gọi chỉ đọc từng quyền (đọc bài, đọc người bình luận, bài đã hẹn giờ, hạn token).

2. Bài đăng
   - Chỉ hàng hoá còn tồn (≥ mức tối thiểu trong chính sách), có giá bán, có ảnh JPG/PNG. Ảnh WebP / HEIC Facebook không nhận.
   - Bài gồm tên hàng, giá bán, mô tả trong kho (rút gọn), câu kêu gọi và hashtag (lấy từ chính sách, không có thì từ hồ sơ thương hiệu
     của Content AI). Pilot KHÔNG thêm lời hứa nào (giao toàn quốc, chính hãng, còn hàng…) — muốn có thì ghi vào mô tả hoặc câu kêu gọi.
   - Một mã không lên lại trong N ngày (chính sách). Từ cấm trong hồ sơ thương hiệu thì không lập kế hoạch.
   - Khung giờ: theo giờ đăng trong chính sách (trống thì giờ vàng của hồ sơ thương hiệu, không có nữa thì 9h, 12h, 20h), mỗi ngày tối đa
     N bài — đếm cả bài Kengi khác đã hẹn — và các bài cách nhau tối thiểu X phút.
   - Lúc thực thi máy chủ soát lại: hàng còn tồn, giá chưa đổi từ lúc lập kế hoạch, giờ hẹn còn cách ≥ 10 phút. Sai một điều là không đăng.
   - Bài HẸN GIỜ (giao cho Facebook trước tới 3 ngày) được soát lại lần nữa trong 1 tiếng trước giờ lên — máy chủ tự chạy mỗi phút,
     cả đêm, kể cả khi lịch tắt hay đã chuyển về Xem trước. Mã không còn / đã gộp, tồn dưới mức tối thiểu, hoặc giá bán đổi mà chữ bài
     còn ghi giá cũ ⇒ Pilot RÚT bài hẹn (xoá bài CHƯA lên trên Facebook), kế hoạch hiện "Đã rút bài hẹn" kèm lý do, chủ shop nhận
     thông báo. Bài không ghi giá thì giá đổi không rút. Chỉ đụng bài do Pilot đăng, chỉ xoá khi Facebook còn liệt kê bài trong danh
     sách hẹn giờ và giờ lên còn cách ≥ 3 phút — không bao giờ xoá bài đã công khai.
   - Không rút được (token hỏng, thiếu quyền, Facebook không trả lời rõ, còn dưới 3 phút, bài đã lên) ⇒ thông báo KHẨN "vào fanpage
     xoá / sửa tay", kế hoạch chuyển "Cần kiểm tra". Facebook giới hạn lượt gọi ⇒ giữ nguyên, phút sau thử lại.
   - Bài ĐÃ LÊN (trong 30 ngày) mà giá bán trong kho đổi ⇒ mỗi chu kỳ Pilot sửa dòng "Giá: …" nó viết trên bài sang giá mới (bật/tắt:
     "Sửa giá trên bài đã đăng" trong chính sách). Tự động: sửa luôn, tính vào trần ghi ngày (hết lượt ⇒ báo chủ shop, lượt sau sửa
     tiếp); Xem trước: chỉ lập nháp «Sửa giá bài đã đăng» để xem — chưa sửa gì trên Facebook. Pilot đọc chữ bài trên Facebook
     trước khi sửa và chỉ thay đúng dòng giá: bài người đã sửa tay sang giá mới ⇒ ghi nhận, không sửa; người viết lại giá cũ theo
     kiểu khác ⇒ báo sửa tay; bỏ hẳn giá ⇒ thôi theo dõi bài đó. Sửa hỏng 5 lần ⇒ máy thôi thử, báo sửa tay. Facebook chỉ cho sửa
     bài do chính app tạo — bài đăng tay không đụng tới.
   - Tồn kho ≤ 0 chưa chắc là hết hàng (phiếu nhập có thể chưa vào sổ) nên Pilot KHÔNG tự ghi "hết hàng" lên bài; kết quả chu kỳ chỉ
     nêu các bài đang mời mua mà tồn ≤ 0 để chủ shop tự sửa / ẩn nếu hết thật.

3. Bình luận
   - Tab Bình luận đọc bình luận mới trên 15 bài gần nhất — cả bình luận gốc lẫn câu trả lời trong luồng (khách hỏi giá bên dưới
     bình luận của người khác cũng thấy) — đánh dấu: hỏi giá / xin inbox, có số điện thoại, đã có người trả lời.
   - Trả lời một câu nằm trong luồng: Pilot gửi vào bình luận gốc của luồng đó (Facebook chỉ có hai tầng), sổ "mỗi bình luận một lần"
     vẫn ghi theo đúng câu được trả lời. Máy chỉ TỰ gửi khi luồng chưa có shop và chưa ai trả lời sau câu hỏi; khách hỏi tiếp trong
     luồng shop đã trả lời ⇒ lập nháp chờ người đọc cả luồng; fanpage đã trả lời tay rồi ⇒ không lập nháp.
   - Bài còn bình luận trong 3 ngày chưa đọc hết thì Pilot đọc thêm trang (tối đa 4 trang mỗi lượt). Chưa đọc hết, hoặc Facebook
     không cho đọc kiểu luồng (khi đó chỉ soát bình luận gốc), kết quả chu kỳ ghi rõ — không âm thầm soát thiếu.
   - Đang bật lịch + chế độ Tự động + (tự trả lời giá hoặc tự ẩn số điện thoại) và fanpage đã bật nhận sự kiện (webhook): có bình
     luận mới thì lượt chạy kế được kéo về sau vài phút thay vì chờ hết chu kỳ; hai lượt cách nhau ít nhất 10 phút. Chưa bật
     webhook thì vẫn theo chu kỳ như cũ.
   - Bài do Pilot đăng (hoặc bài có dòng đầu là tên hàng) được nối về mã hàng ⇒ gợi ý câu trả lời bằng GIÁ THẬT trong kho.
     Tồn dương mới nói "có hàng"; tồn ≤ 0 không nói "hết hàng", chỉ mời khách nhắn tin.
   - Mỗi bình luận chỉ được trả lời MỘT lần — dùng chung sổ với Quy tắc tự trả lời của Fanpage Manager.
   - Ẩn bình luận có số điện thoại: bảo vệ thông tin khách (người khác không đọc được số), khách vẫn thấy bình luận của mình.
   - Ẩn nhầm: bình luận đang ẩn có nút «Bỏ ẩn» ở tab Bình luận (lập kế hoạch rồi thực thi như mọi thao tác ghi). Bình luận đã có
     kế hoạch bỏ ẩn thì máy không tự ẩn lại.

4. Kế hoạch → thực thi
   - Mọi thao tác ghi tạo KẾ HOẠCH trước. Chế độ Xem trước: thực thi không gọi Facebook. Chế độ Tự động: thực thi đăng / trả lời thật.
   - Giới hạn: số thao tác ghi mỗi ngày, số câu trả lời mỗi chu kỳ.
   - Lỗi Facebook xét theo MÃ: chỉ #190 / #102 là token hỏng (fanpage chuyển "token hết hạn", dán token mới). Giới hạn lượt gọi
     (#4, #17, #32, #613) ⇒ giữ nháp, lượt sau thử lại, fanpage vẫn bình thường. Thiếu quyền (#10, #200–299) ⇒ báo tên quyền.
     #100 ⇒ hỏng riêng kế hoạch đó. Hết giờ / Facebook lỗi máy chủ khi đang ghi ⇒ "không rõ kết quả": mở fanpage kiểm, máy không tự làm lại.
   - Khối «Chờ duyệt» (tab Nhật ký) liệt kê MỌI nháp đang mở, không chỉ phần mới nhất: chọn nhiều cái rồi Duyệt / Huỷ một lần.
     Duyệt = bấm «Thực thi» từng cái, LẦN LƯỢT — mỗi kế hoạch vẫn soát lại như bấm tay (bài: tồn / giá / giờ hẹn; trả lời: giá) và
     tính vào trần ghi ngày. Lỗi chung đầu tiên (hết lượt ghi, token, Facebook giới hạn lượt gọi) ⇒ dừng, nháp còn lại giữ nguyên.
     Bài «đăng ngay» (không hẹn giờ) duyệt từng cái, khỏi dồn nhiều bài lên cùng lúc.
   - Kế hoạch «Cần kiểm tra» (không rõ Facebook đã nhận chưa): mở fanpage xem, rồi trong chi tiết kế hoạch bấm «Đã kiểm: CÓ trên
     Facebook» hoặc «Đã kiểm: KHÔNG có». KHÔNG có ⇒ mã được lên bài lại (bài hẹn của kế hoạch thôi tính khung giờ), câu trả lời được
     trả lời lại bằng tay; CÓ ⇒ coi như đã xong. Máy không bao giờ tự đoán thay, và không tính lần đánh dấu vào trần ghi.
   - Kế hoạch gần đây lọc được theo trạng thái / loại; bấm «Xem thêm» để xem kế hoạch cũ hơn.

5. Chu kỳ
   - Lập bài cho các khung giờ trống trong 3 ngày tới (tối đa 6 bài mỗi chu kỳ), soát bình luận 10 bài gần nhất (nếu bật).
   - Máy tự trả lời chỉ khi: biết chắc người viết là khách, bình luận chưa có ai trả lời, hàng tồn dương. Còn lại để nháp chờ người duyệt.
   - Chạy theo lịch: bật ở Sửa chính sách (mỗi 60–1440 phút), máy chủ tự chạy, không cần mở trang. Có việc cần người (nháp chờ
     duyệt, đăng hỏng, token fanpage sắp hết, bài hẹn giờ phải xử lý tay) ⇒ báo trên chuông web + app Android (nhóm «Pilot tự
     động», có tiếng từ app 1.0.47; bấm vào mở trang này trên trình duyệt).
   - Dọn kế hoạch mỗi chu kỳ: nháp MÁY lập quá giờ hẹn hoặc quá 3 ngày thì tự huỷ (nháp người lập giữ nguyên); thực thi kẹt quá 1 giờ
     ⇒ "không rõ kết quả" để người kiểm. Chuyển Xem trước → Tự động: nháp của lượt Xem trước bị huỷ, chu kỳ lập lại theo số hiện tại.
   - Người huỷ nháp máy đề xuất ⇒ máy không đề xuất lại mã / bình luận đó trong 14 ngày. Chỉ bài ĐÃ gửi Facebook mới tính vào
     "không lên lại trong N ngày"; nháp còn hạn chỉ giữ khung giờ của nó. Bài hẹn bị Pilot RÚT không tính, cũng không bị nhớ 14 ngày:
     mã đó được lập lại theo giá / tồn mới khi còn đủ điều kiện.

6. Chưa làm
   - Nhắn tin Messenger cho khách: cần app Facebook được duyệt quyền pages_messaging.
`
