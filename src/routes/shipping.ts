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
        const { search, status, transactionId } = req.query
        const where: any = {}
        if (status && status !== 'all') where.status = status
        if (transactionId) where.transactionId = String(transactionId)
        if (search) {
            const q = String(search)
            where.OR = [
                { code: { contains: q } },
                { customerName: { contains: q } },
                { address: { contains: q } },
                { trackingNumber: { contains: q } },
            ]
        }
        const data = await prisma.shippingOrder.findMany({ where, orderBy: { createdAt: 'desc' } })
        const _response = { success: true, data }
        await cacheSet(cacheKey, _response, 300)
        res.json(_response)
    } catch (err) {
        console.error('List shipping error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// POST /api/shipping
router.post('/', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const branchId = getBranchId(req)
        const {
            transactionId,
            customerName,
            customerPhone,
            address,
            driverId,
            driverName,
            vehicleId,
            vehiclePlate,
            carrier,
            trackingNumber,
            shippingFee,
            cod,
            estimatedDate,
            notes,
            status,
        } = req.body
        if (!customerName?.trim() || !address?.trim()) {
            return res.status(400).json({ success: false, error: 'Customer name and address required' })
        }

        // Resolve driver name from id if name not supplied
        let resolvedDriverName: string | null = driverName || null
        let resolvedVehiclePlate: string | null = vehiclePlate || null
        let resolvedDriverId: string | null = driverId || null

        if (vehicleId) {
            try {
                const veh = await prisma.vehicle.findUnique({ where: { id: String(vehicleId) } })
                if (veh) {
                    if (!resolvedVehiclePlate) resolvedVehiclePlate = veh.licensePlate
                    if (!resolvedDriverId && veh.assignedDriverId) resolvedDriverId = veh.assignedDriverId
                    if (!resolvedDriverName && veh.assignedDriverName) resolvedDriverName = veh.assignedDriverName
                }
            } catch {}
        }

        if (!resolvedDriverName && resolvedDriverId) {
            try {
                const drv = await prisma.driver.findUnique({ where: { id: String(resolvedDriverId) } })
                if (drv) resolvedDriverName = drv.name
            } catch {}
        }

        const count = await prisma.shippingOrder.count()
        const code = `SH-${String(count + 1).padStart(4, '0')}`
        const data = await prisma.shippingOrder.create({
            data: {
                code,
                transactionId: transactionId || null,
                customerName,
                customerPhone: customerPhone || null,
                address,
                driverId: resolvedDriverId,
                driverName: resolvedDriverName,
                vehicleId: vehicleId || null,
                vehiclePlate: resolvedVehiclePlate,
                carrier: carrier || 'self',
                trackingNumber: trackingNumber || code,
                status: status || 'preparing',
                shippingFee: Number(shippingFee) || 0,
                cod: Number(cod) || 0,
                estimatedDate: estimatedDate ? new Date(estimatedDate) : null,
                notes: notes || null,
                branchId: branchId || null,
            },
        })

        // Bump driver to "on_route" if newly assigned & currently available
        if (resolvedDriverId) {
            try {
                const drv = await prisma.driver.findUnique({ where: { id: String(resolvedDriverId) } })
                if (drv && drv.status === 'available') {
                    await prisma.driver.update({ where: { id: drv.id }, data: { status: 'on_route' } })
                }
            } catch {}
        }
        // Mark vehicle in_use if it was available
        if (vehicleId) {
            try {
                const veh = await prisma.vehicle.findUnique({ where: { id: String(vehicleId) } })
                if (veh && veh.status === 'available') {
                    await prisma.vehicle.update({ where: { id: veh.id }, data: { status: 'in_use' } })
                }
            } catch {}
        }

        cacheDel(`${req.user?.storeSchema || 'default'}:shipping:*`).catch(() => {})
        cacheDel(`${req.user?.storeSchema || 'default'}:drivers:*`).catch(() => {})
        res.status(201).json({ success: true, data })
    } catch (err) {
        console.error('Create shipping error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// PUT /api/shipping/:id
router.put('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const branchId = getBranchId(req)
        const { status, driverId, driverName, vehicleId, vehiclePlate, carrier, trackingNumber, notes, shippingFee, cod } = req.body
        const d: any = {}
        if (status) {
            d.status = status
            if (status === 'delivered') d.deliveredDate = new Date()
        }
        if (driverId !== undefined) d.driverId = driverId
        if (driverName !== undefined) d.driverName = driverName
        if (vehicleId !== undefined) d.vehicleId = vehicleId
        if (vehiclePlate !== undefined) d.vehiclePlate = vehiclePlate
        if (carrier !== undefined) d.carrier = carrier
        if (trackingNumber !== undefined) d.trackingNumber = trackingNumber
        if (notes !== undefined) d.notes = notes
        if (shippingFee !== undefined) d.shippingFee = Number(shippingFee) || 0
        if (cod !== undefined) d.cod = Number(cod) || 0
        const data = await prisma.shippingOrder.update({ where: { id: String(req.params.id) }, data: d })
        cacheDel(`${req.user?.storeSchema || 'default'}:shipping:*`).catch(() => {})
        res.json({ success: true, data })
    } catch (err) {
        console.error('Update shipping error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// DELETE /api/shipping/:id
router.delete('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const branchId = getBranchId(req)
        await prisma.shippingOrder.delete({ where: { id: String(req.params.id) } })
        cacheDel(`${req.user?.storeSchema || 'default'}:shipping:*`).catch(() => {})
        res.json({ success: true })
    } catch (err) {
        console.error('Delete shipping error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

export default router
