/**
 * Bộ soát TẮT / BẬT 2FA — npx tsx scripts/check-tat-2fa.ts
 *                          npx tsx scripts/check-tat-2fa.ts --tep <file.ts>…  (chỉ quét mã các file chỉ định)
 *
 * Vì sao (09/11/2026): `PUT /api/auth/toggle-2fa` — công tắc "Xác thực 2 lớp (2FA)" ở Cài đặt → Bảo mật —
 * chỉ lật cờ twoFactorEnabled:
 *   - tắt rồi bật lại vẫn giữ NGUYÊN hạt TOTP cũ (có thể đã lộ qua GET /api/employees trước b0e24cf) cùng
 *     thiết bị tin cậy (trustedDevices[].id gửi kèm POST /auth/login là bỏ qua bước TOTP);
 *   - ai cầm phiên đăng nhập (hay khoá API write/admin) cũng tắt được 2FA, không cần mật khẩu;
 *   - bật khi chưa có hạt ⇒ cờ bật mà cổng TOTP ở /login bỏ qua (cổng đó đòi twoFactorSecret).
 * Lời khuyên "đặt lại 2FA" cho người dùng chỉ an toàn khi mọi đường tắt đều xoá hạt. Nay tắt đi qua tat2FA
 * (đòi mật khẩu, xoá hạt + thiết bị tin cậy), dùng chung cho toggle-2fa và DELETE /disable-2fa; bật chỉ qua
 * setup-2fa (hạt MỚI) + confirm-2fa (mã TOTP khớp). Bộ soát canh hai thứ:
 *
 *   1. Chạy THẬT authMiddleware + handler của toggle-2fa / disable-2fa / setup-2fa / confirm-2fa: JWT ký bằng
 *      khoá thử (không claim schema ⇒ giữ storePrisma giả), bảng User trong bộ nhớ trả đúng theo `select`,
 *      truy vấn ngoài user.findUnique / user.update là lỗi. Không DB, không mạng.
 *      setup-2fa phải trả `qrDataUrl` = ảnh PNG data: URL vẽ tại máy chủ, đúng là mã QR của `otpauthUrl` (lấy mẫu
 *      từng ô của ảnh, so với QR dựng lại từ otpauthUrl). Trước 09/11/2026 web lấy ảnh QR từ một dịch vụ vẽ QR công
 *      khai (`…/create-qr-code/?data=<otpauthUrl>`) ⇒ hạt MỚI đi sang bên thứ ba mỗi lần thiết lập / đặt lại 2FA.
 *   2. Quét mã src/: mọi `*.user.update / updateMany / upsert / create / createMany` ghi twoFactorEnabled:
 *        - `false` (khi sửa) PHẢI kèm `twoFactorSecret: null` + `trustedDevices: '[]'` cùng đối tượng;
 *        - `true` CHỈ trong handler '/confirm-2fa' (sau khi mã TOTP khớp hạt);
 *        - giá trị khác (biến, `!x`, viết tắt `{ twoFactorEnabled }`) ⇒ đỏ — chính là kiểu của công tắc cũ.
 *      Ghi twoFactorSecret khác null CHỈ trong handler '/setup-2fa'. Gán `x.twoFactorEnabled = …` /
 *      `x.twoFactorSecret = …` hay SQL `UPDATE "User" SET "twoFactor…"` ⇒ đỏ.
 *      GIỚI HẠN: không lần được `data` dựng ngoài lời gọi bằng spread (`data: { ...req.body }`) — mấy chỗ ghi User
 *      hiện có đều liệt kê trường thủ công. Bộ quét tự thử "phải kêu / phải im" trước khi quét mã thật, và đòi
 *      thấy đủ 3 chỗ ghi hợp lệ đang có (tắt / setup / confirm) — quét mà không thấy gì là xanh rỗng.
 */
import fs from 'fs'
import path from 'path'
import { createRequire } from 'module'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import ts from 'typescript'

let soCa = 0
let loi = 0
const dung = (ten: string, ok: boolean, chiTiet?: unknown) => {
    soCa++
    if (!ok) loi++
    console.log(`${ok ? '✓' : '✗'} ${ten}${!ok && chiTiet !== undefined ? ' — ' + JSON.stringify(chiTiet) : ''}`)
}

// ─── 2. Bộ quét mã ───────────────────────────────────────────────────────────
type Phat = { tep: string; dong: number; loi: string }
type ChoGhi = { tep: string; dong: number; loai: 'tat' | 'bat' | 'hat' }

const PHUONG_THUC_GHI = new Set(['update', 'updateMany', 'upsert', 'create', 'createMany'])

