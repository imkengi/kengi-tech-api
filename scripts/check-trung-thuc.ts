/**
 * check:trungthuc — bắt giao diện NÓI DỐI BẰNG SỐ 0.
 *
 * Bệnh (đo 20/08/2026): trang đọc API hỏng → mảng rỗng → thẻ tổng hiện "0đ" kèm
 * dòng "chưa có dữ liệu". Chủ shop đọc ra "không ai nợ" trong khi sự thật là
 * "chưa đọc được". Với trang tiền bạc, trấn an sai nguy hiểm ngang tố oan.
 *
 * Luật: trang có render tiền/tổng từ query mà KHÔNG hề nhắc tới trạng thái lỗi
 * thì không có đường nào phân biệt "rỗng" với "hỏng".
 *
 * Chạy: npm run check:trungthuc   (mặc định quét ../open-retail)
 * Đỏ (exit 1): chỉ với TRANG_TIEN. Trang khác chỉ cảnh báo — checker đỏ vĩnh viễn
 * thì người ta tắt checker chứ không sửa bệnh.
 */
import fs from 'fs'
import path from 'path'

const FE_DIR = process.argv[2] || path.resolve(__dirname, '../../open-retail')

/** Đường route (đã bỏ nhóm `(dashboard)`) của những trang chạm trực tiếp vào tiền/nợ.
 *  Dùng đường đầy đủ chứ không dùng tên thư mục: `accounts`, `add`, `edit`, `closing`
 *  trùng tên ở nhiều nhánh, gọi tên trần thì vừa nhầm vừa không tra được. */
const TRANG_TIEN = [
    'dashboard-customers', 'dashboard-debt', 'dashboard-suppliers',
    'dashboard-payment-due', 'dashboard-customer-health', 'dashboard-cashflow',
    'dashboard-financial-reports', 'dashboard-expenses',
    // Mảng thuế / kế toán
    'dashboard-tax-debtaging', 'dashboard-tax-report', 'dashboard-tax-ledger',
    'dashboard-tax-cashflow', 'dashboard-tax-ratios', 'dashboard-tax-analysis',
    'dashboard-tax-accounts', 'dashboard-tax-notes', 'dashboard-tax-payroll',
    'dashboard-tax-platform-fees', 'dashboard-tax-closing',
    'dashboard-accounting/accounts', 'dashboard-accounting/closing',
    'dashboard-tax/vat-amendment',
]

/* Bỏ qua CÓ KHAI BÁO: hai trang này khớp mẫu nhưng không đọc số liệu để hiển thị.
 * Khai ra kèm lý do thay vì lặng lẽ lọc — danh sách lọc ngầm là chỗ bệnh trốn vào. */
/* Bỏ qua thì PHẢI khai lý do — sổ điểm danh in ra hết. Danh sách rỗng đi kèm một câu "đã soi
 * mọi trang tiền" là kiểu xanh giả nguy hiểm nhất: người đọc tưởng phủ hết, thật ra chưa từng
 * nhìn tới. (Xem [[khong-buoc-toi-oan]] Dạng 14.) */
const BO_QUA: Record<string, string> = {
    'dashboard-products/add': 'form tạo mới — không đọc số liệu nào để hiện',
    '': 'trang chào kengi.vn — số nhảy là hiệu ứng đếm, không phải dữ liệu',
    /* Hai mục dưới thêm 21/08/2026 sau khi bỏ bộ lọc từ vựng ở nhánh cảnh báo nhẹ — chúng lộ ra,
     * soi tay thì đúng là ngoài phạm vi, nên khai thẳng thay vì để cảnh báo treo mãi rồi ai cũng
     * lướt qua. */
    'dashboard-currency': 'máy đổi tiền — số hiện ra tính từ ô người dùng gõ, không phải số đọc từ sổ; hỏng thì không thể bị hiểu thành "kỳ này không phát sinh"',
    'dashboard-packing-videos': 'trang video đóng gói; tiền chỉ là `refundAmount` đính kèm một dòng video. Đọc hỏng ⇒ không có dòng video nào ⇒ đọc ra là "không có video", không phải "không có tiền hoàn"',
}

const TU_TIEN = /công nợ|phải trả|phải thu|tổng nợ|doanh thu|tồn kho|thuế|lợi nhuận|chi phí/i
/* CHỈ nhận dấu hiệu THẬT của nhánh lỗi. Bản đầu nhận cả /\berror\b/ nên
 * `toast.error('Lỗi khi xóa')` cũng tính là "đã xử lý lỗi" → xanh giả, đúng cái
 * bệnh nó đi bắt. Bỏ hẳn chữ `error` thì lại báo oan trang dùng
 * `const { data, error } = useQuery(...)` — nên nhận cả dạng destructure. */
/* Chỉ nhận dấu hiệu CÓ THẬT từ tầng dữ liệu, KHÔNG nhận tên biến. Thử ngược 20/08 cho thấy: chỉ
 * cần còn một biến tên `hongNo` đã ngắt khỏi `isError` là bộ soát vẫn xanh — nó bắt trang QUÊN xử
 * lý lỗi chứ không bắt trang xử lý hình thức. `KhongDocDuoc` là khối dùng chung nên có nó nghĩa là
 * trang thật sự có đường hiển thị "chưa đọc được". */
