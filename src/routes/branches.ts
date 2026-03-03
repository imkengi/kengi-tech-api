import { Router, Request, Response } from 'express'
import { authMiddleware, AuthRequest, getBranchFilter } from '../middleware/auth'
import { cacheGet, cacheSet, cacheDel } from '../lib/cache'

const router = Router()

// GET /api/branches
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const schema = req.user?.storeSchema || 'default'
        const cacheKey = `${schema}:branches:${JSON.stringify(req.query)}`
        const cached = await cacheGet(cacheKey)
        if (cached) return res.json(cached)
        const prisma = req.storePrisma!
        // Branch model doesn't have branchId — filter by id for sub-branch users
        const branchWhere: any = { status: 'active' }
        if (!req.user?.isMainBranch && req.user?.branchId) {
            branchWhere.id = req.user.branchId // CN phụ chỉ thấy branch của mình
        }
        const data = await prisma.branch.findMany({
            where: branchWhere,
            orderBy: { createdAt: 'asc' },
        })
        const _response = { success: true, data }
        await cacheSet(cacheKey, _response, 300)
        res.json(_response)
    } catch (err) {
        console.error('List branches error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ─── POST /api/branches/request — Submit branch request for superadmin approval
router.post('/request', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { name, code, address, phone } = req.body

        if (!name?.trim() || !code?.trim()) {
            return res.status(400).json({ success: false, error: 'Tên và mã chi nhánh là bắt buộc' })
        }

        // Check if branch code already exists
        const existingBranch = await prisma.branch.findFirst({
            where: { code: code.trim().toUpperCase() },
        })
        if (existingBranch) {
            return res.status(409).json({ success: false, error: 'Mã chi nhánh đã tồn tại' })
        }

        // Check if there's already a pending request with the same code
        const existingRequest = await (prisma as any).branchRequest.findFirst({
            where: { branchCode: code.trim().toUpperCase(), status: 'pending' },
        })
        if (existingRequest) {
            return res.status(409).json({ success: false, error: 'Đã có yêu cầu mở chi nhánh với mã này đang chờ duyệt' })
        }

        // Get store name
        const store = await (prisma as any).store.findFirst({ select: { name: true } })

        // Get requester name
        const user = await prisma.user.findUnique({ where: { id: req.user!.userId }, select: { name: true } })

        const request = await (prisma as any).branchRequest.create({
            data: {
                storeName: store?.name || '',
                branchName: name.trim(),
                branchCode: code.trim().toUpperCase(),
                address: address?.trim() || null,
                phone: phone?.trim() || null,
                requestedBy: req.user!.userId,
                requestedByName: user?.name || '',
            },
        })

        cacheDel(`${req.user?.storeSchema || 'default'}:branches:*`).catch(() => {})
        res.status(201).json({
            success: true,
            data: request,
            message: 'Yêu cầu mở chi nhánh đã được gửi, vui lòng chờ superadmin duyệt',
        })
    } catch (err) {
        console.error('Create branch request error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ─── GET /api/branches/requests — List my store's branch requests
router.get('/requests', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const requests = await (prisma as any).branchRequest.findMany({
            where: {},
            orderBy: { createdAt: 'desc' },
        })
        res.json({ success: true, data: requests })
    } catch (err) {
        console.error('List branch requests error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// POST /api/branches — BLOCKED: must go through admin approval
router.post('/', authMiddleware, async (_req: AuthRequest, res: Response) => {
    res.status(403).json({
        success: false,
        error: 'Tạo chi nhánh trực tiếp đã bị vô hiệu hóa. Vui lòng sử dụng POST /api/branches/request để gửi yêu cầu, admin sẽ duyệt.',
    })
})

// PUT /api/branches/:id
router.put('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const id = req.params.id as string
        const { name, code, address, phone, status } = req.body
        const existing = await prisma.branch.findFirst({ where: { id } })
        if (!existing) return res.status(404).json({ success: false, error: 'Not found' })

        // Cannot change isMainBranch
        const data: any = {}
        if (name !== undefined) data.name = name.trim()
        if (code !== undefined) data.code = code.trim().toUpperCase()
        if (address !== undefined) data.address = address
        if (phone !== undefined) data.phone = phone
        if (status !== undefined) data.status = status

        const updated = await prisma.branch.update({ where: { id }, data })
        res.json({ success: true, data: updated })
    } catch (err) {
        console.error('Update branch error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// DELETE /api/branches/:id — Main branch: blocked. Sub-branch: needs admin approval
router.delete('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const id = req.params.id as string
        const existing = await prisma.branch.findFirst({ where: { id } })
        if (!existing) return res.status(404).json({ success: false, error: 'Not found' })

        // Cannot delete main branch
        if (existing.isMainBranch) {
            return res.status(403).json({
                success: false,
                error: 'Không thể xóa chi nhánh chính. Chi nhánh chính là bắt buộc cho mỗi cửa hàng.',
            })
        }

        // Get store and user info for the request
        const store = await (prisma as any).store.findFirst({ select: { name: true } })
        const user = await prisma.user.findUnique({ where: { id: req.user!.userId }, select: { name: true } })

        // Create delete request instead of deleting directly
        const deleteRequest = await (prisma as any).branchDeleteRequest.create({
            data: {
                branchId: id,
                branchName: existing.name,
                branchCode: existing.code,
                storeName: store?.name || '',
                requestedBy: req.user!.userId,
                requestedByName: user?.name || '',
                reason: req.body?.reason || null,
            },
        })

        res.json({
            success: true,
            data: deleteRequest,
            message: 'Yêu cầu xóa chi nhánh đã được gửi, vui lòng chờ admin duyệt.',
        })
    } catch (err) {
        console.error('Delete branch request error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

export default router
