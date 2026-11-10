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
 * 13. (09/11/2026) Soát bài HẸN sắp lên (soatBaiHenSapLen — nhịp ngoài mỗi phút): giá đổi + chữ còn giá cũ / tồn dưới mức / mã gộp
 *     / mã mất ⇒ RÚT (xoá bài hẹn chưa lên, kế hoạch 'cancelled' + tuHuy, dòng FbScheduledPost 'cancelled', MỘT tin gộp). Phải IM:
 *     chữ không ghi giá, giá lệch < 1đ, bài người khác tạo / nối lệch mã, bài đã lên (published / Facebook không còn liệt kê),
 *     ngoài cửa sổ, chữ đã sửa trên Facebook, Xem trước. Hai lượt song song ⇒ một lệnh xoá; hạn mức ⇒ giữ, nhịp sau rút; token /
 *     không rõ kết cục ⇒ báo KHẨN, không đánh dấu "đã rút"; còn < 3 phút ⇒ không xoá. Nối dây: quetTuNgoai soát TRƯỚC chốt
 *     dangChay, theo tiện ích chứ không theo hasAiJobs, dò bằng registry.
 * 14. (09/11/2026, FB-20) FacebookService THẬT trước thay đổi Graph đã có hiệu lực: identifyToken không gửi metadata=1, suy loại
 *     token từ /me (USER token ⇒ 'user' qua lỗi "node type (User)"; token chết ném nguyên); Insights chỉ xin chỉ số còn sống.
 * 15. (10/11/2026, FB-07 / FB-08 / FB-21) nhận "hỏi giá" hẹp lại (đánh giá / khen / chê / hỏi thông số / "bạn" không còn được trả lời
 *     giá); bài trùng tên nhiều mã hoặc mã Pilot đã đăng không còn bán ⇒ không gắn mã, không gợi ý giá; lịch giữ client suốt lượt.
 * 16. (10/11/2026, FB-16) quản lý kế hoạch: lật trang theo con trỏ (createdAt, id) không lọt / lặp, lọc trạng thái / loại; /state trả
 *     MỌI nháp + đếm; "Đã kiểm" kế hoạch chưa rõ — KHÔNG có ⇒ nhả mã + khung giờ + dòng bài hẹn / chỗ trong sổ trả lời (chỉ dòng
 *     Pilot giữ dở), CÓ ⇒ giữ chặn, bài hẹn người đã kiểm thì lượt soát không xoá; không gọi Facebook, không tốn lượt ghi, CAS một
 *     người thắng; bỏ ẩn đi đường kế hoạch → thực thi, chu kỳ không ẩn lại; token hỏng mang cờ loiToken; câu SQL thật của kho.
 * 17. (10/11/2026, lô 20: FB-06 / X-16) nối fanpage bằng token dán tay (lib/noiPageToken — FacebookService THẬT qua fetch giả):
 *     hạn THẬT từ debug_token (0 ⇒ không hết hạn; còn < 24 giờ ⇒ vẫn lưu + cảnh báo gắt; đọc không được / is_valid=false ⇒ đoán 55
 *     ngày và NÓI RÕ); USER token ⇒ me/accounts lấy page token (MỘT fanpage / pageId gửi kèm; nhiều ⇒ FB_CHON_PAGE kèm {id,name}, không
 *     lộ token; USER token KHÔNG lưu); debug_token thử USER token trước rồi page token; lỗi rõ cho 0 fanpage / thiếu page token /
 *     thiếu pages_show_list / lệch pageId / token chết / khoảng trắng / token APP; route trả 400 kèm danh sách, không trả token.
 * 18. (10/11/2026, lô 21: FB-15) sửa GIÁ trên bài Pilot đã lên (Facebook giả giữ chữ SỐNG từng bài): không lệch ⇒ 0 lời gọi; Tự động
 *     ⇒ đọc danh sách MỘT lần, sửa đúng dòng "Giá: …" (chữ khác giữ nguyên), nối mắt xích lần sửa; Xem trước ⇒ nháp để xem, không ghi,
 *     không thành việc cần người; giá về lại ⇒ nháp tự huỷ; người sửa tay sang giá mới ⇒ ghi nhận; viết lại kiểu khác / bỏ dòng giá
 *     ⇒ thôi theo dõi; bài mất / hẹn chưa quá 30 phút / quá 30 ngày / fanpage khác ⇒ không đụng; tồn ≤ 0 ⇒ chỉ nêu, không ghi "hết
 *     hàng"; hết lượt ghi ⇒ nháp + báo, lượt sau thực thi chính nháp đó; người huỷ ⇒ nhớ 14 ngày; hỏng ⇒ 24 giờ, 5 lần thì thôi;
 *     chưa rõ ⇒ chờ «Đã kiểm»; giá đổi lúc thực thi ⇒ không sửa; nháp lỗi thời không bị thực thi lại; 10 bài / chu kỳ; câu SQL.
 */
import * as fs from 'fs'
import * as path from 'path'
import {
    khoBoNhoFb, chuanHoaChinhSachFb, chuanHoaHashtag, soanBai, boHtml, khungGioTrong, dauNgayVN, anhHopLe, coSoDienThoai, laHoiGia, laPhanNan,
    cauTraLoiGia, timUngVienFb, taoKeHoachBai, thucThiFb, luuCauHinhFb, docBinhLuan, taoKeHoachTraLoi, chayChuKyFb, chayTheoLichFb,
    xayTrangThaiFb, huyKeHoachFb, docGio, kiemKetNoiFb, CHINH_SACH_FB_MAC_DINH, type NgCanhFb, type DichVuFb,
    soatBaiHenSapLen, chuCoGia, lyDoRutBai, sqlDemBaiHenSapLen, laThieuBang,
    taoKeHoachBoAn, xacNhanDaKiemFb, dsKeHoachFb, khoSqlFb, HUONG_DAN_FB_PILOT,
    dongGiaBai, coDongGia, thayGiaTrongBai, giaBaiTheoPilot,
} from '../src/lib/facebookPilot'
import { NHAN_FACEBOOK } from '../src/lib/pilotDoiCauHinh'
import { ToolError } from '../src/lib/mcpTypes'
import { lyDoChanPilot, datDemTienIch, giuTienIchQuanTri, TIEN_ICH_FACEBOOK_PILOT, LOI_CHUA_BAT_PILOT } from '../src/lib/tienIchCuaHang'
import { canNguoi } from '../src/lib/pilotBaoChuShop'
import { reconcilePage } from '../src/cron/fanpageCron'
import { FacebookService } from '../src/services/platforms/facebook'
import { noiPageTokenDanTay, LoiNoiToken } from '../src/lib/noiPageToken'

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

const ANH = (n: string) => `https://storage.googleapis.com/kengi-tech-assets/anh-sp/x/${n}.jpg`
let hang: any[] = []
let banChay: any[] = []
let nhapAi: any[] = []
let hoSo: any = null
const baiDaHen: any[] = []
const soTraLoi: any[] = []
const pages: any[] = []
const thongBao: any[] = []

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
    henTrenFb.clear()
    baiSong.clear(); baiSongBat = false; loiSua = null; loiDocBai = null; baiDay100 = false
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
        updateMany: async ({ where, data }: any) => { let count = 0; for (const b of baiDaHen) if (khop(b, where)) { Object.assign(b, data); count++ } return { count } },
    },
    notification: { create: async ({ data }: any) => { const t = { id: `tb${thongBao.length + 1}`, ...data }; thongBao.push(t); return t } },
    fbAutoReplyLog: {
        findMany: async ({ where, select }: any) => soTraLoi.filter(r => khop(r, where)).map(r => chon(r, select)),
        create: async ({ data }: any) => {
            if (soTraLoi.some(r => r.pageId === data.pageId && r.commentId === data.commentId)) throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' })
            soTraLoi.push({ ...data }); return data
        },
        update: async ({ where, data }: any) => { const r = soTraLoi.find(x => x.pageId === where.pageId_commentId.pageId && x.commentId === where.pageId_commentId.commentId); if (r) Object.assign(r, data); return r },
        delete: async ({ where }: any) => { const i = soTraLoi.findIndex(x => x.pageId === where.pageId_commentId.pageId && x.commentId === where.pageId_commentId.commentId); if (i >= 0) soTraLoi.splice(i, 1); return {} },
        updateMany: async ({ where, data }: any) => { let count = 0; for (const r of soTraLoi) if (khop(r, where)) { Object.assign(r, data); count++ } return { count } },
        deleteMany: async ({ where }: any) => { let count = 0; for (let i = soTraLoi.length - 1; i >= 0; i--) if (khop(soTraLoi[i], where)) { soTraLoi.splice(i, 1); count++ } return { count } },
    },
}

/* ── Facebook giả ── */
const goiFb: any[] = []
let loiDang: any = null
let loiTraLoi: any = null
let baiTrenFb: any[] = []
let soBai = 0
/* Phía FACEBOOK của bài hẹn (13 — soát bài hẹn sắp lên): bài hẹn giao xong nằm ở đây tới khi bị xoá; bộ kiểm tự gỡ để giả "đã lên"
 * / "chủ shop xoá tay", tự sửa chữ để giả "sửa thẳng trên Facebook". henFbBat = false (mặc định) ⇒ scheduled_posts trả [] như cũ. */
const henTrenFb = new Map<string, { id: string; message: string; scheduledPublishTime: number }>()
let henFbBat = false
let loiDsHen: any = null
let loiXoa: any = null
/* Phía FACEBOOK của bài ĐÃ LÊN (18 — sửa giá bài, FB-15): mỗi bài Pilot đăng được giữ chữ đã gửi; bộ kiểm tự sửa chữ để giả "chủ
 * shop sửa tay trên Facebook", tự xoá để giả "bài đã xoá". baiSongBat = false (mặc định) ⇒ get trả baiTrenFb như cũ (mục 1–17).
 * baiDay100 ⇒ danh sách /posts trả đủ 100 bài KHÁC (bài cần sửa nằm ngoài trang đầu). */
const baiSong = new Map<string, { id: string; message: string; permalink_url: string }>()
let baiSongBat = false
let loiSua: any = null
let loiDocBai: any = null
let baiDay100 = false
const fbGia = (token: string): DichVuFb => ({
    get: async (p: string, params?: any) => {
        goiFb.push(['get', p, params, token])
        if (baiSongBat && !/comments/.test(String(params?.fields || ''))) {
            if (p === 'PG1/posts') {
                if (loiDocBai) throw loiDocBai
                return {
                    data: baiDay100
                        ? Array.from({ length: 100 }, (_, i) => ({ id: `PG1_KHAC${i}`, message: 'bài khác', permalink_url: `https://www.facebook.com/PG1_KHAC${i}` }))
                        : [...baiSong.values()].map(b => ({ ...b })),
                }
            }
            if (/^PG1_\d+$/.test(p)) {
                const b = baiSong.get(p)
                if (!b) throw Object.assign(new Error('(#100) Object with ID does not exist'), { code: 100 })
                return { ...b }
            }
        }
        return { data: baiTrenFb }
    },
    identifyToken: async () => ({ type: 'page', id: 'PG1', name: 'Kengi Fanpage' }),
    createOrSchedulePost: async (input: any) => {
        goiFb.push(['post', input]); if (loiDang) throw loiDang; soBai++
        const id = `PG1_${100 + soBai}`
        if (input.scheduledAtMs) henTrenFb.set(id, { id, message: input.message, scheduledPublishTime: Math.floor(input.scheduledAtMs / 1000) })
        baiSong.set(id, { id, message: input.message, permalink_url: `https://www.facebook.com/${id}` })
        return { id }
    },
    editPost: async (id: string, msg: string) => {
        goiFb.push(['edit', id, msg]); if (loiSua) throw loiSua
        const b = baiSong.get(id); if (b) b.message = msg
        return { success: true }
    },
    replyToComment: async (id: string, msg: string) => { goiFb.push(['reply', id, msg]); if (loiTraLoi) throw loiTraLoi; return { id: `r_${id}` } },
    hideComment: async (id: string, hidden = true) => { goiFb.push([hidden ? 'hide' : 'unhide', id]); return { success: true } },
    // lệnh ĐỌC ⇒ ghi 'get' (ghiFb() chỉ đếm lệnh ghi)
    listScheduledPosts: async (pageId: string) => {
        goiFb.push(['get', `${pageId}/scheduled_posts`, null, token]); if (loiDsHen) throw loiDsHen
        return henFbBat ? [...henTrenFb.values()].map(x => ({ ...x })) : []
    },
    deletePost: async (id: string) => { goiFb.push(['delete', id]); if (loiXoa) throw loiXoa; henTrenFb.delete(id); return { success: true } },
})
const lenhXoa = () => goiFb.filter(g => g[0] === 'delete').map(g => g[1] as string)
const ghiFb = () => goiFb.filter(g => g[0] !== 'get')

/* ── Graph giả ở TẦNG fetch (09/11/2026): ca lỗi Graph đi qua FacebookService THẬT (goi → buildError → loaiLoiFb) thay vì
 *    tự gắn isTokenError như dịch vụ giả ở trên. Chỉ trả lời graph(-video).facebook.com — gọi đi đâu khác là ném. ── */
