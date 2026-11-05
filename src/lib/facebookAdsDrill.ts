/* ═══════════════════════════════════════════════════════════════════════════════
 *  PHÂN TÍCH SÂU QUẢNG CÁO — mục "Phân tích sâu" trong tab Quảng cáo của Facebook Pilot (05/11/2026)
 *
 *  Chủ shop: "Drilldown cực kỳ sâu của quảng cáo, sẽ chạy theo tỉnh hoặc chiến dịch gì đó".
 *  CHỈ ĐỌC (Insights / Marketing API) — không một lời gọi ghi nào. Bốn tầng: tài khoản → chiến dịch → nhóm quảng cáo →
 *  quảng cáo; tầng nào cũng chia được theo tỉnh/thành, tuổi, giới tính, tuổi × giới, nền tảng, vị trí, thiết bị, ngày,
 *  giờ; so với kỳ liền trước cùng số ngày; nhận xét tự động có NGƯỠNG MẪU (thà im còn hơn kết luận trên vài lượt).
 *  Đọc MỌI chiến dịch của tài khoản (không chỉ quảng cáo Pilot) — dòng do Pilot tạo được đánh dấu.
 *
 *  Rào:
 *    - Chỉ tài khoản quảng cáo của cửa hàng: tài khoản đang chọn ở Chính sách quảng cáo + tài khoản có quảng cáo Pilot.
 *      Chiến dịch / nhóm / quảng cáo phải mang account_id thuộc nhóm đó — token thấy tài khoản khác cũng không cho đọc.
 *    - "Kết quả" theo MỤC TIÊU: khách hỏi (bình luận + tin nhắn mới, như Ads Pilot), nhấp link, lượt mua, khách tiềm năng.
 *      Nhận xét "chi mà chưa có kết quả" chỉ áp lên dòng có mục tiêu khớp — chiến dịch lưu lượng không bị kêu "0 khách hỏi".
 *      Chia nhỏ ở tầng có nhiều mục tiêu lẫn nhau (≥ 15% tiền chi cho mục tiêu khác) ⇒ tắt nhận xét theo kết quả, nói rõ.
 *    - Facebook: theo giờ chỉ 13 tháng gần nhất và không có người tiếp cận; chia nhỏ quá 13 tháng không có người tiếp cận;
 *      tối đa 37 tháng (lỗi 3018); tỉnh = nơi người xem SỐNG (Facebook ước tính); thiết bị có thể rỗng với vài tài khoản
 *      (từ 06/08/2026); khi chia theo tỉnh / giờ chỉ có số đo trên Facebook (bình luận, tin nhắn vẫn có).
 *    - KHÔNG ghép doanh số theo tỉnh: sổ cửa hàng không có cột tỉnh (địa chỉ là chữ tự do) — đoán là báo sai.
 *  Đệm 5 phút trong bộ nhớ theo TỪNG lời gọi Graph (một bản máy — đủ cho đệm; đổi kiểu chia không gọi lại phần tổng);
 *  `fresh` bỏ đệm. Lời gọi Facebook chạy song song SAU khi đã đọc xong CSDL (pool Prisma cửa hàng 1 kết nối trên prod).
 * ═══════════════════════════════════════════════════════════════════════════════ */

import crypto from 'crypto'
import { ToolError } from './mcpTypes'
import { vnd } from './facebookPilot'
import {
    docCauHinhAds, canTokenAds, dichVuAds, chuanAct, moTaLoi, laLoiToken, laLoiQuyen, laKhongTonTai, luc, TRANG_THAI_TK,
    type NgCanhAds, type DichVuAds, type KeHoachAds, type CauHinhAds,
} from './facebookAdsPilot'

const NGAY = 86400_000
const tenGon = (s: any) => String(s ?? '').replace(/\s+/g, ' ').trim()
const so = (v: any): number => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const tron = (n: number | null, k = 2): number | null => (n === null || !Number.isFinite(n) ? null : Math.round(n * 10 ** k) / 10 ** k)
const laCo = (v: any) => v === true || v === 1 || v === '1' || v === 'true'
const pt = (x: number) => `${Math.round(x)}%`
const soVN = (x: number, le = 1) => x.toLocaleString('vi-VN', { maximumFractionDigits: le })

/** Tiền theo tiền tệ tài khoản (Insights trả spend bằng ĐƠN VỊ CHÍNH: đồng, đô…). */
export function tien(n: number, cur: string): string {
    return !cur || cur === 'VND' ? vnd(n) : `${(Math.round(n * 100) / 100).toLocaleString('vi-VN')} ${cur}`
}

/** Tiền tệ không phần lẻ trên Facebook: ngân sách ghi theo đơn vị chính. Còn lại ngân sách ghi theo 1/100 (cent). */
const TIEN_KHONG_LE = new Set(['VND', 'JPY', 'KRW', 'CLP', 'ISK', 'PYG', 'COP', 'CRC', 'HUF', 'IDR', 'TWD'])
const nganSach = (v: any, cur: string): number | null =>
    (v === undefined || v === null || v === '' || !(Number(v) > 0) ? null : Number(v) / (TIEN_KHONG_LE.has(cur) ? 1 : 100))

// ─── Ngày (chuỗi YYYY-MM-DD, tính theo UTC cho khỏi lệch múi giờ máy chủ) ──────────

function laNgay(s: any): s is string {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
    const t = Date.parse(`${s}T00:00:00Z`)
    return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s
}
export const congNgay = (s: string, n: number) => new Date(Date.parse(`${s}T00:00:00Z`) + n * NGAY).toISOString().slice(0, 10)
const demNgay = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / NGAY) + 1
export function congThang(s: string, n: number): string {
    const [y, m, d] = s.split('-').map(Number)
    const cuoi = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate()
    return new Date(Date.UTC(y, m - 1 + n, Math.min(d, cuoi))).toISOString().slice(0, 10)
}
/** "Hôm nay" theo múi giờ TÀI KHOẢN quảng cáo — Insights cắt ngày theo múi giờ tài khoản, không theo giờ VN. */
export const homNayTheoTk = (now: number, lechGio: number) => new Date(now + lechGio * 3600_000).toISOString().slice(0, 10)
/** Ngày cũ nhất Facebook còn giữ số liệu (37 tháng) / còn cho chia theo giờ + người tiếp cận khi chia nhỏ (13 tháng). */
export const moc37Thang = (homNay: string) => congNgay(congThang(homNay, -37), 1)
export const moc13Thang = (homNay: string) => congNgay(congThang(homNay, -13), 1)

export const MOC_NGAY: Record<string, string> = {
    today: 'Hôm nay', yesterday: 'Hôm qua', last_7d: '7 ngày qua', last_14d: '14 ngày qua', last_30d: '30 ngày qua',
    last_90d: '90 ngày qua', this_month: 'Tháng này', last_month: 'Tháng trước', maximum: 'Toàn bộ thời gian', custom: 'Tự chọn',
}
export interface KhoangDrill { preset: string; label: string; since: string | null; until: string | null; days: number | null }
export interface KyDrill { since: string; until: string }

/** Khoảng ngày theo mốc (như Trình quản lý quảng cáo: "N ngày qua" KHÔNG gồm hôm nay) hoặc tự chọn. */
export function giaiKhoang(q: { preset?: any; since?: any; until?: any }, homNay: string): KhoangDrill {
    const p = String(q.preset || '').trim() || (q.since || q.until ? 'custom' : 'last_7d')
    let since: string, until: string
    if (p === 'today') since = until = homNay
    else if (p === 'yesterday') since = until = congNgay(homNay, -1)
    else if (/^last_(7|14|30|90)d$/.test(p)) { const n = Number(p.slice(5, -1)); until = congNgay(homNay, -1); since = congNgay(homNay, -n) }
    else if (p === 'this_month') { since = `${homNay.slice(0, 8)}01`; until = homNay }
    else if (p === 'last_month') { until = congNgay(`${homNay.slice(0, 8)}01`, -1); since = `${until.slice(0, 8)}01` }
    else if (p === 'maximum') return { preset: p, label: MOC_NGAY[p], since: null, until: null, days: null }
    else if (p === 'custom') {
        if (!laNgay(q.since) || !laNgay(q.until)) throw new ToolError('Ngày bắt đầu / kết thúc phải có dạng YYYY-MM-DD.')
        since = q.since; until = q.until
        if (since > until) throw new ToolError('Ngày bắt đầu sau ngày kết thúc.')
        if (until > homNay) throw new ToolError(`Ngày kết thúc ${until} sau hôm nay (${homNay}, theo múi giờ tài khoản quảng cáo).`)
        if (since < moc37Thang(homNay)) throw new ToolError(`Facebook chỉ giữ số liệu quảng cáo 37 tháng — chọn từ ${moc37Thang(homNay)} trở về sau.`)
    } else throw new ToolError(`Khoảng ngày không hỗ trợ: ${p.slice(0, 40)}`)
    return { preset: p, label: MOC_NGAY[p], since, until, days: demNgay(since, until) }
}

/** Kỳ liền trước CÙNG số ngày. Toàn bộ thời gian / vượt mốc 37 tháng ⇒ null (Facebook báo lỗi 3018). */
export function kyTruoc(k: KhoangDrill, homNay: string): KyDrill | null {
    if (!k.since || !k.until || !k.days) return null
    const until = congNgay(k.since, -1), since = congNgay(k.since, -k.days)
    return since < moc37Thang(homNay) ? null : { since, until }
}

// ─── Gọi Graph: đệm 5 phút + hẹn giờ + lật trang ───────────────────────────────

export type DocGraph = (path: string, params: Record<string, any>) => Promise<any>

const DEM_TTL = 5 * 60_000
const DEM_MAX_MUC = 500
const DEM_MAX_CO = 20_000_000
const dem = new Map<string, { at: number; v: any; co: number }>()
let demCo = 0
/** Bộ kiểm dọn đệm giữa các ca. */
export function xoaDemDrill() { dem.clear(); demCo = 0 }

function datDem(khoa: string, v: any, at: number) {
    const co = (JSON.stringify(v) || '').length
    if (co > 2_000_000) return
    const cu = dem.get(khoa)
    if (cu) { demCo -= cu.co; dem.delete(khoa) }
    dem.set(khoa, { at, v, co })
    demCo += co
    // Map giữ thứ tự chèn ⇒ đầu Map là mục cũ nhất
    for (const [k, e] of dem) {
        if (demCo <= DEM_MAX_CO && dem.size <= DEM_MAX_MUC) break
        dem.delete(k); demCo -= e.co
    }
}

function henGio<T>(p: Promise<T>, ms: number): Promise<T> {
    let t: ReturnType<typeof setTimeout> | undefined
    const het = new Promise<T>((_, rej) => {
        t = setTimeout(() => rej(Object.assign(new Error(`Facebook không trả lời sau ${ms / 1000} giây`), { hetGio: true })), ms)
    })
    return Promise.race([p, het]).finally(() => { if (t) clearTimeout(t) })
}

/** Lời gọi ĐỌC có đệm. Khoá đệm = dấu vân tay token (không lưu token) + đường + tham số. */
function docCoDem(svc: DichVuAds, token: string, o: { fresh: boolean; bayGio: () => number; thongKe: { goi: number; dem: number } }): DocGraph {
    const vanTay = crypto.createHash('sha256').update(token).digest('hex').slice(0, 16)
    return async (path, params) => {
        const khoa = `${vanTay}|${path}|${JSON.stringify(params)}`
        const t = o.bayGio()
        const c = dem.get(khoa)
        if (!o.fresh && c && t - c.at < DEM_TTL) { o.thongKe.dem++; return c.v }
        o.thongKe.goi++
        const v = await henGio(svc.get(path, params), 30_000)
        datDem(khoa, v, t)
        return v
    }
}

/** Lật trang theo cursors.after (KHÔNG theo paging.next — URL đó mang access_token). */
async function docHet(doc: DocGraph, path: string, params: Record<string, any>, toiDa: number): Promise<{ rows: any[]; conTiep: boolean }> {
    const rows: any[] = []
    let after: string | undefined
    for (let i = 0; i < toiDa; i++) {
        const r = await doc(path, after ? { ...params, after } : params)
        if (Array.isArray(r?.data)) rows.push(...r.data)
        after = r?.paging?.cursors?.after
        if (!after || !r?.paging?.next) return { rows, conTiep: false }
    }
    return { rows, conTiep: true }
}

/** Giới hạn lượt gọi của Marketing API: 4 / 17 / 32 / 613 và nhóm 80000–80014 (theo tài khoản quảng cáo). */
export const laGioiHan = (e: any) => { const c = Number(e?.code); return c === 4 || c === 17 || c === 32 || c === 613 || (c >= 80000 && c <= 80014) }
export const GIOI_HAN = 'Facebook đang giới hạn lượt đọc số liệu của tài khoản quảng cáo này — đợi vài phút rồi bấm Làm mới.'

export function moTaLoiDrill(e: any): string {
    if (laGioiHan(e)) return GIOI_HAN
    if (e?.hetGio) return 'Facebook trả lời quá chậm — bấm Làm mới hoặc chọn khoảng ngày ngắn hơn.'
    if (Number(e?.code) === 3018) return 'Khoảng ngày vượt quá 37 tháng Facebook giữ số liệu.'
    if (Number(e?.code) === 1 && /reduce the amount of data/i.test(String(e?.message || ''))) return 'Facebook báo số liệu quá lớn — chọn khoảng ngày ngắn hơn.'
    return moTaLoi(e)
}

// ─── Số liệu ───────────────────────────────────────────────────────────────────

