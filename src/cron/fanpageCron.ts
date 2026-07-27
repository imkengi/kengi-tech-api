// ═══════════════════════════════════════════════════════════════════════════════
//  FANPAGE CRON
//   1. Đối soát bài đã lên lịch (mirror ⇄ FB) → cập nhật status published/failed
//   2. Heal token page qua user token (page token hết hiệu lực khi user token đổi)
//   3. Fallback poll auto-reply cho page bật auto-reply nhưng chưa có webhook
// ═══════════════════════════════════════════════════════════════════════════════

import { registryPrisma, getStorePrisma } from '../lib/prisma'
import { FacebookService, isRateLimitError } from '../services/platforms/facebook'
import { pollAndAutoReply } from '../services/fanpageAutoReply'

const RECONCILE_INTERVAL = 5 * 60 * 1000 // 5 phút
const TOKEN_REFRESH_BUFFER = 7 * 86400_000 // refresh khi còn < 7 ngày
const GRAPH_THROTTLE_MS = 300 // nghỉ giữa các call Graph liên tiếp (tránh rate-limit)
const HEAL_RETRY_COOLDOWN = 60 * 60 * 1000 // heal thất bại → chỉ thử lại sau 60 phút

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

// Mốc heal thất bại gần nhất theo schema store (giữ trong bộ nhớ process là đủ)
const healFailedAt = new Map<string, number>()

let timer: NodeJS.Timeout | null = null

/** Đối soát bài lên lịch của 1 page với danh sách scheduled_posts live trên FB. */
async function reconcilePage(storePrisma: any, page: any): Promise<void> {
    const pending = await storePrisma.fbScheduledPost.findMany({
        where: { pageId: page.pageId, status: 'scheduled' },
    })
    if (!pending.length) return

    const svc = new FacebookService(page.accessToken)
    let liveIds: Set<string>
    try {
        const live = await svc.listScheduledPosts(page.pageId)
        liveIds = new Set(live.map(p => p.id))
    } catch (e: any) {
        if (e?.isTokenError) {
            await storePrisma.fbPage.update({ where: { pageId: page.pageId }, data: { status: 'token_expired' } }).catch(() => { })
        }
        // Rate-limit Graph → dừng chu kỳ page này, sang page khác
        if (isRateLimitError(e)) {
            console.warn(`[FanpageCron] Rate-limit Graph (page ${page.name || page.pageId}) — bỏ qua chu kỳ này`)
        }
        return
    }

    const now = Date.now()
    for (const rec of pending) {
        if (!rec.fbPostId) continue
        const stillScheduled = liveIds.has(rec.fbPostId)
        if (stillScheduled) continue
        // Không còn trong hàng chờ FB:
        //  - đã qua giờ hẹn → coi như đã đăng
        //  - chưa tới giờ hẹn → có thể bị xoá ngoài tool → đánh dấu cancelled
        if (new Date(rec.scheduledAt).getTime() <= now + 60_000) {
            await storePrisma.fbScheduledPost.update({ where: { id: rec.id }, data: { status: 'published', publishedAt: new Date() } })
        } else {
            await storePrisma.fbScheduledPost.update({ where: { id: rec.id }, data: { status: 'cancelled' } })
        }
    }
}

