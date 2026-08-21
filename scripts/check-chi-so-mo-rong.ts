/**
 * Kiểm CHỈ SỐ MỞ RỘNG hồ sơ khách — npx tsx scripts/check-chi-so-mo-rong.ts
 *
 * Mỗi nhóm có ca "phải ra đúng" và ca "không được bịa" (thiếu dữ liệu → null,
 * không phải 0 hay số suy diễn). Mọi con số nợ neo vào sổ qua FIFO — ca 4 tái
 * hiện đúng bài học Thiên Hưng/Hiệp Hòa 18/08/2026.
 */

import { tinhChiSoMoRong } from '../src/lib/chiSoKhachMoRong'
import type { PhieuNo } from '../src/lib/sucKhoeTaiChinhKhach'

let dat = 0, hong = 0
function ok(ten: string, dk: boolean, thucTe?: any) {
    if (dk) { dat++; console.log(`  ✓ ${ten}`) }
    else { hong++; console.log(`  ✗ ${ten}${thucTe !== undefined ? ` — ${JSON.stringify(thucTe)}` : ''}`) }
}
const NAY = new Date('2026-08-18T03:00:00Z')
const truoc = (n: number) => new Date(NAY.getTime() - n * 86_400_000).toISOString()
const p = (id: string, total: number, status: string, ngayTruoc: number, daTra = 0): PhieuNo =>
    ({ id, total, status, transactionDate: truoc(ngayTruoc), daTra })

