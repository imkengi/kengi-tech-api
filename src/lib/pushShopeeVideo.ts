// ═══════════════════════════════════════════════════════════════════════════════
//  PUSH CỦA APP SHOPEE VIDEO (11/10/2026)
//
//  Chủ shop: "thêm cái set push của đăng video nha" — trang Push Mechanism › Set Push của
//  app "Video Store" (loại Shopee Video Management) trên Shopee Open Platform. App Video là
//  app RIÊNG (khoá riêng, uỷ quyền cấp NGƯỜI DÙNG — lib/shopeeVideoAuth.ts), nên push của nó
//  vào cửa riêng /api/webhooks/shopee-video và ký bằng khoá RIÊNG của trang Set Push ("Live
//  Push Partner Key" → cột OnlineChannel.videoPushKey). Trộn chung cửa /shopee của app bán
//  hàng thì mã 2 "huỷ uỷ quyền" của app Video dễ bị đọc nhầm thành gian mất kết nối bán hàng.
//
//  Sáu loại bật trên console (tài liệu open.shopee.com/push-mechanism, đọc 11/10/2026):
//    38 video_upload_result_push — tải video tới trạng thái CUỐI (SUCCEEDED / FAILED /
//       CANCELLED; trạng thái giữa chừng không push). KHÔNG có shop_id ⇒ tra theo
//       video_upload_id trong SanMedia.tienTrinhDang. Xong ⇒ máy chủ tự đăng nốt (bìa, sản
//       phẩm, post_video) ở LƯỢT THỬ LẠI của hộp thư — kể cả khi web đã đóng.
//    2  shop_authorization_canceled_push — huỷ uỷ quyền (user_id / shop_id) ⇒ xoá token video + báo
//    12 open_api_authorization_expiry — uỷ quyền hết hạn trong 1 tuần (user_expire_soon) ⇒ báo
//    28 shop_penalty_update_push — điểm phạt / bậc phạt của gian ⇒ báo
//    1  shop_authorization_push, 5 shopee_updates — chỉ ghi log
//  Mọi push đều đi qua hộp thư (services/hopThuWebhook.ts): ghi xong mới trả 200, lỗi tạm thì
//  thử lại. Prod pool 1 kết nối ⇒ truy vấn TUẦN TỰ.
// ═══════════════════════════════════════════════════════════════════════════════

import crypto from 'crypto'
import { registryPrisma, getStorePrisma } from './prisma'
import { xongPush, boPush, hoanPush, type TinPush, type KetQuaPush } from '../services/hopThuWebhook'
import { chayBuocDangShopee, type TienTrinh } from './dangVideoShopee'

/** URL khai ở ô "Live Call Back URL" — đi THẲNG api.kengi.vn (kengi.vn là máy chủ tĩnh, POST bị 302) */
export const URL_PUSH_VIDEO = 'https://api.kengi.vn/api/webhooks/shopee-video'
/** Ô "The Deployment Service Area of your Call Back URL": Cloud Run asia-southeast1 = Singapore */
export const VUNG_PUSH_VIDEO = 'Singapore'

