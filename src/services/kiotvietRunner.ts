/**
 * BỘ CHẠY ĐỢT ĐỒNG BỘ KIOTVIET (2026-08-06)
 *
 * Tách khỏi routes/kiotviet.ts để CẢ route lẫn watchdog tự-chạy-tiếp dùng chung
 * một đường code — hai bản sao sẽ lệch nhau ngay lần sửa đầu tiên.
 *
 * VÌ SAO CẦN TỰ CHẠY TIẾP: việc chạy nền sống nhờ tiến trình Node. Cloud Run
 * thay máy mỗi lần deploy (và có thể thu hồi máy khi rảnh), nên một đợt quét
 * vài chục nghìn bản ghi rất dễ đứt giữa chừng — người dùng thấy "đang chạy"
 * đứng im vĩnh viễn. Watchdog dò đợt mất nhịp tim rồi CHẠY TIẾP phần còn dở.
 *
 * CHẠY TIẾP ĐƯỢC LÀ NHỜ TÍNH BẤT BIẾN: mọi hàm đồng bộ đều chống trùng bằng
 * KiotVietMap + khoá nghiệp vụ, nên chạy lại một loại đã xong chỉ ra "bỏ qua",
 * không đẻ bản ghi. Nhờ vậy chỉ cần nhớ "loại nào đã XONG" là đủ, không phải
 * đánh dấu tới từng trang.
 */

import { registryPrisma, getStorePrisma } from '../lib/prisma'
import { errMsg } from '../lib/errorResponse'
import { tongPhieuChuaTraTheoNcc, congNoChuaKep, soDuDauKyTuKV } from '../lib/congNoNcc'
import { KV, kvDate, type KiotVietCreds } from './kiotviet'
import { dongBoCayDanhMuc } from './kiotvietDanhMuc'
import {
    newCounters, syncProducts, syncCustomers, syncSuppliers, syncInvoices,
    syncPurchaseOrders, syncCashflow, syncReturns, type SyncOptions,
} from './kiotvietSync'

/** Mất nhịp quá ngần này = coi như đợt chạy đã chết. */
export const STALE_MS = 2 * 60_000
/**
 * Số lần chạy tiếp LIÊN TIẾP MÀ KHÔNG TIẾN TRIỂN thì bỏ cuộc.
 * Đếm "liên tiếp không tiến triển" chứ không phải tổng số lần: một đợt 6 loại
 * dữ liệu có thể bị thay máy vài lần mà vẫn đang đi tới: hết lượt trong khi
 * vẫn đang chạy tốt là bỏ cuộc oan. Xong được một loại là bộ đếm về 0.
 */
export const MAX_ATTEMPTS = 5

// THỨ TỰ CÓ Ý NGHĨA (phụ thuộc): hoá đơn tra sản phẩm theo SKU, phiếu trả tra
// ngược hoá đơn gốc. Đảo thứ tự là tra vào chỗ chưa có.
// 'categories' ĐỨNG TRƯỚC 'products' CÓ Ý NGHĨA: hàng hoá tra danh mục theo mã KiotViet,
// nên cây danh mục phải dựng xong trước thì sản phẩm mới bám đúng nhánh lá.
export const SYNC_ENTITIES = ['categories', 'products', 'customers', 'suppliers', 'invoices', 'returns', 'purchaseOrders', 'cashflow'] as const

export function credsOf(cfg: any): KiotVietCreds {
    return {
        clientId: String(cfg.clientId || '').trim(),
        clientSecret: String(cfg.clientSecret || '').trim(),
        retailer: String(cfg.retailer || '').trim(),
    }
}

/**
 * WATCHDOG: quét mọi cửa hàng, tìm đợt đồng bộ mất nhịp tim rồi CHẠY TIẾP phần
 * còn dở. Gọi định kỳ từ cron (xem cron/autoSync.ts).
 *
 * Chỉ nhận đợt `mode: 'manual'` — webhook không chạy dài nên không cần.
 * Quá MAX_ATTEMPTS lần vẫn đứt thì đánh dấu thất bại kèm lý do, đừng để nó
 * quay vòng ăn hết hạn mức API của người ta.
 */
