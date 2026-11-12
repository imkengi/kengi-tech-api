/**
 * LÃI RIÊNG THEO NHÓM HÀNG / MÃ HÀNG — Shopee Pilot (12/11/2026)
 *
 * Chủ shop: "shopee có thể mình điều chỉnh lợi nhuận theo từng nhóm hàng hoặc mã hàng không". Trước đây chính sách Pilot chỉ có
 * MỘT lãi mục tiêu + MỘT biên tối thiểu (giá sàn) cho mọi mặt hàng của cửa hàng.
 *
 * Giờ `policy.marginRules` = [{ scope: 'nhom' | 'sku', key, targetMarginRate, minMarginRate }]:
 *   - "nhóm" = nhóm hàng trong KHO Kengi (Category.name), so như hồ sơ đăng hàng: bỏ khoảng trắng hai đầu, không phân biệt hoa thường;
 *   - cây nhóm (KiotViet 3 cấp — xem lib/zaloDoanhSo.moRongNhom): quy tắc của nhóm CHA áp cho cả nhóm con; nhóm GẦN nhất thắng;
 *   - mã thắng nhóm, nhóm thắng mức chung của chính sách (cùng luật với hồ sơ đăng, lib/shopeePilot.timHoSo);
 *   - quy tắc chỉ đổi HAI con số biên lãi; mọi rào khác (biên độ mỗi lần, trần ghi, phí sàn chưa đủ tin, affiliate, thuế…) giữ nguyên.
 *
 * Mọi chỗ tính giá / giá sàn cho MỘT mặt hàng phải lấy chính sách qua `polCua(pol, khoa)` — thiếu một chỗ là chỗ đó tính theo mức
 * chung: nhóm đặt sàn 20% vẫn bị máy hạ về sàn 5%. `scripts/check-lai-rieng.ts` soát nguồn để bắt chỗ quên.
 * Quy tắc nằm TRONG policy (không phải bảng riêng) để mọi nơi đọc chính sách (tool AI, nút "Đẩy giá lên sàn") tự có.
 */

import { ToolError } from './mcpTypes'

export interface LaiRieng {
    scope: 'nhom' | 'sku'
    key: string
    /** lãi mục tiêu (phân số, 0,25 = 25%) — tính giá đề xuất */
    targetMarginRate: number
    /** biên tối thiểu (phân số) — giá sàn; máy và người đều không ghi giá dưới mức này */
    minMarginRate: number
}

/** Khoá tra quy tắc của MỘT mặt hàng: các SKU của nó (SKU trên sàn, SKU trong kho…) theo thứ tự ưu tiên + nhóm hàng kho
 *  + các nhóm cha của nhóm đó (gần trước, xa sau). */
export interface KhoaHang { skus?: (string | null | undefined)[]; nhom?: string | null; nhomCha?: (string | null | undefined)[] }

/** Chọn nhóm hàng kèm HAI cấp cha (cây KiotViet 3 cấp) — dùng trong `include` / `select` Prisma của Product. */
export const CHON_NHOM_CAY = { select: { name: true, parent: { select: { name: true, parent: { select: { name: true } } } } } } as const

/** Cột SQL thô (bảng "Product" đang SELECT) — tên nhóm + hai cấp cha. Cùng truy vấn với giá vốn: đọc hỏng là hỏng cả, không lặng
 *  lẽ thiếu nhóm (thiếu nhóm = tính theo mức chung, có thể hạ dưới sàn riêng của nhóm). */
// bí danh nh/nh1/nh2 (không phải c): bộ kiểm dùng CSDL giả nhận câu theo chuỗi — `FROM "Category" c` là câu bộ chọn nhóm
// (nhomHangKho), trùng chuỗi thì câu giá vốn bị trả nhầm dòng nhóm (check:pilot-khong-lo đỏ 12/11/2026)
export const COT_NHOM_SQL = `(SELECT nh.name FROM "Category" nh WHERE nh.id = "Product"."categoryId") AS "nhomHang",
    (SELECT nh1.name FROM "Category" nh JOIN "Category" nh1 ON nh1.id = nh."parentId" WHERE nh.id = "Product"."categoryId") AS "nhomCha1",
    (SELECT nh2.name FROM "Category" nh JOIN "Category" nh1 ON nh1.id = nh."parentId" JOIN "Category" nh2 ON nh2.id = nh1."parentId" WHERE nh.id = "Product"."categoryId") AS "nhomCha2"`

