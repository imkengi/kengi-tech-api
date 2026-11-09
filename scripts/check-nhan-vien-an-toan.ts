/**
 * Soát LỘ CỘT BÍ MẬT NHÂN VIÊN (model User) ra trình duyệt / app — npx tsx scripts/check-nhan-vien-an-toan.ts
 *                                                                npx tsx scripts/check-nhan-vien-an-toan.ts --tep <file.ts>…  (quét file chỉ định)
 *
 * Vì sao (09/11/2026): `GET /api/employees` (cả `/:id`, `POST /`, `PUT /:id`, `PUT /:id/toggle-status`) trả nguyên
 * dòng User chỉ bỏ `password` ⇒ ai có quyền `employees.view` đọc được `twoFactorSecret` (hạt TOTP — tự sinh mã 2FA)
 * và `trustedDevices` (deviceId — gửi lúc đăng nhập là bỏ qua 2FA) của chủ shop. `GET /api/admin/users` rải `...u`
 * ⇒ kèm cả hash mật khẩu mọi nhân viên mọi cửa hàng. Sửa bằng danh sách TRẮNG `CHON_NHAN_VIEN_AN_TOAN`
 * (src/lib/nhanVienAnToan.ts). Bộ soát canh:
 *
 *   1. Mọi cột vô hướng của User đã XẾP LOẠI: có trong CHON_NHAN_VIEN_AN_TOAN (được ra ngoài) HOẶC trong
 *      COT_NHAN_VIEN_BI_MAT. Thêm cột mà quên xếp ⇒ đỏ — nhất là cột token / mã / khoá mới.
 *   2. CHON_NHAN_VIEN_AN_TOAN không chứa cột bí mật, và GIỮ đủ trường web + app Android đang đọc (siết quá tay là
 *      màn hình hỏng câm: thiếu trường thì đọc ra `undefined`, không lỗi, không cảnh báo).
 *   3. Quét src/routes: dòng User lấy KHÔNG `select` (hoặc `select` có cột bí mật), quan hệ tới User lấy nguyên
 *      (`include: { creator: true }`…), `SELECT * FROM "User"` — mà đi THẲNG vào res.json / res.send / `return` của
 *      tool MCP ⇒ đỏ. Lan theo `.map/.filter/.find`, tham số callback `.forEach/.map(u => …)`, `for…of`, `.push(…)`,
 *      `{ ...x }`, `||`, và ĐẶC BIỆT `const { password, ...rest } = u` — đúng kiểu danh sách CẤM đã gây vụ này:
 *      `rest` vẫn bẩn trừ khi bóc ĐỦ mọi cột bí mật. (`check:kenh-an-toan` không lần hai lối tháo/push này — chép
 *      nguyên bộ quét đó sang là xanh OAN trên chính mã cũ đã lộ.)
 *      GIỚI HẠN: lần theo TÊN biến trong một handler; không bắt việc CỐ Ý đọc trường bí mật (`s: u.twoFactorSecret`).
 *   4. Các route nhân viên trả bằng đúng `select: CHON_NHAN_VIEN_AN_TOAN`.
 *
 * Bộ quét tự kiểm bằng các đoạn mã "phải kêu / phải im" — gồm NGUYÊN VĂN mã cũ đã gây lộ — trước khi quét mã thật:
 * bộ quét hỏng mà im lặng xanh còn tệ hơn không có.
 */
import fs from 'fs'
import path from 'path'
import ts from 'typescript'
import { CHON_NHAN_VIEN_AN_TOAN, COT_NHAN_VIEN_BI_MAT } from '../src/lib/nhanVienAnToan'

const GOC = path.resolve(__dirname, '..')
let loi = 0
const dung = (ten: string, ok: boolean, chiTiet = '') => { if (!ok) loi++; console.log(`${ok ? '✓' : '✗'} ${ten}${chiTiet ? ' — ' + chiTiet : ''}`) }

const BI_MAT = new Set<string>(COT_NHAN_VIEN_BI_MAT)
const TEN_SELECT_AN_TOAN = 'CHON_NHAN_VIEN_AN_TOAN'

/** Trường web + app Android ĐANG đọc từ /api/employees — bỏ khỏi danh sách trắng là màn hình hỏng câm. */
const TRUONG_APP_DUNG = [
    // web (repo open-retail): src/features/employees/hooks/useEmployees.ts › interface Employee
    'id', 'code', 'name', 'email', 'phone', 'role', 'avatar', 'salary', 'hireDate', 'shifts', 'totalSales',
    'employeeStatus', 'notes', 'branchId', 'branch', 'createdAt',
    // web: trang dashboard-employees đọc `(employee as any).username` để sửa tên đăng nhập
    'username',
    // Android: data/model/Models.kt › Employee — id, code, name, email, phone, role, salary, employeeStatus,
    // hireDate, notes, createdAt (đều nằm trong các trường trên)
]

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

