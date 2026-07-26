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
    if (!extra.autoIssueOnDelivery) return // store chưa bật tự động

    // BỎ QUA hoá đơn quá khứ: chỉ đơn giao TỪ THỜI ĐIỂM BẬT (autoIssueSince).
    // Lookback 7 ngày là lưới an toàn cho đơn lỗi thử lại — lấy mốc MUỘN hơn.
    const lookback = new Date(Date.now() - LOOKBACK_DAYS * 86400_000)
    const anchor = extra.autoIssueSince ? new Date(extra.autoIssueSince) : null
    const from = anchor && anchor > lookback ? anchor : (anchor ? lookback : null)
    if (!from) return // bật kiểu cũ không có mốc neo → không tự xuất, tránh xả lô quá khứ

    const all = await findInvoiceQueue(prisma, { from, limit: PER_STORE_CAP })
    // Đơn có trả hàng/hoàn tiền KHÔNG auto-xuất — chỉ hiện trên UI để xử lý tay
    const rows = all.filter((r: any) => !r.hasReturn)
    const returns = all.length - rows.length
    if (returns > 0) console.log(`[EInvoiceQueue] ${storeName}: bỏ qua ${returns} đơn có trả hàng/hoàn tiền`)
    if (rows.length === 0) return

    let issued = 0, failed = 0
    const errors: string[] = []
    for (const r of rows) {
        try {
            const rs = await issueInvoiceForTransaction(prisma, r.id)
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
