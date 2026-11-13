// ═══════════════════════════════════════════════════════════════════════════════
//  ĐẨY TỒN KHO LÊN SÀN — lõi dùng chung
//
//  Tách khỏi `POST /online-orders/channels/:id/push-stock` (11/09/2026) để bộ đo
//  của admin gọi được ĐÚNG đường mà nút trên web gọi. Chủ shop muốn thử 1 SKU mà
//  đường kia đòi đăng nhập cửa hàng; viết bản thứ hai cho admin là cách chắc chắn
//  nhất để hai bên đẩy ra hai con số khác nhau — đúng bệnh "hai router cùng đường".
//
//  ⚠ ĐÂY LÀ THAO TÁC KHÔNG CÓ ĐƯỜNG LUI: gọi thẳng API sàn, đẩy nhầm số 0 là khoá
//  sạch hàng đang bán. Vì vậy có `dryRun` tính y hệt lượt thật nhưng không GHI gì lên
//  sàn (từ 10/11/2026 có ĐỌC phân loại + tồn đang bán — xem "TỪNG PHÂN LOẠI" dưới).
//
//  HAI LƯỢT + CẦU DAO CHUNG (09/11/2026): lượt 1 tính tồn cần đẩy cho MỌI listing
//  (chưa gọi sàn), cầu dao soát trên TOÀN BỘ, lượt 2 mới đẩy. Trước đó vòng lặp vừa
//  tính vừa đẩy — không có chỗ dừng trước lần ghi đầu; cầu dao chỉ có ở Pilot và chỉ
//  thấy 300 dòng đầu của bảng chạy thử; nút "Đẩy tồn kho lên sàn" không có cầu dao
//  nào. Sửa đọc tồn Shopee (services/platforms/shopee.ts — trước lưu 0 ở mọi listing)
//  mà nút tay chưa có cầu dao thì MỘT lần bấm ở KENGISTORE (kho mẹ đang tắt, hàng thật
//  nằm ở HUTI) đưa ~438/709 listing về 0. Nay mọi đường — nút tay, /admin/day-ton-thu,
//  Pilot — qua cùng cầu dao; chỉ người bấm nút tay vượt được, bằng cờ chapNhanVeKhong.
//
//  TỪNG PHÂN LOẠI (10/11/2026, SP-06 / TT-08): CSDL chỉ có MỘT dòng OnlineProduct mỗi
//  listing (Shopee lưu item_sku, TikTok lưu seller_sku của SKU ĐẦU + tồn TỔNG mọi SKU).
//  Trước: Shopee chỉ đẩy đúng một phân loại khớp SKU listing — phân loại mang mã kho khác
//  KHÔNG BAO GIỜ được đẩy (bán hết trong kho mà sàn vẫn còn hàng ⇒ bán quá); TikTok ghi
//  tồn SKU đầu rồi đè số đó lên tồn TỔNG của listing, cầu dao so tổng với SKU đầu.
//  Nay lượt 0 ĐỌC sàn (chạy thử cũng đọc — bảng xem trước phải bằng thứ sẽ đẩy): Shopee
//  get_item_base_info lô 50 mã (has_model + tồn đang bán) rồi get_model_list cho hàng có
//  phân loại; TikTok products/search cả gian. Listing nhiều phân loại ⇒ MỖI phân loại
//  một dòng: tra kho theo SKU của phân loại, đẩy đúng model_id / sku_id. Phân loại không
//  tra ra mã kho thì BỎ QUA và liệt kê — không bao giờ đẩy 0 cho thứ không biết là gì.
//  Đọc hỏng ⇒ listing đó rơi về cách cũ, có ghi chú.
//
//  LAZADA (13/11/2026, chủ shop duyệt "kéo sản phẩm + đẩy tồn"): lượt 0 đọc GetProducts cả gian (SkuId, SellerSku, tồn đang
//  bán từng SKU), lượt 2 ghi UpdateSellableQuantity từng SKU. KHÔNG có cách cũ: đọc hỏng / listing không thấy trên sàn ⇒ bỏ
//  qua, nói lý do (DocSan.batBuocDoc). SKU nằm ở nhiều kho Lazada ⇒ bỏ qua (đo 13/11: mọi SKU một kho). Cùng cầu dao.
// ═══════════════════════════════════════════════════════════════════════════════

import { getPlatformService } from '../services/platforms'
import { LazadaService } from '../services/platforms/lazada'
import { tonSanPham } from './flashSaleKiemGia'
import type { KhoMe } from './khoMe'

export interface ThamSoDayTon {
    dryRun?: boolean
    /** Chỉ đẩy đúng mấy listing này. Trống = cả kênh. */
    onlineProductIds?: string[]
    /** Bỏ qua bước "tồn sàn đã bằng tồn cần đẩy thì thôi". */
    force?: boolean
    /** Người bấm nút tay đã xem chạy thử và tích "vẫn đẩy các mã về 0" (09/11/2026) ⇒ cầu dao nhảy vẫn đẩy.
     *  CHỈ route push-stock truyền. Pilot (shopeePilot.dayTonChuKy) KHÔNG BAO GIỜ truyền: máy không được tự
     *  nhận rủi ro khoá sạch hàng đang bán — cầu dao nhảy thì chờ người. */
    chapNhanVeKhong?: boolean
    /** Số mã về 0 người bấm ĐÃ THẤY ở lượt chạy thử (data.veKhong) — bắt buộc đi kèm chapNhanVeKhong (09/11/2026): đồng ý
     *  là đồng ý với con số đã xem. Tồn đổi giữa lúc xem và lúc bấm làm thêm mã về 0 ⇒ 409, phải xem lại; thiếu số ⇒ coi
     *  như chưa đồng ý. */
    veKhongDaXem?: number
    /** Bản đọc sàn (LƯỢT 0) của lượt chạy thử NGAY TRƯỚC — `KetQuaDayTon.docSan` (10/11/2026). CHỈ Pilot truyền
     *  (shopeePilot.dayTonChuKy): chu kỳ tự động chạy thử rồi chạy thật cách nhau vài giây, đọc sàn lần hai là gấp đôi lời
     *  gọi (≤ 15 lô base_info + ≤ 200 get_model_list mỗi gian, qua proxy IP tĩnh) mà không thêm gì. Nút tay KHÔNG truyền:
     *  người bấm xem trước rồi có khi mấy phút sau mới bấm ⇒ lượt thật đọc lại cho tồn sàn mới. Chạy thử bỏ qua trường này. */
    docSanTruoc?: DocSan
    /** CHỈ cho bộ kiểm (scripts/check-pilot-tu-dong.ts, mục N) — route và Pilot không bao giờ truyền: dịch vụ
     *  sàn giả thay getPlatformService (không làm mới token, không giãn nhịp 300ms) và kho mẹ giả thay moKhoMe
     *  (bỏ trống = không có kho mẹ) — để bộ kiểm không chạm registry / CSDL thật. */
    giaLap?: { dichVu: any; khoMe?: KhoMe | null }
}

