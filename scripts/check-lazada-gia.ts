/**
 * check-lazada-gia — đổi giá Lazada (14/11/2026, chủ shop duyệt "đổi giá Lazada" — bước 2 sau phí thật, trước Lazada Pilot).
 *
 *  A. LazadaService.updatePrice / xmlGiaMotSku: payload UpdatePriceQuantity MỘT SKU, CHỈ <Price> (không Quantity, không
 *     SalePrice), số nguyên VND, thoát ký tự; POST đúng API, tham số ký; thiếu mã / giá hỏng ⇒ KHÔNG gọi; lỗi nguyên văn.
 *  B. Lõi đẩy giá (lib/dayGiaLenSan) cho kênh Lazada trên prisma giả + sàn giả (giaLap): kế hoạch THEO SKU từ bản đọc sống,
 *     rào giá sàn từng SKU, SKU có special_price để yên, mã không thấy / SKU chưa nối kho nói ra, đọc hỏng ⇒ không ghi gì,
 *     chạy thử không gọi ghi sàn, chạy thật gọi đúng SkuId + SellerSku, chỉ SKU đại diện cập nhật giá lưu, chính sách của
 *     LAZADA PILOT (chưa lưu ⇒ mặc định; đọc hỏng ⇒ dừng; không mượn chính sách Shopee / TikTok Pilot), chưa biết phí ⇒ không ghi.
 *
 * Không gọi mạng, không đụng CSDL. Chạy: npm run check:lazada-gia
 */
import { LazadaService } from '../src/services/platforms/lazada'
import { dayGiaLenSan } from '../src/lib/dayGiaLenSan'
import { xoaDemPhiTheoNganh } from '../src/lib/shopeeTuQuan'

let dat = 0, hong = 0
function ca(ten: string, dung: boolean, them = '') { if (dung) dat++; else { hong++; console.log(`  ✗ ${ten}${them ? ` — ${them}` : ''}`) } }

// ─── Hình dữ liệu đo thật 13/11/2026 (GetProducts gian KENGISTORE, rút gọn) ─────────────────
const sku = (skuId: number, sellerSku: string, price: number, them: any = {}) => ({
    Status: 'active', quantity: 5, Available: 5, SellerSku: sellerSku, SkuId: skuId, ShopSku: `x_VNAMZ-${skuId}`, Images: [],
    saleProp: {}, multiWarehouseInventories: [], price, ...them,
})
const ma = (itemId: number, ten: string, skus: any[]) => ({
    item_id: itemId, primary_category: 12582, attributes: { name: ten }, status: 'Active', skus, images: [],
})

