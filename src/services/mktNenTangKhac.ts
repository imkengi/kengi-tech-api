/**
 * BỘ ĐĂNG INSTAGRAM / THREADS / TIKTOK / YOUTUBE — Marketing Studio, 29/09/2026
 * Chuyển từ `scratch/fanpage-dashboard/marketing/providers.js` (có bộ test riêng ở đó).
 *
 * Mỗi nền tảng đăng NHIỀU NHỊP, và nhịp nào cũng có checkpoint (`moc`) ghi TRƯỚC khi
 * đi tiếp: chết giữa chừng mà không có mốc thì lần chạy sau tạo container/upload THỨ
 * HAI — hai bài giống hệt trên trang khách hàng.
 *
 * "Đang xử lý, hỏi lại sau" được ném dưới dạng LoiNenTang thuLaiDuoc (worker đưa về
 * hàng đợi, GIỮ mốc) — không phải lỗi thật.
 *
 * Mốc là chuỗi có tiền tố để biết đang ở nhịp nào:
 *   Instagram / Threads : <containerId>
 *   TikTok              : "tt-up:<publishId>" (đang tải) → "tt-pub:<publishId>" (chờ duyệt)
 *   YouTube             : "yt-up:<uploadUrl>"            → "yt-vid:<videoId>"
 */
import { Storage } from '@google-cloud/storage'
import { goiNenTang, LoiNenTang } from '../lib/mktLoiNenTang'
import type { NenTang } from './mktDangBai'

const FB = `https://graph.facebook.com/${process.env.FB_GRAPH_VERSION || 'v21.0'}`
const TH = 'https://graph.threads.net/v1.0'
const TT = 'https://open.tiktokapis.com/v2'
const YT = 'https://www.googleapis.com'

const dangXuLy = (nen: string, giay = 30) =>
    new LoiNenTang(`${nen} đang xử lý, chưa xong.`, { code: 'DANG_XU_LY', thuLaiDuoc: true, choGiay: giay })

/* Threads: tài liệu chính thức truyền token ở tham số URL. Không đặt vào header để
 * khỏi phụ thuộc vào việc graph.threads.net có nhận Bearer hay không. Token KHÔNG bao
 * giờ đi vào thông báo lỗi (goiNenTang không in URL). */
const th = (duong: string, token: string) =>
    `${TH}${duong}${duong.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(token)}`

// ─── Đọc bytes media (TikTok FILE_UPLOAD, YouTube) ────────────────────────────
let kho: Storage | null = null
const BUCKET = process.env.PRODUCT_IMAGE_BUCKET || 'kengi-tech-assets'

/** Kích thước + luồng đọc từ byte `tu`. Media ở Cloud Storage đọc thẳng bucket; media
 *  là URL ngoài thì tải về qua HTTP (Range). */
async function nguonMedia(a: any): Promise<{ size: number; doc: (tu: number) => Promise<Buffer> }> {
    if (a?.storagePath) {
        if (!kho) kho = new Storage()
        const f = kho.bucket(BUCKET).file(a.storagePath)
        const [meta] = await f.getMetadata()
        const size = Number(meta.size)
        return {
            size,
            doc: (tu: number) => new Promise((ok, hong) => {
                const phan: Buffer[] = []
                f.createReadStream({ start: tu }).on('data', c => phan.push(c as Buffer)).on('end', () => ok(Buffer.concat(phan))).on('error', hong)
            }),
        }
    }
    if (!a?.url) throw new LoiNenTang('Media không có tệp hay URL để tải.', { code: 'MEDIA_THIEU' })
    const dau = await fetch(a.url, { method: 'HEAD', redirect: 'follow' } as any)
    const size = Number(dau.headers.get('content-length') || 0)
    if (!size) throw new LoiNenTang('Không đọc được kích thước video từ URL. Hãy tải video lên thư viện.', { code: 'MEDIA_THIEU' })
    return {
        size,
        doc: async (tu: number) => {
            const r = await fetch(a.url, { headers: tu ? { Range: `bytes=${tu}-` } : {}, redirect: 'follow' } as any)
            if (!r.ok) throw new LoiNenTang(`Tải video từ URL hỏng (${r.status}).`, { code: 'MEDIA_THIEU', thuLaiDuoc: true })
            return Buffer.from(await r.arrayBuffer())
        },
    }
}

