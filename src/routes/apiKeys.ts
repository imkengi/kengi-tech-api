import { Router, Response } from 'express'
import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import prisma from '../lib/prisma'
import { authMiddleware, AuthRequest } from '../middleware/auth'

const router = Router()

// ─── GET /api/api-keys — Get current key info (admin only) ──────────────────
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        if (req.user!.role !== 'admin' && req.user!.role !== 'manager') {
            res.status(403).json({ success: false, error: 'Chỉ admin/manager mới có quyền' })
            return
        }

        const key = await prisma.apiKey.findFirst({
            orderBy: { createdAt: 'desc' },
            select: {
                id: true,
                name: true,
                keyId: true,
                lastFour: true,
                scopes: true,
                isActive: true,
                lastUsedAt: true,
                createdAt: true,
                user: { select: { id: true, name: true, email: true } },
            },
        })

        res.json({ success: true, data: key })
    } catch (err) {
        console.error('Get API key error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ─── POST /api/api-keys/regenerate — Delete old + create new secret ─────────
router.post('/regenerate', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        if (req.user!.role !== 'admin' && req.user!.role !== 'manager') {
            res.status(403).json({ success: false, error: 'Chỉ admin/manager mới có quyền' })
            return
        }

        // Delete ALL existing keys
        await prisma.apiKey.deleteMany({})

        // Generate new key
        const keyId = 'ak_' + crypto.randomBytes(12).toString('hex')
        const secret = crypto.randomBytes(32).toString('hex')
        const lastFour = secret.slice(-4)
        const secretHash = await bcrypt.hash(secret, 10)

        const apiKey = await prisma.apiKey.create({
            data: {
                name: 'API Secret',
                keyId,
                secretHash,
                lastFour,
                scopes: 'admin',
                userId: req.user!.userId,
            },
            select: {
                id: true,
                name: true,
                keyId: true,
                lastFour: true,
                scopes: true,
                isActive: true,
                createdAt: true,
            },
        })

        // Return the secret ONCE
        res.json({
            success: true,
            data: {
                ...apiKey,
                secret, // ⚠️ Only returned once
            },
        })
    } catch (err) {
        console.error('Regenerate API key error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ─── POST /api/api-keys/test — Test a key (via X-API-Key header) ────────────
router.post('/test', async (req: AuthRequest, res: Response) => {
    try {
        const apiKeyHeader = req.headers['x-api-key'] as string

        if (!apiKeyHeader) {
            res.status(401).json({ success: false, error: 'Thiếu header X-API-Key' })
            return
        }

        const keys = await prisma.apiKey.findMany({
            where: { isActive: true },
            include: { user: { select: { id: true, name: true, email: true, role: true } } },
        })

        let matchedKey = null
        for (const key of keys) {
            if (key.expiresAt && key.expiresAt < new Date()) continue
            const valid = await bcrypt.compare(apiKeyHeader, key.secretHash)
            if (valid) {
                matchedKey = key
                break
            }
        }

        if (!matchedKey) {
            res.status(401).json({ success: false, error: 'API key không hợp lệ hoặc đã hết hạn' })
            return
        }

        await prisma.apiKey.update({
            where: { id: matchedKey.id },
            data: { lastUsedAt: new Date() },
        })

        res.json({
            success: true,
            data: {
                keyId: matchedKey.keyId,
                scopes: matchedKey.scopes,
                user: matchedKey.user.name,
                message: '✅ API key hoạt động tốt!',
            },
        })
    } catch (err) {
        console.error('Test API key error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

export default router
