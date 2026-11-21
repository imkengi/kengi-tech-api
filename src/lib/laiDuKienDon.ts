/* ═══════════════════════════════════════════════════════════════════════════════
 *  LÃI DỰ KIẾN CỦA ĐƠN SÀN MỚI + BÁO ĐỘNG LỖ NGAY (18/11/2026)
 *
 *  Chủ shop: "Tiếp tục khi nhận đơn online mới thì hãy tự động tính toán lãi dự kiến, nếu lỗ báo động ngay nha".
 *
 *  Trước đây lãi đơn sàn chỉ có SAU khi sàn đối soát (canhBaoLoiNhuanThap — đơn lãi < 5%: cron phí 6 tiếng; TikTok / Lazada
 *  chỉ quyết toán sau khi khách nhận) ⇒ biết đơn lỗ khi hàng đã đi. Nay đơn vừa về (webhook / lượt đồng bộ) là tính ngay:
 *      lãi dự kiến = giá bán các dòng (sau giảm giá shop) − phí sàn DỰ KIẾN − giá vốn
 *  - Phí dự kiến = ĐÚNG mô hình phí Pilot đang dùng cho từng mặt hàng (docMauPhiTheoNganh().chon(ngành)): Shopee có biểu phí
 *    đọc từ escrow ⇒ công thức (% ngành + thanh toán + dịch vụ có trần + thuế + phí mỗi đơn + affiliate trung bình); sàn khác /
 *    Shopee chưa có biểu phí ⇒ phí đo từ đơn đã đối soát của CHÍNH gian; gian chưa đủ đơn ⇒ phí KHAI, hoặc CHƯA BIẾT PHÍ —
 *    không bịa phí (09/11/2026: không mượn gian khác), chỉ còn xét "lỗ ngay cả khi chưa trừ phí".
 *  - Giá vốn = computeOrderProfits (đúng chuỗi quy đổi đơn vị sàn → kho, mã gộp, combo của orderSync).
 *  - Thiếu giá vốn / chưa biết phí CHỈ làm lỗ thêm ⇒ phần ĐÃ BIẾT mà đã âm là LỖ CHẮC ⇒ vẫn báo. Phần đã biết còn dương thì
 *    không kết luận gì (06/09/2026 chủ shop bỏ lãi ước tính: "lấy được thì hiển thị, không lấy được thì không").
 *
 *  Mỗi đơn MỘT dòng ở bảng "LaiDuKienDon" (tạo lười trong schema cửa hàng — KHÔNG đổi schema-store, khỏi P2022 trước khi
 *  migrate). INSERT … ON CONFLICT DO NOTHING RETURNING là phép GIÀNH: webhook, lượt đồng bộ, nhiều bản Cloud Run cùng thấy
 *  một đơn thì chỉ một bên báo (prod không có Redis). Trang Đơn hàng online đọc lại dòng này (docLaiDuKien) để hiện "lãi dự
 *  kiến" cho đơn chưa quyết toán. Báo: Notification type 'loi_nhuan_thap' (nhóm don_hang — Android kênh ưu tiên CAO, chuông
 *  web) + MỘT push cho cả mẻ.
 *
 *  Gọi từ MỌI đường TẠO đơn sàn: webhook Shopee / TikTok (xetLaiDuKienAnToan — ngay khi đơn về, và khi push đổi trạng thái của
 *  đơn ≤ 24 giờ chưa xét được), lượt đồng bộ cron (autoSync) và đồng bộ tay (/online-orders/sync) qua LƯỚI VÉT
 *  vetLaiDuKienDonMoi (đơn ≤ 24 giờ của kênh chưa có dòng — gồm Lazada chưa có webhook, đơn webhook lỡ). KHÔNG gọi từ kéo bù
 *  đơn cũ (keoBuDonSan) — bộ kiểm F quét nguồn.
 *
 *  THEO TỪNG SKU (19/11/2026, chủ shop: "trong phần tính lãi dự kiến thì phải tính theo SKU và phí của SKU đó chứ"):
 *  mỗi dòng hàng một phép tính riêng — bán (giá dòng) − phí của CHÍNH SKU (% theo ngành của SKU × giá dòng + phần chia phí chung
 *  của đơn theo tỷ trọng giá, lib/giaShopee.phiSanTungDong) − giá vốn của CHÍNH dòng (quy đổi đơn vị sàn → kho). Σ các dòng = số
 *  cả đơn. Lưu trong chiTiet.dong; trang Đơn hàng online hiện từng SKU. BÁO ĐỘNG khi cả đơn lỗ HOẶC một SKU có giá bị bán lỗ dù
 *  cả đơn vẫn lãi (mặt hàng khác gánh — không tách thì không ai thấy). Dòng quà tặng 0đ không báo riêng (giá vốn của nó đã nằm
 *  trong số cả đơn). Dòng tính trước 19/11 (chưa có chiTiet.dong) được lưới vét TÍNH LẠI theo SKU trong 3 ngày — không báo lại.
 *
 *  SHOPEE: GIÁ THẬT + PHÍ THẬT TỪ ESCROW (21/11/2026 — chủ shop gửi ảnh một đơn combo "mua 2 giảm …": lãi dự kiến Kengi gấp
 *  ~3 lần số Shopee ước tính; và "bấm chi tiết hiện đúng mà bên ngoài hiện sai"). Đo prod chỉ đọc:
 *  - Món trong COMBO (bundle deal): get_order_detail trả model_discounted_price = 0 ⇒ đơn ghi giá GỐC (trước cả giảm giá món)
 *    ⇒ "bán" phình to. Giá ghi sổ / hoá đơn GIỮ NGUYÊN (chủ shop 06/09: "xuất hoá đơn là đúng rồi, xuất hàng bán") — chỉ phần
 *    LÃI dùng giá thật: escrow items[].discounted_price (sau combo), Σ = order_discounted_price (Q).
 *  - Phí = phí thật Shopee báo cho đơn (escrow): Q − tiền về dự kiến; tiền về dự kiến = escrow − ship khách trả còn cộng trong
 *    escrow (đơn chưa hoàn tất; hoàn tất thì final_shipping_fee = −ship, ròng 0) − phí bảo vệ vận chuyển CHƯA trừ (Shopee chỉ
 *    trừ khi đã gửi hàng; dự kiến = mức trung bình của biểu phí gian). Chia theo SKU từng khoản (escrowTheoSku).
 *  - Đọc escrow lúc đơn về (webhook / lưới vét), TUẦN TỰ, có trần lượt + hạn giờ, nhường khi proxy quá tải. Chưa đọc được (Shopee
 *    chưa có, lỗi, proxy bận) mà đơn < CHO_ESCROW_MS ⇒ HOÃN (không lưu — push sau / lượt vét sau xét lại); quá hạn ⇒ công thức như
 *    cũ, ghi lý do. Dòng Shopee đã lưu theo công thức (≤ CUA_SO_ESCROW_MS) được lưới vét TÍNH LẠI theo escrow — không báo lại.
 *    Tắt: LAI_DU_KIEN_ESCROW=0.
 * ═══════════════════════════════════════════════════════════════════════════════ */

import { computeOrderProfits, CANCELLED_STATUSES, type GiaVonDong } from './onlineOrderProfit'
import { laDonKeoBu } from './dauKeoBu'
import { phiSanCuaDon, phiSanTungDong, type MauPhi } from './giaShopee'
import { docMauPhiTheoNganh, phamViPhi, type BangPhiNganh } from './shopeeTuQuan'
import { docEscrowQuaDichVu, docBieuPhi, bieuPhiDungDuoc, PHI_DICH_VU_MAC_DINH, type PhiDichVu } from './bieuPhiShopee'
import { proxyCircuitOpen, proxyDangQuaTai } from './proxyBreaker'
import { ShopeeService } from '../services/platforms/shopee'

/** Chỉ xét đơn đặt trên sàn trong ngần này — "đơn MỚI". Kênh mới nối kéo lịch sử / lượt đầu sau khi bật KHÔNG được dội báo
 *  động cho đơn cũ. 24 giờ đủ để lượt đồng bộ 30' vớt đơn lỡ webhook. */
export const CUA_SO_DON_MOI_MS = 24 * 3600_000
/** Mẻ nhiều đơn lỗ hơn ngần này ⇒ MỘT tin gộp (chuông chỉ giữ 30 tin gần nhất — cùng lý do với canhBaoLoiNhuanThap). */
const NGUONG_GOP = 8
const SAN_XET = ['shopee', 'tiktok', 'lazada']

export interface DongGia {
    /** giá dòng sau giảm giá shop (OnlineOrderItem.lineTotal) */
    gia: number
    /** mã ngành của listing trên sàn; null = chưa rõ ngành */
    nganh: string | null
    /** số cái — phí dịch vụ Shopee có trần theo TỪNG CÁI (21/11/2026); thiếu ⇒ 1 */
    sl?: number
}

/** 'escrow' (21/11/2026): giá + phí thật Shopee báo cho CHÍNH đơn (get_escrow_detail) — xem escrowTheoSku. */
export type NguonPhiDuKien = 'escrow' | 'cong-thuc' | 'do-so' | 'khai' | 'chua-biet'

export interface PhiDuKien {
    /** VND; null = CHƯA BIẾT phí sàn của gian (không bịa) */
    phi: number | null
    nguon: NguonPhiDuKien
    /** có mặt hàng tạm dùng phí trung bình / cả gian (ngành chưa có đơn mẫu, chưa rõ ngành) */
    tam: boolean
    /** một cụm cho người đọc — nằm trong tin báo và tooltip */
    moTa: string
}

const pct = (x: number) => `${(Math.round(x * 1000) / 10).toLocaleString('vi-VN')}%`
const vnd = (n: number) => `${Math.round(n).toLocaleString('vi-VN')}đ`

/** Phí sàn dự kiến của MỘT đơn từ các dòng hàng và bảng phí của gian (hàm thuần). */
export function phiDuKienCuaDon(dong: DongGia[], bang: Pick<BangPhiNganh, 'chon'>): PhiDuKien {
    const mau = (dong || []).filter(d => Number(d.gia) > 0).map(d => ({ gia: Number(d.gia), sl: d.sl, phi: bang.chon(d.nganh) }))
    if (!mau.length) return { phi: null, nguon: 'chua-biet', tam: false, moTa: 'đơn không có dòng hàng nào có giá' }
    if (mau.some(m => m.phi.chuaBiet)) {
        return {
            phi: null, nguon: 'chua-biet', tam: false,
            moTa: 'gian CHƯA BIẾT phí sàn (chưa đủ đơn đã đối soát để đo, chưa khai «Phí sàn (%)») — chưa trừ phí, lỗ thật còn lớn hơn',
        }
    }
    const phi = Math.max(0, Math.round(phiSanCuaDon(mau)))
    const dau = mau[0]!.phi
    const tam = mau.some(m => !!(m.phi.thayNganh || m.phi.chuaRoNganh))
    if (dau.nguon === 'cong-thuc') {
        const muc = [...new Set(mau.filter(m => m.phi.congThuc && !m.phi.thayNganh && !m.phi.chuaRoNganh).map(m => pct(m.phi.congThuc!.phiNganh)))]
        return {
            phi, nguon: 'cong-thuc', tam,
            moTa: `phí theo biểu phí Shopee đọc từ escrow${muc.length ? ` — phí cố định ngành ${muc.join(', ')}` : ''}` +
                `${tam ? '; có mặt hàng chưa rõ % ngành, tạm lấy % trung bình các ngành' : ''}`,
        }
    }
    if (dau.khai || dau.nguon === 'cau-hinh-kenh') {
        return { phi, nguon: 'khai', tam, moTa: `phí KHAI của gian ${pct(dau.tyLe)} (chưa đủ đơn đã đối soát để đo)` }
    }
    return {
        phi, nguon: 'do-so', tam,
        moTa: `phí đo từ ${dau.soDon} đơn đã đối soát của gian${tam ? ' (ngành chưa đủ đơn — tạm dùng phí cả gian)' : ''}`,
    }
}

