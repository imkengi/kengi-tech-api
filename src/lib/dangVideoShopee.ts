// ═══════════════════════════════════════════════════════════════════════════════
//  ĐĂNG VIDEO LÊN SHOPEE VIDEO — máy chạy THEO TỪNG BƯỚC, trạng thái nằm trong DB
//
//  Vì sao không chạy một mạch: Cloud Run bóp CPU ngoài yêu cầu và cắt yêu cầu ở
//  300 giây (đo 08/09/2026: cpu-throttling=true, timeoutSeconds=300). Video 1GB
//  chia ~100 khối 10MB đi qua proxy Tino không thể xong trong một yêu cầu, còn
//  tiến trình nền thì bị bóp CPU tới chết. Nên mỗi lần gọi làm việc trong một
//  NGÂN SÁCH THỜI GIAN, ghi tiến trình vào `SanMedia.tienTrinhDang`, rồi trả về
//  `conTiep` để web gọi tiếp. Đứt mạng, đóng tab, lỗi tạm — bấm lại là chạy tiếp
//  từ khối đang dở, không tải lại từ đầu.
//
//  HAI NHÓM, HAI CHỮ KÝ (đo lại 08/09 sau khi bị error_sign): v2.media.* ký kiểu
//  PARTNER (partner_id+path+timestamp, không token) → goiCong/taiKhoiMedia;
//  v2.video.* ký kiểu USER (+access_token+user_id) → goiNguoiDung.
//  Đường đi (tài liệu Shopee đọc 08/09/2026):
//    init_video_upload → upload_video_part ×N (multipart, md5 từng khối, đúng
//    part_size trừ khối cuối) → complete_video_upload → get_video_upload_result
//    (poll tới SUCCEEDED/FAILED) → get_cover_list (chọn khung) → edit_video_info
//    (caption ≤150, bìa, ≤6 sản phẩm theo item_id, hẹn giờ 15'–30 ngày) →
//    post_video → post_id.
//
//  Byte đọc THẲNG từ Google Drive theo Range (mỗi khối một yêu cầu), không tải
//  cả file về đĩa Cloud Run (đĩa tạm, mất khi restart, và 1GB là quá nhiều).
// ═══════════════════════════════════════════════════════════════════════════════

import crypto from 'crypto'
import { layTokenVideoShopee } from './shopeeVideoAuth'
import { getStoreDriveWriter } from './driveOAuth'
import { docKhoiDrive } from './khoiVideo'

export type GiaiDoan = 'init' | 'parts' | 'complete' | 'processing' | 'cover' | 'edit' | 'post' | 'xong'

export interface TienTrinh {
    /** 'shopee' — CỘT tienTrinhDang DÙNG CHUNG với TikTok, phải biết của ai. */
    san?: string
    giaiDoan: GiaiDoan
    videoUploadId?: string
    partSize?: number
    fileSize?: number
    tongPhan?: number
    phanXong?: number
    duration?: number
    coverUrl?: string
    batDauLuc?: string
    capNhatLuc?: string
    ghiChu?: string
    /** Push 38 báo chuyển mã xong ⇒ máy chủ được phép tự đăng nốt (lib/pushShopeeVideo.ts) */
    tuDongTiep?: boolean
    pushLuc?: string
    /** Hạn giữ chỗ chạy + ai giữ — xem chayBuocDangShopee */
    dangChayDen?: string
    dangChayBoi?: string
    /** edit_video_info đã gửi scheduled_post=true ⇒ post_video xong là SHOPEE giữ lịch ('da_len_lich') */
    henQuaShopee?: boolean
}

export interface KetQuaBuoc {
    xong: boolean
    conTiep: boolean
    giaiDoan: GiaiDoan
    tienTrinh: TienTrinh
    thongDiep: string
}

const NGAN_SACH_MAC_DINH_MS = 75_000   // lượt ngắn để web hiện tiến trình đều; 200s từng bị tưởng là treo
const MOT_GB = 1024 * 1024 * 1024

const GIAI_DOAN_SHOPEE: string[] = ['init', 'parts', 'complete', 'processing', 'cover', 'edit', 'post', 'xong']

