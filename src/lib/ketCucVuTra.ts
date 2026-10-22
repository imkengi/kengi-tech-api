// ─────────────────────────────────────────────────────────────────────────────
//  KẾT CỤC VỤ TRẢ HÀNG / HOÀN TIỀN (22/10/2026)
//
//  Chủ shop: "trong phần trả hàng hoàn tiền chưa phân loại được các đơn bị sàn từ chối trả
//  hàng hoàn tiền". Trạng thái app chỉ có 4 nấc, và nấc 'rejected' gom chung những chuyện
//  khác hẳn nhau. ĐO 22/10/2026 KENGISTORE (698 phiếu sàn, chuỗi trạng thái gốc trong ghi chú):
//    · Shopee CLOSED 42 — 34 vụ sau khi shop khiếu nại (PROCESSING → [Khiếu nại] → CLOSED…)
//      ⇒ sàn ĐÓNG yêu cầu, khách không được hoàn
//    · Shopee JUDGING → CANCELLED 9 — huỷ đúng lúc Shopee đang xét khiếu nại của shop
//    · Shopee CANCELLED không qua khiếu nại 64, TikTok CANCEL 25 (17 vụ đã duyệt mà khách
//      không gửi hàng) ⇒ khách huỷ
//    · TikTok REFUND_OR_RETURN_REQUEST_REJECT 4 + REJECT_RECEIVE_PACKAGE 1 — shop từ chối,
//      khách không đưa lên sàn
//  Tài liệu Shopee (Data Definition › ReturnStatus) chỉ liệt kê tên, không giải nghĩa — luật
//  dưới đây dựa trên chuỗi đo được. Bộ lọc "Đã hoàn" cũ chỉ lấy 'refunded' (108 phiếu TikTok)
//  trong khi thẻ "Đã hoàn" đếm cả 'approved' (425 Shopee ACCEPTED) — nay cả hai đọc chung hàm này.
//
//  Đọc đúng những dòng returnSync / route khiếu nại ghi vào ghi chú: "[Shopee] MÃ (giờ)",
//  "[TikTok] Status: MÃ", "[Khiếu nại] …", "[Từ chối TikTok] …", "[Tranh chấp TikTok] MÃ …".
//  THUẦN (không DB) để danh sách, bộ lọc, thống kê và bộ kiểm chứng dùng chung một luật.
// ─────────────────────────────────────────────────────────────────────────────

import { DAU_TU_CHOI_TT, DAU_TRANH_CHAP_TT } from './bangChungTikTok'

export const KET_CUC_VU_TRA = ['cho_xu_ly', 'dang_khieu_nai', 'khach_duoc_hoan', 'san_tu_choi', 'shop_tu_choi', 'khach_huy'] as const
export type KetCucVuTra = typeof KET_CUC_VU_TRA[number]
export const laKetCucVuTra = (v: unknown): v is KetCucVuTra =>
    typeof v === 'string' && (KET_CUC_VU_TRA as readonly string[]).includes(v)

export interface PhieuTraKetCuc {
    code: string
    status: string
    notes?: string | null
}

export interface KetQuaKetCuc {
    ketCuc: KetCucVuTra
    /** Một câu nói rõ vì sao — hiện ngay trên thẻ phiếu */
    chiTiet: string
}

/** Mã gốc là PHÁN QUYẾT / kết thúc một bước xét — cùng bộ mã với phanQuyet ở viecVuTra. */
const MA_PHAN_QUYET = /REFUND_PAID|SUCCESS|COMPLETE|^ACCEPTED$|AWAITING_BUYER_SHIP|BUYER_SHIPPED_ITEM|CLOS|CANCEL|REJECT/
const MA_DANG_XET = /^(SELLER_DISPUTE|JUDGING)$/
const DONG_SAN = /^\[(?:Shopee|TikTok)\]\s*(?:Status:\s*)?([A-Z_]+)/

interface DienBien {
    /** mã gốc cuối cùng của sàn */
    goc: string
    /** trạng thái tranh chấp TikTok cuối cùng */
    tranhChap: string | null
    /** đang có lượt khiếu nại / tranh chấp chưa có phán quyết */
    dangXet: boolean
    /** mã gốc cuối đến ĐÚNG LÚC đang xét khiếu nại (vd JUDGING → CANCELLED) */
    cuoiKhiDangXet: boolean
    /** từng khiếu nại (app hay Seller Center) / tranh chấp */
    tungKhieuNai: boolean
    /** shop từng từ chối (TikTok) */
    tungTuChoi: boolean
    /** TikTok từng duyệt, chờ khách gửi hàng */
    tungChoGuiHang: boolean
}

