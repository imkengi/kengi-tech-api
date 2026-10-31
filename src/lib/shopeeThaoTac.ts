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
import { tinhGiaDeXuat, chanGiaDuoiSan, danhGiaGia, type ThamSoGia } from './giaShopee'
import {
    chonKenhShopee, moDichVuShopee, docMauPhi, timHangKho, lyDoKhongDangDuoc, tonBanDuoc,
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
    lamTron: number
}

/** Tham số chính sách giá kiểu tool (bien_loi_nhuan…) → chuẩn. Mặc định: mục tiêu 15%, sàn 5%. */
export function chinhSachGia(a: any): ChinhSachGia {
    return {
        bienLoiNhuanPct: Math.min(Math.max(num(a?.bien_loi_nhuan, 15), 0), 80),
        bienToiThieuPct: Math.min(Math.max(num(a?.bien_toi_thieu, 5), 0), 80),
        phiDongGoi: Math.max(0, num(a?.phi_dong_goi, 0)),
        phiQuangCaoPct: Math.min(Math.max(num(a?.phi_quang_cao, 0), 0), 50),
        lamTron: Math.max(1, num(a?.lam_tron, 1000)),
    }
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
export async function soBan14Ngay(prisma: any, channelId: string): Promise<Map<string, number>> {
    const ban: any[] = await prisma.$queryRawUnsafe(
        `SELECT LOWER(i.sku) AS sku, SUM(i.quantity)::int AS sl
           FROM "OnlineOrderItem" i JOIN "OnlineOrder" o ON o.id = i."onlineOrderId"
          WHERE o."channelId" = $1 AND o."createdAt" >= NOW() - INTERVAL '14 days'
            AND o.status NOT IN ('CANCELLED','IN_CANCEL','UNPAID','cancelled','cancelling')
            AND i.sku IS NOT NULL
          GROUP BY 1`, channelId,
    ).catch(() => [])
    return new Map<string, number>(ban.map(b => [String(b.sku), Number(b.sl) || 0]))
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
export async function dangSanPhamShopee(prisma: any, a: any, tuyChon: { ch?: any } = {}): Promise<any> {
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

    const svc = await moDichVuShopee(prisma, ch)
    const cs = chinhSachGia(a)
    const [mauPhi, gh] = await Promise.all([docMauPhi(prisma, ch), gioiHanGia(svc, categoryId)])
    const ts: ThamSoGia = { giaVon: Number(p.costPrice) || 0, phi: mauPhi, ...cs, giaShopeeMin: gh.min, giaShopeeMax: gh.max }
    const kq = tinhGiaDeXuat(ts)
    if (!kq.hopLe && !a?.gia) throw new ToolError(`Không tính được giá cho ${p.sku}: ${kq.lyDo}`)
    const gia = a?.gia ? num(a.gia, 0) : kq.giaDeXuat
    const chan = chanGiaDuoiSan(gia, kq)
    if (chan) throw new ToolError(`${p.sku}: ${chan}`)
    if (gh.min && gia < gh.min) throw new ToolError(`Giá ${vnd(gia)} dưới mức tối thiểu Shopee cho ngành (${vnd(gh.min)})`)
    if (gh.max && gia > gh.max) throw new ToolError(`Giá ${vnd(gia)} vượt mức tối đa Shopee cho ngành (${vnd(gh.max)})`)

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
    const phanTichGia = { gia, giaDeXuat: kq.giaDeXuat, giaSan: kq.giaSan, giaHoaVon: kq.giaHoaVon, duKien: danhGiaGia(gia, ts), mauPhi: mauPhi.ghiChu }

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

/** Tìm listing của gian theo item_id hoặc sku. */
export async function timListing(prisma: any, channelId: string, a: { item_id?: any; sku?: any }): Promise<any> {
    let l: any = null
    if (a?.item_id) l = await prisma.onlineProduct.findFirst({ where: { channelId, platformProductId: String(a.item_id) } })
    else if (a?.sku) l = await prisma.onlineProduct.findFirst({ where: { channelId, sku: { equals: String(a.sku), mode: 'insensitive' } } })
    else throw new ToolError('Truyền item_id hoặc sku')
    if (!l) throw new ToolError('Không thấy sản phẩm này trên gian (đồng bộ danh sách sản phẩm nếu vừa đăng ngoài hệ thống)')
    return l
}

/** Đổi giá MỘT listing (tham số theo tên của tool shopee_update_price). Dưới giá sàn / thiếu vốn ⇒ từ chối. */
export async function doiGiaShopee(prisma: any, a: any, tuyChon: { ch?: any } = {}): Promise<any> {
    const ch = tuyChon.ch || await chonKenhShopee(prisma, a?.kenh)
    const giaMoi = Math.round(num(a?.gia_moi, 0))
    if (!(giaMoi > 0)) throw new ToolError('gia_moi không hợp lệ')
    const l = await timListing(prisma, ch.id, a)

    const v = (await giaVonHangLoat(prisma, [l])).get(l.id)
    if (!v || !(v.giaVon > 0)) throw new ToolError(`${l.sku || l.platformProductId} thiếu giá vốn — không đổi giá khi không biết lãi/lỗ.`)
    const cs = chinhSachGia(a)
    const mauPhi = await docMauPhi(prisma, ch)
    const ts: ThamSoGia = { giaVon: v.giaVon, phi: mauPhi, ...cs }
    const kq = tinhGiaDeXuat(ts)
    const chan = chanGiaDuoiSan(giaMoi, kq)
    if (chan) throw new ToolError(`${l.sku || l.platformProductId}: ${chan}`)

    const svc = await moDichVuShopee(prisma, ch)
    let modelId: number | undefined
    try {
        await svc.updatePrice(l.platformProductId, giaMoi)
    } catch (e: any) {
        if (!/model_id is mandatory|under model level/i.test(String(e?.message || ''))) throw e
        const models = await svc.getModelList(Number(l.platformProductId))
        const khop = models.filter(m => String(m.sku || '').trim().toLowerCase() === String(v.sku || l.sku || '').trim().toLowerCase())
        if (khop.length !== 1) throw new ToolError(`Sản phẩm có ${models.length} phân loại, ${khop.length} cái mang SKU "${v.sku || l.sku}" — không đoán, đổi giá tay trên Shopee.`)
        modelId = khop[0]!.model_id
        await svc.updatePrice(l.platformProductId, giaMoi, modelId)
    }
    const giaCu = Number(l.price) || 0
    await prisma.onlineProduct.update({ where: { id: l.id }, data: { price: giaMoi } }).catch(() => { })
    console.log(`[ShopeeTuQuan] ĐỔI GIÁ ${l.sku} (${ch.name} item ${l.platformProductId}) ${giaCu} → ${giaMoi}${a?.ly_do ? ` — ${String(a.ly_do).slice(0, 200)}` : ''}`)
    return {
        daDoi: true, itemId: l.platformProductId, sku: l.sku, ...(modelId ? { modelId } : {}),
        giaCu, giaMoi, truoc: danhGiaGia(giaCu, ts), sau: danhGiaGia(giaMoi, ts), giaSan: kq.giaSan,
    }
}
