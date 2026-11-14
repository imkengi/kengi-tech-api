/**
 * check-ton-danh-muc-shopee — tồn listing Shopee khi đồng bộ danh mục (14/11/2026).
 *
 * Bệnh: OnlineProduct.stock = 0 cho mọi listing CÓ PHÂN LOẠI (get_item_base_info không có khoá stock_info_v2 / price_info với
 * has_model — đo 3 gian KENGISTORE: 198/510 listing, 110 còn hàng thật) + mã đang trong Flash Sale của shop lưu "tồn 1"
 * (summary_info.total_available_stock = số suất flash sale, seller_stock vẫn 73…).
 *
 *  A. tonNguoiBan: Σ seller_stock + shopee_stock, bỏ ô if_saleable=false; không có trường tồn ⇒ null (không phải 0).
 *  B. fetchProducts (Shopee giả qua httpGet): hàng có phân loại = Σ phân loại, giá vẫn 0 (cố ý), flash sale lấy tồn người bán,
 *     total = total_count của Shopee, song song ≤ LUONG_DOC_PHAN_LOAI, danh mục lành ⇒ KHÔNG cảnh báo (ca phải im).
 *  C. đọc phân loại hỏng ⇒ null + cảnh báo nguyên văn; D. hết hạn giờ ⇒ phần chưa đọc null + cảnh báo.
 *  E. lỗi: lời gọi đầu hỏng ⇒ ném nguyên văn; hỏng giữa chừng ⇒ giữ phần đã đọc + cảnh báo; gian trống ⇒ rỗng, im.
 *  F. trần an toàn số mã ⇒ nói ra.  G. luuDanhMucSan (prisma giả): null ⇒ KHÔNG đụng cột stock; 0 thật vẫn ghi được 0.
 *  H. getModelList: thêm tonNguoiBan, `stock` cũ (seller_stock[0]) giữ nguyên cho flash sale / lõi đẩy tồn.
 *
 * Không gọi mạng, không đụng CSDL. Chạy: npm run check:ton-danh-muc
 */
import { ShopeeService } from '../src/services/platforms/shopee'
import { tonNguoiBan, tonSanPham } from '../src/lib/flashSaleKiemGia'
import { luuDanhMucSan } from '../src/lib/shopeeTuQuan'
import type { PlatformProduct } from '../src/services/platforms/base'

let dat = 0, hong = 0
function ca(ten: string, dung: boolean, them = '') { if (dung) dat++; else { hong++; console.log(`  ✗ ${ten}${them ? ` — ${them}` : ''}`) } }

// ─── Hình dữ liệu đo thật 14/11/2026 (rút gọn) ───────────────────────────────────
const v2 = (seller: number | number[], them: any = {}) => ({
    summary_info: { total_reserved_stock: 0, total_available_stock: Array.isArray(seller) ? seller.reduce((a, b) => a + b, 0) : seller },
    seller_stock: (Array.isArray(seller) ? seller : [seller]).map(n => ({ location_id: 'VNZ', stock: n, if_saleable: true })),
    shopee_stock: [{ location_id: '', stock: 0 }],
    advance_stock: { sellable_advance_stock: 0, in_transit_advance_stock: 0 },
    ...them,
})
// Mã đang trong Flash Sale của shop: Shopee giữ 1 suất ⇒ available 1, seller vẫn nguyên
const v2FlashSale = (seller: number) => v2(seller, { summary_info: { total_reserved_stock: 1, total_available_stock: 1 } })
const maDon = (id: number, ton: any, gia = 250000, goc = 350000) => ({
    item_id: id, item_name: `Mã ${id}`, item_sku: `SKU${id}`, category_id: 101, item_status: 'NORMAL', has_model: false,
    image: { image_url_list: [`https://anh/${id}.jpg`] },
    price_info: [{ currency: 'VND', original_price: goc, current_price: gia }],
    ...(ton === undefined ? {} : { stock_info_v2: ton }),
})
// Hàng CÓ phân loại: base_info KHÔNG có stock_info_v2 / price_info (đo thật — khoá vắng hẳn)
const maPL = (id: number) => ({
    item_id: id, item_name: `PL ${id}`, item_sku: '', category_id: 102, item_status: 'NORMAL', has_model: true,
    image: { image_url_list: [`https://anh/${id}.jpg`] },
})
const phanLoai = (id: number, ton: any, gia = 32000) => ({
    model_id: id, model_name: `PL${id}`, model_sku: `M${id}`,
    price_info: [{ current_price: gia, original_price: gia + 5000, currency: 'VND' }],
    ...(ton === undefined ? {} : { stock_info_v2: ton }),
})

