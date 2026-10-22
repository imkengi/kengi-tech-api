// ─────────────────────────────────────────────────────────────────────────────
//  KẾT CỤC VỤ TRẢ HÀNG / HOÀN TIỀN — nói bằng KHIẾU NẠI THẮNG / THUA (22/10/2026)
//
//  Chủ shop: "trong phần trả hàng hoàn tiền chưa phân loại được các đơn bị sàn từ chối trả
//  hàng hoàn tiền", rồi (bản đầu chia "sàn từ chối / shop từ chối / khách được hoàn"):
//  "khó hiểu quá, sửa lại là khiếu nại thắng hay thua đi". Nên nhóm theo ngôn ngữ người bán:
//    · Khiếu nại THẮNG  — shop khiếu nại / từ chối và khách KHÔNG được hoàn
//    · Khiếu nại THUA   — shop khiếu nại / từ chối mà khách VẪN được hoàn
//    · Đang khiếu nại · Chờ xử lý (chưa khiếu nại) · Chấp nhận hoàn (không khiếu nại) · Khách huỷ
//  TikTok "Từ chối" là cách shop phản đối vụ trả trên TikTok (màn Khiếu nại của app gửi lệnh từ
//  chối) ⇒ tính là khiếu nại: từ chối đứng vững = thắng, sàn xử cho khách = thua.
//
//  ĐO 22/10/2026 KENGISTORE (698 phiếu sàn, chuỗi trạng thái gốc trong ghi chú):
//    · Shopee … → [Khiếu nại] → CLOSED 34 · JUDGING → CANCELLED 9 · TikTok shop từ chối mà khách
//      không kiện lên sàn 5 ⇒ THẮNG 48
//    · Shopee khiếu nại rồi ACCEPTED 32 · TikTok sàn xử cho khách 2 ⇒ THUA 34
//    · Shopee CLOSED KHÔNG có khiếu nại 8 (vụ tháng 6–7, sàn tự đóng) ⇒ xếp chung "Khách huỷ"
//      (không phải hoàn, nhưng không được gọi là khiếu nại thắng)
//  Tài liệu Shopee (Data Definition › ReturnStatus) chỉ liệt kê tên, không giải nghĩa — luật
//  dưới đây dựa trên chuỗi đo được.
//
//  Đọc đúng những dòng returnSync / route khiếu nại ghi vào ghi chú: "[Shopee] MÃ (giờ)",
//  "[TikTok] Status: MÃ", "[Khiếu nại] …", "[Từ chối TikTok] …", "[Tranh chấp TikTok] MÃ …".
//  THUẦN (không DB) để danh sách, bộ lọc, thống kê và bộ kiểm chứng dùng chung một luật.
// ─────────────────────────────────────────────────────────────────────────────

import { DAU_TU_CHOI_TT, DAU_TRANH_CHAP_TT } from './bangChungTikTok'

export const KET_CUC_VU_TRA = ['cho_xu_ly', 'dang_khieu_nai', 'khieu_nai_thang', 'khieu_nai_thua', 'chap_nhan_hoan', 'khach_huy'] as const
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
    /** Vài chữ nói vì sao — hiện ngay trên thẻ phiếu */
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
    /** từng khiếu nại (app hay Seller Center), từng bị kiện lên sàn, hoặc shop từng từ chối (TikTok) */
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
        if (/REJECT/.test(ma)) { kq.tungTuChoi = true; kq.tungKhieuNai = true }
        if (/AWAITING_BUYER_SHIP/.test(ma)) kq.tungChoGuiHang = true
        kq.cuoiKhiDangXet = kq.dangXet
        if (MA_PHAN_QUYET.test(ma)) kq.dangXet = false
        kq.goc = ma
    }
    return kq
}

