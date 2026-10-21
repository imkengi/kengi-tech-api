/**
 * PHÍ SÀN GIỮ LẠI KHI CRON DỌN XOÁ ĐƠN SÀN CŨ — bảng "PhiSanDon" (21/10/2026).
 *
 * Phí sàn thật (escrow Shopee / statement TikTok) chỉ nằm trên OnlineOrder.platformFee
 * và netRevenue. Cron dọn (autoSync runCleanup) xoá đơn hoàn tất sau 18 ngày, nên số
 * phí mất theo: thẻ Lãi/Lỗ trang chủ không tính được lợi nhuận ròng của kỳ cũ hơn ~3
 * tuần. Chủ shop đã chốt KHÔNG ước tính phí (06/09/2026) — thiếu số là phải để trống.
 *
 * Bảng này giữ ĐÚNG hai con số đó, khoá theo orderNumber (khớp Transaction.receiptNumber
 * = 'ONLINE-' + orderNumber). Hai đường ghi:
 *   - 'chep-truoc-xoa': cron chép từ đơn gốc ngay trước khi xoá. Chép hỏng ⇒ KHÔNG xoá.
 *   - 'lay-lai': hỏi lại sàn cho đơn ĐÃ bị xoá từ trước (services/layLaiPhiSan.ts). Sàn
 *     không biết mình xoá đơn: đo 21/10/2026 escrow Shopee vẫn trả số thật cho đơn 112
 *     ngày tuổi (ghi chú cũ "hết hạn sau 45 ngày" là do hỏi nhầm gian).
 * Dòng netRevenue = 0 ('chua-lay-duoc') là "đã hỏi mà sàn chưa có số" — KHÔNG phải phí 0.
 */

/** Phần prisma mà file này dùng — để bộ kiểm thay bằng bản giả. */
export interface DbThuan {
    $executeRawUnsafe(sql: string, ...thamSo: any[]): Promise<number>
    $queryRawUnsafe<T = any>(sql: string, ...thamSo: any[]): Promise<T>
}

/**
 * Đơn sàn ĐÃ có số phí thật — cùng luật với /online-orders/stats: netRevenue <> 0 (ÂM là
 * đơn hoàn đã quyết toán, vẫn là số thật) và phí KHÔNG mang hình dạng ước tính
 * total × rate mà webhook cũ ghi. `o` là bí danh bảng OnlineOrder trong câu SQL.
 */
export const daQuyetToanSql = (o: string) => `${o}.id IS NOT NULL AND ${o}."netRevenue" <> 0
    AND NOT (${o}."platformFeeRate" > 0 AND ABS(${o}."platformFee" - ROUND(${o}.total * ${o}."platformFeeRate" / 100)) <= 1)`

const BAY_GIO = `(NOW() AT TIME ZONE 'UTC')`   // cột Prisma DateTime = timestamp KHÔNG múi giờ, giữ giờ UTC

/* ─── Đường 1: chép trước khi xoá ─────────────────────────────────────────── */

/** $1 = mảng id OnlineOrder sắp xoá. Chỉ chép đơn có số phí THẬT; đơn chưa có số thì
 *  không có gì để giữ — phiếu của nó sẽ được đường "lấy lại" hỏi sàn sau. */
export const SQL_CHEP_TRUOC_XOA = `
    INSERT INTO "PhiSanDon" ("orderNumber", "platform", "platformFee", "netRevenue", "nguon", "lanThu", "createdAt", "updatedAt")
    SELECT o."orderNumber", o.platform, o."platformFee", o."netRevenue", 'chep-truoc-xoa', 0, ${BAY_GIO}, ${BAY_GIO}
    FROM "OnlineOrder" o
    WHERE o.id = ANY($1::text[]) AND ${daQuyetToanSql('o')}
    ON CONFLICT ("orderNumber") DO UPDATE SET
        "platform" = EXCLUDED."platform", "platformFee" = EXCLUDED."platformFee",
        "netRevenue" = EXCLUDED."netRevenue", "nguon" = EXCLUDED."nguon", "updatedAt" = EXCLUDED."updatedAt"`

const LO = 500   // không nhét hàng nghìn phần tử vào một mảng tham số

export async function chepPhiTruocKhiXoa(db: DbThuan, ids: string[]): Promise<number> {
    let soDong = 0
    for (let i = 0; i < ids.length; i += LO) {
        soDong += await db.$executeRawUnsafe(SQL_CHEP_TRUOC_XOA, ids.slice(i, i + LO))
    }
    return soDong
}

/** Chép số phí KHÔNG được ⇒ chưa xoá gì. Tách lớp lỗi riêng để cron nói đúng lý do. */
export class LoiChepPhi extends Error {
    constructor(public goc: unknown) {
        super(`không chép được số phí sàn sang PhiSanDon: ${(goc as any)?.message || String(goc)}`)
    }
}

