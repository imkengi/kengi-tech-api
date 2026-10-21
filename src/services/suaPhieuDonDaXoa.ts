/**
 * SỬA PHIẾU BÁN CỦA ĐƠN SÀN ĐÃ XOÁ MÀ THỰC RA KHÔNG BÁN ĐƯỢC (21/10/2026) — phương án A
 * chủ shop chọn. Luật ở lib/suaPhieuDonDaXoa.ts. Dùng cho POST /admin/sua-phieu-don-da-xoa.
 *
 * Mỗi trang: phân loại LẠI (hỏi sàn ngay lúc chạy), rồi với từng phiếu đủ điều kiện:
 *   1. huỷ phiếu — UPDATE có điều kiện status chưa voided/returned (chạy lại vô hại)
 *   2. cộng lại kho — đúng phần CÒN ÂM của thẻ kho 'ONLINE-<mã>' từng hàng, đọc lại và
 *      ghi trong MỘT giao dịch DB cho từng dòng ⇒ chạy lại không cộng hai lần
 *   3. đảo bút toán SALE-/VAT-/DISC-/COGS-/COLLECT- — 'REV-<ref>', ngày hôm nay, ref unique
 * Giống đường đảo thường (services/onlineOrderReversal.ts), khác ở chỗ đi từ PHIẾU vì đơn
 * gốc đã mất. MẶC ĐỊNH chạy thử: tính đủ việc sẽ làm, không ghi gì.
 * KHÔNG đụng hoá đơn điện tử — trả danh sách phiếu đã xuất HĐ để kế toán xử lý.
 */
import { phanLoaiDonChuaLayPhi, type CongSan, type GianSan, type KhoMeDoc, type DbPhanLoai } from './phanLoaiDonChuaLayPhi'
import { TIEN_TO_BUT_TOAN } from '../lib/phanLoaiDonChuaLayPhi'
import { quyetDinh, dongKhoCanCong, butToanDao, GHI_CHU_HUY, type HanhDong } from '../lib/suaPhieuDonDaXoa'
import { adjustSellableStock } from '../lib/warehouseHelper'
import { moTaLoi } from '../lib/gomLoi'

const ngayVN = (d: any) => {
    const t = d instanceof Date ? d.getTime() : new Date(d).getTime()
    return Number.isFinite(t) ? new Date(t + 7 * 3600_000).toISOString().slice(0, 10) : '?'
}

export const LY_DO_KHO = 'Hoàn kho: đơn sàn đã xoá bị huỷ/hoàn (sửa 21/10/2026)'

export interface KeHoachDon {
    ma: string; soPhieu: string; loai: string; lyDoSan: string; hanhDong: HanhDong; lyDo: string
    tienPhieu: number; ngayPhieu: string
    kho: Array<{ productId: string; soLuong: number }>; khoBoQua: string[]
    butToan: string[]                 // ref bút toán gốc sẽ đảo
    hoaDon: any[]                     // EInvoice của phiếu (không đụng)
    daLam?: { huyPhieu: boolean; congKho: number; daoButToan: number; loi?: string }
}

