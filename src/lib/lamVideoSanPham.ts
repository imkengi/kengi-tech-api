/* ═══════════════════════════════════════════════════════════════════════════════
 *  LÀM VIDEO TỪ KHO THÔNG TIN SẢN PHẨM (14/10/2026)
 *
 *  Chủ shop: "cái này sẽ lấy ngẫu nhiên từ phần mô tả sản phẩm và hình ảnh …, tạo video xong sẽ
 *  đẩy qua bên media". Máy dựng (Frame) chạy TRÊN TRÌNH DUYỆT — đây chỉ chọn sản phẩm và chuyển
 *  ảnh. Video dựng xong đi đường tải lên sẵn có của Media (Drive) như mọi video khác.
 *
 *  CHỌN NGẪU NHIÊN mà không phí công:
 *    · đủ nguyên liệu: có mô tả + ít nhất 1 ảnh ở kho Thông tin sản phẩm
 *    · bỏ mã đã gộp (chỉ là con trỏ) và dịch vụ
 *    · mặc định chỉ hàng CÒN TỒN và ĐANG CÓ listing trên sàn — video của hàng hết / hàng không bán
 *      trên sàn thì không gắn được vào sản phẩm nào, làm ra là bỏ
 *    · mã CHƯA có video xếp trước (đếm SanMediaSanPham theo SKU), trong cùng nhóm thì random()
 *
 *  ẢNH: bucket kengi-tech-assets không bật CORS ⇒ trình duyệt tải được để XEM nhưng vẽ lên canvas
 *  rồi xuất video thì bị "tainted canvas". Máy chủ chuyển byte (layAnhSanPham) — chỉ nhận host trong
 *  danh sách CDN ảnh đã biết, theo từng bước chuyển hướng, nhận dạng ảnh theo byte đầu.
 * ═══════════════════════════════════════════════════════════════════════════════ */
import { nhanDangAnh } from './anhSanPham'

export type LocChon = {
    soLuong?: number
    q?: string
    /** true (mặc định) = chỉ mã còn hàng: tồn kho mình > 0 HOẶC listing trên sàn còn tồn (kho mẹ) */
    chiConHang?: boolean
    /** true (mặc định) = chỉ mã có listing trên ít nhất một gian (OnlineProduct cùng SKU) */
    chiTrenSan?: boolean
    /** Gian đang làm video cho — có thì chỉ lấy mã đang bán ở gian này */
    channelId?: string | null
    /** Bỏ các mã vừa lấy (bấm "Đổi mã khác" không ra lại đúng mã đó) */
    boQua?: string[]
    /** 'ngau-nhien' (mặc định) | 'moi' | 'ten' */
    sapXep?: string
}

export type UngVien = {
    id: string; sku: string; ten: string; giaBan: number; ton: number; tonTrenSan: number | null
    doDaiMoTa: number; soAnh: number; anhDaiDien: string | null
    soVideo: number; soGian: number
}

/** Điều kiện chung "đủ làm video" — một chỗ, để đếm và chọn không lệch nhau. */
function dieuKien(loc: LocChon, thamSo: any[]): string {
    const w = [
        `p."mergedIntoId" IS NULL`,
        `coalesce(p."productType", 'goods') <> 'service'`,
        `coalesce(trim(p.description), '') <> ''`,
        `EXISTS (SELECT 1 FROM "ProductImage" i WHERE i."productId" = p.id)`,
    ]
    let gian = ''
    if (loc.channelId) {
        thamSo.push(String(loc.channelId))
        gian = ` AND op."channelId" = $${thamSo.length}`
        w.push(`EXISTS (SELECT 1 FROM "OnlineProduct" op WHERE op.sku = p.sku${gian})`)
    } else if (loc.chiTrenSan !== false) {
        w.push(`EXISTS (SELECT 1 FROM "OnlineProduct" op WHERE op.sku = p.sku)`)
    }
    /* CÒN HÀNG = tồn kho mình > 0 HOẶC listing trên sàn còn tồn. Cửa hàng bán sàn bằng KHO MẸ
     * (KENGISTORE mượn tồn HUTI — StoreSettings.khoMeMa) có Product.stock 0/âm trong khi sàn vẫn bán:
     * chỉ xét p.stock thì 36/174 mã (đo 14/10) và loại oan đúng hàng đang bán chạy. */
    if (loc.chiConHang !== false) w.push(`(p.stock > 0 OR EXISTS (SELECT 1 FROM "OnlineProduct" op WHERE op.sku = p.sku AND op.stock > 0${gian}))`)
    const q = String(loc.q || '').trim().slice(0, 100)
    if (q) {
        thamSo.push(`%${q.replace(/[\\%_]/g, m => '\\' + m)}%`)
        w.push(`(p.name ILIKE $${thamSo.length} OR p.sku ILIKE $${thamSo.length} OR coalesce(p.barcode, '') ILIKE $${thamSo.length})`)
    }
    const boQua = (loc.boQua || []).map(String).filter(x => /^[a-z0-9]{6,40}$/i.test(x)).slice(0, 200)
    if (boQua.length) {
        thamSo.push(boQua)
        w.push(`NOT (p.id = ANY($${thamSo.length}::text[]))`)
    }
    return w.join(' AND ')
}

