/* ═══════════════════════════════════════════════════════════════════════════════
 *  LÃI DỰ KIẾN CỦA ĐƠN SÀN MỚI + BÁO ĐỘNG LỖ NGAY (18/11/2026)
 *
 *  Chủ shop: "Tiếp tục khi nhận đơn online mới thì hãy tự động tính toán lãi dự kiến, nếu lỗ báo động ngay nha".
 *
 *  Trước đây lãi đơn sàn chỉ có SAU khi sàn đối soát (canhBaoLoiNhuanThap — đơn lãi < 5%: cron phí 6 tiếng; TikTok / Lazada
 *  chỉ quyết toán sau khi khách nhận) ⇒ biết đơn lỗ khi hàng đã đi. Nay đơn vừa về (webhook / lượt đồng bộ) là tính ngay:
 *      lãi dự kiến = giá bán các dòng (sau giảm giá shop) − phí sàn DỰ KIẾN − giá vốn
 *  - Phí dự kiến = ĐÚNG mô hình phí Pilot đang dùng cho từng mặt hàng (docMauPhiTheoNganh().chon(ngành)): Shopee có biểu phí
 *    đọc từ escrow ⇒ công thức (% ngành + thanh toán + dịch vụ có trần + thuế + phí mỗi đơn + affiliate trung bình); sàn khác /
 *    Shopee chưa có biểu phí ⇒ phí đo từ đơn đã đối soát của CHÍNH gian; gian chưa đủ đơn ⇒ phí KHAI, hoặc CHƯA BIẾT PHÍ —
 *    không bịa phí (09/11/2026: không mượn gian khác), chỉ còn xét "lỗ ngay cả khi chưa trừ phí".
 *  - Giá vốn = computeOrderProfits (đúng chuỗi quy đổi đơn vị sàn → kho, mã gộp, combo của orderSync).
 *  - Thiếu giá vốn / chưa biết phí CHỈ làm lỗ thêm ⇒ phần ĐÃ BIẾT mà đã âm là LỖ CHẮC ⇒ vẫn báo. Phần đã biết còn dương thì
 *    không kết luận gì (06/09/2026 chủ shop bỏ lãi ước tính: "lấy được thì hiển thị, không lấy được thì không").
 *
 *  Mỗi đơn MỘT dòng ở bảng "LaiDuKienDon" (tạo lười trong schema cửa hàng — KHÔNG đổi schema-store, khỏi P2022 trước khi
 *  migrate). INSERT … ON CONFLICT DO NOTHING RETURNING là phép GIÀNH: webhook, lượt đồng bộ, nhiều bản Cloud Run cùng thấy
 *  một đơn thì chỉ một bên báo (prod không có Redis). Trang Đơn hàng online đọc lại dòng này (docLaiDuKien) để hiện "lãi dự
 *  kiến" cho đơn chưa quyết toán. Báo: Notification type 'loi_nhuan_thap' (nhóm don_hang — Android kênh ưu tiên CAO, chuông
 *  web) + MỘT push cho cả mẻ.
 *
 *  Gọi từ MỌI đường TẠO đơn sàn: webhook Shopee / TikTok (xetLaiDuKienAnToan — ngay khi đơn về, và khi push đổi trạng thái của
 *  đơn ≤ 24 giờ chưa xét được), lượt đồng bộ cron (autoSync) và đồng bộ tay (/online-orders/sync) qua LƯỚI VÉT
 *  vetLaiDuKienDonMoi (đơn ≤ 24 giờ của kênh chưa có dòng — gồm Lazada chưa có webhook, đơn webhook lỡ). KHÔNG gọi từ kéo bù
 *  đơn cũ (keoBuDonSan) — bộ kiểm F quét nguồn.
 * ═══════════════════════════════════════════════════════════════════════════════ */

import { computeOrderProfits, CANCELLED_STATUSES } from './onlineOrderProfit'
import { laDonKeoBu } from './dauKeoBu'
import { phiSanCuaDon } from './giaShopee'
import { docMauPhiTheoNganh, type BangPhiNganh } from './shopeeTuQuan'

/** Chỉ xét đơn đặt trên sàn trong ngần này — "đơn MỚI". Kênh mới nối kéo lịch sử / lượt đầu sau khi bật KHÔNG được dội báo
 *  động cho đơn cũ. 24 giờ đủ để lượt đồng bộ 30' vớt đơn lỡ webhook. */
