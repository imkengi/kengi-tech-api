/**
 * check:cotma — đọc CỘT KHÔNG TỒN TẠI trên dòng Prisma trả về.
 *
 * Vì sao TypeScript không đỡ được: `req.storePrisma! as any` — ép `any` là tắt sạch kiểm kiểu cho
 * cả nhánh đó. Đọc một cột không có thật ra `undefined`, rồi:
 *      `t.paymentMethod === 'Tiền mặt'`  → KHÔNG BAO GIỜ đúng
 *      `t.paymentMethod !== 'Tiền mặt'`  → LUÔN đúng  ← nguy hiểm nhất: `continue` bỏ SẠCH dữ liệu
 *      `t.totalAmount || 0`              → luôn 0
 * Không lỗi, không cảnh báo, cũng KHÔNG P2022 — vì chưa bao giờ hỏi máy chủ về cột đó.
 * `check:fields` chỉ soi tên cột trong CÂU TRUY VẤN, nên hoàn toàn mù với chuyện đọc thuộc tính.
 *
 * Ca thật (21/08/2026, `GET /hkd/s6`): sổ quỹ tiền mặt của hộ kinh doanh không lấy được MỘT ĐỒNG
 * doanh thu nào — `Transaction` không hề có cột `paymentMethod` (cột đó thuộc `OnlineOrder` và
 * `EInvoice`), cũng không có `totalAmount` (tên thật là `total`).
 *
 * Cách soi (một chặng, trong đúng thân chỗ dùng):
 *   1. `const X = await <p>.<model>.findMany(`  ← lấy phép gán GẦN NHẤT phía trước
 *   2. bốn dạng thân:  `for (const t of X) { … }`  ·  `X.map(t => …)` / .filter / .find /
 *      .some / .every / .forEach / .flatMap  ·  `X.reduce((s, t) => …)` (phần tử là tham số THỨ
 *      HAI — đúng câu lệnh hay dùng để cộng tiền)  ·  `const k = await …findFirst(…)` rồi `k.<prop>`
 *   3. mọi `t.<prop>` phải nằm trong tập cột của <model>
 * Bỏ qua biến lấy từ `$queryRaw*` (hàng thô hay đặt tên lại cột), bỏ chú thích, và bỏ khi tên đó
 * bị CHE bởi một tham số hàm nằm giữa chỗ khai báo và chỗ dùng.
 *
 * Cẩn trọng: dạng 2 chỉ chạy được sau khi sửa regex cho `((t: any) => …)`. Trước đó nó khớp hụt
 * nên báo xanh RỖNG — thử ngược mới lộ ra, và lần quét lại tìm thêm 12 chỗ. Xanh chỉ có nghĩa
 * khi phép soi đã được chứng minh là biết đỏ.
 *
 * Chạy: npm run check:cotma
 */
import fs from 'fs'
import path from 'path'

const GOC_API = path.resolve(__dirname, '..')
const GOC = path.join(GOC_API, 'src')

/* ── 1. schema → model → tập cột ────────────────────────────────────────────── */
const cotCuaModel = new Map<string, Set<string>>()
for (const ten of ['schema-store.prisma', 'schema.prisma']) {
    const f = path.join(GOC_API, 'prisma', ten)
    if (!fs.existsSync(f)) continue
    let model: string | null = null
    for (const l of fs.readFileSync(f, 'utf8').split('\n')) {
        const m = l.match(/^model\s+(\w+)\s*\{/)
        if (m) { model = m[1]; if (!cotCuaModel.has(model)) cotCuaModel.set(model, new Set()); continue }
        if (!model) continue
        if (/^\}/.test(l)) { model = null; continue }
        const c = l.match(/^\s{2,}(\w+)\s+\S/)
        if (c && !c[1].startsWith('@@')) cotCuaModel.get(model)!.add(c[1])
    }
}

const CHO_PHEP = new Set(['_count', '_sum', '_avg', '_min', '_max', 'length', 'map', 'filter', 'reduce',
    'forEach', 'find', 'some', 'every', 'slice', 'push', 'sort', 'join', 'toString', 'includes',
    'indexOf', 'concat', 'flat', 'flatMap', 'entries', 'keys', 'values'])

function quet(d: string, ra: string[] = []): string[] {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name)
        if (e.isDirectory()) { if (e.name !== 'generated') quet(p, ra) }
        else if (e.name.endsWith('.ts')) ra.push(p)
    }
    return ra
}