export async function resumeStalledSyncs(): Promise<void> {
    let stores: any[] = []
    try {
        stores = await registryPrisma.store.findMany({
            where: { status: 'active' }, select: { name: true, schema: true },
        }) as any[]
    } catch { return }

    /* LỌC TRƯỚC BẰNG MỘT TRUY VẤN TRÊN SỔ ĐĂNG KÝ.
     *
     * Bản trước mở client tới ĐỦ 9 cửa hàng mỗi 90 giây chỉ để hỏi "có đợt nào dở không?",
     * trong khi hầu hết lượt là KHÔNG. Pool mỗi cửa hàng 1 kết nối, DB 50 slot — đo
     * 12–18/08/2026 đỉnh 51/50, nền 2h sáng vẫn 36–41, toàn cron chứ không phải khách.
     * Hỏi thẳng bằng SQL thô qua kết nối sổ đăng ký thì KHÔNG mở client nào cả.
     * (Ghép lại từ bản đang chạy trên prod, 21/08.) */
    const coDotChay: any[] = []
    for (const store of stores) {
        const schema = String(store.schema || '').replace(/[^A-Za-z0-9_]/g, '')
        if (!schema) continue
        try {
            const rows: any[] = await (registryPrisma as any).$queryRawUnsafe(
                `SELECT 1 FROM "${schema}"."KiotVietSyncLog" WHERE mode = 'manual' AND status = 'running' LIMIT 1`,
            )
            if (rows.length) coDotChay.push(store)
        } catch { /* schema không có bảng KV → cửa hàng đó không nối KiotViet */ }
    }

    for (const store of coDotChay) {
        try {
            const sp = getStorePrisma(store.schema) as any
            const log = await sp.kiotVietSyncLog.findFirst({
                where: { mode: 'manual', status: 'running' },
                orderBy: { startedAt: 'desc' },
            }).catch(() => null)
            if (!log) continue

            const lastBeat = new Date(log.heartbeatAt || log.startedAt).getTime()
            if (Date.now() - lastBeat < STALE_MS) continue     // còn sống, để yên

            const attempts = Number(log.attempts) || 0
            if (attempts >= MAX_ATTEMPTS) {
                await sp.kiotVietSyncLog.update({
                    where: { id: log.id },
                    data: {
                        status: 'failed', finishedAt: new Date(),
                        errors: [(log.errors || ''), `Đã tự chạy tiếp ${attempts} lần mà vẫn đứt — dừng lại. Thu hẹp khoảng ngày hoặc bớt loại dữ liệu rồi chạy lại.`]
                            .filter(Boolean).join('\n').slice(0, 4000),
                    },
                }).catch(() => { })
                continue
            }

            const cfg = await sp.kiotVietConfig.findUnique({ where: { id: 'default' } }).catch(() => null)
            if (!cfg) continue

            // Nhận việc NGAY (đóng dấu nhịp + tăng lượt) để hai máy chạy song song
            // không cùng nhảy vào một đợt.
            await sp.kiotVietSyncLog.update({
                where: { id: log.id },
                data: { attempts: attempts + 1, heartbeatAt: new Date() },
            })

            // `entity` bị ghi đè liên tục kèm tiến độ ("… · đang tải invoices 500/24462")
            // nên phải cắt ở dấu · trước khi tách danh sách loại.
            const entities = String(log.entity || '').split('·')[0].split(',').map(s => s.trim()).filter(Boolean)
            const valid = SYNC_ENTITIES.filter(e => entities.includes(e))
            if (!valid.length) {
                // Không đọc được loại nào thì chạy tiếp cũng vô nghĩa — đóng luôn
                // kèm lý do, đừng để nó đốt hết 5 lượt rồi mới chịu dừng.
                await sp.kiotVietSyncLog.update({
                    where: { id: log.id },
                    data: {
                        status: 'failed', finishedAt: new Date(),
                        errors: `Đợt đứt giữa chừng và không đọc được danh sách loại dữ liệu từ "${String(log.entity || '').slice(0, 120)}" — hãy bấm chạy lại.`,
                    },
                }).catch(() => { })
                continue
            }

            console.log(`[KiotViet] ${store.name}: đợt ${log.id} mất nhịp, chạy tiếp (lần ${attempts + 1}/${MAX_ATTEMPTS})`)
            void runSync(sp, cfg, valid as string[], log.fromDate, log.toDate, !log.dryRun, log.id)
                .catch(async (e: any) => {
                    await sp.kiotVietSyncLog.update({
                        where: { id: log.id },
                        data: { errors: errMsg(e).slice(0, 2000) },
                    }).catch(() => { })
                })
        } catch (e: any) {
            console.error('[KiotViet resume]', store.name, errMsg(e))
        }
    }
}

/**
 * ĐỆM BA THỨ TRA ĐI TRA LẠI CỦA buildOptions — kho mặc định, nhóm hàng mặc
 * định, user hệ thống. Cả ba là dữ liệu CẤU TRÚC, hàng tháng không đổi.
 *
 * Vì sao đáng: buildOptions chạy MỘT LẦN MỖI THÔNG BÁO WEBHOOK. Đo HUTI
 * 15/08/2026: 161 webhook trong 6 giờ, đỉnh 114 trong một giờ; cửa hàng này
 * chưa chọn nhóm hàng mặc định nên mỗi lượt tốn 2 truy vấn pool CỬA HÀNG chỉ
 * để dựng tuỳ chọn, trước khi làm việc thật. Pool cửa hàng chỉ có 5 (từng là
 * 3) nên đây là phần lãng phí đáng bỏ — xem [[prisma-pool-promiseall-trap]].
 *
 * Khoá theo ĐỐI TƯỢNG prisma bằng WeakMap: `getStorePrisma(schema)` trả về
 * cùng một client cho mỗi schema, nên định danh đối tượng chính là định danh
 * cửa hàng — và WeakMap thì client bị thu hồi là mục đệm tự rụng theo.
 *
 * KHÔNG ĐỆM GIÁ TRỊ null. Cửa hàng mới tinh chưa có kho/nhóm/user nào sẽ tra
 * ra null; đệm null lại là suốt TTL nó vẫn tưởng không có, dù người dùng vừa
 * tạo xong — họ sẽ thấy "tạo kho rồi mà đồng bộ vẫn báo thiếu kho".
 *
 * ⚠ CHỐT CHẶN THẬT NẰM Ở PHÍA ĐỌC: `if (dem.warehouseId)` — kiểm truthiness,
 * nên null có lỡ lọt vào đệm cũng vô hại. Đừng "gọn hoá" thành `'warehouseId'
 * in dem`: đo bằng phép thử đột biến 15/08/2026, đổi sang `in` là ca 4 và 5
 * của scripts/check-kiotviet-dem-tuychon.ts đỏ ngay. Guard lúc ghi chỉ là lớp
 * thứ hai cho chắc.
 */
const TTL_TUY_CHON = 5 * 60_000
type TuyChonDem = { warehouseId?: string; categoryId?: string; userId?: string; hetHan: number }
const demTuyChon = new WeakMap<object, TuyChonDem>()

function layDem(sp: any): TuyChonDem {
    const cu = demTuyChon.get(sp)
    if (cu && cu.hetHan > Date.now()) return cu
    const moi: TuyChonDem = { hetHan: Date.now() + TTL_TUY_CHON }
    demTuyChon.set(sp, moi)
    return moi
}

