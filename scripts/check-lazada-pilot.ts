/* Kiểm chứng LAZADA PILOT (14/11/2026) — npm run check:lazada-pilot
 *
 * Kho kế hoạch trong bộ nhớ + prisma giả (theo `select`) + Lazada giả ghi lại mọi lời gọi + đồng hồ giả. Không gọi mạng, không
 * đụng CSDL. Canh:
 *  1. Chính sách: phần chung kẹp như Shopee Pilot; mặc định đổi giá BẬT, đẩy tồn TẮT, 10 SKU / chu kỳ. Chính sách cho nút tay
 *     "Đẩy giá lên sàn": chưa có bảng ⇒ mặc định (không tạo bảng), đọc hỏng ⇒ NÉM.
 *  2. SKU sống: khoá SKU, giá gốc / khuyến mãi, phân loại, trạng thái; lỗi token ≠ "IP whitelist" ≠ mất mạng.
 *  3. Trạng thái: MỖI SKU một dòng đọc thẳng Lazada; giá vốn SKU đại diện theo mã kho đã nối, phân loại khác theo SellerSku; SKU
 *     khuyến mãi / tắt / mã chưa đồng bộ / chưa nối ⇒ không đổi giá; đọc hỏng ⇒ readError + bản lưu, không dòng nào lập được;
 *     bản đọc ≤ 5 phút dùng lại; phân loại đang bán không bị kể "chưa có trên gian"; trạng thái không ghi gì.
 *  4. Kế hoạch: dưới sàn / vượt biên độ (trừ nâng lên sàn) / khuyến mãi / SKU tắt / thiếu giá vốn / mã nhiều phân loại không chọn
 *     SKU / giá 0 / đọc hỏng / chưa biết phí ⇒ từ chối; khoá idempotency.
 *  5. Thực thi: Xem trước KHÔNG gọi Lazada; Tự động gọi ĐÚNG MỘT lần (hai tab cùng bấm), đúng SkuId + SellerSku; giá Lazada đổi /
 *     SellerSku đổi / mất giá vốn / sàn tăng / SKU vừa khuyến mãi ⇒ không ghi; mất mạng ⇒ 'uncertain'; token ⇒ cờ; "IP whitelist"
 *     không phải token; trần ghi / ngày; chỉ SKU đại diện sửa giá lưu; phí chưa đủ tin ⇒ máy chỉ TĂNG, người duyệt thì hạ được.
 *  6. Chu kỳ: Xem trước chỉ lập nháp, đọc Lazada MỘT lần; sang Tự động thì huỷ nháp cũ + ghi; nghỉ 24 giờ; giá người sửa ⇒ để yên 7
 *     ngày; chưa biết phí ⇒ MỘT dòng, không đọc Lazada, đẩy tồn vẫn chạy; đọc hỏng ⇒ MỘT dòng; token (đọc / ghi / làm mới) ⇒ MỘT
 *     dòng 'token', dừng ghi; hết lượt ghi ⇒ MỘT dòng (cần người khi còn SKU dưới sàn); trần mỗi chu kỳ; phí khai ⇒ hạ giá chờ
 *     người; dọn nháp (3 ngày, người huỷ 14 ngày, nháp người lập để yên); 'running' quá 1 giờ ⇒ 'uncertain'; đẩy tồn; đồng bộ
 *     danh mục cũ.
 *  7. Lịch.  8. Kiểm kết nối (chỉ đọc), làm mới token.  9. Tiện ích lazada_pilot chỉ-quản-trị + nối dây (soát mã nguồn).
 */
import * as fs from 'fs'
import * as path from 'path'
import {
    khoBoNhoLazada, chuanHoaChinhSachLazada, docChinhSachLazada, xayTrangThaiLazada, taoKeHoachGiaLazada, thucThiLazada,
    chayChuKyLazada, luuCauHinhLazada, huyKeHoachLazada, chayTheoLichLazada, kiemKetNoiLazada, moDichVuLazada,
    laLoiTokenLazada, skuTuMaLazada, khoaSkuLazada, xoaBoNhoDocLazada, LoiKhuyenMaiLazada, LoiHetLuotGhi,
    type NgCanhLazada, type DichVuLazada,
} from '../src/lib/lazadaPilot'
import { LazadaService } from '../src/services/platforms/lazada'
import { xoaDemPhiTheoNganh } from '../src/lib/shopeeTuQuan'
import { viecCanNguoi, ketQuaDeBao } from '../src/lib/pilotBaoChuShop'
import { dauNgayVN } from '../src/lib/shopeePilot'
import { ToolError } from '../src/lib/mcpTypes'
import { lyDoChanPilot, datDemTienIch, giuTienIchQuanTri, TIEN_ICH_LAZADA_PILOT } from '../src/lib/tienIchCuaHang'

let loi = 0, dat = 0
const dung = (ten: string, ok: boolean, chiTiet = '') => { ok ? dat++ : loi++; console.log(`${ok ? '✓' : '✗'} ${ten}${chiTiet && !ok ? ' — ' + chiTiet : ''}`) }
const nem = async (f: () => Promise<any>) => { try { await f(); return null } catch (e: any) { return e } }

const GIO = 3600_000, NGAY = 86400_000
const NOW = dauNgayVN(Date.now()) + 9 * GIO
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

/* ── Dữ liệu cửa hàng ── */
let kenh: any[] = []
let listing: any[] = []
let hang: any[] = []
let donPhi: Record<string, { giaBan: number; phi: number }[]> = {}
/** số bán 14 ngày (dòng kiểu cũ { sku, sl } — lib/shopeeThaoTac.soBan14Ngay đọc được) */
let daBan: any[] = []
/** câu lệnh tạo bảng prisma giả nhận — canh "không tạo bảng hộ" */
const taoBang: string[] = []

/**
 * Gian Lazada lz1 (+ gian Shopee sp1 phải bị bỏ qua). Phí đo: `soDon` đơn 14% + 3.000đ ⇒ hàng vốn 100.000đ: đề xuất 146.000 /
 * sàn 127.200 (hộ kinh doanh, như bộ kiểm Shopee / TikTok Pilot). Ít hơn 8 đơn: ô «Phí sàn (%)» 6 = CHƯA BIẾT PHÍ; khác 6 = KHAI.
 *   101 OC4  một SKU, vốn 100k, đang bán 120k < sàn ⇒ chu kỳ nâng lên 132k (+10%)
 *   202 Áo thun ba phân loại: AO-S (SKU lưu của listing, mã kho đã nối p3 vốn 40k), AO-M (mã kho TRÙNG SellerSku, vốn 50k),
 *       AO-L (không mã kho nào)
 *   303 KM   special_price 120k < giá gốc 150k, vốn 100k ⇒ giá khách trả DƯỚI sàn — Pilot để yên, báo chủ shop
 *   404 TAT  mã inactive trên Lazada
 *   505 MOI  có trên Lazada, chưa đồng bộ vào hệ thống
 */
function datLai(soDon = 40, them: { commissionRate?: number } = {}) {
    kenh = [
        { id: 'lz1', name: 'Kengi Lazada', platform: 'lazada', shopId: 'VN1A', accessToken: 'tok', refreshToken: 'r', apiKey: 'k', apiSecret: 's', commissionRate: them.commissionRate ?? 6, tokenExpiresAt: new Date(NOW + 3 * NGAY), createdAt: new Date(1) },
        { id: 'sp1', name: 'Kengi Shopee', platform: 'shopee', shopId: '8001', accessToken: 'tok', commissionRate: 6, createdAt: new Date(0) },
    ]
    const dongBo = new Date(NOW - 10 * 60_000)
    const l = (id: string, ma: string, ten: string, sku: string, price: number, localProductId: string | null, them2: any = {}) =>
        ({ id, channelId: 'lz1', categoryId: '601', platformProductId: ma, name: ten, sku, price, stock: 5, status: 'NORMAL', localProductId, imageUrl: null, updatedAt: new Date(5), syncedAt: dongBo, ...them2 })
    listing = [
        l('op1', '101', 'Ổ cắm điện 4 lỗ', 'OC4', 120000, 'p1', { updatedAt: new Date(5) }),
        l('op2', '202', 'Áo thun', 'AO-S', 90000, 'p3', { updatedAt: new Date(4), stock: 15 }),
        l('op3', '303', 'Bình khuyến mãi', 'KM', 150000, 'pKM', { updatedAt: new Date(3) }),
        l('op4', '404', 'Hàng đang tắt', 'TAT', 100000, 'pTAT', { updatedAt: new Date(2), status: 'UNLIST' }),
        // mã của gian SHOPEE cùng mã sàn 101 — Lazada Pilot không được đụng
        { ...l('opS', '101', 'Ổ cắm (Shopee)', 'OC4', 120000, 'p1'), channelId: 'sp1', updatedAt: new Date(9) },
    ]
    const sp = (id: string, sku: string, costPrice: number, stock = 10) => ({
        id, sku, name: sku, description: 'x', costPrice, sellingPrice: costPrice * 2, stock, productType: 'goods', mergedIntoId: null, bundleId: null,
        category: { name: 'Nhóm' }, _count: { images: 1 }, images: [{ url: `https://a/${id}.jpg` }],
    })
    // p3: mã kho của AO-S KHÁC SellerSku (nối tay) — chỉ đường "SKU đại diện dùng mã kho đã nối của listing" mới ra giá vốn
    hang = [sp('p1', 'OC4', 100000), sp('p3', 'AOTHUN-S', 40000), sp('pAM', 'AO-M', 50000), sp('pKM', 'KM', 100000), sp('pTAT', 'TAT', 50000), sp('p6', 'TUI', 45000, 60)]
    donPhi = { lz1: Array.from({ length: soDon }, (_, i) => { const g = 60000 + i * 10000; return { giaBan: g, phi: 0.14 * g + 3000 } }) }
    daBan = [{ sku: 'oc4', sl: 5 }, { sku: 'ao-s', sl: 3 }, { sku: 'ao-m', sl: 2 }]
    xoaDemPhiTheoNganh()
}

