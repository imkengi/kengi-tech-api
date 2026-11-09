/* ═══════════════════════════════════════════════════════════════════════════════
 *  THAO TÁC GHI RA SHOPEE — một đường duy nhất cho MỌI nơi gọi (31/10/2026)
 *
 *  Hai nơi gọi:
 *   - bộ tool MCP `shopee_*` (routes/mcpShopeeTools.ts) — AI tự chạy;
 *   - bảng điều khiển Shopee Pilot (routes/shopeePilot.ts + lib/shopeePilot.ts) — người bấm.
 *  Cả hai PHẢI đi qua đúng các hàm ở đây để rào giá sàn / chống đăng trùng / thiếu giá
 *  vốn không bao giờ lệch nhau (bài học "hai router cùng đường" của repo này).
 *
 *  Lỗi nghiệp vụ ném ToolError (MCP trả về cho AI đọc; Pilot hiện cho người đọc).
 *  LoiKhongRo = gọi Shopee mà KHÔNG biết bên kia đã làm chưa (đứt mạng sau khi gửi) —
 *  bên gọi không được tự thử lại.
 * ═══════════════════════════════════════════════════════════════════════════════ */

import { ToolError } from './mcpTypes'
import { tinhGiaDeXuat, chanGiaDuoiSan, danhGiaGia, lyDoPhiChuaDuTin, type ThamSoGia } from './giaShopee'
import {
    chonKenhShopee, moDichVuShopee, docMauPhiSanPham, timHangKho, lyDoKhongDangDuoc, tonBanDuoc,
    listingDaCo, taiAnh, thuTuAnh, chonKenhVanChuyen, dungThanAddItem, type ThuocTinhVao,
} from './shopeeTuQuan'

/** Không biết Shopee đã nhận lệnh hay chưa — KHÔNG thử lại tự động. */
export class LoiKhongRo extends ToolError { readonly khongRo = true }

export const num = (v: any, d: number) => (v !== undefined && v !== null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : d)
const vnd = (n: number) => `${Math.round(n).toLocaleString('vi-VN')}đ`

export interface ChinhSachGia {
    bienLoiNhuanPct: number
    bienToiThieuPct: number
    phiDongGoi: number
    phiQuangCaoPct: number
    /** hoa hồng affiliate, % — chỉ vào giá sàn (như mọi đơn đều qua affiliate) */
    phiAffiliatePct: number
    /** thuế suất GTGT đầu ra, % (doanh nghiệp khấu trừ) */
    thueGtgtPct: number
    lamTron: number
}

const kepSo = (v: any, d: number, min: number, max: number) => Math.min(Math.max(num(v, d), min), max)

/**
 * Tham số chính sách giá kiểu tool (bien_loi_nhuan…) → chuẩn. Mặc định: mục tiêu 15%, sàn 5%.
 * `nen` = chính sách Shopee Pilot của cửa hàng (01/11/2026): tham số bỏ trống lấy theo chính sách, tham số
 * truyền vào chỉ được CHẶT hơn — AI truyền bien_toi_thieu=0 hay phi_dong_goi=0 thì vẫn giữ mức chủ shop đặt.
 * Biên MỤC TIÊU không phải rào nên được chọn tự do (tinhGiaDeXuat vẫn giữ đề xuất ≥ giá sàn).
 */
export function chinhSachGia(a: any, nen?: ChinhSachGia | null): ChinhSachGia {
    const cs: ChinhSachGia = {
        bienLoiNhuanPct: kepSo(a?.bien_loi_nhuan, nen?.bienLoiNhuanPct ?? 15, 0, 80),
        bienToiThieuPct: kepSo(a?.bien_toi_thieu, nen?.bienToiThieuPct ?? 5, 0, 80),
        phiDongGoi: Math.max(0, num(a?.phi_dong_goi, nen?.phiDongGoi ?? 0)),
        phiQuangCaoPct: kepSo(a?.phi_quang_cao, nen?.phiQuangCaoPct ?? 0, 0, 50),
        phiAffiliatePct: kepSo(a?.hoa_hong_affiliate, nen?.phiAffiliatePct ?? 0, 0, 50),
        thueGtgtPct: kepSo(a?.thue_gtgt, nen?.thueGtgtPct ?? 0, 0, 10),
        lamTron: Math.max(1, num(a?.lam_tron, nen?.lamTron ?? 1000)),
    }
    if (!nen) return cs
    return {
        ...cs,
        bienToiThieuPct: Math.max(cs.bienToiThieuPct, nen.bienToiThieuPct),
        phiDongGoi: Math.max(cs.phiDongGoi, nen.phiDongGoi),
        phiQuangCaoPct: Math.max(cs.phiQuangCaoPct, nen.phiQuangCaoPct),
        phiAffiliatePct: Math.max(cs.phiAffiliatePct, nen.phiAffiliatePct),
        thueGtgtPct: Math.max(cs.thueGtgtPct, nen.thueGtgtPct),
    }
}

/** Tuỳ chọn chung của các thao tác GHI giá ra Shopee. */
export interface TuyChonGhi {
    ch?: any
    /** chính sách Shopee Pilot của cửa hàng — tham số chỉ được chặt hơn nó. null = chỉ theo tham số */
    nen: ChinhSachGia | null
    /** máy tự chạy (tool AI, chu kỳ tự động): phí sàn chưa đủ tin ⇒ TỪ CHỐI; người duyệt thì chỉ cảnh báo */
    tuDong: boolean
    /** ShopeeService đã mở trong cùng lượt — dùng lại, khỏi làm mới token hai lần bằng refresh token đã cũ */
    svc?: any
}

