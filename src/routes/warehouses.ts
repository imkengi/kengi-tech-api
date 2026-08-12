import { Router, Response } from 'express'
import { errorDetail } from '../lib/errorResponse'
import { authMiddleware, AuthRequest, getBranchFilter, getBranchId } from '../middleware/auth'
import { requireRole } from '../middleware/roleMiddleware'
import { validate } from '../middleware/validate'
import {
    CreateWarehouseSchema,
    UpdateWarehouseSchema,
    CreateStockTransferSchema,
} from '../schemas'
import { nextCode } from '../lib/codeGenerator'
import { adjustSellableStock, getOrCreateDefaultWarehouse, updateWarehouseStock } from '../lib/warehouseHelper'

// Ném ra khi guard tồn (gte) không trừ được vì tồn đã đổi do race → rollback + 409.
class TransferConflictError extends Error {}

const router = Router()

const DEFAULT_WAREHOUSES: Array<{ code: string; name: string; type: string; isDefault: boolean; description: string }> = [
    { code: 'WH-MAIN', name: 'Kho chính', type: 'main', isDefault: true, description: 'Kho hàng hóa chính, đồng bộ với tồn kho sản phẩm' },
    { code: 'WH-DAMAGED', name: 'Kho hàng hư hỏng', type: 'damaged', isDefault: true, description: 'Kho chứa hàng bị hư hỏng, không bán được' },
    { code: 'WH-WARRANTY', name: 'Kho hàng bảo hành', type: 'warranty', isDefault: true, description: 'Kho chứa hàng đang trong quá trình bảo hành / đã thu hồi để bảo hành' },
]

// ─── Role-based access for warehouse types ─────────────────────────────────────
// Warranty warehouse: chỉ admin & nhân viên bảo hành/bảo trì truy cập
// Damaged / main / other: read mở; write giới hạn admin+manager
function canReadWarehouseType(role: string | undefined, type: string): boolean {
    if (role === 'admin') return true
    if (type === 'warranty') return role === 'warranty'
    return true
}

function canWriteWarehouseType(role: string | undefined, type: string): boolean {
    if (role === 'admin') return true
    if (type === 'warranty') return role === 'warranty'
    return role === 'manager'
}

const WARRANTY_FORBIDDEN_MSG = 'Chỉ admin hoặc nhân viên bảo hành / bảo trì mới có quyền truy cập kho bảo hành'

// ─── Branch scope for warehouse access ─────────────────────────────────────────
// Admins and managers operate store-wide: they see warehouses across all branches
// and can run cross-branch stock transfers, so the branch filter is dropped for
// them. Everyone else stays scoped to their own branch (getBranchFilter).
function warehouseBranchFilter(req: AuthRequest): Record<string, any> {
    const role = req.user?.role
    if (role === 'admin' || role === 'manager') return {}
    return getBranchFilter(req as any)
}

// ─── Helper: ensure default warehouses exist (lazy seed, idempotent) ────────────
export async function ensureDefaultWarehouses(prisma: any, branchId: string | null | undefined): Promise<void> {
    const normalizedBranchId = branchId || null
    for (const w of DEFAULT_WAREHOUSES) {
        // Idempotent: only seed a default warehouse of this type when none exists
        // yet for this branch. Re-check inside the loop so concurrent calls from
        // multiple contexts (GET list, branch create) don't each create one.
        const existing = await prisma.warehouse.findFirst({
            where: { type: w.type, isDefault: true, branchId: normalizedBranchId },
        })
        if (!existing) {
            try {
                await prisma.warehouse.create({
                    data: {
                        code: branchId ? `${w.code}-${branchId.slice(-6).toUpperCase()}` : w.code,
                        name: w.name,
                        type: w.type,
                        description: w.description,
                        isDefault: true,
                        isActive: true,
                        branchId: normalizedBranchId,
                    },
                })
            } catch {
                // Ignore unique constraint races; another request seeded the same warehouse
            }
        }
    }
    // Best-effort cleanup of any duplicates left over from earlier non-idempotent seeding
    await dedupDefaultWarehouses(prisma, normalizedBranchId)
}

