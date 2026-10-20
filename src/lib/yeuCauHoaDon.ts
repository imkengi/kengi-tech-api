// ─────────────────────────────────────────────────────────────────────────────
//  TRANG KHÁCH TỰ LẤY HOÁ ĐƠN — kengi.vn/hoadon (20/10/2026, chủ shop: "thêm mục kengi.vn/hoadon/ để khách nhập
//  đơn hàng lấy hoá đơn" + "khách nhập mã đơn để lấy hoá đơn bảo hành nữa"). Hàm THUẦN cho routes/yeuCauHoaDon.ts —
//  tách riêng để soát được không cần CSDL (scripts/check-yeu-cau-hoa-don.ts).
//
//  Đo 20/10/2026 (chỉ đọc): CHỈ KENGISTORE dùng HĐĐT thật (VNPT, tự xuất bật từ 31/07); 3.907 đơn sàn, mã đơn luôn
//  = tiền tố + '-' + mã sàn: SPE (Shopee, 14 ký tự) 2.691, TIK (TikTok, 18 số) 1.156, LZD (Lazada, 15 số) 60; không
//  có phiếu bán tại quầy. HĐ xuất trung vị ~5,5 ngày sau khi giao ⇒ khách nhận hàng rồi gửi MST vẫn kịp trước khi xuất.
// ─────────────────────────────────────────────────────────────────────────────

import { mstHopLe } from './hoaDonKhach'

/** Tiền tố mã đơn trong hệ thống → tên sàn hiện cho khách */
export const KENH_THEO_TIEN_TO: Record<string, string> = { SPE: 'Shopee', TIK: 'TikTok', LZD: 'Lazada' }

/** Cửa hàng nhận yêu cầu qua trang công khai — biến môi trường, mặc định KENGISTORE (cửa hàng duy nhất có HĐĐT thật). */
export function cuaHangNhanYeuCau(env = process.env.HOA_DON_KHACH_CUA_HANG): string[] {
    const ds = String(env || 'KENGISTORE').split(',').map(s => s.trim().toUpperCase()).filter(s => /^[A-Z0-9_-]{2,40}$/.test(s))
    return ds.length ? ds.slice(0, 5) : ['KENGISTORE']
}

/**
 * Mã khách gõ → các `OnlineOrder.orderNumber` ứng viên; `null` = sai dạng (chặn sớm, khỏi hỏi CSDL).
 * Khách thường dán mã sàn trần (Shopee "2610203UKRG5FA", TikTok 18 số) — có khi kèm dấu cách, '#', chữ thường,
 * hoặc dán nguyên mã trong hệ thống ("SPE-…", "ONLINE-SPE-…").
 */
