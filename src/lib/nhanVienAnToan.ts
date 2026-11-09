/**
 * NHÂN VIÊN RA TRÌNH DUYỆT / APP — chỉ những cột CÓ TÊN trong danh sách trắng (09/11/2026).
 *
 * Trước 09/11/2026 `GET /api/employees` (cả `/:id`, `POST /`, `PUT /:id`, `PUT /:id/toggle-status`) trả
 * NGUYÊN dòng User, chỉ bỏ mỗi `password` (`const { password, ...rest } = u`). Mọi cột còn lại lọt ra, trong đó:
 *   · `twoFactorSecret` — hạt TOTP. Cầm nó là tự sinh được mã Google Authenticator hợp lệ của người đó.
 *   · `trustedDevices`  — mỗi phần tử có `id` = deviceId; gửi deviceId đó lúc đăng nhập là BỎ QUA hẳn bước 2FA
 *                         (routes/auth.ts, nhánh `isTrusted` của POST /login).
 * Ai có quyền `employees.view` (quản lý; có cửa hàng cấp cả nhân viên) mở DevTools là vượt được 2FA của chủ shop.
 * Danh sách còn nằm trong cache 300 giây. `GET /api/admin/users` còn nặng hơn: rải `...u` — kèm cả HASH MẬT
 * KHẨU của mọi nhân viên mọi cửa hàng (mật khẩu mặc định khi tạo nhân viên là '123456' ⇒ hash dò ra ngay).
 *
 * DANH SÁCH TRẮNG thay cho danh sách cấm: cột mới thêm vào model User KHÔNG tự lọt ra ngoài (thiếu dữ liệu thì
 * thấy ngay, lộ khoá thì không ai thấy). `npm run check:nhan-vien-an-toan` đỏ khi: có cột User chưa xếp loại,
 * danh sách trắng chứa cột bí mật / thiếu trường app đang dùng, hoặc một route đưa dòng User thô ra res.json.
 *
 * Giá trị trong DB GIỮ NGUYÊN — đây chỉ là lớp ra; luồng đăng nhập / xác minh 2FA vẫn đọc đủ các cột bí mật.
 */

/** Cột BÍ MẬT của User — chỉ máy chủ đọc (so mật khẩu, xác minh mã 2FA, nhận thiết bị tin cậy). */
export const COT_NHAN_VIEN_BI_MAT = ['password', 'twoFactorSecret', 'trustedDevices'] as const

/**
 * `select` an toàn cho model User — dùng cho MỌI đường trả nhân viên ra ngoài.
 *
 * Giữ đủ trường web và app đang đọc: web `features/employees/hooks/useEmployees.ts` (interface Employee) + trang
 * Nhân viên đọc thêm `username`; app Android `data/model/Models.kt` › `Employee`. `permissions` / `isLocked` /
 * `twoFactorEnabled` là quyền và trạng thái, không phải khoá — `USER_SELECT` của routes/auth.ts cũng trả chúng.
 */
export const CHON_NHAN_VIEN_AN_TOAN = {
    id: true, code: true, email: true, username: true, name: true,
    role: true, phone: true, avatar: true,
    salary: true, hireDate: true, shifts: true, totalSales: true,
    employeeStatus: true, notes: true,
    isLocked: true, twoFactorEnabled: true, permissions: true,
    branchId: true, createdAt: true, updatedAt: true,
    branch: { select: { id: true, name: true, code: true, isMainBranch: true } },
}
