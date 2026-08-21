/**
 * SOÁT THÔNG BÁO LẠC — loại máy chủ tạo ra mà không màn hình nào hiện.
 *
 * Bệnh: `NotificationDropdown` và trang `dashboard-notifications` lọc thông báo bằng một
 * **danh sách trắng** (`LOAI_HIEN`). Máy chủ thêm loại mới mà quên thêm vào đó thì thông báo
 * được tạo, được lưu vào bảng, rồi **không ai thấy** — và không có lỗi nào báo.
 *
 * Đo thật 21/08/2026: máy chủ tạo 8 loại, chỉ 3 loại lọt. `weekly-brief` (bản tin tuần) rơi vào
 * hư không suốt. Chính tôi cũng suýt thêm một cái nữa (`type: 'warning'` cho cảnh báo lệch công
 * nợ) — tức là cảnh báo sinh ra để chữa bệnh "không ai đọc log" lại mắc đúng bệnh đó.
 *
 * Cùng họ với `check:nuotloi`: hỏng mà trông như bình thường.
 *
 * Mã thoát: 0 = không loại nào lạc · 1 = CÓ loại lạc · 2 = KHÔNG SOI ĐƯỢC (đọc hỏng ≠ sạch)
 */
import * as fs from 'fs'
import * as path from 'path'

const BE = path.resolve(__dirname, '..', 'src')
const FE = path.resolve(__dirname, '..', '..', 'open-retail', 'src')

/**
 * Loại đi ĐƯỜNG RIÊNG, không qua màn hình thông báo — phải khai đích danh kèm lý do.
 * Để trống thì bộ soát sẽ báo nhầm; nhưng khai bừa vào đây là **tự bịt mắt mình**, nên
 * mỗi dòng phải nói rõ đường nào.
 */
const DI_DUONG_RIENG: Record<string, string> = {
    new_order: 'SSE — useNotifications addEventListener(\'new_order\') + app Android (9 file)',
    'tax-audit': 'trang Soát thuế tự đọc dữ liệu gốc, không qua bảng Notification',
    'tax-deadline': 'tab Hạn thuế tự đọc dữ liệu gốc',
    'tax-reconcile': 'ReconcilePanel tự đọc dữ liệu gốc',
}