/** Ứng viên làm video. POOL 1 trên prod ⇒ một câu SQL, không Promise.all. */
export async function chonSanPham(prisma: any, loc: LocChon): Promise<UngVien[]> {
    const thamSo: any[] = []
    const where = dieuKien(loc, thamSo)
    const so = Math.min(50, Math.max(1, Math.round(Number(loc.soLuong) || 1)))
    /* Bí danh cột ("soVideo") KHÔNG dùng được trong biểu thức ORDER BY của cùng tầng (42703 — đo
     * 14/10 bằng /admin/thu-lam-video) ⇒ bọc một tầng rồi mới xếp. */
    const sx = loc.sapXep === 'ten' ? `t.ten ASC`
        : loc.sapXep === 'moi' ? `t."capNhat" DESC`
        : `(t."soVideo" > 0), random()`
    const rows: any[] = await prisma.$queryRawUnsafe(
        `SELECT * FROM (
            SELECT p.id, p.sku, p.name AS ten, p."sellingPrice" AS "giaBan", p.stock AS ton, p."updatedAt" AS "capNhat",
                   length(trim(p.description))::int AS "doDaiMoTa",
                   (SELECT count(*)::int FROM "ProductImage" i WHERE i."productId" = p.id) AS "soAnh",
                   (SELECT i.url FROM "ProductImage" i WHERE i."productId" = p.id ORDER BY i."isPrimary" DESC, i.id ASC LIMIT 1) AS "anhDaiDien",
                   (SELECT count(*)::int FROM "SanMediaSanPham" s WHERE s.sku = p.sku) AS "soVideo",
                   (SELECT count(DISTINCT op."channelId")::int FROM "OnlineProduct" op WHERE op.sku = p.sku) AS "soGian",
                   (SELECT max(op.stock)::int FROM "OnlineProduct" op WHERE op.sku = p.sku) AS "tonTrenSan"
              FROM "Product" p
             WHERE ${where}
         ) t
         ORDER BY ${sx}
         LIMIT ${so}`, ...thamSo)
    return rows.map(r => ({ ...r, capNhat: undefined, giaBan: Number(r.giaBan) || 0, ton: Number(r.ton) || 0 }))
}

/** Đếm kho: bao nhiêu mã đủ làm video theo bộ lọc, bao nhiêu chưa có video — để giao diện nói thật. */
export async function demKho(prisma: any, loc: LocChon): Promise<{ du: number; chuaCoVideo: number }> {
    const thamSo: any[] = []
    const where = dieuKien(loc, thamSo)
    const r: any[] = await prisma.$queryRawUnsafe(
        `SELECT count(*)::int AS du,
                count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM "SanMediaSanPham" s WHERE s.sku = p.sku))::int AS "chuaCoVideo"
           FROM "Product" p WHERE ${where}`, ...thamSo)
    return { du: Number(r[0]?.du) || 0, chuaCoVideo: Number(r[0]?.chuaCoVideo) || 0 }
}

/** Đủ thứ máy dựng cần cho MỘT mã: mô tả đầy đủ, ảnh (id để lấy qua máy chủ), gian đang bán. */
export async function chiTietLamVideo(prisma: any, id: string) {
    const p = await prisma.product.findFirst({
        where: { id: String(id), mergedIntoId: null },
        select: {
            id: true, sku: true, name: true, sellingPrice: true, stock: true, baseUnit: true, description: true,
            category: { select: { name: true } }, brand: { select: { name: true } },
            images: { orderBy: [{ isPrimary: 'desc' }, { id: 'asc' }], select: { id: true, url: true, isPrimary: true } },
        },
    })
    if (!p) return null
    const listing: any[] = p.sku ? await prisma.onlineProduct.findMany({
        where: { sku: p.sku },
        select: { id: true, channelId: true, platform: true, platformProductId: true, name: true, status: true, price: true, stock: true, imageUrl: true,
            channel: { select: { name: true, status: true } } },
        take: 20,
    }) : []
    const video: any[] = p.sku ? await prisma.sanMediaSanPham.findMany({
        where: { sku: p.sku }, orderBy: { id: 'desc' }, take: 10,
        select: { media: { select: { id: true, ten: true, trangThai: true, kenh: true, channelId: true, createdAt: true } } },
    }).catch(() => []) : []
    return {
        id: p.id, sku: p.sku, ten: p.name, giaBan: Number(p.sellingPrice) || 0, ton: Number(p.stock) || 0,
        donVi: p.baseUnit || null, moTa: String(p.description || ''), nhom: p.category?.name || null,
        thuongHieu: p.brand?.name || null,
        anh: p.images.map((a: any) => ({ id: a.id, url: a.url, daiDien: !!a.isPrimary })),
        gian: listing.map(l => ({
            channelId: l.channelId, san: l.platform, tenGian: l.channel?.name || null,
            gianHoatDong: (l.channel?.status || 'active') === 'active',
            maTrenSan: l.platformProductId, tenTrenSan: l.name, trangThai: l.status, giaTrenSan: Number(l.price) || 0,
            tonTrenSan: Number(l.stock) || 0,
        })),
        video: video.map(v => v.media).filter(Boolean),
        /* ẢNH TRÊN SÀN (14/10/2026): ảnh chính listing — đo KENGISTORE: 1024×1024, poster shop tự thiết kế (logo
         * KENGI STORE, nền đời sống, huy hiệu thông số) — nét hơn hẳn ảnh kho 610×409. Máy dựng chiếu nguyên tấm.
         * Một ảnh một lần dù nhiều gian dùng chung; chỉ host CDN đã biết (lấy qua /anh-san/:id). */
        anhSan: listing
            .filter((l, i, ds) => l.imageUrl && hostAnhDuocPhep(l.imageUrl) && ds.findIndex(x => x.imageUrl === l.imageUrl) === i)
            .slice(0, 3)
            .map(l => ({ id: l.id, url: l.imageUrl, san: l.platform, tenGian: l.channel?.name || null })),
    }
}

