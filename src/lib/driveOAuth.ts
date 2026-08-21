// ═══════════════════════════════════════════════════════════════════════════════
//  KẾT NỐI GOOGLE DRIVE BẰNG TÀI KHOẢN CHỦ SHOP (OAuth)
//
//  VÌ SAO CẦN: file nằm trong My Drive thì Google chỉ cho CHỦ SỞ HỮU xoá. Service
//  account của Cloud Run dù được share quyền Editor vẫn nhận "insufficient
//  permissions" (đo thực tế 04/08/2026: 300/300 lỗi). Muốn app tự dọn video thì
//  phải gọi Drive DƯỚI DANH NGHĨA chính chủ → OAuth, lưu refresh_token per-store.
//
//  ĐỌC vẫn dùng service account (ADC) như cũ: nhẹ, không cần user kết nối. Chỉ
//  thao tác GHI/XOÁ mới cần token của chủ shop.
//
//  LƯU Ý VẬN HÀNH (Google, không phải mình đặt ra):
//   • Scope 'drive' là nhóm RESTRICTED. App chưa được Google xác minh sẽ hiện
//     màn "Google hasn't verified this app" — bấm Advanced → Go to là qua.
//   • Màn hình đồng ý (consent screen) phải ở chế độ PRODUCTION. Để "Testing"
//     thì refresh_token HẾT HẠN SAU 7 NGÀY, tuần nào cũng phải nối lại.
// ═══════════════════════════════════════════════════════════════════════════════

const SCOPES = [
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/userinfo.email',
]

/** Địa chỉ nhận kết quả đăng nhập — phải khai y hệt trong Google Cloud Console. */
export function driveRedirectUri(): string {
    const base = process.env.PUBLIC_API_URL || 'https://api.kengi.vn'
    return `${base.replace(/\/+$/, '')}/api/drive-videos/oauth/callback`
}

export function driveOAuthConfigured(): boolean {
    return !!(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET)
}

function newOAuthClient(): any {
    const { google } = require('googleapis') as typeof import('googleapis')
    return new google.auth.OAuth2(
        process.env.GOOGLE_OAUTH_CLIENT_ID,
        process.env.GOOGLE_OAUTH_CLIENT_SECRET,
        driveRedirectUri(),
    )
}

/**
 * URL đưa chủ shop sang Google để đồng ý.
 * [state] mang mã cửa hàng để callback biết lưu token vào đâu.
 * prompt=consent + access_type=offline: BẮT BUỘC để Google trả refresh_token —
 * thiếu thì lần nối thứ hai trở đi chỉ có access_token 1 tiếng, cron chết ngay.
 */
export function buildDriveAuthUrl(state: string): string {
    const client = newOAuthClient()
    return client.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        include_granted_scopes: true,
        scope: SCOPES,
        state,
    })
}

/** Đổi mã trả về thành refresh_token + email tài khoản vừa kết nối. */
export async function exchangeDriveCode(code: string): Promise<{ refreshToken: string; email: string }> {
    const client = newOAuthClient()
    const { tokens } = await client.getToken(code)
    if (!tokens.refresh_token) {
        throw new Error('Google không trả refresh_token — gỡ quyền cũ ở myaccount.google.com/permissions rồi kết nối lại')
    }
    client.setCredentials(tokens)
    let email = ''
    try {
        const { google } = require('googleapis') as typeof import('googleapis')
        const oauth2 = google.oauth2({ version: 'v2', auth: client })
        const me = await oauth2.userinfo.get()
        email = String(me.data?.email || '')
    } catch { /* thiếu email không chặn kết nối */ }
    return { refreshToken: tokens.refresh_token, email }
}

/** Drive client chạy dưới danh nghĩa chủ shop (dùng cho GHI/XOÁ). */
export function driveClientFromRefreshToken(refreshToken: string): any {
    const { google } = require('googleapis') as typeof import('googleapis')
    const client = newOAuthClient()
    client.setCredentials({ refresh_token: refreshToken })
    return google.drive({ version: 'v3', auth: client })
}

/**
 * Client GHI cho một cửa hàng: ưu tiên tài khoản chủ shop đã kết nối, không có
 * thì rơi về service account (chỉ xoá được file do chính SA sở hữu).
 * Trả kèm nguồn quyền để log/thông báo nói đúng nguyên nhân khi lỗi.
 */
export async function getStoreDriveWriter(storePrisma: any): Promise<{ drive: any; nguon: 'chu-shop' | 'service-account'; email?: string }> {
    let token: string | null = null
    let email: string | undefined
    try {
        const st = await storePrisma.storeSettings.findFirst({
            select: { driveOauthToken: true, driveOauthEmail: true } as any,
        }) as any
        token = st?.driveOauthToken || null
        email = st?.driveOauthEmail || undefined
    } catch { /* cột chưa migrate → dùng SA */ }

    if (token && driveOAuthConfigured()) {
        return { drive: driveClientFromRefreshToken(token), nguon: 'chu-shop', email }
    }
    const { google } = require('googleapis') as typeof import('googleapis')
    const auth = new google.auth.GoogleAuth({ scopes: ['https://www.googleapis.com/auth/drive'] })
    return { drive: google.drive({ version: 'v3', auth }), nguon: 'service-account' }
}
