import { Response, NextFunction } from 'express'
import { AuthRequest } from './auth'
import { effectivePermissions, permissionSatisfied, ROLE_PERMISSIONS } from '../lib/rolePermissions'

/**
 * Middleware to restrict route access by granular permission keys.
 * Must be used AFTER authMiddleware (which sets req.user and req.storePrisma).
 *
 * Ngữ nghĩa khớp ĐÚNG frontend authStore.hasPermission:
 *  - owner / admin / superadmin  → toàn quyền (bypass).
 *  - user có permissions chi tiết → khớp theo "họ khóa" (family): route yêu cầu
 *    'products.view' được thỏa bởi 'products.view_list' / 'products' (module) …
 *  - user CHƯA gán permissions   → fallback theo ROLE_PERMISSIONS của role
 *    (manager/cashier/staff/warranty/driver) — trước đây thiếu fallback này nên
 *    mọi user không phải admin bị 403 sạch dù UI vẫn hiện nút.
 *
 * requirePermission(a, b): OR — chỉ cần thỏa 1 trong các key là qua.
 *
 * Usage:
 *   router.get('/', authMiddleware, requirePermission('products.view'), handler)
 *   router.post('/', authMiddleware, requirePermission('products.view', 'products.create'), handler)
 */
export function requirePermission(...permissionKeys: string[]) {
    return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
        const user = req.user
        if (!user) {
            res.status(401).json({ success: false, error: 'Authentication required' })
            return
        }

        const role = String(user.role || '').toLowerCase()
        // Toàn quyền: owner/admin/superadmin (khớp bypass của frontend + '*' trong map)
        if (ROLE_PERMISSIONS[role]?.includes('*')) {
            next()
            return
        }

        try {
            const prisma = req.storePrisma
            if (!prisma) {
                res.status(500).json({ success: false, error: 'Store context required' })
                return
            }

            const dbUser = await prisma.user.findUnique({
                where: { id: user.userId },
                select: { permissions: true },
            })

            let stored: string[] = []
            try { stored = JSON.parse(dbUser?.permissions || '[]') } catch { stored = [] }

            // Ưu tiên permissions đã gán; nếu rỗng → fallback theo role
            const granted = effectivePermissions(role, stored)
            const ok = permissionKeys.some(k => permissionSatisfied(k, granted))
            if (!ok) {
                res.status(403).json({ success: false, error: 'Không có quyền truy cập' })
                return
            }
            next()
        } catch (err) {
            console.error('requirePermission error:', err)
            res.status(500).json({ success: false, error: 'Internal server error' })
        }
    }
}
