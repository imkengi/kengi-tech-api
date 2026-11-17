/* ═══════════════════════════════════════════════════════════════════════════════
 *  LỊCH NỀN NGHỈ KHI VỪA MẤT CSDL (17/11/2026)
 *
 *  Đo 16/11/2026 (log đủ mọi request): 4.221 lỗi P1001 "Can't reach database server" trong một
 *  ngày, 3.607 cái từ 17 BẢN PHỤ Cloud Run (409 request cả thảy) — bản chính 7.655 request chỉ
 *  88. Bản phụ bật lên vì webhook Shopee dồn đợt; trả 200 xong thì cpu-throttling cắt CPU,
 *  nhưng các lịch setInterval vẫn thức dậy, nối CSDL, và bộ nối Cloud SQL không có CPU để làm
 *  mới chứng chỉ ⇒ "refresh failed: context deadline exceeded" ⇒ P1001. Không có Redis nên
 *  MỌI bản chạy đủ bộ lịch (lib/leaderLock) ⇒ mỗi phút lại dội vào đúng cái kết nối đang đứt.
 *  CSDL không hề sập: chỉ 66/4.221 lỗi (1,6%) rơi vào lúc bản đó đang có request.
 *
 *  Nay: lib/prisma `bocThuLai` báo vào đây — truy vấn được ⇒ tốt lại NGAY; hỏng kết nối sau khi
 *  đã thử lại hết (hoặc hết chờ pool) ⇒ ghi lúc mất. Lịch NGẮN (danh sách ở leaderLock) bỏ
 *  lượt khi: vừa mất CSDL trong CSDL_NGHI_MS (mặc định 3 phút) VÀ bản này đang không phục vụ
 *  request nào — tức đang bị cắt CPU, chạy cũng chỉ đẻ thêm P1001. Đang có request (kể cả
 *  /api/cron/tick, nhịp ngoài có CPU) thì chạy như cũ. Request của người dùng KHÔNG bao giờ bị
 *  chặn ở đây.
 *
 *  Trạng thái trong tiến trình, như ngắt mạch proxy: mỗi bản tự nhìn đường nối của chính nó.
 * ═══════════════════════════════════════════════════════════════════════════════ */

const nghiMs = () => Math.max(10_000, parseInt(process.env.CSDL_NGHI_MS || '', 10) || 180_000)

let lanMatCuoi = 0
let soLanMat = 0
let dangPhucVu = 0

/** Hỏng kết nối CSDL lần CUỐI (đã thử lại hết) — gọi từ bocThuLai. */
export function ghiMatKetNoiCsdl(bayGio = Date.now()): void {
    lanMatCuoi = bayGio
    soLanMat++
}

/** Truy vấn vừa chạy được — đường nối sống lại, lịch chạy tiếp ngay. */
export function ghiCsdlTotLai(): void {
    if (lanMatCuoi) lanMatCuoi = 0
}

export function csdlVuaMatKetNoi(bayGio = Date.now()): boolean {
    return lanMatCuoi > 0 && bayGio - lanMatCuoi < nghiMs()
}

/* Đếm request đang phục vụ (middleware đầu tiên ở index.ts). Cloud Run (cpu-throttling) chỉ cấp CPU
 * khi có ít nhất MỘT request đang xử lý ⇒ đếm = 0 nghĩa là việc nền đang chạy chay không CPU. */
export function batDauRequest(): void {
    dangPhucVu++
}

export function xongRequest(): void {
    if (dangPhucVu > 0) dangPhucVu--
}

/** Lịch nền nên bỏ lượt này không. */
export function nenNghiLichNen(bayGio = Date.now()): boolean {
    return dangPhucVu === 0 && csdlVuaMatKetNoi(bayGio)
}

export function thongKeTrangThaiCsdl() {
    return {
        nghiMs: nghiMs(),
        dangPhucVu,
        soLanMat,
        matCachDayGiay: lanMatCuoi ? Math.round((Date.now() - lanMatCuoi) / 1000) : null,
        dangNghi: nenNghiLichNen(),
    }
}

/** Chỉ cho bộ kiểm chứng (scripts/check-hang-cho-proxy.ts). */
export function _datLaiTrangThaiCsdl(): void {
    lanMatCuoi = 0
    soLanMat = 0
    dangPhucVu = 0
}
