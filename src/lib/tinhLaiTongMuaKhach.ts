/**
 * TÍNH LẠI TỔNG MUA CỦA KHÁCH — `Customer.totalPurchases` / `totalOrders` /
 * `lastPurchaseDate`.
 *
 * Ba trường này là số TỔNG HỢP SẴN, và chỉ đường bán tại POS (`/transactions`)
 * duy trì chúng: cộng khi tạo phiếu, trừ khi huỷ/trả. `kiotvietSync` KHÔNG hề
 * đụng tới — nên cửa hàng nhập bán từ KiotViet có khách mua hàng tỷ mà danh
 * sách khách hiện ai cũng "0 đơn · 0đ".
 *
 * Đo 16/08/2026 trên HUTI: 187 khách có định danh, 125 khách quay lại (66,8%)
 * — tức phiếu CÓ nối khách đàng hoàng — nhưng `totalPurchases` của mọi khách
 * đều bằng 0. Trang Khách Hàng đọc trường tổng hợp nên trông như không có dữ
 * liệu, trong khi trang Phân Khúc tính sống từ phiếu nên vẫn ra số. Cùng một
 * cửa hàng, hai màn hình nói hai chuyện khác nhau.
 *
 * TÍNH LẠI CHỨ KHÔNG CỘNG DỒN. Cộng dồn đòi phải bắt được đúng một lần cho mỗi
 * phiếu; đồng bộ chạy lại, sửa phiếu, hay một lần lỗi giữa chừng là sai vĩnh
 * viễn mà không ai biết để sửa. Tính lại từ phiếu thì chạy bao nhiêu lần cũng
 * ra một kết quả.
 */

/** Trạng thái phiếu được tính vào tổng mua — ghi nợ ('partial') VẪN là bán. */
export const TRANG_THAI_TINH = ['completed', 'partial'] as const

export interface TongMuaKhach {
    totalPurchases: number
    totalOrders: number
    lastPurchaseDate: Date | null
}

/**
 * Gom danh sách phiếu của MỘT khách thành ba con số.
 * Tách riêng để kiểm được — phần truy vấn nằm ở người gọi.
 *
 * `Transaction.total` ĐÃ GỒM thuế, và `totalPurchases` xưa nay cũng cộng
 * `total` (xem transactions.ts), nên giữ nguyên quy ước đó để hai đường không
 * cho ra hai con số khác nhau.
 */
export function gomTongMua(
    phieu: Array<{ total?: number | null; status?: string | null; transactionDate?: Date | string | null; createdAt?: Date | string | null }>,
): TongMuaKhach {
    let tong = 0
    let so = 0
    let muonNhat: Date | null = null
    for (const p of phieu) {
        if (!(TRANG_THAI_TINH as readonly string[]).includes(String(p?.status))) continue
        tong += Number(p?.total) || 0
        so++
        /* Ngày mua = NGÀY BÁN, không phải ngày ghi dòng: cửa hàng nhập lịch sử
         * từ phần mềm cũ có `createdAt` là lúc chạy nhập. */
        const ng = p?.transactionDate || p?.createdAt
        if (ng) {
            const d = ng instanceof Date ? ng : new Date(ng)
            if (!isNaN(d.getTime()) && (!muonNhat || d > muonNhat)) muonNhat = d
        }
    }
    return {
        // Làm tròn về đồng — cộng dồn số thực dễ đẻ đuôi 0.000000001
        totalPurchases: Math.round(tong),
        totalOrders: so,
        lastPurchaseDate: muonNhat,
    }
}

/**
 * Tính lại và ghi cho MỘT khách. Trả về số vừa ghi, hoặc null nếu không đọc được.
 *
 * Chạy TUẦN TỰ ở người gọi — pool mỗi cửa hàng chỉ 2 kết nối.
 */
export async function tinhLaiChoKhach(prisma: any, customerId: string): Promise<TongMuaKhach | null> {
    if (!customerId) return null
    try {
        const phieu = await prisma.transaction.findMany({
            where: { customerId },
            select: { total: true, status: true, transactionDate: true, createdAt: true },
        })
        const so = gomTongMua(phieu)
        await prisma.customer.update({ where: { id: customerId }, data: so })
        return so
    } catch {
        /* Không đọc/ghi được thì THÔI, đừng để nó làm hỏng cả lượt đồng bộ —
         * đây là số hiển thị, không phải sổ sách. */
        return null
    }
}
