/**
 * BỘ KIỂM: thông tin pháp lý của đơn vị vận hành (lib/thongTinPhapLy.ts, 12/11/2026).
 * Chạy: npm run check:thong-tin-phap-ly
 */
import * as fs from 'fs'
import * as path from 'path'
import { chuanHoaThongTin, rongThongTin, TRUONG_PHAP_LY } from '../src/lib/thongTinPhapLy'

let dat = 0, hong = 0
const ok = (ten: string, dk: boolean, ct = '') => { dk ? dat++ : hong++; console.log(`${dk ? '✓' : '✗'} ${ten}${ct && !dk ? ' — ' + ct : ''}`) }

const r = rongThongTin()
ok('1. mặc định RỖNG — không tự điền tên/MST/địa chỉ nào', TRUONG_PHAP_LY.every(k => r[k] === '') && r.capNhatLuc === null)
const a = chuanHoaThongTin({ tenDonVi: '  Hộ kinh doanh A  ', loaiHinh: 'ho-kinh-doanh', maSoThue: '0123456789', email: 'a@b.vn', thuaRa: 'x' })
ok('2. hợp lệ: cắt khoảng trắng, bỏ trường lạ, trường thiếu ⇒ chuỗi rỗng', a.ok && a.gt.tenDonVi === 'Hộ kinh doanh A' && !('thuaRa' in a.gt) && a.gt.diaChi === '', JSON.stringify(a))
ok('3. MST 10 số / 10-3 / 12 số (CCCD) đều nhận', ['0123456789', '0123456789-001', '012345678901'].every(m => chuanHoaThongTin({ maSoThue: m }).ok))
ok('4. MST sai khuôn ⇒ từ chối', !chuanHoaThongTin({ maSoThue: '12345' }).ok && !chuanHoaThongTin({ maSoThue: 'abc0123456' }).ok)
ok('5. loại hình lạ ⇒ từ chối', !chuanHoaThongTin({ loaiHinh: 'tap-doan' }).ok)
ok('6. email sai ⇒ từ chối (cả email người phụ trách dữ liệu)', !chuanHoaThongTin({ email: 'khong-phai-email' }).ok && !chuanHoaThongTin({ emailPhuTrachDuLieu: 'x@' }).ok)
ok('7. không phải chuỗi / không phải đối tượng / quá dài ⇒ từ chối, không ném', !chuanHoaThongTin({ tenDonVi: 123 }).ok && !chuanHoaThongTin(null).ok && !chuanHoaThongTin([]).ok && !chuanHoaThongTin({ diaChi: 'x'.repeat(301) }).ok)

const goc = path.join(__dirname, '..', 'src')
const idx = fs.readFileSync(path.join(goc, 'index.ts'), 'utf8')
const adm = fs.readFileSync(path.join(goc, 'routes', 'admin.ts'), 'utf8')
const viTriUse = adm.indexOf('router.use(adminKeyAuth)')
ok('8. sửa (PUT) chỉ nằm trong admin.ts SAU router.use(adminKeyAuth)', viTriUse > 0 && adm.indexOf("router.put('/thong-tin-phap-ly'") > viTriUse)
ok('9. đường công khai CHỈ có GET, không có PUT/POST ở index.ts', /app\.get\('\/api\/thong-tin-phap-ly'/.test(idx) && !/app\.(put|post|patch|delete)\('\/api\/thong-tin-phap-ly'/.test(idx))
const lib = fs.readFileSync(path.join(goc, 'lib', 'thongTinPhapLy.ts'), 'utf8')
const docHam = lib.slice(lib.indexOf('export async function docThongTinPhapLy'), lib.indexOf('export async function luuThongTinPhapLy'))
ok('10. hàm đọc (dùng cho đường công khai) KHÔNG tạo bảng', docHam.length > 0 && !/CREATE TABLE/i.test(docHam))

console.log(`\n${hong === 0 ? '✅' : '❌'} ${dat} đạt, ${hong} hỏng`)
process.exit(hong ? 1 : 0)
