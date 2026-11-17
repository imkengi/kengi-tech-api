/**
 * DÒ "KÊNH SÀN NÀY THUỘC CỬA HÀNG NÀO" CHO WEBHOOK — GỘP LƯỢT DÒ + MỘT TRUY VẤN (17/11/2026)
 *
 * Bệnh (đo log prod 7 ngày 11–17/11/2026): webhook Shopee/TikTok/Facebook chỉ mang shop_id / page_id, phải dò ra cửa
 * hàng. Bản cũ đệm kết quả 1 giờ trong bộ đệm chung của từng bản máy (≤ 1000 mục, đầy thì đẩy mục cũ nhất ra) và KHÔNG
 * gộp lượt dò: bản Cloud Run vừa bật giữa đợt webhook dồn (~100 push trong vài giây) ⇒ push nào cũng tự dò, mỗi lượt dò
 * mở client TỪNG cửa hàng (tới 12 kết nối mỗi bản). 16/11 07:03 ba bản vừa bật ⇒ 689 "Too many database connections"
 * trong 25 giây; 7 ngày 235 push hỏng ở bước dò (69 hết chỗ nối + 166 P2024) — hộp thư thử lại nên chưa mất đơn.
 *
 * Nay:
 *  • MỘT truy vấn UNION ALL qua client REGISTRY (vốn đã có kết nối) thay cho mở client từng cửa hàng — cùng cách
 *    canhWebhookKiotViet; cột thiếu ở cửa hàng nào thì cửa hàng đó dò bằng điều kiện hẹp hơn, thiếu bảng thì bỏ qua;
 *  • GỘP LƯỢT: push cùng shop tới lúc đang dò thì CHỜ chung một lời hứa, không dò thêm;
 *  • đệm RIÊNG 6 giờ (bộ đệm chung không đẩy ra được); trỏ sai (kênh đã gỡ / chuyển cửa hàng) ⇒ bỏ đệm, dò lại MỘT lần;
 *  • thứ tự cửa hàng GIỮ như bản cũ (store.findMany cùng điều kiện) — shop nằm ở hai cửa hàng thì vẫn ra cửa hàng
 *    đứng trước, kèm MỘT dòng cảnh báo.
 * KHÔNG đệm "không có": cửa hàng vừa nối sàn phải nhận được push ngay (bỏ push là mất hẳn). Đọc hỏng (mất kết nối, pool
 * đầy) ⇒ NÉM, không đệm gì — hộp thư thử lại push: không đọc được ≠ không có.
 */
import registryPrisma from './prisma'

export type LoaiKenhWebhook = 'shopee' | 'tiktok' | 'facebook'

/** Phần client registry mà bộ dò dùng — bộ kiểm thay bằng bản giả. */
export interface DbDoKenh {
    $queryRawUnsafe<T = any>(sql: string, ...values: any[]): Promise<T>
    store: { findMany(a: any): Promise<Array<{ schema: string; code?: string | null }>> }
}

const DINH_NGHIA: Record<LoaiKenhWebhook, { bang: string; cotBatBuoc: string[]; cotTuyChon: string[] }> = {
    shopee: { bang: 'OnlineChannel', cotBatBuoc: ['platform', 'shopId'], cotTuyChon: [] },
    // Webhook TikTok mang shop_id DẠNG SỐ; channel.shopId lưu shop_cipher ⇒ khớp cả platformShopId (như bản cũ)
    tiktok: { bang: 'OnlineChannel', cotBatBuoc: ['platform', 'shopId'], cotTuyChon: ['platformShopId'] },
    facebook: { bang: 'FbPage', cotBatBuoc: ['pageId'], cotTuyChon: [] },
}

