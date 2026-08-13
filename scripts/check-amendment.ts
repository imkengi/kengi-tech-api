/**
 * Kiểm chứng BẢN GIẢI TRÌNH KHAI BỔ SUNG + TIỀN CHẬM NỘP.
 *
 * Chạy:  npx tsx scripts/check-amendment.ts
 *
 * Đây là chỗ ra con số người dùng mang đi NỘP TIỀN THẬT. Tính thiếu thì vài
 * tháng sau bị truy, tính thừa thì họ nộp oan. Nên kiểm rất kỹ phần số ngày
 * chậm: mốc bắt đầu là ngày kế tiếp hạn nộp kỳ gốc, và nộp trong hạn thì phải
 * bằng 0 chứ không được ra số âm.
 */

import {
    giaiTrinhKhaiBoSung, hanNopKy, TY_LE_CHAM_NOP_NGAY, TEN_CHI_TIEU,
} from '../src/lib/amendmentExplain'

let dat = 0, hong = 0
function ok(ten: string, dk: boolean, thucTe?: any) {
    if (dk) { dat++; console.log(`  ✓ ${ten}`) }
    else { hong++; console.log(`  ✗ ${ten}${thucTe !== undefined ? ` — thực tế: ${JSON.stringify(thucTe)}` : ''}`) }
}

const CU = { ct29: 100_000_000, ct30: 10_000_000, ct33: 6_000_000, ct40a: 4_000_000 }
const MOI = { ct29: 150_000_000, ct30: 15_000_000, ct33: 6_000_000, ct40a: 9_000_000 }

const TT = {
    kyGoc: '2026-07', lanBoSung: 1,
    lyDo: 'Bỏ sót 5 hóa đơn bán ra của ngày 30/07/2026',
    tenDonVi: 'Hộ kinh doanh Kengi', maSoThue: '0101234567',
    ngayNop: '2026-10-20',
}

