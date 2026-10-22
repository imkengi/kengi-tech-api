// ═══════════════════════════════════════════════════════════════════════════════
//  MCP TOOLS — THUẾ (22/10/2026; chủ shop: "giờ qua làm MCP thuế để hỏi trợ lý AI đi")
//
//  Năm công cụ còn THIẾU so với các màn hình Thuế: tờ khai GTGT, lịch nghĩa vụ + số dư thuế phải
//  nộp, hoá đơn điện tử bán ra, tồn kho thuế, quyết toán TNCN. Công cụ soát thanh tra / đối chiếu /
//  TNDN đã có ở mcpFinanceTools, sổ sách ở mcpAccountingTools.
//
//  Mỗi công cụ gọi ĐÚNG hàm mà route của màn hình gọi (lib/toKhaiGtgt, lib/lichNghiaVuThue,
//  lib/quyetToanTncn, các hàm export của routes/einvoice) — AI không được nói số khác màn hình chủ
//  shop đang xem. CHỈ ĐỌC; riêng tax_deadlines gieo mốc còn thiếu + đánh dấu mốc quá hạn y như khi mở
//  trang Nghĩa Vụ Thuế (lặp lại được, không đổi số liệu kế toán).
// ═══════════════════════════════════════════════════════════════════════════════

import { Tool, ToolCtx, ToolError, canhBaoCat, canhBaoMau } from '../lib/mcpTypes'
import { tinhToKhaiGtgt, pad2 } from '../lib/toKhaiGtgt'
import { docLichNghiaVu, soDuThuePhaiNop } from '../lib/lichNghiaVuThue'
import { suyHoSoThue } from '../lib/taxCalendarStore'
import { docQuyetToanTncn, PIT_SELF_DEDUCTION_PER_MONTH, PIT_DEPENDENT_DEDUCTION_PER_MONTH } from '../lib/quyetToanTncn'
import { tonKhoThue, hoaDonCanDieuChinh, demXuatHoaDon, invoiceQueueStats, getActiveConfig, parseConfigExtra } from './einvoice'

const MOT_NGAY = 86_400_000
/** "Bây giờ" theo giờ VN — đọc bằng getUTC* */
const gioVN = () => new Date(Date.now() + 7 * 3600_000)
const soNguyen = (v: unknown): number => {
    const n = Math.trunc(Number(v))
    return Number.isFinite(n) ? n : 0
}
const tien = (v: unknown) => Math.round(Number(v) || 0)

/** Bảng của tính năng CHƯA BẬT (chưa migrate) ⇒ "chưa dùng", không phải lỗi. Lỗi đọc khác phải nổi lên. */
const thieuBang = (e: any) => {
    const ma = String(e?.code || '')
    return ma === 'P2021' || ma === 'P2022' || /does not exist|relation .* does not exist/i.test(String(e?.message || e || ''))
}

const SCHEMA_NAM = { type: 'number', description: 'Năm (mặc định năm hiện tại)' } as const

