import { registryPrisma, getStorePrisma } from '../lib/prisma'
import { getPlatformService, type PlatformOrder } from '../services/platforms'
import { processNewOrders } from '../services/orderSync'

const SYNC_INTERVAL    = 10 * 60 * 1000       // 10 phút
const CLEANUP_INTERVAL = 24 * 60 * 60 * 1000  // 24 tiếng
const CLEANUP_DAYS     = 18                    // Xóa đơn cũ hơn 18 ngày

let syncTimer:    NodeJS.Timeout | null = null
let cleanupTimer: NodeJS.Timeout | null = null

/**
 * Sync orders for a single channel
 */
async function syncChannel(storePrisma: any, channel: any): Promise<{ imported: number; updated: number; errors: string[] }> {
    const service = getPlatformService(channel.platform, {
        apiKey: channel.apiKey || '', apiSecret: channel.apiSecret || '',
        accessToken: channel.accessToken || undefined,
        refreshToken: channel.refreshToken || undefined,
        shopId: channel.shopId || undefined,
    })
    if (!service) return { imported: 0, updated: 0, errors: ['Platform not supported'] }

    const since = channel.lastSyncAt || new Date(Date.now() - 7 * 86400_000)
    let allOrders: PlatformOrder[] = []
    let page = 1
    let hasMore = true

    while (hasMore && page <= 10) {
        const result = await service.fetchOrders({ since, page, pageSize: 50 })
        allOrders = allOrders.concat(result.orders)
        hasMore = result.hasMore
        page++
    }

    let imported = 0, updated = 0
    const errors: string[] = []

    for (const order of allOrders) {
        try {
            const existing = await storePrisma.onlineOrder.findFirst({
                where: { externalOrderId: order.externalOrderId, channelId: channel.id },
            })
            if (existing) {
                await storePrisma.onlineOrder.update({
                    where: { id: existing.id },
                    data: {
                        status: order.status,
                        externalStatus: order.externalStatus,
                        paymentStatus: order.paymentStatus,
                        trackingNumber: order.trackingNumber || existing.trackingNumber,
                        shippingCarrier: order.shippingCarrier || existing.shippingCarrier,
                        shippedAt: order.shippedAt ? new Date(order.shippedAt) : existing.shippedAt,
                        deliveredAt: order.deliveredAt ? new Date(order.deliveredAt) : existing.deliveredAt,
                        paidAt: order.paidAt ? new Date(order.paidAt) : existing.paidAt,
                        syncedAt: new Date(),
                    },
                })
                updated++
            } else {
                await storePrisma.onlineOrder.create({
                    data: {
                        orderNumber: order.orderNumber,
                        channelId: channel.id,
                        channelName: channel.name,
                        platform: order.platform,
                        externalOrderId: order.externalOrderId,
                        externalStatus: order.externalStatus,
                        customerName: order.customerName,
                        customerPhone: order.customerPhone || null,
                        customerEmail: order.customerEmail || null,
                        shippingAddress: order.shippingAddress || null,
                        status: order.status,
                        subtotal: order.subtotal,
                        discount: order.discount,
                        shippingFee: order.shippingFee,
                        total: order.total,
                        paymentMethod: order.paymentMethod || null,
                        paymentStatus: order.paymentStatus,
                        trackingNumber: order.trackingNumber || null,
                        shippingCarrier: order.shippingCarrier || null,
                        paidAt: order.paidAt ? new Date(order.paidAt) : null,
                        shippedAt: order.shippedAt ? new Date(order.shippedAt) : null,
                        deliveredAt: order.deliveredAt ? new Date(order.deliveredAt) : null,
                        syncedAt: new Date(),
                        createdAt: new Date(order.createdAt),
                        items: {
                            create: order.items.map(item => ({
                                productName: item.productName,
                                sku: item.sku || null,
                                quantity: item.quantity,
                                unitPrice: item.unitPrice,
                                discount: item.discount,
                                lineTotal: item.lineTotal,
                            })),
                        },
                    },
                })
                imported++
            }
        } catch (e: any) {
            errors.push(`Order ${order.orderNumber}: ${e.message}`)
        }
    }

    // Update channel stats
    const orderStats = await storePrisma.onlineOrder.aggregate({
        where: { channelId: channel.id },
        _count: true,
        _sum: { total: true },
    })
    await storePrisma.onlineChannel.update({
        where: { id: channel.id },
        data: {
            lastSyncAt: new Date(),
            totalOrders: orderStats._count,
            totalRevenue: orderStats._sum.total || 0,
        },
    })

    // Log sync
    await storePrisma.syncLog.create({
        data: {
            channelId: channel.id,
            action: 'auto_sync',
            status: errors.length > 0 ? 'partial' : 'success',
            details: `Auto-sync: Imported ${imported}, Updated ${updated}, Errors ${errors.length}`,
            ordersCount: imported + updated,
        },
    })

    return { imported, updated, errors }
}

/**
 * Run auto-sync for all stores with connected channels
 */
