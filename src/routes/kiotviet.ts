/**
 * CỔNG ĐỒNG BỘ KIOTVIET ↔ KENGI (2026-08-05)
 *
 * Gắn tại /api/kiotviet. Hai vùng tách bạch:
 *
 *  A. WEBHOOK — CÔNG KHAI, đứng TRƯỚC middleware xác thực admin.
 *     POST /api/kiotviet/webhook/:storeCode/:token
 *     Bảo vệ bằng token 32 byte ngẫu nhiên nằm trong đường dẫn (+ chữ ký nếu
 *     đã cấu hình). KHÔNG đặt sau adminAuth — KiotViet không có admin key.
 *
 *  B. QUẢN TRỊ — sau adminAuth (x-admin-key hoặc JWT scope admin-panel), phục
 *     vụ trang kengi.vn/admin.
 *
 * Đợt đồng bộ chạy NỀN: endpoint tạo một dòng KiotVietSyncLog rồi trả ngay
 * logId, công việc chạy tiếp phía sau. Quét vài chục nghìn bản ghi vượt xa
 * timeout HTTP; bắt người dùng ngồi chờ một request treo là hỏng.
 */

import { Router, Request, Response, NextFunction } from 'express'
import crypto from 'crypto'
import jwt from 'jsonwebtoken'
import { registryPrisma, getStorePrisma } from '../lib/prisma'
import { errMsg } from '../lib/errorResponse'
import { KV, testConnection, clearTokenCache, type KiotVietCreds } from '../services/kiotviet'
import {
    newCounters, syncProducts, syncCustomers, syncSuppliers, syncInvoices,
    parseWebhookPayload, verifyWebhookSignature,
} from '../services/kiotvietSync'
import { buildOptions, runSync, STALE_MS, SYNC_ENTITIES } from '../services/kiotvietRunner'

const router = Router()

const ADMIN_KEY = process.env.ADMIN_KEY
const JWT_SECRET = process.env.JWT_SECRET || ''
const PANEL_SCOPE = 'admin-panel'

function safeEqual(a: string, b: string): boolean {
    const ab = Buffer.from(a), bb = Buffer.from(b)
    if (ab.length !== bb.length) return false
    return crypto.timingSafeEqual(ab, bb)
}

/** Tìm store theo mã, trả kèm prisma của schema riêng. */
async function resolveStore(storeCode: string): Promise<{ schema: string; name: string; sp: any } | null> {
    const store = await registryPrisma.store.findFirst({
        where: { code: { equals: String(storeCode).trim(), mode: 'insensitive' } },
        select: { schema: true, name: true },
    }).catch(() => null)
    if (!store) return null
    return { schema: store.schema, name: store.name, sp: getStorePrisma(store.schema) as any }
}

async function loadConfig(sp: any): Promise<any | null> {
    return sp.kiotVietConfig.findUnique({ where: { id: 'default' } }).catch(() => null)
}

function credsOf(cfg: any): KiotVietCreds {
    return {
        clientId: String(cfg.clientId || '').trim(),
        clientSecret: String(cfg.clientSecret || '').trim(),
        retailer: String(cfg.retailer || '').trim(),
    }
}

// ════════════════════════════════════════════════════════════════════════════
// A. WEBHOOK CÔNG KHAI — phải đứng trước router.use(adminAuth)
// ════════════════════════════════════════════════════════════════════════════

/**
 * KiotViet đẩy biến động về đây. Nguyên tắc:
 *  - Trả 200 NHANH rồi mới xử lý. Webhook chậm sẽ bị KiotViet thử lại, sinh
 *    xử lý trùng; và họ tính đó là endpoint hỏng.
 *  - Mọi lỗi xử lý đều nuốt + ghi log, KHÔNG trả 5xx (trả 5xx là bị gửi lại
 *    vòng lặp vô tận).
 */