type DapGraph = { status: number; body: any } | { nem: 'het_gio' | 'mang' } | { html: number }
let dapGraph: (method: string, duong: string) => DapGraph = () => ({ status: 200, body: {} })
/** `tham` = tham số query của lời gọi (bỏ access_token) — 09/11/2026 mục 14 soát tham số gửi đi */
const goiGraph: { method: string; duong: string; coHenGio: boolean; tham?: Record<string, string>; token?: string }[] = []
const fetchGoc = globalThis.fetch
function batGraphGia() {
    globalThis.fetch = (async (input: any, init: any = {}) => {
        const url = new URL(String(input?.url || input))
        if (!/^graph(-video)?\.facebook\.com$/.test(url.hostname)) throw new Error(`bộ kiểm chặn lời gọi ra ngoài: ${url.hostname}`)
        const method = String(init.method || 'GET').toUpperCase()
        const duong = url.pathname.replace(/^\/v\d+\.\d+\//, '')
        const tham = Object.fromEntries([...url.searchParams].filter(([k]) => k !== 'access_token'))
        // token = access_token của lời GET (mục 17 soát lời nào dùng token nào — ghi vào nhật ký giả, KHÔNG in ra)
        goiGraph.push({ method, duong, coHenGio: init.signal instanceof AbortSignal, tham, token: url.searchParams.get('access_token') || undefined })
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
        const ghi = ['cycle', 'execute', 'post', 'reply', 'hide', 'unhide', 'cancel', 'resolve', 'config'].every(v => new RegExp(`(^|\\s|')${v}'?: \\{\\s*ghi: true`, 'm').test(rt))
        dung('10e. mọi thao tác ghi đánh dấu ghi: true (quản lý mới được)', ghi)
        // chỉ cần có mặt trong danh sách — thêm tiện ích khác (TikTok Pilot 02/11) không được làm đỏ ca này
        dung('10f. tiện ích chỉ-quản-trị có facebook_pilot', /TIEN_ICH_CHI_QUAN_TRI: readonly string\[\] = \[[^\]\n]*\bTIEN_ICH_FACEBOOK_PILOT\b[^\]\n]*\]/.test(doc('lib/tienIchCuaHang.ts')))
        // 09/11/2026: 'cycle:' là dấu "máy lập" (tự huỷ khi quá hạn, nhớ người huỷ) ⇒ lên bài / trả lời / ẩn từ web phải qua khoaWeb
        const khoiFb = rt.slice(rt.indexOf('const VIEC: Record'), rt.indexOf('const VIEC_ADS'))
        dung('10g. post / reply / hide / unhide từ web đi qua khoaWeb (trình duyệt không giả được khoá "cycle:" của máy)',
            (khoiFb.match(/idempotencyKey: khoaWeb\(b\?\.idempotencyKey\)/g) || []).length === 4 && !/idempotencyKey: b\?\.idempotencyKey/.test(khoiFb))
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

    // ─── 13. Soát bài HẸN sắp lên — rút khi giá / tồn đổi (09/11/2026, FB-02) ─────────
    {
        datLai(); goiFb.length = 0; henFbBat = true; thongBao.length = 0; loiXoa = null; loiDsHen = null; bayGio = NOW
        const PHUT = 60_000
        const dau = dauNgayVN(NOW)
        const G = (h: number, m = 0) => dau + h * H + m * PHUT
        for (let i = 1; i <= 20; i++) {
            hang.push({
                id: `r${i}`, sku: `R${i}`, name: `Kìm cắt số ${i}`, description: 'Thép CR-V.', productType: 'goods', sellingPrice: 30000 + i * 1000,
                stock: 20, mergedIntoId: null, bundleId: null, createdAt: new Date(NOW), images: [{ url: ANH(`r${i}`), isPrimary: true }],
            })
        }
        const sp = (id: string) => hang.find(h => h.id === id)!
        const kho = khoBoNhoFb()
        const ctx = ngCanh(kho)
        const lay = (id: string) => kho._keHoach.find(k => k.id === id)!
        const guongCua = (k: any) => baiDaHen.find(b => b.id === k.result?.scheduledPostId)
        const soat = () => soatBaiHenSapLen(prisma, kho, { taoFb: fbGia, bayGio: () => bayGio })
        await luuCauHinhFb(ctx, { executionMode: 'auto', policy: { maxWritesPerDay: 200 } })
        const hen = async (sku: string, gio: number, message?: string, khoa = `web:soat-${sku}`) =>
            thucThiFb(ctx, (await taoKeHoachBai(ctx, { sku, scheduledAt: gio, idempotencyKey: khoa, ...(message ? { message } : {}) })).id)

        // 08:00 — giao 10 bài hẹn trưa nay. R1 mang khoá MÁY ("cycle:post:") như chu kỳ Tự động lập — rút xong không được thành
        // "người huỷ nháp máy ⇒ nhớ 14 ngày"
        const a1 = await hen('R1', G(12, 30), undefined, `cycle:post:r1:${G(12, 30)}`) // chữ máy soạn ghi giá — giá sẽ đổi
        const a2 = await hen('R2', G(12, 35))    // tồn sẽ về 0
        const a3 = await hen('R3', G(12, 40))    // mã sẽ bị gộp
        const a4 = await hen('R4', G(12, 45))    // mã sẽ bị xoá
        const a5 = await hen('R5', G(12, 50), 'Kìm cắt R5 hàng mới về — inbox shop để được tư vấn nhé') // chữ người viết, không ghi giá
        const a6 = await hen('R6', G(12, 55))    // giá sẽ lệch 0,4đ
        const a7 = await hen('R7', G(12, 58))    // không đổi gì
        const a8 = await hen('R8', G(13, 30))    // giá đổi nhưng giờ lên còn xa
        const a9 = await hen('R9', G(11, 50))    // đã lên, cron đối soát đã đánh 'published'
        const a10 = await hen('R10', G(11, 55))  // đã lên, đêm chưa đối soát ⇒ dòng còn 'scheduled'
        const caA = [a1, a2, a3, a4, a5, a6, a7, a8, a9, a10]
        dung('13a. chuẩn bị: 10 bài hẹn đã giao Facebook — kế hoạch succeeded (published false) + dòng FbScheduledPost scheduled + bài hẹn trên Facebook',
            caA.every(k => k.status === 'succeeded' && k.result?.published === false && guongCua(k)?.status === 'scheduled' && henTrenFb.has(k.result?.postId)),
            caA.map(k => `${k.data?.sku}:${k.status}:${guongCua(k)?.status}`).join(' '))
        // bài KHÔNG phải của Pilot: Fanpage Manager đăng tay (không kế hoạch nào nối tới), và một kế hoạch trỏ dòng nhưng LỆCH mã bài
        const chuR18 = '🔹 Kìm cắt số 18\n💰 Giá: 48.000đ'
        const themNgoai = (id: string, fbPostId: string, gio: number) => {
            baiDaHen.push({ id, pageId: 'PG1', fbPostId, message: chuR18, mediaType: 'text', mediaUrls: '[]', linkUrl: null, scheduledAt: new Date(gio), status: 'scheduled', publishedAt: null, createdBy: 'chu@shop' })
            henTrenFb.set(fbPostId, { id: fbPostId, message: chuR18, scheduledPublishTime: Math.floor(gio / 1000) })
        }
        themNgoai('sp-tay', 'PG1_900', G(12, 42))
        themNgoai('sp-lech', 'PG1_901', G(12, 44))
        kho._keHoach.push({
            id: 'kh-lech', kind: 'post', status: 'succeeded', idempotencyKey: 'web:lech', createdBy: 'chu@shop', createdAt: NOW, updatedAt: NOW,
            data: { pageId: 'PG1', productId: 'r18', sku: 'R18', price: 48000, message: chuR18, scheduledAt: G(12, 44) },
            result: { postId: 'PG1_555', scheduledAt: G(12, 44), published: false, scheduledPostId: 'sp-lech' },
        })
        sp('r1').sellingPrice = 33000                         // 31.000 → 33.000, chữ máy soạn ghi "31.000đ"
        sp('r2').stock = 0
        sp('r3').mergedIntoId = 'p1'
        hang.splice(hang.findIndex(h => h.id === 'r4'), 1)
        sp('r5').sellingPrice = 40000
        sp('r6').sellingPrice = 36000.4
        for (const id of ['r8', 'r9', 'r10', 'r18']) sp(id).sellingPrice = 50000
        guongCua(a9).status = 'published'; henTrenFb.delete(a9.result.postId)
        henTrenFb.delete(a10.result.postId)
        bayGio = G(12, 0) // cửa sổ soát: giờ lên 11:30 → 13:00
        goiFb.length = 0
        const kq1 = await soat()
        const xoa1 = lenhXoa()
        const daRut = (k: any, xoa: string[]) => lay(k.id).status === 'cancelled' && lay(k.id).result?.tuHuy === true && lay(k.id).result?.rutBai?.trangThai === 'da_rut'
            && xoa.includes(k.result.postId) && !henTrenFb.has(k.result.postId) && guongCua(k)?.status === 'cancelled' && /Facebook Pilot rút bài hẹn/.test(guongCua(k)?.errorMessage || '')
        const im = (k: any, xoa: string[]) => lay(k.id).status === 'succeeded' && !lay(k.id).result?.rutBai && !xoa.includes(k.result.postId) && guongCua(k)?.status === 'scheduled'
        dung('13b. giá đổi + chữ máy soạn còn giá cũ ⇒ RÚT: xoá bài hẹn, kế hoạch "đã rút" (cancelled + tuHuy) ghi lý do, dòng FbScheduledPost cancelled',
            daRut(a1, xoa1) && /31\.000đ thành 33\.000đ/.test(lay(a1.id).result?.message || ''), JSON.stringify(lay(a1.id).result))
        dung('13c. tồn tụt dưới mức tối thiểu ⇒ RÚT', daRut(a2, xoa1) && /tồn kho còn 0/.test(lay(a2.id).result?.message || ''), JSON.stringify(lay(a2.id).result))
        dung('13d. mã đã gộp ⇒ RÚT', daRut(a3, xoa1) && /gộp/.test(lay(a3.id).result?.message || ''), JSON.stringify(lay(a3.id).result))
        dung('13e. mã không còn trong kho ⇒ RÚT', daRut(a4, xoa1) && /không còn trong kho/.test(lay(a4.id).result?.message || ''), JSON.stringify(lay(a4.id).result))
        dung('13f. giá đổi nhưng chữ (người viết) KHÔNG ghi giá ⇒ IM', im(a5, xoa1), JSON.stringify(lay(a5.id).result))
        dung('13g. giá lệch < 1đ ⇒ IM', im(a6, xoa1), JSON.stringify(lay(a6.id).result))
        dung('13h. không đổi gì ⇒ IM', im(a7, xoa1))
        dung('13i. giá đổi nhưng giờ lên còn 90 phút (ngoài cửa sổ 60 phút) ⇒ lượt này IM', im(a8, xoa1))
        dung('13j. bài Fanpage Manager (không kế hoạch Pilot) + kế hoạch nối LỆCH mã bài ⇒ không xoá, không đổi gì',
            !xoa1.includes('PG1_900') && !xoa1.includes('PG1_901') && baiDaHen.find(b => b.id === 'sp-tay')?.status === 'scheduled'
            && baiDaHen.find(b => b.id === 'sp-lech')?.status === 'scheduled' && lay('kh-lech').status === 'succeeded' && !lay('kh-lech').result?.rutBai, xoa1.join(','))
        dung('13k. bài đã lên (dòng published) ⇒ không đụng: không xoá, không báo', lay(a9.id).status === 'succeeded' && !lay(a9.id).result?.rutBai && !xoa1.includes(a9.result.postId))
        dung('13l. đã lên mà dòng còn scheduled (Facebook không còn liệt kê, giờ đã qua) ⇒ KHÔNG xoá bài công khai, chỉ báo; kế hoạch "Cần kiểm tra"',
            !xoa1.includes(a10.result.postId) && lay(a10.id).status === 'uncertain' && lay(a10.id).result?.rutBai?.trangThai === 'da_len'
            && /KHÔNG xoá bài đã công khai/.test(lay(a10.id).result?.message || ''), JSON.stringify(lay(a10.id).result))
        dung('13m. đúng 4 lệnh xoá (R1–R4), MỘT lần đọc danh sách bài hẹn cho cả lượt', xoa1.length === 4 && goiFb.filter(g => g[1] === 'PG1/scheduled_posts').length === 1,
            JSON.stringify(goiFb.map(g => `${g[0]}:${typeof g[1] === 'string' ? g[1] : ''}`)))
        const tb = thongBao[0]
        dung('13n. MỘT tin gộp cho chủ shop: warning, tiêu đề "Facebook Pilot KHẨN…" (có bài đã lên với giá cũ), liệt kê đủ 5 bài',
            thongBao.length === 1 && tb.type === 'warning' && /^Facebook Pilot KHẨN/.test(tb.title) && ['R1', 'R2', 'R3', 'R4', 'R10'].every(s => tb.message.includes(`• ${s}:`)) && kq1.daBao === true,
            JSON.stringify(thongBao))
        dung('13o. nhật ký ghi: 4 dòng "withdraw" thành công (mỗi lệnh xoá một dòng)', kho._nhatKy.filter(w => w.action === 'withdraw' && w.status === 'succeeded').length === 4)
        goiFb.length = 0
        await soat()
        dung('13p. lượt kế (cùng giờ) ⇒ không xoá lại, không báo lại, không gọi Facebook', goiFb.length === 0 && thongBao.length === 1, JSON.stringify(goiFb))
        bayGio = G(12, 40) // R8 (13:30) vào cửa sổ
        goiFb.length = 0
        await soat()
        dung('13q. 50 phút trước giờ lên ⇒ R8 bị rút; tin thường "Facebook Pilot: đã rút 1 bài hẹn giờ…"',
            daRut(a8, lenhXoa()) && lenhXoa().length === 1 && thongBao.length === 2 && /^Facebook Pilot: đã rút 1 bài hẹn/.test(thongBao[1].title), JSON.stringify(thongBao[1]))
        const uv = (await timUngVienFb(ctx, (await kho.docCauHinh())!.policy, { lim: 50 })).ungVien
        dung('13r. bài đã rút KHÔNG chặn mã 21 ngày, không bị nhớ như "người huỷ" ⇒ R1 lập lại được theo giá mới; bài "đã lên" (R10) vẫn chặn',
            uv.some(u => u.productId === 'r1') && !uv.some(u => u.productId === 'r10'), uv.map(u => u.sku).join(','))
        {
            const khoXem = khoBoNhoFb()
            const cXem = ngCanh(khoXem)
            await luuCauHinhFb(cXem, { policy: { maxWritesPerDay: 200 } }) // chế độ mặc định: Xem trước
            await chayChuKyFb(cXem)
            goiFb.length = 0
            const kq = await soatBaiHenSapLen(prisma, khoXem, { taoFb: fbGia, bayGio: () => bayGio })
            dung('13s. Xem trước: chu kỳ chỉ lập nháp, không giao gì cho Facebook ⇒ không có bài nào để soát, không gọi Facebook',
                khoXem._keHoach.some(k => k.status === 'draft') && !khoXem._keHoach.some(k => k.status === 'succeeded') && kq.trangThai === 'khong-co' && goiFb.length === 0,
                `${kq.trangThai} ${goiFb.length}`)
        }

        // 14:00 — từng ca lỗi / ca biên, mỗi ca một bài mới
        bayGio = G(14, 0)
        const b1 = await hen('R11', G(14, 40))
        sp('r11').sellingPrice = 50000
        goiFb.length = 0
        const tb0 = thongBao.length
        await Promise.all([soat(), soat()])
        dung('13t. hai lượt soát SONG SONG (hai bản máy) ⇒ đúng MỘT lệnh xoá, MỘT thông báo, kế hoạch "đã rút"',
            lenhXoa().length === 1 && thongBao.length === tb0 + 1 && lay(b1.id).status === 'cancelled' && lay(b1.id).result?.rutBai?.trangThai === 'da_rut',
            `${lenhXoa().length} xoá, ${thongBao.length - tb0} tin, ${lay(b1.id).status}`)

        const b2 = await hen('R12', G(14, 45))
        sp('r12').sellingPrice = 50000
        goiFb.length = 0
        const tb1 = thongBao.length, nk1 = kho._nhatKy.length
        loiXoa = Object.assign(new Error('(#32) Page request limit reached'), { code: 32 })
        await soat()
        loiXoa = null
        dung('13u. Facebook giới hạn lượt gọi khi xoá ⇒ giữ nguyên: kế hoạch succeeded không mang dấu giữ, dòng scheduled, không báo, không ghi nhật ký',
            lenhXoa().length === 1 && lay(b2.id).status === 'succeeded' && !lay(b2.id).result?.rutBai && guongCua(lay(b2.id))?.status === 'scheduled'
            && thongBao.length === tb1 && kho._nhatKy.length === nk1, JSON.stringify(lay(b2.id).result))
        await soat()
        dung('13v. …nhịp sau Facebook nhận ⇒ rút + báo', lay(b2.id).status === 'cancelled' && lay(b2.id).result?.rutBai?.trangThai === 'da_rut' && lenhXoa().length === 2 && thongBao.length === tb1 + 1)

        const b3 = await hen('R13', G(14, 50))
        sp('r13').sellingPrice = 50000
        goiFb.length = 0
        const tb2 = thongBao.length
        loiXoa = Object.assign(new Error('Error validating access token: Session has expired'), { code: 190 })
        await soat()
        loiXoa = null
        const k3 = lay(b3.id)
        dung('13w. token hỏng khi xoá ⇒ báo KHẨN "vào fanpage xoá tay"; kế hoạch "Cần kiểm tra" (KHÔNG "đã rút"); dòng vẫn scheduled; fanpage token_expired',
            k3.status === 'uncertain' && k3.result?.rutBai?.trangThai === 'can_nguoi' && /KHẨN/.test(k3.result?.message || '') && /xoá tay/.test(k3.result?.message || '')
            && guongCua(k3)?.status === 'scheduled' && pages[0].status === 'token_expired' && thongBao.length === tb2 + 1 && /^Facebook Pilot KHẨN/.test(thongBao[thongBao.length - 1].title)
            && kho._nhatKy.some(w => w.action === 'withdraw' && w.status === 'failed' && w.planId === b3.id), JSON.stringify(k3.result))
        await soat()
        dung('13x. …lượt sau không xoá lại, không báo lại', lenhXoa().length === 1 && thongBao.length === tb2 + 1)
        pages[0].status = 'active'

        const b4 = await hen('R14', G(14, 52))
        sp('r14').sellingPrice = 50000
        goiFb.length = 0
        loiXoa = Object.assign(new Error('Facebook không trả lời sau 90 giây (aborted: timeout)'), { khongRoKetCuc: true, hetGio: true })
        await soat()
        loiXoa = null
        dung('13y. lệnh xoá hết giờ (không rõ Facebook đã xoá chưa) ⇒ báo KHẨN, kế hoạch "Cần kiểm tra", nhật ký "uncertain", không tự xoá lại',
            lay(b4.id).status === 'uncertain' && lay(b4.id).result?.rutBai?.trangThai === 'can_nguoi' && /không rõ Facebook đã xoá chưa/.test(lay(b4.id).result?.message || '')
            && kho._nhatKy.some(w => w.planId === b4.id && w.status === 'uncertain') && lenhXoa().length === 1, JSON.stringify(lay(b4.id).result))

        const b5 = await hen('R15', G(14, 55))
        sp('r15').sellingPrice = 50000
        henTrenFb.delete(b5.result.postId) // chủ shop xoá tay thẳng trên Facebook
        goiFb.length = 0
        await soat()
        dung('13z. Facebook không còn bài hẹn mà giờ chưa tới (xoá tay / đăng sớm) ⇒ KHÔNG gửi lệnh xoá, báo kiểm tay',
            lenhXoa().length === 0 && lay(b5.id).status === 'uncertain' && lay(b5.id).result?.rutBai?.trangThai === 'khong_con_hen', JSON.stringify(lay(b5.id).result))

        const b6 = await hen('R16', G(14, 58))
        sp('r16').sellingPrice = 50000
        henTrenFb.get(b6.result.postId)!.message = 'Kìm cắt số 16 — giá mới, inbox shop nhé' // sửa thẳng trên Facebook, bỏ giá
        goiFb.length = 0
        const tb3 = thongBao.length
        await soat()
        dung('13A. chữ đã sửa thẳng trên Facebook, không còn giá cũ ⇒ giữ bài: không xoá, không báo, kế hoạch không mang dấu giữ',
            goiFb.some(g => g[1] === 'PG1/scheduled_posts') && lenhXoa().length === 0 && thongBao.length === tb3 && lay(b6.id).status === 'succeeded' && !lay(b6.id).result?.rutBai,
            JSON.stringify(lay(b6.id).result))

        const b7 = await hen('R17', G(14, 15))
        sp('r17').sellingPrice = 50000
        bayGio = G(14, 13) // còn 2 phút tới giờ lên
        goiFb.length = 0
        await soat()
        dung('13B. còn < 3 phút tới giờ lên ⇒ KHÔNG gửi lệnh xoá (có thể lên giữa chừng), báo KHẨN sửa / xoá tay',
            lenhXoa().length === 0 && lay(b7.id).status === 'uncertain' && lay(b7.id).result?.rutBai?.trangThai === 'qua_gio' && /^Facebook Pilot KHẨN/.test(thongBao[thongBao.length - 1].title),
            JSON.stringify(lay(b7.id).result))

        const b8 = await hen('R19', G(14, 53))
        sp('r19').sellingPrice = 50000
        lay(b8.id).result = { ...lay(b8.id).result, rutBai: { trangThai: 'dang', luot: 'may-khac', luc: bayGio, han: bayGio + 5 * PHUT, lyDo: 'x' } } // bản máy khác đang giữ
        goiFb.length = 0
        await soat()
        dung('13I. kế hoạch đang được lượt khác giữ (chưa hết hạn giữ) ⇒ để yên, không xoá',
            lenhXoa().length === 0 && lay(b8.id).status === 'succeeded' && lay(b8.id).result?.rutBai?.luot === 'may-khac', JSON.stringify(lay(b8.id).result))
        lay(b8.id).result.rutBai.han = bayGio - 1 // bản máy kia chết giữa chừng
        await soat()
        dung('13J. …quá hạn giữ (máy kia chết giữa chừng) ⇒ lượt sau giành lại và rút',
            lenhXoa().length === 1 && lay(b8.id).status === 'cancelled' && lay(b8.id).result?.rutBai?.trangThai === 'da_rut' && !lay(b8.id).result?.rutBai?.luot, JSON.stringify(lay(b8.id).result))

        const b9 = await hen('R20', G(15, 5))
        sp('r20').sellingPrice = 55000 // 50.000 → 55.000
        goiFb.length = 0
        const tb4 = thongBao.length
        loiDsHen = new TypeError('fetch failed')
        await soat()
        loiDsHen = null
        dung('13K. đọc danh sách bài hẹn hỏng (mạng) ⇒ không xoá mù, không báo, nhả để nhịp sau đọc lại',
            goiFb.some(g => g[1] === 'PG1/scheduled_posts') && lenhXoa().length === 0 && thongBao.length === tb4 && lay(b9.id).status === 'succeeded' && !lay(b9.id).result?.rutBai,
            JSON.stringify(lay(b9.id).result))
        await soat()
        dung('13L. …nhịp sau đọc được ⇒ rút', lay(b9.id).status === 'cancelled' && lenhXoa().length === 1 && thongBao.length === tb4 + 1)

        // hàm thuần + nối dây
        dung('13C. chuCoGia: bắt "26.000đ" / "26,000" / "26 000" / "26000" / "26k" / "26 nghìn"; không nhầm "126.000", "26.000.000", "26kg", không có số',
            ['Giá: 26.000đ', 'giá 26,000 VND', 'chỉ 26 000đ', '26000đ', 'chỉ 26k thôi', '26K/cái', '26 nghìn'].every(s => chuCoGia(s, 26000))
            && !['Giá: 126.000đ', 'Giá: 26.000.000đ', 'nặng 26kg', 'inbox shop', 'Giá: 25.000đ'].some(s => chuCoGia(s, 26000)))
        dung('13D. chuCoGia: "1,2tr" / "1tr2" / "1.200.000" / "1 triệu 200 nghìn" cho 1.200.000; "26,5k" / "26k5" cho 26.500; giá 0 ⇒ không',
            ['1,2tr', 'giá 1tr2', '1.200.000đ', '1 triệu 200 nghìn'].every(s => chuCoGia(s, 1_200_000)) && ['26,5k', '26k5', '26.500đ'].every(s => chuCoGia(s, 26500))
            && !chuCoGia('0đ', 0) && !chuCoGia('1,25tr', 1_200_000))
        const pol0 = chuanHoaChinhSachFb({})
        dung('13E. lyDoRutBai: mã → tồn → giá; giá chỉ tính khi chữ còn giá cũ và lệch ≥ 1đ',
            lyDoRutBai(null, 1, '', pol0)?.loai === 'ma' && lyDoRutBai({ sellingPrice: 1, stock: 5, mergedIntoId: 'x' }, 1, '', pol0)?.loai === 'ma'
            && lyDoRutBai({ sellingPrice: 2000, stock: 0 }, 1000, 'Giá 1.000đ', pol0)?.loai === 'ton' && lyDoRutBai({ sellingPrice: 2000, stock: 5 }, 1000, 'Giá 1.000đ', pol0)?.loai === 'gia'
            && lyDoRutBai({ sellingPrice: 2000, stock: 5 }, 1000, 'inbox shop', pol0) === null && lyDoRutBai({ sellingPrice: 1000.5, stock: 5 }, 1000, 'Giá 1.000đ', pol0) === null)
        const sql = sqlDemBaiHenSapLen('store_kengi')
        dung('13F. câu dò registry: ghi rõ schema, chỉ bài scheduled có mã Facebook trong cửa sổ (giờ UTC, nới 1 phút), chỉ khi có kế hoạch Pilot succeeded nối tới; schema lạ ⇒ ném',
            /FROM "store_kengi"\."FbScheduledPost" s/.test(sql) && /FROM "store_kengi"\."FacebookPilotPlan" p/.test(sql) && /s\.status = 'scheduled' AND s\."fbPostId" IS NOT NULL/.test(sql)
            && /\(NOW\(\) AT TIME ZONE 'UTC'\) - interval '31 minutes'/.test(sql) && /\(NOW\(\) AT TIME ZONE 'UTC'\) \+ interval '61 minutes'/.test(sql)
            && /p\.kind = 'post' AND p\.status = 'succeeded'/.test(sql) && /p\.result::jsonb->>'scheduledPostId' = s\.id/.test(sql)
            && (await nem(async () => sqlDemBaiHenSapLen('x"; DROP TABLE y; --'))) !== null, sql)
        dung('13G. laThieuBang: chỉ "bảng chưa có" (42P01 / P2021) — sai tên cột (42703), lỗi mạng KHÔNG bị nuốt',
            laThieuBang({ code: 'P2010', meta: { code: '42P01', message: 'relation "store_x.FacebookPilotPlan" does not exist' } }) && laThieuBang({ code: 'P2021' })
            && !laThieuBang({ code: 'P2010', meta: { code: '42703', message: 'column "fbPostIdx" does not exist' } }) && !laThieuBang(new Error('timeout')))
        const cron = fs.readFileSync(path.join(__dirname, '..', 'src', 'cron', 'aiAgentCron.ts'), 'utf8')
        const ham = cron.slice(cron.indexOf('export async function nhipSoatBaiHenFb'), cron.indexOf('export async function quetTuNgoai'))
        dung('13H. nối dây: quetTuNgoai soát bài hẹn TRƯỚC chốt dangChay; nhịp theo tiện ích facebook_pilot, KHÔNG theo hasAiJobs; dò bằng registry rồi mới giữ client cửa hàng',
            /export async function quetTuNgoai\(\): Promise<boolean> \{[^}]*?await nhipSoatBaiHenFb\(\)[\s\S]*?if \(dangChay\) return false/.test(cron)
            && ham.length > 0 && /includes\(TIEN_ICH_FACEBOOK_PILOT\)/.test(ham) && !/hasAiJobs/.test(ham) && /registryPrisma\.\$queryRawUnsafe\(sqlDemBaiHenSapLen\(/.test(ham)
            && /if \(!laThieuBang\(e\)\) console\.error/.test(ham) && /const nha = giuClient\(store\.schema\)[\s\S]*soatBaiHenSapLen\(getStorePrisma\(store\.schema\)\)[\s\S]*finally \{\s*nha\(\)/.test(ham))
        // setInterval (5 phút) chạy cả đêm nhưng ngoài request bị hãm CPU ⇒ lượt soát nó mở treo, giữ chốt dangSoatFb ⇒ nhịp ngoài 'bo-qua'
        const quetThan = cron.slice(cron.indexOf('async function quet()'), cron.indexOf('export function startAiAgentCron'))
        dung('13M. nối dây: quet() (setInterval) chỉ soát bài hẹn khi nhịp ngoài IM ≥ 3 phút; quetTuNgoai đánh dấu nhịp ngoài TRƯỚC khi soát',
            /nhipNgoaiLuc = Date\.now\(\)\s*\n\s*await nhipSoatBaiHenFb\(\)/.test(cron) && (cron.match(/nhipNgoaiLuc = Date\.now\(\)/g) || []).length === 1
            && quetThan.length > 0 && /if \(Date\.now\(\) - nhipNgoaiLuc > 3 \* 60_000\) await nhipSoatBaiHenFb\(\)/.test(quetThan)
            && (quetThan.match(/nhipSoatBaiHenFb\(/g) || []).length === 1)
        henFbBat = false
        bayGio = NOW
    }

    // ─── 14. FacebookService THẬT trước thay đổi Graph đã có hiệu lực (09/11/2026, FB-20) ───────────
    //  metadata=1 thôi trả metadata ở MỌI phiên bản từ 19/05/2026 (changelog v25.0); page_impressions_unique bị bỏ ở mọi phiên bản
    //  từ khi v26.0 ra 29/07/2026, page_engaged_users không còn trong tham chiếu Insights.
    {
        batGraphGia()
        try {
            const svc = new FacebookService('TOKEN-GIA-14')
            dapGraph = (m, d) => (m === 'GET' && d === 'me' ? { status: 200, body: { id: 'PG1', name: 'Kengi Fanpage', category: 'Cửa hàng', fan_count: 120 } } : graphOn(m, d))
            goiGraph.length = 0
            const a = await svc.identifyToken()
            dung('14a. page token: /me đọc được category + fan_count ⇒ loại page, KHÔNG gửi metadata=1 (Facebook đã bỏ)',
                a.type === 'page' && a.id === 'PG1' && a.fanCount === 120 && goiGraph.length === 1 && !('metadata' in (goiGraph[0].tham || {})),
                `${JSON.stringify(a)} · ${JSON.stringify(goiGraph.map(g => g.tham))}`)

            let lan = 0
            dapGraph = (m, d) => {
                if (!(m === 'GET' && d === 'me')) return graphOn(m, d)
                lan++
                return lan === 1 ? loiGraph(400, 100, '(#100) Tried accessing nonexisting field (category) on node type (User)') : { status: 200, body: { id: 'U77', name: 'Chủ shop' } }
            }
            goiGraph.length = 0
            const b = await svc.identifyToken()
            dung('14b. USER token: lỗi #100 "node type (User)" ⇒ đọc lại id/name, trả loại user (người gọi báo "đây là USER token")',
                b.type === 'user' && b.id === 'U77' && lan === 2 && goiGraph[1]?.tham?.fields === 'id,name', `${JSON.stringify(b)} · lần ${lan}`)

            dapGraph = (m, d) => (m === 'GET' && d === 'me' ? loiGraph(400, 190, 'Error validating access token: Session has expired') : graphOn(m, d))
            const c = await nem(() => svc.identifyToken())
            dung('14c. token chết (#190) ⇒ ném nguyên lỗi token như cũ, không đoán loại', !!c && (c as any).isTokenError === true, String(c?.message || c))

            // lần đọc lại (id,name) mà có thì trả được — bản sai "gán bừa loại user" sẽ lộ ra ở đây thay vì ném lại cùng lỗi
            let lan2 = 0
            dapGraph = (m, d) => {
                if (!(m === 'GET' && d === 'me')) return graphOn(m, d)
                lan2++
                return lan2 === 1 ? loiGraph(400, 100, '(#100) Unknown fields: fan_count.') : { status: 200, body: { id: 'PG1', name: 'Kengi Fanpage' } }
            }
            const c2 = await nem(() => svc.identifyToken())
            dung('14d. #100 KHÔNG nói "node type" ⇒ ném nguyên, không gán bừa loại, không đọc lại', !!c2 && /Unknown fields/.test(String(c2?.message)) && lan2 === 1, `${String(c2?.message || c2)} · lần ${lan2}`)

            dapGraph = graphOn
            goiGraph.length = 0
            await svc.getPageInsights('PG1')
            const met = String(goiGraph[0]?.tham?.metric || '')
            dung('14e. Insights mặc định chỉ xin chỉ số còn sống (page_total_media_view_unique, page_post_engagements)',
                met === 'page_total_media_view_unique,page_post_engagements' && !/page_impressions_unique|page_engaged_users/.test(met), met)
        } finally {
            traFetch()
            dapGraph = graphOn
        }
    }

    // ─── 15. Nhận hỏi giá + nối mã theo tên + giữ client lịch (10/11/2026, FB-07 / FB-08 / FB-21) ───────────
    {
        const phaiKeu = ['giá', 'Giá?', 'giá ạ', 'GIÁ BAO NHIÊU', 'giá sao shop', 'giá bn', 'gía bao nhiêu', 'gía ạ', 'gia bao nhieu', 'gia?', 'bao nhiêu',
            'bao nhiêu 1 cái', 'cái này bao nhiêu vậy', 'bn vậy', 'bn', 'bn?', 'ib', 'ib giá', 'inbox', 'đã ib shop', 'cho mình xin giá', 'báo giá giúp mình',
            'giá sỉ', 'còn hàng không', 'con hang ko', 'còn không shop', 'size L còn không', 'còn ko ạ', 'còn hông', 'giá cái này', 'nhiêu tiền',
            'mấy tiền vậy', 'may tien vay', 'mấy k vậy', 'nhiêu vậy shop', 'bán nhiêu', 'giá thế nào ạ', 'giá như nào shop', 'giá bên mình sao ạ',
            'giá sao' /* NFD */, 'chúc shop đắt hàng, giá sao ạ', 'ship về Đà Nẵng bao nhiêu', 'hàng giá bao nhiêu', 'xin gia']
        const phaiIm = ['', 'gia đình mình dùng tốt', 'mua cho gia đình dùng', 'đồ gia dụng tốt', 'Đánh giá 5 sao, giao nhanh', 'danh gia sao',
            'sản phẩm rất đáng giá', 'giá trị sử dụng cao', 'hàng tốt giá hợp lý shop nhé', 'giá rẻ mà xài bền', 'cảm ơn shop ạ, giá tốt', 'giá tốt, cảm ơn shop ạ',
            'giá như biết sớm thì đã mua rồi', 'giá đắt quá', 'đắt vậy', 'lừa đảo, giá bao nhiêu cũng không mua', 'mua về còn không biết dùng',
            'con khong biet dung', 'pin dùng được bao nhiêu lâu', 'bảo hành bao nhiêu tháng', 'nặng bao nhiêu vậy', 'công suất bao nhiêu W',
            'có bao nhiêu màu', 'bn ơi cho mình hỏi', 'cảm ơn bn', 'tốn nhiều tiền quá', 'hàng dỏm', 'hàng tệ quá', 'giao chậm quá',
            'chưa nhận được hàng, còn không shop', 'giá đỡ này chắc không', 'hàng giả sao bán', 'già sao còn mua', 'máy cắt cỏ dùng tốt',
            'đặt qua shopee được không']
        const sai1 = phaiKeu.filter(t => !laHoiGia(t)), sai2 = phaiIm.filter(t => laHoiGia(t))
        dung(`15a. hỏi giá thật vẫn nhận (${phaiKeu.length} câu, có dấu / không dấu / gõ lệch dấu / NFD)`, sai1.length === 0, JSON.stringify(sai1))
        dung(`15b. KHÔNG nhận hỏi giá: đánh giá / khen / chê / hỏi thông số / "bạn" / "gia đình" / "giá như" (${phaiIm.length} câu)`, sai2.length === 0, JSON.stringify(sai2))
        dung('15c. phàn nàn: bắt "đắt quá", "lua dao", "hàng tệ"; KHÔNG bắt lời chúc "đắt hàng", "máy cắt cỏ"',
            laPhanNan('giá đắt quá') && laPhanNan('lua dao') && laPhanNan('hàng tệ quá') && !laPhanNan('chúc shop đắt hàng') && !laPhanNan('máy cắt cỏ dùng tốt'))

        datLai(); goiFb.length = 0; bayGio = NOW
        hang.push(
            { id: 'p8', sku: 'KIM-DO', name: 'Kìm điện', description: '', productType: 'goods', sellingPrice: 89000, stock: 5, mergedIntoId: null, bundleId: null, createdAt: new Date(NOW), images: [] },
            { id: 'p9', sku: 'KIM-XANH', name: 'Kìm điện', description: '', productType: 'goods', sellingPrice: 99000, stock: 5, mergedIntoId: null, bundleId: null, createdAt: new Date(NOW), images: [] },
        )
        const kho = khoBoNhoFb()
        // bài PG1_402 do Pilot đăng cho p6 (nay đã gộp mã) — dòng đầu lại trùng tên p1 (mã còn bán)
        kho._keHoach.push({ id: 'kh-cu', kind: 'post', status: 'succeeded', idempotencyKey: 'web:cu', data: { productId: 'p6', sku: 'GOP' }, result: { postId: 'PG1_402' }, createdBy: 'chu@shop', createdAt: NOW - 5 * 86400_000, updatedAt: NOW - 5 * 86400_000 })
        const bl = (id: string, message: string) => ({ id, message, from: { id: `U_${id}`, name: `Khách ${id}` }, created_time: new Date(NOW - H).toISOString(), comment_count: 0 })
        baiTrenFb = [
            { id: 'PG1_401', message: '🔹 Kìm điện\n💰 Giá: 89.000đ', comments: { data: [bl('D1', 'giá sao shop')] } },
            { id: 'PG1_402', message: '🔹 Mũi khoan lệch tâm 10mm\n💰 Giá: 5.000đ', comments: { data: [bl('D2', 'giá sao shop')] } },
            { id: 'PG1_403', message: '🔹 Mũi khoan lệch tâm 10mm\n💰 Giá: 26.000đ', comments: { data: [bl('D3', 'Đánh giá 5 sao, giao nhanh'), bl('D4', 'giá đắt quá'), bl('D5', 'giá sao shop')] } },
        ]
        const ctx = ngCanh(kho)
        await luuCauHinhFb(ctx, { executionMode: 'auto', policy: { maxRepliesPerCycle: 5, automation: { posts: false, replyPriceQuestions: true, hidePhoneComments: true } } })
        const ds = await docBinhLuan(ctx)
        const c = (id: string) => ds.comments.find(x => x.id === id)!
        dung('15d. bài trùng tên 2 mã ⇒ KHÔNG gắn mã, không gợi ý giá, nói rõ vì sao (kèm mã)',
            !c('D1').product && !c('D1').suggestion && /trùng tên 2 mã/.test(c('D1').productNote || '') && /KIM-DO/.test(c('D1').productNote || ''), JSON.stringify(c('D1')))
        dung('15e. bài Pilot đăng cho mã nay đã gộp ⇒ KHÔNG rơi về mã khác cùng tên', !c('D2').product && !c('D2').suggestion && /không còn trong kho/.test(c('D2').productNote || ''), JSON.stringify(c('D2')))
        dung('15f. tên chỉ một mã ⇒ vẫn gắn mã + gợi ý giá thật', c('D5').product?.sku === 'KHOAN10' && /26\.000đ/.test(c('D5').suggestion || '') && c('D5').productNote === null, JSON.stringify(c('D5')))
        dung('15g. "Đánh giá 5 sao" không phải hỏi giá; "giá đắt quá" là phàn nàn, không phải hỏi giá',
            !c('D3').askPrice && !c('D3').suggestion && !c('D4').askPrice && c('D4').complaint === true && !c('D4').suggestion && c('D5').complaint === false,
            JSON.stringify([c('D3'), c('D4')].map(x => ({ id: x.id, askPrice: x.askPrice, complaint: x.complaint }))))
        goiFb.length = 0
        const kq = await chayChuKyFb(ctx)
        const traLoi = ghiFb().filter(g => g[0] === 'reply').map(g => g[1])
        dung('15h. Tự động: CHỈ trả lời D5 — không trả lời bài trùng tên, bài mã đã gộp, đánh giá, lời chê', JSON.stringify(traLoi) === '["D5"]',
            `${JSON.stringify(traLoi)} ${JSON.stringify(kq.results).slice(0, 300)}`)
        dung('15i. không lập cả nháp trả lời cho D1–D4', !kho._keHoach.some(k => k.kind === 'reply' && ['D1', 'D2', 'D3', 'D4'].includes(k.data?.commentId)),
            kho._keHoach.filter(k => k.kind === 'reply').map(k => k.data?.commentId).join(','))

        const cron = fs.readFileSync(path.join(__dirname, '..', 'src', 'cron', 'aiAgentCron.ts'), 'utf8')
        const khoi = cron.slice(cron.indexOf('FACEBOOK PILOT theo lịch'), cron.indexOf('ADS PILOT theo lịch'))
        dung('15j. lịch Facebook Pilot giữ client suốt lượt (giuClient … finally nha())',
            khoi.length > 0 && /const nha = giuClient\(store\.schema\)[\s\S]*chayTheoLichFb\([\s\S]*finally \{\s*nha\(\)/.test(khoi), khoi.slice(0, 200))
    }

    // ─── 16. Quản lý kế hoạch (10/11/2026, FB-16): lọc + lật trang, MỌI nháp, "Đã kiểm" cho kế hoạch chưa rõ, bỏ ẩn ───────────
    {
        datLai(); goiFb.length = 0; bayGio = NOW; loiDang = null; loiXoa = null; loiDsHen = null; henFbBat = true; thongBao.length = 0
        const kh = (id: string, o: any = {}) => ({
            id, kind: 'post', status: 'succeeded', idempotencyKey: `web:${id}`, data: { pageId: 'PG1' }, result: null, createdBy: 'chu@shop',
            createdAt: NOW - H, updatedAt: NOW - H, ...o,
        })

        // a–d: lật trang theo con trỏ (createdAt, id) — hai kế hoạch CÙNG mili-giây không lọt / không lặp
        {
            const kho = khoBoNhoFb(); const ctx = ngCanh(kho)
            kho._keHoach.push(kh('a', { createdAt: NOW - 1000 }), kh('b', { createdAt: NOW - 2000 }), kh('c', { createdAt: NOW - 2000 }),
                kh('d', { createdAt: NOW - 3000, status: 'draft', kind: 'reply' }), kh('e', { createdAt: NOW - 4000, status: 'draft' }))
            const thay: string[] = []
            let truoc: string | null = null, soTrang = 0
            do {
                const r = await dsKeHoachFb(ctx, { limit: 2, before: truoc })
                thay.push(...r.plans.map(p => p.id)); truoc = r.next; soTrang++
            } while (truoc && soTrang < 10)
            dung('16a. lật trang 2/lượt: đủ 5 kế hoạch, đúng thứ tự (mới trước; cùng mili-giây theo id), không lặp', thay.join(',') === 'a,c,b,d,e' && soTrang === 3, `${thay.join(',')} · ${soTrang} trang`)
            const loc = await dsKeHoachFb(ctx, { status: 'draft', kind: ['reply'] })
            const la = await dsKeHoachFb(ctx, { status: 'xyz', kind: 'abc' })
            dung('16b. lọc trạng thái + loại; giá trị lọc lạ bị bỏ qua (không ném, không lọc rỗng)',
                loc.plans.map(p => p.id).join(',') === 'd' && loc.next === null && la.plans.length === 5, `${loc.plans.map(p => p.id)} · ${la.plans.length}`)

            for (let i = 0; i < 90; i++) kho._keHoach.push(kh(`m${String(i).padStart(2, '0')}`, { createdAt: NOW + i }))
            const st = await xayTrangThaiFb(ctx)
            dung('16c. /state: MỌI nháp (kể cả nháp cũ bị 80 kế hoạch mới đẩy khuất) + đếm theo trạng thái + con trỏ trang sau',
                st.plans.length === 80 && !st.plans.some((p: any) => p.status === 'draft') && st.drafts.map((p: any) => p.id).join(',') === 'd,e'
                && st.draftsTotal === 2 && st.planCounts.succeeded === 93 && st.planCounts.draft === 2 && typeof st.plansNext === 'string',
                `${st.plans.length} · ${st.drafts.map((p: any) => p.id)} · ${JSON.stringify(st.planCounts)} · ${st.plansNext}`)
            const sau = await dsKeHoachFb(ctx, { before: st.plansNext, limit: 100 })
            const tron = new Set([...st.plans.map((p: any) => p.id), ...sau.plans.map(p => p.id)])
            dung('16d. "Xem thêm" từ plansNext: phần còn lại, không trùng trang đầu, hết thì next = null',
                sau.plans.length === 15 && tron.size === 95 && sau.next === null, `${sau.plans.length} · ${tron.size} · ${sau.next}`)
        }

        // e–g: "Đã kiểm" bài chưa rõ — KHÔNG có ⇒ nhả mã + khung giờ; CÓ ⇒ giữ chặn như bài đã đăng. Không gọi Facebook, không tốn lượt ghi.
        {
            const kho = khoBoNhoFb(); const ctx = ngCanh(kho)
            await luuCauHinhFb(ctx, { executionMode: 'auto' })
            const st0 = await xayTrangThaiFb(ctx)
            const T0 = st0.slots[0]
            const coMa = async (sku: string) => (await timUngVienFb(ctx, chuanHoaChinhSachFb({}), { lim: 30 })).ungVien.some(u => u.sku === sku)
            kho._keHoach.push(
                kh('u1', { status: 'uncertain', data: { pageId: 'PG1', productId: 'p1', sku: 'KHOAN10', scheduledAt: T0 }, result: { message: 'Không rõ Facebook đã nhận chưa (mất kết nối)' } }),
                kh('u2', { status: 'uncertain', data: { pageId: 'PG1', productId: 'p2', sku: 'OC4', scheduledAt: T0 + 86400_000 }, result: { message: 'Không rõ Facebook đã nhận chưa' } }),
            )
            const st1 = await xayTrangThaiFb(ctx)
            const chan1 = !(await coMa('KHOAN10')) && !st1.slots.includes(T0)
            const ghi0 = await kho.demGhiTuLuc(dauNgayVN(NOW))
            goiFb.length = 0
            const r1 = await xacNhanDaKiemFb(ctx, { planId: 'u1', outcome: 'not_done' })
            const st2 = await xayTrangThaiFb(ctx)
            dung('16e. bài chưa rõ → "KHÔNG có trên fanpage": failed + daKiem, giữ lời cũ, mã lên bài lại được, khung giờ được nhả',
                chan1 && r1.status === 'failed' && r1.result?.daKiem?.ketLuan === 'khong' && /KHÔNG có trên fanpage/.test(r1.result?.message)
                && /mất kết nối/.test(r1.result?.messageTruoc) && (await coMa('KHOAN10')) && st2.slots.includes(T0),
                `${chan1} · ${r1.status} · ${JSON.stringify(r1.result).slice(0, 200)}`)
            dung('16f. đánh dấu đã kiểm KHÔNG gọi Facebook, KHÔNG tính trần ghi / ngày, nhưng có dòng nhật ký "resolve" ghi người kiểm',
                ghiFb().length === 0 && (await kho.demGhiTuLuc(dauNgayVN(NOW))) === ghi0
                && kho._nhatKy.some(w => w.action === 'resolve' && w.planId === 'u1' && w.payload?.ketLuan === 'khong' && w.payload?.actor === 'chu@shop'),
                `${ghiFb().length} · ${JSON.stringify(kho._nhatKy.map(w => w.action))}`)
            const r2 = await xacNhanDaKiemFb(ctx, { planId: 'u2', outcome: 'done' })
            dung('16g. bài chưa rõ → "CÓ trên fanpage": succeeded, mã vẫn bị chặn như bài đã đăng',
                r2.status === 'succeeded' && r2.result?.daKiem?.ketLuan === 'co' && !(await coMa('OC4')), `${r2.status} · ${await coMa('OC4')}`)

            const loiLai = await nem(() => xacNhanDaKiemFb(ctx, { planId: 'u1', outcome: 'done' }))
            kho._keHoach.push(kh('n1', { status: 'draft' }), kh('r1', { status: 'running', updatedAt: NOW - 5 * 60_000 }), kh('r2', { status: 'running', updatedAt: NOW - 2 * H, kind: 'hide', data: { pageId: 'PG1', commentId: 'CX' } }))
            const loiNhap = await nem(() => xacNhanDaKiemFb(ctx, { planId: 'n1', outcome: 'done' }))
            const loiChay = await nem(() => xacNhanDaKiemFb(ctx, { planId: 'r1', outcome: 'done' }))
            const loiLoai = await nem(() => xacNhanDaKiemFb(ctx, { planId: 'u2', outcome: 'yes' }))
            const r3 = await xacNhanDaKiemFb(ctx, { planId: 'r2', outcome: 'done' })
            dung('16h. chỉ kế hoạch chưa rõ (hoặc kẹt "đang chạy" quá 1 giờ) mới đánh dấu được; kết quả lạ / đã kiểm rồi / đang chạy dở ⇒ báo lỗi',
                loiLai instanceof ToolError && loiNhap instanceof ToolError && /đang thực thi/.test(String(loiChay?.message)) && loiLoai instanceof ToolError
                && kho._keHoach.find(k => k.id === 'n1')?.status === 'draft' && kho._keHoach.find(k => k.id === 'r1')?.status === 'running'
                && r3.status === 'succeeded' && /bình luận ĐÃ ẩn/.test(r3.result?.message),
                [loiLai, loiNhap, loiChay, loiLoai].map(e => String(e?.message || e)).join(' | ') + ` · ${r3.status}`)

            kho._keHoach.push(kh('u3', { status: 'uncertain', data: { pageId: 'PG1', productId: 'p5', sku: 'BUA' }, result: { message: 'x' } }))
            const dua = await Promise.allSettled([xacNhanDaKiemFb(ctx, { planId: 'u3', outcome: 'done' }), xacNhanDaKiemFb(ctx, { planId: 'u3', outcome: 'not_done' })])
            dung('16i. hai người bấm cùng lúc ⇒ đúng MỘT người chốt (CAS), một dòng nhật ký',
                dua.filter(x => x.status === 'fulfilled').length === 1 && kho._nhatKy.filter(w => w.action === 'resolve' && w.planId === 'u3').length === 1,
                dua.map(x => x.status === 'fulfilled' ? (x.value as any).status : String((x as any).reason?.message)).join(' | '))
        }

        // j–k: bài hẹn Pilot rút không được (uncertain + rutBai) — "CÓ" ⇒ lượt soát bài hẹn KHÔNG đụng lại; "KHÔNG có" ⇒ dòng bài hẹn hủy
        {
            const kho = khoBoNhoFb(); const ctx = ngCanh(kho)
            await luuCauHinhFb(ctx, { executionMode: 'auto', policy: { maxWritesPerDay: 100 } })
            const soat = () => soatBaiHenSapLen(prisma, kho, { taoFb: fbGia, bayGio: () => bayGio })
            const A = await thucThiFb(ctx, (await taoKeHoachBai(ctx, { sku: 'KHOAN10', scheduledAt: NOW + 40 * 60_000, idempotencyKey: 'web:kiem-A' })).id)
            hang.find(h => h.id === 'p1')!.sellingPrice = 30000
            loiXoa = Object.assign(new Error('(#200) Requires pages_manage_posts permission'), { code: 200 })
            await soat()
            const A1 = kho._keHoach.find(k => k.id === A.id)!
            const truoc = A1.status === 'uncertain' && A1.result?.rutBai?.trangThai === 'can_nguoi'
            const rA = await xacNhanDaKiemFb(ctx, { planId: A.id, outcome: 'done' })
            loiXoa = null
            const C = await thucThiFb(ctx, (await taoKeHoachBai(ctx, { sku: 'OC4', scheduledAt: NOW + 50 * 60_000, idempotencyKey: 'web:kiem-C' })).id)
            hang.find(h => h.id === 'p2')!.sellingPrice = 199000
            const xoaTruoc = lenhXoa().length
            await soat()
            const moi = lenhXoa().slice(xoaTruoc)
            dung('16j. bài hẹn rút không được, người kiểm "CÓ" ⇒ succeeded giữ rutBai: lượt soát sau KHÔNG xoá bài đó (bài đối chứng vẫn bị rút)',
                truoc && rA.status === 'succeeded' && rA.result?.rutBai?.trangThai === 'can_nguoi' && rA.result?.daKiem?.ketLuan === 'co' && JSON.stringify(moi) === JSON.stringify([C.result?.postId]),
                `${truoc} · ${rA.status} · ${JSON.stringify(rA.result?.rutBai)} · xoá ${JSON.stringify(moi)} (A ${A.result?.postId}, C ${C.result?.postId})`)

            baiDaHen.push(
                { id: 'sp-D', pageId: 'PG1', fbPostId: 'PG1_D', message: 'x', scheduledAt: new Date(NOW + 2 * H), status: 'scheduled' },
                { id: 'sp-E', pageId: 'PG1', fbPostId: 'PG1_E', message: 'x', scheduledAt: new Date(NOW - 2 * H), status: 'published' },
            )
            kho._keHoach.push(
                kh('kD', { status: 'uncertain', data: { pageId: 'PG1', productId: 'p4', sku: 'TUI' }, result: { postId: 'PG1_D', published: false, scheduledPostId: 'sp-D', rutBai: { trangThai: 'khong_con_hen' }, message: 'Facebook không còn bài hẹn' } }),
                kh('kE', { status: 'uncertain', data: { pageId: 'PG1', productId: 'p7', sku: 'TUA' }, result: { postId: 'PG1_E', published: false, scheduledPostId: 'sp-E', rutBai: { trangThai: 'da_len' }, message: 'Bài hẹn đã lên' } }),
            )
            await xacNhanDaKiemFb(ctx, { planId: 'kD', outcome: 'not_done' })
            await xacNhanDaKiemFb(ctx, { planId: 'kE', outcome: 'not_done' })
            const D = baiDaHen.find(b => b.id === 'sp-D'), E = baiDaHen.find(b => b.id === 'sp-E')
            dung('16k. "KHÔNG có" ⇒ dòng bài hẹn CÒN "scheduled" của chính kế hoạch thành cancelled (ghi lý do); dòng đã "published" giữ nguyên',
                D?.status === 'cancelled' && /Người kiểm/.test(String(D?.errorMessage)) && E?.status === 'published',
                `${D?.status} ${D?.errorMessage} · ${E?.status}`)
        }

        // l–m: "Đã kiểm" câu trả lời — sổ tự trả lời chung với Fanpage Manager: chỉ nhả / chốt dòng Pilot giữ dở
        {
            const kho = khoBoNhoFb(); const ctx = ngCanh(kho)
            await luuCauHinhFb(ctx, { executionMode: 'auto' })
            const rep = (id: string, cmt: string) => kh(id, { kind: 'reply', status: 'uncertain', data: { pageId: 'PG1', commentId: cmt, postId: 'PG1_601', message: 'Dạ giá 26.000đ ạ', fromName: 'Khách' }, result: { message: 'Không rõ' } })
            soTraLoi.push(
                { pageId: 'PG1', commentId: 'C1', action: 'pilot_reply', success: false, errorMessage: 'không rõ đã gửi chưa' },
                { pageId: 'PG1', commentId: 'C2', action: 'reply', success: true, ruleId: 'quy-tac-1' },
                { pageId: 'PG1', commentId: 'C3', action: 'processing', success: false, createdAt: new Date(NOW - 5 * 60_000) },
                { pageId: 'PG1', commentId: 'C4', action: 'processing', success: false, createdAt: new Date(NOW - 2 * H) },
                { pageId: 'PG1', commentId: 'C5', action: 'pilot_reply', success: false, errorMessage: 'không rõ đã gửi chưa' },
                // Pilot ĐÃ gửi thành công (máy chết trước khi chốt kế hoạch) — Facebook đã nhận, người bấm "KHÔNG có" cũng không xoá sổ
                { pageId: 'PG1', commentId: 'C7', action: 'pilot_reply', success: true, replyText: 'Dạ giá 26.000đ ạ' },
            )
            kho._keHoach.push(rep('q1', 'C1'), rep('q2', 'C2'), rep('q3', 'C3'), rep('q4', 'C4'), rep('q5', 'C5'), rep('q6', 'C6'), rep('q7', 'C7'))
            for (const id of ['q1', 'q2', 'q3', 'q4', 'q7']) await xacNhanDaKiemFb(ctx, { planId: id, outcome: 'not_done' })
            const con = (c: string) => soTraLoi.find(r => r.commentId === c)
            dung('16l. câu trả lời "KHÔNG có" ⇒ nhả dòng Pilot giữ dở (pilot_reply chưa thành, processing quá 1 giờ) — KHÔNG xoá dòng quy tắc đã trả lời, dòng processing đang chạy, dòng Pilot đã gửi thành công',
                !con('C1') && con('C2')?.action === 'reply' && con('C3')?.action === 'processing' && !con('C4') && con('C7')?.success === true,
                JSON.stringify(soTraLoi.map(r => `${r.commentId}:${r.action}`)))
            await xacNhanDaKiemFb(ctx, { planId: 'q5', outcome: 'done' })
            await xacNhanDaKiemFb(ctx, { planId: 'q6', outcome: 'done' })
            dung('16m. câu trả lời "CÓ" ⇒ dòng sổ thành đã trả lời (không có dòng thì ghi mới) — quy tắc tự trả lời không trả lời lần hai',
                con('C5')?.success === true && con('C5')?.action === 'pilot_reply' && con('C5')?.errorMessage === null
                && con('C6')?.success === true && con('C6')?.replyText === 'Dạ giá 26.000đ ạ',
                JSON.stringify([con('C5'), con('C6')]))
        }

        // n–p: bỏ ẩn bình luận — kế hoạch → thực thi như ẩn; có kế hoạch bỏ ẩn thì chu kỳ không tự ẩn lại
        {
            const kho = khoBoNhoFb(); const ctx = ngCanh(kho)
            await luuCauHinhFb(ctx, { executionMode: 'auto', policy: { automation: { posts: false, replyPriceQuestions: false, hidePhoneComments: true } } })
            const p = await taoKeHoachBoAn(ctx, { commentId: 'H2', postId: 'PG1_501', commentMsg: 'gọi 0909 123 456', fromName: 'Khách', idempotencyKey: 'web:bo-an-1' })
            goiFb.length = 0
            const x = await thucThiFb(ctx, p.id)
            dung('16n. bỏ ẩn: kế hoạch "unhide" → thực thi gọi hideComment(…, false) đúng một lần, nhật ký "unhide"',
                p.kind === 'unhide' && p.data?.reason === 'Hiện lại bình luận' && x.status === 'succeeded' && x.result?.hidden === false
                && JSON.stringify(ghiFb()) === '[["unhide","H2"]]' && kho._nhatKy.some(w => w.action === 'unhide' && w.planId === p.id),
                `${p.kind} · ${x.status} · ${JSON.stringify(ghiFb())}`)

            const bl = (id: string) => ({ id, message: 'Mình lấy 2 cái, gọi 0909 123 456 nhé', from: { id: `U_${id}`, name: 'Khách' }, created_time: new Date(NOW - H).toISOString(), comment_count: 0, is_hidden: false })
            baiTrenFb = [{ id: 'PG1_501', message: '🔹 Mũi khoan lệch tâm 10mm\n💰 Giá: 26.000đ', comments: { data: [bl('H1'), bl('H2')] } }]
            const ds = await docBinhLuan(ctx)
            goiFb.length = 0
            await chayChuKyFb(ctx)
            const an = ghiFb().filter(g => g[0] === 'hide').map(g => g[1])
            dung('16o. chu kỳ ẩn SĐT: ẩn bình luận chưa có kế hoạch (đối chứng H1), KHÔNG ẩn lại bình luận người đã bỏ ẩn (H2)',
                JSON.stringify(an) === '["H1"]' && ds.comments.find(c => c.id === 'H2')?.plan?.kind === 'unhide', `${JSON.stringify(an)} · ${JSON.stringify(ds.comments.find(c => c.id === 'H2')?.plan)}`)

            loiDang = Object.assign(new Error('Error validating access token'), { code: 190, isTokenError: true, fbtraceId: 'x' })
            const b = await taoKeHoachBai(ctx, { sku: 'KHOAN10', scheduledAt: NOW + 5 * H, idempotencyKey: 'web:token-hong' })
            const y = await thucThiFb(ctx, b.id)
            loiDang = null; pages[0].status = 'active'
            dung('16p. token fanpage hỏng ⇒ kết quả mang cờ loiToken (khối Chờ duyệt dừng loạt duyệt)', y.status === 'failed' && y.result?.loiToken === true, JSON.stringify(y.result))
        }

        // q–s: nối dây (soát mã nguồn + câu SQL thật của khoSqlFb)
        {
            const lenhSql: { sql: string; v: any[] }[] = []
            const pg: any = { $executeRawUnsafe: async () => 0, $queryRawUnsafe: async (sql: string, ...v: any[]) => { lenhSql.push({ sql, v }); return [] } }
            const ks = khoSqlFb(pg)
            await ks.dsKeHoachLoc({ status: ['draft'], kind: ['reply', 'hide'], truoc: { createdAt: 5, id: 'x' }, lim: 3 })
            const l1 = lenhSql[lenhSql.length - 1]
            await ks.dsKeHoachLoc({ lim: 81 })
            const l2 = lenhSql[lenhSql.length - 1]
            await ks.demGhiTuLuc(0); const l3 = lenhSql[lenhSql.length - 1]
            await ks.dsKeHoachBinhLuan(['c']); const l4 = lenhSql[lenhSql.length - 1]
            const dem = await ks.demKeHoach()
            dung('16q. SQL: lọc ANY($n::text[]) + con trỏ ("createdAt", id) + ORDER BY "createdAt" DESC, id DESC; trần ghi bỏ resolve; bình luận gồm unhide',
                /status = ANY\(\$1::text\[\]\)/.test(l1.sql) && /kind = ANY\(\$2::text\[\]\)/.test(l1.sql)
                && /\("createdAt" < \$3 OR \("createdAt" = \$3 AND id < \$4\)\)/.test(l1.sql) && /ORDER BY "createdAt" DESC, id DESC LIMIT \$5/.test(l1.sql)
                && JSON.stringify(l1.v) === '[["draft"],["reply","hide"],5,"x",3]'
                && !/WHERE/.test(l2.sql) && /LIMIT \$1$/.test(l2.sql.trim()) && JSON.stringify(l2.v) === '[81]'
                && /action NOT IN \('config', 'resolve'\)/.test(l3.sql) && /kind IN \('reply', 'hide', 'unhide'\)/.test(l4.sql) && JSON.stringify(dem) === '{}',
                [l1, l2, l3, l4].map(l => l.sql.replace(/\s+/g, ' ').slice(0, 160)).join(' ‖ '))
            const rt = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'facebookPilot.ts'), 'utf8')
            dung('16r. route: plans là thao tác ĐỌC; unhide / resolve là GHI (chỉ quản lý)',
                /\bplans: \{ ghi: false/.test(rt) && /\bunhide: \{\s*ghi: true/.test(rt) && /\bresolve: \{ ghi: true/.test(rt))
            dung('16s. hướng dẫn nói về Bỏ ẩn, Chờ duyệt, Đã kiểm, Xem thêm',
                /«Bỏ ẩn»/.test(HUONG_DAN_FB_PILOT) && /«Chờ duyệt»/.test(HUONG_DAN_FB_PILOT) && /«Đã kiểm: CÓ trên\s+Facebook»/.test(HUONG_DAN_FB_PILOT) && /«Xem thêm»/.test(HUONG_DAN_FB_PILOT))
        }
        henFbBat = false
    }

    // ─── 17. Nối fanpage bằng token dán tay (10/11/2026, lô 20: FB-06 / X-16) — FacebookService THẬT qua fetch giả ───────────
    {
        const U = 'TOKEN-USER-GIA-17', PA = 'TOKEN-PAGE-GIA-17A', PB = 'TOKEN-PAGE-GIA-17B', APP = 'TOKEN-APP-GIA-17'
        const trangA = { id: 'PGA', name: 'Trang A', category: 'Cửa hàng', fan_count: 50, access_token: PA, instagram_business_account: { id: 'IG1' } }
        const trangB = { id: 'PGB', name: 'Trang B', category: 'Cửa hàng', fan_count: 7, access_token: PB }
        let dsTrang: any[] = [trangA]
        let loiAccounts: DapGraph | null = null
        let loiBai: DapGraph | null = null
        /** debug_token theo token GỌI (access_token); không có ⇒ lỗi "chỉ nhà phát triển app" như Facebook thật */
        let dbg: Record<string, DapGraph> = {}
        const KHONG_DOC_DBG = loiGraph(400, 100, '(#100) You must provide an app access token, or a user access token that is an owner or developer of the app')
        const upserts: any[] = []
        const prisma17 = { fbPage: { upsert: async (a: any) => { upserts.push(JSON.parse(JSON.stringify(a))); return {} } } }
        const dap17 = (m: string, d: string): DapGraph => {
            const g = goiGraph[goiGraph.length - 1]
            const tk = g?.token || ''
            const xinLoai = /category/.test(g?.tham?.fields || '')
            if (m !== 'GET') return loiGraph(500, 1, 'bộ kiểm: mục 17 không được GHI')
            if (d === 'me') {
                if (tk === U) return xinLoai ? loiGraph(400, 100, '(#100) Tried accessing nonexisting field (category) on node type (User)') : { status: 200, body: { id: 'U17', name: 'Chủ shop' } }
                if (tk === APP) return xinLoai ? loiGraph(400, 100, '(#100) Tried accessing nonexisting field (category) on node type (Application)') : { status: 200, body: { id: 'APP17', name: 'App' } }
                if (tk === PA) return { status: 200, body: { id: 'PGA', name: 'Trang A', category: 'Cửa hàng', fan_count: 50 } }
                if (tk === PB) return { status: 200, body: { id: 'PGB', name: 'Trang B', category: 'Cửa hàng', fan_count: 7 } }
                return loiGraph(400, 190, 'Invalid OAuth access token - Cannot parse access token')
            }
            if (d === 'me/accounts') return tk !== U ? loiGraph(400, 100, '(#100) Tried accessing nonexisting field (accounts) on node type (Page)') : loiAccounts || { status: 200, body: { data: dsTrang } }
            if (/^PG[AB]\/posts$/.test(d)) return loiBai || { status: 200, body: { data: [] } }
            if (d === 'debug_token') return dbg[tk] || KHONG_DOC_DBG
            return loiGraph(404, 803, `bộ kiểm: mục 17 không giả ${d}`)
        }
        const chay = async (tham: any) => {
            upserts.length = 0; goiGraph.length = 0
            try { return { kq: await noiPageTokenDanTay({ prisma: prisma17, bayGio: NOW, nguoi: 'u1', ...tham }) as any, loi: null as any } } catch (e: any) { return { kq: null as any, loi: e } }
        }
        const datLai17 = () => { dsTrang = [trangA]; loiAccounts = null; loiBai = null; dbg = {} }
        const docDuoc = (expires_at: number, them: any = {}): DapGraph => ({ status: 200, body: { data: { type: 'PAGE', is_valid: true, expires_at, ...them } } })
        const giay = (ms: number) => Math.floor(ms / 1000)
        batGraphGia()
        dapGraph = dap17
        try {
            datLai17(); dbg[PA] = docDuoc(0, { data_access_expires_at: giay(NOW + 80 * 86400_000) })
            let r = await chay({ accessToken: PA })
            const u0 = upserts[0]
            dung('17a. PAGE token + debug_token expires_at 0 ⇒ lưu hạn null (không hết hạn), không cảnh báo, hạn THẬT; không đọc me/accounts',
                !r.loi && r.kq.pageId === 'PGA' && !r.kq.tuUserToken && r.kq.hanThat === true && r.kq.hetHan === null && r.kq.canhBao === null
                && u0?.create?.tokenExpiresAt === null && u0?.update?.tokenExpiresAt === null && u0?.create?.accessToken === PA && u0?.create?.connectedBy === 'u1'
                && !goiGraph.some(g => g.duong === 'me/accounts') && goiGraph.some(g => g.duong === 'debug_token' && g.tham?.input_token === PA),
                r.loi?.message || JSON.stringify(r.kq?.canhBao))

            datLai17(); dbg[PA] = docDuoc(giay(NOW + 3 * H + 10 * 60_000))
            r = await chay({ accessToken: PA })
            dung('17b. token còn ~3 giờ ⇒ VẪN lưu đúng hạn đó + cảnh báo gắt "khoảng 3 giờ" kèm cách gia hạn',
                !r.loi && r.kq.hanThat && Math.abs(r.kq.hetHan - (NOW + 3 * H + 10 * 60_000)) < 1000 && /khoảng 3 giờ/.test(r.kq.canhBao || '')
                && /Extend Access Token/.test(r.kq.canhBao || '') && upserts[0]?.update?.tokenExpiresAt === new Date(r.kq.hetHan).toISOString(), r.loi?.message || r.kq?.canhBao)

            datLai17(); const han50 = giay(NOW + 50 * 86400_000); dbg[PA] = docDuoc(han50)
            r = await chay({ accessToken: PA })
            dung('17c. token còn 50 ngày ⇒ ghi ĐÚNG hạn Facebook trả (không phải 55 ngày đoán), không cảnh báo',
                !r.loi && r.kq.hetHan === han50 * 1000 && r.kq.canhBao === null && upserts[0]?.create?.tokenExpiresAt === new Date(han50 * 1000).toISOString(),
                r.loi?.message || JSON.stringify(r.kq?.hetHan))

            datLai17()
            r = await chay({ accessToken: PA })
            dung('17d. debug_token không đọc được ⇒ đoán 55 ngày như cũ, hanThat=false, cảnh báo NÓI RÕ là tạm tính',
                !r.loi && r.kq.hanThat === false && r.kq.hetHan === NOW + 55 * 86400_000 && /tạm tính 55 ngày/.test(r.kq.canhBao || ''), r.loi?.message || r.kq?.canhBao)
            datLai17(); dbg[PA] = { status: 200, body: { data: { is_valid: false, expires_at: 0 } } }
            r = await chay({ accessToken: PA })
            dung('17d2. debug_token is_valid=false ⇒ không tin expires_at 0 (không ghi "không hết hạn"), về đoán 55 ngày',
                !r.loi && r.kq.hanThat === false && r.kq.hetHan === NOW + 55 * 86400_000, r.loi?.message || JSON.stringify(r.kq?.hetHan))

            datLai17(); dbg[U] = docDuoc(0)
            r = await chay({ accessToken: U })
            const u1 = upserts[0]
            const dbgGoi = goiGraph.filter(g => g.duong === 'debug_token')
            dung('17e. USER token, MỘT fanpage ⇒ lưu PAGE token của fanpage (KHÔNG lưu USER token) + igUserId; đọc bài bằng page token; debug_token bằng USER token trước',
                !r.loi && r.kq.tuUserToken === true && r.kq.pageId === 'PGA' && u1?.create?.accessToken === PA && u1?.update?.accessToken === PA
                && !JSON.stringify(u1).includes(U) && u1?.create?.igUserId === 'IG1' && u1?.create?.name === 'Trang A' && u1?.create?.fanCount === 50
                && goiGraph.some(g => g.duong === 'PGA/posts' && g.token === PA) && dbgGoi[0]?.token === U && dbgGoi[0]?.tham?.input_token === PA && r.kq.hetHan === null,
                r.loi?.message || JSON.stringify(goiGraph.map(g => g.duong)))

            datLai17(); dbg[PA] = docDuoc(giay(NOW + 2 * H))
            r = await chay({ accessToken: U })
            dung('17e2. debug_token bằng USER token hỏng ⇒ thử tiếp bằng page token, đọc được hạn ~2 giờ ⇒ cảnh báo',
                !r.loi && r.kq.hanThat === true && goiGraph.filter(g => g.duong === 'debug_token').map(g => g.token === U ? 'U' : g.token === PA ? 'PA' : '?').join(',') === 'U,PA'
                && /khoảng 2 giờ/.test(r.kq.canhBao || ''), r.loi?.message || r.kq?.canhBao)

            datLai17(); dsTrang = [trangA, trangB]
            r = await chay({ accessToken: U })
            dung('17f. USER token quản lý 2 fanpage, không chọn ⇒ FB_CHON_PAGE kèm [{id,name}], KHÔNG lộ token nào, không lưu',
                r.loi instanceof LoiNoiToken && r.loi.code === 'FB_CHON_PAGE' && JSON.stringify(r.loi.them) === '{"pages":[{"id":"PGA","name":"Trang A"},{"id":"PGB","name":"Trang B"}]}'
                && ![U, PA, PB].some(t => (r.loi.message + JSON.stringify(r.loi.them)).includes(t)) && upserts.length === 0, `${r.loi?.code} ${r.loi?.message}`)
            r = await chay({ accessToken: U, pageId: 'PGB' })
            dung('17g. gửi lại kèm pageId PGB ⇒ lưu token của PGB (không có Instagram ⇒ không ghi đè igUserId)',
                !r.loi && r.kq.pageId === 'PGB' && upserts[0]?.create?.accessToken === PB && !('igUserId' in (upserts[0]?.update || {})), r.loi?.message)
            r = await chay({ accessToken: U, pageId: 'PGX' })
            dung('17h. pageId không thuộc tài khoản ⇒ FB_PAGE_KHONG_THUOC, nêu tên fanpage thấy được, không lưu',
                r.loi instanceof LoiNoiToken && r.loi.code === 'FB_PAGE_KHONG_THUOC' && /Trang A, Trang B/.test(r.loi.message) && upserts.length === 0, r.loi?.message)

            datLai17(); dsTrang = []
            r = await chay({ accessToken: U })
            dung('17i. USER token không thấy fanpage nào ⇒ FB_KHONG_CO_PAGE (chỉ cách tick fanpage lúc Generate)',
                r.loi?.code === 'FB_KHONG_CO_PAGE' && /pages_show_list/.test(r.loi?.message || '') && upserts.length === 0, r.loi?.message)
            datLai17(); dsTrang = [{ ...trangA, access_token: undefined }]
            r = await chay({ accessToken: U })
            dung('17j. me/accounts không trả page token ⇒ FB_KHONG_CO_PAGE_TOKEN, không lưu', r.loi?.code === 'FB_KHONG_CO_PAGE_TOKEN' && upserts.length === 0, r.loi?.message)
            datLai17(); loiAccounts = loiGraph(403, 200, '(#200) Requires pages_show_list permission')
            r = await chay({ accessToken: U })
            dung('17k. me/accounts lỗi (#200 thiếu pages_show_list) ⇒ FB_KHONG_DOC_DUOC_PAGE nêu quyền, không lưu',
                r.loi?.code === 'FB_KHONG_DOC_DUOC_PAGE' && /pages_show_list/.test(r.loi?.message || '') && upserts.length === 0, r.loi?.message)

            datLai17()
            r = await chay({ accessToken: PA, pageId: 'PGB' })
            dung('17l. PAGE token mà pageId gửi kèm khác ⇒ FB_PAGE_KHONG_KHOP, không lưu', r.loi?.code === 'FB_PAGE_KHONG_KHOP' && upserts.length === 0, r.loi?.message)
            r = await chay({ accessToken: 'TOKEN-CHET-GIA-17' })
            dung('17m. token chết (#190) ⇒ FB_TOKEN_INVALID, không lưu', r.loi?.code === 'FB_TOKEN_INVALID' && upserts.length === 0, r.loi?.message)
            r = await chay({ accessToken: `${PA} ${PB}` })
            dung('17m2. token lẫn khoảng trắng ⇒ FB_TOKEN_INVALID, KHÔNG gọi Facebook', r.loi?.code === 'FB_TOKEN_INVALID' && goiGraph.length === 0, r.loi?.message)
            r = await chay({ accessToken: '   ' })
            dung('17m3. token rỗng ⇒ FB_TOKEN_THIEU, không gọi Facebook', r.loi?.code === 'FB_TOKEN_THIEU' && goiGraph.length === 0, r.loi?.message)
            r = await chay({ accessToken: APP })
            dung('17m4. token của APP ⇒ FB_NOT_PAGE_TOKEN, không đọc me/accounts', r.loi?.code === 'FB_NOT_PAGE_TOKEN' && !goiGraph.some(g => g.duong === 'me/accounts'), r.loi?.message)

            datLai17(); loiBai = loiGraph(403, 10, '(#10) This endpoint requires the pages_read_engagement permission'); dbg[PA] = docDuoc(0)
            r = await chay({ accessToken: PA })
            dung('17n. đọc bài hỏng (thiếu pages_read_engagement) ⇒ VẪN lưu, cảnh báo quyền', !r.loi && upserts.length === 1 && /pages_read_engagement/.test(r.kq.canhBao || ''), r.loi?.message || r.kq?.canhBao)
        } finally {
            traFetch()
            dapGraph = graphOn
        }
        const rtF = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'fanpage.ts'), 'utf8').replace(/\r\n/g, '\n')
        const than = rtF.slice(rtF.indexOf("router.post('/connect-page-token'"), rtF.indexOf("router.get('/pages'"))
        dung('17o. route: lõi noiPageTokenDanTay; LoiNoiToken ⇒ 400, danh sách đi TRƯỚC success/error/code; webhook bằng kq.pageToken; trả về KHÔNG có token',
            than.length > 0 && /noiPageTokenDanTay\(/.test(than)
            && /e instanceof LoiNoiToken\) return res\.status\(400\)\.json\(\{ \.\.\.e\.them, success: false, error: e\.message, code: e\.code \}\)/.test(than)
            && /trySubscribeWebhook\(prisma, pageId, kq\.pageToken\)/.test(than) && (than.match(/pageToken/g) || []).length === 2
            && !/accessToken: true/.test(than) && !/FB_NOT_PAGE_TOKEN|55 \* 86400_000/.test(than), than.slice(0, 120))
    }

    // ─── 18. Sửa giá bài đã lên (10/11/2026, lô 21: FB-15) ──────────────────────
    {
        // hàm thuần
        dung('18-1. dòng giá: "Giá: 126.000đ" / "Giá: 26.000đồng" / "Giá: 26.000đ5" KHÔNG phải dòng 26.000đ Pilot viết',
            thayGiaTrongBai('Giá: 126.000đ', 26000, 27000) === null && thayGiaTrongBai('x Giá: 26.000đồng', 26000, 27000) === null
            && !coDongGia('Giá: 26.000đ5', 26000) && coDongGia('Giá: 26.000đ.', 26000))
        const thay2 = thayGiaTrongBai('💰 Giá: 26.000đ\nCombo Giá: 26.000đ/cái.', 26000, 1027000)
        dung('18-2. thay MỌI dòng đúng khuôn, giữ chữ quanh', thay2 === '💰 Giá: 1.027.000đ\nCombo Giá: 1.027.000đ/cái.', String(thay2))
        dung('18-3. chữ dấu tách (NFD) vẫn nhận, trả chữ NFC', thayGiaTrongBai('🔹 Mũi khoan\nGiá: 26.000đ'.normalize('NFD'), 26000, 27000) === '🔹 Mũi khoan\nGiá: 27.000đ')
        dung('18-4. giá mới ≤ 0 / chữ rỗng ⇒ không thay; khuôn dòng = "Giá: 26.000đ"',
            thayGiaTrongBai('Giá: 26.000đ', 26000, 0) === null && thayGiaTrongBai('', 26000, 27000) === null && dongGiaBai(26000) === 'Giá: 26.000đ')
        const ke = (id: string, status: string, giaMoi: number, luc: number, result: any = null): any => ({ id, kind: 'edit', status, data: { giaMoi }, result, createdAt: luc, updatedAt: 100 - luc })
        const st = giaBaiTheoPilot({ data: { price: 26000 } } as any, [ke('a', 'succeeded', 27000, 1), ke('b', 'succeeded', 28000, 3), ke('c', 'cancelled', 29000, 4), ke('d', 'draft', 30000, 5), ke('f', 'uncertain', 31000, 6)])
        const st0 = giaBaiTheoPilot({ data: { price: 26000 } } as any, [ke('g', 'skipped', 27000, 1, { boQuan: true })])
        dung('18-5. giá bài theo Pilot = lần sửa THÀNH CÔNG lập sau cùng (theo createdAt, không theo updatedAt); nháp mở / chưa rõ tách riêng; chưa sửa ⇒ giá lúc đăng, mắt xích "goc"',
            st.gia === 28000 && st.chuoi === 'b' && st.mo.map(k => k.id).join() === 'd' && st.chuaRo?.id === 'f' && !st.boQuan
            && st0.gia === 26000 && st0.chuoi === 'goc' && st0.boQuan === true, JSON.stringify({ st, st0 }))
        dung('18-6. chính sách: "Sửa giá trên bài đã đăng" mặc định BẬT, tắt được; sổ cấu hình có nhãn riêng',
            CHINH_SACH_FB_MAC_DINH.automation.editPrices === true && chuanHoaChinhSachFb({}).automation.editPrices === true
            && chuanHoaChinhSachFb({ automation: { editPrices: false } }).automation.editPrices === false
            && (NHAN_FACEBOOK as any)['policy.automation.editPrices']?.[0] === 'Sửa giá trên bài đã đăng khi giá bán đổi')
        dung('18-7. hướng dẫn: sửa giá bài đã đăng; Xem trước chỉ để xem; không tự ghi "hết hàng"',
            /"Sửa giá trên bài đã đăng"/.test(HUONG_DAN_FB_PILOT) && /chưa sửa gì trên Facebook/.test(HUONG_DAN_FB_PILOT) && /KHÔNG tự ghi "hết hàng"/.test(HUONG_DAN_FB_PILOT))
        batGraphGia(); goiGraph.length = 0; dapGraph = graphOn
        try {
            const r = await new FacebookService('TOKEN-GIA-18').editPost('PG1_9001', 'Giá: 27.000đ')
            dung('18-8. FacebookService.editPost = POST /{post-id} (Graph sửa bài Trang)',
                r.success === true && goiGraph.length === 1 && goiGraph[0].method === 'POST' && goiGraph[0].duong === 'PG1_9001', JSON.stringify(goiGraph))
        } finally {
            traFetch(); dapGraph = graphOn
        }

        // chu kỳ trên kho bộ nhớ + Facebook giả giữ chữ sống
        datLai(); goiFb.length = 0; thongBao.length = 0; bayGio = NOW; baiSongBat = true
        const P = 60_000
        const sp = (id: string) => hang.find(h => h.id === id)!
        const them = (id: string, sku: string, name: string, gia: number, ton: number) => hang.push({
            id, sku, name, description: '', productType: 'goods', sellingPrice: gia, stock: ton, mergedIntoId: null, bundleId: null,
            createdAt: new Date(NOW), images: [{ url: ANH(sku.toLowerCase()), isPrimary: true }],
        })
        them('p8', 'KEO', 'Kéo cắt tôn', 85000, 12); them('p9', 'DAY', 'Dây rút nhựa', 45000, 20); them('p10', 'BUT', 'Bút thử điện', 12000, 50)
        them('p11', 'KIM', 'Kìm điện', 30000, 5); them('p12', 'THUOC', 'Thước cuộn', 40000, 7)
        const kho = khoBoNhoFb()
        const ctx = ngCanh(kho)
        await luuCauHinhFb(ctx, { executionMode: 'auto', policy: { maxWritesPerDay: 200, automation: { posts: false, replyPriceQuestions: false, hidePhoneComments: false } } })
        const dang = async (sku: string, scheduledAt?: number) => thucThiFb(ctx, (await taoKeHoachBai(ctx, scheduledAt ? { sku, scheduledAt } : { sku, publishNow: true })).id)
        const chuKy = async () => { bayGio += 5 * P; goiFb.length = 0; return chayChuKyFb(ctx) }
        const sua = (postId?: string) => kho._keHoach.filter(k => k.kind === 'edit' && (!postId || k.data?.postId === postId))
        const lay = (id: string) => kho._keHoach.find(k => k.id === id)
        const lenhSua = () => goiFb.filter(g => g[0] === 'edit')
        const dongSua = (kq: any) => (kq?.results || []).filter((r: any) => r.action === 'edit')
        const capHienTai = async () => luuCauHinhFb(ctx, { policy: { maxWritesPerDay: Math.max(1, await kho.demGhiTuLuc(dauNgayVN(bayGio))) } })
        const moCap = async () => luuCauHinhFb(ctx, { policy: { maxWritesPerDay: 200 } })
        const chu = (postId: string) => baiSong.get(postId)?.message || ''
        const doiChu = (postId: string, cu: string | RegExp, moi: string) => { const b = baiSong.get(postId); if (b) b.message = b.message.replace(cu as any, moi) }
        try {
            const bK = await dang('KHOAN10'), bO = await dang('OC4')
            const idK = String(bK.result?.postId), idO = String(bO.result?.postId)
            const goc = chu(idK)
            dung('18a0. bài Pilot đã lên mang dòng giá đúng khuôn', bK.status === 'succeeded' && coDongGia(goc, 26000) && coDongGia(chu(idO), 189000), goc)

            let kq = await chuKy()
            dung('18a. không bài nào lệch giá kho ⇒ chu kỳ KHÔNG gọi Facebook, không lập kế hoạch sửa',
                goiFb.length === 0 && sua().length === 0 && dongSua(kq).length === 0, JSON.stringify(goiFb))

            sp('p1').sellingPrice = 27000
            kq = await chuKy()
            const e1 = sua(idK)[0]
            const docDs = goiFb.filter(g => g[0] === 'get' && g[1] === 'PG1/posts')
            dung('18b. giá kho đổi (Tự động) ⇒ đọc danh sách bài MỘT lần, MỘT lệnh sửa: chỉ dòng giá đổi, chữ khác giữ nguyên',
                docDs.length === 1 && docDs[0][2]?.fields === 'id,message,permalink_url' && docDs[0][2]?.limit === 100
                && lenhSua().length === 1 && lenhSua()[0][1] === idK && lenhSua()[0][2] === goc.replace('Giá: 26.000đ', 'Giá: 27.000đ') && !lenhSua().some(g => g[1] === idO),
                JSON.stringify(goiFb))
            dung('18c. kế hoạch "edit" hoàn tất: giá cũ / mới, mắt xích "goc", lượt 1, khoá cycle:edit:<bài>:goc:27000:1, có link bài',
                e1?.status === 'succeeded' && e1.data.giaCu === 26000 && e1.data.giaMoi === 27000 && e1.data.chuoi === 'goc' && e1.data.luot === 1
                && e1.idempotencyKey === `cycle:edit:${idK}:goc:27000:1` && e1.data.permalink === `https://www.facebook.com/${idK}`, JSON.stringify(e1))
            dung('18d. nhật ký "edit" (tính trần ghi); FbScheduledPost của bài mang chữ mới; dòng kết quả nêu Giá cũ → mới, không cần người',
                kho._nhatKy.some(w => w.action === 'edit' && w.status === 'succeeded' && w.planId === e1?.id)
                && baiDaHen.find(b => b.fbPostId === idK)?.message === chu(idK)
                && dongSua(kq).some((r: any) => r.status === 'succeeded' && r.planId === e1?.id && /Giá: 26\.000đ → Giá: 27\.000đ/.test(r.message) && !canNguoi(r)),
                JSON.stringify(dongSua(kq)))
            kq = await chuKy()
            dung('18e. chu kỳ sau cùng giá ⇒ KHÔNG gọi Facebook (giá bài theo Pilot đã là 27.000đ)', goiFb.length === 0 && sua().length === 1, JSON.stringify(goiFb))

            sp('p1').sellingPrice = 28000
            kq = await chuKy()
            const e2 = sua(idK).find(k => k.data.giaMoi === 28000)
            dung('18f. giá đổi tiếp ⇒ sửa từ dòng Pilot ghi lần trước (27.000đ → 28.000đ), mắt xích = lần sửa trước',
                e2?.status === 'succeeded' && e2.data.giaCu === 27000 && e2.data.chuoi === e1?.id && lenhSua().length === 1
                && /Giá: 28\.000đ/.test(lenhSua()[0][2]) && !/Giá: 2[67]\.000đ/.test(lenhSua()[0][2]), JSON.stringify(e2))

            // Xem trước: chỉ để xem
            await luuCauHinhFb(ctx, { executionMode: 'preview' })
            sp('p1').sellingPrice = 29000
            kq = await chuKy()
            const x1 = sua(idK).find(k => k.data.giaMoi === 29000)
            const dx = dongSua(kq).find((r: any) => r.planId === x1?.id)
            dung('18g. Xem trước ⇒ nháp (khoá cycle:xem:edit:) mang chữ dự kiến, KHÔNG ghi Facebook; dòng nói "CHƯA sửa", không thành việc cần người',
                x1?.status === 'draft' && String(x1.idempotencyKey).startsWith('cycle:xem:edit:') && ghiFb().length === 0
                && x1.data.messageMoi === chu(idK).replace('Giá: 28.000đ', 'Giá: 29.000đ') && x1.data.messageCu === chu(idK)
                && !!dx && /Xem trước: CHƯA sửa trên Facebook/.test(dx.message) && !canNguoi(dx), JSON.stringify(dx))
            goiFb.length = 0
            const tx = x1 ? await thucThiFb(ctx, x1.id) : null
            dung('18h. Xem trước: bấm Thực thi nháp sửa giá ⇒ không gọi Facebook', tx?.executed === false && goiFb.length === 0)
            kq = await chuKy()
            dung('18i. Xem trước, chu kỳ sau cùng giá ⇒ giữ nháp cũ, KHÔNG gọi Facebook, không lập thêm',
                goiFb.length === 0 && sua(idK).length === 3 && lay(String(x1?.id))?.status === 'draft', JSON.stringify(goiFb))
            sp('p1').sellingPrice = 28000
            kq = await chuKy()
            dung('18j. giá trở về đúng giá bài đang ghi ⇒ nháp tự huỷ êm (tuHuy), không gọi Facebook',
                lay(String(x1?.id))?.status === 'cancelled' && lay(String(x1?.id))?.result?.tuHuy === true && goiFb.length === 0 && sua(idK).length === 3)

            await luuCauHinhFb(ctx, { executionMode: 'auto' })
            sp('p1').sellingPrice = 29000
            kq = await chuKy()
            const e3 = sua(idK).find(k => k.data.giaMoi === 29000 && k.status === 'succeeded')
            dung('18k. về Tự động ⇒ lập lại theo giá hiện tại (lượt 2: nháp Xem trước cùng bước đã tự huỷ) rồi sửa luôn',
                e3?.data.luot === 2 && e3.idempotencyKey === `cycle:edit:${idK}:${e2?.id}:29000:2` && lenhSua().length === 1 && /Giá: 29\.000đ/.test(lenhSua()[0][2]), JSON.stringify(e3))

            // người sửa tay trên Facebook
            sp('p1').sellingPrice = 30000
            doiChu(idK, 'Giá: 29.000đ', 'Giá: 30.000đ')
            kq = await chuKy()
            const e4 = sua(idK).find(k => k.data.giaMoi === 30000)
            dung('18l. chủ shop đã tự sửa bài sang giá mới ⇒ ghi nhận "không cần sửa", KHÔNG gọi lệnh sửa, không tốn lượt ghi',
                e4?.status === 'succeeded' && e4.result?.khongCanSua === true && lenhSua().length === 0 && !kho._nhatKy.some(w => w.planId === e4?.id), JSON.stringify(e4))
            kq = await chuKy()
            dung('18m. sau đó cùng giá ⇒ không gọi Facebook (giá bài theo Pilot = 30.000đ)', goiFb.length === 0, JSON.stringify(goiFb))
            sp('p1').sellingPrice = 31000
            doiChu(idK, /(💰 )?Giá: 30\.000đ/, 'Chỉ 30k thôi ạ')
            kq = await chuKy()
            const e5 = sua(idK).find(k => k.data.giaMoi === 31000)
            const d5 = dongSua(kq).find((r: any) => r.planId === e5?.id)
            dung('18n. người viết lại giá cũ kiểu khác ("30k") ⇒ KHÔNG sửa chữ người viết; "failed" cần người sửa tay',
                e5?.status === 'failed' && e5.result?.boQuan === true && lenhSua().length === 0 && !!d5 && canNguoi(d5) && /sửa tay thành 31\.000đ/.test(d5.message), JSON.stringify(d5))
            sp('p1').sellingPrice = 32000
            kq = await chuKy()
            dung('18o. bài đã thôi theo dõi ⇒ giá đổi tiếp cũng không gọi Facebook', goiFb.length === 0 && !sua(idK).some(k => k.data.giaMoi === 32000))
            const bO2 = baiSong.get(idO)
            if (bO2) bO2.message = bO2.message.split('\n').filter(l => !/Giá:/.test(l)).join('\n')
            sp('p2').sellingPrice = 199000
            kq = await chuKy()
            const o1 = sua(idO)[0]
            const dO = dongSua(kq).find((r: any) => r.planId === o1?.id)
            dung('18p. bài không còn dòng giá (người bỏ) ⇒ "skipped", thôi theo dõi, không gọi lệnh sửa, không cần người',
                o1?.status === 'skipped' && o1.result?.boQuan === true && lenhSua().length === 0 && !!dO && !canNguoi(dO), JSON.stringify(o1))

            // bài mất / tồn ≤ 0
            const idKeo = String((await dang('KEO')).result?.postId)
            baiSong.delete(idKeo)
            sp('p8').sellingPrice = 90000
            kq = await chuKy()
            dung('18q. bài lệch giá không còn trên fanpage ⇒ dòng "không thấy", không lập kế hoạch, không gọi lệnh sửa',
                !sua(idKeo).length && lenhSua().length === 0 && dongSua(kq).some((r: any) => r.status === 'skipped' && /không thấy trên fanpage \(KEO\)/.test(r.message)), JSON.stringify(dongSua(kq)))
            sp('p8').sellingPrice = 85000
            const idDay = String((await dang('DAY')).result?.postId)
            sp('p9').stock = 0
            kq = await chuKy()
            const dHet = dongSua(kq).find((r: any) => /tồn kho ≤ 0/.test(r.message))
            dung('18r. tồn ≤ 0 ⇒ chỉ NÊU (chưa chắc hết hàng), không gọi Facebook, không cần người',
                !!dHet && /\(DAY\)/.test(dHet.message) && /KHÔNG ghi "hết hàng"/.test(dHet.message) && !canNguoi(dHet) && goiFb.length === 0, JSON.stringify(dongSua(kq)))
            sp('p9').sellingPrice = 49000
            kq = await chuKy()
            dung('18s. tồn ≤ 0 mà giá đổi ⇒ vẫn sửa GIÁ; chữ mới không có "hết hàng"',
                lenhSua().length === 1 && lenhSua()[0][1] === idDay && /Giá: 49\.000đ/.test(lenhSua()[0][2]) && !/hết hàng/i.test(lenhSua()[0][2]), JSON.stringify(lenhSua()))
            sp('p9').stock = 20

            // phạm vi bài: hẹn vừa lên / quá 30 ngày / fanpage khác
            const hen = bayGio + 20 * P
            const idBut = String((await dang('BUT', hen)).result?.postId)
            bayGio = hen + 5 * P // chuKy +5 phút ⇒ hen + 10 phút
            sp('p10').sellingPrice = 13000
            kq = await chuKy()
            dung('18t. bài hẹn mới tới giờ < 30 phút ⇒ chưa đụng (việc của soát bài hẹn sắp lên)', goiFb.length === 0 && !sua(idBut).length, JSON.stringify(goiFb))
            bayGio = hen + 26 * P // ⇒ hen + 31 phút
            kq = await chuKy()
            dung('18u. bài hẹn đã lên quá 30 phút ⇒ sửa giá như bài thường',
                lenhSua().length === 1 && lenhSua()[0][1] === idBut && /Giá: 13\.000đ/.test(lenhSua()[0][2]), JSON.stringify(goiFb))
            const bKim = await dang('KIM'); const idKim = String(bKim.result?.postId)
            const kKim = lay(bKim.id)!
            kKim.createdAt = bayGio - 31 * 86400_000
            sp('p11').sellingPrice = 33000
            kq = await chuKy()
            dung('18v. bài lên quá 30 ngày ⇒ không sửa', goiFb.length === 0 && !sua(idKim).length, JSON.stringify(goiFb))
            kKim.createdAt = bayGio - 29 * 86400_000
            kq = await chuKy()
            dung('18w. bài lên 29 ngày ⇒ vẫn sửa', lenhSua().length === 1 && lenhSua()[0][1] === idKim, JSON.stringify(goiFb))
            const bTh = await dang('THUOC'); const idTh = String(bTh.result?.postId)
            lay(bTh.id)!.data.pageId = 'PG2'
            sp('p12').sellingPrice = 41000
            kq = await chuKy()
            dung('18x. bài của fanpage khác ⇒ không đụng', goiFb.length === 0 && !sua(idTh).length, JSON.stringify(goiFb))
            lay(bTh.id)!.data.pageId = 'PG1'

            // trần ghi / người huỷ
            await capHienTai()
            kq = await chuKy()
            const h1 = sua(idTh)[0]
            const dh = dongSua(kq).find((r: any) => r.planId === h1?.id)
            dung('18y. hết lượt ghi hôm nay ⇒ nháp nằm chờ; dòng "HẾT LƯỢT GHI" là việc cần người; không gọi lệnh sửa',
                h1?.status === 'draft' && lenhSua().length === 0 && !!dh && canNguoi(dh) && /HẾT LƯỢT GHI/.test(dh.message), JSON.stringify(dongSua(kq)))
            await moCap()
            kq = await chuKy()
            dung('18z. lượt sau còn lượt ⇒ thực thi CHÍNH nháp đó (không đọc lại danh sách bài), sửa một lần',
                lay(String(h1?.id))?.status === 'succeeded' && lenhSua().length === 1 && /Giá: 41\.000đ/.test(lenhSua()[0][2]) && !goiFb.some(g => g[1] === 'PG1/posts') && sua(idTh).length === 1,
                JSON.stringify(goiFb))
            await capHienTai()
            sp('p12').sellingPrice = 42000
            await chuKy()
            const h2 = sua(idTh).find(k => k.data.giaMoi === 42000 && k.status === 'draft')
            if (h2) await huyKeHoachFb(ctx, h2.id)
            await moCap()
            kq = await chuKy()
            dung('18aa. người huỷ nháp sửa giá ⇒ chu kỳ không đề xuất lại bước giá đó (nhớ 14 ngày), không gọi Facebook',
                !!h2 && lay(h2.id)?.status === 'cancelled' && goiFb.length === 0 && sua(idTh).filter(k => k.data.giaMoi === 42000).length === 1, JSON.stringify(goiFb))
            sp('p12').sellingPrice = 43000
            kq = await chuKy()
            dung('18ab. giá đổi sang mức khác ⇒ đề xuất lại theo giá mới (41.000đ → 43.000đ)',
                lenhSua().length === 1 && /Giá: 43\.000đ/.test(lenhSua()[0][2]) && !/Giá: 4[12]\.000đ/.test(lenhSua()[0][2]), JSON.stringify(lenhSua()))
            sp('p12').sellingPrice = 41000
            kq = await chuKy()
            dung('18ab1. giá quay về mức cũ (41.000đ) sau khi bài đã ghi 43.000đ ⇒ sửa lại 43.000đ → 41.000đ (bước mới, khoá mới)',
                lenhSua().length === 1 && /Giá: 41\.000đ/.test(lenhSua()[0][2]) && !/Giá: 43\.000đ/.test(lenhSua()[0][2])
                && sua(idTh).filter(k => k.data.giaMoi === 41000 && k.status === 'succeeded').length === 2, JSON.stringify(lenhSua()))
            const chuoiTh = giaBaiTheoPilot(lay(bTh.id)!, sua(idTh)).chuoi
            for (let i = 0; i < 5; i++) {
                kho._keHoach.push({
                    id: `TUHUY-${i}`, kind: 'edit', status: 'cancelled', idempotencyKey: `cycle:edit:${idTh}:${chuoiTh}:44000:${i + 1}`,
                    data: { pageId: 'PG1', postId: idTh, productId: 'p12', sku: 'THUOC', giaCu: 41000, giaMoi: 44000, chuoi: chuoiTh, luot: i + 1 },
                    result: { tuHuy: true, message: 'Nháp máy tự huỷ.' }, createdBy: null, createdAt: bayGio - (10 - i) * P, updatedAt: Date.now(),
                } as any)
            }
            sp('p12').sellingPrice = 44000
            kq = await chuKy()
            const t6 = sua(idTh).find(k => k.data.giaMoi === 44000 && k.status === 'succeeded')
            dung('18ab2. 5 nháp máy TỰ huỷ (hết hạn / giá đổi) không phải 5 lần hỏng ⇒ vẫn lập lần 6 và sửa',
                t6?.data.luot === 6 && lenhSua().length === 1 && /Giá: 44\.000đ/.test(lenhSua()[0][2]), JSON.stringify(dongSua(kq)))

            // hỏng ⇒ 24 giờ; 5 lần thì thôi
            loiSua = Object.assign(new Error('(#100) Invalid parameter'), { code: 100 })
            sp('p10').sellingPrice = 14000
            kq = await chuKy()
            const f1 = sua(idBut).find(k => k.data.giaMoi === 14000)
            dung('18ac. Facebook từ chối lệnh sửa ⇒ "failed" (việc cần người), chữ bài giữ nguyên',
                f1?.status === 'failed' && lenhSua().length === 1 && dongSua(kq).some((r: any) => r.planId === f1?.id && canNguoi(r)) && /Giá: 13\.000đ/.test(chu(idBut)), JSON.stringify(f1?.result))
            kq = await chuKy()
            dung('18ad. vừa hỏng < 24 giờ ⇒ không thử lại, không gọi Facebook', goiFb.length === 0 && sua(idBut).filter(k => k.data.giaMoi === 14000).length === 1, JSON.stringify(goiFb))
            const lui = () => { for (const k of kho._keHoach) if (k.kind === 'edit' && k.data?.postId === idBut && k.status === 'failed') k.updatedAt = bayGio - 25 * H }
            for (let i = 0; i < 4; i++) { lui(); await chuKy() }
            const hong = sua(idBut).filter(k => k.data.giaMoi === 14000)
            dung('18ae. quá 24 giờ ⇒ thử lại, lượt tăng dần, khoá khác nhau',
                hong.length === 5 && hong.every(k => k.status === 'failed') && new Set(hong.map(k => k.idempotencyKey)).size === 5 && hong.map(k => k.data.luot).join() === '1,2,3,4,5',
                hong.map(k => `${k.data.luot}:${k.status}`).join())
            lui()
            kq = await chuKy()
            const dq = dongSua(kq).find((r: any) => /hỏng 5 lần/.test(r.message))
            dung('18af. hỏng 5 lần ⇒ máy thôi thử (không gọi Facebook), báo người sửa tay',
                !!dq && canNguoi(dq) && /BUT/.test(dq.message) && goiFb.length === 0 && sua(idBut).filter(k => k.data.giaMoi === 14000).length === 5, JSON.stringify(dongSua(kq)))
            loiSua = null
            sp('p10').sellingPrice = 13000

            // chưa rõ ⇒ chờ «Đã kiểm»
            loiSua = new TypeError('fetch failed')
            sp('p9').sellingPrice = 50000
            kq = await chuKy()
            loiSua = null
            const u1 = sua(idDay).find(k => k.data.giaMoi === 50000)
            dung('18ag. mất mạng giữa lệnh sửa ⇒ "uncertain" (không rõ Facebook đã sửa chưa), việc cần người',
                u1?.status === 'uncertain' && dongSua(kq).some((r: any) => r.planId === u1?.id && canNguoi(r)), JSON.stringify(u1?.result))
            sp('p9').sellingPrice = 51000
            kq = await chuKy()
            dung('18ah. còn lần sửa CHƯA RÕ ⇒ không sửa tiếp bài đó, nhắc «Đã kiểm», không gọi Facebook',
                goiFb.length === 0 && !sua(idDay).some(k => k.data.giaMoi === 51000) && dongSua(kq).some((r: any) => /CHƯA RÕ/.test(r.message) && /\(DAY\)/.test(r.message)),
                JSON.stringify(dongSua(kq)))
            if (u1) await xacNhanDaKiemFb(ctx, { planId: u1.id, outcome: 'done' })
            doiChu(idDay, 'Giá: 49.000đ', 'Giá: 50.000đ') // Facebook thật đã nhận lệnh sửa
            kq = await chuKy()
            const u2 = sua(idDay).find(k => k.data.giaMoi === 51000)
            dung('18ai. «Đã kiểm: CÓ» ⇒ giá bài theo Pilot = 50.000đ, sửa tiếp 50.000đ → 51.000đ',
                u2?.status === 'succeeded' && u2.data.giaCu === 50000 && u2.data.chuoi === u1?.id && lenhSua().length === 1 && /Giá: 51\.000đ/.test(lenhSua()[0][2]), JSON.stringify(u2))
            loiSua = new TypeError('fetch failed')
            sp('p9').sellingPrice = 52000
            await chuKy()
            loiSua = null
            const u3 = sua(idDay).find(k => k.data.giaMoi === 52000)
            const u3TruocKiem = u3?.status
            if (u3) await xacNhanDaKiemFb(ctx, { planId: u3.id, outcome: 'not_done' })
            kq = await chuKy()
            const u4 = sua(idDay).filter(k => k.data.giaMoi === 52000)
            dung('18aj. «Đã kiểm: KHÔNG» ⇒ lập lại NGAY (không chờ 24 giờ), lượt 2, sửa 51.000đ → 52.000đ',
                u3TruocKiem === 'uncertain' && u4.length === 2 && u4[0].status === 'failed' && u4[1].status === 'succeeded' && u4[1].data.luot === 2 && u4[1].data.giaCu === 51000 && lenhSua().length === 1,
                u4.map(k => `${k.data.luot}:${k.status}`).join())

            // soát lại lúc THỰC THI
            await capHienTai()
            sp('p9').sellingPrice = 53000
            await chuKy()
            const g1 = sua(idDay).find(k => k.data.giaMoi === 53000 && k.status === 'draft')
            await moCap()
            sp('p9').sellingPrice = 54000
            goiFb.length = 0
            const tg1 = g1 ? await thucThiFb(ctx, g1.id) : null
            dung('18ak. người bấm Thực thi nháp sửa giá mà giá bán đã đổi tiếp ⇒ "failed", KHÔNG gọi Facebook',
                tg1?.status === 'failed' && /đã đổi tiếp thành 54\.000đ/.test(tg1.result?.message || '') && goiFb.length === 0, JSON.stringify(tg1?.result))
            kq = await chuKy()
            dung('18al. chu kỳ sau ⇒ lập theo giá hiện tại, sửa 52.000đ → 54.000đ',
                lenhSua().length === 1 && /Giá: 54\.000đ/.test(lenhSua()[0][2]) && sua(idDay).some(k => k.data.giaMoi === 54000 && k.status === 'succeeded' && k.data.giaCu === 52000), JSON.stringify(lenhSua()))
            await capHienTai()
            sp('p9').sellingPrice = 55000
            await chuKy()
            const g2 = sua(idDay).find(k => k.data.giaMoi === 55000 && k.status === 'draft')
            doiChu(idDay, 'Giá: 54.000đ', 'Giá: 55.000đ')
            await moCap()
            kq = await chuKy()
            dung('18am. lúc thực thi bài đã ghi giá mới (người sửa tay) ⇒ hoàn tất "không cần sửa", KHÔNG gọi lệnh sửa',
                !!g2 && lay(g2.id)?.status === 'succeeded' && lay(g2.id)?.result?.khongCanSua === true && lenhSua().length === 0, JSON.stringify(g2 && lay(g2.id)?.result))
            await capHienTai()
            sp('p9').sellingPrice = 56000
            await chuKy()
            const g3 = sua(idDay).find(k => k.data.giaMoi === 56000 && k.status === 'draft')
            await moCap()
            sp('p9').sellingPrice = 57000
            kq = await chuKy()
            dung('18an. nháp máy lỗi thời (giá đổi tiếp) ⇒ tự huỷ êm, KHÔNG bị thực thi lại theo giá cũ; sửa theo giá mới 55.000đ → 57.000đ',
                !!g3 && lay(g3.id)?.status === 'cancelled' && lay(g3.id)?.result?.tuHuy === true && lenhSua().length === 1 && /Giá: 57\.000đ/.test(lenhSua()[0][2]) && !/56\.000/.test(lenhSua()[0][2]),
                JSON.stringify({ g3: g3 && lay(g3.id), lenh: lenhSua() }))
            loiSua = Object.assign(new Error('(#4) Application request limit reached'), { code: 4 })
            sp('p9').sellingPrice = 57500
            kq = await chuKy()
            loiSua = null
            const r1 = sua(idDay).find(k => k.data.giaMoi === 57500)
            dung('18an2. Facebook giới hạn lượt gọi lúc sửa ⇒ giữ NHÁP (tamThoi), không phải việc cần người',
                r1?.status === 'draft' && r1.result?.tamThoi === true && lenhSua().length === 1 && !dongSua(kq).some((r: any) => r.planId === r1?.id && canNguoi(r)), JSON.stringify(r1))
            kq = await chuKy()
            dung('18an3. chu kỳ sau cùng giá ⇒ thực thi lại CHÍNH nháp đó',
                lay(String(r1?.id))?.status === 'succeeded' && lenhSua().length === 1 && /Giá: 57\.500đ/.test(lenhSua()[0][2]) && sua(idDay).filter(k => k.data.giaMoi === 57500).length === 1,
                JSON.stringify(lenhSua()))
            loiSua = Object.assign(new Error('(#4) Application request limit reached'), { code: 4 })
            sp('p9').sellingPrice = 57800
            await chuKy()
            loiSua = null
            const r2 = sua(idDay).find(k => k.data.giaMoi === 57800)
            const r2Truoc = `${r2?.status}:${!!r2?.result?.tamThoi}`
            sp('p9').sellingPrice = 57900
            kq = await chuKy()
            dung('18an4. nháp tamThoi lỗi thời (giá đổi tiếp) ⇒ tự huỷ êm, KHÔNG bị thực thi lại theo giá cũ; sửa 57.500đ → 57.900đ',
                r2Truoc === 'draft:true' && lay(String(r2?.id))?.status === 'cancelled' && lay(String(r2?.id))?.result?.tuHuy === true
                && lenhSua().length === 1 && /Giá: 57\.900đ/.test(lenhSua()[0][2]) && !/57\.800/.test(lenhSua()[0][2]), JSON.stringify({ r2Truoc, r2: r2 && lay(r2.id), lenh: lenhSua() }))
            await capHienTai()
            sp('p9').sellingPrice = 58000
            await chuKy()
            const g4 = sua(idDay).find(k => k.data.giaMoi === 58000 && k.status === 'draft')
            // "đang chạy" so với đồng hồ GIẢ của chu kỳ (chuKy cộng 5 phút trước khi chạy) — không dùng Date.now()
            if (g4) { const k = lay(g4.id)!; k.status = 'running'; k.updatedAt = bayGio + 5 * P }
            await moCap()
            sp('p9').sellingPrice = 58500
            kq = await chuKy()
            dung('18ao1. bài có lệnh sửa ĐANG chạy (lượt khác, < 1 giờ) ⇒ không lập / không gọi Facebook cho bài đó',
                !!g4 && lay(g4.id)?.status === 'running' && goiFb.length === 0 && !sua(idDay).some(k => k.data.giaMoi === 58500), JSON.stringify({ goiFb, g4: g4 && lay(g4.id) }))
            sp('p9').sellingPrice = 58000
            if (g4) lay(g4.id)!.updatedAt = bayGio - 2 * H
            kq = await chuKy()
            dung('18ao. lệnh sửa kẹt "đang chạy" quá 1 giờ ⇒ "uncertain" + nhắc mở bài kiểm dòng giá; không sửa tiếp bài đó',
                !!g4 && lay(g4.id)?.status === 'uncertain' && /dòng giá đã đổi chưa/.test(lay(g4.id)?.result?.message || '') && lenhSua().length === 0, JSON.stringify(g4 && lay(g4.id)))
            if (g4) await xacNhanDaKiemFb(ctx, { planId: g4.id, outcome: 'not_done' })
            kq = await chuKy()
            dung('18ao2. kiểm KHÔNG ⇒ chu kỳ sau sửa 57.900đ → 58.000đ',
                lenhSua().length === 1 && /Giá: 58\.000đ/.test(lenhSua()[0][2]) && !/57\.900/.test(lenhSua()[0][2]), JSON.stringify(lenhSua()))

            // công tắc / đọc hỏng / 100 bài / 10 bài mỗi chu kỳ
            await luuCauHinhFb(ctx, { policy: { automation: { editPrices: false } } })
            sp('p12').sellingPrice = 47000
            kq = await chuKy()
            dung('18ap. tắt "Sửa giá trên bài đã đăng" ⇒ chu kỳ không soát giá bài, không gọi Facebook', goiFb.length === 0 && dongSua(kq).length === 0, JSON.stringify(goiFb))
            dung('18aq. đổi công tắc ghi sổ cấu hình (nhãn riêng, không tính trần ghi)',
                kho._nhatKy.some(w => w.action === 'config' && /Sửa giá trên bài đã đăng/.test(String(w.payload?.tomTat || ''))))
            await luuCauHinhFb(ctx, { policy: { automation: { editPrices: true } } })
            loiDocBai = Object.assign(new Error('(#4) Application request limit reached'), { code: 4 })
            kq = await chuKy()
            dung('18ar. đọc danh sách bài bị Facebook giới hạn ⇒ "skipped" (lượt sau đọc lại), không lập / không sửa',
                dongSua(kq).some((r: any) => r.status === 'skipped' && /Không đọc được bài trên fanpage/.test(r.message)) && lenhSua().length === 0 && !sua(idTh).some(k => k.data.giaMoi === 47000),
                JSON.stringify(dongSua(kq)))
            loiDocBai = new Error('Lỗi lạ khi đọc')
            kq = await chuKy()
            dung('18as. đọc hỏng kiểu khác ⇒ "failed" (việc cần người)', dongSua(kq).some((r: any) => r.status === 'failed' && /Không đọc được bài/.test(r.message) && canNguoi(r)))
            loiDocBai = null
            baiDay100 = true
            kq = await chuKy()
            baiDay100 = false
            dung('18at. danh sách đủ 100 bài mà không có bài cần sửa ⇒ đọc lẻ bài đó rồi sửa',
                goiFb.some(g => g[0] === 'get' && g[1] === idTh && g[2]?.fields === 'id,message,permalink_url') && lenhSua().length === 1 && lenhSua()[0][1] === idTh && /Giá: 47\.000đ/.test(lenhSua()[0][2]),
                JSON.stringify(goiFb.map(g => g.slice(0, 2))))
            const loat: string[] = []
            for (let i = 0; i < 11; i++) {
                them(`pL${i}`, `LOAT${i}`, `Hàng loạt ${i}`, 10000 + i * 1000, 5)
                bayGio += P
                loat.push(String((await dang(`LOAT${i}`)).result?.postId))
            }
            for (let i = 0; i < 11; i++) sp(`pL${i}`).sellingPrice += 500
            kq = await chuKy()
            const daSua = new Set(lenhSua().map(g => g[1]))
            dung('18au. mỗi chu kỳ sửa tối đa 10 bài, bài MỚI trước; phần dư báo để chu kỳ sau',
                lenhSua().length === 10 && !daSua.has(loat[0]) && daSua.has(loat[10]) && dongSua(kq).some((r: any) => /tối đa 10 bài — còn 1 bài/.test(r.message)),
                JSON.stringify(dongSua(kq).map((r: any) => r.message)))
            kq = await chuKy()
            dung('18av. chu kỳ sau sửa nốt bài còn lại', lenhSua().length === 1 && lenhSua()[0][1] === loat[0], JSON.stringify(lenhSua().map(g => g[1])))

            const loc = await dsKeHoachFb(ctx, { kind: 'edit', limit: 100 })
            dung('18aw. danh sách kế hoạch lọc được loại "edit"', loc.plans.length > 0 && loc.plans.every(k => k.kind === 'edit'))
        } finally {
            baiSongBat = false; loiSua = null; loiDocBai = null; baiDay100 = false
        }
        const lenhSql: { sql: string; v: any[] }[] = []
        const pg: any = { $executeRawUnsafe: async () => 0, $queryRawUnsafe: async (sql: string, ...v: any[]) => { lenhSql.push({ sql, v }); return [] } }
        const ks = khoSqlFb(pg)
        const truocRong = lenhSql.length
        const rong = await ks.dsKeHoachSuaBai([])
        const sauRong = lenhSql.length
        await ks.dsKeHoachSuaBai(['PG1_1', 'PG1_2'])
        const lq = lenhSql[lenhSql.length - 1]
        dung('18ax. SQL dsKeHoachSuaBai: kind = \'edit\', data->>postId = ANY($1::text[]), cũ trước; danh sách rỗng ⇒ không truy vấn',
            rong.length === 0 && truocRong === sauRong && /kind = 'edit'/.test(lq?.sql || '') && /data::jsonb->>'postId' = ANY\(\$1::text\[\]\)/.test(lq?.sql || '')
            && /ORDER BY "createdAt" ASC, id ASC/.test(lq?.sql || '') && JSON.stringify(lq?.v) === '[["PG1_1","PG1_2"]]', lq?.sql)
    }

    console.log(`\n${loi === 0 ? '✅' : '❌'} ${dat} đạt, ${loi} hỏng\n`)
    if (loi > 0) process.exitCode = 1
}

main().catch(e => { console.error('LỖI BỘ KIỂM:', e); process.exitCode = 1 })
