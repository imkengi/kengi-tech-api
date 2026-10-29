/**
 * TỔNG KẾT TRONG NGÀY CHO KHÁCH QUA ZALO — HÔM NAY MUA BAO NHIÊU, THANH TOÁN BAO NHIÊU (26/10/2026)
 *
 * Chủ shop: "không phải công nợ ngày mà hôm nay đã mua bao nhiêu và thanh toán bao nhiêu á".
 * Biến: {muaHomNay} {soDonHomNay} {daTraHomNay} {noDauNgay} {homNay} (+ {congNo} {ngayChot} ở lib/zaloLichGui.ts).
 *
 * "ĐÃ TRẢ" LẤY TỪ GIAO DỊCH (26/10 tối, chủ shop: "phần thanh toán là lấy trong phần giao dịch chứ k có gắn trên phiếu
 * mà"). Bản đầu suy từ số dư (nợ 0 giờ + mua − nợ hiện tại) nên phải chờ ảnh chụp 0 giờ: ngày đầu không khách nào có số.
 * Nay mỗi khách:
 *
 *     đã trả hôm nay = Σ tiền đã thu trên hoá đơn HÔM NAY + Σ phiếu thu nợ ghi ngày hôm nay
 *
 * - Tiền đã thu của MỘT hoá đơn (completed + partial, cùng tập với "mua") = max(amountReceived − change, Σ Payment khác
 *   'credit'). POS Kengi: amountReceived là tiền khách đưa, change là tiền thối thật. KiotViet: amountReceived = Σ phiếu
 *   thu của hoá đơn, còn change là phần trả DƯ đem trừ nợ cũ (một lần trả cho nhiều hoá đơn) — tiền đó khách trả thật
 *   hôm nay, Σ Payment giữ lại nó. Lấy max thì đúng cả hai mà khỏi đoán nguồn hoá đơn.
 * - Phiếu thu nợ = DebtEntry 'payment' (thu nợ ở Kengi, phiếu thu KiotViet chỉ đi sổ quỹ — đều mang ngày chứng từ), TRỪ
 *   "Giảm nợ do trả hàng…" (trả hàng, không phải trả tiền) và "Thanh toán nợ HĐ <hoá đơn hôm nay>" (khoản đó đã thành
 *   Payment của chính hoá đơn ở trên — cộng nữa là đếm đôi).
 *
 * CHƯA THẤY: khách trả nợ CŨ bằng phiếu thu KiotViet được phân bổ vào hoá đơn cũ. Payment không có cột ngày và KiotViet
 * không bắn webhook cho phiếu thu (memory lich-su-cong-no-lech-kiotviet), nên hôm đó "đã trả" thiếu phần này; {congNo}
 * vẫn đúng vì số dư lấy thẳng từ KiotViet.
 *
 * {noDauNgay} vẫn là ảnh chụp lúc 0 giờ VN (bảng NoKhachDauNgay, tạo lười, chỉ cửa hàng có nhóm Zalo nối khách, giữ 40
 * ngày). Chụp trễ (sau 6 giờ sáng) = không tin; khách nối nhóm SAU lúc chụp = không có số ⇒ tin bỏ dòng chứa {noDauNgay}
 * (zaloGui dienMau), không đoán 0 (thiếu ≠ 0).
 */

import { dinhTien } from './zaloDoanhSo'
import { TRANG_THAI_TINH } from './tinhLaiTongMuaKhach'
import { bangGop, sqlKhachDangNoi, type CapGop } from './zaloNhomKhach'

const BANG = '"NoKhachDauNgay"'
const LECH_VN_MS = 7 * 3600_000
const MOC_XONG = '__xong__'           // dòng đánh dấu "đã chụp ngày này" — giành lượt giữa các bản máy
const CHUP_TRE_NHAT_GIO = 6           // chụp sau 6 giờ sáng VN thì số "đầu ngày" đã lẫn giao dịch sáng
const GIU_NGAY = 40
// Mô tả DebtEntry do code ghi (routes/returns.ts, routes/transactions.ts /pay-debt) — đổi bên đó thì đổi theo
const MO_TA_TRA_HANG = 'Giảm nợ do trả hàng%'
const MO_TA_THU_NO_HD = 'Thanh toán nợ HĐ '

/** Biến tổng kết trong ngày có trong tin? */
export const dungBienHomNay = (noiDung: string) => /\{\s*(muaHomNay|soDonHomNay|daTraHomNay|noDauNgay|homNay)\s*\}/i.test(String(noiDung || ''))
/** Biến cần ảnh chụp nợ đầu ngày? Chỉ {noDauNgay} — {daTraHomNay} lấy từ giao dịch */
export const canNoDauNgay = (noiDung: string) => /\{\s*noDauNgay\s*\}/i.test(String(noiDung || ''))

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
    // Mã chính + mã thêm (nhóm nối nhiều mã, lib/zaloNhomKhach.ts) — thiếu một mã là nhóm đó không có {noDauNgay}
    const khachNoi = await sqlKhachDangNoi(sp)
    const soKhach = await sp.$executeRawUnsafe(
        `INSERT INTO ${BANG} ("ngay", "customerId", "debt", "chupLuc")
         SELECT $1, c."id", COALESCE(c."debt", 0), now() FROM "Customer" c
          WHERE c."id" IN (${khachNoi})
         ON CONFLICT DO NOTHING`, ngay)
    await sp.$executeRawUnsafe(`DELETE FROM ${BANG} WHERE "ngay" < $1`, ngayVN(new Date(luc.getTime() - GIU_NGAY * 86_400_000)))
    return `chup ${Number(soKhach) || 0}`
}