router.post('/webhook/:storeCode/:token', async (req: Request, res: Response) => {
    const storeCode = String(req.params.storeCode || '')
    const token = String(req.params.token || '')
    try {
        const store = await resolveStore(storeCode)
        if (!store) { res.status(404).json({ success: false }); return }

        const cfg = await loadConfig(store.sp)
        if (!cfg?.webhookToken || !safeEqual(String(token), String(cfg.webhookToken))) {
            res.status(403).json({ success: false }); return
        }
        if (!cfg.enabled) { res.json({ success: true, skipped: 'cong dang tat' }); return }

        const rawBody = (req as any).rawBody?.toString('utf8') || JSON.stringify(req.body || {})
        const sig = String(req.headers['x-signature'] || '')
        const ts = String(req.headers['x-timestamp'] || '')
        let sigOk = true
        if (cfg.webhookSecret) {
            sigOk = verifyWebhookSignature(rawBody, sig, ts, String(cfg.retailer || ''), String(cfg.webhookSecret))
            if (!sigOk && cfg.strictSignature) {
                await logWebhook(store.sp, 'signature', 'failed', 0,
                    `Chữ ký sai (strict đang bật). x-signature=${sig.slice(0, 60)} x-timestamp=${ts}`)
                res.status(401).json({ success: false }); return
            }
        }

        // Chốt cửa xong thì trả 200 ngay, xử lý phía sau
        res.json({ success: true })

        const notis = parseWebhookPayload(req.body)
        if (!notis.length) {
            await logWebhook(store.sp, 'unknown', 'skipped', 0,
                `Payload không có Notifications. Khoá nhận được: ${Object.keys(req.body || {}).join(', ').slice(0, 200)}`)
            return
        }

        void handleWebhook(store.sp, cfg, notis, sigOk).catch(async (e: any) => {
            await logWebhook(store.sp, 'error', 'failed', 0, errMsg(e).slice(0, 300))
        })
    } catch (e: any) {
        // Đã trả 200 ở trên thì thôi; chưa trả thì trả 200 để KiotViet không dội lại
        if (!res.headersSent) res.json({ success: true })
        console.error('[KiotViet webhook]', storeCode, errMsg(e))
    }
})

async function logWebhook(sp: any, entity: string, status: string, count: number, note: string) {
    await sp.kiotVietSyncLog.create({
        data: {
            entity, mode: 'webhook', status,
            fetched: count, created: 0, updated: 0, skipped: 0, failed: status === 'failed' ? 1 : 0,
            errors: note ? note.slice(0, 2000) : null,
            startedAt: new Date(), finishedAt: new Date(),
        },
    }).catch(() => { })
}

/**
 * Xử lý các sự kiện webhook. KiotViet gửi bản ghi ĐÃ ĐẦY ĐỦ trong `Data` nên
 * phần lớn trường hợp không cần gọi ngược API — nhưng sự kiện tồn kho
 * (stock.update) chỉ có số lượng nên vẫn phải nạp lại sản phẩm cho đủ trường.
 */
async function handleWebhook(sp: any, cfg: any, notis: { action: string; data: any[] }[], sigOk: boolean): Promise<void> {
    const opts = await buildOptions(sp, cfg, true)
    const creds = credsOf(cfg)

    for (const n of notis) {
        const c = newCounters()
        const started = new Date()
        try {
            if (n.action.startsWith('product') || n.action.startsWith('stock')) {
                if (!cfg.syncProducts) continue
                let items = n.data
                // stock.update chỉ có {productId, productCode, onHand...} → nạp lại
                // bản ghi đầy đủ, nếu không sẽ ghi đè tên/giá bằng dữ liệu rỗng.
                if (n.action.startsWith('stock')) {
                    items = await reloadProducts(creds, n.data)
                }
                await syncProducts(sp, items, opts, c)
            } else if (n.action.startsWith('customer')) {
                if (!cfg.syncCustomers) continue
                await syncCustomers(sp, n.data, opts, c)
            } else if (n.action.startsWith('supplier')) {
                if (!cfg.syncSuppliers) continue
                await syncSuppliers(sp, n.data, opts, c)
            } else if (n.action.startsWith('invoice')) {
                if (!cfg.syncInvoices) continue
                await syncInvoices(sp, n.data, opts, c)
            } else {
                continue
            }

            await sp.kiotVietSyncLog.create({
                data: {
                    entity: n.action, mode: 'webhook',
                    status: c.failed ? 'partial' : 'success',
                    fetched: c.fetched, created: c.created, updated: c.updated,
                    skipped: c.skipped, failed: c.failed,
                    errors: [...(sigOk ? [] : ['⚠ chữ ký không khớp — đang chạy chế độ nới lỏng']), ...c.errors]
                        .join('\n').slice(0, 2000) || null,
                    startedAt: started, finishedAt: new Date(),
                },
            }).catch(() => { })
        } catch (e: any) {
            await logWebhook(sp, n.action, 'failed', 0, errMsg(e).slice(0, 300))
        }
    }
    await sp.kiotVietConfig.update({ where: { id: 'default' }, data: { lastWebhookAt: new Date() } }).catch(() => { })
}

