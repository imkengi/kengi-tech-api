/**
 * BỘ ĐĂNG FACEBOOK — Marketing Studio, 05/09/2026
 * Chuyển từ nhánh `p === "facebook"` trong marketing/providers.js.
 *
 * Ba đường khác nhau, KHÔNG gộp được:
 *   · chỉ chữ / có link → POST /{page}/feed     — xong ngay, một nhịp
 *   · có ảnh           → POST /{page}/photos    — xong ngay, một nhịp
 *   · có video         → POST /{page}/videos    — HAI NHỊP: gửi xong Facebook
 *     còn phải mã hoá video, phải hỏi lại tới khi `video_status = ready`.
 *
 * Video là chỗ bắt buộc phải có checkpoint: id video được ghi NGAY sau khi
 * Facebook cấp, TRƯỚC khi ta đi hỏi trạng thái. Chết giữa hai bước mà không ghi
 * thì lần chạy sau tải video lên LẦN NỮA — hai video trên trang khách hàng.
 *
 * Video còn phải đi qua tên miền `graph-video.facebook.com`, không phải
 * `graph.facebook.com` — gửi nhầm miền là hỏng mà thông báo lỗi không nói vì sao.
 */
import { goiNenTang, LoiNenTang } from '../lib/mktLoiNenTang'
import type { NenTang } from './mktDangBai'

const PHIEN_BAN = process.env.FB_GRAPH_VERSION || 'v21.0'
const GOC = `https://graph.facebook.com/${PHIEN_BAN}`
const GOC_VIDEO = `https://graph-video.facebook.com/${PHIEN_BAN}`

export const nenTangFacebook: NenTang = {
    async dang(taiKhoan, token, bai, moc, luuMoc) {
        const anh = (bai.assets || []).find((a: any) => a?.type === 'image')
        const video = (bai.assets || []).find((a: any) => a?.type === 'video')

        // ── Nhịp 2 của đường video: đã có id, chỉ đi hỏi đã mã hoá xong chưa ──
        if (moc) {
            /* `chiDoc: true` — đây là lời gọi HỎI, không đổi gì phía Facebook. Nhờ
             * cờ này mà đứt mạng ở đây được coi là "thử lại được", không phải "mơ hồ". */
            const d = await goiNenTang(
                `${GOC}/${moc}?fields=status,permalink_url`, token, { chiDoc: true }
            )
            const tt = d?.status?.video_status
            if (tt === 'error') {
                throw new LoiNenTang('Facebook mã hoá video thất bại. Kiểm tra định dạng video.', { code: 'VIDEO_FAILED' })
            }
            if (tt !== 'ready') {
                /* Chưa xong thì để lượt worker sau hỏi tiếp — KHÔNG gửi lại video. */
                throw new LoiNenTang('Facebook đang xử lý video, chưa xong.', {
                    code: 'DANG_XU_LY', thuLaiDuoc: true, choGiay: 60,
                })
            }
            return { remotePostId: String(moc), remoteRef: String(moc) }
        }

        // ── Nhịp 1: gửi bài ──
        const duoi = video ? '/videos' : anh ? '/photos' : '/feed'
        const than: any = video
            ? { file_url: video.url, description: bai.body, published: true }
            : anh
                ? { url: anh.url, caption: bai.body, published: true }
                : { message: bai.body, ...(bai.linkUrl ? { link: bai.linkUrl } : {}) }

        const url = `${video ? GOC_VIDEO : GOC}/${taiKhoan.externalId}${duoi}`
        const d = await goiNenTang(url, token, { method: 'POST', body: than })

        const id = d?.post_id || d?.id
        if (!id) {
            /* Facebook trả 200 mà không có id — KHÔNG coi là thành công. Nhưng cũng
             * không chắc là thất bại: bài có thể đã lên mà ta không nhận được id.
             * Đánh mơ hồ để người vào xem, đừng tự gửi lại. */
            throw new LoiNenTang('Facebook không trả về ID bài dù báo thành công.', {
                code: 'KHONG_CO_ID', moHo: true,
            })
        }

        if (video) {
            /* ⛔ GHI CHECKPOINT NGAY. Xem đầu file. */
            await luuMoc(String(id))
            throw new LoiNenTang('Đã tải video lên, Facebook đang mã hoá.', {
                code: 'DANG_XU_LY', thuLaiDuoc: true, choGiay: 60,
            })
        }

        return { remotePostId: String(id) }
    },
}
