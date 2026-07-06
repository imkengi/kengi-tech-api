// ═══════════════════════════════════════════════════════════════════════════════
// Quản lý Webhook đầu ra — /api/webhook-endpoints
// Cho phép cửa hàng đăng ký URL nhận sự kiện hàng hóa/tồn kho, xem log giao, test.
// Chỉ admin/manager. Secret trả về ĐẦY ĐỦ 1 lần lúc tạo/regenerate; sau đó ẩn.
// ═══════════════════════════════════════════════════════════════════════════════

import { Router, Response } from 'express'
import crypto from 'crypto'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import {
    WEBHOOK_EVENTS,
    WEBHOOK_EVENT_TYPES,
    markSchemaHasWebhooks,
    drainStoreBySchema,
} from '../lib/webhookDispatch'

const router = Router()

function isAdminOrManager(req: AuthRequest): boolean {
    const r = req.user?.role
    return r === 'admin' || r === 'manager' || r === 'owner' || r === 'superadmin'
}

// Ẩn secret khi trả list (chỉ hiện 4 ký tự cuối).
function maskSecret(s: string): string {
    if (!s) return ''
    return '••••••••' + s.slice(-4)
}

function sanitizeEvents(events: any): string[] {
    if (!Array.isArray(events)) return []
    return events.filter((e) => WEBHOOK_EVENT_TYPES.includes(e))
}

function isValidHttpUrl(u: string): boolean {
    try {
        const parsed = new URL(u)
        return parsed.protocol === 'https:' || parsed.protocol === 'http:'
    } catch {
        return false
    }
}

// ─── GET /events/catalog — danh mục sự kiện (cho UI checkbox) ─────────────────
router.get('/events/catalog', authMiddleware, async (_req: AuthRequest, res: Response) => {
    res.json({ success: true, data: WEBHOOK_EVENTS })
})

