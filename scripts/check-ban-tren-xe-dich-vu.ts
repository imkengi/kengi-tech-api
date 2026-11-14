/**
 * Bộ soát BÁN DỊCH VỤ TRÊN XE (bán hàng lưu động) — 14/11/2026.
 *   npx tsx scripts/check-ban-tren-xe-dich-vu.ts
 *
 * Sự cố: đơn bán trên xe (POS gửi x-warehouse-id = kho xe, kèm x-sales-trip-id) trừ WarehouseStock kho xe với chốt
 * `quantity >= n` cho MỌI dòng, kể cả DỊCH VỤ (productType 'service' — không có tồn thật, không ai chất lên xe)
 * ⇒ đơn xe có dịch vụ bị 409 "Sản phẩm X chỉ còn 0 trên xe". Cùng bệnh ở POST /transactions/:id/convert-to-van
 * (409) và POST /sales-trips/:id/sales (400 "Trên xe không đủ"). Bản vá quầy 78736a5 (check:ban-dich-vu-ton) chưa
 * phủ đường xe.
 *
 * Quy ước sau bản vá:
 *   - Dòng DỊCH VỤ của đơn xe đi ĐƯỜNG QUẦY (trừ Product.stock + kho chính, không chặn) — Huỷ đơn (kể cả đơn xe)
 *     hoàn về đúng Product.stock + kho chính ⇒ trừ chỗ đó thì huỷ mới khớp, không đẻ tồn ma.
 *   - Không trừ kho xe, không vào SalesTripItem. SalesTrip.totalSold chỉ đếm ĐƠN VỊ HÀNG HOÁ (cùng thước với
 *     totalLoaded / Σ soldQty); totalRevenue cộng TRỌN tiền đơn, kể cả dịch vụ.
 *   - Không chất dịch vụ lên xe (tạo chuyến + /load) — "còn lại" khi dỡ hàng (chất − bán) luôn = hàng thật trên xe.
 *   - Hàng hoá giữ NGUYÊN chốt: bán vượt số trên xe vẫn bị chặn, kể cả khi cửa hàng cho bán âm kho.
 *
 * Không DB: chạy middleware (bỏ authMiddleware, gắn sẵn req.user) + handler THẬT với storePrisma giả CÓ TRẠNG THÁI
 * (Product.stock, WarehouseStock từng kho, SalesTrip/SalesTripItem, phiếu, thẻ kho, nhật ký chuyến). $transaction
 * chụp trạng thái rồi TRẢ LẠI khi ném lỗi — như Postgres rollback — nên ca "bị chặn" soát được cả "không đổi gì".
 */
import transactionsRouter from '../src/routes/transactions'
import salesTripsRouter from '../src/routes/salesTrips'

let loi = 0, tong = 0
const dung = (ten: string, ok: boolean, chiTiet?: unknown) => {
    tong++
    if (!ok) loi++
    console.log(`${ok ? '✓' : '✗'} ${ten}${!ok && chiTiet !== undefined ? ' — ' + JSON.stringify(chiTiet) : ''}`)
}

const cacBuoc = (router: any, method: string, duong: string): Function[] =>
    router.stack.find((l: any) => l.route?.path === duong && l.route.methods[method])?.route.stack.map((l: any) => l.handle) || []

type Sp = { id: string; name: string; sku: string; productType: 'goods' | 'service'; stock: number; costPrice: number; sellingPrice: number; baseUnit: string }

const KHO_CHINH = 'kho-chinh', KHO_XE = 'kho-xe', CHUYEN = 'chuyen1', CN = 'cn1'

const SP: Sp[] = [
    { id: 'p1', name: 'Nước suối Lavie', sku: 'LV500', productType: 'goods', stock: 50, costPrice: 4000, sellingPrice: 6000, baseUnit: 'Chai' },
    { id: 'p2', name: 'Bánh quy Cosy', sku: 'CS01', productType: 'goods', stock: 10, costPrice: 15000, sellingPrice: 20000, baseUnit: 'Hộp' },
    { id: 's1', name: 'Phí giao hàng', sku: 'DV-GH', productType: 'service', stock: 0, costPrice: 0, sellingPrice: 15000, baseUnit: 'Lần' },
    // Dịch vụ có ai đó gõ tồn dương — bản cũ cho chất lên xe được
    { id: 's2', name: 'Dịch vụ lắp đặt', sku: 'DV-LD', productType: 'service', stock: 10, costPrice: 0, sellingPrice: 50000, baseUnit: 'Lần' },
]
const [p1, p2, s1, s2] = SP

type Db = {
    sp: Map<string, Sp>
    ton: Map<string, number> // `${kho}|${sp}` → WarehouseStock.quantity
    chuyen: Map<string, any>
    dongChuyen: Map<string, any> // `${chuyen}|${sp}` → SalesTripItem
    don: Map<string, any>
    theKho: any[]
    nhatKy: any[]
    choBanAm: boolean
    soPhieu: number
    soMa: number
}

