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
import { tinhTinhTrangDon } from '../lib/kiotvietDonHang'
import { KV, testConnection, clearTokenCache, type KiotVietCreds } from '../services/kiotviet'
import {
    newCounters, syncProducts, syncCustomers, syncSuppliers, syncInvoices,
    parseWebhookPayload, verifyWebhookSignature,
} from '../services/kiotvietSync'
import { buildOptions, boDemTuyChon, runSync, STALE_MS, SYNC_ENTITIES } from '../services/kiotvietRunner'

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

/**
 * Lỗi do KIOTVIET trả về thì phải cho người quản trị đọc nguyên văn.
 * `errMsg` cố ý giấu chi tiết ở production để không lộ nội bộ (SQL, đường dẫn
 * file…) — đúng với API công khai. Nhưng ở đây thông điệp đến TỪ BÊN NGOÀI và
 * cả vùng này đã nằm sau xác thực admin; giấu đi thì không ai lần ra được vì
 * sao đăng ký webhook hỏng (dính 07/08/2026: chỉ thấy "Internal server error").
 */
function kvErr(e: any): string {
    if (e?.name === 'KiotVietError' && e?.message) return String(e.message).slice(0, 400)
    return errMsg(e)
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
    // Webhook đụng khách nào thì hỏi lại KV số dư khách đó (làm tươi, không cộng trừ)
    opts.creds = creds
    opts.daTuoiNo = new Set<string>()
    opts.tuWebhook = true   // payload webhook không mang Debt — công nợ chỉ lấy từ KV REST (18/08/2026)
    /**
     * SỬA HOÁ ĐƠN BÊN KIOTVIET PHẢI THEO VỀ ĐỦ DÒNG HÀNG.
     * KV sửa phiếu là huỷ bản gốc + đẻ bản .01 rồi bắn invoice.update — không
     * dựng lại dòng thì bản Kengi ôm dòng cũ vĩnh viễn (đo 13/08/2026:
     * HD030373 → .01, người dùng sửa xong mà phiếu không thấy hàng mới).
     * Ba cổng an toàn trong syncInvoices vẫn gác: đủ 100% mã, có dòng,
     * cộng khớp tổng — không qua thì giữ nguyên và ghi lý do.
     */
    opts.rebuildLines = true

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
                // order.update / pricebook.update… — KiotViet có gửi nhưng Kengi
                // chưa đồng bộ loại đó. Ghi lại thay vì nuốt im, để còn biết
                // đang bỏ lỡ gì mà cân nhắc làm tiếp.
                await logWebhook(sp, n.action, 'skipped', n.data?.length || 0,
                    `Nhận được ${n.data?.length || 0} bản ghi nhưng Kengi chưa đồng bộ loại này`)
                continue
            }

            // NHẬN VÀO MÀ KHÔNG GHI ĐƯỢC GÌ thì phải giữ lại payload gốc.
            // Không có nó thì chỉ thấy "lấy 1 · tạo 0" và không tài nào biết
            // KiotViet gửi thiếu trường gì (dính 08/08/2026 với invoice.update).
            const khongGhiDuoc = c.fetched > 0 && c.created === 0 && c.updated === 0
            // Khách/NCC: LUÔN ghi danh sách trường + có debt hay không, kể cả khi ghi thành công.
            // 18/08/2026: webhook customer.update không mang Debt → từng ghi đè 0 lên nợ thật mà
            // log "success upd 1" không lưu gì để lần; nay nhìn log là biết KV gửi gì.
            const laDoiTac = n.action.startsWith('customer') || n.action.startsWith('supplier')
            const d0 = n.data?.[0]
            const mauGoc = khongGhiDuoc && d0
                ? `Payload gốc — các trường: ${Object.keys(d0).join(', ')}\n${JSON.stringify(d0).slice(0, 1500)}`
                : laDoiTac && d0
                    ? `Payload — các trường: ${Object.keys(d0).join(', ')} · debt: ${d0.debt === undefined ? 'KHÔNG CÓ (không đụng công nợ, hỏi lại KV)' : String(d0.debt)}`
                    : null

            await sp.kiotVietSyncLog.create({
                data: {
                    entity: n.action, mode: 'webhook',
                    status: c.failed ? 'partial' : 'success',
                    fetched: c.fetched, created: c.created, updated: c.updated,
                    skipped: c.skipped, failed: c.failed,
                    errors: [...(sigOk ? [] : ['⚠ chữ ký không khớp — đang chạy chế độ nới lỏng']), ...c.errors]
                        .join('\n').slice(0, 2000) || null,
                    details: mauGoc,
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
        /* Đổi kho/nhóm đích thì bỏ đệm tuỳ chọn ngay, đừng bắt chờ hết TTL —
         * người dùng vừa đổi mà đợt đồng bộ kế tiếp vẫn đổ vào kho cũ thì rất
         * khó hiểu và mất công gỡ. */
        boDemTuyChon(store.sp)
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

        // rebuildLines / updateOnly: sửa hoá đơn đã đổ sai dòng hàng — truyền
        // theo lần bấm, không lưu vào config (xem ghi chú ở runSync)
        void runSync(store.sp, cfg, entities, fromDate, toDate, apply, log.id,
            b.rebuildLines === true, b.updateOnly === true)
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

        /* q() trả về THUNK chứ không chạy ngay: nhét q(...) vào mảng là promise
         * khởi động tức thì, vòng lặp await phía dưới chỉ chờ theo thứ tự chứ
         * không hề làm chúng tuần tự. */
        const q = (sql: string) => () => sp.$queryRawUnsafe(sql).catch((e: any) => [{ loi: e?.message?.slice(0, 120) }])
        /* CHẠY TUẦN TỰ, không Promise.all.
         *
         * Pool Prisma MỖI CỬA HÀNG chỉ 5 kết nối. Sáu câu này đều quét bảng
         * (LIKE '%KiotViet%' không dùng được index) trên Transaction /
         * ImportReceipt / PurchaseOrder / ReturnOrder / CashReceipt / Expense /
         * Product — bắn song song là chiếm trọn 5/5 kết nối của chính cửa hàng
         * đang bán, webhook và POS xếp hàng phía sau. Đây là màn hình quản trị
         * mở vài lần một ngày; chậm thêm vài trăm ms không đáng gì so với việc
         * làm nghẽn quầy.
         *
         * `check-pool.ts` KHÔNG nhìn thấy chỗ này vì các lời gọi đi qua hàm bọc
         * q() chứ không phải $queryRawUnsafe trực tiếp. */
        const cauTx = [
            q(`SELECT COUNT(*)::int AS tong,
                      COUNT(*) FILTER (WHERE "status" <> 'completed')::int AS khongHoanThanh,
                      COUNT(*) FILTER (WHERE DATE("createdAt") = DATE("transactionDate"))::int AS dungNgay,
                      MIN("createdAt")::text AS somNhat, MAX("createdAt")::text AS muonNhat
               FROM "Transaction" WHERE "createdByName" = 'KiotViet Sync'`),
            // Phiếu nhập nay nằm ở ImportReceipt (trang "Phiếu nhập hàng");
            // vẫn đếm cả PurchaseOrder để thấy phần cũ đặt sai chỗ còn sót
            q(`SELECT
                 (SELECT COUNT(*) FROM "ImportReceipt" WHERE "note" LIKE '%KiotViet%')::int AS tong,
                 (SELECT COUNT(*) FROM "ImportReceipt" WHERE "note" LIKE '%KiotViet%' AND "status" <> 'completed')::int AS khongHoanThanh,
                 (SELECT COUNT(*) FROM "ImportReceipt" WHERE "note" LIKE '%KiotViet%' AND DATE("createdAt") = DATE("transactionDate"))::int AS dungNgay,
                 (SELECT COUNT(*) FROM "PurchaseOrder" WHERE "notes" LIKE '%KiotViet%')::int AS conSaiBang,
                 (SELECT MIN("createdAt")::text FROM "ImportReceipt" WHERE "note" LIKE '%KiotViet%') AS somNhat,
                 (SELECT MAX("createdAt")::text FROM "ImportReceipt" WHERE "note" LIKE '%KiotViet%') AS muonNhat`),
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
        ]
        const ketQua: any[] = []
        for (const chay of cauTx) ketQua.push(await chay())
        const [tx, po, ret, cash, exp, prod] = ketQua

        // CÔNG NỢ: tách rõ phần ĐẾN TỪ KIOTVIET và phần vốn CÓ SẴN trên Kengi.
        // Không tách thì thấy tổng lệch là đổ ngay cho đồng bộ, trong khi có thể
        // là nợ cửa hàng tự ghi từ trước.
        const cauNo = [
            q(`SELECT
                 COUNT(*) FILTER (WHERE c."debt" > 0)::int AS soKhachCoNo,
                 COALESCE(SUM(c."debt") FILTER (WHERE c."debt" > 0),0)::float8 AS tongNo,
                 COUNT(*) FILTER (WHERE c."debt" > 0 AND m."localId" IS NOT NULL)::int AS tuKiotViet,
                 COALESCE(SUM(c."debt") FILTER (WHERE c."debt" > 0 AND m."localId" IS NOT NULL),0)::float8 AS tongTuKiotViet,
                 COUNT(*) FILTER (WHERE c."debt" > 0 AND m."localId" IS NULL)::int AS khongTuKiotViet,
                 COALESCE(SUM(c."debt") FILTER (WHERE c."debt" > 0 AND m."localId" IS NULL),0)::float8 AS tongKhongTuKiotViet,
                 COALESCE(SUM(c."debt") FILTER (WHERE c."debt" < 0),0)::float8 AS tongNoAm
               FROM "Customer" c
               LEFT JOIN "KiotVietMap" m ON m."entity"='customer' AND m."localId"=c."id"`),
            q(`SELECT
                 COUNT(*) FILTER (WHERE s."payable" > 0)::int AS soNccCoNo,
                 COALESCE(SUM(s."payable") FILTER (WHERE s."payable" > 0),0)::float8 AS tongPhaiTra
               FROM "Supplier" s`),
        ]
        const ketQuaNo: any[] = []
        for (const chay of cauNo) ketQuaNo.push(await chay())
        const [noKhach, noNcc] = ketQuaNo

        // Sổ công nợ: bút toán thu nợ đã vào chưa, và còn bao nhiêu phiếu thu
        // đang nằm nhầm bên sổ quỹ
        const soCongNo = await q(`SELECT
                 (SELECT COUNT(*) FROM "DebtEntry" WHERE "type"='payment')::int AS tongButToanThu,
                 (SELECT COUNT(*) FROM "DebtEntry" WHERE "description" LIKE '%KiotViet%')::int AS tuKiotViet,
                 (SELECT COALESCE(SUM("amount"),0) FROM "DebtEntry" WHERE "description" LIKE '%KiotViet%')::float8 AS tienTuKiotViet,
                 -- Phiếu thu KHÔNG gắn khách hàng (thu khác) — vào sổ quỹ là ĐÚNG.
                 -- Đừng đọc con số này thành "còn nằm nhầm": sau khi sửa, phiếu
                 -- thu của khách đã sang sổ công nợ, phần còn lại ở đây là thu khác.
                 (SELECT COUNT(*) FROM "KiotVietMap" WHERE "entity"='cashReceipt')::int AS phieuThuKhac,
                 (SELECT COUNT(*) FROM "KiotVietMap" WHERE "entity"='debtPayment')::int AS daVaoSoCongNo`)()

        res.json({
            success: true,
            data: {
                hoaDonBan: tx?.[0], phieuNhap: po?.[0], traHang: ret?.[0],
                phieuThu: cash?.[0], phieuChi: exp?.[0], hangHoa: prod?.[0],
                congNoKhach: noKhach?.[0], congNoNcc: noNcc?.[0], soCongNo: soCongNo?.[0],
                ghiChu: 'dungNgay = số bản ghi có ngày tạo TRÙNG ngày chứng từ. Lệch nhiều nghĩa là dữ liệu cũ bị dồn về ngày đồng bộ.',
            },
        })
    } catch (e: any) {
        res.status(500).json({ success: false, error: errMsg(e) })
    }
})

