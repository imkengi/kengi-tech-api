/* Kiểm chứng AI TỰ QUẢN GIAN SHOPEE (31/10/2026) — npx tsx scripts/check-shopee-ai.ts
 *
 * Canh:
 *  1. Tính giá (lib/giaShopee): công thức đúng, đo phí từ đơn (hồi quy tách được phí cố định),
 *     thiếu giá vốn là KHÔNG ra giá, giá dưới sàn bị chặn.
 *  2. Thân add_item (lib/shopeeTuQuan): gộp thuộc tính, No brand, kích thước, trạng thái ẩn.
 *  3. Chọn kênh vận chuyển, chặn link ảnh nội bộ, thứ tự ảnh.
 *  4. Tool đăng/đổi giá/ẩn nằm trong TOOL_NHAY_CAM (tác vụ tự động phải khai đích danh).
 *  5. Chạy thật shopee_create_listing trên prisma giả + Shopee giả: chạy thử không gọi Shopee ghi; lượt thật nạp ảnh,
 *     gửi đúng giá đề xuất + SKU kho, ghi OnlineProduct nối hàng kho; đăng trùng / dưới sàn / thiếu vốn bị từ chối;
 *     shopee_update_price chặn giá dưới sàn và không gọi Shopee.
 */
import { uocLuongPhi, tinhGiaDeXuat, chanGiaDuoiSan, danhGiaGia, SO_DON_TOI_THIEU } from '../src/lib/giaShopee'
import { dungThanAddItem, chonKenhVanChuyen, laDiaChiNoiBo, thuTuAnh } from '../src/lib/shopeeTuQuan'
import { SHOPEE_TOOLS, SHOPEE_TOOL_NHAY_CAM } from '../src/routes/mcpShopeeTools'
import { TOOLS } from '../src/routes/mcp'
import { TOOL_NHAY_CAM } from '../src/services/aiAgentRunner'
import { ShopeeService } from '../src/services/platforms/shopee'
import { ToolError } from '../src/lib/mcpTypes'

let loi = 0
const dung = (ten: string, ok: boolean, chiTiet = '') => { if (!ok) loi++; console.log(`${ok ? '✓' : '✗'} ${ten}${chiTiet ? ' — ' + chiTiet : ''}`) }
const gan = (a: number, b: number, sai = 0.002) => Math.abs(a - b) <= sai

