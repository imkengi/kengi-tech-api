/**
 * TỔNG KẾT TRONG NGÀY CHO KHÁCH QUA ZALO — HÔM NAY MUA BAO NHIÊU, THANH TOÁN BAO NHIÊU (26/10/2026)
 *
 * Chủ shop: "không phải công nợ ngày mà hôm nay đã mua bao nhiêu và thanh toán bao nhiêu á".
 * Biến: {muaHomNay} {soDonHomNay} {daTraHomNay} {noDauNgay} {homNay} (+ {congNo} {ngayChot} ở lib/zaloLichGui.ts).
 *
 * VÌ SAO "ĐÃ TRẢ" PHẢI SUY TỪ SỐ DƯ: đo 26/10/2026 (HUTI) — 7 ngày qua 0 dòng sổ nợ (DebtEntry) cho các khách
 * có nhóm Zalo: phiếu thu KiotViet KHÔNG có webhook, về Kengi trễ hàng tuần và gắn vào hoá đơn cũ không ngày
 * (xem memory lich-su-cong-no-lech-kiotviet). Cộng phiếu thu ⇒ "đã trả 0đ" cho người vừa trả tiền. Còn số dư
 * Customer.debt thì đúng gần như tức thì (webhook customer.update ⇒ hỏi lại KiotViet). Nên:
 *
 *     đã trả hôm nay = nợ ĐẦU NGÀY + mua hôm nay − nợ HIỆN TẠI
 *
 * khớp số dư KiotViet bằng cấu tạo. "Nợ đầu ngày" = ảnh chụp lúc 0 giờ VN (bảng NoKhachDauNgay, tạo lười, chỉ
 * cửa hàng có nhóm Zalo nối khách, giữ 40 ngày). Chụp trễ (sau 6 giờ sáng) = không tin; khách nối nhóm SAU lúc
 * chụp = không có số ⇒ BỎ khách đó, không đoán 0 (thiếu ≠ 0).
 *
 * Bỏ thay vì báo sai: khách có phiếu trả hàng trong ngày (tiền trả hàng lẫn vào "đã trả" — đo 30 ngày: 4 phiếu),
 * và khách có số "đã trả" âm (vd hoá đơn ngày cũ mới về hôm nay) — cả hai báo rõ trong xem trước.
 */

import { dinhTien } from './zaloDoanhSo'
import { TRANG_THAI_TINH } from './tinhLaiTongMuaKhach'

const BANG = '"NoKhachDauNgay"'
const LECH_VN_MS = 7 * 3600_000
const MOC_XONG = '__xong__'           // dòng đánh dấu "đã chụp ngày này" — giành lượt giữa các bản máy
const CHUP_TRE_NHAT_GIO = 6           // chụp sau 6 giờ sáng VN thì số "đầu ngày" đã lẫn giao dịch sáng
const GIU_NGAY = 40
const SAI_SO_DONG = 1000              // lệch làm tròn của sàn / KiotViet — âm quá mức này mới là không khớp

/** Biến tổng kết trong ngày có trong tin? */
export const dungBienHomNay = (noiDung: string) => /\{\s*(muaHomNay|soDonHomNay|daTraHomNay|noDauNgay|homNay)\s*\}/i.test(String(noiDung || ''))
/** Biến cần ảnh chụp nợ đầu ngày? */
export const canNoDauNgay = (noiDung: string) => /\{\s*(daTraHomNay|noDauNgay)\s*\}/i.test(String(noiDung || ''))

/** 'YYYY-MM-DD' theo ngày VN */
export const ngayVN = (d: Date) => new Date(d.getTime() + LECH_VN_MS).toISOString().slice(0, 10)
const dauNgayVN = (d: Date) => new Date(Date.parse(`${ngayVN(d)}T00:00:00+07:00`))

// ─── Bảng ảnh chụp ──────────────────────────────────────────────────────────

const daTaoBang = new Set<string>()
const daChup = new Map<string, string>()   // schema → ngày đã chụp xong (bản máy này) — nhịp mỗi phút khỏi hỏi lại

async function tenSchema(sp: any): Promise<string> {
    const s = (sp as any).__schema
    if (typeof s === 'string' && s) return s
    const r: any[] = await sp.$queryRawUnsafe('SELECT current_schema() AS s')
    return String(r[0]?.s || 'mac-dinh')
}

