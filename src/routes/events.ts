// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/events — ĐÃ GỠ SSE (02/09/2026)
//
// VÌ SAO GỠ: Cloud Run tính tiền theo thời gian request còn mở, nên mỗi kết nối
// SSE = một instance bị tính tiền suốt thời gian đó. Đo 30 ngày (02/09/2026):
// endpoint này + /api/notifications/stream chiếm 98% số giây tính tiền của cả
// service (~2 triệu VND/tháng), trong khi không có màn hình nào ở FE đọc nó nữa
// và broadcast in-process vốn đã không đáng tin trên nhiều instance.
//
// THAY BẰNG: FE poll GET /api/notifications (15 giây/lần, có cache 15 giây ở
// máy chủ), app Android dùng FCM push. Mọi sự kiện đều đã được ghi bền vào bảng
// Notification trước khi đẩy, nên poll không mất tin nào.
//
// KHÔNG XOÁ HẲN ROUTE: tab kengi.vn cũ mở nhiều ngày vẫn chạy bundle cũ và sẽ
// còn nối lại dài dài. Trả 410 TỨC THÌ (không auth, không chạm DB) để mỗi lần
// nối chỉ tốn vài mili giây thay vì giữ máy chủ 300 giây.
// ═══════════════════════════════════════════════════════════════════════════════

import { Router, Request, Response } from 'express'

const router = Router()

router.get('/', (_req: Request, res: Response) => {
    res.status(410).json({
        success: false,
        error: 'Kênh realtime đã gỡ. Dùng GET /api/notifications (poll) hoặc FCM push.',
    })
})

export default router