/** Cấu hình đổi (đổi kho/nhóm đích) thì bỏ đệm ngay, đừng chờ hết TTL. */
export function boDemTuyChon(sp: any): void {
    demTuyChon.delete(sp)
}

// ─── Tuỳ chọn đồng bộ dùng chung cho cả chạy tay lẫn webhook ────────────────
export async function buildOptions(sp: any, cfg: any, apply: boolean): Promise<SyncOptions> {
    const dem = layDem(sp)

    // Kho đích: ưu tiên kho đã chọn, không có thì lấy kho main mặc định
    let warehouseId: string | null = cfg?.defaultWarehouseId || null
    if (!warehouseId) {
        if (dem.warehouseId) warehouseId = dem.warehouseId
        else {
            const wh = await sp.warehouse.findFirst({
                where: { type: 'main', isActive: true },
                orderBy: { isDefault: 'desc' }, select: { id: true },
            }).catch(() => null)
            warehouseId = wh?.id || null
            if (warehouseId) dem.warehouseId = warehouseId
        }
    }
    // Nhóm hàng mặc định cho sản phẩm mới
    let categoryId: string | null = cfg?.defaultCategoryId || null
    if (!categoryId) {
        if (dem.categoryId) categoryId = dem.categoryId
        else {
            const cat = await sp.category.findFirst({ select: { id: true }, orderBy: { createdAt: 'asc' } }).catch(() => null)
            categoryId = cat?.id || null
            if (categoryId) dem.categoryId = categoryId
        }
    }
    // Transaction.createdBy là khoá ngoại bắt buộc → phải có một user thật
    let user: { id: string } | null = dem.userId ? { id: dem.userId } : null
    if (!user) {
        user = await sp.user.findFirst({
            where: { role: { in: ['admin', 'owner', 'manager'] } }, select: { id: true },
            orderBy: { createdAt: 'asc' },
        }).catch(() => null)
        if (user?.id) dem.userId = user.id
    }

    let branchIds: number[] | undefined
    try { branchIds = cfg?.branchIds ? JSON.parse(cfg.branchIds) : undefined } catch { branchIds = undefined }

    return {
        apply,
        overwriteNames: !!cfg?.overwriteNames,
        overwritePrices: !!cfg?.overwritePrices,
        overwriteStock: !!cfg?.overwriteStock,
        defaultCategoryId: categoryId,
        defaultWarehouseId: warehouseId,
        branchIds,
        systemUserId: user?.id || null,
        // Chỗ nhớ chung cho cả lượt: hoá đơn ghi vào, sổ quỹ đọc ra để khỏi
        // tạo lại phiếu thu đã tính vào hoá đơn
        invoicePaymentCodes: new Set<string>(),
        // Khách seed trong lượt này — bước hoá đơn tra để khỏi cộng nợ đếm đôi
        seededCustomerIds: new Set<string>(),
    }
}