/** Nạp lại bản ghi sản phẩm đầy đủ từ danh sách id/mã rút gọn của webhook tồn kho. */
async function reloadProducts(creds: KiotVietCreds, data: any[]): Promise<any[]> {
    const out: any[] = []
    for (const d of data.slice(0, 50)) {
        const id = d?.ProductId ?? d?.productId ?? d?.Id ?? d?.id
        if (!id) continue
        try {
            const full = await KV.raw(creds, `/products/${id}`, { includeInventory: true })
            if (full?.id) out.push(full)
        } catch { /* mất một mã không được giết cả lô */ }
    }
    return out
}

// ════════════════════════════════════════════════════════════════════════════
// B. VÙNG QUẢN TRỊ
// ════════════════════════════════════════════════════════════════════════════

function adminAuth(req: Request, res: Response, next: NextFunction): void {
    const key = req.headers['x-admin-key'] as string
    if (ADMIN_KEY && key && safeEqual(key, ADMIN_KEY)) return next()

    const auth = req.headers.authorization
    if (auth?.startsWith('Bearer ') && JWT_SECRET) {
        try {
            const payload = jwt.verify(auth.slice(7), JWT_SECRET, { algorithms: ['HS256'] }) as any
            if (payload?.scope === PANEL_SCOPE) return next()
        } catch { /* rơi xuống 403 */ }
    }
    if (!ADMIN_KEY && !JWT_SECRET) {
        res.status(503).json({ success: false, error: 'Admin API chưa cấu hình' }); return
    }
    res.status(403).json({ success: false, error: 'Unauthorized' })
}

router.use(adminAuth)

/** Ẩn bí mật trước khi trả về trình duyệt — chỉ cho biết ĐÃ đặt hay chưa. */
function publicConfig(cfg: any, storeCode: string, baseUrl: string) {
    if (!cfg) return null
    return {
        retailer: cfg.retailer,
        clientId: cfg.clientId ? `${String(cfg.clientId).slice(0, 6)}…` : '',
        daDatClientSecret: !!cfg.clientSecret,
        daDatWebhookSecret: !!cfg.webhookSecret,
        strictSignature: !!cfg.strictSignature,
        enabled: !!cfg.enabled,
        syncProducts: !!cfg.syncProducts,
        syncCustomers: !!cfg.syncCustomers,
        syncSuppliers: !!cfg.syncSuppliers,
        syncInvoices: !!cfg.syncInvoices,
        overwriteNames: !!cfg.overwriteNames,
        overwritePrices: !!cfg.overwritePrices,
        overwriteStock: !!cfg.overwriteStock,
        defaultCategoryId: cfg.defaultCategoryId,
        defaultWarehouseId: cfg.defaultWarehouseId,
        branchIds: cfg.branchIds,
        lastSyncAt: cfg.lastSyncAt,
        lastWebhookAt: cfg.lastWebhookAt,
        webhookUrl: cfg.webhookToken
            ? `${baseUrl}/api/kiotviet/webhook/${encodeURIComponent(storeCode)}/${cfg.webhookToken}`
            : null,
    }
}

function baseUrlOf(req: Request): string {
    return process.env.PUBLIC_API_BASE_URL
        || `${req.protocol}://${req.get('host')}`
}

// ─── GET /api/kiotviet/config?storeCode= ────────────────────────────────────
router.get('/config', async (req: Request, res: Response) => {
    try {
        const storeCode = String(req.query.storeCode || '').trim()
        const store = await resolveStore(storeCode)
        if (!store) { res.status(404).json({ success: false, error: 'Không tìm thấy cửa hàng' }); return }

        const cfg = await loadConfig(store.sp)
        // Kho + nhóm hàng để người dùng chọn đích đổ dữ liệu
        const [warehouses, categories] = await Promise.all([
            store.sp.warehouse.findMany({
                where: { isActive: true }, select: { id: true, code: true, name: true, type: true, isDefault: true },
                orderBy: { isDefault: 'desc' }, take: 50,
            }).catch(() => []),
            store.sp.category.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' }, take: 200 }).catch(() => []),
        ])

        res.json({
            success: true,
            data: {
                storeName: store.name,
                config: publicConfig(cfg, storeCode, baseUrlOf(req)),
                warehouses, categories,
            },
        })
    } catch (e: any) {
        res.status(500).json({ success: false, error: errMsg(e) })
    }
})

