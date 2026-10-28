/**
 * GIỚI THIỆU SẢN PHẨM MỖI NGÀY QUA ZALO (28/10/2026)
 *
 * Chủ shop: "thêm giới thiệu sản phẩm, sẽ gồm ảnh và 1 vài thông tin sản phẩm để giới thiệu cho khách mỗi ngày".
 *
 * Một lịch gửi định kỳ (lib/zaloLichGui.ts) có thể gắn `gioiThieu`: NGUỒN sản phẩm (chọn từng món, hoặc theo nhóm
 * hàng — kể cả nhóm con, rỗng = mọi nhóm). Mỗi LƯỢT chọn đúng MỘT sản phẩm cho mọi nhóm nhận: món chưa giới thiệu
 * lần nào trước (theo thứ tự nguồn), rồi tới món giới thiệu lâu nhất — xoay vòng, không lặp món hôm qua khi còn món
 * khác. Ảnh sản phẩm (ảnh đại diện trước) tự gửi kèm, TRƯỚC ảnh thêm của lịch (vd mã QR).
 *
 * Biến: {tenSanPham} {maSanPham} {giaBan} {donVi} {moTaSanPham} {thuongHieu} {nhomHangSp}. Không có mô tả / giá 0 /
 * không có thương hiệu ⇒ biến KHÔNG đặt ⇒ zaloGui.dienMau bỏ cả dòng chứa nó (không gửi "Giá: " trống cho khách).
 *
 * Trạng thái xoay vòng nằm ở cột ZaloLichGui.gioiThieuDaGui = { [productId]: giờ gửi ISO }, tối đa 1.000 món.
 * Xem trước KHÔNG ghi trạng thái — chỉ lúc tạo đợt thật mới ghi.
 */
import { moRongNhom, dinhTien } from './zaloDoanhSo'

export const TOI_DA_SAN_PHAM = 200
export const TOI_DA_NHOM = 50
export const TOI_DA_ANH = 3
export const TOI_DA_MO_TA = 400
export const TOI_DA_UNG_VIEN = 2000
export const TOI_DA_NHO = 1000

export interface GioiThieuSp {
    nguon: 'chon' | 'nhom'
    /** Nguồn 'chon': xoay vòng theo đúng thứ tự này. `name` chỉ để màn hình hiện lại, không dùng để tra. */
    sanPham: Array<{ id: string; name: string }>
    /** Nguồn 'nhom': nhóm hàng (mở rộng cả nhóm con); rỗng = mọi nhóm */
    categoryIds: string[]
    chiConHang: boolean
    chiCoAnh: boolean
    /** Số ảnh sản phẩm gửi kèm (0–3) */
    soAnh: number
}
/** productId → giờ giới thiệu gần nhất (ISO) */
export type DaGioiThieu = Record<string, string>

export interface SanPhamGioiThieu {
    id: string; name: string; sku: string; gia: number; donVi: string; moTa: string | null; ton: number
    thuongHieu: string | null; nhomHang: string | null
    /** Link https công khai, ảnh đại diện đứng đầu */
    anh: string[]
}

export const dungBienGioiThieu = (noiDung: string) =>
    /\{\s*(tenSanPham|maSanPham|giaBan|donVi|moTaSanPham|thuongHieu|nhomHangSp)\s*\}/i.test(String(noiDung || ''))