function duyet(n: ts.Node, f: (x: ts.Node) => void) { f(n); n.forEachChild(c => duyet(c, f)) }

function tenThuocTinh(p: ts.ObjectLiteralElementLike): string | null {
    if (!p.name) return null
    if (ts.isIdentifier(p.name) || ts.isStringLiteralLike(p.name)) return p.name.text
    return null
}

/** Đường của handler bao quanh: `router.<method>('<đường>', …)` gần nhất, hoặc null. */
function duongCuaNut(n: ts.Node): string | null {
    for (let p: ts.Node | undefined = n.parent; p; p = p.parent) {
        if (ts.isCallExpression(p) && ts.isPropertyAccessExpression(p.expression)
            && /^(get|post|put|delete|patch)$/.test(p.expression.name.text)
            && p.arguments[0] && ts.isStringLiteralLike(p.arguments[0])) return p.arguments[0].text
    }
    return null
}

function quetMa(ma: string, tep: string): { phat: Phat[]; cho: ChoGhi[] } {
    const sf = ts.createSourceFile(tep, ma, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    const phat: Phat[] = []
    const cho: ChoGhi[] = []
    const dong = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1
    const keu = (n: ts.Node, l: string) => phat.push({ tep, dong: dong(n), loi: l })

    /** Soát một đối tượng dữ liệu ghi vào User. laTao: create (mặc định cờ tắt, không cần xoá gì). */
    const soatDuLieu = (obj: ts.ObjectLiteralExpression, laTao: boolean) => {
        const thuocTinh = new Map<string, ts.ObjectLiteralElementLike>()
        for (const p of obj.properties) { const t = tenThuocTinh(p); if (t) thuocTinh.set(t, p) }
        const giaTri = (t: string): ts.Expression | null | undefined => {
            const p = thuocTinh.get(t)
            if (!p) return undefined
            return ts.isPropertyAssignment(p) ? p.initializer : null   // null = viết tắt / phương thức
        }
        const duong = duongCuaNut(obj)

        const bat = giaTri('twoFactorEnabled')
        if (bat !== undefined) {
            if (bat && bat.kind === ts.SyntaxKind.TrueKeyword) {
                if (!laTao && duong === '/confirm-2fa') cho.push({ tep, dong: dong(obj), loai: 'bat' })
                else keu(obj, `bật twoFactorEnabled ngoài handler '/confirm-2fa'${duong ? ` (đang ở '${duong}')` : ''} — bật 2FA chỉ được qua setup-2fa + confirm-2fa`)
            } else if (bat && bat.kind === ts.SyntaxKind.FalseKeyword) {
                if (!laTao) {
                    const hat = giaTri('twoFactorSecret')
                    const tb = giaTri('trustedDevices')
                    const xoaHat = !!hat && hat.kind === ts.SyntaxKind.NullKeyword
                    const xoaTb = !!tb && ts.isStringLiteralLike(tb) && tb.text === '[]'
                    if (xoaHat && xoaTb) cho.push({ tep, dong: dong(obj), loai: 'tat' })
                    else keu(obj, `tắt twoFactorEnabled mà không xoá ${[!xoaHat && "twoFactorSecret: null", !xoaTb && "trustedDevices: '[]'"].filter(Boolean).join(' + ')} — dùng tat2FA (auth.ts)`)
                }
            } else {
                keu(obj, 'ghi twoFactorEnabled bằng giá trị không phải hằng true/false — kiểu "lật cờ" của công tắc toggle-2fa cũ')
            }
        }

        const hat = giaTri('twoFactorSecret')
        if (hat !== undefined && !(hat && hat.kind === ts.SyntaxKind.NullKeyword)) {
            if (!laTao && duong === '/setup-2fa') cho.push({ tep, dong: dong(obj), loai: 'hat' })
            else keu(obj, `ghi twoFactorSecret ngoài handler '/setup-2fa'${duong ? ` (đang ở '${duong}')` : ''}`)
        }
    }

    duyet(sf, n => {
        // a) *.user.<ghi>({ … })
        if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)
            && PHUONG_THUC_GHI.has(n.expression.name.text)
            && ts.isPropertyAccessExpression(n.expression.expression) && n.expression.expression.name.text === 'user') {
            const pt = n.expression.name.text
            const arg = n.arguments[0]
            if (!arg || !ts.isObjectLiteralExpression(arg)) return
            for (const p of arg.properties) {
                const t = tenThuocTinh(p)
                if (!t || !ts.isPropertyAssignment(p)) continue
                const laTao = t === 'create' || ((pt === 'create' || pt === 'createMany') && t === 'data')
                if (t !== 'data' && t !== 'update' && t !== 'create') continue
                if (pt !== 'upsert' && t !== 'data') continue
                const v = p.initializer
                if (ts.isObjectLiteralExpression(v)) soatDuLieu(v, laTao)
                else if (ts.isArrayLiteralExpression(v)) v.elements.forEach(e => ts.isObjectLiteralExpression(e) && soatDuLieu(e, true))
            }
            return
        }
        // b) x.twoFactorEnabled = … / x.twoFactorSecret = …
        if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken
            && ts.isPropertyAccessExpression(n.left) && /^twoFactor(Enabled|Secret)$/.test(n.left.name.text)) {
            keu(n, `gán thẳng .${n.left.name.text} — đối tượng dựng ngoài lời gọi prisma thì bộ soát không lần được; ghi trong data của user.update`)
            return
        }
        // c) SQL tay
        if (ts.isStringLiteralLike(n) || ts.isTemplateExpression(n)) {
            const chu = n.getText(sf)
            if (/UPDATE\s+[^;]*"User"[^;]*SET[^;]*"twoFactor(Enabled|Secret)"/i.test(chu)) keu(n, 'SQL tay sửa cột 2FA của "User" — đi qua tat2FA / setup-2fa / confirm-2fa')
        }
    })
    return { phat, cho }
}

