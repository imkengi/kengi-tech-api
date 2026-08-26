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
import multer from 'multer'
import * as XLSX from 'xlsx'
import { registryPrisma, getStorePrisma } from '../lib/prisma'
import { errMsg } from '../lib/errorResponse'
import { cacheDel } from '../lib/cache'
import { docNhatKyTien, votTenKhach } from '../services/misaExcel'
import { createJournalEntriesForTransaction } from '../lib/autoJournal'
import { postImportReceiptJournal, refsOfImport } from '../lib/autoJournalPurchase'
import { doMuaHangMisa, tomTatMuaDeGhiLog } from '../services/misaImportMuaHang'
import {
    MISA, MISA_DATA_TYPE, MISA_DEBT_TYPE, misaTime, testMisaConnection, clearMisaToken,
    doDanhMuc, type MisaCreds,
} from '../services/misa'
import {
    newMisaCounters, syncMisaProducts, syncMisaPartners, syncMisaWarehouses, syncMisaStock,
    syncMisaDebt, syncMisaDeleted, type MisaOptions,
} from '../services/misaSync'
import { doBanHangMisa, tomTatDeGhiLog } from '../services/misaImportBanHang'

const router = Router()

const ADMIN_KEY = process.env.ADMIN_KEY
const JWT_SECRET = process.env.JWT_SECRET || ''
const PANEL_SCOPE = 'admin-panel'

/**
 * Thứ tự CÓ Ý NGHĨA: tồn kho tra vật tư theo mã và công nợ tra đối tượng theo
 * mã, nên vật tư/đối tượng phải xong trước. "deleted" chạy cuối cùng — ngừng
 * theo dõi một kho rồi mới tạo lại nó ở bước trên thì công cốc.
 */
export const MISA_ENTITIES = [
    'products', 'partners', 'stocks', 'balance', 'debtCustomer', 'debtSupplier', 'deleted',
] as const

/** Nhãn hiện trên nhật ký, để dòng log đọc được mà không phải tra code. */
export const MISA_ENTITY_LABEL: Record<string, string> = {
    products: 'Vật tư, hàng hoá',
    partners: 'Đối tượng (KH/NCC)',
    stocks: 'Danh mục kho',
    balance: 'Tồn kho',
    debtCustomer: 'Công nợ phải thu',
    debtSupplier: 'Công nợ phải trả',
    deleted: 'Danh mục đã xoá bên MISA',
    // Đổ từ Excel — không phải thực thể đồng bộ được, nhưng dùng chung nhật ký nên cần nhãn
    salesExcel: 'Bán hàng (đổ Excel)',
    purchasesExcel: 'Mua hàng (đổ Excel)',
    cashExcel: 'Thu/Chi tiền (đổ Excel)',
}

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
        overwriteDebt: !!cfg.overwriteDebt,
        negateDebt: !!cfg.negateDebt,
        defaultCategoryId: cfg.defaultCategoryId,
        defaultWarehouseId: cfg.defaultWarehouseId,
        lastSyncTime: cfg.lastSyncTime || null,
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
            'overwriteNames', 'overwritePrices', 'overwriteStock', 'overwriteDebt', 'negateDebt']) {
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
        overwriteDebt: !!cfg?.overwriteDebt,
        negateDebt: !!cfg?.negateDebt,
        defaultCategoryId: categoryId,
        defaultWarehouseId: warehouseId,
    }
}

// ─── GET /api/misa/probe?storeCode= ─────────────────────────────────────────
// Hỏi thẳng MISA xem mỗi data_type thật sự trả về danh mục nào. Có route này vì
// tài liệu tự mâu thuẫn (mục 2.4 gửi data_type=5 nhận về bản ghi KHO, mục 3.3
// nói 5 = hệ thống tài khoản). CHỈ ĐỌC, mỗi loại lấy đúng 1 bản ghi.
router.get('/probe', async (req: Request, res: Response) => {
    try {
        const store = await resolveStore(String(req.query.storeCode || ''))
        if (!store) { res.status(404).json({ success: false, error: 'Không tìm thấy cửa hàng' }); return }
        const cfg = await loadConfig(store.sp)
        if (!cfg) { res.status(400).json({ success: false, error: 'Chưa cấu hình MISA' }); return }

        const ketQua = await doDanhMuc(credsOf(cfg))
        const lech = ketQua.filter(r => r.doanLa && r.doanLa !== '(không nhận ra)' && r.doanLa !== r.nhanTheoTaiLieu)
        res.json({
            success: true,
            data: {
                ketQua,
                soLoaiLech: lech.length,
                canhBao: lech.length
                    ? `${lech.length} loại trả về KHÁC với tài liệu — sửa MISA_DATA_TYPE theo cột "đoán là" trước khi đồng bộ.`
                    : null,
            },
        })
    } catch (e: any) {
        res.status(500).json({ success: false, error: misaErr(e) })
    }
})

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

    /**
     * MỐC NGÀY CHỈ DÙNG CHO "DANH MỤC ĐÃ XOÁ" — đừng nới ra chỗ khác.
     *
     * Đã trả giá hai lần cho bài học này (KiotViet rồi MISA): lọc ngày lên
     * DANH MỤC thì dữ liệu phụ thuộc gãy hết. Đợt chạy thử 09/08/2026 của
     * HUTITAX chọn "từ 01/01/2026" và nhận: 0 kho (kho tạo lâu rồi, sau mốc
     * không sửa gì), 128/312 đối tượng, rồi 1801 dòng tồn kho + 312 dòng công
     * nợ "không tìm thấy mã bên Kengi" — vì chính những mã đó chưa được kéo về.
     *
     * Nên:
     *   danh mục (vật tư/đối tượng/kho) → LUÔN lấy trọn bộ
     *   tồn kho, công nợ               → là SỐ DƯ HIỆN TẠI, lấy trọn bộ; lấy
     *                                    phần chênh thì mã không phát sinh giữ
     *                                    số cũ sai
     *   danh mục đã xoá                → mới đúng là thứ cần lọc theo ngày
     */
    const mocXoa = fromDate ? misaTime(fromDate) : (cfg?.lastSyncTime || null)
    let mocMoi: string | null = null
    const ghiMoc = (v: string | null) => { if (v) mocMoi = v }

    for (const entity of entities) {
        const c = newMisaCounters()
        dangLam = MISA_ENTITY_LABEL[entity] || entity
        await nhip('đang tải')
        try {
            if (entity === 'products') {
                const r = await MISA.danhMuc(creds, MISA_DATA_TYPE.VAT_TU, { last_sync_time: null }, pageOpts)
                if (r.truncated) c.errors.push('Chạm trần 500 trang — danh mục vật tư quá lớn')
                ghiMoc(r.lastSyncTime)
                await syncMisaProducts(sp, r.items, opts, c)
            } else if (entity === 'partners') {
                const r = await MISA.danhMuc(creds, MISA_DATA_TYPE.DOI_TUONG, { last_sync_time: null }, pageOpts)
                if (r.truncated) c.errors.push('Chạm trần 500 trang — danh mục đối tượng quá lớn')
                ghiMoc(r.lastSyncTime)
                await syncMisaPartners(sp, r.items, opts, c)
            } else if (entity === 'stocks') {
                const r = await MISA.danhMuc(creds, MISA_DATA_TYPE.KHO, { last_sync_time: null }, pageOpts)
                ghiMoc(r.lastSyncTime)
                await syncMisaWarehouses(sp, r.items, opts, c)
            } else if (entity === 'balance') {
                const r = await MISA.tonKho(creds, { last_sync_time: null }, pageOpts)
                if (r.truncated) c.errors.push('Chạm trần 500 trang — dữ liệu tồn kho quá lớn')
                ghiMoc(r.lastSyncTime)
                await syncMisaStock(sp, r.items, opts, c)
            } else if (entity === 'debtCustomer' || entity === 'debtSupplier') {
                const loai = entity === 'debtCustomer' ? MISA_DEBT_TYPE.PHAI_THU : MISA_DEBT_TYPE.PHAI_TRA
                const r = await MISA.congNo(creds, loai, { last_sync_time: null }, pageOpts)
                if (r.truncated) c.errors.push('Chạm trần 500 trang — dữ liệu công nợ quá lớn')
                await syncMisaDebt(sp, r.items, loai, opts, c)
            } else if (entity === 'deleted') {
                // Chỗ DUY NHẤT dùng mốc ngày — chỉ cần biết cái gì mới bị xoá
                for (const dt of [MISA_DATA_TYPE.DOI_TUONG, MISA_DATA_TYPE.VAT_TU, MISA_DATA_TYPE.KHO]) {
                    const r = await MISA.danhMucDaXoa(creds, dt, { last_sync_time: mocXoa }, pageOpts)
                    await syncMisaDeleted(sp, r.items, opts, c)
                }
            }
        } catch (e: any) {
            c.failed++
            c.errors.push(`${entity}: ${misaErr(e)}`.slice(0, 300))
        }

        perEntity[entity] = {
            ten: MISA_ENTITY_LABEL[entity] || entity,
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
        await sp.misaConfig.update({
            where: { id: 'default' },
            // Chỉ nhích mốc nước khi GHI THẬT — chạy thử mà nhích thì lần sau
            // lấy thiếu đúng phần vừa xem
            data: { lastSyncAt: new Date(), ...(mocMoi ? { lastSyncTime: mocMoi } : {}) },
        }).catch(() => { })
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

/* ═══════════════════════════════════════════════════════════════════════════
   ĐỔ EXCEL — mua hàng & bán hàng MISA KHÔNG có API, chỉ xuất Excel được.
   Cửa hàng lấy từ `storeCode` gửi lên, KHÔNG gắn cứng cửa hàng nào.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Trong bộ nhớ, 10MB — theo đúng khuôn `importData.ts` đang dùng. */
const uploadExcel = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } })

/**
 * POST /api/misa/import-sales   (multipart: file, storeCode, apply)
 *
 * MẶC ĐỊNH CHẠY THỬ. Phải gửi `apply=true` mới ghi — giống `/sync`. Chạy thử trả về
 * ĐÚNG những con số mà lượt ghi thật sẽ tạo ra, để người bấm nhìn trước rồi mới quyết.
 */