/** Điều kiện WHERE của một cửa hàng — giá trị dò LUÔN là tham số $1, không bao giờ ghép vào chuỗi SQL. */
function dieuKien(loai: LoaiKenhWebhook, cot: Set<string>): string {
    if (loai === 'shopee') return `"platform" = 'shopee' AND "shopId" = $1`
    if (loai === 'tiktok') {
        return cot.has('platformShopId')
            ? `"platform" = 'tiktok' AND ("shopId" = $1 OR "platformShopId" = $1)`
            : `"platform" = 'tiktok' AND "shopId" = $1`
    }
    return `"pageId" = $1`
}

const TEN_SCHEMA_HOP_LE = /^[a-z0-9_]+$/i

export const DEM_KENH_MS = 6 * 3600_000
const DEM_TOI_DA = 500

const dem = new Map<string, { schema: string; het: number }>()
const dangDo = new Map<string, { hua: Promise<string | null>; soChoChung: number }>()
const daCanhBaoTrung = new Set<string>()
const tk = { soLanDo: 0, soLanGop: 0, soLanTrungDem: 0 }

let bayGio: () => number = Date.now

/**
 * Dò thật: 3 truy vấn trên client registry — cột hiện có của bảng ở từng schema, danh sách cửa hàng đang chạy (cùng
 * điều kiện, cùng thứ tự như bản cũ), rồi MỘT câu UNION ALL. Trả schema của cửa hàng đứng trước nhất có kênh, hoặc null.
 */
export async function doSchemaKenh(loai: LoaiKenhWebhook, khoa: string, db: DbDoKenh): Promise<{ schema: string | null; cacCuaHang: string[] }> {
    const dn = DINH_NGHIA[loai]
    const canCot = [...dn.cotBatBuoc, ...dn.cotTuyChon]
    const dongCot: Array<{ s: string; c: string }> = await db.$queryRawUnsafe(
        `SELECT n.nspname AS s, a.attname AS c
           FROM pg_catalog.pg_class t
           JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
           JOIN pg_catalog.pg_attribute a ON a.attrelid = t.oid AND a.attnum > 0 AND NOT a.attisdropped
          WHERE t.relname = $1 AND t.relkind IN ('r', 'p') AND a.attname = ANY($2::text[])`,
        dn.bang, canCot)
    const cotTheoSchema = new Map<string, Set<string>>()
    for (const r of dongCot || []) {
        const s = String(r.s)
        if (!cotTheoSchema.has(s)) cotTheoSchema.set(s, new Set())
        cotTheoSchema.get(s)!.add(String(r.c))
    }
    if (!cotTheoSchema.size) return { schema: null, cacCuaHang: [] }

    const stores = await db.store.findMany({ where: { status: 'active' }, select: { code: true, schema: true } })
    const duocDo = stores.filter(st => {
        const cot = cotTheoSchema.get(String(st.schema))
        return !!cot && TEN_SCHEMA_HOP_LE.test(String(st.schema)) && dn.cotBatBuoc.every(c => cot.has(c))
    })
    if (!duocDo.length) return { schema: null, cacCuaHang: [] }

    const sql = duocDo.map((st, i) =>
        `(SELECT ${i} AS thu_tu FROM "${st.schema}"."${dn.bang}" WHERE ${dieuKien(loai, cotTheoSchema.get(st.schema)!)} LIMIT 1)`,
    ).join('\nUNION ALL\n')
    const ra: Array<{ thu_tu: number | bigint }> = await db.$queryRawUnsafe(sql, khoa)
    const thuTu = (ra || []).map(r => Number(r.thu_tu)).filter(n => Number.isInteger(n) && n >= 0 && n < duocDo.length).sort((a, b) => a - b)
    if (!thuTu.length) return { schema: null, cacCuaHang: [] }
    const cacCuaHang = thuTu.map(i => String(duocDo[i].code || duocDo[i].schema))
    return { schema: duocDo[thuTu[0]].schema, cacCuaHang }
}

/**
 * Schema cửa hàng đang giữ kênh `loai` mang mã `khoa` (shop_id / page_id), hoặc null khi không cửa hàng nào có.
 * Gộp lượt + đệm 6 giờ (xem đầu tệp). NÉM khi đọc hỏng.
 */
