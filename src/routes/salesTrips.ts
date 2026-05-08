import { Router, Response } from 'express'
import { authMiddleware, AuthRequest, getBranchFilter, getBranchId } from '../middleware/auth'
import { requireRole } from '../middleware/roleMiddleware'
import { validate } from '../middleware/validate'
import {
    CreateSalesTripSchema,
    LoadSalesTripSchema,
    SalesTripSaleSchema,
    ReconcileSalesTripSchema,
    CloseSalesTripSchema,
    CancelSalesTripSchema,
} from '../schemas'

const router = Router()

// ─── State machine ────────────────────────────────────────────────────────────
// planned → loaded → active → reconciling → closed
//   ↘ cancelled (from planned/loaded only — refunds load back to main stock)
type TripStatus = 'planned' | 'loaded' | 'active' | 'reconciling' | 'closed' | 'cancelled'

const TRIP_INCLUDE = {
    vehicle: {
        select: {
            id: true,
            code: true,
            name: true,
            licensePlate: true,
            status: true,
            assignedDriverId: true,
            assignedDriverName: true,
        },
    },
    warehouse: { select: { id: true, code: true, name: true, type: true } },
    items: true,
}

const MANAGER_ROLES = ['admin', 'manager', 'superadmin']
const TRIP_OPERATOR_ROLES = ['admin', 'manager', 'superadmin', 'cashier', 'driver', 'staff']

function isManager(role?: string): boolean {
    return !!role && MANAGER_ROLES.includes(role)
}

// Vehicle is fit-to-trip when in one of these statuses
const VEHICLE_AVAILABLE_STATUSES = new Set(['available', 'active'])
// Vehicle status while a trip is active
const VEHICLE_BUSY_STATUS = 'in_use'

// ─── Helper: ensure mobile warehouse exists for the given vehicle ─────────────
// Each vehicle gets its own mobile warehouse (1:1 via Warehouse.vehicleId).
async function ensureVehicleWarehouse(prisma: any, vehicle: any): Promise<any> {
    let wh = await prisma.warehouse.findFirst({ where: { vehicleId: vehicle.id } })
    if (wh) return wh

    const code = `WH-VEH-${vehicle.code}`.toUpperCase().slice(0, 50)
    try {
        wh = await prisma.warehouse.create({
            data: {
                code,
                name: `Kho xe - ${vehicle.name}`,
                type: 'mobile',
                vehicleId: vehicle.id,
                branchId: vehicle.branchId || null,
                description: `Kho lưu động gắn với xe ${vehicle.code} (${vehicle.licensePlate || ''})`.trim(),
                isDefault: false,
                isActive: true,
            },
        })
    } catch {
        // Concurrent create — fetch the now-existing warehouse
        wh = await prisma.warehouse.findFirst({ where: { vehicleId: vehicle.id } })
        if (!wh) throw new Error('Không tạo được kho cho xe')
    }
    return wh
}

// ─── Helper: generate unique trip code with retry ─────────────────────────────
async function nextTripCode(tx: any): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt++) {
        const count = await tx.salesTrip.count()
        const code = `TRIP-${String(count + 1 + attempt).padStart(5, '0')}`
        const dup = await tx.salesTrip.findFirst({ where: { code }, select: { id: true } })
        if (!dup) return code
    }
    return `TRIP-${Date.now()}`
}

// ─── Helper: load product info for a list of productIds ───────────────────────
async function loadProducts(prisma: any, productIds: string[]) {
    const products = await prisma.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, name: true, sku: true, stock: true, sellingPrice: true },
    })
    return new Map<string, any>(products.map((p: any) => [p.id, p]))
}

// ─── Helper: scope filter (own trip for non-managers) ─────────────────────────
function scopeFilter(req: AuthRequest, base: any = {}): any {
    const where: any = { ...base, ...getBranchFilter(req as any) }
    if (!isManager(req.user?.role)) where.salesUserId = req.user!.userId
    return where
}

