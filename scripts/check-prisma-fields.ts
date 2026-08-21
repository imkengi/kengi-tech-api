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

/**
 * Bản đồ QUAN HỆ: "OnlineOrder.items" → "OnlineOrderItem".
 *
 * Cần để soi được khối ghi LỒNG: `data: { items: { create: [{ … }] } }`. Các
 * khoá bên trong đó thuộc model KHÁC, và đó chính là kẽ hở đã để lọt
 * `OnlineOrderItem.externalItemId` — cột không tồn tại, làm 152 đơn từ webhook
 * trong 7 ngày không lưu được.
 */
function docQuanHe(file: string): Map<string, string> {
    const ra = new Map<string, string>()
    let noiDung: string
    try { noiDung = fs.readFileSync(file, 'utf8') } catch { return ra }
    for (const m of noiDung.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
        for (const dong of m[2].split('\n')) {
            const t = dong.trim()
            if (!t || t.startsWith('//') || t.startsWith('@@')) continue
            /* Trường quan hệ: tên kiểu bắt đầu bằng CHỮ HOA (Product, Item[]…).
             * Kiểu vô hướng (String, Int, Float…) cũng viết hoa nên phải loại
             * bằng danh sách kiểu gốc của Prisma. */
            const f = t.match(/^(\w+)\s+(\w+)(\[\])?/)
            if (!f) continue
            const kieu = f[2]
            if (/^(String|Int|Float|Boolean|DateTime|Json|Decimal|BigInt|Bytes)$/.test(kieu)) continue
            if (!/^[A-Z]/.test(kieu)) continue
            ra.set(`${m[1]}.${f[1]}`, kieu)
        }
    }
    return ra
}

const quanHe = new Map<string, string>([
    ...docQuanHe(path.join(GOC, 'prisma/schema-store.prisma')),
    ...docQuanHe(path.join(GOC, 'prisma/schema.prisma')),
])

/** prisma.taxDeclaration → TaxDeclaration */
function tenModel(bien: string): string {
    return bien.charAt(0).toUpperCase() + bien.slice(1)
}

/**
 * Chọn schema theo BIẾN CLIENT đứng trước, không phải cứ thử store rồi tới registry.
 *
 * Cả hai schema đều có một model tên `Store`, và bản trong schema-store KHÔNG có
 * các cờ chỉ tồn tại ở sổ đăng ký (hasAiJobs, hasFanpages…). Tra store trước thì
 * `registryPrisma.store.updateMany({ data: { hasAiJobs } })` bị báo oan — bản đầu
 * của phép soát này cho ra đúng 6 lỗi oan như vậy.
 */
function truongCua(bien: string, truoc = ''): Set<string> | null {
    const ten = tenModel(bien)
    const laRegistry = /registryPrisma|registry\s*as\s*any/i.test(truoc)
    return laRegistry
        ? (schemaRegistry.get(ten) || schemaStore.get(ten) || null)
        : (schemaStore.get(ten) || schemaRegistry.get(ten) || null)
}

/** Đoạn mã ngay trước vị trí `i` — dùng để nhận ra client nào đang gọi. */
const nhinLui = (s: string, i: number) => s.slice(Math.max(0, i - 40), i)

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

/**
 * Xoá RUỘT mọi chuỗi (', ", `) khỏi mã nguồn, giữ nguyên độ dài và xuống dòng.
 *
 * Vì sao cần: `details: \`Token obtained, shop: ${x}\`` khiến bộ tách khoá đọc
 * "shop" thành một tên cột và báo oan. Bản đầu tiên của phép soát khối ghi cho
 * ra 11 "lỗi" mà 10 cái là chữ nằm trong chuỗi.
 *
 * Giữ nguyên độ dài để số dòng báo ra vẫn đúng; giữ nguyên ngoặc để phép đếm
 * ngoặc cân bằng không lệch.
 */
