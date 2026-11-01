/* Kiểm chứng SHOPEE PILOT trên Kengi (31/10/2026) — npx tsx scripts/check-shopee-pilot.ts
 *
 * Kho kế hoạch trong bộ nhớ + prisma giả + Shopee giả (ghi lại mọi lời gọi ghi). Canh:
 *  1. Chính sách: kẹp số lạ, mục tiêu không dưới biên tối thiểu; biên độ đổi giá; quyết giá của chu kỳ.
 *  2. Trạng thái cho giao diện: listing + hàng chưa đăng, giá đề xuất / giá sàn đúng công thức.
 *  3. Kế hoạch → thực thi: chế độ Xem trước KHÔNG gọi Shopee; Tự động thì gọi đúng một lần,
 *     bấm hai lần không chạy đúp; khoá idempotency; giới hạn thao tác/ngày; dưới sàn / vượt biên độ bị chặn.
 *  4. Đăng hàng: lập kế hoạch soát đủ rào, thực thi gửi đúng giá kế hoạch; đứt mạng ⇒ 'uncertain'.
 *  5. Khuyến mãi: vượt mức giảm tối đa bị chặn, giá KM không dưới sàn, mã vừa tăng giá bị loại, Shopee từ chối một phần ⇒ 'partial'.
 *  6. Chu kỳ ở chế độ Xem trước chỉ lập kế hoạch.
 *  7. Hồ sơ đăng hàng (01/11): mã thắng nhóm; chu kỳ tự đăng ĐÚNG hàng có hồ sơ, trong trần mỗi chu kỳ; hàng chưa có hồ sơ được báo theo nhóm.
 *  8. Chạy theo lịch: chưa tới hẹn thì thôi; tới hẹn thì một bản giành được, chạy, ghi kết quả, hẹn lượt kế.
 *  9. Khuyến mãi hàng có phân loại: giá KM từng phân loại theo giá vốn của SKU phân loại đó, phân loại thiếu vốn bị để ngoài.
 * 10. Kiểm tra API: từng bước chỉ đọc, một bước hỏng không chặn các bước khác.
 * 11. Tiện ích theo cửa hàng (lib/tienIchCuaHang): chưa bật ⇒ chặn; đọc hỏng ⇒ chặn nhưng không bảo "chưa bật";
 *     duyệt nâng cấp giữ Shopee Pilot đang bật và không để yêu cầu tự bật nó.
 */
import {
    khoBoNho, chuanHoaChinhSach, vuotBienDong, quyetDinhGia, dauNgayVN, xayTrangThai, luuCauHinh,
    taoKeHoachGia, taoKeHoachDang, taoKeHoachKhuyenMai, thucThi, chayChuKy, CHINH_SACH_MAC_DINH, type NgCanh,
    chuanHoaHoSo, timHoSo, luuHoSo, xoaHoSo, chayTheoLich, kiemKetNoi,
} from '../src/lib/shopeePilot'
import { tinhGiaDeXuat } from '../src/lib/giaShopee'
import { ShopeeService } from '../src/services/platforms/shopee'
import { ToolError } from '../src/lib/mcpTypes'
import {
    docTienIch, giuTienIchQuanTri, lyDoChanPilot, datDemTienIch, TIEN_ICH_SHOPEE_PILOT, LOI_CHUA_BAT_PILOT,
} from '../src/lib/tienIchCuaHang'

let loi = 0
const dung = (ten: string, ok: boolean, chiTiet = '') => { if (!ok) loi++; console.log(`${ok ? '✓' : '✗'} ${ten}${chiTiet ? ' — ' + chiTiet : ''}`) }
const nem = async (f: () => Promise<any>) => { try { await f(); return null } catch (e: any) { return e } }

const bd2 = () => Math.floor(Date.now() / 1000) + 3600

