/**
 * NHỊP NGOÀI cho việc chạy nền — Cloud Scheduler gọi POST /api/cron/tick mỗi phút
 * (30/09/2026, chủ shop chọn "cách 1").
 *
 * Vì sao: Cloud Run chạy cpu-throttling=true + min-instances 0 ⇒ setInterval trong tiến
 * trình CHỈ có CPU khi đang có request. Không ai dùng kengi.vn (tối muộn, 7 giờ sáng) là
 * worker đăng bài + tác vụ AI đứng im, kết nối DB nền rớt (>1.000 lỗi P1001 trong 24 giờ
 * đo 30/09). Việc chạy TRONG request này thì có CPU và kết nối.
 *
 * setInterval cũ vẫn để nguyên (ban ngày đông khách vẫn chạy bổ sung) — không đúp vì worker
 * giữ lease từng lượt đăng, tác vụ AI giành việc nguyên tử (aiAgentCron.gianhJob).
 *
 * Khoá: header x-cron-key = HMAC-SHA256(ADMIN_KEY, "kengi-cron-tick-v1"). Không thêm secret
 * mới, và cấu hình Cloud Scheduler KHÔNG chứa ADMIN_KEY thật — lộ khoá này cũng chỉ gọi
 * được nhịp (việc máy chủ vốn tự làm), không vào được route quản trị.
 */
import { Router, Request, Response } from 'express'
import { createHmac, timingSafeEqual } from 'crypto'
import { nhipMktTuNgoai } from '../cron/mktWorker'
import { quetTuNgoai } from '../cron/aiAgentCron'
import { nhacBangChungTuNgoai } from '../cron/nhacBangChungTikTokCron'

const router = Router()

export const khoaNhip = (adminKey: string) => createHmac('sha256', adminKey).update('kengi-cron-tick-v1').digest('hex')

function dungKhoa(gui: unknown): boolean {
    const adminKey = process.env.ADMIN_KEY || ''
    if (!adminKey || typeof gui !== 'string' || !gui) return false
    const a = Buffer.from(gui), b = Buffer.from(khoaNhip(adminKey))
    return a.length === b.length && timingSafeEqual(a, b)
}

router.post('/tick', async (req: Request, res: Response) => {
    if (!dungKhoa(req.headers['x-cron-key'])) {
        res.status(401).json({ success: false, error: 'Sai khoá nhịp' })
        return
    }
    const batDau = Date.now()
    const ra: Record<string, string> = {}
    /* Đăng bài trước (nhanh, có giờ hẹn), tác vụ AI sau (có thể vài phút). Một phần hỏng
     * không chặn phần kia. */
    try { ra.dangBai = await nhipMktTuNgoai() } catch (e: any) { ra.dangBai = 'loi: ' + (e?.message || e) }
    try { ra.tacVuAi = (await quetTuNgoai()) ? 'xong' : 'bo-qua' } catch (e: any) { ra.tacVuAi = 'loi: ' + (e?.message || e) }
    /* Nhắc TikTok xác nhận đủ bằng chứng (09/10/2026) — mỗi 10 phút; mỗi giờ một tin / cửa hàng do dấu
     * trong thông báo lo. Chạy ở NHỊP NGOÀI để có CPU cả đêm (cpu-throttling). */
    if (new Date().getUTCMinutes() % 10 === 0) {
        try { ra.nhacBangChungTikTok = (await nhacBangChungTuNgoai()) ? 'xong' : 'bo-qua' } catch (e: any) { ra.nhacBangChungTikTok = 'loi: ' + (e?.message || e) }
    }
    res.json({ success: true, data: { ...ra, ms: Date.now() - batDau } })
})

export default router
