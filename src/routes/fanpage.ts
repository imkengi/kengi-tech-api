// ═══════════════════════════════════════════════════════════════════════════════
//  FANPAGE MANAGER API  (/api/fanpage/*)
//  FE (kengi.vn/fanpage-manager) gọi các endpoint này thay vì gọi Graph trực tiếp.
//  Token page/user được giữ ở backend (bảng FbPage / FbUserToken), không lộ ra FE.
// ═══════════════════════════════════════════════════════════════════════════════

import { Router, Response } from 'express'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { registryPrisma } from '../lib/prisma'
import { requireRole } from '../middleware/roleMiddleware'
import { FacebookService, FbGraphError } from '../services/platforms/facebook'

const router = Router()

const APP_ID = process.env.FB_APP_ID || ''
const APP_SECRET = process.env.FB_APP_SECRET || ''

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Chuẩn hoá lỗi Graph → HTTP. Token hỏng → 401 + code để FE gọi re-auth. */
function sendGraphError(res: Response, err: any) {
    const g = err as FbGraphError
    if (g?.isTokenError) {
        return res.status(401).json({ success: false, error: g.message, code: 'FB_TOKEN_EXPIRED' })
    }
    const msg = g?.message || 'Facebook error'
    console.error('[Fanpage] Graph error:', msg, g?.code ? `(code ${g.code})` : '')
    return res.status(502).json({ success: false, error: msg, code: g?.code })
}

/** Lấy record page + service (page token) hoặc null nếu chưa kết nối. */
async function getPageService(prisma: any, pageId: string): Promise<{ page: any; svc: FacebookService } | null> {
    const page = await prisma.fbPage.findUnique({ where: { pageId } })
    if (!page) return null
    return { page, svc: new FacebookService(page.accessToken) }
}

/** Service dùng USER token (cho ads). Lấy token user mới nhất của store. */
async function getUserService(prisma: any): Promise<FacebookService | null> {
    const tok = await prisma.fbUserToken.findFirst({ orderBy: { updatedAt: 'desc' } })
    if (!tok) return null
    return new FacebookService(tok.accessToken)
}

/** Đánh dấu page token hỏng để FE nhắc re-auth. */
async function markTokenExpired(prisma: any, pageId: string) {
    await prisma.fbPage.update({ where: { pageId }, data: { status: 'token_expired' } }).catch(() => { })
}

/**
 * Đăng ký webhook `feed` cho page (best-effort).
 * Trả true/false để ghi cờ webhookSubscribed — KHÔNG ném lỗi ra ngoài vì
 * luồng /connect không được chết chỉ vì app chưa được duyệt quyền webhook.
 */
