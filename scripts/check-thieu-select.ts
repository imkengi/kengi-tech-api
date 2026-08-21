/**
 * check:thieuselect — đọc TRƯỜNG KHÔNG CÓ TRONG `select` của chính câu truy vấn.
 *
 * Anh em sinh đôi của `check:cotma`, khác mỗi cái mốc so:
 *   · `check:cotma`      — so với CỘT CỦA MODEL     (cột không hề tồn tại)
 *   · `check:thieuselect`— so với KHOÁ TRONG `select` (cột có thật, nhưng KHÔNG được lấy về)
 *
 * Triệu chứng y hệt nhau: đọc ra `undefined`, không lỗi, không cảnh báo, không P2022. Loại này
 * còn dễ sinh hơn: `select` bị sửa dần theo thời gian, còn chỗ đọc nằm xa bên dưới, không ai nhớ.
 *
 * Ca thật (21/08/2026, `POST /closing-entries`): câu truy vấn lấy `debitAccount, creditAccount,
 * amount, reference, referenceType` nhưng phần gom số dư lại đọc `e.debitAccountName` /
 * `e.creditAccountName` (hai cột NÀY CÓ THẬT trên `JournalEntry`, chỉ là không được select).
 * Chúng ra `undefined`, rơi vào đường lùi `bal.name || code`, nên bảng kết chuyển hiện **mã tài
 * khoản thay cho tên** — "511" thay vì "Doanh thu bán hàng". Đường lùi che mất lỗi.
 *
 * Chỉ xét `select`. KHÔNG xét `include` (include vẫn trả đủ cột vô hướng nên không mất gì).
 * Soi 3 dạng dùng: `for…of` · callback `.map/.filter/.reduce/…` · `findFirst/findUnique` đọc thẳng.
 * Nhận cả hai lối khai báo: `const X = await …` VÀ `const [a, b] = await Promise.all([…])`
 * (ghép tên theo VỊ TRÍ trong mảng — thiếu nhánh này là mù 59 chỗ, đúng lối viết của trang báo cáo).
 *
 * Ba chốt chống báo oan, mỗi chốt đổi bằng một lần báo oan thật:
 *   · lần NGƯỢC từ chỗ dùng về khai báo GẦN NHẤT (bản đầu quét xuôi ⇒ 204 báo động, gần hết là oan)
 *   · bỏ khi tên bị một THAM SỐ HÀM che (ca `growthOpportunity.ts`)
 *   · bỏ khi giữa khai báo và chỗ dùng có ranh giới route/hàm — khác phạm vi thì chỉ là trùng tên
 *     (ca `imports` ở `tax.ts`: khai báo thật là `const [a, b, imports] = await Promise.all([…])`,
 *      kiểu tháo mảng nên regex không thấy, suýt tố oan một câu truy vấn hoàn toàn đúng)
 *
 * Chạy: npm run check:thieuselect
 */
import fs from 'fs'
import path from 'path'

const GOC = path.resolve(__dirname, '../src')

const CHO_PHEP = new Set(['_count', 'length', 'map', 'filter', 'reduce', 'forEach', 'find', 'some',
    'every', 'slice', 'push', 'sort', 'join', 'toString', 'includes', 'indexOf', 'concat', 'flat',
    'flatMap', 'entries', 'keys', 'values'])

/** Thay chú thích + chuỗi bằng khoảng trắng, GIỮ độ dài để số dòng không lệch. */
const boChuThich = (s: string) => s
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, m => m.replace(/[^\n]/g, ' '))
    .replace(/'(?:[^'\\\n]|\\.)*'/g, m => m.replace(/[^\n]/g, ' '))
    .replace(/"(?:[^"\\\n]|\\.)*"/g, m => m.replace(/[^\n]/g, ' '))

function canBang(src: string, mo: number, a: string, b: string): number {
    let sau = 0
    for (let i = mo; i < src.length; i++) {
        if (src[i] === a) sau++
        else if (src[i] === b) { sau--; if (sau === 0) return i }
    }
    return -1
}

