/**
 * Convert completed online orders → Transaction + Inventory deduction
 * Called after sync imports/updates orders
 */

import { adjustSellableStock } from '../lib/warehouseHelper'
import { createJournalEntriesForTransaction } from '../lib/autoJournal'
import { thuGhiSo, sanCuaDon } from '../lib/ghiSoDongBo'
import { moTaLoi } from '../lib/gomLoi'
import { duocLenPhieu, TRANG_THAI_DUOC_LEN_PHIEU, TRANG_THAI_CHO_XAC_NHAN } from '../lib/donDuocXoa'
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

    /* Chờ xác nhận (READY_TO_SHIP / AWAITING_SHIPMENT) thì CHƯA lên phiếu — chủ shop
     * chốt 09/09/2026: chưa xác nhận là Đặt hàng, xác nhận xong mới là Giao dịch.
     * Lượt đồng bộ sau thấy PROCESSED/SHIPPED… sẽ chuyển. Xem lib/donDuocXoa.ts. */
    if (!duocLenPhieu(order.status)) return false

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

        /* Khớp theo SKU — KHÔNG PHÂN BIỆT HOA THƯỜNG (sửa 04/09/2026).
         *
         * Đo thật trên KENGISTORE: 7/8 mã đang chặn đơn là lệch đúng chữ hoa —
         * sàn ghi "ct18plus"/"Ct28plus", kho ghi "CT18PLUS"/"CT28PLUS". Phép so
         * cũ dùng `{ sku: skuSach }` là so CHẶT, nên trượt hết; trong khi bảng
         * ánh xạ SkuMapping ngay bên dưới lại đã dùng `mode: 'insensitive'`.
         * Hai phép so cùng một thứ mà một bên chặt một bên lỏng — đơn rơi vào
         * khe giữa hai luật rồi kẹt vĩnh viễn.
         *
         * NHIỀU MÃ TRÙNG NHAU KHI BỎ HOA THƯỜNG THÌ BỎ QUA, KHÔNG ĐOÁN. Chọn
         * bừa một cái là doanh thu và trừ kho chạy vào nhầm mặt hàng — âm thầm
         * và khó lần hơn hẳn việc đơn kẹt lại chờ người xử. */
        if (!product && skuSach) {
            const ungVien = await prisma.product.findMany({
                where: { sku: { equals: skuSach, mode: 'insensitive' } },
                take: 5,
            })
            if (ungVien.length === 1) {
                product = ungVien[0]
            } else if (ungVien.length > 1) {
                console.warn(
                    `[OrderSync] SKU "${skuSach}" khớp ${ungVien.length} mặt hàng khi bỏ phân biệt hoa thường ` +
                    `(${ungVien.map((x: any) => x.sku).join(', ')}) — BỎ QUA, không đoán. Sửa SKU cho khác hẳn nhau ` +
                    `hoặc khai ánh xạ SKU đích danh.`,
                )
            }

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
        /* Đánh dấu để lượt đồng bộ sau KHÔNG quét lại đơn này nữa.
         *
         * Đo 05/09/2026 trên log prod: 1.033 đơn kẹt đúng nhánh này bị thử lại
         * ~5 lần/ngày, mỗi lượt tốn ~4 truy vấn trước khi bỏ cuộc ⇒ ~20.000 truy
         * vấn phí mỗi ngày, trên pool CHỈ CÓ 1 kết nối (cùng ngày: 819 lần cạn
         * kết nối, 69 lần container sập /30 ngày).
         *
         * ⚠ Đây KHÔNG phải bỏ đơn. Đơn còn nguyên, chỉ thôi thử lại liên tục;
         * `GET /admin/don-ket` vẫn liệt kê chúng, và cờ tự xoá khi chuyển được. */
        try {
            await prisma.onlineOrder.update({
                where: { id: order.id },
                data: { khongKhopSku: true, khongKhopLuc: new Date() },
            })
        } catch (err: any) {
            /* Không đặt được cờ thì chỉ mất phần tiết kiệm — đơn vẫn nguyên vẹn và
             * lượt sau quét lại như cũ. Nhưng phải NÓI RA, đừng nuốt lặng. */
            console.warn(`[OrderSync] Không đặt được cờ khongKhopSku cho ${order.orderNumber}: ${moTaLoi(err)}`)
        }
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

    /* KHO MẸ — cửa hàng này có mượn tồn của cửa hàng khác thì trừ luôn bên đó.
     *
     * Chủ shop chốt 10/09/2026 là trừ CẢ HAI kho. Trừ theo `inventoryUpdates` —
     * tức số ĐÃ QUY ĐỔI (ánh xạ SKU, mã gộp, bung combo), đúng bằng số vừa trừ ở
     * kho con, để hai bên không kể hai câu chuyện khác nhau.
     *
     * Hai schema khác nhau ⇒ KHÔNG chung transaction: hàm tự chống trùng bằng cờ
     * `khoMeTruLuc`. Hỏng ở đây KHÔNG được làm hỏng việc lập phiếu — phiếu đã ghi,
     * ném lỗi ra là lượt sau chuyển lại và đẻ phiếu trùng. */
    if (inventoryUpdates.length > 0) {
        try {
            const { moKhoMe, truKhoMe } = await import('../lib/khoMe')
            const khoMe = await moKhoMe(prisma)
            if (khoMe) {
                const kq = await truKhoMe(prisma, khoMe, order.id, order.orderNumber,
                    inventoryUpdates.map(i => ({ sku: i.productSku, soLuong: i.quantity, ten: i.productName })))
                if (kq.daGianhCo) {
                    console.log(`[KhoMe] ${order.orderNumber}: trừ ${kq.daTru}/${inventoryUpdates.length} dòng ở kho mẹ ${khoMe.ma}`)
                }
                // Dòng không trừ được phải NÓI RA kèm mã hàng — im lặng là kho mẹ
                // thiếu hàng mà không ai biết vì sao.
                for (const b of kq.boQua) console.warn(`[KhoMe] ${order.orderNumber}: ${b}`)
            }
        } catch (e: any) {
            console.error(`[KhoMe] ${order.orderNumber}: trừ kho mẹ hỏng — ${moTaLoi(e)}`)
        }
    }

    /* Chuyển được rồi thì XOÁ cờ kẹt SKU (nếu trước đây từng kẹt). Không xoá thì
     * đơn đã lên phiếu vẫn mang cờ, làm mọi bộ đếm "đơn kẹt" đọc sai về sau.
     * `updateMany` để không ném lỗi nếu đơn vừa bị xoá xen giữa. */
    if (order.khongKhopSku) {
        await prisma.onlineOrder.updateMany({
            where: { id: order.id },
            data: { khongKhopSku: false, khongKhopLuc: null },
        }).catch((err: any) => console.warn(`[OrderSync] Không xoá được cờ khongKhopSku cho ${order.orderNumber}: ${moTaLoi(err)}`))
    }

    console.log(`[OrderSync] Converted order ${order.orderNumber} → Transaction + ${deducted} inventory updates`)
    return true
}

