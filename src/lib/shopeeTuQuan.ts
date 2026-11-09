/* ═══════════════════════════════════════════════════════════════════════════════
 *  AI TỰ QUẢN MỘT GIAN SHOPEE — phần dùng chung cho bộ tool MCP `shopee_*`
 *  (31/10/2026)
 *
 *  Chủ shop: "AI tự quản lý 1 trang Shopee riêng, tự đăng sản phẩm, tính toán mức
 *  giá để đăng và bán hàng". File này gom những bước KHÔNG phải quyết định của AI:
 *  chọn gian, làm mới token, đo phí thật, tính tồn bán được, tải ảnh, dựng thân
 *  add_item. AI chỉ quyết: đăng mặt hàng nào, ngành nào, thuộc tính gì, giá bao nhiêu
 *  (trong khung giá sàn mà lib/giaShopee.ts đặt ra).
 *
 *  Đơn về từ gian này đi ĐÚNG đường đồng bộ đơn sẵn có (orderSync khớp theo SKU) vì
 *  item_sku = SKU kho — không cần nối listing tay.
 * ═══════════════════════════════════════════════════════════════════════════════ */

import { ShopeeService } from '../services/platforms/shopee'
import { ToolError } from './mcpTypes'
import { uocLuongPhi, SO_DON_TU_GHI, SO_DON_TOI_THIEU, type MauPhi, type DongPhiDon, type AffiliateDo } from './giaShopee'
import { daQuyetToanSql } from './phiSanGiuLai'
import { nhanDangAnh } from './anhSanPham'
import type { PlatformProduct } from '../services/platforms/base'

// ─── Chọn gian + mở dịch vụ ─────────────────────────────────────────────────────

/** Chọn gian Shopee: theo id / tên / shop_id. Bỏ trống được khi store chỉ có MỘT gian. */
export async function chonKenhShopee(prisma: any, kenh?: string): Promise<any> {
    const ds: any[] = await prisma.onlineChannel.findMany({
        where: { platform: 'shopee' },
        orderBy: { createdAt: 'asc' },
    })
    if (!ds.length) throw new ToolError('Store chưa kết nối gian Shopee nào — kết nối ở mục Kênh bán online trước.')
    const tomTat = ds.map(c => `"${c.name}" (id ${c.id}, shop_id ${c.shopId || '?'})`).join('; ')
    const k = String(kenh || '').trim()
    let ch: any
    if (k) {
        const thuong = k.toLowerCase()
        ch = ds.find(c => c.id === k || String(c.shopId || '') === k)
            || ds.find(c => String(c.name || '').toLowerCase() === thuong)
        if (!ch) {
            const gan = ds.filter(c => String(c.name || '').toLowerCase().includes(thuong))
            if (gan.length === 1) ch = gan[0]
            else throw new ToolError(`Không xác định được gian Shopee "${k}". Các gian đang có: ${tomTat}`)
        }
    } else if (ds.length === 1) {
        ch = ds[0]
    } else {
        throw new ToolError(`Store có ${ds.length} gian Shopee — truyền tham số kenh để chọn: ${tomTat}`)
    }
    if (!ch.accessToken || !ch.shopId) throw new ToolError(`Gian "${ch.name}" chưa uỷ quyền API (thiếu access token / shop_id).`)
    return ch
}

/** Mở ShopeeService cho gian, làm mới token nếu sắp hết (đệm 5 phút) — cùng cách autoSync/dayTonLenSan. */
export async function moDichVuShopee(prisma: any, ch: any): Promise<ShopeeService> {
    const svc = new ShopeeService({
        apiKey: ch.apiKey || '', apiSecret: ch.apiSecret || '',
        accessToken: ch.accessToken || undefined, refreshToken: ch.refreshToken || undefined,
        shopId: ch.shopId || undefined,
    })
    if (ch.tokenExpiresAt && new Date(ch.tokenExpiresAt).getTime() < Date.now() + 5 * 60_000) {
        try {
            const t = await svc.refreshAccessToken()
            ;(svc as any).credentials.accessToken = t.accessToken
            ;(svc as any).credentials.refreshToken = t.refreshToken
            const het = new Date(Date.now() + t.expiresIn * 1000)
            await prisma.onlineChannel.update({
                where: { id: ch.id },
                data: { accessToken: t.accessToken, refreshToken: t.refreshToken, tokenExpiresAt: het },
            })
            // cùng lượt mở lại dịch vụ (chu kỳ Pilot) thì khỏi làm mới lần hai bằng refresh token vừa bị thay
            Object.assign(ch, { accessToken: t.accessToken, refreshToken: t.refreshToken, tokenExpiresAt: het })
        } catch (e: any) {
            console.warn(`[ShopeeTuQuan] làm mới token ${ch.name} hỏng:`, e?.message || e)
        }
    }
    return svc
}