export const TAX_TOOLS: Tool[] = [
    {
        name: 'tax_vat_return',
        description: 'TỜ KHAI THUẾ GTGT (01/GTGT) của một kỳ — đúng số trang Tờ Khai GTGT: thuế GTGT ĐẦU RA (Có TK 3331), ĐẦU VÀO được khấu trừ (Nợ TK 133), số PHẢI NỘP, số CÒN ĐƯỢC KHẤU TRỪ chuyển kỳ sau, kèm tờ khai đã lập / đã nộp cho kỳ đó. Gọi khi hỏi "tháng/quý này phải nộp VAT bao nhiêu", "đã khai thuế GTGT kỳ X chưa". Bỏ trống cả năm lẫn kỳ = kỳ ĐANG DIỄN RA theo cách cửa hàng kê khai (tháng hoặc quý); chỉ truyền year = cả năm. CHỈ ĐỌC.',
        inputSchema: {
            type: 'object',
            properties: {
                year: SCHEMA_NAM,
                month: { type: 'number', description: 'Tháng 1-12 (cửa hàng khai theo tháng)' },
                quarter: { type: 'number', description: 'Quý 1-4 (cửa hàng khai theo quý) — dùng thay cho month' },
            },
            additionalProperties: false,
        },
        run: async (a, { prisma }: ToolCtx) => {
            const nay = gioVN()
            const namNay = nay.getUTCFullYear()
            const year = soNguyen(a.year) || namNay
            let month = soNguyen(a.month)
            let quarter = soNguyen(a.quarter)
            if (!(month >= 1 && month <= 12)) month = 0
            if (!(quarter >= 1 && quarter <= 4)) quarter = 0

            const hoSo = await suyHoSoThue(prisma, year)
            // Không nói kỳ, không nói năm ⇒ kỳ đang diễn ra theo đúng cách cửa hàng kê khai
            if (!month && !quarter && !soNguyen(a.year)) {
                if (hoSo.kyKeKhai === 'quarter') quarter = Math.ceil((nay.getUTCMonth() + 1) / 3)
                else month = nay.getUTCMonth() + 1
            }
            const tk = await tinhToKhaiGtgt(prisma, { year, month: month || undefined, quarter: month ? undefined : (quarter || undefined) })

            // Tờ khai đã lưu cho kỳ (mã kỳ y như POST /tax/declarations: T09/2026 · Q3/2026; bản bổ sung có hậu tố)
            const maKy = tk.periodType === 'month' ? `T${pad2(Number(tk.month))}/${year}` : tk.periodType === 'quarter' ? `Q${tk.quarter}/${year}` : null
            let toKhaiDaLap: any[] = []
            if (maKy) {
                try {
                    const ds: any[] = await prisma.taxDeclaration.findMany({
                        where: { period: { contains: maKy } },
                        select: { formType: true, period: true, status: true, ct38: true, cnkdTotalTax: true, filedAt: true, createdAt: true },
                        orderBy: { createdAt: 'asc' },
                    })
                    toKhaiDaLap = ds.map(d => ({
                        mauToKhai: d.formType,
                        ky: d.period,
                        trangThai: d.status,
                        soPhaiNopTrenToKhai: tien(d.formType === '01_CNKD' ? d.cnkdTotalTax : d.ct38),
                        daNopLuc: d.filedAt || null,
                        lapLuc: d.createdAt,
                    }))
                } catch (e) {
                    if (!thieuBang(e)) throw e
                }
            }

            // Kỳ còn đang chạy ⇒ số tạm tính tới hôm nay
            const cuoiKy = tk.periodType === 'month' ? new Date(Date.UTC(year, Number(tk.month), 0))
                : tk.periodType === 'quarter' ? new Date(Date.UTC(year, Number(tk.quarter) * 3, 0))
                    : new Date(Date.UTC(year, 12, 0))
            const dangDienRa = cuoiKy.getTime() + MOT_NGAY > nay.getTime()

            return {
                ky: tk.periodType === 'month' ? `tháng ${tk.month}/${year}` : tk.periodType === 'quarter' ? `quý ${tk.quarter}/${year}` : `năm ${year}`,
                cuaHangKeKhaiTheo: hoSo.kyKeKhai === 'quarter' ? 'quý' : 'tháng',
                loaiHinh: hoSo.loaiHinh === 'household' ? 'hộ kinh doanh' : 'doanh nghiệp',
                thueDauRa: tk.outputVat,
                thueDauVaoDuocKhauTru: tk.inputVat,
                phaiNop: tk.vatPayable,
                conDuocKhauTruChuyenKySau: tk.vatCarryForward,
                toKhaiDaLap,
                ...(dangDienRa ? { tamTinh: 'Kỳ CHƯA kết thúc — số tạm tính tới hôm nay, còn thay đổi.' } : {}),
                ...(hoSo.loaiHinh === 'household'
                    ? { luuYHoKinhDoanh: 'Hộ kinh doanh khai thuế trên doanh thu (01/CNKD), không khấu trừ đầu vào — số ở đây chỉ để tham khảo; xem tax_deadlines cho số phải nộp theo tờ khai.' }
                    : {}),
                cachTinh: 'Tự tính từ sổ cái trong kỳ: đầu ra = Có TK 3331, đầu vào = Nợ TK 133 (đã trừ bút toán đảo). CHƯA cộng số thuế còn được khấu trừ của kỳ trước chuyển sang — nếu có thì số phải nộp thực tế còn thấp hơn.',
            }
        },
    },
    {
        name: 'tax_deadlines',
        description: 'LỊCH NGHĨA VỤ THUẾ + SỐ THUẾ CÒN PHẢI NỘP — đúng trang Nghĩa Vụ Thuế: các mốc QUÁ HẠN, SẮP ĐẾN HẠN (≤ 7 ngày), sắp tới, kèm số tiền từng mốc (từ tờ khai đã lập hoặc ước tính) và căn cứ pháp lý; cộng số dư trên sổ của TK 3331 (GTGT), 3334 (TNDN), 3335 (TNCN). Gọi khi hỏi "sắp phải nộp thuế gì", "có trễ hạn gì không", "còn nợ thuế bao nhiêu", "hạn nộp tờ khai quý này". Theo năm (mặc định năm nay).',
        inputSchema: {
            type: 'object',
            properties: { year: SCHEMA_NAM },
            additionalProperties: false,
        },
        run: async (a, { prisma }: ToolCtx) => {
            const year = soNguyen(a.year) || gioVN().getUTCFullYear()
            const ds: any[] = await docLichNghiaVu(prisma, { year: String(year) })
            const rut = (d: any) => ({
                viec: d.label,
                loaiThue: d.taxType,
                ky: d.period,
                hanNop: d.dueDate,
                conNgay: d.daysUntilDue,
                soTien: d.estimatedAmount,          // null = chưa suy ra được, KHÔNG phải 0
                nguonSoTien: d.nguonSoTien === 'to-khai' ? 'tờ khai đã lập' : d.nguonSoTien === 'uoc-tinh' ? 'ước tính' : null,
                dienGiaiSoTien: d.dienGiaiSoTien,
                loaiViec: d.loaiViec,
                canCu: d.canCu,
            })
            const quaHan = ds.filter(d => d.status === 'overdue')
            const sapDenHan = ds.filter(d => d.status === 'due_soon')
            const sapToi = ds.filter(d => d.status === 'upcoming')
            const daNop = ds.filter(d => d.rawStatus === 'submitted' || d.status === 'submitted')
            const SAP_TOI_TOI_DA = 8
            const soDu = await soDuThuePhaiNop(prisma, year)
            return {
                nam: year,
                tongSoMoc: ds.length,
                quaHan: quaHan.map(rut),
                sapDenHan: sapDenHan.map(rut),
                sapToi: sapToi.slice(0, SAP_TOI_TOI_DA).map(rut),
                ...(sapToi.length > SAP_TOI_TOI_DA ? { conMocSapToiKhac: sapToi.length - SAP_TOI_TOI_DA } : {}),
                soMocDaNop: daNop.length,
                soDuThuePhaiNopTrenSo: {
                    gtgt: tien(soDu.vatPayable),
                    tndn: tien(soDu.citPayable),
                    tncn: tien(soDu.pitPayable),
                    tong: tien(soDu.total),
                    ghiChu: `Số dư sổ cái tới hết năm ${year} (Có − Nợ): dương = còn phải nộp, âm = đã nộp thừa / còn được khấu trừ. Chỉ đúng khi bút toán nộp thuế đã được ghi sổ.`,
                },
                ghiChu: 'soTien = null nghĩa là CHƯA suy ra được (thiếu tờ khai / thiếu số liệu), KHÔNG phải không phải nộp. Số "ước tính" chưa phải số trên tờ khai chính thức.',
            }
        },
    },
    {
        name: 'einvoice_status',
        description: 'HOÁ ĐƠN ĐIỆN TỬ BÁN RA — đúng trang Hoá đơn ĐT: số phiếu ĐANG CHỜ xuất hoá đơn (đơn đã giao chưa có HĐ, theo sàn / theo ngày), số hoá đơn đã gửi cơ quan thuế và số LỖI trong N ngày (kèm các lỗi gần nhất), số hoá đơn CẦN ĐIỀU CHỈNH / THAY THẾ vì khách trả hàng, và cấu hình tự xuất. Gọi khi hỏi "hoá đơn có lỗi không", "còn bao nhiêu đơn chưa xuất hoá đơn", "hoá đơn nào phải điều chỉnh". CHỈ ĐỌC — không xuất hay huỷ hoá đơn nào.',
        inputSchema: {
            type: 'object',
            properties: {
                days: { type: 'number', description: 'Số ngày gần nhất để đếm đã gửi / lỗi (mặc định 30, tối đa 90)' },
            },
            additionalProperties: false,
        },
        run: async (a, { prisma }: ToolCtx) => {
            const days = Math.min(Math.max(soNguyen(a.days) || 30, 1), 90)
            const now = new Date()
            const tuLichSu = new Date(now.getTime() - days * MOT_NGAY)
            try {
                const config = await getActiveConfig(prisma)
                const extra = parseConfigExtra(config)
                // Hàng đợi tính TỪ MỐC BẬT TỰ XUẤT nếu có — y như GET /einvoice/queue
                const neo = extra.autoIssueSince ? new Date(extra.autoIssueSince) : null
                const tuHangDoi = neo && !isNaN(neo.getTime()) ? neo : tuLichSu
                const stats: any = await invoiceQueueStats(prisma, tuHangDoi, now)
                const dem = await demXuatHoaDon(prisma, tuLichSu)
                const loi: any[] = await prisma.eInvoice.findMany({
                    where: { transactionId: { not: null }, createdAt: { gte: tuLichSu }, status: 'ERROR' },
                    orderBy: { createdAt: 'desc' },
                    take: 5,
                    select: { errorMessage: true, createdAt: true, totalAmount: true, transactionId: true },
                })
                const phieu: any[] = loi.length
                    ? await prisma.transaction.findMany({ where: { id: { in: loi.map(l => l.transactionId) } }, select: { id: true, receiptNumber: true } })
                    : []
                const soPhieu = new Map(phieu.map(p => [p.id, p.receiptNumber]))
                const dc = await hoaDonCanDieuChinh(prisma)
                const theoNgay: any[] = Array.isArray(stats.byDay) ? stats.byDay : []
                return {
                    cauHinh: {
                        daCauHinhNhaCungCap: !!config,
                        nhaCungCap: config?.provider || null,
                        tuXuatKhiGiaoHang: !!extra.autoIssueOnDelivery,
                        tuXuatTuNgay: extra.autoIssueSince || null,
                    },
                    hangDoiChoXuat: {
                        tinhTu: tuHangDoi.toISOString().slice(0, 10),
                        soPhieu: Number(stats.totals?.n) || 0,
                        tongTien: tien(stats.totals?.amount),
                        trongDoCoTraHang: Number(stats.totals?.returns) || 0,
                        theoSan: (stats.byPlatform || []).map((s: any) => ({ san: s.platform, soPhieu: s.n, tongTien: tien(s.amount) })),
                        theoNgayGanNhat: theoNgay.slice(0, 7).map((d: any) => ({ ngay: d.day, soPhieu: d.n, tongTien: tien(d.amount) })),
                    },
                    lichSuXuat: {
                        soNgay: days,
                        daGuiCoQuanThue: dem.sent,
                        loi: dem.errors,
                        tyLeLoi: dem.sent + dem.errors > 0 ? `${Math.round(dem.errors * 1000 / (dem.sent + dem.errors)) / 10}%` : null,
                        loiGanNhat: loi.map(l => ({
                            phieu: soPhieu.get(l.transactionId) || null,
                            luc: l.createdAt,
                            tien: tien(l.totalAmount),
                            loi: String(l.errorMessage || '').slice(0, 200),
                        })),
                    },
                    canDieuChinh: {
                        ...canhBaoCat(dc.total, 300, 'hoá đơn'),
                        soHoaDon: dc.total,
                        tongTienKhachDuocHoan: tien(dc.totalRefund),
                        traToanBoNenThayThe: dc.fullReturns,
                        mau: dc.items.slice(0, 5).map((r: any) => ({
                            hoaDon: [r.invoiceSymbol, r.invoiceNumber].filter(Boolean).join(' ') || null,
                            phieu: r.receiptNumber,
                            phieuTra: r.returnCode,
                            tienHoan: tien(r.refundAmount),
                            nenLam: r.suggestionLabel,
                        })),
                    },
                }
            } catch (e: any) {
                if (thieuBang(e)) return { daDungHoaDonDienTu: false, ghiChu: 'Cửa hàng chưa bật hoá đơn điện tử (chưa có bảng dữ liệu) — vào Hoá đơn ĐT › Cài đặt để kết nối nhà cung cấp.' }
                throw new ToolError(`Không đọc được dữ liệu hoá đơn điện tử: ${e?.message || e}`)
            }
        },
    },
    {
        name: 'tax_stock',
        description: 'TỒN KHO THUẾ theo mã hàng — đúng trang Tồn Kho Thuế: số đã NHẬP CÓ HOÁ ĐƠN VAT − số đã bán VÀ đã xuất hoá đơn + hàng trả lại đã điều chỉnh hoá đơn. Mã ÂM = đã xuất hoá đơn bán nhiều hơn số mua vào có hoá đơn (rủi ro khi thanh tra, cần bổ sung hoá đơn đầu vào). Gọi khi hỏi "tồn kho thuế thế nào", "mã nào thiếu hoá đơn đầu vào", "mã X còn xuất hoá đơn được không". Có thể tìm theo mã / tên. CHỈ ĐỌC.',
        inputSchema: {
            type: 'object',
            properties: {
                q: { type: 'string', description: 'Tìm theo mã SKU hoặc tên hàng (bỏ trống = xem các mã đang âm)' },
                limit: { type: 'number', description: 'Số dòng trả về (mặc định 20, tối đa 50)' },
            },
            additionalProperties: false,
        },
        run: async (a, { prisma }: ToolCtx) => {
            const tran = Math.min(Math.max(soNguyen(a.limit) || 20, 1), 50)
            const q = String(a.q || '').trim()
            const DOC_TOI_DA = 1000
            let kq: { rows: any[]; tongThieu: number }
            try {
                kq = await tonKhoThue(prisma, { q, limit: DOC_TOI_DA })
            } catch (e: any) {
                if (thieuBang(e)) return { ghiChu: 'Chưa có dữ liệu tồn kho thuế (cửa hàng chưa dùng hoá đơn điện tử / phiếu nhập có hoá đơn).' }
                throw new ToolError(`Không đọc được tồn kho thuế: ${e?.message || e}`)
            }
            const dong = (r: any) => ({
                sku: r.sku,
                ten: r.name,
                nhapCoHoaDon: Number(r.nhapVat) || 0,
                daXuatHoaDon: Number(r.xuat) || 0,
                traLaiDaDieuChinh: Number(r.traLai) || 0,
                ton: Number(r.ton) || 0,
            })
            const am = kq.rows.filter(r => Number(r.ton) < 0)
            return {
                // Câu SQL xếp tồn TĂNG DẦN ⇒ mọi mã âm nằm đầu; đọc chạm trần mà toàn âm thì còn mã âm chưa đọc
                ...(kq.rows.length >= DOC_TOI_DA && am.length >= DOC_TOI_DA ? canhBaoCat(DOC_TOI_DA, DOC_TOI_DA, 'mã') : {}),
                ...(q ? { timKiem: q, soMaKhop: kq.rows.length } : {}),
                soMaAm: am.length,
                tongSoLuongAm: am.reduce((s, r) => s - (Number(r.ton) || 0), 0),
                ...(q
                    ? { ketQua: kq.rows.slice(0, tran).map(dong), ...canhBaoMau(kq.rows.length, tran, 'mã') }
                    : { maAmNhieuNhat: am.slice(0, tran).map(dong), ...canhBaoMau(am.length, tran, 'mã') }),
                cachTinh: 'tồn = nhập có hoá đơn VAT (phiếu nhập hoàn tất) − đã bán và đã xuất hoá đơn + hàng trả lại đã lập hoá đơn điều chỉnh. Bán mà CHƯA xuất hoá đơn thì chưa trừ.',
            }
        },
    },
    {
        name: 'tax_pit',
        description: 'QUYẾT TOÁN THUẾ TNCN NĂM (mẫu 05/QTT-TNCN) — đúng trang Kế Toán Lương › Quyết toán TNCN: tổng thu nhập, giảm trừ (bảo hiểm, bản thân, người phụ thuộc), thu nhập tính thuế, thuế phải nộp theo biểu luỹ tiến, đã khấu trừ trong năm, còn phải nộp / được hoàn — tổng và từng nhân viên. Lấy bản ĐÃ LƯU nếu có, không thì tự tính từ bảng lương. Gọi khi hỏi về thuế thu nhập cá nhân của nhân viên, quyết toán TNCN. CHỈ ĐỌC.',
        inputSchema: {
            type: 'object',
            properties: { year: SCHEMA_NAM },
            additionalProperties: false,
        },
        run: async (a, { prisma }: ToolCtx) => {
            const year = soNguyen(a.year) || gioVN().getUTCFullYear()
            let kq: Awaited<ReturnType<typeof docQuyetToanTncn>>
            try {
                kq = await docQuyetToanTncn(prisma, year)
            } catch (e: any) {
                if (thieuBang(e)) return { nam: year, ghiChu: 'Chưa có dữ liệu bảng lương để quyết toán TNCN.' }
                throw e
            }
            const ds = [...kq.employees].sort((x, y) => Math.abs(y.balanceDue) - Math.abs(x.balanceDue))
            const TRAN = 20
            const s: any = kq.summary || {}
            /* NQ 110/2025/UBTVQH15: từ KỲ TÍNH THUẾ 2026 giảm trừ bản thân 15,5tr/tháng, người phụ thuộc
             * 6,2tr/tháng (quyết toán 2025 vẫn 11tr / 4,4tr). Bộ tính hiện dùng mức cũ cho mọi năm ⇒ AI phải
             * nói rõ, không trình bày số năm 2026 như số chuẩn. */
            const mucCuChoNamMoi = year >= 2026 && PIT_SELF_DEDUCTION_PER_MONTH < 15_500_000
            return {
                nam: year,
                nguon: kq.source === 'saved' ? 'bản quyết toán đã lưu' : 'tự tính từ bảng lương (chưa lưu quyết toán)',
                ...('status' in kq ? { trangThaiBanDaLuu: kq.status } : {}),
                tongHop: {
                    soNhanVien: Number(s.totalEmployees) || kq.employees.length,
                    tongThuNhap: tien(s.totalIncome),
                    tongGiamTru: tien(s.totalDeductions),
                    thuNhapTinhThue: tien(s.totalTaxableIncome),
                    thuePhaiNop: tien(s.totalTax),
                    daKhauTruTrongNam: tien(s.totalWithheld),
                    chenhLech: tien(s.totalBalanceDue),
                    ghiChuChenhLech: 'dương = còn phải nộp thêm, âm = nộp thừa / được hoàn',
                },
                giamTruDangDung: {
                    banThanMoiThang: PIT_SELF_DEDUCTION_PER_MONTH,
                    moiNguoiPhuThuocMoiThang: PIT_DEPENDENT_DEDUCTION_PER_MONTH,
                },
                ...(mucCuChoNamMoi ? {
                    canhBaoMucGiamTru: `Bảng tính đang dùng mức giảm trừ CŨ (${PIT_SELF_DEDUCTION_PER_MONTH.toLocaleString('vi-VN')}đ bản thân, ${PIT_DEPENDENT_DEDUCTION_PER_MONTH.toLocaleString('vi-VN')}đ mỗi người phụ thuộc mỗi tháng). Từ kỳ tính thuế 2026 mức mới là 15.500.000đ và 6.200.000đ (Nghị quyết 110/2025/UBTVQH15) ⇒ thuế TNCN năm ${year} ở đây đang bị tính CAO hơn thực tế. PHẢI nói rõ điều này với chủ shop, đừng trình bày như số chuẩn.`,
                } : {}),
                ...canhBaoMau(ds.length, TRAN, 'nhân viên'),
                nhanVien: ds.slice(0, TRAN).map(e => ({
                    ten: e.name,
                    maNhanVien: e.employeeCode,
                    soThang: e.monthsWorked,
                    thuNhap: tien(e.totalIncome),
                    giamTru: tien(e.deductions),
                    thuNhapTinhThue: tien(e.taxableIncome),
                    thuePhaiNop: tien(e.taxAmount),
                    daKhauTru: tien(e.pitWithheld),
                    chenhLech: tien(e.balanceDue),
                })),
            }
        },
    },
]

/** Tên các công cụ dùng cho chế độ "Hỏi AI về thuế" (mcpAgent chuDe='thue'): bộ thuế + sổ sách + soát dữ liệu. */
export const TEN_TOOL_THUE: string[] = [
    ...TAX_TOOLS.map(t => t.name),
    // soát thuế / thanh tra / đối chiếu / TNDN / HKD (mcpFinanceTools)
    'tax_audit_check', 'tax_trace_document', 'tax_audit_drill', 'tax_assessment_risk', 'tax_remediation_plan',
    'tax_cit_settlement', 'tax_reconcile_3way', 'hkd_bo_thue_khoan_2026', 'data_health_check',
    // số kinh doanh hay được hỏi kèm thuế
    'revenue_by_day', 'profit_report', 'expense_report', 'list_import_receipts',
    // sổ sách (mcpAccountingTools)
    'accounting_trial_balance', 'accounting_journal', 'accounting_ledger', 'accounting_cash_book',
    'accounting_income_statement', 'accounting_balance_sheet', 'accounting_cash_flow', 'accounting_account_balance',
    'accounting_chart_of_accounts',
]
