/**
 * Soát LỘ KHOÁ KÊNH BÁN ra trình duyệt — npx tsx scripts/check-kenh-an-toan.ts
 *                                        npx tsx scripts/check-kenh-an-toan.ts --tep <file.ts>…  (quét file chỉ định)
 *
 * Vì sao (20/10/2026): `GET /online-orders/channels` và mọi đường trả đơn sàn kèm
 * `include: { channel: true }` gửi NGUYÊN dòng OnlineChannel — apiSecret, accessToken,
 * refreshToken, khoá app Video, khoá Set Push — tới mọi trình duyệt có quyền xem đơn,
 * kể cả nhân viên đóng gói. Sửa bằng lib/kenhAnToan.ts. Bộ soát canh ba thứ:
 *
 *   1. Mọi cột của model OnlineChannel đã XẾP LOẠI (công khai | bí mật). Thêm cột mà quên
 *      xếp thì đỏ — nhất là cột token/khoá mới của sàn mới.
 *   2. anBiMatKenh / anBiMatKenhCuaDon làm đúng việc.
 *   3. Quét src/routes: biến lấy từ `onlineChannel.*` (không `select`, hoặc `select` có cột
 *      bí mật), `SELECT * FROM "OnlineChannel"`, hay đơn/sản phẩm sàn lấy kèm `channel`, mà
 *      đưa THẲNG vào `res.json(…)` (hoặc `return` của tool MCP) ⇒ đỏ. Lan theo `.map/.filter/
 *      .find`, `||`, `{ ...x }`; bọc anBiMatKenh / anBiMatKenhCuaDon thì qua; đọc trường lẻ
 *      (`kenh.name`, `!!kenh.accessToken`) không tính.
 *      GIỚI HẠN: theo dấu bằng TÊN biến trong một handler; không bắt việc CỐ Ý đọc trường bí
 *      mật (`token: kenh.accessToken`) — đó là quyết định có chủ đích, không phải sót.
 *
 * Bộ quét tự kiểm chính nó bằng các đoạn mã "phải kêu / phải im" ở cuối file trước khi
 * quét mã thật — bộ quét hỏng mà im lặng xanh còn tệ hơn không có.
 */
import fs from 'fs'
import path from 'path'
import ts from 'typescript'
import { COT_KENH_CONG_KHAI, COT_KENH_BI_MAT, anBiMatKenh, anBiMatKenhCuaDon, tenCoBiMat } from '../src/lib/kenhAnToan'

const GOC = path.resolve(__dirname, '..')
let loi = 0
const dung = (ten: string, ok: boolean, chiTiet = '') => { if (!ok) loi++; console.log(`${ok ? '✓' : '✗'} ${ten}${chiTiet ? ' — ' + chiTiet : ''}`) }

const BI_MAT = new Set<string>(COT_KENH_BI_MAT)
const CONG_KHAI = new Set<string>(COT_KENH_CONG_KHAI)

// ─── 1. Xếp loại cột theo schema ─────────────────────────────────────────────
const schema = fs.readFileSync(path.join(GOC, 'prisma/schema-store.prisma'), 'utf8')
const KIEU_VO_HUONG = new Set(['String', 'Int', 'Float', 'Boolean', 'DateTime', 'Json', 'Decimal', 'BigInt', 'Bytes'])

/** model → [tên trường, kiểu] */
function docModel(ten: string): Array<[string, string]> {
    const m = schema.match(new RegExp(`\\nmodel ${ten} \\{([\\s\\S]*?)\\n\\}`))
    if (!m) return []
    return m[1].split('\n')
        .map(d => d.replace(/\/\/.*$/, '').trim())
        .filter(d => d && !d.startsWith('@@'))
        .map(d => d.match(/^(\w+)\s+(\w+)/))
        .filter((x): x is RegExpMatchArray => !!x)
        .map(x => [x[1], x[2]] as [string, string])
}

