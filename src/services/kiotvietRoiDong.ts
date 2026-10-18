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
import { KV, kvDate } from './kiotviet'
import { dungDongHoaDon, dungDongPhieuNhap, keoMaThieu, laMaDaXoaKV, newCounters, timHangKV, type SyncCounters, type SyncOptions } from './kiotvietSync'
import { khoaSoChan } from '../lib/periodLock'
import { moTaLoi } from '../lib/gomLoi'
import { refsOfImport, reverseJournalRefs } from '../lib/autoJournalPurchase'

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

// ═══════════════════════════════════════════════════════════════════════════════
//  ĐO PHIẾU NHẬP KIOTVIET RƠI DÒNG (chỉ đọc, 18/10/2026) — GET /admin/do-pn-thieu-dong
//
//  syncPurchaseOrders dựng dòng y cách cũ của hoá đơn (SKU khớp tuyệt đối, NUỐT lỗi đọc DB) rồi vẫn tạo phiếu với tổng KiotViet
//  ⇒ phiếu nhập THIẾU DÒNG: thẻ kho thiếu dòng nhập (ganTheKhoPhieuNhap chạy theo dòng), lịch sử nhập theo mặt hàng thiếu; bút
//  toán 156/331 vẫn đúng tổng (postImportReceiptJournal lấy totalCost).
//
//  KHÔNG đo được bằng phép so tiền thuần SQL — đo 599 phiếu HUTI 18/10:
//    · tổng KV = Σ SL × (giá − giảm MỖI CÁI) − giảm phiếu + exReturnSuppliers (30/30 phiếu có giảm dòng khớp "mỗi cái";
//      18 phiếu cộng exReturnSuppliers ≈ 8% = VAT ghi dạng chi phí trả NCC; exReturnThirdParty KHÔNG vào tổng)
//    · dòng Kengi cũ ghi thành tiền = SL × giá (KV không trả subTotal cho dòng phiếu nhập) ⇒ chưa trừ giảm dòng
//  nên Σ dòng ≠ tổng là chuyện thường. Phép đo đúng: hỏi KiotViet danh sách phiếu (status 3, không {DEL}) rồi so SỐ DÒNG từng
//  phiếu; phiếu thiếu thì tra lại từng dòng KV (bảng nối → SKU) xem dòng nào vắng và vì sao.
// ═══════════════════════════════════════════════════════════════════════════════
export type DongVangPN = { sku: string; ten: string; sl: number; gop: number; net: number; vi: 'ma-da-xoa' | 'nay-da-co-ma' | 'chua-co-ma' }

const dongKV = (po: any): any[] => (Array.isArray(po?.purchaseOrderDetails) ? po.purchaseOrderDetails : [])
    .filter((d: any) => String(d?.productCode || '').trim() || d?.productId != null)

/** So từng phiếu nhập 'KiotViet Sync' với danh sách phiếu KiotViet (status 3, không {DEL}). Trả ĐỦ danh sách (kèm dòng Kengi +
 *  phiếu KV) cho cả bộ đo lẫn bộ chữa. `thieu`: Kengi ít dòng hơn KV · `giamDong`: đủ dòng nhưng thành tiền chưa trừ giảm dòng. */