router.post('/import-sales', uploadExcel.single('file'), async (req: Request, res: Response) => {
    try {
        const b: any = req.body || {}
        const store = await resolveStore(String(b.storeCode || ''))
        if (!store) { res.status(404).json({ success: false, error: 'Không tìm thấy cửa hàng' }); return }
        if (!req.file?.buffer?.length) {
            res.status(400).json({ success: false, error: 'Chưa chọn file Excel' }); return
        }

        // codepage 65001: file MISA có dấu tiếng Việt, đọc sai bảng mã là hỏng hết tên hàng/tên khách
        let rows: any[][]
        let tenSheet = ''
        try {
            const wb = XLSX.read(req.file.buffer, { type: 'buffer', codepage: 65001, raw: false })
            tenSheet = wb.SheetNames[0] || ''
            if (!tenSheet) throw new Error('file không có sheet nào')
            rows = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[tenSheet]!, { header: 1, raw: false, defval: '' })
        } catch (e: any) {
            // Hỏng khi MỞ file khác hẳn với "file không có dữ liệu" — đừng gộp hai thứ làm một.
            res.status(400).json({ success: false, error: `Không mở được file Excel: ${errMsg(e)}` }); return
        }

        const apply = b.apply === true || b.apply === 'true'
        const kq = await doBanHangMisa(store.sp, rows, {
            tenFile: req.file.originalname || 'không rõ tên',
            apply,
            userId: (req as any).user?.userId || null,
            userName: (req as any).user?.email || 'admin-panel',
        })

        // Ghi nhật ký chung với các lượt đồng bộ khác, để một chỗ xem được cả hai đường.
        await store.sp.misaSyncLog.create({
            data: {
                entity: 'salesExcel',
                mode: 'excel',
                dryRun: !apply,
                // Đọc hỏng file phải ra 'error', KHÔNG phải 'success' với 0 dòng.
                status: kq.tieuDeThieu.length ? 'error' : 'success',
                errors: kq.tieuDeThieu.length
                    ? `Thiếu cột bắt buộc: ${kq.tieuDeThieu.join(', ')}`
                    : (kq.canhBao.length ? kq.canhBao.join(' · ').slice(0, 4000) : null),
                fetched: kq.tongDong,
                created: kq.chungTuMoi,
                updated: kq.chungTuCapNhat,
                skipped: kq.boQua,
                failed: kq.tieuDeThieu.length ? 1 : 0,
                details: JSON.stringify(tomTatDeGhiLog(kq)),
                startedAt: new Date(),
                finishedAt: new Date(),
            },
        }).catch(() => { /* nhật ký hỏng không được làm hỏng lượt đổ */ })

        res.json({ success: true, sheet: tenSheet, store: store.name, ...kq })
    } catch (e: any) {
        res.status(500).json({ success: false, error: errMsg(e) })
    }
})

/** GET /api/misa/import-batches?storeCode=&loai=sales — các lượt đã đổ, mới nhất trước. */
router.get('/import-batches', async (req: Request, res: Response) => {
    try {
        const store = await resolveStore(String(req.query.storeCode || ''))
        if (!store) { res.status(404).json({ success: false, error: 'Không tìm thấy cửa hàng' }); return }
        const loai = String(req.query.loai || '') || undefined
        const items = await store.sp.misaImportBatch.findMany({
            where: loai ? { loai } : {},
            orderBy: { createdAt: 'desc' },
            take: Math.min(Number(req.query.limit) || 30, 100),
        })
        res.json({ success: true, items })
    } catch (e: any) {
        res.status(500).json({ success: false, error: errMsg(e) })
    }
})

/**
 * GET /api/misa/sales?storeCode=&from=&to=  — đọc lại sổ MISA đã đổ.
 *
 * Kèm `doPhu`: đọc được bao nhiêu / bỏ bao nhiêu của lượt đổ gần nhất. Con số tổng mà
 * không kèm độ phủ thì không dùng để kết luận được — đó là bài học của cả tháng này.
 */
router.get('/sales', async (req: Request, res: Response) => {
    try {
        const store = await resolveStore(String(req.query.storeCode || ''))
        if (!store) { res.status(404).json({ success: false, error: 'Không tìm thấy cửa hàng' }); return }

        const where: any = {}
        if (req.query.from) where.ngayChungTu = { gte: new Date(`${req.query.from}T00:00:00+07:00`) }
        if (req.query.to) {
            where.ngayChungTu = { ...(where.ngayChungTu || {}), lte: new Date(`${req.query.to}T23:59:59+07:00`) }
        }

        const items = await store.sp.misaSaleDoc.findMany({
            where,
            orderBy: { ngayChungTu: 'desc' },
            take: Math.min(Number(req.query.limit) || 200, 1000),
            include: req.query.chiTiet === 'true' ? { lines: true } : undefined,
        })
        const tong = await store.sp.misaSaleDoc.aggregate({
            where, _sum: { tongDoanhSo: true, tongThue: true }, _count: true,
        })
        const lanCuoi = await store.sp.misaImportBatch.findFirst({
            where: { loai: 'sales', apply: true }, orderBy: { createdAt: 'desc' },
        })

        res.json({
            success: true,
            items,
            tongChungTu: tong._count,
            tongDoanhSo: tong._sum.tongDoanhSo || 0,
            tongThue: tong._sum.tongThue || 0,
            doPhu: lanCuoi
                ? {
                    tenFile: lanCuoi.tenFile, kyBaoCao: lanCuoi.kyBaoCao, luc: lanCuoi.createdAt,
                    docDuoc: lanCuoi.docDuoc, tongDong: lanCuoi.tongDong, boQua: lanCuoi.boQua,
                }
                : null,
        })
    } catch (e: any) {
        res.status(500).json({ success: false, error: errMsg(e) })
    }
})

/**
 * GET /api/misa/doi-chieu?storeCode=&from=&to=  — SO SỔ MISA VỚI SỔ KENGI
 *
 * Đây mới là lý do đổ Excel: có hai sổ rồi thì phải so được. Ba cái bẫy đã cài sẵn cách tránh,
 * đừng gỡ ra:
 *
 *  1. **Bẫy VAT.** Cột "Doanh số bán" của MISA là **TRƯỚC thuế**; `Transaction.total` của Kengi
 *     là **ĐÃ GỒM thuế**. So thẳng hai số đó là so nhầm đơn vị — trên mẫu 21/08 lệch giả
 *     đúng 114.770.032đ. Ở đây quy cả hai về **trước thuế** rồi mới trừ.
 *  2. **Bẫy đơn bán chịu.** Đơn ghi nợ có status `'partial'`. Lọc mỗi `'completed'` là hụt doanh
 *     thu âm thầm — từng tố oan 677tr (xem [[revenue-includes-credit-sales]]).
 *  3. **Bẫy ngày.** `transactionDate` là ngày bán thật, `createdAt` là lúc nhập dòng; KENGISTORE
 *     nhập từ KiotViet nên hai cái lệch nhau. Trả về CẢ HAI cách cắt kỳ để nhìn thấy độ lệch
 *     thay vì chọn hộ một cái rồi giấu cái kia.
 */
/**
 * CÂN ĐỐI TỒN ĐẦU KỲ cho cửa hàng GƯƠNG (26/08/2026, chủ shop: "khi có phiếu
 * bán hàng thì tồn kho phải trừ vào").
 *
 * Bài toán: Product.stock của cửa hàng gương là ẢNH CHỤP tồn từ đồng bộ MISA
 * (thẩm quyền), và chứng từ tháng đang đổ ĐÃ NẰM TRONG ảnh chụp đó — cộng/trừ
 * thẳng vào stock là đếm trùng. Nhưng thẻ kho vẫn phải kể được chuyện nhập/bán.
 *
 * Lời giải kế toán: mỗi sản phẩm một dòng "Tồn đầu kỳ" = stock − Σ(biến động
 * chứng từ). Thẻ kho thành: tồn đầu kỳ + nhập − bán = ĐÚNG tồn hiện tại. Đổ
 * thêm tháng cũ (data 7 sau data 8) → Σ đổi → dòng đầu kỳ TỰ co lại, tổng bất
 * biến. Product.stock KHÔNG bị đụng — MISA vẫn là thẩm quyền tồn.
 */
async function canDoiTonDauKyGuong(sp: any): Promise<{ taoMoi: number; capNhat: number }> {
    const kq = { taoMoi: 0, capNhat: 0 }
    // Tuần tự — PROD PRISMA_POOL_SIZE=1
    const products = await sp.product.findMany({ select: { id: true, sku: true, name: true, stock: true } })
    /* Tru MOI dong tru chinh dong ton dau ky — cua hang guong co the mang
     * dong 'adjustment' cu cua dong bo ton MISA; chi tru sale+import la plug
     * dem thieu va tong the kho phong gap doi (do 26/08: 645.963 vs 322.983). */
    const sums = await sp.inventoryTransaction.groupBy({
        by: ['productId'], _sum: { quantity: true },
        where: { referenceType: { not: 'misa_opening' } },
    }).catch(() => [] as any[])
    const dauKyCu = await sp.inventoryTransaction.findMany({
        where: { referenceType: 'misa_opening' },
        select: { id: true, productId: true, quantity: true },
    })
    const minRow = await sp.inventoryTransaction.findFirst({
        where: { referenceType: { not: 'misa_opening' } },
        orderBy: { createdAt: 'asc' }, select: { createdAt: true },
    })
    const mapSum = new Map<string, number>((sums as any[]).map((x: any) => [String(x.productId), Number(x._sum?.quantity) || 0]))
    const mapCu = new Map<string, { id: string; quantity: number }>(dauKyCu.map((x: any) => [String(x.productId), x]))
    // Mốc: một ngày trước chứng từ sớm nhất — luỹ kế thẻ kho mở màn bằng tồn đầu kỳ
    const mocTDK = minRow ? new Date(new Date(minRow.createdAt).getTime() - 86400000) : new Date()

    for (const p of products) {
        const mong = (Number(p.stock) || 0) - (mapSum.get(p.id) ?? 0)
        const cu = mapCu.get(p.id)
        if (!cu) {
            if (mong === 0) continue
            await sp.inventoryTransaction.create({
                data: {
                    type: 'adjustment', productId: p.id, productName: p.name, productSku: p.sku,
                    quantity: mong, reason: 'Tồn đầu kỳ (cân đối với tồn MISA)',
                    referenceId: 'MISA-TDK', referenceType: 'misa_opening',
                    userName: 'Sổ MISA', createdAt: mocTDK,
                },
            })
            kq.taoMoi++
        } else if (Number(cu.quantity) !== mong) {
            await sp.inventoryTransaction.update({
                where: { id: cu.id }, data: { quantity: mong, createdAt: mocTDK },
            })
            kq.capNhat++
        }
    }
    return kq
}