const DAU_LOI = /isError|isLoadingError|queryError|KhongDocDuoc|,\s*error\s*[},]|if\s*\(\s*error\b|error\s*\|\||error\s*&&/

/* Nhiều trang chỉ là vỏ: page.tsx render <CashflowView/>, tiền nằm trong component
 * con. Đọc mỗi page.tsx thì kết luận "không in số tiền" là sai. Gộp thêm nội dung
 * các file NỘI BỘ mà page import (một tầng) trước khi phán. */
function docKemImport(fileTrang: string, feDir: string): string {
    const src = fs.readFileSync(fileTrang, 'utf8')
    const phan = [src]
    const re = /from\s+['"]([^'"]+)['"]/g
    let m: RegExpExecArray | null
    while ((m = re.exec(src))) {
        const spec = m[1]
        let base: string | null = null
        if (spec.startsWith('@/')) base = path.join(feDir, 'src', spec.slice(2))
        else if (spec.startsWith('.')) base = path.resolve(path.dirname(fileTrang), spec)
        if (!base) continue                       // gói ngoài (react, lucide…) — bỏ
        for (const hau of ['.tsx', '.ts', '/index.tsx', '/index.ts']) {
            const f = base + hau
            if (fs.existsSync(f) && fs.statSync(f).isFile()) { phan.push(fs.readFileSync(f, 'utf8')); break }
        }
    }
    return phan.join('\n')
}

function quet(dir: string, ra: string[] = []): string[] {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name)
        if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== '.next') quet(p, ra) }
        else if (e.name === 'page.tsx') ra.push(p)
    }
    return ra
}

const goc = path.join(FE_DIR, 'src', 'app')
if (!fs.existsSync(goc)) { console.error(`[check:trungthuc] Không thấy thư mục FE: ${goc}`); process.exit(2) }

const nang: { duong: string; ly: string }[] = []
const nhe: string[] = []
/* Sổ điểm danh: xanh mà không nói đã soi những gì thì cũng là một kiểu nói dối.
 * Ghi rõ trang nào soi, trang nào bỏ qua và VÌ SAO. */
const soDiem = new Map<string, string>(TRANG_TIEN.map(t => [t, 'KHÔNG THẤY TRANG']))

for (const f of quet(goc)) {
    const duong = path.relative(goc, path.dirname(f)).replace(/\\/g, '/').replace(/\(\w+\)\//g, '')
    const src = docKemImport(f, FE_DIR)
    const laTien = TRANG_TIEN.includes(duong)
    const coDoc = /use[A-Z]\w*\(|useQuery</.test(src)
    const coSo = /formatCurrency\(|toLocaleString\(|Intl\.NumberFormat|fmtCur\(/.test(src)
    if (!coDoc || !coSo) {
        if (laTien) soDiem.set(duong, !coDoc ? 'bỏ qua — trang không tự đọc dữ liệu' : 'bỏ qua — trang không in số tiền')
        continue
    }
    if (DAU_LOI.test(src)) {
        if (laTien) soDiem.set(duong, 'có nhánh lỗi')
        continue
    }
    if (laTien) { soDiem.set(duong, 'THIẾU nhánh lỗi'); nang.push({ duong, ly: TU_TIEN.test(src) ? 'trang tiền, có chữ tiền' : 'trang tiền' }) }
    /* Cảnh báo nhẹ: KHÔNG lọc thêm bằng `TU_TIEN` nữa.
     *
     * Tới đây đã biết chắc trang có ĐỌC dữ liệu (`coDoc`) và có IN TIỀN (`coSo`) — thế là đủ để
     * đáng nhắc. Lọc thêm bằng từ vựng kế toán (`công nợ|doanh thu|thuế|…`) thì các trang dùng chữ
     * khác bị nuốt mất: đo 21/08 lấy mẫu 8 trang thì 6 trang THIẾU nhánh lỗi mà danh sách này rỗng
     * — gồm cả `dashboard-payroll` (lương), `dashboard-purchase-orders`, `dashboard-returns`,
     * `dashboard-reports`. Bộ soát im lặng đúng chỗ nó sinh ra để nói. */
    else if (!(duong in BO_QUA)) nhe.push(duong)
}

console.log('=== check:trungthuc — giao diện có phân biệt "rỗng" với "hỏng" không ===')
if (nang.length) {
    console.error(`\n❌ ${nang.length} TRANG TIỀN không có nhánh lỗi (hỏng sẽ hiện 0đ như thể không nợ):`)
    for (const x of nang) console.error(`   - ${x.duong}  (${x.ly})`)
    console.error('\n   Cách sửa: lấy isError từ hook, đặt cờ (vd `const hong = isError && !data`),')
    console.error('   rồi `if (hong) return <KhongDocDuoc nguon="…" />` (src/components/ui/khong-doc-duoc.tsx),')
    console.error('   hoặc cho thẻ tổng hiện "—" thay vì 0.')
} else {
    console.log('\n✅ Mọi trang tiền ĐÃ SOI đều có nhánh lỗi.')
}
console.log('\n--- Sổ điểm danh trang tiền (soi gì, bỏ gì) ---')
for (const [duong, tt] of soDiem) console.log(`   ${tt === 'có nhánh lỗi' ? '✓' : tt === 'THIẾU nhánh lỗi' ? '✗' : '·'} ${duong}: ${tt}`)
const boQua = Object.entries(BO_QUA)
if (boQua.length) {
    console.log('\n· Bỏ qua có khai báo:')
    for (const [d, ly] of boQua) console.log(`   ${d || '(trang chào)'}: ${ly}`)
}
if (nhe.length) {
    console.log(`\n⚠  ${nhe.length} trang khác cũng in số tiền mà chưa có nhánh lỗi (không chặn):`)
    console.log('   ' + nhe.slice(0, 25).join(', ') + (nhe.length > 25 ? ` … +${nhe.length - 25}` : ''))
}
process.exit(nang.length ? 1 : 0)
