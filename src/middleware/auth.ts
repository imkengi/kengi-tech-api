import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import { getStorePrisma, registryPrisma } from '../lib/prisma'
import { getStoreStatus } from '../lib/storeStatusCache'
import { PrismaClient as StorePrisma } from '../generated/store-client'

const JWT_SECRET = process.env.JWT_SECRET || ''
if (!JWT_SECRET) {
    console.error('⚠️ JWT_SECRET environment variable is not set — auth middleware will reject all requests')
}

export interface AuthPayload {
    userId: string
    email: string
    role: string
    storeId?: string
    storeCode?: string
    branchId?: string
    branchSchema?: string   // branch_<branchId> — the PostgreSQL schema for this session
    storeSchema?: string    // legacy alias (same value as branchSchema)
    isMainBranch?: boolean
}

export interface AuthRequest extends Request {
    user?: AuthPayload
    storePrisma?: StorePrisma
}

// ─── Resolve schema from JWT payload ─────────────────────────────────────────
// Supports both new (branchSchema) and legacy (storeSchema) JWT formats
function resolveSchema(payload: AuthPayload): string | undefined {
    return payload.branchSchema || payload.storeSchema
}

// ─── Try to authenticate via X-API-Key header ─────────────────────────────────
// Supports two modes:
//   1. JWT + X-API-Key: schema resolved from JWT payload (original flow)
//   2. Standalone X-API-Key + X-Store-Code: schema resolved from registry DB
async function tryApiKeyAuth(req: AuthRequest): Promise<boolean> {
    const apiKey = req.headers['x-api-key'] as string | undefined
    if (!apiKey) return false

    // Resolve schema: prefer JWT payload, fall back to X-Store-Code header
    let schema = req.user ? resolveSchema(req.user) : undefined
    let storeId = req.user?.storeId
    let storeCode = req.user?.storeCode

    if (!schema) {
        // Standalone mode: resolve schema from X-Store-Code header via registry DB
        const headerStoreCode = req.headers['x-store-code'] as string | undefined
        if (!headerStoreCode) return false

        try {
            const normalizedCode = headerStoreCode.trim().toLowerCase()
            let store = await registryPrisma.store.findFirst({ where: { code: normalizedCode } })
            if (!store) {
                const stores: any[] = await registryPrisma.$queryRawUnsafe(
                    `SELECT * FROM "Store" WHERE LOWER(code) = $1 LIMIT 1`, normalizedCode
                )
                if (stores.length > 0) store = stores[0]
            }
            if (!store) return false

            schema = store.schema
            storeId = store.id
            storeCode = store.code
        } catch {
            return false
        }
    }

    if (!schema) return false

    try {
        const storePrisma = getStorePrisma(schema)
        // Key kiểu mới (2026-08-15) có dạng "<keyId>.<secret>" → tra thẳng theo keyId,
        // chỉ bcrypt-compare MỘT bản ghi thay vì quét hết (mỗi compare ~50-100ms;
        // store có nhiều key cho nhiều AI thì quét hết là chậm dần). Key cũ không
        // có dấu chấm vẫn đi đường quét như trước.
        const dot = apiKey.indexOf('.')
        const keyIdHint = dot > 0 ? apiKey.slice(0, dot) : null
        const keys = await storePrisma.apiKey.findMany({
            where: keyIdHint ? { isActive: true, keyId: keyIdHint } : { isActive: true },
            include: { user: true },
        })

        for (const key of keys) {
            if (key.expiresAt && key.expiresAt < new Date()) continue
            const valid = await bcrypt.compare(apiKey, key.secretHash)
            if (valid) {
                req.user = {
                    userId: key.user.id,
                    email: key.user.email,
                    role: key.user.role,
                    storeId,
                    storeCode,
                    branchId: key.user.branchId || undefined,
                    branchSchema: schema,
                    storeSchema: schema,  // alias
                }
                req.storePrisma = storePrisma
                ;(req as any).viaApiKey = true
                ;(req as any).apiKeyScopes = key.scopes || 'read'
                storePrisma.apiKey.update({
                    where: { id: key.id },
                    data: { lastUsedAt: new Date() },
                }).catch(() => { })
                return true
            }
        }
    } catch {
        // API key lookup failed, fall through
    }
    return false
}

// ─── Main Auth Middleware (JWT first, then X-API-Key fallback) ───────────────
export const authMiddleware = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    const authHeader = req.headers.authorization

    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.split(' ')[1]
        try {
            const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }) as AuthPayload
            req.user = decoded

            const schema = resolveSchema(decoded)
            if (schema) {
                // Attach branch-specific Prisma client
                req.storePrisma = getStorePrisma(schema)

                // Check store suspension (skip for superadmin) — cached to avoid
                // hitting the registry on every authenticated request.
                if (decoded.storeId && decoded.role !== 'superadmin') {
                    const status = await getStoreStatus(decoded.storeId)
                    if (status === 'suspended') {
                        res.status(403).json({
                            success: false,
                            error: 'Cửa hàng đã bị tạm dừng. Vui lòng liên hệ quản trị viên hệ thống.',
                            code: 'STORE_SUSPENDED',
                        })
                        return
                    }
                }
            }

            next()
            return
        } catch {
            // JWT invalid, try API key
        }
    }

    // Fallback: X-API-Key
    const authenticated = await tryApiKeyAuth(req)
    if (authenticated) {
        // Thực thi scope của API key: key chỉ-đọc (scope không chứa admin/write/*)
        // KHÔNG được thực hiện thao tác ghi (POST/PUT/PATCH/DELETE).
        const scopes = String((req as any).apiKeyScopes || 'read')
        const writeAllowed = /admin|write|\*/i.test(scopes)
        const isWrite = !['GET', 'HEAD', 'OPTIONS'].includes(req.method)
        if (isWrite && !writeAllowed) {
            res.status(403).json({ success: false, error: 'API key chỉ có quyền đọc — không thể ghi/sửa/xóa (scope=read)' })
            return
        }
        next()
        return
    }

    res.status(401).json({ success: false, error: 'Access token required' })
}

