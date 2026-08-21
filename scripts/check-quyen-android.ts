/**
 * SOÁT QUÂN QUYỀN APP ANDROID — màn hình có mà không ai vào được, và quyền lệch khỏi web.
 *
 * Bệnh (chủ shop báo 21/08/2026: "bán hàng lưu động nhưng đăng nhập vào thì k có"):
 *   `SalesTripsScreen.kt` nằm sẵn trong cây mã từ commit c69525a nhưng CHƯA TỪNG được nối
 *   vào NavHost hay menu nào. Không có lỗi biên dịch nào chỉ ra điều đó — màn hình chỉ đơn
 *   giản là không tồn tại với người dùng. Cùng lúc, `manager` trên app chỉ có 22 quyền so
 *   với 54 của web: cùng một người, mở web thì thấy Nhập Hàng / Thuế / Chấm Công, mở app
 *   thì không. Người dùng không đọc được bảng quyền nên chỉ thấy "app thiếu tính năng".
 *
 * Bốn phép soi:
 *   [1] Màn hình `*Screen.kt` có trên đĩa mà KHÔNG nơi nào ngoài thư mục của nó nhắc tới
 *   [2] Mục menu (Drawer/More) trỏ tới route KHÔNG có trong NavHost ⇒ bấm vào không ra gì
 *   [3] Vai trò web có mà bảng Android thiếu ⇒ người vai trò đó thấy MENU TRỐNG
 *   [4] Quyền web cấp cho một vai trò mà bảng Android không cấp ⇒ app hẹp hơn web
 *
 * ⚠ KHÔNG phải lệch nào cũng sai: app cố tình cho `driver` thêm `vehicles`/`repairs`.
 * Những chỗ như vậy khai vào `CO_Y_LECH` KÈM LÝ DO — khai bừa vào đó là tự bịt mắt mình.
 *
 * Mã thoát: 0 = sạch · 1 = có vấn đề · 2 = KHÔNG SOI ĐƯỢC (đọc hỏng ≠ sạch)
 */
import * as fs from 'fs'
import * as path from 'path'

const GOC = path.resolve(__dirname, '..')
const APP = path.resolve(GOC, '..', 'open-retail', 'android-app', 'android-app',
    'app', 'src', 'main', 'java', 'vn', 'kengi', 'openretail')
const WEB = path.resolve(GOC, '..', 'open-retail', 'src')

/** Lệch CỐ Ý giữa app và web — phải ghi lý do. */
const CO_Y_LECH: Record<string, string> = {
    'driver.vehicles': 'tài xế dùng app để tra xe của mình; web không có màn tương đương',
    'driver.repairs': 'tài xế nhận phiếu sửa chữa ngay trên đường',
    'sales': 'vai trò cũ chỉ còn để hiển thị, web đã bỏ (xem employee-roles-structure)',
}

/** Màn hình cố ý chưa nối (đang làm dở) — ghi lý do, đừng để trống. */
const CHUA_NOI_CO_Y: Record<string, string> = {}

function doc(p: string): string | null {
    try { return fs.readFileSync(p, 'utf8') } catch { return null }
}

function boChuThich(s: string): string {
    return s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ')
}

/** Lấy thân của một khối cân bằng ngoặc, bắt đầu từ ngoặc mở đầu tiên sau `tu`. */
function than(s: string, tu: number, mo: string, dong: string): string {
    const j = s.indexOf(mo, tu) + 1
    let sau = 1, k = j
    while (sau > 0 && k < s.length) {
        if (s[k] === mo) sau++
        else if (s[k] === dong) sau--
        k++
    }
    return s.slice(j, k - 1)
}

console.log('Soát quân quyền app Android — màn hình mồ côi & quyền lệch khỏi web\n')

const nav = doc(path.join(APP, 'ui', 'navigation', 'AppNavigation.kt'))
const drawer = doc(path.join(APP, 'ui', 'navigation', 'AppDrawer.kt'))
const more = doc(path.join(APP, 'ui', 'more', 'MoreScreen.kt'))
const auth = doc(path.join(APP, 'data', 'store', 'AuthStore.kt'))
const web = doc(path.join(WEB, 'lib', 'stores', 'authStore.ts'))

if (!nav || !drawer || !more || !auth || !web) {
    console.error('❌ KHÔNG đọc được một trong các file gốc:')
    console.error(`   AppNavigation=${!!nav} AppDrawer=${!!drawer} MoreScreen=${!!more} AuthStore=${!!auth} web/authStore=${!!web}`)
    console.error('   Không đọc được thì KHÔNG kết luận được — đừng báo xanh.')
    process.exit(2)
}

const van: string[] = []

