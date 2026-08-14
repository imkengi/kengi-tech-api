/**
 * Kiểm chứng TIỀN THUẾ ĐÃ NỘP — npx tsx scripts/check-tax-paid.ts
 *
 * Cỗ máy này cấp số cho cột "đã nộp" của sổ S4 và chỉ tiêu [13] "thuế đã tạm
 * nộp trong năm" của tờ quyết toán. Sai theo hai hướng đều hại và hại khác nhau:
 *
 *  - nói ĐÃ NỘP khi chưa → người dùng yên tâm, rồi bị tính tiền chậm nộp
 *    0,03%/ngày (Điều 59 Luật QLT 38/2019);
 *  - nói CHƯA NỘP khi đã → tờ khai in ra tự nhận còn nợ khoản đã trả.
 *
 * Nên mỗi phép đều có ca "phải đếm" VÀ ca "phải im".
 */

import {
    tienThueDaNop, cacCachVietKy, ghiChuNguonDaNop, dieuKienButToanNopThue,
} from '../src/lib/taxPaidLedger'

let dat = 0, hong = 0
function ok(ten: string, dk: boolean, thucTe?: any) {
    if (dk) { dat++; console.log(`  ✓ ${ten}`) }
    else { hong++; console.log(`  ✗ ${ten}${thucTe !== undefined ? ` — thực tế: ${JSON.stringify(thucTe)}` : ''}`) }
}

const KY = ['T01/2026', 'T02/2026', 'T03/2026']

function main() {
    console.log('▸ Không đọc được sổ ≠ chưa nộp đồng nào')
    ok('sổ không đọc được thì trả null, không trả 0', tienThueDaNop(null, KY) === null)
    ok('câu giải thích nói rõ đây không phải kết luận chưa nộp',
        ghiChuNguonDaNop(null).includes('KHÔNG phải kết luận'))

    const rong = tienThueDaNop([], KY)!
    ok('sổ đọc được nhưng trống thì tổng bằng 0', rong.tongNam === 0 && rong.soChungTu === 0)
    ok('sổ trống thì mách cách ghi bút toán nộp thuế',
        ghiChuNguonDaNop(rong).includes('Nợ 333x'))

    console.log('\n▸ Gán tiền nộp về đúng kỳ')
    {
        const kq = tienThueDaNop([
            { amount: 1_500_000, description: 'Nộp thuế GTGT kỳ T01/2026', reference: 'NT-1' },
            { amount: 2_000_000, description: 'Nộp thuế GTGT kỳ 02/2026', reference: 'NT-2' },
        ], KY)!
        ok('khớp kỳ viết dạng T01/2026', kq.theoKy.get('T01/2026') === 1_500_000, [...kq.theoKy])
        ok('khớp kỳ viết dạng 02/2026 dù tờ khai ghi T02/2026',
            kq.theoKy.get('T02/2026') === 2_000_000, [...kq.theoKy])
        ok('kỳ không có chứng từ thì không có số', kq.theoKy.get('T03/2026') === undefined)
        ok('tổng năm bằng tổng mọi chứng từ', kq.tongNam === 3_500_000)
        ok('không còn phần chưa gán', kq.chuaGanKy === 0)
    }
    {
        const kq = tienThueDaNop([
            { amount: 5_000_000, description: 'Nộp thuế', reference: 'UNC-99' },
        ], KY)!
        ok('chứng từ không ghi kỳ thì KHÔNG gán bừa cho kỳ nào', kq.theoKy.size === 0, [...kq.theoKy])
        ok('phần chưa gán vẫn được cộng vào tổng năm',
            kq.chuaGanKy === 5_000_000 && kq.tongNam === 5_000_000)
        ok('câu giải thích nêu rõ phần chưa gán kỳ',
            ghiChuNguonDaNop(kq).includes('chưa gán được về kỳ nào'))
    }
    {
        // Rải đều là bịa — phải không bao giờ xảy ra
        const kq = tienThueDaNop([{ amount: 6_000_000, description: 'Nop thue nam' }], KY)!
        ok('không rải đều tiền cho các kỳ',
            [...kq.theoKy.values()].every(v => v === 0) || kq.theoKy.size === 0, [...kq.theoKy])
    }

    console.log('\n▸ Không khớp nhầm')
    {
        const kq = tienThueDaNop([
            { amount: 1_000_000, description: 'Nộp thuế kỳ T01/2025' },   // NĂM KHÁC
        ], KY)!
        ok('kỳ khác năm không bị gán vào kỳ cùng tháng', kq.theoKy.size === 0, [...kq.theoKy])
    }
    ok('chuỗi quá ngắn bị loại để khỏi khớp bừa vào câu văn',
        cacCachVietKy('T1/26').every(k => k.length >= 6), cacCachVietKy('T1/26'))
    ok('kỳ dạng 2026-01 sinh đủ các cách viết',
        cacCachVietKy('2026-01').includes('01/2026'), cacCachVietKy('2026-01'))
    ok('kỳ dạng quý được nhận', cacCachVietKy('Q1/2026').includes('Q1/2026'))
    ok('kỳ rỗng không sinh khóa nào', cacCachVietKy('').length === 0)
    ok('tháng vô lý (13) không sinh khóa suy diễn',
        !cacCachVietKy('T13/2026').includes('13/2026'), cacCachVietKy('T13/2026'))

    console.log('\n▸ Điều kiện đọc sổ')
    {
        const dk: any = dieuKienButToanNopThue(2026)
        ok('chỉ lấy bút toán ghi Nợ nhóm 333', dk.debitAccount.startsWith === '333')
        ok('bên Có phải là tiền mặt hoặc ngân hàng, để loại cấn trừ 133 ↔ 3331',
            dk.OR.length === 2
            && dk.OR.some((o: any) => o.creditAccount.startsWith === '111')
            && dk.OR.some((o: any) => o.creditAccount.startsWith === '112'))
        ok('khóa đúng khoảng ngày của năm', dk.date.gte === '2026-01-01' && dk.date.lte === '2026-12-31')
    }

    console.log(`\n${dat}/${dat + hong} ca đạt`)
    if (hong) process.exit(1)
}

main()