async function main() {
    // ─── 1. Chính sách ───────────────────────────────────────────────────────────
    {
        const c = chuanHoaChinhSach({ targetMarginRate: 0.02, minMarginRate: 0.08, maxPriceChangeRate: 'abc', maxWritesPerDay: -5, automation: { reprice: false } })
        dung('mục tiêu không thấp hơn biên tối thiểu', c.targetMarginRate === 0.08 && c.minMarginRate === 0.08)
        dung('số lạ về mặc định, số âm bị kẹp', c.maxPriceChangeRate === CHINH_SACH_MAC_DINH.maxPriceChangeRate && c.maxWritesPerDay === 1)
        dung('bật/tắt bước giữ đúng, bước thiếu lấy mặc định', c.automation.reprice === false && c.automation.publishNewProducts === true)

        dung('đổi trong biên độ', vuotBienDong(100000, 109000, 0.1, 0) === null)
        dung('vượt biên độ bị chặn', !!vuotBienDong(100000, 115000, 0.1, 0))
        dung('đang dưới sàn được nâng thẳng lên giá sàn', vuotBienDong(100000, 130000, 0.1, 130000) === null && !!vuotBienDong(100000, 140000, 0.1, 130000))

        const pol = chuanHoaChinhSach({})
        const kq = tinhGiaDeXuat({ giaVon: 100000, phi: { tyLe: 0.14, coDinh: 3000 }, bienLoiNhuanPct: 15, bienToiThieuPct: 5, lamTron: 1000 })
        const duoiSan = quyetDinhGia({ giaCu: 100000, ton: 5, daBan14: 3, kq, bienHienTaiPct: -5, pol })
        dung('chu kỳ: dưới sàn ⇒ nâng thẳng lên giá sàn dù vượt biên độ', duoiSan?.gia === kq.giaSan, JSON.stringify(duoiSan))
        const duoiMucTieu = quyetDinhGia({ giaCu: 135000, ton: 5, daBan14: 3, kq, bienHienTaiPct: 8, pol })
        dung('chu kỳ: dưới mục tiêu ⇒ tăng về đề xuất (trong biên độ)', duoiMucTieu?.gia === kq.giaDeXuat && kq.giaDeXuat <= 135000 * 1.1, JSON.stringify(duoiMucTieu))
        const e = quyetDinhGia({ giaCu: 250000, ton: 9, daBan14: 0, kq, bienHienTaiPct: 45, pol })
        dung('chu kỳ: ế + lãi quá cao ⇒ giảm tối đa 10% mỗi lần', e?.gia === 225000, JSON.stringify(e))
        dung('chu kỳ: bán được, lãi ổn ⇒ giữ nguyên', quyetDinhGia({ giaCu: 160000, ton: 9, daBan14: 4, kq, bienHienTaiPct: 20, pol }) === null)

        const t = Date.UTC(2026, 9, 31, 20, 0)       // 03:00 sáng 01/11 giờ VN
        dung('0h hôm nay theo giờ VN', dauNgayVN(t) === Date.UTC(2026, 9, 31, 17, 0), new Date(dauNgayVN(t)).toISOString())
    }

    // ─── Dựng cửa hàng giả ───────────────────────────────────────────────────────
    const kenh = { id: 'ch1', name: 'Kengi AI Shop', platform: 'shopee', shopId: '777', accessToken: 'tok', apiKey: '1', apiSecret: 's', commissionRate: 6, tokenExpiresAt: new Date(Date.now() + 3600_000) }
    const hang: Record<string, any> = {
        OC4: { id: 'p1', sku: 'OC4', name: 'Ổ cắm điện 4 lỗ chống giật', description: 'Ổ cắm 4 lỗ, dây 3m, chịu tải 2500W.', productType: 'goods', costPrice: 100000, sellingPrice: 189000, stock: 12, mergedIntoId: null, bundleId: null, images: [{ url: 'https://storage.googleapis.com/kengi-tech-assets/anh-sp/x/1.jpg', isPrimary: true }] },
        BINH: { id: 'p2', sku: 'BINH', name: 'Bình giữ nhiệt 500ml', description: 'Bình inox 304', productType: 'goods', costPrice: 50000, sellingPrice: 129000, stock: 30, mergedIntoId: null, bundleId: null, images: [] },
        TUI: { id: 'p3', sku: 'TUI', name: 'Túi tote canvas', description: 'Túi vải canvas dày, quai dài 60cm, may viền chắc chắn.', productType: 'goods', costPrice: 45000, sellingPrice: 99000, stock: 60, mergedIntoId: null, bundleId: null, images: [{ url: 'https://storage.googleapis.com/kengi-tech-assets/anh-sp/x/2.jpg', isPrimary: true }] },
    }
    const listing: any[] = [
        { id: 'op1', channelId: 'ch1', platformProductId: '111', name: 'Ổ cắm điện 4 lỗ', sku: 'OC4', price: 120000, stock: 12, status: 'NORMAL', localProductId: 'p1', imageUrl: null },
        { id: 'op2', channelId: 'ch1', platformProductId: '222', name: 'Bình giữ nhiệt', sku: 'BINH', price: 160000, stock: 30, status: 'NORMAL', localProductId: 'p2', imageUrl: null },
    ]
    const donDoiSoat = Array.from({ length: 20 }, (_, i) => { const g = 60000 + i * 20000; return { giaBan: g, phi: 0.14 * g + 3000 } })
    const timHang = (where: any) => Object.values(hang).find(h => JSON.stringify(where).toLowerCase().includes(`"${h.sku.toLowerCase()}"`)) || null
    const prisma: any = {
        onlineChannel: { findMany: async () => [kenh], update: async () => kenh },
        product: {
            findFirst: async ({ where }: any) => timHang(where),
            findMany: async () => Object.values(hang).map(h => ({ ...h, category: { name: 'Điện' }, _count: { images: h.images.length }, images: h.images.slice(0, 1) })),
        },
        onlineProduct: {
            findMany: async ({ where }: any) => listing.filter(l => l.channelId === where.channelId && (!where.status || (typeof where.status === 'string' ? l.status === where.status : where.status.in.includes(l.status)))),
            findFirst: async ({ where }: any) => listing.find(l => l.channelId === where.channelId && (
                (where.platformProductId && l.platformProductId === where.platformProductId)
                || (where.sku && String(l.sku).toLowerCase() === String(where.sku.equals).toLowerCase())
                || (where.OR && where.OR.some((o: any) => (o.localProductId && o.localProductId === l.localProductId) || (o.sku && String(l.sku).toLowerCase() === String(o.sku.equals).toLowerCase()))))) || null,
            update: async ({ where, data }: any) => { const l = listing.find(x => x.id === where.id); Object.assign(l, data); return l },
            upsert: async (q: any) => { listing.push({ ...q.create, id: `op${listing.length + 1}` }); return q.create },
            count: async () => listing.length,
        },
        skuMapping: { findMany: async () => [], findFirst: async () => null },
        storeSettings: { findFirst: async () => null },
        category: { findMany: async () => [{ name: 'Điện' }, { name: 'Gia dụng' }] },
        $queryRawUnsafe: async (sql: string, ...v: any[]) => {
            if (sql.includes('"OnlineOrder" o') && sql.includes('platformFee')) return donDoiSoat
            if (sql.includes('FROM "Product"')) {
                const ids: string[] = v[0] || [], skus: string[] = v[1] || []
                return Object.values(hang).filter(h => ids.includes(h.id) || skus.includes(h.sku.toLowerCase()))
                    .map(h => ({ id: h.id, sku: h.sku, name: h.name, description: h.description, costPrice: h.costPrice, mergedIntoId: null, mergedRate: 1 }))
            }
            return []
        },
    }

    const goi: string[] = []
    let thanDang: any = null
    let addItemHong: 'mang' | null = null
    const P = ShopeeService.prototype as any
    P.getItemLimit = async () => ({ price_limit: { min_limit: 1000, max_limit: 1e8 }, item_name_length_limit: { min_limit: 5, max_limit: 120 }, item_description_length_limit: { min_limit: 10, max_limit: 3000 } })
    P.getLogisticsChannels = async () => [{ logistics_channel_id: 50021, logistics_channel_name: 'Nhanh', enabled: true, mask_channel_id: 0 }]
    P.uploadImage = async () => { goi.push('upload'); return { imageId: 'img-1' } }
    P.addItem = async (body: any) => { goi.push('add_item'); thanDang = body; if (addItemHong === 'mang') throw new Error('Gọi Shopee trực tiếp thất bại sau 1 lần (quá 30s): aborted'); return { itemId: '999' } }
    P.updatePrice = async (id: any, gia: number) => { goi.push(`update_price:${id}:${gia}`) }
    P.getItemPromotion = async () => []
    P.addDiscount = async (ten: string) => { goi.push(`add_discount:${ten}`); return 555 }
    P.addDiscountItems = async (_id: number, items: any[]) => { goi.push(`add_discount_item:${items.length}`); return { loi: items.length > 1 ? [{ itemId: items[1].item_id, lyDo: 'item_already_in_promotion' }] : [] } }
    P.deleteDiscount = async () => { goi.push('delete_discount') }
    let itemsKm: any[] = []
    const addDiscountItemsGoc = P.addDiscountItems
    P.getModelList = async () => [
        { model_id: 41, name: 'Đen', sku: 'OC6', price: 200000, giaHienTai: 200000, stock: 3 },
        { model_id: 42, name: 'Trắng', sku: 'OC6-TRANG', price: 210000, giaHienTai: 210000, stock: 2 },
    ]
    P.testConnection = async () => ({ success: true, shopName: 'Kengi AI Shop' })
    P.getCategories = async () => [{ id: 100, chaId: 0, ten: 'Thiết bị điện', coCon: true }, { id: 101, chaId: 100, ten: 'Ổ cắm', coCon: false }]
    P.categoryRecommend = async () => [101]
    P.getCategoryAttributes = async () => [{ attributeId: 7, ten: 'Chất liệu', batBuoc: true, kieuNhap: 'chon_mot', donVi: [], giaTri: [], soGiaTri: 0 }]
    P.getBrandList = async () => ({ batBuoc: false, thuongHieu: [], conNua: false })
    P.getDiscountList = async () => { throw new Error('Shopee get_discount_list: error_permission - no permission') }
    const fetchGoc = globalThis.fetch
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(1000)])
    ;(globalThis as any).fetch = async () => new Response(jpeg, { status: 200 })

    const kho = khoBoNho()
    const ctx: NgCanh = { prisma, kho, nguoi: 'chu@shop.vn' }
    const ghiShopee = () => goi.filter(g => !g.startsWith('upload')).length

    try {
        // ─── 2. Trạng thái ──────────────────────────────────────────────────────────
        const st = await xayTrangThai(ctx)
        const oc4 = st.products.find((p: any) => p.sku === 'OC4'), tui = st.products.find((p: any) => p.sku === 'TUI'), binh = st.products.find((p: any) => p.sku === 'BINH')
        dung('trạng thái: tự chọn gian duy nhất, mặc định Xem trước', st.status.shop?.id === 'ch1' && st.status.executionMode === 'preview' && st.status.mode === 'live')
        // phí 14% + 3.000đ, mục tiêu 15%: (100.000 + 3.000) / 0,71 = 145.070 → 146.000; sàn 5%: 103.000 / 0,81 → 127.200
        dung('trạng thái: giá đề xuất / sàn theo phí đo từ đơn', oc4?.pricing.price === 146000 && oc4?.pricing.floor === 127200 && oc4?.itemId === '111', JSON.stringify(oc4?.pricing))
        dung('trạng thái: hàng kho chưa đăng có mặt, đủ điều kiện', tui && tui.itemId === null && tui.enabled === true && tui.imageUrl)
        dung('trạng thái: BINH đã đăng nên không lặp làm ứng viên', st.products.filter((p: any) => p.sku === 'BINH').length === 1 && binh.itemId === '222')

        // ─── 3. Kế hoạch giá ────────────────────────────────────────────────────────
        const duoiSan = await nem(() => taoKeHoachGia(ctx, { sku: 'OC4', price: 125000, idempotencyKey: 'k0' }))
        dung('lập giá dưới sàn bị chặn', duoiSan instanceof ToolError && /GIÁ SÀN/.test(duoiSan.message), duoiSan?.message)
        const vuot = await nem(() => taoKeHoachGia(ctx, { sku: 'BINH', price: 120000 }))
        dung('lập giá vượt biên độ bị chặn', vuot instanceof ToolError && /biên độ/.test(vuot.message), vuot?.message)
        const kh = await taoKeHoachGia(ctx, { sku: 'OC4', price: 127200, idempotencyKey: 'k1' })
        const kh2 = await taoKeHoachGia(ctx, { sku: 'OC4', price: 127200, idempotencyKey: 'k1' })
        dung('kế hoạch nâng lên đúng giá sàn được nhận; cùng khoá ⇒ cùng kế hoạch', kh.status === 'draft' && kh.id === kh2.id && kho._keHoach.length === 1)

        const xemTruoc = await thucThi(ctx, kh.id)
        dung('Xem trước: thực thi KHÔNG gọi Shopee', xemTruoc.executed === false && ghiShopee() === 0)

        await luuCauHinh(ctx, { executionMode: 'auto' })
        const xong = await thucThi(ctx, kh.id)
        const lanHai = await thucThi(ctx, kh.id)
        dung('Tự động: đổi giá đúng một lần, bấm lại không chạy đúp', xong.status === 'succeeded' && goi.filter(g => g === 'update_price:111:127200').length === 1 && lanHai.status === 'succeeded' && ghiShopee() === 1, JSON.stringify(xong.result))
        dung('nhật ký ghi có dòng đổi giá', kho._nhatKy.some(w => w.action === 'price' && w.status === 'succeeded'))

        // ─── 4. Đăng hàng ───────────────────────────────────────────────────────────
        const khongCan = await nem(() => taoKeHoachDang(ctx, { sku: 'TUI', categoryId: 101, weightGram: 0 }))
        dung('đăng hàng thiếu cân nặng bị chặn', khongCan instanceof ToolError)
        const khDang = await taoKeHoachDang(ctx, { sku: 'TUI', categoryId: 101, weightGram: 350, attributes: [{ attribute_id: 7, value_id: 70 }], idempotencyKey: 'd1' })
        dung('kế hoạch đăng: chưa gọi Shopee ghi, giá theo đề xuất', khDang.data.payload.original_price === khDang.data.economics.suggested && !goi.includes('add_item'), JSON.stringify(khDang.data.economics))
        addItemHong = 'mang'
        const khongRo = await thucThi(ctx, khDang.id)
        dung('đứt mạng sau khi gửi add_item ⇒ "uncertain", không thử lại', khongRo.status === 'uncertain' && goi.filter(g => g === 'add_item').length === 1 && /KHÔNG RÕ/.test(khongRo.result?.message || ''), khongRo.result?.message)
        addItemHong = null
        const khDang2 = await taoKeHoachDang(ctx, { sku: 'TUI', categoryId: 101, weightGram: 350, idempotencyKey: 'd2' })
        const daDang = await thucThi(ctx, khDang2.id)
        dung('đăng thật: add_item gửi đúng giá kế hoạch + SKU kho', daDang.status === 'succeeded' && daDang.result?.item_id === '999' && thanDang?.original_price === khDang2.data.payload.original_price && thanDang?.item_sku === 'TUI')

        // ─── 5. Khuyến mãi ──────────────────────────────────────────────────────────
        const bd = Math.floor(Date.now() / 1000) + 3600
        const quaTay = await nem(() => taoKeHoachKhuyenMai(ctx, { name: 'Sale', skus: ['BINH'], discountRate: 0.5, startTime: bd, endTime: bd + 86400, purchaseLimit: 2 }))
        dung('giảm quá mức tối đa bị chặn', quaTay instanceof ToolError)
        const quaDai = await nem(() => taoKeHoachKhuyenMai(ctx, { name: 'Sale', skus: ['BINH'], discountRate: 0.1, startTime: bd, endTime: bd + 30 * 86400, purchaseLimit: 2 }))
        dung('chương trình dài quá chính sách bị chặn', quaDai instanceof ToolError)
        const km = await taoKeHoachKhuyenMai(ctx, { name: 'Sale cuối tuần', skus: ['BINH', 'OC4'], discountRate: 0.2, startTime: bd, endTime: bd + 86400, purchaseLimit: 2, idempotencyKey: 'c1' })
        const dongBinh = km.data.lines.find((l: any) => l.sku === 'BINH')
        dung('mã vừa TĂNG giá bị loại khỏi khuyến mãi', km.data.rejected.some((r: any) => r.sku === 'OC4' && /Vừa tăng giá/.test(r.reason)), JSON.stringify(km.data.rejected))
        dung('giá khuyến mãi = 160.000 × 0,8 và không dưới sàn', dongBinh?.price === 128000 && dongBinh.price >= dongBinh.floor, JSON.stringify(dongBinh))
        const kmXong = await thucThi(ctx, km.id)
        dung('thực thi khuyến mãi: tạo chương trình + thêm mã', kmXong.status === 'succeeded' && kmXong.result?.discount_id === 555 && goi.includes('add_discount:Sale cuối tuần'), JSON.stringify(kmXong.result))

        listing.push({ id: 'op9', channelId: 'ch1', platformProductId: '333', name: 'Ổ cắm 6 lỗ', sku: 'OC6', price: 200000, stock: 5, status: 'NORMAL', localProductId: 'p9', imageUrl: null })
        hang.OC6 = { id: 'p9', sku: 'OC6', name: 'Ổ cắm 6 lỗ', description: '', productType: 'goods', costPrice: 90000, sellingPrice: 200000, stock: 5, mergedIntoId: null, bundleId: null, images: [] }
        const km2 = await taoKeHoachKhuyenMai(ctx, { name: 'Sale 2', skus: ['BINH', 'OC6'], discountRate: 0.1, startTime: bd, endTime: bd + 86400, purchaseLimit: 1, idempotencyKey: 'c2' })
        const kmMotPhan = await thucThi(ctx, km2.id)
        dung('Shopee từ chối một phần ⇒ "partial" kèm lý do', kmMotPhan.status === 'partial' && /item_already_in_promotion/.test(kmMotPhan.result?.message || ''), kmMotPhan.result?.message)

        // ─── Giới hạn thao tác / ngày ───────────────────────────────────────────────
        const dem = kho._nhatKy.length
        await luuCauHinh(ctx, { policy: { maxWritesPerDay: dem } })
        const khGioiHan = await taoKeHoachGia(ctx, { sku: 'BINH', price: 150000, idempotencyKey: 'k9' })
        const truocGioiHan = ghiShopee()
        const chamTran = await nem(() => thucThi(ctx, khGioiHan.id))
        dung('chạm giới hạn thao tác/ngày ⇒ từ chối, không gọi Shopee', chamTran instanceof ToolError && /giới hạn/.test(chamTran.message) && ghiShopee() === truocGioiHan, chamTran?.message)

        // ─── 6. Chu kỳ ở chế độ Xem trước ───────────────────────────────────────────
        await luuCauHinh(ctx, { executionMode: 'preview', policy: { maxWritesPerDay: 50 } })
        listing.find(l => l.sku === 'OC4')!.price = 110000
        const truocChuKy = ghiShopee()
        const ck = await chayChuKy(ctx)
        const dongGia = ck.results.find((r: any) => r.action === 'price' && r.sku === 'OC4')
        dung('chu kỳ Xem trước: lập kế hoạch nâng giá, không gọi Shopee', dongGia?.status === 'draft' && ghiShopee() === truocChuKy, JSON.stringify(ck.results))
        dung('chu kỳ không tự đăng khi chưa có hồ sơ', ck.results.some((r: any) => r.action === 'publish') && !ck.results.some((r: any) => r.action === 'publish' && r.planId))
        // ─── 7. Hồ sơ đăng hàng + tự đăng trong chu kỳ ─────────────────────────────
        const thieuCan = await nem(async () => chuanHoaHoSo({ scope: 'nhom', key: 'Điện', categoryId: 101, weightGram: 0 }))
        dung('hồ sơ thiếu cân nặng bị chặn', thieuCan instanceof ToolError)
        const hs = chuanHoaHoSo({ scope: 'nhom', key: 'Điện', categoryId: 101, weightGram: 300, attributes: [{ attribute_id: 7, value_id: 70 }, { attribute_id: 8 }, { attribute_id: 9, gia_tri: '  ' }] })
        dung('hồ sơ bỏ thuộc tính rỗng', hs.attributes.length === 1 && hs.attributes[0]!.value_id === 70)
        const hsMa = chuanHoaHoSo({ scope: 'sku', key: 'tui', categoryId: 202, weightGram: 450 })
        dung('hồ sơ theo mã thắng hồ sơ theo nhóm (không phân biệt hoa thường)', timHoSo([hs, hsMa], 'TUI', 'Điện')?.categoryId === 202 && timHoSo([hs, hsMa], 'OC4', 'điện')?.categoryId === 101 && timHoSo([hs], 'X', 'Khác') === null)

        listing.splice(listing.findIndex(l => l.platformProductId === '999'), 1)    // gỡ TUI đã đăng ⇒ thành ứng viên lại
        hang.DEN = { id: 'p8', sku: 'DEN', name: 'Đèn LED để bàn', description: 'Đèn LED để bàn 3 chế độ sáng, cổng sạc USB-C.', productType: 'goods', costPrice: 120000, sellingPrice: 250000, stock: 4, mergedIntoId: null, bundleId: null, images: [{ url: 'https://storage.googleapis.com/kengi-tech-assets/anh-sp/x/8.jpg', isPrimary: true }] }
        await luuCauHinh(ctx, { executionMode: 'preview', policy: { maxPublishPerCycle: 1 } })
        const ck0 = await chayChuKy(ctx)
        dung('chu kỳ khi chưa có hồ sơ: không lập kế hoạch đăng, báo theo nhóm', !ck0.results.some((r: any) => r.action === 'publish' && r.planId) && ck0.results.some((r: any) => r.action === 'publish' && /CHƯA CÓ HỒ SƠ ĐĂNG/.test(r.message) && /Điện/.test(r.message)), JSON.stringify(ck0.results.filter((r: any) => r.action === 'publish')))
        await luuHoSo(ctx, { scope: 'nhom', key: 'Điện', categoryId: 101, categoryPath: 'Thiết bị điện > Ổ cắm', weightGram: 300, attributes: [{ attribute_id: 7, value_id: 70 }] })
        await luuHoSo(ctx, { scope: 'nhom', key: 'điện', categoryId: 101, weightGram: 320 })
        const cfgHs = (await kho.docCauHinh())!
        dung('lưu hồ sơ trùng nhóm thì thay, không nhân đôi', cfgHs.profiles.length === 1 && cfgHs.profiles[0]!.weightGram === 320)
        const ck1 = await chayChuKy(ctx)
        const dangCk = ck1.results.filter((r: any) => r.action === 'publish' && r.planId)
        dung('chu kỳ: lập kế hoạch đăng theo hồ sơ, đúng trần 1 mã / chu kỳ, không gọi add_item', dangCk.length === 1 && dangCk[0].status === 'draft' && ck1.results.some((r: any) => /mỗi chu kỳ đăng tối đa 1/.test(r.message || '')), JSON.stringify(ck1.results.filter((r: any) => r.action === 'publish')))
        const khCk = kho._keHoach.find(k => k.id === dangCk[0]?.planId)
        dung('kế hoạch tự đăng mang cân nặng + ngành của hồ sơ', khCk?.data?.payload?.weight === 0.32 && khCk?.data?.payload?.category_id === 101)
        const xoa = await xoaHoSo(ctx, cfgHs.profiles[0]!.id)
        dung('xoá hồ sơ', xoa.daXoa && (await kho.docCauHinh())!.profiles.length === 0)

        // ─── 8. Chạy theo lịch ──────────────────────────────────────────────────────
        await luuCauHinh(ctx, { schedule: { enabled: true, intervalMinutes: 60 } })
        const c1 = (await kho.docCauHinh())!
        dung('bật lịch ⇒ hẹn lượt kế sau đúng nhịp', c1.schedule.enabled && c1.nextRunAt !== null && Math.abs(c1.nextRunAt - Date.now() - 3600_000) < 5000)
        dung('chưa tới hẹn ⇒ không chạy', (await chayTheoLich(prisma, kho)) === 'chua-toi')
        await kho.luuCauHinh({ ...c1, nextRunAt: Date.now() - 1000 })
        const denHen = (await kho.docCauHinh())!.nextRunAt!
        const kqLich = await chayTheoLich(prisma, kho)
        const c2 = (await kho.docCauHinh())!
        dung('tới hẹn ⇒ chạy, ghi kết quả, hẹn lượt kế', kqLich === 'da-chay' && c2.lastRunAt !== null && c2.lastResult?.ok === true && c2.nextRunAt! > Date.now() + 3500_000, JSON.stringify({ kqLich, last: c2.lastResult?.ok }))
        dung('hai bản máy cùng giành một lượt ⇒ chỉ một bản được', (await kho.gianhLich(c2.nextRunAt!, 1)) === true && (await kho.gianhLich(c2.nextRunAt!, 2)) === false && denHen > 0)
        await luuCauHinh(ctx, { schedule: { enabled: false } })
        dung('tắt lịch ⇒ bỏ hẹn', (await kho.docCauHinh())!.nextRunAt === null && (await chayTheoLich(prisma, kho)) === 'khong-dung')

        // ─── 9. Khuyến mãi hàng có phân loại ────────────────────────────────────────
        listing.push({ id: 'opM', channelId: 'ch1', platformProductId: '444', name: 'Ổ cắm 6 lỗ (2 màu)', sku: 'OC6-MAU', price: 0, stock: 5, status: 'NORMAL', localProductId: null, imageUrl: null })
        await luuCauHinh(ctx, { executionMode: 'auto', policy: { maxWritesPerDay: 500 } })
        P.addDiscountItems = async (_id: number, items: any[]) => { itemsKm = items; return { loi: [] } }
        const kmPl = await taoKeHoachKhuyenMai(ctx, { name: 'Sale phân loại', skus: ['OC6-MAU'], discountRate: 0.1, startTime: bd2(), endTime: bd2() + 7200, purchaseLimit: 1, idempotencyKey: 'cm1' })
        const dongPl = kmPl.data.lines[0]
        dung('khuyến mãi phân loại: phân loại có vốn được giảm, phân loại thiếu vốn bị để ngoài', dongPl?.models?.length === 1 && dongPl.models[0].modelId === 41 && dongPl.models[0].price === 180000 && dongPl.skippedModels?.length === 1, JSON.stringify(dongPl))
        const kmPlXong = await thucThi(ctx, kmPl.id)
        dung('thực thi gửi model_list với giá từng phân loại', kmPlXong.status === 'succeeded' && itemsKm[0]?.model_list?.[0]?.model_id === 41 && itemsKm[0]?.model_list?.[0]?.model_promotion_price === 180000 && itemsKm[0]?.item_promotion_price === undefined, JSON.stringify(itemsKm))
        P.addDiscountItems = addDiscountItemsGoc

        // ─── 10. Kiểm tra API ───────────────────────────────────────────────────────
        const kt = await kiemKetNoi(ctx)
        const loiKm = kt.buoc.find((b: any) => /discount/.test(b.ten))
        dung('kiểm tra API: bước hỏng không chặn bước khác, không nạp ảnh khi không yêu cầu', kt.tong === 8 && kt.dat === 7 && loiKm?.ok === false && /permission/.test(loiKm.chiTiet) && !kt.buoc.some((b: any) => /upload_image/.test(b.ten)), JSON.stringify(kt.buoc.map((b: any) => [b.ten, b.ok])))
        const truocAnh = goi.filter(g => g === 'upload').length
        const kt2 = await kiemKetNoi(ctx, { thuNapAnh: true })
        dung('"thử nạp ảnh" nạp đúng một ảnh', kt2.tong === 9 && goi.filter(g => g === 'upload').length === truocAnh + 1)
    } finally {
        ;(globalThis as any).fetch = fetchGoc
    }

    // ─── 11. Tiện ích theo cửa hàng (01/11/2026): chỉ cửa hàng được quản trị bật mới dùng ──────────────────
    {
        dung('đọc addOns: chuỗi JSON / mảng / rỗng / hỏng / phần tử lạ',
            JSON.stringify(docTienIch('["online","shopee_pilot"]')) === '["online","shopee_pilot"]'
            && docTienIch('').length === 0 && docTienIch('hỏng').length === 0 && docTienIch(null).length === 0
            && JSON.stringify(docTienIch(['online', 1, null, 'shopee_pilot'])) === '["online","shopee_pilot"]')
        dung('duyệt nâng cấp GIỮ Shopee Pilot đang bật (yêu cầu ở Cài đặt không bao giờ có nó)',
            JSON.stringify(giuTienIchQuanTri('["online"]', '["accounting","shopee_pilot"]')) === '["online","shopee_pilot"]'
            && JSON.stringify(giuTienIchQuanTri('[]', '["shopee_pilot"]')) === '["shopee_pilot"]')
        dung('yêu cầu nâng cấp KHÔNG tự bật được Shopee Pilot (chỉ quản trị bật)',
            JSON.stringify(giuTienIchQuanTri('["online","shopee_pilot"]', '["online"]')) === '["online"]'
            && giuTienIchQuanTri(null, 'hỏng').length === 0)
        dung('tiện ích thường vẫn theo yêu cầu như cũ (không đổi hành vi online / accounting)',
            JSON.stringify(giuTienIchQuanTri('["accounting"]', '["online"]')) === '["accounting"]')

        datDemTienIch('CH-BAT', ['online', TIEN_ICH_SHOPEE_PILOT])
        datDemTienIch('CH-TAT', ['online', 'accounting'])
        const bat = await lyDoChanPilot('CH-BAT')
        const tat = await lyDoChanPilot('CH-TAT')
        const khongMa = await lyDoChanPilot(undefined)
        dung('cửa hàng được bật ⇒ cho qua', bat === null, JSON.stringify(bat))
        dung('chưa bật ⇒ chặn, mã chua_bat_tien_ich', tat?.ma === 'chua_bat_tien_ich' && tat.loi === LOI_CHUA_BAT_PILOT, JSON.stringify(tat))
        dung('không biết cửa hàng ⇒ chặn nhưng mã khong_kiem_duoc_tien_ich (không bảo là chưa bật)',
            khongMa?.ma === 'khong_kiem_duoc_tien_ich' && khongMa.loi !== LOI_CHUA_BAT_PILOT, JSON.stringify(khongMa))
    }

    console.log(loi ? `\n❌ ${loi} kiểm tra hỏng` : '\n✅ Shopee Pilot trên Kengi: mọi kiểm tra đạt')
    process.exit(loi ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(1) })