/** Giới hạn giá của Shopee cho ngành (nếu đọc được) — không đọc được thì bỏ qua, không chặn. */
export async function gioiHanGia(svc: any, categoryId?: number): Promise<{ min?: number; max?: number; raw?: any }> {
    try {
        const r = await svc.getItemLimit(categoryId)
        const p = r?.price_limit || {}
        return { min: Number(p.min_limit) || undefined, max: Number(p.max_limit) || undefined, raw: r }
    } catch {
        return {}
    }
}

export type VonListing = { giaVon: number; sku?: string; productId?: string; ten?: string; moTa?: string | null }

/**
 * Giá vốn của MỘT đơn vị bán trên sàn cho từng listing — cùng chuỗi tra với dayTonLenSan:
 * nối sẵn → cùng SKU → ánh xạ SKU (nhân hệ số quy đổi: 1 vỉ = 10 cái) → mã đã gộp (nhân
 * mergedRate, lấy vốn mã đích). GOM LÔ: số truy vấn cố định (≤ 4) dù bao nhiêu listing —
 * pool kết nối của cửa hàng rất nhỏ, soát 300 listing mà mỗi cái 3 truy vấn là nghẽn.
 */
export async function giaVonHangLoat(prisma: any, ds: { id: string; localProductId?: string | null; sku?: string | null }[]): Promise<Map<string, VonListing>> {
    const ra = new Map<string, VonListing>()
    if (!ds.length) return ra
    const thuong = (x: any) => String(x || '').trim().toLowerCase()
    const ids = [...new Set(ds.map(l => l.localProductId).filter(Boolean) as string[])]
    const skus = [...new Set(ds.map(l => thuong(l.sku)).filter(Boolean))]
    const COT = `id, sku, name, description, "costPrice"::float8 AS "costPrice", "mergedIntoId", COALESCE("mergedRate", 1)::float8 AS "mergedRate"`
    const hang: any[] = await prisma.$queryRawUnsafe(
        `SELECT ${COT} FROM "Product" WHERE id = ANY($1::text[]) OR LOWER(sku) = ANY($2::text[])`, ids, skus,
    ).catch(() => [])
    const theoId = new Map<string, any>(hang.map(h => [h.id, h]))
    const theoSku = new Map<string, any>()
    for (const h of hang) { const k = thuong(h.sku); if (!theoSku.has(k)) theoSku.set(k, h) }

    const conThieu = skus.filter(k => !theoSku.has(k))
    const anhXa: any[] = conThieu.length ? await prisma.$queryRawUnsafe(
        `SELECT LOWER("platformSku") AS k, "productId", COALESCE("conversionRate", 1)::float8 AS rate FROM "SkuMapping" WHERE LOWER("platformSku") = ANY($1::text[])`, conThieu,
    ).catch(() => []) : []
    const theoAnhXa = new Map<string, any>()
    for (const m of anhXa) if (!theoAnhXa.has(m.k)) theoAnhXa.set(m.k, m)

    const canThem = [...new Set([
        ...anhXa.map(m => m.productId).filter((id: string) => !theoId.has(id)),
        ...hang.map(h => h.mergedIntoId).filter((id: string) => id && !theoId.has(id)),
    ])]
    if (canThem.length) {
        const them: any[] = await prisma.$queryRawUnsafe(`SELECT ${COT} FROM "Product" WHERE id = ANY($1::text[])`, canThem).catch(() => [])
        for (const h of them) theoId.set(h.id, h)
    }
    // Vòng gộp lần hai (mã gộp trỏ tiếp vào mã đã gộp) hiếm — dừng ở một bước, thiếu thì bỏ trống chứ không đoán
    for (const l of ds) {
        let p: any = (l.localProductId && theoId.get(l.localProductId)) || theoSku.get(thuong(l.sku))
        let rate = 1
        if (!p) {
            const m = theoAnhXa.get(thuong(l.sku))
            if (m) { p = theoId.get(m.productId); rate = Number(m.rate) || 1 }
        }
        if (p?.mergedIntoId) { rate *= Number(p.mergedRate) || 1; p = theoId.get(p.mergedIntoId) }
        if (p) ra.set(l.id, { giaVon: (Number(p.costPrice) || 0) * rate, sku: p.sku, productId: p.id, ten: p.name, moTa: p.description })
    }
    return ra
}

/** Số đã bán 14 ngày qua của gian, theo SKU (chữ thường). Đơn hoàn tất cũ bị dọn sau ~18 ngày nên chỉ tin 14 ngày. */
/** Số đã bán 14 ngày của một gian, ba cách khớp — xem `daBanCuaListing`. */
export interface DaBan14 { theoSku: Map<string, number>; theoMaSan: Map<string, number>; theoHang: Map<string, number> }

