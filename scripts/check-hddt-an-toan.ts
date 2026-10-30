/**
 * Soát LỘ CẤU HÌNH NHÀ CUNG CẤP HĐĐT ra trình duyệt / app — npx tsx scripts/check-hddt-an-toan.ts (30/10/2026)
 *
 * Vì sao: getInvoiceWithItems (routes/einvoice.ts) gắn `_config` = NGUYÊN dòng EInvoiceConfig (apiUsername, apiPassword,
 * apiSecret, apiKey… lưu thô) để dựng XML / PDF. `GET /einvoice/:id` từng trả nguyên đối tượng đó — mọi người đăng nhập,
 * kể cả thu ngân, đọc được mật khẩu API của nhà cung cấp hoá đơn. Phát hiện khi làm màn hoá đơn cho app Android.
 *
 * Bộ soát canh:
 *   1. Không `res.json(...)` nào trong routes/einvoice*.ts mang đối tượng có `_config` (tên biến lấy từ getInvoiceWithItems
 *      mà chưa bóc `_config`).
 *   2. Route GET /:id bóc `_config` trước khi trả.
 *   3. Tự kiểm: đoạn mã mẫu "phải kêu" thì kêu, "phải im" thì im — bộ quét hỏng mà xanh còn tệ hơn không có.
 */
import fs from 'fs'
import path from 'path'

const GOC = path.resolve(__dirname, '..')
let dat = 0, hong = 0
const ok = (ten: string, dk: boolean, them?: string) => {
    if (dk) { dat++; console.log(`  ✓ ${ten}`) } else { hong++; console.log(`  ✗ ${ten}${them ? ` — ${them}` : ''}`) }
}

/** Trả danh sách "dòng: lời" các res.json đưa thẳng biến lấy từ getInvoiceWithItems (chưa bóc _config) */
function quet(ma: string): string[] {
    const s = ma.replace(/\r\n/g, '\n')
    const dong = s.split('\n')
    const phat: string[] = []
    // Biến nhận kết quả getInvoiceWithItems
    const bien = new Set<string>()
    for (const m of s.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*await\s+getInvoiceWithItems\(/g)) bien.add(m[1]!)
    // Biến đã bóc: const { _config, ...ra } = inv  ⇒ `ra` sạch, `inv` vẫn bẩn
    dong.forEach((l, i) => {
        const m = l.match(/res\s*\.\s*(?:status\([^)]*\)\s*\.\s*)?json\((.*)$/)
        if (!m) return
        const than = m[1]!
        for (const b of bien) {
            const re = new RegExp(`(?:data\\s*:\\s*${b}\\b(?!\\s*\\.)|\\.\\.\\.${b}\\b|json\\(\\s*${b}\\s*\\))`)
            if (re.test(than) || re.test(l)) phat.push(`${i + 1}: ${l.trim().slice(0, 140)}`)
        }
        if (/_config/.test(than)) phat.push(`${i + 1}: ${l.trim().slice(0, 140)}`)
    })
    return phat
}

console.log('\n▶ HĐĐT không lộ cấu hình nhà cung cấp\n')

// 3 — tự kiểm
const kieu = `
router.get('/:id', async (req, res) => {
    const inv = await getInvoiceWithItems(prisma, id)
    res.json({ success: true, data: inv })
})`
const im = `
router.get('/:id', async (req, res) => {
    const inv = await getInvoiceWithItems(prisma, id)
    const { _config, ...ra } = inv as any
    res.json({ success: true, data: ra, so: inv.invoiceNumber })
})`
const kieu2 = `
    const original = await getInvoiceWithItems(prisma, id)
    return res.status(200).json({ success: true, data: { ...original } })`
ok('tự kiểm: trả thẳng `data: inv` ⇒ KÊU', quet(kieu).length === 1, JSON.stringify(quet(kieu)))
ok('tự kiểm: bóc `_config` rồi trả phần còn lại, đọc trường lẻ inv.x ⇒ IM', quet(im).length === 0, JSON.stringify(quet(im)))
ok('tự kiểm: rải `...original` vào data ⇒ KÊU', quet(kieu2).length === 1, JSON.stringify(quet(kieu2)))

// 1 — quét mã thật
const thuMuc = path.join(GOC, 'src/routes')
const tep = fs.readdirSync(thuMuc).filter(f => /^einvoice.*\.ts$/.test(f))
ok(`có tệp routes/einvoice*.ts để quét (${tep.length})`, tep.length > 0)
for (const f of tep) {
    const phat = quet(fs.readFileSync(path.join(thuMuc, f), 'utf8'))
    ok(`${f}: không res.json nào mang _config / đối tượng getInvoiceWithItems chưa bóc`, phat.length === 0, phat.join(' | '))
}

// 2 — route chi tiết bóc _config
const ma = fs.readFileSync(path.join(thuMuc, 'einvoice.ts'), 'utf8').replace(/\r\n/g, '\n')
// Tìm ở ĐẦU DÒNG: một dòng chú thích phía trên route cũng chứa chuỗi router.get('/:id')
const i = ma.search(/^router\.get\('\/:id',/m)
const khoi = i >= 0 ? ma.slice(i, ma.indexOf('\n})', i)) : ''
ok("GET /:id bóc `_config` trước khi trả", /const\s*\{\s*_config\s*,\s*\.\.\.(\w+)\s*\}\s*=\s*inv/.test(khoi) && /data:\s*ra\b/.test(khoi))

console.log(`\n${dat} đạt, ${hong} hỏng`)
process.exit(hong ? 1 : 0)