async function main() {
    console.log('\n═══ BẢN GIẢI TRÌNH KHAI BỔ SUNG ═══\n')

    console.log('▸ Hạn nộp kỳ gốc')
    ok('tháng 7 → 20/08', hanNopKy('2026-07') === '2026-08-20', hanNopKy('2026-07'))
    ok('tháng 12 → 20/01 năm sau', hanNopKy('2026-12') === '2027-01-20', hanNopKy('2026-12'))
    ok('quý 3 → 31/10', hanNopKy('2026-Q3') === '2026-10-31', hanNopKy('2026-Q3'))
    ok('quý 4 → 31/01 năm sau', hanNopKy('2026-Q4') === '2027-01-31', hanNopKy('2026-Q4'))
    ok('năm → 31/03 năm sau', hanNopKy('2026') === '2027-03-31', hanNopKy('2026'))

    console.log('\n▸ Chênh lệch chỉ tiêu')
    const g = giaiTrinhKhaiBoSung(CU, MOI, TT)
    ok('chỉ liệt kê chỉ tiêu có thay đổi', g.dong.length === 3, g.dong.map(d => d.chiTieu))
    ok('không liệt kê chỉ tiêu giữ nguyên', !g.dong.some(d => d.chiTieu === 'ct33'))
    ok('mỗi dòng có tên chỉ tiêu đọc được, không phải mã ct',
        g.dong.every(d => d.ten.length > 10 && d.ten.includes('[')))
    ok('tính đúng chênh lệch', g.dong.find(d => d.chiTieu === 'ct29')!.chenh === 50_000_000)
    ok('đánh dấu hướng tăng/giảm', g.dong.every(d => d.huong === (d.chenh > 0 ? 'tang' : 'giam')))
    ok('chênh thuế phải nộp lấy từ [40a]', g.chenhThuePhaiNop === 5_000_000, g.chenhThuePhaiNop)

    console.log('\n▸ Tiền chậm nộp')
    const c = g.chamNop!
    ok('có tính tiền chậm nộp khi thuế tăng', !!c)
    ok('mốc bắt đầu là hạn nộp kỳ gốc 20/08/2026', c.hanNopGoc === '2026-08-20', c.hanNopGoc)
    ok('đếm đúng 61 ngày (20/08 → 20/10)', c.soNgayCham === 61, c.soNgayCham)
    ok('tỷ lệ 0,03%/ngày', c.tyLeNgay === 0.0003 && TY_LE_CHAM_NOP_NGAY === 0.0003)
    ok('tiền chậm nộp = 5tr × 0,03% × 61 = 91.500đ', c.tienChamNop === 91_500, c.tienChamNop)
    ok('tổng phải nộp = thuế + chậm nộp', c.tongPhaiNop === 5_091_500, c.tongPhaiNop)
    ok('dẫn Điều 59 Luật QLT', c.canCu.includes('Điều 59'))
    ok('nhắc người nộp thuế TỰ tính tự nộp', /TỰ tính và TỰ nộp/.test(c.ghiChu))

    console.log('\n▸ Nộp trong hạn thì không có ngày chậm')
    const trongHan = giaiTrinhKhaiBoSung(CU, MOI, { ...TT, ngayNop: '2026-08-15' })
    ok('số ngày chậm = 0', trongHan.chamNop!.soNgayCham === 0, trongHan.chamNop!.soNgayCham)
    ok('không ra số ngày âm', trongHan.chamNop!.soNgayCham >= 0)
    ok('tiền chậm nộp = 0', trongHan.chamNop!.tienChamNop === 0)
    ok('ghi chú nói rõ nộp trong hạn', /trong hạn/.test(trongHan.chamNop!.ghiChu))
    const dungHan = giaiTrinhKhaiBoSung(CU, MOI, { ...TT, ngayNop: '2026-08-20' })
    ok('nộp đúng ngày cuối hạn vẫn là 0 ngày chậm', dungHan.chamNop!.soNgayCham === 0)

    console.log('\n▸ Khai bổ sung làm giảm thuế')
    const giam = giaiTrinhKhaiBoSung(MOI, CU, TT)
    ok('chênh thuế âm', giam.chenhThuePhaiNop === -5_000_000, giam.chenhThuePhaiNop)
    ok('không tính tiền chậm nộp', giam.chamNop === null)
    ok('nhắc nộp thừa không tự động trả lại',
        giam.canhBao.some(c => c.includes('bù trừ') && c.includes('Điều 60')), giam.canhBao)
    ok('hướng dẫn nộp không có bước lập giấy nộp tiền thuế',
        !giam.huongDanNop.some(h => h.includes('tiểu mục 1701')), giam.huongDanNop)

    console.log('\n▸ Cảnh báo theo tình huống')
    ok('chưa có quyết định thanh tra → nhắc lợi ích tự giác',
        g.canhBao.some(c => c.includes('không bị phạt 20%')), g.canhBao)
    const daThanhTra = giaiTrinhKhaiBoSung(CU, MOI, { ...TT, daCoQuyetDinhThanhTra: true })
    ok('đã có quyết định thanh tra → nói thẳng vẫn bị phạt 20%',
        daThanhTra.canhBao.some(c => c.includes('vẫn bị phạt 20%')), daThanhTra.canhBao)
    ok('không còn nói là được miễn phạt',
        !daThanhTra.canhBao.some(c => c.includes('không bị phạt 20%')))
    ok('nhắc đừng quên nộp riêng tiền chậm nộp',
        g.canhBao.some(c => c.includes('tiền chậm nộp')), g.canhBao)

    console.log('\n▸ Không có gì thay đổi')
    const khongDoi = giaiTrinhKhaiBoSung(CU, CU, TT)
    ok('không có dòng nào', khongDoi.dong.length === 0)
    ok('cảnh báo tờ khai y hệt bản gốc sẽ bị từ chối',
        khongDoi.canhBao.some(c => c.includes('y hệt bản gốc')), khongDoi.canhBao)
    ok('không tính tiền chậm nộp', khongDoi.chamNop === null)

    console.log('\n▸ Văn bản in ra')
    ok('đúng mẫu 01-1/KHBS', g.vanBan.includes('Mẫu 01-1/KHBS'))
    ok('dẫn Thông tư 80/2021', g.vanBan.includes('80/2021'))
    ok('có quốc hiệu', g.vanBan.includes('CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM'))
    ok('điền sẵn tên đơn vị và MST', g.vanBan.includes('Hộ kinh doanh Kengi') && g.vanBan.includes('0101234567'))
    ok('nêu kỳ và lần bổ sung', g.vanBan.includes('2026-07') && g.vanBan.includes('lần thứ 1'))
    ok('ghi lý do khai bổ sung', g.vanBan.includes('Bỏ sót 5 hóa đơn'))
    ok('có bảng chỉ tiêu thay đổi kèm số cũ → số mới',
        g.vanBan.includes('100.000.000 → 150.000.000'))
    ok('nêu công thức tiền chậm nộp bằng lời',
        g.vanBan.includes('0,03%/ngày × 61 ngày'), g.vanBan.split('\n').find(d => d.includes('0,03%')))
    ok('có dòng cam kết chịu trách nhiệm', g.vanBan.includes('chịu trách nhiệm trước pháp luật'))
    ok('có chỗ ký', g.vanBan.includes('Ký, ghi rõ họ tên'))
    ok('ngày tháng lấy theo ngày nộp', g.vanBan.includes('ngày 20 tháng 10 năm 2026'))
    const khuyet = giaiTrinhKhaiBoSung(CU, MOI, { ...TT, tenDonVi: undefined, maSoThue: undefined })
    ok('thiếu tên đơn vị thì để chỗ trống điền tay, không in "undefined"',
        !khuyet.vanBan.includes('undefined') && khuyet.vanBan.includes('.....'), khuyet.vanBan.slice(0, 200))

    console.log('\n▸ Hướng dẫn nộp tiền')
    ok('chỉ đúng tiểu mục thuế GTGT 1701', g.huongDanNop.some(h => h.includes('1701')))
    ok('chỉ đúng tiểu mục tiền chậm nộp 4931', g.huongDanNop.some(h => h.includes('4931')))
    ok('nhắc lưu thông báo tiếp nhận làm bằng chứng tự giác',
        g.huongDanNop.some(h => h.includes('Thông báo tiếp nhận')))

    console.log('\n▸ Danh mục chỉ tiêu')
    ok('có đủ các chỉ tiêu chính của 01/GTGT',
        ['ct29', 'ct30', 'ct33', 'ct40a', 'ct40b'].every(m => !!TEN_CHI_TIEU[m]))
    ok('mọi tên chỉ tiêu đều có số hiệu trong ngoặc vuông',
        Object.values(TEN_CHI_TIEU).every(t => /^\[\w+\]/.test(t)))

    console.log(`\n${dat}/${dat + hong} ca đạt`)
    if (hong) process.exit(1)
}

main().catch(e => { console.error(e); process.exit(1) })
