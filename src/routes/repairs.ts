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
 * Chỉ có HAI phép tính, dùng đi dùng lại:
 *
 *   GỬI ĐI  = kho chính −n, kho hư hỏng +n   (`dayVaoKhoHu`)
 *   NHẬN VỀ = kho chính +n, kho hư hỏng −n   (`nhanHangVe`)
 *
 * Ai gọi phép nào:
 *
 *  1. source = 'internal' — hàng của shop để lâu bị hư.
 *     Chuyển sang Sửa chữa/Bảo hành/Trả NCC → GỬI ĐI. Món hỏng rời kho bán
 *     được nhưng không bốc hơi khỏi sổ, vẫn tra lại được nó đang nằm đâu.
 *
 *  2. source = 'customer' — máy khách mang tới.
 *     Sửa/bảo hành bình thường thì KHÔNG đụng tồn: máy đó chưa bao giờ là tài
 *     sản của shop. NHƯNG "Đổi mới" thì có: shop lấy một máy mới trong kho đưa
 *     khách, và ôm lại cái máy hỏng của khách → GỬI ĐI.
 *
 *  3. "Đổi mới" trên phiếu NỘI BỘ KHÔNG cộng kho chính.
 *     Nó chỉ có nghĩa "NCC đồng ý đổi máy khác" — hàng vẫn đang ở chỗ NCC.
 *     Cộng kho lúc này là đếm hàng chưa cầm trên tay. Phải đợi hàng về thật
 *     rồi bấm "NCC đã trả" (người dùng chỉnh 11/08/2026).
 *
 *     NHƯNG nếu phiếu nhảy THẲNG received → replaced (chưa từng GỬI ĐI) thì
 *     bước GỬI ĐI chạy ngay lúc này: món đó chắc chắn hỏng và đang đi đường
 *     NCC, phải rời kho bán được vào kho hư hỏng — không thì bấm đổi mới
 *     xong vào kho hư hỏng tìm không thấy (người dùng báo 11/08/2026).
 *
 *  4. "NCC đã trả" — NHẬN VỀ. Bấm được cho CẢ HAI nguồn, miễn là phiếu đang
 *     giữ hàng ở kho hư hỏng: máy hỏng của khách sau khi đổi mới cũng gửi NCC
 *     được như hàng nội bộ.
 *
 * Mỗi lần ghi kho đều neo vào một DẤU MỐC (stockMovedAt / replacedStockAt /
 * supplierReturnedAt). Không có mốc thì bấm đổi trạng thái hai lần là ghi tồn
 * hai lần, và xoá phiếu xong không ai biết đường hoàn lại.
 *
 * `dangGiuHang()` là câu hỏi duy nhất cần trả lời trước khi NHẬN VỀ hoặc hoàn
 * kho lúc xoá — đừng hỏi lại theo `source`, vì hai nguồn đều gửi đi được.
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

/**
 * GỬI ĐI: kho chính −n, kho hư hỏng +n.
 *
 * Dùng cho cả hàng nội bộ vào xưởng lẫn đổi mới cho khách — ngoài đời là hai
 * chuyện, trên sổ y hệt: một món rời kho bán được, một món hỏng vào kho hư.
 *
 * Ném KHO_THIEU nếu kho chính không đủ. Trừ âm ở đây là đẻ ra hàng không có
 * thật, thà chặn còn hơn để sổ sai không ai biết.
 */
async function dayVaoKhoHu(tx: any, r: any, sl: number, req: AuthRequest, lyDo: string) {
    const du = await decrementSellableStock(tx, r.productId, r.branchId, sl)
    if (!du) throw new Error(`KHO_THIEU:Kho chính chỉ còn ít hơn ${sl} của "${r.productName}" — không trừ được.`)
    const khoHu = await khoHuHong(tx, r.branchId)
    if (khoHu) await updateWarehouseStock(tx, khoHu, r.productId, sl)
    await ghiTheKho(tx, r, -sl, lyDo, req)
}

/**
 * NHẬN VỀ: kho chính +n, kho hư hỏng −n.
 *
 * Dùng chung cho cả "đổi mới" lẫn "NCC trả lại máy cũ" — hai chuyện khác nhau
 * ngoài đời nhưng giống hệt nhau trên sổ: món hỏng rời kho hư hỏng, một món
 * dùng được nhập vào kho chính.
 */