// ─── INSTAGRAM ───────────────────────────────────────────────────────────────
export const nenTangInstagram: NenTang = {
    async dang(tk, token, bai, moc, luuMoc) {
        const a = bai.assets[0]
        if (!moc) {
            if (!a?.url) throw new LoiNenTang('Instagram cần một ảnh JPEG hoặc một video có URL công khai.', { code: 'MEDIA_THIEU' })
            const d = await goiNenTang(`${FB}/${tk.externalId}/media`, token, {
                method: 'POST',
                body: {
                    caption: bai.body,
                    ...(a.type === 'video'
                        ? { media_type: 'REELS', video_url: a.url, share_to_feed: true }
                        : { image_url: a.url }),
                },
            })
            if (!d?.id) throw new LoiNenTang('Instagram không trả về media container.', { code: 'KHONG_CO_ID', moHo: true })
            await luuMoc(String(d.id))
            throw dangXuLy('Instagram', 20)
        }
        const d = await goiNenTang(`${FB}/${moc}?fields=status_code,status`, token)
        if (['ERROR', 'EXPIRED'].includes(d?.status_code))
            throw new LoiNenTang('Instagram không xử lý được media hoặc container đã hết hạn.', { code: 'MEDIA_FAILED' })
        if (d?.status_code === 'PUBLISHED')
            throw new LoiNenTang('Container đã được đăng. Cần đối soát ID bài trên Instagram.', { code: 'RECONCILE_REQUIRED', moHo: true })
        if (d?.status_code !== 'FINISHED') throw dangXuLy('Instagram')
        const p = await goiNenTang(`${FB}/${tk.externalId}/media_publish`, token, { method: 'POST', body: { creation_id: moc } })
        if (!p?.id) throw new LoiNenTang('Instagram không trả về ID bài.', { code: 'KHONG_CO_ID', moHo: true })
        return { remotePostId: String(p.id), remoteRef: moc }
    },
}

// ─── THREADS ─────────────────────────────────────────────────────────────────
export const nenTangThreads: NenTang = {
    async dang(tk, token, bai, moc, luuMoc) {
        const a = bai.assets[0]
        if (!moc) {
            const d = await goiNenTang(th(`/${tk.externalId}/threads`, token), null, {
                method: 'POST',
                body: {
                    text: bai.body,
                    ...(a?.type === 'video' ? { media_type: 'VIDEO', video_url: a.url }
                        : a ? { media_type: 'IMAGE', image_url: a.url }
                            : { media_type: 'TEXT' }),
                },
            })
            if (!d?.id) throw new LoiNenTang('Threads không trả về media container.', { code: 'KHONG_CO_ID', moHo: true })
            await luuMoc(String(d.id))
            throw dangXuLy('Threads', 15)
        }
        const d = await goiNenTang(th(`/${moc}?fields=status,error_message`, token), null)
        if (['ERROR', 'EXPIRED'].includes(d?.status))
            throw new LoiNenTang('Threads không xử lý được nội dung hoặc container đã hết hạn.', { code: 'MEDIA_FAILED' })
        if (d?.status === 'PUBLISHED')
            throw new LoiNenTang('Container đã được đăng. Cần đối soát ID bài trên Threads.', { code: 'RECONCILE_REQUIRED', moHo: true })
        if (d?.status !== 'FINISHED') throw dangXuLy('Threads')
        const p = await goiNenTang(th(`/${tk.externalId}/threads_publish`, token), null, { method: 'POST', body: { creation_id: moc } })
        if (!p?.id) throw new LoiNenTang('Threads không trả về ID bài.', { code: 'KHONG_CO_ID', moHo: true })
        return { remotePostId: String(p.id), remoteRef: moc }
    },
}

