/**
 * PHIẾU THU KIOTVIET — NGÀY THẬT CỦA TỪNG MÃ TT (23/10/2026).
 *
 * Chủ shop so một khách HUTI: KiotViet "Nợ cần thu từ khách" và Kengi "Lịch sử công nợ" cùng
 * tổng nợ nhưng danh sách lệch hẳn. Gốc (đo prod chỉ đọc 23/10/2026):
 *   - KiotViet PHÂN BỔ mỗi phiếu thu (TT…/TTHD…) vào các hoá đơn còn nợ cũ nhất. Đồng bộ ghi phần
 *     phân bổ thành `Payment` trên hoá đơn đó (reference = mã TT) — nhưng bảng Payment KHÔNG có cột
 *     ngày, nên lịch sử công nợ chỉ hiện được ở NGÀY HOÁ ĐƠN, gộp chung một dòng "PT<số HĐ>".
 *     Một phiếu trả 15/10 chia vào ba hoá đơn tháng 8–9 thành ba mẩu nằm ở ba ngày cũ.
 *   - KiotViet không có webhook cho phiếu thu, lượt đêm không kéo sổ quỹ ⇒ phiếu mới về trễ hoặc
 *     không về (phần đó ở services/kiotvietSync.ts `keoPhieuThuKhach`).
 *
 * Bảng "PhieuThuKV" giữ NGÀY THẬT (`transDate` của KiotViet — có ở cả `invoice.payments[]` lẫn
 * `/cashflow`) theo MÃ phiếu. Chỉ là siêu dữ liệu để HIỂN THỊ: tiền vẫn nằm ở Payment / DebtEntry
 * như cũ nên tổng không đổi — chỉ đổi dòng nào nằm ở ngày nào. Thiếu bảng (cửa hàng chưa
 * /admin/migrate) thì đọc ra rỗng và lịch sử lùi về cách hiện cũ, không hỏng gì.
 */

/** Phần prisma mà file này dùng — để bộ kiểm thay bằng bản giả. */
export interface DbThuan {
    $executeRawUnsafe(sql: string, ...thamSo: any[]): Promise<number>
    $queryRawUnsafe<T = any>(sql: string, ...thamSo: any[]): Promise<T>
}

/** Viết THẲNG lại trong /admin/migrate (routes/admin.ts) — giữ hai bản giống hệt nhau. */
export const DDL_PHIEU_THU_KV = `CREATE TABLE IF NOT EXISTS "PhieuThuKV" (
    "ma" TEXT NOT NULL PRIMARY KEY,
    "ngay" TIMESTAMP(3) NOT NULL,
    "soTien" DOUBLE PRECISION,
    "kvKhachId" TEXT,
    "nguon" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
)`

export type NguonNgay = 'hoa-don' | 'so-quy'

export interface DongNgayPhieuThu {
    ma: string
    ngay: Date
    /** Tổng tiền của CẢ phiếu — chỉ sổ quỹ biết; payments[] hoá đơn chỉ có phần phân bổ. */
    soTien: number | null
    kvKhachId: string | null
    nguon: NguonNgay
}

/**
 * Một bản ghi tiền khách trả của KiotViet → dòng ngày. null khi thiếu mã/ngày hoặc phiếu đã huỷ.
 * Trạng thái đo trên dữ liệu thật: cả `payments[]` của hoá đơn lẫn `/cashflow` dùng
 * 0 = "Đã thanh toán", 1 = "Đã hủy" (06/08/2026 và 23/10/2026).
 * `transDate` là giờ VN không kèm múi — đọc bằng `new Date()` như mọi ngày KiotViet khác
 * trong kiotvietSync (máy chủ chạy TZ=Asia/Ho_Chi_Minh).
 */
export function dongNgayTuKV(p: any, nguon: NguonNgay): DongNgayPhieuThu | null {
    const ma = String(p?.code || '').trim()
    if (!ma) return null
    if (Number(p?.status) === 1) return null
    if (!p?.transDate) return null
    const ngay = new Date(p.transDate)
    if (isNaN(ngay.getTime())) return null
    const tien = Math.abs(Number(p?.amount) || 0)
    return {
        ma,
        ngay,
        soTien: nguon === 'so-quy' && tien > 0 ? tien : null,
        kvKhachId: nguon === 'so-quy' && p?.partnerId != null ? String(p.partnerId) : null,
        nguon,
    }
}

const daDamBao = new WeakSet<object>()

/** Tạo bảng lười, một lần cho mỗi client — code lên trước /admin/migrate vẫn chạy. */
export async function damBaoBangPhieuThuKV(db: DbThuan): Promise<void> {
    if (daDamBao.has(db as any)) return
    await db.$executeRawUnsafe(DDL_PHIEU_THU_KV)
    daDamBao.add(db as any)
}

const LO = 200