/**
 * Số đã bán 14 ngày (đơn huỷ / chưa thanh toán không tính) — nuôi luật "14 ngày không bán ⇒ hạ giá" của chu kỳ Pilot.
 * TT-18 (10/11/2026): trước chỉ đếm theo SKU và nuốt lỗi đọc thành Map RỖNG ⇒ (1) listing không SKU (nối tay) luôn "không bán",
 * (2) CSDL chập chờn một lượt là MỌI mã thành "14 ngày không bán" ⇒ máy hạ giá cả hàng đang bán chạy. Giờ đếm ba cách:
 *   - theo SKU dòng đơn (bỏ SKU rỗng — trước đây `get('')` cộng dồn mọi dòng SKU rỗng vào listing không SKU);
 *   - theo mã sản phẩm sàn (`externalItemId`) — CHỈ khi `theoMaSan` (Shopee: = item_id; TikTok: là mã DÒNG đơn, không dùng được);
 *   - theo hàng kho đã nối (`productId`, do lienKetHangDon nối cả dòng không SKU theo tên listing).
 * Đọc hỏng ⇒ NÉM: "không đọc được" ≠ "không bán" — người gọi tự quyết (chu kỳ bỏ luật bán chậm, trang hiện "—").
 */
export async function soBan14Ngay(prisma: any, channelId: string, o: { theoMaSan?: boolean } = {}): Promise<DaBan14> {
    const rows: any[] = await prisma.$queryRawUnsafe(
        `WITH d AS (
            SELECT LOWER(NULLIF(TRIM(i.sku), '')) AS sku, NULLIF(i."externalItemId", '') AS ma, i."productId" AS hang, i.quantity AS sl
              FROM "OnlineOrderItem" i JOIN "OnlineOrder" o ON o.id = i."onlineOrderId"
             WHERE o."channelId" = $1 AND o."createdAt" >= NOW() - INTERVAL '14 days'
               AND o.status NOT IN ('CANCELLED','IN_CANCEL','UNPAID','cancelled','cancelling'))
         SELECT 'sku' AS loai, sku AS khoa, SUM(sl)::int AS sl FROM d WHERE sku IS NOT NULL GROUP BY sku
         UNION ALL SELECT 'hang' AS loai, hang AS khoa, SUM(sl)::int AS sl FROM d WHERE hang IS NOT NULL GROUP BY hang
         UNION ALL SELECT 'ma' AS loai, ma AS khoa, SUM(sl)::int AS sl FROM d WHERE ma IS NOT NULL AND $2::boolean GROUP BY ma`,
        channelId, o.theoMaSan === true,
    )
    const kq: DaBan14 = { theoSku: new Map(), theoMaSan: new Map(), theoHang: new Map() }
    for (const r of rows || []) {
        const sl = Number(r?.sl) || 0
        if (r?.loai === 'hang') kq.theoHang.set(String(r.khoa), sl)
        else if (r?.loai === 'ma') kq.theoMaSan.set(String(r.khoa), sl)
        else if (r?.khoa ?? r?.sku) kq.theoSku.set(String(r.khoa ?? r.sku).toLowerCase(), sl)   // r.sku: dòng kiểu cũ (prisma giả)
    }
    return kq
}

/** Đã bán 14 ngày của MỘT listing = số LỚN NHẤT trong ba cách khớp. Đếm dư (hai listing chung SKU / chung hàng kho) chỉ làm máy
 *  bớt hạ giá — chiều an toàn; đếm thiếu mới làm hạ giá oan. */
export function daBanCuaListing(b: DaBan14, l: { sku?: any; platformProductId?: any; localProductId?: any }): number {
    const sku = String(l?.sku ?? '').trim().toLowerCase()
    return Math.max(
        sku ? b.theoSku.get(sku) || 0 : 0,
        l?.platformProductId ? b.theoMaSan.get(String(l.platformProductId)) || 0 : 0,
        l?.localProductId ? b.theoHang.get(String(l.localProductId)) || 0 : 0,
    )
}

export const THIEU_MO_TA = 'mô tả (AI có thể tự viết từ thông tin thật)'

export interface UngVien {
    id: string; sku: string; ten: string; nhomHang?: string
    giaVon: number; giaBanLe: number; tonBanDuoc: number; nguonTon: string
    soAnh: number; doDaiMoTa: number; thieu: string[]
    moTa: string; anhDau: string | null
}

/**
 * Hàng kho CHƯA có trên gian và còn tồn bán được — ứng viên để đăng. Hàng đã có = listing
 * nối sẵn / cùng SKU / SKU sàn ánh xạ về hàng đó. Quét tối đa 400 mặt hàng (tồn nhiều trước).
 */