// ─── POST /api/kiotviet/repair {storeCode, apply?} ──────────────────────────
/**
 * DỌN DỮ LIỆU ĐÃ ĐỔ BẰNG BẢN CŨ CÓ LỖI.
 *
 * Sửa code chỉ đúng cho lần sau; bản ghi đã nằm trong sổ vẫn sai. Việc này làm
 * hai chuyện, MẶC ĐỊNH CHẠY THỬ:
 *
 *  1. TRẢ NGÀY VỀ ĐÚNG CHỨNG TỪ. `transactionDate`/`receivedDate` vẫn luôn
 *     đúng, chỉ `createdAt` bị để mặc định now() — mà báo cáo doanh thu lại
 *     lọc theo createdAt. Chép ngược lại là xong, không cần gọi KiotViet.
 *
 *  2. XOÁ CHỨNG TỪ KHÔNG HOÀN THÀNH. Bản cũ hiểu sai mã trạng thái nên nuốt cả
 *     hoá đơn đã huỷ lẫn đang xử lý. Phải hỏi lại KiotViet mới biết phiếu nào
 *     thật sự hoàn thành — không suy được từ dữ liệu tại chỗ.
 *
 * Chỉ đụng bản ghi DO ĐỒNG BỘ TẠO RA (dò qua KiotVietMap), không chạm dữ liệu
 * người dùng tự nhập.
 */
