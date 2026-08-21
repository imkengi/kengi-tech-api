/**
 * check:nuottruong — bắt "LƯU THÀNH CÔNG GIẢ": FE gửi trường mà route KHÔNG hề đọc.
 *
 * Bệnh (tìm ra 21/08/2026 khi lần theo `check:api`): trang Bảo hành gửi `supplierId`,
 * `supplierName`, `supplierBatchCode` trong `PUT /repairs/:id`; route chỉ bóc 12 trường khác nên ba
 * trường kia rơi im lặng, máy chủ vẫn trả **200 OK**, màn hình vẫn báo "Đã gửi… lô GNCC-…".
 * Tải lại trang là mất sạch.
 *
 * Đây KHÔNG phải lần đầu: chính `repairs.ts` có ghi chú đã sửa đúng bệnh này cho
 * `customerName`/`customerPhone` ngày 13/08/2026. Cùng một file, cùng một lỗi, hai lần.
 *
 * Cách soi: lấy KEY trong object literal mà FE truyền cho `apiClient.put/post/patch`, so với các
 * tên được route destructure từ `req.body` (hoặc dùng trực tiếp `req.body.x`). Không khớp ⇒ nghi.
 *
 * Đây là phép soi THEO CHUỖI, không phải hiểu code: nó bỏ sót route nhận cả `req.body` một cục, và
 * có thể báo oan chỗ đặt tên động. Vì vậy CẢNH BÁO, không chặn — trừ danh sách đã biết là đỏ thật.
 *
 * Chạy: npm run check:nuottruong
 */
import fs from 'fs'
import path from 'path'

const FE_DIR = process.argv[2] || path.resolve(__dirname, '../../open-retail')
const BE_DIR = path.resolve(__dirname, '..')

/** Đã xác nhận là bệnh thật — để đỏ cho tới khi sửa xong. */
const DA_BIET_DO = [
    'PUT /repairs/:id → supplierId, supplierName, supplierBatchCode',
]

function quet(dir: string, duoi: string[], ra: string[] = []): string[] {
    if (!fs.existsSync(dir)) return ra
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name)
        if (e.isDirectory()) { if (!['node_modules', '.next', 'generated'].includes(e.name)) quet(p, duoi, ra) }
        else if (duoi.some(d => e.name.endsWith(d))) ra.push(p)
    }
    return ra
}

/* ── 1. Bảng route BE: tên file → các trường route đó ĐỌC từ req.body ───────────────────── */
const truongCuaRoute = new Map<string, Set<string>>()   // 'put /repairs/:id' → {status, cost, …}
for (const f of quet(path.join(BE_DIR, 'src/routes'), ['.ts'])) {
    const ten = path.basename(f, '.ts')
    const dong = fs.readFileSync(f, 'utf8').split('\n')
    for (let i = 0; i < dong.length; i++) {
        const m = dong[i].match(/router\.(put|post|patch)\('([^']*)'/)
        if (!m) continue
        /* Thân route phải DỪNG ở route kế tiếp, không lấy cứng N dòng: lấy thiếu thì bỏ sót phần
         * bóc body nằm dưới (báo oan), lấy thừa thì ăn sang route sau (bỏ lọt). */
        let het = i + 1
        while (het < dong.length && !/^\s*router\.(get|put|post|patch|delete)\(/.test(dong[het])) het++
        const than = dong.slice(i, het).join('\n')
        const nhan = new Set<string>()
        // const { a, b, c } = req.body   (có thể trải nhiều dòng)
        for (const d of than.matchAll(/const\s*\{([^}]*)\}\s*=\s*(?:req\.body|b)\b/g)) {
            for (const k of d[1].split(',')) {
                const ten2 = k.split(':')[0].split('=')[0].trim()
                if (/^[A-Za-z_$][\w$]*$/.test(ten2)) nhan.add(ten2)
            }
        }
        /* req.body.x · b.x · và CẢ `req.body?.x` — thiếu dấu `?` là báo oan hàng loạt
         * (đo 21/08: `/mailbox/connect` đọc `req.body?.email` mà bị kêu là không đọc). */
        for (const d of than.matchAll(/\b(?:req\.body|b)\??\.([A-Za-z_$][\w$]*)/g)) nhan.add(d[1])
        // Route nhận cả cục (…req.body) thì coi như nhận hết — đánh dấu '*'
        if (/\.\.\.\s*(?:req\.body|b)\b/.test(than) || /data:\s*(?:req\.body|b)\b/.test(than)) nhan.add('*')
        truongCuaRoute.set(`${m[1]} ${ten} ${m[2]}`, nhan)
    }
}

/* ── 2. Lời gọi FE có object literal ────────────────────────────────────────────────────── */
type Goi = { file: string; dong: number; method: string; duong: string; keys: string[] }
const goiFE: Goi[] = []
for (const f of quet(path.join(FE_DIR, 'src'), ['.ts', '.tsx'])) {
    const src = fs.readFileSync(f, 'utf8')
    const re = /apiClient\.(put|post|patch)\(\s*[`'"]([^`'"]+)[`'"]\s*,\s*\{([^}]*)\}/g
    let m: RegExpExecArray | null
    while ((m = re.exec(src))) {
        const keys = m[3].split(',').map(k => k.split(':')[0].trim())
            .filter(k => /^[A-Za-z_$][\w$]*$/.test(k))
        if (!keys.length) continue
        goiFE.push({
            file: path.relative(FE_DIR, f).replace(/\\/g, '/'),
            dong: src.slice(0, m.index).split('\n').length,
            method: m[1], duong: m[2].replace(/\$\{[^}]*\}/g, ':p'), keys,
        })
    }
}

/* ── 3. So khớp ─────────────────────────────────────────────────────────────────────────── */
const doanCua = (d: string) => d.split('?')[0].split('/').filter(Boolean)
const khop = (goi: string, route: string) => {
    const a = doanCua(goi), b = doanCua(route)
    if (a.length !== b.length) return false
    return a.every((x, i) => b[i].startsWith(':') || x === ':p' || x === b[i])
}

const nghi: string[] = []
for (const g of goiFE) {
    const doan = doanCua(g.duong)
    if (!doan.length) continue
    const mount = doan[0]                                   // 'repairs', 'customers', …
    const con = '/' + doan.slice(1).join('/')
    for (const [khoa, nhan] of truongCuaRoute) {
        const [meth, ten, duong] = khoa.split(' ')
        if (meth !== g.method || ten !== mount) continue
        if (!khop(con === '/' ? '/' : con, duong)) continue
        if (nhan.has('*')) break
        const thieu = g.keys.filter(k => !nhan.has(k))
        if (thieu.length) nghi.push(`${g.method.toUpperCase()} /${mount}${duong}  ←  ${g.file}:${g.dong}\n      route KHÔNG đọc: ${thieu.join(', ')}`)
        break
    }
}

console.log('=== check:nuottruong — FE gửi trường mà route không đọc ("lưu thành công giả") ===\n')
if (nghi.length) {
    console.log(`⚠  ${nghi.length} chỗ nghi (soi tay trước khi kết luận — phép soi này đọc chuỗi, không hiểu code):`)
    for (const n of nghi.slice(0, 20)) console.log('   - ' + n)
    if (nghi.length > 20) console.log(`   … +${nghi.length - 20} chỗ nữa`)
} else {
    console.log('✅ Không thấy chỗ nào FE gửi trường mà route bỏ qua.')
}
console.log('\n· Đã xác nhận là bệnh thật (chờ sửa):')
for (const d of DA_BIET_DO) console.log('   ✗ ' + d)
process.exit(0)   // cảnh báo, không chặn