/** Khoá ở TẦNG NGOÀI CÙNG của một object literal (bỏ qua object lồng bên trong). */
function khoaTangNgoai(than: string): Set<string> {
    const ra = new Set<string>()
    let sau = 0
    for (let i = 0; i < than.length; i++) {
        const c = than[i]
        if (c === '{' || c === '[') sau++
        else if (c === '}' || c === ']') sau--
        else if (sau === 1) {
            const m = /^([A-Za-z_$][\w$]*)\s*:/.exec(than.slice(i))
            if (m && (i === 0 || /[{,\s]/.test(than[i - 1]))) { ra.add(m[1]); i += m[0].length - 1 }
        }
    }
    return ra
}

function quet(d: string, ra: string[] = []): string[] {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name)
        if (e.isDirectory()) { if (e.name !== 'generated') quet(p, ra) }
        else if (e.name.endsWith('.ts')) ra.push(p)
    }
    return ra
}

/** Tách phần tử ở TẦNG NGOÀI của mảng `[...]` (bỏ qua ngoặc lồng). */
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
 * `const [a, b] = await Promise.all([q1, q2])` — ghép TÊN theo VỊ TRÍ với `select` của từng câu.
 * Thiếu bảng này thì bộ soát mù hẳn **59 chỗ** dùng lối tháo mảng (đo 21/08/2026) — mà đó lại là
 * lối viết ưa dùng của các trang báo cáo, tức đúng chỗ tiền bạc.
 */
