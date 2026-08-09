/**
 * CỔNG ĐỒNG BỘ MISA AMIS KẾ TOÁN ↔ KENGI (2026-08-09)
 *
 * Gắn tại /api/misa, toàn bộ sau adminAuth (không có webhook công khai — MISA
 * đẩy dữ liệu qua callback đăng ký riêng, chưa dùng tới).
 *
 * PHẠM VI: chỉ KÉO DANH MỤC + TỒN KHO. MISA Open API không có hàm lấy chứng từ
 * (hoá đơn, phiếu thu/chi, nhập kho) — chỉ có `save` để đẩy lên. Xem đầu
 * services/misa.ts.
 *
 * Đợt đồng bộ chạy NỀN như cổng KiotViet: tạo một dòng MisaSyncLog rồi trả ngay
 * logId, công việc chạy tiếp phía sau và đập nhịp tim vào nhật ký.
 */

import { Router, Request, Response, NextFunction } from 'express'
import crypto from 'crypto'
import jwt from 'jsonwebtoken'
import { registryPrisma, getStorePrisma } from '../lib/prisma'
import { errMsg } from '../lib/errorResponse'
import {
    MISA, MISA_DATA_TYPE, misaTime, testMisaConnection, clearMisaToken, type MisaCreds,
} from '../services/misa'
import {
    newMisaCounters, syncMisaProducts, syncMisaPartners, syncMisaWarehouses, syncMisaStock,
    type MisaOptions,
} from '../services/misaSync'

const router = Router()

const ADMIN_KEY = process.env.ADMIN_KEY
const JWT_SECRET = process.env.JWT_SECRET || ''
const PANEL_SCOPE = 'admin-panel'

/** Thứ tự CÓ Ý NGHĨA: tồn kho tra vật tư theo mã, nên vật tư phải xong trước. */
export const MISA_ENTITIES = ['products', 'partners', 'stocks', 'balance'] as const

function safeEqual(a: string, b: string): boolean {
    const ab = Buffer.from(a), bb = Buffer.from(b)
    if (ab.length !== bb.length) return false
    return crypto.timingSafeEqual(ab, bb)
}

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

async function resolveStore(storeCode: string): Promise<{ name: string; sp: any } | null> {
    const store = await registryPrisma.store.findFirst({
        where: { code: { equals: String(storeCode).trim(), mode: 'insensitive' } },
        select: { schema: true, name: true },
    }).catch(() => null)
    if (!store) return null
    return { name: store.name, sp: getStorePrisma(store.schema) as any }
}

const loadConfig = (sp: any) => sp.misaConfig.findUnique({ where: { id: 'default' } }).catch(() => null)

function credsOf(cfg: any): MisaCreds {
    return {
        appId: String(cfg.appId || '').trim(),
        accessCode: String(cfg.accessCode || '').trim(),
        orgCompanyCode: String(cfg.orgCompanyCode || '').trim(),
        baseUrl: cfg.baseUrl ? String(cfg.baseUrl).trim() : undefined,
    }
}

/** Lỗi TỪ MISA phải cho quản trị đọc nguyên văn — xem ghi chú kvErr ở cổng KiotViet. */
function misaErr(e: any): string {
    if (e?.name === 'MisaError' && e?.message) return String(e.message).slice(0, 400)
    return errMsg(e)
}

/** Ẩn bí mật trước khi trả về trình duyệt. */
function publicConfig(cfg: any) {
    if (!cfg) return null
    return {
        appId: cfg.appId ? `${String(cfg.appId).slice(0, 6)}…` : '',
        daDatAccessCode: !!cfg.accessCode,
        orgCompanyCode: cfg.orgCompanyCode,
        baseUrl: cfg.baseUrl || 'https://actapp.misa.vn',
        enabled: !!cfg.enabled,
        syncProducts: !!cfg.syncProducts,
        syncPartners: !!cfg.syncPartners,
        syncStocks: !!cfg.syncStocks,
        syncBalance: !!cfg.syncBalance,
        overwriteNames: !!cfg.overwriteNames,
        overwritePrices: !!cfg.overwritePrices,
        overwriteStock: !!cfg.overwriteStock,
        defaultCategoryId: cfg.defaultCategoryId,
        defaultWarehouseId: cfg.defaultWarehouseId,
        lastSyncAt: cfg.lastSyncAt,
    }
}

