// ═══════════════════════════════════════════════════════════════════════════════
//  TIỆN ÍCH THEO CỬA HÀNG — gói bổ sung trong registry (Store.addOns, chuỗi JSON mảng id)
//
//  Bật/tắt ở trang quản trị kengi.vn/admin → mở dòng cửa hàng → "Chỉnh sửa gói & tiện ích"
//  (PUT /api/admin/stores/:id/plan). FE đọc addOns qua GET /store-settings để ẩn menu — đó chỉ là
//  che mắt; CHẶN THẬT là ở backend, qua file này.
//
//  01/11/2026 — chủ shop về Shopee Pilot: "cái này quan trọng nên trong admin cho phép cửa hàng
//  nào được xài mới xài" ⇒ tiện ích `shopee_pilot`, CHỈ quản trị bật (cửa hàng không tự xin qua
//  yêu cầu nâng cấp ở Cài đặt). Chặn ở mọi lối vào Pilot:
//    - routes/shopeePilot.ts     API của trang kengi.vn/pilot-shopee/
//    - cron/aiAgentCron.ts       lượt Pilot chạy theo lịch
//    - routes/mcpShopeeTools.ts  tool shopee_* (AI tự đăng hàng / đổi giá) — chặn trong run nên
//                                mọi đường gọi (/api/mcp, tác vụ AI theo lịch, chạy tay) đều qua
//    - routes/mcp.ts             tools/list ẩn tool của tiện ích chưa bật
//    - routes/admin.ts           duyệt yêu cầu nâng cấp KHÔNG làm rơi tiện ích chỉ-quản-trị
//  02/11/2026 — Facebook Pilot (`facebook_pilot`) cùng luật: routes/facebookPilot.ts + lượt theo lịch ở aiAgentCron.
// ═══════════════════════════════════════════════════════════════════════════════

import { registryPrisma } from './prisma'

export const TIEN_ICH_SHOPEE_PILOT = 'shopee_pilot'
export const TIEN_ICH_FACEBOOK_PILOT = 'facebook_pilot'

/** Tiện ích CHỈ quản trị bật. Duyệt yêu cầu nâng cấp GHI ĐÈ addOns bằng danh sách cửa hàng xin — mà
 *  trang Cài đặt không hiện các tiện ích này nên danh sách xin không bao giờ có ⇒ phải giữ lại khi duyệt,
 *  kẻo duyệt xong Pilot tắt âm thầm. Thêm tiện ích kiểu này thì thêm id vào đây (và adminOnly ở FE moduleStore). */
export const TIEN_ICH_CHI_QUAN_TRI: readonly string[] = [TIEN_ICH_SHOPEE_PILOT, TIEN_ICH_FACEBOOK_PILOT]

export const LOI_CHUA_BAT_PILOT =
    'Cửa hàng chưa được bật Shopee Pilot. Đây là tiện ích Kengi bật riêng cho từng cửa hàng — liên hệ Kengi để được bật.'
export const LOI_KHONG_KIEM_DUOC_PILOT =
    'Chưa kiểm tra được cửa hàng có được dùng Shopee Pilot hay không — thử lại sau ít phút.'

/** Tên hiển thị của tiện ích chỉ-quản-trị — cho câu báo chặn. */
const TEN_TIEN_ICH: Record<string, string> = { [TIEN_ICH_SHOPEE_PILOT]: 'Shopee Pilot', [TIEN_ICH_FACEBOOK_PILOT]: 'Facebook Pilot' }