/**
 * ⚠ `tienTrinhDang` là MỘT cột dùng chung với TikTok — đổi kênh video là ô này còn
 * tiến trình của sàn kia. Đọc phải kiểm dấu `san`.
 *
 * `!t.san` = bản ghi CŨ, có từ trước khi đóng dấu (09/09/2026) ⇒ vẫn là Shopee,
 * PHẢI nhận. Đá đi là mất bản nháp đang chờ Shopee mở khoá điều khoản, tải lại từ
 * khối 0 — thứ đã tốn cả buổi mới lên tới nơi.
 */
export function docTienTrinh(s?: string | null): TienTrinh {
    try {
        const t = s ? JSON.parse(s) : null
        if (!t || typeof t !== 'object') return { giaiDoan: 'init' }
        if (t.san && t.san !== 'shopee') return { giaiDoan: 'init' }
        if (!GIAI_DOAN_SHOPEE.includes(t.giaiDoan)) return { giaiDoan: 'init' }
        return t
    } catch { return { giaiDoan: 'init' } }
}

async function luu(prisma: any, id: string, tt: TienTrinh, them?: Record<string, any>) {
    tt.san = 'shopee'
    tt.capNhatLuc = new Date().toISOString()
    await prisma.sanMedia.update({ where: { id }, data: { tienTrinhDang: JSON.stringify(tt), ...(them || {}) } })
}

function kiemLoiShopee(r: any, buoc: string) {
    if (r?.error) throw new Error(`${buoc}: ${r.error}${r.message ? ' — ' + r.message : ''}`)
}