/** Thân đợt đồng bộ. Chạy nền, cập nhật tiến độ vào KiotVietSyncLog. */
export async function runSync(
    sp: any, cfg: any, entities: string[],
    fromDate: Date | null, toDate: Date | null, apply: boolean, logId: string,
    /**
     * Dựng lại dòng hàng hoá đơn ĐÃ CÓ theo payload KiotViet (sửa dữ liệu đổ
     * sai). CHỈ nhận từ body lần bấm tay, không lưu vào config — lưu là quên
     * tắt, rồi webhook nào về cũng xoá-tạo lại dòng của hoá đơn cũ.
     */
    rebuildLines = false,
    /** Chỉ cập nhật phiếu đã có — xem ghi chú ở SyncOptions.updateOnly */
    updateOnly = false,
): Promise<void> {
    const baseOpts = await buildOptions(sp, cfg, apply)
    baseOpts.creds = credsOf(cfg)
    baseOpts.daTuoiNo = new Set<string>()
    baseOpts.rebuildLines = rebuildLines
    baseOpts.updateOnly = updateOnly
    const creds = credsOf(cfg)
    const totals = newCounters()

    // CHẠY TIẾP SAU KHI ĐỨT: nạp lại kết quả các loại ĐÃ XONG của lần trước rồi
    // bỏ qua chúng. Chạy lại vẫn an toàn (chống trùng), nhưng quét lại 24 nghìn
    // hoá đơn cho vui thì đợt nào cũng đứt ở đúng chỗ cũ.
    const prev = await sp.kiotVietSyncLog.findUnique({
        where: { id: logId }, select: { details: true },
    }).catch(() => null)
    const perEntity: Record<string, any> = (() => {
        try { return prev?.details ? JSON.parse(prev.details) : {} } catch { return {} }
    })()
    for (const v of Object.values(perEntity) as any[]) {
        if (!v?.xong) continue
        totals.fetched += v.layVe || 0; totals.created += v.taoMoi || 0
        totals.updated += v.capNhat || 0; totals.skipped += v.boQua || 0
        totals.failed += v.loi || 0
    }
    const conLai = entities.filter(e => !perEntity[e]?.xong)

    // NHỊP TIM: đóng dấu "còn sống" tối đa 3 giây một lần. Không có nó thì một
    // đợt chết giữa chừng vẫn hiện "đang chạy" vĩnh viễn.
    let lastBeat = 0
    let beating: string | null = null
    const opts: SyncOptions = {
        ...baseOpts,
        onProgress: (c) => {
            const now = Date.now()
            if (now - lastBeat < 3000) return
            lastBeat = now
            const snapshot = {
                fetched: totals.fetched + c.fetched, created: totals.created + c.created,
                updated: totals.updated + c.updated, skipped: totals.skipped + c.skipped,
                failed: totals.failed + c.failed,
            }
            void sp.kiotVietSyncLog.update({
                where: { id: logId },
                data: { ...snapshot, heartbeatAt: new Date(), entity: beating ? `${entities.join(',')} · đang xử lý ${beating}` : undefined },
            }).catch(() => { })
        },
    }

    // NHỊP TIM TRONG LÚC TẢI. Bước tải một loại có thể là 245 trang liên tiếp
    // (24k hoá đơn) — suốt thời gian đó vòng lặp xử lý chưa chạy nên không có
    // nhịp nào được đập, watchdog tưởng chết rồi khởi động lại → quay vòng mãi
    // không qua nổi bước tải (đo 06/08/2026). Đập theo TỪNG TRANG tải về.
    const pageOpts = {
        onPage: async (_items: any[], fetched: number, total: number) => {
            const now = Date.now()
            if (now - lastBeat < 3000) return
            lastBeat = now
            await sp.kiotVietSyncLog.update({
                where: { id: logId },
                data: {
                    heartbeatAt: new Date(),
                    entity: `${entities.join(',')} · đang tải ${beating} ${fetched}/${total}`,
                },
            }).catch(() => { })
        },
    }

    /**
     * KHOẢNG NGÀY CHỈ ÁP CHO CHỨNG TỪ, KHÔNG ÁP CHO DỮ LIỆU GỐC.
     *
     * Hàng hoá / khách / NCC là dữ liệu gốc: hoá đơn tháng 7/2026 vẫn có thể bán
     * một mã tạo từ 2022 chưa sửa lần nào. Trước đây tôi lọc cả ba theo
     * `lastModifiedFrom` = ngày bắt đầu người dùng chọn → HUTI chỉ lấy 2183/3338
     * mã đang kinh doanh, và 343 hoá đơn báo "mã hàng chưa có bên Kengi"
     * (đo 07/08/2026). Nay luôn quét TRỌN dữ liệu gốc — chỉ 3.581 mã, rẻ hơn
     * nhiều so với việc mất dòng hàng trên hoá đơn.
     */
    const lastModifiedFrom = kvDate(fromDate)

    for (const entity of conLai) {
        const c = newCounters()
        beating = entity
        // Đập một nhịp NGAY khi bắt đầu loại mới: bước tải dữ liệu về có thể mất
        // vài phút mà chưa có bản ghi nào chạy qua vòng lặp để đập nhịp.
        await sp.kiotVietSyncLog.update({
            where: { id: logId },
            data: { heartbeatAt: new Date(), entity: `${entities.join(',')} · đang tải ${entity}` },
        }).catch(() => { })
        try {
            if (entity === 'categories') {
                const raw = await KV.categories(creds)
                const r = await dongBoCayDanhMuc(sp, raw, { apply: opts.apply, overwriteNames: opts.overwriteNames })
                c.fetched = r.layVe
                c.created = r.taoMoi
                c.updated = r.noiCha
                c.skipped = r.giuNguyen + r.boQua
                c.failed = r.loi.length
                for (const e of r.loi.slice(0, 20)) c.errors.push(e)
                for (const m of r.mau) { if (c.samples.length < 10) c.samples.push(m) }
                // Phân bố cấp SAU khi chạy — nhìn là biết cây đã dựng hay còn phẳng
                c.errors.push(`Phân bố cấp: ${Object.entries(r.capSau).map(([k, v]) => `cấp ${k}: ${v}`).join(' · ') || '(không đọc được)'}`)
            } else if (entity === 'products') {
                const { items, truncated } = await KV.products(creds, {}, pageOpts)
                const filtered = items
                if (truncated) c.errors.push('Chạm trần 500 trang — thu hẹp khoảng ngày rồi chạy tiếp')
                await syncProducts(sp, filtered, opts, c)
            } else if (entity === 'customers') {
                const { items, truncated } = await KV.customers(creds, {}, pageOpts)
                const filtered = items
                if (truncated) c.errors.push('Chạm trần 500 trang — thu hẹp khoảng ngày rồi chạy tiếp')
                await syncCustomers(sp, filtered, opts, c)
            } else if (entity === 'suppliers') {
                const { items, truncated } = await KV.suppliers(creds, {}, pageOpts)
                const filtered = items
                if (truncated) c.errors.push('Chạm trần 500 trang — thu hẹp khoảng ngày rồi chạy tiếp')
                await syncSuppliers(sp, filtered, opts, c)
            } else if (entity === 'invoices') {
                // Hoá đơn CÓ tham số ngày chứng từ ở phía KiotViet → lọc tại nguồn,
                // nhẹ hơn nhiều so với kéo hết về rồi cắt.
                const { items, truncated } = await KV.invoices(creds, {
                    fromPurchaseDate: kvDate(fromDate),
                    toPurchaseDate: kvDate(toDate),
                }, pageOpts)
                const filtered = cutByDate(items, toDate, 'purchaseDate')
                if (truncated) c.errors.push('Chạm trần 500 trang — thu hẹp khoảng ngày rồi chạy tiếp')
                await syncInvoices(sp, filtered, opts, c)
            } else if (entity === 'returns') {
                const { items, truncated } = await KV.returns(creds, {
                    fromReturnDate: kvDate(fromDate),
                    toReturnDate: kvDate(toDate),
                    lastModifiedFrom,
                }, pageOpts)
                const filtered = cutByDate(items, toDate, 'returnDate', 'modifiedDate')
                if (truncated) c.errors.push('Chạm trần 500 trang — thu hẹp khoảng ngày rồi chạy tiếp')
                await syncReturns(sp, filtered, opts, c)
            } else if (entity === 'purchaseOrders') {
                const { items, truncated } = await KV.purchaseOrders(creds, {
                    fromPurchaseDate: kvDate(fromDate),
                    toPurchaseDate: kvDate(toDate),
                    lastModifiedFrom,
                }, pageOpts)
                const filtered = cutByDate(items, toDate, 'purchaseDate', 'modifiedDate')
                if (truncated) c.errors.push('Chạm trần 500 trang — thu hẹp khoảng ngày rồi chạy tiếp')
                await syncPurchaseOrders(sp, filtered, opts, c)
                /* LÀM TƯƠI PHẦN DƯ NỢ NCC ngay sau khi có phiếu nhập mới (18/08/2026, lib/congNoNcc.ts):
                 * bước NCC chạy TRƯỚC bước đơn nhập nên payable = kv.debt − Σ phiếu tính khi Σ chưa gồm PO
                 * mới hôm nay ⇒ hiển thị dư đúng bằng PO mới cho tới lượt đối chiếu đêm. Một lượt danh sách
                 * NCC (54 dòng) là rẻ; chỉ chạy khi thật sự tạo phiếu và cửa hàng có đồng bộ NCC. */
                if (opts.apply && (c.created > 0 || c.updated > 0) && cfg?.syncSuppliers !== false) {   // updated = phiếu đổi paidAmount theo KV
                    try {
                        const kq = await doiChieuNoNcc(sp, cfg, true)
                        if (kq.daSua > 0) console.log(`[KiotViet] sau ${c.created} phiếu nhập mới / ${c.updated} phiếu đổi thanh toán: làm tươi phần dư nợ NCC ${kq.daSua}/${kq.quet}`)
                    } catch (e: any) { c.errors.push(`làm tươi nợ NCC sau đơn nhập: ${errMsg(e)}`.slice(0, 200)) }
                }
            } else if (entity === 'cashflow') {
                /**
                 * SỔ QUỸ BẮT BUỘC PHẢI TRUYỀN NGÀY.
                 *
                 * Khác mọi endpoint còn lại, `/cashflow` KHÔNG hiểu "bỏ trống
                 * ngày = lấy tất cả" — nó tự áp một cửa sổ hẹp. Đo thật
                 * (08/08/2026): không truyền ngày → 67 bản ghi; truyền
                 * startDate=2026-01-01 → 3.221. Chọn "Toàn bộ" mà vẫn chỉ về
                 * vài chục phiếu chính là do đây.
                 * Hoá đơn / phiếu nhập / trả hàng thì bỏ trống vẫn ra đủ.
                 */
                const MOC_XA_NHAT = new Date('2010-01-01T00:00:00Z')
                const { items, truncated } = await KV.cashflow(creds, {
                    startDate: kvDate(fromDate || MOC_XA_NHAT),
                    endDate: kvDate(toDate || new Date()),
                    lastModifiedFrom,
                }, pageOpts)
                const filtered = cutByDate(items, toDate, 'transDate', 'modifiedDate')
                if (truncated) c.errors.push('Chạm trần 500 trang — thu hẹp khoảng ngày rồi chạy tiếp')
                await syncCashflow(sp, filtered, opts, c)
            }
        } catch (e: any) {
            c.failed++
            c.errors.push(`${entity}: ${errMsg(e)}`.slice(0, 300))
        }

        perEntity[entity] = {
            layVe: c.fetched, taoMoi: c.created, capNhat: c.updated,
            boQua: c.skipped, loi: c.failed, mau: c.samples,
            // Lỗi phải nằm NGAY trong khối của từng loại. Trước đây chỉ gom vào
            // trường errors ghi ở CUỐI đợt, nên đợt chạy dở hiện "lỗi 2183" mà
            // không có lấy một dòng giải thích (dính 06/08/2026).
            loiChiTiet: c.errors.slice(0, 10),
            // Cột mốc để lần chạy tiếp biết loại này khỏi phải làm lại
            xong: true,
        }
        totals.fetched += c.fetched; totals.created += c.created; totals.updated += c.updated
        totals.skipped += c.skipped; totals.failed += c.failed
        totals.errors.push(...c.errors.map(x => `[${entity}] ${x}`))

        // Cập nhật tiến độ sau mỗi loại để trang admin thấy chạy tới đâu
        await sp.kiotVietSyncLog.update({
            where: { id: logId },
            data: {
                fetched: totals.fetched, created: totals.created, updated: totals.updated,
                skipped: totals.skipped, failed: totals.failed,
                details: JSON.stringify(perEntity).slice(0, 60000),
                errors: totals.errors.join('\n').slice(0, 4000) || null,
                heartbeatAt: new Date(),
                // XONG MỘT LOẠI = CÓ TIẾN TRIỂN → trả bộ đếm bỏ cuộc về 0.
                // Trần 5 lượt là để chặn quay vòng tại chỗ, không phải để chặn
                // một đợt dài đang đi tới bị thay máy vài lần.
                attempts: 0,
            },
        }).catch(() => { })
    }

    await sp.kiotVietSyncLog.update({
        where: { id: logId },
        data: {
            status: totals.failed ? 'partial' : 'success',
            fetched: totals.fetched, created: totals.created, updated: totals.updated,
            skipped: totals.skipped, failed: totals.failed,
            errors: totals.errors.join('\n').slice(0, 4000) || null,
            details: JSON.stringify(perEntity).slice(0, 60000),
            entity: entities.join(','),
            heartbeatAt: new Date(),
            finishedAt: new Date(),
        },
    }).catch(() => { })

    if (apply) {
        await sp.kiotVietConfig.update({ where: { id: 'default' }, data: { lastSyncAt: new Date() } }).catch(() => { })
    }
}

