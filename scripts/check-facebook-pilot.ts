/* Kiểm chứng FACEBOOK PILOT (02/11/2026) — npx tsx scripts/check-facebook-pilot.ts
 *
 * Kho kế hoạch trong bộ nhớ + prisma giả (THEO `select` — trường không chọn thì không có, như Prisma thật) +
 * Facebook giả ghi lại mọi lời gọi + đồng hồ giả. Canh:
 *  1. Chính sách: kẹp số lạ, giờ đăng lọc / sắp, hashtag chuẩn hoá.
 *  2. Soạn bài: CHỈ dữ liệu kho (tên, giá, mô tả bỏ HTML), không tự hứa "còn hàng"; từ cấm thương hiệu bị bắt.
 *  3. Khung giờ: giờ VN, cách nhau ≥ minGap, ≤ postsPerDay/ngày (đếm cả bài đã có), ≥ 15 phút tới.
 *  4. Ứng viên: loại hàng không ảnh / chỉ WebP / đã lên bài gần đây (kể cả bài Content AI) / dính từ cấm; bán chạy lên đầu.
 *  5. Kế hoạch → thực thi: Xem trước KHÔNG gọi Facebook; Tự động gọi đúng một lần; bấm hai lần không đăng đúp;
 *     hết hàng / đổi giá / giờ đã qua lúc thực thi ⇒ không đăng; ghi FbScheduledPost; token hỏng ⇒ page token_expired.
 *  6. Bình luận: hỏi giá / SĐT; nối bài → mã; sổ FbAutoReplyLog chung ⇒ không trả lời đôi; Facebook từ chối ⇒ trả chỗ.
 *  7. Chu kỳ: Xem trước chỉ lập nháp; Tự động đăng + trả lời — nhưng KHÔNG tự trả lời khi đã có người trả lời,
 *     không rõ người viết, tồn ≤ 0; trần trả lời mỗi chu kỳ.
 *  8. Chạy theo lịch: chưa tới hẹn thì thôi; tới hẹn thì một bản giành, chạy, hẹn lượt kế.
 *  9. Tiện ích facebook_pilot chỉ-quản-trị; trạng thái KHÔNG lộ page token.
 * 10. Nối dây (soát mã nguồn): route gắn, cron chỉ chạy cửa hàng đã bật, /admin/migrate tạo bảng.
 * 11. (09/11/2026) Lỗi Graph đi qua FacebookService THẬT (fetch giả trả JSON lỗi Graph — không tự gắn isTokenError): xét theo
 *     MÃ, không theo type 'OAuthException'. #100 ⇒ hỏng riêng kế hoạch, trang sống; #190 ⇒ token_expired; #4 / #17 / #613 ⇒ giữ
 *     nháp, lùi, trang giữ nguyên; #200 ⇒ nói tên quyền; ghi gặp 5xx / không phải JSON / hết giờ ⇒ 'uncertain'; đối soát #32 ⇒
 *     không đánh dấu hết hạn.
 * 12. (09/11/2026) Dọn kế hoạch mở — CÙNG MỘT kho qua nhiều lượt: Xem trước 6 nháp → 4 giờ sau bật Tự động ⇒ có bài lên, nháp
 *     Xem trước bị huỷ; 'running' quá 1 giờ ⇒ uncertain + việc cần người; nháp máy quá giờ / quá 3 ngày ⇒ huỷ; nháp người ⇒ giữ;
 *     người huỷ nháp máy ⇒ nhớ 14 ngày.
 */
import * as fs from 'fs'
import * as path from 'path'
import {
    khoBoNhoFb, chuanHoaChinhSachFb, chuanHoaHashtag, soanBai, boHtml, khungGioTrong, dauNgayVN, anhHopLe, coSoDienThoai, laHoiGia,
    cauTraLoiGia, timUngVienFb, taoKeHoachBai, thucThiFb, luuCauHinhFb, docBinhLuan, taoKeHoachTraLoi, chayChuKyFb, chayTheoLichFb,
    xayTrangThaiFb, huyKeHoachFb, docGio, kiemKetNoiFb, CHINH_SACH_FB_MAC_DINH, type NgCanhFb, type DichVuFb,
} from '../src/lib/facebookPilot'
import { ToolError } from '../src/lib/mcpTypes'
import { lyDoChanPilot, datDemTienIch, giuTienIchQuanTri, TIEN_ICH_FACEBOOK_PILOT, LOI_CHUA_BAT_PILOT } from '../src/lib/tienIchCuaHang'
import { canNguoi } from '../src/lib/pilotBaoChuShop'
import { reconcilePage } from '../src/cron/fanpageCron'

let loi = 0, dat = 0
const dung = (ten: string, ok: boolean, chiTiet = '') => { ok ? dat++ : loi++; console.log(`${ok ? '✓' : '✗'} ${ten}${chiTiet && !ok ? ' — ' + chiTiet : ''}`) }
const nem = async (f: () => Promise<any>) => { try { await f(); return null } catch (e: any) { return e } }

const H = 3600_000
/** 08:00 sáng hôm nay giờ VN — gần ngày thật để nhật ký ghi (đồng hồ thật) rơi đúng "hôm nay" của đồng hồ giả. */
const NOW = dauNgayVN(Date.now()) + 8 * H
let bayGio = NOW

