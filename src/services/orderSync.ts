/**
 * Convert completed online orders → Transaction + Inventory deduction
 * Called after sync imports/updates orders
 */

import { adjustSellableStock } from '../lib/warehouseHelper'
import { createJournalEntriesForTransaction } from '../lib/autoJournal'
import { thuGhiSo, sanCuaDon } from '../lib/ghiSoDongBo'
import { moTaLoi } from '../lib/gomLoi'
import { TRANG_THAI_LEN_PHIEU } from '../lib/donDuocXoa'
import { dangTat } from '../lib/choXong'

type StorePrisma = any

/**
 * Convert a single online order to a Transaction + deduct inventory.
 * Only processes orders that haven't been converted yet (no existing Transaction with matching receiptNumber).
 */
export async function convertOnlineOrderToTransaction(prisma: StorePrisma, orderId: string): Promise<boolean> {
    const order = await prisma.onlineOrder.findUnique({
        where: { id: orderId },
        include: { items: true },
    })
    /* Đơn BIẾN MẤT giữa chừng — hiếm nhưng có kịch bản thật: `processNewOrders`
     * lấy danh sách id trước, rồi mới chuyển từng đơn; cron dọn dẹp chạy SONG
     * SONG và có thể xoá một đơn nằm giữa hai bước đó. Im lặng ở đây là mất một
     * đơn khỏi sổ mà không để lại dấu vết nào.
     *
     * Ba nhánh `return false` còn lại ở dưới (sai trạng thái, đã có phiếu) CỐ Ý
     * im — chúng chạy mỗi lượt đồng bộ, ghi log là tạo tiếng ồn chứ không phải
     * thông tin. */
    if (!order) {
        console.warn(`[OrderSync] Đơn ${orderId} không còn tồn tại lúc chuyển phiếu — bị xoá xen giữa?`)
        return false
    }

    if (!(TRANG_THAI_LEN_PHIEU as readonly string[]).includes(order.status)) return false

    // Check if already converted (receipt exists with this order number)
    const existing = await prisma.transaction.findFirst({
        where: { receiptNumber: `ONLINE-${order.orderNumber}` },
    })
    if (existing) return false // Already converted

    // Find a system user for createdBy (first admin or any user)
    const systemUser = await prisma.user.findFirst({
        where: { role: { in: ['admin', 'owner', 'manager'] } },
        orderBy: { createdAt: 'asc' },
    })
    if (!systemUser) {
        console.warn(`[OrderSync] No system user found, skipping order ${order.orderNumber}`)
        return false
    }

    // Match online order items to products by SKU
    const transactionItems: any[] = []
    /* Dòng KHÔNG khớp được hàng kho — ghi lại để NÓI RA trên phiếu.
     * Khách đã trả trọn `order.total` nên ghi doanh thu 100% là ĐÚNG; cái thiếu
     * là giá vốn và trừ kho của mấy dòng này. Im lặng thì lãi bị báo cao hơn
     * thực tế mà trên phiếu không có một dấu vết nào. */
    const dongKhongKhop: string[] = []
    const inventoryUpdates: { productId: string; productName: string; productSku: string; quantity: number }[] = []

    // COMBO: 1 dòng đơn = nhiều mặt hàng. Bung thành từng thành phần → kho trừ
    // đúng từng mã, tồn kho thuế đúng từng mã, và HOÁ ĐƠN XUẤT TỪNG SẢN PHẨM
    // (hoá đơn lấy dòng hàng từ phiếu bán). Tiền combo chia theo tỷ trọng giá gốc,
    // phần lẻ dồn vào dòng lớn nhất để tổng khớp tuyệt đối tiền khách trả.
    const expandBundle = async (bundleId: string, item: any): Promise<boolean> => {
        /* Lỗi ĐỌC không được biến thành "combo rỗng" (20/08/2026): rỗng ⇒ hàm trả false ⇒ dòng đơn
         * bị xử như một mã thường ⇒ trừ kho vào mã combo (thường không có tồn thật) và tiền cũng
         * dồn vào đó. Đơn hỏng thì để lượt sau đồng bộ lại, hơn là ghi sai kho + sai doanh thu. */
        const bundle = await prisma.bundle.findUnique({ where: { id: bundleId } })
        let comps: any[] = []
        try { comps = JSON.parse((bundle as any)?.items || '[]') } catch { comps = [] }
        const resolved: { p: any; qty: number; weight: number }[] = []
        for (const c of comps) {
            const cp = c.productId
                ? await prisma.product.findUnique({ where: { id: c.productId } })
                : (c.sku ? await prisma.product.findFirst({ where: { sku: c.sku } }) : null)
            if (!cp) { console.log(`[OrderSync] Combo ${bundle?.name}: thiếu thành phần ${c.sku || c.productId}`); continue }
            const qty = (Number(c.quantity) || 1) * (item.quantity || 1)
            resolved.push({ p: cp, qty, weight: (Number(c.originalPrice) || cp.sellingPrice || 1) * (Number(c.quantity) || 1) })
        }
        if (resolved.length === 0) return false
        const total = Math.round(Number(item.lineTotal) || 0)
        const sumW = resolved.reduce((a, r) => a + r.weight, 0) || 1
        const parts = resolved.map(r => Math.round(total * r.weight / sumW))
        const diff = total - parts.reduce((a, n) => a + n, 0)
        if (diff !== 0) {
            let bi = 0
            parts.forEach((v, i) => { if ((v || 0) > (parts[bi] || 0)) bi = i })
            parts[bi] = (parts[bi] || 0) + diff
        }
        resolved.forEach((r, i) => {
            const lt = parts[i] || 0
            transactionItems.push({
                productId: r.p.id, productName: r.p.name, sku: r.p.sku,
                quantity: r.qty, baseQuantity: r.qty,
                unitPrice: r.qty > 0 ? Math.round(lt / r.qty) : lt,
                discount: 0, lineTotal: lt,
            })
            inventoryUpdates.push({ productId: r.p.id, productName: r.p.name, productSku: r.p.sku, quantity: r.qty })
        })
        return true
    }

    for (const item of order.items) {
        let product = null
        /* SKU từ sàn có thể dính ký tự trắng vô hình. Đo thật 15/08/2026: một
         * đơn Shopee mang sku "	
08L" trong khi kho có đúng "08L" — mọi phép
         * so đều trượt và đơn kẹt vĩnh viễn, còn route tạo SkuMapping thì luôn
         * trim nên không tạo nổi ánh xạ "bẩn" để chữa. Làm sạch MỘT LẦN ở đây
         * cho cả ba đường khớp; bản ghi gốc trên OnlineOrderItem giữ nguyên. */
        const skuSach = String(item.sku || '').trim() || null
        // Hệ số quy đổi của ánh xạ SKU: phân loại trên sàn là VỈ nhưng kho đếm
        // theo CÁI → 1 vỉ phải trừ 10 cái.
        let mapRate = 1

        // Try matching by productId first (if already linked)
        if (item.productId) {
            product = await prisma.product.findUnique({ where: { id: item.productId } })
        }

        // Try matching by SKU
        if (!product && skuSach) {
            product = await prisma.product.findFirst({ where: { sku: skuSach } })

            // If found, link the productId for future syncs
            if (product) {
                await prisma.onlineOrderItem.update({
                    where: { id: item.id },
                    data: { productId: product.id },
                }).catch(() => { }) // Ignore if fails
            }
        }

        // Bảng ÁNH XẠ SKU sàn → kho (user tự map ở màn "Ánh xạ SKU"). Đơn TikTok/
        // Shopee hay dùng mã riêng ("Ct30plus", "cs24"…) không trùng SKU kho →
        // trước đây đơn bị bỏ qua, không lên phiếu ⇒ không xuất được hoá đơn.
        if (!product && skuSach) {
            const map = await prisma.skuMapping.findFirst({
                where: {
                    platformSku: { equals: skuSach, mode: 'insensitive' },
                    OR: [{ platform: null }, { platform: order.platform || undefined }],
                },
            }).catch(() => null)
            if ((map as any)?.bundleId) {
                if (await expandBundle(String((map as any).bundleId), item)) continue
            }
            if (map?.productId) {
                product = await prisma.product.findUnique({ where: { id: map.productId } })
                mapRate = Number((map as any).conversionRate) || 1
                if (product) {
                    await prisma.onlineOrderItem.update({
                        where: { id: item.id },
                        data: { productId: product.id },
                    }).catch(() => { })
                }
            }
        }

        // Fallback: map qua OnlineProduct (link sàn ↔ kho user đã thiết lập ở màn
        // "Sản phẩm online"). Đơn Shopee thường KHÔNG có SKU (item.sku = null),
        // nhưng tên item trong đơn = tên listing trên sàn → tra OnlineProduct cùng
        // kênh theo sku/tên, lấy localProductId. Chỉ nhận khi khớp DUY NHẤT 1
        // listing (tên trùng nhau giữa 2 listing khác kho → bỏ qua cho an toàn).
        if (!product && order.channelId) {
            const candidates = await prisma.onlineProduct.findMany({
                where: {
                    channelId: order.channelId,
                    localProductId: { not: null },
                    OR: [
                        ...(skuSach ? [{ sku: skuSach }] : []),
                        { name: item.productName },
                    ],
                },
                include: { localProduct: true },
                take: 2,
            })
            if (candidates.length === 1 && candidates[0].localProduct) {
                product = candidates[0].localProduct
                await prisma.onlineOrderItem.update({
                    where: { id: item.id },
                    data: { productId: product.id },
                }).catch(() => { })
            }
        }

        // Mã ĐÃ GỘP sang mã khác: chuyển sang mã đích + nhân hệ số (mã cũ vẫn còn
        // để sàn dò theo SKU, nhưng hàng thật nằm ở mã đích).
        if (product && (product as any).mergedIntoId) {
            /* Đọc hỏng ⇒ tgt null ⇒ GIỮ NGUYÊN mã cũ: trừ kho vào mã đã gộp (mã đó không còn
             * hàng thật) và bỏ luôn hệ số quy đổi ⇒ sai cả mặt hàng lẫn số lượng (20/08/2026). */
            const tgt = await prisma.product.findUnique({ where: { id: (product as any).mergedIntoId } })
            if (tgt) {
                mapRate *= Number((product as any).mergedRate) || 1
                product = tgt
            }
        }

        // Sản phẩm khớp được nhưng bản thân nó là COMBO đã định nghĩa → bung ra.
        // Không có nhánh này thì combo đã nhập sẵn trong kho sẽ khớp thẳng và
        // KHÔNG BAO GIỜ chạm tới ánh xạ combo.
        if (product && (product as any).bundleId) {
            if (await expandBundle(String((product as any).bundleId), item)) continue
        }

        if (product) {
            // quantity giữ nguyên số của SÀN (1 vỉ) để còn đối chiếu với đơn gốc;
            // baseQuantity là số theo ĐƠN VỊ GỐC (10 cái) — kho trừ và tồn kho thuế
            // đều đọc baseQuantity.
            const baseQty = Math.round((item.quantity || 0) * mapRate)
            transactionItems.push({
                productId: product.id,
                productName: product.name,
                sku: product.sku,
                quantity: item.quantity,
                baseQuantity: baseQty,
                unitPrice: item.unitPrice,
                discount: item.discount || 0,
                lineTotal: item.lineTotal,
            })

            inventoryUpdates.push({
                productId: product.id,
                productName: product.name,
                productSku: product.sku,
                quantity: baseQty,
            })
        } else {
            /* ⚠ CHÚ THÍCH CŨ Ở ĐÂY GHI "still add to transaction without productId"
             * — SAI, mã KHÔNG hề thêm gì. Lệnh push nằm trong `if (product)` ở
             * trên, nên item không khớp được hàng kho thì bị bỏ hẳn; đơn nào
             * mọi item đều không khớp sẽ có `transactionItems` rỗng và thoát ở
             * nhánh "No matching products", KHÔNG BAO GIỜ lên phiếu.
             *
             * Đo KENGISTORE 15/08/2026: 777 đơn (373.148.233đ, bằng 9,1% doanh
             * thu đã ghi sổ cùng kỳ) kẹt đúng vì lý do này. 100/100 đơn kiểm
             * đều CÓ dòng hàng — vấn đề là SKU sàn chưa ánh xạ sang hàng kho.
             *
             * Chưa đổi hành vi ở đây: ghi phiếu mà không có productId thì có
             * doanh thu nhưng không có giá vốn và không trừ kho — đó là đánh
             * đổi của chủ shop, không phải quyết định của mã. Xem danh sách SKU
             * đang chặn ở GET /admin/don-ket. */
            console.log(`[OrderSync] SKU "${item.sku}" not found in inventory for order ${order.orderNumber}`)
            dongKhongKhop.push(`${item.sku || '(không SKU)'} ×${item.quantity}`)
        }
    }

    if (transactionItems.length === 0) {
        console.log(`[OrderSync] No matching products for order ${order.orderNumber}, skipping`)
        return false
    }

    // Create Transaction
    const donDaTao = await prisma.transaction.create({
        include: {
            items: { include: { product: { select: { costPrice: true } } } },
            payments: true,
        },
        data: {
            receiptNumber: `ONLINE-${order.orderNumber}`,
            customerId: null,
            customerName: order.customerName,
            customerPhone: order.customerPhone,
            subtotal: order.subtotal,
            discount: order.discount,
            tax: 0,
            total: order.total,
            amountReceived: order.total,
            change: 0,
            status: 'completed',
            // Kênh bán: đánh dấu 'online' để báo cáo theo kênh lọc thẳng bằng cột
            // channel thay vì phải đoán qua prefix receiptNumber (ONLINE-/SPE-/TIK-)
            channel: 'online',
            createdBy: systemUser.id,
            createdByName: 'Hệ thống',
            notes: `Đơn online ${order.platform || 'Shopee'} - ${order.orderNumber}`
                + (dongKhongKhop.length
                    ? ` — ⚠ ${dongKhongKhop.length} dòng chưa nối được hàng kho (${dongKhongKhop.slice(0, 5).join(', ')}${dongKhongKhop.length > 5 ? '…' : ''}): phiếu có ĐỦ doanh thu nhưng THIẾU giá vốn và không trừ kho phần này.`
                    : ''),
            transactionDate: order.createdAt,
            items: {
                create: transactionItems,
            },
            payments: {
                create: [{
                    type: order.paymentMethod || 'online',
                    amount: order.total,
                    reference: order.externalOrderId || order.orderNumber,
                }],
            },
        },
    })

    /* GHI SỔ (03/09/2026 — điểm đứt 2). Đồng bộ đơn sàn trước nay tạo phiếu bán
     * rồi dừng: bộ sinh bút toán CÓ SẴN đường hạch toán qua pháp nhân sàn
     * (Nợ 131-SHOPEE / Có 511) nhưng không ai gọi nó lúc đơn về.
     *
     * Hai chỗ phải nói rõ sàn và ngày:
     *   · số phiếu là `ONLINE-<mã đơn của sàn>` nên không lộ sàn nào — truyền
     *     `san` vào để đơn Shopee ghi 131-SHOPEE chứ không rơi vào 131-SAN chung;
     *   · ngày bút toán lấy NGÀY ĐẶT ĐƠN TRÊN SÀN, không phải lúc chạy đồng bộ,
     *     nếu không đơn cũ dồn hết vào ngày sync. */
    await thuGhiSo(`Đơn sàn ${order.orderNumber}`, () => createJournalEntriesForTransaction(
        prisma,
        { ...(donDaTao as any), createdAt: order.createdAt || (donDaTao as any).createdAt },
        {
            branchId: (donDaTao as any).branchId ?? null,
            userId: systemUser.id,
            san: sanCuaDon(order.platform),
        },
    ))

    // Deduct inventory for each matched product.
    // CHỐNG TRỪ KHO 2 LẦN: đường PUT /online-orders/:id/status cũng trừ kho độc
    // lập → claim cờ stockDeducted trước (updateMany điều kiện false→true là
    // atomic). count=0 nghĩa là đường kia đã trừ rồi → SKIP toàn bộ khối trừ kho.
    // Cờ này cũng là nguồn sự thật để reverseOnlineOrderEffects hoàn kho khi hủy.
    let deducted = 0
    if (inventoryUpdates.length > 0) {
        const claim = await prisma.onlineOrder.updateMany({
            where: { id: order.id, stockDeducted: false },
            data: { stockDeducted: true },
        })
        if (claim.count === 0) {
            console.log(`[OrderSync] Order ${order.orderNumber} đã trừ kho trước đó (stockDeducted=true) — bỏ qua trừ kho`)
        } else {
            for (const inv of inventoryUpdates) {
                // Decrease product stock — mirror sang kho main (đơn sàn không có
                // branchId → null, dùng kho main null-branch khớp reindex/sync)
                await adjustSellableStock(prisma, inv.productId, null, -inv.quantity)

                // Create inventory transaction log
                await prisma.inventoryTransaction.create({
                    data: {
                        type: 'out',
                        productId: inv.productId,
                        productName: inv.productName,
                        productSku: inv.productSku,
                        quantity: -inv.quantity,
                        reason: 'Bán hàng online',
                        note: `Đơn ${order.orderNumber} (${order.platform || 'Shopee'})`,
                        referenceId: `ONLINE-${order.orderNumber}`,
                        referenceType: 'sale',
                        userId: systemUser.id,
                        userName: 'Hệ thống',
                        transactionDate: order.createdAt,
                    },
                })
                deducted++
            }
        }
    }

    console.log(`[OrderSync] Converted order ${order.orderNumber} → Transaction + ${deducted} inventory updates`)
    return true
}