/**
 * Cắt cận trên theo ngày. KiotViet chỉ có "từ ngày" cho hàng hoá/khách/NCC nên
 * "đến ngày" người dùng chọn phải được tôn trọng ở phía mình — bỏ qua bước này
 * là đổ cả dữ liệu ngoài khoảng đã chọn, sai ý người dùng.
 */
function cutByDate(items: any[], toDate: Date | null, ...dateFields: string[]): any[] {
    if (!toDate) return items
    const limit = toDate.getTime()
    return items.filter(it => {
        for (const f of dateFields) {
            const v = it?.[f]
            if (!v) continue
            const t = new Date(v).getTime()
            if (!isNaN(t)) return t <= limit
        }
        return true   // không có trường ngày nào → giữ lại, thà thừa còn hơn mất
    })
}

/* ─── ĐỐI CHIẾU NỢ KHÁCH VỚI KIOTVIET ────────────────────────────────────────
 *
 * Phát hiện 18/08/2026 (HUTI): 39/593 khách có Kengi.debt = 0 trong khi KiotViet
 * nói > 0 — tổng 857,7 triệu nợ bị giấu, riêng Phúc Hải 220 triệu. Cơ chế làm
 * tươi theo chứng từ (lamTuoiNoKhach) hụt một nhịp là khách kẹt số cũ tới chứng
 * từ kế tiếp; khách ít mua thì "kế tiếp" là hàng tuần. Đây là lưới an toàn: quét
 * toàn bộ khách có ánh xạ, hỏi KiotViet từng người, lệch thì ghi lại đúng số KV.
 * Chỉ ghi Customer.debt (không sinh DebtEntry — sổ lịch sử neo vào debt rồi chạy
 * ngược, cùng cách lamTuoiNoKhach làm). Tuần tự + nghỉ 120ms để không đập KV.
 */
