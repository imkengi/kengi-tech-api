/**
 * Kiểm chứng bộ KIỂM TRA TRƯỚC THANH TRA THUẾ bằng dữ liệu giả.
 *
 * Chạy:  npx tsx scripts/check-tax-audit.ts
 *
 * Đây là phần dễ gây thiệt hại nhất nếu sai: báo nhầm thì kế toán đi sửa những
 * thứ không cần sửa, bỏ sót thì tới lúc thanh tra mới biết. Nên mỗi phép kiểm
 * tra đều có 2 ca: một ca PHẢI kêu, một ca PHẢI im.
 */

import { kiemTraThue, NGUONG_KHONG_TIEN_MAT, NGUONG_CHI_CAN_HOA_DON, type KhoangKy } from '../src/lib/taxAudit'

const KY: KhoangKy = {
    from: '2026-08-01', to: '2026-08-31',
    start: new Date('2026-08-01T00:00:00.000Z'),
    end: new Date('2026-09-01T00:00:00.000Z'),
    maKy: '2026-08', nhan: 'tháng 8/2026',
}

interface Kho {
    journal: any[]
    declarations: any[]
    invoices: any[]
    expenses: any[]
    imports: any[]
    products: any[]
    transactions: any[]
    deadlines: any[]
    payrollPeriods: any[]
    payrollEntries: any[]
    employees: any[]
    settings: any
    hkdRevenue: any[]
}

function fakePrisma(k: Kho) {
    const chuoi = (v: string, w: any) => {
        if (!w) return true
        if (w.gte !== undefined && v < w.gte) return false
        if (w.lte !== undefined && v > w.lte) return false
        if (w.lt !== undefined && !(v < w.lt)) return false
        if (w.gt !== undefined && !(v > w.gt)) return false
        return true
    }
    const ngay = (v: any, w: any) => {
        if (!w) return true
        const t = new Date(v).getTime()
        if (w.gte !== undefined && t < new Date(w.gte).getTime()) return false
        if (w.lte !== undefined && t > new Date(w.lte).getTime()) return false
        return true
    }
    return {
        journalEntry: { findMany: async ({ where }: any = {}) => k.journal.filter(e => chuoi(e.date, where?.date)) },
        taxDeclaration: {
            findFirst: async ({ where }: any = {}) => k.declarations.find(d => d.period === where?.period) ?? null,
            findMany: async () => k.declarations,
        },
        eInvoice: { findMany: async ({ where }: any = {}) => k.invoices.filter(i => chuoi(i.invoiceDate, where?.invoiceDate)) },
        expense: { findMany: async ({ where }: any = {}) => k.expenses.filter(e => ngay(e.date, where?.date)) },
        importReceipt: { findMany: async ({ where }: any = {}) => k.imports.filter(i => ngay(i.createdAt, where?.createdAt)) },
        product: {
            findMany: async ({ where }: any = {}) => where?.stock?.lt !== undefined
                ? k.products.filter(p => (p.stock ?? 0) < where.stock.lt)
                : k.products,
        },
        transaction: { findMany: async ({ where }: any = {}) => k.transactions.filter(t => ngay(t.createdAt, where?.createdAt)) },
        taxDeadline: { findMany: async () => k.deadlines },
        // SQL thô cho phép soát "bán vượt hóa đơn đầu vào" — mặc định không có mã nào
        $queryRawUnsafe: async () => (k as any).banVuot ?? [],
        payrollPeriod: { findMany: async ({ where }: any = {}) => k.payrollPeriods.filter(p => !where?.year || p.year === where.year) },
        payrollEntry: {
            findMany: async ({ where }: any = {}) => k.payrollEntries.filter(e =>
                !where?.periodId?.in || where.periodId.in.includes(e.periodId)),
        },
        employee: {
            findMany: async ({ where }: any = {}) => k.employees.filter(n =>
                !where?.id?.in || where.id.in.includes(n.id)),
        },
        storeSettings: { findFirst: async () => k.settings },
        hkdRevenueEntry: { findMany: async () => k.hkdRevenue },
    }
}