// ─── Helper: de-dup default warehouses for a branch (SAFE) ───────────────────────
// For each default type, if more than one DEFAULT warehouse exists for the branch,
// KEEP exactly one (prefer one that HAS stock, else the oldest by createdAt) and
// DELETE only duplicates that are completely EMPTY and UNREFERENCED — zero
// WarehouseStock rows AND no stock transfers AND no sales trips. NEVER delete a
// warehouse that has stock or references. Fully guarded with try/catch.
async function dedupDefaultWarehouses(prisma: any, branchId: string | null | undefined): Promise<void> {
    const normalizedBranchId = branchId || null
    try {
        for (const w of DEFAULT_WAREHOUSES) {
            const candidates = await prisma.warehouse.findMany({
                where: { type: w.type, isDefault: true, branchId: normalizedBranchId },
                orderBy: { createdAt: 'asc' },
            })
            if (candidates.length <= 1) continue

            // Count references per candidate
            const enriched: Array<{ wh: any; stockCount: number; refCount: number }> = []
            for (const wh of candidates) {
                const [stockCount, fromCount, toCount, tripCount] = await Promise.all([
                    prisma.warehouseStock.count({ where: { warehouseId: wh.id } }).catch(() => 0),
                    prisma.stockTransfer.count({ where: { fromWarehouseId: wh.id } }).catch(() => 0),
                    prisma.stockTransfer.count({ where: { toWarehouseId: wh.id } }).catch(() => 0),
                    prisma.salesTrip.count({ where: { warehouseId: wh.id } }).catch(() => 0),
                ])
                enriched.push({ wh, stockCount, refCount: fromCount + toCount + tripCount })
            }

            // Pick the keeper: first one with stock, else the oldest (already sorted asc)
            const keeper = enriched.find((e) => e.stockCount > 0) || enriched[0]

            for (const e of enriched) {
                if (e.wh.id === keeper.wh.id) continue
                // Only delete duplicates that are truly empty and unreferenced
                if (e.stockCount === 0 && e.refCount === 0 && !e.wh.vehicleId) {
                    try {
                        await prisma.warehouse.delete({ where: { id: e.wh.id } })
                    } catch {
                        // Leave it in place if delete fails (e.g. unexpected FK reference)
                    }
                }
            }
        }
    } catch (err) {
        console.error('dedupDefaultWarehouses error (non-fatal):', err)
    }
}

