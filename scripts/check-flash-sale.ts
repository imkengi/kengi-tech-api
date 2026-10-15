/* Kiểm chứng LUỒNG KÍCH HOẠT FLASH SALE (cron/flashSaleScheduler.ts → activatePlan, napVaBat) — 15/10/2026.
 *   npx tsx scripts/check-flash-sale.ts
 * Prisma giả (một dòng FlashSalePlan, hiểu đúng các câu UPDATE luồng này dùng) + Shopee giả (ghi lại mọi lời gọi).
 * Canh: giá "đang bán − 1đ" theo TỪNG phân loại; mã bị bỏ qua phải có lý do (không im lặng); đợt dở của lượt bị đứt thì
 * nhận lại hoặc dọn — KHÔNG tạo đợt thứ hai; chủ shop huỷ giữa chừng thì gỡ đợt vừa bật, không lật 'cancelled'. */
import { _kiemThu } from '../src/cron/flashSaleScheduler'
import { docDieuKienTheoNganh, kiemGiaFlashSale, phanTramGiam } from '../src/lib/flashSaleKiemGia'
import { bocTuLamMoi } from '../src/routes/flashSales'
import { duocDayDotKe, chonKhungTuDong, datDieuKienTuDong, chonMaTuDong, LEAD_MS } from '../src/lib/flashSaleTuDong'

const { activatePlan, napVaBat, chuanBiHang, themVaBat, LoiKhongThuLai } = _kiemThu
let loi = 0
const dung = (ten: string, ok: boolean, chiTiet = '') => { if (!ok) loi++; console.log(`${ok ? '✓' : '✗'} ${ten}${chiTiet ? ' — ' + chiTiet : ''}`) }

type Sale = { status: number; item_count: number }
function shopeeGia(o: {
    sales?: [number, Sale][]; models?: Record<number, any[]>; modelLoi?: number[]
    getLoi?: boolean; deleteLoi?: boolean; tuChoiHet?: boolean; khiThemHang?: () => void
    /** get_item_base_info giả: item_id → bản ghi (has_model, price_info, stock_info_v2, category_id) */
    coSo?: Record<number, any>; dieuKien?: any
    /** trần số mã mỗi đợt giả (vượt ⇒ ném shop_flash_sale_exceed_max_item_criteria như Shopee thật 15/10) */
    tranMa?: number
    /** "itemId:modelId" Shopee từ chối khi thêm */
    tuChoiPhanLoai?: string[]
    /** get_item_promotion giả: success_list */
    khuyenMai?: any[]
} = {}) {
    const goi: string[] = []
    const sales = new Map<number, Sale>(o.sales || [])
    let idMoi = 9000
    let hangGui: any[] = []
    return {
        goi, sales, get hangGui() { return hangGui },
        async flashSaleGet(id: number) {
            goi.push(`get:${id}`)
            if (o.getLoi) throw new Error('Shopee get_shop_flash_sale: mạng hỏng')
            const s = sales.get(id); if (!s) throw new Error('Shopee get_shop_flash_sale: không có đợt')
            return { flash_sale_id: id, ...s }
        },
        async flashSaleDelete(id: number) {
            goi.push(`delete:${id}`)
            if (o.deleteLoi) throw new Error('Shopee delete_shop_flash_sale: không xoá được')
            const s = sales.get(id); if (s) s.status = 0
        },
        async flashSaleCreate(timeslotId: number) { goi.push(`create:${timeslotId}`); const id = ++idMoi; sales.set(id, { status: 1, item_count: 0 }); return id },
        async getModelList(itemId: number) {
            goi.push(`models:${itemId}`)
            if (o.modelLoi?.includes(itemId)) throw new Error('Shopee get_model_list: error_server')
            return o.models?.[itemId] ?? []
        },
        async flashSaleAddItems(id: number, items: any[]) {
            goi.push(`add:${id}:${items.length}`)
            const s = sales.get(id)
            if (o.tranMa != null && (s?.item_count || 0) + items.length > o.tranMa) {
                throw new Error('Shopee add_shop_flash_sale_items: shop_flash_sale_exceed_max_item_criteria - exceed the max number of item limit per promotion')
            }
            hangGui = [...hangGui, ...items]
            o.khiThemHang?.()
            if (s) s.item_count += items.length
            if (o.tuChoiHet) return { failedItems: items.map(i => ({ item_id: i.item_id, err_code: 1, err_msg: 'Shopee từ chối' })) }
            const tc = new Set(o.tuChoiPhanLoai || [])
            return { failedItems: items.flatMap(i => (i.models || []).filter((m: any) => tc.has(`${i.item_id}:${m.model_id}`)).map((m: any) => ({ item_id: i.item_id, model_id: m.model_id, err_code: 2, err_msg: 'phân loại bị từ chối' }))) }
        },
        async flashSaleUpdateStatus(id: number, st: number) { goi.push(`status:${id}:${st}`); const s = sales.get(id); if (s) s.status = st },
        async getItemBaseInfo(ids: number[]) {
            goi.push(`coSo:${ids.join(',')}`)
            if (!o.coSo) throw new Error('Shopee get_item_base_info: chưa giả')
            return ids.map(id => o.coSo![id] && { item_id: id, ...o.coSo![id] }).filter(Boolean)
        },
        async flashSaleItemCriteria() { goi.push('dieuKien'); return o.dieuKien || {} },
        async getItemPromotion(ids: number[]) { goi.push(`km:${ids.join(',')}`); return (o.khuyenMai || []).filter((x: any) => ids.includes(x.item_id)) },
    }
}

