// ═══════════════════════════════════════════════════════════════════════════════
//  RETURN / REFUND SYNC — shared by the manual sync-returns route and the
//  TikTok webhook (push type 2 = REVERSE_ORDER_STATUS_CHANGE) so returns update
//  per-webhook in realtime, with the manual button as fallback.
// ═══════════════════════════════════════════════════════════════════════════════

import { ShopeeService, TikTokService } from './platforms'
import { postReturnJournal } from '../lib/autoJournalPurchase'
import { PLATFORM_AR } from '../lib/autoJournal'
import { thuGhiSo, sanCuaDon } from '../lib/ghiSoDongBo'
import { reverseOnlineOrderEffects } from './onlineOrderReversal'

export interface ReturnsSyncResult {
    total: number
    synced: number
    skipped: number
    errors: string[]
}

/* ── THÔNG BÁO VỤ TRẢ (06/10/2026) ───────────────────────────────────────────
 * Chủ shop: "sau khi khiếu nại thì có kết quả khiếu nại có trả về thông báo hay
 * không" — đo: KHÔNG. Sync chỉ nối một dòng trạng thái vào ghi chú phiếu. Nay báo
 * (tin + push app Android) hai việc:
 *  1. Vụ trả MỚI từ khách — gộp MỘT tin cho mỗi kênh mỗi lượt sync.
 *  2. KẾT QUẢ KHIẾU NẠI — vụ shop đã khiếu nại (ghi chú có "[Khiếu nại]" / "[Từ chối
 *     TikTok]", do route khiếu nại ghi) đổi sang trạng thái QUYẾT ĐỊNH của sàn.
 * So TRẠNG THÁI GỐC của sàn chứ không chỉ trạng thái quy đổi: bảng quy đổi TikTok còn
 * tên cũ (REQUEST_REJECTED… rơi về 'pending') nên so bản quy đổi là lọt kết quả. */
const DA_KHIEU_NAI = /\[(Khiếu nại|Từ chối TikTok)\]/

/** Trạng thái GỐC cuối cùng đã ghi trong ghi chú ("[Shopee] Status: X" lúc tạo,
 *  "[Shopee] X (giờ)" mỗi lần đổi). */
export function trangThaiGocCuoi(notes: string | null | undefined, san: string): string {
    const re = new RegExp(`\\[${san}\\] (?:Status: )?([A-Z_]+)`, 'g')
    let cuoi = ''
    for (const m of String(notes || '').matchAll(re)) cuoi = m[1] || cuoi
    return cuoi
}

/** Trạng thái mới có phải QUYẾT ĐỊNH của sàn không (bước trung gian như JUDGING,
 *  SELLER_DISPUTE, PROCESSING thì chỉ ghi vào phiếu, không báo). */
export function laQuyetDinh(trangThaiMoi: string, goc: string): boolean {
    return trangThaiMoi !== 'pending' || /REJECT|CANCEL|CLOS|COMPLETE|SUCCESS|REFUND/i.test(goc)
}

export function moTaKetQua(trangThaiMoi: string, goc: string): { tieuDe: string; viec: string } {
    if (trangThaiMoi === 'refunded' || /REFUND_PAID|SUCCESS|COMPLETE/i.test(goc))
        return { tieuDe: 'Kết quả khiếu nại: sàn đã hoàn tiền cho khách', viec: 'nếu khách gửi hàng về, quay video mở hàng lúc nhận' }
    if (trangThaiMoi === 'rejected' || /REJECT|CANCEL|CLOS/i.test(goc))
        return { tieuDe: 'Kết quả khiếu nại: vụ đã đóng, khách không được hoàn tiền', viec: 'không cần làm gì thêm' }
    if (trangThaiMoi === 'approved')
        return { tieuDe: 'Kết quả khiếu nại: sàn chấp nhận yêu cầu trả hàng', viec: 'khách sẽ gửi hàng về — quay video mở hàng lúc nhận' }
    return { tieuDe: 'Vụ đã khiếu nại đổi trạng thái', viec: 'xem chi tiết ở mục Trả hàng' }
}

const tienVnd = (n: number) => `${Math.round(n || 0).toLocaleString('vi-VN')}đ`

