/**
 * SOÁT LỆCH HỢP ĐỒNG API giữa frontend và backend.
 *
 * Chạy:  npx tsx scripts/check-api-contract.ts [đường-dẫn-repo-frontend]
 *        (mặc định ../open-retail)
 *
 * Vì sao cần: hook ở frontend gần như luôn bọc `try { ... } catch { return [] }`.
 * Gọi nhầm một đường không tồn tại thì KHÔNG có lỗi đỏ nào — trang chỉ hiện
 * trống mãi mãi và không ai biết. Đợt soát tay 13/08/2026 tìm ra 5 đường như vậy
 * ở riêng mảng thuế, làm chết hẳn 3 tab (Khóa Sổ, Kết Chuyển, Nghĩa Vụ Thuế).
 *
 * Công cụ này đọc:
 *  - mọi lời gọi apiClient.<method>('/đường/dẫn') trong frontend,
 *  - mọi route đã đăng ký ở backend (app.use tiền tố + router.<method> đường con),
 * rồi chỉ ra lời gọi không khớp route nào.
 *
 * Có sai sót cố hữu: đường dẫn ghép chuỗi động không đọc được hết. Vì vậy công
 * cụ chỉ CẢNH BÁO chứ không làm đỏ CI, và bỏ qua những mẫu nó không chắc.
 */

import fs from 'fs'
import path from 'path'

const FE_DIR = process.argv[2] || path.resolve(__dirname, '../../open-retail')
const BE_DIR = path.resolve(__dirname, '..')

function quetFile(dir: string, duoi: string[], ra: string[] = []): string[] {
    let muc: fs.Dirent[]
    try { muc = fs.readdirSync(dir, { withFileTypes: true }) } catch { return ra }
    for (const m of muc) {
        if (m.name === 'node_modules' || m.name === '.next' || m.name === '.git' || m.name === 'out') continue
        const p = path.join(dir, m.name)
        if (m.isDirectory()) quetFile(p, duoi, ra)
        else if (duoi.some(d => m.name.endsWith(d))) ra.push(p)
    }
    return ra
}

/**
 * "/tax/vat-amendment/${id}/submit?x=1" → "/tax/vat-amendment/:p/submit"
 *
 * Hai chỗ dễ đọc sai:
 *  - `${qs ? `?${qs}` : ''}` có dấu nháy ngược lồng bên trong nên biểu thức bắt
 *    chuỗi dừng giữa chừng, để lại "${qs " lơ lửng;
 *  - phần chèn KHÔNG đứng sau dấu / là đuôi query chứ không phải một đoạn đường.
 * Cả hai trường hợp đều cắt bỏ từ chỗ chèn trở đi và so khớp phần đầu.
 */
function chuanHoa(duong: string): string {
    let d = duong.split('?')[0]
    const i = d.indexOf('${')
    if (i > 0 && d[i - 1] !== '/') d = d.slice(0, i)   // đuôi động → bỏ
    d = d.replace(/\$\{[^}]*\}/g, ':p')                // đoạn đường động → :p
    d = d.replace(/\$\{.*$/, '')                       // chèn còn dang dở
    d = d.replace(/\/+$/, '')
    return d || '/'
}

/** Route backend thành mẫu so khớp: "/tax/vat-amendment/:id/submit" → mảng đoạn */
function doanCua(duong: string): string[] {
    return chuanHoa(duong).split('/').filter(Boolean)
}

function khop(goi: string, route: string): boolean {
    const a = doanCua(goi), b = doanCua(route)
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) {
        const ra = a[i], rb = b[i]
        if (rb.startsWith(':')) continue        // backend nhận tham số động
        if (ra === ':p') continue               // frontend chèn biến vào chỗ này
        if (ra !== rb) return false
    }
    return true
}

// ── 1. Route đã đăng ký ở backend ────────────────────────────────────────────
const indexTs = fs.readFileSync(path.join(BE_DIR, 'src/index.ts'), 'utf8')

/** biến router → tên file, lấy từ dòng import */
const bienToFile = new Map<string, string>()
for (const m of indexTs.matchAll(/import\s+(\w+)\s+from\s+'\.\/routes\/(\w+)'/g)) {
    bienToFile.set(m[1], m[2])
}

/** tiền tố mount → danh sách file router (một tiền tố có thể mount nhiều router) */
const mount: Array<{ tienTo: string; file: string }> = []
for (const m of indexTs.matchAll(/app\.use\('(\/api\/[^']*)',\s*(?:[\w.]+,\s*)*(\w+)\)/g)) {
    const file = bienToFile.get(m[2])
    if (file) mount.push({ tienTo: m[1], file })
}

