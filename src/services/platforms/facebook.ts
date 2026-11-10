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
/* Marketing API (quảng cáo) có vòng đời RIÊNG, ngắn hơn Graph API: mỗi bản chỉ sống ~1 năm (changelog Marketing API:
 * v24 hết 10/11/2026, v25 hết 23/02/2027, v26 ra 29/07/2026). Gọi quảng cáo bằng v21 là gọi bản đã khai tử ⇒ đi bản riêng,
 * đổi bằng FB_ADS_GRAPH_VERSION khi Facebook ra bản mới. */
const ADS_GRAPH_VERSION = process.env.FB_ADS_GRAPH_VERSION || 'v26.0'
const GRAPH_ADS = `https://graph.facebook.com/${ADS_GRAPH_VERSION}`

/**
 * Công thức Marketing API cho "đẩy bài có sẵn" (boost) — MỘT chỗ, dùng chung boostPost (Fanpage Manager / MCP) và Ads Pilot.
 * Chiến dịch tạo ở PAUSED: chưa bật chiến dịch thì nhóm quảng cáo / quảng cáo bên trong chưa tiêu đồng nào.
 *  - v24+: không dùng ngân sách chiến dịch thì PHẢI khai is_adset_budget_sharing_enabled (thiếu ⇒ lỗi subcode 4834011).
 */
export function thamSoChienDichDayBai(ten: string, objective = 'OUTCOME_ENGAGEMENT'): Record<string, any> {
    return { name: String(ten).slice(0, 400), objective, status: 'PAUSED', special_ad_categories: [], is_adset_budget_sharing_enabled: false }
}

/**
 * Nhóm quảng cáo đẩy một bài: tối ưu tương tác bài, trả tiền theo lượt hiển thị, giá thầu thấp nhất, nhắm bài của page
 * (promoted_object.page_id — bắt buộc khi đẩy bài). Ngân sách NGÀY bằng VND (tiền tệ không phần lẻ ⇒ truyền nguyên số);
 * Facebook chỉ nhận ngân sách ngày cho nhóm chạy > 24 giờ. LUÔN có giờ kết thúc ⇒ không chạy mãi.
 *  - v23+: đối tượng khác mặc định PHẢI khai targeting_automation.advantage_audience 0|1 — 0 = giữ đúng đối tượng đã chọn.
 *  - status ACTIVE nằm trong chiến dịch PAUSED ⇒ chiến dịch là công tắc duy nhất (bật / tạm dừng một chỗ).
 */
export function thamSoNhomDayBai(o: {
    ten: string; campaignId: string; pageId: string; dailyBudgetVnd: number; batDauGiay: number; ketThucGiay: number; targeting?: any
}): Record<string, any> {
    const targeting = { ...(o.targeting || { geo_locations: { countries: ['VN'] }, age_min: 18, age_max: 65 }) }
    if (!targeting.targeting_automation) targeting.targeting_automation = { advantage_audience: 0 }
    return {
        name: String(o.ten).slice(0, 400), campaign_id: o.campaignId, daily_budget: Math.round(o.dailyBudgetVnd),
        billing_event: 'IMPRESSIONS', optimization_goal: 'POST_ENGAGEMENT', bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
        promoted_object: { page_id: o.pageId }, start_time: o.batDauGiay, end_time: o.ketThucGiay, targeting, status: 'ACTIVE',
    }
}

export interface FbGraphError extends Error {
    code?: number
    subcode?: number
    fbtraceId?: string
    /** CHỈ token hỏng thật: #190 / #102 (xem loaiLoiFb) — trước 09/11/2026 là mọi type 'OAuthException' */
    isTokenError?: boolean
    /** Graph tự báo lỗi tạm thời (`is_transient`) — thử lại sau là được */
    isTransient?: boolean
    httpStatus?: number
    /** Lệnh GHI không biết kết cục (HTTP 5xx / hết giờ / phản hồi không phải JSON / đứt mạng sau khi gửi) ⇒ có thể ĐÃ lên.
     *  false = FacebookService chắc chắn chưa ghi gì (vd ảnh tải ẩn của bài nhiều ảnh hỏng trước khi gọi /feed). */
    khongRoKetCuc?: boolean
    /** hết giờ chờ Graph (AbortSignal.timeout) */
    hetGio?: boolean
}