/**
 * Process all newly synced orders for a channel — convert eligible ones to transactions
 */
/**
 * LIÊN KẾT HÀNG CỦA ĐƠN VỚI SẢN PHẨM TRONG KHO — không lập phiếu, không trừ kho.
 *
 * Vì sao phải tách riêng (10/09/2026): `productId` của OnlineOrderItem trước đây chỉ
 * được ghi BÊN TRONG convertOnlineOrderToTransaction, tức lúc lập phiếu. Từ 09/09 đơn
 * chờ xác nhận (READY_TO_SHIP / AWAITING_SHIPMENT) không lập phiếu nữa ⇒ không bao
 * giờ được liên kết ⇒ trang đóng gói (kengi.vn/video-online) quét đơn ra
 * "(hàng chưa có mã)" và mất ảnh: nó hiện `item.sku || item.product.sku`, mà hàng
 * Shopee nhiều phân loại thì item_sku TRỐNG. Chủ shop báo 10/09: "đóng hàng không
 * hiện mã hàng nữa" — lỗi do bản 7bf8a21 gộp hai việc vào một hàm.
 *
 * Ba phép khớp Y HỆT hàm lập phiếu, cùng thứ tự: SKU kho không phân biệt hoa thường
 * và DUY NHẤT → bảng ánh xạ SKU → listing OnlineProduct cùng kênh khớp duy nhất.
 * Ánh xạ sang COMBO thì bỏ qua (combo không phải một sản phẩm, lúc lập phiếu mới
 * bung). Nhiều mã trùng nhau thì KHÔNG đoán — y như bên lập phiếu.
 * Trả về số dòng vừa liên kết thêm. Tuần tự, pool prod = 1.
 */
