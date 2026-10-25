/**
 * TUỲ CHỌN GỬI TIN ZALO (25/10/2026) — chủ shop: "giờ thêm các custom gửi zalo đi".
 * Những gì node Zalo của n8n cho chỉnh, nay Kengi gửi thẳng (lib/zaloKengi.ts) cũng chỉnh được:
 *
 *  - ĐỊNH DẠNG CHỮ bằng thẻ trong nội dung: [đậm]…[/đậm] [nghiêng] [gạch chân] [gạch ngang]
 *    [đỏ] [cam] [vàng] [xanh] [to] [nhỏ] (không dấu / tiếng Anh cũng nhận: [b] [dam] [red]…).
 *    Thẻ phải có cặp mới thành định dạng; thẻ lẻ / thẻ lạ giữ nguyên là chữ — thà hiện "[đậm]"
 *    còn hơn nuốt mất chữ của khách. Vị trí tính trên chữ ĐÃ ĐIỀN mẫu ({tenKhach}… dài ngắn khác
 *    nhau theo nhóm) và đã chuẩn hoá NFC (Zalo đếm theo đơn vị UTF-16 như JS).
 *  - MỨC ĐỘ: thường / quan trọng / khẩn cấp (Zalo gắn nhãn trên tin).
 *  - NHẮC CẢ NHÓM: chèn "@All" đầu tin, nhắc với uid "-1" (zca-js: uid -1 = cả nhóm). Nhóm chỉ cho
 *    trưởng/phó nhắc cả nhóm thì Zalo có thể từ chối — gửi thử trước.
 *  - TỰ XOÁ sau 1 / 7 / 14 ngày (ttl, mili giây).
 *  - HẸN GIỜ GỬI cả đợt: bảng phụ ZaloDotTuyChon (tạo lười — KHÔNG thêm cột vào model Prisma,
 *    cột mới trên model là P2022 ở mọi cửa hàng chưa migrate). Nhịp gửi bỏ qua đợt chưa tới giờ.
 *
 * Qua n8n: gửi chữ THƯỜNG (đã bỏ thẻ) + kèm dinhDang/tuyChon trong dữ liệu cho workflow tự dùng.
 */

export const NHAN_CA_NHOM = '@All'

/** Mã kiểu chữ của Zalo (zca-js TextStyle) */
const KIEU: Record<string, string> = {
    'dam': 'b', 'b': 'b', 'bold': 'b',
    'nghieng': 'i', 'i': 'i', 'italic': 'i',
    'gach chan': 'u', 'gachchan': 'u', 'gach duoi': 'u', 'u': 'u', 'underline': 'u',
    'gach ngang': 's', 'gachngang': 's', 's': 's', 'strike': 's',
    'do': 'c_db342e', 'red': 'c_db342e',
    'cam': 'c_f27806', 'orange': 'c_f27806',
    'vang': 'c_f7b503', 'yellow': 'c_f7b503',
    'xanh': 'c_15a85f', 'xanh la': 'c_15a85f', 'green': 'c_15a85f',
    'to': 'f_18', 'lon': 'f_18', 'big': 'f_18',
    'nho': 'f_13', 'small': 'f_13',
}

const boDau = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase().replace(/\s+/g, ' ').trim()

export interface KieuChu { start: number; len: number; st: string }

/** "[đậm]Giảm 50%[/đậm] hôm nay" → { msg: "Giảm 50% hôm nay", styles: [{start:0,len:8,st:'b'}] } */
export function phanTichDinhDang(vao: string): { msg: string; styles: KieuChu[] } {
    const s = String(vao || '')
    type The = { dau: number; cuoi: number; dong: boolean; ma: string }
    const the: The[] = []
    const re = /\[(\/?)([^\[\]\n]{1,12})\]/g
    let m: RegExpExecArray | null
    while ((m = re.exec(s))) {
        const ma = KIEU[boDau(m[2])]
        if (ma) the.push({ dau: m.index, cuoi: m.index + m[0].length, dong: m[1] === '/', ma })
    }
    // Ghép cặp: thẻ đóng ăn thẻ mở CÙNG KIỂU gần nhất còn để ngỏ; thẻ lẻ giữ là chữ
    const cap = new Map<number, number>()   // chỉ số thẻ mở → chỉ số thẻ đóng
    const mo = new Map<string, number[]>()
    the.forEach((t, i) => {
        if (!t.dong) { mo.set(t.ma, [...(mo.get(t.ma) || []), i]); return }
        const ds = mo.get(t.ma)
        if (ds?.length) cap.set(ds.pop()!, i)
    })
    const boDi = new Set<number>()
    for (const [a, b] of cap) { boDi.add(a); boDi.add(b) }

    let msg = ''
    let tu = 0
    const viTri = new Map<number, number>()   // chỉ số thẻ → vị trí trong chữ đầu ra
    the.forEach((t, i) => {
        if (!boDi.has(i)) return
        msg += s.slice(tu, t.dau)
        viTri.set(i, msg.length)
        tu = t.cuoi
    })
    msg += s.slice(tu)
    const styles: KieuChu[] = []
    for (const [a, b] of cap) {
        const start = viTri.get(a)!, het = viTri.get(b)!
        if (het > start) styles.push({ start, len: het - start, st: the[a].ma })
    }
    styles.sort((x, y) => x.start - y.start || y.len - x.len)
    return { msg, styles }
}

