/**
 * check-lazada-ton — kéo danh mục + đẩy tồn Lazada (13/11/2026, chủ shop duyệt "kéo sản phẩm + đẩy tồn" cho Lazada).
 *
 *  A. Phép chiếu thuần của LazadaService (tồn đang bán, tên phân loại, giá đang bán, trạng thái, một mã → một dòng danh mục),
 *     dựng trên hình dữ liệu ĐO THẬT 13/11 (GetProducts gian KENGISTORE).
 *  B. fetchProducts / docSanPhamTho với httpGet giả: lật trang theo offset, chống trùng, lỗi Lazada ném nguyên văn.
 *  C. updateStock: payload XML UpdateSellableQuantity (thoát ký tự, số âm / lẻ), lỗi + detail nguyên văn, thiếu mã thì KHÔNG gọi.
 *  D. Lõi đẩy tồn (lib/dayTonLenSan) cho kênh Lazada trên prisma giả + sàn giả (giaLap): chạy thử không ghi gì, chạy thật đẩy
 *     đúng SkuId + SellerSku từng SKU, mã không thấy trên sàn / SKU nhiều kho / đọc hỏng ⇒ KHÔNG đẩy, cầu dao vẫn chặn.
 *
 * Không gọi mạng, không đụng CSDL. Chạy: npm run check:lazada-ton
 */
import { LazadaService } from '../src/services/platforms/lazada'
import { dayTonLenSan } from '../src/lib/dayTonLenSan'

let dat = 0, hong = 0
function ca(ten: string, dung: boolean, them = '') { if (dung) dat++; else { hong++; console.log(`  ✗ ${ten}${them ? ` — ${them}` : ''}`) } }

// ─── Hình dữ liệu đo thật 13/11/2026 (rút gọn) ───────────────────────────────────
const kho = (n: number, them: any = {}) => ({ occupyQuantity: 0, quantity: n, totalQuantity: n, bizType: 1, withholdQuantity: 0, bizCode: '', warehouseType: 'dropshipping', warehouseCode: 'dropshipping', sellableQuantity: n, ...them })
const sku = (skuId: number, sellerSku: string, n: number, them: any = {}) => ({
    Status: 'active', quantity: n, Available: n, SellerSku: sellerSku, SkuId: skuId, ShopSku: `x_VNAMZ-${skuId}`, Images: [],
    saleProp: {}, multiWarehouseInventories: [kho(n)], fblWarehouseInventories: [], channelInventories: [], price: 180000, ...them,
})
const ma = (itemId: number, ten: string, skus: any[], them: any = {}) => ({
    created_time: '1746937770633', updated_time: '1793239043140', images: [`https://anh/${itemId}.png`], item_id: itemId,
    trialProduct: false, primary_category: 12582, marketImages: [], attributes: { name: ten, brand: 'Sunhouse' }, status: 'Active', skus, ...them,
})

