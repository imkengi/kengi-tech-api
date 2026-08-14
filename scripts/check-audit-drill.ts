/**
 * Kiểm chứng MÔ PHỎNG BUỔI LÀM VIỆC VỚI ĐOÀN THANH TRA.
 *
 * Chạy:  npx tsx scripts/check-audit-drill.ts
 *
 * Chỗ nguy hiểm nhất của module này là xếp nhầm mức "an toàn" cho câu trả lời
 * thật ra đang có vấn đề — người dùng đọc thấy xanh rồi yên tâm không sửa. Nên
 * mỗi câu đều có ca PHẢI đỏ và ca PHẢI xanh, và có bộ guard cấu trúc bắt mọi
 * câu chưa an toàn đều phải kèm việc cần làm.
 */

import { moPhongThanhTra, type CauHoiThanhTra } from '../src/lib/auditDrill'

const KY = {
    from: '2026-08-01', to: '2026-08-31',
    start: new Date('2026-08-01T00:00:00.000Z'),
    end: new Date('2026-09-01T00:00:00.000Z'),
    maKy: '2026-08', nhan: 'tháng 8/2026',
}

let dat = 0, hong = 0
function ok(ten: string, dk: boolean, thucTe?: any) {
    if (dk) { dat++; console.log(`  ✓ ${ten}`) }
    else { hong++; console.log(`  ✗ ${ten}${thucTe !== undefined ? ` — thực tế: ${JSON.stringify(thucTe)}` : ''}`) }
}

interface Kho {
    journal: any[]; invoices: any[]; transactions: any[]; expenses: any[]
    imports: any[]; products: any[]; declaration: any; settings: any
    payrollPeriods: any[]; payrollEntries: any[]
}

function fakePrisma(k: Kho) {
    const chuoi = (v: string, w: any) => {
        if (!w) return true
        if (w.gte !== undefined && v < w.gte) return false
        if (w.lte !== undefined && v > w.lte) return false
        if (w.lt !== undefined && !(v < w.lt)) return false
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
        eInvoice: { findMany: async ({ where }: any = {}) => k.invoices.filter(i => chuoi(i.invoiceDate, where?.invoiceDate)) },
        transaction: { findMany: async ({ where }: any = {}) => k.transactions.filter(t => ngay(t.createdAt, where?.createdAt)) },
        expense: { findMany: async ({ where }: any = {}) => k.expenses.filter(e => ngay(e.date, where?.date)) },
        importReceipt: { findMany: async ({ where }: any = {}) => k.imports.filter(i => ngay(i.createdAt, where?.createdAt)) },
        product: {
            findMany: async ({ where }: any = {}) => where?.stock?.lt !== undefined
                ? k.products.filter(p => (p.stock ?? 0) < where.stock.lt) : k.products,
        },
        taxDeclaration: { findFirst: async () => k.declaration },
        storeSettings: { findFirst: async () => k.settings },
        payrollPeriod: { findMany: async () => k.payrollPeriods },
        payrollEntry: {
            findMany: async ({ where }: any = {}) => k.payrollEntries.filter(e =>
                !where?.periodId?.in || where.periodId.in.includes(e.periodId)),
        },
    }
}

/** Cửa hàng SẠCH: ba nguồn khớp, hóa đơn đủ, chi có hóa đơn, quỹ dương */
function khoSach(): Kho {
    return {
        journal: [
            { date: '2026-07-25', debitAccount: '111', creditAccount: '411', amount: 50_000_000 },
            { date: '2026-08-05', debitAccount: '111', creditAccount: '511', amount: 100_000_000 },
            { date: '2026-08-05', debitAccount: '111', creditAccount: '3331', amount: 10_000_000 },
            { date: '2026-08-06', debitAccount: '632', creditAccount: '156', amount: 60_000_000 },
            { date: '2026-08-10', debitAccount: '156', creditAccount: '112', amount: 70_000_000 },
            { date: '2026-08-25', debitAccount: '3331', creditAccount: '112', amount: 10_000_000 },
        ],
        invoices: [
            { invoiceNumber: '1', invoiceSymbol: '1C26TAA', invoiceDate: '2026-08-05', status: 'SIGNED', invoiceType: 'SALE', transactionId: 't1', totalBeforeVat: 100_000_000, totalAmount: 110_000_000 },
        ],
        transactions: [
            { id: 't1', receiptNumber: 'HD001', total: 110_000_000, channel: 'direct', createdAt: new Date('2026-08-05') },
        ],
        expenses: [
            { description: 'Điện', amount: 2_000_000, vatAmount: 200_000, invoiceNo: '001', category: 'electricity', supplierName: 'EVN', supplierTaxCode: '0100100079', paidBy: 'bank', bankAccountId: 'b1', status: 'active' },
        ],
        imports: [
            { code: 'PN001', totalCost: 70_000_000, vatAmount: 7_000_000, hasVatInvoice: true, vatInvoiceNo: '9999', supplierName: 'NCC Lớn', paidAmount: 70_000_000 },
        ],
        products: [],
        declaration: { ct29: 100_000_000, ct30: 10_000_000, ct33: 7_000_000, ct40a: 3_000_000, status: 'submitted', filedAt: new Date('2026-09-18') },
        settings: { businessType: 'company', taxCode: '0101234567' },
        payrollPeriods: [{ id: 'pp1', month: 8, year: 2026 }],
        payrollEntries: [
            { periodId: 'pp1', employeeName: 'A', grossSalary: 9_000_000, pitAmount: 0, totalInsuranceEmployee: 945_000 },
        ],
    }
}