export interface SoDrill {
    spend: number; impressions: number
    /** null = Facebook không trả (theo giờ, chia nhỏ quá 13 tháng) hoặc không cộng được giữa các dòng */
    reach: number | null; frequency: number | null
    clicks: number; linkClicks: number
    /** % */
    ctr: number | null; linkCtr: number | null
    cpc: number | null; cpm: number | null
    comments: number; messages: number; reactions: number; shares: number; saves: number; videoViews: number; engagement: number
    purchases: number; leads: number
    results: number; costPerResult: number | null
}

export const soRong = (): SoDrill => ({
    spend: 0, impressions: 0, reach: null, frequency: null, clicks: 0, linkClicks: 0, ctr: null, linkCtr: null, cpc: null, cpm: null,
    comments: 0, messages: 0, reactions: 0, shares: 0, saves: 0, videoViews: 0, engagement: 0, purchases: 0, leads: 0, results: 0, costPerResult: null,
})

const HANH_DONG: Record<string, string[]> = {
    comments: ['comment'],
    messages: ['onsite_conversion.messaging_conversation_started_7d'],
    reactions: ['post_reaction'],
    shares: ['post'],
    saves: ['onsite_conversion.post_save'],
    videoViews: ['video_view'],
    engagement: ['post_engagement'],
    // loại GỘP đứng trước và chỉ lấy MỘT loại — cộng cả loại gộp lẫn loại con là đếm hai lần
    purchases: ['omni_purchase', 'purchase', 'offsite_conversion.fb_pixel_purchase', 'onsite_web_purchase', 'onsite_conversion.purchase'],
    leads: ['lead', 'onsite_conversion.lead_grouped', 'leadgen_grouped', 'offsite_conversion.fb_pixel_lead'],
}

function hanhDong(r: any, loai: string[]): number {
    const ds = Array.isArray(r?.actions) ? r.actions : []
    for (const t of loai) {
        const a = ds.find((x: any) => x?.action_type === t)
        if (a) return so(a.value)
    }
    return 0
}

/** Một dòng Insights → số thô (chưa tính tỷ lệ — gọi hoanTat). `coReach` false ⇒ không có người tiếp cận. */
export function docSoDrill(r: any, coReach = true): SoDrill {
    const s = soRong()
    s.spend = so(r?.spend)
    s.impressions = so(r?.impressions)
    s.reach = coReach && r?.reach !== undefined && r?.reach !== null && r?.reach !== '' ? so(r.reach) : null
    s.clicks = so(r?.clicks)
    s.linkClicks = r?.inline_link_clicks !== undefined && r?.inline_link_clicks !== null ? so(r.inline_link_clicks) : hanhDong(r, ['link_click'])
    for (const k of Object.keys(HANH_DONG)) (s as any)[k] = hanhDong(r, HANH_DONG[k])
    return s
}

/** Cộng hai dòng (gộp tỉnh, cộng tổng). Người tiếp cận chỉ cộng khi cả hai có. */
export function congSo(a: SoDrill, b: SoDrill): SoDrill {
    const r = soRong()
    for (const k of ['spend', 'impressions', 'clicks', 'linkClicks', 'comments', 'messages', 'reactions', 'shares', 'saves', 'videoViews', 'engagement', 'purchases', 'leads'] as const) r[k] = a[k] + b[k]
    r.reach = a.reach === null || b.reach === null ? null : a.reach + b.reach
    return r
}

/** Tỷ lệ + kết quả theo cách tính đang chọn. */
export function hoanTat(s: SoDrill, kq: KetQua): SoDrill {
    const r: SoDrill = { ...s }
    r.frequency = r.reach && r.reach > 0 ? tron(r.impressions / r.reach) : null
    r.ctr = r.impressions > 0 ? tron((r.clicks / r.impressions) * 100) : null
    r.linkCtr = r.impressions > 0 ? tron((r.linkClicks / r.impressions) * 100) : null
    r.cpc = r.clicks > 0 ? tron(r.spend / r.clicks) : null
    r.cpm = r.impressions > 0 ? tron((r.spend / r.impressions) * 1000) : null
    r.results = KET_QUA[kq].tinh(r)
    r.costPerResult = r.results > 0 ? tron(r.spend / r.results) : null
    return r
}

// ─── Mục tiêu & "kết quả" ───────────────────────────────────────────────────────

export type HoMucTieu = 'tuong_tac' | 'luu_luong' | 'doanh_so' | 'tiem_nang' | 'nhan_dien' | 'ung_dung'
export type KetQua = 'khach_hoi' | 'tin_nhan' | 'binh_luan' | 'tuong_tac' | 'link' | 'mua' | 'tiem_nang'

export const KET_QUA: Record<KetQua, { label: string; ngan: string; ho: HoMucTieu; tinh: (s: SoDrill) => number }> = {
    khach_hoi: { label: 'Khách hỏi (bình luận + tin nhắn mới)', ngan: 'khách hỏi', ho: 'tuong_tac', tinh: s => s.comments + s.messages },
    tin_nhan: { label: 'Tin nhắn mới', ngan: 'tin nhắn mới', ho: 'tuong_tac', tinh: s => s.messages },
    binh_luan: { label: 'Bình luận', ngan: 'bình luận', ho: 'tuong_tac', tinh: s => s.comments },
    tuong_tac: { label: 'Tương tác với bài', ngan: 'tương tác', ho: 'tuong_tac', tinh: s => s.engagement },
    link: { label: 'Nhấp vào liên kết', ngan: 'lượt nhấp link', ho: 'luu_luong', tinh: s => s.linkClicks },
    mua: { label: 'Lượt mua (pixel / cửa hàng Facebook)', ngan: 'lượt mua', ho: 'doanh_so', tinh: s => s.purchases },
    tiem_nang: { label: 'Khách tiềm năng (biểu mẫu)', ngan: 'khách tiềm năng', ho: 'tiem_nang', tinh: s => s.leads },
}
const KQ_MAC_DINH: Record<HoMucTieu, KetQua> = { tuong_tac: 'khach_hoi', luu_luong: 'link', doanh_so: 'mua', tiem_nang: 'tiem_nang', nhan_dien: 'khach_hoi', ung_dung: 'khach_hoi' }
export const TEN_HO: Record<HoMucTieu, string> = {
    tuong_tac: 'Tương tác / tin nhắn', luu_luong: 'Lưu lượng', doanh_so: 'Doanh số', tiem_nang: 'Khách tiềm năng', nhan_dien: 'Nhận diện', ung_dung: 'Ứng dụng',
}

/** Mục tiêu TỐI ƯU của nhóm quảng cáo — chắc hơn mục tiêu chiến dịch (Doanh số có thể đo bằng tin nhắn). */
const HO_THEO_DICH: Record<string, HoMucTieu> = {
    CONVERSATIONS: 'tuong_tac', REPLIES: 'tuong_tac', MESSAGING_PURCHASE_CONVERSION: 'tuong_tac', MESSAGING_APPOINTMENT_CONVERSION: 'tuong_tac',
    POST_ENGAGEMENT: 'tuong_tac', ENGAGED_USERS: 'tuong_tac', PAGE_LIKES: 'tuong_tac', EVENT_RESPONSES: 'tuong_tac',
    LINK_CLICKS: 'luu_luong', LANDING_PAGE_VIEWS: 'luu_luong',
    OFFSITE_CONVERSIONS: 'doanh_so', ONSITE_CONVERSIONS: 'doanh_so', VALUE: 'doanh_so',
    LEAD_GENERATION: 'tiem_nang', QUALITY_LEAD: 'tiem_nang', QUALITY_CALL: 'tiem_nang',
    REACH: 'nhan_dien', IMPRESSIONS: 'nhan_dien', AD_RECALL_LIFT: 'nhan_dien', THRUPLAY: 'nhan_dien', TWO_SECOND_CONTINUOUS_VIDEO_VIEWS: 'nhan_dien',
    APP_INSTALLS: 'ung_dung', APP_INSTALLS_AND_OFFSITE_CONVERSIONS: 'ung_dung',
}
/** Mục tiêu chiến dịch. Doanh số / Khách tiềm năng có thể đo bằng TIN NHẮN (vị trí chuyển đổi Messenger) ⇒ null = chưa chắc. */
const HO_THEO_MUC_TIEU: Record<string, HoMucTieu | null> = {
    OUTCOME_ENGAGEMENT: 'tuong_tac', POST_ENGAGEMENT: 'tuong_tac', MESSAGES: 'tuong_tac', PAGE_LIKES: 'tuong_tac', EVENT_RESPONSES: 'tuong_tac',
    OUTCOME_TRAFFIC: 'luu_luong', LINK_CLICKS: 'luu_luong',
    OUTCOME_SALES: null, CONVERSIONS: null, PRODUCT_CATALOG_SALES: 'doanh_so', OUTCOME_LEADS: null, LEAD_GENERATION: 'tiem_nang',
    OUTCOME_AWARENESS: 'nhan_dien', REACH: 'nhan_dien', BRAND_AWARENESS: 'nhan_dien', VIDEO_VIEWS: 'nhan_dien',
    OUTCOME_APP_PROMOTION: 'ung_dung', APP_INSTALLS: 'ung_dung', MOBILE_APP_INSTALLS: 'ung_dung',
}
export function hoMucTieu(objective?: any, goal?: any): HoMucTieu | null {
    const g = String(goal || '').toUpperCase()
    if (HO_THEO_DICH[g]) return HO_THEO_DICH[g]
    return HO_THEO_MUC_TIEU[String(objective || '').toUpperCase()] ?? null
}
/** Cùng MỘT họ ⇒ họ đó; lẫn / có dòng không rõ / rỗng ⇒ null. */
export function hoChung(ds: (HoMucTieu | null)[]): HoMucTieu | null {
    const s = new Set(ds)
    return s.size === 1 ? [...s][0] : null
}
/** Họ chiếm ≥ 80% tiền chi ⇒ họ đó; không thì null (nhiều mục tiêu lẫn nhau). */
export function hoTheoChi(ds: { ho: HoMucTieu | null; spend: number }[]): HoMucTieu | null {
    const theoHo = new Map<HoMucTieu | null, number>()
    let tong = 0
    for (const d of ds) { if (!(d.spend > 0)) continue; theoHo.set(d.ho, (theoHo.get(d.ho) || 0) + d.spend); tong += d.spend }
    if (!(tong > 0)) return null
    const [ho, chi] = [...theoHo].sort((a, b) => b[1] - a[1])[0]
    return ho && chi / tong >= 0.8 ? ho : null
}

export const TEN_MUC_TIEU: Record<string, string> = {
    OUTCOME_ENGAGEMENT: 'Tương tác', OUTCOME_TRAFFIC: 'Lưu lượng truy cập', OUTCOME_SALES: 'Doanh số', OUTCOME_LEADS: 'Khách hàng tiềm năng',
    OUTCOME_AWARENESS: 'Mức độ nhận biết', OUTCOME_APP_PROMOTION: 'Quảng bá ứng dụng', MESSAGES: 'Tin nhắn', POST_ENGAGEMENT: 'Tương tác với bài viết',
    LINK_CLICKS: 'Lượt nhấp vào liên kết', CONVERSIONS: 'Chuyển đổi', REACH: 'Phạm vi tiếp cận', BRAND_AWARENESS: 'Nhận biết thương hiệu',
    VIDEO_VIEWS: 'Lượt xem video', PAGE_LIKES: 'Lượt thích trang', LEAD_GENERATION: 'Tìm khách hàng tiềm năng', APP_INSTALLS: 'Lượt cài ứng dụng',
    PRODUCT_CATALOG_SALES: 'Bán hàng theo danh mục', EVENT_RESPONSES: 'Phản hồi sự kiện',
}
export const TEN_DICH: Record<string, string> = {
    CONVERSATIONS: 'Cuộc trò chuyện', REPLIES: 'Lượt trả lời', POST_ENGAGEMENT: 'Tương tác với bài viết', ENGAGED_USERS: 'Người tương tác',
    PAGE_LIKES: 'Lượt thích trang', LINK_CLICKS: 'Lượt nhấp vào liên kết', LANDING_PAGE_VIEWS: 'Lượt xem trang đích',
    OFFSITE_CONVERSIONS: 'Chuyển đổi trên web', ONSITE_CONVERSIONS: 'Chuyển đổi trên Facebook', VALUE: 'Giá trị chuyển đổi',
    LEAD_GENERATION: 'Khách hàng tiềm năng', QUALITY_LEAD: 'Khách tiềm năng chất lượng', QUALITY_CALL: 'Cuộc gọi chất lượng',
    REACH: 'Phạm vi tiếp cận', IMPRESSIONS: 'Lượt hiển thị', AD_RECALL_LIFT: 'Mức độ ghi nhớ quảng cáo', THRUPLAY: 'ThruPlay',
    TWO_SECOND_CONTINUOUS_VIDEO_VIEWS: 'Lượt xem video 2 giây', APP_INSTALLS: 'Lượt cài ứng dụng', EVENT_RESPONSES: 'Phản hồi sự kiện',
    MESSAGING_PURCHASE_CONVERSION: 'Mua qua tin nhắn', MESSAGING_APPOINTMENT_CONVERSION: 'Đặt hẹn qua tin nhắn',
}

// ─── Tỉnh / thành ───────────────────────────────────────────────────────────────

