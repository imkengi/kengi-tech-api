// ═══════════════════════════════════════════════════════════════════════════════
//  RETURN / REFUND SYNC — shared by the manual sync-returns route and the
//  TikTok webhook (push type 2 = REVERSE_ORDER_STATUS_CHANGE) so returns update
//  per-webhook in realtime, with the manual button as fallback.
// ═══════════════════════════════════════════════════════════════════════════════

import { ShopeeService, TikTokService } from './platforms'
import { reverseOnlineOrderEffects } from './onlineOrderReversal'

export interface ReturnsSyncResult {
    total: number
    synced: number
    skipped: number
    errors: string[]
}

/**
 * Pull return/refund requests from the channel's platform (Shopee or TikTok)
 * since the given date and upsert them as ReturnOrder records. Refunded returns
 * also flip the original online order to returned/refunded.
 */
export async function syncChannelReturns(prisma: any, channel: any, since: Date): Promise<ReturnsSyncResult> {
    const isTikTok = channel.platform === 'tiktok'
    const platformLabel = isTikTok ? 'TikTok' : 'Shopee'
    // Mã phiếu trả khác prefix theo sàn để dedup không đụng nhau
    const codePrefix = isTikTok ? 'RTN-TT-' : 'RTN-SH-'

    const creds = {
        apiKey: channel.apiKey || '', apiSecret: channel.apiSecret || '',
        accessToken: channel.accessToken || undefined,
        refreshToken: channel.refreshToken || undefined,
        shopId: channel.shopId || undefined,
    }
    const service = isTikTok ? new TikTokService(creds) : new ShopeeService(creds)

    // Auto-refresh token if expired or about to expire (5 min buffer)
    const tokenExpiresAt = channel.tokenExpiresAt
    if (tokenExpiresAt && new Date(tokenExpiresAt).getTime() < Date.now() + 5 * 60 * 1000) {
        try {
            const tokens = await service.refreshAccessToken();
            (service as any).credentials.accessToken = tokens.accessToken;
            (service as any).credentials.refreshToken = tokens.refreshToken;
            await prisma.onlineChannel.update({
                where: { id: channel.id },
                data: {
                    accessToken: tokens.accessToken,
                    refreshToken: tokens.refreshToken,
                    tokenExpiresAt: new Date(Date.now() + tokens.expiresIn * 1000),
                },
            })
        } catch (refreshErr: any) {
            console.error(`[Sync Returns] ${platformLabel} token refresh failed:`, refreshErr.message)
        }
    }

    const platformReturns = await service.fetchReturns({ since })

    let synced = 0, skipped = 0
    const errors: string[] = []

    for (const ret of platformReturns) {
        try {
            const nativeStatus = (ret as any).platformStatus || (ret as any).shopeeStatus || ''
            // Check if already synced
            const existingReturn = await prisma.returnOrder.findFirst({
                where: { code: `${codePrefix}${ret.returnSn}` },
            })
            if (existingReturn) {
                // Backfill channelId for returns synced before the column existed
                if (!existingReturn.channelId) {
                    await prisma.returnOrder.update({
                        where: { id: existingReturn.id },
                        data: { channelId: channel.id },
                    }).catch(() => { })
                }
                // Update status if changed
                if (existingReturn.status !== ret.status) {
                    await prisma.returnOrder.update({
                        where: { id: existingReturn.id },
                        data: {
                            status: ret.status,
                            notes: `${existingReturn.notes || ''}\n[${platformLabel}] ${nativeStatus} (${new Date().toLocaleString('vi-VN')})`,
                            ...(ret.status === 'refunded' ? { refundedAt: new Date(), processedAt: new Date() } : {}),
                        },
                    })

                    // If refunded, update order status + đảo hiệu ứng của đơn
                    // (hoàn kho + void HĐ đã convert + đảo bút toán) — idempotent
                    if (ret.status === 'refunded') {
                        const order = await prisma.onlineOrder.findFirst({
                            where: { externalOrderId: ret.orderSn, channelId: channel.id },
                        })
                        if (order) {
                            await prisma.onlineOrder.update({
                                where: { id: order.id },
                                data: { status: 'returned', paymentStatus: 'refunded' },
                            })
                            try {
                                await reverseOnlineOrderEffects(prisma, order, { reason: `Hoàn tiền ${platformLabel} - phiếu ${ret.returnSn}` })
                            } catch (revErr: any) {
                                console.error(`[Sync Returns] Reversal failed for ${order.orderNumber}:`, revErr.message)
                            }
                        }
                    }
                }
                skipped++
                continue
            }

            // Find original order
            const order = await prisma.onlineOrder.findFirst({
                where: { externalOrderId: ret.orderSn, channelId: channel.id },
                include: { items: true },
            })

            // Create ReturnOrder
            const returnCode = `${codePrefix}${ret.returnSn}`
            const refundAmount = typeof ret.refundAmount === 'number' ? ret.refundAmount : 0

            // Lấy sku + productId từ OnlineOrderItem của đơn gốc — nếu để sku rỗng
            // thì phiếu trả từ sàn không bao giờ hoàn kho được. Match theo thứ tự:
            // externalItemId (Shopee item_id / TikTok order_line_item_id) → tên SP
            // → nếu đơn chỉ có 1 item thì lấy luôn item đó.
            const orderItems: any[] = order?.items || []
            const matchOrderItem = (i: any) => {
                const rid = String(i.itemId || '')
                return (rid && orderItems.find((oi: any) => String(oi.externalItemId || '') === rid))
                    || orderItems.find((oi: any) => i.name && oi.productName === i.name)
                    || (orderItems.length === 1 ? orderItems[0] : undefined)
            }
            const returnItems = ret.items.map((i: any) => {
                const oi = matchOrderItem(i)
                return {
                    productId: oi?.productId || undefined,
                    productName: i.name || i.modelName || oi?.productName || `SP ${platformLabel}`,
                    sku: oi?.sku || '',
                    quantity: i.amount || 1,
                    unitPrice: i.itemPrice || 0,
                    returnReason: ret.reason || ret.textReason || `Trả hàng từ ${platformLabel}`,
                    condition: 'used',
                }
            })

            await prisma.returnOrder.create({
                data: {
                    code: returnCode,
                    channelId: channel.id,
                    originalInvoice: order?.orderNumber || ret.orderSn,
                    customerName: order?.customerName || `Khách ${platformLabel}`,
                    customerPhone: order?.customerPhone || undefined,
                    reason: ret.reason || ret.textReason || `Trả hàng từ ${platformLabel}`,
                    refundMethod: 'platform_refund',
                    refundAmount,
                    totalRefund: refundAmount,
                    notes: `[${platformLabel}] Status: ${nativeStatus}\nReturn SN: ${ret.returnSn}\nTracking: ${ret.trackingNumber || 'N/A'}\nNeed return: ${ret.needReturn ? 'Có' : 'Không'}`,
                    staffName: `${platformLabel} Auto-Sync`,
                    status: ret.status,
                    ...(ret.status === 'refunded' ? { refundedAt: ret.updateTime, processedAt: ret.updateTime } : {}),
                    items: {
                        create: returnItems.length > 0 ? returnItems : [{
                            productName: `SP từ ${platformLabel}`,
                            quantity: 1,
                            unitPrice: refundAmount,
                            returnReason: ret.reason || `Trả hàng ${platformLabel}`,
                            condition: 'used',
                        }],
                    },
                },
            })

            // Update order status if refunded + đảo hiệu ứng (kho/HĐ/bút toán)
            if (order && ret.status === 'refunded') {
                await prisma.onlineOrder.update({
                    where: { id: order.id },
                    data: { status: 'returned', paymentStatus: 'refunded' },
                })
                try {
                    await reverseOnlineOrderEffects(prisma, order, { reason: `Hoàn tiền ${platformLabel} - phiếu ${ret.returnSn}` })
                } catch (revErr: any) {
                    console.error(`[Sync Returns] Reversal failed for ${order.orderNumber}:`, revErr.message)
                }
            }

            synced++
        } catch (itemErr: any) {
            errors.push(`Return ${ret.returnSn}: ${itemErr.message}`)
        }
    }

    return { total: platformReturns.length, synced, skipped, errors }
}