/** Cửa hàng SẠCH: sổ = tờ khai = hóa đơn, không dấu hiệu nào */
function khoSach(): Kho {
    return {
        journal: [
            // Doanh thu 100tr, VAT ra 10tr, thu tiền mặt
            { date: '2026-08-05', debitAccount: '111', creditAccount: '511', amount: 100_000_000 },
            { date: '2026-08-05', debitAccount: '111', creditAccount: '3331', amount: 10_000_000 },
            // VAT vào 4tr
            { date: '2026-08-03', debitAccount: '1331', creditAccount: '331', amount: 4_000_000 },
            { date: '2026-08-01', debitAccount: '111', creditAccount: '411', amount: 50_000_000 },
            /* Một dòng tiền vào qua NGÂN HÀNG (vay 341, không phải doanh thu) để
             * cửa hàng mẫu không bị coi là 100% tiền mặt — cửa hàng thật hiếm khi
             * thu toàn tiền mặt, và để nguyên thì mọi ca "sổ sạch" đều vướng. */
            { date: '2026-08-02', debitAccount: '112', creditAccount: '341', amount: 40_000_000 },
        ],
        /* Cửa hàng sạch = đã khai đủ các kỳ đã qua trong năm (1–8/2026), kỳ đang
         * soát có số khớp sổ. Thiếu phần này thì chính bộ soát sẽ kêu "chưa khai
         * các tháng đầu năm" — và nó kêu đúng. */
        declarations: [
            ...Array.from({ length: 7 }, (_, i) => ({ period: `2026-${String(i + 1).padStart(2, '0')}`, ct29: 0, ct30: 0, ct33: 0 })),
            { period: '2026-08', ct29: 100_000_000, ct30: 10_000_000, ct33: 4_000_000 },
        ],
        invoices: [
            { invoiceDate: '2026-08-05', invoiceType: 'SALE', status: 'SIGNED', totalBeforeVat: 100_000_000, vatAmount: 10_000_000, totalAmount: 110_000_000 },
        ],
        expenses: [],
        imports: [],
        products: [{ name: 'Sữa', stock: 10, costPrice: 20_000 }],
        transactions: [],
        deadlines: [],
        // Có bảng lương hợp lệ: thu nhập dưới ngưỡng nên không phải khấu trừ TNCN
        payrollPeriods: [{ id: 'p8', month: 8, year: 2026, status: 'paid', totalGross: 10_000_000 }],
        payrollEntries: [{ periodId: 'p8', employeeId: 'nv1', employeeName: 'Nguyễn A', grossSalary: 10_000_000, totalInsuranceEmployee: 1_050_000, pitAmount: 0, dependents: 0 }],
        employees: [{ id: 'nv1', name: 'Nguyễn A', taxCode: '8123456789' }],
        settings: { businessType: 'company' },
        hkdRevenue: [],
    }
}

let soCa = 0, soLoi = 0
const co = (h: any, code: string) => h.canhBao.some((c: any) => c.code === code)
const lay = (h: any, code: string) => h.canhBao.find((c: any) => c.code === code)
function kiemTra(ten: string, dat: boolean, ghiChu = '') {
    soCa++
    if (dat) console.log(`✓ ${ten}`)
    else { soLoi++; console.log(`✗ ${ten}${ghiChu ? ' — ' + ghiChu : ''}`) }
}

