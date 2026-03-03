import { Router, Request, Response } from 'express'
import { authMiddleware, getBranchFilter, AuthRequest, getBranchId } from '../middleware/auth'
import { cacheGet, cacheSet, cacheDel } from '../lib/cache'

const router = Router()

// GET /api/shipping
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const schema = req.user?.storeSchema || 'default'
        const cacheKey = `${schema}:shipping:${JSON.stringify(req.query)}`
        const cached = await cacheGet(cacheKey)
        if (cached) return res.json(cached)
        const prisma = req.storePrisma!
        const branchId = getBranchId(req)
        const { search, status } = req.query
        const where: any = {}
        if (status && status !== 'all') where.status = status
        if (search) { const q = String(search); where.OR = [{ code: { contains: q } }, { customerName: { contains: q } }, { address: { contains: q } }] }
        const data = await prisma.shippingOrder.findMany({ where, orderBy: { createdAt: 'desc' } })
        const _response = { success: true, data }
        await cacheSet(cacheKey, _response, 120)
        res.json(_response)
    } catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// POST /api/shipping
router.post('/', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const branchId = getBranchId(req)
        const { transactionId, customerName, customerPhone, address, driverId, driverName, shippingFee, cod, estimatedDate, notes } = req.body
        if (!customerName?.trim() || !address?.trim()) return res.status(400).json({ success: false, error: 'Customer name and address required' })
        const count = await prisma.shippingOrder.count()
        const code = `SH-${String(count + 1).padStart(4, '0')}`
        const data = await prisma.shippingOrder.create({ data: { code, transactionId, customerName, customerPhone, address, driverId, driverName, shippingFee: Number(shippingFee) || 0, cod: Number(cod) || 0, estimatedDate: estimatedDate ? new Date(estimatedDate) : null, notes },
        })
        cacheDel(`${req.user?.storeSchema || 'default'}:shipping:*`).catch(() => {})
        res.status(201).json({ success: true, data })
    } catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// PUT /api/shipping/:id
router.put('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const branchId = getBranchId(req)
        const { status, driverId, driverName, notes } = req.body
        const d: any = {}
        if (status) { d.status = status; if (status === 'delivered') d.deliveredDate = new Date() }
        if (driverId !== undefined) d.driverId = driverId
        if (driverName !== undefined) d.driverName = driverName
        if (notes !== undefined) d.notes = notes
        const data = await prisma.shippingOrder.update({ where: { id: String(req.params.id) }, data: d })
        res.json({ success: true, data })
    } catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// DELETE /api/shipping/:id
router.delete('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const branchId = getBranchId(req)
        await prisma.shippingOrder.delete({ where: { id: String(req.params.id) } }); res.json({ success: true }) }
    catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

export default router
