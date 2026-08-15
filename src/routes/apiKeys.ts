import { Router, Response } from 'express'
import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import { authMiddleware, AuthRequest, getBranchId } from '../middleware/auth'
import { cacheGet, cacheSet, cacheDel } from '../lib/cache'

const router = Router()

// ─── GET /api/api-keys — Get current key info (admin only) ──────────────────
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const schema = req.user?.storeSchema || 'default'
        const cacheKey = `${schema}:apiKeys:${JSON.stringify(req.query)}`
        const cached = await cacheGet(cacheKey)
        if (cached) return res.json(cached)
        const prisma = req.storePrisma!
        if (req.user!.role !== 'admin' && req.user!.role !== 'manager') {
            res.status(403).json({ success: false, error: 'Chỉ admin/manager mới có quyền' })
            return
        }

        // Ưu tiên key "API Secret" của màn Cài đặt; key có tên (tab MCP) xem ở /list
        const key = await prisma.apiKey.findFirst({
            where: { name: 'API Secret' },
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

        const _response = { success: true, data: key }
        await cacheSet(cacheKey, _response, 300)
        res.json(_response)
    } catch (err) {
        console.error('Get API key error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ─── POST /api/api-keys/regenerate — Delete old + create new secret ─────────
router.post('/regenerate', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        if (req.user!.role !== 'admin' && req.user!.role !== 'manager') {
            res.status(403).json({ success: false, error: 'Chỉ admin/manager mới có quyền' })
            return
        }

        // Chỉ thay key "API Secret" cũ của màn Cài đặt — KHÔNG đụng key có tên
        // tạo ở tab "Nối AI ngoài (MCP)" (fanpage-manager). Trước 15/08/2026 chỗ
        // này deleteMany({}) → bấm "Tạo mới" ở dashboard là rụng sạch key của
        // mọi AI đang nối.
        await prisma.apiKey.deleteMany({ where: { name: 'API Secret' } })

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

        // Return the secret ONCE with clientId + clientSecret for token exchange
        res.json({
            success: true,
            data: {
                ...apiKey,
                secret,
                clientId: apiKey.keyId,      // alias for token exchange
                clientSecret: secret,        // alias for token exchange
            },
        })
    } catch (err) {
        console.error('Regenerate API key error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ═══════════════════════════════════════════════════════════════════════════════
//  NHIỀU KEY CÓ TÊN + SCOPE (2026-08-15) — cho từng AI/ứng dụng một key riêng,
//  thu hồi từng cái mà không làm rụng cái khác. /regenerate ở trên vẫn giữ để
//  màn cài đặt cũ không hỏng (nó XOÁ HẾT key — kể cả key tạo ở đây).
//  Secret dạng "<keyId>.<random>" để authMiddleware tra thẳng theo keyId.
// ═══════════════════════════════════════════════════════════════════════════════

const QUAN_LY = ['admin', 'manager', 'owner', 'superadmin']
const SCOPE_HOP_LE = ['read', 'read,write', 'admin']

// GET /api/api-keys/list — mọi key đang có (không lộ secret)
router.get('/list', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        if (!QUAN_LY.includes(req.user!.role)) { res.status(403).json({ success: false, error: 'Chỉ admin/manager mới có quyền' }); return }
        const keys = await req.storePrisma!.apiKey.findMany({
            orderBy: { createdAt: 'desc' },
            select: {
                id: true, name: true, keyId: true, lastFour: true, scopes: true, isActive: true,
                lastUsedAt: true, expiresAt: true, createdAt: true,
                user: { select: { id: true, name: true, email: true } },
            },
        })
        res.json({ success: true, data: keys })
    } catch (err) {
        console.error('List API keys error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// POST /api/api-keys  { name, scopes: 'read' | 'read,write' }  → trả secret MỘT LẦN
router.post('/', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        if (!QUAN_LY.includes(req.user!.role)) { res.status(403).json({ success: false, error: 'Chỉ admin/manager mới có quyền' }); return }
        const prisma = req.storePrisma!
        const name = String(req.body?.name || '').trim().slice(0, 80) || 'API key'
        const scopes = SCOPE_HOP_LE.includes(String(req.body?.scopes)) ? String(req.body.scopes) : 'read'
        const soKey = await prisma.apiKey.count({ where: { isActive: true } })
        if (soKey >= 20) { res.status(400).json({ success: false, error: 'Đã có 20 key đang hoạt động — thu hồi bớt trước khi tạo thêm' }); return }

        const keyId = 'ak_' + crypto.randomBytes(9).toString('hex')
        const secret = `${keyId}.${crypto.randomBytes(24).toString('hex')}`
        const rec = await prisma.apiKey.create({
            data: {
                name, keyId, scopes,
                secretHash: await bcrypt.hash(secret, 10),
                lastFour: secret.slice(-4),
                userId: req.user!.userId,
            },
            select: { id: true, name: true, keyId: true, lastFour: true, scopes: true, isActive: true, createdAt: true },
        })
        await cacheDel(`${req.user?.storeSchema || 'default'}:apiKeys:{}`).catch(() => { })
        res.json({ success: true, data: { ...rec, secret } })
    } catch (err) {
        console.error('Create API key error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// DELETE /api/api-keys/:id — thu hồi một key
router.delete('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        if (!QUAN_LY.includes(req.user!.role)) { res.status(403).json({ success: false, error: 'Chỉ admin/manager mới có quyền' }); return }
        const prisma = req.storePrisma!
        const id = String(req.params.id)
        const key = await prisma.apiKey.findUnique({ where: { id } })
        if (!key) { res.status(404).json({ success: false, error: 'Không tìm thấy key' }); return }
        await prisma.apiKey.delete({ where: { id } })
        await cacheDel(`${req.user?.storeSchema || 'default'}:apiKeys:{}`).catch(() => { })
        res.json({ success: true, data: { id, name: key.name } })
    } catch (err) {
        console.error('Delete API key error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ─── POST /api/api-keys/test — Test a key (via X-API-Key header) ────────────
// Cần authMiddleware: (a) storePrisma do middleware inject — thiếu là 500 ngay;
// (b) endpoint bcrypt-compare qua mọi key nên không được để public cho spam.
router.post('/test', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
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