const VN_MS = 7 * 3600_000
const gioVN = (ms: number) => {
    const d = new Date(ms + VN_MS)
    const p = (n: number) => String(n).padStart(2, '0')
    return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())} ${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`
}

/** Shopee push: HMAC-SHA256(khoá, url + "|" + thân thô) dạng hex, gửi ở header Authorization */
export function chuKyKhop(rawBody: Buffer, url: string, key: string, sig: string): boolean {
    const mongDoi = crypto.createHmac('sha256', key).update(`${url}|${rawBody.toString('utf8')}`).digest('hex')
    try {
        const a = Buffer.from(mongDoi, 'hex'), b = Buffer.from(String(sig || '').trim(), 'hex')
        return a.length === b.length && crypto.timingSafeEqual(a, b)
    } catch { return false }
}

// ─── Hàm thuần (thử được không cần CSDL) ──────────────────────────────────────

/** user_id / shop_id nhắc tới trong push uỷ quyền (mã 1, 2) hay sắp hết hạn (mã 12) */
export function idsUyQuyen(data: any): { userIds: string[]; shopIds: string[] } {
    const gom = (...ds: any[]) => Array.from(new Set(ds.flatMap(x => Array.isArray(x) ? x : (x == null ? [] : [x]))
        .map(x => String(x).trim()).filter(x => /^\d+$/.test(x))))
    return {
        userIds: gom(data?.user_id, data?.user_id_list, data?.user_expire_soon),
        shopIds: gom(data?.shop_id, data?.shop_id_list, data?.shop_expire_soon),
    }
}

const VI_PHAM: Record<number, string> = {
    5: 'tỉ lệ giao hàng trễ cao', 6: 'tỉ lệ đơn không thành công cao', 7: 'nhiều đơn không thành công',
    8: 'nhiều đơn giao trễ', 9: 'đăng sản phẩm bị cấm', 10: 'hàng giả / vi phạm sở hữu trí tuệ', 11: 'spam',
    12: 'sao chép / lấy cắp hình ảnh', 13: 'đăng lại sản phẩm đã bị xoá', 14: 'mua hàng giả từ Mall',
    15: 'hàng giả do Shopee phát hiện', 16: 'tỉ lệ hàng đặt trước cao', 17: 'gian lận', 18: 'gian lận voucher',
    19: 'địa chỉ trả hàng giả', 20: 'gian lận vận chuyển', 21: 'nhiều tin chat không phản hồi',
    22: 'trả lời chat thô lỗ', 23: 'yêu cầu người mua huỷ đơn', 24: 'trả lời đánh giá thô lỗ',
    25: 'vi phạm chính sách trả hàng / hoàn tiền', 3030: 'giao dịch ngoài Shopee', 3032: 'gửi kiện rỗng / thiếu hàng',
    3034: 'vi phạm nghiêm trọng trên Shopee Feed', 3036: 'vi phạm nghiêm trọng trên Shopee LIVE',
    3054: 'đơn ảo (order brushing)', 3060: 'tỉ lệ đơn không thành công rất cao', 3074: 'giao dịch ngoài Shopee qua chat',
}
const tenViPham = (v: any) => (v == null ? '' : VI_PHAM[Number(v)] || `mã vi phạm ${v}`)

/** Tìm một trường số ở bất kỳ độ sâu nào — tài liệu mã 28 không ghi rõ tên nhóm của bậc phạt */
function timSo(o: any, ten: string, sau = 0): number | null {
    if (!o || typeof o !== 'object' || sau > 4) return null
    if (o[ten] != null && Number.isFinite(Number(o[ten]))) return Number(o[ten])
    for (const v of Object.values(o)) { const r = timSo(v, ten, sau + 1); if (r != null) return r }
    return null
}

/** Mã 28 → một câu tiếng Việt. action_type: 1 bị phạt điểm, 2 được gỡ điểm, 3 đổi bậc phạt */
export function tomTatPhat(data: any): { tieuDe: string; chiTiet: string } {
    const loai = Number(data?.action_type)
    if (loai === 1) {
        const d = data?.points_issued_data || {}
        const diem = Number(d.issued_points) || timSo(data, 'issued_points') || 0
        return { tieuDe: `Shopee phạt +${diem} điểm`, chiTiet: tenViPham(d.violation_type ?? timSo(data, 'violation_type')) }
    }
    if (loai === 2) {
        const d = data?.points_removed_data || {}
        const diem = Number(d.removed_points) || timSo(data, 'removed_points') || 0
        return { tieuDe: `Shopee gỡ ${diem} điểm phạt`, chiTiet: tenViPham(d.violation_type ?? timSo(data, 'violation_type')) }
    }
    if (loai === 3) {
        const cu = timSo(data, 'old_tier'), moi = timSo(data, 'new_tier')
        return { tieuDe: 'Shopee đổi bậc phạt', chiTiet: `${cu != null ? `bậc ${cu} → ` : ''}bậc ${moi ?? '?'}` }
    }
    return { tieuDe: 'Shopee cập nhật điểm phạt', chiTiet: `loại ${data?.action_type ?? '?'}` }
}

/**
 * Bước kế của một video khi push 38 tới — THUẦN, không ghi gì. null = không đổi gì.
 * Chỉ đụng video đang ở `complete` / `processing` của ĐÚNG phiên tải (video_upload_id khớp).
 */
export function tienTrinhSauPush(
    tt: TienTrinh, uploadId: string, status: string, reason: string, videoInfo: any, nayMs: number,
): { tt: TienTrinh; loi?: string } | null {
    if (tt.videoUploadId !== uploadId) return null
    if (tt.giaiDoan !== 'complete' && tt.giaiDoan !== 'processing') return null
    const st = String(status || '').toUpperCase()
    // Tiền tố: Shopee thật trả 'SUCCEED', tài liệu viết 'SUCCEEDED' (đo 08/09/2026)
    if (/^SUCCE/.test(st)) {
        const res = videoInfo?.resolution ? ` (${videoInfo.resolution})` : ''
        return { tt: { ...tt, giaiDoan: 'cover', tuDongTiep: true, pushLuc: new Date(nayMs).toISOString(), ghiChu: `Shopee chuyển mã xong${res} — báo qua push lúc ${gioVN(nayMs)}` } }
    }
    if (/^FAIL/.test(st) || /^CANCEL/.test(st)) {
        const moi: TienTrinh = { ...tt, giaiDoan: 'init', phanXong: 0, pushLuc: new Date(nayMs).toISOString() }
        delete moi.videoUploadId; delete moi.coverUrl; delete moi.tuDongTiep
        return { tt: moi, loi: `Shopee báo xử lý video ${st}${reason ? `: ${reason}` : ''} — bấm "Tiếp tục đăng" để tải lại từ đầu.` }
    }
    return null
}

// ─── Đọc CSDL ──────────────────────────────────────────────────────────────────

export interface KenhVideo { id: string; name: string; shopId: string | null; videoUserId: string | null; videoPushKey: string | null; videoPartnerId: string | null }
export interface CuaHangVideo { code: string; schema: string; sp: any; kenh: KenhVideo[] }

/** Mọi gian Shopee của mọi cửa hàng đang chạy, kèm khoá push. Cửa hàng chưa migrate cột thì bỏ qua. */
async function cacCuaHang(): Promise<{ ds: CuaHangVideo[]; loi: any }> {
    const stores = await registryPrisma.store.findMany({ where: { status: 'active' }, select: { code: true, schema: true } })
    const ds: CuaHangVideo[] = []
    let loi: any = null
    for (const st of stores) {
        try {
            const sp: any = getStorePrisma(st.schema)
            const kenh = await sp.onlineChannel.findMany({
                where: { platform: 'shopee' },
                select: { id: true, name: true, shopId: true, videoUserId: true, videoPushKey: true, videoPartnerId: true } as any,
            })
            if (kenh.length) ds.push({ code: st.code, schema: st.schema, sp, kenh })
        } catch (e: any) {
            // Bảng / cột chưa có (P2021 / P2022) = cửa hàng không dùng; lỗi khác = đọc hỏng, KHÔNG phải "không có"
            if (e?.code !== 'P2021' && e?.code !== 'P2022') loi = e
        }
    }
    return { ds, loi }
}

/** Khoá nào khớp chữ ký — thử mọi khoá push đã khai × các dạng URL Shopee có thể đã dùng để ký. */
function khoaKhop(tin: TinPush, ds: CuaHangVideo[]): { khop: boolean; soKhoa: number; cuaHang: Set<string> } {
    const khoa = new Map<string, Set<string>>()   // khoá → các cửa hàng mang nó
    for (const ch of ds) for (const k of ch.kenh) {
        const key = String(k.videoPushKey || '').trim()
        if (!key) continue
        if (!khoa.has(key)) khoa.set(key, new Set())
        khoa.get(key)!.add(ch.code)
    }
    if (!khoa.size || !tin.rawBody || !tin.signature) return { khop: false, soKhoa: khoa.size, cuaHang: new Set() }
    const urls = Array.from(new Set([
        process.env.SHOPEE_VIDEO_WEBHOOK_URL || URL_PUSH_VIDEO,
        URL_PUSH_VIDEO, URL_PUSH_VIDEO + '/',
        'https://kengi.vn/api/webhooks/shopee-video',
        tin.pushUrl, tin.pushUrl.replace(/^http:/, 'https:'),
    ].filter(Boolean)))
    for (const [key, cuaHang] of khoa) {
        for (const u of urls) if (chuKyKhop(tin.rawBody, u, key, tin.signature)) return { khop: true, soKhoa: khoa.size, cuaHang }
    }
    return { khop: false, soKhoa: khoa.size, cuaHang: new Set() }
}

async function baoCuaHang(sp: any, code: string, loai: 'warning' | 'success', tieuDe: string, noiDung: string, dau: string): Promise<void> {
    try {
        const da = await sp.notification.findFirst({ where: { message: { contains: dau } }, select: { id: true } })
        if (da) return
        const tin = await sp.notification.create({ data: { type: loai, title: tieuDe.slice(0, 200), message: `${noiDung} ${dau}`.slice(0, 1000) } })
        const { sendPushToStore } = await import('../routes/notifications')
        await sendPushToStore(sp, tieuDe, noiDung.slice(0, 300), { id: tin?.id, type: loai })
    } catch (e: any) {
        console.warn(`[Push Shopee Video] ${code}: không gửi được thông báo — ${e?.message || e}`)
    }
}

// ─── Bộ xử lý (đăng ký với hộp thư ở routes/webhooks.ts) ──────────────────────

/** `docCuaHang` thay được để thử bằng CSDL giả; hộp thư gọi với một tham số ⇒ đọc CSDL thật. */
export async function xuLyPushShopeeVideo(
    tin: TinPush, docCuaHang: () => Promise<{ ds: CuaHangVideo[]; loi: any }> = cacCuaHang,
): Promise<KetQuaPush> {
    const body = tin.body || {}
    const code = Number(body.code)
    const data = body.data || {}

    const { ds, loi } = await docCuaHang()
    const kiem = khoaKhop(tin, ds)
    if (!kiem.khop) {
        if (loi) throw loi   // đọc khoá hỏng giữa chừng — thử lại, đừng kết luận "sai chữ ký"
        if (!kiem.soKhoa) {
            /* Chưa ai dán "Live Push Partner Key" (khoá sinh ở trang Set Push) vào kengi.vn: không kiểm
             * được ⇒ HOÃN chứ không làm theo push lạ, cũng không vứt — dán khoá xong lượt sau tự qua. */
            console.warn(`[Push Shopee Video] code=${code}: chưa khai Live Push Partner Key của app Video (Media › Shopee) — hoãn`)
            return hoanPush('chưa khai Live Push Partner Key của app Video', 600)
        }
        console.error(`[Push Shopee Video] ❌ chữ ký không khớp ${kiem.soKhoa} khoá — bỏ push code=${code}. `
            + `Chép lại "Live Push Partner Key" ở trang Set Push của app Video vào kengi.vn (Media › Shopee) — `
            + `bấm Generate bên console là khoá ĐỔI, phải dán lại.`)
        return boPush(`chữ ký không khớp ${kiem.soKhoa} khoá push app Video`)
    }
    // Chỉ làm trên cửa hàng mang ĐÚNG khoá đã khớp — app Video của chủ khác không đụng tới đây
    const cuaHang = ds.filter(c => kiem.cuaHang.has(c.code))

    switch (code) {
        case 38: return xuLyKetQuaTai(tin, data, cuaHang)
        case 2: return xuLyHuyUyQuyen(body, data, cuaHang)
        case 12: return xuLySapHetHan(data, cuaHang)
        case 28: return xuLyPhat(body, data, cuaHang)
        case 1:
            console.log(`[Push Shopee Video] uỷ quyền app Video: ${String(data.extra || data.authorize_type || '').slice(0, 160)}`)
            return xongPush('uỷ quyền app Video — chỉ ghi log')
        case 5: {
            const ds5 = Array.isArray(data.actions) ? data.actions : []
            console.log(`[Push Shopee Video] Shopee Updates shop=${body.shop_id}: ${ds5.map((a: any) => a?.title).filter(Boolean).join(' | ').slice(0, 300)}`)
            return xongPush('Shopee Updates — chỉ ghi log')
        }
        default:
            console.log(`[Push Shopee Video] code=${code} chưa xử lý: ${JSON.stringify(data).slice(0, 300)}`)
            return boPush(`mã push ${code} chưa xử lý`)
    }
}

/** 38 — kết quả tải video. Lần NHẬN chỉ đổi bước (phải trả lời sàn trong 3 giây); lượt THỬ LẠI mới đăng nốt. */
async function xuLyKetQuaTai(tin: TinPush, data: any, cuaHang: CuaHangVideo[]): Promise<KetQuaPush> {
    const uploadId = String(data.video_upload_id || '').trim()
    if (!uploadId) return boPush('push 38 thiếu video_upload_id')

    let thay: { ch: CuaHangVideo; m: any } | null = null
    for (const ch of cuaHang) {
        try {
            const m = await ch.sp.sanMedia.findFirst({
                where: { tienTrinhDang: { contains: uploadId } },
                select: { id: true, ten: true, trangThai: true, tienTrinhDang: true, channelId: true },
            })
            if (m) { thay = { ch, m }; break }
        } catch (e: any) {
            if (e?.code !== 'P2021' && e?.code !== 'P2022') throw e
        }
    }
    if (!thay) {
        // Video tải bằng đường khác (app điện thoại, công cụ khác) — không phải của Kengi
        console.log(`[Push Shopee Video] 38 ${uploadId} ${data.status}: không có video nào trong kho mang mã tải này`)
        return xongPush('video không do Kengi tải')
    }
    const { ch, m } = thay
    let tt: any
    try { tt = JSON.parse(m.tienTrinhDang || '{}') } catch { return boPush('tiến trình đăng hỏng') }
    if (m.trangThai === 'da_dang' || m.trangThai === 'da_len_lich' || tt.giaiDoan === 'xong') return xongPush('video đã đăng')
    const nay = Date.now()
    const dangChay = !!tt.dangChayDen && Date.parse(tt.dangChayDen) > nay

    const buoc = tienTrinhSauPush(tt, uploadId, data.status, String(data.reason || ''), data.video_info, nay)
    if (buoc) {
        // Máy đăng đang chạy (web đang mở) — nó hỏi Shopee mỗi 5 giây nên tự thấy; ghi chen là đè nhau
        if (dangChay) return hoanPush('máy đăng đang chạy — để nó tự thấy kết quả', 45)
        const r = await ch.sp.sanMedia.updateMany({
            where: { id: m.id, tienTrinhDang: m.tienTrinhDang },
            data: {
                tienTrinhDang: JSON.stringify(buoc.tt),
                ...(buoc.loi ? { trangThai: 'loi', loiCuoi: buoc.loi } : {}),
            },
        })
        if (r.count !== 1) return hoanPush('tiến trình vừa đổi — đọc lại sau', 15)
        console.log(`[Push Shopee Video] ${ch.code} "${m.ten}": ${data.status} → bước ${buoc.tt.giaiDoan}`)
        if (buoc.loi) {
            await baoCuaHang(ch.sp, ch.code, 'warning', `Shopee Video: xử lý video hỏng — ${String(m.ten).slice(0, 60)}`,
                buoc.loi, `[push-video:${uploadId}:${String(data.status).toUpperCase()}]`)
            return xongPush(`Shopee ${data.status}`)
        }
        tt = buoc.tt
    }

    if (tt.giaiDoan !== 'cover' && tt.giaiDoan !== 'edit' && tt.giaiDoan !== 'post') return xongPush(`video ở bước ${tt.giaiDoan} — không cần làm gì`)
    if (!tt.tuDongTiep) return xongPush('đã qua bước chuyển mã trước khi push tới — web đang lo')
    // Lần NHẬN: còn phải trả lời Shopee trong 3 giây — để lượt thử lại (có CPU) đăng nốt
    if (tin.soLanThu <= 1) return hoanPush('Shopee chuyển mã xong — máy chủ đăng tiếp ở lượt sau', 20)

    try {
        const kq = await chayBuocDangShopee(ch.sp, m.id, 40_000, 'push')
        if (kq.banBan) return hoanPush('đang có lượt khác đăng video này — đợi', 30)
        if (kq.xong) {
            await baoCuaHang(ch.sp, ch.code, 'success', `Shopee Video: ${kq.thongDiep.slice(0, 120)}`,
                `"${String(m.ten).slice(0, 80)}" — máy chủ đăng tiếp sau khi Shopee báo chuyển mã xong.`, `[push-video-xong:${uploadId}]`)
            return xongPush(kq.thongDiep)
        }
        return hoanPush(`đăng chưa xong (${kq.giaiDoan}) — lượt sau chạy tiếp`, 20)
    } catch (e: any) {
        // buocDangShopee đã ghi 'loi' + lý do lên video — báo rồi thôi, chờ người bấm "Tiếp tục đăng"
        const msg = String(e?.message || e).slice(0, 400)
        await baoCuaHang(ch.sp, ch.code, 'warning', `Shopee Video: đăng tiếp hỏng — ${String(m.ten).slice(0, 60)}`,
            msg, `[push-video-loi:${uploadId}]`)
        return xongPush(`đăng tiếp hỏng: ${msg.slice(0, 160)}`)
    }
}

/** Kênh dính tới push uỷ quyền: theo user_id của uỷ quyền video, hoặc theo shop_id nếu kênh đã uỷ quyền video. */
function kenhDinh(cuaHang: CuaHangVideo[], userIds: string[], shopIds: string[]): Array<{ ch: CuaHangVideo; k: KenhVideo }> {
    const ra: Array<{ ch: CuaHangVideo; k: KenhVideo }> = []
    for (const ch of cuaHang) for (const k of ch.kenh) {
        if (!k.videoUserId) continue
        if (userIds.includes(String(k.videoUserId)) || (k.shopId && shopIds.includes(String(k.shopId)))) ra.push({ ch, k })
    }
    return ra
}

/** 2 — huỷ uỷ quyền app Video ⇒ token video vô dụng: xoá để màn hình nói đúng "chưa uỷ quyền", rồi báo. */
async function xuLyHuyUyQuyen(body: any, data: any, cuaHang: CuaHangVideo[]): Promise<KetQuaPush> {
    const { userIds, shopIds } = idsUyQuyen(data)
    const dinh = kenhDinh(cuaHang, userIds, shopIds)
    if (!dinh.length) {
        console.log(`[Push Shopee Video] huỷ uỷ quyền user=${userIds.join(',')} shop=${shopIds.join(',')}: không gian nào đang dùng — bỏ qua`)
        return xongPush('huỷ uỷ quyền — không gian nào đang dùng')
    }
    for (const { ch, k } of dinh) {
        await ch.sp.onlineChannel.update({
            where: { id: k.id },
            data: { videoUserId: null, videoAccessToken: null, videoRefreshToken: null, videoTokenExpiresAt: null, videoAuthAt: null } as any,
        })
        console.log(`[Push Shopee Video] ${ch.code} "${k.name}": Shopee báo HUỶ uỷ quyền app Video — đã xoá token video`)
        await baoCuaHang(ch.sp, ch.code, 'warning', `Shopee Video: gian "${k.name}" đã bị huỷ uỷ quyền`,
            'Kengi không đăng video lên gian này được nữa. Vào Media › Shopee, bấm "Uỷ quyền Shopee Video" để nối lại.',
            `[huy-uq-video:${k.id}:${body.timestamp || ''}]`)
    }
    return xongPush(`huỷ uỷ quyền ${dinh.length} gian`)
}

/** 12 — uỷ quyền app Video hết hạn trong 1 tuần ⇒ báo một lần cho mỗi gian / mỗi mốc hết hạn. */
async function xuLySapHetHan(data: any, cuaHang: CuaHangVideo[]): Promise<KetQuaPush> {
    const { userIds, shopIds } = idsUyQuyen(data)
    const dinh = kenhDinh(cuaHang, userIds, shopIds)
    if (!dinh.length) return xongPush('sắp hết hạn — không gian nào đang dùng')
    const truoc = Number(data.expire_before) || 0
    const han = truoc ? ` trước ${gioVN(truoc * 1000).slice(6)}` : ' trong vòng một tuần'
    for (const { ch, k } of dinh) {
        await baoCuaHang(ch.sp, ch.code, 'warning', `Shopee Video: uỷ quyền gian "${k.name}" sắp hết hạn`,
            `Uỷ quyền app Video hết hạn${han}. Vào Media › Shopee, bấm "Uỷ quyền Shopee Video" để gia hạn — hết hạn là không đăng video được.`,
            `[het-han-uq-video:${k.id}:${truoc}]`)
    }
    return xongPush(`báo sắp hết hạn ${dinh.length} gian`)
}

/** 28 — điểm phạt / bậc phạt ⇒ báo cửa hàng có gian đó (ưu tiên cửa hàng đang dùng app Video). */
async function xuLyPhat(body: any, data: any, cuaHang: CuaHangVideo[]): Promise<KetQuaPush> {
    const shopId = body.shop_id == null ? '' : String(body.shop_id)
    if (!shopId) return boPush('push 28 thiếu shop_id')
    let dinh: Array<{ ch: CuaHangVideo; k: KenhVideo }> = []
    for (const ch of cuaHang) for (const k of ch.kenh) if (String(k.shopId || '') === shopId) dinh.push({ ch, k })
    const coApp = dinh.filter(x => x.k.videoPartnerId)
    if (coApp.length) dinh = coApp
    if (!dinh.length) return xongPush(`điểm phạt shop ${shopId} — không gian nào khớp`)
    const t = tomTatPhat(data)
    const luc = Number(data.update_time || body.timestamp) || 0
    const daBao = new Set<string>()
    for (const { ch, k } of dinh) {
        if (daBao.has(ch.code)) continue
        daBao.add(ch.code)
        await baoCuaHang(ch.sp, ch.code, 'warning', `${t.tieuDe} — gian "${k.name}"`,
            `${t.chiTiet ? `Lý do: ${t.chiTiet}. ` : ''}Xem chi tiết ở Seller Center › Hiệu quả shop › Điểm phạt.`,
            `[phat-shopee:${shopId}:${luc}:${data.action_type ?? ''}]`)
    }
    return xongPush(`${t.tieuDe} — báo ${daBao.size} cửa hàng`)
}
