/**
 * Bộ soát TRANG KHÁCH TỰ LẤY HOÁ ĐƠN kengi.vn/hoadon — lib/yeuCauHoaDon.ts (20/10/2026). Hàm thuần, không DB.
 *   npx tsx scripts/check-yeu-cau-hoa-don.ts
 * Canh: mã đơn khách dán đủ kiểu vẫn ra đúng mã trong hệ thống (đo: SPE 14 ký tự, TIK 18 số, LZD 15 số); mã rác bị
 * chặn trước khi hỏi CSDL; thông tin HĐ thiếu / sai bị từ chối với câu nói rõ; ghi đúng khoá đường xuất HĐ đang đọc
 * (name/taxCode/address/email/nationalId); trạng thái đơn nói đúng với khách; che MST / email khi nhắc lại.
 */
import {
    ungVienMaDon, kiemYeuCau, trangThaiDonKhach, cheMst, cheEmail, ngayVN, cuaHangNhanYeuCau, donTuPhieu, maPhieuUngVien,
    hoaDonCoDanhTinh, quyetDinhGui, emailNhanHoaDon,
} from '../src/lib/yeuCauHoaDon'

let loi = 0
const dung = (ten: string, ok: boolean, chiTiet?: unknown) => {
    if (!ok) loi++
    console.log(`${ok ? '✓' : '✗'} ${ten}${!ok && chiTiet !== undefined ? ' — ' + JSON.stringify(chiTiet) : ''}`)
}
const bang = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

// 1. mã đơn
dung('Shopee trần ⇒ thử cả 3 tiền tố', bang(ungVienMaDon('2610203UKRG5FA'), ['SPE-2610203UKRG5FA', 'TIK-2610203UKRG5FA', 'LZD-2610203UKRG5FA']), ungVienMaDon('2610203UKRG5FA'))
dung('chữ thường + dấu cách + # ⇒ chuẩn hoá', bang(ungVienMaDon(' #2610 203ukrg5fa '), ungVienMaDon('2610203UKRG5FA')))
dung('dán mã hệ thống SPE- ⇒ đúng một ứng viên', bang(ungVienMaDon('spe-2610203UKRG5FA'), ['SPE-2610203UKRG5FA']))
dung('dán ONLINE-TIK- ⇒ bỏ ONLINE-', bang(ungVienMaDon('ONLINE-TIK-586612345678901234'), ['TIK-586612345678901234']))
dung('TikTok 18 số', (ungVienMaDon('586612345678901234') || []).includes('TIK-586612345678901234'))
dung('rác / quá ngắn / ký tự lạ / rỗng ⇒ null',
    ungVienMaDon('abc') === null && ungVienMaDon("1'; DROP TABLE x") === null && ungVienMaDon('') === null && ungVienMaDon(null) === null
    && ungVienMaDon('A'.repeat(41)) === null && ungVienMaDon('SPE-ab') === null)

// 2. thông tin hoá đơn
const now = new Date('2026-10-20T08:00:00Z')
const ct = kiemYeuCau({ loai: 'cong_ty', ten: '  Công ty TNHH   Kengi ', mst: '0312 345 678', diaChi: '12 Lê Lợi, Q1, TP HCM', email: 'KeToan@Kengi.vn' }, now)
dung('công ty hợp lệ ⇒ đúng khoá đường xuất HĐ, gom khoảng trắng, email thường',
    ct.ok && ct.info.name === 'Công ty TNHH Kengi' && ct.info.taxCode === '0312345678' && ct.info.address === '12 Lê Lợi, Q1, TP HCM'
    && ct.info.email === 'ketoan@kengi.vn' && ct.info.nationalId === '' && ct.info.nguon === 'khach-web' && ct.info.luc === now.toISOString(), ct)