export const CUA_SO_DON_MOI_MS = 24 * 3600_000
/** Mẻ nhiều đơn lỗ hơn ngần này ⇒ MỘT tin gộp (chuông chỉ giữ 30 tin gần nhất — cùng lý do với canhBaoLoiNhuanThap). */
const NGUONG_GOP = 8
const SAN_XET = ['shopee', 'tiktok', 'lazada']

export interface DongGia {
    /** giá dòng sau giảm giá shop (OnlineOrderItem.lineTotal) */
    gia: number
    /** mã ngành của listing trên sàn; null = chưa rõ ngành */
    nganh: string | null
}

export type NguonPhiDuKien = 'cong-thuc' | 'do-so' | 'khai' | 'chua-biet'

export interface PhiDuKien {
    /** VND; null = CHƯA BIẾT phí sàn của gian (không bịa) */
    phi: number | null
    nguon: NguonPhiDuKien
    /** có mặt hàng tạm dùng phí trung bình / cả gian (ngành chưa có đơn mẫu, chưa rõ ngành) */
    tam: boolean
    /** một cụm cho người đọc — nằm trong tin báo và tooltip */
    moTa: string
}

const pct = (x: number) => `${(Math.round(x * 1000) / 10).toLocaleString('vi-VN')}%`
const vnd = (n: number) => `${Math.round(n).toLocaleString('vi-VN')}đ`

/** Phí sàn dự kiến của MỘT đơn từ các dòng hàng và bảng phí của gian (hàm thuần). */
export function phiDuKienCuaDon(dong: DongGia[], bang: Pick<BangPhiNganh, 'chon'>): PhiDuKien {
    const mau = (dong || []).filter(d => Number(d.gia) > 0).map(d => ({ gia: Number(d.gia), phi: bang.chon(d.nganh) }))
    if (!mau.length) return { phi: null, nguon: 'chua-biet', tam: false, moTa: 'đơn không có dòng hàng nào có giá' }
    if (mau.some(m => m.phi.chuaBiet)) {
        return {
            phi: null, nguon: 'chua-biet', tam: false,
            moTa: 'gian CHƯA BIẾT phí sàn (chưa đủ đơn đã đối soát để đo, chưa khai «Phí sàn (%)») — chưa trừ phí, lỗ thật còn lớn hơn',
        }
    }
    const phi = Math.max(0, Math.round(phiSanCuaDon(mau)))
    const dau = mau[0]!.phi
    const tam = mau.some(m => !!(m.phi.thayNganh || m.phi.chuaRoNganh))
    if (dau.nguon === 'cong-thuc') {
        const muc = [...new Set(mau.filter(m => m.phi.congThuc && !m.phi.thayNganh && !m.phi.chuaRoNganh).map(m => pct(m.phi.congThuc!.phiNganh)))]
        return {
            phi, nguon: 'cong-thuc', tam,
            moTa: `phí theo biểu phí Shopee đọc từ escrow${muc.length ? ` — phí cố định ngành ${muc.join(', ')}` : ''}` +
                `${tam ? '; có mặt hàng chưa rõ % ngành, tạm lấy % trung bình các ngành' : ''}`,
        }
    }
    if (dau.khai || dau.nguon === 'cau-hinh-kenh') {
        return { phi, nguon: 'khai', tam, moTa: `phí KHAI của gian ${pct(dau.tyLe)} (chưa đủ đơn đã đối soát để đo)` }
    }
    return {
        phi, nguon: 'do-so', tam,
        moTa: `phí đo từ ${dau.soDon} đơn đã đối soát của gian${tam ? ' (ngành chưa đủ đơn — tạm dùng phí cả gian)' : ''}`,
    }
}

export interface LaiDuKien {
    doanhThu: number
    phi: number | null
    /** giá vốn phần ĐÃ BIẾT */
    giaVon: number
    thieuGiaVon: boolean
    /** doanhThu − (phí ?? 0) − giá vốn đã biết. Thiếu giá vốn / chưa biết phí ⇒ đây là mức TRẦN (lãi thật chỉ thấp hơn). */
    lai: number
    /** lãi < 0 với phần đã biết ⇒ LỖ CHẮC (phần thiếu chỉ làm lỗ thêm) */
    lo: boolean
    /** đủ dữ liệu cho một con số (biết phí, đủ giá vốn) */
    du: boolean
    nguonPhi: NguonPhiDuKien
    tamPhi: boolean
    moTaPhi: string
}

/** Kết luận lãi dự kiến (hàm thuần). Chưa có giá bán (dòng hàng chưa mang giá) ⇒ KHÔNG kết luận lỗ: "bán 0đ − giá vốn"
 *  là thiếu số, không phải lỗ (đọc không được ≠ bằng 0). */
