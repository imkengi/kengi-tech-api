/* ═══════════════════════════════════════════════════════════════════════════════
 *  ĐỌC LẠI PHÍ SHOPEE KHI ĐƠN HOÀN TẤT (21/11/2026)
 *
 *  FeeSync (cron/autoSync.runFeeSync) đọc escrow MỘT lần cho đơn chưa có phí (platformFee = 0) — thường lúc đơn còn
 *  PROCESSED / SHIPPED. Lúc đó (đo prod chỉ đọc 21/11/2026) escrow_amount còn CỘNG ship khách trả (final_shipping_fee = 0)
 *  và CHƯA trừ phí bảo vệ vận chuyển (Shopee trừ khi đã gửi hàng); đơn hoàn tất thì final_shipping_fee = −ship (4/4 đơn đo)
 *  và phí bảo vệ đã trừ. Đọc một lần rồi thôi ⇒ thực nhận / lợi nhuận đơn hoàn tất CAO hơn thật đúng bằng ship khách trả +
 *  phí bảo vệ, và lệch với lãi dự kiến trong chi tiết đơn (chủ shop 21/11: "bấm chi tiết hiện đúng mà bên ngoài hiện sai").
 *
 *  Việc: đơn Shopee COMPLETED đã có phí, ≤ 45 ngày, CHƯA đọc lại ⇒ đọc escrow lần nữa (cùng phép tính của FeeSync:
 *  ShopeeService.getEscrowDetail); số khác ⇒ ghi platformFee / netRevenue / affiliateFee. Ghi dấu vào bảng "PhiSanDocLai"
 *  (tạo lười trong schema cửa hàng — khỏi đổi schema-store) để không đọc lại. Shopee chưa có số ⇒ dấu 'chua-co', 24 giờ sau
 *  thử lại. Lỗi (token / mạng / proxy) ⇒ KHÔNG ghi dấu, lượt sau thử lại; 5 lỗi liền mà chưa đơn nào được ⇒ thôi gian lượt này.
 *
 *  Chỉ đổi PHÍ + THỰC NHẬN của đơn sàn — không đụng giá ghi sổ / phiếu / hoá đơn (chủ shop 06/09/2026: "xuất hoá đơn là đúng
 *  rồi, xuất hàng bán"). Trang Đơn hàng online đọc dấu này (daDocLaiPhiCuoi): đơn hoàn tất CHƯA đọc lại thì ô Lợi nhuận hiện
 *  lãi dự kiến theo escrow thay cho số đọc sớm. Tắt: DOC_LAI_PHI_HOAN_TAT=0.
 * ═══════════════════════════════════════════════════════════════════════════════ */

/** Đơn hoàn tất trong ngần này kể từ lúc đặt — như FeeSync (cron dọn xoá đơn hoàn tất sau 18 ngày, chép phí sang PhiSanDon). */
export const CUA_SO_DOC_LAI_MS = 45 * 86_400_000
/** Shopee chưa có số của đơn hoàn tất ⇒ thử lại sau ngần này. */
export const CHO_THU_LAI_MS = 24 * 3600_000
/** Mỗi lượt, mỗi gian: tối đa ngần này đơn (lần đầu chạy phải đọc lại cả đơn hoàn tất cũ — chia nhiều lượt). */
export const TRAN_DOC_LAI_MOI_KENH = 120

/** Số FeeSync cần từ escrow (đúng hình ShopeeService.getEscrowDetail). */
export interface EscrowGon { escrowAmount: number; totalFees: number; affiliateFee: number | null }

export interface KetQuaDocLai {
    /** đơn hoàn tất chưa đọc lại đã nhặt */
    quet: number
    /** số Shopee báo khác số đang lưu ⇒ đã ghi */
    doi: number
    /** số như cũ (đơn đọc lần đầu lúc đã hoàn tất, hoặc ship 0 + đã gửi) */
    giong: number
    /** Shopee chưa có số — 24 giờ sau thử lại */
    chuaCo: number
    /** lỗi khi hỏi Shopee — lượt sau thử lại */
    loi: number
    /** hết giờ / thôi gian / đơn vừa đổi trạng thái — lượt sau */
    deLai: number
    /** đơn có số đổi (soát / log) */
    idDoi: string[]
    loiDau?: string
}

