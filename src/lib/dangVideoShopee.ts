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

export type GiaiDoan = 'init' | 'parts' | 'complete' | 'processing' | 'cover' | 'edit' | 'post' | 'xong'

export interface TienTrinh {
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

function docTienTrinh(s?: string | null): TienTrinh {
    try {
        const t = s ? JSON.parse(s) : null
        return t && typeof t === 'object' && t.giaiDoan ? t : { giaiDoan: 'init' }
    } catch { return { giaiDoan: 'init' } }
}

async function luu(prisma: any, id: string, tt: TienTrinh, them?: Record<string, any>) {
    tt.capNhatLuc = new Date().toISOString()
    await prisma.sanMedia.update({ where: { id }, data: { tienTrinhDang: JSON.stringify(tt), ...(them || {}) } })
}

/** Một khối từ Drive theo Range — Drive hỗ trợ Range cho alt=media. */
async function docKhoiDrive(drive: any, fileId: string, tu: number, den: number): Promise<Uint8Array> {
    const r = await drive.files.get(
        { fileId, alt: 'media', supportsAllDrives: true },
        { responseType: 'arraybuffer', headers: { Range: `bytes=${tu}-${den}` } },
    )
    return new Uint8Array(r.data as ArrayBuffer)
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
            await luu(prisma, m.id, tt, { trangThai: 'cho_dang', loiCuoi: null, thoiLuongS: duration, bytes: fileSize })
        }

        // ── 2. PARTS ───────────────────────────────────────────────────────────
        if (tt.giaiDoan === 'parts') {
            const { drive } = await getStoreDriveWriter(prisma)
            while ((tt.phanXong ?? 0) < (tt.tongPhan ?? 0) && conGio()) {
                const i = tt.phanXong ?? 0
                const tu = i * (tt.partSize as number)
                const den = Math.min(tt.fileSize as number, tu + (tt.partSize as number)) - 1
                const khoi = await docKhoiDrive(drive, m.nguonId, tu, den)
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
                if (t > gio + 15 * 60_000 && t < gio + 30 * 86400_000) scheduled = { scheduled_post: true, scheduled_post_time: t }
                else ghi.push('Giờ hẹn ngoài khung 15 phút–30 ngày của Shopee → đăng ngay')
            }
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
                aigc_label: false,
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
            const daHen = !!m.henDangLuc && new Date(m.henDangLuc).getTime() > Date.now() + 15 * 60_000
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
        await prisma.sanMedia.update({
            where: { id: m.id },
            data: { trangThai: 'loi', loiCuoi: msg, tienTrinhDang: JSON.stringify(tt) },
        }).catch(() => { /* ghi lỗi hỏng thì vẫn ném lỗi gốc */ })
        throw e
    }
}