/** Model có quan hệ tới OnlineChannel: accessor prisma (onlineOrder) → tên trường quan hệ (channel). */
const QUAN_HE_KENH = new Map<string, Set<string>>()
for (const m of schema.matchAll(/\nmodel (\w+) \{/g)) {
    for (const [truong, kieu] of docModel(m[1])) {
        if (kieu !== 'OnlineChannel') continue
        const accessor = m[1].charAt(0).toLowerCase() + m[1].slice(1)
        if (!QUAN_HE_KENH.has(accessor)) QUAN_HE_KENH.set(accessor, new Set())
        QUAN_HE_KENH.get(accessor)!.add(truong)
    }
}

function soatXepLoai() {
    const cot = docModel('OnlineChannel').filter(([, k]) => KIEU_VO_HUONG.has(k)).map(([t]) => t)
    dung('đọc được model OnlineChannel trong schema-store.prisma', cot.length >= 20, `${cot.length} cột`)
    const chuaXep = cot.filter(c => !CONG_KHAI.has(c) && !BI_MAT.has(c))
    dung('mọi cột OnlineChannel đã xếp loại công khai | bí mật', chuaXep.length === 0,
        chuaXep.length ? `chưa xếp: ${chuaXep.join(', ')} — thêm vào COT_KENH_CONG_KHAI hoặc COT_KENH_BI_MAT (src/lib/kenhAnToan.ts)` : '')
    const haiNoi = cot.filter(c => CONG_KHAI.has(c) && BI_MAT.has(c))
    dung('không cột nào vừa công khai vừa bí mật', haiNoi.length === 0, haiNoi.join(', '))
    const thua = [...CONG_KHAI, ...BI_MAT].filter(c => !cot.includes(c))
    dung('danh sách không có tên cột ma (đã xoá/đổi tên khỏi schema)', thua.length === 0, thua.join(', '))
    dung('tìm được quan hệ tới OnlineChannel (onlineOrder.channel)', !!QUAN_HE_KENH.get('onlineOrder')?.has('channel'),
        JSON.stringify([...QUAN_HE_KENH].map(([a, s]) => `${a}.${[...s].join('|')}`)))
}

// ─── 2. Hàm lọc ──────────────────────────────────────────────────────────────
function soatHamLoc() {
    const dong: Record<string, unknown> = {}
    for (const c of COT_KENH_CONG_KHAI) dong[c] = `cong-khai-${c}`
    for (const c of COT_KENH_BI_MAT) dong[c] = `BIMAT-${c}-x9Q7`
    dong.apiKey = '2044128'
    Object.assign(dong, { _count: { orders: 3 }, orders: [{ id: 'o1' }], cotMoiChuaXep: 'BIMAT-cot-moi' })

    const ra = anBiMatKenh(dong)
    const json = JSON.stringify(ra)
    dung('không còn giá trị bí mật nào trong JSON ra', !/BIMAT|2044128/.test(json), json.match(/.{0,40}(BIMAT|2044128).{0,20}/)?.[0] || '')
    dung('mọi cột công khai giữ nguyên', COT_KENH_CONG_KHAI.every(c => ra[c] === dong[c]))
    dung('mọi cột bí mật thành cờ has* = true', COT_KENH_BI_MAT.every(c => ra[tenCoBiMat(c)] === true && !(c in ra)),
        COT_KENH_BI_MAT.filter(c => ra[tenCoBiMat(c)] !== true || c in ra).join(', '))
    dung('apiKeyLast4 = 4 ký tự cuối', ra.apiKeyLast4 === '4128', String(ra.apiKeyLast4))
    dung('giữ _count, bỏ quan hệ orders và cột chưa xếp loại', ra._count?.orders === 3 && !('orders' in ra) && !('cotMoiChuaXep' in ra))

    const rong = anBiMatKenh({ id: 'k', accessToken: null, refreshToken: '', apiSecret: '   ', apiKey: null })
    dung('khoá null / rỗng / toàn khoảng trắng ⇒ has* = false',
        rong.hasAccessToken === false && rong.hasRefreshToken === false && rong.hasApiSecret === false && rong.hasApiKey === false && rong.apiKeyLast4 === null,
        JSON.stringify(rong))
    const ngan = anBiMatKenh({ id: 'k', apiKey: '1234' })
    dung('apiKey ≤ 4 ký tự: có cờ nhưng KHÔNG lộ 4 ký tự (là cả khoá)', ngan.hasApiKey === true && ngan.apiKeyLast4 === null, JSON.stringify(ngan))
    const hep = anBiMatKenh({ id: 'k', name: 'Kengi Store' })
    dung('select hẹp không có cột khoá ⇒ KHÔNG có cờ has* (không đọc ≠ không có)',
        JSON.stringify(hep) === JSON.stringify({ id: 'k', name: 'Kengi Store' }), JSON.stringify(hep))
    dung('null / undefined đi qua nguyên vẹn', anBiMatKenh(null) === null && anBiMatKenh(undefined) === undefined)

    const items = [{ id: 'i1', productName: 'Ổ cắm' }]
    const don = { id: 'd1', orderNumber: 'SPE-1', total: 120000, items, channel: dong }
    const donRa = anBiMatKenhCuaDon(don)
    dung('đơn: channel đã lọc, không còn bí mật', !/BIMAT|2044128/.test(JSON.stringify(donRa)) && donRa.channel.hasAccessToken === true)
    dung('đơn: các trường khác giữ nguyên', donRa.id === 'd1' && donRa.orderNumber === 'SPE-1' && donRa.total === 120000 && donRa.items === items)
    dung('đơn: không sửa vào đối tượng gốc', (don.channel as any).accessToken === 'BIMAT-accessToken-x9Q7')
    dung('đơn không kênh (channel: null) giữ null', anBiMatKenhCuaDon({ id: 'd2', channel: null }).channel === null)
    const khongCo = { id: 'd3' }
    dung('đơn lấy không kèm channel ⇒ trả nguyên đối tượng', anBiMatKenhCuaDon(khongCo) === khongCo)
}

// ─── 3. Quét mã route ────────────────────────────────────────────────────────
const HAM_LAY = new Set(['findMany', 'findFirst', 'findUnique', 'findFirstOrThrow', 'findUniqueOrThrow', 'create', 'update', 'upsert'])
const HAM_LOC = new Set(['anBiMatKenh', 'anBiMatKenhCuaDon'])
/** Phương thức mảng trả về (một phần) chính các phần tử — dữ liệu bẩn đi tiếp. */
const GIU_PHAN_TU = new Set(['map', 'flatMap', 'filter', 'slice', 'find', 'findLast', 'concat', 'sort', 'reverse', 'flat', 'at', 'toSorted', 'toReversed'])
const PHUONG_THUC_ROUTER = new Set(['get', 'post', 'put', 'patch', 'delete', 'all'])

function boBoc(n: ts.Expression): ts.Expression {
    for (;;) {
        if (ts.isAwaitExpression(n) || ts.isParenthesizedExpression(n) || ts.isAsExpression(n)
            || ts.isNonNullExpression(n) || ts.isSatisfiesExpression(n) || ts.isTypeAssertionExpression(n)) n = n.expression
        else return n
    }
}
const tenKhoa = (n: ts.PropertyName | undefined) => n && (ts.isIdentifier(n) || ts.isStringLiteral(n)) ? n.text : null

function layThuocTinh(obj: ts.ObjectLiteralExpression, ten: string): ts.Expression | null {
    for (const p of obj.properties) {
        if (ts.isPropertyAssignment(p) && tenKhoa(p.name) === ten) return boBoc(p.initializer)
        if (ts.isShorthandPropertyAssignment(p) && p.name.text === ten) return p.name
    }
    return null
}
const thamSoDau = (c: ts.CallExpression) => {
    const a = c.arguments[0] ? boBoc(c.arguments[0]) : null
    return a && ts.isObjectLiteralExpression(a) ? a : null
}
/** `select` có cột bí mật? select không phải literal (biến, hàm) thì không đọc được ⇒ coi là có. */
const selectCoBiMat = (sel: ts.Expression) => !ts.isObjectLiteralExpression(sel)
    || sel.properties.some(p => { const t = tenKhoa(p.name as ts.PropertyName); return !!t && BI_MAT.has(t) })

/** Biểu thức này là một lần đọc DB trả dòng kênh có (hoặc có thể có) khoá? */
function laNguonBan(e: ts.Expression): boolean {
    e = boBoc(e)
    if (ts.isTaggedTemplateExpression(e))
        return /\$queryRaw/.test(e.tag.getText()) && /"OnlineChannel"/.test(e.template.getText()) && /SELECT\s+\*/i.test(e.template.getText())
    if (!ts.isCallExpression(e) || !ts.isPropertyAccessExpression(e.expression)) return false
    const ham = e.expression.name.text
    if (/^\$queryRaw(Unsafe)?$/.test(ham)) {
        const sql = e.arguments[0]?.getText() || ''
        return /"OnlineChannel"/.test(sql) && /SELECT\s+(\*|\w+\.\*)/i.test(sql)
    }
    const doiTuong = e.expression.expression
    if (!HAM_LAY.has(ham) || !ts.isPropertyAccessExpression(doiTuong)) return false
    const model = doiTuong.name.text
    const arg = thamSoDau(e)
    if (model === 'onlineChannel') {
        const sel = arg && layThuocTinh(arg, 'select')
        return !sel || selectCoBiMat(sel)
    }
    const quanHe = QUAN_HE_KENH.get(model)
    if (!quanHe || !arg) return false
    for (const khoa of ['include', 'select']) {
        const o = layThuocTinh(arg, khoa)
        if (!o || !ts.isObjectLiteralExpression(o)) continue
        for (const truong of quanHe) {
            const ch = layThuocTinh(o, truong)
            if (!ch || ch.kind === ts.SyntaxKind.FalseKeyword) continue
            if (ch.kind === ts.SyntaxKind.TrueKeyword) return true
            if (ts.isObjectLiteralExpression(ch)) {
                const sel = layThuocTinh(ch, 'select')
                if (!sel || selectCoBiMat(sel)) return true
            } else return true
        }
    }
    return false
}

const hamGanNhat = (n: ts.Node): ts.Node | undefined => { let p = n.parent; while (p && !ts.isFunctionLike(p)) p = p.parent; return p }

/**
 * Callback của .map là hàm lọc, hoặc trả về thứ KHÔNG mang nguyên phần tử?
 * "Mang nguyên phần tử" = chính tham số, `tham_số.channel`, hay thứ dựng từ nó (`{ ...o }`,
 * `ganAnh(o)`, biến cục bộ khai từ những thứ đó). Đọc trường lẻ (`c.name`, `!!c.accessToken`,
 * `String(c.key).slice(-4)`) thì không. Thân khối: xét MỌI `return` của chính callback.
 */
function laHamLocHoacTaoMoi(cb?: ts.Expression): boolean {
    if (!cb) return false
    const c = boBoc(cb)
    if (ts.isIdentifier(c)) return HAM_LOC.has(c.text)
    if (!ts.isArrowFunction(c) && !ts.isFunctionExpression(c)) return false
    const tso = c.parameters[0] && ts.isIdentifier(c.parameters[0].name) ? c.parameters[0].name.text : null
    const cucBo = new Map<string, ts.Expression>()

    const mang = (x: ts.Expression, sau = 0): boolean => {
        x = boBoc(x)
        if (sau > 5) return true                                                    // vòng khai báo lạ: coi là bẩn
        if (ts.isIdentifier(x)) return x.text === tso || (cucBo.has(x.text) && mang(cucBo.get(x.text)!, sau + 1))
        if (ts.isPropertyAccessExpression(x)) return x.name.text === 'channel' && mang(x.expression, sau)
        if (ts.isElementAccessExpression(x)) return mang(x.expression, sau)
        if (ts.isCallExpression(x)) {
            if (ts.isIdentifier(x.expression) && HAM_LOC.has(x.expression.text)) return false
            return x.arguments.some(a => mang(a, sau))
                || (ts.isPropertyAccessExpression(x.expression) && GIU_PHAN_TU.has(x.expression.name.text) && mang(x.expression.expression, sau))
        }
        if (ts.isConditionalExpression(x)) return mang(x.whenTrue, sau) || mang(x.whenFalse, sau)
        if (ts.isBinaryExpression(x)) {
            const op = x.operatorToken.kind
            if (op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.QuestionQuestionToken) return mang(x.left, sau) || mang(x.right, sau)
            return op === ts.SyntaxKind.AmpersandAmpersandToken && mang(x.right, sau)
        }
        if (ts.isObjectLiteralExpression(x)) return x.properties.some(p =>
            ts.isSpreadAssignment(p) ? mang(p.expression, sau)
                : ts.isShorthandPropertyAssignment(p) ? mang(p.name, sau)
                    : ts.isPropertyAssignment(p) && mang(p.initializer, sau))
        if (ts.isArrayLiteralExpression(x)) return x.elements.some(e => mang(e as ts.Expression, sau))
        return false
    }

    if (!ts.isBlock(c.body)) return !mang(c.body)
    const traVe: ts.Expression[] = []
    duyet(c.body, n => {
        if (hamGanNhat(n) !== c) return
        if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) cucBo.set(n.name.text, n.initializer)
        if (ts.isReturnStatement(n) && n.expression) traVe.push(n.expression)
    })
    return traVe.length > 0 && traVe.every(r => !mang(r))
}