// ─── POST /api/misa/do-thanh-don-ban ────────────────────────────────────────
/**
 * ĐỔ SỔ MISA THÀNH ĐƠN BÁN THẬT của một cửa hàng GƯƠNG (25/08/2026, chủ shop
 * chốt cho HUTITAX: "Thành đơn bán thật của HUTITAX").
 *
 * VÌ SAO ĐƯỢC PHÉP dù quy tắc 21/08 là "sổ MISA lưu riêng, không tạo Transaction
 * kẻo đếm trùng": quy tắc đó bảo vệ cửa hàng CÓ bán POS. Cửa hàng gương như
 * HUTITAX không có một đơn POS nào — sổ MISA chính LÀ doanh thu của nó. RÀO CỨNG
 * bên dưới: từ chối chạy nếu cửa hàng có bất kỳ đơn nào không mang mã MISA-.
 *
 * Quy ước ghi:
 *   - receiptNumber = 'MISA-<số chứng từ>' (unique) — chống trùng: chạy lại là
 *     CẬP NHẬT + dựng lại dòng hàng, không nhân đôi.
 *   - createdAt = transactionDate = NGÀY CHỨNG TỪ — dồn về hôm nay là báo cáo
 *     ngày nổ tung (bài học KV: createdAt = lúc nhập từng làm lệch báo cáo).
 *   - amountReceived = total, status 'completed' — sổ chi tiết bán hàng MISA
 *     KHÔNG ghi hình thức/tiến độ thu tiền; ghi chú nói rõ điều đó trên từng đơn.
 *   - KHÔNG đụng tồn kho, KHÔNG ghi InventoryTransaction/Payment — chỉ doanh thu.
 *   - Sản phẩm/khách thiếu thì tạo mới (costPrice 0 = CHƯA CÓ giá vốn — lãi/lỗ
 *     của cửa hàng gương không dùng được, MISA không xuất giá vốn).
 *
 * Body: { storeCode, apply?: true } — mặc định CHẠY THỬ.
 */
