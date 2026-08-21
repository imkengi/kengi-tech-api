/**
 * Kiểm GỢI Ý NỐI LISTING SÀN ↔ HÀNG KHO — npx tsx scripts/check-goi-y-lien-ket.ts
 *
 * Bộ gợi ý này chạm vào chỗ nhạy: nối sai là doanh thu và trừ kho chạy vào NHẦM
 * MẶT HÀNG — sai âm thầm và khó lần hơn hẳn việc chưa nối. Nên phép thử phải
 * nặng về chiều "không được gợi bừa", không chỉ chiều "gợi được".
 *
 * Ca nguy hiểm nhất là ca 5: hai mặt hàng chỉ khác nhau một con số (chảo 20cm
 * và 24cm). Gợi ý bừa một cái là hỏng sổ, nên bắt buộc phải hạ tin cậy.
 *
 * Tên mẫu lấy từ listing thật của KENGISTORE.
 */

import { chuanHoaTen, tachTu, goiYLienKet, laMaMay } from '../src/lib/goiYLienKet'

let dat = 0, hong = 0
function ok(ten: string, dk: boolean, thucTe?: any) {
    if (dk) { dat++; console.log(`  ✓ ${ten}`) }
    else { hong++; console.log(`  ✗ ${ten}${thucTe !== undefined ? ` — ${JSON.stringify(thucTe)}` : ''}`) }
}

const L = (id: string, name: string, sku: string | null = null) => ({ id, name, sku })
const P = (id: string, name: string, sku: string | null = null) => ({ id, name, sku })

