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
        eInvoice: { findMany: async () => [] },
        expense: { findMany: async () => [] },
        importReceipt: { findMany: async () => [] },
        product: { findMany: async () => [] },
        transaction: { findMany: async () => [{ id: 't1', receiptNumber: 'HD1', total: 110_000_000, createdAt: NGAY('2026-08-05'), items: [] }] },
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

    console.log(`\n${soCa - soLoi}/${soCa} ca đạt`)
    process.exit(soLoi > 0 ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(1) })