export async function lienKetHangDon(prisma: StorePrisma, orderId: string): Promise<number> {
    const order = await prisma.onlineOrder.findUnique({
        where: { id: orderId },
        select: {
            id: true, platform: true, channelId: true,
            items: { where: { productId: null }, select: { id: true, sku: true, productName: true } },
        },
    })
    if (!order || !order.items?.length) return 0

    let them = 0
    for (const item of order.items) {
        const skuSach = String(item.sku || '').trim() || null
        let productId: string | null = null

        if (skuSach) {
            const ungVien = await prisma.product.findMany({
                where: { sku: { equals: skuSach, mode: 'insensitive' } },
                select: { id: true }, take: 2,
            })
            if (ungVien.length === 1) productId = ungVien[0].id
        }
        if (!productId && skuSach) {
            const map = await prisma.skuMapping.findFirst({
                where: {
                    platformSku: { equals: skuSach, mode: 'insensitive' },
                    OR: [{ platform: null }, { platform: order.platform || undefined }],
                },
            }).catch(() => null)
            if (map && !(map as any).bundleId && map.productId) productId = map.productId
        }
        if (!productId && order.channelId) {
            const ungVien = await prisma.onlineProduct.findMany({
                where: {
                    channelId: order.channelId,
                    localProductId: { not: null },
                    OR: [...(skuSach ? [{ sku: skuSach }] : []), { name: item.productName }],
                },
                select: { localProductId: true }, take: 2,
            })
            if (ungVien.length === 1 && ungVien[0].localProductId) productId = ungVien[0].localProductId
        }

        if (productId) {
            const ok = await prisma.onlineOrderItem.update({ where: { id: item.id }, data: { productId } })
                .then(() => true).catch(() => false)
            if (ok) them++
        }
    }
    return them
}

/** Trần đơn chuyển mỗi lượt/kênh — chặn một đợt tồn đọng làm sập lượt đồng bộ. */
const TRAN_MOI_LUOT = 500