export async function timUngVien(prisma: any, channelId: string, o: { query?: string; nhomHang?: string; chiDuDieuKien?: boolean; lim?: number } = {}): Promise<{ ungVien: UngVien[]; soListingDaCo: number; soQuet: number; chamTran: boolean }> {
    const lim = Math.min(Math.max(num(o.lim, 20), 1), 100)
    const where: any = { productType: 'goods', mergedIntoId: null, bundleId: null }
    const q = String(o.query || '').trim()
    if (q) where.OR = [{ name: { contains: q, mode: 'insensitive' } }, { sku: { contains: q, mode: 'insensitive' } }]
    if (o.nhomHang) where.category = { name: { contains: String(o.nhomHang), mode: 'insensitive' } }

    const [listing, anhXa] = await Promise.all([
        prisma.onlineProduct.findMany({ where: { channelId }, select: { localProductId: true, sku: true } }),
        prisma.skuMapping.findMany({ select: { platformSku: true, productId: true }, take: 20000 }).catch(() => []),
    ])
    const daCoId = new Set<string>(listing.map((l: any) => l.localProductId).filter(Boolean))
    const daCoSku = new Set<string>(listing.map((l: any) => String(l.sku || '').trim().toLowerCase()).filter(Boolean))
    for (const m of anhXa as any[]) if (daCoSku.has(String(m.platformSku || '').trim().toLowerCase())) daCoId.add(m.productId)

    const { moKhoMe, donTreoTheoSku } = await import('./khoMe')
    const khoMe = await moKhoMe(prisma)
    const moKho = khoMe ? { khoMe, donTreo: await donTreoTheoSku(prisma) } : null
    if (!moKho) where.stock = { gt: 0 }

    const TRAN_QUET = 400
    const ds: any[] = await prisma.product.findMany({
        where,
        select: {
            id: true, sku: true, name: true, costPrice: true, sellingPrice: true, stock: true, description: true,
            category: { select: { name: true } }, _count: { select: { images: true } },
            images: { select: { url: true }, orderBy: { isPrimary: 'desc' }, take: 1 },
        },
        orderBy: [{ stock: 'desc' }, { updatedAt: 'desc' }],
        take: TRAN_QUET,
    })
    const ra: UngVien[] = []
    for (const p of ds) {
        if (ra.length >= lim) break
        if (daCoId.has(p.id) || daCoSku.has(String(p.sku).toLowerCase())) continue
        const ton = await tonBanDuoc(prisma, p, moKho)
        if (ton.ton <= 0) continue
        const doDaiMoTa = String(p.description || '').trim().length
        const thieu: string[] = []
        if (!(p.costPrice > 0)) thieu.push('giá vốn')
        if (!p._count?.images) thieu.push('ảnh')
        if (doDaiMoTa < 50) thieu.push(THIEU_MO_TA)
        if (o.chiDuDieuKien && thieu.some(t => t !== THIEU_MO_TA)) continue
        ra.push({
            id: p.id, sku: p.sku, ten: p.name, nhomHang: p.category?.name,
            giaVon: p.costPrice, giaBanLe: p.sellingPrice, tonBanDuoc: ton.ton, nguonTon: ton.nguon,
            soAnh: p._count?.images || 0, doDaiMoTa, thieu,
            moTa: String(p.description || ''), anhDau: p.images?.[0]?.url || null,
        })
    }
    return { ungVien: ra, soListingDaCo: listing.length, soQuet: ds.length, chamTran: ds.length >= TRAN_QUET }
}

// ─── Đăng sản phẩm ──────────────────────────────────────────────────────────────

/**
 * Đăng MỘT mặt hàng kho lên gian (tham số theo tên của tool shopee_create_listing).
 * chay_thu=true: soát đủ mọi rào + dựng thân yêu cầu, không nạp ảnh, không gọi add_item.
 */