type San = {
    ds: any[]                                            // base_info theo thứ tự get_item_list
    models?: Record<number, any[] | { loi: any } | { nem: string }>
    treModelMs?: number
    hongList?: (offset: number) => any                   // trả object lỗi / ném
    hongBase?: boolean
}
class ShopeeGia extends ShopeeService {
    goi: string[] = []
    dangChay = 0
    chayCungLucToiDa = 0
    constructor(private san: San) { super({ apiKey: '2001234', apiSecret: 'bimat', accessToken: 'tok', shopId: '999' }) }
    protected async httpGet(url: string): Promise<any> {
        const u = new URL(url)
        const duong = u.pathname
        this.goi.push(duong.split('/').pop()!)
        if (duong.endsWith('/get_item_list')) {
            const offset = Number(u.searchParams.get('offset')), size = Number(u.searchParams.get('page_size'))
            const h = this.san.hongList?.(offset)
            if (h instanceof Error) throw h
            if (h) return h
            const lat = this.san.ds.slice(offset, offset + size)
            return { error: '', message: '', response: { item: lat.map(x => ({ item_id: x.item_id, item_status: 'NORMAL' })), total_count: this.san.ds.length, has_next_page: offset + size < this.san.ds.length } }
        }
        if (duong.endsWith('/get_item_base_info')) {
            if (this.san.hongBase) return { error: 'error_server', message: 'Hệ thống bận' }
            const ids = String(u.searchParams.get('item_id_list')).split(',').map(Number)
            return { error: '', response: { item_list: this.san.ds.filter(x => ids.includes(x.item_id)) } }
        }
        if (duong.endsWith('/get_model_list')) {
            const id = Number(u.searchParams.get('item_id'))
            this.dangChay++
            this.chayCungLucToiDa = Math.max(this.chayCungLucToiDa, this.dangChay)
            try {
                await new Promise(r => setTimeout(r, this.san.treModelMs ?? 2))
                const m: any = this.san.models?.[id]
                if (m && 'nem' in m) throw new Error(m.nem)
                if (m && 'loi' in m) return m.loi
                return { error: '', response: { model: m || [] } }
            } finally { this.dangChay-- }
        }
        throw new Error(`Shopee giả: chưa dựng ${duong}`)
    }
}
const theoMa = (ds: PlatformProduct[]) => new Map(ds.map(p => [p.platformProductId, p]))

