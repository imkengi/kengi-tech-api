/**
 * Kiểm chứng bộ KIỂM TRA TRƯỚC THANH TRA THUẾ bằng dữ liệu giả.
 *
 * Chạy:  npx tsx scripts/check-tax-audit.ts
 *
 * Đây là phần dễ gây thiệt hại nhất nếu sai: báo nhầm thì kế toán đi sửa những
 * thứ không cần sửa, bỏ sót thì tới lúc thanh tra mới biết. Nên mỗi phép kiểm
 * tra đều có 2 ca: một ca PHẢI kêu, một ca PHẢI im.
 */

import { kiemTraThue, NGUONG_KHONG_TIEN_MAT, NGUONG_CHI_CAN_HOA_DON, nguongChiuThueHKD, type KhoangKy } from '../src/lib/taxAudit'

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
        importReceipt: {
            findFirst: async () => {
                const ds = [...k.imports].sort((a, b) =>
                    new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
                return ds[0] ?? null
            },
            findMany: async ({ where }: any = {}) => k.imports.filter(i => ngay(i.createdAt, where?.createdAt)),
        },
        product: {
            findMany: async ({ where }: any = {}) => where?.stock?.lt !== undefined
                ? k.products.filter(p => (p.stock ?? 0) < where.stock.lt)
                : k.products,
        },
        transaction: {
            findFirst: async () => {
                const ds = [...k.transactions].sort((a, b) =>
                    new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
                return ds[0] ?? null
            },
            findMany: async ({ where }: any = {}) => k.transactions.filter(t => ngay(t.createdAt, where?.createdAt)),
            // Dùng cho đường lùi khi sổ doanh thu HKD nhập tay còn rỗng
            aggregate: async ({ where }: any = {}) => ({
                _sum: {
                    total: k.transactions
                        .filter(t => ngay(t.createdAt, where?.createdAt))
                        .reduce((s, t) => s + (t.total || 0), 0),
                },
            }),
        },
        taxDeadline: { findMany: async () => k.deadlines },
        /* SQL thô. Phải phân nhánh theo câu truy vấn: một prisma giả trả cùng
         * một shape cho mọi câu SQL sẽ khiến phép soát mới im lặng "đạt" mà
         * không hề chạy qua nó. */
        $queryRawUnsafe: async (sql?: string) => {
            if (/banDau/.test(String(sql || ''))) {
                return [{
                    banDau: (k as any).banDauTien ?? null,
                    nhapDau: (k as any).nhapDauTien ?? null,
                }]
            }
            return (k as any).banVuot ?? []
        },
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
        /* Cua hang sach van phai co chi phi: thue mat bang, dien nuoc. De trong
         * thi chinh bo soat se keu "so chi phi trong" — va no keu dung. */
        expenses: [
            { date: '2026-08-02', amount: 20_000_000, vatAmount: 0, invoiceNo: 'HD001', status: 'active', category: 'rent', description: 'Thue mat bang thang 8', supplierName: 'Chu nha', bankAccountId: 'bank1' },
        ],
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

        /* Không được khẳng định MỘT nguyên nhân khi có hai. Bán trước rồi hàng
         * mới về (rất phổ biến, có hẳn cờ allowNegativeStock cho việc đó) cũng
         * ra tồn âm y hệt như mua chui — nhưng cách chữa khác hẳn. Nói sai
         * nguyên nhân là đẩy người dùng đi giải trình sai chỗ, và nếu họ vô can
         * thì họ mất luôn niềm tin vào cả bản soát. */
        kiemTra('Nêu CẢ HAI khả năng, không chỉ "mua hàng không hoá đơn"',
            !!c && /hai khả năng/.test(c.chiTiet) && /sai kỳ ghi nhận/.test(c.chiTiet), c?.chiTiet)
        kiemTra('Việc cần làm bắt XÁC ĐỊNH khả năng nào trước khi xử lý',
            !!c && /[Xx]ác định thuộc khả năng nào/.test(c.canLam), c?.canLam)
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
    /* Cửa hàng phải CÓ hoạt động từ đầu năm thì mới nói được chuyện chậm nộp:
     * store chưa ghi lần mua bán nào sẽ rơi vào nhánh "trước khi dùng" (ca 13c).
     * Đây là điểm khác giữa "chưa đến lượt bị soi" và "làm sai". */
    const HOAT_DONG_DAU_NAM = [{ createdAt: '2026-01-05T02:00:00.000Z', total: 5_000_000, status: 'completed' }] as any[]
    {
        const k = khoSach()
        k.transactions = HOAT_DONG_DAU_NAM
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
    /* Ca dưới đây từng KHÔNG có, và đó là lý do lỗi sống sót: ca 13 dựng mốc đã
     * nộp bằng status 'filed' — đúng bằng giá trị tưởng tượng mà mã đang trừ.
     * Test lặp lại y nguyên giả định sai của mã thì mãi mãi xanh. Giá trị THẬT
     * mà PUT /api/tax/deadlines/:id ghi xuống là 'submitted'. */
    {
        const k = khoSach()
        k.deadlines = [
            { taxType: 'GTGT', period: '2026-05', dueDate: '2026-06-20', status: 'submitted' },
            { taxType: 'GTGT', period: '2026-06', dueDate: '2026-07-20', status: 'submitted' },
        ]
        const h = await kiemTraThue(fakePrisma(k), KY)
        kiemTra('Mốc đã đánh dấu nộp (submitted) KHÔNG bị tính quá hạn',
            !co(h, 'to-khai-tre-han'), JSON.stringify(lay(h, 'to-khai-tre-han')?.soLuong))
    }
    {
        const k = khoSach()
        k.transactions = HOAT_DONG_DAU_NAM
        k.deadlines = [
            { taxType: 'GTGT', period: '2026-05', dueDate: '2026-06-20', status: 'submitted' },
            { taxType: 'GTGT', period: '2026-06', dueDate: '2026-07-20', status: 'overdue' },
        ]
        const h = await kiemTraThue(fakePrisma(k), KY)
        const c = lay(h, 'to-khai-tre-han')
        kiemTra('Đếm đúng khi trộn mốc đã nộp và mốc quá hạn thật',
            !!c && c.soLuong === 1 && String(c.viDu?.[0] || '').includes('2026-07-20'),
            JSON.stringify(c?.viDu))
    }
    {
        /* Trạng thái lạ (bản cũ, sửa tay trong DB, tính năng tương lai) thì IM.
         * Hướng an toàn ở đây ngược với lịch tiền: buộc tội sai đắt hơn bỏ sót. */
        const k = khoSach()
        k.deadlines = [
            { taxType: 'GTGT', period: '2026-06', dueDate: '2026-07-20', status: 'da_nop_ngoai_he_thong' },
        ]
        const h = await kiemTraThue(fakePrisma(k), KY)
        kiemTra('Trạng thái lạ thì không kết luận quá hạn',
            !co(h, 'to-khai-tre-han'), JSON.stringify(lay(h, 'to-khai-tre-han')?.soLuong))
    }

    // ── 13b. Kỳ trước ngày cửa hàng có dữ liệu ─────────────────────────────
    /* Lịch gieo cho cả năm nên cửa hàng mở tháng 8 vẫn có mốc tháng 1..7 và tất
     * cả lập tức "quá hạn". Phần mềm không có ngày đăng ký kinh doanh nên không
     * được khẳng định — tách ra cảnh báo riêng, mức vừa. */
    {
        const k = khoSach()
        k.transactions = [{ createdAt: '2026-08-01T02:00:00.000Z', total: 1_000_000, status: 'completed' }] as any
        k.deadlines = [
            { taxType: 'GTGT', period: '2026-01', dueDate: '2026-02-20', status: 'pending' },
            { taxType: 'GTGT', period: '2026-02', dueDate: '2026-03-20', status: 'pending' },
            { taxType: 'GTGT', period: '2026-07', dueDate: '2026-08-20', status: 'pending' },
        ]
        const h = await kiemTraThue(fakePrisma(k), KY)
        const cao = lay(h, 'to-khai-tre-han')
        const vua = lay(h, 'to-khai-tre-han-truoc-khi-dung')
        kiemTra('Kỳ trước ngày có dữ liệu KHÔNG bị kết luận chậm nộp', !cao, JSON.stringify(cao?.viDu))
        kiemTra('Nhưng vẫn nêu ra để chủ cửa hàng tự xác nhận, mức vừa',
            !!vua && vua.muc === 'vua' && vua.soLuong === 2, JSON.stringify(vua?.soLuong))
        kiemTra('Câu chữ nói rõ phần mềm KHÔNG biết, không phải cửa hàng làm sai',
            !!vua && vua.chiTiet.includes('KHÔNG biết'), vua?.chiTiet?.slice(0, 60))
        /* Danh sách hạn nộp nằm trong Thuế → Báo Cáo Thuế, mục menu có cờ
         * companyOnly — hộ kinh doanh KHÔNG mở được dù vẫn nhận cảnh báo này.
         * Chỉ họ vào đó xoá mốc là chỉ tới trang họ không vào nổi. */
        kiemTra('Doanh nghiệp được chỉ đúng chỗ xoá mốc',
            !!vua && /Báo Cáo Thuế, tab Hạn nộp/.test(vua.canLam), vua?.canLam?.slice(-90))
    }
    {
        const k = khoSach() as any
        k.settings = { businessType: 'household' }
        k.transactions = [{ createdAt: '2026-08-01T02:00:00.000Z', total: 1_000_000, status: 'completed' }]
        k.deadlines = [
            { taxType: 'GTGT', period: '2026-01', dueDate: '2026-02-20', status: 'pending' },
        ]
        const h = await kiemTraThue(fakePrisma(k), KY)
        const vua = lay(h, 'to-khai-tre-han-truoc-khi-dung')
        kiemTra('Hộ kinh doanh KHÔNG bị chỉ sang trang họ không mở được',
            !!vua && !/Báo Cáo Thuế/.test(vua.canLam), vua?.canLam)
        kiemTra('… mà chỉ bảo đối chiếu giấy tờ rồi bỏ qua',
            !!vua && /bỏ qua mục này/.test(vua.canLam), vua?.canLam?.slice(-70))
    }
    {
        // Mốc nằm TRONG quãng cửa hàng đã hoạt động thì vẫn nói thẳng, mức cao
        const k = khoSach()
        k.transactions = [{ createdAt: '2026-01-05T02:00:00.000Z', total: 1_000_000, status: 'completed' }] as any
        k.deadlines = [
            { taxType: 'GTGT', period: '2026-06', dueDate: '2026-07-20', status: 'pending' },
        ]
        const h = await kiemTraThue(fakePrisma(k), KY)
        const cao = lay(h, 'to-khai-tre-han')
        kiemTra('Cửa hàng đã hoạt động từ đầu năm thì kỳ quá hạn vẫn báo mức cao',
            !!cao && cao.muc === 'cao' && cao.soLuong === 1, JSON.stringify(cao?.soLuong))
        kiemTra('Không kèm cảnh báo "trước khi dùng" khi không có kỳ nào như vậy',
            !co(h, 'to-khai-tre-han-truoc-khi-dung'))
    }
    {
        /* Mua hàng TRƯỚC khi bán được đồng nào — mốc phải lấy từ phiếu nhập,
         * nếu chỉ nhìn ngày bán đầu tiên thì tha oan mấy kỳ lẽ ra phải khai. */
        const k = khoSach() as any
        k.transactions = [{ createdAt: '2026-08-01T02:00:00.000Z', total: 1_000_000, status: 'completed' }]
        k.imports = [{ createdAt: '2026-03-01T02:00:00.000Z', totalCost: 5_000_000, status: 'completed' }]
        k.deadlines = [
            { taxType: 'GTGT', period: '2026-01', dueDate: '2026-02-20', status: 'pending' },
            { taxType: 'GTGT', period: '2026-04', dueDate: '2026-05-20', status: 'pending' },
        ]
        const h = await kiemTraThue(fakePrisma(k), KY)
        kiemTra('Lấy mốc sớm nhất giữa giao dịch bán đầu và phiếu nhập đầu',
            lay(h, 'to-khai-tre-han')?.soLuong === 1
            && lay(h, 'to-khai-tre-han-truoc-khi-dung')?.soLuong === 1,
            JSON.stringify([lay(h, 'to-khai-tre-han')?.soLuong, lay(h, 'to-khai-tre-han-truoc-khi-dung')?.soLuong]))
    }
    {
        // Không đọc được mốc nào thì KHÔNG tách — giữ nguyên hành vi cũ
        const k = khoSach()
        k.transactions = []
        const p: any = fakePrisma(k)
        p.transaction.findFirst = async () => { throw new Error('mất bảng') }
        p.importReceipt.findFirst = async () => { throw new Error('mất bảng') }
        k.deadlines = [
            { taxType: 'GTGT', period: '2026-01', dueDate: '2026-02-20', status: 'pending' },
        ]
        const h = await kiemTraThue(p, KY)
        kiemTra('Không biết cửa hàng có mặt từ bao giờ thì giữ nguyên cách báo cũ',
            lay(h, 'to-khai-tre-han')?.soLuong === 1 && !co(h, 'to-khai-tre-han-truoc-khi-dung'),
            JSON.stringify(lay(h, 'to-khai-tre-han')?.soLuong))
    }
    {
        /* ĐỌC ĐƯỢC nhưng RỖNG là chuyện khác hẳn KHÔNG ĐỌC ĐƯỢC: cửa hàng chưa
         * từng ghi lần mua bán nào thì không có cơ sở nói họ chậm nộp. */
        const k = khoSach()
        k.transactions = []
        k.imports = []
        k.deadlines = [
            { taxType: 'GTGT', period: '2026-01', dueDate: '2026-02-20', status: 'pending' },
            { taxType: 'GTGT', period: '2026-06', dueDate: '2026-07-20', status: 'pending' },
        ]
        const h = await kiemTraThue(fakePrisma(k), KY)
        const vua = lay(h, 'to-khai-tre-han-truoc-khi-dung')
        kiemTra('Cửa hàng chưa mua bán gì thì KHÔNG bị kết luận chậm nộp',
            !co(h, 'to-khai-tre-han'), JSON.stringify(lay(h, 'to-khai-tre-han')?.viDu))
        kiemTra('Vẫn nêu đủ các kỳ để chủ cửa hàng tự xác nhận',
            !!vua && vua.soLuong === 2, JSON.stringify(vua?.soLuong))
        kiemTra('Câu chữ nói đúng lý do: chưa ghi lần mua bán nào',
            !!vua && vua.chiTiet.includes('chưa ghi một lần mua hay bán nào'), vua?.chiTiet?.slice(0, 80))
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

    /* ── 22b. HKD bán qua máy tính tiền: sổ doanh thu nhập tay còn RỖNG ──────
     *
     * Bảng HkdRevenueEntry phải nhập tay. Cửa hàng bán qua POS không ai ngồi
     * nhập lại doanh thu vào đó, nên trước đây hai phép kiểm ngưỡng chưa từng
     * kêu — kể cả khi doanh thu thật đã vượt xa mốc 1 tỷ.
     */
    {
        const k = khoSach()
        k.settings = { businessType: 'household' }
        k.hkdRevenue = []
        k.transactions = [
            { id: 't-hkd', receiptNumber: 'HD900', total: 1_500_000_000, createdAt: new Date('2026-08-10'), items: [] },
        ]
        const h = await kiemTraThue(fakePrisma(k), KY)
        kiemTra('HKD: sổ nhập tay rỗng thì lấy doanh thu bán hàng thật',
            co(h, 'hkd-vuot-nguong-chiu-thue') && co(h, 'hkd-phai-ket-noi-pos'))
        const cb = h.canhBao.find(c => c.code === 'hkd-phai-ket-noi-pos')
        kiemTra('Nói rõ số liệu lấy từ đâu để kế toán biết đối chiếu',
            !!cb && cb.chiTiet.includes('doanh thu bán hàng thực tế'), cb?.chiTiet)
    }
    {
        // Doanh thu thật dưới ngưỡng thì vẫn phải im
        const k = khoSach()
        k.settings = { businessType: 'household' }
        k.hkdRevenue = []
        k.transactions = [
            { id: 't-nho', receiptNumber: 'HD901', total: 50_000_000, createdAt: new Date('2026-08-10'), items: [] },
        ]
        const h = await kiemTraThue(fakePrisma(k), KY)
        kiemTra('HKD doanh thu nhỏ thì không kêu ngưỡng nào',
            !co(h, 'hkd-vuot-nguong-chiu-thue') && !co(h, 'hkd-phai-ket-noi-pos'))
    }

    /* ── 22c. Không đọc được bảng lương thì KHÔNG kết luận là thiếu ──────────
     *
     * Store cũ chưa migrate thì bảng PayrollPeriod không tồn tại, truy vấn ném
     * lỗi. Nếu coi lỗi đó là "không có bảng lương nào" thì phép soát buộc tội
     * cửa hàng trả lương ngoài sổ — trong khi thực tế chỉ là ta không đọc được.
     */
    {
        const k = khoSach()
        k.payrollPeriods = []
        k.payrollEntries = []
        const h = await kiemTraThue(fakePrisma(k), KY)
        kiemTra('Đọc được bảng lương và thấy trống → có kêu thiếu bảng lương',
            co(h, 'thieu-bang-luong'))
    }
    {
        const k = khoSach()
        const px: any = fakePrisma(k)
        px.payrollPeriod = { findMany: async () => { throw new Error('The table `PayrollPeriod` does not exist') } }
        const h = await kiemTraThue(px, KY)
        kiemTra('KHÔNG đọc được bảng lương → im, không buộc tội',
            !co(h, 'thieu-bang-luong'),
            h.canhBao.map((c: any) => c.code).join(','))
    }

    /* ── 22d. Ngưỡng chịu thuế của hộ kinh doanh theo đúng năm ───────────────
     *
     * 100 triệu/năm (TT 40/2021), nâng lên 200 triệu/năm từ 01/01/2026 (Luật
     * Thuế GTGT 48/2024). Trong mã từng có bốn chỗ ghi 500 triệu và gọi đó là
     * "ngưỡng chịu thuế" — 500 triệu là mốc bậc lệ phí môn bài cao nhất, không
     * phải ngưỡng chịu thuế. Hộ kinh doanh đọc nhầm là tưởng dưới 500 triệu
     * không phát sinh nghĩa vụ gì.
     */
    kiemTra('Ngưỡng chịu thuế HKD năm 2025 là 100 triệu',
        nguongChiuThueHKD(2025) === 100_000_000, String(nguongChiuThueHKD(2025)))
    kiemTra('Ngưỡng chịu thuế HKD năm 2026 là 200 triệu',
        nguongChiuThueHKD(2026) === 200_000_000, String(nguongChiuThueHKD(2026)))
    kiemTra('Không nơi nào còn dùng 500 triệu làm ngưỡng chịu thuế',
        nguongChiuThueHKD(2026) !== 500_000_000 && nguongChiuThueHKD(2030) === 200_000_000)
    {
        // Hộ kinh doanh doanh thu 250 triệu năm 2026: đã vượt ngưỡng 200 triệu
        const k = khoSach()
        k.settings = { businessType: 'household' }
        k.hkdRevenue = [{ doanhThuThuan: 250_000_000 }]
        const h = await kiemTraThue(fakePrisma(k), KY)
        kiemTra('HKD 250 triệu năm 2026 → vượt ngưỡng chịu thuế',
            co(h, 'hkd-vuot-nguong-chiu-thue'))
        kiemTra('Nhưng chưa tới ngưỡng máy tính tiền 1 tỷ',
            !co(h, 'hkd-phai-ket-noi-pos'))
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

        /* Rất nhiều cửa hàng phát hành một phần hoá đơn ở phần mềm khác của nhà
         * cung cấp HĐĐT — dữ liệu thật 14/08/2026 có cửa hàng doanh thu hàng tỷ
         * mà phần mềm này không giữ tờ nào. Nói thẳng "dấu hiệu có hoá đơn không
         * được ghi nhận" là kết tội cả nhóm dùng song song hai hệ thống. */
        kiemTra('Nêu khả năng phát hành ở PHẦN MỀM KHÁC, không kết tội ngay',
            !!c && /phần mềm khác/.test(c.chiTiet), c?.chiTiet)
        kiemTra('… nhưng vẫn nói rõ sổ chưa khớp cổng hoá đơn',
            !!c && /chưa khớp cổng hóa đơn/.test(c.chiTiet), c?.chiTiet)
        kiemTra('Việc cần làm phân nhánh theo kết quả tra cổng',
            !!c && /Có trên cổng/.test(c.canLam) && /không có trên cổng/i.test(c.canLam), c?.canLam)
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

    // ── 35. Thuế suất trên hóa đơn ─────────────────────────────────────────
    {
        const k = khoSach()
        const t = new Date('2026-08-05T03:00:00.000Z')
        k.invoices = [
            {
                invoiceDate: '2026-08-05', invoiceNumber: '0000001', invoiceSymbol: '1C26TAA', status: 'SIGNED',
                invoiceType: 'SALE', totalBeforeVat: 100_000_000, createdAt: t,
                items: [
                    { itemName: 'Sữa tươi', vatRate: 8, amount: 10_000_000, vatAmount: 800_000 },   // đúng
                    { itemName: 'Bánh quy', vatRate: 10, amount: 10_000_000, vatAmount: 500_000 },  // SAI: phải 1tr
                ],
            },
            {
                invoiceDate: '2026-08-06', invoiceNumber: '0000002', invoiceSymbol: '1C26TAA', status: 'SIGNED',
                invoiceType: 'SALE', totalBeforeVat: 0, createdAt: t,
                items: [
                    { itemName: 'Sữa tươi', vatRate: 10, amount: 5_000_000, vatAmount: 500_000 },   // đúng số học, nhưng lệch thuế suất với HĐ trước
                ],
            },
        ]
        const h = await kiemTraThue(fakePrisma(k), KY)
        const a = lay(h, 'vat-sai-so-hoc')
        const b = lay(h, 'vat-khong-nhat-quan')
        kiemTra('Bắt dòng thuế sai số học (chênh 500k) và mặt hàng áp 2 mức thuế suất',
            !!a && a.tienRuiRo === 500_000 && !!b && b.soLuong === 1,
            JSON.stringify({ saiSoHoc: a?.tienRuiRo, khongNhatQuan: b?.soLuong }))
    }
    {
        const k = khoSach()
        const t = new Date('2026-08-05T03:00:00.000Z')
        k.invoices = [{
            invoiceDate: '2026-08-05', invoiceNumber: '0000001', invoiceSymbol: '1C26TAA', status: 'SIGNED',
            invoiceType: 'SALE', totalBeforeVat: 100_000_000, createdAt: t,
            items: [
                { itemName: 'Sữa tươi', vatRate: 8, amount: 10_000_000, vatAmount: 800_000 },
                // Lệch 300đ do làm tròn → nằm trong dung sai, KHÔNG được kêu
                { itemName: 'Bánh quy', vatRate: 10, amount: 3_333_333, vatAmount: 333_633 },
            ],
        }]
        const h = await kiemTraThue(fakePrisma(k), KY)
        kiemTra('Chênh lệch làm tròn nhỏ không bị báo sai số học',
            !co(h, 'vat-sai-so-hoc'), h.canhBao.map((c: any) => c.code).join(','))
    }

    // ── 36. Hao hụt kho treo trên 1381 ─────────────────────────────────────
    {
        const k = khoSach()
        // Kiểm kê thiếu 5tr (5% doanh thu 100tr) → phải kêu, ước thuế 1tr
        k.journal.push({ reference: 'ADJ-1', date: '2026-08-10', debitAccount: '1381', creditAccount: '156', amount: 5_000_000 })
        const h = await kiemTraThue(fakePrisma(k), KY)
        const c = lay(h, 'hao-hut-vuot-muc')
        kiemTra('Bắt hàng thiếu treo 1381 đáng kể, ước thuế TNDN 20%',
            !!c && c.tienRuiRo === 1_000_000, JSON.stringify(c?.tienRuiRo))
    }
    {
        const k = khoSach()
        // Đã kết chuyển xử lý xong (Có 1381) → không còn treo, không được kêu
        k.journal.push({ reference: 'ADJ-2', date: '2026-08-10', debitAccount: '1381', creditAccount: '156', amount: 5_000_000 })
        k.journal.push({ reference: 'XL-2', date: '2026-08-11', debitAccount: '632', creditAccount: '1381', amount: 5_000_000 })
        const h = await kiemTraThue(fakePrisma(k), KY)
        kiemTra('Đã xử lý xong hàng thiếu thì không kêu nữa', !co(h, 'hao-hut-vuot-muc'))
    }
    {
        const k = khoSach()
        // Hao hụt nhỏ (0,2% doanh thu) → dưới ngưỡng, không kêu
        k.journal.push({ reference: 'ADJ-3', date: '2026-08-10', debitAccount: '1381', creditAccount: '156', amount: 200_000 })
        const h = await kiemTraThue(fakePrisma(k), KY)
        kiemTra('Hao hụt nhỏ dưới ngưỡng thì không kêu', !co(h, 'hao-hut-vuot-muc'))
    }

    // ── 37. Mã số thuế người bán sai định dạng ─────────────────────────────
    {
        const k = khoSach()
        k.expenses = [
            { id: 'm1', description: 'Mua giấy', amount: 3_300_000, vatAmount: 300_000, invoiceNo: 'H1', supplierTaxCode: '123', invoiceDate: new Date('2026-08-05'), paidBy: 'bank', date: new Date('2026-08-05'), status: 'active', category: 'supplies' },
            { id: 'm2', description: 'Mua mực', amount: 2_200_000, vatAmount: 200_000, invoiceNo: 'H2', supplierTaxCode: '0101234567', invoiceDate: new Date('2026-08-06'), paidBy: 'bank', date: new Date('2026-08-06'), status: 'active', category: 'supplies' },
            { id: 'm3', description: 'Mua bút', amount: 2_200_000, vatAmount: 200_000, invoiceNo: 'H3', supplierTaxCode: '0101234567-001', invoiceDate: new Date('2026-08-07'), paidBy: 'bank', date: new Date('2026-08-07'), status: 'active', category: 'supplies' },
        ]
        const h = await kiemTraThue(fakePrisma(k), KY)
        const c = lay(h, 'mst-sai-dinh-dang')
        kiemTra('Chỉ kêu MST sai định dạng; 10 số và dạng 13 ký tự đơn vị phụ thuộc đều hợp lệ',
            !!c && c.soLuong === 1 && c.tienRuiRo === 300_000, JSON.stringify({ sl: c?.soLuong, t: c?.tienRuiRo }))
    }

    // ── 38. Thuế GTGT đầu vào tồn đọng ─────────────────────────────────────
    {
        const k = khoSach()
        // VAT vào 4tr (khoSach) → thêm 30tr nữa để dư gấp >2 lần VAT ra 10tr
        k.journal.push({ reference: 'IMPVAT-X', date: '2026-08-04', debitAccount: '1331', creditAccount: '331', amount: 30_000_000 })
        k.declarations = [
            ...Array.from({ length: 7 }, (_, i) => ({ period: `2026-${String(i + 1).padStart(2, '0')}`, ct29: 0, ct30: 0, ct33: 0 })),
            { period: '2026-08', ct29: 100_000_000, ct30: 10_000_000, ct33: 34_000_000 },
        ]
        const h = await kiemTraThue(fakePrisma(k), KY)
        kiemTra('Bắt thuế đầu vào tồn đọng lớn (mức "ghi nhận")',
            co(h, 'vat-vao-ton-dong') && lay(h, 'vat-vao-ton-dong').muc === 'thap')
    }
    {
        const h = await kiemTraThue(fakePrisma(khoSach()), KY)
        kiemTra('Đầu vào bình thường thì không kêu tồn đọng', !co(h, 'vat-vao-ton-dong'))
    }

    // ── 39. Hóa đơn đầu vào trùng / mua của chính mình ─────────────────────
    {
        const k = khoSach()
        k.settings = { businessType: 'company', taxCode: '0312345678' }
        k.expenses = [
            // Trùng: cùng MST + cùng số hóa đơn, mỗi bản 1tr VAT → thừa 1tr
            { id: 'd1', description: 'Mua hàng', amount: 11_000_000, vatAmount: 1_000_000, invoiceNo: 'HD777', supplierTaxCode: '0101234567', invoiceDate: new Date('2026-08-05'), paidBy: 'bank', date: new Date('2026-08-05'), status: 'active', category: 'supplies' },
            { id: 'd2', description: 'Mua hàng (nhập lại)', amount: 11_000_000, vatAmount: 1_000_000, invoiceNo: 'HD777', supplierTaxCode: '0101234567', invoiceDate: new Date('2026-08-05'), paidBy: 'bank', date: new Date('2026-08-05'), status: 'active', category: 'supplies' },
            // Cùng số nhưng KHÁC nhà cung cấp → không phải trùng
            { id: 'd3', description: 'Mua khác', amount: 5_500_000, vatAmount: 500_000, invoiceNo: 'HD777', supplierTaxCode: '0109999999', invoiceDate: new Date('2026-08-06'), paidBy: 'bank', date: new Date('2026-08-06'), status: 'active', category: 'supplies' },
            // Mua của chính mình
            { id: 'd4', description: 'Hóa đơn nhập nhầm', amount: 2_200_000, vatAmount: 200_000, invoiceNo: 'HD888', supplierTaxCode: '0312345678', invoiceDate: new Date('2026-08-07'), paidBy: 'bank', date: new Date('2026-08-07'), status: 'active', category: 'supplies' },
        ]
        const h = await kiemTraThue(fakePrisma(k), KY)
        const a = lay(h, 'hoa-don-vao-trung')
        const b = lay(h, 'mua-cua-chinh-minh')
        kiemTra('Bắt hóa đơn trùng (1 cặp, thừa 1tr) và mua của chính mình (200k VAT)',
            !!a && a.soLuong === 1 && a.tienRuiRo === 1_000_000 && !!b && b.soLuong === 1 && b.tienRuiRo === 200_000,
            JSON.stringify({ trung: [a?.soLuong, a?.tienRuiRo], tuMua: [b?.soLuong, b?.tienRuiRo] }))
    }
    {
        const k = khoSach()
        k.settings = { businessType: 'company', taxCode: '0312345678' }
        k.expenses = [
            { id: 'e1', description: 'Mua hàng', amount: 11_000_000, vatAmount: 1_000_000, invoiceNo: 'HD001', supplierTaxCode: '0101234567', invoiceDate: new Date('2026-08-05'), paidBy: 'bank', date: new Date('2026-08-05'), status: 'active', category: 'supplies' },
            { id: 'e2', description: 'Mua hàng', amount: 11_000_000, vatAmount: 1_000_000, invoiceNo: 'HD002', supplierTaxCode: '0101234567', invoiceDate: new Date('2026-08-06'), paidBy: 'bank', date: new Date('2026-08-06'), status: 'active', category: 'supplies' },
        ]
        const h = await kiemTraThue(fakePrisma(k), KY)
        kiemTra('Hóa đơn khác số của cùng NCC không bị coi là trùng',
            !co(h, 'hoa-don-vao-trung') && !co(h, 'mua-cua-chinh-minh'))
    }

    // ── 40. Mẫu giải trình phủ hết các phát hiện nặng ──────────────────────
    {
        /* Cảnh báo mức 'cao' mà không có mẫu giải trình là bỏ người dùng giữa
         * chừng đúng lúc căng nhất — ca này canh cho việc đó. */
        const k: any = khoSach()
        k.settings = { businessType: 'company', taxCode: '0312345678' }
        k.products = [{ name: 'Sữa', stock: -8, costPrice: 25_000 }]
        k.banVuot = [{ sku: 'sp1', ten: 'Sữa tươi', ban: 120, nhap: 80, thieu: 40 }]
        k.declarations = [{ period: '2026-08', ct29: 80_000_000, ct30: 8_000_000, ct33: 4_000_000 }]
        k.imports = [{ code: 'NH01', totalCost: 50_000_000, paidAmount: 0, status: 'completed', paymentStatus: 'unpaid', hasVatInvoice: false, createdAt: new Date('2026-08-04') }]
        k.expenses = [
            { id: 'g1', description: 'Mua hàng', amount: 11_000_000, vatAmount: 1_000_000, invoiceNo: 'HD777', supplierTaxCode: '0101234567', invoiceDate: new Date('2026-08-05'), paidBy: 'cash', date: new Date('2026-08-05'), status: 'active', category: 'supplies' },
            { id: 'g2', description: 'Mua hàng lần 2', amount: 11_000_000, vatAmount: 1_000_000, invoiceNo: 'HD777', supplierTaxCode: '0101234567', invoiceDate: new Date('2026-08-05'), paidBy: 'cash', date: new Date('2026-08-05'), status: 'active', category: 'supplies' },
        ]
        const h = await kiemTraThue(fakePrisma(k), KY)
        const coMau = new Set(h.giaiTrinh.map((g: any) => g.code))
        const nangThieuMau = h.canhBao.filter((c: any) => c.muc === 'cao' && !coMau.has(c.code)).map((c: any) => c.code)
        kiemTra('Mọi cảnh báo mức "cao" đều có mẫu giải trình soạn sẵn',
            nangThieuMau.length === 0, `thiếu mẫu: ${nangThieuMau.join(', ')}`)

        // Mẫu giải trình không được để lọt chỗ trống chưa điền vào bản in
        const thieuChoDien = h.giaiTrinh.filter((g: any) =>
            !/\[.*\]/.test(g.noiDung) && !/cam kết/.test(g.noiDung)).map((g: any) => g.code)
        kiemTra('Mẫu giải trình nào cũng có phần cam kết và chỗ để điền',
            thieuChoDien.length === 0, `thiếu: ${thieuChoDien.join(', ')}`)
    }

    // ── 41. Tiền vào vượt doanh thu ghi nhận ───────────────────────────────
    {
        const k = khoSach()
        // Thu thêm 60tr từ khách (Nợ 111 / Có 131) trong khi doanh thu kỳ chỉ 100tr+10tr thuế
        k.journal.push({ reference: 'THU-1', date: '2026-08-09', debitAccount: '111', creditAccount: '131', amount: 60_000_000 })
        const h = await kiemTraThue(fakePrisma(k), KY)
        const c = lay(h, 'tien-vao-vuot-doanh-thu')
        kiemTra('Bắt tiền vào từ bán hàng cao hơn doanh thu ghi nhận', !!c, JSON.stringify(c?.tienRuiRo))
    }
    {
        const k = khoSach()
        // Tiền vào từ VAY ngân hàng (Có 341) KHÔNG được tính là tiền bán hàng
        k.journal.push({ reference: 'VAY-1', date: '2026-08-09', debitAccount: '112', creditAccount: '341', amount: 500_000_000 })
        const h = await kiemTraThue(fakePrisma(k), KY)
        kiemTra('Tiền vay/góp vốn không bị coi là doanh thu ngoài sổ',
            !co(h, 'tien-vao-vuot-doanh-thu'), h.canhBao.map((c: any) => c.code).join(','))
    }

    // ── 41b. Sổ kế toán trống ≠ giấu doanh thu ─────────────────────────────
    /* `dtSo` lấy từ bút toán 511, không phải từ đơn hàng. Hộ kinh doanh không
     * bắt buộc ghi sổ kép nên dtSo = 0 là bình thường. Đem số 0 đó so với hoá
     * đơn đã phát hành rồi kêu "lệch" mức cao là tố ngược: họ ĐÃ xuất hoá đơn.
     * Ca thật 14/08/2026 ở KENGISTORE: rủi ro 510.338.820 ₫ dựng từ đúng lỗi này. */
    {
        const k = khoSach()
        k.journal = k.journal.filter((b: any) => b.debitAccount !== '511' && b.creditAccount !== '511')
        k.declarations = []
        const h = await kiemTraThue(fakePrisma(k), KY)
        kiemTra('Sổ chưa ghi doanh thu thì KHÔNG kêu lệch sổ với hoá đơn',
            !co(h, 'dt-so-vs-hoadon'), JSON.stringify(lay(h, 'dt-so-vs-hoadon')?.tienRuiRo))
        const c = lay(h, 'chua-ghi-so-doanh-thu')
        kiemTra('… mà nói đúng việc: chưa ghi bút toán doanh thu, mức vừa',
            !!c && c.muc === 'vua', JSON.stringify(c?.muc))
        kiemTra('… nói rõ chưa ghi sổ KHÁC với giấu doanh thu',
            !!c && /khác hẳn với bán mà giấu doanh thu/.test(c.chiTiet), c?.chiTiet?.slice(0, 80))
        kiemTra('… không gán số tiền rủi ro cho việc chưa ghi sổ',
            !!c && c.tienRuiRo === null, JSON.stringify(c?.tienRuiRo))
        kiemTra('… chỉ đúng đường cho cả hộ kinh doanh lẫn doanh nghiệp',
            !!c && /Sổ Doanh Thu/.test(c.canLam) && /Kế Toán/.test(c.canLam), c?.canLam)
    }
    {
        // Sổ trống mà có tờ khai thì cũng không được đem 0 ra so với tờ khai
        const k = khoSach()
        k.journal = k.journal.filter((b: any) => b.debitAccount !== '511' && b.creditAccount !== '511')
        const h = await kiemTraThue(fakePrisma(k), KY)
        kiemTra('Sổ chưa ghi doanh thu thì KHÔNG kêu lệch sổ với tờ khai',
            !co(h, 'dt-so-vs-tokhai'), JSON.stringify(lay(h, 'dt-so-vs-tokhai')?.tienRuiRo))
    }
    {
        /* Chiều ngược: sổ CÓ ghi doanh thu mà lệch thật thì vẫn phải kêu — nới
         * lỏng nhầm chỗ này là bỏ lọt đúng phép đối chiếu quan trọng nhất. */
        const k = khoSach()
        k.journal.push({ date: '2026-08-06', debitAccount: '131', creditAccount: '511', amount: 300_000_000 })
        const h = await kiemTraThue(fakePrisma(k), KY)
        kiemTra('Sổ có ghi doanh thu mà lệch hoá đơn thì vẫn kêu',
            co(h, 'dt-so-vs-hoadon'), JSON.stringify(lay(h, 'dt-so-vs-hoadon')?.tienRuiRo))
        kiemTra('… và không kèm cảnh báo "chưa ghi sổ"', !co(h, 'chua-ghi-so-doanh-thu'))
    }

    // ── 41c. Lịch sử nhập hàng ngắn hơn lịch sử bán ────────────────────────
    /* Cửa hàng chuyển từ phần mềm cũ thường nhập được lịch sử BÁN nhưng không
     * nhập lịch sử NHẬP HÀNG. Khi đó tồn âm và "bán vượt hoá đơn vào" nổ ra
     * hàng loạt như hệ quả bắt buộc của khoảng trống, không phải mua chui.
     * Ca thật KENGISTORE: bán trải 147 ngày, nhập chỉ 44 ngày. */
    {
        const k = khoSach() as any
        k.products = [{ name: 'Nồi', sku: 'N1', stock: -50, costPrice: 1_000_000 }]
        k.banDauTien = '2026-03-21T00:00:00.000Z'
        k.nhapDauTien = '2026-07-02T00:00:00.000Z'   // muộn hơn 103 ngày
        const h = await kiemTraThue(fakePrisma(k), KY)
        const c = lay(h, 'ton-kho-am')
        kiemTra('Lịch sử nhập ngắn hơn bán → tồn âm hạ xuống mức vừa',
            !!c && c.muc === 'vua', JSON.stringify(c?.muc))
        kiemTra('… nêu đúng khoảng trống và ngày phiếu nhập sớm nhất',
            !!c && /chỉ có phiếu nhập từ 2026-07-02/.test(c.chiTiet) && /sớm hơn 103 ngày/.test(c.chiTiet),
            c?.chiTiet?.slice(0, 160))
        kiemTra('… nói rõ gần như luôn là do chưa nhập lịch sử mua hàng',
            !!c && /chưa nhập lịch sử mua hàng từ phần mềm cũ/.test(c.chiTiet))
        kiemTra('… và vẫn giữ đường lùi: nhập đủ rồi mà còn lệch thì giữ nguyên trọng lượng',
            !!c && /nếu lịch sử nhập ĐÃ đầy đủ thì cảnh báo này giữ nguyên/.test(c.chiTiet))
    }
    {
        // Lịch sử nhập đầy đủ thì tồn âm vẫn là mức cao — không được nới nhầm
        const k = khoSach() as any
        k.products = [{ name: 'Nồi', sku: 'N1', stock: -50, costPrice: 1_000_000 }]
        k.banDauTien = '2026-03-21T00:00:00.000Z'
        k.nhapDauTien = '2026-03-25T00:00:00.000Z'   // chỉ lệch 4 ngày
        const h = await kiemTraThue(fakePrisma(k), KY)
        const c = lay(h, 'ton-kho-am')
        kiemTra('Lịch sử nhập đầy đủ → tồn âm vẫn mức CAO',
            !!c && c.muc === 'cao', JSON.stringify(c?.muc))
        kiemTra('… và không chèn câu về khoảng trống nhập hàng',
            !!c && !/chỉ có phiếu nhập từ/.test(c.chiTiet))
    }
    {
        // Không đọc được thì giữ nguyên mức cao — không lấy cớ hạ nhẹ
        const k = khoSach() as any
        k.products = [{ name: 'Nồi', sku: 'N1', stock: -50, costPrice: 1_000_000 }]
        const p: any = fakePrisma(k)
        const goc = p.$queryRawUnsafe
        p.$queryRawUnsafe = async (sql: string) => {
            if (/banDau/.test(String(sql || ''))) throw new Error('không đọc được')
            return goc(sql)
        }
        const h = await kiemTraThue(p, KY)
        const c = lay(h, 'ton-kho-am')
        kiemTra('Không đo được hai mốc thì tồn âm giữ nguyên mức cao',
            !!c && c.muc === 'cao', JSON.stringify(c?.muc))
    }

    // ── 41d. Điểm phải còn phân giải khi có nhiều cảnh báo ─────────────────
    /* Cách trừ tuyến tính cũ kẹp sàn ở 0: cửa hàng 5 vấn đề và 15 vấn đề đều
     * hiện 0/100, sửa xong 10 cái vẫn 0/100. Đo thật: sau khi gỡ ba cáo buộc
     * sai, KENGISTORE vẫn đứng nguyên 0 — không ai thấy bảng vừa đúng hơn. */
    {
        const nhieu = { canhBao: Array.from({ length: 6 }, () => ({ muc: 'cao' })).concat(Array.from({ length: 3 }, () => ({ muc: 'vua' }))) }
        const it = { canhBao: Array.from({ length: 3 }, () => ({ muc: 'cao' })).concat(Array.from({ length: 6 }, () => ({ muc: 'vua' }))) }
        const cham = (ds: any) => {
            const hs: any = { cao: 0.78, vua: 0.91, thap: 0.97 }
            let c = 1
            for (const x of ds.canhBao) c *= hs[x.muc]
            return Math.round(100 * c)
        }
        const dNhieu = cham(nhieu), dIt = cham(it)
        kiemTra('Nhiều cảnh báo nặng hơn thì điểm vẫn thấp hơn, không cùng chạm 0',
            dNhieu < dIt && dNhieu > 0, `${dNhieu} vs ${dIt}`)
        kiemTra('Gỡ bớt cảnh báo nặng thì điểm nhích lên thấy được',
            dIt - dNhieu >= 5, `${dIt} - ${dNhieu}`)

        /* Đổi cách chấm chỉ được phép nếu NHÃN không xê dịch — người dùng đọc
         * nhãn chứ ít khi đọc con số. Khoá lại bằng đối chiếu từng tổ hợp. */
        const cu = (c: number, v: number) => Math.max(0, 100 - 22 * c - 9 * v)
        const moi = (c: number, v: number) => Math.round(100 * Math.pow(0.75, c) * Math.pow(0.91, v))
        const nhan = (d: number) => d >= 90 ? 'Sẵn sàng' : d >= 70 ? 'Cần bổ sung hồ sơ' : d >= 45 ? 'Rủi ro cao' : 'Rất rủi ro'
        const toHop: Array<[number, number]> = [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [2, 0], [2, 1], [3, 0], [4, 0]]
        const lech = toHop.filter(([c, v]) => nhan(cu(c, v)) !== nhan(moi(c, v)))
        kiemTra('Mọi tổ hợp ít cảnh báo giữ nguyên nhãn xếp loại như cách cũ',
            lech.length === 0, lech.map(([c, v]) => `cao=${c} vừa=${v}: ${nhan(cu(c, v))} → ${nhan(moi(c, v))}`).join('; '))
    }
    {
        // Một cảnh báo nặng duy nhất vẫn cho điểm gần cách tính cũ (100 − 22)
        const k = khoSach()
        k.products = [{ name: 'Nồi', sku: 'N1', stock: -50, costPrice: 1_000_000 }]
        ;(k as any).banDauTien = '2026-03-21T00:00:00.000Z'
        ;(k as any).nhapDauTien = '2026-03-25T00:00:00.000Z'
        const h = await kiemTraThue(fakePrisma(k), KY)
        const soNang = h.canhBao.filter((c: any) => c.muc === 'cao').length
        kiemTra('Ít cảnh báo thì điểm gần với cách tính cũ, không nới lỏng',
            soNang !== 1 || (h.diem >= 74 && h.diem <= 80), `${soNang} nặng, điểm ${h.diem}`)
    }

    {
        /* Sổ TRỐNG: chỉ được một cảnh báo, và phép so có nghĩa là hoá đơn với
         * DOANH THU THẬT chứ không phải với cuốn sổ rỗng — nếu không, cửa hàng
         * sổ trống không thấy phần phơi nhiễm hoá đơn ở đâu cả. */
        const k = khoSach()
        k.journal = k.journal.filter((b: any) => b.debitAccount !== '511' && b.creditAccount !== '511')
        k.declarations = []
        /* total ĐÃ gồm VAT còn TK 511 và totalBeforeVat thì chưa — phải trừ ra,
         * nếu không một cuốn sổ ghi đúng tuyệt đối vẫn hiện thiếu đúng phần VAT. */
        k.transactions = [
            { createdAt: '2026-08-05T02:00:00.000Z', total: 550_000_000, tax: 50_000_000, status: 'completed' },
        ] as any
        const h = await kiemTraThue(fakePrisma(k), KY)
        kiemTra('Sổ trống thì KHÔNG kèm thêm cảnh báo "sổ chỉ ghi nhận 0%"',
            !co(h, 'so-thieu-doanh-thu-thuc-te'))
        const c = lay(h, 'chua-ghi-so-doanh-thu')
        kiemTra('… mà gộp vào một cảnh báo, kèm doanh thu thật ĐÃ TRỪ VAT',
            !!c && c.chiTiet.includes('500.000.000') && !c.chiTiet.includes('550.000.000'),
            c?.chiTiet?.slice(0, 130))
        kiemTra('… và so hoá đơn với DOANH THU THẬT, không so với sổ rỗng',
            !!c && /hóa đơn với DOANH THU THẬT/.test(c.chiTiet), c?.chiTiet?.slice(-200))
        kiemTra('… nêu đúng phần chưa có hoá đơn (500tr − 100tr)',
            !!c && c.chiTiet.includes('400.000.000'), c?.chiTiet?.slice(-160))
    }

    // ── 41e. Sổ ghi nhận được bao nhiêu phần doanh thu thật ────────────────
    /* Đo trên HUTI ngày 14/08/2026: bán 1.967.661.493 ₫ trong 14 ngày mà sổ chỉ
     * ghi 23.525.478 ₫ (1,2%) và 0 hoá đơn. Phép so "sổ với hoá đơn" ra "lệch
     * 23,5 triệu" — nghe như chuyện nhỏ, trong khi nghĩa vụ theo Điều 90 gắn với
     * DOANH THU THẬT. Trấn an sai nguy hiểm ngang buộc tội oan. */
    {
        const k = khoSach()
        k.transactions = [
            { createdAt: '2026-08-05T02:00:00.000Z', total: 1_100_000_000, tax: 100_000_000, status: 'completed' },
        ] as any
        const h = await kiemTraThue(fakePrisma(k), KY)
        const c = lay(h, 'so-thieu-doanh-thu-thuc-te')
        kiemTra('Sổ ghi ít hơn doanh thu thật thì phải nói ra', !!c, JSON.stringify(c?.tieuDe))
        kiemTra('… ở mức cao khi sổ dưới một nửa', !!c && c.muc === 'cao', c?.muc)
        kiemTra('… nêu đúng số tiền còn thiếu',
            !!c && c.tienRuiRo === 1_000_000_000 - 100_000_000, JSON.stringify(c?.tienRuiRo))
        kiemTra('… nói rõ nghĩa vụ gắn với doanh thu thực tế',
            !!c && /gắn với doanh thu thực tế/.test(c.chiTiet))
    }
    {
        // Sổ ghi đủ thì tuyệt đối không kêu — nới nhầm là thêm một cảnh báo rác
        const k = khoSach()
        /* Sổ ghi 100tr (TK 511, chưa VAT) và bán 110tr đã gồm 10tr VAT → khớp
         * tuyệt đối. Nếu quên trừ VAT thì ca này sẽ kêu oan. */
        k.transactions = [
            { createdAt: '2026-08-05T02:00:00.000Z', total: 110_000_000, tax: 10_000_000, status: 'completed' },
        ] as any
        const h = await kiemTraThue(fakePrisma(k), KY)
        kiemTra('Sổ ghi khớp doanh thu thật (sau khi trừ VAT) thì im',
            !co(h, 'so-thieu-doanh-thu-thuc-te'),
            JSON.stringify(lay(h, 'so-thieu-doanh-thu-thuc-te')?.tieuDe))
    }
    {
        // Không đọc được phiếu bán thì KHÔNG suy đoán
        const k = khoSach()
        const p: any = fakePrisma(k)
        p.transaction.findMany = async () => { throw new Error('mất bảng') }
        const h = await kiemTraThue(p, KY)
        kiemTra('Không đọc được phiếu bán thì không kết luận sổ thiếu',
            !co(h, 'so-thieu-doanh-thu-thuc-te'))
    }

    {
        /* Hộ kinh doanh KHÔNG bắt buộc sổ kép (Điều 3 TT 88/2021). Bảo họ "chạy
         * ghi bù bút toán" là chỉ sai việc, và xếp mức cao là doạ vì một nghĩa
         * vụ không tồn tại — nhưng vẫn phải nói ra, vì con số dựng trên sổ vẫn
         * nhỏ hơn mức thật bất kể loại hình. */
        const k = khoSach()
        k.settings = { businessType: 'household' }
        k.transactions = [
            { createdAt: '2026-08-05T02:00:00.000Z', total: 1_100_000_000, tax: 100_000_000, status: 'completed' },
        ] as any
        const h = await kiemTraThue(fakePrisma(k), KY)
        const c = lay(h, 'so-thieu-doanh-thu-thuc-te')
        kiemTra('Hộ kinh doanh vẫn được báo sổ ghi thiếu', !!c, JSON.stringify(c?.tieuDe))
        kiemTra('… nhưng ở mức vừa, không phải cao', !!c && c.muc === 'vua', c?.muc)
        kiemTra('… và chỉ đúng việc: nhập Sổ Doanh Thu, không bắt ghi bút toán',
            !!c && /không bắt buộc sổ kép/.test(c.canLam) && /Sổ Doanh Thu/.test(c.canLam),
            c?.canLam?.slice(0, 110))
    }
    {
        // Doanh nghiệp thì vẫn mức cao và vẫn chỉ sang ghi bù bút toán
        const k = khoSach()
        k.settings = { businessType: 'company' }
        k.transactions = [
            { createdAt: '2026-08-05T02:00:00.000Z', total: 1_100_000_000, tax: 100_000_000, status: 'completed' },
        ] as any
        const h = await kiemTraThue(fakePrisma(k), KY)
        const c = lay(h, 'so-thieu-doanh-thu-thuc-te')
        kiemTra('Doanh nghiệp: sổ ghi dưới một nửa → mức CAO', !!c && c.muc === 'cao', c?.muc)
        kiemTra('… và chỉ sang ghi bù bút toán',
            !!c && /ghi bù bút toán/.test(c.canLam), c?.canLam?.slice(0, 90))
    }

    // ── 42. Hồ sơ cần chuẩn bị luôn có mặt ─────────────────────────────────
    {
        const h = await kiemTraThue(fakePrisma(khoSach()), KY)
        kiemTra('Luôn trả checklist hồ sơ cần chuẩn bị', h.hoSoCanChuanBi.length >= 8)
    }

    console.log(`\n${soCa - soLoi}/${soCa} ca đạt`)
    process.exit(soLoi > 0 ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(1) })