function main() {
    console.log('\n▶ Chỉ số mở rộng hồ sơ khách\n')

    // ── 1. NHỊP MUA ───────────────────────────────────────────────────────
    // Mua vào ngày -30, -20, -10, -0 → 4 ngày, khoảng cách 30/3 = 10 ngày
    const a = tinhChiSoMoRong([p('1', 100, 'completed', 30), p('2', 100, 'completed', 20), p('3', 100, 'completed', 10), p('4', 100, 'completed', 0)], 0, NAY)
    ok('1. TB ngày giữa hai lần = 10, lần cuối 0 ngày, không im lâu', a.nhipMua.tbNgayGiuaHaiLan === 10 && a.nhipMua.ngayTuLanCuoi === 0 && !a.nhipMua.dangImLau, a.nhipMua)
    // 2 đơn CÙNG NGÀY = 1 lần mua
    const a2 = tinhChiSoMoRong([p('1', 100, 'completed', 10), p('2', 100, 'completed', 10), p('3', 100, 'completed', 0)], 0, NAY)
    ok('1b. hai đơn cùng ngày đếm là 1 lần → soNgayCoMua=2, TB=10', a2.nhipMua.soNgayCoMua === 2 && a2.nhipMua.tbNgayGiuaHaiLan === 10, a2.nhipMua)
    // Im lâu: thường 10 ngày/lần, nay 25 ngày chưa mua → dangImLau
    const a3 = tinhChiSoMoRong([p('1', 100, 'completed', 45), p('2', 100, 'completed', 35), p('3', 100, 'completed', 25)], 0, NAY)
    ok('1c. thường 10 ngày/lần, im 25 ngày (>2×) → dangImLau=true', a3.nhipMua.dangImLau === true, a3.nhipMua)
    // Chỉ 1 lần mua → TB null (không bịa)
    const a4 = tinhChiSoMoRong([p('1', 100, 'completed', 5)], 0, NAY)
    ok('1d. mua đúng 1 lần → tbNgayGiuaHaiLan = null, không bịa', a4.nhipMua.tbNgayGiuaHaiLan === null && a4.nhipMua.dangImLau === false, a4.nhipMua)

    // ── 2. ĐỘ LỚN ĐƠN ─────────────────────────────────────────────────────
    const b = tinhChiSoMoRong([p('1', 100, 'completed', 200), p('2', 100, 'completed', 150), p('3', 100, 'completed', 120), p('4', 1000, 'completed', 5)], 0, NAY)
    ok('2. TB=325, trung vị=100 (không bị đơn 1000 kéo), lớn nhất=1000', b.doLonDon.tb === 325 && b.doLonDon.trungVi === 100 && b.doLonDon.lonNhat === 1000, b.doLonDon)
    ok('2b. đơn 3 tháng gần (1000) ÷ TB toàn kỳ (325) ≈ 3.08 → khách đang mua to hơn', b.doLonDon.heSo3ThangGanNhat === 3.08, b.doLonDon.heSo3ThangGanNhat)
    const b2 = tinhChiSoMoRong([p('1', 100, 'completed', 200)], 0, NAY)
    ok('2c. không có đơn 3 tháng gần → heSo = null', b2.doLonDon.heSo3ThangGanNhat === null)

    // ── 3. XU HƯỚNG ───────────────────────────────────────────────────────
    // 3 tháng trước: 2 đơn 100 = 200; 3 tháng gần: 3 đơn 100 = 300 → +50%
    const c = tinhChiSoMoRong([p('1', 100, 'completed', 150), p('2', 100, 'completed', 120), p('3', 100, 'completed', 60), p('4', 100, 'completed', 30), p('5', 100, 'completed', 5)], 0, NAY)
    ok('3. 200 → 300 = +50%, nhãn "tang", đơn 2→3 = +50%', c.xuHuong.tangTruongTien === 0.5 && c.xuHuong.nhan === 'tang' && c.xuHuong.tangTruongDon === 0.5, c.xuHuong)
    const c2 = tinhChiSoMoRong([p('1', 100, 'completed', 5)], 0, NAY)
    ok('3b. không có 3 tháng trước → tangTruong null, nhãn chua-du-du-lieu (không bịa "tăng vô hạn")', c2.xuHuong.tangTruongTien === null && c2.xuHuong.nhan === 'chua-du-du-lieu', c2.xuHuong)
    const c3 = tinhChiSoMoRong([p('1', 100, 'completed', 120), p('2', 105, 'completed', 30)], 0, NAY)
    ok('3c. +5% → on-dinh (trong ±15%)', c3.xuHuong.nhan === 'on-dinh', c3.xuHuong.nhan)

    // ── 4. NỢ SÂU HƠN — FIFO neo sổ ───────────────────────────────────────
    // Phiếu treo: 120 ngày 100 (đã trả gộp), 45 ngày 80, 10 ngày 60. Sổ = 100.
    // FIFO: nợ thật = 60 (10 ngày) + 40 phần của phiếu 45 ngày → bậc 0-30: 60, 31-60: 40, >90: 0
    const d = tinhChiSoMoRong([p('a', 100, 'partial', 120), p('b', 80, 'partial', 45), p('c', 60, 'partial', 10), p('x', 760, 'completed', 90)], 100, NAY)
    ok('4. sổ 100 < treo 240 → bậc 0-30=60, 31-60=40, >90=0 (phiếu 120 ngày đã trả gộp)', d.noSauHon.bacTuoi.b0_30 === 60 && d.noSauHon.bacTuoi.b31_60 === 40 && d.noSauHon.bacTuoi.tren90 === 0, d.noSauHon.bacTuoi)
    ok('4b. tổng bậc = duNo (100), ngoaiPhieu = 0', d.noSauHon.bacTuoi.b0_30 + d.noSauHon.bacTuoi.b31_60 + d.noSauHon.bacTuoi.b61_90 + d.noSauHon.bacTuoi.tren90 === 100 && d.noSauHon.ngoaiPhieu === 0, d.noSauHon)
    ok('4c. nợ/tổng mua = 100/1000 = 0.1', d.noSauHon.noTrenTongMua === 0.1, d.noSauHon.noTrenTongMua)
    // Sổ 0 → mọi bậc 0 (Thiên Hưng)
    const d2 = tinhChiSoMoRong([p('a', 100, 'partial', 120), p('b', 80, 'partial', 45)], 0, NAY)
    ok('4d. sổ 0 → mọi bậc tuổi 0, ngoaiPhieu 0 (Thiên Hưng — không nợ)', Object.values(d2.noSauHon.bacTuoi).every(v => v === 0) && d2.noSauHon.ngoaiPhieu === 0, d2.noSauHon)
    // Sổ LỚN hơn tổng treo → phần dư là ngoaiPhieu (nợ đầu kỳ)
    const d3 = tinhChiSoMoRong([p('a', 100, 'partial', 20)], 300, NAY)
    ok('4e. sổ 300 > treo 100 → bậc 0-30=100, ngoaiPhieu=200 (nợ đầu kỳ nhập tay)', d3.noSauHon.bacTuoi.b0_30 === 100 && d3.noSauHon.ngoaiPhieu === 200, d3.noSauHon)
    // Nợ bằng mấy tháng mua: mua 2 tháng tổng 1000 → TB 500/tháng; nợ 750 → 1.5 tháng
    const d4 = tinhChiSoMoRong([p('a', 500, 'completed', 40), p('b', 500, 'partial', 5)], 750, NAY)
    ok('4f. nợ 750 ÷ TB 500/tháng = 1.5 tháng mua', d4.noSauHon.noBangMayThangMua === 1.5, d4.noSauHon.noBangMayThangMua)

    // ── 5. THÓI QUEN TRẢ ──────────────────────────────────────────────────
    const e = tinhChiSoMoRong([p('a', 100, 'completed', 30), p('b', 100, 'completed', 20)], 0, NAY, new Map([['a', new Date(truoc(20))], ['b', new Date(truoc(15))]]))
    ok('5. có ngày trả: a 10 ngày, b 5 ngày → TB 7.5, tính 2 phiếu', e.thoiQuenTra.tbNgayTra === 7.5 && e.thoiQuenTra.soPhieuTinh === 2, e.thoiQuenTra)
    const e2 = tinhChiSoMoRong([p('a', 100, 'completed', 30)], 0, NAY)
    ok('5b. không có ngày trả → null, không bịa', e2.thoiQuenTra.tbNgayTra === null && e2.thoiQuenTra.soPhieuTinh === 0, e2.thoiQuenTra)

    // ── 6. Méo / rỗng không nổ ────────────────────────────────────────────
    const f = tinhChiSoMoRong([], 0, NAY)
    ok('6. rỗng → không nổ, mọi thứ null/0', f.nhipMua.ngayTuLanCuoi === null && f.doLonDon.tb === 0 && f.xuHuong.nhan === 'chua-du-du-lieu', f)
    const f2 = tinhChiSoMoRong([{ id: 'x', total: 100, status: 'voided' }, { id: 'y', total: 50, status: 'partial', transactionDate: 'rac' }], 50, NAY)
    ok('6b. voided bỏ; ngày rác không tính nhịp mua nhưng không nổ', f2.nhipMua.soNgayCoMua === 0 && f2.doLonDon.tb === 50, f2)

    console.log(`\n${dat}/${dat + hong} ca đạt`)
    if (hong) process.exit(1)
}
main()