/**
 * 63 tỉnh/thành cũ → tên tiếng Việt + đơn vị cấp tỉnh MỚI (34 đơn vị — Nghị quyết 202/2025/QH15 của Quốc hội, đối chiếu
 * báo Nhân Dân 12/06/2025). Facebook trả tên tiếng Anh không dấu ("Ho Chi Minh City", "Thua Thien-Hue Province"…) và có thể
 * đổi sang tên mới bất cứ lúc nào ⇒ so khớp KHÔNG DẤU, bỏ "tỉnh / thành phố / province / city"; tên lạ để nguyên, không đoán.
 * [tên, tên mới, ...bí danh không dấu]
 */
const TINH: [string, string, ...string[]][] = [
    ['Hà Nội', 'Hà Nội'], ['Hà Giang', 'Tuyên Quang'], ['Cao Bằng', 'Cao Bằng'], ['Bắc Kạn', 'Thái Nguyên', 'baccan'],
    ['Tuyên Quang', 'Tuyên Quang'], ['Lào Cai', 'Lào Cai'], ['Điện Biên', 'Điện Biên'], ['Lai Châu', 'Lai Châu'], ['Sơn La', 'Sơn La'],
    ['Yên Bái', 'Lào Cai'], ['Hòa Bình', 'Phú Thọ'], ['Thái Nguyên', 'Thái Nguyên'], ['Lạng Sơn', 'Lạng Sơn'], ['Quảng Ninh', 'Quảng Ninh'],
    ['Bắc Giang', 'Bắc Ninh'], ['Phú Thọ', 'Phú Thọ'], ['Vĩnh Phúc', 'Phú Thọ'], ['Bắc Ninh', 'Bắc Ninh'], ['Hải Dương', 'Hải Phòng'],
    ['Hải Phòng', 'Hải Phòng'], ['Hưng Yên', 'Hưng Yên'], ['Thái Bình', 'Hưng Yên'], ['Hà Nam', 'Ninh Bình'], ['Nam Định', 'Ninh Bình'],
    ['Ninh Bình', 'Ninh Bình'], ['Thanh Hóa', 'Thanh Hóa'], ['Nghệ An', 'Nghệ An'], ['Hà Tĩnh', 'Hà Tĩnh'], ['Quảng Bình', 'Quảng Trị'],
    ['Quảng Trị', 'Quảng Trị'], ['Thừa Thiên Huế', 'Huế'], ['Huế', 'Huế'], ['Đà Nẵng', 'Đà Nẵng'], ['Quảng Nam', 'Đà Nẵng'],
    ['Quảng Ngãi', 'Quảng Ngãi'], ['Bình Định', 'Gia Lai'], ['Phú Yên', 'Đắk Lắk'], ['Khánh Hòa', 'Khánh Hòa'], ['Ninh Thuận', 'Khánh Hòa'],
    ['Bình Thuận', 'Lâm Đồng'], ['Kon Tum', 'Quảng Ngãi'], ['Gia Lai', 'Gia Lai'], ['Đắk Lắk', 'Đắk Lắk', 'daclac', 'daclak', 'daklac'],
    ['Đắk Nông', 'Lâm Đồng', 'dacnong'], ['Lâm Đồng', 'Lâm Đồng'], ['Bình Phước', 'Đồng Nai'], ['Tây Ninh', 'Tây Ninh'],
    ['Bình Dương', 'TP. Hồ Chí Minh'], ['Đồng Nai', 'Đồng Nai'], ['Bà Rịa – Vũng Tàu', 'TP. Hồ Chí Minh', 'vungtau', 'bariavt'],
    ['TP. Hồ Chí Minh', 'TP. Hồ Chí Minh', 'hcm', 'saigon'], ['Long An', 'Tây Ninh'], ['Tiền Giang', 'Đồng Tháp'],
    ['Bến Tre', 'Vĩnh Long'], ['Trà Vinh', 'Vĩnh Long'], ['Vĩnh Long', 'Vĩnh Long'], ['Đồng Tháp', 'Đồng Tháp'], ['An Giang', 'An Giang'],
    ['Kiên Giang', 'An Giang'], ['Cần Thơ', 'Cần Thơ'], ['Hậu Giang', 'Cần Thơ'], ['Sóc Trăng', 'Cần Thơ'], ['Bạc Liêu', 'Cà Mau'], ['Cà Mau', 'Cà Mau'],
]

/** Khoá so khớp tên tỉnh: không dấu, chữ thường, bỏ tiền tố "tỉnh / thành phố / TP" và hậu tố "province / city", chỉ giữ chữ cái. */
export function khoaTinh(s: any): string {
    let t = String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').trim()
    t = t.replace(/^(tinh|thanh pho)\s+/, '').replace(/^tp\.?\s*/, '').replace(/\s+(province|city|municipality)$/, '')
    return t.replace(/[^a-z]/g, '')
}

const TINH_THEO_KHOA = new Map<string, { ten: string; moi: string }>()
for (const [ten, moi, ...biDanh] of TINH) for (const k of [khoaTinh(ten), ...biDanh]) TINH_THEO_KHOA.set(k, { ten, moi })
/** Số khoá — bộ kiểm soát không có hai tỉnh trùng khoá. */
export const SO_TINH = { cu: TINH.filter(([t]) => t !== 'Huế').length, moi: new Set(TINH.map(t => t[1])).size, khoa: TINH_THEO_KHOA.size, dong: TINH.reduce((s, [, , ...b]) => s + 1 + b.length, 0) }

export function tinhVN(ten: any): { ten: string; moi: string } | null {
    return TINH_THEO_KHOA.get(khoaTinh(ten)) || null
}

// ─── Nhãn chia nhỏ ──────────────────────────────────────────────────────────────

export type ChiaDrill = 'region' | 'age' | 'gender' | 'age_gender' | 'platform' | 'position' | 'device' | 'day' | 'hour'
export const CHIA: Record<ChiaDrill, { label: string; ten: string; breakdowns: string | null; congReach: boolean }> = {
    region: { label: 'Tỉnh / thành', ten: 'tỉnh/thành', breakdowns: 'region', congReach: true },
    age: { label: 'Tuổi', ten: 'nhóm tuổi', breakdowns: 'age', congReach: true },
    gender: { label: 'Giới tính', ten: 'giới', breakdowns: 'gender', congReach: true },
    age_gender: { label: 'Tuổi × giới', ten: 'nhóm tuổi × giới', breakdowns: 'age,gender', congReach: true },
    platform: { label: 'Nền tảng', ten: 'nền tảng', breakdowns: 'publisher_platform', congReach: false },
    position: { label: 'Vị trí hiển thị', ten: 'vị trí', breakdowns: 'publisher_platform,platform_position', congReach: false },
    device: { label: 'Thiết bị', ten: 'thiết bị', breakdowns: 'impression_device', congReach: false },
    day: { label: 'Theo ngày', ten: 'ngày', breakdowns: null, congReach: false },
    hour: { label: 'Theo giờ', ten: 'khung giờ', breakdowns: 'hourly_stats_aggregated_by_advertiser_time_zone', congReach: false },
}

const THU_TU_TUOI = ['13-17', '18-24', '25-34', '35-44', '45-54', '55-64', '65+', 'Unknown']
const THU_TU_GIOI = ['female', 'male', 'unknown']
const tenTuoi = (v: string) => (/^unknown$/i.test(v) ? 'Không rõ' : v.replace('-', '–'))
const TEN_GIOI: Record<string, string> = { male: 'Nam', female: 'Nữ', unknown: 'Không rõ' }
export const TEN_NEN_TANG: Record<string, string> = {
    facebook: 'Facebook', instagram: 'Instagram', messenger: 'Messenger', audience_network: 'Audience Network', threads: 'Threads',
    whatsapp: 'WhatsApp', oculus: 'Meta Quest', unknown: 'Không rõ',
}
const TEN_VI_TRI: Record<string, string> = {
    feed: 'Bảng feed', right_hand_column: 'Cột bên phải', marketplace: 'Marketplace', video_feeds: 'Bảng feed video',
    facebook_stories: 'Tin', instagram_stories: 'Tin', messenger_stories: 'Tin', story: 'Tin', search: 'Kết quả tìm kiếm',
    instagram_search: 'Kết quả tìm kiếm', instream_video: 'Video trong luồng', facebook_reels: 'Reels', instagram_reels: 'Reels',
    facebook_reels_overlay: 'Lớp phủ trên Reels', profile_feed: 'Feed trang cá nhân', facebook_profile_feed: 'Feed trang cá nhân',
    instagram_profile_feed: 'Feed trang cá nhân', instagram_explore: 'Khám phá', instagram_explore_grid_home: 'Lưới Khám phá',
    messenger_inbox: 'Hộp thư', an_classic: 'Ứng dụng / web đối tác', rewarded_video: 'Video có thưởng', threads_feed: 'Bảng feed',
    notification: 'Thông báo', biz_disco_feed: 'Gợi ý doanh nghiệp', unknown: 'Không rõ',
}
const TEN_THIET_BI: Record<string, string> = {
    desktop: 'Máy tính', iphone: 'iPhone', ipad: 'iPad', ipod: 'iPod', android_smartphone: 'Điện thoại Android',
    android_tablet: 'Máy tính bảng Android', mobile_web: 'Trình duyệt di động', other: 'Khác', unknown: 'Không rõ',
}

export interface DongChia {
    key: string; label: string
    /** chia theo tỉnh: đơn vị cấp tỉnh MỚI (null = tên lạ, không thuộc bảng Việt Nam) */
    group?: string | null
    /** chia theo tỉnh, đang gộp: các tỉnh cũ trong dòng */
    parts?: string[]
    age?: string; gender?: string; platform?: string; position?: string; hour?: number; date?: string
    m: SoDrill
    prev: SoDrill | null
}

function nhanChia(chia: ChiaDrill, r: any, buoc: 1 | 'monthly'): Omit<DongChia, 'm' | 'prev'> {
    switch (chia) {
        case 'region': {
            const raw = tenGon(r?.region) || 'Unknown'
            if (/^unknown$/i.test(raw)) return { key: raw, label: 'Không rõ', group: 'Không rõ' }
            const t = tinhVN(raw)
            return { key: raw, label: t ? t.ten : raw, group: t ? t.moi : null }
        }
        case 'age': { const v = String(r?.age || 'Unknown'); return { key: v, label: tenTuoi(v), age: v } }
        case 'gender': { const v = String(r?.gender || 'unknown'); return { key: v, label: TEN_GIOI[v] || v, gender: v } }
        case 'age_gender': {
            const a = String(r?.age || 'Unknown'), g = String(r?.gender || 'unknown')
            return { key: `${a}|${g}`, label: `${tenTuoi(a)} · ${TEN_GIOI[g] || g}`, age: a, gender: g }
        }
        case 'platform': { const v = String(r?.publisher_platform || 'unknown'); return { key: v, label: TEN_NEN_TANG[v] || v, platform: v } }
        case 'position': {
            const p = String(r?.publisher_platform || 'unknown'), v = String(r?.platform_position || 'unknown')
            return { key: `${p}|${v}`, label: `${TEN_NEN_TANG[p] || p} · ${TEN_VI_TRI[v] || v.replace(/_/g, ' ')}`, platform: p, position: v }
        }
        case 'device': { const v = String(r?.impression_device || 'unknown'); return { key: v, label: TEN_THIET_BI[v] || v.replace(/_/g, ' ') } }
        case 'hour': {
            const h = Number(String(r?.hourly_stats_aggregated_by_advertiser_time_zone || '').slice(0, 2))
            const gio = Number.isInteger(h) && h >= 0 && h <= 23 ? h : -1
            return gio < 0 ? { key: 'x', label: 'Không rõ' } : { key: String(gio).padStart(2, '0'), label: `${gio}:00–${gio}:59`, hour: gio }
        }
        case 'day': {
            const d = String(r?.date_start || '')
            return { key: d, label: nhanNgay(d, buoc), date: d }
        }
    }
}
const nhanNgay = (d: string, buoc: 1 | 'monthly') => (laNgay(d) ? (buoc === 1 ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : `T${Number(d.slice(5, 7))}/${d.slice(0, 4)}`) : d)

function xepChia(chia: ChiaDrill, rows: DongChia[]): DongChia[] {
    const vi = (ds: string[], v?: string) => { const i = ds.indexOf(String(v)); return i < 0 ? 99 : i }
    if (chia === 'age') return rows.sort((a, b) => vi(THU_TU_TUOI, a.age) - vi(THU_TU_TUOI, b.age))
    if (chia === 'gender') return rows.sort((a, b) => vi(THU_TU_GIOI, a.gender) - vi(THU_TU_GIOI, b.gender))
    if (chia === 'age_gender') return rows.sort((a, b) => vi(THU_TU_TUOI, a.age) - vi(THU_TU_TUOI, b.age) || vi(THU_TU_GIOI, a.gender) - vi(THU_TU_GIOI, b.gender))
    if (chia === 'hour' || chia === 'day') return rows.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    return rows.sort((a, b) => b.m.spend - a.m.spend || b.m.impressions - a.m.impressions)
}

// ─── Đối tượng nhắm ─────────────────────────────────────────────────────────────