/* ─── CHUYỂN BYTE ẢNH ────────────────────────────────────────────────────────── */

/** CDN ảnh đã biết. Ảnh dán link nơi khác thì báo rõ để chủ shop tải ảnh vào kho, KHÔNG mở cửa
 *  cho máy chủ đi lấy URL bất kỳ (SSRF: metadata Cloud Run, mạng nội bộ). */
const HOST_ANH = /(^|\.)(storage\.googleapis\.com|susercontent\.com|shopee\.vn|shopee\.com|kiotviet\.vn|kiotviet\.com|tiktokcdn\.com|tiktokcdn-us\.com|ibyteimg\.com|byteimg\.com|lazcdn\.com|slatic\.net|googleusercontent\.com)$/i
const TOI_DA_BYTE = 12 * 1024 * 1024

export function hostAnhDuocPhep(url: string): boolean {
    try {
        const u = new URL(url)
        return u.protocol === 'https:' && !u.username && !u.password && (u.port === '' || u.port === '443') && HOST_ANH.test(u.hostname)
    } catch { return false }
}

export class LoiAnh extends Error { constructor(msg: string, public ma: number) { super(msg) } }

/** Lấy byte một ảnh của kho (theo id ProductImage). Theo chuyển hướng TỪNG BƯỚC, bước nào cũng soát host. */
export async function layAnhSanPham(prisma: any, anhId: string): Promise<{ buf: Buffer; loai: string }> {
    const a = await prisma.productImage.findFirst({ where: { id: String(anhId) }, select: { url: true } })
    if (!a?.url) throw new LoiAnh('Không thấy ảnh này trong kho', 404)
    return layAnhTheoUrl(String(a.url))
}

/** Ảnh chính của một listing trên sàn (theo id OnlineProduct) — cùng luật host + chuyển hướng như ảnh kho. */
export async function layAnhTrenSan(prisma: any, onlineProductId: string): Promise<{ buf: Buffer; loai: string }> {
    const a = await prisma.onlineProduct.findFirst({ where: { id: String(onlineProductId) }, select: { imageUrl: true } })
    if (!a?.imageUrl) throw new LoiAnh('Listing này không có ảnh', 404)
    return layAnhTheoUrl(String(a.imageUrl))
}

async function layAnhTheoUrl(urlGoc: string): Promise<{ buf: Buffer; loai: string }> {
    let url = urlGoc
    for (let buoc = 0; buoc < 4; buoc++) {
        if (!hostAnhDuocPhep(url)) throw new LoiAnh(`Ảnh nằm ở nơi máy chủ không lấy hộ (${(() => { try { return new URL(url).hostname } catch { return 'đường dẫn hỏng' } })()}) — tải ảnh vào kho Thông tin sản phẩm`, 422)
        const r = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(15_000), headers: { accept: 'image/*' } } as any)
        if (r.status >= 300 && r.status < 400) {
            const toi = r.headers.get('location')
            if (!toi) throw new LoiAnh(`Nơi chứa ảnh chuyển hướng mà không nói đi đâu (${r.status})`, 502)
            url = new URL(toi, url).toString()
            continue
        }
        if (!r.ok) throw new LoiAnh(`Nơi chứa ảnh trả ${r.status} — ảnh có thể đã bị xoá`, 502)
        const dai = Number(r.headers.get('content-length') || 0)
        if (dai > TOI_DA_BYTE) throw new LoiAnh(`Ảnh ${(dai / 1048576).toFixed(1)}MB — quá lớn để dựng video`, 413)
        const buf = Buffer.from(await r.arrayBuffer())
        if (buf.length > TOI_DA_BYTE) throw new LoiAnh('Ảnh quá lớn để dựng video', 413)
        const loai = nhanDangAnh(buf)
        if (loai === 'heic') throw new LoiAnh('Ảnh HEIC (iPhone) — trình duyệt không vẽ được, đổi sang JPG', 415)
        if (!loai) throw new LoiAnh('Tệp không phải ảnh JPG/PNG/WebP', 415)
        return { buf, loai }
    }
    throw new LoiAnh('Chuyển hướng quá nhiều lần', 502)
}
