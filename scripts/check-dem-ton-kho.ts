/**
 * check:dem-ton — BỘ ĐỆM các màn hiện TỒN KHO phải tươi trên MỌI bản Cloud Run (09/11/2026).
 *
 * Bệnh: GET /api/products đệm 300 giây trong bộ nhớ từng bản máy (prod không có Redis); phiếu bán
 * không xoá khoá `products:*`, và kể cả có xoá thì chỉ xoá được ở bản đang xử lý phiếu. POS web /
 * app PC / Android thấy tồn cũ tới 5 phút. Cùng bệnh: /products/stats, /products/bao-cao-ton-kho,
 * /inventory (tổng quan).
 *
 * Bộ soát chạy THẬT bốn handler (lấy thẳng từ router, bỏ qua auth) với storePrisma giả trong bộ nhớ.
 * "Bản Cloud Run khác bán hàng" = sửa thẳng CSDL giả, KHÔNG gọi cacheDel nào — đúng cảnh bản đang
 * phục vụ GET chưa từng được báo. Ca "phải tươi" ĐỎ trên mã cũ (đã thử ngược 09/11/2026), ca "phải
 * đệm" giữ cho bộ đệm vẫn còn tác dụng.
 *
 * Chạy: npm run check:dem-ton
 */
import fs from 'fs'
import path from 'path'

let loi = 0
const dung = (ten: string, dk: boolean, chiTiet?: unknown) => {
    if (dk) console.log(`✓ ${ten}`)
    else { loi++; console.log(`✗ ${ten}`, chiTiet === undefined ? '' : JSON.stringify(chiTiet)) }
}
const GOC = path.resolve(__dirname, '..')
const doc = (p: string) => fs.readFileSync(path.join(GOC, p), 'utf8')

// ─── 1. Soát tĩnh ────────────────────────────────────────────────────────────