// ─── TIKTOK (Direct Post, FILE_UPLOAD) ───────────────────────────────────────
/* FILE_UPLOAD chứ không PULL_FROM_URL: PULL_FROM_URL bắt tên miền chứa video phải xác
 * minh với TikTok, mà storage.googleapis.com thì mình không xác minh được. */
const KHUC = 10 * 1024 * 1024

async function thongTinNhaSangTao(token: string) {
    const d = await goiNenTang(`${TT}/post/publish/creator_info/query/`, token, { method: 'POST', body: {}, chiDoc: true })
    return d?.data || {}
}

export const nenTangTiktok: NenTang = {
    async dang(_tk, token, bai, moc, luuMoc) {
        const o = bai.options || {}
        if (moc?.startsWith('tt-pub:')) {
            const id = moc.slice(7)
            const d = await goiNenTang(`${TT}/post/publish/status/fetch/`, token, { method: 'POST', body: { publish_id: id }, chiDoc: true })
            const tt = d?.data?.status
            if (tt === 'FAILED')
                throw new LoiNenTang(`TikTok xử lý video thất bại: ${d?.data?.fail_reason || 'không rõ lý do'}.`, { code: 'TIKTOK_PROCESSING_FAILED' })
            if (tt !== 'PUBLISH_COMPLETE') throw dangXuLy('TikTok', 30)
            /* publish_id KHÁC id bài công khai (có khi mãi sau mới có). Lẫn hai cái là
             * link tới bài không tồn tại. */
            const congKhai = d?.data?.publicaly_available_post_id?.[0]
            return { remotePostId: congKhai ? String(congKhai) : `publish:${id}`, remoteRef: moc }
        }

        const video = bai.assets[0]
        if (!video || video.type !== 'video') throw new LoiNenTang('TikTok cần đúng một video.', { code: 'MEDIA_THIEU' })
        const nguon = await nguonMedia(video)
        const soKhuc = nguon.size <= KHUC ? 1 : Math.floor(nguon.size / KHUC)
        const coKhuc = soKhuc === 1 ? nguon.size : KHUC

        let publishId: string, uploadUrl: string
        if (moc?.startsWith('tt-up:')) {
            ;[publishId, uploadUrl] = moc.slice(6).split('|')
        } else {
            const nst = await thongTinNhaSangTao(token)
            if (!(nst.privacy_level_options || []).includes(o.privacy))
                throw new LoiNenTang('Quyền riêng tư đã chọn không được tài khoản TikTok này cho phép.', { code: 'TIKTOK_PRIVACY' })
            const d = await goiNenTang(`${TT}/post/publish/video/init/`, token, {
                method: 'POST',
                body: {
                    post_info: {
                        title: bai.body,
                        privacy_level: o.privacy,
                        disable_comment: !!(nst.comment_disabled || o.disableComment),
                        disable_duet: !!(nst.duet_disabled || o.disableDuet),
                        disable_stitch: !!(nst.stitch_disabled || o.disableStitch),
                        brand_content_toggle: !!o.brandedContent,
                        brand_organic_toggle: !!o.ownBrand,
                        is_aigc: !!o.aiGenerated,
                    },
                    source_info: { source: 'FILE_UPLOAD', video_size: nguon.size, chunk_size: coKhuc, total_chunk_count: soKhuc },
                },
            })
            publishId = d?.data?.publish_id
            uploadUrl = d?.data?.upload_url
            if (!publishId || !uploadUrl) throw new LoiNenTang('TikTok không trả về publish_id/upload_url.', { code: 'KHONG_CO_ID', moHo: true })
            await luuMoc(`tt-up:${publishId}|${uploadUrl}`)
        }

        /* Tải TOÀN BỘ các khúc vào đúng upload_url đã cấp. Hỏng giữa chừng thì lần sau
         * tải lại cùng url (PUT theo Content-Range là ghi đè đúng đoạn đó) — KHÔNG gọi
         * init lần hai, vì như thế là hai bài. */
        const tatCa = await nguon.doc(0)
        for (let i = 0; i < soKhuc; i++) {
            const tu = i * coKhuc
            const den = i === soKhuc - 1 ? nguon.size - 1 : tu + coKhuc - 1
            const r = await goiNenTang(uploadUrl, null, {
                method: 'PUT',
                body: tatCa.subarray(tu, den + 1),
                headers: { 'Content-Type': 'video/mp4', 'Content-Range': `bytes ${tu}-${den}/${nguon.size}` },
                tho: true, chiDoc: true, timeoutMs: 10 * 60_000,
            })
            if (!r.ok && r.status !== 206 && r.status !== 201)
                throw new LoiNenTang(`TikTok từ chối khúc video (${r.status}).`, { code: 'TIKTOK_UPLOAD', thuLaiDuoc: true })
        }
        await luuMoc(`tt-pub:${publishId}`)
        throw dangXuLy('TikTok', 30)
    },
}