/** Chuyến đang chạy: đã chất 5 chai Lavie lên xe (Product.stock + kho chính đã trừ còn 50). Bánh Cosy không có trên xe. */
function taoDb(choBanAm = false): Db {
    return {
        sp: new Map(SP.map((p) => [p.id, { ...p }])),
        ton: new Map([
            // kho chính = Product.stock (bất biến)
            ...SP.map((p) => [`${KHO_CHINH}|${p.id}`, p.stock] as [string, number]),
            [`${KHO_XE}|p1`, 5],
        ]),
        chuyen: new Map([[CHUYEN, {
            id: CHUYEN, code: 'TRIP-00001', status: 'active', warehouseId: KHO_XE, branchId: CN, vehicleId: 'xe1',
            salesUserId: 'u1', totalLoaded: 5, totalSold: 0, totalReturned: 0, totalRevenue: 0, notes: null,
        }]]),
        dongChuyen: new Map([[`${CHUYEN}|p1`, {
            tripId: CHUYEN, productId: 'p1', productName: p1.name, productSku: p1.sku,
            loadedQty: 5, soldQty: 0, returnedQty: 0, actualQty: 0, damagedQty: 0, unitPrice: 6000, notes: null,
        }]]),
        don: new Map(),
        theKho: [],
        nhatKy: [],
        choBanAm,
        soPhieu: 0,
        soMa: 0,
    }
}

const doiSo = (cu: number, d: any): number => {
    if (typeof d === 'number') return d
    if (d?.increment !== undefined) return cu + d.increment
    if (d?.decrement !== undefined) return cu - d.decrement
    if (d?.set !== undefined) return d.set
    return cu
}
const laPhepSo = (v: any) => v !== null && typeof v === 'object' && !(v instanceof Date)
const apDung = (dich: any, data: Record<string, any>) => {
    for (const [k, v] of Object.entries(data)) {
        if (v === undefined) continue
        dich[k] = laPhepSo(v) ? doiSo(Number(dich[k]) || 0, v) : v
    }
}
const khongThay = () => Object.assign(new Error('Record to update not found.'), { code: 'P2025' })

