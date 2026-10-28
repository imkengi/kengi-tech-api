/**
 * GIỚI THIỆU SẢN PHẨM MỖI NGÀY QUA ZALO (28/10/2026)
 *
 * Chủ shop: "thêm giới thiệu sản phẩm, sẽ gồm ảnh và 1 vài thông tin sản phẩm để giới thiệu cho khách mỗi ngày", rồi
 * "có option không gửi giá chứ, mỗi người mỗi giá mà, với lại có chế độ chọn random mỗi ngày gửi sản phẩm 2 hoặc 3".
 *
 * Một lịch gửi định kỳ (lib/zaloLichGui.ts) có thể gắn `gioiThieu`: NGUỒN sản phẩm (chọn từng món, hoặc theo nhóm
 * hàng — kể cả nhóm con, rỗng = mọi nhóm). Mỗi LƯỢT chọn `soMon` (1–3) sản phẩm cho mọi nhóm nhận, theo một trong hai cách:
 *  - lần lượt: món chưa giới thiệu lần nào trước (theo thứ tự nguồn), rồi tới món giới thiệu lâu nhất — xoay vòng;
 *  - ngẫu nhiên: bốc ngẫu nhiên trong các món CHƯA gửi 7 ngày gần nhất (không đủ thì lấy các món gửi lâu nhất cho đủ).
 * Ảnh sản phẩm (ảnh đại diện trước, `soAnh` 0–3 ảnh mỗi món) tự gửi kèm, TRƯỚC ảnh thêm của lịch (vd mã QR).
 *
 * Biến: {danhSachSanPham} (khối từng món: tên đậm, giá nếu bật, mô tả) {tenSanPham} {maSanPham} {giaBan} {donVi}
 * {moTaSanPham} {thuongHieu} {nhomHangSp}. `guiGia` = false (mặc định — khách sỉ mỗi người một giá) thì KHÔNG đặt
 * {giaBan} và khối danh sách không có giá; không có mô tả / giá 0 ⇒ biến KHÔNG đặt ⇒ zaloGui.dienMau bỏ cả dòng chứa nó.
 * Nhiều món một lượt thì {giaBan} {donVi} {moTaSanPham} không đặt (dùng {danhSachSanPham}), {tenSanPham} = các tên nối ", ".
 *
 * Trạng thái xoay vòng nằm ở cột ZaloLichGui.gioiThieuDaGui = { [productId]: giờ gửi ISO }, tối đa 1.000 món.
 * Xem trước KHÔNG ghi trạng thái — chỉ lúc tạo đợt thật mới ghi.
 */
import { moRongNhom, dinhTien } from './zaloDoanhSo'

export const TOI_DA_SAN_PHAM = 200
export const TOI_DA_NHOM = 50
export const TOI_DA_ANH = 3
export const TOI_DA_MON_MOI_LUOT = 3
export const TOI_DA_MO_TA = 400
/** Mô tả mỗi món khi gửi NHIỀU món một lượt — ngắn hơn cho tin khỏi dài */
export const TOI_DA_MO_TA_NHIEU = 160
export const TOI_DA_UNG_VIEN = 2000
export const TOI_DA_NHO = 1000
export const NGAY_TRANH_LAP = 7
export const TOI_DA_ANH_DOT = 10

export type CachChon = 'lan_luot' | 'ngau_nhien'

