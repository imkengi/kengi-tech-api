// ═══════════════════════════════════════════════════════════════════════════════
//  ĐĂNG VIDEO LÊN TIKTOK — Content Posting API của developers.tiktok.com
//
//  ⚠ KHÔNG PHẢI TikTok Shop. Đây là nền tảng khác hẳn:
//    · host  open.tiktokapis.com (Shop dùng open-api.tiktokglobalshop.com)
//    · app   đăng ký ở developers.tiktok.com, có client_key/client_secret riêng
//    · token gắn với MỘT TÀI KHOẢN TIKTOK (open_id), không phải một gian hàng
//    · KHÔNG gắn được link sản phẩm — video mua sắm là việc của Affiliate Creator
//      bên Shop, mà đo 09/09/2026 thì app bán hàng KHÔNG được cấp creator.video.write.
//
//  HAI CHẾ ĐỘ (tài liệu đọc 09/09/2026):
//    · video.upload  → POST /v2/post/publish/inbox/video/init/
//                      Video rơi vào HỘP THƯ TikTok dạng nháp; chủ tài khoản phải
//                      mở app, bấm thông báo rồi tự hoàn tất. KHÔNG cần audit.
//    · video.publish → POST /v2/post/publish/video/init/  (đăng thẳng)
//                      Phải bật "Direct Post" trong app VÀ ⚠ "All content posted by
//                      unaudited clients will be restricted to private viewing mode"
//                      — chưa qua audit thì đăng ra chỉ mình chủ tài khoản thấy.
//
//  Nguồn video: FILE_UPLOAD (chia khối, header Content-Range) hoặc PULL_FROM_URL
//  từ MIỀN ĐÃ XÁC MINH. kengi.vn đã xác minh 09/09/2026 bằng bản ghi TXT, nên
//  PULL_FROM_URL là đường gọn nhất: TikTok tự kéo, byte KHÔNG đi qua Cloud Run
//  (trần 32MB) cũng không qua tường lửa Tino (chặn mọi tệp đính kèm).
// ═══════════════════════════════════════════════════════════════════════════════

const TT_AUTH = 'https://www.tiktok.com/v2/auth/authorize/'
const TT_API = 'https://open.tiktokapis.com'

/** Quyền xin khi uỷ quyền. `video.publish` chỉ thêm khi chủ shop bật đăng thẳng. */
export function scopeCanXin(dangThang: boolean): string {
    return dangThang
        ? 'user.info.basic,video.upload,video.publish'
        : 'user.info.basic,video.upload'
}

export interface CaiDatTikTok {
    ttPostClientKey?: string | null
    ttPostClientSecret?: string | null
    ttPostOpenId?: string | null
    ttPostAccessToken?: string | null
    ttPostRefreshToken?: string | null
    ttPostExpiresAt?: Date | null
    ttPostScopes?: string | null
}

/** Lỗi có chủ ý gửi tới chủ shop — nói rõ thiếu gì, đừng để thành "lỗi hệ thống". */
export function credTikTok(cai: CaiDatTikTok | null): { key: string; secret: string } {
    const key = String(cai?.ttPostClientKey || '').trim()
    const secret = String(cai?.ttPostClientSecret || '').trim()
    if (!key || !secret) {
        throw new Error('Chưa khai Client key / Client secret của ứng dụng TikTok — nhập ở tab Media, ô TikTok, rồi mới kết nối được.')
    }
    return { key, secret }
}

/** Link đưa chủ tài khoản sang TikTok bấm đồng ý. `state` BẮT BUỘC, chống giả mạo. */
export function linkUyQuyen(clientKey: string, redirectUri: string, state: string, dangThang: boolean): string {
    const p = new URLSearchParams({
        client_key: clientKey,
        scope: scopeCanXin(dangThang),
        response_type: 'code',
        redirect_uri: redirectUri,
        state,
    })
    return `${TT_AUTH}?${p}`
}