export async function timSchemaKenh(loai: LoaiKenhWebhook, khoa: string, db: DbDoKenh = registryPrisma as any): Promise<string | null> {
    const k = `${loai}:${khoa}`
    const d = dem.get(k)
    if (d && d.het > bayGio()) { tk.soLanTrungDem++; return d.schema }
    const dang = dangDo.get(k)
    if (dang) { dang.soChoChung++; tk.soLanGop++; return dang.hua }

    const muc = { hua: null as unknown as Promise<string | null>, soChoChung: 0 }
    muc.hua = (async () => {
        const batDau = bayGio()
        try {
            tk.soLanDo++
            const { schema, cacCuaHang } = await doSchemaKenh(loai, khoa, db)
            if (schema) {
                if (dem.size >= DEM_TOI_DA) {
                    const nay = bayGio()
                    for (const [kk, v] of dem) if (v.het <= nay) dem.delete(kk)
                    while (dem.size >= DEM_TOI_DA) { const dau = dem.keys().next().value; if (dau === undefined) break; dem.delete(dau) }
                }
                dem.set(k, { schema, het: bayGio() + DEM_KENH_MS })
            }
            if (cacCuaHang.length > 1 && !daCanhBaoTrung.has(k)) {
                daCanhBaoTrung.add(k)
                console.warn(`[Webhook] ${loai} ${khoa} có ở ${cacCuaHang.length} cửa hàng (${cacCuaHang.join(', ')}) — dùng ${cacCuaHang[0]} (thứ tự như trước)`)
            }
            console.log(`[Webhook] Dò kênh ${loai} ${khoa} → ${schema ? cacCuaHang[0] : 'KHÔNG cửa hàng nào'} `
                + `(một truy vấn registry, ${muc.soChoChung} push chờ chung, ${bayGio() - batDau} ms)`)
            return schema
        } finally {
            dangDo.delete(k)
        }
    })()
    dangDo.set(k, muc)
    return muc.hua
}

/** Bỏ đệm một kênh — gọi khi schema đệm không còn kênh đó (đã gỡ / chuyển cửa hàng). */
export function boDemKenh(loai: LoaiKenhWebhook, khoa: string): void {
    dem.delete(`${loai}:${khoa}`)
}

/**
 * Dò schema rồi đọc bản ghi kênh trong ĐÚNG cửa hàng đó. Đệm trỏ sai (đọc ra null) ⇒ bỏ đệm, dò lại MỘT lần.
 * null = không có kênh (bên gọi bỏ push). NÉM = đọc hỏng (hộp thư thử lại).
 */
export async function timKenhVaBanGhi<T>(
    loai: LoaiKenhWebhook,
    khoa: string,
    docBanGhi: (schema: string) => Promise<T | null>,
    db: DbDoKenh = registryPrisma as any,
): Promise<{ schema: string; banGhi: T } | null> {
    let schemaTruoc: string | null = null
    for (let lan = 0; lan < 2; lan++) {
        const schema = await timSchemaKenh(loai, khoa, db)
        if (!schema || schema === schemaTruoc) return null
        const banGhi = await docBanGhi(schema)
        if (banGhi) return { schema, banGhi }
        boDemKenh(loai, khoa)
        schemaTruoc = schema
    }
    return null
}

export function thongKeDoKenh() {
    return { ...tk, soMucDem: dem.size, dangDo: dangDo.size }
}

/** CHỈ cho bộ kiểm: xoá đệm + thống kê, thay đồng hồ. */
export function _datLaiDoKenh(dongHo?: () => number): void {
    dem.clear(); dangDo.clear(); daCanhBaoTrung.clear()
    tk.soLanDo = 0; tk.soLanGop = 0; tk.soLanTrungDem = 0
    bayGio = dongHo ?? Date.now
}