/** Tóm tắt targeting của nhóm quảng cáo — đang nhắm tỉnh nào, tuổi, giới, sở thích (đặt cạnh bảng theo tỉnh). */
export function tomTatDoiTuong(t: any): any {
    if (!t || typeof t !== 'object') return null
    const km = (u: any) => (u === 'mile' ? 'dặm' : 'km')
    const noi = (geo: any): string[] => {
        const ra: string[] = []
        for (const c of geo?.countries || []) ra.push(c === 'VN' ? 'Việt Nam' : String(c))
        for (const r of geo?.regions || []) { const v = tinhVN(r?.name); ra.push(v ? v.ten : tenGon(r?.name)) }
        for (const c of geo?.cities || []) ra.push(`${tenGon(c?.name)}${c?.radius ? ` (+${c.radius} ${km(c.distance_unit)})` : ''}`)
        for (const z of geo?.zips || []) ra.push(tenGon(z?.name || z?.key))
        for (const l of geo?.custom_locations || []) ra.push(`Bán kính ${l?.radius ?? '?'} ${km(l?.distance_unit)} quanh ${tenGon(l?.address_string) || `${l?.latitude},${l?.longitude}`}`)
        return ra.filter(Boolean)
    }
    const soThich: string[] = []
    for (const f of t.flexible_spec || []) for (const k of ['interests', 'behaviors', 'life_events', 'work_positions', 'industries', 'family_statuses', 'income']) for (const x of f?.[k] || []) if (x?.name) soThich.push(tenGon(x.name))
    for (const x of t.interests || []) if (x?.name) soThich.push(tenGon(x.name))
    const gioi = Array.isArray(t.genders) && t.genders.length === 1 ? (t.genders[0] === 1 ? 'Nam' : t.genders[0] === 2 ? 'Nữ' : 'Tất cả') : 'Tất cả'
    return {
        places: noi(t.geo_locations).slice(0, 40), excluded: noi(t.excluded_geo_locations).slice(0, 20),
        ageMin: t.age_min ?? null, ageMax: t.age_max ?? null, gender: gioi,
        interests: [...new Set(soThich)].slice(0, 30),
        customAudiences: Array.isArray(t.custom_audiences) ? t.custom_audiences.length : 0,
        excludedAudiences: Array.isArray(t.excluded_custom_audiences) ? t.excluded_custom_audiences.length : 0,
        platforms: (Array.isArray(t.publisher_platforms) ? t.publisher_platforms : []).map((p: string) => TEN_NEN_TANG[p] || p),
        advantageAudience: t.targeting_automation?.advantage_audience === 1,
    }
}

// ─── Nhận xét ───────────────────────────────────────────────────────────────────

export interface NhanXet { tone: 'bad' | 'good' | 'warn' | 'info'; text: string; keys?: string[] }
interface DongXet { key: string; label: string; m: SoDrill; prev?: SoDrill | null; hopLe: boolean }

const doiPt = (a: number, b: number) => (b > 0 ? ((a - b) / b) * 100 : null)

/** P(X ≤ k) với X ~ Nhị thức(N, p) — cộng trong miền log (N cả chục nghìn cũng không tràn số). */
function duoiNhiThuc(k: number, N: number, p: number): number {
    if (k < 0) return 0
    if (k >= N || p <= 0) return 1
    if (p >= 1) return 0
    const buoc = Math.log(p) - Math.log1p(-p)
    let lp = N * Math.log1p(-p), max = lp
    const ds = [lp]
    for (let i = 1; i <= k; i++) { lp += Math.log((N - i + 1) / i) + buoc; ds.push(lp); if (lp > max) max = lp }
    let tong = 0
    for (const x of ds) tong += Math.exp(x - max)
    return Math.min(1, Math.exp(max) * tong)
}

/**
 * Hai bên có cùng giá mỗi kết quả không? Bên 1: n1 kết quả với tiền chi c1; bên 0: n0 với c0. Coi kết quả đến theo Poisson với tiền chi
 * là "thời gian phơi": nếu cùng giá thì n1 | n0 + n1 ~ Nhị thức(N, c1 / (c0 + c1)) — phép kiểm có điều kiện, tính CHÍNH XÁC (xấp xỉ
 * chuẩn sai ở mẫu nhỏ: 7 / 10 kết quả với q = 0,9 ra z = −2,1 mà xác suất thật 14%). Trả p HAI PHÍA + chiều: 'dat' = bên 1 ra ít
 * kết quả hơn kỳ vọng (đắt hơn), 're' = nhiều hơn. null = không kiểm được (thiếu tiền chi / chưa có kết quả nào).
 * Kết quả quảng cáo thật còn dao động hơn Poisson (ngày đông ngày vắng) ⇒ phép kiểm này đã là dễ dãi; đừng nới thêm.
 */
export function kiemHaiDem(n1: number, c1: number, n0: number, c0: number): { p: number; chieu: 'dat' | 're' } | null {
    const a = Math.round(n1), b = Math.round(n0), N = a + b
    if (!(c0 > 0) || !(c1 > 0) || !(N > 0) || a < 0 || b < 0) return null
    const q = c1 / (c0 + c1)
    const pDat = duoiNhiThuc(a, N, q), pRe = duoiNhiThuc(N - a, N, 1 - q)
    return pDat <= pRe ? { p: Math.min(1, 2 * pDat), chieu: 'dat' } : { p: Math.min(1, 2 * pRe), chieu: 're' }
}
const MUC_Y_NGHIA = 0.05
/** Giá đổi dưới ngưỡng khen / chê: < 5% ⇒ "gần như không đổi"; còn lại nói đúng số — 6.986đ → 6.148đ là "nhích xuống 12%", không phải "không đổi". */
const giaDoiIt = (dGia: number) => (Math.abs(dGia) < 5 ? 'gần như không đổi' : `nhích ${dGia > 0 ? 'lên' : 'xuống'} ${pt(Math.abs(dGia))}`)

/**
 * Holm: xét m phép kiểm CÙNG LÚC (34 tỉnh, mỗi tỉnh 5% ăn may ⇒ gần như chắc có tỉnh bị kêu oan) — xếp p tăng dần, giữ phép thứ i
 * khi p ≤ 5% / (m − i), dừng ở phép đầu tiên trượt. m = số dòng ĐƯỢC xét, không chỉ những dòng trông lệch.
 */
export function holm<T>(ds: { x: T; p: number }[], m: number): Set<T> {
    const xep = ds.slice().sort((u, v) => u.p - v.p), ra = new Set<T>(), tong = Math.max(m, ds.length)
    for (let i = 0; i < xep.length; i++) { if (xep[i].p > MUC_Y_NGHIA / (tong - i)) break; ra.add(xep[i].x) }
    return ra
}

/**
 * Chi nhiều mà (gần như) chưa ra kết quả, so với giá trung bình một kết quả (tối thiểu 20.000đ):
 *  - 0 kết quả mà chi ≥ 2 × giá trung bình (gộp một nhận xét);
 *  - 1 kết quả mà chi ≥ 4 ×, 2 kết quả mà chi ≥ 6 × — lọt giữa luật trên và "đắt nhất" (cần ≥ 3 kết quả).
 * Cùng giá trung bình mà "xui" chỉ ra ngần ấy kết quả: xác suất ≈ 14% / 9% / 6% (Poisson) ⇒ đủ để nhắc, chưa đủ để kết tội ⇒
 * nói số, không nói "kém". Chỉ dòng có mục tiêu khớp (hopLe); giá trung bình tính trên CHÍNH các dòng đó (chiến dịch lưu lượng
 * không kéo giá "khách hỏi" lên).
 */
export function xetKhongKetQua(rows: DongXet[], kq: KetQua, macDinh: boolean, cur: string, ten: string): NhanXet[] {
    const hop = rows.filter(r => r.hopLe)
    const chiHop = hop.reduce((s, r) => s + r.m.spend, 0), kqHop = hop.reduce((s, r) => s + r.m.results, 0)
    const san = cur === 'VND' ? 20_000 : 0
    const gia = kqHop > 0 ? chiHop / kqHop : null
    const nguong = Math.max(san, gia !== null ? 2 * gia : chiHop * 0.05)
    const ngan = KET_QUA[kq].ngan
    const giong: NhanXet['tone'] = macDinh ? 'bad' : 'warn'
    const ra: NhanXet[] = []
    const ds = hop.filter(r => r.m.results === 0 && r.m.spend > 0 && r.m.spend >= nguong).sort((a, b) => b.m.spend - a.m.spend)
    if (ds.length) {
        const chi = ds.reduce((s, r) => s + r.m.spend, 0)
        const ke = ds.slice(0, 3).map(r => `${r.label} (${tien(r.m.spend, cur)})`).join(', ')
        ra.push({ tone: giong, keys: ds.map(r => r.key), text: `${ds.length} ${ten} chi tổng ${tien(chi, cur)} mà chưa có ${ngan} nào: ${ke}${ds.length > 3 ? '…' : ''} (ngưỡng: mỗi dòng chi từ ${tien(nguong, cur)}).` })
    }
    // chỉ một dòng có kết quả ⇒ tự im: ngưỡng (2 + 2r) × (chi / r) luôn lớn hơn chính tiền chi của dòng đó
    if (gia !== null) {
        const it = hop.filter(r => (r.m.results === 1 || r.m.results === 2) && r.m.spend >= Math.max(san, (2 + 2 * r.m.results) * gia))
            .sort((a, b) => b.m.spend / b.m.results - a.m.spend / a.m.results)
        if (it.length) {
            const soKq = Array.from(new Set(it.map(r => r.m.results)))
            const ke = it.slice(0, 3).map(r => `${r.label} (${tien(r.m.spend, cur)} → ${r.m.results} ${ngan})`).join(', ')
            ra.push({ tone: giong, keys: it.map(r => r.key), text: `${it.length} ${ten} chi nhiều mà chỉ ra ${soKq.length === 1 ? soKq[0] : '1–2'} ${ngan}: ${ke}${it.length > 3 ? '…' : ''} — trung bình ${tien(gia, cur)} mỗi ${ngan}.` })
        }
    }
    return ra
}

/**
 * Rẻ nhất / đắt nhất theo giá mỗi kết quả — dòng có ≥ 3 kết quả, cần ≥ 2 dòng và chênh ≥ 1,5 lần. Mỗi đầu chỉ nói khi khác THẬT so với
 * phần còn lại cộng lại (kiemHaiDem); đầu bảng là chọn ra từ m dòng ⇒ ngưỡng 5% / m (Bonferroni) — 3 khách hỏi giá 10.000đ giữa
 * 60 khách hỏi giá 5.000đ chưa đủ để gọi "đắt nhất". So với trung bình phần còn lại, không với dòng rẻ nhất (cũng là cực trị, dễ ăn may).
 */
export function xetGiaKetQua(rows: DongXet[], kq: KetQua, macDinh: boolean, cur: string): NhanXet[] {
    const hop = rows.filter(r => r.hopLe && r.m.spend > 0)
    const ds = hop.filter(r => r.m.results >= 3 && r.m.costPerResult !== null).sort((a, b) => a.m.costPerResult! - b.m.costPerResult!)
    if (ds.length < 2) return []
    const re = ds[0], dat = ds[ds.length - 1]
    if (dat.m.costPerResult! < 1.5 * re.m.costPerResult!) return []
    const ngan = KET_QUA[kq].ngan
    const conLai = (x: DongXet) => {
        const o = hop.filter(r => r !== x), chi = o.reduce((s, r) => s + r.m.spend, 0), soKq = o.reduce((s, r) => s + r.m.results, 0)
        return { gia: soKq > 0 ? chi / soKq : null, kiem: kiemHaiDem(x.m.results, x.m.spend, soKq, chi) }
    }
    const nguong = MUC_Y_NGHIA / ds.length
    const cRe = conLai(re), cDat = conLai(dat)
    const ra: NhanXet[] = []
    if (cRe.kiem && cRe.kiem.chieu === 're' && cRe.kiem.p <= nguong) {
        ra.push({ tone: 'good', keys: [re.key], text: `${re.label} rẻ nhất: ${tien(re.m.costPerResult!, cur)} mỗi ${ngan} (${re.m.results} ${ngan})${cRe.gia !== null ? ` — phần còn lại trung bình ${tien(cRe.gia, cur)}` : ''}.` })
    }
    if (cDat.kiem && cDat.kiem.chieu === 'dat' && cDat.kiem.p <= nguong && cDat.gia !== null) {
        ra.push({ tone: macDinh ? 'bad' : 'warn', keys: [dat.key], text: `${dat.label} đắt nhất: ${tien(dat.m.costPerResult!, cur)} mỗi ${ngan} (${dat.m.results} ${ngan}) — gấp ${soVN(dat.m.costPerResult! / cDat.gia)} lần trung bình phần còn lại (${tien(cDat.gia, cur)}).` })
    }
    return ra
}

/**
 * Phần tiền chi lệch phần kết quả ≥ 10 điểm — cần tổng ≥ 10 kết quả VÀ dòng khác THẬT so với phần còn lại (kiemHaiDem, Holm trên mọi
 * dòng có chi: 34 tỉnh cùng lúc thì một tỉnh lệch 10 điểm vì may rủi là chuyện thường).
 */
export function xetTyTrong(rows: DongXet[], tong: SoDrill, kq: KetQua, macDinh: boolean): NhanXet[] {
    if (tong.results < 10 || !(tong.spend > 0)) return []
    const ngan = KET_QUA[kq].ngan
    const ds = rows.filter(r => r.hopLe && r.m.spend > 0).map(r => ({
        r, chi: (r.m.spend / tong.spend) * 100, kq: (r.m.results / tong.results) * 100,
        k: kiemHaiDem(r.m.results, r.m.spend, tong.results - r.m.results, tong.spend - r.m.spend),
    }))
    const khac = holm(ds.filter(x => x.k).map(x => ({ x, p: x.k!.p })), ds.length)
    const ra: NhanXet[] = []
    for (const x of ds.filter(x => x.r.m.results > 0 && x.chi >= 10 && x.chi - x.kq >= 10 && khac.has(x) && x.k!.chieu === 'dat').sort((a, b) => (b.chi - b.kq) - (a.chi - a.kq)).slice(0, 3)) {
        ra.push({ tone: macDinh ? 'bad' : 'warn', keys: [x.r.key], text: `${x.r.label} ăn ${pt(x.chi)} tiền chi nhưng chỉ ra ${pt(x.kq)} ${ngan}.` })
    }
    for (const x of ds.filter(x => x.r.m.results >= 3 && x.kq - x.chi >= 10 && khac.has(x) && x.k!.chieu === 're').sort((a, b) => (b.kq - b.chi) - (a.kq - a.chi)).slice(0, 3)) {
        ra.push({ tone: 'good', keys: [x.r.key], text: `${x.r.label}: ${pt(x.chi)} tiền chi mà ra ${pt(x.kq)} ${ngan}.` })
    }
    return ra
}