async function damBaoBang(sp: any): Promise<void> {
    const schema = await tenSchema(sp)
    if (daTaoBang.has(schema)) return
    try {
        await sp.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS ${BANG} (
            "ngay" TEXT NOT NULL,
            "customerId" TEXT NOT NULL,
            "debt" DOUBLE PRECISION NOT NULL DEFAULT 0,
            "chupLuc" TIMESTAMP(3) NOT NULL DEFAULT now(),
            PRIMARY KEY ("ngay", "customerId")
        )`)
    } catch (e: any) {
        if (!/already exists|duplicate key value/i.test(String(e?.message || ''))) throw e
    }
    daTaoBang.add(schema)
}

async function coBang(sp: any): Promise<boolean> {
    const schema = await tenSchema(sp)
    if (daTaoBang.has(schema)) return true
    const r: any[] = await sp.$queryRawUnsafe(`SELECT to_regclass('"NoKhachDauNgay"') IS NOT NULL AS co`)
    if (r[0]?.co) daTaoBang.add(schema)
    return !!r[0]?.co
}

/**
 * Chụp nợ đầu ngày (nhịp mỗi phút, chỉ 0–6 giờ sáng VN). Một lần mỗi ngày mỗi cửa hàng: bản máy nào chèn được
 * dòng đánh dấu thì bản đó chụp. Chỉ khách đang nối nhóm Zalo; cửa hàng không có nhóm nào thì không tạo bảng.
 */
export async function chupNoDauNgay(sp: any, luc = new Date()): Promise<string> {
    const gioVN = new Date(luc.getTime() + LECH_VN_MS).getUTCHours()
    if (gioVN >= CHUP_TRE_NHAT_GIO) return ''
    const schema = await tenSchema(sp)
    const ngay = ngayVN(luc)
    if (daChup.get(schema) === ngay) return ''
    const soNhom = await sp.zaloNhom.count({ where: { customerId: { not: null } } }).catch(() => 0)
    if (!soNhom) { daChup.set(schema, ngay); return '' }
    await damBaoBang(sp)
    const n = await sp.$executeRawUnsafe(
        `INSERT INTO ${BANG} ("ngay", "customerId", "debt", "chupLuc") VALUES ($1, '${MOC_XONG}', 0, now()) ON CONFLICT DO NOTHING`, ngay)
    daChup.set(schema, ngay)
    if (!Number(n)) return ''
    const soKhach = await sp.$executeRawUnsafe(
        `INSERT INTO ${BANG} ("ngay", "customerId", "debt", "chupLuc")
         SELECT $1, c."id", COALESCE(c."debt", 0), now() FROM "Customer" c
          WHERE c."id" IN (SELECT "customerId" FROM "ZaloNhom" WHERE "customerId" IS NOT NULL)
         ON CONFLICT DO NOTHING`, ngay)
    await sp.$executeRawUnsafe(`DELETE FROM ${BANG} WHERE "ngay" < $1`, ngayVN(new Date(luc.getTime() - GIU_NGAY * 86_400_000)))
    return `chup ${Number(soKhach) || 0}`
}

// ─── Số liệu trong ngày ─────────────────────────────────────────────────────

export interface SoNgay {
    mua: number; soDon: number; noNay: number
    noDau: number | null       // null = chưa có ảnh chụp đầu ngày cho khách này
    daTra: number | null       // null = không tính được (thiếu ảnh chụp / có trả hàng / âm)
    lyDoKhongTinh: 'chua_chup' | 'tra_hang' | 'khong_khop' | null
}

/**
 * Mua / trả trong ngày VN của `luc` cho từng khách. `khach` mang số dư HIỆN TẠI (Customer.debt).
 * Mua = Σ tổng hoá đơn (completed + partial — ghi nợ vẫn là mua) có ngày bán từ 0 giờ VN tới `luc`.
 */
export async function soNgayCuaKhach(sp: any, khach: Array<{ id: string; debt: number | null }>, luc: Date): Promise<{ theoKhach: Map<string, SoNgay>; chupLuc: Date | null; chupTre: boolean }> {
    const theoKhach = new Map<string, SoNgay>()
    const ids = [...new Set(khach.map(k => k.id).filter(Boolean))]
    if (!ids.length) return { theoKhach, chupLuc: null, chupTre: false }
    const tu = dauNgayVN(luc)
    const mua: any[] = await sp.$queryRawUnsafe(
        `SELECT t."customerId" AS k, COALESCE(SUM(t."total"), 0)::float AS tien, COUNT(*)::int AS don
           FROM "Transaction" t
          WHERE t."customerId" = ANY($1::text[]) AND t."status" = ANY($2::text[])
            AND COALESCE(t."transactionDate", t."createdAt") >= $3 AND COALESCE(t."transactionDate", t."createdAt") <= $4
          GROUP BY t."customerId"`,
        ids, [...TRANG_THAI_TINH], tu, luc)
    const muaTheo = new Map(mua.map(r => [String(r.k), { tien: Number(r.tien) || 0, don: Number(r.don) || 0 }]))
    const tra: any[] = await sp.$queryRawUnsafe(
        `SELECT DISTINCT t."customerId" AS k FROM "ReturnOrder" r JOIN "Transaction" t ON t."receiptNumber" = r."originalInvoice"
          WHERE r."status" <> 'rejected' AND r."createdAt" >= $2 AND t."customerId" = ANY($1::text[])`, ids, tu)
    const coTraHang = new Set(tra.map(r => String(r.k)))

    let chupLuc: Date | null = null
    const noDau = new Map<string, number>()
    if (await coBang(sp)) {
        const ngay = ngayVN(luc)
        const moc: any[] = await sp.$queryRawUnsafe(`SELECT "chupLuc" FROM ${BANG} WHERE "ngay" = $1 AND "customerId" = '${MOC_XONG}'`, ngay)
        chupLuc = moc[0]?.chupLuc ? new Date(moc[0].chupLuc) : null
        if (chupLuc) {
            const rows: any[] = await sp.$queryRawUnsafe(`SELECT "customerId", "debt" FROM ${BANG} WHERE "ngay" = $1 AND "customerId" = ANY($2::text[])`, ngay, ids)
            for (const r of rows) noDau.set(String(r.customerId), Number(r.debt) || 0)
        }
    }
    const chupTre = !!chupLuc && new Date(chupLuc.getTime() + LECH_VN_MS).getUTCHours() >= CHUP_TRE_NHAT_GIO
    for (const k of khach) {
        const m = muaTheo.get(k.id) || { tien: 0, don: 0 }
        const noNay = Number(k.debt) || 0
        const dau = chupTre ? undefined : noDau.get(k.id)
        let daTra: number | null = null
        let lyDo: SoNgay['lyDoKhongTinh'] = null
        if (dau === undefined) lyDo = 'chua_chup'
        else if (coTraHang.has(k.id)) lyDo = 'tra_hang'
        else {
            const x = Math.round(dau + m.tien - noNay)
            if (x < -SAI_SO_DONG) lyDo = 'khong_khop'
            else daTra = Math.max(0, x)
        }
        theoKhach.set(k.id, { mua: Math.round(m.tien), soDon: m.don, noNay, noDau: dau ?? null, daTra, lyDoKhongTinh: lyDo })
    }
    return { theoKhach, chupLuc, chupTre }
}

/** "26/10/2026" */
const homNayVN = (luc: Date) => { const s = ngayVN(luc); return `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` }

/** Biến tổng kết trong ngày của MỘT khách (null ⇒ khách này không có đủ số — đừng gửi) */
export function bienHomNay(s: SoNgay, luc: Date, canTra: boolean): Record<string, string> | null {
    if (canTra && s.daTra === null) return null
    return {
        muaHomNay: dinhTien(s.mua), soDonHomNay: String(s.soDon), homNay: homNayVN(luc),
        ...(s.daTra !== null ? { daTraHomNay: dinhTien(s.daTra) } : {}),
        ...(s.noDau !== null ? { noDauNgay: dinhTien(Math.max(0, s.noDau)) } : {}),
    }
}

export const LY_DO_BO: Record<NonNullable<SoNgay['lyDoKhongTinh']>, string> = {
    chua_chup: 'chưa có số nợ đầu ngày (Kengi chụp lúc 0 giờ — khách nối nhóm sau giờ đó, hoặc ngày đầu dùng)',
    tra_hang: 'có phiếu trả hàng hôm nay (chưa tách được tiền trả hàng khỏi tiền thanh toán)',
    khong_khop: 'số không khớp (vd hoá đơn ngày cũ mới về hôm nay)',
}
