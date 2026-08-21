/**
 * check:ghino — mọi thay đổi `Customer.debt` phải là phép CỘNG/TRỪ NGUYÊN TỬ, trừ đường gương.
 *
 * Vì sao (20/08/2026): `data: { debt: soDaTinh }` với `soDaTinh` lấy từ một lần đọc TRƯỚC đó là
 * "lost update" — hai thao tác cùng lúc thì cái sau ĐÈ cái trước và một lần trả nợ biến mất.
 * Đây đúng họ với sự cố hôm nay (webhook ghi 0 đè nợ thật), chỉ khác cơ chế.
 *
 * NGOẠI LỆ có khai báo: `kiotvietRunner.ts` và `misaSync.ts` là đường ĐỒNG BỘ GƯƠNG — `Customer.debt`
 * ở đó là bản sao của hệ ngoài (xem memory kiotviet-debt-drift), ghi tuyệt đối mới đúng.
 *
 * Chạy: npm run check:ghino
 */
import fs from 'fs'
import path from 'path'

const GOC = path.resolve(__dirname, '../src')

/** File được phép ghi tuyệt đối, kèm LÝ DO in ra mỗi lần chạy. */
const DUONG_GUONG: Record<string, string> = {
    'services/kiotvietRunner.ts': 'đối chiếu nợ ↔ KiotViet — ghi đúng số KV là mục đích của nó',
    'services/misaSync.ts': 'đồng bộ nợ ↔ MISA — cùng lý do',
}

const quet = (d: string, ra: string[] = []): string[] => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name)
        if (e.isDirectory()) { if (e.name !== 'generated') quet(p, ra) }
        else if (e.name.endsWith('.ts')) ra.push(p)
    }
    return ra
}

const viPham: string[] = []
for (const f of quet(GOC)) {
    const rel = path.relative(GOC, f).replace(/\\/g, '/')
    if (DUONG_GUONG[rel]) continue
    const dong = fs.readFileSync(f, 'utf8').split('\n')
    dong.forEach((l, i) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(l)) return
        const m = l.match(/data:\s*\{[^}]*\bdebt:\s*([^,}]+)/)
        if (!m) return
        const v = m[1].trim()
        // Cho phép: { increment/decrement }, và kẹp về 0 (đã nằm trong transaction)
        if (/increment|decrement/.test(v) || v === '0') return
        viPham.push(`${rel}:${i + 1} → debt: ${v.slice(0, 40)}`)
    })
}

console.log('=== check:ghino — thay đổi Customer.debt có nguyên tử không ===\n')
if (viPham.length) {
    console.error(`❌ ${viPham.length} chỗ ghi ĐÈ giá trị nợ (lost update):`)
    for (const v of viPham) console.error(`   - ${v}`)
    console.error('\n   Sửa: dùng `{ debt: { increment/decrement: x } }` rồi kẹp ≥ 0 trong cùng transaction.')
    console.error('   Nếu đây là đường đồng bộ gương thì khai vào DUONG_GUONG kèm lý do.')
} else {
    console.log('✅ Mọi thay đổi Customer.debt đều là cộng/trừ nguyên tử (hoặc kẹp về 0).')
}
/* LUẬT 2 — quy ước sổ nợ: MỌI thay đổi `Customer.debt` phải kèm một dòng `DebtEntry` ở ngay đoạn
 * đó (tạo mới, hoặc xoá khi đảo bút toán). Nợ đổi mà sổ không có dòng nào giải thích thì sau này
 * không ai lần được vì sao — xem memory debt-ledger-conventions. */
const khongSo: string[] = []
for (const f of quet(GOC)) {
    const rel = path.relative(GOC, f).replace(/\\/g, '/')
    if (DUONG_GUONG[rel]) continue
    const dong = fs.readFileSync(f, 'utf8').split('\n')
    dong.forEach((l, i) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(l)) return
        if (!/debt:\s*\{\s*(increment|decrement)/.test(l)) return
        const quanh = dong.slice(Math.max(0, i - 30), i + 31).join('\n')
        if (!/debtEntry\./i.test(quanh)) khongSo.push(`${rel}:${i + 1}`)
    })
}
if (khongSo.length) {
    console.error(`\n❌ ${khongSo.length} chỗ đổi nợ mà KHÔNG có dòng DebtEntry đi kèm:`)
    for (const v of khongSo) console.error(`   - ${v}`)
    console.error('   Quy ước: mọi thay đổi Customer.debt đều phải ghi sổ DebtEntry trong cùng transaction.')
} else {
    console.log('✅ Mọi thay đổi nợ đều có dòng sổ DebtEntry đi kèm.')
}

for (const [f, ly] of Object.entries(DUONG_GUONG)) console.log(`   · ngoại lệ ${f}: ${ly}`)
process.exit(viPham.length || khongSo.length ? 1 : 0)