function boRuotChuoi(s: string): string {
    const ra = s.split('')
    let i = 0
    while (i < ra.length) {
        const c = ra[i]
        if (c !== `'` && c !== '"' && c !== '`') { i++; continue }
        const mo = c
        let j = i + 1
        let sauNgoac = 0
        while (j < ra.length) {
            const d = ra[j]
            if (d === '\\') { j += 2; continue }
            /* Trong template, ${...} là MÃ chứ không phải chữ — nhưng để đơn giản
             * và an toàn, xoá luôn cả nó: mã trong đó không bao giờ là tên cột ở
             * cấp ngoài cùng của khối data. */
            if (mo === '`' && d === '$' && ra[j + 1] === '{') { sauNgoac++; j += 2; continue }
            if (mo === '`' && d === '}' && sauNgoac > 0) { sauNgoac--; j++; continue }
            if (d === mo && sauNgoac === 0) break
            j++
        }
        for (let k = i + 1; k < Math.min(j, ra.length); k++) {
            if (ra[k] !== '\n') ra[k] = ' '
        }
        i = Math.min(j + 1, ra.length)
    }
    return ra.join('')
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
const dsFile = quet(path.join(GOC, 'src'))

for (const file of dsFile) {
    const s = boRuotChuoi(fs.readFileSync(file, 'utf8'))
    for (const m of s.matchAll(/\b(?:\w+\.)?(\w+)\.(findMany|findFirst|findUnique|count|aggregate|groupBy)\s*\(/g)) {
        const bien = m[1]
        const truong = truongCua(bien, nhinLui(s, m.index!))
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

// ── 3b. Quét khối GHI (data / create / update) ───────────────────────────────
/**
 * `select` chỉ là nửa câu chuyện: gõ sai tên cột khi GHI còn tệ hơn, vì Prisma
 * ném lỗi ngay và chỗ gọi thường có try/catch "non-critical" nuốt mất.
 *
 * Đã xảy ra thật ngày 14/08/2026: `Customer.loyaltyTier` (cột thật là `tier`)
 * làm ĐIỂM TÍCH LUỸ CHƯA TỪNG ĐƯỢC CỘNG cho khách nào — mỗi lần bán đều ném
 * lỗi, và log chỉ ghi "[Loyalty] Points update failed (non-critical)".
 */
const LENH_GHI = 'create|createMany|update|updateMany|upsert'

interface LoiGhi { file: string; dong: number; model: string; truong: string; goiY: string[] }
const loiGhi: LoiGhi[] = []
let soKiemGhi = 0

/**
 * Soi một khối ghi, và ĐI XUỐNG các khối ghi lồng theo quan hệ.
 *
 * `data: { items: { create: [{ … }] } }` — các khoá bên trong thuộc model của
 * quan hệ `items`, không phải model gốc. Không đi xuống thì bỏ sót đúng lớp lỗi
 * đã làm 152 đơn webhook không lưu được.
 *
 * Quan hệ không tra được model đích thì DỪNG, không đoán — thà bỏ sót còn hơn
 * báo oan.
 */
function soatKhoiGhi(
    noiDung: string, model: string, file: string, dong: number,
    sau = 0, laRegistry = false,
) {
    if (sau > 3) return                       // chặn lồng quá sâu, gần như luôn là dữ liệu JSON
    const truong = laRegistry
        ? (schemaRegistry.get(model) || schemaStore.get(model))
        : (schemaStore.get(model) || schemaRegistry.get(model))
    if (!truong) return

    for (const cot of khoaCapNgoai(noiDung)) {
        if (TU_KHOA.has(cot)) continue
        soKiemGhi++
        if (truong.has(cot)) continue
        const goiY = [...truong].filter(t =>
            t.toLowerCase().includes(cot.toLowerCase().slice(0, 5)) ||
            cot.toLowerCase().includes(t.toLowerCase().slice(0, 5)))
        loiGhi.push({ file: path.relative(GOC, file), dong, model, truong: cot, goiY: goiY.slice(0, 4) })
    }

    /* Đi xuống: với mỗi khoá là QUAN HỆ, tìm khối create/update/upsert bên trong
     * rồi soi tiếp bằng model đích. */
    for (const cot of khoaCapNgoai(noiDung)) {
        const dich = quanHe.get(`${model}.${cot}`)
        if (!dich) continue
        const viTri = noiDung.search(new RegExp(`(^|[\\s,{])${cot}\\s*:\\s*\\{`))
        if (viTri < 0) continue
        const moCon = noiDung.indexOf('{', viTri + cot.length)
        const khoiCon = khoiTai(noiDung, moCon)
        if (!khoiCon) continue
        for (const lenh of ['create', 'update', 'upsert', 'createMany']) {
            /* KHÔNG đòi ngay sau dấu hai chấm phải là `{` hoặc `[`: mã thật hay
             * viết `create: don.items.map(i => ({ … }))` — một lời gọi hàm. Lấy
             * dấu `{` ĐẦU TIÊN sau đó là tới đúng thân đối tượng, dù nó nằm sau
             * `[`, sau `(` hay sau cả một chuỗi phương thức.
             *
             * Mảng nhiều phần tử thì soi phần tử đầu là đủ — chúng cùng hình
             * dạng vì đều do một phép map sinh ra. */
            const m2 = khoiCon.noiDung.search(new RegExp(`(^|[\\s,{])${lenh}\\s*:`))
            if (m2 < 0) continue
            const moThat = khoiCon.noiDung.indexOf('{', m2 + lenh.length)
            if (moThat < 0) continue
            const khoiGhiCon = khoiTai(khoiCon.noiDung, moThat)
            if (khoiGhiCon) soatKhoiGhi(khoiGhiCon.noiDung, dich, file, dong, sau + 1, laRegistry)
        }
    }
}

for (const file of dsFile) {
    const s = boRuotChuoi(fs.readFileSync(file, 'utf8'))
    /* Nhận MỌI biến giữ client, không chỉ `prisma`/`tx`: mã thật còn dùng
     * `storePrisma`, `sp`, `registryPrisma`… Bản đầu chỉ khớp hai tên nên bỏ qua
     * trọn file webhooks.ts — đúng chỗ giấu lỗi 152 đơn không lưu được.
     * Tên model không tra được thì bỏ qua, nên nới rộng thế này không báo oan. */
    for (const m of s.matchAll(new RegExp(`\\b(?:\\w+\\.)?(\\w+)\\.(?:${LENH_GHI})\\s*\\(`, 'g'))) {
        const bien = m[1]
        const truong = truongCua(bien, nhinLui(s, m.index!))
        if (!truong) continue

        const mo = s.indexOf('{', m.index! + m[0].length - 1)
        if (mo < 0 || mo > m.index! + m[0].length + 5) continue
        const khoi = khoiTai(s, mo)
        if (!khoi) continue

        /* Chỉ soi khối `data` / `create` / `update` Ở CẤP NGOÀI CÙNG. Khối lồng
         * bên trong là trường của model KHÁC (quan hệ), soi vào là báo oan. */
        for (const ten of ['data', 'create', 'update']) {
            const re = new RegExp(`^${ten}\\s*:\\s*\\{`)
            let sau = 0
            for (let i = 0; i < khoi.noiDung.length; i++) {
                const c = khoi.noiDung[i]
                if (c === '{' || c === '[' || c === '(') { sau++; continue }
                if (c === '}' || c === ']' || c === ')') { sau--; continue }
                if (sau !== 0) continue
                const k = khoi.noiDung.slice(i).match(re)
                if (!k || (i > 0 && !/[\s,{]/.test(khoi.noiDung[i - 1]))) continue

                const khoiGhi = khoiTai(khoi.noiDung, i + k[0].length - 1)
                if (!khoiGhi) break
                soatKhoiGhi(
                    khoiGhi.noiDung, tenModel(bien), file,
                    s.slice(0, m.index).split('\n').length,
                    0, /registryPrisma|registry\s*as\s*any/i.test(nhinLui(s, m.index!)),
                )
                break
            }
        }
    }
}

// ── 4. Quét SQL THÔ ──────────────────────────────────────────────────────────
/**
 * Khối `select` của Prisma không phải chỗ duy nhất gõ sai tên cột được. SQL thô
 * trong `$queryRawUnsafe` cũng gõ tay, cũng không được TypeScript kiểm, và hỏng
 * còn kín tiếng hơn: nó ném lỗi lúc chạy, chỗ gọi bắt vào mảng "thiếu", rồi cả
 * tính năng im lặng.
 *
 * Đã xảy ra thật ngày 14/08/2026: `ImportReceiptItem."importReceiptId"` (cột
 * thật là `receiptId`) làm bản tin đầu tuần của CẢ 9 CỬA HÀNG không gửi được,
 * mà log chỉ nói "chưa đọc được dữ liệu".
 *
 * Nguyên tắc để không báo oan: CHỈ kiểm `bí_danh."cột"` khi bí danh đó ánh xạ
 * được về một model có thật. Bí danh của truy vấn con hay CTE thì bỏ qua — thà
 * bỏ sót còn hơn báo oan, vì công cụ báo oan sẽ bị người ta tắt.
 */
const TU_KHOA_SQL = new Set([
    'ON', 'WHERE', 'AS', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'JOIN', 'GROUP', 'ORDER',
    'LIMIT', 'HAVING', 'UNION', 'SET', 'VALUES', 'USING', 'CROSS', 'FULL', 'NATURAL',
])

interface LoiSql { file: string; dong: number; model: string; truong: string; goiY: string[] }
const loiSql: LoiSql[] = []
let soKiemSql = 0

/** Cắt đối số đầu tiên của lời gọi bắt đầu ngay sau dấu '(' */
function doiSoDau(s: string, moNgoac: number): string {
    let sau = 0
    for (let i = moNgoac; i < s.length; i++) {
        const c = s[i]
        if (c === '(') sau++
        else if (c === ')') { sau--; if (sau === 0) return s.slice(moNgoac + 1, i) }
    }
    return ''
}

for (const file of dsFile) {
    /* SQL thô NẰM TRONG template literal, nên phần này phải đọc bản GỐC —
         * dùng bản đã xoá ruột chuỗi thì không còn câu SQL nào để soi. */
        const s = fs.readFileSync(file, 'utf8')
    for (const m of s.matchAll(/\$(?:queryRaw|queryRawUnsafe|executeRaw|executeRawUnsafe)\s*[(`]/g)) {
        const moNgoac = s.indexOf('(', m.index!)
        if (moNgoac < 0) continue
        const sql = doiSoDau(s, moNgoac)
        if (!sql || !/\b(FROM|JOIN|UPDATE|INSERT\s+INTO)\b/i.test(sql)) continue

        // bí danh → model
        const biDanh = new Map<string, string>()
        for (const t of sql.matchAll(/\b(?:FROM|JOIN|UPDATE|INTO)\s+"(\w+)"(?:\s+(?:AS\s+)?(\w+))?/gi)) {
            const model = t[1]
            if (!schemaStore.has(model) && !schemaRegistry.has(model)) continue
            biDanh.set(model, model)
            const bd = t[2]
            if (bd && !TU_KHOA_SQL.has(bd.toUpperCase())) biDanh.set(bd, model)
        }
        if (biDanh.size === 0) continue

        for (const c of sql.matchAll(/(?:"(\w+)"|\b(\w+))\."(\w+)"/g)) {
            const bd = c[1] || c[2]
            const cot = c[3]
            const model = biDanh.get(bd)
            if (!model) continue                       // truy vấn con / CTE → bỏ qua
            const truong = schemaStore.get(model) || schemaRegistry.get(model)
            if (!truong) continue
            soKiemSql++
            if (truong.has(cot)) continue
            const dong = s.slice(0, m.index! + (c.index || 0)).split('\n').length
            const goiY = [...truong].filter(t =>
                t.toLowerCase().includes(cot.toLowerCase().slice(0, 5)) ||
                cot.toLowerCase().includes(t.toLowerCase().slice(0, 5)))
            loiSql.push({ file: path.relative(GOC, file), dong, model, truong: cot, goiY: goiY.slice(0, 4) })
        }
    }
}

console.log(`\nSoát tên trường Prisma`)
console.log(`  ${schemaStore.size} model cửa hàng + ${schemaRegistry.size} model sổ đăng ký`)
console.log(`  Đã đối chiếu ${soKiem} tên trường trong các khối select`)
console.log(`  Đã đối chiếu ${soKiemGhi} tên cột trong khối ghi (data/create/update)`)
console.log(`  Đã đối chiếu ${soKiemSql} tên cột trong SQL thô\n`)

if (loiGhi.length > 0) {
    console.log(`❌ ${loiGhi.length} tên cột trong khối GHI không có trong schema:\n`)
    for (const l of loiGhi) {
        console.log(`  ✗ ${l.model}.${l.truong}  (data/create/update)`)
        console.log(`      ${l.file}:${l.dong}`)
        if (l.goiY.length) console.log(`      ý bạn là: ${l.goiY.join(', ')}?`)
    }
    console.log('\n  Ghi sai tên cột nổ NGAY khi chạy, và chỗ gọi thường có try/catch')
    console.log('  "non-critical" nuốt mất — tính năng chết âm thầm.\n')
}

if (loiSql.length > 0) {
    console.log(`❌ ${loiSql.length} tên cột trong SQL THÔ không có trong schema:\n`)
    for (const l of loiSql) {
        console.log(`  ✗ ${l.model}."${l.truong}"`)
        console.log(`      ${l.file}:${l.dong}`)
        if (l.goiY.length) console.log(`      ý bạn là: ${l.goiY.join(', ')}?`)
    }
    console.log('\n  SQL thô hỏng còn kín tiếng hơn select sai: nó ném lỗi lúc chạy,')
    console.log('  chỗ gọi bắt vào mảng "thiếu", rồi cả tính năng im lặng.\n')
}

if (loi.length === 0 && loiSql.length === 0 && loiGhi.length === 0) {
    /* Khai luôn ĐÃ SOI BAO NHIÊU. Xanh mà không nói soi gì thì không phân biệt được
     * "quét sạch, không lỗi" với "đường quét hỏng, chẳng đọc được file nào". */
    if (!dsFile.length) {
        console.log('⛔ KHÔNG KẾT LUẬN ĐƯỢC — soi 0 file. Đường quét hỏng, KHÔNG phải schema sạch.\n')
        process.exit(2)
    }
    console.log(`✅ Mọi tên cột trong select, khối ghi và SQL thô đều có trong schema — đã soi ${dsFile.length} file.\n`)
    process.exit(0)
}
/* Chỉ sai ở SQL thô thì phần lỗi đã in ở trên rồi — thoát luôn, đừng in tiếp
 * tiêu đề "0 tên trường KHÔNG có trong schema" gây rối. */
if (loi.length === 0) process.exit(1)

console.log(`❌ ${loi.length} tên trường KHÔNG có trong schema:\n`)
for (const l of loi) {
    console.log(`  ✗ ${l.model}.${l.truong}`)
    console.log(`      ${l.file}:${l.dong}`)
    if (l.goiY.length) console.log(`      ý bạn là: ${l.goiY.join(', ')}?`)
}
console.log('\n  Những lỗi này KHÔNG bị TypeScript hay prisma giả bắt — chúng nổ P2022')
console.log('  trên production, và nếu chỗ gọi có try/catch thì im lặng trả rỗng.\n')
process.exit(1)
