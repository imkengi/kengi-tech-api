import { Router, Response, Request } from 'express'
import { authMiddleware, sseAuthMiddleware, AuthRequest } from '../middleware/auth'
import { cacheGet, cacheSet, cacheDel } from '../lib/cache'

const router = Router()

interface ConnectedClient {
    res: Response
    storeId: string
}

// In-memory SSE clients per store
const clients = new Map<string, Set<ConnectedClient>>()

/**
 * Send an event to all SSE clients for a given store.
 * @param storeId  Store identifier string
 * @param event    SSE event name (e.g. 'low_stock', 'new_order')
 * @param data     Payload object
 */
export function sendNotification(storeId: string, event: string, data: object): number {
    const storeClients = clients.get(storeId)
    if (!storeClients || storeClients.size === 0) {
        // Log để soi: emit mà 0 client = lệch key hoặc SSE nối instance khác
        console.log(`[SSE] emit '${event}' key='${storeId}' → 0 client (keys đang mở: ${[...clients.keys()].join(',') || 'trống'})`)
        return 0
    }
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
    let sent = 0
    for (const client of storeClients) {
        try {
            client.res.write(payload)
            sent++
        } catch {
            storeClients.delete(client)
        }
    }
    console.log(`[SSE] emit '${event}' key='${storeId}' → ${sent} client`)
    return sent
}

/** Số client SSE đang mở theo key — cho probe chẩn đoán. */
export function sseStats(): Record<string, number> {
    const out: Record<string, number> = {}
    for (const [k, v] of clients.entries()) out[k] = v.size
    return out
}

// ─── FCM push (đẩy tức thì tới app Android kể cả khi app đóng) ───────────────
// Token truy cập lấy từ metadata server của Cloud Run (service account mặc định,
// scope cloud-platform) — không cần file key. Local dev không có metadata → bỏ qua.
const FCM_PROJECT = process.env.FCM_PROJECT_ID || 'kengi-tech'
let fcmToken: { token: string; exp: number } | null = null

async function getFcmAccessToken(): Promise<string | null> {
    if (fcmToken && Date.now() < fcmToken.exp - 60_000) return fcmToken.token
    try {
        const r = await fetch(
            'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
            { headers: { 'Metadata-Flavor': 'Google' } },
        )
        if (!r.ok) return null
        const d: any = await r.json()
        fcmToken = { token: d.access_token, exp: Date.now() + (d.expires_in || 3600) * 1000 }
        return fcmToken.token
    } catch { return null }
}

/** Bảng DeviceToken tự vá (per-store schema). */
export async function ensureDeviceTokenTable(prisma: any): Promise<void> {
    await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "DeviceToken" (
            "token" TEXT NOT NULL,
            "platform" TEXT NOT NULL DEFAULT 'android',
            "userId" TEXT,
            "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT "DeviceToken_pkey" PRIMARY KEY ("token")
        )`).catch(() => { })
}

/** Bắn push FCM tới mọi thiết bị đã đăng ký của store. Token chết (404/400
 * UNREGISTERED) bị xoá luôn. Mọi lỗi nuốt êm — push là phụ, không được làm
 * hỏng luồng chính. */
export async function sendPushToStore(prisma: any, title: string, body: string): Promise<number> {
    try {
        await ensureDeviceTokenTable(prisma)
        const rows: any[] = await prisma.$queryRawUnsafe(
            `SELECT token FROM "DeviceToken" ORDER BY "updatedAt" DESC LIMIT 100`)
        if (!rows.length) return 0
        const access = await getFcmAccessToken()
        if (!access) return 0
        let sent = 0
        for (const { token } of rows) {
            try {
                const r = await fetch(`https://fcm.googleapis.com/v1/projects/${FCM_PROJECT}/messages:send`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${access}` },
                    body: JSON.stringify({
                        message: {
                            token,
                            notification: { title, body },
                            android: { priority: 'HIGH', notification: { channel_id: 'kengi_alerts' } },
                        },
                    }),
                })
                if (r.ok) sent++
                else {
                    const t = await r.text()
                    if (r.status === 404 || t.includes('UNREGISTERED') || t.includes('INVALID_ARGUMENT')) {
                        await prisma.$executeRawUnsafe(`DELETE FROM "DeviceToken" WHERE token = $1`, token).catch(() => { })
                    }
                }
            } catch { /* từng token lỗi không chặn token khác */ }
        }
        if (sent > 0) console.log(`[FCM] push '${title}' → ${sent} thiết bị`)
        return sent
    } catch { return 0 }
}

