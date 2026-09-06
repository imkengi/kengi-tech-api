/**
 * CẢNH BÁO ĐƠN LỢI NHUẬN THẤP — push Android cho admin sau khi đối soát phí (06/09/2026)
 *
 * Chủ shop: "lúc đó đơn nào dưới 5% lợi nhuận push thông báo qua android app
 * của admin để kiểm tra". "Lúc đó" = lúc phí THẬT vừa được ghi từ escrow/
 * settlement — trước đó lợi nhuận là null (đã bỏ ước tính), không có gì để so.
 *
 * Gọi từ ĐỦ BỐN chỗ ghi phí thật: cron runFeeSync, POST /channels/:id/sync-fees,
 * admin sync-fees, admin lay-phi-tiktok. Thiếu một chỗ là đơn đi qua chỗ đó không
 * bao giờ được cảnh báo, mà không ai biết.
 *
 * Ba luật:
 *  1. MỘT push cho cả mẻ, không phải mỗi đơn một push. Cron đối soát 400 đơn/lượt
 *     mà biên lợi nhuận Shopee trung bình 8% thì mỗi lượt có thể vài chục đơn
 *     dưới 5% — vài chục push liên tiếp là thứ người ta tắt thông báo luôn.
 *     Mỗi đơn vẫn có MỘT dòng Notification trong app để lướt danh sách.
 *  2. CHỈ CẢNH BÁO MỘT LẦN mỗi đơn — cột `loiNhuanThapBaoLuc` trên OnlineOrder.
 *     Đối soát lại (cron quét lại, bấm nút) không được báo lại.
 *  3. Thiếu giá vốn thì KHÔNG cảnh báo — không biết lãi bao nhiêu thì không được
 *     nói "lãi thấp". Đó là chuyện khác (hàng chưa khai giá vốn), báo riêng.
 *
 * Mẫu số của % = doanh thu (subtotal), cùng quy ước với thẻ % trên trang đơn.
 */
import { computeOrderProfits } from './onlineOrderProfit'

export const NGUONG_LOI_NHUAN_THAP = Number(process.env.NGUONG_LOI_NHUAN_THAP || 5)

export interface KetQuaCanhBao {
    xet: number          // đơn đưa vào xét (đã đối soát, chưa cảnh báo)
    thap: number         // đơn dưới ngưỡng
    thieuGiaVon: number  // bỏ qua vì không biết giá vốn
    push: number         // số thiết bị nhận push (0 = không thiết bị / không push)
}

const fmt = (n: number) => `${Math.round(n).toLocaleString('vi-VN')}đ`

export async function canhBaoLoiNhuanThap(prisma: any, orderIds: string[]): Promise<KetQuaCanhBao> {
    const ra: KetQuaCanhBao = { xet: 0, thap: 0, thieuGiaVon: 0, push: 0 }
    const ids = [...new Set((orderIds || []).filter(Boolean))]
    if (!ids.length) return ra

    const orders: any[] = await prisma.onlineOrder.findMany({
        where: { id: { in: ids }, netRevenue: { gt: 0 }, loiNhuanThapBaoLuc: null },
        select: {
            id: true, orderNumber: true, platform: true, status: true,
            subtotal: true, total: true, shippingFee: true, platformFee: true, netRevenue: true,
            items: { select: { productId: true, sku: true, quantity: true } },
        },
    })
    ra.xet = orders.length
    if (!orders.length) return ra

    const loi = await computeOrderProfits(prisma, orders)
    const thap: { id: string; ma: string; san: string; pt: number; ln: number; dt: number }[] = []
    for (const o of orders) {
        const p = loi.get(o.id)
        if (!p || p.profit == null) continue            // huỷ/hoàn hoặc chưa đối soát
        if (p.missingCost) { ra.thieuGiaVon++; continue } // không biết thì không nói
        const dt = Number(o.subtotal) || 0
        if (dt <= 0) continue
        const pt = p.profit / dt * 100
        if (pt < NGUONG_LOI_NHUAN_THAP) thap.push({ id: o.id, ma: o.orderNumber, san: String(o.platform || ''), pt, ln: p.profit, dt })
    }
    ra.thap = thap.length
    if (!thap.length) return ra

    thap.sort((a, b) => a.pt - b.pt)   // tệ nhất lên đầu
    const bayGio = new Date()

    /* Mỗi đơn một dòng trong app + đánh dấu đã báo — làm TRƯỚC khi push, để nếu
     * push hỏng thì lượt sau cũng không báo lại (thà thiếu một push còn hơn spam). */
    for (const t of thap) {
        await prisma.notification.create({
            data: {
                title: `Lợi nhuận thấp: ${t.ma}`,
                message: `${t.san.toUpperCase()} · lãi ${t.pt.toFixed(1)}% (${fmt(t.ln)} / ${fmt(t.dt)}) — dưới ngưỡng ${NGUONG_LOI_NHUAN_THAP}%, kiểm giá vốn / giá bán / phí.`,
                type: 'loi_nhuan_thap',
            },
        }).catch(() => { })
        await prisma.onlineOrder.updateMany({ where: { id: t.id }, data: { loiNhuanThapBaoLuc: bayGio } }).catch(() => { })
    }

    /* Một push cho cả mẻ. Data-only, app tự vẽ. */
    const dau = thap.slice(0, 3).map(t => `${t.ma} ${t.pt.toFixed(1)}%`).join(' · ')
    const conLai = thap.length > 3 ? ` (+${thap.length - 3} đơn nữa)` : ''
    const tieuDe = thap.length === 1
        ? `⚠ Đơn ${thap[0]!.ma} lãi ${thap[0]!.pt.toFixed(1)}%`
        : `⚠ ${thap.length} đơn lãi dưới ${NGUONG_LOI_NHUAN_THAP}%`
    const noiDung = `${dau}${conLai}. Vừa đối soát phí thật. Vào Đơn hàng online kiểm giá vốn / giá bán.`
    try {
        const { sendPushToStore } = await import('../routes/notifications')
        ra.push = await sendPushToStore(prisma, tieuDe, noiDung)
    } catch { ra.push = 0 }
    return ra
}