// ─── PUT /api/kiotviet/config ───────────────────────────────────────────────
// Body: {storeCode, clientId?, clientSecret?, retailer?, enabled?, sync*?,
//        overwrite*?, defaultWarehouseId?, defaultCategoryId?, branchIds?,
//        webhookSecret?, strictSignature?}
// Bí mật để TRỐNG = giữ nguyên giá trị cũ (trang admin không hiển thị lại bí mật).
router.put('/config', async (req: Request, res: Response) => {
    try {
        const b = req.body || {}
        const store = await resolveStore(String(b.storeCode || ''))
        if (!store) { res.status(404).json({ success: false, error: 'Không tìm thấy cửa hàng' }); return }

        const existing = await loadConfig(store.sp)
        const data: any = {}

        const setStr = (k: string, v: any) => { if (typeof v === 'string' && v.trim()) data[k] = v.trim() }
        setStr('clientId', b.clientId)
        setStr('clientSecret', b.clientSecret)
        setStr('retailer', b.retailer)
        setStr('webhookSecret', b.webhookSecret)

        for (const k of ['enabled', 'syncProducts', 'syncCustomers', 'syncSuppliers', 'syncInvoices',
            'overwriteNames', 'overwritePrices', 'overwriteStock', 'strictSignature']) {
            if (typeof b[k] === 'boolean') data[k] = b[k]
        }
        if (b.defaultWarehouseId !== undefined) data.defaultWarehouseId = b.defaultWarehouseId || null
        if (b.defaultCategoryId !== undefined) data.defaultCategoryId = b.defaultCategoryId || null
        if (Array.isArray(b.branchIds)) data.branchIds = JSON.stringify(b.branchIds.map(Number).filter(Number.isFinite))

        // Đổi secret thì token cũ trong bộ nhớ đệm phải bỏ, không thì vẫn ký bằng cái cũ
        if (data.clientSecret || data.clientId) clearTokenCache(existing?.clientId || data.clientId)

        let cfg
        if (existing) {
            cfg = await store.sp.kiotVietConfig.update({ where: { id: 'default' }, data })
        } else {
            if (!data.clientId || !data.clientSecret || !data.retailer) {
                res.status(400).json({ success: false, error: 'Lần đầu phải nhập đủ Client ID, Client Secret và Tên gian hàng (Retailer)' })
                return
            }
            cfg = await store.sp.kiotVietConfig.create({
                data: {
                    id: 'default',
                    ...data,
                    // Token webhook sinh MỘT LẦN, là lớp bảo vệ chính của cổng nhận
                    webhookToken: crypto.randomBytes(24).toString('hex'),
                },
            })
        }
        res.json({ success: true, data: publicConfig(cfg, String(b.storeCode), baseUrlOf(req)) })
    } catch (e: any) {
        res.status(500).json({ success: false, error: errMsg(e) })
    }
})

// ─── POST /api/kiotviet/rotate-webhook-token {storeCode} ────────────────────
router.post('/rotate-webhook-token', async (req: Request, res: Response) => {
    try {
        const storeCode = String(req.body?.storeCode || '')
        const store = await resolveStore(storeCode)
        if (!store) { res.status(404).json({ success: false, error: 'Không tìm thấy cửa hàng' }); return }
        const cfg = await store.sp.kiotVietConfig.update({
            where: { id: 'default' },
            data: { webhookToken: crypto.randomBytes(24).toString('hex') },
        })
        res.json({ success: true, data: publicConfig(cfg, storeCode, baseUrlOf(req)) })
    } catch (e: any) {
        res.status(500).json({ success: false, error: errMsg(e) })
    }
})