// GET /api/notifications/stats
router.get('/stats', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const outOfStock = await prisma.product.count({ where: { stock: 0, productType: { not: 'service' } } })
        const lowStock = await prisma.product.count({ where: { stock: { gt: 0, lte: 5 }, productType: { not: 'service' } } })
        // Phiếu nhập đến hạn/quá hạn thanh toán (còn công nợ, dueDate <= hôm nay+3)
        let dueCount = 0
        try {
            const now = new Date()
            const lead = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 4) // < đầu ngày (hôm nay+4) = hết hôm nay+3
            dueCount = await prisma.importReceipt.count({
                where: {
                    dueDate: { not: null, lt: lead },
                    paymentStatus: { not: 'paid' },
                    status: { notIn: ['cancelled', 'draft', 'returned'] },
                },
            })
        } catch { /* cột chưa migrate ở store cũ — bỏ qua */ }
        res.json({ success: true, data: { total: outOfStock + lowStock + dueCount, critical: outOfStock, warning: lowStock + dueCount } })
    } catch { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// GET /api/notifications/stream — SSE connection
router.get('/stream', sseAuthMiddleware, (req: AuthRequest, res: Response) => {
    const storeId = (req as any).storeId || req.user?.storeSchema || 'default'

    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
    })

    const client: ConnectedClient = { res, storeId }

    if (!clients.has(storeId)) clients.set(storeId, new Set())
    clients.get(storeId)!.add(client)

    // Send initial ping
    res.write('event: connected\ndata: {"status":"ok"}\n\n')

    // Keep-alive heartbeat every 25s
    const heartbeat = setInterval(() => {
        try {
            res.write(': heartbeat\n\n')
        } catch {
            clearInterval(heartbeat)
        }
    }, 25000)

    req.on('close', () => {
        clearInterval(heartbeat)
        clients.get(storeId)?.delete(client)
    })
})