export function ketLuanLaiDuKien(doanhThu: number, p: PhiDuKien, von: { cost: number; missingCost: boolean }): LaiDuKien {
    const dt = Math.round(Number(doanhThu) || 0)
    const gv = Math.round(Number(von?.cost) || 0)
    const lai = dt - (p.phi ?? 0) - gv
    return {
        doanhThu: dt, phi: p.phi, giaVon: gv, thieuGiaVon: !!von?.missingCost,
        lai, lo: dt > 0 && lai < 0, du: dt > 0 && p.phi != null && !von?.missingCost,
        nguonPhi: p.nguon, tamPhi: p.tam, moTaPhi: p.moTa,
    }
}

/** Tên mặt hàng chính của đơn cho tin báo (hàm thuần): dòng giá cao nhất, kèm số lượng và số mặt hàng khác. */
export function tenHangChinh(items: { productName?: string | null; quantity?: number | null; lineTotal?: number | null }[]): string {
    const ds = (items || []).filter(i => String(i?.productName || '').trim())
    if (!ds.length) return ''
    const chinh = ds.reduce((a, b) => ((Number(b.lineTotal) || 0) > (Number(a.lineTotal) || 0) ? b : a))
    // bỏ nhãn quảng cáo đầu tên ("[Hàng Chính Hãng]", "【Freeship】") — tin trên điện thoại chỉ hiện vài dòng đầu
    const goc = String(chinh.productName).trim().replace(/\s+/g, ' ')
    const ten = goc.replace(/^(?:\s*[[【][^\]】]{1,40}[\]】]\s*){1,3}/, '').trim() || goc
    const ngan = ten.length > 70 ? `${ten.slice(0, 69).trimEnd()}…` : ten
    const sl = Number(chinh.quantity) || 1
    const khac = (items || []).length - 1
    return `${ngan}${sl > 1 ? ` ×${sl}` : ''}${khac > 0 ? ` (+${khac} mặt hàng)` : ''}`
}

/** Tin báo động cho MỘT đơn lỗ (hàm thuần). */
export function tinBaoLo(don: { ma: string; san: string; kenh?: string | null; hang?: string | null }, k: LaiDuKien): { tieuDe: string; noiDung: string } {
    const tieuDe = `🚨 Đơn ${don.ma} dự kiến LỖ ${vnd(-k.lai)}`
    const phep = [`bán ${vnd(k.doanhThu)}`, k.phi != null ? `phí sàn dự kiến ${vnd(k.phi)}` : 'phí sàn chưa biết', `giá vốn ${vnd(k.giaVon)}`]
    const noiDung = `${don.hang ? `${don.hang} — ` : ''}${String(don.san || '').toUpperCase()}${don.kenh ? ` · ${don.kenh}` : ''}: ` +
        `${phep.join(' − ')} = ${vnd(k.lai)} (${k.moTaPhi}).` +
        `${k.thieuGiaVon ? ' Còn mặt hàng chưa có giá vốn — lỗ thật còn lớn hơn.' : ''} Xem lại giá bán trên sàn / giá vốn để đơn sau không lỗ tiếp.`
    return { tieuDe, noiDung }
}

// ─── Bảng "LaiDuKienDon" (tạo lười trong schema cửa hàng) ────────────────────────

const SQL_TAO_BANG = `CREATE TABLE IF NOT EXISTS "LaiDuKienDon" (
    "orderId"     TEXT PRIMARY KEY,
    "xetLuc"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "doanhThu"    DOUBLE PRECISION NOT NULL,
    "phiDuKien"   DOUBLE PRECISION,
    "giaVon"      DOUBLE PRECISION NOT NULL,
    "lai"         DOUBLE PRECISION NOT NULL,
    "thieuGiaVon" BOOLEAN NOT NULL DEFAULT false,
    "nguonPhi"    TEXT NOT NULL,
    "chiTiet"     JSONB,
    "baoLuc"      TIMESTAMP(3)
)`

/** prisma (client của MỘT schema) ⇒ đã có bảng: true / chưa: lúc dò (để dò lại sau 10 phút). */
const CO_BANG = new WeakMap<object, { co: boolean; luc: number }>()