/**
 * Kết quả trả về route (09/11/2026):
 *  - chạy thử: data = { chayThu, seDay, seBoQua, [khoMe, boQuaViKhongCoOKhoMe, viDuBoQua], cauDao (string|null), veKhong,
 *    coHangTrenSan, viDuVeKhong (≤ 20 { sku, tenSan, tonDangTrenSan }), bang (≤ 300 dòng), ghiChu }
 *  - cầu dao chặn chạy thật: http 409, ok false, loi 'CẦU DAO — không đẩy tồn: …', data = { cauDao, veKhong, coHangTrenSan, viDuVeKhong }
 *  - chạy thật: data = { pushed, skipped, failed, errors, veKhong, [cauDao khi người bấm đã vượt], [khoMe…] }
 *  - 10/11/2026, cả hai lượt: [phanLoai { soListing, soDong, boQua, viDuBoQua (≤ 10) }] khi có hàng nhiều phân loại,
 *    [docSan (ghi chú đọc sàn hỏng / bỏ đọc)]. Dòng bảng của một phân loại mang thêm `phanLoai` (tên phân loại).
 */
export interface KetQuaDayTon {
    http: number
    ok: boolean
    loi?: string
    data?: any
    /** Chạy thử ĐÃ đọc sàn ⇒ bản đọc đó, để Pilot đưa lại cho lượt thật (ThamSoDayTon.docSanTruoc). Không có khi chạy thử
     *  bỏ đọc vì token sắp hết — lượt thật làm mới token rồi tự đọc. Ngoài `data`: route chỉ gửi `data` ra trình duyệt.
     *  (Khác `data.docSan` — mảng ghi chú đọc sàn hỏng / bỏ đọc cho người xem.) */
    banDocSan?: DocSan
}

/**
 * Đẩy tồn MỘT listing Shopee, tự xử hàng CÓ PHÂN LOẠI.
 *
 * Đo 11/09/2026: listing SHD1072 (item 16994673670) có HAI phân loại mang HAI mã
 * kho khác nhau — "Hồng" sku SHD1072 và "Tím" sku SHD2011. Shopee bắt buộc gửi
 * `model_id` cho hàng kiểu này, gửi thiếu thì trả
 * "model_id is mandatory if item is under model level" và KHÔNG đẩy được gì.
 *
 * Vì sao thử trước rồi mới hỏi phân loại, thay vì luôn hỏi: hàng KHÔNG phân loại
 * chiếm phần lớn và chúng đẩy được ngay; hỏi danh sách phân loại cho cả 709 listing
 * là 709 lời gọi thừa, đủ để chạm trần tần suất của Shopee.
 *
 * Ghép phân loại CHỈ theo SKU, và chỉ nhận khi khớp DUY NHẤT. Đẩy tồn vào nhầm
 * phân loại là sai tồn của một mặt hàng KHÁC — ở đây là SHD2011 — nên thà báo lỗi
 * còn hơn đoán.
 */
async function dayTonShopee(service: any, p: any, local: any, targetStock: number): Promise<void> {
    try {
        await service.updateStock(p.platformProductId, targetStock)
        return
    } catch (e: any) {
        if (!/model_id is mandatory|under model level/i.test(String(e?.message || ''))) throw e
    }

    const models: any[] = await service.getModelList(Number(p.platformProductId))
    if (models.length === 0) {
        throw new Error('Shopee đòi model_id nhưng get_model_list trả rỗng — không rõ phân loại, không đẩy')
    }

    const canhSku = [String(p.sku || '').trim().toLowerCase(), String(local?.sku || '').trim().toLowerCase()]
        .filter(Boolean)
    const khop = models.filter(m => canhSku.includes(String(m.sku || '').trim().toLowerCase()))

    let modelId: number | null = null
    if (khop.length === 1) modelId = khop[0].model_id
    else if (khop.length === 0 && models.length === 1) modelId = models[0].model_id

    if (!modelId) {
        const mota = models.map(m => `${m.sku || '(không mã)'}→${m.model_id}`).join(', ')
        throw new Error(khop.length > 1
            ? `SKU "${p.sku || local?.sku}" khớp ${khop.length} phân loại (${mota}) — KHÔNG đoán, phải khai tay`
            : `listing có ${models.length} phân loại (${mota}), không cái nào mang SKU "${p.sku || local?.sku}" — KHÔNG đoán, phải khai tay`)
    }
    await service.updateStock(p.platformProductId, targetStock, modelId)
}

/** Một phân loại đọc SỐNG trên sàn — Shopee model / TikTok SKU / Lazada SKU. `id` = model_id / sku_id / SkuId.
 *  `chan` (Lazada, 13/11/2026): lý do KHÔNG được đẩy phân loại này (vd SKU nằm ở nhiều kho Lazada) — lượt 1 bỏ qua, ghi lý do. */
interface PhanLoaiSan { id: string; sku: string; ten: string; ton: number; chan?: string }