router.post('/repair', async (req: Request, res: Response) => {
    try {
        const b = req.body || {}
        const store = await resolveStore(String(b.storeCode || ''))
        if (!store) { res.status(404).json({ success: false, error: 'Không tìm thấy cửa hàng' }); return }
        const cfg = await loadConfig(store.sp)
        if (!cfg) { res.status(400).json({ success: false, error: 'Chưa cấu hình KiotViet' }); return }
        const apply = b.apply === true

        // CHẠY NỀN. Bước hỏi lại KiotViet phải quét vài chục nghìn hoá đơn —
        // làm trong một request là 504 (đã dính 07/08/2026). Ghi tiến độ vào
        // cùng bảng nhật ký để hiện chung ở bảng lịch sử.
        const log = await store.sp.kiotVietSyncLog.create({
            data: {
                entity: 'dọn dữ liệu', mode: 'repair', dryRun: !apply,
                status: 'running', startedAt: new Date(), heartbeatAt: new Date(),
            },
        })
        res.json({
            success: true,
            data: {
                logId: log.id,
                cheDo: apply ? 'ĐANG DỌN' : 'ĐANG CHẠY THỬ',
                message: 'Đã bắt đầu. Kết quả hiện ở bảng lịch sử bên dưới trong ít phút.',
            },
        })

        void chayDon(store.sp, cfg, apply, log.id, b?.goPhieuThu === true).catch(async (e: any) => {
            await store.sp.kiotVietSyncLog.update({
                where: { id: log.id },
                data: { status: 'failed', finishedAt: new Date(), errors: errMsg(e).slice(0, 2000) },
            }).catch(() => { })
        })
    } catch (e: any) {
        if (!res.headersSent) res.status(500).json({ success: false, error: errMsg(e) })
    }
})