/** Giá trị của biểu thức có mang dòng kênh thô (hoặc mảng/đơn chứa nó)? */
function laGiaTriBan(e: ts.Expression, ban: Set<string>): boolean {
    e = boBoc(e)
    if (laNguonBan(e)) return true
    if (ts.isIdentifier(e)) return ban.has(e.text)
    if (ts.isCallExpression(e)) {
        if (ts.isIdentifier(e.expression) && HAM_LOC.has(e.expression.text)) return false
        if (ts.isPropertyAccessExpression(e.expression) && GIU_PHAN_TU.has(e.expression.name.text)
            && laGiaTriBan(e.expression.expression, ban)) {
            const ham = e.expression.name.text
            return !((ham === 'map' || ham === 'flatMap') && laHamLocHoacTaoMoi(e.arguments[0]))
        }
        return false
    }
    if (ts.isPropertyAccessExpression(e)) return e.name.text === 'channel' && laGiaTriBan(e.expression, ban)
    if (ts.isElementAccessExpression(e)) return laGiaTriBan(e.expression, ban)
    if (ts.isConditionalExpression(e)) return laGiaTriBan(e.whenTrue, ban) || laGiaTriBan(e.whenFalse, ban)
    if (ts.isBinaryExpression(e)) {
        const op = e.operatorToken.kind
        if (op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.QuestionQuestionToken) return laGiaTriBan(e.left, ban) || laGiaTriBan(e.right, ban)
        if (op === ts.SyntaxKind.AmpersandAmpersandToken) return laGiaTriBan(e.right, ban)
        return false
    }
    if (ts.isArrayLiteralExpression(e)) return e.elements.some(x => laGiaTriBan(x as ts.Expression, ban))
    if (ts.isObjectLiteralExpression(e)) return e.properties.some(p =>
        (ts.isSpreadAssignment(p) && laGiaTriBan(p.expression, ban))
        || (ts.isPropertyAssignment(p) && laGiaTriBan(p.initializer, ban))
        || (ts.isShorthandPropertyAssignment(p) && ban.has(p.name.text)))
    return false
}