/* ── Phân loại lỗi Graph theo MÃ (09/11/2026) ──
 * Graph gắn type 'OAuthException' cho cả #100 (tham số / ảnh hỏng), #200 (thiếu quyền), #4/#17/#32/#613 (hạn mức). Trước đây
 * mọi OAuthException đều là "token hỏng" ⇒ fanpage bị đánh dấu token_expired, Facebook Pilot + đối soát dừng hẳn tới khi chủ
 * shop dán token mới — chỉ vì MỘT ảnh lỗi hay MỘT lần chạm hạn mức. Một luật chung cho Fanpage Manager, Facebook Pilot,
 * Ads Pilot, cron đối soát (Ads Pilot vốn đã phân loại theo mã — giờ dùng chính các hàm này). */
export type LoaiLoiFb = 'khong_ro' | 'tam_thoi' | 'token' | 'quyen' | 'du_lieu' | 'khac'

/** Hạn mức / tạm thời: 4 (app), 17 (user), 32 (page), 613 (throttle riêng), 80000–80014 (hạn mức Marketing API theo tài khoản
 *  quảng cáo — cùng danh sách laGioiHan của Ads drill), hoặc Graph gắn is_transient. Lùi rồi thử lại — KHÔNG đổi trạng thái trang. */
export function isRateLimitError(err: any): boolean {
    const c = Number(err?.code)
    return c === 4 || c === 17 || c === 32 || c === 613 || (c >= 80000 && c <= 80014) || err?.isTransient === true
}

/** Token hỏng: CHỈ #190 (mọi subcode — 458–467 là hết hạn / đổi mật khẩu / gỡ app / phiên vô hiệu) hoặc #102 (phiên).
 *  Lỗi Graph tự báo tạm thời thì không tính (thử lại là được — đừng giết fanpage vì nó). */
export function laLoiTokenFb(err: any): boolean {
    const c = Number(err?.code)
    return (c === 190 || c === 102) && !isRateLimitError(err)
}

/** Thiếu quyền: #10, #200–299 (vd #200 pages_manage_posts, #294 ads_management). */
export function laLoiQuyenFb(err: any): boolean {
    const c = Number(err?.code)
    return c === 10 || (c >= 200 && c <= 299)
}

export function loaiLoiFb(err: any): LoaiLoiFb {
    if (err?.khongRoKetCuc === true) return 'khong_ro'
    if (isRateLimitError(err)) return 'tam_thoi'
    if (laLoiTokenFb(err)) return 'token'
    if (laLoiQuyenFb(err)) return 'quyen'
    // #100: tham số / dữ liệu của RIÊNG lệnh này (ảnh không tải được, chữ quá dài, đối tượng không còn…) — trang vẫn sống
    if (Number(err?.code) === 100) return 'du_lieu'
    return 'khac'
}

/** Tên quyền Graph nhắc trong lỗi thiếu quyền (vd "(#200) Requires pages_manage_posts permission…") — null nếu không có. */
export function quyenThieuFb(err: any): string | null {
    const m = String(err?.message || '').match(/\b(pages_[a-z_]+|ads_management|ads_read|business_management|read_insights|publish_video|instagram_[a-z_]+)\b/i)
    return m ? m[1] : null
}

/** Chờ Graph tối đa bấy nhiêu (09/11/2026) — fetch không hẹn giờ thì một lời gọi treo giữ kế hoạch 'running' mãi.
 *  Đọc 30 giây; ghi 90 giây (Facebook tự tải ảnh từ URL); video 5 phút (Facebook tải cả tệp). */
const CHO_DOC_MS = 30_000
const CHO_GHI_MS = 90_000
const CHO_VIDEO_MS = 300_000

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

