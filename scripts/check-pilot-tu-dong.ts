/* ═══════════════════════════════════════════════════════════════════════════════
 *  BỘ KIỂM "TỰ ĐỘNG HOÀN TOÀN" của Pilot (03/11/2026)
 *
 *  Bài chạy thử chu kỳ THẬT trên dữ liệu KENGISTORE (chỉ đọc, sàn giả) cho thấy những chỗ máy phải chờ người hoặc
 *  làm sai mà không ai biết. Mỗi mục dưới đây canh một chỗ đã vá:
 *    A. báo chủ shop (lib/pilotBaoChuShop): việc cần người, chống lặp theo dấu, giãn 3 giờ, chu kỳ gãy báo ngay; (X-09) việc y hệt
 *       vẫn còn ⇒ nhắc lại sau 24 giờ; Xem trước chỉ báo chỗ làm Pilot mù (token, gian hỏng); cả 4 Pilot đi qua ketQuaDeBao;
 *       (X-06, 10/11/2026) trên điện thoại: tin Pilot mang nhóm 'pilot' (kênh có chuông) + đường trang Pilot (app mở trình duyệt),
 *       push hỏng không làm báo trùng, danh sách GET /notifications xếp cùng nhóm, tin khác giữ nhóm cũ
 *    B. cầu dao đẩy tồn: nhiều mã đang có hàng về 0 ⇒ không đẩy (TikTok 117 mã về 0 vì hàng ở kho HUTI, kho mẹ tắt)
 *    C. Shopee giá SỐNG: quyết theo giá GỐC trên Shopee (bản lưu cũ / là giá KM), né KM đang / sắp chạy, phân loại;
 *       đọc hỏng ⇒ không đổi; thực thi tự động đọc hỏng ⇒ không ghi mù
 *    D. nháp chờ duyệt không ăn trần (10 nháp từng chiếm trọn chỗ); không lập trùng; quá hạn tự huỷ; người huỷ ⇒
 *       14 ngày không đề xuất lại; lượt thực thi kẹt ⇒ 'uncertain'
 *    E. Xem trước → Tự động: nháp xem trước bị huỷ, lập lại và ghi ngay trong ngày (khoá riêng)
 *    F. danh mục cũ > 2 giờ ⇒ tự đồng bộ (trước chỉ khi có người bấm "Đồng bộ")
 *    G. nhiều gian Shopee: lịch chạy mọi gian, kế hoạch mang gian, thực thi đúng gian
 *    H. lịch Tự động báo chủ shop đúng một lần; Xem trước không báo nháp / dòng ghi hỏng, NHƯNG gian hỏng cả lượt ("tất cả
 *       gian") thì báo (X-09); Facebook gãy báo ngay
 *    I. TikTok: nháp không ăn trần, không trùng, người huỷ, cầu dao
 *    J. ĐỐI CHỨNG: ngành chưa đo ⇒ không tự hạ dù ngành đắt nhất đã đo vẫn lãi (ngành chưa đo có thể đắt hơn)
 *    K. chạm trần thao tác ghi / ngày khi đẩy tồn ⇒ bỏ qua, không phải hỏng
 *    L. CHƯA BIẾT PHÍ sàn (09/11/2026, chủ shop: "xem phí phải ghi rõ ra không thể mượn được"): gian chưa đủ đơn đối soát, ô phí
 *       còn 6% mặc định ⇒ chu kỳ Shopee / TikTok không ghi gì, MỘT dòng lý do kèm đường khai phí, lịch báo chủ shop đúng một
 *       lần; khai phí xong thì chạy lại. (D, H, I: "phí chưa đủ tin" giờ là gian ĐÃ khai phí 20% mà chưa đủ đơn để đo.)
 *    M. (09/11/2026) tồn Shopee đọc ĐÚNG: fetchProducts đọc summary_info / seller_stock — trước đọc trường của bản API cũ nên
 *       lưu 0 ở MỌI listing ⇒ bảng đẩy tồn thấy sàn đang 0, cầu dao không bao giờ nhảy
 *    N. cầu dao CHUNG trong lõi đẩy tồn (lib/dayTonLenSan — nút tay, /admin/day-ton-thu, Pilot): đếm trên TOÀN BỘ listing (không
 *       chỉ 300 dòng bảng chạy thử); chạy thật mà nhảy ⇒ 409, 0 lời gọi sàn; chỉ người bấm nút tay vượt được (chapNhanVeKhong
 *       + veKhongDaXem: đồng ý gắn với con số đã xem — thiếu số hoặc số mã về 0 tăng lên ⇒ vẫn 409);
 *       Pilot dùng cauDao của lõi, tồn đổi giữa chạy thử và chạy thật ⇒ 'skipped'
 *       N10–N18 (10/11/2026, SP-06 / TT-08) TỪNG PHÂN LOẠI: lượt 0 chỉ ĐỌC sàn; Shopee has_model ⇒ mỗi model một dòng, đẩy
 *       đúng model_id (trước chỉ phân loại mang SKU listing, phân loại mã kho khác không bao giờ được đẩy); TikTok nhiều SKU
 *       ⇒ mỗi SKU một dòng, đẩy đúng sku_id, tồn TỔNG listing = Σ (trước đè tồn SKU đầu lên tổng); phân loại không ra mã kho
 *       ⇒ bỏ qua có tên, không đẩy 0; phân loại sắp về 0 vào cầu dao; đọc hỏng ⇒ cách cũ + ghi chú; tồn sàn đọc SỐNG;
 *       chu kỳ Pilot đọc sàn MỘT lần (lượt thật dùng lại bản đọc của lượt chạy thử), nút tay đọc lại mỗi lượt
 *    P. nút "Đẩy giá lên sàn" (lib/dayGiaLenSan): mỗi listing soát GIÁ SÀN như Pilot (phí theo ngành, giá vốn, chính sách Pilot
 *       cùng sàn) — dưới sàn / thiếu giá vốn / chưa biết phí ⇒ bỏ qua có lý do, không gọi updatePrice
 *    R. (10/11/2026, X-14) sổ ĐỔI CẤU HÌNH 4 Pilot: ai đổi, đổi gì (cũ → mới), dòng 'config' không ăn trần ghi / ngày
 *    Q. (09/11/2026, SP-07) gian LỚN (709 listing): trước chu kỳ chỉ xét 300 mã `updatedAt` mới nhất ⇒ ~400 mã không bao giờ
 *       được định giá. Giờ: con trỏ xoay vòng theo mã Shopee — 3 chu kỳ phủ đủ 709 mã, không trùng không sót; đồng bộ lại (đổi
 *       hết updatedAt) / chủ shop lưu chính sách không làm con trỏ quay về; chạm trần / đọc hỏng ⇒ con trỏ đứng yên; mã nghi
 *       dưới sàn ở lô khác được xử lý ngay chu kỳ đầu (chỉ khi giá SỐNG dưới sàn thật); câu kết quả nói "x/709 (lô k/3)";
 *       GET /state phân trang + tìm phía máy chủ (tong, offset, mã / tên không dấu / item_id)
 *  Chạy: npm run check:pilot-tu-dong
 * ═══════════════════════════════════════════════════════════════════════════════ */

import { ShopeeService } from '../src/services/platforms/shopee'
import { chayChuKy, chayTheoLich, khoBoNho, khoSql, luuCauHinh, taoKeHoachGia, thucThi, huyKeHoach, cauDaoTon, dayTonChuKy, xayTrangThai, soThuTuMa, type NgCanh, type KhoPilot } from '../src/lib/shopeePilot'
import * as fs from 'fs'
import * as path from 'path'
import { viecCanNguoi, baoChuShop, ketQuaDeBao, GIAN_CACH_BAO_MS, NHAC_LAI_MS, DUONG_PILOT_WEB, duongPilotCuaTieuDe } from '../src/lib/pilotBaoChuShop'
import { phanNhomThongBao, duLieuPush } from '../src/routes/notifications'
import { xoaDemPhiTheoNganh } from '../src/lib/shopeeTuQuan'
import { chayChuKyTikTok, chayTheoLichTikTok, khoBoNhoTikTok, luuCauHinhTikTok, huyKeHoachTikTok } from '../src/lib/tiktokPilot'
import { chayTheoLichFb, khoBoNhoFb, luuCauHinhFb } from '../src/lib/facebookPilot'
import { khoBoNhoAds, luuCauHinhAds } from '../src/lib/facebookAdsPilot'
import { soCauHinh, tomTatDoiCauHinh, NHAN_SHOPEE, NHAN_ADS } from '../src/lib/pilotDoiCauHinh'
import { dayTonLenSan } from '../src/lib/dayTonLenSan'
import { dayGiaLenSan } from '../src/lib/dayGiaLenSan'

let loi = 0, dat = 0
const dung = (ten: string, ok: boolean, chiTiet = '') => { if (ok) dat++; else loi++; console.log(`${ok ? '✓' : '✗'} ${ten}${!ok && chiTiet ? ' — ' + chiTiet.slice(0, 900) : ''}`) }

// ─── Cửa hàng giả: hai gian Shopee + một gian TikTok ────────────────────────────
const tg = (h = 0) => new Date(Date.now() - h * 3600_000)
const kenh: any[] = [
    { id: 'chA', name: 'Gian A', platform: 'shopee', shopId: '1', accessToken: 'tA', apiKey: '1', apiSecret: 's', commissionRate: 6, tokenExpiresAt: new Date(Date.now() + 3600_000), createdAt: new Date(1) },
    { id: 'chB', name: 'Gian B', platform: 'shopee', shopId: '2', accessToken: 'tB', apiKey: '1', apiSecret: 's', commissionRate: 6, tokenExpiresAt: new Date(Date.now() + 3600_000), createdAt: new Date(2) },
    { id: 'chT', name: 'TikTok Shop', platform: 'tiktok', shopId: '9', accessToken: 'tT', apiKey: '1', apiSecret: 's', commissionRate: 6, tokenExpiresAt: new Date(Date.now() + 3600_000), createdAt: new Date(3) },
]
const hang: Record<string, any> = {}
const listing: any[] = []
const themHang = (sku: string, giaVon: number) => { hang[sku] = { id: `p-${sku}`, sku, name: `Hàng ${sku}`, description: 'mô tả', costPrice: giaVon, stock: 10 }; return hang[sku] }
const themListing = (ch: string, item: string, sku: string, gia: number, giaVon: number, them: any = {}) => {
    const h = hang[sku] || themHang(sku, giaVon)
    const l = { id: `l-${ch}-${item}`, channelId: ch, platform: ch === 'chT' ? 'tiktok' : 'shopee', platformProductId: item, name: `Listing ${sku}`, sku, price: gia, stock: 10,
        status: ch === 'chT' ? 'ACTIVATE' : 'NORMAL', localProductId: h.id, imageUrl: null, categoryId: '101', syncedAt: new Date(), updatedAt: new Date(), ...them }
    listing.push(l); return l
}
const donDoiSoat = Array.from({ length: 40 }, (_, i) => { const g = 60000 + i * 10000; return { giaBan: g, phi: 0.14 * g + 3000 } })
let donGian: any[] = donDoiSoat
let donNganh: any[] = donDoiSoat.map(d => ({ ...d, nganh: '101' }))
/** tin = 40 đơn đối soát (phí đo được, đủ tin); không thì 0 đơn và ô «Phí sàn (%)» của mọi gian = `phiKhai` — 20 = gian ĐÃ khai
 *  phí (người duyệt được, máy không tự hạ), 6 = mặc định chưa khai ⇒ CHƯA BIẾT PHÍ (09/11/2026, không còn mượn / tính theo 6%). */
const phiTin = (tin: boolean, phiKhai = 20) => {
    donGian = tin ? donDoiSoat : []; donNganh = tin ? donDoiSoat.map(d => ({ ...d, nganh: '101' })) : []
    for (const c of kenh) c.commissionRate = phiKhai
    xoaDemPhiTheoNganh()
}
const thongBao: any[] = []
let thongBaoHong = false
let fbPages: any[] = []
/** gian đọc hỏng cả lượt (ca H4: "tất cả gian" ở Xem trước, một gian hỏng) — mọi lần đọc listing của gian này ném lỗi */
let gianHong: string | null = null

const prisma: any = {
    onlineChannel: { findMany: async ({ where }: any = {}) => kenh.filter(c => !where?.platform || c.platform === where.platform), update: async () => ({}) },
    onlineProduct: {
        findMany: async ({ where }: any) => {
            if (gianHong && where?.channelId === gianHong) throw new Error('Shopee trả HTTP 403 cho gian này (shop bị khoá API)')
            return listing.filter(l => l.channelId === where.channelId
                && (!where.status || (typeof where.status === 'string' ? l.status === where.status : where.status.in.includes(l.status))))
        },
        findFirst: async ({ where }: any) => {
            const ds = listing.filter(l => l.channelId === where.channelId)
            if (where.syncedAt) return ds.filter(l => l.syncedAt).sort((a, b) => +b.syncedAt - +a.syncedAt)[0] || null
            if (where.platformProductId) return ds.find(l => l.platformProductId === String(where.platformProductId)) || null
            if (where.sku) return ds.find(l => String(l.sku).toLowerCase() === String(where.sku.equals || where.sku).toLowerCase()) || null
            return null
        },
        update: async ({ where, data }: any) => { const l = listing.find(x => x.id === where.id); if (l) Object.assign(l, data); return l },
        upsert: async (q: any) => {
            const w = q.where.channelId_platformProductId
            const cu = listing.find(l => l.channelId === w.channelId && l.platformProductId === w.platformProductId)
            // updatedAt là @updatedAt của Prisma: mỗi lần upsert tự đổi — gốc lỗi SP-07 (chu kỳ chọn theo updatedAt)
            if (cu) { Object.assign(cu, q.update, { updatedAt: new Date() }); return cu }
            listing.push({ ...q.create, id: `l-moi-${listing.length}`, updatedAt: new Date() }); return q.create
        },
        count: async () => listing.length,
    },
    product: { findFirst: async () => null, findMany: async () => [] },
    category: { findMany: async () => [] },
    skuMapping: { findMany: async () => [], findFirst: async () => null },
    storeSettings: { findFirst: async () => null },
    fbPage: { findMany: async () => fbPages, update: async () => ({}) },
    notification: { create: async ({ data }: any) => { if (thongBaoHong) throw new Error('db hỏng'); const t = { id: `tb${thongBao.length + 1}`, ...data }; thongBao.push(t); return t } },
    $executeRawUnsafe: async () => 0,
    $queryRawUnsafe: async (sql: string, ...v: any[]) => {
        if (sql.includes('AS nganh')) return donNganh
        if (sql.includes('"OnlineOrder" o') && sql.includes('platformFee')) return donGian
        if (sql.includes('FROM "Product"')) {
            const ids: string[] = v[0] || [], skus: string[] = v[1] || []
            return Object.values(hang).filter(h => ids.includes(h.id) || skus.includes(h.sku.toLowerCase()))
                .map(h => ({ id: h.id, sku: h.sku, name: h.name, description: h.description, costPrice: h.costPrice, mergedIntoId: null, mergedRate: 1 }))
        }
        return []
    },
}

// ─── Shopee giả ─────────────────────────────────────────────────────────────────
const goi: string[] = []
const songGia: Record<string, any> = {}      // item_id → { goc, ban, phanLoai, trangThai }
const kmSap: Record<string, string> = {}     // item_id → 'ongoing' | 'upcoming'
let docSongHong = false, kmHong = false, soLanDongBo = 0, soLanDocSong = 0
/** mọi item_id đã đọc giá sống — mục Q đếm chu kỳ soát những mã nào */
const docSongIds: string[] = []
const P = ShopeeService.prototype as any
P.refreshAccessToken = async () => { throw new Error('bộ kiểm không cho làm mới token') }
P.getItemBaseInfo = async function (ids: number[]) {
    soLanDocSong++
    docSongIds.push(...ids.map(String))
    if (docSongHong) throw new Error('Shopee get_item_base_info: error_auth - invalid access_token')
    return ids.map(id => {
        const l = listing.find(x => x.platformProductId === String(id) && x.platform === 'shopee')
        if (!l) return null
        const s = songGia[String(id)] || {}
        const phanLoai = s.phanLoai ?? !(Number(l.price) > 0)
        const goc = s.goc ?? l.price
        return { item_id: Number(id), item_status: s.trangThai || 'NORMAL', category_id: Number(l.categoryId) || 0, has_model: phanLoai, ...(phanLoai ? {} : { price_info: [{ original_price: goc, current_price: s.ban ?? goc }] }) }
    }).filter(Boolean)
}
P.getItemPromotion = async (ids: number[]) => {
    if (kmHong) throw new Error('Shopee get_item_promotion: error_permission')
    return ids.filter(id => kmSap[String(id)]).map(id => ({ item_id: id, promotion: [{ promotion_type: 'Discount', promotion_staging: kmSap[String(id)] }] }))
}
P.updatePrice = async function (this: any, id: any, gia: number) {
    goi.push(`gia:${this.credentials?.shopId}:${id}:${gia}`)
    const l = listing.find(x => x.platformProductId === String(id) && x.platform === 'shopee')
    if (l) songGia[String(id)] = { ...(songGia[String(id)] || {}), goc: gia, ban: undefined }
}
/** bản THẬT của fetchProducts — mục M gọi nó với httpGet giả (bản giả ngay dưới chỉ phục vụ chu kỳ Pilot) */
const fetchProductsGoc = P.fetchProducts
P.fetchProducts = async function (this: any) {
    soLanDongBo++
    const ch = kenh.find(c => c.shopId === this.credentials?.shopId)
    return { products: listing.filter(l => l.channelId === ch?.id).map(l => ({ platformProductId: l.platformProductId, name: l.name, sku: l.sku, price: songGia[l.platformProductId]?.ban ?? songGia[l.platformProductId]?.goc ?? l.price, stock: l.stock, status: l.status, categoryId: l.categoryId })) }
}
;(globalThis as any).fetch = async (u: any) => { throw new Error(`bộ kiểm chặn mạng: ${String(u)}`) }

// ─── TikTok giả ─────────────────────────────────────────────────────────────────
const goiTT: string[] = []
let soLanDocTT = 0
const ttGia = async () => ({
    testConnection: async () => ({ success: true }),
    getProductDetail: async (id: string) => { soLanDocTT++; const l = listing.find(x => x.platformProductId === id && x.platform === 'tiktok'); return { skus: l ? [{ id: `sku-${id}`, seller_sku: l.sku, price: { tax_exclusive_price: String(l.price) } }] : [] } },
    updatePrice: async (id: string, gia: number) => { goiTT.push(`gia:${id}:${gia}`); const l = listing.find(x => x.platformProductId === id && x.platform === 'tiktok'); if (l) l.price = gia },
    getOrderSettlement: async () => null,
}) as any