// ─── YOUTUBE (resumable upload) ──────────────────────────────────────────────
export const nenTangYoutube: NenTang = {
    async dang(_tk, token, bai, moc, luuMoc) {
        if (moc?.startsWith('yt-vid:')) {
            const id = moc.slice(7)
            const d = await goiNenTang(`${YT}/youtube/v3/videos?part=status&id=${encodeURIComponent(id)}`, token)
            const st = d?.items?.[0]?.status
            if (!st) throw dangXuLy('YouTube', 60)
            if (['failed', 'rejected', 'deleted'].includes(st.uploadStatus))
                throw new LoiNenTang('YouTube từ chối hoặc xử lý video thất bại.', { code: 'YOUTUBE_PROCESSING_FAILED' })
            if (st.uploadStatus !== 'processed') throw dangXuLy('YouTube', 60)
            return { remotePostId: id, remoteRef: moc }
        }
        const o = bai.options || {}
        const video = bai.assets[0]
        if (!video || video.type !== 'video') throw new LoiNenTang('YouTube cần đúng một video.', { code: 'MEDIA_THIEU' })
        const nguon = await nguonMedia(video)

        let uploadUrl = moc?.startsWith('yt-up:') ? moc.slice(6) : ''
        if (!uploadUrl) {
            const r = await goiNenTang(`${YT}/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status`, token, {
                method: 'POST',
                body: {
                    snippet: { title: bai.title || bai.body.slice(0, 90), description: bai.body },
                    status: {
                        privacyStatus: o.privacy,
                        selfDeclaredMadeForKids: o.madeForKids === true,
                        containsSyntheticMedia: !!o.aiGenerated,
                    },
                },
                headers: { 'X-Upload-Content-Type': video.mime || 'video/mp4', 'X-Upload-Content-Length': String(nguon.size) },
                tho: true,
            })
            uploadUrl = r.headers.get('location') || ''
            const u = uploadUrl ? new URL(uploadUrl) : null
            if (!u || u.origin !== YT || !u.pathname.startsWith('/upload/youtube/'))
                throw new LoiNenTang('YouTube không trả về địa chỉ tải lên hợp lệ.', { code: 'KHONG_CO_ID', moHo: true })
            await luuMoc(`yt-up:${uploadUrl}`)
        }

        /* Hỏi YouTube đã nhận tới byte nào rồi tải tiếp TỪ ĐÓ (không tải lại từ đầu). */
        const hoi = await goiNenTang(uploadUrl, token, {
            method: 'PUT', headers: { 'Content-Length': '0', 'Content-Range': `bytes */${nguon.size}` }, tho: true, chiDoc: true,
        })
        let ketQua: any = null
        if (hoi.status === 308) {
            const tu = Number(/-(\d+)$/.exec(hoi.headers.get('range') || '')?.[1] ?? -1) + 1
            const phan = await nguon.doc(tu)
            const r = await goiNenTang(uploadUrl, token, {
                method: 'PUT', body: phan,
                headers: { 'Content-Type': video.mime || 'video/mp4', 'Content-Range': `bytes ${tu}-${nguon.size - 1}/${nguon.size}` },
                tho: true, timeoutMs: 10 * 60_000,
            })
            if (r.status === 308) throw dangXuLy('YouTube (đang tải)', 30)
            ketQua = await r.json()
        } else {
            ketQua = await hoi.json()
        }
        if (!ketQua?.id) throw new LoiNenTang('YouTube không trả về video ID.', { code: 'KHONG_CO_ID', moHo: true })
        await luuMoc(`yt-vid:${ketQua.id}`)
        throw dangXuLy('YouTube', 60)
    },
}