export function ungVienMaDon(vao: unknown): string[] | null {
    const s = String(vao ?? '').toUpperCase().replace(/[\s#]/g, '').replace(/^ONLINE-/, '')
    if (!s || s.length > 40) return null
    if (/^(SPE|TIK|LZD)-[A-Z0-9]{6,30}$/.test(s)) return [s]
    if (!/^[A-Z0-9]{8,30}$/.test(s)) return null
    return Object.keys(KENH_THEO_TIEN_TO).map(t => `${t}-${s}`)
}

export type LoaiHoaDon = 'cong_ty' | 'ho_kd' | 'ca_nhan'
export const LOAI_HOA_DON: LoaiHoaDon[] = ['cong_ty', 'ho_kd', 'ca_nhan']

/** Dạng ghi vào Transaction.vatBuyerInfo — CÙNG khoá đường xuất HĐ đang đọc (routes/einvoice issueInvoiceForTransaction). */
export interface ThongTinNguoiMua {
    name: string
    taxCode: string
    address: string
    email: string
    nationalId: string
    loai: LoaiHoaDon
    nguon: 'khach-web'
    luc: string
}

/** Bỏ ký tự điều khiển, gom khoảng trắng, cắt độ dài — dữ liệu người lạ gõ vào. */
const sach = (v: unknown, max: number) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)

/** Kiểm & chuẩn hoá thông tin khách gửi. Lỗi trả câu tiếng Việt hiện thẳng cho khách. */
export function kiemYeuCau(b: any, now = new Date()): { ok: true; info: ThongTinNguoiMua } | { ok: false; loi: string } {
    const loai = String(b?.loai || '') as LoaiHoaDon
    if (!LOAI_HOA_DON.includes(loai)) return { ok: false, loi: 'Chọn loại hoá đơn: Công ty, Hộ kinh doanh hoặc Cá nhân' }
    const ten = sach(b?.ten, 200)
    const mst = sach(b?.mst, 20).replace(/\s+/g, '')
    const diaChi = sach(b?.diaChi, 300)
    const email = sach(b?.email, 120).toLowerCase()
    const cccd = sach(b?.cccd, 20).replace(/\s+/g, '')

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { ok: false, loi: 'Email nhận hoá đơn chưa đúng' }
    if (loai === 'cong_ty' || loai === 'ho_kd') {
        if (!mst) return { ok: false, loi: 'Nhập mã số thuế' }
        if (!mstHopLe(mst)) return { ok: false, loi: 'Mã số thuế phải là 10 số, 10 số-3 số (chi nhánh), 12 hoặc 13 số' }
        if (ten.length < 2) return { ok: false, loi: loai === 'cong_ty' ? 'Nhập tên công ty / đơn vị' : 'Nhập tên hộ kinh doanh' }
        if (diaChi.length < 5) return { ok: false, loi: 'Nhập địa chỉ ghi trên hoá đơn' }
    } else {
        if (ten.length < 2) return { ok: false, loi: 'Nhập họ tên người mua' }
        if (mst && !mstHopLe(mst)) return { ok: false, loi: 'Mã số thuế cá nhân phải là 10 hoặc 12 số' }
        if (cccd && !/^(\d{9}|\d{12})$/.test(cccd)) return { ok: false, loi: 'Số CCCD phải là 12 số (CMND cũ 9 số)' }
    }
    return {
        ok: true,
        info: {
            name: ten,
            taxCode: mst,
            address: diaChi,
            email,
            nationalId: loai === 'ca_nhan' ? cccd : '',
            loai,
            nguon: 'khach-web',
            luc: now.toISOString(),
        },
    }
}

/**
 * 'chua_ghi_so' = đơn ĐÃ GIAO mà chưa có phiếu bán (đo 20/10/2026: 748 đơn COMPLETED như vậy ở KENGISTORE — mã hàng
 * sàn chưa nối được hàng kho nên orderSync chưa lên phiếu). KHÔNG được nói với khách là "chờ xác nhận".
 */
export type TrangThaiDonKhach = 'cho_xac_nhan' | 'chua_ghi_so' | 'dang_giao' | 'da_giao' | 'da_huy' | 'tra_hang'

/**
 * Trạng thái đơn nói với khách. Trạng thái lưu lẫn kiểu sàn (COMPLETED, TO_CONFIRM_RECEIVE, IN_TRANSIT, TO_RETURN…)
 * với kiểu nội bộ (delivered, cancelled…) — so không phân biệt hoa thường. Chưa có phiếu bán mà chưa giao ⇒ shop chưa
 * xác nhận (orderSync chỉ lên phiếu sau khi xác nhận).
 */
export function trangThaiDonKhach(o: { status?: string | null; deliveredAt?: any }, coPhieu: boolean): TrangThaiDonKhach {
    const st = String(o?.status || '').toLowerCase()
    if (/cancel|huy/.test(st)) return 'da_huy'
    if (/return|refund|hoan/.test(st)) return 'tra_hang'
    const daGiao = !!o?.deliveredAt || /deliver|complete|confirm_receive/.test(st)
    if (!coPhieu) return daGiao ? 'chua_ghi_so' : 'cho_xac_nhan'
    return daGiao ? 'da_giao' : 'dang_giao'
}

/** Che bớt khi nhắc lại thông tin đã gửi — ai có mã đơn cũng tra được, đừng để lộ MST / email người khác. */
export const cheMst = (m: string) => (m ? `***${String(m).slice(-3)}` : '')
export function cheEmail(e: string): string {
    const [u, d] = String(e || '').split('@')
    return u && d ? `${u[0]}***@${d}` : ''
}

/** 'dd/mm/yyyy' theo giờ VN (máy chủ lưu UTC) */
export function ngayVN(d: any): string {
    if (!d) return ''
    const t = new Date(d)
    if (isNaN(t.getTime())) return ''
    return new Date(t.getTime() + 7 * 3600_000).toISOString().slice(0, 10).split('-').reverse().join('/')
}
