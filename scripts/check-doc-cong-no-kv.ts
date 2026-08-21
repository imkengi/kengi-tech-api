/**
 * Kiểm ĐỌC CÔNG NỢ TỪ BẢN GHI KIOTVIET — npx tsx scripts/check-doc-cong-no-kv.ts
 *
 * Luật: THIẾU ≠ 0. Bản ghi không mang `debt` (undefined/null/rỗng/không phải số)
 * → null → bên gọi KHÔNG đụng Customer.debt / Supplier.payable.
 *
 * Vì sao có bộ này (18/08/2026, HUTI): webhook customer.update của KiotViet không
 * mang Debt; bản cũ `Number(kv?.debt) || 0` biến "không biết" thành 0 và với
 * overwritePrices bật là ghi đè 0 lên nợ thật — 7 khách vừa đối chiếu đúng lúc
 * 08:56Z về 0 lại đúng mili-giây các webhook 09:12–09:19Z (HN06 96,6tr, HN01
 * 64,1tr…). Đây là gốc của 39 khách / 857,7tr "Kengi giấu nợ" đo buổi sáng.
 * Ai sửa docCongNoKV về `|| 0` là bộ này đỏ.
 */

import { docCongNoKV } from '../src/services/kiotvietSync'

let dat = 0, hong = 0
function ok(ten: string, dk: boolean, thucTe?: any) {
    if (dk) { dat++; console.log(`  ✓ ${ten}`) }
    else { hong++; console.log(`  ✗ ${ten}${thucTe !== undefined ? ` — ${JSON.stringify(thucTe)}` : ''}`) }
}

console.log('— Thiếu ≠ 0 —')
ok('1. payload webhook không có debt → null (KHÔNG phải 0)', docCongNoKV({ id: 1, code: 'HN06', name: 'Hiệp Hòa' }) === null)
ok('2. debt: null → null', docCongNoKV({ id: 1, debt: null }) === null)
ok('3. debt: "" → null', docCongNoKV({ id: 1, debt: '' }) === null)
ok('4. debt: "abc" → null', docCongNoKV({ id: 1, debt: 'abc' }) === null)
ok('5. bản ghi null/undefined → null', docCongNoKV(null) === null && docCongNoKV(undefined) === null)

console.log('— Có debt thì đọc đúng số —')
ok('6. debt: 0 → 0 (số 0 THẬT, khác thiếu)', docCongNoKV({ id: 1, debt: 0 }) === 0)
ok('7. debt: 96608533 → 96608533', docCongNoKV({ id: 1, debt: 96608533 }) === 96608533)
ok('8. debt chuỗi "220061335" → số', docCongNoKV({ id: 1, debt: '220061335' }) === 220061335)
ok('9. debt âm (khách trả dư) giữ dấu', docCongNoKV({ id: 1, debt: -500000 }) === -500000)
ok('10. bọc trong data.debt (dạng REST bọc) → đọc được', docCongNoKV({ data: { debt: 123 } }) === 123)

console.log('— Hệ quả bên gọi (mô phỏng luật syncCustomers) —')
function quyetDinhGhi(kv: any, existingDebt: number, overwrite: boolean, tuWebhook = false): number | 'giữ' {
    const no = tuWebhook ? null : docCongNoKV(kv)   // cùng luật với syncCustomers: webhook không tin debt payload
    if (no === null) return 'giữ'
    return no !== existingDebt && (!existingDebt || overwrite) ? no : 'giữ'
}
ok('11. webhook thiếu debt + overwritePrices bật + Kengi 96,6tr → GIỮ (trước đây: ghi 0)', quyetDinhGhi({ id: 1 }, 96608533, true, true) === 'giữ')
ok('12. danh sách REST debt 220tr, Kengi 0 → ghi 220tr', quyetDinhGhi({ id: 1, debt: 220061335 }, 0, false) === 220061335)
ok('13. REST debt 0 thật, Kengi 5tr, overwrite tắt → giữ (không đè khoản thu Kengi ghi)', quyetDinhGhi({ id: 1, debt: 0 }, 5_000_000, false) === 'giữ')
ok('14. REST debt 0 thật, Kengi 5tr, overwrite bật → ghi 0 (khách đã trả hết bên KV)', quyetDinhGhi({ id: 1, debt: 0 }, 5_000_000, true) === 0)
ok('15. webhook gửi "Debt: 0" cho có + overwrite bật + Kengi 96,6tr → vẫn GIỮ (không tin payload)', quyetDinhGhi({ id: 1, debt: 0 }, 96608533, true, true) === 'giữ')
ok('16. REST thiếu debt (khách nợ rỗng) + Kengi 0 → giữ, không lỗi', quyetDinhGhi({ id: 1 }, 0, true) === 'giữ')

console.log('— Khách TRẢ HẾT: KV bỏ trống debt (18/08: 26/26 khách bỏ khoá khi = 0) —')
// Luật (doiChieuNoKhach + lamTuoiNoKhach): bản ghi khách thật bỏ trống debt → 0 CHỈ KHI cùng key đã thấy debt ở khách khác
function hieuBoTrong(kv: any, keyDaThayDebt: boolean): number | null | 'giữ' {
    const d = docCongNoKV(kv)
    if (d !== null) return d
    const laKhachThat = !!kv && typeof kv === 'object' && kv.id !== undefined
    return laKhachThat && keyDaThayDebt ? 0 : 'giữ'
}
ok('17. khách thật bỏ trống debt + key đã thấy debt ở khách khác → 0 (khách đã trả hết, không treo nợ mãi)', hieuBoTrong({ id: 1, code: 'AN004.HU', name: 'Thu Hương 1' }, true) === 0)
ok('18. khách thật bỏ trống debt + key CHƯA thấy debt ở đâu → giữ (nghi key thiếu quyền, không đoán)', hieuBoTrong({ id: 1, code: 'X' }, false) === 'giữ')
ok('19. bản ghi không phải khách (không id) → giữ dù key thấy debt', hieuBoTrong({ responseStatus: { message: 'not found' } }, true) === 'giữ')
ok('20. có debt thật thì đọc số, không dính luật bỏ trống', hieuBoTrong({ id: 1, debt: 220061335 }, false) === 220061335)
console.log(`\n${dat} đạt, ${hong} hỏng`)
if (hong) process.exit(1)
