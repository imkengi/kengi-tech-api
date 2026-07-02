// ═══════════════════════════════════════════════════════════════════════════════
//  FACEBOOK SERVICE — Graph API + Marketing API cho Fanpage Manager
//
//  Khác các platform service khác (order-centric), service này quản lý fanpage:
//   - Đổi token ngắn hạn → dài hạn, liệt kê page + token page
//   - Đăng bài / lên lịch (text, ảnh, nhiều ảnh, video, link)
//   - Comment: đọc, trả lời, private reply, ẩn, xoá
//   - Ads (Marketing API): ad account, campaign, insight, boost bài
//
//  Lưu ý quyền:
//   - Post/comment: dùng PAGE access token
//   - Ads: BẮT BUỘC dùng USER token có ads_management (page token không chạy ads)
// ═══════════════════════════════════════════════════════════════════════════════

const GRAPH_VERSION = process.env.FB_GRAPH_VERSION || 'v21.0'
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`
const GRAPH_VIDEO = `https://graph-video.facebook.com/${GRAPH_VERSION}`

export interface FbGraphError extends Error {
    code?: number
    subcode?: number
    fbtraceId?: string
    isTokenError?: boolean
}

/** Mã rate-limit của Graph: 4 (app), 17 (user), 32 (page), 613 (custom throttle) */
export function isRateLimitError(err: any): boolean {
    const c = err?.code
    return c === 4 || c === 17 || c === 32 || c === 613
}

export interface FbPageInfo {
    id: string
    name: string
    category?: string
    picture?: string
    fanCount?: number
    accessToken: string
    igUserId?: string
}

export interface FbComment {
    id: string
    message: string
    from?: { id: string; name: string }
    createdTime: string
    likeCount?: number
    canReply?: boolean
    isHidden?: boolean
    postId?: string
}

export interface SchedulePostInput {
    pageId: string
    message: string
    mediaType?: 'text' | 'photo' | 'video' | 'link' | 'multi_photo'
    mediaUrls?: string[]
    linkUrl?: string
    /** Unix ms. Bỏ trống = đăng ngay */
    scheduledAtMs?: number | null
}

export class FacebookService {
    /** token dùng cho mọi lệnh instance (page token cho post/comment, user token cho ads) */
    private token: string

    constructor(token: string) {
        this.token = (token || '').trim()
    }

    // ─── Low-level Graph helpers ──────────────────────────────────────────────

    private buildError(payload: any, httpStatus: number): FbGraphError {
        const e = payload?.error || {}
        const err = new Error(e.message || `Facebook Graph error (HTTP ${httpStatus})`) as FbGraphError
        err.code = e.code
        err.subcode = e.error_subcode
        err.fbtraceId = e.fbtrace_id
        // 190 = token hết hạn/không hợp lệ; 102 = session; 10/200 = quyền
        err.isTokenError = e.code === 190 || e.code === 102 || e.type === 'OAuthException'
        return err
    }

    private async parse(res: Response): Promise<any> {
        const text = await res.text()
        let json: any
        try {
            json = JSON.parse(text)
        } catch {
            throw new Error(`HTTP ${res.status} ${res.statusText}: ${text.slice(0, 500)}`)
        }
        if (!res.ok || json?.error) throw this.buildError(json, res.status)
        return json
    }