/** Model có quan hệ tới User: accessor prisma (transaction) → tên trường quan hệ (creator). */
const QUAN_HE_USER = new Map<string, Set<string>>()
/** Mọi tên trường quan hệ trỏ tới User (user, users, creator, salesUser…) — `x.<tên>` vẫn là dòng User. */
const TEN_QUAN_HE = new Set<string>()
for (const m of schema.matchAll(/\nmodel (\w+) \{/g)) {
    for (const [truong, kieu] of docModel(m[1])) {
        if (kieu !== 'User') continue
        const accessor = m[1].charAt(0).toLowerCase() + m[1].slice(1)
        if (!QUAN_HE_USER.has(accessor)) QUAN_HE_USER.set(accessor, new Set())
        QUAN_HE_USER.get(accessor)!.add(truong)
        TEN_QUAN_HE.add(truong)
    }
}

function soatXepLoai() {
    const truong = docModel('User')
    const vo = truong.filter(([, k]) => KIEU_VO_HUONG.has(k)).map(([t]) => t)
    const quanHe = new Map(truong.filter(([, k]) => !KIEU_VO_HUONG.has(k)))
    const khoa = Object.keys(CHON_NHAN_VIEN_AN_TOAN)
    dung('đọc được model User trong schema-store.prisma', vo.length >= 15 && vo.includes('twoFactorSecret'), `${vo.length} cột`)

    const chuaXep = vo.filter(c => !khoa.includes(c) && !BI_MAT.has(c))
    dung('mọi cột User đã xếp loại: được ra ngoài (CHON_NHAN_VIEN_AN_TOAN) | bí mật (COT_NHAN_VIEN_BI_MAT)', chuaXep.length === 0,
        chuaXep.length ? `chưa xếp: ${chuaXep.join(', ')} — thêm vào một trong hai danh sách ở src/lib/nhanVienAnToan.ts` : '')
    const haiNoi = khoa.filter(c => BI_MAT.has(c))
    dung('danh sách trắng KHÔNG chứa cột bí mật', haiNoi.length === 0, haiNoi.join(', '))
    const ma = [...khoa.filter(k => !vo.includes(k) && !quanHe.has(k)), ...[...BI_MAT].filter(c => !vo.includes(c))]
    dung('không có tên cột ma (đã xoá / đổi tên khỏi schema)', ma.length === 0, ma.join(', '))

    const giaTri = CHON_NHAN_VIEN_AN_TOAN as Record<string, unknown>
    const khongPhaiTrue = khoa.filter(k => vo.includes(k) && giaTri[k] !== true)
    dung('cột vô hướng trong danh sách trắng đều là `true`', khongPhaiTrue.length === 0, khongPhaiTrue.join(', '))
    for (const k of khoa.filter(x => quanHe.has(x))) {
        const dich = quanHe.get(k)!
        const v = giaTri[k] as { select?: Record<string, unknown> } | true | undefined
        const sel = v && typeof v === 'object' ? v.select : undefined
        const cotDich = docModel(dich).filter(([, t]) => KIEU_VO_HUONG.has(t)).map(([t]) => t)
        const sai = sel ? Object.keys(sel).filter(c => !cotDich.includes(c) || sel[c] !== true) : ['(không có select hẹp)']
        dung(`quan hệ ${k} → ${dich}: select hẹp, chỉ cột vô hướng có thật`, sai.length === 0, sai.join(', '))
    }

    const thieu = TRUONG_APP_DUNG.filter(t => !khoa.includes(t))
    dung('danh sách trắng GIỮ đủ trường web + app Android đang đọc', thieu.length === 0,
        thieu.length ? `thiếu: ${thieu.join(', ')} — màn hình sẽ đọc ra undefined mà không báo lỗi` : '')
    dung('tìm được quan hệ tới User (transaction.creator, branch.users)',
        !!QUAN_HE_USER.get('transaction')?.has('creator') && !!QUAN_HE_USER.get('branch')?.has('users'),
        JSON.stringify([...QUAN_HE_USER].map(([a, s]) => `${a}.${[...s].join('|')}`)))
}

// ─── 3. Quét mã route ────────────────────────────────────────────────────────
const HAM_LAY = new Set(['findMany', 'findFirst', 'findUnique', 'findFirstOrThrow', 'findUniqueOrThrow', 'create', 'update',
    'upsert', 'delete', 'createManyAndReturn', 'updateManyAndReturn'])
/** Phương thức mảng trả về (một phần) chính các phần tử — dữ liệu bẩn đi tiếp. */
const GIU_PHAN_TU = new Set(['map', 'flatMap', 'filter', 'slice', 'find', 'findLast', 'concat', 'sort', 'reverse', 'flat', 'at', 'toSorted', 'toReversed'])
/** Phương thức mảng gọi callback với TỪNG PHẦN TỬ làm tham số đầu — tham số đó bẩn như phần tử. */
const DUYET_PHAN_TU = new Set(['forEach', 'map', 'flatMap', 'filter', 'find', 'findLast', 'some', 'every'])
const PHUONG_THUC_ROUTER = new Set(['get', 'post', 'put', 'patch', 'delete', 'all'])

function boBoc(n: ts.Expression): ts.Expression {
    for (;;) {
        if (ts.isAwaitExpression(n) || ts.isParenthesizedExpression(n) || ts.isAsExpression(n)
            || ts.isNonNullExpression(n) || ts.isSatisfiesExpression(n) || ts.isTypeAssertionExpression(n)) n = n.expression
        else return n
    }
}
const tenKhoa = (n: ts.PropertyName | ts.BindingName | undefined) => n && (ts.isIdentifier(n) || ts.isStringLiteral(n)) ? n.text : null

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

/** `const TEN = { … }` của file đang quét — để giải `select: TEN` và `{ ...TEN }`. */
let HANG_TEP = new Map<string, ts.Expression>()

/**
 * `select` có (hoặc có thể có) cột bí mật? Giải được `select: TEN` / `...TEN` khi TEN là `const TEN = {…}` cùng file;
 * CHON_NHAN_VIEN_AN_TOAN thì sạch (mục 1–2 soát riêng nội dung). Không giải được ⇒ coi là CÓ.
 */
function selectCoBiMat(sel: ts.Expression, sau = 0): boolean {
    sel = boBoc(sel)
    if (sau > 5) return true
    if (ts.isIdentifier(sel)) {
        if (sel.text === TEN_SELECT_AN_TOAN) return false
        const kb = HANG_TEP.get(sel.text)
        return kb ? selectCoBiMat(kb, sau + 1) : true
    }
    if (!ts.isObjectLiteralExpression(sel)) return true
    return sel.properties.some(p => {
        if (ts.isSpreadAssignment(p)) return selectCoBiMat(p.expression, sau + 1)
        const t = tenKhoa(p.name)
        if (!t || !BI_MAT.has(t)) return false
        return !(ts.isPropertyAssignment(p) && boBoc(p.initializer).kind === ts.SyntaxKind.FalseKeyword)   // `password: false` = không lấy
    })
}

/** Biểu thức này là một lần đọc DB trả dòng User có (hoặc có thể có) cột bí mật? */
function laNguonBan(e: ts.Expression): boolean {
    e = boBoc(e)
    const sqlThoBan = (sql: string) => /"User"/.test(sql) && /SELECT\s+(\*|\w+\.\*)/i.test(sql)
    if (ts.isTaggedTemplateExpression(e)) return /\$queryRaw/.test(e.tag.getText()) && sqlThoBan(e.template.getText())
    if (!ts.isCallExpression(e) || !ts.isPropertyAccessExpression(e.expression)) return false
    const ham = e.expression.name.text
    if (/^\$queryRaw(Unsafe)?$/.test(ham)) return sqlThoBan(e.arguments[0]?.getText() || '')
    const doiTuong = e.expression.expression
    if (!HAM_LAY.has(ham) || !ts.isPropertyAccessExpression(doiTuong)) return false
    const model = doiTuong.name.text
    const arg = thamSoDau(e)
    if (model === 'user') {
        const sel = arg && layThuocTinh(arg, 'select')
        if (sel) return selectCoBiMat(sel)
        const omit = arg && layThuocTinh(arg, 'omit')
        if (omit && ts.isObjectLiteralExpression(omit)) {
            const bo = new Set(omit.properties.map(p => tenKhoa(p.name)).filter(Boolean))
            return ![...BI_MAT].every(c => bo.has(c))
        }
        return true
    }
    const quanHe = QUAN_HE_USER.get(model)
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

/** `const { a, b, ...rest } = x` — trả tên `rest` khi nó CÒN bẩn: không bóc đủ mọi cột bí mật (lối danh sách cấm). */
function restConBan(bp: ts.ObjectBindingPattern): string | null {
    const rest = bp.elements.find(el => !!el.dotDotDotToken)
    if (!rest || !ts.isIdentifier(rest.name)) return null
    const bo = new Set(bp.elements.filter(el => !el.dotDotDotToken).map(el => tenKhoa(el.propertyName ?? el.name)))
    return [...BI_MAT].every(c => bo.has(c)) ? null : rest.name.text
}
/** Phần tử tháo ra đích danh là QUAN HỆ tới User (`const { creator } = tx`) ⇒ cả một dòng User. */
function tenQuanHeThao(bp: ts.ObjectBindingPattern): string[] {
    return bp.elements
        .filter(el => !el.dotDotDotToken && ts.isIdentifier(el.name) && TEN_QUAN_HE.has(tenKhoa(el.propertyName ?? el.name) || ''))
        .map(el => (el.name as ts.Identifier).text)
}
/** Các tên mà một mẫu tháo `{…}` để lại còn mang dữ liệu bẩn. */
const tenBanTuMauThao = (bp: ts.ObjectBindingPattern) => [restConBan(bp), ...tenQuanHeThao(bp)].filter((x): x is string => !!x)

const hamGanNhat = (n: ts.Node): ts.Node | undefined => { let p = n.parent; while (p && !ts.isFunctionLike(p)) p = p.parent; return p }

/**
 * Callback của .map trả về thứ KHÔNG mang nguyên phần tử?
 * "Mang nguyên phần tử" = chính tham số, `tham_số.creator`, `rest` tháo từ nó mà chưa bóc đủ cột bí mật, hay thứ dựng
 * từ những thứ đó (`{ ...u }`, `ganThem(u)`, biến cục bộ khai từ chúng). Đọc trường lẻ (`u.name`, `!!u.isLocked`) thì không.
 * Thân khối: xét MỌI `return` của chính callback.
 */
function laHamTaoMoi(cb?: ts.Expression): boolean {
    if (!cb) return false
    const c = boBoc(cb)
    if (!ts.isArrowFunction(c) && !ts.isFunctionExpression(c)) return false
    const tso = new Set<string>()
    const p0 = c.parameters[0]?.name
    if (p0 && ts.isIdentifier(p0)) tso.add(p0.text)
    else if (p0 && ts.isObjectBindingPattern(p0)) tenBanTuMauThao(p0).forEach(t => tso.add(t))
    const cucBo = new Map<string, ts.Expression>()

    const mang = (x: ts.Expression, sau = 0): boolean => {
        x = boBoc(x)
        if (sau > 5) return true                                                    // vòng khai báo lạ: coi là bẩn
        if (ts.isIdentifier(x)) return tso.has(x.text) || (cucBo.has(x.text) && mang(cucBo.get(x.text)!, sau + 1))
        if (ts.isPropertyAccessExpression(x)) return TEN_QUAN_HE.has(x.name.text) && mang(x.expression, sau)
        if (ts.isElementAccessExpression(x)) return mang(x.expression, sau)
        if (ts.isCallExpression(x)) {
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
        if (ts.isVariableDeclaration(n) && n.initializer) {
            if (ts.isIdentifier(n.name)) cucBo.set(n.name.text, n.initializer)
            else if (ts.isObjectBindingPattern(n.name)) for (const t of tenBanTuMauThao(n.name)) cucBo.set(t, n.initializer)
        }
        if (ts.isReturnStatement(n) && n.expression) traVe.push(n.expression)
    })
    return traVe.length > 0 && traVe.every(r => !mang(r))
}

/** Giá trị của biểu thức có mang dòng User thô (hoặc mảng / đối tượng chứa nó)? */
function laGiaTriBan(e: ts.Expression, ban: Set<string>): boolean {
    e = boBoc(e)
    if (laNguonBan(e)) return true
    if (ts.isIdentifier(e)) return ban.has(e.text)
    if (ts.isCallExpression(e)) {
        if (ts.isPropertyAccessExpression(e.expression) && GIU_PHAN_TU.has(e.expression.name.text)
            && laGiaTriBan(e.expression.expression, ban)) {
            const ham = e.expression.name.text
            return !((ham === 'map' || ham === 'flatMap') && laHamTaoMoi(e.arguments[0]))
        }
        return false
    }
    if (ts.isPropertyAccessExpression(e)) return TEN_QUAN_HE.has(e.name.text) && laGiaTriBan(e.expression, ban)
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

/** Một lần nhắc tới biến bẩn trong res.json(...) có làm cả dòng User ra ngoài không? */
function roRaNgoai(x: ts.Identifier): boolean {
    let n: ts.Node = x
    for (;;) {
        const p: ts.Node = n.parent
        if (ts.isParenthesizedExpression(p) || ts.isAsExpression(p) || ts.isNonNullExpression(p) || ts.isSatisfiesExpression(p)) { n = p; continue }
        if (ts.isPropertyAccessExpression(p) && p.expression === n) {
            const ten = p.name.text
            if (TEN_QUAN_HE.has(ten)) { n = p; continue }                           // tx.creator → vẫn là dòng User
            if (ts.isCallExpression(p.parent) && p.parent.expression === p) {
                if (!GIU_PHAN_TU.has(ten)) return false                              // .some/.includes/.join… → giá trị khác
                if ((ten === 'map' || ten === 'flatMap') && laHamTaoMoi(p.parent.arguments[0])) return false
                n = p.parent; continue
            }
            return false                                                             // đọc trường lẻ: u.name, ds.length
        }
        if (ts.isElementAccessExpression(p) && p.expression === n) { n = p; continue }
        if (ts.isCallExpression(p) && (p.arguments as readonly ts.Node[]).includes(n)) return true   // safeUser(u), JSON.stringify(u)…
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
                else if (ts.isObjectBindingPattern(n.name)) {
                    // const { password, ...rest } = user  ⇒ rest bẩn trừ khi bóc đủ mọi cột bí mật
                    if (laGiaTriBan(n.initializer, ban)) tenBanTuMauThao(n.name).forEach(them)
                } else if (ts.isArrayBindingPattern(n.name)) {
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
            // for (const u of ds) — u bẩn như phần tử
            if (ts.isForOfStatement(n) && ts.isVariableDeclarationList(n.initializer) && laGiaTriBan(n.expression, ban)) {
                const d = n.initializer.declarations[0]?.name
                if (d && ts.isIdentifier(d)) them(d.text)
                else if (d && ts.isObjectBindingPattern(d)) tenBanTuMauThao(d).forEach(them)
            }
            if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
                const ham = n.expression.name.text
                // ds.forEach(u => …) / ds.map(u => …) — tham số đầu bẩn như phần tử
                if (DUYET_PHAN_TU.has(ham) && laGiaTriBan(n.expression.expression, ban)) {
                    const cb = n.arguments[0] ? boBoc(n.arguments[0]) : null
                    const p0 = cb && (ts.isArrowFunction(cb) || ts.isFunctionExpression(cb)) ? cb.parameters[0]?.name : undefined
                    if (p0 && ts.isIdentifier(p0)) them(p0.text)
                    else if (p0 && ts.isObjectBindingPattern(p0)) tenBanTuMauThao(p0).forEach(them)
                }
                // gom.push({ ...u }) / gom.unshift(u) ⇒ gom bẩn
                if ((ham === 'push' || ham === 'unshift') && ts.isIdentifier(n.expression.expression) && n.arguments.some(a => laGiaTriBan(a, ban)))
                    them(n.expression.expression.text)
            }
        })
    }
    if (!ban.size) return

    const bao = (x: ts.Identifier) => phat.push({ tep, dong: sf.getLineAndCharacterOfPosition(x.getStart(sf)).line + 1, bien: x.text })
    const quetBieuThuc = (goc: ts.Node) => duyet(goc, x => {
        if (!ts.isIdentifier(x) || !ban.has(x.text)) return
        const p = x.parent
        if ((ts.isPropertyAccessExpression(p) && p.name === x) || (ts.isPropertyAssignment(p) && p.name === x)) return   // tên khoá, không phải biến
        if ((ts.isParameter(p) || ts.isBindingElement(p) || ts.isVariableDeclaration(p)) && p.name === x) return        // chỗ KHAI BÁO tên
        if (ts.isBindingElement(p) && p.propertyName === x) return
        if (roRaNgoai(x)) bao(x)
    })
    duyet(fn.body, n => {
        if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && /^(json|send)$/.test(n.expression.name.text))
            n.arguments.forEach(quetBieuThuc)
        // tool MCP: giá trị `return` của run() là thứ gửi cho client
        if (laToolMcp && ts.isReturnStatement(n) && n.expression && hamGanNhat(n) === fn) quetBieuThuc(n.expression)
    })
}