/** Kiểm cấu hình từ thân request. null = lịch không giới thiệu sản phẩm; CHUỖI = lỗi để báo người dùng. */
export function docGioiThieu(raw: any): GioiThieuSp | null | string {
    if (!raw || typeof raw !== 'object') return null
    const nguon = raw.nguon === 'chon' ? 'chon' : raw.nguon === 'nhom' ? 'nhom' : null
    if (!nguon) return 'Nguồn sản phẩm giới thiệu chỉ nhận "chọn từng sản phẩm" hoặc "theo nhóm hàng"'
    const thay = new Set<string>()
    const sanPham: Array<{ id: string; name: string }> = []
    for (const x of Array.isArray(raw.sanPham) ? raw.sanPham : []) {
        const id = String(x?.id ?? '').trim()
        if (!id || thay.has(id)) continue
        thay.add(id)
        sanPham.push({ id, name: String(x?.name ?? '').trim().slice(0, 200) })
    }
    const categoryIds = [...new Set<string>((Array.isArray(raw.categoryIds) ? raw.categoryIds : []).map((c: any) => String(c ?? '').trim()).filter(Boolean))]
    if (nguon === 'chon' && !sanPham.length) return 'Chưa chọn sản phẩm nào để giới thiệu'
    if (sanPham.length > TOI_DA_SAN_PHAM) return `Tối đa ${TOI_DA_SAN_PHAM} sản phẩm giới thiệu`
    if (categoryIds.length > TOI_DA_NHOM) return `Chọn tối đa ${TOI_DA_NHOM} nhóm hàng để giới thiệu`
    const soAnhTho = raw.soAnh === undefined || raw.soAnh === null ? 1 : Number(raw.soAnh)
    const soAnh = Math.min(TOI_DA_ANH, Math.max(0, Math.round(Number.isFinite(soAnhTho) ? soAnhTho : 1)))
    return {
        nguon, sanPham: nguon === 'chon' ? sanPham : [], categoryIds: nguon === 'nhom' ? categoryIds : [],
        chiConHang: raw.chiConHang !== false, chiCoAnh: raw.chiCoAnh !== false, soAnh,
    }
}

export function moTaGioiThieu(cfg: GioiThieuSp): string {
    if (cfg.nguon === 'chon') return `giới thiệu ${cfg.sanPham.length} sản phẩm đã chọn`
    return cfg.categoryIds.length ? `giới thiệu sản phẩm trong ${cfg.categoryIds.length} nhóm hàng` : 'giới thiệu sản phẩm mọi nhóm hàng'
}

/** Mô tả gửi khách: bỏ \r, cắt ở ranh giới dòng / câu cho vừa TOI_DA_MO_TA ký tự */
export function rutGonMoTa(raw: any): string | null {
    const s = String(raw ?? '').replace(/\r\n?/g, '\n').trim()
    if (!s) return null
    if (s.length <= TOI_DA_MO_TA) return s
    const cat = s.slice(0, TOI_DA_MO_TA)
    const moc = Math.max(cat.lastIndexOf('\n'), cat.lastIndexOf('. '), cat.lastIndexOf('; '))
    // Cắt trọn câu thì thêm " …" (có cách) để không ra ".…"; cắt giữa chừng thì nối thẳng "…"
    return moc > TOI_DA_MO_TA / 2 ? `${cat.slice(0, moc + 1).trim()} …` : `${cat.trim()}…`
}

