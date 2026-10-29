/**
 * MỘT NHÓM ZALO NỐI NHIỀU MÃ KHÁCH (29/10/2026)
 *
 * Chủ shop: "chỗ nối khách vào zalo thì nhiều mã có thể nối 1 khách" — một đại lý có khi mang HAI, BA mã khách
 * trên Kengi/KiotViet (mã cũ + mã mới, mã cửa hàng + mã chủ, mã sỉ + mã lẻ…) mà chỉ có MỘT nhóm Zalo. Trước đây
 * mỗi nhóm nối được đúng một mã, nên nợ / mua hôm nay / doanh số / món lâu chưa mua của các mã kia không vào tin.
 *
 * CÁCH LƯU
 *   - ZaloNhom.customerId + maKhach vẫn là MÃ CHÍNH: {tenKhach} {maKhach}, tin ZaloTin gắn khách, thông tin xuất
 *     hoá đơn trả n8n, cột customerId của hàng chờ gửi — nhóm chỉ một mã không đổi gì.
 *   - Các mã THÊM nằm ở bảng lười "ZaloNhomKhach" (groupId, customerId, thuTu): tạo lúc lần đầu có nhóm nối thêm mã,
 *     KHÔNG thêm model Prisma, không phải migrate từng cửa hàng (cùng nếp ZaloLichGui / NoKhachDauNgay). Cửa hàng
 *     chưa có bảng ⇒ mọi nhóm một mã như cũ, đọc chỉ tốn một câu to_regclass.
 *
 * SỐ CỦA NHÓM = GỘP CÁC MÃ: {congNo} = Σ nợ, mua / đã trả hôm nay = Σ, doanh số = Σ, thói quen mua = phiếu của mọi mã
 * cộng dồn (thứ hay mua đếm chung, nhịp từng món tính trên lịch sử gộp), "/hoadon" bật Lấy HĐ cho phiếu của MỌI mã
 * trong ngày, hoá đơn MISA của mã thêm cũng tìm ra nhóm. Cách gộp: các lib tính số vẫn hỏi SQL THEO TỪNG MÃ (câu SQL
 * đã chạy thật không đổi) rồi cộng về KHOÁ theo cặp `CapGop` {id: mã khách, key: khoá} — khoá = groupId, nên một mã
 * nằm ở hai nhóm (HUTI có 8 mã như vậy) thì nhận số ở cả hai; không truyền cặp gộp thì khoá = chính mã (như cũ).
 *
 * Nhập Excel (lib/zaloNhom.ts) vẫn một mã một nhóm — nối thêm mã ở tab Chăm sóc khách hàng › Đã nối › "Thêm mã".
 */

const BANG = '"ZaloNhomKhach"'
/** Mỗi nhóm nối tối đa chừng này mã — nhiều hơn là nối nhầm, không phải đại lý thật */
export const TOI_DA_MA = 20

const daTaoBang = new Set<string>()

async function tenSchema(sp: any): Promise<string> {
    const s = sp?.__schema
    if (typeof s === 'string' && s) return s
    if (typeof sp?.$queryRawUnsafe !== 'function') return 'mac-dinh'   // prisma giả của bộ kiểm cũ
    const r: any[] = await sp.$queryRawUnsafe('SELECT current_schema() AS s')
    return String(r[0]?.s || 'mac-dinh')
}

export async function damBaoBangNhomKhach(sp: any): Promise<void> {
    const schema = await tenSchema(sp)
    if (daTaoBang.has(schema)) return
    try {
        await sp.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS ${BANG} (
            "groupId" TEXT NOT NULL,
            "customerId" TEXT NOT NULL,
            "thuTu" INTEGER NOT NULL DEFAULT 0,
            "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
            PRIMARY KEY ("groupId", "customerId")
        )`)
        await sp.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ZaloNhomKhach_customerId_idx" ON ${BANG} ("customerId")`)
    } catch (e: any) {
        if (!/already exists|duplicate key value/i.test(String(e?.message || ''))) throw e
    }
    daTaoBang.add(schema)
}

/** Cửa hàng này đã có bảng mã thêm chưa (chưa có = chưa nhóm nào nối thêm mã). Chỉ nhớ kết quả "có". */
export async function coBangNhomKhach(sp: any): Promise<boolean> {
    const schema = await tenSchema(sp)
    if (daTaoBang.has(schema)) return true
    if (typeof sp?.$queryRawUnsafe !== 'function') return false   // prisma giả của bộ kiểm cũ: coi như chưa nhóm nào nối thêm mã
    const r: any[] = await sp.$queryRawUnsafe(`SELECT to_regclass('"ZaloNhomKhach"') IS NOT NULL AS co`)
    if (r[0]?.co) daTaoBang.add(schema)
    return !!r[0]?.co
}

/** groupId → các mã THÊM (theo thứ tự đã nối). Chưa có bảng ⇒ Map rỗng. */
export async function docKhachThem(sp: any, groupIds: string[]): Promise<Map<string, string[]>> {
    const ra = new Map<string, string[]>()
    const ids = [...new Set(groupIds.map(g => String(g || '')).filter(Boolean))]
    if (!ids.length || !(await coBangNhomKhach(sp))) return ra
    for (let i = 0; i < ids.length; i += 500) {
        const rows: any[] = await sp.$queryRawUnsafe(
            `SELECT "groupId", "customerId" FROM ${BANG} WHERE "groupId" = ANY($1::text[]) ORDER BY "groupId", "thuTu", "createdAt"`,
            ids.slice(i, i + 500),
        )
        for (const r of rows) {
            const g = String(r.groupId)
            ra.set(g, [...(ra.get(g) || []), String(r.customerId)])
        }
    }
    return ra
}

