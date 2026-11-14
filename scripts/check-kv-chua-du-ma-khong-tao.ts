/**
 * Kiểm "KHÔNG TẠO CHỨNG TỪ THIẾU DÒNG" + "ĐỌC HỎNG ≠ CHƯA CÓ" ở đồng bộ KiotViet (services/kiotvietSync.ts) — 14/11/2026
 *   npx tsx scripts/check-kv-chua-du-ma-khong-tao.ts
 *
 * Bệnh (đo HUTI 14/11): hoá đơn / phiếu nhập còn thiếu mã hàng SAU KHI kéo mã vẫn được TẠO với các dòng còn lại — tổng theo
 * KiotViet, thẻ kho + giá vốn thiếu dòng — và lượt sau thấy "đã có" chỉ cập nhật thanh toán ⇒ thiếu vĩnh viễn (32 HĐ / 45,3tr vì
 * mã {DEL}; PN004025 rơi dòng SKK 320 cái). findMap + các câu tra "đã có chưa" của hàng / khách / NCC `.catch(() => null)` ⇒
 * CSDL chập một nhịp là hoá đơn không gắn khách, phiếu nhập không gắn NCC, đẻ BẢN SAO hàng / khách / NCC, sổ quỹ ghi phiếu thu
 * của hoá đơn lần hai.
 *
 * Luật: còn thiếu mã sau khi kéo ⇒ KHÔNG tạo, ghi lỗi có lý do (lượt sau làm lại); kéo được ⇒ tạo ĐỦ dòng; tra lỗi ⇒ lan ra,
 * không tạo gì. Chạy thử không báo oan mã thường (chưa kéo vì chạy thử không ghi) nhưng báo trước mã {DEL} (chạy thật chắc chắn
 * không kéo). Mỗi ca "phải chặn" có ca đối chứng "phải tạo" — bộ kiểm không được xanh nhờ chặn tất.
 * Prisma giả + KV.raw giả: không DB, không mạng.
 */
import * as dongBo from '../src/services/kiotvietSync'
import { KV } from '../src/services/kiotviet'

const { newCounters, syncInvoices, syncPurchaseOrders, syncProducts, syncCustomers, syncSuppliers, syncCashflow } = dongBo as any
const lyDoChuaDuMa: any = (dongBo as any).lyDoChuaDuMa

let dat = 0, hong = 0
function ok(ten: string, dk: boolean, thucTe?: any) {
    if (dk) { dat++; console.log(`  ✓ ${ten}`) }
    else { hong++; console.log(`  ✗ ${ten}${thucTe !== undefined ? ` — ${JSON.stringify(thucTe).slice(0, 600)}` : ''}`) }
}

/* Bút toán chạy trên prisma giả sẽ hỏng và thuGhiSo chỉ in ra (không ném) — lọc tiếng ồn đó cho dễ đọc kết quả */
const inLoiGoc = console.error
console.error = (...a: any[]) => { if (/^\[ghi-so\]/.test(String(a[0] ?? ''))) return; inLoiGoc(...a) }

const P1001 = () => Object.assign(new Error("Can't reach database server at `/cloudsql/x:5432`"), { code: 'P1001' })

/* ─── KiotViet giả: KV.raw là đường keoMaThieu hỏi mã thiếu ─────────────────────────────────────────── */
const goiKV: string[] = []
let kvTraVe: ((path: string) => any) | null = null
;(KV as any).raw = async (_creds: any, path: string) => {
    goiKV.push(path)
    if (!kvTraVe) throw new Error('KiotViet 503 (giả)')
    return kvTraVe(path)
}

/* ─── Prisma giả ─────────────────────────────────────────────────────────────────────────────────────
 * `hong`: những câu tra NÉM P1001 — 'map:<entity>' (KiotVietMap theo entity), '<bảng>.<hàm>'.
 * Bảng không khai thì mọi hàm trả mặc định vô hại (find → null/[], ghi → {}). */
