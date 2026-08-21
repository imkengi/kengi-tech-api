/**
 * Kiểm ĐIỀU KHOẢN THANH TOÁN NCC — npx tsx scripts/check-dieu-khoan-thanh-toan.ts
 *
 * Hạn trả sai một chiều là hai kiểu hại khác nhau: tính SỚM hơn thoả thuận thì
 * cảnh báo quá hạn oan (chủ shop đi trả sớm mất dòng tiền); tính MUỘN hơn thì
 * mất uy tín với NCC. Và tuyệt đối không được BỊA hạn khi chưa thoả thuận —
 * "trống" ≠ "trả ngay".
 */

import { suySoNgayTuNhan, tinhHanTra, soNgayQuaHan, tinhHanTraTheoQuyTac, nhanQuyTac, quyTacTuSupplier, mucHanTra } from '../src/lib/dieuKhoanThanhToan'

let dat = 0, hong = 0
function ok(ten: string, dk: boolean, thucTe?: any) {
    if (dk) { dat++; console.log(`  ✓ ${ten}`) }
    else { hong++; console.log(`  ✗ ${ten}${thucTe !== undefined ? ` — ${JSON.stringify(thucTe)}` : ''}`) }
}
const ymd = (d: Date | null) => d ? d.toISOString().slice(0, 10) : null

