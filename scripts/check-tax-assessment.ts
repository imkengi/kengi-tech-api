/**
 * Kiểm chứng MÔ PHỎNG BỊ ẤN ĐỊNH THUẾ.
 *
 * Chạy:  npx tsx scripts/check-tax-assessment.ts
 *
 * Module này nói ra những con số rất lớn ("nếu bị ấn định bạn mất X trăm
 * triệu"). Dọa sai là mất uy tín cả sản phẩm, nên bộ test tập trung vào:
 *  - sổ sạch thì KHÔNG được dựng căn cứ ấn định nào,
 *  - mỗi căn cứ phải dẫn đúng điều khoản và có cách phản bác,
 *  - phần ghi chú luôn nói rõ đây là ước tính minh họa.
 */

import {
    moPhongAnDinh, TY_LE_TT40, THUE_SUAT_TNDN, TY_SUAT_LOI_NHUAN_MAC_DINH,
} from '../src/lib/taxAssessment'

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
    journal: any[]; invoices: any[]; transactions: any[]; imports: any[]
    products: any[]; declaration: any; settings: any
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
        importReceipt: { findMany: async ({ where }: any = {}) => k.imports.filter(i => ngay(i.createdAt, where?.createdAt)) },
        product: {
            findMany: async ({ where }: any = {}) => where?.stock?.lt !== undefined
                ? k.products.filter(p => (p.stock ?? 0) < where.stock.lt) : k.products,
        },
        taxDeclaration: { findFirst: async () => k.declaration },
        storeSettings: { findFirst: async () => k.settings },
    }
}

/** Doanh nghiệp sổ sạch: ba nguồn khớp, nhập có hóa đơn, quỹ dương, tồn dương */
function khoSach(): Kho {
    return {
        journal: [
            { date: '2026-07-20', debitAccount: '111', creditAccount: '411', amount: 100_000_000 },
            { date: '2026-08-05', debitAccount: '111', creditAccount: '511', amount: 200_000_000 },
            { date: '2026-08-05', debitAccount: '111', creditAccount: '3331', amount: 20_000_000 },
            { date: '2026-08-05', debitAccount: '632', creditAccount: '156', amount: 150_000_000 },
            { date: '2026-08-10', debitAccount: '156', creditAccount: '112', amount: 160_000_000 },
            { date: '2026-08-10', debitAccount: '1331', creditAccount: '112', amount: 16_000_000 },
            { date: '2026-08-28', debitAccount: '642', creditAccount: '112', amount: 20_000_000 },
        ],
        invoices: [
            { status: 'SIGNED', invoiceType: 'SALE', totalBeforeVat: 200_000_000, transactionId: 't1' },
        ],
        transactions: [{ id: 't1', total: 220_000_000, createdAt: new Date('2026-08-05') }],
        imports: [{ totalCost: 176_000_000, hasVatInvoice: true, createdAt: new Date('2026-08-10') }],
        products: [],
        declaration: { ct29: 200_000_000, ct30: 20_000_000, ct33: 16_000_000, ct40a: 4_000_000 },
        settings: { businessType: 'company' },
    }
}

