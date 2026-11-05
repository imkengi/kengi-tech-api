/* Kiểm chứng PHÂN TÍCH SÂU QUẢNG CÁO (05/11/2026) — npx tsx scripts/check-facebook-ads-drill.ts
 *
 * Facebook / Marketing API GIẢ ghi lại MỌI lời gọi (kèm token) + kho Ads Pilot trong bộ nhớ + prisma giả + đồng hồ giả.
 *  1. Hàm thuần: bảng 63 → 34 tỉnh (đối chiếu đủ 23 nhóm sáp nhập của Nghị quyết 202/2025/QH15), so khớp tên Facebook
 *     (không dấu, bỏ "tỉnh / thành phố / province / city" — "Hà Tĩnh" KHÔNG thành "Hà"), khoảng ngày theo múi giờ tài khoản,
 *     kỳ trước, đọc số (lượt mua không đếm hai lần), họ mục tiêu (Doanh số + tin nhắn = tương tác).
 *  2. Rào: chưa có token / chưa chọn tài khoản / tài khoản lạ / đối tượng thuộc tài khoản lạ / mã lạ / kiểu chia lạ ⇒ từ chối
 *     TRƯỚC khi đọc số liệu; tài khoản có quảng cáo Pilot được đọc. Không một lời gọi GHI nào; token không bao giờ ra ngoài.
 *  3. Tổng quan tài khoản: tổng + kỳ trước, bảng chiến dịch = danh sách ∪ Insights (cả cái đã lưu trữ), lật trang bằng cursor,
 *     họ mục tiêu theo nhóm QC, nhận xét "chi mà chưa có khách hỏi" KHÔNG kêu chiến dịch lưu lượng, "bật mà không chi"
 *     không kêu cái mới tạo / đã hết lịch, đánh dấu Pilot, chuỗi ngày lấp ngày trống, chênh tổng do đối tượng đã xoá.
 *  4. Chia theo tỉnh: gộp 34 tỉnh mới (mặc định) / không gộp, tên lạ giữ nguyên, tỷ trọng tiền ↔ khách hỏi, so kỳ trước theo
 *     dòng, nhiều mục tiêu lẫn nhau ⇒ tắt nhận xét theo kết quả.
 *  5. Theo giờ: đủ 24 giờ, KHÔNG xin người tiếp cận, quá 13 tháng / toàn bộ thời gian ⇒ báo, không gọi.
 *  6. Kiểu chia khác: tuổi × giới, vị trí, nền tảng (người tiếp cận không cộng), thiết bị rỗng.
 *  7. Tầng sâu: chiến dịch → nhóm → quảng cáo, đường dẫn, đối tượng nhắm (tỉnh tiếng Việt), kết quả mặc định theo mục tiêu tối ưu.
 *  8. Lỗi & đệm: giới hạn lượt gọi chỉ hỏng một phần, token hỏng nói rõ, đệm 5 phút (đổi kiểu chia không gọi lại phần tổng), fresh.
 *  9. Nối dây (soát mã nguồn): route GET /ads/drill chặn theo tiện ích, lib không có lời gọi ghi, có trong check:all.
 */
import * as fs from 'fs'
import * as path from 'path'
import {
    docDrillAds, xoaDemDrill, khoaTinh, tinhVN, SO_TINH, giaiKhoang, kyTruoc, homNayTheoTk, congThang, docSoDrill, hoanTat,
    hoMucTieu, hoTheoChi, GIOI_HAN, xetDoiKy, xetKhongKetQua, xetGiaKetQua, xetTyTrong, xetTong, kiemHaiDem, holm, boTrungTong,
} from '../src/lib/facebookAdsDrill'
import { khoBoNhoAds, docCauHinhAds, type NgCanhAds, type DichVuAds } from '../src/lib/facebookAdsPilot'
import { ToolError } from '../src/lib/mcpTypes'

let loi = 0, dat = 0
const dung = (ten: string, ok: boolean, chiTiet = '') => { ok ? dat++ : loi++; console.log(`${ok ? '✓' : '✗'} ${ten}${chiTiet && !ok ? ' — ' + chiTiet : ''}`) }
const nem = async (f: () => Promise<any>) => { try { await f(); return null } catch (e: any) { return e } }

const H = 3600_000, NGAY = 86400_000
/** 10:00 sáng 05/11/2026 giờ VN (03:00Z) ⇒ "hôm nay" của tài khoản (UTC+7) = 2026-11-05; 7 ngày qua = 29/10 → 04/11. */
const NOW = Date.parse('2026-11-05T03:00:00Z')
let bayGio = NOW
const iso = (ms: number) => new Date(ms).toISOString().replace('.000Z', '+0000')

// Token GIẢ (không mang dạng EAA… của Facebook — repo công khai, đừng để máy quét bí mật báo nhầm)
const USER_TOKEN = 'TOKEN-USER-BI-MAT-0123456789'

/* ── dữ liệu Facebook giả ── */
const ACT = 'act_111', ACT2 = 'act_222', ACT_LA = 'act_999'
const HIEN = '2026-10-29', TRUOC = '2026-10-22'
const C = {
    c1: '120000000000001', c2: '120000000000002', c3: '120000000000003', c4: '120000000000004', c5: '120000000000005',
    c6: '120000000000006', c7: '120000000000007', c8: '120000000000008', c9: '120000000000009', cp: '120000000000010',
}
const A = { a21: '230000000000021', a22: '230000000000022', a31: '230000000000031' }
const AD = { ad211: '340000000000211', ad311: '340000000000311' }

const hd = (o: Record<string, number>) => Object.entries(o).map(([action_type, value]) => ({ action_type, value: String(value) }))
const KH = (cm: number, ms: number, them: Record<string, number> = {}) => hd({ comment: cm, 'onsite_conversion.messaging_conversation_started_7d': ms, ...them })
const dongSo = (spend: number, impressions: number, reach: number, clicks: number, link: number, actions: any[]) =>
    ({ spend: String(spend), impressions: String(impressions), reach: String(reach), clicks: String(clicks), inline_link_clicks: String(link), actions })

let honHop = false        // biến thể: chiến dịch lưu lượng chi lớn ⇒ tài khoản nhiều mục tiêu lẫn nhau
let loiToken = false
let gioiHanCon = false
let goi: { method: string; path: string; params: any; token: string }[] = []
let ra: any[] = []        // mọi kết quả gửi ra — soát token

const SO_CD_HIEN = () => [
    { campaign_id: C.c1, campaign_name: 'Pilot · Mũi khoan', objective: 'OUTCOME_ENGAGEMENT', ...dongSo(100000, 20000, 9000, 400, 50, KH(12, 8)) },
    { campaign_id: C.c2, campaign_name: 'Tin nhắn · Ổ cắm', objective: 'OUTCOME_SALES', ...dongSo(200000, 30000, 15000, 600, 100, KH(5, 35)) },
    { campaign_id: C.c3, campaign_name: 'Lưu lượng · Shopee', objective: 'OUTCOME_TRAFFIC', ...dongSo(honHop ? 300000 : 60000, 10000, 7000, 900, 800, hd({ link_click: 800 })) },
    { campaign_id: C.c5, campaign_name: 'Cũ đã lưu trữ', objective: 'OUTCOME_ENGAGEMENT', ...dongSo(30000, 5000, 3000, 50, 5, KH(3, 0)) },
    { campaign_id: C.c6, campaign_name: 'Tốn tiền không ai hỏi', objective: 'OUTCOME_ENGAGEMENT', ...dongSo(150000, 25000, 12000, 200, 20, hd({ post_reaction: 30 })) },
]
const SO_CD_TRUOC = () => [
    { campaign_id: C.c1, campaign_name: 'Pilot · Mũi khoan', objective: 'OUTCOME_ENGAGEMENT', ...dongSo(50000, 10000, 5000, 200, 20, KH(6, 4)) },
    { campaign_id: C.c2, campaign_name: 'Tin nhắn · Ổ cắm', objective: 'OUTCOME_SALES', ...dongSo(200000, 30000, 15000, 600, 100, KH(5, 35)) },
    { campaign_id: C.c3, campaign_name: 'Lưu lượng · Shopee', objective: 'OUTCOME_TRAFFIC', ...dongSo(50000, 9000, 6000, 800, 700, hd({ link_click: 700 })) },
]
/** Tổng tài khoản = các chiến dịch + 10.000đ của chiến dịch ĐÃ XOÁ (Facebook không liệt kê trong bảng). */
function tongTk(ds: any[], them: number) {
    const t: any = { spend: them, impressions: 0, reach: 0, clicks: 0, inline_link_clicks: 0 }
    const hanh: Record<string, number> = {}
    for (const r of ds) {
        for (const k of ['spend', 'impressions', 'reach', 'clicks', 'inline_link_clicks']) t[k] += Number(r[k])
        for (const a of r.actions) hanh[a.action_type] = (hanh[a.action_type] || 0) + Number(a.value)
    }
    return { ...Object.fromEntries(Object.entries(t).map(([k, v]) => [k, String(v)])), actions: hd(hanh) }
}