dung('công ty thiếu MST ⇒ từ chối', !kiemYeuCau({ loai: 'cong_ty', ten: 'Cty A', diaChi: '12 Lê Lợi Q1', email: 'a@b.vn' }).ok)
dung('công ty MST sai dạng ⇒ từ chối', !kiemYeuCau({ loai: 'cong_ty', ten: 'Cty A', mst: '12345', diaChi: '12 Lê Lợi Q1', email: 'a@b.vn' }).ok)
dung('công ty thiếu địa chỉ ⇒ từ chối', !kiemYeuCau({ loai: 'cong_ty', ten: 'Cty A', mst: '0312345678', email: 'a@b.vn' }).ok)
dung('MST chi nhánh 10-3 số được nhận', kiemYeuCau({ loai: 'cong_ty', ten: 'Cty A CN', mst: '0312345678-001', diaChi: '12 Lê Lợi Q1', email: 'a@b.vn' }).ok)
dung('hộ KD MST 12 số được nhận', kiemYeuCau({ loai: 'ho_kd', ten: 'Hộ KD Tạp hoá B', mst: '079123456789', diaChi: '5 Hai Bà Trưng', email: 'b@gmail.com' }).ok)
const cn = kiemYeuCau({ loai: 'ca_nhan', ten: 'Lê Văn C', cccd: '079 123 456 789', email: 'c@x.vn' })
dung('cá nhân: tên + CCCD 12 số, không cần MST / địa chỉ', cn.ok && cn.info.nationalId === '079123456789' && cn.info.taxCode === '', cn)
dung('cá nhân CCCD sai dạng ⇒ từ chối', !kiemYeuCau({ loai: 'ca_nhan', ten: 'Lê C', cccd: '12345', email: 'c@x.vn' }).ok)
dung('CCCD của loại công ty bị bỏ (không lẫn vào HĐ công ty)', (() => { const r = kiemYeuCau({ loai: 'cong_ty', ten: 'Cty A', mst: '0312345678', diaChi: '12 Lê Lợi Q1', email: 'a@b.vn', cccd: '079123456789' }); return r.ok && r.info.nationalId === '' })())
dung('thiếu / sai email ⇒ từ chối', !kiemYeuCau({ loai: 'ca_nhan', ten: 'Lê C', email: 'c@x' }).ok && !kiemYeuCau({ loai: 'ca_nhan', ten: 'Lê C' }).ok)
dung('loại lạ ⇒ từ chối', !kiemYeuCau({ loai: 'vip', ten: 'X', email: 'x@y.vn' }).ok)
const dai = kiemYeuCau({ loai: 'ca_nhan', ten: 'A'.repeat(500) + '\u0000\u0007', email: 'x@y.vn' })
dung('cắt độ dài + bỏ ký tự điều khiển', dai.ok && dai.info.name.length === 200 && !/[\u0000-\u001f]/.test(dai.info.name), dai.ok ? dai.info.name.length : dai)

// 3. trạng thái đơn nói với khách
dung('chưa có phiếu ⇒ chờ xác nhận', trangThaiDonKhach({ status: 'processing' }, false) === 'cho_xac_nhan' && trangThaiDonKhach({ status: 'UNPAID' }, false) === 'cho_xac_nhan' && trangThaiDonKhach({ status: 'READY_TO_SHIP' }, false) === 'cho_xac_nhan')
// đo 20/10/2026: 748 đơn COMPLETED không có phiếu — KHÔNG được nói "chờ xác nhận"
dung('đã giao mà chưa có phiếu ⇒ chưa ghi sổ (không phải chờ xác nhận)', trangThaiDonKhach({ status: 'COMPLETED', deliveredAt: '2026-10-01' }, false) === 'chua_ghi_so' && trangThaiDonKhach({ status: 'COMPLETED' }, false) === 'chua_ghi_so')
dung('trạng thái kiểu sàn: TO_CONFIRM_RECEIVE / IN_TRANSIT / TO_RETURN / CANCELLED',
    trangThaiDonKhach({ status: 'TO_CONFIRM_RECEIVE', deliveredAt: '2026-10-01' }, true) === 'da_giao' && trangThaiDonKhach({ status: 'IN_TRANSIT' }, true) === 'dang_giao'
    && trangThaiDonKhach({ status: 'TO_RETURN', deliveredAt: '2026-10-01' }, true) === 'tra_hang' && trangThaiDonKhach({ status: 'CANCELLED' }, true) === 'da_huy')
dung('huỷ ⇒ đã huỷ (kể cả có phiếu)', trangThaiDonKhach({ status: 'cancelled' }, true) === 'da_huy')
dung('trả hàng ⇒ trả hàng', trangThaiDonKhach({ status: 'returned' }, true) === 'tra_hang')
dung('có deliveredAt ⇒ đã giao', trangThaiDonKhach({ status: 'shipping', deliveredAt: '2026-10-19' }, true) === 'da_giao')
dung('completed ⇒ đã giao', trangThaiDonKhach({ status: 'completed' }, true) === 'da_giao')
dung('đang giao', trangThaiDonKhach({ status: 'shipping' }, true) === 'dang_giao')

// 4. che bớt + ngày + cửa hàng
dung('che MST / email', cheMst('0312345678') === '***678' && cheEmail('ketoan@kengi.vn') === 'k***@kengi.vn' && cheMst('') === '' && cheEmail('xx') === '')
dung('ngày giờ VN', ngayVN('2026-10-19T17:30:00Z') === '20/10/2026' && ngayVN(null) === '' && ngayVN('rác') === '')
dung('cửa hàng mặc định KENGISTORE; danh sách lạ bị lọc', bang(cuaHangNhanYeuCau(undefined), ['KENGISTORE']) && bang(cuaHangNhanYeuCau(' huti , x;y ,KENGISTORE'), ['HUTI', 'KENGISTORE']) && bang(cuaHangNhanYeuCau(''), ['KENGISTORE']))


