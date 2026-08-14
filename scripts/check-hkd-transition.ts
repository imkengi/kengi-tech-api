/**
 * Kiểm chứng BỎ THUẾ KHOÁN 2026 — hộ kinh doanh phải nộp bao nhiêu.
 *
 * Chạy:  npx tsx scripts/check-hkd-transition.ts
 *
 * Module này nói với chủ hộ một câu rất nặng: "sang năm bạn nộp thêm X triệu".
 * Nói cao thì họ hoảng và tăng giá vô cớ; nói thấp thì tới lúc nộp mới ngã ngửa.
 * Nên bộ test soi kỹ ngưỡng, tỷ lệ ngành, và các ca PHẢI TỪ CHỐI SO SÁNH.
 */

import { tinhChuyenDoiHKD, NGUONG_HDDT_MAY_TINH_TIEN } from '../src/lib/hkdTransition'

let dat = 0, hong = 0
function ok(ten: string, dk: boolean, thucTe?: any) {
    if (dk) { dat++; console.log(`  ✓ ${ten}`) }
    else { hong++; console.log(`  ✗ ${ten}${thucTe !== undefined ? ` — thực tế: ${JSON.stringify(thucTe)}` : ''}`) }
}

const KY_NAM = { tu: new Date('2026-01-01T00:00:00+07:00'), den: new Date('2026-12-31T23:59:59+07:00') }
const KY_QUY = { tu: new Date('2026-01-01T00:00:00+07:00'), den: new Date('2026-03-31T23:59:59+07:00') }

function fake(doanhThu: number, donSan = 0, loi?: { tx?: boolean; san?: boolean }) {
    return {
        transaction: {
            aggregate: async () => {
                if (loi?.tx) throw new Error('The table `Transaction` does not exist')
                return { _sum: { total: doanhThu } }
            },
        },
        onlineOrder: {
            aggregate: async () => {
                if (loi?.san) throw new Error('The table `OnlineOrder` does not exist')
                return { _sum: { total: donSan } }
            },
        },
    }
}