async function main() {
    console.log('\n═══ MÔ PHỎNG BỊ ẤN ĐỊNH THUẾ ═══\n')

    console.log('▸ Doanh nghiệp sổ sạch')
    const sach = await moPhongAnDinh(fakePrisma(khoSach()), KY)
    ok('không dựng căn cứ ấn định nào', sach.canCu.length === 0, sach.canCu.map(c => c.ma))
    ok('nguy cơ thấp', sach.nguyCo === 'thap', sach.nguyCo)
    ok('vẫn đưa ra kịch bản để tham khảo', sach.kichBan.length === 2, sach.kichBan.length)
    ok('doanh thu gốc ấn định = mức cao nhất trong các nguồn',
        sach.doanhThuGocAnDinh === 220_000_000, sach.doanhThuGocAnDinh)
    ok('doanh thu sổ tính đúng', sach.doanhThuSo === 200_000_000, sach.doanhThuSo)
    ok('ghi chú nói rõ là ước tính minh họa', /ƯỚC TÍNH MINH HỌA/.test(sach.ghiChu))
    ok('ghi chú thừa nhận không truy cập được dữ liệu ngành của cơ quan thuế',
        /không truy cập được/.test(sach.ghiChu))
    ok('luôn khuyên khai bổ sung trước khi có quyết định thanh tra',
        sach.canLamNgay.some(c => c.includes('Khai bổ sung')))
    ok('nêu lợi ích cụ thể của tự phát hiện (khỏi 20% phạt)',
        sach.canLamNgay.some(c => c.includes('20%')))

    console.log('\n▸ Guard cấu trúc')
    const kBan = khoSach()
    kBan.declaration = null
    kBan.products = [{ sku: 'X', name: 'Hàng', stock: -3 }]
    kBan.imports = [{ totalCost: 176_000_000, hasVatInvoice: false, createdAt: new Date('2026-08-10') }]
    kBan.invoices = []
    const ban = await moPhongAnDinh(fakePrisma(kBan), KY)
    ok('mọi căn cứ đều dẫn điều khoản', ban.canCu.every(c => /Điều \d+/.test(c.dieuKhoan)),
        ban.canCu.map(c => c.dieuKhoan))
    ok('mọi căn cứ đều chỉ cách phản bác', ban.canCu.every(c => c.caiThenao.length > 40),
        ban.canCu.filter(c => c.caiThenao.length <= 40).map(c => c.ma))
    ok('mọi căn cứ đều nói rõ hậu quả', ban.canCu.every(c => c.chiTiet.length > 40))
    ok('mã căn cứ không trùng', new Set(ban.canCu.map(c => c.ma)).size === ban.canCu.length)

    console.log('\n▸ Từng căn cứ ấn định')
    ok('chưa nộp tờ khai → căn cứ rõ ràng', ban.canCu.some(c => c.ma === 'khong-nop-to-khai' && c.muc === 'ro-rang'))
    ok('không kết luận bừa: nhắc dữ liệu thiếu không có nghĩa là chưa nộp',
        ban.canCu.find(c => c.ma === 'khong-nop-to-khai')!.caiThenao.includes('không có nghĩa là chưa nộp'))
    ok('tồn kho âm → căn cứ rõ ràng', ban.canCu.some(c => c.ma === 'ton-kho-am' && c.muc === 'ro-rang'))
    ok('nhập không hóa đơn quá 30% → có dấu hiệu',
        ban.canCu.some(c => c.ma === 'mua-vao-khong-hoa-don'))
    ok('bán không xuất hóa đơn quá 20% → có dấu hiệu',
        ban.canCu.some(c => c.ma === 'ban-khong-xuat-hoa-don'))
    ok('nhiều căn cứ rõ ràng → nguy cơ cao', ban.nguyCo === 'cao', ban.nguyCo)

    console.log('\n▸ Ngưỡng không được kêu bừa')
    const kItThieu = khoSach()
    // 10% nhập không hóa đơn — dưới ngưỡng 30%
    kItThieu.imports = [
        { totalCost: 160_000_000, hasVatInvoice: true, createdAt: new Date('2026-08-10') },
        { totalCost: 16_000_000, hasVatInvoice: false, createdAt: new Date('2026-08-11') },
    ]
    const itThieu = await moPhongAnDinh(fakePrisma(kItThieu), KY)
    ok('nhập thiếu hóa đơn ít thì không dựng căn cứ',
        !itThieu.canCu.some(c => c.ma === 'mua-vao-khong-hoa-don'), itThieu.canCu.map(c => c.ma))

    const kLechNho = khoSach()
    kLechNho.declaration = { ...kLechNho.declaration, ct29: 200_500_000 }  // lệch 0,25%
    const lechNho = await moPhongAnDinh(fakePrisma(kLechNho), KY)
    ok('lệch tờ khai dưới 2% thì bỏ qua',
        !lechNho.canCu.some(c => c.ma === 'so-lieu-khong-trung-thuc'), lechNho.canCu.map(c => c.ma))

    const kLechTo = khoSach()
    kLechTo.declaration = { ...kLechTo.declaration, ct29: 150_000_000 }
    const lechTo = await moPhongAnDinh(fakePrisma(kLechTo), KY)
    ok('lệch tờ khai lớn thì dựng căn cứ',
        lechTo.canCu.some(c => c.ma === 'so-lieu-khong-trung-thuc'))
    ok('nêu đúng số tiền lệch',
        lechTo.canCu.find(c => c.ma === 'so-lieu-khong-trung-thuc')!.dauHieu.includes('50.000.000'),
        lechTo.canCu.find(c => c.ma === 'so-lieu-khong-trung-thuc')!.dauHieu)

    console.log('\n▸ Kịch bản của doanh nghiệp')
    const kb1 = sach.kichBan[0], kb2 = sach.kichBan[1]
    ok('kịch bản 1 là loại chi phí không hóa đơn', kb1.ten.includes('Loại chi phí'))
    ok('kịch bản 2 là ấn định theo tỷ suất lợi nhuận ngành', kb2.ten.includes('tỷ suất lợi nhuận'))
    ok('kịch bản 2 dẫn Điều 15 NĐ 126/2020', kb2.canCu.includes('126/2020'))
    ok('kịch bản 2 tính đúng: 220tr × 5% × 20% = 2,2tr',
        kb2.thueTndnHoacTncn === 2_200_000, kb2.thueTndnHoacTncn)
    ok('mọi kịch bản đều ghi cách tính bằng lời', sach.kichBan.every(k => k.cachTinh.length > 20))
    ok('chênh lệch = tổng thuế ấn định − thuế đã kê khai',
        sach.kichBan.every(k => k.chenhLech === k.tongThue - sach.thueDaKeKhai))

    console.log('\n▸ Tỷ suất lợi nhuận cho phép chỉnh')
    const tuyChinh = await moPhongAnDinh(fakePrisma(khoSach()), KY, { tySuatLoiNhuan: 0.1 })
    ok('đổi tỷ suất thì số thuế đổi theo',
        tuyChinh.kichBan[1].thueTndnHoacTncn === 4_400_000, tuyChinh.kichBan[1].thueTndnHoacTncn)
    ok('mặc định là 5%', TY_SUAT_LOI_NHUAN_MAC_DINH === 0.05)

    console.log('\n▸ Hộ kinh doanh')
    const kHkd = khoSach()
    kHkd.settings = { businessType: 'household' }
    const hkd = await moPhongAnDinh(fakePrisma(kHkd), KY)
    ok('nhận diện hộ kinh doanh', hkd.laHoKinhDoanh)
    ok('chỉ một kịch bản theo tỷ lệ % doanh thu', hkd.kichBan.length === 1)
    ok('dẫn Thông tư 40/2021', hkd.kichBan[0].canCu.includes('40/2021'))
    ok('ngành mặc định là phân phối hàng hóa 1% + 0,5%',
        hkd.kichBan[0].thueGtgt === 2_200_000 && hkd.kichBan[0].thueTndnHoacTncn === 1_100_000,
        hkd.kichBan[0])
    const hkdDv = await moPhongAnDinh(fakePrisma(kHkd), KY, { nganh: 'dich-vu' })
    ok('đổi ngành sang dịch vụ thì tỷ lệ 5% + 2%',
        hkdDv.kichBan[0].thueGtgt === 11_000_000 && hkdDv.kichBan[0].thueTndnHoacTncn === 4_400_000,
        hkdDv.kichBan[0])
    ok('tỷ lệ TT40 khai báo đủ 4 ngành', Object.keys(TY_LE_TT40).length === 4)
    ok('thuế suất TNDN đúng 20%', THUE_SUAT_TNDN === 0.2)

    console.log('\n▸ Cửa hàng rỗng / truy vấn hỏng')
    const rong = await moPhongAnDinh(fakePrisma({
        journal: [], invoices: [], transactions: [], imports: [],
        products: [], declaration: null, settings: null,
    }), KY)
    ok('không nổ khi rỗng', rong.kichBan.length > 0)
    ok('doanh thu 0 thì thuế ấn định 0', rong.kichBan.every(k => k.tongThue === 0), rong.kichBan)
    ok('vẫn nêu căn cứ chưa nộp tờ khai', rong.canCu.some(c => c.ma === 'khong-nop-to-khai'))

    const hongDb: any = fakePrisma(khoSach())
    hongDb.journalEntry = { findMany: async () => { throw new Error('P1001') } }
    const chiuLoi = await moPhongAnDinh(hongDb, KY)
    ok('truy vấn hỏng không làm sập', chiuLoi.kichBan.length > 0)

    /* Căn cứ "chưa nộp tờ khai" là căn cứ ấn định NẶNG NHẤT — nó nói cơ quan
     * thuế có quyền bỏ qua toàn bộ sổ sách. Dựng nó từ một truy vấn hỏng là
     * buộc tội oan ở mức cao nhất. */
    const hongToKhai: any = fakePrisma(khoSach())
    hongToKhai.taxDeclaration = { findFirst: async () => { throw new Error('The table `TaxDeclaration` does not exist') } }
    const kqHong = await moPhongAnDinh(hongToKhai, KY)
    ok('không đọc được tờ khai → KHÔNG dựng căn cứ "chưa nộp tờ khai"',
        !kqHong.canCu.some(c => c.ma === 'khong-nop-to-khai'),
        kqHong.canCu.map(c => c.ma))
    ok('cũng không suy ra căn cứ "số liệu không trung thực" từ số rỗng',
        !kqHong.canCu.some(c => c.ma === 'so-lieu-khong-trung-thuc'),
        kqHong.canCu.map(c => c.ma))

    console.log(`\n${dat}/${dat + hong} ca đạt`)
    if (hong) process.exit(1)
}

main().catch(e => { console.error(e); process.exit(1) })