/** Số quy tắc tối đa — đủ cho một cửa hàng khai theo từng mã bán chạy, không để policy JSON phình vô hạn. */
export const TRAN_LAI_RIENG = 500
/** Biên lãi tối đa nhận — cùng trần với chính sách chung (chuanHoaChinhSach kẹp 0..0,8). */
export const BIEN_TOI_DA = 0.8

const thuong = (v: unknown) => String(v ?? '').trim().toLowerCase()

/** Số tỷ lệ hợp lệ trong [0, BIEN_TOI_DA]; chuỗi rỗng / null / NaN ⇒ null (KHÔNG coi là 0 — Number('') = 0 là bẫy). */
function tyLe(v: unknown): number | null {
    if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null
    const n = Number(v)
    return Number.isFinite(n) && n >= 0 && n <= BIEN_TOI_DA ? n : null
}

/** Chuẩn hoá MỘT quy tắc người gửi lên — sai thì NÓI RÕ (ToolError), không kẹp lặng lẽ như chính sách chung. */
export function chuanHoaLaiRieng(x: any): LaiRieng {
    const scope = x?.scope === 'sku' ? 'sku' : x?.scope === 'nhom' ? 'nhom' : null
    if (!scope) throw new ToolError('Chọn áp theo nhóm hàng hay theo mã hàng')
    const key = String(x?.key ?? '').trim().slice(0, 120)
    if (!key) throw new ToolError(scope === 'sku' ? 'Nhập mã hàng' : 'Chọn nhóm hàng')
    const min = tyLe(x?.minMarginRate), muc = tyLe(x?.targetMarginRate)
    if (min === null) throw new ToolError(`Biên tối thiểu (giá sàn) phải từ 0% tới ${BIEN_TOI_DA * 100}%`)
    if (muc === null) throw new ToolError(`Lãi mục tiêu phải từ 0% tới ${BIEN_TOI_DA * 100}%`)
    if (muc + 1e-9 < min) throw new ToolError('Lãi mục tiêu phải lớn hơn hoặc bằng biên tối thiểu (giá sàn)')
    return { scope, key, targetMarginRate: muc, minMarginRate: min }
}

/** Chuẩn hoá danh sách đã lưu (đọc từ CSDL / chính sách gửi lên) — dòng hỏng BỎ, trùng phạm vi + khoá thì dòng SAU thắng. */
export function chuanHoaDsLaiRieng(ds: unknown): LaiRieng[] {
    if (!Array.isArray(ds)) return []
    const theoKhoa = new Map<string, LaiRieng>()
    for (const x of ds) {
        let r: LaiRieng
        try { r = chuanHoaLaiRieng(x) } catch { continue }
        const k = `${r.scope}:${thuong(r.key)}`
        theoKhoa.delete(k)   // giữ thứ tự theo lần khai cuối
        theoKhoa.set(k, r)
    }
    return [...theoKhoa.values()].slice(-TRAN_LAI_RIENG)
}

/** Quy tắc áp cho một mặt hàng: SKU trước (theo thứ tự trong khoa.skus), rồi nhóm hàng kho, rồi nhóm cha gần → xa.
 *  Không có ⇒ null (mức chung). */
export function laiRiengCho(ds: LaiRieng[] | undefined | null, khoa: KhoaHang | null | undefined): LaiRieng | null {
    if (!ds?.length || !khoa) return null
    for (const s of khoa.skus || []) {
        const k = thuong(s)
        if (!k) continue
        const r = ds.find(x => x.scope === 'sku' && thuong(x.key) === k)
        if (r) return r
    }
    for (const n0 of [khoa.nhom, ...(khoa.nhomCha || [])]) {
        const n = thuong(n0)
        if (!n) continue
        const r = ds.find(x => x.scope === 'nhom' && thuong(x.key) === n)
        if (r) return r
    }
    return null
}