export async function dangSanPhamShopee(prisma: any, a: any, tuyChon: TuyChonGhi): Promise<any> {
    const chayThu = a?.chay_thu === true
    const ch = tuyChon.ch || await chonKenhShopee(prisma, a?.kenh)
    const p = await timHangKho(prisma, a?.sku)
    const khongDuoc = lyDoKhongDangDuoc(p)
    if (khongDuoc) throw new ToolError(`Không đăng ${p.sku}: ${khongDuoc}`)

    const trung = await listingDaCo(prisma, ch.id, p)
    if (trung) throw new ToolError(`${p.sku} ĐÃ CÓ trên gian "${ch.name}" (item_id ${trung.platformProductId}, giá ${vnd(trung.price)}) — đổi giá thay vì đăng lại.`)

    const categoryId = num(a?.category_id, 0)
    if (!(categoryId > 0)) throw new ToolError('category_id (ngành hàng Shopee) không hợp lệ')
    const canNangKg = num(a?.can_nang_gram, 0) / 1000
    if (!(canNangKg > 0) || canNangKg > 300) throw new ToolError('can_nang_gram phải là cân nặng thật (gram, > 0)')

    const svc: Awaited<ReturnType<typeof moDichVuShopee>> = tuyChon.svc || await moDichVuShopee(prisma, ch)
    const cs = chinhSachGia(a, tuyChon.nen)
    // phí của ĐÚNG ngành sẽ đăng vào (mỗi ngành Shopee thu một khác) — ngành chưa đủ đơn đo riêng thì máy không tự đăng
    const [mauPhi, gh] = await Promise.all([docMauPhiSanPham(prisma, ch, categoryId), gioiHanGia(svc, categoryId)])
    const ts: ThamSoGia = { giaVon: Number(p.costPrice) || 0, phi: mauPhi, ...cs, giaShopeeMin: gh.min, giaShopeeMax: gh.max }
    const kq = tinhGiaDeXuat(ts)
    if (!kq.hopLe && !a?.gia) throw new ToolError(`Không tính được giá cho ${p.sku}: ${kq.lyDo}`)
    const gia = a?.gia ? num(a.gia, 0) : kq.giaDeXuat
    const chan = chanGiaDuoiSan(gia, kq)
    if (chan) throw new ToolError(`${p.sku}: ${chan}`)
    if (gh.min && gia < gh.min) throw new ToolError(`Giá ${vnd(gia)} dưới mức tối thiểu Shopee cho ngành (${vnd(gh.min)})`)
    if (gh.max && gia > gh.max) throw new ToolError(`Giá ${vnd(gia)} vượt mức tối đa Shopee cho ngành (${vnd(gh.max)})`)
    const phiChuaTin = lyDoPhiChuaDuTin(gia, mauPhi, cs.bienToiThieuPct)
    if (phiChuaTin && tuyChon.tuDong && !chayThu) throw new ToolError(`Không tự đăng ${p.sku}: ${phiChuaTin}`)

    const ton = await tonBanDuoc(prisma, p)
    if (ton.ton <= 0) throw new ToolError(`${p.sku} hết hàng (${ton.nguon}) — không đăng.`)
    const tonDang = a?.so_luong_dang ? Math.min(ton.ton, Math.max(1, Math.floor(num(a.so_luong_dang, ton.ton)))) : ton.ton

    const ten = String(a?.ten || p.name || '').trim().replace(/\s+/g, ' ')
    const tenMax = Number(gh.raw?.item_name_length_limit?.max_limit) || 120
    const tenMin = Number(gh.raw?.item_name_length_limit?.min_limit) || 0
    if (ten.length > tenMax) throw new ToolError(`Tên dài ${ten.length} ký tự, Shopee cho tối đa ${tenMax} — rút gọn tên.`)
    if (ten.length < tenMin) throw new ToolError(`Tên ngắn ${ten.length} ký tự, Shopee đòi tối thiểu ${tenMin} — viết tên đầy đủ hơn.`)
    const moTa = String(a?.mo_ta || p.description || '').trim()
    const moTaMin = Number(gh.raw?.item_description_length_limit?.min_limit) || 0
    const moTaMax = Number(gh.raw?.item_description_length_limit?.max_limit) || 3000
    if (!moTa) throw new ToolError(`${p.sku} chưa có mô tả — viết mô tả từ thông tin thật.`)
    if (moTa.length < moTaMin) throw new ToolError(`Mô tả ${moTa.length} ký tự, Shopee đòi tối thiểu ${moTaMin} — viết thêm (chỉ thông tin thật).`)
    if (moTa.length > moTaMax) throw new ToolError(`Mô tả ${moTa.length} ký tự, Shopee cho tối đa ${moTaMax} — rút gọn mô tả.`)

    const anh = thuTuAnh(p.images || [])
    if (!anh.length) throw new ToolError(`${p.sku} chưa có ảnh — tải ảnh ở mục Thông tin sản phẩm trước.`)

    const vc = chonKenhVanChuyen(await svc.getLogisticsChannels(), canNangKg, Array.isArray(a?.kenh_van_chuyen) ? a.kenh_van_chuyen : undefined)
    if (!vc.ids.length) throw new ToolError(`Không có kênh vận chuyển phù hợp đang bật cho ${Math.round(canNangKg * 1000)}g. ${vc.ghiChu.join('; ')}`)

    const dauVao = {
        ten, moTa, gia, ton: tonDang, canNangKg,
        kichThuocCm: a?.dai_cm && a?.rong_cm && a?.cao_cm ? { dai: num(a.dai_cm, 0), rong: num(a.rong_cm, 0), cao: num(a.cao_cm, 0) } : null,
        categoryId,
        thuocTinh: (Array.isArray(a?.thuoc_tinh) ? a.thuoc_tinh : []) as ThuocTinhVao[],
        brand: { id: num(a?.brand_id, 0), ten: String(a?.ten_thuong_hieu || '').trim() },
        logisticIds: vc.ids,
        imageIds: [] as string[],
        sku: p.sku,
        an: a?.an_sau_khi_dang === true,
    }
    const phanTichGia = {
        gia, giaDeXuat: kq.giaDeXuat, giaSan: kq.giaSan, giaHoaVon: kq.giaHoaVon,
        duKien: danhGiaGia(gia, ts), duKienAffiliate: danhGiaGia(gia, ts, true), mauPhi: mauPhi.ghiChu,
        ...(phiChuaTin ? { canhBaoPhi: phiChuaTin } : {}),
    }

    if (chayThu) {
        return {
            cheDo: 'CHẠY THỬ — chưa nạp ảnh, chưa đăng',
            thanYeuCau: dungThanAddItem({ ...dauVao, imageIds: anh.map((_, i) => `<anh-${i + 1}>`) }),
            anhSeNap: anh, tonKhai: tonDang, nguonTon: ton.nguon,
            phanTichGia, vanChuyen: vc,
        }
    }

    const loiAnh: string[] = []
    for (const url of anh) {
        try {
            const { buf, kieu } = await taiAnh(url)
            dauVao.imageIds.push((await svc.uploadImage(buf, kieu)).imageId)
        } catch (e: any) {
            loiAnh.push(`${url.slice(-60)}: ${String(e?.message || e).slice(0, 160)}`)
        }
    }
    if (!dauVao.imageIds.length) throw new ToolError(`Không nạp được ảnh nào lên Shopee: ${loiAnh.join(' | ')}`)

    let kqDang: { itemId: string; canhBao?: string }
    try {
        kqDang = await svc.addItem(dungThanAddItem(dauVao))
    } catch (e: any) {
        const loi = String(e?.message || e)
        // Shopee trả lời từ chối rõ ràng ⇒ chắc chắn CHƯA tạo; còn lại (đứt mạng / quá hạn sau khi gửi) ⇒ không rõ.
        if (/^Shopee add_item/.test(loi)) throw new ToolError(loi)
        throw new LoiKhongRo(`KHÔNG RÕ Shopee đã tạo sản phẩm ${p.sku} chưa (${loi.slice(0, 200)}). ĐỪNG đăng lại ngay: đồng bộ danh sách sản phẩm của gian rồi kiểm tra ${p.sku} trước.`)
    }
    await prisma.onlineProduct.upsert({
        where: { channelId_platformProductId: { channelId: ch.id, platformProductId: kqDang.itemId } },
        create: {
            channelId: ch.id, platform: 'shopee', platformProductId: kqDang.itemId,
            name: ten, sku: p.sku, price: gia, stock: tonDang,
            status: dauVao.an ? 'UNLIST' : 'NORMAL', imageUrl: anh[0], categoryId: String(categoryId),
            localProductId: p.id, syncedAt: new Date(),
        },
        update: { name: ten, sku: p.sku, price: gia, stock: tonDang, localProductId: p.id, syncedAt: new Date() },
    }).catch((e: any) => console.error('[dangSanPhamShopee] ghi OnlineProduct hỏng:', e?.message || e))
    console.log(`[ShopeeTuQuan] ĐĂNG ${p.sku} → ${ch.name} item ${kqDang.itemId} giá ${gia}`)

    return {
        daDang: true,
        itemId: kqDang.itemId,
        link: `https://shopee.vn/product/${ch.shopId}/${kqDang.itemId}`,
        trangThai: dauVao.an ? 'ẨN (chờ chủ shop duyệt rồi hiện)' : 'ĐANG BÁN',
        sku: p.sku, ten, tonKhai: tonDang, soAnh: dauVao.imageIds.length,
        ...(loiAnh.length ? { anhLoi: loiAnh } : {}),
        ...(vc.ghiChu.length ? { ghiChuVanChuyen: vc.ghiChu } : {}),
        ...(kqDang.canhBao ? { canhBaoShopee: kqDang.canhBao } : {}),
        phanTichGia,
    }
}

