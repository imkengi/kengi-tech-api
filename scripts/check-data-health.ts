/**
 * Kiểm chứng SỨC KHOẺ DỮ LIỆU.
 *
 * Chạy:  npx tsx scripts/check-data-health.ts
 *
 * Màn hình này nói "dữ liệu của bạn chưa tin được". Nói sai thì người dùng đi
 * sửa những thứ không hỏng, rồi lần sau bỏ qua cả cảnh báo thật. Nên bộ test
 * tập trung vào hai phía:
 *  - dữ liệu sạch thì MỌI mục phải xanh, không được bới ra vấn đề;
 *  - mỗi mục hỏng phải nói ĐÚNG hậu quả của nó, vì người dùng không sửa một cảnh
 *    báo mà họ không hiểu ảnh hưởng tới đâu.
 */

import { sucKhoeDuLieu } from '../src/lib/dataHealth'

let dat = 0, hong = 0
function ok(ten: string, dk: boolean, thucTe?: any) {
    if (dk) { dat++; console.log(`  ✓ ${ten}`) }
    else { hong++; console.log(`  ✗ ${ten}${thucTe !== undefined ? ` — thực tế: ${JSON.stringify(thucTe)}` : ''}`) }
}

const KY = {
    from: '2026-05-16', to: '2026-08-13',
    start: new Date('2026-05-16T00:00:00+07:00'),
    end: new Date('2026-08-14T00:00:00+07:00'),
}

interface Kho {
    soNgayCoBan?: number
    tonAm?: { so: number; tong: number }
    hoaDonHong?: any[]
    doanhThu?: number
    chiPhi?: number
    taiKhoan?: any[]
    phieuNhap?: any[]
    choBanAm?: boolean
    tonAmTop?: any[]
}

function fake(k: Kho, loi?: Record<string, boolean>) {
    const no = (t: string) => { if (loi?.[t]) throw new Error(`The table \`${t}\` does not exist`) }
    return {
        $queryRawUnsafe: async () => {
            no('phamVi')
            return [{ soNgay: k.soNgayCoBan ?? 90, somNhat: new Date('2026-05-16T00:00:00Z'), muonNhat: new Date('2026-08-13T00:00:00Z') }]
        },
        product: {
            aggregate: async () => {
                no('product')
                return { _count: k.tonAm?.so ?? 0, _sum: { stock: k.tonAm?.tong ?? 0 } }
            },
            findMany: async () => {
                no('product')
                return (k.tonAmTop ?? []) as any[]
            },
        },
        eInvoice: { findMany: async () => { no('eInvoice'); return k.hoaDonHong ?? [] } },
        transaction: { aggregate: async () => { no('transaction'); return { _sum: { total: k.doanhThu ?? 0 } } } },
        expense: { aggregate: async () => { no('expense'); return { _sum: { amount: k.chiPhi ?? 0 } } } },
        bankAccount: { findMany: async () => { no('bankAccount'); return k.taiKhoan ?? [] } },
        importReceipt: { findMany: async () => { no('importReceipt'); return k.phieuNhap ?? [] } },
        storeSettings: { findFirst: async () => { no('storeSettings'); return { allowNegativeStock: k.choBanAm ?? false } } },
    }
}

/** Kho hoàn toàn sạch — mọi mục phải xanh. */
const SACH: Kho = {
    soNgayCoBan: 88,
    tonAm: { so: 0, tong: 0 },
    hoaDonHong: [],
    doanhThu: 1_000_000_000,
    chiPhi: 150_000_000,
    taiKhoan: [{ balance: 50_000_000 }],
}

const lay = (kq: any, ma: string) => kq.muc.find((m: any) => m.ma === ma)

