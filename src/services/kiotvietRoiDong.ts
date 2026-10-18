// ═══════════════════════════════════════════════════════════════════════════════
//  CHỮA HOÁ ĐƠN KIOTVIET RƠI DÒNG HÀNG (18/10/2026)
//
//  Chủ shop gửi HD031632 (HUTI, 17/10): tổng 7.429.000 mà phiếu chỉ còn 1 dòng 4.104.000 — "đồng bộ bị rớt sản phẩm".
//  Gốc: dựng dòng hoá đơn chỉ tra hàng theo SKU khớp tuyệt đối (không theo bảng nối mã KiotViet như đồng bộ hàng hoá),
//  mã nào không ra thì BỎ dòng nhưng phiếu vẫn tạo với tổng của KiotViet. Đo (GET /admin/do-hd-thieu-dong): 62 phiếu,
//  128.701.050đ tiền hàng bị rơi. Hệ quả không chỉ ở màn hình: `subtotal` = tổng dòng dựng được ⇒ bút toán DOANH THU
//  (SALE-, Nợ 111/112/131 · Có 511) và GIÁ VỐN (COGS-, Nợ 632 · Có 156) lúc tạo phiếu đều hụt đúng phần rơi.
//
//  Chữa từng phiếu:
//    1. hỏi lại KiotViet đúng phiếu đó (`/invoices/code/{mã}`); KV đã huỷ / tổng đã khác ⇒ không đụng, để đồng bộ thường lo
//    2. dựng dòng như đồng bộ (bảng nối → SKU); thiếu mã ⇒ kéo đúng mã đó từ KiotViet (chỉ khi chạy thật)
//    3. BA CỔNG như nhánh rebuildLines: đủ 100% mã · có dòng · Σ dòng − giảm phiếu = tổng (±1đ) — không qua thì để nguyên
//    4. thay dòng trong MỘT $transaction + cập nhật subtotal
//    5. SỔ: phiếu đã có SALE-<mã> thì ghi THÊM hai bút toán điều chỉnh, KHÔNG sửa bút toán gốc (giữ vết kiểm toán, như
//       ADJ-SALE- của bản sửa giá sàn TikTok): ADJ-SALE-<mã> (Nợ = tài khoản Nợ của SALE gốc · Có 511, phần doanh thu chênh)
//       và ADJ-COGS-<mã> (Nợ 632 · Có 156, giá vốn phần hàng THÊM theo giá vốn hiện tại). Cùng NGÀY bút toán gốc; kỳ đã
//       khoá ⇒ không ghi, báo. Phiếu chưa vào sổ ⇒ không ghi (ghi bù sau này sẽ lấy subtotal đã đúng). Huỷ phiếu về sau:
//       reverseJournalEntriesForTransaction đảo cả hai khoá này.
//  Tồn kho KHÔNG đụng: tồn KiotViet là ảnh chụp onHand, hoá đơn không trừ kho bên Kengi (kiotviet-the-kho-tach-nhan).
// ═══════════════════════════════════════════════════════════════════════════════
import { KV } from './kiotviet'
import { dungDongHoaDon, keoMaThieu, laMaDaXoaKV, newCounters, type SyncCounters, type SyncOptions } from './kiotvietSync'
import { khoaSoChan } from '../lib/periodLock'
import { moTaLoi } from '../lib/gomLoi'

export type ViecChua = 'da-chua' | 'se-chua' | 'thieu-ma' | 'kv-khac-tong' | 'kv-da-huy' | 'kv-khong-doc-duoc' | 'khong-khop' | 'loi'
export type KetQuaChua = {
    ma: string; ngay: string; tong: number; tongDongCu: number; soDongCu: number; tienRoi: number
    viec: ViecChua; lyDo?: string
    maThieu?: { sku: string; ten: string; kvProductId: string | null }[]
    soDongMoi?: number; tongDongMoi?: number; giaVonThem?: number
    soSach?: 'da-ghi' | 'se-ghi' | 'chua-vao-so' | 'da-co-dieu-chinh' | 'ky-da-khoa' | 'loi-ghi'
}

const ngayVN = (d: any) => new Date(new Date(d).getTime() + 7 * 3600_000).toISOString().slice(0, 10)