// ─── GET / — danh sách endpoint ──────────────────────────────────────────────
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        if (!isAdminOrManager(req)) {
            return res.status(403).json({ success: false, error: 'Chỉ admin/manager mới có quyền' })
        }
        const prisma = req.storePrisma!
        const list = await prisma.webhookEndpoint.findMany({ orderBy: { createdAt: 'desc' } })
        res.json({
            success: true,
            data: list.map((e: any) => ({
                ...e,
                secret: maskSecret(e.secret),
                events: (() => { try { return JSON.parse(e.events || '[]') } catch { return [] } })(),
            })),
        })
    } catch (err) {
        console.error('List webhook endpoints error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ─── POST / — tạo endpoint (trả secret 1 lần) ────────────────────────────────
router.post('/', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        if (!isAdminOrManager(req)) {
            return res.status(403).json({ success: false, error: 'Chỉ admin/manager mới có quyền' })
        }
        const prisma = req.storePrisma!
        const { url, events, description } = req.body
        if (!url || !isValidHttpUrl(url)) {
            return res.status(400).json({ success: false, error: 'URL không hợp lệ (cần http/https)' })
        }
        const evs = sanitizeEvents(events)
        if (!evs.length) {
            return res.status(400).json({ success: false, error: 'Chọn ít nhất 1 loại sự kiện' })
        }

        const secret = 'whsec_' + crypto.randomBytes(24).toString('hex')
        const created = await prisma.webhookEndpoint.create({
            data: { url, secret, events: JSON.stringify(evs), description: description || null },
        })
        // Bật fast-path ngay cho instance này (các instance khác converge trong 30s).
        if (req.user?.storeSchema) markSchemaHasWebhooks(req.user.storeSchema)

        res.status(201).json({
            success: true,
            data: { ...created, events: evs }, // secret trả ĐẦY ĐỦ 1 lần
            message: 'Đã tạo webhook. Lưu secret này ngay — sẽ không hiện lại đầy đủ.',
        })
    } catch (err) {
        console.error('Create webhook endpoint error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ─── PUT /:id — cập nhật ─────────────────────────────────────────────────────
router.put('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        if (!isAdminOrManager(req)) {
            return res.status(403).json({ success: false, error: 'Chỉ admin/manager mới có quyền' })
        }
        const prisma = req.storePrisma!
        const id = String(req.params.id)
        const existing = await prisma.webhookEndpoint.findFirst({ where: { id } })
        if (!existing) return res.status(404).json({ success: false, error: 'Không tìm thấy webhook' })

        const { url, events, description, isActive } = req.body
        const data: any = {}
        if (url !== undefined) {
            if (!isValidHttpUrl(url)) return res.status(400).json({ success: false, error: 'URL không hợp lệ' })
            data.url = url
        }
        if (events !== undefined) {
            const evs = sanitizeEvents(events)
            if (!evs.length) return res.status(400).json({ success: false, error: 'Chọn ít nhất 1 loại sự kiện' })
            data.events = JSON.stringify(evs)
        }
        if (description !== undefined) data.description = description || null
        if (isActive !== undefined) {
            data.isActive = !!isActive
            if (isActive) data.failureCount = 0 // bật lại → reset đếm lỗi
        }

        const updated = await prisma.webhookEndpoint.update({ where: { id }, data })
        if (updated.isActive && req.user?.storeSchema) markSchemaHasWebhooks(req.user.storeSchema)

        res.json({
            success: true,
            data: { ...updated, secret: maskSecret(updated.secret), events: (() => { try { return JSON.parse(updated.events || '[]') } catch { return [] } })() },
        })
    } catch (err) {
        console.error('Update webhook endpoint error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ─── POST /:id/regenerate-secret ─────────────────────────────────────────────
router.post('/:id/regenerate-secret', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        if (!isAdminOrManager(req)) {
            return res.status(403).json({ success: false, error: 'Chỉ admin/manager mới có quyền' })
        }
        const prisma = req.storePrisma!
        const id = String(req.params.id)
        const existing = await prisma.webhookEndpoint.findFirst({ where: { id } })
        if (!existing) return res.status(404).json({ success: false, error: 'Không tìm thấy webhook' })

        const secret = 'whsec_' + crypto.randomBytes(24).toString('hex')
        await prisma.webhookEndpoint.update({ where: { id }, data: { secret } })
        res.json({ success: true, data: { id, secret }, message: 'Đã tạo secret mới — lưu ngay.' })
    } catch (err) {
        console.error('Regenerate webhook secret error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ─── DELETE /:id ─────────────────────────────────────────────────────────────
router.delete('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        if (!isAdminOrManager(req)) {
            return res.status(403).json({ success: false, error: 'Chỉ admin/manager mới có quyền' })
        }
        const prisma = req.storePrisma!
        const id = String(req.params.id)
        const existing = await prisma.webhookEndpoint.findFirst({ where: { id } })
        if (!existing) return res.status(404).json({ success: false, error: 'Không tìm thấy webhook' })
        await prisma.webhookEndpoint.delete({ where: { id } }) // cascade xóa deliveries
        res.json({ success: true })
    } catch (err) {
        console.error('Delete webhook endpoint error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ─── GET /:id/deliveries — log giao gần đây ──────────────────────────────────
router.get('/:id/deliveries', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        if (!isAdminOrManager(req)) {
            return res.status(403).json({ success: false, error: 'Chỉ admin/manager mới có quyền' })
        }
        const prisma = req.storePrisma!
        const id = String(req.params.id)
        const list = await prisma.webhookDelivery.findMany({
            where: { endpointId: id },
            orderBy: { createdAt: 'desc' },
            take: 50,
        })
        res.json({ success: true, data: list })
    } catch (err) {
        console.error('List deliveries error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// ─── POST /:id/test — gửi 1 sự kiện ping ngay ────────────────────────────────
router.post('/:id/test', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        if (!isAdminOrManager(req)) {
            return res.status(403).json({ success: false, error: 'Chỉ admin/manager mới có quyền' })
        }
        const prisma = req.storePrisma!
        const id = String(req.params.id)
        const ep = await prisma.webhookEndpoint.findFirst({ where: { id } })
        if (!ep) return res.status(404).json({ success: false, error: 'Không tìm thấy webhook' })

        const payload = JSON.stringify({
            event: 'ping',
            data: { message: 'Đây là sự kiện test từ Kengi', endpointId: id },
            timestamp: new Date().toISOString(),
        })
        const delivery = await prisma.webhookDelivery.create({
            data: { endpointId: id, eventType: 'ping', payload, status: 'pending', nextRetryAt: new Date() },
        })
        // Gửi ngay thay vì đợi cron.
        if (req.user?.storeSchema) {
            markSchemaHasWebhooks(req.user.storeSchema)
            await drainStoreBySchema(req.user.storeSchema)
        }
        const result = await prisma.webhookDelivery.findUnique({ where: { id: delivery.id } })
        res.json({
            success: true,
            data: result,
            message: result?.status === 'success' ? '✅ Đã gửi test thành công' : `Trạng thái: ${result?.status} — ${result?.lastError || ''}`,
        })
    } catch (err) {
        console.error('Test webhook error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

export default router