export async function suaPhieuDonDaXoa(
    sp: any,
    opts: { apply: boolean; tu: number; gioiHan: number; hanMs: number; khoMe?: KhoMeDoc | null; homNay?: string },
    deps: { taoCong?: (g: GianSan) => CongSan; chinhKho?: typeof adjustSellableStock } = {},
) {
    const batDau = Date.now()
    const homNay = opts.homNay || ngayVN(new Date())
    const chinhKho = deps.chinhKho || adjustSellableStock
    // Phân loại dùng tối đa 55% thời gian — phần còn lại để đọc sổ + ghi
    const pl = await phanLoaiDonChuaLayPhi(sp as DbPhanLoai, { tu: opts.tu, gioiHan: opts.gioiHan, hanMs: Math.round(opts.hanMs * 0.55), khoMe: opts.khoMe }, deps.taoCong)
    /* Khoá sổ: đọc THẲNG (getCurrentLock nuốt lỗi rồi trả null = "không khoá" — với đường
     * GHI thì đọc hỏng phải DỪNG, không được coi như sổ mở). Lấy khoá mới nhất của MỌI chi
     * nhánh — phiếu đơn sàn có thể không gắn chi nhánh, chọn khoá muộn nhất là phía an toàn. */
    let ngayKhoaSo: string | null = null
    try {
        const khoa = sp.periodLock ? await sp.periodLock.findFirst({
            where: { isActive: true }, orderBy: [{ lockDate: 'desc' }, { createdAt: 'desc' }],
        }) : null
        ngayKhoaSo = khoa?.lockDate || null
    } catch (e) {
        if (opts.apply) throw new Error(`không đọc được khoá sổ — dừng, chưa ghi gì: ${moTaLoi(e)}`)
    }

    const soPhieu = pl.don.map(d => `ONLINE-${d.ma}`)
    const phieu = new Map<string, any>((await sp.$queryRawUnsafe(
        `SELECT id, "receiptNumber", status, "transactionDate", "createdAt" FROM "Transaction" WHERE "receiptNumber" = ANY($1::text[])`, soPhieu) as any[])
        .map(r => [r.receiptNumber, r]))
    const conDon = new Set(((await sp.$queryRawUnsafe(
        `SELECT "orderNumber" FROM "OnlineOrder" WHERE "orderNumber" = ANY($1::text[])`, pl.don.map(d => d.ma))) as any[]).map(r => r.orderNumber))
    const dongKho = (await sp.$queryRawUnsafe(`
        SELECT it."referenceId" AS ref, it."productId", COALESCE(SUM(it.quantity), 0)::float8 AS rong,
               (p.id IS NOT NULL) AS "tonTai", p."mergedIntoId" AS "gopVao"
        FROM "InventoryTransaction" it LEFT JOIN "Product" p ON p.id = it."productId"
        WHERE it."referenceId" = ANY($1::text[])
        GROUP BY it."referenceId", it."productId", p.id, p."mergedIntoId"`, soPhieu)) as any[]
    const refsButToan = soPhieu.flatMap(rn => TIEN_TO_BUT_TOAN.flatMap(t => [`${t}${rn}`, `REV-${t}${rn}`]))
    const butToan = new Map<string, any>(((await sp.$queryRawUnsafe(
        `SELECT * FROM "JournalEntry" WHERE reference = ANY($1::text[])`, refsButToan)) as any[]).map(e => [e.reference, e]))
    const hoaDon = (await sp.$queryRawUnsafe(`
        SELECT "transactionId", "invoiceSymbol", "invoiceNumber", "invoiceDate", status, "invoiceType", "totalAmount",
               "buyerName", "buyerTaxCode", "lookupCode", provider
        FROM "EInvoice" WHERE "transactionId" = ANY($1::text[])`, [...phieu.values()].map(t => t.id)).catch(() => [])) as any[]

    const keHoach: KeHoachDon[] = []
    for (const d of pl.don) {
        const rn = `ONLINE-${d.ma}`
        const t = phieu.get(rn)
        if (!t) continue
        const ngayPhieu = ngayVN(t.transactionDate || t.createdAt)
        const qd = quyetDinh({
            loai: d.loai, coPhieuTraDaDuyet: d.phieuTra.some(p => String(p.status).toLowerCase() !== 'rejected'),
            trangThaiPhieu: String(t.status), ngayPhieu, ngayKhoaSo, donGocConTrongBang: conDon.has(d.ma),
        })
        const { cong, boQua } = qd.hanhDong === 'huy-phieu-cong-kho'
            ? dongKhoCanCong(dongKho.filter(k => k.ref === rn))
            : { cong: [], boQua: [] as string[] }
        keHoach.push({
            ma: d.ma, soPhieu: rn, loai: d.loai, lyDoSan: d.lyDo, hanhDong: qd.hanhDong, lyDo: qd.lyDo,
            tienPhieu: d.tienPhieu, ngayPhieu, kho: cong, khoBoQua: boQua,
            butToan: qd.hanhDong === 'bo-qua' ? [] : TIEN_TO_BUT_TOAN.map(x => `${x}${rn}`).filter(r => butToan.has(r) && !butToan.has(`REV-${r}`)),
            hoaDon: hoaDon.filter(h => h.transactionId === t.id),
        })
    }

    // ── GHI THẬT — tuần tự (pool mỗi cửa hàng 1 kết nối), từng phiếu độc lập ──
    let hetGio = 0
    if (opts.apply) {
        for (const k of keHoach) {
            if (k.hanhDong === 'bo-qua') continue
            if (Date.now() - batDau > opts.hanMs) { hetGio++; continue }
            const t = phieu.get(k.soPhieu)
            const daLam = { huyPhieu: false, congKho: 0, daoButToan: 0 } as NonNullable<KeHoachDon['daLam']>
            k.daLam = daLam
            try {
                // Kiểm lại NGAY trước khi ghi: đơn gốc vẫn không có trong bảng
                const conLai = await sp.$queryRawUnsafe(`SELECT 1 FROM "OnlineOrder" WHERE "orderNumber" = $1 LIMIT 1`, k.ma) as any[]
                if (conLai.length) { daLam.loi = 'đơn gốc vừa có lại trong bảng — bỏ'; continue }
                const n = await sp.$executeRawUnsafe(
                    `UPDATE "Transaction" SET status = 'voided', notes = COALESCE(notes, '') || $2
                     WHERE id = $1 AND status NOT IN ('voided', 'returned')`, t.id, GHI_CHU_HUY(k.loai, k.lyDo))
                daLam.huyPhieu = n > 0
                for (const dong of k.kho) {
                    daLam.congKho += await sp.$transaction(async (tx: any) => {
                        // Đọc lại phần còn âm TRONG giao dịch — chạy lại / chạy chồng không cộng hai lần
                        const r = await tx.$queryRawUnsafe(
                            `SELECT COALESCE(SUM(quantity), 0)::float8 AS rong, MIN("productName") AS ten, MIN("productSku") AS sku
                             FROM "InventoryTransaction" WHERE "referenceId" = $1 AND "productId" = $2`, k.soPhieu, dong.productId) as any[]
                        const sl = -Math.round(Number(r[0]?.rong) || 0)
                        if (sl <= 0) return 0
                        await tx.inventoryTransaction.create({
                            data: {
                                type: 'in', productId: dong.productId, productName: r[0]?.ten || '', productSku: r[0]?.sku || '',
                                quantity: sl, reason: LY_DO_KHO, note: `${k.ma}: ${k.lyDo}`.slice(0, 250),
                                referenceId: k.soPhieu, referenceType: 'sale', userName: 'Hệ thống', transactionDate: new Date(),
                            },
                        })
                        await chinhKho(tx, dong.productId, null, sl, `Hoàn kho đơn sàn ${k.ma}`)
                        return sl
                    })
                }
                for (const ref of k.butToan) {
                    try {
                        await sp.journalEntry.create({ data: { ...butToanDao(butToan.get(ref), k.ma, homNay), createdBy: null } })
                        daLam.daoButToan++
                    } catch (e: any) {
                        if (e?.code !== 'P2002') throw e   // P2002 = đã đảo rồi
                    }
                }
            } catch (e) {
                daLam.loi = moTaLoi(e).slice(0, 300)
            }
        }
    }

    // ── Tổng ──
    const tong: Record<string, { don: number; tienPhieu: number; dongKho: number; soCai: number; butToan: number; coHoaDon: number; daHuy: number; daCongCai: number; daDaoBt: number; loi: number }> = {}
    for (const k of keHoach) {
        const key = `${k.hanhDong}${k.hanhDong === 'bo-qua' ? ` (${k.lyDo})` : ''}`
        const x = (tong[key] ||= { don: 0, tienPhieu: 0, dongKho: 0, soCai: 0, butToan: 0, coHoaDon: 0, daHuy: 0, daCongCai: 0, daDaoBt: 0, loi: 0 })
        x.don++; x.tienPhieu += k.tienPhieu; x.dongKho += k.kho.length; x.soCai += k.kho.reduce((s, v) => s + v.soLuong, 0)
        x.butToan += k.butToan.length; if (k.hoaDon.length) x.coHoaDon++
        if (k.daLam?.huyPhieu) x.daHuy++
        x.daCongCai += k.daLam?.congKho || 0; x.daDaoBt += k.daLam?.daoButToan || 0
        if (k.daLam?.loi) x.loi++
    }
    return {
        apply: opts.apply, tong: pl.tong, daXet: pl.daXet, hetGioPhanLoai: pl.hetGio, hetGioGhi: hetGio,
        ngayKhoaSo, theoHanhDong: tong, keHoach,
    }
}
