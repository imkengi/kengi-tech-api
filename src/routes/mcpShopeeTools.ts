// ═══════════════════════════════════════════════════════════════════════════════
//  MCP TOOLS — AI TỰ QUẢN MỘT GIAN SHOPEE (31/10/2026)
//
//  Chủ shop: "AI tự quản lý 1 trang Shopee riêng, tự đăng sản phẩm, tính toán mức
//  giá để đăng và bán hàng". Vòng làm việc của agent:
//    shopee_shop_info → shopee_sync_listings → shopee_listing_candidates
//    → shopee_suggest_price → shopee_category_suggest → shopee_category_attributes
//    → shopee_create_listing   (đăng)
//    shopee_review_listings → shopee_update_price / shopee_toggle_listing (chăm giá)
//  Đơn về, đẩy tồn, chat khách đã có đường riêng (autoSync / dayTonLenSan / chatbot).
//
//  RÀO AN TOÀN (agent chạy khi không ai xem):
//   - Mọi giá ghi lên Shopee qua chanGiaDuoiSan: dưới giá sàn (biên tối thiểu, mặc
//     định 5%, không bao giờ < 0) là TỪ CHỐI. Thiếu giá vốn là KHÔNG đăng.
//   - Ba tool ghi ra Shopee nằm trong TOOL_NHAY_CAM — tác vụ tự động phải khai đích danh.
//   - Đăng trùng: kiểm listing của gian (localProductId / SKU / ánh xạ SKU) trước khi
//     gọi add_item; danh mục cũ quá thì cảnh báo đồng bộ lại.
// ═══════════════════════════════════════════════════════════════════════════════

import { Tool, ToolError, canhBaoCat } from '../lib/mcpTypes'
import { tinhGiaDeXuat, chanGiaDuoiSan, danhGiaGia, type ThamSoGia } from '../lib/giaShopee'
import {
    chonKenhShopee, moDichVuShopee, docMauPhi, timHangKho, lyDoKhongDangDuoc, tonBanDuoc,
    listingDaCo, taiAnh, thuTuAnh, chonKenhVanChuyen, dungThanAddItem, luuDanhMucSan, duongNganh,
    type ThuocTinhVao,
} from '../lib/shopeeTuQuan'

const num = (v: any, d: number) => (v !== undefined && v !== null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : d)
const vnd = (n: number) => `${Math.round(n).toLocaleString('vi-VN')}đ`
const NGAY = 86400_000

/** Tham số chính sách giá dùng chung cho mọi tool có tính giá. */
const THAM_SO_GIA = {
    bien_loi_nhuan: { type: 'number', description: 'Biên lãi MỤC TIÊU trên giá bán, %. Mặc định 15. Lấy theo chỉ thị chủ shop nếu có.' },
    bien_toi_thieu: { type: 'number', description: 'Biên lãi TỐI THIỂU, % (giá sàn). Mặc định 5. Không nhận số âm — không bao giờ bán lỗ.' },
    phi_dong_goi: { type: 'number', description: 'Chi phí đóng gói / vật tư mỗi đơn, VND. Mặc định 0.' },
    phi_quang_cao: { type: 'number', description: '% giá bán dành cho quảng cáo / voucher shop. Mặc định 0.' },
    lam_tron: { type: 'number', description: 'Làm tròn LÊN giá đề xuất theo bước này (VND). Mặc định 1000.' },
} as const

function chinhSachGia(a: any) {
    return {
        bienLoiNhuanPct: Math.min(Math.max(num(a?.bien_loi_nhuan, 15), 0), 80),
        bienToiThieuPct: Math.min(Math.max(num(a?.bien_toi_thieu, 5), 0), 80),
        phiDongGoi: Math.max(0, num(a?.phi_dong_goi, 0)),
        phiQuangCaoPct: Math.min(Math.max(num(a?.phi_quang_cao, 0), 0), 50),
        lamTron: Math.max(1, num(a?.lam_tron, 1000)),
    }
}

/** Giới hạn giá của Shopee cho ngành (nếu đọc được) — không đọc được thì bỏ qua, không chặn. */
async function gioiHanGia(svc: any, categoryId?: number): Promise<{ min?: number; max?: number; raw?: any }> {
    try {
        const r = await svc.getItemLimit(categoryId)
        const p = r?.price_limit || {}
        return { min: Number(p.min_limit) || undefined, max: Number(p.max_limit) || undefined, raw: r }
    } catch {
        return {}
    }
}

type VonListing = { giaVon: number; sku?: string; productId?: string; ten?: string }

/**
 * Giá vốn của MỘT đơn vị bán trên sàn cho từng listing — cùng chuỗi tra với dayTonLenSan:
 * nối sẵn → cùng SKU → ánh xạ SKU (nhân hệ số quy đổi: 1 vỉ = 10 cái) → mã đã gộp (nhân
 * mergedRate, lấy vốn mã đích). GOM LÔ: số truy vấn cố định (≤ 4) dù bao nhiêu listing —
 * pool kết nối của cửa hàng rất nhỏ, soát 300 listing mà mỗi cái 3 truy vấn là nghẽn.
 */
