// ═══════════════════════════════════════════════════════════════════════════════
//  PACKING LIST — SỐ LƯỢNG TỪNG MẶT HÀNG ĐVVC ĐÃ LẤY TRONG NGÀY
//
//  MỘT bản tính, hai lối gọi: `GET /api/online-orders/packing-list` (chủ shop, JWT)
//  và `GET /api/admin/do-packing-list` (bộ đo, admin key). Chép thành hai bản là
//  cách chắc chắn nhất để hai con số lệch nhau rồi không ai biết vì sao — đúng bệnh
//  "hai router cùng đường" đã dính một lần.
//
//  Mốc là `shippedAt` — LÚC ĐVVC THỰC SỰ LẤY HÀNG (Shopee `pickup_done_time`,
//  TikTok `rts_time`, Lazada `shipped_at`), KHÔNG phải hạn bàn giao. Cùng mốc với
//  tab "ĐVVC đã lấy hôm nay" (`?pickedUpToday=true`) nên hai màn hình không lệch.
//
//  GOM THEO MẶT HÀNG KHO THẬT (chủ shop 11/09/2026: "sản phẩm con thì lấy sản
//  phẩm mẹ, combo thì lấy chi tiết"). Mỗi dòng đơn đi qua CÙNG thứ tự luật với lúc
//  đơn về trừ kho (orderSync.convertOnlineOrderToTransaction): mã đã liên kết → SKU
//  kho (không phân biệt hoa thường, DUY NHẤT) → ánh xạ SKU (combo / hệ số) → listing
//  cùng kênh khớp duy nhất; rồi MÃ CON đã gộp → MÃ MẸ × mergedRate; mã là COMBO →
//  bung từng thành phần. Số lượng vì thế là ĐƠN VỊ KHO — đúng số kho đã trừ, không
//  còn là đơn vị sàn như trước 11/09. `tu` của mỗi dòng ghi lại dòng đơn gốc.
// ═══════════════════════════════════════════════════════════════════════════════

import { khoangNgayVN, ngayVN } from './vnTime'
import { ganAnhDongHang } from './anhDongHang'
import { khoaNhomDVVC } from './dvvc'
import { isReversalStatus } from '../services/onlineOrderReversal'

/** Trần đơn/ngày. Ngày đông nhất đo được ~400 đơn; đây là lưới cho bộ nhớ 512Mi. */
const TRAN = 2000

type LoaiNguon = 'truc-tiep' | 'ma-con' | 'combo'
interface HangKho { id: string; sku: string; name: string; stock: number; mergedIntoId: string | null; mergedRate: number; bundleId: string | null }
const CHON_HANG = { id: true, sku: true, name: true, stock: true, mergedIntoId: true, mergedRate: true, bundleId: true }

/**
 * Bộ phân giải dòng đơn → mặt hàng kho, CHỈ ĐỌC, có bộ nhớ đệm trong MỘT lượt tính
 * (một ngày vài trăm đơn nhưng chỉ vài chục mã — pool prod = 1, không Promise.all).
 * Thứ tự luật chép từ orderSync; KHÁC một chỗ có chủ ý: thành phần combo mà là mã
 * con thì cũng quy về mã mẹ (luật chủ shop áp cho mọi dòng), còn orderSync hiện
 * trừ thẳng vào mã thành phần.
 */
class BoPhanGiai {
    private theoId = new Map<string, HangKho | null>()
    private theoSku = new Map<string, HangKho | null>()
    private anhXa = new Map<string, any>()
    private listing = new Map<string, string | null>()
    private combo = new Map<string, { sp: HangKho; soLuong: number }[] | null>()
    constructor(private prisma: any) { }

    async layId(id: string): Promise<HangKho | null> {
        if (!this.theoId.has(id)) {
            const p = await this.prisma.product.findUnique({ where: { id }, select: CHON_HANG }).catch(() => null)
            this.theoId.set(id, p ? { ...p, mergedRate: Number(p.mergedRate) || 1 } : null)
        }
        return this.theoId.get(id) ?? null
    }

    /** SKU kho không phân biệt hoa thường — NHIỀU mã trùng thì không đoán (như orderSync). */
    private async laySku(sku: string): Promise<HangKho | null> {
        const k = sku.toLowerCase()
        if (!this.theoSku.has(k)) {
            const ds = await this.prisma.product.findMany({ where: { sku: { equals: sku, mode: 'insensitive' } }, select: CHON_HANG, take: 2 }).catch(() => [])
            this.theoSku.set(k, ds.length === 1 ? { ...ds[0], mergedRate: Number(ds[0].mergedRate) || 1 } : null)
        }
        return this.theoSku.get(k) ?? null
    }