async function chayDon(sp: any, cfg: any, apply: boolean, logId: string, goPhieuThu: boolean): Promise<void> {
    {
        // ─ 1. Ngày: chép transactionDate → createdAt ─
        const txSaiNgay: any[] = await sp.$queryRawUnsafe(
            `SELECT COUNT(*)::int AS n FROM "Transaction"
             WHERE "createdByName" = 'KiotViet Sync' AND "transactionDate" IS NOT NULL
               AND DATE("createdAt") <> DATE("transactionDate")`).catch(() => [{ n: 0 }])
        const poSaiNgay: any[] = await sp.$queryRawUnsafe(
            `SELECT COUNT(*)::int AS n FROM "PurchaseOrder"
             WHERE "notes" LIKE '%KiotViet%' AND "receivedDate" IS NOT NULL
               AND DATE("createdAt") <> DATE("receivedDate")`).catch(() => [{ n: 0 }])

        if (apply) {
            await sp.$executeRawUnsafe(
                `UPDATE "Transaction" SET "createdAt" = "transactionDate"
                 WHERE "createdByName" = 'KiotViet Sync' AND "transactionDate" IS NOT NULL
                   AND DATE("createdAt") <> DATE("transactionDate")`)
            await sp.$executeRawUnsafe(
                `UPDATE "PurchaseOrder" SET "createdAt" = "receivedDate"
                 WHERE "notes" LIKE '%KiotViet%' AND "receivedDate" IS NOT NULL
                   AND DATE("createdAt") <> DATE("receivedDate")`)
        }

        // ─ 1b. Khách hết nợ thì hoá đơn của họ phải là ĐÃ THU ĐỦ ─
        // Trang công nợ tự suy thêm người nợ từ hoá đơn chưa thu; hoá đơn cũ
        // nhập bằng bản trước để amountReceived=0 nên đẻ ra khách nợ ảo.
        // Customer.debt (đã đồng bộ từ KiotViet) là số chuẩn.
        const noAo: any[] = await sp.$queryRawUnsafe(
            `SELECT COUNT(*)::int AS n FROM "Transaction" t
             JOIN "Customer" c ON c."id" = t."customerId"
             WHERE t."createdByName" = 'KiotViet Sync' AND c."debt" <= 0
               AND t."amountReceived" < t."total"`).catch(() => [{ n: 0 }])
        if (apply) {
            await sp.$executeRawUnsafe(
                `UPDATE "Transaction" t SET "amountReceived" = t."total", "status" = 'completed'
                 FROM "Customer" c
                 WHERE c."id" = t."customerId" AND t."createdByName" = 'KiotViet Sync'
                   AND c."debt" <= 0 AND t."amountReceived" < t."total"`)
        }

        /**
         * ─ 1c. Phiếu thu nằm trong SỔ QUỸ ─ CHỈ LÀM KHI ĐƯỢC YÊU CẦU RÕ.
         *
         * Bản cũ đổ MỌI phiếu thu vào CashReceipt nên lịch sử công nợ trống;
         * cách chữa là gỡ hết rồi đồng bộ lại để chúng vào đúng sổ. Nhưng sau
         * khi đã chữa xong, các phiếu thu còn lại trong sổ quỹ là phiếu thu
         * KHÔNG gắn khách (thu khác) — nằm ĐÚNG CHỖ. Cứ gỡ mặc định thì mỗi lần
         * bấm Dọn lại xoá oan dữ liệu tốt rồi bắt đồng bộ lại (đo HUTI
         * 09/08/2026: 551 phiếu hợp lệ suýt bị gỡ).
         *
         * Nên: mặc định CHỈ ĐẾM, chỉ gỡ khi gửi `goPhieuThu: true`.
         */
        const mapThu: any[] = await sp.kiotVietMap.findMany({
            where: { entity: 'cashReceipt' }, select: { id: true, localId: true },
        }).catch(() => [])
        if (apply && goPhieuThu && mapThu.length) {
            for (let i = 0; i < mapThu.length; i += 500) {
                const lo = mapThu.slice(i, i + 500)
                await sp.cashReceipt.deleteMany({ where: { id: { in: lo.map(m => m.localId) } } }).catch(() => { })
                await sp.kiotVietMap.deleteMany({ where: { id: { in: lo.map(m => m.id) } } }).catch(() => { })
            }
        }

        // ─ 1d. Thẻ kho: sửa dòng ghi sai DẤU số lượng ─
        // Cả hệ thống quy ước quantity CÓ DẤU (dương = nhập, âm = xuất); bản cũ
        // ghi Math.abs() nên dòng giảm tồn vẫn nhảy vào cột Nhập, tổng nhập
        // phồng lên và tồn luỹ kế ra số âm. Nhận diện qua referenceType.
        const theKhoSai: any[] = await sp.$queryRawUnsafe(
            `SELECT COUNT(*)::int AS n FROM "InventoryTransaction"
             WHERE "referenceType" = 'kiotviet' AND ("type" IN ('in','out'))`).catch(() => [{ n: 0 }])
        if (apply) {
            // 'out' đã ghi số dương → lật dấu cho đúng chiều
            await sp.$executeRawUnsafe(
                `UPDATE "InventoryTransaction"
                 SET "quantity" = -ABS("quantity"), "type" = 'adjustment'
                 WHERE "referenceType" = 'kiotviet' AND "type" = 'out'`)
            // 'in' đã đúng dấu, chỉ đổi về từ vựng chuẩn của app
            await sp.$executeRawUnsafe(
                `UPDATE "InventoryTransaction" SET "type" = 'adjustment'
                 WHERE "referenceType" = 'kiotviet' AND "type" = 'in'`)
        }

        // ─ 1e. Phiếu nhập nằm SAI MODULE ─
        // Bản cũ đổ "Nhập hàng" của KiotViet vào PurchaseOrder (đơn ĐẶT hàng),
        // trong khi trang "Phiếu nhập hàng" đọc ImportReceipt — nên trang đó
        // trống trơn dù đã nhập hàng trăm phiếu. Xoá các bản ghi đặt sai chỗ
        // cùng dấu vết, để lần đồng bộ Phiếu nhập sau dựng lại đúng bảng.
        const poSaiBang: any[] = await sp.$queryRawUnsafe(
            `SELECT COUNT(*)::int AS n FROM "PurchaseOrder" WHERE "notes" LIKE '%KiotViet%'`)
            .catch(() => [{ n: 0 }])
        if (apply && (poSaiBang?.[0]?.n || 0) > 0) {
            const ids: any[] = await sp.purchaseOrder.findMany({
                where: { notes: { contains: 'KiotViet' } }, select: { id: true },
            }).catch(() => [])
            for (let i = 0; i < ids.length; i += 500) {
                const lo = ids.slice(i, i + 500).map(x => x.id)
                await sp.purchaseOrder.deleteMany({ where: { id: { in: lo } } }).catch(() => { })
                await sp.kiotVietMap.deleteMany({ where: { entity: 'purchaseOrder', localId: { in: lo } } }).catch(() => { })
            }
        }

        // ─ 2. Hỏi KiotViet phiếu nào KHÔNG hoàn thành rồi xoá ─
        const creds = credsOf(cfg)
        const huyHoaDon: string[] = []
        const huyPhieuNhap: string[] = []
        let loiGoiApi: string | null = null
        // Đập nhịp theo từng trang tải, nếu không sẽ hiện "đứng im" suốt lúc quét
        const nhip = {
            onPage: async (_i: any[], f: number, t: number) => {
                await sp.kiotVietSyncLog.update({
                    where: { id: logId },
                    data: { heartbeatAt: new Date(), entity: `dọn dữ liệu · đang hỏi KiotViet ${f}/${t}` },
                }).catch(() => { })
            },
        }
        try {
            const { items: invs } = await KV.invoices(creds, {}, { maxPages: 500, ...nhip })
            for (const iv of invs) {
                if (Number(iv?.status) !== 1 && iv?.code) huyHoaDon.push(String(iv.code))
            }
            const { items: pos } = await KV.purchaseOrders(creds, {}, { maxPages: 500, ...nhip })
            for (const po of pos) {
                const code = String(po?.code || '')
                if (code && (Number(po?.status) !== 3 || /\{DEL\}/i.test(code))) huyPhieuNhap.push(code)
            }
        } catch (e: any) {
            loiGoiApi = errMsg(e)
        }

        // Đếm/xoá theo LÔ — danh sách mã có thể lên hàng chục nghìn, nhét hết
        // vào một câu IN (...) là vỡ câu lệnh.
        const LO = 500
        let xoaHoaDon = 0, xoaPhieuNhap = 0
        for (let i = 0; i < huyHoaDon.length; i += LO) {
            const lo = huyHoaDon.slice(i, i + LO)
            const where = { receiptNumber: { in: lo }, createdByName: 'KiotViet Sync' }
            xoaHoaDon += await sp.transaction.count({ where }).catch(() => 0)
            if (apply) await sp.transaction.deleteMany({ where }).catch(() => { })
            await sp.kiotVietSyncLog.update({
                where: { id: logId },
                data: { heartbeatAt: new Date(), entity: `dọn dữ liệu · đang xử lý hoá đơn ${i + lo.length}/${huyHoaDon.length}` },
            }).catch(() => { })
        }
        for (let i = 0; i < huyPhieuNhap.length; i += LO) {
            const lo = huyPhieuNhap.slice(i, i + LO)
            const where = { code: { in: lo }, notes: { contains: 'KiotViet' } }
            xoaPhieuNhap += await sp.purchaseOrder.count({ where }).catch(() => 0)
            if (apply) await sp.purchaseOrder.deleteMany({ where }).catch(() => { })
        }

        const suaNgayTx = txSaiNgay?.[0]?.n || 0
        const suaNgayPo = poSaiNgay?.[0]?.n || 0
        await sp.kiotVietSyncLog.update({
            where: { id: logId },
            data: {
                entity: 'dọn dữ liệu',
                status: loiGoiApi ? 'partial' : 'success',
                fetched: suaNgayTx + suaNgayPo + xoaHoaDon + xoaPhieuNhap,
                updated: suaNgayTx + suaNgayPo,
                skipped: xoaHoaDon + xoaPhieuNhap,
                heartbeatAt: new Date(), finishedAt: new Date(),
                errors: loiGoiApi ? `Không hỏi được KiotViet: ${loiGoiApi}` : null,
                details: JSON.stringify({
                    'sửa ngày': { layVe: suaNgayTx + suaNgayPo, taoMoi: 0, capNhat: suaNgayTx + suaNgayPo, boQua: 0, loi: 0, xong: true, mau: [{ hoaDon: suaNgayTx, phieuNhap: suaNgayPo }] },
                    'gỡ nợ ảo (khách hết nợ mà hoá đơn ghi chưa thu)': { layVe: noAo?.[0]?.n || 0, taoMoi: 0, capNhat: noAo?.[0]?.n || 0, boQua: 0, loi: 0, xong: true, mau: [{ soHoaDon: noAo?.[0]?.n || 0 }] },
                    '⚠ gỡ phiếu nhập nằm SAI MODULE — chạy lại "Phiếu nhập hàng" sau khi dọn': {
                        layVe: poSaiBang?.[0]?.n || 0, taoMoi: 0, capNhat: 0, boQua: poSaiBang?.[0]?.n || 0,
                        loi: 0, xong: true,
                        mau: [{ soPhieu: poSaiBang?.[0]?.n || 0, viecTiepTheo: 'Đồng bộ → "Phiếu nhập hàng" → khoảng ngày "Toàn bộ" → Ghi thật' }],
                    },
                    'sửa dấu số lượng trong thẻ kho': {
                        layVe: theKhoSai?.[0]?.n || 0, taoMoi: 0, capNhat: theKhoSai?.[0]?.n || 0,
                        boQua: 0, loi: 0, xong: true, mau: [{ soDong: theKhoSai?.[0]?.n || 0 }],
                    },
                    [goPhieuThu
                        ? '⚠ ĐÃ GỠ phiếu thu khỏi sổ quỹ — BẮT BUỘC chạy lại "Phiếu thu / chi" với khoảng ngày TOÀN BỘ'
                        : 'phiếu thu đang nằm ở sổ quỹ (thu khác — KHÔNG đụng tới)']: {
                        layVe: mapThu.length, taoMoi: 0, capNhat: 0, boQua: mapThu.length, loi: 0, xong: true,
                        mau: [goPhieuThu
                            ? { soPhieuDaGo: mapThu.length, viecTiepTheo: 'Đồng bộ → "Phiếu thu / chi" → khoảng ngày "Toàn bộ" → Ghi thật' }
                            : { soPhieu: mapThu.length, ghiChu: 'Giữ nguyên. Chỉ gỡ khi bấm riêng nút chuyển phiếu thu sang sổ công nợ.' }],
                    },
                    'xoá chứng từ không hoàn thành': { layVe: xoaHoaDon + xoaPhieuNhap, taoMoi: 0, capNhat: 0, boQua: xoaHoaDon + xoaPhieuNhap, loi: 0, xong: true, mau: [{ hoaDon: xoaHoaDon, phieuNhap: xoaPhieuNhap }] },
                }),
            },
        }).catch(() => { })
    }
}