function bangThaoMang(src: string): Array<{ ten: string; daLay: Set<string>; viTri: number }> {
    const ra: Array<{ ten: string; daLay: Set<string>; viTri: number }> = []
    for (const m of src.matchAll(/const\s*\[([^\]]*)\]\s*=\s*await\s+Promise\.all\s*\(\s*\[/g)) {
        const tens = m[1].split(',').map(s => s.trim()).filter(s => /^[A-Za-z_$][\w$]*$/.test(s))
        const moMang = src.indexOf('[', src.indexOf('Promise.all', m.index!))
        if (moMang < 0) continue
        const dong = canBang(src, moMang, '[', ']')
        if (dong < 0) continue
        tachPhanTu(src.slice(moMang + 1, dong)).forEach((p, i) => {
            if (!tens[i]) return
            if (!/\w+\.\w+\.(findMany|findFirst|findUnique)\s*\(/.test(p)) return
            if (/\$queryRaw/.test(p) || /include\s*:/.test(p)) return
            const iSel = p.indexOf('select:')
            if (iSel < 0) return
            const moSel = p.indexOf('{', iSel)
            if (moSel < 0) return
            const dongSel = canBang(p, moSel, '{', '}')
            if (dongSel < 0) return
            const daLay = khoaTangNgoai(p.slice(moSel, dongSel + 1))
            if (daLay.size) ra.push({ ten: tens[i], daLay, viTri: m.index! })
        })
    }
    return ra
}

const bao: string[] = []
const dsFile = quet(GOC)
for (const f of dsFile) {
    const ten = path.relative(GOC, f).split(path.sep).join('/')
    const src = boChuThich(fs.readFileSync(f, 'utf8'))
    const THAO_MANG = bangThaoMang(src)

    /* Lần NGƯỢC từ chỗ dùng về khai báo gần nhất — KHÔNG duyệt theo khai báo rồi quét cả file.
     * Bản đầu làm ngược nên một tên hay dùng lại (`e`, `rows`) ghép với MỌI khai báo cùng tên
     * ⇒ 204 báo động, gần hết là oan. Sửa xong còn 4, và cả 4 đều là bệnh thật. */
    const timSelect = (bien: string, truoc: number): Set<string> | null => {
        /* Tra bảng tháo mảng trước — cũng theo lối GẦN NHẤT phía trước. */
        let tmGan: { daLay: Set<string>; viTri: number } | null = null
        for (const t of THAO_MANG) {
            if (t.ten !== bien || t.viTri > truoc) continue
            if (!tmGan || t.viTri > tmGan.viTri) tmGan = t
        }

        let m: RegExpMatchArray | null = null
        for (const k of src.matchAll(new RegExp('const\\s+' + bien + '\\s*(?::[^=\\n]+)?=\\s*await\\s+\\w+\\.(\\w+)\\.(findMany|findFirst|findUnique)\\s*\\(', 'g'))) {
            if (k.index! > truoc) break
            m = k
        }
        /* Không có khai báo `const X = await …` nào, nhưng có bảng tháo mảng ⇒ dùng bảng đó. */
        if (!m) return tmGan ? tmGan.daLay : null
        /* Cả hai cùng có: lấy cái GẦN chỗ dùng hơn. */
        if (tmGan && tmGan.viTri > m.index!) return tmGan.daLay
        /* Phép gán cùng tên KHÁC nằm gần hơn (không phải Prisma) ⇒ bỏ, tránh ghép nhầm. */
        let chen: RegExpMatchArray | null = null
        for (const k of src.matchAll(new RegExp('const\\s+' + bien + '\\s*(?::[^=\\n]+)?=', 'g'))) {
            if (k.index! > truoc) break
            chen = k
        }
        if (chen && chen.index! > m.index!) return null

        /* CHE TÊN: giữa chỗ khai báo và chỗ dùng, nếu cùng tên đó xuất hiện làm THAM SỐ hàm thì
         * cái đang dùng là tham số, không phải dòng Prisma. Ca thật: `growthOpportunity.ts` khai
         * `const ds = await prisma.product.findMany(…)` rồi bên dưới `const dungNhom = (ten, ds: any[]) => …`.
         * `check:cotma` đã có chốt này; tôi chép bộ soát sang mà quên mang theo. */
        const cua = src.slice(m.index!, truoc)
        if (new RegExp('[(,]\\s*' + bien + '\\s*:').test(cua)) return null
        if (new RegExp('\\(\\s*' + bien + '\\s*\\)\\s*(?::[^=\\n]*)?=>').test(cua)) return null

        /* KHÁC HÀM thì đừng ghép: nếu giữa chỗ khai báo và chỗ dùng có ranh giới route/hàm thì hai
         * chỗ đó không cùng phạm vi, biến trùng tên thôi. Ca thật: `tax.ts` dùng `imports` ở dòng
         * 2477 nhưng khai báo thật là `const [txs, expenses, imports] = await Promise.all([…])`
         * (kiểu tháo mảng — regex này không khớp), nên nó rơi về một khai báo cách 1.700 dòng ở
         * route khác và báo oan. Câu truy vấn thật CÓ lấy `createdAt`. */
        if (/\n\s*router\.(get|post|put|patch|delete)\(/.test(cua)) return null
        if (/\n(?:export\s+)?(?:async\s+)?function\s/.test(cua)) return null

        const moNgoac = m.index! + m[0].length - 1
        const dongNgoac = canBang(src, moNgoac, '(', ')')
        if (dongNgoac < 0) return null
        const doiSo = src.slice(moNgoac, dongNgoac + 1)

        const iSel = doiSo.indexOf('select:')
        if (iSel < 0 || /include\s*:/.test(doiSo)) return null
        const moSel = doiSo.indexOf('{', iSel)
        if (moSel < 0) return null
        const dongSel = canBang(doiSo, moSel, '{', '}')
        if (dongSel < 0) return null
        const daLay = khoaTangNgoai(doiSo.slice(moSel, dongSel + 1))
        return daLay.size ? daLay : null
    }

    const soi = (goc: number, than: string, it: string, daLay: Set<string>) => {
        const daBao = new Set<string>()
        for (const h of than.matchAll(new RegExp('(?<![\\w$.])' + it + '\\.(\\w+)', 'g'))) {
            const prop = h[1]
            if (daLay.has(prop) || CHO_PHEP.has(prop) || daBao.has(prop)) continue
            daBao.add(prop)
            const soDong = src.slice(0, goc + h.index!).split('\n').length
            bao.push(`${ten}:${soDong}  ${it}.${prop}  — select không lấy cột này (đang lấy: ${[...daLay].slice(0, 6).join(', ')}${daLay.size > 6 ? '…' : ''})`)
        }
    }

    /* ── dạng 1: for (const t of rows) { … } ─────────────────────────────────── */
    for (const vong of src.matchAll(/for\s*\(\s*const\s+(\w+)\s+of\s+(\w+)\s*\)/g)) {
        const daLay = timSelect(vong[2], vong.index!)
        if (!daLay) continue
        const moKhoi = src.indexOf('{', vong.index! + vong[0].length - 1)
        if (moKhoi < 0) continue
        const dongKhoi = canBang(src, moKhoi, '{', '}')
        if (dongKhoi < 0) continue
        soi(moKhoi, src.slice(moKhoi, dongKhoi + 1), vong[1], daLay)
    }

    /* ── dạng 2: rows.map(t => …) / .filter / .find / … và .reduce((s, t) => …) ──
     * Dấu `)` phải đứng SAU chú thích kiểu — dạng `((t: any) => …)` là phổ biến nhất ở đây. */
    const CALLBACK = [
        /(\w+)\s*\.\s*(?:map|filter|find|some|every|forEach|flatMap)\s*\(\s*(?:async\s*)?\(?\s*(\w+)\s*(?::[^=)]+)?\s*\)?\s*=>/g,
        /(\w+)\s*\.\s*reduce\s*\(\s*(?:async\s*)?\(\s*\w+\s*(?::[^,)]+)?\s*,\s*(\w+)\s*(?::[^=)]+)?\s*\)\s*=>/g,
    ]
    for (const re of CALLBACK) {
        for (const m of src.matchAll(re)) {
            const daLay = timSelect(m[1], m.index!)
            if (!daLay) continue
            const mo = src.indexOf('(', m.index! + m[1].length)
            const dong = canBang(src, mo, '(', ')')
            if (mo < 0 || dong < 0) continue
            soi(mo, src.slice(mo, dong + 1), m[2], daLay)
        }
    }

    /* ── dạng 3: `const kh = await …findFirst({ select })` rồi `kh.<prop>` ────────
     * Chặn cửa sổ ở route/hàm kế tiếp, chỗ gán lại, và chỗ trùng tên làm THAM SỐ. */
    for (const m of src.matchAll(/const\s+(\w+)\s*(?::[^=\n]+)?=\s*await\s+\w+\.\w+\.(findFirst|findUnique)\s*\(/g)) {
        const bien = m[1]
        const daLay = timSelect(bien, m.index! + 1)
        if (!daLay) continue
        const sau = src.slice(m.index!)
        const dung = [
            sau.search(/\n\s*router\.(get|post|put|patch|delete)\(/),
            sau.search(/\n(?:export\s+)?(?:async\s+)?function\s/),
            sau.slice(1).search(new RegExp('\\n\\s*const\\s+' + bien + '\\s*(?::[^=\\n]+)?=')),
            sau.slice(1).search(new RegExp('[(,]\\s*' + bien + '\\s*:')),
            sau.slice(1).search(new RegExp('\\(\\s*' + bien + '\\s*\\)\\s*(?::[^=\\n]*)?=>')),
        ].filter(i => i > 0)
        soi(m.index!, sau.slice(0, dung.length ? Math.min(...dung) : sau.length), bien, daLay)
    }
}

console.log('=== check:thieuselect — đọc trường mà `select` không lấy về ===\n')
const rutGon = [...new Set(bao)]
if (rutGon.length) {
    console.log(`❌ ${rutGon.length} chỗ đọc trường ngoài select (luôn ra undefined):`)
    for (const l of rutGon) console.log('   - ' + l)
    console.log('\n→ Thêm cột vào `select`, hoặc bỏ chỗ đọc. Coi chừng đường lùi `|| x` che mất lỗi.')
    process.exit(1)
}
console.log(`✅ Không chỗ nào đọc trường ngoài select. — đã soi ${dsFile.length} file.`)
if (!dsFile.length) { console.log('⛔ NHƯNG SOI 0 FILE — đường quét hỏng, KHÔNG kết luận được.'); process.exit(2) }
console.log('   Soi 3 dạng dùng × 2 lối khai báo (const X = await … và const [a,b] = await Promise.all([…])).')
