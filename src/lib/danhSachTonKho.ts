/**
 * DANH SÁCH TỒN KHO cho trang Kho — GET /api/inventory/ton-kho (20/10/2026, chủ shop: "làm lại cho nhanh, gọn hơn").
 *
 * Trang Kho cũ tải `GET /products?pageSize=9999` (máy chủ chặn trần 1.000 mã) rồi lọc / sắp xếp trên trình duyệt: cửa hàng hơn
 * 1.000 mã (KENGISTORE 3.273) bị CẮT không báo, tìm kiếm có thể ra thiếu, và cả trang đứng chờ tải hết mới hiện. Nay lọc + sắp +
 * phân trang trong SQL: một câu đếm (tổng dòng / tổng tồn / tổng giá trị của CẢ tập lọc) + một câu lấy trang.
 *
 * Vị từ trạng thái giống lib/tonKho.ts nhưng áp trên TỒN ĐANG XEM (kho chọn / kho chính chi nhánh / tồn tổng):
 *   het = tồn ≤ 0 · sap-het = 0 < tồn ≤ tồn tối thiểu · con = tồn > tồn tối thiểu · am = tồn < 0.
 * Bỏ hàng dịch vụ và mã đã gộp (như /inventory/overview). Mọi giá trị người dùng đi qua THAM SỐ ($n), không ghép chuỗi.
 */

export interface ThamSoTonKho {
    q: string
    trangThai: '' | 'het' | 'sap-het' | 'con' | 'am'
    /** id danh mục — trình duyệt đã gộp danh mục con */
    danhMuc: string[]
    tonTu: number | null
    tonDen: number | null
    giaTriTu: number | null
    giaTriDen: number | null
    sapXep: 'ton' | 'ten' | 'gia-tri' | 'moi'
    chieu: 'asc' | 'desc'
    trang: number
    soDong: number
    /** Kho chọn ở đầu trang: chỉ mã có tồn ≠ 0 ở kho đó (như lọc kho của trang cũ) */
    khoId: string | null
    /** Kho chính của chi nhánh đang xem (route tra từ branchId): mọi mã, tồn = tồn kho này */
    khoChiNhanhId: string | null
}

const TRANG_THAI = ['het', 'sap-het', 'con', 'am'] as const
const SAP_XEP = ['ton', 'ten', 'gia-tri', 'moi'] as const

/** Bảng bỏ dấu tiếng Việt cho translate() — thường + HOA, cùng độ dài với KHONG_DAU (ca kiểm canh) */
const DAU_THUONG = 'àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ'
const BO_DAU = 'aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyyd'
export const CO_DAU = DAU_THUONG + DAU_THUONG.toUpperCase()
export const KHONG_DAU = BO_DAU + BO_DAU

/** Chữ người gõ → thường, không dấu (NFD bỏ dấu kết hợp, đ → d) — khớp vế translate(lower(name)) */
export function boDauTim(s: string): string {
    return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd').toLowerCase()
}

/** Đọc + chặn tham số từ req.query (chuỗi lạ ⇒ mặc định, số trang/dòng có trần) */
export function docThamSoTonKho(qs: Record<string, any>): ThamSoTonKho {
    const so = (v: any) => (v === undefined || v === null || String(v).trim() === '' || !Number.isFinite(Number(v)) ? null : Number(v))
    const tt = String(qs.trangThai || '')
    const sx = String(qs.sapXep || 'ton')
    return {
        q: String(qs.q || '').trim().slice(0, 100),
        trangThai: (TRANG_THAI as readonly string[]).includes(tt) ? tt as ThamSoTonKho['trangThai'] : '',
        danhMuc: String(qs.danhMuc || '').split(',').map(x => x.trim()).filter(Boolean).slice(0, 500),
        tonTu: so(qs.tonTu), tonDen: so(qs.tonDen), giaTriTu: so(qs.giaTriTu), giaTriDen: so(qs.giaTriDen),
        sapXep: (SAP_XEP as readonly string[]).includes(sx) ? sx as ThamSoTonKho['sapXep'] : 'ton',
        chieu: String(qs.chieu || 'asc') === 'desc' ? 'desc' : 'asc',
        trang: Math.max(1, parseInt(String(qs.trang || '1'), 10) || 1),
        soDong: Math.min(100, Math.max(1, parseInt(String(qs.soDong || '50'), 10) || 50)),
        khoId: String(qs.khoId || '').trim() || null,
        khoChiNhanhId: null,
    }
}

