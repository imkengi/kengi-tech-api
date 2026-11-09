/* Kiểm chứng ADS PILOT — quảng cáo Facebook trong Facebook Pilot (05/11/2026) — npx tsx scripts/check-facebook-ads-pilot.ts
 *
 * Kho trong bộ nhớ + prisma giả (THEO `select`) + Facebook / Marketing API giả ghi lại MỌI lời gọi (kèm token) + đồng hồ giả.
 * Đây là TIỀN THẬT nên phần lớn ca canh "máy KHÔNG được làm gì":
 *  1. Chính sách: trần mặc định 0, ngân sách tròn nghìn / kẹp, máy mặc định chỉ được TẮT quảng cáo.
 *  2. Hàm thuần: lãi gộp (giá vốn 0 = chưa biết), giá trong bài, kết quả = bình luận + tin nhắn, phân loại lỗi Graph,
 *     token nào được "chữa" page token.
 *  3. Nối token: page token bị từ chối, thiếu quyền quảng cáo bị từ chối, token không bao giờ ra ngoài, quyền được ghi lại.
 *  4. Bài nên đẩy: chỉ bài ĐÃ LÊN, trong N ngày, chưa quảng cáo; hết hàng / giá bài lệch kho bị chặn; thiếu giá vốn / lãi
 *     thấp chỉ chặn MÁY; nối bài Kengi theo tên; xếp đủ điều kiện → bán chạy.
 *  5. Kế hoạch → thực thi: Xem trước không gọi Facebook; trần 0 chặn cả người; công thức Marketing API đúng (cờ v24/v23);
 *     chiến dịch bật SAU CÙNG; token quảng cáo cho quảng cáo, page token chỉ để đọc bài; bấm hai lần không đúp.
 *  6. Rào tiền: vượt trần / quá số quảng cáo / đọc sống hỏng ⇒ không bật; khoá tiền; tài khoản không ACTIVE / không VND.
 *  7. Hỏng giữa chừng: dựng dở ⇒ xoá chiến dịch rỗng, không bật; mất mạng sau lệnh ghi ⇒ 'uncertain'; lúc còn đọc ⇒ 'failed'.
 *  8. Chu kỳ: hết hàng / chi không ra khách ⇒ tạm dừng (kể cả chế độ Duyệt tay); người bật lại ⇒ máy không tắt lại;
 *     Duyệt tay: việc tăng chi chỉ thành nháp "CHỜ NGƯỜI DUYỆT"; Tự động: có hàng lại ⇒ chạy lại trong trần; tăng ngân sách
 *     quảng cáo tốt một lần/ngày; Insights hỏng ⇒ chỉ soát kho; trần thao tác/ngày không chặn việc tạm dừng.
 *  9. Đổi tài khoản quảng cáo: quảng cáo Pilot ở tài khoản cũ vẫn được soát + tính trần.
 * 10. Chạy theo lịch: chưa tới hẹn thì thôi; tới hẹn thì chạy, hẹn lượt kế; Xem trước không ghi Facebook.
 * 11. Trạng thái gửi giao diện KHÔNG có token; mất token vẫn liệt kê quảng cáo Pilot; kiểm kết nối chỉ đọc.
 * 12. Nối dây (soát mã nguồn): route, quyền ghi, khoá 'cycle:' không cho trình duyệt mượn, cron, migrate, chặn chữa token,
 *     bản Marketing API không phải v21.
 * 13. (09/11/2026) MỘT chiến dịch đọc hỏng (#17) không làm gãy chu kỳ: quảng cáo hết hàng ĐỌC ĐƯỢC vẫn tạm dừng; KHÔNG tăng
 *     ngân sách / chạy lại / quảng cáo mới; chiến dịch hỏng vào việc cần người + vẫn chiếm trần; người HẠ ngân sách / tạm dừng
 *     vẫn được, TĂNG thì không; lời gọi gộp lỗi quyền mà đọc lẻ được ⇒ chạy như thường.
 * 14. (10/11/2026) Số GẦN ĐÂY (AD-09): tốt trọn đời mà 8 ngày gần đây chi không ra khách / quá đắt ⇒ tạm dừng; tăng ngân sách
 *     phải tốt CẢ hai. #100/33 mập mờ (AD-08): chỉ là "đã xoá" khi đọc được tài khoản chứa nó, không thì vẫn chiếm trần + báo người.
 *     Quảng cáo bị Facebook từ chối (AD-11): vẫn giữ chỗ trong trần, không tăng chi, không tự tắt, một dòng việc cần người.
 * 15. (10/11/2026) Báo chủ shop khi máy tự tiêu tiền (AD-10): chỉ việc TĂNG chi máy TỰ làm (Tự động) mới thành một tin ngay — ngoài
 *     dấu chống lặp, kèm số THẬT đang chạy + cách thôi; báo cáo chi hôm qua mỗi ngày một tin (từ 8 giờ, chỉ lượt theo lịch): chi /
 *     kết quả CHỈ chiến dịch Pilot, việc máy tự làm tách khỏi việc người làm (kể cả người duyệt đề xuất của máy); không có gì ⇒ im
 *     mà vẫn đánh dấu; ghi tin / đọc Insights hỏng ⇒ không đánh dấu (lượt sau gửi lại); không gửi hai lần một ngày.
 */
import * as fs from 'fs'
import * as path from 'path'
import {
    khoBoNhoAds, chuanHoaChinhSachAds, chuanAct, laiGop, giaTrongBai, docSoLieu, tokenChuaDuocPage, laLoiToken, laLoiQuyen,
    noiTokenAds, luuCauHinhAds, timBaiDeDay, taoKeHoachDay, taoKeHoachDung, taoKeHoachChayLai, taoKeHoachNganSach, thucThiAds, huyKeHoachAds,
    chayChuKyAds, chayTheoLichAds, xayTrangThaiAds, kiemKetNoiAds, docCauHinhAds, lyDoDung, nganSachTang, laTangChi,
    CHINH_SACH_ADS_MAC_DINH, NGAN_SACH_TOI_THIEU, TUONG_TAC_TOI_DA, type NgCanhAds, type DichVuAds,
} from '../src/lib/facebookAdsPilot'
import { khoBoNhoFb, dauNgayVN, vnd } from '../src/lib/facebookPilot'
import { thamSoChienDichDayBai, thamSoNhomDayBai, GRAPH_ADS } from '../src/services/platforms/facebook'
import { canNguoi, baoMayTangChi } from '../src/lib/pilotBaoChuShop'
import { ToolError } from '../src/lib/mcpTypes'

let loi = 0, dat = 0
const dung = (ten: string, ok: boolean, chiTiet = '') => { ok ? dat++ : loi++; console.log(`${ok ? '✓' : '✗'} ${ten}${chiTiet && !ok ? ' — ' + chiTiet : ''}`) }
const nem = async (f: () => Promise<any>) => { try { await f(); return null } catch (e: any) { return e } }

const H = 3600_000, NGAY = 86400_000
/** 08:00 sáng hôm nay giờ VN — gần ngày thật để nhật ký ghi (đồng hồ thật) rơi đúng "hôm nay" của đồng hồ giả. */
const NOW = dauNgayVN(Date.now()) + 8 * H
let bayGio = NOW

// Token GIẢ (không mang dạng EAA… của Facebook — repo công khai, đừng để máy quét bí mật báo nhầm)
const USER_TOKEN = 'TOKEN-USER-BI-MAT-0123456789'
const PAGE_TOKEN = 'TOKEN-PAGE-BI-MAT-9876543210'

/* ── prisma giả: chỉ trả trường có trong select ── */
function chon(o: any, sel: any): any {
    if (!sel) return { ...o }
    const ra: any = {}
    for (const [k, v] of Object.entries(sel)) if (v) ra[k] = o[k]
    return ra
}
function khopChuoi(v: any, f: any): boolean {
    if (f === undefined) return true
    if (f === null || typeof f !== 'object' || f instanceof Date) return v === f || (f === null && v === undefined)
    if ('in' in f) return f.in.includes(v)
    if ('not' in f) return v !== f.not
    if ('gte' in f || 'gt' in f || 'lte' in f || 'lt' in f) {
        const n = v instanceof Date ? v.getTime() : Number(v)
        const g = (x: any) => (x instanceof Date ? x.getTime() : Number(x))
        return (f.gte === undefined || n >= g(f.gte)) && (f.gt === undefined || n > g(f.gt)) && (f.lte === undefined || n <= g(f.lte)) && (f.lt === undefined || n < g(f.lt))
    }
    return true
}
function khop(o: any, where: any): boolean {
    if (!where) return true
    for (const [k, f] of Object.entries(where)) {
        if (k === 'OR') { if (!(f as any[]).some(w => khop(o, w))) return false; continue }
        if (!khopChuoi(o[k], f)) return false
    }
    return true
}

let hang: any[] = []
let banChay: Record<string, number> = {}
let baiKengi: any[] = []
let pages: any[] = []
let tokens: any[] = []
let thongBao = 0

function datLai() {
    bayGio = NOW
    hang = [
        { id: 'p1', sku: 'KHOAN10', name: 'Mũi khoan lệch tâm 10mm', productType: 'goods', sellingPrice: 26000, stock: 40, costPrice: 15000, mergedIntoId: null, bundleId: null },
        { id: 'p2', sku: 'OC4', name: 'Ổ cắm điện 4 lỗ', productType: 'goods', sellingPrice: 189000, stock: 30, costPrice: 0, mergedIntoId: null, bundleId: null },
        { id: 'p3', sku: 'BINH', name: 'Bình giữ nhiệt', productType: 'goods', sellingPrice: 129000, stock: 2, costPrice: 80000, mergedIntoId: null, bundleId: null },
        { id: 'p4', sku: 'BUA', name: 'Búa đinh cán gỗ', productType: 'goods', sellingPrice: 75000, stock: 20, costPrice: 70000, mergedIntoId: null, bundleId: null },
        { id: 'p5', sku: 'TUA', name: 'Tua vít bake', productType: 'goods', sellingPrice: 15000, stock: 50, costPrice: 9000, mergedIntoId: null, bundleId: null },
        { id: 'p6', sku: 'KEO', name: 'Keo dán sắt', productType: 'goods', sellingPrice: 45000, stock: 25, costPrice: 20000, mergedIntoId: null, bundleId: null },
    ]
    banChay = { p2: 25, p1: 10, p6: 3 }
    baiKengi = [
        // bài Kengi khác (không qua Facebook Pilot) — nối mã theo dòng đầu = tên hàng
        { pageId: 'PG1', fbPostId: 'PG1_201', status: 'published', message: '🔹 Keo dán sắt\n💰 Giá: 45.000đ', mediaUrls: '["https://x/keo.jpg"]', scheduledAt: new Date(NOW - NGAY) },
        // bản ghi FbScheduledPost của chính bài Facebook Pilot (dangBai ghi cả hai nơi) — không được thành ứng viên đôi
        { pageId: 'PG1', fbPostId: 'PG1_101', status: 'published', message: '🔹 Mũi khoan lệch tâm 10mm\n💰 Giá: 26.000đ', mediaUrls: '[]', scheduledAt: new Date(NOW - 2 * NGAY) },
    ]
    pages = [{ pageId: 'PG1', name: 'Kengi Fanpage', avatar: null, fanCount: 1200, status: 'active', tokenExpiresAt: null, webhookSubscribed: false, autoReplyEnabled: false, accessToken: PAGE_TOKEN, adAccountId: null, createdAt: new Date(0) }]
    tokens = []
    thongBao = 0
    fbDatLai()
}

const prisma: any = {
    fbPage: {
        findMany: async ({ where, select }: any) => pages.filter(p => khop(p, where)).map(p => chon(p, select)),
        update: async ({ where, data }: any) => { const p = pages.find(x => x.pageId === where.pageId); Object.assign(p, data); return p },
    },
    fbUserToken: {
        findFirst: async ({ select }: any) => { const t = [...tokens].sort((a, b) => b.updatedAt - a.updatedAt)[0]; return t ? chon(t, select) : null },
        findUnique: async ({ where, select }: any) => { const t = tokens.find(x => x.fbUserId === where.fbUserId); return t ? chon(t, select) : null },
        upsert: async ({ where, create, update }: any) => {
            const t = tokens.find(x => x.fbUserId === where.fbUserId)
            if (t) Object.assign(t, update, { updatedAt: Date.now() }); else tokens.push({ ...create, updatedAt: Date.now() })
            return t || create
        },
    },
    product: {
        findMany: async ({ where, select }: any) => hang.filter(h => khop(h, where)).map(h => chon(h, select)),
        findUnique: async ({ where, select }: any) => { const h = hang.find(x => x.id === where.id); return h ? chon(h, select) : null },
    },
    transactionItem: {
        groupBy: async ({ where }: any) => Object.entries(banChay).filter(([id]) => (where?.productId?.in || []).includes(id)).map(([productId, q]) => ({ productId, _sum: { quantity: q } })),
        aggregate: async ({ where }: any) => ({ _sum: { quantity: banChay[where.productId] || 0 } }),
    },
    fbScheduledPost: { findMany: async ({ where, select, take }: any) => baiKengi.filter(b => khop(b, where)).slice(0, take ?? 1e9).map(b => chon(b, select)) },
    // baoChuShop: KHÔNG kéo routes/notifications vào bộ kiểm — ghi thông báo hỏng ⇒ nó giữ dấu cũ
    notification: { create: async () => { thongBao++; throw new Error('bộ kiểm không ghi thông báo') } },
}

