/**
 * MÃ LÝ DO TRẢ HÀNG CỦA SHOPEE → tiếng Việt người bán đọc được.
 *
 * Đủ 32 mã theo Data Definition "ReturnReason" (open.shopee.com, bản cập nhật
 * 21/09/2026, đọc 09/10/2026). SPOILED_ROTTEN (mã số 10606, lý do con của "Hàng hư
 * hỏng") Shopee thêm từ 15/09/2026 cho hàng tươi sống Shopee Supermarket; cùng đợt có
 * `reassessed_request_reason` ở get_return_detail — lý do do SÀN xác định lại sau khi
 * xem xét, "NONE" = chưa xác định lại.
 *
 * DB vẫn lưu MÃ GỐC (ReturnOrder.reason) — chỉ dịch lúc hiển thị / lúc báo tin. Mã lạ
 * (TikTok gửi chữ, Shopee thêm mã mới) trả NGUYÊN VĂN, không đoán.
 * Bản sao phía web: ChiTietVuTra.tsx (LY_DO_SHOPEE_VI) — sửa một bên nhớ sửa bên kia.
 */
export const LY_DO_SHOPEE_VI: Record<string, string> = {
    NONRECEIPT: 'Chưa nhận được hàng',
    WRONG_ITEM: 'Giao sai hàng',
    ITEM_DAMAGED: 'Hàng bị hư hỏng',
    DIFF_DESC: 'Hàng khác mô tả',
    MUITAL_AGREE: 'Hai bên đã thoả thuận',
    OTHER: 'Lý do khác',
    USED: 'Hàng đã qua sử dụng',
    NO_REASON: 'Không nêu lý do',
    ITEM_WRONGDAMAGED: 'Giao sai hàng / hàng hư hỏng',
    CHANGE_MIND: 'Khách đổi ý, không muốn mua nữa',
    ITEM_MISSING: 'Nhận thiếu hàng / thiếu phụ kiện',
    EXPECTATION_FAILED: 'Hàng không như mong đợi',
    ITEM_FAKE: 'Nghi hàng giả',
    PHYSICAL_DMG: 'Hư hỏng bên ngoài (bể, móp, trầy)',
    FUNCTIONAL_DMG: 'Hỏng chức năng, không hoạt động',
    ITEM_NOT_FIT: 'Không vừa / không phù hợp',
    SUSPICIOUS_PARCEL: 'Kiện hàng có dấu hiệu bất thường',
    EXPIRED_PRODUCT: 'Hàng hết hạn sử dụng',
    WRONG_ORDER_INFO: 'Khách đặt sai thông tin đơn',
    WRONG_ADDRESS: 'Sai địa chỉ nhận hàng',
    CHANGE_OF_MIND: 'Khách đổi ý, không muốn mua nữa',
    SELLER_SENT_WRONG_ITEM: 'Người bán gửi sai hàng',
    SPILLED_CONTENTS: 'Hàng bị đổ, rò rỉ',
    BROKEN_PRODUCTS: 'Hàng bị bể vỡ',
    DAMAGED_PACKAGE: 'Bao bì bị hư hỏng',
    SCRATCHED: 'Hàng bị trầy xước',
    DAMAGED_OTHERS: 'Hư hỏng khác',
    SIZE_DEVIATION: 'Sai kích thước so với mô tả',
    LOOK_DEVIATION: 'Khác hình thức so với mô tả',
    DATE_DEVIATION: 'Sai hạn dùng so với mô tả',
    DIFFERENT_DESCRIPTION: 'Hàng khác mô tả',
    SPOILED_ROTTEN: 'Hàng bị ôi thiu, hư thối',
}

/** Mã Shopee → tiếng Việt; không phải mã đã biết thì trả nguyên văn. */
export function dichLyDoTraHang(r?: string | null): string {
    const goc = String(r || '').trim()
    return LY_DO_SHOPEE_VI[goc.toUpperCase()] || goc
}

/** reassessed_request_reason có nghĩa — bỏ "NONE"/rỗng (chưa xác định lại). */
export function lyDoSanXacDinhLai(r?: string | null): string | null {
    const goc = String(r || '').trim()
    return goc && goc.toUpperCase() !== 'NONE' ? goc : null
}