async function giaVonHangLoat(prisma: any, ds: { id: string; localProductId?: string | null; sku?: string | null }[]): Promise<Map<string, VonListing>> {
    const ra = new Map<string, VonListing>()
    if (!ds.length) return ra
    const thuong = (x: any) => String(x || '').trim().toLowerCase()
    const ids = [...new Set(ds.map(l => l.localProductId).filter(Boolean) as string[])]
    const skus = [...new Set(ds.map(l => thuong(l.sku)).filter(Boolean))]
    const COT = `id, sku, name, "costPrice"::float8 AS "costPrice", "mergedIntoId", COALESCE("mergedRate", 1)::float8 AS "mergedRate"`
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
        if (p) ra.set(l.id, { giaVon: (Number(p.costPrice) || 0) * rate, sku: p.sku, productId: p.id, ten: p.name })
    }
    return ra
}

export const SHOPEE_TOOLS: Tool[] = [
    {
        name: 'shopee_shop_info',
        description: 'GỌI ĐẦU TIÊN khi quản gian Shopee: các gian Shopee của store, gian đang chọn (token, số listing, lần đồng bộ danh mục cuối), MÔ HÌNH PHÍ SÀN đo từ đơn đã đối soát (dùng để tính giá), kênh vận chuyển đang bật và giới hạn đăng của gian (độ dài tên/mô tả, số ảnh, khoảng giá).',
        inputSchema: {
            type: 'object',
            properties: {
                kenh: { type: 'string', description: 'Tên / id / shop_id của gian Shopee. Bỏ trống nếu store chỉ có 1 gian.' },
            },
        },
        run: async (a, { prisma }) => {
            const ds: any[] = await prisma.onlineChannel.findMany({
                where: { platform: 'shopee' }, orderBy: { createdAt: 'asc' },
                select: { id: true, name: true, shopId: true, status: true, tokenExpiresAt: true, accessToken: true },
            })
            const cacGian = ds.map(c => ({ id: c.id, ten: c.name, shopId: c.shopId, trangThai: c.status, daUyQuyen: !!c.accessToken }))
            if (!a?.kenh && ds.length > 1) {
                return { cacGian, ghiChu: `Store có ${ds.length} gian Shopee — gọi lại kèm kenh để xem chi tiết một gian.` }
            }
            const ch = await chonKenhShopee(prisma, a?.kenh)
            const svc = await moDichVuShopee(prisma, ch)
            const [soListing, moiNhat, mauPhi] = await Promise.all([
                prisma.onlineProduct.count({ where: { channelId: ch.id } }),
                prisma.onlineProduct.findFirst({ where: { channelId: ch.id }, orderBy: { syncedAt: 'desc' }, select: { syncedAt: true } }),
                docMauPhi(prisma, ch),
            ])
            let vanChuyen: any = null, gioiHan: any = null
            try {
                vanChuyen = (await svc.getLogisticsChannels())
                    .filter((c: any) => c.enabled !== false)
                    .map((c: any) => ({
                        id: c.logistics_channel_id, ten: c.logistics_channel_name, cod: !!c.cod_enabled,
                        kieuPhi: c.fee_type, kenhGop: Number(c.mask_channel_id) || 0,
                        canToiDaKg: c.weight_limit?.item_max_weight,
                    }))
            } catch (e: any) { vanChuyen = { loi: String(e?.message || e).slice(0, 300) } }
            try {
                const r = await svc.getItemLimit()
                gioiHan = {
                    gia: r.price_limit, tenSanPham: r.item_name_length_limit, moTa: r.item_description_length_limit,
                    soAnh: r.item_image_count_limit, soSanPhamToiDa: r.item_count_limit,
                }
            } catch (e: any) { gioiHan = { loi: String(e?.message || e).slice(0, 300) } }
            const tuoiDanhMuc = moiNhat?.syncedAt ? Math.floor((Date.now() - new Date(moiNhat.syncedAt).getTime()) / NGAY) : null
            return {
                gian: { id: ch.id, ten: ch.name, shopId: ch.shopId, link: `https://shopee.vn/shop/${ch.shopId}`, tokenHetHan: ch.tokenExpiresAt },
                listing: { soDong: soListing, dongBoCuoi: moiNhat?.syncedAt || null },
                ...(soListing === 0 || tuoiDanhMuc === null || tuoiDanhMuc > 2
                    ? { canhBaoDanhMuc: 'Danh mục listing của gian chưa đồng bộ gần đây — gọi shopee_sync_listings TRƯỚC khi đăng, nếu không có thể đăng TRÙNG sản phẩm đã có.' }
                    : {}),
                mauPhi: { tyLePct: Math.round(mauPhi.tyLe * 10000) / 100, coDinhMoiDon: mauPhi.coDinh, nguon: mauPhi.nguon, soDon: mauPhi.soDon, ghiChu: mauPhi.ghiChu },
                vanChuyen,
                gioiHanDang: gioiHan,
                cacGian,
            }
        },
    },
    {
        name: 'shopee_sync_listings',
        description: 'Kéo lại toàn bộ sản phẩm ĐANG BÁN của gian Shopee về hệ thống (giá, tồn, SKU) — cùng việc với nút Đồng bộ trên web. Gọi trước khi tìm hàng để đăng (tránh đăng trùng) và trước khi soát giá. Chỉ ghi vào dữ liệu nội bộ, không đổi gì trên Shopee.',
        write: true,
        inputSchema: {
            type: 'object',
            properties: { kenh: { type: 'string', description: 'Tên / id / shop_id gian Shopee' } },
        },
        run: async (a, { prisma }) => {
            const ch = await chonKenhShopee(prisma, a?.kenh)
            const svc = await moDichVuShopee(prisma, ch)
            const { products } = await svc.fetchProducts()
            const n = await luuDanhMucSan(prisma, ch, products)
            return { gian: ch.name, daDongBo: n, ghiChu: 'Chỉ kéo sản phẩm trạng thái NORMAL (đang bán); sản phẩm đã ẩn không có trong danh sách.' }
        },
    },
    {
        name: 'shopee_listing_candidates',
        description: 'Hàng trong kho CHƯA có trên gian Shopee và còn tồn — ứng viên để đăng. Mỗi dòng kèm giá vốn, giá bán lẻ, tồn bán được, số ảnh, độ dài mô tả và danh sách THIẾU (giá vốn / ảnh / mô tả) — thiếu thì không đăng được.',
        inputSchema: {
            type: 'object',
            properties: {
                kenh: { type: 'string', description: 'Tên / id / shop_id gian Shopee' },
                query: { type: 'string', description: 'Lọc theo tên / SKU (tuỳ chọn)' },
                nhom_hang: { type: 'string', description: 'Lọc theo tên nhóm hàng trong kho (tuỳ chọn)' },
                chi_du_dieu_kien: { type: 'boolean', description: 'true = chỉ trả hàng đủ giá vốn + ảnh + mô tả. Mặc định false.' },
                limit: { type: 'number', description: 'Mặc định 20, tối đa 50' },
            },
        },
        run: async (a, { prisma }) => {
            const ch = await chonKenhShopee(prisma, a?.kenh)
            const lim = Math.min(Math.max(num(a?.limit, 20), 1), 50)
            const where: any = { productType: 'goods', mergedIntoId: null, bundleId: null }
            const q = String(a?.query || '').trim()
            if (q) where.OR = [{ name: { contains: q, mode: 'insensitive' } }, { sku: { contains: q, mode: 'insensitive' } }]
            if (a?.nhom_hang) where.category = { name: { contains: String(a.nhom_hang), mode: 'insensitive' } }

            const [listing, anhXa] = await Promise.all([
                prisma.onlineProduct.findMany({ where: { channelId: ch.id }, select: { localProductId: true, sku: true } }),
                prisma.skuMapping.findMany({ select: { platformSku: true, productId: true }, take: 20000 }).catch(() => []),
            ])
            const daCoId = new Set<string>(listing.map((l: any) => l.localProductId).filter(Boolean))
            const daCoSku = new Set<string>(listing.map((l: any) => String(l.sku || '').trim().toLowerCase()).filter(Boolean))
            for (const m of anhXa as any[]) if (daCoSku.has(String(m.platformSku || '').trim().toLowerCase())) daCoId.add(m.productId)

            const { moKhoMe, donTreoTheoSku } = await import('../lib/khoMe')
            const khoMe = await moKhoMe(prisma)
            const moKho = khoMe ? { khoMe, donTreo: await donTreoTheoSku(prisma) } : null
            if (!moKho) where.stock = { gt: 0 }

            const TRAN_QUET = 400
            const ds: any[] = await prisma.product.findMany({
                where,
                select: {
                    id: true, sku: true, name: true, costPrice: true, sellingPrice: true, stock: true, description: true,
                    category: { select: { name: true } }, _count: { select: { images: true } },
                },
                orderBy: [{ stock: 'desc' }, { updatedAt: 'desc' }],
                take: TRAN_QUET,
            })
            const ra: any[] = []
            for (const p of ds) {
                if (ra.length >= lim) break
                if (daCoId.has(p.id) || daCoSku.has(String(p.sku).toLowerCase())) continue
                const ton = await tonBanDuoc(prisma, p, moKho)
                if (ton.ton <= 0) continue
                const doDaiMoTa = String(p.description || '').trim().length
                const thieu: string[] = []
                if (!(p.costPrice > 0)) thieu.push('giá vốn')
                if (!p._count.images) thieu.push('ảnh')
                if (doDaiMoTa < 50) thieu.push('mô tả (AI có thể tự viết từ thông tin thật)')
                if (a?.chi_du_dieu_kien && thieu.some(t => t !== 'mô tả (AI có thể tự viết từ thông tin thật)')) continue
                ra.push({
                    sku: p.sku, ten: p.name, nhomHang: p.category?.name,
                    giaVon: p.costPrice, giaBanLe: p.sellingPrice, tonBanDuoc: ton.ton, nguonTon: ton.nguon,
                    soAnh: p._count.images, doDaiMoTa, thieu,
                })
            }
            return {
                ...(ds.length >= TRAN_QUET ? canhBaoCat(ds.length, TRAN_QUET, 'mặt hàng kho (đã quét)') : {}),
                gian: ch.name, soListingDaCo: listing.length,
                ...(listing.length === 0 ? { canhBaoDanhMuc: 'Gian chưa có listing nào trong hệ thống — nếu gian đã có sản phẩm trên Shopee, gọi shopee_sync_listings trước để tránh đăng trùng.' } : {}),
                ungVien: ra,
            }
        },
    },
    {
        name: 'shopee_suggest_price',
        description: 'TÍNH GIÁ ĐĂNG Shopee cho một mặt hàng: giá đề xuất (đạt biên lãi mục tiêu sau phí sàn thật của gian), GIÁ SÀN (biên tối thiểu — tool ghi giá sẽ từ chối dưới mức này), giá hoà vốn, lãi dự kiến; kèm giá bán lẻ trong kho và giá đang bán ở các gian/sàn khác để đối chiếu. Truyền gia_thu để xem lãi của một mức giá cụ thể.',
        inputSchema: {
            type: 'object',
            properties: {
                sku: { type: 'string', description: 'SKU hàng trong kho' },
                kenh: { type: 'string', description: 'Tên / id / shop_id gian Shopee' },
                gia_thu: { type: 'number', description: 'Một mức giá muốn thử (VND) — trả lãi/biên của đúng mức này' },
                category_id: { type: 'number', description: 'Ngành Shopee (nếu đã biết) để áp giới hạn giá của ngành' },
                ...THAM_SO_GIA,
            },
            required: ['sku'],
        },
        run: async (a, { prisma }) => {
            const ch = await chonKenhShopee(prisma, a?.kenh)
            const p = await timHangKho(prisma, a.sku)
            const cs = chinhSachGia(a)
            const mauPhi = await docMauPhi(prisma, ch)
            let gh: { min?: number; max?: number } = {}
            if (a?.category_id) gh = await gioiHanGia(await moDichVuShopee(prisma, ch), num(a.category_id, 0))
            const ts: ThamSoGia = { giaVon: Number(p.costPrice) || 0, phi: mauPhi, ...cs, giaShopeeMin: gh.min, giaShopeeMax: gh.max }
            const kq = tinhGiaDeXuat(ts)
            const khac: any[] = await prisma.onlineProduct.findMany({
                where: { OR: [{ localProductId: p.id }, { sku: { equals: p.sku, mode: 'insensitive' } }] },
                select: { platform: true, price: true, status: true, channel: { select: { name: true } }, channelId: true },
                take: 20,
            })
            return {
                sanPham: { sku: p.sku, ten: p.name, giaVon: p.costPrice, giaBanLe: p.sellingPrice },
                ...kq,
                giaThu: a?.gia_thu ? { ...danhGiaGia(num(a.gia_thu, 0), ts), biChan: chanGiaDuoiSan(num(a.gia_thu, 0), kq) } : undefined,
                mauPhi: { tyLePct: Math.round(mauPhi.tyLe * 10000) / 100, coDinhMoiDon: mauPhi.coDinh, nguon: mauPhi.nguon, ghiChu: mauPhi.ghiChu },
                giaDangBanNoiKhac: khac.map(k => ({ gian: k.channel?.name, san: k.platform, gia: k.price, trangThai: k.status, laGianNay: k.channelId === ch.id })),
                ghiChu: 'Lãi tính cho đơn 1 sản phẩm (phí cố định/đơn gánh trọn) — đơn nhiều món lãi cao hơn. Không gồm phí vận chuyển người mua trả.',
            }
        },
    },
    {
        name: 'shopee_category_suggest',
        description: 'Tìm NGÀNH HÀNG Shopee (category_id lá) cho một sản phẩm: Shopee gợi ý theo tên, và/hoặc tìm trong cây ngành theo từ khoá. Trả đường ngành đầy đủ để chọn đúng.',
        inputSchema: {
            type: 'object',
            properties: {
                ten: { type: 'string', description: 'Tên sản phẩm (để Shopee gợi ý ngành)' },
                tu_khoa: { type: 'string', description: 'Từ khoá tìm trong cây ngành, vd "ổ cắm" (tuỳ chọn)' },
                kenh: { type: 'string', description: 'Tên / id / shop_id gian Shopee' },
            },
        },
        run: async (a, { prisma }) => {
            if (!a?.ten && !a?.tu_khoa) throw new ToolError('Truyền ten hoặc tu_khoa')
            const ch = await chonKenhShopee(prisma, a?.kenh)
            const svc = await moDichVuShopee(prisma, ch)
            const cay = await svc.getCategories('vi')
            const la = new Map(cay.map(c => [c.id, c]))
            let goiY: any[] = []
            let loiGoiY: string | undefined
            if (a?.ten) {
                try {
                    goiY = (await svc.categoryRecommend(String(a.ten))).map(id => ({
                        categoryId: id, duong: duongNganh(cay, id), laNganhLa: la.has(id) ? !la.get(id)!.coCon : null,
                    }))
                } catch (e: any) { loiGoiY = String(e?.message || e).slice(0, 300) }
            }
            let timThay: any[] = []
            if (a?.tu_khoa) {
                const tk = String(a.tu_khoa).toLowerCase()
                timThay = cay.filter(c => !c.coCon)
                    .map(c => ({ categoryId: c.id, duong: duongNganh(cay, c.id) }))
                    .filter(c => c.duong.toLowerCase().includes(tk))
                    .slice(0, 15)
            }
            return {
                goiYCuaShopee: goiY, ...(loiGoiY ? { loiGoiY } : {}),
                timTrongCayNganh: timThay,
                ghiChu: 'add_item chỉ nhận ngành LÁ (không còn ngành con). Chọn xong gọi shopee_category_attributes để lấy thuộc tính bắt buộc.',
            }
        },
    },
    {
        name: 'shopee_category_attributes',
        description: 'Thuộc tính của một ngành Shopee (thuộc tính BẮT BUỘC kèm danh sách giá trị có sẵn), thương hiệu (ngành có bắt buộc không, tìm brand_id theo tên) và giới hạn giá/tên/mô tả của ngành. Gọi trước shopee_create_listing.',
        inputSchema: {
            type: 'object',
            properties: {
                category_id: { type: 'number', description: 'Ngành lá từ shopee_category_suggest' },
                tim_thuong_hieu: { type: 'string', description: 'Tên thương hiệu cần tìm brand_id (tuỳ chọn)' },
                day_du: { type: 'boolean', description: 'true = trả cả giá trị của thuộc tính KHÔNG bắt buộc. Mặc định false.' },
                kenh: { type: 'string', description: 'Tên / id / shop_id gian Shopee' },
            },
            required: ['category_id'],
        },
        run: async (a, { prisma }) => {
            const categoryId = num(a?.category_id, 0)
            if (!(categoryId > 0)) throw new ToolError('category_id không hợp lệ')
            const ch = await chonKenhShopee(prisma, a?.kenh)
            const svc = await moDichVuShopee(prisma, ch)
            const tt = await svc.getCategoryAttributes(categoryId, 'vi')
            const batBuoc = tt.filter(t => t.batBuoc)
            const khong = tt.filter(t => !t.batBuoc)
            let thuongHieu: any
            try { thuongHieu = await svc.getBrandList(categoryId, a?.tim_thuong_hieu) }
            catch (e: any) { thuongHieu = { loi: String(e?.message || e).slice(0, 300) } }
            const gh = await gioiHanGia(svc, categoryId)
            return {
                categoryId,
                thuocTinhBatBuoc: batBuoc,
                thuocTinhTuyChon: a?.day_du ? khong : khong.map(t => ({ attributeId: t.attributeId, ten: t.ten, kieuNhap: t.kieuNhap, soGiaTri: t.soGiaTri })),
                thuongHieu,
                gioiHan: gh.raw ? { gia: gh.raw.price_limit, tenSanPham: gh.raw.item_name_length_limit, moTa: gh.raw.item_description_length_limit, soAnh: gh.raw.item_image_count_limit } : null,
                cachDien: 'Truyền vào shopee_create_listing.thuoc_tinh: chọn giá trị có sẵn thì {attribute_id, value_id}; kiểu go_tu_do / *_hoac_go thì {attribute_id, gia_tri, don_vi?}. ' +
                    'Giá trị PHẢI đúng với sản phẩm thật (lấy từ tên, mô tả, chỉ thị chủ shop) — không chắc thì đừng khai thuộc tính tuỳ chọn. ' +
                    'Ngành không bắt buộc thương hiệu thì bỏ trống brand_id (đăng "No brand").',
            }
        },
    },
    {
        name: 'shopee_create_listing',
        description: 'ĐĂNG SẢN PHẨM MỚI lên gian Shopee từ một mặt hàng trong kho: tự nạp ảnh sản phẩm, khai tồn bán được, SKU kho (đơn về tự khớp kho), kênh vận chuyển đang bật. ' +
            'Bỏ trống gia = dùng giá đề xuất; giá dưới GIÁ SÀN bị từ chối. Hàng thiếu giá vốn / ảnh / hết hàng / đã có trên gian bị từ chối. ' +
            'can_nang_gram BẮT BUỘC và phải là cân nặng thật (đã đóng gói) — không biết thì KHÔNG đăng, ghi vào báo cáo. chay_thu=true để xem trước thân yêu cầu mà không đăng.',
        write: true,
        inputSchema: {
            type: 'object',
            properties: {
                sku: { type: 'string', description: 'SKU hàng trong kho' },
                category_id: { type: 'number', description: 'Ngành LÁ từ shopee_category_suggest' },
                can_nang_gram: { type: 'number', description: 'Cân nặng đã đóng gói (gram) — số thật, không đoán' },
                kenh: { type: 'string', description: 'Tên / id / shop_id gian Shopee' },
                gia: { type: 'number', description: 'Giá đăng (VND). Bỏ trống = giá đề xuất theo biên mục tiêu' },
                ten: { type: 'string', description: 'Tên hiển thị trên Shopee (mặc định tên trong kho). Viết rõ loại hàng + đặc điểm thật, không nhồi từ khoá' },
                mo_ta: { type: 'string', description: 'Mô tả (mặc định mô tả trong kho). Chỉ viết từ thông tin THẬT của sản phẩm — không bịa thông số, bảo hành, xuất xứ' },
                thuoc_tinh: {
                    type: 'array',
                    description: 'Thuộc tính ngành (xem shopee_category_attributes)',
                    items: {
                        type: 'object',
                        properties: {
                            attribute_id: { type: 'number' },
                            value_id: { type: 'number', description: 'Giá trị có sẵn' },
                            gia_tri: { type: 'string', description: 'Giá trị gõ tay (khi không có value_id)' },
                            don_vi: { type: 'string' },
                        },
                        required: ['attribute_id'],
                    },
                },
                brand_id: { type: 'number', description: 'brand_id từ shopee_category_attributes; bỏ trống = No brand' },
                ten_thuong_hieu: { type: 'string', description: 'Tên thương hiệu đi kèm brand_id' },
                dai_cm: { type: 'number' }, rong_cm: { type: 'number' }, cao_cm: { type: 'number' },
                kenh_van_chuyen: { type: 'array', items: { type: 'number' }, description: 'logistics_channel_id muốn bật (mặc định: mọi kênh phù hợp đang bật)' },
                so_luong_dang: { type: 'number', description: 'Giới hạn số tồn khai lên (mặc định = tồn bán được)' },
                an_sau_khi_dang: { type: 'boolean', description: 'true = đăng ở trạng thái ẨN để chủ shop duyệt rồi mới hiện' },
                chay_thu: { type: 'boolean', description: 'true = chỉ dựng và trả thân yêu cầu + phân tích giá, KHÔNG nạp ảnh, KHÔNG đăng' },
                ...THAM_SO_GIA,
            },
            required: ['sku', 'category_id', 'can_nang_gram'],
        },
        run: async (a, { prisma }) => {
            const chayThu = a?.chay_thu === true
            const ch = await chonKenhShopee(prisma, a?.kenh)
            const p = await timHangKho(prisma, a.sku)
            const khongDuoc = lyDoKhongDangDuoc(p)
            if (khongDuoc) throw new ToolError(`Không đăng ${p.sku}: ${khongDuoc}`)

            const trung = await listingDaCo(prisma, ch.id, p)
            if (trung) throw new ToolError(`${p.sku} ĐÃ CÓ trên gian "${ch.name}" (item_id ${trung.platformProductId}, giá ${vnd(trung.price)}) — dùng shopee_update_price nếu muốn đổi giá.`)

            const categoryId = num(a.category_id, 0)
            if (!(categoryId > 0)) throw new ToolError('category_id không hợp lệ')
            const canNangKg = num(a.can_nang_gram, 0) / 1000
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
            if (ten.length > tenMax) throw new ToolError(`Tên dài ${ten.length} ký tự, Shopee cho tối đa ${tenMax} — rút gọn rồi truyền ten.`)
            if (ten.length < tenMin) throw new ToolError(`Tên ngắn ${ten.length} ký tự, Shopee đòi tối thiểu ${tenMin} — viết đầy đủ hơn rồi truyền ten.`)
            const moTa = String(a?.mo_ta || p.description || '').trim()
            const moTaMin = Number(gh.raw?.item_description_length_limit?.min_limit) || 0
            const moTaMax = Number(gh.raw?.item_description_length_limit?.max_limit) || 3000
            if (!moTa) throw new ToolError(`${p.sku} chưa có mô tả — viết mô tả từ thông tin thật rồi truyền mo_ta.`)
            if (moTa.length < moTaMin) throw new ToolError(`Mô tả ${moTa.length} ký tự, Shopee đòi tối thiểu ${moTaMin} — viết thêm (chỉ thông tin thật) rồi truyền mo_ta.`)
            if (moTa.length > moTaMax) throw new ToolError(`Mô tả ${moTa.length} ký tự, Shopee cho tối đa ${moTaMax} — rút gọn rồi truyền mo_ta.`)

            const anh = thuTuAnh(p.images || [])
            if (!anh.length) throw new ToolError(`${p.sku} chưa có ảnh — tải ảnh ở mục Thông tin sản phẩm trước.`)

            const vc = chonKenhVanChuyen(await svc.getLogisticsChannels(), canNangKg, Array.isArray(a?.kenh_van_chuyen) ? a.kenh_van_chuyen : undefined)
            if (!vc.ids.length) throw new ToolError(`Không có kênh vận chuyển phù hợp đang bật cho ${Math.round(canNangKg * 1000)}g. ${vc.ghiChu.join('; ')} — xem shopee_shop_info.vanChuyen rồi truyền kenh_van_chuyen.`)

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

            const kqDang = await svc.addItem(dungThanAddItem(dauVao))
            await prisma.onlineProduct.upsert({
                where: { channelId_platformProductId: { channelId: ch.id, platformProductId: kqDang.itemId } },
                create: {
                    channelId: ch.id, platform: 'shopee', platformProductId: kqDang.itemId,
                    name: ten, sku: p.sku, price: gia, stock: tonDang,
                    status: dauVao.an ? 'UNLIST' : 'NORMAL', imageUrl: anh[0], categoryId: String(categoryId),
                    localProductId: p.id, syncedAt: new Date(),
                },
                update: { name: ten, sku: p.sku, price: gia, stock: tonDang, localProductId: p.id, syncedAt: new Date() },
            }).catch((e: any) => console.error('[shopee_create_listing] ghi OnlineProduct hỏng:', e?.message || e))
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
        },
    },
    {
        name: 'shopee_review_listings',
        description: 'SOÁT GIÁ các sản phẩm đang bán trên gian: giá hiện tại vs giá vốn → lãi/biên mỗi đơn, cờ DƯỚI GIÁ SÀN / dưới biên mục tiêu, giá đề xuất, số bán 14 ngày qua và tồn. Dùng để quyết tăng/giảm giá hoặc ẩn sản phẩm.',
        inputSchema: {
            type: 'object',
            properties: {
                kenh: { type: 'string', description: 'Tên / id / shop_id gian Shopee' },
                chi_van_de: { type: 'boolean', description: 'true = chỉ trả sản phẩm có vấn đề (dưới sàn, dưới mục tiêu, thiếu giá vốn, không bán được). Mặc định true.' },
                limit: { type: 'number', description: 'Mặc định 30, tối đa 100' },
                ...THAM_SO_GIA,
            },
        },
        run: async (a, { prisma }) => {
            const ch = await chonKenhShopee(prisma, a?.kenh)
            const lim = Math.min(Math.max(num(a?.limit, 30), 1), 100)
            const chiVanDe = a?.chi_van_de !== false
            const cs = chinhSachGia(a)
            const mauPhi = await docMauPhi(prisma, ch)
            const TRAN = 300
            const ds: any[] = await prisma.onlineProduct.findMany({
                where: { channelId: ch.id, status: 'NORMAL' },
                orderBy: { updatedAt: 'desc' },
                take: TRAN,
            })
            const ban: any[] = await prisma.$queryRawUnsafe(
                `SELECT LOWER(i.sku) AS sku, SUM(i.quantity)::int AS sl
                   FROM "OnlineOrderItem" i JOIN "OnlineOrder" o ON o.id = i."onlineOrderId"
                  WHERE o."channelId" = $1 AND o."createdAt" >= NOW() - INTERVAL '14 days'
                    AND o.status NOT IN ('CANCELLED','IN_CANCEL','UNPAID','cancelled','cancelling')
                    AND i.sku IS NOT NULL
                  GROUP BY 1`, ch.id,
            ).catch(() => [])
            const daBan = new Map<string, number>(ban.map(b => [String(b.sku), Number(b.sl) || 0]))

            const von = await giaVonHangLoat(prisma, ds)
            const ra: any[] = []
            let duoiSan = 0, thieuVon = 0
            for (const l of ds) {
                const daBan14 = daBan.get(String(l.sku || '').toLowerCase()) || 0
                if (!(l.price > 0)) {
                    if (!chiVanDe && ra.length < lim) ra.push({ itemId: l.platformProductId, sku: l.sku, ten: l.name, ghiChu: 'Có phân loại / chưa đọc được giá — soát ở trang Shopee' })
                    continue
                }
                const v = von.get(l.id)
                if (!v || !(v.giaVon > 0)) {
                    thieuVon++
                    if (ra.length < lim) ra.push({ itemId: l.platformProductId, sku: l.sku, ten: l.name, gia: l.price, tonSan: l.stock, daBan14, vanDe: ['thiếu giá vốn — không biết lãi/lỗ'] })
                    continue
                }
                const ts: ThamSoGia = { giaVon: v.giaVon, phi: mauPhi, ...cs }
                const kq = tinhGiaDeXuat(ts)
                const hien = danhGiaGia(l.price, ts)
                const vanDe: string[] = []
                if (kq.giaSan > 0 && l.price < kq.giaSan) { vanDe.push('DƯỚI GIÁ SÀN'); duoiSan++ }
                else if (hien.bienPct < cs.bienLoiNhuanPct) vanDe.push('dưới biên mục tiêu')
                if (daBan14 === 0 && l.stock > 0) vanDe.push('14 ngày không bán được')
                if ((chiVanDe && !vanDe.length) || ra.length >= lim) continue
                ra.push({
                    itemId: l.platformProductId, sku: l.sku, ten: l.name, gia: l.price, tonSan: l.stock, daBan14,
                    giaVon: Math.round(v.giaVon), laiMoiDon: hien.loiNhuan, bienPct: hien.bienPct,
                    giaSan: kq.giaSan, giaDeXuat: kq.hopLe ? kq.giaDeXuat : null, vanDe,
                })
            }
            return {
                ...canhBaoCat(ds.length, TRAN, 'listing'),
                gian: ch.name, soListingDangBan: ds.length, duoiGiaSan: duoiSan, thieuGiaVon: thieuVon,
                ...(ra.length >= lim ? { ghiChuDanhSach: `Chỉ liệt kê ${lim} dòng đầu; hai con số duoiGiaSan / thieuGiaVon tính trên toàn bộ ${ds.length} listing đã đọc.` } : {}),
                mauPhi: mauPhi.ghiChu, chinhSach: cs,
                ghiChu: 'Số bán 14 ngày đếm từ đơn còn trong hệ thống (đơn hoàn tất cũ bị dọn sau ~18 ngày). Giảm giá chỉ khi còn trên giá sàn; tăng giá hàng bán chạy dưới mục tiêu trước.',
                sanPham: ra,
            }
        },
    },
    {
        name: 'shopee_update_price',
        description: 'ĐỔI GIÁ một sản phẩm đang bán trên gian Shopee (theo item_id hoặc sku). Giá mới dưới GIÁ SÀN (biên tối thiểu sau phí sàn) hoặc sản phẩm thiếu giá vốn sẽ bị TỪ CHỐI. Hàng có phân loại chỉ đổi được khi đúng MỘT phân loại mang SKU đó.',
        write: true,
        inputSchema: {
            type: 'object',
            properties: {
                gia_moi: { type: 'number', description: 'Giá mới (VND)' },
                item_id: { type: 'string', description: 'item_id Shopee (từ shopee_review_listings)' },
                sku: { type: 'string', description: 'SKU (khi không có item_id)' },
                kenh: { type: 'string', description: 'Tên / id / shop_id gian Shopee' },
                ly_do: { type: 'string', description: 'Lý do đổi giá (ghi vào nhật ký)' },
                bien_toi_thieu: THAM_SO_GIA.bien_toi_thieu,
                phi_dong_goi: THAM_SO_GIA.phi_dong_goi,
                phi_quang_cao: THAM_SO_GIA.phi_quang_cao,
            },
            required: ['gia_moi'],
        },
        run: async (a, { prisma }) => {
            const ch = await chonKenhShopee(prisma, a?.kenh)
            const giaMoi = Math.round(num(a?.gia_moi, 0))
            if (!(giaMoi > 0)) throw new ToolError('gia_moi không hợp lệ')
            let l: any = null
            if (a?.item_id) l = await prisma.onlineProduct.findFirst({ where: { channelId: ch.id, platformProductId: String(a.item_id) } })
            else if (a?.sku) l = await prisma.onlineProduct.findFirst({ where: { channelId: ch.id, sku: { equals: String(a.sku), mode: 'insensitive' } } })
            else throw new ToolError('Truyền item_id hoặc sku')
            if (!l) throw new ToolError('Không thấy sản phẩm này trên gian (gọi shopee_sync_listings nếu vừa đăng ngoài hệ thống)')

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
        },
    },
    {
        name: 'shopee_toggle_listing',
        description: 'ẨN (an=true) hoặc HIỆN LẠI (an=false) một sản phẩm trên gian Shopee — vd hết hàng lâu, hoặc giá đang lỗ chờ chủ shop xem.',
        write: true,
        inputSchema: {
            type: 'object',
            properties: {
                item_id: { type: 'string', description: 'item_id Shopee' },
                an: { type: 'boolean', description: 'true = ẩn, false = hiện lại' },
                kenh: { type: 'string', description: 'Tên / id / shop_id gian Shopee' },
                ly_do: { type: 'string', description: 'Lý do (ghi vào nhật ký)' },
            },
            required: ['item_id', 'an'],
        },
        run: async (a, { prisma }) => {
            const ch = await chonKenhShopee(prisma, a?.kenh)
            const itemId = String(a?.item_id || '').trim()
            if (!/^\d+$/.test(itemId)) throw new ToolError('item_id không hợp lệ')
            const an = a?.an === true
            const svc = await moDichVuShopee(prisma, ch)
            await svc.unlistItem(itemId, an)
            await prisma.onlineProduct.updateMany({ where: { channelId: ch.id, platformProductId: itemId }, data: { status: an ? 'UNLIST' : 'NORMAL' } }).catch(() => { })
            console.log(`[ShopeeTuQuan] ${an ? 'ẨN' : 'HIỆN'} ${ch.name} item ${itemId}${a?.ly_do ? ` — ${String(a.ly_do).slice(0, 200)}` : ''}`)
            return { daDoi: true, itemId, trangThai: an ? 'ĐÃ ẨN' : 'ĐANG BÁN' }
        },
    },
]

/** Tool ghi ra Shopee — tác vụ tự động phải khai đích danh (thêm vào TOOL_NHAY_CAM). */
export const SHOPEE_TOOL_NHAY_CAM = ['shopee_create_listing', 'shopee_update_price', 'shopee_toggle_listing'] as const