// 5. đơn đã bị cron dọn xoá ⇒ dựng lại từ phiếu bán (29/10/2026: khách tra mã đơn tháng 8 bị "không tìm thấy" dù HĐ đã xuất)
const phieu = {
    receiptNumber: 'ONLINE-SPE-2608010000TEST', status: 'completed', total: 92000, createdAt: '2026-07-31T10:12:54Z',
    transactionDate: '2026-07-31T10:05:18Z', notes: 'Đơn online shopee - SPE-2608010000TEST',
    items: [{ productName: 'Món A', quantity: 1, unitPrice: 92000, lineTotal: 92000 }],
}
const dp = donTuPhieu(phieu, 'Kengi Store')
dung('phiếu completed ⇒ đã giao; mã bỏ ONLINE-; gian hàng; sàn theo ghi chú; ngày đặt = transactionDate; không có ngày giao',
    dp.tuPhieu && dp.orderNumber === 'SPE-2608010000TEST' && trangThaiDonKhach(dp, true) === 'da_giao' && dp.channelName === 'Kengi Store'
    && dp.platform === 'shopee' && dp.total === 92000 && ngayVN(dp.createdAt) === '31/07/2026' && dp.deliveredAt === null
    && dp.items.length === 1 && dp.items[0].productName === 'Món A' && dp.items[0].lineTotal === 92000, dp)
dung('phiếu voided (đảo do huỷ / hoàn / giao thất bại) ⇒ đã huỷ', trangThaiDonKhach(donTuPhieu({ ...phieu, status: 'voided' }), true) === 'da_huy')
dung('phiếu returned / có returnedAt ⇒ trả hàng',
    trangThaiDonKhach(donTuPhieu({ ...phieu, status: 'returned' }), true) === 'tra_hang'
    && trangThaiDonKhach(donTuPhieu({ ...phieu, returnedAt: '2026-08-10T00:00:00Z' }), true) === 'tra_hang')
const dt = donTuPhieu({ receiptNumber: 'ONLINE-TIK-586612345678901234', status: 'completed', createdAt: '2026-08-01T00:00:00Z' })
dung('không ghi chú ⇒ sàn theo tiền tố; thiếu transactionDate ⇒ createdAt; không dòng hàng; không gian hàng',
    dt.platform === 'tiktok' && ngayVN(dt.createdAt) === '01/08/2026' && dt.items.length === 0 && dt.channelName === null && dt.total === 0, dt)
dung('mã phiếu ứng viên = ONLINE- + từng mã đơn', bang(maPhieuUngVien(['SPE-X', 'TIK-X']), ['ONLINE-SPE-X', 'ONLINE-TIK-X']))

// 6. 12/11/2026 — mã đơn coi như CÔNG KHAI (in trên tem kiện) ⇒ HĐ có danh tính không trả thẳng; form /gui không ghi đè, MST chờ duyệt
dung('HĐ bán lẻ tên chung / tên che * / địa chỉ che ⇒ KHÔNG danh tính (vẫn tải thẳng)',
    !hoaDonCoDanhTinh({ buyerName: 'Khách lẻ', buyerTaxCode: '', buyerAddress: '' }, null)
    && !hoaDonCoDanhTinh({ buyerName: 'Người mua không lấy hoá đơn' }, null)
    && !hoaDonCoDanhTinh({ buyerName: 'Bán cho người tiêu dùng' }, {})
    && !hoaDonCoDanhTinh({ buyerName: 'khach tiktok' }, null)
    && !hoaDonCoDanhTinh({ buyerName: 'N****n V*n A', buyerAddress: '***, Phường 1, Quận 3' }, null)
    && !hoaDonCoDanhTinh(null, null) && !hoaDonCoDanhTinh(undefined, { name: '  ' }))
dung('HĐ có MST / tên thật / địa chỉ rõ / phiếu có thông tin người mua ⇒ CÓ danh tính',
    hoaDonCoDanhTinh({ buyerName: 'Khách lẻ', buyerTaxCode: '0312345678' }, null)
    && hoaDonCoDanhTinh({ buyerName: 'Nguyễn Văn A' }, null)
    && hoaDonCoDanhTinh({ buyerName: '', buyerAddress: '12 Lê Lợi, Q1' }, null)
    && hoaDonCoDanhTinh({ buyerName: 'Khách lẻ' }, { email: 'a@b.vn' })
    && hoaDonCoDanhTinh(null, { nationalId: '079123456789' }))