function main() {
    console.log('\n▶ Gợi ý nối listing sàn ↔ hàng kho\n')

    // 1 — chuẩn hoá: bỏ dấu, bỏ ngoặc tiếp thị
    ok('1. bỏ dấu tiếng Việt', chuanHoaTen('Nồi Cơm Điện') === 'noi com dien', chuanHoaTen('Nồi Cơm Điện'))
    ok('1b. bỏ ngoặc tiếp thị',
        chuanHoaTen('[Sunhouse Chính Hãng] Nồi Cơm 1.8L') === 'noi com 1 8l',
        chuanHoaTen('[Sunhouse Chính Hãng] Nồi Cơm 1.8L'))
    ok('1c. chữ đ thành d', chuanHoaTen('Đá Đáy Từ') === 'da day tu', chuanHoaTen('Đá Đáy Từ'))

    // 2 — bỏ từ tiếp thị, nếu không listing nào cũng giống listing nào
    ok('2. loại từ tiếp thị', !tachTu('[Hàng Chính Hãng] Chảo Sunhouse').includes('hang'),
        tachTu('[Hàng Chính Hãng] Chảo Sunhouse'))

    // 3 — ca thường: tên kho nằm trọn trong tên listing
    const g3 = goiYLienKet(
        [L('l1', '[Sunhouse Chính Hãng] Nồi Cơm Điện Nắp Rời 1.8L Bảo Hành 12 Tháng')],
        [P('p1', 'Nồi cơm điện nắp rời 1.8L', 'NCD18'), P('p2', 'Ấm siêu tốc 1.7L', 'AST17')],
    )
    ok('3. gợi đúng mặt hàng', g3[0]?.productId === 'p1', g3[0])
    ok('3b. tin cậy CAO khi khớp trọn và bỏ xa mã khác', g3[0]?.mucTinCay === 'cao', g3[0]?.mucTinCay)

    // 4 — không có mã nào giống thì ĐỪNG gợi
    const g4 = goiYLienKet(
        [L('l1', '[Chính Hãng] Máy Xay Sinh Tố Đa Năng')],
        [P('p1', 'Nồi cơm điện nắp rời 1.8L'), P('p2', 'Ấm siêu tốc 1.7L')],
    )
    ok('4. không mã nào giống → im, không gợi bừa', g4.length === 0, g4)

    /* 5 — CA NGUY HIỂM NHẤT: hai mặt hàng chỉ khác một con số.
     * Chảo 20cm và 24cm — gợi bừa một cái là doanh thu vào nhầm mã. */
    const g5 = goiYLienKet(
        [L('l1', '[Hàng Chính Hãng] Chảo Chống Dính Sunhouse Đáy Từ')],
        [P('p1', 'Chảo chống dính Sunhouse đáy từ 20cm'), P('p2', 'Chảo chống dính Sunhouse đáy từ 24cm')],
    )
    ok('5. hai mã sát nhau → KHÔNG được để tin cậy cao',
        g5.length === 0 || g5[0]?.mucTinCay !== 'cao', g5[0])

    // 6 — listing không có chữ nghĩa gì thì bỏ qua, đừng nổ
    const g6 = goiYLienKet([L('l1', '[]'), L('l2', '')], [P('p1', 'Nồi cơm điện')])
    ok('6. listing rỗng → bỏ qua, không nổ', g6.length === 0, g6)

    // 7 — kho rỗng cũng không được nổ
    ok('7. kho rỗng → không gợi gì', goiYLienKet([L('l1', 'Nồi cơm điện 1.8L')], []).length === 0)

    // 8 — xếp mã điểm cao lên trước để người dùng duyệt từ chắc chắn nhất
    const g8 = goiYLienKet(
        [L('l1', 'Chảo chống dính Sunhouse đáy từ 20cm chính hãng'),
         L('l2', '[Sunhouse] Nồi Cơm Điện Nắp Rời Cao Cấp')],
        [P('p1', 'Chảo chống dính Sunhouse đáy từ 20cm'), P('p2', 'Nồi cơm điện nắp rời 1.8L')],
    )
    ok('8. xếp điểm cao lên trước', (g8[0]?.diem ?? 0) >= (g8[1]?.diem ?? 0), g8.map(x => x.diem))

    /* 9 — CHIỀU IM QUAN TRỌNG: chỉ trùng một từ chung chung thì KHÔNG gợi.
     * "Sunhouse" có trong mọi listing của shop này. */
    const g9 = goiYLienKet(
        [L('l1', '[Sunhouse Chính Hãng] Máy Lọc Không Khí')],
        [P('p1', 'Chảo chống dính Sunhouse đáy từ 20cm')],
    )
    ok('9. chỉ trùng tên hãng → không gợi', g9.length === 0, g9[0])

    /* 10 — TÊN KHO CÒN QUÁ ÍT TỪ CÓ NGHĨA thì không được làm bằng chứng.
     * Dính thật 16/08: "Phí bảo hành" rút gọn còn đúng một từ `phi` (bao/hanh
     * nằm trong TU_RAC), nên mọi listing có "Miễn Phí Vận Chuyển" đều khớp
     * 1/1 = điểm tuyệt đối, và còn được gắn "tin cậy cao". */
    const g10 = goiYLienKet(
        [L('l1', '[Sunhouse Chính Hãng] Nồi Cơm Điện 1.8L Sunhouse SHD8611 - Bảo Hành 12 Tháng Toàn Quốc - Miễn Phí Vận Chuyển', 'SHD8611N')],
        [P('p1', 'Phí bảo hành', 'PBH')],
    )
    ok('10. tên kho còn 1 từ chung chung → KHÔNG gợi', g10.length === 0, g10[0])

    // 10b — CHIỀU IM: tên kho ngắn nhưng đủ 2 từ có nghĩa thì vẫn phải gợi được
    const g10b = goiYLienKet(
        [L('l1', '[Chính Hãng] Nồi Cơm Điện Sunhouse Cao Cấp')],
        [P('p1', 'Nồi cơm', 'NC')],
    )
    ok('10b. tên kho 2 từ có nghĩa → vẫn gợi bình thường', g10b.length === 1, g10b)

    /* 11 — MÃ MÁY KHÁC NHAU = KHÔNG PHẢI CÙNG MẶT HÀNG.
     * Ca thật đang chặn 1.026 đơn ≈ 710 triệu ở KENGISTORE: listing SHD8611
     * được gợi nối vào hàng kho SHD8638 với 0,83 điểm vì 5/6 từ khớp. */
    const g11 = goiYLienKet(
        [L('l1', '[Sunhouse Chính Hãng] Nồi Cơm Điện 1.8L Sunhouse SHD8611 - Bảo Hành Chính Hãng 12 Tháng Toàn Quốc')],
        [P('p1', 'Nồi cơm điện 1.8L Sunhouse SHD8638', 'SHD8638')],
    )
    ok('11. mã máy lệch (SHD8611 ↔ SHD8638) → KHÔNG gợi', g11.length === 0, g11[0])

    // 11b — CHIỀU IM: đúng mã thì phải gợi, và phải tin cậy cao
    const g11b = goiYLienKet(
        [L('l1', '[Sunhouse Chính Hãng] Nồi Cơm Điện 1.8L Sunhouse SHD8611 - Bảo Hành 12 Tháng')],
        [P('p1', 'Nồi cơm điện 1.8L Sunhouse SHD8611', 'SHD8611'),
         P('p2', 'Ấm siêu tốc 1.7L', 'AST17')],
    )
    ok('11b. đúng mã máy → vẫn gợi', g11b[0]?.productId === 'p1', g11b[0])

    /* 11c — CHIỀU IM: listing KHÔNG ghi mã mà kho có mã thì đừng loại.
     * Bỏ qua vì thiếu thông tin là gợi hụt; loại thẳng mới là làm hỏng. */
    const g11c = goiYLienKet(
        [L('l1', '[Hàng Chính Hãng] Chảo Chống Dính Sunhouse Đáy Từ Vân Đá')],
        [P('p1', 'Chảo chống dính Sunhouse đáy từ vân đá 20cm', 'CS20')],
    )
    ok('11c. listing không ghi mã → vẫn gợi (thiếu tin ≠ mâu thuẫn)', g11c.length === 1, g11c)

    // 11d — hai mã máy khác nhau trong cùng danh sách: chỉ cái khớp mới được gợi
    const g11d = goiYLienKet(
        [L('l1', 'Chảo Chống Dính Sunhouse CT16PLUS Vân Đá')],
        [P('p1', 'Chảo chống dính Sunhouse CT20PLUS vân đá', 'CT20PLUS'),
         P('p2', 'Chảo chống dính Sunhouse CT16PLUS vân đá', 'CT16PLUS')],
    )
    ok('11d. chọn đúng mã trong nhiều mã cùng dòng', g11d[0]?.productId === 'p2', g11d[0])

    /* 13 — "TIN CẬY CAO" PHẢI CÓ BẰNG CHỨNG CỨNG.
     * Ba ca thật lấy từ KENGISTORE 16/08, đều 1,0 điểm và đều từng được gắn
     * "cao": tên kho hai từ chung chung khớp trúng lời quảng cáo của listing. */
    const g13 = goiYLienKet(
        [L('l1', '[Hàng Chính Hãng] Quạt Hộp 5 Cánh Senko BD230 - Bảo Hành Động Cơ 24 Tháng', 'BD230')],
        [P('p1', 'Quạt sàn Senko', 'S1850')],
    )
    ok('13. tên kho 2 từ chung chung → KHÔNG được "cao"', g13[0]?.mucTinCay !== 'cao', g13[0])

    const g13b = goiYLienKet(
        [L('l1', '[Hàng Chính Hãng] Mỏ Lết Đa Năng Deli EDL1200X - Tay Cầm Nhúng Nhựa Siêu Bền')],
        [P('p1', 'Tay cầm', 'BXDPK03')],
    )
    ok('13b. "Tay cầm" nuốt listing mỏ lết → KHÔNG được "cao"', g13b[0]?.mucTinCay !== 'cao', g13b[0])

    /* 13c — CHIỀU IM: tên kho NGẮN nhưng TRÙNG MÃ MÁY thì vẫn là bằng chứng
     * cứng, phải cho "cao" — nếu không thì siết quá tay, gợi ý đúng cũng bị hạ. */
    const g13c = goiYLienKet(
        [L('l1', '[Sunhouse] Bếp Hồng Ngoại Cảm Ứng Sunhouse SHD6005 - Bảo Hành 12 Tháng')],
        [P('p1', 'Bếp SHD6005', 'SHD6005'), P('p2', 'Ấm siêu tốc 1.7L', 'AST17')],
    )
    ok('13c. tên kho ngắn nhưng TRÙNG MÃ MÁY → vẫn "cao"', g13c[0]?.mucTinCay === 'cao', g13c[0])

    // 12 — nhận dạng mã máy: phải bắt chữ+số từ 4 ký tự, bỏ qua "8l" của "1.8L"
    ok('12. laMaMay nhận shd8611 / ct16plus / 20cm',
        laMaMay('shd8611') && laMaMay('ct16plus') && laMaMay('20cm'))
    ok('12b. laMaMay KHÔNG nhận "8l" (từ 1.8L) hay từ thuần chữ/số',
        !laMaMay('8l') && !laMaMay('sunhouse') && !laMaMay('1234'))

    console.log(`\n${dat}/${dat + hong} ca đạt`)
    if (hong) process.exit(1)
}

main()
