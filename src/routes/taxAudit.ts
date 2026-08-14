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
import { requireRole } from '../middleware/roleMiddleware'
import { errMsg } from '../lib/errorResponse'
import { kiemTraThue, type KhoangKy } from '../lib/taxAudit'
import { boHoSoThanhTra, sangCsv, truyVetChungTu } from '../lib/auditPack'
import { moPhongThanhTra } from '../lib/auditDrill'
import { doiChieuBaChieu } from '../lib/revenueReconcile'
import { tinhChuyenDoiHKD } from '../lib/hkdTransition'
import { moPhongAnDinh, TY_LE_TT40 } from '../lib/taxAssessment'
import { lapKeHoachKhacPhuc } from '../lib/remediationPlan'
import { quyetToanTndn, layLaiLoTheoNam, layThueDaTamNop, THUE_SUAT_TNDN } from '../lib/citAdjustment'

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
/**
 * GET /api/tax/data-health?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Sức khoẻ dữ liệu — đọc báo cáo nào cũng nên liếc qua đây trước. Mặc định 90
 * ngày gần nhất.
 */
router.get('/data-health', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const q = req.query as any
        const hopLe = (s: any) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))
        const nay = new Date(Date.now() + 7 * 3600_000)
        const to = hopLe(q.to) ? String(q.to) : nay.toISOString().slice(0, 10)
        const from = hopLe(q.from) ? String(q.from)
            : new Date(new Date(`${to}T00:00:00+07:00`).getTime() - 90 * 86400_000 + 7 * 3600_000).toISOString().slice(0, 10)
        const start = new Date(`${from}T00:00:00+07:00`)
        const end = new Date(new Date(`${to}T00:00:00+07:00`).getTime() + 86400_000)

        const { sucKhoeDuLieu } = await import('../lib/dataHealth')
        const kq = await sucKhoeDuLieu(req.storePrisma!, { from, to, start, end })
        res.json({ success: true, data: kq })
    } catch (err) {
        console.error('GET /tax/data-health error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

/**
 * GET /api/tax/einvoice-errors?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Hoá đơn PHÁT HÀNH HỎNG — trạng thái ERROR, không có số hoá đơn.
 *
 * Vì sao cần: bán hàng xong mà hoá đơn không phát hành được thì về mặt thuế
 * giống hệt như chưa lập hoá đơn (Điều 90 Luật QLT 38/2019). Nhưng trên phần
 * mềm nó nằm im trong bảng, không ai thấy — soát dữ liệu thật ngày 14/08/2026
 * ra 68 tờ hỏng chỉ trong một tháng của một cửa hàng.
 *
 * Gom theo NGUYÊN NHÂN chứ không liệt kê phẳng: mỗi nguyên nhân có một cách
 * chữa riêng (thiếu mã số thuế người mua, hết dải số, chữ ký hết hạn, nhà cung
 * cấp từ chối…). Liệt kê 68 dòng giống nhau thì người đọc không biết bắt đầu
 * từ đâu.
 */
router.get('/einvoice-errors', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const q = req.query as any
        const hopLe = (s: any) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))
        const nay = new Date(Date.now() + 7 * 3600_000)
        const from = hopLe(q.from) ? String(q.from)
            : new Date(Date.UTC(nay.getUTCFullYear(), nay.getUTCMonth() - 2, 1)).toISOString().slice(0, 10)
        const to = hopLe(q.to) ? String(q.to) : nay.toISOString().slice(0, 10)

        const ds: any[] = await prisma.eInvoice.findMany({
            where: { invoiceDate: { gte: from, lte: to }, status: 'ERROR' },
            select: {
                id: true, invoiceDate: true, totalAmount: true, errorMessage: true,
                transactionId: true, buyerName: true, buyerTaxCode: true, invoiceType: true,
            },
            orderBy: { invoiceDate: 'desc' },
            take: 2000,
        })

        /* Thông điệp lỗi của nhà cung cấp thường kèm mã phiếu/thời điểm nên mỗi
         * dòng một khác. Cắt phần đầu để gom được về cùng nguyên nhân, thay số
         * bằng dấu # để "hoá đơn 00012345" và "hoá đơn 00012346" về một nhóm. */
        const chuanHoa = (s: any) => String(s || '(không ghi lý do)')
            .replace(/\d+/g, '#')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 160)

        const nhom = new Map<string, { so: number; tien: number; mau: any[]; ganNhat: string }>()
        for (const h of ds) {
            const k = chuanHoa(h.errorMessage)
            const o = nhom.get(k) || { so: 0, tien: 0, mau: [], ganNhat: '' }
            o.so++
            o.tien += Number(h.totalAmount) || 0
            /* Ngày hỏng GẦN NHẤT của nhóm — thứ quyết định nhóm này còn đang
             * sinh ra hay đã tắt. Không có nó thì người dùng phải mở từng nhóm
             * ra mới biết, mà đó lại là điều đầu tiên cần biết. */
            const ng = String(h.invoiceDate || '')
            if (ng > o.ganNhat) o.ganNhat = ng
            if (o.mau.length < 3) {
                o.mau.push({
                    id: h.id, ngay: h.invoiceDate,
                    tien: Math.round(Number(h.totalAmount) || 0),
                    khach: h.buyerName || null, mstKhach: h.buyerTaxCode || null,
                    phieuBan: h.transactionId || null,
                    loiDayDu: String(h.errorMessage || '').slice(0, 300) || null,
                })
            }
            nhom.set(k, o)
        }

        // Rải đều hay dồn một đợt? Dồn một ngày thường là sự cố nhà cung cấp.
        const theoNgay = new Map<string, number>()
        for (const h of ds) {
            const n = String(h.invoiceDate || '')
            theoNgay.set(n, (theoNgay.get(n) || 0) + 1)
        }
        const ngay = Array.from(theoNgay.entries())
            .map(([ngay, so]) => ({ ngay, so }))
            .sort((a, b) => a.ngay.localeCompare(b.ngay))
        const ngayDon = ngay.length > 0 ? ngay.reduce((a, b) => (b.so > a.so ? b : a)) : null

        res.json({
            success: true,
            data: {
                ky: { from, to },
                tong: { so: ds.length, tien: Math.round(ds.reduce((s, h) => s + (Number(h.totalAmount) || 0), 0)) },
                daCatBot: ds.length >= 2000,
                theoNguyenNhan: Array.from(nhom.entries())
                    .map(([lyDo, v]) => ({ lyDo, so: v.so, tien: Math.round(v.tien), ngayGanNhat: v.ganNhat || null, mau: v.mau }))
                    .sort((a, b) => b.so - a.so),
                theoNgay: ngay,
                ngayDonNhat: ngayDon,
                ghiChu: ds.length === 0
                    ? 'Không có hoá đơn nào phát hành hỏng trong kỳ.'
                    : 'Hoá đơn hỏng về mặt thuế giống như chưa lập hoá đơn (Điều 90 Luật Quản lý thuế 38/2019). Sửa nguyên nhân rồi phát hành lại trước khi hết kỳ kê khai.',
            },
        })
    } catch (err) {
        console.error('GET /tax/einvoice-errors error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

/**
 * POST /api/tax/einvoice-fkey-repair?from&to[&apply=1]
 *
 * Ghi bù cho hoá đơn kẹt vì "Fkey đã được sử dụng" — bản dành cho chính cửa hàng
 * (bản quản trị chạy nhiều cửa hàng nằm ở /api/admin/einvoice-fkey-repair).
 *
 * Câu lỗi đó nghĩa là hoá đơn ĐÃ phát hành thành công bên nhà cung cấp: lần gửi
 * trước tới đích nhưng phản hồi không về. Bấm "Xuất lại" sẽ hỏng mãi mãi vì khoá
 * vẫn trùng — phải kéo số hoá đơn thật về, và đó là việc của endpoint này.
 *
 * MẶC ĐỊNH CHẠY THỬ. Phải truyền apply=1 mới ghi. Đây là ghi vào sổ hoá đơn nên
 * người dùng phải nhìn kết quả chạy thử trước rồi mới bấm đồng ý.
 *
 * Chỉ điền phần CÒN TRỐNG và chỉ chuyển sang SENT khi nhà cung cấp xác nhận cơ
 * quan thuế đã cấp mã. Không ghi đè dữ liệu đang có.
 */
router.post('/einvoice-fkey-repair', authMiddleware, requireRole('admin', 'manager'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const q = req.query as any
        const apply = String(q.apply || '') === '1'
        const hopLe = (s: any) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))
        const nay = new Date(Date.now() + 7 * 3600_000)
        const from = hopLe(q.from) ? String(q.from)
            : new Date(Date.UTC(nay.getUTCFullYear(), nay.getUTCMonth() - 3, 1)).toISOString().slice(0, 10)
        const to = hopLe(q.to) ? String(q.to) : nay.toISOString().slice(0, 10)

        const { getActiveConfig } = await import('./einvoice')
        const cfgRow: any = await getActiveConfig(prisma).catch(() => null)
        if (!cfgRow) return res.status(400).json({ success: false, error: 'Cửa hàng chưa cấu hình nhà cung cấp hoá đơn điện tử' })

        const { VnptProvider, vnptFkey } = await import('../services/einvoice/vnpt')
        const vnpt: any = new (VnptProvider as any)()

        const ds: any[] = await prisma.eInvoice.findMany({
            where: { invoiceDate: { gte: from, lte: to }, status: 'ERROR' },
            select: {
                id: true, invoiceDate: true, totalAmount: true, errorMessage: true, transactionId: true,
                invoiceNumber: true, lookupCode: true, invoiceType: true,
                adjustsInvoiceId: true, replacesInvoiceId: true,
            },
            orderBy: { invoiceDate: 'asc' },
            take: 200,
        })
        const ungVien = ds.filter(h => /fkey/i.test(String(h.errorMessage || '')) && /đã được sử dụng|already/i.test(String(h.errorMessage || '')))

        let ghiDuoc = 0, khongThay = 0
        const chiTiet: any[] = []
        for (const h of ungVien) {
            const fkey = h.invoiceType === 'ADJUSTMENT' && h.adjustsInvoiceId ? vnptFkey(`${h.adjustsInvoiceId}A`)
                : h.invoiceType === 'REPLACEMENT' && h.replacesInvoiceId ? vnptFkey(`${h.replacesInvoiceId}R`)
                    : vnptFkey(h.transactionId || h.id)
            let kq: any
            try { kq = await vnpt.findByFkey(cfgRow, fkey) } catch { kq = { found: false } }
            if (!kq?.found || !kq.invoiceNumber) {
                khongThay++
                chiTiet.push({ ngay: h.invoiceDate, tien: Math.round(Number(h.totalAmount) || 0), ketQua: 'nhà cung cấp không trả về hoá đơn' })
                continue
            }
            const data: any = {}
            if (kq.invoiceNumber && !h.invoiceNumber) data.invoiceNumber = kq.invoiceNumber
            if (kq.lookupCode && !h.lookupCode) data.lookupCode = kq.lookupCode
            if (kq.sent) { data.status = 'SENT'; data.sentAt = new Date(); data.errorMessage = null }
            if (apply && Object.keys(data).length) {
                await prisma.eInvoice.update({ where: { id: h.id }, data }).catch(() => { })
            }
            ghiDuoc++
            chiTiet.push({
                ngay: h.invoiceDate, tien: Math.round(Number(h.totalAmount) || 0),
                soHoaDon: kq.invoiceNumber, maCQT: kq.lookupCode || null,
                ketQua: apply ? 'đã ghi bù' : 'sẽ ghi bù (đang chạy thử)',
            })
        }

        res.json({
            success: true,
            data: {
                ky: { from, to }, chayThat: apply,
                soHoaDonLoi: ds.length,
                soKetVìTrungKhoa: ungVien.length,
                traRaHoaDon: ghiDuoc,
                khongTraRa: khongThay,
                chiTiet: chiTiet.slice(0, 100),
                ghiChu: apply
                    ? `Đã ghi bù ${ghiDuoc} hoá đơn. Mở lại bảng hoá đơn hỏng để xác nhận.`
                    : 'ĐANG CHẠY THỬ — chưa ghi gì. Xem kỹ rồi bấm ghi bù thật nếu đồng ý.',
            },
        })
    } catch (err: any) {
        console.error('POST /tax/einvoice-fkey-repair error:', err)
        res.status(500).json({ success: false, error: err?.message || 'Internal server error' })
    }
})

