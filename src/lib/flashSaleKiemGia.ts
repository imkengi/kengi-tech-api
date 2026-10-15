/* SOÁT GIÁ FLASH SALE TRƯỚC KHI XẾP (15/10/2026).
 *
 * Đo get_item_criteria cả 3 gian Shopee của KENGISTORE (15/10/2026): mọi ngành đòi giá flash sale thấp hơn GIÁ GỐC
 * (original_price) ít nhất 5% (tối đa 90%), tồn campaign 1–1000/mã. Chủ shop muốn "giá đang bán − 1đ" ⇒ chỉ lọt khi mã đang
 * có khuyến mãi của shop kéo giá đang bán xuống ≥ 5% dưới giá gốc; mã bán đúng giá gốc mà trừ 1đ thì Shopee từ chối.
 *
 * Ở đây chỉ ĐỌC giá thật trên Shopee (giá gốc + giá đang bán, từng phân loại) và điều kiện của gian để màn hình báo TRƯỚC khi
 * xếp hàng đợi — KHÔNG tự đổi giá thay chủ shop. Lúc đẩy, Shopee vẫn là người quyết; lời từ chối của Shopee hiện ở hàng đợi.
 */

export interface DieuKienFlashSale {
    /** % giảm tối thiểu so với giá gốc (0 = không giới hạn) */
    giamToiThieu: number
    /** % giảm tối đa (100 = không giới hạn) */
    giamToiDa: number
    tonToiThieu: number
    /** 0 = không giới hạn */
    tonToiDa: number
}

export interface GiaPhanLoai { modelId: number; ten: string; giaGoc: number; giaDangBan: number; ton: number; khuyenMai?: string | null }

export interface KetQuaKiemGia {
    itemId: number
    coPhanLoai: boolean
    /** hàng không phân loại: giá của sản phẩm; có phân loại: 0 (xem `phanLoai`) */
    giaGoc: number
    giaDangBan: number
    ton: number
    phanLoai: GiaPhanLoai[]
    dieuKien: DieuKienFlashSale | null
    /** chương trình đang chạy làm giá hiển thị thấp hơn current_price (hàng không phân loại) */
    khuyenMai?: string | null
    loi?: string
}

/* GIÁ ĐANG HIỂN THỊ (chủ shop 15/10/2026: "giá là giá đang hiển thị chứ"). Flash sale = giá người mua đang thấy − 1đ. Lấy
 * mức THẤP hơn giữa current_price và giá của chương trình ĐANG CHẠY trên mã/phân loại (get_item_promotion) — phòng khi
 * current_price không phản ánh chương trình. Bỏ chính flash sale và các loại không đổi giá niêm yết (combo, mua kèm, quà,
 * bán sỉ, nhóm, chào mừng, giá thành viên). */
const LOAI_KHONG_DOI_GIA = /flash|bundle|add.?on|gift|whole|group|welcome|member|exclusive/i
export type GiaKhuyenMai = { gia: number; loai: string }
export async function docGiaKhuyenMai(service: any, itemIds: number[]): Promise<Map<string, GiaKhuyenMai>> {
    const ra = new Map<string, GiaKhuyenMai>()
    const ids = [...new Set(itemIds.map(Number).filter(n => n > 0))]
    for (let i = 0; i < ids.length; i += 50) {
        const ds: any[] = await service.getItemPromotion(ids.slice(i, i + 50))
        for (const x of ds) {
            for (const p of (x?.promotion || [])) {
                if (String(p?.promotion_staging || '').toLowerCase() !== 'ongoing') continue
                const loai = String(p?.promotion_type || '')
                if (LOAI_KHONG_DOI_GIA.test(loai)) continue
                const gias = (p?.promotion_price_info || []).map((g: any) => so(g?.promotion_price)).filter((n: number) => n > 0)
                if (!gias.length) continue
                const gia = Math.min(...gias)
                const khoa = `${so(x.item_id)}:${so(p?.model_id)}`
                const cu = ra.get(khoa)
                if (!cu || gia < cu.gia) ra.set(khoa, { gia, loai })
            }
        }
    }
    return ra
}
/** Giá người mua đang thấy của một mã/phân loại: min(current_price, giá chương trình đang chạy) */
export function giaHienThi(km: Map<string, GiaKhuyenMai> | null, itemId: number, modelId: number, giaHienTai: number): { gia: number; loai: string | null } {
    const k = km?.get(`${itemId}:${modelId}`) ?? (modelId ? km?.get(`${itemId}:0`) : undefined)
    return k && k.gia > 0 && (!(giaHienTai > 0) || k.gia < giaHienTai) ? { gia: k.gia, loai: k.loai } : { gia: giaHienTai, loai: null }
}

const so = (v: any, macDinh = 0) => { const n = Number(v); return Number.isFinite(n) ? n : macDinh }

