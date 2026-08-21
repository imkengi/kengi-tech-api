/**
 * Kiểm CÔNG NỢ PHẢI TRẢ NCC — npx tsx scripts/check-cong-no-ncc.ts
 *
 * Một công thức cho mọi màn hình (lib/congNoNcc.ts):
 *     hiển thị = payable (SỐ DƯ ĐẦU KỲ) + Σ phiếu chưa trả, kẹp ≥ 0
 * và với NCC đồng bộ KiotViet: payable = kv.debt − Σ phiếu chưa trả (PHẦN DƯ).
 *
 * Vì sao có bộ này (HUTI 18/08/2026): đồng bộ/đối chiếu từng ghi payable = kv.debt (tổng nợ
 * hiện tại, đã gồm PO) rồi trang danh sách cộng thêm Σ phiếu ⇒ ĐẾM ĐÔI 40,49 tỷ = 20,15 +
 * 20,34 (khớp từng đồng) trong khi KiotViet nói 20,15 tỷ. Ai quay lại ghi payable = kv.debt
 * là ca 3/4 đỏ.
 */

import { conLaiPhieu, soDuDauKyTuKV, congNoChuaKep, congNoHienThi } from '../src/lib/congNoNcc'

let dat = 0, hong = 0
function ok(ten: string, dk: boolean, thucTe?: any) {
    if (dk) { dat++; console.log(`  ✓ ${ten}`) }
    else { hong++; console.log(`  ✗ ${ten}${thucTe !== undefined ? ` — ${JSON.stringify(thucTe)}` : ''}`) }
}
const TY = 1_000_000_000

console.log('— Phiếu còn nợ bao nhiêu (cùng luật GET /suppliers) —')
ok('1. paid + paidAmount 0 (phiếu cũ) → 0, không phải totalCost', conLaiPhieu({ totalCost: 5_000_000, paidAmount: 0, paymentStatus: 'paid' }) === 0)
ok('2. unpaid, paidAmount 0 → totalCost', conLaiPhieu({ totalCost: 5_000_000, paidAmount: 0, paymentStatus: 'unpaid' }) === 5_000_000)
ok('2b. partial 2tr/5tr → 3tr', conLaiPhieu({ totalCost: 5_000_000, paidAmount: 2_000_000, paymentStatus: 'partial' }) === 3_000_000)
ok('2c. trả dư (paidAmount > total) → 0, không âm', conLaiPhieu({ totalCost: 5_000_000, paidAmount: 9_000_000, paymentStatus: 'partial' }) === 0)

console.log('— ĐẾM ĐÔI (Sunhouse-DGD HUTI: KV nói 4,37 tỷ, Σ phiếu chưa trả 4,33 tỷ) —')
const kv = 4.372238252 * TY, phieu = 4.329855675 * TY
const payableDung = soDuDauKyTuKV(kv, phieu)
ok('3. số dư đầu kỳ = KV − phiếu ≈ 42,4tr (không phải 4,37 tỷ)', Math.abs(payableDung - 42_382_577) <= 1, payableDung)
ok('4. hiển thị = payable + phiếu = ĐÚNG KV 4,37 tỷ (không phải 8,70 tỷ)', Math.abs(congNoHienThi(payableDung, phieu) - Math.round(kv)) <= 1, congNoHienThi(payableDung, phieu))
ok('4b. bản cũ (payable = KV) sẽ ra 8,70 tỷ — chính là ca đếm đôi', Math.abs(congNoHienThi(kv, phieu) - 8_702_093_927) <= 1)

console.log('— Phần dư ÂM (Cadivi: KV 1,12 tỷ, Σ phiếu 1,58 tỷ ⇒ 460tr đã trả chưa gắn phiếu) —')
const kvC = 1.119855855 * TY, phieuC = 1.578085855 * TY
const pC = soDuDauKyTuKV(kvC, phieuC)
ok('5. payable âm −458,2tr', pC < 0 && Math.abs(pC + 458_230_000) <= 1, pC)
ok('6. hiển thị vẫn = KV 1,12 tỷ (kẹp không cắt vì tổng dương)', Math.abs(congNoHienThi(pC, phieuC) - Math.round(kvC)) <= 1)
ok('7. so với KV phải dùng số CHƯA KẸP: chưa kẹp = KV → khớp', Math.abs(congNoChuaKep(pC, phieuC) - Math.round(kvC)) <= 1)

console.log('— KV nói NCC nợ ngược (đã trả trước) —')
const pT = soDuDauKyTuKV(-5_000_000, 0)
ok('8. hiển thị kẹp 0', congNoHienThi(pT, 0) === 0)
ok('9. nhưng chưa kẹp = −5tr = KV → đối chiếu KHÔNG báo lệch mãi', congNoChuaKep(pT, 0) === -5_000_000)

console.log('— NCC không có phiếu (Nikita: KV 216,8tr, 0 phiếu) —')
ok('10. payable = KV, hiển thị = KV', soDuDauKyTuKV(216_837_600, 0) === 216_837_600 && congNoHienThi(216_837_600, 0) === 216_837_600)

console.log('— Cửa hàng KHÔNG dùng KV: payable là số dư đầu kỳ nhập tay, cộng phiếu như cũ —')
ok('11. đầu kỳ 10tr + phiếu chưa trả 3tr → 13tr', congNoHienThi(10_000_000, 3_000_000) === 13_000_000)
ok('12. có thêm PO chưa nhận 2tr → 15tr', congNoHienThi(10_000_000, 3_000_000, 2_000_000) === 15_000_000)

console.log(`\n${dat} đạt, ${hong} hỏng`)
if (hong) process.exit(1)