router.post('/do-thanh-don-ban', async (req: Request, res: Response) => {
    try {
        const b: any = req.body || {}
        const store = await registryPrisma.store.findFirst({
            where: { code: { equals: String(b.storeCode || ''), mode: 'insensitive' } },
            select: { code: true, name: true, schema: true },
        })
        if (!store) { res.status(404).json({ success: false, error: 'Không tìm thấy cửa hàng' }); return }
        const sp: any = getStorePrisma(store.schema)
        const apply = b.apply === true || b.apply === 'true'

        // RÀO: cửa hàng đã có đơn POS thật thì tuyệt đối không đổ — đếm trùng doanh thu
        const soDonNgoai = await sp.transaction.count({
            where: { NOT: { receiptNumber: { startsWith: 'MISA-' } } },
        })
        if (soDonNgoai > 0) {
            res.status(400).json({
                success: false,
                error: `Cửa hàng ${store.code} có ${soDonNgoai} đơn bán KHÔNG phải từ MISA — đổ thêm sổ MISA vào là đếm trùng doanh thu. Chỉ chạy trên cửa hàng gương (0 đơn POS).`,
            })
            return
        }

        const user = await sp.user.findFirst({
            where: { role: { in: ['admin', 'owner', 'manager'] } },
            orderBy: { createdAt: 'asc' }, select: { id: true },
        })
        if (!user?.id) { res.status(400).json({ success: false, error: 'Cửa hàng chưa có tài khoản admin/manager để đứng tên đơn (createdBy là khoá ngoại bắt buộc)' }); return }

        const docs = await sp.misaSaleDoc.findMany({
            include: { lines: true },
            orderBy: { ngayChungTu: 'asc' },
        })
        if (!docs.length) { res.json({ success: true, store: store.code, thongBao: 'Chưa có chứng từ MISA nào — đổ Excel trước đã' }); return }

        // Nhóm hàng đích cho sản phẩm phải tạo mới
        let categoryId: string | null = (await sp.category.findFirst({ select: { id: true }, orderBy: { createdAt: 'asc' } }))?.id || null
        if (!categoryId && apply) {
            categoryId = (await sp.category.create({ data: { name: 'MISA' }, select: { id: true } })).id
        }

        /* BẰNG CHỨNG THU TIỀN (26/08/2026, chủ shop: "tất cả phải có phiếu thu
         * mới tính"): đơn CHỈ được ghi nhận đã thu đúng bằng phần phiếu thu khớp
         * được — ba tầng khớp, chặt trước lỏng sau:
         *   1. trùng số chứng từ (PT bán lẻ = chính phiếu thu của nó)
         *   2. diễn giải phiếu thu nhắc số hoá đơn/số chứng từ của đơn
         *   3. cùng ngày + cùng số tiền, và cặp (ngày, tiền) là DUY NHẤT ở cả
         *      hai phía — trùng lặp thì thà bỏ khớp còn hơn khớp bừa
         * Không khớp được thì đơn là BÁN CHỊU: status partial, treo công nợ 131. */
        const dsThuBc = await sp.cashReceipt.findMany({
            where: { reference: { startsWith: 'MISA-' } },
            select: { reference: true, amount: true, date: true, description: true },
        })
        const thuTheoRef = new Map<string, any>()
        const thuTheoSo = new Map<string, any[]>()
        const thuTheoNgayTien = new Map<string, any[]>()
        const reSo = /\b(BH\d{4,}|PT\d{4,}|\d{5,8})\b/g
        for (const t of dsThuBc) {
            ;(t as any).daDung = false
            thuTheoRef.set(String(t.reference), t)
            for (const m of String(t.description || '').match(reSo) || []) {
                const k = m.replace(/^0+/, '')
                if (!thuTheoSo.has(k)) thuTheoSo.set(k, [])
                thuTheoSo.get(k)!.push(t)
            }
            const kNT = `${new Date(t.date).toISOString().slice(0, 10)}|${Math.round(Number(t.amount) || 0)}`
            if (!thuTheoNgayTien.has(kNT)) thuTheoNgayTien.set(kNT, [])
            thuTheoNgayTien.get(kNT)!.push(t)
        }
        // Cặp (ngày, tiền) phía ĐƠN cũng phải duy nhất mới được khớp tầng 3
        const demDonNgayTien = new Map<string, number>()
        for (const d of docs) {
            const ng = d.ngayChungTu || d.ngayHachToan || d.createdAt
            const t = (d.tongDoanhSo || 0) - (d.tongChietKhau || 0) - (d.tongTra || 0) + (d.tongThue || 0)
            const k = `${ng.toISOString().slice(0, 10)}|${Math.round(t)}`
            demDonNgayTien.set(k, (demDonNgayTien.get(k) || 0) + 1)
        }

        const kq = {
            donMoi: 0, donCapNhat: 0, donCoHoaDon: 0, khachMoi: 0, khachDaCo: 0, spMoi: 0, spDaCo: 0,
            butToanMoi: 0, dongTheKho: 0, donThuKhop: 0, donBanChiu: 0, tienThuKhop: 0,
            tongTien: 0, tuNgay: null as string | null, denNgay: null as string | null,
            canhBao: [] as string[], viDu: [] as string[],
        }
        const khachMoiTao = new Map<string, string>()   // tên thường → customerId
        const spMoiTao = new Map<string, string>()       // sku → productId
        let demKhach = 0

        for (const doc of docs) {
            const rn = `MISA-${doc.soChungTu}`
            const ngay = doc.ngayChungTu || doc.ngayHachToan || doc.createdAt
            const tien = (doc.tongDoanhSo || 0) - (doc.tongChietKhau || 0) - (doc.tongTra || 0) + (doc.tongThue || 0)
            kq.tongTien += tien
            const iso = ngay.toISOString().slice(0, 10)
            if (!kq.tuNgay || iso < kq.tuNgay) kq.tuNgay = iso
            if (!kq.denNgay || iso > kq.denNgay) kq.denNgay = iso

            // ── Khách: khớp theo mã (MST) trước, rồi theo tên; thiếu thì tạo ──
            let customerId: string | null = doc.customerId || null
            const tenKhach = (doc.tenKhach || '').trim()
            if (!customerId && tenKhach) {
                const khoaTen = tenKhach.toLowerCase()
                customerId = khachMoiTao.get(khoaTen) || null
                if (!customerId) {
                    const cu = doc.maKhach
                        ? await sp.customer.findFirst({ where: { code: doc.maKhach }, select: { id: true } })
                        : null
                    const cu2 = cu || await sp.customer.findFirst({
                        where: { name: { equals: tenKhach, mode: 'insensitive' } }, select: { id: true },
                    })
                    if (cu2?.id) { customerId = cu2.id; kq.khachDaCo++ }
                    else if (apply) {
                        demKhach++
                        const tao = await sp.customer.create({
                            data: {
                                code: doc.maKhach || `MISA-KH-${Date.now().toString(36)}-${demKhach}`,
                                name: tenKhach, phone: '',
                                notes: doc.nguonTenKhach === 'dienGiai' ? 'Tên vớt từ diễn giải MISA — soát lại' : 'Tạo từ sổ MISA',
                            }, select: { id: true },
                        })
                        customerId = tao.id
                        kq.khachMoi++
                    } else { kq.khachMoi++ }
                    if (customerId) khachMoiTao.set(khoaTen, customerId)
                }
            }

            // ── Dòng hàng: khớp SKU, thiếu thì tạo (giá vốn 0 = CHƯA CÓ) ──
            const items: any[] = []
            for (const l of doc.lines || []) {
                // Cùng bệnh với sổ mua: dòng doanh số ÂM (chiết khấu) không được vứt
                if (!(Number(l.soLuong) || 0) && !(Number(l.doanhSo) || 0) && !(Number(l.giaTriTra) || 0)) continue
                const soLuongTho = Math.round(Number(l.soLuong) || 0)
                const soLuong = soLuongTho >= 1 ? soLuongTho : ((Number(l.doanhSo) || 0) > 0 ? 1 : 0)
                let productId = l.productId || spMoiTao.get(l.maHang) || null
                if (!productId) {
                    const p = await sp.product.findUnique({ where: { sku: l.maHang }, select: { id: true } })
                    if (p?.id) { productId = p.id; kq.spDaCo++ }
                    else if (apply && categoryId) {
                        const tao = await sp.product.create({
                            data: {
                                sku: l.maHang, name: l.tenHang || l.maHang, categoryId,
                                sellingPrice: Number(l.donGia) || 0, costPrice: 0,
                                baseUnit: l.dvt || 'cái', stock: 0,
                                description: 'Tạo từ sổ MISA (chưa có giá vốn)',
                            }, select: { id: true },
                        })
                        productId = tao.id
                        kq.spMoi++
                    } else { kq.spMoi++; continue }
                    if (productId) spMoiTao.set(l.maHang, productId)
                }
                if (Math.abs(soLuong - (Number(l.soLuong) || 0)) > 0.001) {
                    if (kq.canhBao.length < 8) kq.canhBao.push(`${doc.soChungTu}/${l.maHang}: số lượng lẻ ${l.soLuong} làm tròn ${soLuong} (tiền giữ theo sổ, không theo SL×đơn giá)`)
                }
                items.push({
                    productId, productName: l.tenHang || l.maHang, sku: l.maHang,
                    quantity: soLuong, unitPrice: Number(l.donGia) || 0,
                    discount: Number(l.chietKhau) || 0,
                    lineTotal: (Number(l.doanhSo) || 0) - (Number(l.chietKhau) || 0) - (Number(l.giamGia) || 0) - (Number(l.giaTriTra) || 0),
                })
            }

            // ── Khớp phiếu thu (3 tầng — xem chú thích đầu hàm) ──
            const bangChung: any[] = []
            const tw = thuTheoRef.get(rn)
            if (tw && !tw.daDung) { bangChung.push(tw); tw.daDung = true }
            for (const kSo of [String(doc.soHoaDon || '').replace(/^0+/, ''), doc.soChungTu]) {
                if (!kSo) continue
                for (const t of thuTheoSo.get(kSo) || []) {
                    if (!t.daDung) { bangChung.push(t); t.daDung = true }
                }
            }
            if (!bangChung.length) {
                const kNT = `${ngay.toISOString().slice(0, 10)}|${Math.round(tien)}`
                const ung = (thuTheoNgayTien.get(kNT) || []).filter((t: any) => !t.daDung)
                if (ung.length === 1 && demDonNgayTien.get(kNT) === 1) { bangChung.push(ung[0]); ung[0].daDung = true }
            }
            const daThu = Math.min(tien, bangChung.reduce((a, t) => a + (Number(t.amount) || 0), 0))
            const thuDu = daThu >= tien - 1
            if (bangChung.length) { kq.donThuKhop++; kq.tienThuKhop += daThu } else { kq.donBanChiu++ }

            const duLieu = {
                customerId, customerName: tenKhach || null,
                subtotal: (doc.tongDoanhSo || 0) - (doc.tongChietKhau || 0),
                tax: doc.tongThue || 0,
                total: tien, amountReceived: daThu,
                status: thuDu ? 'completed' : 'partial', channel: 'direct',
                createdBy: user.id, createdByName: 'Sổ MISA',
                notes: `Đổ từ sổ MISA${doc.soHoaDon ? ` — HĐ ${doc.soHoaDon}` : ''}` + (bangChung.length
                    ? ` · khớp phiếu thu ${bangChung.map((t: any) => String(t.reference).replace('MISA-', '')).join(', ')}`
                    : ' · BÁN CHỊU — chưa khớp được phiếu thu nào (treo 131)'),
                transactionDate: ngay, createdAt: ngay,
                /* Sổ MISA CÓ số hoá đơn nghĩa là hoá đơn ĐÃ XUẤT bên MISA/CQT —
                 * để mặc định 'none' là màn hình gào "chưa xuất VAT" trên đơn đã
                 * có HĐ (chủ shop bắt được ngay 25/08). PT không số HĐ giữ 'none'. */
                vatStatus: doc.soHoaDon ? 'issued' : 'none',
                vatInvoiceNumber: doc.soHoaDon || null,
                vatIssuedAt: doc.soHoaDon ? (doc.ngayHoaDon || ngay) : null,
            }
            if (doc.soHoaDon) kq.donCoHoaDon++

            if (apply) {
                const cu = await sp.transaction.findUnique({ where: { receiptNumber: rn }, select: { id: true } })
                if (cu) {
                    // Dựng lại bản ghi con theo nguồn — cập nhật nửa vời là sổ cũ sổ mới trộn nhau
                    await sp.transactionItem.deleteMany({ where: { transactionId: cu.id } })
                    await sp.transaction.update({ where: { id: cu.id }, data: { ...duLieu, items: { create: items } } })
                    kq.donCapNhat++
                } else {
                    await sp.transaction.create({ data: { ...duLieu, receiptNumber: rn, items: { create: items } } })
                    kq.donMoi++
                }
                if (customerId && !doc.customerId) {
                    await sp.misaSaleDoc.update({ where: { id: doc.id }, data: { customerId } }).catch(() => null)
                }
                /* HẠCH TOÁN NGAY TẠI ĐÂY (26/08/2026, chủ shop: "phiếu có GTGT là
                 * hạch toán vào hết"): bộ đổ ghi thẳng DB nên né mất móc hạch toán
                 * của route POS — 74 đơn đầu tiên từng nằm ngoài sổ kế toán vì thế.
                 * Helper idempotent theo reference (SALE-/VAT-/COGS-…) nên chạy lại
                 * không nhân đôi; đổ thêm tháng cũ là tự vào sổ, khỏi bấm gì thêm. */
                /* THẺ KHO: phiếu bán trừ kho (dòng âm, đúng ngôn ngữ POS). Xoá-ghi-lại
                 * theo mã đơn nên đổ lại không nhân đôi; tồn tổng do dòng tồn đầu kỳ
                 * cân đối ở cuối lượt — xem canDoiTonDauKyGuong. */
                await sp.inventoryTransaction.deleteMany({ where: { referenceId: rn, referenceType: 'sale' } })
                for (const it of items) {
                    if (!(it.quantity > 0)) continue
                    await sp.inventoryTransaction.create({
                        data: {
                            type: 'sale', productId: it.productId, productName: it.productName,
                            productSku: it.sku, quantity: -it.quantity,
                            reason: `Bán hàng - ${rn} (sổ MISA)`,
                            referenceId: rn, referenceType: 'sale',
                            unitPrice: it.unitPrice || 0, userName: 'Sổ MISA', createdAt: ngay,
                        },
                    })
                    kq.dongTheKho++
                }
                /* Cửa hàng gương tái sinh được từ sổ nguồn → XOÁ bút toán cũ của đơn
                 * rồi ghi lại (đảo VOID- giữ ref gốc làm lượt ghi lại bị bỏ qua —
                 * postReversal dành cho huỷ đơn thật, không dành cho tái đổ). */
                await sp.journalEntry.deleteMany({
                    where: {
                        OR: [
                            { reference: { in: [`SALE-${rn}`, `VAT-${rn}`, `DISC-${rn}`, `COGS-${rn}`] } },
                            { reference: { startsWith: `COLLECT-${rn}` } },
                            { reference: { in: [`VOID-SALE-${rn}`, `VOID-VAT-${rn}`, `VOID-DISC-${rn}`, `VOID-COGS-${rn}`] } },
                            { reference: { startsWith: `VOID-COLLECT-${rn}` } },
                        ],
                    },
                }).catch(() => null)
                const txBt = await sp.transaction.findUnique({
                    where: { receiptNumber: rn },
                    include: { payments: true, items: { include: { product: { select: { costPrice: true } } } } },
                })
                if (txBt) {
                    const bt = await createJournalEntriesForTransaction(sp, txBt as any, { userId: user.id })
                        .catch((e: any) => { console.error('[misa] but toan don', rn, e?.message); return { created: [] } })
                    kq.butToanMoi += bt.created.length
                }
            } else {
                const cu = await sp.transaction.findUnique({ where: { receiptNumber: rn }, select: { id: true } })
                if (cu) kq.donCapNhat++; else kq.donMoi++
            }
            if (kq.viDu.length < 5) kq.viDu.push(`${rn} · ${iso} · ${tenKhach || '(không tên)'} · ${Math.round(tien).toLocaleString('vi-VN')}đ · ${items.length} dòng`)
        }

        if (apply) {
            const tdk = await canDoiTonDauKyGuong(sp)
            ;(kq as any).tonDauKy = tdk
            // Đơn mới phải hiện ngay trên Tổng Quan/Báo Cáo — cache 300s không được che
            await cacheDel(`${store.schema}:*:dashboard:*`).catch(() => { })
            await cacheDel(`${store.schema}:dashboard:*`).catch(() => { })
            await cacheDel(`${store.schema}:*:transactions:*`).catch(() => { })
        }
        kq.canhBao.unshift('MISA không xuất giá vốn — lãi/lỗ của cửa hàng gương KHÔNG dùng được, chỉ tin doanh thu/thuế')

        res.json({ success: true, store: store.code, apply, soChungTu: docs.length, ...kq })
    } catch (e: any) {
        /* Lượt apply đầu 25/08 trả 500 mà KHÔNG để lại vết gì trong log (errMsg
         * che sạch) trong khi dữ liệu đã vào đủ — không log nguyên văn thì không
         * bao giờ biết đã nổ ở đâu. */
        console.error('[misa] do-thanh-don-ban:', e?.message || e, e?.stack?.split('\n')[1] || '')
        res.status(500).json({ success: false, error: errMsg(e) })
    }
})

