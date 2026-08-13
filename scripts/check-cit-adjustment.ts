/**
 * Kiểm chứng QUYẾT TOÁN THUẾ TNDN CÓ ĐIỀU CHỈNH.
 *
 * Chạy:  npx tsx scripts/check-cit-adjustment.ts
 *
 * Phần chuyển lỗ là chỗ dễ sai nhất và sai theo hướng nguy hiểm (ra số thuế
 * THẤP hơn thực tế): lấy tổng lỗ trừ một lần thay vì mô phỏng từng năm, quên lỗ
 * đã bù ở năm giữa, quên lỗ quá 5 năm thì mất quyền chuyển. Ba lỗi đó đều có ca
 * riêng ở đây.
 */

import {
    quyetToanTndn, phanBoLoChuyen, THUE_SUAT_TNDN, SO_NAM_DUOC_CHUYEN_LO,
} from '../src/lib/citAdjustment'

let dat = 0, hong = 0
function ok(ten: string, dk: boolean, thucTe?: any) {
    if (dk) { dat++; console.log(`  ✓ ${ten}`) }
    else { hong++; console.log(`  ✗ ${ten}${thucTe !== undefined ? ` — thực tế: ${JSON.stringify(thucTe)}` : ''}`) }
}

const khoanBiLoai = [
    { lyDo: 'Chi không có hóa đơn', canCu: 'Điều 4 TT 96/2015', chiPhiBiLoai: 50_000_000, vatBiLoai: 0 },
    { lyDo: 'Thanh toán tiền mặt từ 5 triệu', canCu: 'Luật GTGT 48/2024', chiPhiBiLoai: 20_000_000, vatBiLoai: 2_000_000 },
]