// ─── GET /api/misa/config?storeCode= ────────────────────────────────────────
router.get('/config', async (req: Request, res: Response) => {
    try {
        const store = await resolveStore(String(req.query.storeCode || ''))
        if (!store) { res.status(404).json({ success: false, error: 'Không tìm thấy cửa hàng' }); return }
        const cfg = await loadConfig(store.sp)
        const [warehouses, categories] = await Promise.all([
            store.sp.warehouse.findMany({
                where: { isActive: true }, select: { id: true, code: true, name: true, type: true, isDefault: true },
                orderBy: { isDefault: 'desc' }, take: 50,
            }).catch(() => []),
            store.sp.category.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' }, take: 200 }).catch(() => []),
        ])
        res.json({ success: true, data: { storeName: store.name, config: publicConfig(cfg), warehouses, categories } })
    } catch (e: any) {
        res.status(500).json({ success: false, error: errMsg(e) })
    }
})

// ─── PUT /api/misa/config ───────────────────────────────────────────────────
// Bí mật để TRỐNG = giữ nguyên (trang admin không hiển thị lại bí mật).
router.put('/config', async (req: Request, res: Response) => {
    try {
        const b = req.body || {}
        const store = await resolveStore(String(b.storeCode || ''))
        if (!store) { res.status(404).json({ success: false, error: 'Không tìm thấy cửa hàng' }); return }

        const existing = await loadConfig(store.sp)
        const data: any = {}
        const setStr = (k: string, v: any) => { if (typeof v === 'string' && v.trim()) data[k] = v.trim() }
        setStr('appId', b.appId)
        setStr('accessCode', b.accessCode)
        setStr('orgCompanyCode', b.orgCompanyCode)
        if (typeof b.baseUrl === 'string') data.baseUrl = b.baseUrl.trim() || null

        for (const k of ['enabled', 'syncProducts', 'syncPartners', 'syncStocks', 'syncBalance',
            'overwriteNames', 'overwritePrices', 'overwriteStock']) {
            if (typeof b[k] === 'boolean') data[k] = b[k]
        }
        if (b.defaultWarehouseId !== undefined) data.defaultWarehouseId = b.defaultWarehouseId || null
        if (b.defaultCategoryId !== undefined) data.defaultCategoryId = b.defaultCategoryId || null

        // Đổi bí mật thì token cũ trong bộ nhớ phải bỏ, không thì vẫn dùng cái cũ
        if (existing && (data.appId || data.accessCode || data.orgCompanyCode)) clearMisaToken(credsOf(existing))

        let cfg
        if (existing) {
            cfg = await store.sp.misaConfig.update({ where: { id: 'default' }, data })
        } else {
            if (!data.appId || !data.accessCode || !data.orgCompanyCode) {
                res.status(400).json({ success: false, error: 'Lần đầu phải nhập đủ App ID, Access Code và Mã công ty (org_company_code)' })
                return
            }
            cfg = await store.sp.misaConfig.create({ data: { id: 'default', ...data } })
        }
        res.json({ success: true, data: publicConfig(cfg) })
    } catch (e: any) {
        res.status(500).json({ success: false, error: errMsg(e) })
    }
})

