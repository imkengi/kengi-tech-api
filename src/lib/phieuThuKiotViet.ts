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

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * DÒNG TIỀN THEO NGÀY THU (18/11/2026).
 *
 * Chủ shop: "sao phiếu thu 60 tr mà vào trong dòng tiền có 20 triệu hơn". Đo prod chỉ đọc: một phiếu
 * TT… thu hôm nay bị KiotViet phân bổ vào 4 hoá đơn cũ (ngày khác nhau) ⇒ 4 Payment KHÔNG ngày; trang
 * Dòng Tiền hiện mỗi hoá đơn MỘT dòng "Bán hàng" ở NGÀY HOÁ ĐƠN với Σ payment ⇒ ngày thu chỉ thấy phần
 * trừ vào hoá đơn cùng ngày, phần còn lại lùi về ngày cũ (một cửa hàng: hàng trăm phiếu / tháng lệch ngày).
 * Phiếu không phân bổ (DebtEntry "Trả nợ — phiếu thu …") thì không hiện ở Dòng Tiền chút nào.
 *
 * Sửa HIỂN THỊ, không đụng sổ: tiền vẫn nằm ở Payment / DebtEntry. Mẩu nào là phiếu thu RIÊNG đã biết
 * ngày thì rời dòng "Bán hàng", gom thành MỘT dòng phiếu thu ở ngày thu thật — khớp sổ quỹ KiotViet và
 * tab Lịch sử công nợ của khách (routes/customers.ts gom cùng cách).
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * Phiếu thu RIÊNG của KiotViet: khách trả sau, KiotViet phân bổ vào các hoá đơn còn nợ (TT0…).
 * TTHD… là phiếu thu LÚC BÁN, đi cùng chính hoá đơn — ở lại dòng bán (đo prod 18/11/2026: gần như mọi mẩu
 * TTHD cách giờ hoá đơn ≤ 10 phút; mẩu TT… thì phần lớn nằm khác ngày hoá đơn).
 */
export function laPhieuThuRiengKV(ma: string | null | undefined): boolean {
    const s = String(ma || '').trim()
    return MA_PHIEU_THU_KV.test(s) && !/^TTHD/i.test(s)
}

const BIET_CO_BANG = new WeakMap<object, number>()

/**
 * Bảng PhieuThuKV có chưa — DÒ TRƯỚC khi đọc: bắt lỗi 42P01 thì Prisma vẫn in "Raw query failed" lên log
 * (memory bat-loi-khong-im-log-prisma). Chỉ nhớ khi CÓ (10 phút); bảng tạo lười nên "chưa có" phải hỏi lại.
 */
export async function coBangPhieuThuKV(db: DbThuan): Promise<boolean> {
    if (daDamBao.has(db as any)) return true
    const het = BIET_CO_BANG.get(db as any)
    if (het && het > Date.now()) return true
    const r: any[] = await db.$queryRawUnsafe(`SELECT to_regclass('"PhieuThuKV"') IS NOT NULL AS co`)
    const co = r?.[0]?.co === true
    if (co) BIET_CO_BANG.set(db as any, Date.now() + 10 * 60_000)
    return co
}

/**
 * Ngày thu thật của những mẩu Payment là phiếu thu RIÊNG KiotViet. Map mã → ngày; mã chưa biết ngày thì
 * vắng (mẩu đó ở lại dòng bán như cũ). Lỗi đọc NÉM ra — người gọi phải biết để KHÔNG tách nửa vời
 * (tách mẩu khỏi dòng bán mà không có dòng phiếu thu bù = mất tiền trên màn; ngược lại = đếm hai lần).
 */
export async function docNgayThuPhieuRiengKV(db: DbThuan, ma: (string | null | undefined)[]): Promise<Map<string, Date>> {
    const ds = [...new Set(ma.map(m => String(m || '').trim()).filter(laPhieuThuRiengKV))]
    const ra = new Map<string, Date>()
    if (!ds.length) return ra
    if (!(await coBangPhieuThuKV(db))) return ra
    for (let i = 0; i < ds.length; i += 2000) {
        const rows: any[] = await db.$queryRawUnsafe(
            `SELECT "ma", "ngay" FROM "PhieuThuKV" WHERE "ma" = ANY($1::text[])`, ds.slice(i, i + 2000))
        for (const r of rows || []) {
            const d = new Date(r.ngay)
            if (!isNaN(d.getTime())) ra.set(String(r.ma), d)
        }
    }
    return ra
}

