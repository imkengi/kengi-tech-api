/**
 * Kiểm CHUÔNG BÁO "ĐƠN CÓ ĐANG VỀ KHÔNG" — npx tsx scripts/check-kiotviet-don-hang.ts
 *
 * Ca quan trọng nhất là ca 7: dựng lại ĐÚNG trạng thái HUTI sáng 15/08/2026.
 * Hôm đó bảng nhật ký xanh hết mà cả ngày không có đơn nào. Nếu bản dựng lại
 * đó KHÔNG kêu thì chuông này vô dụng — nó sinh ra chính là để bắt ca đó.
 *
 * Mỗi luật đều có cả hai chiều: ca PHẢI KÊU và ca PHẢI IM. Chuông chỉ có ca
 * phải kêu là chuông kêu suốt ngày, người dùng tắt não bỏ qua — còn tệ hơn
 * không có chuông (xem [[khong-buoc-toi-oan]]).
 */

import { tinhTinhTrangDon, laHoaDon } from '../src/lib/kiotvietDonHang'

let dat = 0, hong = 0
function ok(ten: string, dk: boolean, thucTe?: any) {
    if (dk) { dat++; console.log(`  ✓ ${ten}`) }
    else { hong++; console.log(`  ✗ ${ten}${thucTe !== undefined ? ` — ${JSON.stringify(thucTe)}` : ''}`) }
}

/** Mốc "bây giờ" cố định để test không phụ thuộc lúc chạy. */
const BAY_GIO = new Date('2026-08-15T02:00:00Z').getTime()   // 09:00 giờ VN
const truoc = (gio: number) => new Date(BAY_GIO - gio * 3_600_000).toISOString()

const dong = (entity: string, gio: number, mode = 'webhook', created = 0) =>
    ({ entity, mode, created, status: 'success', startedAt: truoc(gio) })

