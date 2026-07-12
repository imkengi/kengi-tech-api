import { registryPrisma, getStorePrisma } from '../lib/prisma'
import { checkRepliesForStore } from '../routes/crmEmail'

// Quét IMAP tìm phản hồi email chào hàng — 15 phút/lần, chỉ store có smtpConfig
const INTERVAL_MS = 15 * 60 * 1000

let timer: NodeJS.Timeout | null = null
let running = false

async function tick() {
    if (running) return
    running = true
    try {
        const stores = await registryPrisma.store.findMany({
            where: { status: 'active' },
            select: { schema: true, name: true },
        })
        for (const store of stores) {
            if (!store.schema || store.schema === 'pending') continue
            try {
                const prisma = getStorePrisma(store.schema) as any
                const r = await checkRepliesForStore(prisma)
                if (r.newReplies.length > 0) {
                    console.log(`[EmailReplyCron] ${store.name}: ${r.newReplies.length} phản hồi mới`)
                }
            } catch (e: any) {
                // Store chưa cấu hình / IMAP lỗi — bỏ qua, không chặn store khác
                if (!/SMTP_NOT_CONFIGURED|not exist/i.test(String(e?.message))) {
                    console.warn(`[EmailReplyCron] ${store.name}: ${String(e?.message).slice(0, 120)}`)
                }
            }
        }
    } catch (e: any) {
        console.error('[EmailReplyCron] tick error:', e?.message)
    } finally {
        running = false
    }
}

export function startEmailReplyCron() {
    if (timer) return
    timer = setInterval(tick, INTERVAL_MS)
    // Lần đầu chạy sau 2 phút để không dồn lúc khởi động
    setTimeout(tick, 2 * 60 * 1000)
    console.log('📬 [EmailReplyCron] started (15m interval)')
}

export function stopEmailReplyCron() {
    if (timer) { clearInterval(timer); timer = null }
}
