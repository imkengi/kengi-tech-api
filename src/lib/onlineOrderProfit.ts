// Lợi nhuận TẠM TÍNH cho đơn sàn (Shopee/TikTok/Lazada).
//
// Vì sao "tạm tính":
//   1. Thực nhận (netRevenue) chỉ chốt sau khi sàn đối soát. Đơn chưa đối soát
//      phải ước tính bằng subtotal - shippingFee - platformFee (đúng công thức
//      fallback đang dùng ở POST /fix-totals, giữ cho nhất quán).
//   2. Giá vốn lấy từ Product.costPrice HIỆN TẠI, không phải giá vốn tại thời
//      điểm bán — giống mọi báo cáo khác trong repo (queries.ts, autoJournal.ts).
//
// Dòng hàng đơn sàn KHÔNG lưu giá vốn và số lượng ghi theo ĐƠN VỊ SÀN (1 vỉ),
// nên phải đi lại đúng chuỗi quy đổi mà orderSync.ts dùng khi trừ kho:
//   productId sẵn có → SkuMapping (conversionRate) → mã đã gộp (mergedRate)
//   → combo thì bung thành phần.
// Sai chuỗi này là giá vốn lệch theo bội số → lợi nhuận sai hẳn.

export interface OrderProfit {
    cost: number            // giá vốn ước tính của đơn
    profit: number | null   // null = đơn hủy/hoàn, không tính lợi nhuận
    estimated: boolean      // true khi chưa đối soát HOẶC thiếu giá vốn
    missingCost: boolean    // có dòng hàng không xác định được giá vốn
    /** Đơn khách trả hàng: sàn quyết toán ÂM (hoàn hết tiền + trừ phí ship hoàn).
     *  `profit` là số LỖ thật, giá vốn để 0 vì hàng đã về kho. */
    hoanTra?: boolean
}

// Đơn hủy/hoàn không tính lợi nhuận (giữ đúng danh sách đang dùng ở /stats)
const CANCELLED_STATUSES = [
    'CANCELLED', 'IN_CANCEL', 'TO_RETURN',
    'cancelled', 'cancelling', 'returned',
]

interface ProductCost {
    id: string
    costPrice: number
    bundleId: string | null
    mergedIntoId: string | null
    mergedRate: number
}

/**
 * Tính giá vốn + lợi nhuận tạm tính cho một trang đơn hàng.
 * Mọi truy vấn đều gom theo lô — số query không phụ thuộc số đơn.
 */