const DS_CD: any[] = [
    { id: C.c1, name: 'Pilot · Mũi khoan', status: 'ACTIVE', effective_status: 'ACTIVE', objective: 'OUTCOME_ENGAGEMENT', start_time: iso(NOW - 3 * NGAY) },
    { id: C.c2, name: 'Tin nhắn · Ổ cắm', status: 'ACTIVE', effective_status: 'ACTIVE', objective: 'OUTCOME_SALES', daily_budget: '200000', start_time: iso(NOW - 20 * NGAY) },
    { id: C.c3, name: 'Lưu lượng · Shopee', status: 'ACTIVE', effective_status: 'ACTIVE', objective: 'OUTCOME_TRAFFIC', start_time: iso(NOW - 20 * NGAY) },
    // trang 2
    { id: C.c4, name: 'Bật mà không chạy', status: 'ACTIVE', effective_status: 'ACTIVE', objective: 'OUTCOME_ENGAGEMENT', start_time: iso(NOW - 10 * NGAY) },
    { id: C.c6, name: 'Tốn tiền không ai hỏi', status: 'ACTIVE', effective_status: 'ACTIVE', objective: 'OUTCOME_ENGAGEMENT', start_time: iso(NOW - 9 * NGAY) },
    { id: C.c7, name: 'Mới tạo', status: 'ACTIVE', effective_status: 'ACTIVE', objective: 'OUTCOME_ENGAGEMENT', start_time: iso(NOW - 2 * H) },
    { id: C.c8, name: 'Đã hết lịch', status: 'ACTIVE', effective_status: 'ACTIVE', objective: 'OUTCOME_ENGAGEMENT', start_time: iso(NOW - 30 * NGAY), stop_time: iso(NOW - NGAY) },
]
const DICH_TK = [
    { campaign_id: C.c1, optimization_goal: 'POST_ENGAGEMENT' }, { campaign_id: C.c2, optimization_goal: 'CONVERSATIONS' },
    { campaign_id: C.c2, optimization_goal: 'CONVERSATIONS' }, { campaign_id: C.c3, optimization_goal: 'LINK_CLICKS' },
    { campaign_id: C.c4, optimization_goal: 'POST_ENGAGEMENT' }, { campaign_id: C.c6, optimization_goal: 'POST_ENGAGEMENT' },
]
const TINH_HIEN = [
    ['Ho Chi Minh City', 150000, 10, 20], ['Binh Duong Province', 50000, 4, 6], ['Ba Ria–Vung Tau Province', 20000, 2, 0],
    ['Hanoi', 200000, 3, 2], ['Da Nang', 30000, 6, 0], ['Quang Nam Province', 10000, 4, 0], ['Thua Thien–Hue Province', 40000, 0, 0],
    ['California', 20000, 0, 0], ['Unknown', 30000, 6, 0],
] as const
const TINH_TRUOC = [['Ho Chi Minh City', 100000, 10, 10], ['Hanoi', 100000, 10, 10]] as const
const TARGET_A21 = {
    geo_locations: { regions: [{ key: '3', name: 'Ho Chi Minh City' }, { key: '4', name: 'Hanoi' }], cities: [{ key: '9', name: 'Biên Hòa', radius: 10, distance_unit: 'kilometer' }] },
    excluded_geo_locations: { regions: [{ key: '5', name: 'Thua Thien–Hue Province' }] },
    age_min: 22, age_max: 45, genders: [2], flexible_spec: [{ interests: [{ id: '1', name: 'Dụng cụ cầm tay' }] }],
}

function loiFb(code: number, message: string, subcode?: number) {
    return Object.assign(new Error(message), { code, subcode, fbtraceId: 'TRACE' })
}
const LOAI: Record<string, string[]> = {
    // trường được phép theo loại đối tượng (Graph trả #100 khi xin trường không có)
    campaign: ['id', 'name', 'account_id', 'status', 'effective_status', 'objective', 'daily_budget', 'lifetime_budget', 'budget_remaining', 'start_time', 'stop_time', 'created_time'],
    adset: ['id', 'name', 'account_id', 'status', 'effective_status', 'daily_budget', 'lifetime_budget', 'budget_remaining', 'start_time', 'end_time', 'optimization_goal', 'targeting', 'campaign'],
    ad: ['id', 'name', 'account_id', 'status', 'effective_status', 'created_time', 'preview_shareable_link', 'campaign', 'adset', 'creative'],
}
const cotGoc = (fields: string) => fields.replace(/\{[^}]*\}/g, '').split(',').map(s => s.trim()).filter(Boolean)
const loaiCua = (id: string) => (id.startsWith('12') ? 'campaign' : id.startsWith('23') ? 'adset' : id.startsWith('34') ? 'ad' : null)

function nut(id: string): any {
    const cd = (m: string, act: string, them: any = {}) => ({ id: m, account_id: act.replace('act_', ''), status: 'ACTIVE', effective_status: 'ACTIVE', ...them })
    switch (id) {
        case C.c2: return cd(C.c2, ACT, { name: 'Tin nhắn · Ổ cắm', objective: 'OUTCOME_SALES', daily_budget: '200000', start_time: iso(NOW - 20 * NGAY) })
        case C.c9: return cd(C.c9, ACT_LA, { name: 'Của người khác', objective: 'OUTCOME_ENGAGEMENT' })
        case C.cp: return cd(C.cp, ACT2, { name: 'Pilot TK cũ', objective: 'OUTCOME_ENGAGEMENT' })
        case A.a21: return cd(A.a21, ACT, { name: 'Nhóm nữ 22–45', optimization_goal: 'CONVERSATIONS', daily_budget: '150000', targeting: TARGET_A21, campaign: { id: C.c2, name: 'Tin nhắn · Ổ cắm', objective: 'OUTCOME_SALES' } })
        case AD.ad211: return cd(AD.ad211, ACT, {
            name: 'Ảnh ổ cắm', created_time: iso(NOW - 15 * NGAY), preview_shareable_link: 'https://fb.me/xem-truoc',
            campaign: { id: C.c2, name: 'Tin nhắn · Ổ cắm', objective: 'OUTCOME_SALES' },
            adset: { id: A.a21, name: 'Nhóm nữ 22–45', optimization_goal: 'CONVERSATIONS', daily_budget: '150000', targeting: TARGET_A21 },
            creative: { id: '9', thumbnail_url: 'https://x/oc.jpg', body: 'Ổ cắm 4 lỗ — 189.000đ', effective_object_story_id: 'PG1_55' },
        })
        case AD.ad311: return cd(AD.ad311, ACT, {
            name: 'Link Shopee', campaign: { id: C.c3, name: 'Lưu lượng · Shopee', objective: 'OUTCOME_TRAFFIC' },
            adset: { id: A.a31, name: 'Nhóm link', optimization_goal: 'LINK_CLICKS', daily_budget: '60000' }, creative: { id: '10' },
        })
    }
    return null
}

function chiaTk(breakdowns: string, ky: string): any[] {
    if (breakdowns === 'region') {
        const ds = ky === 'truoc' ? TINH_TRUOC : TINH_HIEN
        return ds.map(([region, spend, cm, ms]) => ({ region, ...dongSo(spend, spend / 10, spend / 25, spend / 500, 0, KH(cm, ms)) }))
    }
    if (breakdowns === 'hourly_stats_aggregated_by_advertiser_time_zone') {
        return [['20', 100000, 20], ['12', 50000, 10], ['09', 30000, 3], ['03', 40000, 0]].map(([h, spend, cm]) => ({
            hourly_stats_aggregated_by_advertiser_time_zone: `${h}:00:00 - ${h}:59:59`,
            spend: String(spend), impressions: String(Number(spend) / 10), clicks: '10', inline_link_clicks: '1', actions: KH(Number(cm), 0),
        }))
    }
    if (breakdowns === 'age,gender') {
        return [['25-34', 'male', 50000], ['Unknown', 'female', 5000], ['18-24', 'female', 30000], ['25-34', 'female', 80000], ['35-44', 'unknown', 10000]]
            .map(([age, gender, spend]) => ({ age, gender, ...dongSo(Number(spend), 1000, 500, 10, 1, KH(2, 1)) }))
    }
    if (breakdowns === 'publisher_platform') return [['facebook', 300000, 20000], ['instagram', 200000, 15000], ['audience_network', 50000, 9000]].map(([p, s, r]) => ({ publisher_platform: p, ...dongSo(Number(s), 30000, Number(r), 100, 10, KH(10, 5)) }))
    if (breakdowns === 'publisher_platform,platform_position') {
        return [['facebook', 'feed', 300000], ['instagram', 'instagram_stories', 150000], ['facebook', 'facebook_reels', 100000]]
            .map(([p, pos, s]) => ({ publisher_platform: p, platform_position: pos, ...dongSo(Number(s), 30000, 10000, 100, 10, KH(10, 5)) }))
    }
    if (breakdowns === 'impression_device') return []
    return []
}