async function main() {
    // ── 1. Sổ sạch: không cảnh báo, điểm 100 ───────────────────────────────
    {
        const h = await kiemTraThue(fakePrisma(khoSach()), KY)
        kiemTra('Hồ sơ sạch — không cảnh báo, điểm 100 "Sẵn sàng"',
            h.canhBao.length === 0 && h.diem === 100 && h.xepLoai === 'Sẵn sàng',
            `${h.canhBao.length} cảnh báo (${h.canhBao.map((c: any) => c.code).join(',')}), điểm ${h.diem}`)
    }

    // ── 2. Doanh thu sổ lệch tờ khai ───────────────────────────────────────
    {
        const k = khoSach()
        k.declarations = [{ period: '2026-08', ct29: 80_000_000, ct30: 8_000_000, ct33: 4_000_000 }]
        const h = await kiemTraThue(fakePrisma(k), KY)
        const c = lay(h, 'dt-so-vs-tokhai')
        kiemTra('Bắt lệch doanh thu sổ vs tờ khai (đúng 20tr)',
            !!c && c.tienRuiRo === 20_000_000 && c.muc === 'cao', JSON.stringify(c?.tienRuiRo))
    }

    // ── 3. Kỳ có doanh thu mà chưa có tờ khai ──────────────────────────────
    {
        const k = khoSach(); k.declarations = []
        const h = await kiemTraThue(fakePrisma(k), KY)
        kiemTra('Bắt kỳ có doanh thu nhưng thiếu tờ khai', co(h, 'thieu-to-khai'))
    }

    // ── 4. Doanh thu sổ lệch hóa đơn điện tử ───────────────────────────────
    {
        const k = khoSach()
        k.invoices = [{ invoiceDate: '2026-08-05', invoiceType: 'SALE', status: 'SIGNED', totalBeforeVat: 60_000_000 }]
        const h = await kiemTraThue(fakePrisma(k), KY)
        const c = lay(h, 'dt-so-vs-hoadon')
        kiemTra('Bắt doanh thu chưa xuất hóa đơn (lệch 40tr)', !!c && c.tienRuiRo === 40_000_000, JSON.stringify(c?.tienRuiRo))
    }

    // ── 5. Hóa đơn trả lại phải TRỪ khỏi doanh thu hóa đơn ─────────────────
    {
        const k = khoSach()
        k.invoices = [
            { invoiceDate: '2026-08-05', invoiceType: 'SALE', status: 'SIGNED', totalBeforeVat: 130_000_000 },
            { invoiceDate: '2026-08-20', invoiceType: 'RETURN', status: 'SIGNED', totalBeforeVat: 30_000_000 },
        ]
        const h = await kiemTraThue(fakePrisma(k), KY)
        kiemTra('Hóa đơn trả lại được trừ đúng (130−30=100, không kêu)', !co(h, 'dt-so-vs-hoadon'),
            JSON.stringify(h.doanhThu))
    }

    // ── 6. Hóa đơn nháp/hủy KHÔNG được tính vào doanh thu ──────────────────
    {
        const k = khoSach()
        k.invoices = [
            { invoiceDate: '2026-08-05', invoiceType: 'SALE', status: 'SIGNED', totalBeforeVat: 100_000_000 },
            { invoiceDate: '2026-08-06', invoiceType: 'SALE', status: 'DRAFT', totalBeforeVat: 50_000_000 },
            { invoiceDate: '2026-08-07', invoiceType: 'SALE', status: 'CANCELLED', totalBeforeVat: 70_000_000 },
        ]
        const h = await kiemTraThue(fakePrisma(k), KY)
        kiemTra('Hóa đơn nháp/hủy không tính vào doanh thu', h.doanhThu.hoaDon === 100_000_000, String(h.doanhThu.hoaDon))
    }

    // ── 7. Thanh toán tiền mặt vượt ngưỡng khấu trừ ────────────────────────
    {
        const k = khoSach()
        k.expenses = [
            { id: 'e1', description: 'Mua thiết bị', amount: NGUONG_KHONG_TIEN_MAT + 1_000_000, vatAmount: 600_000, invoiceNo: 'HD123', paidBy: 'cash', date: new Date('2026-08-10'), status: 'active', category: 'supplies' },
            { id: 'e2', description: 'Mua thiết bị 2', amount: NGUONG_KHONG_TIEN_MAT + 5_000_000, vatAmount: 1_000_000, invoiceNo: 'HD124', paidBy: 'bank', date: new Date('2026-08-11'), status: 'active', category: 'supplies' },
        ]
        const h = await kiemTraThue(fakePrisma(k), KY)
        const c = lay(h, 'tien-mat-vuot-nguong')
        kiemTra('Bắt đúng 1 khoản tiền mặt vượt ngưỡng (khoản chuyển khoản KHÔNG bị kêu)',
            !!c && c.soLuong === 1, JSON.stringify(c?.soLuong))
    }

    // ── 8. Trả tiền NCC không bị tính là chi phí thiếu hóa đơn ─────────────
    {
        const k = khoSach()
        k.expenses = [
            { id: 'e3', description: 'Trả tiền NCC A', amount: 50_000_000, paidBy: 'cash', date: new Date('2026-08-12'), status: 'active', category: 'supplier_payment' },
        ]
        const h = await kiemTraThue(fakePrisma(k), KY)
        kiemTra('Trả nợ NCC không bị kêu thiếu hóa đơn / vượt ngưỡng tiền mặt',
            !co(h, 'chi-khong-hoa-don') && !co(h, 'tien-mat-vuot-nguong'),
            h.canhBao.map((c: any) => c.code).join(','))
    }

    // ── 9. Chi phí thiếu hóa đơn → ước thuế TNDN 20% ───────────────────────
    {
        const k = khoSach()
        k.expenses = [
            { id: 'e4', description: 'Chi tiếp khách', amount: 10_000_000, paidBy: 'cash', date: new Date('2026-08-13'), status: 'active', category: 'food' },
            { id: 'e5', description: 'Chi lặt vặt', amount: NGUONG_CHI_CAN_HOA_DON - 1, paidBy: 'cash', date: new Date('2026-08-13'), status: 'active', category: 'other' },
        ]
        const h = await kiemTraThue(fakePrisma(k), KY)
        const c = lay(h, 'chi-khong-hoa-don')
        kiemTra('Chi ≥ ngưỡng thiếu hóa đơn bị kêu, chi nhỏ thì không; rủi ro = 20%',
            !!c && c.soLuong === 1 && c.tienRuiRo === 2_000_000, JSON.stringify(c))
    }

    // ── 10. Tồn kho âm ─────────────────────────────────────────────────────
    {
        const k = khoSach()
        k.products = [{ name: 'Sữa', stock: -8, costPrice: 25_000 }, { name: 'Bánh', stock: 5, costPrice: 10_000 }]
        const h = await kiemTraThue(fakePrisma(k), KY)
        const c = lay(h, 'ton-kho-am')
        kiemTra('Bắt tồn kho âm, tính đúng giá trị 200k', !!c && c.soLuong === 1 && c.tienRuiRo === 200_000, JSON.stringify(c?.tienRuiRo))
    }

    // ── 11. Quỹ tiền mặt âm giữa kỳ (dù cuối kỳ dương) ─────────────────────
    {
        const k = khoSach()
        k.journal = [
            { date: '2026-08-02', debitAccount: '642', creditAccount: '111', amount: 30_000_000 }, // chi trước khi có thu
            { date: '2026-08-20', debitAccount: '111', creditAccount: '511', amount: 100_000_000 },
        ]
        k.declarations = [{ period: '2026-08', ct29: 100_000_000, ct30: 0, ct33: 0 }]
        k.invoices = [{ invoiceDate: '2026-08-20', invoiceType: 'SALE', status: 'SIGNED', totalBeforeVat: 100_000_000 }]
        const h = await kiemTraThue(fakePrisma(k), KY)
        kiemTra('Bắt quỹ tiền mặt âm giữa kỳ dù cuối kỳ dương', co(h, 'quy-am-trong-ky'),
            h.canhBao.map((c: any) => c.code).join(','))
    }

    // ── 12. Bán dưới giá vốn ───────────────────────────────────────────────
    {
        const k = khoSach()
        k.transactions = [{
            receiptNumber: 'HD001', createdAt: new Date('2026-08-09'),
            items: [
                { productName: 'Sữa', quantity: 10, lineTotal: 150_000, product: { costPrice: 25_000 } }, // lỗ 100k
                { productName: 'Bánh', quantity: 2, lineTotal: 100_000, product: { costPrice: 20_000 } }, // lãi
            ],
        }]
        const h = await kiemTraThue(fakePrisma(k), KY)
        const c = lay(h, 'ban-duoi-gia-von')
        kiemTra('Bắt bán dưới giá vốn, đúng 1 dòng lỗ 100k', !!c && c.soLuong === 1 && c.tienRuiRo === 100_000, JSON.stringify(c?.tienRuiRo))
    }

    // ── 13. Hồ sơ khai thuế quá hạn ────────────────────────────────────────
    {
        const k = khoSach()
        k.deadlines = [
            { taxType: 'GTGT', period: '2026-06', dueDate: '2026-07-20', status: 'pending' },
            { taxType: 'GTGT', period: '2026-07', dueDate: '2026-08-20', status: 'filed' },
            { taxType: 'TNDN', period: '2030-01', dueDate: '2030-01-30', status: 'pending' },
        ]
        const h = await kiemTraThue(fakePrisma(k), KY)
        const c = lay(h, 'to-khai-tre-han')
        kiemTra('Bắt hồ sơ quá hạn, bỏ qua hồ sơ đã nộp và hạn tương lai',
            !!c && c.soLuong === 1, JSON.stringify(c?.soLuong))
    }

    // ── 14. Hóa đơn hủy nhiều bất thường ───────────────────────────────────
    {
        const k = khoSach()
        k.invoices = Array.from({ length: 30 }, (_, i) => ({
            invoiceDate: '2026-08-05', invoiceType: 'SALE',
            status: i < 5 ? 'CANCELLED' : 'SIGNED',
            totalBeforeVat: i < 5 ? 0 : 4_000_000,
        }))
        const h = await kiemTraThue(fakePrisma(k), KY)
        kiemTra('Bắt tỉ lệ hóa đơn hủy cao (5/30)', co(h, 'hoadon-huy-nhieu'))
    }

    // ── 15. Điểm số phải tụt theo mức độ ───────────────────────────────────
    {
        const k = khoSach()
        k.products = [{ name: 'Sữa', stock: -8, costPrice: 25_000 }]
        k.declarations = [{ period: '2026-08', ct29: 50_000_000, ct30: 10_000_000, ct33: 4_000_000 }]
        const h = await kiemTraThue(fakePrisma(k), KY)
        kiemTra('Nhiều vấn đề nặng thì điểm tụt và xếp loại xấu đi',
            h.diem < 70 && h.canhBao[0].muc === 'cao', `điểm ${h.diem}, loại ${h.xepLoai}`)
    }

    // ── 16. Hóa đơn đầu vào thiếu thông tin bắt buộc ───────────────────────
    {
        const k = khoSach()
        k.expenses = [
            { id: 'e6', description: 'Mua văn phòng phẩm', amount: 3_300_000, vatAmount: 300_000, invoiceNo: 'HD1', supplierTaxCode: null, invoiceDate: new Date('2026-08-05'), paidBy: 'bank', date: new Date('2026-08-05'), status: 'active', category: 'supplies' },
            { id: 'e7', description: 'Mua mực in', amount: 2_200_000, vatAmount: 200_000, invoiceNo: 'HD2', supplierTaxCode: '0101234567', invoiceDate: new Date('2026-08-06'), paidBy: 'bank', date: new Date('2026-08-06'), status: 'active', category: 'supplies' },
        ]
        const h = await kiemTraThue(fakePrisma(k), KY)
        const c = lay(h, 'hoa-don-vao-thieu-thong-tin')
        kiemTra('Bắt hóa đơn đầu vào thiếu MST (hóa đơn đủ thông tin thì bỏ qua)',
            !!c && c.soLuong === 1 && c.tienRuiRo === 300_000, JSON.stringify(c?.soLuong))
    }

    // ── 17. Ước tính truy thu + phạt + chậm nộp ────────────────────────────
    {
        const k = khoSach()
        // Chỉ một nguồn định lượng: chi 10tr không hóa đơn → truy thu 2tr (20%)
        k.expenses = [
            { id: 'e8', description: 'Chi tiếp khách', amount: 10_000_000, paidBy: 'cash', date: new Date('2026-08-13'), status: 'active', category: 'food' },
        ]
        const h = await kiemTraThue(fakePrisma(k), KY)
        const u = h.uocTinhPhat
        const phatDung = u.truyThu === 2_000_000 && u.phatKhaiSai === 400_000
        const chamDung = u.chamNop === Math.round(2_000_000 * 0.0003 * u.soNgayCham)
        const tongDung = u.tong === u.truyThu + u.phatKhaiSai + u.chamNop
        kiemTra('Ước tính: truy thu 2tr, phạt 20% = 400k, chậm nộp 0,03%/ngày, tổng khớp',
            phatDung && chamDung && tongDung && u.hanNop === '2026-09-20',
            JSON.stringify(u))
    }

    // ── 18. Dấu hiệu ẤN ĐỊNH không được cộng vào tiền truy thu ─────────────
    {
        const k = khoSach()
        k.products = [{ name: 'Sữa', stock: -100, costPrice: 1_000_000 }] // tồn âm 100tr
        const h = await kiemTraThue(fakePrisma(k), KY)
        kiemTra('Tồn kho âm KHÔNG bị cộng vào ước tính truy thu (mức ấn định do CQT quyết)',
            h.uocTinhPhat.truyThu === 0 && co(h, 'ton-kho-am'),
            `truyThu=${h.uocTinhPhat.truyThu}`)
    }

    // ── 19. TNCN: thu nhập trên ngưỡng mà không khấu trừ ───────────────────
    {
        const k = khoSach()
        k.payrollEntries = [
            { periodId: 'p8', employeeId: 'nv1', employeeName: 'Nguyễn A', grossSalary: 30_000_000, totalInsuranceEmployee: 3_150_000, pitAmount: 0, dependents: 0 },
            { periodId: 'p8', employeeId: 'nv2', employeeName: 'Trần B', grossSalary: 30_000_000, totalInsuranceEmployee: 3_150_000, pitAmount: 1_500_000, dependents: 0 },
        ]
        k.employees = [{ id: 'nv1', name: 'Nguyễn A', taxCode: '81' }, { id: 'nv2', name: 'Trần B', taxCode: '82' }]
        const h = await kiemTraThue(fakePrisma(k), KY)
        const c = lay(h, 'tncn-thieu-khau-tru')
        kiemTra('Bắt lao động trên ngưỡng không khấu trừ TNCN (người đã khấu trừ thì bỏ qua)',
            !!c && c.soLuong === 1, JSON.stringify(c?.soLuong))
    }

    // ── 20. Thu nhập DƯỚI ngưỡng thì không được kêu ────────────────────────
    {
        const h = await kiemTraThue(fakePrisma(khoSach()), KY)
        kiemTra('Thu nhập dưới ngưỡng giảm trừ — không báo thiếu khấu trừ',
            !co(h, 'tncn-thieu-khau-tru'), h.canhBao.map((c: any) => c.code).join(','))
    }

    // ── 21. Lao động thiếu mã số thuế ──────────────────────────────────────
    {
        const k = khoSach()
        k.employees = [{ id: 'nv1', name: 'Nguyễn A', taxCode: null }]
        const h = await kiemTraThue(fakePrisma(k), KY)
        kiemTra('Bắt lao động chưa có mã số thuế', co(h, 'tncn-thieu-mst'))
    }

    // ── 22. HKD vượt ngưỡng doanh thu + ngưỡng máy tính tiền ───────────────
    {
        const k = khoSach()
        k.settings = { businessType: 'household' }
        k.hkdRevenue = [{ doanhThuThuan: 1_200_000_000 }]
        const h = await kiemTraThue(fakePrisma(k), KY)
        kiemTra('HKD: bắt cả vượt ngưỡng chịu thuế và ngưỡng máy tính tiền 1 tỷ',
            co(h, 'hkd-vuot-nguong-chiu-thue') && co(h, 'hkd-phai-ket-noi-pos'))
    }

    // ── 23. Doanh nghiệp thì KHÔNG áp luật hộ kinh doanh ───────────────────
    {
        const k = khoSach()
        k.hkdRevenue = [{ doanhThuThuan: 1_200_000_000 }] // dữ liệu rác, nhưng là công ty
        const h = await kiemTraThue(fakePrisma(k), KY)
        kiemTra('Công ty không bị áp cảnh báo dành riêng cho hộ kinh doanh',
            !co(h, 'hkd-vuot-nguong-chiu-thue') && !co(h, 'hkd-phai-ket-noi-pos'))
    }

    // ── 24. Bản giải trình soạn sẵn ────────────────────────────────────────
    {
        const k = khoSach()
        k.products = [{ name: 'Sữa', stock: -8, costPrice: 25_000 }]
        const h = await kiemTraThue(fakePrisma(k), KY)
        const g = h.giaiTrinh.find((x: any) => x.code === 'ton-kho-am')
        kiemTra('Có bản giải trình cho tồn kho âm, kèm chứng từ và chừa chỗ điền lý do',
            !!g && g.noiDung.includes('[nêu rõ') && g.chungTuKem.length >= 2 && g.noiDung.includes('cam kết'),
            JSON.stringify(g?.chungTuKem))
    }
    {
        // Cảnh báo không có mẫu (vd hóa đơn hủy nhiều) thì KHÔNG được tự bịa văn bản
        const k = khoSach()
        k.invoices = Array.from({ length: 30 }, (_, i) => ({
            invoiceDate: '2026-08-05', invoiceType: 'SALE',
            status: i < 5 ? 'CANCELLED' : 'SIGNED', totalBeforeVat: i < 5 ? 0 : 4_000_000,
        }))
        const h = await kiemTraThue(fakePrisma(k), KY)
        kiemTra('Cảnh báo chưa có mẫu giải trình thì bỏ trống, không bịa văn bản',
            !h.giaiTrinh.some((g: any) => g.code === 'hoadon-huy-nhieu'))
    }

    // ── 25. Chưa có lịch thuế thì vẫn phải cảnh báo được ───────────────────
    {
        const k = khoSach()
        k.deadlines = []                    // bảng lịch thuế rỗng (chưa ai mở trang)
        k.declarations = [{ period: '2026-08', ct29: 100_000_000, ct30: 10_000_000, ct33: 4_000_000 }]
        const h = await kiemTraThue(fakePrisma(k), KY)
        const c = lay(h, 'to-khai-tre-han-uoc')
        // Kỳ 8/2026 đã khai; các kỳ 1-7/2026 chưa khai và đã quá hạn → phải kêu
        kiemTra('Chưa có lịch thuế vẫn tự dựng hạn và bắt kỳ quá hạn',
            !!c && c.soLuong >= 1 && !c.viDu.some((v: string) => v.includes('T08/2026')),
            JSON.stringify(c?.viDu))
    }
    {
        const k = khoSach()
        k.deadlines = []
        // Đã khai đủ 12 tháng + đã qua hạn môn bài → chỉ còn môn bài bị kêu
        k.declarations = Array.from({ length: 12 }, (_, i) => ({ period: `2026-${String(i + 1).padStart(2, '0')}`, ct29: 0, ct30: 0, ct33: 0 }))
        k.declarations[7] = { period: '2026-08', ct29: 100_000_000, ct30: 10_000_000, ct33: 4_000_000 }
        const h = await kiemTraThue(fakePrisma(k), KY)
        // Đã khai đủ mọi kỳ → không được cảnh báo gì. Lệ phí môn bài CỐ Ý không
        // tự dựng vì dữ liệu không cho biết đã nộp hay chưa (tránh tố oan).
        kiemTra('Đã khai đủ các kỳ thì im lặng hoàn toàn',
            !co(h, 'to-khai-tre-han-uoc'), JSON.stringify(lay(h, 'to-khai-tre-han-uoc')?.viDu))
    }

    // ── 26b. Không đọc được danh sách tờ khai → PHẢI IM, không tố oan ──────
    {
        const k = khoSach()
        k.deadlines = []
        const p: any = fakePrisma(k)
        p.taxDeclaration.findMany = async () => { throw new Error('DB lỗi') }
        const h = await kiemTraThue(p, KY)
        kiemTra('Không đọc được danh sách tờ khai thì không cảnh báo quá hạn (thà im còn hơn tố oan)',
            !co(h, 'to-khai-tre-han-uoc'), h.canhBao.map((c: any) => c.code).join(','))
    }

    // ── 27. Hóa đơn bán cho tổ chức thiếu MST người mua ────────────────────
    {
        const k = khoSach()
        k.invoices = [
            { invoiceDate: '2026-08-05', invoiceNumber: '001', invoiceType: 'SALE', status: 'SIGNED', totalBeforeVat: 100_000_000, totalAmount: 110_000_000, buyerName: 'Công ty TNHH ABC', buyerTaxCode: null },
            { invoiceDate: '2026-08-06', invoiceNumber: '002', invoiceType: 'SALE', status: 'SIGNED', totalBeforeVat: 0, totalAmount: 20_000_000, buyerName: 'Công ty CP XYZ', buyerTaxCode: '0101' },
            { invoiceDate: '2026-08-07', invoiceNumber: '003', invoiceType: 'SALE', status: 'SIGNED', totalBeforeVat: 0, totalAmount: 30_000_000, buyerName: 'Chị Lan', buyerTaxCode: null },
        ]
        const h = await kiemTraThue(fakePrisma(k), KY)
        const c = lay(h, 'hoa-don-ra-thieu-mst-mua')
        kiemTra('Chỉ kêu hóa đơn cho TỔ CHỨC thiếu MST (khách lẻ và HĐ có MST thì bỏ qua)',
            !!c && c.soLuong === 1 && c.viDu[0].includes('001'), JSON.stringify(c?.viDu))
    }

    // ── 28. Hàng tặng giá 0 đồng ───────────────────────────────────────────
    {
        const k = khoSach()
        k.transactions = [{
            receiptNumber: 'HD777', createdAt: new Date('2026-08-09'),
            items: [
                { productName: 'Ly thủy tinh', quantity: 20, lineTotal: 0, product: { costPrice: 30_000 } },   // tặng
                { productName: 'Sữa', quantity: 2, lineTotal: 100_000, product: { costPrice: 20_000 } },        // bán bình thường
                { productName: 'Tờ rơi', quantity: 5, lineTotal: 0, product: { costPrice: 0 } },                // không có giá vốn → bỏ qua
            ],
        }]
        const h = await kiemTraThue(fakePrisma(k), KY)
        const c = lay(h, 'hang-tang-gia-0')
        kiemTra('Bắt hàng tặng giá 0đ (bỏ qua dòng không có giá vốn), ước VAT 10%',
            !!c && c.soLuong === 1 && c.tienRuiRo === 60_000, JSON.stringify({ sl: c?.soLuong, tien: c?.tienRuiRo }))
    }
    {
        const h = await kiemTraThue(fakePrisma(khoSach()), KY)
        kiemTra('Không có hàng tặng thì không kêu', !co(h, 'hang-tang-gia-0'))
    }

    // ── 29. Bán vượt lượng nhập có hóa đơn ─────────────────────────────────
    {
        const k: any = khoSach()
        k.banVuot = [
            { sku: 'sp1', ten: 'Sữa tươi', ban: 120, nhap: 80, thieu: 40 },
            { sku: 'sp2', ten: 'Bánh quy', ban: 50, nhap: 30, thieu: 20 },
        ]
        const h = await kiemTraThue(fakePrisma(k), KY)
        const c = lay(h, 'ban-vuot-hoa-don-vao')
        kiemTra('Bắt mã bán vượt lượng nhập có hóa đơn (mức cao)',
            !!c && c.soLuong === 2 && c.muc === 'cao', JSON.stringify(c?.soLuong))
    }
    {
        // Truy vấn SQL hỏng (DB khác, thiếu bảng) thì bỏ qua, không làm vỡ bản soát
        const k: any = khoSach()
        const p: any = fakePrisma(k)
        p.$queryRawUnsafe = async () => { throw new Error('relation không tồn tại') }
        const h = await kiemTraThue(p, KY)
        kiemTra('SQL soát tồn kho thuế lỗi thì bỏ qua, bản soát vẫn chạy',
            !co(h, 'ban-vuot-hoa-don-vao') && h.diem === 100)
    }

    // ── 30. Hóa đơn nhảy số / trùng số / lùi ngày ──────────────────────────
    {
        const k = khoSach()
        const t = new Date('2026-08-05T03:00:00.000Z')
        k.invoices = [
            { invoiceDate: '2026-08-05', invoiceNumber: '0000001', invoiceSymbol: '1C26TAA', status: 'SIGNED', invoiceType: 'SALE', totalBeforeVat: 25_000_000, createdAt: t },
            { invoiceDate: '2026-08-05', invoiceNumber: '0000002', invoiceSymbol: '1C26TAA', status: 'CANCELLED', invoiceType: 'SALE', totalBeforeVat: 0, createdAt: t },
            // thiếu số 3
            { invoiceDate: '2026-08-06', invoiceNumber: '0000004', invoiceSymbol: '1C26TAA', status: 'SIGNED', invoiceType: 'SALE', totalBeforeVat: 75_000_000, createdAt: t },
        ]
        const h = await kiemTraThue(fakePrisma(k), KY)
        const c = lay(h, 'hoa-don-nhay-so')
        kiemTra('Bắt số hóa đơn bị khuyết (hóa đơn HỦY vẫn tính là có số)',
            !!c && c.soLuong === 1 && c.viDu[0].includes('số 3'), JSON.stringify(c?.viDu))
    }
    {
        const k = khoSach()
        const t = new Date('2026-08-05T03:00:00.000Z')
        k.invoices = [
            { invoiceDate: '2026-08-05', invoiceNumber: '0000001', invoiceSymbol: '1C26TAA', status: 'SIGNED', invoiceType: 'SALE', totalBeforeVat: 50_000_000, createdAt: t },
            { invoiceDate: '2026-08-06', invoiceNumber: '0000001', invoiceSymbol: '1C26TAA', status: 'SIGNED', invoiceType: 'SALE', totalBeforeVat: 50_000_000, createdAt: t },
        ]
        const h = await kiemTraThue(fakePrisma(k), KY)
        kiemTra('Bắt hóa đơn trùng số trong cùng ký hiệu', co(h, 'hoa-don-trung-so'))
    }
    {
        const k = khoSach()
        k.invoices = [
            { invoiceDate: '2026-08-01', invoiceNumber: '0000001', invoiceSymbol: '1C26TAA', status: 'SIGNED', invoiceType: 'SALE', totalBeforeVat: 100_000_000, createdAt: new Date('2026-08-20T03:00:00.000Z') },
        ]
        const h = await kiemTraThue(fakePrisma(k), KY)
        kiemTra('Bắt hóa đơn ghi lùi ngày (HĐ 01/08 nhưng nhập ngày 20/08)', co(h, 'hoa-don-lui-ngay'))
    }
    {
        // Ký hiệu khác nhau thì không được coi là nhảy số của nhau
        const k = khoSach()
        const t = new Date('2026-08-05T03:00:00.000Z')
        k.invoices = [
            { invoiceDate: '2026-08-05', invoiceNumber: '0000001', invoiceSymbol: '1C26TAA', status: 'SIGNED', invoiceType: 'SALE', totalBeforeVat: 50_000_000, createdAt: t },
            { invoiceDate: '2026-08-05', invoiceNumber: '0000009', invoiceSymbol: '2C26TBB', status: 'SIGNED', invoiceType: 'SALE', totalBeforeVat: 50_000_000, createdAt: t },
        ]
        const h = await kiemTraThue(fakePrisma(k), KY)
        kiemTra('Hai ký hiệu khác nhau không bị coi là nhảy số/trùng số',
            !co(h, 'hoa-don-nhay-so') && !co(h, 'hoa-don-trung-so'))
    }

    // ── 31. Bảng kê khoản bị loại khi quyết toán TNDN ──────────────────────
    {
        const k = khoSach()
        k.expenses = [
            // Chi 10tr không hóa đơn → loại 10tr chi phí
            { id: 'x1', description: 'Chi tiếp khách', amount: 10_000_000, paidBy: 'cash', date: new Date('2026-08-10'), status: 'active', category: 'food' },
            // Mua 11tr (gồm 1tr VAT) trả tiền mặt → loại 10tr chi phí + 1tr VAT
            { id: 'x2', description: 'Mua kệ', amount: 11_000_000, vatAmount: 1_000_000, invoiceNo: 'HD9', supplierTaxCode: '0101', invoiceDate: new Date('2026-08-11'), paidBy: 'cash', date: new Date('2026-08-11'), status: 'active', category: 'supplies' },
            // Hóa đơn thiếu MST → loại 500k VAT (chi phí vẫn được trừ nếu có chứng từ khác)
            { id: 'x3', description: 'Mua mực in', amount: 5_500_000, vatAmount: 500_000, invoiceNo: 'HD10', supplierTaxCode: null, invoiceDate: new Date('2026-08-12'), paidBy: 'bank', date: new Date('2026-08-12'), status: 'active', category: 'supplies' },
        ]
        const h = await kiemTraThue(fakePrisma(k), KY)
        const b = h.khoanBiLoai
        kiemTra('Bảng kê khoản bị loại: 3 dòng, chi phí 20tr, VAT 1,5tr, TNDN 4tr',
            b.dong.length === 3 && b.tongChiPhiBiLoai === 20_000_000
            && b.tongVatBiLoai === 1_500_000 && b.thueTndnUocTinh === 4_000_000,
            JSON.stringify({ dong: b.dong.length, cp: b.tongChiPhiBiLoai, vat: b.tongVatBiLoai, tndn: b.thueTndnUocTinh }))
    }
    {
        const h = await kiemTraThue(fakePrisma(khoSach()), KY)
        kiemTra('Sổ sạch thì bảng kê khoản bị loại rỗng',
            h.khoanBiLoai.dong.length === 0 && h.khoanBiLoai.thueTndnUocTinh === 0)
    }

    // ── 32. Phiếu nhập không có hóa đơn GTGT (cần Bảng kê 01/TNDN) ─────────
    {
        const k = khoSach()
        k.imports = [
            { code: 'NH01', totalCost: 50_000_000, paidAmount: 0, status: 'completed', paymentStatus: 'unpaid', hasVatInvoice: false, supplierName: 'Cô Ba (nông sản)', createdAt: new Date('2026-08-04') },
            { code: 'NH02', totalCost: 30_000_000, paidAmount: 0, status: 'completed', paymentStatus: 'unpaid', hasVatInvoice: true, vatAmount: 3_000_000, createdAt: new Date('2026-08-05') },
        ]
        const h = await kiemTraThue(fakePrisma(k), KY)
        const c = lay(h, 'nhap-khong-hoa-don')
        kiemTra('Bắt phiếu nhập không hóa đơn (phiếu CÓ hóa đơn thì bỏ qua), ước TNDN 20%',
            !!c && c.soLuong === 1 && c.tienRuiRo === 10_000_000, JSON.stringify({ sl: c?.soLuong, tien: c?.tienRuiRo }))
    }

    // ── 33. Cut-off doanh thu ──────────────────────────────────────────────
    {
        const k = khoSach()
        k.transactions = [
            { id: 'tx1', receiptNumber: 'HD500', total: 60_000_000, createdAt: new Date('2026-08-28'), items: [] },
        ]
        k.invoices = [
            // Hóa đơn xuất tháng 9 cho đơn bán tháng 8 → lệch kỳ
            { invoiceDate: '2026-09-03', invoiceNumber: '0000050', invoiceSymbol: '1C26TAA', status: 'SIGNED', invoiceType: 'SALE', totalBeforeVat: 0, totalAmount: 66_000_000, transactionId: 'tx1', createdAt: new Date('2026-09-03') },
            // Hóa đơn tháng 9 cho đơn tháng 9 → KHÔNG được kêu
            { invoiceDate: '2026-09-05', invoiceNumber: '0000051', invoiceSymbol: '1C26TAA', status: 'SIGNED', invoiceType: 'SALE', totalBeforeVat: 0, totalAmount: 10_000_000, transactionId: 'txKhac', createdAt: new Date('2026-09-05') },
        ]
        const h = await kiemTraThue(fakePrisma(k), KY)
        const c = lay(h, 'cut-off-doanh-thu')
        kiemTra('Bắt đơn bán trong kỳ mà hóa đơn mang ngày kỳ sau (đơn kỳ sau không bị kêu)',
            !!c && c.soLuong === 1 && c.tienRuiRo === 66_000_000, JSON.stringify({ sl: c?.soLuong, t: c?.tienRuiRo }))
    }

    // ── 34. Tỷ trọng tiền mặt cao ──────────────────────────────────────────
    {
        const k = khoSach()
        // Bỏ dòng tiền vào qua ngân hàng → cửa hàng thu 100% tiền mặt
        k.journal = k.journal.filter(e => e.debitAccount !== '112')
        const h = await kiemTraThue(fakePrisma(k), KY)
        const c = lay(h, 'tien-mat-ty-trong-cao')
        kiemTra('Cảnh báo tỷ trọng tiền mặt cao ở mức "ghi nhận", không phải sai phạm',
            !!c && c.muc === 'thap', JSON.stringify(c?.muc))
    }
    {
        const h = await kiemTraThue(fakePrisma(khoSach()), KY)
        kiemTra('Có thu qua ngân hàng thì không kêu tỷ trọng tiền mặt',
            !co(h, 'tien-mat-ty-trong-cao'), h.canhBao.map((c: any) => c.code).join(','))
    }

    // ── 35. Hồ sơ cần chuẩn bị luôn có mặt ─────────────────────────────────
    {
        const h = await kiemTraThue(fakePrisma(khoSach()), KY)
        kiemTra('Luôn trả checklist hồ sơ cần chuẩn bị', h.hoSoCanChuanBi.length >= 8)
    }

    console.log(`\n${soCa - soLoi}/${soCa} ca đạt`)
    process.exit(soLoi > 0 ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(1) })