/** -1 của Shopee = không giới hạn ⇒ đổi về số dùng được ngay khi so sánh. */
function chuanHoaDieuKien(k: any): DieuKienFlashSale {
    const kgh = (v: any, khongGioiHan: number) => (v == null || so(v, -1) < 0 ? khongGioiHan : so(v))
    return {
        giamToiThieu: kgh(k?.min_discount, 0),
        giamToiDa: kgh(k?.max_discount, 100),
        tonToiThieu: kgh(k?.min_promo_stock, 1),
        tonToiDa: kgh(k?.max_promo_stock, 0),
    }
}

/** Điều kiện theo NGÀNH: category_id → điều kiện; khoá 0 = "All" (áp cho mọi ngành không có điều kiện riêng). */
export async function docDieuKienTheoNganh(service: any): Promise<Map<number, DieuKienFlashSale>> {
    const c = await service.flashSaleItemCriteria()
    const theoId = new Map<string, DieuKienFlashSale>()
    for (const k of (c?.criteria || [])) theoId.set(String(k.criteria_id), chuanHoaDieuKien(k))
    const theoNganh = new Map<number, DieuKienFlashSale>()
    for (const p of (c?.pair_ids || [])) {
        const dk = theoId.get(String(p.criteria_id)); if (!dk) continue
        for (const ng of (p.category_list || [])) theoNganh.set(so(ng.category_id), dk)
    }
    return theoNganh
}

/** Giá + tồn thật trên Shopee của tối đa 50 mã (get_item_base_info theo lô; hàng có phân loại thêm get_model_list từng mã). */
export async function kiemGiaFlashSale(service: any, itemIds: number[], theoNganh?: Map<number, DieuKienFlashSale>): Promise<KetQuaKiemGia[]> {
    const ids = [...new Set(itemIds.map(Number).filter(n => n > 0))].slice(0, 50)
    if (!ids.length) return []
    const coSo: any[] = await service.getItemBaseInfo(ids)
    const theoMa = new Map<number, any>(coSo.map((x: any) => [Number(x.item_id), x]))
    // Không đọc được chương trình ⇒ dùng current_price như cũ (không chặn việc soát)
    let km: Map<string, GiaKhuyenMai> | null = null
    try { km = await docGiaKhuyenMai(service, ids) } catch { km = null }
    const ra: KetQuaKiemGia[] = []
    for (const id of ids) {
        const x = theoMa.get(id)
        if (!x) { ra.push({ itemId: id, coPhanLoai: false, giaGoc: 0, giaDangBan: 0, ton: 0, phanLoai: [], dieuKien: null, loi: 'Shopee không trả thông tin mã này (đã xoá/ẩn?)' }); continue }
        const dieuKien = theoNganh ? (theoNganh.get(so(x.category_id)) ?? theoNganh.get(0) ?? null) : null
        if (x.has_model) {
            try {
                const ms: any[] = await service.getModelList(id)
                ra.push({
                    itemId: id, coPhanLoai: true, giaGoc: 0, giaDangBan: 0, dieuKien,
                    ton: ms.reduce((t, m) => t + so(m.stock), 0),
                    phanLoai: ms.map(m => {
                        const h = giaHienThi(km, id, so(m.model_id), so(m.giaHienTai) || so(m.price))
                        return { modelId: so(m.model_id), ten: String(m.name || ''), giaGoc: so(m.price), giaDangBan: h.gia, ton: so(m.stock), khuyenMai: h.loai }
                    }),
                })
            } catch (e: any) {
                ra.push({ itemId: id, coPhanLoai: true, giaGoc: 0, giaDangBan: 0, ton: 0, phanLoai: [], dieuKien, loi: `Không đọc được phân loại: ${String(e?.message || e).slice(0, 160)}` })
            }
            continue
        }
        const pi = x.price_info?.[0] || {}
        const h = giaHienThi(km, id, 0, so(pi.current_price) || so(pi.original_price))
        ra.push({
            itemId: id, coPhanLoai: false, dieuKien, phanLoai: [],
            giaGoc: so(pi.original_price) || h.gia, giaDangBan: h.gia, khuyenMai: h.loai,
            ton: tonSanPham(x),
        })
    }
    return ra
}

/** Tồn bán được của hàng không phân loại trong get_item_base_info (stock_info_v2). */
export function tonSanPham(x: any): number {
    const s = x?.stock_info_v2
    if (s?.summary_info?.total_available_stock != null) return so(s.summary_info.total_available_stock)
    if (Array.isArray(s?.seller_stock)) return s.seller_stock.reduce((t: number, k: any) => t + so(k.stock), 0)
    return so(s?.current_stock ?? s?.normal_stock)
}

/** % giảm so với giá gốc, làm tròn 1 chữ số (1.2 nghĩa là 1,2%). */
export const phanTramGiam = (giaGoc: number, giaFlash: number) => giaGoc > 0 ? Math.round((1 - giaFlash / giaGoc) * 1000) / 10 : 0
