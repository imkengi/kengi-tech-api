/* Kiểm chứng SHOPEE PILOT + AI CHẠY KHÔNG PHÁT SINH LỖ (01/11/2026) — npx tsx scripts/check-pilot-khong-lo.ts
 *
 * Chủ shop: "Hãy test xem đã toàn diện chưa, có thể chạy mà không phát sinh lỗ chưa". Canh MỌI đường ghi giá ra Shopee:
 *  A. Lõi giá, 4.000 bộ tham số ngẫu nhiên (hạt cố định): giá đề xuất ≥ giá sàn; ở giá sàn đơn qua affiliate vẫn đạt
 *     biên tối thiểu; giá nào lọt rào chanGiaDuoiSan cũng lãi ≥ biên tối thiểu kể cả đơn affiliate; giá đề xuất đạt biên
 *     mục tiêu với đơn thường; thuế GTGT đầu ra trừ đúng v/(1+v).
 *  B. Chu kỳ quyết giá (ngẫu nhiên): không ra giá dưới sàn, không đổi ngược chiều, không vượt biên độ trừ khi nâng lên sàn.
 *  C. Tham số tool AI chỉ CHẶT hơn chính sách Pilot (ngẫu nhiên, gồm số âm / chữ / rỗng); bỏ trống = đúng chính sách.
 *  D. Mô phỏng 400 gian có đơn affiliate trộn trong số đo phí: mọi giá MÁY được tự ghi đều không lỗ kể cả đơn affiliate;
 *     cách cũ (sàn không cộng affiliate) thì có lỗ — đường lỗ có thật.
 *  D2. 3.000 gian có phí biến động chủ shop KHÔNG khai (affiliate / voucher ở một phần đơn), 8–200 đơn đo: mọi giá máy
 *     tự ghi có lãi kỳ vọng ≥ 0. Rào cũ (3σ, từ 8 đơn) để lọt giá lỗ — ra rào 4σ + ≥ 30 đơn (SO_DON_TU_GHI).
 *  D3. Phí thật ở vùng giá chưa từng bán khác đường đo được (mức phí tối thiểu) ⇒ không ngoại suy dưới đơn rẻ nhất.
 *  D4. Hoa hồng affiliate ĐO TỪNG ĐƠN (OnlineOrder.affiliateFee): tách khỏi phí khi đủ đơn biết; chưa khai / khai thiếu
 *     mà đã đo được ⇒ sàn dùng mức đo; NULL ≠ 0; số lệch bị bỏ; 2.000 gian đang bù dần hoa hồng không lỗ.
 *  E. Đầu-cuối trên prisma giả + Shopee giả: chu kỳ Tự động; phí chưa đo; phí tỷ lệ trung bình + hàng rẻ; tool AI (chính
 *     sách nền, phí chưa đo, hiện lại hàng ẩn, đọc chính sách hỏng); khuyến mãi soát lại lúc thực thi (giá vốn tăng /
 *     chính sách chặt hơn / phân loại); đăng và đổi giá sau khi giá vốn tăng; thuế GTGT và lời nhắc theo loại hình;
 *     hoa hồng affiliate đo được cao hơn mức khai (E11); cửa hàng chưa migrate cột affiliateFee (E12); đọc escrow (E13);
 *     phí theo NGÀNH (E14): hàng ngành phí cao không bị hạ theo phí trung bình cả gian, ngành đổi lúc thực thi ⇒ soát lại.
 *  F. Bộ chọn hồ sơ đăng: nhóm kèm số mã, tìm mã theo tên / SKU, cờ đã đăng / đã có hồ sơ.
 */
import fs from 'fs'
import path from 'path'
import {
    khoBoNho, chuanHoaChinhSach, quyetDinhGia, xayTrangThai, luuCauHinh, luuHoSo, taoKeHoachGia, taoKeHoachDang,
    taoKeHoachKhuyenMai, thucThi, chayChuKy, timHangChoHoSo, type NgCanh, type ChinhSachPilot,
} from '../src/lib/shopeePilot'
import {
    tinhGiaDeXuat, chanGiaDuoiSan, danhGiaGia, uocLuongPhi, lyDoPhiChuaDuTin, saiSoTyLePhi, SO_DON_TU_GHI, type ThamSoGia, type MauPhi,
} from '../src/lib/giaShopee'
import { chinhSachGia } from '../src/lib/shopeeThaoTac'
import { SHOPEE_TOOLS } from '../src/routes/mcpShopeeTools'
import { ShopeeService } from '../src/services/platforms/shopee'
import { ToolError } from '../src/lib/mcpTypes'
import { datDemTienIch, TIEN_ICH_SHOPEE_PILOT } from '../src/lib/tienIchCuaHang'
import { xoaDemPhiTheoNganh } from '../src/lib/shopeeTuQuan'

let loi = 0
const dung = (ten: string, ok: boolean, chiTiet = '') => { if (!ok) loi++; console.log(`${ok ? '✓' : '✗'} ${ten}${chiTiet ? ' — ' + chiTiet : ''}`) }
const nem = async (f: () => Promise<any>) => { try { await f(); return null } catch (e: any) { return e } }

