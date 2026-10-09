// ─────────────────────────────────────────────────────────────────────────────
//  THÔNG TIN XUẤT HOÁ ĐƠN CỦA KHÁCH (09/10/2026 — chủ shop: "trong phần khách hàng
//  chưa có phần thông tin xuất hoá đơn"). Cột trên Customer: taxCode, invoiceType,
//  invoiceCompanyName, invoiceBuyerName, invoiceAddress, invoiceEmail, invoicePhone,
//  invoiceIdNo. Nguồn: gõ tay, tra MST (lib/traMst), đồng bộ KiotViet.
//
//  MỘT luật cho mọi đường xuất HĐĐT: trường HOÁ ĐƠN riêng trước, trường liên hệ chung
//  sau. Trước đây routes/einvoice đọc `customer.taxCode` — cột KHÔNG tồn tại (luôn
//  undefined) nên mọi khách đều ra hoá đơn "khách lẻ không MST".
// ─────────────────────────────────────────────────────────────────────────────

const s = (v: any) => String(v ?? '').trim()

export interface HoaDonKhach {
    /** tên người mua in trên HĐ (HVTNMHang) */
    ten: string
    /** tên ĐƠN VỊ (VNPT `Ten`) — rỗng thì nhà cung cấp tự lấy `ten` khi có MST */
    tenDonVi: string
    mst: string
    diaChi: string
    email: string
    sdt: string
    cccd: string
}

export function hoaDonCuaKhach(kh: any): HoaDonKhach {
    const k = kh || {}
    return {
        ten: s(k.invoiceBuyerName) || s(k.invoiceCompanyName) || s(k.name),
        tenDonVi: s(k.invoiceCompanyName),
        mst: s(k.taxCode).replace(/\s+/g, ''),
        diaChi: s(k.invoiceAddress) || s(k.address),
        email: s(k.invoiceEmail) || s(k.email),
        sdt: s(k.invoicePhone) || s(k.phone),
        cccd: s(k.invoiceIdNo),
    }
}

/** MST hợp lệ về HÌNH THỨC: 10 số, 10 số + "-" + 3 số (chi nhánh), 13 số liền, hoặc 12 số
 *  (MST cá nhân / hộ kinh doanh theo CCCD). Chỉ kiểm khuôn — có tồn tại hay không là việc
 *  của tra MST. */
export function mstHopLe(mst: string): boolean {
    return /^(\d{10}(-\d{3})?|\d{12}|\d{13})$/.test(s(mst).replace(/\s+/g, ''))
}

/** Các cột hoá đơn trên Customer — dùng chung cho route, đồng bộ, payload webhook. */
export const COT_HOA_DON_KHACH = [
    'taxCode', 'invoiceType', 'invoiceCompanyName', 'invoiceBuyerName',
    'invoiceAddress', 'invoiceEmail', 'invoicePhone', 'invoiceIdNo',
] as const
