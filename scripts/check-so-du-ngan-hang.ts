/**
 * check:sodunganhang — ghi giao dịch ngân hàng và cộng số dư phải đi cùng nhau.
 *
 * Bệnh gốc (20/08/2026): mọi đường đều `bankTransaction.create()` trước, rồi mới cộng số dư ở
 * một lệnh riêng — mà `applyToBalance` lại nuốt lỗi. Cộng hỏng thì giao dịch vẫn nằm đó còn số dư
 * đứng yên: sổ ngân hàng trôi dần khỏi chính các giao dịch của nó, không dấu hiệu nào. Một đường
 * import còn cộng `balanceDelta` cho cả những dòng ghi hỏng ⇒ số dư CAO HƠN thực tế.
 *
 * Bộ soát này giữ ba luật, đọc bằng mắt cũng kiểm được:
 *   1. Mỗi `bankTransaction.create(` phải nằm trong một `$transaction` có gọi `applyToBalance`.
 *   2. Không còn `applyToBalance(prisma` — gọi ngoài transaction là quay lại bệnh cũ.
 *   3. `applyToBalance` không được `.catch` nuốt lỗi đọc/ghi số dư.
 *
 * Chạy: npm run check:sodunganhang
 */
import fs from 'fs'
import path from 'path'

const FILE = path.resolve(__dirname, '../src/routes/ebanking.ts')
const src = fs.readFileSync(FILE, 'utf8')

let dat = 0, hong = 0
const ok = (ten: string, dung: boolean, chiTiet = '') => {
    if (dung) { dat++; console.log(`  ✓ ${ten}`) }
    else { hong++; console.log(`  ✗ ${ten}${chiTiet ? ' — ' + chiTiet : ''}`) }
}

console.log('=== check:sodunganhang — giao dịch và số dư có đi cùng nhau không ===\n')

const soCreate = (src.match(/bankTransaction\.create\(/g) || []).length
const soApplyTrongTx = (src.match(/applyToBalance\(t,/g) || []).length
const soApplyNgoaiTx = (src.match(/applyToBalance\(prisma,/g) || []).length

ok(`mỗi lần ghi giao dịch đều có cộng số dư kèm (${soCreate} create ↔ ${soApplyTrongTx} applyToBalance trong transaction)`,
    soCreate > 0 && soCreate === soApplyTrongTx, `create=${soCreate} apply(t)=${soApplyTrongTx}`)

ok('không còn lệnh cộng số dư đứng NGOÀI transaction', soApplyNgoaiTx === 0,
    `còn ${soApplyNgoaiTx} chỗ gọi applyToBalance(prisma, …)`)

const than = src.slice(src.indexOf('async function applyToBalance'), src.indexOf('const sameDay'))
ok('applyToBalance không nuốt lỗi đọc/ghi số dư', !/\.catch\(/.test(than),
    'còn .catch trong thân hàm')

// Đường import: chỉ được cộng balanceDelta cho dòng ĐÃ ghi được
const coCongMuLoi = /\}\)\.catch\(\(\) => \{ skipped\+\+; imported--? \}\)\s*\n\s*imported\+\+\s*\n\s*balanceDelta \+=/.test(src)
ok('import không cộng số dư cho dòng ghi hỏng', !coCongMuLoi)

/* Luật 5: `BankTransaction.type` chỉ được là 'credit' | 'debit'. `signed()` coi MỌI type khác
 * 'debit' là TIỀN VÀO, nên một chuỗi lạ như 'withdraw' làm phiếu chi bị đếm thành tiền vào —
 * sai HƯỚNG chứ không phải lệch số lẻ (tìm ra 20/08/2026 ở expenses.ts và cashReceipts.ts). */
const GOC_SRC = path.resolve(__dirname, '../src')
const quetTs = (d: string, ra: string[] = []): string[] => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const q = path.join(d, e.name)
        if (e.isDirectory()) quetTs(q, ra)
        else if (e.name.endsWith('.ts')) ra.push(q)
    }
    return ra
}
const viPham: string[] = []
for (const f of quetTs(GOC_SRC)) {
    const dong = fs.readFileSync(f, 'utf8').split('\n')
    dong.forEach((l, i) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(l)) return                    // bỏ dòng chú thích
        /* Cửa sổ PHẢI gồm CHÍNH DÒNG NÀY: ở tax.ts lời gọi `create` và `type:` nằm CÙNG một dòng
         * dài, nên cửa sổ cũ (chỉ 8 dòng TRƯỚC đó) không hề thấy — bỏ lọt trọn vẹn. (21/08/2026) */
        const gan = dong.slice(Math.max(0, i - 8), i + 1).join('\n')
        if (!/bankTransaction\.(create|update)/i.test(gan)) return
        /* Bắt cả `type: 'x'` LẪN `type: bienGiDo || 'x'` — dạng thứ hai là chỗ tax.ts mặc định
         * 'deposit', mà regex cũ (đòi dấu nháy ngay sau dấu hai chấm) không khớp. */
        const m = l.match(/type:\s*(?:[^,}]*?\|\|\s*)?'([a-z_]+)'/)
        if (m && !['credit', 'debit'].includes(m[1])) {
            viPham.push(`${path.relative(GOC_SRC, f)}:${i + 1} → type: '${m[1]}'`)
        }
    })
}
ok("BankTransaction.type chỉ dùng 'credit' | 'debit'", viPham.length === 0, viPham.join(' · '))

/* Luật 6: KHÔNG được ĐỌC bảng này bằng từ vựng cũ ('deposit' / 'withdraw').
 * Vì sao thành luật riêng (21/08/2026): `tax.ts` đọc `bt.type === 'deposit' ? +tiền : -tiền`,
 * tức 'deposit' = vào và PHẦN CÒN LẠI = ra — NGƯỢC hẳn `signed()` (chỉ 'debit' mới là ra).
 * Hệ quả: mọi dòng ghi đúng chuẩn 'credit' bị mảng thuế TRỪ vào số dư. Cùng một cột, hai module
 * đọc bằng hai từ vựng trái nhau — luật 5 (chỉ soi lúc GHI) không thể thấy chuyện này. */
const viPhamDoc: string[] = []
for (const f of quetTs(GOC_SRC)) {
    const noiDung = fs.readFileSync(f, 'utf8')
    if (!/bankTransaction/i.test(noiDung)) continue
    noiDung.split('\n').forEach((l, i) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(l)) return
        const m = l.match(/\.type\s*(?:===?|!==?)\s*'(deposit|withdraw)'/)
        if (m) viPhamDoc.push(`${path.relative(GOC_SRC, f)}:${i + 1} → so sánh với '${m[1]}'`)
    })
}
ok("không đọc BankTransaction.type bằng từ vựng cũ", viPhamDoc.length === 0, viPhamDoc.join(' · '))

console.log(`\n${dat} đạt, ${hong} hỏng`)
process.exit(hong ? 1 : 0)
