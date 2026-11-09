/* Kiểm chứng TIKTOK PILOT (02/11/2026) — npx tsx scripts/check-tiktok-pilot.ts
 *
 * Kho kế hoạch trong bộ nhớ + prisma giả (theo `select`) + TikTok giả ghi lại mọi lời gọi + đồng hồ giả. Canh:
 *  1. Chính sách: phần chung kẹp như Shopee Pilot, mặc định đổi giá BẬT / đẩy tồn TẮT.
 *  2. Trạng thái: tự chọn gian TikTok duy nhất, Xem trước; giá đề xuất / giá sàn theo PHÍ TIKTOK đo từ đơn (cùng công thức
 *     Shopee Pilot); listing chưa nối mã kho / không đang bán / nhiều SKU thì không đổi giá; hàng kho chưa có trên gian.
 *  3. Phí: CHỈ số đo của chính gian (09/11/2026, chủ shop: "xem phí phải ghi rõ ra không thể mượn được" — bỏ mượn số đo
 *     gian khác, cả TikTok lẫn Shopee). Gian chưa đủ 8 đơn đối soát: ô «Phí sàn (%)» đã khai ⇒ phí KHAI (người duyệt được,
 *     máy không tự hạ); còn 6% mặc định / 0 ⇒ CHƯA BIẾT PHÍ: không giá nào tính / ghi được — trạng thái, kế hoạch, chu kỳ
 *     (MỘT dòng lý do, đẩy tồn vẫn chạy), thực thi kế hoạch cũ. Trạng thái: declared / unknown / scope / detail, hết borrowed.
 *     Phí theo NGÀNH (02/11/2026): mỗi sản phẩm tính theo phí ngành của nó; ngành chưa đủ đơn ⇒ phí cả gian, máy không tự hạ.
 *  4. Kế hoạch giá: dưới sàn / vượt biên độ so với giá ĐỌC THẲNG TikTok bị chặn; hàng nhiều SKU bị chặn; khoá idempotency.
 *  5. Thực thi: Xem trước KHÔNG gọi TikTok; Tự động gọi đúng một lần (cả khi hai tab bấm cùng lúc), đúng SKU;
 *     giá TikTok đổi / SKU đổi / mất giá vốn lúc thực thi ⇒ không ghi; mất mạng ⇒ 'uncertain'; trần ghi / ngày.
 *  6. Chu kỳ: Xem trước chỉ lập nháp + đẩy tồn chạy thử; Tự động tăng giá được, HẠ giá khi phí chưa đủ tin ⇒ chờ duyệt;
 *     hàng nhiều SKU nhớ 24 giờ (không hỏi lại TikTok); trần sản phẩm mỗi chu kỳ.
 *  7. Chạy theo lịch: chưa tới hẹn thì thôi; tới hẹn thì một bản giành, chạy, hẹn lượt kế.
 *  8. Tiện ích tiktok_pilot chỉ-quản-trị.
 *  9. Nối dây (soát mã nguồn).
 *  L. Lô 3 (09/11/2026) — quyết theo giá THẬT, không báo động giả, không giành giá người sửa:
 *     L1 giá sống = số DƯƠNG đầu tiên, giá 0 / đọc hỏng ⇒ không đổi; chu kỳ quyết theo giá sống (lô), không theo giá lưu.
 *     L2 trần ghi/ngày tính TRƯỚC vòng lặp ⇒ MỘT dòng 'skipped', không 'failed', không việc cần người, không nháp sót.
 *     L3 nghỉ 24 giờ tính từ lúc THỰC THI.   L4 đồng bộ danh mục lấy ngành mã mới, một mã lỗi không dừng lượt.
 *     L5 giá chủ shop sửa tay ⇒ để yên 7 ngày.   L6 TikTok khoá giá vì khuyến mãi ⇒ 'skipped' + nghỉ 24 giờ.
 *     L7 làm mới token hỏng / mã 105005·106011·106001 ⇒ MỘT dòng 'token', không ghi gì lượt đó.
 *  A. (10/11/2026, TT-02) hoa hồng affiliate TikTok đọc từ statement từng đơn: "0" thật ≠ không có trường (null); hoa hồng gộp
 *     trước thuế TNCN không cộng đôi; điều chỉnh bù trừ có dấu; mô hình phí tách affiliate, giá sàn theo hoa hồng cao nhất đo.
 */
import * as fs from 'fs'
import * as path from 'path'
import {
    khoBoNhoTikTok, chuanHoaChinhSachTikTok, xayTrangThaiTikTok, taoKeHoachGiaTikTok, thucThiTikTok, chayChuKyTikTok,
    luuCauHinhTikTok, huyKeHoachTikTok, chayTheoLichTikTok, kiemKetNoiTikTok, LoiNhieuSku, type NgCanhTikTok, type DichVuTikTok,
    giaSkuTikTok, laLoiKhoaGiaKhuyenMai, laLoiTokenTikTok, boSungNganhTikTok,
} from '../src/lib/tiktokPilot'
import { TikTokService, hoaHongAffiliateTikTok } from '../src/services/platforms/tiktok'
import { docMauPhi, xoaDemPhiTheoNganh, tomTatMauPhi } from '../src/lib/shopeeTuQuan'
import { tinhGiaDeXuat, lyDoPhiChuaDuTin, chanGiaDuoiSan, uocLuongPhi, type MauPhi, type ThamSoGia } from '../src/lib/giaShopee'
import { viecCanNguoi } from '../src/lib/pilotBaoChuShop'
import { dauNgayVN } from '../src/lib/shopeePilot'
import { ToolError } from '../src/lib/mcpTypes'
import { lyDoChanPilot, datDemTienIch, giuTienIchQuanTri, TIEN_ICH_TIKTOK_PILOT } from '../src/lib/tienIchCuaHang'
import { buHoaHongAffiliate } from '../src/cron/autoSync'
import { mapWithConcurrency } from '../src/lib/prisma'

let loi = 0, dat = 0
const dung = (ten: string, ok: boolean, chiTiet = '') => { ok ? dat++ : loi++; console.log(`${ok ? '✓' : '✗'} ${ten}${chiTiet && !ok ? ' — ' + chiTiet : ''}`) }
const nem = async (f: () => Promise<any>) => { try { await f(); return null } catch (e: any) { return e } }

const NOW = dauNgayVN(Date.now()) + 9 * 3600_000
let bayGio = NOW

function chon(o: any, sel: any): any {
    if (!o) return o
    if (!sel) return { ...o }
    const ra: any = {}
    for (const [k, v] of Object.entries(sel)) {
        if (!v) continue
        const g = o[k]
        if (v && typeof v === 'object' && (v as any).select) ra[k] = Array.isArray(g) ? g.map((x: any) => chon(x, (v as any).select)) : g
        else ra[k] = g
    }
    return ra
}

/* ── Dữ liệu ── */
let kenh: any[] = []
let listing: any[] = []
let hang: any[] = []
let donPhi: Record<string, { giaBan: number; phi: number }[]> = {}
/** mã gian của mỗi lần đọc phí cả gian (dongPhi) — canh "KHÔNG đọc đơn của gian khác" (09/11/2026, bỏ mượn số đo) */
const hoiPhi: string[][] = []
/** đơn MỘT ngành theo gian (truy vấn phí theo ngành); null = mọi đơn của gian thuộc ngành 601 như listing */
let donNganh: Record<string, (any & { nganh: string })[]> | null = null
/** dòng số bán 14 ngày: kiểu cũ { sku, sl } hoặc { loai: 'sku' | 'hang' | 'ma', khoa, sl } (lib/shopeeThaoTac.soBan14Ngay, TT-18) */
let daBan: any[] = []
/** đọc số bán 14 ngày hỏng (TT-18, 10/11/2026) */
let loiDaBan = false
function datLai(soDon = 40) {
    loiDaBan = false
    kenh = [
        { id: 'tt1', name: 'Kengi TikTok', platform: 'tiktok', shopId: '7001', accessToken: 'tok', refreshToken: 'r', apiKey: 'k', apiSecret: 's', commissionRate: 6, tokenExpiresAt: new Date(NOW + 3 * 86400_000), createdAt: new Date(1) },
        { id: 'sp1', name: 'Kengi Shopee', platform: 'shopee', shopId: '8001', accessToken: 'tok', commissionRate: 6, createdAt: new Date(0) },
    ]
    listing = [
        { id: 'op1', channelId: 'tt1', categoryId: '601', platformProductId: '111', name: 'Ổ cắm điện 4 lỗ', sku: 'OC4', price: 120000, stock: 12, status: 'ACTIVATE', localProductId: 'p1', imageUrl: null, updatedAt: new Date(5) },
        { id: 'op2', channelId: 'tt1', categoryId: '601', platformProductId: '222', name: 'Bình giữ nhiệt', sku: 'BINH', price: 160000, stock: 30, status: 'ACTIVATE', localProductId: 'p2', imageUrl: null, updatedAt: new Date(4) },
        { id: 'op3', channelId: 'tt1', categoryId: '601', platformProductId: '333', name: 'Áo thun nhiều size', sku: 'AO', price: 90000, stock: 50, status: 'ACTIVATE', localProductId: 'p3', imageUrl: null, updatedAt: new Date(3) },
        { id: 'op4', channelId: 'tt1', categoryId: '601', platformProductId: '444', name: 'Hàng chưa nối', sku: 'XYZ', price: 50000, stock: 5, status: 'ACTIVATE', localProductId: null, imageUrl: null, updatedAt: new Date(2) },
        { id: 'op5', channelId: 'tt1', categoryId: '601', platformProductId: '555', name: 'Hàng đang ẩn', sku: 'OC4B', price: 100000, stock: 5, status: 'SELLER_DEACTIVATED', localProductId: 'p5', imageUrl: null, updatedAt: new Date(1) },
    ]
    hang = [
        { id: 'p1', sku: 'OC4', name: 'Ổ cắm điện 4 lỗ', description: 'x', costPrice: 100000, sellingPrice: 189000, stock: 12, productType: 'goods', mergedIntoId: null, bundleId: null, category: { name: 'Điện' }, _count: { images: 1 }, images: [{ url: 'https://a/1.jpg' }] },
        { id: 'p2', sku: 'BINH', name: 'Bình giữ nhiệt', description: 'x', costPrice: 50000, sellingPrice: 129000, stock: 30, productType: 'goods', mergedIntoId: null, bundleId: null, category: { name: 'Gia dụng' }, _count: { images: 1 }, images: [{ url: 'https://a/2.jpg' }] },
        { id: 'p3', sku: 'AO', name: 'Áo thun', description: 'x', costPrice: 40000, sellingPrice: 99000, stock: 50, productType: 'goods', mergedIntoId: null, bundleId: null, category: { name: 'Thời trang' }, _count: { images: 1 }, images: [{ url: 'https://a/3.jpg' }] },
        { id: 'p5', sku: 'OC4B', name: 'Ổ cắm B', description: 'x', costPrice: 80000, sellingPrice: 150000, stock: 5, productType: 'goods', mergedIntoId: null, bundleId: null, category: { name: 'Điện' }, _count: { images: 1 }, images: [] },
        { id: 'p6', sku: 'TUI', name: 'Túi tote canvas', description: 'Túi vải canvas dày, quai dài 60cm, may viền chắc chắn, dùng đi chợ.', costPrice: 45000, sellingPrice: 99000, stock: 60, productType: 'goods', mergedIntoId: null, bundleId: null, category: { name: 'Gia dụng' }, _count: { images: 2 }, images: [{ url: 'https://a/6.jpg' }] },
    ]
    // phí 14% + 3.000đ mỗi đơn — cùng số liệu bộ kiểm Shopee Pilot ⇒ cùng giá đề xuất / giá sàn
    donPhi = { tt1: Array.from({ length: soDon }, (_, i) => { const g = 60000 + i * 10000; return { giaBan: g, phi: 0.14 * g + 3000 } }) }
    daBan = [{ sku: 'oc4', sl: 5 }]
    donNganh = null
    xoaDemPhiTheoNganh()
}

