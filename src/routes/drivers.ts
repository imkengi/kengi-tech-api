import { Router, Request, Response } from 'express'
import { authMiddleware, getBranchFilter, AuthRequest, getBranchId } from '../middleware/auth'
import { cacheGet, cacheSet, cacheDel } from '../lib/cache'

const router = Router()

// GET /api/drivers
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const schema = req.user?.storeSchema || 'default'
        const cacheKey = `${schema}:drivers:${JSON.stringify(req.query)}`
        const cached = await cacheGet(cacheKey)
        if (cached) return res.json(cached)
        const prisma = req.storePrisma!
        const { search, status } = req.query
        const where: any = {}
        if (status && status !== 'all') where.status = status
        if (search) { const q = String(search); where.OR = [{ name: { contains: q } }, { code: { contains: q } }, { phone: { contains: q } }] }
        const data = await prisma.driver.findMany({ where, orderBy: { createdAt: 'desc' } })
        const _response = { success: true, data }
        await cacheSet(cacheKey, _response, 120)
        res.json(_response)
    } catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// POST /api/drivers
router.post('/', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { name, phone, vehicleType, vehiclePlate, licensePlate, notes } = req.body
        if (!name?.trim() || !phone?.trim()) return res.status(400).json({ success: false, error: 'Name and phone required' })
        const count = await prisma.driver.count({ where: {} })
        const code = `TX-${String(count + 1).padStart(3, '0')}`
        const plate = vehiclePlate || licensePlate || null
        const data = await prisma.driver.create({ data: { code, name, phone, vehicleType, vehiclePlate: plate, notes, status: 'available' } })
        cacheDel(`${req.user?.storeSchema || 'default'}:drivers:*`).catch(() => {})
        res.status(201).json({ success: true, data })
    } catch (err) { console.error('Create driver error:', err); res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// PUT /api/drivers/:id
router.put('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { name, phone, vehicleType, vehiclePlate, licensePlate, status, notes } = req.body
        const d: any = {}
        if (name) d.name = name; if (phone) d.phone = phone; if (vehicleType) d.vehicleType = vehicleType
        if (vehiclePlate !== undefined || licensePlate !== undefined) d.vehiclePlate = vehiclePlate || licensePlate
        if (status) d.status = status; if (notes !== undefined) d.notes = notes
        const data = await prisma.driver.update({ where: { id: String(req.params.id) }, data: d })
        res.json({ success: true, data })
    } catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// DELETE /api/drivers/:id
router.delete('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        await prisma.driver.delete({ where: { id: String(req.params.id) } }); res.json({ success: true })
    } catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

export default router