/** Prisma giả: một dòng plan; hiểu các câu UPDATE của activatePlan theo đúng điều kiện WHERE (có/không chặn status). */
function prismaGia(dong: any) {
    const chay = (sql: string, a: any[]): any[] => {
        const chan = sql.includes(`status='dang_kich_hoat'`) && /WHERE id=\$\d+ AND status='dang_kich_hoat'/.test(sql)
        if (chan && dong.status !== 'dang_kich_hoat') return []
        if (sql.includes(`"failedItems"=$2`)) { dong.status = 'active'; dong.shopeeFlashSaleId = a[0]; dong.failedItems = JSON.parse(a[1]); dong.error = null }
        else if (sql.includes(`status='active'`)) { dong.status = 'active'; dong.error = null }
        else if (sql.includes(`status='skipped'`)) { dong.status = 'skipped'; dong.error = 'lo khung' }
        else if (sql.includes(`"shopeeFlashSaleId"=$1`)) dong.shopeeFlashSaleId = a[0]
        else if (sql.includes(`"shopeeFlashSaleId"=NULL`)) dong.shopeeFlashSaleId = null
        else throw new Error('Câu SQL lạ trong bộ kiểm chứng: ' + sql.slice(0, 120))
        return [{ id: dong.id }]
    }
    return {
        async $queryRawUnsafe(sql: string, ...a: any[]) { return chay(sql, a) },
        async $executeRawUnsafe(sql: string, ...a: any[]) { return chay(sql, a).length },
    }
}

const sau = (phut: number) => new Date(Date.now() + phut * 60_000)
const planMau = (them: any = {}) => ({
    id: 'p1', status: 'dang_kich_hoat', timeslotId: 777, startTime: sau(120), endTime: sau(180),
    discountPercent: 0, stockPerItem: 3, purchaseLimit: 1, kieuGia: 'tru-1d', shopeeFlashSaleId: null, attempts: 0,
    items: [{ itemId: 2, name: 'Ấm siêu tốc', price: 1000 }], ...them,
})

