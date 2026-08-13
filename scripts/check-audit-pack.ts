/**
 * Kiểm chứng BỘ HỒ SƠ THANH TRA + TRUY VẾT CHỨNG TỪ bằng dữ liệu giả.
 *
 * Chạy:  npx tsx scripts/check-audit-pack.ts
 *
 * Hai thứ này in ra để NỘP CHO ĐOÀN THANH TRA, nên sai số là sai trên giấy có
 * chữ ký. Vì vậy ngoài ca "có dựng được", mỗi bảng còn phải đúng ở ba chỗ dễ
 * sai nhất: cộng tổng, số dư lũy kế, và hóa đơn đã hủy.
 */

import {
    boHoSoThanhTra, sangCsv, truyVetChungTu,
    type BoHoSoThanhTra, type TaiLieuThanhTra,
} from '../src/lib/auditPack'

const KY = { from: '2026-08-01', to: '2026-08-31' }

let dat = 0, hong = 0
function ok(ten: string, dieuKien: boolean, thucTe?: any) {
    if (dieuKien) { dat++; console.log(`  ✓ ${ten}`) }
    else { hong++; console.log(`  ✗ ${ten}${thucTe !== undefined ? ` — thực tế: ${JSON.stringify(thucTe)}` : ''}`) }
}

interface Kho {
    journal: any[]
    invoices: any[]
    imports: any[]
    importItems: any[]
    expenses: any[]
    transactions: any[]
    transactionItems: any[]
    products: any[]
    customers: any[]
    payrollPeriods: any[]
    payrollEntries: any[]
    fixedAssets: any[]
    declarations: any[]
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
    const trong = (v: any, w: any): boolean => {
        if (w === undefined) return true
        if (w && typeof w === 'object') {
            if (w.in) return w.in.includes(v)
            if (w.not !== undefined) return v !== w.not
        }
        return v === w
    }
    return {
        journalEntry: {
            findMany: async ({ where }: any = {}) => k.journal.filter(e =>
                chuoi(e.date, where?.date) && trong(e.reference, where?.reference)),
        },
        eInvoice: {
            findMany: async ({ where }: any = {}) => k.invoices.filter(i => chuoi(i.invoiceDate, where?.invoiceDate)),
            findFirst: async ({ where }: any = {}) => k.invoices.find(i =>
                (where?.invoiceNumber === undefined || i.invoiceNumber === where.invoiceNumber) &&
                (where?.transactionId === undefined || i.transactionId === where.transactionId)) ?? null,
        },
        importReceipt: {
            findMany: async ({ where }: any = {}) => k.imports.filter(i =>
                trong(i.status, where?.status) &&
                trong(i.paymentStatus, where?.paymentStatus) &&
                ngay(i.createdAt, where?.createdAt)),
            // Prisma thật trả kèm dòng hàng khi select có `items` — client giả phải gắn lại,
            // nếu không phép truy vết sẽ tưởng phiếu không có hàng và báo thiếu oan.
            findFirst: async ({ where }: any = {}) => {
                const r = k.imports.find(i => i.code === where?.code)
                return r ? { ...r, items: k.importItems.filter(it => it.receiptId === r.id) } : null
            },
        },
        importReceiptItem: {
            findMany: async ({ where }: any = {}) => k.importItems.filter(it => {
                const r = k.imports.find(i => i.id === it.receiptId)
                const w = where?.receipt
                if (!w) return true
                return !!r && trong(r.status, w.status) && ngay(r.createdAt, w.createdAt)
            }),
        },
        expense: { findMany: async ({ where }: any = {}) => k.expenses.filter(e => ngay(e.date, where?.date)) },
        transaction: {
            findMany: async ({ where }: any = {}) => k.transactions.filter(t => ngay(t.createdAt, where?.createdAt)),
            findFirst: async ({ where }: any = {}) => {
                const t = k.transactions.find(x =>
                    (where?.receiptNumber === undefined || x.receiptNumber === where.receiptNumber) &&
                    (where?.id === undefined || x.id === where.id))
                return t ? { ...t, items: k.transactionItems.filter(i => i.transactionId === t.id) } : null
            },
        },
        transactionItem: {
            findMany: async ({ where }: any = {}) => k.transactionItems.filter(it => {
                const t = k.transactions.find(x => x.id === it.transactionId)
                const w = where?.transaction
                if (!w) return true
                return !!t && trong(t.status, w.status) && ngay(t.createdAt, w.createdAt)
            }),
        },
        product: {
            findMany: async ({ where }: any = {}) => k.products.filter(p =>
                !where?.id?.in || where.id.in.includes(p.id)),
        },
        customer: {
            findMany: async ({ where }: any = {}) => k.customers.filter(c =>
                where?.debt?.not === undefined ? true : c.debt !== where.debt.not),
        },
        payrollPeriod: { findMany: async () => k.payrollPeriods },
        payrollEntry: {
            findMany: async ({ where }: any = {}) => k.payrollEntries.filter(e =>
                !where?.periodId?.in || where.periodId.in.includes(e.periodId)),
        },
        fixedAsset: {
            findMany: async ({ where }: any = {}) => k.fixedAssets.filter(a => trong(a.status, where?.status)),
        },
        taxDeclaration: {
            findMany: async () => k.declarations,
            findFirst: async ({ where }: any = {}) => k.declarations.find(d => d.period === where?.period) ?? null,
        },
    }
}