/** Tiền dồn về một dòng (≥ 60%) hoặc ba dòng đầu (≥ 80%, khi có ≥ 5 dòng). */
function xetTapTrung(rows: DongXet[], tong: SoDrill, cur: string, ten: string): NhanXet[] {
    const ds = rows.filter(r => r.m.spend > 0).sort((a, b) => b.m.spend - a.m.spend)
    if (ds.length < 3 || !(tong.spend > 0)) return []
    const p1 = (ds[0].m.spend / tong.spend) * 100
    if (p1 >= 60) return [{ tone: 'info', keys: [ds[0].key], text: `${ds[0].label} chiếm ${pt(p1)} tiền chi (${tien(ds[0].m.spend, cur)}).` }]
    if (ds.length >= 5) {
        const ba = ds.slice(0, 3)
        const p3 = (ba.reduce((s, r) => s + r.m.spend, 0) / tong.spend) * 100
        if (p3 >= 80) return [{ tone: 'info', keys: ba.map(r => r.key), text: `3 ${ten} đầu chiếm ${pt(p3)} tiền chi: ${ba.map(r => r.label).join(', ')}.` }]
    }
    return []
}

/**
 * Đổi so với kỳ trước theo từng dòng: kết quả tăng / giảm ≥ 50% (một kỳ ≥ 5 kết quả, hai kỳ cộng ≥ 10, hai kỳ đều có chi và có kết quả).
 * Tốt / xấu xét theo GIÁ MỖI KẾT QUẢ (đổi ≥ 25%), KHÔNG theo số kết quả: kết quả giảm vì chi giảm (tạm dừng, hạ ngân sách)
 * không phải quảng cáo kém đi ⇒ chỉ là gợi ý. Giá đổi ≥ 25% vẫn có thể là may rủi (3 → 5 khách hỏi) ⇒ phải khác THẬT (kiemHaiDem),
 * Holm trên MỌI dòng đủ mẫu (bảng 30 dòng thì một dòng nhảy mạnh vì may rủi là chuyện thường). Kỳ này không chi ⇒ bỏ (bảng đã hiện 0;
 * "bật mà không chi" xét riêng); chi mà 0 kết quả ⇒ bỏ (xetKhongKetQua đã xét — không kêu hai lần một dòng).
 * Mỗi giọng tối đa 2 dòng, đổi mạnh nhất trước.
 */
export function xetDoiKy(rows: DongXet[], kq: KetQua, cur: string): NhanXet[] {
    const ngan = KET_QUA[kq].ngan
    const ds = rows.filter(r => r.hopLe && r.prev && r.m.spend > 0 && r.prev.spend > 0 && r.m.results > 0 && r.prev.results > 0
        && (r.prev.results >= 5 || r.m.results >= 5) && r.prev.results + r.m.results >= 10)
        .map(r => {
            const p = r.prev!, g0 = p.spend / p.results, g1 = r.m.spend / r.m.results
            return { r, p, g0, g1, d: doiPt(r.m.results, p.results)!, dGia: doiPt(g1, g0)!, k: kiemHaiDem(r.m.results, r.m.spend, p.results, p.spend) }
        })
    const that = holm(ds.filter(x => x.k).map(x => ({ x, p: x.k!.p })), ds.length)
    const ra: NhanXet[] = []
    const dem: Record<NhanXet['tone'], number> = { bad: 0, good: 0, warn: 0, info: 0 }
    const day = (tone: NhanXet['tone'], key: string, text: string) => { if (dem[tone] < 2) { dem[tone]++; ra.push({ tone, keys: [key], text }) } }
    for (const x of ds.filter(x => Math.abs(x.d) >= 50).sort((a, b) => Math.abs(b.d) - Math.abs(a.d))) {
        const { r, p, g0, g1, d, dGia } = x
        if (Math.abs(dGia) >= 25 && !that.has(x)) continue // giá đổi nhiều mà chưa vượt may rủi (xét cả bảng) ⇒ chưa đủ để khen / chê
        const dChi = doiPt(r.m.spend, p.spend)
        const dau = `${r.label}: ${ngan} ${d > 0 ? 'tăng' : 'giảm'} ${pt(Math.abs(d))} so với kỳ trước (${p.results} → ${r.m.results})`
        const theoChi = dChi === null ? '' : ` theo chi ${dChi >= 0 ? 'tăng' : 'giảm'} ${pt(Math.abs(dChi))}`
        const giaTxt = `(${tien(g0, cur)} → ${tien(g1, cur)})`
        if (dGia >= 25) day(d > 0 ? 'warn' : 'bad', r.key, `${dau}${d > 0 ? ', nhưng' : ','} mỗi ${ngan} đắt hơn ${pt(dGia)} ${giaTxt}.`)
        else if (dGia <= -25) day(d > 0 ? 'good' : 'info', r.key, d > 0 ? `${dau}, mỗi ${ngan} rẻ hơn ${pt(-dGia)} ${giaTxt}.` : `${dau}${theoChi}, mỗi ${ngan} lại rẻ hơn ${pt(-dGia)} ${giaTxt}.`)
        else day('info', r.key, `${dau}${theoChi} — giá mỗi ${ngan} ${giaDoiIt(dGia)} ${giaTxt}.`)
    }
    return ra
}

/** Dòng gần như là cả nút (≥ 95% tiền chi CẢ HAI kỳ — nhóm chỉ có một quảng cáo) ⇒ nhận xét tổng (xetTong) đã nói thay, khỏi lặp ở bảng con. */
export function boTrungTong(rows: DongXet[], tong: SoDrill, truoc: SoDrill | null): DongXet[] {
    if (!truoc || !(tong.spend > 0) || !(truoc.spend > 0)) return rows
    return rows.filter(x => !(x.prev && x.m.spend >= 0.95 * tong.spend && x.prev.spend >= 0.95 * truoc.spend))
}

/** Tổng của nút so với kỳ trước + tần suất. */
export function xetTong(tong: SoDrill, truoc: SoDrill | null, kq: KetQua, hopLe: boolean, cur: string, k: KhoangDrill): NhanXet[] {
    const ra: NhanXet[] = []
    const ngan = KET_QUA[kq].ngan
    if (truoc && truoc.spend > 0) {
        const d = doiPt(tong.spend, truoc.spend)
        if (d !== null && Math.abs(d) >= 20) ra.push({ tone: 'info', text: `Chi ${d > 0 ? 'tăng' : 'giảm'} ${pt(Math.abs(d))} so với kỳ trước (${tien(truoc.spend, cur)} → ${tien(tong.spend, cur)}).` })
    }
    // Số kết quả lên / xuống theo tiền chi là chuyện quy mô ⇒ chỉ là gợi ý. Tốt / xấu xét theo GIÁ mỗi kết quả và phải khác THẬT
    // (kiemHaiDem): 50 → 63 khách hỏi khi chi 300.000đ → 550.000đ là giá tăng 45%, nhưng p ≈ 6% ⇒ nói số, không tô đỏ.
    if (truoc && hopLe && truoc.spend > 0 && truoc.results >= 5 && tong.results === 0 && tong.spend > 0) {
        // theo giá kỳ trước lẽ ra được "du" kết quả; ra 0 vì may rủi có xác suất e^(−du) ⇒ du ≥ 3 là dưới 5%
        const g0 = truoc.spend / truoc.results, du = tong.spend / g0
        if (du >= 3) ra.push({ tone: 'bad', text: `Chi ${tien(tong.spend, cur)} mà chưa ra ${ngan} nào — theo giá kỳ trước (${tien(g0, cur)} mỗi ${ngan}) lẽ ra được khoảng ${Math.round(du)}.` })
    } else if (truoc && hopLe && truoc.spend > 0 && tong.spend > 0 && truoc.results > 0 && tong.results > 0 && (truoc.results >= 5 || tong.results >= 5) && truoc.results + tong.results >= 10) {
        const g0 = truoc.spend / truoc.results, g1 = tong.spend / tong.results
        const dKq = doiPt(tong.results, truoc.results)!, dGia = doiPt(g1, g0)!, dChi = doiPt(tong.spend, truoc.spend)!
        const kiem = kiemHaiDem(tong.results, tong.spend, truoc.results, truoc.spend)
        const that = kiem !== null && kiem.p <= MUC_Y_NGHIA
        if (Math.abs(dGia) >= 20 && that) {
            ra.push({ tone: dGia > 0 ? 'bad' : 'good', text: `Giá mỗi ${ngan} ${dGia > 0 ? 'tăng' : 'giảm'} ${pt(Math.abs(dGia))} (${tien(g0, cur)} → ${tien(g1, cur)}) — ${ngan} ${truoc.results} → ${tong.results}.` })
        } else if (Math.abs(dKq) >= 20) {
            const chi = Math.abs(dChi) < 10 ? ', chi gần như giữ nguyên' : ` ${Math.abs(dGia) >= 20 ? 'khi' : 'theo'} chi ${dChi > 0 ? 'tăng' : 'giảm'} ${pt(Math.abs(dChi))}`
            const gia = Math.abs(dGia) >= 20 ? `giá mỗi ${ngan} ${tien(g0, cur)} → ${tien(g1, cur)}, nhưng chênh này còn trong vùng may rủi` : `giá mỗi ${ngan} ${giaDoiIt(dGia)} (${tien(g0, cur)} → ${tien(g1, cur)})`
            ra.push({ tone: 'info', text: `${ngan[0].toUpperCase()}${ngan.slice(1)} ${dKq > 0 ? 'tăng' : 'giảm'} ${pt(Math.abs(dKq))} (${truoc.results} → ${tong.results})${chi} — ${gia}.` })
        }
    }
    if (truoc && truoc.impressions >= 1000 && tong.impressions >= 1000 && truoc.cpm && tong.cpm) {
        const d = doiPt(tong.cpm, truoc.cpm)
        if (d !== null && d >= 30) ra.push({ tone: 'warn', text: `Giá mỗi 1.000 lượt hiển thị tăng ${pt(d)} (${tien(truoc.cpm, cur)} → ${tien(tong.cpm, cur)}) — cạnh tranh cao hơn hoặc đối tượng hẹp lại.` })
    }
    if (tong.frequency && k.days && ((k.days <= 7 && tong.frequency >= 3) || (k.days <= 30 && tong.frequency >= 5))) {
        ra.push({ tone: 'warn', text: `Tần suất ${soVN(tong.frequency)} lần mỗi người trong ${k.days} ngày — khách thấy đi thấy lại dễ nhàm; cân nhắc đổi nội dung hoặc nới đối tượng.` })
    }
    return ra
}

// ─── Đọc ────────────────────────────────────────────────────────────────────────

export type TangDrill = 'account' | 'campaign' | 'adset' | 'ad'
type TangCon = 'campaign' | 'adset' | 'ad'
const TANG: TangDrill[] = ['account', 'campaign', 'adset', 'ad']
const TANG_CON: Record<TangDrill, TangCon | null> = { account: 'campaign', campaign: 'adset', adset: 'ad', ad: null }
export const TEN_TANG: Record<TangDrill, string> = { account: 'tài khoản', campaign: 'chiến dịch', adset: 'nhóm quảng cáo', ad: 'quảng cáo' }

const COT_TK = 'id,account_id,name,currency,timezone_name,timezone_offset_hours_utc,account_status'
const COT_NUT: Record<TangCon, string> = {
    campaign: 'id,name,account_id,status,effective_status,objective,daily_budget,lifetime_budget,budget_remaining,start_time,stop_time,created_time',
    adset: 'id,name,account_id,status,effective_status,daily_budget,lifetime_budget,budget_remaining,start_time,end_time,optimization_goal,targeting,campaign{id,name,objective}',
    ad: 'id,name,account_id,status,effective_status,created_time,preview_shareable_link,campaign{id,name,objective},adset{id,name,optimization_goal,daily_budget,lifetime_budget,end_time,targeting},creative{id,thumbnail_url,body,title,effective_object_story_id}',
}
const COT_CON: Record<TangCon, string> = {
    campaign: 'id,name,status,effective_status,objective,daily_budget,lifetime_budget,start_time,stop_time',
    adset: 'id,name,status,effective_status,daily_budget,lifetime_budget,optimization_goal,start_time,end_time',
    ad: 'id,name,status,effective_status,created_time,creative{thumbnail_url}',
}
const CANH_CON: Record<TangCon, string> = { campaign: 'campaigns', adset: 'adsets', ad: 'ads' }
const COT_SO = 'spend,impressions,reach,clicks,inline_link_clicks,actions'
const COT_SO_KHONG_REACH = 'spend,impressions,clicks,inline_link_clicks,actions'

