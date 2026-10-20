// ─────────────────────────────────────────────────────────────────────────────
//  TRA CỨU SẢN PHẨM CHO CHATBOT (AI Agent n8n trả lời khách) — 20/10/2026, chủ shop: "giá và sản phẩm lấy từ data
//  đã có chứ" (kho kiến thức kengi.vn/chatbot không bắt gõ tay sản phẩm / giá). Hàm THUẦN cho routes/chatbot.ts —
//  tách riêng để soát không cần CSDL (scripts/check-chatbot-san-pham.ts).
//
//  CHỈ trả thứ được phép nói với KHÁCH: tên, mã, giá bán (theo sàn), tình trạng còn hàng, mô tả, thương hiệu, nhóm.
//  KHÔNG giá vốn, KHÔNG số tồn chính xác, KHÔNG nhà cung cấp. (Công cụ search_products của MCP trả giá vốn ⇒ không
//  được cắm vào chatbot của khách.)
//
//  Đo KENGISTORE 20/10/2026 (chỉ đọc):
//   · kênh: Kengi Store (Shopee 266 listing, TikTok 206, Lazada 0), Kengi Tools (Shopee 142), Kengi Electric (Shopee 100);
//     chỉ ~40% listing nối hàng kho (localProductId) ⇒ tìm theo CẢ tên trên sàn lẫn tên / mã hàng kho;
//   · 78/78 hàng đăng nhiều sàn có giá KHÁC nhau giữa các sàn ⇒ trả giá TỪNG SÀN;
//   · Shopee: 508 listing NORMAL nhưng tồn trên sàn = 0 hết (đồng bộ tồn Shopee đang hỏng) và một số giá = 0 (giá
//     nằm ở phân loại) ⇒ tình trạng lấy theo TỒN KHO của hàng đã nối; giá 0 ⇒ null "tuỳ phân loại", không đoán;
//   · TikTok trạng thái ACTIVATE / DELETED / SELLER_DEACTIVATED / PLATFORM_DEACTIVATED — chỉ lấy listing đang bán;
//   · mô tả hàng kho trung vị 2.627 ký tự (tối đa 6.856), không có thẻ HTML ⇒ tìm kiếm trả bản CẮT, xem chi tiết dài hơn;
//   · TỒN KHO KHÔNG NÓI ĐƯỢC "HẾT HÀNG": 493 listing đang bán nối được hàng kho thì 257 tồn ÂM, 177 tồn 0, chỉ 59 dương;
//     148 listing tồn kho ≤ 0 vẫn có đơn sàn trong 30 ngày; 123 listing TikTok tồn kho ≤ 0 mà TikTok vẫn báo còn ⇒ tồn kho DƯƠNG
//     mới là bằng chứng (còn hàng); ≤ 0 = CHƯA RÕ. "Hết hàng" chỉ khi CHÍNH SÀN báo hết (tồn TikTok = 0 — khách thấy đúng
//     vậy trên sàn). Tồn Shopee 0 không tin (đồng bộ hỏng) ⇒ chưa rõ;
//   · listing chưa nối kho: 255 cái có SKU trùng ĐÚNG mã hàng kho (Product.sku là UNIQUE ⇒ khớp tối đa 1) ⇒ khớp theo mã
//     để có mô tả / ảnh / tồn; giá vẫn là giá TRÊN SÀN;
//   · Shopee 197/508 listing giá 0 (giá nằm ở phân loại, bảng listing không lưu phân loại) ⇒ trả LINK sản phẩm trên sàn
//     (shopee.vn/product/<shop_id>/<item_id>, TikTok shop.tiktok.com/view/product/<id>) để khách tự xem giá phân loại.
// ─────────────────────────────────────────────────────────────────────────────

import { CO_DAU, KHONG_DAU, boDauTim } from './danhSachTonKho'