// ─── Đổi giá ────────────────────────────────────────────────────────────────────

/**
 * SKU của gian theo đúng MỘT listing (SP-11, 10/11/2026): hai listing cùng SKU (đăng lại, bản sao, hàng phân loại mang mã cha…)
 * thì `findFirst` theo SKU lấy BỪA một cái ⇒ đổi giá / đưa vào khuyến mãi nhầm sản phẩm. Thấy listing thứ hai cùng SKU ⇒ ném lỗi
 * nêu các item_id để người / AI chọn đúng theo mã sản phẩm. Lỗi mang `skuTrung = true` (người gọi lô — khuyến mãi — nói đúng lý do).
 * Tìm "listing KHÁC" bằng NOT id thay vì đếm: bản giả trong bộ kiểm bỏ qua NOT trả lại chính listing đó ⇒ không tính là trùng.
 */
export async function soatSkuTrung(prisma: any, channelId: string, sku: string, l: any): Promise<void> {
    const khac = await prisma.onlineProduct.findFirst({ where: { channelId, sku: { equals: String(sku), mode: 'insensitive' }, NOT: { id: l.id } } })
    if (!khac || khac.id === l.id) return
    const e: any = new ToolError(`Mã "${sku}" đang gắn với từ 2 sản phẩm trở lên trên gian (mã sản phẩm sàn ${l.platformProductId}, ${khac.platformProductId}…) — `
        + 'chọn đúng sản phẩm theo mã sản phẩm sàn (item_id), kẻo đổi nhầm.')
    e.skuTrung = true
    throw e
}

/** Tìm listing của gian theo item_id hoặc sku. SKU trùng giữa nhiều listing ⇒ từ chối (soatSkuTrung) — không chọn bừa. */
export async function timListing(prisma: any, channelId: string, a: { item_id?: any; sku?: any }): Promise<any> {
    let l: any = null
    if (a?.item_id) l = await prisma.onlineProduct.findFirst({ where: { channelId, platformProductId: String(a.item_id) } })
    else if (a?.sku) l = await prisma.onlineProduct.findFirst({ where: { channelId, sku: { equals: String(a.sku), mode: 'insensitive' } } })
    else throw new ToolError('Truyền item_id hoặc sku')
    if (!l) throw new ToolError('Không thấy sản phẩm này trên gian (đồng bộ danh sách sản phẩm nếu vừa đăng ngoài hệ thống)')
    if (!a?.item_id) await soatSkuTrung(prisma, channelId, String(a.sku), l)
    return l
}