/**
 * GET /api/tax/reconcile-3way?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Đối chiếu ba chiều sổ sách ↔ hoá đơn ↔ dòng tiền — việc đầu tiên đoàn thanh
 * tra làm. Mặc định tháng trước liền kề, vì đó là kỳ vừa chốt sổ và còn kịp
 * khai bổ sung nếu phát hiện lệch.
 */
router.get('/reconcile-3way', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const q = req.query as any
        const hopLe = (s: any) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))

        let from: string, to: string
        if (hopLe(q.from) && hopLe(q.to)) {
            from = String(q.from); to = String(q.to)
        } else {
            const nay = new Date(Date.now() + 7 * 3600_000)
            const truoc = new Date(Date.UTC(nay.getUTCFullYear(), nay.getUTCMonth() - 1, 1))
            const cuoi = new Date(Date.UTC(nay.getUTCFullYear(), nay.getUTCMonth(), 0))
            from = truoc.toISOString().slice(0, 10)
            to = cuoi.toISOString().slice(0, 10)
        }
        if (from > to) return res.status(400).json({ success: false, error: 'Ngày bắt đầu phải trước ngày kết thúc' })

        const start = new Date(`${from}T00:00:00+07:00`)
        const end = new Date(new Date(`${to}T00:00:00+07:00`).getTime() + 86400_000)
        const kq = await doiChieuBaChieu(prisma, {
            from, to, start, end,
            nhan: from.slice(0, 7) === to.slice(0, 7) ? `tháng ${Number(from.slice(5, 7))}/${from.slice(0, 4)}` : `${from} → ${to}`,
        })
        res.json({ success: true, data: kq })
    } catch (err) {
        console.error('GET /tax/reconcile-3way error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

/**
 * GET /api/tax/hkd-transition?year=2026&nganh=phan-phoi&khoanMoiThang=300000
 *
 * Bỏ thuế khoán từ 2026 (NQ 198/2025): hộ kinh doanh phải nộp bao nhiêu theo
 * kê khai, và chênh bao nhiêu so với mức khoán đang đóng.
 */
router.get('/hkd-transition', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const q = req.query as any
        const nam = Number(q.year) || new Date(Date.now() + 7 * 3600_000).getUTCFullYear()
        /* Mặc định lấy trọn năm đang xem. Kỳ ngắn vẫn tính được nhưng lib sẽ quy
         * năm và nói rõ — không im lặng nhân lên. */
        const tu = q.from ? new Date(`${String(q.from).slice(0, 10)}T00:00:00+07:00`) : new Date(`${nam}-01-01T00:00:00+07:00`)
        const den = q.to ? new Date(`${String(q.to).slice(0, 10)}T23:59:59+07:00`) : new Date(`${nam}-12-31T23:59:59+07:00`)
        if (isNaN(tu.getTime()) || isNaN(den.getTime()) || tu > den) {
            return res.status(400).json({ success: false, error: 'Khoảng ngày không hợp lệ' })
        }

        const kq = await tinhChuyenDoiHKD(req.storePrisma!, { tu, den }, {
            nam,
            nganh: q.nganh || undefined,
            khoanMoiThang: q.khoanMoiThang !== undefined && q.khoanMoiThang !== '' ? Number(q.khoanMoiThang) : undefined,
        })
        res.json({ success: true, data: kq })
    } catch (err) {
        console.error('GET /tax/hkd-transition error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

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

/**
 * GET /api/tax/cit-adjustment?year= — quyết toán thuế TNDN CÓ ĐIỀU CHỈNH.
 *
 * Phép tính quyết toán sẵn có lấy thẳng lãi kế toán × 20%. Endpoint này bù đúng
 * hai dòng bị bỏ qua: cộng các khoản chi không được trừ (Điều 4 TT 96/2015) và
 * trừ lỗ được chuyển (Điều 9 TT 78/2014) — hai dòng đó chính là chỗ chênh lệch
 * lớn nhất giữa số tự khai và số cơ quan thuế tính.
 */
router.get('/cit-adjustment', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const nam = Number(req.query.year) || new Date().getFullYear()

        const laiLoTheoNam = await layLaiLoTheoNam(prisma, nam)

        // Khoản bị loại lấy đúng kết quả bộ soát — một nguồn sự thật cho cả hai nơi
        const hoSo = await kiemTraThue(prisma, dungKy({ year: nam }))

        const daTamNop = await layThueDaTamNop(prisma, nam)

        const kq = quyetToanTndn({
            nam,
            loiNhuanKeToan: laiLoTheoNam.get(nam) ?? 0,
            khoanBiLoai: hoSo.khoanBiLoai?.dong ?? [],
            laiLoTheoNam,
            daTamNop,
            thueSuat: THUE_SUAT_TNDN,
        })

        res.json({
            success: true,
            data: {
                ...kq,
                laiLoCacNam: Array.from(laiLoTheoNam.entries())
                    .sort((a, b) => a[0] - b[0])
                    .map(([n, v]) => ({ nam: n, laiLo: v })),
            },
        })
    } catch (err) {
        console.error('Quyết toán TNDN có điều chỉnh lỗi:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

export default router
