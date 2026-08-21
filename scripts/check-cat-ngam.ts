/**
 * check:catngam — bắt giao diện CỘNG TIỀN TRÊN MỘT MẪU BỊ CẮT.
 *
 * Bệnh (đo 20/08/2026): trang gọi `useTransactions({ pageSize: 1000 })` rồi mới lọc
 * ngày ở trình duyệt và `.reduce()` ra tổng. Chọn một kỳ cũ hơn 1.000 giao dịch gần
 * nhất thì tổng tụt xuống thấp — hoặc bằng 0 — mà **không có dấu hiệu nào**. Đây là
 * kiểu nói dối khó thấy hơn "hiện 0đ khi đọc hỏng" (xem check:trungthuc): số vẫn có,
 * vẫn định dạng đẹp, chỉ là thiếu.
 *
 * Luật: đã lấy theo trang (pageSize lớn) mà còn cộng tiền thì PHẢI hoặc
 *   (a) đẩy khoảng lọc xuống máy chủ (`startDate`/`endDate`), hoặc
 *   (b) so `total` của phản hồi với số dòng lấy được rồi KHAI RÕ khi bị cắt.
 *
 * Chạy: npm run check:catngam   (mặc định quét ../open-retail)
 * Cảnh báo, không chặn (exit 0) — trừ khi có trang trong DANH_SACH_DO.
 */
import fs from 'fs'
import path from 'path'

const FE_DIR = process.argv[2] || path.resolve(__dirname, '../../open-retail')

/** Những trang đã từng dính bệnh — tái phát là ĐỎ, không cho lặng lẽ quay lại. */
const DANH_SACH_DO = ['dashboard', 'dashboard-reports', 'dashboard-cashflow', 'dashboard-customers']

const PAGESIZE_LON = /pageSize:\s*(\d{3,})/          // 100 dòng trở lên
const CO_CONG = /\.reduce\(/                         // có cộng dồn
const CO_TIEN = /formatCurrency\(|fmtCur\(|Intl\.NumberFormat|toLocaleString\('vi-VN'\)/
/** Dấu hiệu đã xử lý: chốt ngày ở máy chủ, hoặc có so total để khai phần bị cắt. */
/* Chấp nhận cả lọc-ở-máy-chủ kiểu khác: POS truyền `search`/`categoryId` nên 500 dòng là
 * 500 KẾT QUẢ TÌM chứ không phải mẫu cắt — báo nó là báo oan. */
const DA_XU_LY = /startDate:|endDate:|search:|categoryId:|\?\.total\b|\.total\s*\)?\s*>|Cat\b|catNgam/

function quet(dir: string, ra: string[] = []): string[] {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name)
        if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== '.next') quet(p, ra) }
        else if (/\.tsx$/.test(e.name)) ra.push(p)
    }
    return ra
}

const goc = path.join(FE_DIR, 'src')
if (!fs.existsSync(goc)) { console.error(`[check:catngam] Không thấy thư mục FE: ${goc}`); process.exit(2) }

const do_: { duong: string; co: string }[] = []
const canh: { duong: string; co: string }[] = []

for (const f of quet(goc)) {
    const src = fs.readFileSync(f, 'utf8')
    const m = src.match(PAGESIZE_LON)
    if (!m) continue
    if (!CO_CONG.test(src) || !CO_TIEN.test(src)) continue     // chỉ lấy dữ liệu để chọn/hiển thị — không cộng tiền
    if (DA_XU_LY.test(src)) continue
    const duong = path.relative(path.join(goc, 'app'), path.dirname(f)).replace(/\\/g, '/').replace(/\(\w+\)\//g, '')
    const ten = duong.split('/')[0]
    const muc = { duong: duong || path.basename(f), co: `pageSize: ${m[1]}` }
    if (DANH_SACH_DO.includes(ten)) do_.push(muc); else canh.push(muc)
}

console.log('=== check:catngam — có cộng tiền trên mẫu bị cắt không ===')
if (do_.length) {
    console.error(`\n❌ ${do_.length} trang TỪNG DÍNH BỆNH lại cộng tiền trên mẫu cắt:`)
    for (const x of do_) console.error(`   - ${x.duong} (${x.co})`)
    console.error('\n   Cách sửa: truyền startDate/endDate xuống máy chủ (đúng trường ngày trang đang lọc,')
    console.error('   format theo giờ địa phương), và so `total` với số dòng lấy được để khai phần bị cắt.')
} else {
    console.log('\n✅ 4 trang từng dính bệnh (dashboard, reports, cashflow, customers) đều đã chốt ngày/khai phần cắt.')
}
if (canh.length) {
    console.log(`\n⚠  ${canh.length} chỗ khác cũng cộng tiền sau khi lấy theo trang (không chặn):`)
    for (const x of canh.slice(0, 15)) console.log(`   · ${x.duong} (${x.co})`)
}
process.exit(do_.length ? 1 : 0)
