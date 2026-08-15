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

/** Trạng thái nghĩa là ĐÃ BÁN — nhóm bắt buộc phải có phiếu mới được xoá. */
export const TRANG_THAI_DA_BAN = ['COMPLETED', 'completed'] as const

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