function taoPrismaGia(db: Db) {
    const goi: string[] = []
    const khoa = (kho: string, sp: string) => `${kho}|${sp}`
    const dongTon = (kho: string, spId: string) => db.ton.has(khoa(kho, spId))
        ? { warehouseId: kho, productId: spId, productName: db.sp.get(spId)?.name ?? '', productSku: db.sp.get(spId)?.sku ?? null, quantity: db.ton.get(khoa(kho, spId))! }
        : null
    const spRa = (p: Sp) => ({ ...p, unitConversions: [] })
    const chuyenRa = (t: any) => ({
        ...t,
        items: [...db.dongChuyen.values()].filter((d) => d.tripId === t.id).map((d) => ({ ...d })),
        vehicle: { id: t.vehicleId, code: 'XE01' },
        warehouse: { id: t.warehouseId, code: 'WH-VEH-XE01', name: 'Kho xe', type: 'mobile' },
    })
    const KHO_CHINH_ROW = { id: KHO_CHINH, code: 'WH-MAIN', name: 'Kho chính', type: 'main', isDefault: true, isActive: true, branchId: CN }
    const KHO_XE_ROW = { id: KHO_XE, code: 'WH-VEH-XE01', name: 'Kho xe', type: 'mobile', isDefault: false, isActive: true, branchId: CN, vehicleId: 'xe1' }

    const M: Record<string, Record<string, (a: any) => any>> = {
        user: { findUnique: () => ({ id: 'u1', name: 'Tài xế Bán Hàng', permissions: '[]' }), findFirst: () => null },
        transaction: {
            count: () => db.don.size,
            create: (a) => {
                const id = `don${++db.soPhieu}`
                const items = (a.data.items?.create || []).map((it: any, i: number) => ({
                    id: `${id}-d${i}`, transactionId: id, ...it, product: { costPrice: db.sp.get(it.productId)?.costPrice ?? 0 },
                }))
                const don = {
                    customerId: null, returnedAt: null, transactionDate: null, ...a.data,
                    id, items, payments: a.data.payments?.create || [], createdAt: new Date(),
                }
                db.don.set(id, don)
                return structuredClone(don)
            },
            findUnique: (a) => (db.don.has(a.where.id) ? structuredClone(db.don.get(a.where.id)) : null),
            update: (a) => {
                const d = db.don.get(a.where.id)
                if (!d) throw khongThay()
                apDung(d, a.data)
                return structuredClone(d)
            },
        },
        product: {
            findMany: (a) => (a?.where?.id?.in || []).map((id: string) => db.sp.get(id)).filter(Boolean).map(spRa),
            findUnique: (a) => (db.sp.has(a.where.id) ? spRa(db.sp.get(a.where.id)!) : null),
            update: (a) => {
                const p = db.sp.get(a.where.id)
                if (!p) throw khongThay()
                p.stock = doiSo(p.stock, a.data.stock)
                return spRa(p)
            },
            updateMany: (a) => {
                const p = db.sp.get(a.where.id)
                if (!p) return { count: 0 }
                if (a.where.stock?.gte !== undefined && p.stock < a.where.stock.gte) return { count: 0 }
                p.stock = doiSo(p.stock, a.data.stock)
                return { count: 1 }
            },
        },
        storeSettings: { findFirst: () => ({ allowNegativeStock: db.choBanAm, autoCreateJournalEntries: false }) },
        branch: {
            findFirst: () => ({ id: CN, name: 'Chi nhánh chính' }),
            findUnique: () => ({ id: CN, name: 'Chi nhánh chính', isMainBranch: true }),
        },
        warehouse: {
            findFirst: (a) => (a?.where?.type === 'main' ? { ...KHO_CHINH_ROW } : a?.where?.vehicleId ? { ...KHO_XE_ROW } : null),
            findUnique: (a) => (a.where.id === KHO_XE ? { ...KHO_XE_ROW } : a.where.id === KHO_CHINH ? { ...KHO_CHINH_ROW } : null),
            findMany: () => [],
        },
        warehouseStock: {
            findUnique: (a) => dongTon(a.where.warehouseId_productId.warehouseId, a.where.warehouseId_productId.productId),
            findMany: (a) => (a?.where?.productId?.in || []).map((id: string) => dongTon(a.where.warehouseId, id)).filter(Boolean),
            updateMany: (a) => {
                const k = khoa(a.where.warehouseId, a.where.productId)
                if (!db.ton.has(k)) return { count: 0 }
                if (a.where.quantity?.gte !== undefined && db.ton.get(k)! < a.where.quantity.gte) return { count: 0 }
                db.ton.set(k, doiSo(db.ton.get(k)!, a.data.quantity))
                return { count: 1 }
            },
            update: (a) => {
                const w = a.where.warehouseId_productId
                const k = khoa(w.warehouseId, w.productId)
                if (!db.ton.has(k)) throw khongThay()
                db.ton.set(k, doiSo(db.ton.get(k)!, a.data.quantity))
                return dongTon(w.warehouseId, w.productId)
            },
            upsert: (a) => {
                const w = a.where.warehouseId_productId
                const k = khoa(w.warehouseId, w.productId)
                db.ton.set(k, db.ton.has(k) ? doiSo(db.ton.get(k)!, a.update.quantity) : a.create.quantity)
                return dongTon(w.warehouseId, w.productId)
            },
        },
        inventoryTransaction: { create: (a) => { db.theKho.push({ ...a.data }); return a.data } },
        salesTrip: {
            // Chỉ bản CŨ đi tới đây ở ca D3 (chất dịch vụ lúc tạo chuyến) — để thử ngược đỏ đúng lý do "đã chất được"
            create: (a) => {
                const t = { totalSold: 0, totalReturned: 0, totalRevenue: 0, ...a.data, id: 'chuyen2', items: undefined }
                db.chuyen.set(t.id, t)
                for (const it of a.data.items?.create || []) db.dongChuyen.set(`${t.id}|${it.productId}`, { tripId: t.id, soldQty: 0, returnedQty: 0, ...it })
                return chuyenRa(t)
            },
            findUnique: (a) => (db.chuyen.has(a.where.id) ? { ...db.chuyen.get(a.where.id) } : null),
            // Chỉ tra theo id: không có "chuyến đang mở khác" của xe ⇒ tạo chuyến đi tới bước soát hàng
            findFirst: (a) => (a?.where?.id && db.chuyen.has(a.where.id) ? chuyenRa(db.chuyen.get(a.where.id)) : null),
            update: (a) => {
                const t = db.chuyen.get(a.where.id)
                if (!t) throw khongThay()
                apDung(t, a.data)
                return chuyenRa(t)
            },
        },
        salesTripItem: {
            upsert: (a) => {
                const w = a.where.tripId_productId
                const k = `${w.tripId}|${w.productId}`
                const cu = db.dongChuyen.get(k)
                if (cu) apDung(cu, a.update)
                else db.dongChuyen.set(k, { loadedQty: 0, soldQty: 0, returnedQty: 0, actualQty: 0, damagedQty: 0, ...a.create })
                return { ...db.dongChuyen.get(k) }
            },
            update: (a) => {
                const w = a.where.tripId_productId
                const d = db.dongChuyen.get(`${w.tripId}|${w.productId}`)
                if (!d) throw khongThay()
                apDung(d, a.data)
                return { ...d }
            },
        },
        salesTripLog: { create: (a) => { db.nhatKy.push({ ...a.data }); return a.data } },
        stockTransfer: { create: (a) => ({ id: 'ck1', ...a.data }) },
        vehicle: {
            findFirst: () => ({ id: 'xe1', code: 'XE01', name: 'Xe tải nhỏ', licensePlate: '51C-12345', status: 'available', branchId: CN }),
            update: () => ({}),
        },
        returnOrder: { findFirst: () => null },
        journalEntry: { findMany: () => [] },
        auditLog: { create: () => ({}) },
        webhookEndpoint: { findMany: () => [] },
        customer: { findUnique: () => null },
    }

    const nhan = (a: any) => {
        const w = a?.where || {}
        if (w.warehouseId_productId) return `:${w.warehouseId_productId.warehouseId}/${w.warehouseId_productId.productId}`
        if (w.tripId_productId) return `:${w.tripId_productId.tripId}/${w.tripId_productId.productId}`
        if (typeof w.warehouseId === 'string' && typeof w.productId === 'string') return `:${w.warehouseId}/${w.productId}`
        if (typeof w.id === 'string') return `:${w.id}`
        return ''
    }
    const moHinh = (ten: string) => new Proxy({}, {
        get: (_f, fn: string) => {
            if (fn === 'then') return undefined
            return async (a?: any) => {
                goi.push(`${ten}.${fn}${nhan(a)}`)
                const f = M[ten]?.[fn]
                if (f) return f(a)
                if (fn === 'findMany') return []
                if (fn === 'count') return 0
                return null
            }
        },
    })
    const tho: Record<string, any> = {
        $executeRawUnsafe: async () => 0,
        $queryRawUnsafe: async (sql: string) => (/nextval/.test(sql) ? [{ n: ++db.soMa }] : /is_called/.test(sql) ? [{ is_called: true }] : []),
        $queryRaw: async () => [],
    }
    const chup = () => structuredClone({ sp: db.sp, ton: db.ton, chuyen: db.chuyen, dongChuyen: db.dongChuyen, don: db.don, theKho: db.theKho, nhatKy: db.nhatKy })
    const prisma: any = new Proxy({}, {
        get: (_m, ten: string) => {
            if (ten === 'then') return undefined
            if (ten in tho) return tho[ten]
            if (ten === '$transaction') return async (fn: any) => {
                goi.push('$transaction')
                const anh = chup()
                try {
                    return await fn(prisma)
                } catch (e) {
                    Object.assign(db, anh) // ROLLBACK như Postgres
                    throw e
                }
            }
            return moHinh(ten)
        },
    })
    return { prisma, goi }
}