async function damBaoBang(prisma: any): Promise<void> {
    if (CO_BANG.get(prisma)?.co) return
    try {
        await prisma.$executeRawUnsafe(SQL_TAO_BANG)
    } catch (e) {
        // hai bản cùng tạo một lúc ⇒ bản thua có thể vấp khoá trùng pg_type: bảng đã có thì thôi
        const r: any[] = await prisma.$queryRawUnsafe(`SELECT to_regclass('"LaiDuKienDon"') IS NOT NULL AS co`).catch(() => [])
        if (!r?.[0]?.co) throw e
    }
    CO_BANG.set(prisma, { co: true, luc: Date.now() })
}

/** Bảng có chưa — dò to_regclass (đọc thẳng bảng chưa có thì Prisma vẫn in "Raw query failed" dù đã bắt 42P01). */
async function coBang(prisma: any): Promise<boolean> {
    const c = CO_BANG.get(prisma)
    if (c && (c.co || Date.now() - c.luc < 600_000)) return c.co
    const r: any[] = await prisma.$queryRawUnsafe(`SELECT to_regclass('"LaiDuKienDon"') IS NOT NULL AS co`).catch(() => [])
    const co = !!r?.[0]?.co
    CO_BANG.set(prisma, { co, luc: Date.now() })
    return co
}

/** Bỏ trạng thái "đã có bảng" (bộ kiểm dùng prisma giả mới mỗi ca thì không cần; để dành cho ca dựng lại bảng). */
export function xoaDemBangLaiDuKien(prisma: any): void { CO_BANG.delete(prisma) }

/** Một dòng đã lưu — trả kèm GET /online-orders (`laiDuKien`), chỉ owner/admin. */
export interface LaiDuKienDaLuu {
    lai: number
    phi: number | null
    giaVon: number
    doanhThu: number
    thieuGiaVon: boolean
    nguonPhi: string
    moTaPhi: string
    /** lúc tính (ISO) */
    luc: string
    lo: boolean
    /** đã báo động (ISO) */
    baoLuc: string | null
}

/** Đọc lãi dự kiến đã lưu của các đơn — bảng chưa có / đọc hỏng ⇒ Map rỗng (không ném). */
export async function docLaiDuKien(prisma: any, orderIds: string[]): Promise<Map<string, LaiDuKienDaLuu>> {
    const out = new Map<string, LaiDuKienDaLuu>()
    const ids = [...new Set((orderIds || []).filter(Boolean).map(String))]
    if (!ids.length || !(await coBang(prisma))) return out
    const rows: any[] = await prisma.$queryRawUnsafe(
        `SELECT "orderId", "xetLuc", "doanhThu", "phiDuKien", "giaVon", "lai", "thieuGiaVon", "nguonPhi", "chiTiet", "baoLuc"
           FROM "LaiDuKienDon" WHERE "orderId" = ANY($1::text[])`, ids).catch(() => [])
    for (const r of rows || []) {
        const ct = typeof r.chiTiet === 'string' ? (() => { try { return JSON.parse(r.chiTiet) } catch { return {} } })() : (r.chiTiet || {})
        const lai = Math.round(Number(r.lai) || 0)
        out.set(String(r.orderId), {
            lai, phi: r.phiDuKien == null ? null : Math.round(Number(r.phiDuKien)),
            giaVon: Math.round(Number(r.giaVon) || 0), doanhThu: Math.round(Number(r.doanhThu) || 0),
            thieuGiaVon: !!r.thieuGiaVon, nguonPhi: String(r.nguonPhi || ''), moTaPhi: String(ct?.moTaPhi || ''),
            luc: r.xetLuc ? new Date(r.xetLuc).toISOString() : '', lo: lai < 0,
            baoLuc: r.baoLuc ? new Date(r.baoLuc).toISOString() : null,
        })
    }
    return out
}

/** Ngành của từng dòng hàng — CÙNG cách nối dòng → listing của shopeeTuQuan.dongPhiTheoNganh (Shopee externalItemId = item_id;
 *  TikTok externalItemId là mã dòng đơn ⇒ nối thêm qua SKU / mã kho). Đọc hỏng ⇒ Map rỗng (mọi dòng "chưa rõ ngành"). */
