/**
 * Kiểm chứng KẾ HOẠCH KHẮC PHỤC — chạy: npx tsx scripts/check-remediation.ts
 *
 * Hàm này thuần nên kiểm được bằng dữ liệu dựng tay, không cần prisma giả.
 * Chỗ dễ sai và gây hại nhất: hạn chót (bịa sai hạn nộp tờ khai là người dùng
 * lỡ hạn thật) và thứ tự ưu tiên (việc nhiều tiền bị đẩy xuống cuối thì danh
 * sách vô dụng).
 */

import { lapKeHoachKhacPhuc, hanNopToKhai, TEN_NGUOI_LAM } from '../src/lib/remediationPlan'
import type { HoSoThue } from '../src/lib/taxAudit'
import type { HoSoAnDinh } from '../src/lib/taxAssessment'

let dat = 0, hong = 0
function ok(ten: string, dk: boolean, thucTe?: any) {
    if (dk) { dat++; console.log(`  ✓ ${ten}`) }
    else { hong++; console.log(`  ✗ ${ten}${thucTe !== undefined ? ` — thực tế: ${JSON.stringify(thucTe)}` : ''}`) }
}

const canhBao = (
    code: string, muc: 'cao' | 'vua' | 'thap', tienRuiRo: number | null,
): any => ({
    code, muc, tieuDe: `Cảnh báo ${code}`,
    chiTiet: `Chi tiết của ${code}`, canCu: 'Điều X', canLam: `Việc cần làm cho ${code}`,
    tienRuiRo, soLuong: 1, viDu: [],
})

const hoSo = (canhBaos: any[]): HoSoThue => ({
    ky: 'tháng 8/2026', diem: 60, xepLoai: 'trung bình',
    canhBao: canhBaos,
    doanhThu: { so: 0, toKhai: null, hoaDon: 0 },
    thue: { vatRaSo: 0, vatRaToKhai: null, vatVaoSo: 0, vatVaoToKhai: null },
    hoSoCanChuanBi: [],
} as any)

const anDinh = (canCu: any[]): HoSoAnDinh => ({
    ky: 'tháng 8/2026', laHoKinhDoanh: false, canCu, nguyCo: 'cao',
    doanhThuSo: 0, doanhThuHoaDon: 0, doanhThuGocAnDinh: 0, thueDaKeKhai: 0,
    kichBan: [], tyLeApDung: { gtgt: 0.1, tndnHoacTncn: 0.2, nganh: '', canCu: '' },
    ghiChu: '', canLamNgay: [],
} as any)

const cc = (ma: string, muc: 'ro-rang' | 'co-dau-hieu') => ({
    ma, muc, dauHieu: `Dấu hiệu ${ma}`, dieuKhoan: 'Điều 50 Luật QLT',
    chiTiet: `Hậu quả của ${ma}`, caiThenao: `Cách cãi lại ${ma}`,
})

const HOM_NAY = '2026-08-20'
const KY = { maKy: '2026-08', nhan: 'tháng 8/2026' }