// ─── Phí sàn thật ───────────────────────────────────────────────────────────────

async function dongPhi(prisma: any, channelIds: string[]): Promise<DongPhiDon[]> {
    if (!channelIds.length) return []
    // affiliateFee NULL (đơn đối soát trước khi có cột, chưa bù) ⇒ aff null = chưa biết, KHÔNG phải 0
    const cau = (coAff: boolean) =>
        `SELECT (o."netRevenue" + o."platformFee")::float8 AS "giaBan", o."platformFee"::float8 AS phi
                ${coAff ? `, o."affiliateFee"::float8 AS aff` : ''}
           FROM "OnlineOrder" o
          WHERE o."channelId" = ANY($1::text[]) AND o."netRevenue" > 0 AND o."platformFee" > 0
            AND ${daQuyetToanSql('o')}
            AND o."createdAt" >= NOW() - INTERVAL '90 days'
          ORDER BY o."createdAt" DESC
          LIMIT 600`
    const rows: any[] = await prisma.$queryRawUnsafe(cau(true), channelIds).catch((e: any) =>
        // cửa hàng chưa migrate cột affiliateFee ⇒ đọc phí như cũ (hoa hồng chưa biết), đừng mất cả mô hình phí
        /affiliateFee/.test(String(e?.message || '')) ? prisma.$queryRawUnsafe(cau(false), channelIds).catch(() => []) : [])
    return rows.map(r => ({ giaBan: Number(r.giaBan) || 0, phi: Number(r.phi) || 0, aff: r.aff == null ? null : Number(r.aff) }))
}

/**
 * Mô hình phí của gian: đo từ đơn ĐÃ ĐỐI SOÁT 90 ngày của CHÍNH gian — và chỉ của chính gian.
 * Gian chưa đủ đơn ⇒ phí KHAI của gian (OnlineChannel.commissionRate, cờ `khai`) hoặc CHƯA BIẾT PHÍ (`chuaBiet`,
 * không tính giá) — luật ở giaShopee.doMauPhi, ghiChu nói rõ tên gian + số đơn.
 * 09/11/2026 (chủ shop: "xem phí phải ghi rõ ra không thể mượn được"): BỎ hẳn việc mượn số đo của các gian cùng sàn —
 * gian Mall và gian thường, ngành hàng khác nhau thì phí khác nhau, mà số mượn từng hiện trên kế hoạch đổi giá như phí
 * của chính gian. Hoa hồng affiliate đọc được ở đơn của chính gian vẫn giữ (uocLuongPhi gắn `affiliate` cả khi chưa đo).
 * 02/11/2026: dùng chung cho TikTok Pilot — đơn TikTok cũng ghi netRevenue/platformFee từ đối soát tài chính.
 */
export async function docMauPhi(prisma: any, ch: any): Promise<MauPhi> {
    return uocLuongPhi(await dongPhi(prisma, [ch.id]), ch.commissionRate, ch.name)
}

/* ─── Phí theo NGÀNH (02/11/2026) ─────────────────────────────────────────────────
 * Chủ shop: "shopee với tiktok thì mỗi ngành hàng lại 1 % phí khác nhau nha, mall lại phí khác á". Đo prod cùng ngày
 * (chỉ đọc): Shopee Kengi Store cả gian 23,6% nhưng ngành 22,5%…30,2%; Kengi Tools 28,8% nhưng ngành tới 36,2%;
 * TikTok bàn là 18,7% / máy sấy tóc 29,4%. Một tỷ lệ cả gian ⇒ ngành phí cao bị giá sàn THẤP (lỗ), ngành phí thấp
 * bị đề xuất giá cao.
 * Cách đo: đơn đã đối soát 90 ngày mà MỌI dòng hàng nối được về CÙNG MỘT ngành (dòng → listing của gian: Shopee
 * externalItemId = item_id; TikTok externalItemId là mã DÒNG ĐƠN nên nối thêm qua SKU / mã kho) — đơn trộn nhiều ngành
 * không chia được phí cho từng ngành nên bỏ ra. Ngành đủ SO_DON_TOI_THIEU đơn ⇒ mô hình riêng (cùng uocLuongPhi, cùng
 * rào đủ tin); ngành chưa đủ ⇒ phí cả gian gắn `thayNganh` (người xem được, máy không tự đăng / hạ giá). */