/** đẩy tồn giả: chạy thử trả bảng `bang`, chạy thật ghi lại */
const daySo: any[] = []
let bangTon: any[] = []
const dayTonGia = async (_p: any, channelId: string, o: { dryRun?: boolean }) => {
    daySo.push({ channelId, dryRun: !!o.dryRun })
    return o.dryRun ? { ok: true, data: { seDay: bangTon.filter(x => !x.boQua).length, seBoQua: bangTon.filter(x => x.boQua).length, bang: bangTon } } : { ok: true, data: { pushed: 3, skipped: 1, failed: 0 } }
}

// ─── Đẩy tay (mục N, P — 09/11/2026): cửa hàng giả MỘT gian + sàn giả, gọi THẲNG lõi lib/dayTonLenSan / lib/dayGiaLenSan ───
/** `ghi` = mọi lần ghi CSDL (listing, sổ đồng bộ, kênh) — chạy thử / bị chặn thì phải rỗng. Listing mang sẵn `localProduct`
 *  (như include của lõi); `hang` là bảng Product cho giá vốn; `chinhSach` theo tên bảng Pilot ("ShopeePilotConfig"…). */
function cuaHangDayTay(o: {
    kenh: any; listing: any[]; hang?: any[]; don?: any[]; donNganh?: any[]; chinhSach?: Record<string, any>; docChinhSach?: 'hong' | 'chuaCoBang'
    /** (10/11/2026) bảng Product cho lõi đẩy tồn tra theo SKU / id (prisma.product.findFirst / findUnique) — bỏ trống = không có */
    khoSku?: any[]
    /** bảng SkuMapping { platformSku, productId, conversionRate } */
    anhXa?: any[]
}) {
    const ghi: string[] = []
    const pz: any = {
        onlineChannel: {
            findUnique: async ({ where }: any) => (where.id === o.kenh.id ? o.kenh : null),
            update: async () => { ghi.push('kenh'); return {} },
        },
        onlineProduct: {
            findMany: async ({ where }: any) => o.listing.filter(l => l.channelId === where.channelId && (!where.id?.in || where.id.in.includes(l.id))),
            update: async ({ where, data }: any) => { ghi.push(`sp:${where.id}`); const l = o.listing.find(x => x.id === where.id); if (l) Object.assign(l, data); return l },
        },
        product: {
            findFirst: async ({ where }: any) => (o.khoSku || []).find(h => where?.sku != null && h.sku === where.sku) || null,
            findUnique: async ({ where }: any) => (o.khoSku || []).find(h => h.id === where?.id) || null,
        },
        skuMapping: {
            findFirst: async ({ where }: any) => (o.anhXa || []).find(m => String(m.platformSku).toLowerCase() === String(where?.platformSku?.equals ?? '').toLowerCase()) || null,
        },
        syncLog: { create: async ({ data }: any) => { ghi.push(`so:${data.details}`); return data } },
        $queryRawUnsafe: async (sql: string, ...v: any[]) => {
            const bang = /"(ShopeePilotConfig|TikTokPilotConfig)"/.exec(sql)?.[1]
            if (bang) {
                if (o.docChinhSach === 'hong') throw new Error('Connection terminated unexpectedly')
                if (o.docChinhSach === 'chuaCoBang') throw new Error(`relation "${bang}" does not exist (42P01)`)
                const pol = o.chinhSach?.[bang]
                return pol ? [{ policy: JSON.stringify(pol) }] : []
            }
            if (sql.includes('AS nganh')) return o.donNganh || []
            if (sql.includes('"OnlineOrder" o') && sql.includes('platformFee')) return o.don || []
            if (sql.includes('FROM "Product"')) {
                const ids: string[] = v[0] || [], skus: string[] = v[1] || []
                return (o.hang || []).filter(h => ids.includes(h.id) || skus.includes(String(h.sku).toLowerCase())).map(h => ({ ...h, mergedIntoId: null, mergedRate: 1 }))
            }
            return []
        },
    }
    return { prisma: pz, ghi }
}
/** Sàn giả cho lõi đẩy tay: ghi lại MỌI lời gọi ghi lên sàn (tồn, giá, hỏi phân loại). */
const sanDayTay = () => {
    const goi: string[] = []
    return {
        goi,
        dichVu: {
            credentials: {},
            updateStock: async (id: string, n: number, modelId?: number) => { goi.push(`ton:${id}:${n}${modelId ? `:${modelId}` : ''}`) },
            getModelList: async () => { goi.push('model'); return [] },
            updatePrice: async (id: string, gia: number, _m?: any, sku?: string) => { goi.push(`gia:${id}:${gia}${sku ? `:${sku}` : ''}`) },
            refreshAccessToken: async () => { throw new Error('bộ kiểm không cho làm mới token') },
        },
    }
}

/** Sàn giả CÓ PHÂN LOẠI cho lõi đẩy tồn (10/11/2026, SP-06 / TT-08): `doc` = lời gọi ĐỌC, `goi` = lời gọi GHI (như sanDayTay).
 *  `mat`: mã sàn → hàng. Shopee: coModel ⇒ get_item_base_info báo has_model và đẩy trơn (thiếu model_id) bị từ chối y như thật;
 *  `ton` = tồn đang bán của hàng không phân loại. TikTok: `pl` ≥ 2 ⇒ nhiều SKU; không có `pl` ⇒ một SKU id `<mã>-1`. */
const sanPhanLoai = (o: {
    nen: 'shopee' | 'tiktok'
    mat: Record<string, { coModel?: boolean; ton?: number; pl?: { id: string; sku: string; ten?: string; ton: number }[] }>
    hongDoc?: boolean
    /** get_model_list của các mã này hỏng ở LẦN ĐẦU (lỗi thoáng qua), lần sau đọc được */
    hongModel?: string[]
}) => {
    const goi: string[] = [], doc: string[] = []
    const daHong = new Set<string>()
    return {
        goi, doc,
        dichVu: {
            credentials: {},
            getItemBaseInfo: async (ids: number[]) => {
                doc.push(`base:${ids.length}`)
                if (o.hongDoc) throw new Error('Proxy chuyển tiếp đang mất kết nối (5 lần hỏng liên tiếp)')
                return ids.filter(id => o.mat[String(id)]).map(id => {
                    const m = o.mat[String(id)]!
                    return { item_id: id, has_model: !!m.coModel, stock_info_v2: { summary_info: { total_available_stock: m.ton ?? 0 } } }
                })
            },
            getModelList: async (id: number) => {
                doc.push(`model:${id}`)
                if (o.hongModel?.includes(String(id)) && !daHong.has(String(id))) {
                    daHong.add(String(id))
                    throw new Error('Shopee get_model_list: error_server - system busy')
                }
                return (o.mat[String(id)]?.pl || []).map(p => ({ model_id: Number(p.id), sku: p.sku, name: p.ten || '', stock: p.ton, price: 0, giaHienTai: 0 }))
            },
            timSanPhamTho: async () => {
                doc.push('tim')
                if (o.hongDoc) throw new Error('TikTok products/search: [105005] Access token is expired')
                return Object.entries(o.mat).map(([id, m]) => ({
                    id,
                    skus: (m.pl || [{ id: `${id}-1`, sku: '', ton: m.ton ?? 0 }]).map(p => ({
                        id: p.id, seller_sku: p.sku, sales_attributes: p.ten ? [{ name: 'Màu', value_name: p.ten }] : [], inventory: [{ warehouse_id: 'w1', quantity: p.ton }],
                    })),
                }))
            },
            updateStock: async (id: string, n: number, a?: any, b?: any) => {
                if (o.nen === 'shopee' && o.mat[String(id)]?.coModel && a == null) {
                    throw new Error('Shopee update_stock: error_param - model_id is mandatory if item is under model level')
                }
                goi.push(`ton:${id}:${n}${a != null ? `:${a}` : ''}${b ? `:${b}` : ''}`)
            },
            refreshAccessToken: async () => { throw new Error('bộ kiểm không cho làm mới token') },
        },
    }
}

const nem = async (f: () => Promise<any>) => { try { await f(); return null } catch (e: any) { return e } }
const xoaHet = () => { listing.length = 0; for (const k of Object.keys(hang)) delete hang[k]; for (const k of Object.keys(songGia)) delete songGia[k]; for (const k of Object.keys(kmSap)) delete kmSap[k]; goi.length = 0; goiTT.length = 0; daySo.length = 0; docSongHong = false; kmHong = false }