// ─── Số liệu trong ngày ─────────────────────────────────────────────────────

export interface SoNgay {
    mua: number; soDon: number; noNay: number
    daTra: number              // tiền khách trả hôm nay — lấy từ giao dịch (xem đầu file)
    noDau: number | null       // null = chưa có ảnh chụp đầu ngày cho khách này ⇒ tin bỏ dòng {noDauNgay}
}

/**
 * Mua / trả trong ngày VN của `luc` cho từng khách. `khach` mang số dư HIỆN TẠI (Customer.debt).
 * Mua = Σ tổng hoá đơn (completed + partial — ghi nợ vẫn là mua) có ngày bán từ 0 giờ VN tới `luc`; đã trả xem đầu file.
 */
export async function soNgayCuaKhach(sp: any, khach: Array<{ id: string; debt: number | null }>, luc: Date, gop?: CapGop[]): Promise<{ theoKhach: Map<string, SoNgay>; chupLuc: Date | null; chupTre: boolean }> {
    const theoKhach = new Map<string, SoNgay>()
    const g = bangGop(gop)   // nhóm nối nhiều mã: số của các mã cộng về khoá (groupId) — lib/zaloNhomKhach.ts
    const ids = [...new Set([...khach.map(k => k.id), ...g.ids].filter(Boolean))]
    if (!ids.length) return { theoKhach, chupLuc: null, chupTre: false }
    const tu = dauNgayVN(luc)
    const HOM_NAY = `t."customerId" = ANY($1::text[]) AND t."status" = ANY($2::text[])
            AND COALESCE(t."transactionDate", t."createdAt") >= $3 AND COALESCE(t."transactionDate", t."createdAt") <= $4`
    const mua: any[] = await sp.$queryRawUnsafe(
        `SELECT t."customerId" AS k, COALESCE(SUM(t."total"), 0)::float AS tien, COUNT(*)::int AS don,
                COALESCE(SUM(GREATEST(COALESCE(t."amountReceived", 0) - COALESCE(t."change", 0),
                    (SELECT COALESCE(SUM(p."amount"), 0) FROM "Payment" p WHERE p."transactionId" = t."id" AND p."type" <> 'credit'), 0)), 0)::float AS thu
           FROM "Transaction" t
          WHERE ${HOM_NAY}
          GROUP BY t."customerId"`,
        ids, [...TRANG_THAI_TINH], tu, luc)
    const muaTheo = new Map(mua.map(r => [String(r.k), { tien: Number(r.tien) || 0, don: Number(r.don) || 0, thu: Number(r.thu) || 0 }]))
    const phieu: any[] = await sp.$queryRawUnsafe(
        `SELECT d."customerId" AS k, COALESCE(SUM(d."amount"), 0)::float AS tien
           FROM "DebtEntry" d
          WHERE d."customerId" = ANY($1::text[]) AND d."type" = 'payment' AND d."createdAt" >= $3 AND d."createdAt" <= $4
            AND d."description" NOT LIKE $5::text
            AND NOT EXISTS (SELECT 1 FROM "Transaction" t WHERE ${HOM_NAY}
                               AND t."customerId" = d."customerId" AND d."description" = $6::text || t."receiptNumber")
          GROUP BY d."customerId"`,
        ids, [...TRANG_THAI_TINH], tu, luc, MO_TA_TRA_HANG, MO_TA_THU_NO_HD)
    const phieuTheo = new Map(phieu.map(r => [String(r.k), Number(r.tien) || 0]))

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
    const noTheoId = new Map<string, number>(khach.map(k => [k.id, Number(k.debt) || 0] as [string, number]))
    // Cộng về khoá (nhóm nối nhiều mã): mua / đã trả / nợ cộng dồn; nợ đầu ngày chỉ có khi ĐỦ mọi mã có ảnh chụp (thiếu ≠ 0)
    const cacKhoa = g.coGop ? g.khoa : khach.map(k => k.id)
    for (const key of cacKhoa) {
        let tien = 0, don = 0, thu = 0, phieu = 0, no = 0, dau = 0, thieuDau = false
        for (const id of g.idsCua(key)) {
            const m = muaTheo.get(id) || { tien: 0, don: 0, thu: 0 }
            tien += m.tien; don += m.don; thu += m.thu; phieu += phieuTheo.get(id) || 0
            no += noTheoId.get(id) || 0
            const d = chupTre ? undefined : noDau.get(id)
            if (d === undefined) thieuDau = true; else dau += d
        }
        theoKhach.set(key, { mua: Math.round(tien), soDon: don, noNay: no, daTra: Math.max(0, Math.round(thu + phieu)), noDau: thieuDau ? null : dau })
    }
    return { theoKhach, chupLuc, chupTre }
}

/** "26/10/2026" */
const homNayVN = (luc: Date) => { const s = ngayVN(luc); return `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` }

/** Biến tổng kết trong ngày của MỘT khách. Chưa có ảnh chụp 0 giờ ⇒ không có {noDauNgay} (dienMau bỏ dòng đó). */
export function bienHomNay(s: SoNgay, luc: Date): Record<string, string> {
    return {
        muaHomNay: dinhTien(s.mua), soDonHomNay: String(s.soDon), daTraHomNay: dinhTien(s.daTra), homNay: homNayVN(luc),
        ...(s.noDau !== null ? { noDauNgay: dinhTien(Math.max(0, s.noDau)) } : {}),
    }
}