// ─── POST /api/kiotviet/test-connection {storeCode} ─────────────────────────
router.post('/test-connection', async (req: Request, res: Response) => {
    try {
        const store = await resolveStore(String(req.body?.storeCode || ''))
        if (!store) { res.status(404).json({ success: false, error: 'Không tìm thấy cửa hàng' }); return }
        const cfg = await loadConfig(store.sp)
        if (!cfg) { res.status(400).json({ success: false, error: 'Chưa cấu hình KiotViet cho cửa hàng này' }); return }

        const result = await testConnection(credsOf(cfg))
        res.json({ success: result.ok, data: result, error: result.ok ? undefined : result.error })
    } catch (e: any) {
        res.status(500).json({ success: false, error: errMsg(e) })
    }
})


// ─── POST /api/kiotviet/sync ────────────────────────────────────────────────
// Body: {storeCode, entities: ['products','customers','suppliers','invoices'],
//        fromDate: 'YYYY-MM-DD', toDate: 'YYYY-MM-DD', apply?: boolean}
//
// MẶC ĐỊNH CHẠY THỬ (apply=false): chỉ đếm và trả mẫu, không ghi gì.
router.post('/sync', async (req: Request, res: Response) => {
    try {
        const b = req.body || {}
        const storeCode = String(b.storeCode || '')
        const store = await resolveStore(storeCode)
        if (!store) { res.status(404).json({ success: false, error: 'Không tìm thấy cửa hàng' }); return }

        const cfg = await loadConfig(store.sp)
        if (!cfg) { res.status(400).json({ success: false, error: 'Chưa cấu hình KiotViet' }); return }

        // THỨ TỰ CÓ Ý NGHĨA: hoá đơn tra sản phẩm theo SKU, phiếu nhập tra nhà
        // cung cấp. Chạy sai thứ tự trong cùng một đợt là tra vào chỗ chưa có.
        // Sắp lại theo phụ thuộc thay vì tin thứ tự người dùng bấm nút.
        const entities: string[] = Array.isArray(b.entities)
            ? SYNC_ENTITIES.filter(a => b.entities.map(String).includes(a))
            : []
        if (!entities.length) {
            res.status(400).json({ success: false, error: 'Chọn ít nhất một loại dữ liệu để đồng bộ' }); return
        }

        const fromDate = b.fromDate ? new Date(`${b.fromDate}T00:00:00+07:00`) : null
        const toDate = b.toDate ? new Date(`${b.toDate}T23:59:59+07:00`) : null
        if (fromDate && isNaN(fromDate.getTime())) { res.status(400).json({ success: false, error: 'Ngày bắt đầu không hợp lệ' }); return }
        if (toDate && isNaN(toDate.getTime())) { res.status(400).json({ success: false, error: 'Ngày kết thúc không hợp lệ' }); return }
        if (fromDate && toDate && fromDate > toDate) { res.status(400).json({ success: false, error: 'Ngày bắt đầu phải trước ngày kết thúc' }); return }

        const apply = b.apply === true

        // Một đợt đang chạy thì không cho bấm chồng — hai đợt song song sẽ đua
        // nhau tạo cùng một bản ghi và đẻ trùng. Nhưng chỉ chặn khi đợt kia CÒN
        // SỐNG (nhịp tim < 2 phút): trước đây chặn theo giờ bắt đầu nên một đợt
        // chết giữa chừng khoá người dùng suốt 30 phút mà không nói vì sao.
        const running = await store.sp.kiotVietSyncLog.findFirst({
            where: { mode: 'manual', status: 'running' },
            orderBy: { startedAt: 'desc' },
            select: { id: true, heartbeatAt: true, startedAt: true },
        }).catch(() => null)
        if (running) {
            const lastBeat = running.heartbeatAt || running.startedAt
            const stale = Date.now() - new Date(lastBeat).getTime() > STALE_MS
            if (stale) {
                // Mất tín hiệu quá 2 phút = coi như chết, đóng lại để đi tiếp
                await store.sp.kiotVietSyncLog.update({
                    where: { id: running.id },
                    data: {
                        status: 'failed', finishedAt: new Date(),
                        errors: 'Đợt chạy mất tín hiệu quá 2 phút — máy chủ có thể đã khởi động lại giữa chừng. Đã tự đóng để chạy lại được.',
                    },
                }).catch(() => { })
            } else {
                res.status(409).json({ success: false, error: 'Đang có một đợt đồng bộ chạy dở (còn tín hiệu). Chờ xong rồi bấm lại.' })
                return
            }
        }

        const log = await store.sp.kiotVietSyncLog.create({
            data: {
                entity: entities.join(','), mode: 'manual', dryRun: !apply,
                fromDate, toDate, status: 'running', startedAt: new Date(),
            },
        })

        // Trả ngay, chạy nền — quét vài chục nghìn bản ghi vượt xa timeout HTTP
        res.json({
            success: true,
            data: {
                logId: log.id,
                cheDo: apply ? 'GHI THẬT' : 'CHẠY THỬ (không ghi gì)',
                entities, fromDate, toDate,
                message: 'Đợt đồng bộ đã bắt đầu. Theo dõi tiến độ ở bảng lịch sử bên dưới.',
            },
        })

        void runSync(store.sp, cfg, entities, fromDate, toDate, apply, log.id)
            .catch(async (e: any) => {
                await store.sp.kiotVietSyncLog.update({
                    where: { id: log.id },
                    data: { status: 'failed', errors: errMsg(e).slice(0, 2000), finishedAt: new Date() },
                }).catch(() => { })
            })
    } catch (e: any) {
        if (!res.headersSent) res.status(500).json({ success: false, error: errMsg(e) })
    }
})