function phanHoi(p: string, q: any): any {
    if (loiToken) throw loiFb(190, 'Error validating access token: Session has expired')
    const ky = q.time_range?.since === TRUOC ? 'truoc' : q.time_range?.since === HIEN ? 'hien' : q.date_preset === 'maximum' ? 'toan' : 'khac'
    if (p === '' && q.ids) return Object.fromEntries(String(q.ids).split(',').map((id: string) => [id, { id, name: id === ACT ? 'TK Kengi' : id === ACT2 ? 'TK cũ' : 'Lạ', currency: 'VND' }]))
    if (p === ACT || p === ACT2 || p === ACT_LA) return { id: p, account_id: p.slice(4), name: p === ACT ? 'TK Kengi' : 'TK khác', currency: 'VND', timezone_name: 'Asia/Ho_Chi_Minh', timezone_offset_hours_utc: 7, account_status: 1 }
    if (p === `${ACT}/campaigns`) return q.after === 'TRANG2'
        ? { data: DS_CD.slice(3) }
        : { data: DS_CD.slice(0, 3), paging: { cursors: { after: 'TRANG2' }, next: `https://graph.facebook.com/v26.0/${ACT}/campaigns?access_token=${USER_TOKEN}&after=TRANG2` } }
    if (p === `${ACT}/adsets`) return { data: DICH_TK }
    if (p === `${ACT}/insights`) {
        if (q.level === 'campaign') {
            if (gioiHanCon) throw loiFb(17, 'User request limit reached')
            return { data: ky === 'truoc' ? SO_CD_TRUOC() : SO_CD_HIEN() }
        }
        if (q.breakdowns) return { data: chiaTk(q.breakdowns, ky) }
        if (q.time_increment !== undefined) {
            // bỏ trống 01/11 (không phân phối) — máy phải lấp 0
            return { data: ['2026-10-29', '2026-10-30', '2026-10-31', '2026-11-02', '2026-11-03', '2026-11-04'].map(d => ({ date_start: d, date_stop: d, ...dongSo(70000, 9000, 0, 100, 10, KH(5, 4)) })) }
        }
        return { data: [ky === 'truoc' ? tongTk(SO_CD_TRUOC(), 0) : tongTk(SO_CD_HIEN(), 10000)] }
    }
    if (p === `${C.c2}/adsets`) return { data: [{ id: A.a21, name: 'Nhóm nữ 22–45', status: 'ACTIVE', effective_status: 'ACTIVE', optimization_goal: 'CONVERSATIONS', daily_budget: '150000' }, { id: A.a22, name: 'Nhóm nam', status: 'PAUSED', effective_status: 'PAUSED', optimization_goal: 'CONVERSATIONS', daily_budget: '50000' }] }
    if (p === `${C.c2}/insights`) {
        if (q.level === 'adset') return { data: [{ adset_id: A.a21, adset_name: 'Nhóm nữ 22–45', ...dongSo(150000, 20000, 9000, 400, 60, KH(4, 26)) }, { adset_id: A.a22, adset_name: 'Nhóm nam', ...dongSo(50000, 10000, 6000, 200, 40, KH(1, 9)) }] }
        if (q.breakdowns === 'region') return { data: [{ region: 'Ho Chi Minh City', ...dongSo(120000, 1, 1, 1, 1, KH(3, 30)) }, { region: 'Hanoi', ...dongSo(80000, 1, 1, 1, 1, KH(2, 5)) }] }
        if (q.time_increment !== undefined) return { data: [] }
        return { data: [dongSo(200000, 30000, 15000, 600, 100, KH(5, 35))] }
    }
    if (p === `${A.a21}/ads`) return { data: [{ id: AD.ad211, name: 'Ảnh ổ cắm', status: 'ACTIVE', effective_status: 'ACTIVE', created_time: iso(NOW - 15 * NGAY), creative: { thumbnail_url: 'https://x/oc.jpg' } }] }
    if (p === `${A.a21}/insights`) { const so = ky === 'truoc' ? dongSo(150000, 20000, 9000, 400, 60, KH(2, 13)) : dongSo(150000, 20000, 9000, 400, 60, KH(4, 26)); return { data: q.level === 'ad' ? [{ ad_id: AD.ad211, ad_name: 'Ảnh ổ cắm', ...so }] : q.time_increment !== undefined ? [] : [so] } }
    if (p === `${AD.ad211}/insights` || p === `${AD.ad311}/insights`) return { data: q.time_increment !== undefined ? [] : [dongSo(50000, 5000, 3000, 300, 250, hd({ link_click: 250 }))] }
    if (p === `${C.cp}/insights`) return { data: [] }
    if (/^\d+$/.test(p)) {
        if (p === '120000000000099') throw loiFb(100, 'Unsupported get request. Object does not exist', 33)
        const n = nut(p)
        if (!n) throw loiFb(100, 'Unsupported get request. Object does not exist', 33)
        const loai = loaiCua(p)!
        const thua = cotGoc(String(q.fields || '')).find(f => !LOAI[loai].includes(f))
        if (thua) throw loiFb(100, `(#100) Tried accessing nonexisting field (${thua}) on node type (${loai})`)
        return n
    }
    if (/\/(campaigns|adsets|ads)$/.test(p) || /\/insights$/.test(p)) return { data: [] }
    throw loiFb(100, `đường giả chưa khai: ${p}`)
}

const taoFb = (token: string): DichVuAds => ({
    get: async (p, q) => { goi.push({ method: 'get', path: p, params: q || {}, token }); return phanHoi(p, q || {}) },
    post: async (p, q) => { goi.push({ method: 'post', path: p, params: q || {}, token }); throw new Error('Phân tích sâu KHÔNG được ghi') },
})

/* ── kho + prisma giả ── */
let tokens: any[] = []
const prisma: any = {
    fbUserToken: {
        findUnique: async ({ where, select }: any) => { const t = tokens.find(x => x.fbUserId === where.fbUserId); return t ? pick(t, select) : null },
        findFirst: async ({ select }: any) => (tokens.length ? pick(tokens[tokens.length - 1], select) : null),
    },
}
function pick(o: any, sel: any) { const r: any = {}; for (const [k, v] of Object.entries(sel || {})) if (v) r[k] = o[k]; return r }

async function ngCanh(o: { coToken?: boolean; act?: string | null; pilot?: boolean } = {}): Promise<NgCanhAds> {
    const kho = khoBoNhoAds()
    const ctx: NgCanhAds = { prisma, kho, taoFb, bayGio: () => bayGio }
    tokens = o.coToken === false ? [] : [{ fbUserId: 'U1', name: 'Chủ shop', accessToken: USER_TOKEN, scopes: '["ads_read","ads_management"]', tokenExpiresAt: null }]
    await kho.luuCauHinh({ ...(await docCauHinhAds(ctx)), adAccountId: o.act === undefined ? ACT : o.act, fbUserId: o.coToken === false ? null : 'U1' })
    if (o.pilot !== false) {
        kho._keHoach.push(
            { id: 'plan-1', kind: 'boost', status: 'succeeded', idempotencyKey: null, data: { adAccountId: ACT, sku: 'KHOAN10', name: 'Mũi khoan lệch tâm 10mm' }, result: { campaignId: C.c1, adsetId: '230000000000011', adId: '340000000000111' }, createdBy: null, createdAt: NOW - 3 * NGAY, updatedAt: NOW - 3 * NGAY },
            { id: 'plan-2', kind: 'boost', status: 'succeeded', idempotencyKey: null, data: { adAccountId: ACT2, sku: 'OC4', name: 'Ổ cắm' }, result: { campaignId: C.cp }, createdBy: null, createdAt: NOW - 30 * NGAY, updatedAt: NOW - 30 * NGAY },
        )
    }
    return ctx
}
async function doc(ctx: NgCanhAds, q: any) { const r = await docDrillAds(ctx, q); ra.push(r); return r }
const datLai = () => { xoaDemDrill(); goi = []; bayGio = NOW; honHop = false; loiToken = false; gioiHanCon = false }
const coXinReach = (g: any) => String(g?.params?.fields || '').split(',').includes('reach')

