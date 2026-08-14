/**
 * Kiểm chứng PHÂN QUYỀN LỊCH SỬ AI.
 *
 * Chạy:  npx tsx scripts/check-ai-scope.ts
 *
 * Trước khi có bảng lưu, hội thoại với trợ lý bay hơi theo tab nên không ai đọc
 * được của ai. Lưu lại mà quên phân quyền là TỰ TAY tạo ra rò rỉ: một thu ngân
 * sẽ đọc được chủ shop hỏi gì về lương, về công nợ, về việc cắt mặt hàng nào.
 *
 * Lỗi loại này im lặng tuyệt đối — không ai báo, không log nào ghi, và chỉ lộ ra
 * khi đã muộn. Nên nó phải có test.
 */

import { loTheoNguoi } from '../src/routes/aiReports'

let dat = 0, hong = 0
function ok(ten: string, dk: boolean, thucTe?: any) {
    if (dk) { dat++; console.log(`  ✓ ${ten}`) }
    else { hong++; console.log(`  ✗ ${ten}${thucTe !== undefined ? ` — thực tế: ${JSON.stringify(thucTe)}` : ''}`) }
}

const req = (role?: string, userId?: string) => ({ user: role ? { role, userId } : undefined }) as any

async function main() {
    console.log('\n▶ Quản lý xem được tất cả\n')
    for (const vai of ['admin', 'manager', 'owner', 'superadmin']) {
        const w = loTheoNguoi(req(vai, 'U1'))
        ok(`${vai} → không bị lọc theo người tạo`, w.createdBy === undefined, w)
    }
    ok('quản lý vẫn giữ nguyên điều kiện gốc',
        loTheoNguoi(req('admin', 'U1'), { id: 'X' }).id === 'X')

    console.log('\n▶ Nhân viên chỉ xem của mình\n')
    for (const vai of ['staff', 'cashier', 'driver', 'warranty', 'sales']) {
        const w = loTheoNguoi(req(vai, 'U9'))
        ok(`${vai} → bị lọc đúng theo userId`, w.createdBy === 'U9', w)
    }
    ok('vẫn giữ điều kiện gốc khi lọc',
        (() => { const w = loTheoNguoi(req('staff', 'U9'), { id: 'X' }); return w.id === 'X' && w.createdBy === 'U9' })())

    console.log('\n▶ Không xác định được người dùng — phải KHOÁ, không được mở\n')

    /* Đây là chỗ dễ sai nhất: thiếu userId mà trả về {} thì hoá ra người lạ xem
     * được tất cả. Phải trả một giá trị không khớp ai cả. */
    const khuyet = loTheoNguoi(req('staff', undefined))
    ok('thiếu userId → vẫn có điều kiện lọc', khuyet.createdBy !== undefined, khuyet)
    ok('… và giá trị đó không khớp người thật nào', khuyet.createdBy === '__khong-co__', khuyet)

    const khongUser = loTheoNguoi(req(undefined))
    ok('không có user → cũng bị khoá', khongUser.createdBy === '__khong-co__', khongUser)

    console.log('\n▶ Vai lạ không được coi là quản lý\n')
    for (const vai of ['Admin', 'ADMIN', 'quanly', 'boss', '']) {
        const w = loTheoNguoi(req(vai, 'U9'))
        ok(`vai "${vai}" → KHÔNG được xem tất cả`, w.createdBy !== undefined, w)
    }

    console.log(`\n${dat}/${dat + hong} ca đạt`)
    if (hong) process.exit(1)
}

main().catch(e => { console.error(e); process.exit(1) })