/** Một lần nhắc tới biến bẩn trong res.json(...) có làm cả dòng kênh ra ngoài không? */
function roRaNgoai(x: ts.Identifier): boolean {
    let n: ts.Node = x
    for (;;) {
        const p: ts.Node = n.parent
        if (ts.isParenthesizedExpression(p) || ts.isAsExpression(p) || ts.isNonNullExpression(p) || ts.isSatisfiesExpression(p)) { n = p; continue }
        if (ts.isPropertyAccessExpression(p) && p.expression === n) {
            const ten = p.name.text
            if (ten === 'channel') { n = p; continue }                               // don.channel → vẫn là dòng kênh
            if (ts.isCallExpression(p.parent) && p.parent.expression === p) {
                if (!GIU_PHAN_TU.has(ten)) return false                              // .some/.includes/.join… → giá trị khác
                if ((ten === 'map' || ten === 'flatMap') && laHamLocHoacTaoMoi(p.parent.arguments[0])) return false
                n = p.parent; continue
            }
            return false                                                             // đọc trường lẻ: kenh.name, ds.length
        }
        if (ts.isElementAccessExpression(p) && p.expression === n) { n = p; continue }
        if (ts.isCallExpression(p) && (p.arguments as readonly ts.Node[]).includes(n))
            return !(ts.isIdentifier(p.expression) && HAM_LOC.has(p.expression.text))
        if (ts.isConditionalExpression(p)) { if (p.condition === n) return false; n = p; continue }
        if (ts.isPrefixUnaryExpression(p) || ts.isTypeOfExpression(p) || ts.isTemplateSpan(p)) return false
        if (ts.isBinaryExpression(p)) {
            const op = p.operatorToken.kind
            if (op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.QuestionQuestionToken) { n = p; continue }
            if (op === ts.SyntaxKind.AmpersandAmpersandToken) { if (p.left === n) return false; n = p; continue }
            return false                                                             // so sánh, cộng chuỗi…
        }
        return true                                                                  // data: x, { x }, ...x, [x], return x
    }
}

