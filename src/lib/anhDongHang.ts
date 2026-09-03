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
//  Khớp bằng HAI khoá, không chỉ SKU:
//    1. `localProductId` — listing đã map sang hàng kho. Đây là khoá CHẮC nhất.
//    2. `sku` — đường lùi cho listing chưa map.
//  Chỉ khớp SKU thì hụt: SKU trên dòng hàng của đơn là SKU PHÂN LOẠI của sàn
//  (đo thật: "SHD8611R"), có thể khác SKU lưu ở listing.
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

    if (dsSku.length || dsProductId.length) {
        try {
            const dieuKien: any[] = []
            if (dsProductId.length) dieuKien.push({ localProductId: { in: dsProductId } })
            if (dsSku.length) dieuKien.push({ sku: { in: dsSku } })
            const listings = await prisma.onlineProduct.findMany({
                where: { AND: [{ OR: dieuKien }, { imageUrl: { not: null } }] },
                select: { sku: true, imageUrl: true, localProductId: true },
            })
            for (const lp of listings) {
                if (!lp.imageUrl) continue
                if (lp.localProductId && !theoProduct.has(lp.localProductId)) {
                    theoProduct.set(lp.localProductId, lp.imageUrl)
                }
                if (lp.sku && !theoSku.has(lp.sku)) theoSku.set(lp.sku, lp.imageUrl)
            }
        } catch (e: any) {
            console.error('[anh-dong-hang] không đọc được ảnh listing:', e?.message || e)
        }
    }

    return ds.map(it => {
        const anhKho = it.product?.images?.[0]?.url || null
        const anhTheoSp = it.productId ? theoProduct.get(String(it.productId)) || null : null
        const anhTheoSku = it.sku ? theoSku.get(String(it.sku).trim()) || null : null
        return { ...it, imageUrl: anhKho || anhTheoSp || anhTheoSku || null }
    })
}
