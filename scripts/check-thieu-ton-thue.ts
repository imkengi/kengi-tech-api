/**
 * Kiểm GOM LỖI "THIẾU TỒN KHO THUẾ" — npx tsx scripts/check-thieu-ton-thue.ts
 *
 * Cron xuất hoá đơn chỉ giữ 3 lỗi đầu, nên chủ shop thấy "59 lỗi" mà không biết
 * phải nhập chứng từ cho mã nào. Bộ gộp biến 59 dòng thành vài mã cần xử.
 *
 * Chuỗi mẫu lấy NGUYÊN VĂN từ log prod KENGISTORE 16/08/2026.
 *
 * Rủi ro của cách này là đọc thông báo dạng chữ: đổi câu chữ ở chỗ sinh lỗi là
 * bộ gộp mù mà không ai biết. Nên có ca canh riêng cho `soKhongDoc` — nó phải
 * ĐẾM được phần không đọc nổi thay vì im lặng bỏ qua.
 */

import { gomThieuTonThue, moTaThieuTonThue } from '../src/lib/gomThieuTonThue'

let dat = 0, hong = 0
function ok(ten: string, dk: boolean, thucTe?: any) {
    if (dk) { dat++; console.log(`  ✓ ${ten}`) }
    else { hong++; console.log(`  ✗ ${ten}${thucTe !== undefined ? ` — ${JSON.stringify(thucTe)}` : ''}`) }
}

const HD = '→ nhập phiếu nhập/chứng từ đầu vào đủ số lượng rồi xuất lại'
const L = (trong: string) => `Thiếu TỒN KHO THUẾ (${trong}) ${HD}`