/** Thay chú thích + chuỗi nháy đơn/kép bằng khoảng trắng — GIỮ NGUYÊN độ dài để số dòng không lệch.
 *
 * Vì sao phải bỏ cả chuỗi: `action: 'task.deleted'` từng bị đọc thành `task.deleted` (dấu nháy
 * không phải ký tự chữ nên lọt qua lookbehind) ⇒ báo oan `CrmTask không có cột deleted`.
 * KHÔNG đụng tới chuỗi backtick: bên trong `${t.tenCot}` là mã thật, bỏ đi là bỏ lọt. */
const boChuThich = (s: string) => s
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, m => m.replace(/[^\n]/g, ' '))
    .replace(/'(?:[^'\\\n]|\\.)*'/g, m => m.replace(/[^\n]/g, ' '))
    .replace(/"(?:[^"\\\n]|\\.)*"/g, m => m.replace(/[^\n]/g, ' '))

function thanKhoi(src: string, tu: number): [number, number] | null {
    const mo = src.indexOf('{', tu)
    if (mo < 0) return null
    let sau = 0
    for (let i = mo; i < src.length; i++) {
        if (src[i] === '{') sau++
        else if (src[i] === '}') { sau--; if (sau === 0) return [mo, i] }
    }
    return null
}

/** Thân lời gọi bắt đầu từ dấu `(` tại `mo` — trả [mo, viTriDongNgoac]. */
function thanNgoac(src: string, mo: number): [number, number] | null {
    if (src[mo] !== '(') return null
    let sau = 0
    for (let i = mo; i < src.length; i++) {
        if (src[i] === '(') sau++
        else if (src[i] === ')') { sau--; if (sau === 0) return [mo, i] }
    }
    return null
}

const bao: string[] = []

/** Tách các phần tử ở TẦNG NGOÀI của một mảng `[...]` (bỏ qua ngoặc lồng). */
function tachPhanTu(than: string): string[] {
    const ra: string[] = []
    let sau = 0, batDau = 0
    for (let i = 0; i < than.length; i++) {
        const c = than[i]
        if (c === '(' || c === '[' || c === '{') sau++
        else if (c === ')' || c === ']' || c === '}') sau--
        else if (c === ',' && sau === 0) { ra.push(than.slice(batDau, i)); batDau = i + 1 }
    }
    ra.push(than.slice(batDau))
    return ra
}

/**
 * `const [a, b, c] = await Promise.all([q1, q2, q3])` — ghép TÊN theo VỊ TRÍ với model của
 * từng câu truy vấn. Không có bảng này thì cả hai bộ soát mù hẳn 59 chỗ dùng kiểu tháo mảng
 * (đo 21/08/2026), mà đây lại là lối viết rất hay dùng cho các trang báo cáo.
 */
