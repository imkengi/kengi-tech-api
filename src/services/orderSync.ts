/**
 * Convert completed online orders → Transaction + Inventory deduction
 * Called after sync imports/updates orders
 */

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
    if (!order) return false

    // Only convert orders with statuses that indicate a sale
    const convertibleStatuses = ['confirmed', 'processing', 'shipping', 'completed']
    if (!convertibleStatuses.includes(order.status)) return false

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
    const inventoryUpdates: { productId: string; productName: string; productSku: string; quantity: number }[] = []

    for (const item of order.items) {
        let product = null

        // Try matching by productId first (if already linked)
        if (item.productId) {
            product = await prisma.product.findUnique({ where: { id: item.productId } })
        }

        // Try matching by SKU
        if (!product && item.sku) {
            product = await prisma.product.findFirst({ where: { sku: item.sku } })

            // If found, link the productId for future syncs
            if (product) {
                await prisma.onlineOrderItem.update({
                    where: { id: item.id },
                    data: { productId: product.id },
                }).catch(() => { }) // Ignore if fails
            }
        }

        if (product) {
            transactionItems.push({
                productId: product.id,
                productName: product.name,
                sku: product.sku,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                discount: item.discount || 0,
                lineTotal: item.lineTotal,
            })

            inventoryUpdates.push({
                productId: product.id,
                productName: product.name,
                productSku: product.sku,
                quantity: item.quantity,
            })
        } else {
            // Product not found in system — still add to transaction without productId
            // Skip inventory deduction for unmatched items
            console.log(`[OrderSync] SKU "${item.sku}" not found in inventory for order ${order.orderNumber}`)
        }
    }

    if (transactionItems.length === 0) {
        console.log(`[OrderSync] No matching products for order ${order.orderNumber}, skipping`)
        return false
    }

    // Create Transaction
    await prisma.transaction.create({
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
            createdBy: systemUser.id,
            createdByName: 'Hệ thống',
            notes: `Đơn online ${order.platform || 'Shopee'} - ${order.orderNumber}`,
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

    // Deduct inventory for each matched product
    for (const inv of inventoryUpdates) {
        // Decrease product stock
        await prisma.product.update({
            where: { id: inv.productId },
            data: { stock: { decrement: inv.quantity } },
        })

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
                referenceId: order.id,
                referenceType: 'online_order',
                userId: systemUser.id,
                userName: 'Hệ thống',
                transactionDate: order.createdAt,
            },
        })
    }

    console.log(`[OrderSync] Converted order ${order.orderNumber} → Transaction + ${inventoryUpdates.length} inventory updates`)
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
            status: { in: ['confirmed', 'processing', 'shipping', 'completed'] },
        },
        select: { id: true, orderNumber: true },
    })

    let converted = 0
    for (const order of orders) {
        try {
            const success = await convertOnlineOrderToTransaction(prisma, order.id)
            if (success) converted++
        } catch (err: any) {
            console.error(`[OrderSync] Error converting order ${order.orderNumber}:`, err.message)
        }
    }

    return converted
}