function quetMa(ma: string, tep: string): Phat[] {
    const sf = ts.createSourceFile(tep, ma, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    HANG_TEP = new Map()
    duyet(sf, n => {
        if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && ts.isObjectLiteralExpression(boBoc(n.initializer)))
            HANG_TEP.set(n.name.text, boBoc(n.initializer))
    })
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
    ['findMany không select', `router.get('/a', async (req, res) => { const ds = await prisma.user.findMany({ where: {} }); res.json({ success: true, data: ds }) })`],
    // ↓ NGUYÊN VĂN mã cũ routes/employees.ts (trước 09/11/2026) — bóc mỗi password là kiểu danh sách cấm
    ['MÃ CŨ GET /employees: map tháo { password, ...rest } + cache', `router.get('/', authMiddleware, requirePermission('employees.view'), async (req, res) => {
        const users = await prisma.user.findMany({ where, orderBy: { createdAt: 'desc' }, include: { branch: { select: { id: true, name: true, code: true, isMainBranch: true } } } })
        const _response = { success: true, data: users.map(u => { const { password, ...rest } = u; return rest }) }
        await cacheSet(cacheKey, _response, 300)
        res.json(_response) })`],
    ['MÃ CŨ GET /employees/:id: const { password, ...rest } = user', `router.get('/:id', async (req, res) => {
        const user = await prisma.user.findFirst({ where: { id: String(req.params.id) }, include: { branch: { select: { id: true } } } })
        if (!user) return res.status(404).json({ success: false, error: 'Not found' })
        if (!canAccessBranch(req, user.branchId)) return res.status(404).json({ success: false, error: 'Not found' })
        const { password, ...rest } = user
        res.json({ success: true, data: rest }) })`],
    ['MÃ CŨ PUT /employees/:id: { password: _, ...rest }', `router.put('/:id', async (req, res) => {
        const user = await prisma.user.update({ where: { id: empId }, data, include: { branch: { select: { id: true } } } })
        const { password: _, ...rest } = user
        res.json({ success: true, data: rest }) })`],
    ['MÃ CŨ toggle-status / POST: safeUser(updated)', `router.put('/:id/toggle-status', async (req, res) => {
        const updated = await prisma.user.update({ where: { id: 'x' }, data: { employeeStatus: 'inactive' } })
        res.json({ success: true, data: safeUser(updated) }) })`],
    // ↓ NGUYÊN VĂN mã cũ routes/admin.ts GET /users — rải cả dòng (có password) vào mảng gom qua forEach + push
    ['MÃ CŨ GET /admin/users: forEach(u => allUsers.push({ ...u }))', `router.get('/users', async (_req, res) => {
        const stores = await prisma.store.findMany()
        const allUsers: any[] = []
        await mapWithConcurrency(stores, async (store) => {
            try {
                const sp = getStorePrisma(store.schema)
                const users = await sp.user.findMany({ include: { branch: { select: { name: true } } } })
                users.forEach(u => allUsers.push({ ...u, storeName: store.name, branchName: (u as any).branch?.name || null }))
            } catch { }
        })
        res.json({ success: true, data: allUsers }) })`],
    ['select có twoFactorSecret rồi trả cả dòng', `router.get('/a', async (req, res) => { const u = await prisma.user.findUnique({ where: { id: 'x' }, select: { id: true, twoFactorSecret: true } }); res.json({ data: u }) })`],
    ['select rải biến cùng file có trustedDevices', `const CHON = { id: true, trustedDevices: true }
        router.get('/a', async (req, res) => { const ds = await prisma.user.findMany({ select: { ...CHON, name: true } }); res.json({ data: ds }) })`],
    ['select là biến không giải được ⇒ coi là bẩn', `router.get('/a', async (req, res) => { const u = await prisma.user.findFirst({ select: chonTuNoiKhac }); res.json({ data: u }) })`],
    ['giao dịch include creator: true', `router.get('/a', async (req, res) => { const tx = await prisma.transaction.findFirst({ include: { creator: true, items: true } }); res.json({ data: tx }) })`],
    ['đưa tx.creator ra', `router.get('/a', async (req, res) => { const tx = await prisma.transaction.findFirst({ include: { creator: true } }); res.json({ nguoiTao: tx?.creator }) })`],
    ['chi nhánh include users không select', `router.get('/a', async (req, res) => { const b = await prisma.branch.findMany({ include: { users: { where: { employeeStatus: 'active' } } } }); res.json({ data: b }) })`],
    ['for…of + push', `router.get('/a', async (req, res) => { const ds = await prisma.user.findMany(); const ra: any[] = []; for (const u of ds) ra.push({ ...u, x: 1 }); res.json({ data: ra }) })`],
    ['map tham số tháo ({ password, ...rest }) => rest', `router.get('/a', async (req, res) => { const ds = await prisma.user.findMany(); res.json({ data: ds.map(({ password, ...rest }) => rest) }) })`],
    ['SELECT * FROM "User"', `router.get('/a', async (req, res) => { const rows: any[] = await prisma.$queryRawUnsafe(\`SELECT * FROM "User" WHERE role = 'admin'\`); res.json({ data: rows }) })`],
    ['tool MCP trả nguyên dòng User', `const TOOLS = [{ name: 'x', run: async (a, { prisma }) => { const u = await prisma.user.findFirst({ where: { id: a.id } }); return u } }]`],
    ['res.send(u)', `router.get('/a', async (req, res) => { const u = await prisma.user.findFirst({ where: { id: 'x' } }); res.send(u) })`],
    ['delete trả dòng vừa xoá', `router.delete('/a', async (req, res) => { const xoa = await prisma.user.delete({ where: { id: 'x' } }); res.json({ data: xoa }) })`],
    ['JSON.stringify(u) cũng là đưa cả dòng', `router.get('/a', async (req, res) => { const u = await prisma.user.findFirst(); res.json({ raw: JSON.stringify(u) }) })`],
]
const PHAI_IM: Array<[string, string]> = [
    ['MÃ MỚI GET /employees: select CHON_NHAN_VIEN_AN_TOAN + cache', `router.get('/', async (req, res) => {
        const users = await prisma.user.findMany({ where, orderBy: { createdAt: 'desc' }, select: CHON_NHAN_VIEN_AN_TOAN })
        const _response = { success: true, data: users }
        await cacheSet(cacheKey, _response, 300)
        res.json(_response) })`],
    ['MÃ MỚI GET /employees/:id: select an toàn + đọc user.branchId', `router.get('/:id', async (req, res) => {
        const user = await prisma.user.findFirst({ where: { id: 'x' }, select: CHON_NHAN_VIEN_AN_TOAN })
        if (!canAccessBranch(req, user.branchId)) return res.status(404).json({ success: false })
        res.json({ success: true, data: user }) })`],
    ['MÃ MỚI create / update: select an toàn', `router.post('/', async (req, res) => {
        const user = await prisma.user.create({ data: { name: 'a' }, select: CHON_NHAN_VIEN_AN_TOAN })
        const updated = await prisma.user.update({ where: { id: 'x' }, data: {}, select: CHON_NHAN_VIEN_AN_TOAN })
        res.status(201).json({ success: true, data: user, sau: updated }) })`],
    ['MÃ MỚI GET /admin/users: forEach + push, select an toàn', `router.get('/users', async (_req, res) => {
        const allUsers: any[] = []
        await mapWithConcurrency(stores, async (store) => {
            const users = await sp.user.findMany({ select: CHON_NHAN_VIEN_AN_TOAN })
            users.forEach(u => allUsers.push({ ...u, storeName: store.name, branchName: (u as any).branch?.name || null }))
        })
        res.json({ success: true, data: allUsers }) })`],
    ['select biến cùng file (kiểu USER_SELECT của auth.ts) + rải ...USER_SELECT', `const USER_SELECT = { id: true, email: true, name: true, permissions: true, twoFactorEnabled: true }
        router.get('/me', async (req, res) => { const user = await sp.user.findUnique({ where: { id: 'x' }, select: USER_SELECT }); res.json({ data: { ...user, permissions: [] } }) })
        router.get('/users', async (req, res) => { const users = await sp.user.findMany({ select: { ...USER_SELECT, salary: true, notes: true } }); res.json({ data: users }) })`],
    ['đọc trường lẻ + cờ !!', `router.get('/a', async (req, res) => { const u = await prisma.user.findUnique({ where: { id: 'x' } }); res.json({ data: { ten: u.name, coHaiLop: !!u.twoFactorEnabled, vaiTro: u?.role } }) })`],
    ['so mật khẩu xong chỉ trả thông báo', `router.post('/a', async (req, res) => {
        const user = await prisma.user.findUnique({ where: { id: 'x' } })
        if (!user) { res.status(404).json({ success: false, error: 'User not found' }); return }
        const valid = await bcrypt.compare(p, user.password)
        if (!valid) return res.status(400).json({ error: 'Mật khẩu cũ không đúng' })
        res.json({ success: true, message: 'Đổi mật khẩu thành công' }) })`],
    ['bóc ĐỦ mọi cột bí mật rồi trả phần còn lại', `router.get('/a', async (req, res) => { const u = await prisma.user.findFirst(); const { password, twoFactorSecret, trustedDevices, ...sach } = u; res.json({ data: sach }) })`],
    ['select có twoFactorSecret chỉ để xác minh (kiểu verify-2fa)', `router.post('/v', async (req, res) => {
        const user = await prisma.user.findUnique({ where: { id: 'x' }, select: { twoFactorSecret: true, trustedDevices: true } })
        const r = await otplib.verify({ secret: user.twoFactorSecret, token: ma })
        const ds = JSON.parse(user.trustedDevices || '[]')
        if (!r.valid) return res.status(401).json({ error: 'sai', conLai: ds.length })
        res.json({ success: true, data: { token: 't' } }) })`],
    ['include user select hẹp (kiểu apiKeys.ts)', `router.get('/a', async (req, res) => { const keys = await prisma.apiKey.findMany({ include: { user: { select: { id: true, name: true, email: true } } } }); res.json({ data: keys }) })`],
    ['API key include user: true chỉ đọc id/email (kiểu POST /auth/token)', `router.post('/token', async (req, res) => {
        const apiKey = await sp.apiKey.findFirst({ where: { keyId: 'k' }, include: { user: true } })
        if ((apiKey.user as any).isLocked) return res.status(403).json({ error: 'khoá' })
        const payload = { userId: apiKey.user.id, email: apiKey.user.email, role: apiKey.user.role }
        res.json({ success: true, data: { token: ky(payload) } }) })`],
    ['map dựng đối tượng mới (kiểu bảng lương tax.ts)', `router.get('/a', async (req, res) => {
        const employees = await p.user.findMany({ where: { role: { not: 'customer' } } })
        const rows = employees.filter((e: any) => (e.salary || 0) > 0).map((emp: any, i: number) => ({ stt: i + 1, maNV: emp.id.slice(-6).toUpperCase(), tenNV: emp.name || emp.username || '', chucVu: emp.role || '' }))
        res.json({ success: true, data: { rows, soNV: rows.length } }) })`],
    ['đếm / some / phần tử đầu .name', `router.get('/a', async (req, res) => { const ds = await prisma.user.findMany(); res.json({ n: ds.length, coKhoa: ds.some(u => u.isLocked), dau: ds[0]?.name }) })`],
    ['đọc trường qua quan hệ tx.creator.name', `router.get('/a', async (req, res) => { const tx = await prisma.transaction.findFirst({ include: { creator: true } }); res.json({ nguoiTao: tx?.creator?.name, ma: tx.code }) })`],
    ['_count users không phải quan hệ lấy dòng', `router.get('/a', async (req, res) => { const b = await prisma.branch.findMany({ include: { _count: { select: { users: true } } } }); res.json({ data: b }) })`],
    ['tên KHOÁ trùng tên biến bẩn', `router.get('/a', async (req, res) => { const user = await prisma.user.findFirst(); const phieu: any = {}; res.json({ user: phieu.user, ten: user?.name }) })`],
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
    dung(`quét ${cacTep.length} file route: không đường nào đưa dòng User thô ra res.json / res.send / tool MCP`, phat.length === 0,
        phat.length ? '\n    ' + phat.map(x => `${x.tep}:${x.dong} — '${x.bien}' mang dòng User có cột bí mật (dùng select: CHON_NHAN_VIEN_AN_TOAN)`).join('\n    ') : '')
    return phat
}