async function runAutoSync() {
    try {
        // Get all active stores
        const stores = await registryPrisma.store.findMany({ where: { status: 'active' } }) as any[]
        let totalSynced = 0

        for (const store of stores) {
            try {
                const storePrisma = getStorePrisma(store.schemaName)

                // Find channels with access tokens (connected)
                const channels = await storePrisma.onlineChannel.findMany({
                    where: {
                        status: 'active',
                        accessToken: { not: null },
                    },
                })

                for (const channel of channels) {
                    try {
                        const result = await syncChannel(storePrisma, channel)
                        if (result.imported > 0 || result.updated > 0) {
                            console.log(`[AutoSync] ${store.name}/${channel.name}: +${result.imported} new, ${result.updated} updated`)
                            totalSynced += result.imported + result.updated
                        }
                        // Convert eligible orders to transactions + inventory
                        const converted = await processNewOrders(storePrisma, channel.id)
                        if (converted > 0) {
                            console.log(`[AutoSync] ${store.name}/${channel.name}: ${converted} orders → transactions`)
                        }
                    } catch (err: any) {
                        console.error(`[AutoSync] Error syncing ${store.name}/${channel.name}:`, err.message)
                    }
                }
            } catch (err: any) {
                // Store might not have onlineChannel table yet — skip silently
                if (!err.message?.includes('does not exist')) {
                    console.error(`[AutoSync] Error processing store ${store.name}:`, err.message)
                }
            }
        }

        if (totalSynced > 0) {
            console.log(`[AutoSync] Completed: ${totalSynced} orders synced across ${stores.length} stores`)
        }
    } catch (err: any) {
        console.error('[AutoSync] Fatal error:', err.message)
    }
}

// ═══════════════════════════════════════════════════════════
//  CLEANUP — Xóa đơn COMPLETED/CANCELLED cũ hơn 18 ngày
// ═══════════════════════════════════════════════════════════

async function runCleanup() {
    const cutoff = new Date(Date.now() - CLEANUP_DAYS * 86400_000)
    const cleanStatuses = ['COMPLETED', 'completed', 'CANCELLED', 'cancelled', 'TO_RETURN', 'returned']

    try {
        const stores = await registryPrisma.store.findMany({ where: { status: 'active' } }) as any[]
        let totalDeleted = 0

        for (const store of stores) {
            try {
                const storePrisma = getStorePrisma(store.schemaName)

                // Lấy danh sách id đơn cũ cần xóa
                const oldOrders = await storePrisma.onlineOrder.findMany({
                    where: {
                        status:    { in: cleanStatuses },
                        updatedAt: { lt: cutoff },
                    },
                    select: { id: true, orderNumber: true },
                })

                if (oldOrders.length === 0) continue

                const ids = oldOrders.map((o: any) => o.id)

                // Xóa items trước (cascade nếu DB không tự xóa)
                await storePrisma.onlineOrderItem.deleteMany({
                    where: { onlineOrderId: { in: ids } },
                })

                // Xóa đơn hàng
                const result = await storePrisma.onlineOrder.deleteMany({
                    where: { id: { in: ids } },
                })

                totalDeleted += result.count
                console.log(`[Cleanup] ${store.name}: xóa ${result.count} đơn cũ (>${CLEANUP_DAYS} ngày): ${oldOrders.slice(0, 5).map((o: any) => o.orderNumber).join(', ')}${oldOrders.length > 5 ? '...' : ''}`)

                // Cập nhật lại stats kênh
                const channels = await storePrisma.onlineChannel.findMany({ select: { id: true } })
                for (const ch of channels) {
                    const agg = await storePrisma.onlineOrder.aggregate({
                        where: { channelId: ch.id },
                        _count: true,
                        _sum: { total: true },
                    })
                    await storePrisma.onlineChannel.update({
                        where: { id: ch.id },
                        data: { totalOrders: agg._count, totalRevenue: agg._sum.total || 0 },
                    }).catch(() => {})
                }
            } catch (err: any) {
                if (!err.message?.includes('does not exist')) {
                    console.error(`[Cleanup] Error on store ${store.name}:`, err.message)
                }
            }
        }

        if (totalDeleted > 0) {
            console.log(`[Cleanup] Hoàn thành: đã xóa ${totalDeleted} đơn cũ trên ${stores.length} cửa hàng`)
        }
    } catch (err: any) {
        console.error('[Cleanup] Fatal error:', err.message)
    }
}

/**
 * Start the auto-sync cron
 */
export function startAutoSync() {
    if (syncTimer) return
    console.log(`⏰ Auto-sync started (every ${SYNC_INTERVAL / 60000} minutes)`)

    // Run first sync after 30 seconds (let server warm up)
    setTimeout(() => {
        runAutoSync()
        syncTimer = setInterval(runAutoSync, SYNC_INTERVAL)
    }, 30_000)

    // Cleanup chạy lần đầu sau 5 phút (tránh xung đột lúc khởi động), sau đó mỗi 24h
    setTimeout(() => {
        runCleanup()
        cleanupTimer = setInterval(runCleanup, CLEANUP_INTERVAL)
    }, 5 * 60_000)

    console.log(`🧹 Auto-cleanup started (every 24h, orders >${CLEANUP_DAYS} days old)`)
}

/**
 * Stop the auto-sync cron
 */
export function stopAutoSync() {
    if (syncTimer) {
        clearInterval(syncTimer)
        syncTimer = null
        console.log('⏰ Auto-sync stopped')
    }
    if (cleanupTimer) {
        clearInterval(cleanupTimer)
        cleanupTimer = null
        console.log('🧹 Auto-cleanup stopped')
    }
}
