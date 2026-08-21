/**
 * Kiểm HỒ SƠ SỨC KHOẺ TÀI CHÍNH KHÁCH — npx tsx scripts/check-suc-khoe-tai-chinh.ts
 *
 * Con số "ngày nợ" đi thẳng vào quyết định có bán chịu tiếp hay không, nên sai
 * là hại thật ở CẢ HAI chiều: báo nợ già oan thì mất khách tốt; báo khoẻ oan thì
 * bán chịu thêm cho người đang chây ì. Bộ này nặng về ranh giới của định nghĩa
 * "chưa thanh toán" và về ngày lấy theo ngày BÁN chứ không phải ngày NHẬP.
 */

import { tinhSucKhoeTaiChinh, gomTheoThang, type PhieuNo } from '../src/lib/sucKhoeTaiChinhKhach'

let dat = 0, hong = 0
function ok(ten: string, dk: boolean, thucTe?: any) {
    if (dk) { dat++; console.log(`  ✓ ${ten}`) }
    else { hong++; console.log(`  ✗ ${ten}${thucTe !== undefined ? ` — ${JSON.stringify(thucTe)}` : ''}`) }
}
const NAY = new Date('2026-08-18T03:00:00Z')
const truoc = (n: number) => new Date(NAY.getTime() - n * 86_400_000).toISOString()
const p = (id: string, total: number, status: string, ngayTruoc: number, daTra = 0, createdAtTruoc?: number): PhieuNo =>
    ({ id, total, status, transactionDate: truoc(ngayTruoc), createdAt: truoc(createdAtTruoc ?? ngayTruoc), daTra })

