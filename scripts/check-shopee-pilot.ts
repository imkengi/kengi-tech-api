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
 */
import {
    khoBoNho, chuanHoaChinhSach, vuotBienDong, quyetDinhGia, dauNgayVN, xayTrangThai, luuCauHinh,
    taoKeHoachGia, taoKeHoachDang, taoKeHoachKhuyenMai, thucThi, chayChuKy, CHINH_SACH_MAC_DINH, type NgCanh,
} from '../src/lib/shopeePilot'
import { tinhGiaDeXuat } from '../src/lib/giaShopee'
import { ShopeeService } from '../src/services/platforms/shopee'
import { ToolError } from '../src/lib/mcpTypes'

let loi = 0
const dung = (ten: string, ok: boolean, chiTiet = '') => { if (!ok) loi++; console.log(`${ok ? '✓' : '✗'} ${ten}${chiTiet ? ' — ' + chiTiet : ''}`) }
const nem = async (f: () => Promise<any>) => { try { await f(); return null } catch (e: any) { return e } }

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
        dung('chu kỳ báo hàng chưa đăng (không tự đăng)', ck.results.some((r: any) => r.action === 'publish' && r.status === 'skipped'))
    } finally {
        ;(globalThis as any).fetch = fetchGoc
    }

    console.log(loi ? `\n❌ ${loi} kiểm tra hỏng` : '\n✅ Shopee Pilot trên Kengi: mọi kiểm tra đạt')
    process.exit(loi ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(1) })
