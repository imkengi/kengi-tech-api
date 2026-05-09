import { Router, Request, Response } from 'express'
import { authMiddleware, getBranchFilter, AuthRequest, getBranchId } from '../middleware/auth'
import { requireRole } from '../middleware/roleMiddleware'
import bcrypt from 'bcryptjs'
import { validate } from '../middleware/validate'
import { CreateEmployeeSchema, UpdateEmployeeSchema } from '../schemas'
import { cacheGet, cacheSet, cacheDel } from '../lib/cache'

const router = Router()

const safeUser = (u: any) => {
    const { password, ...rest } = u
    return rest
}

const DEPARTMENT_ROLES: Record<string, string[]> = {
    office: ['admin', 'manager', 'accountant'],
    sales: ['staff', 'cashier'],
    delivery: ['driver', 'shipper'],
    warranty: ['warranty', 'repairs'],
}

// GET /api/employees/stats
router.get('/stats', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const all = await prisma.user.findMany({ select: { role: true, employeeStatus: true } })
        const byRole: Record<string, number> = {}
        let active = 0, inactive = 0
        for (const u of all) {
            byRole[u.role] = (byRole[u.role] || 0) + 1
            if (u.employeeStatus === 'active') active++; else inactive++
        }
        res.json({ success: true, data: { total: all.length, active, inactive, byRole } })
    } catch { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// GET /api/employees
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const schema = req.user?.storeSchema || 'default'
        const cacheKey = `${schema}:employees:${JSON.stringify(req.query)}`
        const cached = await cacheGet(cacheKey)
        if (cached) return res.json(cached)
        const prisma = req.storePrisma!
        const { search, role, status, department } = req.query
        const where: any = { ...getBranchFilter(req as any) }
        if (department && DEPARTMENT_ROLES[String(department)]) {
            where.role = { in: DEPARTMENT_ROLES[String(department)] }
        } else if (role && role !== 'all') {
            where.role = String(role)
        }
        if (status && status !== 'all') where.employeeStatus = status
        if (search) {
            const q = String(search)
            where.OR = [
                { name: { contains: q } },
                { code: { contains: q } },
                { phone: { contains: q } },
                { email: { contains: q } },
            ]
        }
        const users = await prisma.user.findMany({ where, orderBy: { createdAt: 'desc' }, include: { branch: { select: { id: true, name: true, code: true, isMainBranch: true } } } })
        const _response = { success: true, data: users.map(u => { const { password, ...rest } = u; return rest }) }
        await cacheSet(cacheKey, _response, 300)
        res.json(_response)
    } catch (err) {
        console.error('Get employees error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// GET /api/employees/:id
router.get('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const user = await prisma.user.findFirst({ where: { id: String(req.params.id) }, include: { branch: { select: { id: true, name: true, code: true, isMainBranch: true } } } })
        if (!user) return res.status(404).json({ success: false, error: 'Not found' })
        const { password, ...rest } = user
        res.json({ success: true, data: rest })
    } catch (err) {
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// POST /api/employees
router.post('/', authMiddleware, requireRole('admin', 'manager'), validate(CreateEmployeeSchema), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { name, phone, email, role, salary, notes, branchId: assignBranchId, password: customPassword } = req.body
        if (!name?.trim()) return res.status(400).json({ success: false, error: 'Name required' })
        if (!phone?.trim()) return res.status(400).json({ success: false, error: 'Phone required' })

        // Use provided branchId or fallback to creator's branch
        const effectiveBranchId = assignBranchId || getBranchId(req)

        const count = await prisma.user.count({ where: {} })
        const code = `NV-${String(count + 1).padStart(3, '0')}`
        const emailVal = email?.trim() || `${code.toLowerCase().replace('-', '.')}@kengitech.vn`

        const existing = await prisma.user.findFirst({ where: { email: emailVal } })
        if (existing) return res.status(400).json({ success: false, error: 'Email already exists' })

        const hashedPassword = await bcrypt.hash(customPassword || '123456', 10)

        const user = await prisma.user.create({
            data: {
                name: name.trim(), email: emailVal, password: hashedPassword,
                role: role || 'cashier', phone: phone?.trim(), code,
                salary: salary ? Number(salary) : null,
                hireDate: new Date(), employeeStatus: 'active',
                notes: notes?.trim() || null, branchId: effectiveBranchId || null,
            },
        })
        cacheDel(`${req.user?.storeSchema || 'default'}:employees:*`).catch(() => { })
        res.status(201).json({ success: true, data: safeUser(user) })
    } catch (err) {
        console.error('Create employee error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// PUT /api/employees/:id
router.put('/:id', authMiddleware, requireRole('admin', 'manager'), validate(UpdateEmployeeSchema), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { name, phone, email, role, salary, notes, employeeStatus, branchId: newBranchId } = req.body
        const empId = String(req.params.id)

        const target = await prisma.user.findFirst({ where: { id: empId } })
        if (!target) return res.status(404).json({ success: false, error: 'Not found' })

        const currentUser = (req as any).user
        if (target.role === 'admin' && currentUser.role !== 'admin') {
            return res.status(403).json({ success: false, error: 'Không thể sửa tài khoản admin' })
        }
        if (role === 'admin' && currentUser.role !== 'admin') {
            return res.status(403).json({ success: false, error: 'Chỉ admin mới được gán quyền admin' })
        }

        const data: any = {}
        if (name !== undefined) data.name = name
        if (phone !== undefined) data.phone = phone
        if (email !== undefined) data.email = email
        if (role !== undefined) data.role = role
        if (salary !== undefined) data.salary = Number(salary)
        if (notes !== undefined) data.notes = notes
        if (employeeStatus !== undefined) data.employeeStatus = employeeStatus
        if (newBranchId !== undefined) data.branchId = newBranchId || null

        const user = await prisma.user.update({ where: { id: empId }, data, include: { branch: { select: { id: true, name: true, code: true, isMainBranch: true } } } })
        const { password: _, ...rest } = user
        res.json({ success: true, data: rest })
    } catch (err) {
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// PUT /api/employees/:id/reset-password
router.put('/:id/reset-password', authMiddleware, requireRole('admin', 'manager'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { password } = req.body
        const empId = String(req.params.id)

        const target = await prisma.user.findFirst({ where: { id: empId } })
        if (!target) return res.status(404).json({ success: false, error: 'Not found' })

        if (target.role === 'admin' && (req as any).user.role !== 'admin') {
            return res.status(403).json({ success: false, error: 'Không thể đặt lại mật khẩu admin' })
        }

        const newPassword = password || Math.random().toString(36).slice(-8) + 'A1'
        const hashed = await bcrypt.hash(newPassword, 10)
        await prisma.user.update({ where: { id: empId }, data: { password: hashed } })

        res.json({ success: true, data: { password: newPassword, message: `Mật khẩu mới: ${newPassword}` } })
    } catch (err) {
        console.error('Reset password error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// PUT /api/employees/:id/toggle-status
router.put('/:id/toggle-status', authMiddleware, requireRole('admin', 'manager'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const user = await prisma.user.findFirst({ where: { id: String(req.params.id) } })
        if (!user) return res.status(404).json({ success: false, error: 'Not found' })
        const updated = await prisma.user.update({
            where: { id: String(req.params.id) },
            data: { employeeStatus: user.employeeStatus === 'active' ? 'inactive' : 'active' },
        })
        res.json({ success: true, data: safeUser(updated) })
    } catch (err) {
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// DELETE /api/employees/:id
router.delete('/:id', authMiddleware, requireRole('admin'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const target = await prisma.user.findFirst({ where: { id: String(req.params.id) } })
        if (!target) return res.status(404).json({ success: false, error: 'Not found' })

        const txCount = await prisma.transaction.count({ where: { createdBy: String(req.params.id) } })
        if (txCount > 0) {
            return res.status(400).json({ success: false, error: `Employee has ${txCount} transactions, cannot delete. Deactivate instead.` })
        }
        await prisma.user.delete({ where: { id: String(req.params.id) } })
        res.json({ success: true })
    } catch (err) {
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ─── GET /api/employees/:id/permissions ───────────────────────────────────────
router.get('/:id/permissions', authMiddleware, requireRole('admin'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const user = await prisma.user.findFirst({
            where: { id: String(req.params.id) },
            select: { id: true, name: true, role: true, permissions: true },
        })
        if (!user) return res.status(404).json({ success: false, error: 'Nhân viên không tồn tại' })
        const permissions = JSON.parse(user.permissions || '[]')
        res.json({ success: true, data: { ...user, permissions } })
    } catch (err: any) {
        console.error('Get permissions error:', err)
        res.status(500).json({ success: false, error: 'Internal server error', detail: err?.message })
    }
})

// ─── PUT /api/employees/:id/permissions ───────────────────────────────────────
router.put('/:id/permissions', authMiddleware, requireRole('admin'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { permissions } = req.body
        if (!Array.isArray(permissions)) {
            return res.status(400).json({ success: false, error: 'permissions phải là một mảng' })
        }
        const user = await prisma.user.findFirst({ where: { id: String(req.params.id) } })
        if (!user) return res.status(404).json({ success: false, error: 'Nhân viên không tồn tại' })

        await prisma.user.update({
            where: { id: String(req.params.id) },
            data: { permissions: JSON.stringify(permissions) },
        })
        res.json({ success: true, data: { permissions } })
    } catch (err: any) {
        console.error('Update permissions error:', err)
        res.status(500).json({ success: false, error: 'Internal server error', detail: err?.message })
    }
})

export default router
