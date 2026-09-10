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
//  ⚠ SỐ LƯỢNG LÀ ĐƠN VỊ SÀN — đúng thứ người đóng cầm trên tay. Listing bán "vỉ"
//  thì đây là số VỈ, dù kho trừ theo CÁI (hệ số ở SkuMapping). Đừng dùng con số này
//  đối chiếu thẻ kho: nó để ĐẾM HÀNG, không phải bút toán.
// ═══════════════════════════════════════════════════════════════════════════════

import { khoangNgayVN, ngayVN } from './vnTime'
import { ganAnhDongHang } from './anhDongHang'
import { khoaNhomDVVC } from './dvvc'
import { isReversalStatus } from '../services/onlineOrderReversal'

/** Trần đơn/ngày. Ngày đông nhất đo được ~400 đơn; đây là lưới cho bộ nhớ 512Mi. */
const TRAN = 2000

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
            items: {
                select: {
                    sku: true, productName: true, quantity: true, productId: true, externalItemId: true,
                    product: {
                        select: {
                            sku: true, name: true, stock: true,
                            images: { select: { url: true }, orderBy: { isPrimary: 'desc' }, take: 1 },
                        },
                    },
                },
            },
        },
        orderBy: { shippedAt: 'asc' },
        take: TRAN + 1,
    })
    const chamTran = orders.length > TRAN
    if (chamTran) orders.length = TRAN

    /* Gộp theo HÀNG KHO trước, rồi SKU sàn, cuối cùng mới tới tên. Gộp thẳng theo
     * tên là gom nhầm hai phân loại khác nhau của cùng một listing. */
    type Dong = {
        productId: string | null; sku: string | null; ten: string
        soLuong: number; donSet: Set<string>; tonKho: number | null
        chuaLienKet: boolean; externalItemId: string | null
    }
    const gom = new Map<string, Dong>()
    const theoKenh = new Map<string, { channelId: string | null; soDon: Set<string>; soLuong: number }>()
    const donDaHuy: string[] = []
    let tongSoLuong = 0
    let soDongChuaLienKet = 0

    for (const o of orders) {
        if (isReversalStatus(o.status)) donDaHuy.push(o.orderNumber)
        const kKenh = o.channelId || '(không kênh)'
        if (!theoKenh.has(kKenh)) theoKenh.set(kKenh, { channelId: o.channelId, soDon: new Set(), soLuong: 0 })
        const tk = theoKenh.get(kKenh)!
        tk.soDon.add(o.id)

        for (const it of (o.items || [])) {
            const sl = Number(it.quantity) || 0
            const skuSan = String(it.sku || '').trim()
            const skuKho = String(it.product?.sku || '').trim()
            const ten = it.productName || it.product?.name || 'Không tên'
            const khoa = it.productId ? `p:${it.productId}`
                : skuSan ? `s:${skuSan.toLowerCase()}`
                    : `n:${ten.toLowerCase()}`

            if (!gom.has(khoa)) {
                gom.set(khoa, {
                    productId: it.productId || null,
                    sku: skuSan || skuKho || null,
                    ten,
                    soLuong: 0,
                    donSet: new Set(),
                    tonKho: it.product ? Number(it.product.stock) : null,
                    chuaLienKet: !it.productId,
                    externalItemId: it.externalItemId || null,
                })
                if (!it.productId) soDongChuaLienKet++
            }
            const d = gom.get(khoa)!
            d.soLuong += sl
            d.donSet.add(o.id)
            tongSoLuong += sl
            tk.soLuong += sl
        }
    }

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
        tongSoLuong,
        items: dsGom.map((d, i) => ({
            productId: d.productId,
            sku: d.sku,
            ten: d.ten,
            soLuong: d.soLuong,
            soDon: d.donSet.size,
            tonKho: d.tonKho,
            imageUrl: (coAnh[i] as any)?.imageUrl ?? null,
            chuaLienKet: d.chuaLienKet,
        })),
        theoKenh: [...theoKenh.values()].map(k => ({
            channelId: k.channelId, soDon: k.soDon.size, soLuong: k.soLuong,
        })),
        chamTran,
        /* Cảnh báo phải kèm CON SỐ — câu cảnh báo không có số thì không ai biết
         * nặng nhẹ tới đâu, và cũng không kiểm lại được. */
        canhBao: [
            ...(chamTran ? [`Ngày này có hơn ${TRAN} đơn — danh sách mới tính ${TRAN} đơn đầu, tổng đang THIẾU.`] : []),
            ...(soDongChuaLienKet > 0 ? [`${soDongChuaLienKet} mã chưa tra ra hàng trong kho (vẫn được đếm, nhưng không có tồn kho và có thể thiếu ảnh). Khai ở màn Ánh xạ SKU.`] : []),
            ...(donDaHuy.length > 0 ? [`${donDaHuy.length} đơn đã lấy hàng rồi mới huỷ/hoàn: ${donDaHuy.slice(0, 5).join(', ')}${donDaHuy.length > 5 ? '…' : ''}`] : []),
        ],
        ghiChu: 'Số lượng theo ĐƠN VỊ SÀN (thứ người đóng cầm trên tay), không phải đơn vị kho.',
    }
}