/**
 * Ghi (hoặc sửa) ngày của các mã phiếu thu. Trùng mã trong cùng mẻ thì lấy bản sổ quỹ (có tổng
 * tiền + khách). Ngày LUÔN theo KiotViet — đây là số của họ, không có gì để giữ bên mình.
 * Trả số dòng đã ghi.
 */
export async function ghiNgayPhieuThu(db: DbThuan, dong: (DongNgayPhieuThu | null)[]): Promise<number> {
    const theoMa = new Map<string, DongNgayPhieuThu>()
    for (const d of dong) {
        if (!d) continue
        const cu = theoMa.get(d.ma)
        if (!cu || d.nguon === 'so-quy') {
            theoMa.set(d.ma, {
                ...d,
                soTien: d.soTien ?? cu?.soTien ?? null,
                kvKhachId: d.kvKhachId ?? cu?.kvKhachId ?? null,
            })
        }
    }
    const sach = [...theoMa.values()]
    if (!sach.length) return 0
    await damBaoBangPhieuThuKV(db)
    let n = 0
    for (let i = 0; i < sach.length; i += LO) {
        const lo = sach.slice(i, i + LO)
        const thamSo: any[] = []
        const giaTri = lo.map((d, k) => {
            thamSo.push(d.ma, d.ngay.toISOString(), d.soTien, d.kvKhachId, d.nguon)
            const b = k * 5
            // Cột Prisma DateTime = timestamp KHÔNG múi giờ, giữ giờ UTC ⇒ đổi ISO về UTC trước khi cất
            return `($${b + 1}, ($${b + 2}::timestamptz AT TIME ZONE 'UTC'), $${b + 3}::float8, $${b + 4}, $${b + 5},
                     (NOW() AT TIME ZONE 'UTC'), (NOW() AT TIME ZONE 'UTC'))`
        }).join(',\n')
        n += await db.$executeRawUnsafe(
            `INSERT INTO "PhieuThuKV" ("ma", "ngay", "soTien", "kvKhachId", "nguon", "createdAt", "updatedAt")
             VALUES ${giaTri}
             ON CONFLICT ("ma") DO UPDATE SET
                "ngay" = EXCLUDED."ngay",
                "soTien" = COALESCE(EXCLUDED."soTien", "PhieuThuKV"."soTien"),
                "kvKhachId" = COALESCE(EXCLUDED."kvKhachId", "PhieuThuKV"."kvKhachId"),
                "nguon" = CASE WHEN EXCLUDED."nguon" = 'so-quy' THEN 'so-quy' ELSE "PhieuThuKV"."nguon" END,
                "updatedAt" = EXCLUDED."updatedAt"`,
            ...thamSo,
        )
    }
    return n
}

/** Lỗi "bảng PhieuThuKV chưa có" (Postgres 42P01) — phân biệt với mọi lỗi khác. */
export function laLoiThieuBangPhieuThu(e: any): boolean {
    const s = `${e?.code || ''} ${e?.meta?.code || ''} ${e?.message || e}`
    return /PhieuThuKV/.test(s) && /does not exist|42P01/.test(s)
}

/**
 * Ngày thật theo mã phiếu thu. Bảng chưa có ⇒ Map rỗng (lịch sử hiện như cũ). Lỗi khác cũng trả
 * rỗng nhưng có log: đây là siêu dữ liệu hiển thị — đọc hỏng chỉ làm dòng nằm ở ngày hoá đơn như
 * trước, KHÔNG đổi tổng tiền nào.
 */
export async function docNgayPhieuThu(db: DbThuan, ma: string[]): Promise<Map<string, Date>> {
    const ds = [...new Set(ma.map(m => String(m || '').trim()).filter(Boolean))]
    const ra = new Map<string, Date>()
    if (!ds.length) return ra
    try {
        const rows: any[] = await db.$queryRawUnsafe(
            `SELECT "ma", "ngay" FROM "PhieuThuKV" WHERE "ma" = ANY($1::text[])`, ds)
        for (const r of rows || []) {
            const d = new Date(r.ngay)
            if (!isNaN(d.getTime())) ra.set(String(r.ma), d)
        }
    } catch (e: any) {
        if (!laLoiThieuBangPhieuThu(e)) {
            console.warn(`[PhieuThuKV] không đọc được ngày phiếu thu — lịch sử hiện theo ngày hoá đơn: ${String(e?.message || e).slice(0, 200)}`)
        }
    }
    return ra
}

/** Mã phiếu thu KiotViet: TT… (thu chung) hoặc TTHD… (thu kèm hoá đơn) — đo 06/08 + 23/10/2026. */
export const MA_PHIEU_THU_KV = /^TT[A-Z]*\d/

/** DebtEntry do đồng bộ sổ quỹ ghi: "Trả nợ — phiếu thu TT021238 (KiotViet)" → "TT021238". */
export function maTuDongTraNoKV(moTa: string | null | undefined): string | null {
    const m = /^Trả nợ — phiếu thu (\S+) \(KiotViet\)$/.exec(String(moTa || '').trim())
    return m ? m[1]! : null
}
