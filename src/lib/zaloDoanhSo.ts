/**
 * BÁO DOANH SỐ NHÓM HÀNG CHO KHÁCH QUA ZALO (18/10/2026)
 *
 * Chủ shop: "thêm thông báo doanh số của 1 nhóm hàng cho khách hàng". Tin gửi nhóm Zalo chèn
 * {doanhSo} {soLuong} {soDon} {nhomHang} {tuNgay} {denNgay} — mỗi khách nhận số CỦA MÌNH.
 *
 * Doanh số = Σ lineTotal (tiền dòng đã trừ giảm giá dòng) của hàng thuộc nhóm đã chọn + MỌI nhóm
 * con, trên phiếu bán của khách có ngày bán (transactionDate ?? createdAt — KiotViet nhập về có
 * createdAt = lúc nhập) trong kỳ theo NGÀY VN, trạng thái tính doanh thu (completed + partial:
 * đơn ghi nợ VẪN là doanh số). TRỪ hàng trả lại (phiếu trả không bị từ chối) theo giá thực đã bán
 * trên phiếu gốc. Không chia giảm giá CẢ ĐƠN về từng dòng.
 *
 * Số được CHỐT lúc tạo đợt (ZaloDotGuiNhom.bien) — xem trước bao nhiêu thì khách nhận đúng bấy
 * nhiêu, dù đợt gửi giãn nhịp qua nhiều phút. Nhóm Zalo CHƯA nối khách thì không có số ⇒ bỏ khỏi
 * đợt (gửi "0đ" cho một đại lý là báo sai).
 */

import { TRANG_THAI_TINH } from './tinhLaiTongMuaKhach'
import { bangGop, type CapGop } from './zaloNhomKhach'

export interface CauHinhDoanhSo {
    categoryIds: string[]          // rỗng = mọi mặt hàng
    tu: string                     // YYYY-MM-DD (ngày VN)
    den: string
    chiKhachCoDoanhSo?: boolean    // bỏ khách doanh số ≤ 0 khỏi đợt
}

export interface SoLieuKhach { tien: number; soLuong: number; soDon: number }

const NGAY_RE = /^\d{4}-\d{2}-\d{2}$/

/** Biến doanh số có trong nội dung tin? (chỉ khi đó mới cần cấu hình + nhóm phải nối khách) */
export const dungBienDoanhSo = (noiDung: string) => /\{\s*(doanhSo|soLuong|soDon)\s*\}/i.test(String(noiDung || ''))

/** Kiểm cấu hình từ thân request. null = không dùng; chuỗi = lỗi để báo người dùng. */
export function docCauHinhDoanhSo(v: any): CauHinhDoanhSo | null | string {
    if (!v || typeof v !== 'object') return null
    const tu = String(v.tu || ''), den = String(v.den || '')
    if (!NGAY_RE.test(tu) || !NGAY_RE.test(den)) return 'Chọn kỳ doanh số (từ ngày – đến ngày)'
    if (tu > den) return 'Kỳ doanh số: "từ ngày" phải trước "đến ngày"'
    if (Date.parse(den) - Date.parse(tu) > 400 * 86400_000) return 'Kỳ doanh số tối đa khoảng 1 năm'
    const categoryIds = [...new Set<string>((Array.isArray(v.categoryIds) ? v.categoryIds : []).map(String).filter(Boolean))]
    if (categoryIds.length > 50) return 'Chọn tối đa 50 nhóm hàng'
    return { categoryIds, tu, den, chiKhachCoDoanhSo: !!v.chiKhachCoDoanhSo }
}

/** Nhóm đã chọn + mọi nhóm con (cây danh mục KiotViet 3 cấp) và tên để chèn {nhomHang}. Dùng chung với lib/zaloNhacMuaLai.ts */
export async function moRongNhom(sp: any, ids: string[]): Promise<{ tatCa: string[]; ten: string }> {
    if (!ids.length) return { tatCa: [], ten: 'tất cả mặt hàng' }
    const ds: { id: string; name: string; parentId: string | null }[] = await sp.category.findMany({ select: { id: true, name: true, parentId: true } })
    const con = new Map<string, string[]>()
    for (const c of ds) if (c.parentId) con.set(c.parentId, [...(con.get(c.parentId) || []), c.id])
    const ten = new Map(ds.map(c => [c.id, c.name]))
    const tatCa = new Set<string>()
    const hang = ids.filter(id => ten.has(id))
    while (hang.length) {
        const id = hang.pop()!
        if (tatCa.has(id)) continue
        tatCa.add(id)
        hang.push(...(con.get(id) || []))
    }
    return { tatCa: [...tatCa], ten: ids.map(id => ten.get(id)).filter(Boolean).join(', ') || '(nhóm hàng đã xoá)' }
}

/**
 * Doanh số trong kỳ của từng khách (đã trừ hàng trả). Khách không mua ⇒ không có trong Map.
 * `gop` (29/10/2026, lib/zaloNhomKhach.ts): nhóm Zalo nối nhiều mã ⇒ số của các mã cộng về khoá (groupId); SQL vẫn hỏi
 * theo từng mã, cộng ở đây. Không truyền ⇒ Map theo customerId như cũ.
 */
