import { registryPrisma, getStorePrisma } from '../lib/prisma'
import {
    ensureEInvoiceTablesFor, getActiveConfig, parseConfigExtra,
    findInvoiceQueue, issueInvoiceForTransaction,
} from '../routes/einvoice'

/**
 * HÀNG ĐỢI XUẤT HOÁ ĐƠN THEO NGÀY — yêu cầu cơ quan thuế: chỉ xuất hoá đơn khi
 * khách NHẬN HÀNG thành công.
 *
 * Mỗi tối 20h30 VN (13:30 UTC) chạy 1 lần: với từng store đã BẬT cờ
 * autoIssueOnDelivery (PUT /einvoice/queue/auto) và có cấu hình NCC hoá đơn:
 * gom các phiếu bán online mà đơn gốc đã giao xong trong 7 ngày gần nhất và
 * chưa có hoá đơn → xuất lần lượt qua NCC. Idempotent (đơn đã có HĐ bị bỏ qua),
 * lỗi hôm nay tự thử lại tối hôm sau.
 *
 * Đơn POS bán trực tiếp (khách nhận tại quầy) KHÔNG vào hàng đợi này — xuất
 * theo luồng thủ công/POS như cũ.
 */

const RUN_HOUR_UTC = 13   // 20h30 VN — sau giờ các sàn chốt trạng thái giao trong ngày
const RUN_MINUTE = 30
const LOOKBACK_DAYS = 7
const PER_STORE_CAP = 300

let timer: NodeJS.Timeout | null = null
let lastRunDate = ''       // YYYY-MM-DD UTC — chống chạy lặp trong ngày
let running = false

async function runQueueForStore(schema: string, storeName: string): Promise<void> {
    const prisma = getStorePrisma(schema)
    await ensureEInvoiceTablesFor(prisma, schema)

    const config = await getActiveConfig(prisma)
    if (!config) return
    const extra = parseConfigExtra(config)

    // Hai chế độ chạy song song:
    // 1) auto TOÀN CỤC (autoIssueOnDelivery): xuất mọi đơn giao xong từ mốc bật.
    // 2) đơn KHÁCH YÊU CẦU HĐ (vatBuyerInfo gắn trên phiếu): LUÔN tự xuất khi
    //    giao xong + gửi email — kể cả khi auto toàn cục tắt.
    const lookback = new Date(Date.now() - LOOKBACK_DAYS * 86400_000)
    const anchor = extra.autoIssueSince ? new Date(extra.autoIssueSince) : null
    // Mốc đủ điều kiện = ĐÚNG lúc bật nút, KHÔNG kẹp về 7 ngày. Bản cũ kẹp
    // `anchor > lookback ? anchor : lookback` rồi quét từ lookback → đơn giao
    // xong muộn (trạng thái sàn về trễ), đêm cron lỗi, hay chạm trần vài đêm
    // liền là rơi khỏi cửa sổ 7 ngày VĨNH VIỄN — sót hoá đơn với CQT.
    const autoFrom = extra.autoIssueOnDelivery && anchor ? anchor : null

    // Quét từ mốc bật nút để gom hết tồn đọng. findInvoiceQueue xếp ASC (cũ
    // trước) + trần 300/đêm nên tồn nhiều thì rút dần qua các đêm, không phình
    // một lượt chạy. Auto tắt thì giữ cửa sổ 7 ngày cho nhánh khách-yêu-cầu-HĐ.
    const sweepFrom = autoFrom && autoFrom < lookback ? autoFrom : lookback
    const all = await findInvoiceQueue(prisma, { from: sweepFrom, limit: PER_STORE_CAP })
    // Đơn có trả hàng/hoàn tiền KHÔNG auto-xuất — chỉ hiện trên UI để xử lý tay
    const clean = all.filter((r: any) => !r.hasReturn)
    const returns = all.length - clean.length
    if (returns > 0) console.log(`[EInvoiceQueue] ${storeName}: bỏ qua ${returns} đơn có trả hàng/hoàn tiền`)
    const rows = clean.filter((r: any) => r.hasBuyerInfo
        || (autoFrom && new Date(r.deliveredAt || r.orderDate) >= autoFrom))
    if (rows.length === 0) return

    let issued = 0, failed = 0
    const errors: string[] = []
    for (const r of rows) {
        try {
            const rs = await issueInvoiceForTransaction(prisma, r.id, {}, schema)
            if (rs.success && !rs.skipped) issued++
            else if (!rs.success) {
                failed++
                if (errors.length < 3) errors.push(`${r.receiptNumber}: ${rs.error}`)
            }
        } catch (e: any) {
            failed++
            if (errors.length < 3) errors.push(`${r.receiptNumber}: ${e?.message || e}`)
        }
        // Nhẹ tay với API NCC hoá đơn
        await new Promise((r2) => setTimeout(r2, 300))
    }
    console.log(`[EInvoiceQueue] ${storeName}: ${rows.length} phiếu đủ điều kiện → xuất ${issued}, lỗi ${failed}` +
        (errors.length ? ` | ${errors.join('; ')}` : ''))
    // Thông báo tổng kết đêm (web + app Android đọc chung GET /notifications)
    if (issued > 0 || failed > 0) {
        await (prisma as any).notification.create({
            data: {
                type: 'einvoice',
                title: `🧾 Tự động xuất hoá đơn: ${issued} thành công${failed ? `, ${failed} lỗi` : ''}`,
                message: `Cron 20:30 xử lý ${rows.length} phiếu đủ điều kiện.` + (errors.length ? ` Lỗi: ${errors.join('; ')}`.slice(0, 300) : ''),
            },
        }).catch(() => { })
    }
    if (rows.length >= PER_STORE_CAP) {
        console.warn(`[EInvoiceQueue] ${storeName}: chạm trần ${PER_STORE_CAP} phiếu/đêm — phần còn lại xuất đêm sau`)
    }
}

async function runQueue(): Promise<void> {
    if (running) return
    running = true
    try {
        const stores = await registryPrisma.store.findMany({
            where: { status: 'active', hasOnlineChannels: true } as any,
        }) as any[]
        for (const store of stores) {
            try {
                await runQueueForStore(store.schema, store.name)
            } catch (e: any) {
                if (!String(e?.message || '').includes('does not exist')) {
                    console.error(`[EInvoiceQueue] Lỗi store ${store.name}:`, e?.message || e)
                }
            }
        }
    } catch (e: any) {
        console.error('[EInvoiceQueue] Fatal:', e?.message || e)
    } finally {
        running = false
    }
}

export function startEInvoiceQueueCron(): void {
    if (timer) return
    console.log(`🧾 E-invoice queue cron started (daily ${RUN_HOUR_UTC}:${RUN_MINUTE} UTC = 20:30 VN)`)
    // Tick 10 phút: tới giờ + chưa chạy hôm nay → chạy. Instance restart giữa
    // ngày không sao — issueInvoiceForTransaction idempotent.
    timer = setInterval(() => {
        const now = new Date()
        const today = now.toISOString().slice(0, 10)
        if (lastRunDate === today) return
        if (now.getUTCHours() === RUN_HOUR_UTC && now.getUTCMinutes() >= RUN_MINUTE) {
            lastRunDate = today
            runQueue()
        }
    }, 10 * 60_000)
}

export function stopEInvoiceQueueCron(): void {
    if (timer) { clearInterval(timer); timer = null }
}
