/**
 * PHIÊN BẢN TỒN — bộ đệm các màn hiện tồn kho phải ĐÚNG trên MỌI bản Cloud Run (09/11/2026).
 *
 * Bệnh (phát hiện khi viết app POS bản PC): GET /api/products đệm 300 giây trong BỘ NHỚ — prod
 * KHÔNG có Redis nên mỗi bản Cloud Run (tối đa 3) giữ một bộ đệm riêng — mà POST /api/transactions
 * không xoá khoá `products:*`. Bán xong, POS web / app PC / Android tải lại danh mục (kể cả nút ↻,
 * gửi đúng truy vấn cũ) vẫn thấy tồn CŨ tới 5 phút, cảnh báo "bán quá tồn" có thể không hiện.
 * Rải cacheDel vào ~60 chỗ đổi tồn cũng KHÔNG chữa được: cacheDel chỉ xoá bộ nhớ của bản đang xử lý
 * phiếu, bản kia vẫn trả bản cũ tới hết TTL — và đường đổi tồn mới viết sau này lại quên xoá.
 *
 * Cách chữa: mỗi lần đọc, hỏi CSDL — nơi mọi bản máy cùng nhìn — một PHIÊN BẢN rẻ của hai bảng tồn,
 * lưu kèm bản đệm; lệch là dựng lại. Không phụ thuộc đường ghi nào nhớ xoá.
 *   - SUM(tồn)        bắt mọi thay đổi SỐ LƯỢNG, kể cả khi MAX(updatedAt) không nhích: updatedAt là
 *                     giờ CÂU LỆNH chứ không phải giờ commit — giao dịch bán dài commit SAU một lệnh
 *                     ngắn có updatedAt mới hơn thì MAX đứng yên.
 *   - MAX(updatedAt)  bắt đổi giá/tên/mã/gộp mã. Prisma tự đặt @updatedAt khi update/updateMany/upsert
 *                     có dữ liệu; SQL thô phải TỰ đặt (xem lib/mergeProduct.ts).
 *   - COUNT           bắt thêm/xoá mã, thêm/xoá dòng kho.
 * Còn lọt: hai thay đổi bù trừ đúng bằng nhau commit trong cùng khe dựng (vd. sửa đơn đổi 1 cái A lấy
 * 1 cái B) và những thứ không nằm trong hai bảng (tên danh mục/thương hiệu, ảnh) — TTL của từng route
 * chặn trên.
 *
 * Đo prod chỉ-đọc 09/11/2026, HUTI 3.626 mã + 3.780 dòng kho: câu phiên bản 2,7 ms thực thi, MỘT vòng
 * tới CSDL; dựng lại /products?pageSize=1000 cần 7 câu nối tiếp (pool 1 ⇒ 7 vòng) + map + JSON.
 *
 * Thứ tự BẮT BUỘC: đọc phiên bản TRƯỚC, dữ liệu SAU. Phiếu commit xen giữa thì bản đệm mang phiên
 * bản cũ + dữ liệu mới ⇒ lần sau lệch, dựng lại (thừa một lần). Đảo thứ tự thì dữ liệu cũ có thể nằm
 * dưới phiên bản mới tới hết TTL.
 * Đọc phiên bản hỏng ⇒ KHÔNG dùng đệm, KHÔNG ghi đệm: thà chậm còn hơn trả tồn sai.
 */
import { cacheGet, cacheSet } from './cache'

/** MỘT lượt quét mỗi bảng (bản 4 câu con quét mỗi bảng 2 lần: 5,8 ms so với 2,7 ms). */
export const CAU_PHIEN_BAN_TON = `SELECT * FROM
    (SELECT COUNT(*)::int AS n, MAX("updatedAt") AS m, COALESCE(SUM(stock), 0)::bigint AS s FROM "Product") sp,
    (SELECT COUNT(*)::int AS wn, MAX("updatedAt") AS wm, COALESCE(SUM(quantity), 0)::bigint AS ws FROM "WarehouseStock") kho`

const moc = (d: any): string => (d instanceof Date ? String(d.getTime()) : d == null ? '' : String(d))

/** Chuỗi phiên bản tồn của cửa hàng; null = không đọc được (người gọi phải bỏ qua bộ đệm). */
export async function docPhienBanTon(prisma: any): Promise<string | null> {
    try {
        const rows: any[] = await prisma.$queryRawUnsafe(CAU_PHIEN_BAN_TON)
        const r = rows?.[0]
        if (!r) return null
        return [r.n, moc(r.m), String(r.s), r.wn, moc(r.wm), String(r.ws)].join('|')
    } catch (err) {
        console.error('[phienBanTon] không đọc được phiên bản tồn — bỏ qua bộ đệm:', err)
        return null
    }
}

/**
 * Bản đệm còn khớp phiên bản tồn HIỆN TẠI thì trả nó, không thì `data: null`. Luôn trả kèm
 * `phienBan` vừa đọc để route ghi lại bằng ghiDemTheoTon SAU khi dựng xong.
 */
export async function docDemTheoTon<T = any>(prisma: any, khoa: string): Promise<{ data: T | null; phienBan: string | null }> {
    const phienBan = await docPhienBanTon(prisma)
    if (!phienBan) return { data: null, phienBan: null }
    const goi = await cacheGet<{ v?: string; d?: T }>(khoa)
    if (goi && goi.v === phienBan && goi.d != null) return { data: goi.d, phienBan }
    return { data: null, phienBan }
}

/** Ghi bản đệm kèm phiên bản đọc ĐẦU request. Không có phiên bản thì không ghi. */
export async function ghiDemTheoTon(khoa: string, phienBan: string | null, data: any, ttlGiay: number): Promise<void> {
    if (!phienBan) return
    await cacheSet(khoa, { v: phienBan, d: data }, ttlGiay)
}