function bangThaoMang(src: string): Array<{ ten: string; model: string; viTri: number }> {
    const ra: Array<{ ten: string; model: string; viTri: number }> = []
    for (const m of src.matchAll(/const\s*\[([^\]]*)\]\s*=\s*await\s+Promise\.all\s*\(\s*\[/g)) {
        const tens = m[1].split(',').map(s => s.trim()).filter(s => /^[A-Za-z_$][\w$]*$/.test(s))
        const moMang = src.indexOf('[', src.indexOf('Promise.all', m.index!))
        if (moMang < 0) continue
        let sau = 0, dong = -1
        for (let i = moMang; i < src.length; i++) {
            if (src[i] === '[') sau++
            else if (src[i] === ']') { sau--; if (sau === 0) { dong = i; break } }
        }
        if (dong < 0) continue
        const phan = tachPhanTu(src.slice(moMang + 1, dong))
        phan.forEach((p, i) => {
            if (!tens[i]) return
            const q = p.match(/\w+\.(\w+)\.(findMany|findFirst|findUnique)\s*\(/)
            if (!q || /\$queryRaw/.test(p)) return
            const model = q[1][0].toUpperCase() + q[1].slice(1)
            if (cotCuaModel.has(model)) ra.push({ ten: tens[i], model, viTri: m.index! })
        })
    }
    return ra
}

/** Bảng tháo mảng của FILE đang soi — đặt lại ở đầu mỗi file. */
let THAO_MANG: Array<{ ten: string; model: string; viTri: number }> = []

/** Model của `bien` theo phép gán GẦN NHẤT phía TRƯỚC vị trí `truoc` (null nếu không phải Prisma). */
function timModel(src: string, bien: string, truoc: number): string | null {
    let model: string | null = null
    let viTriGan = -1

    /* Trước hết tra bảng `const [a, b] = await Promise.all([…])` — cũng theo lối GẦN NHẤT. */
    for (const t of THAO_MANG) {
        if (t.ten !== bien || t.viTri > truoc) continue
        if (t.viTri > viTriGan) { viTriGan = t.viTri; model = t.model }
    }
    /* Nhận cả khai báo có chú thích kiểu (`const rows: any[] = await sp.$queryRawUnsafe(…)`) —
     * thiếu nhánh này thì tên rơi về một khai báo Prisma cũ hơn ⇒ báo oan. */
    for (const g of src.matchAll(new RegExp('const\\s+' + bien + '\\s*(?::[^=\\n]+)?=\\s*([^\\n]*)', 'g'))) {
        if (g.index! > truoc) break
        const ve = g[1]
        const q = ve.match(/await\s+\w+\.(\w+)\.(findMany|findFirst|findUnique)\(/)
        model = (q && !/\$queryRaw/.test(ve)) ? q[1][0].toUpperCase() + q[1].slice(1) : null
        viTriGan = g.index!
    }
    if (!model || !cotCuaModel.has(model) || viTriGan < 0) return null

    /* CHE TÊN (21/08/2026): giữa chỗ khai báo và chỗ dùng, nếu cùng tên đó xuất hiện làm THAM SỐ
     * hàm thì cái đang dùng là tham số chứ không phải dòng Prisma.
     * Ca thật: `growthOpportunity.ts` có `const ds = await prisma.product.findMany(…)` ở dòng 250,
     * rồi dòng 344 khai `const dungNhom = (ten: string, ds: any[]) => …` — `ds.map(d => d.khach)`
     * bên trong là mảng đơn hàng nội bộ, không dính gì tới Product. */
    const cua = src.slice(viTriGan, truoc)
    if (new RegExp('[(,]\\s*' + bien + '\\s*:').test(cua)) return null
    if (new RegExp('\\(\\s*' + bien + '\\s*\\)\\s*(?::[^=\\n]*)?=>').test(cua)) return null
    return model
}

/** Soi mọi `it.<prop>` trong `than` (bắt đầu tại `goc` trong `src`) so với cột của `model`. */
function soiThan(ten: string, src: string, goc: number, than: string, it: string, model: string) {
    const cot = cotCuaModel.get(model)!
    const daBao = new Set<string>()
    for (const g of than.matchAll(new RegExp('(?<![\\w$.])' + it + '\\.(\\w+)', 'g'))) {
        const prop = g[1]
        if (cot.has(prop) || CHO_PHEP.has(prop) || daBao.has(prop)) continue
        daBao.add(prop)
        const soDong = src.slice(0, goc + g.index!).split('\n').length
        bao.push(`${ten}:${soDong}  ${it}.${prop}  — model ${model} không có cột này`)
    }
}

const dsFile = quet(GOC)
for (const f of dsFile) {
    const ten = path.relative(GOC, f).split(path.sep).join('/')
    const src = boChuThich(fs.readFileSync(f, 'utf8'))
    THAO_MANG = bangThaoMang(src)

    /* ── dạng 1: for (const t of rows) { … } ─────────────────────────────────── */
    for (const m of src.matchAll(/for\s*\(\s*const\s+(\w+)\s+of\s+(\w+)\s*\)/g)) {
        const it = m[1], bien = m[2]
        const model = timModel(src, bien, m.index!)
        if (!model) continue
        const khoi = thanKhoi(src, m.index! + m[0].length - 1)
        if (!khoi) continue
        const than = src.slice(khoi[0], khoi[1] + 1)
        /* vòng lặp lồng dùng lại cùng tên biến ⇒ bỏ, tránh báo oan */
        if (new RegExp('for\\s*\\(\\s*const\\s+' + it + '\\s+of\\s+(?!' + bien + ')').test(than)) continue
        soiThan(ten, src, khoi[0], than, it, model)
    }

    /* ── dạng 2: rows.map(t => …) · .filter · .find · .some · .every · .forEach ──
     * Cùng một con bệnh, chỉ khác vỏ. Thân = trong ngoặc của chính lời gọi đó. */
    /* Dấu `)` phải đứng SAU chú thích kiểu: `ds.map((t: any) => …)` là dạng phổ biến nhất ở đây.
     * Bản đầu đặt `\)?` trước phần kiểu nên KHÔNG khớp dạng đó — phép soi báo xanh một cách rỗng.
     * (Thử ngược bắt được, 21/08/2026.) */
    for (const m of src.matchAll(/(\w+)\s*\.\s*(map|filter|find|some|every|forEach|flatMap)\s*\(\s*(?:async\s*)?\(?\s*(\w+)\s*(?::[^=)]+)?\s*\)?\s*=>/g)) {
        const bien = m[1], it = m[3]
        const model = timModel(src, bien, m.index!)
        if (!model) continue
        const mo = src.indexOf('(', m.index! + bien.length)
        const ng = thanNgoac(src, mo)
        if (!ng) continue
        const than = src.slice(ng[0], ng[1] + 1)
        soiThan(ten, src, ng[0], than, it, model)
    }

    /* ── dạng 2b: rows.reduce((s, t) => s + t.<prop>, 0) ────────────────────────────────────
     * Tách riêng vì phần tử là THAM SỐ THỨ HAI. Đây lại đúng là câu lệnh hay dùng nhất để CỘNG
     * TIỀN: `s + t.cotMa` ra NaN, còn `s + (t.cotMa || 0)` ra tổng bằng 0 — im lặng cả hai. */
    for (const m of src.matchAll(/(\w+)\s*\.\s*reduce\s*\(\s*(?:async\s*)?\(\s*\w+\s*(?::[^,)]+)?\s*,\s*(\w+)\s*(?::[^=)]+)?\s*\)\s*=>/g)) {
        const bien = m[1], it = m[2]
        const model = timModel(src, bien, m.index!)
        if (!model) continue
        const mo = src.indexOf('(', m.index! + bien.length)
        const ng = thanNgoac(src, mo)
        if (!ng) continue
        soiThan(ten, src, ng[0], src.slice(ng[0], ng[1] + 1), it, model)
    }

    /* ── dạng 3: MỘT dòng — `const kh = await p.customer.findFirst(…)` rồi `kh.<prop>` ────────
     * Không có thân rõ ràng để bám, nên chặn cửa sổ tại: route/hàm kế tiếp, hoặc chỗ chính tên đó
     * được gán lại. Chặn hụt thì ăn sang phần sau và báo oan — đúng cái bẫy đã dính hai lần đêm
     * nay ở `check:hooknuotloi` và `check:nuottruong`. */
    for (const m of src.matchAll(/const\s+(\w+)\s*(?::[^=\n]+)?=\s*await\s+\w+\.(\w+)\.(findFirst|findUnique)\(/g)) {
        const bien = m[1]
        const model = m[2][0].toUpperCase() + m[2].slice(1)
        if (!cotCuaModel.has(model)) continue

        const sau = src.slice(m.index!)
        const dung = [
            sau.search(/\n\s*router\.(get|post|put|patch|delete)\(/),
            sau.search(/\n(?:export\s+)?(?:async\s+)?function\s/),
            sau.slice(1).search(new RegExp('\\n\\s*const\\s+' + bien + '\\s*(?::[^=\\n]+)?=')),
            /* … và tại chỗ CÙNG TÊN được dùng làm THAM SỐ — nếu không có hai mốc này thì cửa sổ
             * trôi rất xa trong các file khai báo kiểu object literal (không có `router.`/`function`
             * để chặn). Ca thật: `mcpFanpageTools.ts` có `const p = await prisma.fbPage.findFirst(…)`
             * ở dòng 121, trôi tới dòng 255 nơi `posts.map((p: any) => …)` là BÀI VIẾT Facebook. */
            sau.slice(1).search(new RegExp('[(,]\\s*' + bien + '\\s*:')),
            sau.slice(1).search(new RegExp('\\(\\s*' + bien + '\\s*\\)\\s*(?::[^=\\n]*)?=>')),
        ].filter(i => i > 0)
        const het = dung.length ? Math.min(...dung) : sau.length
        soiThan(ten, src, m.index!, sau.slice(0, het), bien, model)
    }
}

console.log('=== check:cotma — đọc cột không tồn tại trên dòng Prisma trả về ===\n')
const rutGon = [...new Set(bao)]
if (rutGon.length) {
    console.log(`❌ ${rutGon.length} chỗ đọc cột ma (luôn ra undefined):`)
    for (const l of rutGon) console.log('   - ' + l)
    console.log('\n→ So lại tên cột với prisma/schema-store.prisma. Nhớ: `!== ` trên cột ma LUÔN đúng.')
    process.exit(1)
}
console.log(`✅ Không chỗ nào đọc cột không tồn tại — đã soi ${dsFile.length} file.`)
if (!dsFile.length) { console.log('⛔ NHƯNG SOI 0 FILE — đường quét hỏng, KHÔNG kết luận được.'); process.exit(2) }
console.log('   Soi 1 chặng, 4 dạng: for…of · .map/.filter/… · .reduce (phần tử là tham số THỨ HAI) · findFirst/findUnique.')