function main() {
    console.log('\n▶ Chuông "đơn có đang về không" (KiotViet)\n')

    // 1 — chưa đồng bộ bao giờ thì IM, đừng bịa tình trạng
    ok('1. không có dòng nào → im hẳn (null)', tinhTinhTrangDon([], BAY_GIO) === null)

    // 2 — webhook hoá đơn vừa về → yên, KHÔNG được kêu
    const t2 = tinhTinhTrangDon([
        dong('customer.update', 0.2), dong('invoice.update.99', 2, 'webhook', 1),
    ], BAY_GIO)!
    ok('2. hoá đơn tự về qua webhook 2h trước → "on", không lời nào', t2.muc === 'on' && t2.loi === null, t2)

    // 3 — vừa có hoá đơn NHƯNG do bấm tay, chưa lần nào tự về
    const t3 = tinhTinhTrangDon([
        dong('customer.update', 0.5), dong('invoices', 2, 'manual', 22),
    ], BAY_GIO)!
    ok('3. mới bấm tay, chưa từng qua webhook → "nhac"', t3.muc === 'nhac', t3.muc)
    ok('3b. nói rõ đang phải bấm tay', /bấm đồng bộ tay/.test(t3.loi || ''), t3.loi)

    // 4 — quá 24h
    const t4 = tinhTinhTrangDon([dong('customer.update', 1), dong('invoices', 30, 'manual', 5)], BAY_GIO)!
    ok('4. 30h không có hoá đơn → "vua" và nói số giờ', t4.muc === 'vua' && /30 giờ/.test(t4.loi || ''), t4.loi)

    // 5 — quá 48h thì đếm theo ngày cho dễ hiểu
    const t5 = tinhTinhTrangDon([dong('customer.update', 1), dong('invoices', 60, 'manual', 5)], BAY_GIO)!
    ok('5. 60h không có hoá đơn → "nang" và đếm theo ngày', t5.muc === 'nang' && /2 ngày/.test(t5.loi || ''), t5.loi)

    // 6 — nhật ký chạy rào rào nhưng TUYỆT NHIÊN không có dòng hoá đơn nào
    const t6 = tinhTinhTrangDon([dong('customer.update', 1), dong('product.update', 3)], BAY_GIO)!
    ok('6. có log nhưng không dòng hoá đơn nào → "vua"', t6.muc === 'vua', t6.muc)

    /* 7 — DỰNG LẠI HUTI SÁNG 15/08/2026 (ca sinh ra chuông này)
     * Lượt hoá đơn cuối: bấm tay 14/08 08:22 → 24,6h trước mốc 15/08 09:00.
     * Xen giữa là 89 dòng customer.update "success" — thứ đã làm bảng trông xanh. */
    const huti = [
        ...Array.from({ length: 89 }, (_, i) => dong('customer.update', 0.5 + i * 0.2)),
        dong('invoices', 24.6, 'manual', 23),
    ]
    const t7 = tinhTinhTrangDon(huti, BAY_GIO)!
    ok('7. HUTI 15/08 (89 dòng xanh che mất) → CÓ KÊU', t7.muc === 'vua' || t7.muc === 'nang', t7.muc)
    ok('7b. chỉ đúng chỗ bấm để bật lại webhook', /Đăng ký webhook/.test(t7.loi || ''), t7.loi)
    ok('7c. nói rõ lượt cuối là bấm tay', t7.kieuLanCuoi === 'manual', t7.kieuLanCuoi)

    // 8 — từng về qua webhook rồi TẮT NGÓM: vẫn phải mách bật lại
    const t8 = tinhTinhTrangDon([dong('customer.update', 1), dong('invoice.update.7', 30, 'webhook', 2)], BAY_GIO)!
    ok('8. webhook từng chạy rồi ngưng 30h → vẫn mách đăng ký lại',
        t8.muc === 'vua' && /Đăng ký webhook/.test(t8.loi || ''), t8.loi)

    // 9 — CHIỀU IM: đang yên thì tuyệt đối không mách nước thừa
    ok('9. lúc yên không chèn lời khuyên nào', !/Đăng ký webhook/.test(t2.loi || ''), t2.loi)

    // 10 — `invoices` (bấm tay) và `invoice.*` (webhook) không được lẫn nhau
    ok('10. phân biệt được bấm tay với webhook',
        t3.webhookGanNhat === null && t2.webhookGanNhat !== null,
        { bamTay: t3.webhookGanNhat, webhook: t2.webhookGanNhat })

    // 11 — số đơn lượt cuối phải bê đúng, giao diện còn khoe "tạo 22"
    ok('11. giữ đúng số đơn của lượt cuối', t3.soDonLanCuoi === 22, t3.soDonLanCuoi)

    /* 12 — CHUỖI ENTITY GỘP (suýt gây báo oan)
     * Nút "đồng bộ tất cả" ghi entity thành một chuỗi nối dấu phẩy — có thật
     * trong log HUTI. So bằng `=== 'invoices'` là trượt, và cửa hàng nào chỉ
     * dùng nút tổng sẽ bị vu là "chưa từng đồng bộ hoá đơn". */
    const gop = 'products,customers,suppliers,invoices,returns,purchaseOrders,cashflow'
    ok('12. nhận ra hoá đơn trong chuỗi entity gộp', laHoaDon(gop), gop)
    const t12 = tinhTinhTrangDon([dong('customer.update', 1), dong(gop, 3, 'manual', 40)], BAY_GIO)!
    ok('12b. đồng bộ tổng 3h trước → KHÔNG kêu là mất đơn',
        t12.muc === 'nhac' && !/không có hoá đơn/.test(t12.loi || ''), { muc: t12.muc, loi: t12.loi })

    // 13 — CHIỀU NGƯỢC: đừng nhận bừa chữ có "invoice" nằm trong từ khác
    ok('13. không nhận nhầm entity không phải hoá đơn',
        !laHoaDon('customer.update') && !laHoaDon('products,customers'), 'nhan nham')

    /* 14 — ỐNG THÔNG NHƯNG KHÔNG CÓ NƯỚC CHẢY
     * Đo thật trên HUTI 15/08/2026: 6 webhook invoice.update về đủ, `success`
     * cả 6, nhưng "lấy 1 · tạo 0 · sửa 0" — không phiếu nào vào sổ. Hôm đó là
     * lành (Shopee còn Processing), nhưng chuông không được phép chấm xanh chỉ
     * vì webhook có dội: đó đúng là cái bẫy nó sinh ra để chặn. */
    const roiKhongGhi = Array.from({ length: 6 }, (_, i) => dong('invoice.update.9', 1 + i * 0.2, 'webhook', 0))
    const t14 = tinhTinhTrangDon([dong('customer.update', 0.5), ...roiKhongGhi], BAY_GIO)!
    ok('14. webhook về đều mà 0 phiếu vào sổ → KHÔNG được chấm xanh', t14.muc !== 'on', t14.muc)
    ok('14b. nói đúng bệnh: về được nhưng chưa vào sổ',
        /chưa phiếu nào vào sổ/.test(t14.loi || ''), t14.loi)
    /* 14c — CHỈ SAI ĐƯỜNG CÒN TAI HẠI HƠN IM.
     * Ở ca này webhook đang chạy ngon, bệnh nằm ở khâu ghi. Bảo đi "đăng ký
     * lại webhook" là người dùng bấm xong vẫn y nguyên rồi mất lòng tin. */
    ok('14c. KHÔNG xui đăng ký lại webhook khi webhook vẫn chạy',
        !/Đăng ký webhook/.test(t14.loi || ''), t14.loi)
    ok('14d. tiêu đề khớp đúng bệnh, không dùng nhãn "phải bấm tay"',
        /không phiếu nào vào sổ/.test(t14.tieu), t14.tieu)

    /* 15 — CHIỀU IM của luật 14: có ghi được thì tuyệt đối đừng kêu.
     * Đúng trạng thái HUTI lúc 09:52 — webhook rỗng, nhưng lượt bấm tay 09:26
     * đã ghi 22 phiếu. */
    const t15 = tinhTinhTrangDon([
        ...roiKhongGhi, dong('invoices', 2.5, 'manual', 22),
    ], BAY_GIO)!
    ok('15. có lượt ghi được trong 48h → vẫn xanh', t15.muc === 'on' && t15.loi === null, { muc: t15.muc, loi: t15.loi })

    /* 16 — DỰNG LẠI ĐÚNG BÁO ĐỘNG GIẢ 15/08/2026 10:01
     * Webhook hoá đơn dội dày tới mức cửa sổ "100 dòng gần nhất" chỉ còn phủ
     * 12 PHÚT, toàn dòng ghi 0. Lượt bấm tay ghi 22 phiếu lúc 09:26 rơi ra
     * ngoài. Bản thiếu dòng neo đã kêu oan "48h qua chưa phiếu nào vào sổ"
     * trong khi vừa ghi 22 phiếu nửa tiếng trước. */
    const luLut = Array.from({ length: 38 }, (_, i) => dong('invoice.update.9', 0.05 + i * 0.005, 'webhook', 0))
    const thieuNeo = tinhTinhTrangDon(luLut, BAY_GIO)!
    ok('16. thiếu dòng neo → đúng là sẽ kêu oan (ghi lại để nhớ hợp đồng)',
        thieuNeo.muc === 'nhac', thieuNeo.muc)
    const dongNeoGhiDuoc = dong('invoices', 0.6, 'manual', 22)   // người gọi PHẢI chèn
    const duNeo = tinhTinhTrangDon([dongNeoGhiDuoc, ...luLut], BAY_GIO)!
    ok('16b. chèn đủ dòng neo → im, vì thật sự vừa ghi 22 phiếu',
        duNeo.muc === 'on' && duNeo.loi === null, { muc: duNeo.muc, loi: duNeo.loi })

    console.log(`\n${dat}/${dat + hong} ca đạt`)
    if (hong) process.exit(1)
}

main()
