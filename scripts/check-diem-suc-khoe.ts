/**
 * Kiểm ĐIỂM SỨC KHOẺ TÀI CHÍNH KHÁCH — npx tsx scripts/check-diem-suc-khoe.ts
 *
 * Điểm này chủ shop dùng để quyết có bán chịu tiếp hay không, và để xếp 14 khách
 * cạnh nhau. Hai chiều đều nguy hiểm: chấm CAO cho khách nợ già là mở đường bán
 * chịu thêm; chấm THẤP cho khách trả gộp (sổ 0) là tố oan — đúng vụ Thiên Hưng
 * 18/08 (629 triệu "phiếu treo" mà sổ 0, chủ shop bắt lỗi).
 *
 * Bộ này nặng nhất ở hai chỗ:
 *   - Điểm KHÔNG ĐƯỢC CÃI NHÃN xepHang (chặn trần rủi ro ≤ 39, theo dõi ≤ 59).
 *   - Sổ 0 thì mọi thành phần nợ phải đủ điểm, bất kể phiếu treo.
 */

import { tinhDiemSucKhoe, hangCuaDiem, TRAN_THEO_XEP_HANG, TOI_DA_MOI_PHAN, tinhTronBo } from '../src/lib/diemSucKhoeKhach'
import type { HoSoSucKhoe, TongHopKyKhach } from '../src/lib/sucKhoeTaiChinhKhach'
import type { ChiSoMoRong } from '../src/lib/chiSoKhachMoRong'

let dat = 0, hong = 0
function ok(ten: string, dk: boolean, thucTe?: any) {
    if (dk) { dat++; console.log(`  ✓ ${ten}`) }
    else { hong++; console.log(`  ✗ ${ten}${thucTe !== undefined ? ` — ${JSON.stringify(thucTe)}` : ''}`) }
}

// ── Dựng đầu vào gọn ─────────────────────────────────────────────────────────
function hoSo(p: Partial<HoSoSucKhoe> = {}): HoSoSucKhoe {
    return {
        duNo: 0, soPhieuTreo: 0, tienTreoTheoPhieu: 0, ngayNoGanNhat: null, ngayNoLauNhat: null,
        phieuTreoGanNhat: null, tiLeMuaChiu: 0, soLechPhieu: false, phieuTreoKhongPhaiNo: false,
        xepHang: 'tot', lyDo: [], ...p,
    }
}
function ky(p: Partial<TongHopKyKhach> = {}): TongHopKyKhach {
    return { soThangCoMua: 6, tbTienMuaThang: 5_000_000, tbSoDonThang: 4, tiLeNoTrenMuaKy: 0, muaDau: '2026-01-01', muaCuoi: '2026-08-01', ...p }
}
function mr(p: { noTrenTongMua?: number; xuHuong?: ChiSoMoRong['xuHuong']['nhan']; dangImLau?: boolean; ngayTuLanCuoi?: number } = {}): ChiSoMoRong {
    return {
        nhipMua: { tbNgayGiuaHaiLan: 7, ngayTuLanCuoi: p.ngayTuLanCuoi ?? 3, dangImLau: p.dangImLau ?? false, soNgayCoMua: 20 },
        doLonDon: { tb: 1_000_000, trungVi: 900_000, lonNhat: 3_000_000, heSo3ThangGanNhat: 1 },
        xuHuong: { tien3ThangGan: 10, tien3ThangTruoc: 10, tangTruongTien: 0, don3ThangGan: 5, don3ThangTruoc: 5, tangTruongDon: 0, nhan: p.xuHuong ?? 'on-dinh' },
        noSauHon: { noTrenTongMua: p.noTrenTongMua ?? 0, noBangMayThangMua: null, bacTuoi: { b0_30: 0, b31_60: 0, b61_90: 0, tren90: 0 }, ngoaiPhieu: 0 },
        thoiQuenTra: { tbNgayTra: null, soPhieuTinh: 0 },
    }
}
const M = TOI_DA_MOI_PHAN

