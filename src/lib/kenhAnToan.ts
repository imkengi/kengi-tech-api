/**
 * KÊNH BÁN RA TRÌNH DUYỆT — chỉ cột công khai, bí mật thay bằng cờ "có/không".
 *
 * Trước 20/10/2026 `GET /online-orders/channels` (và mọi đường trả đơn sàn kèm
 * `include: { channel: true }`) gửi NGUYÊN dòng OnlineChannel ra ngoài: App
 * Secret, access/refresh token bán hàng, khoá app Video, khoá Set Push… Ai có
 * quyền xem đơn — kể cả nhân viên đóng gói (`packing.view` mở `GET /online-orders`,
 * mỗi đơn kèm cả dòng kênh) — mở DevTools là cầm được khoá gọi API sàn thay chủ
 * shop: đổi giá, huỷ đơn, kéo dữ liệu khách.
 *
 * LỌC THEO DANH SÁCH TRẮNG: cột không có tên trong COT_KENH_CONG_KHAI thì KHÔNG
 * ra ngoài. Thêm cột vào model mà quên xếp loại ⇒ cột đó bị giữ lại (thiếu dữ
 * liệu thì thấy ngay, lộ khoá thì không ai thấy), và `npm run check:kenh-an-toan`
 * đỏ để nhắc xếp loại.
 *
 * Giá trị trong DB GIỮ NGUYÊN — đây chỉ là lớp ra; máy chủ vẫn đọc đủ khoá để gọi sàn.
 */

/** Cột được trả ra trình duyệt. */
export const COT_KENH_CONG_KHAI = [
    'id', 'name', 'platform', 'status', 'shopUrl',
    'tokenExpiresAt',
    'shopId',           // Shopee shop_id / TikTok shop_cipher — định danh, một mình không gọi được API
    'platformShopId',
    'syncEnabled', 'syncFromDate', 'lastSyncAt',
    'totalOrders', 'totalRevenue', 'commissionRate',
    'createdAt', 'updatedAt',
    'videoUserId', 'videoTokenExpiresAt', 'videoAuthAt',
    'videoPartnerId',   // Partner ID app Video — trang Media (/san-media) vẫn hiện đầy đủ để sửa
] as const

/** Cột BÍ MẬT — chỉ máy chủ dùng. Ra ngoài thành cờ `has<Tên>` (riêng apiKey kèm 4 ký tự cuối). */
export const COT_KENH_BI_MAT = [
    'apiKey',             // Shopee partner_id / TikTok·Lazada app_key; kênh website/khác có thể là khoá thật
    'apiSecret',          // khoá KÝ mọi lời gọi API bán hàng
    'accessToken', 'refreshToken',
    'webhookSecret',      // Live Push Partner Key — khoá kiểm chữ ký push
    'videoAccessToken', 'videoRefreshToken',
    'videoPartnerKey',    // khoá app Shopee Video
    'videoPushKey',       // khoá Set Push của app Video
] as const

const coGiaTri = (v: unknown) => v !== null && v !== undefined && String(v).trim() !== ''

/** 'accessToken' → 'hasAccessToken' */
export const tenCoBiMat = (cot: string) => 'has' + cot.charAt(0).toUpperCase() + cot.slice(1)

/**
 * Một dòng OnlineChannel → bản an toàn để `res.json`.
 *
 * Cờ `hasX` chỉ có khi cột X CÓ MẶT trong dữ liệu đưa vào: dòng lấy bằng `select`
 * hẹp không có cột thì không có cờ — "không đọc" khác "không có", trả `false` là
 * giao diện báo "chưa kết nối" oan.
 */
export function anBiMatKenh(kenh: any): any {
    if (!kenh || typeof kenh !== 'object') return kenh
    const ra: Record<string, unknown> = {}
    for (const cot of COT_KENH_CONG_KHAI) if (cot in kenh) ra[cot] = kenh[cot]
    if ('_count' in kenh) ra._count = kenh._count
    for (const cot of COT_KENH_BI_MAT) if (cot in kenh) ra[tenCoBiMat(cot)] = coGiaTri(kenh[cot])
    /* Giao diện hiện "••••1234" để chủ shop nhận ra kênh đang gắn app nào — chỉ 4 ký tự
     * cuối, và chỉ khi khoá dài hơn 4 (khoá ngắn thì 4 ký tự cuối là cả khoá). */
    if ('apiKey' in kenh) {
        const k = coGiaTri(kenh.apiKey) ? String(kenh.apiKey).trim() : ''
        ra.apiKeyLast4 = k.length > 4 ? k.slice(-4) : null
    }
    return ra
}

/** Đơn sàn lấy kèm `channel` (include) → thay `channel` bằng bản an toàn, phần còn lại giữ nguyên. */
export function anBiMatKenhCuaDon(don: any): any {
    if (!don || typeof don !== 'object' || !('channel' in don)) return don
    return { ...don, channel: anBiMatKenh(don.channel) }
}