/** Đọc ghi chú THEO THỨ TỰ dòng: mã gốc, lượt khiếu nại, tranh chấp. */
function docDienBien(notes?: string | null): DienBien {
    const kq: DienBien = { goc: '', tranhChap: null, dangXet: false, cuoiKhiDangXet: false, tungKhieuNai: false, tungTuChoi: false, tungChoGuiHang: false }
    for (const tho of String(notes || '').split(/\r?\n/)) {
        const d = tho.trim()
        if (d.startsWith('[Khiếu nại]') || d.startsWith(DAU_TU_CHOI_TT)) {
            kq.dangXet = true
            kq.tungKhieuNai = true
            if (d.startsWith(DAU_TU_CHOI_TT)) kq.tungTuChoi = true
            continue
        }
        if (d.startsWith(DAU_TRANH_CHAP_TT)) {
            const ma = (/^\S+/.exec(d.slice(DAU_TRANH_CHAP_TT.length).trim()) || [])[0] || null
            kq.tranhChap = ma
            kq.tungKhieuNai = true
            kq.dangXet = ma === 'IN_PROGRESS'
            continue
        }
        const m = DONG_SAN.exec(d)
        if (!m) continue
        const ma = m[1] || ''
        if (MA_DANG_XET.test(ma)) {
            kq.dangXet = true
            kq.tungKhieuNai = true
            kq.goc = ma
            continue
        }
        if (/REJECT/.test(ma)) kq.tungTuChoi = true
        if (/AWAITING_BUYER_SHIP/.test(ma)) kq.tungChoGuiHang = true
        kq.cuoiKhiDangXet = kq.dangXet
        if (MA_PHAN_QUYET.test(ma)) kq.dangXet = false
        kq.goc = ma
    }
    return kq
}

