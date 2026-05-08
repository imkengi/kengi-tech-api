import { Router, Request, Response } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import { execSync } from 'child_process'
import { registryPrisma, getStorePrisma, branchIdToSchema, createBranchSchema, dropBranchSchema } from '../lib/prisma'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { requireRole } from '../middleware/roleMiddleware'
import { generateOtpCode, saveOtp, verifyOtp, consumeOtp, canSendOtp, OTP_CONFIG } from '../lib/otp'
import { sendEmail, buildOtpEmail } from '../services/emailService'

const router = Router()
const JWT_SECRET = process.env.JWT_SECRET || ''
if (!JWT_SECRET) {
    console.error('⚠️ JWT_SECRET environment variable is not set — auth routes will fail at runtime')
}
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

// ─── Pending 2FA login store ─────────────────────────────────────────────────
// Maps loginToken -> { payload data needed to complete login after 2FA verification }
const pending2FAStore = new Map<string, {
    userId: string; email: string; role: string;
    storeId: string; storeCode: string;
    branchId: string | null; branchSchema: string;
    isMainBranch: boolean; deviceId?: string;
    user: any; store: any; branch: any;
    expiresAt: Date;
}>()

// Cleanup expired pending 2FA tokens every 5 minutes
setInterval(() => {
    const now = new Date()
    for (const [token, data] of pending2FAStore) {
        if (data.expiresAt < now) pending2FAStore.delete(token)
    }
}, 5 * 60 * 1000)

function generateRefreshToken(): string {
    return crypto.randomBytes(64).toString('hex')
}

