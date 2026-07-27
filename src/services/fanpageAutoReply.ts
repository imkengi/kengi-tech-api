// ═══════════════════════════════════════════════════════════════════════════════
//  AUTO-REPLY ENGINE — chạy server-side (kể cả khi trình duyệt đóng)
//  Dùng chung cho webhook (realtime) và cron (fallback poll).
//  Idempotency: FbAutoReplyLog @@unique([pageId, commentId]) → mỗi comment 1 lần.
// ═══════════════════════════════════════════════════════════════════════════════

import { FacebookService, isRateLimitError } from './platforms/facebook'

// Poll chỉ là fallback cho webhook (chu kỳ cron 5 phút) → chỉ xử lý comment
// trong 15 phút gần nhất (3× chu kỳ), tránh lần đầu bật auto-reply bot rải
// reply lên hàng loạt comment cũ.
const POLL_LOOKBACK_MS = 15 * 60 * 1000

// Nghỉ giữa các call Graph liên tiếp để tránh rate-limit
const GRAPH_THROTTLE_MS = 300
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

export interface IncomingComment {
    commentId: string
    postId?: string
    message: string
    fromId?: string
    fromName?: string
}

function matches(text: string, keyword: string, matchType: string): boolean {
    const t = (text || '').toLowerCase().trim()
    const k = (keyword || '').toLowerCase().trim()
    if (!k) return false
    if (matchType === 'exact') return t === k
    if (matchType === 'starts') return t.startsWith(k)
    return t.includes(k) // contains (mặc định)
}

/**
 * Xử lý 1 comment theo rule của page. Trả về hành động đã làm (hoặc null nếu bỏ qua).
 * `page` là record FbPage (cần pageId, accessToken, autoReplyEnabled).
 */
export async function processComment(
    storePrisma: any,
    page: any,
    comment: IncomingComment,
): Promise<{ matched: boolean; action?: string; ruleId?: string; rateLimited?: boolean; thieuFrom?: boolean } | null> {
    if (!page?.autoReplyEnabled) return null
    // Bỏ qua comment do chính page trả lời (tránh vòng lặp)
    if (comment.fromId && comment.fromId === page.pageId) return null
    // FB không trả `from` (thiếu quyền) → không chứng minh được không phải bot.
    // Reply chứa keyword sẽ gây loop dây chuyền → bỏ qua luôn.
    // Trả cờ để caller đếm & cảnh báo: thiếu quyền thì auto-reply im hoàn toàn,
    // chủ shop bật rule xong ngồi đợi mãi không hiểu vì sao không chạy.
    if (!comment.fromId) return { matched: false, thieuFrom: true }

    const rules = await storePrisma.fbCommentRule.findMany({
        where: { pageId: page.pageId, enabled: true },
        orderBy: { priority: 'asc' },
    })

    const rule = rules.find((r: any) => matches(comment.message, r.keyword, r.matchType))
    // Không khớp rule → bỏ qua, KHÔNG ghi log (tránh phình FbAutoReplyLog)
    if (!rule) return { matched: false }

    // Idempotency: giữ chỗ log trước khi gọi Graph — chống double-reply khi
    // webhook và cron chạy song song. Nếu đã tồn tại → đã xử lý.
    try {
        await storePrisma.fbAutoReplyLog.create({
            data: {
                pageId: page.pageId, commentId: comment.commentId,
                postId: comment.postId, fromName: comment.fromName, commentMsg: comment.message,
                action: 'processing', success: false,
            },
        })
    } catch {
        // Vi phạm unique → comment đã được xử lý ở lượt trước. Dừng.
        return null
    }

    const svc = new FacebookService(page.accessToken)
    let action = 'reply'
    let success = true
    let errorMessage: string | null = null
    let rateLimited = false

    try {
        await svc.replyToComment(comment.commentId, rule.replyText)
        if (rule.privateReply) await svc.privateReply(comment.commentId, rule.replyText).catch(() => { })
        if (rule.hideComment) { await svc.hideComment(comment.commentId, true).catch(() => { }); action = 'reply_hide' }
    } catch (e: any) {
        success = false
        errorMessage = e?.message || 'reply failed'
        rateLimited = isRateLimitError(e)
        // Token page hỏng → đánh dấu để FE nhắc re-auth
        if (e?.isTokenError) {
            await storePrisma.fbPage.update({ where: { pageId: page.pageId }, data: { status: 'token_expired' } }).catch(() => { })
        }
    }

    await storePrisma.fbAutoReplyLog.update({
        where: { pageId_commentId: { pageId: page.pageId, commentId: comment.commentId } },
        data: { ruleId: rule.id, action, replyText: rule.replyText, success, errorMessage },
    }).catch(() => { })

    return { matched: true, action, ruleId: rule.id, rateLimited }
}

/**
 * Fallback poll: quét comment gần đây của page và chạy engine.
 * Dùng cho page bật auto-reply nhưng webhook chưa cấu hình / bị miss.
 */
export async function pollAndAutoReply(storePrisma: any, page: any): Promise<number> {
    if (!page?.autoReplyEnabled) return 0
    const svc = new FacebookService(page.accessToken)
    let comments
    try {
        comments = await svc.listRecentComments(page.pageId, 10)
    } catch (e: any) {
        if (e?.isTokenError) {
            await storePrisma.fbPage.update({ where: { pageId: page.pageId }, data: { status: 'token_expired' } }).catch(() => { })
        }
        if (isRateLimitError(e)) {
            console.warn(`[AutoReply] Rate-limit Graph (page ${page.name || page.pageId}) — dừng chu kỳ poll`)
        }
        return 0
    }
    const cutoff = Date.now() - POLL_LOOKBACK_MS
    let handled = 0
    let trongCuaSo = 0
    let thieuFrom = 0
    for (const c of comments) {
        // Chỉ xử lý comment mới trong khoảng lookback; comment cũ bỏ qua hẳn (không log)
        if (!c.createdTime || new Date(c.createdTime).getTime() < cutoff) continue
        trongCuaSo++
        const r = await processComment(storePrisma, page, {
            commentId: c.id, postId: c.postId, message: c.message,
            fromId: c.from?.id, fromName: c.from?.name,
        })
        if (r?.thieuFrom) thieuFrom++
        if (r?.rateLimited) {
            // Graph báo rate-limit → dừng ngay chu kỳ của page này
            console.warn(`[AutoReply] Rate-limit Graph (page ${page.name || page.pageId}) — dừng chu kỳ poll`)
            break
        }
        if (r?.matched) {
            handled++
            await sleep(GRAPH_THROTTLE_MS) // throttle giữa các call Graph liên tiếp
        }
    }
    // Có comment mới nhưng TẤT CẢ đều thiếu `from` → token thiếu quyền đọc người
    // bình luận, engine sẽ im vĩnh viễn. Phải kêu lên, nếu không chủ shop bật rule
    // rồi ngồi đợi mãi mà không hiểu tại sao không có gì xảy ra.
    if (trongCuaSo > 0 && thieuFrom === trongCuaSo) {
        console.warn(
            `[AutoReply] ⚠️ ${page.name || page.pageId}: ${trongCuaSo} bình luận mới nhưng Facebook KHÔNG trả thông tin `
            + 'người bình luận (thiếu quyền pages_read_user_content) → auto-reply bỏ qua hết. '
            + 'Cần token có đủ quyền, dán lại ở kengi.vn/fanpage-manager.',
        )
    }
    return handled
}
