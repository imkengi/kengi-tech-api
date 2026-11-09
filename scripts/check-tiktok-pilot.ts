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
 */
import * as fs from 'fs'
import * as path from 'path'
import {
    khoBoNhoTikTok, chuanHoaChinhSachTikTok, xayTrangThaiTikTok, taoKeHoachGiaTikTok, thucThiTikTok, chayChuKyTikTok,
    luuCauHinhTikTok, huyKeHoachTikTok, chayTheoLichTikTok, kiemKetNoiTikTok, LoiNhieuSku, type NgCanhTikTok, type DichVuTikTok,
} from '../src/lib/tiktokPilot'
import { docMauPhi, xoaDemPhiTheoNganh, tomTatMauPhi } from '../src/lib/shopeeTuQuan'
import { tinhGiaDeXuat, lyDoPhiChuaDuTin, chanGiaDuoiSan, uocLuongPhi, type MauPhi, type ThamSoGia } from '../src/lib/giaShopee'
import { viecCanNguoi } from '../src/lib/pilotBaoChuShop'
import { dauNgayVN } from '../src/lib/shopeePilot'
import { ToolError } from '../src/lib/mcpTypes'
import { lyDoChanPilot, datDemTienIch, giuTienIchQuanTri, TIEN_ICH_TIKTOK_PILOT } from '../src/lib/tienIchCuaHang'

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
let daBan: { sku: string; sl: number }[] = []
function datLai(soDon = 40) {
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
        findMany: async ({ where, select, take }: any) => listing.filter(l => l.channelId === where.channelId && (!where.status?.in || where.status.in.includes(l.status)))
            .sort((a, b) => b.updatedAt - a.updatedAt).slice(0, take ?? 1e9).map(l => chon(l, select)),
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
        if (sql.includes('"OnlineOrderItem"')) return daBan.map(d => ({ sku: d.sku, sl: d.sl }))
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
let chiTiet: Record<string, any> = {}
let loiGia: any = null
const giaTT = (gia: number, id = 'sku') => ({ skus: [{ id, seller_sku: 'x', price: { tax_exclusive_price: String(gia) } }] })
function datTikTok() {
    chiTiet = { '111': giaTT(120000, 'sku111'), '222': giaTT(160000, 'sku222'), '333': { skus: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }, '555': giaTT(100000, 'sku555') }
}
const ttGia = async (): Promise<DichVuTikTok> => ({
    testConnection: async () => ({ success: true, shopName: 'Kengi TikTok' }),
    getProductDetail: async (id: string) => { goi.push(['detail', id]); return chiTiet[id] || { skus: [] } },
    updatePrice: async (id: string, gia: number, skuId?: string) => { goi.push(['price', id, gia, skuId]); if (loiGia) throw loiGia },
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
    }

    console.log(`\n${loi === 0 ? '✅' : '❌'} ${dat} đạt, ${loi} hỏng\n`)
    if (loi > 0) process.exitCode = 1
}

main().catch(e => { console.error('LỖI BỘ KIỂM:', e); process.exitCode = 1 })
