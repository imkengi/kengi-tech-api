import { Router, Request, Response } from 'express'
import { errorDetail } from '../lib/errorResponse'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import { execSync } from 'child_process'
import { registryPrisma, getStorePrisma, branchIdToSchema, createBranchSchema, dropBranchSchema } from '../lib/prisma'
import { authMiddleware, AuthRequest, AuthPayload, registerSseRefresh } from '../middleware/auth'
import { requireRole } from '../middleware/roleMiddleware'
import { generateOtpCode, saveOtp, verifyOtp, consumeOtp, canSendOtp, OTP_CONFIG } from '../lib/otp'
import {
    layTokenThietBi, timThietBi, chamThietBi, themThietBi, boThietBi, thietBiCongKhai, THIET_BI_TIN_CAY,
} from '../lib/trustedDevice'
import { sendEmail, buildOtpEmail } from '../services/emailService'
import { khoaDoiDuocToken, lyDoChanDucPhien, lyDoChanDoiThongTinDangNhap, diBangKhoaApi } from '../lib/phamViKhoaApi'

const router = Router()
const JWT_SECRET = process.env.JWT_SECRET || ''
if (!JWT_SECRET) {
    console.error('⚠️ JWT_SECRET environment variable is not set — auth routes will fail at runtime')
}
const ACCESS_TOKEN_TTL = '15m'       // Short-lived access token
const REFRESH_TOKEN_TTL_DAYS = 90    // Long-lived refresh token (90 days)

// ─── Refresh token persistence (registry DB is source of truth) ──────────────
// Refresh tokens are stored in the public.RefreshToken table (see prisma/schema.prisma).
// A small in-memory cache keeps hot lookups fast — but the DB is authoritative,
// so a deploy or pod restart does NOT log everyone out, and store suspension
// can revoke tokens by deleting rows.
type RefreshTokenRecord = {
    userId: string; email: string; role: string;
    storeId: string; storeCode: string;
    branchId: string | null; branchSchema: string;
    isMainBranch: boolean; deviceId?: string | null; expiresAt: Date;
}
const refreshTokenCache = new Map<string, RefreshTokenRecord>()

async function persistRefreshToken(token: string, rec: RefreshTokenRecord): Promise<void> {
    refreshTokenCache.set(token, rec)
    await registryPrisma.refreshToken.create({
        data: {
            token,
            userId: rec.userId,
            email: rec.email,
            role: rec.role,
            storeId: rec.storeId,
            storeCode: rec.storeCode,
            branchId: rec.branchId,
            branchSchema: rec.branchSchema,
            isMainBranch: rec.isMainBranch,
            deviceId: rec.deviceId ?? null,
            expiresAt: rec.expiresAt,
        },
    })
}

async function loadRefreshToken(token: string): Promise<RefreshTokenRecord | null> {
    const cached = refreshTokenCache.get(token)
    if (cached) return cached
    const row = await registryPrisma.refreshToken.findUnique({ where: { token } })
    if (!row) return null
    const rec: RefreshTokenRecord = {
        userId: row.userId, email: row.email, role: row.role,
        storeId: row.storeId, storeCode: row.storeCode,
        branchId: row.branchId, branchSchema: row.branchSchema,
        isMainBranch: row.isMainBranch, deviceId: row.deviceId,
        expiresAt: row.expiresAt,
    }
    refreshTokenCache.set(token, rec)
    return rec
}

async function deleteRefreshToken(token: string): Promise<void> {
    refreshTokenCache.delete(token)
    await registryPrisma.refreshToken.deleteMany({ where: { token } }).catch(() => {})
}

async function deleteRefreshTokensForUser(userId: string): Promise<void> {
    for (const [t, rec] of refreshTokenCache) {
        if (rec.userId === userId) refreshTokenCache.delete(t)
    }
    await registryPrisma.refreshToken.deleteMany({ where: { userId } }).catch(() => {})
}

// Cleanup expired tokens every hour (cache + DB)
setInterval(() => {
    const now = new Date()
    for (const [token, rec] of refreshTokenCache) {
        if (rec.expiresAt < now) refreshTokenCache.delete(token)
    }
    registryPrisma.refreshToken.deleteMany({ where: { expiresAt: { lt: now } } }).catch(() => {})
}, 60 * 60 * 1000)

// ─── Xác minh 2FA đang chờ — bảng public.Pending2FA (registry) ────────────────
/* Thống nhất 2FA 09/11/2026 (chủ shop chọn "phương án B"). MỌI lần xác minh 2FA đang dở nằm ở bảng này, không ở
 * RAM: prod chạy tới 3 bản Cloud Run, không có Redis ⇒ request xác minh có thể rơi vào bản khác bản đã cấp mã, và
 * mọi thứ trong RAM mất khi deploy (trước đây mã OTP email + bộ đếm sai TOTP nằm trong RAM).
 *   - 'totp'      đăng nhập đã đúng mật khẩu, chờ mã app (POST /verify-2fa) — 5 phút;
 *   - 'email'     đăng nhập đã đúng mật khẩu, chờ mã email (POST /verify-otp purpose login_2fa) — 10 phút;
 *   - 'bat_email' người đã đăng nhập đang bật 2FA qua email (POST /confirm-2fa method email) — 10 phút.
 * Mã email chỉ lưu băm; mỗi dòng cho thử tối đa 5 lần, đếm trên CSDL TRƯỚC khi so mã; xác minh đạt thì xoá dòng và
 * chỉ request xoá được (đếm = 1) mới được cấp phiên — hai request cùng mã thì một cái qua. Dòng cũ (method null) = 'totp'. */
const PENDING_2FA_TTL_MS = 5 * 60 * 1000
const MA_EMAIL_TTL_MS = OTP_CONFIG.OTP_TTL_MIN * 60 * 1000
const SO_LAN_THU_TOI_DA = 5
const GIAN_CACH_GUI_LAI_MS = OTP_CONFIG.RESEND_COOLDOWN_SEC * 1000
/** Gửi lại mã email gia hạn thêm 10 phút, nhưng một lần đăng nhập không treo quá 30 phút. */
const PHIEN_EMAIL_TOI_DA_MS = 30 * 60 * 1000

type CachXacMinh = 'totp' | 'email' | 'bat_email'

type Pending2FAPayload = {
    userId: string; email: string; role: string;
    storeId: string; storeCode: string;
    branchId: string | null; branchSchema: string;
    isMainBranch: boolean; deviceId?: string;
    user: any; store: any; branch: any;
    method?: CachXacMinh; codeHash?: string | null; sentAt?: Date | null;
}
type Pending2FA = Pending2FAPayload & {
    loginToken: string; method: CachXacMinh; codeHash: string | null; sentAt: Date | null;
    attempts: number; expiresAt: Date; createdAt: Date;
}

/** Băm mã email GẮN với lần chờ: cùng mã 6 số ở hai lần chờ khác nhau ra băm khác nhau. */
const bamMaEmail = (loginToken: string, code: string) => crypto.createHash('sha256').update(`${loginToken}:${code}`).digest('hex')
function maEmailKhop(p: { loginToken: string; codeHash: string | null }, code: unknown): boolean {
    if (!p.codeHash || (typeof code !== 'string' && typeof code !== 'number')) return false
    const a = Buffer.from(p.codeHash, 'hex')
    const b = Buffer.from(bamMaEmail(p.loginToken, String(code).trim()), 'hex')
    return a.length === b.length && crypto.timingSafeEqual(a, b)
}

async function savePending2FA(loginToken: string, p: Pending2FAPayload, expiresAt: Date): Promise<void> {
    await registryPrisma.pending2FA.create({
        data: {
            loginToken,
            userId: p.userId,
            email: p.email,
            role: p.role,
            storeId: p.storeId,
            storeCode: p.storeCode,
            branchId: p.branchId,
            branchSchema: p.branchSchema,
            isMainBranch: p.isMainBranch,
            deviceId: p.deviceId ?? null,
            userData: JSON.stringify(p.user ?? null),
            storeData: JSON.stringify(p.store ?? null),
            branchData: p.branch != null ? JSON.stringify(p.branch) : null,
            method: p.method ?? 'totp',
            codeHash: p.codeHash ?? null,
            sentAt: p.sentAt ?? null,
            expiresAt,
        },
    })
}

function dongThanhPending(row: any): Pending2FA {
    return {
        loginToken: row.loginToken,
        userId: row.userId, email: row.email, role: row.role,
        storeId: row.storeId, storeCode: row.storeCode,
        branchId: row.branchId, branchSchema: row.branchSchema,
        isMainBranch: row.isMainBranch, deviceId: row.deviceId ?? undefined,
        user: row.userData ? JSON.parse(row.userData) : null,
        store: row.storeData ? JSON.parse(row.storeData) : null,
        branch: row.branchData ? JSON.parse(row.branchData) : null,
        method: (row.method as CachXacMinh | null) || 'totp',
        codeHash: row.codeHash ?? null,
        sentAt: row.sentAt ?? null,
        attempts: row.attempts ?? 0,
        expiresAt: row.expiresAt,
        createdAt: row.createdAt,
    }
}

async function loadPending2FA(loginToken: unknown): Promise<Pending2FA | null> {
    if (typeof loginToken !== 'string' || !loginToken) return null
    const row = await registryPrisma.pending2FA.findUnique({ where: { loginToken } })
    return row ? dongThanhPending(row) : null
}

/** Lần chờ mã email MỚI NHẤT của (cửa hàng, email) — cho client cũ gọi verify-otp không kèm loginToken
 *  (web bản cũ còn trong trình duyệt, app Android ≤ 1.0.46). Dòng chỉ có khi ai đó vừa qua MẬT KHẨU ở /login. */
async function timChoEmailMoiNhat(storeCode: string, email: string): Promise<Pending2FA | null> {
    const row = await registryPrisma.pending2FA.findFirst({
        where: {
            method: 'email',
            email: { equals: email.trim(), mode: 'insensitive' },
            storeCode: { equals: storeCode.trim(), mode: 'insensitive' },
        },
        orderBy: { createdAt: 'desc' },
    })
    return row ? dongThanhPending(row) : null
}