/** Bỏ thẻ định dạng (chữ thường) — cho n8n, cho bản ghi lịch sử, cho người đọc log */
export const boDinhDang = (s: string) => phanTichDinhDang(s).msg

// ─── Tuỳ chọn của một tin / một đợt ─────────────────────────────────────────

export interface TuyChonTin {
    mucDo: 0 | 1 | 2              // 0 thường · 1 quan trọng · 2 khẩn cấp
    nhacCaNhom: boolean
    tuXoa: 0 | 1 | 7 | 14         // ngày; 0 = không tự xoá
    henGio: string | null         // ISO — chỉ dùng cho đợt gửi
}

export const TUY_CHON_MAC_DINH: TuyChonTin = { mucDo: 0, nhacCaNhom: false, tuXoa: 0, henGio: null }
const HEN_TOI_DA_NGAY = 31

export const laMacDinh = (t: TuyChonTin | null | undefined) => !t || (!t.mucDo && !t.nhacCaNhom && !t.tuXoa && !t.henGio)

/** Đọc tuỳ chọn từ màn hình. Trả CHUỖI = lỗi để báo người dùng. Hẹn sát giờ (< 1 phút) / đã qua ⇒ gửi ngay. */
export function docTuyChon(raw: any, choHenGio = true, bayGio = Date.now()): TuyChonTin | string {
    if (raw == null) return { ...TUY_CHON_MAC_DINH }
    if (typeof raw !== 'object' || Array.isArray(raw)) return 'Tuỳ chọn gửi không hợp lệ'
    const mucDo = Number(raw.mucDo ?? 0)
    if (mucDo !== 0 && mucDo !== 1 && mucDo !== 2) return 'Mức độ tin chỉ nhận Thường / Quan trọng / Khẩn cấp'
    const tuXoa = Number(raw.tuXoa ?? 0)
    if (tuXoa !== 0 && tuXoa !== 1 && tuXoa !== 7 && tuXoa !== 14) return 'Tự xoá chỉ nhận sau 1, 7 hoặc 14 ngày'
    let henGio: string | null = null
    if (choHenGio && raw.henGio) {
        const t = Date.parse(String(raw.henGio))
        if (!Number.isFinite(t)) return 'Giờ hẹn gửi không hợp lệ'
        if (t > bayGio + HEN_TOI_DA_NGAY * 86_400_000) return `Chỉ hẹn gửi trước tối đa ${HEN_TOI_DA_NGAY} ngày`
        henGio = t > bayGio + 60_000 ? new Date(t).toISOString() : null
    }
    return { mucDo: mucDo as 0 | 1 | 2, nhacCaNhom: raw.nhacCaNhom === true, tuXoa: tuXoa as 0 | 1 | 7 | 14, henGio }
}

export interface TinDaSoan {
    msg: string
    styles: KieuChu[]
    mentions: Array<{ pos: number; uid: string; len: number }>
    urgency: 0 | 1 | 2
    ttl: number
}

/** Chữ ĐÃ ĐIỀN mẫu + tuỳ chọn ⇒ đúng dạng zca-js sendMessage cần */
export function soanTin(daDien: string, tc: TuyChonTin | null | undefined): TinDaSoan {
    let tho = String(daDien || '').normalize('NFC')
    const nhac = !!tc?.nhacCaNhom
    if (nhac) tho = tho ? `${NHAN_CA_NHOM} ${tho}` : NHAN_CA_NHOM
    const { msg, styles } = phanTichDinhDang(tho)
    return {
        msg, styles,
        mentions: nhac ? [{ pos: 0, uid: '-1', len: NHAN_CA_NHOM.length }] : [],
        urgency: tc?.mucDo || 0,
        ttl: tc?.tuXoa ? tc.tuXoa * 86_400_000 : 0,
    }
}

