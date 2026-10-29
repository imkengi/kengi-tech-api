/**
 * GỬI HOÁ ĐƠN MISA CHO KHÁCH QUA NHÓM ZALO — phần KHỚP hoá đơn ↔ khách ↔ yêu cầu (28/10/2026)
 *
 * Chủ shop 28/10/2026: "chỉ hoá đơn khách gõ /hoadon thôi" + "hoặc khách lấy định kỳ".
 * Hoá đơn kế toán xuất bên MISA meInvoice (lib/meInvoice.ts) được gửi khi ĐỦ cả ba:
 *   1. Ra được KHÁCH Kengi từ người mua trên hoá đơn: mã đối tượng MISA (bảng nối MisaMap → khách, rồi mã khách Kengi trùng
 *      mã MISA) hoặc MST chỉ ứng MỘT khách. Đây là đúng đường misaPush đẩy chứng từ lên (mã nối → mã Kengi → MST).
 *   2. Khách CÓ YÊU CẦU: bật "Luôn lấy hoá đơn" (khách lấy định kỳ — Customer.luonLayHoaDon), hoặc có phiếu "Lấy HĐ"
 *      (lệnh /hoadon trong nhóm Zalo, hoặc bật tay ở Giao Dịch — Transaction.layHoaDon) trong CUA_SO_NGAY ngày tới ngày hoá đơn.
 *   3. Khách đã nối nhóm Zalo (ZaloNhom).
 * Hoá đơn "Bán cho người tiêu dùng" (không mã đối tượng, không MST — misaPush đẩy mọi phiếu không Lấy HĐ kiểu này) KHÔNG
 * đoán khách: thiếu dữ liệu không phải bằng chứng là của ai.
 *
 * 28/10/2026 chỉ xem trước. 29/10/2026 soi dữ liệu thật HUTI xong ⇒ GỬI ở lib/guiHoaDonMisa.ts (cùng luật này + hỏi lại trạng thái
 * MISA + tải thử PDF + giành hoá đơn trước khi xếp vào hàng đợi Zalo).
 */

import { TRANG_THAI_TINH } from './tinhLaiTongMuaKhach'
import { mstChuan, type HoaDonMisa } from './meInvoice'

/** Phiếu "Lấy HĐ" cách ngày hoá đơn tối đa bấy nhiêu ngày (HĐ gộp cả tháng vẫn lọt) */
export const CUA_SO_NGAY = 45
/** Chênh tiền coi như cùng số (làm tròn thuế) */
const LECH_TIEN = 5

export type KetQuaKhop = 'se_gui' | 'chua_cap_ma' | 'khong_ro_khach' | 'khong_thay_khach' | 'nhieu_khach' | 'khong_yeu_cau' | 'chua_noi_nhom'

export const NHAN_KET_QUA: Record<KetQuaKhop, string> = {
    se_gui: 'Sẽ gửi Zalo',
    chua_cap_ma: 'Chưa cấp mã',
    khong_ro_khach: 'HĐ không ghi mã khách / MST',
    khong_thay_khach: 'Không thấy khách trong Kengi',
    nhieu_khach: 'Trùng nhiều khách',
    khong_yeu_cau: 'Khách không yêu cầu HĐ',
    chua_noi_nhom: 'Khách chưa nối nhóm Zalo',
}

export interface KhachKengi { id: string; code: string; name: string; luonLayHoaDon: boolean }
export interface PhieuLayHd { id: string; receiptNumber: string; total: number; ngay: string; customerId: string }
export interface NhomZalo { groupId: string; tenNhom: string | null }

export interface BangKhach {
    khach: Map<string, KhachKengi>
    /** mã MISA (chữ thường) → id khách qua bảng nối MisaMap */
    theoMaMisa: Map<string, string[]>
    /** mã khách Kengi (chữ thường) → id */
    theoMa: Map<string, string[]>
    /** MST chuẩn → id */
    theoMst: Map<string, string[]>
}

export interface DongXemTruoc {
    hoaDon: HoaDonMisa
    ketQua: KetQuaKhop
    lyDo: string
    khach: KhachKengi | null
    nhom: NhomZalo[]
    /** Phiếu "Lấy HĐ" của khách trong cửa sổ — phiếu trùng số tiền xếp đầu */
    phieu: (PhieuLayHd & { trungTien: boolean })[]
}

const khoa = (v: any) => String(v ?? '').trim().toLowerCase()
const ngayGiua = (a: string, b: string) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86_400_000)
const dinhTien = (n: number) => `${Math.round(n).toLocaleString('vi-VN')}đ`