// ─── GET /api/kiotviet/webhooks?storeCode= ──────────────────────────────────
// Danh sách webhook ĐANG đăng ký bên KiotViet, đánh dấu cái nào trỏ về Kengi.
const WEBHOOK_TYPES = ['product.update', 'stock.update', 'customer.update', 'invoice.update', 'order.update', 'pricebook.update']

router.get('/webhooks', async (req: Request, res: Response) => {
    try {
        const storeCode = String(req.query.storeCode || '')
        const store = await resolveStore(storeCode)
        if (!store) { res.status(404).json({ success: false, error: 'Không tìm thấy cửa hàng' }); return }
        const cfg = await loadConfig(store.sp)
        if (!cfg) { res.status(400).json({ success: false, error: 'Chưa cấu hình KiotViet' }); return }

        const myUrl = `${baseUrlOf(req)}/api/kiotviet/webhook/${encodeURIComponent(storeCode)}/${cfg.webhookToken}`
        const r = await KV.listWebhooks(credsOf(cfg))
        const rows = (r?.data || []).map((w: any) => ({
            id: w.id, type: w.type, url: w.url, isActive: !!w.isActive,
            description: w.description,
            cuaKengi: String(w.url || '').includes(`/api/kiotviet/webhook/`),
        }))
        res.json({
            success: true,
            data: {
                duongDanKengi: myUrl,
                daDangKy: rows,
                // Loại nào Kengi CHƯA nhận được — đây là thứ cần bấm đăng ký
                conThieu: WEBHOOK_TYPES.filter(t => !rows.some((w: any) => w.cuaKengi && w.type === t && w.isActive)),
                /* TÁCH RIÊNG "ĐÃ ĐĂNG KÝ NHƯNG ĐANG TẮT".
                 *
                 * Gộp chung vào `conThieu` thì giao diện giải thích bằng câu
                 * chuyện xung đột n8n — sai hướng hoàn toàn khi webhook vốn đã
                 * trỏ về Kengi và chỉ bị KiotViet tắt đi (nó tự tắt sau nhiều
                 * lần giao hỏng). Hai nguyên nhân, hai cách chữa: một bên là
                 * giành lấy loại sự kiện, một bên là bật lại.
                 *
                 * Đo thật 15/08/2026 ở HUTI: invoice.update / order.update /
                 * stock.update đều trỏ Kengi mà đang TẮT — đơn hàng ngừng về
                 * suốt một ngày mà không ai biết vì sao. */
                dangTat: rows.filter((w: any) => w.cuaKengi && !w.isActive).map((w: any) => w.type),
                loaiHopLe: WEBHOOK_TYPES,
            },
        })
    } catch (e: any) {
        res.status(500).json({ success: false, error: errMsg(e) })
    }
})

