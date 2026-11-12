/**
 * KÉO BÙ ĐƠN SÀN CŨ thành phiếu doanh thu — KHÔNG trừ kho (11–12/11/2026, xem lib/dauKeoBu.ts cho lý do và luật).
 *
 * A. keoBuDonSan — đơn sàn đã hoàn thành mà Kengi CHƯA CÓ (không phiếu, không đơn gốc). Mỗi lượt một gian, một khoảng ngày ĐẶT:
 *   1. hỏi sàn danh sách đơn → chỉ giữ đơn sàn báo COMPLETED
 *   2. bỏ đơn Kengi ĐÃ CÓ (phiếu ONLINE-<mã> ở bất kỳ trạng thái, hoặc đơn gốc) — không đụng tới chúng
 *   3. lấy chi tiết đơn còn thiếu
 *   4. CHẠY THỬ (mặc định): chỉ đếm + cộng tiền + soát sơ SKU. GHI THẬT: tạo đơn gốc mang dấu kéo bù + stockDeducted = true
 *      (đơn về sau có bị đảo thì hàng về kho được cộng lại — đúng với thực tế) rồi lập phiếu NGAY bằng hàm lập phiếu chung.
 * B. xuLyDonKet — đơn ĐÃ CÓ trong Kengi, sàn đã hoàn thành, mà chưa lên phiếu vì dòng hàng không nối được hàng kho. Đo KENGISTORE
 *    12/11/2026: 732 đơn Shopee tháng 4–7 lưu dòng hàng KHÔNG SKU, không tên phân loại (đồng bộ bằng bản cũ, trước khi đọc model_sku)
 *    ⇒ hỏi lại sàn chi tiết đơn, thay dòng hàng bằng bản có mã phân loại rồi lập phiếu. Kèm: ánh xạ SKU mới khai cho MỘT sàn
 *    (CT24PLUS có ở TikTok, thiếu ở Shopee) ⇒ chép sang sàn còn thiếu khi mọi ánh xạ của mã đó cùng trỏ MỘT hàng kho.
 *    Đơn đặt trước mốc `truoc` được gắn dấu kéo bù (không trừ kho) như nhóm A.
 * Chạy lại an toàn. Hết giờ ⇒ dừng, trả `conLai` để gọi tiếp. Đơn vẫn không nối được hàng thì KHÔNG lên phiếu — đếm riêng, không giấu.
 */
import { convertOnlineOrderToTransaction } from '../services/orderSync'
import { GHI_CHU_KEO_BU, laDonKeoBu } from './dauKeoBu'
import { moTaLoi } from './gomLoi'

/** Nguồn đơn của một sàn cho việc kéo bù */
export interface NguonDonSan {
    /** tiền tố mã đơn trong Kengi: 'SPE-' | 'TIK-' */
    tienTo: string
    lietKe(tu: Date, den: Date, hanMs: number): Promise<{ don: { sn: string; status: string }[]; chamTran: boolean }>
    /** chi tiết (đã ánh xạ thành PlatformOrder) của ≤ 50 đơn */
    chiTiet(sns: string[]): Promise<any[]>
}

export function nguonShopee(svc: any): NguonDonSan {
    return { tienTo: 'SPE-', lietKe: (tu, den, hanMs) => svc.lietKeMaDonTheoNgayDat(tu, den, hanMs), chiTiet: sns => svc.layChiTietNhieuDon(sns) }
}

/** TikTok: orders/search trả luôn đơn đầy đủ ⇒ liệt kê một lượt (lọc COMPLETED), giữ lại để bước chi tiết khỏi gọi sàn lần nữa */
export function nguonTikTok(svc: any): NguonDonSan {
    const kho = new Map<string, any>()
    return {
        tienTo: 'TIK-',
        async lietKe(tu, den, hanMs) {
            const batDau = Date.now()
            let pageToken: string | undefined
            for (let trang = 1; ; trang++) {
                if (trang > 300 || Date.now() - batDau > hanMs) return { don: [...kho.values()].map(o => ({ sn: String(o.externalOrderId), status: String(o.externalStatus) })), chamTran: true }
                const r = await svc.fetchOrders({ since: tu, until: den, status: 'COMPLETED', pageSize: 100, pageToken })
                for (const o of r.orders || []) kho.set(String(o.externalOrderId), o)
                if (!r.hasMore || !r.nextPageToken) break
                pageToken = r.nextPageToken
            }
            return { don: [...kho.values()].map(o => ({ sn: String(o.externalOrderId), status: String(o.externalStatus) })), chamTran: false }
        },
        async chiTiet(sns) { return sns.map(s => kho.get(s)).filter(Boolean) },
    }
}