// ─── Bảng phụ ZaloDotTuyChon (tạo lười — cùng nếp lib/zaloKengi.ts) ────────

const BANG = '"ZaloDotTuyChon"'
const daTaoBang = new Set<string>()

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
            "dotId" TEXT PRIMARY KEY,
            "tuyChon" TEXT NOT NULL,
            "henGio" TIMESTAMP(3),
            "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now()
        )`)
    } catch (e: any) {
        if (!/already exists|duplicate key value/i.test(String(e?.message || ''))) throw e
    }
    daTaoBang.add(schema)
}

/** Có bảng chưa — đường đọc dùng cái này để KHÔNG tạo bảng ở cửa hàng chưa từng dùng tuỳ chọn */
async function coBang(sp: any): Promise<boolean> {
    if (daTaoBang.has(await tenSchema(sp))) return true
    const r: any[] = await sp.$queryRawUnsafe(`SELECT to_regclass('"ZaloDotTuyChon"') IS NOT NULL AS co`)
    return !!r[0]?.co
}

/** Giờ UTC dạng "không múi giờ" — cột TIMESTAMP(3) như mọi cột Prisma; so với now() AT TIME ZONE 'UTC' */
const gioUtc = (iso: string) => new Date(iso).toISOString().replace('Z', '')

/** Lưu tuỳ chọn của đợt — đợt toàn mặc định thì không ghi gì */
export async function luuTuyChonDot(sp: any, dotId: string, tc: TuyChonTin): Promise<void> {
    if (laMacDinh(tc)) return
    await damBaoBang(sp)
    await sp.$executeRawUnsafe(
        `INSERT INTO ${BANG} ("dotId", "tuyChon", "henGio") VALUES ($1, $2, $3::timestamp(3))
         ON CONFLICT ("dotId") DO UPDATE SET "tuyChon" = EXCLUDED."tuyChon", "henGio" = EXCLUDED."henGio"`,
        dotId, JSON.stringify({ ...tc, henGio: null }), tc.henGio ? gioUtc(tc.henGio) : null)
}

/** Tuỳ chọn của nhiều đợt (lịch sử / nhịp gửi). Đợt không có dòng = mặc định. */
export async function docTuyChonCacDot(sp: any, dotIds: string[]): Promise<Map<string, TuyChonTin>> {
    const kq = new Map<string, TuyChonTin>()
    const ids = [...new Set(dotIds.filter(Boolean))].slice(0, 200)
    if (!ids.length || !(await coBang(sp))) return kq
    const rows: any[] = await sp.$queryRawUnsafe(
        `SELECT "dotId", "tuyChon", "henGio" FROM ${BANG} WHERE "dotId" IN (${ids.map((_, i) => `$${i + 1}`).join(', ')})`, ...ids)
    for (const r of rows) {
        let t: any = {}
        try { t = JSON.parse(r.tuyChon || '{}') } catch { t = {} }
        const doc = docTuyChon({ ...t, henGio: null }, false)
        kq.set(r.dotId, { ...(typeof doc === 'string' ? TUY_CHON_MAC_DINH : doc), henGio: r.henGio ? new Date(r.henGio).toISOString() : null })
    }
    return kq
}

/** Đợt CHƯA tới giờ hẹn — nhịp gửi bỏ qua (không giành dòng, không tính lượt) */
export async function dotChuaToiGio(sp: any): Promise<string[]> {
    if (!(await coBang(sp))) return []
    const rows: any[] = await sp.$queryRawUnsafe(`SELECT "dotId" FROM ${BANG} WHERE "henGio" > (now() AT TIME ZONE 'UTC')`)
    return rows.map(r => String(r.dotId))
}

/** "Gửi ngay" một đợt đang hẹn giờ */
export async function boHenGio(sp: any, dotId: string): Promise<boolean> {
    if (!(await coBang(sp))) return false
    const n = await sp.$executeRawUnsafe(`UPDATE ${BANG} SET "henGio" = NULL WHERE "dotId" = $1 AND "henGio" IS NOT NULL`, dotId)
    return Number(n) > 0
}
