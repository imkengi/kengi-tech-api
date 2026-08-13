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
import { boHoSoThanhTra, sangCsv, truyVetChungTu } from '../lib/auditPack'
import { moPhongThanhTra } from '../lib/auditDrill'
import { moPhongAnDinh, TY_LE_TT40 } from '../lib/taxAssessment'
import { lapKeHoachKhacPhuc } from '../lib/remediationPlan'

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

/**
 * GET /api/tax/audit-year?year= — bản đồ rủi ro 12 tháng.
 *
 * Chạy TUẦN TỰ từng tháng: pool Prisma mỗi cửa hàng rất nhỏ, bắn 12 lượt soát
 * song song là cạn kết nối và kéo sập cả dashboard. Chậm hơn nhưng không làm
 * chết hệ thống lúc người khác đang bán hàng.
 */
router.get('/audit-year', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const nay = new Date()
        const year = Number(req.query.year) || nay.getFullYear()
        // Chỉ soát tới tháng hiện tại nếu là năm nay — tháng chưa tới thì không có gì để soát
        const thangCuoi = year === nay.getFullYear() ? nay.getMonth() + 1 : 12

        const thang: Array<{
            thang: number; diem: number; xepLoai: string
            soCanhBao: number; soNang: number
            truyThuUocTinh: number; tongUocTinh: number
            doanhThuSo: number
            maNang: string[]
        }> = []

        for (let m = 1; m <= thangCuoi; m++) {
            const h = await kiemTraThue(prisma, dungKy({ year, month: m }))
            thang.push({
                thang: m,
                diem: h.diem,
                xepLoai: h.xepLoai,
                soCanhBao: h.canhBao.length,
                soNang: h.canhBao.filter(c => c.muc === 'cao').length,
                truyThuUocTinh: h.uocTinhPhat.truyThu,
                tongUocTinh: h.uocTinhPhat.tong,
                doanhThuSo: h.doanhThu.so,
                maNang: h.canhBao.filter(c => c.muc === 'cao').map(c => c.code).slice(0, 4),
            })
        }

        const coSo = thang.filter(t => t.doanhThuSo > 0 || t.soCanhBao > 0)
        res.json({
            success: true,
            data: {
                year,
                thang,
                diemTrungBinh: coSo.length ? Math.round(coSo.reduce((s, t) => s + t.diem, 0) / coSo.length) : 100,
                thangRuiRoNhat: coSo.length ? coSo.slice().sort((a, b) => a.diem - b.diem)[0]!.thang : null,
                tongUocTinhCaNam: thang.reduce((s, t) => s + t.tongUocTinh, 0),
            },
        })
    } catch (err) {
        console.error('Bản đồ rủi ro thuế theo năm lỗi:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

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

/* ═══════════════════════════════════════════════════════════════════════════
 *  LỊCH SỬ TỰ RÀ SOÁT
 *
 *  Vì sao đáng lưu: khi cơ quan thuế phát hiện sai sót, việc doanh nghiệp CHỨNG
 *  MINH ĐƯỢC mình đã tự rà soát định kỳ và chủ động khắc phục là tình tiết giảm
 *  nhẹ khi xem xét xử phạt. Ngoài ra còn thấy điểm sẵn sàng đang lên hay xuống.
 *
 *  Dùng lại bảng TaxAuditLog sẵn có (action='self-audit') — KHÔNG thêm bảng mới
 *  để khỏi phải chạy migrate trên production.
 * ═══════════════════════════════════════════════════════════════════════════ */

// POST /audit-save — chạy soát rồi lưu kết quả tóm tắt
router.post('/audit-save', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const ky = dungKy(req.body || {})
        const h = await kiemTraThue(prisma, ky)

        const tomTat = {
            maKy: ky.maKy,
            nhan: ky.nhan,
            diem: h.diem,
            xepLoai: h.xepLoai,
            soCanhBao: h.canhBao.length,
            soNang: h.canhBao.filter(c => c.muc === 'cao').length,
            truyThu: h.uocTinhPhat.truyThu,
            tongUocTinh: h.uocTinhPhat.tong,
            ma: h.canhBao.map(c => c.code),
            doanhThuSo: h.doanhThu.so,
        }

        await prisma.taxAuditLog.create({
            data: {
                action: 'self-audit',
                entityType: 'tax-audit',
                entityId: ky.maKy,
                userId: req.user?.userId || null,
                userName: (req.user as any)?.name || (req.user as any)?.email || null,
                changes: JSON.stringify(tomTat),
                ip: (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || null,
            },
        })

        res.json({ success: true, data: tomTat })
    } catch (err) {
        console.error('Lưu lần soát thuế lỗi:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// GET /audit-history?year= — các lần đã soát
router.get('/audit-history', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const year = Number(req.query.year) || new Date().getFullYear()
        /* Lấy CẢ hai loại: soát tay (self-audit) và soát tự động hằng tháng
         * (self-audit-auto do cron ghi). Bỏ sót loại tự động thì bảng lịch sử
         * trống trơn dù hệ thống vẫn đang soát đều — đúng thứ khiến người dùng
         * mất niềm tin vào tính năng. */
        const rows = await prisma.taxAuditLog.findMany({
            where: { action: { in: ['self-audit', 'self-audit-auto'] }, entityType: 'tax-audit' },
            orderBy: { timestamp: 'desc' },
            take: 100,
        })
        const data = (rows || [])
            .map((r: any) => {
                let t: any = {}
                try { t = JSON.parse(r.changes || '{}') } catch { t = {} }
                return {
                    id: r.id,
                    thoiDiem: r.timestamp,
                    tuDong: r.action === 'self-audit-auto',
                    nguoiSoat: r.userName || (r.action === 'self-audit-auto' ? 'Hệ thống (tự động)' : null),
                    maKy: t.maKy || r.entityId || '',
                    nhan: t.nhan || r.entityId || '',
                    diem: t.diem ?? null,
                    xepLoai: t.xepLoai ?? null,
                    soCanhBao: t.soCanhBao ?? null,
                    soNang: t.soNang ?? null,
                    tongUocTinh: t.tongUocTinh ?? null,
                }
            })
            // Chỉ giữ bản ghi của năm đang xem (mã kỳ dạng 2026-08 / 2026-Q3 / 2026)
            .filter((r: any) => String(r.maKy).startsWith(String(year)))
        res.json({ success: true, data })
    } catch (err) {
        console.error('Lịch sử soát thuế lỗi:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

/**
 * GET /api/tax/audit-pack?year=&month=|quarter=  — bộ hồ sơ thanh tra.
 *
 * Trả manifest (tên tài liệu, mẫu sổ, căn cứ, số dòng, số tổng) chứ KHÔNG trả
 * toàn bộ dòng: một kỳ vài nghìn bút toán mà nhét hết vào JSON là trang treo.
 * Muốn xem/tải chi tiết thì gọi kèm ?doc=<mã> để lấy CSV.
 */
router.get('/audit-pack', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const ky = dungKy(req.query)
        const bo = await boHoSoThanhTra(prisma, { from: ky.from, to: ky.to, nhan: ky.nhan })

        const doc = String(req.query.doc || '').trim()
        if (doc) {
            const t = bo.taiLieu.find(x => x.ma === doc)
            if (!t) {
                const thieu = bo.thieu.find(x => x.ma === doc)
                return res.status(404).json({
                    success: false,
                    error: thieu ? `${thieu.ten}: ${thieu.lyDo}` : `Không có tài liệu "${doc}" trong bộ hồ sơ`,
                })
            }
            if (String(req.query.format) === 'csv') {
                res.setHeader('Content-Type', 'text/csv; charset=utf-8')
                res.setHeader('Content-Disposition',
                    `attachment; filename="${t.ma}-${ky.from}-${ky.to}.csv"`)
                return res.send(sangCsv(t))
            }
            return res.json({ success: true, data: { ky: bo.ky, taiLieu: t } })
        }

        res.json({
            success: true,
            data: {
                ky: bo.ky,
                tongQuan: bo.tongQuan,
                thieu: bo.thieu,
                // Bỏ mảng dòng, chỉ giữ phần mô tả + số tổng
                taiLieu: bo.taiLieu.map(t => ({
                    ma: t.ma, ten: t.ten, mau: t.mau, canCu: t.canCu, vaiTro: t.vaiTro,
                    ghiChu: t.ghiChu, soDong: t.dong.length,
                    cot: t.cot, tong: t.tong,
                    // Vài dòng đầu để xem trước, đủ biết bảng có đúng không
                    xemTruoc: t.dong.slice(0, 5),
                })),
            },
        })
    } catch (err) {
        console.error('Bộ hồ sơ thanh tra lỗi:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

/**
 * GET /api/tax/trace?ma= — truy vết một chứng từ hết chuỗi.
 *
 * Đúng thao tác đoàn thanh tra hay làm: chọn ngẫu nhiên vài số hóa đơn rồi bắt
 * đi hết đường đi của nó. Đứt mắt xích nào thì hỏi vào đúng chỗ đó.
 */
router.get('/trace', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const ma = String(req.query.ma || '').trim()
        if (!ma) {
            return res.status(400).json({
                success: false,
                error: 'Thiếu tham số ma — nhập số phiếu bán, mã phiếu nhập hoặc số hóa đơn điện tử',
            })
        }
        const kq = await truyVetChungTu(prisma, ma)
        res.json({ success: true, data: kq })
    } catch (err) {
        console.error('Truy vết chứng từ lỗi:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

/**
 * GET /api/tax/audit-drill?year=&month=|quarter= — mô phỏng buổi làm việc.
 *
 * Trả bộ câu hỏi đoàn thanh tra hay hỏi, kèm câu trả lời dựng sẵn từ số liệu
 * thật của kỳ và chứng từ phải chìa ra. Khác /audit-check ở chỗ: audit-check
 * nói "sai chỗ nào", drill nói "họ hỏi gì và trả lời ra sao".
 */
router.get('/audit-drill', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const kq = await moPhongThanhTra(prisma, dungKy(req.query))
        res.json({ success: true, data: kq })
    } catch (err) {
        console.error('Mô phỏng thanh tra lỗi:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

/**
 * GET /api/tax/audit-assessment?year=&month=|quarter=&nganh=&tySuat=
 *   — mô phỏng kịch bản xấu nhất: bị ấn định thuế theo Điều 50 Luật QLT.
 *
 * Trả căn cứ ấn định ĐANG CÓ THẬT trong dữ liệu (kèm cách phản bác từng cái) và
 * ước tính số thuế nếu bị ấn định. Con số ở đây là minh họa mức thiệt hại, không
 * phải dự báo số cơ quan thuế sẽ ra — điều đó ghi thẳng trong phần trả về.
 */
router.get('/audit-assessment', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const nganhQ = String(req.query.nganh || '')
        const tySuatQ = Number(req.query.tySuat)
        const kq = await moPhongAnDinh(prisma, dungKy(req.query), {
            nganh: (nganhQ in TY_LE_TT40 ? nganhQ : undefined) as any,
            // Chặn tỷ suất vô lý: âm hoặc trên 100% thì bỏ qua, dùng mặc định
            tySuatLoiNhuan: isFinite(tySuatQ) && tySuatQ > 0 && tySuatQ <= 1 ? tySuatQ : undefined,
        })
        res.json({ success: true, data: { ...kq, nganhCoThe: TY_LE_TT40 } })
    } catch (err) {
        console.error('Mô phỏng ấn định thuế lỗi:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

/**
 * GET /api/tax/audit-plan?year=&month=|quarter= — kế hoạch khắc phục.
 *
 * Gom phát hiện của phép soát dữ liệu và phép mô phỏng ấn định thành DANH SÁCH
 * VIỆC có hạn chót, người làm và thứ tự ưu tiên theo tiền/công sức.
 *
 * Chạy hai phép quét TUẦN TỰ (soát rồi mới tới ấn định) — pool Prisma mỗi cửa
 * hàng rất nhỏ, chạy song song là cạn kết nối lúc người khác đang bán hàng.
 */
router.get('/audit-plan', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const ky = dungKy(req.query)
        const hoSo = await kiemTraThue(prisma, ky)
        const anDinh = await moPhongAnDinh(prisma, ky).catch(() => null)
        // Hôm nay theo giờ VN — lệch múi giờ là sai hạn chót cả ngày
        const homNay = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10)
        const keHoach = lapKeHoachKhacPhuc(hoSo, anDinh, ky, homNay)
        res.json({ success: true, data: { ...keHoach, diemSanSang: hoSo.diem, xepLoai: hoSo.xepLoai } })
    } catch (err) {
        console.error('Kế hoạch khắc phục lỗi:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

export default router
