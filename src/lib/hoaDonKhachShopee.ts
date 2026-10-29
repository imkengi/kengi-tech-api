/* THÔNG TIN XUẤT HOÁ ĐƠN KHÁCH KHAI TRÊN SHOPEE — TỰ LẤY (15/10/2026).
 *
 * Chủ shop: "xem thử phần khách yêu cầu hoá đơn có webhook không, mỗi lần khách đi nhắn rồi sửa hoá đơn cực". Đọc tài liệu
 * Shopee 15/10: 29 loại push KHÔNG có loại nào cho yêu cầu hoá đơn; get_pending_buyer_invoice_order_list chỉ cho PH/BR ⇒ tự
 * động = hỏi get_buyer_invoice_info THEO LÔ (dùng được cho VN) ở những chỗ cần: ngay trước khi hàng đợi 20:30 xuất HĐ, và soát
 * lại HĐ đã xuất.
 *
 * ĐO 15/10 (KENGISTORE, 662 đơn Shopee/30 ngày, /admin/do-hoa-don-khach-shopee): 538 đơn có khai — 532 "cá nhân" mà Shopee CHE
 * tên + địa chỉ (A****b, mọi trạng thái đơn; chỉ email rõ), 6 "công ty"/"hộ kinh doanh" đọc RÕ mọi trường (MST, tên đơn vị,
 * địa chỉ, email). Ca khách hay nhắn đòi là HĐ công ty (cần MST) ⇒ chỉ tự ghi loại có MST rõ. HĐ cá nhân bị che thì KHÔNG ghi:
 * phiếu có vatBuyerInfo bị hàng đợi 20:30 LUÔN xuất (kể cả khi chế độ tự xuất tắt) ⇒ ghi bừa là đổi chính sách xuất của cửa hàng.
 */

import { shopeeServiceTokenMoi } from '../routes/flashSales'

export const BI_CHE = /\*{2,}/

/** Thông tin xuất HĐ ghi lên phiếu (Transaction.vatBuyerInfo) — cùng khuôn với nút "Lấy từ Shopee" (routes/einvoice). */
export interface ThongTinHoaDonPhieu {
    source: 'shopee'
    tuDong?: boolean
    fetchedAt: string
    type: string
    name: string
    taxCode: string
    address: string
    email: string
    phone: string
    nationalId: string
}

const sach = (v: any) => { const x = String(v ?? '').trim(); return x && !BI_CHE.test(x) ? x : '' }

/** Thông tin Shopee → thông tin DÙNG ĐƯỢC cho HĐ (null = không dùng được / không phải HĐ có MST). */
export function thongTinDungDuoc(info: any): ThongTinHoaDonPhieu | null {
    if (!info) return null
    const laCongTy = info.invoiceType === 'company'
    const laHo = info.invoiceType === 'household'
    if (!laCongTy && !laHo) return null
    const mst = sach(laCongTy ? info.companyTaxId : info.taxId).replace(/\s+/g, '')
    if (!mst) return null
    return {
        source: 'shopee', tuDong: true, fetchedAt: new Date().toISOString(),
        type: info.invoiceType,
        // cùng luật với nút tay: công ty ⇒ tên ĐƠN VỊ làm tên người mua; hộ KD ⇒ tên người (tên hộ do tra MST điền lúc xuất)
        name: laCongTy ? (sach(info.companyName) || sach(info.name)) : (sach(info.name) || sach(info.companyName)),
        taxCode: mst,
        address: laCongTy ? (sach(info.companyAddress) || sach(info.address)) : sach(info.address),
        email: laCongTy ? (sach(info.companyEmail) || sach(info.email)) : sach(info.email),
        phone: sach(info.phone),
        nationalId: sach(info.nationalId),
    }
}

export interface KetQuaLayHoaDon {
    daHoi: number
    /** đơn khách có khai thông tin HĐ (mọi loại) */
    coKhai: number
    /** cá nhân bị che — không dùng được */
    caNhanBiChe: number
    /** HĐ công ty/hộ KD có MST rõ */
    dungDuoc: number
    /** id phiếu đã ghi thông tin (phiếu đang trống) */
    daGhiPhieu: string[]
    /** mã đơn đã ghi (để báo) */
    daGhiDon: string[]
    loi: string[]
}

/**
 * Phiếu đơn Shopee VỪA LÊN (từ `tuLuc`) còn trống thông tin HĐ ⇒ hỏi Shopee ngay lúc đồng bộ đơn, không đợi hàng đợi 20:30
 * (chủ shop 29/10/2026: "khi lấy đơn thì lấy luôn thông tin cần xuất hoá đơn luôn nha"). Đo 15/10: HĐ công ty / hộ KD đọc rõ
 * mọi trường ở MỌI trạng thái đơn ⇒ lấy sớm là có ngay, nhân viên thấy "khách cần HĐ MST" từ lúc đơn mới về. Gọi từ cron
 * autoSync và POST /channels/:id/sync sau processNewOrders; null = không có phiếu nào cần hỏi.
 */