async function trySubscribeWebhook(prisma: any, pageId: string, accessToken: string): Promise<boolean> {
    try {
        await new FacebookService(accessToken).subscribeWebhook(pageId)
        await prisma.fbPage.update({ where: { pageId }, data: { webhookSubscribed: true } }).catch(() => { })
        return true
    } catch (e: any) {
        console.warn(`[Fanpage] Subscribe webhook page ${pageId} thất bại:`, e?.message)
        await prisma.fbPage.update({ where: { pageId }, data: { webhookSubscribed: false } }).catch(() => { })
        return false
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  CẤU HÌNH (FE lấy App ID từ server, không bắt người dùng tự nhập)
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/fanpage/config — App ID công khai + trạng thái cấu hình server.
// KHÔNG bao giờ trả app secret.
router.get('/config', authMiddleware, async (_req: AuthRequest, res: Response) => {
    res.json({
        success: true,
        data: {
            appId: APP_ID || null,
            configured: !!(APP_ID && APP_SECRET),
            // Đường dán PAGE TOKEN thủ công luôn dùng được — không cần app/App Review.
            // FE dựa vào cờ này để vẫn mời kết nối khi chưa có FB_APP_ID.
            pageTokenConnect: true,
            webhookConfigured: !!process.env.FB_WEBHOOK_VERIFY_TOKEN,
            graphVersion: 'v21.0',
            scopes: [
                'pages_show_list', 'pages_read_engagement', 'pages_manage_posts',
                'pages_manage_metadata', 'pages_manage_engagement', 'pages_read_user_content',
                'pages_messaging', 'business_management', 'ads_management', 'ads_read',
            ].join(','),
        },
    })
})

// ═══════════════════════════════════════════════════════════════════════════════
//  KẾT NỐI / PAGES
// ═══════════════════════════════════════════════════════════════════════════════

// POST /api/fanpage/connect  { userAccessToken }  (short-lived token từ FB.login)
router.post('/connect', authMiddleware, requireRole('admin', 'manager', 'superadmin'), async (req: AuthRequest, res: Response) => {
    try {
        if (!APP_ID || !APP_SECRET) {
            return res.status(500).json({ success: false, error: 'FB_APP_ID/FB_APP_SECRET chưa cấu hình trên server' })
        }
        const { userAccessToken } = req.body || {}
        if (!userAccessToken) return res.status(400).json({ success: false, error: 'Thiếu userAccessToken' })

        const prisma = req.storePrisma!

        // 1. Đổi sang long-lived user token
        const { accessToken: longUserToken, expiresIn } = await FacebookService.exchangeLongLivedToken(userAccessToken, APP_ID, APP_SECRET)
        const userSvc = new FacebookService(longUserToken)
        const me = await userSvc.getMe()

        await prisma.fbUserToken.upsert({
            where: { fbUserId: me.id },
            create: {
                fbUserId: me.id, name: me.name, accessToken: longUserToken,
                tokenExpiresAt: new Date(Date.now() + expiresIn * 1000),
                connectedBy: req.user?.userId,
            },
            update: {
                accessToken: longUserToken, name: me.name,
                tokenExpiresAt: new Date(Date.now() + expiresIn * 1000),
            },
        })

        // 2. Lấy page + page token (page token lấy từ long-lived user token là non-expiring)
        const pages = await userSvc.listPages()
        for (const p of pages) {
            await prisma.fbPage.upsert({
                where: { pageId: p.id },
                create: {
                    pageId: p.id, name: p.name, category: p.category, avatar: p.picture,
                    fanCount: p.fanCount || 0, accessToken: p.accessToken, igUserId: p.igUserId,
                    status: 'active', connectedBy: req.user?.userId, lastSyncAt: new Date(),
                },
                update: {
                    name: p.name, category: p.category, avatar: p.picture, fanCount: p.fanCount || 0,
                    accessToken: p.accessToken, igUserId: p.igUserId, status: 'active', lastSyncAt: new Date(),
                },
            })
        }
        // Bật cờ registry để fanpageCron CHỈ chạm store có page (tránh quét toàn bộ → cạn kết nối)
        if (pages.length && req.user?.storeSchema) {
            ;(registryPrisma as any).store.updateMany({ where: { schema: req.user.storeSchema }, data: { hasFanpages: true } }).catch(() => { })
        }

        // 3. Đăng ký webhook feed cho từng page — bắt buộc để auto-reply chạy
        //    server-side (không có thì chỉ còn poll 5 phút/lần của cron).
        //    Chỉ thử khi đã có verify token, và luôn best-effort.
        if (process.env.FB_WEBHOOK_VERIFY_TOKEN) {
            for (const p of pages) await trySubscribeWebhook(prisma, p.id, p.accessToken)
        }

        const saved = await prisma.fbPage.findMany({
            where: { status: { not: 'disconnected' } },
            select: { pageId: true, name: true, category: true, avatar: true, fanCount: true, igUserId: true, status: true, autoReplyEnabled: true, adAccountId: true },
        })
        res.json({ success: true, data: { user: me, pages: saved } })
    } catch (err: any) {
        sendGraphError(res, err)
    }
})

/**
 * POST /api/fanpage/connect-page-token  { accessToken, pageId?, name? }
 *
 * Kết nối page bằng LONG-LIVED PAGE TOKEN dán tay (lấy ở Graph API Explorer →
 * Access Token Debugger → Extend). Đường này KHÔNG cần FB_APP_ID/FB_APP_SECRET,
 * nên dùng được ngay khi chưa có app Facebook riêng / chưa qua App Review.
 *
 * Trước đây form "Nhập token Fanpage" trên FE chỉ lưu localStorage → server
 * không có token nên lên lịch, auto-reply và các tool MCP fanpage đều thấy 0 page.
 */
router.post('/connect-page-token', authMiddleware, requireRole('admin', 'manager', 'superadmin'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const accessToken = String(req.body?.accessToken || '').trim()
        if (!accessToken) return res.status(400).json({ success: false, error: 'Thiếu accessToken' })

        // 1. Token có sống không + là PAGE token hay USER token
        const svc = new FacebookService(accessToken)
        let info: Awaited<ReturnType<FacebookService['identifyToken']>>
        try {
            info = await svc.identifyToken()
        } catch (e: any) {
            return res.status(400).json({
                success: false,
                error: `Token không dùng được: ${e?.message || 'Facebook từ chối'}`,
                code: 'FB_TOKEN_INVALID',
            })
        }
        if (info.type && info.type !== 'page') {
            return res.status(400).json({
                success: false,
                code: 'FB_NOT_PAGE_TOKEN',
                error: `Đây là ${info.type === 'user' ? 'USER token' : `token loại "${info.type}"`}, không phải PAGE token. `
                    + 'Vào Graph API Explorer → ô "Facebook App" chọn app → ô bên dưới CHỌN ĐÚNG PAGE (không để "User Token") rồi copy lại.',
            })
        }

        // 2. Nếu client có gửi pageId thì phải khớp — tránh lưu nhầm token của page khác
        const claimed = String(req.body?.pageId || '').trim()
        if (claimed && claimed !== info.id) {
            return res.status(400).json({
                success: false,
                error: `Page ID bạn nhập (${claimed}) không khớp với page của token (${info.id} — ${info.name || 'không rõ tên'}).`,
            })
        }

        const pageId = info.id
        const name = String(req.body?.name || '').trim() || info.name || `Page ${pageId}`

        // 3. Kiểm tra token thật sự thao tác được, không chỉ đọc /me.
        //    Token thiếu pages_read_engagement vẫn qua bước /me nhưng hỏng ở đây.
        let quyenCanhBao: string | null = null
        try {
            await svc.listPublishedPosts(pageId, 1)
        } catch (e: any) {
            quyenCanhBao = `Token đọc được thông tin page nhưng KHÔNG đọc được bài viết (${e?.message || 'lỗi'}). `
                + 'Thường do thiếu quyền pages_read_engagement — vẫn lưu, nhưng nhiều tính năng sẽ không chạy.'
        }

        // 4. Lưu. Page token dán tay ~60 ngày; không có FbUserToken nên cron KHÔNG tự
        //    heal được → ghi hạn để cảnh báo trước khi chết.
        const expires = new Date(Date.now() + 55 * 86400_000)
        await prisma.fbPage.upsert({
            where: { pageId },
            create: {
                pageId, name, category: info.category, avatar: info.picture,
                fanCount: info.fanCount || 0, accessToken, tokenExpiresAt: expires,
                status: 'active', connectedBy: req.user?.userId, lastSyncAt: new Date(),
            },
            update: {
                name, category: info.category, avatar: info.picture,
                fanCount: info.fanCount || 0, accessToken, tokenExpiresAt: expires,
                status: 'active', lastSyncAt: new Date(),
            },
        })

        // Bật cờ registry để fanpageCron chạm tới store này
        if (req.user?.storeSchema) {
            ;(registryPrisma as any).store.updateMany({ where: { schema: req.user.storeSchema }, data: { hasFanpages: true } }).catch(() => { })
        }

        // 5. Webhook (best-effort) — subscribe vào app mà token thuộc về
        let webhook = 'chưa bật'
        if (process.env.FB_WEBHOOK_VERIFY_TOKEN) {
            webhook = (await trySubscribeWebhook(prisma, pageId, accessToken))
                ? 'đã bật'
                : 'không bật được (auto-reply sẽ chạy theo cron 5 phút/lần)'
        } else {
            webhook = 'server chưa cấu hình FB_WEBHOOK_VERIFY_TOKEN'
        }

        const saved = await prisma.fbPage.findUnique({
            where: { pageId },
            select: { pageId: true, name: true, category: true, avatar: true, fanCount: true, status: true, autoReplyEnabled: true, webhookSubscribed: true, tokenExpiresAt: true },
        })
        res.json({ success: true, data: { page: saved, webhook, canhBao: quyenCanhBao } })
    } catch (err: any) {
        sendGraphError(res, err)
    }
})

// GET /api/fanpage/pages
router.get('/pages', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const pages = await prisma.fbPage.findMany({
            where: { status: { not: 'disconnected' } },
            // tokenExpiresAt: FE hiện số ngày còn lại — token dán tay không tự gia hạn
            // được nên phải cảnh báo sớm, đừng đợi Graph trả lỗi mới báo.
            select: { pageId: true, name: true, category: true, avatar: true, fanCount: true, igUserId: true, status: true, autoReplyEnabled: true, adAccountId: true, webhookSubscribed: true, tokenExpiresAt: true },
            orderBy: { createdAt: 'asc' },
        })
        res.json({ success: true, data: pages })
    } catch { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// DELETE /api/fanpage/pages/:pageId  (ngắt kết nối, giữ lịch sử)
router.delete('/pages/:pageId', authMiddleware, requireRole('admin', 'manager', 'superadmin'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        await prisma.fbPage.update({ where: { pageId: String(req.params.pageId) }, data: { status: 'disconnected' } })
        res.json({ success: true })
    } catch { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// PATCH /api/fanpage/pages/:pageId  { autoReplyEnabled?, adAccountId? }
router.patch('/pages/:pageId', authMiddleware, requireRole('admin', 'manager', 'superadmin'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { autoReplyEnabled, adAccountId } = req.body || {}
        const data: any = {}
        if (typeof autoReplyEnabled === 'boolean') data.autoReplyEnabled = autoReplyEnabled
        if (adAccountId !== undefined) data.adAccountId = adAccountId
        const page = await prisma.fbPage.update({ where: { pageId: String(req.params.pageId) }, data })
        res.json({ success: true, data: page })
    } catch { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// POST /api/fanpage/pages/:pageId/subscribe-webhook — đăng ký lại thủ công
router.post('/pages/:pageId/subscribe-webhook', authMiddleware, requireRole('admin', 'manager', 'superadmin'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const pageId = String(req.params.pageId)
        const ctx = await getPageService(prisma, pageId)
        if (!ctx) return res.status(404).json({ success: false, error: 'Page chưa kết nối' })
        if (!process.env.FB_WEBHOOK_VERIFY_TOKEN) {
            return res.status(500).json({ success: false, error: 'FB_WEBHOOK_VERIFY_TOKEN chưa cấu hình trên server' })
        }
        try {
            await ctx.svc.subscribeWebhook(pageId)
        } catch (e: any) {
            if ((e as FbGraphError)?.isTokenError) await markTokenExpired(prisma, pageId)
            await prisma.fbPage.update({ where: { pageId }, data: { webhookSubscribed: false } }).catch(() => { })
            return sendGraphError(res, e)
        }
        await prisma.fbPage.update({ where: { pageId }, data: { webhookSubscribed: true } })
        res.json({ success: true, data: { webhookSubscribed: true } })
    } catch { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// GET /api/fanpage/pages/:pageId/posts — bài ĐÃ ĐĂNG (chọn bài để Boost / xem tương tác)
router.get('/pages/:pageId/posts', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const pageId = String(req.params.pageId)
        const ctx = await getPageService(prisma, pageId)
        if (!ctx) return res.status(404).json({ success: false, error: 'Page chưa kết nối' })
        try {
            const posts = await ctx.svc.listPublishedPosts(pageId, Math.min(Number(req.query.limit) || 25, 100))
            res.json({ success: true, data: posts })
        } catch (e: any) {
            if ((e as FbGraphError)?.isTokenError) await markTokenExpired(prisma, pageId)
            sendGraphError(res, e)
        }
    } catch { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// GET /api/fanpage/pages/:pageId/insights?days=7 — số liệu page (thay biểu đồ hardcode)
router.get('/pages/:pageId/insights', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const pageId = String(req.params.pageId)
        const ctx = await getPageService(prisma, pageId)
        if (!ctx) return res.status(404).json({ success: false, error: 'Page chưa kết nối' })
        try {
            const days = Math.min(Math.max(Number(req.query.days) || 7, 1), 90)
            const data = await ctx.svc.getPageInsights(pageId, undefined, days)
            res.json({ success: true, data })
        } catch (e: any) {
            if ((e as FbGraphError)?.isTokenError) await markTokenExpired(prisma, pageId)
            sendGraphError(res, e)
        }
    } catch { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// ═══════════════════════════════════════════════════════════════════════════════
//  LỊCH ĐĂNG BÀI
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/fanpage/pages/:pageId/scheduled  — hợp nhất mirror DB + live FB
router.get('/pages/:pageId/scheduled', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const pageId = String(req.params.pageId)
        const ctx = await getPageService(prisma, pageId)
        if (!ctx) return res.status(404).json({ success: false, error: 'Page chưa kết nối' })

        const mirror = await prisma.fbScheduledPost.findMany({
            where: { pageId, status: { in: ['scheduled', 'failed'] } },
            orderBy: { scheduledAt: 'asc' },
        })

        // Live FB (best-effort): nếu token hỏng vẫn trả mirror
        let live: any[] = []
        try {
            live = await ctx.svc.listScheduledPosts(pageId)
        } catch (e: any) {
            if ((e as FbGraphError)?.isTokenError) await markTokenExpired(prisma, pageId)
        }
        res.json({ success: true, data: { mirror, live } })
    } catch { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// POST /api/fanpage/pages/:pageId/posts  { message, mediaType, mediaUrls, linkUrl, scheduledAt }
router.post('/pages/:pageId/posts', authMiddleware, requireRole('admin', 'manager', 'superadmin'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const pageId = String(req.params.pageId)
        const ctx = await getPageService(prisma, pageId)
        if (!ctx) return res.status(404).json({ success: false, error: 'Page chưa kết nối' })

        const { message = '', mediaType = 'text', mediaUrls = [], linkUrl, scheduledAt } = req.body || {}
        const scheduledAtMs = scheduledAt ? new Date(scheduledAt).getTime() : null
        if (scheduledAtMs && scheduledAtMs < Date.now() + 9 * 60 * 1000) {
            // FB yêu cầu lịch cách hiện tại tối thiểu 10 phút
            return res.status(400).json({ success: false, error: 'Thời điểm hẹn phải cách hiện tại ít nhất 10 phút' })
        }

        let fbResult: { id: string }
        try {
            fbResult = await ctx.svc.createOrSchedulePost({ pageId, message, mediaType, mediaUrls, linkUrl, scheduledAtMs })
        } catch (e: any) {
            if ((e as FbGraphError)?.isTokenError) await markTokenExpired(prisma, pageId)
            return sendGraphError(res, e)
        }

        const record = await prisma.fbScheduledPost.create({
            data: {
                pageId, fbPostId: fbResult.id, message,
                mediaType, mediaUrls: JSON.stringify(mediaUrls || []), linkUrl: linkUrl || null,
                scheduledAt: scheduledAtMs ? new Date(scheduledAtMs) : new Date(),
                status: scheduledAtMs ? 'scheduled' : 'published',
                publishedAt: scheduledAtMs ? null : new Date(),
                createdBy: req.user?.userId,
            },
        })
        res.json({ success: true, data: record })
    } catch { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// PATCH /api/fanpage/posts/:id  { scheduledAt?, message? }
router.patch('/posts/:id', authMiddleware, requireRole('admin', 'manager', 'superadmin'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const rec = await prisma.fbScheduledPost.findUnique({ where: { id: String(req.params.id) } })
        if (!rec) return res.status(404).json({ success: false, error: 'Không tìm thấy bài' })
        const ctx = await getPageService(prisma, rec.pageId)
        if (!ctx) return res.status(404).json({ success: false, error: 'Page chưa kết nối' })

        const { scheduledAt, message } = req.body || {}
        // Không có trường nào để cập nhật → 400, tránh gọi Graph với params rỗng
        if (message === undefined && scheduledAt === undefined) {
            return res.status(400).json({ success: false, error: 'Không có trường nào để cập nhật (message/scheduledAt)' })
        }
        const scheduledAtMs = scheduledAt ? new Date(scheduledAt).getTime() : undefined
        if (scheduledAtMs && scheduledAtMs < Date.now() + 9 * 60 * 1000) {
            // FB yêu cầu lịch cách hiện tại tối thiểu 10 phút (giống POST)
            return res.status(400).json({ success: false, error: 'Thời điểm hẹn phải cách hiện tại ít nhất 10 phút' })
        }
        if (rec.fbPostId) {
            try {
                await ctx.svc.editScheduledPost(rec.fbPostId, { scheduledAtMs, message })
            } catch (e: any) {
                if ((e as FbGraphError)?.isTokenError) await markTokenExpired(prisma, rec.pageId)
                return sendGraphError(res, e)
            }
        }
        const updated = await prisma.fbScheduledPost.update({
            where: { id: rec.id },
            data: {
                ...(message !== undefined ? { message } : {}),
                ...(scheduledAtMs ? { scheduledAt: new Date(scheduledAtMs) } : {}),
            },
        })
        res.json({ success: true, data: updated })
    } catch { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// POST /api/fanpage/posts/:id/publish-now
router.post('/posts/:id/publish-now', authMiddleware, requireRole('admin', 'manager', 'superadmin'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const rec = await prisma.fbScheduledPost.findUnique({ where: { id: String(req.params.id) } })
        if (!rec) return res.status(404).json({ success: false, error: 'Không tìm thấy bài' })
        const ctx = await getPageService(prisma, rec.pageId)
        if (!ctx) return res.status(404).json({ success: false, error: 'Page chưa kết nối' })
        if (rec.fbPostId) {
            try { await ctx.svc.publishNow(rec.fbPostId) }
            catch (e: any) {
                if ((e as FbGraphError)?.isTokenError) await markTokenExpired(prisma, rec.pageId)
                return sendGraphError(res, e)
            }
        }
        const updated = await prisma.fbScheduledPost.update({ where: { id: rec.id }, data: { status: 'published', publishedAt: new Date() } })
        res.json({ success: true, data: updated })
    } catch { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// DELETE /api/fanpage/posts/:id
router.delete('/posts/:id', authMiddleware, requireRole('admin', 'manager', 'superadmin'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const rec = await prisma.fbScheduledPost.findUnique({ where: { id: String(req.params.id) } })
        if (!rec) return res.status(404).json({ success: false, error: 'Không tìm thấy bài' })
        const ctx = await getPageService(prisma, rec.pageId)
        if (ctx && rec.fbPostId) {
            try { await ctx.svc.deletePost(rec.fbPostId) } catch { /* đã xoá trên FB hoặc token hỏng — vẫn xoá mirror */ }
        }
        await prisma.fbScheduledPost.update({ where: { id: rec.id }, data: { status: 'cancelled' } })
        res.json({ success: true })
    } catch { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// ═══════════════════════════════════════════════════════════════════════════════
//  COMMENTS
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/fanpage/pages/:pageId/comments
router.get('/pages/:pageId/comments', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const pageId = String(req.params.pageId)
        const ctx = await getPageService(prisma, pageId)
        if (!ctx) return res.status(404).json({ success: false, error: 'Page chưa kết nối' })
        try {
            const comments = await ctx.svc.listRecentComments(pageId, Number(req.query.postLimit) || 25)
            res.json({ success: true, data: comments })
        } catch (e: any) {
            if ((e as FbGraphError)?.isTokenError) await markTokenExpired(prisma, pageId)
            sendGraphError(res, e)
        }
    } catch { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// helper: dựng service từ pageId trong body/query (thao tác comment)
async function svcFromPage(prisma: any, pageId: string) {
    const ctx = await getPageService(prisma, pageId)
    return ctx?.svc || null
}

// POST /api/fanpage/comments/:commentId/reply  { pageId, message, privateReply? }
router.post('/comments/:commentId/reply', authMiddleware, requireRole('admin', 'manager', 'superadmin'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { pageId, message, privateReply } = req.body || {}
        const svc = await svcFromPage(prisma, pageId)
        if (!svc) return res.status(404).json({ success: false, error: 'Page chưa kết nối' })
        const r = await svc.replyToComment(String(req.params.commentId), message)
        if (privateReply) await svc.privateReply(String(req.params.commentId), message).catch(() => { })
        res.json({ success: true, data: r })
    } catch (e: any) { sendGraphError(res, e) }
})

// POST /api/fanpage/comments/:commentId/hide  { pageId, hidden }
router.post('/comments/:commentId/hide', authMiddleware, requireRole('admin', 'manager', 'superadmin'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { pageId, hidden = true } = req.body || {}
        const svc = await svcFromPage(prisma, pageId)
        if (!svc) return res.status(404).json({ success: false, error: 'Page chưa kết nối' })
        await svc.hideComment(String(req.params.commentId), hidden)
        res.json({ success: true })
    } catch (e: any) { sendGraphError(res, e) }
})

// POST /api/fanpage/comments/:commentId/like  { pageId, like }
router.post('/comments/:commentId/like', authMiddleware, requireRole('admin', 'manager', 'superadmin'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { pageId, like = true } = req.body || {}
        const svc = await svcFromPage(prisma, pageId)
        if (!svc) return res.status(404).json({ success: false, error: 'Page chưa kết nối' })
        await svc.likeComment(String(req.params.commentId), like)
        res.json({ success: true })
    } catch (e: any) { sendGraphError(res, e) }
})

// DELETE /api/fanpage/comments/:commentId  { pageId }
router.delete('/comments/:commentId', authMiddleware, requireRole('admin', 'manager', 'superadmin'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const pageId = (req.body?.pageId) || (req.query.pageId as string)
        const svc = await svcFromPage(prisma, pageId)
        if (!svc) return res.status(404).json({ success: false, error: 'Page chưa kết nối' })
        await svc.deleteComment(String(req.params.commentId))
        res.json({ success: true })
    } catch (e: any) { sendGraphError(res, e) }
})

// ═══════════════════════════════════════════════════════════════════════════════
//  RULE AUTO-REPLY
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/fanpage/pages/:pageId/rules
router.get('/pages/:pageId/rules', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const rules = await prisma.fbCommentRule.findMany({ where: { pageId: String(req.params.pageId) }, orderBy: { priority: 'asc' } })
        res.json({ success: true, data: rules })
    } catch { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// POST /api/fanpage/pages/:pageId/rules
router.post('/pages/:pageId/rules', authMiddleware, requireRole('admin', 'manager', 'superadmin'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { name = '', keyword, matchType = 'contains', replyText, privateReply = false, hideComment = false, enabled = true, priority = 0 } = req.body || {}
        if (!keyword || !replyText) return res.status(400).json({ success: false, error: 'Thiếu keyword hoặc replyText' })
        const rule = await prisma.fbCommentRule.create({
            data: { pageId: String(req.params.pageId), name, keyword, matchType, replyText, privateReply, hideComment, enabled, priority },
        })
        res.json({ success: true, data: rule })
    } catch { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// PATCH /api/fanpage/rules/:id
router.patch('/rules/:id', authMiddleware, requireRole('admin', 'manager', 'superadmin'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const allowed = ['name', 'keyword', 'matchType', 'replyText', 'privateReply', 'hideComment', 'enabled', 'priority']
        const data: any = {}
        for (const k of allowed) if (k in (req.body || {})) data[k] = req.body[k]
        const rule = await prisma.fbCommentRule.update({ where: { id: String(req.params.id) }, data })
        res.json({ success: true, data: rule })
    } catch { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// DELETE /api/fanpage/rules/:id
router.delete('/rules/:id', authMiddleware, requireRole('admin', 'manager', 'superadmin'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        await prisma.fbCommentRule.delete({ where: { id: String(req.params.id) } })
        res.json({ success: true })
    } catch { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// GET /api/fanpage/pages/:pageId/auto-reply-log
router.get('/pages/:pageId/auto-reply-log', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const logs = await prisma.fbAutoReplyLog.findMany({
            where: { pageId: String(req.params.pageId) }, orderBy: { createdAt: 'desc' }, take: 100,
        })
        res.json({ success: true, data: logs })
    } catch { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// ═══════════════════════════════════════════════════════════════════════════════
//  MESSENGER INBOX — page token cần pages_messaging (thêm 2026-08-15, cùng
//  FacebookService với 3 tool MCP fanpage_list_conversations/read/send)
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/fanpage/pages/:pageId/conversations?limit=20&unread=1
router.get('/pages/:pageId/conversations', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const pageId = String(req.params.pageId)
        const ctx = await getPageService(prisma, pageId)
        if (!ctx) return res.status(404).json({ success: false, error: 'Page chưa kết nối' })
        try {
            let list = await ctx.svc.listConversations(pageId, Math.min(Number(req.query.limit) || 20, 50))
            if (req.query.unread === '1') list = list.filter(c => c.unreadCount > 0)
            res.json({ success: true, data: list })
        } catch (e: any) {
            if ((e as FbGraphError)?.isTokenError) await markTokenExpired(prisma, pageId)
            sendGraphError(res, e)
        }
    } catch { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// GET /api/fanpage/conversations/:id/messages?pageId=…&limit=25
router.get('/conversations/:id/messages', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const pageId = String(req.query.pageId || '')
        const svc = await svcFromPage(prisma, pageId)
        if (!svc) return res.status(404).json({ success: false, error: 'Page chưa kết nối (thiếu pageId?)' })
        const msgs = await svc.listMessages(String(req.params.id), Math.min(Number(req.query.limit) || 25, 100))
        res.json({ success: true, data: msgs })
    } catch (e: any) { sendGraphError(res, e) }
})

// POST /api/fanpage/pages/:pageId/messages  { recipientId, message, tag? }
router.post('/pages/:pageId/messages', authMiddleware, requireRole('admin', 'manager', 'superadmin'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const pageId = String(req.params.pageId)
        const { recipientId, message, tag } = req.body || {}
        if (!recipientId || !String(message || '').trim()) {
            return res.status(400).json({ success: false, error: 'Thiếu recipientId/message' })
        }
        const svc = await svcFromPage(prisma, pageId)
        if (!svc) return res.status(404).json({ success: false, error: 'Page chưa kết nối' })
        const r = await svc.sendMessage(pageId, String(recipientId), String(message).trim(), tag ? String(tag) : undefined)
        res.json({ success: true, data: r })
    } catch (e: any) { sendGraphError(res, e) }
})

// ═══════════════════════════════════════════════════════════════════════════════
//  ADS (Marketing API) — cần USER token có ads_management + App Review
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/fanpage/adaccounts
router.get('/adaccounts', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const svc = await getUserService(prisma)
        if (!svc) return res.status(404).json({ success: false, error: 'Chưa kết nối tài khoản Facebook' })
        const accounts = await svc.listAdAccounts()
        res.json({ success: true, data: accounts })
    } catch (e: any) { sendGraphError(res, e) }
})

// GET /api/fanpage/adaccounts/:actId/campaigns
router.get('/adaccounts/:actId/campaigns', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const svc = await getUserService(prisma)
        if (!svc) return res.status(404).json({ success: false, error: 'Chưa kết nối tài khoản Facebook' })
        const campaigns = await svc.listCampaigns(String(req.params.actId))
        // Kèm insight từng campaign (best-effort)
        const withInsights = await Promise.all(campaigns.map(async (c: any) => {
            const insights = await svc.getAdInsights(c.id).catch(() => null)
            return { ...c, insights }
        }))
        res.json({ success: true, data: withInsights })
    } catch (e: any) { sendGraphError(res, e) }
})

// GET /api/fanpage/ads/insights/:objectId?datePreset=last_30d
router.get('/ads/insights/:objectId', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const svc = await getUserService(prisma)
        if (!svc) return res.status(404).json({ success: false, error: 'Chưa kết nối tài khoản Facebook' })
        const insights = await svc.getAdInsights(String(req.params.objectId), (req.query.datePreset as string) || 'last_30d')
        res.json({ success: true, data: insights })
    } catch (e: any) { sendGraphError(res, e) }
})

// POST /api/fanpage/campaigns/:id/status  { status: ACTIVE|PAUSED }
router.post('/campaigns/:id/status', authMiddleware, requireRole('admin', 'manager', 'superadmin'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const svc = await getUserService(prisma)
        if (!svc) return res.status(404).json({ success: false, error: 'Chưa kết nối tài khoản Facebook' })
        const status = req.body?.status === 'ACTIVE' ? 'ACTIVE' : 'PAUSED'
        await svc.setCampaignStatus(String(req.params.id), status)
        res.json({ success: true })
    } catch (e: any) { sendGraphError(res, e) }
})

// POST /api/fanpage/boost  { adAccountId, pageId, postId, dailyBudgetVnd, days, targeting?, objective? }
router.post('/boost', authMiddleware, requireRole('admin', 'manager', 'superadmin'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const svc = await getUserService(prisma)
        if (!svc) return res.status(404).json({ success: false, error: 'Chưa kết nối tài khoản Facebook' })
        const { adAccountId, pageId, postId, dailyBudgetVnd, days = 7, targeting, objective } = req.body || {}
        if (!adAccountId || !pageId || !postId || !dailyBudgetVnd) {
            return res.status(400).json({ success: false, error: 'Thiếu adAccountId/pageId/postId/dailyBudgetVnd' })
        }
        // object_story_id phải dạng {pageId}_{postId}
        const objectStoryId = String(postId).includes('_') ? String(postId) : `${pageId}_${postId}`
        const result = await svc.boostPost({ adAccountId, pageId, postId: objectStoryId, dailyBudgetVnd, days, targeting, objective })
        res.json({ success: true, data: result })
    } catch (e: any) { sendGraphError(res, e) }
})

export default router