/**
 * Chính sách cho MỘT mặt hàng: thay lãi mục tiêu + biên tối thiểu bằng quy tắc áp được (kèm `laiRieng` để giao diện / kế hoạch
 * nói ra quy tắc nào đang áp). Không quy tắc nào ⇒ trả nguyên `pol`. Chính sách không có `marginRules` (TikTok Pilot) ⇒ nguyên `pol`.
 */
export function polCua<T extends { targetMarginRate: number; minMarginRate: number; marginRules?: LaiRieng[] }>(
    pol: T, khoa: KhoaHang | null | undefined,
): T & { laiRieng?: LaiRieng } {
    const r = laiRiengCho(pol.marginRules, khoa)
    if (!r) return pol
    return { ...pol, targetMarginRate: r.targetMarginRate, minMarginRate: r.minMarginRate, laiRieng: r }
}

type NhomVon = { sku?: string | null; nhomHang?: string | null; nhomCha?: (string | null)[] | null }

/** Khoá của một listing trên sàn: SKU của listing, SKU hàng kho đã nối (giaVonHangLoat), nhóm hàng (+ cha) của hàng kho đó. */
export function khoaListing(l: { sku?: string | null } | null | undefined, v?: NhomVon | null): KhoaHang {
    return { skus: [l?.sku, v?.sku], nhom: v?.nhomHang ?? null, nhomCha: v?.nhomCha || [] }
}

/** Khoá của MỘT phân loại (model) của listing: SKU phân loại → SKU hàng kho của phân loại → SKU listing → SKU hàng kho của listing;
 *  nhóm theo hàng kho của phân loại, không tra ra thì theo hàng kho của listing. */
export function khoaPhanLoai(skuMd: string | null | undefined, vm: NhomVon | null | undefined, l: { sku?: string | null } | null | undefined, vl: NhomVon | null | undefined): KhoaHang {
    const g = vm?.nhomHang ? vm : vl
    return { skus: [skuMd, vm?.sku, l?.sku, vl?.sku], nhom: g?.nhomHang ?? null, nhomCha: g?.nhomCha || [] }
}

/** Khoá của MỘT hàng kho đọc bằng Prisma với `category: CHON_NHOM_CAY` (timHangKho, timUngVien…) + các SKU khác gửi kèm. */
export function khoaHangKho(p: { sku?: string | null; category?: { name?: string | null; parent?: { name?: string | null; parent?: { name?: string | null } | null } | null } | null } | null | undefined, ...skuThem: (string | null | undefined)[]): KhoaHang {
    const c = p?.category
    return { skus: [p?.sku, ...skuThem], nhom: c?.name ?? null, nhomCha: [c?.parent?.name, c?.parent?.parent?.name] }
}

/** Hai cấp nhóm cha từ dòng SQL thô có COT_NHOM_SQL. */
export function nhomChaTuDong(h: any): string[] {
    return [h?.nhomCha1, h?.nhomCha2].filter((x: unknown): x is string => typeof x === 'string' && !!x.trim())
}

const pctVN = (r: number) => `${(Math.round(r * 1000) / 10).toLocaleString('vi-VN')}%`

/** "nhóm «Máy khoan»: lãi 25%, sàn 10%" — cho câu kết quả / nhật ký. */
export function moTaLaiRieng(r: LaiRieng | null | undefined): string {
    if (!r) return ''
    return `${r.scope === 'sku' ? 'mã' : 'nhóm'} «${r.key}»: lãi ${pctVN(r.targetMarginRate)}, sàn ${pctVN(r.minMarginRate)}`
}

/** Đọc danh sách quy tắc cho sổ "Đổi cấu hình" (lib/pilotDoiCauHinh docRieng) — "trống" khi không có quy tắc nào. */
export function docDsLaiRieng(v: unknown): string {
    const ds = chuanHoaDsLaiRieng(v)
    if (!ds.length) return 'không có'
    const chu = ds.map(moTaLaiRieng).join('; ')
    return chu.length > 400 ? `${ds.length} quy tắc: ${chu.slice(0, 380)}…` : chu
}
