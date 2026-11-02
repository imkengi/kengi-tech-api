/* Kiểm chứng TIKTOK PILOT (02/11/2026) — npx tsx scripts/check-tiktok-pilot.ts
 *
 * Kho kế hoạch trong bộ nhớ + prisma giả (theo `select`) + TikTok giả ghi lại mọi lời gọi + đồng hồ giả. Canh:
 *  1. Chính sách: phần chung kẹp như Shopee Pilot, mặc định đổi giá BẬT / đẩy tồn TẮT.
 *  2. Trạng thái: tự chọn gian TikTok duy nhất, Xem trước; giá đề xuất / giá sàn theo PHÍ TIKTOK đo từ đơn (cùng công thức
 *     Shopee Pilot); listing chưa nối mã kho / không đang bán / nhiều SKU thì không đổi giá; hàng kho chưa có trên gian.
 *  3. Phí: gian TikTok mới MƯỢN số đo của gian TikTok khác (không mượn Shopee).
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
import { docMauPhi } from '../src/lib/shopeeTuQuan'
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
let daBan: { sku: string; sl: number }[] = []
function datLai(soDon = 40) {
    kenh = [
        { id: 'tt1', name: 'Kengi TikTok', platform: 'tiktok', shopId: '7001', accessToken: 'tok', refreshToken: 'r', apiKey: 'k', apiSecret: 's', commissionRate: 6, tokenExpiresAt: new Date(NOW + 3 * 86400_000), createdAt: new Date(1) },
        { id: 'sp1', name: 'Kengi Shopee', platform: 'shopee', shopId: '8001', accessToken: 'tok', commissionRate: 6, createdAt: new Date(0) },
    ]
    listing = [
        { id: 'op1', channelId: 'tt1', platformProductId: '111', name: 'Ổ cắm điện 4 lỗ', sku: 'OC4', price: 120000, stock: 12, status: 'ACTIVATE', localProductId: 'p1', imageUrl: null, updatedAt: new Date(5) },
        { id: 'op2', channelId: 'tt1', platformProductId: '222', name: 'Bình giữ nhiệt', sku: 'BINH', price: 160000, stock: 30, status: 'ACTIVATE', localProductId: 'p2', imageUrl: null, updatedAt: new Date(4) },
        { id: 'op3', channelId: 'tt1', platformProductId: '333', name: 'Áo thun nhiều size', sku: 'AO', price: 90000, stock: 50, status: 'ACTIVATE', localProductId: 'p3', imageUrl: null, updatedAt: new Date(3) },
        { id: 'op4', channelId: 'tt1', platformProductId: '444', name: 'Hàng chưa nối', sku: 'XYZ', price: 50000, stock: 5, status: 'ACTIVATE', localProductId: null, imageUrl: null, updatedAt: new Date(2) },
        { id: 'op5', channelId: 'tt1', platformProductId: '555', name: 'Hàng đang ẩn', sku: 'OC4B', price: 100000, stock: 5, status: 'SELLER_DEACTIVATED', localProductId: 'p5', imageUrl: null, updatedAt: new Date(1) },
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
        if (sql.includes('"OnlineOrder" o') && sql.includes('platformFee')) return (v[0] as string[]).flatMap(id => donPhi[id] || [])
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

    // ─── 3. Phí: mượn gian CÙNG SÀN ─────────────────────────────────────────────
    {
        datLai(0)
        kenh.push({ id: 'tt2', name: 'TikTok cũ', platform: 'tiktok', shopId: '7002', accessToken: 'tok', commissionRate: 6, createdAt: new Date(2) })
        donPhi.tt2 = Array.from({ length: 40 }, (_, i) => { const g = 60000 + i * 10000; return { giaBan: g, phi: 0.1 * g + 2000 } })
        donPhi.sp1 = Array.from({ length: 40 }, (_, i) => { const g = 60000 + i * 10000; return { giaBan: g, phi: 0.3 * g } })
        const m = await docMauPhi(prisma, kenh[0])
        dung('3a. gian TikTok chưa có đơn ⇒ mượn gian TIKTOK khác (10%), không mượn Shopee (30%)', Math.abs(m.tyLe - 0.1) < 0.005 && /gian TikTok khác/.test(m.ghiChu), `${m.tyLe} ${m.ghiChu}`)
        const s = await docMauPhi(prisma, { ...kenh[1], id: 'spMoi', platform: 'shopee' })
        dung('3b. gian Shopee vẫn mượn gian Shopee (câu chữ cũ giữ nguyên)', Math.abs(s.tyLe - 0.3) < 0.01 && /gian Shopee khác/.test(s.ghiChu), `${s.tyLe} ${s.ghiChu}`)
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
        dung('6f. Tự động: đẩy tồn thật (không chạy thử)', daySo.length === 1 && !daySo[0].dryRun)

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