async function baoThongBaoVuTra(
    prisma: any, channel: any, san: string,
    vuMoi: { don: string; lyDo: string; daHoan: boolean }[],
    ketQua: { ma: string; don: string; khach: string; tien: number; moi: string; goc: string }[],
): Promise<void> {
    const { sendPushToStore } = await import('../routes/notifications')
    if (vuMoi.length) {
        const tieuDe = vuMoi.length === 1
            ? `↩ Yêu cầu trả hàng mới — ${vuMoi[0]!.don}`
            : `↩ ${vuMoi.length} yêu cầu trả hàng / hoàn tiền mới`
        const noiDung = (`${channel.name} (${san}) · `
            + vuMoi.slice(0, 3).map(v => `${v.don}${v.lyDo ? `: ${v.lyDo}` : ''}${v.daHoan ? ' (đã hoàn tiền)' : ''}`).join(' · ')
            + (vuMoi.length > 3 ? ` (+${vuMoi.length - 3} vụ)` : '')
            + ' — vào Trả hàng để duyệt hoặc khiếu nại.').slice(0, 500)
        const tin = await prisma.notification.create({ data: { type: 'return_request', title: tieuDe, message: noiDung } }).catch(() => null)
        await sendPushToStore(prisma, tieuDe, noiDung.slice(0, 300), { id: tin?.id, type: 'return_request', route: 'returns' })
    }
    for (const k of ketQua.slice(0, 10)) {
        const { tieuDe, viec } = moTaKetQua(k.moi, k.goc)
        const tieuDeDu = `⚖️ ${tieuDe}`
        const noiDung = `Vụ ${k.ma} · đơn ${k.don} · ${k.khach}${k.tien ? ` · ${tienVnd(k.tien)}` : ''} — ${viec}. (${san}: ${k.goc || k.moi})`
        const tin = await prisma.notification.create({ data: { type: 'dispute_result', title: tieuDeDu, message: noiDung.slice(0, 500) } }).catch(() => null)
        await sendPushToStore(prisma, tieuDeDu, noiDung.slice(0, 300), { id: tin?.id, type: 'dispute_result', route: 'returns' })
    }
}

/**
 * Pull return/refund requests from the channel's platform (Shopee or TikTok)
 * since the given date and upsert them as ReturnOrder records. Refunded returns
 * also flip the original online order to returned/refunded.
 */