export const TEN_SAN: Record<string, string> = { shopee: 'Shopee', tiktok: 'TikTok', lazada: 'Lazada' }
/** Trạng thái listing coi là ĐANG BÁN (Shopee NORMAL, TikTok ACTIVATE, Lazada active/ACTIVE) */
export const LISTING_DANG_BAN = ['NORMAL', 'ACTIVATE', 'ACTIVE', 'LIVE', 'active']
const MO_TA_TIM = 600
const MO_TA_CHI_TIET = 2500

export interface ThamSoSanPham {
    /** từ khoá khách hỏi (tên / mã) */
    q: string
    /** tra đúng MỘT mã hàng (SKU) — trả mô tả dài hơn */
    ma: string
    /** tên shop = tên kênh bán (Kengi Store…) — trống ⇒ giá bán lẻ của hàng kho */
    shop: string
    /** chỉ một sàn: shopee | tiktok | lazada — trống ⇒ mọi sàn của shop */
    san: string
    limit: number
}

export function docThamSoSanPham(qs: Record<string, any>): ThamSoSanPham {
    const san = String(qs.san || '').trim().toLowerCase()
    return {
        q: String(qs.q || '').replace(/\s+/g, ' ').trim().slice(0, 120),
        ma: String(qs.ma || '').trim().slice(0, 60),
        shop: String(qs.shop || '').replace(/\s+/g, ' ').trim().slice(0, 80),
        san: TEN_SAN[san] ? san : '',
        limit: Math.min(10, Math.max(1, parseInt(String(qs.limit || '5'), 10) || 5)),
    }
}

/** Từ khoá → các từ đã bỏ dấu, thường (≤ 6 từ, bỏ từ 1 ký tự và trùng). */
export function tuKhoa(q: string): string[] {
    const ds = boDauTim(q).replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(t => t.length >= 2)
    return Array.from(new Set(ds)).slice(0, 6)
}

/** Từ khoá ⇒ điều kiện LIKE (mọi từ phải có); không có từ ⇒ FALSE (route đã chặn 400, đây là chốt chặn thứ hai) */
function dieuKienTu(chu: string, tu: string[], them: (v: unknown) => string): string {
    return tu.length ? tu.map(t => `${chu} LIKE '%' || ${them(t)} || '%'`).join(' AND ') : 'FALSE'
}

/**
 * SQL tìm listing của các kênh (đã lọc theo shop / sàn ở route) — mọi giá trị người dùng nằm trong mảng tham số.
 * Khớp khi MỌI từ khoá có trong (tên listing ‖ tên hàng kho ‖ mã), hoặc mã / barcode trùng nguyên.
 * Hàng kho: theo liên kết localProductId, chưa nối thì theo SKU trùng ĐÚNG (Product.sku UNIQUE ⇒ ≤ 1 hàng, dùng chỉ mục).
 */
