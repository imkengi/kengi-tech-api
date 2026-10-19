/**
 * LIÊN KẾT HÀNG HOÁ KENGI ↔ VẬT TƯ MISA (19/10/2026) — trang "Đẩy HĐ sang MISA" › Liên kết hàng hoá
 *
 * Chứng từ bán đẩy lên MISA phải mang ĐÚNG mã vật tư MISA. Mã Kengi của HUTI đến từ KiotViet nên phần lớn KHÔNG trùng mã
 * MISA (công cụ cũ link-hang-hoa-kv-misa.html ghi mã KiotViet vào cột PRTCODE của Google Sheet — 1.531/1.554 dòng có mã).
 *
 * Cách tra mã MISA của một hàng Kengi (cùng thứ tự với misaPush.maMisaQuaMap — hai nơi PHẢI khớp nhau):
 *   1. 'noi'      — dòng MisaMap (entity 'product', localId = id hàng Kengi) người dùng nối tay / nhập từ PRTCODE
 *   2. 'trung-ma' — không nối nhưng SKU Kengi trùng một mã vật tư MISA (không phân biệt hoa thường) ⇒ tự khớp, không cần ghi
 *   3. 'chua'     — chưa có ⇒ phiếu có hàng này đứng ở "thiếu" khi đẩy; gợi ý theo tên để người dùng chọn
 *   'noi-hong'    — đã nối nhưng vật tư MISA đó không còn trong danh mục (bị xoá bên MISA) ⇒ nối lại
 *
 * MisaMap unique (entity, misaId): một vật tư MISA chỉ nối MỘT hàng Kengi. Nối vật tư đang thuộc hàng khác ⇒ báo xung đột,
 * chỉ chuyển khi người dùng xác nhận (`chuyen`). Gợi ý theo tên KHÔNG bao giờ tự ghi — tên giống nhau chưa chắc cùng hàng.
 */
import type { DanhMucMisa } from '../services/misaPush'

export type VatTuMisa = { id: string; ma: string; ten: string; dvt: string | null; ngung?: boolean }
export type KieuLienKet = 'noi' | 'noi-hong' | 'trung-ma' | 'chua'
export type LienKet = { kieu: KieuLienKet; vt: VatTuMisa | null; maDaNoi?: string | null }

const khoaMa = (m: string) => String(m || '').trim().toUpperCase()
/** Bỏ dấu tiếng Việt + chữ thường — để "Đá cắt" khớp "DA CAT" */
export const boDau = (s: any) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase()
/** Tách từ để so tên: bỏ dấu, cắt theo ký tự không phải chữ/số; bỏ từ 1 ký tự trừ khi là số */
export const tachTu = (s: any) => boDau(s).split(/[^a-z0-9]+/).filter(t => t.length >= 2 || /\d/.test(t))

/** misaId lưu vào MisaMap: id MISA; vật tư không có id (hiếm) thì khoá theo mã */
export const misaIdCua = (vt: VatTuMisa) => vt.id || `ma:${vt.ma}`

// ─── Chỉ mục tìm theo tên ───────────────────────────────────────────────────

export interface ChiMucMisa {
    ds: VatTuMisa[]
    theoTu: Map<string, number[]>
    idf: Map<string, number>
    tongIdf: number[]
}

export function dungChiMuc(dm: DanhMucMisa): ChiMucMisa {
    const ds = [...dm.vatTuTheoMa.values()]
    const theoTu = new Map<string, number[]>()
    const tuCua: string[][] = []
    ds.forEach((v, i) => {
        const tu = [...new Set([...tachTu(v.ten), ...tachTu(v.ma)])]
        tuCua.push(tu)
        for (const t of tu) {
            const a = theoTu.get(t)
            if (a) a.push(i); else theoTu.set(t, [i])
        }
    })
    const N = Math.max(1, ds.length)
    const idf = new Map<string, number>()
    for (const [t, a] of theoTu) idf.set(t, Math.log(1 + N / a.length))
    const tongIdf = tuCua.map(tu => tu.reduce((s, t) => s + (idf.get(t) || 0), 0))
    return { ds, theoTu, idf, tongIdf }
}

export type GoiY = { ma: string; ten: string; dvt: string | null; diem: number; ngung?: boolean }