// ── Gọi route thật ────────────────────────────────────────────────────────────
async function chay(router: any, method: string, duong: string, db: Db, opts: { params?: any; headers?: any; body?: any } = {}) {
    const buoc = cacBuoc(router, method, duong)
    if (buoc.length < 2) throw new Error(`không tìm thấy route ${method.toUpperCase()} ${duong}`)
    const { prisma, goi } = taoPrismaGia(db)
    const req: any = {
        params: opts.params || {}, headers: opts.headers || {}, body: opts.body || {}, query: {},
        method: method.toUpperCase(), originalUrl: `/api${duong}`,
        storePrisma: prisma, user: { userId: 'u1', email: 'taixe@kengi.vn', role: 'admin', storeSchema: 'store_thu' },
    }
    const res: any = { ma: 200, than: null as any, status(c: number) { this.ma = c; return this }, json(b: any) { this.than = b; return this } }
    // Route in log gỡ lỗi mỗi đơn — tắt cho bảng kết quả dễ đọc. console.error giữ lại, CHỈ in khi route trả 5xx
    // (409/400 có chủ đích cũng được route ghi console.error — in ra chỉ làm rối).
    const [log, warn, err] = [console.log, console.warn, console.error]
    const loiRoute: unknown[][] = []
    console.log = () => { }
    console.warn = () => { }
    console.error = (...a: unknown[]) => { loiRoute.push(a) }
    try {
        for (const b of buoc.slice(1)) { let tiep = false; await b(req, res, () => { tiep = true }); if (!tiep) break }
    } finally {
        console.log = log
        console.warn = warn
        console.error = err
    }
    if (res.ma >= 500) for (const a of loiRoute) console.error(...a)
    return { ma: res.ma as number, than: res.than, goi, loiCua: String(res.than?.error || '') }
}