// ─── POST /api/misa/import-purchases ────────────────────────────────────────
/** Đổ Excel "Sổ chi tiết mua hàng" — song sinh với /import-sales. */
router.post('/import-purchases', uploadExcel.single('file'), async (req: Request, res: Response) => {
    try {
        const b: any = req.body || {}
        const store = await resolveStore(String(b.storeCode || ''))
        if (!store) { res.status(404).json({ success: false, error: 'Không tìm thấy cửa hàng' }); return }
        if (!req.file?.buffer?.length) { res.status(400).json({ success: false, error: 'Chưa chọn file Excel' }); return }
        let rows: any[][]
        let tenSheet = ''
        try {
            const wb = XLSX.read(req.file.buffer, { type: 'buffer', codepage: 65001, raw: false })
            tenSheet = wb.SheetNames[0] || ''
            if (!tenSheet) throw new Error('file không có sheet nào')
            rows = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[tenSheet]!, { header: 1, raw: false, defval: '' })
        } catch (e: any) {
            res.status(400).json({ success: false, error: `Không mở được file Excel: ${errMsg(e)}` }); return
        }
        const apply = b.apply === true || b.apply === 'true'
        const kq = await doMuaHangMisa(store.sp, rows, {
            tenFile: req.file.originalname || 'không rõ tên', apply,
            userId: (req as any).user?.userId || null,
            userName: (req as any).user?.email || 'admin-panel',
        })
        await store.sp.misaSyncLog.create({
            data: {
                entity: 'purchasesExcel', mode: 'excel', dryRun: !apply,
                status: kq.tieuDeThieu.length ? 'error' : 'success',
                errors: kq.tieuDeThieu.length
                    ? `Thiếu cột bắt buộc: ${kq.tieuDeThieu.join(', ')}`
                    : (kq.canhBao.length ? kq.canhBao.join(' · ').slice(0, 4000) : null),
                fetched: kq.tongDong, created: kq.chungTuMoi, updated: kq.chungTuCapNhat,
                skipped: kq.boQua, failed: kq.tieuDeThieu.length ? 1 : 0,
                details: JSON.stringify(tomTatMuaDeGhiLog(kq)),
                startedAt: new Date(), finishedAt: new Date(),
            },
        }).catch(() => { /* nhật ký hỏng không được làm hỏng lượt đổ */ })
        res.json({ success: true, sheet: tenSheet, store: store.name, apply, ...kq })
    } catch (e: any) {
        console.error('[misa] import-purchases:', e?.message || e)
        res.status(500).json({ success: false, error: errMsg(e) })
    }
})

/** GET /api/misa/purchases?storeCode=&from=&to= — đọc lại sổ mua đã đổ. */
router.get('/purchases', async (req: Request, res: Response) => {
    try {
        const store = await resolveStore(String(req.query.storeCode || ''))
        if (!store) { res.status(404).json({ success: false, error: 'Không tìm thấy cửa hàng' }); return }
        const from = req.query.from ? new Date(String(req.query.from)) : null
        const to = req.query.to ? new Date(String(req.query.to) + 'T23:59:59+07:00') : null
        const where: any = {}
        if (from || to) where.ngayChungTu = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) }
        const items = await store.sp.misaPurchaseDoc.findMany({
            where, orderBy: { ngayChungTu: 'desc' },
            take: Math.min(Number(req.query.limit) || 100, 300),
            include: { _count: { select: { lines: true } } },
        })
        const doPhu = await store.sp.misaImportBatch.findFirst({
            where: { loai: 'purchases', apply: true }, orderBy: { createdAt: 'desc' },
            select: { tenFile: true, kyBaoCao: true, createdAt: true, docDuoc: true, tongDong: true, boQua: true },
        }).catch(() => null)
        res.json({ success: true, items, doPhu })
    } catch (e: any) {
        res.status(500).json({ success: false, error: errMsg(e) })
    }
})

// ─── POST /api/misa/do-thanh-phieu-nhap ─────────────────────────────────────
/**
 * Sổ mua MISA → PHIẾU NHẬP THẬT của cửa hàng GƯƠNG — song sinh với
 * /do-thanh-don-ban, cùng rào: từ chối nếu cửa hàng có phiếu nhập không mang
 * mã MISA-. KHÔNG đụng tồn kho / thẻ kho — cửa hàng gương chỉ giữ sổ sách.
 * Sổ MISA mẫu này không có cột NCC → phiếu ghi rõ "Sổ MISA (sổ không ghi NCC)".
 * paidAmount = đủ để không đẻ công nợ ảo (sổ không nói tiến độ trả tiền).
 */
router.post('/do-thanh-phieu-nhap', async (req: Request, res: Response) => {
    try {
        const b: any = req.body || {}
        const store = await registryPrisma.store.findFirst({
            where: { code: { equals: String(b.storeCode || ''), mode: 'insensitive' } },
            select: { code: true, name: true, schema: true },
        })
        if (!store) { res.status(404).json({ success: false, error: 'Không tìm thấy cửa hàng' }); return }
        const sp: any = getStorePrisma(store.schema)
        const apply = b.apply === true || b.apply === 'true'

        const soPhieuNgoai = await sp.importReceipt.count({ where: { NOT: { code: { startsWith: 'MISA-' } } } })
        if (soPhieuNgoai > 0) {
            res.status(400).json({
                success: false,
                error: `Cửa hàng ${store.code} có ${soPhieuNgoai} phiếu nhập KHÔNG phải từ MISA — đổ thêm là đếm trùng. Chỉ chạy trên cửa hàng gương.`,
            })
            return
        }
        const user = await sp.user.findFirst({
            where: { role: { in: ['admin', 'owner', 'manager'] } },
            orderBy: { createdAt: 'asc' }, select: { id: true, name: true },
        })
        if (!user?.id) { res.status(400).json({ success: false, error: 'Cửa hàng chưa có tài khoản admin/manager để đứng tên phiếu' }); return }

        const docs = await sp.misaPurchaseDoc.findMany({ include: { lines: true }, orderBy: { ngayChungTu: 'asc' } })
        if (!docs.length) { res.json({ success: true, store: store.code, thongBao: 'Chưa có chứng từ mua nào — đổ Excel mua hàng trước đã' }); return }

        let categoryId: string | null = (await sp.category.findFirst({ select: { id: true }, orderBy: { createdAt: 'asc' } }))?.id || null
        if (!categoryId && apply) categoryId = (await sp.category.create({ data: { name: 'MISA' }, select: { id: true } })).id

        /* HKD/cá nhân không được khấu trừ VAT đầu vào — đọc đúng loại hình kẻo
         * sổ mọc ra 1331 không có thật (cùng lý do với /tax/auto-journal). */
        const btLoaiHinh = (await sp.storeSettings.findFirst({ select: { businessType: true } }).catch(() => null))?.businessType || 'company'
        const vatKhauTru = !(btLoaiHinh === 'household' || btLoaiHinh === 'individual')

        const kq = {
            phieuMoi: 0, phieuCapNhat: 0, coHoaDon: 0, spMoi: 0, spDaCo: 0,
            butToanMoi: 0, dongTheKho: 0,
            tongTienHang: 0, tongThue: 0, tuNgay: null as string | null, denNgay: null as string | null,
            canhBao: [] as string[], viDu: [] as string[],
        }
        const spMoiTao = new Map<string, string>()

        for (const doc of docs) {
            const code = `MISA-${doc.soChungTu}`
            const ngay = doc.ngayChungTu || doc.ngayHachToan || doc.createdAt
            const iso = ngay.toISOString().slice(0, 10)
            if (!kq.tuNgay || iso < kq.tuNgay) kq.tuNgay = iso
            if (!kq.denNgay || iso > kq.denNgay) kq.denNgay = iso

            const items: any[] = []
            let totalCost = 0
            for (const l of doc.lines || []) {
                /* Dòng tiền ÂM là CHIẾT KHẤU của NCC (đo 25/08: NK00244/NK00245 mang
                 * mã CKPN, giá trị −14.781.788 tổng). Lọc "> 0" là vứt mất chiết khấu
                 * → tổng phiếu PHỒNG đúng bấy nhiêu. Chỉ bỏ dòng mọi-số-đều-0. */
                if (!(Number(l.soLuong) || 0) && !(Number(l.giaTri) || 0) && !(Number(l.giaTriTra) || 0)) continue
                const soLuongTho = Math.round(Number(l.soLuong) || 0)
                const soLuong = soLuongTho >= 1 ? soLuongTho : ((Number(l.giaTri) || 0) > 0 ? 1 : 0)
                let productId = l.productId || spMoiTao.get(l.maHang) || null
                if (!productId) {
                    const p = await sp.product.findUnique({ where: { sku: l.maHang }, select: { id: true } })
                    if (p?.id) { productId = p.id; kq.spDaCo++ }
                    else if (apply && categoryId) {
                        const tao = await sp.product.create({
                            data: {
                                sku: l.maHang, name: l.tenHang || l.maHang, categoryId,
                                costPrice: Number(l.donGia) || 0, sellingPrice: 0,
                                baseUnit: l.dvt || 'cái', stock: 0,
                                description: 'Tạo từ sổ mua hàng MISA',
                            }, select: { id: true },
                        })
                        productId = tao.id
                        kq.spMoi++
                    } else { kq.spMoi++; continue }
                    if (productId) spMoiTao.set(l.maHang, productId)
                }
                const net = (Number(l.giaTri) || 0) - (Number(l.chietKhau) || 0) - (Number(l.giamGia) || 0) - (Number(l.giaTriTra) || 0)
                totalCost += net
                items.push({
                    productId, productName: l.tenHang || l.maHang, productSku: l.maHang,
                    quantity: soLuong, returnedQuantity: Math.max(0, Math.round(Number(l.soLuongTra) || 0)),
                    costPrice: Number(l.donGia) || 0, discount: Number(l.chietKhau) || 0, total: net,
                })
            }
            const vatAmount = Number(doc.tongThue) || 0
            kq.tongTienHang += totalCost
            kq.tongThue += vatAmount
            if (doc.soHoaDon) kq.coHoaDon++

            const duLieu = {
                supplierName: 'Sổ MISA (sổ không ghi NCC)',
                totalCost, totalItems: items.length, status: 'completed',
                paidAmount: totalCost + vatAmount, paymentStatus: 'paid',
                hasVatInvoice: !!doc.soHoaDon, vatInvoiceNo: doc.soHoaDon || null, vatAmount,
                note: `Đổ từ sổ mua hàng MISA${doc.soHoaDon ? ` — HĐ ${doc.soHoaDon}` : ''} (sổ không ghi NCC & tiến độ trả tiền; KHÔNG cộng tồn kho)`,
                userId: user.id, userName: 'Sổ MISA',
                transactionDate: ngay, createdAt: ngay,
            }
            if (apply) {
                const cu = await sp.importReceipt.findUnique({ where: { code }, select: { id: true } })
                if (cu) {
                    await sp.importReceiptItem.deleteMany({ where: { receiptId: cu.id } })
                    await sp.importReceipt.update({ where: { id: cu.id }, data: { ...duLieu, items: { create: items } } })
                    kq.phieuCapNhat++
                } else {
                    await sp.importReceipt.create({ data: { ...duLieu, code, items: { create: items } } })
                    kq.phieuMoi++
                }
            } else {
                const cu = await sp.importReceipt.findUnique({ where: { code }, select: { id: true } })
                if (cu) kq.phieuCapNhat++; else kq.phieuMoi++
            }
            if (apply) {
                // Thẻ kho: phiếu nhập cộng kho — cùng khuôn với đơn bán ở trên
                await sp.inventoryTransaction.deleteMany({ where: { referenceId: code, referenceType: 'import_receipt' } })
                for (const it of items) {
                    if (!(it.quantity > 0)) continue
                    await sp.inventoryTransaction.create({
                        data: {
                            type: 'import', productId: it.productId, productName: it.productName,
                            productSku: it.productSku, quantity: it.quantity,
                            reason: `Nhập kho theo phiếu ${code} (sổ MISA)`,
                            referenceId: code, referenceType: 'import_receipt',
                            unitPrice: it.costPrice || 0, supplierName: 'Sổ MISA',
                            userName: 'Sổ MISA', createdAt: ngay,
                        },
                    })
                    kq.dongTheKho++
                }
                // Hạch toán phiếu nhập ngay sau ghi — cùng lý do với do-thanh-don-ban
                const refsCu = refsOfImport(code)
                await sp.journalEntry.deleteMany({
                    where: { OR: [
                        { reference: { in: refsCu } },
                        { reference: { in: refsCu.map(r => `VOID-${r}`) } },
                    ] },
                }).catch(() => null)
                const phieuBt = await sp.importReceipt.findUnique({ where: { code } })
                if (phieuBt) {
                    const bt = await postImportReceiptJournal(sp, phieuBt as any, { userId: user.id, vatKhauTru })
                        .catch((e: any) => { console.error('[misa] but toan phieu', code, e?.message); return { created: [] } })
                    kq.butToanMoi += bt.created.length
                }
            }
            if (kq.viDu.length < 5) kq.viDu.push(`${code} · ${iso} · HĐ ${doc.soHoaDon || '—'} · ${Math.round(totalCost).toLocaleString('vi-VN')}đ + thuế ${Math.round(vatAmount).toLocaleString('vi-VN')}đ · ${items.length} dòng`)
        }

        if (apply) {
            const tdk = await canDoiTonDauKyGuong(sp)
            ;(kq as any).tonDauKy = tdk
            await cacheDel(`${store.schema}:*:dashboard:*`).catch(() => { })
            await cacheDel(`${store.schema}:dashboard:*`).catch(() => { })
        }
        kq.canhBao.unshift('Thẻ kho ghi nhập theo phiếu + dòng tồn đầu kỳ tự cân đối (tồn tổng vẫn theo MISA); sổ không có tên NCC nên phiếu ghi Sổ MISA')

        res.json({ success: true, store: store.code, apply, soChungTu: docs.length, ...kq })
    } catch (e: any) {
        console.error('[misa] do-thanh-phieu-nhap:', e?.message || e, e?.stack?.split('\n')[1] || '')
        res.status(500).json({ success: false, error: errMsg(e) })
    }
})