// ─── POST /api/misa/test-connection {storeCode} ─────────────────────────────
router.post('/test-connection', async (req: Request, res: Response) => {
    try {
        const store = await resolveStore(String(req.body?.storeCode || ''))
        if (!store) { res.status(404).json({ success: false, error: 'Không tìm thấy cửa hàng' }); return }
        const cfg = await loadConfig(store.sp)
        if (!cfg) { res.status(400).json({ success: false, error: 'Chưa cấu hình MISA cho cửa hàng này' }); return }
        const r = await testMisaConnection(credsOf(cfg))
        res.json({ success: r.ok, data: r, error: r.ok ? undefined : r.error })
    } catch (e: any) {
        res.status(500).json({ success: false, error: misaErr(e) })
    }
})

// ─── GET /api/misa/peek?storeCode=&dataType=2&n=5 ───────────────────────────
// CHỈ ĐỌC: xem bản ghi THÔ từ MISA. Tài liệu công khai không liệt kê đủ trường
// nên phải nhìn dữ liệu thật mới biết trường nào mang ý nghĩa gì.
router.get('/peek', async (req: Request, res: Response) => {
    try {
        const store = await resolveStore(String(req.query.storeCode || ''))
        if (!store) { res.status(404).json({ success: false, error: 'Không tìm thấy cửa hàng' }); return }
        const cfg = await loadConfig(store.sp)
        if (!cfg) { res.status(400).json({ success: false, error: 'Chưa cấu hình MISA' }); return }

        const n = Math.min(20, Math.max(1, Number(req.query.n) || 5))
        const creds = credsOf(cfg)
        const laTonKho = String(req.query.balance || '') === '1'
        const dataType = Number(req.query.dataType) || MISA_DATA_TYPE.VAT_TU

        const { items } = laTonKho
            ? await MISA.tonKho(creds, {}, { take: n, maxPages: 1 })
            : await MISA.danhMuc(creds, dataType, {}, { take: n, maxPages: 1 })

        res.json({
            success: true,
            data: {
                soBanGhi: items.length,
                cacTruong: items[0] ? Object.keys(items[0]) : [],
                banGhi: items.slice(0, n),
            },
        })
    } catch (e: any) {
        res.status(500).json({ success: false, error: misaErr(e) })
    }
})

// ─── Tuỳ chọn đồng bộ ───────────────────────────────────────────────────────
async function buildOptions(sp: any, cfg: any, apply: boolean): Promise<MisaOptions> {
    let warehouseId: string | null = cfg?.defaultWarehouseId || null
    if (!warehouseId) {
        const wh = await sp.warehouse.findFirst({
            where: { type: 'main', isActive: true }, orderBy: { isDefault: 'desc' }, select: { id: true },
        }).catch(() => null)
        warehouseId = wh?.id || null
    }
    let categoryId: string | null = cfg?.defaultCategoryId || null
    if (!categoryId) {
        const cat = await sp.category.findFirst({ select: { id: true }, orderBy: { createdAt: 'asc' } }).catch(() => null)
        categoryId = cat?.id || null
    }
    return {
        apply,
        overwriteNames: !!cfg?.overwriteNames,
        overwritePrices: !!cfg?.overwritePrices,
        overwriteStock: !!cfg?.overwriteStock,
        defaultCategoryId: categoryId,
        defaultWarehouseId: warehouseId,
    }
}