/** Lượt 0. Listing không có mặt ở cả hai bảng ⇒ đi cách cũ: tồn sàn = số lưu lần đồng bộ cuối, Shopee thử đẩy trơn rồi mới
 *  hỏi phân loại (dayTonShopee), TikTok ghép SKU theo seller_sku đã lưu. LAZADA KHÔNG có cách cũ (13/11/2026): không đọc ra
 *  thì không đẩy — xem `batBuocDoc`. */
interface DocSan {
    /** listing CÓ PHÂN LOẠI (Shopee has_model; TikTok / Lazada ≥ 2 SKU) — mã sàn → mọi phân loại */
    phanLoai: Map<string, PhanLoaiSan[]>
    /** listing một SKU — mã sàn → tồn đang bán (+ sku_id TikTok / SkuId Lazada: lúc ghi khỏi hỏi lại; + SellerSku Lazada
     *  đọc sống; + `chan` như PhanLoaiSan) */
    don: Map<string, { ton: number; skuId?: string; sku?: string; chan?: string }>
    ghiChu: string[]
    /** Lazada: listing KHÔNG có trong hai bảng trên thì BỎ QUA (không rơi về cách cũ) — đẩy Lazada mới viết 13/11/2026, chưa
     *  có "lần đồng bộ cuối" đáng tin để so, và hàng nhiều SKU đi cách cũ là đẩy nhầm tồn một SKU lên cả listing. */
    batBuocDoc?: boolean
}

/** Mỗi lượt đọc get_model_list cho tối đa chừng này listing có phân loại (mỗi listing một lời gọi); phần dư đi cách cũ. */
export const TRAN_DOC_PHAN_LOAI = 200

const chuanSku = (s: any) => String(s ?? '').trim().toLowerCase()
const tenPhanLoaiTikTok = (s: any) =>
    (Array.isArray(s?.sales_attributes) ? s.sales_attributes.map((a: any) => a?.value_name).filter(Boolean).join(' / ') : '')
    || String(s?.seller_sku || s?.id || '')

/**
 * LƯỢT 0 — CHỈ ĐỌC sàn: phân loại + tồn đang bán của các listing sắp đẩy (10/11/2026, SP-06 / TT-08).
 * Shopee: get_item_base_info lô 50 mã (has_model; tồn của hàng không phân loại) → get_model_list từng mã có phân loại.
 * TikTok: products/search cả gian (100 sản phẩm/lời gọi, mỗi dòng mang đủ skus[]). Hỏng chỗ nào thì chỗ đó đi cách cũ và
 * nói ra trong ghiChu — KHÔNG chặn cả lượt: cách cũ vẫn đẩy đúng hàng một phân loại.
 */
