import { Router, Request, Response } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import { registryPrisma, getStorePrisma, branchIdToSchema, createBranchSchema, dropBranchSchema } from '../lib/prisma'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { requireRole } from '../middleware/roleMiddleware'

const router = Router()
const JWT_SECRET = process.env.JWT_SECRET
if (!JWT_SECRET) throw new Error('❌ JWT_SECRET environment variable is required.')
const ACCESS_TOKEN_TTL = '15m'       // Short-lived access token
const REFRESH_TOKEN_TTL_DAYS = 90    // Long-lived refresh token (90 days)

// ─── In-memory refresh token store ───────────────────────────────────────────
// Maps refreshToken -> { userId, storeCode, branchId, branchSchema, storeId, storeCode, isMainBranch, email, role, expiresAt }
const refreshTokenStore = new Map<string, {
    userId: string; email: string; role: string;
    storeId: string; storeCode: string;
    branchId: string | null; branchSchema: string;
    isMainBranch: boolean; expiresAt: Date;
}>()

// Cleanup expired tokens every hour
setInterval(() => {
    const now = new Date()
    for (const [token, data] of refreshTokenStore) {
        if (data.expiresAt < now) refreshTokenStore.delete(token)
    }
}, 60 * 60 * 1000)

function generateRefreshToken(): string {
    return crypto.randomBytes(64).toString('hex')
}

function createTokenPair(payload: any) {
    const accessToken = jwt.sign(payload, JWT_SECRET!, { expiresIn: ACCESS_TOKEN_TTL } as any)
    const refreshToken = generateRefreshToken()
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000)
    refreshTokenStore.set(refreshToken, { ...payload, expiresAt })
    return { accessToken, refreshToken, refreshExpiresAt: expiresAt }
}

const USER_SELECT = {
    id: true, email: true, name: true, role: true, phone: true, avatar: true,
    code: true, employeeStatus: true, isLocked: true, twoFactorEnabled: true,
    branchId: true, createdAt: true,
}

// ════════════════════════════════════════════════════════════════════════════════
// POST /api/auth/signup — Register new store
//
// Flow:
//   1. Create Store in registry
//   2. Generate a UUIDv4 for the main branch (pre-determined)
//   3. Compute schema name: branch_<branchId>
//   4. Create PostgreSQL schema + push all tables
//   5. Seed branch, admin user, store settings into the schema
//   6. Return JWT with branchSchema
// ════════════════════════════════════════════════════════════════════════════════
router.post('/signup', async (req: Request, res: Response) => {
    try {
        const { storeName, storeAddress, fullName, email, phone, password } = req.body
        if (!storeName?.trim() || !fullName?.trim() || !email?.trim() || !password) {
            return res.status(400).json({ success: false, error: 'Vui lòng điền đầy đủ thông tin' })
        }
        if (password.length < 8 || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
            return res.status(400).json({ success: false, error: 'Mật khẩu tối thiểu 8 ký tự, bao gồm chữ hoa và số' })
        }
        // Basic email format validation
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
            return res.status(400).json({ success: false, error: 'Email không hợp lệ' })
        }

        // Generate store code from name
        const code = storeName.trim().toUpperCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/[^A-Z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
            .substring(0, 20)

        // Check if email already registered anywhere (check registry)
        const existingStore = await registryPrisma.store.findUnique({ where: { code } })
        if (existingStore) {
            return res.status(409).json({ success: false, error: `Cửa hàng "${code}" đã tồn tại, vui lòng chọn tên khác` })
        }

        const hashedPw = await bcrypt.hash(password, 10)

        // 1. Create Store in registry (without schema yet)
        const store = await registryPrisma.store.create({
            data: {
                code,
                name: storeName.trim(),
                address: storeAddress?.trim() || null,
                phone: phone?.trim() || null,
                schema: 'pending', // will update after branch ID is known
            },
        })

        // 2. Generate branch ID first by creating a temp client on the runtime schema
        //    We use a pre-determined schema name based on store ID as fallback
        //    Then we'll know the branch ID after creation
        const tempSchema = branchIdToSchema(store.id) // temp using store.id
        await createBranchSchema(tempSchema)
        const tempPrisma = getStorePrisma(tempSchema)

        // 3. Create the main branch
        const branch = await tempPrisma.branch.create({
            data: {
                name: 'Chi nhánh chính',
                code: 'CN01',
                isMainBranch: true,
                address: storeAddress?.trim() || null,
            },
        })

        // 4. Compute final schema name = branch_<branchId> and rename schema
        const finalSchema = branchIdToSchema(branch.id)

        // Rename schema from temp to final
        await registryPrisma.$executeRawUnsafe(
            `ALTER SCHEMA "${tempSchema}" RENAME TO "${finalSchema}"`
        )

        // 5. Update Store in registry with the final schema name
        await registryPrisma.store.update({
            where: { id: store.id },
            data: { schema: finalSchema },
        })

        // 6. Now use the correctly named schema
        const storePrisma = getStorePrisma(finalSchema)

        // Create admin user
        const user = await storePrisma.user.create({
            data: {
                email: email.trim().toLowerCase(),
                name: fullName.trim(),
                password: hashedPw,
                role: 'admin',
                phone: phone?.trim() || null,
                branchId: branch.id,
            },
        })

        // Create store settings
        await storePrisma.storeSettings.create({
            data: {
                id: 'default',
                name: storeName.trim(),
                address: storeAddress?.trim() || null,
                phone: phone?.trim() || null,
            },
        })

        console.log(`✅ [Signup] Store "${store.code}" → schema "${finalSchema}"`)

        // 7. Sign JWT with branch schema + refresh token
        const tokenPayload = {
            userId: user.id, email: user.email, role: user.role,
            storeId: store.id, storeCode: store.code,
            branchId: branch.id, branchSchema: finalSchema, isMainBranch: true,
        }
        const { accessToken, refreshToken } = createTokenPair(tokenPayload)

        res.status(201).json({
            success: true,
            data: {
                token: accessToken,
                refreshToken,
                user: { id: user.id, email: user.email, name: user.name, role: user.role, phone: user.phone },
                store: { id: store.id, code: store.code, name: store.name },
                branch: { id: branch.id, name: branch.name, code: branch.code, schema: finalSchema },
            },
        })
    } catch (err: any) {
        console.error('Signup error:', err?.message || err)
        res.status(500).json({ success: false, error: 'Lỗi hệ thống, vui lòng thử lại' })
    }
})