/** Một dòng phí của đơn chỉ có hàng MỘT ngành, kèm mã ngành. */
export async function dongPhiTheoNganh(prisma: any, channelId: string): Promise<(DongPhiDon & { nganh: string })[]> {
    const cau = (coAff: boolean) => `
        WITH don AS (
            SELECT o.id, (o."netRevenue" + o."platformFee")::float8 AS "giaBan", o."platformFee"::float8 AS phi
                   ${coAff ? `, o."affiliateFee"::float8 AS aff` : ''}
              FROM "OnlineOrder" o
             WHERE o."channelId" = $1 AND o."netRevenue" > 0 AND o."platformFee" > 0
               AND ${daQuyetToanSql('o')}
               AND o."createdAt" >= NOW() - INTERVAL '90 days'
             ORDER BY o."createdAt" DESC
             LIMIT 2000
        ), dong AS (
            SELECT d.id, (SELECT p."categoryId" FROM "OnlineProduct" p
                           WHERE p."channelId" = $1 AND p."categoryId" IS NOT NULL
                             AND (p."platformProductId" = i."externalItemId"
                                  OR (i.sku IS NOT NULL AND i.sku <> '' AND LOWER(p.sku) = LOWER(i.sku))
                                  OR (i."productId" IS NOT NULL AND p."localProductId" = i."productId"))
                           ORDER BY (p."platformProductId" = i."externalItemId") DESC
                           LIMIT 1) AS nganh
              FROM don d JOIN "OnlineOrderItem" i ON i."onlineOrderId" = d.id
        )
        SELECT d."giaBan", d.phi${coAff ? ', d.aff' : ''}, MIN(x.nganh) AS nganh
          FROM don d JOIN dong x ON x.id = d.id
         GROUP BY d.id, d."giaBan", d.phi${coAff ? ', d.aff' : ''}
        HAVING COUNT(DISTINCT x.nganh) = 1 AND COUNT(x.nganh) = COUNT(*)`
    const rows: any[] = await prisma.$queryRawUnsafe(cau(true), channelId).catch((e: any) =>
        /affiliateFee/.test(String(e?.message || '')) ? prisma.$queryRawUnsafe(cau(false), channelId) : Promise.reject(e))
    return (rows || []).filter(r => r?.nganh != null && String(r.nganh).trim() !== '')
        .map(r => ({ giaBan: Number(r.giaBan) || 0, phi: Number(r.phi) || 0, aff: r.aff == null ? null : Number(r.aff), nganh: String(r.nganh).trim() }))
}

export interface BangPhiNganh {
    /** phí cả gian — đo từ đơn của chính gian; chưa đủ đơn thì phí KHAI (`khai`) hoặc chưa biết phí (`chuaBiet`), không
     *  bao giờ là số của gian khác (09/11/2026) */
    toanGian: MauPhi
    /** ngành đủ đơn để đo riêng ⇒ mô hình riêng */
    theoNganh: Map<string, MauPhi>
    /** tên ngành (TikTok có chuỗi ngành; Shopee chưa lưu tên) */
    tenNganh: Map<string, string>
    /** mỗi ngành có listing trên gian: một tên sản phẩm làm ví dụ + số listing — Shopee không lưu tên ngành, chủ shop
     *  nhận ngành qua sản phẩm của mình */
    viDuNganh: Map<string, { viDu: string; so: number }>
    /** mô hình cho một sản phẩm thuộc ngành `nganh` — ngành chưa đủ đơn / chưa rõ ngành ⇒ cả gian, gắn cờ chưa đủ tin */
    chon(nganh?: string | number | null): MauPhi
}

/** Phí cho MỘT sản phẩm thuộc ngành `nganh` của gian (null = chưa rõ ngành) — xem docMauPhiTheoNganh. */
export async function docMauPhiSanPham(prisma: any, ch: any, nganh: string | number | null | undefined): Promise<MauPhi> {
    return (await docMauPhiTheoNganh(prisma, ch)).chon(nganh)
}

/** Phạm vi của phí đang dùng — khớp FE pilot-shopee/kieu.ts PhiNganh.scope (09/11/2026 bỏ 'muon': không còn mượn gian khác). */
export type PhamViPhi = 'nganh' | 'thay-nganh' | 'khai' | 'chua-biet' | 'gian'

/** Phạm vi của một mô hình phí. Thứ tự: ngành → chưa biết → khai → thay ngành → cả gian. Số cấu hình kênh mà thiếu cờ
 *  (mô hình dựng tay, không qua doMauPhi) coi như số khai: không phải số đo, không đủ tin cho máy. */
export function phamViPhi(m: MauPhi): PhamViPhi {
    if (m.nganh) return 'nganh'
    if (m.chuaBiet) return 'chua-biet'
    if (m.khai || m.nguon === 'cau-hinh-kenh') return 'khai'
    if (m.thayNganh || m.chuaRoNganh) return 'thay-nganh'
    return 'gian'
}

/** MỘT câu nguồn phí, hiện THẲNG trên giao diện (09/11/2026, chủ shop: "xem phí phải ghi rõ ra" — trước chỉ nằm trong
 *  tooltip `title`, điện thoại không rê chuột được). FE (PhiNganh.detail / MoHinhPhi.detail) hiện nguyên văn câu này. */