export interface PhieuThuRiengKV {
    ma: string
    ngay: Date
    /** Số Kengi đang giữ cho phiếu: Σ mẩu trên hoá đơn; phiếu không gắn hoá đơn thì là dòng trả nợ. */
    soTien: number
    /** Tổng KiotViet ghi ở sổ quỹ (null nếu chưa biết) — lệch với soTien thì màn nói ra. */
    soTienKV: number | null
    khachId: string | null
    khachTen: string | null
    /** 'cash' | 'bank_transfer' … theo mẩu lớn nhất; phiếu không gắn hoá đơn không biết ⇒ null. */
    phuongThuc: string | null
    hoaDon: { ma: string; ngay: Date; soTien: number }[]
    /** Phiếu không phân bổ vào hoá đơn nào (DebtEntry "Trả nợ — phiếu thu … (KiotViet)"). */
    khongGanHoaDon: boolean
}

export interface TuyChonDocPhieuRieng {
    /** Mốc đầu (gồm) / mốc cuối (KHÔNG gồm) theo ngày thu. null = không chặn. */
    tu: Date | null
    den: Date | null
    /** Người dùng bị khoá trong một chi nhánh ⇒ chỉ mẩu trên hoá đơn của chi nhánh đó. */
    branchId?: string | null
    /** Tìm đúng một mã phiếu (ô tìm kiếm / nút "Mở trong Dòng tiền") — bỏ qua khoảng ngày. */
    ma?: string | null
    /** Số phiếu tối đa (mới nhất trước). Mặc định 1000 — như trang lấy 1.000 giao dịch. */
    gioiHan?: number
}

/**
 * Phiếu thu RIÊNG của KiotViet theo NGÀY THU — mỗi mã một dòng, đủ các mẩu đã phân bổ (hoá đơn ở ngày nào
 * cũng gom về), cộng phiếu không phân bổ (DebtEntry). Bỏ mẩu trên hoá đơn đã huỷ (khớp Lịch sử công nợ).
 * Không có bảng PhieuThuKV ⇒ rỗng. Lỗi đọc NÉM ra (xem docNgayThuPhieuRiengKV).
 */