async function soPhieuNhapVoiKV(sp: any, creds: any, loc: { tuNgay?: Date | null; ma?: string[] } = {}) {
    const ts: any[] = []
    const dk = [`(r."userName" = 'KiotViet Sync' OR r.note ILIKE '%KiotViet%')`, `r.status <> 'cancelled'`]
    if (loc.tuNgay) { ts.push(loc.tuNgay); dk.push(`r."createdAt" >= $${ts.length}`) }
    if (loc.ma?.length) { ts.push(loc.ma); dk.push(`r.code = ANY($${ts.length}::text[])`) }
    const ke: any[] = await sp.$queryRawUnsafe(`
        SELECT r.id, r.code AS ma, r."createdAt" AS ngay, r."totalCost"::float8 AS tong, r."hasVatInvoice" AS "coHdVat",
               coalesce(r."paidAmount",0)::float8 AS "daTra", r."supplierName" AS ncc, r.note, r."branchId",
               coalesce(sum(i.total),0)::float8 AS "tongDong", count(i.id)::int AS "soDong",
               coalesce(sum(i."returnedQuantity"),0)::int AS "daTraNcc",
               coalesce(array_agg(i."productId") FILTER (WHERE i.id IS NOT NULL), '{}') AS "hang"
          FROM "ImportReceipt" r LEFT JOIN "ImportReceiptItem" i ON i."receiptId" = r.id
         WHERE ${dk.join(' AND ')}
         GROUP BY r.id`, ...ts)
    const { items, truncated } = await KV.purchaseOrders(creds, loc.tuNgay ? { fromPurchaseDate: kvDate(loc.tuNgay) } : {}, { maxPages: 500 })
    const kvTheoMa = new Map<string, any>()
    const kvMoiTrangThai = new Map<string, any>()   // mã gốc (bỏ đuôi {DEL}) → phiếu KV ở MỌI trạng thái
    for (const po of items) {
        const ma = String(po?.code || '').trim()
        if (!ma) continue
        if (Number(po?.status) === 3 && !/\{DEL\}/i.test(ma)) kvTheoMa.set(ma, po)
        else kvMoiTrangThai.set(ma.replace(/\{DEL\d*\}/gi, ''), po)
    }
    const thieu: { r: any; po: any; vang: DongVangPN[] }[] = [], giamDong: { r: any; po: any; lech: number }[] = []
    const du: any[] = [], khongThayTrenKV: any[] = []
    let khop = 0
    const daCo = new Set<string>()
    for (const r of ke) {
        daCo.add(r.ma)
        const po = kvTheoMa.get(r.ma)
        if (!po) {
            /* Phiếu Kengi mà KV không còn ở trạng thái hoàn thành: đo HUTI 18/10 — 8 phiếu (98,9tr) đều status 4 (ĐÃ HUỶ bên KV
             * SAU khi đã đồng bộ). Nhánh "phiếu đã có" của syncPurchaseOrders chỉ cập nhật thanh toán ⇒ huỷ không bao giờ sang. */
            const kvKhac = kvMoiTrangThai.get(r.ma)
            khongThayTrenKV.push({ ...r, kvTrangThai: kvKhac ? Number(kvKhac.status) : null, kvMa: kvKhac?.code ?? null })
            continue
        }
        const dong = dongKV(po)
        if (r.soDong > dong.length) { du.push({ ma: r.ma, ngay: ngayVN(r.ngay), soDongKengi: r.soDong, soDongKV: dong.length }); continue }
        if (r.soDong === dong.length) {
            khop++
            // thành tiền dòng ghi CHƯA trừ giảm giá dòng (dòng cũ = SL × giá) — Kengi cao hơn KV đúng phần giảm dòng
            const kvNet = dong.reduce((s: number, d: any) => s + (Number(d.quantity) || 0) * ((Number(d.price) || 0) - (Number(d.discount) || 0)), 0)
            const lech = Math.round(r.tongDong - kvNet)
            if (lech > 1) giamDong.push({ r, po, lech })
            continue
        }
        const coHang = new Set<string>(Array.isArray(r.hang) ? r.hang : [])
        const vang: DongVangPN[] = []
        for (const d of dong) {
            const sku = String(d?.productCode || '').trim()
            const p = await timHangKV(sp, d?.productId != null ? String(d.productId) : null, sku)
            if (p && coHang.has(p.id)) continue
            const sl = Number(d.quantity) || 0, gia = Number(d.price) || 0
            vang.push({ sku, ten: String(d?.productName || '').slice(0, 80), sl, gop: Math.round(sl * gia), net: Math.round(sl * (gia - (Number(d.discount) || 0))),
                vi: laMaDaXoaKV(sku) ? 'ma-da-xoa' : p ? 'nay-da-co-ma' : 'chua-co-ma' })
        }
        thieu.push({ r, po, vang })
    }
    const kvChuaNhap = loc.ma?.length ? [] : [...kvTheoMa.values()].filter(po => !daCo.has(String(po.code).trim()))
    // mốc bắt đầu đồng bộ phiếu nhập = phiếu KV sớm nhất đang có trong Kengi; phiếu KV chưa nhập TỪ mốc đó trở đi là RƠI CẢ PHIẾU
    const mocDau = ke.reduce((m: number, r: any) => Math.min(m, new Date(r.ngay).getTime()), Infinity)
    return { ke, soPhieuKV: kvTheoMa.size, truncated, khop, thieu, giamDong, du, khongThayTrenKV, kvChuaNhap, mocDau }
}