export async function processNewOrders(prisma: StorePrisma, channelId: string): Promise<number> {
    // Find orders that are confirmed/completed but not yet converted to transactions
    /* Đơn đã thử mà không khớp được SKU nào thì CHỈ thử lại mỗi 24h, không phải
     * mỗi lượt. Lý do đầy đủ ở chỗ đặt cờ trong convertOnlineOrderToTransaction.
     *
     * Vì sao vẫn thử lại 24h/lần thay vì loại hẳn: cờ chỉ được xoá qua
     * POST /online-orders/reconvert. Nếu có đường sửa ánh xạ SKU nào tôi chưa nối
     * vào (nhập hàng, đổi SKU sản phẩm, đồng bộ KiotViet…) thì đơn sẽ nằm chết
     * vĩnh viễn mà không ai biết. Một lượt/ngày là giá rẻ để không bỏ sót doanh thu
     * — "chưa khớp được" KHÔNG có nghĩa là "sẽ không bao giờ khớp". */
    const hanThuLai = new Date(Date.now() - 24 * 3600_000)

    /* CHỈ LẤY ĐƠN CHƯA CÓ PHIẾU — lọc ngay trong truy vấn (12/09/2026).
     *
     * Bản cũ lấy TẤT CẢ đơn ở trạng thái lên phiếu rồi nạp TỪNG đơn kèm `items` mới
     * hỏi "đã có phiếu chưa" (convertOnlineOrderToTransaction hỏi ở giữa hàm), nên
     * gần như mỗi lượt là nạp lại hàng nghìn đơn CŨ để vứt đi. Đo 12/09 trên log
     * prod: 2.692 + 2.547 + 1.413 đơn mỗi lượt cho 3 kênh, cứ 30 phút một lần. Máy
     * chủ leo từ ~52% lên trần 512 MiB trong 1,5–3 giờ rồi bị Cloud Run giết — 18 lần
     * trong 5 ngày; cùng cửa sổ có 8 lần cạn kết nối (pool = 1). Máy bị giết lúc
     * 04:17:38 đang đứng ngay trong vòng này.
     *
     * Phép lọc lấy đúng của GET /admin/don-ket: nối trái sang Transaction theo
     * `receiptNumber = 'ONLINE-' || orderNumber` — chính khoá mà hàm chuyển tạo ra,
     * nên "có dòng khớp" = "đã lên phiếu", không phải đoán.
     *
     * TRAN_MOI_LUOT: một đợt tồn đọng (ví dụ 732 đơn kẹt vì listing thiếu SKU, cứ 24h
     * lại tới lượt thử lại) không được phép làm sập một lượt. Xếp đơn CHƯA bị đánh dấu
     * lệch SKU lên trước để đơn mới không bị đám kẹt lâu năm chen chỗ. */
    const trangThaiAnToan = TRANG_THAI_DUOC_LEN_PHIEU.filter(s => /^[A-Za-z_]+$/.test(s))
    if (trangThaiAnToan.length !== TRANG_THAI_DUOC_LEN_PHIEU.length) {
        throw new Error('[OrderSync] Trạng thái lên phiếu có ký tự lạ — không ghép thẳng vào SQL được')
    }
    const dsTrangThai = trangThaiAnToan.map(t => `'${t}'`).join(',')
    const orders: Array<{ id: string; orderNumber: string }> = await prisma.$queryRawUnsafe(
        `SELECT o.id, o."orderNumber"
           FROM "OnlineOrder" o
           LEFT JOIN "Transaction" t ON t."receiptNumber" = 'ONLINE-' || o."orderNumber"
          WHERE o."channelId" = $1
            AND t.id IS NULL
            AND o.status IN (${dsTrangThai})
            AND (o."khongKhopSku" = false OR o."khongKhopLuc" IS NULL OR o."khongKhopLuc" < $2)
          ORDER BY o."khongKhopSku" ASC, o."createdAt" ASC
          LIMIT ${TRAN_MOI_LUOT}`,
        channelId, hanThuLai,
    )
    if (orders.length >= TRAN_MOI_LUOT) {
        console.log(`[OrderSync] Chạm trần ${TRAN_MOI_LUOT} đơn/lượt — còn đơn chưa lên phiếu, lượt sau chạy tiếp`)
    }

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

    /* LIÊN KẾT HÀNG cho đơn CHỜ XÁC NHẬN — chúng không đi qua hàm lập phiếu (nơi
     * liên kết từng được ghi), nên phải quét riêng, xem lienKetHangDon. Chỉ đơn còn
     * dòng chưa liên kết, 7 ngày gần nhất, mới trước, có trần — để một lượt không
     * dài thêm đáng kể (pool = 1). Dòng không khớp được gì sẽ được thử lại mỗi lượt,
     * cho tới khi chủ shop khai ánh xạ SKU hoặc đơn được xác nhận và lên phiếu. */
    try {
        const choLienKet = await prisma.onlineOrder.findMany({
            where: {
                channelId,
                status: { in: [...TRANG_THAI_CHO_XAC_NHAN] },
                createdAt: { gte: new Date(Date.now() - 7 * 86400_000) },
                items: { some: { productId: null } },
            },
            select: { id: true }, orderBy: { createdAt: 'desc' }, take: 150,
        })
        let daLienKet = 0
        for (const o of choLienKet) {
            if (dangTat()) break
            daLienKet += await lienKetHangDon(prisma, o.id)
        }
        if (daLienKet > 0) console.log(`[OrderSync] Liên kết hàng cho đơn chờ xác nhận: ${daLienKet} dòng / ${choLienKet.length} đơn`)
    } catch (err: any) {
        console.error(`[OrderSync] Liên kết hàng đơn chờ xác nhận lỗi: ${moTaLoi(err)}`)
    }

    return converted
}