export async function computeOrderProfits(
    prisma: any,
    orders: any[],
): Promise<Map<string, OrderProfit>> {
    const out = new Map<string, OrderProfit>()
    if (!orders?.length) return out

    // ── 1. Gom mã sản phẩm / SKU sàn xuất hiện trong trang ──────────────────
    const productIds = new Set<string>()
    const skus = new Set<string>()
    for (const o of orders) {
        for (const it of o.items || []) {
            if (it.productId) productIds.add(String(it.productId))
            if (it.sku) skus.add(String(it.sku).toLowerCase())
        }
    }

    // ── 2. Ánh xạ SKU sàn → kho (kèm hệ số quy đổi vỉ→cái) ──────────────────
    // Khớp không phân biệt hoa thường như orderSync → phải lọc ở JS, vì Prisma
    // không hỗ trợ `mode: insensitive` cho toán tử `in`.
    const mappings: any[] = skus.size
        ? await prisma.skuMapping.findMany({
            select: {
                platformSku: true, platform: true,
                productId: true, conversionRate: true, bundleId: true,
            },
            take: 10000,
        }).catch(() => [])
        : []
    const mapBySku = new Map<string, any[]>()
    for (const m of mappings) {
        const key = String(m.platformSku || '').toLowerCase()
        if (!skus.has(key)) continue
        if (!mapBySku.has(key)) mapBySku.set(key, [])
        mapBySku.get(key)!.push(m)
        if (m.productId) productIds.add(String(m.productId))
    }

    // ── 3. Giá vốn sản phẩm (+ thông tin gộp mã / combo) ────────────────────
    const productById = new Map<string, ProductCost>()
    const loadProducts = async (ids: string[]) => {
        const fresh = ids.filter(id => id && !productById.has(id))
        if (!fresh.length) return
        const rows: any[] = await prisma.product.findMany({
            where: { id: { in: fresh } },
            select: { id: true, costPrice: true, bundleId: true, mergedIntoId: true, mergedRate: true },
        }).catch(() => [])
        for (const p of rows) {
            productById.set(String(p.id), {
                id: String(p.id),
                costPrice: Number(p.costPrice) || 0,
                bundleId: p.bundleId ? String(p.bundleId) : null,
                mergedIntoId: p.mergedIntoId ? String(p.mergedIntoId) : null,
                mergedRate: Number(p.mergedRate) || 1,
            })
        }
    }
    await loadProducts([...productIds])

    // Mã đã gộp: hàng thật nằm ở mã đích → phải lấy giá vốn của mã đích
    await loadProducts(
        [...productById.values()].map(p => p.mergedIntoId).filter(Boolean) as string[]
    )

    // ── 4. Combo: bung thành phần để cộng giá vốn từng mã ───────────────────
    const bundleIds = new Set<string>()
    for (const p of productById.values()) if (p.bundleId) bundleIds.add(p.bundleId)
    for (const list of mapBySku.values()) {
        for (const m of list) if (m.bundleId) bundleIds.add(String(m.bundleId))
    }

    // giá vốn 1 đơn vị combo, null = không dựng được (thiếu thành phần)
    const bundleUnitCost = new Map<string, number | null>()
    if (bundleIds.size) {
        const bundles: any[] = await prisma.bundle.findMany({
            where: { id: { in: [...bundleIds] } },
            select: { id: true, items: true },
        }).catch(() => [])

        // Thành phần combo tham chiếu bằng productId HOẶC sku (giống orderSync)
        const parsed = new Map<string, any[]>()
        const compIds = new Set<string>()
        const compSkus = new Set<string>()
        for (const b of bundles) {
            let comps: any[] = []
            try { comps = JSON.parse(b.items || '[]') } catch { comps = [] }
            parsed.set(String(b.id), comps)
            for (const c of comps) {
                if (c?.productId) compIds.add(String(c.productId))
                else if (c?.sku) compSkus.add(String(c.sku))
            }
        }
        await loadProducts([...compIds])

        const costBySku = new Map<string, number>()
        if (compSkus.size) {
            const rows: any[] = await prisma.product.findMany({
                where: { sku: { in: [...compSkus] } },
                select: { sku: true, costPrice: true },
            }).catch(() => [])
            for (const p of rows) costBySku.set(String(p.sku), Number(p.costPrice) || 0)
        }

        for (const [bid, comps] of parsed) {
            if (!comps.length) { bundleUnitCost.set(bid, null); continue }
            let sum = 0
            let ok = true
            for (const c of comps) {
                const qty = Number(c?.quantity) || 1
                const cost = c?.productId
                    ? productById.get(String(c.productId))?.costPrice
                    : (c?.sku ? costBySku.get(String(c.sku)) : undefined)
                if (!cost) { ok = false; break } // thiếu thành phần hoặc chưa có giá vốn
                sum += cost * qty
            }
            bundleUnitCost.set(bid, ok ? sum : null)
        }
    }

    // ── 5. Tính từng đơn ────────────────────────────────────────────────────
    for (const order of orders) {
        let cost = 0
        let missingCost = false

        for (const it of order.items || []) {
            const qty = Number(it.quantity) || 0
            if (qty <= 0) continue

            const skuKey = it.sku ? String(it.sku).toLowerCase() : ''
            // Ánh xạ ưu tiên đúng sàn của đơn, sau đó tới ánh xạ dùng chung
            const candidates = mapBySku.get(skuKey) || []
            const map = candidates.find(m => m.platform && m.platform === order.platform)
                ?? candidates.find(m => !m.platform)
                ?? null

            // Combo khai báo ngay ở ánh xạ SKU → bung luôn, không quy đổi
            if (map?.bundleId) {
                const unit = bundleUnitCost.get(String(map.bundleId))
                if (unit == null) { missingCost = true; continue }
                cost += unit * qty
                continue
            }

            // Hệ số quy đổi CHỈ áp khi ánh xạ này chính là đường ra sản phẩm.
            // Dòng hàng đã link thẳng sang mã khác (khớp SKU kho) thì orderSync trừ
            // kho với hệ số 1 — áp nhầm hệ số ở đây là giá vốn lệch cả chục lần.
            const linkedId = it.productId
                ? String(it.productId)
                : (map?.productId ? String(map.productId) : '')
            const mapApplies = !!map?.productId && String(map.productId) === linkedId
            let rate = mapApplies ? (Number(map.conversionRate) || 1) : 1
            let product = linkedId ? productById.get(linkedId) : undefined

            if (product?.mergedIntoId) {
                rate *= product.mergedRate || 1
                product = productById.get(product.mergedIntoId)
            }

            if (product?.bundleId) {
                const unit = bundleUnitCost.get(product.bundleId)
                if (unit == null) { missingCost = true; continue }
                cost += unit * qty
                continue
            }

            // Không khớp được sản phẩm, hoặc sản phẩm chưa khai giá vốn → không
            // được âm thầm tính 0, vì như vậy lợi nhuận bị thổi phồng.
            if (!product || product.costPrice <= 0) { missingCost = true; continue }

            cost += product.costPrice * Math.round(qty * rate)
        }

        cost = Math.round(cost)

        if (CANCELLED_STATUSES.includes(order.status)) {
            out.set(order.id, { cost, profit: null, estimated: true, missingCost })
            continue
        }

        /* CHƯA ĐỐI SOÁT THÌ KHÔNG TÍNH LỢI NHUẬN — trả `profit: null`, giao diện hiện "—".
         *
         * Trước 06/09/2026 chỗ này ước tính bằng subtotal − shippingFee − platformFee.
         * Chủ shop quyết bỏ (06/09): "lấy được thì hiển thị, không lấy được thì không".
         * Lý do đo được: phí thật Shopee ≈ 24%, TikTok ≈ 27% doanh thu, còn phí ước
         * tính là 6% (hoặc 0 sau khi bỏ) → lợi nhuận ước tính hiện 28% khi thực tế 8%.
         * Một con số sai gấp 3,5 lần mà mang dấu "~" nhỏ xíu thì người ta vẫn tin.
         * Đọc không được ≠ bằng 0, và cũng ≠ "tạm cho là thế". */
        /* ⚠ PHÉP THỬ PHẢI LÀ "KHÁC 0", KHÔNG PHẢI "LỚN HƠN 0" (sửa 06/09/2026).
         *
         * Sàn VẪN quyết toán đơn khách trả hàng: hoàn tiền toàn bộ cho khách rồi
         * trừ tiếp phí ship hoàn của shop ⇒ `settlement_amount` ÂM, status SETTLED.
         * Đo trên KENGISTORE 06/09: 18 đơn như vậy, tổng −977.028đ.
         * Dùng `> 0` thì chúng rơi vào nhánh "chưa đối soát" VĨNH VIỄN — giao diện
         * hiện "chưa quyết toán" mãi mãi và khoản LỖ không vào bất kỳ báo cáo nào.
         * Giấu lỗ nguy hiểm hơn thiếu số, vì nhìn như chưa có dữ liệu. */
        const netRevenue = Number(order.netRevenue) || 0
        if (netRevenue === 0) {
            out.set(order.id, { cost, profit: null, estimated: true, missingCost })
            continue
        }

        /* ĐƠN HOÀN (quyết toán âm): tiền đã trả lại khách, hàng đã về — phần lỗ THẬT
         * là số sàn trừ (phí ship hoàn), KHÔNG phải `thực nhận − giá vốn`. Trừ giá vốn
         * ở đây là tính lỗ hai lần: hàng nằm lại trong kho chứ không mất đi. */
        if (netRevenue < 0) {
            out.set(order.id, { cost: 0, profit: Math.round(netRevenue), estimated: false, missingCost: false, hoanTra: true })
            continue
        }

        out.set(order.id, {
            cost,
            profit: Math.round(netRevenue - cost),
            estimated: missingCost,
            missingCost,
        })
    }

    return out
}