function tuThuBoQuet() {
    const boc = (than: string) => `import { Router } from 'express'\nconst router = Router()\n${than}\n`
    const PHAI_KEU: Array<[string, string]> = [
        ['công tắc cũ: lật cờ bằng biến', boc(`router.put('/toggle-2fa', async (req: any, res: any) => {
            const user = await p.user.findUnique({ where: { id: 'u' }, select: { twoFactorEnabled: true } })
            const newVal = !user.twoFactorEnabled
            await p.user.update({ where: { id: 'u' }, data: { twoFactorEnabled: newVal } })
        })`)],
        ['tắt mà không xoá hạt', boc(`router.put('/x', async () => { await sp.user.update({ where: { id: 'u' }, data: { twoFactorEnabled: false, trustedDevices: '[]' } }) })`)],
        ['tắt mà không xoá thiết bị tin cậy', boc(`router.put('/x', async () => { await sp.user.update({ where: { id: 'u' }, data: { twoFactorEnabled: false, twoFactorSecret: null } }) })`)],
        ['bật ngoài confirm-2fa', boc(`router.put('/toggle-2fa', async () => { await sp.user.update({ where: { id: 'u' }, data: { twoFactorEnabled: true } }) })`)],
        ['viết tắt { twoFactorEnabled }', boc(`router.put('/x', async (req: any) => { const { twoFactorEnabled } = req.body; await sp.user.updateMany({ where: {}, data: { twoFactorEnabled } }) })`)],
        ['upsert lật cờ', boc(`router.put('/x', async () => { await sp.user.upsert({ where: { id: 'u' }, update: { twoFactorEnabled: !u.twoFactorEnabled }, create: { email: 'a' } }) })`)],
        ['tạo người dùng đã bật 2FA', boc(`router.post('/register', async () => { await sp.user.create({ data: { email: 'a', twoFactorEnabled: true } }) })`)],
        ['ghi hạt ngoài setup-2fa', boc(`router.post('/reset', async () => { await sp.user.update({ where: { id: 'u' }, data: { twoFactorSecret: s } }) })`)],
        ['gán thẳng data.twoFactorEnabled', boc(`router.put('/:id', async (req: any) => { const data: any = {}; data.twoFactorEnabled = req.body.on; await sp.user.update({ where: { id: 'u' }, data }) })`)],
        ['SQL tay', boc(`router.post('/x', async () => { await sp.$executeRawUnsafe(\`UPDATE "User" SET "twoFactorEnabled" = false WHERE id = $1\`, 'u') })`)],
    ]
    const PHAI_IM: Array<[string, string]> = [
        ['tat2FA: tắt kèm xoá hạt + thiết bị', `async function tat2FA(sp: any) { await sp.user.update({ where: { id: 'u' }, data: { twoFactorEnabled: false, twoFactorSecret: null, trustedDevices: '[]' } }) }`],
        ['confirm-2fa bật cờ', boc(`router.post('/confirm-2fa', async () => { await sp.user.update({ where: { id: 'u' }, data: { twoFactorEnabled: true } }) })`)],
        ['setup-2fa ghi hạt mới', boc(`router.post('/setup-2fa', async () => { const secret = 'x'; await sp.user.update({ where: { id: 'u' }, data: { twoFactorSecret: secret } }) })`)],
        ['ghi thiết bị tin cậy (đăng nhập / verify-2fa)', boc(`router.post('/login', async () => { await sp.user.update({ where: { id: 'u' }, data: { trustedDevices: JSON.stringify([]) } }) })`)],
        ['trả cờ trong res.json (không phải ghi DB)', boc(`router.get('/me', async (_q: any, res: any) => { res.json({ success: true, data: { user: { twoFactorEnabled: u.twoFactorEnabled } } }) })`)],
        ['tạo người dùng cờ tắt', boc(`router.post('/register', async () => { await sp.user.create({ data: { email: 'a', twoFactorEnabled: false } }) })`)],
        ['migrate thêm cột', `const q = 'ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false'`],
        ['xoá hạt dở dang (null) ở chỗ khác', boc(`router.post('/huy-setup', async () => { await sp.user.update({ where: { id: 'u' }, data: { twoFactorSecret: null } }) })`)],
    ]
    let hong = 0
    for (const [ten, ma] of PHAI_KEU) { const { phat } = quetMa(ma, 'tu-thu.ts'); if (phat.length !== 1) { hong++; console.log(`  ✗ phải kêu: ${ten} — ${phat.length} phát`, phat) } }
    for (const [ten, ma] of PHAI_IM) { const { phat } = quetMa(ma, 'tu-thu.ts'); if (phat.length) { hong++; console.log(`  ✗ phải im: ${ten}`, phat) } }
    dung(`bộ quét tự thử: ${PHAI_KEU.length} đoạn phải kêu, ${PHAI_IM.length} đoạn phải im`, hong === 0, { hong })
}