async function main() {
    // ── 1. napVaBat: giá −1đ theo TỪNG phân loại + mã bỏ qua có lý do ──
    {
        const sv = shopeeGia({
            models: {
                1: [{ model_id: 11, price: 1500, giaHienTai: 1200, stock: 5 }, { model_id: 12, price: 1500, giaHienTai: 1500, stock: 0 }],
                4: [{ model_id: 41, price: 800, giaHienTai: 800, stock: 0 }],
            },
            modelLoi: [5],
        })
        const items = [
            { itemId: 1, name: 'Nồi có phân loại', price: 0 },
            { itemId: 2, name: 'Ấm không phân loại', price: 1000 },
            { itemId: 3, name: 'Chưa có giá', price: 0 },
            { itemId: 4, name: 'Hết tồn', price: 0 },
            { itemId: 5, name: 'Đọc phân loại hỏng', price: 0 },
            { itemId: 6, name: 'Giá điền tay thấp hơn', price: 1000, promoPrice: 900 },
            { itemId: 7, name: 'Giá điền tay không thấp hơn', price: 1000, promoPrice: 1200 },
            { itemId: 0, name: 'Thiếu mã sàn', price: 1000 },
            { itemId: 8, name: 'Tồn sàn ít hơn tồn/SP', price: 1000, ton: 2 },
        ]
        const { failedItems, soItem } = await napVaBat(sv, 5001, items, 0, 3, 1, true)
        const gui = sv.hangGui
        const m = (id: number) => gui.find((g: any) => g.item_id === id)
        dung('gửi đúng 5 mã hợp lệ (1, 2, 6, 7, 8)', soItem === 5 && gui.map((g: any) => g.item_id).join() === '1,2,6,7,8', gui.map((g: any) => g.item_id).join())
        dung('phân loại: giá ĐANG BÁN 1200 − 1đ = 1199 (không phải giá gốc 1500)', m(1)?.models?.[0]?.input_promo_price === 1199, JSON.stringify(m(1)?.models))
        dung('phân loại hết tồn bị loại khỏi đợt', m(1)?.models?.length === 1)
        dung('tồn campaign = min(tồn phân loại, tồn/SP)', m(1)?.models?.[0]?.stock === 3)
        dung('không phân loại: 1000 − 1đ = 999 ở item_input_promo_price, không làm tròn trăm', m(2)?.item_input_promo_price === 999, JSON.stringify(m(2)))
        dung('không phân loại: KHÔNG gửi models (tài liệu: "don\'t use" — model_id 0 bị từ chối)', m(2)?.models === undefined)
        dung('không phân loại: item_stock = tồn/SP khi không biết tồn sàn', m(2)?.item_stock === 3)
        dung('không phân loại: item_stock không vượt tồn trên sàn', m(8)?.item_stock === 2, JSON.stringify(m(8)))
        dung('giá điền tay thấp hơn giá đang bán ⇒ dùng y nguyên 900', m(6)?.item_input_promo_price === 900)
        dung('giá điền tay ≥ giá đang bán ⇒ bỏ, về 999', m(7)?.item_input_promo_price === 999)
        dung('giới hạn mua gắn vào từng mã', m(2)?.purchase_limit === 1)
        const ly = (ten: string) => failedItems.find((f: any) => f.name === ten)?.err_msg || ''
        dung('bỏ qua có lý do: chưa có giá', /Chưa có giá/.test(ly('Chưa có giá')), ly('Chưa có giá'))
        dung('bỏ qua có lý do: hết tồn mọi phân loại', /Hết tồn/.test(ly('Hết tồn')), ly('Hết tồn'))
        dung('đọc phân loại hỏng ≠ không phân loại: báo nguyên lời Shopee', /Không đọc được phân loại: .*get_model_list/.test(ly('Đọc phân loại hỏng')), ly('Đọc phân loại hỏng'))
        dung('bỏ qua có lý do: thiếu mã sàn', /Thiếu mã/.test(ly('Thiếu mã sàn')), ly('Thiếu mã sàn'))
        dung('đúng 4 mã bị bỏ qua, không thừa không thiếu', failedItems.length === 4, String(failedItems.length))
        dung('đã bật đợt sau khi thêm hàng', sv.goi.includes('status:5001:1'))
    }
    // ── 2. kiểu giảm % giữ như cũ (chuẩn = giá gốc, làm tròn trăm) ──
    {
        const sv = shopeeGia({ models: { 1: [{ model_id: 11, price: 1500, giaHienTai: 1200, stock: 5 }] } })
        await napVaBat(sv, 5002, [{ itemId: 1, name: 'A', price: 0 }, { itemId: 2, name: 'B', price: 1000, giaGoc: 1250 }], 20, 3, 0, false)
        const g = sv.hangGui
        dung('%: phân loại tính từ GIÁ GỐC 1500 × 80% = 1200', g[0]?.models?.[0]?.input_promo_price === 1200, JSON.stringify(g[0]?.models))
        dung('%: không phân loại tính từ giaGoc 1250 × 80% = 1000', g[1]?.item_input_promo_price === 1000, JSON.stringify(g[1]))
        dung('%: vẫn gửi purchase_limit = 0 (trường bắt buộc, 0 = không giới hạn)', g[1]?.purchase_limit === 0)
    }
    // ── 3. không mã nào gửi được ⇒ lỗi nêu lý do, không gọi thêm hàng ──
    {
        const sv = shopeeGia()
        let thongBao = ''
        try { await napVaBat(sv, 5003, [{ itemId: 3, name: 'Chưa có giá', price: 0 }], 0, 3, 0, true) } catch (e: any) { thongBao = e.message }
        dung('hết mã ⇒ ném lỗi kèm lý do (gom nhóm, có ví dụ nguyên văn)', /1 mã lý do khác \(vd Chưa có giá: Chưa có giá đang bán/.test(thongBao), thongBao)
        dung('hết mã ⇒ không gọi add items', !sv.goi.some(g => g.startsWith('add:')))
    }
    // ── 3b. giá + tồn SỐNG lúc đẩy (get_item_base_info) thắng số FE gửi lúc xếp; has_model chắc chắn ──
    {
        const sv = shopeeGia({
            coSo: {
                21: { has_model: false, price_info: [{ original_price: 1000, current_price: 900 }], stock_info_v2: { summary_info: { total_available_stock: 7 } } },
                22: { has_model: true },
                23: { has_model: false, price_info: [{ original_price: 500, current_price: 500 }], stock_info_v2: { summary_info: { total_available_stock: 0 } } },
                24: { has_model: false, price_info: [{ original_price: 2000, current_price: 1500 }], stock_info_v2: { seller_stock: [{ stock: 2 }, { stock: 1 }] } },
            },
            modelLoi: [22],
        })
        const items = [
            { itemId: 21, name: 'Giá FE cũ', price: 1000 },
            { itemId: 22, name: 'Có phân loại, đọc hỏng', price: 1000 },
            { itemId: 23, name: 'Hết tồn trên sàn', price: 500, ton: 9 },
            { itemId: 24, name: 'Tồn theo kho người bán', price: 1500 },
        ]
        const { failedItems } = await napVaBat(sv, 5004, items, 0, 5, 0, true)
        const g = (id: number) => sv.hangGui.find((x: any) => x.item_id === id)
        const ly = (ten: string) => failedItems.find((f: any) => f.name === ten)?.err_msg || ''
        dung('giá ĐANG BÁN sống 900 − 1đ = 899 (không dùng 1000 FE gửi lúc xếp)', g(21)?.item_input_promo_price === 899, JSON.stringify(g(21)))
        dung('tồn campaign theo tồn sống: min(7, 5) = 5', g(21)?.item_stock === 5)
        dung('has_model=false ⇒ không gọi get_model_list', !sv.goi.includes('models:21'), sv.goi.join(' '))
        dung('has_model=true mà đọc phân loại hỏng ⇒ BỎ QUA kèm lời Shopee, không gửi như hàng không phân loại', !g(22) && /Không đọc được phân loại/.test(ly('Có phân loại, đọc hỏng')), ly('Có phân loại, đọc hỏng'))
        dung('tồn sống = 0 ⇒ bỏ qua "Hết tồn trên sàn" (dù FE gửi ton 9)', !g(23) && /Hết tồn trên sàn/.test(ly('Hết tồn trên sàn')))
        dung('tồn cộng từ seller_stock khi thiếu summary_info: 3', g(24)?.item_stock === 3, JSON.stringify(g(24)))
        dung('đọc thông tin gốc một lượt cho cả lô', sv.goi.filter(x => x.startsWith('coSo:')).length === 1)
    }
    // ── 3c. kiểu % dùng GIÁ GỐC sống ──
    {
        const sv = shopeeGia({ coSo: { 31: { has_model: false, price_info: [{ original_price: 2000, current_price: 1500 }], stock_info_v2: { summary_info: { total_available_stock: 4 } } } } })
        await napVaBat(sv, 5005, [{ itemId: 31, name: 'A', price: 1500, giaGoc: 1500 }], 20, 3, 0, false)
        dung('%: 20% từ giá gốc sống 2000 = 1600 (không phải từ 1500 FE gửi)', sv.hangGui[0]?.item_input_promo_price === 1600, JSON.stringify(sv.hangGui[0]))
    }
    // ── 3d. soát giá trước khi xếp (lib/flashSaleKiemGia) ──
    {
        const sv = shopeeGia({
            coSo: {
                41: { has_model: false, category_id: 100, price_info: [{ original_price: 1000, current_price: 940 }], stock_info_v2: { summary_info: { total_available_stock: 3 } } },
                42: { has_model: true, category_id: 200 },
            },
            models: { 42: [{ model_id: 421, name: 'Đỏ', price: 2000, giaHienTai: 1800, stock: 2 }, { model_id: 422, name: 'Xanh', price: 2000, giaHienTai: 2000, stock: 5 }] },
            dieuKien: {
                criteria: [{ criteria_id: 4, min_discount: 5, max_discount: 90, min_promo_stock: 1, max_promo_stock: 1000 }, { criteria_id: 9, min_discount: 10, max_discount: -1, min_promo_stock: -1, max_promo_stock: -1 }],
                pair_ids: [{ criteria_id: 4, category_list: [{ category_id: 0, name: 'All' }] }, { criteria_id: 9, category_list: [{ category_id: 200, name: 'Gia dụng' }] }],
            },
        })
        const theoNganh = await docDieuKienTheoNganh(sv)
        const kq = await kiemGiaFlashSale(sv, [41, 42, 43, 41], theoNganh)
        const k = (id: number) => kq.find(x => x.itemId === id)
        dung('điều kiện "All" (ngành 0): giảm 5–90%', theoNganh.get(0)?.giamToiThieu === 5 && theoNganh.get(0)?.giamToiDa === 90)
        dung('−1 của Shopee = không giới hạn ⇒ giamToiDa 100, tonToiDa 0', theoNganh.get(200)?.giamToiDa === 100 && theoNganh.get(200)?.tonToiDa === 0, JSON.stringify(theoNganh.get(200)))
        dung('mã trùng chỉ soát một lần', kq.length === 3, String(kq.length))
        dung('hàng không phân loại: giá gốc 1000, đang bán 940, tồn 3', k(41)?.giaGoc === 1000 && k(41)?.giaDangBan === 940 && k(41)?.ton === 3 && !k(41)?.coPhanLoai)
        dung('ngành không có điều kiện riêng ⇒ dùng "All"', k(41)?.dieuKien?.giamToiThieu === 5)
        dung('ngành có điều kiện riêng ⇒ dùng của ngành (10%)', k(42)?.dieuKien?.giamToiThieu === 10)
        dung('hàng có phân loại: giá từng phân loại', k(42)?.coPhanLoai === true && k(42)?.phanLoai.map(p => `${p.giaGoc}/${p.giaDangBan}`).join() === '2000/1800,2000/2000', JSON.stringify(k(42)?.phanLoai))
        dung('mã Shopee không trả ⇒ có lý do, không im lặng', /không trả thông tin/.test(k(43)?.loi || ''), k(43)?.loi)
        dung('940 − 1đ so với gốc 1000 = giảm 6,1% ⇒ đạt 5%', phanTramGiam(1000, 939) === 6.1)
        dung('bán đúng giá gốc mà −1đ ⇒ giảm 0% (Shopee từ chối)', phanTramGiam(2000, 1999) === 0)
    }
    // ── 3e. soát theo ĐIỀU KIỆN của gian (đo 15/10: giảm 5–90% so với giá gốc) — mã chắc chắn bị từ chối thì bỏ kèm lý do ──
    {
        const dieuKien = {
            criteria: [{ criteria_id: 4, min_discount: 5, max_discount: 90, min_promo_stock: 1, max_promo_stock: 2 }],
            pair_ids: [{ criteria_id: 4, category_list: [{ category_id: 0, name: 'All' }] }],
        }
        const sv = shopeeGia({
            dieuKien,
            coSo: {
                51: { has_model: false, price_info: [{ original_price: 1000, current_price: 1000 }], stock_info_v2: { summary_info: { total_available_stock: 9 } } },
                52: { has_model: false, price_info: [{ original_price: 1000, current_price: 900 }], stock_info_v2: { summary_info: { total_available_stock: 9 } } },
                53: { has_model: true },
            },
            models: { 53: [{ model_id: 531, price: 1000, giaHienTai: 900, stock: 3 }, { model_id: 532, price: 1000, giaHienTai: 1000, stock: 2 }] },
        })
        const { shopeeItems, boQua } = await chuanBiHang(sv, [
            { itemId: 51, name: 'Bán đúng giá gốc', price: 1000 },
            { itemId: 52, name: 'Đang khuyến mãi', price: 900 },
            { itemId: 53, name: 'Phân loại lẫn', price: 0 },
        ], 0, 5, 1, true)
        const g = (id: number) => shopeeItems.find((x: any) => x.item_id === id)
        const ly = (ten: string) => boQua.find((b: any) => b.name === ten)
        dung('bán đúng giá gốc mà −1đ ⇒ KHÔNG gửi, lý do "chỉ thấp hơn giá gốc 0,1% — Shopee đòi ≥ 5%"', !g(51) && /999đ chỉ thấp hơn giá gốc 1\.000đ 0,1% — Shopee đòi ≥ 5%/.test(ly('Bán đúng giá gốc')?.err_msg || ''), ly('Bán đúng giá gốc')?.err_msg)
        dung('đang khuyến mãi: 900 − 1đ = 899 (giảm 10,1%) ⇒ gửi', g(52)?.item_input_promo_price === 899)
        dung('tồn campaign kẹp theo tối đa của Shopee (2)', g(52)?.item_stock === 2, JSON.stringify(g(52)))
        dung('phân loại lẫn: chỉ gửi phân loại đạt', g(53)?.models?.length === 1 && g(53)?.models?.[0]?.model_id === 531, JSON.stringify(g(53)))
        dung('phân loại bị bỏ ghi motPhan (mã vẫn vào đợt)', ly('Phân loại lẫn')?.motPhan === true && /bỏ 1\/2 phân loại/.test(ly('Phân loại lẫn')?.err_msg || ''), ly('Phân loại lẫn')?.err_msg)
    }
    {
        const sv = shopeeGia({
            dieuKien: { criteria: [{ criteria_id: 39, min_discount: 5, max_discount: 90, min_promo_stock: 5, max_promo_stock: 10000 }], pair_ids: [{ criteria_id: 39, category_list: [{ category_id: 0 }] }] },
            coSo: { 61: { has_model: false, price_info: [{ original_price: 1000, current_price: 800 }], stock_info_v2: { summary_info: { total_available_stock: 9 } } } },
        })
        const { shopeeItems, boQua } = await chuanBiHang(sv, [{ itemId: 61, name: 'Tồn ít', price: 800 }], 0, 1, 0, true)
        dung('tồn campaign 1 < tối thiểu 5 của Shopee ⇒ bỏ kèm lý do', !shopeeItems.length && /tồn campaign 1 < tối thiểu 5/.test(boQua[0]?.err_msg || ''), boQua[0]?.err_msg)
    }
    {
        // không đọc được điều kiện ⇒ không soát (Shopee quyết)
        const sv = shopeeGia({ coSo: { 71: { has_model: false, price_info: [{ original_price: 1000, current_price: 1000 }], stock_info_v2: { summary_info: { total_available_stock: 3 } } } } })
        ;(sv as any).flashSaleItemCriteria = async () => { throw new Error('Shopee get_item_criteria: error_server') }
        const { shopeeItems } = await chuanBiHang(sv, [{ itemId: 71, name: 'A', price: 1000 }], 0, 5, 0, true)
        dung('không đọc được điều kiện ⇒ vẫn gửi (không đoán thay Shopee)', shopeeItems.length === 1 && shopeeItems[0].item_input_promo_price === 999)
    }
    // ── 3f. KHÔNG mã nào đạt ⇒ không tạo đợt trên Shopee; lỗi chắc chắn ⇒ không thử lại; đọc hỏng ⇒ còn thử lại ──
    {
        const dong = planMau({ items: [{ itemId: 51, name: 'Bán đúng giá gốc', price: 1000 }] })
        const sv = shopeeGia({
            dieuKien: { criteria: [{ criteria_id: 4, min_discount: 5, max_discount: 90 }], pair_ids: [{ criteria_id: 4, category_list: [{ category_id: 0 }] }] },
            coSo: { 51: { has_model: false, price_info: [{ original_price: 1000, current_price: 1000 }], stock_info_v2: { summary_info: { total_available_stock: 9 } } } },
        })
        let loiBat: any = null
        try { await activatePlan(prismaGia(dong), dong, {}, sv) } catch (e) { loiBat = e }
        dung('không mã nào đạt ⇒ KHÔNG tạo đợt trên Shopee', !sv.goi.some(x => x.startsWith('create:')), sv.goi.join(' '))
        dung('lỗi chắc chắn (giá) ⇒ LoiKhongThuLai (plan failed ngay)', loiBat instanceof LoiKhongThuLai, String(loiBat?.message).slice(0, 120))
    }
    {
        // 2 mã hết hàng + 1 mã giá chưa đạt ⇒ lý do GIÁ đứng trước, hết hàng chỉ đếm
        const dong = planMau({ items: [{ itemId: 91, name: 'Hết 1', price: 500 }, { itemId: 92, name: 'Hết 2', price: 500 }, { itemId: 93, name: 'Quạt đứng', price: 1000 }] })
        const sv = shopeeGia({
            dieuKien: { criteria: [{ criteria_id: 4, min_discount: 5, max_discount: 90 }], pair_ids: [{ criteria_id: 4, category_list: [{ category_id: 0 }] }] },
            coSo: {
                91: { has_model: false, price_info: [{ original_price: 500, current_price: 500 }], stock_info_v2: { summary_info: { total_available_stock: 0 } } },
                92: { has_model: false, price_info: [{ original_price: 500, current_price: 500 }], stock_info_v2: { summary_info: { total_available_stock: 0 } } },
                93: { has_model: false, price_info: [{ original_price: 1000, current_price: 1000 }], stock_info_v2: { summary_info: { total_available_stock: 5 } } },
            },
        })
        let loiBat: any = null
        try { await activatePlan(prismaGia(dong), dong, {}, sv) } catch (e) { loiBat = e }
        const m = String(loiBat?.message || '')
        dung('gom lý do: "1 mã giá chưa đạt … (vd Quạt đứng: …)" đứng TRƯỚC "2 mã hết hàng"', /1 mã giá chưa đạt mức giảm của Shopee \(vd Quạt đứng: .*Shopee đòi ≥ 5%\) · 2 mã hết hàng$/.test(m), m)
    }
    {
        const dong = planMau({ items: [{ itemId: 22, name: 'Có phân loại, đọc hỏng', price: 0 }] })
        const sv = shopeeGia({ coSo: { 22: { has_model: true } }, modelLoi: [22] })
        let loiBat: any = null
        try { await activatePlan(prismaGia(dong), dong, {}, sv) } catch (e) { loiBat = e }
        dung('hỏng vì ĐỌC (mạng/Shopee) ⇒ lỗi thường, còn thử lại', !!loiBat && !(loiBat instanceof LoiKhongThuLai), String(loiBat?.message).slice(0, 120))
    }
    // ── 3g. TRẦN số mã mỗi đợt (Shopee 15/10: exceed_max_item_criteria) ⇒ thêm theo lô, chia đôi, phần vượt ghi lý do ──
    {
        const sv = shopeeGia({ sales: [[7001, { status: 1, item_count: 0 }]], tranMa: 13 })
        const hang = Array.from({ length: 25 }, (_, i) => ({ item_id: 100 + i, purchase_limit: 0, item_input_promo_price: 999, item_stock: 1 }))
        const r = await themVaBat(sv, 7001, hang)
        dung('vào đúng 13 mã (bằng trần)', r.soItem === 13 && sv.sales.get(7001)?.item_count === 13, `${r.soItem}`)
        dung('12 mã vượt trần ghi lý do "xếp sang đợt khác"', r.failedItems.filter((f: any) => /Vượt số mã tối đa/.test(f.err_msg)).length === 12)
        dung('báo chạm trần', r.chamTran === true)
        dung('vẫn bật đợt với phần đã vào', sv.goi.includes('status:7001:1'))
        dung('số lần gọi thêm hàng có chừng mực (≤ 12)', sv.goi.filter(x => x.startsWith('add:')).length <= 12, String(sv.goi.filter(x => x.startsWith('add:')).length))
    }
    {
        // Shopee từ chối MỘT phân loại ⇒ mã vẫn tính là vào đợt
        const sv = shopeeGia({ sales: [[7002, { status: 1, item_count: 0 }]], tuChoiPhanLoai: ['1:12'] })
        const r = await themVaBat(sv, 7002, [{ item_id: 1, purchase_limit: 0, models: [{ model_id: 11, input_promo_price: 9, stock: 1 }, { model_id: 12, input_promo_price: 9, stock: 1 }] }])
        dung('một phân loại bị từ chối ⇒ mã vẫn vào đợt', r.soItem === 1 && r.failedItems.length === 1, JSON.stringify(r))
    }
    // ── 3h. GIÁ ĐANG HIỂN THỊ (chủ shop 15/10: "giá là giá đang hiển thị chứ") = min(current_price, chương trình ĐANG CHẠY) ──
    {
        const dieuKien = { criteria: [{ criteria_id: 4, min_discount: 5, max_discount: 90 }], pair_ids: [{ criteria_id: 4, category_list: [{ category_id: 0 }] }] }
        const ongoing = (gia: number, model_id = 0, loai = 'Discount Promotions') => ({ promotion_type: loai, model_id, promotion_staging: 'ongoing', promotion_price_info: [{ promotion_price: gia }] })
        const sv = shopeeGia({
            dieuKien,
            coSo: {
                81: { has_model: false, price_info: [{ original_price: 1000, current_price: 1000 }], stock_info_v2: { summary_info: { total_available_stock: 9 } } },
                82: { has_model: true },
                83: { has_model: false, price_info: [{ original_price: 1000, current_price: 1000 }], stock_info_v2: { summary_info: { total_available_stock: 9 } } },
            },
            models: { 82: [{ model_id: 821, price: 2000, giaHienTai: 2000, stock: 3 }, { model_id: 822, price: 2000, giaHienTai: 2000, stock: 3 }] },
            khuyenMai: [
                { item_id: 81, promotion: [ongoing(800)] },
                { item_id: 82, promotion: [ongoing(1500, 821)] },
                // sắp chạy + chính flash sale ⇒ KHÔNG tính là giá hiển thị
                { item_id: 83, promotion: [{ ...ongoing(500), promotion_staging: 'upcoming' }, ongoing(400, 0, 'In ShopFlash Sale')] },
            ],
        })
        const { shopeeItems, boQua } = await chuanBiHang(sv, [
            { itemId: 81, name: 'KM không vào current', price: 1000 },
            { itemId: 82, name: 'KM một phân loại', price: 0 },
            { itemId: 83, name: 'Chỉ có KM sắp chạy', price: 1000 },
        ], 0, 5, 0, true)
        const g = (id: number) => shopeeItems.find((x: any) => x.item_id === id)
        const ly = (ten: string) => boQua.find((b: any) => b.name === ten)
        dung('giá hiển thị 800 (chương trình đang chạy) − 1đ = 799, không phải 1000 − 1đ', g(81)?.item_input_promo_price === 799, JSON.stringify(g(81)))
        dung('phân loại có KM đang chạy: 1500 − 1đ = 1499 ⇒ đạt; phân loại bán giá gốc bị bỏ', g(82)?.models?.length === 1 && g(82)?.models?.[0]?.input_promo_price === 1499, JSON.stringify(g(82)))
        dung('phân loại bán giá gốc ghi motPhan', ly('KM một phân loại')?.motPhan === true)
        dung('KM sắp chạy / chính flash sale KHÔNG tính ⇒ 999 không đạt 5%', !g(83) && /Shopee đòi ≥ 5%/.test(ly('Chỉ có KM sắp chạy')?.err_msg || ''), ly('Chỉ có KM sắp chạy')?.err_msg)
        const kq = await kiemGiaFlashSale(sv, [81, 82])
        const k81 = kq.find(x => x.itemId === 81), k82 = kq.find(x => x.itemId === 82)
        dung('soát giá trả giá hiển thị 800 + tên chương trình', k81?.giaDangBan === 800 && k81?.khuyenMai === 'Discount Promotions', JSON.stringify(k81))
        dung('soát giá từng phân loại theo chương trình', k82?.phanLoai.map(p => p.giaDangBan).join() === '1500,2000', JSON.stringify(k82?.phanLoai))
    }
    // ── 3i. TOKEN hết hạn giữa chừng (15/10 10:35 Kengi Electric "invalid_acceess_token") ⇒ làm mới + thử lại một lần ──
    {
        const taoDichVu = () => {
            const goi: string[] = []
            return {
                goi, credentials: { accessToken: 'cu', refreshToken: 'r1' },
                async flashSaleGet(id: number) {
                    goi.push(`get:${this.credentials.accessToken}`)
                    if (this.credentials.accessToken === 'cu') throw new Error('Shopee get_shop_flash_sale: invalid_acceess_token - Invalid access_token, please have a check.')
                    return { flash_sale_id: id, status: 1 }
                },
                async flashSaleDelete() { throw new Error('Shopee delete_shop_flash_sale: shop_flash_sale_not_exist') },
                async refreshAccessToken() { goi.push('lamMoi'); return { accessToken: 'moi', refreshToken: 'r2', expiresIn: 14400 } },
            }
        }
        const prismaKenh = (tokenTrongCsdl: string) => {
            const ghi: any[] = []
            return { ghi, onlineChannel: {
                async findUnique() { return { id: 'ch', accessToken: tokenTrongCsdl, refreshToken: 'rX' } },
                async update(a: any) { ghi.push(a.data); return a.data },
            } }
        }
        {
            const dv = taoDichVu(), pr = prismaKenh('cu')
            const r = await bocTuLamMoi(pr, { id: 'ch', name: 'Kengi Electric' }, dv).flashSaleGet(5)
            dung('token hỏng ⇒ tự làm mới, LƯU token mới, thử lại được', r?.status === 1 && dv.goi.join() === 'get:cu,lamMoi,get:moi' && pr.ghi[0]?.accessToken === 'moi', dv.goi.join())
        }
        {
            const dv = taoDichVu(), pr = prismaKenh('moi-tu-autosync')
            await bocTuLamMoi(pr, { id: 'ch', name: 'Kengi Electric' }, dv).flashSaleGet(5).catch(() => null)
            dung('nơi khác vừa làm mới ⇒ dùng token trong CSDL, KHÔNG làm mới chồng', !dv.goi.includes('lamMoi') && dv.credentials.accessToken === 'moi-tu-autosync', dv.goi.join())
        }
        {
            const dv = taoDichVu(), pr = prismaKenh('cu')
            let loi = ''
            try { await bocTuLamMoi(pr, { id: 'ch' }, dv).flashSaleDelete(5) } catch (e: any) { loi = e.message }
            dung('lỗi KHÁC token ⇒ ném nguyên văn, không làm mới', /shop_flash_sale_not_exist/.test(loi) && !dv.goi.includes('lamMoi'), loi)
        }
    }
    // ── 3j. FLASH SALE TỰ ĐỘNG (15/10: "tới giờ là set 10 mã còn hàng, mỗi mã 1 cái") ──
    {
        const now = Date.UTC(2026, 9, 15, 5, 0, 0)   // 12:00 VN
        const phut = (m: number) => now + m * 60_000
        dung('luật đẩy: không có đợt nào ⇒ đẩy ngay', duocDayDotKe({ sapToi: 0, dangChay: 0, batDau: phut(300), now }))
        dung('luật đẩy: đã có MỘT đợt chờ trên Shopee ⇒ không đẩy thêm', !duocDayDotKe({ sapToi: 1, dangChay: 0, batDau: phut(10), now }))
        dung('luật đẩy: đợt đang chạy + đợt kế còn 30 phút ⇒ đẩy (khung nối liền không bị lỡ)', duocDayDotKe({ sapToi: 0, dangChay: 1, batDau: phut(30), now }))
        dung('luật đẩy: đợt đang chạy + đợt kế còn 3 giờ ⇒ chưa (không giữ tồn quá sớm)', !duocDayDotKe({ sapToi: 0, dangChay: 1, batDau: phut(180), now }))
        const s = (id: number, batDauPhut: number) => ({ timeslot_id: id, start_time: Math.floor(phut(batDauPhut) / 1000), end_time: Math.floor(phut(batDauPhut + 30) / 1000) })
        const slots = [s(1, 2), s(2, 30), s(3, 60), s(4, 200)]
        dung('chọn khung: bỏ khung còn < 5 phút, lấy khung sớm nhất trong 90 phút', chonKhungTuDong(slots, new Set(), now, LEAD_MS)?.timeslot_id === 2)
        dung('chọn khung: bỏ khung đã có đợt', chonKhungTuDong(slots, new Set([2]), now, LEAD_MS)?.timeslot_id === 3)
        dung('chọn khung: bỏ khung đã xét (không có mã) ⇒ khung sau', chonKhungTuDong(slots, new Set(), now, LEAD_MS, 2)?.timeslot_id === 3)
        dung('chọn khung: ngoài 90 phút ⇒ chưa xếp', chonKhungTuDong([s(4, 200)], new Set(), now, LEAD_MS) === null)

        const dk = { giamToiThieu: 5, giamToiDa: 90, tonToiThieu: 1, tonToiDa: 1000 }
        const cfg = { channelId: 'k', bat: true, soMa: 3, tonMoiMa: 1, gioiHanMua: 1, kieuGia: 'tru-1d' as const, phanTram: 10 }
        const ma = (id: number, goc: number, dangBan: number, ton: number) => ({ itemId: id, coPhanLoai: false, giaGoc: goc, giaDangBan: dangBan, ton, phanLoai: [], dieuKien: dk })
        dung('điều kiện: đang KM (900/1000) còn hàng ⇒ đạt', datDieuKienTuDong(ma(1, 1000, 900, 3), cfg))
        dung('điều kiện: bán đúng giá gốc ⇒ không đạt (−1đ chỉ giảm 0,1%)', !datDieuKienTuDong(ma(2, 1000, 1000, 3), cfg))
        dung('điều kiện: hết hàng ⇒ không đạt', !datDieuKienTuDong(ma(3, 1000, 900, 0), cfg))
        dung('điều kiện: kiểu % 10 ⇒ bán đúng giá gốc vẫn đạt', datDieuKienTuDong(ma(2, 1000, 1000, 3), { ...cfg, kieuGia: 'phan-tram', phanTram: 10 }))
        dung('điều kiện: có phân loại ⇒ đạt khi ÍT NHẤT một phân loại còn hàng + đạt giá',
            datDieuKienTuDong({ itemId: 9, coPhanLoai: true, giaGoc: 0, giaDangBan: 0, ton: 5, dieuKien: dk, phanLoai: [
                { modelId: 1, ten: 'A', giaGoc: 1000, giaDangBan: 1000, ton: 5 }, { modelId: 2, ten: 'B', giaGoc: 1000, giaDangBan: 800, ton: 1 }] }, cfg))

        // chọn mã: xoay vòng + tránh mã Shopee từ chối + dừng đủ soMa
        const coSo: Record<number, any> = {}
        const sps: any[] = []
        for (let i = 1; i <= 12; i++) {
            const id = 1000 + i
            // 1001–1003 bán đúng giá gốc (không đạt), còn lại đang KM
            coSo[id] = { has_model: false, category_id: 0, price_info: [{ original_price: 1000, current_price: i <= 3 ? 1000 : 900 }], stock_info_v2: { summary_info: { total_available_stock: 5 } } }
            sps.push({ platformProductId: String(id), name: `Mã ${id}` })
        }
        const lichSu = [
            { startTime: new Date(now - 3600_000).toISOString(), items: [{ itemId: 1004 }, { itemId: 1005 }], failedItems: [] },           // vừa lên ⇒ xếp sau
            { startTime: new Date(now - 7200_000).toISOString(), items: [{ itemId: 1006 }], failedItems: [{ item_id: 1006, err_code: 9, err_msg: 'x' }] }, // Shopee từ chối cả mã ⇒ tránh
        ]
        const sv = shopeeGia({ coSo })
        const { items, daXet } = await chonMaTuDong(sv, sps, lichSu, cfg, new Map([[0, dk]]), 80, () => 0.5)
        const ids = items.map((x: any) => x.itemId)
        dung('chọn đúng 3 mã (soMa)', items.length === 3, ids.join())
        dung('chỉ mã đạt điều kiện (không lấy 1001–1003 bán đúng giá gốc)', ids.every((x: number) => x > 1003))
        dung('xoay vòng: mã CHƯA lên flash sale được chọn trước mã vừa lên (1004, 1005)', !ids.includes(1004) && !ids.includes(1005), ids.join())
        dung('tránh mã Shopee vừa từ chối cả mã (1006)', !ids.includes(1006))
        dung('mỗi mã mang giá đang bán + giá gốc sống', items.every((x: any) => x.price === 900 && x.giaGoc === 1000))
        dung('đọc Shopee theo lô, dừng khi đủ (1 lô 20 mã)', daXet <= 20 && sv.goi.filter(x => x.startsWith('coSo:')).length === 1, `${daXet} ${sv.goi.filter(x => x.startsWith('coSo:')).length}`)
        const { items: rong, daXet: xet2 } = await chonMaTuDong(shopeeGia({ coSo: Object.fromEntries(Object.entries(coSo).map(([k, v]) => [k, { ...v, price_info: [{ original_price: 1000, current_price: 1000 }] }])) }), sps, [], cfg, new Map([[0, dk]]), 10, () => 0.5)
        dung('không mã nào đạt ⇒ rỗng, xét có trần (10)', rong.length === 0 && xet2 <= 20, `${rong.length} ${xet2}`)
    }
    // ── 4. đường thường: tạo → ghi id NGAY → thêm hàng → bật → active ──
    {
        const dong = planMau()
        let idLucThemHang: any = 'chua'
        const sv = shopeeGia({ khiThemHang: () => { idLucThemHang = dong.shopeeFlashSaleId } })
        await activatePlan(prismaGia(dong), dong, {}, sv)
        dung('active + lưu id đợt', dong.status === 'active' && dong.shopeeFlashSaleId === 9001, `${dong.status} #${dong.shopeeFlashSaleId}`)
        dung('id đợt đã nằm trong CSDL TRƯỚC khi thêm hàng (đứt giữa chừng vẫn biết mà dọn)', idLucThemHang === 9001, String(idLucThemHang))
        dung('chỉ tạo đúng một đợt', sv.goi.filter(g => g.startsWith('create:')).length === 1)
    }
    // ── 5. đợt dở ĐÃ BẬT + có hàng (đứt sau khi bật, trước khi ghi active) ⇒ nhận lại, KHÔNG tạo đợt hai ──
    {
        const dong = planMau({ shopeeFlashSaleId: 8001n }); const sv = shopeeGia({ sales: [[8001, { status: 1, item_count: 4 }]] })
        await activatePlan(prismaGia(dong), dong, {}, sv)
        dung('nhận lại đợt #8001 làm đợt đang chạy', dong.status === 'active' && Number(dong.shopeeFlashSaleId) === 8001, dong.status)
        dung('không tạo đợt thứ hai', !sv.goi.some(g => g.startsWith('create:')), sv.goi.join(' '))
    }
    // ── 6. đợt dở rỗng ⇒ xoá rồi làm lại ──
    {
        const dong = planMau({ shopeeFlashSaleId: 8002 }); const sv = shopeeGia({ sales: [[8002, { status: 1, item_count: 0 }]] })
        await activatePlan(prismaGia(dong), dong, {}, sv)
        dung('đợt dở rỗng bị xoá trước khi tạo mới', sv.goi.indexOf('delete:8002') >= 0 && sv.goi.indexOf('delete:8002') < sv.goi.findIndex(g => g.startsWith('create:')), sv.goi.join(' '))
        dung('đợt mới active', dong.status === 'active' && dong.shopeeFlashSaleId === 9001)
    }
    // ── 7. đợt dở: đọc không được, xoá không được ⇒ ném lỗi, giữ id, không tạo thêm ──
    {
        const dong = planMau({ shopeeFlashSaleId: 8003 }); const sv = shopeeGia({ getLoi: true, deleteLoi: true })
        let thongBao = ''
        try { await activatePlan(prismaGia(dong), dong, {}, sv) } catch (e: any) { thongBao = e.message }
        dung('ném lỗi "chưa dọn được"', /Đợt dở #8003 .*chưa dọn được/.test(thongBao), thongBao)
        dung('giữ id đợt dở cho lượt sau', dong.shopeeFlashSaleId === 8003)
        dung('không tạo đợt mới', !sv.goi.some(g => g.startsWith('create:')))
    }
    // ── 8. đợt dở mà khung giờ đã sát ⇒ dọn rồi bỏ "lỡ khung giờ", không tạo ──
    {
        const dong = planMau({ shopeeFlashSaleId: 8004, startTime: sau(1) }); const sv = shopeeGia({ sales: [[8004, { status: 2, item_count: 0 }]] })
        await activatePlan(prismaGia(dong), dong, {}, sv)
        dung('sát giờ: xoá đợt dở + skipped', sv.goi.includes('delete:8004') && dong.status === 'skipped' && dong.shopeeFlashSaleId === null, `${dong.status} ${sv.goi.join(' ')}`)
        dung('sát giờ: không tạo đợt mới', !sv.goi.some(g => g.startsWith('create:')))
    }
    // ── 9. chủ shop huỷ đúng lúc máy đang thêm hàng ⇒ tắt + xoá đợt vừa bật, giữ 'cancelled' ──
    {
        const dong = planMau(); const sv = shopeeGia({ khiThemHang: () => { dong.status = 'cancelled' } })
        await activatePlan(prismaGia(dong), dong, {}, sv)
        dung('vẫn là cancelled (không lật thành active)', dong.status === 'cancelled', dong.status)
        dung('đợt vừa bật bị tắt rồi xoá', sv.goi.includes('status:9001:2') && sv.goi.includes('delete:9001'), sv.goi.join(' '))
    }
    // ── 10. Shopee từ chối hết ⇒ xoá đợt rỗng, bỏ id, ném lỗi để thử lại ──
    {
        const dong = planMau(); const sv = shopeeGia({ tuChoiHet: true })
        let thongBao = ''
        try { await activatePlan(prismaGia(dong), dong, {}, sv) } catch (e: any) { thongBao = e.message }
        dung('từ chối hết ⇒ lỗi nêu lời Shopee', /từ chối toàn bộ/.test(thongBao), thongBao.slice(0, 80))
        dung('từ chối hết ⇒ xoá đợt + bỏ id (lượt sau tạo mới sạch)', sv.goi.includes('delete:9001') && dong.shopeeFlashSaleId === null)
        dung('từ chối hết ⇒ chưa từng bật', !sv.goi.includes('status:9001:1'))
    }

    console.log(loi ? `\n✗ ${loi} ca SAI` : '\n✓ Tất cả ca đều đúng')
    process.exit(loi ? 1 : 0)
}
main().catch(e => { console.error(e); process.exit(1) })
