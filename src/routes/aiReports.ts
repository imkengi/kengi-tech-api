import express, { Response } from 'express'
import { authMiddleware, AuthRequest } from '../middleware/auth'

const router = express.Router()

/**
 * BẢN PHÂN TÍCH AI ĐÃ LƯU.
 *
 * Mỗi lượt chạy trợ lý AI tốn 30–60 giây chờ và tốn hạn mức Gemini của chính
 * cửa hàng. Trước đây kết quả chỉ nằm trong bộ nhớ trình duyệt: đổi tab, bấm F5,
 * hay mở trên máy khác là mất — và người dùng phải chạy lại từ đầu.
 *
 * Bảng này giữ lại để đọc lại, so hai kỳ với nhau, và in ra cho kế toán.
 *
 * Không có sửa nội dung: bản phân tích là ảnh chụp tại một thời điểm với một bộ
 * số cụ thể. Cho sửa thì nó không còn là ảnh chụp nữa, và người đọc sau sẽ không
 * biết phần nào do AI viết, phần nào do người sửa vào.
 */

const CHUA_CO_BANG = 'chua-co-bang'

/** Store cũ chưa chạy migrate thì bảng chưa tồn tại — nói rõ thay vì trả 500. */
function laThieuBang(e: any): boolean {
    const m = String(e?.message || e)
    return /does not exist|P2021|P2022|Unknown arg/i.test(m)
}

/**
 * GET /api/ai-reports?loai=chien-luoc&limit=20
 * Danh sách rút gọn — KHÔNG kèm nội dung đầy đủ, vì mỗi bản ghi nhớ dài vài
 * nghìn ký tự và danh sách 20 bản sẽ nặng vô ích.
 */
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma! as any
        const q = req.query as any
        const where: any = {}
        if (q.loai) where.loai = String(q.loai)

        const ds = await prisma.aiReport.findMany({
            where,
            select: {
                id: true, loai: true, ky: true, tuNgay: true, denNgay: true,
                tieuDe: true, createdAt: true, createdByName: true,
            },
            orderBy: { createdAt: 'desc' },
            take: Math.min(100, Math.max(1, Number(q.limit) || 20)),
        })
        res.json({ success: true, data: ds })
    } catch (err: any) {
        if (laThieuBang(err)) return res.json({ success: true, data: [], warning: CHUA_CO_BANG })
        console.error('GET /ai-reports error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

/** GET /api/ai-reports/:id — bản đầy đủ */
router.get('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma! as any
        const bao = await prisma.aiReport.findUnique({ where: { id: String(req.params.id) } })
        if (!bao) return res.status(404).json({ success: false, error: 'Không tìm thấy bản phân tích' })
        res.json({ success: true, data: bao })
    } catch (err: any) {
        if (laThieuBang(err)) return res.status(404).json({ success: false, error: 'Chưa có bảng lưu bản phân tích' })
        console.error('GET /ai-reports/:id error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

/** POST /api/ai-reports — lưu một bản vừa chạy xong */
router.post('/', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma! as any
        const b = req.body || {}
        const noiDung = String(b.noiDung || '').trim()
        if (!noiDung) return res.status(400).json({ success: false, error: 'Thiếu nội dung bản phân tích' })

        const bao = await prisma.aiReport.create({
            data: {
                loai: String(b.loai || 'khac').slice(0, 40),
                ky: String(b.ky || '').slice(0, 120),
                tuNgay: b.tuNgay ? String(b.tuNgay).slice(0, 10) : null,
                denNgay: b.denNgay ? String(b.denNgay).slice(0, 10) : null,
                tieuDe: String(b.tieuDe || 'Bản phân tích AI').slice(0, 200),
                /* Cắt ở 60.000 ký tự: dài hơn thế gần như chắc chắn là lỗi phía
                 * gọi, và một bản ghi khổng lồ sẽ làm chậm mọi truy vấn sau. */
                noiDung: noiDung.slice(0, 60_000),
                toolCalls: Array.isArray(b.toolCalls) ? JSON.stringify(b.toolCalls.slice(0, 40)) : null,
                createdBy: req.user?.userId || null,
                createdByName: req.user?.email || null,
                branchId: (req as any).branchId || null,
            },
            select: { id: true, createdAt: true },
        })
        res.json({ success: true, data: bao })
    } catch (err: any) {
        if (laThieuBang(err)) {
            /* Không chặn người dùng: bản phân tích vẫn đang hiện trên màn hình,
             * chỉ là chưa lưu được. Nói rõ để họ biết chạy /admin/migrate. */
            return res.status(200).json({ success: false, error: 'Chưa có bảng lưu bản phân tích — chạy migrate rồi thử lại', warning: CHUA_CO_BANG })
        }
        console.error('POST /ai-reports error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

/** DELETE /api/ai-reports/:id */
router.delete('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma! as any
        await prisma.aiReport.delete({ where: { id: String(req.params.id) } })
        res.json({ success: true })
    } catch (err: any) {
        if (laThieuBang(err)) return res.status(404).json({ success: false, error: 'Không tìm thấy bản phân tích' })
        console.error('DELETE /ai-reports/:id error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

export default router