async function docPhanLoaiSan(service: any, platform: string, ds: any[], nghi: (ms: number) => Promise<void>): Promise<DocSan> {
    const kq: DocSan = { phanLoai: new Map(), don: new Map(), ghiChu: [], ...(platform === 'lazada' ? { batBuocDoc: true } : {}) }
    if (!ds.length) return kq
    const loi = (e: any) => String(e?.message || e).slice(0, 160)

    if (platform === 'lazada') {
        /* Lazada (13/11/2026): GetProducts cả gian (50 mã / lời gọi, mỗi mã mang đủ skus[]). Đọc hỏng ⇒ KHÔNG đẩy mã nào
         * (batBuocDoc) — lỗi Lazada nguyên văn vào ghi chú. Đọc được ⇒ mỗi SKU: SkuId + SellerSku + tồn đang bán; SKU nằm ở
         * nhiều kho Lazada thì chặn (UpdateSellableQuantity khi đó đòi mã kho — không đoán kho). */
        const khongDay = 'không đẩy mã Lazada nào (thiếu tồn đang bán để so và mã SKU để ghi)'
        if (typeof service.docSanPhamTho !== 'function') { kq.ghiChu.push(`Không đọc được danh mục Lazada — ${khongDay}.`); return kq }
        let doc: { items: any[]; catTai?: string }
        try { doc = await service.docSanPhamTho() } catch (e: any) {
            kq.ghiChu.push(`Không đọc được danh mục Lazada (${loi(e)}) — ${khongDay}.`)
            return kq
        }
        const can = new Set(ds.map(p => String(p.platformProductId)))
        const nhieuKho: string[] = []
        for (const r of doc.items || []) {
            const id = String(r?.item_id ?? '')
            if (!can.has(id)) continue
            const skus: PhanLoaiSan[] = (Array.isArray(r.skus) ? r.skus : []).map((s: any) => {
                const soKho = LazadaService.khoCuaSku(s).length
                const chan = soKho > 1 ? `SKU nằm ở ${soKho} kho Lazada — chưa hỗ trợ đẩy theo từng kho, không đoán kho` : undefined
                if (chan) nhieuKho.push(String(s?.SellerSku ?? s?.SkuId ?? id))
                return {
                    id: String(s?.SkuId ?? ''), sku: String(s?.SellerSku ?? '').trim(), ten: LazadaService.tenPhanLoaiSku(s),
                    ton: LazadaService.tonDangBanSku(s), ...(chan ? { chan } : {}),
                }
            }).filter((s: PhanLoaiSan) => s.id || s.sku)
            if (skus.length > 1) kq.phanLoai.set(id, skus)
            else if (skus.length === 1) {
                const s = skus[0]!
                kq.don.set(id, { ton: s.ton, ...(s.id ? { skuId: s.id } : {}), ...(s.sku ? { sku: s.sku } : {}), ...(s.chan ? { chan: s.chan } : {}) })
            }
        }
        const khongThay = ds.filter(p => !kq.phanLoai.has(String(p.platformProductId)) && !kq.don.has(String(p.platformProductId)))
        if (khongThay.length) {
            kq.ghiChu.push(`${khongThay.length} mã có trong Kengi nhưng KHÔNG thấy trên Lazada lúc đọc (đã xoá / chưa duyệt / ${doc.catTai ? doc.catTai : 'chưa đồng bộ lại danh mục'})`
                + ` — giữ nguyên, không đẩy: ${khongThay.slice(0, 5).map(p => p.sku || p.platformProductId).join(', ')}${khongThay.length > 5 ? '…' : ''}.`)
        }
        if (nhieuKho.length) {
            kq.ghiChu.push(`${nhieuKho.length} SKU nằm ở nhiều kho Lazada — chưa hỗ trợ đẩy theo từng kho, giữ nguyên: ${nhieuKho.slice(0, 5).join(', ')}${nhieuKho.length > 5 ? '…' : ''}.`)
        }
        return kq
    }

    if (platform === 'tiktok') {
        const cachCu = 'tồn sàn theo lần đồng bộ cuối, hàng nhiều SKU chỉ đẩy SKU đã lưu (SKU đầu)'
        if (typeof service.timSanPhamTho !== 'function') { kq.ghiChu.push(`Không đọc được danh mục TikTok — ${cachCu}.`); return kq }
        let rows: any[]
        try { rows = await service.timSanPhamTho() } catch (e: any) {
            kq.ghiChu.push(`Không đọc được danh mục TikTok (${loi(e)}) — ${cachCu}.`)
            return kq
        }
        const can = new Set(ds.map(p => String(p.platformProductId)))
        for (const r of rows || []) {
            const id = String(r?.id ?? '')
            if (!can.has(id)) continue
            const skus: PhanLoaiSan[] = (Array.isArray(r.skus) ? r.skus : []).map((s: any) => ({
                id: String(s?.id ?? ''), sku: String(s?.seller_sku ?? '').trim(), ten: tenPhanLoaiTikTok(s),
                ton: (Array.isArray(s?.inventory) ? s.inventory : []).reduce((t: number, k: any) => t + (Number(k?.quantity) || 0), 0),
            })).filter((s: PhanLoaiSan) => s.id)
            if (skus.length > 1) kq.phanLoai.set(id, skus)
            else if (skus.length === 1) kq.don.set(id, { ton: skus[0]!.ton, skuId: skus[0]!.id })
        }
        return kq
    }

    // Shopee
    const cachCu = 'tồn sàn theo lần đồng bộ cuối, hàng có phân loại chỉ đẩy phân loại mang SKU của listing'
    if (typeof service.getItemBaseInfo !== 'function' || typeof service.getModelList !== 'function') {
        kq.ghiChu.push(`Không đọc được phân loại Shopee — ${cachCu}.`)
        return kq
    }
    const ids = [...new Set(ds.map(p => Number(p.platformProductId)).filter(n => Number.isFinite(n) && n > 0))]
    const coModel: number[] = []
    let hong = 0, loiDau = ''
    for (let i = 0; i < ids.length; i += 50) {
        const lo = ids.slice(i, i + 50)
        try {
            for (const x of (await service.getItemBaseInfo(lo)) || []) {
                if (x?.item_id == null) continue
                if (x.has_model) coModel.push(Number(x.item_id))
                else kq.don.set(String(x.item_id), { ton: tonSanPham(x) })
            }
        } catch (e: any) { hong += lo.length; loiDau ||= loi(e) }
        await nghi(200)
    }
    if (hong) kq.ghiChu.push(`Không đọc được ${hong}/${ids.length} mã trên Shopee (${loiDau}) — các mã đó ${cachCu}.`)

    hong = 0; loiDau = ''
    for (const itemId of coModel.slice(0, TRAN_DOC_PHAN_LOAI)) {
        try {
            const ms: any[] = (await service.getModelList(itemId)) || []
            if (ms.length) {
                kq.phanLoai.set(String(itemId), ms.map(m => ({
                    id: String(m.model_id), sku: String(m.sku ?? '').trim(), ten: String(m.name ?? ''), ton: Number(m.stock) || 0,
                })))
            } else { hong++; loiDau ||= 'get_model_list trả rỗng' }
        } catch (e: any) { hong++; loiDau ||= loi(e) }
        await nghi(200)
    }
    if (coModel.length > TRAN_DOC_PHAN_LOAI) {
        kq.ghiChu.push(`${coModel.length - TRAN_DOC_PHAN_LOAI}/${coModel.length} mã có phân loại vượt trần đọc ${TRAN_DOC_PHAN_LOAI} mã mỗi lượt — các mã đó ${cachCu}.`)
    }
    if (hong) kq.ghiChu.push(`Không đọc được phân loại của ${hong} mã (${loiDau}) — các mã đó ${cachCu}.`)
    return kq
}

const CHON_HANG = { id: true, sku: true, stock: true, mergedIntoId: true, mergedRate: true }

/**
 * Tra hàng kho cho MỘT mã bán trên sàn: link sẵn → khớp SKU → BẢNG ÁNH XẠ → mã ĐÃ GỘP. `rate` = số ĐƠN VỊ GỐC trong 1 đơn
 * vị bán trên sàn (1 vỉ = 10 cái). Thiếu bước ánh xạ thì phân loại có mã riêng (combo/vỉ) không bao giờ đẩy được tồn, và im
 * lặng bỏ qua nên rất khó phát hiện. Link sẵn (include của listing) không chọn mergedIntoId ⇒ không đi theo mã gộp — giữ
 * nguyên như trước khi tách hàm (10/11/2026) để listing đã link đẩy đúng số như cũ.
 */
async function traHangKho(prisma: any, sku: string | null | undefined, link: any): Promise<{ local: any; rate: number } | null> {
    let local: any = link || null
    let rate = 1
    if (!local && sku) {
        local = await prisma.product.findFirst({ where: { sku }, select: CHON_HANG })
    }
    if (!local && sku) {
        const m = await prisma.skuMapping.findFirst({
            where: { platformSku: { equals: sku, mode: 'insensitive' } },
        }).catch(() => null)
        if (m?.productId) {
            rate = Number((m as any).conversionRate) || 1
            local = await prisma.product.findUnique({ where: { id: m.productId }, select: CHON_HANG })
        }
    }
    // Mã ĐÃ GỘP: tồn nằm ở mã đích, quy đổi theo hệ số đã ghi
    if (local?.mergedIntoId) {
        rate *= Number(local.mergedRate) || 1
        local = await prisma.product.findUnique({ where: { id: local.mergedIntoId }, select: CHON_HANG })
    }
    return local ? { local, rate } : null
}

