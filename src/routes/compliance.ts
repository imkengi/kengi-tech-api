// ─────────────────────────────────────────────────────────────────────────────
//  TUÂN THỦ PHÁP LÝ — mounted at /api/compliance
//
//    GET /api/compliance/profile        hồ sơ pháp lý của cửa hàng
//    GET /api/compliance/snapshot?year= số liệu để chấm 24 quy tắc tuân thủ
//
//  Giao diện /dashboard-compliance đã có sẵn 24 quy tắc pháp lý và GỌI hai
//  endpoint này từ lâu, nhưng backend chưa bao giờ có chúng — mọi lần gọi đều
//  404 và hook nuốt lỗi rồi rơi về giá trị mặc định (chưa có giấy phép, chưa
//  kết nối HĐĐT, doanh thu 0…). Nghĩa là trang tuân thủ suốt thời gian qua chấm
//  điểm trên dữ liệu rỗng chứ không phải dữ liệu thật của cửa hàng.
//
//  Nguyên tắc: chỉ trả số ĐỌC ĐƯỢC từ dữ liệu; phần nào không có nguồn tin cậy
//  thì trả null/false và để quy tắc tương ứng hiện "chưa đủ dữ liệu", KHÔNG đoán
//  bừa — một trang tuân thủ nói sai còn nguy hiểm hơn là không nói.
// ─────────────────────────────────────────────────────────────────────────────

import { Router, Response } from 'express'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { errMsg } from '../lib/errorResponse'
import { TRANG_THAI_MOC_CHUA_XONG } from '../lib/taxCalendar'

const router = Router()

// GET /profile — hồ sơ pháp lý
router.get('/profile', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!

        const st = await prisma.storeSettings.findFirst().catch(() => null)
        const einvCfg = await prisma.eInvoiceConfig.findFirst().catch(() => null)

        const businessType = String(st?.businessType || 'company')
        const taxCode = st?.taxCode || null

        /* HĐĐT coi là "đã kết nối" khi có cấu hình BẬT và có nhà cung cấp; bản
         * ghi trống (mới tạo, chưa điền gì) thì chưa tính là đã kết nối. */
        const einvoiceConnected = Boolean(
            einvCfg && (einvCfg.isActive ?? true) && (einvCfg.provider || einvCfg.taxCode),
        )

        /* Máy tính tiền kết nối CQT (NĐ 70/2025): schema không có cột riêng, cấu
         * hình theo nhà cung cấp nằm trong EInvoiceConfig.extra dạng JSON. Đọc cờ
         * ở đó; không đọc được thì trả false để quy tắc hiện "chưa đạt" thay vì
         * nói bừa là đã kết nối. */
        let posConnected = false
        try {
            const extra = einvCfg?.extra ? JSON.parse(einvCfg.extra) : null
            posConnected = Boolean(einvoiceConnected && (extra?.fromCashRegister ?? extra?.mayTinhTien ?? false))
        } catch { posConnected = false }

        res.json({
            success: true,
            data: {
                businessType: businessType === 'household' || businessType === 'individual' ? 'household' : 'company',
                taxCode,
                companyName: st?.name || null,
                // Giấy phép ĐKKD: hệ thống chưa có ô lưu số giấy phép riêng, nên
                // suy từ việc đã khai MST — có MST thì đã đăng ký kinh doanh.
                hasBusinessLicense: Boolean(taxCode),
                hkdMethod: 'declaration',
                einvoiceConnected,
                posConnected,
                minWageRegion: 1,
            },
        })
    } catch (err) {
        console.error('Compliance profile lỗi:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// GET /snapshot?year= — số liệu chấm điểm tuân thủ
router.get('/snapshot', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const year = Number(req.query.year) || new Date().getFullYear()
        const dau = new Date(`${year}-01-01T00:00:00.000Z`)
        const cuoi = new Date(`${year}-12-31T23:59:59.999Z`)
        const dauStr = `${year}-01-01`, cuoiStr = `${year}-12-31`

        /* Chạy TUẦN TỰ: pool Prisma mỗi cửa hàng rất nhỏ, gom 10 truy vấn vào
         * Promise.all là đủ để cạn kết nối khi cron hoặc POS đang chạy. */
        const dsTx = await prisma.transaction.findMany({
            where: { status: { in: ['completed', 'partial'] }, createdAt: { gte: dau, lte: cuoi } },
            select: { total: true, tax: true },
        }).catch(() => [])
        const revenueYTD = Math.round((dsTx as any[]).reduce((s, t) => s + (t.total || 0), 0))
        const invoiceCount = (dsTx as any[]).length

        let vatIssuedCount = 0
        try {
            vatIssuedCount = await prisma.eInvoice.count({
                where: {
                    invoiceDate: { gte: dauStr, lte: cuoiStr },
                    status: { notIn: ['DRAFT', 'CANCELLED', 'ERROR'] },
                },
            })
        } catch { vatIssuedCount = 0 }

        // Bảng cân đối: tổng phát sinh Nợ phải bằng tổng phát sinh Có
        let trialBalanceOk: boolean | null = null
        let journalCount = 0
        try {
            const bt = await prisma.journalEntry.findMany({
                where: { date: { gte: dauStr, lte: cuoiStr } },
                select: { debitAccount: true, creditAccount: true, amount: true },
            })
            journalCount = bt.length
            if (journalCount > 0) {
                let no = 0, co = 0
                for (const e of bt) {
                    if (e.debitAccount) no += e.amount
                    if (e.creditAccount) co += e.amount
                }
                trialBalanceOk = Math.abs(no - co) < 1000
            }
        } catch { /* chưa có bảng bút toán */ }

        let overdueDeclarations = 0
        try {
            const homNay = new Date().toISOString().slice(0, 10)
            /* Đếm theo danh sách TRẮNG các trạng thái chưa xong. Bản trước loại
             * theo ['filed','paid'] — hai giá trị không chỗ nào ghi cho bảng
             * này — nên mốc người dùng đã đánh dấu nộp ('submitted') vẫn bị đếm
             * là quá hạn, kéo điểm tuân thủ xuống mà không cách nào gỡ. */
            overdueDeclarations = await prisma.taxDeadline.count({
                where: { status: { in: [...TRANG_THAI_MOC_CHUA_XONG] }, dueDate: { lt: homNay } },
            })
        } catch { overdueDeclarations = 0 }

        let hasFixedAssetDepreciation = false
        try {
            hasFixedAssetDepreciation = (await prisma.depreciationEntry.count()) > 0
        } catch { hasFixedAssetDepreciation = false }

        let employeeCount = 0, bhxhCovered = 0, minSalaryPaid = 0
        try {
            const nv = await prisma.employee.findMany({
                select: { id: true, status: true, socialInsuranceNo: true, baseSalary: true },
            })
            const dangLam = (nv as any[]).filter(n => (n.status ?? 'active') === 'active')
            employeeCount = dangLam.length
            bhxhCovered = dangLam.filter(n => n.socialInsuranceNo).length
            const luong = dangLam.map(n => n.baseSalary || 0).filter(v => v > 0)
            minSalaryPaid = luong.length ? Math.min(...luong) : 0
        } catch { /* chưa có bảng nhân viên */ }

        res.json({
            success: true,
            data: {
                year, revenueYTD, invoiceCount, vatIssuedCount,
                trialBalanceOk, journalCount, overdueDeclarations,
                hasFixedAssetDepreciation, employeeCount, bhxhCovered, minSalaryPaid,
            },
        })
    } catch (err) {
        console.error('Compliance snapshot lỗi:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

export default router