async function docNganhDong(prisma: any, donIds: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>()
    const rows: any[] = await prisma.$queryRawUnsafe(`
        SELECT i.id,
               (SELECT p."categoryId" FROM "OnlineProduct" p
                 WHERE p."channelId" = o."channelId" AND p."categoryId" IS NOT NULL
                   AND (p."platformProductId" = i."externalItemId"
                        OR (i.sku IS NOT NULL AND i.sku <> '' AND LOWER(p.sku) = LOWER(i.sku))
                        OR (i."productId" IS NOT NULL AND p."localProductId" = i."productId"))
                 ORDER BY (p."platformProductId" = i."externalItemId") DESC
                 LIMIT 1) AS nganh
          FROM "OnlineOrderItem" i JOIN "OnlineOrder" o ON o.id = i."onlineOrderId"
         WHERE i."onlineOrderId" = ANY($1::text[])`, donIds).catch((e: any) => {
        console.warn('[LaiDuKien] không đọc được ngành của dòng hàng — tạm dùng phí cả gian:', String(e?.message || e).slice(0, 200))
        return []
    })
    for (const r of rows || []) {
        if (r?.nganh != null && String(r.nganh).trim()) out.set(String(r.id), String(r.nganh).trim())
    }
    return out
}

export interface KetQuaXetLai {
    /** đơn đưa vào tính (mới, chưa xét, không huỷ / kéo bù) */
    xet: number
    /** đơn ghi được dòng lãi dự kiến (giành được) */
    daLuu: number
    /** đơn lỗ dự kiến trong số đã lưu */
    lo: number
    /** đơn lỗ đã có tin báo trong app */
    daBao: number
    /** số thiết bị nhận push */
    push: number
    /** đơn bỏ qua: cũ hơn cửa sổ, huỷ, kéo bù, không phải đơn sàn, không dòng hàng */
    boQua: number
    /** đơn dòng hàng chưa mang giá — chưa lưu, xét lại lần sau */
    chuaCoGia: number
    loi?: string
    loiPush?: string
}

export interface TuyChonXetLai {
    /** đường gọi — chỉ để ghi vào chiTiet / log */
    nguon?: 'webhook' | 'dong-bo' | 'dong-bo-tay'
    bayGio?: number
    /** bộ kiểm: bảng phí giả */
    docBang?: (prisma: any, ch: any) => Promise<Pick<BangPhiNganh, 'chon'>>
    /** bộ kiểm: push giả */
    guiPush?: (prisma: any, title: string, body: string, extra: { id?: string; type?: string; route?: string }) => Promise<number>
}

/** Chọn trường đơn cần để tính — dùng chung cho đường báo động và các lệnh đo. */
export const CHON_DON_LAI_DU_KIEN = {
    id: true, orderNumber: true, platform: true, status: true, note: true, subtotal: true, netRevenue: true,
    channelId: true, channelName: true, createdAt: true,
    items: { select: { id: true, productId: true, sku: true, quantity: true, lineTotal: true, externalItemId: true, productName: true } },
} as const

/** Đơn có được tính lãi dự kiến không: đơn sàn, có gian, không huỷ / hoàn, không kéo bù, có dòng hàng. */
export const donXetDuoc = (d: any): boolean =>
    SAN_XET.includes(String(d?.platform || '').toLowerCase()) && !!d?.channelId
    && !CANCELLED_STATUSES.includes(d.status) && !laDonKeoBu(d.note) && (d.items || []).length > 0

export interface LaiMotDon { k: LaiDuKien; p: PhiDuKien; dong: DongGia[] }

/** Đệm bảng phí theo gian (5 phút, như đệm phí ngành của shopeeTuQuan): giờ livestream đơn về dồn dập, mỗi đơn đọc lại phí cả
 *  gian (truy vấn sổ 90 ngày) trên pool MỘT kết nối là giành chỗ của việc nhận đơn. Chỉ đệm lần đọc ĐƯỢC. */
const TTL_BANG_PHI = 5 * 60_000
const DEM_BANG_PHI = new WeakMap<object, Map<string, { het: number; bang: Pick<BangPhiNganh, 'chon'> }>>()

/**
 * TÍNH lãi dự kiến cho các đơn (đã chọn theo CHON_DON_LAI_DU_KIEN, đã lọc donXetDuoc) — CHỈ ĐỌC: ngành từng dòng, bảng phí
 * từng gian, giá vốn. Gian đọc phí hỏng ⇒ đơn của gian đó không có trong kết quả (bên gọi xét lại sau), `loi` nói vì sao.
 */
