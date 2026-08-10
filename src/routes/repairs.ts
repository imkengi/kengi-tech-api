import { Router, Request, Response } from 'express'
import { authMiddleware, getBranchFilter, AuthRequest, getBranchId } from '../middleware/auth'
import { requirePermission } from '../middleware/permissionMiddleware'
import { validate } from '../middleware/validate'
import { CreateRepairSchema, UpdateRepairSchema } from '../schemas'
import { nextCode } from '../lib/codeGenerator'
import { adjustSellableStock, decrementSellableStock, updateWarehouseStock } from '../lib/warehouseHelper'

const router = Router()

/**
 * PHIẾU SỬA / BẢO HÀNH VÀ TỒN KHO
 *
 * Ba luồng khác nhau, đừng gộp:
 *
 *  1. source = 'customer' — máy của khách mang tới.
 *     KHÔNG đụng tồn kho chính một chút nào: món đó chưa bao giờ là tài sản của
 *     cửa hàng, cộng/trừ vào kho là thổi phồng tồn.
 *
 *  2. source = 'internal' — chuyển kho nội bộ: hàng của shop để lâu bị hư.
 *     Khi phiếu chuyển sang Sửa chữa/Bảo hành thì hàng RỜI kho bán được:
 *     kho chính −n, kho hàng hư hỏng +n. Tổng tài sản không bốc hơi, vẫn tra
 *     lại được món nào đang hỏng.
 *
 *  3. Đổi mới (status = 'replaced') — áp dụng cho CẢ HAI nguồn.
 *     Xuất một máy mới từ kho chính giao khách: kho chính −n. Máy hỏng gửi NCC;
 *     khi NCC trả về thì cộng lại kho chính +n (bấm "NCC đã trả").
 *
 * Mỗi lần ghi kho đều neo vào một DẤU MỐC (stockMovedAt / replacedStockAt /
 * supplierReturnedAt). Không có mốc thì bấm đổi trạng thái hai lần là trừ tồn
 * hai lần, và xoá phiếu xong không ai biết đường hoàn lại.
 */

/** Trạng thái nghĩa là "đã xác nhận hỏng, bắt tay vào xử lý" */
const DA_VAO_XUONG = ['repairing', 'warranty', 'sent_to_supplier']

async function khoHuHong(prisma: any, branchId: string | null): Promise<string | null> {
    const w = await prisma.warehouse.findFirst({
        where: { type: 'damaged', isActive: true, ...(branchId ? { branchId } : {}) },
        select: { id: true },
    }).catch(() => null)
    if (w?.id) return w.id
    // Chi nhánh chưa có kho hư hỏng riêng → dùng kho hư hỏng bất kỳ của cửa hàng
    const bat = await prisma.warehouse.findFirst({
        where: { type: 'damaged', isActive: true }, select: { id: true },
    }).catch(() => null)
    return bat?.id || null
}

async function ghiTheKho(
    tx: any, r: any, delta: number, lyDo: string, req: AuthRequest,
) {
    await tx.inventoryTransaction.create({
        data: {
            // SỐ LƯỢNG CÓ DẤU + từ vựng chuẩn của app: thẻ kho tách cột nhập/xuất
            // theo DẤU, ghi Math.abs() là cả thẻ kho hiện sai
            type: 'adjustment',
            productId: r.productId,
            productName: r.productName,
            productSku: r.productSku || '',
            quantity: delta,
            reason: `${lyDo} — phiếu ${r.code}`,
            referenceId: r.code,
            referenceType: 'repair',
            branchId: r.branchId || null,
            userId: req.user?.userId || null,
            userName: (req as any).user?.name || 'Hệ thống',
        },
    }).catch(() => { /* thẻ kho hỏng không được giết nghiệp vụ chính */ })
}