// ─── Optional Auth ─────────────────────────────────────────────────────────────
export const optionalAuth = async (req: AuthRequest, _res: Response, next: NextFunction): Promise<void> => {
    const authHeader = req.headers.authorization

    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.split(' ')[1]
        try {
            const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }) as AuthPayload
            req.user = decoded
            const schema = resolveSchema(decoded)
            if (schema) req.storePrisma = getStorePrisma(schema)
        } catch {
            // Token invalid — optional, continue
        }
    }

    if (!req.user) await tryApiKeyAuth(req)
    next()
}

// ─── API Key Only Middleware ──────────────────────────────────────────────────
export const apiKeyAuth = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    const authenticated = await tryApiKeyAuth(req)
    if (authenticated) { next(); return }
    res.status(401).json({ success: false, error: 'Valid X-API-Key header required' })
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function getStoreId(req: AuthRequest): string {
    const storeId = req.user?.storeId
    if (!storeId) throw new Error('Store context required')
    return storeId
}

export function getBranchId(req: AuthRequest): string | undefined {
    return req.user?.branchId || undefined
}

// Branch filter: main branch sees all data, sub-branches see only their own
// In the new per-branch schema model this is less needed (each branch has its own schema),
// but kept for backward compat with shared schema scenarios
export function getBranchFilter(req: AuthRequest): Record<string, any> {
    if (req.user?.isMainBranch) return {}
    return req.user?.branchId ? { branchId: req.user.branchId } : {}
}

// Ownership check for single-record (`/:id`) reads on branch-scoped models.
// Mirrors getBranchFilter semantics so that `findUnique` lookups can't be used
// to read another branch's record by guessing its id:
//   - admin / manager / superadmin see every branch
//   - main-branch users see every branch
//   - users with no branch context behave like the list filter (see everything)
//   - everyone else may only access records belonging to their own branch
// Returns true when access is allowed.
export function canAccessBranch(req: AuthRequest, recordBranchId: string | null | undefined): boolean {
    const role = req.user?.role
    if (role === 'admin' || role === 'manager' || role === 'superadmin') return true
    if (req.user?.isMainBranch) return true
    const userBranchId = req.user?.branchId
    if (!userBranchId) return true
    return recordBranchId === userBranchId
}

// ─── SSE Auth: auto-refresh for long-lived streaming connections ────────────
// SSE (EventSource) cannot set custom headers and tokens expire while streams
// are alive. This middleware transparently refreshes expired access tokens when
// a valid refresh token is supplied via query param (?rt=<refreshToken>).

type SseRefreshFn = (rt: string) => Promise<{ token: string; payload: AuthPayload } | null>
let _sseRefreshFn: SseRefreshFn | null = null

/** Called by auth routes at startup to wire in the internal refresh logic. */
export function registerSseRefresh(fn: SseRefreshFn): void { _sseRefreshFn = fn }

/**
 * SSE-specific auth middleware:
 * 1. Extracts token from ?token= query param (EventSource can't set headers)
 * 2. On expired JWT + ?rt= present, auto-refreshes transparently
 * 3. Sets X-New-Token response header so clients can update their stored token
 */
export const sseAuthMiddleware = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    // EventSource can't set headers — accept token from query param
    if (req.query.token && !req.headers.authorization) {
        req.headers.authorization = `Bearer ${req.query.token}`
    }

    const authHeader = req.headers.authorization

    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.split(' ')[1]
        try {
            const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }) as AuthPayload
            req.user = decoded

            const schema = resolveSchema(decoded)
            if (schema) {
                req.storePrisma = getStorePrisma(schema)

                if (decoded.storeId && decoded.role !== 'superadmin') {
                    const status = await getStoreStatus(decoded.storeId)
                    if (status === 'suspended') {
                        res.status(403).json({ success: false, error: 'Store suspended', code: 'STORE_SUSPENDED' })
                        return
                    }
                }
            }

            next()
            return
        } catch (err: any) {
            // If token expired and we have a refresh token, try auto-refresh
            if (err.name === 'TokenExpiredError' && req.query.rt && _sseRefreshFn) {
                try {
                    const result = await _sseRefreshFn(String(req.query.rt))
                    if (result) {
                        req.user = result.payload
                        const schema = resolveSchema(result.payload)
                        if (schema) req.storePrisma = getStorePrisma(schema)
                        // Tell client about the new token via response header
                        res.setHeader('X-New-Token', result.token)
                        next()
                        return
                    }
                } catch { /* fall through to 401 */ }
            }
            // JWT invalid and no refresh — try API key
        }
    }

    // Fallback: X-API-Key
    const authenticated = await tryApiKeyAuth(req)
    if (authenticated) { next(); return }

    res.status(401).json({ success: false, error: 'Access token required' })
}