/**
 * Gợi ý vật tư MISA cho một hàng Kengi. Điểm (0..1) = 2·Σidf(từ chung) / (Σidf từ hàng Kengi + Σidf từ vật tư MISA)
 * — từ hiếm ("SZP125", "1.8L") nặng ký hơn từ phổ biến ("den", "led"). Từ có mặt ở > 400 vật tư bỏ qua cho nhanh.
 */
export function goiYVatTu(cm: ChiMucMisa, ten: string, sku: string, n = 3, nguong = 0.3): GoiY[] {
    const tu = [...new Set([...tachTu(ten), ...tachTu(sku)])]
    if (!tu.length || !cm.ds.length) return []
    const idfMax = Math.log(1 + cm.ds.length)
    const tongHang = tu.reduce((s, t) => s + (cm.idf.get(t) ?? idfMax), 0)
    const chung = new Map<number, number>()
    for (const t of tu) {
        const a = cm.theoTu.get(t)
        if (!a || a.length > 400) continue
        const w = cm.idf.get(t) || 0
        for (const i of a) chung.set(i, (chung.get(i) || 0) + w)
    }
    const kq: GoiY[] = []
    for (const [i, c] of chung) {
        const diem = (2 * c) / (tongHang + cm.tongIdf[i])
        if (diem >= nguong) kq.push({ ma: cm.ds[i].ma, ten: cm.ds[i].ten, dvt: cm.ds[i].dvt, diem: Math.round(diem * 100) / 100, ngung: cm.ds[i].ngung })
    }
    return kq.sort((a, b) => b.diem - a.diem).slice(0, n)
}

/** Tìm vật tư MISA cho ô chọn tay: mã chứa chuỗi tìm, hoặc tên chứa MỌI từ tìm (bỏ dấu). Mã khớp đúng lên đầu. */
export function timVatTu(cm: ChiMucMisa, q: string, n = 30): VatTuMisa[] {
    const k = khoaMa(q)
    const tu = tachTu(q)
    if (!k) return cm.ds.slice(0, n)
    const kq: { v: VatTuMisa; hang: number }[] = []
    for (const v of cm.ds) {
        const ma = khoaMa(v.ma)
        if (ma === k) kq.push({ v, hang: 0 })
        else if (ma.includes(k)) kq.push({ v, hang: 1 })
        else if (tu.length) {
            const ten = boDau(v.ten)
            if (tu.every(t => ten.includes(t))) kq.push({ v, hang: 2 })
        }
    }
    return kq.sort((a, b) => a.hang - b.hang || a.v.ma.localeCompare(b.v.ma)).slice(0, n).map(x => x.v)
}

// ─── Trạng thái liên kết ────────────────────────────────────────────────────

/** Trạng thái liên kết của từng hàng Kengi — tra MisaMap MỘT lượt cho cả danh sách (lô 1000) */
export async function trangThaiLienKet(sp: any, dm: DanhMucMisa, hang: { id: string; sku: string | null }[]): Promise<Map<string, LienKet>> {
    const noi = new Map<string, { misaId: string; misaCode: string | null }>()
    const ids = hang.map(h => h.id)
    for (let i = 0; i < ids.length; i += 1000) {
        const rows: any[] = await sp.misaMap.findMany({
            where: { entity: 'product', localId: { in: ids.slice(i, i + 1000) } },
            select: { localId: true, misaId: true, misaCode: true },
        })
        for (const r of rows) noi.set(r.localId, { misaId: String(r.misaId), misaCode: r.misaCode })
    }
    const kq = new Map<string, LienKet>()
    for (const h of hang) {
        const n = noi.get(h.id)
        if (n) {
            const ma = dm.vatTuTheoId.get(n.misaId) || n.misaCode || ''
            const vt = ma ? dm.vatTuTheoMa.get(khoaMa(ma)) || null : null
            kq.set(h.id, vt ? { kieu: 'noi', vt } : { kieu: 'noi-hong', vt: null, maDaNoi: n.misaCode })
            continue
        }
        const vt = h.sku ? dm.vatTuTheoMa.get(khoaMa(h.sku)) || null : null
        kq.set(h.id, vt ? { kieu: 'trung-ma', vt } : { kieu: 'chua', vt: null })
    }
    return kq
}

// ─── Nối / bỏ nối ───────────────────────────────────────────────────────────