// ─── GET /api/kiotviet/peek?storeCode=&path=/cashflow&n=5 ───────────────────
// CHỈ ĐỌC: trả về bản ghi THÔ từ KiotViet để đối chiếu khi số liệu trông sai.
// Tài liệu công khai của họ thiếu nhiều trường, nên phải nhìn dữ liệu thật mới
// biết trường nào mang ý nghĩa gì — đoán mò đã trả giá một lần với sổ quỹ.
router.get('/peek', async (req: Request, res: Response) => {
    try {
        const store = await resolveStore(String(req.query.storeCode || ''))
        if (!store) { res.status(404).json({ success: false, error: 'Không tìm thấy cửa hàng' }); return }
        const cfg = await loadConfig(store.sp)
        if (!cfg) { res.status(400).json({ success: false, error: 'Chưa cấu hình KiotViet' }); return }

        const path = String(req.query.path || '/cashflow')
        if (!/^\/[a-z0-9/_-]+$/i.test(path)) { res.status(400).json({ success: false, error: 'Đường dẫn không hợp lệ' }); return }
        const n = Math.min(20, Math.max(1, Number(req.query.n) || 5))

        const params: Record<string, any> = { pageSize: n, currentItem: 0 }
        for (const [k, v] of Object.entries(req.query)) {
            if (['storeCode', 'path', 'n'].includes(k)) continue
            params[k] = v
        }
        const raw = await KV.raw(credsOf(cfg), path, params)
        res.json({
            success: true,
            data: {
                total: raw?.total,
                soBanGhi: Array.isArray(raw?.data) ? raw.data.length : 0,
                // Tên trường của bản ghi đầu — nhìn phát biết ngay có gì
                cacTruong: Array.isArray(raw?.data) && raw.data[0] ? Object.keys(raw.data[0]) : [],
                banGhi: Array.isArray(raw?.data) ? raw.data.slice(0, n) : raw,
            },
        })
    } catch (e: any) {
        res.status(500).json({ success: false, error: errMsg(e) })
    }
})

