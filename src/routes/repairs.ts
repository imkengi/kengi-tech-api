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
 *     sản của shop. "Đổi mới" tách làm HAI mốc theo dòng hàng thật
 *     (người dùng chỉnh 12/08/2026, hai lần):
 *       - Chọn "Đổi mới": máy hỏng khách ĐỂ LẠI shop → kho hư hỏng +n ngay
 *         (mốc replacedStockAt). Kho chính chưa đụng — máy mới còn trên kệ.
 *       - Chuyển "ĐÃ TRẢ": giao máy mới tận tay khách → kho chính −n
 *         (mốc newUnitIssuedAt, có chốt KHO_THIEU).
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

/**
 * Tra danh mục theo TÊN phiếu gõ tay, trả về đúng MỘT sản phẩm hoặc null.
 * Nới dần: nguyên văn → bóc "(xN)" → bóc MỌI ngoặc đuôi ("Quạt lỡ ống nhựa
 * (4/T)") + gom khoảng trắng, so tên/SKU không phân biệt hoa thường; vòng
 * chót mới dùng chứa-chuỗi. 2+ kết quả ở bất kỳ vòng nào = trùng tên, không
 * đoán bừa (trả null, phiếu vẫn đổi trạng thái, chỉ không ghi kho).
 */
async function traSanPhamTheoTen(prisma: any, tenPhieu: string): Promise<{ id: string; sku: string | null } | null> {
    const tenGoc = String(tenPhieu || '').trim()
    if (!tenGoc) return null
    let tenTho = tenGoc.replace(/\s*\(x\d+\)\s*$/i, '').trim()
    for (let i = 0; i < 3; i++) tenTho = tenTho.replace(/\s*\([^()]*\)\s*$/, '').trim()
    tenTho = tenTho.replace(/\s+/g, ' ')
    const ungVien = Array.from(new Set([tenGoc, tenTho].filter(Boolean)))
    for (const ten of ungVien) {
        const timThay = await prisma.product.findMany({
            where: {
                OR: [
                    { name: { equals: ten, mode: 'insensitive' } },
                    { sku: { equals: ten, mode: 'insensitive' } },
                ],
            },
            select: { id: true, sku: true }, take: 2,
        }).catch(() => [])
        if (timThay.length === 1) return timThay[0]
    }
    if (tenTho.length >= 6) {
        const gan = await prisma.product.findMany({
            where: { name: { contains: tenTho, mode: 'insensitive' } },
            select: { id: true, sku: true }, take: 2,
        }).catch(() => [])
        if (gan.length === 1) return gan[0]
    }
    return null
}