export async function tinhLaiDuKien(prisma: any, dons: any[], o: Pick<TuyChonXetLai, 'docBang' | 'bayGio'> = {}): Promise<{ ketQua: Map<string, LaiMotDon>; loi?: string }> {
    const ketQua = new Map<string, LaiMotDon>()
    let loi: string | undefined
    if (!dons?.length) return { ketQua }
    const nganhDong = await docNganhDong(prisma, dons.map(d => String(d.id)))

    const docBang = o.docBang || docMauPhiTheoNganh
    const bay = o.bayGio ?? Date.now()
    let dem = DEM_BANG_PHI.get(prisma)
    if (!dem) { dem = new Map(); DEM_BANG_PHI.set(prisma, dem) }
    const kenhIds = [...new Set(dons.map(d => String(d.channelId)))]
    const bangTheoKenh = new Map<string, Pick<BangPhiNganh, 'chon'>>()
    for (const id of kenhIds) {
        const c = dem.get(id)
        if (c && c.het > bay) bangTheoKenh.set(id, c.bang)
    }
    const canDoc = kenhIds.filter(id => !bangTheoKenh.has(id))
    const kenhs: any[] = canDoc.length ? await prisma.onlineChannel.findMany({ where: { id: { in: canDoc } } }) : []
    for (const ch of kenhs || []) {
        try {
            const bang = await docBang(prisma, ch)
            bangTheoKenh.set(String(ch.id), bang)
            dem.set(String(ch.id), { het: bay + TTL_BANG_PHI, bang })
        } catch (e: any) {
            // không đọc được phí ⇒ không tính đơn của gian này: lần sau (webhook đổi trạng thái / lượt đồng bộ) xét lại
            const moTa = String(e?.message || e).slice(0, 200)
            console.warn(`[LaiDuKien] ${ch.name || ch.id}: không đọc được bảng phí — chưa tính lãi dự kiến:`, moTa)
            if (!loi) loi = `đọc phí ${ch.name || ch.id}: ${moTa}`
        }
    }

    const von = await computeOrderProfits(prisma, dons)
    for (const d of dons) {
        const bang = bangTheoKenh.get(String(d.channelId))
        if (!bang) continue
        const dong: DongGia[] = (d.items || []).map((i: any) => ({ gia: Number(i.lineTotal) || 0, nganh: nganhDong.get(String(i.id)) ?? null }))
        const p = phiDuKienCuaDon(dong, bang)
        const v = von.get(d.id) || { cost: 0, missingCost: true }
        ketQua.set(String(d.id), { k: ketLuanLaiDuKien(dong.reduce((s, x) => s + Math.max(0, x.gia), 0), p, v), p, dong })
    }
    return { ketQua, ...(loi ? { loi } : {}) }
}

/**
 * Tính lãi dự kiến cho các đơn sàn vừa về và BÁO ĐỘNG đơn lỗ. Gọi lặp lại vô hại: đơn đã xét (bởi bất kỳ bản nào) bị bỏ ngay
 * bằng MỘT truy vấn khoá chính. Không ném vì từng đơn — lỗi đọc phí của một gian chỉ làm đơn gian đó chưa được lưu (lần
 * sau xét lại). Bên gọi vẫn PHẢI bọc try/catch: hàm này không được làm hỏng việc nhận đơn.
 */