export interface GioiThieuSp {
    nguon: 'chon' | 'nhom'
    /** Nguồn 'chon': xoay vòng theo đúng thứ tự này. `name` chỉ để màn hình hiện lại, không dùng để tra. */
    sanPham: Array<{ id: string; name: string }>
    /** Nguồn 'nhom': nhóm hàng (mở rộng cả nhóm con); rỗng = mọi nhóm */
    categoryIds: string[]
    chiConHang: boolean
    chiCoAnh: boolean
    /** Số ảnh gửi kèm MỖI MÓN (0–3) */
    soAnh: number
    /** Số món mỗi lượt (1–3) */
    soMon: number
    cachChon: CachChon
    /** Gửi giá bán niêm yết? Mặc định KHÔNG (khách sỉ mỗi người một giá) */
    guiGia: boolean
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
    /\{\s*(danhSachSanPham|tenSanPham|maSanPham|giaBan|donVi|moTaSanPham|thuongHieu|nhomHangSp)\s*\}/i.test(String(noiDung || ''))

const kep = (v: any, macDinh: number, thap: number, cao: number): number => {
    const n = v === undefined || v === null || v === '' ? macDinh : Number(v)
    return Math.min(cao, Math.max(thap, Math.round(Number.isFinite(n) ? n : macDinh)))
}

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
    return {
        nguon, sanPham: nguon === 'chon' ? sanPham : [], categoryIds: nguon === 'nhom' ? categoryIds : [],
        chiConHang: raw.chiConHang !== false, chiCoAnh: raw.chiCoAnh !== false,
        soAnh: kep(raw.soAnh, 1, 0, TOI_DA_ANH), soMon: kep(raw.soMon, 1, 1, TOI_DA_MON_MOI_LUOT),
        cachChon: raw.cachChon === 'ngau_nhien' ? 'ngau_nhien' : 'lan_luot', guiGia: raw.guiGia === true,
    }
}

export function moTaGioiThieu(cfg: GioiThieuSp): string {
    const nguon = cfg.nguon === 'chon' ? `${cfg.sanPham.length} sản phẩm đã chọn` : cfg.categoryIds.length ? `sản phẩm trong ${cfg.categoryIds.length} nhóm hàng` : 'sản phẩm mọi nhóm hàng'
    return `giới thiệu ${cfg.soMon} món/lượt${cfg.cachChon === 'ngau_nhien' ? ' ngẫu nhiên' : ''}: ${nguon}${cfg.guiGia ? '' : ', không gửi giá'}`
}