export function cauNguonPhi(m: MauPhi, bang?: Pick<BangPhiNganh, 'tenNganh' | 'viDuNganh'>): string {
    const n = Math.max(0, Math.round(Number(m.soDon) || 0))
    switch (phamViPhi(m)) {
        case 'nganh': {
            const ten = bang?.tenNganh.get(m.nganh!) || m.nganh!
            const viDu = String(bang?.viDuNganh.get(m.nganh!)?.viDu || '').trim()
            const vd = viDu.length > 50 ? `${viDu.slice(0, 49).trimEnd()}…` : viDu
            return `Đo từ ${n} đơn đã đối soát của ngành ${ten}${vd ? ` — vd: ${vd}` : ''}`
        }
        case 'chua-biet': return `Chưa biết phí — gian mới có ${n}/${SO_DON_TOI_THIEU} đơn đã đối soát và chưa khai phí ở Kênh bán online`
        case 'khai': return `Phí khai ở Kênh bán online — gian mới có ${n}/${SO_DON_TOI_THIEU} đơn đã đối soát, chưa đo được phí thật`
        case 'thay-nganh': return m.thayNganh
            ? `Ngành ${m.thayNganh} chưa đủ đơn để đo riêng — dùng phí đo từ ${n} đơn của cả gian`
            : `Chưa rõ ngành của sản phẩm — dùng phí đo từ ${n} đơn của cả gian`
        default: return `Đo từ ${n} đơn đã đối soát của cả gian`
    }
}

/** Tóm tắt một mô hình phí cho giao diện Pilot — tỷ lệ, phí cố định, số đơn, phạm vi (ngành / cả gian / khai / chưa biết)
 *  và `detail` (câu nguồn phí hiện thẳng trên giao diện). */
export function tomTatMauPhi(m: MauPhi, bang?: Pick<BangPhiNganh, 'tenNganh' | 'viDuNganh'>) {
    const vd = m.nganh ? bang?.viDuNganh.get(m.nganh) : undefined
    const scope = phamViPhi(m)
    return {
        rate: m.tyLe, fixedPerOrder: m.coDinh, orders: m.soDon, source: m.nguon, note: m.ghiChu,
        scope,
        detail: cauNguonPhi(m, bang),
        category: m.nganh ? (bang?.tenNganh.get(m.nganh) || m.nganh) : m.thayNganh || null,
        categoryId: m.nganh || null,
        ...(vd ? { example: vd.viDu, products: vd.so } : {}),
        // phí khai / chưa biết là số cấu hình, không phải số đo ⇒ không bao giờ đủ tin cho máy tự đăng / hạ giá
        trusted: m.nguon !== 'cau-hinh-kenh' && !m.khai && !m.chuaBiet && m.soDon >= SO_DON_TU_GHI && !m.thayNganh && !m.chuaRoNganh,
    }
}

const TTL_PHI_NGANH = 5 * 60_000
/** Đệm phần THEO NGÀNH (truy vấn nặng hơn) theo gian. `dau` = dấu số đo cả gian lúc đo: cả gian đổi (có đơn mới đối
 *  soát) thì đo ngành lại ngay — không ghép phí ngành cũ với phí cả gian mới. */
const demPhiNganh = new Map<string, { het: number; dau: string } & Pick<BangPhiNganh, 'theoNganh' | 'tenNganh' | 'viDuNganh'>>()
/** Bỏ đệm phí theo ngành (bộ kiểm đổi ngành của dữ liệu giữa các ca; prod tự hết hạn sau 5 phút). */
export function xoaDemPhiTheoNganh(): void { demPhiNganh.clear() }

/** Đo phí từng ngành của gian: ngành đủ SO_DON_TOI_THIEU đơn MỘT ngành ⇒ mô hình riêng. Lỗi đọc ⇒ không ngành nào. */
async function doPhiTungNganh(prisma: any, ch: any): Promise<Pick<BangPhiNganh, 'theoNganh' | 'tenNganh' | 'viDuNganh'> & { loi: boolean }> {
    const theoNganh = new Map<string, MauPhi>()
    const tenNganh = new Map<string, string>()
    const viDuNganh = new Map<string, { viDu: string; so: number }>()
    let dong: (DongPhiDon & { nganh: string })[] = []
    try {
        dong = await dongPhiTheoNganh(prisma, String(ch.id))
        const ten: any[] = await prisma.$queryRawUnsafe(
            `SELECT "categoryId", MAX("categoryName") AS "categoryName", MIN(name) AS "viDu", COUNT(*)::int AS so
               FROM "OnlineProduct" WHERE "channelId" = $1 AND "categoryId" IS NOT NULL
              GROUP BY "categoryId" LIMIT 2000`, String(ch.id)).catch(() => [])
        for (const t of ten || []) {
            const k = String(t.categoryId)
            if (t.categoryName) tenNganh.set(k, String(t.categoryName))
            if (t.viDu) viDuNganh.set(k, { viDu: String(t.viDu).slice(0, 120), so: Number(t.so) || 0 })
        }
    } catch (e: any) {
        // không đo được theo ngành ⇒ mọi sản phẩm dùng cả gian và bị gắn "ngành chưa đo" (máy không tự hạ giá) — NÓI RA
        console.error(`[PhiNganh] ${ch.name || ch.id}: không đọc được phí theo ngành —`, e?.message || e)
        return { theoNganh, tenNganh, viDuNganh, loi: true }
    }
    const nhom = new Map<string, DongPhiDon[]>()
    for (const d of dong) { const a = nhom.get(d.nganh) || []; a.push({ giaBan: d.giaBan, phi: d.phi, aff: d.aff }); nhom.set(d.nganh, a) }
    for (const [ng, ds] of nhom) {
        const m = uocLuongPhi(ds, ch.commissionRate)
        if (m.nguon === 'cau-hinh-kenh') continue
        const ten = tenNganh.get(ng)
        theoNganh.set(ng, { ...m, nganh: ng, ghiChu: `Ngành ${ten ? `${ten} (${ng})` : ng}: ${m.ghiChu}` })
    }
    return { theoNganh, tenNganh, viDuNganh, loi: false }
}