// ── [1] Màn hình mồ côi ────────────────────────────────────────────────────────
const thuMucUi = path.join(APP, 'ui')
/* Soi theo TÊN HÀM @Composable công khai trong file, KHÔNG theo tên file: `BarcodeScannerScreen.kt`
 * chứa `InAppBarcodeScanner` và được POS gọi thẳng — bắt theo tên file là báo mồ côi nhầm. */
const manHinh: Array<{ ten: string; thuMuc: string; ham: string[] }> = []
for (const d of fs.readdirSync(thuMucUi, { withFileTypes: true })) {
    if (!d.isDirectory()) continue
    for (const f of fs.readdirSync(path.join(thuMucUi, d.name))) {
        if (!f.endsWith('Screen.kt')) continue
        const src = doc(path.join(thuMucUi, d.name, f))
        if (src === null) {
            console.error(`❌ không đọc được ${d.name}/${f} — đọc hỏng ≠ sạch`)
            process.exit(2)
        }
        const ham = [...src.matchAll(/@Composable\s+(?:fun|internal fun)\s+(\w+)/g)].map(x => x[1]!)
        manHinh.push({ ten: f.replace('.kt', ''), thuMuc: d.name, ham })
    }
}
// Gom toàn bộ mã NGOÀI thư mục của chính màn hình đó
/* Gom TOÀN BỘ mã ui/ một lần, kèm đường dẫn, để loại trừ theo TỪNG FILE.
 * Loại trừ theo thư mục là sai: `InAppBarcodeScanner` nằm ở ui/pos/BarcodeScannerScreen.kt
 * và người gọi nó (ui/pos/PosScreen.kt) cũng ở ngay trong ui/pos. */
const moiFile: Array<{ duong: string; ma: string }> = []
for (const d of fs.readdirSync(thuMucUi, { withFileTypes: true })) {
    if (!d.isDirectory()) continue
    for (const f of fs.readdirSync(path.join(thuMucUi, d.name))) {
        if (!f.endsWith('.kt')) continue
        const duong = `${d.name}/${f}`
        const ma = doc(path.join(thuMucUi, d.name, f))
        if (ma === null) {
            console.error(`❌ không đọc được ${duong} — đọc hỏng ≠ sạch`)
            process.exit(2)
        }
        moiFile.push({ duong, ma })
    }
}
/** Có nơi nào NGOÀI chính file `tru` gọi tới `ten` không. */
function coNguoiGoi(ten: string, tru: string): boolean {
    return moiFile.some(f => f.duong !== tru && f.ma.includes(ten))
}

const moCoi: string[] = []
for (const m of manHinh) {
    if (CHUA_NOI_CO_Y[m.ten]) continue
    /* "Vào được" = có ÍT NHẤT MỘT hàm của file được gọi từ MỘT FILE KHÁC
     * (NavHost, hoặc một màn khác gọi thẳng như POS gọi máy quét). */
    const goi = m.ham.some(h => coNguoiGoi(h, `${m.thuMuc}/${m.ten}.kt`))
    if (!goi) moCoi.push(`${m.thuMuc}/${m.ten}`)
}
console.log(`   [1] ${manHinh.length} màn hình trên đĩa · ${moCoi.length} chưa nối vào NavHost`
    + (moCoi.length ? '  ❌' : '  ✅'))
if (moCoi.length) {
    for (const x of moCoi) console.log(`       ${x}`)
    van.push(`${moCoi.length} màn hình có mã nhưng KHÔNG vào được (không route)`)
}