const tt = (x: any) => ({ loai: 'ca_nhan', name: '', taxCode: '', address: '', email: 'k@kh.vn', nationalId: '', nguon: 'khach-web', luc: '2026-11-12T01:00:00.000Z', ...x }) as any
const caNhan = tt({ name: 'Nguyễn Văn A', address: '1 Lê Lợi' })
const coMst = tt({ loai: 'cong_ty', name: 'Công ty TNHH X', taxCode: '0312345678', address: '2 Lê Lợi', email: 'kt@x.vn' })
dung('phiếu chưa có gì + cá nhân, chưa xuất ⇒ ghi, tự xuất như cũ, không báo',
    bang(quyetDinhGui(null, caNhan, false), { ghi: true, choDuyet: false, bao: null, ketQua: 'cho_xuat' }))
dung('phiếu chưa có gì + CÓ MST, chưa xuất ⇒ ghi kèm cờ chờ duyệt + báo nhân viên duyệt',
    bang(quyetDinhGui(null, coMst, false), { ghi: true, choDuyet: true, bao: 'can_duyet', ketQua: 'cho_duyet' }))
dung('phiếu ĐÃ có thông tin (nhân viên / Shopee / người khác) + khác ⇒ KHÔNG ghi đè, chỉ báo',
    bang(quyetDinhGui({ name: 'Công ty Y', taxCode: '0109999999', email: 'y@y.vn' }, coMst, false), { ghi: false, choDuyet: false, bao: 'khac_ban_cu', ketQua: 'da_co_ban_khac' })
    && bang(quyetDinhGui({ name: 'Công ty Y' }, caNhan, true), { ghi: false, choDuyet: false, bao: 'khac_ban_cu', ketQua: 'da_co_ban_khac' }))
dung('gửi lại y hệt (bấm 2 lần) ⇒ không ghi, không báo lần hai; giữ trạng thái chờ duyệt',
    bang(quyetDinhGui({ ...coMst, choDuyet: true }, coMst, false), { ghi: false, choDuyet: true, bao: null, ketQua: 'cho_duyet' })
    && bang(quyetDinhGui(caNhan, { ...caNhan, luc: 'khác giờ' }, false), { ghi: false, choDuyet: false, bao: null, ketQua: 'trung' })
    && quyetDinhGui({ ...caNhan, email: 'K@KH.VN ' }, caNhan, false).ghi === false)
dung('đã xuất HĐ + phiếu chưa có thông tin ⇒ ghi (điền sẵn HĐ thay thế) + báo nhân viên, KHÔNG chờ duyệt (không đường tự xuất)',
    bang(quyetDinhGui(null, coMst, true), { ghi: true, choDuyet: false, bao: 'thay_the', ketQua: 'can_thay_the' }))
dung('phiếu có vatBuyerInfo rỗng các trường ⇒ coi như chưa có',
    quyetDinhGui({ name: ' ', email: '' }, caNhan, false).ketQua === 'cho_xuat')

const hdXuat = { issuedAt: '2026-11-10T13:30:00Z', createdAt: '2026-11-10T13:30:00Z' }
dung('email nhận HĐ: nhân viên ghi (không nguon) ⇒ tin; web gửi TRƯỚC mốc xuất ⇒ tin',
    emailNhanHoaDon(hdXuat, { name: 'A', email: 'kt@x.vn' }) === 'kt@x.vn'
    && emailNhanHoaDon(hdXuat, { email: 'kt@x.vn', nguon: 'khach-web', luc: '2026-11-09T02:00:00Z' }) === 'kt@x.vn'
    && emailNhanHoaDon({ issuedAt: null, createdAt: new Date('2026-11-10T13:30:00Z') }, { email: 'kt@x.vn', nguon: 'khach-web', luc: '2026-11-09T02:00:00Z' }) === 'kt@x.vn')
dung('email nhận HĐ: web gửi SAU mốc xuất (người cầm mã đơn) / thiếu giờ gửi / thiếu mốc / email sai / không email ⇒ null',
    emailNhanHoaDon(hdXuat, { email: 'la@ke.vn', nguon: 'khach-web', luc: '2026-11-12T02:00:00Z' }) === null
    && emailNhanHoaDon(hdXuat, { email: 'la@ke.vn', nguon: 'khach-web' }) === null
    && emailNhanHoaDon({}, { email: 'la@ke.vn', nguon: 'khach-web', luc: '2026-11-09T02:00:00Z' }) === null
    && emailNhanHoaDon(hdXuat, { email: 'khong-phai-email' }) === null
    && emailNhanHoaDon(hdXuat, { name: 'A' }) === null && emailNhanHoaDon(hdXuat, null) === null)

console.log(loi ? `\n✗ ${loi} ca SAI` : '\n✓ Tất cả ca đều đúng')
process.exit(loi ? 1 : 0)