export async function tinhDoanhSo(sp: any, cfg: CauHinhDoanhSo, customerIds: string[], gop?: CapGop[]): Promise<{ theoKhach: Map<string, SoLieuKhach>; nhomHang: string }> {
    const { tatCa, ten } = await moRongNhom(sp, cfg.categoryIds)
    const theoKhach = new Map<string, SoLieuKhach>()
    const g = bangGop(gop)
    const khach = [...new Set([...customerIds, ...g.ids].filter(Boolean))]
    if (!khach.length || (cfg.categoryIds.length && !tatCa.length)) return { theoKhach, nhomHang: ten }
    const tu = new Date(`${cfg.tu}T00:00:00+07:00`), den = new Date(`${cfg.den}T23:59:59.999+07:00`)
    const locNhom = cfg.categoryIds.length ? `AND p."categoryId" = ANY($5::text[])` : ''
    const thamSo: any[] = [khach, [...TRANG_THAI_TINH], tu, den]
    if (cfg.categoryIds.length) thamSo.push(tatCa)

    const ban: any[] = await sp.$queryRawUnsafe(
        `SELECT t."customerId" AS k, COALESCE(SUM(ti."lineTotal"), 0)::float AS tien,
                COALESCE(SUM(ti."quantity"), 0)::float AS sl, COUNT(DISTINCT t."id")::int AS don
           FROM "Transaction" t
           JOIN "TransactionItem" ti ON ti."transactionId" = t."id"
           JOIN "Product" p ON p."id" = ti."productId"
          WHERE t."customerId" = ANY($1::text[]) AND t."status" = ANY($2::text[])
            AND COALESCE(t."transactionDate", t."createdAt") BETWEEN $3 AND $4 ${locNhom}
          GROUP BY t."customerId"`,
        ...thamSo,
    )
    // Cộng về khoá: một mã nằm ở hai nhóm thì nhận số ở cả hai; không gộp thì khoá = chính mã
    for (const r of ban) for (const key of g.khoaCua(String(r.k))) {
        const s = theoKhach.get(key) || { tien: 0, soLuong: 0, soDon: 0 }
        s.tien += Number(r.tien) || 0
        s.soLuong += Number(r.sl) || 0
        s.soDon += Number(r.don) || 0
        theoKhach.set(key, s)
    }

    // Hàng trả của chính các phiếu đó — theo giá thực đã bán trên phiếu gốc (đơn giá trên phiếu trả có khi là giá niêm yết)
    const tra: any[] = await sp.$queryRawUnsafe(
        `SELECT t."customerId" AS k,
                COALESCE(SUM(ri."quantity" * COALESCE(
                    (SELECT SUM(x."lineTotal") / NULLIF(SUM(x."quantity"), 0) FROM "TransactionItem" x
                      WHERE x."transactionId" = t."id" AND x."productId" = ri."productId"), ri."unitPrice")), 0)::float AS tien,
                COALESCE(SUM(ri."quantity"), 0)::float AS sl
           FROM "ReturnOrder" r
           JOIN "Transaction" t ON t."receiptNumber" = r."originalInvoice"
           JOIN "ReturnItem" ri ON ri."returnOrderId" = r."id"
           JOIN "Product" p ON p."id" = ri."productId"
          WHERE r."status" <> 'rejected'
            AND t."customerId" = ANY($1::text[]) AND t."status" = ANY($2::text[])
            AND COALESCE(t."transactionDate", t."createdAt") BETWEEN $3 AND $4 ${locNhom}
          GROUP BY t."customerId"`,
        ...thamSo,
    )
    for (const r of tra) for (const key of g.khoaCua(String(r.k))) {
        const s = theoKhach.get(key)
        if (!s) continue
        s.tien -= Number(r.tien) || 0
        s.soLuong -= Number(r.sl) || 0
    }
    // Trả nhiều hơn mua trong kỳ (trả hàng của kỳ trước) ⇒ 0, không ra số âm
    for (const s of theoKhach.values()) { s.tien = Math.max(0, Math.round(s.tien)); s.soLuong = Math.max(0, s.soLuong) }
    return { theoKhach, nhomHang: ten }
}

const ddmmyyyy = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`
export const dinhTien = (n: number) => `${Math.round(n || 0).toLocaleString('vi-VN')}đ`

/** Biến chèn vào tin của MỘT khách */
export function bienDoanhSo(s: SoLieuKhach | undefined, cfg: CauHinhDoanhSo, nhomHang: string): Record<string, string> {
    return {
        doanhSo: dinhTien(s?.tien || 0),
        soLuong: String(Math.round((s?.soLuong || 0) * 100) / 100).replace('.', ','),
        soDon: String(s?.soDon || 0),
        nhomHang,
        tuNgay: ddmmyyyy(cfg.tu),
        denNgay: ddmmyyyy(cfg.den),
    }
}