function cacTepNguon(dir: string, gom: string[] = []): string[] {
    for (const m of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, m.name)
        if (m.isDirectory()) { if (m.name !== 'generated' && m.name !== 'node_modules') cacTepNguon(p, gom) }
        else if (/\.ts$/.test(m.name) && !/\.d\.ts$/.test(m.name)) gom.push(p)
    }
    return gom
}

function quetMaThat() {
    const GOC = path.resolve(__dirname, '..')
    const viTri = process.argv.indexOf('--tep')
    const tep = viTri >= 0 ? process.argv.slice(viTri + 1) : cacTepNguon(path.join(GOC, 'src'))
    const phat: Phat[] = []
    const cho: ChoGhi[] = []
    for (const t of tep) {
        const kq = quetMa(fs.readFileSync(t, 'utf8'), path.relative(GOC, t))
        phat.push(...kq.phat); cho.push(...kq.cho)
    }
    for (const p of phat) console.log(`  ✗ ${p.tep}:${p.dong} — ${p.loi}`)
    dung(`quét ${tep.length} tệp src/: không chỗ nào ghi cờ / hạt 2FA sai luật`, phat.length === 0, phat.length)
    if (viTri < 0) {
        const dem = (l: ChoGhi['loai']) => cho.filter(c => c.loai === l).length
        dung(`bộ quét thấy đủ chỗ ghi hợp lệ: tắt (tat2FA) ${dem('tat')}, bật (confirm-2fa) ${dem('bat')}, hạt (setup-2fa) ${dem('hat')}`,
            dem('tat') === 1 && dem('bat') === 1 && dem('hat') === 1, cho)
    }
}

// ─── 1. Chạy thật các tuyến ──────────────────────────────────────────────────
type HangUser = { id: string; email: string; password: string; twoFactorEnabled: boolean; twoFactorSecret: string | null; trustedDevices: string }

function taoKho(hang: HangUser[]) {
    const bang = new Map(hang.map(h => [h.id, { ...h }]))
    const goi: string[] = []
    const chon = (r: any, select?: Record<string, boolean>) =>
        select ? Object.fromEntries(Object.entries(select).filter(([, v]) => v).map(([k]) => [k, r[k]])) : { ...r }
    const lam = {
        findUnique: async ({ where, select }: any) => { goi.push('user.findUnique'); const r = bang.get(where?.id); return r ? chon(r, select) : null },
        update: async ({ where, data, select }: any) => {
            goi.push('user.update')
            const r = bang.get(where?.id)
            if (!r) throw Object.assign(new Error('Record to update not found'), { code: 'P2025' })
            Object.assign(r, data)
            return chon(r, select)
        },
    } as Record<string, Function>
    const chan = (ten: string) => (o: any, k: string | symbol) => {
        if (typeof k === 'symbol' || k === 'then') return undefined
        if (k in o) return o[k]
        goi.push(`LẠ:${ten}${String(k)}`)
        throw new Error(`truy vấn lạ: ${ten}${String(k)}`)
    }
    const prisma = new Proxy({ user: new Proxy(lam, { get: chan('user.') }) }, { get: chan('') })
    return { prisma, bang, goi, hang: (id = 'u1') => bang.get(id)! }
}