// GET /api/repairs/stats
router.get('/stats', authMiddleware, requirePermission('repairs.view'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const all = await prisma.repair.findMany({ select: { status: true, cost: true } })
        const byStatus: Record<string, number> = {}
        let totalRevenue = 0
        for (const r of all) { byStatus[r.status || 'received'] = (byStatus[r.status || 'received'] || 0) + 1; totalRevenue += r.cost }
        const avgCost = all.length > 0 ? Math.round(totalRevenue / all.length) : 0
        res.json({ success: true, data: { total: all.length, byStatus, totalRevenue, avgCost } })
    } catch { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// GET /api/repairs
router.get('/', authMiddleware, requirePermission('repairs.view'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { search, status, source } = req.query
        const where: any = {}
        if (status && status !== 'all') where.status = status
        if (source && source !== 'all') where.source = source
        if (search) {
            const q = String(search)
            where.OR = [{ productName: { contains: q } }, { customerName: { contains: q } }, { code: { contains: q } }]
        }
        const data = await prisma.repair.findMany({ where, orderBy: { createdAt: 'desc' } })
        res.json({ success: true, data })
    } catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// POST /api/repairs
router.post('/', authMiddleware, requirePermission('repairs.create'), validate(CreateRepairSchema), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { productName, customerName, customerPhone, issue, cost, estimatedDate, notes,
            source, productId, quantity } = req.body
        if (!productName?.trim() || !issue?.trim()) return res.status(400).json({ success: false, error: 'Tên thiết bị và mô tả sự cố không được để trống' })

        const nguon = source === 'internal' ? 'internal' : 'customer'
        // Hàng nội bộ PHẢI nối vào danh mục — không có productId thì không biết
        // trừ tồn của mã nào, ghi bừa là hỏng kho
        if (nguon === 'internal' && !productId) {
            return res.status(400).json({ success: false, error: 'Chuyển kho nội bộ phải chọn sản phẩm trong danh mục (để biết trừ tồn mã nào)' })
        }
        const sl = Math.max(1, Math.round(Number(quantity) || 1))

        let productSku: string | null = null
        if (productId) {
            const p = await prisma.product.findUnique({ where: { id: String(productId) }, select: { sku: true } }).catch(() => null)
            if (!p) return res.status(400).json({ success: false, error: 'Không tìm thấy sản phẩm đã chọn' })
            productSku = p.sku
        }

        const code = await nextCode(prisma, 'repairCodeSeq', 'RP', 4, '-', 'Repair', 'code')
        const data = await prisma.repair.create({
            data: {
                code, productName, customerName: customerName || '', customerPhone, issue,
                cost: Number(cost) || 0,
                estimatedDate: estimatedDate ? new Date(estimatedDate) : null,
                notes,
                source: nguon,
                productId: productId || null,
                productSku,
                quantity: sl,
                branchId: getBranchId(req) || null,
            } as any,
        })
        res.status(201).json({ success: true, data })
    } catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

/** Phiếu 'returned' (đã trả khách) là CHỐT SỔ — doanh thu sửa chữa tính từ đây.
 *  Nhân viên chỉ được đẩy phiếu ĐẾN returned; đã returned rồi thì mọi sửa/xóa
 *  đều khóa, trừ admin. Chặn ở server vì UI (web/app) có thể lách. */
const laAdmin = (req: AuthRequest) =>
    ['admin', 'owner', 'superadmin'].includes(String((req as any).user?.role || '').toLowerCase())

// PUT /api/repairs/:id
router.put('/:id', authMiddleware, requirePermission('repairs.edit'), validate(UpdateRepairSchema), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const id = String(req.params.id)
        const existing: any = await prisma.repair.findUnique({ where: { id } })
        if (!existing) return res.status(404).json({ success: false, error: 'Không tìm thấy phiếu' })
        if (existing.status === 'returned' && !laAdmin(req)) {
            return res.status(403).json({ success: false, error: 'Phiếu đã trả khách — đã chốt, chỉ admin mới sửa được' })
        }
        const { status, cost, notes, completedDate } = req.body
        const data: any = {}
        if (status) data.status = status
        if (cost !== undefined) data.cost = Number(cost)
        if (notes !== undefined) data.notes = notes
        if (status === 'done' || completedDate) data.completedDate = new Date()

        const sl = Math.max(1, Number(existing.quantity) || 1)
        const canDoiMoi = status === 'replaced' && !existing.replacedStockAt
        const canChuyenKho = existing.source === 'internal'
            && !existing.stockMovedAt
            && status && DA_VAO_XUONG.includes(String(status))

        if ((canDoiMoi || canChuyenKho) && !existing.productId) {
            return res.status(400).json({
                success: false,
                error: canDoiMoi
                    ? 'Phiếu chưa nối với sản phẩm nào nên không trừ được tồn khi đổi mới. Sửa phiếu, chọn sản phẩm rồi thử lại.'
                    : 'Phiếu chuyển kho nội bộ nhưng chưa nối sản phẩm — không biết trừ tồn mã nào.',
            })
        }

        // Ghi kho và cập nhật phiếu trong CÙNG một transaction: nửa chừng lỗi thì
        // không được để tồn đã trừ mà phiếu vẫn trạng thái cũ
        const ketQua = await prisma.$transaction(async (tx: any) => {
            if (canChuyenKho) {
                const du = await decrementSellableStock(tx, existing.productId, existing.branchId, sl)
                if (!du) throw new Error(`KHO_THIEU:Kho chính chỉ còn ít hơn ${sl} của "${existing.productName}" — không chuyển sang hàng hư hỏng được`)
                const khoHu = await khoHuHong(tx, existing.branchId)
                if (khoHu) await updateWarehouseStock(tx, khoHu, existing.productId, sl)
                await ghiTheKho(tx, existing, -sl, 'Chuyển kho nội bộ: hàng hư hỏng', req)
                data.stockMovedAt = new Date()
            }
            if (canDoiMoi) {
                const du = await decrementSellableStock(tx, existing.productId, existing.branchId, sl)
                if (!du) throw new Error(`KHO_THIEU:Kho chính không đủ ${sl} của "${existing.productName}" để đổi mới cho khách`)
                await ghiTheKho(tx, existing, -sl, 'Đổi mới cho khách', req)
                data.replacedStockAt = new Date()
            }
            return tx.repair.update({ where: { id }, data })
        })

        res.json({ success: true, data: ketQua })
    } catch (err: any) {
        const m = String(err?.message || '')
        if (m.startsWith('KHO_THIEU:')) {
            return res.status(409).json({ success: false, error: m.slice('KHO_THIEU:'.length) })
        }
        console.error('Update repair error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// POST /api/repairs/:id/supplier-returned — NCC đã trả hàng về
/**
 * Cộng lại kho chính. Hai trường hợp, số học khác nhau:
 *   - Đã đổi mới: lúc đó đã trừ kho chính để giao máy cho khách → nay cộng lại,
 *     bù đúng khoản đã trừ. Kho hư hỏng không liên quan.
 *   - Hàng nội bộ gửi NCC sửa: lúc vào xưởng đã chuyển kho chính → kho hư hỏng.
 *     Nay máy về dùng được → kho chính +n VÀ kho hư hỏng −n.
 */
router.post('/:id/supplier-returned', authMiddleware, requirePermission('repairs.edit'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const id = String(req.params.id)
        const r: any = await prisma.repair.findUnique({ where: { id } })
        if (!r) return res.status(404).json({ success: false, error: 'Không tìm thấy phiếu' })
        if (r.supplierReturnedAt) {
            return res.status(409).json({ success: false, error: 'Phiếu này đã ghi nhận NCC trả hàng rồi' })
        }
        if (!r.productId) {
            return res.status(400).json({ success: false, error: 'Phiếu chưa nối với sản phẩm nào — không biết cộng tồn cho mã nào' })
        }
        const daTruDoiMoi = !!r.replacedStockAt
        const daChuyenKho = r.source === 'internal' && !!r.stockMovedAt
        if (!daTruDoiMoi && !daChuyenKho) {
            return res.status(400).json({
                success: false,
                error: 'Phiếu này chưa trừ tồn kho lần nào nên không có gì để cộng lại. Chỉ dùng sau khi đã đổi mới hoặc đã chuyển kho nội bộ.',
            })
        }
        const sl = Math.max(1, Number(r.quantity) || 1)

        const ketQua = await prisma.$transaction(async (tx: any) => {
            await adjustSellableStock(tx, r.productId, r.branchId, sl, `NCC trả hàng — phiếu ${r.code}`)
            if (daChuyenKho && !daTruDoiMoi) {
                const khoHu = await khoHuHong(tx, r.branchId)
                if (khoHu) await updateWarehouseStock(tx, khoHu, r.productId, -sl)
            }
            await ghiTheKho(tx, r, sl, 'NCC trả hàng', req)
            return tx.repair.update({ where: { id }, data: { supplierReturnedAt: new Date() } })
        })

        res.json({ success: true, data: ketQua, message: `Đã cộng ${sl} "${r.productName}" lại kho chính` })
    } catch (err) {
        console.error('Supplier returned error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// DELETE /api/repairs/:id
router.delete('/:id', authMiddleware, requirePermission('repairs.edit'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const id = String(req.params.id)
        const r: any = await prisma.repair.findUnique({ where: { id } })
        if (!r) return res.status(404).json({ success: false, error: 'Không tìm thấy phiếu' })
        if (r.status === 'returned' && !laAdmin(req)) {
            return res.status(403).json({ success: false, error: 'Phiếu đã trả khách — đã chốt, chỉ admin mới xóa được' })
        }

        // Xoá phiếu phải HOÀN LẠI mọi khoản tồn nó đã đụng, nếu không thì hàng
        // biến mất khỏi sổ mà không còn phiếu nào giải thích
        await prisma.$transaction(async (tx: any) => {
            if (r.productId && !r.supplierReturnedAt) {
                const sl = Math.max(1, Number(r.quantity) || 1)
                if (r.stockMovedAt) {
                    await adjustSellableStock(tx, r.productId, r.branchId, sl, `Xoá phiếu ${r.code} — hoàn chuyển kho nội bộ`)
                    const khoHu = await khoHuHong(tx, r.branchId)
                    if (khoHu) await updateWarehouseStock(tx, khoHu, r.productId, -sl)
                    await ghiTheKho(tx, r, sl, 'Xoá phiếu — hoàn hàng hư hỏng về kho chính', req)
                }
                if (r.replacedStockAt) {
                    await adjustSellableStock(tx, r.productId, r.branchId, sl, `Xoá phiếu ${r.code} — hoàn máy đổi mới`)
                    await ghiTheKho(tx, r, sl, 'Xoá phiếu — hoàn máy đổi mới', req)
                }
            }
            await tx.repair.delete({ where: { id } })
        })
        res.json({ success: true })
    }
    catch (err) {
        console.error('Delete repair error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

export default router
