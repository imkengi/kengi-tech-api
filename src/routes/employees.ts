import { Router, Request, Response } from 'express'
import prisma from '../lib/prisma'
import { authMiddleware } from '../middleware/auth'
import { requireRole } from '../middleware/roleMiddleware'
import bcrypt from 'bcryptjs'

const router = Router()

const safeUser = (u: any) => {
    const { password, ...rest } = u
    return rest
}

// Department → role mapping
const DEPARTMENT_ROLES: Record<string, string[]> = {
    office: ['admin', 'manager', 'accountant'],
    sales: ['sales', 'cashier'],
    delivery: ['driver', 'shipper'],
}

// GET /api/employees
router.get('/', authMiddleware, async (req: Request, res: Response) => {
    try {
        const { search, role, status, department } = req.query
        const where: any = {}
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
        const users = await prisma.user.findMany({ where, orderBy: { createdAt: 'desc' } })
        res.json({ success: true, data: users.map(safeUser) })
    } catch (err) {
        console.error('Get employees error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// GET /api/employees/:id
router.get('/:id', authMiddleware, async (req: Request, res: Response) => {
    try {
        const user = await prisma.user.findUnique({ where: { id: req.params.id } })
        if (!user) return res.status(404).json({ success: false, error: 'Not found' })
        res.json({ success: true, data: safeUser(user) })
    } catch (err) {
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// POST /api/employees (admin & manager only)
router.post('/', authMiddleware, requireRole('admin', 'manager'), async (req: Request, res: Response) => {
    try {
        const { name, phone, email, role, salary, notes } = req.body
        if (!name?.trim()) return res.status(400).json({ success: false, error: 'Name required' })
        if (!phone?.trim()) return res.status(400).json({ success: false, error: 'Phone required' })

        const count = await prisma.user.count()
        const code = `NV-${String(count + 1).padStart(3, '0')}`

        // Default email if not provided
        const emailVal = email?.trim() || `${code.toLowerCase().replace('-', '.')}@openretail.vn`
        // Check email uniqueness
        const existing = await prisma.user.findUnique({ where: { email: emailVal } })
        if (existing) return res.status(400).json({ success: false, error: 'Email already exists' })

        const hashedPassword = await bcrypt.hash('123456', 10) // default password

        const user = await prisma.user.create({
            data: {
                name: name.trim(),
                email: emailVal,
                password: hashedPassword,
                role: role || 'cashier',
                phone: phone?.trim(),
                code,
                salary: salary ? Number(salary) : null,
                hireDate: new Date(),
                employeeStatus: 'active',
                notes: notes?.trim() || null,
            },
        })
        res.status(201).json({ success: true, data: safeUser(user) })
    } catch (err) {
        console.error('Create employee error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// PUT /api/employees/:id (admin & manager only)
router.put('/:id', authMiddleware, requireRole('admin', 'manager'), async (req: Request, res: Response) => {
    try {
        const currentUser = (req as any).user
        const { name, phone, email, role, salary, notes, employeeStatus } = req.body

        // Manager cannot modify admin accounts
        const target = await prisma.user.findUnique({ where: { id: req.params.id } })
        if (target?.role === 'admin' && currentUser.role !== 'admin') {
            return res.status(403).json({ success: false, error: 'Không thể sửa tài khoản admin' })
        }
        // Manager cannot promote to admin
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

        const user = await prisma.user.update({ where: { id: req.params.id }, data })
        res.json({ success: true, data: safeUser(user) })
    } catch (err) {
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// PUT /api/employees/:id/toggle-status (admin & manager only)
router.put('/:id/toggle-status', authMiddleware, requireRole('admin', 'manager'), async (req: Request, res: Response) => {
    try {
        const user = await prisma.user.findUnique({ where: { id: req.params.id } })
        if (!user) return res.status(404).json({ success: false, error: 'Not found' })
        const updated = await prisma.user.update({
            where: { id: req.params.id },
            data: { employeeStatus: user.employeeStatus === 'active' ? 'inactive' : 'active' },
        })
        res.json({ success: true, data: safeUser(updated) })
    } catch (err) {
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// DELETE /api/employees/:id (admin only)
router.delete('/:id', authMiddleware, requireRole('admin'), async (req: Request, res: Response) => {
    try {
        // Don't allow deleting self
        const txCount = await prisma.transaction.count({ where: { createdBy: req.params.id } })
        if (txCount > 0) {
            return res.status(400).json({ success: false, error: `Employee has ${txCount} transactions, cannot delete. Deactivate instead.` })
        }
        await prisma.user.delete({ where: { id: req.params.id } })
        res.json({ success: true })
    } catch (err) {
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

export default router