export async function docMauPhiTheoNganh(prisma: any, ch: any): Promise<BangPhiNganh> {
    // cả gian đọc MỖI lần như docMauPhi trước giờ; phần theo ngành lấy từ đệm nếu số đo cả gian chưa đổi
    const goc = await docMauPhi(prisma, ch)
    const dau = [goc.nguon, goc.soDon, goc.tyLe, goc.coDinh, !!goc.khai, !!goc.chuaBiet, goc.affiliate?.soDonBiet ?? -1].join('|')
    const khoa = String(ch.id)
    let co = demPhiNganh.get(khoa)
    if (!co || co.het <= Date.now() || co.dau !== dau) {
        const r = await doPhiTungNganh(prisma, ch)
        // đọc lỗi thì chỉ đệm 1 phút — lỗi thoáng qua đừng khoá cả gian ở "ngành chưa đo" suốt 5 phút
        co = { het: Date.now() + (r.loi ? 60_000 : TTL_PHI_NGANH), dau, theoNganh: r.theoNganh, tenNganh: r.tenNganh, viDuNganh: r.viDuNganh }
        demPhiNganh.delete(khoa)
        demPhiNganh.set(khoa, co)
        if (demPhiNganh.size > 200) { const cu = demPhiNganh.keys().next().value; if (cu !== undefined) demPhiNganh.delete(cu) }
    }
    const { tenNganh, viDuNganh } = co
    /* Hoa hồng affiliate Shopee đặt ở cấp SHOP (chiến dịch mở áp mọi sản phẩm) — ngành chưa thấy đơn affiliate nào vẫn có thể
     * ra đơn affiliate bất cứ lúc nào. Giá sàn (tyLeAffiliate = max(mức khai, affiliate.tyLeMax)) của MỌI sản phẩm phải tính
     * theo mức cao nhất đo được ở CẢ gian, mọi ngành — trước phí theo ngành sàn đã dùng tyLeMax cả gian (02/11/2026, phiên soát
     * chéo chỉ ra). GIỮ tyLeTB / tachRieng của ngành: phí ngành có tách affiliate hay không là theo đơn của chính ngành. */
    const affMax = Math.max(goc.affiliate?.tyLeMax ?? 0, ...[...co.theoNganh.values()].map(m => m.affiliate?.tyLeMax ?? 0))
    const nangAff = (m: MauPhi): MauPhi => {
        if (!(affMax > (m.affiliate?.tyLeMax ?? 0))) return m
        const a: AffiliateDo = m.affiliate ? { ...m.affiliate, tyLeMax: affMax } : { tachRieng: false, tyLeTB: 0, tyLeMax: affMax, soDonBiet: 0, soDonCo: 0 }
        return {
            ...m, affiliate: a,
            ghiChu: `${m.ghiChu} Giá sàn tính hoa hồng affiliate ít nhất ${Math.round(affMax * 1000) / 10}% — mức cao nhất một đơn đo được ở cả gian (chiến dịch affiliate áp cả shop).`,
        }
    }
    const toanGian = nangAff(goc)
    const theoNganh = new Map([...co.theoNganh].map(([k, m]) => [k, nangAff(m)] as const))
    // Cả gian chưa đo được thì đừng nói "dùng phí cả gian" như thể có số đo: chưa biết phí / phí khai (09/11/2026).
    // Hai cờ khai / chuaBiet đi theo `...toanGian` vào mọi biến thể dưới đây ⇒ tinhGiaDeXuat, lyDoPhiChuaDuTin vẫn chặn.
    const veGian = toanGian.chuaBiet ? 'cả gian cũng chưa biết phí' : toanGian.khai ? 'dùng phí KHAI của gian' : 'dùng phí cả gian'
    return {
        toanGian, theoNganh, tenNganh, viDuNganh,
        chon(nganh) {
            const k = nganh == null ? '' : String(nganh).trim()
            if (!k) {
                // Gian đã đo ra phí từng ngành khác nhau mà sản phẩm chưa rõ ngành ⇒ số cả gian có thể sai ngành:
                // người xem được, máy không tự đăng / hạ giá. Gian không đo được ngành nào ⇒ như trước.
                if (!theoNganh.size) return toanGian
                return { ...toanGian, chuaRoNganh: true, ghiChu: `Sản phẩm chưa rõ ngành trên sàn — ${veGian}. ${toanGian.ghiChu}` }
            }
            const m = theoNganh.get(k)
            if (m) return m
            const ten = tenNganh.get(k)
            return {
                ...toanGian, thayNganh: ten ? `${ten} (${k})` : k,
                ghiChu: `Ngành ${ten ? `${ten} (${k})` : k} chưa đủ đơn đối soát để đo riêng — ${veGian}. ${toanGian.ghiChu}`,
            }
        },
    }
}