// ─── XÁC MINH TOKEN khi nối kênh ─────────────────────────────────────────────
export interface KenhXacMinh {
    externalId: string
    name: string
    avatar?: string | null
    followers?: number | null
    category?: string | null
    /** Hạn token nếu nền tảng cho biết; không biết thì để trống (giao diện hỏi người dùng). */
    hetHan?: Date | null
    thongTin?: any
}

/**
 * Hỏi THẲNG nền tảng token này của ai, còn sống không. `externalId` người dùng khai
 * (nếu có) phải KHỚP — không thì từ chối, vì nối nhầm kênh là đăng bài lên trang người khác.
 */
export async function xacMinhKenh(platform: string, token: string, externalId?: string): Promise<KenhXacMinh> {
    const khop = (id: string) => {
        if (externalId && externalId !== id)
            throw new LoiNenTang(`Token này thuộc tài khoản ${id}, không phải ${externalId}.`, { code: 'SAI_TAI_KHOAN' })
    }
    if (platform === 'facebook') {
        const d = await goiNenTang(`${FB}/me?fields=id,name,category,fan_count,picture{url}`, token, { chiDoc: true })
        khop(String(d.id))
        return { externalId: String(d.id), name: d.name, category: d.category ?? null, avatar: d?.picture?.data?.url ?? null, followers: d.fan_count ?? null }
    }
    if (platform === 'instagram') {
        /* Có ID thì hỏi thẳng; không có thì tự tìm tài khoản IG gắn với Page của token. */
        let id = externalId
        if (!id) {
            const p = await goiNenTang(`${FB}/me?fields=instagram_business_account{id}`, token, { chiDoc: true })
            id = p?.instagram_business_account?.id
            if (!id) throw new LoiNenTang('Page của token này chưa gắn tài khoản Instagram Business/Creator. Nhập Instagram ID.', { code: 'THIEU_IG' })
        }
        const d = await goiNenTang(`${FB}/${id}?fields=id,username,followers_count,profile_picture_url`, token, { chiDoc: true })
        khop(String(d.id))
        return { externalId: String(d.id), name: d.username, avatar: d.profile_picture_url ?? null, followers: d.followers_count ?? null }
    }
    if (platform === 'threads') {
        const d = await goiNenTang(th('/me?fields=id,username,threads_profile_picture_url', token), null, { chiDoc: true })
        khop(String(d.id))
        return { externalId: String(d.id), name: d.username, avatar: d.threads_profile_picture_url ?? null }
    }
    if (platform === 'tiktok') {
        const d = await goiNenTang(`${TT}/user/info/?fields=open_id,display_name,avatar_url,follower_count`, token, { chiDoc: true })
        const u = d?.data?.user
        if (!u?.open_id) throw new LoiNenTang('TikTok không trả về open_id.', { code: 'KHONG_CO_ID' })
        khop(String(u.open_id))
        const nst = await thongTinNhaSangTao(token)
        return { externalId: String(u.open_id), name: u.display_name, avatar: u.avatar_url ?? null, followers: u.follower_count ?? null, thongTin: { creator: nst } }
    }
    if (platform === 'youtube') {
        const d = await goiNenTang(`${YT}/youtube/v3/channels?part=snippet,statistics&mine=true`, token, { chiDoc: true })
        const ds: any[] = d?.items || []
        const c = externalId ? ds.find(x => x.id === externalId) : ds[0]
        if (!c) throw new LoiNenTang(externalId ? 'Token không quản lý kênh YouTube này.' : 'Token không quản lý kênh YouTube nào.', { code: 'SAI_TAI_KHOAN' })
        return { externalId: c.id, name: c.snippet?.title, avatar: c.snippet?.thumbnails?.default?.url ?? null, followers: c.statistics?.hiddenSubscriberCount ? null : Number(c.statistics?.subscriberCount ?? NaN) || null }
    }
    throw new LoiNenTang(`Nền tảng ${platform} chưa được hỗ trợ.`, { code: 'CHUA_HO_TRO' })
}

