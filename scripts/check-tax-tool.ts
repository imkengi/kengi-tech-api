/**
 * Kiểm chứng tool MCP `tax_audit_check` — chạy: npx tsx scripts/check-tax-tool.ts
 *
 * Chạy tool bằng prisma GIẢ để chắc chắn: tool có mặt trong danh sách, nhận đúng
 * tham số kỳ, và trả về đủ các khối mà trợ lý AI cần để trả lời chủ cửa hàng.
 */

import { FINANCE_TOOLS } from '../src/routes/mcpFinanceTools'

const NGAY = (s: string) => new Date(`${s}T03:00:00.000Z`)

function fakePrisma() {
    const chuoi = (v: string, w: any) => {
        if (!w) return true
        if (w.gte !== undefined && v < w.gte) return false
        if (w.lte !== undefined && v > w.lte) return false
        if (w.lt !== undefined && !(v < w.lt)) return false
        if (w.gt !== undefined && !(v > w.gt)) return false
        return true
    }
    const journal = [
        { date: '2026-08-05', debitAccount: '111', creditAccount: '511', amount: 100_000_000 },
        { date: '2026-08-05', debitAccount: '111', creditAccount: '3331', amount: 10_000_000 },
        { date: '2026-08-01', debitAccount: '112', creditAccount: '411', amount: 60_000_000 },
    ]
    return {
        journalEntry: { findMany: async ({ where }: any = {}) => journal.filter(e => chuoi(e.date, where?.date)) },
        // Tờ khai khai THIẾU 20 triệu so với sổ → tool phải chỉ ra
        taxDeclaration: {
            findFirst: async () => ({ period: '2026-08', ct29: 80_000_000, ct30: 8_000_000, ct33: 0 }),
            findMany: async () => [{ period: '2026-08' }],
        },
        eInvoice: {
            findMany: async () => [],
            findFirst: async () => null,
        },
        expense: { findMany: async () => [] },
        importReceipt: { findMany: async () => [], findFirst: async () => null },
        product: { findMany: async () => [] },
        transaction: {
            findMany: async () => [{ id: 't1', receiptNumber: 'HD1', total: 110_000_000, createdAt: NGAY('2026-08-05'), items: [] }],
            findFirst: async ({ where }: any = {}) => where?.receiptNumber === 'HD1'
                ? { id: 't1', receiptNumber: 'HD1', customerName: 'Khách', total: 110_000_000, amountReceived: 110_000_000, status: 'completed', createdAt: NGAY('2026-08-05'), items: [{ productName: 'Hàng', sku: 'H1', quantity: 1, unitPrice: 110_000_000, lineTotal: 110_000_000 }] }
                : null,
        },
        taxDeadline: { findMany: async () => [] },
        payrollPeriod: { findMany: async () => [] },
        payrollEntry: { findMany: async () => [] },
        employee: { findMany: async () => [] },
        storeSettings: { findFirst: async () => ({ businessType: 'company' }) },
        hkdRevenueEntry: { findMany: async () => [] },
        inventoryTransaction: { findMany: async () => [] },
        customer: { aggregate: async () => ({ _sum: { debt: 0 } }) },
        $queryRawUnsafe: async () => [],
    }
}

let soCa = 0, soLoi = 0
const kiemTra = (ten: string, dat: boolean, ghiChu = '') => {
    soCa++
    if (dat) console.log(`✓ ${ten}`)
    else { soLoi++; console.log(`✗ ${ten}${ghiChu ? ' — ' + ghiChu : ''}`) }
}