export interface KetQuaDoiChieuNo {
    quet: number; khop: number; lech: number; loiKV: number; kvKhongCoDebt: number
    tongChenh: number; daSua: number; ms: number
    danhSachLech: Array<{ code: string; name: string; kengi: number; kiotviet: number; chenh: number; localId: string; kvId: string; daSua?: boolean; suaLoi?: boolean; ghiChu?: string }>
    /** Mẫu (≤30) khách KV trả HTTP 200 mà không có `debt` hữu hạn — lượt 18/08 đếm 26 mà
     *  không ghi ai, nên không phân biệt được "đã xoá bên KV" với "KV bỏ trống trường".
     *  Ghi các khoá JSON nhận được + responseStatus để lần được. */
    mauKhongDebt?: Array<{ code: string; name: string; kvId: string; kengiDebt: number; khoa: string[]; trangThai: any }>
    mauLoiKV?: Array<{ code: string; kvId: string; loi: string }>
}

export async function doiChieuNoKhach(sp: any, cfg: any, apply: boolean, tran = 5000): Promise<KetQuaDoiChieuNo> {   // trần 800 cũ bỏ sót phần đuôi khi cửa hàng > 800 khách ánh xạ
    const creds = credsOf(cfg)
    const t0 = Date.now()
    const maps: any[] = await sp.kiotVietMap.findMany({ where: { entity: 'customer' }, select: { kvId: true, localId: true }, orderBy: { kvId: 'asc' }, take: tran })
    const ids = maps.map((m: any) => m.localId)
    const khs: any[] = ids.length ? await sp.customer.findMany({ where: { id: { in: ids } }, select: { id: true, code: true, name: true, debt: true } }) : []
    const theoId = new Map(khs.map((k: any) => [k.id, k]))
    const lech: KetQuaDoiChieuNo['danhSachLech'] = []
    let khop = 0, loiKV = 0, kvKhongCoDebt = 0, soCoDebt = 0
    const choVeKhong: Array<{ id: string; dong: KetQuaDoiChieuNo['danhSachLech'][number] }> = []   // KV bỏ trống debt, Kengi ≠ 0 — xử sau khi biết key có thấy debt
    const mauKhongDebt: NonNullable<KetQuaDoiChieuNo['mauKhongDebt']> = []
    const mauLoiKV: NonNullable<KetQuaDoiChieuNo['mauLoiKV']> = []
    for (const m of maps) {
        const kh = theoId.get(m.localId); if (!kh) continue
        try {
            const kv: any = await KV.customerById(creds, m.kvId)
            const thoDebt = kv?.debt ?? kv?.data?.debt
            const coDebt = thoDebt !== undefined && thoDebt !== null && Number.isFinite(Number(thoDebt))
            // Đo HUTI 18/08 (mẫu 26/26): KV trả bản ghi khách đầy đủ (id, code, name, address…) nhưng
            // BỎ HẲN khoá `debt` khi nợ rỗng — và Kengi cũng 0 ở cả 26. Coi là 0 để SO. Tự ghi 0 CHỈ KHI
            // cùng key này đã thấy `debt` ở khách khác trong lượt (loại trừ "key thiếu quyền xem công nợ");
            // không thì gắn ghi chú chờ người xác nhận. Không sửa thì khách ĐÃ TRẢ HẾT vẫn hiện nợ mãi
            // (KV bỏ trống khi = 0) — tố oan chiều ngược. Lỡ KV bỏ trống thoáng qua thì lượt đêm sau /
            // chứng từ kế tiếp trả lại số thật. Bản ghi không có cả `id` = không phải khách → bỏ qua, chỉ đếm.
            const laKhachThat = !!kv && typeof kv === 'object' && kv.id !== undefined
            if (coDebt) soCoDebt++
            const d = coDebt ? Number(thoDebt) : (laKhachThat ? 0 : NaN)
            if (!coDebt) {
                kvKhongCoDebt++
                if (mauKhongDebt.length < 30) mauKhongDebt.push({ code: kh.code, name: kh.name, kvId: String(m.kvId), kengiDebt: Number(kh.debt) || 0,
                    khoa: Object.keys(kv && typeof kv === 'object' ? kv : {}).slice(0, 20), trangThai: kv?.responseStatus ?? kv?.message ?? (kv === null ? 'null' : typeof kv) })
                if (!Number.isFinite(d)) continue
            }
            const kd = Number(kh.debt) || 0
            if (Math.abs(d - kd) <= 1) { khop++; continue }
            const dong: KetQuaDoiChieuNo['danhSachLech'][number] = { code: kh.code, name: kh.name, kengi: kd, kiotviet: d, chenh: Math.round(d - kd), localId: kh.id, kvId: String(m.kvId),
                ...(coDebt ? {} : { ghiChu: 'KV không có trường debt (coi là 0)' }) }
            if (apply && coDebt) {
                await sp.customer.update({ where: { id: kh.id }, data: { debt: d } }).then(() => { dong.daSua = true }).catch(() => { dong.suaLoi = true })
            }
            if (!coDebt) choVeKhong.push({ id: kh.id, dong })
            lech.push(dong)
        } catch (e: any) {
            loiKV++
            if (mauLoiKV.length < 10) mauLoiKV.push({ code: kh.code, kvId: String(m.kvId), loi: String(e?.message || e).slice(0, 200) })
        }
        await new Promise(r => setTimeout(r, 120))
    }
    // KV bỏ trống debt mà Kengi ≠ 0: key này thấy debt ở ≥1 khách khác ⇒ bỏ trống = 0 thật ⇒ trả về 0.
    for (const { id, dong } of choVeKhong) {
        if (soCoDebt > 0) {
            /* Bảo hiểm: KV có thể bỏ trống THOÁNG QUA — ghi 0 sai là lặp lại đúng lỗi giấu nợ. Khách này
             * đang có nợ trong sổ nên hỏi KV LẦN HAI sau 600ms; lần hai có debt thì dùng số đó, vẫn trống mới về 0. */
            await new Promise(r => setTimeout(r, 600))
            const kv2: any = await KV.customerById(creds, dong.kvId).catch(() => null)
            const tho2 = kv2?.debt ?? kv2?.data?.debt
            if (tho2 !== undefined && tho2 !== null && Number.isFinite(Number(tho2))) {
                const d2 = Number(tho2)
                dong.kiotviet = d2; dong.chenh = Math.round(d2 - dong.kengi); dong.ghiChu = `lần 1 KV bỏ trống debt, lần 2 trả ${d2} — dùng lần 2`
                if (Math.abs(d2 - dong.kengi) <= 1) { dong.ghiChu += ' (khớp)'; (dong as any).khopLan2 = true; khop++; continue }   // không phải lệch — rút khỏi danh sách
                if (apply) await sp.customer.update({ where: { id }, data: { debt: d2 } }).then(() => { dong.daSua = true }).catch(() => { dong.suaLoi = true })
                continue
            }
            dong.ghiChu = `KV không có trường debt ở CẢ HAI lần hỏi = 0 (key thấy debt ở ${soCoDebt} khách khác)`
            if (apply) await sp.customer.update({ where: { id }, data: { debt: 0 } }).then(() => { dong.daSua = true }).catch(() => { dong.suaLoi = true })
        } else {
            dong.ghiChu = 'KV không có trường debt ở MỌI khách — nghi key thiếu quyền, không tự sửa, cần người xác nhận'
        }
    }
    const lechCuoi = lech.filter(x => !(x as any).khopLan2)
    lechCuoi.sort((a, b) => Math.abs(b.chenh) - Math.abs(a.chenh))
    return { quet: maps.length, khop, lech: lechCuoi.length, loiKV, kvKhongCoDebt,
        tongChenh: lechCuoi.reduce((s, x) => s + x.chenh, 0), daSua: lechCuoi.filter(x => x.daSua).length, ms: Date.now() - t0, danhSachLech: lechCuoi,
        mauKhongDebt, mauLoiKV }
}