const dong = (p: Sp, sl: number, gia: number) => ({
    productId: p.id, productName: p.name, sku: p.sku, quantity: sl, unitPrice: gia, lineTotal: sl * gia, discount: 0, selectedUnit: p.baseUnit,
})
const thanDon = (lines: any[], them: Record<string, any> = {}) => {
    const tongTien = lines.reduce((s, l) => s + l.lineTotal, 0)
    return { items: lines, payments: [{ type: 'cash', amount: tongTien }], subtotal: tongTien, total: tongTien, amountReceived: tongTien, status: 'completed', ...them }
}
// POS ở chế độ chuyến gửi header kho xe + chuyến, và warehouseId = kho XE trong thân đơn (đúng như pos/page.tsx)
const banTrenXe = (db: Db, lines: any[], coChuyen = true) => chay(transactionsRouter, 'post', '/', db, {
    headers: { 'x-warehouse-id': KHO_XE, ...(coChuyen ? { 'x-sales-trip-id': CHUYEN } : {}) },
    body: thanDon(lines, { warehouseId: KHO_XE }),
})
const banQuay = (db: Db, lines: any[]) => chay(transactionsRouter, 'post', '/', db, { body: thanDon(lines) })
const huyDon = (db: Db, id: string) => chay(transactionsRouter, 'put', '/:id/void', db, { params: { id } })
const chuyenSangXe = (db: Db, id: string) => chay(transactionsRouter, 'post', '/:id/convert-to-van', db, { params: { id }, body: { tripId: CHUYEN } })
const ghiBanChuyen = (db: Db, items: any[]) => chay(salesTripsRouter, 'post', '/:id/sales', db, { params: { id: CHUYEN }, body: { items } })
const chatThem = (db: Db, items: any[]) => chay(salesTripsRouter, 'put', '/:id/load', db, { params: { id: CHUYEN }, body: { items } })
const doHang = (db: Db, items: any[]) => chay(salesTripsRouter, 'put', '/:id/unload', db, { params: { id: CHUYEN }, body: { items } })
const taoChuyen = (db: Db, items: any[]) => chay(salesTripsRouter, 'post', '/', db, { body: { vehicleId: 'xe1', items } })

const tonSp = (db: Db, id: string) => db.sp.get(id)!.stock
const tonKho = (db: Db, kho: string, id: string) => db.ton.get(`${kho}|${id}`)
const dongCh = (db: Db, id: string) => db.dongChuyen.get(`${CHUYEN}|${id}`)
const ch = (db: Db) => db.chuyen.get(CHUYEN)
const dungKhoXe = (goi: string[], id: string) => goi.some((g) => g.startsWith('warehouseStock.') && g.includes(`${KHO_XE}/${id}`))
const anh = (db: Db, ids = ['p1', 's1']) => Object.fromEntries(ids.map((id) => [id, {
    ton: tonSp(db, id), khoChinh: tonKho(db, KHO_CHINH, id), khoXe: tonKho(db, KHO_XE, id), daBan: dongCh(db, id)?.soldQty,
}]))