export async function buocDangShopee(prisma: any, mediaId: string, nganSachMs = NGAN_SACH_MAC_DINH_MS): Promise<KetQuaBuoc> {
    const batDau = Date.now()
    const conGio = () => Date.now() - batDau < nganSachMs

    const m = await prisma.sanMedia.findUnique({
        where: { id: mediaId },
        include: { sanPham: { orderBy: { thuTu: 'asc' } } },
    })
    if (!m) throw new Error('Không có video này trong kho')
    if (m.kenh !== 'shopee') throw new Error('Video chưa chọn kênh Shopee — bấm Sửa, chọn kênh Shopee và gian hàng')
    if (!m.channelId) throw new Error('Video chưa gắn gian hàng Shopee cụ thể — bấm Sửa, chọn gian hàng')
    if (m.nguon !== 'drive' || !m.nguonId) throw new Error('Chỉ đăng được video nằm trong Drive của cửa hàng (video dạng liên kết ngoài chưa hỗ trợ)')

    const tt = docTienTrinh(m.tienTrinhDang)
    if (m.trangThai === 'da_dang' || m.trangThai === 'da_len_lich' || tt.giaiDoan === 'xong') {
        return { xong: true, conTiep: false, giaiDoan: 'xong', tienTrinh: tt, thongDiep: `Video này đã ${m.trangThai === 'da_len_lich' ? 'lên lịch' : 'đăng'} rồi (mã ${m.maTrenSan || '?'})` }
    }

    /* KHAI NỘI DUNG AI (09/10/2026). `aigc_label` là trường BẮT BUỘC của
     * edit_video_info (đo tài liệu Shopee hôm nay), và Shopee trừ điểm nếu khai "không"
     * mà video có hình / giọng / avatar / kịch bản AI — cửa hàng này có cả công cụ lồng
     * tiếng AI lẫn studio livestream AI. Bản trước gửi CỨNG false cho mọi video. Chưa
     * khai thì dừng NGAY, trước khi tải cả GB lên, và không đoán. */
    if (m.coNoiDungAI !== true && m.coNoiDungAI !== false) {
        throw new Error('Chưa khai video có dùng AI hay không. Shopee bắt buộc khai, khai sai có thể bị trừ điểm. Chọn "Có AI" hoặc "Không AI" ở dòng video rồi bấm đăng lại.')
    }

    const { svc, accessToken, userId } = await layTokenVideoShopee(prisma, m.channelId)
    const cred = { accessToken, userId }
    const tra = (thongDiep: string, xong = false): KetQuaBuoc => ({ xong, conTiep: !xong, giaiDoan: tt.giaiDoan, tienTrinh: tt, thongDiep })

    try {
        // ── 1. INIT ────────────────────────────────────────────────────────────
        if (tt.giaiDoan === 'init') {
            const { drive } = await getStoreDriveWriter(prisma)
            const meta = await drive.files.get({
                fileId: m.nguonId, supportsAllDrives: true,
                fields: 'id,name,size,mimeType,videoMediaMetadata(durationMillis)',
            })
            const fileSize = Number(meta.data?.size || m.bytes || 0)
            const durMs = Number(meta.data?.videoMediaMetadata?.durationMillis || 0)
            const duration = durMs > 0 ? Math.round(durMs / 1000) : Math.round(Number(m.thoiLuongS) || 0)
            if (!fileSize) throw new Error('Drive không trả dung lượng file')
            if (fileSize > MOT_GB) throw new Error(`File ${(fileSize / 1048576).toFixed(0)}MB lớn hơn 1GB — Shopee Video tối đa 1GB`)
            if (!duration) throw new Error('Không đọc được thời lượng video từ Drive — Drive có thể chưa xử lý xong file, thử lại sau vài phút')
            if (duration < 1 || duration > 180) throw new Error(`Video dài ${duration} giây — Shopee Video chỉ nhận 1–180 giây`)

            const r = await svc.goiCong('/api/v2/media/init_video_upload', 'POST', undefined, {
                business: 3, scene: 1,
                file_name: String(meta.data?.name || m.ten).slice(0, 200),
                file_size: fileSize,
                duration,
            })
            kiemLoiShopee(r, 'init_video_upload')
            const videoUploadId = r.response?.video_upload_id
            const partSize = Number(r.response?.part_size || 0)
            if (!videoUploadId || !partSize) throw new Error('init_video_upload không trả video_upload_id / part_size')

            Object.assign(tt, {
                giaiDoan: 'parts' as GiaiDoan, videoUploadId, partSize, fileSize, duration,
                tongPhan: Math.ceil(fileSize / partSize), phanXong: 0,
                batDauLuc: new Date().toISOString(), ghiChu: undefined,
            })
            // Video HẸN GIỜ (máy chủ tự chạy) giữ nguyên 'hen_gio' suốt lúc tải — máy chạy theo lịch chỉ
            // quét 'hen_gio', đổi sang 'cho_dang' là nó buông giữa chừng (lib/henGioDangVideo.ts)
            await luu(prisma, m.id, tt, { trangThai: m.trangThai === 'hen_gio' ? 'hen_gio' : 'cho_dang', loiCuoi: null, thoiLuongS: duration, bytes: fileSize })
        }

        // ── 2. PARTS ───────────────────────────────────────────────────────────
        if (tt.giaiDoan === 'parts') {
            const { drive } = await getStoreDriveWriter(prisma)
            // MỘT bộ đệm cho mọi khối của lượt này — khối 10MB, cấp mới mỗi khối là rác chồng rác (lib/khoiVideo.ts)
            let boDem: Buffer | undefined
            while ((tt.phanXong ?? 0) < (tt.tongPhan ?? 0) && conGio()) {
                const i = tt.phanXong ?? 0
                const tu = i * (tt.partSize as number)
                const den = Math.min(tt.fileSize as number, tu + (tt.partSize as number)) - 1
                const khoi = await docKhoiDrive(drive, m.nguonId, tu, den, boDem ??= Buffer.allocUnsafe(tt.partSize as number))
                if (khoi.length !== den - tu + 1) throw new Error(`Khối ${i}: Drive trả ${khoi.length} byte, cần ${den - tu + 1} — Drive không tôn trọng Range?`)
                const md5 = crypto.createHash('md5').update(khoi).digest('hex')
                const r = await svc.taiKhoiMedia({ video_upload_id: tt.videoUploadId as string, part_seq: i, part_md5: md5 }, khoi)
                kiemLoiShopee(r, `upload_video_part #${i}`)
                tt.phanXong = i + 1
                await luu(prisma, m.id, tt)   // ghi từng khối: đứt là chạy tiếp đúng chỗ
            }
            if ((tt.phanXong ?? 0) < (tt.tongPhan ?? 0)) return tra(`Đã tải ${tt.phanXong}/${tt.tongPhan} khối lên Shopee`)
            tt.giaiDoan = 'complete'
            await luu(prisma, m.id, tt)
        }

        // ── 3. COMPLETE ────────────────────────────────────────────────────────
        if (tt.giaiDoan === 'complete') {
            const r = await svc.goiCong('/api/v2/media/complete_video_upload', 'POST', undefined, { video_upload_id: tt.videoUploadId })
            kiemLoiShopee(r, 'complete_video_upload')
            tt.giaiDoan = 'processing'
            await luu(prisma, m.id, tt)
        }

        // ── 4. PROCESSING (Shopee chuyển mã) ───────────────────────────────────
        if (tt.giaiDoan === 'processing') {
            while (conGio()) {
                const r = await svc.goiCong('/api/v2/media/get_video_upload_result', 'GET', { video_upload_id: tt.videoUploadId as string })
                kiemLoiShopee(r, 'get_video_upload_result')
                const st = String(r.response?.status || '').toUpperCase()
                /* ĐO 08/09/2026: Shopee trả 'SUCCEED', KHÔNG phải 'SUCCEEDED' như tài
                 * liệu. So đúng chữ tài liệu là không bao giờ khớp: video đã xong mà
                 * mã cứ hỏi lại mỗi 5s cho hết ngân sách, bốn lượt 200s liền (chủ shop
                 * tưởng treo). Nhận theo TIỀN TỐ để cả hai cách viết đều qua. */
                if (/^SUCCE/.test(st)) {
                    tt.giaiDoan = 'cover'
                    tt.ghiChu = r.response?.video_info?.resolution ? `Shopee nhận video ${r.response.video_info.resolution}` : undefined
                    await luu(prisma, m.id, tt)
                    break
                }
                if (/^FAIL/.test(st) || /^CANCEL/.test(st)) {
                    // Tải lại từ đầu mới có ích — đặt về init để lần bấm sau không kẹt.
                    tt.giaiDoan = 'init'
                    throw new Error(`Shopee xử lý video ${st}: ${r.response?.reason || 'không rõ lý do'}`)
                }
                tt.ghiChu = `Shopee đang xử lý (${st || 'chờ'})`
                await luu(prisma, m.id, tt)
                await new Promise(r => setTimeout(r, 5000))
            }
            if (tt.giaiDoan === 'processing') return tra('Shopee đang chuyển mã video, chờ thêm')
        }

        // ── 5. COVER ───────────────────────────────────────────────────────────
        if (tt.giaiDoan === 'cover') {
            const r = await svc.goiNguoiDung('/api/v2/video/get_cover_list', 'GET', cred, { video_upload_id: tt.videoUploadId as string })
            kiemLoiShopee(r, 'get_cover_list')
            const ds: string[] = Array.isArray(r.response?.image_url_list) ? r.response.image_url_list : []
            if (!ds.length) throw new Error('get_cover_list không trả khung hình nào')
            // Khung giữa video thường có sản phẩm hơn khung đầu (hay là màn đen/logo).
            tt.coverUrl = ds[Math.floor(ds.length / 2)] || ds[0]
            tt.giaiDoan = 'edit'
            await luu(prisma, m.id, tt)
        }

        // ── 6. EDIT INFO ───────────────────────────────────────────────────────
        if (tt.giaiDoan === 'edit') {
            const coMa = (m.sanPham || []).filter((s: any) => s.maTrenSan && /^\d+$/.test(String(s.maTrenSan)))
            const thieu = (m.sanPham || []).filter((s: any) => !s.maTrenSan).map((s: any) => s.sku)
            const items = coMa.slice(0, 6).map((s: any) => ({
                item_id: Number(s.maTrenSan),
                ...(s.nhan ? { custom_item_name: String(s.nhan).slice(0, 30) } : {}),
            }))

            let scheduled: any = { scheduled_post: false }
            const ghi: string[] = []
            if (m.henDangLuc) {
                const t = new Date(m.henDangLuc).getTime()
                const gio = Date.now()
                /* Tài liệu edit_video_info (đọc 14/10/2026): scheduled_post_time là MILI GIÂY, phải sau lúc gọi
                 * ≥15 phút và trong 30 ngày. Lấy 16 phút: edit → post mất vài giây, sát mép là error_param. */
                if (t > gio + 16 * 60_000 && t < gio + 30 * 86400_000) scheduled = { scheduled_post: true, scheduled_post_time: t }
                else if (m.trangThai === 'hen_gio' && t > gio) {
                    /* Hẹn qua máy chủ mà còn < 16 phút: Shopee không nhận lịch gần vậy ⇒ ĐỢI tới giờ rồi
                     * đăng ngay (máy chạy gọi lại mỗi phút). Đăng sớm hơn giờ hẹn là sai lời hứa. */
                    const gioHen = new Date(t).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })
                    tt.ghiChu = `Đã tải xong — đợi tới ${gioHen} để đăng`
                    await luu(prisma, m.id, tt)
                    return tra(tt.ghiChu)
                }
                else if (m.trangThai !== 'hen_gio') ghi.push('Giờ hẹn ngoài khung 15 phút–30 ngày của Shopee → đăng ngay')
            }
            tt.henQuaShopee = !!scheduled.scheduled_post
            if (thieu.length) ghi.push(`Bỏ qua SKU chưa tra ra hàng trên sàn: ${thieu.join(', ')}`)
            if (coMa.length > 6) ghi.push(`Shopee chỉ nhận 6 sản phẩm, bỏ ${coMa.length - 6} mã cuối`)

            const body = {
                video_upload_list: [{
                    video_upload_id: tt.videoUploadId,
                    caption: String(m.caption || m.ten || '').slice(0, 150),
                    cover_image_url: tt.coverUrl,
                    ...(items.length ? { item_info: items } : {}),
                    allow_info: { allow_duet: true, allow_stitch: true },
                    scheduled_info: scheduled,
                }],
                // Cấp NGOÀI CÙNG, cạnh video_upload_list — đúng ví dụ trong tài liệu Shopee
                aigc_label: m.coNoiDungAI === true,
            }
            const r = await svc.goiNguoiDung('/api/v2/video/edit_video_info', 'POST', cred, undefined, body)
            const fail = r.response?.failure_list?.[0]
            if (fail?.failed_reason) throw new Error(`edit_video_info: ${fail.failed_reason}`)
            kiemLoiShopee(r, 'edit_video_info')
            if (!(r.response?.success_list || []).includes(tt.videoUploadId)) throw new Error('edit_video_info không xác nhận thành công')
            tt.giaiDoan = 'post'
            tt.ghiChu = ghi.length ? ghi.join(' · ') : tt.ghiChu
            await luu(prisma, m.id, tt)
        }

        // ── 7. POST ────────────────────────────────────────────────────────────
        if (tt.giaiDoan === 'post') {
            const r = await svc.goiNguoiDung('/api/v2/video/post_video', 'POST', cred, undefined, { video_upload_id_list: [tt.videoUploadId] })
            const fail = r.response?.failure_list?.[0]
            if (fail?.failed_reason) throw new Error(`post_video: ${fail.failed_reason}`)
            kiemLoiShopee(r, 'post_video')
            const ok = r.response?.success_list?.[0]
            if (!ok?.post_id) throw new Error('post_video không trả post_id')

            tt.giaiDoan = 'xong'
            // Theo ĐÚNG lời gửi ở edit_video_info, đừng tính lại theo đồng hồ lúc này (hai phép tính là hai kết quả)
            const daHen = !!tt.henQuaShopee
            await luu(prisma, m.id, tt, {
                trangThai: daHen ? 'da_len_lich' : 'da_dang',
                maTrenSan: String(ok.post_id),
                dangLuc: new Date(),
                loiCuoi: tt.ghiChu || null,   // ghi chú (SKU bị bỏ…) hiện ở ô trạng thái, không phải lỗi
            })
            return tra(daHen ? `Đã lên lịch trên Shopee Video (mã ${ok.post_id})` : `Đã đăng lên Shopee Video (mã ${ok.post_id})`, true)
        }

        return tra('Đã xong', true)
    } catch (e: any) {
        /* Giữ NGUYÊN tiến trình (khối đã lên vẫn tính), chỉ đánh dấu lỗi kèm lý do
         * nguyên văn của Shopee. Lần bấm sau đọc tiến trình ra chạy tiếp. */
        let msg = String(e?.message || e).slice(0, 500)

        /* TRỪ KHI phiên tải bên Shopee đã hỏng/hết hạn. Lúc đó chạy tiếp là kẹt VĨNH
         * VIỄN: mọi lượt sau đều nhảy thẳng vào post_video với một video_upload_id
         * không còn tồn tại. Ca này chắc chắn xảy ra khi chủ shop chờ Shopee mở
         * quyền vài ngày rồi mới bấm lại. Đặt lại về `init` để lượt sau tải lại từ
         * đầu, và NÓI RA để không ai tưởng mất công vô cớ.
         * Ba câu này lấy từ bảng mã lỗi của edit_video_info và post_video. */
        const phaiTaiLai = /video_upload_id is illegal|Invalid video source|no record in database|can not find video/i.test(msg)
        if (phaiTaiLai && tt.giaiDoan !== 'init') {
            tt.giaiDoan = 'init'
            delete tt.videoUploadId
            delete tt.coverUrl
            tt.phanXong = 0
            msg = `${msg} — phiên tải trên Shopee đã hết hạn, bấm "Tiếp tục đăng" để tải lại từ đầu.`
        }
        /* copyright_not_agree = "Not Agree Shopee videos Terms of Service" (bảng mã post_video).
         * Hướng dẫn tích hợp Shopee Video (open.shopee.com/developer-guide/706, mục 6, đọc
         * 09/10/2026): PHẢI đồng ý Điều khoản Shopee Video TRÊN SELLER CENTER trước mọi API
         * video. Đăng qua app điện thoại KHÔNG tính — chủ shop đã đăng 145+ video qua app,
         * không thấy ô tích nào, mà API vẫn chặn. Giữ nguyên tiến trình: đồng ý xong bấm
         * "Tiếp tục đăng" là gọi lại post_video, không tải lại video. */
        const chuaDongYDieuKhoan = /copyright_not_agree/i.test(msg)
        if (chuaDongYDieuKhoan) {
            const kenh = await prisma.onlineChannel.findUnique({ where: { id: m.channelId }, select: { name: true } }).catch(() => null)
            msg = `Shopee chưa ghi nhận đồng ý Điều khoản Shopee Video${kenh?.name ? ` của gian "${kenh.name}"` : ''}. `
                + 'Mở Seller Center bản WEB (banhang.shopee.vn) bằng tài khoản đã uỷ quyền Shopee Video (thường là tài khoản chính), '
                + 'vào mục Shopee Video và bấm đồng ý điều khoản — đăng qua app điện thoại không tính. Xong bấm "Tiếp tục đăng": '
                + 'video đã tải lên, không phải tải lại. [post_video: copyright_not_agree]'
        }
        await prisma.sanMedia.update({
            where: { id: m.id },
            data: { trangThai: 'loi', loiCuoi: msg, tienTrinhDang: JSON.stringify(tt) },
        }).catch(() => { /* ghi lỗi hỏng thì vẫn ném lỗi gốc */ })
        if (chuaDongYDieuKhoan) throw new Error(msg)
        throw e
    }
}

