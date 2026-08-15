/**
 * Kiểm GOM SỨC KHOẺ NHIỀU CỬA HÀNG — npx tsx scripts/check-tong-hop-suc-khoe.ts
 *
 * Thẻ "Sức khoẻ" và thanh tình trạng trên đầu trang admin đều đọc từ đây. Hai
 * chỗ sai im lặng nhất của một màn hình giám sát:
 *   - XẾP SAI → cửa hàng đang cháy nằm ở dòng thứ bảy; người quản trị nhìn ba
 *     dòng đầu thấy xanh rồi đóng tab.
 *   - ĐẾM SAI → thẻ ghi "0 cần lo" trong khi có. Trấn an sai.
 *
 * Ca quan trọng nhất là ca 4: cửa hàng SOÁT HỎNG phải bị tính là cần lo. Viết
 * nhầm thành `filter(c => c.soNang > 0)` là một cửa hàng chết hẳn (soát hỏng
 * nên không có soNang) lại được đếm là bình thường — đúng thứ nguy hiểm nhất.
 */

import { xepCuaHang, tomTatSucKhoe, type HangSucKhoe } from '../src/lib/tongHopSucKhoe'

let dat = 0, hong = 0
function ok(ten: string, dk: boolean, thucTe?: any) {
    if (dk) { dat++; console.log(`  ✓ ${ten}`) }
    else { hong++; console.log(`  ✗ ${ten}${thucTe !== undefined ? ` — ${JSON.stringify(thucTe)}` : ''}`) }
}

const ch = (code: string, o: Partial<HangSucKhoe> = {}): HangSucKhoe =>
    ({ code, name: code, soNang: 0, soVua: 0, diem: 81, ...o })

function main() {
    console.log('\n▶ Gom sức khoẻ nhiều cửa hàng\n')

    /* 1 — SOÁT HỎNG LÊN ĐẦU. Chỗ mù nguy hiểm hơn chỗ đã biết: cửa hàng có 4
     * lỗi nặng thì ta còn biết nó hỏng gì, cửa hàng soát hỏng thì không biết
     * gì cả và rất có thể đang tệ hơn. */
    const xep1 = xepCuaHang([
        ch('TOT', { diem: 95 }),
        ch('NANG', { soNang: 4, diem: 22 }),
        ch('HONG', { loi: 'connection refused', diem: undefined }),
    ])
    ok('1. cửa hàng soát hỏng nằm TRÊN CÙNG', xep1[0]?.code === 'HONG', xep1.map(x => x.code))
    ok('1b. rồi mới tới cửa hàng nhiều lỗi nặng', xep1[1]?.code === 'NANG', xep1.map(x => x.code))
    ok('1c. cửa hàng tốt xuống cuối', xep1[2]?.code === 'TOT', xep1.map(x => x.code))

    // 2 — cùng số lỗi nặng thì điểm thấp lên trước
    const xep2 = xepCuaHang([
        ch('A', { soNang: 2, diem: 60 }),
        ch('B', { soNang: 2, diem: 30 }),
    ])
    ok('2. cùng số nặng → điểm thấp lên trước', xep2[0]?.code === 'B', xep2.map(x => x.code))

    /* 3 — DÒNG KHÔNG CÓ ĐIỂM KHÔNG ĐƯỢC NHỜ ĐIỂM RỖNG MÀ TRỒI LÊN.
     * `diem ?? 999` chính là để chặn việc này: nếu viết `diem ?? 0` thì cửa
     * hàng soát hỏng (không điểm) sẽ chen lên trước cửa hàng có điểm thật ở
     * NHÁNH ĐIỂM, làm thứ tự lộn xộn khó hiểu. */
    const xep3 = xepCuaHang([
        ch('CO_DIEM', { soNang: 0, diem: 40 }),
        ch('KHONG_DIEM', { soNang: 0, diem: undefined }),
    ])
    ok('3. dòng không có điểm xuống sau dòng có điểm', xep3[0]?.code === 'CO_DIEM', xep3.map(x => x.code))

    /* 4 — CA QUAN TRỌNG NHẤT: soát hỏng PHẢI tính là cần lo. */
    const t4 = tomTatSucKhoe([
        ch('OK1'), ch('OK2'),
        ch('HONG', { loi: 'timeout' }),
    ])
    ok('4. cửa hàng soát hỏng được tính là CẦN LO', t4.soCanLo === 1, t4)
    ok('4b. và được đếm riêng ở soDocHong', t4.soDocHong === 1, t4)
    ok('4c. tổng cửa hàng đúng', t4.soCuaHang === 3, t4)

    // 5 — không đếm trùng: một cửa hàng vừa hỏng vừa có nặng chỉ tính MỘT lần
    const t5 = tomTatSucKhoe([ch('X', { loi: 'timeout', soNang: 3 })])
    ok('5. không đếm trùng cửa hàng vừa hỏng vừa nặng', t5.soCanLo === 1, t5)

    // 6 — CHIỀU IM: mọi thứ ổn thì phải ra 0, đừng bịa
    const t6 = tomTatSucKhoe([ch('A'), ch('B'), ch('C', { soVua: 2 })])
    ok('6. chỉ có mức "vừa" → KHÔNG tính là cần lo', t6.soCanLo === 0, t6)
    ok('6b. không có cửa hàng nào đọc hỏng', t6.soDocHong === 0, t6)

    // 7 — danh sách rỗng không được ném lỗi
    const t7 = tomTatSucKhoe([])
    ok('7. danh sách rỗng → 0/0/0', t7.soCuaHang === 0 && t7.soCanLo === 0 && t7.soDocHong === 0, t7)
    ok('7b. xếp danh sách rỗng không nổ', xepCuaHang([]).length === 0)

    // 8 — không được sửa mảng gốc (route còn dùng lại để dựng phần khác)
    const goc = [ch('A', { soNang: 1 }), ch('B', { soNang: 5 })]
    const truoc = goc.map(x => x.code).join(',')
    xepCuaHang(goc)
    ok('8. xếp không làm xáo mảng gốc', goc.map(x => x.code).join(',') === truoc, goc.map(x => x.code))

    console.log(`\n${dat}/${dat + hong} ca đạt`)
    if (hong) process.exit(1)
}

main()