/** Heal token page qua user token còn hiệu lực. */
async function healPageTokens(storePrisma: any, storeKey: string): Promise<void> {
    // Heal thất bại gần đây (user token hết hạn) → không retry mỗi 5 phút,
    // chỉ thử lại khi lần trước cách đây > HEAL_RETRY_COOLDOWN
    const lastFail = healFailedAt.get(storeKey)
    if (lastFail && Date.now() - lastFail < HEAL_RETRY_COOLDOWN) return

    const needsHeal = await storePrisma.fbPage.count({
        where: {
            OR: [
                { status: 'token_expired' },
                { tokenExpiresAt: { lt: new Date(Date.now() + TOKEN_REFRESH_BUFFER) } },
            ],
        },
    })
    if (!needsHeal) return

    const userTok = await storePrisma.fbUserToken.findFirst({ orderBy: { updatedAt: 'desc' } })
    if (!userTok) {
        // Page kết nối bằng token DÁN TAY (POST /connect-page-token) không có user
        // token đi kèm → KHÔNG tự gia hạn được. Trước đây hàm này lặng lẽ return,
        // token chết ở ngày ~55 mà không ai biết. Giờ kêu to trong log.
        const sapChet = await storePrisma.fbPage.findMany({
            where: {
                status: { not: 'disconnected' },
                tokenExpiresAt: { lt: new Date(Date.now() + TOKEN_REFRESH_BUFFER) },
            },
            select: { name: true, pageId: true, tokenExpiresAt: true },
        })
        for (const p of sapChet) {
            const conLai = Math.floor((new Date(p.tokenExpiresAt).getTime() - Date.now()) / 86400_000)
            console.warn(
                `[FanpageCron] ⚠️ ${storeKey}/${p.name || p.pageId}: token còn ${conLai} ngày và KHÔNG tự gia hạn được `
                + '(kết nối bằng page token dán tay). Chủ shop cần dán token mới ở kengi.vn/fanpage-manager.',
            )
        }
        // Vẫn giữ cooldown để không spam log mỗi 5 phút
        if (sapChet.length) healFailedAt.set(storeKey, Date.now())
        return
    }

    try {
        const svc = new FacebookService(userTok.accessToken)
        const pages = await svc.listPages()
        for (const p of pages) {
            await storePrisma.fbPage.updateMany({
                where: { pageId: p.id },
                // Page token lấy từ long-lived user token không có hạn (Graph không trả expiry)
                // → set tokenExpiresAt = null để không bị quét heal lại mỗi chu kỳ
                data: { accessToken: p.accessToken, status: 'active', tokenExpiresAt: null },
            })
        }
        healFailedAt.delete(storeKey)
        console.log(`[FanpageCron] Healed ${pages.length} page tokens`)
    } catch (e: any) {
        // Ghi mốc thất bại để chờ cooldown, tránh spam Graph mỗi 5 phút
        healFailedAt.set(storeKey, Date.now())
        console.error('[FanpageCron] Token heal failed (user token có thể đã hết hạn — cần re-auth):', e.message)
    }
}

async function runReconcile(): Promise<void> {
    try {
        // Chỉ store CÓ FB page (cờ registry) — KHÔNG quét toàn bộ + mở client per-store
        // mỗi 5 phút (đó là cron chạy dày nhất, nguồn cạn kết nối). Cờ set khi kết nối page.
        const stores = await registryPrisma.store.findMany({ where: { status: 'active', hasFanpages: true } as any }) as any[]
        for (const store of stores) {
            try {
                const storePrisma = getStorePrisma(store.schema)
                const pages = await storePrisma.fbPage.findMany({ where: { status: { not: 'disconnected' } } })
                if (!pages.length) continue

                await healPageTokens(storePrisma, store.schema)

                for (const page of pages) {
                    try {
                        if (page.status === 'active') await reconcilePage(storePrisma, page)
                        // Fallback poll auto-reply nếu chưa có webhook
                        if (page.autoReplyEnabled && !page.webhookSubscribed && page.status === 'active') {
                            await sleep(GRAPH_THROTTLE_MS) // throttle giữa 2 call Graph liên tiếp
                            const n = await pollAndAutoReply(storePrisma, page)
                            if (n > 0) console.log(`[FanpageCron] ${store.name}/${page.name}: auto-reply ${n} comment`)
                        }
                    } catch (err: any) {
                        console.error(`[FanpageCron] page ${page.name}:`, err.message)
                    }
                    // Throttle giữa các page (mỗi page ít nhất 1 call Graph)
                    if (page.status === 'active') await sleep(GRAPH_THROTTLE_MS)
                }
            } catch (err: any) {
                // Store chưa có bảng FbPage → bỏ qua
                if (!err.message?.includes('does not exist')) {
                    console.error(`[FanpageCron] store ${store.name}:`, err.message)
                }
            }
        }
    } catch (err: any) {
        console.error('[FanpageCron] Fatal:', err.message)
    }
}

export function startFanpageCron(): void {
    if (timer) return
    console.log(`⏰ Fanpage cron started (every ${RECONCILE_INTERVAL / 60000} minutes)`)
    setTimeout(() => {
        runReconcile()
        timer = setInterval(runReconcile, RECONCILE_INTERVAL)
    }, 60_000)
}

export function stopFanpageCron(): void {
    if (timer) {
        clearInterval(timer)
        timer = null
        console.log('⏰ Fanpage cron stopped')
    }
}