const routeBE: Array<{ method: string; duong: string; file: string }> = []
for (const { tienTo, file } of mount) {
    const p = path.join(BE_DIR, 'src/routes', file + '.ts')
    let noiDung: string
    try { noiDung = fs.readFileSync(p, 'utf8') } catch { continue }
    for (const m of noiDung.matchAll(/router\.(get|post|put|patch|delete)\(\s*'([^']*)'/g)) {
        const duong = (tienTo + (m[2] === '/' ? '' : m[2])).replace(/^\/api/, '')
        routeBE.push({ method: m[1].toUpperCase(), duong, file })
    }
}

// ── 2. Lời gọi ở frontend ────────────────────────────────────────────────────
const fileFE = quetFile(path.join(FE_DIR, 'src'), ['.ts', '.tsx'])
const goiFE: Array<{ method: string; duong: string; file: string; raw: string }> = []
for (const f of fileFE) {
    const noiDung = fs.readFileSync(f, 'utf8')
    for (const m of noiDung.matchAll(/apiClient\.(get|post|put|patch|delete)\(\s*[`'"]([^`'"]*)[`'"]/g)) {
        const raw = m[2]
        if (!raw.startsWith('/')) continue          // đường ghép động — không đọc được
        goiFE.push({ method: m[1].toUpperCase(), duong: chuanHoa(raw), file: path.relative(FE_DIR, f), raw })
    }
}

// ── 3. Đối chiếu ─────────────────────────────────────────────────────────────
type Thieu = { method: string; duong: string; file: string; goiY: string[] }
const thieu: Thieu[] = []
const daBao = new Set<string>()

for (const g of goiFE) {
    const co = routeBE.some(r => r.method === g.method && khop(g.duong, r.duong))
    if (co) continue

    /* Đường có đuôi động mà frontend ghép chuỗi (vd `/x/${a}${b}`) rất dễ đọc sai
     * → nếu có route nào cùng tiền tố 2 đoạn đầu thì coi như khớp, thà bỏ sót còn
     * hơn báo bừa làm cả bảng mất tin cậy. */
    const dau = doanCua(g.duong).slice(0, 2).join('/')
    if (dau && routeBE.some(r => r.method === g.method && doanCua(r.duong).slice(0, 2).join('/') === dau
        && doanCua(r.duong).length >= doanCua(g.duong).length)) continue

    const khoa = `${g.method} ${g.duong}`
    if (daBao.has(khoa)) continue
    daBao.add(khoa)

    // Gợi ý route gần giống — thường lỗi chỉ là sai tiền tố hoặc đổi tên
    const cuoi = doanCua(g.duong).slice(-1)[0] || ''
    const goiY = routeBE
        .filter(r => cuoi.length > 3 && r.duong.includes(cuoi))
        .map(r => `${r.method} ${r.duong}`)
        .slice(0, 3)

    thieu.push({ method: g.method, duong: g.duong, file: g.file, goiY })
}

// ── 4. Báo cáo ───────────────────────────────────────────────────────────────
console.log(`\nSoát hợp đồng API`)
console.log(`  Backend : ${routeBE.length} route đã đăng ký từ ${mount.length} lượt mount`)
console.log(`  Frontend: ${goiFE.length} lời gọi đọc được trong ${fileFE.length} file\n`)

if (!routeBE.length || !goiFE.length) {
    console.log('⚠️  Không đọc được dữ liệu hai bên — kiểm tra lại đường dẫn repo frontend.')
    process.exit(0)
}

if (thieu.length === 0) {
    console.log('✅ Mọi lời gọi đọc được đều khớp một route backend.\n')
} else {
    console.log(`⚠️  ${thieu.length} lời gọi KHÔNG khớp route nào:\n`)
    for (const t of thieu) {
        console.log(`  ✗ ${t.method} ${t.duong}`)
        console.log(`      gọi từ: ${t.file}`)
        if (t.goiY.length) console.log(`      có thể là: ${t.goiY.join(' | ')}`)
    }
    console.log('\n  Nhắc: hook frontend thường nuốt lỗi và trả rỗng, nên những đường này')
    console.log('  KHÔNG hiện lỗi đỏ — trang chỉ trống mãi. Sửa bên gọi hoặc bổ sung route.\n')
}

/* Cố ý luôn thoát 0: bộ đọc đường dẫn động chưa hoàn hảo, để nó chặn được CI thì
 * lần sau người ta sẽ tắt công cụ thay vì sửa lỗi thật. */
process.exit(0)