// ─── POST /api/auth/branches — Get branches for a storeCode ─────────────────
// Used on the login page to list available branches
router.post('/branches', async (req: Request, res: Response) => {
    try {
        const { storeCode } = req.body
        if (!storeCode) { res.status(400).json({ success: false, error: 'storeCode required' }); return }

        const store = await registryPrisma.store.findFirst({ where: { code: storeCode } })
        if (!store || store.status !== 'active') {
            res.status(404).json({ success: false, error: 'Mã cửa hàng không tồn tại' })
            return
        }

        // Use the main branch schema to list all branches
        // (branch list is stored in each branch's own schema,
        //  but we keep a "branch directory" in the main schema)
        const mainPrisma = getStorePrisma(store.schema)
        const branches = await mainPrisma.branch.findMany({
            where: { status: 'active' },
            select: { id: true, name: true, code: true, address: true, phone: true, isMainBranch: true },
            orderBy: [{ isMainBranch: 'desc' }, { name: 'asc' }],
        })

        res.json({
            success: true,
            data: {
                store: { id: store.id, name: store.name, logo: null },
                branches,
            },
        })
    } catch (err: any) {
        console.error('Get branches error:', err)
        res.status(500).json({ success: false, error: 'Internal server error', detail: err?.message || String(err) })
    }
})

