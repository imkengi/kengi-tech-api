// ═══════════════════════════════════════════════════════════════════════════════
//  HẸN GIỜ ĐĂNG VIDEO — máy chủ tự đăng, không cần mở trang (14/10/2026)
//
//  Chủ shop: "chưa có hẹn giờ đăng". Bản trước có ô giờ trong form Sửa nhưng lưu xong chỉ gắn
//  nhãn 'da_len_lich' — không gửi gì lên sàn, nút Đăng biến mất, máy đăng coi là xong.
//
//  Nay video hẹn mang trạng thái 'hen_gio'. Nhịp ngoài /api/cron/tick (mỗi phút, có CPU cả đêm —
//  xem routes/cronTick.ts) gọi nhipDangHenGio():
//    · Shopee: chạy máy đăng NGAY khi giờ hẹn còn ≤ 30 ngày. edit_video_info gửi scheduled_post
//      nếu giờ hẹn cách ≥ 16 phút ⇒ Shopee giữ video, tự đăng đúng giờ ('da_len_lich'); gần hơn
//      thì máy đăng tự ĐỢI tới giờ mới post_video (lib/dangVideoShopee.ts, bước edit).
//    · TikTok: Content Posting API không có hẹn giờ ⇒ chỉ bắt đầu khi đã tới giờ.
//  Mỗi lượt có ngân sách; video lớn tải qua nhiều nhịp, tiến trình nằm trong SanMedia.tienTrinhDang.
//
//  Lỗi tạm (mạng, 5xx, proxy) thử lại tối đa 3 lần, cách 5 phút; lỗi chắc chắn (chưa uỷ quyền,
//  chưa đồng ý điều khoản, video quá dài…) thì dừng ngay. Xong hay hỏng đều báo chuông.
// ═══════════════════════════════════════════════════════════════════════════════

import crypto from 'crypto'
import { registryPrisma, getStorePrisma, giuClient } from './prisma'
import { moTaLoi } from './gomLoi'

const THU_LAI_TOI_DA = 3
const CACH_THU_LAI_MS = 5 * 60_000
const BA_MUOI_NGAY_MS = 30 * 86400_000

/** Lỗi mà thử lại cũng vô ích — chủ shop phải làm gì đó trước. */
const LOI_VINH_VIEN = /copyright_not_agree|unauthorized|chưa khai|chưa uỷ quyền|chưa ủy quyền|chưa kết nối|chưa cấp quyền|chưa chọn|chưa gắn gian|chỉ đăng được video|lớn hơn 1GB|vượt trần|Shopee Video chỉ nhận|TikTok từ chối|không có video này|không tìm thấy video/i

const gioVN = (d: Date | string | number) => new Date(d).toLocaleString('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit',
})

function docTt(s?: string | null): any {
    try { const t = s ? JSON.parse(s) : null; return t && typeof t === 'object' ? t : {} } catch { return {} }
}

/** Báo chuông (một lần cho mỗi dấu) + đẩy thông báo — cùng cách lib/pushShopeeVideo.ts báo. */
export async function baoChuong(sp: any, loai: 'success' | 'warning', tieuDe: string, noiDung: string, dau: string): Promise<void> {
    try {
        const da = await sp.notification.findFirst({ where: { message: { contains: dau } }, select: { id: true } })
        if (da) return
        const tin = await sp.notification.create({ data: { type: loai, title: tieuDe.slice(0, 200), message: `${noiDung} ${dau}`.slice(0, 1000) } })
        const { sendPushToStore } = await import('../routes/notifications')
        await sendPushToStore(sp, tieuDe, noiDung.slice(0, 300), { id: tin?.id, type: loai })
    } catch (e: any) {
        console.warn(`[Hẹn giờ video] không gửi được thông báo — ${moTaLoi(e)}`)
    }
}

/* GIỮ CHỖ cho TikTok — máy đăng Shopee tự giữ chỗ (chayBuocDangShopee), TikTok thì chưa. Hai nhịp
 * có thể chồng nhau (lượt trước chưa xong mà Cloud Scheduler đã gọi lượt sau, ở bản máy khác) ⇒ so-và-
 * ghi hạn `dangChayDen` lên ĐÚNG chuỗi tiến trình cũ, ai ghi được thì người đó chạy. */
export async function giuChoTikTok(sp: any, id: string, nganSachMs: number): Promise<string | null> {
    const m = await sp.sanMedia.findUnique({ where: { id }, select: { tienTrinhDang: true } })
    if (!m) return null
    const truoc: string | null = m.tienTrinhDang ?? null
    const t = docTt(truoc)
    if (t.dangChayDen && Date.parse(t.dangChayDen) > Date.now()) return null
    const ma = `hen:${crypto.randomBytes(4).toString('hex')}`
    const moi = { ...t, san: 'tiktok', giaiDoan: t.giaiDoan || 'init', dangChayDen: new Date(Date.now() + nganSachMs + 60_000).toISOString(), dangChayBoi: ma }
    const r = await sp.sanMedia.updateMany({ where: { id, tienTrinhDang: truoc }, data: { tienTrinhDang: JSON.stringify(moi) } })
    return r.count === 1 ? ma : null
}

