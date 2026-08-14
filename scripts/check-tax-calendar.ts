/**
 * Kiểm chứng LỊCH NGHĨA VỤ THUẾ — npx tsx scripts/check-tax-calendar.ts
 *
 * Lịch sai theo hai hướng đều hại:
 *  - sinh THỪA (cả tháng lẫn quý) thì nửa số mốc tự chuyển thành "quá hạn" giả,
 *    người dùng ngừng tin cả bảng;
 *  - sinh THIẾU thì bỏ lỡ hạn thật, bị phạt.
 * Nên mỗi loại hình đều có ca kiểm "phải có gì" VÀ "không được có gì".
 */

import {
    lichNghiaVuThue, suyKyKeKhai, mocCanDon, NGUONG_KHAI_THEO_THANG,
    ganTienChoMoc, monBaiHoKinhDoanh,
    mocDaXong, mocChuaXong, TRANG_THAI_MOC_DA_XONG, TRANG_THAI_MOC_CHUA_XONG,
} from '../src/lib/taxCalendar'

let dat = 0, hong = 0
function ok(ten: string, dk: boolean, thucTe?: any) {
    if (dk) { dat++; console.log(`  ✓ ${ten}`) }
    else { hong++; console.log(`  ✗ ${ten}${thucTe !== undefined ? ` — thực tế: ${JSON.stringify(thucTe)}` : ''}`) }
}

const loai = (ds: any[], t: string) => ds.filter(m => m.taxType === t)

