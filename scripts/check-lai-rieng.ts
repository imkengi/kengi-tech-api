/* Kiểm chứng LÃI RIÊNG THEO NHÓM HÀNG / MÃ HÀNG của Shopee Pilot + ẢNH CẦN CHỤP (12/11/2026) — npx tsx scripts/check-lai-rieng.ts
 *
 * Chủ shop: "shopee có thể mình điều chỉnh lợi nhuận theo từng nhóm hàng hoặc mã hàng không" + "khi đăng sản phẩm thì cần làm
 * hình ảnh gì đề xuất cho con người làm". Canh:
 *  A. lib/laiRiengPilot: chuẩn hoá (sai thì nói rõ, không kẹp lặng lẽ), mã thắng nhóm, nhóm gần thắng nhóm cha, không phân biệt
 *     hoa thường, chính sách không quy tắc (TikTok) giữ nguyên.
 *  B. Shopee Pilot trên cửa hàng giả: giá sàn / đề xuất từng dòng theo quy tắc; lập giá dưới sàn RIÊNG bị chặn dù trên sàn chung;
 *     khuyến mãi nâng lên sàn riêng; form chính sách chung KHÔNG đè được danh sách quy tắc; thêm / sửa / xoá quy tắc ghi sổ
 *     "Đổi cấu hình" đúng một dòng; sàn riêng thấp hơn sàn chung thì cảnh báo.
 *  C. lib/goiYAnhSanPham: nhận ngành đúng từ (giày ≠ giấy, đầm ≠ đậm, áo gối không phải áo), ảnh bắt buộc trước, không trùng,
 *     mức thiếu theo số ảnh.
 *  D. Soát nguồn: mọi chỗ tính giá / giá sàn cho MỘT mặt hàng đi qua polCua — quên một chỗ là chỗ đó hạ dưới sàn riêng.
 */
import fs from 'fs'
import path from 'path'
import {
    chuanHoaLaiRieng, chuanHoaDsLaiRieng, laiRiengCho, polCua, khoaListing, khoaPhanLoai, khoaHangKho, nhomChaTuDong, docDsLaiRieng,
} from '../src/lib/laiRiengPilot'
import {
    khoBoNho, chuanHoaChinhSach, xayTrangThai, luuCauHinh, luuLaiRieng, xoaLaiRieng, taoKeHoachGia, taoKeHoachKhuyenMai, tuyChonDang,
    goiYAnhChoSku, thamSoTinh, CHINH_SACH_MAC_DINH, type NgCanh,
} from '../src/lib/shopeePilot'
import { goiYAnh, tomTatAnh, nhanNganhAnh, TOI_DA_ANH } from '../src/lib/goiYAnhSanPham'
import { tinhGiaDeXuat } from '../src/lib/giaShopee'
import { docMauPhiTheoNganh } from '../src/lib/shopeeTuQuan'
import { ShopeeService } from '../src/services/platforms/shopee'
import { ToolError } from '../src/lib/mcpTypes'

let loi = 0, dat = 0
const dung = (ten: string, ok: boolean, chiTiet = '') => { if (ok) dat++; else loi++; console.log(`${ok ? '✓' : '✗'} ${ten}${chiTiet && !ok ? ' — ' + chiTiet : ''}`) }
const nem = async (f: () => any) => { try { await f(); return null } catch (e: any) { return e } }