async function main() {
    console.log('\n═══ KẾ HOẠCH KHẮC PHỤC ═══\n')

    console.log('▸ Hạn nộp hồ sơ khai thuế (Điều 44 Luật QLT)')
    ok('tháng → ngày 20 tháng sau', hanNopToKhai('2026-08') === '2026-09-20', hanNopToKhai('2026-08'))
    ok('tháng 12 → 20/01 năm sau', hanNopToKhai('2026-12') === '2027-01-20', hanNopToKhai('2026-12'))
    ok('quý 1 → 30/04', hanNopToKhai('2026-Q1') === '2026-04-30', hanNopToKhai('2026-Q1'))
    ok('quý 4 → 31/01 năm sau', hanNopToKhai('2026-Q4') === '2027-01-31', hanNopToKhai('2026-Q4'))
    ok('quý 2 → 31/07 (tháng 31 ngày)', hanNopToKhai('2026-Q2') === '2026-07-31', hanNopToKhai('2026-Q2'))
    ok('năm → 31/03 năm sau', hanNopToKhai('2026') === '2027-03-31', hanNopToKhai('2026'))

    console.log('\n▸ Sắp xếp theo tiền và công sức')
    const kh = lapKeHoachKhacPhuc(
        hoSo([
            canhBao('vat-vao-ton-dong', 'thap', null),
            canhBao('chi-khong-hoa-don', 'cao', 10_000_000),
            canhBao('vat-sai-so-hoc', 'cao', 30_000_000),
            canhBao('hoa-don-lui-ngay', 'vua', null),
        ]),
        null, KY, HOM_NAY,
    )
    ok('việc nhiều tiền nhất lên đầu', kh.viec[0].ma === 'soat-vat-sai-so-hoc', kh.viec[0].ma)
    ok('mọi việc ưu tiên 1 đứng trước ưu tiên 2',
        kh.viec.findIndex(v => v.uuTien === 2) > kh.viec.findLastIndex(v => v.uuTien === 1))
    ok('đếm đúng số việc phải làm ngay', kh.soViecLamNgay === 2, kh.soViecLamNgay)
    ok('cộng đúng tổng tiền có nguy cơ', kh.tongTienLoiIch === 40_000_000, kh.tongTienLoiIch)

    const khTienLon = lapKeHoachKhacPhuc(
        hoSo([canhBao('vat-vao-ton-dong', 'thap', 80_000_000)]), null, KY, HOM_NAY)
    ok('cảnh báo mức thấp nhưng tiền ≥50tr được kéo lên ưu tiên 1',
        khTienLon.viec.find(v => v.ma === 'soat-vat-vao-ton-dong')!.uuTien === 1)
    const khTienNho = lapKeHoachKhacPhuc(
        hoSo([canhBao('vat-vao-ton-dong', 'thap', 1_000_000)]), null, KY, HOM_NAY)
    ok('tiền nhỏ thì vẫn ở ưu tiên thấp',
        khTienNho.viec.find(v => v.ma === 'soat-vat-vao-ton-dong')!.uuTien === 3)

    console.log('\n▸ Hạn chót từng loại việc')
    ok('việc gắn tờ khai lấy hạn nộp tờ khai của kỳ',
        kh.viec.find(v => v.ma === 'soat-vat-sai-so-hoc')!.hanChot === '2026-09-20',
        kh.viec.find(v => v.ma === 'soat-vat-sai-so-hoc')!.hanChot)
    ok('việc thu thập chứng từ cho 30 ngày kể từ hôm nay',
        kh.viec.find(v => v.ma === 'soat-chi-khong-hoa-don')!.hanChot === '2026-09-19',
        kh.viec.find(v => v.ma === 'soat-chi-khong-hoa-don')!.hanChot)
    ok('tính đúng số ngày còn lại',
        kh.viec.find(v => v.ma === 'soat-vat-sai-so-hoc')!.soNgayConLai === 31)
    ok('chưa tới hạn thì không đánh dấu quá hạn', kh.viec.every(v => !v.quaHan))

    const khTre = lapKeHoachKhacPhuc(hoSo([canhBao('thieu-to-khai', 'cao', null)]), null, KY, '2026-10-05')
    const vTre = khTre.viec.find(v => v.ma === 'soat-thieu-to-khai')!
    ok('quá hạn nộp tờ khai thì đánh dấu quá hạn', vTre.quaHan === true && vTre.soNgayConLai < 0, vTre)
    ok('tóm tắt nêu rõ có việc quá hạn', khTre.tomTat.includes('QUÁ HẠN'), khTre.tomTat)

    console.log('\n▸ Gộp với căn cứ ấn định (không đẻ việc trùng)')
    const khGop = lapKeHoachKhacPhuc(
        hoSo([canhBao('ton-kho-am', 'cao', 5_000_000)]),
        anDinh([cc('ton-kho-am', 'ro-rang'), cc('ban-khong-xuat-hoa-don', 'co-dau-hieu')]),
        KY, HOM_NAY,
    )
    ok('không tạo việc trùng cho tồn kho âm',
        khGop.viec.filter(v => v.ma.includes('ton-kho-am')).length === 1,
        khGop.viec.map(v => v.ma))
    ok('việc trùng được bổ sung ghi chú là căn cứ ấn định',
        khGop.viec.find(v => v.ma === 'soat-ton-kho-am')!.vaSao.includes('ẤN ĐỊNH'))
    ok('căn cứ ấn định không trùng thì thành việc riêng',
        khGop.viec.some(v => v.ma === 'andinh-ban-khong-xuat-hoa-don'))
    ok('việc từ ấn định lấy hạn nộp tờ khai',
        khGop.viec.find(v => v.ma === 'andinh-ban-khong-xuat-hoa-don')!.hanChot === '2026-09-20')

    const khNangUuTien = lapKeHoachKhacPhuc(
        hoSo([canhBao('quy-am-trong-ky', 'vua', null)]),
        anDinh([cc('quy-am', 'ro-rang')]), KY, HOM_NAY,
    )
    ok('căn cứ ấn định rõ ràng nâng việc trùng lên ưu tiên 1',
        khNangUuTien.viec.find(v => v.ma === 'soat-quy-am-trong-ky')!.uuTien === 1)

    console.log('\n▸ Hồ sơ giấy phần mềm không thay thế được')
    ok('luôn có việc kiểm kê kho', kh.viec.some(v => v.ma === 'hoso-kiem-ke-kho'))
    ok('luôn có việc kiểm kê quỹ', kh.viec.some(v => v.ma === 'hoso-kiem-ke-quy'))
    ok('luôn có việc đối chiếu sao kê ngân hàng', kh.viec.some(v => v.ma === 'hoso-doi-chieu-ngan-hang'))
    ok('kiểm kê kho giao cho thủ kho',
        kh.viec.find(v => v.ma === 'hoso-kiem-ke-kho')!.aiLam === 'thu-kho')

    console.log('\n▸ Guard cấu trúc')
    const tatCa = khGop.viec
    ok('việc nào cũng có người chịu trách nhiệm', tatCa.every(v => !!TEN_NGUOI_LAM[v.aiLam]))
    ok('việc nào cũng có hạn chót đúng định dạng', tatCa.every(v => /^\d{4}-\d{2}-\d{2}$/.test(v.hanChot)))
    ok('việc nào cũng nói rõ phải làm gì', tatCa.every(v => v.viecLam.length > 10))
    ok('việc nào cũng có căn cứ', tatCa.every(v => !!v.canCu))
    ok('mã việc không trùng', new Set(tatCa.map(v => v.ma)).size === tatCa.length)
    ok('phân loại nguồn chỉ nhận 3 giá trị hợp lệ',
        tatCa.every(v => ['soat-du-lieu', 'nguy-co-an-dinh', 'ho-so-giay'].includes(v.nguon)))
    ok('ghi chú nhắc lợi ích của khai bổ sung sớm',
        /TRƯỚC khi cơ quan thuế công bố/.test(khGop.ghiChu))

    console.log('\n▸ Sổ sạch')
    const sach = lapKeHoachKhacPhuc(hoSo([]), anDinh([]), KY, HOM_NAY)
    ok('không cảnh báo thì chỉ còn việc hồ sơ giấy', sach.viec.length === 3, sach.viec.map(v => v.ma))
    ok('không có việc phải làm ngay', sach.soViecLamNgay === 0)
    ok('tóm tắt nói đúng là không có việc gấp',
        sach.tomTat.includes('không có việc nào phải làm gấp'), sach.tomTat)
    ok('tổng tiền = 0', sach.tongTienLoiIch === 0)

    console.log(`\n${dat}/${dat + hong} ca đạt`)
    if (hong) process.exit(1)
}

main().catch(e => { console.error(e); process.exit(1) })