/* ─── GIỮ CHỖ CHẠY (11/10/2026) ───────────────────────────────────────────────
 * Từ khi có push của app Video (lib/pushShopeeVideo.ts), máy đăng có HAI người chạy: web
 * (người bấm Đăng, gọi lặp) và máy chủ (lượt thử lại của push 38 — đăng nốt khi web đã
 * đóng). Hai bản chạy song song là post_video hai lần. Khoá Redis không dùng được (prod
 * chạy bộ đệm trong bộ nhớ, mỗi bản máy một khoá riêng) nên giữ chỗ ngay trên DÒNG: ghi hạn
 * `dangChayDen` vào tienTrinhDang bằng so-và-ghi (updateMany theo đúng chuỗi cũ). Máy đăng
 * đọc tiến trình CÓ kèm hạn rồi ghi lại sau mỗi bước nên hạn còn suốt lượt; xong thì trả.
 * Chết giữa chừng thì hạn tự hết sau ngân sách + 60 giây. */
export type KetQuaChay =
    | (KetQuaBuoc & { banBan?: false })
    | { banBan: true; xong: false; conTiep: true; giaiDoan: GiaiDoan; tienTrinh: TienTrinh; thongDiep: string }

export async function chayBuocDangShopee(prisma: any, mediaId: string, nganSachMs: number, ai: 'web' | 'push' | 'hen'): Promise<KetQuaChay> {
    const banBan = (tt: TienTrinh): KetQuaChay => ({
        banBan: true, xong: false, conTiep: true, giaiDoan: tt.giaiDoan, tienTrinh: tt,
        thongDiep: String(tt.dangChayBoi || '').startsWith('push')
            ? 'Máy chủ đang tự đăng tiếp (Shopee đã báo chuyển mã xong) — đợi vài giây'
            : String(tt.dangChayBoi || '').startsWith('hen')
                ? 'Máy chủ đang tải video theo giờ hẹn — đợi vài giây'
                : 'Video này đang được đăng ở một cửa sổ khác — đợi lượt đó xong',
    })
    const m = await prisma.sanMedia.findUnique({ where: { id: mediaId }, select: { tienTrinhDang: true } })
    if (!m) throw new Error('Không có video này trong kho')
    const truoc: string | null = m.tienTrinhDang ?? null
    const tt = docTienTrinh(truoc)
    if (tt.dangChayDen && Date.parse(tt.dangChayDen) > Date.now()) return banBan(tt)

    const ma = `${ai}:${crypto.randomBytes(4).toString('hex')}`
    const giu: TienTrinh = { ...tt, dangChayDen: new Date(Date.now() + nganSachMs + 60_000).toISOString(), dangChayBoi: ma }
    /* Bản ghi KHÔNG phải của Shopee (TikTok / hỏng) thì docTienTrinh ra {init} — đừng ghi đè lên nó ở
     * bước giữ chỗ; buocDangShopee tự quyết như trước (bắt đầu lại từ init). */
    const laShopee = !truoc || (() => { try { const t = JSON.parse(truoc); return !t?.san || t.san === 'shopee' } catch { return false } })()
    if (laShopee) {
        const r = await prisma.sanMedia.updateMany({ where: { id: mediaId, tienTrinhDang: truoc }, data: { tienTrinhDang: JSON.stringify({ ...giu, san: 'shopee' }) } })
        if (r.count !== 1) return banBan({ ...tt, dangChayBoi: 'khac' })
    }
    try {
        return await buocDangShopee(prisma, mediaId, nganSachMs)
    } finally {
        await traCho(prisma, mediaId, ma)
    }
}

/** Trả chỗ — chỉ xoá hạn nếu vẫn là của mình (so-và-ghi, thử lại vài lần nếu vừa có ghi chen). */
async function traCho(prisma: any, id: string, ma: string): Promise<void> {
    for (let i = 0; i < 3; i++) {
        const m = await prisma.sanMedia.findUnique({ where: { id }, select: { tienTrinhDang: true } }).catch(() => null)
        if (!m?.tienTrinhDang) return
        let t: any
        try { t = JSON.parse(m.tienTrinhDang) } catch { return }
        if (t?.dangChayBoi !== ma) return
        delete t.dangChayDen; delete t.dangChayBoi
        const r = await prisma.sanMedia.updateMany({ where: { id, tienTrinhDang: m.tienTrinhDang }, data: { tienTrinhDang: JSON.stringify(t) } })
            .catch(() => ({ count: 0 }))
        if (r.count === 1) return
    }
}