/** Mô tả gửi khách: bỏ \r, cắt ở ranh giới dòng / câu cho vừa `toiDa` ký tự */
export function rutGonMoTa(raw: any, toiDa = TOI_DA_MO_TA): string | null {
    const s = String(raw ?? '').replace(/\r\n?/g, '\n').trim()
    if (!s) return null
    if (s.length <= toiDa) return s
    const cat = s.slice(0, toiDa)
    const moc = Math.max(cat.lastIndexOf('\n'), cat.lastIndexOf('. '), cat.lastIndexOf('; '))
    // Cắt trọn câu thì thêm " …" (có cách) để không ra ".…"; cắt giữa chừng thì nối thẳng "…"
    return moc > toiDa / 2 ? `${cat.slice(0, moc + 1).trim()} …` : `${cat.trim()}…`
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

/** Thứ tự xoay vòng: chưa gửi bao giờ trước (theo thứ tự nguồn), rồi món gửi lâu nhất. Phần tử đầu = lượt này. */
export function thuTuSapToi<T extends { id: string }>(ungVien: T[], daGui: DaGioiThieu | null | undefined, n = 5): T[] {
    return ungVien
        .map((u, i) => ({ u, i, luc: lucGui(daGui, u.id) }))
        .sort((a, b) => a.luc - b.luc || a.i - b.i)
        .slice(0, Math.max(0, n))
        .map(x => x.u)
}

/**
 * Các món của LƯỢT NÀY (tối đa `soMon`). Lần lượt = đầu hàng xoay vòng. Ngẫu nhiên = bốc trong các món CHƯA gửi
 * `NGAY_TRANH_LAP` ngày gần nhất; không đủ thì lấy các món gửi lâu nhất cho đủ rồi mới trộn. `ngauNhien` chỉ để bộ
 * kiểm thay (mặc định Math.random). Không ứng viên ⇒ [].
 */
export function chonSanPhamLuotNay<T extends { id: string }>(
    ungVien: T[], daGui: DaGioiThieu | null | undefined, cfg: Pick<GioiThieuSp, 'soMon' | 'cachChon'>, luc: Date,
    ngauNhien: () => number = Math.random,
): T[] {
    const n = Math.max(1, Math.min(TOI_DA_MON_MOI_LUOT, Math.round(Number(cfg.soMon) || 1)))
    if (!ungVien.length) return []
    if (cfg.cachChon !== 'ngau_nhien') return thuTuSapToi(ungVien, daGui, n)
    const moc = luc.getTime() - NGAY_TRANH_LAP * 86_400_000
    let bo = ungVien.filter(u => lucGui(daGui, u.id) < moc)
    if (bo.length < n) bo = thuTuSapToi(ungVien, daGui, Math.min(ungVien.length, Math.max(n, bo.length)))
    const a = bo.slice()
    for (let i = a.length - 1; i > 0; i--) {          // trộn Fisher–Yates
        const j = Math.floor(Math.min(0.999999, Math.max(0, ngauNhien())) * (i + 1))
        ;[a[i], a[j]] = [a[j], a[i]]
    }
    return a.slice(0, n)
}

/** Ghi "đã giới thiệu" cho một hoặc nhiều món — giữ tối đa TOI_DA_NHO món, bỏ món cũ nhất */
export function ghiDaGioiThieu(daGui: DaGioiThieu | null | undefined, productId: string | string[], luc: Date): DaGioiThieu {
    const d: DaGioiThieu = { ...(daGui || {}) }
    for (const id of Array.isArray(productId) ? productId : [productId]) d[id] = luc.toISOString()
    const khoa = Object.keys(d)
    if (khoa.length > TOI_DA_NHO) {
        khoa.sort((a, b) => lucGui(d, a) - lucGui(d, b))
        for (const k of khoa.slice(0, khoa.length - TOI_DA_NHO)) delete d[k]
    }
    return d
}

/**
 * Biến chèn vào tin cho các món của lượt — thiếu dữ liệu thì KHÔNG đặt biến (dienMau sẽ bỏ dòng).
 * {danhSachSanPham}: mỗi món một khối "[đậm]Tên[/đậm] — giá/đv" + dòng mô tả; nhiều món thì đánh số 1. 2. 3.
 */
export function bienGioiThieu(ds: SanPhamGioiThieu[], cfg: Pick<GioiThieuSp, 'guiGia'>): Record<string, string> {
    if (!ds.length) return {}
    const giaCua = (p: SanPhamGioiThieu) => (cfg.guiGia && p.gia > 0 ? `${dinhTien(p.gia)}/${p.donVi || 'cái'}` : '')
    const b: Record<string, string> = { tenSanPham: ds.map(p => p.name).join(', '), maSanPham: ds.map(p => p.sku).filter(Boolean).join(', ') }
    if (ds.length === 1) {
        const p = ds[0]
        b.donVi = p.donVi || 'cái'
        if (cfg.guiGia && p.gia > 0) b.giaBan = dinhTien(p.gia)
        if (p.moTa) b.moTaSanPham = p.moTa
        if (p.thuongHieu) b.thuongHieu = p.thuongHieu
        if (p.nhomHang) b.nhomHangSp = p.nhomHang
    } else {
        const th = [...new Set(ds.map(p => p.thuongHieu).filter(Boolean))]
        if (th.length) b.thuongHieu = th.join(', ')
        const nh = [...new Set(ds.map(p => p.nhomHang).filter(Boolean))]
        if (nh.length) b.nhomHangSp = nh.join(', ')
    }
    b.danhSachSanPham = ds.map((p, i) => {
        const dau = ds.length > 1 ? `${i + 1}. ` : ''
        const gia = giaCua(p)
        const moTa = ds.length > 1 ? rutGonMoTa(p.moTa, TOI_DA_MO_TA_NHIEU) : p.moTa
        return `${dau}[đậm]${p.name}[/đậm]${gia ? ` — ${gia}` : ''}${moTa ? `\n${moTa}` : ''}`
    }).join('\n')
    return b
}

/** Ảnh gửi kèm của lượt: mỗi món tối đa `soAnh` ảnh (đại diện trước), cả lượt tối đa TOI_DA_ANH_DOT */
export const anhGioiThieu = (ds: SanPhamGioiThieu[], soAnh: number): string[] => {
    const moiMon = Math.max(0, Math.min(TOI_DA_ANH, soAnh))
    return ds.flatMap(p => p.anh.slice(0, moiMon)).slice(0, TOI_DA_ANH_DOT)
}
