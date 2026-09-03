// ─────────────────────────────────────────────────────────────────────────────
//  ẢNH CHO DÒNG HÀNG CỦA ĐƠN SÀN (03/09/2026)
//
//  Trang đóng gói (/video-online/) hiện danh sách hàng phải đóng; có ảnh thì
//  người đóng liếc một cái là biết đúng hàng chưa, thay vì đọc tên dài ba dòng.
//
//  Vì sao phải có file riêng: ẢNH KHO GẦN NHƯ KHÔNG CÓ. Quét cả máy chủ ngày
//  03/09 chỉ thấy ĐÚNG MỘT chỗ từng tạo `ProductImage` (nhập Excel hàng loạt) —
//  không đường đồng bộ nào lưu ảnh sản phẩm. Nên phải lấy ảnh LISTING TRÊN SÀN
//  (`OnlineProduct.imageUrl`), và tấm đó còn đúng hơn: chính là ảnh khách nhìn
//  thấy lúc đặt hàng.
//
//  HÀNG CÓ PHÂN LOẠI THÌ LẤY ẢNH CHÍNH. Sàn lưu MỘT ảnh cho cả listing chứ không
//  lưu ảnh từng phân loại, mà dòng hàng của đơn lại mang SKU PHÂN LOẠI (đo thật:
//  "SHD8611R", hậu tố R = màu đỏ) trong khi listing lưu SKU gốc "SHD8611". Nên
//  khớp thẳng SKU là trượt. Thứ tự dò, chắc nhất trước:
//  LUẬT: phân loại nào CÓ ảnh riêng thì giữ ảnh riêng — chỉ phân loại KHÔNG có
//  ảnh mới mượn ảnh chính của listing cha. Nên phải dò từ RIÊNG NHẤT tới CHUNG
//  NHẤT, dò ngược là ảnh chung cướp chỗ ảnh riêng:
//    1. ảnh kho — shop tự đặt, quý nhất vì đúng hàng thật trong kho
//    2. `sku` khớp hẳn — đây là dòng của CHÍNH phân loại đó, ảnh riêng của nó
//    3. `localProductId` — listing đã map sang đúng hàng kho
//    4. `externalItemId` ↔ `platformProductId` — mã listing, các phân loại DÙNG
//       CHUNG nên chỉ là ảnh chính; để sau ảnh riêng
//    5. SKU phân loại → khớp tiền tố, mượn ảnh chính của listing CHA
//
//  Dùng chung cho GET /online-orders và tool MCP get_online_order — hai nơi nói
//  khác nhau về "hàng này ảnh nào" thì còn khó lần hơn là không có ảnh.
// ─────────────────────────────────────────────────────────────────────────────

export interface DongHangCoAnh {
    id?: string
    sku?: string | null
    productId?: string | null
    product?: { images?: Array<{ url: string }> | null } | null
    [k: string]: any
}

/**
 * Trả về bản sao của `items` với thêm `imageUrl` cho từng dòng.
 * Ưu tiên ảnh KHO (do shop tự đặt) → ảnh LISTING theo sản phẩm → theo SKU.
 *
 * Đọc hỏng thì chỉ MẤT ẢNH, không ném lỗi: mất ảnh là phiền, mất cả đơn là hỏng việc.
 */
export async function ganAnhDongHang<T extends DongHangCoAnh>(
    prisma: any,
    items: T[],
): Promise<Array<T & { imageUrl: string | null }>> {
    const ds = Array.isArray(items) ? items : []
    if (ds.length === 0) return []

    const dsSku = Array.from(new Set(
        ds.map(it => String(it.sku || '').trim()).filter(Boolean),
    ))
    const dsProductId = Array.from(new Set(
        ds.map(it => String(it.productId || '').trim()).filter(Boolean),
    ))

    const theoProduct = new Map<string, string>()
    const theoSku = new Map<string, string>()
    const theoItemId = new Map<string, string>()
    /** [sku listing, ảnh] — để dò listing CHA của một SKU phân loại */
    const dsSkuListing: Array<[string, string]> = []

    if (dsSku.length || dsProductId.length) {
        try {
            /* Lấy TOÀN BỘ listing có ảnh của cửa hàng, không lọc theo SKU.
             *
             * Vì sao không lọc: SKU trên dòng hàng là SKU PHÂN LOẠI (đo thật:
             * "SHD8611R" — hậu tố R = màu đỏ), còn listing lưu SKU GỐC
             * ("SHD8611"). Lọc `sku IN (...)` thì không bao giờ khớp, và mỗi
             * listing chỉ giữ MỘT ảnh — ảnh chính — chứ không lưu ảnh từng phân
             * loại. Muốn dò được listing cha thì phải có cả bảng trong tay.
             *
             * Danh mục listing của một cửa hàng cỡ vài nghìn dòng, chỉ lấy 3 cột,
             * một lượt cho cả trang — rẻ hơn nhiều so với tra từng dòng hàng. */
            const listings = await prisma.onlineProduct.findMany({
                where: { imageUrl: { not: null } },
                select: { sku: true, imageUrl: true, localProductId: true, platformProductId: true },
                take: 10000,
            })
            for (const lp of listings) {
                if (!lp.imageUrl) continue
                if (lp.localProductId && !theoProduct.has(lp.localProductId)) {
                    theoProduct.set(lp.localProductId, lp.imageUrl)
                }
                if (lp.platformProductId && !theoItemId.has(lp.platformProductId)) {
                    theoItemId.set(lp.platformProductId, lp.imageUrl)
                }
                if (lp.sku) {
                    const k = String(lp.sku).trim()
                    if (k && !theoSku.has(k)) theoSku.set(k, lp.imageUrl)
                    if (k.length >= 4) dsSkuListing.push([k, lp.imageUrl])
                }
            }
            // SKU dài trước: "SHD8611" phải thắng "SHD86" khi cùng là tiền tố
            dsSkuListing.sort((a, b) => b[0].length - a[0].length)
        } catch (e: any) {
            console.error('[anh-dong-hang] không đọc được ảnh listing:', e?.message || e)
        }
    }

    /** SKU phân loại → ảnh CHÍNH của listing cha ("SHD8611R" → listing "SHD8611") */
    const anhListingCha = (sku: string): string | null => {
        for (const [k, url] of dsSkuListing) {
            if (sku.length > k.length && sku.startsWith(k)) {
                /* Phần dư phải NGẮN (hậu tố phân loại: R, XL, -DO…). Không kẹp thì
                 * "SHD86" nuốt luôn "SHD8611234" — hai mã hàng khác hẳn nhau. */
                if (sku.length - k.length <= 4) return url
            }
        }
        return null
    }

    return ds.map(it => {
        const sku = String(it.sku || '').trim()
        const anhKho = it.product?.images?.[0]?.url || null
        const anhTheoItem = (it as any).externalItemId
            ? theoItemId.get(String((it as any).externalItemId).trim()) || null : null
        const anhTheoSp = it.productId ? theoProduct.get(String(it.productId)) || null : null
        const anhTheoSku = sku ? theoSku.get(sku) || null : null
        const anhCha = sku ? anhListingCha(sku) : null
        return {
            ...it,
            /* RIÊNG trước, CHUNG sau. `anhTheoItem` là ảnh theo mã listing mà mọi
             * phân loại dùng chung — đặt nó trước `anhTheoSku` thì phân loại có
             * ảnh riêng vẫn bị gán ảnh chính, sai ý "chỉ phân loại KHÔNG có ảnh
             * mới lấy ảnh chính". */
            imageUrl: anhKho || anhTheoSku || anhTheoSp || anhTheoItem || anhCha || null,
        }
    })
}