const prisma: any = {
    onlineChannel: {
        findMany: async ({ where, select }: any) => kenh.filter(c => !where?.platform || c.platform === where.platform)
            .sort((a, b) => a.createdAt - b.createdAt).map(c => chon(c, select)),
        findUnique: async ({ where }: any) => kenh.find(c => c.id === where.id) || null,
        update: async () => ({}),
    },
    onlineProduct: {
        findMany: async ({ where, select, take }: any) => listing.filter(l => l.channelId === where.channelId)
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
        findFirst: async ({ where, orderBy, select }: any) => {
            let ds = listing.filter(l => l.channelId === where.channelId && (!where.platformProductId || l.platformProductId === where.platformProductId)
                && (!where.syncedAt || l.syncedAt != null))
            if (orderBy?.syncedAt) ds = [...ds].sort((a, b) => +b.syncedAt - +a.syncedAt)
            return ds[0] ? (select ? chon(ds[0], select) : ds[0]) : null
        },
        update: async ({ where, data }: any) => { const l = listing.find(x => x.id === where.id); if (l) Object.assign(l, data); return l },
        count: async ({ where }: any) => listing.filter(l => l.channelId === where.channelId).length,
    },
    product: {
        findMany: async ({ where, select, take }: any) => hang.filter(h => h.productType === 'goods' && !h.mergedIntoId && !h.bundleId
            && (where?.stock?.gt === undefined || h.stock > where.stock.gt))
            .sort((a, b) => b.stock - a.stock).slice(0, take ?? 1e9).map(h => chon(h, select)),
    },
    skuMapping: { findMany: async () => [] },
    storeSettings: { findFirst: async ({ select }: any = {}) => chon({ businessType: 'household', khoMeMa: null }, select) },
    $executeRawUnsafe: async (sql: string) => { taoBang.push(sql); return 0 },
    $queryRawUnsafe: async (sql: string, ...v: any[]) => {
        if (sql.includes('AS nganh')) return (donPhi[v[0]] || []).map(d => ({ ...d, nganh: '601' }))
        if (sql.includes('"OnlineOrder" o') && sql.includes('platformFee')) return (v[0] as string[]).flatMap(id => donPhi[id] || [])
        if (sql.includes('"OnlineOrderItem"')) return daBan.map(d => ({ ...d }))
        if (sql.includes('FROM "Product"')) {
            const ids: string[] = v[0] || [], skus: string[] = v[1] || []
            return hang.filter(h => ids.includes(h.id) || skus.includes(h.sku.toLowerCase()))
                .map(h => ({ id: h.id, sku: h.sku, name: h.name, description: h.description, costPrice: h.costPrice, mergedIntoId: null, mergedRate: 1 }))
        }
        return []
    },
}

/* ── Lazada giả (hình GetProducts đo thật 13/11/2026, rút gọn) ── */
const goi: any[] = []
let items: any[] = []
let loiDoc: any = null
let loiGia: any = null
/** ghi giá thành công ⇒ giá trên Lazada giả đổi theo */
let giaSongTheoGhi = true
let loiLamMoi: string | null = null
let coFetch = false
const skuLz = (SkuId: number | null, SellerSku: string, price: number, them: any = {}) =>
    ({ ...(SkuId != null ? { SkuId } : {}), SellerSku, price, Status: 'active', quantity: 5, Images: [], saleProp: {}, ...them })
const maLz = (item_id: number, ten: string, skus: any[], them: any = {}) =>
    ({ item_id, primary_category: 601, attributes: { name: ten }, status: 'Active', skus, images: [], ...them })
function datLazada() {
    items = [
        maLz(101, 'Ổ cắm điện 4 lỗ', [skuLz(1011, 'OC4', 120000)]),
        maLz(202, 'Áo thun', [
            skuLz(2021, 'AO-S', 90000, { saleProp: { size: 'S' } }),
            skuLz(2022, 'AO-M', 95000, { saleProp: { size: 'M' } }),
            skuLz(2023, 'AO-L', 99000, { saleProp: { size: 'L' } }),
        ]),
        maLz(303, 'Bình khuyến mãi', [skuLz(3031, 'KM', 150000, { special_price: 120000 })]),
        maLz(404, 'Hàng đang tắt', [skuLz(4041, 'TAT', 100000)], { status: 'inactive' }),
        maLz(505, 'Mã chưa đồng bộ', [skuLz(5051, 'MOI', 100000)]),
    ]
    loiDoc = null; loiGia = null; giaSongTheoGhi = true; loiLamMoi = null; coFetch = false
    xoaBoNhoDocLazada(prisma)
}
const lzGia = async (): Promise<DichVuLazada> => {
    const fb: DichVuLazada = {
        testConnection: async () => ({ success: true, shopName: 'Kengi Lazada' }),
        docSanPhamTho: async () => {
            goi.push(['doc'])
            if (loiDoc) throw loiDoc
            return { items: JSON.parse(JSON.stringify(items)), tong: items.length }
        },
        updatePrice: async (itemId: string, price: number, skuId?: string, sellerSku?: string) => {
            goi.push(['price', itemId, price, skuId, sellerSku])
            if (loiGia) throw loiGia
            if (giaSongTheoGhi) {
                const s = items.find(i => String(i.item_id) === itemId)?.skus.find((x: any) => String(x.SkuId) === skuId)
                if (s) s.price = price
            }
        },
        docGiaoDichTaiChinh: async (o: any) => { goi.push(['taichinh', o]); return { dong: [{ a: 1 }, { a: 2 }] } },
        ...(coFetch ? {
            fetchProducts: async () => { goi.push(['fetch']); return { products: items.map(it => LazadaService.chuyenSanPham(it)).filter(Boolean) as any[] } },
        } : {}),
    }
    if (loiLamMoi) fb.loiLamMoiToken = loiLamMoi
    return fb
}
const doc = () => goi.filter(g => g[0] === 'doc')
const ghiLz = () => goi.filter(g => g[0] === 'price')
/** SKU thô trên Lazada giả theo SellerSku */
const skuCua = (sellerSku: string): any => {
    for (const it of items) for (const s of it.skus) if (s.SellerSku === sellerSku) return s
    throw new Error(`Lazada giả không có SKU ${sellerSku}`)
}
/** sửa dữ liệu Lazada giả rồi bỏ bản đọc nhớ — lần sau đọc lại */
const doiSan = (f: () => void) => { f(); xoaBoNhoDocLazada(prisma) }
const daySo: any[] = []
const dayTonGia = async (_p: any, channelId: string, o: { dryRun?: boolean }) => {
    daySo.push({ channelId, ...o })
    return o.dryRun ? { ok: true, data: { seDay: 3, seBoQua: 7 } } : { ok: true, data: { pushed: 3, skipped: 7, failed: 0 } }
}

type Kho = ReturnType<typeof khoBoNhoLazada>
const khoMoi = (): Kho => khoBoNhoLazada(() => bayGio)
function ngCanh(kho: Kho = khoMoi()): NgCanhLazada & { kho: Kho } {
    return { prisma, kho, nguoi: 'chu@shop', taoLazada: lzGia, dayTon: dayTonGia, bayGio: () => bayGio } as any
}
const dongSku = (st: any, sku: string) => st.products.find((p: any) => p.sellerSku === sku)
const listingCua = (id: string) => listing.find(l => l.id === id)
const json = (x: any) => JSON.stringify(x).slice(0, 1500)

