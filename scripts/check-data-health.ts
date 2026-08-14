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
        },
        eInvoice: { findMany: async () => { no('eInvoice'); return k.hoaDonHong ?? [] } },
        transaction: { aggregate: async () => { no('transaction'); return { _sum: { total: k.doanhThu ?? 0 } } } },
        expense: { aggregate: async () => { no('expense'); return { _sum: { amount: k.chiPhi ?? 0 } } } },
        bankAccount: { findMany: async () => { no('bankAccount'); return k.taiKhoan ?? [] } },
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

    console.log('\n▶ Chi phí ghi sổ quá mỏng\n')

    const cp = await sucKhoeDuLieu(fake({ ...SACH, doanhThu: 1_000_000_000, chiPhi: 4_000_000 }), KY)
    const mCp = lay(cp, 'chi-phi-ghi-so')
    ok('chi 0,4% doanh thu → mức NẶNG', mCp.muc === 'nang', mCp.muc)
    ok('… nói rõ LÃI đang bị báo cao hơn thực tế', /CAO HƠN thực tế/.test(mCp.anhHuong), mCp.anhHuong)

    const cpOk = await sucKhoeDuLieu(fake({ ...SACH, doanhThu: 1_000_000_000, chiPhi: 200_000_000 }), KY)
    ok('chi 20% doanh thu → ổn, không làm phiền', lay(cpOk, 'chi-phi-ghi-so').muc === 'on')

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