export async function layHoaDonKhachPhieuMoi(prisma: any, tuLuc: Date, opts: { dichVu?: (kenh: any) => Promise<any> } = {}): Promise<KetQuaLayHoaDon | null> {
    const phieu: { id: string; receiptNumber: string }[] = await prisma.transaction.findMany({
        where: { receiptNumber: { startsWith: 'ONLINE-SPE-' }, createdAt: { gte: tuLuc }, vatBuyerInfo: null },
        select: { id: true, receiptNumber: true }, take: 300,
    })
    if (!phieu.length) return null
    return layHoaDonKhachShopee(prisma, phieu, { ghi: true, dichVu: opts.dichVu })
}

/**
 * Hỏi Shopee thông tin xuất HĐ cho các PHIẾU đơn Shopee (receiptNumber `ONLINE-SPE-…`), ghi thông tin DÙNG ĐƯỢC lên phiếu đang
 * TRỐNG vatBuyerInfo (không đè thông tin nhân viên gõ tay / đã lấy trước). Lỗi Shopee không ném ra ngoài — gom ở `loi`.
 */
export async function layHoaDonKhachShopee(prisma: any, phieu: { id: string; receiptNumber: string }[],
    opts: { ghi?: boolean; dichVu?: (kenh: any) => Promise<any> } = {}): Promise<KetQuaLayHoaDon> {
    const kq: KetQuaLayHoaDon = { daHoi: 0, coKhai: 0, caNhanBiChe: 0, dungDuoc: 0, daGhiPhieu: [], daGhiDon: [], loi: [] }
    const maDonCuaPhieu = new Map<string, string>()   // orderNumber → txId
    for (const p of phieu) {
        const ma = String(p.receiptNumber || '').replace(/^ONLINE-/, '')
        if (/^SPE-/i.test(ma)) maDonCuaPhieu.set(ma, p.id)
    }
    if (!maDonCuaPhieu.size) return kq
    const dons: any[] = await prisma.onlineOrder.findMany({
        where: { orderNumber: { in: [...maDonCuaPhieu.keys()] } },
        select: { orderNumber: true, externalOrderId: true, channelId: true },
    })
    const theoKenh = new Map<string, any[]>()
    for (const d of dons) if (d.channelId) theoKenh.set(d.channelId, [...(theoKenh.get(d.channelId) || []), d])
    for (const [channelId, ds] of theoKenh) {
        const kenh = await prisma.onlineChannel.findUnique({ where: { id: channelId } })
        if (!kenh?.accessToken || String(kenh.platform).toLowerCase() !== 'shopee') continue
        let svc: any
        // dichVu: bộ kiểm chứng (scripts/check-hoa-don-khach-shopee.ts) truyền Shopee giả; đường thật dùng token còn hạn
        try { svc = opts.dichVu ? await opts.dichVu(kenh) : await shopeeServiceTokenMoi(prisma, kenh) } catch (e: any) { kq.loi.push(`${kenh.name}: ${String(e?.message || e).slice(0, 160)}`); continue }
        for (let i = 0; i < ds.length; i += 50) {
            const lo = ds.slice(i, i + 50)
            const sn = (d: any) => String(d.externalOrderId || d.orderNumber).replace(/^SPE-/i, '')
            let r: any
            try { r = await svc.getBuyerInvoiceInfoBatch(lo.map(sn)) } catch (e: any) {
                kq.loi.push(`${kenh.name}: ${String(e?.message || e).slice(0, 160)}`)
                continue
            }
            kq.daHoi += lo.length
            for (const d of lo) {
                const info = r.thongTin.get(sn(d))
                if (!info) continue
                kq.coKhai++
                const dd = thongTinDungDuoc(info)
                if (!dd) { if (info.invoiceType === 'personal') kq.caNhanBiChe++; continue }
                kq.dungDuoc++
                if (!opts.ghi) continue
                const txId = maDonCuaPhieu.get(d.orderNumber)!
                // Chỉ ghi khi phiếu còn TRỐNG — nhân viên đã gõ/lấy thì giữ của họ
                const n = await prisma.transaction.updateMany({ where: { id: txId, vatBuyerInfo: null } as any, data: { vatBuyerInfo: JSON.stringify(dd) } as any })
                if (n?.count) { kq.daGhiPhieu.push(txId); kq.daGhiDon.push(d.orderNumber) }
            }
        }
    }
    return kq
}
