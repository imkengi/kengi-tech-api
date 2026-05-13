import { Router, Request, Response } from 'express'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { cacheGet, cacheSet, cacheDel } from '../lib/cache'
import { nextCode, withCodeCollisionRetry } from '../lib/codeGenerator'

const router = Router()

// GET /api/vehicles/stats
router.get('/stats', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const all = await prisma.vehicle.findMany({
            select: { status: true, inspectionExpiry: true, insuranceExpiry: true, currentKm: true, lastOilChangeKm: true }
        })
        const now = new Date()
        const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
        const byStatus: Record<string, number> = {}
        let inspectionWarning = 0
        let insuranceWarning = 0
        let oilChangeWarning = 0
        for (const v of all) {
            byStatus[v.status || 'available'] = (byStatus[v.status || 'available'] || 0) + 1
            if (v.inspectionExpiry && new Date(v.inspectionExpiry) <= in30Days) inspectionWarning++
            if (v.insuranceExpiry && new Date(v.insuranceExpiry) <= in30Days) insuranceWarning++
            if (v.currentKm - v.lastOilChangeKm >= 4500) oilChangeWarning++
        }
        res.json({
            success: true, data: {
                total: all.length, byStatus,
                warnings: { inspectionWarning, insuranceWarning, oilChangeWarning }
            }
        })
    } catch (err) { console.error('Vehicle stats error:', err); res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// GET /api/vehicles
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const schema = req.user?.storeSchema || 'default'
        const cacheKey = `${schema}:vehicles:${JSON.stringify(req.query)}`
        const cached = await cacheGet(cacheKey)
        if (cached) return res.json(cached)
        const prisma = req.storePrisma!
        const { search, status, type } = req.query
        const where: any = {}
        if (status && status !== 'all') where.status = status
        if (type && type !== 'all') where.type = type
        if (search) {
            const q = String(search)
            where.OR = [
                { name: { contains: q } },
                { code: { contains: q } },
                { licensePlate: { contains: q } },
                { brand: { contains: q } },
                { assignedDriverName: { contains: q } },
            ]
        }
        const data = await prisma.vehicle.findMany({
            where, orderBy: { createdAt: 'desc' },
            include: { maintenanceLogs: { orderBy: { serviceDate: 'desc' }, take: 5 } }
        })
        const _response = { success: true, data }
        await cacheSet(cacheKey, _response, 300)
        res.json(_response)
    } catch (err) { console.error('Vehicles list error:', err); res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// GET /api/vehicles/:id
router.get('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const data = await prisma.vehicle.findUnique({
            where: { id: String(req.params.id) },
            include: { maintenanceLogs: { orderBy: { serviceDate: 'desc' } } }
        })
        if (!data) return res.status(404).json({ success: false, error: 'Vehicle not found' })
        res.json({ success: true, data })
    } catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// POST /api/vehicles