export function cauTimListing(kenhIds: string[], tu: string[], ma: string): { sql: string; tham: unknown[] } {
    const tham: unknown[] = [CO_DAU, KHONG_DAU]
    const them = (v: unknown) => { tham.push(v); return `$${tham.length}` }
    const kenh = kenhIds.map(id => them(id)).join(', ')
    const dangBan = LISTING_DANG_BAN.map(s => them(s)).join(', ')
    const chu = `translate(lower(coalesce(op.name,'') || ' ' || coalesce(p.name,'') || ' ' || coalesce(op.sku,'') || ' ' || coalesce(p.sku,'')), $1, $2)`
    let dieuKien: string
    if (ma) {
        const m = them(ma.toLowerCase())
        dieuKien = `(lower(coalesce(op.sku,'')) = ${m} OR lower(coalesce(p.sku,'')) = ${m} OR lower(coalesce(p.barcode,'')) = ${m})`
    } else {
        dieuKien = dieuKienTu(chu, tu, them)
    }
    const sql = `SELECT op.id, op.platform, op.name AS "tenSan", op.sku AS "maSan", op.price::float8 AS "giaSan",
            op.stock AS "tonSan", op."imageUrl" AS "anhSan", op."syncedAt" AS "dongBoLuc", op."platformProductId" AS "maSpSan",
            ch."shopId" AS "shopSan", p.id AS "hangId",
            p.name AS "tenHang", p.sku AS "maHang", p."sellingPrice"::float8 AS "giaLe", p.stock::float8 AS "tonKho",
            p."minStock"::float8 AS "tonToiThieu", p.description AS "moTa", b.name AS "thuongHieu", c.name AS "nhomHang",
            (SELECT pi.url FROM "ProductImage" pi WHERE pi."productId" = p.id ORDER BY pi."isPrimary" DESC LIMIT 1) AS "anhHang"
        FROM "OnlineProduct" op
        JOIN "OnlineChannel" ch ON ch.id = op."channelId"
        LEFT JOIN "Product" p ON p."mergedIntoId" IS NULL AND p.id = COALESCE(op."localProductId",
            (SELECT p2.id FROM "Product" p2 WHERE op.sku <> '' AND p2.sku = op.sku AND p2."mergedIntoId" IS NULL LIMIT 1))
        LEFT JOIN "Brand" b ON b.id = p."brandId"
        LEFT JOIN "Category" c ON c.id = p."categoryId"
        WHERE op."channelId" IN (${kenh}) AND op.status IN (${dangBan}) AND ${dieuKien}
        LIMIT 200`
    return { sql, tham }
}

/** SQL tìm HÀNG KHO (không gắn shop) — giá bán lẻ, tồn kho. */
export function cauTimHang(tu: string[], ma: string): { sql: string; tham: unknown[] } {
    const tham: unknown[] = [CO_DAU, KHONG_DAU]
    const them = (v: unknown) => { tham.push(v); return `$${tham.length}` }
    const chu = `translate(lower(coalesce(p.name,'') || ' ' || coalesce(p.sku,'') || ' ' || coalesce(p.barcode,'')), $1, $2)`
    const dieuKien = ma
        ? (() => { const m = them(ma.toLowerCase()); return `(lower(coalesce(p.sku,'')) = ${m} OR lower(coalesce(p.barcode,'')) = ${m})` })()
        : dieuKienTu(chu, tu, them)
    const sql = `SELECT NULL AS id, NULL AS platform, NULL AS "tenSan", NULL AS "maSan", NULL::float8 AS "giaSan", NULL AS "tonSan",
            NULL AS "anhSan", NULL AS "dongBoLuc", p.id AS "hangId", p.name AS "tenHang", p.sku AS "maHang",
            p."sellingPrice"::float8 AS "giaLe", p.stock::float8 AS "tonKho", p."minStock"::float8 AS "tonToiThieu",
            p.description AS "moTa", b.name AS "thuongHieu", c.name AS "nhomHang",
            (SELECT pi.url FROM "ProductImage" pi WHERE pi."productId" = p.id ORDER BY pi."isPrimary" DESC LIMIT 1) AS "anhHang"
        FROM "Product" p
        LEFT JOIN "Brand" b ON b.id = p."brandId"
        LEFT JOIN "Category" c ON c.id = p."categoryId"
        WHERE p."mergedIntoId" IS NULL AND COALESCE(p."productType", 'goods') <> 'service' AND ${dieuKien}
        LIMIT 200`
    return { sql, tham }
}

export type TinhTrangHang = 'con_hang' | 'sap_het' | 'het_hang' | 'chua_ro'

/** Tình trạng theo MỘT con số tồn ĐÁNG TIN — KHÔNG lộ số tồn. Ngưỡng sắp hết = mức tối thiểu của hàng, không đặt thì 5. */
export function tinhTrang(ton: number | null | undefined, toiThieu?: number | null): TinhTrangHang {
    if (ton === null || ton === undefined || !Number.isFinite(Number(ton))) return 'chua_ro'
    const n = Number(ton)
    if (n <= 0) return 'het_hang'
    const nguong = Number(toiThieu) > 0 ? Number(toiThieu) : 5
    return n <= nguong ? 'sap_het' : 'con_hang'
}