// ─── POST /api/misa/import-cash-journal ─────────────────────────────────────
/**
 * Sổ NHẬT KÝ THU TIỀN / CHI TIỀN → thẳng vào sổ quỹ của cửa hàng GƯƠNG:
 * thu → CashReceipt (khoá chống trùng `reference` = MISA-<số hiệu>), chi →
 * Expense (khoá `sourceRef`). Không cần bảng staging — hai bảng đích có sẵn
 * khoá chống trùng và màn Thu Chi đọc thẳng chúng.
 *
 * RÀO chống đếm trùng: từ chối khi cửa hàng đã có phiếu thu/chi KHÔNG mang mã
 * MISA- (cửa hàng thật ghi sổ quỹ qua POS/Thu Chi — đổ thêm là tiền đếm đôi).
 */
router.post('/import-cash-journal', uploadExcel.single('file'), async (req: Request, res: Response) => {
    try {
        const b: any = req.body || {}
        const store = await resolveStore(String(b.storeCode || ''))
        if (!store) { res.status(404).json({ success: false, error: 'Không tìm thấy cửa hàng' }); return }
        if (!req.file?.buffer?.length) { res.status(400).json({ success: false, error: 'Chưa chọn file Excel' }); return }
        let rows: any[][]
        let tenSheet = ''
        try {
            const wb = XLSX.read(req.file.buffer, { type: 'buffer', codepage: 65001, raw: false })
            tenSheet = wb.SheetNames[0] || ''
            if (!tenSheet) throw new Error('file không có sheet nào')
            rows = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[tenSheet]!, { header: 1, raw: false, defval: '' })
        } catch (e: any) {
            res.status(400).json({ success: false, error: `Không mở được file Excel: ${errMsg(e)}` }); return
        }
        const apply = b.apply === true || b.apply === 'true'
        const kq = docNhatKyTien(rows)
        if (kq.tieuDeThieu.length || !kq.loai) {
            res.json({
                success: true, sheet: tenSheet, store: store.name, apply: false,
                loai: kq.loai, tieuDeThieu: kq.tieuDeThieu.length ? kq.tieuDeThieu : ['(không nhận ra sổ thu hay chi)'],
                tongDong: kq.tongDong,
            })
            return
        }
        const sp = store.sp

        // Rào cửa hàng gương — đếm bản ghi KHÔNG phải MISA (reference/sourceRef null cũng tính)
        let soNgoai = 0
        if (kq.loai === 'thu') {
            const [tong, cuaMisa] = [
                await sp.cashReceipt.count(),
                await sp.cashReceipt.count({ where: { reference: { startsWith: 'MISA-' } } }),
            ]
            soNgoai = tong - cuaMisa
        } else {
            const [tong, cuaMisa] = [
                await sp.expense.count(),
                await sp.expense.count({ where: { sourceRef: { startsWith: 'MISA-' } } }),
            ]
            soNgoai = tong - cuaMisa
        }
        if (soNgoai > 0) {
            res.status(400).json({
                success: false,
                error: `Cửa hàng có ${soNgoai} phiếu ${kq.loai === 'thu' ? 'thu' : 'chi'} KHÔNG phải từ MISA — đổ thêm là tiền đếm đôi. Chỉ chạy trên cửa hàng gương.`,
            })
            return
        }

        let moi = 0, capNhat = 0, tongTien = 0
        const mapKhach = new Map<string, string | null>()
        const mapTenKhach = new Map<string, string>()
        let tuNgay: string | null = null, denNgay: string | null = null
        for (const e of kq.entries) {
            tongTien += e.soTien
            const iso = e.ngay ? e.ngay.toISOString().slice(0, 10) : null
            if (iso) {
                if (!tuNgay || iso < tuNgay) tuNgay = iso
                if (!denNgay || iso > denNgay) denNgay = iso
            }
            const khoa = `MISA-${e.soHieu}`
            if (kq.loai === 'thu') {
                const cu = await sp.cashReceipt.findFirst({ where: { reference: khoa }, select: { id: true } })
                if (apply) {
                    /* TỰ NỐI (26/08/2026, chủ shop: "đổ data 8 xong tới data 7 thì
                     * phải tự link hết"): vớt tên từ diễn giải ("Bán hàng cho X",
                     * "Thu tiền của Y") rồi nối vào Customer sẵn có — khách đã sinh
                     * từ lượt đổ sổ bán nên phiếu thu tháng nào đổ cũng bám được.
                     * reference MISA-<số hiệu> trùng receiptNumber của đơn PT cùng
                     * số — hai sổ tự soi nhau qua khoá đó, không cần cột nối riêng. */
                    let khachId: string | null = null, khachTen: string | null = null
                    const tenVot = votTenKhach(e.dienGiai || '')
                    if (tenVot) {
                        khachId = mapKhach.get(tenVot.toLowerCase()) ?? null
                        if (khachId === null && !mapKhach.has(tenVot.toLowerCase())) {
                            const kh = await sp.customer.findFirst({
                                where: { name: { equals: tenVot, mode: 'insensitive' } }, select: { id: true, name: true },
                            }).catch(() => null)
                            khachId = kh?.id || null
                            khachTen = kh?.name || null
                            mapKhach.set(tenVot.toLowerCase(), khachId)
                            if (khachId) mapTenKhach.set(khachId, khachTen || tenVot)
                        }
                        if (khachId && !khachTen) khachTen = mapTenKhach.get(khachId) || tenVot
                    }
                    const duLieu = {
                        description: e.dienGiai || `Thu tiền ${e.soHieu} (sổ MISA)`,
                        amount: e.soTien, category: 'other',
                        date: e.ngay || new Date(), receivedVia: kq.kenh === 'nganhang' ? 'Chuyển khoản' : 'Tiền mặt',
                        reference: khoa, status: 'active',
                        customerId: khachId, customerName: khachTen,
                    }
                    if (cu) { await sp.cashReceipt.update({ where: { id: cu.id }, data: duLieu }); capNhat++ }
                    else { await sp.cashReceipt.create({ data: { ...duLieu, createdAt: e.ngay || new Date() } }); moi++ }
                } else { if (cu) capNhat++; else moi++ }
            } else {
                const cu = await sp.expense.findFirst({ where: { sourceRef: khoa }, select: { id: true } })
                if (apply) {
                    const duLieu = {
                        description: e.dienGiai || `Chi tiền ${e.soHieu} (sổ MISA)`,
                        amount: e.soTien, category: 'other',
                        date: e.ngay || new Date(), paidBy: 'Sổ MISA',
                        sourceRef: khoa, status: 'active',
                    }
                    if (cu) { await sp.expense.update({ where: { id: cu.id }, data: duLieu }); capNhat++ }
                    else { await sp.expense.create({ data: { ...duLieu, createdAt: e.ngay || new Date() } }); moi++ }
                } else { if (cu) capNhat++; else moi++ }
            }
        }

        await sp.misaSyncLog.create({
            data: {
                entity: 'cashExcel', mode: 'excel', dryRun: !apply,
                status: 'success',
                errors: kq.boQua.length ? `Bỏ ${kq.boQua.length} dòng: ${kq.boQua.slice(0, 5).map(x => x.lyDo).join(' · ')}`.slice(0, 4000) : null,
                fetched: kq.tongDong, created: apply ? moi : 0, updated: apply ? capNhat : 0,
                skipped: kq.boQua.length, failed: 0,
                details: JSON.stringify({ loai: kq.loai, tongTien, tuNgay, denNgay, boQua: kq.boQua.slice(0, 50) }),
                startedAt: new Date(), finishedAt: new Date(),
            },
        }).catch(() => { })

        res.json({
            success: true, sheet: tenSheet, store: store.name, apply,
            loai: kq.loai, kenh: kq.kenh, kyBaoCao: kq.kyBaoCao,
            tongDong: kq.tongDong, docDuoc: kq.entries.length, boQua: kq.boQua.length,
            boQuaChiTiet: kq.boQua.slice(0, 10),
            moi, capNhat, tongTien, tuNgay, denNgay,
        })
    } catch (e: any) {
        console.error('[misa] import-cash-journal:', e?.message || e)
        res.status(500).json({ success: false, error: errMsg(e) })
    }
})