const SQL_TAO_BANG = `CREATE TABLE IF NOT EXISTS "PhiSanDocLai" (
    "orderId"     TEXT PRIMARY KEY,
    "docLuc"      TIMESTAMP(3) NOT NULL,
    "ketQua"      TEXT NOT NULL,
    "phiCu"       DOUBLE PRECISION,
    "thucNhanCu"  DOUBLE PRECISION,
    "phiMoi"      DOUBLE PRECISION,
    "thucNhanMoi" DOUBLE PRECISION
)`

/** prisma (client của MỘT schema) ⇒ đã có bảng / chưa (lúc dò — dò lại sau 10 phút). */
const CO_BANG = new WeakMap<object, { co: boolean; luc: number }>()

async function damBaoBang(sp: any): Promise<void> {
    if (CO_BANG.get(sp)?.co) return
    try {
        await sp.$executeRawUnsafe(SQL_TAO_BANG)
    } catch (e) {
        // hai bản cùng tạo một lúc ⇒ bản thua có thể vấp khoá trùng pg_type: bảng đã có thì thôi
        const r: any[] = await sp.$queryRawUnsafe(`SELECT to_regclass('"PhiSanDocLai"') IS NOT NULL AS co`).catch(() => [])
        if (!r?.[0]?.co) throw e
    }
    CO_BANG.set(sp, { co: true, luc: Date.now() })
}