/** Kết cục MỘT phiếu trả — nói theo khiếu nại thắng / thua của shop. */
export function ketCucVuTra(p: PhieuTraKetCuc): KetQuaKetCuc {
    const db = docDienBien(p.notes)
    const { goc, tranhChap } = db
    const tiktok = p.code.startsWith('RTN-TT-')
    const san = tiktok ? 'TikTok' : 'Shopee'

    // 1. Tiền đã ra — app đã ghi hoàn, hoặc sàn báo đã hoàn
    if (p.status === 'refunded' || /REFUND_PAID|SUCCESS|COMPLETE/.test(goc)) {
        if (tranhChap === 'SUPPORT_BUYER') return { ketCuc: 'khieu_nai_thua', chiTiet: `${san} xử cho khách` }
        if (db.tungKhieuNai) return { ketCuc: 'khieu_nai_thua', chiTiet: 'khách đã được hoàn tiền' }
        return { ketCuc: 'chap_nhan_hoan', chiTiet: 'đã hoàn tiền' }
    }
    // 2. Sàn đã phân xử tranh chấp (TikTok)
    if (tranhChap === 'SUPPORT_SELLER') return { ketCuc: 'khieu_nai_thang', chiTiet: `${san} xử cho shop` }
    if (tranhChap === 'SUPPORT_BUYER') return { ketCuc: 'khieu_nai_thua', chiTiet: `${san} xử cho khách` }
    // 3. Đang có lượt khiếu nại / tranh chấp chưa phân xử
    if (db.dangXet) {
        return {
            ketCuc: 'dang_khieu_nai',
            chiTiet: tranhChap === 'IN_PROGRESS' ? `khách kiện lên ${san} — chờ sàn xử`
                : goc === 'JUDGING' ? `${san} đang xét`
                    : 'chờ sàn xử',
        }
    }
    // 4. Sàn ĐÓNG yêu cầu (Shopee CLOSED) — thắng chỉ khi đóng lúc đang khiếu nại
    if (/CLOS/.test(goc)) {
        return db.cuoiKhiDangXet
            ? { ketCuc: 'khieu_nai_thang', chiTiet: `${san} đóng yêu cầu của khách` }
            : { ketCuc: 'khach_huy', chiTiet: `${san} tự đóng yêu cầu` }
    }
    // 5. Huỷ
    if (/CANCEL/.test(goc)) {
        if (db.cuoiKhiDangXet) return { ketCuc: 'khieu_nai_thang', chiTiet: `yêu cầu bị huỷ khi ${san} đang xét` }
        if (tiktok && db.tungTuChoi) return { ketCuc: 'khieu_nai_thang', chiTiet: 'shop từ chối, yêu cầu đã huỷ' }
        if (db.tungChoGuiHang) return { ketCuc: 'khach_huy', chiTiet: 'khách không gửi hàng về' }
        return { ketCuc: 'khach_huy', chiTiet: 'khách huỷ yêu cầu' }
    }
    // 6. Shop từ chối (TikTok), khách không kiện lên sàn — cả tên cũ lẫn tên mới (REQUEST_REJECTED / RECEIVE_REJECTED)
    if (/REJECT/.test(goc)) {
        return { ketCuc: 'khieu_nai_thang', chiTiet: /RECEIVE/.test(goc) ? 'shop từ chối nhận hàng trả, khách không kiện lên sàn' : 'shop từ chối, khách không kiện lên sàn' }
    }
    // 7. Khách đã gửi hàng về — TikTok chờ shop nhận bưu kiện hoặc kháng nghị
    if (/BUYER_SHIPPED_ITEM/.test(goc)) return { ketCuc: 'cho_xu_ly', chiTiet: 'khách đã gửi hàng — chờ shop nhận hoặc kháng nghị' }
    // 8. Đã chấp nhận, tiền chưa ra — sau khiếu nại / từ chối là THUA
    if (/^ACCEPTED$|AWAITING_BUYER_SHIP/.test(goc) || p.status === 'approved' || p.status === 'exchanged') {
        if (db.tungKhieuNai) return { ketCuc: 'khieu_nai_thua', chiTiet: `${san} cho khách trả hàng / hoàn tiền` }
        return {
            ketCuc: 'chap_nhan_hoan',
            chiTiet: /AWAITING_BUYER_SHIP/.test(goc) ? 'chờ khách gửi hàng về'
                : p.status === 'exchanged' ? 'đã đổi hàng'
                    : 'đã chấp nhận',
        }
    }
    // 9. Shop từ chối trong Kengi (phiếu nhập tay / không có mã sàn) — từ chối đứng vững
    if (p.status === 'rejected') return { ketCuc: 'khieu_nai_thang', chiTiet: 'đã từ chối trong Kengi' }
    // 10. Còn lại: yêu cầu đang mở, chưa khiếu nại
    return {
        ketCuc: 'cho_xu_ly',
        chiTiet: /REQUESTED|PENDING/.test(goc) ? 'khách vừa yêu cầu'
            : goc === 'PROCESSING' ? `${san} đang xử lý`
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