// ─── POST /api/misa/sync ────────────────────────────────────────────────────
// Body: {storeCode, entities:['products','partners','stocks','balance'],
//        fromDate?: 'YYYY-MM-DD', apply?: boolean}
// MẶC ĐỊNH CHẠY THỬ.
router.post('/sync', async (req: Request, res: Response) => {
    try {
        const b = req.body || {}
        const store = await resolveStore(String(b.storeCode || ''))
        if (!store) { res.status(404).json({ success: false, error: 'Không tìm thấy cửa hàng' }); return }
        const cfg = await loadConfig(store.sp)
        if (!cfg) { res.status(400).json({ success: false, error: 'Chưa cấu hình MISA' }); return }

        // Sắp theo thứ tự phụ thuộc, không tin thứ tự người dùng bấm
        const entities: string[] = Array.isArray(b.entities)
            ? MISA_ENTITIES.filter(e => b.entities.map(String).includes(e))
            : []
        if (!entities.length) {
            res.status(400).json({ success: false, error: 'Chọn ít nhất một loại dữ liệu' }); return
        }

        const fromDate = b.fromDate ? new Date(`${b.fromDate}T00:00:00+07:00`) : null
        if (fromDate && isNaN(fromDate.getTime())) {
            res.status(400).json({ success: false, error: 'Ngày không hợp lệ' }); return
        }
        const apply = b.apply === true

        // Chặn bấm chồng khi đợt trước còn nhịp tim (<2 phút)
        const running = await store.sp.misaSyncLog.findFirst({
            where: { mode: 'manual', status: 'running' }, orderBy: { startedAt: 'desc' },
            select: { id: true, heartbeatAt: true, startedAt: true },
        }).catch(() => null)
        if (running) {
            const beat = new Date(running.heartbeatAt || running.startedAt).getTime()
            if (Date.now() - beat < 2 * 60_000) {
                res.status(409).json({ success: false, error: 'Đang có đợt đồng bộ chạy dở. Chờ xong rồi bấm lại.' })
                return
            }
            await store.sp.misaSyncLog.update({
                where: { id: running.id },
                data: { status: 'failed', finishedAt: new Date(), errors: 'Mất tín hiệu quá 2 phút — đã tự đóng.' },
            }).catch(() => { })
        }

        const log = await store.sp.misaSyncLog.create({
            data: {
                entity: entities.join(','), mode: 'manual', dryRun: !apply,
                fromDate, status: 'running', startedAt: new Date(), heartbeatAt: new Date(),
            },
        })
        res.json({
            success: true,
            data: {
                logId: log.id,
                cheDo: apply ? 'GHI THẬT' : 'CHẠY THỬ (không ghi gì)',
                entities,
                message: 'Đợt đồng bộ đã bắt đầu. Theo dõi ở bảng lịch sử bên dưới.',
            },
        })

        void chayDongBo(store.sp, cfg, entities, fromDate, apply, log.id).catch(async (e: any) => {
            await store.sp.misaSyncLog.update({
                where: { id: log.id },
                data: { status: 'failed', finishedAt: new Date(), errors: misaErr(e).slice(0, 2000) },
            }).catch(() => { })
        })
    } catch (e: any) {
        if (!res.headersSent) res.status(500).json({ success: false, error: errMsg(e) })
    }
})