/* ── Facebook / Marketing API giả ── */
type Goi = { m: 'get' | 'post'; p: string; q: any; token: string }
let goi: Goi[] = []
let fb: any
const loiGraph = (code: number, msg: string, subcode?: number) => Object.assign(new Error(msg), { code, subcode, fbtraceId: 'T', type: 'OAuthException' })
const loiMang = () => new Error('fetch failed')
function fbDatLai() {
    fb = {
        me: { id: 'U1', name: 'Chủ Shop', metadata: { type: 'user' } },
        debug: { scopes: ['ads_read', 'ads_management', 'pages_show_list', 'pages_read_engagement'], expires_at: Math.floor((NOW + 50 * NGAY) / 1000) } as any,
        perms: null as any,
        accounts: [{ id: 'act_111', account_id: '111', name: 'TK Kengi', account_status: 1, currency: 'VND', amount_spent: '0', balance: '0' }],
        campaigns: new Map<string, any>(),
        insights: new Map<string, { maximum?: any; today?: any; last_7d?: any; yesterday?: any }>(),
        /** đọc riêng một quảng cáo (issues_info, ad_review_feedback) — 'ad' = tiêm lỗi cho các lần đọc này */
        adsInfo: new Map<string, any>(),
        /** giả Facebook KHÔNG nhận trường ads{…} trên chiến dịch (#100 "nonexisting field") */
        khongChoAds: false,
        posts: new Map<string, any>([['PG1_101', { is_published: true }], ['PG1_102', { is_published: true }], ['PG1_201', { is_published: true }], ['PG1_104', { is_published: true }]]),
        n: 0,
        /** tiêm lỗi: buoc = đuôi đường gọi (vd 'adsets', 'ACTIVE', 'cd', 'cd:<mã>', 'bai', 'insights', 'insights:<date_preset>', 'act'); lan = số lần còn ném */
        tiem: [] as { buoc: string; loi: any; lan: number }[],
    }
}
const tiem = (buoc: string, loi: any, lan = 1) => fb.tiem.push({ buoc, loi, lan })
function nemNeuTiem(buoc: string) {
    const t = fb.tiem.find((x: any) => x.buoc === buoc && x.lan > 0)
    if (t) { t.lan--; throw t.loi }
}
/** Chiến dịch như Facebook trả — `ads` CHỈ có khi lời gọi xin trường ads{…} (Facebook thật chỉ trả trường được xin). */
const cdRa = (c: any, fields: string) => ({
    id: c.id, name: c.name, status: c.status, effective_status: c.status,
    adsets: { data: c.adsets.map((s: any) => ({ id: s.id, daily_budget: String(s.daily_budget), end_time: s.end_time, status: s.status, effective_status: s.status })) },
    ...(/(^|,)ads\{/.test(fields) ? { ads: { data: (c.ads || []).map((x: any) => ({ id: x.id, effective_status: x.effective_status })) } } : {}),
})
const taoFb = (token: string): DichVuAds => ({
    async get(p: string, q: any = {}) {
        goi.push({ m: 'get', p, q, token })
        if (p === 'me') { nemNeuTiem('me'); return fb.me }
        if (p === 'debug_token') { if (fb.debug instanceof Error) throw fb.debug; return { data: fb.debug } }
        if (p === 'me/permissions') { if (!fb.perms || fb.perms instanceof Error) throw fb.perms || loiGraph(200, 'no'); return { data: fb.perms.map((x: string) => ({ permission: x, status: 'granted' })) } }
        if (p === 'me/adaccounts') return { data: fb.accounts }
        if (/^act_\d+$/.test(p)) { nemNeuTiem('act'); const a = fb.accounts.find((x: any) => x.id === p); if (!a) throw loiGraph(100, 'Unsupported get request', 33); return a }
        if (/^act_\d+\/insights$/.test(p)) {
            nemNeuTiem('insights'); nemNeuTiem(`insights:${q.date_preset}`)
            if (q.level === 'account') return { data: [{ spend: '12345', impressions: '1000', reach: '800', clicks: '20', actions: [] }] }
            const ids: string[] = q.filtering?.[0]?.value || []
            return { data: ids.filter(id => fb.insights.get(id)?.[q.date_preset]).map(id => ({ campaign_id: id, ...fb.insights.get(id)[q.date_preset] })) }
        }
        // Facebook trả LỖI cho mọi lời gọi gốc `GET /?ids=` ở mọi phiên bản từ 27/10/2026 (changelog Graph v26.0) — giả y vậy, để mã
        // nào còn dựa vào nó là đỏ ở đây chứ không lặng lẽ mù trên prod (09/11/2026)
        if (p === '') throw loiGraph(12, '(#12) Root requests using GET /?ids= are deprecated — use per-object requests or supported batching')
        // 'cd' = mọi lần đọc lẻ; 'cd:<mã>' = chỉ chiến dịch đó (09/11/2026: một chiến dịch lỗi, các cái khác đọc được)
        if (fb.adsInfo.has(p)) { nemNeuTiem('ad'); return { id: p, ...fb.adsInfo.get(p) } }
        if (fb.campaigns.has(p)) {
            nemNeuTiem('cd'); nemNeuTiem(`cd:${p}`)
            if (fb.khongChoAds && /(^|,)ads\{/.test(String(q.fields || ''))) throw loiGraph(100, '(#100) Tried accessing nonexisting field (ads) on node type (Campaign)')
            return cdRa(fb.campaigns.get(p), String(q.fields || ''))
        }
        if (p.includes('_')) {
            const b = fb.posts.get(p); if (!b) throw loiGraph(100, 'post does not exist', 33)
            // tương tác tự nhiên đọc lẻ từng bài; 'bai' = tiêm lỗi cho các lần đọc này
            if (/reactions/.test(String(q.fields))) { nemNeuTiem('bai'); return { id: p, reactions: { summary: { total_count: p === 'PG1_201' ? 50 : 1 } }, comments: { summary: { total_count: p === 'PG1_102' ? 4 : 0 } }, shares: { count: 2 } } }
            return { id: p, ...b }
        }
        throw loiGraph(100, `Unsupported get request ${p}`, 33)
    },
    async post(p: string, q: any = {}) {
        goi.push({ m: 'post', p, q, token })
        const duoi = p.split('/').pop()!
        nemNeuTiem(q.status === 'ACTIVE' && fb.campaigns.has(p) ? 'ACTIVE' : duoi)
        if (/\/campaigns$/.test(p)) { const id = `CMP${++fb.n}`; fb.campaigns.set(id, { id, act: p.split('/')[0], name: q.name, status: q.status, adsets: [] }); return { id } }
        if (/\/adsets$/.test(p)) {
            const c = fb.campaigns.get(q.campaign_id); const id = `SET${++fb.n}`
            c.adsets.push({ id, daily_budget: q.daily_budget, end_time: new Date(q.end_time * 1000).toISOString(), status: q.status, q }); return { id }
        }
        if (/\/adcreatives$/.test(p)) return { id: `CR${++fb.n}` }
        if (/\/ads$/.test(p)) {
            const id = `AD${++fb.n}`
            const c = [...fb.campaigns.values()].find((x: any) => x.adsets.some((s: any) => s.id === q.adset_id))
            if (c) (c.ads ||= []).push({ id, effective_status: 'ACTIVE' })
            return { id }
        }
        if (fb.campaigns.has(p)) { fb.campaigns.get(p).status = q.status; return { success: true } }
        for (const c of fb.campaigns.values()) { const s = c.adsets.find((x: any) => x.id === p); if (s) { if (q.daily_budget) s.daily_budget = Number(q.daily_budget); if (q.status) s.status = q.status; return { success: true } } }
        throw loiGraph(100, `Unsupported post request ${p}`, 33)
    },
})
const ghi = () => goi.filter(g => g.m === 'post')
/** Một lượt chu kỳ — đồng hồ giả tiến 31 phút (lịch thật cách nhau ≥ 30 phút; hai kế hoạch cùng một mili-giây không có thật). */
const chuKy = (c: NgCanhAds) => { bayGio += 31 * 60_000; return chayChuKyAds(c) }

/* ── kho Facebook Pilot: bài Pilot đã đăng ── */
function khoFbMau() {
    const k = khoBoNhoFb()
    const bai = (id: string, pid: string, postId: string, luc: number, message: string, scheduledAt: number | null = null, status = 'succeeded') => k._keHoach.push({
        id, kind: 'post', status, idempotencyKey: null, createdBy: null, createdAt: luc, updatedAt: luc,
        data: { productId: pid, pageId: 'PG1', scheduledAt, message, mediaUrls: [`https://x/${pid}.jpg`], price: hang.find(h => h.id === pid)?.sellingPrice },
        result: { postId },
    })
    bai('b1', 'p1', 'PG1_101', NOW - 2 * NGAY, '🔹 Mũi khoan lệch tâm 10mm\n💰 Giá: 26.000đ\nThép gió HSS')
    bai('b2', 'p2', 'PG1_102', NOW - NGAY, '🔹 Ổ cắm điện 4 lỗ\n💰 Giá: 189.000đ')
    bai('b3', 'p3', 'PG1_103', NOW - NGAY, '🔹 Bình giữ nhiệt\n💰 Giá: 129.000đ')
    bai('b4', 'p4', 'PG1_104', NOW - 3 * NGAY, '🔹 Búa đinh cán gỗ\n💰 Giá: 75.000đ')
    bai('b5', 'p5', 'PG1_105', NOW - NGAY, '🔹 Tua vít bake\n💰 Giá: 14.000đ')
    bai('b6', 'p1', 'PG1_106', NOW - H, '🔹 Mũi khoan lệch tâm 10mm (hẹn)', NOW + NGAY)          // còn hẹn giờ
    bai('b7', 'p1', 'PG1_107', NOW - 30 * NGAY, '🔹 Mũi khoan lệch tâm 10mm (cũ)')              // quá 14 ngày
    bai('b8', 'p6', 'PG1_108', NOW - NGAY, '🔹 Keo dán sắt', null, 'failed')                       // đăng hỏng
    return k
}

function ngCanh(kho = khoBoNhoAds(), khoFb = khoFbMau()): NgCanhAds & { kho: ReturnType<typeof khoBoNhoAds> } {
    return { prisma, kho, khoFb, nguoi: 'chu@shop.vn', taoFb, bayGio: () => bayGio } as any
}
/** Nối token + chọn tài khoản + đặt chế độ / chính sách. */
async function chuanBi(ctx: NgCanhAds, mode: 'preview' | 'approve' | 'auto', policy: any = {}) {
    await noiTokenAds(ctx, { accessToken: USER_TOKEN })
    await luuCauHinhAds(ctx, { mode, policy })
    goi = []
}
/** Dựng sẵn một quảng cáo Pilot đang chạy (qua đường thật: lập + thực thi bằng người ở chế độ Duyệt tay). */
async function coQuangCao(ctx: NgCanhAds, postId = 'PG1_101', dailyBudget = 50000) {
    const cfg = await docCauHinhAds(ctx)
    const modeCu = cfg.mode
    if (modeCu === 'preview') await luuCauHinhAds(ctx, { mode: 'approve' })
    const p = await taoKeHoachDay(ctx, { postId, dailyBudget, idempotencyKey: `web:t:${postId}:${Math.random()}` })
    const r = await thucThiAds(ctx, p.id)
    if (modeCu === 'preview') await luuCauHinhAds(ctx, { mode: 'preview' })
    goi = []
    return r
}

async function main() {
    // ─── 1. Chính sách ──────────────────────────────────────────────────────────
    {
        const m = chuanHoaChinhSachAds({})
        dung('1a. trần ngân sách/ngày mặc định 0 (chưa đặt ⇒ không tiêu đồng nào)', m.dailyBudgetCap === 0)
        dung('1b. mặc định máy CHỈ được tắt quảng cáo (không tự bật / tăng / chạy lại)',
            m.automation.pauseOutOfStock && m.automation.pauseLosers && !m.automation.boostNewPosts && !m.automation.scaleWinners && !m.automation.resumeRestocked)
        const k = chuanHoaChinhSachAds({ dailyBudgetCap: '123456', budgetPerAd: 5, maxBudgetPerAd: 10, days: 1, maxActiveAds: 'x', minMarginPct: 150, ageMin: 70, ageMax: 20 })
        dung('1c. tiền tròn nghìn, ngân sách ≥ mức tối thiểu, trần 1 quảng cáo ≥ ngân sách, ≥ 2 ngày, số lạ ⇒ mặc định',
            k.dailyBudgetCap === 123000 && k.budgetPerAd === NGAN_SACH_TOI_THIEU && k.maxBudgetPerAd >= k.budgetPerAd && k.days === 2
            && k.maxActiveAds === CHINH_SACH_ADS_MAC_DINH.maxActiveAds && k.minMarginPct === 90 && k.ageMin === 65 && k.ageMax === 65, JSON.stringify(k))
    }

    // ─── 2. Hàm thuần ───────────────────────────────────────────────────────────
    {
        dung('2a. giá vốn 0 = CHƯA BIẾT lãi (không phải lãi 100%)', laiGop(100000, 0) === null && laiGop(100000, 60000) === 40)
        dung('2b. đọc giá ghi trong bài', giaTrongBai('🔹 Khoan\n💰 Giá: 26.000đ') === 26000 && giaTrongBai('Giá: 1,250,000 ₫') === 1250000 && giaTrongBai('không ghi giá') === null)
        dung('2c. mã tài khoản quảng cáo chuẩn act_<số>', chuanAct('123456') === 'act_123456' && chuanAct('act_99999') === 'act_99999' && chuanAct('abc') === null && chuanAct('') === null)
        const s = docSoLieu({ spend: '50000', actions: [{ action_type: 'comment', value: '3' }, { action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '2' }, { action_type: 'like', value: '40' }, { action_type: 'post_engagement', value: '60' }] })
        dung('2d. kết quả = bình luận + tin nhắn mới (lượt thích KHÔNG tính)', s.results === 5 && s.spend === 50000 && s.engagement === 60, JSON.stringify(s))
        dung('2e. lỗi tham số #100 (type OAuthException) KHÔNG phải lỗi token', !laLoiToken(loiGraph(100, 'Invalid parameter')) && laLoiToken(loiGraph(190, 'expired')) && laLoiQuyen(loiGraph(200, 'perm')) && laLoiQuyen(loiGraph(294, 'ads')))
        dung('2f. token nào được "chữa" page token: OAuth cũ (quyền rỗng) có; token quảng cáo thiếu quyền trang / không rõ quyền thì KHÔNG',
            tokenChuaDuocPage('[]') && tokenChuaDuocPage('["pages_show_list","pages_manage_posts","ads_management"]')
            && !tokenChuaDuocPage('["ads_read","ads_management","pages_show_list"]') && !tokenChuaDuocPage('["?"]'))
        dung('2g. việc tăng chi: đẩy bài, chạy lại, tăng ngân sách — hạ ngân sách / tạm dừng thì không',
            laTangChi({ kind: 'boost' }) && laTangChi({ kind: 'resume' }) && laTangChi({ kind: 'budget', data: { from: 50000, to: 60000 } })
            && !laTangChi({ kind: 'budget', data: { from: 60000, to: 50000 } }) && !laTangChi({ kind: 'pause' }))
        const cd = thamSoChienDichDayBai('X')
        const nh = thamSoNhomDayBai({ ten: 'X', campaignId: 'C', pageId: 'PG1', dailyBudgetVnd: 50000, batDauGiay: 1000, ketThucGiay: 1000 + 5 * 86400 })
        dung('2h. công thức Marketing API: chiến dịch TẠM DỪNG, is_adset_budget_sharing_enabled=false (v24+), special_ad_categories=[]',
            cd.status === 'PAUSED' && cd.is_adset_budget_sharing_enabled === false && Array.isArray(cd.special_ad_categories) && cd.special_ad_categories.length === 0 && cd.objective === 'OUTCOME_ENGAGEMENT')
        dung('2i. nhóm QC: advantage_audience khai rõ (v23+), promoted_object page, có giờ kết thúc, ngân sách VND nguyên số',
            nh.targeting?.targeting_automation?.advantage_audience === 0 && nh.promoted_object?.page_id === 'PG1' && nh.end_time > nh.start_time && nh.daily_budget === 50000 && !('destination_type' in nh))
        dung('2j. Marketing API KHÔNG dùng v21 (đã hết hạn cho quảng cáo)', !/v21\./.test(GRAPH_ADS), GRAPH_ADS)
    }

    // ─── 3. Nối token ───────────────────────────────────────────────────────────
    {
        datLai(); goi = []
        const ctx = ngCanh()
        fb.me = { id: 'PG1', name: 'Kengi Fanpage', metadata: { type: 'page' } }
        const e1 = await nem(() => noiTokenAds(ctx, { accessToken: PAGE_TOKEN }))
        dung('3a. page token bị từ chối (quảng cáo cần USER token), không lưu gì', e1 instanceof ToolError && /PAGE token/.test(e1.message) && tokens.length === 0, e1?.message)
        fb.me = { id: 'U1', name: 'Chủ Shop', metadata: { type: 'user' } }
        fb.debug = { scopes: ['pages_show_list', 'pages_manage_posts'] }
        const e2 = await nem(() => noiTokenAds(ctx, { accessToken: USER_TOKEN }))
        dung('3b. token thiếu quyền quảng cáo bị từ chối', e2 instanceof ToolError && /thiếu quyền quảng cáo/.test(e2.message) && tokens.length === 0, e2?.message)
        fbDatLai()
        const r = await noiTokenAds(ctx, { accessToken: USER_TOKEN })
        const cfg = await docCauHinhAds(ctx)
        dung('3c. token tốt: lưu kèm quyền, tự chọn tài khoản quảng cáo duy nhất, nhớ đúng người dán', tokens.length === 1 && /ads_management/.test(tokens[0].scopes)
            && r.adAccountId === 'act_111' && cfg.adAccountId === 'act_111' && cfg.fbUserId === 'U1' && cfg.mode === 'preview')
        dung('3d. kết quả nối KHÔNG chứa token', !JSON.stringify(r).includes(USER_TOKEN) && r.token?.canWrite === true)
        datLai()
        const ctx2 = ngCanh()
        fb.debug = loiGraph(100, 'debug_token chỉ cho nhà phát triển app')
        fb.perms = loiGraph(200, 'không đọc được quyền')
        await noiTokenAds(ctx2, { accessToken: USER_TOKEN })
        dung('3e. không đọc được quyền ⇒ ghi "?" (KHÁC rỗng) — fanpageCron không lấy token này chữa page token', tokens[0]?.scopes === '["?"]' && !tokenChuaDuocPage(tokens[0].scopes), tokens[0]?.scopes)
        datLai()
        const ctx3 = ngCanh()
        fb.accounts = []
        const e3 = await nem(() => noiTokenAds(ctx3, { accessToken: USER_TOKEN }))
        dung('3f. token không quản lý tài khoản quảng cáo nào ⇒ báo, không lưu', e3 instanceof ToolError && tokens.length === 0, e3?.message)
    }

    // ─── 4. Bài nên đẩy ─────────────────────────────────────────────────────────
    {
        datLai(); goi = []
        const ctx = ngCanh()
        await chuanBi(ctx, 'preview')
        const cfg = await docCauHinhAds(ctx)
        const { list } = await timBaiDeDay(ctx, cfg, pages[0], NOW)
        const ma = list.map(b => b.postId)
        dung('4a. chỉ bài ĐÃ LÊN, trong 14 ngày, đăng thành công; không đúp bài Pilot với bản ghi Kengi của chính nó',
            !ma.includes('PG1_106') && !ma.includes('PG1_107') && !ma.includes('PG1_108') && ma.filter(x => x === 'PG1_101').length === 1, ma.join(','))
        const b = (id: string) => list.find(x => x.postId === id)!
        dung('4b. hàng tồn dưới mức tối thiểu bị chặn (cả người lẫn máy)', !!b('PG1_103')?.reason && /Tồn kho 2/.test(b('PG1_103').reason!))
        dung('4c. giá trong bài lệch giá kho bị chặn', /14\.000đ.*15\.000đ/.test(String(b('PG1_105')?.reason)), b('PG1_105')?.reason || '')
        dung('4d. thiếu giá vốn / lãi gộp thấp CHỈ chặn máy (người vẫn lập được)',
            !b('PG1_102').reason && /giá vốn/.test(String(b('PG1_102').autoBlock)) && !b('PG1_104').reason && /Lãi gộp 6\.7%/.test(String(b('PG1_104').autoBlock)), JSON.stringify([b('PG1_102'), b('PG1_104')].map(x => x?.autoBlock)))
        dung('4e. bài Kengi khác nối mã theo dòng đầu = tên hàng', b('PG1_201')?.productId === 'p6' && b('PG1_201')?.source === 'ten' && b('PG1_201')?.priceInPost === 45000)
        dung('4f. xếp: đủ điều kiện trước (bán chạy trước), rồi chỉ-chặn-máy, rồi bị chặn', ma.slice(0, 4).join(',') === 'PG1_101,PG1_201,PG1_102,PG1_104', ma.join(','))
        dung('4g. tìm bài không gọi ghi Facebook', ghi().length === 0)

        // 09/11/2026: tương tác tự nhiên đọc LẺ từng bài — lời gọi gộp gốc ?ids= cũ bị Facebook bỏ từ 27/10/2026 (Graph giả trả #12)
        goi = []
        const tt = (await timBaiDeDay(ctx, cfg, pages[0], NOW, { tuongTac: true })).list
        const bt = (id: string) => tt.find(x => x.postId === id)
        const docBai = goi.filter((g: any) => g.m === 'get' && /^PG1_/.test(g.p) && /reactions/.test(String(g.q?.fields)))
        dung('4h. tương tác đọc lẻ từng bài, không gọi gốc ?ids=, không ghi gì: PG1_201 50 cảm xúc, PG1_102 4 bình luận',
            bt('PG1_201')?.engagement?.reactions === 50 && bt('PG1_102')?.engagement?.comments === 4 && bt('PG1_101')?.engagement?.shares === 2
            && docBai.length > 0 && docBai.length <= TUONG_TAC_TOI_DA && !goi.some((g: any) => g.p === '') && ghi().length === 0,
            `${JSON.stringify(tt.map(x => [x.postId, x.engagement]))} · ${docBai.length} lần đọc`)
        dung('4i. …và xếp hạng giữ nguyên thứ tự 4f (tương tác chỉ là tiêu chí phụ sau bán chạy)', tt.slice(0, 4).map(x => x.postId).join(',') === 'PG1_101,PG1_201,PG1_102,PG1_104', tt.map(x => x.postId).join(','))
        goi = []
        tiem('bai', loiGraph(17, '(#17) User request limit reached'), 50)
        const tt2 = (await timBaiDeDay(ctx, cfg, pages[0], NOW, { tuongTac: true })).list
        const docBai2 = goi.filter((g: any) => g.m === 'get' && /^PG1_/.test(g.p) && /reactions/.test(String(g.q?.fields)))
        dung('4j. đọc tương tác gặp hạn mức (#17) ⇒ thôi đọc sau đợt đầu (≤ 5 lời gọi), danh sách vẫn trả đủ, tương tác để trống',
            tt2.length === tt.length && tt2.every(x => x.engagement === null) && docBai2.length >= 1 && docBai2.length <= 5, `${docBai2.length} lần đọc · ${tt2.length}/${tt.length}`)
        fb.tiem = []
    }

    // ─── 5. Kế hoạch → thực thi ─────────────────────────────────────────────────
    {
        datLai(); goi = []
        const ctx = ngCanh()
        await chuanBi(ctx, 'preview', { dailyBudgetCap: 100000 })
        const p = await taoKeHoachDay(ctx, { postId: 'PG1_101', idempotencyKey: 'web:k1' })
        const r0 = await thucThiAds(ctx, p.id)
        dung('5a. Xem trước: lập nháp, thực thi KHÔNG gọi Facebook', p.status === 'draft' && r0.executed === false && goi.length === 0, JSON.stringify(goi))
        const lai = await taoKeHoachDay(ctx, { postId: 'PG1_101', idempotencyKey: 'web:k1' })
        dung('5b. cùng khoá chống trùng ⇒ đúng kế hoạch cũ', lai.id === p.id && ctx.kho._keHoach.filter(k => k.kind === 'boost').length === 1)
        const e = await nem(() => taoKeHoachDay(ctx, { postId: 'PG1_103' }))
        dung('5c. bài hàng sắp hết không lập được', e instanceof ToolError && /Tồn kho 2/.test(e.message), e?.message)
        const e2 = await nem(() => taoKeHoachDay(ctx, { postId: 'PG1_201', dailyBudget: 900000, idempotencyKey: 'web:k-x' }))
        dung('5d. ngân sách quá trần một quảng cáo bị từ chối (không kẹp lặng lẽ)', e2 instanceof ToolError && /vượt trần một quảng cáo/.test(e2.message), e2?.message)

        await luuCauHinhAds(ctx, { mode: 'approve', policy: { dailyBudgetCap: 0 } })
        goi = []
        const e3 = await nem(() => thucThiAds(ctx, p.id))
        dung('5e. trần 0 ⇒ người bấm cũng KHÔNG bật được, không gọi ghi', e3 instanceof ToolError && /Chưa đặt trần/.test(e3.message) && ghi().length === 0 && (await ctx.kho.layKeHoach(p.id))?.status === 'draft', e3?.message)

        await luuCauHinhAds(ctx, { policy: { dailyBudgetCap: 100000 } })
        goi = []
        const r = await thucThiAds(ctx, p.id)
        const w = ghi()
        dung('5f. người duyệt ⇒ thực thi xong', r.status === 'succeeded' && !!r.result?.campaignId, JSON.stringify(r.result))
        dung('5g. thứ tự: chiến dịch → nhóm → mẫu → quảng cáo → BẬT chiến dịch sau cùng',
            w.map(g => g.p.split('/').pop()).join(',') === 'campaigns,adsets,adcreatives,ads,' + r.result.campaignId && w[4].q.status === 'ACTIVE', w.map(g => `${g.p}:${g.q.status || ''}`).join(' '))
        dung('5h. chiến dịch tạo ở PAUSED với cờ v24; nhóm QC ACTIVE bên trong (một công tắc)', w[0].q.status === 'PAUSED' && w[0].q.is_adset_budget_sharing_enabled === false && w[1].q.status === 'ACTIVE')
        const nh = w[1].q
        dung('5i. nhóm QC: 50.000đ/ngày, chạy đúng 5 ngày, Việt Nam, chỉ bảng tin Facebook, advantage_audience 0, promoted_object page',
            nh.daily_budget === 50000 && nh.end_time - nh.start_time === 5 * 86400 && nh.targeting.geo_locations.countries[0] === 'VN'
            && nh.targeting.publisher_platforms.join() === 'facebook' && nh.targeting.targeting_automation.advantage_audience === 0 && nh.promoted_object.page_id === 'PG1', JSON.stringify(nh))
        dung('5j. mẫu quảng cáo đẩy đúng bài có sẵn (object_story_id)', w[2].q.object_story_id === 'PG1_101')
        dung('5k. lệnh quảng cáo dùng USER token; page token chỉ để đọc bài', w.every(g => g.token === USER_TOKEN) && goi.some(g => g.p === 'PG1_101' && g.m === 'get' && g.token === PAGE_TOKEN))
        goi = []
        const r2 = await thucThiAds(ctx, p.id)
        dung('5l. bấm thực thi lần hai ⇒ không dựng chiến dịch thứ hai', r2.status === 'succeeded' && ghi().length === 0 && fb.campaigns.size === 1)
        dung('5m. ghi nhật ký đúng một dòng boost thành công', ctx.kho._nhatKy.filter(x => x.action === 'boost' && x.status === 'succeeded').length === 1)
        const e4 = await nem(() => taoKeHoachDung(ctx, { campaignId: '999999' }))
        dung('5n. chiến dịch không do Pilot tạo ⇒ Pilot không đụng', e4 instanceof ToolError && /không do Ads Pilot tạo/.test(e4.message))
        const d = await taoKeHoachDung(ctx, { campaignId: r.result.campaignId, idempotencyKey: 'web:d1' })
        goi = []
        const rd = await thucThiAds(ctx, d.id)
        dung('5o. tạm dừng = tắt chiến dịch (một lệnh)', rd.status === 'succeeded' && ghi().length === 1 && ghi()[0].q.status === 'PAUSED' && fb.campaigns.get(r.result.campaignId).status === 'PAUSED')
        const huy = await taoKeHoachChayLai(ctx, { campaignId: r.result.campaignId, idempotencyKey: 'web:h1' })
        const daHuy = await huyKeHoachAds(ctx, huy.id)
        dung('5p. huỷ nháp được; huỷ lần hai báo lỗi', daHuy.status === 'cancelled' && (await nem(() => huyKeHoachAds(ctx, huy.id))) instanceof ToolError)
    }

    // ─── 6. Rào tiền ────────────────────────────────────────────────────────────
    {
        datLai(); goi = []
        const ctx = ngCanh()
        await chuanBi(ctx, 'approve', { dailyBudgetCap: 100000, maxActiveAds: 3, maxBudgetPerAd: 150000 })
        await coQuangCao(ctx, 'PG1_101', 50000)
        const p = await taoKeHoachDay(ctx, { postId: 'PG1_201', dailyBudget: 60000, idempotencyKey: 'web:6a' })
        const r = await thucThiAds(ctx, p.id)
        dung('6a. 50.000 đang chạy + 60.000 > trần 100.000 ⇒ không bật, không gọi ghi', r.status === 'failed' && /Vượt trần/.test(r.result?.message) && ghi().length === 0, r.result?.message)
        await luuCauHinhAds(ctx, { policy: { maxActiveAds: 1, dailyBudgetCap: 500000 } })
        const p2 = await taoKeHoachDay(ctx, { postId: 'PG1_201', dailyBudget: 50000, idempotencyKey: 'web:6b' })
        const r2 = await thucThiAds(ctx, p2.id)
        dung('6b. đủ số quảng cáo chạy cùng lúc ⇒ không bật thêm', r2.status === 'failed' && /tối đa 1 cùng lúc/.test(r2.result?.message) && ghi().length === 0, r2.result?.message)
        await luuCauHinhAds(ctx, { policy: { maxActiveAds: 3 } })
        tiem('cd', loiGraph(1, 'Lỗi Facebook tạm thời'), 1)
        const p3 = await taoKeHoachDay(ctx, { postId: 'PG1_201', dailyBudget: 50000, idempotencyKey: 'web:6c' })
        const r3 = await thucThiAds(ctx, p3.id)
        dung('6c. không đọc SỐNG được ngân sách quảng cáo đang chạy ⇒ không bật (hỏng thì đóng)', r3.status === 'failed' && /Không đọc được ngân sách/.test(r3.result?.message) && ghi().length === 0, r3.result?.message)
        fb.tiem = []
        const p4 = await taoKeHoachDay(ctx, { postId: 'PG1_201', dailyBudget: 50000, idempotencyKey: 'web:6d' })
        await ctx.kho.giuKhoaTien(bayGio, 600_000)
        const e4 = await nem(() => thucThiAds(ctx, p4.id))
        dung('6d. khoá tiền đang giữ ⇒ thao tác tăng chi thứ hai bị chặn, kế hoạch vẫn là nháp', e4 instanceof ToolError && /đang chạy/.test(e4.message) && (await ctx.kho.layKeHoach(p4.id))?.status === 'draft', e4?.message)
        await ctx.kho.traKhoaTien()
        fb.accounts[0].account_status = 3
        const r5 = await thucThiAds(ctx, p4.id)
        dung('6e. tài khoản quảng cáo không ACTIVE ⇒ không bật', r5.status === 'failed' && /chưa thanh toán/.test(r5.result?.message) && ghi().length === 0, r5.result?.message)
        const cid = [...fb.campaigns.keys()][0]
        const d = await taoKeHoachDung(ctx, { campaignId: cid, idempotencyKey: 'web:6f' })
        const rd = await thucThiAds(ctx, d.id)
        dung('6f. tài khoản có vấn đề vẫn TẠM DỪNG được', rd.status === 'succeeded' && fb.campaigns.get(cid).status === 'PAUSED')
        fb.accounts[0].account_status = 1; fb.accounts[0].currency = 'USD'
        const p6 = await taoKeHoachDay(ctx, { postId: 'PG1_201', dailyBudget: 50000, idempotencyKey: 'web:6g' })
        const r6 = await thucThiAds(ctx, p6.id)
        dung('6g. tài khoản không tính bằng VND ⇒ không bật (ngân sách Pilot tính bằng đồng)', r6.status === 'failed' && /USD/.test(r6.result?.message), r6.result?.message)
        fb.accounts[0].currency = 'VND'
        hang.find(h => h.id === 'p6')!.stock = 1
        const p7 = await taoKeHoachDay(ctx, { postId: 'PG1_201', dailyBudget: 50000, idempotencyKey: 'web:6h' }).catch(() => null)
        dung('6h. hết hàng sau khi lập ⇒ lúc lập đã bị chặn / lúc thực thi soát lại kho', p7 === null)
        hang.find(h => h.id === 'p6')!.stock = 25
        const p8 = await taoKeHoachDay(ctx, { postId: 'PG1_201', dailyBudget: 50000, idempotencyKey: 'web:6i' })
        hang.find(h => h.id === 'p6')!.stock = 1
        goi = []
        const r8 = await thucThiAds(ctx, p8.id)
        dung('6i. kế hoạch lập lúc còn hàng, thực thi lúc hết ⇒ không bật', r8.status === 'failed' && /Tồn kho còn 1/.test(r8.result?.message) && ghi().length === 0, r8.result?.message)
        hang.find(h => h.id === 'p6')!.stock = 25
        hang.find(h => h.id === 'p6')!.sellingPrice = 49000
        const p9 = await taoKeHoachDay(ctx, { postId: 'PG1_201', dailyBudget: 50000, idempotencyKey: 'web:6j' }).catch((e: any) => e)
        dung('6j. giá kho đổi so với giá ghi trong bài ⇒ không lập được', p9 instanceof ToolError && /Bài ghi giá 45\.000đ/.test(p9.message), p9?.message)

        // người bấm "Chạy lại" / "Đổi ngân sách" cũng phải qua trần LÚC THỰC THI (chu kỳ soát trước, nhưng người thì không)
        datLai(); goi = []
        const c2 = ngCanh()
        await chuanBi(c2, 'approve', { dailyBudgetCap: 100000 })
        const qa = await coQuangCao(c2, 'PG1_101', 50000)
        const dA = await taoKeHoachDung(c2, { campaignId: qa.result.campaignId, idempotencyKey: 'web:6k-d' })
        await thucThiAds(c2, dA.id)
        const qb = await coQuangCao(c2, 'PG1_201', 60000)
        const rl = await taoKeHoachChayLai(c2, { campaignId: qa.result.campaignId, idempotencyKey: 'web:6k-r' })
        goi = []
        const rr = await thucThiAds(c2, rl.id)
        dung('6k. người bật lại mà 60.000 đang chạy + 50.000 > trần 100.000 ⇒ không bật', rr.status === 'failed' && /Vượt trần/.test(rr.result?.message)
            && ghi().length === 0 && fb.campaigns.get(qa.result.campaignId).status === 'PAUSED', rr.result?.message)
        const ns = await taoKeHoachNganSach(c2, { campaignId: qb.result.campaignId, dailyBudget: 120000, idempotencyKey: 'web:6l' })
        goi = []
        const rn = await thucThiAds(c2, ns.id)
        dung('6l. người tăng ngân sách 60.000 → 120.000 > trần 100.000 ⇒ không đổi', rn.status === 'failed' && /Vượt trần/.test(rn.result?.message)
            && ghi().length === 0 && fb.campaigns.get(qb.result.campaignId).adsets[0].daily_budget === 60000, rn.result?.message)
        const ha = await taoKeHoachNganSach(c2, { campaignId: qb.result.campaignId, dailyBudget: 40000, idempotencyKey: 'web:6m' })
        const rh = await thucThiAds(c2, ha.id)
        dung('6m. HẠ ngân sách luôn được (không cần chỗ trong trần)', rh.status === 'succeeded' && fb.campaigns.get(qb.result.campaignId).adsets[0].daily_budget === 40000, JSON.stringify(rh.result))
    }

    // ─── 7. Hỏng giữa chừng ─────────────────────────────────────────────────────
    {
        datLai(); goi = []
        const ctx = ngCanh()
        await chuanBi(ctx, 'approve', { dailyBudgetCap: 200000 })
        tiem('adsets', loiGraph(100, 'Invalid parameter (targeting)'))
        const p = await taoKeHoachDay(ctx, { postId: 'PG1_101', idempotencyKey: 'web:7a' })
        const r = await thucThiAds(ctx, p.id)
        const cid = r.result?.campaignId
        dung('7a. dựng nhóm QC hỏng ⇒ xoá chiến dịch rỗng, KHÔNG bật, kế hoạch hỏng', r.status === 'failed' && r.result?.campaignDeleted === true
            && fb.campaigns.get(cid)?.status === 'DELETED' && !ghi().some(g => g.q.status === 'ACTIVE' && g.p === cid), JSON.stringify(r.result))
        const { list } = await timBaiDeDay(ctx, await docCauHinhAds(ctx), pages[0], NOW)
        dung('7b. dựng hỏng (đã dọn) ⇒ bài lại vào danh sách đẩy được', list.some(b => b.postId === 'PG1_101'))
        goi = []
        tiem('ACTIVE', loiMang())
        const p2 = await taoKeHoachDay(ctx, { postId: 'PG1_101', idempotencyKey: 'web:7c' })
        const r2 = await thucThiAds(ctx, p2.id)
        dung('7c. mất mạng lúc BẬT chiến dịch ⇒ "cần kiểm tra" (uncertain), không xoá gì', r2.status === 'uncertain' && /Mất kết nối/.test(r2.result?.message) && !ghi().some(g => g.q.status === 'DELETED'), JSON.stringify(r2.result))
        const { ads } = await import('../src/lib/facebookAdsPilot').then(m => m.docQuangCaoPilot(ctx, taoFb(USER_TOKEN), NOW, { soLieu: false }))
        dung('7d. quảng cáo "cần kiểm tra" vẫn được soát + tính trần', ads.some(a => a.campaignId === r2.result?.campaignId && a.planStatus === 'uncertain'))
        goi = []
        tiem('act', loiMang())
        const p3 = await taoKeHoachDay(ctx, { postId: 'PG1_201', idempotencyKey: 'web:7e' })
        const r3 = await thucThiAds(ctx, p3.id)
        dung('7e. mất mạng lúc còn ĐỌC (chưa lệnh ghi nào) ⇒ hỏng bình thường, không phải "cần kiểm tra"', r3.status === 'failed' && ghi().length === 0, `${r3.status} ${r3.result?.message}`)
        goi = []
        tiem('campaigns', loiGraph(190, 'Error validating access token: Session has expired'))
        const p4 = await taoKeHoachDay(ctx, { postId: 'PG1_201', idempotencyKey: 'web:7f' })
        const r4 = await thucThiAds(ctx, p4.id)
        dung('7f. token hết hạn ⇒ báo dán token mới', r4.status === 'failed' && /dán token mới/.test(r4.result?.message), r4.result?.message)
    }

    // ─── 8. Chu kỳ ──────────────────────────────────────────────────────────────
    {
        datLai(); goi = []
        const ctx = ngCanh()
        await chuanBi(ctx, 'approve', { dailyBudgetCap: 200000, maxActiveAds: 3 })
        const qc = await coQuangCao(ctx, 'PG1_101', 50000)
        const cid = qc.result.campaignId
        hang.find(h => h.id === 'p1')!.stock = 0
        const kq = await chuKy(ctx)
        dung('8a. Duyệt tay: hết hàng ⇒ máy TỰ tạm dừng (hướng giảm chi)', fb.campaigns.get(cid).status === 'PAUSED' && kq.results.some((x: any) => x.action === 'pause' && x.status === 'succeeded'), JSON.stringify(kq.results))
        // người bật lại thẳng trong Trình quản lý quảng cáo
        fb.campaigns.get(cid).status = 'ACTIVE'
        goi = []
        const kq2 = await chuKy(ctx)
        dung('8b. người bật lại sau khi máy dừng ⇒ máy KHÔNG tắt lại vì cùng lý do', ghi().length === 0 && fb.campaigns.get(cid).status === 'ACTIVE'
            && kq2.results.some((x: any) => x.action === 'pause' && x.status === 'skipped' && /có người bật lại/.test(x.message)), JSON.stringify(kq2.results))
        const st = await xayTrangThaiAds(ctx)
        dung('8c. bảng quảng cáo ghi rõ người đã bật lại', st.ads.some((a: any) => a.campaignId === cid && a.humanOverride.includes('het_ton')))

        datLai(); goi = []
        const c2 = ngCanh()
        await chuanBi(c2, 'approve', { dailyBudgetCap: 200000, stopLossVnd: 100000 })
        const q2 = await coQuangCao(c2, 'PG1_101', 50000)
        fb.insights.set(q2.result.campaignId, { maximum: { spend: '120000', actions: [{ action_type: 'like', value: '30' }] } })
        await chuKy(c2)
        const k2 = c2.kho._keHoach.find(k => k.kind === 'pause')
        dung('8d. chi 120.000đ mà 0 bình luận / tin nhắn (mức dừng 100.000đ) ⇒ tạm dừng', fb.campaigns.get(q2.result.campaignId).status === 'PAUSED' && k2?.data?.reason === 'khong_ket_qua', JSON.stringify(k2?.data))
        fb.campaigns.get(q2.result.campaignId).status = 'ACTIVE'
        c2.kho._keHoach.splice(0, c2.kho._keHoach.length, ...c2.kho._keHoach.filter(k => k.kind !== 'pause'))
        fb.insights.set(q2.result.campaignId, { maximum: { spend: '120000', actions: [{ action_type: 'comment', value: '3' }] } })
        goi = []
        await chuKy(c2)
        dung('8e. có bình luận thì không dừng', ghi().length === 0)
        tiem('insights', loiGraph(1, 'Insights tạm hỏng'), 5)
        fb.insights.set(q2.result.campaignId, { maximum: { spend: '999999', actions: [] } })
        goi = []
        const kq3 = await chuKy(c2)
        dung('8f. Insights hỏng ⇒ không dừng theo chi tiêu (không có số), báo một dòng hỏng, chu kỳ không gãy',
            ghi().length === 0 && kq3.results.some((x: any) => x.status === 'failed' && /chưa soát chi tiêu/.test(x.message)), JSON.stringify(kq3.results))
        fb.tiem = []

        // Duyệt tay + tự lập quảng cáo cho bài mới ⇒ chỉ nháp CHỜ NGƯỜI DUYỆT
        datLai(); goi = []
        const c3 = ngCanh()
        await chuanBi(c3, 'approve', { dailyBudgetCap: 200000, automation: { boostNewPosts: true } })
        const kq4 = await chuKy(c3)
        const nhap = c3.kho._keHoach.filter(k => k.kind === 'boost')
        dung('8g. Duyệt tay: máy lập nháp đẩy bài, KHÔNG gọi ghi Facebook', ghi().length === 0 && nhap.length >= 1 && nhap.every(k => k.status === 'draft'), JSON.stringify(kq4.results))
        dung('8h. máy chỉ lập cho bài đủ điều kiện (có giá vốn, đủ lãi): không lập cho OC4 (thiếu giá vốn) / BUA (lãi thấp)',
            nhap.every(k => !['OC4', 'BUA'].includes(k.data?.sku)) && nhap.some(k => k.data?.sku === 'KHOAN10'), nhap.map(k => k.data?.sku).join(','))
        dung('8i. dòng kết quả "CHỜ NGƯỜI DUYỆT" ⇒ thông báo chủ shop bắt được', kq4.results.some((x: any) => x.action === 'boost' && canNguoi(x)), JSON.stringify(kq4.results))
        goi = []
        const kq5 = await chuKy(c3)
        dung('8j. chạy lại chu kỳ: không lập nháp đôi, vẫn nhắc nháp đang chờ', c3.kho._keHoach.filter(k => k.kind === 'boost').length === nhap.length
            && kq5.results.some((x: any) => x.status === 'draft' && /CHỜ NGƯỜI DUYỆT/.test(x.message)), JSON.stringify(kq5.results))
        const daDuyet = await thucThiAds(c3, nhap[0].id)
        dung('8k. người bấm thực thi nháp máy lập ⇒ chạy', daDuyet.status === 'succeeded', JSON.stringify(daDuyet.result))

        // Tự động: có hàng lại ⇒ chạy lại trong trần
        datLai(); goi = []
        const c4 = ngCanh()
        await chuanBi(c4, 'auto', { dailyBudgetCap: 100000, automation: { resumeRestocked: true } })
        const q4 = await coQuangCao(c4, 'PG1_101', 50000)
        hang.find(h => h.id === 'p1')!.stock = 0
        await chuKy(c4)
        dung('8l. Tự động: hết hàng ⇒ tạm dừng', fb.campaigns.get(q4.result.campaignId).status === 'PAUSED')
        hang.find(h => h.id === 'p1')!.stock = 30
        await chuKy(c4)
        dung('8m. có hàng lại ⇒ máy chạy lại (đã bật "chạy lại khi có hàng")', fb.campaigns.get(q4.result.campaignId).status === 'ACTIVE')
        hang.find(h => h.id === 'p1')!.stock = 0
        await chuKy(c4)
        dung('8n. máy tự chạy lại rồi lại hết hàng ⇒ máy dừng lần nữa (không bị coi là "người bật lại")', fb.campaigns.get(q4.result.campaignId).status === 'PAUSED')
        // trần đầy ⇒ không chạy lại
        const q5 = await coQuangCao(c4, 'PG1_201', 60000)
        dung('8o. (dựng thêm quảng cáo 60.000đ)', q5.status === 'succeeded', JSON.stringify(q5.result))
        hang.find(h => h.id === 'p1')!.stock = 30
        goi = []
        const kq6 = await chuKy(c4)
        dung('8p. có hàng lại nhưng 60.000 + 50.000 > trần 100.000 ⇒ để tạm dừng, không gọi ghi', ghi().length === 0 && fb.campaigns.get(q4.result.campaignId).status === 'PAUSED'
            && kq6.results.some((x: any) => x.action === 'resume' && x.status === 'unchanged'), JSON.stringify(kq6.results))

        // Tự động: tăng ngân sách quảng cáo tốt, một lần/ngày, trong trần
        datLai(); goi = []
        const c5 = ngCanh()
        await chuanBi(c5, 'auto', { dailyBudgetCap: 200000, maxCostPerResult: 20000, maxBudgetPerAd: 150000, automation: { scaleWinners: true } })
        const q6 = await coQuangCao(c5, 'PG1_101', 50000)
        fb.insights.set(q6.result.campaignId, {
            maximum: { spend: '50000', actions: [{ action_type: 'comment', value: '6' }, { action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '4' }] },
            last_7d: { spend: '40000', actions: [{ action_type: 'comment', value: '5' }, { action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '3' }] },
        })
        await chuKy(c5)
        const nhom = fb.campaigns.get(q6.result.campaignId).adsets[0]
        dung('8q. 10 kết quả, 5.000đ/kết quả (≤ nửa mức 20.000đ), 8 ngày gần đây cũng tốt ⇒ +20%: 50.000 → 60.000', nhom.daily_budget === 60000, String(nhom.daily_budget))
        goi = []
        await chuKy(c5)
        dung('8r. cùng ngày không tăng lần hai', ghi().length === 0 && nhom.daily_budget === 60000)
        const polTang = chuanHoaChinhSachAds({ maxCostPerResult: 20000, maxBudgetPerAd: 150000, automation: { scaleWinners: true } })
        const qcTot = { life: { results: 10, spend: 50000 }, recent: { results: 10, spend: 50000 }, dailyBudget: 150000 } as any
        dung('8s. đã ở trần một quảng cáo ⇒ không tăng nữa (cùng số đó, chưa ở trần thì tăng)',
            nganSachTang(qcTot, polTang) === null && nganSachTang({ ...qcTot, dailyBudget: 100000 }, polTang) === 120000)

        // trần thao tác/ngày không chặn việc tạm dừng
        datLai(); goi = []
        const c6 = ngCanh()
        await chuanBi(c6, 'auto', { dailyBudgetCap: 200000, maxActionsPerDay: 1 })
        const q7 = await coQuangCao(c6, 'PG1_101', 50000)
        const p8 = await taoKeHoachDay(c6, { postId: 'PG1_201', idempotencyKey: 'web:8t' })
        const e8 = await nem(() => thucThiAds(c6, p8.id))
        dung('8t. hết lượt thao tác hôm nay ⇒ không bật thêm', e8 instanceof ToolError && /Đã đủ 1 thao tác/.test(e8.message), e8?.message)
        hang.find(h => h.id === 'p1')!.stock = 0
        await chuKy(c6)
        dung('8u. …nhưng VẪN tạm dừng được quảng cáo hết hàng', fb.campaigns.get(q7.result.campaignId).status === 'PAUSED')

        // Xem trước: chu kỳ chỉ lập nháp
        datLai(); goi = []
        const c7 = ngCanh()
        await chuanBi(c7, 'approve', { dailyBudgetCap: 200000 })
        const q8 = await coQuangCao(c7, 'PG1_101', 50000)
        await luuCauHinhAds(c7, { mode: 'preview' })
        hang.find(h => h.id === 'p1')!.stock = 0
        goi = []
        await chuKy(c7)
        dung('8v. Xem trước: chu kỳ không gọi ghi Facebook, chỉ lập nháp tạm dừng', ghi().length === 0 && c7.kho._keHoach.some(k => k.kind === 'pause' && k.status === 'draft'))
        await luuCauHinhAds(c7, { mode: 'approve' })
        bayGio = NOW + 5 * NGAY - H // nháp tạm dừng KHÔNG hết hạn sau 3 ngày
        await chuKy(c7)
        dung('8w. đổi khỏi Xem trước ⇒ nháp tạm dừng cũ chạy ngay (không hết hạn)', fb.campaigns.get(q8.result.campaignId).status === 'PAUSED')
        bayGio = NOW
        const qc9 = { running: true, productId: 'p1', product: { stock: 40, price: 26000, costPrice: 15000, merged: false }, priceAtBoost: null, life: { spend: 0, results: 0 } } as any
        dung('8x. bài không ghi giá ⇒ đổi giá không phải lý do dừng', lyDoDung({ ...qc9, product: { ...qc9.product, price: 99000 } }, chuanHoaChinhSachAds({})) === null)
    }

    // ─── 9. Đổi tài khoản quảng cáo ─────────────────────────────────────────────
    {
        datLai(); goi = []
        const ctx = ngCanh()
        fb.accounts.push({ id: 'act_222', account_id: '222', name: 'TK Mới', account_status: 1, currency: 'VND' })
        await noiTokenAds(ctx, { accessToken: USER_TOKEN })
        await luuCauHinhAds(ctx, { adAccountId: 'act_111', mode: 'approve', policy: { dailyBudgetCap: 100000 } })
        const q = await coQuangCao(ctx, 'PG1_101', 60000)
        await luuCauHinhAds(ctx, { adAccountId: 'act_222' })
        const p = await taoKeHoachDay(ctx, { postId: 'PG1_201', dailyBudget: 50000, idempotencyKey: 'web:9a' })
        const r = await thucThiAds(ctx, p.id)
        dung('9a. quảng cáo đang chạy ở tài khoản CŨ vẫn tính trần (60.000 + 50.000 > 100.000)', r.status === 'failed' && /Vượt trần/.test(r.result?.message), r.result?.message)
        hang.find(h => h.id === 'p1')!.stock = 0
        await chuKy(ctx)
        dung('9b. …và vẫn được tạm dừng khi hết hàng', fb.campaigns.get(q.result.campaignId).status === 'PAUSED')
        const e = await nem(() => luuCauHinhAds(ctx, { adAccountId: 'act_999' }))
        dung('9c. không chọn được tài khoản ngoài token', e instanceof ToolError)
    }

    // ─── 10. Chạy theo lịch ─────────────────────────────────────────────────────
    {
        datLai(); goi = []
        const kho = khoBoNhoAds()
        const khoFb = khoFbMau()
        const ctx = ngCanh(kho, khoFb)
        const ngoai = { taoFb, bayGio: () => bayGio, khoFb }
        dung('10a. chưa có cấu hình ⇒ không dùng', (await chayTheoLichAds(prisma, kho, ngoai)) === 'khong-dung')
        await chuanBi(ctx, 'preview')
        await luuCauHinhAds(ctx, { schedule: { enabled: true, intervalMinutes: 120 } })
        dung('10b. bật lịch ⇒ hẹn lượt kế = bây giờ + nhịp', (await kho.docCauHinh())?.nextRunAt === NOW + 120 * 60_000)
        dung('10c. chưa tới hẹn ⇒ chưa chạy', (await chayTheoLichAds(prisma, kho, ngoai)) === 'chua-toi')
        bayGio = NOW + 121 * 60_000
        const r = await chayTheoLichAds(prisma, kho, ngoai)
        const c = await kho.docCauHinh()
        dung('10d. tới hẹn ⇒ chạy, ghi kết quả, hẹn lượt kế', r === 'da-chay' && c?.lastRunAt === bayGio && c?.nextRunAt === bayGio + 120 * 60_000 && c?.lastResult?.ok === true, `${r} ${JSON.stringify(c?.lastResult).slice(0, 300)}`)
        dung('10e. lịch ở Xem trước ⇒ không gọi ghi Facebook, không báo chủ shop', ghi().length === 0 && thongBao === 0)
        dung('10f. lượt kế bị bản khác giành ⇒ không chạy đôi', !(await kho.gianhLich(NOW + 121 * 60_000, 0)))
        await luuCauHinhAds(ctx, { schedule: { enabled: false } })
        dung('10g. tắt lịch ⇒ bỏ hẹn', (await kho.docCauHinh())?.nextRunAt === null && (await chayTheoLichAds(prisma, kho, ngoai)) === 'khong-dung')
        bayGio = NOW
    }

    // ─── 11. Trạng thái + không lộ token ───────────────────────────────────────
    {
        datLai(); goi = []
        const ctx = ngCanh()
        await chuanBi(ctx, 'approve', { dailyBudgetCap: 100000 })
        await coQuangCao(ctx, 'PG1_101', 50000)
        const st = await xayTrangThaiAds(ctx)
        const json = JSON.stringify(st)
        dung('11a. trạng thái gửi giao diện KHÔNG có token quảng cáo lẫn page token', !json.includes(USER_TOKEN) && !json.includes(PAGE_TOKEN))
        dung('11b. trạng thái có quảng cáo Pilot, tổng ngân sách đang chiếm, bài nên đẩy, tài khoản', st.ads.length === 1 && st.totals?.committedDaily === 50000
            && st.candidates.length > 0 && st.account?.id === 'act_111' && st.status.token?.canWrite === true, JSON.stringify(st.totals))
        dung('11c. đọc trạng thái không gọi ghi Facebook', ghi().length === 0)
        tokens.length = 0
        const st2 = await xayTrangThaiAds(ctx)
        dung('11d. mất token mà còn quảng cáo Pilot ⇒ VẪN liệt kê (không đọc được trạng thái), báo nối token', st2.ads.length === 1 && st2.ads[0].status === null && /Chưa nối token/.test(st2.status.notice || ''), JSON.stringify(st2.status))
        datLai(); goi = []
        const c2 = ngCanh()
        await chuanBi(c2, 'approve')
        const kn = await kiemKetNoiAds(c2)
        dung('11e. kiểm kết nối chỉ ĐỌC, đủ bước, đạt hết khi mọi thứ ổn', ghi().length === 0 && kn.tong >= 6 && kn.dat === kn.tong, JSON.stringify(kn.buoc.filter((b: any) => !b.ok)))
        pages[0].status = 'token_expired'
        const kn2 = await kiemKetNoiAds(c2)
        dung('11f. page token hết hạn ⇒ bước fanpage báo hỏng', kn2.buoc.some((b: any) => /Fanpage/.test(b.ten) && !b.ok))
        // Tài khoản đã chọn không bật được quảng cáo ⇒ báo NGAY đầu tab (đừng để người lập xong, bấm thực thi mới biết)
        datLai(); goi = []
        const c3 = ngCanh()
        await chuanBi(c3, 'approve', { dailyBudgetCap: 100000 })
        dung('11g. tài khoản ổn ⇒ không có cảnh báo đầu tab', !(await xayTrangThaiAds(c3)).status.notice)
        fb.accounts[0].currency = 'USD'
        const st3 = await xayTrangThaiAds(c3)
        dung('11h. tài khoản đã chọn tính bằng USD ⇒ cảnh báo đầu tab, chỉ chỗ đổi', /USD/.test(st3.status.notice || '') && /Chính sách quảng cáo/.test(st3.status.notice || ''), st3.status.notice)
        fb.accounts[0].currency = 'VND'; fb.accounts[0].account_status = 2
        dung('11i. tài khoản bị vô hiệu ⇒ cảnh báo đầu tab', /không bật quảng cáo được/.test((await xayTrangThaiAds(c3)).status.notice || ''))
        fb.accounts.length = 0
        const st4 = await xayTrangThaiAds(c3)
        dung('11j. token không còn thấy tài khoản đã chọn ⇒ cảnh báo đầu tab', /không thấy tài khoản act_111/.test(st4.status.notice || ''), st4.status.notice)
        dung('11k. đọc trạng thái các ca trên không gọi ghi Facebook', ghi().length === 0)
        datLai(); goi = []
        const c4 = ngCanh()
        await chuanBi(c4, 'approve')
        fb.accounts[0].currency = 'USD'
        const kn3 = await kiemKetNoiAds(c4)
        const ins = kn3.buoc.find((b: any) => /Insights/.test(b.ten))
        dung('11l. kiểm kết nối tài khoản USD ⇒ bước tiền tệ hỏng, số chi ghi USD (không ghi "đ")',
            kn3.buoc.some((b: any) => /Tiền tệ/.test(b.ten) && !b.ok) && /USD$/.test(ins?.chiTiet || ''), ins?.chiTiet)
    }

    // ─── 12. Nối dây (soát mã nguồn) ───────────────────────────────────────────
    {
        const goc = path.join(__dirname, '..', 'src')
        const doc = (f: string) => fs.readFileSync(path.join(goc, f), 'utf8').replace(/\r\n/g, '\n')
        const rt = doc('routes/facebookPilot.ts')
        dung('12a. route /ads/state + /ads/:action gắn, chặn theo tiện ích facebook_pilot',
            /router\.get\('\/ads\/state', authMiddleware, chanChuaBat/.test(rt) && /router\.post\('\/ads\/:action', authMiddleware, chanChuaBat/.test(rt))
        const khoiAds = rt.slice(rt.indexOf('const VIEC_ADS'))
        const ghiDu = ['cycle', 'execute', 'boost', 'pause', 'resume', 'budget', 'cancel', 'config', 'token'].every(v => new RegExp(`(^|\\s|')${v}'?: \\{\\s*ghi: true`, 'm').test(khoiAds))
        dung('12b. mọi thao tác ghi quảng cáo đánh dấu ghi: true (quản lý mới được)', ghiDu && /connection: \{ ghi: false/.test(khoiAds))
        dung('12c. khoá "cycle:" từ trình duyệt bị đổi thành "web:" (không giả được việc của máy)', /startsWith\('cycle:'\) \? `web:\$\{v\}`/.test(rt) && (khoiAds.match(/khoaWeb\(b\?\.idempotencyKey\)/g) || []).length >= 4)
        const cron = doc('cron/aiAgentCron.ts')
        dung('12d. lịch quảng cáo chỉ chạy cửa hàng đã bật facebook_pilot, giữ client suốt lượt',
            /includes\(TIEN_ICH_FACEBOOK_PILOT\)\) \{\s*const nha = giuClient\(store\.schema\)\s*try \{\s*const kq = await chayTheoLichAds\(/.test(cron))
        dung('12e. /admin/migrate tạo bảng Ads Pilot', /for \(const sql of SQL_TAO_BANG_ADS_PILOT\)/.test(doc('routes/admin.ts')))
        const fc = doc('cron/fanpageCron.ts')
        dung('12f. fanpageCron chỉ "chữa" page token bằng user token có quyền trang', /tokenChuaDuocPage\(t\.scopes\)/.test(fc) && !/fbUserToken\.findFirst\(\{ orderBy: \{ updatedAt: 'desc' \} \}\)/.test(fc))
        const pk = fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')
        dung('12g. check:facebook-ads-pilot nằm trong check:all-goc', /"check:facebook-ads-pilot": "npx tsx scripts\/check-facebook-ads-pilot\.ts"/.test(pk) && /check:all-goc"[^\n]*npm run check:facebook-ads-pilot/.test(pk))
        const lib = doc('lib/facebookAdsPilot.ts')
        dung('12h. Ads Pilot không gọi Promise.all với prisma (pool 1 kết nối trên prod)', !/Promise\.all\(/.test(lib))
    }

    // ─── 13. Một chiến dịch đọc hỏng — chỉ chặn TĂNG chi, không chặn tạm dừng (09/11/2026) ─────────
    {
        datLai(); goi = []
        const ctx = ngCanh()
        await chuanBi(ctx, 'auto', {
            dailyBudgetCap: 400000, maxActiveAds: 5, maxCostPerResult: 20000, maxBudgetPerAd: 150000,
            automation: { resumeRestocked: true, scaleWinners: true, boostNewPosts: false },
        })
        const qA = await coQuangCao(ctx, 'PG1_104', 50000) // BUA — sẽ KHÔNG đọc được
        const qB = await coQuangCao(ctx, 'PG1_201', 50000) // KEO — đọc được, sắp hết hàng ⇒ phải tạm dừng
        const qC = await coQuangCao(ctx, 'PG1_102', 50000) // OC4 — đọc được, quảng cáo tốt ⇒ bình thường được tăng ngân sách
        const qD = await coQuangCao(ctx, 'PG1_101', 50000) // KHOAN10 — Pilot đã dừng vì hết hàng, nay có hàng ⇒ bình thường chạy lại
        const [A, B, C, D] = [qA, qB, qC, qD].map(q => String(q.result?.campaignId))
        hang.find(h => h.id === 'p1')!.stock = 0
        await chuKy(ctx)
        dung('13a. (dựng) 4 quảng cáo; KHOAN10 hết hàng ⇒ Pilot tạm dừng', [qA, qB, qC, qD].every(q => q.status === 'succeeded') && fb.campaigns.get(D).status === 'PAUSED',
            [qA, qB, qC, qD].map(q => q.status).join(','))
        hang.find(h => h.id === 'p1')!.stock = 30
        hang.find(h => h.id === 'p6')!.stock = 0
        fb.insights.set(C, {
            maximum: { spend: '50000', actions: [{ action_type: 'comment', value: '6' }, { action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '4' }] },
            last_7d: { spend: '50000', actions: [{ action_type: 'comment', value: '6' }, { action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '4' }] },
        })
        await luuCauHinhAds(ctx, { policy: { automation: { boostNewPosts: true } } })
        // riêng chiến dịch A đọc hỏng #17 suốt lượt (các chiến dịch khác đọc lẻ được)
        tiem(`cd:${A}`, loiGraph(17, '(#17) User request limit reached'), 50)
        const soChienDich = fb.campaigns.size
        goi = []
        const kq = await chuKy(ctx)
        dung('13b. vẫn TẠM DỪNG quảng cáo hết hàng đọc được (KEO) dù chiến dịch khác không đọc được',
            fb.campaigns.get(B).status === 'PAUSED' && kq.results.some((x: any) => x.action === 'pause' && x.status === 'succeeded' && x.sku === 'KEO'), JSON.stringify(kq.results))
        dung('13c. KHÔNG tăng chi: không tăng ngân sách (OC4), không chạy lại (KHOAN10), không lập quảng cáo mới — lệnh ghi duy nhất là tạm dừng KEO',
            fb.campaigns.get(C).adsets[0].daily_budget === 50000 && fb.campaigns.get(D).status === 'PAUSED' && fb.campaigns.size === soChienDich
            && ghi().length === 1 && ghi()[0].p === B && ghi()[0].q.status === 'PAUSED'
            && kq.results.some((x: any) => x.action === 'budget' && x.status === 'unchanged') && kq.results.some((x: any) => x.action === 'resume' && x.status === 'unchanged')
            && kq.results.some((x: any) => x.action === 'boost' && x.status === 'skipped'), JSON.stringify(ghi()))
        dung('13d. chiến dịch không đọc được ⇒ một dòng việc cần người (báo chủ shop), nêu đúng chiến dịch',
            kq.results.some((x: any) => x.action === 'ads' && x.sku === 'BUA' && canNguoi(x) && x.message.includes(A) && /#17|request limit/i.test(x.message)), JSON.stringify(kq.results.filter((x: any) => x.action === 'ads')))
        const st = await xayTrangThaiAds(ctx)
        const a = st.ads.find((x: any) => x.campaignId === A)
        dung('13e. trạng thái: chiến dịch hỏng status null + lý do, VẪN chiếm trần (BUA 50.000 + OC4 50.000 đang chạy)',
            a?.status === null && /request limit/i.test(a?.readError || '') && st.totals?.committedDaily === 100000 && /1\/4 chiến dịch/.test(st.liveError || ''),
            `${a?.status} ${a?.readError} ${JSON.stringify(st.totals)} ${st.liveError}`)
        const ha = await thucThiAds(ctx, (await taoKeHoachNganSach(ctx, { campaignId: C, dailyBudget: 40000, idempotencyKey: 'web:13f-ha' })).id)
        const tang = await thucThiAds(ctx, (await taoKeHoachNganSach(ctx, { campaignId: C, dailyBudget: 60000, idempotencyKey: 'web:13f-tang' })).id)
        dung('13f. người HẠ ngân sách vẫn được; TĂNG thì không (còn chiến dịch không đọc được)',
            ha.status === 'succeeded' && tang.status === 'failed' && /không TĂNG/.test(tang.result?.message || '') && fb.campaigns.get(C).adsets[0].daily_budget === 40000,
            `${ha.status} ${tang.status} ${tang.result?.message}`)
        const nsA = await thucThiAds(ctx, (await taoKeHoachNganSach(ctx, { campaignId: A, dailyBudget: 40000, idempotencyKey: 'web:13g-ns' })).id)
        const dungA = await thucThiAds(ctx, (await taoKeHoachDung(ctx, { campaignId: A, idempotencyKey: 'web:13g-dung' })).id)
        dung('13g. chiến dịch không đọc được: không đổi ngân sách (không biết số sống) nhưng người TẠM DỪNG được',
            nsA.status === 'failed' && /không đổi ngân sách/.test(nsA.result?.message || '') && dungA.status === 'succeeded' && fb.campaigns.get(A).status === 'PAUSED',
            `${nsA.status} ${nsA.result?.message} · ${dungA.status}`)

        // hết lỗi ⇒ chu kỳ chạy như thường, và KHÔNG còn lời gọi gộp gốc ?ids= nào (Facebook bỏ từ 27/10/2026 — Graph giả trả lỗi #12)
        fb.tiem = []
        goi = []
        const kq2 = await chuKy(ctx)
        dung('13h. đọc lẻ được ⇒ chạy như thường: chạy lại KHOAN10 (có hàng lại), tăng ngân sách OC4, không dòng "không đọc được", không gọi gốc ?ids=',
            fb.campaigns.get(D).status === 'ACTIVE' && fb.campaigns.get(C).adsets[0].daily_budget > 40000
            && !kq2.results.some((x: any) => x.action === 'ads' && x.status === 'failed') && !goi.some((g: any) => g.p === ''), JSON.stringify(kq2.results))
        fb.tiem = []
    }

    // ─── 14. (10/11/2026) Số gần đây (AD-09) · #100/33 mập mờ (AD-08) · quảng cáo bị từ chối (AD-11) ─────────
    {
        const pol = chuanHoaChinhSachAds({ stopLossVnd: 100000, maxCostPerResult: 20000, maxBudgetPerAd: 150000, automation: { scaleWinners: true } })
        const sl = (spend: number, results: number) => ({ spend, impressions: 0, reach: 0, clicks: 0, comments: results, messages: 0, engagement: 0, results })
        const qcMau = (life: any, recent: any, them: any = {}) => ({ running: true, productId: null, product: null, priceAtBoost: null, dailyBudget: 50000, life, recent, deliveryIssue: null, ...them }) as any
        const TOT = sl(300000, 30) // trọn đời 10.000đ / kết quả (mức 20.000đ)
        dung('14a. (chính sách) mặc định vẫn bật "dừng quảng cáo lỗ"', pol.automation.pauseLosers === true && pol.automation.scaleWinners === true)
        const r1 = lyDoDung(qcMau(TOT, sl(120000, 0)), pol)
        dung('14b. trọn đời tốt nhưng 8 ngày gần đây chi 120.000đ mà 0 kết quả (mức dừng 100.000đ) ⇒ tạm dừng "không ra kết quả", lời nêu 8 ngày gần đây',
            r1?.reason === 'khong_ket_qua' && /8 ngày gần đây/.test(r1.text) && /120\.000/.test(r1.text), JSON.stringify(r1))
        const r2 = lyDoDung(qcMau(TOT, sl(90000, 3)), pol)
        dung('14c. trọn đời tốt nhưng 8 ngày gần đây 30.000đ / kết quả (chi 90.000đ ≥ 3 × mức) ⇒ tạm dừng "đắt"',
            r2?.reason === 'dat' && /8 ngày gần đây/.test(r2.text) && /30\.000/.test(r2.text), JSON.stringify(r2))
        const phaiIm: [string, any][] = [
            ['gần đây chi 50.000đ, 0 kết quả (dưới mức dừng)', qcMau(TOT, sl(50000, 0))],
            ['gần đây 50.000đ / 1 kết quả nhưng mới chi < 3 × mức', qcMau(TOT, sl(50000, 1))],
            ['gần đây đúng bằng mức (60.000đ / 3 = 20.000đ)', qcMau(TOT, sl(60000, 3))],
            ['thiếu số gần đây ⇒ chỉ xét trọn đời', qcMau(TOT, undefined)],
            ['mức dừng 0 ⇒ không dừng theo chi tiêu', null],
        ]
        const imHet = phaiIm.every(([, a]) => a === null
            ? lyDoDung(qcMau(TOT, sl(500000, 0)), chuanHoaChinhSachAds({ stopLossVnd: 0, maxCostPerResult: 0 })) === null
            : lyDoDung(a, pol) === null)
        dung('14d. phải im: ' + phaiIm.map(([t]) => t).join(' · '), imHet,
            phaiIm.map(([t, a]) => `${t}: ${JSON.stringify(a === null ? null : lyDoDung(a, pol))}`).join(' | '))
        dung('14e. Insights hỏng (coSoLieu false) ⇒ số gần đây xấu cũng không dừng theo chi tiêu', lyDoDung(qcMau(TOT, sl(500000, 0)), pol, false) === null)
        const tang = (life: any, recent: any, them: any = {}) => nganSachTang(qcMau(life, recent, them), pol)
        dung('14f. tăng ngân sách: tốt CẢ trọn đời lẫn 8 ngày gần đây ⇒ 50.000 → 60.000', tang(TOT, sl(40000, 8)) === 60000, String(tang(TOT, sl(40000, 8))))
        dung('14g. KHÔNG tăng: gần đây < 5 kết quả · gần đây 12.000đ/kq (> nửa mức) · thiếu số gần đây · trọn đời xấu · quảng cáo bị từ chối',
            tang(TOT, sl(30000, 4)) === null && tang(TOT, sl(60000, 5)) === null && tang(TOT, undefined) === null
            && tang(sl(300000, 10), sl(40000, 8)) === null && tang(TOT, sl(40000, 8), { deliveryIssue: 'Facebook TỪ CHỐI quảng cáo này' }) === null)

        // chu kỳ thật: trọn đời đẹp, 8 ngày gần đây (last_7d + hôm nay) đắt ⇒ tạm dừng; đọc đúng preset last_7d
        datLai(); goi = []
        const c1 = ngCanh()
        await chuanBi(c1, 'auto', { dailyBudgetCap: 200000, maxCostPerResult: 20000, stopLossVnd: 100000 })
        const q1 = await coQuangCao(c1, 'PG1_101', 50000)
        const cid1 = String(q1.result?.campaignId)
        fb.insights.set(cid1, {
            maximum: { spend: '300000', actions: [{ action_type: 'comment', value: '30' }] },
            last_7d: { spend: '80000', actions: [{ action_type: 'comment', value: '2' }] },
            today: { spend: '10000', actions: [{ action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '1' }] },
        })
        const st1 = await xayTrangThaiAds(c1)
        const a1 = st1.ads.find((x: any) => x.campaignId === cid1)
        dung('14h. số gần đây = 7 ngày trước hôm nay (last_7d) + hôm nay: 90.000đ, 3 kết quả; trọn đời giữ nguyên',
            a1?.recent?.spend === 90000 && a1?.recent?.results === 3 && a1?.life?.spend === 300000 && goi.some(g => /\/insights$/.test(g.p) && g.q?.date_preset === 'last_7d'),
            JSON.stringify({ recent: a1?.recent, life: a1?.life }))
        goi = []
        const kq1 = await chuKy(c1)
        const dung1 = c1.kho._keHoach.find(k => k.kind === 'pause')
        dung('14i. chu kỳ: tạm dừng vì "đắt" theo 8 ngày gần đây (trọn đời vẫn 10.000đ / kết quả)',
            fb.campaigns.get(cid1).status === 'PAUSED' && dung1?.data?.reason === 'dat'
            && kq1.results.some((x: any) => x.action === 'pause' && x.status === 'succeeded' && /8 ngày gần đây/.test(x.message)), JSON.stringify(kq1.results))

        // chu kỳ thật: trọn đời tốt mà gần đây chưa tốt ⇒ KHÔNG tăng; gần đây tốt lên ⇒ tăng, lời ghi số gần đây
        datLai(); goi = []
        const c2 = ngCanh()
        await chuanBi(c2, 'auto', { dailyBudgetCap: 200000, maxCostPerResult: 20000, maxBudgetPerAd: 150000, automation: { scaleWinners: true } })
        const q2 = await coQuangCao(c2, 'PG1_101', 50000)
        const cid2 = String(q2.result?.campaignId)
        const tron2 = { spend: '50000', actions: [{ action_type: 'comment', value: '10' }] }
        fb.insights.set(cid2, { maximum: tron2, last_7d: { spend: '48000', actions: [{ action_type: 'comment', value: '4' }] } })
        const kq2 = await chuKy(c2)
        dung('14j. trọn đời 5.000đ/kq nhưng 8 ngày gần đây 12.000đ/kq ⇒ KHÔNG tăng ngân sách, không lệnh ghi',
            ghi().length === 0 && fb.campaigns.get(cid2).adsets[0].daily_budget === 50000 && !kq2.results.some((x: any) => x.action === 'budget'), JSON.stringify(kq2.results))
        fb.insights.set(cid2, { maximum: tron2, last_7d: { spend: '40000', actions: [{ action_type: 'comment', value: '8' }] } })
        const kq3 = await chuKy(c2)
        const ns2 = c2.kho._keHoach.find(k => k.kind === 'budget')
        dung('14k. gần đây tốt lên (5.000đ/kq) ⇒ tăng 50.000 → 60.000; lời ghi số 8 ngày gần đây',
            fb.campaigns.get(cid2).adsets[0].daily_budget === 60000 && /8 ngày gần đây/.test(String(ns2?.data?.reasonText || ''))
            && kq3.results.some((x: any) => x.action === 'budget' && x.status === 'succeeded' && /8 kết quả 8 ngày gần đây/.test(x.message)), JSON.stringify(kq3.results))

        // AD-08: #100/33 = "không tồn tại HOẶC không có quyền" — đọc được tài khoản chứa nó ⇒ đã xoá thật
        datLai(); goi = []
        const c3 = ngCanh()
        await chuanBi(c3, 'approve', { dailyBudgetCap: 200000, maxActiveAds: 3 })
        const q3 = await coQuangCao(c3, 'PG1_101', 50000)
        const q3b = await coQuangCao(c3, 'PG1_201', 50000)
        const [cid3, cid3b] = [q3, q3b].map(q => String(q.result?.campaignId))
        fb.campaigns.delete(cid3)
        goi = []
        const st3 = await xayTrangThaiAds(c3)
        const a3 = st3.ads.find((x: any) => x.campaignId === cid3)
        dung('14l. chiến dịch xoá thật (#100/33, tài khoản đọc được) ⇒ "đã xoá", rời trần, không có lỗi đọc',
            a3?.status === 'DELETED' && a3?.warnings?.some((w: string) => /không còn trên Facebook/.test(w)) && st3.totals?.committedDaily === 50000 && !st3.liveError,
            `${a3?.status} ${JSON.stringify(st3.totals)} ${st3.liveError}`)
        // AD-08: tài khoản cũng không đọc được (token mất quyền) ⇒ KHÔNG biết ⇒ vẫn chiếm trần, chặn tăng chi, báo người
        fb.campaigns.delete(cid3b)
        tiem('act', loiGraph(100, 'Unsupported get request', 33), 50)
        goi = []
        const st4 = await xayTrangThaiAds(c3)
        const a4 = st4.ads.filter((x: any) => [cid3, cid3b].includes(x.campaignId))
        dung('14m. #100/33 mà đọc cả tài khoản cũng không được ⇒ trạng thái null (KHÔNG phải "đã xoá"), vẫn chiếm trần 100.000đ, liveError',
            a4.length === 2 && a4.every((x: any) => x.status === null && /tài khoản quảng cáo/.test(x.readError || '')) && st4.totals?.committedDaily === 100000 && /2\/2 chiến dịch/.test(st4.liveError || ''),
            `${JSON.stringify(a4.map((x: any) => [x.status, x.readError]))} ${JSON.stringify(st4.totals)} ${st4.liveError}`)
        dung('14n. dò tài khoản MỘT lần cho cả hai chiến dịch cùng tài khoản', goi.filter(g => g.p === 'act_111' && g.q?.fields === 'id').length === 1,
            String(goi.filter(g => g.p === 'act_111' && g.q?.fields === 'id').length))
        goi = []
        const kq4 = await chuKy(c3)
        dung('14o. chu kỳ: mỗi chiến dịch mập mờ một dòng việc cần người, không lệnh ghi nào',
            ghi().length === 0 && [cid3, cid3b].every(id => kq4.results.some((x: any) => x.action === 'ads' && canNguoi(x) && x.message.includes(id))), JSON.stringify(kq4.results))
        fb.tiem = []

        // AD-11: quảng cáo bị Facebook từ chối trong chiến dịch ACTIVE
        datLai(); goi = []
        const c5 = ngCanh()
        await chuanBi(c5, 'auto', { dailyBudgetCap: 200000, maxActiveAds: 3, maxCostPerResult: 20000, maxBudgetPerAd: 150000, automation: { scaleWinners: true } })
        const q5 = await coQuangCao(c5, 'PG1_101', 50000)
        const cid5 = String(q5.result?.campaignId), ad5 = String(q5.result?.adId)
        const tot5 = { spend: '40000', actions: [{ action_type: 'comment', value: '8' }] }
        fb.insights.set(cid5, { maximum: tot5, last_7d: tot5 }) // số tốt: bình thường sẽ được tăng ngân sách
        dung('14p. (Facebook giả) quảng cáo Pilot dựng ra nằm trong chiến dịch, chưa có vấn đề',
            fb.campaigns.get(cid5)?.ads?.some((x: any) => x.id === ad5) && (await xayTrangThaiAds(c5)).ads.every((x: any) => x.deliveryIssue === null && x.adEffectiveStatus === 'ACTIVE'))
        fb.campaigns.get(cid5).ads = [{ id: ad5, effective_status: 'DISAPPROVED' }]
        fb.adsInfo.set(ad5, { ad_review_feedback: { global: { 'Quảng cáo': 'Dùng từ ngữ hạn chế về sức khoẻ' } } })
        goi = []
        const st5 = await xayTrangThaiAds(c5)
        const a5 = st5.ads.find((x: any) => x.campaignId === cid5)
        dung('14q. bị từ chối ⇒ deliveryIssue có lý do Facebook ghi, cảnh báo "giữ chỗ", VẪN chiếm trần 50.000đ (duyệt lại là chạy)',
            a5?.adEffectiveStatus === 'DISAPPROVED' && /TỪ CHỐI/.test(a5?.deliveryIssue || '') && /từ ngữ hạn chế/.test(a5?.deliveryIssue || '')
            && a5?.running === true && st5.totals?.committedDaily === 50000 && a5?.warnings?.some((w: string) => /giữ chỗ/.test(w)),
            `${a5?.adEffectiveStatus} ${a5?.deliveryIssue} ${JSON.stringify(st5.totals)}`)
        goi = []
        const kq5 = await chuKy(c5)
        dung('14r. chu kỳ: KHÔNG tăng ngân sách (dù số tốt), KHÔNG tự tắt; một dòng việc cần người chỉ cách trả chỗ',
            ghi().length === 0 && fb.campaigns.get(cid5).adsets[0].daily_budget === 50000
            && kq5.results.some((x: any) => x.action === 'ads' && canNguoi(x) && /giữ chỗ trong trần/.test(x.message) && /Tạm dừng/.test(x.message)), JSON.stringify(kq5.results))
        tiem('ad', loiGraph(1, 'tạm hỏng'), 5)
        const st6 = await xayTrangThaiAds(c5)
        dung('14s. đọc lý do từ chối hỏng ⇒ vẫn báo bị từ chối (không lý do), không gãy', /TỪ CHỐI/.test(st6.ads.find((x: any) => x.campaignId === cid5)?.deliveryIssue || ''))
        fb.tiem = []
        fb.campaigns.get(cid5).ads = [{ id: ad5, effective_status: 'PENDING_REVIEW' }]
        const st7 = await xayTrangThaiAds(c5)
        fb.campaigns.get(cid5).ads = [{ id: 'AD-KHAC-1', effective_status: 'DISAPPROVED' }, { id: 'AD-KHAC-2', effective_status: 'ACTIVE' }]
        const st8 = await xayTrangThaiAds(c5)
        const a8 = st8.ads.find((x: any) => x.campaignId === cid5)
        dung('14t. phải im: chờ duyệt không phải lỗi; quảng cáo KHÁC trong chiến dịch bị từ chối thì không gán cho quảng cáo Pilot',
            st7.ads.every((x: any) => x.deliveryIssue === null) && a8?.adEffectiveStatus === null && a8?.deliveryIssue === null,
            `${JSON.stringify(st7.ads.map((x: any) => x.deliveryIssue))} ${a8?.adEffectiveStatus} ${a8?.deliveryIssue}`)
        // người bật lại sau khi Pilot dừng vì hết hàng — quảng cáo bị từ chối vẫn phải báo
        fb.campaigns.get(cid5).ads = [{ id: ad5, effective_status: 'ACTIVE' }]
        hang.find(h => h.id === 'p1')!.stock = 0
        await chuKy(c5)
        const daDung5 = fb.campaigns.get(cid5).status === 'PAUSED'
        fb.campaigns.get(cid5).status = 'ACTIVE' // người bật lại trong Trình quản lý quảng cáo
        fb.campaigns.get(cid5).ads = [{ id: ad5, effective_status: 'DISAPPROVED' }]
        goi = []
        const kq9 = await chuKy(c5)
        dung('14v. người bật lại sau khi Pilot dừng vì hết hàng, quảng cáo bị từ chối ⇒ vẫn một dòng việc cần người, không lệnh ghi',
            daDung5 && ghi().length === 0 && kq9.results.some((x: any) => x.action === 'pause' && x.status === 'skipped')
            && kq9.results.some((x: any) => x.action === 'ads' && canNguoi(x) && /giữ chỗ trong trần/.test(x.message)), JSON.stringify(kq9.results))

        // Facebook không nhận trường ads{…} ⇒ đọc lại bằng bộ trường cũ: KHÔNG được mất chiến dịch (mất là hết tự tạm dừng hàng hết)
        datLai(); goi = []
        const c9 = ngCanh()
        await chuanBi(c9, 'approve', { dailyBudgetCap: 200000, maxActiveAds: 3 })
        const q9 = await coQuangCao(c9, 'PG1_101', 50000)
        const q9b = await coQuangCao(c9, 'PG1_201', 50000)
        fb.khongChoAds = true
        goi = []
        const st9 = await xayTrangThaiAds(c9)
        const docAds = goi.filter(g => g.m === 'get' && /(^|,)ads\{/.test(String(g.q?.fields || ''))).length
        dung('14w. Facebook không nhận trường ads{…} ⇒ hai chiến dịch vẫn đọc được (không "không đọc được"), trạng thái quảng cáo để trống',
            [q9, q9b].every(q => st9.ads.some((x: any) => x.campaignId === String(q.result?.campaignId) && x.status === 'ACTIVE' && x.adEffectiveStatus === null)) && !st9.liveError,
            `${JSON.stringify(st9.ads.map((x: any) => [x.status, x.adEffectiveStatus]))} ${st9.liveError}`)
        dung('14x. …và cả lượt chỉ thử trường ads{…} MỘT lần (chiến dịch sau đọc thẳng bộ cũ)', docAds === 1, String(docAds))
        hang.find(h => h.id === 'p1')!.stock = 0
        goi = []
        const kq10 = await chuKy(c9)
        dung('14y. …chu kỳ vẫn TẠM DỪNG quảng cáo hết hàng', fb.campaigns.get(String(q9.result?.campaignId)).status === 'PAUSED'
            && !kq10.results.some((x: any) => x.action === 'ads' && x.status === 'failed'), JSON.stringify(kq10.results))
        fb.khongChoAds = false

        // quảng cáo Pilot đã dừng vì hết hàng mà Facebook đang từ chối ⇒ có hàng lại thì máy KHÔNG tự chạy lại (chỉ chiếm trần)
        datLai(); goi = []
        const c10 = ngCanh()
        await chuanBi(c10, 'auto', { dailyBudgetCap: 200000, automation: { resumeRestocked: true } })
        const q10 = await coQuangCao(c10, 'PG1_101', 50000)
        const cid10 = String(q10.result?.campaignId)
        hang.find(h => h.id === 'p1')!.stock = 0
        await chuKy(c10)
        const daDung10 = fb.campaigns.get(cid10).status === 'PAUSED'
        fb.campaigns.get(cid10).ads = [{ id: String(q10.result?.adId), effective_status: 'DISAPPROVED' }]
        hang.find(h => h.id === 'p1')!.stock = 30
        goi = []
        await chuKy(c10)
        const a10 = (await xayTrangThaiAds(c10)).ads.find((x: any) => x.campaignId === cid10)
        dung('14z. đã dừng vì hết hàng + Facebook đang từ chối ⇒ có hàng lại máy KHÔNG tự chạy lại; cảnh báo nói rõ',
            daDung10 && fb.campaigns.get(cid10).status === 'PAUSED' && ghi().length === 0 && a10?.warnings?.some((w: string) => /không tự chạy lại/.test(w)),
            `${daDung10} ${fb.campaigns.get(cid10).status} ${JSON.stringify(ghi())} ${JSON.stringify(a10?.warnings)}`)

        const lib = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'facebookAdsPilot.ts'), 'utf8')
        dung('14u. nối dây: đọc ads{id,effective_status} trong lời đọc chiến dịch; Insights có last_7d',
            /COT_CHIEN_DICH = `\$\{COT_CHIEN_DICH_GOC\},ads\{id,effective_status\}`/.test(lib) && /COT_CHIEN_DICH_GOC = 'id,name,status,effective_status,adsets\{/.test(lib) && /'last_7d'/.test(lib))
    }

    // ─── 15. (10/11/2026) Báo chủ shop khi máy tự tăng chi + báo cáo chi hằng ngày (AD-10) ─────────
    {
        /** prisma ghi ĐƯỢC thông báo (bản chung ném) + push giả bơm qua `guiDay` — không kéo routes/notifications vào bộ kiểm */
        const tin: any[] = [], day: any[] = []
        let tinHong: RegExp | null = null
        const prismaTin: any = {
            ...prisma,
            notification: {
                create: async ({ data }: any) => {
                    if (tinHong && tinHong.test(String(data?.title))) throw new Error('CSDL hỏng')
                    tin.push(data); return { id: `N${tin.length}` }
                },
            },
        }
        const guiDay = async (_p: any, title: string, message: string, extra: any) => { day.push({ title, message, extra }) }
        const xoaTin = () => { tin.length = 0; day.length = 0 }
        const ngayCua = (ms: number) => new Date(ms + 7 * H).toISOString().slice(0, 10)
        const ddmm = (ms: number) => { const [, m, d] = ngayCua(ms).split('-'); return `${d}/${m}` }
        const baoCao = () => tin.filter(t => /báo cáo chi/.test(String(t.title)))
        const docYesterday = () => goi.filter(g => g.q?.date_preset === 'yesterday').length
        const SO_TOT = {
            maximum: { spend: '50000', actions: [{ action_type: 'comment', value: '6' }, { action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '4' }] },
            last_7d: { spend: '40000', actions: [{ action_type: 'comment', value: '5' }, { action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '3' }] },
        }
        const POL_TANG = { dailyBudgetCap: 200000, maxCostPerResult: 20000, maxBudgetPerAd: 150000, automation: { scaleWinners: true } }

        // Tự động: máy tự tăng ngân sách
        datLai(); goi = []
        const c1 = ngCanh()
        await chuanBi(c1, 'auto', POL_TANG)
        const q1 = await coQuangCao(c1, 'PG1_101', 50000)
        fb.insights.set(q1.result.campaignId, SO_TOT)
        const kq1 = await chuKy(c1)
        const dongTang = kq1.results.find((x: any) => x.action === 'budget')
        const khTang = c1.kho._keHoach.find(k => k.kind === 'budget')
        dung('15a. Tự động: máy tự tăng ngân sách ⇒ dòng kết quả mang tienMay, kế hoạch ghi tuDong (máy tự làm, không người bấm)',
            dongTang?.status === 'succeeded' && dongTang?.tienMay === true && khTang?.result?.tuDong === true, JSON.stringify({ dongTang, r: khTang?.result }))
        dung('15b. tổng sau lượt = số THẬT đang chạy: 1 quảng cáo, 60.000đ/ngày, trần 200.000đ',
            kq1.tongChay?.soChay === 1 && kq1.tongChay?.nganSach === 60000 && kq1.tongChay?.tran === 200000, JSON.stringify(kq1.tongChay))
        dung('15c. người bấm thực thi (không qua chu kỳ) ⇒ kế hoạch KHÔNG mang tuDong',
            q1.status === 'succeeded' && !q1.result?.tuDong && !c1.kho._keHoach.find(k => k.kind === 'boost')?.result?.tuDong, JSON.stringify(q1.result))

        // Duyệt tay: cùng số tốt ⇒ chỉ nháp
        datLai(); goi = []
        const c2 = ngCanh()
        await chuanBi(c2, 'approve', POL_TANG)
        const q2 = await coQuangCao(c2, 'PG1_101', 50000)
        fb.insights.set(q2.result.campaignId, SO_TOT)
        const kq2 = await chuKy(c2)
        dung('15d. Duyệt tay: tăng ngân sách chỉ là nháp chờ duyệt, không dòng nào mang tienMay; tổng vẫn 50.000đ (không tính chỗ giữ cho nháp)',
            kq2.results.some((x: any) => x.action === 'budget' && x.status === 'draft') && !kq2.results.some((x: any) => x.tienMay) && kq2.tongChay?.soChay === 1 && kq2.tongChay?.nganSach === 50000,
            JSON.stringify({ r: kq2.results, t: kq2.tongChay }))

        // Tự động: tạm dừng / chạy lại
        datLai(); goi = []
        const c3 = ngCanh()
        await chuanBi(c3, 'auto', { dailyBudgetCap: 100000, automation: { resumeRestocked: true } })
        await coQuangCao(c3, 'PG1_101', 50000)
        hang.find(h => h.id === 'p1')!.stock = 0
        const kq3a = await chuKy(c3)
        hang.find(h => h.id === 'p1')!.stock = 30
        const kq3b = await chuKy(c3)
        dung('15e. Tự động: tạm dừng (giảm chi) KHÔNG mang tienMay; chạy lại khi có hàng (tăng chi) có; tổng theo đúng sau từng lượt',
            kq3a.results.some((x: any) => x.action === 'pause' && x.status === 'succeeded' && !x.tienMay) && kq3a.tongChay?.soChay === 0 && kq3a.tongChay?.nganSach === 0
            && kq3b.results.some((x: any) => x.action === 'resume' && x.status === 'succeeded' && x.tienMay === true) && kq3b.tongChay?.soChay === 1 && kq3b.tongChay?.nganSach === 50000,
            JSON.stringify([kq3a.results, kq3a.tongChay, kq3b.results, kq3b.tongChay]))

        // Tự động + tự lập quảng cáo cho bài mới
        datLai(); goi = []
        const c4 = ngCanh()
        await chuanBi(c4, 'auto', { dailyBudgetCap: 200000, maxActiveAds: 1, automation: { boostNewPosts: true } })
        const kq4 = await chuKy(c4)
        const dongMoi = kq4.results.filter((x: any) => x.action === 'boost' && x.status === 'succeeded')
        const nsMoi = Number(c4.kho._keHoach.find(k => k.kind === 'boost' && k.status === 'succeeded')?.data?.dailyBudget)
        dung('15f. Tự động: máy tự bật quảng cáo mới ⇒ dòng mang tienMay; tổng cộng quảng cáo vừa bật',
            dongMoi.length === 1 && dongMoi[0].tienMay === true && kq4.tongChay?.soChay === 1 && kq4.tongChay?.nganSach === nsMoi && nsMoi > 0,
            JSON.stringify({ r: kq4.results, t: kq4.tongChay, nsMoi }))

        // baoMayTangChi (hàm thuần + ghi tin)
        xoaTin()
        dung('15g. không dòng tienMay (Duyệt tay) ⇒ không ghi tin, không push',
            (await baoMayTangChi(prismaTin, 'Ads Pilot', kq2.results, 'đuôi', guiDay)) === false && tin.length === 0 && day.length === 0)
        const coTang = await baoMayTangChi(prismaTin, 'Ads Pilot', kq1.results, 'sau lượt này …', guiDay)
        await new Promise(r => setImmediate(r))
        dung('15h. một tin "Ads Pilot: máy vừa tự tăng chi (1 việc)" kèm dòng việc + câu đuôi; push nhóm pilot, bấm mở tab Quảng cáo, mang id tin',
            coTang === true && tin.length === 1 && tin[0].title === 'Ads Pilot: máy vừa tự tăng chi (1 việc)' && tin[0].type === 'warning'
            && tin[0].message.startsWith('KHOAN10: ') && tin[0].message.includes(`tăng ngân sách ${vnd(50000)} → ${vnd(60000)}/ngày`) && tin[0].message.endsWith(' — sau lượt này …')
            && day.length === 1 && day[0].extra?.nhom === 'pilot' && day[0].extra?.web === '/pilot-facebook#ads' && day[0].extra?.id === 'N1',
            JSON.stringify({ tin, day }))
        xoaTin()
        const nhieu = Array.from({ length: 6 }, (_, i) => ({ action: 'boost', status: 'succeeded', sku: `SP${i}`, message: `bài ${i}`, tienMay: true }))
        await baoMayTangChi(prismaTin, 'Ads Pilot', [...nhieu, { action: 'boost', status: 'failed', sku: 'HONG', message: 'hỏng', tienMay: true }, { action: 'pause', status: 'succeeded', sku: 'DUNG', message: 'dừng' }], '', guiDay)
        dung('15i. 6 việc ⇒ tiêu đề đếm 6, tin kể 4 + "… và 2 việc nữa"; dòng hỏng / dòng không mang tienMay không tính',
            tin.length === 1 && tin[0].title.endsWith('(6 việc)') && tin[0].message.endsWith('SP3: bài 3 · … và 2 việc nữa') && !/SP4|HONG|DUNG/.test(tin[0].message), JSON.stringify(tin))
        const hong = await baoMayTangChi({ notification: { create: async () => { throw new Error('CSDL hỏng') } } }, 'Ads Pilot', kq1.results, '', guiDay).then(v => v, () => 'NEM')
        dung('15j. ghi tin hỏng ⇒ trả false, KHÔNG ném (không làm gãy lượt chạy)', hong === false, String(hong))

        // chạy theo lịch, Tự động, máy tự tăng ngân sách ⇒ tin ngay
        datLai(); goi = []; xoaTin()
        const k5 = khoBoNhoAds(), fb5 = khoFbMau()
        const c5 = ngCanh(k5, fb5)
        await chuanBi(c5, 'auto', POL_TANG)
        const q5 = await coQuangCao(c5, 'PG1_101', 50000)
        fb.insights.set(q5.result.campaignId, SO_TOT)
        await luuCauHinhAds(c5, { schedule: { enabled: true, intervalMinutes: 120 } })
        const ngoai5 = { taoFb, bayGio: () => bayGio, khoFb: fb5, guiDay }
        bayGio = NOW + 121 * 60_000
        goi = []
        const r5 = await chayTheoLichAds(prismaTin, k5, ngoai5)
        const tinTang = tin.filter(t => /máy vừa tự tăng chi/.test(String(t.title)))
        dung('15k. lịch Tự động: máy tự tăng ngân sách ⇒ MỘT tin ngay, nói sau lượt 1 quảng cáo · 60.000đ/ngày · trần 200.000đ và cách thôi (Duyệt tay)',
            r5 === 'da-chay' && tinTang.length === 1 && tinTang[0].message.includes(`sau lượt này 1 quảng cáo đang chạy, ${vnd(60000)}/ngày (trần ${vnd(200000)}/ngày)`) && /chuyển Ads Pilot sang Duyệt tay/.test(tinTang[0].message),
            JSON.stringify(tin))
        const lr5 = (await k5.docCauHinh())?.lastResult
        dung('15l. hôm qua không chi đồng nào, không thao tác nào ⇒ KHÔNG tin báo cáo chi, nhưng đã xét (đánh dấu hôm nay, đọc Insights "hôm qua" một lần)',
            baoCao().length === 0 && lr5?.baoCaoNgay === ngayCua(bayGio) && docYesterday() === 1, JSON.stringify({ bc: lr5?.baoCaoNgay, y: docYesterday() }))
        xoaTin(); goi = []
        bayGio += 121 * 60_000
        await chayTheoLichAds(prismaTin, k5, ngoai5)
        dung('15m. lượt sau cùng ngày: không tăng lần hai ⇒ không tin tăng chi; báo cáo đã xét ⇒ không đọc Insights "hôm qua" lần nữa',
            tin.length === 0 && docYesterday() === 0, JSON.stringify(tin))

        // báo cáo chi hôm qua — Duyệt tay: người đẩy bài, máy đề xuất tăng ngân sách + người duyệt, máy tự tạm dừng khi hết hàng
        datLai(); goi = []; xoaTin()
        const k6 = khoBoNhoAds(), fb6 = khoFbMau()
        const c6 = ngCanh(k6, fb6)
        await chuanBi(c6, 'approve', POL_TANG)
        const q6 = await coQuangCao(c6, 'PG1_101', 50000)
        const cid6 = String(q6.result.campaignId)
        fb.insights.set(cid6, SO_TOT)
        await chuKy(c6)
        const nhap6 = c6.kho._keHoach.find(k => k.kind === 'budget' && k.status === 'draft')
        const duyet6 = nhap6 ? await thucThiAds(c6, nhap6.id) : null
        hang.find(h => h.id === 'p1')!.stock = 0
        await chuKy(c6)
        const daDung6 = fb.campaigns.get(cid6).status === 'PAUSED'
        // một lần bật quảng cáo HỎNG (sổ ghi 'failed') — báo cáo chỉ đếm việc đã làm xong; dòng 'config' (đổi cấu hình) cũng không đếm
        c6.kho._nhatKy.push({ id: 'nk-hong', action: 'boost', status: 'failed', planId: null, payload: {}, response: { message: 'hỏng' }, createdAt: Date.now() })
        await luuCauHinhAds(c6, { schedule: { enabled: true, intervalMinutes: 30 } })
        const ngoai6 = { taoFb, bayGio: () => bayGio, khoFb: fb6, guiDay }
        // các việc trên ghi sổ nhật ký "hôm nay" (đồng hồ thật) ⇒ đồng hồ giả sang hôm sau thì chúng là "hôm qua"
        const homQua = bayGio
        fb.insights.set(cid6, { ...SO_TOT, yesterday: { spend: '45000', actions: [{ action_type: 'comment', value: '2' }, { action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '1' }] } })
        bayGio = dauNgayVN(NOW) + NGAY + 7 * H + 30 * 60_000
        goi = []
        await chayTheoLichAds(prismaTin, k6, ngoai6)
        dung('15n. 07:30 sáng hôm sau: chưa tới 8 giờ ⇒ không tin báo cáo, không đọc Insights "hôm qua", chưa đánh dấu',
            duyet6?.status === 'succeeded' && daDung6 && baoCao().length === 0 && docYesterday() === 0 && !(await k6.docCauHinh())?.lastResult?.baoCaoNgay,
            JSON.stringify({ d: duyet6?.status, daDung6, tin, bc: (await k6.docCauHinh())?.lastResult?.baoCaoNgay }))
        bayGio = dauNgayVN(NOW) + NGAY + 8 * H + 5 * 60_000
        tinHong = /báo cáo chi/
        await chayTheoLichAds(prismaTin, k6, ngoai6)
        const lr6 = (await k6.docCauHinh())?.lastResult
        dung('15o. 08:05, ghi tin báo cáo hỏng ⇒ KHÔNG đánh dấu (lượt sau gửi lại), lượt chạy không gãy',
            baoCao().length === 0 && !lr6?.baoCaoNgay && lr6?.ok === true, JSON.stringify({ tin, lr6 }))
        tinHong = null
        tiem('insights:yesterday', loiGraph(17, '(#17) User request limit reached'), 1)
        bayGio += 31 * 60_000
        await chayTheoLichAds(prismaTin, k6, ngoai6)
        dung('15p. đọc Insights "hôm qua" hỏng ⇒ không gửi số thiếu, KHÔNG đánh dấu; lượt chạy không gãy',
            baoCao().length === 0 && !(await k6.docCauHinh())?.lastResult?.baoCaoNgay && (await k6.docCauHinh())?.lastResult?.ok === true, JSON.stringify(tin))
        fb.tiem = []
        bayGio += 31 * 60_000
        goi = []
        await chayTheoLichAds(prismaTin, k6, ngoai6)
        const bc6 = baoCao(), m6 = String(bc6[0]?.message || '')
        dung('15q. lượt sau: MỘT tin "Ads Pilot: báo cáo chi hôm qua dd/mm" (ngày hôm qua), đánh dấu hôm nay',
            bc6.length === 1 && bc6[0].title === `Ads Pilot: báo cáo chi hôm qua ${ddmm(homQua)}` && (await k6.docCauHinh())?.lastResult?.baoCaoNgay === ngayCua(bayGio),
            JSON.stringify({ bc6, bc: (await k6.docCauHinh())?.lastResult?.baoCaoNgay }))
        dung('15r. số chi CHỈ của chiến dịch Pilot hôm qua: 45.000đ (1 quảng cáo), 3 bình luận / tin nhắn — 15.000đ mỗi kết quả',
            m6.includes(`chi ${vnd(45000)} (1 quảng cáo), 3 bình luận / tin nhắn — ${vnd(15000)} mỗi kết quả.`), m6)
        dung('15s. máy TỰ tạm dừng 1; người đẩy bài + người DUYỆT tăng ngân sách máy đề xuất ⇒ phần người làm (không gán cho máy)',
            m6.includes('Máy tự: tạm dừng 1.') && m6.includes('Người làm (web / trợ lý AI): tăng ngân sách 1, bật quảng cáo mới 1.'), m6)
        dung('15t. hiện tại: 0 quảng cáo đang chạy (đã tạm dừng), trần 200.000đ', m6.includes(`Hiện 0 quảng cáo đang chạy, ${vnd(0)}/ngày (trần ${vnd(200000)}/ngày).`), m6)
        dung('15u. push báo cáo: nhóm pilot, mở tab Quảng cáo, mang id tin',
            day.some(d => /báo cáo chi/.test(d.title) && d.extra?.nhom === 'pilot' && d.extra?.web === '/pilot-facebook#ads' && !!d.extra?.id), JSON.stringify(day))
        xoaTin(); goi = []
        bayGio += 31 * 60_000
        await chayTheoLichAds(prismaTin, k6, ngoai6)
        dung('15v. lượt sau cùng ngày: không gửi lần hai, không đọc lại Insights "hôm qua"', baoCao().length === 0 && docYesterday() === 0, JSON.stringify(tin))
        const tay = await chayChuKyAds(c6)
        const coBc = await chayChuKyAds(c6, { baoCaoNgayCu: null })
        dung('15w. chạy tay (không qua lịch) KHÔNG kèm báo cáo chi; lượt lịch chưa báo hôm nay thì có',
            tay.baoCaoNgay === undefined && coBc.baoCaoNgay?.title === `Ads Pilot: báo cáo chi hôm qua ${ddmm(homQua)}`, JSON.stringify({ tay: tay.baoCaoNgay, coBc: coBc.baoCaoNgay }))

        // máy định chạy lại mà có người vừa bật trước (Facebook trả alreadyActive) ⇒ không phải máy tiêu thêm, nhưng cuối lượt vẫn đang chạy
        datLai(); goi = []
        const c7 = ngCanh()
        await chuanBi(c7, 'auto', { dailyBudgetCap: 100000, automation: { resumeRestocked: true } })
        const q7 = await coQuangCao(c7, 'PG1_101', 50000)
        hang.find(h => h.id === 'p1')!.stock = 0
        await chuKy(c7)
        hang.find(h => h.id === 'p1')!.stock = 30
        const cd7 = fb.campaigns.get(String(q7.result.campaignId))
        let docCd7 = 0   // lời đọc đầu lượt (2 lần lấy trạng thái) thấy TẠM DỪNG, lời đọc lại lúc chạy lại thấy ĐANG CHẠY
        Object.defineProperty(cd7, 'status', { get: () => (docCd7++ < 2 ? 'PAUSED' : 'ACTIVE'), set: () => { }, configurable: true })
        const kq7 = await chuKy(c7)
        const dong7 = kq7.results.find((x: any) => x.action === 'resume')
        dung('15x. chạy lại gặp "đã đang chạy" (người vừa bật) ⇒ dòng KHÔNG mang tienMay; tổng sau lượt vẫn tính nó đang chạy',
            dong7?.status === 'succeeded' && !dong7?.tienMay && kq7.tongChay?.soChay === 1 && kq7.tongChay?.nganSach === 50000,
            JSON.stringify({ dong7, t: kq7.tongChay, r: c7.kho._keHoach.find(k => k.kind === 'resume')?.result }))

        // báo cáo: "tăng" hay "hạ" theo ngân sách SỐNG lúc làm — người sửa tay lên 80.000đ rồi duyệt nháp 50.000 → 60.000 ⇒ là HẠ
        datLai(); goi = []; xoaTin()
        const k8 = khoBoNhoAds(), fb8 = khoFbMau()
        const c8 = ngCanh(k8, fb8)
        await chuanBi(c8, 'approve', POL_TANG)
        const q8 = await coQuangCao(c8, 'PG1_101', 50000)
        fb.insights.set(String(q8.result.campaignId), SO_TOT)
        await chuKy(c8)
        const nhap8 = c8.kho._keHoach.find(k => k.kind === 'budget' && k.status === 'draft')
        fb.campaigns.get(String(q8.result.campaignId)).adsets[0].daily_budget = 80000
        const duyet8 = nhap8 ? await thucThiAds(c8, nhap8.id) : null
        await luuCauHinhAds(c8, { schedule: { enabled: true, intervalMinutes: 30 } })
        fb.insights.set(String(q8.result.campaignId), { ...SO_TOT, yesterday: { spend: '30000', actions: [] } })
        hang.find(h => h.id === 'p1')!.stock = 0      // chính lượt gửi báo cáo tạm dừng quảng cáo ⇒ "Hiện …" phải là số SAU lượt
        bayGio = dauNgayVN(NOW) + NGAY + 9 * H
        await chayTheoLichAds(prismaTin, k8, { taoFb, bayGio: () => bayGio, khoFb: fb8, guiDay })
        const m8 = String(baoCao()[0]?.message || '')
        dung('15y. nháp "tăng" 50.000 → 60.000 mà ngân sách sống đã 80.000 ⇒ báo cáo ghi người HẠ ngân sách; chi có mà 0 kết quả thì không chia',
            duyet8?.status === 'succeeded' && m8.includes('Người làm (web / trợ lý AI): hạ ngân sách 1, bật quảng cáo mới 1.') && m8.includes(`chi ${vnd(30000)} (1 quảng cáo), 0 bình luận / tin nhắn.`),
            JSON.stringify({ d: duyet8?.status, r: duyet8?.result, m8 }))
        dung('15z. lượt gửi báo cáo vừa tạm dừng quảng cáo hết hàng ⇒ "Hiện 0 quảng cáo đang chạy" (số SAU lượt, không phải đầu lượt)',
            fb.campaigns.get(String(q8.result.campaignId)).status === 'PAUSED' && m8.includes(`Hiện 0 quảng cáo đang chạy, ${vnd(0)}/ngày (trần ${vnd(200000)}/ngày).`), m8)
        bayGio = NOW
    }

    console.log(`\n${loi === 0 ? '✅' : '❌'} ${dat} đạt, ${loi} hỏng\n`)
    if (loi > 0) process.exitCode = 1
}

main().catch(e => { console.error('LỖI BỘ KIỂM:', e); process.exitCode = 1 })