/** Dòng bảng đẩy tồn có hàng trên sàn — gốc của tỷ lệ cầu dao. */
const coHangSan = (x: any) => Number(x?.tonDangTrenSan) > 0
/** Dòng sẽ đẩy (không bỏ qua) mà đưa một mã ĐANG CÓ HÀNG trên sàn về 0. */
const seVeKhong = (x: any) => !x?.boQua && Number(x?.seDay) === 0 && coHangSan(x)

/**
 * Cầu dao đẩy tồn (03/11/2026): lượt đẩy làm NHIỀU mã đang có hàng trên sàn về 0 thì gần như chắc là tồn kho sai chỗ chứ
 * không phải bán hết — đo KENGISTORE: TikTok 117 mã sẽ về 0 vì hàng nằm ở kho HUTI mà kho mẹ đang tắt.
 * Ngưỡng ≥ max(5, 15%) số mã đang có hàng trên sàn; bán hết lẻ tẻ vẫn đẩy bình thường. null = cho đẩy.
 * 09/11/2026: chuyển từ shopeePilot.ts về lõi đẩy tồn (shopeePilot re-export cho người gọi cũ) — lõi soát trên TOÀN BỘ
 * listing trước khi gọi sàn, nút tay cũng qua đây. Ngữ nghĩa + chữ giữ nguyên: "đẩy tay ở Kênh bán online" giờ là chạy thử,
 * xem ví dụ, tích xác nhận.
 */
export function cauDaoTon(bang: any[]): string | null {
    const ds = Array.isArray(bang) ? bang : []
    const coHang = ds.filter(coHangSan).length
    const veKhong = ds.filter(seVeKhong)
    if (veKhong.length < Math.max(5, Math.ceil(coHang * 0.15))) return null
    return `${veKhong.length}/${coHang} mã đang có hàng trên sàn sẽ về 0 (vd ${veKhong.slice(0, 4).map(x => `${x.sku} ${x.tonDangTrenSan}→0`).join(', ')}) — ` +
        'thường là tồn kho sai chỗ (hàng nằm ở kho khác / kho mẹ đang tắt). Kiểm rồi đẩy tay ở Kênh bán online.'
}

