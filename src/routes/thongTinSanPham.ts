/* ═══════════════════════════════════════════════════════════════════════════════
 *  THÔNG TIN SẢN PHẨM — ẢNH + MÔ TẢ (27/09/2026)
 *
 *  Chủ shop: "trong phần sản phẩm, có mục thông tin sản phẩm, ở đây nhân viên sẽ
 *  upload hình ảnh, mô tả sản phẩm". Nhân viên CHỈ được đụng ảnh + mô tả — không
 *  giá, không tồn — nên KHÔNG dùng lại PUT /api/products/:id (đòi products.edit và
 *  sửa được mọi thứ). Quyền riêng `product_info` (xem/sửa).
 *
 *  ⚠ ĐẶT TÊN QUYỀN: permissionSatisfied coi 'products.edit_images' là "chi tiết hơn"
 *  của 'products.edit' (startsWith 'products.edit_') ⇒ cấp nó cho nhân viên là mở
 *  luôn PUT /api/products/:id (sửa giá/tồn). Vì vậy quyền mới là module RIÊNG
 *  `product_info`, không nằm trong họ `products.*`.
 *
 *  Ảnh lưu ở lib/anhSanPham.ts (bucket công khai), không ghi đĩa Cloud Run.
 * ═══════════════════════════════════════════════════════════════════════════════ */
import { Router, Response, NextFunction } from 'express'
import multer from 'multer'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { requirePermission } from '../middleware/permissionMiddleware'
import { cacheDel } from '../lib/cache'
import { emitProductEvent } from '../lib/webhookDispatch'
import { moTaLoi } from '../lib/gomLoi'
import { nhanDangAnh, luuAnhSanPham, xoaAnhSanPham } from '../lib/anhSanPham'

const router = Router()

const TOI_DA_ANH = 9                    // đúng trần ảnh một sản phẩm của Shopee/TikTok
const TOI_DA_BYTE_ANH = 10 * 1024 * 1024
const TOI_DA_KY_TU_MO_TA = 10000        // TikTok 10.000; Shopee 3.000 — trang báo riêng

const XEM = requirePermission('product_info.view', 'product_info.edit', 'products.edit')
const SUA = requirePermission('product_info.edit', 'products.edit')

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: TOI_DA_BYTE_ANH, files: 1 } })
function nhanMotAnh(req: AuthRequest, res: Response, next: NextFunction) {
    upload.single('file')(req as any, res as any, (err: any) => {
        if (!err) return next()
        const quaCo = err?.code === 'LIMIT_FILE_SIZE'
        res.status(400).json({ success: false, error: quaCo ? 'Ảnh lớn quá 10MB — chụp lại hoặc giảm cỡ ảnh' : `Không nhận được ảnh: ${moTaLoi(err)}` })
    })
}

function schemaCuaHang(req: AuthRequest): string {
    const s = req.user?.branchSchema || req.user?.storeSchema
    if (!s || !/^[a-z0-9_]+$/.test(s)) throw new Error('Thiếu cửa hàng trong phiên đăng nhập')
    return s
}

/** Ảnh đại diện lên đầu, còn lại theo thứ tự tải lên (cuid tăng dần theo thời gian). */
const THU_TU_ANH = [{ isPrimary: 'desc' as const }, { id: 'asc' as const }]

async function danhSachAnh(prisma: any, productId: string) {
    return prisma.productImage.findMany({
        where: { productId }, orderBy: THU_TU_ANH, select: { id: true, url: true, isPrimary: true },
    })
}

/** Sau mỗi lần sửa: danh sách sản phẩm đang cache sẽ hiện ảnh cũ nếu không xoá. */
function sauKhiSua(req: AuthRequest, prisma: any, product: any) {
    const sc = req.user?.storeSchema || 'default'
    cacheDel(`products:${sc}:*`).catch(() => { })
    emitProductEvent(prisma, 'product.updated', product, req.user?.storeSchema).catch(() => { })
}

