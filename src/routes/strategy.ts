import express, { Response } from 'express'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { coHoiTangTruong } from '../lib/growthOpportunity'
import { keHoachDatHang } from '../lib/reorderPlan'

const router = express.Router()

const VN_OFFSET_MS = 7 * 60 * 60 * 1000

/**
 * GET /api/strategy/opportunity?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Bốn hướng chiến lược tính từ giao dịch thật: sỉ hay lẻ, combo bán kèm, dồn
 * lực hay trải rộng, và nhịp mùa vụ. Cùng một cỗ máy với tool MCP
 * `growth_opportunity` — web và trợ lý AI phải nói cùng một con số, nếu không
 * người dùng sẽ không biết tin bên nào.
 *
 * Tham số tuỳ chọn:
 *   tyLeChuyenDoi   0.01–1   giả định bao nhiêu phần khách sẽ mua thêm món kèm
 *   nguongSoLuongSi ≥2       mua từ bao nhiêu đơn vị trở lên thì coi là đơn sỉ
 */
router.get('/opportunity', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const q = req.query as any

        const docNgay = (v: any, cuoiNgay: boolean): Date | null => {
            const s = String(v || '').slice(0, 10)
            if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
            const t = new Date(`${s}T${cuoiNgay ? '23:59:59' : '00:00:00'}+07:00`)
            return isNaN(t.getTime()) ? null : t
        }

        const den = docNgay(q.to, true) || new Date()
        const tu = docNgay(q.from, false) || new Date(den.getTime() - 90 * 86400_000)
        if (tu > den) {
            return res.status(400).json({ success: false, error: 'Ngày bắt đầu phải trước ngày kết thúc' })
        }

        const nhan = (d: Date) => new Date(d.getTime() + VN_OFFSET_MS).toISOString().slice(0, 10)
        const kq = await coHoiTangTruong(
            prisma,
            { tu, den, moTa: `${nhan(tu)} → ${nhan(den)} (giờ VN)` },
            {
                tyLeChuyenDoi: q.tyLeChuyenDoi !== undefined ? Number(q.tyLeChuyenDoi) : undefined,
                nguongSoLuongSi: q.nguongSoLuongSi !== undefined ? Number(q.nguongSoLuongSi) : undefined,
            },
        )
        res.json({ success: true, data: kq })
    } catch (err) {
        console.error('GET /strategy/opportunity error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

/**
 * GET /api/strategy/reorder
 *
 * Điểm đặt hàng tính từ sức bán thật + độ dao động + thời gian chờ đo được từ
 * lịch sử đặt hàng, thay cho ô "tồn tối thiểu" gõ tay.
 *
 * Tham số tuỳ chọn:
 *   soNgayLichSu     14–365  cửa sổ đo sức bán (mặc định 90)
 *   mucPhucVu        0.8–0.99 muốn bao nhiêu phần lần đặt không bị hụt (mặc định 0.95)
 *   soNgayChoMacDinh 1–90    dùng khi chưa đủ lịch sử của nhà cung cấp (mặc định 7)
 *   chuKyDat         1–60    bao lâu đặt hàng một lần (mặc định 7)
 */
router.get('/reorder', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const q = req.query as any
        const soHoacUndefined = (v: any) => (v === undefined || v === '' ? undefined : Number(v))
        const kq = await keHoachDatHang(prisma, {
            soNgayLichSu: soHoacUndefined(q.soNgayLichSu),
            mucPhucVu: soHoacUndefined(q.mucPhucVu),
            soNgayChoMacDinh: soHoacUndefined(q.soNgayChoMacDinh),
            chuKyDat: soHoacUndefined(q.chuKyDat),
            soMaToiDa: soHoacUndefined(q.soMaToiDa),
        })
        res.json({ success: true, data: kq })
    } catch (err) {
        console.error('GET /strategy/reorder error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

export default router