interface DbXoa extends DbThuan {
    onlineOrderItem: { deleteMany(a: any): Promise<{ count: number }> }
    onlineOrder: { deleteMany(a: any): Promise<{ count: number }> }
}

/**
 * Chép phí rồi mới xoá — thứ tự này là cả lý do file tồn tại. Chép hỏng (kể cả vì cửa
 * hàng chưa có bảng PhiSanDon do chưa chạy /admin/migrate) thì ném LoiChepPhi TRƯỚC
 * khi chạm vào đơn nào: đơn nằm lại thêm một lượt còn hơn mất số phí vĩnh viễn.
 */
export async function giuPhiRoiXoa(db: DbXoa, ids: string[]): Promise<{ daChep: number; daXoa: number }> {
    let daChep: number
    try {
        daChep = await chepPhiTruocKhiXoa(db, ids)
    } catch (e) {
        throw new LoiChepPhi(e)
    }
    // Xoá dòng hàng trước (cascade nếu DB không tự xoá) rồi mới tới đơn
    await db.onlineOrderItem.deleteMany({ where: { onlineOrderId: { in: ids } } })
    const kq = await db.onlineOrder.deleteMany({ where: { id: { in: ids } } })
    return { daChep, daXoa: kq.count }
}

/* ─── Đường 2: lấy lại phí cho đơn đã bị xoá ──────────────────────────────── */

export type San = 'shopee' | 'tiktok'
export const TIEN_TO_PHIEU: Record<San, string> = { shopee: 'ONLINE-SPE-', tiktok: 'ONLINE-TIK-' }

/** Mã đơn bên sàn: orderNumber bỏ tiền tố SPE-/TIK-. */
export const maBenSan = (orderNumber: string) => String(orderNumber || '').replace(/^(SPE|TIK)-/i, '')

/** Hỏi một đơn tối đa từng ấy lần (cách nhau ≥ 2 ngày) rồi thôi — đơn sàn không bao giờ
 *  trả số (đơn quá cũ, đơn gian đã gỡ…) không được đốt lượt gọi mãi. */
export const SO_LAN_HOI_TOI_DA = 6

export interface SoPhi { platformFee: number; netRevenue: number }

/** Shopee — CÙNG luật nhận với runFeeSync và /admin/sync-fees. */
export function soTuEscrow(e: { escrowAmount: number; totalFees: number } | null | undefined): SoPhi | null {
    if (!e || !(e.escrowAmount > 0 || e.totalFees > 0)) return null
    return { platformFee: e.totalFees, netRevenue: e.escrowAmount }
}

/** TikTok — CÙNG luật nhận với /admin/lay-phi-tiktok: nhận cả thực nhận ÂM khi có phí
 *  (đơn hoàn đã quyết toán là lỗ thật, bỏ đi là giấu lỗ). */
export function soTuStatement(s: { settlementAmount: number; feeAmount: number } | null | undefined): SoPhi | null {
    if (!s || !(s.settlementAmount > 0 || s.feeAmount > 0)) return null
    return { platformFee: Math.round(s.feeAmount), netRevenue: Math.round(s.settlementAmount) }
}

/** Thứ tự hỏi các gian cùng sàn: gian nhiều đơn trước. Hỏi nhầm gian thì Shopee trả
 *  `order_not_found … does not belong to you`, tốn thêm một lượt chứ không sai số. */
export function xepGianTheoSoDon<T extends { id: string }>(gian: T[], soDon: Map<string, number>): T[] {
    return [...gian].sort((a, b) => (soDon.get(b.id) || 0) - (soDon.get(a.id) || 0))
}

/** Phiếu đơn sàn mất đơn gốc mà chưa có số phí giữ lại (hoặc đã hỏi nhưng chưa có, tới
 *  hạn hỏi lại). Mới nhất trước. $1 giới hạn · $2 từ ngày · $3 trước ngày · $4 số lần tối đa.
 *  `tong` = số phiếu khớp điều kiện TRƯỚC khi cắt LIMIT — để báo còn lại bao nhiêu. */
export function sqlDonMatGoc(san: San): string {
    const ngay = `COALESCE(t."transactionDate", t."createdAt")`
    return `
    SELECT substring(t."receiptNumber" from 8) AS "orderNumber", t.total, ${ngay} AS ngay,
           COUNT(*) OVER ()::int AS tong
    FROM "Transaction" t
    LEFT JOIN "OnlineOrder" o ON o."orderNumber" = substring(t."receiptNumber" from 8)
    LEFT JOIN "PhiSanDon" f ON f."orderNumber" = substring(t."receiptNumber" from 8)
    WHERE t."receiptNumber" LIKE '${TIEN_TO_PHIEU[san]}%'
      AND t.status NOT IN ('voided', 'returned')
      AND o.id IS NULL
      AND (f."orderNumber" IS NULL
           OR (f."netRevenue" = 0 AND f."lanThu" < $4
               AND (f."thuLuc" IS NULL OR f."thuLuc" < ${BAY_GIO} - interval '2 days')))
      AND ($2::timestamp IS NULL OR ${ngay} >= $2::timestamp)
      AND ($3::timestamp IS NULL OR ${ngay} < $3::timestamp)
    ORDER BY ${ngay} DESC
    LIMIT $1`
}