/** Tồn KHO: chỉ số DƯƠNG là bằng chứng còn hàng; ≤ 0 = CHƯA RÕ (đo 20/10: 434/493 hàng đang bán tồn ≤ 0 mà vẫn bán — đầu file) */
export function tinhTrangKho(ton: number | null | undefined, toiThieu?: number | null): TinhTrangHang {
    return Number(ton) > 0 ? tinhTrang(ton, toiThieu) : 'chua_ro'
}

/** Tình trạng trên MỘT listing: TikTok tin tồn sàn (khách thấy đúng số đó); sàn khác chỉ tin khi > 0 (tồn Shopee đang ghi 0 hết) */
export function tinhTrangSan(platform: unknown, tonSan: unknown): TinhTrangHang {
    if (String(platform || '').toLowerCase() === 'tiktok') return tinhTrang(tonSan as any)
    return Number(tonSan) > 0 ? tinhTrang(Number(tonSan)) : 'chua_ro'
}

const HANG_TT: Record<TinhTrangHang, number> = { con_hang: 3, sap_het: 2, chua_ro: 1, het_hang: 0 }
/** Gộp nhiều nguồn: có một nguồn còn hàng là còn; "hết" chỉ khi MỌI nguồn đều hết; không nguồn nào ⇒ chưa rõ */
export function tongTinhTrang(ds: TinhTrangHang[]): TinhTrangHang {
    return ds.length ? ds.reduce((a, b) => (HANG_TT[b] > HANG_TT[a] ? b : a)) : 'chua_ro'
}

/** Link sản phẩm trên sàn (khách xem giá phân loại / đặt hàng). Chỉ dựng khi mã là SỐ — đo 20/10: 100% listing đang bán. */
export function linkSan(platform: unknown, shopId: unknown, maSp: unknown): string | null {
    const san = String(platform || '').toLowerCase()
    const id = String(maSp ?? '').trim()
    if (!/^\d{5,25}$/.test(id)) return null
    if (san === 'shopee') {
        const shop = String(shopId ?? '').trim()
        return /^\d{3,20}$/.test(shop) ? `https://shopee.vn/product/${shop}/${id}` : null
    }
    if (san === 'tiktok') return `https://shop.tiktok.com/view/product/${id}?region=VN&locale=vi-VN`
    return null
}

/** Cắt mô tả ở ranh giới từ, gom khoảng trắng / dòng trống */
export function catMoTa(s: unknown, max: number): string {
    const t = String(s ?? '').replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
    if (t.length <= max) return t
    const cut = t.slice(0, max)
    const i = Math.max(cut.lastIndexOf(' '), cut.lastIndexOf('\n'))
    return `${(i > max * 0.6 ? cut.slice(0, i) : cut).trim()}…`
}

export interface GiaSan {
    san: string
    /** giá đang bán trên sàn — null = tuỳ phân loại (Shopee lưu giá ở phân loại) ⇒ gửi link cho khách */
    gia: number | null
    tinhTrang: TinhTrangHang
    link: string | null
}

export interface SanPhamChatbot {
    ten: string
    ma: string | null
    /** giá THẤP NHẤT có thật trong các sàn (không gắn shop: giá bán lẻ) — null = chưa rõ */
    gia: number | null
    giaTheoSan: GiaSan[]
    /** con_hang / sap_het: có bằng chứng còn · het_hang: SÀN báo hết · chua_ro: KHÔNG khẳng định với khách */
    tinhTrang: TinhTrangHang
    moTa: string
    thuongHieu: string | null
    nhomHang: string | null
    anh: string | null
}