/** Store.addOns (chuỗi JSON hoặc mảng) → mảng id. Rỗng / hỏng ⇒ []. */
export function docTienIch(addOns: unknown): string[] {
    let v: unknown = addOns
    if (typeof v === 'string') {
        try { v = JSON.parse(v || '[]') } catch { return [] }
    }
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

/** Tiện ích sau khi duyệt yêu cầu nâng cấp: phần cửa hàng xin (`moi`) cho các tiện ích thường; tiện ích
 *  chỉ-quản-trị thì lấy theo HIỆN TRẠNG (`cu`) — yêu cầu không làm rơi được, cũng không tự thêm được (gọi thẳng
 *  API xin kèm `shopee_pilot` cũng vô ích). */
export function giuTienIchQuanTri(moi: unknown, cu: unknown): string[] {
    const ds = docTienIch(moi).filter(id => !TIEN_ICH_CHI_QUAN_TRI.includes(id))
    for (const id of docTienIch(cu)) {
        if (TIEN_ICH_CHI_QUAN_TRI.includes(id) && !ds.includes(id)) ds.push(id)
    }
    return ds
}

/* Đệm theo mã cửa hàng, 30 giây như lib/storeStatusCache. Prod KHÔNG có Redis nên mỗi bản máy đệm riêng:
 * tắt ở admin thì chậm nhất 30 giây sau mọi bản mới chặn. Đọc hỏng thì KHÔNG đệm (lần sau đọc lại). */
const TTL_MS = 30_000
const TOI_DA = 5000
const dem = new Map<string, { ds: string[]; het: number }>()

/** Tiện ích đang bật của cửa hàng. Không xác định được cửa hàng / không đọc được registry ⇒ NÉM LỖI —
 *  người gọi tự quyết, đừng coi "không đọc được" là "chưa bật". */
export async function tienIchCuaHang(storeCode: string): Promise<string[]> {
    const ma = String(storeCode || '').trim()
    if (!ma) throw new Error('không xác định được cửa hàng')
    const bayGio = Date.now()
    const co = dem.get(ma)
    if (co && co.het > bayGio) return co.ds
    const store = await registryPrisma.store.findUnique({ where: { code: ma }, select: { addOns: true } })
    if (!store) throw new Error(`không thấy cửa hàng ${ma} trong registry`)
    const ds = docTienIch(store.addOns)
    datDemTienIch(ma, ds, TTL_MS)
    return ds
}

/** Ghi đệm. Dùng nội bộ, và cho bộ kiểm chứng nạp sẵn kết quả để khỏi cần CSDL (ttl mặc định: không hết hạn). */
export function datDemTienIch(storeCode: string, ds: string[], ttlMs = Number.POSITIVE_INFINITY): void {
    dem.delete(storeCode)
    dem.set(storeCode, { ds: [...ds], het: Date.now() + ttlMs })
    if (dem.size > TOI_DA) {
        const dau = dem.keys().next().value
        if (dau !== undefined) dem.delete(dau)
    }
}

/** Bỏ đệm — gọi ngay sau khi quản trị đổi gói của cửa hàng (chỉ có tác dụng trên bản máy nhận lệnh). */
export function xoaDemTienIch(storeCode?: string): void {
    if (storeCode) dem.delete(storeCode)
    else dem.clear()
}

export type LyDoChan = { ma: 'chua_bat_tien_ich' | 'khong_kiem_duoc_tien_ich'; loi: string }

/** Lý do không cho dùng một tiện ích Pilot (mặc định Shopee Pilot), hoặc null nếu được dùng. Đọc registry hỏng ⇒
 *  vẫn CHẶN nhưng nói thật là chưa kiểm được — không bảo chủ shop "chưa được bật" khi thật ra chỉ là đọc lỗi. */
export async function lyDoChanPilot(storeCode: string | null | undefined, tienIch: string = TIEN_ICH_SHOPEE_PILOT): Promise<LyDoChan | null> {
    const shopee = tienIch === TIEN_ICH_SHOPEE_PILOT
    const ten = TEN_TIEN_ICH[tienIch] || tienIch
    try {
        const ds = await tienIchCuaHang(String(storeCode || ''))
        if (ds.includes(tienIch)) return null
        return {
            ma: 'chua_bat_tien_ich',
            loi: shopee ? LOI_CHUA_BAT_PILOT : `Cửa hàng chưa được bật ${ten}. Đây là tiện ích Kengi bật riêng cho từng cửa hàng — liên hệ Kengi để được bật.`,
        }
    } catch (e: any) {
        console.error(`[TienIch] không đọc được tiện ích của cửa hàng "${storeCode || ''}":`, e?.message || e)
        return {
            ma: 'khong_kiem_duoc_tien_ich',
            loi: shopee ? LOI_KHONG_KIEM_DUOC_PILOT : `Chưa kiểm tra được cửa hàng có được dùng ${ten} hay không — thử lại sau ít phút.`,
        }
    }
}