/** Người mua trên hoá đơn → khách Kengi. Ưu tiên bảng nối MISA, rồi mã trùng, rồi MST (chỉ khi MST ứng đúng một khách). */
export function timKhach(hd: HoaDonMisa, bang: BangKhach): { khach: KhachKengi } | { ketQua: KetQuaKhop; lyDo: string } {
    const ma = khoa(hd.maKhach)
    const mst = hd.mst
    if (!ma && !mst) return { ketQua: 'khong_ro_khach', lyDo: `Người mua "${hd.tenNguoiMua || '—'}" không có mã khách / MST trên hoá đơn — không đoán là của ai` }
    const mot = (ids: string[] | undefined) => [...new Set(ids || [])].filter(id => bang.khach.has(id))
    for (const [ids, cach] of [
        [mot(ma ? bang.theoMaMisa.get(ma) : undefined), `bảng nối MISA (mã ${hd.maKhach})`],
        [mot(ma ? bang.theoMa.get(ma) : undefined), `mã khách ${hd.maKhach}`],
        [mot(mst ? bang.theoMst.get(mst) : undefined), `MST ${mst}`],
    ] as [string[], string][]) {
        if (ids.length === 1) return { khach: bang.khach.get(ids[0])! }
        if (ids.length > 1) {
            const ten = ids.slice(0, 3).map(id => bang.khach.get(id)!.code).join(', ')
            return { ketQua: 'nhieu_khach', lyDo: `${cach} ứng với ${ids.length} khách Kengi (${ten}) — không tự chọn` }
        }
    }
    return { ketQua: 'khong_thay_khach', lyDo: `Không có khách Kengi nào mang ${[ma && `mã ${hd.maKhach}`, mst && `MST ${mst}`].filter(Boolean).join(' / ')}` }
}

/** Phiếu "Lấy HĐ" của khách nằm trong [ngày HĐ − CUA_SO_NGAY, ngày HĐ + 1] — phiếu trùng số tiền lên đầu, rồi phiếu gần ngày HĐ */
export function phieuTrongCuaSo(hd: HoaDonMisa, phieu: PhieuLayHd[], cuaSo = CUA_SO_NGAY): (PhieuLayHd & { trungTien: boolean })[] {
    if (!hd.ngay) return []
    return phieu
        .filter(p => { const d = ngayGiua(p.ngay, hd.ngay!); return d >= -1 && d <= cuaSo })
        .map(p => ({ ...p, trungTien: hd.tongTien !== null && Math.abs(p.total - hd.tongTien) <= LECH_TIEN }))
        .sort((a, b) => Number(b.trungTien) - Number(a.trungTien) || b.ngay.localeCompare(a.ngay))
}

/** Quyết định cho MỘT hoá đơn — hàm thuần (scripts/check-me-invoice.ts) */
export function quyetDinh(
    hd: HoaDonMisa, bang: BangKhach, phieuTheoKhach: Map<string, PhieuLayHd[]>, nhomTheoKhach: Map<string, NhomZalo[]>,
    daCapMa: boolean,
): DongXemTruoc {
    const dong = (ketQua: KetQuaKhop, lyDo: string, khach: KhachKengi | null = null, nhom: NhomZalo[] = [], phieu: DongXemTruoc['phieu'] = []): DongXemTruoc =>
        ({ hoaDon: hd, ketQua, lyDo, khach, nhom, phieu })
    const tim = timKhach(hd, bang)
    if (!('khach' in tim)) return dong(tim.ketQua, tim.lyDo)
    const khach = tim.khach
    const nhom = nhomTheoKhach.get(khach.id) || []
    const phieu = phieuTrongCuaSo(hd, phieuTheoKhach.get(khach.id) || [])
    if (!daCapMa) return dong('chua_cap_ma', 'Hoá đơn chưa được cơ quan thuế cấp mã — chỉ gửi hoá đơn đã cấp mã', khach, nhom, phieu)

    let yeuCau: string
    if (khach.luonLayHoaDon) yeuCau = 'Khách "Luôn lấy hoá đơn" (lấy định kỳ)'
    else if (!hd.ngay) {
        return dong('khong_yeu_cau', 'Không đọc được ngày hoá đơn — không xét được phiếu "Lấy HĐ" (khách không bật "Luôn lấy hoá đơn")', khach, nhom, phieu)
    } else if (phieu.length) {
        const p = phieu[0]
        yeuCau = `Khách yêu cầu HĐ — phiếu ${p.receiptNumber} ngày ${p.ngay.split('-').reverse().join('/')} (${dinhTien(p.total)})${p.trungTien ? ', trùng số tiền' : ''}`
            + (phieu.length > 1 ? ` + ${phieu.length - 1} phiếu khác` : '')
    } else {
        return dong('khong_yeu_cau', `Khách không gõ /hoadon (không có phiếu "Lấy HĐ" trong ${CUA_SO_NGAY} ngày tới ngày HĐ) và không bật "Luôn lấy hoá đơn"`, khach, nhom, phieu)
    }
    if (!nhom.length) return dong('chua_noi_nhom', `${yeuCau} — nhưng khách chưa nối nhóm Zalo nào`, khach, nhom, phieu)
    return dong('se_gui', yeuCau, khach, nhom, phieu)
}

const themVao = (m: Map<string, string[]>, k: string, id: string) => {
    if (!k) return
    const ds = m.get(k)
    if (ds) { if (!ds.includes(id)) ds.push(id) } else m.set(k, [id])
}

