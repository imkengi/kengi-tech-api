/**
 * KÉO BÙ ĐƠN SHOPEE CŨ thành phiếu doanh thu — KHÔNG trừ kho (11/11/2026, xem lib/dauKeoBu.ts cho lý do và luật).
 *
 * Mỗi lượt (một gian, một khoảng ngày ĐẶT):
 *   1. hỏi sàn danh sách mã đơn (nhẹ) → chỉ giữ đơn sàn báo COMPLETED
 *   2. bỏ đơn Kengi ĐÃ CÓ (phiếu ONLINE-SPE-<mã> ở bất kỳ trạng thái, hoặc đơn gốc SPE-<mã>) — không đụng tới chúng
 *   3. lấy chi tiết đơn còn thiếu theo lô 50
 *   4. CHẠY THỬ (mặc định): chỉ đếm + cộng tiền + soát sơ SKU. GHI THẬT (apply): tạo đơn gốc mang dấu kéo bù + stockDeducted = true
 *      (đơn về sau có bị đảo thì hàng về kho được cộng lại — đúng với thực tế) rồi lập phiếu NGAY bằng hàm lập phiếu chung.
 * Chạy lại an toàn: đơn đã nhập thì bước 2 loại. Hết giờ ⇒ dừng, trả `conLai` để gọi tiếp.
 * Đơn không dòng nào nối được hàng kho thì KHÔNG lên phiếu (luật sẵn có của hàm lập phiếu) — đếm riêng, không giấu.
 */
import { convertOnlineOrderToTransaction } from '../services/orderSync'
import { GHI_CHU_KEO_BU } from './dauKeoBu'
import { moTaLoi } from './gomLoi'

export interface KetQuaKeoBu {
    apply: boolean
    trenSanHoanThanh: number
    daCoTrongKengi: number
    thieu: number
    /** đã xét trong lượt này (chạy thử: đã đọc chi tiết; ghi thật: đã nhập) */
    daXet: number
    tongTien: number
    theoThang: Record<string, { don: number; tien: number }>
    /** ghi thật */
    daNhap: number
    lenPhieu: number
    khongNoiDuocHang: number
    /** chạy thử: đơn có ÍT NHẤT một dòng mà SKU không thấy trong kho / bảng ánh xạ (ước lượng, phép nối thật chặt hơn) */
    uocKhongKhopSku: number
    skuLa: string[]
    boQuaKhongConHoanThanh: number
    loi: string[]
    conLai: number
    chamTran: boolean
    mau: { ma: string; ngay: string; tien: number; soDong: number }[]
}

const thangVN = (iso: string) => new Date(new Date(iso).getTime() + 7 * 3600_000).toISOString().slice(0, 7)