// ─── GET / — hàng việc: mã nào còn thiếu ảnh / mô tả ─────────────────────────
//  ?loc=can-bo-sung|thieu-anh|thieu-mo-ta|du|tat-ca  ?q=  ?sx=ton|ten|moi  ?trang=1&so=50
router.get('/', authMiddleware, XEM, async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const q = String(req.query.q || '').trim().slice(0, 100)
        const loc = String(req.query.loc || 'can-bo-sung')
        const sx = String(req.query.sx || 'ton')
        const so = Math.min(100, Math.max(1, Number(req.query.so) || 50))
        const trang = Math.max(1, Number(req.query.trang) || 1)

        // Mã đã GỘP chỉ là con trỏ sang mã khác; dịch vụ không cần ảnh — cả hai không vào hàng việc
        const nen: any = { mergedIntoId: null, productType: { not: 'service' } }
        if (q) nen.OR = [
            { name: { contains: q, mode: 'insensitive' } },
            { sku: { contains: q, mode: 'insensitive' } },
            { barcode: { contains: q } },
        ]
        const thieuAnh = { images: { none: {} } }
        const thieuMoTa = { OR: [{ description: null }, { description: '' }] }
        const coMoTa = { AND: [{ description: { not: null } }, { description: { not: '' } }] }
        const dieuKien: Record<string, any> = {
            'can-bo-sung': { AND: [nen, { OR: [thieuAnh, thieuMoTa] }] },
            'thieu-anh': { AND: [nen, thieuAnh] },
            'thieu-mo-ta': { AND: [nen, thieuMoTa] },
            'du': { AND: [nen, { images: { some: {} } }, coMoTa] },
            'tat-ca': nen,
        }
        const where = dieuKien[loc] || dieuKien['can-bo-sung']

        // POOL 1 trên prod ⇒ đếm LẦN LƯỢT, không Promise.all
        const dem: Record<string, number> = {}
        for (const k of Object.keys(dieuKien)) dem[k] = await prisma.product.count({ where: dieuKien[k] })

        const orderBy = sx === 'ten' ? [{ name: 'asc' }]
            : sx === 'moi' ? [{ updatedAt: 'desc' }]
            : [{ stock: 'desc' }, { name: 'asc' }]
        const rows: any[] = await prisma.product.findMany({
            where, orderBy, skip: (trang - 1) * so, take: so,
            select: {
                id: true, name: true, sku: true, barcode: true, stock: true, baseUnit: true,
                sellingPrice: true, description: true, updatedAt: true,
                category: { select: { name: true } },
                images: { orderBy: THU_TU_ANH, take: 1, select: { url: true } },
                _count: { select: { images: true } },
            },
        })
        const items = rows.map(p => {
            const moTa = String(p.description || '').trim()
            return {
                id: p.id, name: p.name, sku: p.sku, barcode: p.barcode, stock: p.stock,
                baseUnit: p.baseUnit, sellingPrice: p.sellingPrice, category: p.category?.name || null,
                anh: p.images[0]?.url || null, soAnh: p._count.images,
                moTa: moTa.slice(0, 140), doDaiMoTa: moTa.length,
                updatedAt: p.updatedAt,
            }
        })
        res.json({ success: true, data: { items, tong: dem[loc] ?? dem['can-bo-sung'], dem, trang, so } })
    } catch (e) {
        console.error('[thong-tin-san-pham] list:', e)
        res.status(500).json({ success: false, error: moTaLoi(e) })
    }
})

// ─── GET /:id — chi tiết để sửa ──────────────────────────────────────────────
router.get('/:id', authMiddleware, XEM, async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const p = await prisma.product.findFirst({
            where: { id: String(req.params.id) },
            select: {
                id: true, name: true, sku: true, barcode: true, stock: true, baseUnit: true,
                sellingPrice: true, description: true, updatedAt: true, mergedIntoId: true,
                category: { select: { name: true } }, brand: { select: { name: true } },
                images: { orderBy: THU_TU_ANH, select: { id: true, url: true, isPrimary: true } },
                // Ảnh đang dùng trên sàn — chỉ để nhân viên nhận ra đúng món, không ghi vào kho ảnh
                onlineProducts: {
                    where: { imageUrl: { not: null } }, take: 6,
                    select: { platform: true, name: true, imageUrl: true },
                },
            },
        })
        if (!p) return res.status(404).json({ success: false, error: 'Không thấy sản phẩm' })
        res.json({
            success: true,
            data: {
                ...p, category: p.category?.name || null, brand: p.brand?.name || null,
                anhTrenSan: p.onlineProducts, onlineProducts: undefined,
                toiDaAnh: TOI_DA_ANH, toiDaKyTuMoTa: TOI_DA_KY_TU_MO_TA,
            },
        })
    } catch (e) {
        console.error('[thong-tin-san-pham] detail:', e)
        res.status(500).json({ success: false, error: moTaLoi(e) })
    }
})

// ─── PUT /:id/mo-ta — lưu mô tả ──────────────────────────────────────────────
router.put('/:id/mo-ta', authMiddleware, SUA, async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const raw = req.body?.description
        if (raw !== null && raw !== undefined && typeof raw !== 'string') {
            return res.status(400).json({ success: false, error: 'Mô tả phải là chữ' })
        }
        // Giữ nguyên xuống dòng bên trong; chỉ bỏ khoảng trắng hai đầu và ký tự \r của Windows
        const moTa = String(raw ?? '').replace(/\r\n?/g, '\n').trim()
        if (moTa.length > TOI_DA_KY_TU_MO_TA) {
            return res.status(400).json({ success: false, error: `Mô tả dài ${moTa.length} ký tự — tối đa ${TOI_DA_KY_TU_MO_TA}` })
        }
        const id = String(req.params.id)
        const co = await prisma.product.findFirst({ where: { id }, select: { id: true } })
        if (!co) return res.status(404).json({ success: false, error: 'Không thấy sản phẩm' })
        const p = await prisma.product.update({ where: { id }, data: { description: moTa || null } })
        sauKhiSua(req, prisma, p)
        res.json({ success: true, data: { id: p.id, description: p.description, updatedAt: p.updatedAt } })
    } catch (e) {
        console.error('[thong-tin-san-pham] mo-ta:', e)
        res.status(500).json({ success: false, error: moTaLoi(e) })
    }
})