/** Ảnh QR (PNG data: URL) có đúng là mã QR của `chuoi` không: lấy mẫu TÂM từng ô trong khung bao các điểm tối,
 *  so với ma trận QR dựng lại từ `chuoi`. Thử đủ 4 mức sửa lỗi (đổi thông số vẽ thì không kêu oan).
 *  Trả mức sửa lỗi khớp, hoặc null. pngjs là phụ thuộc của qrcode ⇒ nạp từ chỗ của qrcode. */
async function qrCuaChuoi(dataUrl: string, chuoi: string): Promise<string | null> {
    const TIEN_TO = 'data:image/png;base64,'
    if (!dataUrl.startsWith(TIEN_TO)) return null
    const QRCode: any = (await import('qrcode')).default
    const { PNG } = createRequire(require.resolve('qrcode/package.json'))('pngjs')
    const anh = PNG.sync.read(Buffer.from(dataUrl.slice(TIEN_TO.length), 'base64'))
    const toi = (x: number, y: number) => {
        const i = (y * anh.width + x) * 4
        return anh.data[i + 3] > 127 && anh.data[i] + anh.data[i + 1] + anh.data[i + 2] < 384
    }
    let x0 = anh.width, y0 = anh.height, x1 = -1, y1 = -1
    for (let y = 0; y < anh.height; y++) for (let x = 0; x < anh.width; x++) {
        if (toi(x, y)) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y) }
    }
    if (x1 < 0) return null
    for (const muc of ['L', 'M', 'Q', 'H']) {
        const { size, data } = QRCode.create(chuoi, { errorCorrectionLevel: muc }).modules
        const oX = (x1 - x0 + 1) / size, oY = (y1 - y0 + 1) / size
        let khop = true
        for (let r = 0; r < size && khop; r++) for (let c = 0; c < size && khop; c++) {
            khop = toi(Math.floor(x0 + (c + 0.5) * oX), Math.floor(y0 + (r + 0.5) * oY)) === !!data[r * size + c]
        }
        if (khop) return muc
    }
    return null
}

const cacBuoc = (router: any, method: string, duong: string): Function[] =>
    router.stack.find((l: any) => l.route?.path === duong && l.route.methods[method])?.route.stack.map((l: any) => l.handle) || []
const resGia = () => ({ ma: 200, than: null as any, status(c: number) { this.ma = c; return this }, json(b: any) { this.than = b; return this } })