export async function keoBuDonShopee(sp: any, ch: any, svc: any, o: { tu: Date; den: Date; apply: boolean; hanMs: number; gioiHan: number }): Promise<KetQuaKeoBu> {
    const batDau = Date.now()
    const kq: KetQuaKeoBu = {
        apply: o.apply, trenSanHoanThanh: 0, daCoTrongKengi: 0, thieu: 0, daXet: 0, tongTien: 0, theoThang: {}, daNhap: 0, lenPhieu: 0,
        khongNoiDuocHang: 0, uocKhongKhopSku: 0, skuLa: [], boQuaKhongConHoanThanh: 0, loi: [], conLai: 0, chamTran: false, mau: [],
    }
    const ds: { don: { sn: string; status: string }[]; chamTran: boolean } = await svc.lietKeMaDonTheoNgayDat(o.tu, o.den, Math.min(120_000, o.hanMs / 2))
    if (ds.chamTran) { kq.chamTran = true; kq.loi.push('Liệt kê đơn trên sàn chưa hết (chạm hạn) — thu hẹp khoảng ngày'); return kq }
    const ht = ds.don.filter(d => d.status === 'COMPLETED').map(d => d.sn)
    kq.trenSanHoanThanh = ht.length

    const daCo = new Set<string>()
    for (let i = 0; i < ht.length; i += 1000) {
        const lo = ht.slice(i, i + 1000)
        for (const t of await sp.transaction.findMany({ where: { receiptNumber: { in: lo.map(s => 'ONLINE-SPE-' + s) } }, select: { receiptNumber: true } })) daCo.add(String(t.receiptNumber).slice(11))
        for (const d of await sp.onlineOrder.findMany({ where: { orderNumber: { in: lo.map(s => 'SPE-' + s) } }, select: { orderNumber: true } })) daCo.add(String(d.orderNumber).slice(4))
    }
    kq.daCoTrongKengi = daCo.size
    const thieu = ht.filter(s => !daCo.has(s))
    kq.thieu = thieu.length

    // chạy thử: nạp sẵn SKU kho + ánh xạ để soát sơ (chỉ đọc)
    let skuKho: Set<string> | null = null
    if (!o.apply) {
        skuKho = new Set<string>()
        for (const p of await sp.product.findMany({ select: { sku: true } })) if (p.sku) skuKho.add(String(p.sku).trim().toLowerCase())
        try { for (const m of await sp.skuMapping.findMany({ select: { platformSku: true } })) if (m.platformSku) skuKho.add(String(m.platformSku).trim().toLowerCase()) } catch { /* bảng ánh xạ không đọc được ⇒ ước lượng dè hơn, không sao */ }
    }
    const skuLa = new Map<string, number>()

    let i = 0
    for (; i < thieu.length && kq.daXet < o.gioiHan; i += 50) {
        if (Date.now() - batDau > o.hanMs) break
        const lo = thieu.slice(i, i + 50)
        let chiTiet: any[]
        try { chiTiet = await svc.layChiTietNhieuDon(lo) } catch (e: any) { kq.loi.push(`Chi tiết lô ${i}: ${moTaLoi(e)}`.slice(0, 250)); break }
        for (const order of chiTiet) {
            if (order.externalStatus !== 'COMPLETED') { kq.boQuaKhongConHoanThanh++; continue }
            kq.daXet++
            const tien = Math.round(Number(order.total) || 0)
            const th = thangVN(order.createdAt)
            const dong = (kq.theoThang[th] = kq.theoThang[th] || { don: 0, tien: 0 })
            dong.don++; dong.tien += tien; kq.tongTien += tien
            if (kq.mau.length < 5) kq.mau.push({ ma: order.externalOrderId, ngay: String(order.createdAt).slice(0, 10), tien, soDong: (order.items || []).length })
            if (!o.apply) {
                let la = false
                for (const it of order.items || []) {
                    const s = String(it.sku || '').trim().toLowerCase()
                    if (!s || !skuKho!.has(s)) { la = true; const k = String(it.sku || '(không SKU)').trim().slice(0, 40); skuLa.set(k, (skuLa.get(k) || 0) + 1) }
                }
                if (la) kq.uocKhongKhopSku++
                continue
            }
            try {
                const tao = await sp.onlineOrder.create({
                    data: {
                        orderNumber: order.orderNumber, channelId: ch.id, channelName: ch.name, platform: order.platform,
                        externalOrderId: order.externalOrderId, externalStatus: order.externalStatus,
                        customerName: order.customerName, customerPhone: order.customerPhone || null, customerEmail: order.customerEmail || null,
                        shippingAddress: order.shippingAddress || null, status: order.status,
                        subtotal: order.subtotal, discount: order.discount, shippingFee: order.shippingFee, total: order.total,
                        paymentMethod: order.paymentMethod || null, paymentStatus: order.paymentStatus,
                        trackingNumber: order.trackingNumber || null, shippingCarrier: order.shippingCarrier || null,
                        paidAt: order.paidAt ? new Date(order.paidAt) : null, shippedAt: order.shippedAt ? new Date(order.shippedAt) : null,
                        deliveredAt: order.deliveredAt ? new Date(order.deliveredAt) : null,
                        isInstant: order.isInstant || false, syncedAt: new Date(), createdAt: new Date(order.createdAt),
                        // phí sàn không tự tính — 0 = chưa đối soát; lấy số thật sau bằng /admin/lay-lai-phi-don-da-xoa hoặc sync-fees
                        platformFeeRate: 0, platformFee: 0, netRevenue: 0,
                        // DẤU KÉO BÙ + cờ đã-trừ-kho: không đường nào trừ kho đơn này nữa (xem lib/dauKeoBu.ts)
                        note: GHI_CHU_KEO_BU, stockDeducted: true,
                        items: { create: (order.items || []).map((it: any) => ({ productName: it.productName, sku: it.sku || null, quantity: it.quantity, unitPrice: it.unitPrice, discount: it.discount, lineTotal: it.lineTotal })) },
                    },
                    select: { id: true },
                })
                kq.daNhap++
                if (await convertOnlineOrderToTransaction(sp, tao.id)) kq.lenPhieu++
                else kq.khongNoiDuocHang++
            } catch (e: any) {
                kq.loi.push(`${order.externalOrderId}: ${moTaLoi(e)}`.slice(0, 250))
                if (kq.loi.length >= 20) { kq.conLai = thieu.length - i; return kq }
            }
        }
    }
    kq.conLai = Math.max(0, thieu.length - Math.min(i, thieu.length))
    kq.skuLa = [...skuLa.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, n]) => `${k} ×${n}`)
    return kq
}