/** Tính MỘT lần thử trước khi so mã (nguyên tử trên CSDL). false = đã hết lượt hoặc hết hạn ⇒ dòng bị xoá. */
async function tinhMotLanThu(loginToken: string): Promise<boolean> {
    const r = await registryPrisma.pending2FA.updateMany({
        where: { loginToken, attempts: { lt: SO_LAN_THU_TOI_DA }, expiresAt: { gt: new Date() } },
        data: { attempts: { increment: 1 } },
    })
    if (r.count === 1) return true
    await deletePending2FA(loginToken)
    return false
}

/** Dùng hết lần chờ: chỉ request xoá được dòng (đếm = 1) mới được đi tiếp. */
async function tieuThuPending2FA(loginToken: string): Promise<boolean> {
    const r = await registryPrisma.pending2FA.deleteMany({ where: { loginToken } })
    return r.count === 1
}

async function deletePending2FA(loginToken: string): Promise<void> {
    await registryPrisma.pending2FA.deleteMany({ where: { loginToken } }).catch(() => {})
}

/** Cách xác minh 2FA của một người: có hạt TOTP ⇒ CHỈ mã app; cờ bật mà không có hạt ⇒ mã email; cờ tắt ⇒ null.
 *  setup-2fa ghi hạt khi cờ còn TẮT (chưa xác nhận) ⇒ không tính; bật qua email thì confirm-2fa xoá hạt dở dang. */
function cach2FA(u: { twoFactorEnabled?: boolean | null; twoFactorSecret?: string | null }): 'totp' | 'email' | null {
    if (!u.twoFactorEnabled) return null
    return u.twoFactorSecret ? 'totp' : 'email'
}

/** Mã app (TOTP) khớp hạt không. otplib 13 NÉM lỗi khi mã không đúng 6 chữ số ("abc", "12345", có dấu cách…) — trước
 *  đây lỗi đó rơi xuống 500 "Internal server error"; nay tính là một lần nhập sai bình thường. */
async function maTotpKhop(secret: string, code: unknown): Promise<boolean> {
    const token = typeof code === 'number' ? String(code).padStart(6, '0') : typeof code === 'string' ? code.replace(/\s+/g, '') : ''
    if (!/^\d{6}$/.test(token)) return false
    try {
        const otplib = await import('otplib')
        const r = await otplib.verify({ secret, token })
        return !!r?.valid
    } catch {
        return false
    }
}

/** Gửi được mã qua email không. Máy dev thiếu SMTP thì sendEmail in mã ra console (cố ý, để thử); trên PROD thiếu SMTP
 *  mà vẫn "gửi" là in mã đăng nhập vào log máy chủ ⇒ từ chối thẳng, không lặng lẽ bỏ qua 2FA. */
const guiDuocMaEmail = () => !!process.env.SMTP_USER || process.env.NODE_ENV !== 'production'
const LOI_KHONG_GUI_DUOC_EMAIL = 'Máy chủ chưa cấu hình gửi email nên không gửi được mã xác minh — liên hệ quản trị viên'

/** Ghi nhớ thiết bị sau khi qua 2FA — CHỈ khi client xin `rememberDevice: true` (tức là sẽ lưu token và gửi lại lúc
 *  /login). Client cũ chỉ gửi `trustDevice` mà không lưu gì ⇒ không tạo mục rác trong danh sách thiết bị tin cậy. */
async function nhoThietBiNeuXin(
    req: Request,
    branchPrisma: ReturnType<typeof getStorePrisma>,
    userId: string,
    trustedDevicesHienTai: string | null | undefined,
): Promise<{ deviceToken: string; deviceTokenExpiresInDays: number } | null> {
    if (req.body?.rememberDevice !== true) return null
    const deviceName = typeof req.body?.deviceName === 'string' ? req.body.deviceName : ''
    const { token, json } = themThietBi(trustedDevicesHienTai, {
        name: deviceName,
        browser: req.headers['user-agent']?.split('/')[0],
        os: deviceName,
        ip: req.headers['x-forwarded-for']?.toString().split(',')[0] || req.ip,
    })
    try {
        await branchPrisma.user.update({ where: { id: userId }, data: { trustedDevices: json } })
    } catch (e: any) {
        // ghi không được thì KHÔNG trả token (client sẽ cầm một token không khớp gì) — đăng nhập vẫn qua
        console.error('Ghi thiết bị tin cậy lỗi:', e?.message || e)
        return null
    }
    return { deviceToken: token, deviceTokenExpiresInDays: THIET_BI_TIN_CAY.SO_NGAY }
}

// Cleanup expired pending 2FA rows every 5 minutes
setInterval(() => {
    registryPrisma.pending2FA.deleteMany({ where: { expiresAt: { lt: new Date() } } }).catch(() => {})
}, 5 * 60 * 1000)

function generateRefreshToken(): string {
    return crypto.randomBytes(64).toString('hex')
}

async function createTokenPair(payload: any, deviceId?: string | null) {
    if (!JWT_SECRET) throw new Error('JWT_SECRET is not configured — cannot sign tokens')
    const accessToken = jwt.sign(payload, JWT_SECRET, { expiresIn: ACCESS_TOKEN_TTL } as any)
    const refreshToken = generateRefreshToken()
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000)
    await persistRefreshToken(refreshToken, {
        userId: payload.userId,
        email: payload.email,
        role: payload.role,
        storeId: payload.storeId,
        storeCode: payload.storeCode,
        branchId: payload.branchId ?? null,
        branchSchema: payload.branchSchema,
        isMainBranch: !!payload.isMainBranch,
        deviceId: deviceId ?? null,
        expiresAt,
    })
    return { accessToken, refreshToken, refreshExpiresAt: expiresAt }
}

