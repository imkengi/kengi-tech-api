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
        dung('10f. tiện ích chỉ-quản-trị có facebook_pilot', /TIEN_ICH_CHI_QUAN_TRI: readonly string\[\] = \[TIEN_ICH_SHOPEE_PILOT, TIEN_ICH_FACEBOOK_PILOT\]/.test(doc('lib/tienIchCuaHang.ts')))
    }

    console.log(`\n${loi === 0 ? '✅' : '❌'} ${dat} đạt, ${loi} hỏng\n`)
    if (loi > 0) process.exitCode = 1
}

main().catch(e => { console.error('LỖI BỘ KIỂM:', e); process.exitCode = 1 })