// ─── GIA HẠN TOKEN ───────────────────────────────────────────────────────────
/** Còn bao lâu thì gia hạn. Threads chỉ gia hạn được token CÒN HẠN nên phải làm sớm. */
export const GIA_HAN_TRUOC_MS: Record<string, number> = { threads: 7 * 86400_000, youtube: 5 * 60_000, tiktok: 30 * 60_000 }

export async function giaHanToken(platform: string, token: string, bi?: { refreshToken?: string; clientId?: string; clientSecret?: string } | null)
    : Promise<{ accessToken: string; hetHan: Date; refreshToken?: string }> {
    if (platform === 'threads') {
        const d = await goiNenTang(`https://graph.threads.net/refresh_access_token?grant_type=th_refresh_token&access_token=${encodeURIComponent(token)}`, null, { chiDoc: true })
        if (!d?.access_token) throw new LoiNenTang('Không gia hạn được token Threads.', { code: 'GIA_HAN_HONG' })
        return { accessToken: d.access_token, hetHan: new Date(Date.now() + Number(d.expires_in || 5184000) * 1000) }
    }
    if (!bi?.refreshToken || !bi.clientId || !bi.clientSecret)
        throw new LoiNenTang('Token hết hạn và chưa có thông tin làm mới. Nối lại kênh.', { code: 'THIEU_LAM_MOI' })
    const d = platform === 'youtube'
        ? await goiNenTang('https://oauth2.googleapis.com/token', null, {
            method: 'POST', chiDoc: true,
            body: new URLSearchParams({ client_id: bi.clientId, client_secret: bi.clientSecret, refresh_token: bi.refreshToken, grant_type: 'refresh_token' }),
        })
        : await goiNenTang(`${TT}/oauth/token/`, null, {
            method: 'POST', chiDoc: true,
            body: new URLSearchParams({ client_key: bi.clientId, client_secret: bi.clientSecret, refresh_token: bi.refreshToken, grant_type: 'refresh_token' }),
        })
    if (!d?.access_token) throw new LoiNenTang('Không làm mới được token.', { code: 'GIA_HAN_HONG' })
    return { accessToken: d.access_token, refreshToken: d.refresh_token, hetHan: new Date(Date.now() + Number(d.expires_in || 3600) * 1000) }
}

// ─── SỐ LIỆU ─────────────────────────────────────────────────────────────────
const so = (v: any) => (v !== undefined && v !== null && Number.isFinite(Number(v)) ? Number(v) : null)