type Phat = { tep: string; dong: number; bien: string }

function duyet(n: ts.Node, f: (x: ts.Node) => void) { f(n); n.forEachChild(c => duyet(c, f)) }

function quetHam(fn: ts.FunctionLikeDeclaration, sf: ts.SourceFile, tep: string, laToolMcp: boolean, phat: Phat[]) {
    if (!fn.body) return
    const ban = new Set<string>()
    for (let doi = true; doi;) {
        doi = false
        const them = (ten: string) => { if (!ban.has(ten)) { ban.add(ten); doi = true } }
        duyet(fn.body, n => {
            if (ts.isVariableDeclaration(n) && n.initializer) {
                if (ts.isIdentifier(n.name)) { if (laGiaTriBan(n.initializer, ban)) them(n.name.text) }
                else if (ts.isArrayBindingPattern(n.name)) {
                    // const [tong, ds] = await Promise.all([đếm, findMany(...)])
                    const init = boBoc(n.initializer)
                    const mang = ts.isCallExpression(init) && /^Promise\.all(Settled)?$/.test(init.expression.getText()) && init.arguments[0]
                        ? boBoc(init.arguments[0]) : null
                    if (mang && ts.isArrayLiteralExpression(mang)) n.name.elements.forEach((el, i) => {
                        if (ts.isBindingElement(el) && ts.isIdentifier(el.name) && mang.elements[i] && laGiaTriBan(mang.elements[i] as ts.Expression, ban)) them(el.name.text)
                    })
                }
            }
            if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(n.left) && laGiaTriBan(n.right, ban)) them(n.left.text)
        })
    }
    if (!ban.size) return

    const bao = (x: ts.Identifier) => phat.push({ tep, dong: sf.getLineAndCharacterOfPosition(x.getStart(sf)).line + 1, bien: x.text })
    const quetBieuThuc = (goc: ts.Node) => duyet(goc, x => {
        if (!ts.isIdentifier(x) || !ban.has(x.text)) return
        const p = x.parent
        if ((ts.isPropertyAccessExpression(p) && p.name === x) || (ts.isPropertyAssignment(p) && p.name === x)) return   // tên khoá, không phải biến
        if (roRaNgoai(x)) bao(x)
    })
    duyet(fn.body, n => {
        if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'json')
            n.arguments.forEach(quetBieuThuc)
        // tool MCP: giá trị `return` của run() là thứ gửi cho client
        if (laToolMcp && ts.isReturnStatement(n) && n.expression) {
            let cha: ts.Node = n.parent
            while (cha && !ts.isFunctionLike(cha)) cha = cha.parent
            if (cha === fn) quetBieuThuc(n.expression)
        }
    })
}