async function goiToken(body: Record<string, string>): Promise<any> {
    const r = await fetch(`${TT_API}/v2/oauth/token/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cache-Control': 'no-cache' },
        body: new URLSearchParams(body).toString(),
    })
    const text = await r.text()
    let j: any = null
    try { j = JSON.parse(text) } catch { throw new Error(`TikTok trả về không phải JSON (HTTP ${r.status}): ${text.slice(0, 200)}`) }
    // TikTok để lỗi ở `error` + `error_description` chứ không phải mã HTTP
    if (j?.error) throw new Error(`TikTok: ${j.error}${j.error_description ? ' — ' + j.error_description : ''}`)
    return j
}

export async function doiMaLayToken(clientKey: string, clientSecret: string, code: string, redirectUri: string) {
    const j = await goiToken({
        client_key: clientKey, client_secret: clientSecret,
        code, grant_type: 'authorization_code', redirect_uri: redirectUri,
    })
    return {
        openId: String(j.open_id || ''),
        accessToken: String(j.access_token || ''),
        refreshToken: String(j.refresh_token || ''),
        expiresIn: Number(j.expires_in) || 86400,
        scopes: String(j.scope || ''),
    }
}

export async function lamMoiToken(clientKey: string, clientSecret: string, refreshToken: string) {
    const j = await goiToken({
        client_key: clientKey, client_secret: clientSecret,
        grant_type: 'refresh_token', refresh_token: refreshToken,
    })
    return {
        accessToken: String(j.access_token || ''),
        refreshToken: String(j.refresh_token || refreshToken),
        expiresIn: Number(j.expires_in) || 86400,
        scopes: String(j.scope || ''),
    }
}

/**
 * Access token còn hạn thì dùng, sắp hết thì làm mới VÀ GHI LẠI ngay.
 * Không ghi lại là lần sau lấy refresh_token cũ — TikTok xoay refresh_token mỗi
 * lần làm mới nên cái cũ chết, đúng bẫy đã ghi ở Shopee Video.
 */
export async function layTokenTikTok(prisma: any): Promise<{ accessToken: string; openId: string; scopes: string }> {
    const cai = await prisma.storeSettings.findFirst()
    const { key, secret } = credTikTok(cai)
    if (!cai?.ttPostRefreshToken || !cai?.ttPostOpenId) {
        throw new Error('Chưa kết nối tài khoản TikTok — bấm "Kết nối TikTok" ở tab Media.')
    }
    const conHan = cai.ttPostExpiresAt && new Date(cai.ttPostExpiresAt).getTime() - Date.now() > 5 * 60_000
    if (conHan && cai.ttPostAccessToken) {
        return { accessToken: cai.ttPostAccessToken, openId: cai.ttPostOpenId, scopes: cai.ttPostScopes || '' }
    }
    const t = await lamMoiToken(key, secret, cai.ttPostRefreshToken)
    await prisma.storeSettings.update({
        where: { id: cai.id },
        data: {
            ttPostAccessToken: t.accessToken,
            ttPostRefreshToken: t.refreshToken,
            ttPostExpiresAt: new Date(Date.now() + t.expiresIn * 1000),
            ttPostScopes: t.scopes || cai.ttPostScopes,
        } as any,
    })
    return { accessToken: t.accessToken, openId: cai.ttPostOpenId, scopes: t.scopes || cai.ttPostScopes || '' }
}

/** Hồ sơ người đăng + giới hạn do TikTok trả về (dùng cho màn hình trước khi đăng). */
export async function layHoSoNguoiDang(accessToken: string): Promise<any> {
    const r = await fetch(`${TT_API}/v2/post/publish/creator_info/query/`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json; charset=UTF-8' },
    })
    const j: any = await r.json().catch(() => null)
    if (j?.error?.code && j.error.code !== 'ok') {
        throw new Error(`creator_info: ${j.error.code} — ${j.error.message || ''}`)
    }
    return j?.data || {}
}

export interface KetQuaMoPhien { publishId: string; uploadUrl?: string | null }

/**
 * Mở phiên đăng. `dangThang=false` → vào hộp thư (video.upload);
 * `true` → đăng thẳng lên hồ sơ (video.publish, cần audit mới công khai).
 * `videoUrl` có thì dùng PULL_FROM_URL (miền phải đã xác minh), không thì FILE_UPLOAD.
 */
export async function moPhienDang(
    accessToken: string,
    opts: {
        dangThang: boolean
        videoUrl?: string | null
        fileSize?: number
        chunkSize?: number
        title?: string
        privacyLevel?: string
        disableComment?: boolean
        disableDuet?: boolean
        disableStitch?: boolean
    },
): Promise<KetQuaMoPhien> {
    const duong = opts.dangThang
        ? '/v2/post/publish/video/init/'
        : '/v2/post/publish/inbox/video/init/'

    const sourceInfo: any = opts.videoUrl
        ? { source: 'PULL_FROM_URL', video_url: opts.videoUrl }
        : {
            source: 'FILE_UPLOAD',
            video_size: opts.fileSize,
            chunk_size: opts.chunkSize ?? opts.fileSize,
            total_chunk_count: Math.max(1, Math.ceil((opts.fileSize || 1) / (opts.chunkSize || opts.fileSize || 1))),
        }

    const body: any = { source_info: sourceInfo }
    if (opts.dangThang) {
        // post_info CHỈ hợp lệ ở đường đăng thẳng; gửi kèm ở đường hộp thư là lỗi tham số.
        body.post_info = {
            title: String(opts.title || '').slice(0, 2200),
            privacy_level: opts.privacyLevel || 'SELF_ONLY',
            disable_comment: !!opts.disableComment,
            disable_duet: !!opts.disableDuet,
            disable_stitch: !!opts.disableStitch,
        }
    }

    const r = await fetch(`${TT_API}${duong}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json; charset=UTF-8' },
        body: JSON.stringify(body),
    })
    const text = await r.text()
    let j: any = null
    try { j = JSON.parse(text) } catch { throw new Error(`TikTok trả về không phải JSON (HTTP ${r.status}): ${text.slice(0, 200)}`) }
    if (j?.error?.code && j.error.code !== 'ok') {
        throw new Error(`${opts.dangThang ? 'publish' : 'inbox'}/init: ${j.error.code} — ${j.error.message || ''}`)
    }
    return { publishId: String(j?.data?.publish_id || ''), uploadUrl: j?.data?.upload_url || null }
}

/** Trạng thái phiên đăng — TikTok xử lý bất đồng bộ, phải hỏi lại. */
export async function trangThaiDang(accessToken: string, publishId: string): Promise<any> {
    const r = await fetch(`${TT_API}/v2/post/publish/status/fetch/`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json; charset=UTF-8' },
        body: JSON.stringify({ publish_id: publishId }),
    })
    const j: any = await r.json().catch(() => null)
    if (j?.error?.code && j.error.code !== 'ok') {
        throw new Error(`status/fetch: ${j.error.code} — ${j.error.message || ''}`)
    }
    return j?.data || {}
}