// POST /api/repairs
router.post('/', authMiddleware, requirePermission('repairs.create'), validate(CreateRepairSchema), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { productName, customerName, customerPhone, issue, cost, estimatedDate, notes,
            source, productId, quantity, customerId } = req.body
        if (!productName?.trim() || !issue?.trim()) return res.status(400).json({ success: false, error: 'Tên thiết bị và mô tả sự cố không được để trống' })

        const nguon = source === 'internal' ? 'internal' : 'customer'
        // Hàng nội bộ PHẢI nối vào danh mục — không có productId thì không biết
        // trừ tồn của mã nào, ghi bừa là hỏng kho
        if (nguon === 'internal' && !productId) {
            return res.status(400).json({ success: false, error: 'Chuyển kho nội bộ phải chọn sản phẩm trong danh mục (để biết trừ tồn mã nào)' })
        }
        const sl = Math.max(1, Math.round(Number(quantity) || 1))

        let productSku: string | null = null
        let productIdCuoi: string | null = productId ? String(productId) : null
        if (productIdCuoi) {
            const p = await prisma.product.findUnique({ where: { id: productIdCuoi }, select: { sku: true } }).catch(() => null)
            if (!p) return res.status(400).json({ success: false, error: 'Không tìm thấy sản phẩm đã chọn' })
            productSku = p.sku
        } else {
            // Phiếu của khách gõ tay tên máy: tự tra danh mục ngay lúc tạo,
            // khớp đúng một mã thì nối luôn — khỏi đợi tới lúc ghi kho.
            const khop = await traSanPhamTheoTen(prisma, productName)
            if (khop) { productIdCuoi = khop.id; productSku = khop.sku }
        }

        const code = await nextCode(prisma, 'repairCodeSeq', 'RP', 4, '-', 'Repair', 'code')
        const data = await prisma.repair.create({
            data: {
                code, productName, customerName: customerName || '', customerPhone, issue,
                cost: Number(cost) || 0,
                estimatedDate: estimatedDate ? new Date(estimatedDate) : null,
                notes,
                source: nguon,
                productId: productIdCuoi,
                productSku,
                quantity: sl,
                branchId: getBranchId(req) || null,
                customerId: customerId || null,
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
        const { status, cost, notes, completedDate, productId, quantity, source,
            customerId, transactionId, soldReceiptNumber } = req.body
        const data: any = {}
        if (status) data.status = status
        if (cost !== undefined) data.cost = Number(cost)
        if (notes !== undefined) data.notes = notes
        if (customerId !== undefined) data.customerId = customerId || null
        /**
         * Link sang hoá đơn bán: POS gửi kèm lúc chuyển 'returned' sau khi thu
         * tiền — "phiếu sửa xong mà không biết thu ở hoá đơn nào" (13/08/2026).
         * Ghi MỘT lần: phiếu đã có link thì không cho đè (tránh lần thanh toán
         * sau — ví dụ sửa đơn — ghi nhầm lên phiếu đã chốt).
         */
        if (transactionId && !existing.transactionId) {
            data.transactionId = String(transactionId)
            if (soldReceiptNumber) data.soldReceiptNumber = String(soldReceiptNumber)
        }
        /**
         * CHO NỐI SẢN PHẨM VÀO PHIẾU CŨ — trước đây PUT không nhận productId,
         * nên phiếu tạo nhanh (không nối SP) vĩnh viễn không ghi kho được:
         * đổi mới xong kho hư hỏng vẫn trống, và lời khuyên "sửa phiếu chọn
         * sản phẩm" là việc bất khả thi (đo 11/08/2026: RP-0038/39/40).
         * CHỈ cho đổi khi CHƯA có mốc ghi kho nào — đổi sản phẩm sau khi đã
         * trừ kho là hoàn kho sai mã.
         */
        const chuaGhiKho = !existing.stockMovedAt && !existing.replacedStockAt && !existing.supplierReturnedAt
        if (productId !== undefined && chuaGhiKho) {
            if (productId) {
                const sp = await prisma.product.findUnique({
                    where: { id: String(productId) }, select: { sku: true, name: true },
                }).catch(() => null)
                if (!sp) return res.status(400).json({ success: false, error: 'Không tìm thấy sản phẩm đã chọn' })
                data.productId = String(productId)
                data.productSku = sp.sku
            } else {
                data.productId = null
                data.productSku = null
            }
        }
        if (quantity !== undefined && chuaGhiKho) data.quantity = Math.max(1, Math.round(Number(quantity) || 1))
        if (source !== undefined && chuaGhiKho && ['customer', 'internal'].includes(String(source))) data.source = source
        if (status === 'done' || completedDate) data.completedDate = new Date()

        const sl = Math.max(1, Number(data.quantity ?? existing.quantity) || 1)
        const laNoiBo = (data.source ?? existing.source) === 'internal'
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
         * Phiếu CỦA KHÁCH "Đổi mới" — hai mốc tách theo dòng hàng thật: chọn
         * Đổi mới = máy hỏng vào kho hư hỏng NGAY (khách để máy lại, không
         * trừ kho chính); chuyển Đã trả = máy mới rời kho chính. Mục 2 đầu file.
         *
         * "Đổi mới" trên phiếu NỘI BỘ cũng không ghi kho ở đây — xem mục 3
         * đầu file: lúc đó hàng vẫn nằm chỗ NCC, chưa cầm trên tay.
         */
        /**
         * PHIẾU CHƯA CÓ productId → TỰ TRA DANH MỤC THEO TÊN trước khi quyết
         * ghi kho. "Khi tạo phiếu đã chọn sản phẩm rồi" — người dùng đúng:
         * bước nối tay là vô lý (đã gỡ 11/08/2026). Phiếu cũ lưu tên dạng
         * "Tên sản phẩm (x2)" nên bóc hậu tố (xN) rồi so tên/SKU không phân
         * biệt hoa thường; khớp đúng MỘT sản phẩm thì nối luôn và ghi kho
         * bình thường, không khớp thì như cũ (đổi trạng thái, không đụng kho).
         */
        if (!(data.productId ?? existing.productId) && status && existing.productName) {
            const khop = await traSanPhamTheoTen(prisma, existing.productName)
            if (khop) {
                data.productId = khop.id
                data.productSku = khop.sku
            }
        }

        let canNhanMayHong = !laNoiBo
            && status === 'replaced'
            && !existing.replacedStockAt
            && !existing.supplierReturnedAt
        let canTraKhachDoiMoi = !laNoiBo
            && status === 'returned'
            && !!existing.replacedStockAt
            && !existing.newUnitIssuedAt
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
        if ((canChuyenKho || canNhanMayHong || canTraKhachDoiMoi) && !(data.productId ?? existing.productId)) {
            message = `Đã đổi trạng thái. Tồn kho KHÔNG đổi: không khớp được "${existing.productName}" `
                + 'với sản phẩm nào trong danh mục (cần trùng tên hoặc SKU, và không trùng 2 mã). '
                + 'Tạo phiếu mới và chọn sản phẩm từ gợi ý để phiếu ghi được kho.'
            canChuyenKho = false
            canNhanMayHong = false
            canTraKhachDoiMoi = false
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
            if (canNhanMayHong) {
                // Máy hỏng CỦA KHÁCH vào kho hư hỏng — không phải hàng shop rời
                // kệ nên KHÔNG trừ kho chính, chỉ nhập kho hư
                const khoHu = await khoHuHong(tx, existing.branchId)
                if (khoHu) await updateWarehouseStock(tx, khoHu, existing.productId, sl)
                await ghiTheKho(tx, existing, sl, 'Đổi mới: nhận máy hỏng của khách vào kho hư hỏng', req)
                data.replacedStockAt = new Date()
                message = `Đã nhập ${sl} máy hỏng của khách vào kho hư hỏng. Khi giao máy mới, chuyển phiếu sang "Đã trả" để trừ kho chính.`
            }
            if (canTraKhachDoiMoi) {
                const du = await decrementSellableStock(tx, existing.productId, existing.branchId, sl)
                if (!du) throw new Error(`KHO_THIEU:Kho chính chỉ còn ít hơn ${sl} của "${existing.productName}" — chưa trừ được, nhập kho món này rồi chuyển Đã trả lại.`)
                await ghiTheKho(tx, existing, -sl, 'Trả khách đổi mới: xuất máy mới giao khách', req)
                data.newUnitIssuedAt = new Date()
                message = `Đã trả khách: trừ ${sl} "${existing.productName}" ở kho chính (máy hỏng đã nằm kho hư hỏng từ lúc đổi mới)`
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
            const sl = Math.max(1, Number(r.quantity) || 1)
            if (r.productId && !r.supplierReturnedAt) {
                /**
                 * Hoàn ĐÚNG phần phiếu đang giữ — hai vế độc lập:
                 *  - kho hư hỏng −n nếu hàng đang nằm đó (nội bộ đã gửi đi,
                 *    hoặc máy hỏng khách đã nhập lúc đổi mới)
                 *  - kho chính +n nếu phiếu từng TRỪ kho chính (nội bộ:
                 *    stockMovedAt; đổi mới khách: newUnitIssuedAt)
                 */
                if (r.stockMovedAt || r.replacedStockAt) {
                    const khoHu = await khoHuHong(tx, r.branchId)
                    if (khoHu) await updateWarehouseStock(tx, khoHu, r.productId, -sl)
                    await ghiTheKho(tx, r, -sl, 'Xoá phiếu — rút khỏi kho hư hỏng', req)
                }
                if (r.stockMovedAt || r.newUnitIssuedAt) {
                    await adjustSellableStock(tx, r.productId, r.branchId, sl, `Xoá phiếu ${r.code} — hoàn kho chính`)
                    await ghiTheKho(tx, r, sl, 'Xoá phiếu — hoàn kho chính', req)
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