async function main() {
    console.log('\n═══ LỊCH NGHĨA VỤ THUẾ ═══\n')

    console.log('▸ Doanh nghiệp khai quý, có nhân viên')
    const dnQuy = lichNghiaVuThue(2026, { loaiHinh: 'company', kyKeKhai: 'quarter', coNhanVien: true })
    ok('có 4 tờ khai GTGT quý', loai(dnQuy, '01_GTGT_Q').length === 4, loai(dnQuy, '01_GTGT_Q').length)
    ok('KHÔNG sinh thêm tờ khai GTGT tháng', loai(dnQuy, '01_GTGT').length === 0,
        loai(dnQuy, '01_GTGT').length)
    ok('có 4 mốc tạm nộp TNDN quý', loai(dnQuy, 'TNDN_TAM_NOP').length === 4)
    ok('tạm nộp TNDN là NỘP TIỀN, không phải nộp tờ khai',
        loai(dnQuy, 'TNDN_TAM_NOP').every(m => m.loaiViec === 'nop-tien'))
    ok('KHÔNG còn "tờ khai TNDN tạm tính quý" (bỏ từ 2015)',
        !dnQuy.some(m => /tạm tính/i.test(m.description)))
    ok('có quyết toán TNDN năm', loai(dnQuy, '03_TNDN').length === 1)
    ok('có báo cáo tài chính', loai(dnQuy, 'BCTC').length === 1)
    ok('có lệ phí môn bài', loai(dnQuy, 'MON_BAI').length === 1)
    ok('khai TNCN theo QUÝ cho khớp kỳ GTGT', loai(dnQuy, '05_KK_TNCN').length === 4)
    ok('có quyết toán TNCN năm', loai(dnQuy, '05_QTT_TNCN').length === 1)

    console.log('\n▸ Hạn nộp đúng luật')
    const q1 = loai(dnQuy, '01_GTGT_Q').find(m => m.period === 'Q1/2026')!
    ok('GTGT quý 1 hạn 30/04 (cuối tháng đầu quý sau)', q1.dueDate === '2026-04-30', q1.dueDate)
    const q4 = loai(dnQuy, '01_GTGT_Q').find(m => m.period === 'Q4/2026')!
    ok('GTGT quý 4 hạn 31/01 năm sau', q4.dueDate === '2027-01-31', q4.dueDate)
    const tn1 = loai(dnQuy, 'TNDN_TAM_NOP').find(m => m.period === 'TN-Q1/2026')!
    ok('tạm nộp TNDN quý 1 hạn 30/04', tn1.dueDate === '2026-04-30', tn1.dueDate)
    const tn4 = loai(dnQuy, 'TNDN_TAM_NOP').find(m => m.period === 'TN-Q4/2026')!
    ok('tạm nộp TNDN quý 4 hạn 30/01 năm sau', tn4.dueDate === '2027-01-30', tn4.dueDate)
    ok('quyết toán TNDN hạn 31/03 năm sau', loai(dnQuy, '03_TNDN')[0].dueDate === '2027-03-31')
    ok('môn bài hạn 30/01', loai(dnQuy, 'MON_BAI')[0].dueDate === '2026-01-30')
    ok('nhắc quy tắc tạm nộp đủ 80%',
        loai(dnQuy, '03_TNDN')[0].description.includes('80%'))

    console.log('\n▸ Doanh nghiệp khai tháng')
    const dnThang = lichNghiaVuThue(2026, { loaiHinh: 'company', kyKeKhai: 'month', coNhanVien: true })
    ok('có 12 tờ khai GTGT tháng', loai(dnThang, '01_GTGT').length === 12)
    ok('KHÔNG sinh thêm tờ khai GTGT quý', loai(dnThang, '01_GTGT_Q').length === 0)
    ok('khai TNCN theo tháng', loai(dnThang, '05_KK_TNCN').length === 12)
    const t1 = loai(dnThang, '01_GTGT').find(m => m.period === 'T01/2026')!
    ok('GTGT tháng 1 hạn 20/02', t1.dueDate === '2026-02-20', t1.dueDate)
    const t12 = loai(dnThang, '01_GTGT').find(m => m.period === 'T12/2026')!
    ok('GTGT tháng 12 hạn 20/01 năm sau', t12.dueDate === '2027-01-20', t12.dueDate)
    ok('vẫn giữ tạm nộp TNDN theo quý dù khai GTGT tháng',
        loai(dnThang, 'TNDN_TAM_NOP').length === 4)

    console.log('\n▸ Hộ kinh doanh')
    const hkd = lichNghiaVuThue(2026, { loaiHinh: 'household', kyKeKhai: 'quarter', coNhanVien: false })
    ok('dùng tờ khai 01/CNKD', loai(hkd, '01_CNKD').length === 4)
    ok('KHÔNG có tờ khai GTGT doanh nghiệp',
        loai(hkd, '01_GTGT').length === 0 && loai(hkd, '01_GTGT_Q').length === 0)
    ok('KHÔNG có quyết toán TNDN', loai(hkd, '03_TNDN').length === 0)
    ok('KHÔNG có báo cáo tài chính', loai(hkd, 'BCTC').length === 0)
    ok('KHÔNG có tạm nộp TNDN', loai(hkd, 'TNDN_TAM_NOP').length === 0)
    ok('vẫn có lệ phí môn bài', loai(hkd, 'MON_BAI').length === 1)
    ok('mô tả môn bài nêu mức của hộ kinh doanh',
        loai(hkd, 'MON_BAI')[0].description.includes('300k'))
    ok('dẫn Thông tư 40/2021', loai(hkd, '01_CNKD')[0].canCu.includes('40/2021'))

    console.log('\n▸ Không có nhân viên thì không sinh nghĩa vụ TNCN')
    const khongNv = lichNghiaVuThue(2026, { loaiHinh: 'company', kyKeKhai: 'quarter', coNhanVien: false })
    ok('không có tờ khai khấu trừ TNCN', loai(khongNv, '05_KK_TNCN').length === 0)
    ok('không có quyết toán TNCN', loai(khongNv, '05_QTT_TNCN').length === 0)
    ok('các nghĩa vụ khác vẫn đủ', loai(khongNv, '01_GTGT_Q').length === 4)

    console.log('\n▸ Guard cấu trúc')
    for (const [ten, ds] of [['DN quý', dnQuy], ['DN tháng', dnThang], ['HKD', hkd]] as const) {
        ok(`${ten}: mốc nào cũng có căn cứ pháp lý`, ds.every(m => /Điều|Thông tư|Nghị/.test(m.canCu)),
            ds.filter(m => !/Điều|Thông tư|Nghị/.test(m.canCu)).map(m => m.taxType))
        ok(`${ten}: hạn nộp đúng định dạng ngày`, ds.every(m => /^\d{4}-\d{2}-\d{2}$/.test(m.dueDate)))
        ok(`${ten}: không trùng mốc`, new Set(ds.map(m => `${m.taxType}|${m.period}`)).size === ds.length)
        ok(`${ten}: sắp theo hạn nộp tăng dần`,
            ds.every((m, i) => i === 0 || ds[i - 1].dueDate <= m.dueDate))
        ok(`${ten}: phân biệt rõ nộp tờ khai / nộp tiền / báo cáo`,
            ds.every(m => ['to-khai', 'nop-tien', 'bao-cao'].includes(m.loaiViec)))
    }

    console.log('\n▸ Suy kỳ kê khai')
    ok('chưa biết doanh thu → mặc định QUÝ (an toàn, sinh ít mốc)', suyKyKeKhai(null) === 'quarter')
    ok('doanh thu 10 tỷ → quý', suyKyKeKhai(10_000_000_000) === 'quarter')
    ok('doanh thu đúng 50 tỷ → vẫn quý', suyKyKeKhai(NGUONG_KHAI_THEO_THANG) === 'quarter')
    ok('doanh thu trên 50 tỷ → tháng', suyKyKeKhai(60_000_000_000) === 'month')

    console.log('\n▸ Dọn mốc không còn đúng')
    const mocDung = lichNghiaVuThue(2026, { loaiHinh: 'company', kyKeKhai: 'quarter', coNhanVien: false })
    const dangCo = [
        { id: 'a', taxType: '01_GTGT', period: 'T01/2026', status: 'pending' },
        { id: 'b', taxType: '01_GTGT', period: 'T02/2026', status: 'overdue' },
        { id: 'c', taxType: '01_GTGT_Q', period: 'Q1/2026', status: 'pending' },
        { id: 'd', taxType: '01_GTGT', period: 'T03/2026', status: 'submitted' },
        { id: 'e', taxType: '01_GTGT', period: 'T04/2026', status: 'pending', filedAt: new Date() },
        { id: 'f', taxType: '01_GTGT', period: 'T05/2026', status: 'pending', declarationId: 'tk1' },
        { id: 'g', taxType: '01_GTGT', period: 'T06/2026', status: 'pending', notes: 'đã nộp bằng tay' },
        { id: 'h', taxType: 'TU_TAO', period: 'X', status: 'pending' },
    ]
    const don = mocCanDon(dangCo, mocDung)
    ok('dọn mốc khai tháng khi đã chuyển sang khai quý', don.includes('a') && don.includes('b'), don)
    ok('giữ mốc khai quý đang đúng', !don.includes('c'))
    ok('KHÔNG dọn mốc đã nộp', !don.includes('d'))
    ok('KHÔNG dọn mốc có ngày nộp', !don.includes('e'))
    ok('KHÔNG dọn mốc đã gắn tờ khai', !don.includes('f'))
    ok('KHÔNG dọn mốc người dùng có ghi chú', !don.includes('g'))
    ok('KHÔNG đụng loại hạn nộp do người dùng tự tạo', !don.includes('h'))
    ok('chỉ dọn đúng 2 mốc', don.length === 2, don)

    console.log('\n▸ Ước tính số tiền từng mốc')
    const nguon = {
        loaiHinh: 'company' as const,
        doanhThuNamTruoc: 2_000_000_000,
        toKhaiTheoKy: new Map([['2026-Q1', 12_000_000]]),
        tncnTheoKy: new Map([['2026-Q1', 3_500_000]]),
        laiTheoQuy: new Map([[1, 100_000_000], [2, -20_000_000]]),
    }
    const gtgtQ1 = ganTienChoMoc(loai(dnQuy, '01_GTGT_Q').find(m => m.period === 'Q1/2026')!, nguon)
    ok('GTGT lấy số từ tờ khai đã lập', gtgtQ1.soTien === 12_000_000 && gtgtQ1.tuToKhai, gtgtQ1)
    const gtgtQ2 = ganTienChoMoc(loai(dnQuy, '01_GTGT_Q').find(m => m.period === 'Q2/2026')!, nguon)
    ok('chưa lập tờ khai thì để trống, KHÔNG đoán bừa số 0',
        gtgtQ2.soTien === null && /Chưa lập tờ khai/.test(gtgtQ2.dienGiai), gtgtQ2)

    const tncnQ1 = ganTienChoMoc(loai(dnQuy, '05_KK_TNCN').find(m => m.period === 'TNCN-Q1/2026')!, nguon)
    ok('TNCN lấy tổng đã khấu trừ trên bảng lương', tncnQ1.soTien === 3_500_000, tncnQ1)
    ok('TNCN đánh dấu là suy từ sổ, không phải số tờ khai', tncnQ1.tuToKhai === false)

    const tnQ1 = ganTienChoMoc(loai(dnQuy, 'TNDN_TAM_NOP').find(m => m.period === 'TN-Q1/2026')!, nguon)
    ok('tạm nộp TNDN ước = lãi quý × 20%', tnQ1.soTien === 20_000_000, tnQ1)
    ok('nói rõ số thật có thể CAO hơn vì chưa trừ khoản bị loại',
        /CAO hơn/.test(tnQ1.dienGiai), tnQ1.dienGiai)
    const tnQ2 = ganTienChoMoc(loai(dnQuy, 'TNDN_TAM_NOP').find(m => m.period === 'TN-Q2/2026')!, nguon)
    ok('quý lỗ thì tạm nộp 0 nhưng vẫn nhắc mức 80%',
        tnQ2.soTien === 0 && tnQ2.dienGiai.includes('80%'), tnQ2)
    const tnQ3 = ganTienChoMoc(loai(dnQuy, 'TNDN_TAM_NOP').find(m => m.period === 'TN-Q3/2026')!, nguon)
    ok('quý chưa có số liệu thì để trống', tnQ3.soTien === null, tnQ3)

    const mbDn = ganTienChoMoc(loai(dnQuy, 'MON_BAI')[0], nguon)
    ok('môn bài doanh nghiệp: không tự xác định được vì thiếu vốn điều lệ',
        mbDn.soTien === null && /vốn điều lệ/.test(mbDn.dienGiai), mbDn)

    console.log('\n▸ Bậc môn bài hộ kinh doanh (NĐ 139/2016)')
    ok('≤ 100 triệu → miễn', monBaiHoKinhDoanh(100_000_000).soTien === 0)
    ok('trên 100 đến 300 triệu → 300k', monBaiHoKinhDoanh(250_000_000).soTien === 300_000)
    ok('đúng 300 triệu → vẫn 300k', monBaiHoKinhDoanh(300_000_000).soTien === 300_000)
    ok('trên 300 đến 500 triệu → 500k', monBaiHoKinhDoanh(400_000_000).soTien === 500_000)
    ok('trên 500 triệu → 1 triệu', monBaiHoKinhDoanh(800_000_000).soTien === 1_000_000)
    ok('không biết doanh thu thì để trống, không đoán bậc',
        monBaiHoKinhDoanh(null).soTien === null)
    const mbHkd = ganTienChoMoc(loai(hkd, 'MON_BAI')[0],
        { ...nguon, loaiHinh: 'household' as const, doanhThuNamTruoc: 700_000_000 })
    ok('mốc môn bài của hộ lấy đúng bậc theo doanh thu', mbHkd.soTien === 1_000_000, mbHkd)

    /* ── Từ vựng trạng thái mốc nghĩa vụ ────────────────────────────────────
     * Đây là phép kiểm HỢP ĐỒNG, không phải quét đoán mò. Đã thử bản quét rộng
     * "so sánh với giá trị không chỗ nào ghi" trên toàn bộ model: 149 nghi vấn
     * trên 257 lần so sánh (58%) — vô dụng, vì phần lớn status được ghi ở chỗ
     * regex không thấy (create lồng nhau, raw SQL, giá trị do sàn trả về). Bỏ
     * bản rộng, giữ đúng MỘT model có từ vựng thật sự tập trung ở một nơi. */
    console.log('\n▸ Từ vựng trạng thái mốc nghĩa vụ (TaxDeadline)')
    ok('mốc đã đánh dấu nộp được tính là xong', mocDaXong('submitted'))
    ok('mốc pending chưa xong', mocChuaXong('pending') && !mocDaXong('pending'))
    ok('mốc overdue chưa xong', mocChuaXong('overdue') && !mocDaXong('overdue'))
    ok('trạng thái lạ không rơi vào nhóm nào',
        !mocDaXong('la_hoac') && !mocChuaXong('la_hoac'))
    ok('null/undefined không bị coi là chưa nộp',
        !mocChuaXong(null) && !mocChuaXong(undefined))

    const fs = await import('fs'), path = await import('path')
    const goc = path.resolve(__dirname, '..', 'src')
    const tuVung = new Set<string>([...TRANG_THAI_MOC_DA_XONG, ...TRANG_THAI_MOC_CHUA_XONG])

    // 1) Danh sách route nhận vào phải nằm trong từ vựng
    const srcTax = fs.readFileSync(path.join(goc, 'routes', 'tax.ts'), 'utf8')
    const mRoute = /if\s*\(!\[([^\]]*)\]\.includes\(String\(status\)\)\)/.exec(srcTax)
    const nhanVao = (mRoute?.[1].match(/'[^']*'/g) || []).map(s => s.slice(1, -1))
    ok('PUT /deadlines/:id nhận đúng các trạng thái có trong từ vựng',
        nhanVao.length > 0 && nhanVao.every(v => tuVung.has(v)), nhanVao)

    // 2) Không nơi nào so sánh trạng thái mốc bằng một giá trị ngoài từ vựng
    const lechs: string[] = []
    const quet = (thuMuc: string) => {
        for (const t of fs.readdirSync(thuMuc)) {
            const f = path.join(thuMuc, t)
            if (fs.statSync(f).isDirectory()) { if (t !== 'generated') quet(f) }
            else if (t.endsWith('.ts')) {
                const s = fs.readFileSync(f, 'utf8')
                const re = /prisma\.taxDeadline\.\w+\s*\(\s*\{[\s\S]{0,400}?status\s*:\s*(\{[^}]*\}|'[^']*')/g
                let m: RegExpExecArray | null
                while ((m = re.exec(s))) {
                    for (const lit of m[1].match(/'[^']*'/g) || []) {
                        const v = lit.slice(1, -1)
                        if (!tuVung.has(v)) {
                            lechs.push(`${path.relative(goc, f)}:${s.slice(0, m.index).split('\n').length} → '${v}'`)
                        }
                    }
                }
            }
        }
    }
    quet(goc)
    ok('không truy vấn mốc nghĩa vụ bằng trạng thái ngoài từ vựng',
        lechs.length === 0, lechs)

    console.log(`\n${dat}/${dat + hong} ca đạt`)
    if (hong) process.exit(1)
}

main().catch(e => { console.error(e); process.exit(1) })