// ═════════════════════════════════════════════════════════════════════════════
// GET /api/sales-trips
// ═════════════════════════════════════════════════════════════════════════════
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma! as any
        const { status, vehicleId, search, page = '1', pageSize = '20' } = req.query

        const where: any = scopeFilter(req)
        if (status && status !== 'all') where.status = String(status)
        if (vehicleId) where.vehicleId = String(vehicleId)
        if (search) {
            const q = String(search)
            where.OR = [
                { code: { contains: q, mode: 'insensitive' } },
                { driverName: { contains: q, mode: 'insensitive' } },
                { salesUserName: { contains: q, mode: 'insensitive' } },
                { notes: { contains: q, mode: 'insensitive' } },
            ]
        }

        const pageNum = Math.max(1, parseInt(String(page)))
        const size = Math.max(1, Math.min(100, parseInt(String(pageSize))))

        const [total, items] = await Promise.all([
            prisma.salesTrip.count({ where }),
            prisma.salesTrip.findMany({
                where,
                include: TRIP_INCLUDE,
                orderBy: { createdAt: 'desc' },
                skip: (pageNum - 1) * size,
                take: size,
            }),
        ])

        res.json({
            success: true,
            data: { items, total, page: pageNum, pageSize: size, totalPages: Math.ceil(total / size) },
        })
    } catch (err) {
        console.error('List sales trips error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ═════════════════════════════════════════════════════════════════════════════
// GET /api/sales-trips/:id
// ═════════════════════════════════════════════════════════════════════════════
router.get('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma! as any
        const trip = await prisma.salesTrip.findFirst({
            where: scopeFilter(req, { id: String(req.params.id) }),
            include: TRIP_INCLUDE,
        })
        if (!trip) return res.status(404).json({ success: false, error: 'Không tìm thấy chuyến bán hàng' })
        res.json({ success: true, data: trip })
    } catch (err) {
        console.error('Get sales trip error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ═════════════════════════════════════════════════════════════════════════════
// POST /api/sales-trips — create trip + (optional) initial load
// ═════════════════════════════════════════════════════════════════════════════
router.post(
    '/',
    authMiddleware,
    requireRole(...TRIP_OPERATOR_ROLES),
    validate(CreateSalesTripSchema),
    async (req: AuthRequest, res: Response) => {
        try {
            const prisma = req.storePrisma! as any
            const { vehicleId, plannedDate, notes, items, driverId, driverName } = req.body

            // Resolve vehicle within branch scope
            const branchScope = getBranchFilter(req as any)
            const vehicle = await prisma.vehicle.findFirst({ where: { id: vehicleId, ...branchScope } })
            if (!vehicle) return res.status(404).json({ success: false, error: 'Không tìm thấy xe' })
            if (!VEHICLE_AVAILABLE_STATUSES.has(vehicle.status)) {
                return res.status(400).json({
                    success: false,
                    error: `Xe đang ở trạng thái "${vehicle.status}", không thể tạo chuyến mới`,
                })
            }

            // Block if vehicle already has an open trip
            const openTrip = await prisma.salesTrip.findFirst({
                where: { vehicleId, status: { in: ['planned', 'loaded', 'active', 'reconciling'] } },
                select: { id: true, code: true, status: true },
            })
            if (openTrip) {
                return res.status(409).json({
                    success: false,
                    error: `Xe đang ở trong chuyến ${openTrip.code} (${openTrip.status})`,
                })
            }

            // Ensure mobile warehouse for this vehicle
            const warehouse = await ensureVehicleWarehouse(prisma, vehicle)

            // Validate stock for any initial-load items
            const inputItems: any[] = Array.isArray(items) ? items : []
            const productMap = inputItems.length
                ? await loadProducts(prisma, inputItems.map(i => i.productId))
                : new Map<string, any>()
            for (const it of inputItems) {
                const p = productMap.get(it.productId)
                if (!p) return res.status(400).json({ success: false, error: `Sản phẩm không tồn tại: ${it.productId}` })
                if ((p.stock || 0) < it.quantity) {
                    return res.status(400).json({
                        success: false,
                        error: `Không đủ tồn kho chính cho "${p.name}" (cần ${it.quantity}, còn ${p.stock || 0})`,
                    })
                }
            }

            const branchId = getBranchId(req) || null
            const callerName = req.user?.email || null
            const initialStatus: TripStatus = inputItems.length > 0 ? 'loaded' : 'planned'
            const totalLoaded = inputItems.reduce((s, it) => s + (it.quantity || 0), 0)

            const trip = await prisma.$transaction(async (tx: any) => {
                const code = await nextTripCode(tx)

                const created = await tx.salesTrip.create({
                    data: {
                        code,
                        vehicleId: vehicle.id,
                        warehouseId: warehouse.id,
                        status: initialStatus,
                        driverId: driverId ?? vehicle.assignedDriverId ?? null,
                        driverName: driverName ?? vehicle.assignedDriverName ?? null,
                        salesUserId: req.user!.userId,
                        salesUserName: callerName,
                        branchId,
                        plannedDate: plannedDate ? new Date(plannedDate) : null,
                        notes: notes || null,
                        totalLoaded,
                        items: {
                            create: inputItems.map((it: any) => {
                                const p = productMap.get(it.productId)
                                return {
                                    productId: it.productId,
                                    productName: p.name,
                                    productSku: p.sku || null,
                                    loadedQty: it.quantity,
                                    unitPrice: it.unitPrice ?? p.sellingPrice ?? 0,
                                    notes: it.notes || null,
                                }
                            }),
                        },
                    },
                    include: TRIP_INCLUDE,
                })

                // Apply load: main stock → vehicle warehouse
                if (inputItems.length > 0) {
                    // 1) Stock-transfer record (main → vehicle warehouse)
                    let transferCode = ''
                    for (let attempt = 0; attempt < 5; attempt++) {
                        const count = await tx.stockTransfer.count()
                        transferCode = `TRF-${String(count + 1 + attempt).padStart(5, '0')}`
                        const dup = await tx.stockTransfer.findFirst({ where: { code: transferCode }, select: { id: true } })
                        if (!dup) break
                    }
                    await tx.stockTransfer.create({
                        data: {
                            code: transferCode,
                            fromWarehouseId: null,
                            toWarehouseId: warehouse.id,
                            status: 'completed',
                            reason: 'sales_trip_load',
                            notes: `Chất hàng lên xe cho chuyến ${created.code}`,
                            branchId,
                            userId: req.user!.userId,
                            userName: callerName,
                            totalQuantity: totalLoaded,
                            items: {
                                create: inputItems.map((it: any) => {
                                    const p = productMap.get(it.productId)
                                    return {
                                        productId: it.productId,
                                        productName: p.name,
                                        productSku: p.sku || null,
                                        quantity: it.quantity,
                                    }
                                }),
                            },
                        },
                    })

                    // 2) Move stock: decrement Product.stock, upsert WarehouseStock
                    for (const it of inputItems) {
                        const p = productMap.get(it.productId)
                        await tx.product.update({
                            where: { id: it.productId },
                            data: { stock: { decrement: it.quantity } },
                        })
                        await tx.warehouseStock.upsert({
                            where: { warehouseId_productId: { warehouseId: warehouse.id, productId: it.productId } },
                            update: { quantity: { increment: it.quantity }, productName: p.name, productSku: p.sku || null },
                            create: {
                                warehouseId: warehouse.id,
                                productId: it.productId,
                                productName: p.name,
                                productSku: p.sku || null,
                                quantity: it.quantity,
                            },
                        })
                    }
                }

                return created
            })

            res.status(201).json({ success: true, data: trip })
        } catch (err: any) {
            console.error('Create sales trip error:', err)
            res.status(500).json({ success: false, error: 'Internal server error', detail: err?.message })
        }
    },
)

// ═════════════════════════════════════════════════════════════════════════════
// POST /api/sales-trips/:id/load — add more stock to an existing trip
// (allowed in planned / loaded only)
// ═════════════════════════════════════════════════════════════════════════════
router.post(
    '/:id/load',
    authMiddleware,
    requireRole(...TRIP_OPERATOR_ROLES),
    validate(LoadSalesTripSchema),
    async (req: AuthRequest, res: Response) => {
        try {
            const prisma = req.storePrisma! as any
            const tripId = String(req.params.id)
            const { items } = req.body as { items: Array<{ productId: string; quantity: number; unitPrice?: number; notes?: string }> }

            const trip = await prisma.salesTrip.findFirst({
                where: scopeFilter(req, { id: tripId }),
                include: { items: true },
            })
            if (!trip) return res.status(404).json({ success: false, error: 'Không tìm thấy chuyến bán hàng' })
            if (!['planned', 'loaded'].includes(trip.status)) {
                return res.status(400).json({
                    success: false,
                    error: `Chỉ chất hàng được khi chuyến đang ở trạng thái planned hoặc loaded (hiện tại: ${trip.status})`,
                })
            }

            const productMap = await loadProducts(prisma, items.map(i => i.productId))
            for (const it of items) {
                const p = productMap.get(it.productId)
                if (!p) return res.status(400).json({ success: false, error: `Sản phẩm không tồn tại: ${it.productId}` })
                if ((p.stock || 0) < it.quantity) {
                    return res.status(400).json({
                        success: false,
                        error: `Không đủ tồn kho chính cho "${p.name}" (cần ${it.quantity}, còn ${p.stock || 0})`,
                    })
                }
            }

            const totalAdded = items.reduce((s, it) => s + (it.quantity || 0), 0)
            const branchId = trip.branchId || getBranchId(req) || null
            const callerName = req.user?.email || null

            const updated = await prisma.$transaction(async (tx: any) => {
                // Stock transfer record
                let transferCode = ''
                for (let attempt = 0; attempt < 5; attempt++) {
                    const count = await tx.stockTransfer.count()
                    transferCode = `TRF-${String(count + 1 + attempt).padStart(5, '0')}`
                    const dup = await tx.stockTransfer.findFirst({ where: { code: transferCode }, select: { id: true } })
                    if (!dup) break
                }
                await tx.stockTransfer.create({
                    data: {
                        code: transferCode,
                        fromWarehouseId: null,
                        toWarehouseId: trip.warehouseId,
                        status: 'completed',
                        reason: 'sales_trip_load',
                        notes: `Bổ sung hàng lên xe cho chuyến ${trip.code}`,
                        branchId,
                        userId: req.user!.userId,
                        userName: callerName,
                        totalQuantity: totalAdded,
                        items: {
                            create: items.map(it => {
                                const p = productMap.get(it.productId)
                                return {
                                    productId: it.productId,
                                    productName: p.name,
                                    productSku: p.sku || null,
                                    quantity: it.quantity,
                                }
                            }),
                        },
                    },
                })

                // Move stock
                for (const it of items) {
                    const p = productMap.get(it.productId)
                    await tx.product.update({
                        where: { id: it.productId },
                        data: { stock: { decrement: it.quantity } },
                    })
                    await tx.warehouseStock.upsert({
                        where: { warehouseId_productId: { warehouseId: trip.warehouseId, productId: it.productId } },
                        update: { quantity: { increment: it.quantity }, productName: p.name, productSku: p.sku || null },
                        create: {
                            warehouseId: trip.warehouseId,
                            productId: it.productId,
                            productName: p.name,
                            productSku: p.sku || null,
                            quantity: it.quantity,
                        },
                    })

                    // Update trip item (upsert pattern)
                    await tx.salesTripItem.upsert({
                        where: { tripId_productId: { tripId: trip.id, productId: it.productId } },
                        update: {
                            loadedQty: { increment: it.quantity },
                            unitPrice: it.unitPrice ?? undefined,
                        },
                        create: {
                            tripId: trip.id,
                            productId: it.productId,
                            productName: p.name,
                            productSku: p.sku || null,
                            loadedQty: it.quantity,
                            unitPrice: it.unitPrice ?? p.sellingPrice ?? 0,
                            notes: it.notes || null,
                        },
                    })
                }

                return tx.salesTrip.update({
                    where: { id: trip.id },
                    data: {
                        status: 'loaded',
                        totalLoaded: { increment: totalAdded },
                    },
                    include: TRIP_INCLUDE,
                })
            })

            res.json({ success: true, data: updated })
        } catch (err: any) {
            console.error('Load sales trip error:', err)
            res.status(500).json({ success: false, error: 'Internal server error', detail: err?.message })
        }
    },
)

// ═════════════════════════════════════════════════════════════════════════════
// POST /api/sales-trips/:id/start — begin the run (loaded → active)
// ═════════════════════════════════════════════════════════════════════════════
router.post(
    '/:id/start',
    authMiddleware,
    requireRole(...TRIP_OPERATOR_ROLES),
    async (req: AuthRequest, res: Response) => {
        try {
            const prisma = req.storePrisma! as any
            const tripId = String(req.params.id)

            const trip = await prisma.salesTrip.findFirst({
                where: scopeFilter(req, { id: tripId }),
            })
            if (!trip) return res.status(404).json({ success: false, error: 'Không tìm thấy chuyến bán hàng' })
            if (trip.status !== 'loaded') {
                return res.status(400).json({
                    success: false,
                    error: `Chỉ bắt đầu được chuyến đã chất hàng (hiện tại: ${trip.status})`,
                })
            }

            const updated = await prisma.$transaction(async (tx: any) => {
                await tx.vehicle.update({ where: { id: trip.vehicleId }, data: { status: VEHICLE_BUSY_STATUS } })
                return tx.salesTrip.update({
                    where: { id: trip.id },
                    data: { status: 'active', startedAt: new Date() },
                    include: TRIP_INCLUDE,
                })
            })

            res.json({ success: true, data: updated })
        } catch (err: any) {
            console.error('Start sales trip error:', err)
            res.status(500).json({ success: false, error: 'Internal server error', detail: err?.message })
        }
    },
)

// ═════════════════════════════════════════════════════════════════════════════
// POST /api/sales-trips/:id/sales — record sales from the vehicle (active only)
// Decrements WarehouseStock on the vehicle warehouse, increments soldQty.
// ═════════════════════════════════════════════════════════════════════════════
router.post(
    '/:id/sales',
    authMiddleware,
    requireRole(...TRIP_OPERATOR_ROLES),
    validate(SalesTripSaleSchema),
    async (req: AuthRequest, res: Response) => {
        try {
            const prisma = req.storePrisma! as any
            const tripId = String(req.params.id)
            const { items, notes } = req.body as {
                items: Array<{ productId: string; quantity: number; unitPrice?: number; notes?: string }>
                notes?: string
            }

            const trip = await prisma.salesTrip.findFirst({
                where: scopeFilter(req, { id: tripId }),
                include: { items: true },
            })
            if (!trip) return res.status(404).json({ success: false, error: 'Không tìm thấy chuyến bán hàng' })
            if (trip.status !== 'active') {
                return res.status(400).json({
                    success: false,
                    error: `Chỉ ghi nhận bán hàng khi chuyến đang chạy (hiện tại: ${trip.status})`,
                })
            }

            // Validate vehicle warehouse stock for each item
            const productIds = items.map(i => i.productId)
            const stocks = await prisma.warehouseStock.findMany({
                where: { warehouseId: trip.warehouseId, productId: { in: productIds } },
            })
            const stockMap = new Map<string, any>(stocks.map((s: any) => [s.productId, s]))

            for (const it of items) {
                const stk = stockMap.get(it.productId)
                if (!stk || (stk.quantity || 0) < it.quantity) {
                    return res.status(400).json({
                        success: false,
                        error: `Trên xe không đủ "${stk?.productName || it.productId}" (cần ${it.quantity}, còn ${stk?.quantity || 0})`,
                    })
                }
            }

            // Compute revenue from items (use provided unitPrice; fall back to trip item unitPrice)
            const tripItemMap = new Map<string, any>(trip.items.map((ti: any) => [ti.productId, ti]))
            let revenueDelta = 0
            for (const it of items) {
                const ti = tripItemMap.get(it.productId)
                const price = it.unitPrice ?? ti?.unitPrice ?? 0
                revenueDelta += price * it.quantity
            }
            const totalSoldDelta = items.reduce((s, it) => s + it.quantity, 0)

            const updated = await prisma.$transaction(async (tx: any) => {
                for (const it of items) {
                    const stk = stockMap.get(it.productId)
                    // Decrement vehicle warehouse stock
                    await tx.warehouseStock.update({
                        where: { warehouseId_productId: { warehouseId: trip.warehouseId, productId: it.productId } },
                        data: { quantity: { decrement: it.quantity } },
                    })
                    // Increment trip item soldQty (upsert in case of off-list ad-hoc sales)
                    const ti = tripItemMap.get(it.productId)
                    await tx.salesTripItem.upsert({
                        where: { tripId_productId: { tripId: trip.id, productId: it.productId } },
                        update: { soldQty: { increment: it.quantity }, unitPrice: it.unitPrice ?? undefined },
                        create: {
                            tripId: trip.id,
                            productId: it.productId,
                            productName: stk?.productName || ti?.productName || 'Unknown',
                            productSku: stk?.productSku || ti?.productSku || null,
                            loadedQty: 0,
                            soldQty: it.quantity,
                            unitPrice: it.unitPrice ?? ti?.unitPrice ?? 0,
                            notes: it.notes || null,
                        },
                    })
                }

                return tx.salesTrip.update({
                    where: { id: trip.id },
                    data: {
                        totalSold: { increment: totalSoldDelta },
                        totalRevenue: { increment: revenueDelta },
                        notes: notes ? `${trip.notes ? trip.notes + '\n' : ''}${notes}` : trip.notes,
                    },
                    include: TRIP_INCLUDE,
                })
            })

            res.json({ success: true, data: updated })
        } catch (err: any) {
            console.error('Record sales trip sale error:', err)
            res.status(500).json({ success: false, error: 'Internal server error', detail: err?.message })
        }
    },
)

// ═════════════════════════════════════════════════════════════════════════════
// POST /api/sales-trips/:id/reconcile — set status to reconciling and optionally
// record actual returned-quantity per item (for variance tracking).
// ═════════════════════════════════════════════════════════════════════════════
router.post(
    '/:id/reconcile',
    authMiddleware,
    requireRole(...TRIP_OPERATOR_ROLES),
    validate(ReconcileSalesTripSchema),
    async (req: AuthRequest, res: Response) => {
        try {
            const prisma = req.storePrisma! as any
            const tripId = String(req.params.id)
            const { items, notes } = req.body as {
                items?: Array<{ productId: string; actualReturnedQty: number; notes?: string }>
                notes?: string
            }

            const trip = await prisma.salesTrip.findFirst({
                where: scopeFilter(req, { id: tripId }),
                include: { items: true },
            })
            if (!trip) return res.status(404).json({ success: false, error: 'Không tìm thấy chuyến bán hàng' })
            if (!['active', 'reconciling'].includes(trip.status)) {
                return res.status(400).json({
                    success: false,
                    error: `Chỉ đối soát được chuyến đang chạy (hiện tại: ${trip.status})`,
                })
            }

            const updated = await prisma.$transaction(async (tx: any) => {
                if (items && items.length) {
                    for (const it of items) {
                        await tx.salesTripItem.updateMany({
                            where: { tripId: trip.id, productId: it.productId },
                            data: {
                                returnedQty: it.actualReturnedQty,
                                notes: it.notes ?? undefined,
                            },
                        })
                    }
                }
                return tx.salesTrip.update({
                    where: { id: trip.id },
                    data: {
                        status: 'reconciling',
                        notes: notes ? `${trip.notes ? trip.notes + '\n' : ''}${notes}` : trip.notes,
                    },
                    include: TRIP_INCLUDE,
                })
            })

            res.json({ success: true, data: updated })
        } catch (err: any) {
            console.error('Reconcile sales trip error:', err)
            res.status(500).json({ success: false, error: 'Internal server error', detail: err?.message })
        }
    },
)

// ═════════════════════════════════════════════════════════════════════════════
// POST /api/sales-trips/:id/close — close the trip and return remaining vehicle
// stock to main inventory. Manager-only.
// ═════════════════════════════════════════════════════════════════════════════
router.post(
    '/:id/close',
    authMiddleware,
    requireRole('admin', 'manager', 'superadmin'),
    validate(CloseSalesTripSchema),
    async (req: AuthRequest, res: Response) => {
        try {
            const prisma = req.storePrisma! as any
            const tripId = String(req.params.id)
            const { notes } = req.body as { notes?: string }

            const trip = await prisma.salesTrip.findFirst({
                where: { id: tripId, ...getBranchFilter(req as any) },
            })
            if (!trip) return res.status(404).json({ success: false, error: 'Không tìm thấy chuyến bán hàng' })
            if (!['active', 'reconciling'].includes(trip.status)) {
                return res.status(400).json({
                    success: false,
                    error: `Chỉ đóng được chuyến đang chạy hoặc đang đối soát (hiện tại: ${trip.status})`,
                })
            }

            // Pull remaining stock on the vehicle
            const remaining = await prisma.warehouseStock.findMany({
                where: { warehouseId: trip.warehouseId, quantity: { gt: 0 } },
            })

            const totalReturned = remaining.reduce((s: number, r: any) => s + r.quantity, 0)
            const branchId = trip.branchId || getBranchId(req) || null
            const callerName = req.user?.email || null

            const updated = await prisma.$transaction(async (tx: any) => {
                // Vehicle warehouse → main stock (back to Product.stock)
                if (remaining.length > 0) {
                    let transferCode = ''
                    for (let attempt = 0; attempt < 5; attempt++) {
                        const count = await tx.stockTransfer.count()
                        transferCode = `TRF-${String(count + 1 + attempt).padStart(5, '0')}`
                        const dup = await tx.stockTransfer.findFirst({ where: { code: transferCode }, select: { id: true } })
                        if (!dup) break
                    }
                    await tx.stockTransfer.create({
                        data: {
                            code: transferCode,
                            fromWarehouseId: trip.warehouseId,
                            toWarehouseId: null,
                            status: 'completed',
                            reason: 'sales_trip_return',
                            notes: `Trả hàng từ xe về kho chính khi đóng chuyến ${trip.code}`,
                            branchId,
                            userId: req.user!.userId,
                            userName: callerName,
                            totalQuantity: totalReturned,
                            items: {
                                create: remaining.map((r: any) => ({
                                    productId: r.productId,
                                    productName: r.productName,
                                    productSku: r.productSku || null,
                                    quantity: r.quantity,
                                })),
                            },
                        },
                    })

                    for (const r of remaining) {
                        await tx.warehouseStock.update({
                            where: { warehouseId_productId: { warehouseId: trip.warehouseId, productId: r.productId } },
                            data: { quantity: 0 },
                        })
                        await tx.product.update({
                            where: { id: r.productId },
                            data: { stock: { increment: r.quantity } },
                        })
                        // Reflect actual return on trip items (only if returnedQty wasn't already
                        // reconciled to a non-zero value)
                        await tx.salesTripItem.updateMany({
                            where: { tripId: trip.id, productId: r.productId, returnedQty: 0 },
                            data: { returnedQty: r.quantity },
                        })
                    }
                }

                // Free the vehicle
                await tx.vehicle.update({
                    where: { id: trip.vehicleId },
                    data: { status: 'available' },
                })

                return tx.salesTrip.update({
                    where: { id: trip.id },
                    data: {
                        status: 'closed',
                        closedAt: new Date(),
                        totalReturned,
                        notes: notes ? `${trip.notes ? trip.notes + '\n' : ''}${notes}` : trip.notes,
                    },
                    include: TRIP_INCLUDE,
                })
            })

            res.json({ success: true, data: updated })
        } catch (err: any) {
            console.error('Close sales trip error:', err)
            res.status(500).json({ success: false, error: 'Internal server error', detail: err?.message })
        }
    },
)

// ═════════════════════════════════════════════════════════════════════════════
// POST /api/sales-trips/:id/cancel — only for planned/loaded; refunds load
// ═════════════════════════════════════════════════════════════════════════════
router.post(
    '/:id/cancel',
    authMiddleware,
    requireRole(...TRIP_OPERATOR_ROLES),
    validate(CancelSalesTripSchema),
    async (req: AuthRequest, res: Response) => {
        try {
            const prisma = req.storePrisma! as any
            const tripId = String(req.params.id)
            const { reason } = req.body as { reason?: string }

            const trip = await prisma.salesTrip.findFirst({
                where: scopeFilter(req, { id: tripId }),
            })
            if (!trip) return res.status(404).json({ success: false, error: 'Không tìm thấy chuyến bán hàng' })
            if (!['planned', 'loaded'].includes(trip.status)) {
                return res.status(400).json({
                    success: false,
                    error: `Chỉ hủy được chuyến chưa khởi hành (hiện tại: ${trip.status})`,
                })
            }

            // Return any loaded stock back to main
            const stocks = await prisma.warehouseStock.findMany({
                where: { warehouseId: trip.warehouseId, quantity: { gt: 0 } },
            })
            const totalReturned = stocks.reduce((s: number, r: any) => s + r.quantity, 0)
            const branchId = trip.branchId || getBranchId(req) || null
            const callerName = req.user?.email || null

            const updated = await prisma.$transaction(async (tx: any) => {
                if (stocks.length > 0) {
                    let transferCode = ''
                    for (let attempt = 0; attempt < 5; attempt++) {
                        const count = await tx.stockTransfer.count()
                        transferCode = `TRF-${String(count + 1 + attempt).padStart(5, '0')}`
                        const dup = await tx.stockTransfer.findFirst({ where: { code: transferCode }, select: { id: true } })
                        if (!dup) break
                    }
                    await tx.stockTransfer.create({
                        data: {
                            code: transferCode,
                            fromWarehouseId: trip.warehouseId,
                            toWarehouseId: null,
                            status: 'completed',
                            reason: 'sales_trip_cancel',
                            notes: `Hủy chuyến ${trip.code} - trả hàng về kho chính`,
                            branchId,
                            userId: req.user!.userId,
                            userName: callerName,
                            totalQuantity: totalReturned,
                            items: {
                                create: stocks.map((r: any) => ({
                                    productId: r.productId,
                                    productName: r.productName,
                                    productSku: r.productSku || null,
                                    quantity: r.quantity,
                                })),
                            },
                        },
                    })

                    for (const r of stocks) {
                        await tx.warehouseStock.update({
                            where: { warehouseId_productId: { warehouseId: trip.warehouseId, productId: r.productId } },
                            data: { quantity: 0 },
                        })
                        await tx.product.update({
                            where: { id: r.productId },
                            data: { stock: { increment: r.quantity } },
                        })
                    }
                }

                return tx.salesTrip.update({
                    where: { id: trip.id },
                    data: {
                        status: 'cancelled',
                        closedAt: new Date(),
                        totalReturned,
                        notes: reason
                            ? `${trip.notes ? trip.notes + '\n' : ''}Hủy: ${reason}`
                            : trip.notes,
                    },
                    include: TRIP_INCLUDE,
                })
            })

            res.json({ success: true, data: updated })
        } catch (err: any) {
            console.error('Cancel sales trip error:', err)
            res.status(500).json({ success: false, error: 'Internal server error', detail: err?.message })
        }
    },
)

export default router
