import { Router, Request, Response } from 'express'
import { authMiddleware, getBranchFilter, AuthRequest, getBranchId } from '../middleware/auth'
import { validate } from '../middleware/validate'
import { CreateWarrantySchema, UpdateWarrantySchema } from '../schemas'
import { cacheGet, cacheSet, cacheDel } from '../lib/cache'

const router = Router()

// GET /api/warranties
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const schema = req.user?.storeSchema || 'default'
        const cacheKey = `${schema}:warranties:${JSON.stringify(req.query)}`
        const cached = await cacheGet(cacheKey)
        if (cached) return res.json(cached)
        const prisma = req.storePrisma!
        const { search, status } = req.query
        const where: any = {}
        if (status && status !== 'all') where.status = String(status)
        if (search) {
            const q = String(search)
            where.OR = [{ productName: { contains: q } }, { customerName: { contains: q } }, { code: { contains: q } }, { serialNumber: { contains: q } }]
        }
        const data = await prisma.warranty.findMany({ where, orderBy: { createdAt: 'desc' } })
        const _response = { success: true, data }
        await cacheSet(cacheKey, _response, 120)
        res.json(_response)
    } catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// POST /api/warranties
router.post('/', authMiddleware, validate(CreateWarrantySchema), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { productName, customerName, customerPhone, serialNumber, startDate, endDate, notes, productId } = req.body
        if (!productName?.trim() || !customerName?.trim()) return res.status(400).json({ success: false, error: 'Product and customer name required' })
        const count = await prisma.warranty.count()
        const code = `WR-${String(count + 1).padStart(4, '0')}`
        const data = await prisma.warranty.create({
            data: { code, productId, productName, customerName, customerPhone, serialNumber, startDate: new Date(startDate), endDate: new Date(endDate), notes },
        })
        cacheDel(`${req.user?.storeSchema || 'default'}:warranties:*`).catch(() => {})
        res.status(201).json({ success: true, data })
    } catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// PUT /api/warranties/:id
router.put('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { status, notes, endDate } = req.body
        const data = await prisma.warranty.update({ where: { id: String(req.params.id) }, data: { ...(status && { status }), ...(notes !== undefined && { notes }), ...(endDate && { endDate: new Date(endDate) }) } })
        res.json({ success: true, data })
    } catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// DELETE /api/warranties/:id
router.delete('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        await prisma.warranty.delete({ where: { id: String(req.params.id) } }); res.json({ success: true })
    }
    catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

export default router