function createTokenPair(payload: any) {
    if (!JWT_SECRET) throw new Error('JWT_SECRET is not configured — cannot sign tokens')
    const accessToken = jwt.sign(payload, JWT_SECRET, { expiresIn: ACCESS_TOKEN_TTL } as any)
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
                schema: `pending_${code.toLowerCase()}_${Date.now()}`, // unique temp schema
            },
        })

        // 2. Generate permanent schema name based on STORE ID
        const finalSchema = branchIdToSchema(store.id)
        
        // 3. Create schema and push tables
        await createBranchSchema(finalSchema)
        const storePrisma = getStorePrisma(finalSchema)

        // 4. Update Store in registry with the final schema name BEFORE creating data
        // This ensures if creation fails, the registry is at least pointing to the right schema
        await registryPrisma.store.update({
            where: { id: store.id },
            data: { schema: finalSchema },
        })

        // 5. Create the main branch
        const branch = await storePrisma.branch.create({
            data: {
                name: 'Chi nhánh chính',
                code: 'CN01',
                isMainBranch: true,
                address: storeAddress?.trim() || null,
            },
        })

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

        const normalizedCode = storeCode.trim().toLowerCase()
        let store = await registryPrisma.store.findFirst({ where: { code: normalizedCode } })
        if (!store) {
            const stores: any[] = await registryPrisma.$queryRawUnsafe(
                `SELECT * FROM "Store" WHERE LOWER(code) = $1 LIMIT 1`, normalizedCode
            )
            if (stores.length > 0) store = stores[0]
        }
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

        // 1. Look up store in registry (case-insensitive)
        const normalizedCode = storeCode.trim().toLowerCase()
        let store = await registryPrisma.store.findFirst({ where: { code: normalizedCode } })
        if (!store) {
            // Fallback: SQL LOWER() for case-insensitive match
            const stores: any[] = await registryPrisma.$queryRawUnsafe(
                `SELECT * FROM "Store" WHERE LOWER(code) = $1 LIMIT 1`, normalizedCode
            )
            if (stores.length > 0) store = stores[0]
        }
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

        // 3.5 — 2FA gate: if enabled, send OTP and stop here. Client must call
        //      /api/auth/verify-otp with purpose=login_2fa to complete login.
        //      Skip when SMTP isn't configured — emailService falls back to
        //      console.log, which would silently lock users out.
        if (user.twoFactorEnabled && process.env.SMTP_USER) {
            const code = generateOtpCode()
            saveOtp('login_2fa', store.code, user.email, code)
            const { subject, html, text } = buildOtpEmail(code, 'login')
            try {
                await sendEmail(user.email, subject, html, text)
            } catch (e: any) {
                console.error('2FA OTP email failed:', e?.message || e)
                res.status(500).json({ success: false, error: 'Không thể gửi mã xác minh. Vui lòng thử lại.' })
                return
            }
            res.json({
                success: true,
                data: {
                    requiresOtp: true,
                    email: user.email,
                    storeCode: store.code,
                    branchId: targetBranchId,
                    expiresInMinutes: OTP_CONFIG.OTP_TTL_MIN,
                },
            })
            return
        }

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

        const userData = {
            id: user.id, email: user.email, name: user.name,
            role: user.role, phone: user.phone,
            avatar: user.avatar, twoFactorEnabled: user.twoFactorEnabled,
            permissions: JSON.parse((user as any).permissions || '[]'),
        }
        const storeData = {
            id: store.id, code: store.code, name: store.name,
            address: settings?.address || store.address,
            phone: settings?.phone || store.phone,
            logo: settings?.logo || null,
        }

        // ── 2FA Gate: if user has 2FA enabled, check trusted devices first ──
        if (user.twoFactorEnabled && user.twoFactorSecret) {
            const { deviceId } = req.body
            // Check if device is trusted
            const trustedDevices: any[] = JSON.parse(user.trustedDevices || '[]')
            const isTrusted = deviceId && trustedDevices.some((d: any) => d.id === deviceId)

            if (!isTrusted) {
                // Require 2FA — return a temporary loginToken
                const loginToken = crypto.randomBytes(32).toString('hex')
                pending2FAStore.set(loginToken, {
                    userId: user.id, email: user.email, role: user.role,
                    storeId: store.id, storeCode: store.code,
                    branchId: effectiveBranchId, branchSchema,
                    isMainBranch: branch?.isMainBranch || false,
                    deviceId, user: userData, store: storeData, branch,
                    expiresAt: new Date(Date.now() + 5 * 60 * 1000), // 5 minutes TTL
                })
                return res.json({
                    success: true,
                    data: {
                        requireTwoFactor: true,
                        loginToken,
                        user: userData,
                    },
                })
            }
            // Device is trusted — update lastUsed
            const updated = trustedDevices.map((d: any) => d.id === deviceId ? { ...d, lastUsed: new Date().toISOString() } : d)
            await branchPrisma.user.update({ where: { id: user.id }, data: { trustedDevices: JSON.stringify(updated) } }).catch(() => {})
        }

        // 6. Sign JWT + refresh token (bypassed 2FA or 2FA not enabled)
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
                user: userData,
                store: storeData,
                branch,
            },
        })
    } catch (err: any) {
        console.error('Login error:', err?.message || err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ─── POST /api/auth/verify-2fa — Complete login after 2FA verification ───────
router.post('/verify-2fa', async (req: Request, res: Response) => {
    try {
        const { loginToken, totpCode, deviceId, trustDevice, deviceName } = req.body
        if (!loginToken || !totpCode) {
            return res.status(400).json({ success: false, error: 'loginToken và totpCode là bắt buộc' })
        }

        const pending = pending2FAStore.get(loginToken)
        if (!pending) {
            return res.status(401).json({ success: false, error: 'Phiên đăng nhập 2FA đã hết hạn, vui lòng đăng nhập lại' })
        }
        if (pending.expiresAt < new Date()) {
            pending2FAStore.delete(loginToken)
            return res.status(401).json({ success: false, error: 'Phiên đăng nhập 2FA đã hết hạn' })
        }

        // Verify TOTP code
        const otplib = await import('otplib')
        const branchPrisma = getStorePrisma(pending.branchSchema)
        const user = await branchPrisma.user.findUnique({ where: { id: pending.userId }, select: { twoFactorSecret: true, trustedDevices: true } })
        if (!user?.twoFactorSecret) {
            pending2FAStore.delete(loginToken)
            return res.status(400).json({ success: false, error: '2FA chưa được thiết lập' })
        }

        const result = await otplib.verify({ secret: user.twoFactorSecret, token: totpCode })
        if (!result.valid) {
            return res.status(401).json({ success: false, error: 'Mã xác thực không đúng' })
        }

        // 2FA valid — consume the pending token
        pending2FAStore.delete(loginToken)

        // Optionally trust device
        if (trustDevice && deviceId) {
            const trustedDevices: any[] = JSON.parse(user.trustedDevices || '[]')
            const existing = trustedDevices.find((d: any) => d.id === deviceId)
            if (!existing) {
                trustedDevices.push({
                    id: deviceId,
                    name: deviceName || 'Unknown Device',
                    browser: req.headers['user-agent']?.split('/')[0] || 'Unknown',
                    os: deviceName || 'Unknown',
                    ip: req.headers['x-forwarded-for']?.toString().split(',')[0] || req.ip || 'Unknown',
                    lastUsed: new Date().toISOString(),
                    createdAt: new Date().toISOString(),
                })
                await branchPrisma.user.update({
                    where: { id: pending.userId },
                    data: { trustedDevices: JSON.stringify(trustedDevices) },
                }).catch(() => {})
            }
        }

        // Issue full JWT
        const tokenPayload = {
            userId: pending.userId, email: pending.email, role: pending.role,
            storeId: pending.storeId, storeCode: pending.storeCode,
            branchId: pending.branchId, branchSchema: pending.branchSchema,
            storeSchema: pending.branchSchema, isMainBranch: pending.isMainBranch,
        }
        const { accessToken, refreshToken } = createTokenPair(tokenPayload)

        res.json({
            success: true,
            data: {
                token: accessToken,
                refreshToken,
                user: pending.user,
                store: pending.store,
                branch: pending.branch,
            },
        })
    } catch (err: any) {
        console.error('Verify 2FA error:', err)
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

// ─── POST /api/auth/setup-2fa — Generate TOTP secret + otpauth URL ───────────
router.post('/setup-2fa', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const otplib = await import('otplib')
        const storePrisma = req.storePrisma!
        const user = await storePrisma.user.findUnique({ where: { id: req.user!.userId }, select: { email: true, twoFactorEnabled: true } })
        if (!user) { res.status(404).json({ success: false, error: 'User not found' }); return }
        if (user.twoFactorEnabled) { res.status(400).json({ success: false, error: '2FA đã được bật' }); return }

        const secret = otplib.generateSecret()
        // Build otpauth URI manually (standard format for Google Authenticator)
        const otpauthUrl = `otpauth://totp/Kengi%20Tech:${encodeURIComponent(user.email)}?secret=${secret}&issuer=Kengi%20Tech&algorithm=SHA1&digits=6&period=30`

        // Store secret temporarily (not enabled yet until confirmed)
        await storePrisma.user.update({ where: { id: req.user!.userId }, data: { twoFactorSecret: secret } })

        res.json({ success: true, data: { otpauthUrl, secret } })
    } catch (err: any) {
        console.error('Setup 2FA error:', err)
        res.status(500).json({ success: false, error: 'Lỗi thiết lập 2FA', detail: err?.message })
    }
})

// ─── POST /api/auth/confirm-2fa — Verify TOTP code and enable 2FA ────────────
router.post('/confirm-2fa', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const otplib = await import('otplib')
        const storePrisma = req.storePrisma!
        const { totpCode } = req.body
        if (!totpCode) { res.status(400).json({ success: false, error: 'Mã xác thực là bắt buộc' }); return }

        const user = await storePrisma.user.findUnique({ where: { id: req.user!.userId }, select: { twoFactorSecret: true, twoFactorEnabled: true } })
        if (!user) { res.status(404).json({ success: false, error: 'User not found' }); return }
        if (!user.twoFactorSecret) { res.status(400).json({ success: false, error: 'Chưa thiết lập 2FA, vui lòng gọi setup-2fa trước' }); return }

        const result = await otplib.verify({ secret: user.twoFactorSecret, token: totpCode })
        if (!result.valid) { res.status(400).json({ success: false, error: 'Mã xác thực không đúng' }); return }

        await storePrisma.user.update({ where: { id: req.user!.userId }, data: { twoFactorEnabled: true } })
        res.json({ success: true, message: 'Bật 2FA thành công' })
    } catch (err: any) {
        console.error('Confirm 2FA error:', err)
        res.status(500).json({ success: false, error: 'Internal server error', detail: err?.message })
    }
})

// ─── DELETE /api/auth/disable-2fa — Disable 2FA (requires password) ──────────
router.delete('/disable-2fa', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const storePrisma = req.storePrisma!
        const { password } = req.body
        if (!password) { res.status(400).json({ success: false, error: 'Mật khẩu là bắt buộc' }); return }

        const user = await storePrisma.user.findUnique({ where: { id: req.user!.userId } })
        if (!user) { res.status(404).json({ success: false, error: 'User not found' }); return }

        const valid = await bcrypt.compare(password, user.password)
        if (!valid) { res.status(400).json({ success: false, error: 'Mật khẩu không đúng' }); return }

        await storePrisma.user.update({
            where: { id: req.user!.userId },
            data: { twoFactorEnabled: false, twoFactorSecret: null, trustedDevices: '[]' },
        })
        res.json({ success: true, message: 'Đã tắt 2FA' })
    } catch (err: any) {
        console.error('Disable 2FA error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ─── GET /api/auth/trusted-devices — List trusted devices ────────────────────
router.get('/trusted-devices', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const storePrisma = req.storePrisma!
        const user = await storePrisma.user.findUnique({ where: { id: req.user!.userId }, select: { trustedDevices: true } })
        if (!user) { res.status(404).json({ success: false, error: 'User not found' }); return }
        const devices = JSON.parse(user.trustedDevices || '[]')
        res.json({ success: true, data: devices })
    } catch (err: any) {
        console.error('Get trusted devices error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ─── DELETE /api/auth/trusted-devices/:id — Remove a trusted device ──────────
router.delete('/trusted-devices/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const storePrisma = req.storePrisma!
        const user = await storePrisma.user.findUnique({ where: { id: req.user!.userId }, select: { trustedDevices: true } })
        if (!user) { res.status(404).json({ success: false, error: 'User not found' }); return }

        const devices = JSON.parse(user.trustedDevices || '[]').filter((d: any) => d.id !== req.params.id)
        await storePrisma.user.update({ where: { id: req.user!.userId }, data: { trustedDevices: JSON.stringify(devices) } })
        res.json({ success: true, data: devices })
    } catch (err: any) {
        console.error('Remove trusted device error:', err)
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
            JWT_SECRET,
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

// ─── POST /api/auth/send-otp ─────────────────────────────────────────────────
// Body: { email, storeCode, purpose: 'login_2fa' | 'password_reset' }
//   - login_2fa: resend OTP (requires the user to have already completed /login).
//                We re-check that 2FA is enabled before issuing.
//   - password_reset: anyone may request. We always respond success to avoid
//                     leaking which emails exist.
router.post('/send-otp', async (req: Request, res: Response) => {
    try {
        const { email, storeCode, purpose } = req.body || {}
        if (!email?.trim() || !storeCode?.trim()) {
            return res.status(400).json({ success: false, error: 'Email và mã cửa hàng là bắt buộc' })
        }
        if (purpose !== 'login_2fa' && purpose !== 'password_reset') {
            return res.status(400).json({ success: false, error: 'Loại yêu cầu không hợp lệ' })
        }

        const cooldown = canSendOtp(purpose, storeCode, email)
        if (!cooldown.ok) {
            return res.status(429).json({ success: false, error: `Vui lòng đợi ${cooldown.retryAfter}s trước khi gửi lại mã` })
        }

        // Case-insensitive store lookup (matches /login and /branches behavior)
        const normalizedCode = storeCode.trim().toLowerCase()
        let store = await registryPrisma.store.findFirst({ where: { code: normalizedCode } })
        if (!store) {
            const stores: any[] = await registryPrisma.$queryRawUnsafe(
                `SELECT * FROM "Store" WHERE LOWER(code) = $1 LIMIT 1`, normalizedCode
            )
            if (stores.length > 0) store = stores[0]
        }
        if (!store || store.status !== 'active') {
            // password_reset: silent success to prevent enumeration
            if (purpose === 'password_reset') return res.json({ success: true, data: { sent: true } })
            return res.status(404).json({ success: false, error: 'Mã cửa hàng không tồn tại' })
        }

        const storePrisma = getStorePrisma(store.schema)
        const user = await storePrisma.user.findFirst({ where: { email: email.trim().toLowerCase() } })

        if (purpose === 'login_2fa') {
            if (!user || !user.twoFactorEnabled) {
                return res.status(400).json({ success: false, error: 'Không đủ điều kiện để gửi mã 2FA' })
            }
        } else if (purpose === 'password_reset') {
            // Silent success if user not found
            if (!user) return res.json({ success: true, data: { sent: true } })
        }

        const code = generateOtpCode()
        saveOtp(purpose, store.code, email, code)
        const { subject, html, text } = buildOtpEmail(code, purpose === 'login_2fa' ? 'login' : 'reset')
        try {
            await sendEmail(email.trim().toLowerCase(), subject, html, text)
        } catch (e: any) {
            console.error('Send OTP email failed:', e?.message || e)
            return res.status(500).json({ success: false, error: 'Không thể gửi email. Vui lòng thử lại.' })
        }

        res.json({ success: true, data: { sent: true, expiresInMinutes: OTP_CONFIG.OTP_TTL_MIN } })
    } catch (err: any) {
        console.error('send-otp error:', err?.message || err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ─── POST /api/auth/verify-otp ───────────────────────────────────────────────
// Body: { email, storeCode, code, purpose, branchId? }
//   - login_2fa: completes login. Returns full token pair + user/store/branch.
//   - password_reset: returns a short-lived reset token (10m JWT) to be passed
//                     to /reset-password. The OTP is consumed here.
router.post('/verify-otp', async (req: Request, res: Response) => {
    try {
        const { email, storeCode, code, purpose, branchId } = req.body || {}
        if (!email?.trim() || !storeCode?.trim() || !code || !purpose) {
            return res.status(400).json({ success: false, error: 'Thiếu thông tin xác minh' })
        }
        if (purpose !== 'login_2fa' && purpose !== 'password_reset') {
            return res.status(400).json({ success: false, error: 'Loại yêu cầu không hợp lệ' })
        }

        const result = verifyOtp(purpose, storeCode, email, String(code))
        if (!result.ok) {
            const msg = {
                not_found: 'Mã không tồn tại hoặc đã hết hạn',
                expired: 'Mã đã hết hạn',
                too_many_attempts: 'Quá nhiều lần thử. Vui lòng yêu cầu mã mới.',
                invalid: 'Mã không đúng',
            }[result.reason]
            return res.status(400).json({ success: false, error: msg })
        }

        // Case-insensitive store lookup (matches /login and /branches behavior)
        const normalizedCode = storeCode.trim().toLowerCase()
        let store = await registryPrisma.store.findFirst({ where: { code: normalizedCode } })
        if (!store) {
            const stores: any[] = await registryPrisma.$queryRawUnsafe(
                `SELECT * FROM "Store" WHERE LOWER(code) = $1 LIMIT 1`, normalizedCode
            )
            if (stores.length > 0) store = stores[0]
        }
        if (!store || store.status !== 'active') {
            return res.status(404).json({ success: false, error: 'Cửa hàng không tồn tại' })
        }
        const storePrisma = getStorePrisma(store.schema)
        const user = await storePrisma.user.findFirst({ where: { email: email.trim().toLowerCase() } })
        if (!user) return res.status(404).json({ success: false, error: 'Người dùng không tồn tại' })

        if (purpose === 'login_2fa') {
            if (user.isLocked) return res.status(403).json({ success: false, error: 'Tài khoản đã bị khóa' })
            consumeOtp('login_2fa', store.code, email)

            const effectiveBranchId = branchId || user.branchId
            let branch = null
            if (effectiveBranchId) {
                branch = await storePrisma.branch.findUnique({
                    where: { id: effectiveBranchId },
                    select: { id: true, name: true, code: true, address: true, isMainBranch: true },
                })
            }
            const settings = await storePrisma.storeSettings.findUnique({ where: { id: 'default' } })

            const tokenPayload = {
                userId: user.id, email: user.email, role: user.role,
                storeId: store.id, storeCode: store.code,
                branchId: effectiveBranchId, branchSchema: store.schema,
                storeSchema: store.schema, isMainBranch: branch?.isMainBranch || false,
            }
            const { accessToken, refreshToken } = createTokenPair(tokenPayload)

            return res.json({
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
        }

        // password_reset: issue a short-lived reset token; OTP is consumed.
        consumeOtp('password_reset', store.code, email)
        const resetToken = jwt.sign(
            { purpose: 'password_reset', userId: user.id, storeId: store.id, storeCode: store.code },
            JWT_SECRET!,
            { expiresIn: '10m' } as any,
        )
        return res.json({ success: true, data: { resetToken, expiresInMinutes: 10 } })
    } catch (err: any) {
        console.error('verify-otp error:', err?.message || err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ─── POST /api/auth/reset-password ───────────────────────────────────────────
// Body: { resetToken, newPassword }
// resetToken comes from a successful /verify-otp with purpose=password_reset.
router.post('/reset-password', async (req: Request, res: Response) => {
    try {
        const { resetToken, newPassword } = req.body || {}
        if (!resetToken || !newPassword) {
            return res.status(400).json({ success: false, error: 'Thiếu thông tin' })
        }
        if (newPassword.length < 8 || !/[A-Z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
            return res.status(400).json({ success: false, error: 'Mật khẩu mới phải có ít nhất 8 ký tự, bao gồm chữ hoa và số' })
        }

        let payload: any
        try {
            payload = jwt.verify(resetToken, JWT_SECRET!)
        } catch {
            return res.status(401).json({ success: false, error: 'Token đặt lại đã hết hạn hoặc không hợp lệ' })
        }
        if (payload?.purpose !== 'password_reset' || !payload?.userId || !payload?.storeId) {
            return res.status(401).json({ success: false, error: 'Token không hợp lệ' })
        }

        const store = await registryPrisma.store.findUnique({ where: { id: payload.storeId } })
        if (!store) return res.status(404).json({ success: false, error: 'Cửa hàng không tồn tại' })

        const storePrisma = getStorePrisma(store.schema)
        const hashed = await bcrypt.hash(newPassword, 10)
        await storePrisma.user.update({ where: { id: payload.userId }, data: { password: hashed } })

        // Invalidate all refresh tokens for this user (force re-login everywhere)
        for (const [token, data] of refreshTokenStore) {
            if (data.userId === payload.userId) refreshTokenStore.delete(token)
        }

        res.json({ success: true, message: 'Đặt lại mật khẩu thành công' })
    } catch (err: any) {
        console.error('reset-password error:', err?.message || err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

export default router