/** Ghi lại TRỌN danh sách mã thêm của một nhóm (thay thế bản cũ). Rỗng = bỏ hết mã thêm. */
export async function ghiKhachThem(sp: any, groupId: string, customerIds: string[]): Promise<void> {
    const ids = [...new Set(customerIds.map(String).filter(Boolean))]
    if (!ids.length) { await xoaKhachThem(sp, groupId); return }
    await damBaoBangNhomKhach(sp)
    await sp.$executeRawUnsafe(`DELETE FROM ${BANG} WHERE "groupId" = $1`, groupId)
    // Vài mã một nhóm — chèn từng dòng cho rõ thứ tự, không cần chèn gộp
    for (let i = 0; i < ids.length; i++) {
        await sp.$executeRawUnsafe(`INSERT INTO ${BANG} ("groupId", "customerId", "thuTu") VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, groupId, ids[i], i)
    }
}

export async function xoaKhachThem(sp: any, groupId: string): Promise<void> {
    if (!(await coBangNhomKhach(sp))) return
    await sp.$executeRawUnsafe(`DELETE FROM ${BANG} WHERE "groupId" = $1`, groupId)
}

/** Các nhóm mà khách là MÃ THÊM: customerId → groupId[] (nhóm mà khách là mã chính thì tra ZaloNhom như cũ) */
export async function nhomCoKhachThem(sp: any, customerIds: string[]): Promise<Map<string, string[]>> {
    const ra = new Map<string, string[]>()
    const ids = [...new Set(customerIds.map(String).filter(Boolean))]
    if (!ids.length || !(await coBangNhomKhach(sp))) return ra
    for (let i = 0; i < ids.length; i += 500) {
        const rows: any[] = await sp.$queryRawUnsafe(`SELECT "groupId", "customerId" FROM ${BANG} WHERE "customerId" = ANY($1::text[])`, ids.slice(i, i + 500))
        for (const r of rows) {
            const c = String(r.customerId)
            ra.set(c, [...(ra.get(c) || []), String(r.groupId)])
        }
    }
    return ra
}

/** Câu con SQL: id MỌI khách đang nối nhóm Zalo (mã chính + mã thêm) — chụp nợ đầu ngày dùng để biết chụp ai */
export async function sqlKhachDangNoi(sp: any): Promise<string> {
    const chinh = `SELECT "customerId" FROM "ZaloNhom" WHERE "customerId" IS NOT NULL`
    return (await coBangNhomKhach(sp)) ? `${chinh} UNION SELECT "customerId" FROM ${BANG}` : chinh
}

/** [mã chính, ...mã thêm] — bỏ trùng, bỏ trống. Nhóm chưa nối ⇒ []. */
export const khachCuaNhom = (customerId: string | null | undefined, them?: string[] | null): string[] =>
    [...new Set([customerId, ...(them || [])].filter((x): x is string => !!x))]

// ─── Cặp gộp: số của từng mã cộng về khoá ───────────────────────────────────

export interface CapGop { id: string; key: string }

/** Cặp gộp cho danh sách nhóm: mỗi mã của nhóm → khoá = groupId. Nhóm chưa nối khách không có cặp nào. */
export function capGopTheoNhom(nhom: Array<{ groupId: string; customerId: string | null }>, them: Map<string, string[]>): CapGop[] {
    const ra: CapGop[] = []
    for (const n of nhom) for (const id of khachCuaNhom(n.customerId, them.get(n.groupId))) ra.push({ id, key: String(n.groupId) })
    return ra
}

export interface BangGop {
    coGop: boolean
    ids: string[]                       // mọi mã có trong cặp gộp
    khoa: string[]                      // mọi khoá (giữ thứ tự xuất hiện)
    khoaCua: (id: string) => string[]   // mã → các khoá nhận số của mã đó (không gộp: chính mã)
    idsCua: (key: string) => string[]   // khoá → các mã thành viên (không gộp: chính khoá)
}

/** Bảng tra từ cặp gộp. Không có cặp ⇒ khoá = chính mã, các lib tính số chạy y như trước. */
export function bangGop(gop?: CapGop[] | null): BangGop {
    if (!gop || !gop.length) return { coGop: false, ids: [], khoa: [], khoaCua: id => [id], idsCua: key => [key] }
    const theoMa = new Map<string, string[]>()
    const theoKhoa = new Map<string, string[]>()
    for (const c of gop) {
        const id = String(c.id || ''), key = String(c.key || '')
        if (!id || !key) continue
        const k = theoMa.get(id) || []
        if (!k.includes(key)) k.push(key)
        theoMa.set(id, k)
        const m = theoKhoa.get(key) || []
        if (!m.includes(id)) m.push(id)
        theoKhoa.set(key, m)
    }
    return {
        coGop: true, ids: [...theoMa.keys()], khoa: [...theoKhoa.keys()],
        khoaCua: id => theoMa.get(id) || [],
        idsCua: key => theoKhoa.get(key) || [],
    }
}
