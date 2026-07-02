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
export function sendNotification(storeId: string, event: string, data: object) {
    const storeClients = clients.get(storeId)
    if (!storeClients || storeClients.size === 0) return
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
    for (const client of storeClients) {
        try {
            client.res.write(payload)
        } catch {
            storeClients.delete(client)
        }
    }
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

        // Đến hạn lên trước (ưu tiên), rồi tới low-stock
        const notifications = [...duePaymentNotifs, ...lowStockNotifs]

        const _response = { success: true, data: notifications, count: notifications.length }
        await cacheSet(cacheKey, _response, 300)
        res.json(_response)
    } catch (err) {
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

export default router