// ─── Theo từng SKU (19/11/2026) ───────────────────────────────────────────────────

/** Bảng phí đủ dùng cho tính theo SKU: `chon` bắt buộc; tên / ví dụ ngành (bảng thật có) để mô tả phí từng dòng. */
export type BangChonPhi = Pick<BangPhiNganh, 'chon'> & Partial<Pick<BangPhiNganh, 'tenNganh'>>

/** Một dòng hàng đưa vào tính lãi theo SKU. */
export interface DongVaoLai extends DongGia {
    /** OnlineOrderItem.id */
    id: string
    sku: string | null
    ten: string
    sl: number
    /** mã sản phẩm trên sàn (OnlineOrderItem.externalItemId — Shopee: item_id) — nối dòng đơn ↔ dòng escrow */
    itemId?: string | null
}

/** Lãi dự kiến của MỘT dòng hàng (SKU). */
export interface LaiDong {
    id: string
    sku: string | null
    ten: string
    sl: number
    /** giá dòng sau giảm giá shop — nguồn escrow: giá THẬT Shopee tính (sau combo / khuyến mãi) */
    doanhThu: number
    /** giá dòng GHI TRÊN ĐƠN (OnlineOrderItem.lineTotal) khi khác giá thật Shopee (combo: đơn ghi giá gốc) — chỉ nguồn escrow */
    giaDon?: number
    /** phí sàn dự kiến của dòng = % phí của CHÍNH SKU × giá dòng + phần chia phí chung của đơn; null = gian chưa biết phí */
    phi: number | null
    /** trong `phi`: phần chia phí cố định mỗi ĐƠN (phí dịch vụ/đơn, bảo vệ vận chuyển…), theo tỷ trọng giá */
    phiChung: number
    /** % phí theo giá của CHÍNH SKU = (phi − phiChung) / doanhThu, 0..1 (đã trừ phần bớt nhờ trần); null = chưa biết phí */
    tyLePhi: number | null
    giaVon: number
    thieuGiaVon: boolean
    /** doanhThu − (phi ?? 0) − giaVon */
    lai: number
    /** dòng CÓ GIÁ mà phần đã biết đã âm ⇒ SKU này bán LỖ (dòng quà tặng 0đ không tính) */
    lo: boolean
    nganh: string | null
    /** phí của SKU là số tạm (ngành chưa có đơn mẫu / chưa rõ ngành ⇒ trung bình / cả gian) */
    tamPhi: boolean
    /** một cụm ngắn: phí của SKU lấy từ đâu */
    moTaPhi: string
}

/** Câu ngắn "phí của SKU này lấy từ đâu" (hàm thuần) — cụm đứng sau % phí trên giao diện / tin báo. */
export function moTaPhiDong(m: MauPhi, bang?: Partial<Pick<BangPhiNganh, 'tenNganh'>>): string {
    const ten = m.nganh ? bang?.tenNganh?.get(m.nganh) : undefined
    const nganh = ten ? ` ${ten.length > 40 ? `${ten.slice(0, 39).trimEnd()}…` : ten}` : ''
    if (m.chuaBiet) return 'gian chưa biết phí'
    if (m.nguon === 'cong-thuc' && m.congThuc) {
        if (m.thayNganh || m.chuaRoNganh) return `chưa rõ % ngành — tạm % trung bình ${pct(m.congThuc.phiNganh)} + phí chung Shopee`
        return `biểu phí Shopee: ngành${nganh} ${pct(m.congThuc.phiNganh)} + phí chung`
    }
    switch (phamViPhi(m)) {
        case 'nganh': return `đo từ ${m.soDon} đơn của ngành${nganh}`
        case 'khai': return 'phí KHAI của gian'
        case 'thay-nganh': return `${m.chuaRoNganh ? 'chưa rõ ngành' : 'ngành chưa đủ đơn'} — tạm phí cả gian (${m.soDon} đơn)`
        default: return `đo từ ${m.soDon} đơn của cả gian`
    }
}

/** Làm tròn từng phần rồi dồn phần lẻ vào phần lớn nhất (theo |trọng số|) ⇒ Σ = đúng `tong` (hàm thuần). */
function chiaLamTron(tho: number[], tong: number, trongSo: number[]): number[] {
    const ra = tho.map(x => Math.round(x))
    if (!ra.length) return ra
    const du = Math.round(tong) - ra.reduce((s, x) => s + x, 0)
    if (du) {
        let i = 0
        for (let j = 1; j < trongSo.length; j++) if (Math.abs(trongSo[j]!) > Math.abs(trongSo[i]!)) i = j
        ra[i] = ra[i]! + du
    }
    return ra
}

/**
 * Lãi dự kiến TỪNG DÒNG (SKU) của một đơn (hàm thuần). Phí: theo mô hình phí của CHÍNH SKU (bang.chon(ngành của dòng)) qua
 * phiSanTungDong — Σ = phí cả đơn `p.phi`. Giá vốn: của CHÍNH dòng (von.dong, đúng thứ tự `dong`) — Σ = `von.cost`. Làm tròn từng
 * dòng, phần lẻ dồn vào dòng lớn nhất ⇒ cộng các dòng ra ĐÚNG số cả đơn. `von.dong` thiếu / lệch số dòng ⇒ mọi dòng "thiếu giá vốn"
 * (không đoán chia giá vốn theo giá bán).
 */
export function laiTungDong(dong: DongVaoLai[], bang: BangChonPhi, p: PhiDuKien, von: { cost: number; missingCost: boolean; dong?: GiaVonDong[] }): LaiDong[] {
    const ds = dong || []
    if (!ds.length) return []
    const gia = ds.map(d => Math.max(0, Number(d.gia) || 0))
    const mau = ds.map(d => bang.chon(d.nganh))
    const tung = phiSanTungDong(gia.map((g, i) => ({ gia: g, sl: ds[i]!.sl, phi: mau[i]! })))
    const phi = p.phi == null ? null : chiaLamTron(tung.map(t => t.phi), p.phi, gia)
    const chung = tung.map(t => Math.round(t.phiChung))
    const vonDong = von?.dong && von.dong.length === ds.length ? von.dong : null
    const gv = vonDong ? chiaLamTron(vonDong.map(v => Number(v.cost) || 0), Math.round(Number(von.cost) || 0), vonDong.map(v => Number(v.cost) || 0)) : ds.map(() => 0)
    return ds.map((d, i) => {
        const dt = Math.round(gia[i]!)
        const ph = phi ? phi[i]! : null
        const lai = dt - (ph ?? 0) - gv[i]!
        const m = mau[i]!
        return {
            id: String(d.id), sku: d.sku ? String(d.sku) : null, ten: String(d.ten || '').trim().replace(/\s+/g, ' ').slice(0, 120),
            sl: Number(d.sl) || 0, doanhThu: dt, phi: ph, phiChung: ph == null || !(dt > 0) ? 0 : chung[i]!,
            tyLePhi: ph == null || !(dt > 0) ? null : Math.round((tung[i]!.phiTyLe / gia[i]!) * 10000) / 10000,
            giaVon: gv[i]!, thieuGiaVon: vonDong ? !!vonDong[i]!.missingCost : true,
            lai, lo: dt > 0 && lai < 0, nganh: d.nganh ?? null,
            tamPhi: !!(m.thayNganh || m.chuaRoNganh), moTaPhi: p.phi == null ? 'gian chưa biết phí' : moTaPhiDong(m, bang),
        }
    })
}

// ─── Shopee: giá + phí THẬT từ escrow (21/11/2026) ────────────────────────────────

/** Một dòng hàng của escrow (order_income.items[]): khoá nối + giá CẢ dòng sau giảm (co giãn cho Σ = Q) + số cái + affiliate. */
export interface DongEscrowDon { itemId: string; sku: string; gia: number; sl: number; aff: number }

/** Escrow của một đơn quy về TIỀN VỀ DỰ KIẾN (docEscrowDuKien). */
export interface EscrowDuKien {
    /** order_discounted_price — giá thật cả đơn sau giảm (combo, giảm giá shop, voucher shop) */
    Q: number
    /** escrow_amount Shopee báo lúc đọc */
    escrow: number
    /** ship khách trả còn CỘNG trong escrow (đơn chưa hoàn tất) — tiền của đơn vị vận chuyển, trừ ra */
    ship: number
    /** phí bảo vệ vận chuyển Shopee CHƯA trừ (đơn chưa gửi) — cộng vào phí theo mức dự kiến của gian */
    baoVeChuaTru: number
    /** tiền về dự kiến = escrow − ship − baoVeChuaTru */
    thucNhan: number
    /** phí dự kiến cả đơn = Q − thucNhan */
    phi: number
    /** các khoản Shopee báo (VND) */
    khoan: { hoaHong: number; dichVu: number; thanhToan: number; thue: number; baoVe: number; aff: number; khac: number }
    dong: DongEscrowDon[]
}

const soE = (v: any) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }

/**
 * order_income (get_escrow_detail) ⇒ tiền về dự kiến (hàm thuần). null = không dùng được: thiếu Q / escrow, đơn đã trả hàng /
 * hoàn tiền (seller_return_refund ≠ 0). Đo prod 21/11/2026 (chỉ đọc):
 *  - ship khách trả: đơn chưa hoàn tất escrow CỘNG nó (final_shipping_fee = 0); hoàn tất thì final_shipping_fee = −ship ⇒ ròng 0.
 *    final_shipping_fee < −ship = shop chịu thêm ship — đã nằm trong escrow, giữ nguyên.
 *  - phí bảo vệ vận chuyển: đơn chưa gửi = 0, đã gửi / hoàn tất = mức của gian ⇒ chưa trừ thì cộng `baoVeDuKien` (mức trung bình
 *    của biểu phí gian; gian chưa có biểu phí ⇒ 0, câu nguồn không nhắc).
 */
