// ─────────────────────────────────────────────────────────────────────────────
//  KIỂM TRA TRƯỚC THANH TRA THUẾ — mounted at /api/tax
//
//    GET /api/tax/audit-check?year=&month=|quarter=
//
//  Soi dữ liệu của cửa hàng theo đúng cách đoàn thanh tra soi: đối chiếu ba
//  nguồn doanh thu (sổ / tờ khai / hóa đơn điện tử), tìm dấu hiệu bị ấn định
//  thuế và những khoản sẽ bị loại khi quyết toán.
//
//  Mount SAU router tax.ts chính; đường dẫn /audit-check không trùng với bất kỳ
//  path nào của tax.ts nên không che nhau.
// ─────────────────────────────────────────────────────────────────────────────

import { Router, Response } from 'express'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { errMsg } from '../lib/errorResponse'
import { kiemTraThue, type KhoangKy } from '../lib/taxAudit'

const router = Router()

const p2 = (n: number) => String(n).padStart(2, '0')

/** Dựng khoảng kỳ + mã kỳ khớp với cách TaxDeclaration.period được lưu */
function dungKy(q: any): KhoangKy {
    const nay = new Date()
    const year = Number(q.year) || nay.getFullYear()
    const month = q.month ? Number(q.month) : undefined
    const quarter = q.quarter ? Number(q.quarter) : undefined

    if (month) {
        const cuoi = new Date(year, month, 0).getDate()
        const from = `${year}-${p2(month)}-01`
        const to = `${year}-${p2(month)}-${p2(cuoi)}`
        return {
            from, to,
            start: new Date(`${from}T00:00:00.000Z`),
            // +7h để lấy trọn ngày cuối theo giờ VN
            end: new Date(new Date(`${to}T23:59:59.999Z`).getTime() + 7 * 3600 * 1000),
            maKy: `${year}-${p2(month)}`,
            nhan: `tháng ${month}/${year}`,
        }
    }
    if (quarter) {
        const dauThang = (quarter - 1) * 3 + 1
        const cuoiThang = dauThang + 2
        const cuoi = new Date(year, cuoiThang, 0).getDate()
        const from = `${year}-${p2(dauThang)}-01`
        const to = `${year}-${p2(cuoiThang)}-${p2(cuoi)}`
        return {
            from, to,
            start: new Date(`${from}T00:00:00.000Z`),
            end: new Date(new Date(`${to}T23:59:59.999Z`).getTime() + 7 * 3600 * 1000),
            maKy: `${year}-Q${quarter}`,
            nhan: `quý ${quarter}/${year}`,
        }
    }
    const from = `${year}-01-01`, to = `${year}-12-31`
    return {
        from, to,
        start: new Date(`${from}T00:00:00.000Z`),
        end: new Date(new Date(`${to}T23:59:59.999Z`).getTime() + 7 * 3600 * 1000),
        maKy: `${year}`,
        nhan: `năm ${year}`,
    }
}

router.get('/audit-check', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const data = await kiemTraThue(prisma, dungKy(req.query))
        res.json({ success: true, data })
    } catch (err) {
        console.error('Kiểm tra trước thanh tra thuế lỗi:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

export default router