// ─── Hàng kho ───────────────────────────────────────────────────────────────────

/** Tìm hàng theo SKU (không phân biệt hoa thường) / id / barcode, kèm ảnh. */
export async function timHangKho(prisma: any, sku: string): Promise<any> {
    const s = String(sku || '').trim()
    if (!s) throw new ToolError('Thiếu sku')
    const p = await prisma.product.findFirst({
        where: { OR: [{ sku: { equals: s, mode: 'insensitive' } }, { id: s }, { barcode: s }] },
        include: { images: true, category: { select: { name: true } } },
    })
    if (!p) throw new ToolError(`Không tìm thấy hàng "${s}" trong kho — tra lại bằng search_products.`)
    return p
}

/** Hàng có đăng riêng lên sàn được không (mã đã gộp, combo, dịch vụ thì không). */
export function lyDoKhongDangDuoc(p: any): string | null {
    if (p.productType && p.productType !== 'goods') return 'Là dịch vụ, không phải hàng hoá'
    if (p.mergedIntoId) return 'Mã ĐÃ GỘP vào mã khác — đăng mã đích thay vì mã này'
    if (p.bundleId) return 'Là COMBO — chưa hỗ trợ tự đăng combo (tồn phải tính theo thành phần)'
    return null
}

/**
 * Tồn bán được để khai lên sàn — cùng luật với dayTonLenSan: cửa hàng mượn KHO MẸ
 * thì lấy tồn mẹ − đơn treo; không tra ra hàng bên mẹ ⇒ 0 (không rơi về tồn con, vốn
 * 0/âm ở cửa hàng mượn kho).
 */
export async function tonBanDuoc(prisma: any, p: { sku: string; stock: number }, khoMeSan?: { khoMe: any; donTreo: Map<string, number> } | null): Promise<{ ton: number; nguon: string }> {
    let mo = khoMeSan
    if (mo === undefined) {
        const { moKhoMe, donTreoTheoSku } = await import('./khoMe')
        const khoMe = await moKhoMe(prisma)
        mo = khoMe ? { khoMe, donTreo: await donTreoTheoSku(prisma) } : null
    }
    if (!mo) return { ton: Math.max(0, Math.floor(Number(p.stock) || 0)), nguon: 'kho cửa hàng' }
    const { timHangMe } = await import('./khoMe')
    const hang = await timHangMe(mo.khoMe.sp, p.sku)
    if (!hang) return { ton: 0, nguon: `kho mẹ ${mo.khoMe.ma}: không tra ra SKU` }
    const treo = mo.donTreo.get(String(p.sku || '').trim().toLowerCase()) || 0
    return { ton: Math.max(0, Math.floor((Number(hang.stock) || 0) - treo)), nguon: `kho mẹ ${mo.khoMe.ma}${treo ? ` (đã trừ ${treo} đơn treo)` : ''}` }
}

/**
 * Hàng này ĐÃ có trên gian chưa: listing nối sẵn, listing cùng SKU, hoặc SKU sàn ánh
 * xạ về hàng này. Trả listing tìm được (để báo item_id) hoặc null.
 */
export async function listingDaCo(prisma: any, channelId: string, p: { id: string; sku: string }): Promise<any | null> {
    const theoKho = await prisma.onlineProduct.findFirst({
        where: { channelId, OR: [{ localProductId: p.id }, { sku: { equals: p.sku, mode: 'insensitive' } }] },
    })
    if (theoKho) return theoKho
    const anhXa: any[] = await prisma.skuMapping.findMany({ where: { productId: p.id }, select: { platformSku: true } }).catch(() => [])
    if (!anhXa.length) return null
    return prisma.onlineProduct.findFirst({
        where: { channelId, OR: anhXa.map(m => ({ sku: { equals: m.platformSku, mode: 'insensitive' } })) },
    })
}

