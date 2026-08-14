import { Router, Request, Response } from 'express'
import { authMiddleware, getBranchFilter, AuthRequest, getBranchId } from '../middleware/auth'
import { validate } from '../middleware/validate'
import { CreateBundleSchema, UpdateBundleSchema } from '../schemas'

const router = Router()

/** items lưu dạng chuỗi JSON — bản ghi hỏng không được làm sập cả trang combo. */
function docItems(raw: any): any[] {
    try {
        const v = JSON.parse(raw || '[]')
        return Array.isArray(v) ? v : []
    } catch { return [] }
}

// GET /api/bundles/stats
router.get('/stats', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const bundles = await prisma.bundle.findMany({
            select: { active: true, soldCount: true, bundlePrice: true, discount: true },
        })
        const total = bundles.length
        const active = bundles.filter(b => b.active).length
        const totalSold = bundles.reduce((s, b) => s + (b.soldCount ?? 0), 0)
        const totalRevenue = bundles.reduce((s, b) => s + ((b.soldCount ?? 0) * (b.bundlePrice ?? 0)), 0)
        const avgDiscount = total > 0 ? Math.round(bundles.reduce((s, b) => s + (b.discount ?? 0), 0) / total * 10) / 10 : 0
        res.json({ success: true, data: { total, active, inactive: total - active, totalSold, totalRevenue, avgDiscount } })
    } catch (err) {
        console.error('Bundle stats error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// GET /api/bundles
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { active, category, search } = req.query
        const where: any = {}
        if (active === 'true') where.active = true
        if (active === 'false') where.active = false

        /* HẠN DÙNG và GIỚI HẠN LƯỢT trước giờ chỉ được HIỂN THỊ, không ai áp
         * dụng: combo hết hạn từ tháng trước vẫn bán bình thường ở POS, và giới
         * hạn "chỉ 50 lượt" không bao giờ dừng ở lượt thứ 51.
         *
         * Chỉ lọc khi bên gọi xin danh sách combo ĐANG BÁN (active=true — chính
         * là POS). Trang quản lý vẫn phải thấy combo hết hạn, nếu không thì
         * không ai gia hạn hay sửa được nó nữa. */
        const chiConBanDuoc = active === 'true'
        if (chiConBanDuoc) {
            where.OR = [{ validUntil: null }, { validUntil: { gte: new Date() } }]
        }
        if (category && category !== 'all') where.category = category
        if (search) where.name = { contains: String(search) }

        const bundles = await prisma.bundle.findMany({ where, orderBy: { createdAt: 'desc' } })
        /* Giới hạn lượt phải so soldCount với maxUsage — hai CỘT với nhau, Prisma
         * không lọc thẳng được nên lọc ở đây. Danh sách combo luôn nhỏ nên không
         * đáng để viết SQL thô. */
        const conLuot = (b: any) => !chiConBanDuoc || !b.maxUsage || (b.soldCount ?? 0) < b.maxUsage
        const daDoc = bundles.filter(conLuot).map(b => ({ ...b, items: docItems(b.items) }))

        /* GIÁ VỐN COMBO — thiếu nó thì màn hình combo chỉ khoe "khách tiết kiệm
         * bao nhiêu" mà không ai thấy CỬA HÀNG còn lại bao nhiêu. Đặt giá combo
         * dưới giá vốn là bán càng nhiều lỗ càng nặng, và không có gì cảnh báo.
         *
         * Một truy vấn cho toàn bộ mã hàng của mọi combo, không N+1. */
        const khoaHang = new Set<string>()
        for (const b of daDoc) {
            for (const i of b.items) {
                if (i?.productId) khoaHang.add(String(i.productId))
            }
        }
        const sku = new Set<string>()
        for (const b of daDoc) {
            for (const i of b.items) {
                if (!i?.productId && i?.sku) sku.add(String(i.sku))
            }
        }

        const vonTheoId = new Map<string, number>()
        const vonTheoSku = new Map<string, number>()
        if (khoaHang.size > 0 || sku.size > 0) {
            try {
                const ds = await (prisma as any).product.findMany({
                    where: { OR: [{ id: { in: [...khoaHang] } }, { sku: { in: [...sku] } }] },
                    select: { id: true, sku: true, costPrice: true },
                })
                for (const p of ds) {
                    vonTheoId.set(String(p.id), Number(p.costPrice) || 0)
                    if (p.sku) vonTheoSku.set(String(p.sku), Number(p.costPrice) || 0)
                }
            } catch (e) {
                console.error('Đọc giá vốn cho combo lỗi:', e)
            }
        }

        const data = daDoc.map(b => {
            let von = 0
            let thieuGiaVon = 0
            const items = b.items.map((i: any) => {
                const sl = Number(i?.quantity) || 0
                const gv = i?.productId ? vonTheoId.get(String(i.productId))
                    : (i?.sku ? vonTheoSku.get(String(i.sku)) : undefined)
                if (gv === undefined || gv <= 0) thieuGiaVon++
                else von += gv * sl
                return { ...i, costPrice: gv ?? null }
            })

            /* Thiếu giá vốn dù chỉ MỘT món là không được kết luận lãi lỗ: cộng
             * thiếu một chân sẽ ra "lãi" trong khi thực tế đang lỗ — sai theo
             * đúng hướng nguy hiểm nhất. */
            const doDuoc = items.length > 0 && thieuGiaVon === 0
            const gia = Number(b.bundlePrice) || 0
            return {
                ...b, items,
                giaVon: doDuoc ? Math.round(von) : null,
                lai: doDuoc ? Math.round(gia - von) : null,
                bienLai: doDuoc && gia > 0 ? Math.round(((gia - von) / gia) * 1000) / 10 : null,
                soMonThieuGiaVon: thieuGiaVon,
            }
        })
        res.json({ success: true, data })
    } catch (err) {
        console.error('Get bundles error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// POST /api/bundles
router.post('/', authMiddleware, validate(CreateBundleSchema), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { name, category, items, originalTotal, bundlePrice, price, discount, active, validUntil, maxUsage } = req.body
        if (!name?.trim()) return res.status(400).json({ success: false, error: 'Bundle name required' })

        const bundle = await prisma.bundle.create({
            data: {
                name: name.trim(),
                category: category || null,
                items: JSON.stringify(items || []),
                originalTotal: Number(originalTotal) || 0,
                bundlePrice: Number(bundlePrice || price) || 0,
                discount: Number(discount) || 0,
                active: active !== false,
                validUntil: validUntil ? new Date(validUntil) : null,
                maxUsage: maxUsage ? Number(maxUsage) : null,
            },
        })
        res.status(201).json({ success: true, data: { ...bundle, items: JSON.parse(bundle.items) } })
    } catch (err) {
        console.error('Create bundle error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// PUT /api/bundles/:id
router.put('/:id', authMiddleware, validate(UpdateBundleSchema), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { name, category, items, originalTotal, bundlePrice, discount, active, soldCount, validUntil, maxUsage } = req.body
        const bundleId = String(req.params.id)
        const data: any = {}
        if (name !== undefined) data.name = name
        if (category !== undefined) data.category = category
        if (items !== undefined) data.items = JSON.stringify(items)
        if (originalTotal !== undefined) data.originalTotal = Number(originalTotal)
        if (bundlePrice !== undefined) data.bundlePrice = Number(bundlePrice)
        if (discount !== undefined) data.discount = Number(discount)
        if (active !== undefined) data.active = active
        if (soldCount !== undefined) data.soldCount = Number(soldCount)
        if (validUntil !== undefined) data.validUntil = validUntil ? new Date(validUntil) : null
        if (maxUsage !== undefined) data.maxUsage = maxUsage ? Number(maxUsage) : null

        const bundle = await prisma.bundle.update({ where: { id: bundleId }, data })
        res.json({ success: true, data: { ...bundle, items: JSON.parse(bundle.items) } })
    } catch (err) {
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// DELETE /api/bundles/:id
router.delete('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        await prisma.bundle.delete({ where: { id: String(req.params.id) } })
        res.json({ success: true })
    } catch (err) {
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

export default router