// Tham số dựng MỘT chỗ ⇒ tổng quan và chia nhỏ gọi y hệt nhau ⇒ trúng đệm
const khoangTs = (k: { since: string | null; until: string | null }) => (k.since ? { time_range: { since: k.since, until: k.until } } : { date_preset: 'maximum' })
const buocChuoi = (k: KhoangDrill): 1 | 'monthly' => (k.days !== null && k.days <= 92 ? 1 : 'monthly')
const tsSoCon = (con: TangCon, k: { since: string | null; until: string | null }) =>
    ({ ...khoangTs(k), level: con, fields: `${con}_id,${con}_name${con === 'campaign' ? ',objective' : ''},${COT_SO}`, limit: 500 })
const tsDsCon = (con: TangCon) => ({ fields: COT_CON[con], limit: 200 })
const TS_DICH = { fields: 'campaign_id,optimization_goal', limit: 500 }
const tsChuoi = (k: KhoangDrill) => ({ ...khoangTs(k), fields: `date_start,date_stop,${COT_SO_KHONG_REACH}`, time_increment: buocChuoi(k), limit: 500 })

export interface TruyVanDrill {
    level?: any; id?: any; account?: any; preset?: any; since?: any; until?: any
    compare?: any; breakdown?: any; result?: any; group?: any; fresh?: any
}

interface DauPilot { planId: string; sku: string | null; name: string }

interface Goc {
    now: number; doc: DocGraph; level: TangDrill; act: string; id: string; n: any; tk: any; cur: string; tz: string | null
    homNay: string; k: KhoangDrill; truoc: KyDrill | null; pilot: Map<string, DauPilot>; duoc: string[]; q: TruyVanDrill
    thongKe: { goi: number; dem: number }
}

const KHONG_THUOC = 'Đối tượng này không thuộc tài khoản quảng cáo của cửa hàng (tài khoản đang chọn ở Chính sách quảng cáo hoặc có quảng cáo Pilot).'

function banDoPilot(boost: KeHoachAds[]): Map<string, DauPilot> {
    const m = new Map<string, DauPilot>()
    for (const k of boost) {
        const r = k.result || {}, d = k.data || {}
        if (!r.campaignId) continue
        const v: DauPilot = { planId: k.id, sku: d.sku ? String(d.sku) : null, name: tenGon(d.name || d.postTitle) }
        for (const id of [r.campaignId, r.adsetId, r.adId]) if (id) m.set(String(id), v)
    }
    return m
}

function taiKhoanDuoc(cfg: CauHinhAds, boost: KeHoachAds[]): string[] {
    const s = new Set<string>()
    const a0 = chuanAct(cfg.adAccountId)
    if (a0) s.add(a0)
    for (const k of boost) { const a = chuanAct(k.data?.adAccountId); if (a && k.result?.campaignId) s.add(a) }
    return [...s]
}

/** Lỗi đọc nút / tài khoản → câu cho người dùng; lỗi lạ ném tiếp (route trả 502 / 500). */
function loiNut(e: any, level: TangDrill, id: string): never {
    if (laLoiToken(e) || laLoiQuyen(e) || laGioiHan(e) || e?.hetGio) throw new ToolError(moTaLoiDrill(e))
    if (laKhongTonTai(e)) throw new ToolError(`Không đọc được ${TEN_TANG[level]} ${id} — đã bị xoá, hoặc token quảng cáo không có quyền trên nó.`)
    if (Number(e?.code) === 100) throw new ToolError(`Mã ${id} không phải ${TEN_TANG[level]} (hoặc Facebook không cho đọc): ${String(e?.message || '').slice(0, 200)}`)
    throw e
}

function linkTrinhQuanLy(level: TangDrill, act: string, id: string): string {
    const soTk = act.replace(/^act_/, '')
    const goc = 'https://adsmanager.facebook.com/adsmanager/manage'
    if (level === 'account') return `${goc}/campaigns?act=${soTk}`
    if (level === 'campaign') return `${goc}/adsets?act=${soTk}&selected_campaign_ids=${id}`
    if (level === 'adset') return `${goc}/ads?act=${soTk}&selected_adset_ids=${id}`
    return `${goc}/ads?act=${soTk}&selected_ad_ids=${id}`
}

/**
 * Phân tích sâu MỘT nút (tài khoản / chiến dịch / nhóm / quảng cáo).
 *  - không `breakdown` ⇒ tổng quan: thông tin nút, tổng + kỳ trước, chuỗi theo ngày, bảng đối tượng con, nhận xét
 *  - `breakdown` ⇒ bảng chia nhỏ (tỉnh, tuổi, giới, …) + nhận xét
 */
export async function docDrillAds(ctx: NgCanhAds, q: TruyVanDrill = {}): Promise<any> {
    const now = luc(ctx)
    const cfg = await docCauHinhAds(ctx)
    const tok = await canTokenAds(ctx, cfg)
    // TUẦN TỰ: đọc CSDL xong mới gọi Facebook song song (pool Prisma cửa hàng chỉ 1 kết nối trên prod)
    const boost = await ctx.kho.dsKeHoachLoai(['boost'], now - 400 * NGAY)
    const pilot = banDoPilot(boost)
    const duoc = taiKhoanDuoc(cfg, boost)
    if (!duoc.length) throw new ToolError('Chưa chọn tài khoản quảng cáo — chọn ở Chính sách quảng cáo trước.')
    const level: TangDrill = TANG.includes(q.level) ? q.level : 'account'
    const thongKe = { goi: 0, dem: 0 }
    const doc = docCoDem(dichVuAds(ctx, tok.accessToken), tok.accessToken, { fresh: laCo(q.fresh), bayGio: () => luc(ctx), thongKe })

    let act: string, id: string, n: any = null
    if (level === 'account') {
        const xin = q.account || q.id
        const a = xin ? chuanAct(xin) : (chuanAct(cfg.adAccountId) || duoc[0])
        if (!a || !duoc.includes(a)) throw new ToolError(KHONG_THUOC)
        act = id = a
    } else {
        id = String(q.id ?? '').trim()
        if (!/^\d{5,25}$/.test(id)) throw new ToolError(`Mã ${TEN_TANG[level]} không hợp lệ.`)
        try { n = await doc(id, { fields: COT_NUT[level] }) } catch (e) { loiNut(e, level, id) }
        const a = chuanAct(n?.account_id)
        if (!a || !duoc.includes(a)) throw new ToolError(KHONG_THUOC)
        act = a
    }
    let tk: any
    try { tk = await doc(act, { fields: COT_TK }) } catch (e) { loiNut(e, 'account', act) }
    const cur = String(tk?.currency || '').toUpperCase() || 'VND'
    const lech = Number(tk?.timezone_offset_hours_utc)
    const homNay = homNayTheoTk(now, Number.isFinite(lech) ? lech : 7)
    const k = giaiKhoang(q, homNay)
    const truoc = laCo(q.compare) ? kyTruoc(k, homNay) : null
    const g: Goc = { now, doc, level, act, id, n, tk, cur, tz: tk?.timezone_name ? String(tk.timezone_name) : null, homNay, k, truoc, pilot, duoc, q, thongKe }
    const chia = String(q.breakdown ?? '').trim()
    if (chia && chia !== 'none') {
        if (!(chia in CHIA)) throw new ToolError(`Kiểu chia không hỗ trợ: ${chia.slice(0, 40)}`)
        return xayChia(g, chia as ChiaDrill)
    }
    return xayTongQuan(g)
}

const tkGon = (g: Goc) => ({
    id: g.act, name: tenGon(g.tk?.name) || g.act, currency: g.cur, timezone: g.tz,
    offsetHours: Number.isFinite(Number(g.tk?.timezone_offset_hours_utc)) ? Number(g.tk.timezone_offset_hours_utc) : null,
    status: Number(g.tk?.account_status) || 0, statusText: TRANG_THAI_TK[Number(g.tk?.account_status)] || null,
})

function xayNut(g: Goc): any {
    const { level, n, cur } = g
    const managerUrl = linkTrinhQuanLy(level, g.act, g.id)
    if (level === 'account') return { level, id: g.act, name: tenGon(g.tk?.name) || g.act, managerUrl }
    const goc = {
        level, id: g.id, name: tenGon(n?.name) || g.id, status: n?.status || null, effectiveStatus: n?.effective_status || null,
        pilot: g.pilot.get(g.id) || null, managerUrl,
    }
    if (level === 'campaign') {
        return {
            ...goc, objective: n?.objective || null, goal: null, dailyBudget: nganSach(n?.daily_budget, cur), lifetimeBudget: nganSach(n?.lifetime_budget, cur),
            budgetRemaining: nganSach(n?.budget_remaining, cur), start: n?.start_time || null, end: n?.stop_time || null, created: n?.created_time || null,
        }
    }
    if (level === 'adset') {
        return {
            ...goc, objective: n?.campaign?.objective || null, goal: n?.optimization_goal || null,
            dailyBudget: nganSach(n?.daily_budget, cur), lifetimeBudget: nganSach(n?.lifetime_budget, cur), budgetRemaining: nganSach(n?.budget_remaining, cur),
            start: n?.start_time || null, end: n?.end_time || null, targeting: tomTatDoiTuong(n?.targeting),
        }
    }
    return {
        ...goc, objective: n?.campaign?.objective || null, goal: n?.adset?.optimization_goal || null,
        dailyBudget: nganSach(n?.adset?.daily_budget, cur), lifetimeBudget: nganSach(n?.adset?.lifetime_budget, cur), end: n?.adset?.end_time || null,
        created: n?.created_time || null, targeting: tomTatDoiTuong(n?.adset?.targeting),
        thumbnail: n?.creative?.thumbnail_url || null, title: tenGon(n?.creative?.title).slice(0, 200) || null,
        body: tenGon(n?.creative?.body).slice(0, 500) || null, previewLink: n?.preview_shareable_link || null,
        postId: n?.creative?.effective_object_story_id || null,
    }
}

function duongDan(g: Goc, nut: any): { level: TangDrill; id: string; name: string }[] {
    const ra: { level: TangDrill; id: string; name: string }[] = [{ level: 'account', id: g.act, name: tenGon(g.tk?.name) || g.act }]
    const cd = g.n?.campaign, nh = g.n?.adset
    if (g.level === 'adset' || g.level === 'ad') if (cd?.id) ra.push({ level: 'campaign', id: String(cd.id), name: tenGon(cd.name) || String(cd.id) })
    if (g.level === 'ad' && nh?.id) ra.push({ level: 'adset', id: String(nh.id), name: tenGon(nh.name) || String(nh.id) })
    if (g.level !== 'account') ra.push({ level: g.level, id: nut.id, name: nut.name })
    return ra
}

/** Gọi song song, giữ lỗi theo từng phần (một phần hỏng không làm mù cả màn). */
async function songSong<T extends Record<string, (() => Promise<any>) | null>>(viec: T): Promise<{ [K in keyof T]: { ok: boolean; v: any; loi: any } }> {
    const khoa = Object.keys(viec) as (keyof T)[]
    const kq = await Promise.allSettled(khoa.map(k => (viec[k] ? viec[k]!() : Promise.resolve(null))))
    const ra = {} as { [K in keyof T]: { ok: boolean; v: any; loi: any } }
    khoa.forEach((k, i) => {
        const r = kq[i]
        ra[k] = r.status === 'fulfilled' ? { ok: !!viec[k], v: r.value, loi: null } : { ok: false, v: null, loi: r.reason }
    })
    return ra
}

/**
 * Họ mục tiêu của nút và của từng đối tượng con (để chọn "kết quả" mặc định và chặn nhận xét sai mục tiêu).
 * Tài khoản: họ mỗi chiến dịch = mục tiêu tối ưu chung của các nhóm (danh sách nhóm của tài khoản) hoặc mục tiêu chiến dịch;
 * họ tài khoản = họ chiếm ≥ 80% tiền chi kỳ này. Chiến dịch: họ mỗi nhóm theo optimization_goal.
 */
function tinhHo(g: Goc, dsCon: any[] | null, soCon: any[] | null, dich: any[] | null): { hoNut: HoMucTieu | null; hoCon: Map<string, HoMucTieu | null>; chiTheoHo: { ho: HoMucTieu | null; spend: number }[] | null } {
    const hoCon = new Map<string, HoMucTieu | null>()
    if (g.level === 'account') {
        const dichCd = new Map<string, (HoMucTieu | null)[]>()
        for (const d of dich || []) {
            const cid = String(d?.campaign_id || '')
            if (!cid) continue
            if (!dichCd.has(cid)) dichCd.set(cid, [])
            dichCd.get(cid)!.push(HO_THEO_DICH[String(d?.optimization_goal || '').toUpperCase()] || null)
        }
        const mucTieu = new Map<string, any>()
        for (const c of dsCon || []) if (c?.id) mucTieu.set(String(c.id), c.objective)
        for (const r of soCon || []) if (r?.campaign_id && !mucTieu.has(String(r.campaign_id))) mucTieu.set(String(r.campaign_id), r.objective)
        for (const [cid, obj] of mucTieu) hoCon.set(cid, hoChung(dichCd.get(cid) || []) || hoMucTieu(obj))
        const chi = soCon ? soCon.map(r => ({ ho: hoCon.get(String(r?.campaign_id)) ?? null, spend: so(r?.spend) })) : null
        const theoChi = chi ? hoTheoChi(chi) : null
        // kỳ này không chi đồng nào ⇒ họ chung của mọi chiến dịch (lẫn ⇒ null)
        return { hoNut: theoChi || (chi && chi.some(c => c.spend > 0) ? null : hoChung([...hoCon.values()])), hoCon, chiTheoHo: chi }
    }
    if (g.level === 'campaign') {
        for (const s of dsCon || []) if (s?.id) hoCon.set(String(s.id), hoMucTieu(g.n?.objective, s.optimization_goal))
        const chi = soCon ? soCon.map(r => ({ ho: hoCon.has(String(r?.adset_id)) ? hoCon.get(String(r?.adset_id))! : hoMucTieu(g.n?.objective), spend: so(r?.spend) })) : null
        const theoChi = chi ? hoTheoChi(chi) : null
        const hoNut = theoChi || (chi && chi.some(c => c.spend > 0) ? null : hoChung([...hoCon.values()]) || hoMucTieu(g.n?.objective))
        return { hoNut, hoCon, chiTheoHo: chi }
    }
    const hoNut = g.level === 'adset' ? hoMucTieu(g.n?.campaign?.objective, g.n?.optimization_goal) : hoMucTieu(g.n?.campaign?.objective, g.n?.adset?.optimization_goal)
    for (const a of dsCon || []) if (a?.id) hoCon.set(String(a.id), hoNut)
    return { hoNut, hoCon, chiTheoHo: null }
}