async function main() {
    console.log('\n═══ QUYẾT TOÁN TNDN CÓ ĐIỀU CHỈNH ═══\n')

    console.log('▸ Có khoản bị loại, không có lỗ')
    const a = quyetToanTndn({
        nam: 2026,
        loiNhuanKeToan: 100_000_000,
        khoanBiLoai,
        laiLoTheoNam: new Map([[2024, 30_000_000], [2025, 40_000_000], [2026, 100_000_000]]),
        daTamNop: 10_000_000,
    })
    ok('cộng đủ khoản bị loại vào điều chỉnh tăng', a.tongDieuChinhTang === 72_000_000, a.tongDieuChinhTang)
    ok('VAT không được khấu trừ cũng bị loại theo khoản chi',
        a.dieuChinhTang[1].giaTri === 22_000_000, a.dieuChinhTang[1])
    ok('thu nhập chịu thuế = lãi kế toán + điều chỉnh tăng',
        a.thuNhapChiuThue === 172_000_000, a.thuNhapChiuThue)
    ok('không có lỗ để chuyển', a.tongLoChuyen === 0)
    ok('thuế = thu nhập tính thuế × 20%', a.thueTndnPhaiNop === 34_400_000, a.thueTndnPhaiNop)
    ok('còn phải nộp = thuế − đã tạm nộp', a.conPhaiNop === 24_400_000, a.conPhaiNop)
    ok('nêu rõ cách tính cũ khai thiếu bao nhiêu',
        a.chenhSoVoiCachTinhThieu === 14_400_000, a.chenhSoVoiCachTinhThieu)
    ok('cảnh báo về khoản chi không được trừ',
        a.canhBao.some(c => c.includes('không được trừ')), a.canhBao)
    ok('mỗi dòng điều chỉnh đều có căn cứ', a.dieuChinhTang.every(d => !!d.canCu))
    ok('điều chỉnh giảm để 0 và nói rõ lý do',
        a.tongDieuChinhGiam === 0 && a.ghiChu.includes('điều chỉnh giảm'))

    console.log('\n▸ Sổ sạch, không có gì để điều chỉnh')
    const b = quyetToanTndn({
        nam: 2026, loiNhuanKeToan: 100_000_000, khoanBiLoai: [],
        laiLoTheoNam: new Map([[2026, 100_000_000]]), daTamNop: 0,
    })
    ok('không điều chỉnh thì bằng đúng cách tính cũ', b.chenhSoVoiCachTinhThieu === 0)
    ok('thuế 20% trên lãi kế toán', b.thueTndnPhaiNop === 20_000_000, b.thueTndnPhaiNop)
    ok('không cảnh báo về chi không được trừ',
        !b.canhBao.some(c => c.includes('không được trừ')))

    console.log('\n▸ Chuyển lỗ — mô phỏng từng năm')
    const lai = new Map<number, number>([
        [2021, -100_000_000],   // lỗ 100tr
        [2022, 30_000_000],     // bù 30tr → còn 70tr
        [2023, 20_000_000],     // bù 20tr → còn 50tr
        [2024, 0],
        [2025, 0],
    ])
    const c = phanBoLoChuyen(lai, 2026, 80_000_000)
    ok('chỉ chuyển phần lỗ CÒN LẠI sau khi đã bù các năm giữa',
        c.tongLoChuyen === 50_000_000, c.tongLoChuyen)
    const dong = c.loChuyen.find(l => l.namPhatSinh === 2021)!
    ok('ghi đúng lỗ gốc', dong.loGoc === 100_000_000, dong)
    ok('ghi đúng phần đã chuyển ở các năm trước', dong.daChuyenTruoc === 50_000_000, dong)
    ok('hạn chuyển đến năm phát sinh + 5', dong.hanChuyenDen === 2026, dong)
    ok('sau khi bù thì hết lỗ', dong.conLai === 0, dong)

    console.log('\n▸ Lỗ quá 5 năm thì mất quyền chuyển')
    const quaHan = new Map<number, number>([[2019, -200_000_000], [2020, 0], [2021, 0], [2022, 0], [2023, 0], [2024, 0], [2025, 0]])
    const d = phanBoLoChuyen(quaHan, 2026, 100_000_000)
    ok('lỗ năm 2019 không còn được chuyển vào 2026', d.tongLoChuyen === 0, d)

    const conHan = new Map<number, number>([[2021, -200_000_000], [2022, 0], [2023, 0], [2024, 0], [2025, 0]])
    const e = phanBoLoChuyen(conHan, 2026, 100_000_000)
    ok('lỗ năm 2021 vẫn được chuyển vào 2026 (đúng năm cuối)', e.tongLoChuyen === 100_000_000, e)
    const f = phanBoLoChuyen(conHan, 2027, 100_000_000)
    ok('sang 2027 thì lỗ 2021 hết hạn', f.tongLoChuyen === 0, f)

    console.log('\n▸ Lỗ nhiều năm — bù năm cũ trước')
    const nhieuNam = new Map<number, number>([
        [2023, -50_000_000],
        [2024, -30_000_000],
        [2025, 0],
    ])
    const g = phanBoLoChuyen(nhieuNam, 2026, 60_000_000)
    ok('bù hết lỗ cũ nhất trước', g.loChuyen[0].namPhatSinh === 2023 && g.loChuyen[0].chuyenNamNay === 50_000_000, g.loChuyen)
    ok('phần còn lại bù sang lỗ năm sau', g.loChuyen[1].chuyenNamNay === 10_000_000, g.loChuyen)
    ok('không chuyển quá thu nhập của năm', g.tongLoChuyen === 60_000_000)
    ok('lỗ chưa bù hết vẫn còn treo', g.loChuyen[1].conLai === 20_000_000, g.loChuyen[1])

    console.log('\n▸ Quyết toán năm có lỗ chuyển sang')
    const h = quyetToanTndn({
        nam: 2026,
        loiNhuanKeToan: 80_000_000,
        khoanBiLoai: [],
        laiLoTheoNam: new Map([[2024, -30_000_000], [2025, 0], [2026, 80_000_000]]),
        daTamNop: 0,
    })
    ok('trừ lỗ trước khi tính thuế', h.thuNhapTinhThue === 50_000_000, h.thuNhapTinhThue)
    ok('thuế tính trên thu nhập sau chuyển lỗ', h.thueTndnPhaiNop === 10_000_000, h.thueTndnPhaiNop)

    console.log('\n▸ Năm quyết toán bị lỗ')
    const i = quyetToanTndn({
        nam: 2026, loiNhuanKeToan: -40_000_000, khoanBiLoai: [],
        laiLoTheoNam: new Map([[2026, -40_000_000]]), daTamNop: 0,
    })
    ok('không tính thuế khi lỗ', i.thueTndnPhaiNop === 0 && i.thuNhapTinhThue === 0)
    ok('không chuyển lỗ vào chính năm lỗ', i.tongLoChuyen === 0)
    ok('nhắc kê phụ lục 03-2A/TNDN để giữ quyền chuyển lỗ',
        i.canhBao.some(c => c.includes('03-2A')), i.canhBao)
    ok('nói rõ hạn chuyển lỗ tới năm nào',
        i.canhBao.some(c => c.includes('2031')), i.canhBao)

    console.log('\n▸ Lỗ sắp hết hạn')
    const j = quyetToanTndn({
        nam: 2026, loiNhuanKeToan: 10_000_000, khoanBiLoai: [],
        laiLoTheoNam: new Map([[2021, -500_000_000], [2026, 10_000_000]]), daTamNop: 0,
    })
    ok('cảnh báo lỗ sắp mất quyền chuyển',
        j.canhBao.some(c => c.includes('hết hạn chuyển')), j.canhBao)
    ok('nêu số tiền lỗ sẽ mất', j.canhBao.some(c => c.includes('490.000.000')), j.canhBao)

    console.log('\n▸ Nộp thừa / hạn nộp')
    // Thuế phải nộp 10tr, mới tạm nộp 4tr → còn phải nộp 6tr
    const k = quyetToanTndn({
        nam: 2026, loiNhuanKeToan: 50_000_000, khoanBiLoai: [],
        laiLoTheoNam: new Map([[2026, 50_000_000]]), daTamNop: 4_000_000,
    })
    ok('còn phải nộp tính đúng', k.conPhaiNop === 6_000_000, k.conPhaiNop)
    ok('nhắc hạn nộp quyết toán 31/3 năm sau',
        k.canhBao.some(c => c.includes('31/3/2027')), k.canhBao)
    const l = quyetToanTndn({
        nam: 2026, loiNhuanKeToan: 50_000_000, khoanBiLoai: [],
        laiLoTheoNam: new Map([[2026, 50_000_000]]), daTamNop: 30_000_000,
    })
    ok('nộp thừa thì nhắc bù trừ/hoàn theo Điều 60',
        l.canhBao.some(c => c.includes('Điều 60')), l.canhBao)

    console.log('\n▸ Hằng số luật')
    ok('thuế suất phổ thông 20%', THUE_SUAT_TNDN === 0.2)
    ok('thời hạn chuyển lỗ 5 năm', SO_NAM_DUOC_CHUYEN_LO === 5)
    ok('ghi chú nhắc đối chiếu với tờ khai đã nộp',
        a.ghiChu.includes('03-2A/TNDN') && a.ghiChu.includes('lấy theo tờ khai'))

    console.log(`\n${dat}/${dat + hong} ca đạt`)
    if (hong) process.exit(1)
}

main().catch(e => { console.error(e); process.exit(1) })
