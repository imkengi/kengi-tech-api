// ═════════════════════════════════════════════════════════════════════════════
//  BÁO CÁO TÀI CHÍNH — /api/reports  (màn Kế Toán trên web)
//
//    GET /api/reports/balance-sheet     B01-DNN  Bảng cân đối kế toán
//    GET /api/reports/income-statement  B02-DNN  Kết quả hoạt động kinh doanh
//    GET /api/reports/cash-flow         B03-DNN  Lưu chuyển tiền tệ
//
//  File này CHỈ còn việc nhận tham số và đóng gói kết quả. Toàn bộ phép tính nằm
//  ở lib/baoCaoTaiChinh.ts — dùng chung với /api/tax/* (màn Thuế) và với các tool
//  MCP của trợ lý AI. Trước 03/09/2026 mỗi nơi tự tính một kiểu nên hai màn hình
//  ra hai tổng tài sản khác nhau cho cùng một cửa hàng.
//
//  ĐỪNG tính lại gì ở đây. Muốn đổi cách gom tài khoản thì sửa lib.
// ═════════════════════════════════════════════════════════════════════════════

import { Router, Response } from 'express'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { errMsg } from '../lib/errorResponse'
import { tinhB01, tinhB02, tinhB03, luiNam, type DongB01, type SoB02 } from '../lib/baoCaoTaiChinh'

const router = Router()

const homNay = () => new Date().toISOString().slice(0, 10)
const laThat = (v: any) => v === true || v === 'true' || v === '1'
const ngayCua = (v: any, mac: string) => (v ? String(v).slice(0, 10) : mac)

/** Dòng của lib → hình dạng mà web đang đọc ({code, name, currentPeriod, previousPeriod}) */
const raDong = (r: DongB01) => ({
    code: r.ma,
    name: r.ten,
    currentPeriod: r.kyNay,
    previousPeriod: r.kyTruoc,
})

// ═════════════════════════════════════════════════════════════════════════════
//  B01-DNN — Bảng cân đối kế toán
//  GET /api/reports/balance-sheet?date=YYYY-MM-DD&comparePreviousYear=true
// ═════════════════════════════════════════════════════════════════════════════