// ─── GET /api/misa/lien-ket-soat?storeCode= ─────────────────────────────────
/**
 * SOÁT LIÊN KẾT CHỨNG TỪ của cửa hàng gương (26/08/2026, chủ shop: "xem các
 * logic liên quan giữa các phiếu... có bị đứt logic không, vẽ ra").
 *
 * CHỈ ĐỌC. Đo từng cạnh của đồ thị: sổ MISA → đơn bán → bút toán → thẻ kho,
 * phiếu thu → khách/đơn, phiếu nhập → bút toán/thẻ kho — và đếm cạnh ĐỨT
 * (chứng từ thiếu vế đối của nó). Con số trả về dùng để vẽ sơ đồ + là bộ soát
 * chạy lại sau MỖI lần đổ tháng mới.
 */
router.get('/lien-ket-soat', async (req: Request, res: Response) => {
    try {
        const store = await registryPrisma.store.findFirst({
            where: { code: { equals: String(req.query.storeCode || ''), mode: 'insensitive' } },
            select: { code: true, schema: true },
        })
        if (!store) { res.status(404).json({ success: false, error: 'Không tìm thấy cửa hàng' }); return }
        const sp: any = getStorePrisma(store.schema)

        // ── Tầng chứng từ nguồn (sổ MISA) ──
        const soBan = await sp.misaSaleDoc.findMany({ select: { soChungTu: true, soHoaDon: true, customerId: true, tongDoanhSo: true, tongThue: true, tongChietKhau: true, tongTra: true } })
        const soMua = await sp.misaPurchaseDoc.findMany({ select: { soChungTu: true, soHoaDon: true, tongGiaTri: true, tongThue: true } })

        // ── Tầng đơn/phiếu thật ──
        const dsDon = await sp.transaction.findMany({
            where: { receiptNumber: { startsWith: 'MISA-' } },
            select: { receiptNumber: true, total: true, tax: true, amountReceived: true, vatStatus: true, vatInvoiceNumber: true, customerId: true, status: true },
        })
        const dsPhieuNhap = await sp.importReceipt.findMany({
            where: { code: { startsWith: 'MISA-' } },
            select: { code: true, totalCost: true, vatAmount: true, hasVatInvoice: true },
        })
        const dsThu = await sp.cashReceipt.findMany({
            where: { reference: { startsWith: 'MISA-' } },
            select: { reference: true, amount: true, customerId: true, description: true },
        })
        const dsChi = await sp.expense.findMany({
            where: { sourceRef: { startsWith: 'MISA-' } },
            select: { sourceRef: true, amount: true },
        })

        // ── Tầng bút toán + thẻ kho ──
        const refBt = await sp.journalEntry.findMany({
            where: { referenceType: { not: 'manual' } }, select: { reference: true, amount: true, debitAccount: true, creditAccount: true },
        })
        const btTheo = (dau: string) => refBt.filter((x: any) => String(x.reference || '').startsWith(dau))
        const theKhoBan = await sp.inventoryTransaction.count({ where: { referenceType: 'sale', referenceId: { startsWith: 'MISA-' } } })
        const theKhoNhap = await sp.inventoryTransaction.count({ where: { referenceType: 'import_receipt', referenceId: { startsWith: 'MISA-' } } })
        const tonDauKy = await sp.inventoryTransaction.findMany({
            where: { referenceType: 'misa_opening' }, select: { productSku: true, quantity: true },
        })
        const tdkAm = tonDauKy.filter((x: any) => Number(x.quantity) < 0)
            .sort((a: any, b: any) => Number(a.quantity) - Number(b.quantity))

        // Bất biến thẻ kho tổng: Σ mọi dòng thẻ kho == Σ Product.stock
        const sumTheKho = await sp.inventoryTransaction.aggregate({ _sum: { quantity: true } })
            .then((r: any) => Number(r?._sum?.quantity) || 0)
        const sumStock = await sp.product.aggregate({ _sum: { stock: true } })
            .then((r: any) => Number(r?._sum?.stock) || 0)

        // ── Đếm cạnh đứt ──
        const setDon = new Set(dsDon.map((x: any) => x.receiptNumber))
        const setPhieu = new Set(dsPhieuNhap.map((x: any) => x.code))
        const banThieuDon = soBan.filter((d: any) => !setDon.has('MISA-' + d.soChungTu)).map((d: any) => d.soChungTu)
        const muaThieuPhieu = soMua.filter((d: any) => !setPhieu.has('MISA-' + d.soChungTu)).map((d: any) => d.soChungTu)

        const setSale = new Set(btTheo('SALE-').map((x: any) => x.reference))
        const setImp = new Set(btTheo('IMP-').map((x: any) => x.reference))
        const donThieuBt = dsDon.filter((x: any) => !setSale.has('SALE-' + x.receiptNumber.replace(/^MISA-/, 'MISA-'))).filter((x: any) => !setSale.has('SALE-' + x.receiptNumber)).map((x: any) => x.receiptNumber)
        const phieuThieuBt = dsPhieuNhap.filter((x: any) => !setImp.has('IMP-' + x.code)).map((x: any) => x.code)

        // Phiếu thu PT trùng số với đơn PT (bán lẻ thu ngay) — nối tự nhiên qua mã
        const thuTrungDon = dsThu.filter((x: any) => setDon.has(String(x.reference))).length
        // Phiếu thu nhắc tới hoá đơn BH trong diễn giải — nối thu tiền ↔ đơn bán chịu
        let thuNhacBH = 0, thuNhacBHKhop = 0
        /* Dien giai nhat ky thu cua MISA ghi SO HOA DON dien tu ("theo hoa don
         * so 00002511"), khong ghi ma chung tu BH — noi qua vatInvoiceNumber. */
        const setHD = new Map<string, string>()
        for (const d of dsDon) if (d.vatInvoiceNumber) setHD.set(String(d.vatInvoiceNumber).replace(/^0+/, ''), d.receiptNumber)
        const maSo = /\b(BH\d{4,}|\d{5,8})\b/g
        for (const t of dsThu) {
            const m = String(t.description || '').match(maSo)
            if (!m?.length) continue
            thuNhacBH++
            if (m.some((c: string) => setDon.has('MISA-' + c) || setHD.has(c.replace(/^0+/, '')))) thuNhacBHKhop++
        }
        const thuCoKhach = dsThu.filter((x: any) => x.customerId).length
        const donCoKhach = dsDon.filter((x: any) => x.customerId).length
        const donCoHD = dsDon.filter((x: any) => x.vatStatus === 'issued').length

        // Tiền: sổ nói thu 1,11 tỷ nhưng đơn đang khai amountReceived = total
        const tongBan = dsDon.reduce((a: number, x: any) => a + (Number(x.total) || 0), 0)
        const tongKhaiDaThu = dsDon.reduce((a: number, x: any) => a + (Number(x.amountReceived) || 0), 0)
        const tongThuThat = dsThu.reduce((a: number, x: any) => a + (Number(x.amount) || 0), 0)
        const tongChi = dsChi.reduce((a: number, x: any) => a + (Number(x.amount) || 0), 0)
        const tongNhap = dsPhieuNhap.reduce((a: number, x: any) => a + (Number(x.totalCost) || 0) + (Number(x.vatAmount) || 0), 0)

        res.json({
            success: true,
            store: store.code,
            soMisa: {
                ban: { soChungTu: soBan.length, coHoaDon: soBan.filter((x: any) => x.soHoaDon).length, daNoiKhach: soBan.filter((x: any) => x.customerId).length },
                mua: { soChungTu: soMua.length, coHoaDon: soMua.filter((x: any) => x.soHoaDon).length },
                thu: { soPhieu: dsThu.length, tongTien: tongThuThat },
                chi: { soPhieu: dsChi.length, tongTien: tongChi },
            },
            chungTuThat: {
                donBan: { so: dsDon.length, tongTien: tongBan, coVatIssued: donCoHD, coKhach: donCoKhach },
                phieuNhap: { so: dsPhieuNhap.length, tongTienGomThue: tongNhap, coHoaDonDauVao: dsPhieuNhap.filter((x: any) => x.hasVatInvoice).length },
            },
            butToan: {
                SALE: btTheo('SALE-').length, VAT: btTheo('VAT-').length, COGS: btTheo('COGS-').length,
                DISC: btTheo('DISC-').length, IMP: btTheo('IMP-').length,
                khac: refBt.length - btTheo('SALE-').length - btTheo('VAT-').length - btTheo('COGS-').length - btTheo('DISC-').length - btTheo('IMP-').length,
            },
            theKho: {
                dongBan: theKhoBan, dongNhap: theKhoNhap, dongTonDauKy: tonDauKy.length,
                batBienTong: { sumTheKho, sumProductStock: sumStock, lech: sumTheKho - sumStock, khop: sumTheKho === sumStock },
            },
            catDut: {
                soBanThieuDon: banThieuDon.slice(0, 10),
                soMuaThieuPhieu: muaThieuPhieu.slice(0, 10),
                donThieuButToan: donThieuBt.slice(0, 10),
                phieuThieuButToan: phieuThieuBt.slice(0, 10),
                tonDauKyAm: { so: tdkAm.length, viDu: tdkAm.slice(0, 8).map((x: any) => `${x.productSku}: ${x.quantity}`) },
                /* Cạnh đứt CÓ CHỦ ĐÍCH cần khai thật: sổ chi tiết bán không ghi tiến độ
                 * thu tiền nên đơn khai amountReceived = total; nhật ký thu nói số thật. */
                tienThu: {
                    tongBanKhaiDaThu: tongKhaiDaThu,
                    tongThuTheoNhatKy: tongThuThat,
                    chenh: tongKhaiDaThu - tongThuThat,
                    ghiChu: 'chênh = phần có thể là BÁN CHỊU (TK 131) mà sổ chi tiết bán không cho biết — cần sổ công nợ 131 để khớp',
                },
                chuaCoSoChi: dsChi.length === 0,
            },
            noiThuDon: {
                thuTrungSoDon: thuTrungDon, thuNhacHoaDonBH: thuNhacBH, trongDoKhopDon: thuNhacBHKhop, thuCoKhach,
                donThuDu: dsDon.filter((x: any) => x.status === 'completed').length,
                donBanChiu: dsDon.filter((x: any) => x.status === 'partial').length,
            },
        })
    } catch (e: any) {
        console.error('[misa] lien-ket-soat:', e?.message || e)
        res.status(500).json({ success: false, error: errMsg(e) })
    }
})