async function main() {
    // ─── A. updatePrice ──────────────────────────────────────────────────────────
    {
        const svc: any = new LazadaService({ apiKey: 'k', apiSecret: 's', accessToken: 't' } as any)
        const goi: { u: URL; body: any; phuongThuc: string }[] = []
        svc.httpPost = async (url: string, body: any) => { goi.push({ u: new URL(url), body, phuongThuc: 'POST' }); return { code: '0', data: {}, request_id: 'r' } }
        svc.httpGet = async (url: string) => { goi.push({ u: new URL(url), body: null, phuongThuc: 'GET' }); return { code: '0' } }
        await svc.updatePrice('3093519331', 935000.4, '14842255527', 'A&B<"x">\'')
        const g = goi[0]!
        const xml = g.u.searchParams.get('payload') || ''
        ca('A1 POST đúng API /product/price_quantity/update (tài liệu ghi POST), tham số ký trên URL (có sign), thân rỗng',
            goi.length === 1 && g.phuongThuc === 'POST' && g.u.pathname.endsWith('/product/price_quantity/update') && !!g.u.searchParams.get('sign')
            && JSON.stringify(g.body) === '{}', JSON.stringify({ n: goi.length, p: g?.u.pathname, m: g?.phuongThuc }))
        ca('A2 payload: ItemId + SkuId + SellerSku (đã thoát) + Price SỐ NGUYÊN — KHÔNG Quantity, KHÔNG SalePrice / ngày khuyến mãi',
            xml === '<Request><Product><Skus><Sku><ItemId>3093519331</ItemId><SkuId>14842255527</SkuId><SellerSku>A&amp;B&lt;&quot;x&quot;&gt;&apos;</SellerSku><Price>935000</Price></Sku></Skus></Product></Request>'
            && !/Quantity|SalePrice|SaleStartDate|SaleEndDate/.test(xml), xml)
        goi.length = 0
        await svc.updatePrice('1', 150000, undefined, 'M1')
        ca('A3 thiếu SkuId ⇒ bỏ thẻ SkuId (không gửi rỗng)', (goi[0]?.u.searchParams.get('payload') || '') === '<Request><Product><Skus><Sku><ItemId>1</ItemId><SellerSku>M1</SellerSku><Price>150000</Price></Sku></Skus></Product></Request>')
        goi.length = 0
        let loi = ''
        try { await svc.updatePrice('1', 150000, '', '  ') } catch (e: any) { loi = e.message }
        ca('A4 thiếu cả SkuId lẫn SellerSku ⇒ KHÔNG gọi sàn, báo rõ', goi.length === 0 && /thiếu cả SkuId lẫn SellerSku/.test(loi), loi)
        const loiGia: string[] = []
        for (const x of [0, -5, NaN, 0.4]) { try { await svc.updatePrice('1', x, '9', 'M1') } catch (e: any) { loiGia.push(e.message) } }
        ca('A5 giá 0 / âm / NaN / làm tròn ra 0 ⇒ ném, KHÔNG gọi sàn', goi.length === 0 && loiGia.length === 4 && loiGia.every(m => /giá không hợp lệ/.test(m)), JSON.stringify(loiGia))
        svc.httpPost = async () => ({ code: '501', message: 'E501: Update product failed', detail: [{ field: 'Price', message: 'BIZ_CHECK_SPECIAL_PRICE_RATE_OUT_OF_RANGE', seller_sku: 'M1' }] })
        loi = ''
        try { await svc.updatePrice('1', 150000, '9', 'M1') } catch (e: any) { loi = e.message }
        ca('A6 Lazada từ chối ⇒ ném NGUYÊN VĂN kèm detail từng SKU', /^Lazada price_quantity\/update: \[501\] E501: Update product failed — M1 Price BIZ_CHECK_SPECIAL_PRICE_RATE_OUT_OF_RANGE$/.test(loi), loi)
        svc.httpPost = async () => ({ code: 'IllegalAccessToken', message: 'The specified access token is invalid or expired' })
        loi = ''
        try { await svc.updatePrice('1', 150000, '9', 'M1') } catch (e: any) { loi = e.message }
        ca('A7 lỗi token ⇒ "Lazada từ chối kênh: …" (nguyên văn)', /^Lazada từ chối kênh: \[IllegalAccessToken\] The specified access token is invalid/.test(loi), loi)
        // đẩy tồn dùng chung bộ dựng lỗi — câu cũ giữ nguyên (bộ check-lazada-ton C5 canh chi tiết)
        svc.httpGet = async () => ({ code: '500', message: 'E0501: Update sellable quantity failed', detail: [{ field: 'SellableQuantity', message: 'x', seller_sku: 'M1' }] })
        loi = ''
        try { await svc.updateStock('1', 5, '9', 'M1') } catch (e: any) { loi = e.message }
        ca('A8 đẩy tồn vẫn ra câu cũ "Lazada sellable/update: …"', loi === 'Lazada sellable/update: [500] E0501: Update sellable quantity failed — M1 SellableQuantity x', loi)
    }

    // ─── B. Lõi đẩy giá cho kênh Lazada ──────────────────────────────────────────
    /*
     * Phí KHAI 25% (chưa đủ đơn đo) ⇒ giá sàn của hàng vốn 100.000đ, lãi tối thiểu 5% mặc định: 100.000 / (1 − 0,25 − 0,05)
     * = 142.857 ⇒ làm tròn lên 142.900đ.
     *   201 MOT  một SKU, sàn 180k (giá LƯU 200k đã cũ), kho 200k ⇒ ĐỔI 180k→200k (so giá đọc sống, không so giá lưu)
     *   202 PA/PB/PC ba SKU: PA = SKU lưu (đã nối pA 150k, sàn 150k ⇒ giữ nguyên), PB kho 120k < sàn 142.900 ⇒ DƯỚI GIÁ SÀN,
     *       PC không có mã kho ⇒ chưa nối
     *   203 KM   special 150k < price 250k (đang bật), kho 220k ⇒ để yên (khuyến mãi)
     *   204 KMT  special 300k ≥ price 250k (đang tắt), kho 280k ⇒ để yên (khuyến mãi đang tắt)
     *   205 DAXOA không có trên sàn ⇒ ghi chú "không thấy"
     *   206 HA/HB: HA = SKU lưu, sàn 200k, kho 160k ⇒ ĐỔI (HẠ); HB kho 300k mà giá vốn 0 ⇒ THIẾU GIÁ VỐN
     *   207 RA/RB: RA = SKU lưu giữ nguyên; RB (KHÔNG đại diện) sàn 170k → kho 180k ⇒ ĐỔI, không cập nhật giá lưu của listing
     *   208 LE   kho 199.999,7đ, sàn 200k ⇒ làm tròn = 200k ⇒ giữ nguyên
     */
    const kenh = (them: any = {}) => ({ id: 'chL', name: 'Kengi Store', platform: 'lazada', shopId: '', accessToken: 'tL', apiKey: 'k', apiSecret: 's', tokenExpiresAt: null, commissionRate: 25, ...them })
    const taoCuaHang = (o: { kenh?: any; chinhSach?: Record<string, any>; docChinhSach?: 'hong'; don?: any[] } = {}) => {
        xoaDemPhiTheoNganh()
        const ghi: string[] = []
        const hang = [
            { id: 'p1', sku: 'MOT', sellingPrice: 200000, costPrice: 100000 },
            { id: 'pA', sku: 'PA', sellingPrice: 150000, costPrice: 100000 },
            { id: 'pB', sku: 'PB', sellingPrice: 120000, costPrice: 100000 },
            { id: 'pK', sku: 'KM', sellingPrice: 220000, costPrice: 100000 },
            { id: 'pKT', sku: 'KMT', sellingPrice: 280000, costPrice: 100000 },
            { id: 'pX', sku: 'DAXOA', sellingPrice: 90000, costPrice: 50000 },
            { id: 'pHA', sku: 'HA', sellingPrice: 160000, costPrice: 100000 },
            { id: 'pHB', sku: 'HB', sellingPrice: 300000, costPrice: 0 },
            { id: 'pRA', sku: 'RA', sellingPrice: 170000, costPrice: 100000 },
            { id: 'pRB', sku: 'RB', sellingPrice: 180000, costPrice: 100000 },
            { id: 'pLE', sku: 'LE', sellingPrice: 199999.7, costPrice: 100000 },
        ]
        const lien = (id: string) => { const h = hang.find(x => x.id === id)!; return { id: h.id, sku: h.sku, sellingPrice: h.sellingPrice } }
        const listing = [
            { id: 'o1', channelId: 'chL', platformProductId: '201', sku: 'MOT', price: 200000, categoryId: '12582', localProductId: 'p1', localProduct: lien('p1') },
            { id: 'o2', channelId: 'chL', platformProductId: '202', sku: 'PA', price: 150000, categoryId: '12582', localProductId: 'pA', localProduct: lien('pA') },
            { id: 'o3', channelId: 'chL', platformProductId: '203', sku: 'KM', price: 150000, categoryId: '12582', localProductId: 'pK', localProduct: lien('pK') },
            { id: 'o4', channelId: 'chL', platformProductId: '204', sku: 'KMT', price: 250000, categoryId: '12582', localProductId: 'pKT', localProduct: lien('pKT') },
            { id: 'o5', channelId: 'chL', platformProductId: '205', sku: 'DAXOA', price: 90000, categoryId: '12582', localProductId: 'pX', localProduct: lien('pX') },
            { id: 'o6', channelId: 'chL', platformProductId: '206', sku: 'HA', price: 200000, categoryId: '12582', localProductId: 'pHA', localProduct: lien('pHA') },
            { id: 'o7', channelId: 'chL', platformProductId: '207', sku: 'RA', price: 170000, categoryId: '12582', localProductId: 'pRA', localProduct: lien('pRA') },
            { id: 'o8', channelId: 'chL', platformProductId: '208', sku: 'LE', price: 200000, categoryId: '12582', localProductId: 'pLE', localProduct: lien('pLE') },
        ]
        const pz: any = {
            onlineChannel: { findUnique: async ({ where }: any) => (where.id === 'chL' ? kenh(o.kenh) : null), update: async () => { ghi.push('kenh'); return {} } },
            onlineProduct: {
                findMany: async ({ where }: any) => listing.filter(l => l.channelId === where.channelId && (!where.id?.in || where.id.in.includes(l.id))),
                update: async ({ where, data }: any) => { ghi.push(`sp:${where.id}:${data.price}`); const l = listing.find(x => x.id === where.id); if (l) Object.assign(l, data); return l },
            },
            product: {
                // như Prisma thật: so khớp CHÍNH XÁC chữ hoa thường
                findFirst: async ({ where }: any) => { const h = hang.find(x => where?.sku != null && x.sku === where.sku); return h ? { id: h.id, sku: h.sku, sellingPrice: h.sellingPrice } : null },
            },
            syncLog: { create: async ({ data }: any) => { ghi.push(`so:${data.details}`); return data } },
            $queryRawUnsafe: async (sql: string, ...v: any[]) => {
                const bang = /"(ShopeePilotConfig|TikTokPilotConfig|LazadaPilotConfig)"/.exec(sql)?.[1]
                if (bang) {
                    ghi.push(`docChinhSach:${bang}`)
                    if (o.docChinhSach === 'hong') throw new Error('Connection terminated unexpectedly')
                    const pol = o.chinhSach?.[bang]
                    return pol ? [{ policy: JSON.stringify(pol) }] : []
                }
                if (sql.includes('AS nganh')) return []
                if (sql.includes('"OnlineOrder" o') && sql.includes('platformFee')) return o.don || []
                if (sql.includes('FROM "SkuMapping"')) return []
                if (sql.includes('FROM "Product"')) {
                    const ids: string[] = v[0] || [], skus: string[] = v[1] || []
                    return hang.filter(h => ids.includes(h.id) || skus.includes(h.sku.toLowerCase())).map(h => ({ ...h, name: h.sku, description: '', mergedIntoId: null, mergedRate: 1 }))
                }
                return []
            },
        }
        return { pz, ghi, listing }
    }
    const sanGia = (o: { hongDoc?: boolean; loiGhi?: Record<string, string> } = {}) => {
        const goi: string[] = [], doc: string[] = []
        return {
            goi, doc,
            dichVu: {
                credentials: {},
                docSanPhamTho: async () => {
                    doc.push('products/get')
                    if (o.hongDoc) throw new Error('Lazada products/get (offset 0): [E500] Internal system error')
                    return {
                        tong: 7, items: [
                            ma(201, 'Một SKU', [sku(5101, 'MOT', 180000)]),
                            ma(202, 'Ba phân loại', [sku(5201, 'PA', 150000), sku(5202, 'PB', 130000), sku(5203, 'PC', 110000)]),
                            ma(203, 'Khuyến mãi bật', [sku(5301, 'KM', 250000, { special_price: 150000 })]),
                            ma(204, 'Khuyến mãi tắt', [sku(5401, 'KMT', 250000, { special_price: 300000 })]),
                            ma(206, 'Hạ giá', [sku(5601, 'HA', 200000), sku(5602, 'HB', 250000)]),
                            ma(207, 'SKU phụ', [sku(5701, 'RA', 170000), sku(5702, 'RB', 170000)]),
                            ma(208, 'Giá lẻ', [sku(5801, 'LE', 200000)]),
                        ],
                    }
                },
                updatePrice: async (id: string, gia: number, skuId?: string, sellerSku?: string) => {
                    goi.push(`gia:${id}:${gia}:${skuId ?? '-'}:${sellerSku ?? '-'}`)
                    const l = o.loiGhi?.[String(sellerSku)]
                    if (l) throw new Error(l)
                },
                updateStock: async () => { goi.push('TON — không được gọi'); },
                refreshAccessToken: async () => { throw new Error('bộ kiểm không cho làm mới token') },
            },
        }
    }

    {
        const g = taoCuaHang(), san = sanGia()
        const thu = await dayGiaLenSan(g.pz, 'chL', { dryRun: true, giaLap: { dichVu: san.dichVu } })
        const d = thu.data || {}
        const vd = (s: string) => (d.viDuBoQua || []).find((x: any) => x.sku === s)
        ca('B1 chạy thử: đọc sàn MỘT lần, KHÔNG gọi ghi sàn, KHÔNG ghi CSDL', thu.ok && d.chayThu === true && san.doc.length === 1 && san.goi.length === 0
            && !g.ghi.some(x => /^(sp|so|kenh):/.test(x)), JSON.stringify({ doc: san.doc, goi: san.goi, ghi: g.ghi }))
        ca('B2 sẽ đổi ĐÚNG 3 SKU (MOT, HA, RB) — HẠ mạnh nhất lên đầu; giá cũ = giá khách đang trả ĐỌC SỐNG (MOT 180k, không phải giá lưu 200k)',
            d.seDay === 3 && (d.viDuDoi || []).map((x: any) => `${x.sku}:${x.giaCu}>${x.giaMoi}`).join() === 'HA:200000>160000,RB:170000>180000,MOT:180000>200000',
            JSON.stringify({ seDay: d.seDay, viDuDoi: d.viDuDoi }))
        ca('B3 rào giá sàn THEO SKU: PB 120k < GIÁ SÀN 142.900đ (phí khai 25%, lãi tối thiểu 5%); HB thiếu giá vốn',
            /thấp hơn GIÁ SÀN 142\.900đ \(biên tối thiểu 5%/.test(vd('PB')?.lyDo || '') && vd('PB')?.gia === 120000 && /CHƯA CÓ GIÁ VỐN/.test(vd('HB')?.lyDo || '')
            && d.demBoQua?.duoiSan === 1 && d.demBoQua?.thieuVon === 1 && d.boQuaDuoiSan === 2, JSON.stringify({ demBoQua: d.demBoQua, PB: vd('PB'), HB: vd('HB') }))
        ca('B4 SKU có special_price ⇒ để yên, nhóm khuyến mãi (KHÔNG tính vào "do giá sàn"): đang bật nói giá khách trả, đang tắt nói nguy cơ bật lại',
            d.demBoQua?.khuyenMai === 2 && /^Đang có giá khuyến mãi 150\.000đ \(giá gốc 250\.000đ\) — khách trả giá khuyến mãi/.test(vd('KM')?.lyDo || '')
            && /^Có giá khuyến mãi 300\.000đ đang tắt \(không thấp hơn giá gốc 250\.000đ\)/.test(vd('KMT')?.lyDo || '')
            && /Lazada Seller Center/.test(vd('KM')?.lyDo || ''), JSON.stringify({ KM: vd('KM'), KMT: vd('KMT') }))
        ca('B5 bỏ qua có LÝ DO: mã không thấy trên Lazada (DAXOA) + SKU chưa nối kho (PC) nằm trong docSan; seBoQua = 9 (PA, PB, PC, KM, KMT, DAXOA, HB, RA, LE)',
            d.seBoQua === 9 && (d.docSan || []).some((x: string) => /^1 mã có trong Kengi nhưng KHÔNG thấy trên Lazada lúc đọc .*DAXOA\.$/.test(x))
            && (d.docSan || []).some((x: string) => /^1 SKU chưa có giá bán lẻ để đẩy .*giữ nguyên: PC\.$/.test(x)), JSON.stringify({ seBoQua: d.seBoQua, docSan: d.docSan }))
        ca('B6 giá kho 199.999,7đ làm tròn = 200.000đ trên sàn ⇒ giữ nguyên (LE không vào kế hoạch)', !(d.viDuDoi || []).some((x: any) => x.sku === 'LE'))
        ca('B7 Lazada đọc chính sách LAZADA PILOT (chưa lưu ⇒ mặc định) — không đọc bảng Pilot Shopee / TikTok; câu chinhSach nói rõ khoản chưa tính; ghi chú chạy thử nói "chỉ ĐỌC danh mục Lazada"',
            g.ghi.filter(x => x.startsWith('docChinhSach:')).join() === 'docChinhSach:LazadaPilotConfig'
            && (d.chinhSach || '').startsWith('Giá sàn theo chính sách Lazada Pilot (Lazada Pilot → Sửa chính sách; chưa lưu thì mặc định): lãi tối thiểu 5%; chưa tính đóng gói / quảng cáo / affiliate / thuế GTGT. Chỉ đổi GIÁ GỐC từng SKU')
            && /chỉ ĐỌC danh mục Lazada/.test(d.ghiChu || '') && d.maKhuyenMai === undefined, JSON.stringify({ chinhSach: d.chinhSach, ghiChu: d.ghiChu, ghi: g.ghi }))

        const that = await dayGiaLenSan(g.pz, 'chL', { giaLap: { dichVu: san.dichVu } })
        const t = that.data || {}
        ca('B8 chạy thật: ĐÚNG 3 lời gọi đổi giá — SkuId + SellerSku đọc sống của từng SKU; không gọi đẩy tồn',
            that.ok && san.goi.slice().sort().join('|') === ['gia:201:200000:5101:MOT', 'gia:206:160000:5601:HA', 'gia:207:180000:5702:RB'].join('|')
            && t.pushed === 3 && t.failed === 0 && t.skipped === 9 && san.doc.length === 2, JSON.stringify({ goi: san.goi, t }))
        ca('B9 giá lưu chỉ cập nhật cho SKU ĐẠI DIỆN (o1 → 200k, o6 → 160k); RB là SKU phụ ⇒ o7 giữ 170k; mã bỏ qua không đụng',
            g.ghi.filter(x => x.startsWith('sp:')).sort().join() === 'sp:o1:200000,sp:o6:160000'
            && g.listing.find(l => l.id === 'o7')!.price === 170000 && g.listing.find(l => l.id === 'o3')!.price === 150000, JSON.stringify(g.ghi))
        ca('B10 sổ đồng bộ push_price: số đếm + "giá khuyến mãi Lazada: để yên 2 SKU" + ghi chú đọc sàn',
            g.ghi.some(x => /^so:Pushed: 3, skipped: 9, failed: 0 \| rào giá sàn bỏ qua 2 mã .* \| giá khuyến mãi Lazada: để yên 2 SKU \| đọc sàn: 1 mã có trong Kengi/.test(x)),
            JSON.stringify(g.ghi.filter(x => x.startsWith('so:'))))
    }

    {
        const g = taoCuaHang(), san = sanGia({ loiGhi: { RB: 'Lazada price_quantity/update: [501] E501: Update product failed — RB Price campaign locked' } })
        const that = await dayGiaLenSan(g.pz, 'chL', { giaLap: { dichVu: san.dichVu } })
        ca('B11 một SKU bị Lazada từ chối ⇒ failed 1, lỗi NGUYÊN VĂN mang SellerSku của SKU; hai SKU còn lại vẫn ghi',
            that.ok && that.data?.pushed === 2 && that.data?.failed === 1 && that.data?.errors?.[0] === 'RB: Lazada price_quantity/update: [501] E501: Update product failed — RB Price campaign locked'
            && g.ghi.some(x => /^so:Pushed: 2, skipped: 9, failed: 1/.test(x)), JSON.stringify(that.data))
    }

    {
        const g = taoCuaHang(), san = sanGia({ hongDoc: true })
        const thu = await dayGiaLenSan(g.pz, 'chL', { dryRun: true, giaLap: { dichVu: san.dichVu } })
        ca('B12 đọc Lazada hỏng ⇒ chạy thử 0 SKU sẽ đổi, lỗi NGUYÊN VĂN trong docSan, mọi listing tính là bỏ qua',
            thu.ok && thu.data?.seDay === 0 && thu.data?.seBoQua === 8
            && (thu.data?.docSan || []).some((x: string) => /^Không đọc được danh mục Lazada \(Lazada products\/get \(offset 0\): \[E500\] Internal system error\) — không đổi giá/.test(x)),
            JSON.stringify(thu.data))
        const that = await dayGiaLenSan(g.pz, 'chL', { giaLap: { dichVu: san.dichVu } })
        ca('B13 đọc hỏng ⇒ chạy thật cũng KHÔNG gọi ghi sàn lần nào (không rơi về giá lưu)', that.ok && that.data?.pushed === 0 && san.goi.length === 0
            && !g.ghi.some(x => x.startsWith('sp:')), JSON.stringify({ goi: san.goi, data: that.data }))
    }

    {
        // chính sách Shopee / TikTok Pilot đã lưu chặt hơn nhiều (lãi tối thiểu 40% ⇒ sàn 285.800đ) mà Lazada KHÔNG mượn: MOT 200k vẫn đổi
        const g = taoCuaHang({ chinhSach: { ShopeePilotConfig: { minMarginRate: 0.4 }, TikTokPilotConfig: { minMarginRate: 0.4 } } }), san = sanGia()
        const thu = await dayGiaLenSan(g.pz, 'chL', { dryRun: true, giaLap: { dichVu: san.dichVu } })
        ca('B14 không mượn chính sách Pilot sàn khác: Shopee / TikTok Pilot lưu 40% vẫn ra 3 SKU sẽ đổi; chỉ đọc bảng Lazada Pilot',
            thu.ok && thu.data?.seDay === 3 && g.ghi.filter(x => x.startsWith('docChinhSach:')).join() === 'docChinhSach:LazadaPilotConfig',
            JSON.stringify({ a: thu.data?.seDay, ghi: g.ghi }))
        // Lazada Pilot lưu lãi tối thiểu 20% (phí khai 25%) ⇒ sàn ≈ 100k / 0,55 ≈ 181.900đ: HA 160k và RB 180k bị chặn, chỉ MOT 200k đổi
        const g3 = taoCuaHang({ chinhSach: { LazadaPilotConfig: { targetMarginRate: 0.3, minMarginRate: 0.2 } } })
        const thu3 = await dayGiaLenSan(g3.pz, 'chL', { dryRun: true, giaLap: { dichVu: sanGia().dichVu } })
        ca('B14b dùng ĐÚNG chính sách Lazada Pilot đã lưu: lãi tối thiểu 20% ⇒ chỉ MOT còn đổi; câu chinhSach nói 20%',
            thu3.ok && thu3.data?.seDay === 1 && (thu3.data?.viDuDoi || []).map((x: any) => x.sku).join() === 'MOT'
            && /lãi tối thiểu 20%/.test(thu3.data?.chinhSach || ''), JSON.stringify({ seDay: thu3.data?.seDay, viDuDoi: thu3.data?.viDuDoi, chinhSach: thu3.data?.chinhSach }))
        // bảng Lazada Pilot đọc HỎNG ⇒ dừng (503), không đọc sàn, không ghi gì: rơi về mặc định có thể LỎNG hơn biên chủ shop đặt
        const g2 = taoCuaHang({ docChinhSach: 'hong' }), san2 = sanGia()
        const thu2 = await dayGiaLenSan(g2.pz, 'chL', { dryRun: true, giaLap: { dichVu: san2.dichVu } })
        ca('B14c chính sách Lazada Pilot đọc HỎNG ⇒ 503, không đọc / ghi sàn (rào an toàn không mở khi hỏng)',
            !thu2.ok && thu2.http === 503 && san2.doc.length === 0 && san2.goi.length === 0, JSON.stringify({ http2: thu2.http, loi: thu2.loi, doc: san2.doc }))
    }

    {
        // ô phí còn 6% mặc định, chưa đơn nào đối soát ⇒ CHƯA BIẾT PHÍ ⇒ không SKU nào đổi được
        const g = taoCuaHang({ kenh: { commissionRate: 6 } }), san = sanGia()
        const thu = await dayGiaLenSan(g.pz, 'chL', { dryRun: true, giaLap: { dichVu: san.dichVu } })
        const that = await dayGiaLenSan(g.pz, 'chL', { giaLap: { dichVu: san.dichVu } })
        ca('B15 chưa biết phí ⇒ 0 SKU đổi, câu chuaBietPhi kèm đường khai «Phí sàn (%)», 0 lời gọi ghi sàn',
            thu.ok && thu.data?.seDay === 0 && thu.data?.demBoQua?.chuaBietPhi >= 4 && /Chưa biết phí sàn của gian "Kengi Store"/.test(thu.data?.chuaBietPhi || '')
            && /«Phí sàn \(%\)»/.test(thu.data?.chuaBietPhi || '') && that.data?.pushed === 0 && san.goi.length === 0, JSON.stringify(thu.data))
    }

    {
        // 10 đơn Lazada đã đối soát: phí 26,4% (đo thật 14/11: 26,41%) ⇒ phí ĐO thay phí khai
        const don = Array.from({ length: 10 }, (_, i) => ({ giaBan: 200000 + i * 10000, phi: Math.round((200000 + i * 10000) * 0.264), aff: null }))
        const g = taoCuaHang({ kenh: { commissionRate: 6 }, don }), san = sanGia()
        const thu = await dayGiaLenSan(g.pz, 'chL', { dryRun: true, giaLap: { dichVu: san.dichVu } })
        const vd = (s: string) => (thu.data?.viDuBoQua || []).find((x: any) => x.sku === s)
        ca('B16 gian đủ đơn đối soát (≥ 8) ⇒ phí ĐO 26,4% làm giá sàn (100.000 / 0,686 ⇒ 145.800đ): PB bị chặn, MOT/HA/RB vẫn đổi, không còn "chưa biết phí"',
            thu.ok && thu.data?.seDay === 3 && !thu.data?.chuaBietPhi && /GIÁ SÀN 145\.800đ/.test(vd('PB')?.lyDo || ''), JSON.stringify({ seDay: thu.data?.seDay, PB: vd('PB'), cbp: thu.data?.chuaBietPhi }))
    }

    {
        const g = taoCuaHang(), san = sanGia()
        const thu = await dayGiaLenSan(g.pz, 'chL', { dryRun: true, force: true, giaLap: { dichVu: san.dichVu } })
        const ds = (thu.data?.viDuDoi || []).map((x: any) => x.sku).sort().join()
        ca('B17 force chỉ bỏ bước "giá đã bằng" (PA, RA, LE vào kế hoạch) — KHÔNG vượt rào giá sàn (PB, HB) và KHÔNG đụng SKU khuyến mãi (KM, KMT)',
            thu.ok && ds === 'HA,LE,MOT,PA,RA,RB' && thu.data?.demBoQua?.khuyenMai === 2 && thu.data?.boQuaDuoiSan === 2, JSON.stringify({ ds, dem: thu.data?.demBoQua }))
    }

    {
        const g = taoCuaHang(), san = sanGia()
        const thu = await dayGiaLenSan(g.pz, 'chL', { dryRun: true, onlineProductIds: ['o2'], giaLap: { dichVu: san.dichVu } })
        ca('B18 chọn một listing (o2: PA/PB/PC) ⇒ chỉ SKU của listing đó: 0 đổi, PB dưới sàn, PC chưa nối, PA giữ nguyên',
            thu.ok && thu.data?.seDay === 0 && thu.data?.seBoQua === 3 && thu.data?.demBoQua?.duoiSan === 1
            && (thu.data?.docSan || []).length === 1 && /PC\.$/.test(thu.data?.docSan?.[0] || ''), JSON.stringify(thu.data))
    }

    console.log(`\n${dat}/${dat + hong} ca đạt`)
    if (hong) process.exit(1)
}
main().catch(e => { console.error(e); process.exit(1) })
