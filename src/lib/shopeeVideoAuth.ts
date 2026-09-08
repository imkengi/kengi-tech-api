// ═══════════════════════════════════════════════════════════════════════════════
//  TOKEN SHOPEE VIDEO (cấp người dùng) — lấy ra dùng, tự làm mới khi sắp hết hạn
//
//  Vì sao tách khỏi token bán hàng: mọi API v2.video.* ký bằng user_id, còn token
//  bán hàng ký bằng shop_id. Hai bộ token, hai vòng đời (video: 4 giờ, refresh 30
//  ngày). Trộn chung là gọi API nào cũng "invalid_access_token".
//
//  ⚠ refresh_token dùng ĐÚNG MỘT LẦN cho mỗi user_id. Làm mới xong mà không lưu
//  cái mới thì lần sau Shopee từ chối, phải uỷ quyền lại từ đầu. Nên ở đây làm mới
//  và ghi DB trong cùng một hàm, không tách.
// ═══════════════════════════════════════════════════════════════════════════════

import { getPlatformService } from '../services/platforms'

export interface TokenVideoShopee {
    svc: any
    accessToken: string
    userId: string
    channel: any
}

/** Biên an toàn: token 4 giờ, làm mới sớm 5 phút để không chết giữa lượt tải. */
const BIEN_LAM_MOI_MS = 5 * 60_000

export async function layTokenVideoShopee(prisma: any, channelId: string): Promise<TokenVideoShopee> {
    const ch = await prisma.onlineChannel.findUnique({ where: { id: channelId } })
    if (!ch) throw new Error('Kênh không tồn tại')
    if (ch.platform !== 'shopee') throw new Error('Chỉ kênh Shopee có API video')
    if (!ch.videoUserId || !ch.videoRefreshToken) {
        throw new Error('Kênh chưa uỷ quyền Shopee Video — vào tab Media, bấm "Uỷ quyền Shopee Video" và đăng nhập bằng tài khoản chủ shop.')
    }

    const svc: any = getPlatformService('shopee', {
        apiKey: ch.apiKey || '', apiSecret: ch.apiSecret || '', shopId: ch.shopId || undefined,
    })

    const conHan = ch.videoTokenExpiresAt
        && new Date(ch.videoTokenExpiresAt).getTime() - Date.now() > BIEN_LAM_MOI_MS
    if (conHan && ch.videoAccessToken) {
        return { svc, accessToken: ch.videoAccessToken, userId: String(ch.videoUserId), channel: ch }
    }

    const t = await svc.refreshVideoToken(String(ch.videoRefreshToken), String(ch.videoUserId))
    await prisma.onlineChannel.update({
        where: { id: ch.id },
        data: {
            videoAccessToken: t.accessToken,
            videoRefreshToken: t.refreshToken,
            videoTokenExpiresAt: new Date(Date.now() + t.expiresIn * 1000),
            // videoAuthAt nhích theo lần làm mới: refresh_token mới cũng sống 30 ngày từ giờ
            videoAuthAt: new Date(),
        } as any,
    })
    return { svc, accessToken: t.accessToken, userId: String(ch.videoUserId), channel: ch }
}