// ─── Ảnh ────────────────────────────────────────────────────────────────────────

/** Chặn link ảnh trỏ vào mạng nội bộ / metadata máy chủ (link ảnh do người dán tay). */
export function laDiaChiNoiBo(url: string): boolean {
    let u: URL
    try { u = new URL(url) } catch { return true }
    if (!/^https?:$/.test(u.protocol)) return true
    const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, '')
    if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || h === '::1' || h === '0.0.0.0') return true
    const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
    if (m) {
        const [a, b] = [Number(m[1]), Number(m[2])]
        if (a === 10 || a === 127 || a === 0) return true
        if (a === 169 && b === 254) return true
        if (a === 172 && b >= 16 && b <= 31) return true
        if (a === 192 && b === 168) return true
        if (a === 100 && b >= 64 && b <= 127) return true
    }
    if (/^(fc|fd|fe80)/.test(h) && h.includes(':')) return true
    return false
}

/** Tải một ảnh sản phẩm về bộ nhớ, nhận dạng theo byte đầu. Shopee chỉ nhận jpg/png. */
export async function taiAnh(url: string): Promise<{ buf: Buffer; kieu: 'image/jpeg' | 'image/png' }> {
    if (laDiaChiNoiBo(url)) throw new Error('link ảnh không hợp lệ / trỏ vào mạng nội bộ')
    const ac = new AbortController()
    const t = setTimeout(() => ac.abort(), 20_000)
    try {
        const r = await fetch(url, { signal: ac.signal, redirect: 'follow' })
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const dai = Number(r.headers.get('content-length') || 0)
        if (dai > 10 * 1024 * 1024) throw new Error(`ảnh ${(dai / 1048576).toFixed(1)}MB > 10MB`)
        const buf = Buffer.from(await r.arrayBuffer())
        if (buf.length > 10 * 1024 * 1024) throw new Error(`ảnh ${(buf.length / 1048576).toFixed(1)}MB > 10MB`)
        const loai = nhanDangAnh(buf)
        if (loai === 'image/jpeg' || loai === 'image/png') return { buf, kieu: loai }
        throw new Error(loai ? `định dạng ${loai} — Shopee chỉ nhận JPG/PNG` : 'không phải ảnh JPG/PNG')
    } finally {
        clearTimeout(t)
    }
}

/** Ảnh của hàng theo thứ tự đăng: ảnh chính trước, tối đa 9 (trần Shopee). */
export function thuTuAnh(images: { url: string; isPrimary?: boolean }[]): string[] {
    const ds = [...(images || [])].filter(i => i?.url)
    ds.sort((a, b) => Number(!!b.isPrimary) - Number(!!a.isPrimary))
    return [...new Set(ds.map(i => i.url))].slice(0, 9)
}

// ─── Vận chuyển ─────────────────────────────────────────────────────────────────

/**
 * Chọn kênh vận chuyển cho add_item: kênh gian ĐANG BẬT, không phải kênh con của kênh
 * gộp (mask_channel_id ≠ 0 — đăng theo kênh gộp), không đòi tham số riêng (chọn cỡ /
 * tự đặt phí), và nhận được cân nặng này. Có danh sách chỉ định thì theo danh sách.
 */
export function chonKenhVanChuyen(ds: any[], canNangKg: number, chiDinh?: number[]): { ids: number[]; ghiChu: string[] } {
    const ghiChu: string[] = []
    const dangBat = (ds || []).filter(c => c && c.enabled !== false)
    if (chiDinh?.length) {
        const ids = chiDinh.map(Number).filter(id => dangBat.some(c => Number(c.logistics_channel_id) === id))
        const thieu = chiDinh.filter(id => !ids.includes(Number(id)))
        if (thieu.length) ghiChu.push(`Bỏ kênh không có / chưa bật ở gian: ${thieu.join(', ')}`)
        return { ids, ghiChu }
    }
    const hop = dangBat.filter(c => {
        if (Number(c.mask_channel_id) > 0) return false
        const loai = String(c.fee_type || '').toUpperCase()
        if (loai === 'SIZE_SELECTION' || loai === 'CUSTOM_PRICE') return false
        const max = Number(c.weight_limit?.item_max_weight)
        const min = Number(c.weight_limit?.item_min_weight)
        if (max > 0 && canNangKg > max) { ghiChu.push(`${c.logistics_channel_name}: quá cân (${max}kg)`); return false }
        if (min > 0 && canNangKg < min) return false
        return true
    })
    return { ids: hop.map(c => Number(c.logistics_channel_id)), ghiChu }
}

// ─── Thân add_item ──────────────────────────────────────────────────────────────

export interface ThuocTinhVao {
    attribute_id: number
    value_id?: number
    gia_tri?: string
    don_vi?: string
}