const ngayVn = (d: Date) => new Date(d.getTime() + 7 * 3_600_000).toISOString().slice(0, 10)
const CHON_KHACH = { id: true, code: true, name: true, luonLayHoaDon: true, taxCode: true } as const

/** Xem trước gửi cho cả lô hoá đơn — đọc DB (chỉ đọc), quyết định từng hoá đơn */
export async function xemTruocGui(sp: any, hoaDons: HoaDonMisa[], daCapMa: boolean) {
    const bang: BangKhach = { khach: new Map(), theoMaMisa: new Map(), theoMa: new Map(), theoMst: new Map() }
    const nhanKhach = (k: any) => {
        bang.khach.set(k.id, { id: k.id, code: String(k.code || ''), name: String(k.name || ''), luonLayHoaDon: k.luonLayHoaDon === true })
        themVao(bang.theoMa, khoa(k.code), k.id)
        themVao(bang.theoMst, mstChuan(k.taxCode), k.id)
    }
    const ma = [...new Set(hoaDons.map(h => String(h.maKhach || '').trim()).filter(Boolean))]

    // 1. Bảng nối MISA: misaCode = mã đối tượng trên hoá đơn
    for (let i = 0; i < ma.length; i += 500) {
        const rows: any[] = await sp.misaMap.findMany({
            where: { entity: 'customer', misaCode: { in: ma.slice(i, i + 500) } },
            select: { localId: true, misaCode: true },
        })
        for (const r of rows) themVao(bang.theoMaMisa, khoa(r.misaCode), String(r.localId))
    }
    // 2. Khách: theo id bảng nối + theo mã trùng (không phân biệt hoa thường) + mọi khách có MST
    const idNoi = [...new Set([...bang.theoMaMisa.values()].flat())]
    for (let i = 0; i < idNoi.length; i += 500) {
        (await sp.customer.findMany({ where: { id: { in: idNoi.slice(i, i + 500) } }, select: CHON_KHACH })).forEach(nhanKhach)
    }
    for (let i = 0; i < ma.length; i += 200) {
        (await sp.customer.findMany({
            where: { OR: ma.slice(i, i + 200).map(m => ({ code: { equals: m, mode: 'insensitive' } })) },
            select: CHON_KHACH,
        })).forEach(nhanKhach)
    }
    if (hoaDons.some(h => h.mst)) {
        (await sp.customer.findMany({ where: { taxCode: { not: null } }, select: CHON_KHACH, take: 50_000 })).forEach(nhanKhach)
    }

    // 3. Phiếu "Lấy HĐ" + nhóm Zalo của các khách ứng viên
    const ids = [...bang.khach.keys()]
    const phieuTheoKhach = new Map<string, PhieuLayHd[]>()
    const nhomTheoKhach = new Map<string, NhomZalo[]>()
    const ngayHd = hoaDons.map(h => h.ngay).filter((n): n is string => !!n).sort()
    if (ids.length && ngayHd.length) {
        const tu = new Date(Date.parse(ngayHd[0] + 'T00:00:00+07:00') - CUA_SO_NGAY * 86_400_000)
        const den = new Date(Date.parse(ngayHd[ngayHd.length - 1] + 'T23:59:59.999+07:00') + 86_400_000)
        for (let i = 0; i < ids.length; i += 500) {
            const phieu: any[] = await sp.transaction.findMany({
                where: {
                    customerId: { in: ids.slice(i, i + 500) }, layHoaDon: true, status: { in: [...TRANG_THAI_TINH] },
                    OR: [{ transactionDate: { gte: tu, lte: den } }, { transactionDate: null, createdAt: { gte: tu, lte: den } }],
                },
                select: { id: true, receiptNumber: true, total: true, transactionDate: true, createdAt: true, customerId: true },
            })
            for (const p of phieu) {
                const ds = phieuTheoKhach.get(p.customerId) || []
                ds.push({ id: p.id, receiptNumber: String(p.receiptNumber), total: Number(p.total) || 0, ngay: ngayVn(new Date(p.transactionDate || p.createdAt)), customerId: p.customerId })
                phieuTheoKhach.set(p.customerId, ds)
            }
        }
    }
    for (let i = 0; i < ids.length; i += 500) {
        const nhom: any[] = await sp.zaloNhom.findMany({ where: { customerId: { in: ids.slice(i, i + 500) } }, select: { groupId: true, tenNhom: true, customerId: true } })
        for (const n of nhom) {
            const ds = nhomTheoKhach.get(n.customerId) || []
            ds.push({ groupId: String(n.groupId), tenNhom: n.tenNhom || null })
            nhomTheoKhach.set(n.customerId, ds)
        }
    }

    const dong = hoaDons.map(hd => quyetDinh(hd, bang, phieuTheoKhach, nhomTheoKhach, daCapMa))
    const dem = Object.fromEntries((Object.keys(NHAN_KET_QUA) as KetQuaKhop[]).map(k => [k, 0])) as Record<KetQuaKhop, number>
    for (const d of dong) dem[d.ketQua]++
    return { dong, dem }
}