function chonKetQua(q: TruyVanDrill, hoNut: HoMucTieu | null): { kq: KetQua; auto: boolean } {
    const xin = String(q.result ?? '').trim()
    if (xin && xin in KET_QUA) return { kq: xin as KetQua, auto: false }
    return { kq: hoNut ? KQ_MAC_DINH[hoNut] : 'khach_hoi', auto: true }
}

const dsKetQua = () => (Object.keys(KET_QUA) as KetQua[]).map(k => ({ key: k, label: KET_QUA[k].label }))

function moTaKetQua(kq: KetQua, auto: boolean, hoNut: HoMucTieu | null) {
    return {
        key: kq, label: KET_QUA[kq].label, short: KET_QUA[kq].ngan, auto, family: hoNut, familyLabel: hoNut ? TEN_HO[hoNut] : null, options: dsKetQua(),
        /** kết quả đang chọn có khớp mục tiêu nút không — không khớp thì nhận xét theo kết quả chỉ ở mức vàng */
        matches: !!hoNut && KET_QUA[kq].ho === hoNut,
    }
}

async function xayTongQuan(g: Goc): Promise<any> {
    const { doc, level, act, id, k, truoc, cur } = g
    const con = TANG_CON[level]
    const p = await songSong({
        tong: () => doc(`${id}/insights`, { ...khoangTs(k), fields: COT_SO }),
        truoc: truoc ? () => doc(`${id}/insights`, { ...khoangTs(truoc), fields: COT_SO }) : null,
        chuoi: () => docHet(doc, `${id}/insights`, tsChuoi(k), 4),
        dsCon: con ? () => docHet(doc, `${id}/${CANH_CON[con]}`, tsDsCon(con), 2) : null,
        soCon: con ? () => docHet(doc, `${id}/insights`, tsSoCon(con, k), 5) : null,
        soConTruoc: con && truoc ? () => docHet(doc, `${id}/insights`, tsSoCon(con, truoc), 5) : null,
        dich: level === 'account' ? () => docHet(doc, `${act}/adsets`, TS_DICH, 2) : null,
        tenTk: level === 'account' && g.duoc.length > 1 ? () => doc('', { ids: g.duoc.join(','), fields: 'id,name,currency' }) : null,
    })
    const errors: string[] = []
    const loi = (ten: string, r: { loi: any }) => { if (r.loi) errors.push(`${ten}: ${moTaLoiDrill(r.loi)}`) }
    loi('Số tổng', p.tong); loi('Kỳ trước', p.truoc); loi('Theo ngày', p.chuoi)
    if (con) { loi(`Danh sách ${TEN_TANG[con]}`, p.dsCon); loi(`Số liệu ${TEN_TANG[con]}`, p.soCon); loi(`Số liệu ${TEN_TANG[con]} kỳ trước`, p.soConTruoc) }
    loi('Mục tiêu tối ưu các nhóm', p.dich)

    const { hoNut, hoCon } = tinhHo(g, p.dsCon.ok ? p.dsCon.v.rows : null, p.soCon.ok ? p.soCon.v.rows : null, p.dich.ok ? p.dich.v.rows : null)
    const { kq, auto } = chonKetQua(g.q, hoNut)
    const ketQua = moTaKetQua(kq, auto, hoNut)
    const nut = xayNut(g)

    const totals = p.tong.ok ? hoanTat(docSoDrill(p.tong.v?.data?.[0]), kq) : null
    const prevTotals = p.truoc.ok ? hoanTat(docSoDrill(p.truoc.v?.data?.[0]), kq) : null

    // chuỗi theo ngày (lấp ngày trống bằng 0 khi theo ngày)
    const buoc = buocChuoi(k)
    let series: any = null
    if (p.chuoi.ok) {
        const theoNgay = new Map<string, SoDrill>()
        for (const r of p.chuoi.v.rows) if (r?.date_start) theoNgay.set(String(r.date_start), hoanTat(docSoDrill(r, false), kq))
        const rows: { date: string; label: string; m: SoDrill }[] = []
        if (buoc === 1 && k.since && k.until) for (let d = k.since; d <= k.until; d = congNgay(d, 1)) rows.push({ date: d, label: nhanNgay(d, 1), m: theoNgay.get(d) || hoanTat(soRong(), kq) })
        else for (const [d, m] of [...theoNgay].sort((a, b) => (a[0] < b[0] ? -1 : 1))) rows.push({ date: d, label: nhanNgay(d, buoc), m })
        series = { step: buoc === 1 ? 'day' : 'month', rows, truncated: p.chuoi.v.conTiep }
    }

    // bảng đối tượng con: danh sách (trạng thái, ngân sách) ∪ Insights (số liệu — gồm cả cái đã lưu trữ mà kỳ này có chi)
    let children: any = null
    const hints: NhanXet[] = []
    const notes: string[] = []
    if (con) {
        // đối tượng con KHÔNG có trong danh sách (đã lưu trữ / xoá mà kỳ này có chi): nhóm QC ⇒ cùng họ với nút; chiến dịch ⇒ theo mục tiêu chiến dịch
        const hoMacDinh = level === 'adset' ? hoNut : level === 'campaign' ? hoMucTieu(g.n?.objective) : null
        const theoMa = new Map<string, any>()
        const dong = (ma: string) => {
            if (!theoMa.has(ma)) {
                theoMa.set(ma, {
                    id: ma, name: ma, status: null, effectiveStatus: null, objective: null, goal: null,
                    family: hoCon.has(ma) ? hoCon.get(ma) ?? null : hoMacDinh,
                    dailyBudget: null, lifetimeBudget: null, start: null, end: null, thumbnail: null, created: null,
                    pilot: g.pilot.get(ma) || null, listed: false, raw: null as SoDrill | null, rawPrev: null as SoDrill | null,
                })
            }
            return theoMa.get(ma)
        }
        for (const c of p.dsCon.ok ? p.dsCon.v.rows : []) {
            if (!c?.id) continue
            const d = dong(String(c.id))
            Object.assign(d, {
                name: tenGon(c.name) || d.id, status: c.status || null, effectiveStatus: c.effective_status || null, listed: true,
                objective: con === 'campaign' ? c.objective || null : g.n?.objective || g.n?.campaign?.objective || null,
                goal: con === 'adset' ? c.optimization_goal || null : con === 'ad' ? g.n?.optimization_goal || null : null,
                dailyBudget: nganSach(c.daily_budget, cur), lifetimeBudget: nganSach(c.lifetime_budget, cur),
                start: c.start_time || null, end: c.stop_time || c.end_time || null, thumbnail: c.creative?.thumbnail_url || null, created: c.created_time || null,
            })
        }
        const maCon = (r: any) => String(r?.[`${con}_id`] || '')
        for (const r of p.soCon.ok ? p.soCon.v.rows : []) {
            const ma = maCon(r)
            if (!ma) continue
            const d = dong(ma)
            if (!d.listed) { d.name = tenGon(r[`${con}_name`]) || ma; if (con === 'campaign') d.objective = r.objective || null }
            d.raw = d.raw ? congSo(d.raw, docSoDrill(r)) : docSoDrill(r)
        }
        if (truoc) for (const r of p.soConTruoc.ok ? p.soConTruoc.v.rows : []) {
            const ma = maCon(r)
            if (!ma) continue
            const d = dong(ma)
            if (!d.listed && d.name === ma) d.name = tenGon(r[`${con}_name`]) || ma
            d.rawPrev = d.rawPrev ? congSo(d.rawPrev, docSoDrill(r)) : docSoDrill(r)
        }
        const kqHo = KET_QUA[kq].ho
        const rows = [...theoMa.values()].map(d => {
            const { raw, rawPrev, ...ngoai } = d
            return { ...ngoai, m: hoanTat(raw || soRong(), kq), prev: truoc ? hoanTat(rawPrev || soRong(), kq) : null }
        }).sort((a, b) => b.m.spend - a.m.spend || Number(b.effectiveStatus === 'ACTIVE') - Number(a.effectiveStatus === 'ACTIVE') || String(a.name).localeCompare(String(b.name), 'vi'))
        children = {
            level: con, label: TEN_TANG[con], rows,
            truncated: (p.dsCon.ok && p.dsCon.v.conTiep) || (p.soCon.ok && p.soCon.v.conTiep),
            error: p.soCon.loi ? moTaLoiDrill(p.soCon.loi) : p.dsCon.loi ? moTaLoiDrill(p.dsCon.loi) : null,
        }
        if (children.truncated) notes.push(`Danh sách ${TEN_TANG[con]} dài — chỉ hiện phần đầu (xếp theo tiền chi).`)

        // nhận xét theo đối tượng con
        if (p.soCon.ok && totals) {
            const xet: DongXet[] = rows.map(r => ({ key: r.id, label: r.name, m: r.m, prev: r.prev, hopLe: r.family === kqHo }))
            const tongCon = hoanTat(rows.length ? rows.slice(1).reduce((s, r) => congSo(s, r.m), rows[0].m) : soRong(), kq)
            const hut = totals.spend - tongCon.spend
            if (hut > Math.max(cur === 'VND' ? 1000 : 1, totals.spend * 0.01)) {
                notes.push(`Bảng ${TEN_TANG[con]} cộng lại ít hơn số tổng ${tien(hut, cur)} — phần chênh thường là ${TEN_TANG[con]} đã xoá (Facebook không liệt kê)${children.truncated ? ' hoặc phần danh sách bị cắt' : ''}.`)
            }
            hints.push(...xetKhongKetQua(xet, kq, auto, cur, TEN_TANG[con]))
            hints.push(...xetGiaKetQua(xet, kq, auto, cur))
            hints.push(...xetTapTrung(xet, tongCon, cur, TEN_TANG[con]))
            if (truoc) hints.push(...xetDoiKy(boTrungTong(xet, totals, prevTotals), kq, cur))
            hints.push(...xetTrangThai(g, rows, con))
            if (xet.some(x => !x.hopLe && x.m.spend > 0)) {
                const khac = rows.filter(r => r.family !== kqHo && r.m.spend > 0).length
                notes.push(`${khac} ${TEN_TANG[con]} có chi tiêu chạy mục tiêu khác (hoặc chưa rõ mục tiêu) — không bị xét "chưa có ${KET_QUA[kq].ngan}".`)
            }
        }
    }
    if (totals) hints.unshift(...xetTong(totals, prevTotals, kq, ketQua.matches, cur, k))
    if (totals && ketQua.matches && totals.results > 0 && totals.results < 10) notes.push(`Mới có ${totals.results} ${KET_QUA[kq].ngan} — so sánh còn ít mẫu, xem như gợi ý.`)
    if (!ketQua.matches) notes.push(hoNut
        ? `Mục tiêu ở đây là "${TEN_HO[hoNut]}" — "${KET_QUA[kq].ngan}" không phải thứ Facebook tối ưu, nhận xét theo kết quả chỉ ở mức lưu ý.`
        : `Chưa rõ mục tiêu (nhiều mục tiêu lẫn nhau) — đổi "Kết quả tính theo" cho đúng thứ bạn cần đo.`)
    if (laCo(g.q.compare) && !truoc) notes.push(k.since ? 'Kỳ trước vượt quá 37 tháng Facebook giữ số liệu — không so sánh.' : '"Toàn bộ thời gian" không có kỳ trước để so.')
    notes.push('Số liệu Facebook có thể trễ vài giờ và còn được điều chỉnh vài ngày sau (ghi nhận chuyển đổi trễ).')

    let accounts: any[] = g.duoc.map(a => ({ id: a, name: a, currency: null as string | null }))
    if (p.tenTk.ok && p.tenTk.v) accounts = accounts.map(a => ({ ...a, name: tenGon(p.tenTk.v[a.id]?.name) || a.id, currency: p.tenTk.v[a.id]?.currency || null }))
    else if (g.duoc.length === 1) accounts = [{ id: g.act, name: tenGon(g.tk?.name) || g.act, currency: g.cur }]

    return {
        view: 'overview', generatedAt: g.now, calls: g.thongKe,
        account: tkGon(g), accounts, node: nut, path: duongDan(g, nut),
        range: { ...k, today: g.homNay, step: buoc === 1 ? 'day' : 'month' }, prevRange: truoc,
        result: ketQua, totals, prevTotals, series, children, hints, notes, errors,
    }
}

