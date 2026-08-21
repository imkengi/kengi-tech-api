/**
 * check:nhanhloichet — NHÁNH LỖI CHẾT: trang có `isError` nhưng hook của nó NUỐT lỗi.
 *
 * Vì sao cần một bộ soát riêng (21/08/2026): hai bộ có sẵn mỗi cái nhìn một nửa —
 *   · `check:trungthuc`   — trang tiền có nhánh lỗi không?         (nhìn TRANG)
 *   · `check:hooknuotloi` — hook nào nuốt lỗi trong `queryFn`?      (nhìn HOOK)
 * Cả hai cùng XANH mà vẫn hỏng, khi **trang có nhánh lỗi đúng chuẩn nhưng hook của nó nuốt lỗi**:
 * `isError` không bao giờ thành `true`, nên nhánh "không đọc được" là **mã chết**. Giao diện trông
 * rất tử tế, chạy thật thì vẫn hiện bảng rỗng như cũ.
 *
 * Chính tôi vừa tạo ra lỗi này: thêm nhánh lỗi cho `DepreciationTab` và `TrialBalanceTab`, trong
 * khi `useFixedAssets` / `useTrialBalance` / `useJournalEntries` vẫn `catch { return {...rỗng} }`.
 * Tệ hơn: hai hook kia còn trả `isBalanced: true` khi lỗi — đọc hỏng mà KHẲNG ĐỊNH "sổ cân".
 *
 * Cách soi: gom tên hook có `catch` trong `queryFn`, rồi tìm component nào lấy `isError` từ đúng
 * hook đó. Trùng nhau ⇒ nhánh lỗi chết.
 *
 * Chạy: npm run check:nhanhloichet
 */
import fs from 'fs'
import path from 'path'

const FE_DIR = process.argv[2] || path.resolve(__dirname, '../../open-retail')
const SRC = path.join(FE_DIR, 'src')

function quet(d: string, ra: string[] = []): string[] {
    if (!fs.existsSync(d)) return ra
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name)
        if (e.isDirectory()) { if (!['node_modules', '.next', 'out'].includes(e.name)) quet(p, ra) }
        else if (/\.(ts|tsx)$/.test(e.name)) ra.push(p)
    }
    return ra
}

/** Thân của `useQuery({...})` bắt đầu từ vị trí `tu` — dừng khi ngoặc nhọn cân bằng lại. */
function than(src: string, tu: number): string {
    const mo = src.indexOf('{', tu)
    if (mo < 0) return ''
    let sau = 0
    for (let i = mo; i < src.length; i++) {
        if (src[i] === '{') sau++
        else if (src[i] === '}') { sau--; if (sau === 0) return src.slice(mo, i + 1) }
    }
    return ''
}

/* ── 1. Hook nào NUỐT lỗi ────────────────────────────────────────────────────── */
const hookNuot = new Map<string, string>()   // tên hook → file:dòng
const dsFile = quet(SRC)
for (const f of dsFile) {
    const src = fs.readFileSync(f, 'utf8')
    for (const m of src.matchAll(/export const (use[A-Z]\w*)\s*=[\s\S]{0,200}?useQuery/g)) {
        const ten = m[1]
        const t = than(src, m.index! + m[0].length)
        if (!t) continue
        /* `catch` bên trong queryFn = nuốt. Không xét `onError` (đó là báo cho người dùng, khác).
         *
         * NHƯNG: `catch` có `throw` bên trong thì KHÔNG phải nuốt — đó là **đường lùi có kỷ luật**:
         * thử cách A, hỏng thì thử cách B, cả hai hỏng mới ném ra. `usePayrollAccounting` đúng kiểu
         * đó (API lương → tính từ sổ nhật ký → ném). Bản đầu của bộ soát này báo oan chính đoạn mã
         * tôi vừa sửa cho đúng. Phép soi thô (chỉ cần queryFn có chữ `throw`) — chấp nhận bỏ sót
         * hơn là báo oan, vì báo oan sẽ khiến người ta gỡ mất đường lùi tốt. */
        const qf = t.indexOf('queryFn')
        if (qf < 0) continue
        const thanQf = than(t, qf)
        if (/\bcatch\s*[({]/.test(thanQf) && !/\bthrow\b/.test(thanQf)) {
            hookNuot.set(ten, `${path.relative(SRC, f).replace(/\\/g, '/')}:${src.slice(0, m.index!).split('\n').length}`)
        }
    }
}

/* ── 2. Component nào lấy `isError` từ hook đó ───────────────────────────────── */
const chet: string[] = []

for (const f of dsFile) {
    if (!/\.tsx$/.test(f)) continue
    const src = fs.readFileSync(f, 'utf8')
    const ten = path.relative(SRC, f).replace(/\\/g, '/')
    /* `const { … isError … } = useCaiGiDo(...)` — kể cả khi đổi tên (`isError: tbError`). */
    for (const m of src.matchAll(/const\s*\{([^}]*isError[^}]*)\}\s*=\s*(use[A-Z]\w*)\s*\(/g)) {
        const hook = m[2]
        if (!hookNuot.has(hook)) continue
        const dong = src.slice(0, m.index!).split('\n').length
        chet.push(`${ten}:${dong}\n      lấy \`isError\` từ \`${hook}()\` — nhưng hook đó NUỐT lỗi (${hookNuot.get(hook)})\n      ⇒ isError không bao giờ true ⇒ nhánh "không đọc được" là MÃ CHẾT`)
    }
}

console.log('=== check:nhanhloichet — nhánh lỗi mắc vào hook nuốt lỗi ===\n')
console.log(`· ${hookNuot.size} hook đang nuốt lỗi trong queryFn (không phải cái nào cũng có hại — chỉ hại khi có trang bắt isError)\n`)
if (chet.length) {
    console.log(`❌ ${chet.length} nhánh lỗi CHẾT:`)
    for (const c of chet) console.log('   - ' + c)
    console.log('\n→ Sửa HOOK (bỏ `catch` trong `queryFn`), đừng gỡ nhánh lỗi ở trang.')
    console.log('  Nhớ soi các nơi khác cùng dùng hook đó: chúng phải chịu được `data === undefined`.')
    process.exit(1)
}
console.log(`✅ Không nhánh lỗi nào mắc vào hook nuốt lỗi — đã soi ${dsFile.length} file.`)
if (!dsFile.length) { console.log('⛔ NHƯNG SOI 0 FILE — đường quét hỏng, KHÔNG kết luận được.'); process.exit(2) }