/** Cửa hàng đủ dữ liệu: 1 phiếu bán có hóa đơn + ghi sổ đủ, 1 phiếu nhập có hóa đơn */
function khoDayDu(): Kho {
    return {
        journal: [
            // Trước kỳ — tạo số dư đầu kỳ tiền mặt 20tr
            { date: '2026-07-20', debitAccount: '111', creditAccount: '411', amount: 20_000_000, reference: 'OPEN-1', description: 'Góp vốn' },
            { date: '2026-07-20', debitAccount: '112', creditAccount: '411', amount: 20_000_000, reference: 'OPEN-2', description: 'Góp vốn qua ngân hàng' },
            // Trong kỳ
            { date: '2026-08-05', debitAccount: '131', creditAccount: '511', amount: 10_000_000, reference: 'SALE-HD001', description: 'Doanh thu HD001', debitAccountName: 'Phải thu KH', creditAccountName: 'Doanh thu' },
            { date: '2026-08-05', debitAccount: '131', creditAccount: '3331', amount: 1_000_000, reference: 'VAT-HD001', description: 'Thuế GTGT HD001' },
            { date: '2026-08-05', debitAccount: '632', creditAccount: '156', amount: 6_000_000, reference: 'COGS-HD001', description: 'Giá vốn HD001' },
            { date: '2026-08-06', debitAccount: '111', creditAccount: '131', amount: 11_000_000, reference: 'COLLECT-HD001', description: 'Thu tiền HD001' },
            { date: '2026-08-10', debitAccount: '156', creditAccount: '331', amount: 8_000_000, reference: 'IMP-PN001', description: 'Nhập hàng PN001' },
            { date: '2026-08-10', debitAccount: '1331', creditAccount: '331', amount: 800_000, reference: 'IMPVAT-PN001', description: 'GTGT đầu vào PN001' },
            { date: '2026-08-12', debitAccount: '331', creditAccount: '112', amount: 8_800_000, reference: 'IMPPAY-PN001', description: 'Chuyển khoản trả NCC' },
        ],
        invoices: [
            { invoiceNumber: '0000001', invoiceSymbol: '1C26TAA', invoiceDate: '2026-08-05', invoiceType: 'SALE', status: 'SIGNED', buyerName: 'Công ty A', buyerTaxCode: '0101234567', paymentMethod: 'CK', totalBeforeVat: 10_000_000, vatAmount: 1_000_000, totalAmount: 11_000_000, lookupCode: 'ABC123', transactionId: 't1' },
            { invoiceNumber: '0000002', invoiceSymbol: '1C26TAA', invoiceDate: '2026-08-07', invoiceType: 'SALE', status: 'CANCELLED', buyerName: 'Khách lẻ', buyerTaxCode: null, paymentMethod: 'TM', totalBeforeVat: 5_000_000, vatAmount: 500_000, totalAmount: 5_500_000, lookupCode: null, transactionId: null },
        ],
        imports: [
            { id: 'i1', code: 'PN001', status: 'completed', paymentStatus: 'paid', supplierName: 'NCC Một', totalCost: 8_800_000, vatAmount: 800_000, paidAmount: 8_800_000, hasVatInvoice: true, vatInvoiceNo: '0009999', userName: 'Thủ kho', transactionDate: new Date('2026-08-10'), createdAt: new Date('2026-08-10') },
            { id: 'i2', code: 'PN002', status: 'completed', paymentStatus: 'unpaid', supplierName: 'NCC Hai', totalCost: 3_000_000, vatAmount: 0, paidAmount: 0, hasVatInvoice: false, vatInvoiceNo: null, userName: 'Thủ kho', transactionDate: new Date('2026-08-15'), createdAt: new Date('2026-08-15'), dueDate: new Date('2026-09-15') },
        ],
        importItems: [
            { receiptId: 'i1', productId: 'p1', productName: 'Bút bi', productSku: 'BUT01', quantity: 100, total: 8_000_000 },
        ],
        expenses: [
            { description: 'Tiền điện tháng 8', amount: 2_200_000, vatAmount: 200_000, invoiceNo: '0001234', invoiceSymbol: '1C26EVN', invoiceDate: new Date('2026-08-20'), supplierName: 'EVN', supplierTaxCode: '0100100079', status: 'active', date: new Date('2026-08-20') },
            { description: 'Chi vặt không hóa đơn', amount: 500_000, vatAmount: 0, invoiceNo: null, supplierName: '', supplierTaxCode: null, status: 'active', date: new Date('2026-08-21') },
        ],
        transactions: [
            { id: 't1', receiptNumber: 'HD001', customerId: 'c1', customerName: 'Công ty A', subtotal: 10_000_000, discount: 0, tax: 1_000_000, total: 11_000_000, amountReceived: 11_000_000, status: 'completed', createdByName: 'Thu ngân', transactionDate: new Date('2026-08-05'), createdAt: new Date('2026-08-05'), vatStatus: 'issued', vatInvoiceNumber: '0000001' },
        ],
        transactionItems: [
            { transactionId: 't1', productId: 'p1', productName: 'Bút bi', sku: 'BUT01', quantity: 50, unitPrice: 200_000, lineTotal: 10_000_000 },
        ],
        products: [{ id: 'p1', stock: 50, costPrice: 80_000, unit: 'cái' }],
        customers: [{ code: 'KH001', name: 'Công ty A', phone: '0900000000', debt: 0, lastPurchaseDate: new Date('2026-08-05') }],
        payrollPeriods: [{ id: 'pp1', month: 8, year: 2026, status: 'paid' }],
        payrollEntries: [
            { periodId: 'pp1', employeeCode: 'NV01', employeeName: 'Nguyễn Văn A', workDays: 26, baseSalary: 8_000_000, allowances: 1_000_000, grossSalary: 9_000_000, totalInsuranceEmployee: 945_000, pitAmount: 0, netSalary: 8_055_000 },
        ],
        fixedAssets: [
            { code: 'TS01', name: 'Tủ lạnh trưng bày', acquisitionDate: '2025-01-01', originalCost: 24_000_000, usefulLifeMonths: 60, monthlyDepreciation: 400_000, accumulatedDepreciation: 8_000_000, netBookValue: 16_000_000, expenseAccountCode: '6424', status: 'active' },
        ],
        declarations: [
            { formType: '01_GTGT', period: '2026-08', periodType: 'month', status: 'submitted', ct29: 10_000_000, ct30: 1_000_000, ct33: 1_000_000, ct40a: 0, filedAt: new Date('2026-09-18') },
        ],
    }
}

