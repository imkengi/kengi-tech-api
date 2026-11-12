/**
 * BỘ KIỂM: mã bí mật nằm trong đường dẫn không được vào log request (lib/cheDuongDan.ts, 12/11/2026).
 * Chạy: npm run check:che-duong-dan
 */
import * as fs from 'fs'
import * as path from 'path'
import { cheBiMatDuongDan } from '../src/lib/cheDuongDan'

let dat = 0, hong = 0
const ok = (ten: string, dk: boolean, ct = '') => { dk ? dat++ : hong++; console.log(`${dk ? '✓' : '✗'} ${ten}${ct && !dk ? ' — ' + ct : ''}`) }
const T = 'ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12cd34ef56'   // 48 ký tự, giả

const a = cheBiMatDuongDan(`/api/kiotviet/webhook/CUAHANG/${T}`)
ok('1. webhook KiotViet: token bị che, còn 4 ký tự đầu + mã cửa hàng', a === '/api/kiotviet/webhook/CUAHANG/ab12***' && !a.includes(T), a)
const b = cheBiMatDuongDan('/api/meinvoice/hd/HD001/tokNgan9')
ok('2. đường khách mở hoá đơn: token NGẮN cũng che (theo khuôn đường, không theo độ dài)', b === '/api/meinvoice/hd/HD001/tokN***', b)
const c = cheBiMatDuongDan(`/api/storage/cuc-bo/${T}`)
ok('3. phiên tải tệp: token bị che', c === '/api/storage/cuc-bo/ab12***', c)
ok('4. token 4 ký tự trở xuống ⇒ che hết', cheBiMatDuongDan('/api/storage/cuc-bo/abcd') === '/api/storage/cuc-bo/***')
const cuid = 'cmshaxlnt001ds601bgkdbddx'
const d = cheBiMatDuongDan(`/api/customers/${cuid}/debt-history`)
ok('5. mã bản ghi (cuid 25 ký tự), mã đơn, tên đường thường ⇒ GIỮ NGUYÊN', d === `/api/customers/${cuid}/debt-history` && cheBiMatDuongDan('/api/transactions/HD032063') === '/api/transactions/HD032063' && cheBiMatDuongDan('/api/health') === '/api/health', d)
const e = cheBiMatDuongDan(`/api/duong-moi-chua-khai/${T}/chi-tiet`)
ok('6. lưới an toàn: đường CHƯA khai khuôn mà có đoạn ≥ 32 ký tự kiểu token ⇒ vẫn che', e === '/api/duong-moi-chua-khai/ab12***/chi-tiet', e)
ok('7. đoạn dài nhưng có ký tự khác (tên tệp có dấu chấm) ⇒ không che nhầm', cheBiMatDuongDan('/api/tep/bao-cao-doanh-thu-thang-11-nam-2026-ban-cuoi.xlsx') === '/api/tep/bao-cao-doanh-thu-thang-11-nam-2026-ban-cuoi.xlsx')
ok('8. rỗng / không phải chuỗi ⇒ không ném', cheBiMatDuongDan('') === '' && cheBiMatDuongDan(undefined as any) === '')

const nguon = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.ts'), 'utf8')
ok('9. dòng log request của index.ts đi qua cheBiMatDuongDan, không còn in thẳng req.path', /console\.log\([^\n]*cheBiMatDuongDan\(req\.path\)/.test(nguon) && !/console\.log\([^\n]*\$\{req\.path\}/.test(nguon))
// đường mới mang :token trong địa chỉ phải được khai khuôn (lưới ≥ 32 ký tự không bắt token ngắn)
const thuMuc = path.join(__dirname, '..', 'src', 'routes')
const coToken: string[] = []
for (const f of fs.readdirSync(thuMuc)) {
    if (!f.endsWith('.ts')) continue
    const s = fs.readFileSync(path.join(thuMuc, f), 'utf8')
    for (const m of s.matchAll(/router\.(?:get|post|put|patch|delete)\(\s*'([^']*:token[^']*)'/g)) coToken.push(`${f}:${m[1]}`)
}
const DA_KHAI = ['kiotviet.ts:/webhook/:storeCode/:token', 'meInvoice.ts:/hd/:ma/:token', 'storage.ts:/cuc-bo/:token']
const chuaKhai = coToken.filter(x => !DA_KHAI.includes(x))
ok('10. mọi route có :token trong địa chỉ đều đã khai khuôn che (thêm route mới ⇒ khai vào lib/cheDuongDan.ts + danh sách này)', chuaKhai.length === 0 && coToken.length >= 3, 'chưa khai: ' + chuaKhai.join(', '))

console.log(`\n${hong === 0 ? '✅' : '❌'} ${dat} đạt, ${hong} hỏng`)
process.exit(hong ? 1 : 0)