/** Điểm khớp chữ để xếp: trùng mã > từ khoá nằm ở đầu từ trong tên sàn / tên hàng */
function diemKhop(r: any, tu: string[], ma: string): number {
    let d = 0
    const ten = boDauTim(`${r.tenSan || ''} ${r.tenHang || ''}`)
    if (ma && [r.maSan, r.maHang].some((x: any) => String(x || '').toLowerCase() === ma.toLowerCase())) d += 100
    for (const t of tu) if (new RegExp(`(^|[^a-z0-9])${t}`).test(ten)) d += 3
    return d
}

/**
 * Gom dòng (mỗi dòng = 1 listing hoặc 1 hàng kho) thành SẢN PHẨM: cùng hàng kho ⇒ một sản phẩm; giá / tình trạng / link
 * TỪNG SÀN. Tình trạng chung = tốt nhất trong (từng sàn, tồn kho DƯƠNG) — xem tinhTrangSan / tinhTrangKho.
 */
export function gomSanPham(rows: any[], tu: string[], ma: string, limit: number, chiTiet = false): SanPhamChatbot[] {
    const nhom = new Map<string, any[]>()
    for (const r of rows || []) {
        const khoa = r.hangId ? `h:${r.hangId}` : r.maSan ? `m:${String(r.maSan).toLowerCase()}` : `l:${r.id}`
        if (!nhom.has(khoa)) nhom.set(khoa, [])
        nhom.get(khoa)!.push(r)
    }
    const ds = Array.from(nhom.values()).map(g => {
        const dau = g[0]
        const giaTheoSan: GiaSan[] = []
        for (const r of g) {
            if (!r.platform) continue
            const san = TEN_SAN[String(r.platform).toLowerCase()] || String(r.platform)
            const gia = Number(r.giaSan) > 0 ? Math.round(Number(r.giaSan)) : null
            const tt = tinhTrangSan(r.platform, r.tonSan)
            const link = linkSan(r.platform, r.shopSan, r.maSpSan)
            // nhiều listing cùng sàn (đăng trùng) ⇒ giữ giá THẤP NHẤT có thật (kèm link của nó), tình trạng tốt nhất
            const co = giaTheoSan.find(x => x.san === san)
            if (!co) { giaTheoSan.push({ san, gia, tinhTrang: tt, link }); continue }
            if (gia !== null && (co.gia === null || gia < co.gia)) { co.gia = gia; if (link) co.link = link }
            co.tinhTrang = tongTinhTrang([co.tinhTrang, tt])
            if (!co.link) co.link = link
        }
        const coGia = giaTheoSan.map(x => x.gia).filter((x): x is number => x !== null)
        const giaLe = Number(dau.giaLe) > 0 ? Math.round(Number(dau.giaLe)) : null
        const kho = dau.hangId ? tinhTrangKho(dau.tonKho, dau.tonToiThieu) : 'chua_ro'
        const tt = tongTinhTrang([...giaTheoSan.map(x => x.tinhTrang), ...(kho !== 'chua_ro' ? [kho] : [])])
        const sp: SanPhamChatbot = {
            ten: String(dau.tenSan || dau.tenHang || ''),
            ma: dau.maHang || dau.maSan || null,
            gia: giaTheoSan.length ? (coGia.length ? Math.min(...coGia) : null) : giaLe,
            giaTheoSan,
            tinhTrang: tt,
            moTa: catMoTa(dau.moTa, chiTiet ? MO_TA_CHI_TIET : MO_TA_TIM),
            thuongHieu: dau.thuongHieu || null,
            nhomHang: dau.nhomHang || null,
            anh: dau.anhHang || g.find(r => r.anhSan)?.anhSan || null,
        }
        const d = Math.max(...g.map(r => diemKhop(r, tu, ma))) + (tt === 'con_hang' || tt === 'sap_het' ? 2 : 0)
        return { sp, d }
    })
    ds.sort((a, b) => b.d - a.d || a.sp.ten.length - b.sp.ten.length)
    return ds.slice(0, limit).map(x => x.sp)
}