function taoKho(cfg: { hong?: string[]; sp?: any[]; khach?: any[]; ncc?: any[]; map?: Record<string, string> } = {}) {
    const kho = {
        map: new Map<string, string>(Object.entries(cfg.map || {})),
        sp: [...(cfg.sp || [])] as any[], khach: [...(cfg.khach || [])] as any[], ncc: [...(cfg.ncc || [])] as any[],
        hd: [] as any[], pn: [] as any[],
        dem: {} as Record<string, number>,
        hong: new Set(cfg.hong || []),
    }
    const dem = (k: string) => (kho.dem[k] = (kho.dem[k] || 0) + 1)
    const nem = (k: string) => { if (kho.hong.has(k)) throw P1001() }
    const tim = (ds: any[], where: any) => ds.find(x => Object.entries(where || {}).every(([k, v]) => x[k] === v)) ?? null
    const bang: any = {
        kiotVietMap: {
            findUnique: async ({ where }: any) => {
                const { entity, kvId } = where.entity_kvId
                nem(`map:${entity}`)
                const id = kho.map.get(`${entity}:${kvId}`)
                return id ? { localId: id } : null
            },
            upsert: async ({ create }: any) => { kho.map.set(`${create.entity}:${create.kvId}`, create.localId); return {} },
            create: async ({ data }: any) => {
                const k = `${data.entity}:${data.kvId}`
                if (kho.map.has(k)) throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' })
                kho.map.set(k, data.localId); return data
            },
            update: async ({ where, data }: any) => { kho.map.set(`${where.entity_kvId.entity}:${where.entity_kvId.kvId}`, data.localId); return {} },
            updateMany: async () => ({ count: 0 }),
            deleteMany: async () => ({ count: 0 }),
            findMany: async () => [],
        },
        product: {
            findUnique: async ({ where }: any) => { nem('product.findUnique'); return tim(kho.sp, where) },
            findFirst: async ({ where }: any) => { nem('product.findFirst'); return tim(kho.sp, where) },
            create: async ({ data }: any) => { const p = { id: `sp-moi-${dem('product.create')}`, ...data }; kho.sp.push(p); return p },
            update: async () => ({}),
        },
        category: { findFirst: async () => ({ id: 'dm-1' }), findUnique: async () => ({ id: 'dm-1' }), create: async () => ({ id: 'dm-1' }) },
        brand: { findFirst: async () => null, create: async () => ({ id: 'th-1' }) },
        customer: {
            findUnique: async ({ where }: any) => { nem('customer.findUnique'); return tim(kho.khach, where) },
            findFirst: async ({ where }: any) => { nem('customer.findFirst'); return tim(kho.khach, where) },
            create: async ({ data }: any) => { const k = { id: `kh-moi-${dem('customer.create')}`, ...data }; kho.khach.push(k); return k },
            update: async () => ({}),
        },
        supplier: {
            findUnique: async ({ where }: any) => { nem('supplier.findUnique'); return tim(kho.ncc, where) },
            create: async ({ data }: any) => { const n = { id: `ncc-moi-${dem('supplier.create')}`, ...data }; kho.ncc.push(n); return n },
            update: async () => ({}),
        },
        transaction: {
            findUnique: async ({ where }: any) => tim(kho.hd, where),
            create: async ({ data }: any) => {
                const h = { id: `hd-${dem('transaction.create')}`, ...data, items: data.items?.create ?? [], payments: data.payments?.create ?? [] }
                kho.hd.push(h); return h
            },
            update: async () => ({}),
        },
        importReceipt: {
            findUnique: async ({ where }: any) => tim(kho.pn, where),
            create: async ({ data }: any) => {
                const r = { id: `pn-${dem('importReceipt.create')}`, ...data, items: data.items?.create ?? [] }
                kho.pn.push(r); return r
            },
            update: async () => ({}),
        },
        storeSettings: { findFirst: async () => ({ businessType: 'company' }) },
        debtEntry: { create: async ({ data }: any) => ({ id: `no-${dem('debtEntry.create')}`, ...data }) },
        cashReceipt: { create: async ({ data }: any) => ({ id: `thu-${dem('cashReceipt.create')}`, ...data }), findFirst: async () => null },
        expense: { create: async ({ data }: any) => ({ id: `chi-${dem('expense.create')}`, ...data }), findFirst: async () => null },
        payment: { findFirst: async () => null, findMany: async () => [] },
    }
    const moHo = () => new Proxy({}, {
        get: (_t, m) => {
            if (typeof m !== 'string' || m === 'then') return undefined
            return async () => (m.startsWith('findMany') ? [] : m.startsWith('find') ? null : m === 'count' ? 0
                : m === 'aggregate' ? { _sum: {}, _count: {} } : m.endsWith('Many') ? { count: 0 } : {})
        },
    })
    const sp: any = new Proxy(bang, {
        get: (t, k) => {
            if (typeof k !== 'string' || k === 'then') return undefined
            if (k === '$transaction') return async (x: any) => (typeof x === 'function' ? x(sp) : Promise.all(x))
            if (k.startsWith('$')) return async () => []
            if (!(k in t)) t[k] = moHo()
            return t[k]
        },
    })
    return { sp, kho }
}

