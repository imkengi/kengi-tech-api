// Cron webhook đầu ra: refresh cờ fast-path (30s) + drain hàng đợi giao (12s).
import { processWebhookQueue, refreshWebhookRegistry } from '../lib/webhookDispatch'

let drainTimer: NodeJS.Timeout | null = null
let refreshTimer: NodeJS.Timeout | null = null

export function startWebhookCron(): void {
    // Refresh ngay khi boot để cờ anyWebhooksExist đúng sớm nhất có thể.
    refreshWebhookRegistry().catch(() => { })

    refreshTimer = setInterval(() => {
        refreshWebhookRegistry().catch(() => { })
    }, 30_000)

    drainTimer = setInterval(() => {
        processWebhookQueue().catch(() => { })
    }, 12_000)

    console.log('🪝 Webhook cron started (refresh 30s, drain 12s)')
}

export function stopWebhookCron(): void {
    if (drainTimer) clearInterval(drainTimer)
    if (refreshTimer) clearInterval(refreshTimer)
    drainTimer = null
    refreshTimer = null
}