export async function dayTonLenSan(prisma: any, channelId: string, ts: ThamSoDayTon = {}): Promise<KetQuaDayTon> {
    const channel = await prisma.onlineChannel.findUnique({ where: { id: channelId } })
    if (!channel) return { http: 404, ok: false, loi: 'Kênh không tồn tại' }
    // Lazada từ 13/11/2026 (UpdateSellableQuantity, từng SKU) — chỉ qua nút tay / admin; chưa có Pilot Lazada nào gọi lõi này
    if (!['shopee', 'tiktok', 'lazada'].includes(channel.platform)) {
        return { http: 400, ok: false, loi: `Nền tảng ${channel.platform} chưa hỗ trợ đẩy tồn kho` }
    }
    if (!channel.accessToken) return { http: 400, ok: false, loi: 'Kênh chưa kết nối API (thiếu access token)' }

    const giaLap = ts.giaLap
    const service = (giaLap ? giaLap.dichVu : getPlatformService(channel.platform, {
        apiKey: channel.apiKey || '', apiSecret: channel.apiSecret || '',
        accessToken: channel.accessToken || undefined,
        refreshToken: channel.refreshToken || undefined,
        shopId: channel.shopId || undefined,
    })) as any
    if (!service) return { http: 400, ok: false, loi: 'Nền tảng chưa được hỗ trợ' }

    const chayThu = ts.dryRun === true
    const force = ts.force === true

    const where: any = { channelId: channel.id }
    if (Array.isArray(ts.onlineProductIds) && ts.onlineProductIds.length > 0) {
        where.id = { in: ts.onlineProductIds.map(String) }
    }

    const onlineProducts = await prisma.onlineProduct.findMany({
        where,
        include: { localProduct: { select: { id: true, sku: true, stock: true } } },
    })

    let pushed = 0, skipped = 0, failed = 0
    const errors: string[] = []

    /* Kho mẹ mở MỘT LẦN cho cả lượt: `moKhoMe` tra registry, gọi trong vòng lặp
     * 700 listing là 700 truy vấn thừa. Đơn treo cũng gộp sẵn một lượt. */
    const { moKhoMe, timHangMe: timHangMeFn, donTreoTheoSku } = await import('./khoMe')
    const khoMe = giaLap ? (giaLap.khoMe ?? null) : await moKhoMe(prisma)
    const donTreo = khoMe ? await donTreoTheoSku(prisma) : new Map<string, number>()
    const boQuaKhoMe: string[] = []
    if (khoMe) console.log(`[push-stock] ${channel.name}: lấy tồn từ kho mẹ ${khoMe.ma}, trừ ${donTreo.size} mã có đơn treo`)

    /* Token làm mới TRƯỚC lượt 0 (đệm 5 phút) — lượt 0 đọc sàn bằng chính token này. CHỈ chạy thật: chạy thử không ghi gì,
     * kể cả token ⇒ token sắp hết thì chạy thử khỏi đọc sàn (bảng đi cách cũ, nói rõ trong docSan); lượt thật làm mới rồi đọc,
     * khác số về 0 thì cầu dao 409 bắt xem lại như mọi lần tồn đổi giữa hai lượt. */
    const tokenExpiresAt = (channel as any).tokenExpiresAt
    const tokenSapHet = !giaLap && !!tokenExpiresAt && new Date(tokenExpiresAt).getTime() < Date.now() + 5 * 60 * 1000
    if (tokenSapHet && !chayThu) {
        try {
            const tokens = await service.refreshAccessToken()
            service.credentials.accessToken = tokens.accessToken
            service.credentials.refreshToken = tokens.refreshToken
            await prisma.onlineChannel.update({
                where: { id: channel.id },
                data: { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, tokenExpiresAt: new Date(Date.now() + tokens.expiresIn * 1000) },
            })
        } catch (e: any) { console.warn('[push-stock] Token refresh failed:', e.message) }
    }
    // Giãn nhịp giữa hai lời gọi sàn để không chạm trần tần suất (sàn giả của bộ kiểm không có trần)
    const nghi = (ms: number) => giaLap ? Promise.resolve() : new Promise<void>(r => setTimeout(r, ms))

    /* LƯỢT 0 — CHỈ ĐỌC sàn: phân loại + tồn đang bán (10/11/2026). Chạy thử cũng đọc: bảng xem trước phải bằng thứ sẽ đẩy.
     * Lượt thật của Pilot dùng lại bản đọc của lượt chạy thử ngay trước (docSanTruoc) — khỏi gọi sàn lần hai. */
    const boDocViToken = tokenSapHet && chayThu
    const docSan: DocSan = !chayThu && ts.docSanTruoc
        ? ts.docSanTruoc
        : boDocViToken
            ? {
                phanLoai: new Map(), don: new Map(), ...(channel.platform === 'lazada' ? { batBuocDoc: true } : {}),
                ghiChu: ['Token sàn sắp hết hạn — chạy thử không làm mới token nên chưa đọc phân loại / tồn đang bán trên sàn; lượt chạy thật làm mới token rồi đọc.'],
            }
            : await docPhanLoaiSan(service, channel.platform, onlineProducts, nghi)

    /** Tồn nguồn của một hàng kho. KHO MẸ — cửa hàng mượn tồn của cửa hàng khác thì đẩy TỒN BÊN ĐÓ: tồn mẹ − ĐƠN TREO bên
     *  này (chủ shop chốt 10/09/2026). null = không tra ra hàng bên mẹ ⇒ BỎ QUA, KHÔNG rơi về tồn kho con: tồn con ở cửa
     *  hàng mượn kho là 0/âm, đẩy lên là khoá sạch hàng đang bán. */
    const tonNguonCua = async (local: any): Promise<{ ton: number; treo: number } | null> => {
        if (!khoMe) return { ton: local.stock || 0, treo: 0 }
        const hangMe = await timHangMeFn(khoMe.sp, local.sku)
        if (!hangMe) return null
        const treo = donTreo.get(chuanSku(local.sku)) || 0
        return { ton: (hangMe.stock || 0) - treo, treo }
    }

    /* LƯỢT 1 — tính tồn cần đẩy cho MỌI listing (mọi phân loại), CHƯA ghi gì lên sàn. Chạy thử và chạy thật dùng CHUNG lượt
     * này (một bản tính ⇒ bảng xem trước đúng bằng thứ sẽ đẩy). `dong` là dòng bảng chạy thử — cầu dao đọc trên đủ mọi dòng,
     * không cắt; mỗi phân loại một dòng nên phân loại sắp về 0 cũng vào cầu dao. */
    const keHoach: { p: any; local: any; targetStock: number; dong: any; phanLoai?: PhanLoaiSan; skuId?: string; sellerSku?: string }[] = []
    const boQuaPhanLoai: string[] = []
    let soListingPhanLoai = 0
    for (const p of onlineProducts) {
        const maSan = String(p.platformProductId)
        const ds = docSan.phanLoai.get(maSan)
        if (ds) {
            soListingPhanLoai++
            const skuListing = [chuanSku(p.sku), chuanSku(p.localProduct?.sku)].filter(Boolean)
            for (const m of ds) {
                const nhan = `${p.sku || maSan} / ${m.ten || m.sku || m.id}`
                // Sàn không cho đẩy phân loại này (Lazada: SKU nhiều kho) ⇒ bỏ qua, nói lý do — không đoán
                if (m.chan) { skipped++; boQuaPhanLoai.push(`${nhan}: ${m.chan}`); continue }
                /* Phân loại mang đúng SKU của listing (hoặc listing chỉ MỘT phân loại) ⇒ tra như listing, link sẵn trước — y như
                 * cách cũ đẩy phân loại khớp. Phân loại khác tra theo SKU CỦA NÓ; không ra mã kho thì bỏ qua, không đoán. */
                const nhuListing = ds.length === 1 || (!!m.sku && skuListing.includes(chuanSku(m.sku)))
                const tra = (nhuListing ? await traHangKho(prisma, p.sku, p.localProduct) : null)
                    || (m.sku ? await traHangKho(prisma, m.sku, null) : null)
                if (!tra) {
                    skipped++
                    boQuaPhanLoai.push(m.sku ? `${nhan}: mã "${m.sku}" không có trong kho / bảng ánh xạ` : `${nhan}: phân loại chưa khai SKU trên sàn`)
                    continue
                }
                const nguon = await tonNguonCua(tra.local)
                if (!nguon) {
                    skipped++
                    boQuaKhoMe.push(`${nhan}: không tra ra hàng ở kho mẹ ${khoMe!.ma}`)
                    continue
                }
                // Tồn theo ĐƠN VỊ BÁN trên sàn: 26 cái = 2 vỉ (không phải 26 vỉ)
                const targetStock = Math.max(0, Math.floor(nguon.ton / (tra.rate > 0 ? tra.rate : 1)))
                const boQua = !force && m.ton === targetStock
                if (boQua) skipped++
                keHoach.push({
                    p, local: tra.local, targetStock, phanLoai: m,
                    dong: {
                        // tên phân loại đứng TRƯỚC: bảng / ví dụ cầu dao cắt 40 ký tự vẫn thấy phân loại nào
                        sku: m.sku || tra.local.sku, tenSan: `${m.ten || m.sku || m.id} · ${p.name || ''}`.slice(0, 40), phanLoai: m.ten || m.sku || m.id,
                        tonDangTrenSan: m.ton, seDay: targetStock,
                        doi: targetStock - m.ton,
                        ...(khoMe ? { tonKhoMe: nguon.ton + nguon.treo, donTreo: nguon.treo } : {}),
                        ...(tra.rate !== 1 ? { heSo: tra.rate } : {}),
                        boQua,
                    },
                })
            }
            continue
        }

        // tồn ĐANG BÁN đọc sống ở lượt 0 (đọc hỏng ⇒ số lưu lần đồng bộ cuối, như trước)
        const song = docSan.don.get(maSan)
        /* Lazada (13/11/2026): không đọc ra listing này trên sàn ⇒ KHÔNG đẩy (không có cách cũ — xem DocSan.batBuocDoc); sàn không
         * cho đẩy (SKU nhiều kho) ⇒ bỏ qua. Lý do đã nằm trong ghi chú đọc sàn (docSan) mà bảng chạy thử hiện ra. */
        if ((docSan.batBuocDoc && !song) || song?.chan) { skipped++; continue }

        const tra = await traHangKho(prisma, p.sku, p.localProduct)
        if (!tra) { skipped++; continue }
        const { local, rate } = tra
        const nguon = await tonNguonCua(local)
        if (!nguon) {
            skipped++
            boQuaKhoMe.push(`${p.sku || local.sku || p.platformProductId}: không tra ra hàng ở kho mẹ ${khoMe!.ma}`)
            continue
        }

        const tonSan = song ? song.ton : p.stock
        // Tồn theo ĐƠN VỊ BÁN trên sàn: 26 cái = 2 vỉ (không phải 26 vỉ)
        const targetStock = Math.max(0, Math.floor(nguon.ton / (rate > 0 ? rate : 1)))
        const boQua = !force && tonSan === targetStock
        if (boQua) skipped++
        keHoach.push({
            p, local, targetStock, ...(song?.skuId ? { skuId: song.skuId } : {}), ...(song?.sku ? { sellerSku: song.sku } : {}),
            dong: {
                sku: p.sku || local.sku, tenSan: String(p.name || '').slice(0, 40),
                tonDangTrenSan: tonSan, seDay: targetStock,
                doi: targetStock - (tonSan || 0),
                ...(khoMe ? { tonKhoMe: nguon.ton + nguon.treo, donTreo: nguon.treo } : {}),
                ...(rate !== 1 ? { heSo: rate } : {}),
                boQua,
            },
        })
    }
    const thongTinPhanLoai = soListingPhanLoai ? {
        phanLoai: {
            soListing: soListingPhanLoai,
            soDong: keHoach.filter(k => k.phanLoai).length,
            boQua: boQuaPhanLoai.length,
            viDuBoQua: boQuaPhanLoai.slice(0, 10),
        },
    } : {}
    const thongTinDocSan = docSan.ghiChu.length ? { docSan: docSan.ghiChu } : {}

    /* CẦU DAO trên TOÀN BỘ lượt 1 (09/11/2026) — trước Pilot chỉ soát `bang` đã cắt 300 dòng: gian 709 listing mà các mã
     * về 0 nằm sau dòng 300 thì cầu dao không thấy. Chạy thử trả kèm chi tiết để giao diện hỏi lại người bấm. */
    const bangDu = keHoach.map(k => k.dong)
    const cauDao = cauDaoTon(bangDu)
    const dsVeKhong = bangDu.filter(seVeKhong)
    const chiTietCauDao = {
        cauDao,
        veKhong: dsVeKhong.length,
        coHangTrenSan: bangDu.filter(coHangSan).length,
        viDuVeKhong: dsVeKhong.slice(0, 20).map(x => ({ sku: x.sku, tenSan: x.tenSan, tonDangTrenSan: x.tonDangTrenSan })),
    }

    if (chayThu) {
        return {
            http: 200, ok: true,
            data: {
                chayThu: true,
                seDay: keHoach.length - keHoach.filter(k => k.dong.boQua).length, seBoQua: skipped,
                ...(khoMe ? { khoMe: khoMe.ma, boQuaViKhongCoOKhoMe: boQuaKhoMe.length, viDuBoQua: boQuaKhoMe.slice(0, 10) } : {}),
                ...chiTietCauDao,
                ...thongTinPhanLoai,
                ...thongTinDocSan,
                // bảng cho giao diện vẫn cắt 300 dòng — cầu dao ở trên đã đếm trên đủ mọi dòng
                bang: bangDu.slice(0, 300),
                ghiChu: 'CHẠY THỬ — chỉ ĐỌC sàn (phân loại, tồn đang bán), chưa ghi gì. Bỏ dryRun để chạy thật.',
            },
            // bản đọc cho lượt thật của Pilot (ngoài `data` — không ra trình duyệt); bỏ đọc vì token thì lượt thật tự đọc
            ...(boDocViToken ? {} : { banDocSan: docSan }),
        }
    }

    /* Chạy thật mà cầu dao nhảy: KHÔNG gọi sàn lần nào. Chỉ người bấm nút tay — đã xem chạy thử, tích "vẫn đẩy các mã
     * về 0" — vượt được (chapNhanVeKhong); Pilot không truyền cờ nên luôn dừng ở đây khi tồn đổi giữa chạy thử và chạy thật. */
    // Đồng ý gắn với con số đã xem: thêm mã về 0 sau lúc xem trước (hoặc không gửi số) ⇒ không tính là đồng ý
    const daXem = typeof ts.veKhongDaXem === 'number' && Number.isFinite(ts.veKhongDaXem) ? ts.veKhongDaXem : null
    const vuotCauDao = !!cauDao && ts.chapNhanVeKhong === true && daXem !== null && chiTietCauDao.veKhong <= daXem
    if (cauDao && !vuotCauDao) {
        console.warn(`[push-stock] ${channel.name}: CẦU DAO — ${chiTietCauDao.veKhong}/${chiTietCauDao.coHangTrenSan} mã đang có hàng sẽ về 0, không đẩy`)
        const xemLai = ts.chapNhanVeKhong === true
            ? (daXem === null ? 'thiếu số mã về 0 đã xem ở lượt chạy thử — chạy thử lại rồi xác nhận. '
                : `số mã về 0 tăng từ ${daXem} lên ${chiTietCauDao.veKhong} kể từ lúc xem trước — xem lại rồi mới xác nhận. `)
            : ''
        return { http: 409, ok: false, loi: `CẦU DAO — không đẩy tồn: ${xemLai}${cauDao}`, data: { ...chiTietCauDao, ...thongTinPhanLoai, ...thongTinDocSan } }
    }

    /* LƯỢT 2 — đẩy thật (token đã làm mới trước lượt 0). Phân loại: ghi đúng model_id (Shopee) / sku_id (TikTok) đọc ở
     * lượt 0. Listing một SKU: Shopee như cũ (thử trơn → hỏi phân loại); TikTok mang sẵn sku_id thì khỏi hỏi product detail. */
    /** listing có phân loại → phân loại đã ghi thành công → số vừa ghi; cộng lại thành tồn TỔNG của listing ở cuối lượt */
    const daGhiPhanLoai = new Map<string, { p: any; daGhi: Map<string, number> }>()
    for (const { p, local, targetStock, dong, phanLoai, skuId, sellerSku } of keHoach) {
        if (dong.boQua) continue

        try {
            if (phanLoai) {
                if (channel.platform === 'shopee') await service.updateStock(p.platformProductId, targetStock, Number(phanLoai.id))
                // Lazada: SkuId + SellerSku đọc sống ở lượt 0 (UpdateSellableQuantity nhận cả hai, thiếu một vẫn khớp được)
                else if (channel.platform === 'lazada') await service.updateStock(p.platformProductId, targetStock, phanLoai.id || undefined, phanLoai.sku || undefined)
                else await service.updateStock(p.platformProductId, targetStock, phanLoai.id)
                const maSan = String(p.platformProductId)
                const x = daGhiPhanLoai.get(maSan) || { p, daGhi: new Map<string, number>() }
                x.daGhi.set(phanLoai.id, targetStock)
                daGhiPhanLoai.set(maSan, x)
            } else {
                if (channel.platform === 'shopee') {
                    await dayTonShopee(service, p, local, targetStock)
                } else {
                    // Lazada: SellerSku đọc sống ở lượt 0 trước SKU đã lưu (TikTok không có sellerSku sống ⇒ như cũ)
                    await service.updateStock(p.platformProductId, targetStock, skuId, sellerSku || p.sku || undefined)
                }
                await prisma.onlineProduct.update({
                    where: { id: p.id },
                    data: { stock: targetStock, syncedAt: new Date() },
                })
            }
            pushed++
        } catch (e: any) {
            failed++
            errors.push(`${phanLoai ? `${dong.sku} (${dong.phanLoai})` : p.sku || p.platformProductId}: ${e.message}`)
            console.error(`[push-stock] ${channel.name} ${p.platformProductId}${phanLoai ? `/${phanLoai.id}` : ''}:`, e.message)
        }

        await nghi(300)
    }

    /* Tồn TỔNG của listing có phân loại = Σ phân loại (vừa ghi ⇒ số mới, còn lại ⇒ số đọc ở lượt 0). Trước: TikTok đè tồn
     * SKU đầu lên tổng, Shopee để 0. Ghi hỏng ở đây không làm hỏng lượt — sàn đã nhận, lần đồng bộ sau sửa lại. */
    for (const [maSan, { p, daGhi }] of daGhiPhanLoai) {
        const tong = (docSan.phanLoai.get(maSan) || []).reduce((t, m) => t + (daGhi.has(m.id) ? daGhi.get(m.id)! : m.ton), 0)
        await prisma.onlineProduct.update({ where: { id: p.id }, data: { stock: tong, syncedAt: new Date() } })
            .catch((e: any) => console.error(`[push-stock] ${channel.name} ${maSan}: ghi tồn tổng listing hỏng:`, e?.message))
    }

    const phanLoaiDaDay = keHoach.filter(k => k.phanLoai && !k.dong.boQua).length
    await prisma.syncLog.create({
        data: {
            channelId: channel.id,
            action: 'push_stock',
            status: failed > 0 ? 'partial' : 'success',
            details: `Pushed: ${pushed}, skipped: ${skipped}, failed: ${failed}`
                + (khoMe ? ` | kho mẹ ${khoMe.ma}, bỏ qua ${boQuaKhoMe.length} mã không có bên đó` : '')
                + (soListingPhanLoai ? ` | phân loại: ${phanLoaiDaDay} dòng cần đẩy / ${soListingPhanLoai} listing, bỏ qua ${boQuaPhanLoai.length} phân loại chưa khớp mã kho` : '')
                + (docSan.ghiChu.length ? ` | đọc sàn: ${docSan.ghiChu.join(' ')}`.slice(0, 400) : '')
                // vượt cầu dao phải để lại dấu — sau này hỏi "ai cho đẩy về 0" thì sổ đồng bộ trả lời được
                + (vuotCauDao ? ` | VƯỢT CẦU DAO theo xác nhận của người bấm: ${chiTietCauDao.veKhong}/${chiTietCauDao.coHangTrenSan} mã đang có hàng đẩy về 0` : '')
                + (errors.length ? '\n' + errors.slice(0, 5).join('\n') : ''),
            ordersCount: pushed,
        },
    }).catch(() => { })

    return {
        http: 200, ok: true,
        data: {
            pushed, skipped, failed, errors,
            // số mã đang có hàng trên sàn được đẩy về 0 — người bấm biết lượt vừa rồi khoá bao nhiêu mã
            veKhong: chiTietCauDao.veKhong,
            ...(vuotCauDao ? { cauDao } : {}),
            ...thongTinPhanLoai,
            ...thongTinDocSan,
            // Nói RA khi đang lấy tồn từ kho khác — người bấm nút phải biết số vừa
            // đẩy lên sàn đến từ đâu, và mã nào bị bỏ vì không tra ra bên đó.
            ...(khoMe ? {
                khoMe: khoMe.ma,
                soMaCoDonTreo: donTreo.size,
                boQuaViKhongCoOKhoMe: boQuaKhoMe.length,
                viDuBoQua: boQuaKhoMe.slice(0, 10),
            } : {}),
        },
    }
}