router.get('/doi-chieu', async (req: Request, res: Response) => {
    try {
        const store = await resolveStore(String(req.query.storeCode || ''))
        if (!store) { res.status(404).json({ success: false, error: 'Không tìm thấy cửa hàng' }); return }
        const from = String(req.query.from || ''), to = String(req.query.to || '')
        if (!from || !to) { res.status(400).json({ success: false, error: 'Thiếu from/to (YYYY-MM-DD)' }); return }
        const dau = new Date(`${from}T00:00:00+07:00`), cuoi = new Date(`${to}T23:59:59+07:00`)

        // ── Vế MISA ──
        const misa = await store.sp.misaSaleDoc.aggregate({
            where: { ngayChungTu: { gte: dau, lte: cuoi } },
            _sum: { tongDoanhSo: true, tongThue: true }, _count: true,
        })
        const misaTruocThue = misa._sum.tongDoanhSo || 0
        const misaThue = misa._sum.tongThue || 0

        // ── Vế Kengi ──
        // COALESCE(transactionDate, createdAt): phiếu chưa có ngày bán thì lấy ngày tạo, chứ
        // KHÔNG loại khỏi phép cộng — loại đi là doanh thu tự bốc hơi mà không ai thấy.
        const q = async (cot: string) => {
            const r: any[] = await store.sp.$queryRawUnsafe(
                // ::float8 — SUM() của Postgres trả `numeric`, qua Prisma thành Decimal chứ không phải số
                `SELECT COUNT(*)::int AS so,
                        COALESCE(SUM("total"),0)::float8 AS tong,
                        COALESCE(SUM("tax"),0)::float8 AS thue
                   FROM "Transaction"
                  WHERE "status" IN ('completed','partial') AND ${cot} BETWEEN $1 AND $2`,
                dau, cuoi,
            )
            const x = r[0] || {}
            return { so: Number(x.so || 0), tong: Number(x.tong || 0), thue: Number(x.thue || 0) }
        }
        const theoNgayBan = await q(`COALESCE("transactionDate","createdAt")`)
        const theoNgayNhap = await q(`"createdAt"`)

        // Độ phủ: bao nhiêu phiếu chưa có ngày bán thật ⇒ hai cách cắt kỳ lệch nhau vì cái này.
        const thieuNgayBan: any[] = await store.sp.$queryRawUnsafe(
            `SELECT COUNT(*)::int AS so FROM "Transaction"
              WHERE "status" IN ('completed','partial') AND "transactionDate" IS NULL
                AND "createdAt" BETWEEN $1 AND $2`,
            dau, cuoi,
        )

        const kengiTruocThue = theoNgayBan.tong - theoNgayBan.thue
        const lech = kengiTruocThue - misaTruocThue

        /*
         * TÁCH THEO NGÀY — một con số tổng nói "có lệch" nhưng không nói lệch ở ĐÂU.
         * 20 ngày thì không ai dò tay được, mà thường lệch chỉ nằm ở vài ngày.
         *
         * `+ interval '7 hours'` rồi mới `to_char`: cắt ngày phải theo giờ Việt Nam, không thì
         * mọi giao dịch trước 7h sáng rơi nhầm sang ngày hôm trước (bộ soát check:ngay bắt cái này).
         */
        const ngayMisa: any[] = await store.sp.$queryRawUnsafe(
            `SELECT to_char("ngayChungTu" + interval '7 hours','YYYY-MM-DD') AS ngay,
                    COUNT(*)::int AS so,
                    COALESCE(SUM("tongDoanhSo"),0)::float8 AS tien
               FROM "MisaSaleDoc"
              WHERE "ngayChungTu" BETWEEN $1 AND $2
              GROUP BY 1`,
            dau, cuoi,
        )
        const ngayKengi: any[] = await store.sp.$queryRawUnsafe(
            `SELECT to_char(COALESCE("transactionDate","createdAt") + interval '7 hours','YYYY-MM-DD') AS ngay,
                    COUNT(*)::int AS so,
                    COALESCE(SUM("total" - "tax"),0)::float8 AS tien
               FROM "Transaction"
              WHERE "status" IN ('completed','partial')
                AND COALESCE("transactionDate","createdAt") BETWEEN $1 AND $2
              GROUP BY 1`,
            dau, cuoi,
        )
        const gomNgay = new Map<string, { ngay: string; misa: number; misaSo: number; kengi: number; kengiSo: number }>()
        const oNgay = (n: string) => {
            let x = gomNgay.get(n)
            if (!x) { x = { ngay: n, misa: 0, misaSo: 0, kengi: 0, kengiSo: 0 }; gomNgay.set(n, x) }
            return x
        }
        for (const r of ngayMisa) { const x = oNgay(String(r.ngay)); x.misa = Number(r.tien || 0); x.misaSo = Number(r.so || 0) }
        for (const r of ngayKengi) { const x = oNgay(String(r.ngay)); x.kengi = Number(r.tien || 0); x.kengiSo = Number(r.so || 0) }
        const theoNgay = [...gomNgay.values()]
            .map(x => ({ ...x, lech: x.kengi - x.misa }))
            .sort((a, b) => a.ngay.localeCompare(b.ngay))
        // Ngày lệch quá 1.000đ mới coi là lệch — dưới nữa là làm tròn, không đáng gọi tên
        const ngayLech = theoNgay.filter(x => Math.abs(x.lech) >= 1000)

        res.json({
            success: true,
            store: store.name,
            tuNgay: from, denNgay: to,
            misa: {
                soChungTu: misa._count,
                truocThue: misaTruocThue,
                thue: misaThue,
                gomThue: misaTruocThue + misaThue,
            },
            kengi: {
                soPhieu: theoNgayBan.so,
                truocThue: kengiTruocThue,
                thue: theoNgayBan.thue,
                gomThue: theoNgayBan.tong,
                // Cắt kỳ theo ngày NHẬP DÒNG — để nhìn thấy chênh lệch, không phải để dùng thay
                theoNgayNhap: { soPhieu: theoNgayNhap.so, gomThue: theoNgayNhap.tong },
                phieuThieuNgayBan: Number(thieuNgayBan[0]?.so || 0),
            },
            // Quy về CÙNG một mốc: trước thuế. Dương = Kengi bán nhiều hơn sổ MISA khai.
            lechTruocThue: lech,
            tyLeSoVoiKengi: kengiTruocThue > 0 ? misaTruocThue / kengiTruocThue : null,
            theoNgay,
            soNgayLech: ngayLech.length,
            soNgay: theoNgay.length,
            ghiChu: 'Đã quy cả hai vế về TRƯỚC THUẾ. Doanh thu Kengi gồm cả đơn bán chịu (status partial).',
        })
    } catch (e: any) {
        res.status(500).json({ success: false, error: errMsg(e) })
    }
})

export default router
