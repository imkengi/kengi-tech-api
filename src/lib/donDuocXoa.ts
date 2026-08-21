/**
 * ĐƠN SÀN CŨ NÀO ĐƯỢC PHÉP XOÁ — dùng cho cron dọn dẹp (src/cron/autoSync.ts).
 *
 * Đây là đường XOÁ VĨNH VIỄN: mất đơn là mất luôn dòng hàng, và nếu đơn đó chưa
 * lên phiếu thì doanh thu biến khỏi sổ không dấu vết, không cách nào dựng lại.
 *
 * Bản trước xoá theo trạng thái + tuổi, KHÔNG hỏi đơn đã vào sổ chưa. Đo thật
 * 15/08/2026: KENGISTORE có 644 đơn COMPLETED chưa lên phiếu (353,7 triệu) vì
 * listing sàn chưa nối — và cron đang xoá dần chúng, ba đơn chỉ trong một buổi
 * sáng. Mỗi đơn mất đi là một khoản doanh thu không bao giờ đòi lại được.
 *
 * LUẬT: chỉ xoá khi
 *   (a) đơn ĐÃ có phiếu bán — dữ liệu đã vào sổ, bảng OnlineOrder chỉ còn bản
 *       sao; hoặc
 *   (b) đơn HUỶ / TRẢ — loại này không bao giờ lên phiếu nên giữ lại vô nghĩa.
 * Ngoài hai nhóm đó thì GIỮ, kể cả đã rất cũ. Đĩa rẻ hơn doanh thu mất trắng.
 */

/**
 * TRẠNG THÁI ĐƠN CÒN CÓ THỂ LÊN PHIẾU BÁN — MỘT nguồn sự thật duy nhất.
 *
 * `convertOnlineOrderToTransaction` nhập chính hằng này để quyết có chuyển hay
 * không. Trước đây nó giữ một mảng CỤC BỘ riêng, còn file này giữ một mảng khác
 * (`['COMPLETED','completed']`) để quyết đơn nào được XOÁ VĨNH VIỄN — hai danh
 * sách ở hai file, khớp nhau bằng niềm tin.
 *
 * ⚠ Lệch một chiều là thảm hoạ: chỉ cần thêm `DELIVERED` vào danh sách quét của
 * cron dọn dẹp (`cleanStatuses` trong autoSync.ts) mà quên thêm vào danh sách
 * "đã bán" ở đây, thì đơn ĐÃ GIAO nhưng CHƯA lên phiếu rơi vào nhánh xoá vô
 * điều kiện — đúng thảm hoạ mà hàng rào này sinh ra để chặn, tái diễn im lặng.
 * Đặt hằng ở tầng `lib` (không phụ thuộc gì) để cả hai bên cùng nhập.
 */
export const TRANG_THAI_LEN_PHIEU = [
    // lowercase (nội bộ, sau khi mapStatus)
    'confirmed', 'processing', 'shipping', 'completed', 'delivered',
    // Shopee UPPERCASE (đề phòng lưu thẳng từ API)
    'READY_TO_SHIP', 'PROCESSED', 'SHIPPED', 'COMPLETED',
    // TikTok giữ nguyên trạng thái gốc (mapStatus từ 2026-06-11) — TRƯỚC ĐÂY
    // THIẾU ở đây nên đơn TikTok kể cả DELIVERED bị chặn, không lên phiếu ⇒
    // không vào hàng đợi xuất HĐ (tháng 7 chỉ 5/≥50 đơn đã giao vào được).
    'AWAITING_SHIPMENT', 'AWAITING_COLLECTION', 'PARTIALLY_SHIPPING',
    'IN_TRANSIT', 'DELIVERED',
] as const

/**
 * Trạng thái nghĩa là ĐÃ BÁN — nhóm bắt buộc phải có phiếu mới được xoá.
 *
 * SUY RA từ danh sách trên chứ không gõ tay: định nghĩa đúng của "đã bán" chính
 * là "đơn còn có thể lên phiếu". Suy ra như vậy luôn CHẶT HƠN HOẶC BẰNG danh
 * sách cứng cũ (`COMPLETED`/`completed` là tập con), tức sai số nghiêng về phía
 * GIỮ đơn — đúng hướng an toàn cho một đường xoá vĩnh viễn.
 */
export const TRANG_THAI_DA_BAN = TRANG_THAI_LEN_PHIEU

export interface DonUngVien {
    id: string
    orderNumber: string
    status: string
}

/**
 * @param ungVien   đơn đã lọc theo trạng thái + tuổi ở tầng truy vấn
 * @param daCoPhieu tập receiptNumber ('ONLINE-<mã đơn>') đã tồn tại trong sổ
 */
export function chonDonDuocXoa(
    ungVien: DonUngVien[],
    daCoPhieu: Set<string>,
): { duocXoa: DonUngVien[]; giuLai: DonUngVien[] } {
    const duocXoa: DonUngVien[] = []
    const giuLai: DonUngVien[] = []
    for (const d of ungVien) {
        const daBan = (TRANG_THAI_DA_BAN as readonly string[]).includes(String(d?.status))
        // Đơn đã bán thì phải CÓ PHIẾU mới được xoá; đơn huỷ/trả thì xoá thoải mái.
        if (!daBan || daCoPhieu.has(`ONLINE-${d.orderNumber}`)) duocXoa.push(d)
        else giuLai.push(d)
    }
    return { duocXoa, giuLai }
}

/** Mã phiếu tương ứng một đơn sàn — khoá idempotent dùng khắp hệ. */
export const maPhieuCuaDon = (orderNumber: string) => `ONLINE-${orderNumber}`
