/**
 * QUYỀN XEM PILOT (TT-15, 10/11/2026) — ai được ĐỌC trạng thái Shopee / TikTok / Facebook / Ads Pilot.
 *
 * Vì sao có: trước đây GET /state (và các thao tác chỉ đọc như kiểm kết nối, tìm hàng) chỉ soát đăng nhập + tiện ích của cửa
 * hàng ⇒ thu ngân, nhân viên kho, tài xế… cầm JWT của chính mình gọi thẳng API là đọc được GIÁ VỐN, lãi, phí sàn từng mã,
 * chi tiêu quảng cáo — dù menu web đã ẩn mục Pilot với họ. Thao tác GHI vốn đã chặn theo vai trò (QUAN_LY trong từng route).
 *
 * Luật (cùng ngữ nghĩa requirePermission / coQuyen ở middleware/permissionMiddleware — owner/admin/superadmin toàn quyền,
 * quyền chi tiết đã gán ưu tiên, chưa gán thì theo vai trò):
 *   - mở Pilot nào cũng cần `online_products.view` («SP trên sàn» → Xem) — TRÙNG quyền menu web ((dashboard)/layout.tsx);
 *   - Pilot có SỐ TIỀN (Shopee, TikTok: giá vốn / lãi / phí; Ads: chi tiêu, giá vốn, lãi) cần thêm MỘT trong hai quyền
 *     «Giá vốn» (`products.view_cost`) / «Lợi nhuận» (`transactions.view_profit`) — đúng cặp sơ đồ mua hàng dùng để ẩn giá vốn
 *     (routes/customers.ts). Facebook Pilot (bài, bình luận, giá bán công khai) chỉ cần quyền thứ nhất.
 * Đọc quyền hỏng ⇒ 503 nói thật "chưa đọc được quyền" (vẫn chặn) — không giả là "thiếu quyền", cũng không mở cửa.
 */
import type { Response, NextFunction } from 'express'
import type { AuthRequest } from '../middleware/auth'
import { ROLE_PERMISSIONS, effectivePermissions, permissionSatisfied } from './rolePermissions'

/** Quyền mở trang Pilot — trùng quyền gắn cho 3 mục Pilot trên menu web. */
export const QUYEN_MO_PILOT = 'online_products.view'
/** Pilot có số tiền ⇒ cần thêm MỘT trong các quyền này. */
export const QUYEN_SO_TIEN_PILOT: readonly string[] = ['products.view_cost', 'transactions.view_profit']

// đường menu đối chiếu tay 10/11/2026: layout.tsx nhóm 'Hệ Thống' › 'Cài Đặt'; dashboard-settings tab id 'users' nhãn 'Nhân viên',
// tiêu đề khung 'Phân Quyền Chi Tiết' (check-chi-duong chỉ nhận đường đã duyệt)
const CHO_CAP = 'Nhờ chủ cửa hàng cấp ở Hệ Thống → Cài Đặt → tab Nhân viên (Phân Quyền Chi Tiết).'

export interface LyDoKhongXemPilot { status: 403 | 503; loi: string; ma: 'thieu_quyen_xem_pilot' | 'doc_quyen_hong' }

/** Lý do KHÔNG cho xem `ten` ("Shopee Pilot"…); null = được xem. `coSoTien`: trạng thái có giá vốn / lãi / phí / chi tiêu. */
export async function lyDoKhongXemPilot(req: AuthRequest, ten: string, coSoTien: boolean): Promise<LyDoKhongXemPilot | null> {
    const user = req.user
    if (!user) return { status: 403, loi: `Chưa xác thực tài khoản — không mở được ${ten}.`, ma: 'thieu_quyen_xem_pilot' }
    const role = String(user.role || '').toLowerCase()
    if (ROLE_PERMISSIONS[role]?.includes('*')) return null
    let granted: string[]
    try {
        const dbUser = await (req.storePrisma as any)?.user?.findUnique({ where: { id: user.userId }, select: { permissions: true } })
        let stored: string[] = []
        try { stored = JSON.parse(dbUser?.permissions || '[]') } catch { stored = [] }
        granted = effectivePermissions(role, Array.isArray(stored) ? stored : [])
    } catch (e: any) {
        console.warn(`[${ten}] đọc quyền xem lỗi:`, e?.message || e)
        return { status: 503, loi: `Chưa đọc được quyền của tài khoản để mở ${ten} — thử lại sau ít phút.`, ma: 'doc_quyen_hong' }
    }
    if (!permissionSatisfied(QUYEN_MO_PILOT, granted)) {
        return { status: 403, loi: `Tài khoản của bạn chưa có quyền xem «SP trên sàn» nên không mở được ${ten}. ${CHO_CAP}`, ma: 'thieu_quyen_xem_pilot' }
    }
    if (coSoTien && !QUYEN_SO_TIEN_PILOT.some(k => permissionSatisfied(k, granted))) {
        return {
            status: 403,
            loi: `${ten} hiện giá vốn, lãi và phí — tài khoản của bạn chưa có quyền «Giá vốn» hoặc «Lợi nhuận». ${CHO_CAP}`,
            ma: 'thieu_quyen_xem_pilot',
        }
    }
    return null
}

/** Middleware chặn XEM — gắn SAU authMiddleware + chặn tiện ích, cho cả GET trạng thái lẫn POST thao tác (người được ghi
 *  cũng phải được xem: kết quả lập kế hoạch giá mang giá vốn / lãi). */
export function chanXemPilot(ten: string, coSoTien: boolean) {
    return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
        const lyDo = await lyDoKhongXemPilot(req, ten, coSoTien)
        if (!lyDo) { next(); return }
        res.status(lyDo.status).json({ error: lyDo.loi, ma: lyDo.ma })
    }
}