export async function xetLaiDuKienDonMoi(prisma: any, orderIds: string[], o: TuyChonXetLai = {}): Promise<KetQuaXetLai> {
    const ra: KetQuaXetLai = { xet: 0, daLuu: 0, lo: 0, daBao: 0, push: 0, boQua: 0, chuaCoGia: 0 }
    const ids = [...new Set((orderIds || []).filter(Boolean).map(String))]
    if (!ids.length) return ra
    const bay = o.bayGio ?? Date.now()
    await damBaoBang(prisma)

    const daCo: any[] = await prisma.$queryRawUnsafe(`SELECT "orderId" FROM "LaiDuKienDon" WHERE "orderId" = ANY($1::text[])`, ids)
    const daXet = new Set((daCo || []).map(r => String(r.orderId)))
    const can = ids.filter(id => !daXet.has(id))
    if (!can.length) return ra

    const tatCa: any[] = await prisma.onlineOrder.findMany({
        where: { id: { in: can }, createdAt: { gte: new Date(bay - CUA_SO_DON_MOI_MS) } },
        select: CHON_DON_LAI_DU_KIEN,
    })
    const dons = (tatCa || []).filter(donXetDuoc)
    ra.boQua = can.length - dons.length
    ra.xet = dons.length
    if (!dons.length) return ra

    const tinh = await tinhLaiDuKien(prisma, dons, o)
    if (tinh.loi) ra.loi = tinh.loi

    const lo: { id: string; ma: string; san: string; kenh: string | null; hang: string; k: LaiDuKien }[] = []
    for (const d of dons) {
        const kq = tinh.ketQua.get(String(d.id))
        if (!kq) continue
        const { k, p, dong } = kq
        // dòng hàng chưa mang giá (sàn trả giá sau) ⇒ chưa lưu: lần webhook / lượt vét sau tính lại khi đã có giá
        if (k.doanhThu <= 0) { ra.chuaCoGia++; continue }
        const chiTiet = {
            moTaPhi: p.moTa, tamPhi: p.tam, nguon: o.nguon || null,
            nganh: [...new Set(dong.map(x => x.nganh).filter(Boolean))].slice(0, 20),
        }
        let gianh: any[] = []
        try {
            gianh = await prisma.$queryRawUnsafe(
                `INSERT INTO "LaiDuKienDon" ("orderId", "doanhThu", "phiDuKien", "giaVon", "lai", "thieuGiaVon", "nguonPhi", "chiTiet")
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
                 ON CONFLICT ("orderId") DO NOTHING RETURNING "orderId"`,
                String(d.id), k.doanhThu, k.phi, k.giaVon, k.lai, k.thieuGiaVon, k.nguonPhi, JSON.stringify(chiTiet))
        } catch (e: any) {
            if (!ra.loi) ra.loi = `ghi lãi dự kiến: ${String(e?.message || e).slice(0, 200)}`
            continue
        }
        if (!gianh?.length) continue      // bản khác vừa xét đơn này
        ra.daLuu++
        if (k.lo) lo.push({ id: String(d.id), ma: String(d.orderNumber || d.id), san: String(d.platform || ''), kenh: d.channelName || null, hang: tenHangChinh(d.items), k })
    }
    ra.lo = lo.length
    if (lo.length) console.log(`[LaiDuKien] ${lo.length} đơn mới dự kiến LỖ (${o.nguon || '?'}): ` +
        lo.slice(0, 5).map(x => `${x.ma} ${x.k.lai}`).join(' · '))
    if (!lo.length || process.env.BAO_DONG_LO_DU_KIEN === '0') return ra

    lo.sort((a, b) => a.k.lai - b.k.lai)   // lỗ nặng nhất lên đầu
    const bayGio = new Date(bay)
    const idTin: string[] = []
    const daBao: typeof lo = []
    /* Mỗi đơn một tin (bấm vào thấy đúng đơn); mẻ lớn (lượt đồng bộ vớt nhiều đơn) gộp một tin. Ghi tin hỏng ⇒ GỠ dòng giành
     * của đơn đó: dấu "đã xét" mà không có tin nào thì đơn lỗ biến mất im lặng — để lần sau xét lại còn hơn. */
    const ganTen = (x: (typeof lo)[number]) => `${x.ma} ${vnd(x.k.lai)}${x.hang ? ` (${x.hang.length > 40 ? `${x.hang.slice(0, 39).trimEnd()}…` : x.hang})` : ''}`
    if (lo.length > NGUONG_GOP) {
        const ds = lo.slice(0, NGUONG_GOP).map(ganTen).join(' · ')
        try {
            const tin = await prisma.notification.create({
                data: {
                    title: `🚨 ${lo.length} đơn mới dự kiến LỖ`,
                    message: `Lỗ nặng nhất: ${ds} (+${lo.length - NGUONG_GOP} đơn nữa). Vào Đơn hàng online xem cột Lợi nhuận (dự kiến) — xem lại giá bán trên sàn / giá vốn để đơn sau không lỗ tiếp.`,
                    type: 'loi_nhuan_thap',
                },
            })
            if (tin?.id) idTin.push(String(tin.id))
            daBao.push(...lo)
        } catch (e: any) {
            if (!ra.loi) ra.loi = `ghi tin: ${String(e?.message || e).slice(0, 200)}`
        }
    } else {
        for (const x of lo) {
            const t = tinBaoLo({ ma: x.ma, san: x.san, kenh: x.kenh, hang: x.hang }, x.k)
            try {
                const tin = await prisma.notification.create({ data: { title: t.tieuDe, message: t.noiDung, type: 'loi_nhuan_thap' } })
                if (tin?.id) idTin.push(String(tin.id))
                daBao.push(x)
            } catch (e: any) {
                if (!ra.loi) ra.loi = `ghi tin: ${String(e?.message || e).slice(0, 200)}`
            }
        }
    }
    const hong = lo.filter(x => !daBao.includes(x)).map(x => x.id)
    if (hong.length) {
        await prisma.$executeRawUnsafe(`DELETE FROM "LaiDuKienDon" WHERE "orderId" = ANY($1::text[]) AND "baoLuc" IS NULL`, hong).catch(() => { })
        ra.daLuu -= hong.length
    }
    ra.daBao = daBao.length
    if (!daBao.length) return ra
    await prisma.$executeRawUnsafe(`UPDATE "LaiDuKienDon" SET "baoLuc" = $2 WHERE "orderId" = ANY($1::text[])`,
        daBao.map(x => x.id), bayGio).catch(() => { })

    /* MỘT push cho cả mẻ, nói về ĐÚNG những đơn đã có tin. */
    const dau = daBao[0]!
    const { tieuDe, noiDung } = daBao.length === 1
        ? tinBaoLo({ ma: dau.ma, san: dau.san, kenh: dau.kenh, hang: dau.hang }, dau.k)
        : {
            tieuDe: `🚨 ${daBao.length} đơn mới dự kiến LỖ`,
            noiDung: `${daBao.slice(0, 3).map(ganTen).join(' · ')}${daBao.length > 3 ? ` (+${daBao.length - 3} đơn nữa)` : ''}. ` +
                'Xem lại giá bán trên sàn / giá vốn để đơn sau không lỗ tiếp.',
        }
    try {
        const gui = o.guiPush || (await import('../routes/notifications')).sendPushToStore
        ra.push = await gui(prisma, tieuDe, noiDung, { id: idTin.join(','), type: 'loi_nhuan_thap', route: 'online-orders' })
    } catch (e: any) { ra.push = 0; ra.loiPush = String(e?.message || e).slice(0, 160) }
    return ra
}