function quetMa(ma: string, tep: string): Phat[] {
    const sf = ts.createSourceFile(tep, ma, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    const phat: Phat[] = []
    duyet(sf, n => {
        // router.get('/x', auth, async (req, res) => {...})
        if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)
            && PHUONG_THUC_ROUTER.has(n.expression.name.text) && ts.isIdentifier(n.expression.expression)) {
            for (const a of n.arguments) if (ts.isArrowFunction(a) || ts.isFunctionExpression(a)) quetHam(a, sf, tep, false, phat)
        }
        // tool MCP: { name, run: async (a, ctx) => {...} }
        if (ts.isPropertyAssignment(n) && tenKhoa(n.name) === 'run' && (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer)))
            quetHam(n.initializer, sf, tep, true, phat)
    })
    return phat
}

// ─── 3a. Bộ quét tự kiểm: phải kêu / phải im ─────────────────────────────────
const PHAI_KEU: Array<[string, string]> = [
    ['findMany không select', `router.get('/a', async (req, res) => { const ds = await prisma.onlineChannel.findMany({ orderBy: { createdAt: 'desc' } }); res.json({ success: true, data: ds }) })`],
    ['select có accessToken', `router.get('/a', async (req, res) => { const k = await prisma.onlineChannel.findFirst({ select: { id: true, accessToken: true } }); res.json({ data: k }) })`],
    ['đơn include channel: true', `router.get('/:id', async (req, res) => { const order = await prisma.onlineOrder.findUnique({ where: { id: 'x' }, include: { items: true, channel: true } }); res.json({ success: true, data: order }) })`],
    ['Promise.all + map(ganAnh) + { items }', `router.get('/', async (req, res) => {
        const [total, orders] = await Promise.all([prisma.onlineOrder.count({ where }), prisma.onlineOrder.findMany({ where, include: { channel: true } })])
        const ganAnh = (o: any) => ({ ...o, items: [] })
        let items: any[] = orders.map(ganAnh)
        items = orders.map(o => { const oa = ganAnh(o); return oa })
        res.json({ success: true, data: { items, total } }) })`],
    ['đưa order.channel ra', `router.get('/b', async (req, res) => { const o = await prisma.onlineOrder.findFirst({ include: { channel: true } }); res.json({ kenh: o?.channel }) })`],
    ['rải ...kenh vào res.status().json', `router.post('/c', async (req, res) => { const ch = await prisma.onlineChannel.update({ where: { id: 'x' }, data: {} }); res.status(201).json({ success: true, ...ch }) })`],
    ['SELECT * FROM "OnlineChannel"', `router.get('/d', async (req, res) => { const rows: any[] = await prisma.$queryRawUnsafe(\`SELECT * FROM "OnlineChannel" WHERE "platform" = 'shopee'\`); res.json({ data: rows }) })`],
    ['tool MCP trả nguyên đơn kèm channel', `const TOOLS = [{ name: 'x', run: async (a, { prisma }) => { const updated = await prisma.onlineOrder.update({ where: { id: 'x' }, data: {}, include: { items: true, channel: true } }); return updated } }]`],
    ['find() lấy một kênh rồi trả', `router.get('/e', async (req, res) => { const ds = await prisma.onlineChannel.findMany(); const k = ds.find(c => c.platform === 'shopee') || null; res.json({ data: k }) })`],
    ['map thân khối rải biến dẫn xuất từ phần tử', `router.get('/f', async (req, res) => {
        const orders = await prisma.onlineOrder.findMany({ include: { channel: true } })
        const items = orders.map(o => { const oa = { ...o }; const p = null; return p ? { ...oa, loi: 1 } : oa })
        res.json({ data: items }) })`],
    ['map thân khối trả nguyên tham số', `router.get('/g', async (req, res) => { const ds = await prisma.onlineChannel.findMany(); res.json({ data: ds.map(c => { if (!c.id) return null; return c }) }) })`],
]
const PHAI_IM: Array<[string, string]> = [
    ['map(anBiMatKenh)', `router.get('/a', async (req, res) => { const ds = await prisma.onlineChannel.findMany(); res.json({ success: true, data: ds.map(anBiMatKenh) }) })`],
    ['anBiMatKenhCuaDon(order)', `router.get('/:id', async (req, res) => { const order = await prisma.onlineOrder.findUnique({ where: { id: 'x' }, include: { channel: true } }); res.json({ data: anBiMatKenhCuaDon(order) }) })`],
    ['items.map(anBiMatKenhCuaDon)', `router.get('/', async (req, res) => { const orders = await prisma.onlineOrder.findMany({ include: { channel: true } }); let items = orders.map(o => ({ ...o })); res.json({ data: { items: items.map(anBiMatKenhCuaDon) } }) })`],
    ['đọc trường lẻ + cờ !!', `router.get('/a', async (req, res) => { const ch = await prisma.onlineChannel.findUnique({ where: { id: 'x' } }); res.json({ data: { ten: ch.name, coToken: !!ch.accessToken, platform: ch?.platform } }) })`],
    ['select không có khoá', `router.get('/a', async (req, res) => { const ds = await prisma.onlineChannel.findMany({ select: { id: true, name: true, status: true } }); res.json({ data: ds }) })`],
    ['map tạo đối tượng mới', `router.get('/a', async (req, res) => { const ds = await prisma.onlineChannel.findMany(); const gon = ds.filter(c => c.platform === 'shopee').map((c: any) => ({ id: c.id, ten: c.name, daNoi: !!c.accessToken })); res.json({ data: { kenhDs: gon } }) })`],
    ['Transaction.channel là CHUỖI, không phải quan hệ', `router.get('/a', async (req, res) => { const tx = await prisma.transaction.findMany({ select: { id: true, channel: true } }); res.json({ data: tx }) })`],
    ['đếm/so sánh/some', `router.get('/a', async (req, res) => { const ds = await prisma.onlineChannel.findMany(); res.json({ n: ds.length, co: ds.some(c => c.accessToken), dau: ds[0]?.name, rong: ds.length === 0 }) })`],
    ['tên KHOÁ trùng tên biến bẩn', `router.get('/a', async (req, res) => { const order = await prisma.onlineOrder.findFirst({ include: { channel: true } }); const phieu: any = {}; res.json({ order: phieu.order, ma: order?.orderNumber }) })`],
    ['đơn include channel select hẹp', `router.get('/a', async (req, res) => { const o = await prisma.onlineOrder.findFirst({ include: { channel: { select: { id: true, name: true } } } }); res.json({ data: o }) })`],
    ['map thân khối dựng đối tượng mới (kiểu admin channel-auth-urls)', `router.get('/a', async (req, res) => {
        const channels = await sp.onlineChannel.findMany({ select: { id: true, name: true, apiKey: true, apiSecret: true } })
        const out = channels.map((ch: any) => {
            const apiKey = (ch.apiKey || '').trim()
            const info: any = { channel: ch.name, channelId: ch.id, apiKeyDuoi4: apiKey ? apiKey.slice(-4) : null, ...(ch.x ? { canh: 1 } : {}) }
            if (!apiKey) { info.loi = 'thiếu'; return info }
            try { return { ...info, authUrl: 'u' } } catch (e: any) { return { channel: ch.name, loi: e?.message } }
        })
        res.json({ success: true, data: { channels: out } }) })`],
]