// ─── POST /api/auth/login ────────────────────────────────────────────────────
// All branches of a store share store.schema in registry.
// branchId is kept in JWT for filtering context only.
router.post('/login', async (req: Request, res: Response) => {
    try {
        const { email, password, storeCode, branchId } = req.body
        if (!email || !password) {
            res.status(400).json({ success: false, error: 'Email và mật khẩu là bắt buộc' })
            return
        }
        if (!storeCode) {
            res.status(400).json({ success: false, error: 'Mã cửa hàng là bắt buộc' })
            return
        }

        // 1. Look up store in registry
        const store = await registryPrisma.store.findFirst({ where: { code: storeCode } })
        if (!store) { res.status(401).json({ success: false, error: 'Mã cửa hàng không tồn tại' }); return }
        if (store.status !== 'active') { res.status(401).json({ success: false, error: 'Cửa hàng đã bị vô hiệu hóa' }); return }

        // 2. Use store.schema for all branches (branches share one schema per store)
        const branchSchema = store.schema
        const targetBranchId: string | null = branchId || null

        // 3. Authenticate user in the store schema
        const branchPrisma = getStorePrisma(branchSchema)
        const user = await branchPrisma.user.findFirst({
            where: { email: email.trim().toLowerCase() },
        })
        if (!user) { res.status(401).json({ success: false, error: 'Email hoặc mật khẩu không đúng' }); return }
        if (user.isLocked) { res.status(403).json({ success: false, error: 'Tài khoản đã bị khóa. Liên hệ quản trị viên.' }); return }

        const valid = await bcrypt.compare(password, user.password)
        if (!valid) { res.status(401).json({ success: false, error: 'Email hoặc mật khẩu không đúng' }); return }

        // 4. Get branch info
        const effectiveBranchId = targetBranchId || user.branchId
        let branch = null
        if (effectiveBranchId) {
            branch = await branchPrisma.branch.findUnique({
                where: { id: effectiveBranchId },
                select: { id: true, name: true, code: true, address: true, isMainBranch: true },
            })
        }

        // 5. Get store settings
        const settings = await branchPrisma.storeSettings.findUnique({ where: { id: 'default' } })

        // 6. Sign JWT + refresh token
        const tokenPayload = {
            userId: user.id, email: user.email, role: user.role,
            storeId: store.id, storeCode: store.code,
            branchId: effectiveBranchId, branchSchema,
            storeSchema: branchSchema, isMainBranch: branch?.isMainBranch || false,
        }
        const { accessToken, refreshToken } = createTokenPair(tokenPayload)

        res.json({
            success: true,
            data: {
                token: accessToken,
                refreshToken,
                user: {
                    id: user.id, email: user.email, name: user.name,
                    role: user.role, phone: user.phone,
                    avatar: user.avatar, twoFactorEnabled: user.twoFactorEnabled,
                },
                store: {
                    id: store.id, code: store.code, name: store.name,
                    address: settings?.address || store.address,
                    phone: settings?.phone || store.phone,
                    logo: settings?.logo || null,
                },
                branch,
            },
        })
    } catch (err: any) {
        console.error('Login error:', err?.message || err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ─── POST /api/auth/add-branch — Add new branch to existing store ────────────
// Creates a new PostgreSQL schema (branch_<newBranchId>) and seeds it
router.post('/add-branch', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        if (req.user?.role !== 'admin') {
            return res.status(403).json({ success: false, error: 'Chỉ admin mới có thể thêm chi nhánh' })
        }

        const storePrisma = req.storePrisma!
        const { name, code, address, phone } = req.body
        if (!name?.trim() || !code?.trim()) {
            return res.status(400).json({ success: false, error: 'Tên và mã chi nhánh là bắt buộc' })
        }

        // Check for duplicate code
        const existing = await storePrisma.branch.findFirst({ where: { code } })
        if (existing) return res.status(409).json({ success: false, error: `Mã chi nhánh "${code}" đã tồn tại` })

        // 1. Create branch entry in current branch schema (branch directory)
        const branch = await storePrisma.branch.create({
            data: { name: name.trim(), code: code.trim(), address: address || null, phone: phone || null },
        })

        // 2. Create new PostgreSQL schema for this branch
        const newSchema = branchIdToSchema(branch.id)
        await createBranchSchema(newSchema)

        // 3. Seed the new branch schema with minimum data (branch info + store settings copy)
        const newPrisma = getStorePrisma(newSchema)
        const storeSettings = await storePrisma.storeSettings.findUnique({ where: { id: 'default' } })

        // Copy branch info into new schema
        await newPrisma.branch.create({
            data: { id: branch.id, name: branch.name, code: branch.code, address: branch.address, phone: branch.phone },
        })

        // Copy store settings
        if (storeSettings) {
            await newPrisma.storeSettings.create({ data: { ...storeSettings } })
        }

        console.log(`✅ [AddBranch] Branch "${name}" (${code}) → schema "${newSchema}"`)

        res.status(201).json({
            success: true,
            data: {
                branch: { ...branch, schema: newSchema },
                message: `Chi nhánh "${name}" đã được tạo với schema riêng`,
            },
        })
    } catch (err: any) {
        console.error('Add branch error:', err?.message || err)
        res.status(500).json({ success: false, error: 'Lỗi khi tạo chi nhánh' })
    }
})

// ─── GET /api/auth/me ────────────────────────────────────────────────────────
router.get('/me', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const storePrisma = req.storePrisma!
        const user = await storePrisma.user.findUnique({ where: { id: req.user!.userId }, select: USER_SELECT })
        if (!user) { res.status(404).json({ success: false, error: 'User not found' }); return }

        let store = null
        if (req.user?.storeId) {
            store = await registryPrisma.store.findUnique({
                where: { id: req.user.storeId },
                select: { id: true, code: true, name: true, address: true, phone: true },
            })
        }
        let branch = null
        if (user.branchId) {
            branch = await storePrisma.branch.findUnique({
                where: { id: user.branchId },
                select: { id: true, name: true, code: true, address: true },
            })
        }

        const settings = await storePrisma.storeSettings.findUnique({ where: { id: 'default' } })

        res.json({
            success: true,
            data: {
                ...user,
                storeId: req.user?.storeId,
                storeCode: req.user?.storeCode,
                branchSchema: req.user?.branchSchema,
                store: store ? { ...store, logo: settings?.logo, address: settings?.address || store.address, phone: settings?.phone || store.phone } : null,
                branch,
            },
        })
    } catch (err) {
        console.error('Get me error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ─── GET /api/auth/users ─────────────────────────────────────────────────────
router.get('/users', authMiddleware, requireRole('admin', 'manager'), async (req: AuthRequest, res: Response) => {
    try {
        const storePrisma = req.storePrisma!
        const users = await storePrisma.user.findMany({
            select: { ...USER_SELECT, salary: true, hireDate: true, notes: true },
            orderBy: { name: 'asc' },
        })
        res.json({ success: true, data: users })
    } catch (err) {
        console.error('List users error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ─── POST /api/auth/register — Create new user (admin-only) ─────────────────
router.post('/register', authMiddleware, requireRole('admin', 'manager'), async (req: AuthRequest, res: Response) => {
    try {
        const storePrisma = req.storePrisma!
        const { email, name, password, role, phone, code, branchId } = req.body
        if (!email?.trim() || !name?.trim() || !password) {
            res.status(400).json({ success: false, error: 'Email, tên và mật khẩu là bắt buộc' })
            return
        }
        const hashed = await bcrypt.hash(password, 10)
        const user = await storePrisma.user.create({
            data: {
                email: email.trim().toLowerCase(),
                name: name.trim(), password: hashed,
                role: role || 'cashier', phone, code, branchId,
            },
            select: USER_SELECT,
        })
        res.status(201).json({ success: true, data: user })
    } catch (err: any) {
        if (err?.code === 'P2002') {
            res.status(409).json({ success: false, error: 'Email hoặc mã nhân viên đã tồn tại' })
            return
        }
        console.error('Register error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ─── PUT /api/auth/users/:id ─────────────────────────────────────────────────
router.put('/users/:id', authMiddleware, requireRole('admin'), async (req: AuthRequest, res: Response) => {
    try {
        const storePrisma = req.storePrisma!
        const { name, email, phone, role, code, branchId, isLocked, employeeStatus, password } = req.body
        const data: any = {}
        if (name !== undefined) data.name = name.trim()
        if (email !== undefined) data.email = email.trim().toLowerCase()
        if (phone !== undefined) data.phone = phone
        if (role !== undefined) data.role = role
        if (code !== undefined) data.code = code
        if (branchId !== undefined) data.branchId = branchId || null
        if (isLocked !== undefined) data.isLocked = Boolean(isLocked)
        if (employeeStatus !== undefined) data.employeeStatus = employeeStatus
        if (password) data.password = await bcrypt.hash(password, 10)

        const user = await storePrisma.user.update({ where: { id: String(req.params.id) }, data, select: USER_SELECT })
        res.json({ success: true, data: user })
    } catch (err) {
        console.error('Update user error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ─── DELETE /api/auth/users/:id ──────────────────────────────────────────────
router.delete('/users/:id', authMiddleware, requireRole('admin'), async (req: AuthRequest, res: Response) => {
    try {
        const storePrisma = req.storePrisma!
        await storePrisma.user.update({ where: { id: String(req.params.id) }, data: { employeeStatus: 'inactive', isLocked: true } })
        res.json({ success: true })
    } catch (err) {
        console.error('Delete user error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ─── PUT /api/auth/change-password ───────────────────────────────────────────
router.put('/change-password', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const storePrisma = req.storePrisma!
        const { oldPassword, newPassword } = req.body
        if (!oldPassword || !newPassword) {
            res.status(400).json({ success: false, error: 'Mật khẩu cũ và mới là bắt buộc' })
            return
        }
        if (newPassword.length < 8 || !/[A-Z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
            res.status(400).json({ success: false, error: 'Mật khẩu mới phải có ít nhất 8 ký tự, bao gồm chữ hoa và số' })
            return
        }
        const user = await storePrisma.user.findUnique({ where: { id: req.user!.userId } })
        if (!user) { res.status(404).json({ success: false, error: 'User not found' }); return }

        const valid = await bcrypt.compare(oldPassword, user.password)
        if (!valid) { res.status(400).json({ success: false, error: 'Mật khẩu cũ không đúng' }); return }

        await storePrisma.user.update({ where: { id: user.id }, data: { password: await bcrypt.hash(newPassword, 10) } })
        res.json({ success: true, message: 'Đổi mật khẩu thành công' })
    } catch (err) {
        console.error('Change password error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ─── PUT /api/auth/update-email ──────────────────────────────────────────────
router.put('/update-email', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const storePrisma = req.storePrisma!
        const { newEmail } = req.body
        if (!newEmail?.trim()) { res.status(400).json({ success: false, error: 'Email mới là bắt buộc' }); return }
        await storePrisma.user.update({ where: { id: req.user!.userId }, data: { email: newEmail.trim().toLowerCase() } })
        res.json({ success: true, message: 'Cập nhật email thành công' })
    } catch (err) {
        console.error('Update email error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ─── PUT /api/auth/toggle-2fa ────────────────────────────────────────────────
router.put('/toggle-2fa', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const storePrisma = req.storePrisma!
        const user = await storePrisma.user.findUnique({ where: { id: req.user!.userId }, select: { twoFactorEnabled: true } })
        if (!user) { res.status(404).json({ success: false, error: 'User not found' }); return }
        const newVal = !user.twoFactorEnabled
        await storePrisma.user.update({ where: { id: req.user!.userId }, data: { twoFactorEnabled: newVal } })
        res.json({ success: true, data: { twoFactorEnabled: newVal } })
    } catch (err) {
        console.error('Toggle 2FA error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ─── POST /api/auth/refresh — Exchange refresh token for new access token ────
router.post('/refresh', async (req: Request, res: Response) => {
    try {
        const { refreshToken } = req.body
        if (!refreshToken) {
            return res.status(400).json({ success: false, error: 'Refresh token is required' })
        }

        const stored = refreshTokenStore.get(refreshToken)
        if (!stored) {
            return res.status(401).json({ success: false, error: 'Invalid refresh token' })
        }

        // Check expiry
        if (stored.expiresAt < new Date()) {
            refreshTokenStore.delete(refreshToken)
            return res.status(401).json({ success: false, error: 'Refresh token expired' })
        }

        // Generate new access token (keep same refresh token)
        const { userId, email, role, storeId, storeCode, branchId, branchSchema, isMainBranch } = stored
        const newAccessToken = jwt.sign(
            { userId, email, role, storeId, storeCode, branchId, branchSchema, storeSchema: branchSchema, isMainBranch },
            JWT_SECRET!,
            { expiresIn: ACCESS_TOKEN_TTL } as any,
        )

        res.json({ success: true, data: { token: newAccessToken } })
    } catch (err) {
        console.error('Refresh token error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ─── POST /api/auth/logout — Invalidate refresh token ────────────────────────
router.post('/logout', async (req: Request, res: Response) => {
    const { refreshToken } = req.body
    if (refreshToken) refreshTokenStore.delete(refreshToken)
    res.json({ success: true })
})

export default router