export async function docPhieuThuRiengKV(db: DbThuan, o: TuyChonDocPhieuRieng): Promise<{ phieu: PhieuThuRiengKV[]; catBot: boolean }> {
    if (!(await coBangPhieuThuKV(db))) return { phieu: [], catBot: false }
    const gioiHan = Math.max(1, Math.min(5000, Math.floor(o.gioiHan ?? 1000)))
    const maTim = String(o.ma || '').trim()
    const chiMa = laPhieuThuRiengKV(maTim)
    if (maTim && !chiMa) return { phieu: [], catBot: false }

    // 1. Mã phiếu trong kỳ (mới nhất trước, lấy dư một để biết có bị cắt)
    const dk: string[] = [`"ma" !~ '^TTHD'`, `"ma" ~ '^TT[A-Z]*[0-9]'`]
    const ts: any[] = []
    if (chiMa) { ts.push(maTim); dk.push(`"ma" = $${ts.length}`) }
    else {
        if (o.tu) { ts.push(o.tu.toISOString()); dk.push(`"ngay" >= ($${ts.length}::timestamptz AT TIME ZONE 'UTC')`) }
        if (o.den) { ts.push(o.den.toISOString()); dk.push(`"ngay" < ($${ts.length}::timestamptz AT TIME ZONE 'UTC')`) }
    }
    ts.push(gioiHan + 1)
    const ma: any[] = await db.$queryRawUnsafe(
        `SELECT "ma", "ngay", "soTien" FROM "PhieuThuKV" WHERE ${dk.join(' AND ')} ORDER BY "ngay" DESC, "ma" DESC LIMIT $${ts.length}`, ...ts)
    let catBot = ma.length > gioiHan
    const maKy = ma.slice(0, gioiHan)
    // Bị cắt ⇒ mốc dưới thật là ngày của phiếu cũ nhất còn giữ (phiếu không phân bổ cũng cắt theo, khỏi hổng giữa)
    const mocCat = catBot && maKy.length ? new Date(maKy[maKy.length - 1].ngay) : null

    // 2. Các mẩu đã phân bổ vào hoá đơn
    const theoMa = new Map<string, PhieuThuRiengKV>()
    for (const k of maKy) {
        theoMa.set(String(k.ma), {
            ma: String(k.ma), ngay: new Date(k.ngay), soTien: 0,
            soTienKV: k.soTien == null ? null : Number(k.soTien), khachId: null, khachTen: null, phuongThuc: null,
            hoaDon: [], khongGanHoaDon: false,
        })
    }
    const lonNhat = new Map<string, number>()
    const dsMa = [...theoMa.keys()]
    for (let i = 0; i < dsMa.length; i += 1000) {
        const tsM: any[] = [dsMa.slice(i, i + 1000)]
        let locCn = ''
        if (o.branchId) { tsM.push(o.branchId); locCn = ` AND t."branchId" = $2` }
        const manh: any[] = await db.$queryRawUnsafe(
            `SELECT p.reference AS ma, p.amount, p.type, t."receiptNumber" AS "maHD", t."createdAt" AS "ngayHD",
                    t."customerId", t."customerName"
               FROM "Payment" p JOIN "Transaction" t ON t.id = p."transactionId"
              WHERE p.reference = ANY($1::text[]) AND p.type <> 'credit' AND t.status <> 'voided'${locCn}`, ...tsM)
        for (const m of manh) {
            const ph = theoMa.get(String(m.ma))
            const tien = Number(m.amount) || 0
            if (!ph || tien <= 0) continue
            ph.soTien += tien
            ph.hoaDon.push({ ma: String(m.maHD), ngay: new Date(m.ngayHD), soTien: tien })
            if (!ph.khachId && m.customerId) ph.khachId = String(m.customerId)
            if (!ph.khachTen && m.customerName) ph.khachTen = String(m.customerName)
            if (tien > (lonNhat.get(ph.ma) ?? 0)) { lonNhat.set(ph.ma, tien); ph.phuongThuc = m.type ? String(m.type) : null }
        }
    }

    // 3. Phiếu KHÔNG phân bổ: đồng bộ sổ quỹ ghi DebtEntry, không có Payment (người bị khoá chi nhánh: bỏ —
    //    DebtEntry không mang chi nhánh)
    if (!o.branchId) {
        const dkD: string[] = [`type = 'payment'`, `description LIKE 'Trả nợ — phiếu thu %'`, `description LIKE '%(KiotViet)'`]
        const tsD: any[] = []
        if (chiMa) { tsD.push(`Trả nợ — phiếu thu ${maTim} (KiotViet)`); dkD.push(`description = $${tsD.length}`) }
        else {
            const tu = mocCat && (!o.tu || mocCat > o.tu) ? mocCat : o.tu
            if (tu) { tsD.push(tu.toISOString()); dkD.push(`"createdAt" >= ($${tsD.length}::timestamptz AT TIME ZONE 'UTC')`) }
            if (o.den) { tsD.push(o.den.toISOString()); dkD.push(`"createdAt" < ($${tsD.length}::timestamptz AT TIME ZONE 'UTC')`) }
        }
        tsD.push(gioiHan + 1)
        const no: any[] = await db.$queryRawUnsafe(
            `SELECT "customerId", "customerName", amount, description, "createdAt" FROM "DebtEntry"
              WHERE ${dkD.join(' AND ')} ORDER BY "createdAt" DESC LIMIT $${tsD.length}`, ...tsD)
        if (no.length > gioiHan) catBot = true
        for (const d of no.slice(0, gioiHan)) {
            const maD = maTuDongTraNoKV(d.description)
            const tien = Number(d.amount) || 0
            if (!maD || tien <= 0) continue
            const ph = theoMa.get(maD)
            // Mã đã có mẩu trên hoá đơn ⇒ tiền đã đếm ở mẩu; đồng bộ không ghi cả hai, nhưng lỡ có thì KHÔNG cộng lần hai
            if (ph && ph.soTien > 0) continue
            theoMa.set(maD, {
                ma: maD, ngay: ph?.ngay ?? new Date(d.createdAt), soTien: tien, soTienKV: ph?.soTienKV ?? null,
                khachId: d.customerId ? String(d.customerId) : null, khachTen: d.customerName ? String(d.customerName) : null,
                phuongThuc: null, hoaDon: [], khongGanHoaDon: true,
            })
        }
    }

    const phieu = [...theoMa.values()]
        .filter(p => p.soTien > 0)
        .sort((a, b) => b.ngay.getTime() - a.ngay.getTime() || (a.ma < b.ma ? 1 : -1))
        .slice(0, gioiHan)
    for (const p of phieu) p.hoaDon.sort((a, b) => a.ngay.getTime() - b.ngay.getTime())
    return { phieu, catBot }
}
