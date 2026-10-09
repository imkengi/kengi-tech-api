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
    /* 4 mã KHÔNG có trong tài liệu mà ĐO thấy trong DB thật (KENGISTORE 09/10/2026: 25/494
     * phiếu). Tài liệu ghi NONRECEIPT nhưng Shopee gửi NOT_RECEIPT — giữ cả hai. */
    NOT_RECEIPT: 'Chưa nhận được hàng',
    SLIGHT_SCRATCH_DENTS: 'Trầy xước, móp nhẹ',
    OUTER_DAMAGED_PACKAGE: 'Thùng / bao bì ngoài bị hư hỏng',
    LONG_DELIVERY_TIME: 'Giao hàng quá lâu',
}

/** Mã Shopee → tiếng Việt; không phải mã đã biết thì trả nguyên văn. */
export function dichLyDoTraHang(r?: string | null): string {
    const goc = String(r || '').trim()
    return LY_DO_SHOPEE_VI[goc.toUpperCase()] || goc
}

/** Lý do trả là LỖI KỸ THUẬT (máy không chạy / hỏng chức năng) — trạm quay hàng hoàn bật quay
 *  HAI GIAI ĐOẠN (mở hộp → test kỹ thuật) cho những vụ này (chủ shop 09/10/2026). Mã Shopee
 *  FUNCTIONAL_DMG; chữ tự do (TikTok…) thì nhận các cụm "không hoạt động / doesn't work / defective". */
export function laLoiKyThuat(r?: string | null): boolean {
    const goc = String(r || '').trim()
    if (/^(FUNCTIONAL_DMG|ITEM_WRONGDAMAGED)$/i.test(goc)) return true
    return /defective|malfunction|not work|n['’]t work|kh[oô]ng ho[aạ]t [dđ][oộ]ng|l[oỗ]i k[yỹ] thu[aậ]t|h[oỏ]ng ch[uứ]c n[aă]ng|kh[oô]ng l[eê]n ngu[oồ]n/i.test(goc)
}

/** Bên có lỗi theo lý do trả — cùng bảng với web (ChiTietVuTra.chieuLyDo). null = không rõ. */
export function benLoiTraHang(r?: string | null): 'shop' | 'khach' | 'van_chuyen' | null {
    const ma = String(r || '').trim().toUpperCase()
    if (['WRONG_ITEM', 'ITEM_DAMAGED', 'DIFF_DESC', 'USED', 'ITEM_WRONGDAMAGED', 'ITEM_MISSING', 'ITEM_FAKE', 'PHYSICAL_DMG',
        'FUNCTIONAL_DMG', 'EXPIRED_PRODUCT', 'SELLER_SENT_WRONG_ITEM', 'SPILLED_CONTENTS', 'BROKEN_PRODUCTS', 'DAMAGED_PACKAGE',
        'SCRATCHED', 'DAMAGED_OTHERS', 'SIZE_DEVIATION', 'LOOK_DEVIATION', 'DATE_DEVIATION', 'DIFFERENT_DESCRIPTION',
        'SPOILED_ROTTEN', 'SLIGHT_SCRATCH_DENTS'].includes(ma)) return 'shop'
    if (['CHANGE_MIND', 'CHANGE_OF_MIND', 'WRONG_ORDER_INFO', 'WRONG_ADDRESS', 'ITEM_NOT_FIT', 'EXPECTATION_FAILED', 'NO_REASON'].includes(ma)) return 'khach'
    if (['NONRECEIPT', 'NOT_RECEIPT', 'OUTER_DAMAGED_PACKAGE', 'LONG_DELIVERY_TIME', 'SUSPICIOUS_PARCEL'].includes(ma)) return 'van_chuyen'
    return null
}

/** reassessed_request_reason có nghĩa — bỏ "NONE"/rỗng (chưa xác định lại). */
export function lyDoSanXacDinhLai(r?: string | null): string | null {
    const goc = String(r || '').trim()
    return goc && goc.toUpperCase() !== 'NONE' ? goc : null
}