// GET /api/notifications — list recent in-app notifications (static for now)
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const schema = req.user?.storeSchema || 'default'
        const cacheKey = `${schema}:notifications:${JSON.stringify(req.query)}`
        const cached = await cacheGet(cacheKey)
        if (cached) return res.json(cached)
        const prisma = req.storePrisma!
        // Low stock products
        const lowStock = await prisma.product.findMany({
            where: { stock: { lte: 5 }, productType: { not: 'service' } },
            select: { id: true, name: true, stock: true, sku: true },
            orderBy: { stock: 'asc' },
            take: 20,
        })

        const lowStockNotifs = lowStock.map((p: any) => ({
            id: `low-${p.id}`,
            type: 'low_stock',
            title: 'Sắp hết hàng',
            message: `${p.name} còn ${p.stock} sản phẩm (SKU: ${p.sku})`,
            productId: p.id,
            severity: p.stock === 0 ? 'critical' : 'warning',
            createdAt: new Date().toISOString(),
        }))

        // Đến hạn / quá hạn thanh toán NCC: phiếu nhập còn công nợ, dueDate <= hôm nay+3 ngày.
        // Tính trực tiếp ở đây (không cần cron) — admin mở thông báo là thấy.
        let duePaymentNotifs: any[] = []
        try {
            const now = new Date()
            const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
            const lead = new Date(startToday.getTime() + 3 * 86400_000 + 86399_999) // hết ngày (hôm nay + 3)
            const duePayments = await prisma.importReceipt.findMany({
                where: {
                    dueDate: { not: null, lte: lead },
                    paymentStatus: { not: 'paid' },
                    status: { notIn: ['cancelled', 'draft', 'returned'] },
                },
                select: { id: true, code: true, supplierName: true, totalCost: true, paidAmount: true, dueDate: true, paymentTerm: true },
                orderBy: { dueDate: 'asc' },
                take: 30,
            })
            duePaymentNotifs = duePayments.map((r: any) => {
                const remaining = Math.max(0, (r.totalCost || 0) - (r.paidAmount || 0))
                const overdue = r.dueDate && new Date(r.dueDate) < startToday
                const dueStr = r.dueDate ? new Date(r.dueDate).toLocaleDateString('vi-VN') : ''
                return {
                    id: `due-${r.id}`,
                    type: 'payment_due',
                    title: overdue ? 'Quá hạn thanh toán NCC' : 'Sắp đến hạn thanh toán NCC',
                    message: `Phiếu ${r.code}${r.supplierName ? ' — ' + r.supplierName : ''}: còn nợ ${remaining.toLocaleString('vi-VN')}₫, hạn ${dueStr}${r.paymentTerm ? ' (' + r.paymentTerm + ')' : ''}`,
                    receiptId: r.id,
                    severity: overdue ? 'critical' : 'warning',
                    createdAt: new Date().toISOString(),
                }
            })
        } catch { /* cột dueDate có thể chưa migrate ở store cũ — bỏ qua, không chặn thông báo khác */ }

        // Thông báo BỀN từ bảng Notification (xuất hoá đơn, sự kiện hệ thống…)
        // — web lẫn app Android đọc chung danh sách này.
        let dbNotifs: any[] = []
        try {
            const rows = await (prisma as any).notification.findMany({
                orderBy: { createdAt: 'desc' }, take: 30,
            })
            dbNotifs = rows.map((n: any) => ({
                id: n.id,
                type: n.type || 'info',
                title: n.title,
                message: n.message,
                severity: n.type === 'error' ? 'critical' : 'info',
                read: n.read,
                createdAt: n.createdAt.toISOString(),
            }))
        } catch { /* bảng chưa có ở schema cũ — bỏ qua */ }

        // Bền (mới nhất) lên trước, rồi đến hạn thanh toán, rồi low-stock
        const notifications = [...dbNotifs, ...duePaymentNotifs, ...lowStockNotifs]

        const _response = { success: true, data: notifications, count: notifications.length }
        // 15s — FE poll 15s, cache dài hơn là toast/chuông trễ oan
        await cacheSet(cacheKey, _response, 15)
        res.json(_response)
    } catch (err) {
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// Các endpoint app Android đã gọi sẵn (trước đây backend thiếu → 404 câm).
// Chỉ tác động bản ghi bảng Notification; id dạng tính toán (low-*/due-*) thì
// trả ok để client tự xử lý local.
// POST /notifications/device-token — app Android đăng ký token FCM (upsert).
// Gửi {token: ''} kèm oldToken để gỡ khi logout (tuỳ chọn).
router.post('/device-token', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma! as any
        await ensureDeviceTokenTable(prisma)
        const token = String(req.body?.token || '').trim()
        if (!token || token.length < 20) { res.status(400).json({ success: false, error: 'token?' }); return }
        await prisma.$executeRawUnsafe(
            `INSERT INTO "DeviceToken"(token, platform, "userId", "updatedAt")
             VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
             ON CONFLICT (token) DO UPDATE SET "userId" = $3, "updatedAt" = CURRENT_TIMESTAMP`,
            token, String(req.body?.platform || 'android'), req.user?.userId || null)
        res.json({ success: true })
    } catch (err: any) {
        res.status(500).json({ success: false, error: err?.message })
    }
})

router.put('/read-all', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma! as any
        await prisma.notification.updateMany({ data: { read: true } }).catch(() => { })
        res.json({ success: true })
    } catch { res.status(500).json({ success: false }) }
})

router.put('/:id/toggle-read', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma! as any
        const id = String(req.params.id)
        const row = await prisma.notification.findUnique({ where: { id } }).catch(() => null)
        if (row) await prisma.notification.update({ where: { id }, data: { read: !row.read } }).catch(() => { })
        res.json({ success: true })
    } catch { res.status(500).json({ success: false }) }
})

router.delete('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma! as any
        await prisma.notification.delete({ where: { id: String(req.params.id) } }).catch(() => { })
        res.json({ success: true })
    } catch { res.status(500).json({ success: false }) }
})

export default router