const prisma: any = {
    onlineChannel: {
        findMany: async ({ where, select }: any) => kenh.filter(c => (!where?.platform || c.platform === where.platform) && (!where?.id?.not || c.id !== where.id.not))
            .sort((a, b) => a.createdAt - b.createdAt).map(c => chon(c, select)),
        update: async () => ({}),
    },
    onlineProduct: {
        // `categoryId: null` (mã còn thiếu ngành — lib/tiktokPilot.boSungNganhTikTok, 09/11/2026) chỉ lọc khi có trong where
        findMany: async ({ where, select, take }: any) => listing.filter(l => l.channelId === where.channelId && (!where.status?.in || where.status.in.includes(l.status))
            && (!('categoryId' in where) || (where.categoryId === null ? l.categoryId == null : l.categoryId === where.categoryId)))
            .sort((a, b) => b.updatedAt - a.updatedAt).slice(0, take ?? 1e9).map(l => chon(l, select)),
        // đồng bộ danh mục (lib/shopeeTuQuan.luuDanhMucSan) — đóng dấu theo đồng hồ giả
        upsert: async ({ where, create, update }: any) => {
            const k = where.channelId_platformProductId
            const l = listing.find(x => x.channelId === k.channelId && x.platformProductId === k.platformProductId)
            if (l) { Object.assign(l, update, { syncedAt: new Date(bayGio) }); return l }
            const moi = { id: `op-${k.platformProductId}`, localProductId: null, updatedAt: new Date(bayGio), ...create, syncedAt: new Date(bayGio) }
            listing.push(moi)
            return moi
        },
        findFirst: async ({ where }: any) => listing.find(l => l.channelId === where.channelId
            && (!where.platformProductId || l.platformProductId === where.platformProductId)
            && (!where.sku || String(l.sku).toLowerCase() === String(where.sku.equals).toLowerCase())
            && (!where.status?.in || where.status.in.includes(l.status))) || null,
        update: async ({ where, data }: any) => { const l = listing.find(x => x.id === where.id); Object.assign(l, data); return l },
        count: async ({ where }: any) => listing.filter(l => l.channelId === where.channelId).length,
    },
    onlineOrder: { findFirst: async () => ({ externalOrderId: 'TT-ORDER-1' }) },
    product: {
        findMany: async ({ where, select, take }: any) => hang.filter(h => h.productType === 'goods' && !h.mergedIntoId && !h.bundleId && (!where?.stock?.gt === undefined || h.stock > (where?.stock?.gt ?? -1e9)))
            .sort((a, b) => b.stock - a.stock).slice(0, take ?? 1e9).map(h => chon(h, select)),
    },
    skuMapping: { findMany: async () => [] },
    storeSettings: { findFirst: async ({ select }: any = {}) => chon({ businessType: 'household', khoMeMa: null }, select) },
    $queryRawUnsafe: async (sql: string, ...v: any[]) => {
        if (sql.includes('AS nganh')) return donNganh ? (donNganh[v[0]] || []) : (donPhi[v[0]] || []).map(d => ({ ...d, nganh: '601' }))
        if (sql.includes('"OnlineOrder" o') && sql.includes('platformFee')) { hoiPhi.push([...(v[0] as string[])]); return (v[0] as string[]).flatMap(id => donPhi[id] || []) }
        if (sql.includes('"OnlineOrderItem"')) {
            if (loiDaBan) throw new Error('Connection terminated unexpectedly')
            return daBan.map(d => ({ ...d }))
        }
        if (sql.includes('FROM "Product"')) {
            const ids: string[] = v[0] || [], skus: string[] = v[1] || []
            return hang.filter(h => ids.includes(h.id) || skus.includes(h.sku.toLowerCase()))
                .map(h => ({ id: h.id, sku: h.sku, name: h.name, description: h.description, costPrice: h.costPrice, mergedIntoId: null, mergedRate: 1 }))
        }
        return []
    },
}

/* ── TikTok giả ── */
const goi: any[] = []
/** chi tiết sản phẩm TikTok theo mã; một Error ⇒ đọc mã đó hỏng (09/11/2026) */
let chiTiet: Record<string, any> = {}
let loiGia: any = null
/** lỗi đổi giá RIÊNG từng mã (khuyến mãi khoá giá, token…) — 09/11/2026 */
let loiGiaMa: Record<string, any> = {}
/** đổi giá thành công thì giá sống trên TikTok giả đổi theo (ca nghỉ 24 giờ / giá người sửa) — mặc định tắt như trước */
let giaSongTheoGhi = false
/** chạy sau mỗi lần ghi giá thành công (ca "lượt khác vừa ghi giữa chừng") */
let sauGhiGia: (() => Promise<void>) | null = null
const giaTT = (gia: number, id = 'sku') => ({ skus: [{ id, seller_sku: 'x', price: { tax_exclusive_price: String(gia) } }] })
function datTikTok() {
    chiTiet = { '111': giaTT(120000, 'sku111'), '222': giaTT(160000, 'sku222'), '333': { skus: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }, '555': giaTT(100000, 'sku555') }
    loiGiaMa = {}; giaSongTheoGhi = false; sauGhiGia = null
}
const ttGia = async (): Promise<DichVuTikTok> => ({
    testConnection: async () => ({ success: true, shopName: 'Kengi TikTok' }),
    getProductDetail: async (id: string) => { goi.push(['detail', id]); const d = chiTiet[id]; if (d instanceof Error) throw d; return d || { skus: [] } },
    updatePrice: async (id: string, gia: number, skuId?: string) => {
        goi.push(['price', id, gia, skuId])
        if (loiGia) throw loiGia
        if (loiGiaMa[id]) throw loiGiaMa[id]
        if (giaSongTheoGhi) chiTiet[id] = giaTT(gia, skuId || 'sku')
        if (sauGhiGia) await sauGhiGia()
    },
    getOrderSettlement: async () => ({ settlementAmount: 100000, feeAmount: 15000, revenueAmount: 115000 }),
})
const daySo: any[] = []
const dayTonGia = async (_p: any, channelId: string, o: { dryRun?: boolean }) => { daySo.push({ channelId, ...o }); return o.dryRun ? { ok: true, data: { seDay: 3, seBoQua: 7 } } : { ok: true, data: { pushed: 3, skipped: 7, failed: 0 } } }
const ghiTT = () => goi.filter(g => g[0] === 'price')

function ngCanh(kho = khoBoNhoTikTok()): NgCanhTikTok & { kho: ReturnType<typeof khoBoNhoTikTok> } {
    return { prisma, kho, nguoi: 'chu@shop', taoTikTok: ttGia, dayTon: dayTonGia, bayGio: () => bayGio } as any
}