/** Đổi giá MỘT listing (tham số theo tên của tool shopee_update_price). Dưới giá sàn / thiếu vốn ⇒ từ chối. */
export async function doiGiaShopee(prisma: any, a: any, tuyChon: TuyChonGhi): Promise<any> {
    const ch = tuyChon.ch || await chonKenhShopee(prisma, a?.kenh)
    const giaMoi = Math.round(num(a?.gia_moi, 0))
    if (!(giaMoi > 0)) throw new ToolError('gia_moi không hợp lệ')
    const l = await timListing(prisma, ch.id, a)

    const v = (await giaVonHangLoat(prisma, [l])).get(l.id)
    if (!v || !(v.giaVon > 0)) throw new ToolError(`${l.sku || l.platformProductId} thiếu giá vốn — không đổi giá khi không biết lãi/lỗ.`)
    const cs = chinhSachGia(a, tuyChon.nen)
    const mauPhi = await docMauPhiSanPham(prisma, ch, l.categoryId)   // phí ĐÚNG ngành của sản phẩm
    const ts: ThamSoGia = { giaVon: v.giaVon, phi: mauPhi, ...cs }
    const kq = tinhGiaDeXuat(ts)
    const chan = chanGiaDuoiSan(giaMoi, kq)
    if (chan) throw new ToolError(`${l.sku || l.platformProductId}: ${chan}`)
    const phiChuaTin = tuyChon.tuDong ? lyDoPhiChuaDuTin(giaMoi, mauPhi, cs.bienToiThieuPct) : null
    const svc: Awaited<ReturnType<typeof moDichVuShopee>> = tuyChon.svc || await moDichVuShopee(prisma, ch)
    if (phiChuaTin) {
        /* Phí chưa đủ tin: máy chỉ được TĂNG giá — lãi mỗi đơn tăng theo giá bán, tăng giá không bao giờ lỗ thêm.
         * So với giá GỐC đọc thẳng từ Shopee (bản trong hệ thống có thể cũ); có phân loại / không đọc được ⇒ chờ người duyệt.
         * KHÔNG nới "hạ theo phí xấu nhất đã đo của gian" (thử 03/11/2026 rồi gỡ): ngành chưa đo có thể phí cao hơn MỌI ngành
         * đã đo — biểu phí cố định Shopee / TikTok khác nhau theo nhóm ngành, gian chỉ đo được vài ngành bán nhiều. */
        const giaShopee = await giaGocShopee(svc, l.platformProductId)
        if (!(giaShopee > 0 && giaMoi > giaShopee)) throw new ToolError(`Không tự đổi giá ${l.sku || l.platformProductId}: ${phiChuaTin}`)
    }
    let modelId: number | undefined
    /* X-22 (09/11/2026): dịch vụ báo KHÔNG RÕ (`khongRo`: mạng / quá hạn / 5xx / lỗi phía máy chủ Shopee) ⇒ LoiKhongRo — người gọi
     * ghi 'uncertain' = tính như ĐÃ đổi (nghỉ 24 giờ, đừng đổi lại khi chưa xem Seller Center). Lỗi Shopee trả rõ vẫn là lỗi thường. */
    const khongRoGia = (e: any) => (e?.khongRo && !(e instanceof LoiKhongRo)
        ? new LoiKhongRo(`KHÔNG RÕ Shopee đã nhận giá mới ${Math.round(giaMoi).toLocaleString('vi-VN')}đ của ${l.sku || l.platformProductId} chưa (${String(e?.message || e).replace(/^KHÔNG RÕ Shopee đã nhận update_price chưa:\s*/, '').slice(0, 200)}) — kiểm giá trên Seller Center trước khi đổi lại.`)
        : e)
    try {
        await svc.updatePrice(l.platformProductId, giaMoi)
    } catch (e: any) {
        if (!/model_id is mandatory|under model level/i.test(String(e?.message || ''))) throw khongRoGia(e)
        const models = await svc.getModelList(Number(l.platformProductId))
        const khop = models.filter(m => String(m.sku || '').trim().toLowerCase() === String(v.sku || l.sku || '').trim().toLowerCase())
        if (khop.length !== 1) throw new ToolError(`Sản phẩm có ${models.length} phân loại, ${khop.length} cái mang SKU "${v.sku || l.sku}" — không đoán, đổi giá tay trên Shopee.`)
        modelId = khop[0]!.model_id
        try { await svc.updatePrice(l.platformProductId, giaMoi, modelId) } catch (e2: any) { throw khongRoGia(e2) }
    }
    const giaCu = Number(l.price) || 0
    await prisma.onlineProduct.update({ where: { id: l.id }, data: { price: giaMoi } }).catch(() => { })
    console.log(`[ShopeeTuQuan] ĐỔI GIÁ ${l.sku} (${ch.name} item ${l.platformProductId}) ${giaCu} → ${giaMoi}${a?.ly_do ? ` — ${String(a.ly_do).slice(0, 200)}` : ''}`)
    return {
        daDoi: true, itemId: l.platformProductId, sku: l.sku, ...(modelId ? { modelId } : {}),
        giaCu, giaMoi, truoc: danhGiaGia(giaCu, ts), sau: danhGiaGia(giaMoi, ts), sauQuaAffiliate: danhGiaGia(giaMoi, ts, true), giaSan: kq.giaSan,
        ...(phiChuaTin ? { canhBao: `Chỉ được TĂNG giá vì phí sàn chưa đủ tin — giá sàn có thể còn thấp, chủ shop nên xem lại trên Shopee Pilot. ${phiChuaTin}` } : {}),
    }
}

/**
 * Giá / trạng thái ĐANG ĐỂ trên Shopee (get_item_base_info, 50 mã một lần) — 03/11/2026. Bản trong hệ thống chỉ mới
 * bằng lần bấm Đồng bộ cuối, và lưu giá ĐANG BÁN (current_price, đã trừ khuyến mãi) — còn update_price đổi giá GỐC.
 * Quyết giá trên bản lưu là ghi đè giá chủ shop vừa sửa trên Seller Center, và hàng đang KM bị so bằng giá KM.
 * Lỗi đọc (token, mạng) ⇒ NÉM: người gọi tự quyết bỏ qua hay dùng bản lưu.
 */