export function docEscrowDuKien(inc: any, baoVeDuKien = 0): EscrowDuKien | null {
    if (!inc || typeof inc !== 'object') return null
    const Q = soE(inc.order_discounted_price), escrow = Number(inc.escrow_amount)
    if (!(Q > 0) || inc.escrow_amount == null || !Number.isFinite(escrow)) return null
    if (soE(inc.seller_return_refund) !== 0) return null
    const S = Math.max(0, soE(inc.buyer_paid_shipping_fee)), fsf = soE(inc.final_shipping_fee)
    const ship = S > 0 ? Math.max(0, Math.min(S, S + fsf)) : 0
    const baoVe = Math.max(0, soE(inc.shipping_seller_protection_fee_amount))
    const baoVeChuaTru = baoVe > 0 ? 0 : Math.max(0, Math.round(soE(baoVeDuKien)))
    const thucNhan = escrow - ship - baoVeChuaTru
    const items: any[] = Array.isArray(inc.items) ? inc.items : []
    const tho = items.map(i => ({
        itemId: i?.item_id == null ? '' : String(i.item_id).trim(),
        sku: String(i?.model_sku || i?.item_sku || '').trim(),
        gia: Math.max(0, soE(i?.discounted_price)), sl: Math.max(1, Math.round(soE(i?.quantity_purchased)) || 1),
        aff: Math.max(0, soE(i?.ams_commission_fee)),
    }))
    const tong = tho.reduce((s, d) => s + d.gia, 0)
    const k = tong > 0 ? Q / tong : 0
    return {
        Q, escrow, ship, baoVeChuaTru, thucNhan, phi: Q - thucNhan,
        khoan: {
            hoaHong: soE(inc.commission_fee), dichVu: soE(inc.service_fee), thanhToan: soE(inc.seller_transaction_fee),
            thue: soE(inc.withholding_vat_tax) + soE(inc.withholding_pit_tax), baoVe,
            aff: Math.max(0, soE(inc.order_ams_commission_fee)), khac: soE(inc.ads_escrow_top_up_fee_or_technical_support_fee),
        },
        dong: k > 0 ? tho.map(d => ({ ...d, gia: d.gia * k })) : [],
    }
}

/**
 * Giá thật / số cái / affiliate của TỪNG dòng đơn theo escrow (hàm thuần, đúng thứ tự `dong`): nối item_id + SKU, rồi item_id khi
 * một-một; phần escrow còn lại chia cho các dòng chưa nối theo giá ghi trên đơn (hết dòng chưa nối ⇒ dồn vào dòng đã nối theo
 * giá). Σ gia = Q. Dòng đơn không có trong escrow mà escrow đã hết giá ⇒ 0đ (như quà tặng).
 */
export function ganGiaEscrow(dong: Pick<DongVaoLai, 'gia' | 'sl' | 'sku' | 'itemId'>[], e: Pick<EscrowDuKien, 'Q' | 'dong' | 'khoan'>):
    { gia: number; sl: number; aff: number; noi: boolean }[] {
    const ds = dong || []
    const ra = ds.map(d => ({ gia: 0, sl: Math.max(1, Math.round(Number(d.sl)) || 1), aff: 0, noi: false }))
    const con = (e.dong || []).map(x => ({ ...x, dung: false }))
    const khoa = (id: any, sku: any) => `${String(id ?? '').trim()}|${String(sku ?? '').trim().toLowerCase()}`
    const ma = (d: Pick<DongVaoLai, 'itemId'>) => String(d.itemId ?? '').trim()
    for (let i = 0; i < ds.length; i++) {
        const d = ds[i]!
        if (!ma(d)) continue
        const x = con.find(c => !c.dung && khoa(c.itemId, c.sku) === khoa(d.itemId, d.sku))
        if (x) { x.dung = true; ra[i] = { gia: x.gia, sl: x.sl, aff: x.aff, noi: true } }
    }
    for (let i = 0; i < ds.length; i++) {
        const d = ds[i]!
        if (ra[i]!.noi || !ma(d)) continue
        const xs = con.filter(c => !c.dung && c.itemId === ma(d))
        const cung = ds.filter((y, k) => !ra[k]!.noi && ma(y) === ma(d))
        if (xs.length === 1 && cung.length === 1) { xs[0]!.dung = true; ra[i] = { gia: xs[0]!.gia, sl: xs[0]!.sl, aff: xs[0]!.aff, noi: true } }
    }
    const daNoi = ra.filter(r => r.noi)
    const giaCon = Math.max(0, e.Q - daNoi.reduce((s, r) => s + r.gia, 0))
    const affCon = Math.max(0, (e.khoan?.aff || 0) - daNoi.reduce((s, r) => s + r.aff, 0))
    const chua = ra.map((r, i) => (r.noi ? -1 : i)).filter(i => i >= 0)
    if (chua.length) {
        const tg = chua.reduce((s, i) => s + Math.max(0, Number(ds[i]!.gia) || 0), 0)
        for (const i of chua) {
            const w = tg > 0 ? Math.max(0, Number(ds[i]!.gia) || 0) / tg : 1 / chua.length
            ra[i] = { ...ra[i]!, gia: giaCon * w, aff: affCon * w }
        }
    } else if (giaCon > 0.5 || affCon > 0.5) {
        const tg = ra.reduce((s, r) => s + r.gia, 0)
        for (const r of ra) { const w = tg > 0 ? r.gia / tg : 1 / ra.length; r.gia += giaCon * w; r.aff += affCon * w }
    }
    return ra
}

/** Câu nguồn phí của một SKU tính theo escrow. */
function moTaPhiEscrow(m: MauPhi, bang?: Partial<Pick<BangPhiNganh, 'tenNganh'>>): string {
    if (m.congThuc && !m.thayNganh && !m.chuaRoNganh) {
        const ten = m.nganh ? bang?.tenNganh?.get(m.nganh) : undefined
        const nganh = ten ? ` ${ten.length > 40 ? `${ten.slice(0, 39).trimEnd()}…` : ten}` : ''
        return `phí thật Shopee báo cho đơn — hoa hồng ngành${nganh} ${pct(m.congThuc.phiNganh)} + thanh toán, dịch vụ, thuế`
    }
    return 'phí thật Shopee báo cho đơn, chia theo SKU'
}

/**
 * Lãi dự kiến TỪNG SKU theo escrow Shopee (hàm thuần). Bán = giá thật của dòng (ganGiaEscrow, Σ = Q). Phí cả đơn = e.phi, chia
 * theo TỪNG KHOẢN Shopee báo: hoa hồng theo % ngành của SKU × giá dòng; phần % của phí dịch vụ theo công thức có trần từng cái;
 * thanh toán, thuế, khoản khác theo giá dòng; affiliate đúng dòng Shopee báo; phí dịch vụ mỗi đơn + bảo vệ vận chuyển (phí cố
 * định của ĐƠN) chia theo giá ⇒ phiChung. Làm tròn dồn lẻ ⇒ Σ SKU = đúng số cả đơn.
 */
export function escrowTheoSku(dong: DongVaoLai[], e: EscrowDuKien, bang: BangChonPhi, von: { cost: number; missingCost: boolean; dong?: GiaVonDong[] },
    dv: PhiDichVu = PHI_DICH_VU_MAC_DINH): { p: PhiDuKien; laiDong: LaiDong[]; doanhThu: number } {
    const ds = dong || []
    const Q = Math.round(e.Q), F = Math.round(e.phi)
    const g = ganGiaEscrow(ds, e)
    const gia = chiaLamTron(g.map(x => x.gia), Q, g.map(x => x.gia))
    const tg = gia.reduce((s, x) => s + x, 0)
    const wQ = gia.map(x => (tg > 0 ? x / tg : 1 / Math.max(1, ds.length)))
    const chuan = (w: number[]) => { const t = w.reduce((s, x) => s + x, 0); return t > 0 ? w.map(x => x / t) : wQ }
    const mau = ds.map(d => bang.chon(d.nganh))
    const wHH = chuan(gia.map((x, i) => x * Math.max(0, mau[i]!.congThuc ? mau[i]!.congThuc!.phiNganh : mau[i]!.tyLe)))
    const wDV = chuan(gia.map((x, i) => { const sl = g[i]!.sl, mot = dv.tyLe * (x / sl); return (dv.tran > 0 ? Math.min(mot, dv.tran) : mot) * sl }))
    const k = e.khoan
    const dvMoiDon = Math.min(Math.max(0, k.dichVu), dv.moiDon)
    const coDinh = dvMoiDon + k.baoVe + e.baoVeChuaTru
    const phanDV = k.dichVu - dvMoiDon
    const aff = g.map(x => x.aff)
    const conLai = F - (k.hoaHong + phanDV + k.thanhToan + k.thue + aff.reduce((s, x) => s + x, 0) + coDinh)
    const tho = ds.map((_, i) => k.hoaHong * wHH[i]! + phanDV * wDV[i]! + (k.thanhToan + k.thue + conLai + coDinh) * wQ[i]! + aff[i]!)
    const phi = chiaLamTron(tho, F, gia)
    const vonDong = von?.dong && von.dong.length === ds.length ? von.dong : null
    const gv = vonDong ? chiaLamTron(vonDong.map(v => Number(v.cost) || 0), Math.round(Number(von.cost) || 0), vonDong.map(v => Number(v.cost) || 0)) : ds.map(() => 0)
    const laiDong: LaiDong[] = ds.map((d, i) => {
        const dt = gia[i]!, ph = phi[i]!
        const chung = dt > 0 ? Math.round(coDinh * wQ[i]!) : 0
        const giaDon = Math.round(Math.max(0, Number(d.gia) || 0))
        const lai = dt - ph - gv[i]!
        return {
            id: String(d.id), sku: d.sku ? String(d.sku) : null, ten: String(d.ten || '').trim().replace(/\s+/g, ' ').slice(0, 120),
            sl: Number(d.sl) || 0, doanhThu: dt, ...(Math.abs(giaDon - dt) >= 1 ? { giaDon } : {}),
            phi: ph, phiChung: chung, tyLePhi: dt > 0 ? Math.round(((ph - chung) / dt) * 10000) / 10000 : null,
            giaVon: gv[i]!, thieuGiaVon: vonDong ? !!vonDong[i]!.missingCost : true,
            lai, lo: dt > 0 && lai < 0, nganh: d.nganh ?? null, tamPhi: false,
            moTaPhi: dt > 0 ? moTaPhiEscrow(mau[i]!, bang) : 'không có giá trong escrow',
        }
    })
    const phan = [`hoa hồng ${vnd(k.hoaHong)}`, `dịch vụ ${vnd(k.dichVu)}`, `thanh toán ${vnd(k.thanhToan)}`, `thuế ${vnd(k.thue)}`]
    if (k.baoVe || e.baoVeChuaTru) phan.push(`bảo vệ vận chuyển ${vnd(k.baoVe || e.baoVeChuaTru)}${e.baoVeChuaTru ? ' (trừ khi gửi hàng)' : ''}`)
    if (k.aff) phan.push(`affiliate ${vnd(k.aff)}`)
    if (Math.abs(conLai) >= 1) phan.push(`khác ${vnd(conLai)}`)
    const giaDonTong = ds.reduce((s, d) => s + Math.round(Math.max(0, Number(d.gia) || 0)), 0)
    const moTa = `phí thật Shopee báo cho đơn: ${phan.join(' + ')}`
        + (e.ship ? `; ship khách trả ${vnd(e.ship)} không tính (chuyển cho đơn vị vận chuyển)` : '')
        + (Math.abs(giaDonTong - Q) >= 1 ? `; giá Shopee tính ${vnd(Q)}, đơn ghi ${vnd(giaDonTong)} (combo / khuyến mãi)` : '')
    return { p: { phi: F, nguon: 'escrow', tam: false, moTa }, laiDong, doanhThu: Q }
}