// ─── 4. Route nhân viên dùng đúng danh sách trắng ────────────────────────────
function soatRouteNhanVien() {
    const docKhoi = (tep: string, dau: string) => {
        const ma = fs.readFileSync(path.join(GOC, tep), 'utf8').replace(/\r\n/g, '\n')
        // Tìm ở ĐẦU DÒNG — dòng chú thích phía trên route cũng có thể chứa chuỗi router.get(...)
        const i = ma.search(new RegExp('^' + dau.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'), 'm'))
        return i >= 0 ? ma.slice(i, ma.indexOf('\n})', i)) : ''
    }
    const CAN: Array<[string, string]> = [
        ['src/routes/employees.ts', "router.get('/',"],
        ['src/routes/employees.ts', "router.get('/:id',"],
        ['src/routes/employees.ts', "router.post('/',"],
        ['src/routes/employees.ts', "router.put('/:id',"],
        ['src/routes/employees.ts', "router.put('/:id/toggle-status',"],
        ['src/routes/admin.ts', "router.get('/users',"],
    ]
    for (const [tep, dau] of CAN) {
        const khoi = docKhoi(tep, dau)
        const ok = /select:\s*CHON_NHAN_VIEN_AN_TOAN\b/.test(khoi)
        dung(`${tep} ${dau.slice(7)} … trả bằng select: CHON_NHAN_VIEN_AN_TOAN`, ok,
            ok ? '' : khoi ? 'không thấy select danh sách trắng trong handler' : 'không tìm thấy route')
    }
}

function main() {
    const iTep = process.argv.indexOf('--tep')
    if (iTep > 0) {
        // Chế độ đo: quét đúng các file chỉ định, in từng chỗ — dùng để đo bộ quét trên mã CŨ.
        const phat = soatMaThat(process.argv.slice(iTep + 1).map(t => path.resolve(t)))
        console.log(`\n${phat.length} chỗ lộ`)
        process.exit(phat.length ? 1 : 0)
    }
    console.log('── 1–2. Xếp loại cột User + danh sách trắng')
    soatXepLoai()
    console.log('\n── 3. Bộ quét tự kiểm')
    soatBoQuet()
    console.log('\n── 3b. Quét src/routes')
    soatMaThat(tepRoute(path.join(GOC, 'src/routes')))
    console.log('\n── 4. Route nhân viên')
    soatRouteNhanVien()

    console.log(loi ? `\n✗ ${loi} ca SAI` : '\n✓ Tất cả ca đều đúng')
    process.exit(loi ? 1 : 0)
}
main()