/* ── prisma giả: chỉ trả trường có trong select (bắt lỗi quên select như ca CHON_HD 30/10) ── */
function chon(o: any, sel: any): any {
    if (!sel) return { ...o }
    const ra: any = {}
    for (const [k, v] of Object.entries(sel)) {
        if (!v) continue
        const giaTri = o[k]
        if (v && typeof v === 'object' && (v as any).select) ra[k] = Array.isArray(giaTri) ? giaTri.map((x: any) => chon(x, (v as any).select)) : giaTri
        else ra[k] = giaTri
    }
    return ra
}
function khopChuoi(v: any, f: any): boolean {
    if (f === undefined) return true
    if (f === null || typeof f !== 'object' || f instanceof Date) return v === f
    if ('equals' in f) return f.mode === 'insensitive' ? String(v).toLowerCase() === String(f.equals).toLowerCase() : v === f.equals
    if ('contains' in f) return (f.mode === 'insensitive' ? String(v).toLowerCase() : String(v)).includes(f.mode === 'insensitive' ? String(f.contains).toLowerCase() : f.contains)
    if ('in' in f) return f.in.includes(v)
    if ('not' in f) return v !== f.not
    if ('gte' in f || 'gt' in f || 'lte' in f) {
        const n = v instanceof Date ? v.getTime() : Number(v)
        const g = (x: any) => (x instanceof Date ? x.getTime() : Number(x))
        return (f.gte === undefined || n >= g(f.gte)) && (f.gt === undefined || n > g(f.gt)) && (f.lte === undefined || n <= g(f.lte))
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

const ANH = (n: string) => `https://storage.googleapis.com/kengi-tech-assets/anh-sp/x/${n}.jpg`
let hang: any[] = []
let banChay: any[] = []
let nhapAi: any[] = []
let hoSo: any = null
const baiDaHen: any[] = []
const soTraLoi: any[] = []
const pages: any[] = []

function datLai() {
    hang = [
        { id: 'p1', sku: 'KHOAN10', name: 'Mũi khoan lệch tâm 10mm', description: '<p>Thép gió <b>HSS</b>, khoan gỗ &amp; nhôm.</p><ul><li>Dài 120mm</li></ul>', productType: 'goods', sellingPrice: 26000, stock: 40, mergedIntoId: null, bundleId: null, createdAt: new Date(NOW - 90 * 86400_000), images: [{ url: ANH('k10'), isPrimary: true }, { url: ANH('k10b'), isPrimary: false }] },
        { id: 'p2', sku: 'OC4', name: 'Ổ cắm điện 4 lỗ', description: 'Dây 3m, chịu tải 2500W.', productType: 'goods', sellingPrice: 189000, stock: 3, mergedIntoId: null, bundleId: null, createdAt: new Date(NOW - 30 * 86400_000), images: [{ url: ANH('oc4'), isPrimary: true }] },
        { id: 'p3', sku: 'BINH', name: 'Bình giữ nhiệt', description: '', productType: 'goods', sellingPrice: 129000, stock: 30, mergedIntoId: null, bundleId: null, createdAt: new Date(NOW), images: [] },
        { id: 'p4', sku: 'TUI', name: 'Túi tote', description: '', productType: 'goods', sellingPrice: 99000, stock: 60, mergedIntoId: null, bundleId: null, createdAt: new Date(NOW), images: [{ url: 'https://cdn.x/tui.webp', isPrimary: true }] },
        { id: 'p5', sku: 'BUA', name: 'Búa đinh cán gỗ', description: 'Búa rèn nguyên khối, giá rẻ nhất thị trường.', productType: 'goods', sellingPrice: 75000, stock: 9, mergedIntoId: null, bundleId: null, createdAt: new Date(NOW), images: [{ url: ANH('bua'), isPrimary: true }] },
        { id: 'p6', sku: 'GOP', name: 'Mã đã gộp', description: '', productType: 'goods', sellingPrice: 5000, stock: 9, mergedIntoId: 'p1', bundleId: null, createdAt: new Date(NOW), images: [{ url: ANH('gop'), isPrimary: true }] },
        { id: 'p7', sku: 'TUA', name: 'Tua vít bake', description: 'Đầu từ tính.', productType: 'goods', sellingPrice: 15000, stock: 0, mergedIntoId: null, bundleId: null, createdAt: new Date(NOW), images: [{ url: ANH('tua'), isPrimary: true }] },
    ]
    banChay = [{ productId: 'p2', _sum: { quantity: 25 } }, { productId: 'p1', _sum: { quantity: 4 } }]
    nhapAi = []
    hoSo = { cta: 'Gọi 0909 000 111 hoặc inbox shop', hashtags: '["#kengi", "dụng cụ"]', bannedWords: '["rẻ nhất"]', bestHours: '[]', emojiLevel: 'vua', createdAt: new Date(0) }
    baiDaHen.length = 0
    soTraLoi.length = 0
    pages.length = 0
    pages.push({ pageId: 'PG1', name: 'Kengi Fanpage', avatar: null, fanCount: 1200, status: 'active', tokenExpiresAt: new Date(NOW + 40 * 86400_000), webhookSubscribed: false, autoReplyEnabled: false, accessToken: 'TOKEN-BI-MAT-PG1', createdAt: new Date(0) })
}

const prisma: any = {
    fbPage: {
        findMany: async ({ where, select }: any) => pages.filter(p => khop(p, where)).map(p => chon(p, select)),
        update: async ({ where, data }: any) => { const p = pages.find(x => x.pageId === where.pageId); Object.assign(p, data); return p },
    },
    fbBrandProfile: { findFirst: async () => hoSo },
    fbContentDraft: { findMany: async ({ where, select }: any) => nhapAi.filter(d => khop(d, where)).map(d => chon(d, select)) },
    transactionItem: { groupBy: async () => banChay },
    product: {
        findMany: async ({ where, select, take }: any) => hang.filter(h => khop(h, where)).sort((a, b) => b.stock - a.stock).slice(0, take ?? 1e9).map(h => chon(h, select)),
        findFirst: async ({ where, select }: any) => { const h = hang.find(x => khop(x, where)); return h ? chon(h, select) : null },
        findUnique: async ({ where, select }: any) => { const h = hang.find(x => x.id === where.id); return h ? chon(h, select) : null },
    },
    fbScheduledPost: {
        findMany: async ({ where, select, take }: any) => baiDaHen.filter(b => khop(b, where)).slice(0, take ?? 1e9).map(b => chon(b, select)),
        create: async ({ data }: any) => { const r = { id: `sp${baiDaHen.length + 1}`, ...data }; baiDaHen.push(r); return r },
    },
    fbAutoReplyLog: {
        findMany: async ({ where, select }: any) => soTraLoi.filter(r => khop(r, where)).map(r => chon(r, select)),
        create: async ({ data }: any) => {
            if (soTraLoi.some(r => r.pageId === data.pageId && r.commentId === data.commentId)) throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' })
            soTraLoi.push({ ...data }); return data
        },
        update: async ({ where, data }: any) => { const r = soTraLoi.find(x => x.pageId === where.pageId_commentId.pageId && x.commentId === where.pageId_commentId.commentId); if (r) Object.assign(r, data); return r },
        delete: async ({ where }: any) => { const i = soTraLoi.findIndex(x => x.pageId === where.pageId_commentId.pageId && x.commentId === where.pageId_commentId.commentId); if (i >= 0) soTraLoi.splice(i, 1); return {} },
    },
}

/* ── Facebook giả ── */
const goiFb: any[] = []
let loiDang: any = null
let loiTraLoi: any = null
let baiTrenFb: any[] = []
let soBai = 0
const fbGia = (token: string): DichVuFb => ({
    get: async (p: string, params?: any) => { goiFb.push(['get', p, params, token]); return { data: baiTrenFb } },
    identifyToken: async () => ({ type: 'page', id: 'PG1', name: 'Kengi Fanpage' }),
    createOrSchedulePost: async (input: any) => { goiFb.push(['post', input]); if (loiDang) throw loiDang; soBai++; return { id: `PG1_${100 + soBai}` } },
    replyToComment: async (id: string, msg: string) => { goiFb.push(['reply', id, msg]); if (loiTraLoi) throw loiTraLoi; return { id: `r_${id}` } },
    hideComment: async (id: string) => { goiFb.push(['hide', id]); return { success: true } },
    listScheduledPosts: async () => [],
})
const ghiFb = () => goiFb.filter(g => g[0] !== 'get')

/* ── Graph giả ở TẦNG fetch (09/11/2026): ca lỗi Graph đi qua FacebookService THẬT (goi → buildError → loaiLoiFb) thay vì
 *    tự gắn isTokenError như dịch vụ giả ở trên. Chỉ trả lời graph(-video).facebook.com — gọi đi đâu khác là ném. ── */
type DapGraph = { status: number; body: any } | { nem: 'het_gio' | 'mang' } | { html: number }
let dapGraph: (method: string, duong: string) => DapGraph = () => ({ status: 200, body: {} })
const goiGraph: { method: string; duong: string; coHenGio: boolean }[] = []
const fetchGoc = globalThis.fetch
function batGraphGia() {
    globalThis.fetch = (async (input: any, init: any = {}) => {
        const url = new URL(String(input?.url || input))
        if (!/^graph(-video)?\.facebook\.com$/.test(url.hostname)) throw new Error(`bộ kiểm chặn lời gọi ra ngoài: ${url.hostname}`)
        const method = String(init.method || 'GET').toUpperCase()
        const duong = url.pathname.replace(/^\/v\d+\.\d+\//, '')
        goiGraph.push({ method, duong, coHenGio: init.signal instanceof AbortSignal })
        const d = dapGraph(method, duong)
        // AbortSignal.timeout hết giờ ⇒ fetch ném DOMException tên 'TimeoutError' (giả lập thẳng, khỏi chờ 90 giây thật)
        if ('nem' in d) throw d.nem === 'het_gio' ? new DOMException('The operation was aborted due to timeout', 'TimeoutError') : new TypeError('fetch failed')
        if ('html' in d) return new Response('<html><body>502 Bad Gateway</body></html>', { status: d.html, headers: { 'Content-Type': 'text/html' } })
        return new Response(JSON.stringify(d.body), { status: d.status, headers: { 'Content-Type': 'application/json' } })
    }) as any
}
const traFetch = () => { globalThis.fetch = fetchGoc }
/** JSON lỗi đúng dạng Graph — type LUÔN 'OAuthException' (Graph gắn type này cho cả #100, #200, #4…): phân loại phải theo MÃ. */
const loiGraph = (status: number, code: number, message: string, them: any = {}) =>
    ({ status, body: { error: { message, type: 'OAuthException', code, fbtrace_id: 'TRACE-GIA', ...them } } })
/** Graph bình thường: tải ảnh ẩn, đăng bài, trả lời / ẩn bình luận, đọc bài + bài hẹn giờ đều được. */
const graphOn = (method: string, duong: string): DapGraph => {
    if (method === 'POST' && /\/photos$/.test(duong)) return { status: 200, body: { id: `ANH${goiGraph.length}` } }
    if (method === 'POST' && /\/feed$/.test(duong)) return { status: 200, body: { id: `PG1_9${goiGraph.length}` } }
    if (method === 'POST' && /\/comments$/.test(duong)) return { status: 200, body: { id: `R${goiGraph.length}` } }
    if (method === 'POST') return { status: 200, body: { success: true } }
    return { status: 200, body: { data: [] } }
}

function ngCanh(kho = khoBoNhoFb()): NgCanhFb & { kho: ReturnType<typeof khoBoNhoFb> } {
    return { prisma, kho, nguoi: 'chu@shop', taoFb: fbGia, bayGio: () => bayGio } as any
}

async function main() {
    datLai()
    // ─── 1. Chính sách ───────────────────────────────────────────────────────────
    {
        const c = chuanHoaChinhSachFb({ postsPerDay: 99, postHours: [20, 9, '12', 9, 25, -1, 'x'], minGapMinutes: 5, minStock: 0, cta: '  Inbox   ngay  ', automation: { posts: false } })
        dung('1a. kẹp số: postsPerDay ≤ 10, minGap ≥ 60, minStock ≥ 1', c.postsPerDay === 10 && c.minGapMinutes === 60 && c.minStock === 1, JSON.stringify(c))
        dung('1b. giờ đăng lọc 0..23, bỏ trùng, sắp tăng', JSON.stringify(c.postHours) === '[9,12,20]', JSON.stringify(c.postHours))
        dung('1c. bật/tắt bước giữ đúng, bước thiếu lấy mặc định', c.automation.posts === false && c.automation.replyPriceQuestions === false)
        dung('1d. CTA gom khoảng trắng', c.cta === 'Inbox ngay')
        dung('1e. hashtag: một từ, có #, bỏ trùng', JSON.stringify(chuanHoaHashtag(['#Dụng cụ', 'dụng cụ', 'khoan!', '#'])) === '["#Dụngcụ","#khoan"]', JSON.stringify(chuanHoaHashtag(['#Dụng cụ', 'dụng cụ', 'khoan!', '#'])))
        const t = docGio('2026-11-02T20:00')
        dung('1f. giờ không múi giờ hiểu là giờ VN', t === Date.UTC(2026, 10, 2, 13, 0), new Date(t).toISOString())
    }

    // ─── 2. Soạn bài ─────────────────────────────────────────────────────────────
    {
        const pol = chuanHoaChinhSachFb({})
        const b = soanBai(hang[0], pol, hoSo)
        dung('2a. dòng đầu là tên hàng (nối bình luận về mã nhờ dòng này)', b.message.split('\n')[0] === '🔹 Mũi khoan lệch tâm 10mm', b.message.split('\n')[0])
        dung('2b. giá thật từ kho, định dạng VN', b.message.includes('Giá: 26.000đ'), b.message)
        dung('2c. mô tả bỏ HTML + giải mã &amp;', b.message.includes('Thép gió HSS, khoan gỗ & nhôm.') && b.message.includes('• Dài 120mm') && !/<[a-z]/i.test(b.message), b.message)
        dung('2d. không tự hứa "còn hàng" / "giao toàn quốc"', !/còn hàng|toàn quốc|chính hãng/i.test(b.message))
        dung('2e. CTA + hashtag lấy từ hồ sơ thương hiệu', b.message.includes('👉 Gọi 0909 000 111 hoặc inbox shop') && b.message.includes('#kengi #dụngcụ'), b.message)
        dung('2f. từ cấm trong mô tả bị bắt', JSON.stringify(soanBai(hang[4], pol, hoSo).tuCam) === '["rẻ nhất"]')
        const tat = soanBai(hang[0], chuanHoaChinhSachFb({ showPrice: false, cta: 'Nhắn shop nhé', hashtags: ['#a'] }), { ...hoSo, emojiLevel: 'khong' })
        dung('2g. tắt giá + chính sách thắng hồ sơ + không emoji', !tat.message.includes('Giá') && tat.message.includes('Nhắn shop nhé') && tat.message.includes('#a') && !tat.message.includes('#kengi') && !tat.message.includes('🔹'), tat.message)
        dung('2h. bỏ HTML giữ xuống dòng', boHtml('a<br>b<p>c</p>d') === 'a\nb\nc\nd', JSON.stringify(boHtml('a<br>b<p>c</p>d')))
        dung('2i. ảnh: ảnh chính trước, bỏ WebP / không phải http', JSON.stringify(anhHopLe([{ url: 'x.jpg' }, { url: 'https://a/2.webp' }, { url: 'https://a/1.png' }, { url: 'https://a/0.jpg', isPrimary: true }], 4)) === '["https://a/0.jpg","https://a/1.png"]')
    }

    // ─── 3. Khung giờ ────────────────────────────────────────────────────────────
    {
        const pol = chuanHoaChinhSachFb({ postsPerDay: 2, minGapMinutes: 180 })
        const s = khungGioTrong(NOW, [9, 12, 20], pol, [])
        const dau = dauNgayVN(NOW)
        dung('3a. hôm nay 9h + 12h (đủ 2 bài), mai 9h + 12h…', s.length === 6 && s[0] === dau + 9 * H && s[1] === dau + 12 * H && s[2] === dau + 33 * H, s.map(x => (x - dau) / H).join(','))
        const s2 = khungGioTrong(NOW, [9, 12, 20], pol, [dau + 10 * H])
        dung('3b. bài đã có lúc 10h ⇒ bỏ 9h và 12h (cách < 3 tiếng), lấy 20h; ngày đã có 1 ⇒ còn 1', s2[0] === dau + 20 * H && s2[1] === dau + 33 * H, s2.map(x => (x - dau) / H).join(','))
        const s3 = khungGioTrong(dau + 8 * H + 50 * 60_000, [9], pol, [])
        dung('3c. khung còn < 15 phút ⇒ bỏ', s3[0] === dau + 33 * H, s3.map(x => (x - dau) / H).join(','))
        dung('3d. postsPerDay 0 ⇒ không khung nào', khungGioTrong(NOW, [9], chuanHoaChinhSachFb({ postsPerDay: 0 }), []).length === 0)
    }

    // ─── 4. Ứng viên ─────────────────────────────────────────────────────────────
    {
        const ctx = ngCanh()
        const pol = chuanHoaChinhSachFb({})
        const uv = await timUngVienFb(ctx, pol, { lim: 30 })
        const ma = uv.ungVien.map(u => u.sku)
        dung('4a. bán chạy lên đầu (OC4 bán 25 > KHOAN10 bán 4)', ma[0] === 'OC4' && ma[1] === 'KHOAN10', ma.join(','))
        dung('4b. loại: không ảnh (BINH), chỉ WebP (TUI), từ cấm (BUA), đã gộp (GOP), tồn 0 (TUA)', !ma.some(m => ['BINH', 'TUI', 'BUA', 'GOP', 'TUA'].includes(m)), ma.join(','))
        dung('4c. đếm lý do loại', uv.loaiTru.thieuAnh === 1 && uv.loaiTru.anhKhongDung === 1 && uv.loaiTru.tuCam === 1, JSON.stringify(uv.loaiTru))
        nhapAi = [{ productIds: '["p2"]', status: 'scheduled', createdAt: new Date(NOW - 2 * 86400_000) }]
        const uv2 = await timUngVienFb(ctx, pol, { lim: 30 })
        dung('4d. mã vừa có bài Content AI ⇒ không lên lại', !uv2.ungVien.some(u => u.sku === 'OC4') && uv2.loaiTru.daDangGanDay === 1)
        nhapAi = []
    }

    // ─── 5. Kế hoạch → thực thi ─────────────────────────────────────────────────
    {
        datLai(); goiFb.length = 0; bayGio = NOW
        const ctx = ngCanh()
        dung('5a. chưa có cấu hình ⇒ một page duy nhất được chọn sẵn, chế độ Xem trước', (await xayTrangThaiFb(ctx)).status.executionMode === 'preview')
        const kh = await taoKeHoachBai(ctx, { sku: 'khoan10', idempotencyKey: 'web:1' })
        dung('5b. kế hoạch nháp vào khung trống gần nhất (9h hôm nay)', kh.status === 'draft' && kh.data.scheduledAt === dauNgayVN(NOW) + 9 * H && kh.data.price === 26000)
        dung('5c. bấm hai lần (cùng khoá) ⇒ một kế hoạch', (await taoKeHoachBai(ctx, { sku: 'KHOAN10', idempotencyKey: 'web:1' })).id === kh.id && ctx.kho._keHoach.length === 1)
        const xemTruoc = await thucThiFb(ctx, kh.id)
        dung('5d. Xem trước: thực thi KHÔNG gọi Facebook', xemTruoc.executed === false && ghiFb().length === 0)
        await luuCauHinhFb(ctx, { executionMode: 'auto' })
        const xong = await thucThiFb(ctx, kh.id)
        const dang = ghiFb().filter(g => g[0] === 'post')
        dung('5e. Tự động: đăng đúng MỘT lần, kiểu multi_photo, đúng giờ hẹn + ảnh', xong.status === 'succeeded' && dang.length === 1 && dang[0][1].mediaType === 'multi_photo' && dang[0][1].scheduledAtMs === kh.data.scheduledAt && dang[0][1].mediaUrls.length === 2, JSON.stringify(dang))
        dung('5f. ghi FbScheduledPost (fanpage-manager + cron đối soát thấy)', baiDaHen.length === 1 && baiDaHen[0].fbPostId === 'PG1_101' && baiDaHen[0].status === 'scheduled')
        await thucThiFb(ctx, kh.id)
        dung('5g. thực thi lại kế hoạch đã xong ⇒ không đăng đúp', ghiFb().filter(g => g[0] === 'post').length === 1)
        dung('5h. mã vừa lên kế hoạch không được lập lại (đăng lặp)', !(await timUngVienFb(ctx, chuanHoaChinhSachFb({}), { lim: 30 })).ungVien.some(u => u.sku === 'KHOAN10'))

        const kh2 = await taoKeHoachBai(ctx, { sku: 'OC4' })
        hang[1].stock = 0
        const hetHang = await thucThiFb(ctx, kh2.id)
        dung('5i. hết hàng lúc thực thi ⇒ thất bại, không gọi Facebook', hetHang.status === 'failed' && /Tồn kho còn 0/.test(hetHang.result?.message) && ghiFb().filter(g => g[0] === 'post').length === 1, hetHang.result?.message)
        hang[1].stock = 3
        const kh3 = await taoKeHoachBai(ctx, { sku: 'OC4', scheduledAt: dauNgayVN(NOW) + 33 * H })
        hang[1].sellingPrice = 199000
        const doiGia = await thucThiFb(ctx, kh3.id)
        dung('5j. giá đổi từ lúc lập kế hoạch ⇒ thất bại (bài không ghi giá cũ)', doiGia.status === 'failed' && /189\.000đ thành 199\.000đ/.test(doiGia.result?.message), doiGia.result?.message)
        hang[1].sellingPrice = 189000
        const kh4 = await taoKeHoachBai(ctx, { sku: 'OC4', scheduledAt: dauNgayVN(NOW) + 34 * H })
        bayGio = dauNgayVN(NOW) + 34 * H - 5 * 60_000
        const quaGio = await thucThiFb(ctx, kh4.id)
        dung('5k. giờ hẹn còn < 10 phút lúc thực thi ⇒ thất bại', quaGio.status === 'failed' && /dưới 10 phút/.test(quaGio.result?.message), quaGio.result?.message)
        bayGio = NOW
        dung('5l. tự chọn giờ < 10 phút tới ⇒ chặn ngay lúc lập', (await nem(() => taoKeHoachBai(ctx, { sku: 'OC4', scheduledAt: NOW + 5 * 60_000 }))) instanceof ToolError)
        dung('5m. mã chỉ có ảnh WebP ⇒ không lập kế hoạch', /WebP/.test((await nem(() => taoKeHoachBai(ctx, { sku: 'TUI' })))?.message || ''))
        dung('5n. mã dính từ cấm ⇒ không lập kế hoạch', /từ CẤM/.test((await nem(() => taoKeHoachBai(ctx, { sku: 'BUA' })))?.message || ''))
        dung('5o. sửa nội dung có từ cấm ⇒ chặn', /từ CẤM/.test((await nem(() => taoKeHoachBai(ctx, { sku: 'OC4', message: 'Rẻ nhất Sài Gòn' })))?.message || ''))
        const kh5 = await taoKeHoachBai(ctx, { sku: 'OC4', publishNow: true })
        loiDang = Object.assign(new Error('Error validating access token'), { code: 190, isTokenError: true, fbtraceId: 'x' })
        const tokenHong = await thucThiFb(ctx, kh5.id)
        loiDang = null
        dung('5p. token hỏng ⇒ thất bại + page đánh dấu token_expired + nhắc dán token', tokenHong.status === 'failed' && pages[0].status === 'token_expired' && /dán page token mới/.test(tokenHong.result?.message), tokenHong.result?.message)
        dung('5q. page token_expired ⇒ chặn mọi kế hoạch mới', /hết hạn/.test((await nem(() => taoKeHoachBai(ctx, { sku: 'OC4' })))?.message || ''))
        pages[0].status = 'active'
        const kh6 = await taoKeHoachBai(ctx, { sku: 'OC4', publishNow: true })
        loiDang = new TypeError('fetch failed')
        const matMang = await thucThiFb(ctx, kh6.id)
        loiDang = null
        dung('5r. mất mạng giữa chừng ⇒ "uncertain" (không rõ Facebook nhận chưa)', matMang.status === 'uncertain', matMang.status)
        const kh7 = await taoKeHoachBai(ctx, { sku: 'OC4', publishNow: true })
        dung('5s. huỷ nháp được, huỷ lần hai báo lỗi', (await huyKeHoachFb(ctx, kh7.id)).status === 'cancelled' && (await nem(() => huyKeHoachFb(ctx, kh7.id))) instanceof ToolError)
        await luuCauHinhFb(ctx, { policy: { maxWritesPerDay: 1 } })
        const kh8 = await taoKeHoachBai(ctx, { sku: 'OC4', publishNow: true })
        dung('5t. quá số thao tác ghi / ngày ⇒ chặn', /thao tác ghi/.test((await nem(() => thucThiFb(ctx, kh8.id)))?.message || ''))
        await luuCauHinhFb(ctx, { policy: { maxWritesPerDay: 30 } })
        const truoc = ghiFb().filter(g => g[0] === 'post').length
        const kq2 = await Promise.all([thucThiFb(ctx, kh8.id), thucThiFb(ctx, kh8.id)])
        dung('5u. hai tab bấm thực thi CÙNG LÚC ⇒ đăng đúng một lần', ghiFb().filter(g => g[0] === 'post').length === truoc + 1, `${truoc} → ${ghiFb().filter(g => g[0] === 'post').length} ${kq2.map((k: any) => k.status).join(',')}`)
        const motAnh = ghiFb().filter(g => g[0] === 'post').pop()
        dung('5v. bài MỘT ảnh vẫn đi multi_photo (mã trả về là mã BÀI, khớp scheduled_posts)', motAnh?.[1]?.mediaType === 'multi_photo' && motAnh?.[1]?.mediaUrls?.length === 1, JSON.stringify(motAnh))
    }

    // ─── 6. Bình luận ───────────────────────────────────────────────────────────
    {
        datLai(); goiFb.length = 0; bayGio = NOW
        const ctx = ngCanh()
        await luuCauHinhFb(ctx, { executionMode: 'auto' })
        dung('6a. hỏi giá: "giá sao shop", "bn vậy", "ib", "còn hàng ko" — không bắt "gia đình"', laHoiGia('giá sao shop') && laHoiGia('bn vậy') && laHoiGia('ib') && laHoiGia('con hang ko') && !laHoiGia('gia đình mình dùng tốt'))
        dung('6b. số điện thoại có dấu cách / chấm / +84; không bắt mã đơn ngắn', coSoDienThoai('sđt 0909 123 456') && coSoDienThoai('+84.909.123.456') && !coSoDienThoai('mã 12345678') && !coSoDienThoai('giá 26000'))
        dung('6c. trả lời giá: tồn dương nói "có hàng"; tồn 0 KHÔNG nói "hết hàng"',
            /có hàng/.test(cauTraLoiGia({ name: 'A', sellingPrice: 1000, stock: 2 })) && !/hết hàng|có hàng/.test(cauTraLoiGia({ name: 'A', sellingPrice: 1000, stock: 0 })))
        baiTrenFb = [
            { id: 'PG1_201', message: '🔹 Mũi khoan lệch tâm 10mm\n💰 Giá: 26.000đ', permalink_url: 'https://fb/201', comments: { data: [
                { id: 'C1', message: 'giá sao shop', from: { id: 'U1', name: 'An' }, created_time: new Date(NOW - H).toISOString(), comment_count: 0 },
                { id: 'C2', message: 'bn vậy', from: { id: 'U2', name: 'Bình' }, created_time: new Date(NOW - 2 * H).toISOString(), comment_count: 0 },
                { id: 'C3', message: 'Dạ shop gửi giá ạ', from: { id: 'PG1', name: 'Kengi Fanpage' }, created_time: new Date(NOW - H).toISOString(), comment_count: 0 },
                { id: 'C4', message: 'lấy 2 cái, sđt 0909 123 456', from: { id: 'U4', name: 'Cường' }, created_time: new Date(NOW - H).toISOString(), comment_count: 0 },
                { id: 'C5', message: 'giá?', from: { id: 'U5', name: 'Dũng' }, created_time: new Date(NOW - H).toISOString(), comment_count: 2 },
                { id: 'C6', message: 'giá bao nhiêu', created_time: new Date(NOW - H).toISOString(), comment_count: 0 },
                { id: 'C9', message: 'hotline 0912 345 678', created_time: new Date(NOW - H).toISOString(), comment_count: 0 },
            ] } },
            { id: 'PG1_202', message: 'Bài khác không phải sản phẩm', comments: { data: [{ id: 'C7', message: 'giá?', from: { id: 'U7', name: 'Em' }, created_time: new Date(NOW - H).toISOString(), comment_count: 0 }] } },
        ]
        soTraLoi.push({ pageId: 'PG1', commentId: 'C2', action: 'reply', success: true })
        const bl = await docBinhLuan(ctx)
        const c = (id: string) => bl.comments.find(x => x.id === id)!
        dung('6d. bài dòng đầu = tên hàng ⇒ nối về mã + gợi ý giá thật', c('C1').product?.sku === 'KHOAN10' && /26\.000đ/.test(c('C1').suggestion || ''), JSON.stringify(c('C1')))
        dung('6e. bình luận đã qua sổ tự trả lời ⇒ đánh dấu đã xử lý', !!c('C2').handled)
        dung('6f. bình luận của chính page ⇒ fromPage', c('C3').fromPage === true)
        dung('6g. có SĐT ⇒ hasPhone; bài không nối được mã ⇒ không gợi ý', c('C4').hasPhone && !c('C7').suggestion && !c('C7').product)
        const tl = await taoKeHoachTraLoi(ctx, { commentId: 'C2', message: 'Dạ 26.000đ ạ' })
        const tlKq = await thucThiFb(ctx, tl.id)
        dung('6h. bình luận đã có trong sổ chung ⇒ "skipped", KHÔNG gọi Facebook', tlKq.status === 'skipped' && !ghiFb().some(g => g[0] === 'reply'), JSON.stringify(tlKq.result))
        loiTraLoi = Object.assign(new Error('(#200) Permissions error'), { code: 200, fbtraceId: 'y' })
        const tl2 = await taoKeHoachTraLoi(ctx, { commentId: 'C1', message: 'Dạ 26.000đ ạ' })
        const tl2Kq = await thucThiFb(ctx, tl2.id)
        loiTraLoi = null
        dung('6i. Facebook từ chối ⇒ thất bại + TRẢ chỗ trong sổ (lần sau trả lời được)', tl2Kq.status === 'failed' && !soTraLoi.some(r => r.commentId === 'C1'), JSON.stringify(soTraLoi))
        const tl3 = await taoKeHoachTraLoi(ctx, { commentId: 'C1', message: 'Dạ 26.000đ ạ' })
        const tl3Kq = await thucThiFb(ctx, tl3.id)
        dung('6j. trả lời được ⇒ sổ ghi pilot_reply thành công', tl3Kq.status === 'succeeded' && soTraLoi.some(r => r.commentId === 'C1' && r.action === 'pilot_reply' && r.success === true))
    }

    // ─── 7. Chu kỳ ──────────────────────────────────────────────────────────────
    {
        datLai(); goiFb.length = 0; bayGio = NOW
        const ctx = ngCanh()
        await luuCauHinhFb(ctx, { policy: { automation: { posts: true, replyPriceQuestions: true, hidePhoneComments: true } } })
        const xemTruoc = await chayChuKyFb(ctx)
        dung('7a. Xem trước: chu kỳ chỉ lập nháp, KHÔNG gọi ghi Facebook', ghiFb().length === 0 && ctx.kho._keHoach.every(k => k.status === 'draft') && ctx.kho._keHoach.some(k => k.kind === 'post'), JSON.stringify(xemTruoc.results))
        dung('7b. Xem trước: bài sản phẩm lập đúng số khung trống (2 mã đủ điều kiện)', ctx.kho._keHoach.filter(k => k.kind === 'post').length === 2)

        const ctx2 = ngCanh()
        soTraLoi.push({ pageId: 'PG1', commentId: 'C2', action: 'reply', success: true })
        hang[0].stock = 40
        await luuCauHinhFb(ctx2, { executionMode: 'auto', policy: { maxRepliesPerCycle: 5, automation: { posts: true, replyPriceQuestions: true, hidePhoneComments: true } } })
        const kq = await chayChuKyFb(ctx2)
        const traLoi = ghiFb().filter(g => g[0] === 'reply').map(g => g[1])
        const an = ghiFb().filter(g => g[0] === 'hide').map(g => g[1])
        dung('7c. Tự động: trả lời ĐÚNG bình luận hỏi giá của khách chưa ai trả lời (C1)', JSON.stringify(traLoi) === '["C1"]', JSON.stringify(traLoi))
        dung('7d. KHÔNG tự trả lời: đã có trong sổ (C2), của page (C3), đã có người trả lời (C5), không rõ người viết (C6), bài không nối mã (C7)',
            !['C2', 'C3', 'C5', 'C6', 'C7'].some(id => traLoi.includes(id)))
        dung('7e. C5 / C6 thành nháp CHỜ NGƯỜI DUYỆT', ctx2.kho._keHoach.filter(k => k.kind === 'reply' && k.status === 'draft').map(k => k.data.commentId).sort().join(',') === 'C5,C6',
            ctx2.kho._keHoach.filter(k => k.kind === 'reply').map(k => `${k.data.commentId}:${k.status}`).join(','))
        dung('7f. ẩn bình luận lộ SĐT của khách (C4) — KHÔNG ẩn khi không rõ người viết (C9, có thể là số của chính page)', JSON.stringify(an) === '["C4"]', JSON.stringify(an))
        dung('7g. Tự động: lên lịch 2 bài thật', ghiFb().filter(g => g[0] === 'post').length === 2, JSON.stringify(kq.results.filter((r: any) => r.action === 'post')))
        goiFb.length = 0
        await chayChuKyFb(ctx2)
        dung('7h. chạy lại chu kỳ: không trả lời / ẩn / đăng lặp', ghiFb().length === 0 && baiDaHen.length === 2, JSON.stringify(ghiFb()))
        hang[0].stock = 0
        baiTrenFb[0].comments.data.push({ id: 'C8', message: 'giá nhiêu', from: { id: 'U8', name: 'Giang' }, created_time: new Date(NOW - H).toISOString(), comment_count: 0 })
        goiFb.length = 0
        await chayChuKyFb(ctx2)
        dung('7i. hàng tồn 0 ⇒ không tự trả lời, để nháp', !ghiFb().some(g => g[0] === 'reply') && ctx2.kho._keHoach.some(k => k.kind === 'reply' && k.data.commentId === 'C8' && k.status === 'draft'))
    }

    // ─── 8. Chạy theo lịch ──────────────────────────────────────────────────────
    {
        datLai(); goiFb.length = 0; bayGio = NOW
        const kho = khoBoNhoFb()
        const ctx = ngCanh(kho)
        dung('8a. chưa có cấu hình ⇒ không dùng', (await chayTheoLichFb(prisma, kho, { taoFb: fbGia, bayGio: () => bayGio })) === 'khong-dung')
        await luuCauHinhFb(ctx, { schedule: { enabled: true, intervalMinutes: 120 } })
        dung('8b. bật lịch ⇒ hẹn lượt kế = bây giờ + nhịp', (await kho.docCauHinh())?.nextRunAt === NOW + 120 * 60_000)
        dung('8c. chưa tới hẹn ⇒ chưa chạy', (await chayTheoLichFb(prisma, kho, { taoFb: fbGia, bayGio: () => bayGio })) === 'chua-toi')
        bayGio = NOW + 121 * 60_000
        const r = await chayTheoLichFb(prisma, kho, { taoFb: fbGia, bayGio: () => bayGio })
        const c = await kho.docCauHinh()
        dung('8d. tới hẹn ⇒ chạy, ghi kết quả, hẹn lượt kế', r === 'da-chay' && c?.lastRunAt === bayGio && c?.nextRunAt === bayGio + 120 * 60_000 && c?.lastResult?.ok === true, `${r} ${JSON.stringify(c?.lastResult).slice(0, 200)}`)
        dung('8e. lịch chạy ở chế độ Xem trước ⇒ không gọi ghi Facebook', ghiFb().length === 0)
        bayGio = NOW
    }

    // ─── 9. Tiện ích + không lộ token ──────────────────────────────────────────
    {
        datDemTienIch('CH_SHOPEE', ['shopee_pilot'])
        datDemTienIch('CH_FB', ['facebook_pilot'])
        const a = await lyDoChanPilot('CH_SHOPEE', TIEN_ICH_FACEBOOK_PILOT)
        dung('9a. bật Shopee Pilot KHÔNG mở Facebook Pilot', a?.ma === 'chua_bat_tien_ich' && /Facebook Pilot/.test(a.loi), JSON.stringify(a))
        dung('9b. bật facebook_pilot ⇒ dùng được', (await lyDoChanPilot('CH_FB', TIEN_ICH_FACEBOOK_PILOT)) === null)
        const s = await lyDoChanPilot('CH_FB')
        dung('9c. mặc định vẫn là Shopee Pilot (câu cũ giữ nguyên)', s?.loi === LOI_CHUA_BAT_PILOT)
        dung('9d. duyệt nâng cấp giữ facebook_pilot đang bật, không để yêu cầu tự bật',
            giuTienIchQuanTri(['online'], ['facebook_pilot']).includes('facebook_pilot') && !giuTienIchQuanTri(['facebook_pilot'], []).includes('facebook_pilot'))
        datLai()
        const st = await xayTrangThaiFb(ngCanh())
        dung('9e. trạng thái gửi giao diện KHÔNG có page token', !JSON.stringify(st).includes('TOKEN-BI-MAT-PG1') && st.status.page?.pageId === 'PG1')
        goiFb.length = 0
        const kn = await kiemKetNoiFb(ngCanh())
        dung('9f. kiểm kết nối chỉ ĐỌC (không gọi ghi Facebook), đủ các bước', kn.tong >= 4 && ghiFb().length === 0 && kn.buoc[0].ok === true, JSON.stringify(kn))
    }

    // ─── 10. Nối dây (soát mã nguồn) ───────────────────────────────────────────
    {
        const goc = path.join(__dirname, '..', 'src')
        const doc = (f: string) => fs.readFileSync(path.join(goc, f), 'utf8')
        const idx = doc('index.ts')
        dung('10a. route /api/facebook-pilot đã gắn', /app\.use\('\/api\/facebook-pilot', facebookPilotRoutes\)/.test(idx) && /import facebookPilotRoutes from '\.\/routes\/facebookPilot'/.test(idx))
        const cron = doc('cron/aiAgentCron.ts')
        dung('10b. lịch chỉ chạy cửa hàng đã bật facebook_pilot', /includes\(TIEN_ICH_FACEBOOK_PILOT\)\) \{[\s\S]{0,200}chayTheoLichFb\(/.test(cron))
        dung('10c. /admin/migrate tạo bảng Facebook Pilot', /for \(const sql of SQL_TAO_BANG_FB_PILOT\)/.test(doc('routes/admin.ts')))
        const rt = doc('routes/facebookPilot.ts')
        dung('10d. route chặn theo tiện ích facebook_pilot', /lyDoChanPilot\(req\.user\?\.storeCode, TIEN_ICH_FACEBOOK_PILOT\)/.test(rt))
        const ghi = ['cycle', 'execute', 'post', 'reply', 'hide', 'cancel', 'config'].every(v => new RegExp(`(^|\\s|')${v}'?: \\{\\s*ghi: true`, 'm').test(rt))
        dung('10e. mọi thao tác ghi đánh dấu ghi: true (quản lý mới được)', ghi)
        // chỉ cần có mặt trong danh sách — thêm tiện ích khác (TikTok Pilot 02/11) không được làm đỏ ca này
        dung('10f. tiện ích chỉ-quản-trị có facebook_pilot', /TIEN_ICH_CHI_QUAN_TRI: readonly string\[\] = \[[^\]\n]*\bTIEN_ICH_FACEBOOK_PILOT\b[^\]\n]*\]/.test(doc('lib/tienIchCuaHang.ts')))
        // 09/11/2026: 'cycle:' là dấu "máy lập" (tự huỷ khi quá hạn, nhớ người huỷ) ⇒ lên bài / trả lời / ẩn từ web phải qua khoaWeb
        const khoiFb = rt.slice(rt.indexOf('const VIEC: Record'), rt.indexOf('const VIEC_ADS'))
        dung('10g. post / reply / hide từ web đi qua khoaWeb (trình duyệt không giả được khoá "cycle:" của máy)',
            (khoiFb.match(/idempotencyKey: khoaWeb\(b\?\.idempotencyKey\)/g) || []).length === 3 && !/idempotencyKey: b\?\.idempotencyKey/.test(khoiFb))
        const svc = doc('services/platforms/facebook.ts')
        dung('10h. FacebookService: token hỏng theo MÃ (không theo type OAuthException), fetch có hẹn giờ',
            !/type === 'OAuthException'/.test(svc) && /signal: AbortSignal\.timeout\(ms\)/.test(svc) && /AbortSignal\.timeout\(CHO_DOC_MS\)/.test(svc))
    }

    // ─── 11. Lỗi Graph qua FacebookService THẬT (fetch giả) — 09/11/2026 ───────────
    {
        datLai(); bayGio = NOW
        batGraphGia()
        try {
            // KHÔNG taoFb ⇒ dichVu() dựng FacebookService thật bằng page token; mọi lời gọi rơi vào fetch giả ở trên
            const ctx: NgCanhFb = { prisma, kho: khoBoNhoFb(), nguoi: 'chu@shop', bayGio: () => bayGio }
            await luuCauHinhFb(ctx, { executionMode: 'auto' })
            const thuc = async (sku: string) => thucThiFb(ctx, (await taoKeHoachBai(ctx, { sku, publishNow: true })).id)
            const daGoi = (m: string, re: RegExp) => goiGraph.some(g => g.method === m && re.test(g.duong))

            dapGraph = (m, d) => (m === 'POST' && /\/photos$/.test(d) ? loiGraph(400, 100, '(#100) Invalid image URL — could not download image') : graphOn(m, d))
            goiGraph.length = 0
            const a = await thuc('KHOAN10')
            dung('11a. #100 lúc tải ảnh (type OAuthException) ⇒ kế hoạch failed, fanpage KHÔNG token_expired, chưa gọi /feed',
                a.status === 'failed' && pages[0].status === 'active' && /dữ liệu của riêng kế hoạch/.test(a.result?.message) && !daGoi('POST', /\/feed$/),
                `${a.status} · trang ${pages[0].status} · ${a.result?.message}`)
            dapGraph = graphOn
            const b = await thuc('OC4')
            dung('11b. …kế hoạch kế tiếp vẫn chạy (trang không bị chặn)', b.status === 'succeeded' && /^PG1_9/.test(b.result?.postId || ''), `${b.status} ${JSON.stringify(b.result)}`)

            dapGraph = (m, d) => (m === 'POST' && /\/photos$/.test(d)
                ? loiGraph(400, 190, 'Error validating access token: The session has been invalidated because the user changed their password.', { error_subcode: 460 }) : graphOn(m, d))
            const c = await thuc('KHOAN10')
            dung('11c. #190 (subcode 460) ⇒ failed + fanpage token_expired + nhắc dán token mới', c.status === 'failed' && pages[0].status === 'token_expired' && /dán page token mới/.test(c.result?.message),
                `${c.status} · trang ${pages[0].status} · ${c.result?.message}`)
            pages[0].status = 'active'

            dapGraph = (m, d) => (m === 'POST' && /\/photos$/.test(d) ? loiGraph(400, 4, '(#4) Application request limit reached', { is_transient: true }) : graphOn(m, d))
            const d4 = await thuc('KHOAN10')
            dung('11d. #4 hạn mức ⇒ trang giữ nguyên, kế hoạch về NHÁP (thử lại sau) chứ không failed', d4.status === 'draft' && d4.result?.tamThoi === true && pages[0].status === 'active',
                `${d4.status} · trang ${pages[0].status} · ${JSON.stringify(d4.result)}`)

            dapGraph = (m, d) => (m === 'POST' && /\/comments$/.test(d) ? loiGraph(403, 200, '(#200) Requires pages_manage_engagement permission to manage the object') : graphOn(m, d))
            const tl = await thucThiFb(ctx, (await taoKeHoachTraLoi(ctx, { commentId: 'C1', message: 'Dạ 26.000đ ạ' })).id)
            dung('11e. #200 ⇒ failed, nói đúng quyền thiếu, trang giữ nguyên, trả chỗ trong sổ trả lời', tl.status === 'failed' && /pages_manage_engagement/.test(tl.result?.message)
                && pages[0].status === 'active' && !soTraLoi.some(r => r.commentId === 'C1'), `${tl.status} · ${tl.result?.message}`)

            dapGraph = (m, d) => (m === 'POST' && /\/feed$/.test(d) ? loiGraph(500, 2, 'An unexpected error has occurred. Please retry your request later.', { is_transient: true }) : graphOn(m, d))
            const f = await thuc('OC4')
            dung('11f. lệnh ghi gặp HTTP 500 ⇒ "uncertain" (có thể đã lên), không failed, trang giữ nguyên', f.status === 'uncertain' && pages[0].status === 'active', `${f.status} · ${f.result?.message}`)
            dapGraph = (m, d) => (m === 'POST' && /\/feed$/.test(d) ? { html: 502 } : graphOn(m, d))
            const g = await thuc('OC4')
            dung('11g. lệnh ghi nhận phản hồi KHÔNG phải JSON (502 HTML) ⇒ "uncertain"', g.status === 'uncertain', `${g.status} · ${g.result?.message}`)
            dapGraph = (m, d) => (m === 'POST' && /\/feed$/.test(d) ? { nem: 'het_gio' } : graphOn(m, d))
            const h = await thuc('OC4')
            dung('11h. lệnh ghi hết giờ (AbortSignal.timeout) ⇒ "uncertain"', h.status === 'uncertain' && /không trả lời sau/.test(h.result?.message), `${h.status} · ${h.result?.message}`)
            dung('11i. mọi lời gọi Graph đều mang hẹn giờ (signal)', goiGraph.length > 0 && goiGraph.every(x => x.coHenGio), JSON.stringify(goiGraph.filter(x => !x.coHenGio)))

            // cron đối soát: hạn mức #32 (type OAuthException) từng bị coi là token hỏng
            baiDaHen.push({ id: 'sp-hen', pageId: 'PG1', fbPostId: 'PG1_777', status: 'scheduled', scheduledAt: new Date(NOW + 5 * H) })
            dapGraph = (m, d) => (m === 'GET' && /\/scheduled_posts$/.test(d) ? loiGraph(400, 32, '(#32) Page request limit reached') : graphOn(m, d))
            await reconcilePage(prisma, pages[0])
            dung('11j. fanpageCron: #32 hạn mức trang ⇒ KHÔNG đánh dấu token_expired', pages[0].status === 'active', pages[0].status)
            dapGraph = (m, d) => (m === 'GET' && /\/scheduled_posts$/.test(d) ? loiGraph(400, 190, 'Error validating access token: Session has expired', { error_subcode: 463 }) : graphOn(m, d))
            await reconcilePage(prisma, pages[0])
            dung('11k. fanpageCron: #190 ⇒ token_expired (ca trên không xanh oan vì cron hết nhạy)', pages[0].status === 'token_expired', pages[0].status)
            pages[0].status = 'active'

            // chu kỳ Tự động: hạn mức ⇒ dừng ghi ngay lượt đó, giữ nháp; lượt sau thực thi lại ĐÚNG nháp đó
            datLai(); bayGio = NOW
            const c2: NgCanhFb = { prisma, kho: khoBoNhoFb(), nguoi: 'lich', bayGio: () => bayGio }
            const kho2 = c2.kho as ReturnType<typeof khoBoNhoFb>
            await luuCauHinhFb(c2, { executionMode: 'auto', policy: { automation: { posts: true, replyPriceQuestions: false, hidePhoneComments: false } } })
            dapGraph = (m, d) => (m === 'POST' && /\/photos$/.test(d) ? loiGraph(400, 17, '(#17) User request limit reached', { is_transient: true }) : graphOn(m, d))
            goiGraph.length = 0
            const k1 = await chayChuKyFb(c2)
            const nhap1 = kho2._keHoach.filter(k => k.kind === 'post')
            dung('11l. chu kỳ gặp #17 ⇒ dừng sau lần ghi đầu, nháp giữ lại, trang giữ nguyên, KHÔNG báo chủ shop như hỏng',
                goiGraph.filter(x => x.method === 'POST').length === 1 && nhap1.length === 1 && nhap1[0].status === 'draft' && nhap1[0].result?.tamThoi === true
                && pages[0].status === 'active' && k1.results.some((x: any) => x.action === 'cycle' && x.status === 'skipped') && !k1.results.some(canNguoi), JSON.stringify(k1.results))
            dapGraph = graphOn
            bayGio += 31 * 60_000
            const k2 = await chayChuKyFb(c2)
            dung('11m. lượt sau Graph ổn ⇒ thực thi lại đúng nháp đó (không lập đôi), lập tiếp mã còn lại',
                (await kho2.layKeHoach(nhap1[0].id))?.status === 'succeeded' && kho2._keHoach.filter(k => k.kind === 'post').length === 2
                && kho2._keHoach.every(k => k.status === 'succeeded') && k2.results.some((x: any) => /Thực thi lại nháp máy/.test(x.message || '')), JSON.stringify(k2.results))

            const c3: NgCanhFb = { prisma, kho: khoBoNhoFb(), nguoi: 'lich', bayGio: () => bayGio }
            await luuCauHinhFb(c3, { executionMode: 'auto', policy: { automation: { posts: false, replyPriceQuestions: true, hidePhoneComments: true } } })
            dapGraph = (m, d) => (m === 'GET' && /\/posts$/.test(d) ? loiGraph(400, 613, 'Calls to this api have exceeded the rate limit.') : graphOn(m, d))
            const k3 = await chayChuKyFb(c3)
            dung('11n. đọc bình luận gặp #613 ⇒ "skipped" (lượt sau đọc lại), không báo hỏng, trang giữ nguyên',
                k3.results.some((x: any) => x.action === 'comments' && x.status === 'skipped') && !k3.results.some(canNguoi) && pages[0].status === 'active', JSON.stringify(k3.results))
        } finally {
            traFetch()
        }
    }

    // ─── 12. Dọn kế hoạch mở — CÙNG MỘT kho qua nhiều lượt (09/11/2026) ───────────
    {
        datLai(); goiFb.length = 0; bayGio = NOW
        // thêm 14 mã đủ điều kiện ⇒ 16 mã: đủ 6 khung giờ của 3 ngày (2 bài/ngày) mà các lượt sau vẫn còn mã để lập
        for (let i = 1; i <= 14; i++) {
            hang.push({
                id: `q${i}`, sku: `KEP${i}`, name: `Kìm điện số ${i}`, description: 'Thép CR-V, cán bọc nhựa.', productType: 'goods', sellingPrice: 50000 + i * 1000,
                stock: 10 + i, mergedIntoId: null, bundleId: null, createdAt: new Date(NOW), images: [{ url: ANH(`kep${i}`), isPrimary: true }],
            })
        }
        const kho = khoBoNhoFb()
        const ctx = ngCanh(kho)
        const dau = dauNgayVN(NOW)
        const lay = (id: string) => kho._keHoach.find(k => k.id === id)!
        const baiNhap = () => kho._keHoach.filter(k => k.kind === 'post' && k.status === 'draft')
        await luuCauHinhFb(ctx, { policy: { postsPerDay: 2, automation: { posts: true, replyPriceQuestions: false, hidePhoneComments: false } } })
        await chayChuKyFb(ctx)
        const xem = baiNhap()
        dung('12a. Xem trước: 6 nháp cho 6 khung giờ 3 ngày, khoá riêng "cycle:xem:post:", không gọi ghi Facebook',
            xem.length === 6 && xem.every(k => String(k.idempotencyKey).startsWith('cycle:xem:post:')) && ghiFb().length === 0, xem.map(k => k.idempotencyKey).join(' '))
        const st1 = await xayTrangThaiFb(ctx)
        dung('12b. nháp chưa đăng KHÔNG tính "vừa lên bài" (chặn 21 ngày) — chỉ "đang có kế hoạch"', st1.excluded?.daDangGanDay === 0 && st1.excluded?.dangCoKeHoach === 6, JSON.stringify(st1.excluded))
        await chayChuKyFb(ctx)
        dung('12c. chạy lại Xem trước ⇒ không lập chồng nháp (nháp còn hạn giữ khung của nó)', baiNhap().length === 6, String(baiNhap().length))
        // nháp NGƯỜI lập (khoá web:) — máy không bao giờ tự huỷ
        const tay = await taoKeHoachBai(ctx, { sku: 'KHOAN10', scheduledAt: dau + 2 * 86400_000 + 20 * H, idempotencyKey: 'web:tay-12' })
        bayGio = NOW + 4 * H // 12:00 — nháp Xem trước 9h đã quá giờ hẹn
        await luuCauHinhFb(ctx, { executionMode: 'auto' })
        dung('12d. 4 giờ sau bật Tự động ⇒ 6 nháp Xem trước bị huỷ, ghi lý do, đánh dấu máy tự huỷ',
            xem.every(k => lay(k.id).status === 'cancelled' && lay(k.id).result?.tuHuy === true && /Xem trước/.test(lay(k.id).result?.message || '')),
            xem.map(k => `${lay(k.id).status}:${lay(k.id).result?.message}`).join(' | '))
        dung('12e. …nháp người lập giữ nguyên', lay(tay.id).status === 'draft')
        goiFb.length = 0
        const r2 = await chayChuKyFb(ctx)
        const len = ghiFb().filter(g => g[0] === 'post')
        const daLen = kho._keHoach.filter(k => k.kind === 'post' && k.status === 'succeeded')
        dung('12f. lượt Tự động đầu tiên có bài lên (20h nay, 9h + 12h mai, 9h ngày kia) — khoá "cycle:post:"',
            len.length === 4 && daLen.length === 4 && daLen.every(k => String(k.idempotencyKey).startsWith('cycle:post:')), JSON.stringify(r2.results))
        dung('12g. …mã của nháp Xem trước vừa huỷ được lập lại; khung + mã của nháp người lập không bị đè',
            daLen.some(k => xem.some(x => x.data.productId === k.data.productId)) && !daLen.some(k => k.data.productId === 'p1')
            && len.every(x => Math.abs(Number(x[1].scheduledAtMs) - tay.data.scheduledAt) >= 3 * H), daLen.map(k => `${k.data.sku}@${(k.data.scheduledAt - dau) / H}h`).join(','))

        // máy chết giữa lượt ghi: một 'running' kẹt 2 giờ; một lượt khác vừa giành 10 phút trước
        const ket = await taoKeHoachBai(ctx, { sku: 'KEP1', publishNow: true, idempotencyKey: 'web:ket-1' })
        const dangChay = await taoKeHoachBai(ctx, { sku: 'KEP2', publishNow: true, idempotencyKey: 'web:ket-2' })
        await kho.gianhKeHoach(ket.id); await kho.gianhKeHoach(dangChay.id)
        // kho bộ nhớ ghi updatedAt theo đồng hồ THẬT (như khoSqlFb) ⇒ lùi tay cho "kẹt quá 1 giờ" theo đồng hồ giả
        lay(ket.id).updatedAt = bayGio - 2 * H
        lay(dangChay.id).updatedAt = bayGio - 10 * 60_000
        const nhapMay = (id: string, kind: string, khoa: string, tao: number, data: any, createdBy = 'lich') =>
            kho._keHoach.push({ id, kind, status: 'draft', idempotencyKey: khoa, createdBy, createdAt: tao, updatedAt: tao, data: { pageId: 'PG1', ...data }, result: null })
        const baiQ3 = { productId: 'q3', sku: 'KEP3', name: 'Kìm điện số 3', price: 53000, stock: 13, message: '🔹 Kìm điện số 3', mediaUrls: [ANH('kep3')], scheduledAt: bayGio - H }
        nhapMay('may-qua-gio', 'post', `cycle:post:q3:${bayGio - H}`, bayGio - 3 * H, baiQ3)
        nhapMay('nguoi-qua-gio', 'post', 'web:tay-qua-gio', bayGio - 3 * H, baiQ3, 'chu@shop')
        nhapMay('may-qua-han', 'reply', 'cycle:reply:CX', bayGio - 4 * 86400_000, { commentId: 'CX', message: 'Dạ shop gửi giá ạ', fromName: 'Khách' })
        goiFb.length = 0
        const r3 = await chayChuKyFb(ctx)
        dung('12h. "running" quá 1 giờ ⇒ uncertain + việc cần người "mở fanpage kiểm bài đã lên chưa", máy không làm lại',
            lay(ket.id).status === 'uncertain' && /mở fanpage kiểm bài đã lên chưa/.test(lay(ket.id).result?.message || '')
            && r3.results.some((x: any) => x.planId === ket.id && x.status === 'uncertain' && canNguoi(x)) && !kho._nhatKy.some(w => w.planId === ket.id) && ghiFb().length === 0,
            JSON.stringify(r3.results))
        dung('12i. "running" mới 10 phút ⇒ để yên (lượt khác có thể đang ghi)', lay(dangChay.id).status === 'running')
        dung('12j. nháp MÁY quá giờ hẹn ⇒ tự huỷ, ghi lý do, không thực thi', lay('may-qua-gio').status === 'cancelled' && lay('may-qua-gio').result?.tuHuy === true
            && /quá giờ hẹn/.test(lay('may-qua-gio').result?.message || '') && !kho._nhatKy.some(w => w.planId === 'may-qua-gio'), JSON.stringify(lay('may-qua-gio').result))
        dung('12k. nháp NGƯỜI lập quá giờ hẹn ⇒ giữ nguyên (người quyết)', lay('nguoi-qua-gio').status === 'draft' && lay(tay.id).status === 'draft')
        dung('12l. nháp MÁY quá 3 ngày ⇒ tự huỷ', lay('may-qua-han').status === 'cancelled' && /quá 3 ngày/.test(lay('may-qua-han').result?.message || ''), JSON.stringify(lay('may-qua-han').result))
        dung('12m. dòng "Huỷ 2 nháp cũ của máy" là skipped — không báo chủ shop như hỏng',
            r3.results.some((x: any) => x.action === 'plan' && /Huỷ 2 nháp cũ/.test(x.message) && !canNguoi(x)), JSON.stringify(r3.results))

        // người huỷ một nháp MÁY đề xuất ⇒ chu kỳ nhớ 14 ngày (kể cả qua lần đổi Xem trước → Tự động)
        await luuCauHinhFb(ctx, { executionMode: 'preview' })
        bayGio = NOW + 52 * H // ngày kia 12:00 ⇒ trống 4 khung (2 ngày sau, mỗi ngày 2 bài)
        await chayChuKyFb(ctx)
        const xem2 = baiNhap().filter(k => String(k.idempotencyKey).startsWith('cycle:xem:'))
        const bo = xem2[0]
        const huy = await huyKeHoachFb(ctx, bo.id)
        dung('12n. người huỷ nháp máy ⇒ ghi "không đề xuất lại … 14 ngày" (không phải máy tự huỷ)', xem2.length === 4 && huy.status === 'cancelled' && /14 ngày/.test(huy.result?.message || '') && !huy.result?.tuHuy,
            `${xem2.length} ${JSON.stringify(huy.result)}`)
        const truoc = new Set(kho._keHoach.map(k => k.id))
        await chayChuKyFb(ctx)
        const moi = kho._keHoach.filter(k => !truoc.has(k.id) && k.kind === 'post')
        dung('12o. lượt sau lấp khung trống bằng mã KHÁC, không đề xuất lại mã người vừa huỷ', moi.length === 1 && moi[0].data.productId !== bo.data.productId
            && (await xayTrangThaiFb(ctx)).excluded?.dangCoKeHoach >= 5, moi.map(k => k.data.sku).join(','))
        const cfg = (await kho.docCauHinh())!
        await kho.luuCauHinh({ ...cfg, executionMode: 'auto' }) // như thể bước huỷ nháp của luuCauHinhFb hỏng giữa chừng
        const conXem = baiNhap().filter(k => String(k.idempotencyKey).startsWith('cycle:xem:'))
        const truoc2 = new Set(kho._keHoach.map(k => k.id))
        goiFb.length = 0
        await chayChuKyFb(ctx)
        const len5 = kho._keHoach.filter(k => !truoc2.has(k.id) && k.kind === 'post' && k.status === 'succeeded')
        dung('12p. (lưới thứ hai) chu kỳ Tự động gặp nháp Xem trước còn sót ⇒ huỷ trước khi lập, rồi lên bài theo số hiện tại',
            conXem.length === 4 && conXem.every(k => lay(k.id).status === 'cancelled' && lay(k.id).result?.tuHuy === true) && len5.length === 4 && ghiFb().filter(g => g[0] === 'post').length === 4,
            `${conXem.length} xem · ${len5.map(k => k.data.sku).join(',')}`)
        dung('12q. …vẫn nhớ mã người đã huỷ dù vừa đổi Xem trước → Tự động', !len5.some(k => k.data.productId === bo.data.productId), len5.map(k => k.data.sku).join(','))
        const pol = cfg.policy
        const conNho = !(await timUngVienFb(ctx, pol, { lim: 50 })).ungVien.some(u => u.productId === bo.data.productId)
        lay(bo.id).updatedAt = bayGio - 15 * 86400_000
        const hetNho = (await timUngVienFb(ctx, pol, { lim: 50 })).ungVien.some(u => u.productId === bo.data.productId)
        dung('12r. trong 14 ngày mã người huỷ bị né; quá 14 ngày ⇒ được đề xuất lại', conNho && hetNho, `${conNho} ${hetNho}`)
        bayGio = NOW
    }

    console.log(`\n${loi === 0 ? '✅' : '❌'} ${dat} đạt, ${loi} hỏng\n`)
    if (loi > 0) process.exitCode = 1
}

main().catch(e => { console.error('LỖI BỘ KIỂM:', e); process.exitCode = 1 })