router.post('/', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { name, type, licensePlate, brand, model, year, color, currentKm, lastOilChangeKm, inspectionExpiry, insuranceExpiry, assignedDriverId, assignedDriverName, imageUrl, notes, branchId } = req.body
        if (!name?.trim() || !licensePlate?.trim()) return res.status(400).json({ success: false, error: 'Name and license plate required' })
        // Atomic sequence-based code generation. The previous `count(*) + 1`
        // pattern reused codes after a delete and raced under concurrent POSTs,
        // both of which surfaced as P2002 on Vehicle.code. The retry advances
        // the sequence past any pre-existing rows so first-time use on a
        // populated database also succeeds.
        const data = await withCodeCollisionRetry(async () => {
            const code = await nextCode(prisma as any, 'vehicleCodeSeq', 'XE', 3)
            return prisma.vehicle.create({
                data: {
                    code, name, type: type || 'car', licensePlate,
                    brand, model, year: year ? Number(year) : null, color,
                    currentKm: currentKm ? Number(currentKm) : 0,
                    lastOilChangeKm: lastOilChangeKm ? Number(lastOilChangeKm) : 0,
                    inspectionExpiry: inspectionExpiry ? new Date(inspectionExpiry) : null,
                    insuranceExpiry: insuranceExpiry ? new Date(insuranceExpiry) : null,
                    assignedDriverId, assignedDriverName, imageUrl, notes, branchId,
                    status: 'available'
                }
            })
        })
        cacheDel(`${req.user?.storeSchema || 'default'}:vehicles:*`).catch(() => { })
        res.status(201).json({ success: true, data })
    } catch (err) { console.error('Create vehicle error:', err); res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// PUT /api/vehicles/:id
router.put('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { name, type, licensePlate, brand, model, year, color, currentKm, lastOilChangeKm, inspectionExpiry, insuranceExpiry, assignedDriverId, assignedDriverName, status, imageUrl, notes, branchId } = req.body
        const d: any = {}
        if (name !== undefined) d.name = name
        if (type !== undefined) d.type = type
        if (licensePlate !== undefined) d.licensePlate = licensePlate
        if (brand !== undefined) d.brand = brand
        if (model !== undefined) d.model = model
        if (year !== undefined) d.year = year ? Number(year) : null
        if (color !== undefined) d.color = color
        if (currentKm !== undefined) d.currentKm = Number(currentKm)
        if (lastOilChangeKm !== undefined) d.lastOilChangeKm = Number(lastOilChangeKm)
        if (inspectionExpiry !== undefined) d.inspectionExpiry = inspectionExpiry ? new Date(inspectionExpiry) : null
        if (insuranceExpiry !== undefined) d.insuranceExpiry = insuranceExpiry ? new Date(insuranceExpiry) : null
        if (assignedDriverId !== undefined) d.assignedDriverId = assignedDriverId
        if (assignedDriverName !== undefined) d.assignedDriverName = assignedDriverName
        if (status !== undefined) d.status = status
        if (imageUrl !== undefined) d.imageUrl = imageUrl
        if (notes !== undefined) d.notes = notes
        if (branchId !== undefined) d.branchId = branchId
        const data = await prisma.vehicle.update({ where: { id: String(req.params.id) }, data: d })
        cacheDel(`${req.user?.storeSchema || 'default'}:vehicles:*`).catch(() => { })
        res.json({ success: true, data })
    } catch (err) { console.error('Update vehicle error:', err); res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// DELETE /api/vehicles/:id
router.delete('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        await prisma.vehicle.delete({ where: { id: String(req.params.id) } })
        cacheDel(`${req.user?.storeSchema || 'default'}:vehicles:*`).catch(() => { })
        res.json({ success: true })
    } catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// POST /api/vehicles/:id/maintenance
router.post('/:id/maintenance', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const vehicleId = String(req.params.id)
        const { type, description, cost, kmAtService, serviceDate, nextDueDate, performedBy, notes } = req.body
        if (!type?.trim() || !description?.trim()) return res.status(400).json({ success: false, error: 'Type and description required' })
        const log = await prisma.vehicleMaintenance.create({
            data: {
                vehicleId, type, description,
                cost: cost ? Number(cost) : 0,
                kmAtService: kmAtService ? Number(kmAtService) : 0,
                serviceDate: serviceDate ? new Date(serviceDate) : new Date(),
                nextDueDate: nextDueDate ? new Date(nextDueDate) : null,
                performedBy, notes,
            }
        })
        // Auto-update vehicle km and lastOilChangeKm if oil_change
        const updates: any = {}
        if (kmAtService && Number(kmAtService) > 0) updates.currentKm = Number(kmAtService)
        if (type === 'oil_change' && kmAtService) updates.lastOilChangeKm = Number(kmAtService)
        if (type === 'inspection' && nextDueDate) updates.inspectionExpiry = new Date(nextDueDate)
        if (type === 'insurance' && nextDueDate) updates.insuranceExpiry = new Date(nextDueDate)
        if (Object.keys(updates).length > 0) {
            await prisma.vehicle.update({ where: { id: vehicleId }, data: updates })
        }
        cacheDel(`${req.user?.storeSchema || 'default'}:vehicles:*`).catch(() => { })
        res.status(201).json({ success: true, data: log })
    } catch (err) { console.error('Add maintenance error:', err); res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// GET /api/vehicles/:id/maintenance
router.get('/:id/maintenance', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const data = await prisma.vehicleMaintenance.findMany({
            where: { vehicleId: String(req.params.id) },
            orderBy: { serviceDate: 'desc' },
        })
        res.json({ success: true, data })
    } catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

export default router