function docSanPham(r: any): SanPhamGioiThieu {
    const anh = (Array.isArray(r.images) ? r.images : [])
        .slice()
        .sort((a: any, b: any) => Number(!!b.isPrimary) - Number(!!a.isPrimary))
        .map((i: any) => String(i?.url || '').trim())
        .filter((u: string) => /^https:\/\//.test(u))
    return {
        id: r.id, name: String(r.name || '').trim(), sku: String(r.sku || ''), gia: Number(r.sellingPrice) || 0,
        donVi: String(r.baseUnit || 'cái'), moTa: rutGonMoTa(r.description), ton: Number(r.stock) || 0,
        thuongHieu: r.brand?.name ? String(r.brand.name) : null, nhomHang: r.category?.name ? String(r.category.name) : null,
        anh,
    }
}

/**
 * Các sản phẩm đủ điều kiện giới thiệu theo cấu hình: hàng thường (không dịch vụ, không mã đã gộp), còn hàng / có
 * ảnh nếu chọn; hàng KiotViet đánh dấu ngừng kinh doanh bị loại. Nguồn 'chon' giữ đúng thứ tự đã chọn.
 */
export async function ungVienGioiThieu(sp: any, cfg: GioiThieuSp): Promise<SanPhamGioiThieu[]> {
    const where: any = { productType: 'goods', mergedIntoId: null }
    if (cfg.nguon === 'chon') {
        if (!cfg.sanPham.length) return []
        where.id = { in: cfg.sanPham.map(x => x.id) }
    } else if (cfg.categoryIds.length) {
        const { tatCa } = await moRongNhom(sp, cfg.categoryIds)
        if (!tatCa.length) return []          // nhóm đã chọn không còn trong danh mục
        where.categoryId = { in: tatCa }
    }
    if (cfg.chiConHang) where.stock = { gt: 0 }
    if (cfg.chiCoAnh) where.images = { some: {} }
    const rows: any[] = await sp.product.findMany({
        where, take: TOI_DA_UNG_VIEN, orderBy: { name: 'asc' },
        select: {
            id: true, name: true, sku: true, sellingPrice: true, baseUnit: true, description: true, stock: true,
            brand: { select: { name: true } }, category: { select: { name: true } }, images: { select: { url: true, isPrimary: true } },
        },
    })
    const ra = rows.filter(r => !/^\[NGỪNG KINH DOANH/i.test(String(r.description || ''))).map(docSanPham)
    if (cfg.nguon === 'chon') {
        const thuTu = new Map(cfg.sanPham.map((x, i) => [x.id, i]))
        ra.sort((a, b) => (thuTu.get(a.id) ?? 0) - (thuTu.get(b.id) ?? 0))
    }
    return ra
}

const lucGui = (daGui: DaGioiThieu | null | undefined, id: string): number => {
    const t = daGui?.[id] ? Date.parse(daGui[id]) : NaN
    return Number.isFinite(t) ? t : -Infinity      // chưa gửi bao giờ = ưu tiên nhất
}

/** Món của LƯỢT NÀY: chưa gửi bao giờ trước (theo thứ tự nguồn), rồi món gửi lâu nhất. Không có ứng viên ⇒ null. */
export function chonSanPhamHomNay<T extends { id: string }>(ungVien: T[], daGui: DaGioiThieu | null | undefined): T | null {
    let tot: T | null = null, totLuc = Infinity
    for (const u of ungVien) {
        const luc = lucGui(daGui, u.id)
        if (luc < totLuc) { tot = u; totLuc = luc }
    }
    return tot
}

/** Thứ tự các lượt sắp tới (xem trước), phần tử đầu = lượt này */
export function thuTuSapToi<T extends { id: string }>(ungVien: T[], daGui: DaGioiThieu | null | undefined, n = 5): T[] {
    return ungVien
        .map((u, i) => ({ u, i, luc: lucGui(daGui, u.id) }))
        .sort((a, b) => a.luc - b.luc || a.i - b.i)
        .slice(0, n)
        .map(x => x.u)
}

/** Ghi "đã giới thiệu" — giữ tối đa TOI_DA_NHO món, bỏ món cũ nhất */
export function ghiDaGioiThieu(daGui: DaGioiThieu | null | undefined, productId: string, luc: Date): DaGioiThieu {
    const d: DaGioiThieu = { ...(daGui || {}), [productId]: luc.toISOString() }
    const khoa = Object.keys(d)
    if (khoa.length > TOI_DA_NHO) {
        khoa.sort((a, b) => lucGui(d, a) - lucGui(d, b))
        for (const k of khoa.slice(0, khoa.length - TOI_DA_NHO)) delete d[k]
    }
    return d
}

/** Biến chèn vào tin — thiếu dữ liệu thì KHÔNG đặt biến (dienMau sẽ bỏ dòng) */
export function bienGioiThieu(p: SanPhamGioiThieu): Record<string, string> {
    const b: Record<string, string> = { tenSanPham: p.name, maSanPham: p.sku, donVi: p.donVi || 'cái' }
    if (p.gia > 0) b.giaBan = dinhTien(p.gia)
    if (p.moTa) b.moTaSanPham = p.moTa
    if (p.thuongHieu) b.thuongHieu = p.thuongHieu
    if (p.nhomHang) b.nhomHangSp = p.nhomHang
    return b
}

export const anhGioiThieu = (p: SanPhamGioiThieu, soAnh: number): string[] => p.anh.slice(0, Math.max(0, Math.min(TOI_DA_ANH, soAnh)))