async function main() {
    // ─── 1. Chính sách ───────────────────────────────────────────────────────────
    {
        const c = chuanHoaChinhSachLazada({ targetMarginRate: 0.02, minMarginRate: 0.08, maxWritesPerDay: -5, maxRepricePerCycle: 99, automation: { syncStock: true } })
        dung('1a. mục tiêu không dưới biên tối thiểu, số âm kẹp (như Shopee Pilot)', c.targetMarginRate === 0.08 && c.maxWritesPerDay === 1)
        dung('1b. đổi giá mỗi chu kỳ ≤ 50 SKU; bật đẩy tồn giữ, đổi giá mặc định bật', c.maxRepricePerCycle === 50 && c.automation.syncStock === true && c.automation.reprice === true)
        const m = chuanHoaChinhSachLazada({})
        dung('1c. mặc định: đẩy tồn TẮT, 10 SKU / chu kỳ, sàn 5%, mục tiêu 15%, biên độ 10%, 50 lượt ghi / ngày',
            m.automation.syncStock === false && m.maxRepricePerCycle === 10 && m.minMarginRate === 0.05 && m.targetMarginRate === 0.15 && m.maxPriceChangeRate === 0.1 && m.maxWritesPerDay === 50)
        dung('1d. maxRepricePerCycle âm ⇒ 0 (chu kỳ không đổi giá)', chuanHoaChinhSachLazada({ maxRepricePerCycle: -3 }).maxRepricePerCycle === 0)
        const pz = (f: () => any) => ({ $queryRawUnsafe: async () => f(), $executeRawUnsafe: async (sql: string) => { taoBang.push(sql); return 0 } })
        taoBang.length = 0
        const thieu = await docChinhSachLazada(pz(() => { throw Object.assign(new Error('relation "LazadaPilotConfig" does not exist'), { meta: { code: '42P01' } }) }))
        dung('1e. nút "Đẩy giá": chưa từng dùng Pilot (chưa có bảng) ⇒ chính sách mặc định, KHÔNG tạo bảng hộ', thieu.minMarginRate === 0.05 && thieu.maxRepricePerCycle === 10 && taoBang.length === 0)
        const hong = await nem(() => docChinhSachLazada(pz(() => { throw new Error('Connection terminated unexpectedly') })))
        dung('1f. đọc chính sách hỏng vì lý do khác ⇒ NÉM (không rơi về mặc định có thể lỏng hơn)', hong instanceof ToolError && /Không đọc được chính sách Lazada Pilot/.test(hong.message), hong?.message)
        const daLuu = await docChinhSachLazada(pz(() => [{ policy: JSON.stringify({ minMarginRate: 0.2, targetMarginRate: 0.3 }) }]))
        dung('1g. đã lưu ⇒ đọc đúng', daLuu.minMarginRate === 0.2 && daLuu.targetMarginRate === 0.3)
    }

    // ─── 2. SKU sống + nhận lỗi token ────────────────────────────────────────────
    {
        const ds = skuTuMaLazada(maLz(202, 'Áo thun', [
            skuLz(2021, 'AO-S', 90000, { saleProp: { size: 'S', mau: 'Đỏ' } }),
            skuLz(null, 'AO-X', 0, { special_price: '0' }),
            skuLz(2023, 'AO-L', 99000, { special_price: 80000, Status: 'inactive' }),
        ]))
        dung('2a. khoá SKU = item:SkuId; thiếu SkuId ⇒ item:s:SellerSku', ds[0].khoa === '202:2021' && ds[1].khoa === '202:s:AO-X' && khoaSkuLazada(1, '', 'Z') === '1:s:Z', json(ds.map(s => s.khoa)))
        dung('2b. tên phân loại theo saleProp, số SKU, giá gốc rỗng ⇒ 0, special_price "0" = không khuyến mãi',
            ds[0].phanLoai === 'S / Đỏ' && ds[0].soSku === 3 && ds[1].giaGoc === 0 && ds[1].giaKm === 0 && ds[2].giaKm === 80000, json(ds))
        dung('2c. trạng thái: mã Active ⇒ NORMAL, SKU giữ Status thô', ds[0].trangThaiMa === 'NORMAL' && ds[2].trangThaiSku === 'inactive')
        const mot = skuTuMaLazada(maLz(101, 'Ổ cắm', [skuLz(1011, 'OC4', 120000)], { status: 'inactive' }))
        dung('2d. mã một SKU: không tên phân loại; mã inactive ⇒ UNLIST', mot[0].phanLoai === '' && mot[0].soSku === 1 && mot[0].trangThaiMa === 'UNLIST')
        dung('2e. lỗi token Lazada (IllegalAccessToken / InvalidToken / AccessTokenExpire / làm mới hỏng) ⇒ cần uỷ quyền lại',
            ['Lazada từ chối kênh: [IllegalAccessToken] The specified access token is invalid or expired', 'InvalidToken', 'AccessTokenExpire', 'Lazada refresh error: [IllegalRefreshToken] x']
                .every(m => laLoiTokenLazada(new Error(m))))
        dung('2f. "IP whitelist" / mất mạng / lỗi thường KHÔNG phải token (uỷ quyền lại không ích gì)',
            !laLoiTokenLazada(new Error('Lazada từ chối kênh: [AppWhiteIpLimit] IP whitelist check failed')) && !laLoiTokenLazada(new Error('fetch failed'))
            && !laLoiTokenLazada(new Error('Lazada price_quantity/update: [501] E501: Update product failed')))
    }

    // ─── 3. Trạng thái ───────────────────────────────────────────────────────────
    {
        datLai(); datLazada(); goi.length = 0; bayGio = NOW
        const st = await xayTrangThaiLazada(ngCanh())
        dung('3a. tự chọn gian Lazada duy nhất (bỏ gian Shopee), mặc định Xem trước', st.status.shop?.id === 'lz1' && st.status.executionMode === 'preview' && st.status.channels.length === 1)
        dung('3b. MỖI SKU một dòng đọc thẳng Lazada (5 mã / 7 SKU), khoá item:SkuId',
            st.products.length === 7 && st.status.liveRead?.items === 5 && st.status.liveRead?.skus === 7 && dongSku(st, 'AO-M')?.key === '202:2022', json(st.status.liveRead))
        const oc = dongSku(st, 'OC4')
        dung('3c. giá đề xuất / sàn theo phí Lazada đo từ đơn (14% + 3.000đ ⇒ 146.000 / 127.200); giá đang bán = giá ĐỌC THẲNG',
            oc?.pricing.price === 146000 && oc?.pricing.floor === 127200 && oc?.currentPrice === 120000 && oc?.enabled === true, json(oc))
        dung('3d. phí đủ tin (40 đơn)', st.status.feeModel.trusted === true && st.status.feeModel.orders === 40, json(st.status.feeModel))
        const as = dongSku(st, 'AO-S'), am = dongSku(st, 'AO-M'), al = dongSku(st, 'AO-L')
        dung('3e. nhiều phân loại: SKU đại diện (AO-S) lấy giá vốn mã kho đã nối, phân loại khác (AO-M) theo mã kho TRÙNG SellerSku',
            as?.costPrice === 40000 && as?.enabled === true && am?.costPrice === 50000 && am?.enabled === true && am?.variant === 'M' && am?.skuCount === 3 && am?.mapped === true, json([as, am]))
        dung('3f. phân loại không trùng mã kho nào (AO-L) ⇒ chưa nối, không đổi giá', al?.mapped === false && al?.enabled === false && /Chưa nối/.test(al?.error || ''), json(al))
        const km = dongSku(st, 'KM')
        dung('3g. SKU có giá khuyến mãi ⇒ để yên; giá khách trả = special_price',
            km?.enabled === false && km?.promoPrice === 120000 && km?.customerPrice === 120000 && km?.currentPrice === 150000 && /giá khuyến mãi/.test(km?.error || ''), json(km))
        dung('3h. mã đang tắt trên Lazada ⇒ không đổi giá', dongSku(st, 'TAT')?.enabled === false && /UNLIST/.test(dongSku(st, 'TAT')?.error || ''))
        dung('3i. mã có trên Lazada mà chưa đồng bộ vào hệ thống ⇒ không đổi giá, bảo đồng bộ', dongSku(st, 'MOI')?.enabled === false && /Đồng bộ/.test(dongSku(st, 'MOI')?.error || ''))
        dung('3j. đã bán 14 ngày theo TỪNG SKU', as?.sold14 === 3 && am?.sold14 === 2 && oc?.sold14 === 5, json([as?.sold14, am?.sold14, oc?.sold14]))
        dung('3k. hàng kho chưa có trên gian (TUI) hiện; phân loại ĐANG BÁN trên Lazada (AO-M — listing chỉ lưu SKU đại diện) KHÔNG bị kể là chưa đăng',
            st.unlisted.some((u: any) => u.sku === 'TUI') && !st.unlisted.some((u: any) => u.sku === 'AO-M') && !st.unlisted.some((u: any) => u.sku === 'OC4'), json(st.unlisted.map((u: any) => u.sku)))
        dung('3l. trạng thái ĐỌC Lazada một lần, không ghi gì', doc().length === 1 && ghiLz().length === 0)
        await xayTrangThaiLazada(ngCanh())
        dung('3m. tải lại trong 5 phút ⇒ dùng bản đọc nhớ (không gọi Lazada lần hai)', doc().length === 1)
        bayGio = NOW + 6 * 60_000
        await xayTrangThaiLazada(ngCanh())
        dung('3n. quá 5 phút ⇒ đọc lại', doc().length === 2)
        bayGio = NOW
        dung('3o. hộ kinh doanh + chưa khai thuế ⇒ không nhắc thuế', !st.status.taxNote)

        datLazada(); loiDoc = new Error('Lazada products/get: [E0001] boom')
        const hong = await xayTrangThaiLazada(ngCanh())
        dung('3p. đọc Lazada hỏng ⇒ readError nói rõ, hiện theo bản lưu (4 mã), KHÔNG dòng nào lập kế hoạch được',
            /Không đọc được giá đang bán trên Lazada/.test(hong.status.readError || '') && hong.products.length === 4 && hong.products.every((p: any) => p.enabled === false), json(hong.status))
        datLazada(); loiDoc = new Error('Lazada từ chối kênh: [IllegalAccessToken] The specified access token is invalid or expired')
        const tk = await xayTrangThaiLazada(ngCanh())
        dung('3q. token hỏng ⇒ readError chỉ đường «Cấp lại quyền»', /Cấp lại quyền/.test(tk.status.readError || ''), tk.status.readError)

        datLazada()
        kenh.push({ id: 'lz2', name: 'Lazada 2', platform: 'lazada', shopId: 'VN2', accessToken: 'tok', commissionRate: 6, createdAt: new Date(2) })
        const hai = await xayTrangThaiLazada(ngCanh())
        dung('3r. hai gian Lazada chưa chọn ⇒ không đoán gian, bảo chọn', !hai.status.shop && /2 gian Lazada/.test(hai.status.notice || '') && hai.products.length === 0, json(hai.status))
        const sai = await nem(() => luuCauHinhLazada(ngCanh(), { channelId: 'sp1' }))
        dung('3s. chọn gian không phải Lazada của cửa hàng ⇒ từ chối', sai instanceof ToolError, sai?.message)
    }

    // ─── 4. Kế hoạch giá ─────────────────────────────────────────────────────────
    {
        datLai(); datLazada(); goi.length = 0; bayGio = NOW
        const ctx = ngCanh()
        const k1 = await taoKeHoachGiaLazada(ctx, { itemId: '101', price: 132000 })
        dung('4a. mã một SKU: item_id là đủ; kế hoạch mang khoá SKU, SkuId, SellerSku, giá đang bán ĐỌC THẲNG, giá sàn',
            k1.status === 'draft' && k1.data.khoa === '101:1011' && k1.data.skuId === '1011' && k1.data.sellerSku === 'OC4' && k1.data.snapshot.price === 120000 && k1.data.economics.floor === 127200, json(k1.data))
        const duoi = await nem(() => taoKeHoachGiaLazada(ctx, { itemId: '101', price: 125000 }))
        dung('4b. dưới giá sàn ⇒ từ chối', duoi instanceof ToolError && /sàn/i.test(duoi.message), duoi?.message)
        const vuot = await nem(() => taoKeHoachGiaLazada(ctx, { itemId: '101', price: 140000 }))
        dung('4c. đổi quá biên độ 10% so với giá ĐỌC THẲNG (120.000) ⇒ từ chối', vuot instanceof ToolError && /vượt biên độ/.test(vuot.message), vuot?.message)
        const am = await taoKeHoachGiaLazada(ctx, { itemId: '202', sellerSku: 'ao-m', price: 100000 })
        dung('4d. phân loại chọn theo SellerSku (không phân biệt hoa thường) ⇒ đúng SkuId, giá vốn RIÊNG (50.000)',
            am.data.skuId === '2022' && am.data.sellerSku === 'AO-M' && am.data.variant === 'M' && am.data.economics.cost === 50000 && am.data.snapshot.price === 95000, json(am.data))
        const khongChon = await nem(() => taoKeHoachGiaLazada(ctx, { itemId: '202', price: 95000 }))
        dung('4e. mã nhiều phân loại mà không chọn SKU ⇒ từ chối, nói đúng việc (không phải "Lazada không trả SKU")', khongChon instanceof ToolError && /3 SKU/.test(khongChon.message), khongChon?.message)
        const al = await nem(() => taoKeHoachGiaLazada(ctx, { itemId: '202', skuId: '2023', price: 100000 }))
        dung('4f. SKU chưa có giá vốn ⇒ từ chối', al instanceof ToolError && /giá vốn/.test(al.message), al?.message)
        const km = await nem(() => taoKeHoachGiaLazada(ctx, { itemId: '303', price: 150000 }))
        dung('4g. SKU đang có giá khuyến mãi ⇒ từ chối (để yên cả hai chiều)', km instanceof LoiKhuyenMaiLazada && /khuyến mãi/.test(km.message), km?.message)
        const tat = await nem(() => taoKeHoachGiaLazada(ctx, { itemId: '404', price: 100000 }))
        dung('4h. SKU đang tắt ⇒ từ chối', tat instanceof ToolError && /UNLIST/.test(tat.message), tat?.message)
        const moi = await nem(() => taoKeHoachGiaLazada(ctx, { itemId: '505', price: 100000 }))
        dung('4i. mã chưa đồng bộ vào hệ thống ⇒ từ chối, bảo đồng bộ', moi instanceof ToolError && /Đồng bộ/.test(moi.message), moi?.message)
        const lap = await taoKeHoachGiaLazada(ctx, { itemId: '101', price: 132000, idempotencyKey: 'k-1' })
        const lap2 = await taoKeHoachGiaLazada(ctx, { itemId: '101', price: 131000, idempotencyKey: 'k-1' })
        dung('4j. khoá idempotency ⇒ cùng một kế hoạch', lap.id === lap2.id && lap2.data.price === 132000)
        dung('4k. lập kế hoạch KHÔNG ghi gì lên Lazada; các lần lập trong 60 giây dùng chung MỘT bản đọc', ghiLz().length === 0 && doc().length === 1, `doc=${doc().length}`)
        doiSan(() => { skuCua('OC4').price = 100000 })
        const len = await nem(() => taoKeHoachGiaLazada(ctx, { itemId: '101', price: 127200 }))
        const quaSan = await nem(() => taoKeHoachGiaLazada(ctx, { itemId: '101', price: 130000 }))
        dung('4l. đang dưới sàn: nâng THẲNG lên giá sàn được dù vượt biên độ (+27%); quá giá sàn thì vẫn theo biên độ',
            len === null && quaSan instanceof ToolError && /vượt biên độ/.test(quaSan.message), `${len?.message} | ${quaSan?.message}`)
        doiSan(() => { skuCua('OC4').price = 0 })
        const khong = await nem(() => taoKeHoachGiaLazada(ctx, { itemId: '101', price: 127200 }))
        dung('4m. Lazada trả giá gốc 0 / rỗng ⇒ từ chối (không có mốc biên độ)', khong instanceof ToolError && /giá gốc 0/.test(khong.message), khong?.message)
        doiSan(() => { skuCua('OC4').price = 120000; loiDoc = new Error('Lazada products/get: [E0001] boom') })
        const so = ctx.kho._keHoach.length
        const hong = await nem(() => taoKeHoachGiaLazada(ctx, { itemId: '101', price: 130000 }))
        dung('4n. đọc Lazada hỏng ⇒ từ chối, không lưu kế hoạch', hong instanceof ToolError && /Không đọc được giá đang bán/.test(hong.message) && ctx.kho._keHoach.length === so, hong?.message)
        doiSan(() => { loiDoc = new Error('Lazada từ chối kênh: [IllegalAccessToken] The specified access token is invalid or expired') })
        const tok = await nem(() => taoKeHoachGiaLazada(ctx, { itemId: '101', price: 130000 }))
        dung('4o. token hỏng lúc đọc ⇒ từ chối, chỉ đường «Cấp lại quyền»', tok instanceof ToolError && /Cấp lại quyền/.test(tok.message), tok?.message)
        datLai(5); datLazada()
        const cb = await nem(() => taoKeHoachGiaLazada(ngCanh(), { itemId: '101', price: 130000 }))
        dung('4p. CHƯA BIẾT PHÍ (5 đơn, ô phí còn 6% mặc định) ⇒ từ chối', cb instanceof ToolError && /Chưa biết phí/.test(cb.message), cb?.message)
    }

    // ─── 5. Thực thi ─────────────────────────────────────────────────────────────
    {
        datLai(); datLazada(); goi.length = 0; bayGio = NOW
        const ctx = ngCanh()
        const k = await taoKeHoachGiaLazada(ctx, { itemId: '101', price: 132000 })
        const xem = await thucThiLazada(ctx, k.id)
        dung('5a. Xem trước: thực thi KHÔNG gọi Lazada, kế hoạch vẫn nháp', xem.executed === false && ghiLz().length === 0 && (await ctx.kho.layKeHoach(k.id))?.status === 'draft')
        await luuCauHinhLazada(ctx, { executionMode: 'auto' })
        await Promise.all([thucThiLazada(ctx, k.id), thucThiLazada(ctx, k.id)])
        const g = ghiLz()
        dung('5b. Tự động: hai tab bấm cùng lúc ⇒ Lazada được gọi ĐÚNG MỘT lần, đúng item + giá + SkuId + SellerSku',
            g.length === 1 && g[0][1] === '101' && g[0][2] === 132000 && g[0][3] === '1011' && g[0][4] === 'OC4', json(g))
        const kXong = await ctx.kho.layKeHoach(k.id)
        dung('5c. succeeded, sổ ghi một dòng price, giá lưu của SKU đại diện cập nhật — listing gian Shopee cùng mã sàn KHÔNG đổi',
            kXong?.status === 'succeeded' && ctx.kho._nhatKy.filter(w => w.action === 'price').length === 1
            && listingCua('op1')?.price === 132000 && listingCua('opS')?.price === 120000)
        dung('5c2. kết quả ghi đúng giá CŨ (120.000, đọc trước lần ghi) → giá mới — không lấy nhầm bản đọc nhớ đã sửa',
            kXong?.result?.old_price === 120000 && kXong?.result?.new_price === 132000 && kXong?.result?.sku_id === '1011', json(kXong?.result))
        const st5 = await xayTrangThaiLazada(ctx)
        dung('5c3. ghi xong ⇒ trang (bản đọc nhớ) hiện giá MỚI, không đọc lại Lazada', dongSku(st5, 'OC4')?.currentPrice === 132000 && doc().length === 1, `${dongSku(st5, 'OC4')?.currentPrice} doc=${doc().length}`)
        dung('5d. đổi cấu hình ghi sổ "config" nhưng KHÔNG ăn trần ghi / ngày', (await ctx.kho.demGhiTuLuc(dauNgayVN(bayGio))) === 1 && ctx.kho._nhatKy.some(w => w.action === 'config'))

        const kAm = await taoKeHoachGiaLazada(ctx, { itemId: '202', skuId: '2022', price: 100000 })
        await thucThiLazada(ctx, kAm.id)
        const gAm = ghiLz().at(-1)
        dung('5e. phân loại AO-M (không đại diện): ghi đúng SkuId 2022, KHÔNG sửa giá lưu của listing (giá của AO-S)',
            gAm?.[1] === '202' && gAm?.[3] === '2022' && gAm?.[4] === 'AO-M' && gAm?.[2] === 100000 && listingCua('op2')?.price === 90000, json(gAm))
        const kAs = await taoKeHoachGiaLazada(ctx, { itemId: '202', skuId: '2021', price: 95000 })
        await thucThiLazada(ctx, kAs.id)
        dung('5f. SKU đại diện AO-S ⇒ sửa giá lưu của listing', listingCua('op2')?.price === 95000)

        const so = () => ghiLz().length
        const kDoi = await taoKeHoachGiaLazada(ctx, { itemId: '202', skuId: '2022', price: 108000 })
        doiSan(() => { skuCua('AO-M').price = 125000 })   // người sửa trên Seller Center ⇒ 108.000 thành −13,6%
        let n = so()
        const rDoi = await thucThiLazada(ctx, kDoi.id)
        dung('5g. giá trên Lazada đổi từ lúc lập (vượt biên độ so với giá MỚI) ⇒ failed, không ghi', rDoi.status === 'failed' && /đã đổi từ lúc lập kế hoạch/.test(rDoi.result?.message || '') && so() === n, rDoi.result?.message)

        const kSku = await taoKeHoachGiaLazada(ctx, { itemId: '101', price: 138000 })
        doiSan(() => { skuCua('OC4').SellerSku = 'OC4-MOI' })
        n = so()
        const rSku = await thucThiLazada(ctx, kSku.id)
        dung('5h. SellerSku của SKU đổi trên Lazada ⇒ failed (giá vốn có thể khác), không ghi', rSku.status === 'failed' && /SellerSku/.test(rSku.result?.message || '') && so() === n, rSku.result?.message)
        doiSan(() => { skuCua('OC4-MOI').SellerSku = 'OC4' })

        const kVon = await taoKeHoachGiaLazada(ctx, { itemId: '101', price: 138000 })
        hang.find(h => h.id === 'p1')!.costPrice = 0
        n = so()
        const rVon = await thucThiLazada(ctx, kVon.id)
        dung('5i. mất giá vốn lúc thực thi ⇒ failed, không ghi', rVon.status === 'failed' && /giá vốn/.test(rVon.result?.message || '') && so() === n, rVon.result?.message)
        hang.find(h => h.id === 'p1')!.costPrice = 100000

        const kSan = await taoKeHoachGiaLazada(ctx, { itemId: '101', price: 138000 })
        hang.find(h => h.id === 'p1')!.costPrice = 120000   // sàn mới ~152.600 > 138.000
        n = so()
        const rSan = await thucThiLazada(ctx, kSan.id)
        dung('5j. giá vốn tăng ⇒ giá kế hoạch thành dưới sàn ⇒ failed, không ghi', rSan.status === 'failed' && /đã đổi từ lúc lập kế hoạch/.test(rSan.result?.message || '') && so() === n, rSan.result?.message)
        hang.find(h => h.id === 'p1')!.costPrice = 100000

        const kKm = await taoKeHoachGiaLazada(ctx, { itemId: '101', price: 138000 })
        doiSan(() => { skuCua('OC4').special_price = 125000 })
        n = so()
        const rKm = await thucThiLazada(ctx, kKm.id)
        dung('5k. SKU vừa có giá khuyến mãi lúc thực thi ⇒ skipped (không phải hỏng), không ghi', rKm.status === 'skipped' && rKm.result?.khuyenMai === true && so() === n, json(rKm.result))
        doiSan(() => { delete skuCua('OC4').special_price })

        const kMang = await taoKeHoachGiaLazada(ctx, { itemId: '101', price: 138000 })
        loiGia = new Error('fetch failed')
        const rMang = await thucThiLazada(ctx, kMang.id)
        dung('5l. mất mạng lúc gửi ⇒ uncertain, bảo kiểm Lazada Seller Center', rMang.status === 'uncertain' && /Lazada Seller Center/.test(rMang.result?.message || ''), json(rMang.result))
        const kTok = await taoKeHoachGiaLazada(ctx, { itemId: '101', price: 138000 })
        loiGia = new Error('Lazada từ chối kênh: [IllegalAccessToken] The specified access token is invalid or expired')
        const rTok = await thucThiLazada(ctx, kTok.id)
        dung('5m. Lazada báo token hỏng lúc ghi ⇒ failed + cờ loiToken (chu kỳ đổi thành MỘT dòng token)', rTok.status === 'failed' && rTok.result?.loiToken === true && /IllegalAccessToken/.test(rTok.result?.lyDoToken || ''), json(rTok.result))
        const kIp = await taoKeHoachGiaLazada(ctx, { itemId: '101', price: 138000 })
        loiGia = new Error('Lazada từ chối kênh: [AppWhiteIpLimit] IP whitelist check failed')
        const rIp = await thucThiLazada(ctx, kIp.id)
        dung('5n. "IP whitelist" ⇒ failed thường, KHÔNG cờ token', rIp.status === 'failed' && !rIp.result?.loiToken, json(rIp.result))
        loiGia = null

        loiLamMoi = 'Lazada refresh error: [IllegalRefreshToken] refresh token expired'
        const ctx2 = ngCanh(ctx.kho)   // lượt mới ⇒ mở dịch vụ lại, lần này làm mới token hỏng
        const kLm = await taoKeHoachGiaLazada(ctx2, { itemId: '101', price: 138000 })
        n = so()
        const rLm = await thucThiLazada(ctx2, kLm.id)
        dung('5o. làm mới token hỏng lúc mở dịch vụ ⇒ failed + cờ token, KHÔNG gọi Lazada, câu báo chỉ đường «Cấp lại quyền»',
            rLm.status === 'failed' && rLm.result?.loiToken === true && so() === n && /Cấp lại quyền/.test(rLm.result?.message || ''), json(rLm.result))
        loiLamMoi = null

        const daGhi = await ctx.kho.demGhiTuLuc(dauNgayVN(bayGio))
        await luuCauHinhLazada(ctx, { policy: { maxWritesPerDay: daGhi } })
        const kTran = await taoKeHoachGiaLazada(ctx, { itemId: '101', price: 138000 })
        n = so()
        const rTran = await nem(() => thucThiLazada(ctx, kTran.id))
        dung('5p. chạm trần thao tác ghi / ngày ⇒ dừng (LoiHetLuotGhi), kế hoạch vẫn nháp, không gọi Lazada',
            rTran instanceof LoiHetLuotGhi && (await ctx.kho.layKeHoach(kTran.id))?.status === 'draft' && so() === n, rTran?.message)
    }
    {
        // phí KHAI 25% (5 đơn — chưa đo được): sàn OC4 142.900 / đề xuất 167.000; AO-S sàn 57.200 / đề xuất 67.000
        datLai(5, { commissionRate: 25 }); datLazada(); goi.length = 0; bayGio = NOW
        const ctx = ngCanh()
        await luuCauHinhLazada(ctx, { executionMode: 'auto' })
        const kHa = await taoKeHoachGiaLazada(ctx, { itemId: '202', skuId: '2021', price: 81000 })
        dung('5q. phí KHAI (chưa đo) ⇒ kế hoạch mang cảnh báo phí chưa đủ tin', !!kHa.data.feeWarning, json(kHa.data))
        const rTay = await thucThiLazada(ctx, kHa.id)
        dung('5r. NGƯỜI duyệt HẠ giá với phí khai ⇒ được ghi', rTay.status === 'succeeded' && ghiLz().length === 1, json(rTay.result))
        const kMay = await taoKeHoachGiaLazada(ctx, { itemId: '202', skuId: '2021', price: 74000 })
        const rMay = await thucThiLazada(ctx, kMay.id, { tuDong: true })
        dung('5s. MÁY tự HẠ giá khi phí chưa đủ tin ⇒ failed "Không tự hạ giá", không ghi', rMay.status === 'failed' && /Không tự hạ giá/.test(rMay.result?.message || '') && ghiLz().length === 1, rMay.result?.message)
        const kTang = await taoKeHoachGiaLazada(ctx, { itemId: '101', price: 142900 })
        const rTang = await thucThiLazada(ctx, kTang.id, { tuDong: true })
        dung('5t. MÁY TĂNG giá khi phí chưa đủ tin ⇒ được ghi, kèm cảnh báo', rTang.status === 'succeeded' && /Chỉ được TĂNG giá/.test(rTang.result?.warning || '') && ghiLz().length === 2, json(rTang.result))
    }

    // ─── 6. Chu kỳ ───────────────────────────────────────────────────────────────
    {
        datLai(); datLazada(); goi.length = 0; daySo.length = 0; bayGio = NOW
        const ctx = ngCanh()
        const kq = await chayChuKyLazada(ctx)
        const nhap = ctx.kho._keHoach.filter(k => k.status === 'draft')
        dung('6a. Xem trước: chỉ lập nháp (OC4 120.000 → 132.000 vì dưới sàn), KHÔNG gọi ghi Lazada',
            ghiLz().length === 0 && nhap.length === 1 && nhap[0].data.khoa === '101:1011' && nhap[0].data.price === 132000 && String(nhap[0].idempotencyKey).startsWith('cycle:xem:'), json(kq.results))
        dung('6b. chu kỳ đọc Lazada ĐÚNG một lần cho cả gian', doc().length === 1)
        const kmDuoi = kq.results.find((r: any) => r.canNguoi && /DƯỚI GIÁ SÀN đang chạy giá khuyến mãi/.test(r.message))
        dung('6c. SKU khuyến mãi mà giá khách trả DƯỚI SÀN ⇒ dòng cần người (KM 120.000đ < sàn 127.200đ)', !!kmDuoi && /KM 120\.000đ < sàn 127\.200đ/.test(kmDuoi.message), json(kq.results))
        dung('6d. SKU khuyến mãi để yên (đếm), mã chưa đồng bộ nói ra, SKU tắt KHÔNG báo',
            kq.results.some((r: any) => /1 SKU đang có giá khuyến mãi/.test(r.message)) && kq.results.some((r: any) => /1 SKU của mã chưa đồng bộ/.test(r.message))
            && !kq.results.some((r: any) => /TAT/.test(r.message || '')), json(kq.results))
        dung('6e. đẩy tồn TẮT mặc định ⇒ không gọi', daySo.length === 0)
        const bao = viecCanNguoi(ketQuaDeBao({ ok: true, results: kq.results }, true).results).dong
        dung('6f. Xem trước: báo chủ shop KHÔNG kể nháp / khuyến mãi (chưa đụng sàn)', bao.length === 0, json(bao))
        const kq2 = await chayChuKyLazada(ngCanh(ctx.kho))
        dung('6g. Xem trước lần hai: nháp cũ GIỮ, không lập trùng, nói "đang có nháp chờ duyệt"',
            ctx.kho._keHoach.filter(k => k.status === 'draft').length === 1 && kq2.results.some((r: any) => /1 SKU đang có nháp chờ duyệt/.test(r.message)), json(kq2.results))

        await luuCauHinhLazada(ctx, { executionMode: 'auto' })
        const kq3 = await chayChuKyLazada(ngCanh(ctx.kho))
        const huy = ctx.kho._keHoach.find(k => String(k.idempotencyKey).startsWith('cycle:xem:'))
        const g = ghiLz()
        dung('6h. sang Tự động: nháp Xem trước tự huỷ (tuHuy) rồi lập lại + GHI đúng một lần, đúng SKU',
            huy?.status === 'cancelled' && huy?.result?.tuHuy === true && g.length === 1 && g[0][1] === '101' && g[0][2] === 132000 && g[0][3] === '1011'
            && kq3.results.some((r: any) => r.action === 'plan' && /Huỷ 1 nháp/.test(r.message)), json(kq3.results))
        const dong = kq3.results.find((r: any) => r.action === 'price' && r.sku === 'OC4')
        dung('6i. dòng kết quả: succeeded, giá cũ → giá mới + lý do', dong?.status === 'succeeded' && /120\.000đ → 132\.000đ: Đang dưới giá sàn/.test(dong?.message || ''), json(dong))
        dung('6j. Tự động: báo chủ shop có dòng SKU khuyến mãi dưới sàn (cần người)', viecCanNguoi(kq3.results).dong.some(d => /DƯỚI GIÁ SÀN/.test(d)))

        bayGio = NOW + 2 * GIO
        const kq4 = await chayChuKyLazada(ngCanh(ctx.kho))
        dung('6k. vừa đổi trong 24 giờ (132.000 đã trên sàn, lãi 8% < mục tiêu) ⇒ CHỜ, không ghi lần hai', ghiLz().length === 1 && kq4.results.some((r: any) => /1 SKU vừa đổi giá trong 24 giờ/.test(r.message)), json(kq4.results))
        bayGio = NOW + 25 * GIO
        const kq5 = await chayChuKyLazada(ngCanh(ctx.kho))
        dung('6l. quá 24 giờ tính từ lúc THỰC THI ⇒ đổi tiếp (132.000 → 145.000, tối đa +10%)', ghiLz().length === 2 && ghiLz()[1][2] === 145000, json(kq5.results))

        bayGio = NOW + 50 * GIO
        doiSan(() => { skuCua('OC4').price = 140000 })
        const kq6 = await chayChuKyLazada(ngCanh(ctx.kho))
        const ghiNho = ctx.kho._keHoach.find(k => k.status === 'skipped' && k.data?.nguoiSua)
        dung('6m. giá đang bán (140.000) ≠ giá Pilot ghi (145.000) ⇒ người sửa tay: để yên, KHÔNG ghi, nói tới ngày nào',
            ghiLz().length === 2 && ghiNho?.data?.nguoiSua?.gia === 140000 && ghiNho?.data?.nguoiSua?.giaPilot === 145000
            && kq6.results.some((r: any) => /1 SKU chủ shop vừa sửa giá tay trên Lazada — Pilot để yên tới/.test(r.message)), json(kq6.results))
        dung('6n. giá lưu của SKU đại diện theo giá người sửa', listingCua('op1')?.price === 140000)
        const st = await xayTrangThaiLazada(ngCanh(ctx.kho))
        dung('6o. trang: SKU mang hold "manual"; dòng ghi nhớ không lẫn vào danh sách kế hoạch', dongSku(st, 'OC4')?.hold?.reason === 'manual' && !st.plans.some((p: any) => p.id === ghiNho?.id), json(dongSku(st, 'OC4')?.hold))
        bayGio = NOW + 50 * GIO + 8 * NGAY
        const kq7 = await chayChuKyLazada(ngCanh(ctx.kho))
        dung('6p. hết 7 ngày để yên ⇒ xét lại như thường (140.000 → 146.000)', ghiLz().length === 3 && ghiLz()[2][2] === 146000, json(kq7.results))
    }
    {
        datLai(); datLazada(); goi.length = 0; bayGio = NOW
        const ctx = ngCanh()
        await xayTrangThaiLazada(ctx)              // trang vừa đọc (bản nhớ còn hạn 5 phút)
        skuCua('OC4').price = 128000               // chủ shop sửa trên Seller Center — bản đọc nhớ KHÔNG bị bỏ
        bayGio = NOW + 60_000
        await chayChuKyLazada(ngCanh(ctx.kho))
        const nhap = ctx.kho._keHoach.find(k => k.status === 'draft' && k.data?.khoa === '101:1011')
        dung('6P. chu kỳ đọc MỚI, không dùng bản đọc của trang 1 phút trước: OC4 nay 128.000 (≥ sàn) ⇒ quyết theo giá mới (→ 140.000)',
            doc().length === 2 && nhap?.data?.snapshot?.price === 128000 && nhap?.data?.price === 140000, `doc=${doc().length} ${json(nhap?.data)}`)
    }
    {
        datLai(5); datLazada(); goi.length = 0; daySo.length = 0; bayGio = NOW
        const ctx = ngCanh()
        await luuCauHinhLazada(ctx, { executionMode: 'auto', policy: { automation: { syncStock: true } } })
        const kq = await chayChuKyLazada(ctx)
        const cb = kq.results.filter((r: any) => r.action === 'cycle')
        dung('6q. CHƯA BIẾT PHÍ ⇒ MỘT dòng cần người (khai phí), KHÔNG đọc Lazada, không ghi',
            cb.length === 1 && cb[0].canNguoi === true && /CHƯA BIẾT PHÍ/.test(cb[0].message) && doc().length === 0 && ghiLz().length === 0, json(kq.results))
        dung('6r. … đẩy tồn vẫn chạy (chạy thử rồi đẩy thật, đúng gian)', daySo.some(d => d.dryRun) && daySo.some(d => !d.dryRun) && daySo.every(d => d.channelId === 'lz1'), json(daySo))
    }
    {
        datLai(); datLazada(); goi.length = 0; bayGio = NOW
        const ctx = ngCanh()
        await luuCauHinhLazada(ctx, { executionMode: 'auto' })
        loiDoc = new Error('Lazada products/get: [E0001] boom')
        const kq = await chayChuKyLazada(ctx)
        const gia = kq.results.filter((r: any) => r.action === 'price')
        dung('6s. đọc Lazada hỏng ⇒ MỘT dòng lý do, không SKU nào đổi giá, không nháp',
            gia.length === 1 && /chu kỳ không đổi giá SKU nào/.test(gia[0].message) && ghiLz().length === 0 && ctx.kho._keHoach.length === 0, json(kq.results))
        loiDoc = new Error('Lazada từ chối kênh: [IllegalAccessToken] The specified access token is invalid or expired')
        const kt = await chayChuKyLazada(ngCanh(ctx.kho))
        const tok = kt.results.filter((r: any) => r.action === 'token')
        dung('6t. token hỏng lúc đọc ⇒ MỘT dòng token cần người; «Cấp lại quyền» nằm trong 180 ký tự đầu của tin báo',
            tok.length === 1 && tok[0].canNguoi === true && viecCanNguoi(kt.results).dong.some(d => /Cấp lại quyền/.test(d)) && ghiLz().length === 0, json(kt.results))
        dung('6u. Xem trước cũng báo token (ketQuaDeBao giữ dòng token)', ketQuaDeBao({ ok: true, results: kt.results }, true).results.some((r: any) => r.action === 'token'))
        loiDoc = new Error('Lazada từ chối kênh: [AppWhiteIpLimit] IP whitelist check failed')
        const kip = await chayChuKyLazada(ngCanh(ctx.kho))
        dung('6v. "IP whitelist" ⇒ dòng lỗi thường (nguyên văn), KHÔNG dòng token',
            !kip.results.some((r: any) => r.action === 'token') && kip.results.some((r: any) => r.action === 'price' && r.status === 'failed' && /IP whitelist/.test(r.message)), json(kip.results))
        loiDoc = null
        loiLamMoi = 'Lazada refresh error: [IllegalRefreshToken] refresh token expired'
        goi.length = 0
        const klm = await chayChuKyLazada(ngCanh(ctx.kho))
        dung('6w. làm mới token hỏng ⇒ MỘT dòng token, KHÔNG đọc / ghi Lazada',
            klm.results.filter((r: any) => r.action === 'token').length === 1 && goi.length === 0 && klm.results.some((r: any) => /Không đổi giá lượt này — token/.test(r.message)), json(klm.results))
        loiLamMoi = null
    }
    {
        datLai(); datLazada(); goi.length = 0; bayGio = NOW
        doiSan(() => { skuCua('AO-M').price = 60000 })   // AO-M dưới sàn (~65.500) ⇒ ứng viên thứ hai
        const ctx = ngCanh()
        await luuCauHinhLazada(ctx, { executionMode: 'auto' })
        loiGia = new Error('Lazada từ chối kênh: [IllegalAccessToken] The specified access token is invalid or expired')
        const kq = await chayChuKyLazada(ctx)
        dung('6x. token hỏng ngay lần ghi đầu ⇒ MỘT dòng token, DỪNG (không thử SKU thứ hai), không dòng "failed" lẻ',
            ghiLz().length === 1 && kq.results.filter((r: any) => r.action === 'token').length === 1 && !kq.results.some((r: any) => r.action === 'price' && r.status === 'failed'), json(kq.results))
        loiGia = null
    }
    {
        datLai(); datLazada(); goi.length = 0; bayGio = NOW
        const ctx = ngCanh()
        await luuCauHinhLazada(ctx, { executionMode: 'auto', policy: { maxWritesPerDay: 1 } })
        await ctx.kho.ghiNhatKy({ action: 'price', status: 'succeeded', planId: null, payload: {}, response: null })   // đã ghi 1 lần hôm nay
        const kq = await chayChuKyLazada(ctx)
        const het = kq.results.filter((r: any) => /Đã hết lượt ghi hôm nay/.test(r.message || ''))
        dung('6y. hết lượt ghi trước chu kỳ ⇒ MỘT dòng skipped (không failed), CẦN NGƯỜI vì OC4 đang dưới sàn, chỉ Lazada Seller Center',
            het.length === 1 && het[0].status === 'skipped' && het[0].canNguoi === true && /OC4 120\.000đ < sàn 127\.200đ/.test(het[0].message) && /Lazada Seller Center/.test(het[0].message)
            && ghiLz().length === 0 && !kq.results.some((r: any) => r.status === 'failed'), json(kq.results))
        dung('6z. hết lượt ghi ⇒ không để nháp sót', ctx.kho._keHoach.filter(k => k.status === 'draft').length === 0)
    }
    {
        datLai(); datLazada(); goi.length = 0; bayGio = NOW
        doiSan(() => { skuCua('AO-M').price = 60000 })
        const ctx = ngCanh()
        await luuCauHinhLazada(ctx, { executionMode: 'auto', policy: { maxRepricePerCycle: 1 } })
        const kq = await chayChuKyLazada(ctx)
        dung('6A. trần mỗi chu kỳ 1 SKU ⇒ ghi 1, báo còn 1 SKU chờ chu kỳ sau', ghiLz().length === 1 && kq.results.some((r: any) => /Mỗi chu kỳ đổi tối đa 1 SKU — còn 1 SKU/.test(r.message)), json(kq.results))
    }
    {
        datLai(5, { commissionRate: 25 }); datLazada(); goi.length = 0; bayGio = NOW
        daBan = [{ sku: 'oc4', sl: 5 }]   // AO-S 14 ngày không bán, lãi 30,6% > mục tiêu + 10 ⇒ máy muốn HẠ
        const ctx = ngCanh()
        await luuCauHinhLazada(ctx, { executionMode: 'auto' })
        const kq = await chayChuKyLazada(ctx)
        const g = ghiLz()
        const nhap = ctx.kho._keHoach.filter(k => k.status === 'draft')
        dung('6B. phí KHAI: máy TĂNG OC4 thẳng lên sàn (142.900) ⇒ ghi; HẠ AO-S ⇒ nháp CHỜ NGƯỜI DUYỆT, không ghi',
            g.length === 1 && g[0][1] === '101' && g[0][2] === 142900 && nhap.length === 1 && nhap[0].data.sellerSku === 'AO-S'
            && kq.results.some((r: any) => r.canNguoi && /CHỜ NGƯỜI DUYỆT/.test(r.message)), json(kq.results))
        const kq2 = await chayChuKyLazada(ngCanh(ctx.kho))
        dung('6C. nháp HẠ giá chờ người: lượt Tự động sau KHÔNG tự huỷ, không lập trùng', ctx.kho._keHoach.filter(k => k.status === 'draft').length === 1 && (await ctx.kho.layKeHoach(nhap[0].id))?.status === 'draft', json(kq2.results))
    }
    {
        datLai(); datLazada(); goi.length = 0; bayGio = NOW
        const ctx = ngCanh()
        ctx.kho._keHoach.push({
            id: 'cu1', kind: 'price', status: 'draft', idempotencyKey: 'cycle:xem:price:101:1011:2026-01-01:130000',
            data: { khoa: '101:1011', itemId: '101', sku: 'OC4', price: 130000, snapshot: { price: 120000 } }, result: null, createdBy: 'lich', createdAt: NOW - 4 * NGAY, updatedAt: NOW - 4 * NGAY,
        })
        const kq = await chayChuKyLazada(ctx)
        const c = await ctx.kho.layKeHoach('cu1')
        dung('6D. nháp máy lập quá 3 ngày ⇒ tự huỷ (tuHuy) + lập nháp mới theo giá hiện tại', c?.status === 'cancelled' && c?.result?.tuHuy === true
            && ctx.kho._keHoach.some(k => k.status === 'draft' && k.data?.price === 132000), json(kq.results))
        const moi = ctx.kho._keHoach.find(k => k.status === 'draft' && k.data?.price === 132000)!
        await huyKeHoachLazada(ctx, moi.id)
        bayGio = NOW + 2 * NGAY
        const kq2 = await chayChuKyLazada(ngCanh(ctx.kho))
        dung('6E. NGƯỜI huỷ ⇒ 14 ngày không đề xuất lại', ctx.kho._keHoach.filter(k => k.status === 'draft').length === 0 && kq2.results.some((r: any) => /1 SKU đang có nháp chờ duyệt \/ người vừa huỷ/.test(r.message)), json(kq2.results))
        bayGio = NOW + 15 * NGAY
        await chayChuKyLazada(ngCanh(ctx.kho))
        dung('6F. quá 14 ngày ⇒ đề xuất lại', ctx.kho._keHoach.some(k => k.status === 'draft' && k.data?.khoa === '101:1011'))
        const huyLai = await nem(() => huyKeHoachLazada(ctx, 'cu1'))
        dung('6G. huỷ kế hoạch không còn là nháp ⇒ từ chối', huyLai instanceof ToolError)
    }
    {
        datLai(); datLazada(); goi.length = 0; bayGio = NOW
        const ctx = ngCanh()
        const tay = await taoKeHoachGiaLazada(ctx, { itemId: '101', price: 130000 })
        await luuCauHinhLazada(ctx, { executionMode: 'auto' })
        const kq = await chayChuKyLazada(ngCanh(ctx.kho))
        dung('6H. nháp NGƯỜI lập: máy không huỷ, không ghi đè SKU đó', (await ctx.kho.layKeHoach(tay.id))?.status === 'draft' && ghiLz().length === 0
            && kq.results.some((r: any) => /1 SKU đang có nháp chờ duyệt/.test(r.message)), json(kq.results))
    }
    {
        datLai(); datLazada(); goi.length = 0; bayGio = NOW
        const ctx = ngCanh()
        ctx.kho._keHoach.push({
            id: 'chay1', kind: 'price', status: 'running', idempotencyKey: null,
            data: { khoa: '202:2022', itemId: '202', sku: 'AO-M', price: 100000, snapshot: { price: 95000 } }, result: null, createdBy: 'chu@shop', createdAt: NOW - 3 * GIO, updatedAt: NOW - 2 * GIO,
        })
        const kq = await chayChuKyLazada(ctx)
        const u = kq.results.filter((r: any) => r.status === 'uncertain')
        dung('6I. "running" quá 1 giờ ⇒ uncertain, báo MỘT lần (kiểm Lazada Seller Center)', u.length === 1 && u[0].planId === 'chay1' && /Lazada Seller Center/.test(u[0].message)
            && (await ctx.kho.layKeHoach('chay1'))?.status === 'uncertain', json(kq.results))
        dung('6J. sau uncertain: giá đang bán = giá TRƯỚC lần ghi (95.000) ⇒ KHÔNG coi là người sửa', !ctx.kho._keHoach.some(k => k.data?.nguoiSua))
        const kq2 = await chayChuKyLazada(ngCanh(ctx.kho))
        dung('6K. lượt sau không báo lại', !kq2.results.some((r: any) => r.status === 'uncertain'), json(kq2.results))
    }
    {
        datLai(); datLazada(); goi.length = 0; daySo.length = 0; bayGio = NOW
        const ctx = ngCanh()
        await luuCauHinhLazada(ctx, { policy: { automation: { syncStock: true, reprice: false } } })
        const kq = await chayChuKyLazada(ctx)
        dung('6L. Xem trước + bật đẩy tồn ⇒ CHỈ chạy thử; tắt đổi giá ⇒ không đọc Lazada',
            daySo.length === 1 && daySo[0].dryRun === true && daySo[0].channelId === 'lz1' && kq.results.some((r: any) => r.action === 'stock' && r.status === 'preview' && /sẽ đẩy 3 mã/.test(r.message))
            && doc().length === 0, json(kq.results))
        await luuCauHinhLazada(ctx, { policy: { automation: { syncStock: false, reprice: false } } })
        const tat = await chayChuKyLazada(ngCanh(ctx.kho))
        dung('6M. tắt cả hai ⇒ một dòng "Chính sách đang tắt", không gọi gì', tat.results.length === 1 && /đang tắt/.test(tat.results[0].message) && daySo.length === 1 && doc().length === 0, json(tat.results))
    }
    {
        datLai(); datLazada(); goi.length = 0; bayGio = NOW
        for (const l of listing) l.syncedAt = new Date(NOW - 3 * GIO)
        coFetch = true
        const ctx = ngCanh()
        const kq = await chayChuKyLazada(ctx)
        const dm = kq.results.find((r: any) => r.action === 'catalog')
        dung('6N. danh mục cũ hơn 2 giờ ⇒ đồng bộ lại (mã 505 vào hệ thống), không xoá mã nào, mã kho đã nối giữ nguyên',
            dm?.status === 'succeeded' && listing.some(l => l.channelId === 'lz1' && l.platformProductId === '505') && listing.filter(l => l.channelId === 'lz1').length === 5
            && listingCua('op1')?.localProductId === 'p1', json(dm))
        goi.length = 0
        const kq2 = await chayChuKyLazada(ngCanh(ctx.kho))
        dung('6O. vừa đồng bộ ⇒ lượt sau không đồng bộ lại', !kq2.results.some((r: any) => r.action === 'catalog') && !goi.some(g => g[0] === 'fetch'))
    }

    // ─── 7. Chạy theo lịch ──────────────────────────────────────────────────────
    {
        datLai(); datLazada(); goi.length = 0; bayGio = NOW
        const kho = khoMoi()
        const ctx = ngCanh(kho)
        const ngoai = { taoLazada: lzGia, dayTon: dayTonGia, bayGio: () => bayGio }
        dung('7a. chưa có cấu hình ⇒ không dùng', (await chayTheoLichLazada(prisma, kho, ngoai)) === 'khong-dung')
        taoBang.length = 0
        dung('7b. cửa hàng chưa từng dùng Pilot (không bảng) ⇒ không dùng, KHÔNG tạo bảng hộ', (await chayTheoLichLazada(prisma, undefined, ngoai)) === 'khong-dung' && taoBang.length === 0)
        await luuCauHinhLazada(ctx, { schedule: { enabled: true, intervalMinutes: 60 } })
        dung('7c. chưa tới hẹn ⇒ chưa chạy', (await chayTheoLichLazada(prisma, kho, ngoai)) === 'chua-toi')
        bayGio = NOW + 61 * 60_000
        const r = await chayTheoLichLazada(prisma, kho, ngoai)
        const c = await kho.docCauHinh()
        dung('7d. tới hẹn ⇒ chạy, ghi kết quả, hẹn lượt kế; Xem trước ⇒ không ghi giá',
            r === 'da-chay' && c?.lastRunAt === bayGio && c?.nextRunAt === bayGio + 60 * 60_000 && ghiLz().length === 0 && c?.lastResult?.ok === true, `${r} ${json(c?.lastResult)}`)
        dung('7e. kế hoạch của lượt lịch ghi người "lich"', kho._keHoach.length > 0 && kho._keHoach.every(k => k.createdBy === 'lich'))
        bayGio = NOW + 125 * 60_000
        dung('7f. bản khác đã giành lượt ⇒ bi-gianh, không chạy', (await chayTheoLichLazada(prisma, { ...kho, gianhLich: async () => false } as any, ngoai)) === 'bi-gianh')
        const kenhCu = kenh
        kenh = kenh.filter(k => k.platform !== 'lazada')
        const rl = await chayTheoLichLazada(prisma, kho, ngoai)
        const c2 = await kho.docCauHinh()
        dung('7g. chu kỳ gãy (mất gian) ⇒ loi, vẫn hẹn lượt kế, ghi lý do', rl === 'loi' && c2?.nextRunAt === bayGio + 60 * 60_000 && c2?.lastResult?.ok === false
            && /chưa kết nối gian Lazada/.test(c2?.lastResult?.message || ''), json(c2?.lastResult))
        kenh = kenhCu
        await luuCauHinhLazada(ctx, { schedule: { enabled: false } })
        bayGio = NOW + 300 * 60_000
        dung('7h. tắt lịch ⇒ không dùng', (await chayTheoLichLazada(prisma, kho, ngoai)) === 'khong-dung')
        bayGio = NOW
    }

    // ─── 8. Kiểm kết nối + làm mới token ────────────────────────────────────────
    {
        datLai(); datLazada(); goi.length = 0; bayGio = NOW
        const kn = await kiemKetNoiLazada(ngCanh())
        dung('8a. kiểm kết nối chỉ ĐỌC, đủ bước (gian, sản phẩm + giá từng SKU, tài chính, token), đều đạt',
            kn.tong === 4 && kn.dat === 4 && ghiLz().length === 0 && /5 mã \/ 7 SKU \(6 đang bán, 1 mã nhiều phân loại\) · 1 SKU có giá khuyến mãi/.test(kn.buoc[1]?.chiTiet || '')
            && goi.some(g => g[0] === 'taichinh'), json(kn))
        loiLamMoi = 'Lazada refresh error: [IllegalRefreshToken] refresh token expired'
        const kh = await kiemKetNoiLazada(ngCanh())
        dung('8b. làm mới token hỏng ⇒ bước «Làm mới token» trượt, chỉ đường uỷ quyền lại; bước Token API trượt',
            kh.buoc[0]?.ten === 'Làm mới token' && kh.buoc[0]?.ok === false && /Cấp lại quyền/.test(kh.buoc[0]?.chiTiet || '') && kh.buoc.find((b: any) => b.ten === 'Token API')?.ok === false, json(kh))
        loiLamMoi = null

        const goc = LazadaService.prototype.refreshAccessToken
        const capNhat: any[] = []
        let kenhMoi: any = null
        const pz: any = { onlineChannel: { update: async (a: any) => { capNhat.push(a); return {} }, findUnique: async () => kenhMoi } }
        const sapHet = () => new Date(Date.now() + 60_000)
        try {
            let lam = 0
            LazadaService.prototype.refreshAccessToken = async function () { lam++; return { accessToken: 'moi', refreshToken: 'r2', expiresIn: 604800 } as any }
            await moDichVuLazada(pz, { id: 'c', name: 'G', accessToken: 'cu', refreshToken: 'r', tokenExpiresAt: new Date(Date.now() + 3 * NGAY) })
            dung('8c. token còn hạn ⇒ KHÔNG làm mới', lam === 0 && capNhat.length === 0)
            const ch: any = { id: 'c', name: 'G', accessToken: 'cu', refreshToken: 'r', tokenExpiresAt: sapHet() }
            const fb: any = await moDichVuLazada(pz, ch)
            dung('8d. còn < 5 phút ⇒ làm mới, LƯU token mới, dịch vụ dùng token mới', lam === 1 && capNhat[0]?.data?.accessToken === 'moi' && fb.credentials.accessToken === 'moi' && !fb.loiLamMoiToken && ch.accessToken === 'moi')
            LazadaService.prototype.refreshAccessToken = async function () { throw new Error('Lazada refresh error: [IllegalRefreshToken] x') }
            kenhMoi = { id: 'c', accessToken: 'cu', refreshToken: 'r', tokenExpiresAt: sapHet() }
            const fb2: any = await moDichVuLazada(pz, { id: 'c', name: 'G', accessToken: 'cu', refreshToken: 'r', tokenExpiresAt: sapHet() })
            dung('8e. làm mới hỏng, không bản nào vừa làm mới ⇒ ghi lý do lên dịch vụ (chu kỳ ra dòng token)', /IllegalRefreshToken/.test(fb2.loiLamMoiToken || ''))
            kenhMoi = { id: 'c', accessToken: 'banKhac', refreshToken: 'r3', tokenExpiresAt: new Date(Date.now() + 7 * NGAY) }
            const fb3: any = await moDichVuLazada(pz, { id: 'c', name: 'G', accessToken: 'cu', refreshToken: 'r', tokenExpiresAt: sapHet() })
            dung('8f. làm mới hỏng nhưng bản khác VỪA làm mới ⇒ dùng token đó, không báo lỗi', fb3.credentials.accessToken === 'banKhac' && !fb3.loiLamMoiToken)
        } finally { LazadaService.prototype.refreshAccessToken = goc }
    }

    // ─── 9. Tiện ích + nối dây (soát mã nguồn) ──────────────────────────────────
    {
        datDemTienIch('CH_A', ['shopee_pilot', 'tiktok_pilot', 'facebook_pilot'])
        datDemTienIch('CH_B', ['lazada_pilot'])
        const a = await lyDoChanPilot('CH_A', TIEN_ICH_LAZADA_PILOT)
        dung('9a. bật Shopee / TikTok / Facebook Pilot KHÔNG mở Lazada Pilot', a?.ma === 'chua_bat_tien_ich' && /Lazada Pilot/.test(a.loi), json(a))
        dung('9b. bật lazada_pilot ⇒ dùng được', (await lyDoChanPilot('CH_B', TIEN_ICH_LAZADA_PILOT)) === null)
        dung('9c. lazada_pilot chỉ quản trị bật: duyệt nâng cấp giữ, yêu cầu không tự bật được',
            TIEN_ICH_LAZADA_PILOT === 'lazada_pilot' && giuTienIchQuanTri(['online'], ['lazada_pilot']).includes('lazada_pilot') && !giuTienIchQuanTri(['lazada_pilot'], []).includes('lazada_pilot'))
        const nguon = (p: string) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8')
        const idx = nguon('src/index.ts'), cron = nguon('src/cron/aiAgentCron.ts'), adm = nguon('src/routes/admin.ts'), bao = nguon('src/lib/pilotBaoChuShop.ts')
        const rt = nguon('src/routes/lazadaPilot.ts'), dg = nguon('src/lib/dayGiaLenSan.ts'), dc = nguon('src/lib/pilotDoiCauHinh.ts')
        dung('9d. route /api/lazada-pilot gắn vào app', /app\.use\('\/api\/lazada-pilot', lazadaPilotRoutes\)/.test(idx) && /import lazadaPilotRoutes from '\.\/routes\/lazadaPilot'/.test(idx))
        dung('9e. cron chạy lịch Lazada Pilot CHỈ cho cửa hàng bật lazada_pilot, giữ kết nối (giuClient)',
            /includes\(TIEN_ICH_LAZADA_PILOT\)\)\s*\{\s*const nha = giuClient\(store\.schema\)[\s\S]{0,120}chayTheoLichLazada\(getStorePrisma\(store\.schema\)\)[\s\S]{0,400}finally\s*\{\s*nha\(\)/.test(cron))
        dung('9f. /admin/migrate tạo bảng Lazada Pilot', /for \(const sql of SQL_TAO_BANG_LAZADA_PILOT\)/.test(adm))
        dung('9g. thông báo bấm vào mở /pilot-lazada', /\['Lazada Pilot', '\/pilot-lazada'\]/.test(bao))
        dung('9h. route: chặn tiện ích chưa bật + quyền xem giá vốn + chỉ quản lý được ghi',
            /lyDoChanPilot\(req\.user\?\.storeCode, TIEN_ICH_LAZADA_PILOT\)/.test(rt) && /chanXemPilot\('Lazada Pilot', true\)/.test(rt) && /QUAN_LY\.includes/.test(rt)
            && /router\.post\('\/:action', authMiddleware, chanChuaBat, chanXem,/.test(rt) && /router\.get\('\/state', authMiddleware, chanChuaBat, chanXem,/.test(rt))
        dung('9i. nút "Đẩy giá lên sàn" kênh Lazada theo chính sách Lazada Pilot', /await docChinhSachLazada\(prisma\)/.test(dg))
        dung('9j. sổ đổi cấu hình có nhãn Lazada (gian, SKU / chu kỳ)', /export const NHAN_LAZADA/.test(dc) && /Gian Lazada Pilot quản/.test(dc))
    }

    console.log(`\n${dat} ca đạt, ${loi} ca hỏng`)
    if (loi) process.exit(1)
}

main().catch(e => { console.error(e); process.exit(1) })