const CREDS = { clientId: 'gia', clientSecret: 'gia', retailer: 'gia' }
const CO_SAN = { id: 'sp-co-san', name: 'Đá cắt 107', sku: 'EDH-SZP107-E6' }
const SKK = { id: 777, code: 'SKK', name: 'Sắt kẹp khuôn', basePrice: 0, inventories: [] }   // bản ghi KiotViet của mã đang thiếu
const dongHD = (ma: string, kvId: number) => ({ productId: kvId, productCode: ma, productName: ma, quantity: 1, price: 1000, discount: 0, subTotal: 1000 })
const hoaDon = (them: any = {}) => ({
    id: 9001, code: 'HD900', status: 1, total: 2000, discount: 0, purchaseDate: '2026-11-13T10:00:00', payments: [],
    invoiceDetails: [dongHD('EDH-SZP107-E6', 501), dongHD('SKK', 777)], ...them,
})
const dongPN = (ma: string, kvId: number) => ({ productId: kvId, productCode: ma, productName: ma, quantity: 1, price: 1000, discount: 0 })
const phieuNhap = (them: any = {}) => ({
    id: 8001, code: 'PN900', status: 3, total: 2000, totalPayment: 0, purchaseDate: '2026-11-13T09:00:00',
    purchaseOrderDetails: [dongPN('EDH-SZP107-E6', 501), dongPN('SKK', 777)], ...them,
})
const OPTS = (them: any = {}) => ({ apply: true, systemUserId: 'u-he-thong', ...them })
const loiGom = (c: any) => c.errors.join(' | ')