async function main() {
    // ─── 1. Đo phí ───────────────────────────────────────────────────────────────
    {
        const it = uocLuongPhi([{ giaBan: 100000, phi: 20000 }], 6)
        dung('ít đơn ⇒ dùng tỷ lệ cấu hình kênh', it.nguon === 'cau-hinh-kenh' && gan(it.tyLe, 0.06) && it.coDinh === 0, JSON.stringify(it))

        // phí thật = 14% + 3.000đ/đơn, giá trải 50k–500k
        const dong = Array.from({ length: 40 }, (_, i) => { const g = 50000 + i * 11500; return { giaBan: g, phi: 0.14 * g + 3000 } })
        const hq = uocLuongPhi(dong, 6)
        dung('đủ đơn, giá trải rộng ⇒ hồi quy tách phí cố định', hq.nguon === 'hoi-quy-don' && gan(hq.tyLe, 0.14) && Math.abs(hq.coDinh - 3000) <= 1, JSON.stringify(hq))

        const deu = Array.from({ length: SO_DON_TOI_THIEU + 2 }, () => ({ giaBan: 200000, phi: 30000 }))
        const tl = uocLuongPhi(deu, 6)
        dung('giá đồng đều ⇒ tỷ lệ tổng phí / tổng giá', tl.nguon === 'ty-le-don' && gan(tl.tyLe, 0.15), JSON.stringify(tl))

        const rac = uocLuongPhi([...deu, { giaBan: 0, phi: 5 }, { giaBan: 100, phi: 500 }, { giaBan: NaN, phi: 1 }], 6)
        dung('bỏ dòng rác (giá 0, phí ≥ giá, NaN)', rac.soDon === deu.length, `soDon=${rac.soDon}`)
    }

    // ─── 2. Tính giá ─────────────────────────────────────────────────────────────
    {
        // vốn 100k, phí 15% + 3k, đóng gói 2k, biên 15% ⇒ P = 105.000 / 0,70 = 150.000
        const ts = { giaVon: 100000, phi: { tyLe: 0.15, coDinh: 3000 }, bienLoiNhuanPct: 15, bienToiThieuPct: 5, phiDongGoi: 2000, lamTron: 1000 }
        const kq = tinhGiaDeXuat(ts)
        dung('giá đề xuất đạt biên mục tiêu', kq.hopLe && kq.giaDeXuat === 150000 && kq.duKien?.loiNhuan === 22500 && kq.duKien?.bienPct === 15, JSON.stringify(kq.duKien))
        dung('giá hoà vốn = 105.000 / 0,85', kq.giaHoaVon === Math.ceil(105000 / 0.85), String(kq.giaHoaVon))
        dung('giá sàn (biên 5%) = 105.000 / 0,80 làm tròn 100', kq.giaSan === 131300, String(kq.giaSan))
        dung('hoà vốn thật sự lãi ≈ 0', Math.abs(danhGiaGia(kq.giaHoaVon, ts).loiNhuan) <= 1, JSON.stringify(danhGiaGia(kq.giaHoaVon, ts)))
        dung('chặn giá dưới sàn', !!chanGiaDuoiSan(131000, kq) && chanGiaDuoiSan(131300, kq) === null && chanGiaDuoiSan(200000, kq) === null)
        dung('chặn giá 0 / âm', !!chanGiaDuoiSan(0, kq) && !!chanGiaDuoiSan(-5, kq))

        const khongVon = tinhGiaDeXuat({ ...ts, giaVon: 0 })
        dung('thiếu giá vốn ⇒ không ra giá, mọi giá bị chặn', !khongVon.hopLe && khongVon.giaDeXuat === 0 && !!chanGiaDuoiSan(999999, khongVon), khongVon.lyDo)

        const quaTay = tinhGiaDeXuat({ ...ts, bienLoiNhuanPct: 70, phiQuangCaoPct: 20 })
        dung('biên + phí ≥ ~100% ⇒ không có giá', !quaTay.hopLe, quaTay.lyDo)

        const amBien = tinhGiaDeXuat({ ...ts, bienToiThieuPct: -20 })
        dung('biên tối thiểu âm bị kéo về 0 (không bao giờ dưới hoà vốn)', amBien.thamSo.bienToiThieuPct === 0 && amBien.giaSan >= amBien.giaHoaVon - 100, `san=${amBien.giaSan} hoaVon=${amBien.giaHoaVon}`)

        const tran = tinhGiaDeXuat({ ...ts, giaShopeeMax: 120000 })
        dung('vượt trần giá Shopee ⇒ không hợp lệ', !tran.hopLe)
        const day = tinhGiaDeXuat({ ...ts, giaShopeeMin: 200000 })
        dung('dưới mức tối thiểu Shopee ⇒ nâng lên + cảnh báo', day.hopLe && day.giaDeXuat === 200000 && day.canhBao.length === 1)
    }

    // ─── 3. Thân add_item ────────────────────────────────────────────────────────
    {
        const co = { ten: 'Ổ cắm điện 4 lỗ', moTa: 'Mô tả thật', gia: 150000, ton: 12.7, canNangKg: 0.3, categoryId: 101, sku: 'OC4', logisticIds: [5001], imageIds: ['a', 'b'] }
        const b = dungThanAddItem({
            ...co, an: false, brand: { id: 0, ten: '' }, kichThuocCm: { dai: 10.2, rong: 5, cao: 3 },
            thuocTinh: [{ attribute_id: 7, value_id: 70 }, { attribute_id: 7, value_id: 71 }, { attribute_id: 8, gia_tri: '220', don_vi: 'V' }, { attribute_id: 9, gia_tri: '  ' }, { attribute_id: 0, value_id: 1 }],
        })
        dung('thân cơ bản', b.item_sku === 'OC4' && b.original_price === 150000 && b.seller_stock[0].stock === 12 && b.item_status === 'NORMAL' && b.category_id === 101)
        dung('No brand mặc định', b.brand.brand_id === 0 && b.brand.original_brand_name === 'NoBrand')
        dung('gộp thuộc tính chọn nhiều + giá trị gõ tay, bỏ dòng rỗng/sai id',
            b.attribute_list.length === 2 && b.attribute_list[0].attribute_value_list.length === 2
            && b.attribute_list[1].attribute_value_list[0].original_value_name === '220' && b.attribute_list[1].attribute_value_list[0].value_unit === 'V', JSON.stringify(b.attribute_list))
        dung('kích thước làm tròn lên', b.dimension?.package_length === 11 && b.dimension.package_height === 3)
        dung('vận chuyển + ảnh', b.logistic_info[0].logistic_id === 5001 && b.logistic_info[0].enabled === true && b.image.image_id_list.length === 2)
        const b2 = dungThanAddItem({ ...co, an: true, brand: { id: 555, ten: '' }, kichThuocCm: { dai: 10, rong: 0, cao: 3 }, thuocTinh: [] })
        dung('ẩn sau khi đăng, brand thật không tên, thiếu 1 chiều thì bỏ kích thước, không có attribute_list rỗng',
            b2.item_status === 'UNLIST' && b2.brand.brand_id === 555 && !('original_brand_name' in b2.brand) && !b2.dimension && !b2.attribute_list)
    }

    // ─── 4. Vận chuyển, ảnh ──────────────────────────────────────────────────────
    {
        const ds = [
            { logistics_channel_id: 1, logistics_channel_name: 'Nhanh', enabled: true, mask_channel_id: 0, fee_type: 'SIZE_INPUT', weight_limit: { item_max_weight: 30 } },
            { logistics_channel_id: 2, logistics_channel_name: 'SPX con', enabled: true, mask_channel_id: 1 },
            { logistics_channel_id: 3, logistics_channel_name: 'Cồng kềnh', enabled: true, fee_type: 'SIZE_SELECTION' },
            { logistics_channel_id: 4, logistics_channel_name: 'Tắt', enabled: false },
            { logistics_channel_id: 5, logistics_channel_name: 'Hoả tốc', enabled: true, weight_limit: { item_max_weight: 2 } },
        ]
        const a = chonKenhVanChuyen(ds, 0.5)
        dung('chọn kênh bật, bỏ kênh con / chọn cỡ / tắt', JSON.stringify(a.ids) === '[1,5]', JSON.stringify(a))
        const b = chonKenhVanChuyen(ds, 5)
        dung('quá cân thì bỏ kênh', JSON.stringify(b.ids) === '[1]' && b.ghiChu.length === 1, JSON.stringify(b))
        const c = chonKenhVanChuyen(ds, 0.5, [5, 4, 99])
        dung('chỉ định: giữ kênh bật, báo kênh không có', JSON.stringify(c.ids) === '[5]' && c.ghiChu.length === 1, JSON.stringify(c))

        const noiBo = ['http://169.254.169.254/computeMetadata/v1/', 'http://localhost:8080/x.png', 'http://10.0.0.5/a.jpg', 'http://metadata.google.internal/', 'file:///etc/passwd', 'http://192.168.1.1/a.png', 'http://[::1]/a.png', 'không phải url']
        dung('chặn link ảnh nội bộ', noiBo.every(laDiaChiNoiBo), noiBo.filter(u => !laDiaChiNoiBo(u)).join(', '))
        dung('cho link ảnh công khai', !laDiaChiNoiBo('https://storage.googleapis.com/kengi-tech-assets/anh-sp/x/y.jpg') && !laDiaChiNoiBo('https://cf.shopee.vn/file/abc'))

        const anh = thuTuAnh([{ url: 'b' }, { url: 'a', isPrimary: true }, { url: 'b' }, ...Array.from({ length: 12 }, (_, i) => ({ url: `x${i}` }))])
        dung('ảnh chính lên đầu, bỏ trùng, tối đa 9', anh[0] === 'a' && anh[1] === 'b' && anh.length === 9 && new Set(anh).size === 9)
    }

    // ─── 5. Đăng ký tool ─────────────────────────────────────────────────────────
    {
        const ten = SHOPEE_TOOLS.map(t => t.name)
        dung('mọi tool shopee_* có trong TOOLS', ten.every(n => TOOLS.some(t => t.name === n)))
        dung('tool ghi ra Shopee nằm trong TOOL_NHAY_CAM và là tool ghi',
            SHOPEE_TOOL_NHAY_CAM.every(n => TOOL_NHAY_CAM.has(n) && SHOPEE_TOOLS.find(t => t.name === n)?.write === true))
        const docKhongGhi = ['shopee_shop_info', 'shopee_listing_candidates', 'shopee_suggest_price', 'shopee_category_suggest', 'shopee_category_attributes', 'shopee_review_listings']
        dung('tool tra cứu không đánh dấu ghi', docKhongGhi.every(n => SHOPEE_TOOLS.find(t => t.name === n)?.write !== true))
    }

    // ─── 6. Chạy tool trên prisma giả + Shopee giả ───────────────────────────────
    {
        const kenh = { id: 'ch1', name: 'Kengi AI Shop', platform: 'shopee', shopId: '777', accessToken: 'tok', apiKey: '1', apiSecret: 's', commissionRate: 6, tokenExpiresAt: new Date(Date.now() + 3600_000) }
        const hang: any = {
            id: 'p1', sku: 'OC4', name: 'Ổ cắm điện 4 lỗ chống giật', description: 'Ổ cắm 4 lỗ, dây 3m, chịu tải 2500W.', productType: 'goods',
            costPrice: 100000, sellingPrice: 189000, stock: 12, mergedIntoId: null, bundleId: null,
            images: [{ url: 'https://storage.googleapis.com/kengi-tech-assets/anh-sp/x/1.jpg', isPrimary: true }], category: { name: 'Điện' },
        }
        const listing: any[] = []
        const ghiListing: any[] = []
        // 20 đơn đã đối soát: phí 14% + 3.000đ
        const donDoiSoat = Array.from({ length: 20 }, (_, i) => { const g = 60000 + i * 20000; return { giaBan: g, phi: 0.14 * g + 3000 } })
        const prisma: any = {
            onlineChannel: { findMany: async () => [kenh], update: async () => kenh },
            product: { findFirst: async ({ where }: any) => (JSON.stringify(where).toLowerCase().includes('oc4') ? hang : null), findUnique: async () => hang },
            onlineProduct: {
                findFirst: async ({ where }: any) => listing.find(l => l.channelId === where.channelId && (
                    (where.platformProductId && l.platformProductId === where.platformProductId)
                    || (where.OR && where.OR.some((o: any) => (o.localProductId && o.localProductId === l.localProductId) || (o.sku && String(l.sku).toLowerCase() === String(o.sku.equals).toLowerCase())))
                    || (where.sku && String(l.sku).toLowerCase() === String(where.sku.equals).toLowerCase()))) || null,
                findMany: async () => listing,
                upsert: async (q: any) => { ghiListing.push(q); listing.push({ ...q.create, id: `op${listing.length + 1}` }); return q.create },
                update: async ({ where, data }: any) => { const l = listing.find(x => x.id === where.id); Object.assign(l, data); return l },
                count: async () => listing.length,
            },
            skuMapping: { findMany: async () => [], findFirst: async () => null },
            storeSettings: { findFirst: async () => null },   // không kho mẹ
            $queryRawUnsafe: async (sql: string) => {
                if (sql.includes('"OnlineOrder" o') && sql.includes('platformFee')) return donDoiSoat
                if (sql.includes('FROM "Product"')) return [{ id: 'p1', sku: 'OC4', name: hang.name, costPrice: hang.costPrice, mergedIntoId: null, mergedRate: 1 }]
                return []
            },
        }

        const goiShopee: string[] = []
        let thanGui: any = null
        const P = ShopeeService.prototype as any
        P.getItemLimit = async () => { goiShopee.push('limit'); return { price_limit: { min_limit: 1000, max_limit: 120000000 }, item_name_length_limit: { min_limit: 10, max_limit: 120 }, item_description_length_limit: { min_limit: 20, max_limit: 3000 } } }
        P.getLogisticsChannels = async () => { goiShopee.push('logistics'); return [{ logistics_channel_id: 50021, logistics_channel_name: 'Nhanh', enabled: true, mask_channel_id: 0 }] }
        P.uploadImage = async (buf: Buffer, kieu: string) => { goiShopee.push(`upload:${kieu}:${buf.length}`); return { imageId: 'img-1' } }
        P.addItem = async (body: any) => { goiShopee.push('add_item'); thanGui = body; return { itemId: '123456' } }
        P.updatePrice = async (id: any, gia: number) => { goiShopee.push(`update_price:${id}:${gia}`) }
        const fetchGoc = globalThis.fetch
        const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2000)])
        ;(globalThis as any).fetch = async (url: string) => {
            if (String(url).startsWith('https://storage.googleapis.com/')) return new Response(jpeg, { status: 200, headers: { 'content-type': 'image/jpeg' } })
            throw new Error(`fetch ngoài dự kiến: ${url}`)
        }
        const ctx: any = { prisma, scopes: 'read,write', storeCode: 'TEST' }
        const tool = (n: string) => SHOPEE_TOOLS.find(t => t.name === n)!
        const chay = async (n: string, a: any) => { try { return { kq: await tool(n).run(a, ctx) as any } } catch (e: any) { return { loi: e } } }

        try {
            const goiY = await chay('shopee_suggest_price', { sku: 'OC4', bien_loi_nhuan: 15, phi_dong_goi: 2000 })
            // (100.000 + 3.000 + 2.000) / (1 − 0,14 − 0,15) = 147.887 → 148.000
            dung('suggest_price dùng phí đo từ đơn', !goiY.loi && goiY.kq.mauPhi.nguon === 'hoi-quy-don' && goiY.kq.giaDeXuat === 148000, goiY.loi?.message || JSON.stringify({ g: goiY.kq?.giaDeXuat, p: goiY.kq?.mauPhi }))

            const thu = await chay('shopee_create_listing', { sku: 'OC4', category_id: 101, can_nang_gram: 400, bien_loi_nhuan: 15, phi_dong_goi: 2000, chay_thu: true })
            dung('chạy thử: trả thân yêu cầu, không nạp ảnh, không đăng', !thu.loi && thu.kq.thanYeuCau?.original_price === 148000 && !goiShopee.some(g => g.startsWith('upload') || g === 'add_item'), thu.loi?.message)

            const duoiSan = await chay('shopee_create_listing', { sku: 'OC4', category_id: 101, can_nang_gram: 400, gia: 110000 })
            dung('đăng giá dưới sàn bị từ chối', duoiSan.loi instanceof ToolError && /GIÁ SÀN/.test(duoiSan.loi.message) && !goiShopee.includes('add_item'), duoiSan.loi?.message)

            const khongCan = await chay('shopee_create_listing', { sku: 'OC4', category_id: 101, can_nang_gram: 0 })
            dung('thiếu cân nặng bị từ chối', khongCan.loi instanceof ToolError)

            const that = await chay('shopee_create_listing', { sku: 'OC4', category_id: 101, can_nang_gram: 400, bien_loi_nhuan: 15, phi_dong_goi: 2000, thuoc_tinh: [{ attribute_id: 7, value_id: 70 }] })
            dung('đăng thật: nạp ảnh rồi add_item với giá đề xuất + SKU kho', !that.loi && that.kq.itemId === '123456'
                && goiShopee.some(g => g.startsWith('upload:image/jpeg')) && thanGui?.original_price === 148000 && thanGui?.item_sku === 'OC4'
                && thanGui?.image?.image_id_list?.[0] === 'img-1' && thanGui?.seller_stock?.[0]?.stock === 12 && thanGui?.weight === 0.4
                && thanGui?.logistic_info?.[0]?.logistic_id === 50021, that.loi?.message || JSON.stringify(thanGui))
            dung('ghi OnlineProduct nối hàng kho', ghiListing.length === 1 && ghiListing[0].create.localProductId === 'p1' && ghiListing[0].create.platformProductId === '123456')

            const lan2 = await chay('shopee_create_listing', { sku: 'OC4', category_id: 101, can_nang_gram: 400 })
            dung('đăng lại cùng hàng ⇒ từ chối ĐÃ CÓ', lan2.loi instanceof ToolError && /ĐÃ CÓ/.test(lan2.loi.message), lan2.loi?.message)

            const truocDoi = goiShopee.length
            const doiLo = await chay('shopee_update_price', { item_id: '123456', gia_moi: 100000 })
            dung('đổi giá dưới sàn bị từ chối, không gọi Shopee', doiLo.loi instanceof ToolError && goiShopee.length === truocDoi, doiLo.loi?.message)
            const doiDuoc = await chay('shopee_update_price', { item_id: '123456', gia_moi: 159000 })
            dung('đổi giá hợp lệ', !doiDuoc.loi && goiShopee.includes('update_price:123456:159000') && doiDuoc.kq.sau.loiNhuan > 0, doiDuoc.loi?.message)

            listing[0].price = 110000
            const soat = await chay('shopee_review_listings', { bien_loi_nhuan: 15, phi_dong_goi: 2000 })
            dung('soát giá: listing dưới sàn bị gắn cờ kèm giá đề xuất', !soat.loi && soat.kq.duoiGiaSan === 1
                && soat.kq.sanPham[0]?.vanDe?.includes('DƯỚI GIÁ SÀN') && soat.kq.sanPham[0]?.giaDeXuat === 148000, soat.loi?.message || JSON.stringify(soat.kq?.sanPham))

            hang.costPrice = 0
            listing.length = 0
            const khongVon = await chay('shopee_create_listing', { sku: 'OC4', category_id: 101, can_nang_gram: 400, gia: 500000 })
            dung('thiếu giá vốn ⇒ không đăng kể cả khi truyền giá', khongVon.loi instanceof ToolError, khongVon.loi?.message)
        } finally {
            ;(globalThis as any).fetch = fetchGoc
        }
    }

    console.log(loi ? `\n❌ ${loi} kiểm tra hỏng` : '\n✅ AI tự quản gian Shopee: mọi kiểm tra đạt')
    process.exit(loi ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(1) })