async function nhanHangVe(tx: any, r: any, sl: number, req: AuthRequest, lyDo: string) {
    await adjustSellableStock(tx, r.productId, r.branchId, sl, `${lyDo} — phiếu ${r.code}`)
    const khoHu = await khoHuHong(tx, r.branchId)
    if (khoHu) await updateWarehouseStock(tx, khoHu, r.productId, -sl)
    await ghiTheKho(tx, r, sl, lyDo, req)
}

/**
 * Phiếu này có đang GIỮ hàng ở kho hư hỏng không?
 *
 * Hai đường đẩy hàng vào đó — nội bộ vào xưởng (stockMovedAt) và đổi mới cho
 * khách (replacedStockAt) — nên phải hỏi cả hai. Hỏi theo `source` là bỏ sót
 * máy hỏng của khách, khiến nút "NCC đã trả" không bấm được.
 */
const dangGiuHang = (r: any) =>
    !!(r.stockMovedAt || r.replacedStockAt) && !r.supplierReturnedAt

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
        const laNoiBo = existing.source === 'internal'
        /**
         * Phiếu nội bộ nhảy THẲNG sang "Đổi mới" (không qua Sửa chữa/Bảo hành)
         * cũng phải chuyển kho: chọn đổi mới nghĩa là món đó chắc chắn hỏng và
         * đang đi đường NCC — hàng phải rời kho bán được vào kho hư hỏng.
         * Trước đây chỉ DA_VAO_XUONG mới kích hoạt, nên đường tắt received →
         * replaced không ghi kho nào cả: bấm đổi mới xong vào kho hư hỏng tìm
         * không thấy (người dùng báo 11/08/2026).
         */
        let canChuyenKho = laNoiBo
            && !existing.stockMovedAt
            && status && (DA_VAO_XUONG.includes(String(status)) || String(status) === 'replaced')
        /**
         * "Đổi mới" trên phiếu CỦA KHÁCH: shop rút một máy mới trong kho đưa
         * khách và ôm lại máy hỏng của khách. Đúng phép GỬI ĐI.
         *
         * Còn "đổi mới" trên phiếu NỘI BỘ thì KHÔNG ghi kho ở đây — xem mục 3
         * đầu file: lúc đó hàng vẫn nằm chỗ NCC, chưa cầm trên tay.
         */
        let canDoiMoiKhach = !laNoiBo
            && status === 'replaced'
            && !existing.replacedStockAt
            && !existing.supplierReturnedAt

        let message: string | undefined
        /**
         * Phiếu CHƯA NỐI SẢN PHẨM (phiếu cũ trước khi có cột productId, phiếu
         * tạo nhanh ở POS): vẫn cho đổi trạng thái — trước đây trả 400 ở đây
         * và người dùng "k cập nhật được" bất cứ phiếu cũ nào (11/08/2026).
         * Chỉ BỎ phần ghi kho, và nói thẳng là kho không đổi + cách bật lại.
         * Mốc stockMovedAt/replacedStockAt vẫn trống nên sau khi sửa phiếu
         * nối sản phẩm, chọn lại trạng thái là kho ghi bù ngay.
         */
        if ((canChuyenKho || canDoiMoiKhach) && !existing.productId) {
            message = 'Đã đổi trạng thái. Tồn kho KHÔNG đổi vì phiếu chưa nối sản phẩm trong danh mục — '
                + 'bấm Sửa phiếu, chọn sản phẩm rồi chọn lại trạng thái này nếu muốn trừ/chuyển kho.'
            canChuyenKho = false
            canDoiMoiKhach = false
        }
        // Ghi kho và cập nhật phiếu trong CÙNG một transaction: nửa chừng lỗi thì
        // không được để tồn đã trừ mà phiếu vẫn trạng thái cũ
        const ketQua = await prisma.$transaction(async (tx: any) => {
            if (canChuyenKho) {
                await dayVaoKhoHu(tx, existing, sl, req, 'Chuyển kho nội bộ: hàng hư hỏng')
                data.stockMovedAt = new Date()
                message = String(status) === 'replaced'
                    ? `Đã chuyển ${sl} "${existing.productName}" vào kho hư hỏng (kho chính −${sl}). Khi NCC đưa hàng về, bấm "NCC đã trả" để cộng lại kho chính.`
                    : `Đã trừ ${sl} "${existing.productName}" ở kho chính, chuyển sang kho hư hỏng`
            }
            if (canDoiMoiKhach) {
                await dayVaoKhoHu(tx, existing, sl, req, 'Đổi mới cho khách: giao máy mới, nhận máy hỏng')
                data.replacedStockAt = new Date()
                message = `Đổi mới: đã trừ ${sl} "${existing.productName}" ở kho chính, máy hỏng nhập kho hư hỏng`
            }
            if (laNoiBo && status === 'replaced' && !message) {
                // Đã chuyển kho từ trước (stockMovedAt) — không ghi kho lần nữa,
                // nhưng phải nói thẳng kẻo lại tưởng đã cộng rồi
                message = 'Đã ghi nhận NCC đồng ý đổi mới. Kho chính CHƯA cộng — hàng về thì bấm "NCC đã trả".'
            }
            return tx.repair.update({ where: { id }, data })
        })

        res.json({ success: true, data: ketQua, ...(message ? { message } : {}) })
    } catch (err: any) {
        const m = String(err?.message || '')
        if (m.startsWith('KHO_THIEU:')) {
            return res.status(409).json({ success: false, error: m.slice('KHO_THIEU:'.length) })
        }
        console.error('Update repair error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// POST /api/repairs/:id/supplier-returned — NCC trả hàng về (sửa xong máy cũ)
/**
 * ĐÂY mới là chỗ cộng lại kho chính — không phải lúc chọn trạng thái "Đổi mới".
 * Bấm nút này nghĩa là hàng đã về tới tay, dù NCC đổi máy khác hay sửa xong
 * trả máy cũ; trên sổ hai chuyện đó y hệt nhau.
 *
 * Bấm được cho CẢ phiếu của khách: sau khi đổi mới, máy hỏng của khách nằm ở
 * kho hư hỏng và cũng gửi NCC được như hàng nội bộ.
 */
router.post('/:id/supplier-returned', authMiddleware, requirePermission('repairs.edit'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const id = String(req.params.id)
        const r: any = await prisma.repair.findUnique({ where: { id } })
        if (!r) return res.status(404).json({ success: false, error: 'Không tìm thấy phiếu' })
        if (r.supplierReturnedAt) {
            return res.status(409).json({ success: false, error: 'Phiếu này đã ghi nhận hàng về rồi' })
        }
        if (!r.productId) {
            return res.status(400).json({ success: false, error: 'Phiếu chưa nối với sản phẩm nào — không biết cộng tồn cho mã nào' })
        }
        // Hàng phải ĐANG NẰM ở kho hư hỏng thì mới có cái để nhận về
        if (!dangGiuHang(r)) {
            return res.status(400).json({
                success: false,
                error: r.source === 'internal'
                    ? 'Hàng chưa được chuyển sang kho hư hỏng nên chưa có gì để nhận về. Đưa phiếu sang Sửa chữa/Bảo hành trước.'
                    : 'Phiếu của khách chỉ giữ hàng ở kho hư hỏng sau khi Đổi mới. Phiếu này chưa đổi mới nên không có gì để cộng lại.',
            })
        }
        const sl = Math.max(1, Number(r.quantity) || 1)

        const ketQua = await prisma.$transaction(async (tx: any) => {
            await nhanHangVe(tx, r, sl, req, 'NCC trả hàng')
            return tx.repair.update({ where: { id }, data: { supplierReturnedAt: new Date() } })
        })

        res.json({ success: true, data: ketQua, message: `Đã cộng ${sl} "${r.productName}" vào kho chính, trừ ở kho hư hỏng` })
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

        /**
         * Xoá phiếu phải HOÀN LẠI đúng phần tồn nó còn đang giữ, nếu không thì
         * hàng biến mất khỏi sổ mà không còn phiếu nào giải thích.
         *
         * Chỉ hoàn khi hàng CÒN NẰM ở kho hư hỏng: đã chuyển kho mà CHƯA nhận
         * về. Nhận về rồi thì hai vế đã triệt tiêu nhau, hoàn thêm là đẻ hàng
         * từ hư không.
         */
        await prisma.$transaction(async (tx: any) => {
            if (r.productId && dangGiuHang(r)) {
                // Cả hai đường gửi đi đều là (kho chính −n, kho hư +n) nên phép
                // hoàn y hệt nhau — không cần rẽ theo `source`
                const sl = Math.max(1, Number(r.quantity) || 1)
                await nhanHangVe(tx, r, sl, req, 'Xoá phiếu — hoàn hàng hư hỏng về kho chính')
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