export async function traCho(sp: any, id: string, ma: string): Promise<void> {
    for (let i = 0; i < 3; i++) {
        const m = await sp.sanMedia.findUnique({ where: { id }, select: { tienTrinhDang: true } }).catch(() => null)
        if (!m?.tienTrinhDang) return
        const t = docTt(m.tienTrinhDang)
        if (t.dangChayBoi !== ma) return
        delete t.dangChayDen; delete t.dangChayBoi
        const r = await sp.sanMedia.updateMany({ where: { id, tienTrinhDang: m.tienTrinhDang }, data: { tienTrinhDang: JSON.stringify(t) } })
            .catch(() => ({ count: 0 }))
        if (r.count === 1) return
    }
}

export interface DongHen { id: string; ten: string; kenh: string | null; henDangLuc: Date; tienTrinhDang: string | null; channelId: string | null }

/** Tới lượt chạy chưa: Shopee chạy sớm (sàn giữ lịch), TikTok đúng giờ; đang chờ thử lại thì đợi. */
export function toiLuot(r: DongHen, now: number): boolean {
    const hen = new Date(r.henDangLuc).getTime()
    if (!Number.isFinite(hen)) return false
    const t = docTt(r.tienTrinhDang)
    if (t.henThuLaiSau && Date.parse(t.henThuLaiSau) > now) return false
    if (r.kenh === 'shopee') return hen - now <= BA_MUOI_NGAY_MS
    return hen <= now
}

async function tenGian(sp: any, channelId: string | null): Promise<string> {
    if (!channelId) return ''
    const c = await sp.onlineChannel.findUnique({ where: { id: channelId }, select: { name: true } }).catch(() => null)
    return c?.name ? ` (gian ${c.name})` : ''
}

export async function chayMot(sp: any, r: DongHen, nganSachMs: number): Promise<string> {
    try {
        if (r.kenh === 'shopee') {
            const { chayBuocDangShopee } = await import('./dangVideoShopee')
            const kq = await chayBuocDangShopee(sp, r.id, nganSachMs, 'hen')
            if (kq.banBan) return 'ban'
            if (kq.xong) {
                const m = await sp.sanMedia.findUnique({ where: { id: r.id }, select: { trangThai: true } }).catch(() => null)
                const gian = await tenGian(sp, r.channelId)
                await baoChuong(sp, 'success',
                    m?.trangThai === 'da_len_lich'
                        ? `Shopee đã nhận lịch đăng video lúc ${gioVN(r.henDangLuc)}`
                        : 'Đã đăng video hẹn giờ lên Shopee Video',
                    `"${String(r.ten).slice(0, 80)}"${gian} — ${kq.thongDiep}`,
                    `[hen-video-xong:${r.id}]`)
                return 'xong'
            }
            return kq.giaiDoan
        }
        if (r.kenh === 'tiktok') {
            const ma = await giuChoTikTok(sp, r.id, nganSachMs)
            if (!ma) return 'ban'
            try {
                const { buocDangTikTok } = await import('./dangVideoTikTok')
                // Không truyền dangThang: lời chọn lúc hẹn nằm trong tiến trình (routes/sanMedia POST /:id/hen-gio)
                const kq = await buocDangTikTok(sp, r.id, { nganSachMs })
                if (kq.xong) {
                    await baoChuong(sp, 'success', 'Đã đăng video hẹn giờ lên TikTok',
                        `"${String(r.ten).slice(0, 80)}" — ${kq.thongDiep}`, `[hen-video-xong:${r.id}]`)
                    return 'xong'
                }
                return kq.giaiDoan
            } finally {
                await traCho(sp, r.id, ma)
            }
        }
        throw new Error('Video hẹn giờ nhưng chưa chọn kênh đăng — bấm Sửa, chọn Shopee hoặc TikTok')
    } catch (e: any) {
        const msg = String(e?.message || e).slice(0, 400)
        const m = await sp.sanMedia.findUnique({ where: { id: r.id }, select: { tienTrinhDang: true } }).catch(() => null)
        const t = docTt(m?.tienTrinhDang)
        const lan = (Number(t.henThuLai) || 0) + 1
        /* Máy đăng đã ghi 'loi' khi ném. Lỗi TẠM thì trả về 'hen_gio' để nhịp sau thử lại, giữ nguyên
         * tiến trình (khối đã lên vẫn tính) — đêm khuya mạng chập một lần không được làm hỏng lịch. */
        if (!LOI_VINH_VIEN.test(msg) && lan <= THU_LAI_TOI_DA) {
            t.henThuLai = lan
            t.henThuLaiSau = new Date(Date.now() + CACH_THU_LAI_MS).toISOString()
            await sp.sanMedia.update({
                where: { id: r.id },
                data: { trangThai: 'hen_gio', loiCuoi: `Lần ${lan}/${THU_LAI_TOI_DA} hỏng: ${msg} — máy chủ thử lại sau 5 phút`, tienTrinhDang: JSON.stringify(t) },
            }).catch(() => { })
            return `thu-lai ${lan}`
        }
        await sp.sanMedia.update({ where: { id: r.id }, data: { trangThai: 'loi', loiCuoi: msg } }).catch(() => { })
        await baoChuong(sp, 'warning', `Không đăng được video hẹn giờ — ${String(r.ten).slice(0, 60)}`,
            `${msg} Mở Media Bán Hàng sửa xong rồi bấm Hẹn giờ lại hoặc Đăng.`,
            `[hen-video-loi:${r.id}:${new Date(r.henDangLuc).getTime()}]`)
        return 'loi: ' + msg.slice(0, 100)
    }
}

