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
import { KV, kvDate, type KiotVietCreds } from './kiotviet'
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
export const SYNC_ENTITIES = ['products', 'customers', 'suppliers', 'invoices', 'returns', 'purchaseOrders', 'cashflow'] as const

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

    for (const store of stores) {
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

// ─── Tuỳ chọn đồng bộ dùng chung cho cả chạy tay lẫn webhook ────────────────
export async function buildOptions(sp: any, cfg: any, apply: boolean): Promise<SyncOptions> {
    // Kho đích: ưu tiên kho đã chọn, không có thì lấy kho main mặc định
    let warehouseId: string | null = cfg?.defaultWarehouseId || null
    if (!warehouseId) {
        const wh = await sp.warehouse.findFirst({
            where: { type: 'main', isActive: true },
            orderBy: { isDefault: 'desc' }, select: { id: true },
        }).catch(() => null)
        warehouseId = wh?.id || null
    }
    // Nhóm hàng mặc định cho sản phẩm mới
    let categoryId: string | null = cfg?.defaultCategoryId || null
    if (!categoryId) {
        const cat = await sp.category.findFirst({ select: { id: true }, orderBy: { createdAt: 'asc' } }).catch(() => null)
        categoryId = cat?.id || null
    }
    // Transaction.createdBy là khoá ngoại bắt buộc → phải có một user thật
    const user = await sp.user.findFirst({
        where: { role: { in: ['admin', 'owner', 'manager'] } }, select: { id: true },
        orderBy: { createdAt: 'asc' },
    }).catch(() => null)

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
            if (entity === 'products') {
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