async function main() {
    console.log('\n▶ Ngưỡng chịu thuế 200 triệu từ 2026\n')

    const duoi = await tinhChuyenDoiHKD(fake(150_000_000), KY_NAM, { nam: 2026 })
    ok('doanh thu 150tr → CHƯA chịu thuế', !duoi.chiuThue.vuotNguong)
    ok('… nên GTGT và TNCN đều bằng 0', duoi.phaiNop.gtgt === 0 && duoi.phaiNop.tncn === 0)
    ok('… nhưng vẫn nhắc theo dõi mốc vượt ngưỡng',
        duoi.viecPhaiLam.some(v => v.ma === 'theo-doi-nguong'))
    ok('… và nói rõ ngưỡng tính trên CẢ NĂM',
        duoi.viecPhaiLam.find(v => v.ma === 'theo-doi-nguong')!.vaSao.includes('CẢ NĂM'))

    const tren = await tinhChuyenDoiHKD(fake(500_000_000), KY_NAM, { nam: 2026 })
    ok('doanh thu 500tr → chịu thuế', tren.chiuThue.vuotNguong)
    /* Phân phối: GTGT 1% + TNCN 0,5% = 7,5tr. Môn bài bậc 500tr = 500.000đ. */
    ok('GTGT 1% = 5tr', tren.phaiNop.gtgt === 5_000_000, tren.phaiNop.gtgt)
    ok('TNCN 0,5% = 2,5tr', tren.phaiNop.tncn === 2_500_000, tren.phaiNop.tncn)
    ok('môn bài bậc 500tr = 500.000đ', tren.phaiNop.monBai === 500_000, tren.phaiNop.monBai)
    ok('tổng năm = 8tr', tren.phaiNop.tongNam === 8_000_000, tren.phaiNop.tongNam)

    console.log('\n▶ Ngành quyết định số tiền — chênh hơn bốn lần\n')

    const dv = await tinhChuyenDoiHKD(fake(500_000_000), KY_NAM, { nam: 2026, nganh: 'dich-vu' })
    ok('dịch vụ: GTGT 5% = 25tr', dv.phaiNop.gtgt === 25_000_000, dv.phaiNop.gtgt)
    ok('dịch vụ: TNCN 2% = 10tr', dv.phaiNop.tncn === 10_000_000, dv.phaiNop.tncn)
    ok('dịch vụ nộp nhiều hơn phân phối rõ rệt',
        dv.phaiNop.tongNam > tren.phaiNop.tongNam * 3, [tren.phaiNop.tongNam, dv.phaiNop.tongNam])
    ok('luôn nói ra đang tính theo ngành nào',
        dv.ghiChu.some(g => /Tỷ lệ thuế phụ thuộc NGÀNH/.test(g)))

    console.log('\n▶ So với mức khoán — không nhập thì KHÔNG được lấy 0 làm mốc\n')

    ok('không nhập khoán → không so sánh', !tren.soVoiKhoan.coSoSanh)
    ok('… và nói rõ mức khoán nằm ở thông báo cơ quan thuế',
        /thông báo của cơ quan thuế/.test(tren.soVoiKhoan.nhanXet))
    ok('… không bịa ra con số chênh lệch', tren.soVoiKhoan.chenhMoiNam === null)

    const coKhoan = await tinhChuyenDoiHKD(fake(500_000_000), KY_NAM, { nam: 2026, khoanMoiThang: 300_000 })
    ok('có nhập khoán → so được', coKhoan.soVoiKhoan.coSoSanh)
    /* Khoán 300k/tháng = 3,6tr/năm, cộng môn bài 500k = 4,1tr. Kê khai 8tr.
     * Chênh = 3,9tr. */
    ok('tính đúng phần nộp thêm 3,9tr/năm', coKhoan.soVoiKhoan.chenhMoiNam === 3_900_000, coKhoan.soVoiKhoan.chenhMoiNam)
    ok('… và khuyên tính vào giá bán từ bây giờ', /tính vào giá bán/.test(coKhoan.soVoiKhoan.nhanXet))

    const khoanCao = await tinhChuyenDoiHKD(fake(300_000_000), KY_NAM, { nam: 2026, khoanMoiThang: 2_000_000 })
    ok('khoán đang cao hơn thực tế → báo nộp ÍT hơn',
        (khoanCao.soVoiKhoan.chenhMoiNam ?? 0) < 0 && /ÍT hơn/.test(khoanCao.soVoiKhoan.nhanXet),
        khoanCao.soVoiKhoan.chenhMoiNam)

    console.log('\n▶ Quy năm — phải nói rõ là đã quy\n')

    const quy = await tinhChuyenDoiHKD(fake(100_000_000), KY_QUY, { nam: 2026 })
    ok('kỳ 3 tháng → có quy năm', quy.doanhThu.daQuyNam)
    ok('… quy ra khoảng 4 lần', quy.doanhThu.quyNam > 380_000_000 && quy.doanhThu.quyNam < 420_000_000, quy.doanhThu.quyNam)
    ok('… và cảnh báo con số quy năm có thể lệch xa',
        quy.ghiChu.some(g => /lệch khá xa/.test(g)))
    ok('kỳ đủ năm thì KHÔNG quy', !(await tinhChuyenDoiHKD(fake(100_000_000), KY_NAM, { nam: 2026 })).doanhThu.daQuyNam)

    console.log('\n▶ Doanh thu đơn sàn phải được cộng vào\n')

    const coSan = await tinhChuyenDoiHKD(fake(200_000_000, 300_000_000), KY_NAM, { nam: 2026 })
    ok('cộng cả đơn sàn đã giao', coSan.doanhThu.trongKy === 500_000_000, coSan.doanhThu.trongKy)
    ok('… và nói rõ vì sao không được bỏ sót',
        coSan.ghiChu.some(g => /sàn có báo cáo riêng cho cơ quan thuế/.test(g)))

    console.log('\n▶ Hoá đơn điện tử từ máy tính tiền — mốc 1 tỷ\n')

    const tyRuoi = await tinhChuyenDoiHKD(fake(1_500_000_000), KY_NAM, { nam: 2026 })
    ok('doanh thu 1,5 tỷ → bắt buộc máy tính tiền', tyRuoi.hoaDon.batBuocMayTinhTien)
    ok('… dẫn đúng NĐ 70/2025',
        tyRuoi.viecPhaiLam.some(v => v.ma === 'hddt-may-tinh-tien' && /70\/2025/.test(v.canCu)))
    ok('doanh thu 500tr → chưa bắt buộc', !tren.hoaDon.batBuocMayTinhTien)
    ok('mốc dùng đúng hằng số 1 tỷ', NGUONG_HDDT_MAY_TINH_TIEN === 1_000_000_000)

    console.log('\n▶ Việc phải làm — luôn có sổ sách, luôn có căn cứ\n')

    ok('mọi trường hợp đều nhắc giữ sổ sách',
        [duoi, tren, dv, quy].every(r => r.viecPhaiLam.some(v => v.ma === 'so-sach')))
    ok('mọi việc đều dẫn căn cứ pháp lý',
        tren.viecPhaiLam.every(v => v.canCu && v.canCu.length > 15),
        tren.viecPhaiLam.filter(v => !v.canCu || v.canCu.length <= 15).map(v => v.ma))
    ok('mọi việc đều có hạn chót', tren.viecPhaiLam.every(v => !!v.hanChot))

    console.log('\n▶ Đọc hỏng dữ liệu — ghi nhận, không im lặng tính bằng 0\n')

    const hongTx = await tinhChuyenDoiHKD(fake(500_000_000, 0, { tx: true }), KY_NAM, { nam: 2026 })
    ok('hỏng bảng đơn hàng → ghi vào mục thiếu', hongTx.thieu.length > 0, hongTx.thieu)
    ok('… và KHÔNG kết luận là chưa tới ngưỡng',
        hongTx.thieu.length > 0, hongTx.chiuThue.lyDo)

    console.log(`\n${dat}/${dat + hong} ca đạt`)
    if (hong) process.exit(1)
}

main().catch(e => { console.error(e); process.exit(1) })