async function main() {
    datLai(); datTikTok()
    // ─── 1. Chính sách ───────────────────────────────────────────────────────────
    {
        const c = chuanHoaChinhSachTikTok({ targetMarginRate: 0.02, minMarginRate: 0.08, maxWritesPerDay: -5, maxRepricePerCycle: 99, automation: { syncStock: true } })
        dung('1a. mục tiêu không dưới biên tối thiểu, số âm kẹp (như Shopee Pilot)', c.targetMarginRate === 0.08 && c.maxWritesPerDay === 1)
        dung('1b. đổi giá mỗi chu kỳ ≤ 50; bật đẩy tồn giữ, đổi giá mặc định bật', c.maxRepricePerCycle === 50 && c.automation.syncStock === true && c.automation.reprice === true)
        const m = chuanHoaChinhSachTikTok({})
        dung('1c. mặc định: đẩy tồn TẮT, sàn 5%, mục tiêu 15%, biên độ 10%', m.automation.syncStock === false && m.minMarginRate === 0.05 && m.targetMarginRate === 0.15 && m.maxPriceChangeRate === 0.1)
    }

    // ─── 2. Trạng thái ───────────────────────────────────────────────────────────
    {
        const st = await xayTrangThaiTikTok(ngCanh())
        const sp = (id: string) => st.products.find((p: any) => p.itemId === id)
        dung('2a. tự chọn gian TikTok duy nhất (bỏ qua gian Shopee), mặc định Xem trước', st.status.shop?.id === 'tt1' && st.status.executionMode === 'preview' && st.status.channels.length === 1)
        dung('2b. giá đề xuất / sàn theo phí TikTok đo được (14% + 3.000đ ⇒ 146.000 / 127.200)', sp('111')?.pricing.price === 146000 && sp('111')?.pricing.floor === 127200, JSON.stringify(sp('111')?.pricing))
        dung('2c. phí đủ tin (40 đơn đối soát)', st.status.feeModel.trusted === true && st.status.feeModel.orders === 40, JSON.stringify(st.status.feeModel))
        dung('2d. listing chưa nối mã kho ⇒ không đổi giá, có lời nhắc', sp('444')?.enabled === false && /Chưa nối/.test(sp('444')?.error || ''))
        dung('2e. listing không đang bán ⇒ không đổi giá', sp('555')?.enabled === false && /trạng thái/.test(sp('555')?.error || ''))
        dung('2f. hàng kho chưa có trên gian (TUI) hiện ở danh sách chưa đăng; hàng đã có thì không', st.unlisted.some((u: any) => u.sku === 'TUI') && !st.unlisted.some((u: any) => u.sku === 'OC4'))
        dung('2g. trạng thái KHÔNG gọi TikTok', goi.length === 0)
        dung('2h. hộ kinh doanh + chưa khai thuế ⇒ không nhắc thuế', !st.status.taxNote)
    }

    // ─── 3. Phí: CHỈ số đo của CHÍNH gian — chưa đủ đơn ⇒ phí KHAI hoặc CHƯA BIẾT PHÍ (09/11/2026) ─────────────
    // Chủ shop: "xem phí phải ghi rõ ra không thể mượn được". Trước: gian mới MƯỢN số đo của gian cùng sàn (cờ muon) — gian Mall /
    // gian thường, ngành khác nhau thì phí khác nhau, mà số mượn hiện trên kế hoạch đổi giá như phí của chính gian.
    {
        datLai(0)
        kenh.push({ id: 'tt2', name: 'TikTok cũ', platform: 'tiktok', shopId: '7002', accessToken: 'tok', commissionRate: 6, createdAt: new Date(2) })
        donPhi.tt2 = Array.from({ length: 40 }, (_, i) => { const g = 60000 + i * 10000; return { giaBan: g, phi: 0.1 * g + 2000 } })
        donPhi.sp1 = Array.from({ length: 40 }, (_, i) => { const g = 60000 + i * 10000; return { giaBan: g, phi: 0.3 * g } })
        hoiPhi.length = 0
        const m = await docMauPhi(prisma, kenh[0])
        dung('3a. TikTok: gian 0 đơn, cửa hàng có gian TikTok khác 40 đơn ⇒ KHÔNG mượn (chỉ đọc đơn của chính gian); ô phí 6% mặc định ⇒ CHƯA BIẾT PHÍ',
            m.chuaBiet === true && !m.khai && !('muon' in m) && m.nguon === 'cau-hinh-kenh' && m.soDon === 0 && JSON.stringify(hoiPhi) === '[["tt1"]]'
            && /"Kengi TikTok"/.test(m.ghiChu) && /0\/8 đơn/.test(m.ghiChu) && /Không mượn số đo của gian khác/.test(m.ghiChu), JSON.stringify({ m, hoiPhi }))
        hoiPhi.length = 0
        const s = await docMauPhi(prisma, { ...kenh[1], id: 'spMoi', name: 'Shopee mới' })
        dung('3b. Shopee: gian mới, cửa hàng có gian Shopee khác 40 đơn ⇒ cũng KHÔNG mượn — CHƯA BIẾT PHÍ',
            s.chuaBiet === true && !('muon' in s) && JSON.stringify(hoiPhi) === '[["spMoi"]]' && /"Shopee mới"/.test(s.ghiChu), JSON.stringify({ s, hoiPhi }))
        // CHƯA BIẾT PHÍ ⇒ như thiếu giá vốn: không tính giá, không ghi được giá nào (người lẫn máy)
        const ts = (mp: MauPhi, giaVon = 100000): ThamSoGia => ({ giaVon, phi: mp, bienLoiNhuanPct: 15, bienToiThieuPct: 5, lamTron: 1000 })
        const kq = tinhGiaDeXuat(ts(m))
        dung('3c. chưa biết phí ⇒ không tính giá (hopLe=false, sàn 0), lý do "Chưa biết phí sàn của gian…" kèm đường khai «Phí sàn (%)»',
            !kq.hopLe && kq.giaSan === 0 && kq.giaDeXuat === 0 && /^Chưa biết phí sàn của gian/.test(kq.lyDo || '') && /«Phí sàn \(%\)»/.test(kq.lyDo || ''), JSON.stringify(kq))
        dung('3c2. … chanGiaDuoiSan chặn MỌI giá: 1.000đ / 150.000đ / 5.000.000đ', [1000, 150000, 5_000_000].every(g => /^Chưa biết phí sàn/.test(chanGiaDuoiSan(g, kq) || '')))
        dung('3c3. thiếu giá vốn vẫn báo TRƯỚC (việc của từng sản phẩm; phí là việc của cả gian)', /CHƯA CÓ GIÁ VỐN/.test(tinhGiaDeXuat(ts(m, 0)).lyDo || ''))
        const lyM = lyDoPhiChuaDuTin(0, m) || ''
        dung('3c4. lyDoPhiChuaDuTin: chưa biết phí ⇒ nói chưa biết phí, máy không tự đăng mới / hạ', /^Chưa biết phí sàn/.test(lyM) && /Máy không tự đăng mới \/ hạ giá/.test(lyM), lyM)
        const fm = tomTatMauPhi(m)
        dung('3c5. tomTatMauPhi: scope chua-biet, không đủ tin, câu nguồn phí ghi rõ',
            fm.scope === 'chua-biet' && fm.trusted === false && fm.detail === 'Chưa biết phí — gian mới có 0/8 đơn đã đối soát và chưa khai phí ở Kênh bán online', JSON.stringify(fm))
        // ô phí 0 / âm / không phải số cũng là chưa khai
        const lech = [0, -5, NaN, undefined as any, null as any].map(r => uocLuongPhi([], r))
        dung('3d. ô phí 0 / âm / không phải số ⇒ cũng CHƯA BIẾT PHÍ', lech.every(x => x.chuaBiet === true && !x.khai), JSON.stringify(lech.map(x => [x.chuaBiet, x.khai])))
        // chủ shop đã khai phí sàn cho gian (25%) ⇒ số KHAI: người duyệt được, máy không tự đăng / hạ theo nó
        kenh[0].commissionRate = 25
        const k = await docMauPhi(prisma, kenh[0])
        const kqK = tinhGiaDeXuat(ts(k))
        const lyK = lyDoPhiChuaDuTin(kqK.giaDeXuat, k) || ''
        const fk = tomTatMauPhi(k)
        dung('3d2. ô phí 25% ⇒ phí KHAI: tính giá theo 25%, hợp lệ; ghiChu nói tên gian + số đơn + số khai',
            k.khai === true && !k.chuaBiet && Math.abs(k.tyLe - 0.25) < 1e-9 && kqK.hopLe && kqK.thamSo.tyLePhiPct === 25
            && /"Kengi TikTok" mới có 0\/8 đơn/.test(k.ghiChu) && /KHAI 25%/.test(k.ghiChu), JSON.stringify({ k, ts: kqK.thamSo }))
        dung('3d3. phí khai ⇒ máy KHÔNG tự đăng / hạ (lyDoPhiChuaDuTin nói rõ là số KHAI, không phải "chưa biết")',
            /KHAI 25%/.test(lyK) && /Máy không tự đăng mới \/ hạ giá/.test(lyK) && !/Chưa biết phí/.test(lyK), lyK)
        dung('3d4. tomTatMauPhi phí khai: scope khai, không đủ tin, câu nguồn phí ghi rõ',
            fk.scope === 'khai' && fk.trusted === false && fk.detail === 'Phí khai ở Kênh bán online — gian mới có 0/8 đơn đã đối soát, chưa đo được phí thật', JSON.stringify(fk))
        datLai()
    }

    // ─── 3b. Phí theo NGÀNH (02/11/2026, chủ shop: "mỗi ngành hàng lại 1 % phí khác nhau") ─────────────
    {
        datLai(); datTikTok(); goi.length = 0; bayGio = NOW
        // ngành 601 (ổ cắm) 14% + 3.000đ, ngành 602 (bình) 30% — mỗi ngành 40 đơn; cả gian = trộn hai ngành
        const n602 = Array.from({ length: 40 }, (_, i) => { const g = 60000 + i * 10000; return { giaBan: g, phi: 0.3 * g } })
        // + 10 dòng không nối được ngành (truy vấn thật đã loại; bộ đọc vẫn phải bỏ nếu lọt) — không được thành "ngành null"
        donNganh = { tt1: [...donPhi.tt1!.map(d => ({ ...d, nganh: '601' })), ...n602.map(d => ({ ...d, nganh: '602' })), ...n602.slice(0, 10).map(d => ({ ...d, nganh: null }))] }
        donPhi.tt1 = [...donPhi.tt1!, ...n602]
        listing[1].categoryId = '602'   // BINH
        const st = await xayTrangThaiTikTok(ngCanh())
        const sp = (id: string) => st.products.find((p: any) => p.itemId === id)
        const kq602 = tinhGiaDeXuat({ giaVon: 50000, phi: { tyLe: 0.3, coDinh: 0 } as any, bienLoiNhuanPct: 15, bienToiThieuPct: 5, lamTron: 1000 })
        dung('3e. OC4 (ngành 601) giữ giá theo phí NGÀNH 14% + 3.000đ dù cả gian phí cao hơn', sp('111')?.pricing.price === 146000 && sp('111')?.pricing.floor === 127200
            && sp('111')?.pricing.fee?.scope === 'nganh' && sp('111')?.pricing.fee?.categoryId === '601' && st.status.feeModel.rate > 0.16, JSON.stringify({ p: sp('111')?.pricing, gian: st.status.feeModel.rate }))
        dung('3f. BINH (ngành 602) tính theo phí NGÀNH 30% — giá sàn cao hơn số cả gian', sp('222')?.pricing.floor === kq602.giaSan && sp('222')?.pricing.price === kq602.giaDeXuat
            && Math.abs((sp('222')?.pricing.fee?.rate ?? 0) - 0.3) < 0.002, JSON.stringify({ p: sp('222')?.pricing, kq: [kq602.giaSan, kq602.giaDeXuat] }))
        dung('3g. bảng phí theo ngành gửi giao diện đủ hai ngành', st.status.feeModel.byCategory?.length === 2 && st.status.feeModel.byCategory.every((c: any) => c.scope === 'nganh' && c.orders === 40), JSON.stringify(st.status.feeModel.byCategory))
        const kh = await taoKeHoachGiaTikTok(ngCanh(), { itemId: '222', price: 150000 })
        dung('3h. kế hoạch giá mang phí NGÀNH của sản phẩm', kh.data.economics.floor === kq602.giaSan && kh.data.economics.fee?.scope === 'nganh' && !kh.data.feeWarning, JSON.stringify(kh.data.economics))

        // ngành chưa đủ đơn ⇒ phí cả gian gắn cờ: máy KHÔNG tự hạ, ngành đã đo vẫn tự tăng
        listing[1].categoryId = '699'
        const ctx = ngCanh()
        await luuCauHinhTikTok(ctx, { executionMode: 'auto' })
        const kq = await chayChuKyTikTok(ctx)
        const gia = Object.fromEntries(ghiTT().map(g => [g[1], g[2]]))
        // ĐỐI CHỨNG: hạ 160k → 144k vẫn lãi ~30% kể cả với ngành đắt nhất ĐÃ ĐO (602: 30%) — ngành 699 chưa đo có thể đắt hơn ⇒ KHÔNG tự hạ
        dung('3i. ngành chưa đủ đơn: HẠ giá KHÔNG tự làm (BINH nháp chờ duyệt); ngành đã đo vẫn tự TĂNG (OC4)', !gia['222'] && gia['111'] === 132000
            && kq.results.some((r: any) => r.sku === 'BINH' && /CHỜ NGƯỜI DUYỆT/.test(r.message || '') && /chưa đủ đơn/.test(r.message || '')), JSON.stringify({ gia, r: kq.results }))
        const kh2 = ctx.kho._keHoach.find(k => k.data?.itemId === '222' && k.status === 'draft')
        const ha = kh2 ? await thucThiTikTok(ctx, kh2.id, { tuDong: true }) : null
        dung('3j. lớp rào ở bước ghi: máy tự chạy + ngành chưa đo ⇒ từ chối HẠ giá', ha?.status === 'failed' && /chưa đủ đơn/.test(ha?.result?.message || '') && !ghiTT().some(g => g[1] === '222'), JSON.stringify(ha?.result))
        datLai()
    }

    // ─── 3c. CHƯA BIẾT PHÍ / phí KHAI trên TikTok Pilot: trạng thái, kế hoạch, chu kỳ, thực thi (09/11/2026) ─────────────
    {
        datLai(3); datTikTok(); goi.length = 0; daySo.length = 0; bayGio = NOW     // 3 đơn đối soát, ô phí còn 6% mặc định
        const ctx = ngCanh()
        const st = await xayTrangThaiTikTok(ctx)
        const fm = st.status.feeModel
        const oc4 = st.products.find((p: any) => p.itemId === '111')
        dung('3k. trạng thái: CHƯA BIẾT PHÍ — unknown, không declared, scope chua-biet, không đủ tin, câu nguồn phí ghi rõ, không còn borrowed',
            fm.unknown === true && fm.declared === false && fm.scope === 'chua-biet' && fm.trusted === false && !('borrowed' in fm) && fm.autoFromPrice === null
            && fm.detail === 'Chưa biết phí — gian mới có 3/8 đơn đã đối soát và chưa khai phí ở Kênh bán online', JSON.stringify(fm))
        dung('3l. cảnh báo nói tên gian, số đơn và ĐƯỜNG BẤM khai phí (đúng nhãn trên kengi.vn)',
            /^Chưa biết phí sàn của gian "Kengi TikTok": mới có 3\/8 đơn đã đối soát/.test(fm.warning || '')
            && (fm.warning || '').includes('Đơn Hàng Online → nút «Kênh bán hàng» → nút «Key» ở dòng của gian → ô «Phí sàn (%)» → Lưu'), fm.warning)
        dung('3m. sản phẩm: không giá đề xuất / giá sàn, lý do "Chưa biết phí", phí scope chua-biet (giao diện không hiện 6% như phí thật)',
            oc4?.pricing.price === null && oc4?.pricing.floor === null && /^Chưa biết phí sàn/.test(oc4?.pricing.reason || '') && !oc4?.pricing.autoBlocked
            && oc4?.pricing.fee?.scope === 'chua-biet', JSON.stringify(oc4?.pricing))
        const kh = await nem(() => taoKeHoachGiaTikTok(ctx, { itemId: '111', price: 150000 }))
        dung('3n. lập kế hoạch giá ⇒ từ chối "Chưa biết phí sàn của gian…", không đọc TikTok, không lưu kế hoạch',
            kh instanceof ToolError && /^Chưa biết phí sàn của gian "Kengi TikTok"/.test(kh.message) && goi.length === 0 && ctx.kho._keHoach.length === 0, kh?.message)

        // chu kỳ Tự động (đổi giá + đẩy tồn): không ghi, không đọc TikTok, MỘT dòng lý do; đẩy tồn không cần phí nên vẫn chạy
        await luuCauHinhTikTok(ctx, { executionMode: 'auto', policy: { automation: { reprice: true, syncStock: true } } })
        const ck = await chayChuKyTikTok(ctx)
        const dongPhi = ck.results.filter((r: any) => /CHƯA BIẾT PHÍ/.test(r.message || ''))
        const viec = viecCanNguoi(ck.results)
        dung('3o. chu kỳ Tự động: KHÔNG ghi giá, không đọc TikTok, không lập kế hoạch; đúng MỘT dòng "CHƯA BIẾT PHÍ" (tên gian, số đơn)',
            ghiTT().length === 0 && goi.length === 0 && ctx.kho._keHoach.length === 0 && dongPhi.length === 1 && dongPhi[0].action === 'cycle'
            && dongPhi[0].status === 'skipped' && /"Kengi TikTok"/.test(dongPhi[0].message) && /3\/8 đơn/.test(dongPhi[0].message)
            && !ck.results.some((r: any) => r.action === 'price'), JSON.stringify(ck.results))
        dung('3p. … đẩy tồn vẫn chạy; việc cần người: một việc "CHƯA BIẾT PHÍ", giữ đường khai «Phí sàn (%)» dù thông báo cắt 180 ký tự',
            daySo.length === 2 && daySo[0].dryRun === true && !daySo[1].dryRun && viec.dong.filter(d => /CHƯA BIẾT PHÍ/.test(d)).length === 1
            && viec.dong.some(d => /CHƯA BIẾT PHÍ/.test(d) && /«Phí sàn \(%\)»/.test(d)), JSON.stringify({ daySo, viec }))

        // chủ shop khai phí 20% ⇒ tính giá theo số khai, người duyệt được; máy không tự hạ
        kenh[0].commissionRate = 20
        const st2 = await xayTrangThaiTikTok(ctx)
        const fm2 = st2.status.feeModel, oc42 = st2.products.find((p: any) => p.itemId === '111')
        dung('3q. khai phí 20% ⇒ declared, scope khai, câu nguồn phí ghi rõ; giá theo 20% (154.000 / sàn 133.400), máy không tự hạ',
            fm2.declared === true && fm2.unknown === false && fm2.scope === 'khai' && fm2.trusted === false && !('borrowed' in fm2)
            && fm2.detail === 'Phí khai ở Kênh bán online — gian mới có 3/8 đơn đã đối soát, chưa đo được phí thật' && /KHAI 20%/.test(fm2.warning || '')
            && oc42?.pricing.price === 154000 && oc42?.pricing.floor === 133400 && /KHAI 20%/.test(oc42?.pricing.autoBlocked || '') && oc42?.pricing.fee?.scope === 'khai',
            JSON.stringify({ fm2, p: oc42?.pricing }))
        // kế hoạch lập lúc còn phí khai; chủ shop trả ô phí về 6% (chưa khai) trước khi duyệt ⇒ thực thi không ghi
        const khBinh = await taoKeHoachGiaTikTok(ctx, { itemId: '222', price: 150000 })
        const lapDuoc = khBinh.status   // kho bộ nhớ giữ cùng đối tượng — đọc trước khi thực thi đổi trạng thái
        kenh[0].commissionRate = 6
        const tr = goi.length
        const xong = await thucThiTikTok(ctx, khBinh.id)
        dung('3r. kế hoạch cũ, ô phí trả về chưa khai trước lúc thực thi ⇒ thất bại "Chưa biết phí", không gọi TikTok',
            lapDuoc === 'draft' && xong.status === 'failed' && /Chưa biết phí sàn/.test(xong.result?.message || '') && ghiTT().length === 0 && goi.length === tr,
            JSON.stringify(xong.result))
        datLai()
    }

    // ─── 4. Kế hoạch giá ─────────────────────────────────────────────────────────
    {
        datLai(); datTikTok(); goi.length = 0
        const ctx = ngCanh()
        dung('4a. dưới giá sàn ⇒ chặn', /giá sàn|sàn/i.test((await nem(() => taoKeHoachGiaTikTok(ctx, { itemId: '111', price: 125000 })))?.message || ''))
        const vuot = await nem(() => taoKeHoachGiaTikTok(ctx, { itemId: '111', price: 140000 }))
        dung('4b. vượt biên độ 10% so với giá ĐỌC THẲNG TikTok ⇒ chặn', /vượt biên độ/.test(vuot?.message || ''), vuot?.message)
        const nhieu = await nem(() => taoKeHoachGiaTikTok(ctx, { itemId: '333', price: 95000 }))
        dung('4c. hàng nhiều SKU ⇒ chặn (LoiNhieuSku)', nhieu instanceof LoiNhieuSku && nhieu.soSku === 3, nhieu?.message)
        dung('4d. chưa nối mã kho ⇒ chặn (không biết lãi lỗ)', /giá vốn/.test((await nem(() => taoKeHoachGiaTikTok(ctx, { itemId: '444', price: 52000 })))?.message || ''))
        chiTiet['111'] = giaTT(125000, 'sku111')   // TikTok đang bán 125.000 (bản trong hệ thống cũ: 120.000)
        const kh = await taoKeHoachGiaTikTok(ctx, { sku: 'oc4', price: 137000, idempotencyKey: 'web:1' })
        dung('4e. snapshot = giá ĐỌC THẲNG TikTok + nhớ mã SKU', kh.status === 'draft' && kh.data.snapshot.price === 125000 && kh.data.skuId === 'sku111' && kh.data.economics.floor === 127200, JSON.stringify(kh.data))
        dung('4f. bấm hai lần (cùng khoá) ⇒ một kế hoạch', (await taoKeHoachGiaTikTok(ctx, { sku: 'OC4', price: 137000, idempotencyKey: 'web:1' })).id === kh.id && ctx.kho._keHoach.length === 1)
        dung('4g. lập kế hoạch KHÔNG ghi gì lên TikTok', ghiTT().length === 0)
    }

    // ─── 5. Thực thi ─────────────────────────────────────────────────────────────
    {
        datLai(); datTikTok(); goi.length = 0; bayGio = NOW
        const ctx = ngCanh()
        const kh = await taoKeHoachGiaTikTok(ctx, { itemId: '111', price: 132000 })
        const xt = await thucThiTikTok(ctx, kh.id)
        dung('5a. Xem trước: thực thi KHÔNG gọi TikTok', xt.executed === false && ghiTT().length === 0)
        await luuCauHinhTikTok(ctx, { executionMode: 'auto' })
        const kq = await Promise.all([thucThiTikTok(ctx, kh.id), thucThiTikTok(ctx, kh.id)])
        dung('5b. Tự động: ghi đúng MỘT lần dù hai tab bấm cùng lúc, đúng SKU', ghiTT().length === 1 && ghiTT()[0][2] === 132000 && ghiTT()[0][3] === 'sku111', `${JSON.stringify(ghiTT())} ${kq.map((k: any) => k.status)}`)
        dung('5c. giá trong hệ thống cập nhật theo giá mới', listing[0].price === 132000)
        dung('5d. thực thi lại kế hoạch đã xong ⇒ không ghi đúp', (await thucThiTikTok(ctx, kh.id)).status === 'succeeded' && ghiTT().length === 1)

        chiTiet['222'] = giaTT(160000, 'sku222')
        const kh2 = await taoKeHoachGiaTikTok(ctx, { itemId: '222', price: 150000 })
        chiTiet['222'] = giaTT(130000, 'sku222')   // ai đó vừa hạ giá trên Seller Center
        const doi = await thucThiTikTok(ctx, kh2.id)
        dung('5e. giá trên TikTok đổi từ lúc lập kế hoạch (vượt biên độ) ⇒ thất bại, không ghi', doi.status === 'failed' && /đã đổi từ lúc lập kế hoạch/.test(doi.result?.message) && ghiTT().length === 1, doi.result?.message)
        chiTiet['222'] = giaTT(160000, 'skuMOI')
        const kh3 = await taoKeHoachGiaTikTok(ctx, { itemId: '222', price: 150000 })
        chiTiet['222'] = giaTT(160000, 'skuKHAC')
        const sku = await thucThiTikTok(ctx, kh3.id)
        dung('5f. SKU đổi từ lúc lập kế hoạch ⇒ thất bại, không ghi', sku.status === 'failed' && /SKU/.test(sku.result?.message) && ghiTT().length === 1, sku.result?.message)
        chiTiet['222'] = giaTT(160000, 'sku222')
        const kh4 = await taoKeHoachGiaTikTok(ctx, { itemId: '222', price: 150000 })
        hang[1].costPrice = 0
        const von = await thucThiTikTok(ctx, kh4.id)
        hang[1].costPrice = 50000
        dung('5g. mất giá vốn lúc thực thi ⇒ thất bại, không ghi', von.status === 'failed' && /giá vốn/.test(von.result?.message) && ghiTT().length === 1, von.result?.message)
        const kh5 = await taoKeHoachGiaTikTok(ctx, { itemId: '222', price: 151000 })
        loiGia = new TypeError('fetch failed')
        const mang = await thucThiTikTok(ctx, kh5.id)
        loiGia = null
        dung('5h. mất mạng giữa chừng ⇒ "uncertain"', mang.status === 'uncertain', mang.status)
        const kh6 = await taoKeHoachGiaTikTok(ctx, { itemId: '222', price: 152000 })
        dung('5i. huỷ nháp được, huỷ lần hai báo lỗi', (await huyKeHoachTikTok(ctx, kh6.id)).status === 'cancelled' && (await nem(() => huyKeHoachTikTok(ctx, kh6.id))) instanceof ToolError)
        await luuCauHinhTikTok(ctx, { policy: { maxWritesPerDay: 1 } })
        const kh7 = await taoKeHoachGiaTikTok(ctx, { itemId: '222', price: 153000 })
        dung('5j. quá số thao tác ghi / ngày ⇒ chặn', /giới hạn/.test((await nem(() => thucThiTikTok(ctx, kh7.id)))?.message || ''))

        // Lớp rào thứ hai ở chính bước ghi: máy tự chạy + phí CHƯA đủ tin ⇒ không tự hạ giá dù chu kỳ lỡ gọi thực thi
        datLai(10); datTikTok(); goi.length = 0
        const ctx5 = ngCanh()
        await luuCauHinhTikTok(ctx5, { executionMode: 'auto' })
        const kh8 = await taoKeHoachGiaTikTok(ctx5, { itemId: '222', price: 150000 })
        const ha = await thucThiTikTok(ctx5, kh8.id, { tuDong: true })
        dung('5k. máy tự chạy + phí chưa đủ tin ⇒ bước ghi từ chối HẠ giá', ha.status === 'failed' && /Không tự hạ giá/.test(ha.result?.message) && ghiTT().length === 0, ha.result?.message)
        const kh9 = await taoKeHoachGiaTikTok(ctx5, { itemId: '222', price: 150001 })
        const nguoi = await thucThiTikTok(ctx5, kh9.id)
        dung('5l. NGƯỜI bấm thực thi thì được hạ (đã đọc cảnh báo phí trong kế hoạch)', nguoi.status === 'succeeded' && ghiTT().length === 1 && !!kh9.data.feeWarning, `${nguoi.status} ${JSON.stringify(kh9.data.feeWarning)}`)
    }

    // ─── 6. Chu kỳ ──────────────────────────────────────────────────────────────
    {
        datLai(); datTikTok(); goi.length = 0; daySo.length = 0; bayGio = NOW
        const ctx = ngCanh()
        await luuCauHinhTikTok(ctx, { policy: { automation: { reprice: true, syncStock: true } } })
        const xt = await chayChuKyTikTok(ctx)
        dung('6a. Xem trước: chỉ lập nháp, KHÔNG ghi giá; đẩy tồn chỉ chạy thử', ghiTT().length === 0 && ctx.kho._keHoach.filter(k => k.status === 'draft').length >= 2 && daySo.length === 1 && daySo[0].dryRun === true, JSON.stringify(xt.results))
        dung('6b. hàng nhiều SKU ghi nhớ (skipped) + báo gọn', ctx.kho._keHoach.some(k => k.status === 'skipped' && k.data.itemId === '333') && xt.results.some((r: any) => /nhiều phân loại/.test(r.message)))
        const hoi333 = goi.filter(g => g[0] === 'detail' && g[1] === '333').length
        await chayChuKyTikTok(ctx)
        dung('6c. lượt sau KHÔNG hỏi lại TikTok sản phẩm nhiều SKU', goi.filter(g => g[0] === 'detail' && g[1] === '333').length === hoi333)

        // Tự động, phí ĐỦ tin: OC4 dưới sàn ⇒ tăng; BINH lãi quá cao + 14 ngày không bán ⇒ hạ (trong biên độ)
        datLai(); datTikTok(); goi.length = 0; daySo.length = 0
        const ctx2 = ngCanh()
        await luuCauHinhTikTok(ctx2, { executionMode: 'auto', policy: { automation: { reprice: true, syncStock: true } } })
        await chayChuKyTikTok(ctx2)
        const gia = Object.fromEntries(ghiTT().map(g => [g[1], g[2]]))
        dung('6d. Tự động: OC4 dưới sàn ⇒ tăng 10% (120.000 → 132.000)', gia['111'] === 132000, JSON.stringify(gia))
        dung('6e. Tự động: BINH ế + lãi quá cao, phí đủ tin ⇒ hạ 10% (160.000 → 144.000)', gia['222'] === 144000, JSON.stringify(gia))
        dung('6f. Tự động: chạy thử trước (cầu dao) rồi đẩy tồn thật', daySo.length === 2 && daySo[0].dryRun === true && !daySo[1].dryRun, JSON.stringify(daySo))

        // TT-18 (10/11/2026): BINH nối tay KHÔNG SKU, đơn 14 ngày nối về hàng kho p2 ⇒ đang bán ⇒ KHÔNG hạ (trước: theo SKU ⇒ "ế")
        datLai(); datTikTok(); goi.length = 0; daySo.length = 0
        listing.find(l => l.id === 'op2').sku = null
        daBan = [{ loai: 'sku', khoa: 'oc4', sl: 5 }, { loai: 'hang', khoa: 'p2', sl: 3 }]
        const ctxN = ngCanh()
        await luuCauHinhTikTok(ctxN, { executionMode: 'auto', policy: { automation: { reprice: true } } })
        await chayChuKyTikTok(ctxN)
        const giaN = Object.fromEntries(ghiTT().map(g => [g[1], g[2]]))
        dung('6e2. listing không SKU nhưng đơn nối về hàng kho ⇒ có bán ⇒ KHÔNG hạ giá "ế"; OC4 dưới sàn vẫn tăng',
            !giaN['222'] && giaN['111'] === 132000, JSON.stringify(giaN))
        const stN = await xayTrangThaiTikTok(ngCanh())
        dung('6e3. trạng thái: listing không SKU hiện số bán theo hàng kho (3), không phải "—"',
            stN.products.find((p: any) => p.itemId === '222')?.sold14 === 3, JSON.stringify(stN.products.map((p: any) => [p.itemId, p.sold14])))

        // đọc số bán HỎNG ⇒ không hạ giá theo lý do bán chậm; mã dưới sàn vẫn tăng; nói rõ một dòng; trang hiện "—" (null), không 0
        datLai(); datTikTok(); goi.length = 0; daySo.length = 0
        loiDaBan = true
        const ctxH = ngCanh()
        await luuCauHinhTikTok(ctxH, { executionMode: 'auto', policy: { automation: { reprice: true } } })
        const kqH = await chayChuKyTikTok(ctxH)
        const giaH = Object.fromEntries(ghiTT().map(g => [g[1], g[2]]))
        dung('6e4. đọc số bán hỏng ⇒ BINH KHÔNG bị hạ (trước: rỗng ⇒ "14 ngày không bán"); OC4 dưới sàn vẫn tăng',
            !giaH['222'] && giaH['111'] === 132000, JSON.stringify(giaH))
        dung('6e5. đọc số bán hỏng ⇒ một dòng "Không đọc được số đã bán 14 ngày", không tính là hỏng cần báo',
            kqH.results.some((r: any) => r.status === 'skipped' && /Không đọc được số đã bán 14 ngày/.test(r.message || '')), JSON.stringify(kqH.results))
        const stH = await xayTrangThaiTikTok(ngCanh())
        dung('6e6. trạng thái khi đọc hỏng: sold14 = null ("—"), không phải 0; trang vẫn mở',
            stH.products.length > 0 && stH.products.every((p: any) => p.sold14 === null), JSON.stringify(stH.products.map((p: any) => [p.itemId, p.sold14])))
        loiDaBan = false

        // Phí CHƯA đủ tin (10 đơn): tăng vẫn tự làm, hạ thì để nháp chờ duyệt
        datLai(10); datTikTok(); goi.length = 0
        const ctx3 = ngCanh()
        await luuCauHinhTikTok(ctx3, { executionMode: 'auto' })
        const kq3 = await chayChuKyTikTok(ctx3)
        const gia3 = Object.fromEntries(ghiTT().map(g => [g[1], g[2]]))
        dung('6g. phí chưa đủ tin: TĂNG giá vẫn tự làm (OC4)', !!gia3['111'] && gia3['111'] > 120000, JSON.stringify(gia3))
        dung('6h. phí chưa đủ tin: HẠ giá KHÔNG tự làm (BINH để nháp chờ duyệt)', !gia3['222'] && ctx3.kho._keHoach.some(k => k.data.itemId === '222' && k.status === 'draft')
            && kq3.results.some((r: any) => /CHỜ NGƯỜI DUYỆT/.test(r.message || '')), JSON.stringify(kq3.results))

        datLai(); datTikTok(); goi.length = 0
        const ctx4 = ngCanh()
        await luuCauHinhTikTok(ctx4, { policy: { maxRepricePerCycle: 1 } })
        const kq4 = await chayChuKyTikTok(ctx4)
        dung('6i. trần sản phẩm mỗi chu kỳ', ctx4.kho._keHoach.filter(k => k.status === 'draft').length === 1 && kq4.results.some((r: any) => /tối đa 1/.test(r.message || '')), JSON.stringify(kq4.results))
    }

    // ─── 7. Chạy theo lịch ──────────────────────────────────────────────────────
    {
        datLai(); datTikTok(); goi.length = 0; bayGio = NOW
        const kho = khoBoNhoTikTok()
        const ctx = ngCanh(kho)
        const ngoai = { taoTikTok: ttGia, dayTon: dayTonGia, bayGio: () => bayGio }
        dung('7a. chưa có cấu hình ⇒ không dùng', (await chayTheoLichTikTok(prisma, kho, ngoai)) === 'khong-dung')
        await luuCauHinhTikTok(ctx, { schedule: { enabled: true, intervalMinutes: 60 } })
        dung('7b. chưa tới hẹn ⇒ chưa chạy', (await chayTheoLichTikTok(prisma, kho, ngoai)) === 'chua-toi')
        bayGio = NOW + 61 * 60_000
        const r = await chayTheoLichTikTok(prisma, kho, ngoai)
        const c = await kho.docCauHinh()
        dung('7c. tới hẹn ⇒ chạy, ghi kết quả, hẹn lượt kế; Xem trước ⇒ không ghi giá', r === 'da-chay' && c?.lastRunAt === bayGio && c?.nextRunAt === bayGio + 60 * 60_000 && ghiTT().length === 0, `${r} ${JSON.stringify(c?.lastResult).slice(0, 200)}`)
        bayGio = NOW
    }

    // ─── 8. Tiện ích + kiểm kết nối ─────────────────────────────────────────────
    {
        datDemTienIch('CH_A', ['shopee_pilot', 'facebook_pilot'])
        datDemTienIch('CH_B', ['tiktok_pilot'])
        const a = await lyDoChanPilot('CH_A', TIEN_ICH_TIKTOK_PILOT)
        dung('8a. bật Shopee / Facebook Pilot KHÔNG mở TikTok Pilot', a?.ma === 'chua_bat_tien_ich' && /TikTok Pilot/.test(a.loi), JSON.stringify(a))
        dung('8b. bật tiktok_pilot ⇒ dùng được', (await lyDoChanPilot('CH_B', TIEN_ICH_TIKTOK_PILOT)) === null)
        dung('8c. duyệt nâng cấp giữ tiktok_pilot, không để yêu cầu tự bật', giuTienIchQuanTri(['online'], ['tiktok_pilot']).includes('tiktok_pilot') && !giuTienIchQuanTri(['tiktok_pilot'], []).includes('tiktok_pilot'))
        datLai(); datTikTok(); goi.length = 0
        const kn = await kiemKetNoiTikTok(ngCanh())
        dung('8d. kiểm kết nối chỉ ĐỌC, đủ các bước', kn.tong >= 4 && ghiTT().length === 0 && kn.buoc[0].ok === true, JSON.stringify(kn))
    }

    // ─── L. Lô 3 (09/11/2026): quyết theo giá THẬT, không báo động giả, không giành giá người sửa ─────────────
    const ctxL = (kho = khoBoNhoTikTok(() => bayGio), them: Partial<NgCanhTikTok> = {}) =>
        ({ ...ngCanh(kho), ...them }) as NgCanhTikTok & { kho: ReturnType<typeof khoBoNhoTikTok> }
    const dongGia = (kq: any): any[] => kq.results.filter((r: any) => r.action === 'price')
    const ghiMa = (id: string) => ghiTT().filter(g => g[1] === id)
    const ngayThang = (ms: number) => { const d = new Date(ms + 7 * 3600_000).toISOString(); return `${d.slice(8, 10)}/${d.slice(5, 7)}` }
    const giaRong = (sale: string) => ({ skus: [{ id: 'sku111', seller_sku: 'OC4', price: { tax_exclusive_price: '', sale_price: sale } }] })

    // L1 (TT-09) — giá sống = số DƯƠNG đầu tiên; 0 / rỗng / đọc hỏng ⇒ không đổi; chu kỳ quyết theo giá SỐNG đọc theo lô
    {
        datLai(); datTikTok(); goi.length = 0; bayGio = NOW
        dung('L1a. giá SKU = số DƯƠNG đầu tiên: tax_exclusive_price rỗng / "0" ⇒ sale_price; không có số dương ⇒ 0',
            giaSkuTikTok({ price: { tax_exclusive_price: '', sale_price: '99000' } }) === 99000
            && giaSkuTikTok({ price: { tax_exclusive_price: '0', sale_price: '120000' } }) === 120000
            && giaSkuTikTok({ price: { tax_exclusive_price: '130000', sale_price: '99000' } }) === 130000
            && giaSkuTikTok({ price: { tax_exclusive_price: '', sale_price: '0' } }) === 0 && giaSkuTikTok({}) === 0)
        const ctx = ctxL()
        chiTiet['111'] = giaRong('125000')
        const kh: any = await taoKeHoachGiaTikTok(ctx, { itemId: '111', price: 137000 }).catch(e => e)
        dung('L1b. TikTok trả tax_exclusive_price rỗng ⇒ giá đang bán đọc từ sale_price (125.000), không phải 0', kh?.data?.snapshot?.price === 125000, kh?.message || JSON.stringify(kh?.data?.snapshot))
        chiTiet['111'] = giaRong('0')
        const so = ctx.kho._keHoach.length
        const k0 = await nem(() => taoKeHoachGiaTikTok(ctx, { itemId: '111', price: 130000 }))
        dung('L1c. giá sống 0 / rỗng ⇒ lập kế hoạch TỪ CHỐI "không đọc được giá đang bán", không lưu (trước: lấy giá lưu làm mốc biên độ)',
            k0 instanceof ToolError && /không đọc được giá đang bán/.test(k0.message) && ctx.kho._keHoach.length === so, k0?.message)
        chiTiet['111'] = new Error('TikTok getProduct: [36009004] internal error')
        const so2 = ctx.kho._keHoach.length
        const kLoi = await nem(() => taoKeHoachGiaTikTok(ctx, { itemId: '111', price: 130000 }))
        dung('L1d. đọc giá sống hỏng ⇒ lập kế hoạch từ chối "Không đọc được giá đang bán trên TikTok", không lưu',
            kLoi instanceof ToolError && /Không đọc được giá đang bán trên TikTok/.test(kLoi.message) && ctx.kho._keHoach.length === so2, kLoi?.message)

        // chu kỳ Tự động: bản lưu 120.000 (đồng bộ tới 2 giờ trước), TikTok đang bán 125.000 ⇒ quyết theo 125.000
        datLai(); datTikTok(); goi.length = 0
        chiTiet['111'] = giaTT(125000, 'sku111')
        const c1 = ctxL()
        await luuCauHinhTikTok(c1, { executionMode: 'auto' })
        const kq1 = await chayChuKyTikTok(c1)
        dung('L1e. chu kỳ quyết theo giá SỐNG: TikTok bán 125.000 (bản lưu 120.000) ⇒ nâng 10% từ 125.000 = 137.000 (không phải 132.000)',
            ghiMa('111').length === 1 && ghiMa('111')[0][2] === 137000, JSON.stringify({ ghi: ghiTT(), r: kq1.results }))

        datLai(); datTikTok(); goi.length = 0
        chiTiet['111'] = giaRong('0')
        const c2 = ctxL()
        await luuCauHinhTikTok(c2, { executionMode: 'auto' })
        const kq2 = await chayChuKyTikTok(c2)
        dung('L1f. chu kỳ: TikTok trả giá 0 / rỗng ⇒ 0 lời gọi đổi giá mã đó, dòng lý do; mã khác vẫn đổi',
            ghiMa('111').length === 0 && ghiMa('222').length === 1
            && kq2.results.some((r: any) => r.status === 'skipped' && /1 TikTok trả giá 0 \/ rỗng/.test(r.message || '')), JSON.stringify(kq2.results))

        datLai(); datTikTok(); goi.length = 0
        for (const id of ['111', '222', '333']) chiTiet[id] = new Error('TikTok getProduct: [36009004] internal error')
        const c3 = ctxL()
        await luuCauHinhTikTok(c3, { executionMode: 'auto' })
        const kq3 = await chayChuKyTikTok(c3)
        dung('L1g. đọc giá sống hỏng mọi mã ⇒ 0 lời gọi đổi giá, không lập kế hoạch, đúng MỘT dòng lý do',
            ghiTT().length === 0 && c3.kho._keHoach.length === 0 && dongGia(kq3).length === 1
            && /^Không đọc được giá đang bán trên TikTok — chu kỳ không đổi giá mã nào/.test(dongGia(kq3)[0].message), JSON.stringify(kq3.results))

        // dịch vụ thật đọc LÔ products/search (vài lời gọi) — không đọc từng mã trước khi quyết
        datLai(); datTikTok(); goi.length = 0
        chiTiet['111'] = giaTT(125000, 'sku111')
        let loiLo: any = null
        const ttLo = async (): Promise<DichVuTikTok> => ({
            ...(await ttGia()),
            timSanPhamTho: async () => { goi.push(['search']); if (loiLo) throw loiLo; return ['111', '222', '333'].map(id => ({ id, status: 'ACTIVATE', ...chiTiet[id] })) },
        })
        const c4 = ctxL(undefined, { taoTikTok: ttLo })
        await luuCauHinhTikTok(c4, { executionMode: 'auto' })
        await chayChuKyTikTok(c4)
        const dauDetail = goi.findIndex(g => g[0] === 'detail')
        dung('L1h. đọc giá sống theo LÔ: MỘT lần products/search trước mọi lần đọc lẻ; đọc lẻ chỉ lúc thực thi (bằng số lần ghi); quyết theo giá lô',
            goi.filter(g => g[0] === 'search').length === 1 && goi.findIndex(g => g[0] === 'search') < dauDetail
            && goi.filter(g => g[0] === 'detail').length === ghiTT().length && ghiMa('111')[0]?.[2] === 137000, JSON.stringify(goi))
        datLai(); datTikTok(); goi.length = 0
        loiLo = new Error('TikTok products/search: [36009004] internal error')
        const c5 = ctxL(undefined, { taoTikTok: ttLo })
        await luuCauHinhTikTok(c5, { executionMode: 'auto' })
        const kq5 = await chayChuKyTikTok(c5)
        dung('L1i. đọc LÔ hỏng ⇒ không đổi giá mã nào, MỘT dòng lý do "failed"',
            ghiTT().length === 0 && c5.kho._keHoach.length === 0 && dongGia(kq5).length === 1 && dongGia(kq5)[0].status === 'failed', JSON.stringify(kq5.results))

        // thực thi: kế hoạch lập lúc TikTok bán 120.000; tới lúc ghi TikTok trả 0 / đọc mất mạng ⇒ không ghi
        datLai(); datTikTok(); goi.length = 0
        const c6 = ctxL()
        await luuCauHinhTikTok(c6, { executionMode: 'auto' })
        const kh6 = await taoKeHoachGiaTikTok(c6, { itemId: '111', price: 130000 })
        chiTiet['111'] = giaRong('')
        const x6 = await thucThiTikTok(c6, kh6.id)
        dung('L1j. thực thi: TikTok trả giá 0 / rỗng ⇒ "failed" không đọc được giá đang bán, KHÔNG gọi đổi giá (trước: biên độ so với 0 ⇒ lọt)',
            x6.status === 'failed' && /không đọc được giá đang bán/.test(x6.result?.message || '') && ghiTT().length === 0, JSON.stringify(x6.result))
        chiTiet['111'] = giaTT(120000, 'sku111')
        const kh7 = await taoKeHoachGiaTikTok(c6, { itemId: '111', price: 131000 })
        chiTiet['111'] = new TypeError('fetch failed')
        const ghi7 = ghiTT().length
        const x7 = await thucThiTikTok(c6, kh7.id)
        dung('L1k. thực thi: ĐỌC giá sống mất mạng (chưa gửi gì) ⇒ "failed" không đọc được giá, không ghi — không phải "uncertain"',
            x7.status === 'failed' && /Không đọc được giá đang bán trên TikTok/.test(x7.result?.message || '') && ghiTT().length === ghi7, JSON.stringify({ st: x7.status, r: x7.result }))
    }

    // L2 (TT-10) — trần ghi / ngày tính TRƯỚC vòng lặp: hết lượt là MỘT dòng 'skipped', không 'failed', không chuông
    {
        // 8 mã thêm đang dưới giá sàn (giá vốn 100.000, TikTok bán 100.000) + OC4 + BINH = 10 ứng viên
        const them8 = () => {
            for (let i = 0; i < 8; i++) {
                hang.push({ id: `pX${i}`, sku: `X${i}`, name: `Hàng X${i}`, description: 'x', costPrice: 100000, sellingPrice: 180000, stock: 5, productType: 'goods', mergedIntoId: null, bundleId: null, category: { name: 'Điện' }, _count: { images: 1 }, images: [] })
                listing.push({ id: `opX${i}`, channelId: 'tt1', categoryId: '601', platformProductId: `90${i}`, name: `Hàng X${i}`, sku: `X${i}`, price: 100000, stock: 5, status: 'ACTIVATE', localProductId: `pX${i}`, imageUrl: null, updatedAt: new Date(10 + i) })
                chiTiet[`90${i}`] = giaTT(100000, `skuX${i}`)
            }
        }
        const daGhi = async (kho: ReturnType<typeof khoBoNhoTikTok>, n: number) => {
            for (let i = 0; i < n; i++) await kho.ghiNhatKy({ action: 'price', status: 'succeeded', planId: null, payload: { truoc: i }, response: null })
        }
        datLai(); datTikTok(); goi.length = 0; bayGio = NOW; them8()
        const kho = khoBoNhoTikTok(() => bayGio)
        await daGhi(kho, 48)
        const ctx = ctxL(kho)
        await luuCauHinhTikTok(ctx, { executionMode: 'auto', policy: { maxWritesPerDay: 50, maxRepricePerCycle: 10 } })
        const kq = await chayChuKyTikTok(ctx)
        const het = kq.results.filter((r: any) => /Đã hết lượt ghi hôm nay/.test(r.message || ''))
        dung('L2a. đã ghi 48/50, chu kỳ 10 ứng viên ⇒ đúng 2 lần ghi lên TikTok', ghiTT().length === 2, JSON.stringify({ ghi: ghiTT(), r: kq.results }))
        dung('L2b. … phần còn lại MỘT dòng "skipped" "Đã hết lượt ghi hôm nay (50/50 …) — còn 8 sản phẩm để mai"; KHÔNG dòng "failed"',
            het.length === 1 && het[0].status === 'skipped' && /\(50\/50 theo chính sách\) — còn 8 sản phẩm để mai/.test(het[0].message)
            && !kq.results.some((r: any) => r.status === 'failed'), JSON.stringify(kq.results))
        dung('L2c. … viecCanNguoi KHÔNG có mục nào từ chuyện hết trần; không lập nháp thừa quá trần',
            viecCanNguoi(kq.results).dong.length === 0 && ctx.kho._keHoach.filter(k => k.status === 'draft').length === 0,
            JSON.stringify({ viec: viecCanNguoi(kq.results), kh: ctx.kho._keHoach.map(k => k.status) }))

        datLai(); datTikTok(); goi.length = 0; them8()
        const kho2 = khoBoNhoTikTok(() => bayGio)
        await daGhi(kho2, 50)
        const ctx2 = ctxL(kho2)
        await luuCauHinhTikTok(ctx2, { executionMode: 'auto', policy: { maxWritesPerDay: 50 } })
        const kq2 = await chayChuKyTikTok(ctx2)
        dung('L2d. đủ 50/50 TRƯỚC chu kỳ ⇒ không đọc / ghi TikTok, không lập kế hoạch, đúng MỘT dòng giá "skipped" hết lượt',
            goi.length === 0 && ctx2.kho._keHoach.length === 0 && dongGia(kq2).length === 1 && dongGia(kq2)[0].status === 'skipped'
            && /^Đã hết lượt ghi hôm nay \(50\/50/.test(dongGia(kq2)[0].message) && viecCanNguoi(kq2.results).dong.length === 0, JSON.stringify(kq2.results))

        // lượt khác (tab khác / thực thi tay) ghi chen giữa chừng ⇒ trần chạm NGAY TRONG thucThi
        datLai(); datTikTok(); goi.length = 0; them8()
        const kho3 = khoBoNhoTikTok(() => bayGio)
        await daGhi(kho3, 48)
        sauGhiGia = async () => { await kho3.ghiNhatKy({ action: 'price', status: 'succeeded', planId: null, payload: { luotKhac: true }, response: null }) }
        const ctx3 = ctxL(kho3)
        await luuCauHinhTikTok(ctx3, { executionMode: 'auto', policy: { maxWritesPerDay: 50 } })
        const kq3 = await chayChuKyTikTok(ctx3)
        sauGhiGia = null
        const het3 = kq3.results.filter((r: any) => /Đã hết lượt ghi hôm nay/.test(r.message || ''))
        dung('L2e. lượt khác ghi chen ⇒ thucThi chạm trần ⇒ MỘT dòng "skipped" (không "failed"), giữ nháp, 1 lần ghi, không chuông',
            ghiTT().length === 1 && het3.length === 1 && het3[0].status === 'skipped' && /còn 9 sản phẩm để mai/.test(het3[0].message)
            && !kq3.results.some((r: any) => r.status === 'failed') && ctx3.kho._keHoach.filter(k => k.status === 'draft').length === 1
            && viecCanNguoi(kq3.results).dong.length === 0, JSON.stringify(kq3.results))
    }

    // L3 (TT-11) — nghỉ 24 giờ tính từ lúc THỰC THI, không phải lúc lập nháp
    {
        datLai(); datTikTok(); goi.length = 0; giaSongTheoGhi = true
        const ctx = ctxL()
        await luuCauHinhTikTok(ctx, { executionMode: 'auto' })
        bayGio = NOW - 2 * 86400_000
        const kh = await taoKeHoachGiaTikTok(ctx, { itemId: '222', price: 150000 })   // nháp lập 2 ngày trước
        bayGio = NOW - 3600_000
        const x = await thucThiTikTok(ctx, kh.id)                                     // duyệt + ghi 1 giờ trước
        bayGio = NOW
        const kq = await chayChuKyTikTok(ctx)
        dung('L3a. nháp lập 2 ngày trước, duyệt + ghi 1 giờ trước ⇒ chu kỳ KHÔNG đổi lại BINH ("vừa đổi giá trong 24 giờ"), không coi là người sửa',
            x.status === 'succeeded' && ghiMa('222').length === 1 && kq.results.some((r: any) => /^1 sản phẩm vừa đổi giá trong 24 giờ/.test(r.message || ''))
            && !kq.results.some((r: any) => /sửa giá tay/.test(r.message || '')), JSON.stringify({ ghi: ghiTT(), r: kq.results }))
        bayGio = NOW + 24 * 3600_000
        await chayChuKyTikTok(ctx)
        dung('L3b. đối chứng: 25 giờ sau lần ghi ⇒ BINH được xét lại (hạ tiếp 10%: 150.000 → 135.000)',
            ghiMa('222').length === 2 && ghiMa('222')[1][2] === 135000, JSON.stringify(ghiTT()))
        bayGio = NOW; giaSongTheoGhi = false
    }

    // L4 (TT-12) — đồng bộ danh mục trong chu kỳ lấy NGÀNH cho mã mới; một mã lỗi không dừng lượt
    {
        datLai(); datTikTok(); goi.length = 0; bayGio = NOW
        const moi = ['701', '702', '703'].map((id, i) => ({ platformProductId: id, name: `Hàng mới ${i + 1}`, sku: `MOI${i + 1}`, price: 99000, stock: 3, status: 'ACTIVATE' }))
        const nganh: Record<string, any> = {
            '701': { categoryId: '601', categoryName: 'Điện > Ổ cắm' }, '702': new Error('TikTok getProduct: [36009004] internal error'),
            '703': { categoryId: '602', categoryName: 'Gia dụng > Bình' },
        }
        const ttDanhMuc = async (): Promise<DichVuTikTok> => ({
            ...(await ttGia()),
            fetchProducts: async () => { goi.push(['danh-muc']); return { products: moi, total: moi.length } },
            fetchProductCategory: async (id: string) => { goi.push(['nganh', id]); const r = nganh[id]; if (r instanceof Error) throw r; return r ?? null },
        })
        const ctx = ctxL(undefined, { taoTikTok: ttDanhMuc })
        const kq = await chayChuKyTikTok(ctx)
        const lp = (id: string) => listing.find(l => l.platformProductId === id)
        const dm = kq.results.find((r: any) => r.action === 'catalog')
        dung('L4a. đồng bộ danh mục trong chu kỳ: 3 mã mới thiếu ngành, mã giữa lỗi ⇒ 2 mã CÓ ngành (cả mã SAU mã lỗi), mã lỗi vẫn trống',
            lp('701')?.categoryId === '601' && lp('703')?.categoryId === '602' && lp('703')?.categoryName === 'Gia dụng > Bình' && lp('702')?.categoryId == null
            && goi.filter(g => g[0] === 'nganh').map(g => g[1]).join() === '701,702,703', JSON.stringify({ l: listing.slice(-3), goi }))
        dung('L4b. … dòng danh mục "succeeded" nói 2/3 mã + 1 mã lỗi; chu kỳ vẫn chạy tiếp (soát giá như thường)',
            dm?.status === 'succeeded' && /Lấy ngành 2\/3 mã chưa rõ ngành/.test(dm?.message || '') && /1 mã lỗi: MOI2/.test(dm?.message || '')
            && dongGia(kq).length > 0, JSON.stringify(kq.results))
        const st = await xayTrangThaiTikTok(ctx)
        dung('L4c. trạng thái báo số mã CHƯA RÕ NGÀNH (gian đã đo phí theo ngành) — tab Định giá hiện', st.status.feeModel.uncategorized === 1, JSON.stringify(st.status.feeModel))

        // hàm dùng chung (nút Đồng bộ ở Đơn online cũng gọi): 3 lỗi liền ⇒ dừng; lỗi token ⇒ dừng ngay
        datLai()
        for (const id of ['801', '802', '803', '804']) listing.push({ id: `op${id}`, channelId: 'tt1', categoryId: null, platformProductId: id, name: id, sku: `S${id}`, price: 1, stock: 0, status: 'ACTIVATE', localProductId: null, imageUrl: null, updatedAt: new Date(1) })
        const hoi: string[] = []
        const r1 = await boSungNganhTikTok(prisma, 'tt1', { fetchProductCategory: async (id: string) => { hoi.push(id); throw new Error('TikTok getProduct: [36009004] busy') } }, { nghiMs: 0 })
        dung('L4d. 3 lỗi LIỀN (sàn trục trặc / rate-limit) ⇒ dừng, mã thứ 4 để lần sau', r1.dung === 'lien-tiep' && hoi.length === 3 && r1.loi.length === 3 && r1.daCo === 0, JSON.stringify(r1))
        hoi.length = 0
        const r2 = await boSungNganhTikTok(prisma, 'tt1', { fetchProductCategory: async (id: string) => { hoi.push(id); throw new Error('TikTok getProduct: [105005] access token expired') } }, { nghiMs: 0 })
        dung('L4e. lỗi token ⇒ dừng ngay sau MỘT lời gọi, báo "token"', r2.dung === 'token' && hoi.length === 1, JSON.stringify(r2))
        datLai()
    }

    // L5 (TT-14) — giá chủ shop vừa sửa tay (khác giá Pilot ghi lần cuối) ⇒ để yên 7 ngày
    {
        datLai(); datTikTok(); goi.length = 0; giaSongTheoGhi = true
        const kho = khoBoNhoTikTok(() => bayGio)
        const ctx = ctxL(kho)
        await luuCauHinhTikTok(ctx, { executionMode: 'auto' })
        bayGio = NOW - 25 * 3600_000                                                   // hôm qua: Pilot ghi BINH 160.000 → 144.000
        const kh = await taoKeHoachGiaTikTok(ctx, { itemId: '222', price: 144000 })
        await thucThiTikTok(ctx, kh.id)
        chiTiet['222'] = giaTT(170000, 'sku222')    // nay chủ shop sửa tay trên Seller Center (bản lưu vẫn 144.000)
        chiTiet['111'] = giaTT(125000, 'sku111')    // OC4: Pilot chưa từng ghi
        bayGio = NOW
        const kq = await chayChuKyTikTok(ctx)
        const giu = kq.results.filter((r: any) => /chủ shop vừa sửa giá tay/.test(r.message || ''))
        dung('L5a. Pilot ghi 144.000 hôm qua, TikTok nay bán 170.000 ⇒ KHÔNG đổi BINH; MỘT dòng "skipped" gộp có ngày để yên (+7 ngày)',
            ghiMa('222').length === 1 && giu.length === 1 && giu[0].status === 'skipped'
            && giu[0].message.startsWith(`1 mã chủ shop vừa sửa giá tay trên TikTok — Pilot để yên tới ${ngayThang(NOW + 7 * 86400_000)}`), JSON.stringify(kq.results))
        dung('L5b. … mã Pilot CHƯA từng ghi (OC4) xét như cũ: TikTok bán 125.000 ⇒ nâng 137.000', ghiMa('111').length === 1 && ghiMa('111')[0][2] === 137000, JSON.stringify(ghiTT()))
        dung('L5c. … giá người sửa không vào việc cần người', viecCanNguoi(kq.results).dong.length === 0, JSON.stringify(viecCanNguoi(kq.results)))
        const st = await xayTrangThaiTikTok(ctx)
        const binh = st.products.find((p: any) => p.itemId === '222')
        dung('L5d. trang: dòng BINH hiện lý do để yên (manual, tới +7 ngày, Pilot ghi 144.000đ / nay 170.000đ), giá lưu theo giá thật',
            binh?.hold?.reason === 'manual' && binh.hold.until === NOW + 7 * 86400_000 && /Pilot ghi 144\.000đ, nay 170\.000đ/.test(binh.hold.message)
            && binh.currentPrice === 170000 && !st.products.find((p: any) => p.itemId === '111')?.hold, JSON.stringify(binh))
        bayGio = NOW + 3 * 3600_000
        await chayChuKyTikTok(ctx)
        dung('L5e. lượt sau trong 7 ngày: vẫn để yên, không thêm dòng giữ mới', ghiMa('222').length === 1 && kho._keHoach.filter(k => k.data?.nguoiSua).length === 1)
        bayGio = NOW + 7 * 86400_000 + 3600_000
        const kq3 = await chayChuKyTikTok(ctx)
        dung('L5f. sau 7 ngày ⇒ xét lại: BINH 170.000 ế + lãi cao ⇒ hạ 10% (153.000)', ghiMa('222').length === 2 && ghiMa('222')[1][2] === 153000, JSON.stringify({ ghi: ghiTT(), r: kq3.results }))

        // lần ghi 'uncertain' (mất mạng sau khi gửi): sàn có thể còn giá CŨ — không phải người sửa
        datLai(); datTikTok(); goi.length = 0
        const kho4 = khoBoNhoTikTok(() => bayGio)
        const ctx4 = ctxL(kho4)
        await luuCauHinhTikTok(ctx4, { executionMode: 'auto' })
        bayGio = NOW - 25 * 3600_000
        const kh4 = await taoKeHoachGiaTikTok(ctx4, { itemId: '222', price: 144000 })
        loiGia = new TypeError('fetch failed')
        const x4 = await thucThiTikTok(ctx4, kh4.id)
        loiGia = null
        bayGio = NOW
        const kq4 = await chayChuKyTikTok(ctx4)
        dung('L5g. lần ghi "uncertain", sàn còn giá cũ 160.000 ⇒ KHÔNG coi là người sửa: BINH xét như thường (ghi lại 144.000)',
            x4.status === 'uncertain' && !kq4.results.some((r: any) => /sửa giá tay/.test(r.message || '')) && !kho4._keHoach.some(k => k.data?.nguoiSua)
            && ghiMa('222').length === 2 && ghiMa('222')[1][2] === 144000, JSON.stringify({ st: x4.status, ghi: ghiTT(), r: kq4.results }))
        bayGio = NOW; giaSongTheoGhi = false
    }

    // L6 (TT-04 một phần) — TikTok khoá giá vì khuyến mãi ⇒ 'skipped' + nghỉ mã đó 24 giờ (KHÔNG gọi API khuyến mãi nào)
    {
        datLai(); datTikTok(); goi.length = 0; giaSongTheoGhi = true; bayGio = NOW
        dung('L6a. nhận lỗi khoá giá vì khuyến mãi: mã 12052038 / 12019045 / câu "price is locked"; lỗi khác thì không',
            laLoiKhoaGiaKhuyenMai(new Error('TikTok prices/update: [12052038] Product price locked due to ongoing promotion'))
            && laLoiKhoaGiaKhuyenMai(new Error('TikTok prices/update: [12019045] price is locked'))
            && laLoiKhoaGiaKhuyenMai(new Error('TikTok prices/update: [1] The price is locked during the campaign'))
            && !laLoiKhoaGiaKhuyenMai(new TypeError('fetch failed')) && !laLoiKhoaGiaKhuyenMai(new Error('TikTok prices/update: [120520380] x')))
        const ctx = ctxL()
        await luuCauHinhTikTok(ctx, { executionMode: 'auto' })
        loiGiaMa['111'] = new Error('TikTok prices/update: [12052038] Product price locked due to ongoing promotion')
        const kq = await chayChuKyTikTok(ctx)
        const oc4 = kq.results.find((r: any) => r.action === 'price' && r.sku === 'OC4')
        dung('L6b. updatePrice ném 12052038 ⇒ dòng OC4 "skipped" "Đang khuyến mãi — TikTok khoá giá", KHÔNG "failed"; BINH vẫn đổi',
            oc4?.status === 'skipped' && /Đang khuyến mãi — TikTok khoá giá/.test(oc4?.message || '') && !kq.results.some((r: any) => r.status === 'failed')
            && ghiMa('222').length === 1, JSON.stringify(kq.results))
        dung('L6c. … không vào việc cần người', viecCanNguoi(kq.results).dong.length === 0, JSON.stringify(viecCanNguoi(kq.results)))
        const st = await xayTrangThaiTikTok(ctx)
        dung('L6d. trang: dòng OC4 hiện lý do để yên "promo"', st.products.find((p: any) => p.itemId === '111')?.hold?.reason === 'promo', JSON.stringify(st.products.find((p: any) => p.itemId === '111')))
        bayGio = NOW + 16 * 3600_000    // đã sang NGÀY khác (khoá idempotency mới) — chỉ còn rào nghỉ 24 giờ chặn thử lại
        const kq2 = await chayChuKyTikTok(ctx)
        dung('L6e. 16 giờ sau (sang ngày mới): mã đó KHÔNG bị thử lại; MỘT dòng gộp "đang khuyến mãi"',
            ghiMa('111').length === 1 && kq2.results.some((r: any) => r.status === 'skipped' && /^1 mã đang khuyến mãi — TikTok khoá giá/.test(r.message || '')), JSON.stringify(kq2.results))
        delete loiGiaMa['111']
        bayGio = NOW + 25 * 3600_000
        await chayChuKyTikTok(ctx)
        dung('L6f. sau 24 giờ ⇒ thử lại, ghi được', ghiMa('111').length === 2 && ghiMa('111')[1][2] === 132000, JSON.stringify(ghiTT()))
        bayGio = NOW; giaSongTheoGhi = false
    }

    // L7 (TT-20) — làm mới token hỏng / mã 105005·106011·106001 ⇒ MỘT dòng 'token', không ghi gì lượt đó
    {
        datLai(); datTikTok(); goi.length = 0; daySo.length = 0; bayGio = NOW
        // token đã hết hạn theo đồng hồ THẬT (moDichVuTikTok so Date.now()); làm mới hỏng; cấm mọi lời gọi mạng thật
        kenh[0].tokenExpiresAt = new Date(Date.now() - 3600_000)
        const lamMoiGoc = TikTokService.prototype.refreshAccessToken
        const fetchGoc = globalThis.fetch
        let soLamMoi = 0, soMang = 0
        TikTokService.prototype.refreshAccessToken = async function () { soLamMoi++; throw new Error('TikTok refresh error: [36004004] refresh token is invalid') }
        globalThis.fetch = (async () => { soMang++; throw new Error('bộ kiểm: cấm gọi mạng') }) as any
        try {
            const kho = khoBoNhoTikTok(() => bayGio)
            const ctx = ctxL(kho, { taoTikTok: undefined })
            await luuCauHinhTikTok(ctx, { executionMode: 'auto', policy: { automation: { reprice: true, syncStock: true } } })
            const kq = await chayChuKyTikTok(ctx)
            const tok = kq.results.filter((r: any) => r.action === 'token')
            const viec = viecCanNguoi(kq.results)
            dung('L7a. làm mới token hỏng ⇒ đúng MỘT dòng action "token": cần uỷ quyền lại gian, ĐƯỜNG BẤM «Cấp lại quyền»',
                soLamMoi === 1 && tok.length === 1 && /^Cần uỷ quyền lại gian TikTok "Kengi TikTok" — Đơn Hàng Online → nút «Kênh bán hàng» → nút «Cấp lại quyền»/.test(tok[0].message),
                JSON.stringify(kq.results))
            dung('L7b. … 0 lời gọi ghi (0 lời gọi mạng), không đẩy tồn, không lập kế hoạch giá',
                soMang === 0 && daySo.length === 0 && kho._keHoach.length === 0 && ghiTT().length === 0, JSON.stringify({ soMang, daySo, kh: kho._keHoach.length }))
            dung('L7c. … viecCanNguoi có ĐÚNG mục token (giữ đường bấm dù cắt 180 ký tự)',
                viec.dong.length === 1 && /uỷ quyền lại/.test(viec.dong[0]) && /«Cấp lại quyền»/.test(viec.dong[0]), JSON.stringify(viec))
            const kh = await taoKeHoachGiaTikTok(ctxL(kho), { itemId: '111', price: 130000 })   // lập lúc token còn tốt (TikTok giả)
            const mang0 = soMang
            const x = await thucThiTikTok(ctxL(kho, { taoTikTok: undefined }), kh.id)
            dung('L7d. người bấm thực thi khi làm mới token hỏng ⇒ "failed" + câu uỷ quyền lại, 0 lời gọi mạng',
                x.status === 'failed' && /^Cần uỷ quyền lại gian TikTok "Kengi TikTok"/.test(x.result?.message || '') && x.result?.loiToken === true && soMang === mang0, JSON.stringify(x.result))
            const kn = await kiemKetNoiTikTok(ctxL(kho, { taoTikTok: undefined }))
            dung('L7e. kiểm kết nối: bước đầu "Làm mới token" HỎNG kèm đường uỷ quyền lại; bước Token API không báo đạt',
                kn.buoc[0]?.ten === 'Làm mới token' && kn.buoc[0].ok === false && /Cấp lại quyền/.test(kn.buoc[0].chiTiet)
                && kn.buoc.find((b: any) => b.ten === 'Token API')?.ok === false, JSON.stringify(kn.buoc))
        } finally {
            TikTokService.prototype.refreshAccessToken = lamMoiGoc
            globalThis.fetch = fetchGoc
        }

        datLai(); datTikTok(); goi.length = 0
        loiGia = new Error('TikTok prices/update: [105005] Access token is expired')
        const c2 = ctxL()
        await luuCauHinhTikTok(c2, { executionMode: 'auto' })
        const kq2 = await chayChuKyTikTok(c2)
        loiGia = null
        dung('L7f. TikTok trả 105005 lúc GHI ⇒ MỘT dòng "token", dừng ghi cả lượt (1 lời gọi đổi giá, không dòng giá "failed")',
            ghiTT().length === 1 && kq2.results.filter((r: any) => r.action === 'token').length === 1
            && !kq2.results.some((r: any) => r.action === 'price' && r.status === 'failed'), JSON.stringify(kq2.results))
        datLai(); datTikTok(); goi.length = 0
        chiTiet['111'] = new Error('TikTok getProduct: [106011] invalid access_token')
        const c3 = ctxL()
        await luuCauHinhTikTok(c3, { executionMode: 'auto' })
        const kq3 = await chayChuKyTikTok(c3)
        dung('L7g. TikTok trả 106011 lúc ĐỌC giá sống ⇒ MỘT dòng "token", 0 lời gọi ghi', ghiTT().length === 0 && kq3.results.filter((r: any) => r.action === 'token').length === 1, JSON.stringify(kq3.results))
        dung('L7h. nhận mã token: 105005 / 106011 / 106001; mã khác thì không',
            ['[105005] x', '[106011] x', '[106001] x'].every(m => laLoiTokenTikTok(new Error(m))) && !laLoiTokenTikTok(new Error('[1050050] x')) && !laLoiTokenTikTok(new Error('[36009004] x')))
        // đẩy tồn (lần ghi ĐẦU của lượt) gặp 105005 ⇒ dòng token, không đổi giá lượt này
        datLai(); datTikTok(); goi.length = 0
        const dayTonToken = async (_p: any, _c: string, o: { dryRun?: boolean }) => o.dryRun
            ? { ok: true, data: { seDay: 3, seBoQua: 0 } }
            : { ok: true, data: { pushed: 0, skipped: 0, failed: 3, errors: ['OC4: TikTok inventory/update: [105005] Access token is expired'] } }
        const c4 = ctxL(undefined, { dayTon: dayTonToken })
        await luuCauHinhTikTok(c4, { executionMode: 'auto', policy: { automation: { reprice: true, syncStock: true } } })
        const kq4 = await chayChuKyTikTok(c4)
        dung('L7i. đẩy tồn gặp 105005 ⇒ MỘT dòng "token", KHÔNG đổi giá lượt này (0 lời gọi đổi giá, một dòng giá "skipped")',
            ghiTT().length === 0 && kq4.results.filter((r: any) => r.action === 'token').length === 1
            && dongGia(kq4).length === 1 && dongGia(kq4)[0].status === 'skipped' && /token TikTok của gian cần uỷ quyền lại/.test(dongGia(kq4)[0].message), JSON.stringify(kq4.results))
        datLai()
    }

    // ─── A. Hoa hồng affiliate TikTok đo từng đơn (10/11/2026, TT-02) ─────────────
    // Statement THẬT (finance 202309, đo 10/11/2026): trường PHẲNG trên từng giao dịch, số là chuỗi, phí mang dấu ÂM; đơn
    // thường vẫn trả đủ 4 trường affiliate = "0". Trước: getOrderSettlement không đọc ⇒ affiliateFee NULL ⇒ mô hình phí
    // không tách được đơn affiliate, giá sàn coi đơn qua affiliate như đơn thường.
    {
        const gd = (them: Record<string, string> = {}) => ({
            statement_id: 's1', status: 'SETTLED', currency: 'VND',
            revenue_amount: '600000', settlement_amount: '400000', fee_amount: '-200000',
            platform_commission_amount: '-60000', iva_vat_amount: '-6000', isr_income_tax_amount: '-3000', pit_amount: '0',
            affiliate_commission_amount: '0', affiliate_commission_before_pit: '0', affiliate_partner_commission_amount: '0',
            affiliate_ads_commission_amount: '0', ...them,
        })
        const boAff = (t: any) => { const x = { ...t }; for (const k of Object.keys(x)) if (/affiliate/.test(k)) delete x[k]; return x }
        dung('A1. đơn thường (4 trường affiliate = "0", như statement thật) ⇒ 0 — biết chắc KHÔNG qua affiliate', hoaHongAffiliateTikTok([gd()]) === 0)
        dung('A2. statement không mang trường affiliate nào ⇒ null (chưa đọc được, KHÁC 0); mảng rỗng / null ⇒ null',
            hoaHongAffiliateTikTok([boAff(gd())]) === null && hoaHongAffiliateTikTok([]) === null && hoaHongAffiliateTikTok(null) === null)
        dung('A3. có cả "trước thuế TNCN" lẫn "sau thuế" + pit ⇒ lấy hoa hồng GỘP một lần (33.000), không cộng đôi',
            hoaHongAffiliateTikTok([gd({ affiliate_commission_amount: '-30000', pit_amount: '-3000', affiliate_commission_before_pit: '-33000' })]) === 33000)
        dung('A4. không có "trước thuế" ⇒ sau thuế + pit (33.000); cộng hoa hồng đối tác + quảng cáo affiliate (⇒ 40.000)',
            hoaHongAffiliateTikTok([gd({ affiliate_commission_amount: '-30000', pit_amount: '-3000' })]) === 33000
            && hoaHongAffiliateTikTok([gd({ affiliate_commission_amount: '-30000', pit_amount: '-3000', affiliate_partner_commission_amount: '-5000', affiliate_ads_commission_amount: '-2000' })]) === 40000)
        dung('A5. pit_amount khác 0 mà KHÔNG có hoa hồng nhà sáng tạo ⇒ không quy cho affiliate (0; chỉ hoa hồng đối tác 5.000 ⇒ 5.000, không 8.000)',
            hoaHongAffiliateTikTok([gd({ pit_amount: '-3000' })]) === 0
            && hoaHongAffiliateTikTok([gd({ pit_amount: '-3000', affiliate_partner_commission_amount: '-5000' })]) === 5000)
        dung('A6. nhiều giao dịch: điều chỉnh hoàn một phần hoa hồng ⇒ bù trừ CÓ DẤU (30.000 − 10.000 = 20.000); hoàn hết ⇒ null (không nói 0 khi không chắc)',
            hoaHongAffiliateTikTok([gd({ affiliate_commission_amount: '-30000' }), gd({ affiliate_commission_amount: '10000' })]) === 20000
            && hoaHongAffiliateTikTok([gd({ affiliate_commission_amount: '-30000' }), gd({ affiliate_commission_amount: '30000' })]) === null)

        // getOrderSettlement đọc thẳng phản hồi (httpGet giả) — cùng hàm FeeSync, nút "Lấy phí", bù hoa hồng gọi
        const svc: any = new TikTokService({ apiKey: 'k', apiSecret: 's', accessToken: 'tk-gia', shopId: '1' } as any)
        let phanHoi: any = null
        svc.httpGet = async () => phanHoi
        phanHoi = { code: 0, data: { statement_transactions: [gd()] } }
        const s1 = await svc.getOrderSettlement('O1')
        phanHoi = { code: 0, data: { statement_transactions: [gd({ fee_amount: '-260000', settlement_amount: '340000', affiliate_commission_amount: '-54000', pit_amount: '-6000', affiliate_commission_before_pit: '-60000' })] } }
        const s2 = await svc.getOrderSettlement('O2')
        phanHoi = { code: 36009002, message: 'Too many requests' }
        const s3 = await svc.getOrderSettlement('O3')
        dung('A7. getOrderSettlement: đơn thường affiliateFee 0, phí 200.000 / thực nhận 400.000; đơn affiliate affiliateFee 60.000 (nằm trong phí 260.000); TikTok từ chối ⇒ null (không ghi gì)',
            s1?.affiliateFee === 0 && s1?.feeAmount === 200000 && s1?.settlementAmount === 400000
            && s2?.affiliateFee === 60000 && s2?.feeAmount === 260000 && s3 === null,
            JSON.stringify({ s1, s2, s3 }))

        // Mô hình phí dùng chung: đủ đơn TikTok biết hoa hồng ⇒ tách affiliate khỏi phí; một đơn affiliate 10% ⇒ giá sàn tính 10%
        const dongThuong = Array.from({ length: 40 }, (_, i) => ({ giaBan: 200000 + i * 1000, phi: Math.round((200000 + i * 1000) * 0.2), aff: 0 }))
        const mauThuong = uocLuongPhi(dongThuong, 6, 'Gian TT')
        const dongCoAff = [...dongThuong.slice(0, 39), { giaBan: 300000, phi: 60000 + 30000, aff: 30000 }]
        const mauAff = uocLuongPhi(dongCoAff, 6, 'Gian TT')
        const giaSan = (m: MauPhi) => tinhGiaDeXuat({ giaVon: 100000, phi: m, bienLoiNhuanPct: 15, bienToiThieuPct: 5, phiDongGoi: 0, phiQuangCaoPct: 0, phiAffiliatePct: 0, thueGtgtPct: 0, lamTron: 1000 } as ThamSoGia).giaSan
        dung('A8. mô hình phí: 40 đơn TikTok biết hoa hồng = 0 ⇒ tách riêng, ghi chú "chưa đơn nào qua affiliate"; thêm MỘT đơn hoa hồng 10% ⇒ tyLeMax 10% và giá sàn TĂNG (chính sách khai 0% vẫn tính số đo)',
            !!mauThuong.affiliate?.tachRieng && mauThuong.affiliate?.soDonCo === 0 && /chưa đơn nào qua affiliate/.test(mauThuong.ghiChu || '')
            && Math.abs((mauAff.affiliate?.tyLeMax || 0) - 0.1) < 1e-9 && (giaSan(mauAff) || 0) > (giaSan(mauThuong) || 0),
            JSON.stringify({ thuong: mauThuong.affiliate, aff: mauAff.affiliate, giaSan: [giaSan(mauThuong), giaSan(mauAff)] }))

        // Lượt BÙ hoa hồng cho đơn đã đối soát trước (cột NULL): gian TikTok hỏi statement, bỏ tiền tố TIK-, 2 luồng
        const donBu = (n: number, dau = 'b') => Array.from({ length: n }, (_, i) => ({ id: `${dau}${i}`, externalOrderId: `TIK-58${i}` }))
        const spBu = (ds: any[]) => {
            const ghi: any[] = [], hoi: any[] = []
            return { ghi, hoi, sp: { onlineOrder: {
                findMany: async (a: any) => { hoi.push(a); const bo = new Set(a?.where?.id?.notIn || []); return ds.filter(d => !bo.has(d.id)) },
                update: async (a: any) => { ghi.push(a) },
            } } }
        }
        const goiTT: string[] = []
        let traVe: (sn: string) => any = () => null
        class TTGia { constructor(_c: any) { } async getOrderSettlement(sn: string) { goiTT.push(sn); return traVe(sn) } }
        class SPGia { constructor(_c: any) { } async getEscrowDetail() { throw new Error('không được gọi Shopee cho gian TikTok') } }
        const chTT = { id: 'chTT', name: 'Gian TT', platform: 'tiktok', apiKey: 'k', apiSecret: 's', accessToken: 'tk-gia', shopId: '1' }
        const b1 = spBu(donBu(4))
        traVe = sn => ({ settlementAmount: 1, feeAmount: 1, revenueAmount: 2, affiliateFee: sn.endsWith('2') ? 12000 : 0 })
        const n1 = await buHoaHongAffiliate(b1.sp, chTT, Date.now() + 60_000, mapWithConcurrency, SPGia, TTGia)
        const cua90 = b1.hoi[0]?.where?.createdAt?.gte ? Math.round((Date.now() - new Date(b1.hoi[0].where.createdAt.gte).getTime()) / 86400_000) : null
        dung('A9. bù hoa hồng gian TikTok: hỏi statement mã KHÔNG tiền tố (58…), ghi đúng affiliateFee (0 / 12.000), cửa sổ 90 ngày như mẫu phí, không đụng Shopee',
            n1 === 4 && goiTT.length === 4 && goiTT.every(s => /^58\d$/.test(s)) && b1.ghi.length === 4
            && b1.ghi.find(g => g.where.id === 'b2')?.data?.affiliateFee === 12000 && b1.ghi.filter(g => g.data.affiliateFee === 0).length === 3 && cua90 === 90,
            JSON.stringify({ n1, goiTT, ghi: b1.ghi, cua90 }))
        // Token chết / sàn bóp hạn mức: 5 đơn liền không đọc được mà chưa đơn nào được ⇒ thôi kênh lượt này; đơn chưa hỏi
        // KHÔNG bị nghỉ 24 giờ (lượt sau hỏi lại ngay), đơn đã hỏng thì nghỉ
        goiTT.length = 0
        const b2 = spBu(donBu(20, 'h'))
        traVe = () => null
        const n2 = await buHoaHongAffiliate(b2.sp, chTT, Date.now() + 60_000, mapWithConcurrency, SPGia, TTGia)
        const soHoi2 = goiTT.length
        const b3 = spBu(donBu(20, 'h'))
        traVe = sn => ({ settlementAmount: 1, feeAmount: 1, revenueAmount: 2, affiliateFee: 0 })
        goiTT.length = 0
        const n3 = await buHoaHongAffiliate(b3.sp, chTT, Date.now() + 60_000, mapWithConcurrency, SPGia, TTGia)
        dung('A10. 5 đơn liền không đọc được (token / hạn mức) ⇒ dừng kênh (≤ 6 lời gọi / 20 đơn, 0 ghi); lượt sau hỏi lại đúng các đơn CHƯA hỏi, đơn đã hỏng nghỉ 24 giờ',
            n2 === 0 && soHoi2 >= 5 && soHoi2 <= 6 && b2.ghi.length === 0 && n3 === 20 - soHoi2 && goiTT.length === 20 - soHoi2,
            JSON.stringify({ n2, soHoi2, n3, hoiLai: goiTT.length }))
    }

    // ─── 9. Nối dây (soát mã nguồn) ─────────────────────────────────────────────
    {
        const goc = path.join(__dirname, '..', 'src')
        const doc = (f: string) => fs.readFileSync(path.join(goc, f), 'utf8')
        const idx = doc('index.ts')
        dung('9a. route /api/tiktok-pilot đã gắn', /app\.use\('\/api\/tiktok-pilot', tiktokPilotRoutes\)/.test(idx) && /import tiktokPilotRoutes from '\.\/routes\/tiktokPilot'/.test(idx))
        dung('9b. lịch chỉ chạy cửa hàng đã bật tiktok_pilot', /includes\(TIEN_ICH_TIKTOK_PILOT\)\) \{[\s\S]{0,200}chayTheoLichTikTok\(/.test(doc('cron/aiAgentCron.ts')))
        dung('9c. /admin/migrate tạo bảng TikTok Pilot', /for \(const sql of SQL_TAO_BANG_TIKTOK_PILOT\)/.test(doc('routes/admin.ts')))
        const rt = doc('routes/tiktokPilot.ts')
        dung('9d. route chặn theo tiện ích tiktok_pilot', /lyDoChanPilot\(req\.user\?\.storeCode, TIEN_ICH_TIKTOK_PILOT\)/.test(rt))
        dung('9e. mọi thao tác ghi đánh dấu ghi: true', ['cycle', 'execute', 'price', 'cancel', 'config'].every(v => new RegExp(`(^|\\s|')${v}'?: \\{\\s*ghi: true`, 'm').test(rt)))
        dung('9f. tiện ích chỉ-quản-trị có tiktok_pilot', /TIEN_ICH_CHI_QUAN_TRI[^\n]*TIEN_ICH_TIKTOK_PILOT\]/.test(doc('lib/tienIchCuaHang.ts')))
        const oo = doc('routes/onlineOrders.ts')
        dung('9g. nút Đồng bộ (Đơn online) lấy ngành bằng hàm chung boSungNganhTikTok — một mã lỗi không còn dừng cả lượt (09/11/2026)',
            /boSungNganhTikTok\(prisma, channel\.id, tkService/.test(oo) && !/break \/\/ rate-limit\/token lỗi/.test(oo))
        dung('9h. hướng dẫn nói thật: Pilot CHƯA biết khuyến mãi SẮP chạy — tắt Tự động đổi giá trước đợt lớn (09/11/2026)',
            /TikTok Pilot CHƯA biết khuyến mãi SẮP chạy — nên tắt Tự động đổi giá/.test(doc('lib/tiktokPilot.ts')))
        const as = doc('cron/autoSync.ts')
        dung('9i. hoa hồng affiliate TikTok (10/11/2026, TT-02): vòng đối soát ghi aff từ statement, lượt bù nhận cả gian TikTok (statement, 2 luồng), nút "Lấy phí" ghi affiliateFee',
            /phi = s\.feeAmount; thucNhan = s\.settlementAmount; aff = s\.affiliateFee \?\? null/.test(as)
            && /kenhBuAff\.push\(\{ schema: store\.schema, ch \}\)/.test(as) && !/if \(ch\.platform === 'shopee'\) kenhBuAff\.push/.test(as)
            && /tiktok \? \(await svc\.getOrderSettlement\(sn\)\)\?\.affiliateFee/.test(as) && /\}, tiktok \? 2 : 6\)/.test(as)
            && /affiliateFee = settlement\.affiliateFee \?\? null/.test(doc('routes/onlineOrders.ts')))
    }

    console.log(`\n${loi === 0 ? '✅' : '❌'} ${dat} đạt, ${loi} hỏng\n`)
    if (loi > 0) process.exitCode = 1
}

main().catch(e => { console.error('LỖI BỘ KIỂM:', e); process.exitCode = 1 })
