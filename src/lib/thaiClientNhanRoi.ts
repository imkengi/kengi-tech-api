/**
 * QUYẾT ĐỊNH THẢI CLIENT NHÀN RỖI — logic thuần, tách khỏi lib/prisma.ts để
 * kiểm được mà không phải khởi tạo PrismaClient thật.
 *
 * Bộ thải chạy 2 phút/lần, đóng client của cửa hàng nào không được đụng tới
 * quá `nhanRoiMs` (mặc định 10 phút). Nó đúng ở nửa "cửa hàng ngồi im cả ngày
 * vẫn ôm kết nối" — và SAI ở nửa "cron đang chạy dài":
 *
 * SỰ CỐ ĐÊM 17→18/08/2026: `lastUsed` chỉ được chạm khi ai đó gọi
 * getStorePrisma(). Cron đồng bộ gọi MỘT LẦN đầu lượt rồi giữ tham chiếu suốt
 * cả lượt (kéo lịch sử theo khung 14 ngày có thể mất hàng chục phút). Đến phút
 * thứ 10 bộ thải coi client là rỗi và $disconnect() ngay dưới chân cron. Ban
 * ngày không lộ vì request người dùng liên tục chạm client; ban đêm chỉ còn
 * cron nên nó chết: container tự tắt/khởi động lại 12 lần từ 01:00 đến 06:46,
 * 563 lần "connection limit: 1", 575 lần "Engine is not yet connected" riêng
 * giờ 06h, 289 đơn chuyển hỏng cùng một phút 06:37.
 *
 * Sửa: client có lượt chạy dài đang GIỮ (`dangBan > 0`) thì KHÔNG thải, bất kể
 * lastUsed cũ đến đâu.
 */

export interface TrangThaiClient {
    schema: string
    lastUsed: number
    /** Số lượt chạy dài đang giữ. >0 = cấm thải. */
    dangBan: number
}

/**
 * Chọn những schema ĐƯỢC PHÉP thải ở thời điểm `nay`.
 * Trả về danh sách schema, không đụng vào map thật.
 */
export function chonClientDeThai(
    danhSach: readonly TrangThaiClient[],
    nay: number,
    nhanRoiMs: number,
): string[] {
    const ra: string[] = []
    for (const c of danhSach) {
        if (nay - c.lastUsed < nhanRoiMs) continue   // còn tươi
        if (c.dangBan > 0) continue                  // đang có lượt dài giữ
        ra.push(c.schema)
    }
    return ra
}