// ─── POST /api/kiotviet/webhooks/register {storeCode, types?} ───────────────
// Đăng ký webhook trỏ về Kengi. KHÔNG đụng webhook sẵn có của cửa hàng (n8n…)
// — KiotViet cho nhiều webhook cùng loại, nên thêm vào chứ không thay thế.
router.post('/webhooks/register', async (req: Request, res: Response) => {
    try {
        const b = req.body || {}
        const storeCode = String(b.storeCode || '')
        const store = await resolveStore(storeCode)
        if (!store) { res.status(404).json({ success: false, error: 'Không tìm thấy cửa hàng' }); return }
        const cfg = await loadConfig(store.sp)
        if (!cfg) { res.status(400).json({ success: false, error: 'Chưa cấu hình KiotViet' }); return }

        const types: string[] = Array.isArray(b.types) && b.types.length
            ? WEBHOOK_TYPES.filter(t => b.types.map(String).includes(t))
            : WEBHOOK_TYPES
        const myUrl = `${baseUrlOf(req)}/api/kiotviet/webhook/${encodeURIComponent(storeCode)}/${cfg.webhookToken}`
        const creds = credsOf(cfg)

        /**
         * KIOTVIET CHỈ CHO MỘT WEBHOOK MỖI LOẠI SỰ KIỆN.
         * Đăng ký trùng loại trả HTTP 500 "Type đã tồn tại" (đo 07/08/2026).
         * Cửa hàng này đã dùng cả 6 loại cho n8n, nên muốn Kengi nhận thì buộc
         * phải THAY THẾ — việc đó làm hỏng luồng n8n nên KHÔNG tự ý làm, phải
         * có `thayThe: true` gửi lên.
         */
        const thayThe = b.thayThe === true
        const hienCo = await KV.listWebhooks(creds).then(r => r?.data || []).catch(() => [])

        const ok: string[] = []
        const viMatKhac: { type: string; url: string; id: any }[] = []
        const loi: string[] = []

        for (const t of types) {
            const dangCo = hienCo.find((w: any) => w.type === t)
            const laCuaKengi = dangCo && String(dangCo.url || '').includes('/api/kiotviet/webhook/')
            /* PHẢI XÉT CẢ isActive.
             *
             * Bản trước bỏ qua mọi webhook của Kengi bất kể đang bật hay tắt, nên
             * với webhook BỊ TẮT nó báo "đã có sẵn" rồi không làm gì — đúng cái
             * nút mà cảnh báo bảo người dùng bấm lại vô dụng với đúng ca đang
             * hỏng. Đo thật 15/08/2026 ở HUTI: invoice.update / order.update /
             * stock.update đều trỏ Kengi mà isActive=false, đơn hàng ngừng về
             * suốt một ngày; bấm nút này sẽ báo thành công mà không đổi gì.
             *
             * KiotViet không có API bật lại, nên cách duy nhất là xoá rồi tạo
             * mới — an toàn vì bản ghi đó vốn đã là của Kengi. */
            if (dangCo && laCuaKengi && dangCo.isActive) { ok.push(`${t} (đã có sẵn)`); continue }
            if (dangCo && laCuaKengi && !dangCo.isActive) {
                try {
                    await KV.deleteWebhook(creds, dangCo.id)
                    await KV.createWebhook(creds, t, myUrl, `Kengi ${storeCode}`)
                    ok.push(`${t} (bật lại — KiotViet đã tự tắt)`)
                } catch (e: any) {
                    loi.push(`${t} (bật lại): ${kvErr(e).slice(0, 250)}`)
                }
                continue
            }

            if (dangCo && !thayThe) {
                viMatKhac.push({ type: t, url: String(dangCo.url || ''), id: dangCo.id })
                continue
            }
            try {
                if (dangCo) await KV.deleteWebhook(creds, dangCo.id)
                await KV.createWebhook(creds, t, myUrl, `Kengi ${storeCode}`)
                ok.push(t)
            } catch (e: any) {
                loi.push(`${t}: ${kvErr(e).slice(0, 250)}`)
            }
        }

        const phanMessage = [
            ok.length ? `Đã đăng ký ${ok.length} sự kiện về Kengi: ${ok.join(', ')}.` : '',
            viMatKhac.length
                ? `${viMatKhac.length} loại đang được hệ thống khác dùng (${viMatKhac.map(v => v.type).join(', ')}) — KiotViet chỉ cho MỘT webhook mỗi loại. Muốn Kengi nhận thì phải thay thế, nhưng làm vậy luồng cũ sẽ ngừng nhận.`
                : '',
            loi.length ? `Lỗi: ${loi.join(' | ')}` : '',
        ].filter(Boolean).join(' ')

        res.json({
            success: ok.length > 0 || viMatKhac.length > 0,
            data: { daDangKy: ok, viMatKhac, loi, message: phanMessage || 'Không có gì để làm.' },
        })
    } catch (e: any) {
        res.status(500).json({ success: false, error: errMsg(e) })
    }
})

