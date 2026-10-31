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
import { uocLuongPhi, type MauPhi, type DongPhiDon } from './giaShopee'
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
            await prisma.onlineChannel.update({
                where: { id: ch.id },
                data: { accessToken: t.accessToken, refreshToken: t.refreshToken, tokenExpiresAt: new Date(Date.now() + t.expiresIn * 1000) },
            })
        } catch (e: any) {
            console.warn(`[ShopeeTuQuan] làm mới token ${ch.name} hỏng:`, e?.message || e)
        }
    }
    return svc
}

// ─── Phí sàn thật ───────────────────────────────────────────────────────────────

async function dongPhi(prisma: any, channelIds: string[]): Promise<DongPhiDon[]> {
    if (!channelIds.length) return []
    const rows: any[] = await prisma.$queryRawUnsafe(
        `SELECT (o."netRevenue" + o."platformFee")::float8 AS "giaBan", o."platformFee"::float8 AS phi
           FROM "OnlineOrder" o
          WHERE o."channelId" = ANY($1::text[]) AND o."netRevenue" > 0 AND o."platformFee" > 0
            AND ${daQuyetToanSql('o')}
            AND o."createdAt" >= NOW() - INTERVAL '90 days'
          ORDER BY o."createdAt" DESC
          LIMIT 600`,
        channelIds,
    ).catch(() => [])
    return rows.map(r => ({ giaBan: Number(r.giaBan) || 0, phi: Number(r.phi) || 0 }))
}

/**
 * Mô hình phí của gian: đo từ đơn ĐÃ ĐỐI SOÁT 90 ngày của chính gian; gian mới chưa
 * đủ đơn thì mượn số đo của các gian Shopee khác cùng store (cùng biểu phí Shopee VN,
 * sát hơn nhiều so với tỷ lệ cấu hình mặc định 6%); vẫn không có mới dùng cấu hình.
 */
export async function docMauPhi(prisma: any, ch: any): Promise<MauPhi> {
    const rieng = uocLuongPhi(await dongPhi(prisma, [ch.id]), ch.commissionRate)
    if (rieng.nguon !== 'cau-hinh-kenh') return rieng
    const khac: any[] = await prisma.onlineChannel.findMany({
        where: { platform: 'shopee', id: { not: ch.id } }, select: { id: true },
    }).catch(() => [])
    if (!khac.length) return rieng
    const muon = uocLuongPhi(await dongPhi(prisma, khac.map(c => c.id)), ch.commissionRate)
    if (muon.nguon === 'cau-hinh-kenh') return rieng
    return { ...muon, ghiChu: `Gian này chưa đủ đơn đối soát — MƯỢN số đo của các gian Shopee khác cùng cửa hàng. ${muon.ghiChu}` }
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