export interface GiaSongShopee { giaGoc: number; giaBan: number; coPhanLoai: boolean; trangThai: string; nganh: string | null }
export async function giaSongShopee(svc: any, itemIds: (string | number)[]): Promise<Map<string, GiaSongShopee>> {
    const ra = new Map<string, GiaSongShopee>()
    const ids = [...new Set(itemIds.map(x => String(x)))].filter(x => Number(x) > 0)
    for (let i = 0; i < ids.length; i += 50) {
        for (const it of (await svc.getItemBaseInfo(ids.slice(i, i + 50).map(Number))) || []) {
            const p = Array.isArray(it?.price_info) ? it.price_info[0] : null
            const goc = Number(p?.original_price) || 0
            ra.set(String(it.item_id), {
                giaGoc: goc, giaBan: Number(p?.current_price) || goc, coPhanLoai: !!it.has_model,
                trangThai: String(it.item_status || ''), nganh: it.category_id ? String(it.category_id) : null,
            })
        }
    }
    return ra
}

/** Mã đang / sắp chạy chương trình (get_item_promotion) → loại chương trình. Đổi giá GỐC lúc này là đổi luôn mức giảm
 *  của chương trình (tăng giá ngay trước đợt giảm còn dính luật "tăng giá ảo" của Shopee) ⇒ máy không đụng. Lỗi đọc ⇒ NÉM. */
export async function maDangKhuyenMai(svc: any, itemIds: (string | number)[]): Promise<Map<string, string>> {
    const ra = new Map<string, string>()
    const ids = [...new Set(itemIds.map(x => Number(x)))].filter(n => n > 0)
    for (let i = 0; i < ids.length; i += 50) {
        for (const x of (await svc.getItemPromotion(ids.slice(i, i + 50))) || []) {
            const p = (x?.promotion || []).find((p: any) => /ongoing|upcoming/i.test(String(p?.promotion_staging || '')))
            if (p) ra.set(String(x.item_id), `${p.promotion_type || 'chương trình'} ${/ongoing/i.test(String(p.promotion_staging)) ? 'đang chạy' : 'sắp chạy'}`)
        }
    }
    return ra
}

/** Giá GỐC đang để trên Shopee của hàng không phân loại. 0 = có phân loại / không đọc được. */
async function giaGocShopee(svc: any, itemId: string): Promise<number> {
    try {
        const [it] = await svc.getItemBaseInfo([Number(itemId)])
        if (!it || it.has_model) return 0
        return Number(it.price_info?.[0]?.original_price) || 0
    } catch {
        return 0
    }
}

// ─── Hiện lại listing đang ẩn ───────────────────────────────────────────────────

/**
 * Soát trước khi HIỆN LẠI một sản phẩm đang ẩn (01/11/2026): hàng có thể bị ẩn CHÍNH VÌ giá lỗ — hiện lại là
 * mở bán ở giá đang để. Cùng rào với đổi giá: thiếu vốn / dưới giá sàn / (máy tự chạy) phí chưa đủ tin ⇒ không
 * hiện. Giá đọc THẲNG từ Shopee (giá đang bán, đã gồm khuyến mãi đang chạy) — bản trong hệ thống có thể cũ.
 * Hàng có phân loại: soát từng phân loại theo giá vốn SKU phân loại. null = được hiện.
 */
export async function lyDoKhongHienLai(prisma: any, ch: any, svc: any, itemId: string, cs: ChinhSachGia, tuDong: boolean): Promise<string | null> {
    const [item] = await svc.getItemBaseInfo([Number(itemId)])
    if (!item) return 'Shopee không trả thông tin sản phẩm này — không soát được giá, không hiện lại.'
    const l = await prisma.onlineProduct.findFirst({ where: { channelId: ch.id, platformProductId: itemId } }).catch(() => null)
    // phí của ngành sản phẩm ĐANG nằm trên Shopee (đọc thẳng), không có thì ngành đã lưu trong hệ thống
    const mauPhi = await docMauPhiSanPham(prisma, ch, item.category_id || l?.categoryId)
    const soat = (gia: number, giaVon: number, ten: string): string | null => {
        if (!(gia > 0)) return `${ten}: không đọc được giá đang bán`
        if (!(giaVon > 0)) return `${ten}: thiếu giá vốn — không biết lãi/lỗ`
        const chan = chanGiaDuoiSan(gia, tinhGiaDeXuat({ giaVon, phi: mauPhi, ...cs }))
        if (chan) return `${ten}: ${chan}`
        const phiChuaTin = tuDong ? lyDoPhiChuaDuTin(gia, mauPhi, cs.bienToiThieuPct) : null
        return phiChuaTin ? `${ten}: ${phiChuaTin}` : null
    }
    if (item.has_model) {
        const models: any[] = await svc.getModelList(Number(itemId))
        if (!models.length) return 'Không đọc được phân loại — không soát được giá, không hiện lại.'
        const von = await giaVonHangLoat(prisma, models.map(m => ({ id: String(m.model_id), sku: m.sku || null })))
        const loi = models.map(m => soat(Number(m.giaHienTai) || 0, von.get(String(m.model_id))?.giaVon || 0, m.name || m.sku || String(m.model_id))).filter(Boolean)
        return loi.length ? `Không hiện lại: ${loi.slice(0, 5).join('; ')}${loi.length > 5 ? ` (+${loi.length - 5} phân loại)` : ''}` : null
    }
    const gia = Number(item.price_info?.[0]?.current_price ?? item.price_info?.[0]?.original_price) || 0
    const von = (await giaVonHangLoat(prisma, [{ id: itemId, localProductId: l?.localProductId || null, sku: item.item_sku || l?.sku || null }])).get(itemId)
    const r = soat(gia, von?.giaVon || 0, item.item_sku || l?.sku || itemId)
    return r ? `Không hiện lại: ${r}` : null
}
