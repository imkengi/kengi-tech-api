import { Router, Response } from 'express'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { requireRole } from '../middleware/roleMiddleware'

const router = Router()

// ─── GET /api/settings/sales-permissions ────────────────────────────────────
// Returns the salesCanCheckout flag — true = Sales role can checkout directly,
// false = Sales can only create SalesOrder for Cashier to process.
router.get('/sales-permissions', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const settings = await prisma.storeSettings.findFirst() as any
        res.json({
            success: true,
            data: {
                salesCanCheckout: Boolean(settings?.salesCanCheckout ?? false),
            },
        })
    } catch (err) {
        console.error('Get sales-permissions error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ─── PUT /api/settings/sales-permissions ────────────────────────────────────
router.put(
    '/sales-permissions',
    authMiddleware,
    requireRole('admin', 'manager', 'superadmin'),
    async (req: AuthRequest, res: Response) => {
        try {
            const prisma = req.storePrisma!
            const { salesCanCheckout } = req.body
            if (typeof salesCanCheckout !== 'boolean') {
                return res.status(400).json({ success: false, error: 'salesCanCheckout must be a boolean' })
            }

            const updated = await prisma.storeSettings.upsert({
                where: { id: 'default' },
                create: { id: 'default', name: 'My Store', salesCanCheckout, updatedAt: new Date() } as any,
                update: { salesCanCheckout } as any,
            }) as any

            res.json({
                success: true,
                data: { salesCanCheckout: Boolean(updated.salesCanCheckout) },
            })
        } catch (err) {
            console.error('Update sales-permissions error:', err)
            res.status(500).json({ success: false, error: 'Internal server error' })
        }
    }
)

export default router