    /** GET Graph: fields là object query params (access_token tự thêm) */
    async get(path: string, params: Record<string, any> = {}): Promise<any> {
        const qs = new URLSearchParams({ access_token: this.token })
        for (const [k, v] of Object.entries(params)) {
            if (v === undefined || v === null) continue
            qs.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v))
        }
        const res = await fetch(`${GRAPH}/${path}?${qs.toString()}`, { method: 'GET' })
        return this.parse(res)
    }

    /** POST Graph (form-urlencoded). Field object/array được JSON hoá. */
    async post(path: string, params: Record<string, any> = {}, base = GRAPH): Promise<any> {
        const body = new URLSearchParams()
        body.set('access_token', this.token)
        for (const [k, v] of Object.entries(params)) {
            if (v === undefined || v === null) continue
            body.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v))
        }
        const res = await fetch(`${base}/${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body.toString(),
        })
        return this.parse(res)
    }

    async del(path: string): Promise<any> {
        const res = await fetch(`${GRAPH}/${path}?access_token=${encodeURIComponent(this.token)}`, { method: 'DELETE' })
        return this.parse(res)
    }

    // ─── Auth / token / pages ─────────────────────────────────────────────────

    /** Đổi short-lived token → long-lived (~60 ngày). Static: dùng app creds. */
    static async exchangeLongLivedToken(shortToken: string, appId: string, appSecret: string): Promise<{ accessToken: string; expiresIn: number }> {
        const qs = new URLSearchParams({
            grant_type: 'fb_exchange_token',
            client_id: appId,
            client_secret: appSecret,
            fb_exchange_token: shortToken,
        })
        const res = await fetch(`${GRAPH}/oauth/access_token?${qs.toString()}`)
        const text = await res.text()
        let json: any
        try { json = JSON.parse(text) } catch { throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`) }
        if (!res.ok || json.error) throw new Error(json.error?.message || `Token exchange failed (HTTP ${res.status})`)
        return { accessToken: json.access_token, expiresIn: json.expires_in || 60 * 24 * 3600 }
    }

    /** /me — thông tin user token hiện tại */
    async getMe(): Promise<{ id: string; name?: string }> {
        return this.get('me', { fields: 'id,name' })
    }

    /** /me/accounts — danh sách page + PAGE access token (token instance phải là USER token) */
    async listPages(): Promise<FbPageInfo[]> {
        const out: FbPageInfo[] = []
        let after: string | undefined
        do {
            const data = await this.get('me/accounts', {
                fields: 'id,name,category,picture{url},fan_count,access_token,instagram_business_account',
                limit: 100,
                after,
            })
            for (const p of data.data || []) {
                out.push({
                    id: p.id,
                    name: p.name,
                    category: p.category,
                    picture: p.picture?.data?.url,
                    fanCount: p.fan_count || 0,
                    accessToken: p.access_token,
                    igUserId: p.instagram_business_account?.id,
                })
            }
            after = data.paging?.cursors?.after && data.paging?.next ? data.paging.cursors.after : undefined
        } while (after)
        return out
    }

    // ─── Posts / scheduling ───────────────────────────────────────────────────

    /**
     * Tạo bài (đăng ngay nếu scheduledAtMs rỗng, ngược lại lên lịch).
     * Trả về { id } post trên FB.
     */
    async createOrSchedulePost(input: SchedulePostInput): Promise<{ id: string }> {
        const { pageId, message, linkUrl, mediaUrls = [] } = input
        const mediaType = input.mediaType || 'text'
        const scheduled = input.scheduledAtMs && input.scheduledAtMs > Date.now()
        const schedFields: Record<string, any> = scheduled
            ? { published: false, scheduled_publish_time: Math.floor(input.scheduledAtMs! / 1000) }
            : {}

        if (mediaType === 'photo' && mediaUrls[0]) {
            return this.post(`${pageId}/photos`, { url: mediaUrls[0], message, ...schedFields })
        }

        if (mediaType === 'video' && mediaUrls[0]) {
            return this.post(`${pageId}/videos`, { file_url: mediaUrls[0], description: message, ...schedFields }, GRAPH_VIDEO)
        }

        if (mediaType === 'multi_photo' && mediaUrls.length) {
            // Upload từng ảnh dạng unpublished → gom media_fbid vào feed
            const fbids: string[] = []
            for (const url of mediaUrls) {
                const r = await this.post(`${pageId}/photos`, { url, published: false, temporary: true })
                if (r.id) fbids.push(r.id)
            }
            return this.post(`${pageId}/feed`, {
                message,
                attached_media: fbids.map(id => ({ media_fbid: id })),
                ...schedFields,
            })
        }

        // text hoặc link
        const params: Record<string, any> = { message, ...schedFields }
        if (mediaType === 'link' && linkUrl) params.link = linkUrl
        return this.post(`${pageId}/feed`, params)
    }

    /** Danh sách bài đã lên lịch (chưa đăng) trực tiếp từ FB */
    async listScheduledPosts(pageId: string): Promise<Array<{ id: string; message?: string; scheduledPublishTime?: number; createdTime?: string }>> {
        const data = await this.get(`${pageId}/scheduled_posts`, {
            fields: 'id,message,scheduled_publish_time,created_time',
            limit: 100,
        })
        return (data.data || []).map((p: any) => ({
            id: p.id,
            message: p.message,
            scheduledPublishTime: p.scheduled_publish_time,
            createdTime: p.created_time,
        }))
    }

    /** Đổi giờ đăng / nội dung của bài đã lên lịch */
    async editScheduledPost(postId: string, changes: { scheduledAtMs?: number; message?: string }): Promise<{ success: boolean }> {
        const params: Record<string, any> = {}
        if (changes.message !== undefined) params.message = changes.message
        if (changes.scheduledAtMs) params.scheduled_publish_time = Math.floor(changes.scheduledAtMs / 1000)
        await this.post(postId, params)
        return { success: true }
    }

    /** Đăng ngay bài đang lên lịch */
    async publishNow(postId: string): Promise<{ success: boolean }> {
        await this.post(postId, { is_published: true })
        return { success: true }
    }

    async deletePost(postId: string): Promise<{ success: boolean }> {
        await this.del(postId)
        return { success: true }
    }

    /** Bài đã đăng gần đây (kèm số liệu tương tác) */
    async listPublishedPosts(pageId: string, limit = 25): Promise<any[]> {
        const data = await this.get(`${pageId}/posts`, {
            fields: 'id,message,created_time,permalink_url,full_picture,attachments{media_type,type},reactions.summary(true),comments.summary(true),shares',
            limit,
        })
        return data.data || []
    }

    // ─── Comments ─────────────────────────────────────────────────────────────

    /** Comment mới nhất trên các post gần đây của page (đã phẳng hoá + kèm postId) */
    async listRecentComments(pageId: string, postLimit = 25): Promise<FbComment[]> {
        const data = await this.get(`${pageId}/posts`, {
            fields: `id,message,comments.limit(50){id,message,from,created_time,like_count,can_reply_privately,is_hidden}`,
            limit: postLimit,
        })
        const out: FbComment[] = []
        for (const post of data.data || []) {
            for (const c of post.comments?.data || []) {
                out.push({
                    id: c.id,
                    message: c.message || '',
                    from: c.from,
                    createdTime: c.created_time,
                    likeCount: c.like_count,
                    canReply: c.can_reply_privately,
                    isHidden: c.is_hidden,
                    postId: post.id,
                })
            }
        }
        return out
    }

    async getPostComments(postId: string, limit = 100): Promise<FbComment[]> {
        const data = await this.get(`${postId}/comments`, {
            fields: 'id,message,from,created_time,like_count,is_hidden',
            limit,
            order: 'reverse_chronological',
        })
        return (data.data || []).map((c: any) => ({
            id: c.id, message: c.message || '', from: c.from,
            createdTime: c.created_time, likeCount: c.like_count, isHidden: c.is_hidden, postId,
        }))
    }

    async replyToComment(commentId: string, message: string): Promise<{ id: string }> {
        return this.post(`${commentId}/comments`, { message })
    }

    /** Private reply (chỉ trong 7 ngày kể từ comment, cần pages_messaging) */
    async privateReply(commentId: string, message: string): Promise<any> {
        return this.post(`${commentId}/private_replies`, { message })
    }

    async hideComment(commentId: string, hidden = true): Promise<{ success: boolean }> {
        await this.post(commentId, { is_hidden: hidden })
        return { success: true }
    }

    async deleteComment(commentId: string): Promise<{ success: boolean }> {
        await this.del(commentId)
        return { success: true }
    }

    async likeComment(commentId: string, like = true): Promise<{ success: boolean }> {
        if (like) await this.post(`${commentId}/likes`)
        else await this.del(`${commentId}/likes`)
        return { success: true }
    }

    // ─── Insights (bài viết / page) ──────────────────────────────────────────

    async getPageInsights(pageId: string, metrics = 'page_impressions_unique,page_engaged_users', sinceDays = 7): Promise<any> {
        const since = Math.floor((Date.now() - sinceDays * 86400_000) / 1000)
        return this.get(`${pageId}/insights`, { metric: metrics, period: 'day', since })
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  MARKETING API (ADS) — token instance phải là USER token có ads_management
    // ═══════════════════════════════════════════════════════════════════════════

    async listAdAccounts(): Promise<any[]> {
        const data = await this.get('me/adaccounts', {
            fields: 'id,account_id,name,account_status,currency,amount_spent,balance,spend_cap',
            limit: 100,
        })
        return data.data || []
    }

    /** act_<id> */
    async listCampaigns(adAccountId: string): Promise<any[]> {
        const acct = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`
        const data = await this.get(`${acct}/campaigns`, {
            fields: 'id,name,objective,status,effective_status,daily_budget,lifetime_budget,start_time,stop_time',
            limit: 100,
        })
        return data.data || []
    }

    /** Insight cho object bất kỳ (act_/campaign/adset/ad) */
    async getAdInsights(objectId: string, datePreset = 'last_30d'): Promise<any> {
        const data = await this.get(`${objectId}/insights`, {
            fields: 'impressions,reach,spend,clicks,ctr,cpc,cpm,actions,action_values',
            date_preset: datePreset,
        })
        return data.data?.[0] || null
    }

    async setCampaignStatus(campaignId: string, status: 'ACTIVE' | 'PAUSED'): Promise<{ success: boolean }> {
        await this.post(campaignId, { status })
        return { success: true }
    }

    /**
     * Boost 1 bài đã có: tạo campaign → adset → adcreative (object_story_id) → ad.
     * budgetVnd tính theo ngày; FB nhận minor units (VND không có phần lẻ nên nhân 1).
     * Trả về id các đối tượng đã tạo (PAUSED để user review trước khi bật).
     */
    async boostPost(input: {
        adAccountId: string
        pageId: string
        postId: string // dạng {pageId}_{postId} (object_story_id)
        dailyBudgetVnd: number
        days: number
        targeting?: any
        objective?: string
    }): Promise<{ campaignId: string; adsetId: string; adId: string }> {
        const acct = input.adAccountId.startsWith('act_') ? input.adAccountId : `act_${input.adAccountId}`
        const objective = input.objective || 'OUTCOME_ENGAGEMENT'
        // VND là zero-decimal currency ở Marketing API → truyền nguyên số.
        const dailyBudget = Math.round(input.dailyBudgetVnd)
        const now = Math.floor(Date.now() / 1000)
        const stop = now + input.days * 86400

        const campaign = await this.post(`${acct}/campaigns`, {
            name: `Boost ${input.postId} · ${new Date(now * 1000).toISOString().slice(0, 10)}`,
            objective,
            status: 'PAUSED',
            special_ad_categories: [],
        })

        const targeting = input.targeting || { geo_locations: { countries: ['VN'] }, age_min: 18, age_max: 65 }
        const adset = await this.post(`${acct}/adsets`, {
            name: `AdSet ${input.postId}`,
            campaign_id: campaign.id,
            daily_budget: dailyBudget,
            billing_event: 'IMPRESSIONS',
            optimization_goal: 'POST_ENGAGEMENT',
            bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
            start_time: now,
            end_time: stop,
            targeting,
            status: 'PAUSED',
        })

        const creative = await this.post(`${acct}/adcreatives`, {
            name: `Creative ${input.postId}`,
            object_story_id: input.postId,
        })

        const ad = await this.post(`${acct}/ads`, {
            name: `Ad ${input.postId}`,
            adset_id: adset.id,
            creative: { creative_id: creative.id },
            status: 'PAUSED',
        })

        return { campaignId: campaign.id, adsetId: adset.id, adId: ad.id }
    }
}

export { GRAPH_VERSION, GRAPH }