/** Phiếu của 'KiotViet Sync' (trừ huỷ/trả) có Σ dòng − giảm phiếu ≠ tổng — cùng phép đo với GET /admin/do-hd-thieu-dong */
export async function timHoaDonRoiDong(sp: any, loc: { ma?: string[]; tuNgay?: Date | null } = {}): Promise<any[]> {
    const dk: string[] = [`t."createdByName" = 'KiotViet Sync'`, `t.status NOT IN ('voided','returned','cancelled')`]
    const ts: any[] = []
    if (loc.ma?.length) { ts.push(loc.ma); dk.push(`t."receiptNumber" = ANY($${ts.length}::text[])`) }
    if (loc.tuNgay) { ts.push(loc.tuNgay); dk.push(`t."createdAt" >= $${ts.length}`) }
    const ds: any[] = await sp.$queryRawUnsafe(`
        SELECT t.id, t."receiptNumber" AS ma, t."createdAt" AS ngay, t.total::float8 AS tong, coalesce(t.discount,0)::float8 AS giam,
               t."branchId", coalesce(sum(i."lineTotal"),0)::float8 AS "tongDong", count(i.id)::int AS "soDong"
          FROM "Transaction" t LEFT JOIN "TransactionItem" i ON i."transactionId" = t.id
         WHERE ${dk.join(' AND ')}
         GROUP BY t.id
        HAVING abs(t.total + coalesce(t.discount,0) - coalesce(sum(i."lineTotal"),0)) > 1
         ORDER BY t."createdAt" DESC`, ...ts)
    return ds
}