let dangChay = false

/**
 * Gọi từ /api/cron/tick mỗi phút. Quét bảng SanMedia của từng cửa hàng bằng SQL thô trên kết nối sổ
 * đăng ký (cửa hàng không dùng Media thì không mở client), chạy TUẦN TỰ trong một ngân sách thời gian.
 */
export async function nhipDangHenGio(nganSachMs = 40_000): Promise<string> {
    if (dangChay) return 'dang-chay'
    dangChay = true
    const batDau = Date.now()
    const conLai = () => nganSachMs - (Date.now() - batDau)
    const ra: string[] = []
    try {
        const stores = await registryPrisma.store.findMany({ where: { status: 'active' }, select: { code: true, schema: true } }) as any[]
        for (const st of stores) {
            if (conLai() < 8_000) { ra.push('het-ngan-sach'); break }
            const schema = String(st.schema || '').replace(/[^A-Za-z0-9_]/g, '')
            if (!schema) continue
            let ds: DongHen[] = []
            try {
                ds = await registryPrisma.$queryRawUnsafe(
                    `SELECT id, ten, kenh, "henDangLuc", "tienTrinhDang", "channelId" FROM "${schema}"."SanMedia"
                      WHERE "trangThai" = 'hen_gio' AND "henDangLuc" IS NOT NULL ORDER BY "henDangLuc" ASC LIMIT 20`)
            } catch { continue }   // chưa có bảng ⇒ cửa hàng không dùng Media
            const now = Date.now()
            const den = ds.filter(r => toiLuot(r, now))
            if (!den.length) continue
            const nha = giuClient(st.schema)
            try {
                const sp: any = getStorePrisma(st.schema)
                for (const r of den) {
                    if (conLai() < 8_000) break
                    const kq = await chayMot(sp, r, Math.max(10_000, Math.min(40_000, conLai() - 3_000)))
                    ra.push(`${st.code}/${String(r.id).slice(-6)}: ${kq}`)
                }
            } finally {
                nha()
            }
        }
    } finally {
        dangChay = false
    }
    return ra.join('; ') || 'khong-co-viec'
}

/* ─── ĐẶT HẸN GIỜ MỘT VIDEO (14/10/2026) ─────────────────────────────────────────────────────────
 * Lõi của POST /san-media/:id/hen-gio, tách ra để "Tự xếp lịch" (lib/xepLichVideo.ts) và máy dựng tự động hẹn
 * đúng y các điều kiện như người bấm tay. Kiểm đủ điều kiện NGAY lúc hẹn — để tới giờ mới vỡ là hỏng lời hứa. */
export type KetQuaHen = { ok: true; media: any; ghiChu: string } | { ok: false; ma: number; loi: string }

function dangGiuCho(tienTrinhDang?: string | null): boolean {
    const t = docTt(tienTrinhDang)
    return !!t.dangChayDen && Date.parse(t.dangChayDen) > Date.now()
}

