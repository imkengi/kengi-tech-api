/**
 * SOÁT TÊN TRƯỜNG PRISMA — bắt lỗi gõ sai tên cột trước khi nó ra production.
 *
 * Chạy:  npx tsx scripts/check-prisma-fields.ts
 *
 * Vì sao cần: gõ sai một tên cột trong `select` KHÔNG bị TypeScript bắt (client
 * được ép kiểu `any` ở hầu hết chỗ dùng đa schema), cũng KHÔNG bị bộ test bắt
 * (prisma giả trả nguyên đối tượng, không thèm nhìn `select`). Nó chỉ nổ trên
 * production dưới dạng P2022 — và nếu chỗ gọi có try/catch thì còn tệ hơn: im
 * lặng trả rỗng.
 *
 * Đã xảy ra thật ngày 13/08/2026: `TaxDeclaration.submittedAt` không tồn tại (cột
 * thật là `filedAt`). Hậu quả không phải "thiếu dữ liệu" mà là VU OAN — câu hỏi
 * "đã nộp tờ khai chưa" trả lời "CHƯA có tờ khai" ở mức nguy hiểm.
 */

import fs from 'fs'
import path from 'path'

const GOC = path.resolve(__dirname, '..')

// ── 1. Đọc schema → model → tập tên trường ───────────────────────────────────
function docSchema(file: string): Map<string, Set<string>> {
    const model = new Map<string, Set<string>>()
    let noiDung: string
    try { noiDung = fs.readFileSync(file, 'utf8') } catch { return model }
    for (const m of noiDung.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
        const ten = m[1]
        const truong = new Set<string>()
        for (const dong of m[2].split('\n')) {
            const t = dong.trim()
            if (!t || t.startsWith('//') || t.startsWith('@@')) continue
            const f = t.match(/^(\w+)\s+\S/)
            if (f) truong.add(f[1])
        }
        model.set(ten, truong)
    }
    return model
}

const schemaStore = docSchema(path.join(GOC, 'prisma/schema-store.prisma'))
const schemaRegistry = docSchema(path.join(GOC, 'prisma/schema.prisma'))

/** prisma.taxDeclaration → TaxDeclaration */
function tenModel(bien: string): string {
    return bien.charAt(0).toUpperCase() + bien.slice(1)
}

function truongCua(bien: string): Set<string> | null {
    const ten = tenModel(bien)
    return schemaStore.get(ten) || schemaRegistry.get(ten) || null
}

// ── 2. Cắt khối ngoặc cân bằng ───────────────────────────────────────────────
/** Trả nội dung bên trong cặp ngoặc bắt đầu tại vị trí mo (ký tự '{') */
function khoiTai(s: string, mo: number): { noiDung: string; het: number } | null {
    if (s[mo] !== '{') return null
    let sau = 0
    for (let i = mo; i < s.length; i++) {
        const c = s[i]
        if (c === '{') sau++
        else if (c === '}') {
            sau--
            if (sau === 0) return { noiDung: s.slice(mo + 1, i), het: i }
        }
    }
    return null
}