/** Trạng thái đối tượng con: bị từ chối / có vấn đề / đang bật mà không chi đồng nào (kỳ có hôm qua / hôm nay). */
function xetTrangThai(g: Goc, rows: any[], con: TangCon): NhanXet[] {
    const ra: NhanXet[] = []
    const ten = TEN_TANG[con]
    const tuChoi = rows.filter(r => r.effectiveStatus === 'DISAPPROVED')
    if (tuChoi.length) ra.push({ tone: 'bad', keys: tuChoi.map(r => r.id), text: `${tuChoi.length} ${ten} bị từ chối duyệt: ${tuChoi.slice(0, 3).map(r => r.name).join(', ')}${tuChoi.length > 3 ? '…' : ''}.` })
    const vanDe = rows.filter(r => r.effectiveStatus === 'WITH_ISSUES')
    if (vanDe.length) ra.push({ tone: 'warn', keys: vanDe.map(r => r.id), text: `${vanDe.length} ${ten} đang có vấn đề (Facebook báo "With issues"): ${vanDe.slice(0, 3).map(r => r.name).join(', ')} — mở Trình quản lý quảng cáo để xem lý do.` })
    const homQua = congNgay(g.homNay, -1)
    if (g.k.until && g.k.until >= homQua) {
        const mocCu = g.now - NGAY
        const khongChi = rows.filter(r => {
            if (r.effectiveStatus !== 'ACTIVE' || r.m.spend > 0) return false
            const bd = Date.parse(r.start || r.created || '')
            if (!Number.isFinite(bd) || bd > mocCu) return false        // mới tạo / chưa tới giờ chạy ⇒ chưa đủ để kêu
            const kt = Date.parse(r.end || '')
            return !(Number.isFinite(kt) && kt <= g.now)               // đã hết lịch chạy ⇒ không chi là đúng
        })
        if (khongChi.length) ra.push({
            tone: 'warn', keys: khongChi.map(r => r.id),
            text: `${khongChi.length} ${ten} đang bật mà không chi đồng nào trong kỳ: ${khongChi.slice(0, 3).map(r => r.name).join(', ')}${khongChi.length > 3 ? '…' : ''} — xem bên trong có bị tắt, bị từ chối, hết lịch chạy hay đối tượng quá hẹp.`,
        })
    }
    return ra
}

async function xayChia(g: Goc, chia: ChiaDrill): Promise<any> {
    const { doc, level, act, id, k, truoc, cur } = g
    const dinh = CHIA[chia]
    const buoc = buocChuoi(k)
    const cu13 = !k.since || k.since < moc13Thang(g.homNay)
    const goc = { view: 'breakdown', breakdown: chia, label: dinh.label, generatedAt: g.now, calls: g.thongKe, account: tkGon(g), range: { ...k, today: g.homNay, step: buoc === 1 ? 'day' : 'month' }, prevRange: truoc }
    if (chia === 'hour' && cu13) {
        return { ...goc, rows: [], totals: null, hints: [], notes: [], errors: [], result: null, error: `Facebook chỉ chia theo giờ cho 13 tháng gần nhất (từ ${moc13Thang(g.homNay)}) — chọn khoảng ngày ngắn hơn${k.since ? '' : ' (không chọn "Toàn bộ thời gian")'}.` }
    }
    // người tiếp cận: có theo từng dòng (trừ giờ / ngày / quá 13 tháng); CỘNG được giữa các dòng chỉ khi mỗi người thuộc một dòng
    const coReach = chia !== 'hour' && chia !== 'day' && !cu13
    const ts = (kk: { since: string | null; until: string | null }) => (chia === 'day'
        ? (kk === k ? tsChuoi(k) : { ...tsChuoi(k), ...khoangTs(kk) })
        : { ...khoangTs(kk), fields: coReach ? COT_SO : COT_SO_KHONG_REACH, breakdowns: dinh.breakdowns, limit: 500 })
    const con = TANG_CON[level]
    const p = await songSong({
        hien: () => docHet(doc, `${id}/insights`, ts(k), 6),
        truoc: truoc ? () => docHet(doc, `${id}/insights`, ts(truoc), 6) : null,
        // mục tiêu các đối tượng con — CÙNG tham số với tổng quan ⇒ thường lấy từ đệm, không tốn lượt gọi
        dsCon: level === 'campaign' && con ? () => docHet(doc, `${id}/${CANH_CON[con]}`, tsDsCon(con), 2) : level === 'account' ? () => docHet(doc, `${act}/campaigns`, tsDsCon('campaign'), 2) : null,
        soCon: (level === 'account' || level === 'campaign') && con ? () => docHet(doc, `${id}/insights`, tsSoCon(con, k), 5) : null,
        dich: level === 'account' ? () => docHet(doc, `${act}/adsets`, TS_DICH, 2) : null,
    })
    const errors: string[] = []
    if (p.hien.loi) errors.push(`${dinh.label}: ${moTaLoiDrill(p.hien.loi)}`)
    if (p.truoc.loi) errors.push(`Kỳ trước: ${moTaLoiDrill(p.truoc.loi)}`)

    const thieuHo = (level === 'account' || level === 'campaign') && (!p.soCon.ok || !p.dsCon.ok || (level === 'account' && !p.dich.ok))
    const { hoNut, chiTheoHo } = tinhHo(g, p.dsCon.ok ? p.dsCon.v.rows : null, p.soCon.ok ? p.soCon.v.rows : null, p.dich.ok ? p.dich.v.rows : null)
    const { kq, auto } = chonKetQua(g.q, hoNut)
    const ketQua = moTaKetQua(kq, auto, hoNut)
    // phần tiền chi kỳ này thuộc đối tượng có mục tiêu khớp "kết quả" đang chọn
    const kqHo = KET_QUA[kq].ho
    let tyLeHop: number | null
    if (level === 'adset' || level === 'ad') tyLeHop = hoNut === kqHo ? 1 : 0
    else if (thieuHo || !chiTheoHo) tyLeHop = null
    else {
        const tong = chiTheoHo.reduce((s, c) => s + Math.max(0, c.spend), 0)
        tyLeHop = tong > 0 ? chiTheoHo.reduce((s, c) => s + (c.ho === kqHo ? Math.max(0, c.spend) : 0), 0) / tong : (hoNut === kqHo ? 1 : 0)
    }
    const xetKq = tyLeHop !== null && tyLeHop >= 0.85

    // dựng dòng
    const nhom = chia === 'region' && !['0', 'false'].includes(String(g.q.group ?? '1'))
    const dung = (ds: any[]): Map<string, DongChia> => {
        const m = new Map<string, DongChia>()
        for (const r of ds) {
            const nh = nhanChia(chia, r, buoc)
            const so1 = docSoDrill(r, coReach)
            const khoa = nhom ? (nh.group || nh.label) : nh.key
            const cu = m.get(khoa)
            if (cu) {
                cu.m = congSo(cu.m, so1)
                if (nhom && cu.parts && !cu.parts.includes(nh.label)) cu.parts.push(nh.label)
            } else {
                m.set(khoa, nhom
                    ? { key: khoa, label: nh.group || nh.label, group: nh.group ?? null, parts: [nh.label], m: so1, prev: null }
                    : { ...nh, m: so1, prev: null })
            }
        }
        return m
    }
    const hien = dung(p.hien.ok ? p.hien.v.rows : [])
    const cu = truoc && p.truoc.ok ? dung(p.truoc.v.rows) : null
    // lấp chỗ trống: đủ 24 giờ; đủ mọi ngày khi theo ngày
    if (p.hien.ok && chia === 'hour') for (let h = 0; h < 24; h++) { const key = String(h).padStart(2, '0'); if (!hien.has(key)) hien.set(key, { key, label: `${h}:00–${h}:59`, hour: h, m: soRong(), prev: null }) }
    if (p.hien.ok && chia === 'day' && buoc === 1 && k.since && k.until) for (let d = k.since; d <= k.until; d = congNgay(d, 1)) if (!hien.has(d)) hien.set(d, { key: d, label: nhanNgay(d, 1), date: d, m: soRong(), prev: null })
    // kỳ trước theo NGÀY không cùng khoá (ngày khác nhau) ⇒ chỉ so cả kỳ; các kiểu chia khác so theo dòng
    const rows = xepChia(chia, [...hien.values()].map(r => ({
        ...r,
        m: hoanTat(r.m, kq),
        prev: cu && chia !== 'day' ? hoanTat(cu.get(r.key)?.m || soRong(), kq) : null,
    })))
    const congDong = (ds: SoDrill[]) => {
        // cộng từ dòng ĐẦU (không từ ô rỗng — ô rỗng có người tiếp cận null ⇒ tổng mất người tiếp cận)
        const t = ds.length ? ds.slice(1).reduce((s, x) => congSo(s, x), { ...ds[0] }) : soRong()
        if (!dinh.congReach) t.reach = null
        return hoanTat(t, kq)
    }
    const totals = p.hien.ok ? congDong(rows.map(r => r.m)) : null
    const prevTotals = cu ? congDong([...cu.values()].map(r => r.m)) : null

    // nhận xét
    const hints: NhanXet[] = []
    const notes: string[] = []
    if (totals && rows.length) {
        const xet: DongXet[] = rows.filter(r => r.key !== 'x').map(r => ({ key: r.key, label: r.label, m: r.m, prev: r.prev, hopLe: xetKq }))
        const macDinh = auto && ketQua.matches
        hints.push(...xetKhongKetQua(xet, kq, macDinh, cur, dinh.ten))
        const tyTrong = xetTyTrong(xet, totals, kq, macDinh)
        hints.push(...(tyTrong.length || totals.results >= 10 ? tyTrong : xetGiaKetQua(xet, kq, macDinh, cur)))
        hints.push(...xetTapTrung(xet, totals, cur, dinh.ten))
        if (cu) hints.push(...xetDoiKy(xet, kq, cur))
        if (chia === 'hour' && xetKq && totals.results >= 10) {
            const tot = rows.filter(r => r.m.results >= 3).sort((a, b) => b.m.results - a.m.results).slice(0, 3)
            if (tot.length) hints.push({
                tone: 'info', keys: tot.map(r => r.key),
                text: `${KET_QUA[kq].ngan[0].toUpperCase()}${KET_QUA[kq].ngan.slice(1)} nhiều nhất lúc ${tot.map(r => `${r.hour}h`).join(', ')}${g.tz ? ` (giờ ${g.tz})` : ''} — muốn dồn tiền vào khung giờ thì nhóm quảng cáo phải dùng ngân sách trọn đời + lịch chạy.`,
            })
        }
        if (!xetKq) {
            notes.push(tyLeHop === null
                ? `Không đọc được mục tiêu các ${con ? TEN_TANG[con] : 'đối tượng'} — tắt nhận xét theo ${KET_QUA[kq].ngan} để khỏi kết luận sai.`
                : `${pt((1 - tyLeHop) * 100)} tiền chi kỳ này thuộc ${level === 'account' || level === 'campaign' ? `${TEN_TANG[con!]} ` : ''}mục tiêu khác "${KET_QUA[kq].ngan}" — tắt nhận xét theo ${KET_QUA[kq].ngan} để khỏi kết luận sai${level === 'account' ? '; vào từng chiến dịch để xem' : ''}.`)
        } else if (totals.results < 10) notes.push(`Mới có ${totals.results} ${KET_QUA[kq].ngan} — nhận xét theo tỷ trọng cần từ 10 trở lên.`)
    }
    if (chia === 'region') {
        notes.push('Tỉnh/thành là nơi người xem SỐNG theo Facebook ước tính — không phải địa chỉ giao hàng.')
        notes.push('Khi chia theo tỉnh, Facebook chỉ trả số đo trên Facebook / Instagram (bình luận, tin nhắn, nhấp…), không trả chuyển đổi ngoài web.')
        if (nhom) notes.push('Đang gộp theo 34 tỉnh/thành mới (Nghị quyết 202/2025/QH15); người tiếp cận khi gộp = cộng các tỉnh cũ (gần đúng).')
        const la = p.hien.ok ? [...new Set(p.hien.v.rows.map((r: any) => tenGon(r?.region)).filter((t: string) => t && !/^unknown$/i.test(t) && !tinhVN(t)))] : []
        if (la.length) notes.push(`${la.length} tên Facebook trả không thuộc bảng tỉnh Việt Nam — giữ nguyên tên gốc: ${la.slice(0, 5).join(', ')}${la.length > 5 ? '…' : ''}.`)
    }
    if (chia === 'hour') notes.push(`Giờ theo múi giờ tài khoản quảng cáo${g.tz ? ` (${g.tz})` : ''}. Facebook không trả số người tiếp cận khi chia theo giờ.`)
    if (!dinh.congReach && chia !== 'hour' && chia !== 'day') notes.push('Người tiếp cận không cộng được giữa các dòng (một người có thể thấy quảng cáo ở nhiều nơi) — dòng tổng để trống.')
    if (chia !== 'hour' && chia !== 'day' && cu13) notes.push('Khoảng ngày quá 13 tháng: Facebook không trả số người tiếp cận khi chia nhỏ.')
    if (chia === 'device' && p.hien.ok && rows.every(r => r.m.impressions === 0 || r.key === 'unknown')) notes.push('Từ 06/08/2026 Facebook có thể không trả số theo thiết bị cho một số tài khoản — bật trong Trình quản lý quảng cáo nếu cần.')
    if (chia === 'day' && cu) notes.push('So kỳ trước theo ngày: xem ở dòng tổng (mỗi ngày của hai kỳ là ngày khác nhau).')

    return {
        ...goc, result: ketQua, grouped: nhom, rows, totals, prevTotals, hints, notes, errors,
        error: p.hien.loi ? moTaLoiDrill(p.hien.loi) : null, truncated: p.hien.ok ? p.hien.v.conTiep : false,
    }
}