function moiFile(goc: string, duoi: string[]): string[] {
    const ra: string[] = []
    const di = (d: string) => {
        let ds: fs.Dirent[]
        try { ds = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
        for (const e of ds) {
            if (e.name === 'node_modules' || e.name === 'generated' || e.name.startsWith('.')) continue
            const p = path.join(d, e.name)
            if (e.isDirectory()) di(p)
            else if (duoi.some(x => e.name.endsWith(x))) ra.push(p)
        }
    }
    di(goc)
    return ra
}

console.log('Soát thông báo lạc — loại máy chủ tạo mà không màn hình nào hiện\n')

/* ── Vế MÁY CHỦ: loại nào được tạo ─────────────────────────────────────── */

const fileBE = moiFile(BE, ['.ts'])
if (!fileBE.length) {
    console.error('❌ KHÔNG đọc được file backend nào — không kết luận được gì.')
    process.exit(2)
}

const loaiTao = new Map<string, string[]>()   // loại → nơi tạo
for (const f of fileBE) {
    let s: string
    try { s = fs.readFileSync(f, 'utf8') } catch { continue }
    if (!s.includes('notification.create')) continue
    // Lấy 12 dòng sau mỗi `notification.create` rồi bắt `type:`
    const dong = s.split('\n')
    for (let i = 0; i < dong.length; i++) {
        if (!dong[i]!.includes('notification.create')) continue
        for (let j = i; j < Math.min(i + 12, dong.length); j++) {
            const m = dong[j]!.match(/\btype:\s*(?:'([a-zA-Z_-]+)'|([A-Z_][A-Z0-9_]*))/)
            if (!m) continue
            let loai = m[1] || ''
            if (!loai && m[2]) {
                // Hằng số (vd LOAI_TB) — tra giá trị ngay trong file
                const hs = s.match(new RegExp(`const\\s+${m[2]}\\s*=\\s*'([a-zA-Z_-]+)'`))
                loai = hs?.[1] || ''
                if (!loai) {
                    console.warn(`   ⚠ ${path.relative(BE, f)}: không tra được giá trị của ${m[2]} — bỏ qua, KHÔNG coi là sạch`)
                }
            }
            if (loai) {
                const ds = loaiTao.get(loai) || []
                ds.push(path.relative(BE, f))
                loaiTao.set(loai, ds)
            }
            break
        }
    }
}

/* ── Vế GIAO DIỆN: loại nào được hiện ──────────────────────────────────── */

/* CHỈ soi ba file THỰC SỰ hiện thông báo. Quét cả cây là sai: `.type === '...'` khớp cả
 * `bogo`/`cash`/`pong`… của thứ khác ⇒ tập "đã hiện" phình ra 35 loại và GIẤU MẤT loại lạc
 * thật. Đo rộng hơn không phải đo kỹ hơn. */
const FILE_HIEN = [
    path.join(FE, 'features', 'notifications', 'hooks', 'useNotifications.ts'),
    path.join(FE, 'components', 'NotificationDropdown.tsx'),
    path.join(FE, 'app', '(dashboard)', 'dashboard-notifications', 'page.tsx'),
]
const fileFE = FILE_HIEN.filter(f => fs.existsSync(f))
if (fileFE.length !== FILE_HIEN.length) {
    console.error('❌ Thiếu file màn hình thông báo — có thể đã đổi tên/di chuyển:')
    for (const f of FILE_HIEN) if (!fs.existsSync(f)) console.error(`   không thấy ${f}`)
    console.error('   Bộ soát này mù nếu không có chúng. Sửa đường dẫn, đừng bỏ qua.')
    process.exit(2)
}
if (!fileFE.length) {
    console.error(`❌ KHÔNG đọc được file frontend nào (tìm ở ${FE}).`)
    console.error('   Không có vế giao diện thì KHÔNG kết luận được — đừng báo xanh.')
    process.exit(2)
}

const loaiHien = new Set<string>()
let thayDanhSach = false
for (const f of fileFE) {
    let s: string
    try { s = fs.readFileSync(f, 'utf8') } catch { continue }
    const m = s.match(/LOAI_HIEN\s*=\s*new Set\(\[([^\]]*)\]\)/)
    if (m) {
        thayDanhSach = true
        for (const x of m[1]!.matchAll(/'([a-zA-Z_-]+)'/g)) loaiHien.add(x[1]!)
    }
    // Nhánh so sánh trực tiếp còn sót lại
    for (const x of s.matchAll(/\.type\s*===\s*'([a-zA-Z_-]+)'/g)) loaiHien.add(x[1]!)
}

if (!thayDanhSach) {
    console.error('❌ KHÔNG tìm thấy `LOAI_HIEN` bên frontend.')
    console.error('   Có thể danh sách đã bị đổi tên/gỡ ⇒ bộ soát này mù. Sửa bộ soát, đừng bỏ qua.')
    process.exit(2)
}

/* ── Đối chiếu ─────────────────────────────────────────────────────────── */

const lac: Array<{ loai: string; noi: string[] }> = []
for (const [loai, noi] of loaiTao) {
    if (loaiHien.has(loai)) continue
    if (DI_DUONG_RIENG[loai]) continue
    lac.push({ loai, noi: [...new Set(noi)] })
}

console.log(`   Máy chủ tạo   ${loaiTao.size} loại: ${[...loaiTao.keys()].sort().join(', ')}`)
console.log(`   Giao diện hiện ${loaiHien.size} loại: ${[...loaiHien].sort().join(', ')}`)
console.log(`   Đi đường riêng ${Object.keys(DI_DUONG_RIENG).length} loại (đã khai đích danh)`)
console.log(`\n   Đã soi ${fileBE.length} file backend + ${fileFE.length} file frontend.\n`)

if (!lac.length) {
    console.log('✅ Không loại thông báo nào bị bỏ rơi — mọi loại đều có nơi hiện hoặc có đường riêng đã khai.')
    process.exit(0)
}

console.log(`❌ ${lac.length} loại thông báo LẠC — máy chủ tạo mà không ai hiện:\n`)
for (const x of lac) {
    console.log(`   · '${x.loai}'  ← tạo ở ${x.noi.join(', ')}`)
}
console.log('\n   Cách sửa: thêm loại vào `LOAI_HIEN` (features/notifications/hooks/useNotifications.ts),')
console.log('   HOẶC nếu nó đi đường khác (SSE/Android) thì khai vào DI_DUONG_RIENG của bộ soát này')
console.log('   KÈM LÝ DO — khai bừa vào đó là tự bịt mắt mình.')
process.exit(1)