async function main() {
    console.log('\n▶ Dữ liệu sạch — KHÔNG được bới ra vấn đề\n')

    const s = await sucKhoeDuLieu(fake(SACH), KY)
    ok('mọi mục đều ở mức "ổn"', s.muc.every((m: any) => m.muc === 'on'), s.muc.filter((m: any) => m.muc !== 'on').map((m: any) => m.ma))
    ok('điểm đạt 100', s.diem === 100, s.diem)
    ok('xếp loại "tốt"', s.xepLoai === 'tốt', s.xepLoai)
    ok('không có mục nào thiếu dữ liệu', s.thieu.length === 0, s.thieu)

    console.log('\n▶ Dữ liệu chỉ phủ một phần kỳ\n')

    const mong = await sucKhoeDuLieu(fake({ ...SACH, soNgayCoBan: 20 }), KY)
    const mPhu = lay(mong, 'pham-vi-du-lieu')
    ok('phủ 20/90 ngày → mức NẶNG', mPhu.muc === 'nang', mPhu.muc)
    ok('… nói rõ mọi con số cả kỳ là MỨC SÀN', /MỨC SÀN|MỨC SÀN|mức sàn/i.test(mPhu.anhHuong), mPhu.anhHuong)
    ok('… nêu đúng tỷ lệ', /20\/90/.test(mPhu.so || ''), mPhu.so)

    /* Ca thật 14/08/2026: một cửa hàng có 31/91 ngày nhưng dữ liệu LIÊN TỤC từ
     * 15/07 — họ mới bắt đầu dùng phần mềm, không sót ngày nào. Gắn cờ "phải
     * sửa" cho họ là buộc tội oan, và lần sau họ bỏ qua luôn cảnh báo thật. */
    const batDauMuon = await sucKhoeDuLieu({
        ...fake({ ...SACH, soNgayCoBan: 30 }),
        $queryRawUnsafe: async () => [{
            soNgay: 30,
            somNhat: new Date('2026-07-15T00:00:00Z'),
            muonNhat: new Date('2026-08-13T00:00:00Z'),
        }],
    } as any, KY)
    const mMuon = lay(batDauMuon, 'pham-vi-du-lieu')
    ok('dữ liệu liên tục từ giữa kỳ → KHÔNG phải mức nặng', mMuon.muc === 'vua', mMuon.muc)
    ok('… gọi đúng tên: bắt đầu từ giữa kỳ', /bắt đầu từ giữa kỳ/.test(mMuon.ten), mMuon.ten)
    ok('… nói rõ KHÔNG PHẢI lỗi dữ liệu', /Không phải lỗi dữ liệu/.test(mMuon.anhHuong), mMuon.anhHuong)
    ok('… và chỉ cách đọc: từ ngày bắt đầu trở đi', /2026-07-15 trở đi/.test(mMuon.canLam), mMuon.canLam)

    /* Ngược lại: cùng 30 ngày nhưng rải rác suốt kỳ thì đúng là thiếu dữ liệu. */
    const raiRac = await sucKhoeDuLieu({
        ...fake({ ...SACH, soNgayCoBan: 30 }),
        $queryRawUnsafe: async () => [{
            soNgay: 30,
            somNhat: new Date('2026-05-16T00:00:00Z'),
            muonNhat: new Date('2026-08-13T00:00:00Z'),
        }],
    } as any, KY)
    const mRai = lay(raiRac, 'pham-vi-du-lieu')
    ok('cùng 30 ngày nhưng rải rác cả kỳ → mức NẶNG', mRai.muc === 'nang', mRai.muc)
    ok('… nói rõ thiếu quãng giữa kỳ', /rải rác|thiếu nhiều quãng/.test(mRai.anhHuong), mRai.anhHuong)

    console.log('\n▶ Tồn âm\n')

    const ta = await sucKhoeDuLieu(fake({ ...SACH, tonAm: { so: 262, tong: -4077 } }), KY)
    const mTon = lay(ta, 'ton-am')
    ok('262 mã tồn âm → mức NẶNG', mTon.muc === 'nang', mTon.muc)
    ok('… nói rõ làm bảng đặt hàng đòi mua thừa', /mua thừa/.test(mTon.anhHuong), mTon.anhHuong)
    ok('… việc cần làm là KIỂM KÊ, không phải đặt hàng', /[Kk]iểm kê/.test(mTon.canLam), mTon.canLam)
    ok('… nói rõ cửa hàng KHÔNG bật cho bán âm nên đây là lệch sổ',
        /KHÔNG bật cho phép bán âm/.test(mTon.anhHuong), mTon.anhHuong)

    /* "262 mã tồn âm" không nói được phải mở cái gì trước. Phải kèm mã cụ thể,
     * và ưu tiên mã âm SÂU NHẤT vì đó thường là chỗ lệch rõ nhất. */
    const coViDu = await sucKhoeDuLieu(fake({
        ...SACH,
        tonAm: { so: 3, tong: -600 },
        tonAmTop: [
            { id: 'p1', name: 'Nồi chiên', sku: 'NC01', stock: -500 },
            { id: 'p2', name: 'Ấm siêu tốc', sku: 'AS01', stock: -80 },
        ],
    }), KY)
    const mVd = lay(coViDu, 'ton-am')
    ok('kèm danh sách mã cụ thể để bắt đầu', (mVd.viDu?.length ?? 0) === 2, mVd.viDu)
    ok('… có id để bấm vào truy vết được', !!mVd.viDu?.[0]?.id, mVd.viDu?.[0])
    ok('… nhãn gồm cả tên lẫn mã hàng', /Nồi chiên \(NC01\)/.test(mVd.viDu?.[0]?.nhan || ''), mVd.viDu?.[0]?.nhan)
    ok('… và số tồn đang âm', /tồn -500/.test(mVd.viDu?.[0]?.phu || ''), mVd.viDu?.[0]?.phu)

    const khongTonAm = await sucKhoeDuLieu(fake({ ...SACH, tonAm: { so: 0, tong: 0 } }), KY)
    ok('không có mã âm → danh sách rỗng, không gọi thừa',
        (lay(khongTonAm, 'ton-am').viDu?.length ?? 0) === 0)

    /* Cửa hàng CỐ Ý bật "cho phép bán khi hết tồn": tồn âm là bán trước, hàng về
     * sẽ bù. Nói "lệch sổ sách" ở đây là buộc tội oan đúng cái họ chủ động chọn,
     * và lần sau họ bỏ qua luôn cảnh báo thật. */
    const banAm = await sucKhoeDuLieu(fake({ ...SACH, tonAm: { so: 262, tong: -4077 }, choBanAm: true }), KY)
    const mBanAm = lay(banAm, 'ton-am')
    ok('cửa hàng cho bán âm → KHÔNG phải mức nặng', mBanAm.muc === 'vua', mBanAm.muc)
    ok('… nói rõ KHÔNG phải lỗi dữ liệu', /KHÔNG phải lỗi dữ liệu/.test(mBanAm.anhHuong), mBanAm.anhHuong)
    ok('… và KHÔNG gọi là lệch sổ sách', !/lệch sổ sách/.test(mBanAm.anhHuong), mBanAm.anhHuong)
    ok('… việc cần làm đổi thành nhập bù', /nhập bù/i.test(mBanAm.canLam), mBanAm.canLam)

    console.log('\n▶ Hoá đơn hỏng — tách riêng nhóm trùng khoá\n')

    const hd = await sucKhoeDuLieu(fake({
        ...SACH,
        hoaDonHong: [
            ...Array.from({ length: 40 }, () => ({ totalAmount: 100_000, errorMessage: 'Fkey đã được sử dụng trên hệ thống' })),
            ...Array.from({ length: 5 }, () => ({ totalAmount: 200_000, errorMessage: 'Read timed out' })),
        ],
    }), KY)
    const mHd = lay(hd, 'hoa-don-hong')
    ok('45 tờ hỏng → mức NẶNG', mHd.muc === 'nang', mHd.muc)
    ok('… tách riêng 40 tờ thật ra đã phát hành xong', /40 tờ thật ra ĐÃ phát hành xong/.test(mHd.so || ''), mHd.so)
    ok('… và CẤM xuất lại nhóm trùng khoá', /ĐỪNG xuất lại/.test(mHd.canLam), mHd.canLam)
    ok('… nói rõ tỷ lệ phủ hoá đơn đang bị báo thấp hơn thực tế',
        /THẤP HƠN thực tế/.test(mHd.anhHuong), mHd.anhHuong)

    /* Menu "Hóa Đơn VAT" có cờ companyOnly — hộ kinh doanh KHÔNG vào được, trong
     * khi từ 2026 họ vẫn phải dùng hoá đơn điện tử và vẫn nhận cảnh báo này.
     * Nguyên nhân phải hiện NGAY tại đây, nếu không cảnh báo đi nửa đường. */
    ok('kèm nguyên nhân ngay tại chỗ (hộ kinh doanh không vào được trang hoá đơn)',
        (mHd.viDu?.length ?? 0) === 2, mHd.viDu)
    ok('… gom theo nguyên nhân kèm số tờ',
        /40 tờ/.test(mHd.viDu?.[0]?.phu || ''), mHd.viDu?.[0])
    ok('… nhóm nhiều tờ nhất xếp trước',
        /Fkey/.test(mHd.viDu?.[0]?.nhan || ''), mHd.viDu?.[0]?.nhan)

    const khongHong = await sucKhoeDuLieu(fake({ ...SACH, hoaDonHong: [] }), KY)
    ok('không có tờ hỏng → không kèm danh sách thừa',
        (lay(khongHong, 'hoa-don-hong').viDu?.length ?? 0) === 0)

    console.log('\n▶ Chi phí ghi sổ quá mỏng\n')

    const cp = await sucKhoeDuLieu(fake({ ...SACH, doanhThu: 1_000_000_000, chiPhi: 4_000_000 }), KY)
    const mCp = lay(cp, 'chi-phi-ghi-so')
    ok('chi 0,4% doanh thu → mức NẶNG', mCp.muc === 'nang', mCp.muc)
    ok('… nói rõ LÃI đang bị báo cao hơn thực tế', /CAO HƠN thực tế/.test(mCp.anhHuong), mCp.anhHuong)

    const cpOk = await sucKhoeDuLieu(fake({ ...SACH, doanhThu: 1_000_000_000, chiPhi: 200_000_000 }), KY)
    ok('chi 20% doanh thu → ổn, không làm phiền', lay(cpOk, 'chi-phi-ghi-so').muc === 'on')

    console.log('\n▶ Phiếu nhập trùng số hoá đơn\n')

    /* Ca thật 14/08/2026: một cửa hàng có 4 cặp trùng, 138,7 triệu ghi hai lần —
     * ba cặp là nhập lại đúng những phiếu đã nhập tuần trước. */
    const nhapTrung = await sucKhoeDuLieu(fake({
        ...SACH,
        phieuNhap: [
            { code: 'NH-001', vatInvoiceNo: '00002586', supplierId: 'ncc1', supplierName: 'Hưng Tín', totalCost: 25_480_759 },
            { code: 'NH-002', vatInvoiceNo: '00002586', supplierId: 'ncc1', supplierName: 'Hưng Tín', totalCost: 25_480_759 },
            { code: 'NH-003', vatInvoiceNo: '00002596', supplierId: 'ncc1', supplierName: 'Hưng Tín', totalCost: 28_770_898 },
            { code: 'NH-004', vatInvoiceNo: '00002596', supplierId: 'ncc1', supplierName: 'Hưng Tín', totalCost: 28_770_898 },
        ],
    }), KY)
    const mNhap = lay(nhapTrung, 'phieu-nhap-trung')
    ok('2 cặp trùng → mức NẶNG', mNhap.muc === 'nang', mNhap.muc)
    ok('… đếm đúng số cặp, không đếm số phiếu', /2 cặp/.test(mNhap.so || ''), mNhap.so)
    ok('… tiền thừa chỉ tính phiếu SAU, không cộng cả nhóm',
        /54\.251\.657/.test(mNhap.so || ''), mNhap.so)
    ok('… chỉ rõ giữ phiếu đầu, huỷ phiếu sau', /giữ phiếu ĐẦU TIÊN/.test(mNhap.canLam), mNhap.canLam)
    ok('… nói rõ huỷ sẽ tự trừ lại tồn kho', /trừ lại tồn kho/.test(mNhap.canLam))

    /* Trùng số ở HAI nhà cung cấp khác nhau là bình thường — mỗi bên một dải số. */
    const khacNcc = await sucKhoeDuLieu(fake({
        ...SACH,
        phieuNhap: [
            { code: 'NH-001', vatInvoiceNo: '000123', supplierId: 'ncc1', supplierName: 'A', totalCost: 1_000_000 },
            { code: 'NH-002', vatInvoiceNo: '000123', supplierId: 'ncc2', supplierName: 'B', totalCost: 2_000_000 },
        ],
    }), KY)
    ok('cùng số nhưng khác nhà cung cấp → KHÔNG báo trùng',
        lay(khacNcc, 'phieu-nhap-trung').muc === 'on', lay(khacNcc, 'phieu-nhap-trung').so)

    console.log('\n▶ Số dư ngân hàng\n')

    const kSoDu = await sucKhoeDuLieu(fake({ ...SACH, taiKhoan: [{ balance: 0 }] }), KY)
    const mSd = lay(kSoDu, 'so-du-ngan-hang')
    ok('có tài khoản nhưng số dư 0 → nhắc', mSd.muc === 'vua', mSd.muc)
    ok('… nói rõ lịch tiền không trả lời được "khi nào hết tiền"',
        /khi nào hết tiền/.test(mSd.anhHuong), mSd.anhHuong)

    console.log('\n▶ Đọc hỏng bảng — ghi nhận, KHÔNG dựng cảnh báo từ số rỗng\n')

    const hongTon = await sucKhoeDuLieu(fake(SACH, { product: true }), KY)
    ok('đọc hỏng bảng hàng hoá → không sập', !!hongTon.muc)
    ok('… ghi vào mục thiếu', hongTon.thieu.some((t: string) => /tonAm/.test(t)), hongTon.thieu)
    ok('… và KHÔNG dựng mục tồn âm từ số rỗng',
        !hongTon.muc.some((m: any) => m.ma === 'ton-am'), hongTon.muc.map((m: any) => m.ma))

    console.log('\n▶ Xếp hạng — việc nặng phải nằm trên\n')

    const nhieu = await sucKhoeDuLieu(fake({
        soNgayCoBan: 10, tonAm: { so: 300, tong: -5000 },
        hoaDonHong: [], doanhThu: 1_000_000_000, chiPhi: 300_000_000,
        taiKhoan: [{ balance: 10_000_000 }],
    }), KY)
    ok('mục NẶNG xếp trước mục ổn', nhieu.muc[0].muc === 'nang', nhieu.muc.map((m: any) => m.muc))
    ok('điểm tụt theo số vấn đề', nhieu.diem < 60, nhieu.diem)
    ok('xếp loại "chưa tin được"', nhieu.xepLoai === 'chưa tin được', nhieu.xepLoai)

    console.log(`\n${dat}/${dat + hong} ca đạt`)
    if (hong) process.exit(1)
}

main().catch(e => { console.error(e); process.exit(1) })