// ── [2] Mục menu trỏ vào hư không ──────────────────────────────────────────────
const route = new Set<string>()
// Route có thể là "x", "x/{id}" HOẶC "x?p={p}" — thiếu dấu `?` là báo mồ côi nhầm
for (const m of nav.matchAll(/composable\(\s*(?:route\s*=\s*)?"([a-z0-9_\-]+)(?:[/?]|")/g)) route.add(m[1]!)
const mucMenu = new Set<string>()
for (const m of drawer.matchAll(/DrawerItem\([^,]+,\s*"[^"]*",\s*"([a-z0-9_\-]+)"/g)) mucMenu.add(m[1]!)
for (const m of more.matchAll(/FeatureItem\([^,]+,\s*"[^"]*",\s*"([a-z0-9_\-]+)"/g)) mucMenu.add(m[1]!)
const treo = [...mucMenu].filter(r => !route.has(r)).sort()
console.log(`   [2] ${mucMenu.size} mục menu · ${route.size} route · ${treo.length} mục bấm không ra gì`
    + (treo.length ? '  ❌' : '  ✅'))
if (treo.length) {
    console.log(`       ${treo.join(', ')}`)
    van.push(`${treo.length} mục menu trỏ tới route không tồn tại`)
}

// ── [3]+[4] Bảng quyền app vs web ──────────────────────────────────────────────
function vaiTroAndroid(src: string): Record<string, Set<string>> {
    const ra: Record<string, Set<string>> = {}
    const i = src.indexOf('ROLE_PERMS')
    const khoi = src.slice(i, src.indexOf('fun has(', i))
    for (const m of khoi.matchAll(/"(\w+)" to setOf\(/g)) {
        const t = boChuThich(than(khoi, m.index!, '(', ')'))
        ra[m[1]!] = new Set([...t.matchAll(/"([a-z0-9_.*]+)"/g)].map(x => x[1]!))
    }
    return ra
}
function vaiTroWeb(src: string): Record<string, Set<string>> {
    const ra: Record<string, Set<string>> = {}
    const khoi = src.slice(src.indexOf('ROLE_PERMISSIONS'))
    for (const m of khoi.matchAll(/^ {4}(\w+):\s*\[/gm)) {
        const t = boChuThich(than(khoi, m.index!, '[', ']'))
        if (t.length > 6000) continue
        ra[m[1]!] = new Set([...t.matchAll(/'([a-z0-9_.*]+)'/g)].map(x => x[1]!))
    }
    return ra
}
const ra = vaiTroAndroid(auth)
const rw = vaiTroWeb(web)
if (!Object.keys(ra).length || !Object.keys(rw).length) {
    console.error('❌ không đọc được bảng vai trò (android hoặc web) — không kết luận được')
    process.exit(2)
}

/** Đúng luật `has()` của app: khớp hai chiều theo tiền tố `.` và `_`. */
function phu(co: Set<string>, can: string): boolean {
    if (co.has('*')) return true
    for (const p of co) {
        if (p === can) return true
        if (can.startsWith(`${p}.`) || can.startsWith(`${p}_`)) return true
        if (p.startsWith(`${can}.`) || p.startsWith(`${can}_`)) return true
    }
    return false
}

const BO_QUA_VAI_TRO = new Set(['accessibleBranches', 'admin', 'owner', 'superadmin'])
const thieuVaiTro = Object.keys(rw).filter(r => !BO_QUA_VAI_TRO.has(r) && !ra[r] && !CO_Y_LECH[r]).sort()
const soVaiTroWeb = Object.keys(rw).filter(r => !BO_QUA_VAI_TRO.has(r)).length
console.log(`   [3] vai trò web=${soVaiTroWeb} · android=${Object.keys(ra).length}`
    + (thieuVaiTro.length ? `  ❌ thiếu: ${thieuVaiTro.join(', ')}` : '  ✅'))
if (thieuVaiTro.length) {
    van.push(`${thieuVaiTro.length} vai trò web KHÔNG có trong app ⇒ người vai trò đó thấy menu trống`)
}

let tongThieu = 0
const chiTiet: string[] = []
for (const r of Object.keys(rw)) {
    if (BO_QUA_VAI_TRO.has(r) || !ra[r]) continue
    const co = ra[r]!
    if (co.has('*')) continue
    const thieu = [...rw[r]!].filter(q => !phu(co, q) && !CO_Y_LECH[`${r}.${q}`]).sort()
    if (thieu.length) {
        tongThieu += thieu.length
        chiTiet.push(`       ${r}: thiếu ${thieu.length} — ${thieu.slice(0, 8).join(', ')}${thieu.length > 8 ? ` …+${thieu.length - 8}` : ''}`)
    }
}
console.log(`   [4] quyền web cấp mà app không cấp: ${tongThieu}` + (tongThieu ? '  ❌' : '  ✅'))
for (const d of chiTiet) console.log(d)
if (tongThieu) van.push(`${tongThieu} quyền app hẹp hơn web ⇒ cùng một người, web thấy màn hình mà app không`)

console.log(`\n   Đã soi ${manHinh.length} màn hình · ${route.size} route · ${Object.keys(ra).length} vai trò.`)
console.log(`   ${Object.keys(CO_Y_LECH).length} lệch khai là cố ý (kèm lý do).\n`)

if (!van.length) {
    console.log('✅ Không màn hình mồ côi, không mục menu treo, bảng quyền app khớp web.')
    process.exit(0)
}
console.log('❌ Vấn đề:')
for (const v of van) console.log(`   · ${v}`)
console.log('\n   Cách sửa: nối màn hình vào NavHost + 3 cửa menu (Drawer/More/bottom-nav),')
console.log('   hoặc đồng bộ ROLE_PERMS theo bảng web, hoặc khai vào CO_Y_LECH KÈM LÝ DO.')
process.exit(1)