/** Gọi từ đường NHẬN đơn (webhook): KHÔNG BAO GIỜ ném — tính lãi hỏng không được làm hỏng việc nhận đơn; lỗi ghi log. */
export async function xetLaiDuKienAnToan(prisma: any, orderIds: string[], nguon: NonNullable<TuyChonXetLai['nguon']>, o: TuyChonXetLai = {}): Promise<KetQuaXetLai | null> {
    try {
        const r = await xetLaiDuKienDonMoi(prisma, orderIds, { ...o, nguon })
        if (r.loi || r.loiPush) console.warn(`[LaiDuKien] ${nguon}: ${r.loi || ''}${r.loiPush ? ` · push: ${r.loiPush}` : ''}`)
        return r
    } catch (e: any) {
        console.warn(`[LaiDuKien] ${nguon}: chưa tính được lãi dự kiến —`, String(e?.message || e).slice(0, 200))
        return null
    }
}

/**
 * LƯỚI VÉT — lượt đồng bộ (cron 30' / bấm tay) gọi cho TỪNG kênh: đơn ≤ 24 giờ chưa có dòng lãi dự kiến (vừa kéo về ở lượt
 * này; webhook lỡ vì máy tắt giữa chừng / đọc phí hỏng; Lazada chưa có webhook) ⇒ xét. Đơn đã xét bị loại ngay trong SQL nên
 * lượt không có đơn mới chỉ tốn MỘT truy vấn. Không ném.
 */
export async function vetLaiDuKienDonMoi(prisma: any, kenh: { id: string; platform?: string | null } | null, nguon: NonNullable<TuyChonXetLai['nguon']>, o: TuyChonXetLai = {}): Promise<KetQuaXetLai | null> {
    try {
        if (kenh && !SAN_XET.includes(String(kenh.platform || '').toLowerCase())) return null
        await damBaoBang(prisma)
        const bay = o.bayGio ?? Date.now()
        const thamSo: any[] = [new Date(bay - CUA_SO_DON_MOI_MS), SAN_XET, CANCELLED_STATUSES]
        if (kenh) thamSo.push(String(kenh.id))
        const rows: any[] = await prisma.$queryRawUnsafe(
            `SELECT o.id FROM "OnlineOrder" o
              WHERE o."createdAt" >= $1 AND LOWER(o.platform) = ANY($2::text[]) AND NOT (o.status = ANY($3::text[]))
                ${kenh ? 'AND o."channelId" = $4' : ''}
                AND NOT EXISTS (SELECT 1 FROM "LaiDuKienDon" l WHERE l."orderId" = o.id)
              ORDER BY o."createdAt" DESC LIMIT 500`, ...thamSo)
        const ids = (rows || []).map(r => String(r.id))
        if (!ids.length) return null
        return await xetLaiDuKienAnToan(prisma, ids, nguon, o)
    } catch (e: any) {
        console.warn(`[LaiDuKien] vét (${nguon}): chưa tính được lãi dự kiến —`, String(e?.message || e).slice(0, 200))
        return null
    }
}