    private async layAnhXa(sku: string, platform: string | null): Promise<any> {
        const k = `${platform || ''}|${sku.toLowerCase()}`
        if (!this.anhXa.has(k)) {
            const m = await this.prisma.skuMapping.findFirst({
                where: { platformSku: { equals: sku, mode: 'insensitive' }, OR: [{ platform: null }, { platform: platform || undefined }] },
            }).catch(() => null)
            this.anhXa.set(k, m)
        }
        return this.anhXa.get(k)
    }

    private async layListing(channelId: string, sku: string | null, ten: string): Promise<string | null> {
        const k = `${channelId}|${(sku || '').toLowerCase()}|${ten}`
        if (!this.listing.has(k)) {
            const ds = await this.prisma.onlineProduct.findMany({
                where: { channelId, localProductId: { not: null }, OR: [...(sku ? [{ sku }] : []), { name: ten }] },
                select: { localProductId: true }, take: 2,
            }).catch(() => [])
            this.listing.set(k, ds.length === 1 ? ds[0].localProductId : null)
        }
        return this.listing.get(k) ?? null
    }

    /** Thành phần combo (JSON trong Bundle.items) — thành phần theo productId, hoặc SKU. */
    private async layCombo(bundleId: string) {
        if (!this.combo.has(bundleId)) {
            const b = await this.prisma.bundle.findUnique({ where: { id: bundleId } }).catch(() => null)
            let comps: any[] = []
            try { comps = JSON.parse(b?.items || '[]') } catch { comps = [] }
            const ra: { sp: HangKho; soLuong: number }[] = []
            for (const c of comps) {
                let sp: HangKho | null = null
                if (c?.productId) sp = await this.layId(String(c.productId))
                else if (c?.sku) {
                    const p = await this.prisma.product.findFirst({ where: { sku: String(c.sku) }, select: CHON_HANG }).catch(() => null)
                    sp = p ? { ...p, mergedRate: Number(p.mergedRate) || 1 } : null
                }
                if (sp) ra.push({ sp, soLuong: Number(c?.quantity) || 1 })
            }
            this.combo.set(bundleId, ra.length ? ra : null)
        }
        return this.combo.get(bundleId) ?? null
    }

    /** Mã con đã gộp → mã mẹ (× hệ số). Đọc hỏng mã mẹ thì GIỮ mã con, không đoán. */
    private async veMe(sp: HangKho, soLuong: number): Promise<{ sp: HangKho; soLuong: number; laCon: boolean }> {
        if (!sp.mergedIntoId) return { sp, soLuong, laCon: false }
        const me = await this.layId(sp.mergedIntoId)
        return me ? { sp: me, soLuong: soLuong * (sp.mergedRate || 1), laCon: true } : { sp, soLuong, laCon: false }
    }

    private async bung(bundleId: string, slDong: number) {
        const comps = await this.layCombo(bundleId)
        if (!comps) return null
        const ra: { sp: HangKho; soLuong: number; loai: LoaiNguon }[] = []
        for (const c of comps) {
            const v = await this.veMe(c.sp, c.soLuong * slDong)
            ra.push({ sp: v.sp, soLuong: v.soLuong, loai: 'combo' })
        }
        return ra
    }

    /** Một dòng đơn → [{ mặt hàng kho, số lượng ĐƠN VỊ KHO, loại nguồn }], null = không tra ra. */
    async phanGiai(it: any, platform: string | null, channelId: string | null) {
        const sl = Number(it.quantity) || 0
        const sku = String(it.sku || '').trim() || null
        let sp: HangKho | null = null
        let tiLe = 1
        if (it.productId) sp = await this.layId(String(it.productId))
        if (!sp && sku) sp = await this.laySku(sku)
        if (!sp && sku) {
            const m = await this.layAnhXa(sku, platform)
            if (m?.bundleId) { const r = await this.bung(String(m.bundleId), sl); if (r) return r }
            if (m?.productId) { sp = await this.layId(String(m.productId)); tiLe = Number(m.conversionRate) || 1 }
        }
        if (!sp && channelId) {
            const id = await this.layListing(channelId, sku, String(it.productName || ''))
            if (id) sp = await this.layId(id)
        }
        if (!sp) return null
        const v = await this.veMe(sp, sl * tiLe)
        if (v.sp.bundleId) { const r = await this.bung(v.sp.bundleId, sl); if (r) return r }
        return [{ sp: v.sp, soLuong: v.soLuong, loai: (v.laCon ? 'ma-con' : 'truc-tiep') as LoaiNguon }]
    }
}

export interface ThamSoPackingList {
    ngay?: string          // 'YYYY-MM-DD', trống = hôm nay (giờ VN)
    platform?: string
    channelId?: string
    carrier?: string       // khoá NHÓM ĐVVC, hoặc 'khong-co'
}

