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
    /* Kéo mã hàng mới từ KiotViet lúc 0h (12/10/2026): ngoài 00:00–05:59 giờ VN thì về ngay. Trong cửa sổ
     * chạy NGAY TRONG request này để có CPU — lượt đêm bằng setInterval đo 4–7 tiếng vì bị hãm CPU. */
    try {
        const { nhipKeoMaMoi } = await import('../services/kiotvietMaMoi')
        ra.kvMaMoi = await nhipKeoMaMoi()
    } catch (e: any) { ra.kvMaMoi = 'loi: ' + (e?.message || e) }
    /* Hẹn giờ đăng video lên Shopee Video / TikTok (14/10/2026) — đứng TRƯỚC tác vụ AI (có thể chạy vài
     * phút) để video lên đúng giờ. Ngân sách 40 giây; video lớn tải qua nhiều nhịp. lib/henGioDangVideo.ts */
    try {
        const { nhipDangHenGio } = await import('../lib/henGioDangVideo')
        ra.henGioVideo = await nhipDangHenGio(40_000)
    } catch (e: any) { ra.henGioVideo = 'loi: ' + (e?.message || e) }
    try { ra.tacVuAi = (await quetTuNgoai()) ? 'xong' : 'bo-qua' } catch (e: any) { ra.tacVuAi = 'loi: ' + (e?.message || e) }
    /* Flash sale Shopee hàng đợi (15/10/2026): đẩy plan kế tiếp + đóng plan hết giờ mỗi 3 phút. setInterval cũ vẫn chạy bổ
     * sung ban ngày; giành plan trên dòng CSDL nên chạy đôi không đẩy trùng. cron/flashSaleScheduler.ts */
    if (new Date().getUTCMinutes() % 3 === 0) {
        try {
            const { nhipFlashSale } = await import('../cron/flashSaleScheduler')
            ra.flashSale = await nhipFlashSale()
        } catch (e: any) { ra.flashSale = 'loi: ' + (e?.message || e) }
    }
    /* Tự tạo video theo giờ (14/10/2026): video DỰNG trên trình duyệt (máy dựng = tab kengi.vn được chỉ định). Quá
     * giờ tạo 45 phút mà không máy nào xin việc ⇒ báo chuông một lần mỗi ngày. Mỗi 10 phút. lib/videoTuDong.ts */
    if (new Date().getUTCMinutes() % 10 === 5) {
        try {
            const { nhipNhacMayDung } = await import('../lib/videoTuDong')
            ra.mayDungVideo = await nhipNhacMayDung()
        } catch (e: any) { ra.mayDungVideo = 'loi: ' + (e?.message || e) }
    }
    /* Nhắc TikTok xác nhận đủ bằng chứng (09/10/2026) — mỗi 10 phút; mỗi giờ một tin / cửa hàng do dấu
     * trong thông báo lo. Chạy ở NHỊP NGOÀI để có CPU cả đêm (cpu-throttling). */
    /* "Lấy HĐ" theo lệnh /hoadon nhóm Zalo (18/10/2026): bật cho phiếu tạo SAU tin nhắn trong cùng ngày —
     * đơn HUTI về qua webhook KiotViet. Mỗi 5 phút, xét hôm nay + hôm qua. Xem lib/zaloNhom.ts. */
    if (new Date().getUTCMinutes() % 5 === 2) {
        try {
            const { nhipLayHoaDon } = await import('../lib/zaloNhom')
            ra.layHoaDon = await nhipLayHoaDon()
        } catch (e: any) { ra.layHoaDon = 'loi: ' + (e?.message || e) }
    }
    if (new Date().getUTCMinutes() % 10 === 0) {
        try { ra.nhacBangChungTikTok = (await nhacBangChungTuNgoai()) ? 'xong' : 'bo-qua' } catch (e: any) { ra.nhacBangChungTikTok = 'loi: ' + (e?.message || e) }
    }
    /* Push app Shopee Video (11/10/2026): lượt THỬ LẠI của push 38 là thứ đăng nốt video lên Shopee
     * (bìa, sản phẩm, post_video) khi web đã đóng — chạy ở nhịp ngoài để có CPU cả đêm. Quét RIÊNG
     * loại này, ngân sách 40 giây; quét chung vẫn ở hopThuWebhookCron. Xem lib/pushShopeeVideo.ts. */
    try {
        const { quetHopThu } = await import('../services/hopThuWebhook')
        await quetHopThu({ chiNenTang: 'shopee-video', nganSachMs: 40_000 })
        ra.pushVideo = 'xong'
    } catch (e: any) { ra.pushVideo = 'loi: ' + (e?.message || e) }
    res.json({ success: true, data: { ...ra, ms: Date.now() - batDau } })
})

export default router