function main() {
    console.log('\n▶ Hồ sơ sức khoẻ tài chính khách hàng\n')

    // 1 — không phiếu → chưa đủ dữ liệu, không bịa xếp hạng
    const a = tinhSucKhoeTaiChinh([], 0, NAY)
    ok('1. không phiếu → chua-du-du-lieu, ngày nợ null', a.xepHang === 'chua-du-du-lieu' && a.ngayNoGanNhat === null, a)

    // 2 — toàn phiếu trả đủ, dư nợ 0 → tốt
    const b = tinhSucKhoeTaiChinh([p('1', 100, 'completed', 5), p('2', 200, 'completed', 30)], 0, NAY)
    ok('2. không nợ → tot', b.xepHang === 'tot' && b.soPhieuTreo === 0, b)

    /* 3 — ĐÚNG YÊU CẦU CHỦ SHOP: "tính từ giao dịch không thanh toán cuối cùng".
     * Hai phiếu chịu: 40 ngày trước và 5 ngày trước. Gần nhất = 5, lâu nhất = 40. */
    const c = tinhSucKhoeTaiChinh([p('1', 500, 'partial', 40), p('2', 300, 'partial', 5), p('3', 100, 'completed', 2)], 800, NAY)
    ok('3. ngayNoGanNhat = 5 (phiếu chưa trả GẦN NHẤT)', c.ngayNoGanNhat === 5, c.ngayNoGanNhat)
    ok('3b. ngayNoLauNhat = 40 (tuổi nợ)', c.ngayNoLauNhat === 40, c.ngayNoLauNhat)
    ok('3c. soPhieuTreo = 2', c.soPhieuTreo === 2, c.soPhieuTreo)
    ok('3d. tienTreoTheoPhieu = 800', c.tienTreoTheoPhieu === 800, c.tienTreoTheoPhieu)

    /* 4 — PHIẾU partial NHƯNG ĐÃ TRẢ ĐỦ (trả nợ xong mà status chưa đổi) → KHÔNG
     * còn treo. Đếm nó là báo nợ oan. */
    const d = tinhSucKhoeTaiChinh([p('1', 500, 'partial', 40, 500)], 0, NAY)
    ok('4. partial đã trả đủ → không treo, ngày nợ null', d.soPhieuTreo === 0 && d.ngayNoGanNhat === null, d)

    // 4b — trả một phần → vẫn treo, tiền treo = phần còn lại
    const d2 = tinhSucKhoeTaiChinh([p('1', 500, 'partial', 10, 200)], 300, NAY)
    ok('4b. trả 200/500 → treo 300', d2.soPhieuTreo === 1 && d2.tienTreoTheoPhieu === 300, d2)

    /* 5 — NGÀY THEO NGÀY BÁN, KHÔNG PHẢI NGÀY NHẬP. Cửa hàng nhập lịch sử KiotViet:
     * createdAt = 2 ngày trước (lúc nhập), transactionDate = 60 ngày trước. */
    const e = tinhSucKhoeTaiChinh([p('1', 500, 'partial', 60, 0, 2)], 500, NAY)
    ok('5. lấy transactionDate (60) chứ không phải createdAt (2)', e.ngayNoLauNhat === 60, e.ngayNoLauNhat)

    // 6 — xếp hạng theo tuổi nợ
    ok('6. nợ 20 ngày → theo-doi', tinhSucKhoeTaiChinh([p('1', 100, 'partial', 20)], 100, NAY).xepHang === 'theo-doi')
    ok('6b. nợ 95 ngày → rui-ro', tinhSucKhoeTaiChinh([p('1', 100, 'partial', 95)], 100, NAY).xepHang === 'rui-ro')

    // 7 — sổ lệch phiếu → phải NÓI RA trong lyDo, không im
    const g = tinhSucKhoeTaiChinh([p('1', 100_000, 'partial', 10)], 900_000, NAY)
    ok('7. dư nợ sổ 900k mà phiếu treo 100k → lyDo có "lệch"', g.lyDo.some(x => /lệch/.test(x)), g.lyDo)

    // 8 — CHIỀU IM: lệch nhỏ (< 20% và < 50k) thì đừng kêu
    const h = tinhSucKhoeTaiChinh([p('1', 1_000_000, 'partial', 10)], 1_020_000, NAY)
    ok('8. lệch 20k/1tr → KHÔNG kêu', !h.lyDo.some(x => /lệch/.test(x)), h.lyDo)

    /* 8b — QUY ƯỚC "ĐÃ TRẢ" = Transaction.amountReceived, KHÔNG phải tổng Payment.
     * Bản đầu endpoint cộng Payment không phải 'credit'; đã đổi sang amountReceived
     * vì đó là thước hệ thống dùng ở 5 chỗ (chặn trả quá nợ, thống kê nợ, hoàn trả).
     * Ca này khoá ngữ nghĩa: phiếu partial total 500, amountReceived 500 → KHÔNG treo,
     * dù nó vẫn mang status 'partial'. */
    const q = tinhSucKhoeTaiChinh([p('1', 500, 'partial', 20, 500)], 0, NAY)
    ok('8b. amountReceived = total → hết nợ dù status còn partial', q.soPhieuTreo === 0 && q.xepHang === 'tot', q)

    /* 7b — soLechPhieu là MỘT NGUỒN cho cả lyDo lẫn khối đối chiếu FE. Ca FE từng
     * làm sai: sổ 0 nhưng còn phiếu treo (status chưa đổi) → FE tô vàng "lệch",
     * BE im. Nay cả hai đọc cùng cờ; sổ 0 thì KHÔNG phải "sổ lệch". */
    const g2 = tinhSucKhoeTaiChinh([p('1', 300_000, 'partial', 10)], 0, NAY)
    ok('7b. sổ 0 + phiếu treo 300k → soLechPhieu=false (chuyện trạng thái, không phải sổ lệch)',
        g2.soLechPhieu === false && !g2.lyDo.some(x => /lệch/.test(x)), { co: g2.soLechPhieu, lyDo: g2.lyDo })
    ok('7c. cờ soLechPhieu KHỚP với lyDo ở ca lệch thật', g.soLechPhieu === true, g.soLechPhieu)
    ok('7d. cờ soLechPhieu KHỚP với lyDo ở ca lệch nhỏ', h.soLechPhieu === false, h.soLechPhieu)

    // 9 — dữ liệu méo: status lạ, ngày rác không nổ
    const i = tinhSucKhoeTaiChinh([{ id: 'x', total: 100, status: 'voided' }, { id: 'y', total: 50, status: 'partial', transactionDate: 'rac' }], 50, NAY)
    ok('9. voided bỏ qua; ngày rác → không tính ngày nhưng vẫn đếm treo', i.soPhieuTreo === 1 && i.ngayNoGanNhat === null, i)

    /* ── BÁO CÁO THEO THÁNG ─────────────────────────────────────────────── */
    console.log('\n▶ Báo cáo theo tháng\n')
    const pt = (id: string, total: number, status: string, iso: string, daTra = 0): PhieuNo => ({ id, total, status, transactionDate: iso, daTra })
    const NAY2 = new Date('2026-08-18T03:00:00Z')

    // 10 — cắt tháng theo GIỜ VN: 23:30 31/07 VN = 16:30Z → T7; 00:30 01/08 VN = 17:30Z 31/07 → T8
    const m10 = gomTheoThang([
        pt('a', 100, 'completed', '2026-07-31T16:30:00Z'),
        pt('b', 200, 'completed', '2026-07-31T17:30:00Z'),
    ], NAY2, 12)
    ok('10. cắt tháng theo giờ VN: 16:30Z→T7, 17:30Z→T8',
        m10.thang.map(t => t.thang + ':' + t.tienMua).join(',') === '2026-07:100,2026-08:200', m10.thang.map(t => t.thang + ':' + t.tienMua))

    // 11 — tỉ lệ nợ/mua trong tháng và tỉ lệ đơn chịu
    const m11 = gomTheoThang([
        pt('1', 1000, 'completed', '2026-08-02T03:00:00Z'),
        pt('2', 1000, 'partial',   '2026-08-05T03:00:00Z', 400),   // nợ 600
        pt('3', 2000, 'partial',   '2026-08-09T03:00:00Z', 0),     // nợ 2000
    ], NAY2, 12)
    const t8 = m11.thang.find(t => t.thang === '2026-08')!
    ok('11. tháng 8: mua 4000, nợ phát sinh 2600, tỉ lệ 0.65', t8.tienMua === 4000 && t8.tienNoPhatSinh === 2600 && t8.tiLeNoTrenMua === 0.65, t8)
    ok('11b. tỉ lệ đơn chịu 2/3', t8.soDonChiu === 2 && t8.tiLeDonChiu === 0.667, t8)

    /* 12 — TRUNG BÌNH CHIA CHO THÁNG CÓ MUA. Khách chỉ mua 2 tháng trong 12:
     * chia cho 12 ra "166/tháng" là số ảo, đọc nhầm thành khách nhỏ. */
    const m12 = gomTheoThang([
        pt('1', 1000, 'completed', '2026-03-10T03:00:00Z'),
        pt('2', 1000, 'completed', '2026-08-10T03:00:00Z'),
    ], NAY2, 12)
    ok('12. TB tiền/tháng chia cho 2 tháng CÓ mua = 1000 (không phải 166)', m12.tongHop.tbTienMuaThang === 1000 && m12.tongHop.soThangCoMua === 2, m12.tongHop)

    // 13 — cửa sổ 12 tháng: phiếu 13 tháng trước bị loại; months=0 lấy tất
    const cu = pt('cu', 999, 'completed', '2025-07-15T03:00:00Z')
    const moi = pt('moi', 1, 'completed', '2026-08-10T03:00:00Z')
    ok('13. cửa sổ 12 tháng loại phiếu 13 tháng trước', gomTheoThang([cu, moi], NAY2, 12).thang.length === 1)
    ok('13b. months=0 → lấy tất cả', gomTheoThang([cu, moi], NAY2, 0).thang.length === 2)

    // 14 — voided/rác không vào; rỗng không nổ
    ok('14. voided không tính; rỗng → 0 tháng',
        gomTheoThang([pt('v', 5, 'voided', '2026-08-10T03:00:00Z')], NAY2).thang.length === 0
        && gomTheoThang([], NAY2).tongHop.tbTienMuaThang === 0)


    /* ── CA THIÊN HƯNG (chủ shop bắt lỗi 18/08/2026, HUTI) ─────────────────
     * "xem có kỳ không, người ta mua đâu trả đó mà". Sổ Customer.debt = 0 nhưng
     * 31 phiếu 'partial' amountReceived=0 (khách trả bằng phiếu thu CHUNG / trả
     * gộp — KiotViet ghi vào sổ, không gắn từng phiếu). Bản đầu ra "Rủi ro — nợ
     * già nhất 608 ngày, 629 triệu treo". SAI: sổ là nguồn sự thật. */
    console.log('\n▶ Sổ là nguồn sự thật — phiếu treo không được đè lên sổ\n')
    const th = tinhSucKhoeTaiChinh([
        p('1', 8_086_080, 'partial', 1),      // hôm qua, chưa gắn phiếu thu
        p('2', 4_204_200, 'partial', 3),
        p('3', 25_920_000, 'partial', 608),   // rất cũ, cũng chưa gắn
        p('4', 1_000_000, 'completed', 10),
    ], 0, NAY)                                 // ← SỔ = 0
    ok('15. sổ 0 + nhiều phiếu treo → xepHang = tot (KHÔNG rui-ro)', th.xepHang === 'tot', th.xepHang)
    ok('15b. ngayNoLauNhat = null (không có "608 ngày")', th.ngayNoLauNhat === null && th.ngayNoGanNhat === null, [th.ngayNoGanNhat, th.ngayNoLauNhat])
    ok('15c. cờ phieuTreoKhongPhaiNo = true, soPhieuTreo vẫn đếm 3', th.phieuTreoKhongPhaiNo === true && th.soPhieuTreo === 3, th)
    ok('15d. lyDo nói rõ "chưa gắn phiếu thu", không nói "nợ"', th.lyDo.some(x => /chưa gắn phiếu thu/.test(x)) && !th.lyDo.some(x => /^Đang nợ|nợ già/i.test(x)), th.lyDo)

    /* 15e — CHIỀU NGƯỢC: sổ CÓ nợ thật thì phiếu treo và tuổi nợ PHẢI hiện —
     * đừng sửa quá tay thành "không bao giờ báo nợ". */
    const co = tinhSucKhoeTaiChinh([p('1', 500_000, 'partial', 95)], 500_000, NAY)
    ok('15e. sổ 500k + phiếu treo 95 ngày → rui-ro, ngayNoLauNhat = 95', co.xepHang === 'rui-ro' && co.ngayNoLauNhat === 95 && co.phieuTreoKhongPhaiNo === false, co)


    /* ── FIFO NEO VÀO SỔ (Hiệp Hòa, HUTI 18/08/2026) ───────────────────────
     * Sổ 126,6tr; phiếu treo: 300 ngày trước 100tr (ĐÃ trả gộp), 200 ngày 80tr
     * (đã trả gộp), 10 ngày 90tr, 1 ngày 40tr. Tổng treo 310tr > sổ. Kế toán:
     * tiền trả trước trừ phiếu cũ trước → nợ THẬT là 2 phiếu mới nhất
     * (90+40=130 ≥ 126,6). Tuổi nợ = 10 ngày, KHÔNG phải 300. */
    console.log('\n▶ Tuổi nợ theo FIFO neo vào sổ\n')
    const hh = tinhSucKhoeTaiChinh([
        p('a', 100_000_000, 'partial', 300),
        p('b',  80_000_000, 'partial', 200),
        p('c',  90_000_000, 'partial', 10),
        p('d',  40_000_000, 'partial', 1),
    ], 126_600_000, NAY)
    ok('16. sổ 126,6tr < treo 310tr → tuổi nợ = 10 (phiếu 300 ngày đã trả gộp, không tính)', hh.ngayNoLauNhat === 10, hh.ngayNoLauNhat)
    ok('16b. nợ gần nhất = 1', hh.ngayNoGanNhat === 1, hh.ngayNoGanNhat)
    ok('16c. tienTreoTheoPhieu vẫn = 310tr (thô, để đối chiếu)', hh.tienTreoTheoPhieu === 310_000_000, hh.tienTreoTheoPhieu)
    ok('16d. soLechPhieu = true (sổ với phiếu lệch xa)', hh.soLechPhieu === true, hh.soLechPhieu)
    ok('16e. xếp hạng theo tuổi nợ THẬT (10 ngày) → theo-doi, KHÔNG rui-ro', hh.xepHang === 'theo-doi', hh.xepHang)

    // 16f — CHIỀU NGƯỢC: sổ LỚN HƠN tổng treo (nợ đầu kỳ nhập tay) → tuổi nợ = phiếu cũ nhất còn treo
    const dk = tinhSucKhoeTaiChinh([p('a', 50_000, 'partial', 120), p('b', 30_000, 'partial', 5)], 500_000, NAY)
    ok('16f. sổ 500k > treo 80k → tuổi nợ = 120 (phủ hết phiếu), soLechPhieu báo phần ngoài phiếu', dk.ngayNoLauNhat === 120 && dk.soLechPhieu === true, dk)

    // 16g — sổ đúng bằng một phiếu ở giữa: chỉ tính phiếu mới tới đó
    const gi = tinhSucKhoeTaiChinh([p('a', 100, 'partial', 90), p('b', 100, 'partial', 30), p('c', 100, 'partial', 3)], 200, NAY)
    ok('16g. sổ 200 = 2 phiếu mới nhất → tuổi nợ 30, không phải 90', gi.ngayNoLauNhat === 30, gi.ngayNoLauNhat)


    /* ── THÁNG cũng neo vào sổ (Thiên Hưng T7: 15 phiếu treo 427tr nhưng sổ 0) ── */
    console.log('\n▶ Nợ phát sinh theo tháng neo vào sổ\n')
    const th7 = gomTheoThang([
        pt('a', 200_000_000, 'partial', '2026-07-05T03:00:00Z'),
        pt('b', 227_000_000, 'partial', '2026-07-20T03:00:00Z'),
        pt('c', 144_000_000, 'partial', '2026-08-10T03:00:00Z'),
    ], NAY2, 12, 0)                                            // ← SỔ = 0
    const t7 = th7.thang.find(t => t.thang === '2026-07')!
    ok('17. sổ 0 → T7 nợ phát sinh = 0 dù 2 phiếu treo 427tr; soDonChiu vẫn 2 (mô tả)', t7.tienNoPhatSinh === 0 && t7.soDonChiu === 2 && t7.tiLeNoTrenMua === 0, t7)

    // 17b — sổ 130tr → chỉ phiếu MỚI NHẤT (144tr, T8) là nợ thật; T7 = 0
    const hh2 = gomTheoThang([
        pt('a', 200_000_000, 'partial', '2026-07-05T03:00:00Z'),
        pt('b', 227_000_000, 'partial', '2026-07-20T03:00:00Z'),
        pt('c', 144_000_000, 'partial', '2026-08-10T03:00:00Z'),
    ], NAY2, 12, 130_000_000)
    ok('17b. sổ 130tr → T8 nợ 144tr (phiếu mới nhất), T7 = 0 (đã trả gộp)',
        hh2.thang.find(t => t.thang === '2026-08')!.tienNoPhatSinh === 144_000_000 && hh2.thang.find(t => t.thang === '2026-07')!.tienNoPhatSinh === 0, hh2.thang.map(t => t.thang + ':' + t.tienNoPhatSinh))

    // 17c — KHÔNG truyền duNo → hành vi cũ (tính mọi partial) — để chỗ khác gọi không đổi
    const cu2 = gomTheoThang([pt('a', 100, 'partial', '2026-08-01T03:00:00Z')], NAY2, 12)
    ok('17c. không truyền duNo → tính mọi partial như cũ', cu2.thang[0].tienNoPhatSinh === 100)


    console.log(`\n${dat}/${dat + hong} ca đạt`)
    if (hong) process.exit(1)
}
main()