async function main() {
    // ─── A. Thư viện quy tắc ────────────────────────────────────────────────────
    {
        const r = chuanHoaLaiRieng({ scope: 'nhom', key: '  Máy khoan ', targetMarginRate: 0.25, minMarginRate: '0.1' })
        dung('A1 chuẩn hoá: bỏ khoảng trắng, nhận số dạng chuỗi', r.key === 'Máy khoan' && r.minMarginRate === 0.1 && r.targetMarginRate === 0.25)
        const e1 = await nem(() => chuanHoaLaiRieng({ scope: 'nhom', key: 'X', targetMarginRate: 0.1, minMarginRate: 0.2 }))
        dung('A2 mục tiêu < sàn ⇒ báo lỗi rõ (không kẹp lặng lẽ)', e1 instanceof ToolError && /lớn hơn hoặc bằng/.test(e1.message), e1?.message)
        const e2 = await nem(() => chuanHoaLaiRieng({ scope: 'nhom', key: 'X', targetMarginRate: 0.3, minMarginRate: '' }))
        dung('A3 ô sàn để trống ⇒ lỗi (chuỗi rỗng KHÔNG thành 0%)', e2 instanceof ToolError && /Biên tối thiểu/.test(e2.message), e2?.message)
        const e3 = await nem(() => chuanHoaLaiRieng({ scope: 'nhom', key: 'X', targetMarginRate: 0.95, minMarginRate: 0.1 }))
        dung('A4 biên quá 80% ⇒ lỗi', e3 instanceof ToolError, e3?.message)
        const e4 = await nem(() => chuanHoaLaiRieng({ scope: 'abc', key: 'X', targetMarginRate: 0.3, minMarginRate: 0.1 }))
        const e5 = await nem(() => chuanHoaLaiRieng({ scope: 'sku', key: '   ', targetMarginRate: 0.3, minMarginRate: 0.1 }))
        dung('A5 phạm vi lạ / khoá trống ⇒ lỗi', e4 instanceof ToolError && e5 instanceof ToolError && /mã hàng/.test(e5.message))

        const ds = chuanHoaDsLaiRieng([
            { scope: 'nhom', key: 'Dụng cụ điện', targetMarginRate: 0.2, minMarginRate: 0.08 },
            { scope: 'nhom', key: 'Máy khoan', targetMarginRate: 0.3, minMarginRate: 0.15 },
            { scope: 'sku', key: 'MK-01', targetMarginRate: 0.4, minMarginRate: 0.25 },
            { scope: 'nhom', key: 'máy KHOAN', targetMarginRate: 0.35, minMarginRate: 0.18 },   // trùng (khác hoa thường) ⇒ dòng sau thắng
            { scope: 'nhom', key: 'Hỏng', targetMarginRate: 0.1, minMarginRate: 0.5 },          // hỏng ⇒ bỏ
            null, 'rác',
        ])
        dung('A6 danh sách: dòng hỏng bỏ, trùng khoá dòng sau thắng', ds.length === 3 && ds.find(x => x.key === 'máy KHOAN')?.minMarginRate === 0.18 && !ds.some(x => x.key === 'Máy khoan'), JSON.stringify(ds))
        dung('A7 mã thắng nhóm', laiRiengCho(ds, { skus: ['mk-01'], nhom: 'Máy khoan' })?.scope === 'sku')
        dung('A8 nhóm gần thắng nhóm cha', laiRiengCho(ds, { skus: ['KHAC'], nhom: 'Máy khoan', nhomCha: ['Dụng cụ điện'] })?.key === 'máy KHOAN')
        dung('A9 nhóm con không có quy tắc ⇒ theo nhóm cha', laiRiengCho(ds, { skus: ['KHAC'], nhom: 'Máy mài', nhomCha: ['Dụng cụ điện'] })?.key === 'Dụng cụ điện')
        dung('A10 không khớp ⇒ null (mức chung)', laiRiengCho(ds, { skus: ['KHAC'], nhom: 'Gia dụng', nhomCha: [null, undefined] }) === null)
        dung('A11 SKU thứ hai trong danh sách (SKU kho) cũng khớp', laiRiengCho(ds, { skus: [null, 'MK-01'], nhom: null })?.scope === 'sku')

        const pol = chuanHoaChinhSach({ marginRules: ds })
        const p1 = polCua(pol, { skus: ['MK-01'] })
        dung('A12 polCua: thay đúng HAI biên, giữ mọi rào khác, gắn laiRieng', p1.targetMarginRate === 0.4 && p1.minMarginRate === 0.25 && p1.maxPriceChangeRate === pol.maxPriceChangeRate && p1.priceStep === pol.priceStep && p1.laiRieng?.key === 'MK-01')
        const khongQuyTac = { ...CHINH_SACH_MAC_DINH }
        dung('A13 chính sách không quy tắc (TikTok) ⇒ trả nguyên', polCua(khongQuyTac, { skus: ['MK-01'], nhom: 'Máy khoan' }) === khongQuyTac)
        dung('A14 chính sách chưa khai quy tắc giữ đúng hình cũ (không có trường marginRules)', !('marginRules' in chuanHoaChinhSach({})))
        dung('A15 chuanHoaChinhSach giữ danh sách quy tắc', chuanHoaChinhSach(JSON.parse(JSON.stringify(pol))).marginRules?.length === 3)

        const kl = khoaListing({ sku: 'SAN-1' }, { sku: 'KHO-1', nhomHang: 'Máy khoan', nhomCha: ['Dụng cụ điện'] })
        dung('A16 khoá listing: SKU sàn → SKU kho, nhóm + cha', JSON.stringify(kl) === JSON.stringify({ skus: ['SAN-1', 'KHO-1'], nhom: 'Máy khoan', nhomCha: ['Dụng cụ điện'] }), JSON.stringify(kl))
        const kp = khoaPhanLoai('MD-1', { sku: 'KHO-MD', nhomHang: null }, { sku: 'SAN-1' }, { sku: 'KHO-1', nhomHang: 'Máy khoan', nhomCha: [] })
        dung('A17 khoá phân loại: phân loại không nhóm ⇒ theo nhóm của listing', kp.skus?.join() === 'MD-1,KHO-MD,SAN-1,KHO-1' && kp.nhom === 'Máy khoan', JSON.stringify(kp))
        const kh = khoaHangKho({ sku: 'A', category: { name: 'Máy khoan', parent: { name: 'Dụng cụ điện', parent: { name: 'Hàng kim khí' } } } }, 'a-gui')
        dung('A18 khoá hàng kho: hai cấp cha', kh.nhomCha?.join() === 'Dụng cụ điện,Hàng kim khí' && kh.skus?.join() === 'A,a-gui')
        dung('A19 nhóm cha từ dòng SQL thô', nhomChaTuDong({ nhomCha1: 'Cha', nhomCha2: '  ' }).join() === 'Cha')
        dung('A20 câu sổ "Đổi cấu hình"', docDsLaiRieng([]) === 'không có' && /mã «MK-01»: lãi 40%, sàn 25%/.test(docDsLaiRieng(ds)), docDsLaiRieng(ds))
    }

    // ─── B. Shopee Pilot trên cửa hàng giả ──────────────────────────────────────
    const kenh = { id: 'ch1', name: 'Gian thử', platform: 'shopee', shopId: '777', accessToken: 'tok', apiKey: '1', apiSecret: 's', commissionRate: 6, tokenExpiresAt: new Date(Date.now() + 3600_000) }
    const nhom: Record<string, { name: string; parent?: string }> = {
        c1: { name: 'Ổ cắm', parent: 'c0' }, c0: { name: 'Thiết bị điện' }, c2: { name: 'Bình giữ nhiệt', parent: 'c3' }, c3: { name: 'Gia dụng' }, c4: { name: 'Túi' },
        // nhóm TRÙNG TÊN ở nhánh khác (khác hoa thường) — như HUTI đo 12/11: "Máy nước nóng" dưới hai hãng; chưa có hàng
        c5: { name: 'ổ cắm', parent: 'c3' },
    }
    const chuoi = (cid: string) => { const c = nhom[cid]; const p = c?.parent ? nhom[c.parent] : null; const g = p?.parent ? nhom[p.parent] : null; return { c, p, g } }
    const catCay = (cid: string) => { const { c, p, g } = chuoi(cid); return c ? { name: c.name, parent: p ? { name: p.name, parent: g ? { name: g.name } : null } : null } : null }
    const hang: Record<string, any> = {
        OC4: { id: 'p1', sku: 'OC4', name: 'Ổ cắm điện 4 lỗ chống giật', description: 'Ổ cắm 4 lỗ, dây 3m, chịu tải 2500W, có nút tắt riêng từng lỗ.', productType: 'goods', costPrice: 100000, sellingPrice: 189000, stock: 12, categoryId: 'c1', mergedIntoId: null, bundleId: null, images: [{ url: 'https://storage.googleapis.com/x/1.jpg', isPrimary: true }] },
        BINH: { id: 'p2', sku: 'BINH', name: 'Bình giữ nhiệt 500ml', description: 'Bình inox 304', productType: 'goods', costPrice: 50000, sellingPrice: 129000, stock: 30, categoryId: 'c2', mergedIntoId: null, bundleId: null, images: [] },
        TUI: { id: 'p3', sku: 'TUI', name: 'Túi tote canvas', description: 'Túi vải canvas dày, quai dài 60cm, may viền chắc chắn, đựng vừa laptop 14 inch.', productType: 'goods', costPrice: 45000, sellingPrice: 99000, stock: 60, categoryId: 'c4', mergedIntoId: null, bundleId: null, images: [{ url: 'https://storage.googleapis.com/x/2.jpg', isPrimary: true }, { url: 'https://storage.googleapis.com/x/3.jpg', isPrimary: false }] },
    }
    const listing: any[] = [
        { id: 'op1', channelId: 'ch1', platformProductId: '111', name: 'Ổ cắm điện 4 lỗ', sku: 'OC4', price: 120000, stock: 12, status: 'NORMAL', localProductId: 'p1', imageUrl: null, categoryId: '101', syncedAt: new Date() },
        { id: 'op2', channelId: 'ch1', platformProductId: '222', name: 'Bình giữ nhiệt', sku: 'BINH', price: 160000, stock: 30, status: 'NORMAL', localProductId: 'p2', imageUrl: null, categoryId: '101', syncedAt: new Date() },
    ]
    const don = Array.from({ length: 40 }, (_, i) => { const g = 60000 + i * 10000; return { giaBan: g, phi: 0.14 * g + 3000 } })
    const timHang = (where: any) => Object.values(hang).find(h => JSON.stringify(where).toLowerCase().includes(`"${h.sku.toLowerCase()}"`)) || null
    const voiNhom = (h: any) => h && ({ ...h, category: catCay(h.categoryId) })
    const prisma: any = {
        onlineChannel: { findMany: async () => [kenh], update: async () => kenh },
        product: {
            findFirst: async ({ where }: any) => voiNhom(timHang(where)),
            findMany: async () => Object.values(hang).map(h => ({ ...voiNhom(h), _count: { images: h.images.length }, images: h.images.slice(0, 1) })),
        },
        onlineProduct: {
            findMany: async ({ where }: any) => listing.filter(l => l.channelId === where.channelId && (!where.status || (typeof where.status === 'string' ? l.status === where.status : where.status.in.includes(l.status)))),
            findFirst: async ({ where }: any) => where.syncedAt
                ? listing.filter(l => l.channelId === where.channelId).sort((a, b) => +b.syncedAt - +a.syncedAt)[0] || null
                : listing.find(l => l.channelId === where.channelId && !(where.NOT?.id && l.id === where.NOT.id) && (
                    (where.platformProductId && l.platformProductId === where.platformProductId)
                    || (where.sku && String(l.sku).toLowerCase() === String(where.sku.equals).toLowerCase()))) || null,
            count: async () => listing.length,
        },
        skuMapping: { findMany: async () => [], findFirst: async () => null },
        storeSettings: { findFirst: async () => null },
        category: { findMany: async () => Object.values(nhom).map(c => ({ name: c.name })) },
        $queryRawUnsafe: async (sql: string, ...v: any[]) => {
            // bộ chọn nhóm (nhomHangKho): mỗi nhóm kho + cha + ông, đếm hàng TRỰC TIẾP trong nhóm
            if (sql.includes('AS "cha1"')) return Object.entries(nhom).map(([cid]) => {
                const { c, p, g } = chuoi(cid)
                const trongNhom = Object.values(hang).filter(h => h.categoryId === cid)
                return { name: c.name, cha1: p?.name ?? null, cha2: g?.name ?? null, total: trongNhom.length, inStock: trongNhom.filter(h => h.stock > 0).length }
            })
            if (sql.includes('AS nganh')) return don.map(d => ({ ...d, nganh: '101' }))
            if (sql.includes('"OnlineOrder" o') && sql.includes('platformFee')) return don
            if (sql.includes('FROM "Product"')) {
                const ids: string[] = v[0] || [], skus: string[] = v[1] || []
                return Object.values(hang).filter(h => ids.includes(h.id) || skus.includes(h.sku.toLowerCase())).map(h => {
                    const { c, p, g } = chuoi(h.categoryId)
                    // đúng tên cột COT_NHOM_SQL — đổi tên cột ở lib mà quên đây thì ca B đỏ
                    const coCot = sql.includes('AS "nhomHang"') && sql.includes('AS "nhomCha1"') && sql.includes('AS "nhomCha2"')
                    return { id: h.id, sku: h.sku, name: h.name, description: h.description, costPrice: h.costPrice, mergedIntoId: null, mergedRate: 1, ...(coCot ? { nhomHang: c?.name ?? null, nhomCha1: p?.name ?? null, nhomCha2: g?.name ?? null } : {}) }
                })
            }
            return []
        },
    }
    const P = ShopeeService.prototype as any
    const songGia: Record<string, number> = {}
    P.getItemBaseInfo = async (ids: number[]) => ids.map(id => {
        const l = listing.find(x => x.platformProductId === String(id))
        if (!l) return null
        const goc = songGia[String(id)] ?? l.price
        return { item_id: Number(id), item_status: 'NORMAL', category_id: 101, has_model: false, price_info: [{ original_price: goc, current_price: goc }] }
    }).filter(Boolean)
    P.getItemPromotion = async () => []
    P.getDiscountList = async () => []
    P.getCategories = async () => [{ id: 100, chaId: 0, ten: 'Thiết bị điện', coCon: true }, { id: 101, chaId: 100, ten: 'Ổ cắm', coCon: false }]
    P.categoryRecommend = async () => [101]

    const kho = khoBoNho()
    const ctx: NgCanh = { prisma, kho, nguoi: 'chu@shop.vn' }
    const mp = (await docMauPhiTheoNganh(prisma, kenh)).chon('101')
    const sanTheo = (giaVon: number, target: number, min: number) => tinhGiaDeXuat(thamSoTinh({ ...chuanHoaChinhSach({}), targetMarginRate: target, minMarginRate: min }, giaVon, mp))

    // mặc định chưa có quy tắc
    const st0 = await xayTrangThai(ctx)
    const oc0 = st0.products.find((p: any) => p.sku === 'OC4')
    const sanChung = sanTheo(100000, 0.15, 0.05)
    dung('B1 chưa có quy tắc: giá sàn theo mức chung, không gắn marginRule', oc0?.pricing.floor === sanChung.giaSan && !oc0?.marginRule, JSON.stringify(oc0?.pricing))

    // thêm quy tắc nhóm CHA (khác hoa thường) + quy tắc mã
    const r1 = await luuLaiRieng(ctx, { rule: { scope: 'nhom', key: 'THIẾT BỊ ĐIỆN', targetMarginRate: 0.3, minMarginRate: 0.2 } })
    const r2 = await luuLaiRieng(ctx, { rule: { scope: 'sku', key: 'binh', targetMarginRate: 0.25, minMarginRate: 0.12 } })
    dung('B2 lưu hai quy tắc', r1.rules.length === 1 && r2.rules.length === 2 && !r1.warning)
    const so = (await kho.dsNhatKy(50)).filter((w: any) => w.action === 'config')
    dung('B3 sổ "Đổi cấu hình": mỗi lần lưu MỘT dòng, câu trước → sau dễ đọc', so.length === 2 && /Lãi riêng theo nhóm \/ mã hàng: trống → nhóm «THIẾT BỊ ĐIỆN»: lãi 30%, sàn 20%/.test(so.map((w: any) => w.payload.tomTat).join(' | ')), so.map((w: any) => w.payload.tomTat).join(' | '))

    const st = await xayTrangThai(ctx)
    const oc = st.products.find((p: any) => p.sku === 'OC4'), binh = st.products.find((p: any) => p.sku === 'BINH'), tui = st.products.find((p: any) => p.sku === 'TUI')
    const sanOc = sanTheo(100000, 0.3, 0.2), sanBinh = sanTheo(50000, 0.25, 0.12)
    dung('B4 listing trong nhóm con của nhóm có quy tắc: sàn + đề xuất theo quy tắc nhóm cha', oc?.pricing.floor === sanOc.giaSan && oc?.pricing.price === sanOc.giaDeXuat && oc?.marginRule?.key === 'THIẾT BỊ ĐIỆN' && sanOc.giaSan > sanChung.giaSan, JSON.stringify({ p: oc?.pricing, r: oc?.marginRule }))
    dung('B5 quy tắc theo mã: sàn theo mã', binh?.pricing.floor === sanBinh.giaSan && binh?.marginRule?.scope === 'sku', JSON.stringify(binh?.pricing))
    dung('B6 hàng không thuộc quy tắc nào: mức chung', tui && !tui.marginRule && tui.pricing.floor === sanTheo(45000, 0.15, 0.05).giaSan, JSON.stringify(tui?.pricing))
    dung('B7 trạng thái trả danh sách quy tắc cho giao diện', st.status.policy.marginRules?.length === 2)
    const nhomCha = (st.status.khoGroups || []).find((g: any) => g.name === 'Thiết bị điện'), nhomCon = (st.status.khoGroups || []).find((g: any) => g.name === 'Ổ cắm')
    dung('B8 bộ chọn nhóm: nhóm cha không có hàng trực tiếp vẫn đếm hàng của nhóm con (áp cho N mặt hàng)', nhomCha?.total === 0 && nhomCha?.totalTree === 1 && nhomCon?.parent === 'Thiết bị điện' && nhomCon?.totalTree === 1, JSON.stringify(st.status.khoGroups))
    const nhomTrung = (st.status.khoGroups || []).find((g: any) => g.name === 'ổ cắm')
    dung('B8b tên nhóm trùng ở hai nhánh: cả hai dòng đều nói rõ hai nhánh, đếm chung (quy tắc theo tên áp cả hai)',
        nhomCon?.parents?.join() === 'Thiết bị điện,Gia dụng' && nhomTrung?.totalTree === 1 && nhomTrung?.parents?.length === 2 && !nhomCha?.parents, JSON.stringify({ nhomCon, nhomTrung }))

    // lập giá: TRÊN sàn chung nhưng DƯỚI sàn riêng ⇒ chặn
    const giuaHaiSan = Math.ceil((sanChung.giaSan + 1000) / 1000) * 1000
    const chan = await nem(() => taoKeHoachGia(ctx, { sku: 'OC4', price: giuaHaiSan, idempotencyKey: 'g1' }))
    dung('B9 giá trên sàn chung nhưng dưới sàn RIÊNG ⇒ bị chặn', chan instanceof ToolError && /GIÁ SÀN/i.test(chan.message), chan?.message)
    const kh = await taoKeHoachGia(ctx, { sku: 'OC4', price: sanOc.giaSan, idempotencyKey: 'g2' })
    dung('B10 nâng đúng lên sàn riêng được; kế hoạch nói quy tắc đang áp', kh.status === 'draft' && kh.data.economics.floor === sanOc.giaSan && kh.data.economics.marginRule?.key === 'THIẾT BỊ ĐIỆN', JSON.stringify(kh.data.economics))
    // tham số AI chỉ được CHẶT hơn — AI đòi sàn 3% không làm lỏng sàn riêng 20%
    const ai = await nem(() => taoKeHoachGia(ctx, { sku: 'OC4', price: giuaHaiSan, thamSo: { bien_toi_thieu: 3 }, idempotencyKey: 'g3' }))
    dung('B11 AI truyền sàn thấp hơn không làm lỏng sàn riêng', ai instanceof ToolError && /GIÁ SÀN/i.test(ai.message), ai?.message)

    // khuyến mãi: giá gốc 200.000 giảm 30% = 140.000 — trên sàn chung (~127.200) nhưng dưới sàn riêng (~156.100) ⇒ nâng lên sàn riêng
    songGia['111'] = 200000
    const bd = Math.floor(Date.now() / 1000) + 3600
    const km = await taoKeHoachKhuyenMai(ctx, { name: 'Thử KM', skus: ['OC4'], discountRate: 0.3, startTime: bd, endTime: bd + 86400, purchaseLimit: 2 })
    const dong = km.data.lines?.[0]
    dung('B12 khuyến mãi: giá KM không dưới sàn riêng (nâng lên), dòng gắn quy tắc', dong && dong.floor === sanOc.giaSan && dong.price >= sanOc.giaSan && dong.adjusted && dong.marginRule?.key === 'THIẾT BỊ ĐIỆN', JSON.stringify(dong))

    // form chính sách chung gửi lại bản CŨ (không quy tắc / danh sách rỗng) ⇒ không đè
    await luuCauHinh(ctx, { policy: { ...st0.status.policy, marginRules: [], maxWritesPerDay: 60 } })
    const sauForm = await xayTrangThai(ctx)
    dung('B13 lưu form chính sách chung KHÔNG xoá quy tắc (chỉ đổi qua margin-rule-*)', sauForm.status.policy.marginRules?.length === 2 && sauForm.status.policy.maxWritesPerDay === 60)

    // sửa quy tắc đổi cả khoá (oldScope/oldKey) ⇒ bỏ dòng cũ
    const sua = await luuLaiRieng(ctx, { rule: { scope: 'nhom', key: 'Ổ cắm', targetMarginRate: 0.22, minMarginRate: 0.1 }, oldScope: 'nhom', oldKey: 'thiết bị điện' })
    dung('B14 sửa đổi khoá: dòng cũ bỏ, dòng mới thêm', sua.rules.length === 2 && sua.rules.some(r => r.key === 'Ổ cắm') && !sua.rules.some(r => r.key === 'THIẾT BỊ ĐIỆN'), JSON.stringify(sua.rules))
    const canhBao = await luuLaiRieng(ctx, { rule: { scope: 'sku', key: 'TUI', targetMarginRate: 0.1, minMarginRate: 0.02 } })
    dung('B15 sàn riêng thấp hơn sàn chung ⇒ vẫn lưu nhưng cảnh báo', !!canhBao.warning && /THẤP hơn/.test(canhBao.warning) && canhBao.rules.length === 3, canhBao.warning)
    const loiLuu = await nem(() => luuLaiRieng(ctx, { rule: { scope: 'nhom', key: 'X', targetMarginRate: 0.1, minMarginRate: 0.3 } }))
    dung('B16 quy tắc sai ⇒ báo lỗi, không lưu', loiLuu instanceof ToolError && (await xayTrangThai(ctx)).status.policy.marginRules.length === 3)
    const xoa = await xoaLaiRieng(ctx, { scope: 'sku', key: 'tui' })
    const xoaLai = await xoaLaiRieng(ctx, { scope: 'sku', key: 'tui' })
    dung('B17 xoá quy tắc (không phân biệt hoa thường); xoá lần hai ⇒ daXoa false', xoa.daXoa && xoa.rules.length === 2 && !xoaLai.daXoa)
    // tìm theo NỘI DUNG, không lấy dòng đầu: lưu + xoá cùng một mili-giây thì sổ trong bộ nhớ (sắp theo createdAt, sort ổn định)
    // để dòng LƯU đứng trước — ca này từng đỏ ngẫu nhiên 1/10 lần (12/11/2026)
    const soXoa = (await kho.dsNhatKy(50)).filter((w: any) => w.action === 'config').find((w: any) => /→ trống/.test(w.payload?.tomTat || ''))
    dung('B18 sổ ghi lần xoá: quy tắc → trống', /mã «TUI»: lãi 10%, sàn 2% → trống/.test(soXoa?.payload?.tomTat || ''), soXoa?.payload?.tomTat)
    dung('B19 dòng sổ "config" không ăn trần ghi / ngày', (await kho.demGhiTuLuc(0)) === 0)

    // hộp thoại đăng + ảnh cần chụp
    const td = await tuyChonDang(ctx, { sku: 'OC4' })
    dung('B20 hộp thoại đăng: giá gợi ý theo quy tắc nhóm + kèm danh sách ảnh', td.marginRule?.key === 'Ổ cắm' && td.imageGuide?.anh?.length > 0 && td.imageGuide.soAnh === 1, JSON.stringify({ r: td.marginRule, n: td.imageGuide?.soAnh }))
    const ga = await goiYAnhChoSku(ctx, { sku: 'BINH' })
    dung('B21 thao tác image-guide: hàng chưa có ảnh ⇒ "chua_co"', ga.muc === 'chua_co' && ga.sku === 'BINH' && ga.anh[0].ma === 'anh_bia')
    const tuiSt = (await xayTrangThai(ctx)).products.find((p: any) => p.sku === 'TUI')
    dung('B22 ứng viên đăng kèm imageNeed gọn', tuiSt?.imageNeed?.soAnh === 2 && tuiSt.imageNeed.muc === 'thieu', JSON.stringify(tuiSt?.imageNeed))

    // ─── C. Ảnh cần chụp ────────────────────────────────────────────────────────
    {
        const ma = (g: ReturnType<typeof goiYAnh>) => g.anh.map(a => a.ma)
        const khoan = goiYAnh({ ten: 'Máy khoan pin 18V 2 pin', nhomHang: 'Máy khoan', soAnh: 0 })
        dung('C1 máy khoan pin = dụng cụ + đồ điện', khoan.nganh.map(n => n.ma).join() === 'dung_cu,dien_tu', JSON.stringify(khoan.nganh))
        dung('C2 ảnh bắt buộc đứng trước, ba ảnh đầu là bìa / góc / chi tiết', ma(khoan).slice(0, 3).join() === 'anh_bia,cac_goc,can_chi_tiet' && khoan.anh.findIndex(a => !a.batBuoc) > khoan.anh.findIndex(a => a.ma === 'tem_thong_so'))
        dung('C3 không trùng mã ảnh', new Set(ma(khoan)).size === khoan.anh.length)
        dung('C4 giấy ≠ giày', !nhanNganhAnh({ ten: 'Giấy in A4 Double A 70gsm' }).includes('giay_dep'))
        dung('C5 đậm ≠ đầm', !nhanNganhAnh({ ten: 'Bút bi mực xanh đậm' }).includes('thoi_trang'))
        dung('C6 áo gối không phải thời trang; áo thun là', !nhanNganhAnh({ ten: 'Áo gối lụa 50x70' }).includes('thoi_trang') && nhanNganhAnh({ ten: 'Áo thun nam cổ tròn' }).includes('thoi_trang'))
        dung('C7 thời trang: bảng size bắt buộc', goiYAnh({ ten: 'Quần jean nữ ống rộng', soAnh: 4 }).anh.some(a => a.ma === 'bang_size' && a.batBuoc))
        dung('C8 tủ giày là gia dụng, không đòi bảng size giày', (() => { const n = nhanNganhAnh({ ten: 'Tủ giày 4 tầng' }); return n.includes('gia_dung') && !n.includes('giay_dep') })())
        dung('C9 bánh xe / tất cả / đĩa cắt không bắt nhầm ngành', !nhanNganhAnh({ ten: 'Bánh xe đẩy hàng' }).includes('thuc_pham')
            && !nhanNganhAnh({ ten: 'Combo tất cả phụ kiện' }).includes('thoi_trang') && !nhanNganhAnh({ ten: 'Đĩa cắt sắt 100mm' }).includes('gia_dung')
            && !nhanNganhAnh({ ten: 'Bánh xe đẩy hàng' }).includes('me_be'))
        dung('C10 nhận ngành theo nhóm cha', nhanNganhAnh({ ten: 'Sản phẩm X', nhomHang: 'Hàng mới', nhomCha: ['Mỹ phẩm'] }).includes('my_pham'))
        dung('C11 không khớp ngành nào ⇒ chỉ ảnh chung (7 ảnh)', goiYAnh({ ten: 'Sản phẩm X', soAnh: 0 }).anh.length === 7 && goiYAnh({ ten: 'Sản phẩm X' }).nganh.length === 0)
        const m = (n: number) => goiYAnh({ ten: 'X', soAnh: n })
        dung('C12 mức theo số ảnh', m(0).muc === 'chua_co' && m(2).muc === 'thieu' && m(5).muc === 'nen_them' && m(5).canThem === 2 && m(8).muc === 'du' && m(8).canThem === 0)
        dung('C13 số ảnh lạ (âm / chữ) ⇒ 0', m(-3).soAnh === 0 && goiYAnh({ ten: 'X', soAnh: 'abc' as any }).soAnh === 0)
        dung('C14 tối đa 9 ảnh nói rõ trong lưu ý', TOI_DA_ANH === 9 && goiYAnh({ ten: 'X' }).luuY[0].includes('9 ảnh'))
        dung('C15 video không ghi con số giới hạn độ dài / dung lượng (chưa kiểm được)', !/\d+\s*(giây|phút|s\b|MB|GB|px)/i.test(goiYAnh({ ten: 'X' }).video), goiYAnh({ ten: 'X' }).video)
        const g = tomTatAnh({ ten: 'Áo khoác gió', soAnh: 1 })
        dung('C16 bản gọn: mức + ảnh bắt buộc', g.muc === 'thieu' && g.batBuoc.includes('Bảng size'), JSON.stringify(g))
    }

    // ─── D. Soát nguồn ─────────────────────────────────────────────────────────
    {
        const doc = (f: string) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
        const pilot = doc('src/lib/shopeePilot.ts')
        dung('D1 shopeePilot: không tính giá / nền thẳng từ chính sách CẢ GIAN', !/thamSoTinh\(cfg\.policy|nenGia\(cfg\.policy|thamSoGia\(cfg\.policy/.test(pilot),
            (pilot.match(/.*(thamSoTinh\(cfg\.policy|nenGia\(cfg\.policy|thamSoGia\(cfg\.policy).*/g) || []).join(' | '))
        // `thamSoTinh(pol, …)` chỉ được dùng khi pol vừa dựng TỪ chính sách của mặt hàng (chinhSachChatHon(polCua… / polH…))
        const dong = pilot.split('\n')
        const sai = dong.map((d, i) => ({ d, i })).filter(({ d, i }) => /thamSoTinh\(pol,/.test(d) && !dong.slice(Math.max(0, i - 8), i + 1).some(x => /const pol = chinhSachChatHon\((polCua|polH)/.test(x)))
        dung('D2 thamSoTinh(pol, …) chỉ sau khi pol là chính sách của mặt hàng', sai.length === 0, sai.map(s => `dòng ${s.i + 1}: ${s.d.trim()}`).join(' | '))
        dung('D3 lyDoPhiChuaDuTin trong chu kỳ dùng biên của mặt hàng', !/lyDoPhiChuaDuTin\(u\.quyet\.gia, u\.mauPhi, pol\./.test(pilot))
        const mcp = doc('src/routes/mcpShopeeTools.ts')
        dung('D4 tool AI: không còn nền giá cả gian (nenPilot)', !/nenPilot\(/.test(mcp) && /polCua\(/.test(mcp))
        dung('D5 nút "Đẩy giá lên sàn" tính sàn theo lãi riêng', /polCua\(pol, khoaListing\(/.test(doc('src/lib/dayGiaLenSan.ts')))
        dung('D6 giá vốn hàng loạt đọc nhóm cùng truy vấn (COT_NHOM_SQL)', /COT_NHOM_SQL/.test(doc('src/lib/shopeeThaoTac.ts')))
        const route = doc('src/routes/shopeePilot.ts')
        dung('D7 route: margin-rule-save / -delete là thao tác GHI; image-guide là đọc', /'margin-rule-save': \{ ghi: true/.test(route) && /'margin-rule-delete': \{ ghi: true/.test(route) && /'image-guide': \{ ghi: false/.test(route))
        dung('D8 luuCauHinh bỏ marginRules từ form chung', /marginRules: _boQua/.test(pilot))
    }

    console.log(`\n${dat}/${dat + loi} ca đạt`)
    process.exit(loi ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(1) })