function main() {
    console.log('\n▶ Điểm sức khoẻ tài chính khách\n')

    // 1 — khách lý tưởng: không nợ, mua tăng, đều → A và đủ 100
    const a = tinhDiemSucKhoe(hoSo(), ky(), mr({ xuHuong: 'tang' }), 50)
    ok('1. không nợ + mua tăng → 100 điểm, hạng A', a.tong === 100 && a.hang === 'A', { tong: a.tong, hang: a.hang })
    ok('1b. bốn thành phần cộng đúng 100', a.thanhPhan.reduce((s, t) => s + t.diem, 0) === 100, a.thanhPhan.map(t => t.diem))
    ok('1c. độ tin cậy cao với 50 đơn', a.doTinCay === 'cao', a.doTinCay)

    /* 2 — CA THIÊN HƯNG: sổ 0 nhưng 31 phiếu treo 629 triệu (trả gộp).
     * Mọi thành phần NỢ phải đủ điểm — chấm thấp là tố oan lần nữa. */
    const th = tinhDiemSucKhoe(
        hoSo({ duNo: 0, soPhieuTreo: 31, tienTreoTheoPhieu: 629_000_000, phieuTreoKhongPhaiNo: true, tiLeMuaChiu: 1 }),
        ky({ tiLeNoTrenMuaKy: 1 }),   // theo phiếu thì "100% nợ" — bẫy
        mr({ noTrenTongMua: 0.9 }),    // theo phiếu thì "nợ 90% tổng mua" — bẫy
        200,
    )
    const noTH = th.thanhPhan.filter(t => t.ma !== 'xu-huong')
    ok('2. THIÊN HƯNG: sổ 0 + trả gộp → ba thành phần nợ đều ĐỦ điểm',
        noTH.every(t => t.diem === M), noTH.map(t => `${t.ma}=${t.diem}`))
    ok('2b. …và giải thích nói rõ "trả gộp", không nói "nợ"',
        /trả gộp/i.test(th.thanhPhan.find(t => t.ma === 'mua-chiu')!.giaiThich), th.thanhPhan.find(t => t.ma === 'mua-chiu')!.giaiThich)

    /* 3 — CHẶN TRẦN: xếp hạng rủi ro thì điểm ≤ 39 dù các thành phần khác đẹp.
     * Điểm nói "B – Khá" cạnh nhãn "Rủi ro" là cùng màn hình nói hai kiểu. */
    const rr = tinhDiemSucKhoe(
        hoSo({ duNo: 5_000_000, ngayNoLauNhat: 95, xepHang: 'rui-ro' }),
        ky({ tiLeNoTrenMuaKy: 0.05 }),
        mr({ noTrenTongMua: 0.05, xuHuong: 'tang' }),
        80,
    )
    ok('3. rủi ro → điểm ≤ 39 bất kể thành phần khác', rr.tong !== null && rr.tong <= TRAN_THEO_XEP_HANG['rui-ro']!, { tong: rr.tong, tho: rr.tho })
    ok('3b. …hạng D', rr.hang === 'D', rr.hang)
    ok('3c. …và NÓI RA là bị chặn kèm điểm thô', rr.biChanTran && rr.tho !== null && rr.tho > rr.tong! && /Điểm thô/.test(rr.lyDoChan || ''), rr.lyDoChan)

    const td = tinhDiemSucKhoe(hoSo({ duNo: 5_000_000, ngayNoLauNhat: 45, xepHang: 'theo-doi' }), ky(), mr({ xuHuong: 'tang' }), 80)
    ok('3d. theo dõi → điểm ≤ 59', td.tong !== null && td.tong <= 59, td.tong)

    // 3f — NÉN VÀO DẢI, KHÔNG CẮT PHẲNG (18/08): cùng nhãn theo dõi, khách thô cao hơn phải điểm cao hơn
    const tdTot = tinhDiemSucKhoe(hoSo({ duNo: 1_000_000, ngayNoLauNhat: 5, xepHang: 'theo-doi' }), ky({ tiLeNoTrenMuaKy: 0.02 }), mr({ noTrenTongMua: 0.02, xuHuong: 'tang' }), 80)
    const tdKem = tinhDiemSucKhoe(hoSo({ duNo: 5_000_000, ngayNoLauNhat: 60, xepHang: 'theo-doi' }), ky({ tiLeNoTrenMuaKy: 0.5 }), mr({ noTrenTongMua: 0.3, xuHuong: 'giam' }), 80)
    ok('3f. theo dõi: thô cao hơn → điểm cao hơn (không còn cả nhóm = 59)', tdTot.tong! > tdKem.tong! && tdTot.tho! > tdKem.tho!, { tot: [tdTot.tho, tdTot.tong], kem: [tdKem.tho, tdKem.tong] })
    ok('3g. …cả hai vẫn ≤ 59 và ≥ 40 khi thô ≥ 40 (dải C)', tdTot.tong! <= 59 && tdKem.tong! <= 59 && tdTot.tong! >= 40 && (tdKem.tho! < 40 || tdKem.tong! >= 40))
    ok('3h. thô 100 + theo dõi → đúng 59; lý do nói "nén vào dải"', tdTot.tho === 100 ? tdTot.tong === 59 : true, tdTot.tong)
    ok('3i. rủi ro: thô cao hơn → điểm cao hơn, đều ≤ 39', (() => { const a2 = tinhDiemSucKhoe(hoSo({ duNo: 1_000_000, ngayNoLauNhat: 95, xepHang: 'rui-ro' }), ky(), mr({ xuHuong: 'tang' }), 80); const b2 = tinhDiemSucKhoe(hoSo({ duNo: 9_000_000, ngayNoLauNhat: 300, xepHang: 'rui-ro' }), ky({ tiLeNoTrenMuaKy: 0.9 }), mr({ noTrenTongMua: 0.5, xuHuong: 'giam' }), 80); return a2.tong! > b2.tong! && a2.tong! <= 39 && b2.tong! <= 39 })())
    ok('3j. lý do nén có chữ "Điểm thô" và "nén"', /Điểm thô/.test(td.lyDoChan || '') && /nén/.test(td.lyDoChan || ''), td.lyDoChan)
    // 3e — CHIỀU IM: không bị chặn thì biChanTran=false, lyDoChan=null
    ok('3e. hạng "tot" không chặn → biChanTran=false, lyDoChan=null', !a.biChanTran && a.lyDoChan === null)

    // 4 — tuổi nợ giảm tuyến tính về 0 tại 90 ngày
    const t45 = tinhDiemSucKhoe(hoSo({ duNo: 1, ngayNoLauNhat: 45, xepHang: 'theo-doi' }), ky(), mr(), 20)
    ok('4. tuổi nợ 45 ngày → thành phần tuổi nợ ≈ nửa', Math.abs(t45.thanhPhan.find(t => t.ma === 'tuoi-no')!.diem - M / 2) <= 1, t45.thanhPhan.find(t => t.ma === 'tuoi-no')!.diem)
    const t120 = tinhDiemSucKhoe(hoSo({ duNo: 1, ngayNoLauNhat: 120, xepHang: 'rui-ro' }), ky(), mr(), 20)
    ok('4b. tuổi nợ 120 ngày → thành phần tuổi nợ = 0', t120.thanhPhan.find(t => t.ma === 'tuoi-no')!.diem === 0)

    // 5 — gánh nợ: 40% tổng mua trở lên → 0; 20% → nửa
    const g40 = tinhDiemSucKhoe(hoSo({ duNo: 1, xepHang: 'tot' }), ky(), mr({ noTrenTongMua: 0.4 }), 20)
    ok('5. nợ = 40% tổng mua → gánh nợ = 0', g40.thanhPhan.find(t => t.ma === 'ganh-no')!.diem === 0)
    const g20 = tinhDiemSucKhoe(hoSo({ duNo: 1, xepHang: 'tot' }), ky(), mr({ noTrenTongMua: 0.2 }), 20)
    ok('5b. nợ = 20% tổng mua → gánh nợ ≈ nửa', Math.abs(g20.thanhPhan.find(t => t.ma === 'ganh-no')!.diem - M / 2) <= 1)

    // 5c/5d — KHÔNG ĐỌC ĐƯỢC ≠ KHÔNG CÓ (18/08): có nợ mà không neo được tuổi / chưa thấy mua → TRUNG TÍNH, không đủ điểm
    const mu = tinhDiemSucKhoe(hoSo({ duNo: 16_912_097, ngayNoLauNhat: null, xepHang: 'theo-doi' }), ky(), mr({ noTrenTongMua: 0, noBangMayThangMua: null }), 1)
    const muTuoi = mu.thanhPhan.find(t => t.ma === 'tuoi-no')!, muGanh = mu.thanhPhan.find(t => t.ma === 'ganh-no')!
    ok('5c. có nợ + tuổi nợ null → tuổi nợ ≈ nửa, giải thích nói "trung tính"', Math.abs(muTuoi.diem - M / 2) <= 1 && /trung tính/.test(muTuoi.giaiThich), muTuoi)
    ok('5d. có nợ + chưa thấy mua (noBangMayThangMua null) → gánh nợ ≈ nửa, không phải đủ 25', Math.abs(muGanh.diem - M / 2) <= 1 && /trung tính/.test(muGanh.giaiThich), muGanh)
    ok('5e. …tổng thô của khách này THẤP hơn khách sạch (không còn được chấm như khách sạch)', mu.tho! < a.tho!, { mu: mu.tho, sach: a.tho })
    const khongNo = tinhDiemSucKhoe(hoSo({ duNo: 0, ngayNoLauNhat: null, xepHang: 'tot' }), ky(), mr({ noBangMayThangMua: null }), 5)
    ok('5f. KHÔNG nợ + không neo được → vẫn đủ điểm (chỉ áp trung tính khi CÓ nợ)', khongNo.thanhPhan.find(t => t.ma === 'tuoi-no')!.diem === M && khongNo.thanhPhan.find(t => t.ma === 'ganh-no')!.diem === M)
    // 6 — xu hướng: giảm + im lâu bị trừ; im lâu không đưa về âm
    const gi = tinhDiemSucKhoe(hoSo(), ky(), mr({ xuHuong: 'giam', dangImLau: true, ngayTuLanCuoi: 40 }), 20)
    const xh = gi.thanhPhan.find(t => t.ma === 'xu-huong')!
    ok('6. giảm + im lâu → xu hướng bị trừ mạnh nhưng ≥ 0', xh.diem >= 0 && xh.diem < M * 0.4, xh.diem)
    ok('6b. giải thích nêu số ngày im', /im 40 ngày/.test(xh.giaiThich), xh.giaiThich)
    ok('6c. không nợ + mua giảm + im lâu → vẫn KHÔNG dưới C (không thể "rủi ro" khi sổ 0)',
        gi.tong !== null && gi.tong >= 40, gi.tong)

    // 7 — chưa đủ dữ liệu / 0 đơn → không chấm, không bịa hạng
    const cd = tinhDiemSucKhoe(hoSo({ xepHang: 'chua-du-du-lieu' }), ky(), mr(), 1)
    ok('7. xepHang chưa đủ dữ liệu → tong=null, hang=null', cd.tong === null && cd.hang === null, cd)
    const k0 = tinhDiemSucKhoe(hoSo(), ky(), mr(), 0)
    ok('7b. 0 đơn → không chấm', k0.tong === null && /chưa có đơn/i.test(k0.lyDoTinCay), k0.lyDoTinCay)

    // 8 — độ tin cậy theo số đơn, không giấu
    ok('8. 2 đơn → tin cậy thấp', tinhDiemSucKhoe(hoSo(), ky(), mr(), 2).doTinCay === 'thap')
    ok('8b. 5 đơn → tin cậy vừa', tinhDiemSucKhoe(hoSo(), ky(), mr(), 5).doTinCay === 'vua')

    // 9 — dữ liệu méo: thiếu tongHopKy / moRong không nổ
    const meo = tinhDiemSucKhoe(hoSo(), null, undefined, 10)
    ok('9. thiếu tongHopKy/moRong → vẫn ra điểm, không nổ', meo.tong !== null, meo.tong)

    // 10 — hangCuaDiem đúng ranh giới
    ok('10. 80→A, 79→B, 60→B, 59→C, 40→C, 39→D',
        hangCuaDiem(80).hang === 'A' && hangCuaDiem(79).hang === 'B' && hangCuaDiem(60).hang === 'B'
        && hangCuaDiem(59).hang === 'C' && hangCuaDiem(40).hang === 'C' && hangCuaDiem(39).hang === 'D')

    // 11 — mọi thành phần đều trong [0, toiDa] (không âm, không vượt)
    const tatCa = [a, th, rr, td, t45, t120, g40, g20, gi, meo]
    ok('11. mọi thành phần trong [0, toiDa]', tatCa.every(k => k.thanhPhan.every(t => t.diem >= 0 && t.diem <= t.toiDa)))

    /* 12 — ĐIỂM KHÔNG ĐỔI THEO KỲ HIỂN THỊ. Chi tiết cho chọn 6/12/tất cả tháng, tổng quan
     * luôn 12; nếu điểm đi theo kỳ thì cùng khách hai điểm. Dựng khách có nợ phát sinh
     * dồn ở 7–12 tháng trước để tỉ lệ nợ/mua 6 tháng ≠ 12 tháng. */
    const nay = new Date('2026-08-18T05:00:00Z')
    const ph = (thangTruoc: number, total: number, daTra: number) => {
        const d = new Date(nay); d.setUTCMonth(d.getUTCMonth() - thangTruoc)
        return { id: 'p' + thangTruoc + '-' + total, total, status: daTra >= total ? 'completed' : 'partial', transactionDate: d, createdAt: d, daTra }
    }
    const phieuKy = [ph(1, 1_000_000, 1_000_000), ph(2, 1_000_000, 1_000_000), ph(9, 5_000_000, 0), ph(10, 5_000_000, 0)]
    const k6 = tinhTronBo(phieuKy, 10_000_000, nay, 6, 40).diem
    const k12 = tinhTronBo(phieuKy, 10_000_000, nay, 12, 40).diem
    const kAll = tinhTronBo(phieuKy, 10_000_000, nay, 0, 40).diem
    ok('12. điểm giống nhau dù kỳ hiển thị 6 / 12 / tất cả', k6.tong === k12.tong && k12.tong === kAll.tong, { k6: k6.tong, k12: k12.tong, kAll: kAll.tong })
    ok('12b. …nhưng bảng tháng vẫn theo kỳ chọn (6 tháng ít dòng hơn 12)',
        tinhTronBo(phieuKy, 10_000_000, nay, 6, 40).theoThang.thang.length < tinhTronBo(phieuKy, 10_000_000, nay, 12, 40).theoThang.thang.length)

    console.log(`\n${dat}/${dat + hong} ca đạt`)
    if (hong) process.exit(1)
}

main()