export interface KetQuaKeoBu {
    apply: boolean
    trenSanHoanThanh: number
    daCoTrongKengi: number
    thieu: number
    /** đã xét trong lượt này (chạy thử: đã đọc chi tiết; ghi thật: đã nhập) */
    daXet: number
    tongTien: number
    theoThang: Record<string, { don: number; tien: number }>
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

const thangVN = (iso: any) => new Date(new Date(iso).getTime() + 7 * 3600_000).toISOString().slice(0, 7)
const chuan = (s: any) => String(s || '').trim().toLowerCase()

/** SKU kho + SKU đã khai ánh xạ (chữ thường) — để ước lượng lúc chạy thử. Chỉ đọc. */
async function napSkuKho(sp: any): Promise<Set<string>> {
    const skuKho = new Set<string>()
    for (const p of await sp.product.findMany({ select: { sku: true } })) if (p.sku) skuKho.add(chuan(p.sku))
    try { for (const m of await sp.skuMapping.findMany({ select: { platformSku: true } })) if (m.platformSku) skuKho.add(chuan(m.platformSku)) } catch { /* bảng ánh xạ không đọc được ⇒ ước lượng dè hơn, không sao */ }
    return skuKho
}

const duLieuDon = (order: any, ch: any) => ({
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
})
const dongHang = (it: any) => ({ productName: it.productName, sku: it.sku || null, quantity: it.quantity, unitPrice: it.unitPrice, discount: it.discount, lineTotal: it.lineTotal })

export async function keoBuDonSan(sp: any, ch: any, nguon: NguonDonSan, o: { tu: Date; den: Date; apply: boolean; hanMs: number; gioiHan: number }): Promise<KetQuaKeoBu> {
    const batDau = Date.now()
    const kq: KetQuaKeoBu = {
        apply: o.apply, trenSanHoanThanh: 0, daCoTrongKengi: 0, thieu: 0, daXet: 0, tongTien: 0, theoThang: {}, daNhap: 0, lenPhieu: 0,
        khongNoiDuocHang: 0, uocKhongKhopSku: 0, skuLa: [], boQuaKhongConHoanThanh: 0, loi: [], conLai: 0, chamTran: false, mau: [],
    }
    const ds = await nguon.lietKe(o.tu, o.den, Math.min(120_000, o.hanMs / 2))
    if (ds.chamTran) { kq.chamTran = true; kq.loi.push('Liệt kê đơn trên sàn chưa hết (chạm hạn) — thu hẹp khoảng ngày'); return kq }
    const ht = ds.don.filter(d => d.status === 'COMPLETED').map(d => d.sn)
    kq.trenSanHoanThanh = ht.length

    const P = 'ONLINE-' + nguon.tienTo
    const daCo = new Set<string>()
    for (let i = 0; i < ht.length; i += 1000) {
        const lo = ht.slice(i, i + 1000)
        for (const t of await sp.transaction.findMany({ where: { receiptNumber: { in: lo.map(s => P + s) } }, select: { receiptNumber: true } })) daCo.add(String(t.receiptNumber).slice(P.length))
        for (const d of await sp.onlineOrder.findMany({ where: { orderNumber: { in: lo.map(s => nguon.tienTo + s) } }, select: { orderNumber: true } })) daCo.add(String(d.orderNumber).slice(nguon.tienTo.length))
    }
    kq.daCoTrongKengi = daCo.size
    const thieu = ht.filter(s => !daCo.has(s))
    kq.thieu = thieu.length

    const skuKho = o.apply ? null : await napSkuKho(sp)
    const skuLa = new Map<string, number>()

    let i = 0
    for (; i < thieu.length && kq.daXet < o.gioiHan; i += 50) {
        if (Date.now() - batDau > o.hanMs) break
        const lo = thieu.slice(i, i + 50)
        let chiTiet: any[]
        try { chiTiet = await nguon.chiTiet(lo) } catch (e: any) { kq.loi.push(`Chi tiết lô ${i}: ${moTaLoi(e)}`.slice(0, 250)); break }
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
                    const s = chuan(it.sku)
                    if (!s || !skuKho!.has(s)) { la = true; const k = String(it.sku || '(không SKU)').trim().slice(0, 40); skuLa.set(k, (skuLa.get(k) || 0) + 1) }
                }
                if (la) kq.uocKhongKhopSku++
                continue
            }
            try {
                const tao = await sp.onlineOrder.create({
                    // DẤU KÉO BÙ + cờ đã-trừ-kho: không đường nào trừ kho đơn này nữa (xem lib/dauKeoBu.ts)
                    data: { ...duLieuDon(order, ch), note: GHI_CHU_KEO_BU, stockDeducted: true, items: { create: (order.items || []).map(dongHang) } },
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

/** Tên cũ (bộ kiểm + lượt chạy 11/11 dùng) */
export const keoBuDonShopee = (sp: any, ch: any, svc: any, o: { tu: Date; den: Date; apply: boolean; hanMs: number; gioiHan: number }) => keoBuDonSan(sp, ch, nguonShopee(svc), o)

// ─── B. Đơn đã có mà chưa lên phiếu ───────────────────────────────────────────

export interface KetQuaDonKet {
    apply: boolean
    /** đơn sàn đã hoàn thành, đặt trước mốc, chưa có phiếu */
    donKet: number
    tienKet: number
    daXet: number
    /** Shopee: dòng hàng được thay bằng bản có mã phân loại hỏi lại từ sàn */
    lamMoiDong: number
    /** ánh xạ SKU chép sang sàn còn thiếu (mọi ánh xạ của mã cùng trỏ một hàng kho) */
    anhXaChep: string[]
    lenPhieu: number
    tienLenPhieu: number
    vanKet: number
    /** chạy thử: ước số đơn sẽ lên phiếu (mọi dòng có mã nối được) */
    uocLenPhieu: number
    skuVanKet: string[]
    boQuaKhongConHoanThanh: number
    loi: string[]
    conLai: number
}

/**
 * Chép ánh xạ SKU sang sàn còn thiếu. Điều kiện chặt: mã không trùng SKU kho, sàn này chưa có ánh xạ (kể cả ánh xạ chung platform null),
 * và MỌI ánh xạ của mã đó ở sàn khác cùng trỏ MỘT hàng kho, không phải combo, cùng hệ số quy đổi. Trả các dòng (sẽ) chép.
 */
export async function chepAnhXaCheoSan(sp: any, platform: string, dsSku: string[], apply: boolean): Promise<string[]> {
    const ra: string[] = []
    const xet = [...new Set(dsSku.map(s => String(s || '').trim()).filter(Boolean))]
    for (const sku of xet) {
        const tatCa: any[] = await sp.skuMapping.findMany({ where: { platformSku: { equals: sku, mode: 'insensitive' } } })
        if (!tatCa.length) continue
        if (tatCa.some(m => m.platform === null || m.platform === platform)) continue
        if (new Set(tatCa.map(m => `${m.productId}|${m.bundleId || ''}|${Number(m.conversionRate) || 1}`)).size !== 1 || tatCa[0].bundleId) continue
        const sp1 = await sp.product.findUnique({ where: { id: tatCa[0].productId }, select: { sku: true } })
        if (!sp1) continue
        ra.push(`${sku} (${platform}) → ${sp1.sku}`)
        if (apply) await sp.skuMapping.create({ data: { platformSku: sku, platform, productId: tatCa[0].productId, conversionRate: Number(tatCa[0].conversionRate) || 1, note: 'Tự chép từ ánh xạ của sàn khác (cùng mã, cùng một hàng kho) — 12/11/2026' } })
    }
    return ra
}

export async function xuLyDonKet(sp: any, ch: any, nguon: NguonDonSan | null, o: { truoc: Date; apply: boolean; hanMs: number; gioiHan: number }): Promise<KetQuaDonKet> {
    const batDau = Date.now()
    const kq: KetQuaDonKet = { apply: o.apply, donKet: 0, tienKet: 0, daXet: 0, lamMoiDong: 0, anhXaChep: [], lenPhieu: 0, tienLenPhieu: 0, vanKet: 0, uocLenPhieu: 0, skuVanKet: [], boQuaKhongConHoanThanh: 0, loi: [], conLai: 0 }
    // đơn sàn ĐÃ HOÀN THÀNH của gian này, đặt trước mốc, chưa có phiếu (cùng phép nối với processNewOrders)
    const ds: { id: string; externalOrderId: string; total: number }[] = await sp.$queryRawUnsafe(
        `SELECT o.id, o."externalOrderId", o.total FROM "OnlineOrder" o
           LEFT JOIN "Transaction" t ON t."receiptNumber" = 'ONLINE-' || o."orderNumber"
          WHERE o."channelId" = $1 AND t.id IS NULL AND o."externalStatus" = 'COMPLETED' AND o."createdAt" < $2
          ORDER BY o."createdAt" ASC`, ch.id, o.truoc)
    kq.donKet = ds.length
    kq.tienKet = Math.round(ds.reduce((s, d) => s + (Number(d.total) || 0), 0))
    let skuKho = o.apply ? null : await napSkuKho(sp)
    const vanKet = new Map<string, number>()

    let i = 0
    for (; i < ds.length && kq.daXet < o.gioiHan; i += 50) {
        if (Date.now() - batDau > o.hanMs) break
        const lo = ds.slice(i, i + 50)
        // Shopee: hỏi lại sàn (dòng hàng bản cũ không có mã phân loại). Sàn khác: dùng dòng hàng đang lưu.
        let moi = new Map<string, any>()
        if (nguon) {
            try { for (const d of await nguon.chiTiet(lo.map(x => String(x.externalOrderId)))) moi.set(String(d.externalOrderId), d) }
            catch (e: any) { kq.loi.push(`Chi tiết lô ${i}: ${moTaLoi(e)}`.slice(0, 250)); break }
        }
        // ánh xạ thiếu ở sàn này cho các mã trong lô
        const skuLo = new Set<string>()
        const dongCuaDon = new Map<string, any[]>()
        for (const x of lo) {
            const d = moi.get(String(x.externalOrderId))
            const dong: any[] = d ? (d.items || []) : await sp.onlineOrderItem.findMany({ where: { onlineOrderId: x.id }, select: { sku: true, productId: true } })
            dongCuaDon.set(x.id, dong)
            for (const it of dong) if (String(it.sku || '').trim()) skuLo.add(String(it.sku).trim())
        }
        try {
            const chep = await chepAnhXaCheoSan(sp, String(ch.platform), [...skuLo], o.apply)
            for (const c of chep) if (!kq.anhXaChep.includes(c)) kq.anhXaChep.push(c)
            if (!o.apply && chep.length) for (const c of chep) skuKho!.add(chuan(c.split(' (')[0]))
        } catch (e: any) { kq.loi.push(`Chép ánh xạ: ${moTaLoi(e)}`.slice(0, 250)) }

        for (const x of lo) {
            const d = nguon ? moi.get(String(x.externalOrderId)) : null
            if (nguon && (!d || d.externalStatus !== 'COMPLETED')) { kq.boQuaKhongConHoanThanh++; continue }
            kq.daXet++
            const dong = dongCuaDon.get(x.id) || []
            if (!o.apply) {
                const ket = dong.filter(it => !it.productId && !(chuan(it.sku) && skuKho!.has(chuan(it.sku))))
                // hàm lập phiếu chỉ cần MỘT dòng nối được là lên phiếu (dòng không nối bị ghi chú) — ước theo đúng luật đó
                if (dong.length && ket.length < dong.length) kq.uocLenPhieu++
                for (const it of ket) { const k = String(it.sku || '(không SKU)').trim().slice(0, 40); vanKet.set(k, (vanKet.get(k) || 0) + 1) }
                continue
            }
            try {
                const cu = await sp.onlineOrder.findUnique({ where: { id: x.id }, select: { note: true } })
                if (d) {
                    // thay dòng hàng bằng bản có mã phân loại + tên phân loại; tiền đơn theo bản mới của sàn
                    await sp.$transaction(async (tx: any) => {
                        await tx.onlineOrderItem.deleteMany({ where: { onlineOrderId: x.id } })
                        await tx.onlineOrder.update({ where: { id: x.id }, data: { subtotal: d.subtotal, total: d.total, items: { create: (d.items || []).map(dongHang) } } })
                    })
                    kq.lamMoiDong++
                }
                // đơn cũ ⇒ dấu kéo bù: lập phiếu không trừ kho; mở lại cờ kẹt để hàm lập phiếu thử ngay
                await sp.onlineOrder.update({
                    where: { id: x.id },
                    data: { ...(laDonKeoBu(cu?.note) ? {} : { note: cu?.note ? `${cu.note} — ${GHI_CHU_KEO_BU}` : GHI_CHU_KEO_BU }), stockDeducted: true, khongKhopSku: false, khongKhopLuc: null },
                })
                if (await convertOnlineOrderToTransaction(sp, x.id)) { kq.lenPhieu++; kq.tienLenPhieu += Math.round(Number(d ? d.total : x.total) || 0) }
                else {
                    kq.vanKet++
                    for (const it of (d ? d.items : dong) || []) { const k = String(it.sku || '(không SKU)').trim().slice(0, 40); vanKet.set(k, (vanKet.get(k) || 0) + 1) }
                }
            } catch (e: any) {
                kq.loi.push(`${x.externalOrderId}: ${moTaLoi(e)}`.slice(0, 250))
                if (kq.loi.length >= 20) { kq.conLai = ds.length - i; return kq }
            }
        }
    }
    // ghi thật: đơn lên phiếu rời khỏi danh sách ⇒ lượt sau tự chỉ còn đơn chưa xử lý
    kq.conLai = o.apply ? Math.max(0, ds.length - kq.lenPhieu - kq.vanKet - kq.boQuaKhongConHoanThanh - kq.loi.length) : Math.max(0, ds.length - Math.min(i, ds.length))
    kq.skuVanKet = [...vanKet.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, n]) => `${k} ×${n}`)
    return kq
}