export type KetQuaNoi =
    | { ok: true; vt: VatTuMisa; daChuyenTu?: string | null }
    | { ok: false; loi: string; xungDot?: { productId: string; sku: string | null; ten: string } }

/** Nối hàng Kengi với vật tư MISA theo MÃ MISA. Vật tư đang nối hàng khác ⇒ trả xung đột trừ khi `chuyen`. */
export async function noiHang(sp: any, dm: DanhMucMisa, productId: string, maMisa: string, chuyen = false): Promise<KetQuaNoi> {
    const vt = dm.vatTuTheoMa.get(khoaMa(maMisa))
    if (!vt) return { ok: false, loi: `Mã "${maMisa}" không có trong danh mục vật tư MISA` }
    const hang = await sp.product.findUnique({ where: { id: productId }, select: { id: true } })
    if (!hang) return { ok: false, loi: 'Không thấy hàng Kengi này' }
    const misaId = misaIdCua(vt)
    const dang = await sp.misaMap.findUnique({ where: { entity_misaId: { entity: 'product', misaId } } })
    let daChuyenTu: string | null = null
    if (dang && dang.localId !== productId) {
        const khac = await sp.product.findUnique({ where: { id: dang.localId }, select: { id: true, sku: true, name: true } })
        if (khac && !chuyen) {
            return { ok: false, loi: `Vật tư MISA ${vt.ma} đang nối với ${khac.sku || ''} ${khac.name}`.trim(), xungDot: { productId: khac.id, sku: khac.sku, ten: khac.name } }
        }
        daChuyenTu = khac?.id ?? null
    }
    await sp.$transaction(async (tx: any) => {
        // một hàng Kengi chỉ một mã MISA: bỏ các nối cũ của hàng này sang vật tư khác
        await tx.misaMap.deleteMany({ where: { entity: 'product', localId: productId, NOT: { misaId } } })
        await tx.misaMap.upsert({
            where: { entity_misaId: { entity: 'product', misaId } },
            create: { entity: 'product', misaId, misaCode: vt.ma, localId: productId, syncedAt: new Date() },
            update: { misaCode: vt.ma, localId: productId, syncedAt: new Date() },
        })
    })
    return { ok: true, vt, daChuyenTu }
}

export async function boNoiHang(sp: any, productId: string): Promise<number> {
    const r = await sp.misaMap.deleteMany({ where: { entity: 'product', localId: productId } })
    return r?.count ?? 0
}

// ─── Nhập liên kết cũ (cột PRTCODE của Google Sheet "Product n8n") ──────────

export type ViecNhap = 'se-noi' | 'da-noi' | 'giu-nguyen' | 'trung-ma-san' | 'dang-noi-khac' | 'ma-misa-dang-noi-hang-khac'
    | 'khong-co-tren-misa' | 'khong-thay-hang-kengi' | 'dong-trong'
export type DongNhap = { maMisa: string; maKv: string; viec: ViecNhap; hang?: string; lyDo?: string }

/**
 * Mỗi dòng: mã vật tư MISA + mã KiotViet (PRTCODE). Hàng Kengi tra theo bảng nối KiotViet (kvCode) TRƯỚC rồi SKU — cùng
 * cách đồng bộ KiotViet tìm hàng. MẶC ĐỊNH CHẠY THỬ. Không đè nối tay đang có (trừ `ghiDe`), không cướp vật tư đang nối hàng khác.
 */