// ─── GET /api/warehouses ─────────────────────────────────────────────────────────
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma! as any
        const branchId = getBranchId(req) || null

        // Lazy-seed defaults so existing stores get warehouses on first call
        await ensureDefaultWarehouses(prisma, branchId)

        const where: any = { ...warehouseBranchFilter(req) }
        if (req.query.type && req.query.type !== 'all') where.type = String(req.query.type)
        if (req.query.isActive !== undefined) where.isActive = req.query.isActive === 'true'

        // Hide warranty warehouses from roles that can't access them
        const role = req.user?.role
        if (role !== 'admin' && role !== 'warranty') {
            where.type = where.type ? (where.type === 'warranty' ? '__none__' : where.type) : { not: 'warranty' }
        }

        const warehouses = await prisma.warehouse.findMany({
            where,
            orderBy: [{ isDefault: 'desc' }, { type: 'asc' }, { name: 'asc' }],
        })

        // Enrich with branch name so the frontend can show which branch each warehouse belongs to
        const branchIds = [...new Set(warehouses.map((w: any) => w.branchId).filter(Boolean))]
        const branchMap = new Map<string, string>()
        if (branchIds.length > 0) {
            const branches = await prisma.branch.findMany({
                where: { id: { in: branchIds } },
                select: { id: true, name: true },
            })
            branches.forEach((b: any) => branchMap.set(b.id, b.name))
        }
        /**
         * SỐ TỒN TỪNG KHO — trước đây không trả trường nào, FE đọc
         * stockCount ?? productCount ?? 0 nên MỌI kho hiện "0 tồn" từ ngày
         * trang ra đời (người dùng bắt 12/08/2026). Một groupBy cho cả list.
         * Lưu ý: stockCount là TỔNG ĐẠI SỐ — kho có dòng âm (di sản) có thể
         * ra 0 dù vẫn còn mã; vì vậy trả kèm productCount (số mã ≠ 0).
         */
        const tonTheoKho = await prisma.warehouseStock.groupBy({
            by: ['warehouseId'],
            where: { quantity: { not: 0 } },
            _sum: { quantity: true },
            _count: { _all: true },
        }).catch(() => [])
        const tonMap = new Map<string, { tong: number; soMa: number }>()
        for (const t of tonTheoKho as any[]) {
            tonMap.set(t.warehouseId, { tong: t._sum?.quantity ?? 0, soMa: t._count?._all ?? 0 })
        }

        const data = warehouses.map((w: any) => ({
            ...w,
            branchName: w.branchId ? (branchMap.get(w.branchId) || null) : null,
            stockCount: tonMap.get(w.id)?.tong ?? 0,
            productCount: tonMap.get(w.id)?.soMa ?? 0,
        }))

        res.json({ success: true, data })
    } catch (err) {
        console.error('List warehouses error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ─── GET /api/warehouses/stats ───────────────────────────────────────────────────
router.get('/stats', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma! as any
        const where: any = { ...warehouseBranchFilter(req) }

        // Hide warranty warehouses from non-authorized roles
        const role = req.user?.role
        if (role !== 'admin' && role !== 'warranty') where.type = { not: 'warranty' }

        const warehouses = await prisma.warehouse.findMany({
            where,
            include: { stocks: { select: { quantity: true } } },
        })

        const stats = warehouses.map((w: any) => ({
            id: w.id,
            code: w.code,
            name: w.name,
            type: w.type,
            isDefault: w.isDefault,
            isActive: w.isActive,
            totalSkus: w.stocks.length,
            totalQuantity: w.stocks.reduce((s: number, x: any) => s + (x.quantity || 0), 0),
        }))

        res.json({ success: true, data: stats })
    } catch (err) {
        console.error('Warehouse stats error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ─── GET /api/warehouses/stock-summary ─────────────────────────────────────────
// Dashboard rollup: aggregate stock across every warehouse in scope. Returns
// grand totals, a per-warehouse breakdown, and a per-product total (a product's
// quantity summed across all warehouses). Admin/manager see all branches.
// NOTE: must stay above the `/:id` route so "stock-summary" isn't read as an id.
router.get('/stock-summary', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma! as any
        const where: any = { ...warehouseBranchFilter(req) }

        // Hide warranty warehouses from roles that can't access them
        const role = req.user?.role
        if (role !== 'admin' && role !== 'warranty') where.type = { not: 'warranty' }

        const warehouses = await prisma.warehouse.findMany({
            where,
            include: { stocks: true },
        })

        const byProduct = new Map<string, { productId: string; productName: string; productSku: string | null; quantity: number }>()
        let totalQuantity = 0

        const byWarehouse = warehouses.map((w: any) => {
            let whQty = 0
            for (const s of w.stocks) {
                const qty = s.quantity || 0
                whQty += qty
                totalQuantity += qty
                const cur = byProduct.get(s.productId)
                if (cur) {
                    cur.quantity += qty
                } else {
                    byProduct.set(s.productId, {
                        productId: s.productId,
                        productName: s.productName,
                        productSku: s.productSku ?? null,
                        quantity: qty,
                    })
                }
            }
            return {
                warehouseId: w.id,
                code: w.code,
                name: w.name,
                type: w.type,
                isDefault: w.isDefault,
                isActive: w.isActive,
                totalSkus: w.stocks.length,
                totalQuantity: whQty,
            }
        })

        const products = Array.from(byProduct.values()).sort((a, b) => b.quantity - a.quantity)

        res.json({
            success: true,
            data: {
                totalWarehouses: warehouses.length,
                totalSkus: byProduct.size,
                totalQuantity,
                byWarehouse,
                byProduct: products,
            },
        })
    } catch (err) {
        console.error('Warehouse stock summary error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ─── GET /api/warehouses/:id ─────────────────────────────────────────────────────
router.get('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma! as any
        const id = String(req.params.id)
        const warehouse = await prisma.warehouse.findFirst({
            where: { id, ...warehouseBranchFilter(req) },
        })
        if (!warehouse) return res.status(404).json({ success: false, error: 'Không tìm thấy kho' })
        if (!canReadWarehouseType(req.user?.role, warehouse.type)) {
            return res.status(403).json({ success: false, error: WARRANTY_FORBIDDEN_MSG })
        }
        res.json({ success: true, data: warehouse })
    } catch (err) {
        console.error('Get warehouse error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ─── GET /api/warehouses/:id/stock — list stock items in this warehouse ─────────
router.get('/:id/stock', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma! as any
        const id = String(req.params.id)
        const { search } = req.query

        const warehouse = await prisma.warehouse.findFirst({
            where: { id, ...warehouseBranchFilter(req) },
        })
        if (!warehouse) return res.status(404).json({ success: false, error: 'Không tìm thấy kho' })
        if (!canReadWarehouseType(req.user?.role, warehouse.type)) {
            return res.status(403).json({ success: false, error: WARRANTY_FORBIDDEN_MSG })
        }

        const where: any = { warehouseId: id }
        if (search) {
            const q = String(search)
            where.OR = [
                { productName: { contains: q, mode: 'insensitive' } },
                { productSku: { contains: q, mode: 'insensitive' } },
            ]
        }

        const stocks = await prisma.warehouseStock.findMany({
            where,
            orderBy: [{ updatedAt: 'desc' }],
        })

        res.json({ success: true, data: { warehouse, stocks } })
    } catch (err) {
        console.error('Warehouse stock error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ─── POST /api/warehouses ────────────────────────────────────────────────────────
router.post(
    '/',
    authMiddleware,
    validate(CreateWarehouseSchema),
    async (req: AuthRequest, res: Response) => {
        try {
            const prisma = req.storePrisma! as any
            const { name, code, type, branchId, description, isActive } = req.body

            // Gate by target warehouse type
            const targetType = type || 'other'
            if (!canWriteWarehouseType(req.user?.role, targetType)) {
                const msg = targetType === 'warranty'
                    ? WARRANTY_FORBIDDEN_MSG
                    : 'Bạn không có quyền tạo kho loại này'
                return res.status(403).json({ success: false, error: msg })
            }

            const finalCode = (code?.trim() || `WH-${Date.now()}`).toUpperCase()

            const existing = await prisma.warehouse.findFirst({ where: { code: finalCode } })
            if (existing) return res.status(409).json({ success: false, error: 'Mã kho đã tồn tại' })

            // Sub-branch users can only create warehouses for their own branch
            const callerBranchId = getBranchId(req) || null
            const finalBranchId = req.user?.isMainBranch ? (branchId || null) : callerBranchId

            const warehouse = await prisma.warehouse.create({
                data: {
                    code: finalCode,
                    name: name.trim(),
                    type: type || 'other',
                    branchId: finalBranchId,
                    description: description || null,
                    isActive: isActive !== false,
                    isDefault: false,
                },
            })

            res.status(201).json({ success: true, data: warehouse })
        } catch (err) {
            console.error('Create warehouse error:', err)
            res.status(500).json({ success: false, error: 'Internal server error' })
        }
    },
)

// ─── PUT /api/warehouses/:id ─────────────────────────────────────────────────────
router.put(
    '/:id',
    authMiddleware,
    validate(UpdateWarehouseSchema),
    async (req: AuthRequest, res: Response) => {
        try {
            const prisma = req.storePrisma! as any
            const id = String(req.params.id)
            const existing = await prisma.warehouse.findFirst({
                where: { id, ...warehouseBranchFilter(req) },
            })
            if (!existing) return res.status(404).json({ success: false, error: 'Không tìm thấy kho' })
            if (!canWriteWarehouseType(req.user?.role, existing.type)) {
                const msg = existing.type === 'warranty' ? WARRANTY_FORBIDDEN_MSG : 'Bạn không có quyền sửa kho này'
                return res.status(403).json({ success: false, error: msg })
            }

            const { name, code, type, branchId, description, isActive } = req.body
            const data: any = {}
            if (name !== undefined) data.name = name.trim()
            if (code !== undefined) data.code = String(code).trim().toUpperCase()
            if (type !== undefined) data.type = type
            if (description !== undefined) data.description = description
            if (isActive !== undefined) data.isActive = isActive
            // Only main-branch users can move a warehouse to another branch
            if (branchId !== undefined && req.user?.isMainBranch) data.branchId = branchId || null

            // Disallow changing the type of a default warehouse — would break seeding logic
            if (existing.isDefault && data.type && data.type !== existing.type) {
                return res.status(400).json({
                    success: false,
                    error: 'Không thể đổi loại của kho mặc định',
                })
            }

            if (data.code && data.code !== existing.code) {
                const dup = await prisma.warehouse.findFirst({ where: { code: data.code } })
                if (dup) return res.status(409).json({ success: false, error: 'Mã kho đã tồn tại' })
            }

            const updated = await prisma.warehouse.update({ where: { id }, data })
            res.json({ success: true, data: updated })
        } catch (err) {
            console.error('Update warehouse error:', err)
            res.status(500).json({ success: false, error: 'Internal server error' })
        }
    },
)

// ─── DELETE /api/warehouses/:id ──────────────────────────────────────────────────
router.delete(
    '/:id',
    authMiddleware,
    async (req: AuthRequest, res: Response) => {
        try {
            const prisma = req.storePrisma! as any
            const id = String(req.params.id)
            const existing = await prisma.warehouse.findFirst({
                where: { id, ...warehouseBranchFilter(req) },
                include: { stocks: { select: { id: true, quantity: true } } },
            })
            if (!existing) return res.status(404).json({ success: false, error: 'Không tìm thấy kho' })
            if (!canWriteWarehouseType(req.user?.role, existing.type)) {
                const msg = existing.type === 'warranty' ? WARRANTY_FORBIDDEN_MSG : 'Bạn không có quyền xóa kho này'
                return res.status(403).json({ success: false, error: msg })
            }

            if (existing.isDefault) {
                return res.status(403).json({
                    success: false,
                    error: 'Không thể xóa kho mặc định (kho chính / hư hỏng / bảo hành). Bạn có thể vô hiệu hóa thay thế.',
                })
            }

            const hasStock = existing.stocks.some((s: any) => (s.quantity || 0) > 0)
            if (hasStock) {
                return res.status(409).json({
                    success: false,
                    error: 'Kho còn hàng tồn — vui lòng chuyển hết hàng đi trước khi xóa',
                })
            }

            await prisma.warehouse.delete({ where: { id } })
            res.json({ success: true })
        } catch (err) {
            console.error('Delete warehouse error:', err)
            res.status(500).json({ success: false, error: 'Internal server error' })
        }
    },
)

// ═══════════════════════════════════════════════════════════════════════════════
// Stock Transfers
// ═══════════════════════════════════════════════════════════════════════════════

// ─── GET /api/warehouses/transfers/list ──────────────────────────────────────────
router.get('/transfers/list', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma! as any
        const where: any = { ...warehouseBranchFilter(req) }
        if (req.query.warehouseId) {
            const wid = String(req.query.warehouseId)
            where.OR = [{ fromWarehouseId: wid }, { toWarehouseId: wid }]
        }

        const transfers = await prisma.stockTransfer.findMany({
            where,
            include: {
                items: true,
                fromWarehouse: { select: { id: true, name: true, type: true } },
                toWarehouse: { select: { id: true, name: true, type: true } },
            },
            orderBy: { createdAt: 'desc' },
            take: 200,
        })

        // Hide transfers involving warranty warehouses from non-authorized roles
        const role = req.user?.role
        const filtered = (role === 'admin' || role === 'warranty')
            ? transfers
            : transfers.filter((t: any) =>
                t.fromWarehouse?.type !== 'warranty' && t.toWarehouse?.type !== 'warranty'
            )

        res.json({ success: true, data: filtered })
    } catch (err) {
        console.error('List transfers error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ─── POST /api/warehouses/transfers ──────────────────────────────────────────────
// Move stock between warehouses (or in/out of main product stock).
// Rules:
//   - fromWarehouseId === null  → withdraw from Product.stock (decrement) into target warehouse
//   - toWarehouseId   === null  → return from source warehouse back to Product.stock (increment)
//   - both set                  → move between two warehouses (Product.stock unchanged)
router.post(
    '/transfers',
    authMiddleware,
    requireRole('admin', 'manager', 'warehouse', 'warranty'),
    validate(CreateStockTransferSchema),
    async (req: AuthRequest, res: Response) => {
        try {
            const prisma = req.storePrisma! as any
            const { fromWarehouseId, toWarehouseId, reason, notes, items } = req.body

            // Resolve and validate warehouses
            const branchScope = warehouseBranchFilter(req)
            let fromWh: any = null
            let toWh: any = null
            if (fromWarehouseId) {
                fromWh = await prisma.warehouse.findFirst({ where: { id: fromWarehouseId, ...branchScope } })
                if (!fromWh) return res.status(404).json({ success: false, error: 'Kho nguồn không tồn tại' })
                if (!fromWh.isActive) return res.status(400).json({ success: false, error: 'Kho nguồn đã bị vô hiệu hóa' })
            }
            if (toWarehouseId) {
                toWh = await prisma.warehouse.findFirst({ where: { id: toWarehouseId, ...branchScope } })
                if (!toWh) return res.status(404).json({ success: false, error: 'Kho đích không tồn tại' })
                if (!toWh.isActive) return res.status(400).json({ success: false, error: 'Kho đích đã bị vô hiệu hóa' })
            }

            // Per-warehouse-type access: must be able to write to BOTH sides involved
            const role = req.user?.role
            if (fromWh && !canWriteWarehouseType(role, fromWh.type)) {
                const msg = fromWh.type === 'warranty' ? WARRANTY_FORBIDDEN_MSG : 'Bạn không có quyền chuyển hàng từ kho này'
                return res.status(403).json({ success: false, error: msg })
            }
            if (toWh && !canWriteWarehouseType(role, toWh.type)) {
                const msg = toWh.type === 'warranty' ? WARRANTY_FORBIDDEN_MSG : 'Bạn không có quyền chuyển hàng vào kho này'
                return res.status(403).json({ success: false, error: msg })
            }

            // Mô hình tồn: "kho chính" (type === 'main') CHÍNH LÀ Product.stock — không
            // phải một pool tách biệt. Vì vậy warehouseId=null (tồn kho tổng) và kho main
            // là CÙNG MỘT nguồn hàng bán được. Chuyển giữa hai đầu đều-là-bán-được là vô
            // nghĩa (và trước đây gây double-count), nên chặn thẳng.
            const fromIsSellable = !fromWarehouseId || fromWh?.type === 'main'
            const toIsSellable = !toWarehouseId || toWh?.type === 'main'
            if (fromIsSellable && toIsSellable) {
                return res.status(400).json({
                    success: false,
                    error: 'Không thể chuyển giữa kho chính và tồn kho tổng (cùng một nguồn)',
                })
            }

            // Chi nhánh của kho main để mirror Product.stock đúng chi nhánh. Ưu tiên
            // branchId của warehouse main liên quan, fallback về branch của request.
            const mainBranchId =
                (fromIsSellable ? fromWh?.branchId : null) ??
                (toIsSellable ? toWh?.branchId : null) ??
                (getBranchId(req) || null)

            // Pre-resolve product info for all items
            const productIds = items.map((it: any) => it.productId)
            const products = await prisma.product.findMany({
                where: { id: { in: productIds } },
                select: { id: true, name: true, sku: true, stock: true },
            })
            const productMap = new Map<string, any>(products.map((p: any) => [p.id, p]))

            // Validate every item has a known product
            for (const it of items) {
                if (!productMap.has(it.productId)) {
                    return res.status(400).json({ success: false, error: `Sản phẩm không tồn tại: ${it.productId}` })
                }
            }

            // Validate sufficient source stock
            if (fromWarehouseId) {
                // Source is a warehouse — check WarehouseStock
                const stocks = await prisma.warehouseStock.findMany({
                    where: { warehouseId: fromWarehouseId, productId: { in: productIds } },
                })
                const stockMap = new Map<string, number>(stocks.map((s: any) => [s.productId, s.quantity]))
                for (const it of items) {
                    const have = stockMap.get(it.productId) || 0
                    if (have < it.quantity) {
                        const p = productMap.get(it.productId)
                        return res.status(400).json({
                            success: false,
                            error: `Không đủ tồn kho trong kho nguồn cho "${p?.name}" (cần ${it.quantity}, còn ${have})`,
                        })
                    }
                }
            } else {
                // Source is the main product stock
                for (const it of items) {
                    const p = productMap.get(it.productId)!
                    if ((p.stock || 0) < it.quantity) {
                        return res.status(400).json({
                            success: false,
                            error: `Không đủ tồn kho chính cho "${p.name}" (cần ${it.quantity}, còn ${p.stock || 0})`,
                        })
                    }
                }
            }

            const totalQuantity = items.reduce((s: number, it: any) => s + (it.quantity || 0), 0)
            const branchId = getBranchId(req) || null

            // Atomic transaction: create transfer + adjust stocks
            const transfer = await prisma.$transaction(async (tx: any) => {
                const code = await nextCode(tx, 'stockTransferCodeSeq', 'TRF', 5, '-', 'StockTransfer', 'code')

                const created = await tx.stockTransfer.create({
                    data: {
                        code,
                        fromWarehouseId: fromWarehouseId || null,
                        toWarehouseId: toWarehouseId || null,
                        status: 'completed',
                        reason: reason || null,
                        notes: notes || null,
                        branchId,
                        userId: req.user?.userId || null,
                        userName: req.user?.email || null,
                        totalQuantity,
                        items: {
                            create: items.map((it: any) => {
                                const p = productMap.get(it.productId)!
                                return {
                                    productId: it.productId,
                                    productName: p.name,
                                    productSku: p.sku || null,
                                    quantity: it.quantity,
                                    notes: it.notes || null,
                                }
                            }),
                        },
                    },
                    include: { items: true },
                })

                // Apply stock movements.
                // Kho main lock-step Product.stock: khi một đầu là "hàng bán được"
                // (warehouseId=null hoặc kho type='main') ta gọi adjustSellableStock —
                // helper tự chỉnh CẢ Product.stock LẪN WarehouseStock[main], không tự tay
                // đụng warehouseStock[main] nữa. Kho đặc biệt (damaged/warranty/mobile) thì
                // chỉ dời WarehouseStock của kho đó như cũ.
                for (const it of items) {
                    const p = productMap.get(it.productId)!

                    // Decrement source
                    if (fromIsSellable) {
                        // Nguồn là hàng bán được → guard gte để chống tồn âm do race.
                        const r = await tx.product.updateMany({
                            where: { id: it.productId, stock: { gte: it.quantity } },
                            data: { stock: { decrement: it.quantity } },
                        })
                        if (r.count === 0) {
                            throw new TransferConflictError(
                                `Tồn kho chính không đủ cho "${p.name}" (đã thay đổi trong lúc xử lý)`,
                            )
                        }
                        // Mirror giảm sang WarehouseStock[main] (helper best-effort). Không
                        // dùng adjustSellableStock trọn gói vì đã tự trừ Product.stock có guard
                        // ở trên; chỉ cần đồng bộ kho main.
                        try {
                            const mainWh = await getOrCreateDefaultWarehouse(tx, mainBranchId)
                            if (mainWh?.id) {
                                await updateWarehouseStock(tx, mainWh.id, it.productId, -it.quantity)
                            }
                        } catch { /* schema cũ chưa có bảng kho — Product.stock vẫn đúng */ }
                    } else {
                        // Nguồn là kho đặc biệt → chỉ dời WarehouseStock của kho đó, guard gte.
                        const r = await tx.warehouseStock.updateMany({
                            where: { warehouseId: fromWarehouseId, productId: it.productId, quantity: { gte: it.quantity } },
                            data: { quantity: { decrement: it.quantity } },
                        })
                        if (r.count === 0) {
                            throw new TransferConflictError(
                                `Tồn kho nguồn không đủ cho "${p.name}" (đã thay đổi trong lúc xử lý)`,
                            )
                        }
                    }

                    // Increment destination
                    if (toIsSellable) {
                        // Đích là hàng bán được → tăng cả Product.stock lẫn kho main.
                        await adjustSellableStock(tx, it.productId, mainBranchId, it.quantity)
                    } else {
                        // Đích là kho đặc biệt → chỉ tăng WarehouseStock của kho đó.
                        await tx.warehouseStock.upsert({
                            where: { warehouseId_productId: { warehouseId: toWarehouseId, productId: it.productId } },
                            update: { quantity: { increment: it.quantity }, productName: p.name, productSku: p.sku || null },
                            create: {
                                warehouseId: toWarehouseId,
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

            res.status(201).json({ success: true, data: transfer })
        } catch (err: any) {
            if (err instanceof TransferConflictError) {
                return res.status(409).json({ success: false, error: err.message })
            }
            console.error('Create stock transfer error:', err)
            res.status(500).json({ success: false, error: 'Internal server error', detail: errorDetail(err) })
        }
    },
)

// ─── GET /api/warehouses/transfers/:id ───────────────────────────────────────────
router.get('/transfers/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma! as any
        const transfer = await prisma.stockTransfer.findFirst({
            where: { id: String(req.params.id), ...warehouseBranchFilter(req) },
            include: {
                items: true,
                fromWarehouse: { select: { id: true, name: true, type: true, code: true } },
                toWarehouse: { select: { id: true, name: true, type: true, code: true } },
            },
        })
        if (!transfer) return res.status(404).json({ success: false, error: 'Không tìm thấy phiếu chuyển kho' })

        const role = req.user?.role
        const fromType = transfer.fromWarehouse?.type
        const toType = transfer.toWarehouse?.type
        if (
            (fromType && !canReadWarehouseType(role, fromType)) ||
            (toType && !canReadWarehouseType(role, toType))
        ) {
            return res.status(403).json({ success: false, error: WARRANTY_FORBIDDEN_MSG })
        }

        res.json({ success: true, data: transfer })
    } catch (err) {
        console.error('Get transfer error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ─── POST /api/warehouses/seed-defaults — manually trigger default-warehouse seed
router.post(
    '/seed-defaults',
    authMiddleware,
    requireRole('admin', 'manager'),
    async (req: AuthRequest, res: Response) => {
        try {
            const prisma = req.storePrisma! as any
            const branchId = getBranchId(req) || null
            await ensureDefaultWarehouses(prisma, branchId)
            const warehouses = await prisma.warehouse.findMany({
                where: { isDefault: true, ...warehouseBranchFilter(req) },
                orderBy: { type: 'asc' },
            })
            res.json({ success: true, data: warehouses })
        } catch (err) {
            console.error('Seed default warehouses error:', err)
            res.status(500).json({ success: false, error: 'Internal server error' })
        }
    },
)

export default router