/** Số liệu MỘT bài. Nền tảng không trả số nào thì để null — KHÔNG ghi 0. */
export async function layChiSo(platform: string, token: string, remotePostId: string)
    : Promise<{ views: number | null; likes: number | null; comments: number | null; shares: number | null }> {
    const rong = { views: null, likes: null, comments: null, shares: null }
    if (platform === 'facebook') {
        const d = await goiNenTang(`${FB}/${remotePostId}?fields=reactions.limit(0).summary(true),comments.limit(0).summary(true),shares`, token)
        return { ...rong, likes: so(d?.reactions?.summary?.total_count), comments: so(d?.comments?.summary?.total_count), shares: so(d?.shares?.count) }
    }
    if (platform === 'instagram') {
        const d = await goiNenTang(`${FB}/${remotePostId}?fields=like_count,comments_count`, token)
        return { ...rong, likes: so(d?.like_count), comments: so(d?.comments_count) }
    }
    if (platform === 'threads') {
        // 6 chỉ số media hợp lệ theo tài liệu Threads Insights (30/09/2026)
        const d = await goiNenTang(th(`/${remotePostId}/insights?metric=views,likes,replies,reposts,quotes,shares`, token), null)
        const lay = (ten: string) => {
            const m = (d?.data || []).find((x: any) => x.name === ten)
            return so(m?.values?.[0]?.value ?? m?.total_value?.value)
        }
        /* "Chia sẻ" = repost + quote + share ra ngoài — cả ba đều là đưa bài tới người khác.
         * Cả ba null thì null (chưa đọc được), không phải 0. */
        const lan = [lay('reposts'), lay('quotes'), lay('shares')]
        return {
            views: lay('views'), likes: lay('likes'), comments: lay('replies'),
            shares: lan.every(x => x === null) ? null : lan.reduce((a: number, x) => a + (x || 0), 0),
        }
    }
    if (platform === 'tiktok') {
        if (remotePostId.startsWith('publish:')) return rong   // chưa có id công khai
        const d = await goiNenTang(`${TT}/video/query/?fields=id,view_count,like_count,comment_count,share_count`, token, {
            method: 'POST', body: { filters: { video_ids: [remotePostId] } }, chiDoc: true,
        })
        const v = d?.data?.videos?.[0]
        return v ? { views: so(v.view_count), likes: so(v.like_count), comments: so(v.comment_count), shares: so(v.share_count) } : rong
    }
    if (platform === 'youtube') {
        const d = await goiNenTang(`${YT}/youtube/v3/videos?part=statistics&id=${encodeURIComponent(remotePostId)}`, token)
        const s = d?.items?.[0]?.statistics
        return s ? { ...rong, views: so(s.viewCount), likes: so(s.likeCount), comments: so(s.commentCount) } : rong
    }
    return rong
}

// ─── KIỂM ĐỊNH DẠNG theo nền tảng (trước khi lên lịch) ────────────────────────
const TRAN_CHU: Record<string, number> = { facebook: 63206, instagram: 2200, threads: 500, tiktok: 2200, youtube: 5000 }

/** Lỗi định dạng của MỘT phiên bản trên MỘT nền tảng. Mảng rỗng = đăng được. */
export function kiemDinhDang(platform: string, pb: { text: string; title?: string; options?: any }, assets: any[]): string[] {
    const loi: string[] = []
    const chu = pb.text || ''
    const o = pb.options || {}
    if (chu.length > (TRAN_CHU[platform] ?? 63206)) loi.push(`Nội dung quá ${TRAN_CHU[platform]} ký tự.`)
    if (!chu.trim() && !assets.length) loi.push('Bài cần nội dung hoặc media.')
    if (assets.length > 1) loi.push('Mỗi phiên bản chỉ dùng một ảnh hoặc một video.')
    const a = assets[0]
    if (['instagram', 'threads', 'facebook'].includes(platform) && a && !a.url) loi.push('Media chưa có URL công khai.')
    if (platform === 'instagram') {
        if (!a) loi.push('Instagram cần một ảnh hoặc một video Reel.')
        if (a?.type === 'image' && a.mime && a.mime !== 'image/jpeg') loi.push('Instagram chỉ nhận ảnh JPEG.')
    }
    if (['tiktok', 'youtube'].includes(platform) && a?.type !== 'video') loi.push('Cần đúng một video.')
    if (platform === 'tiktok') {
        if (!['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'FOLLOWER_OF_CREATOR', 'SELF_ONLY'].includes(o.privacy))
            loi.push('Chọn quyền riêng tư TikTok.')
        if (o.tiktokConsent !== true) loi.push('Chủ kênh phải xác nhận đồng ý đăng và quyền dùng nhạc trên TikTok.')
    }
    if (platform === 'youtube') {
        if (!(pb.title || '').trim()) loi.push('YouTube cần tiêu đề video.')
        if (!['public', 'unlisted', 'private'].includes(o.privacy)) loi.push('Chọn quyền riêng tư YouTube.')
        if (typeof o.madeForKids !== 'boolean') loi.push('Chọn video có dành cho trẻ em hay không.')
        if (/[<>]/.test((pb.title || '') + chu)) loi.push('YouTube không cho phép ký tự < hoặc >.')
    }
    return loi
}