export async function nhapLienKetPrtcode(
    sp: any, dm: DanhMucMisa, dong: { maMisa: string; maKv: string }[], opts: { apply: boolean; ghiDe?: boolean },
): Promise<{ ds: DongNhap[]; dem: Record<string, number> }> {
    const sach = dong.map(d => ({ maMisa: String(d?.maMisa ?? '').trim(), maKv: String(d?.maKv ?? '').trim() }))
    const maKvs = [...new Set(sach.map(d => d.maKv).filter(Boolean))]
    // hàng Kengi theo mã KiotViet: bảng nối kvCode → localId, rồi SKU
    const theoKv = new Map<string, string>()
    for (let i = 0; i < maKvs.length; i += 1000) {
        const lo = maKvs.slice(i, i + 1000)
        const noiKv: any[] = await sp.kiotVietMap.findMany({ where: { entity: 'product', kvCode: { in: lo } }, select: { kvCode: true, localId: true } })
        for (const r of noiKv) if (r.kvCode && !theoKv.has(r.kvCode)) theoKv.set(r.kvCode, r.localId)
        const theoSku: any[] = await sp.product.findMany({ where: { sku: { in: lo.filter(m => !theoKv.has(m)) } }, select: { id: true, sku: true } })
        for (const p of theoSku) if (!theoKv.has(p.sku)) theoKv.set(p.sku, p.id)
    }
    const hangIds = [...new Set(theoKv.values())]
    const hangs: any[] = hangIds.length ? await sp.product.findMany({ where: { id: { in: hangIds } }, select: { id: true, sku: true, name: true } }) : []
    const hangTheoId = new Map<string, any>(hangs.map(h => [h.id, h]))
    const lk = await trangThaiLienKet(sp, dm, hangs.map(h => ({ id: h.id, sku: h.sku })))
    // vật tư MISA đang nối hàng nào (để không cướp)
    const misaIds = [...new Set(sach.map(d => dm.vatTuTheoMa.get(khoaMa(d.maMisa))).filter(Boolean).map(v => misaIdCua(v!)))]
    const dangNoi = new Map<string, string>()
    for (let i = 0; i < misaIds.length; i += 1000) {
        const rows: any[] = await sp.misaMap.findMany({ where: { entity: 'product', misaId: { in: misaIds.slice(i, i + 1000) } }, select: { misaId: true, localId: true } })
        for (const r of rows) dangNoi.set(String(r.misaId), r.localId)
    }

    const ds: DongNhap[] = []
    const daDungHang = new Set<string>(), daDungVt = new Set<string>()
    for (const d of sach) {
        if (!d.maMisa || !d.maKv) { ds.push({ ...d, viec: 'dong-trong' }); continue }
        const vt = dm.vatTuTheoMa.get(khoaMa(d.maMisa))
        if (!vt) { ds.push({ ...d, viec: 'khong-co-tren-misa' }); continue }
        const hid = theoKv.get(d.maKv)
        const h = hid ? hangTheoId.get(hid) : null
        if (!h) { ds.push({ ...d, viec: 'khong-thay-hang-kengi' }); continue }
        const nhan = `${h.sku || ''} ${h.name}`.trim()
        const hienTai = lk.get(h.id)
        const misaId = misaIdCua(vt)
        if (hienTai?.vt && khoaMa(hienTai.vt.ma) === khoaMa(vt.ma)) {
            ds.push({ ...d, hang: nhan, viec: hienTai.kieu === 'trung-ma' ? 'trung-ma-san' : 'giu-nguyen' }); continue
        }
        if (hienTai?.kieu === 'noi' && !opts.ghiDe) {
            ds.push({ ...d, hang: nhan, viec: 'dang-noi-khac', lyDo: `Đang nối tay với ${hienTai.vt?.ma} — bật "ghi đè" nếu muốn thay` }); continue
        }
        const chu = dangNoi.get(misaId)
        if ((chu && chu !== h.id) || daDungVt.has(misaId)) {
            ds.push({ ...d, hang: nhan, viec: 'ma-misa-dang-noi-hang-khac', lyDo: 'Vật tư MISA này đã nối với hàng Kengi khác' }); continue
        }
        if (daDungHang.has(h.id)) { ds.push({ ...d, hang: nhan, viec: 'dang-noi-khac', lyDo: 'Hàng Kengi này đã nhận một mã MISA khác ở dòng trước trong file' }); continue }
        daDungHang.add(h.id); daDungVt.add(misaId)
        if (opts.apply) {
            await sp.$transaction(async (tx: any) => {
                await tx.misaMap.deleteMany({ where: { entity: 'product', localId: h.id, NOT: { misaId } } })
                await tx.misaMap.upsert({
                    where: { entity_misaId: { entity: 'product', misaId } },
                    create: { entity: 'product', misaId, misaCode: vt.ma, localId: h.id, syncedAt: new Date() },
                    update: { misaCode: vt.ma, localId: h.id, syncedAt: new Date() },
                })
            })
        }
        ds.push({ ...d, hang: nhan, viec: opts.apply ? 'da-noi' : 'se-noi' })
    }
    const dem: Record<string, number> = {}
    for (const x of ds) dem[x.viec] = (dem[x.viec] || 0) + 1
    return { ds, dem }
}