export interface DauVaoAddItem {
    ten: string
    moTa: string
    gia: number
    ton: number
    canNangKg: number
    kichThuocCm?: { dai: number; rong: number; cao: number } | null
    categoryId: number
    thuocTinh: ThuocTinhVao[]
    brand: { id: number; ten: string }
    logisticIds: number[]
    imageIds: string[]
    sku: string
    an: boolean
}

/** Dựng thân v2.product.add_item — hàm thuần, bộ kiểm gọi trực tiếp. */
export function dungThanAddItem(v: DauVaoAddItem): Record<string, any> {
    // Gộp các dòng cùng attribute_id (thuộc tính chọn nhiều giá trị)
    const theoId = new Map<number, any[]>()
    for (const a of v.thuocTinh || []) {
        const id = Number(a.attribute_id)
        if (!(id > 0)) continue
        const gt: any = { value_id: Number(a.value_id) > 0 ? Number(a.value_id) : 0 }
        if (!gt.value_id) {
            const chu = String(a.gia_tri ?? '').trim()
            if (!chu) continue
            gt.original_value_name = chu
        }
        if (a.don_vi) gt.value_unit = String(a.don_vi)
        if (!theoId.has(id)) theoId.set(id, [])
        theoId.get(id)!.push(gt)
    }
    const body: Record<string, any> = {
        item_name: v.ten,
        description: v.moTa,
        description_type: 'normal',
        original_price: Math.round(v.gia),
        seller_stock: [{ stock: Math.max(0, Math.floor(v.ton)) }],
        weight: Math.round(v.canNangKg * 1000) / 1000,
        category_id: Number(v.categoryId),
        image: { image_id_list: v.imageIds },
        // brand_id 0 = "No brand" (ngành không bắt buộc thương hiệu). Có brand_id thật thì chỉ gửi tên khi biết tên.
        brand: Number(v.brand.id) > 0
            ? { brand_id: Number(v.brand.id), ...(v.brand.ten ? { original_brand_name: v.brand.ten } : {}) }
            : { brand_id: 0, original_brand_name: 'NoBrand' },
        logistic_info: v.logisticIds.map(id => ({ logistic_id: id, enabled: true })),
        item_sku: v.sku,
        condition: 'NEW',
        item_status: v.an ? 'UNLIST' : 'NORMAL',
    }
    if (theoId.size) {
        body.attribute_list = [...theoId.entries()].map(([attribute_id, attribute_value_list]) => ({ attribute_id, attribute_value_list }))
    }
    if (v.kichThuocCm && v.kichThuocCm.dai > 0 && v.kichThuocCm.rong > 0 && v.kichThuocCm.cao > 0) {
        body.dimension = {
            package_length: Math.ceil(v.kichThuocCm.dai),
            package_width: Math.ceil(v.kichThuocCm.rong),
            package_height: Math.ceil(v.kichThuocCm.cao),
        }
    }
    return body
}

// ─── Danh mục listing của gian ──────────────────────────────────────────────────

/** Lưu danh mục sản phẩm kéo từ sàn vào OnlineProduct — dùng chung với nút Đồng bộ trên web. */
export async function luuDanhMucSan(prisma: any, channel: { id: string; platform: string }, products: PlatformProduct[]): Promise<number> {
    let n = 0
    for (const p of products) {
        await prisma.onlineProduct.upsert({
            where: { channelId_platformProductId: { channelId: channel.id, platformProductId: p.platformProductId } },
            create: {
                channelId: channel.id,
                platform: channel.platform,
                platformProductId: p.platformProductId,
                name: p.name,
                sku: p.sku || null,
                price: p.price,
                stock: p.stock,
                status: p.status || 'NORMAL',
                imageUrl: p.imageUrl || null,
                categoryId: p.categoryId || null,
                categoryName: p.categoryName || null,
                syncedAt: new Date(),
            },
            update: {
                name: p.name,
                sku: p.sku || null,
                price: p.price,
                stock: p.stock,
                status: p.status || 'NORMAL',
                imageUrl: p.imageUrl || null,
                // Chỉ ghi đè ngành khi list API có trả (Shopee) — TikTok search không
                // trả nên giữ nguyên giá trị đã enrich, tránh xóa mất.
                ...(p.categoryId ? { categoryId: p.categoryId, categoryName: p.categoryName || null } : {}),
                syncedAt: new Date(),
            },
        })
        n++
    }
    return n
}

/** Đường dẫn chi tiết cây ngành "Cha > Con > Lá" cho một category_id. */
export function duongNganh(ds: { id: number; chaId: number; ten: string }[], id: number): string {
    const theoId = new Map(ds.map(c => [c.id, c]))
    const ten: string[] = []
    let cur = theoId.get(Number(id))
    for (let i = 0; cur && i < 8; i++) {
        ten.unshift(cur.ten)
        cur = cur.chaId ? theoId.get(cur.chaId) : undefined
    }
    return ten.join(' > ')
}
