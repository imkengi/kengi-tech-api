/* ═══════════════════════════════════════════════════════════════════════════════
 *  BỘ KIỂM "TỰ ĐỘNG HOÀN TOÀN" của Pilot (03/11/2026)
 *
 *  Bài chạy thử chu kỳ THẬT trên dữ liệu KENGISTORE (chỉ đọc, sàn giả) cho thấy những chỗ máy phải chờ người hoặc
 *  làm sai mà không ai biết. Mỗi mục dưới đây canh một chỗ đã vá:
 *    A. báo chủ shop (lib/pilotBaoChuShop): việc cần người, chống lặp theo dấu, giãn 3 giờ, chu kỳ gãy báo ngay
 *    B. cầu dao đẩy tồn: nhiều mã đang có hàng về 0 ⇒ không đẩy (TikTok 117 mã về 0 vì hàng ở kho HUTI, kho mẹ tắt)
 *    C. Shopee giá SỐNG: quyết theo giá GỐC trên Shopee (bản lưu cũ / là giá KM), né KM đang / sắp chạy, phân loại;
 *       đọc hỏng ⇒ không đổi; thực thi tự động đọc hỏng ⇒ không ghi mù
 *    D. nháp chờ duyệt không ăn trần (10 nháp từng chiếm trọn chỗ); không lập trùng; quá hạn tự huỷ; người huỷ ⇒
 *       14 ngày không đề xuất lại; lượt thực thi kẹt ⇒ 'uncertain'
 *    E. Xem trước → Tự động: nháp xem trước bị huỷ, lập lại và ghi ngay trong ngày (khoá riêng)
 *    F. danh mục cũ > 2 giờ ⇒ tự đồng bộ (trước chỉ khi có người bấm "Đồng bộ")
 *    G. nhiều gian Shopee: lịch chạy mọi gian, kế hoạch mang gian, thực thi đúng gian
 *    H. lịch Tự động báo chủ shop đúng một lần; Xem trước không báo; Facebook gãy báo ngay
 *    I. TikTok: nháp không ăn trần, không trùng, người huỷ, cầu dao
 *    J. ĐỐI CHỨNG: ngành chưa đo ⇒ không tự hạ dù ngành đắt nhất đã đo vẫn lãi (ngành chưa đo có thể đắt hơn)
 *    K. chạm trần thao tác ghi / ngày khi đẩy tồn ⇒ bỏ qua, không phải hỏng
 *    L. CHƯA BIẾT PHÍ sàn (09/11/2026, chủ shop: "xem phí phải ghi rõ ra không thể mượn được"): gian chưa đủ đơn đối soát, ô phí
 *       còn 6% mặc định ⇒ chu kỳ Shopee / TikTok không ghi gì, MỘT dòng lý do kèm đường khai phí, lịch báo chủ shop đúng một
 *       lần; khai phí xong thì chạy lại. (D, H, I: "phí chưa đủ tin" giờ là gian ĐÃ khai phí 20% mà chưa đủ đơn để đo.)
 *  Chạy: npm run check:pilot-tu-dong
 * ═══════════════════════════════════════════════════════════════════════════════ */

import { ShopeeService } from '../src/services/platforms/shopee'
import { chayChuKy, chayTheoLich, khoBoNho, luuCauHinh, taoKeHoachGia, thucThi, huyKeHoach, cauDaoTon, dayTonChuKy, type NgCanh } from '../src/lib/shopeePilot'
import { viecCanNguoi, baoChuShop, GIAN_CACH_BAO_MS } from '../src/lib/pilotBaoChuShop'
import { xoaDemPhiTheoNganh } from '../src/lib/shopeeTuQuan'
import { chayChuKyTikTok, chayTheoLichTikTok, khoBoNhoTikTok, luuCauHinhTikTok, huyKeHoachTikTok } from '../src/lib/tiktokPilot'
import { chayTheoLichFb, khoBoNhoFb, luuCauHinhFb } from '../src/lib/facebookPilot'

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

const prisma: any = {
    onlineChannel: { findMany: async ({ where }: any = {}) => kenh.filter(c => !where?.platform || c.platform === where.platform), update: async () => ({}) },
    onlineProduct: {
        findMany: async ({ where }: any) => listing.filter(l => l.channelId === where.channelId
            && (!where.status || (typeof where.status === 'string' ? l.status === where.status : where.status.in.includes(l.status)))),
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
            if (cu) { Object.assign(cu, q.update); return cu }
            listing.push({ ...q.create, id: `l-moi-${listing.length}` }); return q.create
        },
        count: async () => listing.length,
    },
    product: { findFirst: async () => null, findMany: async () => [] },
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
const P = ShopeeService.prototype as any
P.refreshAccessToken = async () => { throw new Error('bộ kiểm không cho làm mới token') }
P.getItemBaseInfo = async function (ids: number[]) {
    soLanDocSong++
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

    console.log(loi ? `❌ ${dat} đạt, ${loi} hỏng` : `✅ ${dat} đạt, 0 hỏng — Pilot tự động hoàn toàn: báo người, cầu dao, giá sống, nháp, nhiều gian`)
    process.exit(loi ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(1) })
