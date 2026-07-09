import { Router, Request, Response } from 'express'
import { authMiddleware, AuthRequest, canAccessBranch } from '../middleware/auth'
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
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
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

        // Cảnh báo giấy tờ sắp hết hạn (bảng có thể chưa tồn tại ở schema cũ → bọc try)
        let documentWarning = 0
        try {
            documentWarning = await prisma.vehicleDocument.count({
                where: { expiryDate: { not: null, lte: in30Days } }
            })
        } catch { /* bảng chưa migrate */ }

        // Tổng chi phí bảo trì + nhiên liệu (toàn bộ & trong tháng)
        let maintenanceCost = 0, maintenanceCostMonth = 0, fuelCost = 0, fuelCostMonth = 0
        try {
            const [mAll, mMonth] = await Promise.all([
                prisma.vehicleMaintenance.aggregate({ _sum: { cost: true } }),
                prisma.vehicleMaintenance.aggregate({ _sum: { cost: true }, where: { serviceDate: { gte: startOfMonth } } }),
            ])
            maintenanceCost = mAll._sum.cost || 0
            maintenanceCostMonth = mMonth._sum.cost || 0
        } catch { /* ignore */ }
        try {
            const [fAll, fMonth] = await Promise.all([
                prisma.vehicleFuelLog.aggregate({ _sum: { cost: true } }),
                prisma.vehicleFuelLog.aggregate({ _sum: { cost: true }, where: { fuelDate: { gte: startOfMonth } } }),
            ])
            fuelCost = fAll._sum.cost || 0
            fuelCostMonth = fMonth._sum.cost || 0
        } catch { /* bảng chưa migrate */ }

        res.json({
            success: true, data: {
                total: all.length, byStatus,
                warnings: { inspectionWarning, insuranceWarning, oilChangeWarning, documentWarning },
                costs: {
                    maintenanceCost, maintenanceCostMonth, fuelCost, fuelCostMonth,
                    totalCost: maintenanceCost + fuelCost,
                    totalCostMonth: maintenanceCostMonth + fuelCostMonth,
                },
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
            include: {
                maintenanceLogs: { orderBy: { serviceDate: 'desc' }, take: 5 },
                documents: { orderBy: { createdAt: 'desc' } },
            }
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
            include: {
                maintenanceLogs: { orderBy: { serviceDate: 'desc' } },
                fuelLogs: { orderBy: { fuelDate: 'desc' } },
                documents: { orderBy: { createdAt: 'desc' } },
            }
        })
        if (!data) return res.status(404).json({ success: false, error: 'Vehicle not found' })
        if (!canAccessBranch(req, data.branchId)) return res.status(404).json({ success: false, error: 'Vehicle not found' })
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
            const code = await nextCode(prisma as any, 'vehicleCodeSeq', 'XE', 3, '-', 'Vehicle', 'code')
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

// PUT /api/vehicles/maintenance/:logId — sửa 1 dòng bảo trì
router.put('/maintenance/:logId', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { type, description, cost, kmAtService, serviceDate, nextDueDate, performedBy, notes } = req.body
        const d: any = {}
        if (type !== undefined) d.type = type
        if (description !== undefined) d.description = description
        if (cost !== undefined) d.cost = Number(cost) || 0
        if (kmAtService !== undefined) d.kmAtService = Number(kmAtService) || 0
        if (serviceDate !== undefined) d.serviceDate = serviceDate ? new Date(serviceDate) : new Date()
        if (nextDueDate !== undefined) d.nextDueDate = nextDueDate ? new Date(nextDueDate) : null
        if (performedBy !== undefined) d.performedBy = performedBy
        if (notes !== undefined) d.notes = notes
        const data = await prisma.vehicleMaintenance.update({ where: { id: String(req.params.logId) }, data: d })
        cacheDel(`${req.user?.storeSchema || 'default'}:vehicles:*`).catch(() => { })
        res.json({ success: true, data })
    } catch (err) { console.error('Update maintenance error:', err); res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// DELETE /api/vehicles/maintenance/:logId — xóa 1 dòng bảo trì
router.delete('/maintenance/:logId', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        await prisma.vehicleMaintenance.delete({ where: { id: String(req.params.logId) } })
        cacheDel(`${req.user?.storeSchema || 'default'}:vehicles:*`).catch(() => { })
        res.json({ success: true })
    } catch (err) { console.error('Delete maintenance error:', err); res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// ─── Nhiên liệu ─────────────────────────────────────────────────────────────

// GET /api/vehicles/:id/fuel
router.get('/:id/fuel', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const data = await prisma.vehicleFuelLog.findMany({
            where: { vehicleId: String(req.params.id) },
            orderBy: { fuelDate: 'desc' },
        })
        res.json({ success: true, data })
    } catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// POST /api/vehicles/:id/fuel — thêm lần đổ nhiên liệu; tự cập nhật currentKm
router.post('/:id/fuel', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const vehicleId = String(req.params.id)
        const { fuelDate, liters, pricePerLiter, cost, kmAtFill, fuelType, station, isFullTank, notes } = req.body
        const litersN = Number(liters) || 0
        const ppl = Number(pricePerLiter) || 0
        // Nếu không nhập thành tiền thì suy ra từ lít × đơn giá
        const costN = cost !== undefined && cost !== '' ? Number(cost) || 0 : Math.round(litersN * ppl)
        const log = await prisma.vehicleFuelLog.create({
            data: {
                vehicleId,
                fuelDate: fuelDate ? new Date(fuelDate) : new Date(),
                liters: litersN,
                pricePerLiter: ppl,
                cost: costN,
                kmAtFill: kmAtFill ? Number(kmAtFill) : 0,
                fuelType: fuelType || null,
                station: station || null,
                isFullTank: isFullTank === undefined ? true : !!isFullTank,
                notes: notes || null,
            }
        })
        // Cập nhật số km hiện tại nếu odo mới lớn hơn
        if (kmAtFill && Number(kmAtFill) > 0) {
            const v = await prisma.vehicle.findUnique({ where: { id: vehicleId }, select: { currentKm: true } })
            if (v && Number(kmAtFill) > v.currentKm) {
                await prisma.vehicle.update({ where: { id: vehicleId }, data: { currentKm: Number(kmAtFill) } })
            }
        }
        cacheDel(`${req.user?.storeSchema || 'default'}:vehicles:*`).catch(() => { })
        res.status(201).json({ success: true, data: log })
    } catch (err) { console.error('Add fuel log error:', err); res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// PUT /api/vehicles/fuel/:logId
router.put('/fuel/:logId', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { fuelDate, liters, pricePerLiter, cost, kmAtFill, fuelType, station, isFullTank, notes } = req.body
        const d: any = {}
        if (fuelDate !== undefined) d.fuelDate = fuelDate ? new Date(fuelDate) : new Date()
        if (liters !== undefined) d.liters = Number(liters) || 0
        if (pricePerLiter !== undefined) d.pricePerLiter = Number(pricePerLiter) || 0
        if (cost !== undefined) d.cost = Number(cost) || 0
        if (kmAtFill !== undefined) d.kmAtFill = Number(kmAtFill) || 0
        if (fuelType !== undefined) d.fuelType = fuelType || null
        if (station !== undefined) d.station = station || null
        if (isFullTank !== undefined) d.isFullTank = !!isFullTank
        if (notes !== undefined) d.notes = notes || null
        const data = await prisma.vehicleFuelLog.update({ where: { id: String(req.params.logId) }, data: d })
        cacheDel(`${req.user?.storeSchema || 'default'}:vehicles:*`).catch(() => { })
        res.json({ success: true, data })
    } catch (err) { console.error('Update fuel log error:', err); res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// DELETE /api/vehicles/fuel/:logId
router.delete('/fuel/:logId', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        await prisma.vehicleFuelLog.delete({ where: { id: String(req.params.logId) } })
        cacheDel(`${req.user?.storeSchema || 'default'}:vehicles:*`).catch(() => { })
        res.json({ success: true })
    } catch (err) { console.error('Delete fuel log error:', err); res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// ─── Giấy tờ xe (đăng ký, đăng kiểm, bảo hiểm, phí đường bộ...) ──────────────

// GET /api/vehicles/:id/documents
router.get('/:id/documents', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const data = await prisma.vehicleDocument.findMany({
            where: { vehicleId: String(req.params.id) },
            orderBy: { createdAt: 'desc' },
        })
        res.json({ success: true, data })
    } catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// POST /api/vehicles/:id/documents — thêm giấy tờ; đồng bộ hạn KĐ/BH lên xe
router.post('/:id/documents', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const vehicleId = String(req.params.id)
        const { type, name, documentNumber, fileUrl, issuer, issueDate, expiryDate, notes } = req.body
        if (!type?.trim() || !name?.trim()) return res.status(400).json({ success: false, error: 'Type and name required' })
        const data = await prisma.vehicleDocument.create({
            data: {
                vehicleId, type, name,
                documentNumber: documentNumber || null,
                fileUrl: fileUrl || null,
                issuer: issuer || null,
                issueDate: issueDate ? new Date(issueDate) : null,
                expiryDate: expiryDate ? new Date(expiryDate) : null,
                notes: notes || null,
            }
        })
        // Đồng bộ hạn lên trường tổng hợp của xe để cảnh báo dùng chung
        if (expiryDate) {
            if (type === 'inspection') await prisma.vehicle.update({ where: { id: vehicleId }, data: { inspectionExpiry: new Date(expiryDate) } })
            if (type === 'insurance') await prisma.vehicle.update({ where: { id: vehicleId }, data: { insuranceExpiry: new Date(expiryDate) } })
        }
        cacheDel(`${req.user?.storeSchema || 'default'}:vehicles:*`).catch(() => { })
        res.status(201).json({ success: true, data })
    } catch (err) { console.error('Add document error:', err); res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// PUT /api/vehicles/documents/:docId
router.put('/documents/:docId', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { type, name, documentNumber, fileUrl, issuer, issueDate, expiryDate, notes } = req.body
        const d: any = {}
        if (type !== undefined) d.type = type
        if (name !== undefined) d.name = name
        if (documentNumber !== undefined) d.documentNumber = documentNumber || null
        if (fileUrl !== undefined) d.fileUrl = fileUrl || null
        if (issuer !== undefined) d.issuer = issuer || null
        if (issueDate !== undefined) d.issueDate = issueDate ? new Date(issueDate) : null
        if (expiryDate !== undefined) d.expiryDate = expiryDate ? new Date(expiryDate) : null
        if (notes !== undefined) d.notes = notes || null
        const data = await prisma.vehicleDocument.update({ where: { id: String(req.params.docId) }, data: d })
        cacheDel(`${req.user?.storeSchema || 'default'}:vehicles:*`).catch(() => { })
        res.json({ success: true, data })
    } catch (err) { console.error('Update document error:', err); res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// DELETE /api/vehicles/documents/:docId
router.delete('/documents/:docId', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        await prisma.vehicleDocument.delete({ where: { id: String(req.params.docId) } })
        cacheDel(`${req.user?.storeSchema || 'default'}:vehicles:*`).catch(() => { })
        res.json({ success: true })
    } catch (err) { console.error('Delete document error:', err); res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// GET /api/vehicles/:id/summary — tổng hợp chi phí + hiệu suất nhiên liệu 1 xe
router.get('/:id/summary', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const vehicleId = String(req.params.id)
        const [maint, fuel] = await Promise.all([
            prisma.vehicleMaintenance.findMany({ where: { vehicleId }, select: { cost: true } }),
            prisma.vehicleFuelLog.findMany({ where: { vehicleId }, orderBy: { kmAtFill: 'asc' }, select: { liters: true, cost: true, kmAtFill: true, isFullTank: true } }),
        ])
        const maintenanceCost = maint.reduce((s, m) => s + (m.cost || 0), 0)
        const fuelCost = fuel.reduce((s, f) => s + (f.cost || 0), 0)
        const totalLiters = fuel.reduce((s, f) => s + (f.liters || 0), 0)

        // Ước tính mức tiêu hao L/100km: dùng quãng đường giữa lần đổ đầu và cuối có odo hợp lệ
        const withKm = fuel.filter(f => f.kmAtFill > 0)
        let avgConsumption: number | null = null
        let distanceCovered = 0
        if (withKm.length >= 2) {
            distanceCovered = withKm[withKm.length - 1].kmAtFill - withKm[0].kmAtFill
            // Bỏ lít của lần đổ đầu (chưa tính vào quãng đường đó)
            const litersForDistance = withKm.slice(1).reduce((s, f) => s + (f.liters || 0), 0)
            if (distanceCovered > 0 && litersForDistance > 0) {
                avgConsumption = Number(((litersForDistance / distanceCovered) * 100).toFixed(2))
            }
        }

        res.json({
            success: true, data: {
                maintenanceCost, fuelCost, totalCost: maintenanceCost + fuelCost,
                totalLiters, avgConsumption, distanceCovered,
                maintenanceCount: maint.length, fuelCount: fuel.length,
            }
        })
    } catch (err) { console.error('Vehicle summary error:', err); res.status(500).json({ success: false, error: 'Internal server error' }) }
})

export default router