async function chayTuyen() {
    process.env.JWT_SECRET = 'khoa-thu-check-tat-2fa'
    process.env.DATABASE_URL = 'postgresql://khong-dung-db@127.0.0.1:9/khong'   // phòng hờ: bộ soát không bao giờ chạm CSDL thật
    const { authMiddleware } = await import('../src/middleware/auth')
    const { default: authRouter } = await import('../src/routes/auth')
    const otplib: any = await import('otplib')

    const buoc = {
        toggle: cacBuoc(authRouter, 'put', '/toggle-2fa'),
        disable: cacBuoc(authRouter, 'delete', '/disable-2fa'),
        setup: cacBuoc(authRouter, 'post', '/setup-2fa'),
        confirm: cacBuoc(authRouter, 'post', '/confirm-2fa'),
    }
    dung('tìm được 4 tuyến 2FA trong router, mỗi tuyến authMiddleware + handler',
        Object.values(buoc).every(b => b.length === 2 && b[0] === authMiddleware), Object.fromEntries(Object.entries(buoc).map(([k, b]) => [k, b.length])))

    const MAT_KHAU = 'MatKhau@123'
    const HASH = await bcrypt.hash(MAT_KHAU, 4)
    const HAT_CU = otplib.generateSecret()
    const TB_CU = JSON.stringify([{ id: 'dev_lo1', name: 'Chrome' }, { id: 'dev_lo2', name: 'Android' }])
    const nguoiDung = (ghiDe: Partial<HangUser> = {}): HangUser =>
        ({ id: 'u1', email: 'chu@shop.vn', password: HASH, twoFactorEnabled: true, twoFactorSecret: HAT_CU, trustedDevices: TB_CU, ...ghiDe })

    /** Gọi một tuyến qua ĐỦ các bước (authMiddleware thật + handler). claim thêm vào JWT, vd apiKeyScopes. */
    const goi = async (k: keyof typeof buoc, kho: ReturnType<typeof taoKho>, body?: any, claim: Record<string, unknown> = {}) => {
        const method = { toggle: 'PUT', disable: 'DELETE', setup: 'POST', confirm: 'POST' }[k]
        const tok = jwt.sign({ userId: 'u1', email: 'chu@shop.vn', role: 'admin', ...claim }, process.env.JWT_SECRET!, { algorithm: 'HS256', expiresIn: '5m' })
        const req: any = { headers: { authorization: `Bearer ${tok}` }, method, originalUrl: `/api/auth/${k}-2fa`, body, storePrisma: kho.prisma }
        const res = resGia()
        for (const b of buoc[k]) { let tiep = false; await b(req, res, () => { tiep = true }); if (!tiep) break }
        return { ma: res.ma, than: res.than }
    }
    /** In khi hỏng: chỉ tóm tắt, không in hash mật khẩu / hạt (dù là giá trị thử). */
    const tomTat = (h: HangUser) => ({
        bat: h.twoFactorEnabled,
        hat: h.twoFactorSecret === null ? null : h.twoFactorSecret === HAT_CU ? 'CŨ' : 'khác',
        thietBiTinCay: (JSON.parse(h.trustedDevices || '[]') as unknown[]).length,
    })
    const nguyenVen = (h: HangUser) => h.twoFactorEnabled === true && h.twoFactorSecret === HAT_CU && h.trustedDevices === TB_CU
    const daXoaSach = (h: HangUser) => h.twoFactorEnabled === false && h.twoFactorSecret === null && h.trustedDevices === '[]'

    // ── toggle-2fa: TẮT phải có mật khẩu
    for (const [ten, body, claim] of [
        ['không body (web bản cũ)', undefined, {}],
        ['{ enabled: false } không mật khẩu', { enabled: false }, {}],
        ['mật khẩu rỗng', { password: '' }, {}],
        ['mật khẩu không phải chuỗi (số)', { password: 123456 }, {}],
        ['token đổi từ khoá API admin, không mật khẩu', {}, { apiKeyScopes: 'admin' }],
    ] as Array<[string, any, Record<string, unknown>]>) {
        const kho = taoKho([nguoiDung()])
        const r = await goi('toggle', kho, body, claim)
        dung(`toggle-2fa tắt — ${ten} ⇒ 400 "Mật khẩu là bắt buộc", hạt + thiết bị tin cậy còn nguyên, không ghi`,
            r.ma === 400 && r.than?.error === 'Mật khẩu là bắt buộc' && nguyenVen(kho.hang()) && !kho.goi.includes('user.update'), { r, goi: kho.goi })
    }
    {
        const kho = taoKho([nguoiDung()])
        const r = await goi('toggle', kho, { password: 'Sai@1234' })
        dung('toggle-2fa tắt — sai mật khẩu ⇒ 400 "Mật khẩu không đúng", không ghi',
            r.ma === 400 && r.than?.error === 'Mật khẩu không đúng' && nguyenVen(kho.hang()) && !kho.goi.includes('user.update'), { r, goi: kho.goi })
    }
    {
        const kho = taoKho([nguoiDung()])
        const r = await goi('toggle', kho, { password: MAT_KHAU })
        dung('toggle-2fa tắt — đúng mật khẩu ⇒ 200 { twoFactorEnabled: false }, XOÁ hạt TOTP + thiết bị tin cậy',
            r.ma === 200 && r.than?.success === true && r.than?.data?.twoFactorEnabled === false && daXoaSach(kho.hang()), { r, hang: tomTat(kho.hang()) })
        dung('toggle-2fa tắt — chỉ đụng user.findUnique / user.update (không truy vấn lạ)', kho.goi.every(g => g === 'user.findUnique' || g === 'user.update'), kho.goi)

        // ngay sau đó bấm lại công tắc (muốn BẬT) ⇒ từ chối, không hồi sinh gì
        const lai = await goi('toggle', kho, undefined)
        dung('toggle-2fa bật lại ngay sau khi tắt ⇒ 400 BAT_2FA_QUA_THIET_LAP, vẫn tắt, hạt vẫn trống',
            lai.ma === 400 && lai.than?.code === 'BAT_2FA_QUA_THIET_LAP' && daXoaSach(kho.hang()), { lai, hang: tomTat(kho.hang()) })
    }
    {
        const kho = taoKho([nguoiDung()])
        const r = await goi('toggle', kho, { enabled: false, password: MAT_KHAU })
        dung('toggle-2fa { enabled: false, password } ⇒ tắt + xoá sạch như disable-2fa', r.ma === 200 && daXoaSach(kho.hang()), { r, hang: tomTat(kho.hang()) })
    }

    // ── toggle-2fa: BẬT luôn bị từ chối
    {
        // trạng thái công tắc cũ để lại: cờ tắt nhưng hạt CŨ (có thể đã lộ) còn trong DB
        const kho = taoKho([nguoiDung({ twoFactorEnabled: false })])
        const r = await goi('toggle', kho, undefined)
        dung('toggle-2fa bật khi còn hạt CŨ của công tắc cũ ⇒ 400 BAT_2FA_QUA_THIET_LAP, cờ vẫn tắt (hạt cũ không sống lại)',
            r.ma === 400 && r.than?.code === 'BAT_2FA_QUA_THIET_LAP' && kho.hang().twoFactorEnabled === false && !kho.goi.includes('user.update'), { r, goi: kho.goi })
        const r2 = await goi('toggle', kho, { enabled: true, password: MAT_KHAU })
        dung('toggle-2fa { enabled: true } kèm đúng mật khẩu vẫn KHÔNG bật', r2.ma === 400 && kho.hang().twoFactorEnabled === false, r2)
    }
    {
        const kho = taoKho([nguoiDung({ twoFactorEnabled: false, twoFactorSecret: null, trustedDevices: '[]' })])
        const r = await goi('toggle', kho, undefined)
        dung('toggle-2fa bật khi chưa có hạt ⇒ 400 (không còn ca cờ bật mà hạt null)',
            r.ma === 400 && kho.hang().twoFactorEnabled === false && kho.hang().twoFactorSecret === null, r)
        const r3 = await goi('toggle', kho, { enabled: false })
        dung('toggle-2fa { enabled: false } khi đã tắt ⇒ 200, không ghi gì', r3.ma === 200 && r3.than?.data?.twoFactorEnabled === false && !kho.goi.includes('user.update'), { r3, goi: kho.goi })
    }
    {
        const kho = taoKho([nguoiDung()])
        const r = await goi('toggle', kho, { enabled: true })
        dung('toggle-2fa { enabled: true } khi đang bật ⇒ 200, không ghi gì (không hiểu nhầm thành tắt)',
            r.ma === 200 && r.than?.data?.twoFactorEnabled === true && nguyenVen(kho.hang()) && !kho.goi.includes('user.update'), { r, goi: kho.goi })
    }
    {
        const kho = taoKho([])
        const r = await goi('toggle', kho, { password: MAT_KHAU })
        dung('toggle-2fa — không thấy người dùng ⇒ 404', r.ma === 404, r)
    }

    // ── disable-2fa: cùng một đường tắt
    {
        const kho = taoKho([nguoiDung()])
        const r = await goi('disable', kho, undefined)
        dung('disable-2fa không mật khẩu ⇒ 400 "Mật khẩu là bắt buộc", không ghi',
            r.ma === 400 && r.than?.error === 'Mật khẩu là bắt buộc' && nguyenVen(kho.hang()) && !kho.goi.includes('user.update'), { r, goi: kho.goi })
        const r2 = await goi('disable', kho, { password: 'Sai@1234' })
        dung('disable-2fa sai mật khẩu ⇒ 400 "Mật khẩu không đúng"', r2.ma === 400 && r2.than?.error === 'Mật khẩu không đúng' && nguyenVen(kho.hang()), r2)
        const r3 = await goi('disable', kho, { password: MAT_KHAU })
        dung('disable-2fa đúng mật khẩu ⇒ 200 "Đã tắt 2FA" (hình dạng cũ), xoá hạt + thiết bị tin cậy',
            r3.ma === 200 && r3.than?.success === true && r3.than?.message === 'Đã tắt 2FA' && daXoaSach(kho.hang()), { r3, hang: tomTat(kho.hang()) })
        const r4 = await goi('disable', taoKho([]), { password: MAT_KHAU })
        dung('disable-2fa — không thấy người dùng ⇒ 404', r4.ma === 404, r4)
    }

    // ── Đặt lại 2FA trọn vòng: tắt (mật khẩu) → setup-2fa (hạt MỚI) → confirm-2fa; mã từ hạt CŨ không bật được
    {
        const kho = taoKho([nguoiDung()])
        const tat = await goi('toggle', kho, { password: MAT_KHAU })
        const st = await goi('setup', kho, undefined)
        const hatMoi = kho.hang().twoFactorSecret
        dung('đặt lại: setup-2fa sau khi tắt ⇒ hạt MỚI khác hạt cũ, cờ chưa bật',
            tat.ma === 200 && st.ma === 200 && !!hatMoi && hatMoi !== HAT_CU && st.than?.data?.secret === hatMoi && kho.hang().twoFactorEnabled === false, { tat: tat.ma, st: st.ma })
        const maCu = await otplib.generate({ secret: HAT_CU })
        const trungNgauNhien = (await otplib.verify({ secret: hatMoi, token: maCu })).valid   // xác suất ~1/300.000 — khi trùng thì bỏ ca
        if (!trungNgauNhien) {
            const c1 = await goi('confirm', kho, { totpCode: maCu })
            dung('đặt lại: mã từ hạt CŨ ⇒ confirm-2fa 400, cờ vẫn tắt', c1.ma === 400 && kho.hang().twoFactorEnabled === false, c1)
        }
        const c2 = await goi('confirm', kho, { totpCode: await otplib.generate({ secret: hatMoi }) })
        dung('đặt lại: mã từ hạt MỚI ⇒ confirm-2fa bật, hạt = hạt mới, thiết bị tin cậy cũ không quay lại',
            c2.ma === 200 && kho.hang().twoFactorEnabled === true && kho.hang().twoFactorSecret === hatMoi && kho.hang().trustedDevices === '[]', { c2, bat: kho.hang().twoFactorEnabled })
    }

    // ── setup-2fa vẽ QR TẠI MÁY CHỦ: hạt mới chỉ đi máy chủ → trình duyệt, không qua dịch vụ vẽ QR bên ngoài
    {
        const kho = taoKho([nguoiDung({ twoFactorEnabled: false, twoFactorSecret: null, trustedDevices: '[]' })])
        const st = await goi('setup', kho, undefined)
        const d = st.than?.data || {}
        const hatMoi = kho.hang().twoFactorSecret
        let hatTrongUrl: string | null = null
        try { hatTrongUrl = new URL(String(d.otpauthUrl)).searchParams.get('secret') } catch { /* không phải URL */ }
        dung('setup-2fa ⇒ 200, otpauthUrl + secret (nhập tay) mang đúng hạt MỚI vừa ghi',
            st.ma === 200 && !!hatMoi && hatTrongUrl === hatMoi && d.secret === hatMoi && String(d.otpauthUrl).startsWith('otpauth://totp/'), { ma: st.ma })
        dung('setup-2fa trả qrDataUrl là ảnh PNG data: URL — trình duyệt không phải gọi máy nào khác để vẽ QR',
            typeof d.qrDataUrl === 'string' && d.qrDataUrl.startsWith('data:image/png;base64,') && d.qrDataUrl.length > 500, { dau: String(d.qrDataUrl).slice(0, 24) })
        const muc = typeof d.qrDataUrl === 'string' ? await qrCuaChuoi(d.qrDataUrl, String(d.otpauthUrl)) : null
        dung(`ảnh qrDataUrl đúng là mã QR của otpauthUrl (so từng ô với QR dựng lại từ otpauthUrl)${muc ? ` — mức sửa lỗi ${muc}` : ''}`, !!muc)
        // phải kêu: cùng ảnh mà so với chuỗi khác (hạt khác) ⇒ không khớp — bộ so không xanh rỗng
        const hatKhac = otplib.generateSecret()
        const saiChuoi = typeof d.qrDataUrl === 'string' ? await qrCuaChuoi(d.qrDataUrl, String(d.otpauthUrl).replace(`secret=${hatMoi}`, `secret=${hatKhac}`)) : 'x'
        dung('bộ so ảnh QR tự thử: so với otpauthUrl mang hạt KHÁC ⇒ không khớp', saiChuoi === null)
        dung('phản hồi setup-2fa không chứa đường dẫn http(s) nào (ảnh QR không trỏ ra máy ngoài)', st.ma === 200 && !/https?:\/\//i.test(JSON.stringify(st.than)))
    }
    {
        const kho = taoKho([nguoiDung()])
        const r = await goi('setup', kho, undefined)
        dung('setup-2fa khi 2FA đang bật ⇒ 400 "2FA đã được bật", hạt cũ giữ nguyên, không trả hạt / ảnh QR',
            r.ma === 400 && r.than?.error === '2FA đã được bật' && !r.than?.data && nguyenVen(kho.hang()) && !kho.goi.includes('user.update'), { r: r.ma, goi: kho.goi })
    }
}

;(async () => {
    tuThuBoQuet()
    quetMaThat()
    if (!process.argv.includes('--tep')) await chayTuyen()
    console.log(loi ? `\n✗ ${loi}/${soCa} ca SAI` : `\n✓ ${soCa}/${soCa} ca đạt`)
    process.exit(loi ? 1 : 0)
})().catch(e => { console.error('✗ bộ soát lỗi:', e); process.exit(1) })
