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

import { chuanHoaTen, tachTu, goiYLienKet } from '../src/lib/goiYLienKet'

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

    console.log(`\n${dat}/${dat + hong} ca đạt`)
    if (hong) process.exit(1)
}

main()