async function main() {
    // ── 1. Hàm thuần ──────────────────────────────────────────────────────────
    const T = (s: string) => tinhVN(s)
    dung('1a. "Ho Chi Minh City" → TP. Hồ Chí Minh', T('Ho Chi Minh City')?.ten === 'TP. Hồ Chí Minh' && T('Ho Chi Minh City')?.moi === 'TP. Hồ Chí Minh')
    dung('1a. "Binh Duong Province" / "Ba Ria–Vung Tau Province" → gộp TP. Hồ Chí Minh', T('Binh Duong Province')?.ten === 'Bình Dương' && T('Binh Duong Province')?.moi === 'TP. Hồ Chí Minh' && T('Ba Ria–Vung Tau Province')?.moi === 'TP. Hồ Chí Minh')
    dung('1a. "Thua Thien–Hue Province" → Thừa Thiên Huế, gộp Huế; "Hue" → Huế', T('Thua Thien–Hue Province')?.ten === 'Thừa Thiên Huế' && T('Thua Thien–Hue Province')?.moi === 'Huế' && T('Hue')?.ten === 'Huế')
    dung('1a. "Hà Tĩnh" / "Tỉnh Hà Tĩnh" / "Ha Tinh Province" KHÔNG thành "Hà"', T('Hà Tĩnh')?.ten === 'Hà Tĩnh' && T('Tỉnh Hà Tĩnh')?.ten === 'Hà Tĩnh' && T('Ha Tinh Province')?.ten === 'Hà Tĩnh' && khoaTinh('Hà Tĩnh') === 'hatinh')
    dung('1a. "Thành phố Hồ Chí Minh" / "TP. HCM" / "Hanoi" / "Đắk Lắk" / "Dak Lak"', T('Thành phố Hồ Chí Minh')?.ten === 'TP. Hồ Chí Minh' && T('TP. HCM')?.ten === 'TP. Hồ Chí Minh' && T('Hanoi')?.ten === 'Hà Nội' && T('Đắk Lắk')?.ten === 'Đắk Lắk' && T('Dak Lak')?.ten === 'Đắk Lắk')
    dung('1a. "Hà Nam" ≠ "Hà Nội"; "Kon Tum" gộp Quảng Ngãi; "Quang Nam Province" gộp Đà Nẵng', T('Ha Nam Province')?.ten === 'Hà Nam' && T('Ha Nam Province')?.moi === 'Ninh Bình' && T('Kon Tum')?.moi === 'Quảng Ngãi' && T('Quang Nam Province')?.moi === 'Đà Nẵng')
    dung('1a. tên lạ ("California", rỗng) ⇒ null, không đoán', T('California') === null && T('') === null && T('Unknown') === null)
    dung('1b. 63 tỉnh cũ → 34 đơn vị mới, không hai tỉnh trùng khoá', SO_TINH.cu === 63 && SO_TINH.moi === 34 && SO_TINH.khoa === SO_TINH.dong, JSON.stringify(SO_TINH))
    // 1c. đối chiếu đủ 23 nhóm sáp nhập + 11 giữ nguyên (Nghị quyết 202/2025/QH15, báo Nhân Dân)
    const NHOM: Record<string, string[]> = {
        'Tuyên Quang': ['Hà Giang', 'Tuyên Quang'], 'Lào Cai': ['Yên Bái', 'Lào Cai'], 'Thái Nguyên': ['Bắc Kạn', 'Thái Nguyên'],
        'Phú Thọ': ['Vĩnh Phúc', 'Hòa Bình', 'Phú Thọ'], 'Bắc Ninh': ['Bắc Giang', 'Bắc Ninh'], 'Hưng Yên': ['Thái Bình', 'Hưng Yên'],
        'Hải Phòng': ['Hải Phòng', 'Hải Dương'], 'Ninh Bình': ['Hà Nam', 'Nam Định', 'Ninh Bình'], 'Quảng Trị': ['Quảng Bình', 'Quảng Trị'],
        'Đà Nẵng': ['Đà Nẵng', 'Quảng Nam'], 'Quảng Ngãi': ['Kon Tum', 'Quảng Ngãi'], 'Gia Lai': ['Bình Định', 'Gia Lai'],
        'Khánh Hòa': ['Ninh Thuận', 'Khánh Hòa'], 'Lâm Đồng': ['Đắk Nông', 'Bình Thuận', 'Lâm Đồng'], 'Đắk Lắk': ['Phú Yên', 'Đắk Lắk'],
        'TP. Hồ Chí Minh': ['TP. Hồ Chí Minh', 'Bà Rịa – Vũng Tàu', 'Bình Dương'], 'Đồng Nai': ['Bình Phước', 'Đồng Nai'],
        'Tây Ninh': ['Long An', 'Tây Ninh'], 'Cần Thơ': ['Cần Thơ', 'Sóc Trăng', 'Hậu Giang'], 'Vĩnh Long': ['Bến Tre', 'Trà Vinh', 'Vĩnh Long'],
        'Đồng Tháp': ['Tiền Giang', 'Đồng Tháp'], 'Cà Mau': ['Bạc Liêu', 'Cà Mau'], 'An Giang': ['Kiên Giang', 'An Giang'],
    }
    const GIU = ['Cao Bằng', 'Điện Biên', 'Hà Tĩnh', 'Lai Châu', 'Lạng Sơn', 'Nghệ An', 'Quảng Ninh', 'Thanh Hóa', 'Sơn La', 'Hà Nội']
    const saiNhom = Object.entries(NHOM).flatMap(([moi, ds]) => ds.filter(t => T(t)?.moi !== moi).map(t => `${t}→${T(t)?.moi}≠${moi}`))
    const saiGiu = GIU.filter(t => T(t)?.moi !== t).concat(T('Thừa Thiên Huế')?.moi === 'Huế' ? [] : ['Thừa Thiên Huế'])
    dung('1c. 23 nhóm sáp nhập + 11 đơn vị giữ nguyên khớp Nghị quyết 202/2025/QH15', Object.keys(NHOM).length === 23 && !saiNhom.length && !saiGiu.length, [...saiNhom, ...saiGiu].join('; '))

    const hn = '2026-11-05'
    const k7 = giaiKhoang({ preset: 'last_7d' }, hn)
    dung('1d. "7 ngày qua" = 29/10 → 04/11 (không gồm hôm nay, như Trình quản lý quảng cáo)', k7.since === '2026-10-29' && k7.until === '2026-11-04' && k7.days === 7, JSON.stringify(k7))
    const kThang = giaiKhoang({ preset: 'last_month' }, hn), kNay = giaiKhoang({ preset: 'this_month' }, hn)
    dung('1d. tháng trước = 01/10 → 31/10; tháng này = 01/11 → hôm nay', kThang.since === '2026-10-01' && kThang.until === '2026-10-31' && kNay.since === '2026-11-01' && kNay.until === hn)
    dung('1d. mặc định = 7 ngày qua; toàn bộ thời gian không có ngày', giaiKhoang({}, hn).preset === 'last_7d' && giaiKhoang({ preset: 'maximum' }, hn).since === null)
    const loiNgay = await Promise.all([
        nem(async () => giaiKhoang({ since: '2026-02-30', until: '2026-03-01' }, hn)), nem(async () => giaiKhoang({ since: '2026-11-03', until: '2026-11-01' }, hn)),
        nem(async () => giaiKhoang({ since: '2026-11-01', until: '2026-11-06' }, hn)), nem(async () => giaiKhoang({ since: '2023-09-01', until: '2023-09-30' }, hn)),
        nem(async () => giaiKhoang({ preset: 'last_year' }, hn)),
    ])
    dung('1d. ngày không có thật / bắt đầu sau kết thúc / sau hôm nay / quá 37 tháng / mốc lạ ⇒ báo lỗi', loiNgay.every(e => e instanceof ToolError), loiNgay.map(e => e?.message || 'KHÔNG LỖI').join(' | '))
    const kt = kyTruoc(k7, hn)
    dung('1e. kỳ trước cùng số ngày: 22/10 → 28/10; toàn bộ thời gian ⇒ không có kỳ trước', kt?.since === '2026-10-22' && kt?.until === '2026-10-28' && kyTruoc(giaiKhoang({ preset: 'maximum' }, hn), hn) === null)
    dung('1e. kỳ trước vượt 37 tháng ⇒ null', kyTruoc(giaiKhoang({ since: '2023-12-10', until: '2024-06-01' }, hn), hn) === null)
    dung('1f. hôm nay theo múi giờ TÀI KHOẢN (20:00Z ngày 04: UTC+7 ⇒ 05, UTC−8 ⇒ 04)', homNayTheoTk(Date.parse('2026-11-04T20:00:00Z'), 7) === '2026-11-05' && homNayTheoTk(Date.parse('2026-11-04T20:00:00Z'), -8) === '2026-11-04')
    dung('1f. cộng tháng cuối tháng: 31/03 − 1 tháng = 28/02', congThang('2026-03-31', -1) === '2026-02-28' && congThang('2026-11-05', -37) === '2023-10-05')
    const s1 = hoanTat(docSoDrill({ spend: '100000', impressions: '4000', reach: '2000', clicks: '40', inline_link_clicks: '10', actions: hd({ omni_purchase: 3, purchase: 3, 'offsite_conversion.fb_pixel_purchase': 3, lead: 2, comment: 4, 'onsite_conversion.messaging_conversation_started_7d': 6 }) }), 'khach_hoi')
    dung('1g. lượt mua lấy MỘT loại gộp (omni_purchase), không cộng ba lần; khách hỏi = bình luận + tin nhắn', s1.purchases === 3 && s1.leads === 2 && s1.results === 10 && s1.costPerResult === 10000 && s1.frequency === 2 && s1.cpm === 25000 && s1.ctr === 1)
    dung('1g. không có reach ⇒ null (không phải 0)', docSoDrill({ spend: '1' }, true).reach === null && docSoDrill({ spend: '1', reach: '5' }, false).reach === null)
    dung('1h. Doanh số + mục tiêu tối ưu Cuộc trò chuyện = tương tác; Doanh số trơn = chưa chắc; lưu lượng', hoMucTieu('OUTCOME_SALES', 'CONVERSATIONS') === 'tuong_tac' && hoMucTieu('OUTCOME_SALES') === null && hoMucTieu('OUTCOME_TRAFFIC') === 'luu_luong' && hoMucTieu('OUTCOME_ENGAGEMENT', 'LINK_CLICKS') === 'luu_luong')
    dung('1i. họ theo tiền chi: ≥ 80% ⇒ họ đó; 60/40 ⇒ lẫn (null)', hoTheoChi([{ ho: 'tuong_tac', spend: 85 }, { ho: 'luu_luong', spend: 15 }]) === 'tuong_tac' && hoTheoChi([{ ho: 'tuong_tac', spend: 60 }, { ho: 'luu_luong', spend: 40 }]) === null)
    {
        // 1j. so kỳ trước theo dòng — tốt / xấu theo GIÁ mỗi kết quả, không theo SỐ kết quả
        const so = (spend: number, results: number) => ({ spend, results }) as any
        const dong = (key: string, m: any, prev: any, hopLe = true) => ({ key, label: key, m, prev, hopLe })
        const xs = (rows: any[]) => xetDoiKy(rows, 'khach_hoi', 'VND')
        const dung1 = xs([dong('Tạm dừng', so(900000, 100), so(3000000, 349))])
        dung('1j. kết quả giảm 71% vì chi giảm 70% (tạm dừng giữa kỳ), giá giữ nguyên ⇒ gợi ý, KHÔNG báo xấu', dung1.length === 1 && dung1[0]!.tone === 'info' && /giảm 71%.*theo chi giảm 70%.*gần như không đổi/.test(dung1[0]!.text), JSON.stringify(dung1))
        const dat = xs([dong('Đắt lên', so(100000, 5), so(100000, 20))])
        dung('1j. cùng tiền mà kết quả giảm 75% ⇒ xấu, nói giá mỗi kết quả đắt hơn 300%', dat.length === 1 && dat[0]!.tone === 'bad' && /đắt hơn 300% \(5\.000.*20\.000/.test(dat[0]!.text), JSON.stringify(dat))
        const re = xs([dong('Rẻ đi', so(100000, 40), so(100000, 20))])
        dung('1j. cùng tiền mà kết quả tăng 100% ⇒ tốt, mỗi kết quả rẻ hơn 50%', re.length === 1 && re[0]!.tone === 'good' && /rẻ hơn 50%/.test(re[0]!.text), JSON.stringify(re))
        const loang = xs([dong('Tăng mà đắt', so(300000, 120), so(100000, 60))])
        dung('1j. kết quả tăng 100% nhưng chi gấp 3 ⇒ lưu ý (mỗi kết quả đắt hơn 50%), không khen', loang.length === 1 && loang[0]!.tone === 'warn' && /tăng 100% so với kỳ trước .60 → 120., nhưng mỗi khách hỏi đắt hơn 50%/.test(loang[0]!.text), JSON.stringify(loang))
        const giamRe = xs([dong('Cắt mạnh', so(200000, 40), so(1000000, 100))])
        dung('1j. kết quả giảm 60% vì chi giảm 80%, mỗi kết quả lại rẻ hơn ⇒ gợi ý', giamRe.length === 1 && giamRe[0]!.tone === 'info' && /theo chi giảm 80%, mỗi khách hỏi lại rẻ hơn 50%/.test(giamRe[0]!.text), JSON.stringify(giamRe))
        const bo = xs([dong('Không chi', so(0, 0), so(100000, 20)), dong('Chi mà 0', so(100000, 0), so(100000, 20)), dong('Khác họ', so(100000, 5), so(100000, 20), false), dong('Mẫu nhỏ', so(100000, 1), so(100000, 4))])
        dung('1j. bỏ qua: kỳ này không chi / chi mà 0 kết quả (đã có nhận xét riêng) / khác mục tiêu / mẫu < 5', bo.length === 0, JSON.stringify(bo))
        const nhieu = xs(['A', 'B', 'C'].map((t, n) => dong(t, so(100000, 5 - n), so(100000, 20))))
        dung('1j. mỗi giọng tối đa 2 dòng, đổi mạnh nhất trước', nhieu.length === 2 && nhieu[0]!.keys![0] === 'C' && nhieu[1]!.keys![0] === 'B', JSON.stringify(nhieu.map(h => h.keys)))
        const on = xs([dong('3 → 5', so(35390, 5), so(32280, 3)), dong('18 → 30', so(100000, 30), so(100000, 18)), dong('Nhỏ theo chi', so(35000, 5), so(20000, 3))])
        dung('1j. may rủi ⇒ im: 3 → 5 (hai kỳ < 10 kết quả — kể cả lời giải thích "theo chi"), 18 → 30 cùng tiền (giá rẻ 40% mà |z| ≈ 1,7 < 1,96)', on.length === 0, JSON.stringify(on))
        const X = dong('X', so(100000, 26), so(100000, 12)), deu = ['Đ1', 'Đ2', 'Đ3'].map(t => dong(t, so(100000, 10), so(100000, 10)))
        const x1 = xs([X]), x4 = xs([X, ...deu])
        dung('1j. Holm: 12 → 26 cùng tiền (p ≈ 3,4%) một mình ⇒ khen; cùng 3 dòng đủ mẫu khác (ngưỡng 5% / 4) ⇒ im', x1.length === 1 && x1[0]!.tone === 'good' && x4.length === 0, JSON.stringify([x1, x4]))
        // 1k. chi nhiều mà chỉ ra 1–2 kết quả (lọt giữa luật 0 kết quả và luật đắt nhất ≥ 3)
        const kk = (rows: any[]) => xetKhongKetQua(rows, 'khach_hoi', true, 'VND', 'chiến dịch')
        const it = kk([dong('Lớn', so(1000000, 100), null), dong('Kìm', so(470000, 1), null), dong('Nhỏ', so(50000, 1), null), dong('Hai', so(100000, 2), null), dong('Khác', so(900000, 1), null, false)])
        const hIt = it.find(h => /chỉ ra/.test(h.text))
        dung('1k. chi ≥ 4× giá trung bình mà 1 kết quả / ≥ 6× mà 2 kết quả ⇒ nhắc (đỏ); dưới ngưỡng / khác mục tiêu ⇒ im', it.length === 1 && hIt?.tone === 'bad' && JSON.stringify(hIt?.keys) === JSON.stringify(['Kìm', 'Hai']) && /chỉ ra 1–2 khách hỏi: Kìm \(470\.000/.test(hIt!.text) && /trung bình 1[45]\.\d{3}/.test(hIt!.text), JSON.stringify(it))
        const motDong = kk([dong('Một mình', so(470000, 1), null)])
        dung('1k. chỉ một dòng có kết quả ⇒ không có gì để so, im', motDong.length === 0, JSON.stringify(motDong))
        const khong = kk([dong('Lớn', so(1000000, 100), null), dong('Không ai', so(100000, 0), null), dong('Kìm', so(470000, 1), null)])
        dung('1k. luật 0 kết quả giữ nguyên, hai nhận xét riêng (không gộp lẫn)', khong.length === 2 && /mà chưa có khách hỏi nào: Không ai/.test(khong[0]!.text) && /chỉ ra 1 khách hỏi: Kìm/.test(khong[1]!.text), JSON.stringify(khong))
        const vang = xetKhongKetQua([dong('Lớn', so(1000000, 100), null), dong('Kìm', so(470000, 1), null)], 'khach_hoi', false, 'VND', 'chiến dịch')
        dung('1k. kết quả không khớp mục tiêu nút ⇒ vàng (lưu ý), không đỏ', vang.length === 1 && vang[0]!.tone === 'warn', JSON.stringify(vang))
        // 1l. phép kiểm may rủi chung (nhị thức chính xác) + Holm + tổng so kỳ trước + rẻ/đắt nhất + tỷ trọng
        const kh1 = kiemHaiDem(5, 100000, 20, 100000), kh2 = kiemHaiDem(20, 100000, 5, 100000), kh3 = kiemHaiDem(7, 90000, 3, 10000)
        dung('1l. kiemHaiDem: 5 với 20 kết quả cùng tiền ⇒ đắt, p = 2 × 68.406 / 2^25 (chính xác); đảo bên ⇒ rẻ, cùng p', kh1?.chieu === 'dat' && Math.abs(kh1.p - 2 * 68406 / 33554432) < 1e-9 && kh2?.chieu === 're' && Math.abs(kh2.p - kh1.p) < 1e-9, JSON.stringify([kh1, kh2]))
        dung('1l. kiemHaiDem: 7 / 10 kết quả với q = 0,9 — xấp xỉ chuẩn ra z = −2,1 nhưng p thật 14% ⇒ KHÔNG khác thật', kh3?.chieu === 'dat' && Math.abs(kh3.p - 0.1403817) < 1e-6, JSON.stringify(kh3))
        const kh4 = kiemHaiDem(4800, 100000, 5200, 100000), kh5 = kiemHaiDem(5000, 100000, 5000, 100000)
        dung('1l. kiemHaiDem: N = 10.000 không tràn số (4.800 với 5.200 ⇒ p ≈ 6,6·10⁻⁵; bằng nhau ⇒ p = 1); thiếu tiền / 0 kết quả ⇒ null', kh4 !== null && kh4.p > 1e-5 && kh4.p < 1e-4 && kh5?.p === 1 && kiemHaiDem(1, 0, 5, 100) === null && kiemHaiDem(0, 10, 0, 10) === null, JSON.stringify([kh4, kh5]))
        const hm = (ds: [string, number][], m: number) => Array.from(holm(ds.map(([x, p]) => ({ x, p })), m)).sort().join(',')
        dung('1l. Holm: 0,01 + 0,04 trên 2 phép ⇒ giữ cả hai; 0,03 + 0,04 ⇒ bỏ cả hai; 0,03 một mình ⇒ giữ, giữa 3 phép ⇒ bỏ', hm([['a', 0.01], ['b', 0.04]], 2) === 'a,b' && hm([['a', 0.03], ['b', 0.04]], 2) === '' && hm([['a', 0.03]], 1) === 'a' && hm([['a', 0.03]], 3) === '')
        const kh = { days: 7 } as any
        const tg = (m: any, p: any) => xetTong({ ...m, impressions: 0 } as any, { ...p, impressions: 0 } as any, 'khach_hoi', true, 'VND', kh).filter(h => !/^Chi (tăng|giảm)/.test(h.text))
        const tg1 = tg(so(900000, 100), so(3000000, 349))
        dung('1l. tổng: khách hỏi giảm 71% vì chi giảm 70% (giá giữ) ⇒ gợi ý, KHÔNG đỏ', tg1.length === 1 && tg1[0]!.tone === 'info' && /^Khách hỏi giảm 71% \(349 → 100\) theo chi giảm 70% — giá mỗi khách hỏi gần như không đổi \(8\.596đ → 9\.000đ\)\.$/.test(tg1[0]!.text), JSON.stringify(tg1))
        const tg2 = tg(so(100000, 25), so(100000, 50))
        dung('1l. tổng: cùng tiền mà khách hỏi 50 → 25 (p ≈ 0,5%) ⇒ đỏ, giá mỗi khách hỏi tăng 100%', tg2.length === 1 && tg2[0]!.tone === 'bad' && /^Giá mỗi khách hỏi tăng 100% \(2\.000đ → 4\.000đ\) — khách hỏi 50 → 25\.$/.test(tg2[0]!.text), JSON.stringify(tg2))
        const tg3 = tg(so(100000, 12), so(100000, 9))
        dung('1l. tổng: 9 → 12 cùng tiền (giá rẻ 25% mà p ≈ 66%) ⇒ chỉ gợi ý "còn trong vùng may rủi", không khen', tg3.length === 1 && tg3[0]!.tone === 'info' && /tăng 33% \(9 → 12\), chi gần như giữ nguyên — giá mỗi khách hỏi 11\.111đ → 8\.333đ, nhưng chênh này còn trong vùng may rủi/.test(tg3[0]!.text), JSON.stringify(tg3))
        const tg4 = tg(so(300000, 0), so(100000, 20))
        dung('1l. tổng: chi 300.000đ mà 0 khách hỏi, kỳ trước 5.000đ mỗi khách hỏi ⇒ đỏ "lẽ ra được khoảng 60"', tg4.length === 1 && tg4[0]!.tone === 'bad' && /^Chi 300\.000đ mà chưa ra khách hỏi nào — theo giá kỳ trước \(5\.000đ mỗi khách hỏi\) lẽ ra được khoảng 60\.$/.test(tg4[0]!.text), JSON.stringify(tg4))
        const tg5 = tg(so(8000, 0), so(100000, 20))
        dung('1l. tổng: chi 8.000đ (chưa tới 3 lần giá kỳ trước) mà 0 khách hỏi ⇒ im', tg5.length === 0, JSON.stringify(tg5))
        const tg6 = tg(so(150000, 30), so(100000, 22))
        dung('1l. tổng: giá đổi 10% (dưới ngưỡng 20%) ⇒ nói đúng số "nhích lên 10%", không gọi là "không đổi"', tg6.length === 1 && tg6[0]!.tone === 'info' && /^Khách hỏi tăng 36% \(22 → 30\) theo chi tăng 50% — giá mỗi khách hỏi nhích lên 10% \(4\.545đ → 5\.000đ\)\.$/.test(tg6[0]!.text), JSON.stringify(tg6))
        const nh = xs([dong('Nhích', so(300000, 60), so(100000, 22))])
        dung('1j. dòng: kết quả tăng 173% theo chi gấp 3, giá nhích lên 10% ⇒ gợi ý kèm đúng số', nh.length === 1 && nh[0]!.tone === 'info' && /theo chi tăng 200% — giá mỗi khách hỏi nhích lên 10% \(4\.545đ → 5\.000đ\)\.$/.test(nh[0]!.text), JSON.stringify(nh))
        const cp = (key: string, spend: number, results: number) => dong(key, { spend, results, costPerResult: results ? spend / results : null }, null)
        const gk = (rows: any[]) => xetGiaKetQua(rows, 'khach_hoi', true, 'VND')
        const gk1 = gk([cp('Rẻ', 100000, 20), cp('Vừa', 200000, 40), cp('Đắt', 30000, 3)])
        dung('1l. rẻ/đắt nhất: 3 khách hỏi giá gấp đôi giữa 60 khách hỏi giá 5.000đ (p ≈ 33%) ⇒ chưa khác thật, im', gk1.length === 0, JSON.stringify(gk1))
        const gk2 = gk([cp('Rẻ', 100000, 40), cp('Vừa', 200000, 40), cp('Đắt', 300000, 6)])
        dung('1l. rẻ/đắt nhất: khác thật cả hai đầu ⇒ xanh + đỏ, so với trung bình PHẦN CÒN LẠI', gk2.length === 2 && gk2[0]!.tone === 'good' && gk2[0]!.keys![0] === 'Rẻ' && /phần còn lại trung bình 10\.870đ/.test(gk2[0]!.text) && gk2[1]!.tone === 'bad' && gk2[1]!.keys![0] === 'Đắt' && /gấp 13,3 lần trung bình phần còn lại \(3\.750đ\)/.test(gk2[1]!.text), JSON.stringify(gk2))
        const gk3 = gk([cp('Rẻ', 100000, 20), cp('Vừa', 100000, 20), cp('Đắt', 160000, 16)])
        dung('1l. rẻ/đắt nhất: đắt nhất chọn ra từ 3 dòng ⇒ ngưỡng 5% / 3 — p ≈ 2,2% chưa đủ, im', gk3.length === 0, JSON.stringify(gk3))
        const tt = (rows: any[]) => xetTyTrong(rows, { spend: rows.reduce((s, r) => s + r.m.spend, 0), results: rows.reduce((s, r) => s + r.m.results, 0) } as any, 'khach_hoi', true)
        const ty1 = tt([dong('A', so(30000, 2), null), dong('B', so(70000, 10), null)])
        dung('1l. tỷ trọng: A ăn 30% tiền chi mà ra 17% khách hỏi trên 12 khách hỏi (p ≈ 51%) ⇒ may rủi, im', ty1.length === 0, JSON.stringify(ty1))
        const ty2 = tt([dong('A', so(300000, 20), null), dong('B', so(700000, 100), null)])
        dung('1l. tỷ trọng: cùng tỷ lệ trên 120 khách hỏi (p ≈ 0,1%) ⇒ khác thật: A đỏ, B xanh', ty2.some(h => h.tone === 'bad' && h.keys![0] === 'A') && ty2.some(h => h.tone === 'good' && h.keys![0] === 'B'), JSON.stringify(ty2))
        const ty3 = tt([dong('A', so(200000, 9), null), ...Array.from({ length: 8 }, (_, n) => dong(`B${n}`, so(90000, 10), null)), dong('C', so(80000, 8), null)])
        dung('1l. tỷ trọng: A ăn 20% tiền chi mà ra 9% — p ≈ 0,7% một mình thì đủ, nhưng giữa 10 dòng (Holm: 0,5%) ⇒ im', ty3.length === 0, JSON.stringify(ty3))
        const T = so(100000, 0), Tc = so(100000, 0)
        const bt = (rows: any[], truoc: any) => boTrungTong(rows, T, truoc).map((x: any) => x.key).join(',')
        dung('1l. bỏ trùng tổng: dòng ≥ 95% tiền chi CẢ HAI kỳ ⇒ bỏ; chỉ kỳ này ≥ 95% ⇒ giữ; không có kỳ trước ⇒ giữ hết', bt([dong('A', so(96000, 9), so(97000, 5)), dong('B', so(4000, 1), so(3000, 1))], Tc) === 'B' && bt([dong('A', so(96000, 9), so(50000, 5)), dong('B', so(4000, 1), so(50000, 1))], Tc) === 'A,B' && bt([dong('A', so(96000, 9), so(97000, 5))], null) === 'A')
    }

    // ── 2. Rào ────────────────────────────────────────────────────────────────
    datLai()
    let e = await nem(async () => doc(await ngCanh({ coToken: false }), {}))
    dung('2a. chưa nối token quảng cáo ⇒ từ chối, không gọi Facebook', e instanceof ToolError && /token quảng cáo/.test(e.message) && goi.length === 0, e?.message)
    datLai()
    e = await nem(async () => doc(await ngCanh({ act: null, pilot: false }), {}))
    dung('2b. chưa chọn tài khoản và không có quảng cáo Pilot ⇒ từ chối', e instanceof ToolError && /tài khoản quảng cáo/.test(e.message) && goi.length === 0, e?.message)
    datLai()
    e = await nem(async () => doc(await ngCanh(), { level: 'account', account: ACT_LA }))
    dung('2c. tài khoản không thuộc cửa hàng (token vẫn thấy) ⇒ từ chối, KHÔNG đọc gì', e instanceof ToolError && /không thuộc/.test(e.message) && goi.length === 0, `${e?.message} · ${goi.length} lời gọi`)
    datLai()
    e = await nem(async () => doc(await ngCanh(), { level: 'campaign', id: C.c9 }))
    dung('2d. chiến dịch của tài khoản lạ ⇒ từ chối sau khi đọc account_id, KHÔNG đọc số liệu', e instanceof ToolError && /không thuộc/.test(e.message) && goi.length === 1 && !goi.some(g => /insights/.test(g.path)), `${e?.message} · ${goi.map(g => g.path).join(',')}`)
    datLai()
    let r = await doc(await ngCanh(), { level: 'campaign', id: C.cp })
    dung('2e. chiến dịch Pilot ở tài khoản cũ (act_222) vẫn đọc được', r.view === 'overview' && r.account.id === ACT2 && r.node.pilot?.sku === 'OC4')
    datLai()
    const sai = await Promise.all([
        nem(async () => doc(await ngCanh(), { level: 'campaign', id: 'abc' })), nem(async () => doc(await ngCanh(), { level: 'ad', id: '12' })),
        nem(async () => doc(await ngCanh(), { level: 'campaign', id: '120000000000001/../act_999' })),
    ])
    dung('2f. mã đối tượng lạ (chữ, quá ngắn, chèn đường) ⇒ từ chối, không gọi Facebook', sai.every(x => x instanceof ToolError) && goi.length === 0, sai.map(x => x?.message).join(' | '))
    datLai()
    e = await nem(async () => doc(await ngCanh(), { breakdown: 'country' }))
    const e2 = await nem(async () => doc(await ngCanh(), { preset: 'last_year' }))
    dung('2g. kiểu chia / mốc ngày lạ ⇒ từ chối', e instanceof ToolError && /Kiểu chia/.test(e.message) && e2 instanceof ToolError, `${e?.message} | ${e2?.message}`)

    // ── 3. Tổng quan tài khoản ────────────────────────────────────────────────
    datLai()
    r = await doc(await ngCanh(), { compare: '1' })
    const hang = (id: string) => r.children?.rows?.find((x: any) => x.id === id)
    dung('3a. tổng 7 ngày: chi 550.000đ, khách hỏi 63 (bình luận 20 + tin nhắn 43)', r.totals?.spend === 550000 && r.totals?.results === 63 && r.totals?.comments === 20 && r.totals?.messages === 43, JSON.stringify(r.totals))
    dung('3a. kỳ trước 22/10 → 28/10: chi 300.000đ', r.prevRange?.since === TRUOC && r.prevTotals?.spend === 300000)
    dung('3a. kết quả tự chọn = khách hỏi (≈89% tiền chi cho mục tiêu tương tác)', r.result?.key === 'khach_hoi' && r.result.auto && r.result.matches && r.result.family === 'tuong_tac', JSON.stringify(r.result))
    dung('3b. bảng chiến dịch gồm cả cái đã lưu trữ (chỉ có trong Insights) và cái không chi', !!hang(C.c5) && hang(C.c5).name === 'Cũ đã lưu trữ' && hang(C.c5).listed === false && !!hang(C.c4) && hang(C.c4).m.spend === 0)
    const lat = goi.filter(g => g.path === `${ACT}/campaigns`)
    dung('3c. lật trang bằng cursors.after (không gọi URL paging.next — URL đó mang token)', lat.length === 2 && lat[1].params.after === 'TRANG2' && !goi.some(g => /^https?:/.test(g.path)) && !!hang(C.c8))
    dung('3d. họ mục tiêu: Doanh số + nhóm Cuộc trò chuyện = tương tác; Lưu lượng = lưu lượng', hang(C.c2)?.family === 'tuong_tac' && hang(C.c3)?.family === 'luu_luong')
    const khongKq = r.hints.find((h: any) => /chưa có khách hỏi nào/.test(h.text))
    dung('3e. "chi mà chưa có khách hỏi": kêu chiến dịch tương tác 150.000đ, KHÔNG kêu chiến dịch lưu lượng', !!khongKq && khongKq.tone === 'bad' && khongKq.keys.includes(C.c6) && !khongKq.keys.includes(C.c3), JSON.stringify(khongKq))
    const batKhongChi = r.hints.find((h: any) => /đang bật mà không chi/.test(h.text))
    dung('3f. "đang bật mà không chi": kêu cái chạy 10 ngày, không kêu cái mới tạo 2 giờ / đã hết lịch', !!batKhongChi && batKhongChi.keys.includes(C.c4) && !batKhongChi.keys.includes(C.c7) && !batKhongChi.keys.includes(C.c8), JSON.stringify(batKhongChi))
    dung('3g. dòng do Pilot tạo được đánh dấu (mã hàng)', hang(C.c1)?.pilot?.sku === 'KHOAN10' && !hang(C.c2)?.pilot)
    dung('3h. chuỗi theo ngày đủ 7 ngày, ngày không phân phối (01/11) = 0', r.series?.rows?.length === 7 && r.series.rows.find((x: any) => x.date === '2026-11-01')?.m.spend === 0 && r.series.rows[0].label === '29/10', JSON.stringify(r.series?.rows?.map((x: any) => x.date)))
    dung('3i. đổi tài khoản: liệt kê 2 tài khoản được đọc kèm tên', r.accounts?.length === 2 && r.accounts.find((a: any) => a.id === ACT2)?.name === 'TK cũ')
    dung('3j. so kỳ trước theo dòng: Pilot khách hỏi tăng 100% (10 → 20) NHỜ chi tăng 100% ⇒ chỉ gợi ý, KHÔNG khen', r.hints.some((h: any) => h.tone === 'info' && h.keys?.includes(C.c1) && /tăng 100%.*theo chi tăng 100%.*gần như không đổi/.test(h.text)) && !r.hints.some((h: any) => h.tone === 'good' && h.keys?.includes(C.c1) && /kỳ trước/.test(h.text)))
    dung('3k. tổng so kỳ trước: chi tăng 83%; khách hỏi 50 → 63 tức giá 6.000đ → 8.730đ (+45%) mà p ≈ 6% ⇒ nói số, KHÔNG tô đỏ', r.hints.some((h: any) => /Chi tăng 83%/.test(h.text)) && r.hints.some((h: any) => h.tone === 'info' && /^Khách hỏi tăng 26% \(50 → 63\) khi chi tăng 83% — giá mỗi khách hỏi 6\.000đ → 8\.730đ, nhưng chênh này còn trong vùng may rủi\.$/.test(h.text)) && !r.hints.some((h: any) => /Giá mỗi khách hỏi/.test(h.text)), JSON.stringify(r.hints.filter((h: any) => !h.keys)))
    dung('3l. bảng con thiếu 10.000đ so với tổng (chiến dịch đã xoá) ⇒ nói ra', r.notes.some((n: string) => /ít hơn số tổng 10\.000đ/.test(n)), JSON.stringify(r.notes))
    dung('3m. đường dẫn + link Trình quản lý quảng cáo', r.path?.length === 1 && r.path[0].id === ACT && /adsmanager\.facebook\.com.*act=111/.test(r.node.managerUrl))
    dung('3n. chọn "Nhấp link" ⇒ chiến dịch tương tác không bị kêu "0 lượt nhấp" ở mức đỏ', await (async () => {
        xoaDemDrill()
        const r2 = await doc(await ngCanh(), { result: 'link' })
        return r2.result.key === 'link' && !r2.result.auto && !r2.hints.some((h: any) => h.tone === 'bad' && /lượt nhấp link nào/.test(h.text))
    })())

    // ── 4. Chia theo tỉnh ─────────────────────────────────────────────────────
    datLai()
    let b = await doc(await ngCanh(), { breakdown: 'region', compare: '1' })
    const dongT = (k: string) => b.rows.find((x: any) => x.key === k)
    const hcm = dongT('TP. Hồ Chí Minh')
    dung('4a. gộp 34 tỉnh mới (mặc định): TP. Hồ Chí Minh = TP.HCM + Bình Dương + Bà Rịa – Vũng Tàu', b.grouped && hcm?.m.spend === 220000 && hcm?.m.results === 42 && ['TP. Hồ Chí Minh', 'Bình Dương', 'Bà Rịa – Vũng Tàu'].every(t => hcm.parts.includes(t)), JSON.stringify(hcm))
    dung('4a. Đà Nẵng gồm Quảng Nam; Thừa Thiên Huế → Huế; tên lạ giữ nguyên; "Unknown" → Không rõ', dongT('Đà Nẵng')?.m.spend === 40000 && dongT('Huế')?.parts?.[0] === 'Thừa Thiên Huế' && dongT('California')?.group === null && dongT('Không rõ')?.m.spend === 30000)
    dung('4a. tổng dòng = 550.000đ, người tiếp cận cộng được (mỗi người sống một tỉnh)', b.totals?.spend === 550000 && b.totals?.reach === 22000, JSON.stringify(b.totals))
    dung('4b. ghi chú: nơi SỐNG (ước tính), tên lạ được nêu', b.notes.some((n: string) => /SỐNG/.test(n)) && b.notes.some((n: string) => /California/.test(n)) && b.notes.some((n: string) => /34 tỉnh/.test(n)))
    dung('4c. tỷ trọng: Hà Nội ăn 36% tiền chi nhưng chỉ ra 8% khách hỏi (đỏ); TP.HCM ra nhiều hơn phần tiền (xanh)', b.hints.some((h: any) => h.tone === 'bad' && h.keys?.[0] === 'Hà Nội' && /36%.*8%/.test(h.text)) && b.hints.some((h: any) => h.tone === 'good' && h.keys?.[0] === 'TP. Hồ Chí Minh'), JSON.stringify(b.hints))
    dung('4c. chi mà chưa có khách hỏi: Huế 40.000đ + California 20.000đ', b.hints.some((h: any) => /chưa có khách hỏi nào/.test(h.text) && h.keys.includes('Huế') && h.keys.includes('California')))
    dung('4d. so kỳ trước theo dòng: Hà Nội khách hỏi giảm 75% (20 → 5)', dongT('Hà Nội')?.prev?.results === 20 && b.hints.some((h: any) => h.tone === 'bad' && /Hà Nội: khách hỏi giảm 75%/.test(h.text)))
    dung('4e. phần mục tiêu dùng LẠI đệm của tổng quan khi đã mở (không gọi lại danh sách)', await (async () => {
        datLai()
        const ctx = await ngCanh()
        await doc(ctx, {})
        const truocChia = goi.length
        await doc(ctx, { breakdown: 'region' })
        const moi = goi.slice(truocChia)
        return moi.length === 1 && moi[0].params.breakdowns === 'region'
    })())
    datLai()
    b = await doc(await ngCanh(), { breakdown: 'region', group: '0' })
    dung('4f. không gộp: dòng theo tên Facebook, nhãn tiếng Việt', !b.grouped && b.rows.find((x: any) => x.key === 'Binh Duong Province')?.label === 'Bình Dương' && b.rows.find((x: any) => x.key === 'Binh Duong Province')?.group === 'TP. Hồ Chí Minh')
    datLai(); honHop = true
    b = await doc(await ngCanh(), { breakdown: 'region' })
    dung('4g. tài khoản nhiều mục tiêu lẫn nhau (38% tiền cho lưu lượng) ⇒ TẮT nhận xét theo khách hỏi, nói rõ', !b.hints.some((h: any) => /khách hỏi/.test(h.text)) && b.notes.some((n: string) => /tắt nhận xét theo khách hỏi/.test(n)), JSON.stringify({ h: b.hints, n: b.notes }))
    datLai(); honHop = true
    r = await doc(await ngCanh(), {})
    dung('4g. tổng quan tài khoản lẫn mục tiêu: kết quả không "khớp", ghi chú nói rõ', r.result.family === null && !r.result.matches && r.notes.some((n: string) => /Chưa rõ mục tiêu/.test(n)))

    // ── 5. Theo giờ ───────────────────────────────────────────────────────────
    datLai()
    b = await doc(await ngCanh(), { breakdown: 'hour' })
    const gGio = goi.find(g => g.params?.breakdowns === 'hourly_stats_aggregated_by_advertiser_time_zone')
    dung('5a. đủ 24 giờ, giờ không có số = 0, KHÔNG xin người tiếp cận', b.rows.length === 24 && b.rows[3].m.spend === 40000 && b.rows[4].m.spend === 0 && !!gGio && !coXinReach(gGio) && b.totals.reach === null, `${b.rows.length} dòng · fields=${gGio?.params?.fields}`)
    dung('5b. khung giờ nhiều khách hỏi nhất: 20h, 12h, 9h (giờ tài khoản)', b.hints.some((h: any) => /20h, 12h, 9h/.test(h.text) && /Asia\/Ho_Chi_Minh/.test(h.text)), JSON.stringify(b.hints))
    datLai()
    b = await doc(await ngCanh(), { breakdown: 'hour', preset: 'maximum' })
    const b2 = await doc(await ngCanh(), { breakdown: 'hour', since: '2025-06-01', until: '2025-07-01' })
    dung('5c. theo giờ quá 13 tháng / toàn bộ thời gian ⇒ báo, KHÔNG gọi Insights theo giờ', !!b.error && /13 tháng/.test(b.error) && !!b2.error && !goi.some(g => g.params?.breakdowns?.startsWith('hourly')))

    // ── 6. Kiểu chia khác ─────────────────────────────────────────────────────
    datLai()
    b = await doc(await ngCanh(), { breakdown: 'age_gender' })
    dung('6a. tuổi × giới: nhãn tiếng Việt, xếp theo tuổi rồi Nữ → Nam', b.rows.map((x: any) => x.label).join(' | ') === '18–24 · Nữ | 25–34 · Nữ | 25–34 · Nam | 35–44 · Không rõ | Không rõ · Nữ', b.rows.map((x: any) => x.label).join(' | '))
    b = await doc(await ngCanh(), { breakdown: 'position' })
    dung('6b. vị trí: "Facebook · Bảng feed", "Instagram · Tin", "Facebook · Reels"', ['Facebook · Bảng feed', 'Instagram · Tin', 'Facebook · Reels'].every(t => b.rows.some((x: any) => x.label === t)))
    b = await doc(await ngCanh(), { breakdown: 'platform' })
    dung('6c. nền tảng: người tiếp cận có theo dòng, dòng tổng để trống (không cộng được)', b.rows[0].m.reach === 20000 && b.totals.reach === null && b.notes.some((n: string) => /không cộng được/.test(n)))
    b = await doc(await ngCanh(), { breakdown: 'device' })
    dung('6d. thiết bị Facebook trả rỗng ⇒ nói lý do (06/08/2026)', b.rows.length === 0 && b.notes.some((n: string) => /06\/08\/2026/.test(n)))
    b = await doc(await ngCanh(), { breakdown: 'day' })
    dung('6e. theo ngày: lấp ngày trống, cùng tham số với chuỗi của tổng quan (trúng đệm)', b.rows.length === 7 && b.rows.find((x: any) => x.key === '2026-11-01')?.m.spend === 0)

    // ── 7. Tầng sâu ───────────────────────────────────────────────────────────
    datLai()
    r = await doc(await ngCanh(), { level: 'campaign', id: C.c2 })
    dung('7a. chiến dịch: đường dẫn tài khoản → chiến dịch, bảng nhóm QC, ngân sách', r.path.map((x: any) => x.level).join('>') === 'account>campaign' && r.children.level === 'adset' && r.children.rows.length === 2 && r.node.dailyBudget === 200000 && /selected_campaign_ids=120000000000002/.test(r.node.managerUrl))
    dung('7a. Doanh số đo bằng tin nhắn ⇒ kết quả mặc định = khách hỏi, khớp', r.result.key === 'khach_hoi' && r.result.matches)
    r = await doc(await ngCanh(), { level: 'adset', id: A.a21 })
    const tg = r.node.targeting
    dung('7b. nhóm QC: đối tượng nhắm có tỉnh tiếng Việt, loại trừ, tuổi, giới, sở thích', tg?.places?.join(',') === 'TP. Hồ Chí Minh,Hà Nội,Biên Hòa (+10 km)' && tg.excluded?.[0] === 'Thừa Thiên Huế' && tg.ageMin === 22 && tg.gender === 'Nữ' && tg.interests[0] === 'Dụng cụ cầm tay', JSON.stringify(tg))
    dung('7b. bảng quảng cáo có ảnh; đường dẫn 3 tầng', r.children.rows[0]?.thumbnail === 'https://x/oc.jpg' && r.path.map((x: any) => x.name).join('>') === 'TK Kengi>Tin nhắn · Ổ cắm>Nhóm nữ 22–45')
    r = await doc(await ngCanh(), { level: 'ad', id: AD.ad211 })
    dung('7c. quảng cáo: đường dẫn 4 tầng, không có bảng con, ngân sách của nhóm, link xem trước', r.path.length === 4 && r.children === null && r.node.dailyBudget === 150000 && r.node.previewLink === 'https://fb.me/xem-truoc' && r.node.postId === 'PG1_55')
    r = await doc(await ngCanh(), { level: 'ad', id: AD.ad311 })
    dung('7d. quảng cáo tối ưu Lượt nhấp ⇒ kết quả mặc định = nhấp link (50.000đ / 250 lượt = 200đ)', r.result.key === 'link' && r.totals.results === 250 && r.totals.costPerResult === 200)
    e = await nem(async () => doc(await ngCanh(), { level: 'adset', id: C.c2 }))
    dung('7e. mã chiến dịch đọc như nhóm QC ⇒ "không phải nhóm quảng cáo"', e instanceof ToolError && /không phải nhóm quảng cáo/.test(e.message), e?.message)
    e = await nem(async () => doc(await ngCanh(), { level: 'campaign', id: '120000000000099' }))
    dung('7f. đối tượng không còn (#100/33) ⇒ "đã bị xoá, hoặc token không có quyền"', e instanceof ToolError && /đã bị xoá/.test(e.message), e?.message)
    b = await doc(await ngCanh(), { level: 'campaign', id: C.c2, breakdown: 'region' })
    dung('7g. chia theo tỉnh trong một chiến dịch (gọi Insights của chính chiến dịch)', b.rows[0]?.key === 'TP. Hồ Chí Minh' && goi.some(g => g.path === `${C.c2}/insights` && g.params.breakdowns === 'region'))
    r = await doc(await ngCanh(), { level: 'adset', id: A.a21, compare: '1' })
    dung('7h. nhóm QC chỉ có MỘT quảng cáo (100% tiền chi hai kỳ): giá mỗi khách hỏi giảm 50% nói ở TỔNG, không lặp ở dòng quảng cáo', r.hints.some((h: any) => h.tone === 'good' && !h.keys && /^Giá mỗi khách hỏi giảm 50% \(10\.000đ → 5\.000đ\) — khách hỏi 15 → 30\.$/.test(h.text)) && !r.hints.some((h: any) => h.keys?.includes(AD.ad211) && /kỳ trước/.test(h.text)), JSON.stringify(r.hints))

    // ── 8. Lỗi & đệm ──────────────────────────────────────────────────────────
    datLai(); gioiHanCon = true
    r = await doc(await ngCanh(), {})
    dung('8a. giới hạn lượt gọi ở bảng chiến dịch ⇒ chỉ phần đó báo lỗi, số tổng vẫn có', r.children.error === GIOI_HAN && r.totals?.spend === 550000 && r.errors.some((x: string) => x.includes('giới hạn')), JSON.stringify(r.children?.error))
    datLai(); loiToken = true
    e = await nem(async () => doc(await ngCanh(), { level: 'campaign', id: C.c2 }))
    dung('8b. token hết hạn ⇒ từ chối, nói dán token mới', e instanceof ToolError && /token/.test(e.message), e?.message)
    datLai()
    const ctx8 = await ngCanh()
    await doc(ctx8, {})
    const lan1 = goi.length
    r = await doc(ctx8, {})
    dung('8c. mở lại trong 5 phút ⇒ lấy từ đệm, không gọi Facebook', goi.length === lan1 && r.calls.goi === 0 && r.calls.dem > 0)
    r = await doc(ctx8, { fresh: '1' })
    dung('8d. Làm mới (fresh) ⇒ gọi lại Facebook', goi.length > lan1 && r.calls.goi > 0)
    const lan2 = goi.length
    bayGio = NOW + 6 * 60_000
    await doc(ctx8, {})
    dung('8e. quá 5 phút ⇒ đệm hết hạn, gọi lại', goi.length > lan2)
    datLai()
    const ctxA = await ngCanh()
    await doc(ctxA, {})
    tokens[0].accessToken = 'TOKEN-USER-KHAC-555'
    const lan3 = goi.length
    await doc(ctxA, {})
    dung('8f. đổi token (người khác dán) ⇒ không dùng đệm của token cũ', goi.length > lan3 && goi.slice(lan3).every(g => g.token === 'TOKEN-USER-KHAC-555'))

    // ── Soát chung ────────────────────────────────────────────────────────────
    dung('S1. KHÔNG một lời gọi GHI nào lên Facebook', !goi.some(g => g.method === 'post'))
    const chu = JSON.stringify(ra)
    dung('S2. kết quả gửi giao diện KHÔNG chứa token', !chu.includes(USER_TOKEN) && !chu.includes('TOKEN-USER-KHAC') && !chu.includes('accessToken'))
    dung('S3. mọi lời gọi dùng token quảng cáo của cửa hàng', goi.every(g => g.token === USER_TOKEN || g.token === 'TOKEN-USER-KHAC-555'))

    // ── 9. Nối dây (soát mã nguồn) ────────────────────────────────────────────
    const GOC = path.resolve(__dirname, '..')
    const rt = fs.readFileSync(path.join(GOC, 'src/routes/facebookPilot.ts'), 'utf8')
    dung('9a. route GET /ads/drill gắn xác thực + chặn theo tiện ích facebook_pilot, gọi docDrillAds', /router\.get\('\/ads\/drill', authMiddleware, chanChuaBat,/.test(rt) && /docDrillAds\(ngCanhAds\(req\)/.test(rt))
    const lib = fs.readFileSync(path.join(GOC, 'src/lib/facebookAdsDrill.ts'), 'utf8')
    dung('9b. lib phân tích không có lời gọi ghi (.post / ghiFb)', !/\.post\(|ghiFb|svc\.post/.test(lib))
    const pkg = JSON.parse(fs.readFileSync(path.join(GOC, 'package.json'), 'utf8'))
    dung('9c. bộ kiểm nằm trong check:all', String(pkg.scripts['check:all-goc'] || '').includes('check:facebook-ads-drill') && !!pkg.scripts['check:facebook-ads-drill'])

    console.log(`\n${dat}/${dat + loi} đạt`)
    if (loi) process.exit(1)
}

main().catch(err => { console.error(err); process.exit(1) })
