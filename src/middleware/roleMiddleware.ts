import { Request, Response, NextFunction } from 'express'

/**
 * Middleware to restrict route access by user role.
 * Must be used AFTER authMiddleware (which sets req.user).
 *
 * Usage: router.post('/', authMiddleware, requireRole('admin', 'manager'), handler)
 */
export function requireRole(...roles: string[]) {
    return (req: Request, res: Response, next: NextFunction) => {
        const user = (req as any).user
        if (!user) {
            return res.status(401).json({ success: false, error: 'Authentication required' })
        }
        if (!roles.includes(user.role)) {
            return res.status(403).json({ success: false, error: 'Bạn không có quyền thực hiện thao tác này' })
        }
        next()
    }
}