function main() {
    console.log('\n▶ Gộp lỗi "thiếu tồn kho thuế" theo mã hàng\n')

    // 1 — ca thật: một mã, một phiếu
    const a = gomThieuTonThue([L('SHB212KT thiếu 1')])
    ok('1. tách được mã và số lượng',
        a.theoSku.length === 1 && a.theoSku[0].sku === 'SHB212KT' && a.theoSku[0].thieu === 1, a.theoSku)

    // 2 — nhiều mã trong CÙNG một phiếu
    const b = gomThieuTonThue([L('SP000199 thiếu 1, SHD7346 thiếu 2')])
    ok('2. tách nhiều mã trong một lỗi', b.theoSku.length === 2, b.theoSku)
    ok('2b. giữ đúng số lượng từng mã',
        b.theoSku.find(x => x.sku === 'SHD7346')?.thieu === 2, b.theoSku)

    /* 3 — CỘNG DỒN QUA NHIỀU PHIẾU. Đây là lý do tồn tại của bộ gộp: cùng một
     * mã chặn hàng chục phiếu, gộp lại mới thấy nên mua chứng từ bao nhiêu. */
    const c = gomThieuTonThue([L('SP000199 thiếu 1'), L('SP000199 thiếu 3'), L('SP000199 thiếu 1')])
    ok('3. cộng dồn số lượng cùng mã', c.theoSku[0].thieu === 5, c.theoSku)
    ok('3b. đếm đúng số phiếu bị chặn', c.theoSku[0].soPhieu === 3, c.theoSku)

    // 4 — xếp mã chặn nhiều phiếu nhất lên đầu
    const d = gomThieuTonThue([L('A1 thiếu 9'), L('B2 thiếu 1'), L('B2 thiếu 1'), L('B2 thiếu 1')])
    ok('4. mã chặn nhiều phiếu nhất lên đầu', d.theoSku[0].sku === 'B2', d.theoSku.map(x => x.sku))

    /* 5 — CHIỀU IM QUAN TRỌNG: lỗi KHÁC không được gộp vào nhóm thiếu tồn.
     * Gộp bừa là báo chủ shop đi mua chứng từ cho một lỗi hoàn toàn khác. */
    const e = gomThieuTonThue([L('A1 thiếu 1'), 'Mã số thuế không hợp lệ', 'Timeout khi gọi VNPT'])
    ok('5. lỗi khác đếm riêng, không gộp', e.theoSku.length === 1 && e.loiKhac === 2, e)

    /* 6 — CANH MẪU CHỮ ĐỔI: đúng loại lỗi nhưng không tách nổi mã thì phải ĐẾM,
     * không được im lặng bỏ qua — nếu không, đổi câu chữ là bộ gộp mù mà báo
     * cáo vẫn trông sạch sẽ. */
    const f = gomThieuTonThue(['Thiếu TỒN KHO THUẾ cho vài mặt hàng'])
    ok('6. thiếu tồn mà không có ngoặc → đếm vào soKhongDoc',
        f.soKhongDoc === 1 && f.theoSku.length === 0 && f.loiKhac === 0, f)
    const g = gomThieuTonThue(['Thiếu TỒN KHO THUẾ (không rõ)'])
    ok('6b. ngoặc không có cặp mã/số → cũng đếm vào soKhongDoc', g.soKhongDoc === 1, g)

    /* 6c — ĐỊNH DẠNG THỨ HAI. Cùng thông tin nhưng câu chữ khác: `warnings` của
     * GET /einvoice/queue/receipt/:txId dùng dấu hai chấm thay vì ngoặc.
     * Phát hiện được đúng nhờ soKhongDoc vọt lên khi quét dữ liệu thật 16/08. */
    const dr = gomThieuTonThue([
        'THIẾU TỒN KHO THUẾ: SHB212KT thiếu 1 — nhập chứng từ đầu vào trước, nếu không sẽ KHÔNG xuất được HĐ',
    ])
    ok('6c. đọc được dạng dấu hai chấm của drawer',
        dr.theoSku.length === 1 && dr.theoSku[0].sku === 'SHB212KT' && dr.soKhongDoc === 0, dr)

    /* 6d — CHIỀU IM: câu HƯỚNG DẪN ở đuôi cũng có chữ "thiếu"? không, nhưng nó
     * có chữ và số — không được nuốt nhầm thành mã hàng. */
    const dd = gomThieuTonThue(['THIẾU TỒN KHO THUẾ: A1 thiếu 2 — nhập phiếu nhập 5 ngày trước rồi xuất lại'])
    ok('6d. không nuốt câu hướng dẫn ở đuôi thành mã',
        dd.theoSku.length === 1 && dd.theoSku[0].sku === 'A1', dd.theoSku)

    // 7 — dữ liệu méo không được làm nổ
    ok('7. mảng rỗng → không nổ', gomThieuTonThue([]).theoSku.length === 0)
    ok('7b. null/undefined trong mảng → không nổ',
        gomThieuTonThue([null as any, undefined as any]).loiKhac === 2)

    // 8 — không phụ thuộc dấu tiếng Việt / chữ hoa thường
    const h = gomThieuTonThue(['thieu ton kho thue (SP1 thieu 2)'])
    ok('8. khớp cả khi viết không dấu', h.theoSku.length === 1 && h.theoSku[0].thieu === 2, h)

    // 9 — câu tóm tắt phải nói đủ ba nhóm
    const mo = moTaThieuTonThue(gomThieuTonThue([L('A1 thiếu 2'), 'lỗi lạ', 'Thiếu TỒN KHO THUẾ abc']))
    ok('9. tóm tắt nêu mã thiếu', /A1/.test(mo), mo)
    ok('9b. tóm tắt nêu cả lỗi khác và phần không đọc được',
        /lỗi khác/.test(mo) && /không đọc được/.test(mo), mo)
    ok('9c. không lỗi nào → tóm tắt rỗng, đừng làm ồn', moTaThieuTonThue(gomThieuTonThue([])) === '')

    /* 10 — ĐẾM "…và N mã nữa" phải đúng. Bản đầu suy ngược từ chuỗi đã ghép
     * (`split('), ')`) nên phụ thuộc dấu ngoặc trong câu chữ; đổi cách hiển thị
     * là sai âm thầm. Dựng 12 mã, cắt còn 5 → phải báo đúng 7 mã nữa. */
    const nhieu = gomThieuTonThue(Array.from({ length: 12 }, (_, i) => L(`MA${i} thiếu ${i + 1}`)))
    ok('10. gộp đúng 12 mã', nhieu.theoSku.length === 12, nhieu.theoSku.length)
    const cat = moTaThieuTonThue(nhieu, 5)
    ok('10b. đếm đúng phần còn lại khi cắt bớt', /…và 7 mã nữa/.test(cat), cat.slice(-40))
    ok('10c. không cắt thì KHÔNG có đuôi "và N mã nữa"',
        !/mã nữa/.test(moTaThieuTonThue(nhieu, 20)), moTaThieuTonThue(nhieu, 20).slice(-40))

    console.log(`\n${dat}/${dat + hong} ca đạt`)
    if (hong) process.exit(1)
}

main()