/** Lỗi gọi sàn có thể kèm nguyên URL đã ký ⇒ che token / chữ ký / mã đơn trước khi ghi log. */
const cheLoi = (e: any) => String(e?.message || e).replace(/\b(access_token|sign|order_sn|partner_key)=[^&\s"']+/gi, '$1=…').slice(0, 200)

const ghiDau = (sp: any, id: string, bay: number, ketQua: 'doi' | 'giong' | 'chua-co', phiCu: number, tnCu: number, phiMoi: number | null, tnMoi: number | null) =>
    sp.$executeRawUnsafe(
        `INSERT INTO "PhiSanDocLai" ("orderId", "docLuc", "ketQua", "phiCu", "thucNhanCu", "phiMoi", "thucNhanMoi")
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT ("orderId") DO UPDATE SET "docLuc" = EXCLUDED."docLuc", "ketQua" = EXCLUDED."ketQua",
             "phiMoi" = EXCLUDED."phiMoi", "thucNhanMoi" = EXCLUDED."thucNhanMoi"`,
        id, new Date(bay), ketQua, phiCu, tnCu, phiMoi, tnMoi)

/**
 * Đọc lại phí các đơn Shopee hoàn tất của MỘT gian. `docEscrow(sn)`: ShopeeService.getEscrowDetail của gian (null = Shopee
 * chưa có số; NÉM = lỗi). `chayDongThoi`: mapWithConcurrency (mặc định tuần tự). Không ném vì từng đơn.
 */
export async function docLaiPhiHoanTat(sp: any, ch: { id: string; name?: string | null }, docEscrow: (sn: string) => Promise<EscrowGon | null>,
    o: { han: number; bayGio?: number; tran?: number; songSong?: number; chayDongThoi?: (ds: any[], f: (x: any) => Promise<void>, n: number) => Promise<any> }): Promise<KetQuaDocLai> {
    const kq: KetQuaDocLai = { quet: 0, doi: 0, giong: 0, chuaCo: 0, loi: 0, deLai: 0, idDoi: [] }
    if (process.env.DOC_LAI_PHI_HOAN_TAT === '0') return kq
    const bay = o.bayGio ?? Date.now()
    await damBaoBang(sp)
    const rows: any[] = await sp.$queryRawUnsafe(
        `SELECT o.id, o."externalOrderId", o."platformFee", o."netRevenue", o."affiliateFee"
           FROM "OnlineOrder" o LEFT JOIN "PhiSanDocLai" d ON d."orderId" = o.id
          WHERE o."channelId" = $1 AND o.status = 'COMPLETED' AND o."platformFee" > 0 AND o."externalOrderId" IS NOT NULL
            AND o."createdAt" >= $2 AND (d."orderId" IS NULL OR (d."ketQua" = 'chua-co' AND d."docLuc" < $3))
          ORDER BY o."createdAt" DESC LIMIT $4`,
        String(ch.id), new Date(bay - CUA_SO_DOC_LAI_MS), new Date(bay - CHO_THU_LAI_MS), o.tran ?? TRAN_DOC_LAI_MOI_KENH)
    kq.quet = (rows || []).length
    if (!kq.quet) return kq
    let hongLienTiep = 0, duoc = 0
    const lam = async (r: any): Promise<void> => {
        // hết giờ, hoặc 5 đơn liền hỏng mà chưa đơn nào được (token chết / sàn lỗi) ⇒ để lượt sau, khỏi đốt hạn mức gọi
        if (Date.now() > o.han || (duoc === 0 && hongLienTiep >= 5)) { kq.deLai++; return }
        const id = String(r.id)
        const sn = String(r.externalOrderId || '').replace(/^SPE-/i, '').trim()
        if (!sn) { kq.deLai++; return }
        const phiCu = Number(r.platformFee) || 0, tnCu = Number(r.netRevenue) || 0
        let e: EscrowGon | null
        try {
            e = await docEscrow(sn)
        } catch (err: any) {
            kq.loi++; hongLienTiep++
            if (!kq.loiDau) kq.loiDau = cheLoi(err)
            return
        }
        try {
            if (!e || !(e.escrowAmount > 0 || e.totalFees > 0)) {
                kq.chuaCo++
                await ghiDau(sp, id, bay, 'chua-co', phiCu, tnCu, null, null)
                return
            }
            duoc++; hongLienTiep = 0
            const phiMoi = Number(e.totalFees) || 0, tnMoi = Number(e.escrowAmount) || 0
            const affCu = r.affiliateFee == null ? null : Number(r.affiliateFee)
            const affMoi = e.affiliateFee == null ? null : Number(e.affiliateFee)
            const khac = Math.abs(phiMoi - phiCu) >= 1 || Math.abs(tnMoi - tnCu) >= 1 || (affMoi != null && (affCu == null || Math.abs(affMoi - affCu) >= 1))
            if (khac) {
                // chỉ đơn CÒN hoàn tất (vừa chuyển trả hàng thì để lượt sau / luồng trả hàng lo)
                const n = await sp.onlineOrder.updateMany({
                    where: { id, status: 'COMPLETED' },
                    data: { platformFee: phiMoi, netRevenue: tnMoi, ...(affMoi != null ? { affiliateFee: affMoi } : {}) },
                })
                if (!n?.count) { kq.deLai++; return }
                kq.doi++
                kq.idDoi.push(id)
            } else kq.giong++
            await ghiDau(sp, id, bay, khac ? 'doi' : 'giong', phiCu, tnCu, phiMoi, tnMoi)
        } catch (err: any) {
            // ghi đơn / ghi dấu hỏng ⇒ lượt sau đọc lại (số đã ghi thì lần sau ra "giống", chỉ tốn một lời gọi)
            kq.loi++
            if (!kq.loiDau) kq.loiDau = `ghi: ${cheLoi(err)}`
        }
    }
    const chay = o.chayDongThoi || (async (ds: any[], f: (x: any) => Promise<void>) => { for (const x of ds) await f(x) })
    await chay(rows, lam, o.songSong ?? 4)
    return kq
}

/** Đơn nào trong `ids` đã đọc lại phí lúc hoàn tất (số CUỐI của Shopee). Bảng chưa có / đọc hỏng ⇒ rỗng — không ném, không
 *  đọc thẳng bảng chưa có (Prisma vẫn in "Raw query failed" dù đã bắt 42P01 ⇒ dò to_regclass trước, nhớ 10 phút). */
export async function daDocLaiPhiCuoi(sp: any, ids: string[]): Promise<Set<string>> {
    const out = new Set<string>()
    const ds = [...new Set((ids || []).filter(Boolean).map(String))]
    if (!ds.length) return out
    try {
        const c = CO_BANG.get(sp)
        let co = !!c?.co
        if (!co && !(c && Date.now() - c.luc < 600_000)) {
            const r: any[] = await sp.$queryRawUnsafe(`SELECT to_regclass('"PhiSanDocLai"') IS NOT NULL AS co`)
            co = !!r?.[0]?.co
            CO_BANG.set(sp, { co, luc: Date.now() })
        }
        if (!co) return out
        const rows: any[] = await sp.$queryRawUnsafe(
            `SELECT "orderId" FROM "PhiSanDocLai" WHERE "orderId" = ANY($1::text[]) AND "ketQua" IN ('doi', 'giong')`, ds)
        for (const r of rows || []) out.add(String(r.orderId))
    } catch { /* thiếu dấu ⇒ trang đơn hiện lãi dự kiến — không sai số, chỉ chưa phải số cuối */ }
    return out
}