/** Thân một tuyến: từ `router.<method>('<đường>'` tới tuyến kế tiếp. */
function thanTuyen(nguon: string, method: string, duong: string): string {
    const dau = nguon.indexOf(`router.${method}('${duong}'`)
    if (dau < 0) return ''
    const sau = nguon.slice(dau + 10).search(/\nrouter\.(get|post|put|patch|delete)\(/)
    return sau < 0 ? nguon.slice(dau) : nguon.slice(dau, dau + 10 + sau)
}
const TUYEN: Array<[string, string, string]> = [
    ['src/routes/products.ts', 'get', '/'],
    ['src/routes/products.ts', 'get', '/stats'],
    ['src/routes/products.ts', 'get', '/bao-cao-ton-kho'],
    ['src/routes/inventory.ts', 'get', '/'],
]
const DOC_DU_LIEU = /\bprisma\s*\.\s*\w+\s*\.\s*(count|findMany|findFirst|aggregate|groupBy)\(|lapBaoCaoTonKho\(|chayTheoDot\(|apLocTon\(/
for (const [tep, m, d] of TUYEN) {
    const than = thanTuyen(doc(tep), m, d)
    const iDoc = than.indexOf('docDemTheoTon(')
    const iDuLieu = than.search(DOC_DU_LIEU)
    dung(`${tep} ${m.toUpperCase()} ${d}: đệm theo phiên bản tồn (docDemTheoTon + ghiDemTheoTon), không cacheGet/cacheSet trần`,
        than.length > 0 && iDoc > 0 && than.includes('ghiDemTheoTon(') && !/\bcache(Get|Set)\(/.test(than),
        { timThay: than.length > 0, iDoc })
    dung(`${tep} ${m.toUpperCase()} ${d}: đọc phiên bản TRƯỚC khi đọc dữ liệu`, iDoc > 0 && iDuLieu > iDoc, { iDoc, iDuLieu })
}

/* SQL thô sửa dòng Product mà không đặt "updatedAt" ⇒ MAX(updatedAt) không nhích ⇒ đổi mã/tên/gộp
 * mã không làm bộ đệm lệch phiên bản (tồn thì SUM vẫn bắt). Danh sách miễn phải kèm lý do. */
const MIEN_UPDATED_AT: Record<string, string> = {
    'src/routes/admin.ts': 'đầu dò sửa dữ liệu chạy tay một lần (SkuMapping/tên) — TTL 60s của danh sách chặn trên',
}
const vipham: string[] = []
;(function quet(thuMuc: string) {
    for (const f of fs.readdirSync(path.join(GOC, thuMuc))) {
        const rel = `${thuMuc}/${f}`
        if (/generated|node_modules/.test(rel)) continue
        const st = fs.statSync(path.join(GOC, rel))
        if (st.isDirectory()) { quet(rel); continue }
        if (!rel.endsWith('.ts') || MIEN_UPDATED_AT[rel]) continue
        const nguon = fs.readFileSync(path.join(GOC, rel), 'utf8')
        for (const k of nguon.matchAll(/UPDATE\s+"Product"(\s+\w+)?\s+SET\b([\s\S]{0,400}?)\bWHERE\b/g)) {
            if (!/"updatedAt"\s*=/.test(k[2])) vipham.push(`${rel}:${nguon.slice(0, k.index).split('\n').length}`)
        }
    }
})('src')
dung('SQL thô UPDATE "Product" đều đặt "updatedAt" (ngoài danh sách miễn có lý do)', vipham.length === 0, vipham)

// ─── 2. Chạy thật handler với storePrisma giả ────────────────────────────────

type Dong = Record<string, any>
function taoCuaHang() {
    let dongHo = Date.parse('2026-11-09T01:00:00.000Z')
    const gio = () => new Date(++dongHo)
    const sp = (id: string, ten: string, ton: number, them: Dong = {}): Dong => ({
        id, name: ten, sku: id.toUpperCase(), barcode: null, description: null, productType: 'goods', categoryId: 'c1',
        brandId: null, costPrice: 3000, sellingPrice: 5000, taxInclusive: true, stock: ton, minStock: 2, maxStock: null,
        baseUnit: 'Cái', invoiceUnit: null, trackSerial: false, mergedIntoId: null, mergedRate: null,
        createdAt: gio(), updatedAt: gio(), ...them,
    })
    const db: Record<string, Dong[]> = {
        product: [sp('p1', 'Bút bi', 10), sp('p2', 'Thước kẻ', 1), sp('p3', 'Gói bảo hành', 0, { productType: 'service' })],
        warehouse: [{ id: 'wh1', type: 'main', isDefault: true, branchId: 'cn1' }],
        branch: [{ id: 'cn1', isMainBranch: true }],
        category: [{ id: 'c1', name: 'Văn phòng phẩm' }],
        brand: [], productImage: [], unitConversion: [],
    }
    db.warehouseStock = db.product.map(p => ({ id: `ws-${p.id}`, warehouseId: 'wh1', productId: p.id, quantity: p.stock, updatedAt: gio(), createdAt: gio() }))
    const dem = { truyVan: 0, phienBan: 0 }
    const co = { hongPhienBan: false, sauDocDanhSach: null as null | (() => void) }

    const khop = (r: Dong, w: Dong = {}): boolean => Object.entries(w).every(([k, v]) => {
        if (k === 'OR') return (v as Dong[]).some(x => khop(r, x))
        if (v !== null && typeof v === 'object' && !(v instanceof Date)) {
            const x = r[k]
            if ('not' in v && x === v.not) return false
            if ('gt' in v && !(x > v.gt)) return false
            if ('gte' in v && !(x >= v.gte)) return false
            if ('lt' in v && !(x < v.lt)) return false
            if ('lte' in v && !(x <= v.lte)) return false
            if ('in' in v && !v.in.includes(x)) return false
            if ('notIn' in v && v.notIn.includes(x)) return false
            if ('contains' in v && !String(x ?? '').toLowerCase().includes(String(v.contains).toLowerCase())) return false
            return true
        }
        return r[k] === v
    })
    const chon = (r: Dong, select?: Dong) => select ? Object.fromEntries(Object.keys(select).map(k => [k, r[k]])) : { ...r }
    const kemTheo = (bang: string, r: Dong, include?: Dong) => {
        const ra: Dong = { ...r }
        if (bang === 'product' && include) {
            if (include.category) ra.category = db.category.find(c => c.id === r.categoryId) || null
            if (include.brand) ra.brand = db.brand.find(b => b.id === r.brandId) || null
            if (include.images) ra.images = db.productImage.filter(i => i.productId === r.id)
            if (include.unitConversions) ra.unitConversions = db.unitConversion.filter(u => u.productId === r.id)
        }
        return ra
    }
    const mo = (bang: string) => ({
        count: async (a: Dong = {}) => { dem.truyVan++; return db[bang].filter(r => khop(r, a.where)).length },
        findMany: async (a: Dong = {}) => {
            dem.truyVan++
            let ds = db[bang].filter(r => khop(r, a.where))
            if (a.orderBy) {
                const [k, chieu] = Object.entries(a.orderBy)[0] as [string, string]
                ds = [...ds].sort((x, y) => (x[k] > y[k] ? 1 : x[k] < y[k] ? -1 : 0) * (chieu === 'desc' ? -1 : 1))
            }
            ds = ds.slice(a.skip || 0, a.take ? (a.skip || 0) + a.take : undefined)
            const ra = ds.map(r => a.select ? chon(r, a.select) : kemTheo(bang, r, a.include))
            if (bang === 'product' && co.sauDocDanhSach) { const f = co.sauDocDanhSach; co.sauDocDanhSach = null; f() }
            return ra
        },
        findFirst: async (a: Dong = {}) => { dem.truyVan++; const r = db[bang].find(x => khop(x, a.where)); return r ? chon(r, a.select) : null },
        aggregate: async (a: Dong = {}) => {
            dem.truyVan++
            const ds = db[bang].filter(r => khop(r, a.where))
            return { _sum: Object.fromEntries(Object.keys(a._sum || {}).map(k => [k, ds.reduce((s, r) => s + (r[k] || 0), 0)])) }
        },
        upsert: async () => { throw new Error(`prisma giả: không được ghi ${bang} trong ca này`) },
    })
    /* Chỉ trả những cột câu SQL THẬT SỰ hỏi (theo bí danh) — bỏ SUM(stock) khỏi CAU_PHIEN_BAN_TON là
     * ca "giao dịch dài commit sau" đỏ ngay, không phải tin vào lời chú thích. */
    const tinhPhienBan = (sql: string) => {
        const p = db.product, w = db.warehouseStock
        const max = (ds: Dong[]) => ds.reduce((m: Date | null, r) => (!m || r.updatedAt > m ? r.updatedAt : m), null)
        const du: Dong = {
            n: p.length, m: max(p), s: BigInt(p.reduce((a, r) => a + r.stock, 0)),
            wn: w.length, wm: max(w), ws: BigInt(w.reduce((a, r) => a + r.quantity, 0)),
        }
        const hoi: Dong = {
            n: /COUNT\(\*\)::int AS n\b/, m: /MAX\("updatedAt"\) AS m\b/, s: /SUM\(stock\), 0\)::bigint AS s\b/,
            wn: /COUNT\(\*\)::int AS wn\b/, wm: /MAX\("updatedAt"\) AS wm\b/, ws: /SUM\(quantity\), 0\)::bigint AS ws\b/,
        }
        return [Object.fromEntries(Object.keys(du).filter(k => hoi[k].test(sql)).map(k => [k, du[k]]))]
    }
    const prisma: any = {
        product: mo('product'), warehouse: mo('warehouse'), warehouseStock: mo('warehouseStock'),
        branch: mo('branch'), category: mo('category'),
        $queryRawUnsafe: async (sql: string) => {
            if (/FROM "WarehouseStock"\) kho/.test(sql)) {
                dem.phienBan++
                if (co.hongPhienBan) throw Object.assign(new Error('mất kết nối (giả)'), { code: 'P1001' })
                return tinhPhienBan(sql)
            }
            dem.truyVan++
            if (/GROUP BY p\."categoryId"/.test(sql)) {     // lapBaoCaoTonKho — đủ trường để thấy tồn đổi
                const g = db.product.filter(p => p.productType === 'goods')
                return [{
                    categoryId: 'c1', ten: 'Văn phòng phẩm', soMa: g.length,
                    hetHang: g.filter(p => p.stock <= 0).length, sapHet: g.filter(p => p.stock > 0 && p.stock <= p.minStock).length,
                    conHang: g.filter(p => p.stock > p.minStock).length, tonAm: g.filter(p => p.stock < 0).length, maGop: 0, thieuGiaVon: 0,
                    tongTon: g.reduce((a, p) => a + Math.max(0, p.stock), 0), giaTriVon: 0, giaTriBan: 0,
                }]
            }
            if (/stock <= "minStock"/.test(sql)) return db.product.filter(p => p.stock > 0 && p.stock <= p.minStock).map(p => ({ id: p.id }))
            throw new Error('prisma giả: SQL lạ ' + sql.slice(0, 60))
        },
    }
    /** "Bản Cloud Run khác" bán hàng: sửa thẳng CSDL, không ai gọi cacheDel. `updatedAt` = giờ CÂU LỆNH. */
    const banHang = (id: string, sl: number, updatedAt: Date = gio()) => {
        const p = db.product.find(r => r.id === id)!
        p.stock -= sl; p.updatedAt = updatedAt
        const w = db.warehouseStock.find(r => r.productId === id)!
        w.quantity -= sl; w.updatedAt = updatedAt
    }
    return { db, dem, co, prisma, gio, banHang }
}

;(async () => {
    delete process.env.REDIS_URL                        // bộ đệm bộ nhớ — đúng như prod
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'khoa-thu-check-dem-ton'
    process.env.DATABASE_URL = 'postgresql://khong-dung-db@127.0.0.1:9/khong'   // bộ soát không bao giờ chạm CSDL thật
    const { default: productsRouter } = await import('../src/routes/products')
    const { default: inventoryRouter } = await import('../src/routes/inventory')
    const handler = (router: any, duong: string): Function | null => {
        const lop = router.stack.find((l: any) => l.route?.path === duong && l.route.methods.get)
        const buoc = lop?.route.stack.map((l: any) => l.handle) || []
        return buoc.length ? buoc[buoc.length - 1] : null
    }
    let soCuaHang = 0
    const goi = async (h: Function, ch: ReturnType<typeof taoCuaHang>, query: Dong = {}) => {
        const req: any = { storePrisma: ch.prisma, user: ch.nguoi, query, headers: { 'x-branch-id': 'cn1' } }
        const res: any = { ma: 200, than: null as any, status(c: number) { this.ma = c; return this }, json(b: any) { this.than = b; return this } }
        await h(req, res, () => { })
        return res
    }
    const moi = () => {
        const ch = taoCuaHang() as ReturnType<typeof taoCuaHang> & { nguoi: Dong }
        ch.nguoi = { storeSchema: `branch_thu_${++soCuaHang}`, userId: 'u1', role: 'admin' }   // mỗi ca một cửa hàng ⇒ khoá đệm riêng
        return ch
    }

    const hDs = handler(productsRouter, '/')
    const hStats = handler(productsRouter, '/stats')
    const hBaoCao = handler(productsRouter, '/bao-cao-ton-kho')
    const hKho = handler(inventoryRouter, '/')
    dung('tìm được 4 handler trong router', !!(hDs && hStats && hBaoCao && hKho))
    if (!(hDs && hStats && hBaoCao && hKho)) { console.log(`\n${loi} lỗi`); process.exit(1) }

    // 2a. GET /api/products?page=1&pageSize=1000 — đúng truy vấn của app PC (nút ↻ gửi lại y hệt)
    {
        const ch = moi()
        const q = { page: '1', pageSize: '1000' }
        const ton = (r: any, id = 'p1') => r.than?.data?.items?.find((x: any) => x.id === id)
        const r1 = await goi(hDs, ch, q)
        dung('/products: lần đầu trả tồn 10, tồn chi nhánh 10', r1.ma === 200 && ton(r1)?.stock === 10 && ton(r1)?.branchStock === 10, r1.than)
        const tv = ch.dem.truyVan
        const r2 = await goi(hDs, ch, q)
        dung('/products: không đổi gì ⇒ trả từ bộ đệm (không truy vấn dữ liệu lại)', ch.dem.truyVan === tv && ton(r2)?.stock === 10, { truyVan: ch.dem.truyVan - tv })

        ch.banHang('p1', 1)
        const r3 = await goi(hDs, ch, q)
        dung('/products: bản Cloud Run KHÁC bán 1 cái ⇒ lần tải sau thấy tồn 9 (cả tồn chi nhánh)', ton(r3)?.stock === 9 && ton(r3)?.branchStock === 9,
            { stock: ton(r3)?.stock, branchStock: ton(r3)?.branchStock })

        // Giao dịch dài L: lệnh trừ kho p1 chạy lúc t1 nhưng commit SAU giao dịch ngắn X (nhập p2 lúc t2 > t1).
        // Bản B dựng đệm giữa hai lần commit ⇒ khi L commit, MAX(updatedAt) cả hai bảng vẫn là t2, COUNT không đổi.
        const t1 = ch.gio()
        const p2 = ch.db.product.find(p => p.id === 'p2')!, w2 = ch.db.warehouseStock.find(w => w.productId === 'p2')!
        const t2 = ch.gio(); p2.stock += 5; w2.quantity += 5; p2.updatedAt = t2; w2.updatedAt = t2
        await goi(hDs, ch, q)                                           // bản B dựng đệm: thấy X, chưa thấy L
        ch.banHang('p1', 1, t1)                                         // L commit với updatedAt t1 < t2
        const r4 = await goi(hDs, ch, q)
        dung('/products: giao dịch dài commit sau (updatedAt cũ hơn MAX) ⇒ vẫn thấy tồn 8 (nhờ SUM tồn)', ton(r4)?.stock === 8, { stock: ton(r4)?.stock })

        const p1 = ch.db.product.find(p => p.id === 'p1')!
        p1.sellingPrice = 6000; p1.updatedAt = ch.gio()
        const r5 = await goi(hDs, ch, q)
        dung('/products: đổi giá (tổng tồn không đổi) ⇒ thấy giá mới nhờ MAX(updatedAt)', ton(r5)?.sellingPrice === 6000, { gia: ton(r5)?.sellingPrice })

        // Phiếu commit GIỮA lúc đang dựng lại (ngay sau câu đọc danh sách): lần này được phép trả số trước
        // phiếu, nhưng lần SAU phải thấy phiếu. Ghi đệm kèm phiên bản đọc LẠI sau khi dựng ⇒ kẹt 8 mãi.
        const p2b = ch.db.product.find(p => p.id === 'p2')!
        p2b.sellingPrice = 7000; p2b.updatedAt = ch.gio()             // để lần này phải dựng lại
        ch.co.sauDocDanhSach = () => ch.banHang('p1', 1)
        const r6 = await goi(hDs, ch, q)
        const r7 = await goi(hDs, ch, q)
        dung('/products: phiếu commit GIỮA lúc dựng lại ⇒ lần sau thấy tồn 7, không kẹt bản cũ', ch.co.sauDocDanhSach === null && ton(r7)?.stock === 7,
            [ton(r6)?.stock, ton(r7)?.stock])

        // Đọc phiên bản hỏng ⇒ không dùng/không ghi đệm, trang vẫn chạy
        ch.co.hongPhienBan = true
        const loiGoc = console.error, nhatKy: string[] = []
        console.error = (...a: any[]) => { nhatKy.push(a.map(String).join(' ')) }
        const tv2 = ch.dem.truyVan
        const r8 = await goi(hDs, ch, q)
        const tv3 = ch.dem.truyVan
        ch.banHang('p1', 1)
        const r9 = await goi(hDs, ch, q)
        console.error = loiGoc
        dung('/products: đọc phiên bản hỏng ⇒ vẫn trả 200 với dữ liệu tươi, mỗi lần đều dựng lại', r8.ma === 200 && r9.ma === 200
            && tv3 > tv2 && ch.dem.truyVan > tv3 && ton(r8)?.stock === 7 && ton(r9)?.stock === 6, { r8: ton(r8)?.stock, r9: ton(r9)?.stock })
        dung('/products: đọc phiên bản hỏng ⇒ có dòng log [phienBanTon] kèm mã lỗi (không nuốt im)',
            nhatKy.filter(x => x.includes('[phienBanTon]') && x.includes('mất kết nối')).length === 2, nhatKy.length)
        ch.co.hongPhienBan = false
        const r10 = await goi(hDs, ch, q)
        dung('/products: CSDL lành lại ⇒ tồn đúng 6', ton(r10)?.stock === 6, ton(r10)?.stock)

        // Tìm theo mã (POS quét mã vạch) — khoá đệm khác, cùng phiên bản
        const rq = await goi(hDs, ch, { search: 'p2', pageSize: '10' })
        ch.banHang('p2', 1)
        const rq2 = await goi(hDs, ch, { search: 'p2', pageSize: '10' })
        dung('/products?search=: bán ở bản khác ⇒ kết quả tìm cũng tươi (6 → 5)', ton(rq, 'p2')?.stock === 6 && ton(rq2, 'p2')?.stock === 5,
            [ton(rq, 'p2')?.stock, ton(rq2, 'p2')?.stock])
    }

    // 2b. GET /api/products/stats
    {
        const ch = moi()
        const r1 = await goi(hStats, ch)
        const tv = ch.dem.truyVan
        await goi(hStats, ch)
        dung('/products/stats: không đổi ⇒ trả từ bộ đệm', ch.dem.truyVan === tv)
        ch.banHang('p2', 1)                                             // p2: 1 → 0 ⇒ thêm một mã hết hàng
        const r2 = await goi(hStats, ch)
        dung('/products/stats: bán hết p2 ở bản khác ⇒ "hết hàng" tăng 1', r2.than?.data?.outOfStock === r1.than?.data?.outOfStock + 1,
            [r1.than?.data?.outOfStock, r2.than?.data?.outOfStock])
    }

    // 2c. GET /api/products/bao-cao-ton-kho
    {
        const ch = moi()
        const r1 = await goi(hBaoCao, ch)
        const tv = ch.dem.truyVan
        await goi(hBaoCao, ch)
        dung('/products/bao-cao-ton-kho: không đổi ⇒ trả từ bộ đệm', ch.dem.truyVan === tv)
        ch.banHang('p1', 3)
        const r2 = await goi(hBaoCao, ch)
        dung('/products/bao-cao-ton-kho: bán 3 ở bản khác ⇒ tổng tồn giảm 3', r2.than?.data?.tongQuan?.tongTon === r1.than?.data?.tongQuan?.tongTon - 3,
            [r1.than?.data?.tongQuan?.tongTon, r2.than?.data?.tongQuan?.tongTon])
    }

    // 2d. GET /api/inventory (tổng quan kho)
    {
        const ch = moi()
        const r1 = await goi(hKho, ch)
        const tv = ch.dem.truyVan
        await goi(hKho, ch)
        dung('/inventory: không đổi ⇒ trả từ bộ đệm', ch.dem.truyVan === tv)
        ch.banHang('p1', 2)
        const r2 = await goi(hKho, ch)
        dung('/inventory: bán 2 ở bản khác ⇒ tổng tồn giảm 2', r2.than?.data?.totalStock === r1.than?.data?.totalStock - 2,
            [r1.than?.data?.totalStock, r2.than?.data?.totalStock])
    }

    console.log(loi ? `\n✗ ${loi} lỗi` : '\n✓ bộ đệm tồn kho: đạt hết')
    process.exit(loi ? 1 : 0)
})().catch(e => { console.error('✗ bộ soát sập:', e); process.exit(1) })