const khoTrong = (): Kho => ({
    journal: [], invoices: [], imports: [], importItems: [], expenses: [],
    transactions: [], transactionItems: [], products: [], customers: [],
    payrollPeriods: [], payrollEntries: [], fixedAssets: [], declarations: [],
})

const layTl = (bo: BoHoSoThanhTra, ma: string): TaiLieuThanhTra | undefined =>
    bo.taiLieu.find(t => t.ma === ma)

async function main() {
    console.log('\n═══ BỘ HỒ SƠ THANH TRA ═══\n')

    // ── Kho đầy đủ ───────────────────────────────────────────────────────────
    const bo = await boHoSoThanhTra(fakePrisma(khoDayDu()), KY)

    console.log('▸ Dựng đủ tài liệu')
    for (const ma of ['01-hd-ban-ra', '02-hd-mua-vao', '03-nhat-ky-chung', '04-so-cai',
        '05-so-quy-tien-mat', '06-so-tien-gui', '08-cong-no-phai-tra', '09-nhap-xuat-ton',
        '10-bang-luong', '11-khau-hao-tscd', '12-to-khai']) {
        ok(`có tài liệu ${ma}`, !!layTl(bo, ma), bo.taiLieu.map(t => t.ma))
    }
    ok('mọi tài liệu đều ghi mẫu sổ', bo.taiLieu.every(t => !!t.mau))
    ok('mọi tài liệu đều ghi căn cứ pháp lý', bo.taiLieu.every(t => !!t.canCu))
    ok('mọi tài liệu đều nói rõ đoàn dùng để làm gì', bo.taiLieu.every(t => t.vaiTro.length > 30))
    ok('mọi cột đều có nhãn tiếng Việt', bo.taiLieu.every(t => t.cot.every(c => !!c.nhan)))
    ok('không tài liệu nào rỗng cột', bo.taiLieu.every(t => t.cot.length > 0))

    console.log('\n▸ Bảng kê bán ra')
    const banRa = layTl(bo, '01-hd-ban-ra')!
    ok('liệt kê cả hóa đơn đã hủy (dải số liên tục)', banRa.dong.length === 2, banRa.dong.length)
    const huy = banRa.dong.find(d => d.trangThai === 'ĐÃ HỦY')
    ok('hóa đơn hủy ghi tiền = 0', !!huy && huy.truocThue === 0 && huy.tong === 0, huy)
    ok('tổng doanh thu chỉ cộng hóa đơn còn hiệu lực',
        banRa.tong.truocThue === 10_000_000, banRa.tong.truocThue)
    ok('sắp xếp theo ngày lập', banRa.dong[0].ngay <= banRa.dong[1].ngay)

    console.log('\n▸ Bảng kê mua vào')
    const muaVao = layTl(bo, '02-hd-mua-vao')!
    ok('gộp cả phiếu nhập lẫn phiếu chi', muaVao.dong.length === 4, muaVao.dong.length)
    ok('đánh dấu rõ khoản KHÔNG CÓ HĐ',
        muaVao.dong.filter(d => d.soHd === 'KHÔNG CÓ HĐ').length === 2, muaVao.dong.map(d => d.soHd))
    ok('cột giá trị chưa thuế đã trừ VAT khỏi tổng phiếu nhập',
        muaVao.dong.some(d => d.noiDung?.includes('PN001') && d.truocThue === 8_000_000),
        muaVao.dong.find(d => d.noiDung?.includes('PN001')))
    ok('tổng thuế đầu vào = 800k + 200k', muaVao.tong.thue === 1_000_000, muaVao.tong.thue)

    console.log('\n▸ Sổ cái')
    const soCai = layTl(bo, '04-so-cai')!
    ok('tổng phát sinh Nợ = tổng phát sinh Có', soCai.tong.psNo === soCai.tong.psCo,
        { no: soCai.tong.psNo, co: soCai.tong.psCo })
    const tk111 = soCai.dong.find(d => d.tk === '111')!
    ok('111 có số dư đầu kỳ 20tr từ bút toán trước kỳ', tk111.dauNo === 20_000_000, tk111)
    ok('số dư trình bày MỘT bên (không cùng lúc Nợ và Có)',
        soCai.dong.every(d => !(d.cuoiNo > 0 && d.cuoiCo > 0)))
    const tk511 = soCai.dong.find(d => d.tk === '511')!
    ok('511 dư Có cuối kỳ 10tr', tk511.cuoiCo === 10_000_000 && tk511.cuoiNo === 0, tk511)
    ok('sổ cái lấy được tên tài khoản khi bút toán có ghi',
        soCai.dong.find(d => d.tk === '511')?.ten === 'Doanh thu', tk511.ten)

    console.log('\n▸ Sổ quỹ tiền mặt')
    const quy = layTl(bo, '05-so-quy-tien-mat')!
    ok('có dòng số dư đầu kỳ', quy.dong[0].dienGiai === 'Số dư đầu kỳ' && quy.dong[0].ton === 20_000_000, quy.dong[0])
    ok('tồn cuối = 20tr + 11tr thu = 31tr', quy.tong.ton === 31_000_000, quy.tong.ton)
    ok('cột tồn KHÔNG bị cộng dồn vô nghĩa', quy.tong.ton === quy.dong[quy.dong.length - 1].ton)
    ok('chỉ lấy bút toán liên quan 111', quy.dong.length === 2, quy.dong.length)
    const nh = layTl(bo, '06-so-tien-gui')!
    ok('sổ tiền gửi chỉ nhận bút toán 112, không lẫn bút toán quỹ',
        nh.dong.length === 2 && nh.dong[1].chi === 8_800_000, nh.dong)
    ok('tồn ngân hàng cuối kỳ = 20tr − 8,8tr', nh.tong.ton === 11_200_000, nh.tong.ton)

    console.log('\n▸ Công nợ')
    ok('không có khách nợ thì bỏ qua bảng 131',
        !layTl(bo, '07-cong-no-phai-thu') && bo.thieu.some(t => t.ma === '07-cong-no-phai-thu'))
    const phaiTra = layTl(bo, '08-cong-no-phai-tra')!
    ok('chỉ liệt kê phiếu chưa trả đủ', phaiTra.dong.length === 1 && phaiTra.dong[0].maPhieu === 'PN002', phaiTra.dong)
    ok('còn nợ = phải trả − đã trả', phaiTra.dong[0].conNo === 3_000_000, phaiTra.dong[0])

    console.log('\n▸ Nhập xuất tồn')
    const nxt = layTl(bo, '09-nhap-xuat-ton')!
    ok('gộp nhập và xuất về cùng một dòng hàng', nxt.dong.length === 1, nxt.dong.length)
    ok('số lượng nhập/xuất đúng', nxt.dong[0].slNhap === 100 && nxt.dong[0].slXuat === 50, nxt.dong[0])
    ok('giá trị tồn = tồn × giá vốn', nxt.dong[0].giaTriTon === 4_000_000, nxt.dong[0])
    ok('nói rõ tồn là tồn tại thời điểm xuất bảng', /THỜI ĐIỂM XUẤT/.test(nxt.ghiChu || ''))

    console.log('\n▸ Lương & khấu hao')
    const luong = layTl(bo, '10-bang-luong')!
    ok('lấy đúng kỳ lương trong khoảng', luong.dong.length === 1 && luong.dong[0].ky === '08/2026', luong.dong[0])
    ok('tổng thực lĩnh đúng', luong.tong.thucLinh === 8_055_000, luong.tong.thucLinh)
    const kh = layTl(bo, '11-khau-hao-tscd')!
    ok('khấu hao trong kỳ 1 tháng = mức tháng', kh.dong[0].khKy === 400_000, kh.dong[0])

    console.log('\n▸ Danh sách tài liệu ngoài hệ thống')
    ok('có nhắc hợp đồng lao động', bo.thieu.some(t => t.ma === 'x-hdld'))
    ok('có nhắc biên bản kiểm kê', bo.thieu.some(t => t.ma === 'x-kiem-ke'))
    ok('có nhắc sao kê ngân hàng', bo.thieu.some(t => t.ma === 'x-sao-ke'))
    ok('mọi mục ngoài hệ thống đều chỉ chỗ lấy', bo.thieu.every(t => t.layTuDau.length > 10))
    ok('đếm tài liệu trống KHÔNG tính mục ngoài hệ thống',
        bo.tongQuan.soTaiLieuTrong === bo.thieu.filter(t => !t.ma.startsWith('x-')).length)

    console.log('\n▸ Xuất CSV')
    const csv = sangCsv(banRa)
    ok('CSV có BOM để Excel đọc đúng tiếng Việt', csv.charCodeAt(0) === 0xfeff)
    ok('CSV có dòng tiêu đề tài liệu', csv.includes('Bảng kê hóa đơn'))
    ok('CSV có dòng TỔNG CỘNG', csv.includes('TỔNG CỘNG'))
    ok('CSV bọc ngoặc ô có dấu phẩy',
        sangCsv({ ...banRa, dong: [{ ...banRa.dong[0], nguoiMua: 'Cty A, B' }] }).includes('"Cty A, B"'))
    ok('CSV nhân đôi dấu nháy trong ô',
        sangCsv({ ...banRa, dong: [{ ...banRa.dong[0], nguoiMua: 'Cty "X"' }] }).includes('""X""'))
    ok('CSV dùng CRLF', csv.includes('\r\n'))

    // ── Kho rỗng: không được nổ ──────────────────────────────────────────────
    console.log('\n▸ Cửa hàng chưa có dữ liệu')
    const boTrong = await boHoSoThanhTra(fakePrisma(khoTrong()), KY)
    ok('không nổ khi rỗng', boTrong.taiLieu.length === 0, boTrong.taiLieu.length)
    ok('vẫn liệt kê tài liệu ngoài hệ thống', boTrong.thieu.length >= 5)
    ok('mọi tài liệu thiếu đều ghi lý do', boTrong.thieu.every(t => !!t.lyDo))

    // ── Truy vấn hỏng: đánh dấu thiếu chứ không sập ──────────────────────────
    console.log('\n▸ Một bảng truy vấn hỏng')
    const kHong: any = fakePrisma(khoDayDu())
    kHong.customer = { findMany: async () => { throw new Error('P2022 cột không tồn tại') } }
    const boHong = await boHoSoThanhTra(kHong, KY)
    ok('bảng khác vẫn dựng bình thường', boHong.taiLieu.length >= 10, boHong.taiLieu.length)
    ok('bảng hỏng bị ghi vào danh sách thiếu kèm lỗi',
        boHong.thieu.some(t => t.ma === '07-cong-no-phai-thu' && /P2022/.test(t.lyDo)),
        boHong.thieu.find(t => t.ma === '07-cong-no-phai-thu'))

    // ═══ TRUY VẾT ════════════════════════════════════════════════════════════
    console.log('\n═══ TRUY VẾT CHỨNG TỪ ═══\n')
    const px = fakePrisma(khoDayDu())

    console.log('▸ Phiếu bán đầy đủ giấy tờ')
    const v1 = await truyVetChungTu(px, 'HD001')
    ok('tìm thấy theo số phiếu', v1.timThay && v1.loai === 'ban-hang', v1.loai)
    ok('đủ 6 mốc', v1.moc.length === 6, v1.moc.map(m => m.ten))
    ok('không mắt xích nào đứt', v1.soMocDut === 0, v1.moc.filter(m => m.trangThai === 'thieu'))
    ok('không cảnh báo', v1.canhBao.length === 0, v1.canhBao)
    ok('mốc nào cũng kèm câu đoàn hay hỏi', v1.moc.every(m => !!m.cauHoi))
    ok('mốc hóa đơn nêu đúng số', v1.moc[2].chiTiet.includes('0000001'), v1.moc[2].chiTiet)
    ok('mốc kê khai chỉ đúng kỳ 2026-08', v1.moc[5].chiTiet.includes('2026-08'), v1.moc[5].chiTiet)

    console.log('▸ Tìm bằng số hóa đơn điện tử')
    const v2 = await truyVetChungTu(px, '0000001')
    ok('số hóa đơn dẫn ngược về phiếu bán', v2.timThay && v2.tieuDe.includes('HD001'), v2.tieuDe)

    console.log('▸ Phiếu bán KHÔNG hóa đơn, KHÔNG ghi sổ')
    const kThieu = khoDayDu()
    kThieu.invoices = []
    kThieu.journal = kThieu.journal.filter(j => !String(j.reference).includes('HD001'))
    const v3 = await truyVetChungTu(fakePrisma(kThieu), 'HD001')
    ok('phát hiện thiếu hóa đơn', v3.moc[2].trangThai === 'thieu', v3.moc[2])
    ok('phát hiện chưa ghi sổ', v3.moc[3].trangThai === 'thieu', v3.moc[3])
    ok('đếm đúng số mắt xích đứt', v3.soMocDut === 2, v3.soMocDut)
    ok('cảnh báo dẫn Điều 90 Luật QLT', v3.canhBao.some(c => c.includes('Điều 90')), v3.canhBao)

    console.log('▸ Hóa đơn lập lệch ngày bán')
    const kLech = khoDayDu()
    kLech.invoices[0].invoiceDate = '2026-08-25'
    const v4 = await truyVetChungTu(fakePrisma(kLech), 'HD001')
    ok('cảnh báo ngày hóa đơn khác ngày bán',
        v4.canhBao.some(c => c.includes('NĐ 123/2020')), v4.canhBao)
    ok('vẫn coi mốc hóa đơn là CÓ (đã ký)', v4.moc[2].trangThai === 'co')

    console.log('▸ Có doanh thu nhưng thiếu giá vốn')
    const kGv = khoDayDu()
    kGv.journal = kGv.journal.filter(j => !String(j.reference).startsWith('COGS-'))
    const v5 = await truyVetChungTu(fakePrisma(kGv), 'HD001')
    ok('cảnh báo chưa kết chuyển giá vốn',
        v5.canhBao.some(c => c.includes('giá vốn')), v5.canhBao)

    console.log('▸ Phiếu nhập không hóa đơn')
    const v6 = await truyVetChungTu(px, 'PN002')
    ok('nhận diện là phiếu nhập', v6.loai === 'nhap-hang', v6.loai)
    ok('mốc hóa đơn đầu vào = thiếu', v6.moc[2].trangThai === 'thieu', v6.moc[2])
    ok('cảnh báo dẫn TT 96/2015 loại chi phí',
        v6.canhBao.some(c => c.includes('TT 96/2015')), v6.canhBao)
    ok('không cảnh báo tiền mặt vì dưới 5 triệu và không có HĐ',
        !v6.canhBao.some(c => c.includes('5 triệu')), v6.canhBao)

    console.log('▸ Phiếu nhập ≥ 5 triệu có hóa đơn')
    const v7 = await truyVetChungTu(px, 'PN001')
    ok('cảnh báo phải thanh toán không tiền mặt',
        v7.canhBao.some(c => c.includes('KHÔNG DÙNG TIỀN MẶT')), v7.canhBao)
    ok('mốc hóa đơn đầu vào = có', v7.moc[2].trangThai === 'co')
    ok('mốc ghi sổ = có', v7.moc[3].trangThai === 'co', v7.moc[3])

    console.log('▸ Mã không tồn tại')
    const v8 = await truyVetChungTu(px, 'KHONG-CO-MA-NAY')
    ok('báo không tìm thấy, không nổ', !v8.timThay && v8.loai === 'khong-ro')
    ok('hướng dẫn nhập mã kiểu gì', v8.tieuDe.includes('số phiếu bán'), v8.tieuDe)
    const v9 = await truyVetChungTu(px, '   ')
    ok('mã rỗng cũng không nổ', !v9.timThay)

    console.log(`\n${dat}/${dat + hong} ca đạt`)
    if (hong) process.exit(1)
}

main().catch(e => { console.error(e); process.exit(1) })