/** PRNG có hạt — chạy lại ra đúng các ca cũ, hỏng là tái hiện được. */
function mulberry32(a: number) {
    return () => {
        a |= 0; a = (a + 0x6D2B79F5) | 0
        let t = Math.imul(a ^ (a >>> 15), 1 | a)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}
const rnd = mulberry32(20261101)
const chon = <T>(ds: T[]): T => ds[Math.floor(rnd() * ds.length)]!
const khoang = (a: number, b: number) => a + (b - a) * rnd()
const logKhoang = (a: number, b: number) => Math.exp(khoang(Math.log(a), Math.log(b)))

/** Tham số giá từ chính sách Pilot — cùng phép đổi với shopeePilot.thamSoTinh. */
const tsTu = (pol: ChinhSachPilot, giaVon: number, phi: { tyLe: number; coDinh: number }): ThamSoGia => ({
    giaVon, phi, bienLoiNhuanPct: pol.targetMarginRate * 100, bienToiThieuPct: pol.minMarginRate * 100,
    phiDongGoi: pol.packagingCost, phiQuangCaoPct: pol.adsRate * 100, phiAffiliatePct: pol.affiliateRate * 100,
    thueGtgtPct: pol.vatRate * 100, lamTron: pol.priceStep,
})

// ─── Cửa hàng giả (phần E, F) ───────────────────────────────────────────────────

type Don = { giaBan: number; phi: number; aff?: number | null }
const goi: string[] = []
const ghiShopee = () => goi.filter(g => /^(add_item|update_price|add_discount|unlist)/.test(g))

function taoCuaHang(o: { don: Don[]; loaiHinh?: string; donNganh?: (Don & { nganh: string })[] }) {
    xoaDemPhiTheoNganh()   // mọi cửa hàng giả cùng mã gian 'ch1' — đừng để đệm phí ngành của ca trước lọt sang
    const kenh = { id: 'ch1', name: 'Gian thử', platform: 'shopee', shopId: '777', accessToken: 'tok', apiKey: '1', apiSecret: 's', commissionRate: 6, tokenExpiresAt: new Date(Date.now() + 3600_000), createdAt: new Date() }
    const hang: Record<string, any> = {}
    const listing: any[] = []
    const st = { don: o.don, donNganh: o.donNganh || null, loaiHinh: o.loaiHinh || 'company', loiChinhSach: null as null | 'khong-bang' | 'hong', thieuCotAff: false, hoiCotAff: 0 }
    const baseInfo: Record<string, any> = {}
    const models: Record<string, any[]> = {}
    const kho = khoBoNho()
    const themHang = (sku: string, giaVon: number, ton = 10, nhom = 'Điện') => {
        hang[sku] = {
            id: `p-${sku}`, sku, name: `Hàng ${sku} thử nghiệm`, description: 'Mô tả thật của sản phẩm thử, đủ dài để Shopee nhận khi đăng.',
            productType: 'goods', costPrice: giaVon, sellingPrice: giaVon * 2, stock: ton, mergedIntoId: null, bundleId: null, barcode: `893${sku}`,
            images: [{ url: `https://storage.googleapis.com/kengi-tech-assets/anh-sp/x/${sku}.jpg`, isPrimary: true }], nhom,
        }
    }
    const themListing = (sku: string, gia: number, itemId: string, status = 'NORMAL', categoryId: string | null = null) => {
        listing.push({ id: `op-${itemId}`, channelId: 'ch1', platform: 'shopee', platformProductId: itemId, name: sku, sku, price: gia, stock: 5, status, localProductId: hang[sku]?.id || null, imageUrl: null, updatedAt: new Date(), categoryId })
        // bản trên Shopee (get_item_base_info) — máy đối chiếu chiều TĂNG giá với số này, không với bản trong hệ thống
        baseInfo[itemId] = { item_id: Number(itemId), item_sku: sku, has_model: !(gia > 0), price_info: gia > 0 ? [{ original_price: gia, current_price: gia }] : [] }
    }
    const thuong = (v: any) => String(v ?? '').trim().toLowerCase()
    const khopSP = (h: any, w: any): boolean => {
        if (!w) return true
        if (w.OR && !w.OR.some((x: any) => khopSP(h, x))) return false
        if (w.sku?.equals !== undefined && thuong(h.sku) !== thuong(w.sku.equals)) return false
        if (w.sku?.contains !== undefined && !thuong(h.sku).includes(thuong(w.sku.contains))) return false
        if (w.name?.contains !== undefined && !thuong(h.name).includes(thuong(w.name.contains))) return false
        if (typeof w.id === 'string' && h.id !== w.id) return false
        if (typeof w.barcode === 'string' && h.barcode !== w.barcode) return false
        if (w.productType && h.productType !== w.productType) return false
        if ('mergedIntoId' in w && w.mergedIntoId === null && h.mergedIntoId) return false
        if ('bundleId' in w && w.bundleId === null && h.bundleId) return false
        if (w.stock?.gt !== undefined && !(h.stock > w.stock.gt)) return false
        if (w.category?.name?.contains !== undefined && !thuong(h.nhom).includes(thuong(w.category.name.contains))) return false
        return true
    }
    const raSP = (h: any) => ({ ...h, category: { name: h.nhom }, _count: { images: h.images.length }, images: h.images.slice(0, 1) })
    const khopLT = (l: any, w: any): boolean => {
        if (w.channelId && l.channelId !== w.channelId) return false
        if (typeof w.status === 'string' && l.status !== w.status) return false
        if (w.status?.in && !w.status.in.includes(l.status)) return false
        if (typeof w.platformProductId === 'string' && l.platformProductId !== w.platformProductId) return false
        if (w.platformProductId?.in && !w.platformProductId.in.includes(l.platformProductId)) return false
        if (w.sku?.equals !== undefined && thuong(l.sku) !== thuong(w.sku.equals)) return false
        if (w.OR && !w.OR.some((x: any) => (x.localProductId && x.localProductId === l.localProductId) || (x.sku?.equals !== undefined && thuong(l.sku) === thuong(x.sku.equals)))) return false
        return true
    }
    const prisma: any = {
        onlineChannel: {
            findMany: async ({ where }: any = {}) => [kenh].filter(c => !where?.id?.not || c.id !== where.id.not),
            update: async () => kenh,
        },
        product: {
            findFirst: async ({ where }: any) => { const h = Object.values(hang).find(x => khopSP(x, where)); return h ? raSP(h) : null },
            findMany: async ({ where, take }: any) => Object.values(hang).filter(h => khopSP(h, where)).sort((a, b) => b.stock - a.stock).slice(0, take || 1000).map(raSP),
        },
        onlineProduct: {
            findMany: async ({ where }: any) => listing.filter(l => khopLT(l, where || {})),
            findFirst: async ({ where }: any) => listing.find(l => khopLT(l, where || {})) || null,
            update: async ({ where, data }: any) => { const l = listing.find(x => x.id === where.id); Object.assign(l, data); return l },
            updateMany: async ({ where, data }: any) => { for (const l of listing.filter(x => khopLT(x, where))) Object.assign(l, data); return { count: 1 } },
            upsert: async (q: any) => { listing.push({ ...q.create, id: `op-${q.create.platformProductId}` }); return q.create },
            count: async () => listing.length,
        },
        skuMapping: { findMany: async () => [], findFirst: async () => null },
        storeSettings: { findFirst: async () => ({ businessType: st.loaiHinh }) },
        category: { findMany: async () => [...new Set(Object.values(hang).map(h => h.nhom))].map(name => ({ name })) },
        onlineOrder: { findMany: async () => [] },
        $queryRawUnsafe: async (sql: string, ...v: any[]) => {
            if (sql.includes('"ShopeePilotConfig"')) {
                if (st.loiChinhSach === 'hong') throw new Error('Connection terminated unexpectedly')
                if (st.loiChinhSach === 'khong-bang') throw Object.assign(new Error('relation "ShopeePilotConfig" does not exist'), { code: 'P2010', meta: { code: '42P01' } })
                const c = await kho.docCauHinh()
                return c ? [{ policy: JSON.stringify(c.policy) }] : []
            }
            // đơn MỘT ngành (lib/shopeeTuQuan.dongPhiTheoNganh) — chỉ ca nào khai donNganh
            if (sql.includes('AS nganh')) return (v[0] === 'ch1' && st.donNganh) ? st.donNganh : []
            if (sql.includes('"OnlineOrderItem"')) return []
            if (sql.includes('"OnlineOrder" o') && sql.includes('platformFee')) {
                if (sql.includes('affiliateFee')) {
                    st.hoiCotAff++
                    // cửa hàng chưa chạy /admin/migrate cho cột mới
                    if (st.thieuCotAff) throw new Error('Raw query failed. Code: `42703`. Message: `column o.affiliateFee does not exist`')
                }
                return (v[0] || []).includes('ch1') ? st.don : []
            }
            if (sql.includes('FROM "Category" c')) {
                const nhom = new Map<string, { total: number; inStock: number }>()
                for (const h of Object.values(hang)) {
                    const n = nhom.get(h.nhom) || { total: 0, inStock: 0 }
                    n.total++; if (h.stock > 0) n.inStock++
                    nhom.set(h.nhom, n)
                }
                return [...nhom].sort((a, b) => a[0].localeCompare(b[0])).map(([name, n]) => ({ name, ...n }))
            }
            if (sql.includes('FROM "Product"')) {
                const ids: string[] = v[0] || [], skus: string[] = v[1] || []
                return Object.values(hang).filter(h => ids.includes(h.id) || skus.includes(thuong(h.sku)))
                    .map(h => ({ id: h.id, sku: h.sku, name: h.name, description: h.description, costPrice: h.costPrice, mergedIntoId: null, mergedRate: 1 }))
            }
            return []
        },
    }
    const ctx: NgCanh = { prisma, kho, nguoi: 'chu@shop.vn' }
    const mcp: any = { prisma, scopes: 'read,write', storeCode: 'KHONGLO' }
    return { kenh, hang, listing, st, baseInfo, models, kho, prisma, ctx, mcp, themHang, themListing }
}
let HIEN: ReturnType<typeof taoCuaHang>

const P = ShopeeService.prototype as any
P.getItemLimit = async () => ({ price_limit: { min_limit: 1000, max_limit: 1e8 }, item_name_length_limit: { min_limit: 5, max_limit: 120 }, item_description_length_limit: { min_limit: 10, max_limit: 3000 } })
P.getLogisticsChannels = async () => [{ logistics_channel_id: 50021, logistics_channel_name: 'Nhanh', enabled: true, mask_channel_id: 0 }]
P.uploadImage = async () => ({ imageId: 'img-1' })
P.addItem = async (body: any) => { goi.push(`add_item:${body.item_sku}:${body.original_price}`); return { itemId: String(9000 + goi.length) } }
P.updatePrice = async (id: any, gia: number, modelId?: any) => {
    goi.push(`update_price:${id}:${gia}${modelId ? `:${modelId}` : ''}`)
    const b = HIEN.baseInfo[String(id)]
    if (b && !modelId) b.price_info = [{ original_price: gia, current_price: gia }]
}
P.getItemPromotion = async () => []
P.addDiscount = async (ten: string) => { goi.push(`add_discount:${ten}`); return 555 }
P.addDiscountItems = async (_id: number, items: any[]) => { goi.push(`add_discount_item:${JSON.stringify(items)}`); return { loi: [] } }
P.deleteDiscount = async () => { goi.push('delete_discount') }
P.getModelList = async (itemId: number) => HIEN.models[String(itemId)] || []
P.getItemBaseInfo = async (ids: number[]) => ids.map(id => HIEN.baseInfo[String(id)]).filter(Boolean)
P.unlistItem = async (id: any, an: boolean) => { goi.push(`unlist:${id}:${an}`) }

const tool = (n: string) => SHOPEE_TOOLS.find(t => t.name === n)!
const chay = async (n: string, a: any) => { try { return { kq: await tool(n).run(a, HIEN.mcp) as any, loi: null as any } } catch (e: any) { return { kq: null as any, loi: e } } }

/** 40 đơn đối soát, phí đúng 14% + 3.000đ, giá trải 60k–450k (không nhiễu) ⇒ hồi quy tách đúng phí cố định. */
const donSach = (): Don[] => Array.from({ length: 40 }, (_, i) => { const g = 60000 + i * 10000; return { giaBan: g, phi: 0.14 * g + 3000 } })

async function main() {
    // ─── A. Lõi giá ──────────────────────────────────────────────────────────────
    {
        const vp: string[] = []
        let hopLe = 0
        for (let i = 0; i < 4000; i++) {
            const min = chon([0, 2, 5, 8, 12, 20, 30])
            const ts: ThamSoGia = {
                giaVon: Math.round(logKhoang(1000, 5e6)),
                phi: { tyLe: khoang(0.03, 0.35), coDinh: chon([0, 0, 1000, 3000, 5000, 12000]) },
                bienToiThieuPct: min, bienLoiNhuanPct: min + chon([0, 3, 7, 10, 20]),
                phiDongGoi: chon([0, 0, 2000, 5000, 15000]), phiQuangCaoPct: chon([0, 0, 3, 5, 10, 15]),
                phiAffiliatePct: chon([0, 0, 5, 8, 10, 15, 20]), thueGtgtPct: chon([0, 0, 5, 8, 10]),
                lamTron: chon([1, 100, 500, 1000, 5000]),
            }
            const kq = tinhGiaDeXuat(ts)
            const ma = () => JSON.stringify(ts)
            if (!kq.hopLe) {
                if (kq.giaSan <= 0 && chanGiaDuoiSan(1e9, kq) === null) vp.push(`không tính được giá mà vẫn cho ghi: ${ma()}`)
                continue
            }
            hopLe++
            const xau = (g: number) => danhGiaGia(g, ts, true)
            if (kq.giaDeXuat < kq.giaSan) vp.push(`đề xuất ${kq.giaDeXuat} < sàn ${kq.giaSan}: ${ma()}`)
            if (xau(kq.giaSan).bienPct < min - 0.01) vp.push(`ở giá sàn đơn affiliate chỉ còn ${xau(kq.giaSan).bienPct}% < ${min}%: ${ma()}`)
            if (xau(kq.giaHoaVon).loiNhuan < -1) vp.push(`giá hoà vốn mà đơn affiliate lỗ ${xau(kq.giaHoaVon).loiNhuan}: ${ma()}`)
            if (danhGiaGia(kq.giaDeXuat, ts).bienPct < ts.bienLoiNhuanPct - 0.01) vp.push(`đề xuất chưa đạt biên mục tiêu: ${ma()}`)
            for (let j = 0; j < 6; j++) {
                const p = Math.max(1, Math.round(kq.giaSan * khoang(0.4, 2.5)))
                const chan = chanGiaDuoiSan(p, kq)
                if (chan === null && xau(p).bienPct < min - 0.01) vp.push(`giá ${p} lọt rào mà đơn affiliate chỉ ${xau(p).bienPct}%: ${ma()}`)
                if (chan !== null && p >= kq.giaSan) vp.push(`giá ${p} ≥ sàn ${kq.giaSan} mà bị chặn: ${ma()}`)
            }
        }
        dung(`A. lõi giá: ${hopLe}/4000 bộ tham số ra giá — sàn giữ biên tối thiểu kể cả đơn affiliate, không giá nào lọt rào mà lỗ`, vp.length === 0 && hopLe > 2500, vp.slice(0, 3).join(' | '))

        // ca cụ thể: phí 22% (đã gồm affiliate trung bình), affiliate 10%, vốn 100.000đ, sàn 5%, mục tiêu 15%
        const ts: ThamSoGia = { giaVon: 100000, phi: { tyLe: 0.22, coDinh: 0 }, bienLoiNhuanPct: 15, bienToiThieuPct: 5, phiAffiliatePct: 10, lamTron: 1000 }
        const kq = tinhGiaDeXuat(ts), cu = tinhGiaDeXuat({ ...ts, phiAffiliatePct: 0 })
        dung('A. sàn = vốn / (1 − 22% − 5% − 10%) = 158.730 → 158.800; đề xuất không dưới sàn (159.000)', kq.giaSan === 158800 && kq.giaDeXuat === 159000, `${kq.giaSan} / ${kq.giaDeXuat}`)
        const laiCu = cu.giaSan - 0.32 * cu.giaSan - 100000
        dung(`A. cách cũ: sàn ${cu.giaSan} — đơn affiliate thật (phí 22% + 10%) lỗ ${Math.round(laiCu)}đ; cách mới thì lãi ${danhGiaGia(kq.giaSan, ts, true).loiNhuan}đ`, laiCu < 0 && danhGiaGia(kq.giaSan, ts, true).bienPct >= 5)
        dung('A. chặn giá dưới sàn nói rõ "kể cả đơn qua affiliate"', /affiliate 10%/.test(chanGiaDuoiSan(150000, kq) || ''), chanGiaDuoiSan(150000, kq) || '')

        const vat = tinhGiaDeXuat({ giaVon: 100000, phi: { tyLe: 0.2, coDinh: 0 }, bienLoiNhuanPct: 5, bienToiThieuPct: 5, thueGtgtPct: 10, lamTron: 100 })
        dung('A. thuế GTGT 10%: phần thuế trong giá = 10/110; sàn = 100.000 / (1 − 20% − 5% − 9,09%) → 151.800', vat.giaSan === 151800 && danhGiaGia(151800, { giaVon: 100000, phi: { tyLe: 0.2, coDinh: 0 }, thueGtgtPct: 10 }).thueGtgt === 13800, `${vat.giaSan}`)
        // Cơ sở để máy luôn được TĂNG giá kể cả khi phí chưa đủ tin: lãi mỗi đơn không bao giờ giảm khi giá tăng
        let viPham = 0
        for (let i = 0; i < 3000; i++) {
            const t: ThamSoGia = {
                giaVon: Math.round(logKhoang(1000, 5e6)), phi: { tyLe: khoang(0.03, 0.35), coDinh: chon([0, 3000, 12000]) },
                phiDongGoi: chon([0, 5000]), phiQuangCaoPct: chon([0, 10]), phiAffiliatePct: chon([0, 20]), thueGtgtPct: chon([0, 10]),
            }
            const p1 = Math.round(logKhoang(1000, 1e7)), p2 = p1 + Math.max(1, Math.round(p1 * khoang(0.001, 1)))
            if (danhGiaGia(p2, t).loiNhuan < danhGiaGia(p1, t).loiNhuan || danhGiaGia(p2, t, true).loiNhuan < danhGiaGia(p1, t, true).loiNhuan) viPham++
        }
        dung('A. lãi mỗi đơn không bao giờ giảm khi giá tăng (3.000 cặp giá, cả đơn affiliate) — cơ sở để máy luôn được TĂNG giá', viPham === 0, `${viPham} cặp vi phạm`)

        const quaTay = tinhGiaDeXuat({ ...ts, phiAffiliatePct: 50, bienToiThieuPct: 30 })
        dung('A. affiliate + biên + phí ≥ ~100% ⇒ không ra giá, mọi giá bị chặn', !quaTay.hopLe && quaTay.giaSan === 0 && !!chanGiaDuoiSan(1e9, quaTay), quaTay.lyDo)
    }

    // ─── B. Chu kỳ quyết giá ────────────────────────────────────────────────────
    {
        const vp: string[] = []
        let soQuyet = 0
        for (let i = 0; i < 3000; i++) {
            const pol = chuanHoaChinhSach({
                minMarginRate: chon([0, 0.03, 0.05, 0.1, 0.2]), targetMarginRate: chon([0.05, 0.1, 0.15, 0.25, 0.4]),
                maxPriceChangeRate: chon([0.01, 0.05, 0.1, 0.3]), priceStep: chon([1, 100, 1000, 5000, 10000]),
                packagingCost: chon([0, 3000]), adsRate: chon([0, 0.05]), affiliateRate: chon([0, 0.1, 0.2]), vatRate: chon([0, 0.1]),
            })
            const ts = tsTu(pol, Math.round(logKhoang(5000, 2e6)), { tyLe: khoang(0.05, 0.3), coDinh: chon([0, 3000]) })
            const kq = tinhGiaDeXuat(ts)
            if (!(kq.giaSan > 0)) continue
            const giaCu = Math.round(kq.giaSan * khoang(0.3, 3))
            const bien = danhGiaGia(giaCu, ts).bienPct
            const q = quyetDinhGia({ giaCu, ton: chon([0, 4]), daBan14: chon([0, 0, 2]), kq, bienHienTaiPct: bien, pol })
            if (!q) continue
            soQuyet++
            const ma = JSON.stringify({ giaCu, san: kq.giaSan, deXuat: kq.giaDeXuat, q, step: pol.priceStep, m: pol.maxPriceChangeRate })
            if (q.gia < kq.giaSan) vp.push(`dưới sàn: ${ma}`)
            const tang = giaCu < kq.giaSan || (kq.hopLe && bien < pol.targetMarginRate * 100 - 0.5)
            if (tang && q.gia <= giaCu) vp.push(`cần tăng mà ra giảm: ${ma}`)
            if (!tang && q.gia >= giaCu) vp.push(`cần giảm mà ra tăng: ${ma}`)
            if (Math.abs(q.gia - giaCu) / giaCu > pol.maxPriceChangeRate + 1e-9 && q.gia !== kq.giaSan) vp.push(`vượt biên độ: ${ma}`)
        }
        dung(`B. chu kỳ: ${soQuyet} quyết định đổi giá ngẫu nhiên — không dưới sàn, không ngược chiều, không vượt biên độ (trừ nâng lên sàn)`, vp.length === 0 && soQuyet > 1000, vp.slice(0, 3).join(' | '))
    }

    // ─── C. Tham số tool AI chỉ chặt hơn chính sách Pilot ─────────────────────────
    {
        const vp: string[] = []
        const la = [undefined, null, '', 'abc', -50, -1, 0, 0.5, 3, 7, 12, 40, 1e9, '9']
        const truong = ['bienToiThieuPct', 'phiDongGoi', 'phiQuangCaoPct', 'phiAffiliatePct', 'thueGtgtPct'] as const
        for (let i = 0; i < 2000; i++) {
            const nen = chinhSachGia({
                bien_loi_nhuan: chon([10, 15, 30]), bien_toi_thieu: chon([0, 5, 8, 15]), phi_dong_goi: chon([0, 3000, 8000]),
                phi_quang_cao: chon([0, 4, 10]), hoa_hong_affiliate: chon([0, 6, 12]), thue_gtgt: chon([0, 8, 10]), lam_tron: chon([100, 1000]),
            })
            const a: any = {}
            for (const k of ['bien_loi_nhuan', 'bien_toi_thieu', 'phi_dong_goi', 'phi_quang_cao', 'hoa_hong_affiliate', 'thue_gtgt', 'lam_tron']) if (rnd() < 0.6) a[k] = chon(la)
            const cs = chinhSachGia(a, nen)
            for (const k of truong) if (cs[k] < nen[k]) vp.push(`${k} ${cs[k]} < nền ${nen[k]} với ${JSON.stringify(a)}`)
            if (Object.values(cs).some(v => !Number.isFinite(v))) vp.push(`ra số lạ với ${JSON.stringify(a)}`)
            if (JSON.stringify(chinhSachGia({}, nen)) !== JSON.stringify(nen)) vp.push('bỏ trống mà khác chính sách')
        }
        dung('C. tool AI: 2.000 bộ tham số lạ — biên tối thiểu / đóng gói / quảng cáo / affiliate / GTGT không bao giờ thấp hơn chính sách Pilot', vp.length === 0, vp.slice(0, 3).join(' | '))
    }

    // ─── D. Mô phỏng gian có đơn affiliate trộn trong số đo phí ──────────────────
    {
        let soGhi = 0, loMoi = 0, loCu = 0, choDuyet = 0, bienThapNhat = Infinity
        const nguon = new Map<string, number>()
        const vp: string[] = []
        for (let s = 0; s < 400; s++) {
            const t0 = khoang(0.12, 0.28), b = chon([0, 1000, 3000, 5000]), a = chon([0.05, 0.08, 0.1, 0.15, 0.2]), f = chon([0.05, 0.1, 0.2, 0.4, 0.7])
            const n = chon([5, 10, 12, 20, 60, 200, 600])
            const lo = chon([30000, 50000, 100000]), hi = lo * chon([1.1, 3, 10])
            const don = Array.from({ length: n }, () => { const g = Math.round(logKhoang(lo, hi)); return { giaBan: g, phi: (t0 + (rnd() < f ? a : 0)) * g + b } })
            const mau = uocLuongPhi(don, 6)
            nguon.set(mau.nguon, (nguon.get(mau.nguon) || 0) + 1)
            for (const giaVon of [10000, 40000, 150000, 600000]) {
                const ts: ThamSoGia = { giaVon, phi: mau, bienLoiNhuanPct: 15, bienToiThieuPct: 5, phiAffiliatePct: a * 100, lamTron: 1000 }
                const kq = tinhGiaDeXuat(ts)
                if (!kq.hopLe) continue
                for (const gia of [kq.giaSan, kq.giaDeXuat, Math.round((kq.giaSan + kq.giaDeXuat) / 2)]) {
                    if (lyDoPhiChuaDuTin(gia, mau, 5)) { choDuyet++; continue }   // máy không tự ghi giá này
                    soGhi++
                    const laiThat = gia - ((t0 + a) * gia + b) - giaVon       // đơn ĐI QUA affiliate, phí thật
                    bienThapNhat = Math.min(bienThapNhat, laiThat / gia)
                    if (laiThat < 0) { loMoi++; if (vp.length < 3) vp.push(JSON.stringify({ t0, b, a, f, n, lo, hi, giaVon, gia, mau: { tyLe: mau.tyLe, coDinh: mau.coDinh, nguon: mau.nguon } })) }
                }
                const kqCu = tinhGiaDeXuat({ ...ts, phiAffiliatePct: 0 })
                if (kqCu.hopLe && kqCu.giaSan - ((t0 + a) * kqCu.giaSan + b) - giaVon < 0) loCu++
            }
        }
        dung(`D. ${soGhi} giá máy được tự ghi trên 400 gian mô phỏng (nguồn phí ${[...nguon].map(([k, v]) => `${k} ${v}`).join(', ')}) — không giá nào lỗ kể cả đơn affiliate, biên thật thấp nhất ${(bienThapNhat * 100).toFixed(2)}%; ${choDuyet} giá để người duyệt`,
            soGhi > 1000 && loMoi === 0, vp.join(' | '))
        dung(`D. cách cũ (sàn không cộng affiliate): ${loCu} ca đơn affiliate bán đúng giá sàn bị LỖ — đường lỗ có thật`, loCu > 0)
    }

    // ─── D2. Phí biến động KHÔNG khai trong chính sách (affiliate 0) + ít đơn đo ─────────
    {
        /* Một phần đơn chịu thêm phí x (affiliate / voucher / phí dịch vụ chủ shop không khai) với xác suất q.
         * Lỗ = lãi KỲ VỌNG âm (trung bình trên mọi đơn). Ít đơn đo thì mẫu có thể thiếu hẳn loại phí đó — sai số
         * tính từ mẫu không thấy được ⇒ rào phải chặn theo số đơn, không chỉ theo sai số. */
        const raoCu = (gia: number, m: MauPhi) =>   // rào trước 01/11: 3σ, từ 8 đơn
            m.nguon === 'cau-hinh-kenh' || (m.nguon === 'ty-le-don' && !!m.giaBanTB && gia < m.giaBanTB)
            || (m.nguon === 'hoi-quy-don' && !!m.giaBanMin && gia < m.giaBanMin) || 3 * (saiSoTyLePhi(gia, m) ?? 0) > 0.05
        let ghi = 0, lo = 0, ghiCu = 0, loCu = 0, teCu = 0, te = Infinity
        const vp: string[] = []
        for (let s = 0; s < 3000; s++) {
            const t0 = khoang(0.12, 0.28), b = chon([0, 1000, 3000, 5000])
            const q = chon([0.05, 0.1, 0.2, 0.3, 0.5]), x = chon([0.05, 0.1, 0.15, 0.2, 0.3])
            const n = chon([8, 10, 12, 15, 20, 30, 45, 60, 100, 200])
            const lo0 = chon([30000, 50000, 100000]), hi = lo0 * chon([1.1, 3, 10])
            const don = Array.from({ length: n }, () => { const g = Math.round(logKhoang(lo0, hi)); return { giaBan: g, phi: (t0 + (rnd() < q ? x : 0)) * g + b } })
            const mau = uocLuongPhi(don, 6)
            for (const giaVon of [10000, 40000, 150000, 600000]) {
                const kq = tinhGiaDeXuat({ giaVon, phi: mau, bienLoiNhuanPct: 15, bienToiThieuPct: 5, lamTron: 1000 })
                if (!kq.hopLe) continue
                for (const gia of [kq.giaSan, kq.giaDeXuat]) {
                    const bien = (gia - (t0 + q * x) * gia - b - giaVon) / gia
                    if (!raoCu(gia, mau)) { ghiCu++; if (bien < 0) { loCu++; teCu = Math.min(teCu, bien) } }
                    if (lyDoPhiChuaDuTin(gia, mau, 5)) continue
                    ghi++; te = Math.min(te, bien)
                    if (bien < 0) { lo++; if (vp.length < 3) vp.push(JSON.stringify({ t0, b, q, x, n, giaVon, gia, nguon: mau.nguon })) }
                }
            }
        }
        dung(`D2. phí biến động không khai, 3.000 gian (8–200 đơn đo): ${ghi} giá máy tự ghi, ${lo} giá lỗ kỳ vọng (biên thật thấp nhất ${(te * 100).toFixed(2)}%)`,
            ghi > 3000 && lo === 0, vp.join(' | '))
        dung(`D2. rào cũ (3σ, từ 8 đơn) cho tự ghi ${ghiCu} giá, ${loCu} giá lỗ kỳ vọng tới ${(teCu * 100).toFixed(1)}% — rào mới (4σ, ≥ ${SO_DON_TU_GHI} đơn) bịt được`, loCu > 0)
    }

    // ─── D3. Ngoại suy dưới đơn rẻ nhất đã đo ──────────────────────────────────────
    {
        // 40 đơn 100k–490k khớp đúng 20% + 3.000đ — nhưng phí thật có mức tối thiểu 12.000đ/đơn, chỉ lộ ra ở hàng rẻ
        const phiThat = (g: number) => Math.max(0.2 * g + 3000, 12000)
        const mau = uocLuongPhi(Array.from({ length: 40 }, (_, i) => { const g = 100000 + i * 10000; return { giaBan: g, phi: phiThat(g) } }), 6)
        const re = tinhGiaDeXuat({ giaVon: 5000, phi: mau, bienLoiNhuanPct: 15, bienToiThieuPct: 5, lamTron: 100 })
        const laiRe = re.giaSan - phiThat(re.giaSan) - 5000
        dung(`D3. hàng rẻ: sàn ${re.giaSan}đ thấp hơn mọi đơn đã đo ⇒ máy không tự ghi (phí thật ở đó ${phiThat(re.giaSan)}đ ⇒ ghi thì lỗ ${Math.round(laiRe)}đ/đơn)`,
            mau.nguon === 'hoi-quy-don' && laiRe < 0 && /thấp hơn mọi đơn/.test(lyDoPhiChuaDuTin(re.giaSan, mau, 5) || ''), `${mau.nguon} ${re.giaSan}`)
        const vua = tinhGiaDeXuat({ giaVon: 100000, phi: mau, bienLoiNhuanPct: 15, bienToiThieuPct: 5, lamTron: 100 })
        dung(`D3. hàng trong vùng giá đã đo (sàn ${vua.giaSan}đ) máy tự ghi được, lãi thật ${Math.round(vua.giaSan - phiThat(vua.giaSan) - 100000)}đ`,
            !lyDoPhiChuaDuTin(vua.giaSan, mau, 5) && vua.giaSan - phiThat(vua.giaSan) - 100000 >= 0.05 * vua.giaSan - 1)
    }

    // ─── D4. Hoa hồng affiliate ĐO TỪNG ĐƠN (OnlineOrder.affiliateFee) ─────────────────
    {
        // 40 đơn: phí thật 20% + 3.000đ, cứ 5 đơn có 1 đơn affiliate 10% — hoa hồng biết từng đơn
        const goc = Array.from({ length: 40 }, (_, i) => { const g = 60000 + i * 10000, a = i % 5 === 0 ? 0.1 * g : 0; return { giaBan: g, phi: 0.2 * g + 3000 + a, aff: a } })
        const khongAff = (ds: { giaBan: number; phi: number }[]) => ds.map(d => ({ giaBan: d.giaBan, phi: d.phi }))
        const mau = uocLuongPhi(goc, 6), af = mau.affiliate
        dung('D4. đủ đơn biết hoa hồng ⇒ đo phí trên phí − hoa hồng: 20% + 3.000đ, hoa hồng cao nhất 10%, 8/40 đơn qua affiliate',
            mau.nguon === 'hoi-quy-don' && Math.abs(mau.tyLe - 0.2) < 1e-6 && mau.coDinh === 3000 && af?.tachRieng === true
            && Math.abs((af?.tyLeMax ?? 0) - 0.1) < 1e-9 && af?.soDonCo === 8 && af?.soDonBiet === 40, JSON.stringify({ tyLe: mau.tyLe, coDinh: mau.coDinh, af }))
        // chủ shop KHÔNG khai affiliate (0%) — sàn vẫn tính 10% đo được: (100.000 + 3.000) / (1 − 20% − 5% − 10%) = 158.462 → 158.500
        const ts: ThamSoGia = { giaVon: 100000, phi: mau, bienLoiNhuanPct: 15, bienToiThieuPct: 5, lamTron: 1000 }
        const kq = tinhGiaDeXuat(ts)
        const laiAff = (g: number) => g - (0.3 * g + 3000) - 100000     // đơn affiliate, phí THẬT
        dung(`D4. chưa khai affiliate mà đã đo được 10% ⇒ sàn ${kq.giaSan}đ, đơn affiliate ở giá sàn lãi ${Math.round(laiAff(kq.giaSan))}đ (≥ 5%)`,
            kq.giaSan === 158500 && laiAff(kq.giaSan) / kq.giaSan >= 0.05 - 1e-4 && kq.thamSo.phiAffiliatePct === 10 && danhGiaGia(kq.giaSan, ts, true).hoaHongAffiliate === 15850,
            `${kq.giaSan} ${kq.thamSo.phiAffiliatePct}%`)
        const cu = tinhGiaDeXuat({ ...ts, phi: uocLuongPhi(khongAff(goc), 6) })
        dung(`D4. cách cũ (không đọc hoa hồng từng đơn, chưa khai): sàn ${cu.giaSan}đ — đơn affiliate ở đó LỖ ${Math.round(laiAff(cu.giaSan))}đ`, laiAff(cu.giaSan) < 0)
        // giá mục tiêu theo phí KỲ VỌNG (gồm hoa hồng trung bình) — không bị thổi lên như thể mọi đơn đều affiliate
        const laiTB = (g: number) => g - (0.2 + af!.tyLeTB) * g - 3000 - 100000
        dung(`D4. giá mục tiêu theo phí kỳ vọng (gồm hoa hồng TB ${(af!.tyLeTB * 100).toFixed(2)}%): ${kq.giaDeXuat}đ, đạt biên 15%; cách cũ ${cu.giaDeXuat}đ (lệch ≤ 2%)`,
            laiTB(kq.giaDeXuat) / kq.giaDeXuat >= 0.15 - 1e-4 && Math.abs(kq.giaDeXuat - cu.giaDeXuat) / cu.giaDeXuat <= 0.02 && kq.thamSo.phiAffiliateTBPct > 0,
            `${kq.giaDeXuat} / ${cu.giaDeXuat}`)
        dung('D4. lãi dự kiến hiện cho chủ shop tính đúng phí kỳ vọng (gồm hoa hồng trung bình)', Math.abs(danhGiaGia(kq.giaDeXuat, ts).loiNhuan - laiTB(kq.giaDeXuat)) <= 1,
            `${danhGiaGia(kq.giaDeXuat, ts).loiNhuan} / ${Math.round(laiTB(kq.giaDeXuat))}`)
        const khai = tinhGiaDeXuat({ ...ts, phiAffiliatePct: 15 })
        // 103.000 / (1 − 20% − 5% − 15%) = 171.667 → 171.700
        dung(`D4. khai 15% (cao hơn mức đo 10%) ⇒ sàn theo mức khai: ${khai.giaSan}đ`, khai.thamSo.phiAffiliatePct === 15 && khai.giaSan === 171700, `${khai.giaSan}`)

        const khongBiet = uocLuongPhi(goc.map(d => ({ ...d, aff: null })), 6)
        dung('D4. mọi đơn chưa đọc hoa hồng (NULL) ⇒ y hệt mô hình cũ, không có phần affiliate — NULL không bị coi là 0',
            JSON.stringify(khongBiet) === JSON.stringify(uocLuongPhi(khongAff(goc), 6)) && !khongBiet.affiliate)
        // đang bù dần: 12/40 rồi 35/40 đơn biết (< 30 đơn / < 90% mẫu) ⇒ giữ mô hình gộp, mức đo cao nhất vẫn vào sàn
        for (const soBiet of [12, 35]) {
            const it = uocLuongPhi(goc.map((d, i) => (i < soBiet ? d : { ...d, aff: null })), 6)
            const kqIt = tinhGiaDeXuat({ ...ts, phi: it })
            dung(`D4. mới biết hoa hồng ${soBiet}/40 đơn ⇒ giữ phí gộp như cũ, sàn vẫn tính 10% đo được (${kqIt.giaSan}đ, đơn affiliate lãi ${(laiAff(kqIt.giaSan) / kqIt.giaSan * 100).toFixed(2)}%)`,
                it.affiliate?.tachRieng === false && it.tyLe === uocLuongPhi(khongAff(goc), 6).tyLe && kqIt.thamSo.phiAffiliatePct === 10 && laiAff(kqIt.giaSan) / kqIt.giaSan >= 0.05 - 1e-4,
                JSON.stringify(it.affiliate))
        }
        const du = uocLuongPhi(goc.map((d, i) => (i < 38 ? d : { ...d, aff: null })), 6)
        dung('D4. biết 38/40 đơn (≥ 90% mẫu) ⇒ tách', du.affiliate?.tachRieng === true && du.soDon === 38)
        const lech = uocLuongPhi(goc.map((d, i) => (i === 5 ? { ...d, aff: d.phi + 1 } : i === 6 ? { ...d, aff: -5 } : d)), 6)
        dung('D4. đơn có hoa hồng > phí hoặc âm (số lệch) bị bỏ khỏi phép đo hoa hồng', lech.affiliate?.soDonBiet === 38 && Math.abs((lech.affiliate?.tyLeMax ?? 0) - 0.1) < 1e-9, JSON.stringify(lech.affiliate))
        dung('D4. ghi chú mô hình phí nói rõ hoa hồng đo được', /cao nhất 10% một đơn/.test(mau.ghiChu) && /KHÔNG gồm hoa hồng/.test(mau.ghiChu), mau.ghiChu)

        /* 2.000 gian: hoa hồng từng đơn biết 0–100% (đang bù dần), chủ shop khai thiếu / không khai, giỏ nhiều món
         * (chỉ một phần qua affiliate). Đơn affiliate trọn mức a được BẢO ĐẢM khi mức đó đã biết — khai đủ, hoặc đã
         * đo được ở một đơn; lãi kỳ vọng (trên mọi đơn) không bao giờ âm ở giá máy tự ghi. */
        let ghi = 0, loAff = 0, loKyVong = 0, ghiCu = 0, loAffCu = 0, te = Infinity, tachRieng = 0
        const vp: string[] = []
        for (let s = 0; s < 2000; s++) {
            const t0 = khoang(0.12, 0.28), b = chon([0, 1000, 3000, 5000])
            const a = chon([0.03, 0.05, 0.08, 0.1, 0.15, 0.2, 0.3]), f = chon([0, 0.05, 0.1, 0.2, 0.4, 0.7])
            const khaiA = chon([0, 0, a / 2, a, a * 1.5])
            const n = chon([8, 12, 20, 30, 45, 100, 300, 600]), biet = chon([0, 0.3, 0.6, 0.95, 1])
            const lo0 = chon([30000, 50000, 100000]), hi = lo0 * chon([1.1, 3, 10])
            const don = Array.from({ length: n }, () => {
                const g = Math.round(logKhoang(lo0, hi))
                const r = rnd() < f ? a * chon([1, 1, 0.6]) : 0
                return { giaBan: g, phi: (t0 + r) * g + b, aff: rnd() < biet ? r * g : null }
            })
            const m = uocLuongPhi(don, 6), mCu = uocLuongPhi(khongAff(don), 6)
            if (m.affiliate?.tachRieng) tachRieng++
            const daBiet = khaiA >= a - 1e-9 || (m.affiliate?.tyLeMax ?? 0) >= a - 1e-9
            const phiKyVong = t0 + f * a * (2.6 / 3)
            for (const giaVon of [10000, 40000, 150000, 600000]) {
                const t: ThamSoGia = { giaVon, phi: m, bienLoiNhuanPct: 15, bienToiThieuPct: 5, phiAffiliatePct: khaiA * 100, lamTron: 1000 }
                const k = tinhGiaDeXuat(t)
                if (k.hopLe) for (const gia of [k.giaSan, k.giaDeXuat, Math.round((k.giaSan + k.giaDeXuat) / 2)]) {
                    if (lyDoPhiChuaDuTin(gia, m, 5)) continue
                    ghi++
                    const bienAff = (gia - (t0 + a) * gia - b - giaVon) / gia, bienTB = (gia - phiKyVong * gia - b - giaVon) / gia
                    if (daBiet) te = Math.min(te, bienAff)
                    if (daBiet && bienAff < 0) { loAff++; if (vp.length < 3) vp.push(JSON.stringify({ t0, b, a, f, khaiA, n, biet, giaVon, gia, nguon: m.nguon })) }
                    if (bienTB < 0) { loKyVong++; if (vp.length < 3) vp.push('kỳ vọng ' + JSON.stringify({ t0, b, a, f, khaiA, n, biet, giaVon, gia, nguon: m.nguon })) }
                }
                const kCu = tinhGiaDeXuat({ ...t, phi: mCu })
                if (kCu.hopLe && daBiet && !lyDoPhiChuaDuTin(kCu.giaSan, mCu, 5)) {
                    ghiCu++
                    if (kCu.giaSan - (t0 + a) * kCu.giaSan - b - giaVon < 0) loAffCu++
                }
            }
        }
        dung(`D4. 2.000 gian (${tachRieng} đo tách hoa hồng): ${ghi} giá máy tự ghi — đơn affiliate trọn mức (đã khai hoặc đã đo) không lỗ, biên thấp nhất ${(te * 100).toFixed(2)}%; lãi kỳ vọng không âm`,
            ghi > 3000 && tachRieng > 200 && loAff === 0 && loKyVong === 0, vp.join(' | '))
        dung(`D4. cách cũ (không đọc hoa hồng từng đơn): ${loAffCu}/${ghiCu} giá sàn máy tự ghi làm đơn affiliate LỖ dù mức hoa hồng đã đo được`, loAffCu > 0)
    }

    const fetchGoc = globalThis.fetch
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(1000)])
    ;(globalThis as any).fetch = async () => new Response(jpeg, { status: 200 })
    datDemTienIch('KHONGLO', ['online', TIEN_ICH_SHOPEE_PILOT])

    try {
        // ─── E1. Chu kỳ Tự động trên phí đo tốt, có đơn affiliate trong số đo ───────────
        {
            // 200 đơn: phí thật 20% + 3.000đ, cứ 5 đơn có 1 đơn affiliate (+10%)
            const don = Array.from({ length: 200 }, (_, i) => { const g = Math.round(50000 * Math.pow(16, (i * 37 % 200) / 200)); return { giaBan: g, phi: (0.2 + (i % 5 === 0 ? 0.1 : 0)) * g + 3000 } })
            HIEN = taoCuaHang({ don })
            const H = HIEN
            for (let i = 0; i < 30; i++) {
                const sku = `L${i}`, von = Math.round(logKhoang(20000, 400000) / 100) * 100
                H.themHang(sku, von)
                H.themListing(sku, Math.round((von * khoang(0.9, 2.4)) / 1000) * 1000, String(100 + i))
            }
            await luuCauHinh(H.ctx, {
                executionMode: 'auto',
                policy: { minMarginRate: 0.06, targetMarginRate: 0.15, maxPriceChangeRate: 0.3, affiliateRate: 0.1, packagingCost: 2000, adsRate: 0.03, maxWritesPerDay: 1000, automation: { publishNewProducts: false, reprice: true } },
            })
            const truoc = goi.length
            for (let lan = 0; lan < 6; lan++) await chayChuKy(H.ctx)
            const doi = goi.slice(truoc).filter(g => g.startsWith('update_price:'))
            const sai: string[] = []
            for (const g of doi) {
                const [, item, giaS] = g.split(':'), gia = Number(giaS)
                const l = H.listing.find(x => x.platformProductId === item)!
                const von = H.hang[l.sku].costPrice
                const laiAff = gia - (0.3 * gia + 3000) - von - 2000 - 0.03 * gia       // đơn affiliate, phí THẬT
                if (laiAff / gia < 0.06 - 0.001) sai.push(`${l.sku} giá ${gia} vốn ${von}: biên đơn affiliate ${(laiAff / gia * 100).toFixed(2)}%`)
            }
            const conDuoi = H.listing.filter(l => { const von = H.hang[l.sku].costPrice; return l.price - (0.3 * l.price + 3000) - von - 2000 - 0.03 * l.price < 0 })
            dung(`E1. chu kỳ Tự động (6 lượt): ${doi.length} lần đổi giá — mọi giá ghi lên Shopee giữ biên ≥ 6% kể cả đơn affiliate (phí thật 30% + 3.000đ)`, doi.length >= 10 && sai.length === 0, sai.slice(0, 3).join(' | '))
            dung(`E1. sau 6 lượt không còn listing nào lỗ với đơn affiliate (${conDuoi.length} còn lỗ)`, conDuoi.length === 0, conDuoi.map(l => `${l.sku}@${l.price}`).join(', '))
        }

        // ─── E2. Phí CHƯA đo (3 đơn) ────────────────────────────────────────────────
        {
            HIEN = taoCuaHang({ don: donSach().slice(0, 3) })
            const H = HIEN
            H.themHang('RE1', 100000); H.themListing('RE1', 100000, '201')          // dưới sàn theo phí cấu hình 6% ⇒ chu kỳ TĂNG
            H.themHang('CAO1', 100000); H.themListing('CAO1', 300000, '202')        // lãi cao, 14 ngày không bán ⇒ chu kỳ muốn HẠ
            H.themHang('MOI1', 80000)                                               // chưa đăng, có hồ sơ nhóm
            await luuHoSo(H.ctx, { scope: 'nhom', key: 'Điện', categoryId: 101, weightGram: 300 })
            await luuCauHinh(H.ctx, { executionMode: 'auto', policy: { automation: { publishNewProducts: true, reprice: true } } })
            const truoc = ghiShopee().length
            const kq = await chayChuKy(H.ctx)
            const r = (sku: string) => kq.results.find((x: any) => x.sku === sku)
            const ghiMoi = ghiShopee().slice(truoc)
            dung('E2. phí chưa đo: máy vẫn TĂNG giá hàng đang dưới sàn (tăng giá không bao giờ lỗ thêm), kèm lời nhắc giá sàn có thể còn thấp',
                r('RE1')?.status === 'succeeded' && ghiMoi.includes('update_price:201:112400') && /chưa đủ tin/.test(r('RE1')?.message || ''), r('RE1')?.message)
            dung('E2. phí chưa đo: HẠ giá và đăng mới để nháp "CHỜ NGƯỜI DUYỆT", không gọi Shopee',
                r('CAO1')?.status === 'draft' && /CHỜ NGƯỜI DUYỆT/.test(r('CAO1')?.message || '') && r('MOI1')?.status === 'draft'
                && /CHỜ NGƯỜI DUYỆT/.test(r('MOI1')?.message || '') && ghiMoi.length === 1,
                JSON.stringify({ kq: kq.results.map((x: any) => [x.action, x.sku, x.status]), ghiMoi }))
            const kh = H.kho._keHoach.find(k => k.kind === 'price' && k.data?.sku === 'CAO1')!
            dung('E2. kế hoạch hạ giá mang cảnh báo phí chưa đo cho người duyệt', /CHƯA ĐO/.test(kh?.data?.warning || ''), kh?.data?.warning)
            const st = await xayTrangThai(H.ctx)
            dung('E2. trạng thái báo mô hình phí chưa đủ tin', st.status.feeModel?.trusted === false && /CHƯA ĐO/.test(st.status.feeModel?.warning || ''), JSON.stringify(st.status.feeModel))
            const nguoi = await thucThi(H.ctx, kh.id)
            dung('E2. người duyệt bấm thực thi thì hạ giá được (rào chỉ chặn máy tự chạy)', nguoi.status === 'succeeded' && ghiShopee().length === truoc + 2, JSON.stringify(nguoi.result))
        }

        // ─── E3. Phí tỷ lệ trung bình + hàng rẻ ────────────────────────────────────────
        {
            // 32 đơn quanh 340k (giá trải hẹp): phí thật 20% + 3.000đ ⇒ tỷ lệ trung bình ~20,9% (chưa tách được 3.000đ/đơn)
            const don = Array.from({ length: 32 }, (_, i) => { const g = 280000 + i * 4000; return { giaBan: g, phi: 0.2 * g + 3000 } })
            HIEN = taoCuaHang({ don })
            const H = HIEN
            H.themHang('RE', 20000); H.themListing('RE', 20000, '301')             // đang bán dưới sàn ⇒ TĂNG
            H.themHang('RE2', 20000); H.themListing('RE2', 60000, '303')           // lãi cao, 14 ngày không bán ⇒ muốn HẠ
            H.themHang('DAT', 300000); H.themListing('DAT', 330000, '302')
            await luuCauHinh(H.ctx, { executionMode: 'auto', policy: { automation: { publishNewProducts: false, reprice: true } } })
            const truoc = goi.length
            const kq = await chayChuKy(H.ctx)
            const re = kq.results.find((r: any) => r.sku === 'RE'), re2 = kq.results.find((r: any) => r.sku === 'RE2'), dat = kq.results.find((r: any) => r.sku === 'DAT')
            const giaRe = Number(goi.slice(truoc).find(g => g.startsWith('update_price:301:'))?.split(':')[2] || 0)
            const laiRe = (g: number) => Math.round(g - (0.2 * g + 3000) - 20000)    // phí THẬT
            dung(`E3. hàng rẻ đang bán lỗ ${laiRe(20000)}đ/đơn: máy nâng lên ${giaRe}đ (lỗ còn ${laiRe(giaRe)}đ), kèm lời nhắc phí chưa đủ chắc — sàn tỷ lệ trung bình còn thấp với hàng rẻ`,
                re?.status === 'succeeded' && giaRe > 20000 && laiRe(giaRe) > laiRe(20000) && /chưa đủ tin/.test(re?.message || ''), re?.message)
            dung('E3. HẠ giá hàng rẻ (dưới giá TB đơn đã đo) thì để nháp chờ người duyệt', re2?.status === 'draft' && /trung bình/.test(re2?.message || '') && !goi.slice(truoc).some(g => g.startsWith('update_price:303:')), re2?.message)
            const giaDat = Number(goi.slice(truoc).find(g => g.startsWith('update_price:302:'))?.split(':')[2] || 0)
            const laiThatDat = giaDat - (0.2 * giaDat + 3000) - 300000
            dung(`E3. hàng đắt (trên giá TB) máy tự nâng lên sàn ${giaDat}đ — lãi thật ${Math.round(laiThatDat)}đ (${(laiThatDat / giaDat * 100).toFixed(2)}% ≥ 5%)`, dat?.status === 'succeeded' && giaDat > 0 && laiThatDat / giaDat >= 0.05, dat?.message)
        }

        // ─── E4. Tool AI dùng chính sách Pilot làm nền ───────────────────────────────
        {
            HIEN = taoCuaHang({ don: donSach() })
            const H = HIEN
            H.themHang('OC', 100000); H.themListing('OC', 200000, '501')
            H.themHang('OC2', 100000)
            await luuCauHinh(H.ctx, { policy: { minMarginRate: 0.12, targetMarginRate: 0.2, packagingCost: 5000, affiliateRate: 0.08 } })
            // sàn Pilot = (100.000 + 3.000 + 5.000) / (1 − 14% − 12% − 8%) = 163.636 → 163.700; mặc định tool cũ (5%, không đóng gói) = 127.200
            const goiY = await chay('shopee_suggest_price', { sku: 'OC', bien_toi_thieu: 0, phi_dong_goi: 0, hoa_hong_affiliate: 0 })
            dung('E4. suggest_price: AI truyền biên 0 / đóng gói 0 / affiliate 0 vẫn ra sàn theo chính sách Pilot (163.700)', !goiY.loi && goiY.kq.giaSan === 163700 && goiY.kq.chinhSach?.bienToiThieuPct === 12, goiY.loi?.message || `${goiY.kq?.giaSan}`)
            const truoc = ghiShopee().length
            const lo = await chay('shopee_update_price', { item_id: '501', gia_moi: 150000, bien_toi_thieu: 0, phi_dong_goi: 0 })
            dung('E4. update_price 150.000đ (trên sàn mặc định cũ, dưới sàn Pilot) bị từ chối, không gọi Shopee', lo.loi instanceof ToolError && /GIÁ SÀN/.test(lo.loi.message) && ghiShopee().length === truoc, lo.loi?.message)
            const duoc = await chay('shopee_update_price', { item_id: '501', gia_moi: 170000 })
            dung('E4. update_price 170.000đ (trên sàn Pilot) được ghi', !duoc.loi && goi.includes('update_price:501:170000'), duoc.loi?.message)
            const dang = await chay('shopee_create_listing', { sku: 'OC2', category_id: 101, can_nang_gram: 300, gia: 150000, bien_toi_thieu: 0 })
            dung('E4. create_listing giá dưới sàn Pilot bị từ chối, không add_item', dang.loi instanceof ToolError && /GIÁ SÀN/.test(dang.loi.message) && !goi.some(g => g.startsWith('add_item:OC2')), dang.loi?.message)
            const soat = await chay('shopee_review_listings', { bien_toi_thieu: 0, chi_van_de: false })
            dung('E4. review_listings: chính sách hiệu lực là chính sách Pilot', !soat.loi && soat.kq.chinhSach?.bienToiThieuPct === 12 && soat.kq.chinhSach?.phiAffiliatePct === 8, soat.loi?.message || JSON.stringify(soat.kq?.chinhSach))

            // ─── E7. Đọc chính sách Pilot hỏng ⇒ tool ghi không chạy ───
            H.st.loiChinhSach = 'hong'
            const t2 = ghiShopee().length
            const hong = await chay('shopee_update_price', { item_id: '501', gia_moi: 300000 })
            dung('E7. đọc chính sách Pilot HỎNG ⇒ tool ghi giá từ chối (không rơi về mức mặc định lỏng hơn)', hong.loi instanceof ToolError && /chính sách Shopee Pilot/.test(hong.loi.message) && ghiShopee().length === t2, hong.loi?.message)
            H.st.loiChinhSach = 'khong-bang'
            const chuaDung = await chay('shopee_update_price', { item_id: '501', gia_moi: 180000 })
            dung('E7. cửa hàng chưa từng dùng Pilot (chưa có bảng) ⇒ dùng mặc định, ghi được', !chuaDung.loi && goi.includes('update_price:501:180000'), chuaDung.loi?.message)
            H.st.loiChinhSach = null
        }

        // ─── E5. Tool AI khi phí CHƯA đo ───────────────────────────────────────────────
        {
            HIEN = taoCuaHang({ don: donSach().slice(0, 3) })
            const H = HIEN
            H.themHang('X1', 100000); H.themListing('X1', 200000, '701')
            H.themHang('X2', 100000)
            H.themHang('X3', 100000); H.themListing('X3', 300000, '702', 'UNLIST')
            const truoc = ghiShopee().length
            const ha = await chay('shopee_update_price', { item_id: '701', gia_moi: 150000 })
            dung('E5. phí chưa đo: AI HẠ giá (dù vẫn trên sàn tính được) bị từ chối, không gọi Shopee', ha.loi instanceof ToolError && /CHƯA ĐO/.test(ha.loi.message) && ghiShopee().length === truoc, ha.loi?.message)
            const tang = await chay('shopee_update_price', { item_id: '701', gia_moi: 260000 })
            dung('E5. phí chưa đo: AI TĂNG giá vẫn được, kèm cảnh báo giá sàn có thể còn thấp', !tang.loi && goi.includes('update_price:701:260000') && /chưa đủ tin/.test(tang.kq?.canhBao || ''), tang.loi?.message)
            H.listing.find(l => l.platformProductId === '701')!.price = 100000      // bản trong hệ thống cũ — Shopee thật đang 260.000
            const cu = await chay('shopee_update_price', { item_id: '701', gia_moi: 200000 })
            dung('E5. bản trong hệ thống cũ (100.000đ) còn Shopee đang 260.000đ: "tăng" lên 200.000đ thực ra là HẠ ⇒ từ chối', cu.loi instanceof ToolError && !goi.includes('update_price:701:200000'), cu.loi?.message)
            const hien = await chay('shopee_toggle_listing', { item_id: '702', an: false })
            dung('E5. phí chưa đo: AI hiện lại hàng đang ẩn bị từ chối (mở bán lại = ghi giá đang để)', hien.loi instanceof ToolError && /CHƯA ĐO/.test(hien.loi.message) && !goi.includes('unlist:702:false'), hien.loi?.message)
            const thu = await chay('shopee_create_listing', { sku: 'X2', category_id: 101, can_nang_gram: 300, chay_thu: true })
            dung('E5. chạy thử đăng: vẫn ra thân yêu cầu nhưng báo trước sẽ bị từ chối', !thu.loi && /CHƯA ĐO/.test(thu.kq.phanTichGia?.canhBaoPhi || ''), thu.loi?.message)
            const that = await chay('shopee_create_listing', { sku: 'X2', category_id: 101, can_nang_gram: 300 })
            dung('E5. đăng thật bị từ chối, không nạp ảnh / add_item', that.loi instanceof ToolError && /CHƯA ĐO/.test(that.loi.message) && !goi.some(g => g.startsWith('add_item:X2')), that.loi?.message)
            const gy = await chay('shopee_suggest_price', { sku: 'X1' })
            dung('E5. suggest_price có canhBaoTuDong để AI biết báo chủ shop', !gy.loi && /CHƯA ĐO/.test(gy.kq.canhBaoTuDong || ''), gy.loi?.message)
        }

        // ─── E6. Hiện lại sản phẩm đang ẩn ─────────────────────────────────────────────
        {
            HIEN = taoCuaHang({ don: donSach() })
            const H = HIEN
            H.themHang('AN1', 100000); H.themHang('AN2', 200000)
            H.themListing('AN1', 120000, '601', 'UNLIST')
            H.baseInfo['601'] = { item_id: 601, item_sku: 'AN1', has_model: false, price_info: [{ current_price: 120000, original_price: 120000 }] }
            const truoc = ghiShopee().length
            const lo = await chay('shopee_toggle_listing', { item_id: '601', an: false })
            dung('E6. hiện lại hàng đang để giá dưới sàn (120.000 < 127.200) bị từ chối, không gọi Shopee', lo.loi instanceof ToolError && /Không hiện lại/.test(lo.loi.message) && /GIÁ SÀN/.test(lo.loi.message) && ghiShopee().length === truoc, lo.loi?.message)
            H.baseInfo['601'].price_info = [{ current_price: 150000, original_price: 150000 }]
            const duoc = await chay('shopee_toggle_listing', { item_id: '601', an: false })
            dung('E6. giá đọc THẲNG từ Shopee đã trên sàn ⇒ hiện lại được', !duoc.loi && goi.includes('unlist:601:false'), duoc.loi?.message)
            H.baseInfo['602'] = { item_id: 602, item_sku: '', has_model: true, price_info: [] }
            H.models['602'] = [
                { model_id: 1, name: 'Loại 1', sku: 'AN1', price: 150000, giaHienTai: 150000, stock: 2 },
                { model_id: 2, name: 'Loại 2', sku: 'AN2', price: 150000, giaHienTai: 150000, stock: 2 },
            ]
            const pl = await chay('shopee_toggle_listing', { item_id: '602', an: false })
            dung('E6. hàng có phân loại: một phân loại dưới sàn (vốn 200.000, giá 150.000) ⇒ không hiện lại', pl.loi instanceof ToolError && /Loại 2/.test(pl.loi.message) && !goi.includes('unlist:602:false'), pl.loi?.message)
            H.models['602'][1] = { model_id: 2, name: 'Loại 2', sku: 'KHONG-CO', price: 300000, giaHienTai: 300000, stock: 2 }
            const thieu = await chay('shopee_toggle_listing', { item_id: '602', an: false })
            dung('E6. phân loại không tra ra giá vốn ⇒ không hiện lại', thieu.loi instanceof ToolError && /thiếu giá vốn/.test(thieu.loi.message), thieu.loi?.message)
            const an = await chay('shopee_toggle_listing', { item_id: '602', an: true })
            dung('E6. ẩn thì không bao giờ bị chặn', !an.loi && goi.includes('unlist:602:true'), an.loi?.message)
        }

        // ─── E8. Khuyến mãi soát lại lúc thực thi ─────────────────────────────────────
        {
            HIEN = taoCuaHang({ don: donSach() })
            const H = HIEN
            for (const s of ['K1', 'K2', 'K3']) { H.themHang(s, 100000); H.themListing(s, 200000, `8${s.slice(1)}`) }
            H.themHang('K4A', 100000); H.themHang('K4B', 100000); H.themListing('K4', 0, '84')
            H.models['84'] = [
                { model_id: 11, name: 'A', sku: 'K4A', price: 200000, giaHienTai: 200000, stock: 3 },
                { model_id: 12, name: 'B', sku: 'K4B', price: 200000, giaHienTai: 200000, stock: 3 },
            ]
            await luuCauHinh(H.ctx, { executionMode: 'auto', policy: { maxDiscountRate: 0.3, maxWritesPerDay: 1000 } })
            const bd = Math.floor(Date.now() / 1000) + 3600
            const km = (ten: string, skus: string[]) => taoKeHoachKhuyenMai(H.ctx, { name: ten, skus, discountRate: 0.2, startTime: bd, endTime: bd + 7200, purchaseLimit: 2 })
            // giá KM 160.000đ ≥ sàn 127.200đ lúc lập kế hoạch
            const kh1 = await km('KM một phần', ['K1', 'K2'])
            H.hang.K2.costPrice = 140000                         // nhập hàng mới, vốn tăng ⇒ sàn 176.600 > 160.000
            const r1 = await thucThi(H.ctx, kh1.id)
            const items1 = JSON.parse(goi.filter(g => g.startsWith('add_discount_item:')).pop()!.slice('add_discount_item:'.length))
            dung('E8. giá vốn tăng sau khi lập kế hoạch ⇒ lúc thực thi bỏ dòng dưới sàn, chỉ gửi dòng còn giữ được sàn', r1.status === 'partial' && items1.length === 1 && items1[0].item_id === 81 && /dưới giá sàn hiện tại/.test(r1.result?.message || ''), JSON.stringify({ st: r1.status, items1, m: r1.result?.message }))

            const kh2 = await km('KM hết dòng', ['K1'])
            H.hang.K1.costPrice = 150000
            const t2 = goi.length
            const r2 = await thucThi(H.ctx, kh2.id)
            dung('E8. không còn dòng nào giữ được sàn ⇒ KHÔNG tạo chương trình trên Shopee', r2.status === 'failed' && !goi.slice(t2).some(g => g.startsWith('add_discount')) && /Không còn mã nào/.test(r2.result?.message || ''), r2.result?.message)

            const kh3 = await km('KM chính sách đổi', ['K3'])
            await luuCauHinh(H.ctx, { policy: { affiliateRate: 0.2 } })   // sàn mới 103.000 / (1 − 14% − 5% − 20%) = 168.900 > 160.000
            const t3 = goi.length
            const r3 = await thucThi(H.ctx, kh3.id)
            dung('E8. chủ shop nâng affiliate sau khi lập kế hoạch ⇒ giá KM cũ không lọt', r3.status === 'failed' && !goi.slice(t3).some(g => g.startsWith('add_discount')), r3.result?.message)
            await luuCauHinh(H.ctx, { policy: { affiliateRate: 0 } })

            const kh4 = await km('KM phân loại', ['K4'])
            H.hang.K4B.costPrice = 140000
            const r4 = await thucThi(H.ctx, kh4.id)
            const items4 = JSON.parse(goi.filter(g => g.startsWith('add_discount_item:')).pop()!.slice('add_discount_item:'.length))
            dung('E8. hàng có phân loại: chỉ phân loại còn giữ được sàn được gửi', r4.status === 'partial' && items4.length === 1 && JSON.stringify(items4[0].model_list) === JSON.stringify([{ model_id: 11, model_promotion_price: 160000 }]), JSON.stringify({ st: r4.status, items4 }))
        }

        // ─── E9. Đăng / đổi giá sau khi giá vốn tăng hoặc chính sách chặt hơn ───────────────
        {
            HIEN = taoCuaHang({ don: donSach() })
            const H = HIEN
            H.themHang('D1', 100000); H.themHang('G1', 100000); H.themListing('G1', 125000, '901')
            await luuCauHinh(H.ctx, { executionMode: 'auto', policy: { maxWritesPerDay: 1000, maxPriceChangeRate: 0.5 } })
            const khD = await taoKeHoachDang(H.ctx, { sku: 'D1', categoryId: 101, weightGram: 300 })
            H.hang.D1.costPrice = 130000                         // sàn mới 133.000 / 0,81 = 164.200 > giá kế hoạch
            const t1 = goi.length
            const rD = await thucThi(H.ctx, khD.id)
            dung(`E9. kế hoạch đăng giá ${khD.data.payload.original_price}đ, vốn tăng lên 130.000đ ⇒ thực thi từ chối, không add_item`, rD.status === 'failed' && /GIÁ SÀN/.test(rD.result?.message || '') && !goi.slice(t1).some(g => g.startsWith('add_item')), rD.result?.message)
            const khG = await taoKeHoachGia(H.ctx, { sku: 'G1', price: 130000 })
            await luuCauHinh(H.ctx, { policy: { minMarginRate: 0.15 } })    // sàn mới 103.000 / 0,71 = 145.100
            const t2 = goi.length
            const rG = await thucThi(H.ctx, khG.id)
            dung('E9. kế hoạch đổi giá 130.000đ, chủ shop nâng biên tối thiểu 15% ⇒ thực thi từ chối', rG.status === 'failed' && /GIÁ SÀN/.test(rG.result?.message || '') && !goi.slice(t2).some(g => g.startsWith('update_price')), rG.result?.message)
        }

        // ─── E10. Thuế GTGT + lời nhắc theo loại hình ─────────────────────────────────
        {
            HIEN = taoCuaHang({ don: donSach() })
            const H = HIEN
            H.themHang('V1', 100000); H.themListing('V1', 200000, '1001')
            let st = await xayTrangThai(H.ctx)
            dung('E10. doanh nghiệp chưa khai thuế GTGT ⇒ trạng thái nhắc khai', /DOANH NGHIỆP/.test(st.status.taxNote || ''), st.status.taxNote)
            await luuCauHinh(H.ctx, { policy: { vatRate: 0.1 } })
            st = await xayTrangThai(H.ctx)
            const v1 = st.products.find((p: any) => p.sku === 'V1')
            // 103.000 / (1 − 14% − 5% − 10/110) = 143.234 → 143.300
            dung('E10. khai GTGT 10% ⇒ giá sàn trừ phần thuế đầu ra (143.300), hết lời nhắc', v1?.pricing.floor === 143300 && !st.status.taxNote, `${v1?.pricing.floor} ${st.status.taxNote || ''}`)
            H.st.loaiHinh = 'household'
            st = await xayTrangThai(H.ctx)
            dung('E10. hộ kinh doanh mà khai GTGT ⇒ nhắc là đang dư (Shopee đã khấu trừ trong tiền về)', /HỘ/.test(st.status.taxNote || ''), st.status.taxNote)
        }

        // ─── E11. Hoa hồng affiliate đo được cao hơn mức khai (chủ shop KHÔNG khai) ───────────
        {
            // 200 đơn: phí thật 20% + 3.000đ, cứ 5 đơn có 1 đơn affiliate 15% — hoa hồng từng đơn đã đọc từ escrow
            const don = Array.from({ length: 200 }, (_, i) => {
                const g = Math.round(50000 * Math.pow(16, (i * 37 % 200) / 200)), r = i % 5 === 0 ? 0.15 : 0
                return { giaBan: g, phi: (0.2 + r) * g + 3000, aff: r * g }
            })
            HIEN = taoCuaHang({ don })
            const H = HIEN
            for (let i = 0; i < 30; i++) {
                const sku = `M${i}`, von = Math.round(logKhoang(20000, 400000) / 100) * 100
                H.themHang(sku, von)
                H.themListing(sku, Math.round((von * khoang(0.9, 2.4)) / 1000) * 1000, String(1200 + i))
            }
            await luuCauHinh(H.ctx, {
                executionMode: 'auto',
                policy: { minMarginRate: 0.06, targetMarginRate: 0.15, maxPriceChangeRate: 0.3, affiliateRate: 0, packagingCost: 2000, adsRate: 0.03, maxWritesPerDay: 1000, automation: { publishNewProducts: false, reprice: true } },
            })
            const st = await xayTrangThai(H.ctx)
            const fm = st.status.feeModel
            dung('E11. trạng thái: phí đo tách hoa hồng, hoa hồng giá sàn 15% (đo được) dù chính sách khai 0%, kèm cảnh báo',
                fm?.affiliate?.separated === true && Math.abs((fm?.floorAffiliateRate ?? 0) - 0.15) < 1e-9 && /15%/.test(fm?.affiliateWarning || '') && Math.abs(fm?.rate - 0.2) < 1e-6,
                JSON.stringify({ aff: fm?.affiliate, san: fm?.floorAffiliateRate, w: fm?.affiliateWarning, rate: fm?.rate }))
            const sp0 = st.products.find((p: any) => p.pricing?.floor)
            dung('E11. sản phẩm hiện "lãi nếu đơn qua affiliate" dù chính sách chưa khai affiliate', sp0?.pricing?.affiliateProfit != null, JSON.stringify(sp0?.pricing))
            const truoc = goi.length
            for (let lan = 0; lan < 6; lan++) await chayChuKy(H.ctx)
            const doi = goi.slice(truoc).filter(g => g.startsWith('update_price:'))
            const sai: string[] = []
            for (const g of doi) {
                const [, item, giaS] = g.split(':'), gia = Number(giaS)
                const l = H.listing.find(x => x.platformProductId === item)!
                const von = H.hang[l.sku].costPrice
                const laiAff = gia - (0.35 * gia + 3000) - von - 2000 - 0.03 * gia       // đơn affiliate 15%, phí THẬT
                if (laiAff / gia < 0.06 - 0.001) sai.push(`${l.sku} giá ${gia} vốn ${von}: biên đơn affiliate ${(laiAff / gia * 100).toFixed(2)}%`)
            }
            const conLo = H.listing.filter(l => { const von = H.hang[l.sku].costPrice; return l.price - (0.35 * l.price + 3000) - von - 2000 - 0.03 * l.price < 0 })
            dung(`E11. chu kỳ Tự động (6 lượt, chính sách khai affiliate 0%): ${doi.length} lần đổi giá — mọi giá giữ biên ≥ 6% kể cả đơn affiliate 15%`, doi.length >= 10 && sai.length === 0, sai.slice(0, 3).join(' | '))
            dung(`E11. sau 6 lượt không còn listing nào lỗ với đơn affiliate 15% (${conLo.length} còn lỗ)`, conLo.length === 0, conLo.map(l => `${l.sku}@${l.price}`).join(', '))
            const kh = H.kho._keHoach.find(k => k.kind === 'price' && k.data?.economics)
            dung('E11. kế hoạch đổi giá mang "lãi nếu đơn qua affiliate" theo mức đo được', kh?.data?.economics?.affiliateProfit != null, JSON.stringify(kh?.data?.economics))
        }

        // ─── E12. Cửa hàng chưa migrate cột affiliateFee ──────────────────────────────
        {
            HIEN = taoCuaHang({ don: donSach() })
            const H = HIEN
            H.st.thieuCotAff = true
            H.themHang('Q1', 100000); H.themListing('Q1', 200000, '1301')
            const st = await xayTrangThai(H.ctx)
            dung('E12. thiếu cột affiliateFee ⇒ vẫn đo phí như cũ (không rơi về 6% cấu hình), chỉ là chưa biết hoa hồng',
                H.st.hoiCotAff > 0 && st.status.feeModel?.source === 'hoi-quy-don' && st.status.feeModel?.affiliate === null && st.products.find((p: any) => p.sku === 'Q1')?.pricing?.floor === 127200,
                JSON.stringify({ hoi: H.st.hoiCotAff, fm: st.status.feeModel?.source, floor: st.products.find((p: any) => p.sku === 'Q1')?.pricing?.floor }))
        }

        // ─── E13. Đọc hoa hồng từ escrow Shopee ───────────────────────────────────────
        {
            const svc: any = new ShopeeService({ apiKey: '1', apiSecret: 's', accessToken: 't', shopId: '777' })
            const hoi = async (them: any) => {
                svc.httpGet = async () => ({ response: { order_income: { order_selling_price: 100000, escrow_amount: 70000, commission_fee: 9000, ...them } } })
                return svc.getEscrowDetail('X1')
            }
            const k0 = await hoi({ order_ams_commission_fee: 0 }), k8 = await hoi({ order_ams_commission_fee: 8000 })
            const thieu = await hoi({}), rong = await hoi({ order_ams_commission_fee: null }), am = await hoi({ order_ams_commission_fee: -1 })
            dung('E13. escrow: hoa hồng 0 ⇒ 0 (biết chắc không qua affiliate), 8.000 ⇒ 8.000, phí vẫn = giá − thực nhận',
                k0?.affiliateFee === 0 && k8?.affiliateFee === 8000 && k8?.totalFees === 30000, JSON.stringify({ k0, k8 }))
            dung('E13. escrow thiếu trường / null / âm ⇒ null (chưa biết), KHÔNG phải 0', thieu?.affiliateFee === null && rong?.affiliateFee === null && am?.affiliateFee === null,
                JSON.stringify([thieu?.affiliateFee, rong?.affiliateFee, am?.affiliateFee]))
            const src = fs.readFileSync(path.join(__dirname, '../src/cron/autoSync.ts'), 'utf8')
            dung('E13. lượt bù hoa hồng chỉ ghi cột affiliateFee và chỉ khi đọc được (không ghi 0 thay số thiếu)',
                /e\?\.affiliateFee == null\) \{ khongRa\+\+/.test(src) && /data: \{ affiliateFee: e\.affiliateFee \}/.test(src) && /affiliateFee: null/.test(src))
            // đo 01/11: lượt chính ăn gần hết 240s ⇒ lượt bù chỉ còn ~1 phút, bù 38 đơn của đúng kênh đứng đầu danh sách
            dung('E13. lượt bù có giờ RIÊNG (lượt chính ăn hết 240s vẫn bù được) và bắt đầu từ kênh ngẫu nhiên (không kênh nào bị bỏ đói)',
                /hanBu = Math\.max\(batDau \+ FEE_DEADLINE_MS, Date\.now\(\) \+ AFF_BU_MS\)/.test(src) && /if \(Date\.now\(\) > han\) \{ hetGio\+\+/.test(src) &&
                /Math\.floor\(Math\.random\(\) \* kenhBuAff\.length\)/.test(src) && /kenhBuAff\[\(dau \+ i\) % kenhBuAff\.length\]/.test(src) &&
                /buHoaHongAffiliate\(getStorePrisma\(schema\), ch, hanBu,/.test(src))
        }

        // ─── E14. Phí theo NGÀNH (02/11/2026, chủ shop: "mỗi ngành hàng lại 1 % phí khác nhau") ─────────────────
        {
            // ngành 101: 14% + 3.000đ; ngành 303: 30% — mỗi ngành 40 đơn đối soát; cả gian (trộn) = 22% + 1.500đ
            const n101 = donSach().map(d => ({ ...d, nganh: '101' }))
            const n303 = donSach().map(d => ({ giaBan: d.giaBan, phi: 0.3 * d.giaBan, nganh: '303' }))
            HIEN = taoCuaHang({ don: [...n101, ...n303].map(({ nganh: _n, ...d }) => d), donNganh: [...n101, ...n303] })
            const H = HIEN
            H.themHang('N1', 60000); H.themListing('N1', 150000, '1401', 'NORMAL', '303')   // ngành phí 30%, ế, lãi cao ⇒ chu kỳ HẠ
            await luuCauHinh(H.ctx, { executionMode: 'auto', policy: { targetMarginRate: 0.08, minMarginRate: 0.05, maxPriceChangeRate: 0.5, maxWritesPerDay: 1000, automation: { publishNewProducts: false, reprice: true } } })
            const ts303: ThamSoGia = { giaVon: 60000, phi: { tyLe: 0.3, coDinh: 0 } as MauPhi, bienLoiNhuanPct: 8, bienToiThieuPct: 5, lamTron: 1000 }
            const kq303 = tinhGiaDeXuat(ts303)
            const kqGian = tinhGiaDeXuat({ ...ts303, phi: uocLuongPhi([...n101, ...n303], 6) })
            dung('E14. (đối chứng) theo phí TRUNG BÌNH cả gian, giá đề xuất hàng ngành 30% nằm DƯỚI giá sàn thật của ngành — đường lỗ có thật',
                kqGian.giaDeXuat < kq303.giaSan, `${kqGian.giaDeXuat} < ${kq303.giaSan}`)
            const t0 = goi.length
            const kq = await chayChuKy(H.ctx)
            const ghi = goi.slice(t0).find(g => g.startsWith('update_price:1401:'))
            const giaMoi = Number(ghi?.split(':')[2] || 0)
            dung('E14. chu kỳ Tự động HẠ giá theo phí NGÀNH 30% — đúng giá đề xuất của ngành, không dưới giá sàn thật',
                giaMoi === kq303.giaDeXuat && giaMoi >= kq303.giaSan, `${ghi} (sàn ngành ${kq303.giaSan}) ${JSON.stringify(kq.results)}`)
            // kế hoạch lập khi hàng còn ở ngành phí thấp; ngành đổi (đồng bộ lại) trước lúc thực thi ⇒ soát theo ngành MỚI
            H.themHang('N2', 60000); H.themListing('N2', 100000, '1402', 'NORMAL', '101')
            const khN2 = await taoKeHoachGia(H.ctx, { sku: 'N2', price: 90000 })     // sàn ngành 101: 63.000 / 0,81 = 77.800
            H.listing.find(l => l.sku === 'N2')!.categoryId = '303'                    // sàn ngành 303: 60.000 / 0,65 = 92.400
            const t1 = goi.length
            const rN2 = await thucThi(H.ctx, khN2.id)
            dung('E14. ngành đổi sau khi lập kế hoạch ⇒ thực thi soát lại theo phí ngành MỚI, từ chối giá dưới sàn',
                rN2.status === 'failed' && /GIÁ SÀN/.test(rN2.result?.message || '') && !goi.slice(t1).some(g => g.startsWith('update_price:1402')), rN2.result?.message)
            // tool AI soát giá: từng listing theo phí ngành của nó — 88.000đ trên sàn cả gian (84.300) nhưng dưới sàn ngành (92.400)
            H.themHang('N3', 60000); H.themListing('N3', 88000, '1403', 'NORMAL', '303')
            datDemTienIch('KHONGLO', ['online', TIEN_ICH_SHOPEE_PILOT])
            const soat = await chay('shopee_review_listings', { chi_van_de: false })
            const n3 = soat.kq?.sanPham?.find((x: any) => x.sku === 'N3')
            dung('E14. tool AI soát giá: listing ngành 303 báo DƯỚI GIÁ SÀN theo phí ngành (theo phí cả gian thì không)',
                !soat.loi && n3?.giaSan === kq303.giaSan && n3?.vanDe?.includes('DƯỚI GIÁ SÀN') && Math.abs((n3?.phiSanPct ?? 0) - 30) < 0.01, soat.loi?.message || JSON.stringify(n3))
            const goiY = await chay('shopee_suggest_price', { sku: 'N3' })
            dung('E14. tool AI gợi ý giá: hàng đang bán ở ngành 303 ⇒ giá theo phí ngành của listing', !goiY.loi && goiY.kq?.giaDeXuat === kq303.giaDeXuat && goiY.kq?.mauPhi?.phamVi === 'ngành 303', goiY.loi?.message || JSON.stringify({ g: goiY.kq?.giaDeXuat, p: goiY.kq?.mauPhi?.phamVi }))
            const hienN3 = await chay('shopee_toggle_listing', { item_id: '1403', an: false })
            dung('E14. hiện lại hàng ẩn: giá 88.000đ dưới sàn NGÀNH (92.400) ⇒ từ chối, không gọi Shopee', hienN3.loi instanceof ToolError && /GIÁ SÀN/.test(hienN3.loi.message) && !goi.some(g => g.startsWith('unlist:1403')), hienN3.loi?.message)
        }

        // ─── E15. Hoa hồng affiliate là chuyện CẢ SHOP (02/11/2026, phiên soát chéo chỉ ra lỗ hở của E14) ───────────
        // Chiến dịch affiliate Shopee áp mọi sản phẩm ⇒ ngành CHƯA thấy đơn affiliate vẫn có thể ra đơn affiliate: giá sàn
        // của nó phải tính theo mức cao nhất đo được ở CẢ gian, không chỉ trong ngành.
        {
            // ngành 101: 40 đơn, cứ 5 đơn có 1 đơn affiliate 12% (hoa hồng đọc từ escrow); ngành 303: 40 đơn phí 30%, KHÔNG đơn affiliate
            const n101 = donSach().map((d, i) => { const r = i % 5 === 0 ? 0.12 : 0; return { giaBan: d.giaBan, phi: d.phi + r * d.giaBan, aff: r * d.giaBan, nganh: '101' } })
            const n303 = donSach().map(d => ({ giaBan: d.giaBan, phi: 0.3 * d.giaBan, aff: 0, nganh: '303' }))
            HIEN = taoCuaHang({ don: [...n101, ...n303].map(({ nganh: _n, ...d }) => d), donNganh: [...n101, ...n303] })
            const H = HIEN
            H.themHang('B1', 60000); H.themListing('B1', 150000, '1501', 'NORMAL', '303')
            await luuCauHinh(H.ctx, { policy: { targetMarginRate: 0.15, minMarginRate: 0.05, affiliateRate: 0 } })   // chủ shop KHÔNG khai affiliate
            const st = await xayTrangThai(H.ctx)
            const b1 = st.products.find((p: any) => p.sku === 'B1')
            // phí ngành 303 đo tách affiliate (40 đơn biết hoa hồng, đều 0) = 30%; đơn affiliate 12% bán ĐÚNG giá sàn
            const ts303: ThamSoGia = { giaVon: 60000, phi: { tyLe: 0.3, coDinh: 0 } as MauPhi, bienLoiNhuanPct: 15, bienToiThieuPct: 5, lamTron: 1000 }
            const quaAff = danhGiaGia(Number(b1?.pricing?.floor) || 0, { ...ts303, phiAffiliatePct: 12 }, true)
            dung('E15. ngành CHƯA thấy đơn affiliate: giá sàn vẫn chịu được đơn affiliate 12% đo ở ngành khác (lãi ≥ biên tối thiểu)',
                (b1?.pricing?.floor ?? 0) > 0 && quaAff.bienPct >= 5 - 1e-9, JSON.stringify({ san: b1?.pricing?.floor, quaAff }))
            const san0 = tinhGiaDeXuat(ts303).giaSan
            const lo = danhGiaGia(san0, { ...ts303, phiAffiliatePct: 12 }, true)
            dung('E15. (đối chứng) sàn chỉ theo affiliate CỦA NGÀNH (0%) ⇒ đơn affiliate đầu tiên của ngành bán ở giá sàn bị LỖ — đường lỗ có thật',
                lo.loiNhuan < 0, JSON.stringify({ san0, lo }))
            dung('E15. lời nhắc affiliate của trạng thái khớp giá sàn đang dùng (12%)', Math.abs((st.status.feeModel?.floorAffiliateRate ?? 0) - 0.12) < 1e-9, JSON.stringify(st.status.feeModel?.floorAffiliateRate))

            // E15b. số đo cả gian (600 đơn mới nhất) KHÔNG thấy đơn affiliate nào — chỉ đơn cũ hơn của ngành 101 có 12% (truy
            // vấn ngành đọc tới 2.000 đơn) ⇒ hàng ngành chưa đo riêng (dùng phí cả gian) vẫn phải tính sàn theo 12%
            HIEN = taoCuaHang({ don: [...n101.filter(d => !d.aff), ...n303].map(({ nganh: _n, ...d }) => d), donNganh: [...n101, ...n303] })
            const H2 = HIEN
            H2.themHang('C1', 60000); H2.themListing('C1', 150000, '1502', 'NORMAL', '909')   // ngành chưa đủ đơn ⇒ phí cả gian
            await luuCauHinh(H2.ctx, { policy: { targetMarginRate: 0.15, minMarginRate: 0.05, affiliateRate: 0 } })
            const st2 = await xayTrangThai(H2.ctx)
            const c1 = st2.products.find((p: any) => p.sku === 'C1')
            const phiC1 = { tyLe: Number(c1?.pricing?.fee?.rate) || 0, coDinh: Number(c1?.pricing?.fee?.fixedPerOrder) || 0 } as MauPhi
            const quaAff2 = danhGiaGia(Number(c1?.pricing?.floor) || 0, { giaVon: 60000, phi: phiC1, phiAffiliatePct: 12 }, true)
            dung('E15b. cả gian chưa thấy affiliate, đơn cũ của một ngành thấy 12% ⇒ hàng dùng phí cả gian vẫn tính sàn theo 12%',
                c1?.pricing?.fee?.scope === 'thay-nganh' && quaAff2.bienPct >= 5 - 1e-9 && Math.abs((st2.status.feeModel?.floorAffiliateRate ?? 0) - 0.12) < 1e-9,
                JSON.stringify({ san: c1?.pricing?.floor, phi: c1?.pricing?.fee?.rate, quaAff2, fa: st2.status.feeModel?.floorAffiliateRate }))
        }

        // ─── F. Bộ chọn hồ sơ đăng ────────────────────────────────────────────────────
        {
            HIEN = taoCuaHang({ don: donSach() })
            const H = HIEN
            H.themHang('OC4', 100000, 12, 'Ổ cắm'); H.themHang('OC6', 120000, 0, 'Ổ cắm'); H.themHang('BINH', 50000, 30, 'Gia dụng')
            H.themListing('BINH', 99000, '1101')
            await luuHoSo(H.ctx, { scope: 'nhom', key: 'Ổ cắm', categoryId: 101, weightGram: 300 })
            const st = await xayTrangThai(H.ctx)
            const oc = st.status.khoGroups?.find((g: any) => g.name === 'Ổ cắm')
            dung('F. nhóm hàng kèm số mã và số mã còn tồn', oc?.total === 2 && oc?.inStock === 1 && st.status.khoGroups.length === 2, JSON.stringify(st.status.khoGroups))
            const tim = await timHangChoHoSo(H.ctx, { keyword: 'oc' })
            const oc4 = tim.products.find(p => p.sku === 'OC4')
            dung('F. tìm mã theo SKU: ra đúng mã, kèm nhóm / tồn / cờ đủ vốn, ảnh / hồ sơ đang áp', tim.products.length === 2 && oc4?.category === 'Ổ cắm' && oc4?.stock === 12 && oc4?.hasCost && oc4?.hasImage && oc4?.profile?.scope === 'nhom' && oc4?.listed === false, JSON.stringify(tim.products))
            const binh = (await timHangChoHoSo(H.ctx, { keyword: 'binh' })).products[0]
            dung('F. tìm theo tên không dấu khớp SKU, cờ ĐÃ ĐĂNG đúng', binh?.sku === 'BINH' && binh?.listed === true && binh?.profile === null, JSON.stringify(binh))
            dung('F. từ khoá rỗng ⇒ không quét kho', (await timHangChoHoSo(H.ctx, { keyword: '  ' })).products.length === 0)
            const route = fs.readFileSync(path.join(__dirname, '../src/routes/shopeePilot.ts'), 'utf8')
            dung("F. route có thao tác 'product-search' và là thao tác ĐỌC", /'product-search': \{ ghi: false/.test(route))
        }
    } finally {
        ;(globalThis as any).fetch = fetchGoc
    }

    console.log(loi ? `\n❌ ${loi} kiểm tra hỏng` : '\n✅ Pilot / AI chạy không phát sinh lỗ: mọi kiểm tra đạt')
    process.exit(loi ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(1) })
