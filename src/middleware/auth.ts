import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import prisma from '../lib/prisma'

const JWT_SECRET = process.env.JWT_SECRET || 'open-retail-super-secret-key'

export interface AuthPayload {
    userId: string
    email: string
    role: string
}

export interface AuthRequest extends Request {
    user?: AuthPayload
}

// ─── Try to authenticate via X-API-Key header ───────────────────────────────
async function tryApiKeyAuth(req: AuthRequest): Promise<boolean> {
    const apiKey = req.headers['x-api-key'] as string | undefined
    if (!apiKey) return false

    try {
        const keys = await prisma.apiKey.findMany({
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
                }
                // Update lastUsedAt (fire-and-forget)
                prisma.apiKey.update({
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

    // 1. Try JWT Bearer token
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.split(' ')[1]
        try {
            const decoded = jwt.verify(token, JWT_SECRET) as AuthPayload
            req.user = decoded
            next()
            return
        } catch {
            // JWT invalid, try API key next
        }
    }

    // 2. Fallback: try X-API-Key
    const authenticated = await tryApiKeyAuth(req)
    if (authenticated) {
        next()
        return
    }

    res.status(401).json({ success: false, error: 'Access token required' })
}

// ─── API Key Only Middleware ─────────────────────────────────────────────────
export const apiKeyAuth = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    const authenticated = await tryApiKeyAuth(req)
    if (authenticated) {
        next()
        return
    }
    res.status(401).json({ success: false, error: 'Valid X-API-Key header required' })
}

// ─── Optional Auth (JWT or API key, but not required) ───────────────────────
export const optionalAuth = async (req: AuthRequest, _res: Response, next: NextFunction): Promise<void> => {
    const authHeader = req.headers.authorization

    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.split(' ')[1]
        try {
            const decoded = jwt.verify(token, JWT_SECRET) as AuthPayload
            req.user = decoded
        } catch {
            // Token invalid, but optional
        }
    }

    // If no JWT, try API key
    if (!req.user) {
        await tryApiKeyAuth(req)
    }

    next()
}

