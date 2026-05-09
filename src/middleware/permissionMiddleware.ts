import { Response, NextFunction } from 'express'
import { AuthRequest } from './auth'

/**
 * Middleware to restrict route access by granular permission keys.
 * Must be used AFTER authMiddleware (which sets req.user and req.storePrisma).
 *
 * - Admin / superadmin always pass (full access).
 * - For everyone else, the user's `permissions` JSON array (loaded from DB)
 *   must include AT LEAST ONE of the required permission keys.
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

        // Admin and superadmin bypass all permission checks
        if (user.role === 'admin' || user.role === 'superadmin') {
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

            const granted: string[] = JSON.parse(dbUser?.permissions || '[]')
            const ok = permissionKeys.some(k => granted.includes(k))
            if (!ok) {
                res.status(403).json({ error: 'Không có quyền truy cập' })
                return
            }
            next()
        } catch (err) {
            console.error('requirePermission error:', err)
            res.status(500).json({ success: false, error: 'Internal server error' })
        }
    }
}