const USER_SELECT = {
    id: true, email: true, name: true, role: true, phone: true, avatar: true,
    code: true, employeeStatus: true, isLocked: true, twoFactorEnabled: true,
    branchId: true, createdAt: true, permissions: true,
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
/**
 * XÁC MINH ID TOKEN GOOGLE (30/08/2026, chủ shop: "thêm phần tiếp tục với
 * Google"). Cùng cách với trang tarot: verifyIdToken qua google-auth-library,
 * audience nhận cả hai client đã cấu hình trên prod. Email PHẢI ở trạng thái
 * đã xác minh — token hợp lệ mà email chưa verify vẫn không cho qua.
 */
async function xacThucGoogle(credential: string): Promise<{ email: string; name: string }> {
    const audience = [process.env.GOOGLE_OAUTH_CLIENT_ID, process.env.TAROT_GOOGLE_CLIENT_ID]
        .filter(Boolean) as string[]
    if (!audience.length) throw new Error('CHUA_CAU_HINH_GOOGLE')
    const { OAuth2Client } = await import('google-auth-library')
    const ticket = await new OAuth2Client().verifyIdToken({ idToken: credential, audience })
    const payload = ticket.getPayload()
    if (!payload?.email || !payload.email_verified) throw new Error('GOOGLE_EMAIL_CHUA_XAC_MINH')
    return { email: String(payload.email).toLowerCase(), name: payload.name || String(payload.email).split('@')[0] }
}

function loiGoogle(e: any): string {
    if (e?.message === 'CHUA_CAU_HINH_GOOGLE') return 'Máy chủ chưa cấu hình đăng nhập Google'
    if (e?.message === 'GOOGLE_EMAIL_CHUA_XAC_MINH') return 'Email Google chưa được xác minh'
    return 'Không xác minh được tài khoản Google — thử lại'
}

/** Client id cho nút Google phía FE — đọc lúc chạy, khỏi đóng cứng vào bản build. */
router.get('/google-client-id', (_req: Request, res: Response) => {
    res.json({
        success: true,
        data: { clientId: process.env.GOOGLE_OAUTH_CLIENT_ID || process.env.TAROT_GOOGLE_CLIENT_ID || null },
    })
})

router.post('/signup', async (req: Request, res: Response) => {
    try {
        let { storeName, storeAddress, fullName, email, phone, password } = req.body
        const { googleCredential } = req.body
        /* Đăng ký qua Google: email + tên lấy từ TOKEN (đã xác minh), không tin
         * chuỗi client gõ; mật khẩu được phép bỏ trống — sinh ngẫu nhiên, chủ
         * cửa hàng đăng nhập bằng Google từ đó về sau (đặt lại được qua Quên
         * mật khẩu vì OTP gửi về chính email này). */
        let matKhauTuSinh = false
        if (googleCredential) {
            try {
                const g = await xacThucGoogle(String(googleCredential))
                email = g.email
                if (!String(fullName || '').trim()) fullName = g.name
            } catch (e: any) {
                return res.status(401).json({ success: false, error: loiGoogle(e) })
            }
            if (!password) { password = 'Gg1-' + crypto.randomBytes(12).toString('base64url'); matKhauTuSinh = true }
        }
        if (!storeName?.trim() || !fullName?.trim() || !email?.trim() || !password) {
            return res.status(400).json({ success: false, error: 'Vui lòng điền đầy đủ thông tin' })
        }
        if (!matKhauTuSinh && (password.length < 8 || !/[A-Z]/.test(password) || !/[0-9]/.test(password))) {
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

        // Seed default warehouses (main / damaged / warranty)
        try {
            const suffix = finalSchema.slice(-6).toUpperCase()
            const defaults = [
                { code: `WH-MAIN-${suffix}`, name: 'Kho chính', type: 'main', description: 'Kho hàng hóa chính' },
                { code: `WH-DAMAGED-${suffix}`, name: 'Kho hàng hư hỏng', type: 'damaged', description: 'Kho chứa hàng bị hư hỏng, không bán được' },
                { code: `WH-WARRANTY-${suffix}`, name: 'Kho hàng bảo hành', type: 'warranty', description: 'Kho chứa hàng đang bảo hành / đã thu hồi để bảo hành' },
            ]
            for (const w of defaults) {
                await (storePrisma as any).warehouse.create({
                    data: { ...w, isDefault: true, isActive: true },
                }).catch(() => {})
            }
        } catch (e: any) {
            console.warn('[Signup] Default warehouse seeding failed:', e?.message)
        }

        console.log(`✅ [Signup] Store "${store.code}" → schema "${finalSchema}"`)

        // 7. Sign JWT with branch schema + refresh token
        const tokenPayload = {
            userId: user.id, email: user.email, role: user.role,
            storeId: store.id, storeCode: store.code,
            branchId: branch.id, branchSchema: finalSchema, isMainBranch: true,
        }
        const { accessToken, refreshToken } = await createTokenPair(tokenPayload)

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
        res.status(500).json({ success: false, error: 'Internal server error', detail: errorDetail(err) })
    }
})

// ─── POST /api/auth/login ────────────────────────────────────────────────────
// All branches of a store share store.schema in registry.
// branchId is kept in JWT for filtering context only.
router.post('/login', async (req: Request, res: Response) => {
    try {
        let { email } = req.body
        const { password, storeCode, branchId, googleCredential } = req.body
        if (!googleCredential && (!email || !password)) {
            res.status(400).json({ success: false, error: 'Tên đăng nhập (hoặc email) và mật khẩu là bắt buộc' })
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
        /* Đăng nhập Google: danh tính là EMAIL TRONG TOKEN đã xác minh — bỏ qua
         * email client gõ, và không so mật khẩu. Mọi bước sau (2FA, chi nhánh,
         * phát token) đi CHUNG một đường với đăng nhập mật khẩu. */
        let quaGoogle = false
        if (googleCredential) {
            try {
                const g = await xacThucGoogle(String(googleCredential))
                email = g.email
                quaGoogle = true
            } catch (e: any) {
                res.status(401).json({ success: false, error: loiGoogle(e) })
                return
            }
        }
        const branchPrisma = getStorePrisma(branchSchema)
        /* Ô đầu tiên nhận CẢ email lẫn TÊN ĐĂNG NHẬP (04/09/2026 — chủ shop: "thêm
         * nhân viên có tên đăng nhập để họ đăng nhập cho nhanh").
         *
         * Có '@' thì chắc chắn là email; không có thì tra tên đăng nhập. Tách bằng
         * '@' chứ không tra cả hai cột cùng lúc: username bị CẤM chứa '@' ở đường
         * tạo/sửa, nên hai không gian tên không bao giờ giẫm nhau — tra `OR` sẽ mở
         * đường cho một chuỗi khớp hai người nếu về sau ai đó lách được luật kia. */
        const dinhDanh = String(email).trim().toLowerCase()
        const user = dinhDanh.includes('@')
            ? await branchPrisma.user.findFirst({ where: { email: dinhDanh } })
            : await branchPrisma.user.findFirst({ where: { username: dinhDanh } as any })
        if (!user) {
            res.status(401).json({
                success: false,
                error: quaGoogle
                    ? `Email ${email} chưa có tài khoản trong cửa hàng này — nhờ quản trị viên tạo tài khoản với đúng email Google`
                    : 'Tên đăng nhập/email hoặc mật khẩu không đúng',
            })
            return
        }
        if (user.isLocked) { res.status(403).json({ success: false, error: 'Tài khoản đã bị khóa. Liên hệ quản trị viên.' }); return }

        if (!quaGoogle) {
            const valid = await bcrypt.compare(password, user.password)
            if (!valid) { res.status(401).json({ success: false, error: 'Email hoặc mật khẩu không đúng' }); return }
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

        /* ── CỔNG 2FA — MỘT cổng cho cả hai cách (09/11/2026, chủ shop chọn "phương án B") ───────────────────────
         * Trước đây có HAI cổng dùng chung cờ twoFactorEnabled: cổng OTP email (chạy TRƯỚC, khi có SMTP_USER) và cổng
         * TOTP. Prod có SMTP ⇒ ai bật 2FA cũng chỉ bị hỏi mã email, ô "Google Authenticator" không bao giờ hiện, dù
         * giao diện báo tài khoản được Google Authenticator bảo vệ. Nay:
         *   - có hạt TOTP (đã xác nhận qua confirm-2fa) ⇒ CHỈ hỏi mã app; không còn đường email nào lách qua;
         *   - cờ bật mà không có hạt (bật qua email) ⇒ mã gửi email, gắn với loginToken của CHÍNH lần đăng nhập này;
         *   - token thiết bị tin cậy còn hạn (máy chủ cấp, lib/trustedDevice) ⇒ bỏ qua bước nhập mã, cả hai cách.
         * Lần chờ nằm ở bảng Pending2FA, không ở RAM. Cửa hàng demo KENGIONLINE bỏ qua 2FA như cũ. */
        const isKengiOnline = store.code.toUpperCase() === 'KENGIONLINE'
        const cach = isKengiOnline ? null : cach2FA(user)
        if (cach) {
            const tokenThietBi = layTokenThietBi(req.body, req.headers['x-device-token'])
            const thietBi = tokenThietBi ? timThietBi(user.trustedDevices, tokenThietBi) : null
            if (thietBi) {
                await branchPrisma.user.update({
                    where: { id: user.id },
                    data: { trustedDevices: chamThietBi(user.trustedDevices, thietBi.id) },
                }).catch(() => {})
            } else {
                if (cach === 'email' && !guiDuocMaEmail()) {
                    res.status(503).json({ success: false, error: LOI_KHONG_GUI_DUOC_EMAIL })
                    return
                }
                // Mỗi người một lần chờ đăng nhập: lần mới thay lần cũ — không để nhiều mã cùng sống song song
                await registryPrisma.pending2FA.deleteMany({
                    where: { userId: user.id, storeId: store.id, OR: [{ method: null }, { method: { in: ['totp', 'email'] } }] },
                })
                const loginToken = crypto.randomBytes(32).toString('hex')
                const code = cach === 'email' ? generateOtpCode() : null
                const now = new Date()
                await savePending2FA(loginToken, {
                    userId: user.id, email: user.email, role: user.role,
                    storeId: store.id, storeCode: store.code,
                    branchId: effectiveBranchId, branchSchema,
                    isMainBranch: branch?.isMainBranch || false,
                    deviceId: typeof req.body?.deviceId === 'string' ? req.body.deviceId.slice(0, 120) : undefined,
                    user: userData, store: storeData, branch,
                    method: cach,
                    codeHash: code ? bamMaEmail(loginToken, code) : null,
                    sentAt: code ? now : null,
                }, new Date(now.getTime() + (cach === 'email' ? MA_EMAIL_TTL_MS : PENDING_2FA_TTL_MS)))

                if (cach === 'totp') {
                    res.json({ success: true, data: { requireTwoFactor: true, method: 'totp', loginToken, user: userData } })
                    return
                }
                const { subject, html, text } = buildOtpEmail(code!, 'login')
                try {
                    await sendEmail(user.email, subject, html, text)
                } catch (e: any) {
                    console.error('2FA OTP email failed:', e?.message || e)
                    await deletePending2FA(loginToken)
                    res.status(500).json({ success: false, error: 'Không thể gửi mã xác minh. Vui lòng thử lại.' })
                    return
                }
                res.json({
                    success: true,
                    data: {
                        requiresOtp: true,
                        method: 'email',
                        loginToken,
                        email: user.email,
                        storeCode: store.code,
                        branchId: targetBranchId,
                        expiresInMinutes: OTP_CONFIG.OTP_TTL_MIN,
                        user: userData,
                    },
                })
                return
            }
        }

        // 6. Sign JWT + refresh token (bypassed 2FA or 2FA not enabled)
        const tokenPayload = {
            userId: user.id, email: user.email, role: user.role,
            storeId: store.id, storeCode: store.code,
            branchId: effectiveBranchId, branchSchema,
            storeSchema: branchSchema, isMainBranch: branch?.isMainBranch || false,
        }
        const { accessToken, refreshToken } = await createTokenPair(tokenPayload, req.body?.deviceId)

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

type DaQua2FA = { pending: Pending2FA; nho: { deviceToken: string; deviceTokenExpiresInDays: number } | null }

/** Bước cuối của cả hai cách xác minh khi đăng nhập (verify-2fa / verify-otp login_2fa): mã đã khớp ⇒ tiêu lần chờ
 *  (chỉ MỘT request thắng), rồi nhớ thiết bị nếu client xin. null = lần chờ đã bị request khác dùng mất. Việc ĐÚC phiên
 *  (createTokenPair) để ngay trong handler: scripts/check-pham-vi-khoa.ts soát chỗ đúc phiên theo TỪNG tuyến. */
async function tieuThuLanCho(
    req: Request,
    pending: Pending2FA,
    branchPrisma: ReturnType<typeof getStorePrisma>,
    trustedDevicesHienTai: string | null | undefined,
): Promise<DaQua2FA | null> {
    if (!(await tieuThuPending2FA(pending.loginToken))) return null
    return { pending, nho: await nhoThietBiNeuXin(req, branchPrisma, pending.userId, trustedDevicesHienTai) }
}

/** Nội dung JWT của phiên cấp sau 2FA — y hệt /login (lần chờ chép lại từ lúc qua mật khẩu). */
const payloadPhien2FA = (p: Pending2FA) => ({
    userId: p.userId, email: p.email, role: p.role,
    storeId: p.storeId, storeCode: p.storeCode,
    branchId: p.branchId, branchSchema: p.branchSchema,
    storeSchema: p.branchSchema, isMainBranch: p.isMainBranch,
})
const deviceIdPhien2FA = (req: Request, p: Pending2FA) =>
    typeof req.body?.deviceId === 'string' && req.body.deviceId ? req.body.deviceId.slice(0, 120) : p.deviceId

/** data trả client sau 2FA — cùng hình dạng /login, kèm deviceToken khi vừa nhớ thiết bị. */
const dataPhien2FA = (q: DaQua2FA, t: { accessToken: string; refreshToken: string }) => ({
    token: t.accessToken,
    refreshToken: t.refreshToken,
    user: q.pending.user,
    store: q.pending.store,
    branch: q.pending.branch,
    ...(q.nho || {}),
})

/** Kiểm lại người dùng lúc nhập mã (khoá tài khoản / đổi cách 2FA giữa chừng). Trả câu lỗi + mã HTTP, hoặc null = ổn. */
function chanLucXacMinh(
    user: { isLocked?: boolean | null; twoFactorEnabled?: boolean | null; twoFactorSecret?: string | null } | null,
    canCach: 'totp' | 'email',
): { ma: number; loi: string } | null {
    if (!user) return { ma: 401, loi: 'Tài khoản không còn tồn tại' }
    if (user.isLocked) return { ma: 403, loi: 'Tài khoản đã bị khóa. Liên hệ quản trị viên.' }
    if (cach2FA(user) !== canCach) return { ma: 401, loi: 'Cài đặt xác thực 2 lớp của tài khoản vừa thay đổi — vui lòng đăng nhập lại' }
    return null
}

// ─── POST /api/auth/verify-2fa — hoàn tất đăng nhập bằng mã app (TOTP) ────────
// Body: { loginToken, totpCode, rememberDevice?, deviceName?, deviceId? }. rememberDevice: true ⇒ trả thêm deviceToken
// (client lưu lại, gửi kèm /login lần sau để bỏ qua bước nhập mã trong 30 ngày). `trustDevice` của client cũ bị bỏ qua.
router.post('/verify-2fa', async (req: Request, res: Response) => {
    try {
        const { loginToken, totpCode } = req.body || {}
        if (!loginToken || !totpCode) {
            return res.status(400).json({ success: false, error: 'loginToken và totpCode là bắt buộc' })
        }

        const pending = await loadPending2FA(loginToken)
        if (!pending) {
            return res.status(401).json({ success: false, error: 'Phiên đăng nhập 2FA đã hết hạn, vui lòng đăng nhập lại' })
        }
        if (pending.method !== 'totp') {
            return res.status(400).json({ success: false, error: 'Lần đăng nhập này cần mã gửi qua email, không phải mã app' })
        }
        if (pending.expiresAt < new Date()) {
            await deletePending2FA(pending.loginToken)
            return res.status(401).json({ success: false, error: 'Phiên đăng nhập 2FA đã hết hạn' })
        }
        // Đếm lượt TRÊN CSDL trước khi so mã: 5 lần cho mỗi lần đăng nhập, đúng với mọi bản Cloud Run
        if (!(await tinhMotLanThu(pending.loginToken))) {
            return res.status(429).json({ success: false, error: 'Sai mã 2FA quá nhiều lần. Vui lòng đăng nhập lại.' })
        }

        const branchPrisma = getStorePrisma(pending.branchSchema)
        const user = await branchPrisma.user.findUnique({
            where: { id: pending.userId },
            select: { isLocked: true, twoFactorEnabled: true, twoFactorSecret: true, trustedDevices: true },
        })
        const chan = chanLucXacMinh(user, 'totp')
        if (chan) {
            await deletePending2FA(pending.loginToken)
            return res.status(chan.ma).json({ success: false, error: chan.loi })
        }

        if (!(await maTotpKhop(user!.twoFactorSecret!, totpCode))) {
            const conLai = SO_LAN_THU_TOI_DA - (pending.attempts + 1)
            if (conLai <= 0) {
                await deletePending2FA(pending.loginToken)
                return res.status(429).json({ success: false, error: 'Sai mã 2FA quá nhiều lần. Vui lòng đăng nhập lại.' })
            }
            return res.status(401).json({ success: false, error: `Mã xác thực không đúng (còn ${conLai} lần thử)` })
        }

        const qua = await tieuThuLanCho(req, pending, branchPrisma, user!.trustedDevices)
        if (!qua) {
            return res.status(401).json({ success: false, error: 'Phiên đăng nhập 2FA đã được dùng — vui lòng đăng nhập lại' })
        }
        const phien = await createTokenPair(payloadPhien2FA(pending), deviceIdPhien2FA(req, pending))
        res.json({ success: true, data: dataPhien2FA(qua, phien) })
    } catch (err: any) {
        console.error('Verify 2FA error:', err?.message || err)
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

        // Seed default warehouses for the new branch
        try {
            const suffix = newSchema.slice(-6).toUpperCase()
            const defaults = [
                { code: `WH-MAIN-${suffix}`, name: 'Kho chính', type: 'main', description: 'Kho hàng hóa chính' },
                { code: `WH-DAMAGED-${suffix}`, name: 'Kho hàng hư hỏng', type: 'damaged', description: 'Kho chứa hàng bị hư hỏng, không bán được' },
                { code: `WH-WARRANTY-${suffix}`, name: 'Kho hàng bảo hành', type: 'warranty', description: 'Kho chứa hàng đang bảo hành / đã thu hồi để bảo hành' },
            ]
            for (const w of defaults) {
                await (newPrisma as any).warehouse.create({
                    data: { ...w, isDefault: true, isActive: true },
                }).catch(() => {})
            }
        } catch (e: any) {
            console.warn('[AddBranch] Default warehouse seeding failed:', e?.message)
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

// ─── POST /api/auth/switch-branch — Change the active branch for this session ─
// Issues a fresh JWT (+ refresh token) with the new branchId embedded. Branches
// of a store share one schema, so only branchId / isMainBranch change in the
// payload — branchSchema stays the same.
//
// Access rules (mirrors canAccessBranch semantics):
//   - admin / manager / superadmin may switch to any branch
//   - everyone else may only switch to their own assigned branch
//   - API key (X-API-Key hoặc JWT đổi từ khoá ở /auth/token) ⇒ 403: refresh token 90 ngày không mang scope khoá và
//     sống tiếp sau khi thu hồi khoá — xem lyDoChanDucPhien (20/10/2026)
router.post('/switch-branch', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        // Chặn TRƯỚC mọi truy vấn và trước createTokenPair (soát ở scripts/check-pham-vi-khoa.ts)
        const lyDoKhoa = lyDoChanDucPhien((req as any).viaApiKey, req.user, 'đổi chi nhánh phải đăng nhập kengi.vn bằng tài khoản')
        if (lyDoKhoa) {
            res.status(403).json({ success: false, error: lyDoKhoa })
            return
        }
        const storePrisma = req.storePrisma!
        const { branchId } = req.body || {}
        if (!branchId || typeof branchId !== 'string') {
            res.status(400).json({ success: false, error: 'branchId là bắt buộc' })
            return
        }

        // 1. Validate the target branch exists in this store
        const target = await storePrisma.branch.findUnique({
            where: { id: branchId },
            select: { id: true, name: true, code: true, isMainBranch: true, status: true },
        })
        if (!target || target.status !== 'active') {
            res.status(404).json({ success: false, error: 'Chi nhánh không tồn tại' })
            return
        }

        // 2. Determine which branches the user can access
        const role = req.user!.role
        const canAccessAll = role === 'admin' || role === 'manager' || role === 'superadmin'

        // Load the user's home branch assignment from the store schema
        const user = await storePrisma.user.findUnique({
            where: { id: req.user!.userId },
            select: { branchId: true, email: true },
        })
        if (!user) { res.status(404).json({ success: false, error: 'User not found' }); return }

        // 3. Build the accessible-branch list
        const branchSelect = { id: true, name: true, code: true, isMainBranch: true }
        let accessibleBranches: Array<{ id: string; name: string; code: string; isMainBranch: boolean }>
        if (canAccessAll) {
            accessibleBranches = await storePrisma.branch.findMany({
                where: { status: 'active' },
                select: branchSelect,
                orderBy: [{ isMainBranch: 'desc' }, { name: 'asc' }],
            })
        } else {
            accessibleBranches = user.branchId
                ? await storePrisma.branch.findMany({
                    where: { id: user.branchId, status: 'active' },
                    select: branchSelect,
                })
                : []
        }

        // 4. Enforce access to the requested branch
        const hasAccess = canAccessAll || accessibleBranches.some(b => b.id === branchId)
        if (!hasAccess) {
            res.status(403).json({ success: false, error: 'Bạn không có quyền truy cập chi nhánh này' })
            return
        }

        // 5. Issue a new token pair with the new branchId (same schema as login)
        const branchSchema = req.user!.branchSchema || req.user!.storeSchema!
        const tokenPayload = {
            userId: req.user!.userId, email: user.email, role,
            storeId: req.user!.storeId, storeCode: req.user!.storeCode,
            branchId: target.id, branchSchema,
            storeSchema: branchSchema, isMainBranch: target.isMainBranch,
        }
        const { accessToken, refreshToken } = await createTokenPair(tokenPayload, req.body?.deviceId)

        res.json({
            success: true,
            data: {
                token: accessToken,
                refreshToken,
                branch: { id: target.id, name: target.name, code: target.code, isMainBranch: target.isMainBranch },
                accessibleBranches,
                isCrossBranch: canAccessAll || accessibleBranches.length > 1,
            },
        })
    } catch (err: any) {
        console.error('Switch branch error:', err?.message || err)
        res.status(500).json({ success: false, error: 'Internal server error' })
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
        // Use JWT branchId (switched branch) over DB branchId (home branch)
        const effectiveBranchId = req.user?.branchId || user.branchId
        let branch = null
        if (effectiveBranchId) {
            branch = await storePrisma.branch.findUnique({
                where: { id: effectiveBranchId },
                select: { id: true, name: true, code: true, address: true, isMainBranch: true },
            })
        }

        // Build accessible branches + isCrossBranch for the frontend
        const role = req.user?.role || user.role
        const canAccessAll = role === 'admin' || role === 'manager' || role === 'superadmin'
        const allBranches = await storePrisma.branch.findMany({
            where: { status: { not: 'inactive' } },
            select: { id: true, name: true, code: true, isMainBranch: true },
            orderBy: [{ isMainBranch: 'desc' }, { name: 'asc' }],
        })

        const settings = await storePrisma.storeSettings.findUnique({ where: { id: 'default' } })

        // Cách 2FA đang dùng (09/11/2026): Cài đặt → Bảo mật hiện đúng "Google Authenticator" hay "mã qua email".
        // Chỉ trả TÊN cách — hạt TOTP không bao giờ ra ngoài.
        const hat2FA = user.twoFactorEnabled
            ? await storePrisma.user.findUnique({ where: { id: user.id }, select: { twoFactorEnabled: true, twoFactorSecret: true } })
            : null
        const twoFactorMethod = hat2FA ? cach2FA(hat2FA) : null

        res.json({
            success: true,
            data: {
                ...user,
                twoFactorMethod,
                permissions: JSON.parse((user as any).permissions || '[]'),
                storeId: req.user?.storeId,
                storeCode: req.user?.storeCode,
                branchSchema: req.user?.branchSchema,
                store: store ? { ...store, logo: settings?.logo, address: settings?.address || store.address, phone: settings?.phone || store.phone } : null,
                branch,
                currentBranch: branch,
                accessibleBranches: allBranches,
                isCrossBranch: canAccessAll || allBranches.length > 1,
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

// ─── POST /api/auth/verify-password ─────────────────────────────────────────
router.post('/verify-password', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const storePrisma = req.storePrisma!
        const { password } = req.body
        if (!password) { res.status(400).json({ success: false, error: 'Vui lòng nhập mật khẩu' }); return }

        const user = await storePrisma.user.findUnique({ where: { id: req.user!.userId } })
        if (!user) { res.status(404).json({ success: false, error: 'User not found' }); return }

        const valid = await bcrypt.compare(password, user.password)
        if (!valid) { res.status(401).json({ success: false, error: 'Mật khẩu không đúng' }); return }

        res.json({ success: true })
    } catch (err) {
        console.error('Verify password error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ─── PUT /api/auth/update-email — đổi email đăng nhập của CHÍNH MÌNH (cần mật khẩu) ─
/* Email là chìa khoá tài khoản ở ba chỗ: ô đăng nhập; "Quên mật khẩu" (send-otp / verify-otp tra người dùng theo email, OTP
 * gửi về email đó); đăng nhập Google (danh tính = email trong token Google, KHÔNG so mật khẩu). Cổng OTP 2FA ở /login cũng
 * gửi mã về user.email. Trước 09/11/2026 tuyến này ghi thẳng newEmail, không hỏi gì ⇒ ai cầm phiên đăng nhập, hay token đổi
 * từ khoá API write/admin, đổi email chủ tài khoản sang hộp thư / gmail của mình rồi đăng nhập Google hoặc Quên mật khẩu là
 * chiếm hẳn tài khoản, vượt cả 2FA, và sống tiếp sau khi thu hồi khoá. Nay:
 *   1. request đi bằng khoá API (X-API-Key hoặc JWT đổi từ khoá) ⇒ 403 TRƯỚC mọi truy vấn (lyDoChanDoiThongTinDangNhap);
 *   2. email mới phải đúng dạng (cùng luật với /signup);
 *   3. đòi mật khẩu hiện tại, câu lỗi y hệt DELETE /disable-2fa;
 *   4. không trùng email người khác trong cửa hàng — so KHÔNG phân biệt hoa thường (PUT /employees/:id ghi email nguyên chữ
 *      hoa) và chỉ sau khi mật khẩu đúng, để phiên không mật khẩu không dò được email nào đã có tài khoản.
 * Tài khoản đăng ký bằng Google mang mật khẩu tự sinh (/signup) ⇒ phải đặt mật khẩu qua "Quên mật khẩu" ở trang đăng nhập
 * trước (OTP về email hiện tại). Soát ở scripts/check-doi-email.ts. */
const EMAIL_HOP_LE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const LOI_EMAIL_TRUNG = 'Email này đã có tài khoản khác trong cửa hàng'
router.put('/update-email', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const lyDoKhoa = lyDoChanDoiThongTinDangNhap((req as any).viaApiKey, req.user, 'đổi email phải đăng nhập kengi.vn bằng tài khoản và nhập mật khẩu')
        if (lyDoKhoa) { res.status(403).json({ success: false, error: lyDoKhoa }); return }

        const storePrisma = req.storePrisma!
        const userId = req.user!.userId
        const { newEmail, password } = req.body || {}
        const email = typeof newEmail === 'string' ? newEmail.trim().toLowerCase() : ''
        if (!email) { res.status(400).json({ success: false, error: 'Email mới là bắt buộc' }); return }
        if (email.length > 254 || !EMAIL_HOP_LE.test(email)) { res.status(400).json({ success: false, error: 'Email không hợp lệ' }); return }
        if (!password || typeof password !== 'string') { res.status(400).json({ success: false, error: 'Mật khẩu là bắt buộc' }); return }

        const user = await storePrisma.user.findUnique({ where: { id: userId }, select: { email: true, password: true } })
        if (!user) { res.status(404).json({ success: false, error: 'User not found' }); return }

        const valid = await bcrypt.compare(password, user.password)
        if (!valid) { res.status(400).json({ success: false, error: 'Mật khẩu không đúng' }); return }

        // So NGUYÊN VĂN: email cũ lưu chữ hoa (từ PUT /employees/:id) thì /login — tra email đã hạ chữ thường — không thấy;
        // lưu lại bản chữ thường chính là chữa cho người ấy đăng nhập được bằng email.
        if (email === user.email) {
            res.json({ success: true, message: 'Email không đổi', data: { email } })
            return
        }
        const trung = await storePrisma.user.findFirst({
            where: { email: { equals: email, mode: 'insensitive' }, NOT: { id: userId } },
            select: { id: true },
        })
        if (trung) { res.status(409).json({ success: false, error: LOI_EMAIL_TRUNG }); return }

        await storePrisma.user.update({ where: { id: userId }, data: { email } })
        res.json({ success: true, message: 'Cập nhật email thành công', data: { email } })
    } catch (err: any) {
        if (err?.code === 'P2002') { res.status(409).json({ success: false, error: LOI_EMAIL_TRUNG }); return }   // hai người cùng giành một email
        console.error('Update email error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

/** Bật 2FA qua email là việc của NGƯỜI đăng nhập — khoá API (X-API-Key hoặc JWT đổi từ khoá) không làm được. */
function lyDoChanBat2FAQuaKhoa(req: AuthRequest): string | null {
    if (!diBangKhoaApi((req as any).viaApiKey, req.user)) return null
    return 'Bật xác thực 2 lớp phải đăng nhập kengi.vn bằng tài khoản — khoá API không làm được việc này'
}

/** Lần chờ "bật 2FA qua email" mới nhất của người đang đăng nhập. */
async function timChoBatEmail(userId: string, storeId: string): Promise<Pending2FA | null> {
    const row = await registryPrisma.pending2FA.findFirst({
        where: { userId, storeId, method: 'bat_email' },
        orderBy: { createdAt: 'desc' },
    })
    return row ? dongThanhPending(row) : null
}

// ─── POST /api/auth/setup-2fa — bắt đầu bật 2FA ──────────────────────────────
// Body { method?: 'totp' | 'email' }. Mặc định 'totp' (hình dạng cũ): sinh hạt TOTP + otpauth URL + ảnh QR (qrDataUrl),
// cờ chưa bật. 'email' (09/11/2026, phương án B): gửi mã 6 số tới email của tài khoản — confirm-2fa { method: 'email',
// code } bật 2FA KHÔNG hạt ⇒ từ đó /login hỏi mã email. Bước này không ghi gì vào User; gọi lại sau 60 giây = gửi lại mã.
router.post('/setup-2fa', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const method = req.body?.method ?? 'totp'
        if (method !== 'totp' && method !== 'email') {
            res.status(400).json({ success: false, error: "method phải là 'totp' hoặc 'email'" })
            return
        }
        if (method === 'email') {
            const chanKhoa = lyDoChanBat2FAQuaKhoa(req)
            if (chanKhoa) { res.status(403).json({ success: false, error: chanKhoa }); return }
            const nguoi = req.user!
            const u = await req.storePrisma!.user.findUnique({ where: { id: nguoi.userId }, select: { email: true, twoFactorEnabled: true, isLocked: true } })
            if (!u) { res.status(404).json({ success: false, error: 'User not found' }); return }
            if (u.isLocked) { res.status(403).json({ success: false, error: 'Tài khoản đã bị khóa' }); return }
            if (u.twoFactorEnabled) { res.status(400).json({ success: false, error: '2FA đã được bật' }); return }
            if (!guiDuocMaEmail()) { res.status(503).json({ success: false, error: LOI_KHONG_GUI_DUOC_EMAIL }); return }
            if (!nguoi.storeId || !(nguoi.branchSchema || nguoi.storeSchema)) {
                res.status(400).json({ success: false, error: 'Phiên đăng nhập cũ thiếu thông tin cửa hàng — đăng xuất rồi đăng nhập lại' })
                return
            }

            const now = new Date()
            const cu = await timChoBatEmail(nguoi.userId, nguoi.storeId)
            if (cu?.sentAt && now.getTime() - cu.sentAt.getTime() < GIAN_CACH_GUI_LAI_MS) {
                const doi = Math.ceil((GIAN_CACH_GUI_LAI_MS - (now.getTime() - cu.sentAt.getTime())) / 1000)
                res.status(429).json({ success: false, error: `Vui lòng đợi ${doi}s trước khi gửi lại mã`, retryAfter: doi })
                return
            }
            await registryPrisma.pending2FA.deleteMany({ where: { userId: nguoi.userId, storeId: nguoi.storeId, method: 'bat_email' } })
            const token = crypto.randomBytes(32).toString('hex')
            const code = generateOtpCode()
            await savePending2FA(token, {
                userId: nguoi.userId, email: u.email, role: nguoi.role,
                storeId: nguoi.storeId, storeCode: nguoi.storeCode || '',
                branchId: nguoi.branchId ?? null, branchSchema: (nguoi.branchSchema || nguoi.storeSchema)!,
                isMainBranch: !!nguoi.isMainBranch,
                user: null, store: null, branch: null,
                method: 'bat_email', codeHash: bamMaEmail(token, code), sentAt: now,
            }, new Date(now.getTime() + MA_EMAIL_TTL_MS))
            const { subject, html, text } = buildOtpEmail(code, 'bat2fa')
            try {
                await sendEmail(u.email, subject, html, text)
            } catch (e: any) {
                console.error('Gửi mã bật 2FA qua email lỗi:', e?.message || e)
                await deletePending2FA(token)
                res.status(500).json({ success: false, error: 'Không thể gửi email. Vui lòng thử lại.' })
                return
            }
            res.json({
                success: true,
                data: { method: 'email', email: u.email, expiresInMinutes: OTP_CONFIG.OTP_TTL_MIN, resendAfterSeconds: OTP_CONFIG.RESEND_COOLDOWN_SEC },
            })
            return
        }

        const otplib = await import('otplib')
        const storePrisma = req.storePrisma!
        const user = await storePrisma.user.findUnique({ where: { id: req.user!.userId }, select: { email: true, twoFactorEnabled: true } })
        if (!user) { res.status(404).json({ success: false, error: 'User not found' }); return }
        if (user.twoFactorEnabled) { res.status(400).json({ success: false, error: '2FA đã được bật' }); return }

        const secret = otplib.generateSecret()
        // Build otpauth URI manually (standard format for Google Authenticator)
        const otpauthUrl = `otpauth://totp/Kengi%20Tech:${encodeURIComponent(user.email)}?secret=${secret}&issuer=Kengi%20Tech&algorithm=SHA1&digits=6&period=30`

        /* Ảnh QR vẽ NGAY TẠI MÁY CHỦ, trả về dạng data: URL (09/11/2026). Web cũ lấy ảnh từ một dịch vụ vẽ QR
         * công khai với đường dẫn `…/create-qr-code/?data=<otpauthUrl>` ⇒ mỗi lần thiết lập / đặt lại 2FA, hạt TOTP
         * MỚI đi sang bên thứ ba. Ảnh này chỉ đi máy chủ → trình duyệt trong chính phản hồi. Vẽ TRƯỚC khi ghi
         * hạt: vẽ hỏng thì 500 mà DB không đổi. Cùng thông số với QR đăng nhập trang admin (xacMinh2BuocAdmin). */
        const QRCode = (await import('qrcode')).default
        const qrDataUrl = await QRCode.toDataURL(otpauthUrl, { margin: 1, width: 260, errorCorrectionLevel: 'M' })

        // Store secret temporarily (not enabled yet until confirmed)
        await storePrisma.user.update({ where: { id: req.user!.userId }, data: { twoFactorSecret: secret } })

        // otpauthUrl + secret giữ lại cho người nhập tay / ứng dụng gọi API
        res.json({ success: true, data: { otpauthUrl, secret, qrDataUrl } })
    } catch (err: any) {
        console.error('Setup 2FA error:', err)
        res.status(500).json({ success: false, error: 'Lỗi thiết lập 2FA', detail: errorDetail(err) })
    }
})

// ─── POST /api/auth/confirm-2fa — nhập mã xác nhận ⇒ bật 2FA ─────────────────
// Body { totpCode } (mặc định — mã app theo hạt setup-2fa vừa sinh) hoặc { method: 'email', code } (mã setup-2fa
// method 'email' vừa gửi; nhận cả `totpCode` thay `code`).
router.post('/confirm-2fa', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const storePrisma = req.storePrisma!
        const laEmail = req.body?.method === 'email'
        const ma = laEmail ? (req.body?.code ?? req.body?.totpCode) : req.body?.totpCode
        if (!ma) { res.status(400).json({ success: false, error: 'Mã xác thực là bắt buộc' }); return }

        const user = await storePrisma.user.findUnique({ where: { id: req.user!.userId }, select: { twoFactorSecret: true, twoFactorEnabled: true } })
        if (!user) { res.status(404).json({ success: false, error: 'User not found' }); return }

        if (laEmail) {
            const chanKhoa = lyDoChanBat2FAQuaKhoa(req)
            if (chanKhoa) { res.status(403).json({ success: false, error: chanKhoa }); return }
            if (user.twoFactorEnabled) { res.status(400).json({ success: false, error: '2FA đã được bật' }); return }
            const HET = 'Mã xác nhận đã hết hạn hoặc chưa được gửi — bấm "Gửi mã" để nhận mã mới'
            const cho = req.user!.storeId ? await timChoBatEmail(req.user!.userId, req.user!.storeId) : null
            if (!cho) { res.status(400).json({ success: false, error: HET }); return }
            if (cho.expiresAt < new Date()) { await deletePending2FA(cho.loginToken); res.status(400).json({ success: false, error: HET }); return }
            const QUA_LUOT = 'Sai mã quá nhiều lần — bấm "Gửi mã" để nhận mã mới'
            if (!(await tinhMotLanThu(cho.loginToken))) { res.status(400).json({ success: false, error: QUA_LUOT }); return }
            if (!maEmailKhop(cho, ma)) {
                const conLai = SO_LAN_THU_TOI_DA - (cho.attempts + 1)
                if (conLai <= 0) { await deletePending2FA(cho.loginToken); res.status(400).json({ success: false, error: QUA_LUOT }); return }
                res.status(400).json({ success: false, error: `Mã xác nhận không đúng (còn ${conLai} lần thử)` })
                return
            }
            if (!(await tieuThuPending2FA(cho.loginToken))) { res.status(400).json({ success: false, error: HET }); return }
        } else {
            if (!user.twoFactorSecret) { res.status(400).json({ success: false, error: 'Chưa thiết lập 2FA, vui lòng gọi setup-2fa trước' }); return }
            if (!(await maTotpKhop(user.twoFactorSecret, ma))) { res.status(400).json({ success: false, error: 'Mã xác thực không đúng' }); return }
        }

        /* Chỗ BẬT cờ DUY NHẤT của cả hệ thống (scripts/check-tat-2fa.ts canh). TOTP: giữ hạt vừa xác nhận. Email: xoá hạt
         * dở dang (người từng bấm "Thiết Lập 2FA" bằng app rồi bỏ ngang) — giữ lại thì cach2FA ra 'totp' và /login sẽ
         * hỏi mã app theo một hạt chưa ai xác nhận. */
        await storePrisma.user.update({
            where: { id: req.user!.userId },
            data: { twoFactorEnabled: true, ...(laEmail ? { twoFactorSecret: null } : {}) },
        })
        res.json({ success: true, message: 'Bật 2FA thành công', data: { twoFactorMethod: laEmail ? 'email' : 'totp' } })
    } catch (err: any) {
        console.error('Confirm 2FA error:', err)
        res.status(500).json({ success: false, error: 'Internal server error', detail: errorDetail(err) })
    }
})

/* ─── Tắt 2FA — MỘT đường cho cả DELETE /disable-2fa lẫn PUT /toggle-2fa (09/11/2026) ───
 * Đòi mật khẩu, rồi xoá CẢ hạt TOTP lẫn thiết bị tin cậy chứ không chỉ hạ cờ: hạt cũ có thể đã lộ
 * (GET /api/employees từng trả twoFactorSecret + trustedDevices trước b0e24cf), còn trustedDevices[].id
 * gửi kèm POST /auth/login là bỏ qua bước TOTP ⇒ chỉ lật cờ thì bật lại vẫn dùng được hạt + thiết bị cũ.
 * Trả null khi đã tắt; ngược lại trả mã HTTP + câu lỗi (giữ nguyên câu cũ của disable-2fa).
 * Tài khoản đăng ký bằng Google mang mật khẩu tự sinh ⇒ phải đặt mật khẩu qua Quên mật khẩu trước. */
async function tat2FA(
    storePrisma: NonNullable<AuthRequest['storePrisma']>,
    userId: string,
    password: unknown,
): Promise<{ ma: number; loi: string } | null> {
    if (!password || typeof password !== 'string') return { ma: 400, loi: 'Mật khẩu là bắt buộc' }

    const user = await storePrisma.user.findUnique({ where: { id: userId }, select: { password: true } })
    if (!user) return { ma: 404, loi: 'User not found' }

    const valid = await bcrypt.compare(password, user.password)
    if (!valid) return { ma: 400, loi: 'Mật khẩu không đúng' }

    await storePrisma.user.update({
        where: { id: userId },
        data: { twoFactorEnabled: false, twoFactorSecret: null, trustedDevices: '[]' },
    })
    return null
}

// ─── DELETE /api/auth/disable-2fa — Disable 2FA (requires password) ──────────
router.delete('/disable-2fa', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const chan = await tat2FA(req.storePrisma!, req.user!.userId, req.body?.password)
        if (chan) { res.status(chan.ma).json({ success: false, error: chan.loi }); return }
        res.json({ success: true, message: 'Đã tắt 2FA' })
    } catch (err: any) {
        console.error('Disable 2FA error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ─── GET /api/auth/trusted-devices — List trusted devices ────────────────────
// Chỉ thiết bị còn hạn, KHÔNG kèm tokenHash (lib/trustedDevice › thietBiCongKhai). Trước 09/11/2026 tuyến này trả
// nguyên `id` — mà `id` chính là chuỗi gửi kèm /login để bỏ qua bước TOTP.
router.get('/trusted-devices', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const storePrisma = req.storePrisma!
        const user = await storePrisma.user.findUnique({ where: { id: req.user!.userId }, select: { trustedDevices: true } })
        if (!user) { res.status(404).json({ success: false, error: 'User not found' }); return }
        const devices = thietBiCongKhai(user.trustedDevices)
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

        const conLai = boThietBi(user.trustedDevices, String(req.params.id))
        await storePrisma.user.update({ where: { id: req.user!.userId }, data: { trustedDevices: conLai } })
        const devices = thietBiCongKhai(conLai)
        res.json({ success: true, data: devices })
    } catch (err: any) {
        console.error('Remove trusted device error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ─── PUT /api/auth/toggle-2fa — chỉ còn TẮT, và tắt y hệt disable-2fa ────────
/* Trước 09/11/2026 tuyến này chỉ lật cờ twoFactorEnabled (công tắc "Xác thực 2 lớp (2FA)" trên web):
 *   (1) tắt rồi bật lại vẫn giữ NGUYÊN hạt TOTP cũ — có thể đã lộ qua GET /api/employees trước b0e24cf —
 *       cùng thiết bị tin cậy;
 *   (2) ai cầm phiên đăng nhập (hay khoá API write/admin) cũng tắt được 2FA, không cần mật khẩu;
 *   (3) bật khi chưa có hạt ⇒ cờ bật mà cổng TOTP ở /login bỏ qua (cổng đó đòi twoFactorSecret), trong khi
 *       giao diện báo "được bảo vệ bởi Google Authenticator".
 * Nay TẮT đi qua tat2FA như DELETE /disable-2fa. BẬT luôn bị từ chối: chỉ setup-2fa (sinh hạt MỚI) +
 * confirm-2fa (mã TOTP khớp hạt đó) mới bật được. Không cột nào cho biết hạt đang nằm trong DB đã được
 * xác nhận hay chưa — setup-2fa ghi hạt TRƯỚC khi xác nhận, công tắc cũ để lại hạt cũ khi tắt — nên
 * đường này không bật lại bất kỳ hạt nào.
 * Body `{ enabled?: boolean, password?: string }`: có `enabled` thì là trạng thái MUỐN (trùng trạng thái
 * hiện tại ⇒ không đổi gì); không có thì lật như cũ — web bản cũ còn trong trình duyệt gọi không body. */
router.put('/toggle-2fa', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const storePrisma = req.storePrisma!
        const userId = req.user!.userId
        const user = await storePrisma.user.findUnique({ where: { id: userId }, select: { twoFactorEnabled: true } })
        if (!user) { res.status(404).json({ success: false, error: 'User not found' }); return }

        const dangBat = !!user.twoFactorEnabled
        const muonBat = typeof req.body?.enabled === 'boolean' ? req.body.enabled : !dangBat
        if (muonBat === dangBat) { res.json({ success: true, data: { twoFactorEnabled: dangBat } }); return }

        if (muonBat) {
            res.status(400).json({
                success: false,
                code: 'BAT_2FA_QUA_THIET_LAP',
                error: 'Bật 2FA phải quét mã QR rồi nhập mã xác nhận: Cài đặt → Bảo mật → Thiết Lập 2FA '
                    + '(API: POST /api/auth/setup-2fa rồi POST /api/auth/confirm-2fa)',
            })
            return
        }

        const chan = await tat2FA(storePrisma, userId, req.body?.password)
        if (chan) { res.status(chan.ma).json({ success: false, error: chan.loi }); return }
        res.json({ success: true, message: 'Đã tắt 2FA', data: { twoFactorEnabled: false } })
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

        const stored = await loadRefreshToken(refreshToken)
        if (!stored) {
            return res.status(401).json({ success: false, error: 'Invalid refresh token' })
        }

        // Check expiry
        if (stored.expiresAt < new Date()) {
            await deleteRefreshToken(refreshToken)
            return res.status(401).json({ success: false, error: 'Refresh token expired' })
        }

        // Verify the store is still active (suspension revokes refresh)
        const store = await registryPrisma.store.findUnique({
            where: { id: stored.storeId },
            select: { status: true },
        })
        if (!store || store.status !== 'active') {
            await deleteRefreshToken(refreshToken)
            return res.status(403).json({ success: false, error: 'Cửa hàng đã bị tạm dừng' })
        }

        // Re-read current role / permissions / isLocked from the store schema
        // so role changes and account locks take effect on next refresh.
        const storePrisma = getStorePrisma(stored.branchSchema)
        const currentUser = await storePrisma.user.findUnique({
            where: { id: stored.userId },
            select: { id: true, email: true, role: true, isLocked: true, permissions: true },
        }).catch(() => null)
        if (!currentUser) {
            await deleteRefreshToken(refreshToken)
            return res.status(401).json({ success: false, error: 'User no longer exists' })
        }
        if (currentUser.isLocked) {
            await deleteRefreshTokensForUser(currentUser.id)
            return res.status(403).json({ success: false, error: 'Tài khoản đã bị khóa' })
        }

        // If role changed in DB, update the cached + persisted record so future
        // refreshes stay consistent with the latest store state.
        if (currentUser.role !== stored.role) {
            stored.role = currentUser.role
            refreshTokenCache.set(refreshToken, stored)
            await registryPrisma.refreshToken.updateMany({
                where: { token: refreshToken },
                data: { role: currentUser.role },
            }).catch(() => {})
        }

        const { userId, email, storeId, storeCode, branchId, branchSchema, isMainBranch } = stored
        const newAccessToken = jwt.sign(
            {
                userId, email,
                role: currentUser.role,
                storeId, storeCode, branchId,
                branchSchema, storeSchema: branchSchema,
                isMainBranch,
                permissions: JSON.parse((currentUser as any).permissions || '[]'),
            },
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
    if (refreshToken) await deleteRefreshToken(refreshToken)
    res.json({ success: true })
})

/** GỬI LẠI mã email của MỘT lần đăng nhập đã qua mật khẩu (send-otp purpose login_2fa). Mỗi lần gửi: mã mới (mã cũ
 *  hết hiệu lực), 5 lượt thử mới, hạn thêm 10 phút — nhưng không quá 30 phút kể từ lúc qua mật khẩu. */
async function guiLaiMaDangNhap(loginToken: unknown, res: Response): Promise<void> {
    if (typeof loginToken !== 'string' || !loginToken) {
        res.status(400).json({ success: false, error: 'Thiếu loginToken — vui lòng đăng nhập lại để nhận mã mới' })
        return
    }
    const HET = 'Lần đăng nhập đã hết hạn — vui lòng đăng nhập lại để nhận mã mới'
    const pending = await loadPending2FA(loginToken)
    if (!pending || pending.method !== 'email') { res.status(400).json({ success: false, error: HET }); return }
    const now = new Date()
    const hanCuoi = pending.createdAt.getTime() + PHIEN_EMAIL_TOI_DA_MS
    if (pending.expiresAt <= now || hanCuoi <= now.getTime()) {
        await deletePending2FA(pending.loginToken)
        res.status(400).json({ success: false, error: HET })
        return
    }
    if (!guiDuocMaEmail()) { res.status(503).json({ success: false, error: LOI_KHONG_GUI_DUOC_EMAIL }); return }
    const user = await getStorePrisma(pending.branchSchema).user.findUnique({
        where: { id: pending.userId },
        select: { isLocked: true, twoFactorEnabled: true, twoFactorSecret: true },
    })
    const chan = chanLucXacMinh(user, 'email')
    if (chan) {
        await deletePending2FA(pending.loginToken)
        res.status(chan.ma).json({ success: false, error: chan.loi })
        return
    }

    // Giãn cách 60 giây NGUYÊN TỬ trên CSDL: chỉ request đổi được dòng mới được gửi (đúng với mọi bản Cloud Run)
    const code = generateOtpCode()
    const r = await registryPrisma.pending2FA.updateMany({
        where: {
            loginToken: pending.loginToken, method: 'email',
            OR: [{ sentAt: null }, { sentAt: { lte: new Date(now.getTime() - GIAN_CACH_GUI_LAI_MS) } }],
        },
        data: {
            codeHash: bamMaEmail(pending.loginToken, code), sentAt: now, attempts: 0,
            expiresAt: new Date(Math.min(now.getTime() + MA_EMAIL_TTL_MS, hanCuoi)),
        },
    })
    if (r.count !== 1) {
        const doi = pending.sentAt
            ? Math.max(1, Math.ceil((pending.sentAt.getTime() + GIAN_CACH_GUI_LAI_MS - now.getTime()) / 1000))
            : OTP_CONFIG.RESEND_COOLDOWN_SEC
        res.status(429).json({ success: false, error: `Vui lòng đợi ${doi}s trước khi gửi lại mã`, retryAfter: doi })
        return
    }
    const { subject, html, text } = buildOtpEmail(code, 'login')
    try {
        await sendEmail(pending.email, subject, html, text)
    } catch (e: any) {
        console.error('Gửi lại mã đăng nhập lỗi:', e?.message || e)
        // mã vừa sinh chưa tới tay ai ⇒ trả dòng về như trước: mã trong thư trước vẫn dùng được (giữ nguyên số lần
        // đã thử + hạn của nó), và mở lại giãn cách để người dùng bấm gửi lại ngay
        await registryPrisma.pending2FA.updateMany({
            where: { loginToken: pending.loginToken },
            data: { codeHash: pending.codeHash, attempts: pending.attempts, expiresAt: pending.expiresAt, sentAt: pending.sentAt },
        }).catch(() => {})
        res.status(500).json({ success: false, error: 'Không thể gửi email. Vui lòng thử lại.' })
        return
    }
    res.json({ success: true, data: { sent: true, expiresInMinutes: OTP_CONFIG.OTP_TTL_MIN, resendAfterSeconds: OTP_CONFIG.RESEND_COOLDOWN_SEC } })
}

/** Nhập mã email để hoàn tất đăng nhập (verify-otp purpose login_2fa). Lần chờ tìm theo loginToken; client cũ không gửi
 *  loginToken (web bản cũ, Android ≤ 1.0.46) thì lấy lần chờ mã email MỚI NHẤT của (cửa hàng, email) — dòng ấy chỉ có
 *  khi ai đó vừa qua MẬT KHẨU ở /login. Người có hạt TOTP không bao giờ có dòng 'email' ⇒ mã email không vượt được TOTP.
 *  Không qua ⇒ tự trả lỗi và trả null; qua ⇒ lần chờ đã tiêu, handler đúc phiên. */
async function xacMinhMaDangNhap(req: Request, res: Response): Promise<DaQua2FA | null> {
    const { email, storeCode, code, loginToken } = req.body || {}
    const THIEU = 'Thiếu thông tin xác minh'
    if (!code) { res.status(400).json({ success: false, error: THIEU }); return null }
    let pending: Pending2FA | null
    if (typeof loginToken === 'string' && loginToken) pending = await loadPending2FA(loginToken)
    else if (typeof email === 'string' && email.trim() && typeof storeCode === 'string' && storeCode.trim()) pending = await timChoEmailMoiNhat(storeCode, email)
    else { res.status(400).json({ success: false, error: THIEU }); return null }

    const KHONG_CO = 'Mã không tồn tại hoặc đã hết hạn'
    if (!pending) { res.status(400).json({ success: false, error: KHONG_CO }); return null }
    if (pending.method !== 'email') {
        res.status(400).json({ success: false, error: 'Lần đăng nhập này cần mã từ ứng dụng xác thực (Google Authenticator), không phải mã email' })
        return null
    }
    if (pending.expiresAt < new Date()) {
        await deletePending2FA(pending.loginToken)
        res.status(400).json({ success: false, error: 'Mã đã hết hạn' })
        return null
    }
    const QUA_LUOT = 'Quá nhiều lần thử. Vui lòng đăng nhập lại.'
    if (!(await tinhMotLanThu(pending.loginToken))) { res.status(400).json({ success: false, error: QUA_LUOT }); return null }

    const branchPrisma = getStorePrisma(pending.branchSchema)
    const user = await branchPrisma.user.findUnique({
        where: { id: pending.userId },
        select: { isLocked: true, twoFactorEnabled: true, twoFactorSecret: true, trustedDevices: true },
    })
    const chan = chanLucXacMinh(user, 'email')
    if (chan) {
        await deletePending2FA(pending.loginToken)
        res.status(chan.ma).json({ success: false, error: chan.loi })
        return null
    }
    if (!maEmailKhop(pending, code)) {
        const conLai = SO_LAN_THU_TOI_DA - (pending.attempts + 1)
        if (conLai <= 0) {
            await deletePending2FA(pending.loginToken)
            res.status(400).json({ success: false, error: QUA_LUOT })
            return null
        }
        res.status(400).json({ success: false, error: `Mã không đúng (còn ${conLai} lần thử)` })
        return null
    }

    const qua = await tieuThuLanCho(req, pending, branchPrisma, user!.trustedDevices)
    if (!qua) { res.status(400).json({ success: false, error: KHONG_CO }); return null }
    return qua
}

// ─── POST /api/auth/send-otp ─────────────────────────────────────────────────
// Body: { purpose: 'login_2fa', loginToken } | { purpose: 'password_reset', email, storeCode }
//   - login_2fa: GỬI LẠI mã email của một lần đăng nhập đã qua mật khẩu — loginToken do POST /login trả về (09/11/2026).
//                Trước đó chỉ cần email + mã cửa hàng: ai biết email người bật 2FA là xin được mã, rồi verify-otp cấp
//                phiên KHÔNG cần mật khẩu. Không client nào gọi đường cũ (web chưa có nút gửi lại, Android không có tuyến).
//   - password_reset: anyone may request. We always respond success to avoid
//                     leaking which emails exist.
router.post('/send-otp', async (req: Request, res: Response) => {
    try {
        const { email, storeCode, purpose } = req.body || {}
        if (purpose === 'login_2fa') { await guiLaiMaDangNhap(req.body?.loginToken, res); return }
        if (!email?.trim() || !storeCode?.trim()) {
            return res.status(400).json({ success: false, error: 'Email và mã cửa hàng là bắt buộc' })
        }
        if (purpose !== 'password_reset') {
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
        // password_reset: silent success to prevent enumeration
        if (!store || store.status !== 'active') return res.json({ success: true, data: { sent: true } })

        const storePrisma = getStorePrisma(store.schema)
        const user = await storePrisma.user.findFirst({ where: { email: email.trim().toLowerCase() } })
        // Silent success if user not found
        if (!user) return res.json({ success: true, data: { sent: true } })

        const code = generateOtpCode()
        saveOtp(purpose, store.code, email, code)
        const { subject, html, text } = buildOtpEmail(code, 'reset')
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
// Body: { purpose: 'login_2fa', code, loginToken? (hoặc email + storeCode — client cũ), rememberDevice?, deviceName? }
//     | { purpose: 'password_reset', email, storeCode, code }
//   - login_2fa: hoàn tất đăng nhập bằng mã email (xacMinhMaDangNhap) — trả cặp token + user/store/branch như /login;
//                rememberDevice: true ⇒ kèm deviceToken. Chi nhánh lấy theo lần đăng nhập, bỏ qua branchId trong body.
//   - password_reset: returns a short-lived reset token (10m JWT) to be passed
//                     to /reset-password. The OTP is consumed here.
router.post('/verify-otp', async (req: Request, res: Response) => {
    try {
        const { email, storeCode, code, purpose } = req.body || {}
        if (purpose === 'login_2fa') {
            const qua = await xacMinhMaDangNhap(req, res)   // không qua thì đã tự trả lỗi
            if (!qua) return
            const phien = await createTokenPair(payloadPhien2FA(qua.pending), deviceIdPhien2FA(req, qua.pending))
            return res.json({ success: true, data: dataPhien2FA(qua, phien) })
        }
        if (!email?.trim() || !storeCode?.trim() || !code || !purpose) {
            return res.status(400).json({ success: false, error: 'Thiếu thông tin xác minh' })
        }
        if (purpose !== 'password_reset') {
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
            payload = jwt.verify(resetToken, JWT_SECRET!, { algorithms: ['HS256'] })
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
        await deleteRefreshTokensForUser(String(payload.userId))

        res.json({ success: true, message: 'Đặt lại mật khẩu thành công' })
    } catch (err: any) {
        console.error('reset-password error:', err?.message || err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ─── POST /token — OAuth2 Client Credentials → Access Token ─────────────────
// No auth required. Accepts { clientId, clientSecret, storeCode } and returns
// a JWT access token (1 hour) that can be used as a Bearer token for all API calls.
// Token mang scope của khoá (claim apiKeyScopes, 20/10/2026): khoá 'read' đổi token vẫn CHỈ đọc.
router.post('/token', async (req: Request, res: Response) => {
    try {
        const { clientId, clientSecret, storeCode } = req.body
        if (!clientId || !clientSecret || !storeCode) {
            res.status(400).json({
                success: false,
                error: 'clientId, clientSecret, and storeCode are required',
            })
            return
        }

        // Look up store in registry (same pattern as /login)
        const normalizedCode = storeCode.trim().toLowerCase()
        let store = await registryPrisma.store.findFirst({ where: { code: normalizedCode } })
        if (!store) {
            const stores: any[] = await registryPrisma.$queryRawUnsafe(
                `SELECT * FROM "Store" WHERE LOWER(code) = $1 LIMIT 1`, normalizedCode
            )
            if (stores.length > 0) store = stores[0]
        }
        // 401 THỐNG NHẤT cho mọi trường hợp sai (store/clientId/secret) — trả lỗi
        // khác nhau sẽ cho kẻ dò biết storeCode/clientId nào tồn tại.
        const invalidCreds = () => res.status(401).json({ success: false, error: 'Invalid credentials' })
        if (!store) {
            console.warn(`[Token] Unknown storeCode: ${normalizedCode}`)
            invalidCreds()
            return
        }
        // Store bị khóa/tạm ngưng thì API key cũng phải ngưng theo
        if ((store as any).status && (store as any).status !== 'active') {
            res.status(403).json({ success: false, error: 'Store is not active' })
            return
        }

        const schema = store.schema
        const storePrisma = getStorePrisma(schema)

        // Find main branch for JWT payload
        const mainBranch = await storePrisma.branch.findFirst({ where: { isMainBranch: true } })
        if (!mainBranch) {
            res.status(500).json({ success: false, error: 'Store has no main branch configured' })
            return
        }

        // Find API key by clientId (keyId)
        const apiKey = await storePrisma.apiKey.findFirst({
            where: { keyId: clientId, isActive: true },
            include: { user: true },
        })
        if (!apiKey) {
            console.warn(`[Token] Invalid clientId for store ${store.code}`)
            invalidCreds()
            return
        }
        if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
            invalidCreds()
            return
        }

        // Verify clientSecret against stored hash
        const valid = await bcrypt.compare(clientSecret, apiKey.secretHash)
        if (!valid) {
            console.warn(`[Token] Invalid clientSecret for store ${store.code}`)
            invalidCreds()
            return
        }

        // User chủ key bị khóa → key cũng vô hiệu
        if ((apiKey.user as any).isLocked) {
            invalidCreds()
            return
        }

        // Khoá scope 'chatbot' (20/10/2026) KHÔNG đổi lấy token: JWT dưới đây mang scope nhưng không phải chỗ nào nhận JWT
        // cũng soát phạm vi đường (websocket…) ⇒ đổi được là có cửa thoát /api/chatbot. Kiểm SAU khi khớp secret — người
        // không có secret không dò được scope.
        if (!khoaDoiDuocToken(apiKey.scopes)) {
            res.status(403).json({ success: false, error: 'Khoá API chatbot không đổi được token — gọi thẳng /api/chatbot với header X-API-Key + x-store-code' })
            return
        }

        // Scope khoá ĐI THEO token (20/10/2026). Thiếu claim này thì khoá 'read' đổi token là có JWT toàn quyền người tạo
        // khoá ⇒ ghi / sửa / xoá được hết. authMiddleware + livestream đọc claim, áp lại luật của nhánh X-API-Key
        // (lyDoChanJwtKhoa). Rỗng ⇒ 'read' như authMiddleware; `scope` trả về cùng giá trị (trước đây khoá rỗng báo 'admin').
        const scope = apiKey.scopes || 'read'

        // Generate JWT token (same shape as login tokens)
        const payload = {
            userId: apiKey.user.id,
            email: apiKey.user.email,
            role: apiKey.user.role,
            storeId: store.id,
            storeCode: store.code,
            branchId: mainBranch.id,
            branchSchema: schema,
            storeSchema: schema,
            isMainBranch: true,
            apiKeyScopes: scope,
        }

        const token = jwt.sign(payload, JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h' })

        // Update last used
        storePrisma.apiKey.update({
            where: { id: apiKey.id },
            data: { lastUsedAt: new Date() },
        }).catch(() => { })

        res.json({
            success: true,
            data: {
                access_token: token,
                token_type: 'Bearer',
                expires_in: 3600,
                scope,
            },
        })
    } catch (err: any) {
        console.error('Token exchange error:', err?.message || err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ─── Wire SSE auto-refresh so streaming endpoints can transparently renew ────
registerSseRefresh(async (rt: string): Promise<{ token: string; payload: AuthPayload } | null> => {
    try {
        const stored = await loadRefreshToken(rt)
        if (!stored || stored.expiresAt < new Date()) {
            if (stored) await deleteRefreshToken(rt)
            return null
        }
        const storePrisma = getStorePrisma(stored.branchSchema)
        const user = await storePrisma.user.findUnique({
            where: { id: stored.userId },
            select: { id: true, email: true, role: true, isLocked: true, permissions: true },
        }).catch(() => null)
        if (!user || (user as any).isLocked) return null

        const { userId, email, storeId, storeCode, branchId, branchSchema, isMainBranch } = stored
        const payload: AuthPayload = {
            userId, email, role: user.role,
            storeId, storeCode, branchId: branchId || undefined,
            branchSchema, storeSchema: branchSchema, isMainBranch,
        }
        const token = jwt.sign(
            { ...payload, permissions: JSON.parse((user as any).permissions || '[]') },
            JWT_SECRET, { expiresIn: ACCESS_TOKEN_TTL } as any,
        )
        return { token, payload }
    } catch { return null }
})

export default router