// ─── GET /api/kiotviet/imported-summary?storeCode= ──────────────────────────
// CHỈ ĐỌC: soi dữ liệu ĐÃ đổ vào Kengi để biết đợt nhập có đúng không —
// bao nhiêu bản ghi, ngày chứng từ có bị dồn về ngày đồng bộ không, sản phẩm
// đã có thương hiệu chưa, có lọt phiếu huỷ nào không.
router.get('/imported-summary', async (req: Request, res: Response) => {
    try {
        const store = await resolveStore(String(req.query.storeCode || ''))
        if (!store) { res.status(404).json({ success: false, error: 'Không tìm thấy cửa hàng' }); return }
        const sp = store.sp

        const q = (sql: string) => sp.$queryRawUnsafe(sql).catch((e: any) => [{ loi: e?.message?.slice(0, 120) }])
        const [tx, po, ret, cash, exp, prod] = await Promise.all([
            q(`SELECT COUNT(*)::int AS tong,
                      COUNT(*) FILTER (WHERE "status" <> 'completed')::int AS khongHoanThanh,
                      COUNT(*) FILTER (WHERE DATE("createdAt") = DATE("transactionDate"))::int AS dungNgay,
                      MIN("createdAt")::text AS somNhat, MAX("createdAt")::text AS muonNhat
               FROM "Transaction" WHERE "createdByName" = 'KiotViet Sync'`),
            q(`SELECT COUNT(*)::int AS tong,
                      COUNT(*) FILTER (WHERE "status" <> 'received')::int AS khongHoanThanh,
                      COUNT(*) FILTER (WHERE DATE("createdAt") = DATE("receivedDate"))::int AS dungNgay,
                      MIN("createdAt")::text AS somNhat, MAX("createdAt")::text AS muonNhat
               FROM "PurchaseOrder" WHERE "notes" LIKE '%KiotViet%'`),
            q(`SELECT COUNT(*)::int AS tong, MIN("createdAt")::text AS somNhat, MAX("createdAt")::text AS muonNhat
               FROM "ReturnOrder" WHERE "reason" LIKE '%KiotViet%'`),
            q(`SELECT COUNT(*)::int AS tong,
                      COUNT(*) FILTER (WHERE DATE("createdAt") = DATE("date"))::int AS dungNgay,
                      MIN("createdAt")::text AS somNhat, MAX("createdAt")::text AS muonNhat
               FROM "CashReceipt" WHERE "description" LIKE '%KiotViet%' OR "reference" LIKE 'TT%'`),
            q(`SELECT COUNT(*)::int AS tong,
                      COUNT(*) FILTER (WHERE DATE("createdAt") = DATE("date"))::int AS dungNgay
               FROM "Expense" WHERE "sourceRef" LIKE 'KV|%'`),
            q(`SELECT COUNT(*)::int AS tong,
                      COUNT(*) FILTER (WHERE "brandId" IS NOT NULL)::int AS coThuongHieu
               FROM "Product" p
               WHERE EXISTS (SELECT 1 FROM "KiotVietMap" m WHERE m."entity"='product' AND m."localId"=p."id")`),
        ])

        res.json({
            success: true,
            data: {
                hoaDonBan: tx?.[0], phieuNhap: po?.[0], traHang: ret?.[0],
                phieuThu: cash?.[0], phieuChi: exp?.[0], hangHoa: prod?.[0],
                ghiChu: 'dungNgay = số bản ghi có ngày tạo TRÙNG ngày chứng từ. Lệch nhiều nghĩa là dữ liệu cũ bị dồn về ngày đồng bộ.',
            },
        })
    } catch (e: any) {
        res.status(500).json({ success: false, error: errMsg(e) })
    }
})

// ─── GET /api/kiotviet/logs?storeCode=&limit= ───────────────────────────────
router.get('/logs', async (req: Request, res: Response) => {
    try {
        const store = await resolveStore(String(req.query.storeCode || ''))
        if (!store) { res.status(404).json({ success: false, error: 'Không tìm thấy cửa hàng' }); return }
        const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20))
        const logs = await store.sp.kiotVietSyncLog.findMany({
            orderBy: { startedAt: 'desc' }, take: limit,
        }).catch(() => [])
        res.json({ success: true, data: logs })
    } catch (e: any) {
        res.status(500).json({ success: false, error: errMsg(e) })
    }
})

// ─── GET /api/kiotviet/logs/:id?storeCode= ──────────────────────────────────
router.get('/logs/:id', async (req: Request, res: Response) => {
    try {
        const store = await resolveStore(String(req.query.storeCode || ''))
        if (!store) { res.status(404).json({ success: false, error: 'Không tìm thấy cửa hàng' }); return }
        const log = await store.sp.kiotVietSyncLog.findUnique({ where: { id: String(req.params.id) } }).catch(() => null)
        if (!log) { res.status(404).json({ success: false, error: 'Không tìm thấy bản ghi' }); return }
        let details: any = null
        try { details = log.details ? JSON.parse(log.details) : null } catch { /* để nguyên null */ }
        res.json({ success: true, data: { ...log, details } })
    } catch (e: any) {
        res.status(500).json({ success: false, error: errMsg(e) })
    }
})

export default router