async function chayDongBo(
    sp: any, cfg: any, entities: string[], fromDate: Date | null, apply: boolean, logId: string,
): Promise<void> {
    const base = await buildOptions(sp, cfg, apply)
    const creds = credsOf(cfg)
    const perEntity: Record<string, any> = {}
    const tong = newMisaCounters()

    let lastBeat = 0
    let dangLam: string | null = null
    const nhip = async (them = '') => {
        await sp.misaSyncLog.update({
            where: { id: logId },
            data: { heartbeatAt: new Date(), entity: `${entities.join(',')}${dangLam ? ` · ${them || 'đang xử lý'} ${dangLam}` : ''}` },
        }).catch(() => { })
    }
    const opts: MisaOptions = {
        ...base,
        onProgress: () => {
            const now = Date.now()
            if (now - lastBeat < 3000) return
            lastBeat = now
            void nhip()
        },
    }
    // Nhịp theo TỪNG TRANG tải: bước tải có thể kéo dài mà vòng xử lý chưa chạy
    const pageOpts = {
        onPage: async (_i: any[], fetched: number) => {
            const now = Date.now()
            if (now - lastBeat < 3000) return
            lastBeat = now
            await nhip(`đang tải ${fetched} bản ghi —`)
        },
    }

    const lastSync = misaTime(fromDate)

    for (const entity of entities) {
        const c = newMisaCounters()
        dangLam = entity
        await nhip('đang tải')
        try {
            if (entity === 'products') {
                const { items, truncated } = await MISA.danhMuc(creds, MISA_DATA_TYPE.VAT_TU, { last_sync_time: lastSync }, pageOpts)
                if (truncated) c.errors.push('Chạm trần 500 trang — thu hẹp mốc ngày rồi chạy tiếp')
                await syncMisaProducts(sp, items, opts, c)
            } else if (entity === 'partners') {
                const { items, truncated } = await MISA.danhMuc(creds, MISA_DATA_TYPE.DOI_TUONG, { last_sync_time: lastSync }, pageOpts)
                if (truncated) c.errors.push('Chạm trần 500 trang — thu hẹp mốc ngày rồi chạy tiếp')
                await syncMisaPartners(sp, items, opts, c)
            } else if (entity === 'stocks') {
                const { items } = await MISA.danhMuc(creds, MISA_DATA_TYPE.KHO, { last_sync_time: lastSync }, pageOpts)
                await syncMisaWarehouses(sp, items, opts, c)
            } else if (entity === 'balance') {
                const { items, truncated } = await MISA.tonKho(creds, { last_sync_time: lastSync }, pageOpts)
                if (truncated) c.errors.push('Chạm trần 500 trang — thu hẹp mốc ngày rồi chạy tiếp')
                await syncMisaStock(sp, items, opts, c)
            }
        } catch (e: any) {
            c.failed++
            c.errors.push(`${entity}: ${misaErr(e)}`.slice(0, 300))
        }

        perEntity[entity] = {
            layVe: c.fetched, taoMoi: c.created, capNhat: c.updated,
            boQua: c.skipped, loi: c.failed, mau: c.samples,
            loiChiTiet: c.errors.slice(0, 10), xong: true,
        }
        tong.fetched += c.fetched; tong.created += c.created; tong.updated += c.updated
        tong.skipped += c.skipped; tong.failed += c.failed
        tong.errors.push(...c.errors.map(x => `[${entity}] ${x}`))

        await sp.misaSyncLog.update({
            where: { id: logId },
            data: {
                fetched: tong.fetched, created: tong.created, updated: tong.updated,
                skipped: tong.skipped, failed: tong.failed,
                details: JSON.stringify(perEntity).slice(0, 60000),
                errors: tong.errors.join('\n').slice(0, 4000) || null,
                heartbeatAt: new Date(), attempts: 0,
            },
        }).catch(() => { })
    }

    await sp.misaSyncLog.update({
        where: { id: logId },
        data: {
            entity: entities.join(','),
            status: tong.failed ? 'partial' : 'success',
            fetched: tong.fetched, created: tong.created, updated: tong.updated,
            skipped: tong.skipped, failed: tong.failed,
            details: JSON.stringify(perEntity).slice(0, 60000),
            errors: tong.errors.join('\n').slice(0, 4000) || null,
            heartbeatAt: new Date(), finishedAt: new Date(),
        },
    }).catch(() => { })

    if (apply) {
        await sp.misaConfig.update({ where: { id: 'default' }, data: { lastSyncAt: new Date() } }).catch(() => { })
    }
}

// ─── GET /api/misa/logs?storeCode=&limit= ───────────────────────────────────
router.get('/logs', async (req: Request, res: Response) => {
    try {
        const store = await resolveStore(String(req.query.storeCode || ''))
        if (!store) { res.status(404).json({ success: false, error: 'Không tìm thấy cửa hàng' }); return }
        const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20))
        const logs = await store.sp.misaSyncLog.findMany({ orderBy: { startedAt: 'desc' }, take: limit }).catch(() => [])
        res.json({ success: true, data: logs })
    } catch (e: any) {
        res.status(500).json({ success: false, error: errMsg(e) })
    }
})

export default router
