/**
 * GET /api/online-orders/kiem-lai?from=YYYY-MM-DD&to=YYYY-MM-DD&channelId=&chiVanDe=1 — KIỂM LẠI ĐƠN SÀN (29/10/2026)
 *
 * Chế độ "double-check" chủ shop xin: soát từng đơn qua cả vòng đời (phiếu bán → phí sàn → hoá đơn điện tử → trả hàng → hoàn
 * tất), lõi ở lib/kiemLaiDonSan.ts. CHỈ ĐỌC — mọi việc sửa đi qua các nút sẵn có (Chuyển lại đơn, Đồng bộ phí, Hàng đợi xuất
 * HĐ, Cần điều chỉnh, Đồng bộ trả hàng). Mount TRƯỚC router /api/online-orders để `/kiem-lai` không bị `/:id` của router kia
 * nuốt. Tối đa 92 ngày một lần; mặc định 30 ngày gần nhất (ngày VN).
 */

import { Router, Response } from 'express'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { requirePermission } from '../middleware/permissionMiddleware'
import { errMsg } from '../lib/errorResponse'
import { ngayVN } from '../lib/vnTime'
import { kiemLaiDonSan } from '../lib/kiemLaiDonSan'

const router = Router()
const NGAY = /^\d{4}-\d{2}-\d{2}$/
const TOI_DA_NGAY = 92

router.get('/kiem-lai', authMiddleware, requirePermission('online_orders.view', 'orders.view'), async (req: AuthRequest, res: Response) => {
    try {
        const q = req.query as Record<string, any>
        const to = NGAY.test(String(q.to || '')) ? String(q.to) : ngayVN(new Date())
        const from = NGAY.test(String(q.from || '')) ? String(q.from) : ngayVN(new Date(Date.now() - 30 * 86400_000))
        const tu = new Date(`${from}T00:00:00+07:00`), den = new Date(`${to}T23:59:59.999+07:00`)
        if (isNaN(tu.getTime()) || isNaN(den.getTime()) || tu > den) { res.status(400).json({ success: false, error: 'Khoảng ngày không hợp lệ' }); return }
        if (den.getTime() - tu.getTime() > TOI_DA_NGAY * 86400_000) { res.status(400).json({ success: false, error: `Kiểm tối đa ${TOI_DA_NGAY} ngày một lần` }); return }
        const kq = await kiemLaiDonSan(req.storePrisma as any, {
            tu, den, channelId: q.channelId ? String(q.channelId) : null, chiVanDe: String(q.chiVanDe || '') === '1',
        })
        res.json({ success: true, data: { ...kq, from, to } })
    } catch (e: any) {
        console.error('[kiem-lai-don-san]', e?.message || e)
        res.status(500).json({ success: false, error: errMsg(e) })
    }
})

export default router