/**
 * Process all newly synced orders for a channel — convert eligible ones to transactions
 */
export async function processNewOrders(prisma: StorePrisma, channelId: string): Promise<number> {
    // Find orders that are confirmed/completed but not yet converted to transactions
    const orders = await prisma.onlineOrder.findMany({
        where: {
            channelId,
            status: { in: [
                'confirmed', 'processing', 'shipping', 'completed', 'delivered',
                'READY_TO_SHIP', 'PROCESSED', 'SHIPPED', 'COMPLETED',
                // TikTok native (mapStatus giữ nguyên trạng thái gốc từ 2026-06-11)
                'AWAITING_SHIPMENT', 'AWAITING_COLLECTION', 'PARTIALLY_SHIPPING', 'IN_TRANSIT',
                'DELIVERED', // thiếu trước đây → đơn TikTok đã giao không bao giờ được chuyển
            ] },
        },
        select: { id: true, orderNumber: true },
    })

    let converted = 0
    let daXuLy = 0          // đếm đơn ĐÃ CHẠM (thành công hay không) — khác `converted`
    for (const order of orders) {
        /* Container đang tắt → dừng NGAY, đừng làm nốt. Đơn chưa kịp thì lượt sau
         * quét lại (processNewOrders quét toàn bộ đơn đủ điều kiện mỗi lượt). Đo
         * 03:02 UTC 18/08: không có cờ này, shutdown chờ 6 s vẫn không đủ → 11 đơn
         * mất engine giữa chừng. Xem lib/choXong.ts. */
        if (dangTat()) {
            /* Đếm bằng `daXuLy` chứ không phải `converted`: converted chỉ đếm đơn CHUYỂN
             * THÀNH CÔNG, nên bản đầu in "còn 20 đơn" khi thực tế còn 17 — người đọc log
             * tưởng chưa chạy đơn nào (kiểm bằng prisma giả 18/08). */
            console.log(`[OrderSync] Đang tắt — dừng chuyển đơn, đã xử lý ${daXuLy}/${orders.length}, còn ${orders.length - daXuLy} đơn để lượt sau`)
            break
        }
        daXuLy++
        try {
            const success = await convertOnlineOrderToTransaction(prisma, order.id)
            if (success) converted++
        } catch (err: any) {
            /* GHI ĐỦ ĐỂ LẦN RA, đừng chỉ ghi `.message`.
             *
             * Lỗi Prisma thường để nội dung ở `code` (P2002, P2022…) và `meta`,
             * còn `.message` có thể RỖNG — đo 16/08/2026: 82 lần chuyển đơn hỏng
             * trong 6 giờ mà log chỉ ra `Error converting order X:` cụt lủn và
             * một dòng `prisma:error` trống, không lần nào biết vì sao. Đếm được
             * mà không chẩn được thì cũng như không thấy. */
            console.error(`[OrderSync] Error converting order ${order.orderNumber}: ${moTaLoi(err)}`)
        }
    }

    return converted
}