/** Dựng hai câu SQL (đếm + trang) cùng một mảng tham số. HÀM THUẦN — scripts/check-ton-kho-ds.ts */
export function cauTonKho(ts: ThamSoTonKho): { sqlTong: string; sqlDong: string; tham: unknown[]; theoKho: boolean; theoChiNhanh: boolean } {
    const tham: unknown[] = []
    const dat = (v: unknown) => { tham.push(v); return `$${tham.length}` }

    let JOIN = '', ST = 'p.stock'
    if (ts.khoId) {
        JOIN = `JOIN "WarehouseStock" ws ON ws."productId" = p.id AND ws."warehouseId" = ${dat(ts.khoId)} AND ws.quantity <> 0`
        ST = 'ws.quantity'
    } else if (ts.khoChiNhanhId) {
        JOIN = `LEFT JOIN "WarehouseStock" ws ON ws."productId" = p.id AND ws."warehouseId" = ${dat(ts.khoChiNhanhId)}`
        ST = 'COALESCE(ws.quantity, 0)'
    }

    const dk: string[] = [`COALESCE(p."productType", 'goods') <> 'service'`, `p."mergedIntoId" IS NULL`]
    if (ts.q) {
        /* Tên tìm KHÔNG DẤU: gõ "noi com" ra "Nồi cơm". CSDL prod chưa cài unaccent (đo 20/10/2026 — không tự cài extension lên
         * prod) ⇒ translate() bảng chữ có dấu → không dấu: đo HUTI "noi com" = "nồi cơm" = 91 mã, 133 ms / 3.610 mã.
         * SKU / mã vạch so nguyên chuỗi (ILIKE). %, _ và \ người gõ là chữ thường, không phải ký tự đại diện. */
        const thoat = (x: string) => x.replace(/[%_\\]/g, m => '\\' + m)
        const goc = dat(`%${thoat(ts.q)}%`)
        const khongDau = dat(`%${thoat(boDauTim(ts.q))}%`)
        dk.push(`(translate(lower(p.name), ${dat(CO_DAU)}, ${dat(KHONG_DAU)}) LIKE ${khongDau} OR p.sku ILIKE ${goc} OR p.barcode ILIKE ${goc})`)
    }
    if (ts.danhMuc.length) dk.push(`p."categoryId" IN (${ts.danhMuc.map(d => dat(d)).join(', ')})`)

    const loc: string[] = []
    if (ts.trangThai === 'het') loc.push('ton <= 0')
    else if (ts.trangThai === 'sap-het') loc.push('ton > 0 AND ton <= "tonToiThieu"')
    else if (ts.trangThai === 'con') loc.push('ton > "tonToiThieu"')
    else if (ts.trangThai === 'am') loc.push('ton < 0')
    // so sánh số: ép kiểu tham số để Postgres không phải đoán
    if (ts.tonTu !== null) loc.push(`ton >= ${dat(ts.tonTu)}::float8`)
    if (ts.tonDen !== null) loc.push(`ton <= ${dat(ts.tonDen)}::float8`)
    if (ts.giaTriTu !== null) loc.push(`"giaTri" >= ${dat(ts.giaTriTu)}::float8`)
    if (ts.giaTriDen !== null) loc.push(`"giaTri" <= ${dat(ts.giaTriDen)}::float8`)

    const ds = `WITH ds AS (
        SELECT p.id, p.sku, p.name AS ten, p."baseUnit" AS dvt, p.barcode AS "maVach", p."categoryId" AS "danhMucId",
               c.name AS "danhMuc", p."createdAt" AS "taoLuc",
               (${ST})::float8 AS ton, COALESCE(p."minStock", 0)::float8 AS "tonToiThieu",
               COALESCE(p."costPrice", 0)::float8 AS "giaVon", COALESCE(p."sellingPrice", 0)::float8 AS "giaBan",
               ((${ST}) * COALESCE(p."costPrice", 0))::float8 AS "giaTri"
        FROM "Product" p ${JOIN} LEFT JOIN "Category" c ON c.id = p."categoryId"
        WHERE ${dk.join(' AND ')}
    )`
    const where = loc.length ? `WHERE ${loc.join(' AND ')}` : ''
    const COT: Record<ThamSoTonKho['sapXep'], string> = { ton: 'ton', ten: 'ten', 'gia-tri': '"giaTri"', moi: '"taoLuc"' }
    const chieu = ts.chieu === 'desc' ? 'DESC' : 'ASC'
    return {
        sqlTong: `${ds} SELECT COUNT(*)::int AS tong, COALESCE(SUM(ton), 0)::float8 AS "tongTon", COALESCE(SUM("giaTri"), 0)::float8 AS "tongGiaTri" FROM ds ${where}`,
        // LIMIT/OFFSET là số đã chặn ở docThamSoTonKho — ghép thẳng an toàn
        sqlDong: `${ds} SELECT * FROM ds ${where} ORDER BY ${COT[ts.sapXep]} ${chieu}, ten ASC, id ASC LIMIT ${ts.soDong} OFFSET ${(ts.trang - 1) * ts.soDong}`,
        tham,
        theoKho: !!ts.khoId,
        theoChiNhanh: !ts.khoId && !!ts.khoChiNhanhId,
    }
}