export interface LaiDuKien {
    doanhThu: number
    phi: number | null
    /** giá vốn phần ĐÃ BIẾT */
    giaVon: number
    thieuGiaVon: boolean
    /** doanhThu − (phí ?? 0) − giá vốn đã biết. Thiếu giá vốn / chưa biết phí ⇒ đây là mức TRẦN (lãi thật chỉ thấp hơn). */
    lai: number
    /** lãi < 0 với phần đã biết ⇒ LỖ CHẮC (phần thiếu chỉ làm lỗ thêm) */
    lo: boolean
    /** đủ dữ liệu cho một con số (biết phí, đủ giá vốn) */
    du: boolean
    nguonPhi: NguonPhiDuKien
    tamPhi: boolean
    moTaPhi: string
}

/** Kết luận lãi dự kiến (hàm thuần). Chưa có giá bán (dòng hàng chưa mang giá) ⇒ KHÔNG kết luận lỗ: "bán 0đ − giá vốn"
 *  là thiếu số, không phải lỗ (đọc không được ≠ bằng 0). */
export function ketLuanLaiDuKien(doanhThu: number, p: PhiDuKien, von: { cost: number; missingCost: boolean }): LaiDuKien {
    const dt = Math.round(Number(doanhThu) || 0)
    const gv = Math.round(Number(von?.cost) || 0)
    const lai = dt - (p.phi ?? 0) - gv
    return {
        doanhThu: dt, phi: p.phi, giaVon: gv, thieuGiaVon: !!von?.missingCost,
        lai, lo: dt > 0 && lai < 0, du: dt > 0 && p.phi != null && !von?.missingCost,
        nguonPhi: p.nguon, tamPhi: p.tam, moTaPhi: p.moTa,
    }
}

/** Tên mặt hàng chính của đơn cho tin báo (hàm thuần): dòng giá cao nhất, kèm số lượng và số mặt hàng khác. */
export function tenHangChinh(items: { productName?: string | null; quantity?: number | null; lineTotal?: number | null }[]): string {
    const ds = (items || []).filter(i => String(i?.productName || '').trim())
    if (!ds.length) return ''
    const chinh = ds.reduce((a, b) => ((Number(b.lineTotal) || 0) > (Number(a.lineTotal) || 0) ? b : a))
    // bỏ nhãn quảng cáo đầu tên ("[Hàng Chính Hãng]", "【Freeship】") — tin trên điện thoại chỉ hiện vài dòng đầu
    const goc = String(chinh.productName).trim().replace(/\s+/g, ' ')
    const ten = goc.replace(/^(?:\s*[[【][^\]】]{1,40}[\]】]\s*){1,3}/, '').trim() || goc
    const ngan = ten.length > 70 ? `${ten.slice(0, 69).trimEnd()}…` : ten
    const sl = Number(chinh.quantity) || 1
    const khac = (items || []).length - 1
    return `${ngan}${sl > 1 ? ` ×${sl}` : ''}${khac > 0 ? ` (+${khac} mặt hàng)` : ''}`
}

/** Tên SKU ngắn cho tin báo: tên hàng (bỏ nhãn quảng cáo đầu tên) + [mã SKU] (hàm thuần). */
function tenSkuNgan(x: Pick<LaiDong, 'ten' | 'sku' | 'sl'>, toiDa = 45): string {
    const goc = String(x.ten || '').trim()
    const ten = goc.replace(/^(?:\s*[[【][^\]】]{1,40}[\]】]\s*){1,3}/, '').trim() || goc || 'mặt hàng'
    const ngan = ten.length > toiDa ? `${ten.slice(0, toiDa - 1).trimEnd()}…` : ten
    return `${ngan}${x.sku ? ` [${x.sku}]` : ''}${x.sl > 1 ? ` ×${x.sl}` : ''}`
}

/** Phép tính của MỘT SKU lỗ cho tin báo (hàm thuần): "Tên [SKU]: bán X − phí Y (Z% — nguồn) − vốn W = −V". */
export function phepTinhSku(x: LaiDong): string {
    const phi = x.phi != null
        ? `phí ${vnd(x.phi)}${x.tyLePhi != null ? ` (${pct(x.tyLePhi)} của SKU${x.phiChung ? ` + ${vnd(x.phiChung)} phí chung đơn` : ''} — ${x.moTaPhi})` : ''}`
        : 'phí chưa biết'
    return `${tenSkuNgan(x)}: bán ${vnd(x.doanhThu)} − ${phi} − vốn ${vnd(x.giaVon)}${x.thieuGiaVon ? ' (thiếu giá vốn)' : ''} = ${vnd(x.lai)}`
}

/** Số tiền LỖ đem báo của một đơn: cả đơn lỗ ⇒ lãi cả đơn; cả đơn còn lãi ⇒ Σ lãi các SKU lỗ (hàm thuần, ≤ 0). */
export const soLoBao = (k: Pick<LaiDuKien, 'lai' | 'lo'>, skuLo: Pick<LaiDong, 'lai'>[] = []): number =>
    k.lo ? k.lai : skuLo.reduce((s, x) => s + Math.min(0, x.lai), 0)

/** Tin báo động cho MỘT đơn (hàm thuần): cả đơn lỗ, hoặc cả đơn lãi mà có SKU bán lỗ (`skuLo` — các dòng `lo`). */
export function tinBaoLo(don: { ma: string; san: string; kenh?: string | null; hang?: string | null }, k: LaiDuKien, skuLo: LaiDong[] = []): { tieuDe: string; noiDung: string } {
    const noi = `${String(don.san || '').toUpperCase()}${don.kenh ? ` · ${don.kenh}` : ''}`
    const chiSku = skuLo.length
        ? ` Lỗ ở SKU: ${skuLo.slice(0, 3).map(phepTinhSku).join(' · ')}${skuLo.length > 3 ? ` (+${skuLo.length - 3} SKU lỗ nữa)` : ''}.`
        : ''
    const duoi = `${k.thieuGiaVon ? ' Còn mặt hàng chưa có giá vốn — lỗ thật còn lớn hơn.' : ''} Xem lại giá bán trên sàn / giá vốn để đơn sau không lỗ tiếp.`
    if (!k.lo && skuLo.length) {
        // Cả đơn vẫn lãi nhờ mặt hàng khác — báo SKU bán lỗ (không tách theo SKU thì không ai thấy)
        const tieuDe = `🚨 Đơn ${don.ma}: ${skuLo.length === 1 ? 'một SKU' : `${skuLo.length} SKU`} dự kiến LỖ ${vnd(-soLoBao(k, skuLo))}`
        const noiDung = `${noi}:${chiSku.replace(/^ Lỗ ở SKU:/, '')} Cả đơn vẫn lãi ${vnd(k.lai)} nhờ mặt hàng khác.${duoi}`
        return { tieuDe, noiDung }
    }
    const tieuDe = `🚨 Đơn ${don.ma} dự kiến LỖ ${vnd(-k.lai)}`
    const phep = [`bán ${vnd(k.doanhThu)}`, k.phi != null ? `phí sàn dự kiến ${vnd(k.phi)}` : 'phí sàn chưa biết', `giá vốn ${vnd(k.giaVon)}`]
    const noiDung = `${don.hang ? `${don.hang} — ` : ''}${noi}: ${phep.join(' − ')} = ${vnd(k.lai)} (${k.moTaPhi}).${chiSku}${duoi}`
    return { tieuDe, noiDung }
}

// ─── Bảng "LaiDuKienDon" (tạo lười trong schema cửa hàng) ────────────────────────

const SQL_TAO_BANG = `CREATE TABLE IF NOT EXISTS "LaiDuKienDon" (
    "orderId"     TEXT PRIMARY KEY,
    "xetLuc"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "doanhThu"    DOUBLE PRECISION NOT NULL,
    "phiDuKien"   DOUBLE PRECISION,
    "giaVon"      DOUBLE PRECISION NOT NULL,
    "lai"         DOUBLE PRECISION NOT NULL,
    "thieuGiaVon" BOOLEAN NOT NULL DEFAULT false,
    "nguonPhi"    TEXT NOT NULL,
    "chiTiet"     JSONB,
    "baoLuc"      TIMESTAMP(3)
)`

/** prisma (client của MỘT schema) ⇒ đã có bảng: true / chưa: lúc dò (để dò lại sau 10 phút). */
const CO_BANG = new WeakMap<object, { co: boolean; luc: number }>()

async function damBaoBang(prisma: any): Promise<void> {
    if (CO_BANG.get(prisma)?.co) return
    try {
        await prisma.$executeRawUnsafe(SQL_TAO_BANG)
    } catch (e) {
        // hai bản cùng tạo một lúc ⇒ bản thua có thể vấp khoá trùng pg_type: bảng đã có thì thôi
        const r: any[] = await prisma.$queryRawUnsafe(`SELECT to_regclass('"LaiDuKienDon"') IS NOT NULL AS co`).catch(() => [])
        if (!r?.[0]?.co) throw e
    }
    CO_BANG.set(prisma, { co: true, luc: Date.now() })
}

/** Bảng có chưa — dò to_regclass (đọc thẳng bảng chưa có thì Prisma vẫn in "Raw query failed" dù đã bắt 42P01). */
async function coBang(prisma: any): Promise<boolean> {
    const c = CO_BANG.get(prisma)
    if (c && (c.co || Date.now() - c.luc < 600_000)) return c.co
    const r: any[] = await prisma.$queryRawUnsafe(`SELECT to_regclass('"LaiDuKienDon"') IS NOT NULL AS co`).catch(() => [])
    const co = !!r?.[0]?.co
    CO_BANG.set(prisma, { co, luc: Date.now() })
    return co
}

/** Bỏ trạng thái "đã có bảng" (bộ kiểm dùng prisma giả mới mỗi ca thì không cần; để dành cho ca dựng lại bảng). */
export function xoaDemBangLaiDuKien(prisma: any): void { CO_BANG.delete(prisma) }

/** Một dòng đã lưu — trả kèm GET /online-orders (`laiDuKien`), chỉ owner/admin. */
export interface LaiDuKienDaLuu {
    lai: number
    phi: number | null
    giaVon: number
    doanhThu: number
    thieuGiaVon: boolean
    nguonPhi: string
    moTaPhi: string
    /** lúc tính (ISO) */
    luc: string
    lo: boolean
    /** đã báo động (ISO) */
    baoLuc: string | null
    /** lãi dự kiến TỪNG SKU (19/11/2026); null = dòng tính trước khi có theo SKU (lưới vét tính lại trong 3 ngày) */
    dong: LaiDongDaLuu[] | null
    /** số SKU có giá bị bán lỗ (cả khi cả đơn vẫn lãi) */
    soSkuLo: number
    /** nguồn escrow (21/11/2026): tiền về dự kiến + hai khoản đã chỉnh so với escrow lúc đọc; null = không theo escrow */
    escrow: { luc: string; thucNhan: number; ship: number; baoVeChuaTru: number } | null
}

/** Một SKU đã lưu — đúng các trường của LaiDong (trừ ngành). */
export type LaiDongDaLuu = Omit<LaiDong, 'nganh'>

