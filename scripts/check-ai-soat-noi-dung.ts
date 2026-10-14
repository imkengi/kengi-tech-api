/* Kiểm chứng BỘ LỌC kết quả AI soát nội dung video (lib/aiSoatNoiDung.ts → locKetQua) — 14/10/2026.
 *   npx tsx scripts/check-ai-soat-noi-dung.ts
 * AI không được tin mù: số không có trong tên/mô tả là số BỊA ⇒ bỏ dòng; câu hỏi, dòng dẫn ra ngoài sàn, dòng dài quá
 * khung ⇒ bỏ; nhưng dòng đúng (số có nguồn, viết khác dấu chấm/phẩy nghìn) phải GIỮ. */
import { locKetQua } from '../src/lib/aiSoatNoiDung'

let loi = 0
const dung = (ten: string, ok: boolean, chiTiet = '') => { if (!ok) loi++; console.log(`${ok ? '✓' : '✗'} ${ten}${chiTiet ? ' — ' + chiTiet : ''}`) }

const ten = 'Nồi cơm điện 1.8L Sunhouse SHD8208C'
const moTa = `Thông số kỹ thuật\nDung tích\t1,8 lít\nCông suất\t700W\nĐặc điểm nổi bật\nLòng nồi chống dính Whitford (USA)\nNắp gài giữ nhiệt lâu\nGiá 1.250.000đ\nHotline 0912 345 678`
const kq = locKetQua({
    dungDuoc: true, lyDo: '', tenNgan: 'Nồi cơm điện Sunhouse SHD8208C 1.8L',
    khauHieu: ['Cơm chín đều, giữ ấm lâu', 'Bạn đang tìm nồi cơm tốt?', 'Nấu nhanh hơn 30%'],
    diemManh: ['Lòng nồi chống dính Whitford', 'Nắp gài giữ nhiệt lâu', 'Bảo hành 24 tháng chính hãng', 'Gọi Zalo 0912345678 để đặt', 'Một điểm mạnh dài quá mức cho phép của khung hình video'],
    thongSo: [{ nhan: 'Dung tích', giaTri: '1,8 lít' }, { nhan: 'Công suất', giaTri: '700W' }, { nhan: 'Chế độ nấu', giaTri: '8 chế độ' }, { nhan: 'dung tích', giaTri: '1,8 lít' }],
    canhBao: [],
}, ten, moTa)

dung('giữ khẩu hiệu đúng', kq.khauHieu.includes('Cơm chín đều, giữ ấm lâu'), kq.khauHieu.join(' | '))
dung('bỏ câu hỏi', !kq.khauHieu.some(s => s.endsWith('?')))
dung('bỏ số bịa "30%"', !kq.khauHieu.some(s => s.includes('30%')))
dung('giữ điểm mạnh có nguồn', kq.diemManh.includes('Lòng nồi chống dính Whitford') && kq.diemManh.includes('Nắp gài giữ nhiệt lâu'), kq.diemManh.join(' | '))
dung('bỏ "Bảo hành 24 tháng" (số 24 không có trong mô tả)', !kq.diemManh.some(s => /24 tháng/.test(s)))
dung('bỏ dòng Zalo/số điện thoại', !kq.diemManh.some(s => /zalo|0912/i.test(s)))
dung('bỏ điểm mạnh dài quá 40 ký tự', !kq.diemManh.some(s => s.length > 40))
dung('giữ "1,8 lít" và "700W"', kq.thongSo.some(t => t.giaTri === '1,8 lít') && kq.thongSo.some(t => t.giaTri === '700W'), JSON.stringify(kq.thongSo))
dung('bỏ "8 chế độ" (số 8 có trong SHD8208C nhưng 8 lẻ không có)', !kq.thongSo.some(t => t.giaTri === '8 chế độ'), JSON.stringify(kq.thongSo))
dung('bỏ thông số trùng nhãn', kq.thongSo.filter(t => t.nhan.toLowerCase() === 'dung tích').length === 1)
dung('tên ngắn giữ (1.8 có trong tên)', kq.tenNgan === 'Nồi cơm điện Sunhouse SHD8208C 1.8L', kq.tenNgan)
dung('đếm số dòng bị lọc', kq.boLoc >= 6, String(kq.boLoc))
dung('dùng được', kq.dungDuoc)

// Số viết khác dấu nghìn vẫn khớp: mô tả "1.800W" — AI viết "1800W"
const k2 = locKetQua({ dungDuoc: true, diemManh: ['Công suất mạnh 1800W'], khauHieu: [], thongSo: [{ nhan: 'Công suất', giaTri: '1800W' }] }, 'Nồi chiên', 'Công suất: 1.800W')
dung('"1800W" khớp "1.800W" trong mô tả', k2.thongSo.length === 1 && k2.diemManh.length === 1, JSON.stringify(k2))

// AI bảo mô tả sai mã ⇒ không dùng được, giữ lý do
const k3 = locKetQua({ dungDuoc: false, lyDo: 'Mô tả của KS-TU750DG (750ml), tên là 500ml' }, 'Bình 500ml KS-TU500HB', 'Bình giữ nhiệt KS-TU750DG 750ml')
dung('mô tả sai mã ⇒ dungDuoc=false kèm lý do', !k3.dungDuoc && /750/.test(k3.lyDo), k3.lyDo)

// AI trả gần rỗng ⇒ không dùng được (không dựng video trống rỗng)
const k4 = locKetQua({ dungDuoc: true, khauHieu: [], diemManh: [], thongSo: [{ nhan: 'Màu', giaTri: 'Đỏ' }] }, 'Ly', 'Ly màu đỏ')
dung('kho rỗng ⇒ không dùng được', !k4.dungDuoc, k4.lyDo)

// Rác: không phải mảng, kiểu sai ⇒ không ném lỗi
const k5 = locKetQua({ khauHieu: 'abc', diemManh: null, thongSo: [{ nhan: 1 }] }, 'X', 'Y')
dung('dữ liệu AI hỏng không làm sập', Array.isArray(k5.khauHieu) && Array.isArray(k5.thongSo))

console.log(loi ? `\n✗ ${loi} ca sai` : '\n✓ Bộ lọc AI soát nội dung: mọi ca đúng')
process.exit(loi ? 1 : 0)