/* ─── ĐỐI CHIẾU CÔNG NỢ PHẢI TRẢ NCC VỚI KIOTVIET ─────────────────────────────
 * Đo HUTI 18/08/2026: 6/54 NCC lệch, tổng 325,7 triệu Kengi hiển thị THẤP hơn KV
 * (Thanh Ngân 3,435 tỷ vs 3,650 tỷ). Gốc: đồng bộ NCC chỉ ghi payable khi Kengi
 * đang 0 (`!existing.payable`), nên KV đổi sau lần đầu là Kengi kẹt số cũ.
 * NCC ít và danh sách KV mang sẵn debt → MỘT lượt danh sách, không gọi từng id.
 *
 * SO CÁI GÌ (sửa 17:40 VN 18/08): so CÔNG NỢ HIỂN THỊ của Kengi (payable + Σ phiếu chưa
 * trả — công thức trang danh sách NCC, lib/congNoNcc.ts) với kv.debt, KHÔNG so payable trần.
 * Bản đầu so payable ↔ kv.debt rồi apply ghi payable = kv.debt ⇒ payable thành TỔNG nợ KV
 * (đã gồm PO) + trang danh sách cộng thêm Σ phiếu ⇒ ĐẾM ĐÔI (HUTI hiện 40,49 tỷ = 20,15 +
 * 20,34, KV nói 20,15). Apply nay ghi payable = kv.debt − Σ phiếu chưa trả (số dư đầu kỳ). */