// ─── POST /:id/anh — tải MỘT ảnh (multipart 'file'); trang gửi lần lượt từng ảnh ─
router.post('/:id/anh', authMiddleware, SUA, nhanMotAnh, async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const file = (req as any).file as Express.Multer.File | undefined
        if (!file?.buffer?.length) return res.status(400).json({ success: false, error: 'Chưa có ảnh' })
        const loai = nhanDangAnh(file.buffer)
        if (loai === 'heic') return res.status(400).json({ success: false, error: 'Ảnh HEIC của iPhone chưa đọc được — mở trang bằng Safari trên iPhone, hoặc chỉnh Camera → Định dạng → Tương thích nhất' })
        if (!loai) return res.status(400).json({ success: false, error: 'Chỉ nhận ảnh JPG, PNG hoặc WEBP' })

        const id = String(req.params.id)
        const p = await prisma.product.findFirst({ where: { id }, select: { id: true, sku: true, name: true } })
        if (!p) return res.status(404).json({ success: false, error: 'Không thấy sản phẩm' })
        const daCo = await prisma.productImage.count({ where: { productId: id } })
        if (daCo >= TOI_DA_ANH) return res.status(400).json({ success: false, error: `Đã đủ ${TOI_DA_ANH} ảnh — xoá bớt ảnh cũ trước` })

        const url = await luuAnhSanPham(schemaCuaHang(req), id, file.buffer, loai)
        await prisma.productImage.create({ data: { productId: id, url, isPrimary: daCo === 0 } })
        await prisma.product.update({ where: { id }, data: { updatedAt: new Date() } })
        sauKhiSua(req, prisma, p)
        res.json({ success: true, data: { id, images: await danhSachAnh(prisma, id) } })
    } catch (e) {
        console.error('[thong-tin-san-pham] anh:', e)
        res.status(500).json({ success: false, error: `Không lưu được ảnh: ${moTaLoi(e)}` })
    }
})

// ─── PUT /:id/anh/:anhId/dai-dien — chọn ảnh đại diện ────────────────────────
router.put('/:id/anh/:anhId/dai-dien', authMiddleware, SUA, async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const id = String(req.params.id)
        const anhId = String(req.params.anhId)
        const p = await prisma.product.findFirst({ where: { id }, select: { id: true, sku: true, name: true } })
        const anh = p && await prisma.productImage.findFirst({ where: { id: anhId, productId: id }, select: { id: true } })
        if (!anh) return res.status(404).json({ success: false, error: 'Không thấy ảnh' })
        // Giao dịch kiểu hàm như phần còn lại của mã (POOL 1: bên trong CHỈ dùng tx)
        await prisma.$transaction(async (tx: any) => {
            await tx.productImage.updateMany({ where: { productId: id, NOT: { id: anhId } }, data: { isPrimary: false } })
            await tx.productImage.update({ where: { id: anhId }, data: { isPrimary: true } })
            await tx.product.update({ where: { id }, data: { updatedAt: new Date() } })
        })
        sauKhiSua(req, prisma, p)
        res.json({ success: true, data: { id, images: await danhSachAnh(prisma, id) } })
    } catch (e) {
        console.error('[thong-tin-san-pham] dai-dien:', e)
        res.status(500).json({ success: false, error: moTaLoi(e) })
    }
})

// ─── DELETE /:id/anh/:anhId — xoá ảnh ────────────────────────────────────────
router.delete('/:id/anh/:anhId', authMiddleware, SUA, async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const id = String(req.params.id)
        const anhId = String(req.params.anhId)
        const p = await prisma.product.findFirst({ where: { id }, select: { id: true, sku: true, name: true } })
        const anh = p && await prisma.productImage.findFirst({ where: { id: anhId, productId: id } })
        if (!anh) return res.status(404).json({ success: false, error: 'Không thấy ảnh' })
        await prisma.productImage.delete({ where: { id: anhId } })
        // Xoá mất ảnh đại diện thì ảnh kế tiếp lên thay — sàn/app luôn có ảnh chính
        if (anh.isPrimary) {
            const ke = await prisma.productImage.findFirst({ where: { productId: id }, orderBy: { id: 'asc' }, select: { id: true } })
            if (ke) await prisma.productImage.update({ where: { id: ke.id }, data: { isPrimary: true } })
        }
        await prisma.product.update({ where: { id }, data: { updatedAt: new Date() } })
        // Tệp trên bucket: xoá sau cùng, hỏng thì chỉ còn tệp mồ côi — không chặn thao tác
        await xoaAnhSanPham(anh.url, schemaCuaHang(req))
            .catch(e => console.warn(`[thong-tin-san-pham] xoá tệp ${anh.url}: ${moTaLoi(e)}`))
        sauKhiSua(req, prisma, p)
        res.json({ success: true, data: { id, images: await danhSachAnh(prisma, id) } })
    } catch (e) {
        console.error('[thong-tin-san-pham] xoa anh:', e)
        res.status(500).json({ success: false, error: moTaLoi(e) })
    }
})

export default router