/** Đọc lãi dự kiến đã lưu của các đơn — bảng chưa có / đọc hỏng ⇒ Map rỗng (không ném). */
export async function docLaiDuKien(prisma: any, orderIds: string[]): Promise<Map<string, LaiDuKienDaLuu>> {
    const out = new Map<string, LaiDuKienDaLuu>()
    const ids = [...new Set((orderIds || []).filter(Boolean).map(String))]
    if (!ids.length || !(await coBang(prisma))) return out
    const rows: any[] = await prisma.$queryRawUnsafe(
        `SELECT "orderId", "xetLuc", "doanhThu", "phiDuKien", "giaVon", "lai", "thieuGiaVon", "nguonPhi", "chiTiet", "baoLuc"
           FROM "LaiDuKienDon" WHERE "orderId" = ANY($1::text[])`, ids).catch(() => [])
    for (const r of rows || []) {
        const ct = typeof r.chiTiet === 'string' ? (() => { try { return JSON.parse(r.chiTiet) } catch { return {} } })() : (r.chiTiet || {})
        const lai = Math.round(Number(r.lai) || 0)
        const dong = docDongDaLuu(ct?.dong)
        out.set(String(r.orderId), {
            lai, phi: r.phiDuKien == null ? null : Math.round(Number(r.phiDuKien)),
            giaVon: Math.round(Number(r.giaVon) || 0), doanhThu: Math.round(Number(r.doanhThu) || 0),
            thieuGiaVon: !!r.thieuGiaVon, nguonPhi: String(r.nguonPhi || ''), moTaPhi: String(ct?.moTaPhi || ''),
            luc: r.xetLuc ? new Date(r.xetLuc).toISOString() : '', lo: lai < 0,
            baoLuc: r.baoLuc ? new Date(r.baoLuc).toISOString() : null,
            dong, soSkuLo: dong ? dong.filter(x => x.lo).length : 0,
            escrow: String(r.nguonPhi) === 'escrow' && ct?.escrow && typeof ct.escrow === 'object'
                ? { luc: String(ct.escrow.luc || ''), thucNhan: Math.round(Number(ct.escrow.thucNhan) || 0), ship: Math.round(Number(ct.escrow.ship) || 0), baoVeChuaTru: Math.round(Number(ct.escrow.baoVeChuaTru) || 0) }
                : null,
        })
    }
    return out
}

/** chiTiet.dong (JSONB) ⇒ danh sách SKU đã lưu; không phải mảng ⇒ null (dòng tính trước 19/11). Số hỏng ⇒ 0 / null, không ném. */
function docDongDaLuu(v: any): LaiDongDaLuu[] | null {
    if (!Array.isArray(v)) return null
    const so = (x: any) => Math.round(Number(x) || 0)
    return v.filter(x => x && typeof x === 'object').map((x: any) => ({
        id: String(x.id ?? ''), sku: x.sku == null || x.sku === '' ? null : String(x.sku), ten: String(x.ten ?? ''), sl: Number(x.sl) || 0,
        doanhThu: so(x.doanhThu), ...(x.giaDon != null && Number.isFinite(Number(x.giaDon)) ? { giaDon: so(x.giaDon) } : {}),
        phi: x.phi == null ? null : so(x.phi), phiChung: so(x.phiChung),
        tyLePhi: x.tyLePhi == null || !Number.isFinite(Number(x.tyLePhi)) ? null : Number(x.tyLePhi),
        giaVon: so(x.giaVon), thieuGiaVon: !!x.thieuGiaVon, lai: so(x.lai), lo: !!x.lo, tamPhi: !!x.tamPhi, moTaPhi: String(x.moTaPhi ?? ''),
    }))
}

/** Ngành của từng dòng hàng — CÙNG cách nối dòng → listing của shopeeTuQuan.dongPhiTheoNganh (Shopee externalItemId = item_id;
 *  TikTok externalItemId là mã dòng đơn ⇒ nối thêm qua SKU / mã kho). Đọc hỏng ⇒ Map rỗng (mọi dòng "chưa rõ ngành"). */
async function docNganhDong(prisma: any, donIds: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>()
    const rows: any[] = await prisma.$queryRawUnsafe(`
        SELECT i.id,
               (SELECT p."categoryId" FROM "OnlineProduct" p
                 WHERE p."channelId" = o."channelId" AND p."categoryId" IS NOT NULL
                   AND (p."platformProductId" = i."externalItemId"
                        OR (i.sku IS NOT NULL AND i.sku <> '' AND LOWER(p.sku) = LOWER(i.sku))
                        OR (i."productId" IS NOT NULL AND p."localProductId" = i."productId"))
                 ORDER BY (p."platformProductId" = i."externalItemId") DESC
                 LIMIT 1) AS nganh
          FROM "OnlineOrderItem" i JOIN "OnlineOrder" o ON o.id = i."onlineOrderId"
         WHERE i."onlineOrderId" = ANY($1::text[])`, donIds).catch((e: any) => {
        console.warn('[LaiDuKien] không đọc được ngành của dòng hàng — tạm dùng phí cả gian:', String(e?.message || e).slice(0, 200))
        return []
    })
    for (const r of rows || []) {
        if (r?.nganh != null && String(r.nganh).trim()) out.set(String(r.id), String(r.nganh).trim())
    }
    return out
}

export interface KetQuaXetLai {
    /** đơn đưa vào tính (mới, chưa xét, không huỷ / kéo bù) */
    xet: number
    /** đơn ghi được dòng lãi dự kiến (giành được) */
    daLuu: number
    /** đơn lỗ dự kiến (CẢ ĐƠN) trong số đã lưu */
    lo: number
    /** đơn cả đơn còn lãi nhưng có SKU bán lỗ (19/11/2026) — cũng được báo */
    loSku: number
    /** dòng cũ (tính trước 19/11, chưa có chiTiet.dong) vừa được tính lại theo SKU — không báo lại */
    nangCap?: number
    /** đơn lỗ đã có tin báo trong app */
    daBao: number
    /** số thiết bị nhận push */
    push: number
    /** đơn bỏ qua: cũ hơn cửa sổ, huỷ, kéo bù, không phải đơn sàn, không dòng hàng */
    boQua: number
    /** đơn dòng hàng chưa mang giá — chưa lưu, xét lại lần sau */
    chuaCoGia: number
    /** đơn Shopee chưa đọc được escrow (Shopee chưa có / lỗi / proxy bận) mà còn mới — HOÃN, xét lại lần sau (21/11/2026) */
    choEscrow?: number
    loi?: string
    loiPush?: string
}

/** Đọc escrow của MỘT đơn Shopee: order_income | null (Shopee chưa có / không thấy đơn); NÉM khi token / hạn mức / mạng hỏng. */
export type DocEscrowDon = (ch: any, sn: string) => Promise<any | null>

/** Phí chung của gian cho đường escrow: biểu phí dịch vụ (trần, phí mỗi đơn) + phí bảo vệ vận chuyển dự kiến. null = chưa biết. */
export type PhiChungGian = { dichVu: PhiDichVu; baoVe: number } | null

export interface TuyChonXetLai {
    /** đường gọi — chỉ để ghi vào chiTiet / log */
    nguon?: 'webhook' | 'dong-bo' | 'dong-bo-tay'
    bayGio?: number
    /** bộ kiểm: bảng phí giả */
    docBang?: (prisma: any, ch: any) => Promise<Pick<BangPhiNganh, 'chon'>>
    /** bộ kiểm: push giả */
    guiPush?: (prisma: any, title: string, body: string, extra: { id?: string; type?: string; route?: string }) => Promise<number>
    /** đọc escrow Shopee (mặc định docEscrowShopee); null = không đọc — tính theo công thức như trước 21/11/2026 */
    docEscrow?: DocEscrowDon | null
    /** bộ kiểm: phí chung gian giả (mặc định: biểu phí Shopee đã lưu của gian) */
    docPhiChung?: (prisma: any, channelId: string) => Promise<PhiChungGian>
}

/** Đơn Shopee chưa đọc được escrow mà mới hơn ngần này ⇒ HOÃN (không lưu, push sau / lượt vét sau xét lại); cũ hơn ⇒ công thức. */
export const CHO_ESCROW_MS = 2 * 3600_000
/** Dòng Shopee đã lưu theo công thức, đơn đặt trong ngần này ⇒ lưới vét TÍNH LẠI theo escrow (Shopee chưa có ⇒ thôi, đánh dấu). */
export const CUA_SO_ESCROW_MS = 7 * 24 * 3600_000
/** Mỗi lượt tính: tối đa ngần này lời đọc escrow, trong ngần này thời gian; một lời đọc quá HAN_MOT_ESCROW_MS ⇒ thôi đọc lượt đó. */
export const TRAN_ESCROW_MOI_LUOT = 25
const HAN_ESCROW_MOI_LUOT_MS = 45_000
const HAN_MOT_ESCROW_MS = 12_000

/** Vì sao đơn Shopee KHÔNG tính theo escrow. Tạm (lượt sau thử lại): loi / qua-tai / het-luot. */
export type LyDoKhongEscrow = 'chua-co' | 'khong-uy-quyen' | 'loi' | 'qua-tai' | 'het-luot'
const LY_DO_TAM: LyDoKhongEscrow[] = ['loi', 'qua-tai', 'het-luot']
const CAU_LY_DO: Record<LyDoKhongEscrow, string> = {
    'chua-co': 'Shopee chưa có số của đơn', 'khong-uy-quyen': 'gian chưa uỷ quyền API', loi: 'lỗi khi hỏi Shopee',
    'qua-tai': 'đường gọi Shopee đang bận', 'het-luot': 'lượt này đã đọc đủ số đơn',
}

const escrowBat = () => process.env.LAI_DU_KIEN_ESCROW !== '0'

/** Đường thật: ShopeeService của gian — KHÔNG tự làm mới token ở đây (đồng bộ tự động làm; hai bên cùng làm mới là đá nhau). */
export const docEscrowShopee: DocEscrowDon = async (ch, sn) => {
    if (ch?.tokenExpiresAt && new Date(ch.tokenExpiresAt).getTime() < Date.now() + 5 * 60_000) {
        throw new Error('token gian sắp hết hạn — chờ đồng bộ làm mới')
    }
    const svc = new ShopeeService({
        apiKey: ch.apiKey || '', apiSecret: ch.apiSecret || '',
        accessToken: ch.accessToken || undefined, refreshToken: ch.refreshToken || undefined, shopId: ch.shopId || undefined,
    })
    return docEscrowQuaDichVu(svc)(sn)
}

/** Phí chung gian mặc định: biểu phí Shopee đã lưu (còn dùng được); chưa có ⇒ null (phí dịch vụ mặc định, không cộng bảo vệ). */
async function docPhiChungMacDinh(prisma: any, channelId: string): Promise<PhiChungGian> {
    const b = await docBieuPhi(prisma, channelId)
    return bieuPhiDungDuoc(b) ? { dichVu: b.dichVu, baoVe: Math.max(0, Math.round(b.baoVe) || 0) } : null
}

/** Chờ `p` tối đa `ms` — quá hạn thì NÉM (lời gọi vẫn chạy nốt ở tầng proxy, kết quả bỏ). */
function henGio<T>(p: Promise<T>, ms: number): Promise<T> {
    let h: any
    return Promise.race([p, new Promise<T>((_, rej) => { h = setTimeout(() => rej(new Error(`quá ${Math.round(ms / 1000)} giây`)), ms) })])
        .finally(() => clearTimeout(h))
}