/** Vị trí dấu '{' của `select:` ở cấp ngoài cùng, -1 nếu không có */
function viTriSelectCapNgoai(khoi: string): number {
    let sau = 0
    for (let i = 0; i < khoi.length; i++) {
        const c = khoi[i]
        if (c === '{' || c === '[' || c === '(') { sau++; continue }
        if (c === '}' || c === ']' || c === ')') { sau--; continue }
        if (sau !== 0) continue
        const m = khoi.slice(i).match(/^select\s*:\s*\{/)
        if (m && (i === 0 || /[\s,{]/.test(khoi[i - 1]))) {
            return i + m[0].length - 1
        }
    }
    return -1
}

/** Khóa ở CẤP NGOÀI CÙNG của một khối đối tượng */
function khoaCapNgoai(khoi: string): string[] {
    const ra: string[] = []
    let sau = 0
    let dong = ''
    for (let i = 0; i < khoi.length; i++) {
        const c = khoi[i]
        if (c === '{' || c === '[' || c === '(') sau++
        else if (c === '}' || c === ']' || c === ')') sau--
        if (sau === 0 && (c === ',' || c === '\n')) {
            const m = dong.trim().match(/^(\w+)\s*:/)
            if (m) ra.push(m[1])
            dong = ''
        } else {
            dong += c
        }
    }
    const m = dong.trim().match(/^(\w+)\s*:/)
    if (m) ra.push(m[1])
    return ra
}

// ── 3. Quét mã nguồn ─────────────────────────────────────────────────────────
function quet(dir: string, ra: string[] = []): string[] {
    for (const m of fs.readdirSync(dir, { withFileTypes: true })) {
        if (m.name === 'node_modules' || m.name === 'generated') continue
        const p = path.join(dir, m.name)
        if (m.isDirectory()) quet(p, ra)
        else if (m.name.endsWith('.ts')) ra.push(p)
    }
    return ra
}

/** Từ khóa của Prisma, không phải tên cột */
const TU_KHOA = new Set([
    'select', 'include', 'where', 'data', 'orderBy', 'take', 'skip', 'distinct',
    'AND', 'OR', 'NOT', 'some', 'every', 'none', 'is', 'isNot', 'connect', 'create',
    'createMany', 'update', 'upsert', 'delete', 'set', 'increment', 'decrement',
    '_sum', '_count', '_avg', '_min', '_max', 'by', 'having', 'cursor', 'connectOrCreate',
])

interface Loi { file: string; dong: number; model: string; truong: string; goiY: string[] }
const loi: Loi[] = []
let soKiem = 0

for (const file of quet(path.join(GOC, 'src'))) {
    const s = fs.readFileSync(file, 'utf8')
    for (const m of s.matchAll(/\bprisma\.(\w+)\.(findMany|findFirst|findUnique|count|aggregate|groupBy)\s*\(/g)) {
        const bien = m[1]
        const truong = truongCua(bien)
        if (!truong) continue                        // không phải model → bỏ qua

        const mo = s.indexOf('{', m.index! + m[0].length - 1)
        if (mo < 0 || mo > m.index! + m[0].length + 5) continue
        const khoi = khoiTai(s, mo)
        if (!khoi) continue

        /* Chỉ soi khối `select` Ở CẤP NGOÀI CÙNG của tham số.
         *
         * Hai điều kiện đều quan trọng:
         *  - chỉ `select`, không soi `where` (vô số toán tử lồng, báo nhầm nhiều
         *    tới mức không ai đọc kết quả nữa);
         *  - phải ở cấp ngoài cùng, vì `include: { items: { select: {…} } }` là
         *    trường của model KHÁC. Bản đầu tiên bắt nhầm cả chúng và cho ra 39
         *    "lỗi" mà phần lớn là oan. */
        const moSel = viTriSelectCapNgoai(khoi.noiDung)
        if (moSel < 0) continue
        const khoiSel = khoiTai(khoi.noiDung, moSel)
        if (!khoiSel) continue

        for (const k of khoaCapNgoai(khoiSel.noiDung)) {
            if (TU_KHOA.has(k)) continue
            soKiem++
            if (truong.has(k)) continue
            const dong = s.slice(0, m.index).split('\n').length
            const goiY = [...truong].filter(t =>
                t.toLowerCase().includes(k.toLowerCase().slice(0, 5)) ||
                k.toLowerCase().includes(t.toLowerCase().slice(0, 5)))
            loi.push({
                file: path.relative(GOC, file), dong,
                model: tenModel(bien), truong: k, goiY: goiY.slice(0, 4),
            })
        }
    }
}

console.log(`\nSoát tên trường Prisma`)
console.log(`  ${schemaStore.size} model cửa hàng + ${schemaRegistry.size} model sổ đăng ký`)
console.log(`  Đã đối chiếu ${soKiem} tên trường trong các khối select\n`)

if (loi.length === 0) {
    console.log('✅ Mọi tên trường trong select đều có trong schema.\n')
    process.exit(0)
}

console.log(`❌ ${loi.length} tên trường KHÔNG có trong schema:\n`)
for (const l of loi) {
    console.log(`  ✗ ${l.model}.${l.truong}`)
    console.log(`      ${l.file}:${l.dong}`)
    if (l.goiY.length) console.log(`      ý bạn là: ${l.goiY.join(', ')}?`)
}
console.log('\n  Những lỗi này KHÔNG bị TypeScript hay prisma giả bắt — chúng nổ P2022')
console.log('  trên production, và nếu chỗ gọi có try/catch thì im lặng trả rỗng.\n')
process.exit(1)