/** Nhãn ĐVVC thô thuộc một nhóm (GHN nằm dưới ba tên khác nhau — xem lib/dvvc.ts). */
async function nhanThuocNhom(prisma: any, key: string): Promise<string[]> {
    const rows: any[] = await prisma.onlineOrder.findMany({
        where: { shippingCarrier: { not: null } },
        select: { shippingCarrier: true },
        distinct: ['shippingCarrier'],
    })
    return rows.map(r => String(r.shippingCarrier || '')).filter(t => t && khoaNhomDVVC(t) === key)
}

export async function dungPackingList(prisma: any, ts: ThamSoPackingList) {
    /* Lấy mốc GIỮA TRƯA của ngày rồi mới cắt biên: `new Date('YYYY-MM-DD')` là
     * 00:00 UTC = 07:00 VN cùng ngày (may) hoặc lệch hẳn sang hôm trước. */
    const ngayXin = String(ts.ngay || '').trim()
    if (ngayXin && !/^\d{4}-\d{2}-\d{2}$/.test(ngayXin)) {
        throw Object.assign(new Error('Tham số ngay phải dạng YYYY-MM-DD'), { code: 'THAM_SO' })
    }
    const moc = ngayXin ? new Date(`${ngayXin}T12:00:00+07:00`) : new Date()
    if (Number.isNaN(moc.getTime())) {
        throw Object.assign(new Error(`Ngày không hợp lệ: ${ngayXin}`), { code: 'THAM_SO' })
    }
    const { tu, den } = khoangNgayVN(moc)

    const where: any = { shippedAt: { gte: tu, lte: den } }
    if (ts.platform && ts.platform !== 'all') where.platform = ts.platform
    if (ts.channelId) where.channelId = ts.channelId
    if (ts.carrier && ts.carrier !== 'all') {
        if (ts.carrier === 'khong-co') where.OR = [{ shippingCarrier: null }, { shippingCarrier: '' }]
        else where.shippingCarrier = { in: await nhanThuocNhom(prisma, ts.carrier) }
    }

    const orders = await prisma.onlineOrder.findMany({
        where,
        select: {
            id: true, orderNumber: true, status: true, platform: true,
            channelId: true, shippingCarrier: true, shippedAt: true,
            items: { select: { sku: true, productName: true, quantity: true, productId: true, externalItemId: true } },
        },
        orderBy: { shippedAt: 'asc' },
        take: TRAN + 1,
    })
    const chamTran = orders.length > TRAN
    if (chamTran) orders.length = TRAN

    /* Gom theo MẶT HÀNG KHO CUỐI CÙNG (mã mẹ / thành phần combo). Dòng không tra ra
     * hàng kho thì gom theo SKU sàn rồi tới tên như trước — gom thẳng theo tên là gom
     * nhầm hai phân loại khác nhau của cùng một listing. */
    type Nguon = { sku: string | null; ten: string; loai: LoaiNguon | 'chua-lien-ket'; soLuongSan: number; soLuongKho: number }
    type Dong = {
        productId: string | null; sku: string | null; ten: string
        soLuong: number; donSet: Set<string>; tonKho: number | null
        chuaLienKet: boolean; externalItemId: string | null
        tu: Map<string, Nguon>
    }
    const gom = new Map<string, Dong>()
    const theoKenh = new Map<string, { channelId: string | null; soDon: Set<string>; soLuong: number }>()
    const donDaHuy: string[] = []
    let tongSoLuong = 0
    let soDongChuaLienKet = 0
    let soDongMaCon = 0
    let soDongCombo = 0
    const bo = new BoPhanGiai(prisma)

    const themVao = (khoa: string, dau: Omit<Dong, 'soLuong' | 'donSet' | 'tu'>, soLuong: number, donId: string, nguon: Nguon) => {
        if (!gom.has(khoa)) gom.set(khoa, { ...dau, soLuong: 0, donSet: new Set(), tu: new Map() })
        const d = gom.get(khoa)!
        d.soLuong += soLuong
        d.donSet.add(donId)
        const kn = `${nguon.loai}|${(nguon.sku || nguon.ten).toLowerCase()}`
        const n = d.tu.get(kn)
        if (n) { n.soLuongSan += nguon.soLuongSan; n.soLuongKho += nguon.soLuongKho }
        else d.tu.set(kn, { ...nguon })
    }

    for (const o of orders) {
        if (isReversalStatus(o.status)) donDaHuy.push(o.orderNumber)
        const kKenh = o.channelId || '(không kênh)'
        if (!theoKenh.has(kKenh)) theoKenh.set(kKenh, { channelId: o.channelId, soDon: new Set(), soLuong: 0 })
        const tk = theoKenh.get(kKenh)!
        tk.soDon.add(o.id)

        for (const it of (o.items || [])) {
            const sl = Number(it.quantity) || 0
            const skuSan = String(it.sku || '').trim() || null
            const ten = it.productName || 'Không tên'
            const kq = await bo.phanGiai(it, o.platform || null, o.channelId || null)

            if (!kq) {
                // Không tra ra hàng kho: không quy đổi được ⇒ giữ ĐƠN VỊ SÀN, cờ chưa liên kết.
                const khoa = skuSan ? `s:${skuSan.toLowerCase()}` : `n:${ten.toLowerCase()}`
                if (!gom.has(khoa)) soDongChuaLienKet++
                themVao(khoa, { productId: null, sku: skuSan, ten, tonKho: null, chuaLienKet: true, externalItemId: it.externalItemId || null },
                    sl, o.id, { sku: skuSan, ten, loai: 'chua-lien-ket', soLuongSan: sl, soLuongKho: sl })
                tongSoLuong += sl
                tk.soLuong += sl
                continue
            }

            if (kq.some(x => x.loai === 'combo')) soDongCombo++
            else if (kq.some(x => x.loai === 'ma-con')) soDongMaCon++
            for (const x of kq) {
                themVao(`p:${x.sp.id}`, { productId: x.sp.id, sku: x.sp.sku, ten: x.sp.name, tonKho: Number(x.sp.stock), chuaLienKet: false, externalItemId: null },
                    x.soLuong, o.id, { sku: skuSan, ten, loai: x.loai, soLuongSan: sl, soLuongKho: x.soLuong })
                tongSoLuong += x.soLuong
                tk.soLuong += x.soLuong
            }
        }
    }
    const tron = (n: number) => Math.round(n * 1000) / 1000

    // Ảnh dùng CHUNG bộ dò với danh sách đơn và trang đóng gói — ba nơi nói khác
    // nhau về "hàng này ảnh nào" thì còn khó lần hơn là không có ảnh.
    const dsGom = [...gom.values()].sort((a, b) => b.soLuong - a.soLuong || a.ten.localeCompare(b.ten, 'vi'))
    const coAnh = await ganAnhDongHang(prisma, dsGom.map(d => ({
        sku: d.sku, productId: d.productId, externalItemId: d.externalItemId, product: null,
    })) as any[])

    return {
        ngay: ngayVN(moc),
        tu: tu.toISOString(), den: den.toISOString(),
        soDon: orders.length,
        soMaHang: dsGom.length,
        tongSoLuong: tron(tongSoLuong),
        items: dsGom.map((d, i) => ({
            productId: d.productId,
            sku: d.sku,
            ten: d.ten,
            soLuong: tron(d.soLuong),
            soDon: d.donSet.size,
            tonKho: d.tonKho,
            imageUrl: (coAnh[i] as any)?.imageUrl ?? null,
            chuaLienKet: d.chuaLienKet,
            // Dòng đơn gốc dồn vào mặt hàng này: bán thẳng / mã con (đã quy về mẹ) / combo (đã bung).
            tu: [...d.tu.values()]
                .sort((a, b) => b.soLuongKho - a.soLuongKho)
                .map(n => ({ sku: n.sku, ten: n.ten, loai: n.loai, soLuongSan: tron(n.soLuongSan), soLuongKho: tron(n.soLuongKho) })),
        })),
        theoKenh: [...theoKenh.values()].map(k => ({
            channelId: k.channelId, soDon: k.soDon.size, soLuong: tron(k.soLuong),
        })),
        quyDoi: { soDongMaCon, soDongCombo },
        chamTran,
        /* Cảnh báo phải kèm CON SỐ — câu cảnh báo không có số thì không ai biết
         * nặng nhẹ tới đâu, và cũng không kiểm lại được. */
        canhBao: [
            ...(chamTran ? [`Ngày này có hơn ${TRAN} đơn — danh sách mới tính ${TRAN} đơn đầu, tổng đang THIẾU.`] : []),
            ...(soDongChuaLienKet > 0 ? [`${soDongChuaLienKet} mã chưa tra ra hàng trong kho (vẫn được đếm theo đơn vị sàn, nhưng không quy đổi mẹ/combo được, không có tồn kho và có thể thiếu ảnh). Khai ở màn Ánh xạ SKU.`] : []),
            ...(donDaHuy.length > 0 ? [`${donDaHuy.length} đơn đã lấy hàng rồi mới huỷ/hoàn: ${donDaHuy.slice(0, 5).join(', ')}${donDaHuy.length > 5 ? '…' : ''}`] : []),
        ],
        ghiChu: 'Số lượng theo ĐƠN VỊ KHO: mã con đã quy về mã mẹ (× hệ số gộp), combo đã bung thành từng thành phần, ánh xạ SKU có hệ số đã nhân — đúng số kho đã trừ. Dòng chưa liên kết giữ đơn vị sàn. Xem `tu` của từng dòng để biết dòng đơn gốc.',
    }
}