router.get('/balance-sheet', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const reportDate = ngayCua(req.query.date, homNay())
        const compare = laThat(req.query.comparePreviousYear)
        const b = await tinhB01(req.storePrisma!, { ngay: reportDate, soSanh: compare })

        res.json({
            success: true,
            data: {
                form: 'B01-DNN',
                title: 'Bảng cân đối kế toán',
                reportDate,
                comparePreviousYear: compare,
                previousDate: b.ngayTruoc,
                sections: {
                    shortTermAssets: b.taiSanNganHan.map(raDong),
                    longTermAssets: b.taiSanDaiHan.map(raDong),
                    liabilities: b.noPhaiTra.map(raDong),
                    equity: b.vonChuSoHuu.map(raDong),
                    /* Tài khoản ngoài nhóm 1–8 (911 đang treo, mã lạ). Bản cũ lọc
                     * theo danh sách trắng nên chúng biến mất im lặng — nay trả về
                     * để màn hình nói được là còn tiền nằm ở đó. */
                    unclassified: b.khongPhanLoai.map(raDong),
                },
                totals: {
                    totalShortTermAssets: b.tongTaiSanNganHan,
                    totalLongTermAssets: b.tongTaiSanDaiHan,
                    totalAssets: b.tongTaiSan,
                    totalLiabilities: b.tongNoPhaiTra,
                    totalEquity: b.tongVonChuSoHuu,
                    totalResources: b.tongNguonVon,
                    totalUnclassified: b.tongKhongPhanLoai,
                    ...(compare ? {
                        totalAssetsPrevious: b.tongTaiSanTruoc,
                        totalLiabilitiesPrevious: b.tongNoPhaiTraTruoc,
                        totalEquityPrevious: b.tongVonChuSoHuuTruoc,
                    } : {}),
                },
                /* isBalanced = sổ có THẬT SỰ cân không, sau khi đã trừ phần giải
                 * thích được (lãi chưa kết chuyển, TK treo). Không phải phép so
                 * "tổng tài sản = tổng nguồn vốn" — phép đó luôn đúng khi có số bù. */
                isBalanced: b.canDoi,
                retainedNotClosed: b.loiNhuanChuaKetChuyen,
                displayGap: b.lechTrinhBay,
                unexplainedGap: b.lechKhongGiaiThichDuoc,
                imbalanceNote: b.giaiThichLech,
                readable: b.docDuoc,
                journalRows: b.soDong,
            },
        })
    } catch (err: any) {
        console.error('GET /reports/balance-sheet error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// ═════════════════════════════════════════════════════════════════════════════
//  B02-DNN — Báo cáo kết quả hoạt động kinh doanh
//  GET /api/reports/income-statement?from=&to=&comparePreviousYear=true
// ═════════════════════════════════════════════════════════════════════════════

/** Chỉ tiêu B02 theo mẫu Thông tư — mã số, tên, TK gốc, khoá lấy số trong lib */
const CHI_TIEU_B02: { code: string; name: string; account: string; key: keyof SoB02 }[] = [
    { code: '01', name: 'Doanh thu bán hàng và cung cấp dịch vụ', account: '511', key: 'doanhThu' },
    { code: '02', name: 'Các khoản giảm trừ doanh thu', account: '521', key: 'giamTruDoanhThu' },
    { code: '10', name: 'Doanh thu thuần về bán hàng và CCDV', account: '', key: 'doanhThuThuan' },
    { code: '11', name: 'Giá vốn hàng bán', account: '632', key: 'giaVon' },
    { code: '20', name: 'Lợi nhuận gộp về bán hàng và CCDV', account: '', key: 'loiNhuanGop' },
    { code: '21', name: 'Doanh thu hoạt động tài chính', account: '515', key: 'doanhThuTaiChinh' },
    { code: '22', name: 'Chi phí tài chính', account: '635', key: 'chiPhiTaiChinh' },
    { code: '25', name: 'Chi phí bán hàng', account: '641', key: 'chiPhiBanHang' },
    { code: '26', name: 'Chi phí quản lý doanh nghiệp', account: '642', key: 'chiPhiQuanLy' },
    { code: '30', name: 'Lợi nhuận thuần từ hoạt động kinh doanh', account: '', key: 'loiNhuanThuan' },
    { code: '31', name: 'Thu nhập khác', account: '711', key: 'thuNhapKhac' },
    { code: '32', name: 'Chi phí khác', account: '811', key: 'chiPhiKhac' },
    { code: '40', name: 'Lợi nhuận khác', account: '', key: 'loiNhuanKhac' },
    { code: '50', name: 'Tổng lợi nhuận kế toán trước thuế', account: '', key: 'loiNhuanTruocThue' },
    { code: '51', name: 'Chi phí thuế TNDN', account: '821', key: 'chiPhiThueTNDN' },
    { code: '60', name: 'Lợi nhuận sau thuế thu nhập doanh nghiệp', account: '', key: 'loiNhuanSauThue' },
]

/** Tên cũ (tiếng Anh) mà web đang đọc trong `summary` — giữ để không gãy màn hình */
const raSummary = (s: SoB02) => ({
    revenue: s.doanhThu,
    deductions: s.giamTruDoanhThu,
    netRevenue: s.doanhThuThuan,
    cogs: s.giaVon,
    grossProfit: s.loiNhuanGop,
    financialIncome: s.doanhThuTaiChinh,
    financialExpense: s.chiPhiTaiChinh,
    sellingExpense: s.chiPhiBanHang,
    adminExpense: s.chiPhiQuanLy,
    operatingProfit: s.loiNhuanThuan,
    otherIncome: s.thuNhapKhac,
    otherExpense: s.chiPhiKhac,
    otherProfit: s.loiNhuanKhac,
    profitBeforeTax: s.loiNhuanTruocThue,
    citExpense: s.chiPhiThueTNDN,
    netProfit: s.loiNhuanSauThue,
})

router.get('/income-statement', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const nam = new Date().getFullYear()
        const from = ngayCua(req.query.from, `${nam}-01-01`)
        const to = ngayCua(req.query.to, `${nam}-12-31`)
        const compare = laThat(req.query.comparePreviousYear)

        const b = await tinhB02(req.storePrisma!, { tu: from, den: to, soSanh: compare })

        res.json({
            success: true,
            data: {
                form: 'B02-DNN',
                title: 'Báo cáo kết quả hoạt động kinh doanh',
                from, to,
                comparePreviousYear: compare,
                ...(compare ? { previousFrom: luiNam(from), previousTo: luiNam(to) } : {}),
                rows: CHI_TIEU_B02.map(t => ({
                    code: t.code,
                    name: t.name,
                    account: t.account || null,
                    currentPeriod: b.kyNay[t.key],
                    previousPeriod: b.kyTruoc ? b.kyTruoc[t.key] : null,
                })),
                summary: {
                    ...raSummary(b.kyNay),
                    ...(b.kyTruoc ? { previous: raSummary(b.kyTruoc) } : {}),
                },
                laborCost622: b.chiPhiNhanCong622,
                vatOutput: b.vatDauRa,
                warnings: b.canhBao,
                readable: b.docDuoc,
            },
        })
    } catch (err: any) {
        console.error('GET /reports/income-statement error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// ═════════════════════════════════════════════════════════════════════════════
//  B03-DNN — Lưu chuyển tiền tệ (trực tiếp)
//  GET /api/reports/cash-flow?from=&to=
// ═════════════════════════════════════════════════════════════════════════════

router.get('/cash-flow', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const nam = new Date().getFullYear()
        const from = ngayCua(req.query.from, `${nam}-01-01`)
        const to = ngayCua(req.query.to, `${nam}-12-31`)

        const b = await tinhB03(req.storePrisma!, { tu: from, den: to })

        res.json({
            success: true,
            data: {
                form: 'B03-DNN',
                title: 'Báo cáo lưu chuyển tiền tệ (phương pháp trực tiếp)',
                from, to,
                operating: {
                    fromCustomers: b.thuTuBanHang,
                    toSuppliers: b.traNguoiBan,
                    toEmployees: b.traNguoiLaoDong,
                    toTaxes: b.nopThue,
                    other: b.khacHDKD,
                    net: b.thuanHDKD,
                },
                investing: { net: b.thuanDauTu },
                financing: { net: b.thuanTaiChinh },
                netCashFlow: b.thuanTrongKy,
                openingCash: b.tienDauKy,
                closingCash: b.tienCuoiKy,
                tiesOut: b.khopSoDu,
                tieOutGap: b.lechSoDu,
                warnings: b.canhBao,
                readable: b.docDuoc,
            },
        })
    } catch (err: any) {
        console.error('GET /reports/cash-flow error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

export default router