/** Lỗi gọi sàn có thể kèm nguyên URL đã ký ⇒ che token / chữ ký / mã đơn trước khi ghi log (như bieuPhiShopee). */
const cheLoi = (e: any) => String(e?.message || e).replace(/\b(access_token|sign|order_sn|partner_key)=[^&\s"']+/gi, '$1=…').slice(0, 200)

/** Chọn trường đơn cần để tính — dùng chung cho đường báo động và các lệnh đo. */
export const CHON_DON_LAI_DU_KIEN = {
    id: true, orderNumber: true, externalOrderId: true, platform: true, status: true, note: true, subtotal: true, netRevenue: true,
    channelId: true, channelName: true, createdAt: true,
    items: { select: { id: true, productId: true, sku: true, quantity: true, lineTotal: true, externalItemId: true, productName: true } },
} as const

/** Đơn có được tính lãi dự kiến không: đơn sàn, có gian, không huỷ / hoàn, không kéo bù, có dòng hàng. */
export const donXetDuoc = (d: any): boolean =>
    SAN_XET.includes(String(d?.platform || '').toLowerCase()) && !!d?.channelId
    && !CANCELLED_STATUSES.includes(d.status) && !laDonKeoBu(d.note) && (d.items || []).length > 0

export interface LaiMotDon {
    k: LaiDuKien
    p: PhiDuKien
    dong: DongVaoLai[]
    /** lãi dự kiến TỪNG SKU (19/11/2026), đúng thứ tự `dong`; Σ = số cả đơn */
    laiDong: LaiDong[]
    /** các SKU CÓ GIÁ bán lỗ — chỉ khi đơn có ≥ 2 dòng có giá (đơn một dòng: SKU lỗ = cả đơn lỗ, khỏi nói hai lần) */
    skuLo: LaiDong[]
    /** nguồn escrow (21/11/2026): số Shopee báo lúc đọc — lưu vào chiTiet.escrow để soát lại */
    escrow?: EscrowDuKien
    /** đơn Shopee mà KHÔNG tính theo escrow: vì sao (tính theo công thức) */
    lyDoKhongEscrow?: LyDoKhongEscrow
}

/** Đệm bảng phí theo gian (5 phút, như đệm phí ngành của shopeeTuQuan): giờ livestream đơn về dồn dập, mỗi đơn đọc lại phí cả
 *  gian (truy vấn sổ 90 ngày) trên pool MỘT kết nối là giành chỗ của việc nhận đơn. Chỉ đệm lần đọc ĐƯỢC. */
const TTL_BANG_PHI = 5 * 60_000
const DEM_BANG_PHI = new WeakMap<object, Map<string, { het: number; bang: BangChonPhi }>>()

/** Dòng lãi theo SKU gọn để lưu vào chiTiet.dong (JSONB) — tối đa 40 dòng một đơn. */
const TRAN_DONG_LUU = 40
const gonDong = (x: LaiDong) => ({
    id: x.id, sku: x.sku, ten: x.ten.slice(0, 120), sl: x.sl, doanhThu: x.doanhThu, ...(x.giaDon != null ? { giaDon: x.giaDon } : {}),
    phi: x.phi, phiChung: x.phiChung, tyLePhi: x.tyLePhi,
    giaVon: x.giaVon, thieuGiaVon: x.thieuGiaVon, lai: x.lai, lo: x.lo, nganh: x.nganh, tamPhi: x.tamPhi, moTaPhi: x.moTaPhi.slice(0, 160),
})

/** chiTiet lưu kèm dòng LaiDuKienDon (đúng một chỗ dựng — đường xét đơn mới và đường tính lại theo SKU dùng chung). */
function dungChiTiet(kq: LaiMotDon, nguon: string | null, bay = Date.now()) {
    const e = kq.escrow
    return {
        moTaPhi: kq.p.moTa, tamPhi: kq.p.tam, nguon,
        nganh: [...new Set(kq.dong.map(x => x.nganh).filter(Boolean))].slice(0, 20),
        dong: kq.laiDong.slice(0, TRAN_DONG_LUU).map(gonDong),
        ...(kq.laiDong.length > TRAN_DONG_LUU ? { dongBiCat: kq.laiDong.length - TRAN_DONG_LUU } : {}),
        soSkuLo: kq.laiDong.filter(x => x.lo).length,
        // số Shopee báo lúc đọc (chỉ tiền, không thông tin khách) — để soát lại / so với số quyết toán
        ...(e ? { escrow: { luc: new Date(bay).toISOString(), Q: e.Q, escrow: e.escrow, ship: e.ship, baoVeChuaTru: e.baoVeChuaTru, thucNhan: e.thucNhan, khoan: e.khoan } } : {}),
        // không theo escrow: lý do KHÔNG tạm (chưa uỷ quyền, Shopee không có số sau hạn chờ) ⇒ escrowThu luôn, kẻo lưới vét nhặt
        // lại dòng này mỗi lượt; lý do tạm (lỗi, proxy bận, hết lượt) ⇒ để lưới vét thử lại
        ...(kq.lyDoKhongEscrow ? {
            lyDoKhongEscrow: kq.lyDoKhongEscrow,
            ...(LY_DO_TAM.includes(kq.lyDoKhongEscrow) ? {} : { escrowThu: new Date(bay).toISOString() }),
        } : {}),
    }
}

/**
 * TÍNH lãi dự kiến cho các đơn (đã chọn theo CHON_DON_LAI_DU_KIEN, đã lọc donXetDuoc) — CHỈ ĐỌC: ngành từng dòng, bảng phí
 * từng gian, giá vốn; đơn Shopee đọc thêm escrow (giá + phí thật, 21/11/2026 — xem đầu tệp). Gian đọc phí hỏng ⇒ đơn của gian đó
 * không có trong kết quả (bên gọi xét lại sau), `loi` nói vì sao. Đơn Shopee chưa đọc được escrow mà còn mới (< CHO_ESCROW_MS,
 * trừ gian chưa uỷ quyền) ⇒ nằm trong `hoan`, không có trong kết quả.
 */
export async function tinhLaiDuKien(prisma: any, dons: any[], o: Pick<TuyChonXetLai, 'docBang' | 'bayGio' | 'docEscrow' | 'docPhiChung'> = {}):
    Promise<{ ketQua: Map<string, LaiMotDon>; hoan: Set<string>; loi?: string }> {
    const ketQua = new Map<string, LaiMotDon>()
    const hoan = new Set<string>()
    let loi: string | undefined
    if (!dons?.length) return { ketQua, hoan }
    const nganhDong = await docNganhDong(prisma, dons.map(d => String(d.id)))

    const docBang = o.docBang || docMauPhiTheoNganh
    const bay = o.bayGio ?? Date.now()
    const docEscrow = o.docEscrow === undefined ? docEscrowShopee : o.docEscrow
    const coEscrow = !!docEscrow && escrowBat()
    const laShopee = (d: any) => String(d?.platform || '').toLowerCase() === 'shopee'
    let dem = DEM_BANG_PHI.get(prisma)
    if (!dem) { dem = new Map(); DEM_BANG_PHI.set(prisma, dem) }
    const kenhIds = [...new Set(dons.map(d => String(d.channelId)))]
    const bangTheoKenh = new Map<string, BangChonPhi>()
    for (const id of kenhIds) {
        const c = dem.get(id)
        if (c && c.het > bay) bangTheoKenh.set(id, c.bang)
    }
    // đọc dòng kênh: gian chưa có bảng phí trong đệm, và gian Shopee có đơn cần đọc escrow (token của gian)
    const canKenh = kenhIds.filter(id => !bangTheoKenh.has(id) || (coEscrow && dons.some(d => laShopee(d) && String(d.channelId) === id)))
    const kenhs: any[] = canKenh.length ? await prisma.onlineChannel.findMany({ where: { id: { in: canKenh } } }) : []
    const kenhTheoId = new Map<string, any>((kenhs || []).map((c: any) => [String(c.id), c]))
    for (const ch of kenhs || []) {
        if (bangTheoKenh.has(String(ch.id))) continue
        try {
            const bang = await docBang(prisma, ch)
            bangTheoKenh.set(String(ch.id), bang)
            dem.set(String(ch.id), { het: bay + TTL_BANG_PHI, bang })
        } catch (e: any) {
            // không đọc được phí ⇒ không tính đơn của gian này: lần sau (webhook đổi trạng thái / lượt đồng bộ) xét lại
            const moTa = String(e?.message || e).slice(0, 200)
            console.warn(`[LaiDuKien] ${ch.name || ch.id}: không đọc được bảng phí — chưa tính lãi dự kiến:`, moTa)
            if (!loi) loi = `đọc phí ${ch.name || ch.id}: ${moTa}`
        }
    }

    const von = await computeOrderProfits(prisma, dons)
    const docPhiChung = o.docPhiChung || docPhiChungMacDinh
    const phiChungTheoKenh = new Map<string, PhiChungGian>()
    const batDau = Date.now()
    let soDoc = 0, thoiDoc = false
    for (const d of dons) {
        const bang = bangTheoKenh.get(String(d.channelId))
        if (!bang) continue
        const dong: DongVaoLai[] = (d.items || []).map((i: any) => ({
            id: String(i.id), sku: i.sku ? String(i.sku) : null, ten: String(i.productName || ''), sl: Number(i.quantity) || 0,
            gia: Number(i.lineTotal) || 0, nganh: nganhDong.get(String(i.id)) ?? null,
            itemId: i.externalItemId == null || i.externalItemId === '' ? null : String(i.externalItemId),
        }))
        const v = von.get(d.id) || { cost: 0, missingCost: true }

        /* Shopee: giá + phí THẬT từ escrow. Đọc TUẦN TỰ, trần lượt + hạn giờ; proxy quá tải ⇒ nhường (việc nhận đơn quan trọng
         * hơn). Một lời đọc NÉM (token / hạn mức / mạng / quá giờ) ⇒ thôi đọc cả lượt — đọc tiếp chỉ tốn lượt gọi. */
        let lyDo: LyDoKhongEscrow | undefined
        if (coEscrow && laShopee(d)) {
            const ch = kenhTheoId.get(String(d.channelId))
            const sn = String(d.externalOrderId || '').trim() || String(d.orderNumber || '').replace(/^SPE-/i, '').trim()
            if (!ch?.accessToken || !ch?.shopId || !sn) lyDo = 'khong-uy-quyen'
            else if (thoiDoc || soDoc >= TRAN_ESCROW_MOI_LUOT || Date.now() - batDau > HAN_ESCROW_MOI_LUOT_MS) lyDo = 'het-luot'
            else if (proxyCircuitOpen() || proxyDangQuaTai()) lyDo = 'qua-tai'
            else {
                soDoc++
                try {
                    const inc = await henGio(docEscrow!(ch, sn), HAN_MOT_ESCROW_MS)
                    let pc = phiChungTheoKenh.get(String(ch.id))
                    if (pc === undefined) {
                        pc = await docPhiChung(prisma, String(ch.id)).catch(() => null)
                        phiChungTheoKenh.set(String(ch.id), pc)
                    }
                    const e = docEscrowDuKien(inc, pc?.baoVe ?? 0)
                    if (e) {
                        const t = escrowTheoSku(dong, e, bang, v, pc?.dichVu)
                        const coGia = t.laiDong.filter(x => x.doanhThu > 0)
                        ketQua.set(String(d.id), {
                            k: ketLuanLaiDuKien(t.doanhThu, t.p, v), p: t.p, dong, laiDong: t.laiDong,
                            skuLo: coGia.length > 1 ? coGia.filter(x => x.lo) : [], escrow: e,
                        })
                        continue
                    }
                    lyDo = 'chua-co'
                } catch (err: any) {
                    lyDo = 'loi'
                    thoiDoc = true
                    const moTa = cheLoi(err)
                    console.warn(`[LaiDuKien] ${ch.name || ch.id}: chưa đọc được escrow — ${moTa}`)
                    if (!loi) loi = `đọc escrow ${ch.name || ch.id}: ${moTa}`
                }
            }
            // chưa đọc được mà đơn còn mới ⇒ hoãn (push sau / lượt vét sau đọc lại); gian chưa uỷ quyền thì chờ cũng vô ích
            if (lyDo !== 'khong-uy-quyen' && bay - new Date(d.createdAt).getTime() < CHO_ESCROW_MS) { hoan.add(String(d.id)); continue }
        }

        const p0 = phiDuKienCuaDon(dong, bang)
        const p = lyDo && lyDo !== 'khong-uy-quyen' && p0.phi != null
            ? { ...p0, moTa: `${p0.moTa} — chưa đọc được phí thật Shopee của đơn (${CAU_LY_DO[lyDo]}), tạm theo biểu phí` } : p0
        const laiDong = laiTungDong(dong, bang, p, v)
        const coGia = laiDong.filter(x => x.doanhThu > 0)
        ketQua.set(String(d.id), {
            k: ketLuanLaiDuKien(dong.reduce((s, x) => s + Math.max(0, x.gia), 0), p, v), p, dong, laiDong,
            skuLo: coGia.length > 1 ? coGia.filter(x => x.lo) : [],
            ...(lyDo ? { lyDoKhongEscrow: lyDo } : {}),
        })
    }
    return { ketQua, hoan, ...(loi ? { loi } : {}) }
}

/**
 * Tính lãi dự kiến cho các đơn sàn vừa về và BÁO ĐỘNG đơn lỗ. Gọi lặp lại vô hại: đơn đã xét (bởi bất kỳ bản nào) bị bỏ ngay
 * bằng MỘT truy vấn khoá chính. Không ném vì từng đơn — lỗi đọc phí của một gian chỉ làm đơn gian đó chưa được lưu (lần
 * sau xét lại). Bên gọi vẫn PHẢI bọc try/catch: hàm này không được làm hỏng việc nhận đơn.
 */
export async function xetLaiDuKienDonMoi(prisma: any, orderIds: string[], o: TuyChonXetLai = {}): Promise<KetQuaXetLai> {
    const ra: KetQuaXetLai = { xet: 0, daLuu: 0, lo: 0, loSku: 0, daBao: 0, push: 0, boQua: 0, chuaCoGia: 0 }
    const ids = [...new Set((orderIds || []).filter(Boolean).map(String))]
    if (!ids.length) return ra
    const bay = o.bayGio ?? Date.now()
    await damBaoBang(prisma)

    const daCo: any[] = await prisma.$queryRawUnsafe(`SELECT "orderId" FROM "LaiDuKienDon" WHERE "orderId" = ANY($1::text[])`, ids)
    const daXet = new Set((daCo || []).map(r => String(r.orderId)))
    const can = ids.filter(id => !daXet.has(id))
    if (!can.length) return ra

    const tatCa: any[] = await prisma.onlineOrder.findMany({
        where: { id: { in: can }, createdAt: { gte: new Date(bay - CUA_SO_DON_MOI_MS) } },
        select: CHON_DON_LAI_DU_KIEN,
    })
    const dons = (tatCa || []).filter(donXetDuoc)
    ra.boQua = can.length - dons.length
    ra.xet = dons.length
    if (!dons.length) return ra

    const tinh = await tinhLaiDuKien(prisma, dons, o)
    if (tinh.loi) ra.loi = tinh.loi
    // Shopee chưa đọc được escrow mà đơn còn mới ⇒ chưa lưu (push đổi trạng thái / lượt vét sau đọc lại)
    if (tinh.hoan.size) ra.choEscrow = tinh.hoan.size

    const lo: { id: string; ma: string; san: string; kenh: string | null; hang: string; k: LaiDuKien; skuLo: LaiDong[]; soLo: number }[] = []
    for (const d of dons) {
        const kq = tinh.ketQua.get(String(d.id))
        if (!kq) continue
        const { k, skuLo } = kq
        // dòng hàng chưa mang giá (sàn trả giá sau) ⇒ chưa lưu: lần webhook / lượt vét sau tính lại khi đã có giá
        if (k.doanhThu <= 0) { ra.chuaCoGia++; continue }
        const chiTiet = dungChiTiet(kq, o.nguon || null, bay)
        let gianh: any[] = []
        try {
            gianh = await prisma.$queryRawUnsafe(
                `INSERT INTO "LaiDuKienDon" ("orderId", "doanhThu", "phiDuKien", "giaVon", "lai", "thieuGiaVon", "nguonPhi", "chiTiet")
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
                 ON CONFLICT ("orderId") DO NOTHING RETURNING "orderId"`,
                String(d.id), k.doanhThu, k.phi, k.giaVon, k.lai, k.thieuGiaVon, k.nguonPhi, JSON.stringify(chiTiet))
        } catch (e: any) {
            if (!ra.loi) ra.loi = `ghi lãi dự kiến: ${String(e?.message || e).slice(0, 200)}`
            continue
        }
        if (!gianh?.length) continue      // bản khác vừa xét đơn này
        ra.daLuu++
        if (k.lo) ra.lo++
        else if (skuLo.length) ra.loSku++
        // báo: cả đơn lỗ, HOẶC cả đơn lãi mà có SKU bán lỗ (19/11/2026 — mặt hàng khác gánh thì không ai thấy)
        if (k.lo || skuLo.length) {
            lo.push({
                id: String(d.id), ma: String(d.orderNumber || d.id), san: String(d.platform || ''), kenh: d.channelName || null,
                hang: tenHangChinh(d.items), k, skuLo, soLo: soLoBao(k, skuLo),
            })
        }
    }
    if (lo.length) console.log(`[LaiDuKien] ${lo.length} đơn mới dự kiến LỖ (${ra.lo} cả đơn, ${ra.loSku} chỉ SKU — ${o.nguon || '?'}): ` +
        lo.slice(0, 5).map(x => `${x.ma} ${x.soLo}`).join(' · '))
    if (!lo.length || process.env.BAO_DONG_LO_DU_KIEN === '0') return ra

    lo.sort((a, b) => a.soLo - b.soLo)   // lỗ nặng nhất lên đầu
    const bayGio = new Date(bay)
    const idTin: string[] = []
    const daBao: typeof lo = []
    /* Mỗi đơn một tin (bấm vào thấy đúng đơn); mẻ lớn (lượt đồng bộ vớt nhiều đơn) gộp một tin. Ghi tin hỏng ⇒ GỠ dòng giành
     * của đơn đó: dấu "đã xét" mà không có tin nào thì đơn lỗ biến mất im lặng — để lần sau xét lại còn hơn. */
    const ganTen = (x: (typeof lo)[number]) => {
        // cả đơn lỗ ⇒ tên hàng chính; chỉ SKU lỗ ⇒ tên SKU lỗ (đúng mặt hàng cần xem lại giá)
        const hang = x.k.lo ? x.hang : (x.skuLo[0] ? tenSkuNgan(x.skuLo[0], 40) + (x.skuLo.length > 1 ? ` +${x.skuLo.length - 1} SKU` : '') : x.hang)
        return `${x.ma} ${vnd(x.soLo)}${x.k.lo ? '' : ' ở SKU'}${hang ? ` (${hang.length > 40 ? `${hang.slice(0, 39).trimEnd()}…` : hang})` : ''}`
    }
    /** tiêu đề tin gộp: nói rõ đơn nào chỉ lỗ ở SKU (cả đơn vẫn lãi) */
    const tieuDeGop = (ds: typeof lo) => {
        const chiSku = ds.filter(x => !x.k.lo).length
        return chiSku === ds.length ? `🚨 ${ds.length} đơn mới có SKU dự kiến LỖ`
            : `🚨 ${ds.length} đơn mới dự kiến LỖ${chiSku ? ` (${chiSku} đơn chỉ lỗ ở SKU)` : ''}`
    }
    if (lo.length > NGUONG_GOP) {
        const ds = lo.slice(0, NGUONG_GOP).map(ganTen).join(' · ')
        try {
            const tin = await prisma.notification.create({
                data: {
                    title: tieuDeGop(lo),
                    message: `Lỗ nặng nhất: ${ds} (+${lo.length - NGUONG_GOP} đơn nữa). Vào Đơn hàng online xem cột Lợi nhuận (dự kiến) — xem lại giá bán trên sàn / giá vốn để đơn sau không lỗ tiếp.`,
                    type: 'loi_nhuan_thap',
                },
            })
            if (tin?.id) idTin.push(String(tin.id))
            daBao.push(...lo)
        } catch (e: any) {
            if (!ra.loi) ra.loi = `ghi tin: ${String(e?.message || e).slice(0, 200)}`
        }
    } else {
        for (const x of lo) {
            const t = tinBaoLo({ ma: x.ma, san: x.san, kenh: x.kenh, hang: x.hang }, x.k, x.skuLo)
            try {
                const tin = await prisma.notification.create({ data: { title: t.tieuDe, message: t.noiDung, type: 'loi_nhuan_thap' } })
                if (tin?.id) idTin.push(String(tin.id))
                daBao.push(x)
            } catch (e: any) {
                if (!ra.loi) ra.loi = `ghi tin: ${String(e?.message || e).slice(0, 200)}`
            }
        }
    }
    const hong = lo.filter(x => !daBao.includes(x)).map(x => x.id)
    if (hong.length) {
        await prisma.$executeRawUnsafe(`DELETE FROM "LaiDuKienDon" WHERE "orderId" = ANY($1::text[]) AND "baoLuc" IS NULL`, hong).catch(() => { })
        ra.daLuu -= hong.length
    }
    ra.daBao = daBao.length
    if (!daBao.length) return ra
    await prisma.$executeRawUnsafe(`UPDATE "LaiDuKienDon" SET "baoLuc" = $2 WHERE "orderId" = ANY($1::text[])`,
        daBao.map(x => x.id), bayGio).catch(() => { })

    /* MỘT push cho cả mẻ, nói về ĐÚNG những đơn đã có tin. */
    const dau = daBao[0]!
    const { tieuDe, noiDung } = daBao.length === 1
        ? tinBaoLo({ ma: dau.ma, san: dau.san, kenh: dau.kenh, hang: dau.hang }, dau.k, dau.skuLo)
        : {
            tieuDe: tieuDeGop(daBao),
            noiDung: `${daBao.slice(0, 3).map(ganTen).join(' · ')}${daBao.length > 3 ? ` (+${daBao.length - 3} đơn nữa)` : ''}. ` +
                'Xem lại giá bán trên sàn / giá vốn để đơn sau không lỗ tiếp.',
        }
    try {
        const gui = o.guiPush || (await import('../routes/notifications')).sendPushToStore
        ra.push = await gui(prisma, tieuDe, noiDung, { id: idTin.join(','), type: 'loi_nhuan_thap', route: 'online-orders' })
    } catch (e: any) { ra.push = 0; ra.loiPush = String(e?.message || e).slice(0, 160) }
    return ra
}

/** Gọi từ đường NHẬN đơn (webhook): KHÔNG BAO GIỜ ném — tính lãi hỏng không được làm hỏng việc nhận đơn; lỗi ghi log. */
export async function xetLaiDuKienAnToan(prisma: any, orderIds: string[], nguon: NonNullable<TuyChonXetLai['nguon']>, o: TuyChonXetLai = {}): Promise<KetQuaXetLai | null> {
    try {
        const r = await xetLaiDuKienDonMoi(prisma, orderIds, { ...o, nguon })
        if (r.loi || r.loiPush) console.warn(`[LaiDuKien] ${nguon}: ${r.loi || ''}${r.loiPush ? ` · push: ${r.loiPush}` : ''}`)
        return r
    } catch (e: any) {
        console.warn(`[LaiDuKien] ${nguon}: chưa tính được lãi dự kiến —`, String(e?.message || e).slice(0, 200))
        return null
    }
}

/**
 * LƯỚI VÉT — lượt đồng bộ (cron 30' / bấm tay) gọi cho TỪNG kênh: đơn ≤ 24 giờ chưa có dòng lãi dự kiến (vừa kéo về ở lượt
 * này; webhook lỡ vì máy tắt giữa chừng / đọc phí hỏng / escrow hoãn; Lazada chưa có webhook) ⇒ xét. Đơn đã xét bị loại ngay
 * trong SQL nên lượt không có đơn mới chỉ tốn MỘT truy vấn. Không ném.
 */
export async function vetLaiDuKienDonMoi(prisma: any, kenh: { id: string; platform?: string | null } | null, nguon: NonNullable<TuyChonXetLai['nguon']>, o: TuyChonXetLai = {}): Promise<KetQuaXetLai | null> {
    try {
        if (kenh && !SAN_XET.includes(String(kenh.platform || '').toLowerCase())) return null
        await damBaoBang(prisma)
        const bay = o.bayGio ?? Date.now()
        const coEscrow = o.docEscrow !== null && escrowBat()
        const thamSo: any[] = [new Date(bay - CUA_SO_DON_MOI_MS), SAN_XET, CANCELLED_STATUSES, new Date(bay - CUA_SO_NANG_CAP_MS), new Date(bay - CUA_SO_ESCROW_MS)]
        if (kenh) thamSo.push(String(kenh.id))
        /* MỘT truy vấn cho cả ba việc: đơn ≤ 24 giờ CHƯA có dòng (xét + báo); dòng ≤ 3 ngày tính trước khi có theo SKU (chiTiet.dong
         * chưa có ⇒ tính lại theo SKU); dòng Shopee ≤ 7 ngày đã theo SKU mà CHƯA theo escrow, chưa thử (chiTiet.escrowThu) ⇒ tính
         * lại theo escrow. Tính lại KHÔNG báo lại. Lượt không có gì mới vẫn chỉ tốn một truy vấn. */
        const rows: any[] = await prisma.$queryRawUnsafe(
            `SELECT o.id, (l."orderId" IS NOT NULL) AS "daCo", ((l."chiTiet" -> 'dong') IS NULL) AS "thieuDong"
               FROM "OnlineOrder" o LEFT JOIN "LaiDuKienDon" l ON l."orderId" = o.id
              WHERE o."createdAt" >= LEAST($4, $5) AND LOWER(o.platform) = ANY($2::text[]) AND NOT (o.status = ANY($3::text[]))
                ${kenh ? 'AND o."channelId" = $6' : ''}
                AND ((l."orderId" IS NULL AND o."createdAt" >= $1)
                     OR (l."orderId" IS NOT NULL AND (l."chiTiet" -> 'dong') IS NULL AND o."createdAt" >= $4)${coEscrow ? `
                     OR (l."orderId" IS NOT NULL AND LOWER(o.platform) = 'shopee' AND l."nguonPhi" <> 'escrow' AND o."createdAt" >= $5
                         AND (l."chiTiet" -> 'dong') IS NOT NULL AND (l."chiTiet" -> 'dong') <> '[]'::jsonb AND (l."chiTiet" -> 'escrowThu') IS NULL)` : ''})
              ORDER BY (l."orderId" IS NULL) DESC, o."createdAt" DESC LIMIT 500`, ...thamSo)
        const moi = (rows || []).filter(r => !r.daCo).map(r => String(r.id))
        const cuSku = (rows || []).filter(r => r.daCo && r.thieuDong).map(r => String(r.id)).slice(0, TRAN_NANG_CAP_MOI_LUOT)
        const cuEscrow = (rows || []).filter(r => r.daCo && !r.thieuDong).map(r => String(r.id)).slice(0, TRAN_ESCROW_MOI_LUOT)
        const ra = moi.length ? await xetLaiDuKienAnToan(prisma, moi, nguon, o) : null
        if (!cuSku.length && !cuEscrow.length) return ra
        const n = await tinhLaiDongCu(prisma, cuSku, cuEscrow, o).catch((e: any) => {
            console.warn(`[LaiDuKien] tính lại dòng cũ (${nguon}):`, String(e?.message || e).slice(0, 200))
            return 0
        })
        return ra ? { ...ra, nangCap: n } : { xet: 0, daLuu: 0, lo: 0, loSku: 0, daBao: 0, push: 0, boQua: 0, chuaCoGia: 0, nangCap: n }
    } catch (e: any) {
        console.warn(`[LaiDuKien] vét (${nguon}): chưa tính được lãi dự kiến —`, String(e?.message || e).slice(0, 200))
        return null
    }
}

/** Dòng tính trước khi có theo SKU (19/11/2026) được tính lại trong ngần này kể từ lúc khách đặt — đơn cũ hơn đa phần đã quyết toán. */
export const CUA_SO_NANG_CAP_MS = 3 * 24 * 3600_000
const TRAN_NANG_CAP_MOI_LUOT = 200

/** Dòng Shopee thôi thử escrow (Shopee chưa có / gian chưa uỷ quyền / đơn không còn tính được) — lưới vét không nhặt lại. */
const danhDauEscrow = (prisma: any, id: string, luc: string, lyDo: string) => prisma.$executeRawUnsafe(
    `UPDATE "LaiDuKienDon" SET "chiTiet" = COALESCE("chiTiet", '{}'::jsonb) || $2::jsonb WHERE "orderId" = $1 AND "nguonPhi" <> 'escrow'`,
    id, JSON.stringify({ escrowThu: luc, lyDoKhongEscrow: lyDo })).catch(() => 0)

/**
 * TÍNH LẠI các dòng LaiDuKienDon cũ — `sku`: chưa có theo SKU (chiTiet.dong); `escrow`: đơn Shopee đã theo SKU mà chưa theo escrow.
 * Ghi đè số cả đơn + chiTiet bằng phép tính mới (Σ SKU = cả đơn; Shopee đọc được escrow ⇒ giá + phí thật), GIỮ baoLuc + nguồn
 * cũ, KHÔNG báo (đơn đã qua lúc "mới về"). Đơn không còn tính được (huỷ / hết dòng / chưa có giá) ⇒ dòng chưa theo SKU ghi
 * chiTiet.dong = [], dòng chờ escrow ghi chiTiet.escrowThu — lưới vét thôi nhặt lại. Gian đọc phí hỏng / escrow hoãn / lý do tạm
 * (lỗi, proxy bận, hết lượt) ⇒ để nguyên, lượt sau thử lại. Trả số dòng đã tính lại.
 */
async function tinhLaiDongCu(prisma: any, sku: string[], escrow: string[], o: TuyChonXetLai): Promise<number> {
    const orderIds = [...new Set([...sku, ...escrow])]
    if (!orderIds.length) return 0
    const thieuDong = new Set(sku)
    const luc = new Date(o.bayGio ?? Date.now()).toISOString()
    const tatCa: any[] = await prisma.onlineOrder.findMany({ where: { id: { in: orderIds } }, select: CHON_DON_LAI_DU_KIEN })
    const dons = (tatCa || []).filter(donXetDuoc)
    const tinh = dons.length ? await tinhLaiDuKien(prisma, dons, o) : { ketQua: new Map<string, LaiMotDon>(), hoan: new Set<string>() }
    let n = 0
    const boCuoc: string[] = []
    for (const id of orderIds) {
        const d = dons.find(x => String(x.id) === id)
        const kq = d ? tinh.ketQua.get(id) : undefined
        if (d && !kq) continue                                    // đọc phí gian hỏng / escrow hoãn ⇒ lượt sau
        if (!kq || kq.k.doanhThu <= 0) {
            if (thieuDong.has(id)) boCuoc.push(id)
            else await danhDauEscrow(prisma, id, luc, 'khong-tinh-duoc')
            continue
        }
        const tam = !!kq.lyDoKhongEscrow && LY_DO_TAM.includes(kq.lyDoKhongEscrow)
        if (!kq.escrow && !thieuDong.has(id)) {
            // đã theo SKU, escrow vẫn chưa đọc được: lý do tạm ⇒ lượt sau; không thì thôi thử
            if (!tam) await danhDauEscrow(prisma, id, luc, kq.lyDoKhongEscrow || 'khong-doc')
            continue
        }
        const { k } = kq
        const chiTiet: any = { ...dungChiTiet(kq, null, o.bayGio ?? Date.now()), [kq.escrow ? 'tinhLaiTheoEscrow' : 'tinhLaiTheoSku']: luc }
        delete chiTiet.nguon                                      // giữ nguồn cũ (webhook / đồng bộ) của lần xét đầu
        if (kq.escrow) chiTiet.lyDoKhongEscrow = null              // (escrowThu: dungChiTiet đã ghi khi lý do không tạm)
        const so = await prisma.$executeRawUnsafe(
            `UPDATE "LaiDuKienDon" SET "doanhThu" = $2, "phiDuKien" = $3, "giaVon" = $4, "lai" = $5, "thieuGiaVon" = $6, "nguonPhi" = $7,
                    "chiTiet" = COALESCE("chiTiet", '{}'::jsonb) || $8::jsonb
              WHERE "orderId" = $1 AND (("chiTiet" -> 'dong') IS NULL OR "nguonPhi" <> 'escrow')`,
            id, k.doanhThu, k.phi, k.giaVon, k.lai, k.thieuGiaVon, k.nguonPhi, JSON.stringify(chiTiet))
        n += Number(so) || 0
    }
    if (boCuoc.length) {
        await prisma.$executeRawUnsafe(
            `UPDATE "LaiDuKienDon" SET "chiTiet" = COALESCE("chiTiet", '{}'::jsonb) || '{"dong": []}'::jsonb
              WHERE "orderId" = ANY($1::text[]) AND ("chiTiet" -> 'dong') IS NULL`, boCuoc)
    }
    return n
}
