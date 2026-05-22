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
            const store = await registryPrisma.store.findFirst({
                where: { code: { equals: headerStoreCode, mode: 'insensitive' } },
                include: { branches: { where: { isMain: true }, take: 1 } },
            })
            if (!store || !store.branches[0]) return false

            const mainBranch = store.branches[0]
            schema = `branch_${mainBranch.id}`
            storeId = store.id
            storeCode = store.code
        } catch {
            return false
        }
    }

    if (!schema) return false

    try {
        const storePrisma = getStorePrisma(schema)
        const keys = await storePrisma.apiKey.findMany({
            where: { isActive: true },
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