/** Kết cục MỘT phiếu trả — nhìn từ túi tiền cửa hàng. */
export function ketCucVuTra(p: PhieuTraKetCuc): KetQuaKetCuc {
    const db = docDienBien(p.notes)
    const { goc, tranhChap } = db
    const tiktok = p.code.startsWith('RTN-TT-')
    const san = tiktok ? 'TikTok' : 'Shopee'

    // 1. Tiền đã ra — app đã ghi hoàn, hoặc sàn báo đã hoàn
    if (p.status === 'refunded' || /REFUND_PAID|SUCCESS|COMPLETE/.test(goc)) {
        return {
            ketCuc: 'khach_duoc_hoan',
            chiTiet: tranhChap === 'SUPPORT_BUYER' ? `${san} xử cho khách — đã hoàn tiền`
                : db.tungKhieuNai ? 'khiếu nại thua — đã hoàn tiền cho khách'
                    : 'đã hoàn tiền cho khách',
        }
    }
    // 2. Sàn đã phân xử tranh chấp (TikTok)
    if (tranhChap === 'SUPPORT_SELLER') return { ketCuc: 'san_tu_choi', chiTiet: `${san} xử cho shop — khách không được hoàn` }
    if (tranhChap === 'SUPPORT_BUYER') return { ketCuc: 'khach_duoc_hoan', chiTiet: `${san} xử cho khách — sắp hoàn tiền` }
    // 3. Đang có lượt khiếu nại / tranh chấp chưa phân xử
    if (db.dangXet) {
        return {
            ketCuc: 'dang_khieu_nai',
            chiTiet: tranhChap === 'IN_PROGRESS' ? `khách đưa vụ lên ${san} — sàn đang phân xử`
                : goc === 'JUDGING' ? `${san} đang xét khiếu nại`
                    : 'đã khiếu nại — chờ sàn phân xử',
        }
    }
    // 4. Sàn ĐÓNG yêu cầu (Shopee CLOSED)
    if (/CLOS/.test(goc)) {
        return {
            ketCuc: 'san_tu_choi',
            chiTiet: db.cuoiKhiDangXet ? `${san} đóng yêu cầu sau khiếu nại — khách không được hoàn`
                : `${san} đóng yêu cầu — khách không được hoàn`,
        }
    }
    // 5. Huỷ
    if (/CANCEL/.test(goc)) {
        if (db.cuoiKhiDangXet) return { ketCuc: 'san_tu_choi', chiTiet: `yêu cầu bị huỷ khi ${san} đang xét khiếu nại — khách không được hoàn` }
        if (tiktok && db.tungTuChoi) return { ketCuc: 'shop_tu_choi', chiTiet: 'shop từ chối — yêu cầu đã huỷ' }
        if (db.tungChoGuiHang) return { ketCuc: 'khach_huy', chiTiet: 'đã duyệt nhưng khách không gửi hàng — yêu cầu huỷ' }
        return { ketCuc: 'khach_huy', chiTiet: 'khách huỷ yêu cầu' }
    }
    // 6. Shop từ chối (TikTok), khách không đưa lên sàn — cả tên cũ lẫn tên mới (REQUEST_REJECTED / RECEIVE_REJECTED)
    if (/REJECT/.test(goc)) {
        return { ketCuc: 'shop_tu_choi', chiTiet: /RECEIVE/.test(goc) ? 'shop từ chối nhận bưu kiện trả' : 'shop từ chối yêu cầu' }
    }
    // 7. Khách đã gửi hàng về — TikTok chờ shop nhận bưu kiện hoặc kháng nghị
    if (/BUYER_SHIPPED_ITEM/.test(goc)) return { ketCuc: 'cho_xu_ly', chiTiet: 'khách đã gửi hàng về — chờ shop nhận bưu kiện hoặc kháng nghị' }
    // 8. Đã chấp nhận, tiền chưa ra
    if (/^ACCEPTED$|AWAITING_BUYER_SHIP/.test(goc) || p.status === 'approved' || p.status === 'exchanged') {
        return {
            ketCuc: 'khach_duoc_hoan',
            chiTiet: /AWAITING_BUYER_SHIP/.test(goc) ? 'đã duyệt — chờ khách gửi hàng'
                : p.status === 'exchanged' ? 'đã đổi hàng cho khách'
                    : db.tungKhieuNai ? 'khiếu nại thua — sàn cho khách trả/hoàn'
                        : 'đã chấp nhận trả hàng / hoàn tiền',
        }
    }
    // 9. Từ chối trong Kengi (phiếu nhập tay / không có mã sàn)
    if (p.status === 'rejected') return { ketCuc: 'shop_tu_choi', chiTiet: 'đã từ chối trong Kengi' }
    // 10. Còn lại: yêu cầu đang mở, chưa ai quyết
    return {
        ketCuc: 'cho_xu_ly',
        chiTiet: /REQUESTED|PENDING/.test(goc) ? 'khách vừa yêu cầu — chờ shop phản hồi'
            : goc === 'PROCESSING' ? `${san} đang xử lý yêu cầu`
                : goc ? `chờ xử lý (${san}: ${goc})`
                    : 'chờ duyệt',
    }
}

export type DemKetCuc = Record<KetCucVuTra, { soVu: number; soTien: number }>

/** Đếm số vụ + tổng tiền khách đòi theo từng kết cục — cho thẻ thống kê. */
export function demTheoKetCuc(ds: (PhieuTraKetCuc & { totalRefund?: number | null })[]): DemKetCuc {
    const dem = Object.fromEntries(KET_CUC_VU_TRA.map(k => [k, { soVu: 0, soTien: 0 }])) as DemKetCuc
    for (const r of ds) {
        const o = dem[ketCucVuTra(r).ketCuc]
        o.soVu++
        o.soTien += Number(r.totalRefund) || 0
    }
    return dem
}

/** Lọc theo kết cục rồi cắt trang — giữ nguyên thứ tự đầu vào (mới → cũ). */
export function trangTheoKetCuc<T extends PhieuTraKetCuc & { id: string }>(ds: T[], ketCuc: KetCucVuTra, trang: number, coTrang: number): { ids: string[]; total: number } {
    const khop = ds.filter(r => ketCucVuTra(r).ketCuc === ketCuc)
    const tu = Math.max(0, (trang - 1) * coTrang)
    return { ids: khop.slice(tu, tu + coTrang).map(r => r.id), total: khop.length }
}