async function main() {
    // ─── A. Phép chiếu thuần ─────────────────────────────────────────────────────
    {
        const t = LazadaService.tonDangBanSku
        ca('A1 sellableStock (options=1) đứng đầu', t({ sellableStock: 7, multiWarehouseInventories: [kho(9)], Available: 9, quantity: 12 }) === 7)
        ca('A2 kho duy nhất ⇒ sellableQuantity (thắng Available / quantity TỔNG)', t({ multiWarehouseInventories: [kho(4, { totalQuantity: 6, occupyQuantity: 2 })], Available: 5, quantity: 6 }) === 4)
        ca('A3 nhiều kho ⇒ cộng sellableQuantity', t({ multiWarehouseInventories: [kho(3), kho(2, { warehouseCode: 'k2' })] }) === 5)
        ca('A4 không có kho ⇒ Available, rồi quantity', t({ Available: 8, quantity: 10 }) === 8 && t({ quantity: 10 }) === 10)
        ca('A5 không trường nào ⇒ 0; số âm ⇒ 0; số lẻ ⇒ làm tròn xuống', t({}) === 0 && t({ Available: -3 }) === 0 && t({ Available: 2.7 }) === 2)
        ca('A6 sellableStock = 0 vẫn là 0 (không rơi xuống quantity)', t({ sellableStock: 0, quantity: 10 }) === 0)

        ca('A7 tên phân loại từ saleProp', LazadaService.tenPhanLoaiSku({ saleProp: { color_family: 'Pink', size: '1L' }, SellerSku: 'X' }) === 'Pink / 1L')
        ca('A8 saleProp rỗng ⇒ SellerSku', LazadaService.tenPhanLoaiSku({ saleProp: {}, SellerSku: 'SHD8300' }) === 'SHD8300')

        const g = LazadaService.giaDangBanSku
        ca('A9 special_price thấp hơn price ⇒ giá đang bán = special (đơn thật SHD8300 bán 935.000)', g({ price: 1250000, special_price: 935000 }) === 935000)
        ca('A10 không special / special 0 / special ≥ price ⇒ price', g({ price: 180000 }) === 180000 && g({ price: 180000, special_price: 0 }) === 180000 && g({ price: 180000, special_price: 200000 }) === 180000)

        const tt = LazadaService.trangThaiMa
        ca('A11 trạng thái: Active→NORMAL, Suspended→BANNED, InActive→UNLIST, deleted→DELETED, lạ giữ nguyên',
            tt('Active') === 'NORMAL' && tt('Suspended') === 'BANNED' && tt('InActive') === 'UNLIST' && tt('deleted') === 'DELETED' && tt('Pending QC') === 'Pending QC')

        const coc = ma(3109431637, '[Hàng Chính Hãng] Cốc Giữ Nhiệt Snappy 500ml', [
            sku(14887569951, 'KS-TU500SP', 10, { saleProp: { color_family: 'Pink' }, special_price: 148500 }),
            sku(14887569950, 'KS-TU500SB', 0, { saleProp: { color_family: 'Black' }, special_price: 148500 }),
            sku(14887569952, 'KS-TU500SW', 4, { saleProp: { color_family: 'White' }, special_price: 148500 }),
        ])
        const p = LazadaService.chuyenSanPham(coc)!
        ca('A12 một mã nhiều SKU ⇒ MỘT dòng: id = item_id, sku = SKU đầu, tồn = Σ (10+0+4), giá = special SKU đầu, ngành, ảnh',
            p.platformProductId === '3109431637' && p.sku === 'KS-TU500SP' && p.stock === 14 && p.price === 148500
            && p.status === 'NORMAL' && p.categoryId === '12582' && p.imageUrl === 'https://anh/3109431637.png' && p.name.startsWith('[Hàng Chính Hãng] Cốc'), JSON.stringify(p))
        ca('A13 mã không item_id ⇒ bỏ (null); mã không SKU ⇒ tồn 0, giá 0, không sku',
            LazadaService.chuyenSanPham({ skus: [] }) === null
            && (() => { const q = LazadaService.chuyenSanPham(ma(5, 'Không SKU', []))!; return q.stock === 0 && q.price === 0 && q.sku === undefined })())
    }

    // ─── B. fetchProducts / docSanPhamTho ────────────────────────────────────────
    {
        const svc: any = new LazadaService({ apiKey: 'k', apiSecret: 's', accessToken: 't' } as any)
        const tatCa = Array.from({ length: 72 }, (_, i) => ma(1000 + i, `Hàng ${i}`, [sku(9000 + i, `M${i}`, i % 5)]))
        const offsets: number[] = []
        svc.httpGet = async (url: string) => {
            const u = new URL(url)
            if (!u.pathname.endsWith('/products/get')) throw new Error('bộ kiểm: lời gọi ngoài dự kiến ' + u.pathname)
            const off = Number(u.searchParams.get('offset')), lim = Number(u.searchParams.get('limit'))
            offsets.push(off)
            const trang = tatCa.slice(off, off + lim)
            if (off === 50) trang.push(tatCa[3]!)          // Lazada trả trùng một mã ở trang sau
            return { code: '0', data: { total_products: 72, products: trang } }
        }
        const r = await svc.fetchProducts()
        ca('B1 lật trang offset 0, 50 (limit 50) rồi dừng — 72 mã, trùng bị bỏ, tổng = total_products',
            offsets.join() === '0,50' && r.products.length === 72 && r.total === 72 && new Set(r.products.map((x: any) => x.platformProductId)).size === 72,
            JSON.stringify({ offsets, n: r.products.length, total: r.total }))
        const thamSo: string[] = []
        svc.httpGet = async (url: string) => {
            thamSo.push([...new URL(url).searchParams.keys()].filter(k => !['app_key', 'timestamp', 'sign_method', 'access_token', 'sign'].includes(k)).sort().join(','))
            return { code: '0', data: { total_products: 0, products: [] } }
        }
        const rong = await svc.fetchProducts()
        ca('B2 danh mục trọn bộ: chỉ filter/limit/offset — KHÔNG lọc ngày (create_after / update_after)', thamSo.join('|') === 'filter,limit,offset' && rong.products.length === 0, JSON.stringify(thamSo))
        svc.httpGet = async () => ({ code: 'IllegalAccessToken', message: 'The specified access token is invalid or expired' })
        let loi = ''
        try { await svc.fetchProducts() } catch (e: any) { loi = e.message }
        ca('B3 lỗi token ⇒ NÉM nguyên văn Lazada (không trả danh mục rỗng như thể gian trống)', /Lazada từ chối kênh: \[IllegalAccessToken\] The specified access token is invalid/.test(loi), loi)
        let lan = 0
        svc.httpGet = async (url: string) => {
            lan++
            const off = Number(new URL(url).searchParams.get('offset'))
            if (off === 50) return { code: 'E500', message: 'Internal system error' }
            return { code: '0', data: { total_products: 72, products: tatCa.slice(0, 50) } }
        }
        loi = ''
        try { await svc.fetchProducts() } catch (e: any) { loi = e.message }
        ca('B4 hỏng GIỮA chừng (trang 2) ⇒ ném kèm offset, không trả nửa danh mục', lan === 2 && /products\/get \(offset 50\): \[E500\] Internal system error/.test(loi), loi)
    }

    // ─── C. updateStock ──────────────────────────────────────────────────────────
    {
        const svc: any = new LazadaService({ apiKey: 'k', apiSecret: 's', accessToken: 't' } as any)
        const goi: URL[] = []
        svc.httpGet = async (url: string) => { goi.push(new URL(url)); return { code: '0', request_id: 'r' } }
        await svc.updateStock('3093519331', 7.9, '14842255527', 'A&B<"x">\'')
        const u = goi[0]!
        const xml = u.searchParams.get('payload') || ''
        ca('C1 đúng API /product/stock/sellable/update, payload ký chung tham số (có sign)', u.pathname.endsWith('/product/stock/sellable/update') && !!u.searchParams.get('sign'), u.pathname)
        ca('C2 payload: ItemId + SkuId + SellerSku (đã thoát &<>"\') + SellableQuantity làm tròn xuống',
            xml === '<Request><Product><Skus><Sku><ItemId>3093519331</ItemId><SkuId>14842255527</SkuId><SellerSku>A&amp;B&lt;&quot;x&quot;&gt;&apos;</SellerSku><SellableQuantity>7</SellableQuantity></Sku></Skus></Product></Request>', xml)
        goi.length = 0
        await svc.updateStock('1', -4, undefined, 'M1')
        ca('C3 số âm ⇒ 0; thiếu SkuId ⇒ bỏ thẻ SkuId (không gửi rỗng)', (goi[0]!.searchParams.get('payload') || '') === '<Request><Product><Skus><Sku><ItemId>1</ItemId><SellerSku>M1</SellerSku><SellableQuantity>0</SellableQuantity></Sku></Skus></Product></Request>')
        goi.length = 0
        let loi = ''
        try { await svc.updateStock('1', 5, '', '  ') } catch (e: any) { loi = e.message }
        ca('C4 thiếu cả SkuId lẫn SellerSku ⇒ KHÔNG gọi sàn, báo rõ', goi.length === 0 && /thiếu cả SkuId lẫn SellerSku/.test(loi), loi)
        svc.httpGet = async () => ({ code: '500', message: 'E0501: Update sellable quantity failed', detail: [{ field: 'SellableQuantity', message: 'Sellable quantity can not be less than 0', seller_sku: 'M1' }] })
        loi = ''
        try { await svc.updateStock('1', 5, '9', 'M1') } catch (e: any) { loi = e.message }
        ca('C5 Lazada từ chối ⇒ ném NGUYÊN VĂN kèm detail từng SKU', /Lazada sellable\/update: \[500\] E0501: Update sellable quantity failed — M1 SellableQuantity Sellable quantity can not be less than 0/.test(loi), loi)
    }

    // ─── D. Lõi đẩy tồn cho kênh Lazada ──────────────────────────────────────────
    const kenh = { id: 'chL', name: 'Kengi Store', platform: 'lazada', shopId: '', accessToken: 'tL', apiKey: 'k', apiSecret: 's', tokenExpiresAt: null }
    const taoCuaHang = () => {
        const ghi: string[] = []
        const listing = [
            { id: 'o1', channelId: 'chL', platformProductId: '101', sku: 'MOT', name: 'Một SKU', stock: 10, localProduct: { id: 'p1', sku: 'MOT', stock: 3 } },
            { id: 'o2', channelId: 'chL', platformProductId: '102', sku: 'PA', name: 'Ba phân loại', stock: 11, localProduct: null },
            { id: 'o3', channelId: 'chL', platformProductId: '103', sku: 'DAXOA', name: 'Đã gỡ trên sàn', stock: 6, localProduct: { id: 'p5', sku: 'DAXOA', stock: 0 } },
            { id: 'o4', channelId: 'chL', platformProductId: '104', sku: 'HAIKHO', name: 'Hai kho', stock: 8, localProduct: { id: 'p6', sku: 'HAIKHO', stock: 1 } },
        ]
        const khoSku = [
            { id: 'p1', sku: 'MOT', stock: 3, mergedIntoId: null, mergedRate: 1 },
            { id: 'p2', sku: 'PA', stock: 5, mergedIntoId: null, mergedRate: 1 },
            { id: 'p3', sku: 'PB', stock: 0, mergedIntoId: null, mergedRate: 1 },
            { id: 'p5', sku: 'DAXOA', stock: 0, mergedIntoId: null, mergedRate: 1 },
            { id: 'p6', sku: 'HAIKHO', stock: 1, mergedIntoId: null, mergedRate: 1 },
        ]
        const pz: any = {
            onlineChannel: { findUnique: async ({ where }: any) => (where.id === kenh.id ? kenh : null), update: async () => { ghi.push('kenh'); return {} } },
            onlineProduct: {
                findMany: async ({ where }: any) => listing.filter(l => l.channelId === where.channelId && (!where.id?.in || where.id.in.includes(l.id))),
                update: async ({ where, data }: any) => { ghi.push(`sp:${where.id}:${data.stock}`); const l = listing.find(x => x.id === where.id); if (l) Object.assign(l, data); return l },
            },
            product: {
                findFirst: async ({ where }: any) => khoSku.find(h => where?.sku != null && h.sku === where.sku) || null,
                findUnique: async ({ where }: any) => khoSku.find(h => h.id === where?.id) || null,
            },
            skuMapping: { findFirst: async () => null },
            syncLog: { create: async ({ data }: any) => { ghi.push(`so:${data.details}`); return data } },
        }
        return { pz, ghi, listing }
    }
    // Sàn giả: 101 một SKU (sàn 10); 102 ba SKU PA (sàn 5) / PB (sàn 4) / PC (sàn 2, không có trong kho); 104 một SKU nằm 2 kho;
    // 103 KHÔNG có trên sàn (đã gỡ). `hongDoc` ⇒ GetProducts lỗi.
    const sanGia = (o: { hongDoc?: boolean; them?: any[] } = {}) => {
        const goi: string[] = [], doc: string[] = []
        return {
            goi, doc,
            dichVu: {
                credentials: {},
                docSanPhamTho: async () => {
                    doc.push('products/get')
                    if (o.hongDoc) throw new Error('Lazada products/get (offset 0): [E500] Internal system error')
                    return {
                        tong: 3, items: [
                            ma(101, 'Một SKU', [sku(5101, 'MOT', 10)]),
                            ma(102, 'Ba phân loại', [
                                sku(5201, 'PA', 5, { saleProp: { color_family: 'Đỏ' } }),
                                sku(5202, 'PB', 4, { saleProp: { color_family: 'Xanh' } }),
                                sku(5203, 'PC', 2, { saleProp: { color_family: 'Vàng' } }),
                            ]),
                            ma(104, 'Hai kho', [sku(5401, 'HAIKHO', 8, { multiWarehouseInventories: [kho(5), kho(3, { warehouseCode: 'k2' })] })]),
                            ...(o.them || []),
                        ],
                    }
                },
                updateStock: async (id: string, n: number, skuId?: string, sellerSku?: string) => { goi.push(`ton:${id}:${n}:${skuId ?? '-'}:${sellerSku ?? '-'}`) },
                refreshAccessToken: async () => { throw new Error('bộ kiểm không cho làm mới token') },
            },
        }
    }

    {
        const g = taoCuaHang(), san = sanGia()
        const thu = await dayTonLenSan(g.pz, 'chL', { dryRun: true, giaLap: { dichVu: san.dichVu } })
        const d = thu.data || {}
        const dong = (sku: string) => (d.bang || []).find((x: any) => x.sku === sku)
        ca('D1 chạy thử: đọc sàn MỘT lần, KHÔNG ghi gì (sàn lẫn CSDL)', thu.ok && san.doc.length === 1 && san.goi.length === 0 && g.ghi.length === 0, JSON.stringify({ doc: san.doc, goi: san.goi, ghi: g.ghi }))
        ca('D2 một SKU: tồn sàn ĐỌC SỐNG 10 → đẩy 3', dong('MOT')?.tonDangTrenSan === 10 && dong('MOT')?.seDay === 3 && !dong('MOT')?.boQua, JSON.stringify(dong('MOT')))
        ca('D3 ba phân loại: PA 5→5 giữ nguyên, PB 4→0, PC không có trong kho ⇒ bỏ qua có lý do',
            dong('PA')?.boQua === true && dong('PB')?.seDay === 0 && dong('PB')?.tonDangTrenSan === 4 && !dong('PC')
            && d.phanLoai?.soListing === 1 && d.phanLoai?.boQua === 1 && /PC/.test((d.phanLoai?.viDuBoQua || []).join()), JSON.stringify({ bang: d.bang, phanLoai: d.phanLoai }))
        ca('D4 mã KHÔNG thấy trên Lazada (đã gỡ) ⇒ không vào bảng, ghi chú đọc sàn nói rõ — KHÔNG đẩy 0 đè',
            !dong('DAXOA') && (d.docSan || []).some((x: string) => /1 mã có trong Kengi nhưng KHÔNG thấy trên Lazada.*DAXOA/.test(x)), JSON.stringify(d.docSan))
        ca('D5 SKU nằm 2 kho ⇒ không vào bảng, ghi chú "nhiều kho" — không đoán kho',
            !dong('HAIKHO') && (d.docSan || []).some((x: string) => /1 SKU nằm ở nhiều kho Lazada.*HAIKHO/.test(x)), JSON.stringify(d.docSan))
        ca('D6 đếm: sẽ đẩy 2 (MOT, PB); cầu dao im (1 mã về 0 < 5)', d.seDay === 2 && d.cauDao === null && d.veKhong === 1, JSON.stringify({ seDay: d.seDay, cauDao: d.cauDao, veKhong: d.veKhong }))

        const that = await dayTonLenSan(g.pz, 'chL', { giaLap: { dichVu: san.dichVu } })
        ca('D7 chạy thật: đẩy ĐÚNG 2 lời gọi — SkuId + SellerSku đọc sống của từng SKU',
            that.ok && san.goi.slice().sort().join('|') === ['ton:101:3:5101:MOT', 'ton:102:0:5202:PB'].join('|') && that.data?.pushed === 2 && that.data?.failed === 0,
            JSON.stringify({ goi: san.goi, data: that.data }))
        ca('D8 sau khi đẩy: listing một SKU ghi 3; listing ba phân loại ghi TỔNG = PA 5 + PB 0 + PC 2 (số đọc) = 7; 2 mã bỏ qua không đụng',
            g.listing.find(l => l.id === 'o1')!.stock === 3 && g.listing.find(l => l.id === 'o2')!.stock === 7
            && g.listing.find(l => l.id === 'o3')!.stock === 6 && g.listing.find(l => l.id === 'o4')!.stock === 8, JSON.stringify(g.ghi))
        ca('D9 sổ đồng bộ có dòng push_stock kèm ghi chú đọc sàn', g.ghi.some(x => /^so:Pushed: 2, skipped: \d+, failed: 0.*đọc sàn:.*KHÔNG thấy trên Lazada/.test(x)), JSON.stringify(g.ghi.filter(x => x.startsWith('so:'))))
    }

    {
        const g = taoCuaHang(), san = sanGia({ hongDoc: true })
        const thu = await dayTonLenSan(g.pz, 'chL', { dryRun: true, giaLap: { dichVu: san.dichVu } })
        ca('D10 đọc Lazada hỏng ⇒ chạy thử: 0 mã sẽ đẩy, lỗi NGUYÊN VĂN trong ghi chú, không ghi gì',
            thu.ok && thu.data?.seDay === 0 && (thu.data?.docSan || []).some((x: string) => /Không đọc được danh mục Lazada \(Lazada products\/get \(offset 0\): \[E500\] Internal system error\) — không đẩy/.test(x))
            && san.goi.length === 0 && g.ghi.length === 0, JSON.stringify(thu.data))
        const that = await dayTonLenSan(g.pz, 'chL', { giaLap: { dichVu: san.dichVu } })
        ca('D11 đọc hỏng ⇒ chạy thật cũng KHÔNG gọi ghi sàn lần nào (không rơi về "cách cũ" đè số lưu)', that.ok && that.data?.pushed === 0 && san.goi.length === 0, JSON.stringify({ goi: san.goi, data: that.data }))
    }

    {
        // 6 mã một SKU đang có hàng trên sàn mà kho = 0 ⇒ cầu dao (≥ max(5, 15%)) chặn chạy thật
        const g = taoCuaHang()
        for (let i = 0; i < 6; i++) g.listing.push({ id: `z${i}`, channelId: 'chL', platformProductId: String(200 + i), sku: `Z${i}`, name: `Hết ${i}`, stock: 3, localProduct: { id: `pz${i}`, sku: `Z${i}`, stock: 0 } })
        const san = sanGia({ them: Array.from({ length: 6 }, (_, i) => ma(200 + i, `Hết ${i}`, [sku(6000 + i, `Z${i}`, 3)])) })
        const that = await dayTonLenSan(g.pz, 'chL', { giaLap: { dichVu: san.dichVu } })
        ca('D12 cầu dao chung vẫn chặn Lazada: 7 mã về 0 ⇒ 409, KHÔNG ghi sàn lần nào', that.http === 409 && san.goi.length === 0 && /CẦU DAO/.test(that.loi || ''), JSON.stringify({ http: that.http, loi: that.loi, goi: san.goi }))
        const vuot = await dayTonLenSan(g.pz, 'chL', { chapNhanVeKhong: true, veKhongDaXem: 7, giaLap: { dichVu: san.dichVu } })
        ca('D13 người bấm đã xem đúng 7 mã về 0 và tích xác nhận ⇒ đẩy (như Shopee / TikTok)', vuot.ok && san.goi.length === 8 && vuot.data?.veKhong === 7, JSON.stringify({ n: san.goi.length, data: vuot.data }))
    }

    console.log(`\n${dat}/${dat + hong} ca đạt`)
    if (hong) process.exit(1)
}
main().catch(e => { console.error(e); process.exit(1) })