const tim = (ds: CauHoiThanhTra[], ma: string) => ds.find(c => c.ma === ma)!

async function main() {
    console.log('\n═══ MÔ PHỎNG BUỔI LÀM VIỆC ═══\n')

    console.log('▸ Cửa hàng sạch')
    const sach = await moPhongThanhTra(fakePrisma(khoSach()), KY)
    ok('dựng đủ bộ câu hỏi', sach.cauHoi.length >= 14, sach.cauHoi.length)
    ok('không câu nào ở mức nguy hiểm', sach.soNguyHiem === 0,
        sach.cauHoi.filter(c => c.muc === 'nguy-hiem').map(c => c.ma))
    ok('ba nguồn doanh thu khớp → an toàn', tim(sach.cauHoi, 'dt-khop').muc === 'an-toan')
    ok('mọi phiếu bán đều có hóa đơn → an toàn', tim(sach.cauHoi, 'dt-ban-khong-hoa-don').muc === 'an-toan')
    ok('dải số liên tục → an toàn', tim(sach.cauHoi, 'hd-dai-so').muc === 'an-toan')
    ok('chi phí đều có hóa đơn → an toàn', tim(sach.cauHoi, 'cp-khong-hoa-don').muc === 'an-toan')
    ok('quỹ không âm → an toàn', tim(sach.cauHoi, 'tien-quy-am').muc === 'an-toan')
    ok('tờ khai đã nộp → an toàn', tim(sach.cauHoi, 'nv-nop-dung-han').muc === 'an-toan')
    ok('kiểm kê kho luôn là "không đủ dữ liệu" (phần mềm không thay biên bản ký tay)',
        tim(sach.cauHoi, 'kho-doi-chieu').muc === 'khong-du-lieu')
    ok('điểm trả lời tính theo tỉ lệ câu an toàn',
        sach.diemTraLoi === Math.round(sach.cauHoi.filter(c => c.muc === 'an-toan').length / sach.cauHoi.length * 100),
        sach.diemTraLoi)
    ok('doanh nghiệp thường KHÔNG hiện câu hộ kinh doanh', !sach.cauHoi.some(c => c.ma === 'nv-hkd-2026'))

    console.log('\n▸ Guard cấu trúc (áp cho mọi câu)')
    const moiCau = sach.cauHoi
    ok('câu hỏi nào cũng nói rõ vì sao đoàn hỏi', moiCau.every(c => c.vaSao.length > 40),
        moiCau.filter(c => c.vaSao.length <= 40).map(c => c.ma))
    ok('câu trả lời nào cũng có nội dung', moiCau.every(c => c.traLoi.length > 20))
    ok('mọi câu chưa an toàn đều kèm việc cần làm',
        moiCau.filter(c => c.muc !== 'an-toan').every(c => !!c.canLam),
        moiCau.filter(c => c.muc !== 'an-toan' && !c.canLam).map(c => c.ma))
    ok('mọi câu chưa an toàn đều liệt kê chứng từ phải chìa ra',
        moiCau.filter(c => c.muc !== 'an-toan').every(c => c.chungTu.length > 0),
        moiCau.filter(c => c.muc !== 'an-toan' && !c.chungTu.length).map(c => c.ma))
    ok('mã câu hỏi không trùng', new Set(moiCau.map(c => c.ma)).size === moiCau.length)
    ok('câu nào cũng thuộc một nhóm', moiCau.every(c => !!c.nhom))
    ok('có đủ 7 nhóm chủ đề', new Set(moiCau.map(c => c.nhom)).size === 7,
        [...new Set(moiCau.map(c => c.nhom))])
    ok('luôn nhắc phải đối chiếu chứng từ gốc', /chứng từ gốc/.test(sach.luuY))

    console.log('\n▸ Doanh thu lệch tờ khai')
    const kLech = khoSach()
    kLech.declaration = { ...kLech.declaration, ct29: 80_000_000 }
    const lech = await moPhongThanhTra(fakePrisma(kLech), KY)
    ok('bắt lệch → nguy hiểm', tim(lech.cauHoi, 'dt-khop').muc === 'nguy-hiem')
    ok('nêu đúng số tiền lệch', tim(lech.cauHoi, 'dt-khop').traLoi.includes('20.000.000'),
        tim(lech.cauHoi, 'dt-khop').traLoi)

    console.log('\n▸ Chưa có tờ khai')
    const kChuaKhai = khoSach()
    kChuaKhai.declaration = null
    const chuaKhai = await moPhongThanhTra(fakePrisma(kChuaKhai), KY)
    ok('không kết luận bừa là khớp', tim(chuaKhai.cauHoi, 'dt-khop').muc === 'khong-du-lieu')
    ok('câu nộp đúng hạn → nguy hiểm', tim(chuaKhai.cauHoi, 'nv-nop-dung-han').muc === 'nguy-hiem')

    console.log('\n▸ Bán không xuất hóa đơn')
    const kThieuHd = khoSach()
    kThieuHd.invoices = []
    const thieuHd = await moPhongThanhTra(fakePrisma(kThieuHd), KY)
    ok('phát hiện phiếu chưa có hóa đơn', tim(thieuHd.cauHoi, 'dt-ban-khong-hoa-don').muc === 'nguy-hiem')
    ok('nêu tỉ lệ trên doanh thu', /% doanh thu/.test(tim(thieuHd.cauHoi, 'dt-ban-khong-hoa-don').traLoi),
        tim(thieuHd.cauHoi, 'dt-ban-khong-hoa-don').traLoi)

    console.log('\n▸ Nhảy số hóa đơn')
    const kNhay = khoSach()
    kNhay.invoices = [
        { invoiceNumber: '1', invoiceSymbol: '1C26TAA', invoiceDate: '2026-08-05', status: 'SIGNED', invoiceType: 'SALE', transactionId: 't1', totalBeforeVat: 100_000_000, totalAmount: 110_000_000 },
        { invoiceNumber: '5', invoiceSymbol: '1C26TAA', invoiceDate: '2026-08-20', status: 'SIGNED', invoiceType: 'SALE', transactionId: null, totalBeforeVat: 0, totalAmount: 0 },
    ]
    const nhay = await moPhongThanhTra(fakePrisma(kNhay), KY)
    ok('bắt nhảy số → nguy hiểm', tim(nhay.cauHoi, 'hd-dai-so').muc === 'nguy-hiem')
    ok('đếm đúng 3 số thiếu', tim(nhay.cauHoi, 'hd-dai-so').soLieu?.soNhay === 3,
        tim(nhay.cauHoi, 'hd-dai-so').soLieu)
    const kHaiKyHieu = khoSach()
    kHaiKyHieu.invoices = [
        { invoiceNumber: '1', invoiceSymbol: 'A', invoiceDate: '2026-08-05', status: 'SIGNED', invoiceType: 'SALE', transactionId: 't1', totalBeforeVat: 100_000_000, totalAmount: 110_000_000 },
        { invoiceNumber: '9', invoiceSymbol: 'B', invoiceDate: '2026-08-06', status: 'SIGNED', invoiceType: 'SALE', transactionId: null, totalBeforeVat: 0, totalAmount: 0 },
    ]
    const haiKyHieu = await moPhongThanhTra(fakePrisma(kHaiKyHieu), KY)
    ok('hai ký hiệu khác nhau không bị coi là nhảy số',
        tim(haiKyHieu.cauHoi, 'hd-dai-so').soLieu?.soNhay === 0, tim(haiKyHieu.cauHoi, 'hd-dai-so').soLieu)

    console.log('\n▸ Hóa đơn lập lệch ngày bán')
    const kLechNgay = khoSach()
    kLechNgay.invoices[0].invoiceDate = '2026-08-28'
    const lechNgay = await moPhongThanhTra(fakePrisma(kLechNgay), KY)
    ok('phát hiện lập không đúng thời điểm', tim(lechNgay.cauHoi, 'hd-thoi-diem').muc !== 'an-toan',
        tim(lechNgay.cauHoi, 'hd-thoi-diem'))
    ok('dẫn Điều 9 NĐ 123/2020', tim(lechNgay.cauHoi, 'hd-thoi-diem').vaSao.includes('NĐ 123/2020'))

    console.log('\n▸ Chi tiền mặt ≥ 5 triệu')
    const kTienMat = khoSach()
    kTienMat.expenses = [{ description: 'Mua thiết bị', amount: 8_000_000, vatAmount: 800_000, invoiceNo: '007', category: 'supplies', supplierName: 'Cty B', supplierTaxCode: '0102', paidBy: 'Tiền mặt', bankAccountId: null, status: 'active' }]
    const tienMat = await moPhongThanhTra(fakePrisma(kTienMat), KY)
    ok('bắt khoản ≥5tr trả tiền mặt', tim(tienMat.cauHoi, 'cp-tien-mat-5tr').muc === 'nguy-hiem')
    ok('nêu đúng ngưỡng 5 triệu (không phải 20 triệu)',
        tim(tienMat.cauHoi, 'cp-tien-mat-5tr').soLieu?.nguong === 5_000_000)
    ok('dẫn Luật Thuế GTGT 48/2024', tim(tienMat.cauHoi, 'cp-tien-mat-5tr').vaSao.includes('48/2024'))
    const kDuoiNguong = khoSach()
    kDuoiNguong.expenses = [{ ...kTienMat.expenses[0], amount: 4_000_000 }]
    const duoiNguong = await moPhongThanhTra(fakePrisma(kDuoiNguong), KY)
    ok('dưới 5 triệu trả tiền mặt thì im', tim(duoiNguong.cauHoi, 'cp-tien-mat-5tr').muc === 'an-toan')

    console.log('\n▸ Chi không hóa đơn')
    const kKhongHd = khoSach()
    kKhongHd.imports = [{ ...kKhongHd.imports[0], hasVatInvoice: false, vatInvoiceNo: null }]
    const khongHd = await moPhongThanhTra(fakePrisma(kKhongHd), KY)
    ok('bắt phiếu nhập không hóa đơn', tim(khongHd.cauHoi, 'cp-khong-hoa-don').muc === 'nguy-hiem')
    ok('quy ra thuế TNDN 20%', tim(khongHd.cauHoi, 'cp-khong-hoa-don').traLoi.includes('14.000.000'),
        tim(khongHd.cauHoi, 'cp-khong-hoa-don').traLoi)

    console.log('\n▸ Tồn kho âm & quỹ âm')
    const kAm = khoSach()
    kAm.products = [{ name: 'Bút', sku: 'B1', stock: -5 }]
    kAm.journal = [
        { date: '2026-08-02', debitAccount: '642', creditAccount: '111', amount: 30_000_000 },
        { date: '2026-08-20', debitAccount: '111', creditAccount: '511', amount: 100_000_000 },
    ]
    const am = await moPhongThanhTra(fakePrisma(kAm), KY)
    ok('bắt tồn kho âm', tim(am.cauHoi, 'kho-am').muc === 'nguy-hiem')
    ok('bắt ngày quỹ âm', tim(am.cauHoi, 'tien-quy-am').muc === 'nguy-hiem')
    ok('đếm được số ngày âm', (tim(am.cauHoi, 'tien-quy-am').soLieu?.soNgayAm as number) > 0,
        tim(am.cauHoi, 'tien-quy-am').soLieu)

    console.log('\n▸ Hộ kinh doanh')
    const kHkd = khoSach()
    kHkd.settings = { businessType: 'household', taxCode: '8123456789' }
    const hkd = await moPhongThanhTra(fakePrisma(kHkd), KY)
    ok('hiện câu riêng cho hộ kinh doanh', hkd.cauHoi.some(c => c.ma === 'nv-hkd-2026'))
    ok('nhắc NQ 198/2025 bỏ thuế khoán', tim(hkd.cauHoi, 'nv-hkd-2026').vaSao.includes('198/2025'))
    ok('nhắc sổ S1-S7 theo TT 88/2021', tim(hkd.cauHoi, 'nv-hkd-2026').chungTu.some(c => c.includes('88/2021')))

    console.log('\n▸ Nhà cung cấp cần tra cứu')
    ok('có danh sách NCC để tra cứu tình trạng hoạt động', sach.nhaCungCapCanTraCuu.length > 0)
    ok('mỗi NCC đều nêu lý do đáng tra', sach.nhaCungCapCanTraCuu.every(n => n.lyDo.length > 10))
    ok('NCC thiếu MST được nêu đúng lý do',
        sach.nhaCungCapCanTraCuu.some(n => !n.mst && /MST/.test(n.lyDo)), sach.nhaCungCapCanTraCuu)
    ok('không quá 10 nhà cung cấp', sach.nhaCungCapCanTraCuu.length <= 10)

    console.log('\n▸ Cửa hàng rỗng / truy vấn hỏng')
    const rong = await moPhongThanhTra(fakePrisma({
        journal: [], invoices: [], transactions: [], expenses: [], imports: [],
        products: [], declaration: null, settings: null, payrollPeriods: [], payrollEntries: [],
    }), KY)
    ok('không nổ khi rỗng', rong.cauHoi.length >= 14, rong.cauHoi.length)
    ok('không có lương → không kết luận an toàn', tim(rong.cauHoi, 'ld-bang-luong').muc === 'khong-du-lieu')

    const hong2: any = fakePrisma(khoSach())
    hong2.journalEntry = { findMany: async () => { throw new Error('P1001 mất kết nối') } }
    const chiuLoi = await moPhongThanhTra(hong2, KY)
    ok('một truy vấn hỏng không làm sập cả buổi mô phỏng', chiuLoi.cauHoi.length >= 14, chiuLoi.cauHoi.length)

    /* Không đọc được bảng tờ khai KHÁC với chưa lập tờ khai. Gộp hai thứ lại thì
     * mỗi lần truy vấn hỏng, câu "đã nộp tờ khai chưa" trả lời "CHƯA có tờ khai"
     * ở mức nguy hiểm — buộc tội trong khi thực tế chỉ là ta không đọc được. */
    const hongToKhai: any = fakePrisma(khoSach())
    hongToKhai.taxDeclaration = { findFirst: async () => { throw new Error('The table `TaxDeclaration` does not exist') } }
    const kqHong = await moPhongThanhTra(hongToKhai, KY)
    const cauNop = tim(kqHong.cauHoi, 'nv-nop-dung-han')
    ok('không đọc được tờ khai → KHÔNG kết luận là chưa nộp',
        cauNop.muc === 'khong-du-lieu' && !/CHƯA có tờ khai/.test(cauNop.traLoi), cauNop)
    ok('vẫn chỉ ra việc cần làm: kiểm tra thủ công trên cổng thuế',
        /thuedientu/.test(String(cauNop.canLam)), cauNop.canLam)

    console.log('\n▸ Sổ chưa ghi doanh thu ≠ ba nguồn lệch nhau')
    /* `dtSo` lấy từ phát sinh Có 511 — bút toán, không phải đơn hàng. Hộ kinh
     * doanh không bắt buộc ghi sổ kép nên dtSo = 0 là bình thường; khi đó câu
     * trả lời "lệch so với tờ khai X đ" ở mức nguy-hiem là dựng một tình huống
     * thanh tra không có thật, và người dùng đi soạn giải trình cho khoản lệch
     * không tồn tại. */
    {
        const k = khoSach()
        k.journal = k.journal.filter((b: any) => b.debitAccount !== '511' && b.creditAccount !== '511')
        const r = await moPhongThanhTra(fakePrisma(k), KY)
        const c = r.cauHoi.find((x: any) => x.ma === 'dt-khop')
        ok('sổ chưa ghi doanh thu → KHÔNG xếp mức nguy hiểm',
            !!c && c.muc === 'khong-du-lieu', c?.muc)
        ok('… câu trả lời nói thẳng là chưa đối chiếu được',
            !!c && /CHƯA đối chiếu được ba nguồn/.test(c.traLoi), c?.traLoi?.slice(0, 90))
        ok('… và nói rõ đây không phải là lệch',
            !!c && /không phải là lệch/.test(c.traLoi))
        ok('… việc cần làm là ghi sổ, không phải soạn giải trình',
            !!c && /Sổ Doanh Thu/.test(c.canLam || '') && !/giải trình/.test(c.canLam || ''), c?.canLam)
    }
    {
        // Chiều ngược: sổ CÓ ghi mà lệch thật thì vẫn phải xếp nguy hiểm
        const k = khoSach()
        k.declaration = { ...(k as any).declaration, ct29: 999_000_000 }
        const r = await moPhongThanhTra(fakePrisma(k), KY)
        const c = r.cauHoi.find((x: any) => x.ma === 'dt-khop')
        ok('sổ có ghi mà lệch tờ khai thật thì vẫn nguy hiểm',
            !!c && c.muc === 'nguy-hiem', c?.muc)
    }

    console.log(`\n${dat}/${dat + hong} ca đạt`)
    if (hong) process.exit(1)
}

main().catch(e => { console.error(e); process.exit(1) })