function soatBoQuet() {
    for (const [ten, ma] of PHAI_KEU) {
        const p = quetMa(ma, 'mau.ts')
        dung(`[phải kêu] ${ten}`, p.length > 0)
    }
    for (const [ten, ma] of PHAI_IM) {
        const p = quetMa(ma, 'mau.ts')
        dung(`[phải im] ${ten}`, p.length === 0, p.map(x => `dòng ${x.dong}: ${x.bien}`).join('; '))
    }
}

// ─── 3b. Quét mã thật ────────────────────────────────────────────────────────
function tepRoute(dir: string, ra: string[] = []): string[] {
    for (const m of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, m.name)
        if (m.isDirectory()) tepRoute(p, ra)
        else if (m.name.endsWith('.ts') && !m.name.endsWith('.d.ts')) ra.push(p)
    }
    return ra
}

function soatMaThat(cacTep: string[]) {
    const phat: Phat[] = []
    for (const tep of cacTep) phat.push(...quetMa(fs.readFileSync(tep, 'utf8'), path.relative(GOC, tep).replace(/\\/g, '/')))
    dung(`quét ${cacTep.length} file route: không đường nào đưa dòng kênh thô ra res.json / tool MCP`, phat.length === 0,
        phat.length ? '\n    ' + phat.map(x => `${x.tep}:${x.dong} — '${x.bien}' mang dòng OnlineChannel thô (bọc anBiMatKenh / anBiMatKenhCuaDon)`).join('\n    ') : '')
    return phat
}

function main() {
    const iTep = process.argv.indexOf('--tep')
    if (iTep > 0) {
        // Chế độ đo: quét đúng các file chỉ định, in từng chỗ — dùng để đo bộ quét trên mã CŨ.
        const phat = soatMaThat(process.argv.slice(iTep + 1).map(t => path.resolve(t)))
        console.log(`\n${phat.length} chỗ lộ`)
        process.exit(phat.length ? 1 : 0)
    }
    console.log('── 1. Xếp loại cột OnlineChannel')
    soatXepLoai()
    console.log('\n── 2. Hàm lọc anBiMatKenh / anBiMatKenhCuaDon')
    soatHamLoc()
    console.log('\n── 3. Bộ quét tự kiểm')
    soatBoQuet()
    console.log('\n── 4. Quét src/routes')
    soatMaThat(tepRoute(path.join(GOC, 'src/routes')))

    console.log(loi ? `\n✗ ${loi} ca SAI` : '\n✓ Tất cả ca đều đúng')
    process.exit(loi ? 1 : 0)
}
main()
