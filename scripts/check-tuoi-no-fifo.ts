/**
 * Kiểm PHÂN BỔ TUỔI NỢ FIFO NEO SỔ — npx tsx scripts/check-tuoi-no-fifo.ts
 *
 * Báo cáo tuổi nợ 131/331 (routes/tax.ts) từng dồn TOÀN BỘ nợ vào một rổ theo "ngày kể
 * từ lần mua cuối" (khách mua đều thì không bao giờ già; HUTI 18/08/2026: Hoàng Sơn 163,7tr
 * rổ 1–30 ngày trong khi FIFO nói 225 ngày; "trong hạn" chỉ khi mua hôm nay ⇒ "quá hạn
 * 4,16 tỷ" vs trang Công Nợ 1,26 tỷ >90). Nay cùng luật FIFO neo sổ với trang Công Nợ /
 * Sức khoẻ khách và PHÂN BỔ từng phần vào rổ theo ngày chứng từ.
 */

import { phanBoTuoiNoFifo, doVaoRo, roRong } from '../src/lib/tuoiNoFifo'

let dat = 0, hong = 0
function ok(ten: string, dk: boolean, thucTe?: any) {
    if (dk) { dat++; console.log(`  ✓ ${ten}`) }
    else { hong++; console.log(`  ✗ ${ten}${thucTe !== undefined ? ` — ${JSON.stringify(thucTe)}` : ''}`) }
}
const HOM_NAY = new Date('2026-08-18T10:00:00Z')
const truoc = (n: number) => new Date(HOM_NAY.getTime() - n * 86_400_000)
const tong = (ro: any) => ro.current + ro.days30 + ro.days60 + ro.days90 + ro.overdue90

console.log('— Rổ —')
{ const ro = roRong(); doVaoRo(ro, 7, 1); doVaoRo(ro, 8, 1); doVaoRo(ro, 30, 1); doVaoRo(ro, 31, 1); doVaoRo(ro, 60, 1); doVaoRo(ro, 61, 1); doVaoRo(ro, 90, 1); doVaoRo(ro, 91, 1)
  ok('1. biên rổ: ≤7 current, 8–30, 31–60, 61–90, >90', ro.current === 1 && ro.days30 === 2 && ro.days60 === 2 && ro.days90 === 2 && ro.overdue90 === 1, ro) }
{ const ro = roRong(); doVaoRo(ro, 5, 0); doVaoRo(ro, 5, -3); ok('2. tiền ≤ 0 không đổ vào rổ', tong(ro) === 0) }

console.log('— FIFO: nợ nằm ở chứng từ MỚI nhất —')
{ // 3 hoá đơn: 200 ngày (10tr), 40 ngày (5tr), 3 ngày (4tr); sổ nợ 6tr → 4tr (3 ngày) + 2tr (40 ngày)
  const kq = phanBoTuoiNoFifo(6_000_000, [{ ngay: truoc(200), tien: 10_000_000 }, { ngay: truoc(40), tien: 5_000_000 }, { ngay: truoc(3), tien: 4_000_000 }], HOM_NAY)
  ok('3. sổ 6tr → 4tr rổ ≤7 + 2tr rổ 31–60, KHÔNG động vào hoá đơn 200 ngày', kq.ro.current === 4_000_000 && kq.ro.days60 === 2_000_000 && kq.ro.overdue90 === 0, kq.ro)
  ok('3b. mốc tuổi = hoá đơn 40 ngày, tuoiMoc 40, không dư đầu kỳ', kq.tuoiMoc === 40 && kq.duDauKy === 0 && kq.moc?.getTime() === truoc(40).getTime())
  ok('3c. tổng các rổ = số dư sổ', tong(kq.ro) === 6_000_000) }
{ // Hoàng Sơn kiểu: mua đều nhưng nợ lớn hơn cả 3 hoá đơn gần → phần còn lại rơi vào hoá đơn cũ (225 ngày)
  const kq = phanBoTuoiNoFifo(163_683_328, [{ ngay: truoc(225), tien: 150_000_000 }, { ngay: truoc(60), tien: 5_000_000 }, { ngay: truoc(25), tien: 8_683_328 }], HOM_NAY)
  ok('4. mua đều nhưng nợ vượt hoá đơn gần → phần lớn vào >90 (không còn "1–30 ngày vì GD cuối 25 ngày")', kq.ro.overdue90 === 150_000_000 && kq.ro.days30 === 8_683_328 && kq.ro.days60 === 5_000_000, kq.ro)
  ok('4b. tuổi mốc 225', kq.tuoiMoc === 225) }

console.log('— Dư đầu kỳ không chứng từ —')
{ const kq = phanBoTuoiNoFifo(20_000_000, [{ ngay: truoc(10), tien: 5_000_000 }], HOM_NAY)
  ok('5. sổ 20tr, chỉ 5tr hoá đơn → 5tr rổ 8–30, 15tr dư đầu kỳ vào >90 kèm cờ, tuoiMoc ≥ 91', kq.ro.days30 === 5_000_000 && kq.ro.overdue90 === 15_000_000 && kq.duDauKy === 15_000_000 && kq.tuoiMoc >= 91, kq)
  ok('5b. tổng rổ vẫn = sổ (không mất tiền)', tong(kq.ro) === 20_000_000) }
{ const kq = phanBoTuoiNoFifo(16_912_097, [], HOM_NAY)
  ok('6. không có chứng từ nào → toàn bộ >90 + duDauKy, moc null', kq.ro.overdue90 === 16_912_097 && kq.duDauKy === 16_912_097 && kq.moc === null) }

console.log('— Bền —')
{ const kq = phanBoTuoiNoFifo(0, [{ ngay: truoc(3), tien: 1 }], HOM_NAY); ok('7. sổ 0 → rổ rỗng', tong(kq.ro) === 0 && kq.duDauKy === 0) }
{ const kq = phanBoTuoiNoFifo(1_000, [{ ngay: new Date('rác'), tien: 5 } as any, { ngay: truoc(2), tien: 5_000 }], HOM_NAY); ok('8. ngày rác bị bỏ, không nổ', kq.ro.current === 1_000) }
{ const kq = phanBoTuoiNoFifo(1_000, [{ ngay: truoc(2), tien: 600 }, { ngay: truoc(1), tien: 600 }], HOM_NAY); ok('9. thứ tự đầu vào bất kỳ — hàm tự sắp mới → cũ', kq.ro.current === 1_000 && kq.tuoiMoc === 2) }

console.log(`\n${dat} đạt, ${hong} hỏng`)
if (hong) process.exit(1)