export async function doPhieuNhapRoiDong(sp: any, creds: any, loc: { tuNgay?: Date | null } = {}) {
    const k = await soPhieuNhapVoiKV(sp, creds, loc)
    const tienVang = (t: { vang: DongVangPN[] }) => t.vang.reduce((s, v) => s + v.net, 0)
    const theoVi: Record<string, { dong: number; phieu: number; tienNet: number }> = {}
    for (const t of k.thieu) {
        const seen = new Set<string>()
        for (const v of t.vang) {
            const g = (theoVi[v.vi] ??= { dong: 0, phieu: 0, tienNet: 0 }); g.dong++; g.tienNet += v.net
            if (!seen.has(v.vi)) { g.phieu++; seen.add(v.vi) }
        }
    }
    const theoThang = (xs: any[], ngay: (x: any) => any, tien: (x: any) => number) => {
        const m: Record<string, { so: number; tien: number }> = {}
        for (const x of xs) { const g = (m[ngayVN(ngay(x)).slice(0, 7)] ??= { so: 0, tien: 0 }); g.so++; g.tien += tien(x) }
        return Object.entries(m).sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([khoa, v]) => ({ khoa, ...v }))
    }
    return {
        soPhieuKengi: k.ke.length, soPhieuKV: k.soPhieuKV, kvBiCatTran: k.truncated,
        khopSoDong: k.khop,
        thieuDong: {
            so: k.thieu.length, soDong: k.thieu.reduce((s, t) => s + t.vang.length, 0),
            tienNet: k.thieu.reduce((s, t) => s + tienVang(t), 0),
            khongConDongNao: k.thieu.filter(t => t.r.soDong === 0).length,
            coHoaDonVat: k.thieu.filter(t => t.r.coHdVat).length,     // phiếu có HĐ VAT ⇒ tồn kho thuế đang thiếu đầu vào
            theoLyDo: theoVi,
            theoThang: theoThang(k.thieu, t => t.r.ngay, tienVang),
        },
        thanhTienChuaTruGiamDong: { soPhieu: k.giamDong.length, tienGhiCao: k.giamDong.reduce((s, g) => s + g.lech, 0), theoThang: theoThang(k.giamDong, g => g.r.ngay, g => g.lech).slice(0, 12) },
        duDong: { so: k.du.length, mau: k.du.slice(0, 5) },
        kvChuaNhapVaoKengi: (() => {
            const sauMoc = k.kvChuaNhap.filter(po => new Date(po.purchaseDate).getTime() >= k.mocDau)
            const tong = (xs: any[]) => Math.round(xs.reduce((s, po) => s + (Number(po.total) || 0), 0))
            return {
                mocBatDauDongBo: Number.isFinite(k.mocDau) ? ngayVN(k.mocDau) : null,
                truocMoc: { so: k.kvChuaNhap.length - sauMoc.length, tong: tong(k.kvChuaNhap) - tong(sauMoc) },
                // TỪ mốc trở đi mà vẫn chưa có = rơi cả phiếu (lỗi lúc tạo, ra ngoài cửa sổ 3 ngày của lượt đêm)
                sauMoc: { so: sauMoc.length, tong: tong(sauMoc), mau: sauMoc.slice(0, 20).map(po => ({ ma: po.code, ngay: ngayVN(po.purchaseDate), tong: Number(po.total) || 0, ncc: po.supplierName || null, soDong: dongKV(po).length })) },
            }
        })(),
        kengiKhongThayTrenKV: {
            so: k.khongThayTrenKV.length, tong: Math.round(k.khongThayTrenKV.reduce((s, r) => s + r.tong, 0)),
            theoTrangThaiKV: k.khongThayTrenKV.reduce((m: Record<string, number>, r) => { const kk = r.kvTrangThai == null ? 'khong-thay' : `status-${r.kvTrangThai}`; m[kk] = (m[kk] || 0) + 1; return m }, {}),
            ds: k.khongThayTrenKV.slice(0, 50).map(r => ({ ma: r.ma, ngay: ngayVN(r.ngay), tong: r.tong, kvTrangThai: r.kvTrangThai, kvMa: r.kvMa })),
        },
        mau: k.thieu.sort((a, b) => (a.r.ngay < b.r.ngay ? 1 : -1)).slice(0, 25).map(t => ({
            ma: t.r.ma, ngay: ngayVN(t.r.ngay), tong: t.r.tong, soDongKengi: t.r.soDong, soDongKV: dongKV(t.po).length, coHdVat: t.r.coHdVat,
            tienVangNet: tienVang(t), vang: t.vang,
        })),
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  CHỮA PHIẾU NHẬP KIOTVIET RƠI DÒNG (18/10/2026) — POST /admin/chua-pn-roi-dong — mặc định CHẠY THỬ
//
//  Chỉ DỰNG LẠI DÒNG HÀNG (ImportReceiptItem) theo KiotViet, KHÔNG đụng gì khác:
//    · tồn kho / thẻ kho: tồn KV là ảnh chụp onHand, phần nhập của phiếu cũ đã nằm trong các dòng điều chỉnh lịch sử — ghi
//      thêm dòng nhập là ĐẾM ĐÔI (kiotviet-the-kho-tach-nhan)
//    · sổ: IMP-<mã> (Nợ 156 · Có 331) lấy totalCost = tổng KV, vốn đã đúng; dòng không vào bút toán
//    · tổng phiếu, đã trả, NCC giữ nguyên
//  Cổng: tổng KV = tổng Kengi (±1đ) · không có dòng đã trả NCC (returnedQuantity) · đủ 100% mã · số dòng = KV · Σ dòng mới −
//  giảm phiếu + exReturnSuppliers = tổng KV (±2đ). `caGiamDong`: chữa luôn phiếu ĐỦ dòng mà thành tiền chưa trừ giảm dòng
//  (công tắc riêng — chỉ đổi con số thành tiền, mặc định tắt).
// ═══════════════════════════════════════════════════════════════════════════════
export type ViecChuaPN = 'da-chua' | 'se-chua' | 'thieu-ma' | 'kv-khac-tong' | 'co-tra-ncc' | 'khong-khop' | 'loi'
export type KetQuaChuaPN = {
    ma: string; ngay: string; tong: number; loai: 'thieu-dong' | 'giam-dong'; coHdVat: boolean
    soDongCu: number; tongDongCu: number; soDongKV: number; viec: ViecChuaPN; lyDo?: string
    soDongMoi?: number; tongDongMoi?: number; maThieu?: { sku: string; ten: string; kvProductId: string | null }[]
}

export async function chuaPhieuNhapRoiDong(
    sp: any, opts: SyncOptions, loc: { ma?: string[]; tuNgay?: Date | null; gioiHan?: number; caGiamDong?: boolean } = {},
): Promise<{ ds: KetQuaChuaPN[]; c: SyncCounters }> {
    const c = newCounters()
    const ds: KetQuaChuaPN[] = []
    if (!opts.creds) throw new Error('Thiếu thông tin kết nối KiotViet (creds)')
    const k = await soPhieuNhapVoiKV(sp, opts.creds, loc)
    const viec = [
        ...k.thieu.map(t => ({ ...t, loai: 'thieu-dong' as const })),
        ...(loc.caGiamDong ? k.giamDong.map(g => ({ ...g, loai: 'giam-dong' as const })) : []),
    ].slice(0, Math.max(1, Math.min(2000, loc.gioiHan ?? 300)))
    for (const { r, po, loai } of viec) {
        const kq: KetQuaChuaPN = {
            ma: r.ma, ngay: ngayVN(r.ngay), tong: r.tong, loai, coHdVat: !!r.coHdVat,
            soDongCu: r.soDong, tongDongCu: Math.round(r.tongDong), soDongKV: dongKV(po).length, viec: 'loi',
        }
        ds.push(kq)
        try {
            const tongKv = Number(po.total) || 0
            if (Math.abs(tongKv - r.tong) > 1) { kq.viec = 'kv-khac-tong'; kq.lyDo = `Tổng KiotViet ${tongKv} ≠ tổng Kengi ${r.tong} — phiếu đã sửa bên KV sau khi đồng bộ`; continue }
            if (r.daTraNcc > 0) { kq.viec = 'co-tra-ncc'; kq.lyDo = `Phiếu đã có ${r.daTraNcc} cái trả NCC ghi trên dòng — dựng lại là mất số trả, để nguyên`; continue }
            let dung = await dungDongPhieuNhap(sp, po)
            if (dung.missing.length && opts.apply && (await keoMaThieu(sp, opts, dung.thieu, c)) > 0) dung = await dungDongPhieuNhap(sp, po)
            if (dung.missing.length) {
                kq.viec = 'thieu-ma'; kq.maThieu = dung.thieu
                kq.lyDo = dung.thieu.every(t => laMaDaXoaKV(t.sku))
                    ? 'Mã đã XOÁ bên KiotViet ({DEL}) — không tạo lại hàng đã xoá, phiếu để nguyên'
                    : opts.apply ? 'Kéo mã từ KiotViet vẫn không ra — xem tên mã'
                        : dung.thieu.some(t => laMaDaXoaKV(t.sku)) ? 'Có mã đã xoá bên KiotViet ({DEL}) — chạy thật vẫn không dựng được'
                            : 'Chạy thật sẽ kéo các mã này từ KiotViet rồi dựng lại'
                continue
            }
            const tongMoi = dung.lines.reduce((s: number, l: any) => s + l.total, 0)
            const kiem = tongMoi - (Number(po.discount) || 0) + (Number(po.exReturnSuppliers) || 0)
            if (dung.lines.length !== kq.soDongKV || Math.abs(kiem - tongKv) > 2) {
                kq.viec = 'khong-khop'
                kq.lyDo = `Dòng KV ${dung.lines.length}/${kq.soDongKV} · Σ dòng ${Math.round(tongMoi)} − giảm phiếu ${Math.round(Number(po.discount) || 0)} + chi phí trả NCC ${Math.round(Number(po.exReturnSuppliers) || 0)} ≠ tổng ${Math.round(tongKv)}`
                continue
            }
            kq.soDongMoi = dung.lines.length
            kq.tongDongMoi = Math.round(tongMoi)
            if (!opts.apply) { kq.viec = 'se-chua'; c.updated++; continue }
            await sp.$transaction(async (tx: any) => {
                await tx.importReceiptItem.deleteMany({ where: { receiptId: r.id } })
                await tx.importReceiptItem.createMany({ data: dung.lines.map((l: any) => ({ ...l, receiptId: r.id })) })
                await tx.importReceipt.update({ where: { id: r.id }, data: { totalItems: dung.lines.reduce((s: number, l: any) => s + l.quantity, 0) } })
            })
            kq.viec = 'da-chua'
            c.updated++
        } catch (e: any) {
            kq.viec = 'loi'
            kq.lyDo = moTaLoi(e).slice(0, 300)
        }
    }
    return { ds, c }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  HUỶ PHIẾU NHẬP ĐÃ HUỶ / XOÁ BÊN KIOTVIET (18/10/2026) — POST /admin/huy-pn-kv-da-huy — mặc định CHẠY THỬ
//
//  Đo HUTI 18/10: 8 phiếu (98,9tr) đã sang Kengi rồi mới bị huỷ bên KV (status 4) — Kengi vẫn 'completed' + IMP- Nợ 156 · Có 331.
//  Huỷ = GIỮ phiếu, đặt status 'cancelled' (mọi báo cáo đã lọc ≠ cancelled) + ghi bút toán ĐẢO VOID-IMP-/VOID-IMPVAT- (không xoá
//  bút toán gốc — reverseJournalRefs, ghi ngày hôm nay như huỷ phiếu thường). KHÔNG đụng tồn/thẻ kho: tồn KV là ảnh chụp onHand,
//  lúc KV huỷ phiếu thì lượt đồng bộ tồn sau đó đã trừ rồi.
//  Cổng: phiếu ĐÃ TRẢ tiền NCC (paidAmount > 0) KHÔNG tự huỷ — đảo IMPPAY- nghĩa là NCC đã hoàn tiền, phải người dùng xác nhận.
// ═══════════════════════════════════════════════════════════════════════════════
export type KetQuaHuyPN = {
    ma: string; ngay: string; tong: number; daTra: number; ncc: string | null; kvTrangThai: number | null; kvMa: string | null
    butToan: { ref: string; tien: number }[]
    viec: 'da-huy' | 'se-huy' | 'da-tra-tien' | 'khong-thay-tren-kv' | 'loi'; lyDo?: string; daoDuoc?: number
}

export async function huyPhieuNhapKvDaHuy(sp: any, opts: SyncOptions, loc: { ma?: string[] } = {}): Promise<KetQuaHuyPN[]> {
    if (!opts.creds) throw new Error('Thiếu thông tin kết nối KiotViet (creds)')
    const k = await soPhieuNhapVoiKV(sp, opts.creds, { ma: loc.ma })
    const ds: KetQuaHuyPN[] = []
    for (const r of k.khongThayTrenKV) {
        const bt: any[] = await sp.journalEntry.findMany({ where: { reference: { in: refsOfImport(r.ma) } }, select: { reference: true, amount: true } })
        const kq: KetQuaHuyPN = {
            ma: r.ma, ngay: ngayVN(r.ngay), tong: r.tong, daTra: Math.round(r.daTra), ncc: r.ncc ?? null, kvTrangThai: r.kvTrangThai, kvMa: r.kvMa,
            butToan: bt.map(b => ({ ref: b.reference, tien: Math.round(Number(b.amount) || 0) })), viec: 'loi',
        }
        ds.push(kq)
        // KHÔNG THẤY trên KV ở bất kỳ trạng thái nào ≠ bằng chứng đã huỷ (có thể do lọc/phân trang) — không đụng
        if (r.kvTrangThai == null) { kq.viec = 'khong-thay-tren-kv'; kq.lyDo = 'KiotViet không trả phiếu này ở trạng thái nào — không đủ bằng chứng là đã huỷ'; continue }
        if (r.daTra > 0) { kq.viec = 'da-tra-tien'; kq.lyDo = `Đã trả NCC ${Math.round(r.daTra).toLocaleString('vi-VN')}đ — huỷ là đảo cả khoản trả, cần xác nhận NCC đã hoàn tiền`; continue }
        if (!opts.apply) { kq.viec = 'se-huy'; continue }
        try {
            const ghiChu = `Huỷ theo KiotViet (${kq.kvMa && /\{DEL/i.test(kq.kvMa) ? 'đã xoá' : `status ${kq.kvTrangThai}`}) ngày ${ngayVN(new Date())}`
            await sp.importReceipt.update({ where: { id: r.id }, data: { status: 'cancelled', note: r.note ? `${r.note} · ${ghiChu}` : ghiChu } })
            kq.daoDuoc = await reverseJournalRefs(sp, refsOfImport(r.ma), { userId: opts.systemUserId ?? null, branchId: r.branchId ?? null })
            kq.viec = 'da-huy'
        } catch (e: any) {
            kq.viec = 'loi'
            kq.lyDo = moTaLoi(e).slice(0, 300)
        }
    }
    return ds
}