export async function doiChieuNoNcc(sp: any, cfg: any, apply: boolean): Promise<KetQuaDoiChieuNo & { kvDanhSach: number; kvCoTruongDebt: number }> {
    const t0 = Date.now()
    const kvRes: any = await KV.suppliers(credsOf(cfg), {}, { pageSize: 100, maxPages: 20 })
    const kvList: any[] = Array.isArray(kvRes) ? kvRes : (kvRes?.items ?? [])
    const kvCoTruongDebt = kvList.filter(k => k && k.debt !== undefined && k.debt !== null).length
    const maps: any[] = await sp.kiotVietMap.findMany({ where: { entity: 'supplier' }, select: { kvId: true, localId: true } })
    const kvTheoId = new Map(kvList.map(k => [String(k.id), k]))
    const ids = maps.map(m => m.localId)
    const nccs: any[] = ids.length ? await sp.supplier.findMany({ where: { id: { in: ids } }, select: { id: true, code: true, name: true, payable: true } }) : []
    const nccTheoId = new Map(nccs.map(n => [n.id, n]))
    const phieuTheoNcc = await tongPhieuChuaTraTheoNcc(sp, ids)
    const lech: KetQuaDoiChieuNo['danhSachLech'] = []
    let khop = 0, loiKV = 0, kvKhongCoDebt = 0
    /* NCC KV BỎ TRỐNG debt (= đã trả hết, KV bỏ khoá khi 0 — như 26 khách đo 18/08) mà Kengi vẫn hiển thị nợ:
     * bản đầu `continue` ⇒ không có đường nào về 0, NCC trả hết vẫn treo nợ mãi (rà soát độc lập 19/08/2026).
     * Cùng luật với khách: chỉ coi = 0 khi key này thấy debt ở NCC khác (kvCoTruongDebt > 0) VÀ tải danh sách
     * LẦN HAI vẫn trống — rồi payable = 0 − Σ phiếu (phần dư). */
    const nccChoVeKhong: Array<{ ncc: any; kvId: string; phieu: number; kd: number }> = []
    for (const m of maps) {
        const ncc = nccTheoId.get(m.localId); const kv = kvTheoId.get(String(m.kvId))
        if (!ncc) continue
        if (!kv) { loiKV++; continue }
        const d = Number(kv.debt)
        if (kv.debt === undefined || kv.debt === null || !Number.isFinite(d)) {
            kvKhongCoDebt++
            const phieu0 = phieuTheoNcc.get(ncc.id)?.tong || 0
            const kd0 = congNoChuaKep(Number(ncc.payable) || 0, phieu0)
            if (Math.abs(kd0) > 1 && kv.id !== undefined) nccChoVeKhong.push({ ncc, kvId: String(m.kvId), phieu: phieu0, kd: kd0 })
            else khop++   // hai bên cùng 0
            continue
        }
        const phieu = phieuTheoNcc.get(ncc.id)?.tong || 0
        const kd = congNoChuaKep(Number(ncc.payable) || 0, phieu)   // Kengi HIỂN THỊ (chưa kẹp) — không phải payable trần
        if (Math.abs(d - kd) <= 1) { khop++; continue }
        const dong: KetQuaDoiChieuNo['danhSachLech'][number] = { code: ncc.code, name: ncc.name, kengi: kd, kiotviet: d, chenh: Math.round(d - kd), localId: ncc.id, kvId: String(m.kvId),
            ghiChu: `payable ${Math.round(Number(ncc.payable) || 0)} + phiếu chưa trả ${Math.round(phieu)}` }
        if (apply) await sp.supplier.update({ where: { id: ncc.id }, data: { payable: soDuDauKyTuKV(d, phieu) } }).then(() => { dong.daSua = true }).catch(() => { dong.suaLoi = true })
        lech.push(dong)
    }
    if (nccChoVeKhong.length) {
        if (kvCoTruongDebt > 0) {
            await new Promise(r => setTimeout(r, 600))
            const kvRes2: any = await KV.suppliers(credsOf(cfg), {}, { pageSize: 100, maxPages: 20 }).catch(() => null)
            const kvList2: any[] = kvRes2 ? (Array.isArray(kvRes2) ? kvRes2 : (kvRes2?.items ?? [])) : []
            const kv2TheoId = new Map(kvList2.map((k: any) => [String(k.id), k]))
            for (const x of nccChoVeKhong) {
                const kv2: any = kv2TheoId.get(x.kvId)
                const d2 = kv2 && kv2.debt !== undefined && kv2.debt !== null && Number.isFinite(Number(kv2.debt)) ? Number(kv2.debt) : null
                const dong: KetQuaDoiChieuNo['danhSachLech'][number] = { code: x.ncc.code, name: x.ncc.name, kengi: x.kd, kiotviet: d2 ?? 0, chenh: Math.round((d2 ?? 0) - x.kd), localId: x.ncc.id, kvId: x.kvId }
                if (d2 !== null) {
                    dong.ghiChu = `lần 1 KV bỏ trống debt, lần 2 trả ${d2} — dùng lần 2`
                    if (Math.abs(d2 - x.kd) <= 1) { khop++; continue }
                    if (apply) await sp.supplier.update({ where: { id: x.ncc.id }, data: { payable: soDuDauKyTuKV(d2, x.phieu) } }).then(() => { dong.daSua = true }).catch(() => { dong.suaLoi = true })
                } else if (!kvList2.length) {
                    dong.ghiChu = 'KV bỏ trống debt, tải lại danh sách lần hai thất bại — giữ số cũ, không đoán'
                } else {
                    dong.ghiChu = `KV không có trường debt ở CẢ HAI lần tải = 0 (key thấy debt ở ${kvCoTruongDebt} NCC khác) → payable = 0 − phiếu`
                    if (apply) await sp.supplier.update({ where: { id: x.ncc.id }, data: { payable: soDuDauKyTuKV(0, x.phieu) } }).then(() => { dong.daSua = true }).catch(() => { dong.suaLoi = true })
                }
                lech.push(dong)
            }
        } else {
            for (const x of nccChoVeKhong) lech.push({ code: x.ncc.code, name: x.ncc.name, kengi: x.kd, kiotviet: 0, chenh: -x.kd, localId: x.ncc.id, kvId: x.kvId, ghiChu: 'KV không có trường debt ở MỌI NCC — nghi key thiếu quyền, không tự sửa' })
        }
    }
    lech.sort((a, b) => Math.abs(b.chenh) - Math.abs(a.chenh))
    return { quet: maps.length, khop, lech: lech.length, loiKV, kvKhongCoDebt, kvDanhSach: kvList.length, kvCoTruongDebt,
        tongChenh: lech.reduce((s, x) => s + x.chenh, 0), daSua: lech.filter(x => x.daSua).length, ms: Date.now() - t0, danhSachLech: lech }
}