async function main() {
    // ═══ A. POS BÁN TRÊN XE — POST /api/transactions + x-warehouse-id ═══════════════════════════════════════════
    {
        const db = taoDb()
        const r = await banTrenXe(db, [dong(p1, 6, 6000)])
        dung('[A1 phải chặn] xe: hàng hoá vượt số trên xe (còn 5, bán 6) ⇒ 409 "chỉ còn 5 trên xe (cần 6)"',
            r.ma === 409 && /Nước suối Lavie.*chỉ còn 5 trên xe \(cần 6\)/.test(r.loiCua), { ma: r.ma, loi: r.loiCua })
        dung('[A1] bị chặn thì không đổi gì: kho xe 5, chuyến bán 0, không phiếu',
            tonKho(db, KHO_XE, 'p1') === 5 && dongCh(db, 'p1').soldQty === 0 && ch(db).totalSold === 0 && db.don.size === 0, anh(db))
    }
    {
        const db = taoDb()
        const r = await banTrenXe(db, [dong(p2, 1, 20000)])
        dung('[A2 phải chặn] xe: hàng hoá KHÔNG có trên xe ⇒ 409 "chỉ còn 0 trên xe (cần 1)"',
            r.ma === 409 && /Bánh quy Cosy.*chỉ còn 0 trên xe \(cần 1\)/.test(r.loiCua), { ma: r.ma, loi: r.loiCua })
    }
    {
        const db = taoDb(true)
        const r = await banTrenXe(db, [dong(p1, 6, 6000)])
        dung('[A3 phải chặn] cửa hàng BẬT bán âm kho vẫn không bán quá số trên xe ⇒ 409',
            r.ma === 409 && /chỉ còn 5 trên xe/.test(r.loiCua), { ma: r.ma, loi: r.loiCua })
    }
    {
        const db = taoDb()
        const r = await banTrenXe(db, [dong(s1, 1, 15000)])
        dung('[A4 phải cho] xe: chỉ bán DỊCH VỤ (không có trên xe) ⇒ 201 (trước đây 409 "chỉ còn 0 trên xe")',
            r.ma === 201, { ma: r.ma, loi: r.loiCua })
        dung('[A4] dịch vụ KHÔNG đụng kho xe', !dungKhoXe(r.goi, 's1') && tonKho(db, KHO_XE, 's1') === undefined, r.goi.filter((g) => g.startsWith('warehouseStock')))
        dung('[A4] dịch vụ đi đường quầy: Product.stock 0 → −1 và kho chính 0 → −1 (bất biến kho chính = tồn)',
            tonSp(db, 's1') === -1 && tonKho(db, KHO_CHINH, 's1') === -1, anh(db))
        dung('[A4] dịch vụ vẫn ghi thẻ kho bán −1', db.theKho.some((t) => t.productId === 's1' && t.type === 'sale' && t.quantity === -1), db.theKho)
        dung('[A4] dịch vụ KHÔNG có dòng SalesTripItem', !db.dongChuyen.has(`${CHUYEN}|s1`), [...db.dongChuyen.keys()])
        dung('[A4] chuyến: totalSold +0 (chỉ đếm hàng hoá), totalRevenue +15.000 (tiền dịch vụ vẫn vào chuyến)',
            ch(db).totalSold === 0 && ch(db).totalRevenue === 15000, ch(db))
        const log = db.nhatKy.find((l) => l.action === 'sale')
        dung('[A4] nhật ký chuyến có đơn (đối soát tiền mặt truy được hoá đơn), ghi "0 sp + 1 dịch vụ"',
            !!log && /0 sp \+ 1 dịch vụ/.test(log.notes) && !!JSON.parse(log.metadata || '{}').transactionId, log)
        dung('[A4] phiếu mang channel "van"', [...db.don.values()][0]?.channel === 'van', [...db.don.values()][0]?.channel)
    }
    {
        const db = taoDb()
        const r = await banTrenXe(db, [dong(p1, 3, 6000), dong(s1, 1, 15000)])
        dung('[A5 phải cho] xe: hàng đủ (5 ≥ 3) + dịch vụ cùng phiếu ⇒ 201', r.ma === 201, { ma: r.ma, loi: r.loiCua })
        dung('[A5] hàng hoá chỉ trừ KHO XE 5 → 2; Product.stock + kho chính GIỮ 50 (đã trừ lúc chất)',
            tonKho(db, KHO_XE, 'p1') === 2 && tonSp(db, 'p1') === 50 && tonKho(db, KHO_CHINH, 'p1') === 50, anh(db))
        dung('[A5] SalesTripItem: hàng bán 3, dịch vụ không có dòng', dongCh(db, 'p1').soldQty === 3 && !dongCh(db, 's1'), anh(db))
        dung('[A5] chuyến: totalSold = 3 (đơn vị hàng hoá), totalRevenue = 33.000 (gồm dịch vụ)',
            ch(db).totalSold === 3 && ch(db).totalRevenue === 33000, ch(db))
    }
    {
        const db = taoDb()
        const r = await banTrenXe(db, [dong(s1, 1, 15000), dong(p1, 6, 6000)])
        dung('[A6 phải chặn] dịch vụ + hàng THIẾU trên xe ⇒ 409 nêu đúng mặt hàng thiếu (không phải dịch vụ)',
            r.ma === 409 && /Nước suối Lavie.*chỉ còn 5 trên xe \(cần 6\)/.test(r.loiCua), { ma: r.ma, loi: r.loiCua })
        dung('[A6] rollback trọn: dịch vụ không bị trừ (tồn 0, kho chính 0), kho xe 5, không phiếu, chuyến 0',
            tonSp(db, 's1') === 0 && tonKho(db, KHO_CHINH, 's1') === 0 && tonKho(db, KHO_XE, 'p1') === 5 && db.don.size === 0 && ch(db).totalRevenue === 0, anh(db))
    }
    {
        const db = taoDb()
        const r = await banTrenXe(db, [dong(p1, 1, 6000), dong(s1, 1, 15000)], false)
        dung('[A7 phải cho] chỉ có x-warehouse-id (không x-sales-trip-id) + dịch vụ ⇒ 201, không ghi chuyến',
            r.ma === 201 && !r.goi.some((g) => g.startsWith('salesTrip.') || g.startsWith('salesTripItem.')) && tonKho(db, KHO_XE, 'p1') === 4 && tonSp(db, 's1') === -1,
            { ma: r.ma, loi: r.loiCua, ...anh(db) })
    }
    {
        const db = taoDb()
        const r = await banTrenXe(db, [dong(p1, 2, 6000), dong(s1, 1, 15000)])
        const h = await huyDon(db, String(r.than?.data?.id))
        dung('[A8] huỷ đơn xe có dịch vụ ⇒ 200', r.ma === 201 && h.ma === 200, { ban: r.ma, huy: h.ma, loi: h.loiCua })
        dung('[A8] huỷ: dịch vụ về ĐÚNG 0 cả Product.stock lẫn kho chính — trừ đường quầy nên huỷ cộng lại khớp, không tồn ma',
            tonSp(db, 's1') === 0 && tonKho(db, KHO_CHINH, 's1') === 0, anh(db))
    }

    // ═══ B. CHUYỂN ĐƠN THƯỜNG SANG XE — POST /api/transactions/:id/convert-to-van ══════════════════════════════
    {
        const db = taoDb()
        const b = await banQuay(db, [dong(p1, 2, 6000), dong(s1, 1, 15000)])
        const truoc = { p1: tonSp(db, 'p1'), s1: tonSp(db, 's1'), s1Kho: tonKho(db, KHO_CHINH, 's1') }
        const r = await chuyenSangXe(db, String(b.than?.data?.id))
        dung('[B1 phải cho] chuyển đơn quầy (hàng + dịch vụ) sang xe ⇒ 200 (trước đây 409 "Phí giao hàng chỉ còn 0 trên xe")',
            b.ma === 201 && truoc.p1 === 48 && truoc.s1 === -1 && r.ma === 200, { ban: b.ma, truoc, ma: r.ma, loi: r.loiCua })
        dung('[B1] hàng hoá: kho xe 5 → 3, trả 2 về tồn bán được (Product.stock + kho chính 48 → 50)',
            tonKho(db, KHO_XE, 'p1') === 3 && tonSp(db, 'p1') === 50 && tonKho(db, KHO_CHINH, 'p1') === 50, anh(db))
        dung('[B1] dịch vụ để NGUYÊN như đơn quầy đã trừ (−1 / kho chính −1), không đụng kho xe',
            tonSp(db, 's1') === -1 && tonKho(db, KHO_CHINH, 's1') === -1 && !dungKhoXe(r.goi, 's1'), anh(db))
        dung('[B1] thẻ kho "adjustment" chỉ cho hàng hoá (+2), không cho dịch vụ',
            db.theKho.filter((t) => t.referenceType === 'convert_van').map((t) => `${t.productId}:${t.quantity}`).join(',') === 'p1:2', db.theKho.filter((t) => t.referenceType === 'convert_van'))
        dung('[B1] SalesTripItem: hàng bán 2, dịch vụ không có dòng; totalSold 2, totalRevenue 27.000',
            dongCh(db, 'p1').soldQty === 2 && !dongCh(db, 's1') && ch(db).totalSold === 2 && ch(db).totalRevenue === 27000, { ...anh(db), chuyen: ch(db) })
        dung('[B1] đơn thành channel "van"', db.don.get(String(b.than?.data?.id))?.channel === 'van')
    }
    {
        const db = taoDb()
        const b = await banQuay(db, [dong(p1, 6, 6000), dong(s1, 1, 15000)])
        const r = await chuyenSangXe(db, String(b.than?.data?.id))
        dung('[B2 phải chặn] chuyển đơn có hàng vượt số trên xe (còn 5, cần 6) ⇒ 409 "chỉ còn 5 trên xe (cần 6)"',
            b.ma === 201 && r.ma === 409 && /Nước suối Lavie.*chỉ còn 5 trên xe \(cần 6\)/.test(r.loiCua), { ban: b.ma, ma: r.ma, loi: r.loiCua })
        dung('[B2] bị chặn thì không đổi gì: kho xe 5, Product.stock 44, đơn vẫn "direct", chuyến 0',
            tonKho(db, KHO_XE, 'p1') === 5 && tonSp(db, 'p1') === 44 && db.don.get(String(b.than?.data?.id))?.channel === 'direct' && ch(db).totalSold === 0,
            { ...anh(db), channel: db.don.get(String(b.than?.data?.id))?.channel })
    }
    {
        const db = taoDb()
        const b = await banQuay(db, [dong(s1, 2, 15000)])
        const r = await chuyenSangXe(db, String(b.than?.data?.id))
        dung('[B3 phải cho] chuyển đơn CHỈ dịch vụ ⇒ 200, không đụng kho xe, totalSold +0, totalRevenue +30.000',
            r.ma === 200 && !dungKhoXe(r.goi, 's1') && ch(db).totalSold === 0 && ch(db).totalRevenue === 30000 && tonSp(db, 's1') === -2,
            { ma: r.ma, loi: r.loiCua, chuyen: ch(db), ...anh(db) })
    }

    // ═══ C. GHI BÁN THEO CHUYẾN — POST /api/sales-trips/:id/sales ═══════════════════════════════════════════════
    {
        const db = taoDb()
        const r = await ghiBanChuyen(db, [{ productId: 'p1', quantity: 6 }])
        dung('[C1 phải chặn] ghi bán hàng hoá vượt số trên xe ⇒ 400 "Trên xe không đủ … (cần 6, còn 5)"',
            r.ma === 400 && /Trên xe không đủ "Nước suối Lavie" \(cần 6, còn 5\)/.test(r.loiCua) && tonKho(db, KHO_XE, 'p1') === 5, { ma: r.ma, loi: r.loiCua })
    }
    {
        const db = taoDb()
        const r = await ghiBanChuyen(db, [{ productId: 's1', quantity: 2 }])
        dung('[C2 phải cho] ghi bán DỊCH VỤ ⇒ 200 (trước đây 400 "Trên xe không đủ")', r.ma === 200, { ma: r.ma, loi: r.loiCua })
        dung('[C2] không đụng kho xe, không dòng chuyến; totalSold +0; doanh thu lùi về giá bán 2 × 15.000',
            !dungKhoXe(r.goi, 's1') && !dongCh(db, 's1') && ch(db).totalSold === 0 && ch(db).totalRevenue === 30000, { chuyen: ch(db), goi: r.goi })
    }
    {
        const db = taoDb()
        const r = await ghiBanChuyen(db, [{ productId: 'p1', quantity: 2 }, { productId: 's1', quantity: 1, unitPrice: 20000 }])
        dung('[C3 phải cho] ghi bán hàng + dịch vụ ⇒ 200; kho xe 3; hàng bán 2; totalSold 2; doanh thu 2×6.000 + 20.000',
            r.ma === 200 && tonKho(db, KHO_XE, 'p1') === 3 && dongCh(db, 'p1').soldQty === 2 && !dongCh(db, 's1') && ch(db).totalSold === 2 && ch(db).totalRevenue === 32000,
            { ma: r.ma, loi: r.loiCua, chuyen: ch(db), ...anh(db) })
    }

    // ═══ D. KHÔNG CHẤT DỊCH VỤ LÊN XE — tạo chuyến + /load ═══════════════════════════════════════════════════════
    {
        const db = taoDb()
        const r = await chatThem(db, [{ productId: 's2', quantity: 1 }])
        dung('[D1 phải chặn] chất DỊCH VỤ (tồn 10) lên xe ⇒ 400 "là dịch vụ — không chất lên xe"',
            r.ma === 400 && /Dịch vụ lắp đặt" là dịch vụ — không chất lên xe/.test(r.loiCua), { ma: r.ma, loi: r.loiCua })
        dung('[D1] không chuyển gì: tồn dịch vụ 10, kho xe không có dòng', tonSp(db, 's2') === 10 && tonKho(db, KHO_XE, 's2') === undefined && !dongCh(db, 's2'), anh(db, ['s2']))
    }
    {
        const db = taoDb()
        const r = await chatThem(db, [{ productId: 'p2', quantity: 4 }])
        dung('[D2 phải cho] chất HÀNG HOÁ vẫn chạy: tồn + kho chính 10 → 6, kho xe 4, dòng chuyến chất 4, totalLoaded 9',
            r.ma === 200 && tonSp(db, 'p2') === 6 && tonKho(db, KHO_CHINH, 'p2') === 6 && tonKho(db, KHO_XE, 'p2') === 4 && dongCh(db, 'p2')?.loadedQty === 4 && ch(db).totalLoaded === 9,
            { ma: r.ma, loi: r.loiCua, ...anh(db, ['p2']), chuyen: ch(db) })
    }
    {
        const db = taoDb()
        const r = await taoChuyen(db, [{ productId: 'p1', quantity: 1 }, { productId: 's2', quantity: 1 }])
        dung('[D3 phải chặn] tạo chuyến kèm DỊCH VỤ ⇒ 400 "là dịch vụ — không chất lên xe", không trừ gì',
            r.ma === 400 && /là dịch vụ — không chất lên xe/.test(r.loiCua) && tonSp(db, 'p1') === 50 && tonSp(db, 's2') === 10,
            { ma: r.ma, loi: r.loiCua })
    }

    // ═══ E. DỠ HÀNG GIỮA CHUYẾN — "còn lại" = chất − bán (salesTrips.ts PUT /:id/unload) ═══════════════════════
    {
        const db = taoDb()
        const b = await banTrenXe(db, [dong(p1, 3, 6000), dong(s1, 1, 15000)])
        const e1 = await doHang(db, [{ productId: 'p1', quantity: 3 }])
        dung('[E1 phải chặn] sau đơn xe (3 hàng + dịch vụ) dỡ 3 ⇒ 400 "còn 2" — "còn lại" không bị dịch vụ làm lệch',
            b.ma === 201 && e1.ma === 400 && /còn 2, yêu cầu 3/.test(e1.loiCua), { ban: b.ma, ma: e1.ma, loi: e1.loiCua })
        const e2 = await doHang(db, [{ productId: 's1', quantity: 1 }])
        dung('[E2 phải chặn] dỡ DỊCH VỤ ⇒ 400 "không có trong chuyến" (dịch vụ không bao giờ nằm trên xe)',
            e2.ma === 400 && /không có trong chuyến/.test(e2.loiCua), { ma: e2.ma, loi: e2.loiCua })
        const e3 = await doHang(db, [{ productId: 'p1', quantity: 2 }])
        dung('[E3 phải cho] dỡ đúng 2 còn lại ⇒ 200; kho xe 0; tồn + kho chính 50 → 52; dòng chuyến chất 3',
            e3.ma === 200 && tonKho(db, KHO_XE, 'p1') === 0 && tonSp(db, 'p1') === 52 && tonKho(db, KHO_CHINH, 'p1') === 52 && dongCh(db, 'p1').loadedQty === 3,
            { ma: e3.ma, loi: e3.loiCua, ...anh(db) })
    }

    console.log(`\n${tong - loi}/${tong} ca đạt${loi ? ` — ${loi} HỎNG` : ''}`)
    process.exit(loi ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