export async function syncChannelReturns(prisma: any, channel: any, since: Date, until?: Date): Promise<ReturnsSyncResult> {
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

    const platformReturns = await service.fetchReturns({ since, until })

    let synced = 0, skipped = 0
    const errors: string[] = []

    // Sàn còn phiếu mà đã chạm trần phân trang → phải NÓI RA. Trước đây phần dư
    // bị vứt lặng lẽ, "sync đủ" và "sync thiếu" nhìn y hệt nhau — đúng cảm giác
    // "sao thiếu đơn" mà không ai chứng minh được.
    if ((platformReturns as any).truncated) {
        errors.push(`Chạm trần phân trang ${platformLabel} — CÓ PHIẾU BỊ SÓT trong khoảng này, bấm "Kéo từ ngày" với khoảng hẹp hơn để lấy đủ`)
    }

    // ── Vá mã vận đơn TRẢ cho Shopee ─────────────────────────────────────────
    // get_return_list không trả tracking_number (cùng bệnh với get_order_detail
    // không trả tracking_no) → ret.trackingNumber luôn rỗng, dòng "Tracking:" ở
    // notes mãi là N/A dù nhánh làm tươi đã có. Mã thật nằm ở get_return_detail.
    // Chỉ hỏi phiếu KHÁCH PHẢI GỬI HÀNG LẠI (needReturn) và chưa có mã; chặn trần
    // để lượt sync không phình — phiếu chưa tới lượt thì lượt sau hỏi tiếp.
    if (!isTikTok && service instanceof ShopeeService) {
        const DETAIL_CAP = 15
        let asked = 0
        for (const ret of platformReturns) {
            if (asked >= DETAIL_CAP) break
            if (ret.trackingNumber || !ret.needReturn) continue
            asked++
            try {
                const detail = await (service as ShopeeService).getReturnDetail(ret.returnSn)
                if (detail?.trackingNumber) ret.trackingNumber = detail.trackingNumber
            } catch (dErr: any) {
                const m = String(dErr?.message || dErr)
                // Kênh chết (token/proxy) thì các phiếu còn lại cũng vậy — thôi hỏi
                if (/từ chối kênh|error_auth|access_token|thất bại sau/i.test(m)) break
                console.warn(`[Sync Returns] chi tiết phiếu ${ret.returnSn}: ${m}`)
            }
        }
        if (asked > 0) console.log(`[Sync Returns] ${channel.name}: hỏi chi tiết ${asked} phiếu để lấy mã vận đơn trả`)
    }

    const vuMoi: { don: string; lyDo: string; daHoan: boolean }[] = []
    const ketQua: { ma: string; don: string; khach: string; tien: number; moi: string; goc: string }[] = []

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
                // Backfill NGÀY PHIẾU: bản ghi cũ lưu createdAt = lúc sync (sai).
                // Gặp lại phiếu thì nắn về ngày mở yêu cầu trên sàn — lệch >1 ngày
                // mới sửa để tránh ghi đè vô ích.
                const pCreated = ret.createTime instanceof Date && !isNaN(ret.createTime.getTime())
                    ? ret.createTime : null
                if (pCreated && Math.abs(new Date(existingReturn.createdAt).getTime() - pCreated.getTime()) > 86400_000) {
                    await prisma.returnOrder.update({
                        where: { id: existingReturn.id },
                        data: { createdAt: pCreated },
                    }).catch(() => { })
                }
                // Mã vận đơn TRẢ thường được sàn cấp SAU khi phiếu đã tạo (khách mở
                // yêu cầu → notes ghi "Tracking: N/A" → vài ngày sau mới có mã khi
                // khách gửi hàng). Nhánh update cũ chỉ nối thêm dòng trạng thái,
                // không bao giờ làm tươi dòng Tracking → phiếu giữ N/A vĩnh viễn và
                // màn hình "Vận đơn trả" trống. Gặp lại phiếu mà sàn đã có mã thì
                // thay dòng Tracking cũ (parser /returns/list đọc dòng đầu tiên).
                // Gom MỌI thay đổi notes vào một biến rồi ghi MỘT lần — hai lệnh
                // update nối tiếp cùng đọc existingReturn.notes (bản cũ trong bộ
                // nhớ) sẽ ghi đè lẫn nhau.
                let notesMoi = existingReturn.notes || ''
                let notesDoi = false
                if (ret.trackingNumber && !notesMoi.includes(`Tracking: ${ret.trackingNumber}`)) {
                    notesMoi = /Tracking:\s*[^\n]*/.test(notesMoi)
                        ? notesMoi.replace(/Tracking:\s*[^\n]*/, `Tracking: ${ret.trackingNumber}`)
                        : `${notesMoi}\nTracking: ${ret.trackingNumber}`
                    notesDoi = true
                }
                // Update status if changed — hoặc vụ ĐÃ KHIẾU NẠI mà trạng thái GỐC của sàn đổi
                // (TikTok: tên mới chưa có trong bảng quy đổi vẫn phải thấy kết quả).
                const daKhieuNai = DA_KHIEU_NAI.test(existingReturn.notes || '')
                const gocCu = trangThaiGocCuoi(existingReturn.notes, platformLabel)
                const doiGoc = daKhieuNai && !!nativeStatus && !!gocCu && gocCu !== nativeStatus
                const doiTrangThai = existingReturn.status !== ret.status
                if (doiTrangThai || doiGoc) {
                    // Chốt bằng trạng thái + ghi chú CŨ: cron và webhook TikTok có thể chạy
                    // chồng — lượt về sau thấy count=0 thì không ghi đè, không báo lần hai.
                    const doi = await prisma.returnOrder.updateMany({
                        where: { id: existingReturn.id, status: existingReturn.status, notes: existingReturn.notes },
                        data: {
                            status: ret.status,
                            notes: `${notesMoi}\n[${platformLabel}] ${nativeStatus} (${new Date().toLocaleString('vi-VN')})`,
                            ...(doiTrangThai && ret.status === 'refunded' ? { refundedAt: new Date(), processedAt: new Date() } : {}),
                        },
                    })
                    // Trạng thái quy đổi KHÔNG đổi (vd TikTok AWAITING_BUYER_SHIP → BUYER_SHIPPED_ITEM,
                    // cùng 'approved') thì chỉ báo khi trạng thái gốc là quyết định thật.
                    const baoKetQua = doiTrangThai
                        ? laQuyetDinh(ret.status, nativeStatus)
                        : /REJECT|CANCEL|CLOS|COMPLETE|SUCCESS|REFUND/i.test(nativeStatus)
                    if (doi.count === 1 && daKhieuNai && baoKetQua) {
                        ketQua.push({
                            ma: ret.returnSn, don: existingReturn.originalInvoice || ret.orderSn,
                            khach: existingReturn.customerName || '', tien: existingReturn.refundAmount || 0,
                            moi: ret.status, goc: nativeStatus,
                        })
                    }

                    // If refunded, update order status + đảo hiệu ứng của đơn
                    // (hoàn kho + void HĐ đã convert + đảo bút toán) — idempotent
                    if (doi.count === 1 && doiTrangThai && ret.status === 'refunded') {
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
                } else if (notesDoi) {
                    // Trạng thái không đổi nhưng sàn vừa cấp mã vận đơn trả → vẫn
                    // phải ghi, không thì dòng Tracking mới chỉ nằm trong bộ nhớ.
                    await prisma.returnOrder.update({
                        where: { id: existingReturn.id },
                        data: { notes: notesMoi },
                    }).catch(() => { })
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

            // NGÀY PHIẾU = ngày khách mở yêu cầu trả TRÊN SÀN (ret.createTime),
            // KHÔNG phải lúc chạy sync. Trước đây bỏ trống → createdAt = now()
            // nên mọi phiếu (kể cả trả từ tháng 6) đều đội ngày sync → nhìn như
            // "trước ngày sync đầu tiên không có phiếu nào".
            const platformCreatedAt = ret.createTime instanceof Date && !isNaN(ret.createTime.getTime())
                ? ret.createTime : undefined

            await prisma.returnOrder.create({
                data: {
                    code: returnCode,
                    channelId: channel.id,
                    ...(platformCreatedAt ? { createdAt: platformCreatedAt } : {}),
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

            /* GHI SỔ (03/09/2026 — điểm đứt 3): Nợ 5212 / Có 131-<SÀN>.
             *
             * CHỈ ghi khi phiếu đã ở trạng thái HOÀN TIỀN. Phiếu trả đang chờ duyệt
             * chưa phải nghiệp vụ kế toán — ghi sớm là giảm doanh thu cho một khoản
             * sàn có thể từ chối.
             *
             * Đối ứng là 131-<SÀN> chứ không phải 111: sàn hoàn tiền bằng cách trừ
             * vào khoản họ còn nợ shop, tiền không ra khỏi quỹ. Ghi Có 111 là làm
             * hụt sổ quỹ tiền mặt một khoản không có thật.
             *
             * KHÔNG ghi vế nhập lại kho (Nợ 156 / Có 632): hàng trả từ sàn thường
             * chưa về tới kho lúc này, và sàn không cho biết giá vốn. */
            if (ret.status === 'refunded') {
                const tkSan = PLATFORM_AR[sanCuaDon(platformLabel)]!
                await thuGhiSo(`Trả hàng sàn ${returnCode}`, () => postReturnJournal(prisma, {
                    code: returnCode,
                    customerName: order?.customerName || `Khách ${platformLabel}`,
                    originalInvoice: order?.orderNumber || ret.orderSn,
                    totalRefund: refundAmount,
                    refundMethod: 'platform_refund',
                    costValue: 0,
                    createdAt: platformCreatedAt || ret.updateTime || new Date(),
                    taiKhoanDoiUng: { code: tkSan.account, name: tkSan.name },
                }, {}))
            }

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

            vuMoi.push({
                don: order?.orderNumber || ret.orderSn,
                lyDo: String(ret.reason || ret.textReason || '').slice(0, 60),
                daHoan: ret.status === 'refunded',
            })
            synced++
        } catch (itemErr: any) {
            errors.push(`Return ${ret.returnSn}: ${itemErr.message}`)
        }
    }

    // Báo sau cùng — thông báo hỏng KHÔNG được làm hỏng lượt sync
    if (vuMoi.length || ketQua.length) {
        await baoThongBaoVuTra(prisma, channel, platformLabel, vuMoi, ketQua)
            .catch((e: any) => console.error(`[Sync Returns] thông báo ${channel.name}:`, e?.message || e))
    }

    return { total: platformReturns.length, synced, skipped, errors }
}