export async function datHenGio(prisma: any, id: string, t: Date, opt: { dangThang?: boolean } = {}): Promise<KetQuaHen> {
    const m = await prisma.sanMedia.findUnique({ where: { id } })
    if (!m) return { ok: false, ma: 404, loi: 'Không thấy video' }
    if (m.trangThai === 'da_dang' || m.trangThai === 'da_len_lich') return { ok: false, ma: 400, loi: 'Video này đã lên sàn rồi.' }
    if (m.kenh !== 'shopee' && m.kenh !== 'tiktok') return { ok: false, ma: 400, loi: 'Chưa chọn kênh đăng — bấm Sửa, chọn Shopee hoặc TikTok trước.' }
    if (m.nguon !== 'drive' || !m.nguonId) return { ok: false, ma: 400, loi: 'Chỉ hẹn được video nằm trong Drive của cửa hàng.' }
    if (isNaN(t.getTime())) return { ok: false, ma: 400, loi: 'Chưa chọn giờ đăng.' }
    if (t.getTime() < Date.now() + 2 * 60_000) return { ok: false, ma: 400, loi: 'Giờ hẹn phải sau bây giờ ít nhất 2 phút. Muốn đăng liền thì bấm nút Đăng.' }
    if (t.getTime() > Date.now() + BA_MUOI_NGAY_MS) return { ok: false, ma: 400, loi: 'Chỉ hẹn được trong vòng 30 ngày (Shopee giới hạn 30 ngày; refresh token video cũng sống 30 ngày).' }
    if (dangGiuCho(m.tienTrinhDang)) return { ok: false, ma: 409, loi: 'Video đang được đăng ở cửa sổ khác — đợi lượt đó xong.' }

    const dangThang = opt.dangThang === true
    let tienTrinhDang: string | null = m.tienTrinhDang ?? null
    const san = docTt(m.tienTrinhDang).san ?? null
    if (m.kenh === 'shopee') {
        if (m.coNoiDungAI !== true && m.coNoiDungAI !== false) {
            return { ok: false, ma: 400, loi: 'Chưa khai video có dùng AI hay không — Shopee bắt buộc. Chọn "Có AI" / "Không AI" dưới tên video trước.' }
        }
        if (!m.channelId) return { ok: false, ma: 400, loi: 'Chưa chọn gian hàng Shopee — bấm Sửa, chọn gian trước.' }
        const ch = await prisma.onlineChannel.findUnique({ where: { id: m.channelId }, select: { name: true, videoUserId: true } as any })
        if (!ch?.videoUserId) return { ok: false, ma: 400, loi: `Gian "${ch?.name || '?'}" chưa uỷ quyền Shopee Video — uỷ quyền ở ô vàng đầu trang trước khi hẹn.` }
        // Tiến trình đang là của TikTok (đổi kênh) ⇒ bỏ, để máy đăng Shopee giữ chỗ được trên dòng
        if (san && san !== 'shopee') tienTrinhDang = null
    } else {
        const st = await prisma.storeSettings.findFirst({ select: { ttPostOpenId: true, ttPostScopes: true } as any }).catch(() => null)
        const sc = String(st?.ttPostScopes || '').split(',').map((s: string) => s.trim())
        if (!st?.ttPostOpenId) return { ok: false, ma: 400, loi: 'Chưa kết nối tài khoản TikTok — bấm "Kết nối TikTok" ở ô vàng đầu trang.' }
        if (dangThang && !sc.includes('video.publish')) return { ok: false, ma: 400, loi: 'Tài khoản TikTok chưa cấp quyền đăng thẳng (video.publish) — bỏ chọn "đăng thẳng" hoặc kết nối lại có bật.' }
        if (!dangThang && !sc.includes('video.upload')) return { ok: false, ma: 400, loi: 'Tài khoản TikTok chưa cấp quyền video.upload — kết nối lại TikTok.' }
        // Lời chọn đăng thẳng/hộp thư nằm trong tiến trình TikTok để máy chạy đọc lại lúc tới giờ
        const tt = san === 'tiktok' ? docTt(m.tienTrinhDang) : null
        tienTrinhDang = JSON.stringify({ ...(tt || { giaiDoan: 'init' }), san: 'tiktok', dangThang })
    }

    const day = await prisma.sanMedia.update({
        where: { id },
        data: { henDangLuc: t, trangThai: 'hen_gio', loiCuoi: null, tienTrinhDang },
        include: { sanPham: { orderBy: { thuTu: 'asc' } } },
    })
    const conPhut = Math.round((t.getTime() - Date.now()) / 60_000)
    return {
        ok: true, media: day,
        ghiChu: m.kenh === 'shopee'
            ? (conPhut >= 16
                ? `Máy chủ bắt đầu tải video lên Shopee ngay; Shopee giữ và tự đăng lúc ${gioVN(t)}.`
                : `Máy chủ tải video lên Shopee ngay rồi đợi tới ${gioVN(t)} mới đăng.`)
            : `Tới ${gioVN(t)} máy chủ bắt đầu tải lên TikTok${dangThang ? ' và đăng thẳng' : ' (vào hộp thư TikTok — mở app bấm hoàn tất)'}; video lên trễ vài phút tuỳ dung lượng.`,
    }
}