async function main() {
    const tool = FINANCE_TOOLS.find(t => t.name === 'tax_audit_check')
    kiemTra('Tool tax_audit_check có trong danh sách MCP tài chính', !!tool,
        `hiện có: ${FINANCE_TOOLS.map(t => t.name).join(', ')}`)
    if (!tool) { console.log(`\n${soCa - soLoi}/${soCa} ca đạt`); process.exit(1) }

    kiemTra('Mô tả nói rõ CHỈ ĐỌC để trợ lý không tưởng là tool sửa dữ liệu',
        /CHỈ ĐỌC/i.test(tool.description))

    const kq: any = await (tool as any).run({ year: 2026, month: 8 }, { prisma: fakePrisma() } as any)
    kiemTra('Trả đúng nhãn kỳ theo tham số tháng', kq?.ky === 'tháng 8/2026', String(kq?.ky))
    kiemTra('Có đủ ba nguồn doanh thu để đối chiếu',
        kq?.doanhThuBaNguon && 'so' in kq.doanhThuBaNguon && 'toKhai' in kq.doanhThuBaNguon && 'hoaDon' in kq.doanhThuBaNguon,
        JSON.stringify(kq?.doanhThuBaNguon))
    kiemTra('Bắt được chênh lệch sổ vs tờ khai 20 triệu',
        kq?.canhBao?.some((c: any) => c.noiDung.includes('tờ khai') && c.tienRuiRo === 20_000_000),
        JSON.stringify(kq?.canhBao?.map((c: any) => [c.noiDung, c.tienRuiRo])))
    kiemTra('Mỗi cảnh báo đều kèm căn cứ pháp lý và việc cần làm',
        (kq?.canhBao ?? []).every((c: any) => c.canCu && c.viecCanLam))
    kiemTra('Có ước tính tiền phải nộp thêm và bảng khoản bị loại',
        !!kq?.uocTinhPhaiNopThem && !!kq?.khoanBiLoaiKhiQuyetToan)
    kiemTra('Có ghi chú không thay thế kế toán/tư vấn thuế',
        /không thay thế/i.test(String(kq?.ghiChu)))

    const kqNam: any = await (tool as any).run({ year: 2026 }, { prisma: fakePrisma() } as any)
    kiemTra('Không truyền tháng/quý thì soát cả năm', kqNam?.ky === 'năm 2026', String(kqNam?.ky))

    // ── Ba tool thanh tra mới ────────────────────────────────────────────────
    for (const ten of ['tax_trace_document', 'tax_audit_drill', 'tax_assessment_risk']) {
        const t = FINANCE_TOOLS.find(x => x.name === ten)
        kiemTra(`Tool ${ten} có trong danh sách`, !!t)
        kiemTra(`Tool ${ten} khai rõ CHỈ ĐỌC`, !!t && /CHỈ ĐỌC/i.test(t.description))
        kiemTra(`Tool ${ten} nói rõ khi nào gọi`, !!t && /Gọi khi/.test(t.description))
    }

    const traceTool = FINANCE_TOOLS.find(t => t.name === 'tax_trace_document')!
    const trace: any = await (traceTool as any).run({ ma: 'HD1' }, { prisma: fakePrisma() } as any)
    kiemTra('Truy vết tìm được phiếu bán',
        trace?.timThay === true && trace?.loaiChungTu === 'ban-hang', String(trace?.loaiChungTu))
    kiemTra('Truy vết trả các mốc kèm câu đoàn hay hỏi',
        Array.isArray(trace?.cacMoc) && trace.cacMoc.every((m: any) => !!m.doanHayHoi))
    kiemTra('Truy vết bắt được thiếu hóa đơn điện tử',
        trace?.soMatXichDut >= 1 && trace?.diemSeBiHoi?.some((c: string) => c.includes('hóa đơn')),
        JSON.stringify(trace?.diemSeBiHoi))
    let loiThieuMa: any = null
    try { await (traceTool as any).run({}, { prisma: fakePrisma() } as any) } catch (e) { loiThieuMa = e }
    kiemTra('Truy vết thiếu mã thì báo lỗi rõ ràng',
        !!loiThieuMa && /mã chứng từ/i.test(String(loiThieuMa.message)))

    const drillTool = FINANCE_TOOLS.find(t => t.name === 'tax_audit_drill')!
    const drill: any = await (drillTool as any).run({ year: 2026, month: 8 }, { prisma: fakePrisma() } as any)
    kiemTra('Mô phỏng trả bộ câu hỏi',
        Array.isArray(drill?.cauHoi) && drill.cauHoi.length >= 14, String(drill?.cauHoi?.length))
    kiemTra('Mỗi câu đều có lời giải thích vì sao đoàn hỏi',
        drill?.cauHoi?.every((c: any) => !!c.viSaoHoHoi && !!c.traLoiTuSoLieu))
    kiemTra('Mô phỏng bắt được lệch doanh thu sổ vs tờ khai',
        drill?.cauHoi?.some((c: any) => c.cauHoi.includes('Doanh thu') && c.mucDo === 'nguy-hiem'))

    const anDinhTool = FINANCE_TOOLS.find(t => t.name === 'tax_assessment_risk')!
    const anDinh: any = await (anDinhTool as any).run({ year: 2026, month: 8 }, { prisma: fakePrisma() } as any)
    kiemTra('Ấn định trả căn cứ kèm cách cãi lại',
        Array.isArray(anDinh?.canCuAnDinhTimThay) && anDinh.canCuAnDinhTimThay.every((c: any) => !!c.caiLaiTheNao))
    kiemTra('Ấn định bắt được số liệu lệch tờ khai',
        anDinh?.canCuAnDinhTimThay?.some((c: any) => c.dieuKhoan.includes('Điều 50')),
        JSON.stringify(anDinh?.canCuAnDinhTimThay?.map((c: any) => c.dieuKhoan)))
    kiemTra('Ấn định luôn kèm ghi chú là ước tính minh họa',
        /ƯỚC TÍNH MINH HỌA/.test(String(anDinh?.ghiChu)))
    kiemTra('Ấn định có ít nhất một kịch bản tính tiền',
        Array.isArray(anDinh?.kichBan) && anDinh.kichBan.length > 0)

    console.log(`\n${soCa - soLoi}/${soCa} ca đạt`)
    process.exit(soLoi > 0 ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(1) })
