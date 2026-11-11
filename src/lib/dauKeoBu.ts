/**
 * DẤU "KÉO BÙ ĐƠN CŨ" (11/11/2026). Chủ shop KENGISTORE cần doanh thu cả năm để báo cáo, mà Kengi chỉ có đơn sàn từ 21/03/2026
 * (đo /admin/dem-don-san-thieu: thiếu ~5.800 đơn Shopee đã hoàn thành, gần hết ở tháng 1 → 20/03). Chủ shop chọn: kéo về thành
 * PHIẾU THẬT nhưng KHÔNG TRỪ KHO — hàng của các đơn đó đã rời kho từ nhiều tháng trước, tồn hiện tại đã phản ánh rồi; trừ nữa là
 * trừ hai lần.
 *
 * Luật nằm TRÊN DỮ LIỆU (ghi chú của đơn gốc), không nằm ở tham số lời gọi: cron đồng bộ chạy song song cũng gọi hàm lập phiếu
 * cho mọi đơn chưa có phiếu — nếu luật là tham số thì đơn kéo bù bị cron lập phiếu trước sẽ bị trừ kho như đơn thường.
 * Đơn mang dấu này: lập phiếu doanh thu bình thường, KHÔNG trừ kho, KHÔNG ghi thẻ kho, KHÔNG trừ kho mẹ, KHÔNG ghi bút toán
 * (phiếu đơn sàn cũ trước 03/09/2026 vốn cũng không có bút toán — muốn có thì Đối chiếu sổ sách → Ghi bù cho cả giai đoạn).
 */
export const DAU_KEO_BU = 'Kéo bù đơn cũ'
export const GHI_CHU_KEO_BU = '[Kéo bù đơn cũ 11/2026 — không trừ kho, không ghi bút toán]'
export const laDonKeoBu = (note: any): boolean => String(note || '').includes(DAU_KEO_BU)