// ─── DELETE /api/kiotviet/webhooks/:id?storeCode= ───────────────────────────
router.delete('/webhooks/:id', async (req: Request, res: Response) => {
    try {
        const store = await resolveStore(String(req.query.storeCode || ''))
        if (!store) { res.status(404).json({ success: false, error: 'Không tìm thấy cửa hàng' }); return }
        const cfg = await loadConfig(store.sp)
        if (!cfg) { res.status(400).json({ success: false, error: 'Chưa cấu hình KiotViet' }); return }
        await KV.deleteWebhook(credsOf(cfg), String(req.params.id))
        res.json({ success: true })
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

        /* Hoá đơn thưa hơn hẳn customer.update, nên `limit` dòng đầu rất dễ
         * KHÔNG chứa dòng hoá đơn nào (đo HUTI: 2/100). Hỏi riêng một câu để
         * kết luận không phụ thuộc người dùng đang xem bao nhiêu dòng.
         * Chạy TUẦN TỰ — pool mỗi cửa hàng chỉ 3 kết nối. */
        /* `contains` chứ không `= 'invoices'`: nút "đồng bộ tất cả" ghi entity
         * gộp `products,customers,…,invoices,…`. Lọc chính xác lại bằng
         * laHoaDon() — chuỗi gộp phải tách dấu phẩy mới nhận ra. */
        const dongHoaDon = await store.sp.kiotVietSyncLog.findFirst({
            where: { entity: { contains: 'invoice' } },
            orderBy: { startedAt: 'desc' },
        }).catch(() => null)
        const dongWebhook = await store.sp.kiotVietSyncLog.findFirst({
            where: { entity: { startsWith: 'invoice.' } },
            orderBy: { startedAt: 'desc' },
        }).catch(() => null)
        /* Lượt hoá đơn gần nhất THẬT SỰ ghi được phiếu. Cũng phải hỏi riêng, và
         * vì đúng lý do trên: đo 15/08/2026 lúc 10:01, webhook hoá đơn dội về
         * dày tới mức 100 dòng gần nhất chỉ còn phủ 12 PHÚT (38 dòng hoá đơn,
         * ghi 0 hết). Lượt bấm tay ghi 22 phiếu lúc 09:26 rơi ra ngoài cửa sổ →
         * suy từ danh sách sẽ kêu oan "48h qua chưa phiếu nào vào sổ". */
        const dongGhiDuoc = await store.sp.kiotVietSyncLog.findFirst({
            where: {
                entity: { contains: 'invoice' },
                OR: [{ created: { gt: 0 } }, { updated: { gt: 0 } }],
            },
            orderBy: { startedAt: 'desc' },
        }).catch(() => null)

        const mau = [dongHoaDon, dongWebhook, dongGhiDuoc, ...logs].filter(Boolean)
        res.json({ success: true, data: logs, donHang: tinhTinhTrangDon(mau) })
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