/** Ghi số lấy được. Không bao giờ đè một dòng ĐÃ có số (WHERE netRevenue = 0). */
export const SQL_GHI_LAY_DUOC = `
    INSERT INTO "PhiSanDon" ("orderNumber", "platform", "platformFee", "netRevenue", "nguon", "kenhId", "lanThu", "thuLuc", "createdAt", "updatedAt")
    SELECT x.ma, x.san, x.phi, x.thuc, 'lay-lai', x.kenh, 1, ${BAY_GIO}, ${BAY_GIO}, ${BAY_GIO}
    FROM UNNEST($1::text[], $2::text[], $3::float8[], $4::float8[], $5::text[]) AS x(ma, san, phi, thuc, kenh)
    ON CONFLICT ("orderNumber") DO UPDATE SET
        "platformFee" = EXCLUDED."platformFee", "netRevenue" = EXCLUDED."netRevenue", "nguon" = EXCLUDED."nguon",
        "kenhId" = EXCLUDED."kenhId", "lanThu" = "PhiSanDon"."lanThu" + 1, "thuLuc" = EXCLUDED."thuLuc", "updatedAt" = EXCLUDED."updatedAt"
    WHERE "PhiSanDon"."netRevenue" = 0`

/** Đánh dấu "đã hỏi, sàn chưa có số" — để lần sau giãn ra, quá SO_LAN_HOI_TOI_DA thì thôi. */
export const SQL_GHI_CHUA_CO = `
    INSERT INTO "PhiSanDon" ("orderNumber", "platform", "nguon", "lanThu", "thuLuc", "createdAt", "updatedAt")
    SELECT x.ma, x.san, 'chua-lay-duoc', 1, ${BAY_GIO}, ${BAY_GIO}, ${BAY_GIO}
    FROM UNNEST($1::text[], $2::text[]) AS x(ma, san)
    ON CONFLICT ("orderNumber") DO UPDATE SET
        "lanThu" = "PhiSanDon"."lanThu" + 1, "thuLuc" = EXCLUDED."thuLuc", "updatedAt" = EXCLUDED."updatedAt"
    WHERE "PhiSanDon"."netRevenue" = 0`

/* ─── Đọc: thẻ Lãi/Lỗ ─────────────────────────────────────────────────────── */

/**
 * Phí sàn của kỳ cho getDashboardStats.laiLo. $1 từ · $2 tới · $3 chi nhánh (null = tất cả).
 * Số phí lấy từ đơn gốc nếu đơn còn và đã quyết toán, không thì từ PhiSanDon.
 * `coBangGiu = false` là câu CŨ — dùng khi cửa hàng chưa có bảng (chưa chạy migrate).
 */
export function sqlPhiSanKy(coBangGiu: boolean): string {
    const dq = daQuyetToanSql('o')
    const coSo = coBangGiu ? `((${dq}) OR COALESCE(f."netRevenue", 0) <> 0)` : `(${dq})`
    const thucNhan = coBangGiu ? `CASE WHEN ${dq} THEN o."netRevenue" ELSE f."netRevenue" END` : `o."netRevenue"`
    return `SELECT
                COALESCE(SUM(t.total - ${thucNhan}) FILTER (WHERE ${coSo}), 0) AS khau_tru,
                COUNT(*) FILTER (WHERE NOT ${coSo}) AS chua_so_don,
                COALESCE(SUM(t.total) FILTER (WHERE NOT ${coSo}), 0) AS chua_doanh_thu
             FROM "Transaction" t
             LEFT JOIN "OnlineOrder" o ON o."orderNumber" = substring(t."receiptNumber" from 8)
             ${coBangGiu ? `LEFT JOIN "PhiSanDon" f ON f."orderNumber" = substring(t."receiptNumber" from 8)` : ''}
             WHERE t."receiptNumber" LIKE 'ONLINE-%'
               AND t.status NOT IN ('voided', 'returned')
               AND t."createdAt" >= $1 AND t."createdAt" <= $2
               AND ($3::text IS NULL OR t."branchId" = $3)`
}

/** Lỗi "bảng PhiSanDon chưa có" (Postgres 42P01) — phân biệt với mọi lỗi khác. */
export function laLoiThieuBangGiu(e: any): boolean {
    const s = `${e?.message || ''} ${e?.meta?.message || ''} ${e?.meta?.code || ''}`
    return /PhiSanDon/.test(s) && /does not exist|42P01/.test(s)
}
