/**
 * Kiểm ĐỆM TUỲ CHỌN ĐỒNG BỘ KIOTVIET — npx tsx scripts/check-kiotviet-dem-tuychon.ts
 *
 * buildOptions chạy MỘT LẦN MỖI THÔNG BÁO WEBHOOK. Đo HUTI 15/08/2026: 161
 * webhook trong 6 giờ, đỉnh 114 trong một giờ — mà cửa hàng này chưa chọn nhóm
 * hàng mặc định nên mỗi lượt tốn 2 truy vấn pool CỬA HÀNG chỉ để dựng tuỳ chọn.
 * Pool cửa hàng chỉ có 5 (từng là 3), nên đó là phần lãng phí đáng bỏ.
 *
 * Test này ĐẾM TRUY VẤN THẬT chứ không tin lời hứa của mã.
 *
 * Chiều ngược quan trọng không kém: **không được đệm giá trị null**. Cửa hàng
 * mới tinh chưa có kho/nhóm/user nào sẽ tra ra null; đệm null lại là suốt 5
 * phút nó vẫn tưởng không có, dù người dùng vừa tạo xong — người dùng sẽ thấy
 * "tạo kho rồi mà đồng bộ vẫn báo thiếu kho" và không hiểu vì sao.
 */

import { buildOptions, boDemTuyChon } from '../src/services/kiotvietRunner'

let dat = 0, hong = 0
function ok(ten: string, dk: boolean, thucTe?: any) {
    if (dk) { dat++; console.log(`  ✓ ${ten}`) }
    else { hong++; console.log(`  ✗ ${ten}${thucTe !== undefined ? ` — ${JSON.stringify(thucTe)}` : ''}`) }
}

/** Prisma giả có ĐẾM: mỗi bảng đếm riêng số lần bị hỏi. */
function taoSp(co: { kho?: boolean; nhom?: boolean; user?: boolean } = {}) {
    const dem = { warehouse: 0, category: 0, user: 0 }
    const sp: any = {
        _dem: dem,
        warehouse: { findFirst: async () => { dem.warehouse++; return co.kho === false ? null : { id: 'kho1' } } },
        category: { findFirst: async () => { dem.category++; return co.nhom === false ? null : { id: 'nhom1' } } },
        user: { findFirst: async () => { dem.user++; return co.user === false ? null : { id: 'user1' } } },
    }
    return sp
}

const cfgTrong = {}                                    // chưa chọn kho/nhóm nào

async function main() {
    console.log('\n▶ Đệm tuỳ chọn đồng bộ KiotViet\n')

    // 1 — lượt đầu phải tra thật đủ ba thứ
    const sp1 = taoSp()
    const o1 = await buildOptions(sp1, cfgTrong, true)
    ok('1. lượt đầu tra đủ 3 bảng', sp1._dem.warehouse === 1 && sp1._dem.category === 1 && sp1._dem.user === 1, sp1._dem)
    ok('1b. ra đúng giá trị', o1.defaultWarehouseId === 'kho1' && o1.defaultCategoryId === 'nhom1' && o1.systemUserId === 'user1', o1)

    // 2 — 20 lượt webhook tiếp theo KHÔNG được hỏi thêm câu nào
    for (let i = 0; i < 20; i++) await buildOptions(sp1, cfgTrong, true)
    ok('2. 20 lượt sau không tra thêm truy vấn nào',
        sp1._dem.warehouse === 1 && sp1._dem.category === 1 && sp1._dem.user === 1, sp1._dem)

    // 3 — kết quả vẫn đúng, không phải đệm xong trả rỗng
    const o3 = await buildOptions(sp1, cfgTrong, true)
    ok('3. lượt lấy từ đệm vẫn ra đủ giá trị',
        o3.defaultWarehouseId === 'kho1' && o3.defaultCategoryId === 'nhom1' && o3.systemUserId === 'user1', o3)

    /* 4 — CHIỀU NGƯỢC: cửa hàng mới tinh, chưa có gì.
     * Tra ra null thì TUYỆT ĐỐI không đệm — người dùng vừa tạo kho xong mà
     * suốt 5 phút vẫn báo thiếu kho là không ai hiểu nổi. */
    const sp4 = taoSp({ kho: false, nhom: false, user: false })
    await buildOptions(sp4, cfgTrong, true)
    await buildOptions(sp4, cfgTrong, true)
    await buildOptions(sp4, cfgTrong, true)
    ok('4. tra ra null thì KHÔNG đệm, lượt sau vẫn hỏi lại',
        sp4._dem.warehouse === 3 && sp4._dem.category === 3 && sp4._dem.user === 3, sp4._dem)

    // 5 — và khi cửa hàng vừa tạo kho thật thì nhận ra NGAY, không chờ hết TTL
    let coKho = false
    const sp5: any = {
        _dem: { warehouse: 0, category: 0, user: 0 },
        warehouse: { findFirst: async () => { sp5._dem.warehouse++; return coKho ? { id: 'khoMoi' } : null } },
        category: { findFirst: async () => { sp5._dem.category++; return { id: 'nhom1' } } },
        user: { findFirst: async () => { sp5._dem.user++; return { id: 'user1' } } },
    }
    await buildOptions(sp5, cfgTrong, true)
    coKho = true
    const o5 = await buildOptions(sp5, cfgTrong, true)
    ok('5. vừa tạo kho là nhận ra ngay lượt kế tiếp', o5.defaultWarehouseId === 'khoMoi', o5.defaultWarehouseId)

    /* 6 — cấu hình đã chọn sẵn thì đừng tra bảng làm gì.
     * (Đây là đường của cửa hàng đã cấu hình đầy đủ — tốt nhất, 0 truy vấn kho/nhóm.) */
    const sp6 = taoSp()
    await buildOptions(sp6, { defaultWarehouseId: 'khoX', defaultCategoryId: 'nhomY' }, true)
    ok('6. cấu hình chọn sẵn → không tra kho/nhóm', sp6._dem.warehouse === 0 && sp6._dem.category === 0, sp6._dem)

    // 7 — đổi cấu hình thì bỏ đệm NGAY, không chờ hết TTL
    const sp7 = taoSp()
    await buildOptions(sp7, cfgTrong, true)
    boDemTuyChon(sp7)
    await buildOptions(sp7, cfgTrong, true)
    ok('7. bỏ đệm xong thì tra lại thật', sp7._dem.user === 2, sp7._dem)

    // 8 — đệm phải RIÊNG từng cửa hàng, không được dùng chung
    const spA = taoSp(); const spB = taoSp()
    await buildOptions(spA, cfgTrong, true)
    await buildOptions(spB, cfgTrong, true)
    ok('8. mỗi cửa hàng một đệm riêng', spA._dem.user === 1 && spB._dem.user === 1,
        { A: spA._dem.user, B: spB._dem.user })

    console.log(`\n${dat}/${dat + hong} ca đạt`)
    if (hong) process.exit(1)
}

main()