async function main() {
    // ─── A. Báo chủ shop ─────────────────────────────────────────────────────────
    {
        const r = viecCanNguoi([
            { action: 'price', status: 'succeeded', sku: 'X1', message: 'ok' },
            { action: 'price', status: 'draft', sku: 'X2', message: '100đ → 90đ — CHỜ NGƯỜI DUYỆT: phí chưa đo' },
            { action: 'stock', status: 'skipped', message: 'CẦU DAO — không đẩy tồn: 9/10 mã' },
            { action: 'price', status: 'failed', sku: 'X3', message: 'Shopee lỗi' },
            { action: 'price', status: 'unchanged', message: 'không mã nào cần đổi' },
            { action: 'token', status: 'skipped', message: 'Page token còn 3 ngày' },
            { action: 'publish', status: 'skipped', message: '45 mặt hàng đủ điều kiện nhưng CHƯA CÓ HỒ SƠ ĐĂNG' },
            { action: 'price', status: 'skipped', message: 'Mỗi chu kỳ đổi tối đa 10 mã' },
        ])
        dung('A1. việc cần người: nháp chờ duyệt, cầu dao, hỏng, token, thiếu hồ sơ — bỏ dòng thành công / bình thường', r.dong.length === 5 && !r.dong.some(d => /ok$|không mã nào|tối đa 10/.test(d)), JSON.stringify(r))
        const t0 = Date.now()
        thongBao.length = 0
        const d1 = await baoChuShop(prisma, 'Shopee Pilot', { ok: true, results: [{ action: 'price', status: 'failed', sku: 'X3', message: 'Shopee lỗi' }] }, null, t0)
        dung('A2. lần đầu có việc ⇒ MỘT thông báo kiểu warning, lưu dấu', thongBao.length === 1 && thongBao[0].type === 'warning' && /Shopee Pilot cần anh\/chị xem 1 việc/.test(thongBao[0].title) && d1.khoa && d1.luc === t0, JSON.stringify(thongBao))
        const d2 = await baoChuShop(prisma, 'Shopee Pilot', { ok: true, results: [{ action: 'price', status: 'failed', sku: 'X3', message: 'Shopee lỗi lần 2' }] }, d1, t0 + 60_000)
        dung('A3. y như lượt trước ⇒ im', thongBao.length === 1 && d2.khoa === d1.khoa)
        const viecMoi = { ok: true, results: [{ action: 'price', status: 'failed', sku: 'X4', message: 'khác' }] }
        const d3 = await baoChuShop(prisma, 'Shopee Pilot', viecMoi, d2, t0 + 3600_000)
        dung('A4. việc đổi mà chưa đủ 3 giờ ⇒ im, giữ dấu cũ', thongBao.length === 1 && d3.khoa === d1.khoa)
        const d4 = await baoChuShop(prisma, 'Shopee Pilot', viecMoi, d3, t0 + GIAN_CACH_BAO_MS + 1)
        dung('A5. đủ 3 giờ ⇒ báo việc mới', thongBao.length === 2 && d4.khoa !== d1.khoa)
        const d5 = await baoChuShop(prisma, 'Shopee Pilot', { ok: false, message: 'Gian "A" chưa uỷ quyền API Shopee.' }, d4, t0 + GIAN_CACH_BAO_MS + 60_000)
        dung('A6. chu kỳ GÃY ⇒ báo ngay dù chưa đủ 3 giờ', thongBao.length === 3 && /bị lỗi/.test(thongBao[2].title) && /uỷ quyền/.test(thongBao[2].message))
        await baoChuShop(prisma, 'Shopee Pilot', { ok: false, message: 'Gian "A" chưa uỷ quyền API Shopee.' }, d5, t0 + GIAN_CACH_BAO_MS + 120_000)
        dung('A7. gãy y như lượt trước ⇒ im', thongBao.length === 3)
        const d7 = await baoChuShop(prisma, 'Shopee Pilot', { ok: true, results: [{ action: 'price', status: 'succeeded', message: 'ok' }] }, d5, t0 + 2 * GIAN_CACH_BAO_MS)
        dung('A8. hết việc ⇒ im, dấu rỗng (lần sau có việc lại báo)', thongBao.length === 3 && d7.khoa === '')
        thongBaoHong = true
        const d8 = await baoChuShop(prisma, 'Shopee Pilot', viecMoi, d7, t0 + 3 * GIAN_CACH_BAO_MS)
        thongBaoHong = false
        dung('A9. ghi thông báo hỏng ⇒ giữ dấu cũ để lượt sau thử lại, không ném', d8.khoa === d7.khoa)

        // ── X-09 (09/11/2026): việc y hệt VẪN còn ⇒ nhắc lại sau 24 giờ (trước: im mãi sau tin đầu) ──
        thongBao.length = 0
        const viecCu = { ok: true, results: [{ action: 'price', status: 'failed', sku: 'X9', message: 'Shopee lỗi kéo dài' }] }
        const n0 = t0 + 10 * GIAN_CACH_BAO_MS
        const e1 = await baoChuShop(prisma, 'Shopee Pilot', viecCu, { khoa: '', luc: 0, n: 0 }, n0)
        const e2 = await baoChuShop(prisma, 'Shopee Pilot', viecCu, e1, n0 + NHAC_LAI_MS - 60_000)
        dung('A10. việc y hệt, chưa đủ 24 giờ ⇒ im (không spam chu kỳ 30 phút)', thongBao.length === 1 && e2.luc === n0 && e1.tu === n0, JSON.stringify({ thongBao, e2 }))
        const e3 = await baoChuShop(prisma, 'Shopee Pilot', viecCu, e2, n0 + NHAC_LAI_MS + 1)
        dung('A11. việc y hệt VẪN còn sau 24 giờ ⇒ nhắc lại MỘT tin "vẫn còn…", nói "Chưa xử lý từ" mốc báo đầu; giữ mốc đầu',
            thongBao.length === 2 && /^Shopee Pilot vẫn còn 1 việc cần anh\/chị xem/.test(thongBao[1].title) && /^Chưa xử lý từ \d\d\/\d\d \d\d:\d\d: X9: Shopee lỗi kéo dài/.test(thongBao[1].message)
            && e3.tu === n0 && e3.luc === n0 + NHAC_LAI_MS + 1, JSON.stringify({ tb: thongBao[1], e3 }))
        const e4 = await baoChuShop(prisma, 'Shopee Pilot', viecCu, e3, n0 + NHAC_LAI_MS + 120_000)
        dung('A12. vừa nhắc xong ⇒ im tới 24 giờ sau', thongBao.length === 2 && e4.luc === e3.luc && e4.tu === n0)
        const loiCu = 'Gian "A" chưa uỷ quyền API Shopee.'
        const e5 = await baoChuShop(prisma, 'Shopee Pilot', { ok: false, message: loiCu }, { khoa: `loi:${loiCu}`, luc: n0, n: 1 }, n0 + NHAC_LAI_MS + 5)
        dung('A13. chu kỳ GÃY kéo dài ⇒ sau 24 giờ nhắc "vẫn bị lỗi"; dấu cũ (trước 09/11, không có mốc đầu) lấy lần báo trước làm mốc',
            thongBao.length === 3 && thongBao[2].title === 'Shopee Pilot: chu kỳ tự động vẫn bị lỗi' && /uỷ quyền/.test(thongBao[2].message) && e5.tu === n0, JSON.stringify(thongBao[2]))

        // ── X-09: Xem trước chỉ báo chỗ làm Pilot MÙ ──
        const ds = [
            { action: 'price', status: 'draft', sku: 'D1', message: '100đ → 90đ — CHỜ NGƯỜI DUYỆT' },
            { action: 'price', status: 'failed', sku: 'D2', message: 'đọc giá sống hỏng' },
            { action: 'token', status: 'skipped', message: 'Page token còn 3 ngày' },
            { action: 'token', status: 'failed', message: 'TikTok cần uỷ quyền lại' },
            { action: 'cycle', status: 'failed', channel: 'Gian B', message: '[Gian B] Shopee 403' },
            { action: 'cycle', status: 'skipped', message: 'CHƯA BIẾT PHÍ sàn của gian' },
        ]
        const xt = ketQuaDeBao({ ok: true, results: ds }, true)
        const td = ketQuaDeBao({ ok: true, results: ds }, false)
        const gy = ketQuaDeBao({ ok: false, message: 'gãy', results: ds }, true)
        dung('A14. ketQuaDeBao: Xem trước chỉ giữ token + gian hỏng cả lượt (bỏ nháp, dòng ghi hỏng, CHƯA BIẾT PHÍ); Tự động / chu kỳ gãy giữ nguyên',
            JSON.stringify(xt.results!.map((r: any) => `${r.action}:${r.status}`)) === '["token:skipped","token:failed","cycle:failed"]'
            && td.results!.length === ds.length && gy.results!.length === ds.length && gy.ok === false && ds.length === 6, JSON.stringify(xt.results))
        // đúng TÊN + đúng điều kiện "Xem trước" của từng Pilot (Ads có 3 chế độ: chỉ 'preview' là xem trước — 'approve' chờ duyệt phải báo đủ)
        const canCo: Record<string, string> = {
            shopeePilot: "baoChuShop(prisma, 'Shopee Pilot', ketQuaDeBao(ketQua, ketQua.executionMode !== 'auto')",
            tiktokPilot: "baoChuShop(prisma, 'TikTok Pilot', ketQuaDeBao(ketQua, ketQua.executionMode !== 'auto')",
            facebookPilot: "baoChuShop(prisma, 'Facebook Pilot', ketQuaDeBao(ketQua, ketQua.executionMode !== 'auto')",
            facebookAdsPilot: "baoChuShop(prisma, 'Ads Pilot', ketQuaDeBao(ketQua, ketQua.mode === 'preview')",
        }
        const thieuNoi = Object.keys(canCo).filter(f => {
            const s = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', `${f}.ts`), 'utf8')
            return s.split(canCo[f]!).length !== 2 || /ketQua\.ok && ketQua\.(executionMode|mode)[^\n]*\? truoc :/.test(s)
        })
        dung('A15. cả 4 Pilot (Shopee / TikTok / Facebook / Ads) báo qua ketQuaDeBao — không còn nhánh "Xem trước ⇒ khỏi gọi báo"', !thieuNoi.length, thieuNoi.join(', '))

        // ── X-06 (10/11/2026): trên điện thoại tin Pilot từng IM (rơi nhóm "Hệ thống", kênh Android im lặng) và bấm chỉ mở màn
        //    Thông báo (app không có màn Pilot). Giờ: nhóm riêng 'pilot' (kênh có chuông) + đường trang Pilot để app mở trình duyệt ──
        const day: any[] = []
        const guiGia = async (_p: any, title: string, message: string, extra: any) => { day.push({ title, message, ...extra }); return 1 }
        thongBao.length = 0
        const viecX6 = { ok: true, results: [{ action: 'price', status: 'failed', sku: 'Y1', message: 'Shopee lỗi' }] }
        for (const ten of ['Shopee Pilot', 'TikTok Pilot', 'Facebook Pilot', 'Ads Pilot']) await baoChuShop(prisma, ten, viecX6, null, t0, guiGia)
        dung('A16. push tin Pilot mang nhom "pilot" + web đúng trang từng Pilot (Ads ⇒ tab Quảng cáo); type vẫn warning (chuông web); id = bản ghi vừa tạo',
            JSON.stringify(day.map(d => [d.type, d.nhom, d.web])) === JSON.stringify([['warning', 'pilot', '/pilot-shopee'], ['warning', 'pilot', '/pilot-tiktok'], ['warning', 'pilot', '/pilot-facebook'], ['warning', 'pilot', '/pilot-facebook#ads']])
            && thongBao.length === 4 && day.every((d, i) => d.id === thongBao[i]?.id && d.title === thongBao[i]?.title) && thongBao.every(t => t.type === 'warning') && !day.some(d => 'route' in d),
            JSON.stringify(day))
        thongBao.length = 0
        const nemNgay = ((() => { throw new Error('fcm hỏng') }) as any)
        const f1 = await baoChuShop(prisma, 'Shopee Pilot', viecX6, null, t0, nemNgay)
        const f2 = await baoChuShop(prisma, 'Shopee Pilot', viecX6, f1, t0 + 60_000, nemNgay)
        const nemSau = (async () => { throw new Error('fcm 500') }) as any
        const f3 = await baoChuShop(prisma, 'TikTok Pilot', viecX6, null, t0, nemSau)
        dung('A17. push hỏng (ném ngay hoặc từ chối sau) ⇒ thông báo đã ghi vẫn LƯU DẤU, lượt sau không báo trùng',
            thongBao.length === 2 && !!f1.khoa && f2.khoa === f1.khoa && f2.luc === f1.luc && !!f3.khoa, JSON.stringify({ n: thongBao.length, f1, f2, f3 }))

        // danh sách GET /notifications (app poll 15 phút + màn Thông báo) xếp CÙNG nhóm với push
        const pn = (type: string, title: string) => JSON.stringify(phanNhomThongBao(type, title))
        dung('A18. phanNhomThongBao: tiêu đề tin Pilot (cần xem / vẫn còn / chu kỳ lỗi / KHẨN) ⇒ nhóm pilot + web, route null (app cũ không mở màn lạ)',
            pn('warning', 'Shopee Pilot cần anh/chị xem 2 việc') === JSON.stringify({ nhom: 'pilot', route: null, web: '/pilot-shopee' })
            && pn('warning', 'TikTok Pilot vẫn còn 1 việc cần anh/chị xem') === JSON.stringify({ nhom: 'pilot', route: null, web: '/pilot-tiktok' })
            && pn('warning', 'Ads Pilot: chu kỳ tự động bị lỗi') === JSON.stringify({ nhom: 'pilot', route: null, web: '/pilot-facebook#ads' })
            && pn('warning', 'Facebook Pilot KHẨN: 2 bài hẹn giờ cần xử lý tay trên fanpage') === JSON.stringify({ nhom: 'pilot', route: null, web: '/pilot-facebook' }),
            [pn('warning', 'Shopee Pilot cần anh/chị xem 2 việc'), pn('warning', 'Ads Pilot: chu kỳ tự động bị lỗi')].join(' '))
        dung('A19. tin KHÁC giữ nhóm cũ: warning không phải Pilot (duyệt chi nhánh, Zalo) ⇒ he_thong; tiêu đề Pilot mà type khác ⇒ không nhận; "Shopee Pilots" ⇒ không khớp; loại có sẵn không đổi',
            pn('warning', 'Yêu cầu mở chi nhánh đã được duyệt') === JSON.stringify({ nhom: 'he_thong', route: null })
            && pn('info', 'Shopee Pilot cần anh/chị xem 2 việc') === JSON.stringify({ nhom: 'he_thong', route: null })
            && pn('warning', 'Shopee Pilots mới') === JSON.stringify({ nhom: 'he_thong', route: null })
            && pn('new_order', 'Shopee Pilot') === JSON.stringify({ nhom: 'don_hang', route: 'online-orders' })
            && pn('warning', 'Đã nhận 3 hoá đơn XML từ email') === JSON.stringify({ nhom: 'hoa_don', route: null }),
            pn('warning', 'Shopee Pilots mới'))
        const dl = duLieuPush('T', 'M', { id: 'a', type: 'warning', nhom: 'pilot', web: '/pilot-shopee' })
        const dlCu = duLieuPush('T', 'M', { id: 'b', type: 'new_order', route: 'online-orders' })
        // sendPushToStore không chạy được ở đây (cần FCM) ⇒ soi nguồn: tin gửi đi PHẢI dựng bằng duLieuPush với nguyên `extra`
        const srcTb = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'notifications.ts'), 'utf8')
        dung('A20. dữ liệu FCM mang khoá nhom + web (app ≥ 1.0.47 đọc); tin không có thì không sinh khoá rỗng; sendPushToStore gửi đúng phần này',
            JSON.stringify(dl) === JSON.stringify({ title: 'T', message: 'M', id: 'a', type: 'warning', nhom: 'pilot', web: '/pilot-shopee' })
            && JSON.stringify(dlCu) === JSON.stringify({ title: 'T', message: 'M', id: 'b', type: 'new_order', route: 'online-orders' })
            && srcTb.split('data: duLieuPush(title, body, extra),').length === 2, JSON.stringify({ dl, dlCu }))
        // bảng tên Pilot ⇒ trang PHẢI khớp chuông web (FE useNotifications DUONG_PILOT) và app (Android NotificationWorker.DUONG_PILOT);
        // hai bảng đó nằm ở repo FE, bộ soát check:thongbao bên FE ghim CÙNG danh sách này.
        dung('A21. bảng DUONG_PILOT_WEB ghim đúng 4 Pilot ⇒ 4 trang', JSON.stringify(DUONG_PILOT_WEB) === JSON.stringify([['Shopee Pilot', '/pilot-shopee'], ['TikTok Pilot', '/pilot-tiktok'], ['Facebook Pilot', '/pilot-facebook'], ['Ads Pilot', '/pilot-facebook#ads']])
            && duongPilotCuaTieuDe(null) === undefined && duongPilotCuaTieuDe('Ads Pilot') === '/pilot-facebook#ads')
        // tin KHẨN rút bài hẹn giờ của Facebook Pilot đi đường riêng (không qua baoChuShop) — cũng phải mang nhóm + trang
        const srcFb = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'facebookPilot.ts'), 'utf8')
        dung('A22. tin KHẨN / rút bài hẹn giờ của Facebook Pilot push kèm nhom pilot + trang Facebook Pilot',
            /sendPushToStore\(prisma, title, message, \{ id: tin\?\.id, type: 'warning', nhom: NHOM_PILOT, web: duongPilotCuaTieuDe\('Facebook Pilot'\) \}\)/.test(srcFb))
    }

    // ─── B. Cầu dao đẩy tồn ──────────────────────────────────────────────────────
    {
        const dong = (n: number, veKhong: number) => Array.from({ length: n }, (_, i) => ({ sku: `S${i}`, tonDangTrenSan: 10, seDay: i < veKhong ? 0 : 10, boQua: i >= veKhong }))
        dung('B1. 117/170 mã đang có hàng về 0 ⇒ nhảy cầu dao', !!cauDaoTon(dong(170, 117)) && /117\/170/.test(cauDaoTon(dong(170, 117))!))
        dung('B2. bán hết lẻ tẻ (4/100) ⇒ cho đẩy', cauDaoTon(dong(100, 4)) === null)
        dung('B3. ngưỡng ≥ max(5, 15%): 15/100 nhảy, 14/100 không', !!cauDaoTon(dong(100, 15)) && cauDaoTon(dong(100, 14)) === null)
        dung('B4. gian nhỏ: 5/8 nhảy, 4/8 không (sàn 5 mã)', !!cauDaoTon(dong(8, 5)) && cauDaoTon(dong(8, 4)) === null)
        dung('B5. mã đã 0 trên sàn / bảng rỗng không tính', cauDaoTon([{ sku: 'Z', tonDangTrenSan: 0, seDay: 0 }]) === null && cauDaoTon(undefined as any) === null)
    }

    // ─── K. Chạm trần thao tác ghi / ngày khi đẩy tồn ⇒ 'skipped', không phải hỏng (khỏi báo chủ shop như lỗi) ──
    {
        const r = await dayTonChuKy({ tuDong: true, san: 'Shopee', gian: 'A', day: async (o: any) => o.dryRun ? { ok: true, data: { bang: [] } } : { ok: true, data: { pushed: 1 } },
            conLuot: async () => { throw new Error('Đã đạt giới hạn 50 thao tác ghi hôm nay theo chính sách — để mai hoặc nâng giới hạn.') }, ghi: async () => { } })
        dung('K1. chạm trần ghi khi đẩy tồn ⇒ bỏ qua (không phải hỏng), nói rõ trần', r.status === 'skipped' && /giới hạn 50/.test(r.message) && !viecCanNguoi([r]).dong.length, JSON.stringify(r))
    }

    const kho = khoBoNho()
    const ctx: NgCanh = { prisma, kho, nguoi: 'chu@shop', dayTon: dayTonGia }
    const tatHet = { automation: { reprice: true, syncStock: false, publishNewProducts: false, campaign: { enabled: false } }, maxWritesPerDay: 500 }

    // ─── C. Shopee giá SỐNG ─────────────────────────────────────────────────────
    {
        xoaHet(); phiTin(true)
        themListing('chA', '1001', 'A1', 100000, 100000)    // bản lưu: 100k (dưới sàn 127,2k) — Shopee thật đang để 140k
        songGia['1001'] = { goc: 140000 }
        await luuCauHinh(ctx, { channelId: 'chA', executionMode: 'auto', policy: tatHet })
        const ck = await chayChuKy(ctx)
        const d = ck.results.find((r: any) => r.action === 'price' && r.sku === 'A1')
        const kh = kho._keHoach.find(k => k.data?.itemId === '1001')
        dung('C1. quyết theo giá GỐC trên Shopee (140k, lãi dưới mục tiêu ⇒ 146k), không theo bản lưu 100k', goi.includes('gia:1:1001:146000') && kh?.data?.snapshot?.price === 140000 && kh?.data?.snapshot?.source === 'shopee' && /^140\.000đ → 146\.000đ/.test(d?.message || ''), JSON.stringify({ goi, d, snap: kh?.data?.snapshot }))
        dung('C1b. kế hoạch mang gian (channelId / channelName)', kh?.data?.channelId === 'chA' && kh?.data?.channelName === 'Gian A')

        xoaHet(); phiTin(true)
        themListing('chA', '1101', 'K1', 100000, 100000); songGia['1101'] = { goc: 120000, ban: 100000 }   // đang giảm giá
        themListing('chA', '1102', 'K2', 100000, 100000); kmSap['1102'] = 'upcoming'                        // sắp chạy chương trình
        themListing('chA', '1103', 'K3', 100000, 100000); songGia['1103'] = { phanLoai: true }              // giờ đã có phân loại
        themListing('chA', '1104', 'K4', 100000, 100000); songGia['1104'] = { trangThai: 'UNLIST' }         // đã ẩn trên Shopee
        themListing('chA', '1105', 'K5', 100000, 100000)                                                    // đối chứng: phải đổi
        const ck2 = await chayChuKy(ctx)
        const boQua = ck2.results.find((r: any) => r.action === 'price' && /Bỏ qua/.test(r.message || ''))?.message || ''
        dung('C2. KM đang chạy / sắp chạy, phân loại, không còn bán ⇒ KHÔNG đổi; mã thường vẫn đổi', goi.length === 1 && goi[0]!.startsWith('gia:1:1105:') && /2 đang \/ sắp chạy khuyến mãi/.test(boQua) && /1 có phân loại/.test(boQua) && /1 không còn bán/.test(boQua), JSON.stringify({ goi, kq: ck2.results }))

        xoaHet(); phiTin(true)
        themListing('chA', '1201', 'R1', 100000, 100000)
        docSongHong = true
        const ck3 = await chayChuKy(ctx)
        dung('C3. đọc giá sống hỏng ⇒ chu kỳ không đổi giá, báo lỗi (thành việc cần người)', goi.length === 0 && ck3.results.some((r: any) => r.status === 'failed' && /Không đọc được giá đang để trên Shopee/.test(r.message)) && !kho._keHoach.some(k => k.data?.itemId === '1201'), JSON.stringify(ck3.results))
        docSongHong = false
        const khTay = await taoKeHoachGia(ctx, { sku: 'R1', price: 127200, idempotencyKey: 'tay-r1' })
        docSongHong = true
        const mayLam = await thucThi(ctx, khTay.id, { tuDong: true })
        dung('C4. máy thực thi mà đọc giá sống hỏng ⇒ KHÔNG ghi mù', mayLam.status === 'failed' && /không đổi giá khi không thấy giá hiện tại/.test(mayLam.result?.message || '') && goi.length === 0, JSON.stringify(mayLam.result))
        docSongHong = false
        const khMat = await taoKeHoachGia(ctx, { sku: 'R1', price: 127200, idempotencyKey: 'tay-r1-mat' })
        const lMat = listing.find(x => x.platformProductId === '1201')!
        lMat.platform = 'xoa'      // Shopee không còn trả sản phẩm này (đã xoá / bị khoá)
        const mayMat = await thucThi(ctx, khMat.id, { tuDong: true })
        lMat.platform = 'shopee'
        dung('C4b. máy thực thi mà Shopee không trả sản phẩm ⇒ KHÔNG ghi', mayMat.status === 'failed' && /Shopee không trả thông tin/.test(mayMat.result?.message || '') && goi.length === 0, JSON.stringify(mayMat.result))
        docSongHong = true
        const khTay2 = await taoKeHoachGia(ctx, { sku: 'R1', price: 127200, idempotencyKey: 'tay-r1b' })
        const nguoiLam = await thucThi(ctx, khTay2.id)
        docSongHong = false
        dung('C5. người bấm thực thi khi đọc giá sống hỏng ⇒ vẫn làm theo bản lưu (người chịu trách nhiệm)', nguoiLam.status === 'succeeded' && goi.includes('gia:1:1201:127200'), JSON.stringify(nguoiLam.result))
        songGia['1201'] = { goc: 127200, ban: 110000 }
        const khKm = await nem(() => taoKeHoachGia(ctx, { sku: 'R1', price: 130000, idempotencyKey: 'tay-km' }))
        dung('C6. lập kế hoạch tay khi mã đang KM ⇒ chặn, nói rõ giá gốc / giá đang bán', /đang chạy khuyến mãi/.test(khKm?.message || '') && /127\.200đ/.test(khKm?.message || ''), khKm?.message)
        kmHong = true; delete songGia['1201']
        themListing('chA', '1202', 'R2', 100000, 100000)
        const ck4 = await chayChuKy(ctx)
        kmHong = false
        dung('C7. không đọc được lịch khuyến mãi ⇒ vẫn đổi, kèm lời nhắc (Shopee có thể không cấp quyền marketing)', goi.some(g => g.startsWith('gia:1:1202:')) && ck4.results.some((r: any) => /Chưa kiểm được chương trình sắp chạy/.test(r.message || '')), JSON.stringify(ck4.results))
    }

    // ─── D. Nháp chờ duyệt ──────────────────────────────────────────────────────
    {
        xoaHet(); phiTin(false)      // phí KHAI 20%, CHƯA ĐO ⇒ máy không tự hạ giá (TĂNG vẫn tự làm)
        kho._keHoach.length = 0
        for (let i = 1; i <= 12; i++) themListing('chA', String(2000 + i), `E${i}`, 160000, 50000)   // ế + lãi cao ⇒ HẠ (chờ duyệt)
        themListing('chA', '2000', 'LO', 100000, 100000)      // dưới sàn ⇒ TĂNG (tự làm) — xếp CUỐI danh sách, vẫn phải được xét trước
        const ck = await chayChuKy(ctx)
        const nhap = ck.results.filter((r: any) => r.action === 'price' && r.status === 'draft' && /CHỜ NGƯỜI DUYỆT/.test(r.message))
        dung('D1. 12 nháp hạ giá chờ duyệt KHÔNG ăn trần 10: cả 12 lập + mã dưới sàn vẫn được TĂNG ngay', nhap.length === 12 && goi.some(g => g.startsWith('gia:1:2000:')), JSON.stringify({ n: nhap.length, goi }))
        dung('D1b. mã dưới giá sàn được xét TRƯỚC (đang lỗ)', ck.results.findIndex((r: any) => r.sku === 'LO') < ck.results.findIndex((r: any) => r.sku === 'E1'))
        const truoc = kho._keHoach.length
        const ck2 = await chayChuKy(ctx)
        dung('D2. lượt sau: không lập nháp trùng, báo "12 đang chờ duyệt"', kho._keHoach.length === truoc && ck2.results.some((r: any) => /12 đang chờ duyệt/.test(r.message || '')) && ck2.results.some((r: any) => /1 vừa đổi giá trong 24 giờ/.test(r.message || '')), JSON.stringify(ck2.results))
        const mot = kho._keHoach.find(k => k.data?.itemId === '2001')!
        await huyKeHoach(ctx, mot.id)
        dung('D3. người huỷ nháp', (await kho.layKeHoach(mot.id))!.status === 'cancelled')
        for (const k of kho._keHoach) if (k.status === 'draft') k.createdAt = Date.now() - 4 * 86400_000
        const ck3 = await chayChuKy(ctx)
        dung('D4. nháp máy lập quá 3 ngày ⇒ tự huỷ (đánh dấu máy huỷ)', kho._keHoach.filter(k => k.data?.itemId !== '2001' && k.data?.itemId !== '2000' && k.status === 'cancelled' && k.result?.tuHuy).length === 11 && ck3.results.some((r: any) => /Huỷ 11 nháp/.test(r.message || '')), JSON.stringify(ck3.results))
        // ngày mới: mã máy tự huỷ được lập lại, mã NGƯỜI huỷ thì không
        for (const k of kho._keHoach) { k.idempotencyKey = `${k.idempotencyKey}:hom-qua`; k.updatedAt = Date.now() - 86400_000 }
        const ck4 = await chayChuKy(ctx)
        const lapLai = ck4.results.filter((r: any) => r.action === 'price' && r.status === 'draft').map((r: any) => r.sku)
        dung('D5. mã NGƯỜI huỷ không bị đề xuất lại (14 ngày); mã máy tự huỷ được lập lại', lapLai.length === 11 && !lapLai.includes('E1'), JSON.stringify(lapLai))
        const ket = kho._keHoach.find(k => k.status === 'draft')!
        ket.status = 'running'; ket.updatedAt = Date.now() - 2 * 3600_000
        const ck5 = await chayChuKy(ctx)
        dung('D6. lượt thực thi kẹt > 1 giờ ⇒ "không rõ", báo người kiểm Seller Center', (await kho.layKeHoach(ket.id))!.status === 'uncertain' && ck5.results.some((r: any) => r.status === 'uncertain' && /Seller Center/.test(r.message)), JSON.stringify(ck5.results.filter((r: any) => r.status === 'uncertain')))
        // khoảng nghỉ 24 giờ KHÔNG chặn mã đang dưới giá sàn (lỗ): giá vốn LO vừa tăng ⇒ nâng ngay dù vừa đổi
        hang.LO.costPrice = 130000
        goi.length = 0
        await chayChuKy(ctx)
        dung('D7. vừa đổi giá trong 24 giờ nhưng giờ DƯỚI giá sàn (giá vốn tăng) ⇒ vẫn nâng ngay', goi.some(g => g.startsWith('gia:1:2000:')), JSON.stringify(goi))
        phiTin(true)
    }

    // ─── J. ĐỐI CHỨNG: ngành CHƯA đo ⇒ máy KHÔNG tự hạ, kể cả khi hạ vẫn lãi với ngành đắt nhất ĐÃ đo ─────────────
    // (thử nới 03/11/2026 rồi gỡ: ngành chưa đo có thể phí cao hơn mọi ngành đã đo — biểu phí cố định theo nhóm ngành)
    {
        xoaHet(); kho._keHoach.length = 0; phiTin(true)
        // gian đo được hai ngành: 101 (14% + 3.000đ) và 303 (30%)
        donNganh = [...donDoiSoat.map(d => ({ ...d, nganh: '101' })), ...Array.from({ length: 40 }, (_, i) => { const g = 60000 + i * 10000; return { giaBan: g, phi: 0.3 * g, nganh: '303' } })]
        xoaDemPhiTheoNganh()
        themListing('chA', '8001', 'N1', 160000, 50000, { categoryId: '909' })    // ế, lãi cao, ngành 909 chưa đủ đơn — hạ về 144k vẫn lãi ~30% với ngành 303
        const ck = await chayChuKy(ctx)
        const n1 = ck.results.find((r: any) => r.sku === 'N1')
        dung('J1. Shopee: ngành chưa đo ⇒ hạ giá là NHÁP chờ duyệt, không ghi — dù ngành đắt nhất đã đo vẫn lãi', !goi.some(g => g.startsWith('gia:1:8001:')) && n1?.status === 'draft' && /CHỜ NGƯỜI DUYỆT/.test(n1?.message || ''), JSON.stringify({ goi, n1 }))
        const khoT = khoBoNhoTikTok()
        const ctxT: any = { prisma, kho: khoT, nguoi: 'chu@shop', taoTikTok: ttGia, dayTon: dayTonGia }
        themListing('chT', '8101', 'TN1', 160000, 50000, { categoryId: '909' })
        await luuCauHinhTikTok(ctxT, { channelId: 'chT', executionMode: 'auto', policy: { maxWritesPerDay: 500, automation: { reprice: true, syncStock: false } } })
        const ckT = await chayChuKyTikTok(ctxT)
        dung('J2. TikTok: ngành chưa đo ⇒ hạ giá là NHÁP chờ duyệt, không ghi', !goiTT.some(g => g.startsWith('gia:8101:')) && ckT.results.some((r: any) => r.sku === 'TN1' && r.status === 'draft' && /CHỜ NGƯỜI DUYỆT/.test(r.message || '')), JSON.stringify({ goiTT, r: ckT.results }))
        phiTin(true)
    }

    // ─── E. Xem trước → Tự động ────────────────────────────────────────────────
    {
        xoaHet(); kho._keHoach.length = 0
        themListing('chA', '3001', 'V1', 100000, 100000)
        await luuCauHinh(ctx, { executionMode: 'preview' })
        const ck = await chayChuKy(ctx)
        dung('E1. Xem trước: lập nháp, không gọi Shopee', goi.length === 0 && ck.results.some((r: any) => r.sku === 'V1' && r.status === 'draft'))
        await luuCauHinh(ctx, { executionMode: 'auto' })
        const ck2 = await chayChuKy(ctx)
        dung('E2. sang Tự động: nháp xem trước bị huỷ, lập lại và ghi NGAY trong ngày (khoá riêng)', goi.some(g => g.startsWith('gia:1:3001:')) && kho._keHoach.some(k => k.data?.itemId === '3001' && k.status === 'cancelled' && k.result?.tuHuy), JSON.stringify({ goi, r: ck2.results }))
    }

    // ─── F. Danh mục tự làm mới ────────────────────────────────────────────────
    {
        xoaHet(); kho._keHoach.length = 0
        const l = themListing('chA', '4001', 'F1', 146000, 100000, { syncedAt: tg(3) })
        songGia['4001'] = { goc: 150000 }
        const n0 = soLanDongBo
        const ck = await chayChuKy(ctx)
        dung('F1. danh mục cũ hơn 2 giờ ⇒ tự đồng bộ (như bấm "Đồng bộ"), bản lưu cập nhật', soLanDongBo === n0 + 1 && l.price === 150000 && ck.results.some((r: any) => r.action === 'catalog' && r.status === 'succeeded'), JSON.stringify(ck.results))
        await chayChuKy(ctx)
        dung('F2. vừa đồng bộ ⇒ lượt sau không đồng bộ lại', soLanDongBo === n0 + 1)
        const cu = P.fetchProducts
        P.fetchProducts = async () => { throw new Error('Shopee get_item_list: error_auth') }
        l.syncedAt = tg(5)
        const ck2 = await chayChuKy(ctx)
        P.fetchProducts = cu
        dung('F3. đồng bộ hỏng ⇒ báo, chu kỳ vẫn chạy (giá sống vẫn che)', ck2.results.some((r: any) => r.action === 'catalog' && r.status === 'failed') && ck2.results.some((r: any) => r.action === 'price'), JSON.stringify(ck2.results))
    }

    // ─── B'. Cầu dao trong chu kỳ Shopee ────────────────────────────────────────
    {
        xoaHet(); kho._keHoach.length = 0
        await luuCauHinh(ctx, { policy: { automation: { syncStock: true, reprice: false } } })
        bangTon = Array.from({ length: 20 }, (_, i) => ({ sku: `T${i}`, tonDangTrenSan: 8, seDay: i < 12 ? 0 : 8, boQua: i >= 12 }))
        const ck = await chayChuKy(ctx)
        const ton = ck.results.find((r: any) => r.action === 'stock')
        dung("B6. chu kỳ: 12/20 mã về 0 ⇒ CẦU DAO, chỉ chạy thử, không đẩy thật", daySo.length === 1 && daySo[0].dryRun && ton?.status === 'skipped' && /CẦU DAO/.test(ton.message) && /CHỜ NGƯỜI DUYỆT/.test(ton.message), JSON.stringify({ daySo, ton }))
        bangTon = [{ sku: 'T1', tonDangTrenSan: 8, seDay: 0 }, { sku: 'T2', tonDangTrenSan: 3, seDay: 9 }, ...Array.from({ length: 18 }, (_, i) => ({ sku: `U${i}`, tonDangTrenSan: 5, seDay: 5, boQua: true }))]
        daySo.length = 0
        const ck2 = await chayChuKy(ctx)
        dung('B7. đẩy bình thường (1 mã bán hết) ⇒ chạy thử rồi đẩy thật', daySo.length === 2 && daySo[0].dryRun && !daySo[1].dryRun && ck2.results.some((r: any) => r.action === 'stock' && r.status === 'succeeded'), JSON.stringify(daySo))
        await luuCauHinh(ctx, { policy: { automation: { syncStock: false, reprice: true } } })
    }

    // ─── G + H. Nhiều gian + lịch báo chủ shop ─────────────────────────────────
    {
        xoaHet(); kho._keHoach.length = 0; thongBao.length = 0
        themListing('chA', '5001', 'G1', 100000, 100000)
        themListing('chB', '6001', 'G1', 100000, 100000)    // CÙNG SKU ở gian B
        const c = await luuCauHinh(ctx, { channelId: 'chA', executionMode: 'auto', schedule: { enabled: true, intervalMinutes: 60 } })
        await kho.luuCauHinh({ ...c, nextRunAt: Date.now() - 1000 })
        await chayTheoLich(prisma, kho)
        dung('G1. lịch mặc định: chỉ gian đang chọn', goi.length === 1 && goi[0]!.startsWith('gia:1:5001:'), JSON.stringify(goi))
        goi.length = 0
        const c2 = await luuCauHinh(ctx, { schedule: { allChannels: true } })
        dung('G2. bật "tất cả gian" giữ trong lịch', c2.schedule.allChannels === true && c2.schedule.enabled === true)
        await kho.luuCauHinh({ ...c2, nextRunAt: Date.now() - 1000 })
        await chayTheoLich(prisma, kho)
        const kq = (await kho.docCauHinh())!.lastResult
        dung('G3. "tất cả gian": chu kỳ chạy CẢ gian B, kết quả ghi tên gian, cùng SKU không đụng khoá', goi.some(g => g.startsWith('gia:2:6001:')) && kq?.results?.some((r: any) => r.channel === 'Gian B' && /^\[Gian B\]/.test(r.message)), JSON.stringify({ goi, kq }))
        // kế hoạch của gian B, thực thi khi gian đang chọn là A ⇒ vẫn ghi lên gian B
        const khB = await taoKeHoachGia({ ...ctx, kenhId: 'chB' }, { itemId: '6001', price: Number(songGia['6001']?.goc || 100000) + 3000, idempotencyKey: 'tay-b' })
        goi.length = 0
        const xongB = await thucThi(ctx, khB.id)
        dung('G4. thực thi kế hoạch theo ĐÚNG gian của nó (không theo gian đang chọn)', xongB.status === 'succeeded' && goi.length === 1 && goi[0]!.startsWith('gia:2:6001:'), JSON.stringify({ goi, r: xongB.result }))

        // H. lịch Tự động: có việc cần người ⇒ báo MỘT lần
        xoaHet(); phiTin(false); thongBao.length = 0
        for (let i = 1; i <= 3; i++) themListing('chA', String(7000 + i), `H${i}`, 160000, 50000)
        const c3 = await luuCauHinh(ctx, { schedule: { allChannels: false } })
        await kho.luuCauHinh({ ...c3, nextRunAt: Date.now() - 1000 })
        await chayTheoLich(prisma, kho)
        const sau1 = thongBao.length
        const c4 = (await kho.docCauHinh())!
        const n1 = c4.lastResult?.baoChuShop?.n
        await kho.luuCauHinh({ ...c4, nextRunAt: Date.now() - 1000 })
        await chayTheoLich(prisma, kho)
        dung('H1. lịch Tự động có nháp chờ duyệt ⇒ báo chủ shop đúng MỘT lần (lượt sau y như cũ thì im)', sau1 === 1 && thongBao.length === 1 && /cần anh\/chị xem 3 việc/.test(thongBao[0].title) && n1 === 3, JSON.stringify(thongBao))
        await luuCauHinh(ctx, { executionMode: 'preview' })
        const c5 = (await kho.docCauHinh())!
        await kho.luuCauHinh({ ...c5, nextRunAt: Date.now() - 1000 })
        for (let i = 4; i <= 5; i++) themListing('chA', String(7000 + i), `H${i}`, 160000, 50000)
        // lần báo trước đã quá 3 giờ — nếu Xem trước mà gọi báo thì chắc chắn ra thông báo
        await kho.ghiKetQuaLich(Date.now(), { ...c5.lastResult, baoChuShop: { ...c5.lastResult.baoChuShop, luc: Date.now() - 4 * 3600_000 } })
        docSongHong = true      // lượt Xem trước có dòng hỏng — vẫn KHÔNG báo (chưa ghi gì; chỉ chu kỳ gãy mới báo)
        await chayTheoLich(prisma, kho)
        docSongHong = false
        dung('H2. Xem trước: không báo dù có dòng hỏng (chưa ghi gì lên sàn)', thongBao.length === 1 && (await kho.docCauHinh())!.lastResult?.results?.some((r: any) => r.status === 'failed'))
        kenh[0]!.accessToken = ''
        const c6 = (await kho.docCauHinh())!
        await kho.luuCauHinh({ ...c6, nextRunAt: Date.now() - 1000 })
        const loiLich = await chayTheoLich(prisma, kho)
        kenh[0]!.accessToken = 'tA'
        dung('H3. chu kỳ gãy (gian mất uỷ quyền) ⇒ báo ngay, kể cả Xem trước', loiLich === 'loi' && thongBao.length === 2 && /bị lỗi/.test(thongBao[1].title), JSON.stringify(thongBao))

        // H3b (X-09, 09/11/2026): Xem trước + "tất cả gian" — MỘT gian hỏng cả lượt ⇒ VẪN báo (trước: lượt vẫn ok ⇒ im tới khi
        // chủ shop tự mở trang). Lần báo trước (H3) dời về 4 giờ trước để khỏi vướng giãn 3 giờ.
        {
            await luuCauHinh(ctx, { executionMode: 'preview', schedule: { enabled: true, allChannels: true } })
            const lr = (await kho.docCauHinh())!.lastResult || {}
            await kho.ghiKetQuaLich(Date.now(), { ...lr, baoChuShop: { ...(lr.baoChuShop || { khoa: '', n: 0 }), luc: Date.now() - 4 * 3600_000 } })
            await kho.luuCauHinh({ ...(await kho.docCauHinh())!, nextRunAt: Date.now() - 1000 })
            const tb0 = thongBao.length
            gianHong = 'chB'
            const kqH4 = await chayTheoLich(prisma, kho)
            gianHong = null
            const lr4 = (await kho.docCauHinh())!.lastResult
            const tin = thongBao.slice(tb0)
            dung('H3b. Xem trước + "tất cả gian": gian B hỏng cả lượt ⇒ VẪN báo MỘT tin nêu gian B (lượt vẫn chạy gian A)',
                kqH4 === 'da-chay' && tin.length === 1 && /^Shopee Pilot cần anh\/chị xem 1 việc/.test(tin[0].title) && /Gian B/.test(tin[0].message)
                && lr4?.results?.some((r: any) => r.action === 'cycle' && r.status === 'failed' && r.channel === 'Gian B'),
                JSON.stringify({ kqH4, tin, r: lr4?.results?.map((r: any) => [r.action, r.status, r.channel]) }))
            await luuCauHinh(ctx, { schedule: { allChannels: false } })
        }
        phiTin(true)
    }

    // ─── I. TikTok ───────────────────────────────────────────────────────────────
    {
        xoaHet(); phiTin(false); thongBao.length = 0
        const khoT = khoBoNhoTikTok()
        const ctxT: any = { prisma, kho: khoT, nguoi: 'chu@shop', taoTikTok: ttGia, dayTon: dayTonGia }
        for (let i = 1; i <= 12; i++) themListing('chT', String(9000 + i), `TE${i}`, 160000, 50000)
        themListing('chT', '9000', 'TLO', 100000, 100000)      // dưới sàn, xếp cuối — vẫn xét trước
        await luuCauHinhTikTok(ctxT, { channelId: 'chT', executionMode: 'auto', policy: { maxWritesPerDay: 500, automation: { reprice: true, syncStock: false } } })
        const ck = await chayChuKyTikTok(ctxT)
        const nhap = ck.results.filter((r: any) => r.status === 'draft' && /CHỜ NGƯỜI DUYỆT/.test(r.message))
        dung('I1. TikTok: 12 nháp hạ giá không ăn trần 10, mã dưới sàn vẫn TĂNG ngay', nhap.length === 12 && goiTT.some(g => g.startsWith('gia:9000:')) && ck.results.findIndex((r: any) => r.sku === 'TLO') < ck.results.findIndex((r: any) => r.sku === 'TE1'), JSON.stringify({ n: nhap.length, goiTT }))
        const truoc = khoT._keHoach.length
        const ck2 = await chayChuKyTikTok(ctxT)
        dung('I2. TikTok lượt sau: không lập nháp trùng', khoT._keHoach.length === truoc && ck2.results.some((r: any) => /12 sản phẩm đang có nháp chờ duyệt/.test(r.message || '')), JSON.stringify(ck2.results))
        const mot = khoT._keHoach.find(k => k.data?.itemId === '9001' && k.status === 'draft')!
        await huyKeHoachTikTok(ctxT, mot.id)
        for (const k of khoT._keHoach) if (k.status === 'draft') k.createdAt = Date.now() - 4 * 86400_000
        await chayChuKyTikTok(ctxT)
        for (const k of khoT._keHoach) { k.idempotencyKey = `${k.idempotencyKey}:hom-qua`; k.updatedAt = Math.min(k.updatedAt, Date.now() - 86400_000) }
        const ck3 = await chayChuKyTikTok(ctxT)
        const lapLai = ck3.results.filter((r: any) => r.status === 'draft').map((r: any) => r.sku)
        dung('I3. TikTok: nháp quá hạn tự huỷ rồi lập lại; mã NGƯỜI huỷ không đề xuất lại', lapLai.length === 11 && !lapLai.includes('TE1'), JSON.stringify(lapLai))
        await luuCauHinhTikTok(ctxT, { policy: { automation: { reprice: false, syncStock: true } } })
        bangTon = Array.from({ length: 10 }, (_, i) => ({ sku: `T${i}`, tonDangTrenSan: 4, seDay: i < 6 ? 0 : 4, boQua: i >= 6 }))
        daySo.length = 0
        const ck4 = await chayChuKyTikTok(ctxT)
        dung('I4. TikTok: cầu dao đẩy tồn (6/10 về 0) ⇒ không đẩy thật', daySo.length === 1 && daySo[0].dryRun && ck4.results.some((r: any) => r.action === 'stock' && /CẦU DAO/.test(r.message)), JSON.stringify({ daySo, r: ck4.results }))
        await luuCauHinhTikTok(ctxT, { schedule: { enabled: true, intervalMinutes: 60 } })
        const cT = (await khoT.docCauHinh())!
        await khoT.luuCauHinh({ ...cT, nextRunAt: Date.now() - 1000 })
        await chayTheoLichTikTok(prisma, khoT, { taoTikTok: ttGia, dayTon: dayTonGia })
        dung('I5. TikTok theo lịch: cầu dao nhảy ⇒ báo chủ shop', thongBao.length === 1 && /TikTok Pilot cần anh\/chị xem/.test(thongBao[0].title) && /CẦU DAO/.test(thongBao[0].message), JSON.stringify(thongBao))
        phiTin(true)
    }

    // ─── L. CHƯA BIẾT PHÍ sàn (09/11/2026, chủ shop: "xem phí phải ghi rõ ra không thể mượn được") ─────────────
    // Gian chưa có đơn đối soát, ô «Phí sàn (%)» còn 6% mặc định. Trước: tính giá theo 6% (phí thật 20–30%) — máy "nâng lên sàn"
    // mà vẫn lỗ, lập nháp hạ giá theo số bịa. Giờ: chu kỳ không ghi / không lập gì, MỘT dòng lý do kèm đường khai phí; lịch Tự
    // động báo chủ shop đúng MỘT lần (lượt sau y như cũ thì im) — không mỗi mã một việc trên chuông.
    {
        xoaHet(); phiTin(false, 6); thongBao.length = 0; kho._keHoach.length = 0
        themListing('chA', '9501', 'CB1', 100000, 100000)      // dưới mọi giá sàn thật — trước đây máy TĂNG theo 6%
        themListing('chA', '9502', 'CB2', 160000, 50000)       // ế + lãi cao — trước đây lập nháp HẠ theo 6%
        const c = await luuCauHinh(ctx, { channelId: 'chA', executionMode: 'auto', schedule: { enabled: true, intervalMinutes: 60, allChannels: false },
            policy: { automation: { reprice: true, syncStock: false, publishNewProducts: true } } })
        await kho.luuCauHinh({ ...c, nextRunAt: Date.now() - 1000 })
        await kho.ghiKetQuaLich(Date.now() - 5 * 3600_000, { ...((await kho.docCauHinh())!.lastResult || {}), baoChuShop: undefined })   // lần báo trước (H) không chặn
        const s0 = soLanDocSong
        await chayTheoLich(prisma, kho)
        const kq1 = (await kho.docCauHinh())!.lastResult
        const dong1 = (kq1?.results || []).filter((r: any) => /CHƯA BIẾT PHÍ/.test(r.message || ''))
        dung('L1. Shopee chưa biết phí: chu kỳ Tự động KHÔNG ghi giá, không đọc giá Shopee, không lập kế hoạch; MỘT dòng "CHƯA BIẾT PHÍ" (đổi giá / đăng mới) kèm đường khai',
            goi.length === 0 && soLanDocSong === s0 && kho._keHoach.length === 0 && dong1.length === 1 && dong1[0].action === 'cycle' && dong1[0].status === 'skipped'
            && /"Gian A"/.test(dong1[0].message) && /0\/8 đơn/.test(dong1[0].message) && /chưa đổi giá \/ đăng mới mã nào/.test(dong1[0].message) && /«Phí sàn \(%\)»/.test(dong1[0].message),
            JSON.stringify(kq1))
        const sau1 = thongBao.length
        const c2 = (await kho.docCauHinh())!
        await kho.luuCauHinh({ ...c2, nextRunAt: Date.now() - 1000 })
        await chayTheoLich(prisma, kho)
        dung('L2. lịch Tự động báo chủ shop ĐÚNG MỘT lần (một việc, giữ đường khai «Phí sàn (%)»); lượt sau y như cũ thì im',
            sau1 === 1 && thongBao.length === 1 && /Shopee Pilot cần anh\/chị xem 1 việc/.test(thongBao[0].title) && /CHƯA BIẾT PHÍ/.test(thongBao[0].message)
            && /«Phí sàn \(%\)»/.test(thongBao[0].message) && goi.length === 0, JSON.stringify(thongBao))

        // TikTok: cùng luật
        thongBao.length = 0
        const khoT = khoBoNhoTikTok()
        const ctxT: any = { prisma, kho: khoT, nguoi: 'chu@shop', taoTikTok: ttGia, dayTon: dayTonGia }
        themListing('chT', '9601', 'TCB1', 100000, 100000)
        themListing('chT', '9602', 'TCB2', 160000, 50000)
        await luuCauHinhTikTok(ctxT, { channelId: 'chT', executionMode: 'auto', policy: { maxWritesPerDay: 500, automation: { reprice: true, syncStock: false } } })
        await luuCauHinhTikTok(ctxT, { schedule: { enabled: true, intervalMinutes: 60 } })
        const t0 = soLanDocTT
        const cT = (await khoT.docCauHinh())!
        await khoT.luuCauHinh({ ...cT, nextRunAt: Date.now() - 1000 })
        await chayTheoLichTikTok(prisma, khoT, { taoTikTok: ttGia, dayTon: dayTonGia })
        const kqT = (await khoT.docCauHinh())!.lastResult
        const dongT = (kqT?.results || []).filter((r: any) => /CHƯA BIẾT PHÍ/.test(r.message || ''))
        dung('L3. TikTok chưa biết phí: KHÔNG ghi giá, không đọc TikTok, không lập kế hoạch; MỘT dòng "CHƯA BIẾT PHÍ"',
            goiTT.length === 0 && soLanDocTT === t0 && khoT._keHoach.length === 0 && dongT.length === 1 && dongT[0].action === 'cycle'
            && /"TikTok Shop"/.test(dongT[0].message) && /chưa đổi giá mã nào/.test(dongT[0].message), JSON.stringify(kqT))
        const sauT = thongBao.length
        const cT2 = (await khoT.docCauHinh())!
        await khoT.luuCauHinh({ ...cT2, nextRunAt: Date.now() - 1000 })
        await chayTheoLichTikTok(prisma, khoT, { taoTikTok: ttGia, dayTon: dayTonGia })
        dung('L4. TikTok theo lịch: báo chủ shop ĐÚNG MỘT lần', sauT === 1 && thongBao.length === 1 && /TikTok Pilot cần anh\/chị xem 1 việc/.test(thongBao[0].title)
            && /CHƯA BIẾT PHÍ/.test(thongBao[0].message), JSON.stringify(thongBao))

        // chủ shop khai phí 20% ở Kênh bán online ⇒ lượt sau máy chạy lại: TĂNG mã dưới sàn, HẠ thành nháp chờ duyệt
        phiTin(false, 20)
        await luuCauHinh(ctx, { policy: { automation: { publishNewProducts: false } } })
        const ck = await chayChuKy(ctx)
        dung('L5. khai phí xong ⇒ máy TĂNG mã dưới sàn theo phí khai (133.400), hạ giá thành nháp chờ duyệt, hết dòng CHƯA BIẾT PHÍ',
            goi.join() === 'gia:1:9501:133400' && ck.results.some((r: any) => r.sku === 'CB2' && r.status === 'draft' && /CHỜ NGƯỜI DUYỆT/.test(r.message || ''))
            && !ck.results.some((r: any) => /CHƯA BIẾT PHÍ/.test(r.message || '')), JSON.stringify({ goi, r: ck.results }))
        phiTin(true)
    }

    // ─── H'. Facebook: chu kỳ gãy theo lịch ⇒ báo ngay ───────────────────────────
    {
        thongBao.length = 0
        fbPages = [{ pageId: 'pg1', name: 'Trang A', status: 'active', accessToken: 'x', tokenExpiresAt: null, createdAt: new Date(0) }]
        const khoF = khoBoNhoFb()
        const ctxF: any = { prisma, kho: khoF, nguoi: 'chu@shop' }
        await luuCauHinhFb(ctxF, { pageId: 'pg1', executionMode: 'auto', schedule: { enabled: true, intervalMinutes: 60 } })
        fbPages = []      // chủ shop gỡ fanpage
        const cF = (await khoF.docCauHinh())!
        await khoF.luuCauHinh({ ...cF, nextRunAt: Date.now() - 1000 })
        const kq = await chayTheoLichFb(prisma, khoF)
        dung('H4. Facebook theo lịch gãy (mất fanpage) ⇒ báo ngay', kq === 'loi' && thongBao.length === 1 && /Facebook Pilot: chu kỳ tự động bị lỗi/.test(thongBao[0].title), JSON.stringify({ kq, thongBao }))
    }

    // ─── M. Tồn Shopee đọc ĐÚNG (09/11/2026) ─────────────────────────────────────
    // fetchProducts đọc stock_info_v2.current_stock / normal_stock — trường của bản API cũ, get_item_base_info giờ không trả ⇒
    // OnlineProduct.stock = 0 ở mọi listing Shopee. Gọi bản THẬT của fetchProducts với httpGet giả (không ra mạng).
    {
        const svc: any = new ShopeeService({ apiKey: '1', apiSecret: 's', accessToken: 'tM', shopId: '7' } as any)
        const goiHttp: string[] = []
        const sp = (id: number, them: any) => ({ item_id: id, item_name: `SP ${id}`, item_sku: `M${id}`, item_status: 'NORMAL', category_id: 101, price_info: [{ original_price: 100000, current_price: 100000 }], ...them })
        const ds = [
            sp(1, { stock_info_v2: { summary_info: { total_available_stock: 7 }, seller_stock: [{ stock: 99 }] } }),
            sp(2, { stock_info_v2: { seller_stock: [{ location_id: 'VNZ', stock: 3 }, { stock: 4 }] } }),
            sp(3, { has_model: true }),                                    // có phân loại: base_info không mang tồn từng phân loại
            sp(4, { stock_info_v2: {} }),
            sp(5, { stock_info_v2: { current_stock: 5 } }),                // phản hồi kiểu cũ vẫn đọc được
        ]
        svc.httpGet = async (url: string) => {
            if (url.includes('/product/get_item_list')) { goiHttp.push('list'); return { response: { item: ds.map(d => ({ item_id: d.item_id })), has_next_page: false } } }
            if (url.includes('/product/get_item_base_info')) { goiHttp.push('base'); return { response: { item_list: ds } } }
            goiHttp.push(url.split('?')[0]!)
            throw new Error('bộ kiểm: lời gọi Shopee ngoài dự kiến')
        }
        const r = await fetchProductsGoc.call(svc)
        const ton: Record<string, number> = Object.fromEntries(r.products.map((x: any) => [x.platformProductId, x.stock]))
        dung('M1. fetchProducts: summary_info.total_available_stock ⇒ đúng tồn (7), thắng seller_stock', ton['1'] === 7, JSON.stringify(ton))
        dung('M2. fetchProducts: chỉ có seller_stock ⇒ cộng các kho (3 + 4 = 7)', ton['2'] === 7, JSON.stringify(ton))
        dung('M3. fetchProducts: có phân loại / không có gì ⇒ 0 như cũ (không bịa tồn), KHÔNG hỏi get_model_list (đúng 2 lời gọi); current_stock kiểu cũ vẫn đọc',
            ton['3'] === 0 && ton['4'] === 0 && ton['5'] === 5 && goiHttp.join() === 'list,base', JSON.stringify({ ton, goiHttp }))
    }

    // ─── N. Cầu dao CHUNG trong lõi đẩy tồn (09/11/2026) ─────────────────────────
    // Trước: lõi vừa tính vừa đẩy (không có chỗ dừng trước lần ghi đầu), cầu dao chỉ ở Pilot và chỉ thấy 300 dòng đầu của bảng
    // chạy thử, nút tay "Đẩy tồn kho lên sàn" không soát gì. Gian giả: mọi listing đang 5 trên sàn; mã "về 0" hết hàng trong kho.
    {
        const gianTon = (n: number, veKhong: (i: number) => boolean) => {
            const kenhN = { id: 'chN', name: 'Gian N', platform: 'shopee', shopId: '5', accessToken: 'tN', apiKey: '1', apiSecret: 's', commissionRate: 20 }
            const ds = Array.from({ length: n }, (_, i) => ({ id: `n${i}`, channelId: 'chN', platformProductId: String(50000 + i), sku: `N${i}`, name: `Hàng N${i}`, stock: 5,
                localProduct: { id: `pn${i}`, sku: `N${i}`, stock: veKhong(i) ? 0 : 6 } }))
            return { ...cuaHangDayTay({ kenh: kenhN, listing: ds }), ds }
        }
        const san = sanDayTay()
        const g = gianTon(400, i => i >= 280)      // 120 mã về 0 ở dòng 280–399: 100 mã nằm NGOÀI 300 dòng bảng chạy thử
        const thu = await dayTonLenSan(g.prisma, 'chN', { dryRun: true, giaLap: { dichVu: san.dichVu } })
        const d = thu.data || {}
        dung('N1. chạy thử 400 listing, 120 mã về 0 nằm cuối ⇒ cauDao 120/400 đếm trên TOÀN BỘ (bảng 300 dòng một mình KHÔNG nhảy); ví dụ ≤ 20; 0 lời gọi sàn, không ghi',
            thu.ok && /^120\/400 mã/.test(d.cauDao || '') && d.veKhong === 120 && d.coHangTrenSan === 400 && d.viDuVeKhong?.length === 20
            && d.viDuVeKhong.every((x: any) => x.sku && x.tenSan && x.tonDangTrenSan === 5) && d.bang?.length === 300 && cauDaoTon(d.bang) === null
            && san.goi.length === 0 && g.ghi.length === 0, JSON.stringify({ ...d, bang: d.bang?.length, goi: san.goi.length, ghi: g.ghi.length }))
        const that = await dayTonLenSan(g.prisma, 'chN', { giaLap: { dichVu: san.dichVu } })
        dung('N2. chạy thật KHÔNG cờ ⇒ 409 "CẦU DAO — không đẩy tồn" kèm chi tiết (veKhong, coHangTrenSan, viDuVeKhong); 0 lời gọi sàn, không ghi CSDL',
            that.http === 409 && !that.ok && /^CẦU DAO — không đẩy tồn: 120\/400/.test(that.loi || '') && that.data?.cauDao === d.cauDao && that.data?.veKhong === 120
            && that.data?.coHangTrenSan === 400 && that.data?.viDuVeKhong?.length === 20 && san.goi.length === 0 && g.ghi.length === 0,
            JSON.stringify({ http: that.http, loi: that.loi, goi: san.goi.length, ghi: g.ghi.slice(0, 3) }))
        const chuoi = await dayTonLenSan(g.prisma, 'chN', { chapNhanVeKhong: 'true' as any, giaLap: { dichVu: san.dichVu } })
        dung('N3. cờ phải ĐÚNG true — chuỗi "true" vẫn 409, 0 lời gọi sàn', chuoi.http === 409 && san.goi.length === 0 && g.ghi.length === 0, JSON.stringify({ http: chuoi.http, goi: san.goi.length }))
        const vuot = await dayTonLenSan(g.prisma, 'chN', { chapNhanVeKhong: true, veKhongDaXem: 120, giaLap: { dichVu: san.dichVu } })
        dung('N4. người bấm tích "vẫn đẩy các mã về 0" (chapNhanVeKhong, đã xem 120) ⇒ đẩy đủ 400 (120 mã về 0), sổ đồng bộ ghi VƯỢT CẦU DAO',
            vuot.ok && vuot.data?.pushed === 400 && vuot.data?.failed === 0 && vuot.data?.veKhong === 120 && !!vuot.data?.cauDao
            && san.goi.length === 400 && san.goi.filter(x => x.endsWith(':0')).length === 120 && g.ghi.some(x => /VƯỢT CẦU DAO.*120\/400/.test(x)),
            JSON.stringify({ data: { ...vuot.data, errors: vuot.data?.errors?.slice(0, 3) }, goi: san.goi.length }))

        const san2 = sanDayTay()
        const g2 = gianTon(100, i => i < 3)        // ĐỐI CHỨNG: 3/100 mã về 0 — bán hết lẻ tẻ
        const thu2 = await dayTonLenSan(g2.prisma, 'chN', { dryRun: true, giaLap: { dichVu: san2.dichVu } })
        const that2 = await dayTonLenSan(g2.prisma, 'chN', { giaLap: { dichVu: san2.dichVu } })
        dung('N5. ĐỐI CHỨNG 3/100 mã về 0 ⇒ chạy thử cauDao null; chạy thật KHÔNG cờ vẫn đẩy đủ 100',
            thu2.ok && thu2.data?.cauDao === null && thu2.data?.veKhong === 3 && that2.ok && that2.data?.pushed === 100 && that2.data?.veKhong === 3 && san2.goi.length === 100,
            JSON.stringify({ thu: { ...thu2.data, bang: undefined }, that: that2.data, goi: san2.goi.length }))

        // Pilot qua lõi THẬT (không phải đẩy giả của mục B/I)
        const ghiPilot: any[] = []
        const san3 = sanDayTay()
        const g3 = gianTon(400, i => i >= 280)
        const op3: any[] = []
        const r3 = await dayTonChuKy({ tuDong: true, san: 'Shopee', gian: 'Gian N', conLuot: async () => { }, ghi: async (w: any) => { ghiPilot.push(w) },
            day: (op: any) => { op3.push(op); return dayTonLenSan(g3.prisma, 'chN', { ...op, giaLap: { dichVu: san3.dichVu } }) } })
        dung('N6. Pilot dùng cauDao của lõi (đếm 400 dòng, không phải bảng 300) ⇒ bỏ qua, CHỜ NGƯỜI DUYỆT, 0 lời gọi sàn',
            r3.status === 'skipped' && /CẦU DAO — không đẩy tồn: 120\/400/.test(r3.message) && /CHỜ NGƯỜI DUYỆT/.test(r3.message) && san3.goi.length === 0 && op3.length === 1 && ghiPilot.length === 0,
            JSON.stringify({ r3, op3 }))
        const san4 = sanDayTay()
        const g4 = gianTon(100, i => i < 3)
        const op4: any[] = []
        const r4 = await dayTonChuKy({ tuDong: true, san: 'Shopee', gian: 'Gian N', conLuot: async () => { }, ghi: async (w: any) => { ghiPilot.push(w) },
            day: async (op: any) => {
                op4.push(op)
                // giữa lượt chạy thử và lượt thật: 60 mã nữa hết hàng trong kho (vd vừa chuyển kho)
                if (!op.dryRun) for (const l of g4.ds.slice(3, 63)) l.localProduct.stock = 0
                return dayTonLenSan(g4.prisma, 'chN', { ...op, giaLap: { dichVu: san4.dichVu } })
            } })
        dung('N7. tồn đổi giữa chạy thử và chạy thật ⇒ lõi 409 ⇒ Pilot "skipped" + CẦU DAO (không phải "failed"), 0 lời gọi sàn; Pilot không bao giờ gửi chapNhanVeKhong',
            r4.status === 'skipped' && /CẦU DAO — không đẩy tồn: 63\/100/.test(r4.message) && san4.goi.length === 0 && ghiPilot.length === 0
            && op4.length === 2 && op4.every(x => !('chapNhanVeKhong' in x)), JSON.stringify({ r4, op4 }))

        // Đồng ý gắn với CON SỐ đã xem: người bấm xem 100 mã về 0, tích ô, lúc bấm tồn đã đổi thành 120 ⇒ không phải điều họ đồng ý
        const san8 = sanDayTay()
        const g8 = gianTon(400, i => i >= 280)
        const thieuSo = await dayTonLenSan(g8.prisma, 'chN', { chapNhanVeKhong: true, giaLap: { dichVu: san8.dichVu } })
        const soLa = await dayTonLenSan(g8.prisma, 'chN', { chapNhanVeKhong: true, veKhongDaXem: NaN, giaLap: { dichVu: san8.dichVu } })
        const tang = await dayTonLenSan(g8.prisma, 'chN', { chapNhanVeKhong: true, veKhongDaXem: 100, giaLap: { dichVu: san8.dichVu } })
        dung('N8. tích "vẫn đẩy" mà thiếu số đã xem (hoặc NaN) ⇒ 409 "thiếu số mã về 0 đã xem"; đã xem 100 mà nay 120 ⇒ 409 "tăng từ 100 lên 120"; 0 lời gọi sàn, không ghi',
            thieuSo.http === 409 && /thiếu số mã về 0 đã xem/.test(thieuSo.loi || '') && soLa.http === 409 && /thiếu số mã về 0 đã xem/.test(soLa.loi || '')
            && tang.http === 409 && /tăng từ 100 lên 120/.test(tang.loi || '') && tang.data?.veKhong === 120
            && san8.goi.length === 0 && g8.ghi.length === 0,
            JSON.stringify({ thieuSo: thieuSo.loi, soLa: soLa.loi, tang: tang.loi, goi: san8.goi.length, ghi: g8.ghi.length }))
        const itHon = await dayTonLenSan(g8.prisma, 'chN', { chapNhanVeKhong: true, veKhongDaXem: 125, giaLap: { dichVu: san8.dichVu } })
        dung('N9. đã xem 125 mã về 0, lúc bấm chỉ còn 120 (ÍT hơn) ⇒ đồng ý vẫn hiệu lực, đẩy đủ 400',
            itHon.ok && itHon.data?.pushed === 400 && itHon.data?.veKhong === 120 && san8.goi.length === 400,
            JSON.stringify({ ok: itHon.ok, loi: itHon.loi, pushed: itHon.data?.pushed, goi: san8.goi.length }))
    }

    // ─── N10–N17. Đẩy tồn TỪNG PHÂN LOẠI (10/11/2026, SP-06 / TT-08) ─────────────
    // Ca thật đo 11/09/2026: listing SHD1072 có HAI phân loại mang HAI mã kho — "Hồng" SHD1072 và "Tím" SHD2011. Cách cũ chỉ đẩy
    // phân loại mang SKU listing ⇒ "Tím" không bao giờ được đẩy: kho hết mà Shopee vẫn bán. TikTok: lưu seller_sku SKU ĐẦU +
    // tồn TỔNG, đẩy SKU đầu rồi đè số đó lên tổng.
    {
        const kenhV = { id: 'chV', name: 'Gian V', platform: 'shopee', shopId: '7', accessToken: 'tV', apiKey: '1', apiSecret: 's', commissionRate: 20 }
        const gianV = () => {
            const ds: any[] = [
                // DB lưu 0 cho hàng có phân loại (get_item_base_info không mang tồn từng phân loại)
                { id: 'v1', channelId: 'chV', platformProductId: '700', sku: 'SHD1072', name: 'Đèn ngủ cảm ứng', stock: 0, localProduct: { id: 'pA', sku: 'SHD1072', stock: 7 } },
                // DB lưu 2 (cũ), sàn đang bán 5 = đúng tồn kho ⇒ đọc SỐNG thì khỏi đẩy
                { id: 'v2', channelId: 'chV', platformProductId: '701', sku: 'X1', name: 'Hàng X1', stock: 2, localProduct: { id: 'pX', sku: 'X1', stock: 5 } },
            ]
            const khoSku = [
                { id: 'pB', sku: 'SHD2011', stock: 4, mergedIntoId: null, mergedRate: 1 },
                { id: 'pV', sku: 'VI-GOC', stock: 25, mergedIntoId: null, mergedRate: 1 },
            ]
            const anhXa = [{ platformSku: 'VI10', productId: 'pV', conversionRate: 10 }]
            return { ...cuaHangDayTay({ kenh: kenhV, listing: ds, khoSku, anhXa }), ds }
        }
        const plV = [
            { id: '11', sku: 'SHD1072', ten: 'Hồng', ton: 3 },
            { id: '12', sku: 'SHD2011', ten: 'Tím', ton: 9 },
        ]
        const sanV = () => sanPhanLoai({ nen: 'shopee', mat: { '700': { coModel: true, pl: plV.map(x => ({ ...x })) }, '701': { ton: 5 } } })

        const s10 = sanV(), g10 = gianV()
        const thu10 = await dayTonLenSan(g10.prisma, 'chV', { dryRun: true, giaLap: { dichVu: s10.dichVu } })
        const b10 = thu10.data?.bang || []
        const hong = b10.find((x: any) => x.phanLoai === 'Hồng'), tim = b10.find((x: any) => x.phanLoai === 'Tím'), x1 = b10.find((x: any) => x.sku === 'X1')
        dung('N10. chạy thử Shopee có phân loại: MỖI phân loại một dòng (Hồng 3→7 theo link listing, Tím 9→4 theo mã kho SHD2011), tên phân loại đứng đầu tenSan; hàng thường đọc tồn SỐNG 5 = kho ⇒ giữ nguyên; chỉ ĐỌC sàn (base 1 lô + model 1 mã), 0 ghi',
            thu10.ok && b10.length === 3 && hong?.tonDangTrenSan === 3 && hong?.seDay === 7 && tim?.tonDangTrenSan === 9 && tim?.seDay === 4 && tim?.sku === 'SHD2011'
            && /^Tím · Đèn ngủ/.test(tim?.tenSan || '') && x1?.tonDangTrenSan === 5 && x1?.boQua === true
            && thu10.data?.seDay === 2 && thu10.data?.seBoQua === 1 && thu10.data?.phanLoai?.soListing === 1 && thu10.data?.phanLoai?.soDong === 2
            && thu10.data?.phanLoai?.boQua === 0 && !thu10.data?.docSan && /chỉ ĐỌC sàn/.test(thu10.data?.ghiChu || '')
            && s10.goi.length === 0 && s10.doc.join(',') === 'base:2,model:700' && g10.ghi.length === 0,
            JSON.stringify({ data: { ...thu10.data, bang: b10 }, doc: s10.doc, goi: s10.goi, ghi: g10.ghi }))

        const that10 = await dayTonLenSan(g10.prisma, 'chV', { giaLap: { dichVu: s10.dichVu } })
        dung('N11. chạy thật: ghi ĐÚNG model_id từng phân loại (700:7:11 Hồng, 700:4:12 Tím — trước Tím không bao giờ được đẩy); tồn listing = Σ phân loại 11 (trước để 0); hàng thường không ghi; sổ đồng bộ nói số dòng phân loại',
            that10.ok && that10.data?.pushed === 2 && that10.data?.failed === 0 && s10.goi.join(',') === 'ton:700:7:11,ton:700:4:12'
            && g10.ds[0].stock === 11 && g10.ds[1].stock === 2 && g10.ghi.filter(x => x.startsWith('sp:')).join(',') === 'sp:v1'
            && g10.ghi.some(x => /phân loại: 2 dòng cần đẩy \/ 1 listing, bỏ qua 0/.test(x)),
            JSON.stringify({ data: that10.data, goi: s10.goi, ghi: g10.ghi, ton: g10.ds.map(l => l.stock) }))

        // Phân loại không ra mã kho / chưa khai SKU ⇒ BỎ QUA có tên (không đẩy 0); phân loại qua BẢNG ÁNH XẠ có hệ số (1 vỉ = 10)
        const s12 = sanPhanLoai({ nen: 'shopee', mat: { '700': { coModel: true, pl: [
            ...plV.map(x => ({ ...x })),
            { id: '13', sku: 'SHD9999', ten: 'Xanh', ton: 6 },
            { id: '14', sku: '', ten: 'Vàng', ton: 2 },
            { id: '15', sku: 'vi10', ten: 'Vỉ 10', ton: 0 },
        ] }, '701': { ton: 5 } } })
        const g12 = gianV()
        const thu12 = await dayTonLenSan(g12.prisma, 'chV', { dryRun: true, giaLap: { dichVu: s12.dichVu } })
        const that12 = await dayTonLenSan(g12.prisma, 'chV', { giaLap: { dichVu: s12.dichVu } })
        const vd = thu12.data?.phanLoai?.viDuBoQua || []
        const vi = (thu12.data?.bang || []).find((x: any) => x.phanLoai === 'Vỉ 10')
        dung('N12. phân loại mã "SHD9999" không có trong kho + phân loại chưa khai SKU ⇒ bỏ qua, liệt kê đích danh, KHÔNG ghi; phân loại "vi10" qua bảng ánh xạ hệ số 10 ⇒ 25 cái = 2 vỉ; tồn listing = 7 + 4 + 6 + 2 + 2 = 21',
            thu12.ok && thu12.data?.phanLoai?.boQua === 2 && vd.some((x: string) => /SHD1072 \/ Xanh: mã "SHD9999" không có trong kho/.test(x))
            && vd.some((x: string) => /SHD1072 \/ Vàng: phân loại chưa khai SKU trên sàn/.test(x)) && vi?.seDay === 2 && vi?.heSo === 10
            && that12.ok && s12.goi.join(',') === 'ton:700:7:11,ton:700:4:12,ton:700:2:15' && !s12.goi.some(x => /:13$|:14$/.test(x))
            && g12.ds[0].stock === 21,
            JSON.stringify({ phanLoai: thu12.data?.phanLoai, vi, goi: s12.goi, ton: g12.ds[0].stock }))

        // Cầu dao thấy phân loại: 6 phân loại đang có hàng mà kho hết ⇒ trước (DB lưu 0) cầu dao không bao giờ thấy
        const s13 = sanPhanLoai({ nen: 'shopee', mat: { '800': { coModel: true, pl: Array.from({ length: 6 }, (_, i) => ({ id: String(20 + i), sku: `M${i}`, ten: `Cỡ ${i}`, ton: 5 })) } } })
        const g13 = cuaHangDayTay({
            kenh: kenhV, listing: [{ id: 'v8', channelId: 'chV', platformProductId: '800', sku: 'M0', name: 'Áo', stock: 0, localProduct: null }],
            khoSku: Array.from({ length: 6 }, (_, i) => ({ id: `pm${i}`, sku: `M${i}`, stock: 0, mergedIntoId: null, mergedRate: 1 })),
        })
        const thu13 = await dayTonLenSan(g13.prisma, 'chV', { dryRun: true, giaLap: { dichVu: s13.dichVu } })
        const that13 = await dayTonLenSan(g13.prisma, 'chV', { giaLap: { dichVu: s13.dichVu } })
        dung('N13. 6 phân loại đang có hàng sẽ về 0 ⇒ cầu dao đếm TỪNG phân loại (6/6) ⇒ chạy thật 409, 0 lời gọi ghi (cách cũ: DB lưu 0 ⇒ cầu dao không thấy gì)',
            thu13.ok && /^6\/6 mã/.test(thu13.data?.cauDao || '') && thu13.data?.viDuVeKhong?.every((x: any) => /^Cỡ \d · Áo/.test(x.tenSan))
            && that13.http === 409 && that13.data?.phanLoai?.soDong === 6 && s13.goi.length === 0 && g13.ghi.length === 0,
            JSON.stringify({ cauDao: thu13.data?.cauDao, http: that13.http, goi: s13.goi }))

        // Đọc sàn hỏng ⇒ rơi về cách cũ (không chặn cả lượt) + ghi chú
        const s14 = sanPhanLoai({ nen: 'shopee', hongDoc: true, mat: { '700': { coModel: true, pl: plV.map(x => ({ ...x })) }, '701': { ton: 5 } } })
        const g14 = gianV()
        const thu14 = await dayTonLenSan(g14.prisma, 'chV', { dryRun: true, giaLap: { dichVu: s14.dichVu } })
        const that14 = await dayTonLenSan(g14.prisma, 'chV', { giaLap: { dichVu: s14.dichVu } })
        dung('N14. đọc Shopee hỏng (proxy) ⇒ cách cũ: phân loại khớp SKU listing (700:7:11), hàng thường theo tồn đã lưu (2→5); docSan nói "Không đọc được 2/2 mã"',
            thu14.ok && /Không đọc được 2\/2 mã trên Shopee \(Proxy chuyển tiếp/.test((thu14.data?.docSan || []).join(' ')) && !thu14.data?.phanLoai
            && that14.ok && s14.goi.join(',') === 'ton:700:7:11,ton:701:5' && /Không đọc được 2\/2/.test((that14.data?.docSan || []).join(' ')),
            JSON.stringify({ thu: thu14.data?.docSan, goi: s14.goi, that: that14.data }))
        const s14b = sanPhanLoai({ nen: 'shopee', hongModel: ['700'], mat: { '700': { coModel: true, pl: plV.map(x => ({ ...x })) }, '701': { ton: 5 } } })
        const g14b = gianV()
        const that14b = await dayTonLenSan(g14b.prisma, 'chV', { giaLap: { dichVu: s14b.dichVu } })
        dung('N14b. đọc phân loại MỘT mã hỏng ⇒ chỉ mã đó đi cách cũ (700:7:11), ghi chú "Không đọc được phân loại của 1 mã"; hàng thường vẫn đọc sống (5 = kho, không ghi)',
            that14b.ok && s14b.goi.join(',') === 'ton:700:7:11' && /Không đọc được phân loại của 1 mã \(Shopee get_model_list: error_server/.test((that14b.data?.docSan || []).join(' ')),
            JSON.stringify({ goi: s14b.goi, docSan: that14b.data?.docSan }))

        // Chỉ đẩy vài listing (nút tay chọn mã) ⇒ chỉ đọc đúng mấy mã đó
        const s14c = sanV(), g14c = gianV()
        await dayTonLenSan(g14c.prisma, 'chV', { dryRun: true, onlineProductIds: ['v2'], giaLap: { dichVu: s14c.dichVu } })
        dung('N14c. chọn một listing (onlineProductIds) ⇒ get_item_base_info đúng 1 mã, không hỏi phân loại mã khác',
            s14c.doc.join(',') === 'base:1', JSON.stringify(s14c.doc))

        // TikTok: nhiều SKU — trước lưu seller_sku SKU ĐẦU + tồn TỔNG, đẩy SKU đầu rồi ĐÈ tổng
        const kenhT = { id: 'chT', name: 'Gian T', platform: 'tiktok', shopId: '8', accessToken: 'tT', apiKey: '1', apiSecret: 's', commissionRate: 20 }
        const gianT = () => {
            const ds: any[] = [
                { id: 't1', channelId: 'chT', platformProductId: '900', sku: 'TA', name: 'Ốp lưng', stock: 12, localProduct: { id: 'tA', sku: 'TA', stock: 3 } },
                { id: 't2', channelId: 'chT', platformProductId: '901', sku: 'TC', name: 'Cáp sạc', stock: 1, localProduct: { id: 'tC', sku: 'TC', stock: 4 } },
                { id: 't3', channelId: 'chT', platformProductId: '902', sku: 'TD', name: 'Củ sạc', stock: 0, localProduct: { id: 'tD', sku: 'TD', stock: 6 } },
            ]
            return { ...cuaHangDayTay({ kenh: kenhT, listing: ds, khoSku: [{ id: 'tB', sku: 'TB', stock: 2, mergedIntoId: null, mergedRate: 1 }] }), ds }
        }
        const matT = () => ({
            '900': { pl: [{ id: 's1', sku: 'TA', ten: 'Đỏ', ton: 5 }, { id: 's2', sku: 'TB', ten: 'Xanh', ton: 7 }] },
            '901': { ton: 4 },
            '902': { ton: 0 },
        })
        const s15 = sanPhanLoai({ nen: 'tiktok', mat: matT() }), g15 = gianT()
        const thu15 = await dayTonLenSan(g15.prisma, 'chT', { dryRun: true, giaLap: { dichVu: s15.dichVu } })
        const b15 = thu15.data?.bang || []
        const that15 = await dayTonLenSan(g15.prisma, 'chT', { giaLap: { dichVu: s15.dichVu } })
        dung('N15. TikTok nhiều SKU: mỗi SKU một dòng (Đỏ 5→3, Xanh 7→2 theo mã kho TB), ghi đúng sku_id; tồn listing = Σ 5 (trước đè 3 của SKU đầu lên tổng); một SKU: đọc sống 4 = kho ⇒ giữ, 0→6 ghi kèm sku_id (khỏi hỏi product detail); chỉ ĐỌC 1 lần search mỗi lượt',
            thu15.ok && b15.find((x: any) => x.phanLoai === 'Đỏ')?.seDay === 3 && b15.find((x: any) => x.phanLoai === 'Xanh')?.seDay === 2
            && b15.find((x: any) => x.sku === 'TC')?.boQua === true && thu15.data?.phanLoai?.soDong === 2
            && that15.ok && that15.data?.pushed === 3 && s15.goi.join(',') === 'ton:900:3:s1,ton:900:2:s2,ton:902:6:902-1:TD'
            && g15.ds[0].stock === 5 && g15.ds[1].stock === 1 && g15.ds[2].stock === 6 && s15.doc.join(',') === 'tim,tim',
            JSON.stringify({ bang: b15, goi: s15.goi, ton: g15.ds.map(l => l.stock), doc: s15.doc }))

        const s16 = sanPhanLoai({ nen: 'tiktok', hongDoc: true, mat: matT() }), g16 = gianT()
        const that16 = await dayTonLenSan(g16.prisma, 'chT', { giaLap: { dichVu: s16.dichVu } })
        dung('N16. đọc TikTok hỏng (token) ⇒ cách cũ theo seller_sku đã lưu (900:3:TA, 901:4:TC, 902:6:TD) + ghi chú "Không đọc được danh mục TikTok ([105005]"',
            that16.ok && s16.goi.join(',') === 'ton:900:3:TA,ton:901:4:TC,ton:902:6:TD'
            && /Không đọc được danh mục TikTok \(TikTok products\/search: \[105005\]/.test((that16.data?.docSan || []).join(' ')),
            JSON.stringify({ goi: s16.goi, docSan: that16.data?.docSan }))

        // TikTok hàng nhiều SKU: phân loại sắp về 0 vào cầu dao từng SKU; SKU không có mã kho bỏ qua có tên
        const s17 = sanPhanLoai({ nen: 'tiktok', mat: { '900': { pl: [{ id: 's1', sku: 'TA', ten: 'Đỏ', ton: 5 }, { id: 's9', sku: 'TZ', ten: 'Tím', ton: 4 }] } } })
        const g17 = cuaHangDayTay({ kenh: kenhT, listing: [{ id: 't1', channelId: 'chT', platformProductId: '900', sku: 'TA', name: 'Ốp lưng', stock: 9, localProduct: { id: 'tA', sku: 'TA', stock: 0 } }] })
        const thu17 = await dayTonLenSan(g17.prisma, 'chT', { dryRun: true, giaLap: { dichVu: s17.dichVu } })
        dung('N17. TikTok: SKU "TZ" không có mã kho ⇒ bỏ qua có tên; SKU Đỏ 5→0 tính vào cầu dao (1 mã về 0 < ngưỡng 5 ⇒ không nhảy) — so TỪNG SKU, không so tổng 9 với SKU đầu',
            thu17.ok && thu17.data?.veKhong === 1 && thu17.data?.coHangTrenSan === 1 && thu17.data?.cauDao === null
            && (thu17.data?.phanLoai?.viDuBoQua || []).some((x: string) => /TA \/ Tím: mã "TZ" không có trong kho/.test(x)),
            JSON.stringify(thu17.data))

        // Chu kỳ Pilot chạy thử rồi chạy thật cách nhau vài giây ⇒ lượt thật dùng lại bản đọc của lượt chạy thử (docSanTruoc).
        // Nút tay (N10 → N11: hai lần gọi riêng, không truyền bản đọc) thì đọc lại — người bấm có thể xem trước từ mấy phút trước.
        const s18 = sanV(), g18 = gianV(), ghi18: any[] = []
        const r18 = await dayTonChuKy({ tuDong: true, san: 'Shopee', gian: 'Gian V', conLuot: async () => { }, ghi: async (w: any) => { ghi18.push(w) },
            day: (o: any) => dayTonLenSan(g18.prisma, 'chV', { ...o, giaLap: { dichVu: s18.dichVu } }) })
        dung('N18. chu kỳ Pilot (chạy thử ⇒ chạy thật): đọc sàn MỘT lần (base:2,model:700), lượt thật dùng lại bản đọc mà vẫn ghi đúng model_id hai phân loại; nút tay đọc lại mỗi lượt; bản đọc nằm ngoài data (không ra trình duyệt)',
            r18.status === 'succeeded' && s18.doc.join(',') === 'base:2,model:700' && s18.goi.join(',') === 'ton:700:7:11,ton:700:4:12'
            && g18.ds[0].stock === 11 && ghi18.length === 1
            && s10.doc.join(',') === 'base:2,model:700,base:2,model:700'
            && !!thu10.banDocSan && thu10.data?.banDocSan === undefined && !('banDocSan' in (that10 as any)),
            JSON.stringify({ r18, doc: s18.doc, goi: s18.goi, docTay: s10.doc }))
    }

    // ─── P. Nút "Đẩy giá lên sàn": rào GIÁ SÀN từng listing (09/11/2026) ─────────
    // Nút cũ đẩy giá bán lẻ POS lên MỌI listing, không soát gì. Phí đo 40 đơn = 14% + 3.000đ ⇒ mã vốn 100k: giá sàn 127.200đ
    // (biên tối thiểu 5% mặc định). Sàn đang để 140k.
    {
        const kenhP = (them: any = {}) => ({ id: 'chP', name: 'Gian P', platform: 'shopee', shopId: '6', accessToken: 'tP', apiKey: '1', apiSecret: 's', commissionRate: 20, ...them })
        const mp = (sku: string, item: string, giaBanLe: number, giaVon: number, giaSan = 140000) => ({
            l: { id: `lp-${sku}`, channelId: 'chP', platformProductId: item, sku, name: `Hàng ${sku}`, price: giaSan, categoryId: '101', localProductId: `pp-${sku}`, localProduct: { id: `pp-${sku}`, sku, sellingPrice: giaBanLe } },
            h: { id: `pp-${sku}`, sku, name: `Hàng ${sku}`, description: '', costPrice: giaVon },
        })
        const gianP = (ds: ReturnType<typeof mp>[], o: { kenh?: any; daDo?: boolean; chinhSach?: Record<string, any>; docChinhSach?: 'hong' | 'chuaCoBang' } = {}) => {
            xoaDemPhiTheoNganh()
            const daDo = o.daDo !== false
            return cuaHangDayTay({ kenh: o.kenh || kenhP(), listing: ds.map(x => x.l), hang: ds.map(x => x.h), chinhSach: o.chinhSach, docChinhSach: o.docChinhSach,
                don: daDo ? donDoiSoat : [], donNganh: daDo ? donDoiSoat.map(x => ({ ...x, nganh: '101' })) : [] })
        }
        // dưới sàn / thiếu giá vốn / trên sàn / giá sàn đã bằng giá bán lẻ
        const bonMa = () => [mp('PD', '8001', 110000, 100000), mp('PV', '8002', 150000, 0), mp('PT', '8003', 150000, 100000), mp('PB', '8004', 150000, 100000, 150000)]

        const s1 = sanDayTay(), g1 = gianP(bonMa())
        const thu = await dayGiaLenSan(g1.prisma, 'chP', { dryRun: true, giaLap: { dichVu: s1.dichVu } })
        const d = thu.data || {}
        const vd = (sku: string) => (d.viDuBoQua || []).find((x: any) => x.sku === sku)
        dung('P1. chạy thử: dưới giá sàn (110k < 127.200đ) và thiếu giá vốn ⇒ BỎ QUA có lý do; mã trên sàn ⇒ sẽ đổi; 0 lời gọi sàn, không ghi',
            thu.ok && d.chayThu === true && d.seDay === 1 && d.seBoQua === 3 && d.boQuaDuoiSan === 2 && d.demBoQua?.duoiSan === 1 && d.demBoQua?.thieuVon === 1
            && vd('PD')?.gia === 110000 && /thấp hơn GIÁ SÀN 127\.200đ/.test(vd('PD')?.lyDo || '') && /CHƯA CÓ GIÁ VỐN/.test(vd('PV')?.lyDo || '')
            && d.viDuDoi?.length === 1 && d.viDuDoi[0].sku === 'PT' && d.viDuDoi[0].giaCu === 140000 && d.viDuDoi[0].giaMoi === 150000
            && s1.goi.length === 0 && g1.ghi.length === 0, JSON.stringify({ d, goi: s1.goi, ghi: g1.ghi }))
        const that = await dayGiaLenSan(g1.prisma, 'chP', { giaLap: { dichVu: s1.dichVu } })
        dung('P2. chạy thật: CHỈ mã trên sàn được ghi (1 lời gọi updatePrice); dưới sàn / thiếu vốn không gọi sàn; sổ đồng bộ ghi số bỏ qua',
            that.ok && that.data?.pushed === 1 && that.data?.skipped === 3 && that.data?.failed === 0 && that.data?.boQuaDuoiSan === 2 && that.data?.viDuBoQua?.length === 2
            && s1.goi.join() === 'gia:8003:150000' && g1.ghi.filter(x => x.startsWith('sp:')).join() === 'sp:lp-PT' && g1.ghi.some(x => /rào giá sàn bỏ qua 2 mã/.test(x)),
            JSON.stringify({ data: that.data, goi: s1.goi, ghi: g1.ghi }))

        const s3 = sanDayTay(), g3 = gianP([mp('PT', '8003', 150000, 100000), mp('PH', '8005', 200000, 100000)], { daDo: false, kenh: kenhP({ commissionRate: 6 }) })
        const r3 = await dayGiaLenSan(g3.prisma, 'chP', { giaLap: { dichVu: s3.dichVu } })
        dung('P3. gian CHƯA BIẾT PHÍ (0 đơn đối soát, ô phí còn 6% mặc định) ⇒ không mã nào ghi, lý do kèm đường khai «Phí sàn (%)»; 0 lời gọi sàn',
            r3.ok && r3.data?.pushed === 0 && r3.data?.boQuaDuoiSan === 2 && r3.data?.demBoQua?.chuaBietPhi === 2 && /Chưa biết phí sàn của gian "Gian P"/.test(r3.data?.chuaBietPhi || '')
            && /«Phí sàn \(%\)»/.test(r3.data?.chuaBietPhi || '') && r3.data.viDuBoQua.every((x: any) => /Chưa biết phí sàn/.test(x.lyDo)) && s3.goi.length === 0
            && !g3.ghi.some(x => x.startsWith('sp:')), JSON.stringify({ data: r3.data, goi: s3.goi }))
        const s4 = sanDayTay(), g4 = gianP([mp('PT', '8003', 150000, 100000), mp('PK', '8006', 130000, 100000)], { daDo: false, kenh: kenhP({ commissionRate: 20 }) })
        const r4 = await dayGiaLenSan(g4.prisma, 'chP', { giaLap: { dichVu: s4.dichVu } })
        dung('P4. chủ shop đã KHAI phí 20% ⇒ giá sàn theo phí khai (133.400đ): 150k ghi, 130k bỏ qua',
            r4.ok && r4.data?.pushed === 1 && s4.goi.join() === 'gia:8003:150000' && r4.data?.viDuBoQua?.length === 1 && r4.data.viDuBoQua[0].sku === 'PK'
            && /thấp hơn GIÁ SÀN 133\.400đ/.test(r4.data.viDuBoQua[0].lyDo) && !r4.data?.chuaBietPhi, JSON.stringify({ data: r4.data, goi: s4.goi }))

        // chính sách đã lưu của Pilot CÙNG SÀN: biên tối thiểu 25% ⇒ giá sàn 168.900đ — 150k qua được mặc định 5% (P2) giờ bị chặn
        const pol = (shopee: number, tiktok: number) => ({ ShopeePilotConfig: { minMarginRate: shopee }, TikTokPilotConfig: { minMarginRate: tiktok } })
        const s5 = sanDayTay(), g5 = gianP([mp('PT', '8003', 150000, 100000), mp('PH', '8005', 180000, 100000)], { chinhSach: pol(0.25, 0.4) })
        const r5 = await dayGiaLenSan(g5.prisma, 'chP', { giaLap: { dichVu: s5.dichVu } })
        dung('P5. Shopee: chính sách Shopee Pilot đã lưu (biên tối thiểu 25%) ⇒ giá sàn 168.900đ: 150k bị chặn, 180k ghi',
            r5.ok && r5.data?.pushed === 1 && s5.goi.join() === 'gia:8005:180000' && /GIÁ SÀN 168\.900đ \(biên tối thiểu 25%/.test(r5.data?.viDuBoQua?.[0]?.lyDo || ''),
            JSON.stringify({ data: r5.data, goi: s5.goi }))
        const s6 = sanDayTay(), g6 = gianP([mp('PT', '8003', 150000, 100000), mp('PH', '8005', 180000, 100000)], { kenh: kenhP({ platform: 'tiktok' }), chinhSach: pol(0.05, 0.25) })
        const r6 = await dayGiaLenSan(g6.prisma, 'chP', { giaLap: { dichVu: s6.dichVu } })
        dung('P6. TikTok: đọc chính sách TikTok Pilot (không phải của Shopee) ⇒ 150k bị chặn, 180k ghi kèm seller SKU',
            r6.ok && r6.data?.pushed === 1 && s6.goi.join() === 'gia:8005:180000:PH' && /GIÁ SÀN 168\.900đ/.test(r6.data?.viDuBoQua?.[0]?.lyDo || ''),
            JSON.stringify({ data: r6.data, goi: s6.goi }))

        const s7 = sanDayTay(), g7 = gianP([mp('PT', '8003', 150000, 100000)], { docChinhSach: 'hong' })
        const r7 = await dayGiaLenSan(g7.prisma, 'chP', { giaLap: { dichVu: s7.dichVu } })
        const s7b = sanDayTay(), g7b = gianP([mp('PT', '8003', 150000, 100000)], { docChinhSach: 'chuaCoBang' })
        const r7b = await dayGiaLenSan(g7b.prisma, 'chP', { giaLap: { dichVu: s7b.dichVu } })
        dung('P7. đọc chính sách HỎNG ⇒ dừng cả lượt (503), không rơi về mặc định lỏng hơn; chưa có bảng Pilot (chưa dùng Pilot) ⇒ mặc định, vẫn ghi',
            r7.http === 503 && !r7.ok && s7.goi.length === 0 && g7.ghi.length === 0 && r7b.ok && r7b.data?.pushed === 1 && s7b.goi.join() === 'gia:8003:150000',
            JSON.stringify({ r7, r7b: r7b.data, goi: s7.goi }))
        const s8 = sanDayTay(), g8 = gianP(bonMa())
        const r8 = await dayGiaLenSan(g8.prisma, 'chP', { force: true, giaLap: { dichVu: s8.dichVu } })
        dung('P8. force chỉ bỏ bước "giá đã bằng" (PB ghi lại) — KHÔNG vượt rào giá sàn (PD, PV vẫn bỏ qua)',
            r8.ok && r8.data?.pushed === 2 && s8.goi.join() === 'gia:8003:150000,gia:8004:150000' && r8.data?.boQuaDuoiSan === 2, JSON.stringify({ data: r8.data, goi: s8.goi }))
    }

    // ─── Q. SP-07 (09/11/2026): gian LỚN — soát xoay vòng, không mã nào bị bỏ mãi ────────────────────────────────
    {
        const N = 709
        // mã Shopee khác độ dài ('9993' rồi '10000'…): thứ tự SỐ — theo thứ tự chữ thì '9993' đứng cuối
        const ma = (i: number) => String(9993 + i * 7)
        const tu = (a: number, b: number) => Array.from({ length: b - a }, (_, k) => ma(a + k))
        const cungTap = (x: string[], y: string[]) => { const s = new Set(x); return x.length === y.length && s.size === x.length && y.every(v => s.has(v)) }
        const giong = (x: string[], y: string[]) => x.length === y.length && x.every((v, k) => v === y[k])
        const dongTom = (ck: any) => ck.results.find((r: any) => r.action === 'price' && /^Soát /.test(r.message || ''))?.message || ''
        const docLuot = async (c: NgCanh) => { docSongIds.length = 0; const ck = await chayChuKy(c); return { ck, ids: [...docSongIds], tom: dongTom(ck) } }
        const gianLon = () => { xoaHet(); phiTin(true); for (let i = 0; i < N; i++) themListing('chA', ma(i), `Q${i}`, 146000, 100000) }   // 146k / vốn 100k = đúng mục tiêu ⇒ không cần đổi

        gianLon()
        const khoQ = khoBoNho()
        const ctxQ: NgCanh = { prisma, kho: khoQ, nguoi: 'chu@shop', dayTon: dayTonGia }
        await luuCauHinh(ctxQ, { channelId: 'chA', executionMode: 'auto', policy: tatHet })
        const l1 = await docLuot(ctxQ)
        dung('Q1. chu kỳ 1 soát đúng 300 mã ĐẦU theo mã Shopee (thứ tự số); câu kết quả "Soát 300/709 mã (lô 1/3; vòng đủ sau 3 chu kỳ)"',
            cungTap(l1.ids, tu(0, 300)) && /Soát 300\/709 mã \(lô 1\/3; vòng đủ sau 3 chu kỳ\)/.test(l1.tom) && goi.length === 0,
            JSON.stringify({ n: l1.ids.length, dau: l1.ids.slice(0, 3), tom: l1.tom, goi }))
        // đồng bộ lại: danh mục cũ > 2 giờ ⇒ chu kỳ tự đồng bộ — upsert TUẦN TỰ đổi HẾT updatedAt, Shopee trả thứ tự khác
        for (const l of listing) { l.syncedAt = tg(3); l.updatedAt = tg(3) }
        listing.reverse()
        const l2 = await docLuot(ctxQ)
        const dongBo = l2.ck.results.find((r: any) => r.action === 'catalog')
        dung('Q2. đồng bộ lại (updatedAt đổi hết) KHÔNG đưa con trỏ về lô cũ: chu kỳ 2 soát 300 mã KẾ TIẾP, "lô 2/3"',
            dongBo?.status === 'succeeded' && cungTap(l2.ids, tu(300, 600)) && /Soát 300\/709 mã \(lô 2\/3;/.test(l2.tom),
            JSON.stringify({ dongBo, n: l2.ids.length, dau: l2.ids.slice(0, 3), tom: l2.tom }))
        await luuCauHinh(ctxQ, { policy: tatHet })   // chủ shop lưu chính sách giữa hai chu kỳ
        const l3 = await docLuot(ctxQ)
        const ca = [...l1.ids, ...l2.ids, ...l3.ids]
        dung('Q3. chu kỳ 3 soát 109 mã còn lại ("109/709", lô 3/3) — 3 chu kỳ phủ ĐỦ 709 mã, không trùng, không sót (lưu chính sách giữa chừng không reset)',
            cungTap(l3.ids, tu(600, N)) && ca.length === N && new Set(ca).size === N && /Soát 109\/709 mã \(lô 3\/3;/.test(l3.tom),
            JSON.stringify({ n: l3.ids.length, ca: ca.length, khac: new Set(ca).size, tom: l3.tom }))
        const l4 = await docLuot(ctxQ)
        dung('Q4. hết danh sách ⇒ quay về đầu (lô 1/3, đúng 300 mã đầu)', cungTap(l4.ids, tu(0, 300)) && /\(lô 1\/3;/.test(l4.tom), JSON.stringify({ n: l4.ids.length, tom: l4.tom }))
        // chạm trần ghi trong ngày ⇒ không soát gì ⇒ con trỏ ĐỨNG YÊN; đọc giá sống hỏng ⇒ cũng đứng yên
        await luuCauHinh(ctxQ, { policy: { ...tatHet, maxWritesPerDay: 1 } })
        await khoQ.ghiNhatKy({ action: 'stock', status: 'succeeded', planId: null, payload: {}, response: null })
        const l5 = await docLuot(ctxQ)
        await luuCauHinh(ctxQ, { policy: tatHet })
        docSongHong = true
        const l6 = await docLuot(ctxQ)
        docSongHong = false
        const l7 = await docLuot(ctxQ)
        dung('Q5. chạm trần ngày / đọc giá sống hỏng ⇒ con trỏ ĐỨNG YÊN, nói rõ lô soát lại; lượt sau soát đúng lô 2 (không nhảy qua lô nào)',
            l5.ids.length === 0 && l5.ck.results.some((r: any) => /Đã đủ 1 lần ghi hôm nay/.test(r.message || '') && /lô 2\/3 soát lại/.test(r.message || ''))
            && l6.ck.results.some((r: any) => r.status === 'failed' && /Không đọc được giá đang để trên Shopee/.test(r.message || '')) && cungTap(l7.ids, tu(300, 600)),
            JSON.stringify({ l5: l5.ck.results, l6: l6.ck.results.filter((r: any) => r.action === 'price'), n7: l7.ids.length, tom7: l7.tom }))
        // ghi con trỏ hỏng ⇒ KHÔNG im lặng (gian lớn kẹt mãi ở một lô = đúng lỗi cũ) — thành việc cần người
        const khoHong: KhoPilot = { ...khoQ, luuConTro: async () => { throw new Error('mất kết nối CSDL') } }
        const l8 = await docLuot({ ...ctxQ, kho: khoHong })
        const hong = l8.ck.results.find((r: any) => /Không lưu được vị trí soát giá/.test(r.message || ''))
        dung('Q6. lưu con trỏ hỏng ⇒ dòng "failed" (việc cần người), không im lặng; con trỏ cũ giữ nguyên ⇒ lượt sau soát lại lô đó',
            hong?.status === 'failed' && viecCanNguoi([hong]).dong.length === 1 && (await khoQ.docConTro('chA'))?.sau === ma(599),
            JSON.stringify({ hong, conTro: await khoQ.docConTro('chA') }))

        // mã DƯỚI SÀN ở lô khác: chu kỳ đầu đã xử lý (nghi bằng CSDL, giá sống xác nhận)
        gianLon()
        listing.find(l => l.platformProductId === ma(650))!.price = 100000                     // lô 3: giá lưu 100k, Shopee cũng 100k — dưới sàn ~127k (lỗ)
        listing.find(l => l.platformProductId === ma(400))!.price = 100000; songGia[ma(400)] = { goc: 140000 }
        // ↑ lô 2: giá lưu cũ 100k nhưng Shopee đang để 140k (trên sàn) — trong lô của nó máy sẽ nâng lên mục tiêu, NGOÀI lô thì không được đụng
        const khoN = khoBoNho()
        const ctxN: NgCanh = { prisma, kho: khoN, nguoi: 'chu@shop', dayTon: dayTonGia }
        await luuCauHinh(ctxN, { channelId: 'chA', executionMode: 'auto', policy: tatHet })
        const n1 = await docLuot(ctxN)
        dung('Q7. mã dưới sàn nằm ở LÔ 3 được nâng ngay chu kỳ đầu; câu kết quả "Soát 300/709 mã (lô 1/3; …) + 2 mã nghi dưới sàn ngoài lô"',
            goi.some(g => g.startsWith(`gia:1:${ma(650)}:`)) && n1.ids.includes(ma(650)) && /Soát 300\/709 mã \(lô 1\/3; vòng đủ sau 3 chu kỳ\) \+ 2 mã nghi dưới sàn ngoài lô/.test(n1.tom),
            JSON.stringify({ goi, tom: n1.tom }))
        dung('Q8. mã nghi ngoài lô mà giá SỐNG không dưới sàn ⇒ không đụng (chờ tới lô của mã), nói trong "Bỏ qua"',
            n1.ids.includes(ma(400)) && !goi.some(g => g.startsWith(`gia:1:${ma(400)}:`)) && goi.length === 1 && /1 mã nghi ngoài lô không còn dưới sàn/.test(n1.tom),
            JSON.stringify({ goi, tom: n1.tom }))

        // GET /state: phân trang + tìm phía máy chủ
        listing.find(l => l.platformProductId === ma(5))!.name = 'Bình giữ nhiệt Đỏ 500ml'
        const maCuaTrang = (x: any) => x.products.filter((p: any) => p.itemId).map((p: any) => String(p.itemId))
        const giam = tu(0, N).sort((a, b) => soThuTuMa(b, a))
        const st = await xayTrangThai(ctxN)
        dung('Q9. GET /state không tham số: trang đầu 100 listing, cùng hình dữ liệu cũ (+ tong 709), câu "709 sản phẩm trên gian (đang hiện 100)"',
            st.products.length === 100 && st.tong === N && giong(maCuaTrang(st), giam.slice(0, 100)) && /709 sản phẩm trên gian \(đang hiện 100\)/.test(st.catalogNote || '')
            && !!st.status?.feeModel && Array.isArray(st.plans) && st.products.every((p: any) => p.pricing && 'currentPrice' in p),
            JSON.stringify({ n: st.products.length, tong: st.tong, note: st.catalogNote }))
        let tai = maCuaTrang(st), vong = 0
        while (tai.length < st.tong && vong++ < 10) tai = tai.concat(maCuaTrang(await xayTrangThai(ctxN, { offset: tai.length, lim: 200 })))
        dung('Q10. "Tải thêm" (offset / lim) tới hết: đủ 709 mã, không trùng, thứ tự ổn định', tai.length === N && new Set(tai).size === N && giong(tai, giam), JSON.stringify({ n: tai.length, khac: new Set(tai).size }))
        const t1 = await xayTrangThai(ctxN, { q: ma(123) }), t2 = await xayTrangThai(ctxN, { q: 'q12' }), t3 = await xayTrangThai(ctxN, { q: 'binh giu nhiet do' })
        dung('Q11. tìm phía máy chủ: item_id / mã (không phân biệt hoa thường) / tên KHÔNG DẤU — tong theo kết quả tìm',
            t1.tong === 1 && maCuaTrang(t1)[0] === ma(123) && t2.tong === 11 && t3.tong === 1 && maCuaTrang(t3)[0] === ma(5) && /khớp "binh giu nhiet do"/.test(t3.catalogNote || ''),
            JSON.stringify({ t1: [t1.tong, maCuaTrang(t1)], t2: t2.tong, t3: [t3.tong, t3.catalogNote] }))

        // khoSql (bản chạy thật): lưu cấu hình phải GIỮ con trỏ trong cột schedule; ghi con trỏ chỉ đụng schedule.conTro[gian]
        const cau: { sql: string; v: any[] }[] = []
        let lich = JSON.stringify({ enabled: true, intervalMinutes: 60, conTro: { chA: { sau: '10500', luc: 1 } } })
        const pz: any = {
            $executeRawUnsafe: async (sql: string, ...v: any[]) => { cau.push({ sql, v }); if (/INSERT INTO "ShopeePilotConfig" \(id, "channelId"/.test(sql)) lich = v[4]; return 1 },
            $queryRawUnsafe: async (sql: string) => (/SELECT schedule FROM "ShopeePilotConfig"/.test(sql) ? [{ schedule: lich }] : []),
        }
        const kSql = khoSql(pz)
        await kSql.luuCauHinh({ channelId: 'chA', executionMode: 'auto', policy: {} as any, profiles: [], schedule: { enabled: false, intervalMinutes: 180 }, nextRunAt: null, updatedAt: 0, lastRunAt: null, lastResult: null })
        const sauLuu = JSON.parse(lich)
        const ctSql = await kSql.docConTro('chA')
        await kSql.luuConTro('chB', { sau: '777', luc: 2 })
        const ghiCt = cau.find(c => /jsonb_set/.test(c.sql))
        dung('Q12. khoSql: lưu cấu hình GIỮ con trỏ (lịch theo người sửa, con trỏ còn nguyên); ghi con trỏ MỘT gian bằng jsonb_set, không đụng chế độ / chính sách',
            sauLuu.enabled === false && sauLuu.intervalMinutes === 180 && sauLuu.conTro?.chA?.sau === '10500' && ctSql?.sau === '10500'
            && !!ghiCt && ghiCt.v[0] === 'chB' && JSON.parse(ghiCt.v[1]).sau === '777' && !/"executionMode"|policy/.test(ghiCt.sql),
            JSON.stringify({ sauLuu, ctSql, ghiCt }))
    }

    // ─── R. X-14 (10/11/2026): sổ ĐỔI CẤU HÌNH — ai đổi, đổi gì; không ăn trần ghi / ngày ─────────────────────
    {
        const ds1 = soCauHinh(
            { executionMode: 'preview', policy: { targetMarginRate: 0.1 + 0.2, maxWritesPerDay: 50, truongMoi: 1 }, schedule: { enabled: false, intervalMinutes: 180, conTro: { chA: { sau: '1' } } }, nextRunAt: 1 },
            { executionMode: 'auto', policy: { targetMarginRate: 30 / 100, maxWritesPerDay: 200, truongMoi: 2 }, schedule: { enabled: false, intervalMinutes: 180, allChannels: false }, nextRunAt: 2 },
            NHAN_SHOPEE)
        dung('R1. so cấu hình: 0,1+0,2 lưu ↔ 30/100 gửi lại = KHÔNG đổi; allChannels vắng = tắt; con trỏ / lượt kế (máy ghi) bỏ qua; xếp theo nhãn, trường lạ sau cùng',
            JSON.stringify(ds1.map(d => d.truong)) === '["executionMode","policy.maxWritesPerDay","policy.truongMoi"]', JSON.stringify(ds1))
        const t2 = tomTatDoiCauHinh(soCauHinh(
            { mode: 'preview', policy: { dailyBudgetCap: 0, automation: { scaleWinners: false }, minMarginPct: 20 }, schedule: { enabled: false } },
            { mode: 'auto', policy: { dailyBudgetCap: 300000, automation: { scaleWinners: true }, minMarginPct: 25 }, schedule: { enabled: true } }, NHAN_ADS), NHAN_ADS)
        dung('R2. câu tóm tắt: đúng chữ trên trang + đơn vị (tiền 300.000đ, %, bật/tắt, chế độ tiếng Việt), theo thứ tự nhãn',
            t2 === 'Chế độ: Xem trước → Tự động; Trần ngân sách/ngày cho TẤT CẢ quảng cáo Pilot: 0đ → 300.000đ; Tăng ngân sách quảng cáo tốt: tắt → bật; Máy tự đẩy khi lãi gộp từ: 20% → 25%; Chạy theo lịch trên máy chủ: tắt → bật', t2)

        xoaHet()
        const khoS = khoBoNho()
        const ctxS: NgCanh = { prisma, kho: khoS, nguoi: 'nv@shop' }
        await luuCauHinh(ctxS, { channelId: 'chA', executionMode: 'auto', policy: { maxWritesPerDay: 200, targetMarginRate: 0.2 }, schedule: { enabled: true, intervalMinutes: 60 } })
        const dongS = khoS._nhatKy.filter(w => w.action === 'config')
        dung('R3. Shopee: lưu chính sách ⇒ MỘT dòng sổ "config" mang người đổi + từng thay đổi (gian theo TÊN, chế độ, lịch, trần ghi, lãi)',
            dongS.length === 1 && dongS[0].payload.actor === 'nv@shop' && dongS[0].status === 'succeeded' && dongS[0].planId === null
            && dongS[0].payload.tomTat === 'Chế độ thực thi: Xem trước → Tự động; Gian Shopee Pilot quản: trống → Gian A; Chạy theo lịch trên máy chủ: tắt → bật; Chạy theo lịch mỗi: 180 phút → 60 phút; Thao tác ghi mỗi ngày: 50 → 200; Lãi mục tiêu: 15% → 20%'
            && dongS[0].payload.thayDoi.some((d: any) => d.truong === 'policy.maxWritesPerDay' && d.cu === 50 && d.moi === 200), JSON.stringify(dongS))
        dung('R4. dòng "config" KHÔNG tính vào trần ghi / ngày', (await khoS.demGhiTuLuc(0)) === 0 && khoS._nhatKy.length === 1)
        const cS = (await khoS.docCauHinh())!
        const pct = (v: number) => Math.round(v * 1000) / 10
        await luuCauHinh(ctxS, {
            channelId: 'chA', executionMode: 'auto', schedule: { ...cS.schedule },
            policy: Object.fromEntries(Object.entries(cS.policy).map(([k, v]) => [k, typeof v === 'number' && /Rate$/.test(k) ? pct(v) / 100 : v])),
        })
        dung('R5. lưu lại y nguyên như trang gửi (% ÷ 100) ⇒ không thêm dòng', khoS._nhatKy.filter(w => w.action === 'config').length === 1, JSON.stringify(khoS._nhatKy.slice(1)))
        const khoHong = khoBoNho()
        khoHong.ghiNhatKy = async () => { throw new Error('mất kết nối CSDL') }
        const loiGoc = console.error
        let baoLoi = ''
        console.error = (...a: any[]) => { baoLoi += a.map(String).join(' ') }
        let r6: any = null
        try { r6 = await luuCauHinh({ prisma, kho: khoHong, nguoi: 'nv@shop' }, { executionMode: 'auto' }) } catch (e) { r6 = e } finally { console.error = loiGoc }
        dung('R6. ghi sổ đổi cấu hình hỏng ⇒ cấu hình VẪN lưu, người bấm không thấy lỗi giả, log máy chủ có dấu (không nuốt im)',
            r6?.executionMode === 'auto' && (await khoHong.docCauHinh())?.executionMode === 'auto' && /ghi sổ đổi cấu hình hỏng/.test(baoLoi) && /nv@shop/.test(baoLoi), baoLoi || String(r6))

        const khoT2 = khoBoNhoTikTok()
        await luuCauHinhTikTok({ prisma, kho: khoT2, nguoi: 'nv@shop', taoTikTok: ttGia, dayTon: dayTonGia } as any, { channelId: 'chT', policy: { maxRepricePerCycle: 25 } })
        const dT = khoT2._nhatKy.filter(w => w.action === 'config')
        dung('R7. TikTok: đổi trần đổi giá / chu kỳ ⇒ dòng "config", gian theo TÊN; không tính trần ghi / ngày',
            dT.length === 1 && dT[0].payload.actor === 'nv@shop' && /^Gian TikTok Pilot quản: trống → TikTok Shop; Đổi giá tối đa mỗi chu kỳ \(sản phẩm\): \d+ → 25$/.test(dT[0].payload.tomTat)
            && (await khoT2.demGhiTuLuc(0)) === 0, JSON.stringify(dT))

        fbPages = [{ pageId: 'pg1', name: 'Trang A', status: 'active', accessToken: 'x', tokenExpiresAt: null, createdAt: new Date(0) }]
        const khoF2 = khoBoNhoFb()
        await luuCauHinhFb({ prisma, kho: khoF2, nguoi: 'nv@shop' } as any, { pageId: 'pg1', policy: { postHours: [9, 20], automation: { replyPriceQuestions: true } } })
        const dF = khoF2._nhatKy.filter(w => w.action === 'config')
        dung('R8. Facebook: fanpage theo TÊN, khung giờ "mặc định → 9h, 20h", công tắc tắt → bật; không tính trần ghi / ngày',
            dF.length === 1 && dF[0].payload.tomTat === 'Fanpage Pilot quản: trống → Trang A; Tự trả lời câu hỏi giá: tắt → bật; Khung giờ đăng: mặc định → 9h, 20h'
            && (await khoF2.demGhiTuLuc(0)) === 0, JSON.stringify(dF))

        const khoA = khoBoNhoAds()
        await luuCauHinhAds({ prisma, kho: khoA, nguoi: 'nv@shop' } as any, { mode: 'auto', policy: { dailyBudgetCap: 300000, automation: { scaleWinners: true } } })
        const dA = khoA._nhatKy.filter(w => w.action === 'config')
        dung('R9. Ads Pilot: bật Tự động + nâng trần ngân sách (tiền thật) ⇒ dòng "config" ghi rõ người + số tiền; không tính trần thao tác / ngày',
            dA.length === 1 && dA[0].payload.actor === 'nv@shop'
            && dA[0].payload.tomTat === 'Chế độ: Xem trước → Tự động; Trần ngân sách/ngày cho TẤT CẢ quảng cáo Pilot: 0đ → 300.000đ; Tăng ngân sách quảng cáo tốt: tắt → bật'
            && (await khoA.demGhiTuLuc(0)) === 0, JSON.stringify(dA))

        const thieuLoai = [['shopeePilot', 'ShopeePilotWrite'], ['tiktokPilot', 'TikTokPilotWrite'], ['facebookPilot', 'FacebookPilotWrite'], ['facebookAdsPilot', 'FacebookAdsPilotWrite']].filter(([f, bang]) => {
            const s = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', `${f}.ts`), 'utf8')
            return !s.includes(`SELECT COUNT(*)::int AS n FROM "${bang}" WHERE "createdAt" >= $1 AND action <> 'config'`)
        })
        dung('R10. cả 4 kho SQL: đếm trần ghi / ngày loại dòng "config"', !thieuLoai.length, thieuLoai.join(', '))
    }

    console.log(loi ? `❌ ${dat} đạt, ${loi} hỏng` : `✅ ${dat} đạt, 0 hỏng — Pilot tự động hoàn toàn: báo người, cầu dao, giá sống, nháp, nhiều gian; đẩy tay: tồn Shopee, cầu dao chung, rào giá sàn`)
    process.exit(loi ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(1) })