export async function chuaHoaDonRoiDong(
    sp: any, opts: SyncOptions, loc: { ma?: string[]; tuNgay?: Date | null; gioiHan?: number } = {},
): Promise<{ ds: KetQuaChua[]; c: SyncCounters }> {
    const c = newCounters()
    const ds: KetQuaChua[] = []
    if (!opts.creds) throw new Error('Thiếu thông tin kết nối KiotViet (creds)')
    const phieu = (await timHoaDonRoiDong(sp, loc)).slice(0, Math.max(1, Math.min(500, loc.gioiHan ?? 200)))
    for (const r of phieu) {
        const kq: KetQuaChua = {
            ma: r.ma, ngay: ngayVN(r.ngay), tong: r.tong, tongDongCu: r.tongDong, soDongCu: r.soDong,
            tienRoi: Math.round(r.tong + r.giam - r.tongDong), viec: 'loi',
        }
        ds.push(kq)
        try {
            const raw: any = await KV.raw(opts.creds, `/invoices/code/${encodeURIComponent(r.ma)}`)
            const kv = raw?.invoiceDetails ? raw : raw?.data && !Array.isArray(raw.data) ? raw.data : Array.isArray(raw?.data) ? raw.data[0] : null
            if (!kv) { kq.viec = 'kv-khong-doc-duoc'; kq.lyDo = 'KiotViet không trả phiếu này'; continue }
            if (Number(kv.status) === 2) { kq.viec = 'kv-da-huy'; kq.lyDo = 'Phiếu đã huỷ bên KiotViet — để đồng bộ thường xử lý'; continue }
            const tongKv = Number(kv.total) || 0
            if (Math.abs(tongKv - r.tong) > 1) { kq.viec = 'kv-khac-tong'; kq.lyDo = `Tổng KiotViet ${tongKv} ≠ tổng Kengi ${r.tong} — phiếu đã sửa bên KV, để đồng bộ thường xử lý`; continue }

            let dung = await dungDongHoaDon(sp, kv)
            if (dung.missing.length && opts.apply && (await keoMaThieu(sp, opts, dung.thieu, c)) > 0) dung = await dungDongHoaDon(sp, kv)
            if (dung.missing.length) {
                kq.viec = 'thieu-ma'; kq.maThieu = dung.thieu
                kq.lyDo = dung.thieu.every(t => laMaDaXoaKV(t.sku))
                    ? 'Mã đã XOÁ bên KiotViet ({DEL}) — không tạo lại hàng đã xoá, phiếu để nguyên'
                    : opts.apply ? 'Kéo mã từ KiotViet vẫn không ra — xem tên mã'
                        : dung.thieu.some(t => laMaDaXoaKV(t.sku)) ? 'Có mã đã xoá bên KiotViet ({DEL}) — chạy thật vẫn không dựng được'
                            : 'Chạy thật sẽ kéo các mã này từ KiotViet rồi dựng lại'
                continue
            }
            const tongDongMoi = dung.lines.reduce((s: number, l: any) => s + l.lineTotal, 0)
            const giam = Number(kv.discount) || 0
            if (!dung.lines.length || Math.abs(tongDongMoi - giam - tongKv) > 1) {
                kq.viec = 'khong-khop'
                kq.lyDo = `Dòng KiotViet cộng ${Math.round(tongDongMoi)} − giảm ${Math.round(giam)} ≠ tổng ${Math.round(tongKv)}`
                continue
            }
            kq.soDongMoi = dung.lines.length
            kq.tongDongMoi = tongDongMoi

            // Giá vốn phần hàng THÊM: (SL mới − SL cũ) × giá vốn hiện tại, theo từng mã — dòng cũ giữ nguyên giá vốn đã ghi
            const cu: any[] = await sp.transactionItem.findMany({ where: { transactionId: r.id }, select: { productId: true, quantity: true } })
            const slCu = new Map<string, number>()
            for (const i of cu) slCu.set(i.productId, (slCu.get(i.productId) || 0) + (Number(i.quantity) || 0))
            const slMoi = new Map<string, number>()
            for (const l of dung.lines) slMoi.set(l.productId, (slMoi.get(l.productId) || 0) + (Number(l.quantity) || 0))
            const ids = Array.from(new Set([...slCu.keys(), ...slMoi.keys()]))
            const gv: any[] = await sp.product.findMany({ where: { id: { in: ids } }, select: { id: true, costPrice: true } })
            const giaVon = new Map<string, number>(gv.map(p => [p.id, Number(p.costPrice) || 0]))
            kq.giaVonThem = Math.round(ids.reduce((s, id) => s + ((slMoi.get(id) || 0) - (slCu.get(id) || 0)) * (giaVon.get(id) || 0), 0))
            const dtThem = Math.round(tongDongMoi - r.tongDong)

            // Sổ: chỉ điều chỉnh khi phiếu đã có bút toán doanh thu gốc
            const goc = await sp.journalEntry.findUnique({ where: { reference: `SALE-${r.ma}` } })
            const daCo = await sp.journalEntry.count({ where: { reference: { in: [`ADJ-SALE-${r.ma}`, `ADJ-COGS-${r.ma}`] } } })
            const ngayGoc = goc ? String(goc.date).slice(0, 10) : null
            const khoa = ngayGoc ? await khoaSoChan(sp, r.branchId ?? null, ngayGoc).catch(() => null) : null
            kq.soSach = !goc ? 'chua-vao-so' : daCo ? 'da-co-dieu-chinh' : khoa ? 'ky-da-khoa' : opts.apply ? 'da-ghi' : 'se-ghi'

            if (!opts.apply) { kq.viec = 'se-chua'; c.updated++; continue }

            await sp.$transaction(async (tx: any) => {
                await tx.transactionItem.deleteMany({ where: { transactionId: r.id } })
                await tx.transactionItem.createMany({ data: dung.lines.map((l: any) => ({ ...l, transactionId: r.id })) })
                await tx.transaction.update({ where: { id: r.id }, data: { subtotal: tongDongMoi } })
            })
            kq.viec = 'da-chua'
            c.updated++

            if (kq.soSach === 'da-ghi') {
                try {
                    const ghi = (data: any) => sp.journalEntry.create({ data: { date: ngayGoc, branchId: goc.branchId ?? r.branchId ?? null, referenceType: 'sale', createdBy: opts.systemUserId ?? null, ...data } })
                    if (dtThem !== 0) {
                        const tang = dtThem > 0
                        await ghi({
                            description: `Điều chỉnh doanh thu ${r.ma} — dựng lại dòng hàng bị rơi khi đồng bộ KiotViet`,
                            debitAccount: tang ? goc.debitAccount : '511', debitAccountName: tang ? goc.debitAccountName : 'Doanh thu bán hàng',
                            creditAccount: tang ? '511' : goc.debitAccount, creditAccountName: tang ? 'Doanh thu bán hàng' : goc.debitAccountName,
                            amount: Math.abs(dtThem), reference: `ADJ-SALE-${r.ma}`,
                            notes: `Dòng hàng ${Math.round(r.tongDong).toLocaleString('vi-VN')}đ → ${Math.round(tongDongMoi).toLocaleString('vi-VN')}đ (tổng phiếu ${Math.round(r.tong).toLocaleString('vi-VN')}đ không đổi)`,
                        })
                    }
                    if ((kq.giaVonThem || 0) !== 0) {
                        const tang = (kq.giaVonThem || 0) > 0
                        await ghi({
                            description: `Điều chỉnh giá vốn ${r.ma} — dòng hàng bị rơi khi đồng bộ KiotViet`,
                            debitAccount: tang ? '632' : '156', debitAccountName: tang ? 'Giá vốn hàng bán' : 'Hàng hóa',
                            creditAccount: tang ? '156' : '632', creditAccountName: tang ? 'Hàng hóa' : 'Giá vốn hàng bán',
                            amount: Math.abs(kq.giaVonThem || 0), reference: `ADJ-COGS-${r.ma}`,
                        })
                    }
                } catch (e: any) {
                    kq.soSach = 'loi-ghi'
                    kq.lyDo = `Đã dựng lại dòng nhưng ghi bút toán điều chỉnh hỏng: ${moTaLoi(e)}`.slice(0, 300)
                }
            }
        } catch (e: any) {
            kq.viec = 'loi'
            kq.lyDo = moTaLoi(e).slice(0, 300)
        }
    }
    return { ds, c }
}