/**
 * Đọc LẺ nhiều đối tượng Graph — thay lời gọi gộp gốc `GET /?ids=`, thứ Facebook trả lỗi ở MỌI phiên bản từ 27/10/2026 (changelog
 * Graph v26.0: "Use per-object requests or supported batching"). Mỗi đợt `dong` lời gọi song song — CHỈ gọi Facebook qua `doc`,
 * ⛔ đừng đưa prisma vào đây (prod pool 1 kết nối / cửa hàng). Dừng khi quá `hanMs` (đo từ lúc bắt đầu) hoặc khi `dungKhi(lỗi)` đúng
 * (token hỏng / hạn mức — gọi tiếp chỉ đốt lượt). Trả Map mã → kết quả; mã lỗi hoặc chưa kịp đọc thì vắng mặt.
 */
export async function docLeGraph<T>(ids: string[], doc: (id: string) => Promise<T>, o: {
    dong?: number; hanMs?: number; dungKhi?: (e: any) => boolean; onLoi?: (id: string, e: any) => void
} = {}): Promise<Map<string, T>> {
    const ra = new Map<string, T>()
    const dong = Math.max(1, o.dong ?? 5)
    const batDau = Date.now()
    let thoi = false
    for (let i = 0; i < ids.length && !thoi && (o.hanMs == null || Date.now() - batDau < o.hanMs); i += dong) {
        await Promise.all(ids.slice(i, i + dong).map(async id => {
            try { ra.set(id, await doc(id)) } catch (e: any) {
                if (o.dungKhi?.(e)) thoi = true
                o.onLoi?.(id, e)
            }
        }))
    }
    return ra
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
        err.httpStatus = httpStatus
        err.isTransient = e.is_transient === true
        // 09/11/2026: theo MÃ (190 / 102), KHÔNG theo type 'OAuthException' — Graph gắn type đó cả cho #100, #200, #4/#17/#32/#613
        err.isTokenError = laLoiTokenFb(err)
        return err
    }

    /** Một lời gọi Graph có hẹn giờ. `ghi` = lệnh ghi: chưa có phản hồi trọn vẹn (hết giờ / đứt mạng) thì Facebook có thể đã
     *  nhận ⇒ gắn khongRoKetCuc để người gọi ghi 'uncertain', không 'failed' (đăng lại là đăng đúp). */
    private async goi(url: string, init: RequestInit, ghi: boolean, ms: number): Promise<any> {
        const loiChuaCoPhanHoi = (e: any): FbGraphError => {
            const hetGio = e?.name === 'TimeoutError' || e?.name === 'AbortError'
            const err = new Error(hetGio
                ? `Facebook không trả lời sau ${Math.round(ms / 1000)} giây (aborted: timeout)`
                : `Không gọi được Facebook: ${String(e?.message || e)}`) as FbGraphError
            err.hetGio = hetGio
            if (ghi) err.khongRoKetCuc = true
            return err
        }
        let res: Response
        let text: string
        try {
            res = await fetch(url, { ...init, signal: AbortSignal.timeout(ms) })
            text = await res.text()
        } catch (e: any) {
            throw loiChuaCoPhanHoi(e)
        }
        let json: any
        try {
            json = JSON.parse(text)
        } catch {
            const err = new Error(`HTTP ${res.status} ${res.statusText}: ${text.slice(0, 500)}`) as FbGraphError
            err.httpStatus = res.status
            // phản hồi không phải JSON (trang lỗi của proxy / Facebook quá tải) ⇒ không biết lệnh ghi đã tới chưa
            if (ghi) err.khongRoKetCuc = true
            throw err
        }
        if (!res.ok || json?.error) {
            const err = this.buildError(json, res.status)
            // 5xx = Facebook lỗi phía máy chủ SAU khi nhận lệnh — bài / bình luận có thể đã lên
            if (ghi && res.status >= 500) err.khongRoKetCuc = true
            throw err
        }
        return json
    }

    /** GET Graph: fields là object query params (access_token tự thêm). `base` = GRAPH_ADS cho lời gọi quảng cáo. */
    async get(path: string, params: Record<string, any> = {}, base = GRAPH): Promise<any> {
        const qs = new URLSearchParams({ access_token: this.token })
        for (const [k, v] of Object.entries(params)) {
            if (v === undefined || v === null) continue
            qs.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v))
        }
        return this.goi(`${base}/${path}?${qs.toString()}`, { method: 'GET' }, false, CHO_DOC_MS)
    }

    /** POST Graph (form-urlencoded). Field object/array được JSON hoá. */
    async post(path: string, params: Record<string, any> = {}, base = GRAPH): Promise<any> {
        const body = new URLSearchParams()
        body.set('access_token', this.token)
        for (const [k, v] of Object.entries(params)) {
            if (v === undefined || v === null) continue
            body.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v))
        }
        return this.goi(`${base}/${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body.toString(),
        }, true, base === GRAPH_VIDEO ? CHO_VIDEO_MS : CHO_GHI_MS)
    }

    async del(path: string): Promise<any> {
        return this.goi(`${GRAPH}/${path}?access_token=${encodeURIComponent(this.token)}`, { method: 'DELETE' }, true, CHO_GHI_MS)
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
        const res = await fetch(`${GRAPH}/oauth/access_token?${qs.toString()}`, { signal: AbortSignal.timeout(CHO_DOC_MS) })
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

    /**
     * Nhận diện token dán tay là PAGE token hay USER token, kèm thông tin page.
     * `metadata=1` khiến Graph trả `metadata.type` = "page" | "user" — cách duy nhất
     * chắc chắn mà KHÔNG cần app token (debug_token đòi app secret, ở đây không có).
     * Nhầm user token thay page token là lỗi phổ biến nhất khi copy từ Graph Explorer:
     * /me vẫn chạy nên tưởng đúng, tới lúc đăng bài/đọc inbox mới hỏng (code 190).
     */
    async identifyToken(): Promise<{
        type: string; id: string; name?: string; category?: string; fanCount?: number; picture?: string
    }> {
        // 09/11/2026: bỏ `metadata=1` — Facebook thôi trả metadata ở MỌI phiên bản từ 19/05/2026 (changelog Graph v25.0 "Node
        // metadata") ⇒ `type` cũ luôn rỗng, dán USER token chỉ nhận lỗi #100 khó hiểu. Nay suy loại từ chính /me: đọc được category +
        // fan_count (chỉ node Page có cả hai) ⇒ 'page'; lỗi "#100 … on node type (User)" ⇒ đọc lại id/name rồi trả 'user' để
        // người gọi báo đúng "đây là USER token". Lỗi khác (token chết…) ném nguyên như cũ.
        let d: any
        let type = 'page'
        try {
            d = await this.get('me', { fields: 'id,name,category,fan_count,picture{url}' })
        } catch (e: any) {
            const node = /node type \((\w+)\)/i.exec(String(e?.message || ''))?.[1]
            if (Number(e?.code) !== 100 || !node || node.toLowerCase() === 'page') throw e
            type = node.toLowerCase()
            d = await this.get('me', { fields: 'id,name' })
        }
        return {
            type,
            id: String(d.id),
            name: d.name,
            category: d.category,
            fanCount: d.fan_count || 0,
            picture: d.picture?.data?.url,
        }
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
                let r: any
                try {
                    r = await this.post(`${pageId}/photos`, { url, published: false, temporary: true })
                } catch (e: any) {
                    // ảnh tải ẨN (published:false, temporary) chưa phải bài — hỏng / hết giờ ở bước này thì bài CHẮC CHẮN chưa lên
                    // (chưa gọi /feed) ⇒ đánh dấu "chưa ghi", người gọi ghi 'failed' chứ không 'uncertain' (09/11/2026)
                    if (e && typeof e === 'object') e.khongRoKetCuc = false
                    throw e
                }
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

    /** Sửa chữ một bài ĐÃ ĐĂNG của page (POST /{page-post-id} message — tài liệu Pages API "Cập nhật bài viết", đọc 10/11/2026).
     *  Facebook chỉ cho sửa bài DO CHÍNH APP tạo; ảnh / giờ đăng giữ nguyên. */
    async editPost(postId: string, message: string): Promise<{ success: boolean }> {
        await this.post(postId, { message })
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

    // ─── Webhook subscription ─────────────────────────────────────────────────

    /**
     * Đăng ký app nhận webhook `feed` của page (token instance phải là PAGE token).
     * Không có bước này FB KHÔNG bắn event → auto-reply server-side im lặng,
     * chỉ còn đường lùi poll mỗi 5 phút của fanpageCron.
     */
    async subscribeWebhook(pageId: string, fields = 'feed,messages,messaging_postbacks'): Promise<{ success: boolean }> {
        await this.post(`${pageId}/subscribed_apps`, { subscribed_fields: fields })
        return { success: true }
    }

    /** App nào đang nhận webhook của page (để hiển thị/đối soát trạng thái) */
    async getSubscribedApps(pageId: string): Promise<any[]> {
        const data = await this.get(`${pageId}/subscribed_apps`)
        return data.data || []
    }

    async unsubscribeWebhook(pageId: string): Promise<{ success: boolean }> {
        await this.del(`${pageId}/subscribed_apps`)
        return { success: true }
    }

    // ─── Insights (bài viết / page) ──────────────────────────────────────────

    /** 09/11/2026: mặc định cũ `page_impressions_unique,page_engaged_users` hỏng cả lời gọi — `page_engaged_users` không còn trong
     *  tham chiếu Insights, `page_impressions_unique` bị bỏ ở MỌI phiên bản từ khi Graph v26.0 ra (29/07/2026; changelog v25.0 gợi ý
     *  thay bằng `page_total_media_view_unique`). Nay: người xem duy nhất + lượt tương tác bài, cả hai có period=day. */
    async getPageInsights(pageId: string, metrics = 'page_total_media_view_unique,page_post_engagements', sinceDays = 7): Promise<any> {
        const since = Math.floor((Date.now() - sinceDays * 86400_000) / 1000)
        return this.get(`${pageId}/insights`, { metric: metrics, period: 'day', since })
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  MESSENGER (INBOX) — page token cần pages_messaging (+ pages_read_engagement)
    // ═══════════════════════════════════════════════════════════════════════════

    /** Hội thoại Messenger của page, mới nhất trước. `participants` gồm cả page. */
    async listConversations(pageId: string, limit = 20): Promise<Array<{
        id: string; updatedTime: string; unreadCount: number; snippet: string; canReply: boolean
        participants: Array<{ id: string; name: string }>
    }>> {
        const data = await this.get(`${pageId}/conversations`, {
            fields: 'id,updated_time,unread_count,snippet,can_reply,participants',
            limit,
        })
        return (data.data || []).map((c: any) => ({
            id: c.id, updatedTime: c.updated_time, unreadCount: c.unread_count || 0,
            snippet: c.snippet || '', canReply: c.can_reply !== false,
            participants: (c.participants?.data || []).map((p: any) => ({ id: p.id, name: p.name })),
        }))
    }

    /** Tin nhắn trong 1 hội thoại, mới nhất trước. */
    async listMessages(conversationId: string, limit = 25): Promise<Array<{
        id: string; message: string; createdTime: string; from: { id: string; name?: string }; attachments: number
    }>> {
        const data = await this.get(`${conversationId}/messages`, {
            fields: 'id,message,created_time,from,attachments{mime_type}',
            limit,
        })
        return (data.data || []).map((m: any) => ({
            id: m.id, message: m.message || '', createdTime: m.created_time,
            from: m.from || { id: '' }, attachments: m.attachments?.data?.length || 0,
        }))
    }

    /**
     * Gửi tin nhắn cho 1 người (PSID) qua Send API. Ngoài cửa sổ 24h kể từ tin
     * cuối của khách phải kèm tag (mặc định không tag → FB từ chối, ta báo lỗi).
     */
    async sendMessage(pageId: string, recipientId: string, text: string, tag?: string): Promise<{ id: string }> {
        const params: Record<string, any> = {
            recipient: { id: recipientId },
            message: { text },
            messaging_type: tag ? 'MESSAGE_TAG' : 'RESPONSE',
        }
        if (tag) params.tag = tag
        const r = await this.post(`${pageId}/messages`, params)
        return { id: r.message_id || r.id }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  MARKETING API (ADS) — token instance phải là USER token có ads_management
    // ═══════════════════════════════════════════════════════════════════════════

    async listAdAccounts(): Promise<any[]> {
        const data = await this.get('me/adaccounts', {
            fields: 'id,account_id,name,account_status,currency,amount_spent,balance,spend_cap',
            limit: 100,
        }, GRAPH_ADS)
        return data.data || []
    }

    /** act_<id> */
    async listCampaigns(adAccountId: string): Promise<any[]> {
        const acct = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`
        const data = await this.get(`${acct}/campaigns`, {
            fields: 'id,name,objective,status,effective_status,daily_budget,lifetime_budget,start_time,stop_time',
            limit: 100,
        }, GRAPH_ADS)
        return data.data || []
    }

    /** Insight cho object bất kỳ (act_/campaign/adset/ad) */
    async getAdInsights(objectId: string, datePreset = 'last_30d'): Promise<any> {
        const data = await this.get(`${objectId}/insights`, {
            fields: 'impressions,reach,spend,clicks,ctr,cpc,cpm,actions,action_values',
            date_preset: datePreset,
        }, GRAPH_ADS)
        return data.data?.[0] || null
    }

    /** Bật / tạm dừng CHIẾN DỊCH — chiến dịch là công tắc: boostPost tạo nhóm QC + quảng cáo ACTIVE bên trong. */
    async setCampaignStatus(campaignId: string, status: 'ACTIVE' | 'PAUSED'): Promise<{ success: boolean }> {
        await this.post(campaignId, { status }, GRAPH_ADS)
        return { success: true }
    }

    /**
     * Boost 1 bài đã có: tạo campaign → adset → adcreative (object_story_id) → ad, theo thamSoChienDichDayBai /
     * thamSoNhomDayBai. budgetVnd tính theo ngày; VND không có phần lẻ nên truyền nguyên số.
     * Chiến dịch PAUSED (chưa tiêu tiền); nhóm QC + quảng cáo ACTIVE bên trong ⇒ setCampaignStatus(ACTIVE) là chạy thật.
     * (Trước 05/11/2026 cả ba PAUSED nên bật chiến dịch xong quảng cáo vẫn đứng — và gọi bằng v21 đã khai tử.)
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
        const now = Math.floor(Date.now() / 1000)
        // Facebook chỉ nhận ngân sách NGÀY cho nhóm chạy > 24 giờ ⇒ tối thiểu 2 ngày
        const stop = now + Math.max(2, Math.floor(Number(input.days) || 0)) * 86400

        const campaign = await this.post(`${acct}/campaigns`,
            thamSoChienDichDayBai(`Boost ${input.postId} · ${new Date(now * 1000).toISOString().slice(0, 10)}`, input.objective || 'OUTCOME_ENGAGEMENT'), GRAPH_ADS)

        const adset = await this.post(`${acct}/adsets`, thamSoNhomDayBai({
            ten: `AdSet ${input.postId}`, campaignId: campaign.id, pageId: input.pageId, dailyBudgetVnd: input.dailyBudgetVnd,
            batDauGiay: now, ketThucGiay: stop, targeting: input.targeting,
        }), GRAPH_ADS)

        const creative = await this.post(`${acct}/adcreatives`, {
            name: `Creative ${input.postId}`,
            object_story_id: input.postId,
        }, GRAPH_ADS)

        const ad = await this.post(`${acct}/ads`, {
            name: `Ad ${input.postId}`,
            adset_id: adset.id,
            creative: { creative_id: creative.id },
            status: 'ACTIVE',
        }, GRAPH_ADS)

        return { campaignId: campaign.id, adsetId: adset.id, adId: ad.id }
    }
}

export { GRAPH_VERSION, GRAPH, ADS_GRAPH_VERSION, GRAPH_ADS }