function main() {
    console.log('\n▶ Điều khoản thanh toán nhà cung cấp\n')

    // ── suy số ngày từ nhãn ────────────────────────────────────────────────
    ok('1. "Sau 30 ngày" → 30', suySoNgayTuNhan('Sau 30 ngày') === 30, suySoNgayTuNhan('Sau 30 ngày'))
    ok('1b. "Net 45" → 45', suySoNgayTuNhan('Net 45') === 45)
    ok('1c. "45 ngay" (không dấu) → 45', suySoNgayTuNhan('45 ngay') === 45)
    ok('1d. "Trả ngay" → 0', suySoNgayTuNhan('Trả ngay') === 0)
    ok('1e. "COD" → 0', suySoNgayTuNhan('COD') === 0)
    ok('1f. nhãn rỗng → null (chưa thoả thuận, KHÔNG phải 0)', suySoNgayTuNhan('') === null && suySoNgayTuNhan(null) === null)
    ok('1g. nhãn không có số ("Cuối tháng sau") → null, không bịa', suySoNgayTuNhan('Cuối tháng sau') === null)
    ok('1h. số phi lý (999 ngày) → null', suySoNgayTuNhan('999 ngày') === null)

    // ── tính hạn trả ──────────────────────────────────────────────────────
    const nhap = new Date('2026-08-18T03:00:00Z')
    ok('2. phiếu không ghi hạn, NCC 30 ngày → +30', ymd(tinhHanTra(nhap, null, 30)) === '2026-09-17', ymd(tinhHanTra(nhap, null, 30)))
    ok('2b. NCC 0 ngày (trả ngay) → hạn = ngày nhập', ymd(tinhHanTra(nhap, null, 0)) === '2026-08-18')
    ok('2c. cả phiếu lẫn NCC đều không có → null, KHÔNG bịa', tinhHanTra(nhap, null, null) === null)

    /* 3 — PHIẾU TỰ GHI HẠN THÌ ƯU TIÊN TUYỆT ĐỐI, kể cả khác điều khoản NCC.
     * Người dùng ghi tay là họ đã thoả thuận riêng cho lô đó. */
    ok('3. phiếu ghi hạn 10 ngày, NCC 30 ngày → giữ 10 của phiếu',
        ymd(tinhHanTra(nhap, '2026-08-28', 30)) === '2026-08-28')

    // 4 — dữ liệu méo không nổ
    ok('4. ngày nhập rác → null', tinhHanTra('ngay-bay-ba', null, 30) === null)
    ok('4b. số ngày âm → null', tinhHanTra(nhap, null, -5) === null)
    ok('4c. hạn phiếu rác → rơi về NCC', ymd(tinhHanTra(nhap, 'xxx', 30)) === '2026-09-17')

    // ── quá hạn ───────────────────────────────────────────────────────────
    const homNay = new Date('2026-08-18T03:00:00Z')
    ok('5. hạn 3 ngày trước → quá 3', soNgayQuaHan(new Date('2026-08-15T03:00:00Z'), homNay) === 3)
    ok('5b. hạn ngày mai → 0 (chưa quá)', soNgayQuaHan(new Date('2026-08-19T03:00:00Z'), homNay) === 0)
    ok('5c. không có hạn → null (không phải 0)', soNgayQuaHan(null, homNay) === null)

    // ── QUY TẮC ĐẦY ĐỦ (18/08/2026): net / dom / eom, ngày theo giờ VN ────────
    const ymdQ = (d: Date | null) => d ? new Date(d.getTime() + 7 * 3600_000).toISOString().slice(0, 10) : null
    const nhapQ = new Date('2026-08-18T05:00:00Z')   // 12:00 VN 18/08
    const T = (q: any, dd: any = null) => ymdQ(tinhHanTraTheoQuyTac(nhapQ, dd, q))
    ok('Q1. net 30 → +30 ngày (theo ngày VN)', T({ type: 'net', days: 30 }) === '2026-09-17', T({ type: 'net', days: 30 }))
    ok('Q1b. net 0 → đúng ngày nhập (trả ngay)', T({ type: 'net', days: 0 }) === '2026-08-18')
    ok('Q2. eom offset 0 → 31/08', T({ type: 'eom', monthOffset: 0 }) === '2026-08-31', T({ type: 'eom', monthOffset: 0 }))
    ok('Q2b. eom offset 1 → 30/09 (tháng 9 có 30 ngày)', T({ type: 'eom', monthOffset: 1 }) === '2026-09-30')
    ok('Q3. dom 15 offset 1 → 15/09', T({ type: 'dom', dom: 15, monthOffset: 1 }) === '2026-09-15')
    ok('Q3b. dom 31 offset 1 → kẹp về 30/09', T({ type: 'dom', dom: 31, monthOffset: 1 }) === '2026-09-30', T({ type: 'dom', dom: 31, monthOffset: 1 }))
    ok('Q3c. dom 0 / 32 → không bịa, null', T({ type: 'dom', dom: 0 }) === null && T({ type: 'dom', dom: 32 }) === null)
    /* Q4 — RANH GIỚI GIỜ VN: nhập 00:30 VN 01/09 (= 17:30Z 31/08). Tính theo UTC vẫn là
     * tháng 8 → "cuối tháng này" ra 31/08 = SAI; đúng phải là 30/09. */
    const nuaDem = new Date('2026-08-31T17:30:00Z')
    ok('Q4. eom tính theo NGÀY VN, không phải UTC', ymdQ(tinhHanTraTheoQuyTac(nuaDem, null, { type: 'eom', monthOffset: 0 })) === '2026-09-30', ymdQ(tinhHanTraTheoQuyTac(nuaDem, null, { type: 'eom', monthOffset: 0 })))
    ok('Q5. dueDate phiếu tự ghi ưu tiên tuyệt đối', T({ type: 'net', days: 30 }, '2026-12-25T00:00:00Z') === '2026-12-25')
    ok('Q6. không quy tắc → null, không bịa', T(null) === null && T({ type: null }) === null)
    ok('Q7. nhãn net30/net0/eom1/dom15', nhanQuyTac({ type: 'net', days: 30 }) === 'Sau 30 ngày' && nhanQuyTac({ type: 'net', days: 0 }) === 'Trả ngay' && nhanQuyTac({ type: 'eom', monthOffset: 1 }) === 'Cuối tháng sau' && nhanQuyTac({ type: 'dom', dom: 15, monthOffset: 0 }) === 'Ngày 15 tháng này')
    /* Q8 — ĐƯỜNG LÙI bản ghi CŨ: NCC đặt paymentTermDays sáng 18/08 chưa có type → net. */
    ok('Q8. Supplier cũ chỉ có paymentTermDays=30 → net 30', JSON.stringify(quyTacTuSupplier({ paymentTermDays: 30 })) === JSON.stringify({ type: 'net', days: 30, dom: null, monthOffset: null }))
    ok('Q8b. Supplier type=eom offset=1 → eom', quyTacTuSupplier({ paymentTermType: 'eom', paymentTermMonthOffset: 1 })?.type === 'eom')
    ok('Q8c. Supplier trống hết → null', quyTacTuSupplier({}) === null && quyTacTuSupplier(null) === null)
    const hn = new Date('2026-08-18T05:00:00Z')
    ok('Q9. quá hạn 1 ngày → qua-han', mucHanTra(new Date('2026-08-16T17:00:00Z'), hn) === 'qua-han')
    ok('Q9b. còn 3 ngày → sap-den', mucHanTra(new Date('2026-08-21T05:00:00Z'), hn) === 'sap-den')
    ok('Q9c. còn 20 ngày → chua-den', mucHanTra(new Date('2026-09-07T05:00:00Z'), hn) === 'chua-den')
    ok('Q9d. không hạn → khong-han', mucHanTra(null, hn) === 'khong-han')
    ok('Q9e. đúng ngày hạn → sap-den, chưa phải qua-han', mucHanTra(new Date('2026-08-18T05:00:00Z'), hn) === 'sap-den')

    console.log(`\n${dat}/${dat + hong} ca đạt`)
    if (hong) process.exit(1)
}
main()