async function main() {
    console.log('\n▶ Đồng bộ KiotViet: không tạo chứng từ thiếu dòng · đọc hỏng ≠ chưa có\n')

    console.log('— Hoá đơn bán (syncInvoices)')
    // H1 — kéo mã thiếu HỎNG (KiotViet lỗi) ⇒ không tạo, lỗi nêu đúng mã + lý do
    {
        kvTraVe = null; goiKV.length = 0
        const { sp, kho } = taoKho({ sp: [CO_SAN] }); const c = newCounters()
        await syncInvoices(sp, [hoaDon()], OPTS({ creds: CREDS }), c)
        ok('H1. kéo mã thiếu hỏng ⇒ KHÔNG tạo hoá đơn (bản cũ tạo với 1/2 dòng)', !kho.dem['transaction.create'], { tao: kho.dem['transaction.create'], dong: kho.hd[0]?.items?.length })
        ok('H1b. ghi lỗi "HĐ HD900: CHƯA TẠO … SKK … lượt sau làm lại", đã thử hỏi KiotViet',
            /HĐ HD900: CHƯA TẠO/.test(loiGom(c)) && /SKK/.test(loiGom(c)) && /lượt sau làm lại/.test(loiGom(c)) && goiKV.length === 1 && c.created === 0, { errors: c.errors, goiKV })
    }
    // H2 — không có creds (đường gọi không kéo được mã) ⇒ cũng không tạo
    {
        kvTraVe = null; goiKV.length = 0
        const { sp, kho } = taoKho({ sp: [CO_SAN] }); const c = newCounters()
        await syncInvoices(sp, [hoaDon()], OPTS(), c)
        ok('H2. không có creds ⇒ không tạo, failed = 1, không gọi KiotViet', !kho.dem['transaction.create'] && c.failed === 1 && goiKV.length === 0, { dem: kho.dem, c })
    }
    // H3 — ĐỐI CHỨNG: kéo mã được ⇒ tạo hàng mới rồi tạo hoá đơn ĐỦ 2 dòng
    {
        kvTraVe = () => SKK; goiKV.length = 0
        const { sp, kho } = taoKho({ sp: [CO_SAN] }); const c = newCounters()
        await syncInvoices(sp, [hoaDon()], OPTS({ creds: CREDS }), c)
        ok('H3. kéo mã được ⇒ tạo mã SKK + hoá đơn đủ 2 dòng, failed = 0',
            kho.dem['product.create'] === 1 && kho.dem['transaction.create'] === 1 && kho.hd[0]?.items?.length === 2 && c.failed === 0 && c.created === 1, { dem: kho.dem, c })
    }
    // H4 — ĐỐI CHỨNG: đủ mã sẵn ⇒ tạo như cũ, không hỏi KiotViet
    {
        kvTraVe = null; goiKV.length = 0
        const { sp, kho } = taoKho({ sp: [CO_SAN, { id: 'sp-skk', name: 'Sắt kẹp', sku: 'SKK' }] }); const c = newCounters()
        await syncInvoices(sp, [hoaDon()], OPTS({ creds: CREDS }), c)
        ok('H4. đủ mã ⇒ tạo hoá đơn 2 dòng, không gọi KiotViet', kho.dem['transaction.create'] === 1 && kho.hd[0]?.items?.length === 2 && goiKV.length === 0 && c.failed === 0, { dem: kho.dem, c })
    }
    // H5 — mã đã XOÁ bên KiotViet ({DEL}) ⇒ không kéo (kéo là đẻ hàng "…{DEL}"), không tạo, lý do chỉ cách gỡ
    {
        kvTraVe = () => SKK; goiKV.length = 0
        const { sp, kho } = taoKho({ sp: [CO_SAN] }); const c = newCounters()
        await syncInvoices(sp, [hoaDon({ invoiceDetails: [dongHD('EDH-SZP107-E6', 501), dongHD('SKK{DEL}', 778)] })], OPTS({ creds: CREDS }), c)
        ok('H5. mã {DEL} ⇒ không tạo hoá đơn, không tạo hàng, không gọi KiotViet, lý do "đã XOÁ bên KiotViet"',
            !kho.dem['transaction.create'] && !kho.dem['product.create'] && goiKV.length === 0 && /CHƯA TẠO/.test(loiGom(c)) && /đã XOÁ bên KiotViet/.test(loiGom(c)), { dem: kho.dem, errors: c.errors })
    }
    // H6 — chạy thử, mã thường chưa có ⇒ KHÔNG báo lỗi oan (chạy thật sẽ kéo), đếm "sẽ tạo", không ghi gì
    {
        kvTraVe = null; goiKV.length = 0
        const { sp, kho } = taoKho({ sp: [CO_SAN] }); const c = newCounters()
        await syncInvoices(sp, [hoaDon()], OPTS({ apply: false, creds: CREDS }), c)
        ok('H6. chạy thử + mã thường thiếu ⇒ created 1, failed 0, không tạo thật', c.created === 1 && c.failed === 0 && !kho.dem['transaction.create'], { c })
    }
    // H7 — chạy thử, mã {DEL} ⇒ báo trước đúng điều chạy thật sẽ gặp
    {
        kvTraVe = null; goiKV.length = 0
        const { sp } = taoKho({ sp: [CO_SAN] }); const c = newCounters()
        await syncInvoices(sp, [hoaDon({ invoiceDetails: [dongHD('EDH-SZP107-E6', 501), dongHD('SKK{DEL}', 778)] })], OPTS({ apply: false }), c)
        ok('H7. chạy thử + mã {DEL} ⇒ failed 1, created 0, "chạy thật sẽ KHÔNG TẠO"', c.failed === 1 && c.created === 0 && /chạy thật sẽ KHÔNG TẠO/.test(loiGom(c)), { c })
    }
    // H8 — tra bảng nối KHÁCH lỗi lúc tạo ⇒ không tạo hoá đơn mồ côi khách (bản cũ: null ⇒ tạo hoá đơn không gắn khách, mãi mãi)
    {
        kvTraVe = null; goiKV.length = 0
        const { sp, kho } = taoKho({ sp: [CO_SAN, { id: 'sp-skk', name: 'Sắt kẹp', sku: 'SKK' }], hong: ['map:customer'] }); const c = newCounters()
        await syncInvoices(sp, [hoaDon({ customerId: 333, customerName: 'Anh A' })], OPTS(), c)
        ok('H8. bảng nối khách lỗi ⇒ không tạo hoá đơn, failed 1, lỗi nguyên văn', !kho.dem['transaction.create'] && c.failed === 1 && /Can't reach/.test(loiGom(c)), { dem: kho.dem, c })
    }
    // H9 — tra HÀNG lỗi khi dựng dòng ⇒ không tạo (giữ bản vá 18/10)
    {
        kvTraVe = null; goiKV.length = 0
        const { sp, kho } = taoKho({ sp: [CO_SAN], hong: ['product.findUnique'] }); const c = newCounters()
        await syncInvoices(sp, [hoaDon()], OPTS({ creds: CREDS }), c)
        ok('H9. tra hàng lỗi ⇒ không tạo hoá đơn, failed ≥ 1', !kho.dem['transaction.create'] && c.failed >= 1, { dem: kho.dem, c })
    }

    console.log('— Phiếu nhập (syncPurchaseOrders)')
    // P1 — kéo mã hỏng ⇒ không tạo phiếu (bản cũ: tạo với 1/2 dòng, bút toán 156/331 theo tổng 2 dòng)
    {
        kvTraVe = null; goiKV.length = 0
        const { sp, kho } = taoKho({ sp: [CO_SAN] }); const c = newCounters()
        await syncPurchaseOrders(sp, [phieuNhap()], OPTS({ creds: CREDS }), c)
        ok('P1. kéo mã hỏng ⇒ KHÔNG tạo phiếu nhập', !kho.dem['importReceipt.create'], { tao: kho.dem['importReceipt.create'], dong: kho.pn[0]?.items?.length })
        ok('P1b. ghi lỗi "Phiếu nhập PN900: CHƯA TẠO … SKK"', /Phiếu nhập PN900: CHƯA TẠO/.test(loiGom(c)) && /SKK/.test(loiGom(c)) && c.created === 0, { errors: c.errors })
    }
    // P2 — ĐỐI CHỨNG: kéo mã được ⇒ phiếu đủ 2 dòng
    {
        kvTraVe = () => SKK; goiKV.length = 0
        const { sp, kho } = taoKho({ sp: [CO_SAN] }); const c = newCounters()
        await syncPurchaseOrders(sp, [phieuNhap()], OPTS({ creds: CREDS }), c)
        ok('P2. kéo mã được ⇒ tạo phiếu đủ 2 dòng, failed 0', kho.dem['importReceipt.create'] === 1 && kho.pn[0]?.items?.length === 2 && c.failed === 0, { dem: kho.dem, c })
    }
    // P3 — KiotViet không trả dòng nào ⇒ không tạo phiếu rỗng (bản cũ: phiếu 0 dòng mang tổng 2.000)
    {
        kvTraVe = null; goiKV.length = 0
        const { sp, kho } = taoKho({ sp: [CO_SAN] }); const c = newCounters()
        await syncPurchaseOrders(sp, [phieuNhap({ purchaseOrderDetails: [] })], OPTS({ creds: CREDS }), c)
        ok('P3. 0 dòng ⇒ không tạo, failed 1, "không tạo phiếu rỗng"', !kho.dem['importReceipt.create'] && c.failed === 1 && /không tạo phiếu rỗng/.test(loiGom(c)), { dem: kho.dem, c })
    }
    // P4 — tra bảng nối NCC lỗi ⇒ không tạo phiếu mồ côi NCC
    {
        kvTraVe = null; goiKV.length = 0
        const { sp, kho } = taoKho({ sp: [CO_SAN, { id: 'sp-skk', name: 'Sắt kẹp', sku: 'SKK' }], hong: ['map:supplier'] }); const c = newCounters()
        await syncPurchaseOrders(sp, [phieuNhap({ supplierId: 444, supplierName: 'NCC A' })], OPTS(), c)
        ok('P4. bảng nối NCC lỗi ⇒ không tạo phiếu, failed 1', !kho.dem['importReceipt.create'] && c.failed === 1 && /Can't reach/.test(loiGom(c)), { dem: kho.dem, c })
    }
    // P5 — chạy thử, mã thường thiếu ⇒ không báo oan (bản cũ: failed 1 dù chạy thật sẽ kéo được)
    {
        kvTraVe = null; goiKV.length = 0
        const { sp, kho } = taoKho({ sp: [CO_SAN] }); const c = newCounters()
        await syncPurchaseOrders(sp, [phieuNhap()], OPTS({ apply: false, creds: CREDS }), c)
        ok('P5. chạy thử + mã thường thiếu ⇒ created 1, failed 0, không tạo thật', c.created === 1 && c.failed === 0 && !kho.dem['importReceipt.create'], { c })
    }
    // P6 — chạy thử, mã {DEL} ⇒ báo trước
    {
        kvTraVe = null; goiKV.length = 0
        const { sp } = taoKho({ sp: [CO_SAN] }); const c = newCounters()
        await syncPurchaseOrders(sp, [phieuNhap({ purchaseOrderDetails: [dongPN('EDH-SZP107-E6', 501), dongPN('SKK{DEL}', 778)] })], OPTS({ apply: false }), c)
        ok('P6. chạy thử + mã {DEL} ⇒ failed 1, created 0, "chạy thật sẽ KHÔNG TẠO"', c.failed === 1 && c.created === 0 && /chạy thật sẽ KHÔNG TẠO/.test(loiGom(c)), { c })
    }
    // P7 — ĐỐI CHỨNG: đủ mã ⇒ tạo như cũ
    {
        kvTraVe = null; goiKV.length = 0
        const { sp, kho } = taoKho({ sp: [CO_SAN, { id: 'sp-skk', name: 'Sắt kẹp', sku: 'SKK' }] }); const c = newCounters()
        await syncPurchaseOrders(sp, [phieuNhap()], OPTS({ creds: CREDS }), c)
        ok('P7. đủ mã ⇒ tạo phiếu 2 dòng, không gọi KiotViet', kho.dem['importReceipt.create'] === 1 && kho.pn[0]?.items?.length === 2 && goiKV.length === 0 && c.failed === 0, { dem: kho.dem, c })
    }

    console.log('— Hàng hoá / khách / NCC: tra "đã có chưa" lỗi thì KHÔNG tạo bản sao')
    const hangKV = { id: 777, code: 'KV-777', name: 'Hàng KV', basePrice: 1000, inventories: [] }
    const hangDaNoi = { sp: [{ id: 'sp-x', name: 'Hàng KV', sku: 'KENGI-KHAC' }], map: { 'product:777': 'sp-x' } }
    {
        const { sp, kho } = taoKho({ ...hangDaNoi, hong: ['map:product'] }); const c = newCounters()
        await syncProducts(sp, [hangKV], { apply: true }, c)
        ok('S1. hàng đã nối (SKU Kengi khác), bảng nối lỗi ⇒ không tạo bản sao, failed 1', !kho.dem['product.create'] && c.failed === 1, { dem: kho.dem, c })
    }
    {
        const { sp, kho } = taoKho({ hong: ['product.findUnique'] }); const c = newCounters()
        await syncProducts(sp, [hangKV], { apply: true }, c)
        ok('S2. tra SKU lỗi ⇒ không tạo hàng, failed 1', !kho.dem['product.create'] && c.failed === 1, { dem: kho.dem, c })
    }
    {
        const { sp, kho } = taoKho(); const c = newCounters()
        await syncProducts(sp, [hangKV], { apply: true }, c)
        ok('S3. đối chứng: chưa có thật ⇒ tạo 1', kho.dem['product.create'] === 1 && c.created === 1 && c.failed === 0, { dem: kho.dem, c })
    }
    const khachKV = { id: 333, code: 'KH000333', name: 'Anh A', contactNumber: '0902222222', debt: 1500000 }
    const khachDaNoi = { khach: [{ id: 'kh-1', code: 'KH-KENGI', name: 'Anh A', phone: '0901111111', debt: 1500000 }], map: { 'customer:333': 'kh-1' } }
    {
        const { sp, kho } = taoKho({ ...khachDaNoi, hong: ['map:customer'] }); const c = newCounters()
        await syncCustomers(sp, [khachKV], { apply: true }, c)
        ok('K1. khách đã nối, bảng nối lỗi ⇒ không đẻ KHÁCH TRÙNG mang nợ 1,5tr, failed 1', !kho.dem['customer.create'] && c.failed === 1, { dem: kho.dem, c })
    }
    {
        const { sp, kho } = taoKho({ hong: ['customer.findFirst'] }); const c = newCounters()
        await syncCustomers(sp, [khachKV], { apply: true }, c)
        ok('K2. tra SĐT lỗi ⇒ không tạo khách, failed 1', !kho.dem['customer.create'] && c.failed === 1, { dem: kho.dem, c })
    }
    {
        const { sp, kho } = taoKho(); const c = newCounters()
        await syncCustomers(sp, [khachKV], { apply: true }, c)
        ok('K3. đối chứng: chưa có thật ⇒ tạo 1', kho.dem['customer.create'] === 1 && c.created === 1 && c.failed === 0, { dem: kho.dem, c })
    }
    const nccKV = { id: 444, code: 'NCC000444', name: 'NCC A', debt: 2500000 }
    {
        const { sp, kho } = taoKho({ ncc: [{ id: 'ncc-1', code: 'NCC-KENGI', name: 'NCC A' }], map: { 'supplier:444': 'ncc-1' }, hong: ['map:supplier'] }); const c = newCounters()
        await syncSuppliers(sp, [nccKV], { apply: true }, c)
        ok('N1. NCC đã nối, bảng nối lỗi ⇒ không đẻ NCC TRÙNG mang nợ phải trả, failed 1', !kho.dem['supplier.create'] && c.failed === 1, { dem: kho.dem, c })
    }
    {
        const { sp, kho } = taoKho({ hong: ['supplier.findUnique'] }); const c = newCounters()
        await syncSuppliers(sp, [nccKV], { apply: true }, c)
        ok('N2. tra mã NCC lỗi ⇒ không tạo NCC, failed 1', !kho.dem['supplier.create'] && c.failed === 1, { dem: kho.dem, c })
    }
    {
        const { sp, kho } = taoKho(); const c = newCounters()
        await syncSuppliers(sp, [nccKV], { apply: true }, c)
        ok('N3. đối chứng: chưa có thật ⇒ tạo 1', kho.dem['supplier.create'] === 1 && c.created === 1 && c.failed === 0, { dem: kho.dem, c })
    }

    console.log('— Sổ quỹ: phiếu thu của hoá đơn không được ghi lần hai khi bảng nối lỗi')
    const phieuThu = { id: 7001, code: 'TT7001', status: 0, amount: 500000, cashGroup: 'Khách trả nợ', partnerType: 'C', partnerId: 333, partnerName: 'Anh A' }
    const daNoiKhach = { khach: [{ id: 'kh-1', code: 'KH-KENGI', name: 'Anh A', phone: '0901111111' }], map: { 'customer:333': 'kh-1' } }
    {
        const { sp, kho } = taoKho({ ...daNoiKhach, hong: ['map:invoicePayment'] }); const c = newCounters()
        await syncCashflow(sp, [phieuThu], { apply: true }, c)
        ok('C1. tra "phiếu thu đã tính vào hoá đơn" lỗi ⇒ không ghi dòng trả nợ / phiếu thu, lỗi nguyên văn',
            !kho.dem['debtEntry.create'] && !kho.dem['cashReceipt.create'] && /Sổ quỹ TT7001/.test(loiGom(c)) && /Can't reach/.test(loiGom(c)), { dem: kho.dem, c })
    }
    {
        const { sp, kho } = taoKho(daNoiKhach); const c = newCounters()
        await syncCashflow(sp, [phieuThu], { apply: true }, c)
        ok('C2. đối chứng: phiếu thu lạ thật ⇒ ghi 1 dòng trả nợ', kho.dem['debtEntry.create'] === 1 && c.created === 1, { dem: kho.dem, c })
    }

    console.log('— Lý do (lyDoChuaDuMa)')
    if (typeof lyDoChuaDuMa !== 'function') {
        ok('L0. có hàm lyDoChuaDuMa', false, typeof lyDoChuaDuMa)
    } else {
        const dai = Array.from({ length: 6 }, (_, i) => ({ sku: `MA-RAT-DAI-CUA-KIOTVIET-${i}-0123456789-ABCDEFGH`, kvProductId: String(i) }))
        const s1 = lyDoChuaDuMa('Phiếu nhập 8141225625 - 1791532673317', dai)
        ok('L1. mã dài ⇒ ≤ 200 ký tự, vẫn giữ trọn lý do', s1.length <= 200 && /lượt sau làm lại$/.test(s1), { len: s1.length, s1 })
        const s2 = lyDoChuaDuMa('HĐ X', [{ sku: 'A{DEL}' }, { sku: 'B' }])
        ok('L2. lẫn mã {DEL} ⇒ nói số mã đã xoá', /1 mã đã XOÁ bên KiotViet/.test(s2), s2)
        const s3 = lyDoChuaDuMa('Phiếu nhập Y', [{ sku: '', kvProductId: '999' }])
        ok('L3. dòng không mã ⇒ hiện #id KiotViet', /#999/.test(s3), s3)
    }

    console.log(`\n${hong ? '✗' : '✓'} ${dat} đạt · ${hong} hỏng\n`)
    process.exit(hong ? 1 : 0)
}
main().catch(e => { inLoiGoc('LỖI:', e); process.exit(1) })
