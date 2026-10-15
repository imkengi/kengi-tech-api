/* Kiểm chứng LUỒNG KÍCH HOẠT FLASH SALE (cron/flashSaleScheduler.ts → activatePlan, napVaBat) — 15/10/2026.
 *   npx tsx scripts/check-flash-sale.ts
 * Prisma giả (một dòng FlashSalePlan, hiểu đúng các câu UPDATE luồng này dùng) + Shopee giả (ghi lại mọi lời gọi).
 * Canh: giá "đang bán − 1đ" theo TỪNG phân loại; mã bị bỏ qua phải có lý do (không im lặng); đợt dở của lượt bị đứt thì
 * nhận lại hoặc dọn — KHÔNG tạo đợt thứ hai; chủ shop huỷ giữa chừng thì gỡ đợt vừa bật, không lật 'cancelled'. */
import { _kiemThu } from '../src/cron/flashSaleScheduler'
import { docDieuKienTheoNganh, kiemGiaFlashSale, phanTramGiam } from '../src/lib/flashSaleKiemGia'

const { activatePlan, napVaBat } = _kiemThu
let loi = 0
const dung = (ten: string, ok: boolean, chiTiet = '') => { if (!ok) loi++; console.log(`${ok ? '✓' : '✗'} ${ten}${chiTiet ? ' — ' + chiTiet : ''}`) }

type Sale = { status: number; item_count: number }
function shopeeGia(o: {
    sales?: [number, Sale][]; models?: Record<number, any[]>; modelLoi?: number[]
    getLoi?: boolean; deleteLoi?: boolean; tuChoiHet?: boolean; khiThemHang?: () => void
    /** get_item_base_info giả: item_id → bản ghi (has_model, price_info, stock_info_v2, category_id) */
    coSo?: Record<number, any>; dieuKien?: any
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
            goi.push(`add:${id}:${items.length}`); hangGui = items
            o.khiThemHang?.()
            const s = sales.get(id); if (s) s.item_count += items.length
            return { failedItems: o.tuChoiHet ? items.map(i => ({ item_id: i.item_id, err_code: 1, err_msg: 'Shopee từ chối' })) : [] }
        },
        async flashSaleUpdateStatus(id: number, st: number) { goi.push(`status:${id}:${st}`); const s = sales.get(id); if (s) s.status = st },
        async getItemBaseInfo(ids: number[]) {
            goi.push(`coSo:${ids.join(',')}`)
            if (!o.coSo) throw new Error('Shopee get_item_base_info: chưa giả')
            return ids.map(id => o.coSo![id] && { item_id: id, ...o.coSo![id] }).filter(Boolean)
        },
        async flashSaleItemCriteria() { goi.push('dieuKien'); return o.dieuKien || {} },
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
        dung('hết mã ⇒ ném lỗi kèm lý do từng mã', /Chưa có giá — Chưa có giá đang bán/.test(thongBao), thongBao)
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
