import { Router, Request, Response } from 'express'
import { authMiddleware, getBranchFilter, AuthRequest, getBranchId } from '../middleware/auth'
import { validate } from '../middleware/validate'
import { CreateWarrantySchema, UpdateWarrantySchema } from '../schemas'
import { cacheGet, cacheSet, cacheDel } from '../lib/cache'
import { nextCode } from '../lib/codeGenerator'

const router = Router()

// GET /api/warranties
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const schema = req.user?.storeSchema || 'default'
        const cacheKey = `${schema}:warranties:${JSON.stringify(req.query)}`
        const cached = await cacheGet(cacheKey)
        if (cached) return res.json(cached)
        const prisma = req.storePrisma!
        const { search, status } = req.query
        const where: any = {}
        if (status && status !== 'all') where.status = String(status)
        if (search) {
            const q = String(search)
            where.OR = [{ productName: { contains: q } }, { customerName: { contains: q } }, { code: { contains: q } }, { serialNumber: { contains: q } }]
        }
        const data = await prisma.warranty.findMany({ where, orderBy: { createdAt: 'desc' } })
        const _response = { success: true, data }
        await cacheSet(cacheKey, _response, 300)
        res.json(_response)
    } catch (err: any) {
        console.error('GET /warranties error:', err?.message || err)
        if (err?.message?.includes('does not exist') || err?.code === 'P2021') {
            return res.json({ success: true, data: [] })
        }
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// POST /api/warranties
router.post('/', authMiddleware, validate(CreateWarrantySchema), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { productName, customerName, customerPhone, serialNumber, startDate, endDate, notes, productId } = req.body
        if (!productName?.trim() || !customerName?.trim()) return res.status(400).json({ success: false, error: 'Product and customer name required' })
        const code = await nextCode(prisma, 'warrantyCodeSeq', 'WR', 4, '-', 'Warranty', 'code')
        const data = await prisma.warranty.create({
            data: { code, productId, productName, customerName, customerPhone, serialNumber, startDate: new Date(startDate), endDate: new Date(endDate), notes },
        })
        cacheDel(`${req.user?.storeSchema || 'default'}:warranties:*`).catch(() => {})
        res.status(201).json({ success: true, data })
    } catch (err: any) {
        console.error('POST /warranties error:', err?.message || err)
        if (err?.message?.includes('does not exist') || err?.code === 'P2021') {
            return res.status(500).json({ success: false, error: 'Bảng Warranty chưa được tạo. Vui lòng chạy repair-schema.' })
        }
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// PUT /api/warranties/:id
router.put('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { status, notes, endDate, issue, resolution } = req.body
        const updateData: any = {}
        if (status) updateData.status = status
        if (endDate) updateData.endDate = new Date(endDate)

        // When marking as "claimed" (bảo hành hoàn thành), auto-append claim notes
        if (status === 'claimed' && (issue || resolution)) {
            const existing = await prisma.warranty.findUnique({ where: { id: String(req.params.id) }, select: { notes: true } })
            const timestamp = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })
            const claimBy = req.user?.email || 'unknown'
            const claimNote = [
                `\n--- BẢO HÀNH HOÀN THÀNH (${timestamp}) ---`,
                `Người xử lý: ${claimBy}`,
                issue ? `Vấn đề: ${issue}` : '',
                resolution ? `Kết quả: ${resolution}` : '',
            ].filter(Boolean).join('\n')
            updateData.notes = (existing?.notes || '') + claimNote
        } else if (notes !== undefined) {
            updateData.notes = notes
        }

        const data = await prisma.warranty.update({ where: { id: String(req.params.id) }, data: updateData })
        cacheDel(`${req.user?.storeSchema || 'default'}:warranties:*`).catch(() => {})
        res.json({ success: true, data })
    } catch (err: any) {
        console.error('PUT /warranties error:', err?.message || err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// DELETE /api/warranties/:id
router.delete('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        await prisma.warranty.delete({ where: { id: String(req.params.id) } }); res.json({ success: true })
    }
    catch (err: any) {
        console.error('DELETE /warranties error:', err?.message || err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

export default router
