import { Router, Response } from 'express'
import { authMiddleware, AuthRequest, getBranchId } from '../middleware/auth'
import { cacheGet, cacheSet, cacheDel } from '../lib/cache'

const router = Router()

const STOP_STATUS = new Set(['pending', 'arrived', 'delivered', 'failed'])
const ROUTE_STATUS = new Set(['planned', 'in_progress', 'completed'])

// GET /api/delivery-routes
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const schema = req.user?.storeSchema || 'default'
        const cacheKey = `${schema}:delivery-routes:${JSON.stringify(req.query)}`
        const cached = await cacheGet(cacheKey)
        if (cached) return res.json(cached)
        const prisma = req.storePrisma!
        const { driverId, date, status } = req.query
        const where: any = {}
        if (driverId) where.driverId = String(driverId)
        if (date) where.date = String(date)
        if (status && status !== 'all') where.status = String(status)
        const data = await prisma.deliveryRoute.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            include: { stops: { orderBy: { sequence: 'asc' } } },
        })
        const _response = { success: true, data }
        await cacheSet(cacheKey, _response, 300)
        res.json(_response)
    } catch (err) {
        console.error('List delivery routes error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// GET /api/delivery-routes/:id
router.get('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const data = await prisma.deliveryRoute.findUnique({
            where: { id: String(req.params.id) },
            include: { stops: { orderBy: { sequence: 'asc' } } },
        })
        if (!data) return res.status(404).json({ success: false, error: 'Route not found' })
        res.json({ success: true, data })
    } catch (err) {
        console.error('Get delivery route error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// POST /api/delivery-routes
router.post('/', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const branchId = getBranchId(req)
        const {
            name,
            date,
            driverId,
            driverName,
            status,
            startTime,
            endTime,
            fuelCost,
            stops,
        } = req.body

        if (!name?.trim() || !date?.trim() || !driverId?.trim()) {
            return res.status(400).json({ success: false, error: 'name, date, and driverId are required' })
        }

        // Resolve driver name from id if not supplied
        let resolvedDriverName: string = driverName || ''
        if (!resolvedDriverName) {
            try {
                const drv = await prisma.driver.findUnique({ where: { id: String(driverId) } })
                if (drv) resolvedDriverName = drv.name
            } catch {}
        }

        const stopsInput: any[] = Array.isArray(stops) ? stops : []
        const data = await prisma.deliveryRoute.create({
            data: {
                name,
                date,
                driverId,
                driverName: resolvedDriverName,
                status: status && ROUTE_STATUS.has(status) ? status : 'planned',
                startTime: startTime ? new Date(startTime) : null,
                endTime: endTime ? new Date(endTime) : null,
                fuelCost: fuelCost == null ? null : (typeof fuelCost === 'string' ? fuelCost : JSON.stringify(fuelCost)),
                createdBy: req.user?.userId || '',
                branchId: branchId || null,
                stops: {
                    create: stopsInput.map((s, idx) => ({
                        sequence: Number.isFinite(Number(s.sequence)) ? Number(s.sequence) : idx + 1,
                        customerName: String(s.customerName || ''),
                        customerPhone: s.customerPhone || null,
                        address: String(s.address || ''),
                        invoiceCode: s.invoiceCode || null,
                        invoiceId: s.invoiceId || null,
                        productCount: Number(s.productCount) || 0,
                        total: Number(s.total) || 0,
                        status: STOP_STATUS.has(s.status) ? s.status : 'pending',
                        notes: s.notes || null,
                        deliveredAt: s.deliveredAt ? new Date(s.deliveredAt) : null,
                    })),
                },
            },
            include: { stops: { orderBy: { sequence: 'asc' } } },
        })

        cacheDel(`${req.user?.storeSchema || 'default'}:delivery-routes:*`).catch(() => {})
        res.status(201).json({ success: true, data })
    } catch (err) {
        console.error('Create delivery route error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// PUT /api/delivery-routes/:id
router.put('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { name, status, startTime, endTime, fuelCost, driverId, driverName } = req.body
        const d: any = {}
        if (name !== undefined) d.name = name
        if (status !== undefined) {
            if (!ROUTE_STATUS.has(status)) {
                return res.status(400).json({ success: false, error: `Invalid status: ${status}` })
            }
            d.status = status
        }
        if (startTime !== undefined) d.startTime = startTime ? new Date(startTime) : null
        if (endTime !== undefined) d.endTime = endTime ? new Date(endTime) : null
        if (fuelCost !== undefined) d.fuelCost = fuelCost == null ? null : (typeof fuelCost === 'string' ? fuelCost : JSON.stringify(fuelCost))
        if (driverId !== undefined) d.driverId = driverId
        if (driverName !== undefined) d.driverName = driverName

        // Use transaction when status changes to also update vehicle
        let data: any
        if (status !== undefined) {
            data = await (prisma as any).$transaction(async (tx: any) => {
                const updated = await tx.deliveryRoute.update({
                    where: { id: String(req.params.id) },
                    data: d,
                    include: { stops: { orderBy: { sequence: 'asc' } } },
                })

                // Auto-manage vehicle status based on delivery route status
                const route = await tx.deliveryRoute.findUnique({
                    where: { id: String(req.params.id) },
                    select: { driverId: true },
                })
                if (route?.driverId) {
                    const vehicle = await tx.vehicle.findFirst({
                        where: { assignedDriverId: route.driverId },
                        select: { id: true, status: true },
                    })
                    if (vehicle) {
                        if (status === 'in_progress' && vehicle.status === 'available') {
                            await tx.vehicle.update({
                                where: { id: vehicle.id },
                                data: { status: 'in_use' },
                            })
                        } else if ((status === 'completed' || status === 'cancelled') && vehicle.status === 'in_use') {
                            await tx.vehicle.update({
                                where: { id: vehicle.id },
                                data: { status: 'available' },
                            })
                        }
                    }
                }

                return updated
            })
        } else {
            data = await prisma.deliveryRoute.update({
                where: { id: String(req.params.id) },
                data: d,
                include: { stops: { orderBy: { sequence: 'asc' } } },
            })
        }
        cacheDel(`${req.user?.storeSchema || 'default'}:delivery-routes:*`).catch(() => {})
        res.json({ success: true, data })
    } catch (err) {
        console.error('Update delivery route error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// PUT /api/delivery-routes/:id/stops/:stopId
router.put('/:id/stops/:stopId', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { status, notes, deliveredAt } = req.body
        const d: any = {}
        if (status !== undefined) {
            if (!STOP_STATUS.has(status)) {
                return res.status(400).json({ success: false, error: `Invalid stop status: ${status}` })
            }
            d.status = status
            // Auto-stamp deliveredAt the first time a stop is marked delivered
            if (status === 'delivered' && deliveredAt === undefined) {
                d.deliveredAt = new Date()
            }
        }
        if (notes !== undefined) d.notes = notes
        if (deliveredAt !== undefined) d.deliveredAt = deliveredAt ? new Date(deliveredAt) : null

        const stop = await prisma.deliveryStop.findUnique({ where: { id: String(req.params.stopId) } })
        if (!stop || stop.routeId !== String(req.params.id)) {
            return res.status(404).json({ success: false, error: 'Stop not found on this route' })
        }
        const data = await prisma.deliveryStop.update({ where: { id: stop.id }, data: d })
        cacheDel(`${req.user?.storeSchema || 'default'}:delivery-routes:*`).catch(() => {})
        res.json({ success: true, data })
    } catch (err) {
        console.error('Update delivery stop error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// DELETE /api/delivery-routes/:id
router.delete('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        // If route was in_progress, free the driver's vehicle
        const route = await prisma.deliveryRoute.findUnique({
            where: { id: String(req.params.id) },
            select: { status: true, driverId: true },
        })
        await (prisma as any).$transaction(async (tx: any) => {
            await tx.deliveryRoute.delete({ where: { id: String(req.params.id) } })
            if (route?.status === 'in_progress' && route.driverId) {
                const vehicle = await tx.vehicle.findFirst({
                    where: { assignedDriverId: route.driverId, status: 'in_use' },
                    select: { id: true },
                })
                if (vehicle) {
                    await tx.vehicle.update({
                        where: { id: vehicle.id },
                        data: { status: 'available' },
                    })
                }
            }
        })
        cacheDel(`${req.user?.storeSchema || 'default'}:delivery-routes:*`).catch(() => {})
        res.json({ success: true })
    } catch (err) {
        console.error('Delete delivery route error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

export default router