async function main() {
    // ─── A. tonNguoiBan ──────────────────────────────────────────────────────────
    {
        ca('A1 mã trong Flash Sale (đo thật: Kìm Rút Rive seller 73 / available 1) ⇒ 73, còn tonSanPham ra 1',
            tonNguoiBan({ stock_info_v2: v2FlashSale(73) }) === 73 && tonSanPham({ stock_info_v2: v2FlashSale(73) }) === 1)
        ca('A2 seller + shopee_stock cộng lại', tonNguoiBan({ stock_info_v2: { seller_stock: [{ stock: 3 }], shopee_stock: [{ stock: 4 }] } }) === 7)
        ca('A3 bỏ ô if_saleable=false', tonNguoiBan({ stock_info_v2: { seller_stock: [{ stock: 5, if_saleable: false }, { stock: 7, if_saleable: true }] } }) === 7)
        ca('A4 không có mảng kho ⇒ summary', tonNguoiBan({ stock_info_v2: { summary_info: { total_available_stock: 9 } } }) === 9)
        ca('A5 trường bản API cũ current_stock vẫn đọc', tonNguoiBan({ stock_info_v2: { current_stock: 6 } }) === 6)
        ca('A6 KHÔNG có trường tồn nào ⇒ null (chưa biết), KHÔNG phải 0',
            tonNguoiBan({}) === null && tonNguoiBan({ stock_info_v2: {} }) === null && tonNguoiBan({ stock_info_v2: null }) === null && tonNguoiBan(undefined) === null)
        ca('A7 hết hàng THẬT vẫn là 0 (không lẫn với chưa biết)', tonNguoiBan({ stock_info_v2: v2(0) }) === 0)
        ca('A8 phân loại kiểu cũ stock_info là MẢNG', tonNguoiBan({ stock_info: [{ current_stock: 2 }, { normal_stock: 3 }] }) === 5)
        ca('A9 đối chứng: base_info hàng có phân loại (không khoá tồn) — tonSanPham cũ ra 0, tonNguoiBan ra null', tonSanPham(maPL(1)) === 0 && tonNguoiBan(maPL(1)) === null)
    }

    // ─── B. danh mục lành, 2 trang ───────────────────────────────────────────────
    {
        const ds: any[] = []
        ds.push(maDon(1001, v2FlashSale(73)))
        ds.push(maDon(1002, { seller_stock: [{ stock: 5, if_saleable: false }, { stock: 7, if_saleable: true }], summary_info: { total_available_stock: 7 } }))
        for (let i = 3; i <= 50; i++) ds.push(maDon(1000 + i, v2(i % 7)))
        ds.push(maPL(2001), maPL(2002), maPL(2003))
        const models: San['models'] = {
            // Bóng Đèn Led Bulb 6 phân loại, sống 1.959 — vài phân loại đang trong flash sale (available 1)
            2001: [phanLoai(1, v2(100)), phanLoai(2, v2FlashSale(200)), phanLoai(3, v2(300)), phanLoai(4, v2FlashSale(400)), phanLoai(5, v2(500)), phanLoai(6, v2(459))],
            2002: [phanLoai(7, v2(0)), phanLoai(8, v2(0))],
            2003: [phanLoai(9, { seller_stock: [{ stock: 3 }], shopee_stock: [{ stock: 4 }] })],
        }
        const s = new ShopeeGia({ ds, models })
        const kq = await s.fetchProducts()
        const m = theoMa(kq.products)
        ca('B1 đọc đủ 53 mã qua 2 trang, total = total_count Shopee', kq.products.length === 53 && kq.total === 53, `${kq.products.length}/${kq.total}`)
        ca('B2 danh mục lành ⇒ KHÔNG cảnh báo (ca phải im)', kq.canhBao === undefined, JSON.stringify(kq.canhBao))
        ca('B3 mã Flash Sale lưu tồn người bán 73 (không phải 1)', m.get('1001')?.stock === 73, String(m.get('1001')?.stock))
        ca('B4 bỏ kho if_saleable=false', m.get('1002')?.stock === 7)
        ca('B5 có phân loại: tồn = Σ phân loại (1.959 như đo thật), giá VẪN 0', m.get('2001')?.stock === 1959 && m.get('2001')?.price === 0, JSON.stringify(m.get('2001')))
        ca('B6 có phân loại mà mọi phân loại hết hàng THẬT ⇒ 0 (biết chắc, phải ghi được 0)', m.get('2002')?.stock === 0)
        ca('B7 phân loại có cả kho Shopee', m.get('2003')?.stock === 7)
        ca('B8 hàng không phân loại: giá đang bán, SKU, ảnh, ngành như cũ',
            m.get('1001')?.price === 250000 && m.get('1001')?.sku === 'SKU1001' && m.get('1001')?.imageUrl === 'https://anh/1001.jpg' && m.get('1001')?.categoryId === '101')
        ca('B9 hàng không phân loại tồn 0 THẬT vẫn là 0', m.get('1007')?.stock === 0)
        ca('B10 get_model_list chỉ gọi cho 3 mã có phân loại', s.goi.filter(g => g === 'get_model_list').length === 3, JSON.stringify(s.goi))
    }

    // ─── B'. song song có trần ───────────────────────────────────────────────────
    {
        const ds = Array.from({ length: 10 }, (_, i) => maPL(3000 + i))
        const models: San['models'] = {}
        for (const x of ds) models[x.item_id] = [phanLoai(x.item_id, v2(2))]
        const s = new ShopeeGia({ ds, models, treModelMs: 15 })
        const kq = await s.fetchProducts()
        ca(`B11 đọc phân loại song song nhưng ≤ ${ShopeeService.LUONG_DOC_PHAN_LOAI} lời gọi cùng lúc`,
            s.chayCungLucToiDa > 1 && s.chayCungLucToiDa <= ShopeeService.LUONG_DOC_PHAN_LOAI, String(s.chayCungLucToiDa))
        ca('B12 đủ 10 mã, mỗi mã tồn 2', kq.products.every(p => p.stock === 2) && kq.canhBao === undefined)
    }

    // ─── C. đọc phân loại hỏng ⇒ null + cảnh báo ─────────────────────────────────
    {
        const ds = [maPL(4001), maPL(4002), maPL(4003), maPL(4004), maPL(4005), maDon(4100, undefined)]
        const s = new ShopeeGia({
            ds, models: {
                4001: { loi: { error: 'error_item_not_found', message: 'Item not found' } },
                4002: { nem: 'fetch failed' },
                4003: [],
                4004: [phanLoai(1, v2(5)), phanLoai(2, undefined)],
                4005: [phanLoai(3, v2(8))],
            },
        })
        const kq = await s.fetchProducts()
        const m = theoMa(kq.products)
        ca('C1 phân loại đọc hỏng / rỗng / thiếu trường tồn ⇒ stock null, KHÔNG 0',
            ['4001', '4002', '4003', '4004'].every(id => m.get(id)?.stock === null), JSON.stringify(kq.products.map(p => [p.platformProductId, p.stock])))
        ca('C2 mã đọc được vẫn đúng', m.get('4005')?.stock === 8)
        ca('C3 cảnh báo đếm đúng 4/5 + lỗi Shopee nguyên văn',
            (kq.canhBao || []).some(c => /Không đọc được phân loại của 4\/5 mã/.test(c) && /(Item not found|fetch failed|rỗng|trường tồn)/.test(c)), JSON.stringify(kq.canhBao))
        ca('C4 hàng không phân loại không trả trường tồn ⇒ null + cảnh báo riêng',
            m.get('4100')?.stock === null && (kq.canhBao || []).some(c => /1 mã không phân loại .*không trả trường tồn/.test(c)), JSON.stringify(kq.canhBao))
    }

    // ─── D. hết hạn giờ ─────────────────────────────────────────────────────────
    {
        const ds = Array.from({ length: 12 }, (_, i) => maPL(5000 + i))
        const models: San['models'] = {}
        for (const x of ds) models[x.item_id] = [phanLoai(x.item_id, v2(4))]
        const s = new ShopeeGia({ ds, models, treModelMs: 50 })
        const kq = await s.fetchProducts({ hanDocPhanLoaiMs: 120 })
        const daDoc = kq.products.filter(p => p.stock === 4).length
        const chuaDoc = kq.products.filter(p => p.stock === null).length
        ca('D1 hết giờ giữa chừng: đọc được một phần, phần còn lại null (KHÔNG 0)',
            daDoc > 0 && daDoc < 12 && daDoc + chuaDoc === 12, `daDoc=${daDoc} chuaDoc=${chuaDoc}`)
        ca('D2 cảnh báo nói số mã chưa tới lượt', (kq.canhBao || []).some(c => new RegExp(`${chuaDoc}/12 mã có phân loại chưa tới lượt`).test(c)), JSON.stringify(kq.canhBao))
        const s0 = new ShopeeGia({ ds, models })
        const kq0 = await s0.fetchProducts({ hanDocPhanLoaiMs: 0 })
        ca('D3 hạn 0 (route /sync đã hết giờ) ⇒ không gọi get_model_list, 12/12 null + cảnh báo',
            s0.goi.every(g => g !== 'get_model_list') && kq0.products.every(p => p.stock === null)
            && (kq0.canhBao || []).some(c => /12\/12 mã có phân loại chưa tới lượt/.test(c)), JSON.stringify({ goi: s0.goi, cb: kq0.canhBao }))
    }

    // ─── E. lỗi lấy danh mục ─────────────────────────────────────────────────────
    {
        const ds = Array.from({ length: 53 }, (_, i) => maDon(6000 + i, v2(1)))
        let nem = ''
        try { await new ShopeeGia({ ds, hongList: () => ({ error: 'error_auth', message: 'Invalid access_token.' }) }).fetchProducts() } catch (e: any) { nem = String(e?.message) }
        ca('E1 get_item_list ĐẦU TIÊN hỏng ⇒ NÉM nguyên văn (không trả rỗng như gian trống)', /Shopee get_item_list: error_auth - Invalid access_token\./.test(nem), nem)

        const kq = await new ShopeeGia({ ds, hongList: off => off >= 50 ? new Error('fetch failed') : null }).fetchProducts()
        ca('E2 trang 2 hỏng ⇒ giữ 50 mã đã đọc + cảnh báo nguyên văn',
            kq.products.length === 50 && (kq.canhBao || []).some(c => /Dừng giữa chừng sau 50 mã: .*fetch failed/.test(c)), JSON.stringify({ n: kq.products.length, cb: kq.canhBao }))

        nem = ''
        try { await new ShopeeGia({ ds, hongBase: true }).fetchProducts() } catch (e: any) { nem = String(e?.message) }
        ca('E3 base_info trang đầu hỏng ⇒ NÉM nguyên văn', /Shopee get_item_base_info: error_server - Hệ thống bận/.test(nem), nem)

        const rong = await new ShopeeGia({ ds: [] }).fetchProducts()
        ca('E4 gian trống thật ⇒ rỗng, total 0, im', rong.products.length === 0 && rong.total === 0 && rong.canhBao === undefined, JSON.stringify(rong))
    }

    // ─── F. trần an toàn ─────────────────────────────────────────────────────────
    {
        const goc = ShopeeService.TRAN_MA_DANH_MUC
        ;(ShopeeService as any).TRAN_MA_DANH_MUC = 50
        try {
            const ds = Array.from({ length: 53 }, (_, i) => maDon(7000 + i, v2(1)))
            const kq = await new ShopeeGia({ ds }).fetchProducts()
            ca('F1 chạm trần ⇒ dừng VÀ nói ra kèm tổng Shopee báo', kq.products.length === 50 && kq.total === 53
                && (kq.canhBao || []).some(c => /Dừng ở 50 mã \(trần an toàn mỗi lượt\) — Shopee báo 53 mã/.test(c)), JSON.stringify(kq.canhBao))
        } finally { (ShopeeService as any).TRAN_MA_DANH_MUC = goc }
    }

    // ─── G. luuDanhMucSan trên prisma giả ───────────────────────────────────────
    {
        const ghi: any[] = []
        const pz = { onlineProduct: { upsert: async (a: any) => { ghi.push(a) } } }
        const sp = (id: string, stock: number | null, price = 0): PlatformProduct => ({ platformProductId: id, name: `SP ${id}`, sku: id, price, stock, status: 'NORMAL' })
        const n = await luuDanhMucSan(pz, { id: 'ch1', platform: 'shopee' }, [sp('A', null), sp('B', 0), sp('C', 1959), sp('D', 7, 250000)])
        const g = new Map(ghi.map(x => [x.where.channelId_platformProductId.platformProductId, x]))
        ca('G1 tồn chưa biết ⇒ update KHÔNG có khoá stock (giữ số cũ), create cũng không (mặc định cột)',
            n === 4 && !('stock' in g.get('A').update) && !('stock' in g.get('A').create), JSON.stringify(g.get('A')))
        ca('G2 tồn 0 THẬT vẫn ghi được 0 (nhánh cập nhật sửa được về 0)', g.get('B').update.stock === 0 && g.get('B').create.stock === 0)
        ca('G3 tồn có phân loại ghi Σ', g.get('C').update.stock === 1959 && g.get('C').update.price === 0)
        ca('G4 các cột khác như cũ (giá, tên, syncedAt)', g.get('D').update.price === 250000 && g.get('D').update.name === 'SP D' && g.get('D').update.syncedAt instanceof Date)
    }

    // ─── H. getModelList giữ nghĩa `stock` cũ ────────────────────────────────────
    {
        const s = new ShopeeGia({ ds: [], models: { 8001: [phanLoai(1, { seller_stock: [{ stock: 3 }, { stock: 4 }], summary_info: { total_available_stock: 1 } })] } })
        const [m] = await s.getModelList(8001)
        ca('H1 getModelList: stock = seller_stock[0] như cũ (flash sale / lõi đẩy tồn), tonNguoiBan = Σ kho', m?.stock === 3 && m?.tonNguoiBan === 7, JSON.stringify(m))
    }

    console.log(`\n${dat}/${dat + hong} ca đạt`)
    if (hong) process.exitCode = 1
}
main().catch(e => { console.error(e); process.exitCode = 1 })
