/**
 * check:hooknuotloi — bắt `queryFn` TỰ NUỐT LỖI, làm mọi nhánh `isError` phía trang thành vô dụng.
 *
 * Vì sao (21/08/2026): react-query chỉ bật `isError` khi `queryFn` **NÉM**. Hook nào tự bọc
 * try/catch rồi trả hằng số rỗng thì `isError` mãi mãi false — và khối "Không đọc được…" thêm vào
 * trang chỉ là TRANG TRÍ, màn hình vẫn bày 0đ như số thật.
 *
 * Đây là thứ `check:trungthuc` KHÔNG thấy: nó kiểm trang CÓ nhánh lỗi hay không, không kiểm nhánh
 * đó có bao giờ chạy. Tối 20/08 tôi vá 10 tab thuế mà không biết chúng nằm sau 38 hook nuốt lỗi.
 *
 * Chạy: npm run check:hooknuotloi   (mặc định quét ../open-retail)
 * Đỏ: chỉ với hook nuôi các TRANG TIỀN đã khai; còn lại cảnh báo.
 */
import fs from 'fs'
import path from 'path'

const FE_DIR = process.argv[2] || path.resolve(__dirname, '../../open-retail')

/** Hook nuôi trang tiền — nuốt lỗi ở đây là làm hỏng nhánh lỗi của trang tiền. */
const HOOK_TIEN = [
    'useCITCalculation', 'useCashBook', 'useBalanceSheet', 'useRevenueAnalysis',
    'useChartOfAccountsTree', 'useDebtAging', 'useDebtSummary', 'usePaymentDue',
    'useSuppliers', 'useCustomers', 'useExpenses', 'useTransactions', 'useFinancialReport',
]

function quet(dir: string, ra: string[] = []): string[] {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name)
        if (e.isDirectory()) { if (!['node_modules', '.next'].includes(e.name)) quet(p, ra) }
        else if (/\.(ts|tsx)$/.test(e.name)) ra.push(p)
    }
    return ra
}

const goc = path.join(FE_DIR, 'src')
if (!fs.existsSync(goc)) { console.error(`[check:hooknuotloi] Không thấy ${goc}`); process.exit(2) }

const do_: string[] = []
const canh: string[] = []

const dsFile = quet(goc)
for (const f of dsFile) {
    const dong = fs.readFileSync(f, 'utf8').split('\n')
    for (let i = 0; i < dong.length; i++) {
        if (!/queryFn:/.test(dong[i])) continue
        /* Cửa sổ phải DỪNG ở hook kế tiếp. Bản đầu lấy cứng 18 dòng nên `catch` của hook SAU bị
         * tính cho hook TRƯỚC — báo oan đúng hai hook vừa sửa xong (21/08/2026). */
        let het = i + 1
        while (het < dong.length && het < i + 40
            && !/queryFn:/.test(dong[het]) && !/export const use/.test(dong[het])) het++
        const khoi = dong.slice(i, het).join('\n')
        if (!/catch\s*[({]/.test(khoi)) continue
        // Tên hook: dò ngược tới `export const useX` gần nhất
        let ten = ''
        for (let j = i; j >= Math.max(0, i - 25); j--) {
            const m = dong[j].match(/export const (use[A-Za-z0-9_]+)/)
            if (m) { ten = m[1]; break }
        }
        const rel = path.relative(goc, f).replace(/\\/g, '/')
        const muc = `${rel}:${i + 1}${ten ? ` (${ten})` : ''}`
        if (ten && HOOK_TIEN.includes(ten)) do_.push(muc); else canh.push(muc)
    }
}

console.log('=== check:hooknuotloi — queryFn tự nuốt lỗi (làm isError vô dụng) ===\n')
if (do_.length) {
    console.error(`❌ ${do_.length} HOOK TIỀN nuốt lỗi trong queryFn:`)
    for (const x of do_) console.error(`   - ${x}`)
    console.error('\n   Bỏ try/catch trong queryFn để react-query bật isError. Trước khi bỏ, kiểm trang')
    console.error('   dùng hook đó có chịu được `data === undefined` không (nếu không sẽ trắng màn hình).')
} else {
    if (!dsFile.length) { console.log('⛔ KHÔNG KẾT LUẬN ĐƯỢC — soi 0 file, đường quét hỏng.'); process.exit(2) }
    console.log(`✅ Không hook tiền nào nuốt lỗi trong queryFn — đã soi ${dsFile.length} file.`)
}
if (canh.length) {
    console.log(`\n⚠  ${canh.length} hook khác cũng nuốt lỗi trong queryFn (không chặn — cần soi từng trang rồi mới gỡ):`)
    for (const x of canh.slice(0, 12)) console.log(`   · ${x}`)
    if (canh.length > 12) console.log(`   … +${canh.length - 12} chỗ nữa`)
}
process.exit(do_.length ? 1 : 0)
